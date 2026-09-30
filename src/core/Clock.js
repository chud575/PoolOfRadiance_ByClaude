/**
 * Game clock. All animation MUST read time from here (ctx.clock.time) instead of
 * performance.now() so that the debug/shot API can freeze time deterministically.
 *
 *  - Normal mode: time advances with real time (scaled by timeScale).
 *  - Frozen mode (?freeze=1 or ?t=seconds): time is pinned at `frozenAt`, dt === 0.
 *    Scenes must then render their "settled" state (tweens snapped to end).
 */
export class Clock {
  /** @param {{frozen?: boolean, t?: number}} [opts] */
  constructor(opts = {}) {
    this.frozen = !!opts.frozen;
    /** Seconds since game start (or the frozen time). */
    this.time = opts.t ?? 0;
    /** Last frame delta in seconds (0 while frozen). */
    this.dt = 0;
    this.timeScale = 1;
    this.frame = 0;
    this._last = -1;
  }

  /** @param {number} nowMs performance.now() */
  tick(nowMs) {
    this.frame++;
    if (this.frozen) {
      this.dt = 0;
      return 0;
    }
    if (this._last < 0) this._last = nowMs;
    let dt = (nowMs - this._last) / 1000;
    this._last = nowMs;
    dt = Math.min(Math.max(dt, 0), 0.1) * this.timeScale; // clamp hitches
    this.dt = dt;
    this.time += dt;
    return dt;
  }
}
