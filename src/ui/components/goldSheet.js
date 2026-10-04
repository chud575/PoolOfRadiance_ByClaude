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
import { resolveAppearance, armsOf } from './lookData.js';
import { heraldryOf, crestSVG, medallionSVG, CLASS_SIGILS, RACE_SIGILS } from './heraldry.js';

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

/** A small bronze medallion carrying a class or race sigil. */
function sigil(path, tip) {
  return h('img.gb-sigil', { src: `data:image/svg+xml,${encodeURIComponent(medallionSVG(path))}`, alt: '', draggable: false, dataset: lore(tip) });
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
    h('div.gb-top', [ident, h('div.gb-crestwrap', [
      crestShield(ch),
      // the target's stacked medallions: class and race sigils in cast bronze, beside the purse
      h('div.gb-sigils', [
        ...classes.map((c) => sigil(CLASS_SIGILS[c] ?? CLASS_SIGILS.fighter, { title: CLASSES[c].name, text: `Trained as a ${CLASSES[c].name.toLowerCase()}.` })).slice(0, 2),
        sigil(RACE_SIGILS[ch.race] ?? RACE_SIGILS.human, { title: race.name, text: `${race.name} by birth. See the racial traits on the record.` }),
      ]),
      purse,
    ])]),
    h('div.gb-mid', [abil]),
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
      h('img', { src: itemIconURL(iconFor(ITEMS[e.id]), { heraldry: armsOf(ch) }), alt: '' }),
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
function crestShield(ch) {
  let her;
  try { her = resolveAppearance(ch).heraldry; } catch { her = heraldryOf(ch); }
  const svg = crestSVG(her);
  return h('img.gb-crest-shield', { dataset: { device: her.key }, src: `data:image/svg+xml,${encodeURIComponent(svg)}`, alt: '', draggable: false });
}
