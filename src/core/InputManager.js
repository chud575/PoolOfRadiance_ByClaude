/**
 * Unified input: keyboard + mouse + gamepad mapped to named ACTIONS.
 * Bindings are rebindable and persisted via Settings ('bindings').
 *
 * Usage in a scene's update():
 *   if (ctx.input.pressed('forward')) ...     // edge-triggered this frame
 *   if (ctx.input.down('turnLeft')) ...       // held
 * Or event style: ctx.bus.on('input:action', ({action}) => ...)
 *
 * Text-entry fields (input/textarea/contenteditable) swallow keyboard actions.
 */
export const DEFAULT_BINDINGS = Object.freeze({
  forward: ['KeyW', 'ArrowUp', 'Numpad8', 'pad:12'],
  back: ['KeyS', 'ArrowDown', 'Numpad2', 'pad:13'],
  turnLeft: ['KeyA', 'ArrowLeft', 'Numpad4', 'pad:14'],
  turnRight: ['KeyD', 'ArrowRight', 'Numpad6', 'pad:15'],
  strafeLeft: ['KeyQ', 'Numpad7', 'pad:4'],
  strafeRight: ['KeyE', 'Numpad9', 'pad:5'],
  turnAround: ['KeyX', 'pad:3'],
  confirm: ['Enter', 'Space', 'NumpadEnter', 'pad:0'],
  cancel: ['Escape', 'Backspace', 'pad:1'],
  area: ['KeyM', 'Tab', 'pad:8'],
  cast: ['KeyC'],
  view: ['KeyV'],
  encamp: ['KeyK', 'pad:9'],
  search: ['KeyF'],
  look: ['KeyL', 'pad:2'],
  prevMember: ['BracketLeft', 'PageUp'],
  nextMember: ['BracketRight', 'PageDown'],
  quicksave: ['F5'],
  quickload: ['F9'],
  toggleClassic: ['F2'],
  pause: ['F10'],
  debug: ['Backquote'],
});

export class InputManager {
  /**
   * @param {import('./EventBus.js').EventBus} bus
   * @param {import('./Settings.js').Settings} settings
   * @param {HTMLElement|Window} [target]
   */
  constructor(bus, settings, target = window) {
    this.bus = bus;
    this.settings = settings;
    this.target = target;
    /** @type {Record<string,string[]>} */
    this.bindings = { ...DEFAULT_BINDINGS, ...(settings?.get('bindings') ?? {}) };
    this._codeToActions = new Map();
    this._rebuildIndex();
    this._downCodes = new Set();
    this._pressedCodes = new Set();
    this._releasedCodes = new Set();
    this._padPrev = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, buttons: 0, clicked: false, wheel: 0 };
    this.enabled = true;
    /**
     * Modal action sink (e.g. the pause menu): while set, every action is passed
     * to this function INSTEAD of being emitted on the bus, so scenes underneath
     * never see it. @type {null|((e:{action:string, code:string, event:any})=>void)}
     */
    this.capture = null;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouse = this._onMouse.bind(this);
    this._onBlur = () => this._downCodes.clear();
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('mousemove', this._onMouse);
    target.addEventListener('mousedown', this._onMouse);
    target.addEventListener('mouseup', this._onMouse);
    target.addEventListener('wheel', this._onMouse, { passive: true });
    target.addEventListener('blur', this._onBlur);
  }

  _rebuildIndex() {
    this._codeToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const c of codes) {
        if (!this._codeToActions.has(c)) this._codeToActions.set(c, []);
        this._codeToActions.get(c).push(action);
      }
    }
  }

  /** Replace bindings for an action and persist. */
  rebind(action, codes) {
    this.bindings[action] = [...codes];
    this._rebuildIndex();
    const custom = { ...(this.settings?.get('bindings') ?? {}), [action]: [...codes] };
    this.settings?.set('bindings', custom);
  }

  resetBindings() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this._rebuildIndex();
    this.settings?.set('bindings', null);
  }

  /** Human readable label for the first keyboard binding of an action. */
  label(action) {
    const code = (this.bindings[action] ?? []).find((c) => !c.startsWith('pad:'));
    if (!code) return '';
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
  }

  _isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  _onKeyDown(e) {
    if (!this.enabled || this._isTyping(e)) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F5' || e.code === 'F9' || e.code === 'F2' || e.code === 'F10') e.preventDefault();
    if (!this._downCodes.has(e.code)) {
      this._pressedCodes.add(e.code);
      this._emitActions(e.code, e);
    }
    this._downCodes.add(e.code);
  }

  _onKeyUp(e) {
    this._downCodes.delete(e.code);
    this._releasedCodes.add(e.code);
  }

  _onMouse(e) {
    if (e.type === 'wheel') {
      this.mouse.wheel += e.deltaY;
      return;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.ny = -(e.clientY / window.innerHeight) * 2 + 1;
    this.mouse.buttons = e.buttons;
    if (e.type === 'mousedown') this.mouse.clicked = true;
  }

  _emitActions(code, event) {
    const actions = this._codeToActions.get(code);
    if (!actions) return;
    for (const action of actions) this._send({ action, code, event });
  }

  /** Poll gamepads; call once per frame before scene update. */
  poll() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const now = new Set();
    for (const pad of pads) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => b.pressed && now.add(`pad:${i}`));
      const [ax, ay] = pad.axes;
      if (ay < -0.6) now.add('pad:12');
      if (ay > 0.6) now.add('pad:13');
      if (ax < -0.6) now.add('pad:14');
      if (ax > 0.6) now.add('pad:15');
    }
    for (const c of now) {
      if (!this._padPrev.has(c)) {
        this._pressedCodes.add(c);
        this._emitActions(c, null);
      }
      this._downCodes.add(c);
    }
    for (const c of this._padPrev) if (!now.has(c)) this._downCodes.delete(c);
    this._padPrev = now;
  }

  /** Held this frame. */
  down(action) {
    return (this.bindings[action] ?? []).some((c) => this._downCodes.has(c));
  }

  /** Became pressed this frame (edge). */
  pressed(action) {
    return (this.bindings[action] ?? []).some((c) => this._pressedCodes.has(c));
  }

  released(action) {
    return (this.bindings[action] ?? []).some((c) => this._releasedCodes.has(c));
  }

  /** Programmatically trigger an action (used by UI buttons, tests, shot scripts). */
  trigger(action) {
    const code = this.bindings[action]?.[0] ?? `virtual:${action}`;
    this._pressedCodes.add(code);
    this._send({ action, code, event: null });
  }

  _send(payload) {
    if (this.capture) this.capture(payload);
    else this.bus.emit('input:action', payload);
  }

  /** Clear per-frame edge state; call at END of each frame. */
  endFrame() {
    this._pressedCodes.clear();
    this._releasedCodes.clear();
    this.mouse.clicked = false;
    this.mouse.wheel = 0;
  }

  dispose() {
    const t = this.target;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('mousemove', this._onMouse);
    t.removeEventListener('mousedown', this._onMouse);
    t.removeEventListener('mouseup', this._onMouse);
    t.removeEventListener('wheel', this._onMouse);
    t.removeEventListener('blur', this._onBlur);
  }
}
