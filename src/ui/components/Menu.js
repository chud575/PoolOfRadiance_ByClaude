import { h, clear, hotkeyLabel } from '../dom.js';

/**
 * Vertical keyboard/mouse menu. items: [{id, label, key?, hint?, disabled?}]
 * onSelect(item). Arrow keys + Enter, or hotkeys.
 */
export class Menu {
  constructor(items, { onSelect, className = '', autofocus = true } = {}) {
    this.el = h('div.por-menu', { class: className, tabIndex: 0 });
    this.onSelect = onSelect;
    this.index = 0;
    this._onKey = this._onKey.bind(this);
    this.el.addEventListener('keydown', this._onKey);
    this.set(items);
    if (autofocus) queueMicrotask(() => this.el.focus({ preventScroll: true }));
  }

  set(items) {
    this.items = items;
    clear(this.el);
    this._rows = items.map((it, i) =>
      h('button.por-menu-item', {
        type: 'button',
        disabled: !!it.disabled,
        onclick: () => this.select(i),
        onmouseenter: () => this.highlight(i),
      }, [hotkeyLabel(it.label, it.key), it.hint ? h('span.por-menu-hint', [it.hint]) : null]),
    );
    this.el.append(...this._rows);
    this.highlight(Math.min(this.index, items.length - 1));
  }

  highlight(i) {
    this.index = i;
    this._rows.forEach((r, j) => r.classList.toggle('hl', j === i));
  }

  select(i) {
    const it = this.items[i];
    if (it && !it.disabled) this.onSelect?.(it);
  }

  _onKey(e) {
    const n = this.items.length;
    if (e.key === 'ArrowDown') this.highlight((this.index + 1) % n);
    else if (e.key === 'ArrowUp') this.highlight((this.index + n - 1) % n);
    else if (e.key === 'Enter' || e.key === ' ') this.select(this.index);
    else {
      const i = this.items.findIndex((it) => it.key && it.key.toUpperCase() === e.key.toUpperCase());
      if (i >= 0) this.select(i);
      else return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  dispose() {
    this.el.remove();
  }
}
