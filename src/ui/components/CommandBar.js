import { h, clear, hotkeyLabel } from '../dom.js';

/**
 * The classic Gold Box command line ("AREA CAST VIEW ENCAMP SEARCH LOOK"),
 * clickable, with hotkey letters highlighted and keyboard shortcuts.
 * commands: [{id, label, key, action?, disabled?, onSelect}]
 *
 * A command with `action` names an InputManager action: the scene already handles
 * that action (with its rebindable keys), so the bar does NOT also bind `key` as a
 * letter hotkey (that would double-fire, or collide with WASD/QE movement). `key`
 * is then only displayed, always as a keycap badge (one notation for the whole
 * bar). Commands without `action` keep the 1988 highlighted-capital hotkey.
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
      }, c.action ? actionLabel(c) : [hotkeyLabel(c.label, c.key)]);
      this.el.append(b);
    }
  }

  _onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    const c = this.commands.find((x) => !x.action && x.key && x.key.toUpperCase() === k && !x.disabled);
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

/**
 * Gold Box notation for an action command: the word with its yellow initial
 * capital (AREA CAST VIEW ENCAMP SEARCH LOOK, exactly as in 1988). When the
 * bound key is that initial letter nothing else is shown; when it is not
 * (default WASD movement claims A/S/E, or the player rebound it) a small
 * superscript keycap names the real key, so the bar never lies.
 */
function actionLabel(c) {
  const word = String(c.label);
  const key = String(c.key ?? '');
  const initial = word[0] ?? '';
  const same = key.length === 1 && key.toUpperCase() === initial.toUpperCase();
  return [
    h('span.por-cmd-word', [h('span.por-hk.por-hk-cap', [initial]), word.slice(1)]),
    key && !same ? h('span.por-cmd-key', { title: `Key: ${key}` }, [key]) : null,
  ];
}

/**
 * A key legend row ("[ ] Select member   Esc Break camp"), laid out like the
 * settings footer: each entry keeps its keycaps and words together on one
 * line, entries wrap as whole units, keycaps share one baseline.
 * @param {Array<[string[] | string, string]>} items  [[keys, label], ...]
 */
export function KeyLegend(items, { className = '' } = {}) {
  return h('div.por-legend', { class: className }, items.map(([keys, label]) => h('span.por-legend-item', [
    ...[].concat(keys).map((k) => h('span.por-keycap', [k])),
    h('span.por-legend-label', [label]),
  ])));
}
