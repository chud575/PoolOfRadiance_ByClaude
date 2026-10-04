import './goldsheet.css';
import './ironSkin.js';
import { h } from '../dom.js';
import { deriveStats, statusLabel, maxLevel, armorAllowsThieving } from '../../rules/character.js';
import { ABILITIES, ABILITY_ABBR, formatStr } from '../../rules/abilities.js';
import { RACES } from '../../rules/races.js';
import { CLASSES, ALIGNMENT_NAMES, SAVE_KEYS, SAVE_SHORT, THIEF_SKILL_IDS, THIEF_SKILL_NAMES, splitClasses, xpForLevel } from '../../rules/classes.js';
import { describeEffects } from '../../rules/conditions.js';
import { itemName } from '../../rules/items.js';
import { spellLevel } from '../../rules/spells.js';
import { ITEMS } from '../../data/items.js';
import { itemIconURL, iconFor } from './itemIcons.js';
import { abilityTip, STAT_TIPS } from './rulesText.js';
import { miniatureSnapshot } from './Miniature.js';
import { ammoProblem } from './Inventory.js';
import { portraitEl, abilityMods, lore } from './CharacterSheet.js';
import { resolveAppearance } from './lookData.js';

/**
 * The VIEW screen in the Gold Box layout of 1988 — name, race/sex/age, alignment, class; the
 * STR..CHA column with gold beside it; LEVEL and EXP; AC/HP, THAC0/DAMAGE, ENCUMBRANCE/MOVEMENT;
 * STATUS on the last line — set in metal letters (steel labels, copper values, blue levels) on dark
 * iron, beside the large painted portrait in its ornate frame (the face of the miniature that fights
 * on the board, which stands in its medallion under the portrait with the readied kit).
 *
 * Every rules-bearing figure keeps its lore tooltip and takes keyboard focus.
 */

const sgn = (n) => (n > 0 ? `+${n}` : String(n));

/** Ornate dark frame round a painted portrait: rope band, bronze bevel, bosses at the corners. */
export function ornatePortrait(ch, o = {}) {
  return h(`div.gb-ornate${o.className ? `.${o.className}` : ''}`, [
    h('i.gb-boss.tl'), h('i.gb-boss.tr'), h('i.gb-boss.bl'), h('i.gb-boss.br'), h('i.gb-crest'),
    portraitEl(ch, { scale: o.scale ?? 1.25, priority: true }),
  ]);
}

/** A label + value pair in metal letters. */
function pair(label, value, tip, o = {}) {
  return h(`div.gb-pair${o.cls ? `.${o.cls}` : ''}`, { dataset: { ...(tip ? lore(tip) : {}), k: o.k ?? '' } }, [
    h('span.gb-l.gb-steel', [label]),
    h(`span.gb-v.${o.metal ?? 'gb-copper'}`, [String(value)]),
  ]);
}

export function renderGoldBoxSheet(ch) {
  const s = deriveStats(ch);
  const a = s.abilities;
  const race = RACES[ch.race];
  const classes = splitClasses(ch.classSpec);
  const effects = describeEffects(ch);

  // ---- identity, as the original's three header lines
  const ident = h('div.gb-ident', [
    h('div.gb-name.gb-steel', [ch.name]),
    h('div.gb-line.gb-steel', [`${ch.gender === 'female' ? 'Female' : 'Male'} ${race.name}`, h('span.gb-gap'), 'Age ', h('span.gb-copper', [String(ch.age)])]),
    h('div.gb-line.gb-steel', { dataset: lore(STAT_TIPS.align(ch.alignment)) }, [ALIGNMENT_NAMES[ch.alignment]]),
    h('div.gb-line.gb-steel', [classes.map((c) => CLASSES[c].name).join('/')]),
  ]);

  // ---- STR..CHA in copper, the modifiers set small beside them; gold to the right
  const abil = h('div.gb-abil', ABILITIES.map((k) => {
    const v = a[k];
    return h('div.gb-ab', { dataset: lore(abilityTip(k, a, ch.classSpec)) }, [
      h('span.gb-abbr.gb-copper', [ABILITY_ABBR[k]]),
      h(`span.gb-num.gb-copper${v >= 16 ? '.hi' : ''}`, [k === 'str' ? formatStr(v, a.strPct) : String(v), v !== ch.abilities[k] ? '*' : '']),
      h('span.gb-mod', [abilityMods(k, a, ch.classSpec)]),
    ]);
  }));
  const purse = h('div.gb-purse', [
    pair('Gold', (ch.gold ?? 0).toLocaleString('en-US'), { title: 'Purse', text: 'Coins weigh 1 coin-weight (cn) each and count toward encumbrance. Pool gold or split it evenly from the ITEMS screen.' }, { cls: 'big' }),
  ]);

  // ---- LEVEL / EXP
  const lv = classes.map((c) => ch.levels[c] ?? 1).join('/');
  const xp = classes.map((c) => (ch.xp[c] ?? 0).toLocaleString('en-US')).join('/');
  const c0 = classes[0];
  const lvl0 = ch.levels[c0] ?? 1;
  const next0 = lvl0 < maxLevel(ch, c0) ? xpForLevel(c0, lvl0 + 1) : null;
  const lvRow = h('div.gb-row.gb-lvrow', [
    pair('Level', lv, STAT_TIPS.xp(ch, c0, next0 ? next0 - (ch.xp[c0] ?? 0) : 0), { metal: 'gb-blue', k: 'level' }),
    pair('Exp', xp, { title: 'Experience', text: `Earned by defeating foes and recovering treasure. Multi-class characters split every award between their classes. ${next0 ? `${(next0 - (ch.xp[c0] ?? 0)).toLocaleString('en-US')} more to ${CLASSES[c0].name} level ${lvl0 + 1}; then train at the hall (1,000 gp).` : 'Maximum level reached in Phlan.'}` }, { k: 'exp' }),
  ]);

  // ---- the combat block: AC/HP, THAC0/DAMAGE, ENCUMBRANCE/MOVEMENT
  const hpLow = ch.hp.cur < ch.hp.max * 0.34;
  const combat = h('div.gb-combat', [
    h('div.gb-cc', [
      pair('AC', s.ac, STAT_TIPS.ac(s), { k: 'ac' }),
      pair('HP', ch.hp.cur === ch.hp.max ? ch.hp.max : `${ch.hp.cur}/${ch.hp.max}`, STAT_TIPS.hp(ch), { k: 'hp', cls: hpLow ? 'low' : '' }),
    ]),
    h('div.gb-cc', [
      pair('THAC0', s.thac0, STAT_TIPS.thac0(s), { k: 'thac0' }),
      pair('Damage', `${s.damage}${s.dmgBonus ? sgn(s.dmgBonus) : ''}`, STAT_TIPS.damage(s), { k: 'damage' }),
    ]),
    h('div.gb-cc.r', [
      pair('Encumbrance', s.weight, STAT_TIPS.enc(s), { k: 'enc' }),
      pair('Movement', s.move, STAT_TIPS.move(s), { k: 'move' }),
    ]),
  ]);

  // ---- the finer print the original kept on other screens: saves, attacks, thieving, spells
  const fine = [];
  const poisonSplit = s.savePoison != null && s.savePoison !== s.saves.ppdm;
  fine.push(h('div.gb-fine', [h('div.gb-fh', ['Saving throws']), h('div.gb-fkv', SAVE_KEYS.flatMap((k) => {
    const rows = [[SAVE_SHORT[k], s.saves[k], STAT_TIPS.save(k, s.saves[k])]];
    if (k === 'ppdm' && poisonSplit) rows.push(['Poison', s.savePoison, { title: `Save vs Poison: ${s.savePoison}`, text: `Roll ${s.savePoison} or more on a d20 to shake off venom; the ${race.name.toLowerCase()}'s stout constitution adds its bonus.` }]);
    return rows.map(([kk, v, t]) => h('div.gb-f', { dataset: lore(t) }, [h('span', [kk]), h('b', [String(v)])]));
  }))]));
  const attacks = [
    ['Weapon', s.weapon ? itemName(s.weaponEntry) : 'Bare hands', STAT_TIPS.damage(s)],
    ['To hit', sgn(s.hitBonus), STAT_TIPS.thac0(s)],
    ['Attacks', `${s.attacks}/round`, STAT_TIPS.attacks(s)],
    ['AC rear', String(s.acRear ?? s.ac), { title: 'Armour class from behind', text: 'Attacks from behind ignore the shield and the dexterity bonus, and thieves may backstab.' }],
    ['Burden', s.encumbrance.label, STAT_TIPS.enc(s)],
  ];
  fine.push(h('div.gb-fine', [h('div.gb-fh', ['Combat']), h('div.gb-fkv', attacks.map(([k, v, t]) => h('div.gb-f', { dataset: lore(t) }, [h('span', [k]), h('b', [v])])))]));
  if (s.thief) {
    const armored = !armorAllowsThieving(ch);
    const SHORT = { pp: 'Pick pockets', ol: 'Open locks', ft: 'Traps', ms: 'Move silent', hs: 'Hide', hn: 'Hear noise', cw: 'Climb walls', rl: 'Read lang.' };
    fine.push(h(`div.gb-fine.wide${armored ? '.warn' : ''}`, [h('div.gb-fh', [armored ? 'Thieving · needs leather armour' : `Thieving · backstab ×${s.backstab}`]), h('div.gb-fkv.two', THIEF_SKILL_IDS.map((k) => h('div.gb-f', { dataset: lore(STAT_TIPS.thief(THIEF_SKILL_NAMES[k], s.thief[k])) }, [h('span', [SHORT[k] ?? THIEF_SKILL_NAMES[k]]), h('b', [`${s.thief[k]}%`])])))]));
  }
  for (const [c, slots] of Object.entries(s.spellSlots)) {
    const mem = ch.spells?.memorized?.[c] ?? [];
    fine.push(h('div.gb-fine', { dataset: lore({ title: `${CLASSES[c].name} spells`, text: 'Spell slots by level (lit pips are memorized now). Encamp and choose MAGIC to memorize.' }) }, [
      h('div.gb-fh', [`${CLASSES[c].name} spells`]),
      h('div.gb-fkv', slots.map((n, i) => (n ? h('div.gb-f', [h('span', [`Level ${i + 1}`]), h('b.gb-pips', Array.from({ length: n }, (_, j) => h(`i${j < mem.filter((id) => spellLevel(id, c) === i + 1).length ? '.on' : ''}`)))]) : null)).filter(Boolean)),
    ]));
  }

  // ---- STATUS, last line, as in 1988
  const fx = effects.filter((e) => !(e.kind === 'status' && e.id === 'ok'));
  const st = statusLabel(ch);
  const status = h('div.gb-status', [
    pair('Status', st, { title: st, text: fx.length ? fx.map((e) => `${e.name}: ${e.desc}`).join(' ') : ch.hp.cur >= ch.hp.max ? 'No wounds, curses or lingering magic.' : `Down ${ch.hp.max - ch.hp.cur} hp. Rest heals 1 hp a day; clerics heal faster.` }, { k: 'status', cls: st === 'Okay' ? '' : 'bad' }),
    ...fx.slice(0, 3).map((e) => h('span.gb-chip', { dataset: lore({ title: e.name, text: e.desc }) }, [e.name])),
  ]);

  const left = h('div.gb-left', [
    h('div.gb-top', [ident, h('div.gb-crestwrap', [crestShield(ch)])]),
    h('div.gb-mid', [abil, purse]),
    h('div.gb-rule'),
    lvRow,
    combat,
    h('div.gb-rule.thin'),
    h('div.gb-fines', fine),
    h('div.gb-rule.foot'),
    status,
  ]);

  // ---- right: the portrait, the miniature's medallion and the readied kit as shield badges
  const gear = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]);
  const ammoWarn = ammoProblem(ch);
  const badges = h('div.gb-badges', [
    ...gear.slice(0, 5).map((e) => h('div.gb-badge', { dataset: lore({ title: itemName(e) + ((e.qty ?? 1) > 1 ? ` ×${e.qty}` : ''), text: `Readied ${ITEMS[e.id].type}. Open ITEMS to change equipment.${ammoWarn && ITEMS[e.id].type === 'ammo' ? ` ${ammoWarn}` : ''}` }) }, [
      h('img', { src: itemIconURL(iconFor(ITEMS[e.id])), alt: '' }),
    ])),
    ...Array.from({ length: Math.max(0, 5 - gear.length) }, () => h('div.gb-badge.empty')),
  ]);
  const foot = h('div.gb-rfoot', [badges]);
  const right = h('div.gb-right', [ornatePortrait(ch), foot]);
  const icon = miniatureSnapshot(ch, { w: 220, h: 260, tight: true });
  if (icon) {
    foot.prepend(h('div.gb-medal', { dataset: lore({ title: 'Combat icon', text: 'Your miniature on the battlefield, dressed in whatever is readied. Change its look with MODIFY at the party screen.' }) }, [
      h('img', { src: icon, alt: '', draggable: false }),
    ]));
  }

  const sheet = h('div.pc-sheet.gb-sheet', [left, right]);
  for (const el of sheet.querySelectorAll('.gb-ab, .gb-pair, .gb-f, .gb-badge:not(.empty), .gb-medal, .gb-chip')) {
    el.tabIndex = 0;
    el.dataset.nav = '1';
  }
  return sheet;
}

/**
 * The heraldic shield the miniature carries, as the sheet's crest: a heater shield of hammered
 * metal, its field enamelled in the figure's cloth colour, an ordinary picked from the name and a
 * charge from the class (tower, sun, star, key) or race (dwarf hammer, elf leaf), hand-painted:
 * gritty enamel, worn edges, a bevelled rim under the same warm key as the portrait.
 */
const CHARGES = {
  fighter: "<path d='M38 44 h24 v6 h-3 v26 h3 v6 h-24 v-6 h3 v-26 h-3 Z M38 44 v-6 h5 v4 h4 v-4 h6 v4 h4 v-4 h5 v6 Z'/>",
  cleric: "<circle cx='50' cy='60' r='9'/><path d='M50 38 l3 10 h-6 Z M50 82 l3 -10 h-6 Z M28 60 l10 3 v-6 Z M72 60 l-10 3 v-6 Z M35 45 l9 6 -4 4 Z M65 45 l-9 6 4 4 Z M35 75 l9 -6 -4 -4 Z M65 75 l-9 -6 4 -4 Z'/>",
  'magic-user': "<path d='M50 38 L55 54 L72 54 L58 64 L63 80 L50 70 L37 80 L42 64 L28 54 L45 54 Z'/>",
  thief: "<path d='M44 40 a9 9 0 1 1 12 0 v34 h6 v5 h-6 v4 h4 v5 h-4 v3 h-12 Z M47 34 a4 4 0 1 0 6 0 a4 4 0 1 0 -6 0' fill-rule='evenodd'/>",
  dwarf: "<path d='M33 42 h34 v14 h-34 Z M47 56 h6 v30 h-6 Z'/>",
  elf: "<path d='M50 36 C66 46 68 68 50 86 C32 68 34 46 50 36 Z M49 44 h2 v40 h-2 Z' fill-rule='evenodd'/>",
};
const ORDINARIES = [
  (f, m) => `<path d='M18 48 L50 30 L82 48 L82 58 L50 40 L18 58 Z' fill='${m}'/>`, // chevron (inverted, chief)
  (f, m) => `<path d='M18 25 h64 v14 h-64 Z' fill='${m}'/>`, // chief
  (f, m) => `<path d='M18 30 L32 25 L82 82 L76 92 Z' fill='${m}' opacity='.95'/>`, // bend
  (f, m) => `<path d='M18 25 h32 v76 Q30 90 22 66 L18 25 Z' fill='${m}' opacity='.9'/>`, // per pale
  (f, m) => `<path d='M18 82 h64 v4 Q76 96 50 104 Q24 96 18 86 Z' fill='${m}'/>`, // base
];
function crestShield(ch) {
  let field = '#6a1a14';
  let metal = '#d8b06a';
  try { const ap = resolveAppearance(ch); field = ap.clothHex ?? field; } catch { /* default field */ }
  const classes = splitClasses(ch.classSpec);
  const ck = ch.race === 'dwarf' && classes[0] === 'fighter' ? 'dwarf' : ch.race === 'elf' && classes.length > 1 ? 'elf' : (CHARGES[classes[0]] ? classes[0] : 'fighter');
  let hsh = 0;
  for (const c of String(ch.name ?? '')) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const ord = ORDINARIES[hsh % ORDINARIES.length];
  if (hsh % 3 === 0) metal = '#d6dade';
  const SH = "M50 6 L92 14 Q94 52 86 70 Q76 96 50 112 Q24 96 14 70 Q6 52 8 14 Z";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 120'><defs>
<linearGradient id='rim' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ffe2b0'/><stop offset='.18' stop-color='#b07a40'/><stop offset='.45' stop-color='#5a3a1c'/><stop offset='.7' stop-color='#8a5e30'/><stop offset='1' stop-color='#1e1208'/></linearGradient>
<radialGradient id='lit' cx='.28' cy='.2' r='.95'><stop offset='0' stop-color='#ffd8a0' stop-opacity='.45'/><stop offset='.4' stop-color='#ffb070' stop-opacity='.08'/><stop offset='1' stop-color='#000' stop-opacity='.7'/></radialGradient>
<linearGradient id='mt' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff4dc'/><stop offset='.3' stop-color='${metal}'/><stop offset='.55' stop-color='#4a3214'/><stop offset='.62' stop-color='${metal}'/><stop offset='1' stop-color='#fff0d0'/></linearGradient>
<filter id='grit' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' seed='${hsh % 97}'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.15'/><feComposite in2='SourceGraphic' operator='in'/></filter>
<filter id='dent' x='-5%' y='-5%' width='110%' height='110%'><feTurbulence type='fractalNoise' baseFrequency='.045' numOctaves='2' seed='${hsh % 53}' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='2.2'/></filter>
<filter id='emb'><feGaussianBlur in='SourceAlpha' stdDeviation='.7' result='b'/><feOffset in='b' dx='.9' dy='1.3' result='o'/><feComposite in='SourceGraphic' in2='o' operator='over'/></filter>
<clipPath id='cp'><path d='M50 15 L84 21 Q86 52 79 67 Q71 88 50 101 Q29 88 21 67 Q14 52 16 21 Z'/></clipPath>
</defs>
<path d='${SH}' fill='#000' transform='translate(1.5 2.5)' opacity='.6'/>
<path d='${SH}' fill='url(#rim)'/>
<path d='${SH}' fill='none' stroke='#000' stroke-width='1.2'/>
<path d='M50 10 L88 17 Q90 52 82 69' fill='none' stroke='#fff0d0' stroke-opacity='.55' stroke-width='1'/>
<g clip-path='url(#cp)' filter='url(#dent)'>
<rect x='0' y='0' width='100' height='120' fill='${field}'/>
<rect x='0' y='0' width='100' height='120' fill='#000' opacity='.18' filter='url(#grit)'/>
<g filter='url(#emb)'>${ord(field, 'url(#mt)')}<g fill='url(#mt)' stroke='#2a1808' stroke-width='.8'>${CHARGES[ck]}</g></g>
<rect x='0' y='0' width='100' height='120' fill='url(#lit)'/>
</g>
<path d='M50 15 L84 21 Q86 52 79 67 Q71 88 50 101 Q29 88 21 67 Q14 52 16 21 Z' fill='none' stroke='#000' stroke-opacity='.7' stroke-width='1.6'/>
<circle cx='16' cy='18' r='2.6' fill='url(#rim)' stroke='#000' stroke-width='.5'/><circle cx='84' cy='18' r='2.6' fill='url(#rim)' stroke='#000' stroke-width='.5'/><circle cx='50' cy='106' r='2.6' fill='url(#rim)' stroke='#000' stroke-width='.5'/>
</svg>`;
  return h('img.gb-crest-shield', { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, alt: '', draggable: false });
}
