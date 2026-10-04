import { VOICE_CAP } from './instruments/base.js';

/**
 * Audio-thread load guard. When the render thread can't keep up (a slow or
 * busy machine in a desperate battle), the AudioContext clock falls behind
 * the wall clock. Every `window` seconds the guard compares the two and, if
 * audio advanced measurably slower than real time:
 *   1. cuts the section player cap by 30 % (strings / choir / brass thin out,
 *      every line keeps sounding) down to `min`;
 *   2. once the cap is at its floor and the lag persists, degrades the score
 *      structurally — `degrade` 1 drops the desperate layer (L2), 2 drops the
 *      mid layer (L1), 3 swaps the live orchestra for a pre-bounced stem of
 *      the coming section rendered at a low sample rate (TrackPlayer.setDegrade);
 *   so the audio thread never keeps underrunning.
 * A single lagging window is only a suspicion (a page load or a GC pause that
 * the audio clock catches up from); the guard acts on the second one in a row,
 * or at once when a window loses more than `burst` seconds.
 * After a healthy stretch it steps back: first the structure (one level per
 * `recover` seconds), then the cap (+12 per `recover` seconds).
 */
export class LoadGuard {
  constructor({ window = 2, min = 36, max = VOICE_CAP, recover = 20, maxDegrade = 3, burst = 0.3 } = {}) {
    this.burst = burst;
    this.suspect = false;
    /** Lagging windows that did not repeat (one-off stalls, not sustained load). */
    this.glitches = 0;
    this.window = window;
    this.min = min;
    this.max = max;
    this.recover = recover;
    this.maxDegrade = maxDegrade;
    this.cap = max;
    this.degrade = 0;
    this.good = 0;
    this.mark = null;
    /** Windows in which audio fell behind real time (each one an underrun). */
    this.events = 0;
    /** Seconds of audio clock lost to underruns in total. */
    this.lag = 0;
  }

  /**
   * @param {number} wall  wall-clock seconds
   * @param {number} audio AudioContext.currentTime
   * @param {boolean} running context is running (suspended time is ignored)
   * @returns {number} the player cap to use
   */
  update(wall, audio, running = true) {
    if (!running) {
      this.mark = null;
      return this.cap;
    }
    if (!this.mark) {
      this.mark = { wall, audio };
      return this.cap;
    }
    const dw = wall - this.mark.wall;
    if (dw < this.window) return this.cap;
    const da = audio - this.mark.audio;
    this.mark = { wall, audio };
    // A gap far longer than the window is a sleeping laptop / frozen tab, not load.
    if (dw > this.window * 4) return this.cap;
    const ratio = da / dw;
    if (ratio < 0.975) {
      const lost = Math.max(0, dw - da);
      this.lag += lost;
      this.good = 0;
      if (!this.suspect && lost < this.burst) {
        this.suspect = 'new';
        return this.cap;
      }
      this.suspect = 'confirmed';
      this.events++;
      if (this.cap > this.min) this.cap = Math.max(this.min, Math.round(this.cap * 0.7));
      else if (this.degrade < this.maxDegrade) this.degrade++;
    } else if (ratio > 0.993) {
      if (this.suspect === 'new') this.glitches++;
      this.suspect = false;
      this.good += dw;
      if (this.good >= this.recover) {
        this.good = 0;
        if (this.degrade > 0) this.degrade--;
        else if (this.cap < this.max) this.cap = Math.min(this.max, this.cap + 12);
      }
    }
    return this.cap;
  }
}

/**
 * Main-thread starvation guard. The score is handed to the audio thread
 * `lookahead` seconds ahead by ticks on the main thread; when the main thread
 * stalls (shader compiles, GC, a slow frame on a weak GPU) for longer than
 * that, notes reach the scheduler late and are dropped while the audio thread
 * itself is idle. The guard watches for stalls (a gap of more than `gap`
 * seconds between ticks) and for drops (more than `drops` notes within
 * `window` seconds):
 *   level 1 — the lookahead stretches to `max` seconds (a 2–3 s hitch no
 *             longer reaches the speakers);
 *   level 2 — drops continue even so: the cue plays from pre-bounced section
 *             stems (one buffer source, nothing to schedule) until it recovers.
 * After `recover` seconds without a stall or a drop it steps back one level.
 */
export class StarveGuard {
  constructor({ base = 1.8, max = 4, window = 2, drops = 8, gap = 0.6, recover = 20 } = {}) {
    Object.assign(this, { base, max, window, drops, gap, recover });
    this.level = 0;
    this.last = null;
    this.hist = [];
    this.calm = 0;
    /** Stalls seen (ticks more than `gap` apart). */
    this.stalls = 0;
  }

  get lookahead() {
    return this.level >= 1 ? this.max : this.base;
  }

  /** Stem degradation the guard asks for (TrackPlayer.setDegrade level). */
  get degrade() {
    return this.level >= 2 ? 3 : 0;
  }

  /**
   * @param {number} wall    wall-clock seconds of this tick
   * @param {number} dropped notes dropped so far (monotonic total)
   */
  update(wall, dropped) {
    const prev = this.last;
    this.last = wall;
    if (prev === null) {
      this.hist.push([wall, dropped]);
      return this.lookahead;
    }
    const dt = wall - prev;
    // A gap of many seconds is a suspended context / sleeping laptop, not jank.
    const stall = dt > this.gap && dt < 15;
    this.hist.push([wall, dropped]);
    while (this.hist.length > 1 && this.hist[0][0] < wall - this.window) this.hist.shift();
    const burst = dropped - this.hist[0][1] > this.drops;
    if (stall) this.stalls++;
    if (burst) {
      // Dropping although the window is already stretched: fall back to stems.
      this.level = Math.min(2, this.level + 1);
      this.calm = 0;
      this.hist = [[wall, dropped]];
    } else if (stall) {
      this.level = Math.max(1, this.level);
      this.calm = 0;
    } else {
      this.calm += Math.max(0, dt);
      if (this.calm >= this.recover && this.level > 0) {
        this.level--;
        this.calm = 0;
      }
    }
    return this.lookahead;
  }
}
