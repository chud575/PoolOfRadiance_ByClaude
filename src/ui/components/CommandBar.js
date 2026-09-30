import { h, clear, hotkeyLabel } from '../dom.js';

/**
 * The classic Gold Box command line ("AREA CAST VIEW ENCAMP SEARCH LOOK"),
 * clickable, with hotkey letters highlighted and keyboard shortcuts.
 * commands: [{id, label, key, disabled?, onSelect}]
 */
export class CommandBar {
  constructor(commands = [], { title = '' } = {}) {
    this.el = h('div.por-commandbar');
    this.title = title;
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey);
    this.set(commands);
  }

  set(commands) {
    this.commands = commands;
    clear(this.el);
    if (this.title) this.el.append(h('span.por-cmd-title', [this.title]));
    for (const c of commands) {
      const b = h('button.por-cmd', {
        type: 'button',
        disabled: !!c.disabled,
        dataset: { tip: c.tip ?? '', cmd: c.id },
        onclick: () => !c.disabled && c.onSelect?.(c),
      }, [hotkeyLabel(c.label, c.key)]);
      this.el.append(b);
    }
  }

  _onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    const c = this.commands.find((x) => x.key && x.key.toUpperCase() === k && !x.disabled);
    if (c) {
      e.preventDefault();
      c.onSelect?.(c);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.el.remove();
  }
}
