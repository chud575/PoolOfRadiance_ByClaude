import './partyui.css';
import { h } from '../dom.js';
import { deriveStats, statusLabel, maxLevel, armorAllowsThieving } from '../../rules/character.js';
import { ABILITIES, ABILITY_ABBR, formatStr, strengthTable, dexterityMods, constitutionTable, intelligenceTable, wisdomSaveAdj, charismaTable } from '../../rules/abilities.js';
import { RACES } from '../../rules/races.js';
import { CLASSES, ALIGNMENT_NAMES, SAVE_KEYS, SAVE_SHORT, THIEF_SKILL_IDS, THIEF_SKILL_NAMES, splitClasses, xpForLevel } from '../../rules/classes.js';
import { describeEffects } from '../../rules/conditions.js';
import { itemName } from '../../rules/items.js';
import { spellLevel } from '../../rules/spells.js';
import { ITEMS } from '../../data/items.js';
import { itemIconURL, iconFor } from './itemIcons.js';
import { portraitImg } from './lazyPortrait.js';
import { abilityTip, STAT_TIPS } from './rulesText.js';
import { miniatureSnapshot, useRenderer } from './Miniature.js';
import { ammoProblem, ammoHint } from './Inventory.js';

export { useRenderer };

const sgn = (n) => (n > 0 ? `+${n}` : String(n));
const ORD = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/**
 * Framed painted portrait element.
 * @param {object} ch character (or creation draft with race/gender/classSpec/look)
 * @param {{scale?:number, className?:string}} [o]
 */
export function portraitEl(ch, o = {}) {
  const st = ch.status === 'dead' ? '.dead' : ch.status && ch.status !== 'ok' ? '.down' : '';
  // Painted lazily (placeholder first, the hero portrait ahead of any thumbnails) so a click never stalls on the GPU.
  return h(`div.pc-portrait${st}`, { class: o.className ?? '' }, [portraitImg(ch, o.scale ?? 1, { alt: ch.name ?? 'portrait', priority: o.priority !== false })]);
}

/** Small portrait (roster strips). */
export function miniPortrait(ch, { selected = false, onclick, tip } = {}) {
  return h(`div.pc-mini${selected ? '.sel' : ''}${ch.status === 'dead' ? '.dead' : ''}`, { onclick, dataset: tip ? { tip } : {} }, [
    portraitImg(ch, 0.28, { alt: ch.name }),
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
    case 'str': { const t = strengthTable(a.str, a.strPct); return `hit ${sgn(t.hit)} · dmg ${sgn(t.dmg)} · ${sgn(t.weight)} cn`; }
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
    h('div.pc-idchips', { style: { textAlign: 'center' } }, [
      ch.status === 'ok' ? null : h('span.pc-chip.warn', [statusLabel(ch)]),
      ...effects.filter((e) => e.kind !== 'status' || e.id !== 'ok').slice(0, 4).map((e) => h('span.pc-chip', { dataset: lore({ title: e.name, text: e.desc }) }, [e.name])),
    ]),
  ]);
  const icon = miniatureSnapshot(ch, { w: 300, h: 400 });
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
    const armored = !armorAllowsThieving(ch);
    const armorName = itemName(ch.inventory.find((e) => e.equipped && ITEMS[e.id]?.type === 'armor') ?? { id: 'chainMail' });
    const SHORT = { pp: 'Pick pockets', ol: 'Open locks', ft: 'Traps', ms: 'Move silent', hs: 'Hide', hn: 'Hear noise', cw: 'Climb walls', rl: 'Read lang.' };
    extra.push(sect('Thieving Skills', [h('div.pc-kv.pc-kv-2', THIEF_SKILL_IDS.flatMap((k) => kv(SHORT[k] ?? THIEF_SKILL_NAMES[k], `${s.thief[k]}%`, STAT_TIPS.thief(THIEF_SKILL_NAMES[k], s.thief[k])))),
      armored ? h('div.pc-warn.soft', { dataset: lore({ title: 'Armour and thieving', text: `Thieving needs freedom of movement: in anything heavier than leather a thief cannot pick locks, find traps, move silently, hide or climb (0%). Hearing and reading are unaffected. Remove the ${armorName} in ITEMS to restore the skills.` }) }, [`0% — thieving requires leather armour (${armorName} worn)`]) : null,
      h('div', { style: { marginTop: '0.4em', fontSize: '0.8em', color: 'var(--por-text-dim)' } }, [`Backstab ×${s.backstab}`])].filter(Boolean)));
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
  traits.push(['Infravision', race.infravision ? `${race.infravision}'` : 'none', race.infravision ? 'Sees the heat of living things in darkness.' : 'Humans see only by torch, lantern and moon.']);
  if (race.resistSleepCharm) traits.push(['Sleep/charm resist', `${race.resistSleepCharm}%`, 'Chance to shrug off sleep and charm spells outright.']);
  if (race.saveBonusCon) traits.push(['Stout', 'saves', 'Bonus to saves against magic (and poison for dwarves and halflings), from constitution.']);
  if (race.missileBonus) traits.push(['Sling & bow', `+${race.missileBonus}`, 'Halflings are deadly with slings and bows.']);
  if (race.vsGiants) traits.push(['Giant-wary', '−4', 'Giants, ogres and trolls suffer −4 to hit this small folk.']);
  if (race.canDualClass) traits.push(['Dual class', 'able', 'Humans may abandon their class for a new one and later regain the old abilities.']);
  const abbr = (c) => c.split('/').map((x) => CLASSES[x].abbr ?? x[0].toUpperCase()).join('/');
  traits.push(['Classes', race.classes.length > 4 ? `${race.classes.length} paths` : race.classes.map(abbr).join(' · '), `${race.name} may follow: ${race.classes.map((c) => c.split('/').map((x) => CLASSES[x].name).join('/')).join(', ')}.`]);
  traits.push(['Racial level limit', ch.race === 'human' ? 'none' : 'yes', ch.race === 'human' ? 'Humans have no racial level limit; only the Phlan level cap (see RECORD) applies.' : 'Demi-humans reach only so far in each class by race; exceptional prime requisites raise the limit. The lower of this and the Phlan level cap applies (see RECORD).']);
  extra.push(sect('Racial Traits', [h('div.pc-kv', traits.flatMap(([k, v, t]) => kv(k, v, { title: k, text: t }))),
    h('div', { style: { marginTop: '0.45em' } }, race.languages.map((l) => h('span.pc-chip', { dataset: lore({ title: 'Languages', text: `${ch.name} speaks ${race.languages.join(', ')}. Intelligence allows more tongues to be learned.` }) }, [l])))]));

  const gear = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]);
  const ammoWarn = ammoProblem(ch);
  const kit = sect('Readied', [...(gear.length ? gear.map((e) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.6em', padding: '0.12em 0' }, dataset: lore({ title: itemName(e), text: `Readied ${ITEMS[e.id].type}. Open ITEMS to change equipment.` }) }, [
    h('img', { src: itemIconURL(iconFor(ITEMS[e.id])), alt: '', style: { width: '1.9em', height: '1.9em' } }),
    h('span', { style: { color: 'var(--por-text)' } }, [itemName(e), (e.qty ?? 1) > 1 ? ` ×${e.qty}` : '']),
  ])) : [h('div.pc-rest-note', ['Nothing readied.'])]), ammoHint(ch) ? h('div.pc-note', { dataset: lore({ title: 'Ammunition', text: 'Arrows sit readied in the quiver; READY the bow (it takes both hands, so the shield is slung) when you want to shoot.' }) }, [ammoHint(ch)]) : null, ammoWarn ? h('div.pc-warn', { dataset: lore({ title: 'Ammunition', text: 'Arrows need a bow and quarrels a crossbow readied in the weapon hand; otherwise they cannot be fired.' }) }, ['⚠ ', ammoWarn]) : null].filter(Boolean));
  const langs = sect('Languages', [h('div', race.languages.map((l) => h('span.pc-chip', [l])))]);
  // ---- record: experience, limits, wealth
  const totalXp = classes.reduce((t, c) => t + (ch.xp[c] ?? 0), 0);
  const caps = classes.map((c) => `${CLASSES[c].name.split('-')[0]} ${maxLevel(ch, c)}`).join(' · ');
  const record = sect('Record', [h('div.pc-kv', [
    ...kv('Experience', totalXp.toLocaleString('en-US'), { title: 'Experience', text: 'Earned by defeating foes and recovering treasure. Multi-class characters split every award between their classes. Levels are gained by training at a hall once enough is banked.' }),
    ...kv('Phlan level cap', caps, { title: 'Phlan level cap', text: `Demi-humans are capped by race (and exceptional ability scores raise the cap). In the ruins of Phlan the Council's trainers teach only so far: fighters to 8th, clerics and magic-users to 6th, thieves to 9th.` }),
    ...kv('Training', '1,000 gp', { title: 'Training', text: 'A level-up costs 1,000 gold pieces at the Training Hall, one level per visit. Experience beyond one level short of the next is not banked.' }),
    ...kv('Purse', `${(ch.gold ?? 0).toLocaleString('en-US')} gp`, { title: 'Purse', text: 'Coins weigh 1 coin-weight (cn) each and count toward encumbrance. Pool gold or split it evenly from the ITEMS screen.' }),
  ])]);
  // Condition: lingering effects, or a clean bill of health.
  const fx = effects.filter((e) => !(e.kind === 'status' && e.id === 'ok'));
  const cond = sect('Condition', fx.length
    ? fx.slice(0, 5).map((e) => h('div.pc-cond', { dataset: lore({ title: e.name, text: e.desc }) }, [h('span.n', [e.name]), h('span.d', [e.desc])]))
    : [h('div.pc-cond.ok', [h('span.n', [ch.hp.cur >= ch.hp.max ? 'Hale' : 'Wounded']), h('span.d', [ch.hp.cur >= ch.hp.max ? 'No wounds, curses or lingering magic.' : `Down ${ch.hp.max - ch.hp.cur} hp. Rest heals 1 hp a day; clerics heal faster.`])])]);
  // Pack summary: what is carried beyond the readied kit.
  const pack = ch.inventory.filter((e) => !e.equipped && ITEMS[e.id]);
  const packSect = sect('Pack', [
    h('div.pc-packline', pack.length ? pack.slice(0, 8).map((e) => h('span.pc-packi', { dataset: lore({ title: itemName(e), text: 'Carried in the pack. Open ITEMS to ready, use, trade or drop it.' }) }, [h('img', { src: itemIconURL(iconFor(ITEMS[e.id])), alt: '' }), (e.qty ?? 1) > 1 ? h('b', [String(e.qty)]) : null])) : [h('span.pc-rest-note', ['Nothing else carried.'])]),
    h('div.pc-rest-note', { style: { marginTop: '0.35em' } }, [`${pack.length} item${pack.length === 1 ? '' : 's'} in the pack · ${s.weight} cn carried`]),
  ]);
  // Spells per day sit under the readied kit, so the right column never overflows on casters.
  const spellSect = casting.length ? extra.find((x) => x.textContent.startsWith('Spells per Day')) : null;
  const rest = extra.filter((x) => x !== spellSect);
  const side = [saves, ...rest];
  void langs;
  // A clean bill of health is a chip in the identity column; only real conditions take a card.
  if (fx.length || ch.hp.cur < ch.hp.max) side.push(cond);
  else id.querySelector('.pc-idchips')?.prepend(h('span.pc-chip.ok', { dataset: lore({ title: 'Hale', text: 'No wounds, curses or lingering magic.' }) }, ['Hale']));
  // The pack summary sits under the readied kit when there is no spell table there; otherwise at the end of the side column.
  const packInMiddle = !spellSect && !!s.thief;
  if (!packInMiddle) side.push(packSect);
  const sheet = h('div.pc-sheet', [
    id,
    h('div.pc-col', [abil, cls, record]),
    h('div.pc-col', [combat, kit, spellSect, packInMiddle ? packSect : null].filter(Boolean)),
    h('div.pc-col.pc-col-scroll', side),
  ]);
  // Every rules-bearing row takes keyboard focus, so arrows walk the sheet and the lore strip follows.
  for (const el of sheet.querySelectorAll('.pc-ab, .pc-big, .pc-cls, .pc-kv > .k, .pc-cond, .pc-packi')) {
    el.tabIndex = 0;
    el.dataset.nav = '1';
  }
  return sheet;
}
