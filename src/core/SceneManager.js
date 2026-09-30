import { SCENE_LOADERS } from '../scenes/registry.js';

/**
 * Owns the active scene. Scenes are lazily imported through the registry so that
 * each scene is its own chunk and scene modules never import each other.
 *
 * Supports a stack for overlays (e.g. automap / camp pushed over explore):
 *   goto(name, params)  – replace the whole stack.
 *   push(name, params)  – suspend current scene (no exit), enter new one on top.
 *   pop(result)         – exit top scene and resume the one below
 *                         (calls its optional resume(result)).
 */
export class SceneManager {
  /** @param {import('./context.js').GameContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {{name:string, scene:import('./Scene.js').Scene}[]} */
    this.stack = [];
    this.transitioning = false;
    this._queue = Promise.resolve();
  }

  get current() {
    return this.stack[this.stack.length - 1]?.scene ?? null;
  }

  get currentName() {
    return this.stack[this.stack.length - 1]?.name ?? null;
  }

  static has(name) {
    return name in SCENE_LOADERS;
  }

  async _load(name) {
    const loader = SCENE_LOADERS[name];
    if (!loader) throw new Error(`Unknown scene "${name}"`);
    const mod = await loader();
    const SceneClass = mod.default;
    return new SceneClass(this.ctx);
  }

  /** Serialise transitions so rapid calls cannot interleave. */
  _enqueue(fn) {
    this._queue = this._queue.then(fn).catch((err) => {
      console.error('[SceneManager] transition failed', err);
      this.transitioning = false;
      throw err;
    });
    return this._queue;
  }

  goto(name, params = {}) {
    return this._enqueue(async () => {
      this.transitioning = true;
      const scene = await this._load(name);
      while (this.stack.length) this.stack.pop().scene.exit();
      this.ctx.ui.resetScene();
      this.ctx.render.resetPost();
      this.stack.push({ name, scene });
      this.ctx.render.applyPost(scene.post);
      this.ctx.bus.emit('scene:enter', { name, params });
      await scene.enter(params);
      this.ctx.render.applyPost(scene.post);
      this.transitioning = false;
    });
  }

  push(name, params = {}) {
    return this._enqueue(async () => {
      this.transitioning = true;
      const below = this.current;
      below?.suspend?.();
      const scene = await this._load(name);
      this.stack.push({ name, scene });
      this.ctx.bus.emit('scene:enter', { name, params, overlay: true });
      await scene.enter(params);
      this.ctx.render.applyPost(scene.post);
      this.transitioning = false;
    });
  }

  pop(result) {
    return this._enqueue(async () => {
      if (this.stack.length <= 1) return;
      const top = this.stack.pop();
      top.scene.exit();
      const below = this.current;
      this.ctx.render.resetPost();
      this.ctx.render.applyPost(below.post);
      this.ctx.bus.emit('scene:resume', { name: this.currentName, result });
      below?.resume?.(result);
    });
  }

  update(dt) {
    if (this.transitioning) return;
    this.current?.update(dt);
  }

  /**
   * Render the top-most opaque scene. Overlay scenes that set
   * `this.transparent = true` (e.g. automap pushed over explore) let the scene
   * below keep rendering underneath their DOM.
   */
  render() {
    if (!this.stack.length || this.transitioning) {
      this.ctx.render.clear();
      return;
    }
    let i = this.stack.length - 1;
    while (i > 0 && this.stack[i].scene.transparent) i--;
    this.stack[i].scene.render();
  }

  resize(w, h) {
    for (const { scene } of this.stack) scene.onResize(w, h);
  }
}
