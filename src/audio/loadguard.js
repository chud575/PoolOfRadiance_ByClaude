import { VOICE_CAP } from './instruments/base.js';

/**
 * Audio-thread load guard. When the render thread can't keep up (a slow or
 * busy machine in a desperate battle), the AudioContext clock falls behind
 * the wall clock. Every `window` seconds the guard compares the two and, if
 * audio advanced measurably slower than real time, cuts the section player
 * cap (strings / choir / brass thin out, never below two per note — the
 * music keeps every line, it just gets a smaller orchestra). After a long
 * healthy stretch the cap creeps back up.
 */
export class LoadGuard {
  constructor({ window = 2, min = 36, max = VOICE_CAP, recover = 20 } = {}) {
    this.window = window;
    this.min = min;
    this.max = max;
    this.recover = recover;
    this.cap = max;
    this.good = 0;
    this.mark = null;
    this.events = 0;
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
      this.cap = Math.max(this.min, Math.round(this.cap * 0.7));
      this.good = 0;
      this.events++;
    } else if (ratio > 0.993) {
      this.good += dw;
      if (this.good >= this.recover && this.cap < this.max) {
        this.cap = Math.min(this.max, this.cap + 12);
        this.good = 0;
      }
    }
    return this.cap;
  }
}
