import './partyui.css';
import { h, clear } from '../dom.js';
import { ITEMS } from '../../data/items.js';
import { deriveStats, activeClasses } from '../../rules/character.js';
import { CLASSES, classSpecName, spellSlots } from '../../rules/classes.js';
import { knownSpells, slotsFor, freeSlots, prepareSpells, memorizationTime, partyMemorizationTime, autoPrepare, spellsToMemorize } from '../../rules/camp.js';
import { getSpell, spellLevel, spellsForClass, castProblem, castSpell, isMemorized, consumeMemorized, spellSummary } from '../../rules/spells.js';
import { scribeScroll } from '../../rules/magicItems.js';
import { itemName } from '../../rules/items.js';
import { miniPortrait, lore } from './CharacterSheet.js';
import { spellGlyphURL, spellFamilyName, familyColour } from './spellArt.js';
import { SPELLS as SPELL_DATA } from '../../data/spells.js';
import { intelligenceTable } from '../../rules/abilities.js';

const CASTERS = ['cleric', 'magicUser'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Casting classes a character can currently use. */
/** Compact class line for narrow lists: Fighter, Cleric, Magic-User; F/MU, C/MU/T for multi-classes. */
function shortClass(spec) {
  const parts = String(spec).split('/');
  if (parts.length === 1) return classSpecName(spec);
  const AB = { fighter: 'F', cleric: 'C', magicUser: 'MU', thief: 'T' };
  return parts.map((p) => AB[p] ?? p[0].toUpperCase()).join('/');
}

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
  return { title: `${s.name} · ${spellFamilyName(id)} · ${CLASSES[cls]?.name ?? ''} level ${spellLevel(id, cls)}`, text: `${s.tip ?? ''} ${s.flavor && s.flavor !== s.tip ? s.flavor : ''} (${where})`.trim() };
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
          tabindex: '0', dataset: { nav: '1' },
          onclick: () => { if (cc.length || this.o.lockMember) { this.setMember(i); this.o.onSelectMember?.(i); } },
        }, [
          miniPortrait(c),
          h('div', [h('div.nm', [c.name]), h('div.cl', { dataset: { tip: classSpecName(c.classSpec) } }, [cc.length ? `${shortClass(c.classSpec)} · ${mem} ready` : 'no spells'])]),
        ]);
      })),
      h('div', { style: { flex: '1' } }),
      this._schools(ch, classes),
      this._grimoire(ch, classes),
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
        lists.push(h(`div.pc-spell${this.focus === id ? '.sel' : ''}${full && !count ? '.full' : ''}`, {
          tabindex: '0', dataset: { ...lore(spellTip(id, cls)), nav: '1' },
          onmouseenter: () => this._swapCard(id, cls),
          onfocus: () => this._swapCard(id, cls),
          onclick: () => { this.focus = id; if (!full) this.add(id); else { this.ctx.ui.toast(`No free level ${ROMAN[i + 1]} slots — remove a spell first.`); this.render(); } },
        }, [
          h('img.gl', { src: spellGlyphURL(id), alt: '' }),
          h('span', [h('div.nm', [sp.name]), h('div.tg', [sp.tip ?? ''])]),
          h('span.ct', [count ? `×${count}` : '']),
        ]));
      }
    });
    if (!lists.length) lists.push(h('div.pc-rest-note', ['No spells known.']));
    // The road ahead: the next spell levels, locked, with the class level that opens them.
    const lvlNow = ch.levels?.[cls] ?? 1;
    for (let L = slots.length + 1; L <= Math.min(3, slots.length + 2); L++) {
      let at = lvlNow;
      while (at < 20 && spellSlots(cls, at).length < L) at++;
      const pool = spellsForClass(cls, L);
      lists.push(h('div.pc-lvl-h.locked', [h('span', [`Level ${ROMAN[L]}`]), h('span.lk', [`opens at ${CLASSES[cls].name.toLowerCase()} level ${at}`])]));
      if (cls === 'cleric') {
        for (const id of pool) {
          const sp = getSpell(id);
          lists.push(h('div.pc-spell.locked', { tabindex: '0', dataset: { ...lore(spellTip(id, cls)), nav: '1' }, onmouseenter: () => this._swapCard(id, cls), onfocus: () => this._swapCard(id, cls) }, [
            h('img.gl', { src: spellGlyphURL(id, { dim: true }), alt: '' }),
            h('span', [h('div.nm', [sp?.name ?? id]), h('div.tg', [sp?.tip ?? ''])]),
            h('span.ct', ['']),
          ]));
        }
      } else {
        lists.push(h('div.pc-locked-note', [`${pool.length} spells of this circle exist in Phlan — find them on scrolls and SCRIBE them into the book (INT ${ch.abilities?.int ?? '?'}: ${intelligenceTable(ch.abilities?.int ?? 10).knowChance ?? '—'}% to learn each).`]));
        for (const id of pool.slice(0, 6)) {
          const sp = getSpell(id);
          lists.push(h('div.pc-spell.locked', { tabindex: '0', dataset: { ...lore(spellTip(id, cls)), nav: '1' }, onmouseenter: () => this._swapCard(id, cls), onfocus: () => this._swapCard(id, cls) }, [
            h('img.gl', { src: spellGlyphURL(id, { dim: true }), alt: '' }),
            h('span', [h('div.nm', [sp?.name ?? id]), h('div.tg', [ch.spells?.book?.includes(id) ? 'in the book' : 'not yet in the book'])]),
            h('span.ct', ['']),
          ]));
        }
      }
    }
    const knownCol = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, [
      sub,
      h('div.pc-sect-h.left', [h('span', [`${cls === 'cleric' ? 'Prayers granted by the gods' : 'Spells in the book'} · click to memorize`])]),
      h('div.pc-spell-scroll', lists),
      (this._card = this._spellCard(this.focus && known.includes(this.focus) ? this.focus : prepared[0] ?? known[0], cls)),
    ]);

    // ---- load-out
    const memo = [...(ch.spells?.memorized?.[cls] ?? [])];
    const rows = prepared.map((id, k) => {
      const mi = memo.indexOf(id);
      const ready = mi >= 0;
      if (ready) memo.splice(mi, 1);
      const sp = getSpell(id);
      return h(`div.pc-spell${this.focus === id ? '.sel' : ''}`, { tabindex: '0', dataset: { ...lore(spellTip(id, cls)), nav: '1' }, onclick: () => this.remove(k) }, [
        h('img.gl', { src: spellGlyphURL(id, { dim: !ready }), alt: '' }),
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
        this._sockets(ch, cls, slots, prepared),
        h('div.pc-spell-scroll.pc-memo-list', rows.length ? rows : [h('div.empty', ['No spells chosen. Pick from the list, or AUTO.'])]),
        this._ladder(ch, cls),
        this._restPlan(partyNeed),
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

  /** Spells per day as the caster rises: the 1e table for levels 1-6, the current level lit. */
  _ladder(ch, cls) {
    const now = ch.levels?.[cls] ?? 1;
    const bonus = slotsFor(ch, cls).map((n, i) => n - (spellSlots(cls, now)[i] ?? 0));
    const lv = [1, 2, 3, 4, 5, 6];
    const cols = lv.map((L) => spellSlots(cls, L));
    return h('div.pc-ladder', { dataset: lore({ title: 'Spells per day', text: `${CLASSES[cls].name} spell slots by experience level (Phlan trains to 6th). ${cls === 'cleric' ? 'High wisdom adds bonus prayers at each level (shown with +).' : 'Magic-users must also know a spell (scribed into the book) to memorize it.'}` }) }, [
      h('div.h', ['Spells per day by level']),
      h('table', [
        h('tr', [h('th', ['']), ...lv.map((L) => h(`th${L === now ? '.now' : ''}`, [String(L)]))]),
        ...[0, 1, 2].map((si) => h('tr', [h('th', [ROMAN[si + 1]]), ...cols.map((c, k) => {
          const n = c[si] ?? 0;
          const b = lv[k] === now && bonus[si] > 0 ? bonus[si] : 0;
          return h(`td${lv[k] === now ? '.now' : ''}${n ? '' : '.z'}`, [n ? `${n}${b ? `+${b}` : ''}` : '·']);
        })])),
      ]),
    ]);
  }

  /** The one spell-detail surface follows the pointer / keyboard focus. */
  _swapCard(id, cls) {
    if (!this._card?.isConnected || this._cardId === id) return;
    const next = this._spellCard(id, cls);
    this._card.replaceWith(next);
    this._card = next;
  }

  /** The focused spell, illuminated: glyph, family, level, range, area, duration, save and lore. */
  _spellCard(id, cls) {
    if (!id) return null;
    const sp = getSpell(id);
    const d = SPELL_DATA[id] ?? {};
    // Range/area/duration/save come from the rules at this caster's level, so the card shows what the engine does.
    const sum = spellSummary(id, cls, this.ch?.levels?.[cls] ?? 1);
    const save = sum?.save ?? ({ none: 'none', 'neg:sp': 'spell negates', 'half:sp': 'spell for half', 'neg:ppdm': 'poison negates' }[d.save] ?? d.save ?? 'none');
    const where = sum?.usable ?? { both: 'combat or camp', combat: 'combat only', camp: 'camp only' }[sp?.usable ?? d.usable] ?? '';
    this._cardId = id;
    return h('div.pc-spellcard', [
      h('img', { src: spellGlyphURL(id), alt: '' }),
      h('div.body', [
        h('div.t', [sp?.name ?? id]),
        h('div.s', [`${spellFamilyName(id)} · ${CLASSES[cls]?.name ?? ''} level ${ROMAN[spellLevel(id, cls)]} · ${where}`]),
        h('div.kv', [['Range', sum?.range ?? d.range ?? '—'], ['Area', sum?.area ?? d.area ?? 'one'], ['Duration', sum?.duration ?? d.duration ?? 'instant'], ['Save', save], ...(sum ? [['Cast', sum.castTime]] : [])].map(([k, v]) => h('span', [h('b', [k]), ` ${v}`]))),
        h('div.d', [sp?.flavor && sp.flavor !== sp.tip ? sp.flavor : sp?.tip ?? d.desc ?? '']),
      ]),
    ]);
  }

  /** Memorization sockets per spell level: filled with the chosen spells' glyphs (dim until memorized). */
  _sockets(ch, cls, slots, prepared) {
    const memo = [...(ch.spells?.memorized?.[cls] ?? [])];
    const rows = [];
    slots.forEach((n, i) => {
      if (!n) return;
      const lvl = i + 1;
      const picks = prepared.map((id, k) => [id, k]).filter(([id]) => spellLevel(id, cls) === lvl);
      const cells = Array.from({ length: n }, (_, j) => {
        const p = picks[j];
        if (!p) return h('span.pc-socket.empty', { dataset: { tip: `Empty level ${ROMAN[lvl]} slot — pick a spell` } });
        const [id, k] = p;
        const mi = memo.indexOf(id);
        const ready = mi >= 0;
        if (ready) memo.splice(mi, 1);
        return h(`span.pc-socket${ready ? '.ready' : '.pending'}`, { tabindex: '0', dataset: { nav: '1', tip: `${getSpell(id)?.name ?? id}${ready ? ' — memorized' : ' — memorized after rest'} (click to remove)` }, onclick: () => this.remove(k) }, [
          h('img', { src: spellGlyphURL(id, { dim: !ready }), alt: '' }),
        ]);
      });
      rows.push(h('div.pc-socket-row', [h('span.lv', [ROMAN[lvl]]), h('span.cells', cells), h('span.ct', [`${picks.length}/${n}`])]));
    });
    return h('div.pc-sockets', rows);
  }

  /** The schools of what this caster knows, each with its enamel colour and how many spells. */
  _schools(ch, classes) {
    if (!classes.length) return null;
    const count = new Map();
    for (const cl of classes) for (const id of knownSpells(ch, cl)) { const f = spellFamilyName(id); count.set(f, (count.get(f) ?? 0) + 1); }
    if (!count.size) return null;
    return h('div.pc-schools', [
      h('div.h', ['Schools known']),
      ...[...count].map(([f, n]) => h('div.r', { dataset: { tip: `${n} ${f.toLowerCase()} spell${n === 1 ? '' : 's'} known` } }, [h('i', { style: { background: familyColour(f) } }), h('span', [f]), h('b', [String(n)])])),
    ]);
  }

  /** The caster's book or prayer roll: a small illuminated grimoire with what they know. */
  _grimoire(ch, classes) {
    if (!classes.length) return null;
    const arcane = classes.includes('magicUser');
    const c = grimoireCanvas(arcane, ch.name ?? '');
    const known = classes.map((cl) => knownSpells(ch, cl).length).reduce((a, b) => a + b, 0);
    const int = intelligenceTable(ch.abilities?.int ?? 10);
    return h('div.pc-grimoire', [
      h('img', { src: c.toDataURL(), alt: '' }),
      h('div.cap', [arcane ? `Spell book · ${ch.spells?.book?.length ?? known} spells` : `Prayers · ${known} granted`]),
      h('div.sub', [arcane ? `INT ${ch.abilities?.int ?? '?'}: learns to level ${int.maxSpellLevel ?? '—'}, ${int.knowChance ?? '—'}% to know` : `WIS ${ch.abilities?.wis ?? '?'}: bonus prayers for high wisdom`]),
    ]);
  }

  /**
   * The night's rest as a timeline: for each caster, the hours of sleep the
   * 1e rules ask for, then their study, against the party's one rest length
   * (the same number as the camp panel and the REST button).
   */
  _restPlan(partyNeed) {
    const party = this.ctx.game.party;
    const casters = party.filter((c) => castingClassesOf(c).length);
    if (!casters.length) return null;
    const span = Math.max(partyNeed, 240);
    const hours = Math.ceil(span / 60);
    const pct = (m) => `${Math.min(100, (m / (hours * 60)) * 100).toFixed(2)}%`;
    const rows = casters.map((c) => {
      const need = memorizationTime(c);
      const todo = spellsToMemorize(c);
      const n = Object.values(todo).flat().length;
      const levels = Object.entries(todo).reduce((a, [cl, ids]) => a + ids.reduce((b, id) => b + spellLevel(id, cl), 0), 0);
      const study = Math.min(need, 15 * levels);
      const sleep = Math.max(0, need - study);
      return h(`div.pc-plan-row${c === this.ch ? '.me' : ''}`, { dataset: { tip: need ? `${c.name}: ${fmtMinutes(sleep)} of sleep, then ${fmtMinutes(study)} of study for ${n} spell${n === 1 ? '' : 's'}.` : `${c.name} has nothing to memorize.` } }, [
        h('span.nm', [c.name.split(' ').pop()]),
        h('span.bar', [
          need ? h('i.sleep', { style: { width: pct(sleep) } }) : null,
          need ? h('i.study', { style: { left: pct(sleep), width: pct(study) } }) : h('i.done', { style: { width: '100%' } }),
        ]),
        h('span.t', [need ? fmtMinutes(need) : '—']),
      ]);
    });
    return h('div.pc-plan', [
      h('div.pc-plan-h', [h('span', ['Tonight\'s rest']), h('span.k', [h('i.sleep'), 'sleep', h('i.study'), 'study'])]),
      ...rows,
      h('div.pc-plan-axis', Array.from({ length: hours + 1 }, (_, i) => h('span', { style: { left: pct(i * 60) } }, [`${i}h`]))),
    ]);
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
      }, [h('img.gl', { src: spellGlyphURL(id, { dim: !!prob }), alt: '' }), h('span', [h('div.nm', [sp.name]), h('div.tg', [prob ?? sp.tip ?? ''])]), h('span.ct', [`×${mem.filter((x) => x === id).length}`])]);
    });
    const left = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, [
      sub,
      h('div.pc-sect-h.left', [h('span', ['Memorized spells'])]),
      h('div.pc-spell-scroll', rows.length ? rows : [
        h('div.pc-cast-empty', [
          h('div.t', ['Nothing in memory']),
          h('p', [`${ch.name}'s mind is empty of ${cls === 'cleric' ? 'prayers' : 'spells'}. These return after tonight's rest:`]),
          ...(ch.spells?.prepared?.[cls] ?? []).map((pid) => h('div.pc-spell.ghost', { dataset: lore(spellTip(pid, cls)) }, [h('img.gl', { src: spellGlyphURL(pid, { dim: true }), alt: '' }), h('span', [h('div.nm', [getSpell(pid).name]), h('div.tg', ['after rest'])]), h('span.ct', [''])])),
          this.o.onRest ? h('button.por-btn.primary', { style: { marginTop: '0.8em' }, onclick: () => this.o.onRest?.() }, ['Rest and memorize']) : null,
        ]),
      ]),
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
        h('img.gl', { src: spellGlyphURL(id), alt: '' }),
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

const grimoires = new Map();
/**
 * The caster's open book, painted: a tooled leather binding (oxblood for a mage's spell book,
 * umber for a priest's prayer book) with gilt corner pieces; a thick block of vellum pages that
 * curve into the gutter, darker there and toward the fore-edge; hand-ruled lines of uneven script;
 * an illuminated initial; the mage's warding diagram or the scales of Tyr in red and gold; a silk
 * ribbon; brushed light from the upper left and a grain over everything. 440×240, cached.
 */
function grimoireCanvas(arcane, seedName) {
  const key = arcane ? 'm' : 'p';
  if (grimoires.has(key)) return grimoires.get(key);
  const W = 440, H = 240;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = arcane ? 17 : 29;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cx = 220;
  // shadow on the table
  const sh = g.createRadialGradient(cx, 214, 20, cx, 214, 210);
  sh.addColorStop(0, 'rgba(0,0,0,0.6)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.beginPath(); g.ellipse(cx, 214, 210, 22, 0, 0, Math.PI * 2); g.fill();
  // the binding
  const cover = arcane ? ['#5a1a16', '#2a0a08'] : ['#4a3418', '#21160a'];
  const cg = g.createLinearGradient(0, 30, 0, 220);
  cg.addColorStop(0, cover[0]); cg.addColorStop(1, cover[1]);
  g.fillStyle = cg;
  g.beginPath(); g.moveTo(12, 40); g.quadraticCurveTo(cx, 10, W - 12, 40); g.lineTo(W - 12, 212); g.quadraticCurveTo(cx, 190, 12, 212); g.closePath(); g.fill();
  // gilt tooling along the binding's edge and corner pieces
  g.strokeStyle = 'rgba(216,178,90,0.55)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(20, 46); g.quadraticCurveTo(cx, 18, W - 20, 46); g.stroke();
  g.beginPath(); g.moveTo(20, 206); g.quadraticCurveTo(cx, 185, W - 20, 206); g.stroke();
  for (const [x, y, sx] of [[14, 40, 1], [W - 14, 40, -1], [14, 212, 1], [W - 14, 212, -1]]) {
    const gg = g.createLinearGradient(x, y - 10, x + sx * 22, y + 10);
    gg.addColorStop(0, '#f8e2a0'); gg.addColorStop(0.5, '#a8782a'); gg.addColorStop(1, '#5a3a10');
    g.fillStyle = gg;
    g.beginPath(); g.moveTo(x, y - (y < 100 ? 0 : 0)); g.lineTo(x + sx * 24, y + (y < 100 ? -2 : 2)); g.lineTo(x, y + (y < 100 ? 22 : -22)); g.closePath(); g.fill();
  }
  // page block: stacked page edges, then the two curved leaves
  for (const side of [-1, 1]) {
    for (let k = 4; k >= 0; k--) {
      g.fillStyle = k % 2 ? '#bfa778' : '#d8c497';
      g.beginPath();
      g.moveTo(cx, 30 + k); g.quadraticCurveTo(cx + side * 100, 16 + k, cx + side * 196 + side * k * 0.5, 30 + k);
      g.lineTo(cx + side * 196 + side * k * 0.5, 200 + k * 1.2); g.quadraticCurveTo(cx + side * 100, 186 + k, cx, 200 + k);
      g.closePath(); g.fill();
    }
    const pg = g.createLinearGradient(cx, 0, cx + side * 192, 0);
    pg.addColorStop(0, '#8a7448'); pg.addColorStop(0.07, '#cdb78a'); pg.addColorStop(0.2, '#efe2c0'); pg.addColorStop(0.75, '#e6d5ae'); pg.addColorStop(1, '#c7b082');
    g.fillStyle = pg;
    g.beginPath();
    g.moveTo(cx, 26); g.quadraticCurveTo(cx + side * 98, 12, cx + side * 192, 26);
    g.lineTo(cx + side * 192, 194); g.quadraticCurveTo(cx + side * 98, 180, cx, 194); g.closePath(); g.fill();
    // light from the upper left: the left leaf a touch brighter, the right cooler toward its edge
    if (side > 0) { g.fillStyle = 'rgba(40,40,70,0.08)'; g.fill(); }
    // script: ruled lines of uneven words, an indent under the initial, a rubric line in red
    for (let line = 0, y = 48; y < 180; y += 10, line++) {
      let x = cx + side * (side < 0 && y < 92 ? 70 : 20);
      const end = cx + side * (178 - (R() * 26));
      const curve = (xx) => y - 7 * Math.sin(Math.PI * Math.abs(xx - cx) / 192) * (1 - Math.abs(y - 110) / 140);
      while ((side > 0 ? x < end : x > end)) {
        const wlen = 6 + R() * 18;
        const x2 = x + side * wlen;
        g.strokeStyle = line === 6 && side > 0 ? 'rgba(140,30,20,0.75)' : `rgba(52,34,18,${0.55 + R() * 0.25})`;
        g.lineWidth = 1.5 + R() * 0.6;
        g.beginPath();
        g.moveTo(x, curve(x));
        for (let t = 1; t <= 4; t++) { const xx = x + (x2 - x) * t / 4; g.lineTo(xx, curve(xx) + (R() - 0.5) * 1.4); }
        g.stroke();
        x = x2 + side * (3 + R() * 3);
      }
    }
  }
  // illuminated initial on the left leaf
  const ix = 62, iy = 48;
  const ig = g.createLinearGradient(ix, iy, ix + 46, iy + 46);
  ig.addColorStop(0, arcane ? '#4a6ac8' : '#c8402a'); ig.addColorStop(1, arcane ? '#1a2a6a' : '#5a1408');
  g.fillStyle = ig; g.fillRect(ix, iy, 46, 46);
  g.strokeStyle = '#e8c46a'; g.lineWidth = 2.2; g.strokeRect(ix + 1, iy + 1, 44, 44);
  g.fillStyle = '#f6dc8a'; g.font = 'bold 34px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(arcane ? 'M' : 'P', ix + 23, iy + 25);
  g.strokeStyle = 'rgba(232,196,106,0.7)'; g.lineWidth = 1;
  for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(ix + 46 + 6 + k * 5, iy + 6 + k * 8, 2, 0, Math.PI * 2); g.stroke(); }
  // the right leaf's emblem
  g.save();
  g.translate(cx + 98, 98);
  if (arcane) {
    g.strokeStyle = 'rgba(30,50,130,0.8)'; g.lineWidth = 1.8;
    g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 25, Math.sin(a) * 25); g.lineTo(Math.cos(a) * 34, Math.sin(a) * 34); g.stroke(); }
    g.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 24, Math.sin(a) * 24); } g.closePath(); g.stroke();
    g.fillStyle = 'rgba(160,30,20,0.85)'; g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
  } else {
    // the scales of Tyr on a gilt sunburst
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      g.strokeStyle = `rgba(190,140,50,${k % 2 ? 0.45 : 0.7})`; g.lineWidth = k % 2 ? 1.2 : 2;
      g.beginPath(); g.moveTo(Math.cos(a) * 24, Math.sin(a) * 24); g.lineTo(Math.cos(a) * (k % 2 ? 34 : 42), Math.sin(a) * (k % 2 ? 34 : 42)); g.stroke();
    }
    g.strokeStyle = '#7a1a10'; g.fillStyle = '#7a1a10'; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(0, -30); g.lineTo(0, 26); g.stroke();
    g.beginPath(); g.moveTo(-15, 28); g.lineTo(15, 28); g.stroke();
    g.beginPath(); g.moveTo(-28, -18); g.lineTo(28, -18); g.stroke();
    g.beginPath(); g.arc(0, -32, 4.4, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1.5;
    for (const sx of [-24, 24]) {
      g.beginPath(); g.moveTo(sx, -18); g.lineTo(sx - 9, 4); g.moveTo(sx, -18); g.lineTo(sx + 9, 4); g.stroke();
      g.beginPath(); g.moveTo(sx - 11, 4); g.quadraticCurveTo(sx, 15, sx + 11, 4); g.closePath(); g.fill();
    }
  }
  g.restore();
  // the gutter's deep shadow, and the silk ribbon
  const gut = g.createLinearGradient(cx - 22, 0, cx + 22, 0);
  gut.addColorStop(0, 'rgba(40,24,8,0)'); gut.addColorStop(0.5, 'rgba(40,24,8,0.45)'); gut.addColorStop(1, 'rgba(40,24,8,0)');
  g.fillStyle = gut; g.fillRect(cx - 22, 20, 44, 180);
  const rb = g.createLinearGradient(cx + 6, 0, cx + 18, 0);
  rb.addColorStop(0, '#5a0a0a'); rb.addColorStop(0.5, '#b02a20'); rb.addColorStop(1, '#4a0808');
  g.fillStyle = rb;
  g.beginPath(); g.moveTo(cx + 6, 186); g.lineTo(cx + 18, 186); g.lineTo(cx + 22, 232); g.lineTo(cx + 15, 224); g.lineTo(cx + 9, 233); g.closePath(); g.fill();
  // vellum grain and a soft vignette of handling
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 8) continue;
      const hh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const n = (hh - Math.floor(hh) - 0.5) * 10;
      const blot = Math.sin(x * 0.045 + Math.sin(y * 0.06) * 2) * Math.sin(y * 0.05 + 1.3) * 6;
      d[i] = Math.max(0, Math.min(255, d[i] + n + blot)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n + blot * 0.9)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.8 + blot * 0.7));
    }
  }
  g.putImageData(img, 0, 0);
  void seedName;
  grimoires.set(key, c);
  return c;
}
