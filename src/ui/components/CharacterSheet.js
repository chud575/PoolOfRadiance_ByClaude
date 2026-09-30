import './partyui.css';
import { h } from '../dom.js';
import { deriveStats, statusLabel, maxLevel } from '../../rules/character.js';
import { ABILITIES, ABILITY_ABBR, formatStr, strengthTable, dexterityMods, constitutionTable, intelligenceTable, wisdomSaveAdj, charismaTable } from '../../rules/abilities.js';
import { RACES } from '../../rules/races.js';
import { CLASSES, ALIGNMENT_NAMES, SAVE_KEYS, SAVE_SHORT, THIEF_SKILL_IDS, THIEF_SKILL_NAMES, splitClasses, xpForLevel } from '../../rules/classes.js';
import { describeEffects } from '../../rules/conditions.js';
import { itemName } from '../../rules/items.js';
import { spellLevel } from '../../rules/spells.js';
import { ITEMS } from '../../data/items.js';
import { itemIconURL, iconFor } from './itemIcons.js';
import { portraitURL } from './portraitPainter.js';
import { abilityTip, STAT_TIPS } from './rulesText.js';
import { miniatureSnapshot } from './Miniature.js';

const sgn = (n) => (n > 0 ? `+${n}` : String(n));
const ORD = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/**
 * Framed painted portrait element.
 * @param {object} ch character (or creation draft with race/gender/classSpec/look)
 * @param {{scale?:number, className?:string}} [o]
 */
export function portraitEl(ch, o = {}) {
  const st = ch.status === 'dead' ? '.dead' : ch.status && ch.status !== 'ok' ? '.down' : '';
  return h(`div.pc-portrait${st}`, { class: o.className ?? '' }, [h('img', { src: portraitURL(ch, o.scale ?? 1), alt: ch.name ?? 'portrait', draggable: false })]);
}

/** Small portrait (roster strips). */
export function miniPortrait(ch, { selected = false, onclick, tip } = {}) {
  return h(`div.pc-mini${selected ? '.sel' : ''}${ch.status === 'dead' ? '.dead' : ''}`, { onclick, dataset: tip ? { tip } : {} }, [
    h('img', { src: portraitURL(ch, 0.4), alt: ch.name, draggable: false }),
  ]);
}

/** Lore attribute helper: {dataset:{lore:'title|text'}} */
export function lore(t) {
  return { lore: `${t.title}|${t.text}` };
}

/** Short one-line modifiers per ability for sheet rows. */
export function abilityMods(k, a, classSpec) {
  const fighter = splitClasses(classSpec).includes('fighter');
  switch (k) {
    case 'str': { const t = strengthTable(a.str, a.strPct); return `hit ${sgn(t.hit)} · dmg ${sgn(t.dmg)} · carry ${sgn(t.weight)}`; }
    case 'int': { const t = intelligenceTable(a.int); return t.maxSpellLevel ? `spells to L${t.maxSpellLevel} · learn ${t.knowChance}%` : 'cannot learn spells'; }
    case 'wis': return `mind saves ${sgn(wisdomSaveAdj(a.wis))}`;
    case 'dex': { const t = dexterityMods(a.dex); return `AC ${sgn(t.ac)} · missile ${sgn(t.missile)}`; }
    case 'con': { const t = constitutionTable(a.con); return `hp ${sgn(fighter ? t.hpFighter : t.hp)}/die · shock ${t.systemShock}%`; }
    case 'cha': { const t = charismaTable(a.cha); return `reaction ${sgn(t.reaction)}% · ${t.henchmen} henchmen`; }
    default: return '';
  }
}

function sect(title, children, cls = '') {
  return h(`div.pc-sect${cls}`, [h('div.pc-sect-h', [h('span', [title])]), ...children]);
}

function kv(k, v, tip) {
  return [h('span.k', { dataset: tip ? lore(tip) : {} }, [k]), h('span.v', { dataset: tip ? lore(tip) : {} }, [String(v)])];
}

/**
 * The VIEW screen body: identity, abilities, class/level, combat, saves, skills.
 * @param {import('../../rules/character.js').Character} ch
 * @returns {HTMLElement}
 */
export function renderSheet(ch) {
  const s = deriveStats(ch);
  const a = s.abilities;
  const race = RACES[ch.race];
  const classes = splitClasses(ch.classSpec);

  // ---- identity column
  const effects = describeEffects(ch);
  const id = h('div.pc-id', [
    portraitEl(ch),
    h('div.pc-name.por-gilt-text', [ch.name]),
    h('div.pc-sub', [
      h('div', [h('b', [`${race.name} ${ch.gender === 'female' ? 'Female' : 'Male'}`]), ` · age ${ch.age}`]),
      h('div', { dataset: lore(STAT_TIPS.align(ch.alignment)) }, [ALIGNMENT_NAMES[ch.alignment]]),
    ]),
    h('div', { style: { textAlign: 'center' } }, [
      h(`span.pc-chip${ch.status === 'ok' ? '.good' : '.warn'}`, [statusLabel(ch)]),
      ...effects.filter((e) => e.kind !== 'status' || e.id !== 'ok').slice(0, 4).map((e) => h('span.pc-chip', { dataset: lore({ title: e.name, text: e.desc }) }, [e.name])),
    ]),
  ]);
  const icon = miniatureSnapshot(ch);
  if (icon) {
    id.append(h('div.pc-icon', { dataset: lore({ title: 'Combat icon', text: 'Your miniature on the battlefield, dressed in whatever is readied. Change its look with MODIFY at the party screen.' }) }, [
      h('img', { src: icon, alt: '', draggable: false }),
      h('span', ['Combat icon']),
    ]));
  }

  // ---- abilities + class
  const abil = sect('Abilities', ABILITIES.map((k) => {
    const v = a[k];
    const base = ch.abilities[k];
    const pct = Math.min(1, Math.max(0, ((k === 'str' && v === 18 ? 18 + (a.strPct || 0) / 100 : v) - 3) / 16));
    return h('div.pc-ab', { dataset: lore(abilityTip(k, a, ch.classSpec)) }, [
      h('span.abbr', [ABILITY_ABBR[k]]),
      h(`span.val${v >= 16 ? '.hi' : v <= 6 ? '.lo' : ''}`, [k === 'str' ? formatStr(v, a.strPct) : String(v), v !== base ? '*' : '']),
      h('span.mods', [abilityMods(k, a, ch.classSpec), h('span.bar', { style: { display: 'block' } }, [h('i', { style: { width: `${pct * 100}%` } })])]),
    ]);
  }));

  const clsRows = classes.map((c) => {
    const lvl = ch.levels[c] ?? 1;
    const xp = ch.xp[c] ?? 0;
    const cap = maxLevel(ch, c);
    const cur = xpForLevel(c, lvl);
    const next = lvl < cap ? xpForLevel(c, lvl + 1) : null;
    const pct = next ? Math.min(1, (xp - cur) / Math.max(1, next - cur)) : 1;
    return h('div.pc-cls', { dataset: lore(STAT_TIPS.xp(ch, c, next ? next - xp : 0)) }, [
      h('span.c', [CLASSES[c].name]),
      h('span.lv', [`Level ${lvl}`]),
      h('div.pc-bar.xp', [h('i', { style: { width: `${pct * 100}%` } })]),
      h('span.x', [next ? `${xp.toLocaleString('en-US')} XP · ${(next - xp).toLocaleString('en-US')} to ${ORD(lvl + 1)} level` : `${xp.toLocaleString('en-US')} XP · maximum level (${cap})`]),
    ]);
  });
  const cls = sect('Class & Level', clsRows);

  // ---- combat
  const hpPct = Math.max(0, ch.hp.cur) / Math.max(1, ch.hp.max);
  const combat = sect('Combat', [
    h('div.pc-bigrow', [
      h('div.pc-big', { dataset: lore(STAT_TIPS.hp(ch)) }, [h('span.n', [`${ch.hp.cur}`]), h('span.l', [`of ${ch.hp.max} HP`])]),
      h('div.pc-big', { dataset: lore(STAT_TIPS.ac(s)) }, [h('span.n', [String(s.ac)]), h('span.l', ['Armor Class'])]),
      h('div.pc-big', { dataset: lore(STAT_TIPS.thac0(s)) }, [h('span.n', [String(s.thac0)]), h('span.l', ['THAC0'])]),
    ]),
    h(`div.pc-bar${hpPct < 0.34 ? '.low' : ''}`, { style: { marginBottom: '0.6em' } }, [h('i', { style: { width: `${hpPct * 100}%` } })]),
    h('div.pc-kv', [
      ...kv('Weapon', s.weapon ? itemName(s.weaponEntry) : 'Bare hands', STAT_TIPS.damage(s)),
      ...kv('Damage', `${s.damage}${s.dmgBonus ? sgn(s.dmgBonus) : ''}`, STAT_TIPS.damage(s)),
      ...kv('To hit', sgn(s.hitBonus), STAT_TIPS.thac0(s)),
      ...kv('Attacks', `${s.attacks}/round`, STAT_TIPS.attacks(s)),
      ...kv('AC rear · missile', `${s.acRear ?? s.ac} · ${s.acMissile ?? s.ac}`, { title: 'Rear and missile armour class', text: 'Attacks from behind ignore the shield and dexterity bonus, and thieves may backstab: keep your fighters between the foe and your casters. Missile AC applies to arrows, bolts and sling stones.' }),
      ...kv('Movement', s.move, STAT_TIPS.move(s)),
      ...kv('Burden', `${s.weight} cn`, STAT_TIPS.enc(s)),
    ]),
    h('div.pc-bar.enc', { style: { marginTop: '0.5em' }, dataset: lore(STAT_TIPS.enc(s)) }, [
      h('i', { style: { width: `${Math.min(100, (s.weight / (s.encumbrance.next === Infinity ? s.weight : s.encumbrance.next)) * 100)}%` } }),
    ]),
    h('div', { style: { fontSize: '0.75em', color: 'var(--por-text-dim)', marginTop: '0.25em', textAlign: 'right' } }, [s.encumbrance.label]),
  ]);

  // ---- saves & skills
  const saves = sect('Saving Throws', [h('div.pc-kv', SAVE_KEYS.flatMap((k) => kv(SAVE_SHORT[k], s.saves[k], STAT_TIPS.save(k, s.saves[k]))))]);
  const extra = [];
  if (s.thief) {
    extra.push(sect('Thieving Skills', [h('div.pc-kv', THIEF_SKILL_IDS.flatMap((k) => kv(THIEF_SKILL_NAMES[k], `${s.thief[k]}%`, STAT_TIPS.thief(THIEF_SKILL_NAMES[k], s.thief[k])))),
      h('div', { style: { marginTop: '0.4em', fontSize: '0.8em', color: 'var(--por-text-dim)' } }, [`Backstab ×${s.backstab}`])]));
  }
  const casting = Object.entries(s.spellSlots);
  if (casting.length) {
    extra.push(sect('Spells per Day', casting.map(([c, slots]) => {
      const mem = ch.spells?.memorized?.[c] ?? [];
      return h('div', { style: { marginBottom: '0.4em' }, dataset: lore({ title: `${CLASSES[c].name} spells`, text: `Spell slots by level (filled diamonds are memorized now). ${c === 'cleric' ? 'Clerics may pray for any spell of their levels; high wisdom grants bonus spells.' : 'Magic-users memorize from their spell book and cannot cast in armour.'} Encamp and choose MAGIC to memorize.` }) }, [
        h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '0.78em', letterSpacing: '0.12em', color: 'var(--por-text-dim)', marginBottom: '0.2em' } }, [CLASSES[c].name.toUpperCase()]),
        h('div.pc-slots', slots.map((n, i) => (n ? h('span', { style: { marginRight: '0.6em' } }, [h('span', { style: { fontSize: '0.75em', color: 'var(--por-gilt)' } }, [`L${i + 1} `]),
          ...Array.from({ length: n }, (_, j) => h(`i.pc-pip${j < mem.filter((id) => spellLevel(id, c) === i + 1).length ? '.on' : ''}`))]) : null)).filter(Boolean)),
      ]);
    })));
  }
  const traits = [];
  if (race.infravision) traits.push(['Infravision', `${race.infravision}'`, 'Sees the heat of living things in darkness.']);
  if (race.resistSleepCharm) traits.push(['Sleep/charm resist', `${race.resistSleepCharm}%`, 'Chance to shrug off sleep and charm spells outright.']);
  if (race.saveBonusCon) traits.push(['Stout', 'saves', 'Bonus to saves against magic (and poison for dwarves and halflings), from constitution.']);
  if (race.missileBonus) traits.push(['Sling & bow', `+${race.missileBonus}`, 'Halflings are deadly with slings and bows.']);
  if (race.vsGiants) traits.push(['Giant-wary', '−4', 'Giants, ogres and trolls suffer −4 to hit this small folk.']);
  if (race.canDualClass) traits.push(['Dual class', 'able', 'Humans may abandon their class for a new one and later regain the old abilities.']);
  extra.push(sect('Racial Traits', [h('div.pc-kv', traits.flatMap(([k, v, t]) => kv(k, v, { title: k, text: t })))]));

  const gear = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]);
  const kit = sect('Readied', gear.length ? gear.map((e) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.6em', padding: '0.12em 0' }, dataset: lore({ title: itemName(e), text: `Readied ${ITEMS[e.id].type}. Open ITEMS to change equipment.` }) }, [
    h('img', { src: itemIconURL(iconFor(ITEMS[e.id])), alt: '', style: { width: '1.9em', height: '1.9em' } }),
    h('span', { style: { color: 'var(--por-text)' } }, [itemName(e), (e.qty ?? 1) > 1 ? ` ×${e.qty}` : '']),
  ])) : [h('div.pc-rest-note', ['Nothing readied.'])]);
  const langs = sect('Languages', [h('div', race.languages.map((l) => h('span.pc-chip', [l])))]);
  // ---- record: experience, limits, wealth
  const totalXp = classes.reduce((t, c) => t + (ch.xp[c] ?? 0), 0);
  const caps = classes.map((c) => `${CLASSES[c].name.split('-')[0]} ${maxLevel(ch, c)}`).join(' · ');
  const record = sect('Record', [h('div.pc-kv', [
    ...kv('Experience', totalXp.toLocaleString('en-US'), { title: 'Experience', text: 'Earned by defeating foes and recovering treasure. Multi-class characters split every award between their classes. Levels are gained by training at a hall once enough is banked.' }),
    ...kv('Level limit', caps, { title: 'Level limits', text: `Demi-humans are capped by race (and exceptional ability scores raise the cap). In the ruins of Phlan the Council's trainers teach only so far: fighters to 8th, clerics and magic-users to 6th, thieves to 9th.` }),
    ...kv('Training', '1,000 gp', { title: 'Training', text: 'A level-up costs 1,000 gold pieces at the Training Hall, one level per visit. Experience beyond one level short of the next is not banked.' }),
    ...kv('Purse', `${(ch.gold ?? 0).toLocaleString('en-US')} gp`, { title: 'Purse', text: 'Coins weigh 1 coin-weight (cn) each and count toward encumbrance. Pool gold or split it evenly from the ITEMS screen.' }),
  ])]);
  const side = [saves, ...extra.slice(0, 2)];
  if (side.length < 3) side.push(langs);
  return h('div.pc-sheet', [
    id,
    h('div.pc-col', [abil, cls, record]),
    h('div.pc-col', [combat, kit]),
    h('div.pc-col', side),
  ]);
}
