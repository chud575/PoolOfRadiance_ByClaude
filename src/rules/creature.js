import { deriveStats, applyDamage, heal, highestLevel, isAlive } from './character.js';
import { effectiveHd, monsterSaves, monsterThac0, savesFor, thac0For, SAVE_KEYS } from './classes.js';
import { effectMods, onDamaged } from './conditions.js';
import { RACES } from './races.js';

/**
 * A uniform view over the three kinds of things the rules act on:
 *  - a party Character (has `classSpec`),
 *  - a combat Combatant (has `side`; `ref` is the Character or MonsterDef),
 *  - a bare MonsterDef-like record with `hp` (tests, scripted events).
 * Spells, poison, turning and saving throws all go through these helpers so
 * the combat scene and the camp can share one implementation.
 */

/** The Character behind a creature, if any. */
export function characterOf(c) {
  if (!c) return null;
  if (c.classSpec) return c;
  if (c.ref?.classSpec) return c.ref;
  return null;
}

/** The MonsterDef behind a creature, if any. */
export function monsterOf(c) {
  if (!c || characterOf(c)) return null;
  return c.ref ?? c;
}

/** Special-ability tags ('undead', 'mindless', 'snake', 'person'...). */
export function tagsOf(c) {
  const ch = characterOf(c);
  if (ch) return ['person', 'living', ch.race];
  const m = monsterOf(c);
  const t = new Set(m?.special ?? []);
  if (m?.type) t.add(m.type);
  if (monsterIsPerson(m)) t.add('person');
  if (!t.has('undead')) t.add('living');
  if (/snake|serpent|viper|cobra|python|asp/i.test(`${m?.id ?? ''} ${m?.name ?? ''}`)) t.add('snake');
  return [...t];
}

/**
 * PHB "persons" for Charm Person / Hold Person, as creature families:
 * humans and the demi-humans (dwarf, elf, gnome, half-elf, halfling,
 * half-orc) plus the man-sized humanoids the PHB names — brownies, dryads,
 * gnolls, goblins, hobgoblins, kobolds, lizard men, nixies, orcs, pixies,
 * sprites and troglodytes. Human bands (bandits, buccaneers, thugs,
 * cultists...) are humans. Bugbears, ogres and giants are *not* persons.
 */
export const PERSON_FAMILIES = Object.freeze(new Set([
  'human', 'dwarf', 'elf', 'gnome', 'halfElf', 'halfling', 'halfOrc',
  'kobold', 'goblin', 'hobgoblin', 'orc', 'gnoll', 'lizardMan', 'troglodyte',
  'brownie', 'dryad', 'nixie', 'pixie', 'sprite',
]));

/**
 * Families of human NPC bands: a monster whose id starts with one of these
 * ('banditLeader', 'buccaneerCaptain'...) is of family 'human'.
 */
export const HUMAN_BANDS = Object.freeze([
  'bandit', 'brigand', 'buccaneer', 'pirate', 'thug', 'mercenary', 'soldier', 'guard', 'cultist', 'acolyte',
  'priest', 'cleric', 'mage', 'magicUser', 'fighter', 'thief', 'noble', 'townsman', 'merchant', 'human', 'man',
]);

/**
 * Is this monster a PHB "person"? An explicit `person: true|false` on the
 * MonsterDef wins; class-based NPCs (`classAs` / `saveAs`, or a
 * `spells:clericN` tag — priests and mages are human) are persons; otherwise
 * the creature family (familyOf: `family`, `race`, or derived from the id)
 * must be in PERSON_FAMILIES. No per-id whitelist.
 */
export function monsterIsPerson(m) {
  if (!m) return false;
  if (typeof m.person === 'boolean') return m.person;
  if ((m.special ?? []).includes?.('undead')) return false;
  if (m.classAs || m.saveAs || (m.special ?? []).some?.((s) => /^spells:/.test(String(s)))) return true;
  return PERSON_FAMILIES.has(m.race ?? familyOf(m));
}

/**
 * Class-based NPC: the class and level a monster fights, casts and saves as
 * (DMG: "creatures with a character class save as that class"). Read from
 * `classAs` / `saveAs` ('cleric5', {cls:'cleric', level:5}) or derived from
 * a `spells:clericN` / `spells:magicUserN` tag, whose N is the highest spell
 * *level* reached at minimum: the class level is max(N, HD), so the HD 5
 * Priest of Bane ('spells:cleric3') is a 5th-level cleric (THAC0 18, ppdm 9,
 * bw 15, slots 3/3/1). Null for ordinary monsters (they save as fighters of
 * their effective HD).
 * @returns {{cls:string, level:number}|null}
 */
export function classAsOf(c) {
  const m = monsterOf(c);
  if (!m) return null;
  const spec = m.classAs ?? m.saveAs;
  if (spec && typeof spec === 'object' && spec.cls) return { cls: spec.cls, level: Math.max(1, spec.level ?? 1) };
  const src = spec ? String(spec) : (m.special ?? []).map(String).find?.((s) => /^spells:/.test(s))?.slice(7);
  const mm = src && /^(cleric|magicUser|mu|fighter|thief)(\d+)$/.exec(src);
  if (!mm) return null;
  const n = Number(mm[2]);
  return { cls: mm[1] === 'mu' ? 'magicUser' : mm[1], level: spec ? n : Math.max(n, Math.floor(m.hd ?? 1)) };
}

/**
 * THAC0 of a MonsterDef: its stated `thac0`, else its class table when it is
 * a class-based NPC, else the DMG monster matrix by HD.
 */
export function monsterBaseThac0(m) {
  if (!m) return 20;
  if (typeof m.thac0 === 'number') return m.thac0;
  const ca = classAsOf(m);
  if (ca) return thac0For(ca.cls, ca.level);
  return monsterThac0(m.hd ?? 1, m.hpBonus ?? 0);
}

/**
 * Base saving throws of a MonsterDef: its class table when it is a
 * class-based NPC (Priest of Bane = cleric 5: ppdm 9, bw 15), else a
 * fighter of its effective HD (DMG). An explicit `saves` object wins.
 */
export function monsterBaseSaves(m) {
  if (!m) return monsterSaves(1, 0);
  if (m.saves) return { ...m.saves };
  const ca = classAsOf(m);
  if (ca) return savesFor(ca.cls, ca.level);
  return monsterSaves(m.hd ?? 1, m.hpBonus ?? 0);
}

/**
 * Creature family for racial combat rules: 'orc' for an Orc Leader, 'giant'
 * for a Hill Giant, 'hobgoblin' for a Hobgoblin Chief... Monsters may state
 * `family` explicitly; otherwise it is derived from the id. Characters return
 * their race id.
 */
export function familyOf(c) {
  const ch = characterOf(c);
  if (ch) return ch.race;
  const m = monsterOf(c);
  if (!m) return null;
  if (m.family) return m.family;
  const id = m.id ?? '';
  if (id === 'titan' || /Titan$/.test(id)) return 'titan';
  if (id === 'giant' || /Giant$/.test(id)) return 'giant';
  const prefixed = (f) => id === f || (id.startsWith(f) && /[A-Z]/.test(id[f.length] ?? ''));
  for (const f of FAMILY_PREFIXES) if (prefixed(f)) return f;
  if (HUMAN_BANDS.some(prefixed) || /(Priest|Mage|Captain|Bandit|Thug|Cultist)$/.test(id)) return 'human';
  if (m.race) return m.race;
  return id;
}
const FAMILY_PREFIXES = ['hobgoblin', 'goblin', 'kobold', 'halfOrc', 'orc', 'gnoll', 'bugbear', 'ogre', 'troll', 'lizardMan', 'troglodyte'];

/**
 * PHB racial combat adjustments between an attacker and a defender:
 * dwarves +1 to hit orcs, half-orcs, goblins and hobgoblins; gnomes +1 to hit
 * kobolds and goblins; giants, ogres, titans and trolls (plus gnolls and
 * bugbears against gnomes) suffer -4 to hit dwarves and gnomes, which we
 * apply as a -4 (better) AC for the defender.
 * @returns {{hit:number, ac:number}}
 */
export function racialCombatMods(attacker, defender) {
  const out = { hit: 0, ac: 0 };
  const aRace = RACES[characterOf(attacker)?.race];
  const dRace = RACES[characterOf(defender)?.race];
  if (aRace?.bonusVs?.includes(familyOf(defender))) out.hit += 1;
  if (dRace?.acVs?.includes(familyOf(attacker))) out.ac -= 4;
  return out;
}

/**
 * True for creatures of less than one full hit die (kobolds, giant rats, and
 * 1-1 HD goblins): fighters "sweep" them, one attack per level.
 */
export function belowOneHd(c) {
  if (characterOf(c)) return false;
  const m = monsterOf(c);
  const hd = m?.hd ?? 1;
  return hd < 1 || (hd === 1 && (m?.hpBonus ?? 0) < 0);
}

export function hasTag(c, tag) {
  return tagsOf(c).includes(tag);
}

export function isUndead(c) {
  return hasTag(c, 'undead');
}

export function isPerson(c) {
  return hasTag(c, 'person');
}

/** Alignment string ('LG'... or 'N'). */
export function alignmentOf(c) {
  return characterOf(c)?.alignment ?? monsterOf(c)?.alignment ?? 'N';
}

export function isEvil(c) {
  const a = alignmentOf(c);
  return a.length === 2 && a[1] === 'E';
}

export function isGood(c) {
  const a = alignmentOf(c);
  return a.length === 2 && a[1] === 'G';
}

export function sizeOf(c) {
  return c.size ?? monsterOf(c)?.size ?? (characterOf(c) ? RACES[characterOf(c).race]?.size ?? 'M' : 'M');
}

/**
 * Hit dice for level-limited magic (sleep, turning): characters use their
 * highest level; monsters use HD with "+" bonuses counted as a half die
 * (1+1 HD = 1.5).
 */
export function hitDiceOf(c) {
  const ch = characterOf(c);
  if (ch) return highestLevel(ch);
  const m = monsterOf(c);
  if (!m) return 1;
  const hd = m.hd ?? 1;
  return hd + ((m.hpBonus ?? 0) > 0 ? 0.5 : 0);
}

/** Level for saves/attacks: characters highest level; monsters effective HD. */
export function levelOf(c) {
  const ch = characterOf(c);
  if (ch) return highestLevel(ch);
  const m = monsterOf(c);
  return effectiveHd(m?.hd ?? 1, m?.hpBonus ?? 0);
}

export function nameOf(c) {
  return c.name ?? characterOf(c)?.name ?? monsterOf(c)?.name ?? 'someone';
}

export function hpOf(c) {
  return c.hp ?? characterOf(c)?.hp;
}

/** Side for spell targeting: 'party' | 'monster'. */
export function sideOf(c) {
  if (c.side) return c.side;
  return characterOf(c) ? 'party' : 'monster';
}

/** Effects live on the Character for party members, on the creature itself otherwise. */
export function effectHost(c) {
  return characterOf(c) ?? c;
}

/** Current saving throw targets including active effects (no situational bonuses). */
export function savesOf(c) {
  const ch = characterOf(c);
  if (ch) return deriveStats(ch).saves;
  const base = c.saves ?? monsterBaseSaves(monsterOf(c));
  const fx = effectMods(c);
  const out = {};
  for (const k of SAVE_KEYS) out[k] = Math.max(2, base[k] - fx.save - (fx.saveVs[k] ?? 0));
  return out;
}

/** Current AC (melee) including effects. */
export function acOf(c, { missile = false, rear = false, hurled = false } = {}) {
  const ch = characterOf(c);
  if (ch) {
    const s = deriveStats(ch);
    return rear ? s.acRear : missile ? (hurled ? s.acHurled : s.acMissile) : s.ac;
  }
  const fx = effectMods(c);
  let ac = (c.ac ?? monsterOf(c)?.ac ?? 10) + fx.ac;
  if (!missile && fx.acVsMelee != null) ac = Math.min(ac, fx.acVsMelee);
  const cap = missile ? (hurled ? fx.acVsHurled ?? fx.acVsMissile : fx.acVsMissile) : null;
  if (cap != null) ac = Math.min(ac, cap);
  return ac;
}

/** THAC0 including effects' to-hit mods folded into a bonus: {thac0, hitBonus}. */
export function attackOf(c) {
  const ch = characterOf(c);
  if (ch) {
    const s = deriveStats(ch);
    return { thac0: s.thac0, hitBonus: s.hitBonus };
  }
  return { thac0: c.thac0 ?? monsterBaseThac0(monsterOf(c)), hitBonus: (c.hitBonus ?? 0) + effectMods(c).hit };
}

export function isDownCreature(c) {
  const ch = characterOf(c);
  if (ch) return ch.status !== 'ok' || ch.hp.cur <= 0;
  return (c.hp?.cur ?? 1) <= 0 || ['dead', 'dying', 'unconscious', 'fled', 'stoned'].includes(c.status);
}

export function isAliveCreature(c) {
  const ch = characterOf(c);
  if (ch) return isAlive(ch);
  return (c.hp?.cur ?? 1) > 0 && c.status !== 'dead' && c.status !== 'stoned';
}

/**
 * Deal damage to any creature. Party members use death's door; monsters die
 * at 0. Wakes magical sleepers. Returns true if the creature is now down.
 */
export function damageCreature(c, dmg) {
  const ch = characterOf(c);
  if (ch) {
    applyDamage(ch, dmg);
    if (c !== ch) onDamaged(c);
    return isDownCreature(c);
  }
  if (dmg <= 0) return isDownCreature(c);
  c.hp.cur -= dmg;
  onDamaged(c);
  if (c.hp.cur <= 0) c.status = 'dead';
  return isDownCreature(c);
}

/** Heal any creature (monsters cap at max). Returns hp restored. */
export function healCreature(c, amount) {
  const ch = characterOf(c);
  if (ch) return heal(ch, amount);
  if (!isAliveCreature(c)) return 0;
  const before = c.hp.cur;
  c.hp.cur = Math.min(c.hp.max, c.hp.cur + amount);
  return c.hp.cur - before;
}
