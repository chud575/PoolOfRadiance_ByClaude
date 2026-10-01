/**
 * Regression test for the Settings → Controls key rebinding flow (title/UI
 * workstream). Uses a tiny DOM shim so it runs in the node test environment.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// ---------------------------------------------------------------- DOM shim
class FakeClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, on) { const v = on === undefined ? !this.set.has(c) : !!on; if (v) this.set.add(c); else this.set.delete(c); return v; }
  contains(c) { return this.set.has(c); }
}
class FakeNode {
  constructor(tag = '#text') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = { setProperty() {} };
    this.attrs = {};
    this.listeners = {};
    this._text = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.offsetTop = 0;
    this.offsetHeight = 0;
    this.offsetWidth = 0;
  }
  get firstChild() { return this.children[0] ?? null; }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === FakeNode.root; }
  get textContent() { return this.tagName === '#TEXT' ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children.length = 0; if (v !== '') this.append(String(v)); }
  set innerHTML(v) { this._html = v; }
  append(...nodes) {
    for (let n of nodes) {
      if (typeof n === 'string') { const t = new FakeNode(); t._text = n; n = t; }
      n.parentNode?.removeChild?.(n);
      n.parentNode = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) { this.children.length = 0; this.append(...nodes); }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn); }
  dispatch(t, ev = {}) { const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...ev }; (this.listeners[t] ?? []).forEach((f) => f(e)); return e; }
  click() { this.dispatch('click'); }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; }
  querySelectorAll(sel) {
    const out = [];
    const cls = sel.replace(/^\./, '');
    const walk = (n) => { for (const c of n.children) { if (c.classList?.contains(cls)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

const winListeners = {};
beforeAll(() => {
  FakeNode.root = new FakeNode('html');
  globalThis.document = {
    createElement: (t) => new FakeNode(t),
    createElementNS: (_ns, t) => new FakeNode(t),
    createTextNode: (s) => { const n = new FakeNode(); n._text = s; return n; },
    documentElement: FakeNode.root,
  };
  globalThis.Node = FakeNode;
  globalThis.window = {
    addEventListener: (t, fn) => (winListeners[t] ??= []).push(fn),
    removeEventListener: (t, fn) => { winListeners[t] = (winListeners[t] ?? []).filter((f) => f !== fn); },
    devicePixelRatio: 1,
    innerWidth: 1600,
    innerHeight: 900,
  };
});

const key = (code, k = code) => {
  const e = { code, key: k, repeat: false, target: null, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
  (winListeners.keydown ?? []).forEach((f) => f(e));
  return e;
};

function makeCtx() {
  const store = {};
  const bindings = {
    forward: ['KeyW', 'ArrowUp', 'pad:12'], back: ['KeyS', 'ArrowDown', 'pad:13'], turnLeft: ['KeyA'], turnRight: ['KeyD'],
    strafeLeft: ['KeyQ'], strafeRight: ['KeyE'], turnAround: ['KeyX'], confirm: ['Enter'], cancel: ['Escape'],
  };
  const handlers = {};
  return {
    settings: { get: (k) => store[k], set: (k, v) => { store[k] = v; } },
    bus: { on: (e, fn) => { (handlers[e] ??= []).push(fn); return () => {}; }, emit() {} },
    input: {
      bindings,
      rebind(action, codes) { bindings[action] = codes; },
      resetBindings() {},
    },
    audio: { sfx() {} },
  };
}

describe('SettingsPanel key rebinding', () => {
  it('click a key slot → "Press a key…" → the next key rebinds it', async () => {
    const { SettingsPanel } = await import('../../src/ui/SettingsPanel.js');
    const ctx = makeCtx();
    const panel = new SettingsPanel(ctx, { tab: 'controls' });
    FakeNode.root.append(panel.el);
    const row = panel.rowEls.find((r) => r.dataset.action === 'forward');
    const slot = row.querySelector('.por-bind-key');
    slot.dispatch('click');
    expect(panel.capture).toEqual({ action: 'forward', slot: 0 });
    const waiting = panel.rowEls.find((r) => r.dataset.action === 'forward').querySelector('.por-bind-key');
    expect(waiting.classList.contains('waiting')).toBe(true);
    expect(waiting.textContent).toMatch(/Press a key/);
    key('KeyI', 'i');
    expect(panel.capture).toBe(null);
    expect(ctx.input.bindings.forward[0]).toBe('KeyI');
    expect(ctx.input.bindings.forward).toContain('pad:12');
    panel.dispose();
  });

  it('Enter on a focused row starts capture; Del clears the slot; Esc cancels', async () => {
    const { SettingsPanel } = await import('../../src/ui/SettingsPanel.js');
    const ctx = makeCtx();
    const panel = new SettingsPanel(ctx, { tab: 'controls' });
    FakeNode.root.append(panel.el);
    key('ArrowDown', 'ArrowDown'); // focus "Step back"
    expect(panel.rowEls[panel.focus].dataset.action).toBe('back');
    key('Enter', 'Enter');
    expect(panel.capture).toEqual({ action: 'back', slot: 0 });
    key('Delete', 'Delete');
    expect(ctx.input.bindings.back).toEqual(['ArrowDown', 'pad:13']);
    expect(panel.rowEls[panel.focus].dataset.action).toBe('back');
    key('Enter', 'Enter');
    expect(panel.capture).not.toBe(null);
    key('Escape', 'Escape');
    expect(panel.capture).toBe(null);
    expect(ctx.input.bindings.back).toEqual(['ArrowDown', 'pad:13']);
    panel.dispose();
  });
});
