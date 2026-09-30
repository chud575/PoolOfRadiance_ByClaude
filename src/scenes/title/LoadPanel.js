import { h } from '../../ui/UI.js';
import { Frame } from '../../ui/components/Frame.js';
import { SAVE_SLOTS } from '../../core/SaveManager.js';

/**
 * Save-slot browser ("The Chronicle"): the Auto slot plus A–J. Keyboard,
 * mouse and gamepad navigable. Deleting asks for confirmation.
 */
export class LoadPanel {
  constructor(ctx, { onClose, onLoad }) {
    this.ctx = ctx;
    this.onClose = onClose;
    this.onLoad = onLoad;
    this.index = 0;
    this.el = h('div.por-load');
    this._build();
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey, true);
    this._off = ctx.bus.on('input:action', ({ action, code }) => {
      if (!String(code).startsWith('pad:') || this.busy) return;
      if (action === 'forward') this._move(-1);
      else if (action === 'back') this._move(1);
      else if (action === 'confirm') this._choose();
      else if (action === 'cancel') this.onClose();
      else if (action === 'turnAround') this._delete();
    });
  }

  _build() {
    const list = new Map(this.ctx.saves.list().map((s) => [s.slot, s]));
    this.rows = SAVE_SLOTS.map((slot) => ({ slot, rec: list.get(slot) ?? null }));
    const first = this.rows.findIndex((r) => r.rec);
    this.index = Math.max(0, first);
    this.listEl = h('div.por-load-list', { role: 'listbox' });
    this.rowEls = this.rows.map((r, i) => {
      const date = r.rec?.savedAt ? new Date(r.rec.savedAt) : null;
      const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const [who, where, time] = String(r.rec?.summary ?? '').split(' — ');
      const el = h(`button.por-load-row${r.rec ? '' : '.empty'}`, {
        type: 'button', role: 'option',
        onmouseenter: () => this._focus(i),
        onclick: () => { this._focus(i); this._choose(); },
      }, [
        h('span.por-load-slot', [r.slot === 'auto' ? 'Auto' : r.slot]),
        r.rec
          ? h('span.por-load-info', [h('span.por-load-who', [who || 'Saved game']), h('span.por-load-where', [[where, time].filter(Boolean).join(' · ')])])
          : h('span.por-load-info', [h('span.por-load-who.muted', ['— empty —'])]),
        h('span.por-load-when', [when]),
      ]);
      return el;
    });
    this.listEl.append(...this.rowEls);
    const frame = Frame({
      title: 'Load Game',
      variant: 'blue',
      className: 'por-load-frame',
      children: [
        h('div.por-set-blurb', ['The chronicle of your adventures. The Auto slot is written whenever the party enters a new area.']),
        h('div.por-rule'),
        this.listEl,
        h('div.por-load-actions', [
          h('button.por-btn', { type: 'button', onclick: () => this._delete() }, ['Delete']),
          h('span.spacer'),
          h('button.por-btn', { type: 'button', onclick: () => this.onClose() }, ['Back']),
          h('button.por-btn.primary', { type: 'button', onclick: () => this._choose() }, ['Load']),
        ]),
      ],
    });
    this.el.replaceChildren(frame.el);
    this._focus(this.index);
  }

  _focus(i) {
    this.index = Math.max(0, Math.min(this.rows.length - 1, i));
    this.rowEls.forEach((r, j) => r.classList.toggle('focus', j === this.index));
  }

  _move(d) {
    this._focus(this.index + d);
    this.ctx.audio.sfx('click', { bus: 'ui', pitch: 1.4 });
  }

  _choose() {
    const r = this.rows[this.index];
    if (r?.rec) this.onLoad(r.slot);
    else this.ctx.audio.sfx('bump', { bus: 'ui' });
  }

  async _delete() {
    const r = this.rows[this.index];
    if (!r?.rec) return;
    this.busy = true;
    const ok = await this.ctx.ui.dialog({
      title: 'Delete save',
      body: `Strike slot ${r.slot === 'auto' ? 'Auto' : r.slot} from the chronicle? This cannot be undone.`,
      buttons: [{ id: 'no', label: 'Keep it' }, { id: 'yes', label: 'Delete', primary: true }],
    });
    this.busy = false;
    if (ok === 'yes') {
      this.ctx.saves.remove(r.slot);
      this._build();
    }
  }

  _onKey(e) {
    if (this.busy || !this.el.isConnected) return;
    let handled = true;
    if (e.key === 'ArrowUp') this._move(-1);
    else if (e.key === 'ArrowDown') this._move(1);
    else if (e.key === 'Enter' || e.key === ' ') this._choose();
    else if (e.key === 'Delete') this._delete();
    else if (e.key === 'Escape' || e.key === 'Backspace') this.onClose();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    this._off?.();
    this.el.remove();
  }
}
