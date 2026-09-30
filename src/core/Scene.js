/**
 * Base class + contract for every scene.
 *
 * A scene lives in src/scenes/<name>/ and default-exports a class extending Scene.
 * Scenes may import from core/, rules/, data/, render/, ui/, audio/ ONLY —
 * never from another scene's directory. Cross-scene communication goes through
 * ctx.scenes.goto(name, params), ctx.game (GameState) and ctx.bus (EventBus).
 *
 * Lifecycle:
 *   constructor(ctx)        – cheap; no heavy allocation.
 *   await enter(params)     – build 3D scene/UI. Resolve only when the first frame
 *                             can be rendered in its final state (textures ready).
 *   update(dt)              – per-frame logic. dt === 0 when the clock is frozen.
 *   render()                – optional; default renders this.scene3d with this.camera
 *                             through the shared post-processing pipeline.
 *   exit()                  – tear down: dispose GPU resources, remove DOM, unsubscribe.
 *   onResize(w, h)          – viewport changed.
 *
 * Scenes that are pure-DOM can leave scene3d null; a backdrop is rendered instead.
 */
export class Scene {
  /** @param {import('./context.js').GameContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {import('three').Scene|null} */
    this.scene3d = null;
    /** @type {import('three').Camera|null} */
    this.camera = null;
    /** Functions called on exit (unsubscribers, DOM removal, dispose). */
    this._disposers = [];
    /** Post-processing overrides applied while this scene is active. */
    this.post = {};
  }

  /** @param {Record<string, any>} _params */
  async enter(_params) {}

  /** @param {number} _dt */
  update(_dt) {}

  render() {
    if (this.scene3d && this.camera) this.ctx.render.render(this.scene3d, this.camera);
    else this.ctx.render.clear();
  }

  exit() {
    for (const d of this._disposers.splice(0).reverse()) {
      try {
        d();
      } catch (e) {
        console.error('[Scene] disposer failed', e);
      }
    }
  }

  /** @param {number} _w @param {number} _h */
  onResize(_w, _h) {}

  /** Register a cleanup callback run on exit(). Returns the callback's argument for chaining. */
  own(disposer) {
    this._disposers.push(disposer);
    return disposer;
  }

  /** Subscribe to a bus event for the lifetime of the scene. */
  listen(event, fn) {
    this.own(this.ctx.bus.on(event, fn));
  }
}
