import './partyui.css';
import { h, clear } from '../dom.js';
import { ITEMS } from '../../data/items.js';
import { deriveStats, activeClasses } from '../../rules/character.js';
import { CLASSES, classSpecName } from '../../rules/classes.js';
import { knownSpells, slotsFor, freeSlots, prepareSpells, memorizationTime, partyMemorizationTime, autoPrepare, spellsToMemorize } from '../../rules/camp.js';
import { getSpell, spellLevel, castProblem, castSpell, isMemorized, consumeMemorized } from '../../rules/spells.js';
import { scribeScroll } from '../../rules/magicItems.js';
import { itemName } from '../../rules/items.js';
import { miniPortrait, lore } from './CharacterSheet.js';

const CASTERS = ['cleric', 'magicUser'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Casting classes a character can currently use. */
export function castingClassesOf(ch) {
  return activeClasses(ch).filter((c) => CASTERS.includes(c) && (slotsFor(ch, c).some((n) => n > 0)));
}

/** "4h 15m" */
export function fmtMinutes(m) {
  if (!m) return 'no rest';
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh ? `${hh}h` : ''}${hh && mm ? ' ' : ''}${mm ? `${mm}m` : ''}`;
}

function spellTip(id, cls) {
  const s = getSpell(id);
  if (!s) return { title: id, text: '' };
  const where = { both: 'combat or camp', combat: 'combat only', camp: 'camp only' }[s.usable] ?? '';
  return { title: `${s.name} · ${CLASSES[cls]?.name ?? ''} level ${spellLevel(id, cls)}`, text: `${s.tip ?? ''} ${s.flavor && s.flavor !== s.tip ? s.flavor : ''} (${where})`.trim() };
}

/**
 * Magic screen: choose casters' load-outs (memorize), cast camp spells, scribe scrolls.
 * The load-out (ch.spells.prepared) is re-memorized on each rest; memorized ⊆ load-out.
 */
export class SpellPanel {
  /**
   * @param {import('../../core/context.js').GameContext} ctx
   * @param {{index?: number, mode?: 'memorize'|'cast'|'scribe', onSelectMember?: (i:number)=>void, onRest?: () => void, onChange?: () => void, lockMember?: boolean}} [o]
   */
  constructor(ctx, o = {}) {
    this.ctx = ctx;
    this.o = o;
    this.mode = o.mode ?? 'memorize';
    const party = ctx.game.party;
    const casters = party.map((c, i) => [c, i]).filter(([c]) => castingClassesOf(c).length);
    this.index = o.index ?? casters[0]?.[1] ?? 0;
    if (!o.lockMember && !castingClassesOf(party[this.index] ?? {}).length && casters.length) this.index = casters[0][1];
    this.cls = null;
    this.focus = null; // spell id shown in the lore box
    this.el = h('div.pc-spells');
    this.render();
  }

  get ch() {
    return this.ctx.game.party[this.index];
  }

  setMember(i) {
    this.index = i;
    this.cls = null;
    this.focus = null;
    this.render();
  }

  render() {
    const ch = this.ch;
    clear(this.el);
    if (!ch) return;
    const classes = castingClassesOf(ch);
    if (!classes.includes(this.cls)) this.cls = classes[0] ?? null;
    const cls = this.cls;

    // ---- casters column
    const party = this.ctx.game.party;
    const casters = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', gap: '0.5em' } }, [
      h('div.pc-sect-h', [h('span', ['Casters'])]),
      h('div.pc-casters', party.map((c, i) => {
        const cc = castingClassesOf(c);
        const mem = Object.values(c.spells?.memorized ?? {}).flat().length;
        return h(`div.pc-caster${i === this.index ? '.sel' : ''}${cc.length ? '' : '.off'}`, {
          onclick: () => { if (cc.length || this.o.lockMember) { this.setMember(i); this.o.onSelectMember?.(i); } },
        }, [
          miniPortrait(c),
          h('div', [h('div.nm', [c.name]), h('div.cl', [cc.length ? `${cc.map((x) => CLASSES[x].name).join(' / ')} · ${mem} ready` : 'no spells'])]),
        ]);
      })),
      h('div', { style: { flex: '1' } }),
      this._restNote(),
    ]);

    if (!cls) {
      this.el.append(casters, h('div.pc-sect', { style: { gridColumn: 'span 2', display: 'grid', placeItems: 'center' } }, [
        h('div.pc-rest-note', { style: { textAlign: 'center', maxWidth: '26em' } }, [`${ch.name} knows no spells. Clerics pray for their spells and magic-users study them from spell books; fighters and thieves rely on steel.`]),
      ]));
      return;
    }

    const modes = [['memorize', 'Memorize'], ['cast', 'Cast'], ...(classes.includes('magicUser') ? [['scribe', 'Scribe']] : [])];
    const sub = h('div.pc-subtabs', [
      ...modes.map(([m, l]) => h(`button.pc-tab${m === this.mode ? '.sel' : ''}`, { onclick: () => { this.mode = m; this.render(); } }, [l])),
      h('span', { style: { flex: '1' } }),
      ...(classes.length > 1 ? classes.map((c) => h(`button.pc-tab${c === cls ? '.sel' : ''}`, { onclick: () => { this.cls = c; this.render(); } }, [CLASSES[c].name])) : []),
    ]);

    if (this.mode === 'cast') return this._renderCast(casters, sub, ch, cls);
    if (this.mode === 'scribe') return this._renderScribe(casters, sub, ch, cls);

    // ---- memorize: known spells by level
    const slots = slotsFor(ch, cls);
    const prepared = ch.spells?.prepared?.[cls] ?? [];
    const free = freeSlots(ch, cls, prepared);
    const known = knownSpells(ch, cls);
    const byLvl = [];
    for (const id of known) (byLvl[spellLevel(id, cls) - 1] ??= []).push(id);
    const lists = [];
    slots.forEach((n, i) => {
      if (!n) return;
      lists.push(h('div.pc-lvl-h', [h('span', [`Level ${ROMAN[i + 1]}`]), h('span.pc-slots', Array.from({ length: n }, (_, j) => h(`i.pc-pip${j < n - free[i] ? '.on' : ''}`)))]));
      for (const id of byLvl[i] ?? []) {
        const sp = getSpell(id);
        const count = prepared.filter((x) => x === id).length;
        const full = free[i] <= 0;
        lists.push(h(`div.pc-spell${this.focus === id ? '.sel' : ''}`, {
          dataset: lore(spellTip(id, cls)),
          onclick: () => { this.focus = id; if (!full) this.add(id); else { this.ctx.ui.toast(`No free level ${ROMAN[i + 1]} slots — remove a spell first.`); this.render(); } },
        }, [
          h(`span.gl.${cls}`, [ROMAN[i + 1]]),
          h('span', [h('div.nm', [sp.name]), h('div.tg', [sp.tip ?? ''])]),
          h('span.ct', [count ? `×${count}` : '']),
        ]));
      }
    });
    if (!lists.length) lists.push(h('div.pc-rest-note', ['No spells known.']));
    const knownCol = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, [
      sub,
      h('div.pc-sect-h.left', [h('span', [`${cls === 'cleric' ? 'Prayers granted by the gods' : 'Spells in the book'} · click to memorize`])]),
      h('div.pc-spell-scroll', lists),
    ]);

    // ---- load-out
    const memo = [...(ch.spells?.memorized?.[cls] ?? [])];
    const rows = prepared.map((id, k) => {
      const mi = memo.indexOf(id);
      const ready = mi >= 0;
      if (ready) memo.splice(mi, 1);
      const sp = getSpell(id);
      return h(`div.pc-spell${this.focus === id ? '.sel' : ''}`, { dataset: lore(spellTip(id, cls)), onclick: () => this.remove(k) }, [
        h(`span.gl.${cls}`, { style: ready ? {} : { opacity: 0.45 } }, [ROMAN[spellLevel(id, cls)]]),
        h('span', [h('div.nm', { style: ready ? {} : { color: 'var(--por-cyan)' } }, [sp.name]), h('div.tg', [ready ? 'memorized' : 'to be memorized on rest'])]),
        h('span.x', ['✕']),
      ]);
    });
    const need = memorizationTime(ch);
    // The party rests as long as its slowest caster needs: one number everywhere (camp panel, here, REST).
    const partyNeed = partyMemorizationTime(this.ctx.game.party);
    const nToLearn = Object.values(spellsToMemorize(ch)).flat().length;
    const loadout = h('div.pc-memo', [
      h('div.pc-sect', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } }, [
        h('div.pc-sect-h', [h('span', [`${ch.name}'s ${cls === 'cleric' ? 'prayers' : 'spells'}`])]),
        h('div.pc-spell-scroll.pc-memo-list', rows.length ? rows : [h('div.empty', ['No spells chosen. Pick from the list, or AUTO.'])]),
        h('div.pc-rest-note', { style: { marginTop: '0.5em' } }, need
          ? [`${ch.name} needs `, h('b', [fmtMinutes(need)]), ` to memorize ${nToLearn} spell${nToLearn === 1 ? '' : 's'} (1e: ${need > 300 ? 6 : 4} hours of sleep, then 15 minutes per spell level).`, partyNeed > need ? [' The party rests ', h('b', [fmtMinutes(partyNeed)]), ' for its slowest caster.'] : null]
          : [partyNeed ? ['All chosen spells are in memory. The party still needs ', h('b', [fmtMinutes(partyNeed)]), ' for the others.'] : 'All chosen spells are in memory.']),
      ]),
      h('div.pc-actions', [
        h('button.por-btn', { onclick: () => this.auto() }, ['Auto']),
        h('button.por-btn', { onclick: () => this.clearAll() }, ['Clear']),
        h('button.por-btn.primary', { style: { gridColumn: 'span 2' }, disabled: !partyNeed || !this.o.onRest, onclick: () => this.o.onRest?.() }, [partyNeed ? `Rest ${fmtMinutes(partyNeed)}` : 'Memorized']),
      ]),
    ]);
    this.el.append(casters, knownCol, loadout);
  }

  _restNote() {
    const party = this.ctx.game.party;
    const need = partyMemorizationTime(party);
    return h('div.pc-rest-note', need ? ['The party must rest ', h('b', [fmtMinutes(need)]), ' for every caster to finish memorizing.'] : ['Every caster has memorized their spells.']);
  }

  _renderCast(casters, sub, ch, cls) {
    const mem = ch.spells?.memorized?.[cls] ?? [];
    const uniq = [...new Set(mem)];
    const rows = uniq.map((id) => {
      const prob = castProblem(ch, id, { context: 'camp' });
      const sp = getSpell(id);
      return h(`div.pc-spell${this.focus === id ? '.sel' : ''}${prob ? '.dis' : ''}`, {
        dataset: lore(spellTip(id, cls)),
        onclick: () => { this.focus = id; this.render(); },
      }, [h(`span.gl.${cls}`, [ROMAN[spellLevel(id, cls)]]), h('span', [h('div.nm', [sp.name]), h('div.tg', [prob ?? sp.tip ?? ''])]), h('span.ct', [`×${mem.filter((x) => x === id).length}`])]);
    });
    const left = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, [
      sub,
      h('div.pc-sect-h.left', [h('span', ['Memorized spells'])]),
      h('div.pc-spell-scroll', rows.length ? rows : [h('div.pc-rest-note', ['Nothing in memory. Memorize, then rest.'])]),
    ]);
    const id = this.focus && uniq.includes(this.focus) ? this.focus : uniq.find((x) => !castProblem(ch, x, { context: 'camp' }));
    const sp = id && getSpell(id);
    const party = this.ctx.game.party;
    const needsTarget = sp && ['ally', 'creature', 'dead'].includes(sp.target);
    const right = h('div.pc-memo', [h('div.pc-sect', { style: { flex: '1' } }, [
      h('div.pc-sect-h', [h('span', ['Cast'])]),
      sp ? h('div', [
        h('div', { style: { fontFamily: 'var(--font-display)', color: 'var(--por-gilt-hi)', fontSize: '1.1em', letterSpacing: '0.06em' } }, [sp.name]),
        h('p.pc-rest-note', [sp.tip ?? '']),
        needsTarget
          ? h('div.pc-casters', party.map((c) => h('div.pc-caster', { onclick: () => this.cast(id, c) }, [miniPortrait(c), h('div', [h('div.nm', [c.name]), h('div.cl', [`HP ${c.hp.cur}/${c.hp.max}`])])])))
          : h('button.por-btn.primary', { onclick: () => this.cast(id, ch) }, [`Cast ${sp.name}`]),
      ]) : h('div.pc-rest-note', ['Choose a spell usable outside combat.']),
    ])]);
    this.el.append(casters, left, right);
  }

  _renderScribe(casters, sub, ch) {
    const scrolls = [];
    ch.inventory.forEach((e, i) => {
      const def = ITEMS[e.id];
      if (def?.type !== 'scroll') return;
      for (const id of e.spells ?? (def.effect ? [def.effect] : [])) {
        const s = getSpell(id);
        if (s?.schools?.magicUser !== undefined) scrolls.push({ i, id, e, s });
      }
    });
    const hasRead = isMemorized(ch, 'readMagic');
    const left = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, [
      sub,
      h('div.pc-sect-h.left', [h('span', ['Scrolls in the pack'])]),
      h('div.pc-spell-scroll', scrolls.length ? scrolls.map(({ i, id, e, s }) => h('div.pc-spell', { dataset: lore(spellTip(id, 'magicUser')), onclick: () => this.scribe(i, id) }, [
        h('span.gl.magicUser', [ROMAN[s.schools.magicUser]]),
        h('span', [h('div.nm', [s.name]), h('div.tg', [itemName(e)])]),
        h('span.ct', [ch.spells.book.includes(id) ? 'known' : 'scribe']),
      ])) : [h('div.pc-rest-note', ['No magic-user scrolls. Treasure and shops may yield some.'])]),
    ]);
    const right = h('div.pc-memo', [h('div.pc-sect', { style: { flex: '1' } }, [
      h('div.pc-sect-h', [h('span', ['Spell Book'])]),
      h('p.pc-rest-note', [hasRead ? 'Read Magic is memorized: the arcane script is legible.' : 'Scribing needs Read Magic in memory — it is spent to decipher the scroll.']),
      h('div', (ch.spells?.book ?? []).map((id) => h('span.pc-chip', { dataset: lore(spellTip(id, 'magicUser')) }, [getSpell(id)?.name ?? id]))),
    ])]);
    this.el.append(casters, left, right);
  }

  _changed(msg, kind = 'info') {
    if (msg) this.ctx.ui.message(msg, kind);
    this.ctx.game.notifyPartyChanged();
    this.o.onChange?.();
    this.render();
  }

  add(id) {
    const ch = this.ch;
    const cls = this.cls;
    const ids = [...(ch.spells?.prepared?.[cls] ?? []), id];
    try {
      const keepMem = [...(ch.spells?.memorized?.[cls] ?? [])];
      const study = ch.spells?.study ?? 0;
      prepareSpells(ch, cls, ids);
      ch.spells.memorized[cls] = keepMem;
      ch.spells.study = study;
      this.ctx.audio?.sfx?.('click');
      this._changed();
    } catch (err) {
      this.ctx.ui.toast(String(err.message ?? err));
    }
  }

  remove(k) {
    const ch = this.ch;
    const cls = this.cls;
    const ids = [...(ch.spells?.prepared?.[cls] ?? [])];
    const [id] = ids.splice(k, 1);
    const mem = [...(ch.spells?.memorized?.[cls] ?? [])];
    // Forget the memorized copy if the load-out no longer holds it.
    if (mem.filter((x) => x === id).length > ids.filter((x) => x === id).length) mem.splice(mem.indexOf(id), 1);
    prepareSpells(ch, cls, ids);
    ch.spells.memorized[cls] = mem;
    this.focus = id;
    this._changed();
  }

  clearAll() {
    const ch = this.ch;
    prepareSpells(ch, this.cls, []);
    ch.spells.memorized[this.cls] = [];
    this._changed(`${ch.name} clears the mind of spells.`, 'system');
  }

  auto() {
    const ch = this.ch;
    const keep = structuredClone(ch.spells.memorized ?? {});
    if (ch.spells.prepared) ch.spells.prepared[this.cls] = [];
    autoPrepare(ch);
    // Keep memorized copies that are still in the load-out.
    for (const [c, ids] of Object.entries(keep)) {
      const prep = [...(ch.spells.prepared?.[c] ?? [])];
      ch.spells.memorized[c] = ids.filter((id) => {
        const i = prep.indexOf(id);
        if (i < 0) return false;
        prep.splice(i, 1);
        return true;
      });
    }
    this._changed(`${ch.name} chooses spells for the morrow.`, 'system');
  }

  cast(id, target) {
    const ch = this.ch;
    const r = castSpell(this.ctx.rng, id, ch, [target], { consume: true, context: 'camp' });
    if (!r.ok) return this.ctx.ui.toast(r.reason ?? 'The spell fails.');
    this.ctx.audio?.sfx?.('spell');
    this._changed(r.log.join(' '), 'combat');
  }

  scribe(i, id) {
    const ch = this.ch;
    const hasRead = isMemorized(ch, 'readMagic');
    const r = scribeScroll(ch, i, id, { readMagic: hasRead, rng: this.ctx.rng });
    if (!r.ok) return this.ctx.ui.toast(r.reason ?? 'Cannot scribe that.');
    consumeMemorized(ch, 'readMagic');
    this._changed(`${ch.name} scribes ${getSpell(id).name} into the spell book.`, 'loot');
  }
}

/** Class line for a caster list ("Cleric 1"). */
export function casterLine(ch) {
  return `${classSpecName(ch.classSpec)} ${deriveStats(ch).levels}`;
}
