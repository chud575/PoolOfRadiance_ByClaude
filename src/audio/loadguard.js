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
 * After a healthy stretch it steps back: first the structure (one level per
 * `recover` seconds), then the cap (+12 per `recover` seconds).
 */
export class LoadGuard {
  constructor({ window = 2, min = 36, max = VOICE_CAP, recover = 20, maxDegrade = 3 } = {}) {
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
      this.events++;
      this.lag += Math.max(0, dw - da);
      this.good = 0;
      if (this.cap > this.min) this.cap = Math.max(this.min, Math.round(this.cap * 0.7));
      else if (this.degrade < this.maxDegrade) this.degrade++;
    } else if (ratio > 0.993) {
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
