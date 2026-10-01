import { h, clear } from '../dom.js';
import { deriveStats, statusLabel } from '../../rules/character.js';
import { RACES } from '../../rules/races.js';

let portraitMod = null;
/** Lazy: the painter (and its CSS) load only when a rich roster is first shown. */
function loadPortraits(cb) {
  if (portraitMod) return cb(portraitMod);
  import('./CharacterSheet.js').then((m) => {
    portraitMod = m;
    cb(m);
  });
  return null;
}

/**
 * Party roster panel (Gold Box "NAME  AC  HP" list), live-updating on
 * 'party:changed'. Click a row to select the active member.
 *
 * Options:
 *   compact    – (reserved)
 *   portraits  – rich rows: painted portrait, class/level line, HP bar, memorized-spell pips
 *   onOpen(i)  – double-click a member (e.g. open the character sheet)
 */
export class PartyRoster {
  /** @param {import('../../core/context.js').GameContext} ctx */
  constructor(ctx, { compact = false, portraits = false, onOpen = null } = {}) {
    this.ctx = ctx;
    this.compact = compact;
    this.portraits = portraits;
    this.onOpen = onOpen;
    this.el = h(`div.por-roster${portraits ? '.pc-rich' : ''}`);
    this.off = ctx.bus.on('party:changed', () => this.refresh());
    this.refresh();
  }

  refresh() {
    if (this.portraits) {
      if (portraitMod) portraitMod.useRenderer?.(this.ctx.render?.renderer);
      if (!portraitMod) {
        loadPortraits(() => this.refresh());
        return this._refreshClassic();
      }
      return this._refreshRich();
    }
    return this._refreshClassic();
  }

  _select(i) {
    this.ctx.game.activeIndex = i;
    this.ctx.game.notifyPartyChanged();
  }

  _refreshClassic() {
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
        onclick: () => this._select(i),
        ondblclick: () => this.onOpen?.(i),
      }, [
        h('span.n', [ch.name]),
        h('span.ac', [String(s.ac)]),
        h('span.hp', [String(ch.hp.cur)]),
        h('span.bar', [h('i', { style: { width: `${pct * 100}%` } })]),
      ]);
      this.el.append(row);
    });
  }

  _refreshRich() {
    const { party, activeIndex } = this.ctx.game;
    const { miniPortrait } = portraitMod;
    clear(this.el);
    party.forEach((ch, i) => {
      const s = deriveStats(ch);
      const pct = Math.max(0, ch.hp.cur) / Math.max(1, ch.hp.max);
      const state = ch.status !== 'ok' ? ch.status : pct < 0.34 ? 'low' : 'ok';
      const mem = Object.values(ch.spells?.memorized ?? {}).flat().length;
      this.el.append(h(`div.pc-rrow.st-${state}`, {
        class: i === activeIndex ? 'active' : '',
        dataset: { tip: `${ch.name} — ${RACES[ch.race].name} ${s.className} ${s.levels} · ${statusLabel(ch)}${mem ? ` · ${mem} spells memorized` : ''}` },
        onclick: () => this._select(i),
        ondblclick: () => this.onOpen?.(i),
      }, [
        miniPortrait(ch),
        h('div.mid', [
          h('div.nm', [ch.name]),
          h('div.cl', [`${s.classAbbr} ${s.levels} · ${ch.status === 'ok' ? `AC ${s.ac}` : statusLabel(ch)}`]),
          h(`div.pc-bar${state === 'low' || state === 'dying' || state === 'unconscious' ? '.low' : ''}`, [h('i', { style: { width: `${pct * 100}%` } })]),
        ]),
        h('div.nums', [h('div.hp', [`${ch.hp.cur}`]), h('div.ac', [`/${ch.hp.max}`])]),
        mem ? h('div.memo', Array.from({ length: Math.min(6, mem) }, () => h('i'))) : null,
      ]));
    });
  }

  dispose() {
    this.off();
    this.el.remove();
  }
}
