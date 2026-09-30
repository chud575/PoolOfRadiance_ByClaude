import { h, clear } from '../dom.js';
import { deriveStats } from '../../rules/character.js';

/**
 * Party roster panel (Gold Box "NAME  AC  HP" list), live-updating on
 * 'party:changed'. Click a row to select the active member.
 */
export class PartyRoster {
  /** @param {import('../../core/context.js').GameContext} ctx */
  constructor(ctx, { compact = false } = {}) {
    this.ctx = ctx;
    this.compact = compact;
    this.el = h('div.por-roster');
    this.off = ctx.bus.on('party:changed', () => this.refresh());
    this.refresh();
  }

  refresh() {
    const { party, activeIndex } = this.ctx.game;
    clear(this.el);
    this.el.append(h('div.por-roster-head', [h('span.n', ['Name']), h('span.ac', ['AC']), h('span.hp', ['HP'])]));
    party.forEach((ch, i) => {
      const s = deriveStats(ch);
      const pct = Math.max(0, ch.hp.cur) / ch.hp.max;
      const state = ch.status !== 'ok' ? ch.status : pct < 0.34 ? 'low' : 'ok';
      const row = h(`div.por-roster-row.st-${state}`, {
        class: i === activeIndex ? 'active' : '',
        dataset: { tip: `${ch.name} — ${s.className} ${s.levels}` },
        onclick: () => {
          this.ctx.game.activeIndex = i;
          this.ctx.game.notifyPartyChanged();
        },
      }, [
        h('span.n', [ch.name]),
        h('span.ac', [String(s.ac)]),
        h('span.hp', [String(ch.hp.cur)]),
        h('span.bar', [h('i', { style: { width: `${pct * 100}%` } })]),
      ]);
      this.el.append(row);
    });
  }

  dispose() {
    this.off();
    this.el.remove();
  }
}
