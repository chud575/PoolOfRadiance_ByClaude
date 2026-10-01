import { h, clear, hotkeyLabel } from '../dom.js';

/**
 * Vertical keyboard/mouse/gamepad menu.
 *   items: [{id, label, key?, hint?, desc?, disabled?, locked?}]
 *   `disabled` rows are skipped entirely; `locked` rows can be highlighted (so
 *   their `desc` can explain why) but not chosen — they show a padlock.
 *   opts:  {onSelect(item), onHighlight?(item, i), onCancel?(), bus?, className?, autofocus?, hotkeys?}
 * Keyboard: arrows + Enter/Space, or the highlighted hotkey letters (Gold Box
 * style). Gamepad: pass `bus` and the d-pad/stick (forward/back) moves, A
 * (confirm) selects, B (cancel) calls onCancel — only for pad-originated
 * actions, so keyboard input is never handled twice.
 */
export class Menu {
  constructor(items, { onSelect, onHighlight = null, onCancel = null, onLocked = null, bus = null, className = '', autofocus = true, hotkeys = true } = {}) {
    this.el = h('div.por-menu', { class: className, tabIndex: 0, role: 'menu' });
    this.onSelect = onSelect;
    this.onHighlight = onHighlight;
    this.onCancel = onCancel;
    this.onLocked = onLocked;
    this.hotkeys = hotkeys;
    this.index = 0;
    this.active = true;
    this._onKey = this._onKey.bind(this);
    this.el.addEventListener('keydown', this._onKey);
    this.set(items);
    if (bus) {
      this._off = bus.on('input:action', ({ action, code }) => {
        if (!this.active || !String(code).startsWith('pad:') || !this.el.isConnected) return;
        if (action === 'forward') this.highlight(this._step(this.index, -1));
        else if (action === 'back') this.highlight(this._step(this.index, 1));
        else if (action === 'confirm') this.select(this.index);
        else if (action === 'cancel') this.onCancel?.();
      });
    }
    if (autofocus) queueMicrotask(() => this.el.isConnected && this.el.focus({ preventScroll: true }));
  }

  set(items) {
    this.items = items;
    clear(this.el);
    this._rows = items.map((it, i) =>
      h('button.por-menu-item', {
        type: 'button',
        role: 'menuitem',
        tabIndex: -1,
        disabled: !!it.disabled,
        class: it.locked ? 'locked' : '',
        'aria-disabled': it.locked ? 'true' : null,
        dataset: { id: it.id, ...(it.tip ? { tip: it.tip } : {}) },
        onclick: () => this.select(i),
        onmouseenter: () => !it.disabled && this.highlight(i),
      }, [
        h('span.por-menu-label', [hotkeyLabel(it.label, it.locked ? null : it.key), it.locked ? lockIcon() : null]),
        it.hint ? h('span.por-menu-hint', [it.hint]) : null,
        it.desc ? h('span.por-menu-desc', [it.desc]) : null,
      ]),
    );
    this.el.append(...this._rows);
    const start = Math.min(this.index, items.length - 1);
    this.highlight(this.items[start]?.disabled ? this._step(start, 1) : start);
  }

  /** Next enabled row from `from` in direction `d` (±1), wrapping; `from` if none. */
  _step(from, d) {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + d * k) % n) + n) % n;
      if (!this.items[i].disabled) return i;
    }
    return from;
  }

  highlight(i) {
    const changed = i !== this.index;
    this.index = i;
    this._rows.forEach((r, j) => {
      r.classList.toggle('hl', j === i);
      r.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (this.items[i]) this.onHighlight?.(this.items[i], i, changed);
  }

  /** Highlight by item id. */
  highlightId(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i >= 0 && !this.items[i].disabled) this.highlight(i);
  }

  select(i) {
    const it = this.items[i];
    if (it?.locked) {
      this.highlight(i);
      const r = this._rows[i];
      r.classList.remove('denied');
      void r.offsetWidth;
      r.classList.add('denied');
      this.onLocked?.(it);
      return;
    }
    if (it && !it.disabled) {
      this.highlight(i);
      this.onSelect?.(it);
    }
  }

  _onKey(e) {
    const n = this.items.length;
    if (!n || !this.active) return;
    if (e.key === 'ArrowDown') this.highlight(this._step(this.index, 1));
    else if (e.key === 'ArrowUp') this.highlight(this._step(this.index, -1));
    else if (e.key === 'Home') this.highlight(this._step(-1, 1));
    else if (e.key === 'End') this.highlight(this._step(n, -1));
    else if (e.key === 'Enter' || e.key === ' ') this.select(this.index);
    else if (e.key === 'Escape' && this.onCancel) this.onCancel();
    else {
      const i = this.hotkeys ? this.items.findIndex((it) => it.key && !it.locked && it.key.toUpperCase() === e.key.toUpperCase()) : -1;
      if (i >= 0) this.select(i);
      else return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  focus() {
    this.el.focus({ preventScroll: true });
  }

  dispose() {
    this._off?.();
    this.el.remove();
  }
}

/** Small engraved padlock for locked menu rows (inline SVG, no assets). */
function lockIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 18');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('por-lock');
  s.innerHTML = '<path d="M4.5 8 V5.5 a3.5 3.5 0 0 1 7 0 V8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="2.5" y="8" width="11" height="8.5" rx="1.5" fill="currentColor"/><circle cx="8" cy="11.6" r="1.3" fill="#0b0a14"/><path d="M8 12.4 V14.4" stroke="#0b0a14" stroke-width="1.2"/>';
  return s;
}
