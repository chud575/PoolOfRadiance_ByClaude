/**
 * requestAnimationFrame loop. Calls update(dt) then render().
 * Kept deliberately simple: variable timestep with a clamped dt (see Clock).
 */
export class GameLoop {
  /**
   * @param {import('./Clock.js').Clock} clock
   * @param {(dt:number)=>void} update
   * @param {()=>void} render
   */
  constructor(clock, update, render) {
    this.clock = clock;
    this.update = update;
    this.render = render;
    this.running = false;
    this._raf = 0;
    this._frameCallbacks = [];
    this._step = this._step.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._raf = requestAnimationFrame(this._step);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  /** Resolve after `n` fully rendered frames. */
  afterFrames(n = 1) {
    return new Promise((resolve) => this._frameCallbacks.push({ n, resolve }));
  }

  _step(now) {
    if (!this.running) return;
    const dt = this.clock.tick(now);
    try {
      this.update(dt);
      this.render();
    } catch (err) {
      console.error('[GameLoop] frame error', err);
    }
    if (this._frameCallbacks.length) {
      this._frameCallbacks = this._frameCallbacks.filter((cb) => {
        cb.n--;
        if (cb.n <= 0) {
          cb.resolve();
          return false;
        }
        return true;
      });
    }
    this._raf = requestAnimationFrame(this._step);
  }
}
