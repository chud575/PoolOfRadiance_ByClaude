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
import { spellGlyphURL, spellFamilyName } from './spellArt.js';
import { SPELLS as SPELL_DATA } from '../../data/spells.js';
import { intelligenceTable } from '../../rules/abilities.js';

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
          h('div', [h('div.nm', [c.name]), h('div.cl', [cc.length ? `${cc.map((x) => CLASSES[x].name).join(' / ')} · ${mem} ready` : 'no spells'])]),
        ]);
      })),
      h('div', { style: { flex: '1' } }),
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
    const save = { none: 'none', 'neg:sp': 'spell negates', 'half:sp': 'spell for half', 'neg:ppdm': 'poison negates' }[d.save] ?? d.save ?? 'none';
    const where = { both: 'combat or camp', combat: 'combat only', camp: 'camp only' }[sp?.usable ?? d.usable] ?? '';
    this._cardId = id;
    return h('div.pc-spellcard', [
      h('img', { src: spellGlyphURL(id), alt: '' }),
      h('div.body', [
        h('div.t', [sp?.name ?? id]),
        h('div.s', [`${spellFamilyName(id)} · ${CLASSES[cls]?.name ?? ''} level ${ROMAN[spellLevel(id, cls)]} · ${where}`]),
        h('div.kv', [['Range', d.range ?? '—'], ['Area', d.area ?? 'one'], ['Duration', d.duration ?? 'instant'], ['Save', save]].map(([k, v]) => h('span', [h('b', [k]), ` ${v}`]))),
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

  /** The caster's book or prayer roll: a small illuminated grimoire with what they know. */
  _grimoire(ch, classes) {
    if (!classes.length) return null;
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 120;
    const g = c.getContext('2d');
    const arcane = classes.includes('magicUser');
    // Open book: two pages with ruled text, an illuminated initial, a ribbon.
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath(); g.ellipse(110, 108, 100, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = arcane ? '#3a1414' : '#2a2416';
    g.beginPath(); g.moveTo(8, 18); g.quadraticCurveTo(110, 4, 212, 18); g.lineTo(212, 104); g.quadraticCurveTo(110, 92, 8, 104); g.closePath(); g.fill();
    for (const side of [-1, 1]) {
      const pg = g.createLinearGradient(110, 0, 110 + side * 98, 0);
      pg.addColorStop(0, '#b8a37a'); pg.addColorStop(0.12, '#ecdcb6'); pg.addColorStop(1, '#d6c293');
      g.fillStyle = pg;
      g.beginPath();
      g.moveTo(110, 14); g.quadraticCurveTo(110 + side * 50, 6, 110 + side * 96, 14);
      g.lineTo(110 + side * 96, 98); g.quadraticCurveTo(110 + side * 50, 90, 110, 98); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(70,40,20,0.35)';
      g.lineWidth = 1;
      for (let y = 26; y < 92; y += 6) {
        g.beginPath();
        const x0 = 110 + side * (y < 46 && side < 0 ? 36 : 12);
        g.moveTo(x0, y + (side < 0 ? 0 : 0));
        g.lineTo(110 + side * (88 - ((y * 7) % 13)), y);
        g.stroke();
      }
    }
    // Illuminated initial and a little diagram.
    g.fillStyle = arcane ? '#2a4a9a' : '#9a2a1a';
    g.fillRect(28, 22, 22, 22);
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 1.5;
    g.strokeRect(28, 22, 22, 22);
    g.fillStyle = '#f0d27a';
    g.font = 'bold 18px serif';
    g.fillText(arcane ? 'M' : 'P', 32, 40);
    g.strokeStyle = arcane ? 'rgba(40,60,140,0.7)' : 'rgba(140,40,20,0.7)';
    g.beginPath(); g.arc(160, 52, 18, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * (Math.PI * 4 / 5); g[k ? 'lineTo' : 'moveTo'](160 + Math.cos(a) * 18, 52 + Math.sin(a) * 18); }
    g.closePath(); g.stroke();
    g.fillStyle = '#8a1a1a';
    g.fillRect(118, 92, 6, 22);
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
