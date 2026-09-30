/**
 * Tiny synchronous pub/sub event bus.
 * Event names are namespaced strings, e.g. 'scene:enter', 'party:changed',
 * 'message', 'input:action', 'combat:end'. See ARCHITECTURE.md for the catalogue.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe. Returns an unsubscribe function.
   * @param {string} event
   * @param {(payload:any)=>void} fn
   * @returns {() => void}
   */
  on(event, fn) {
    let set = this._handlers.get(event);
    if (!set) this._handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  /** Subscribe for one emission only. */
  once(event, fn) {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off(event, fn) {
    this._handlers.get(event)?.delete(fn);
  }

  /**
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${event}" threw`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}
