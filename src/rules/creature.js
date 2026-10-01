import { deriveStats, applyDamage, heal, highestLevel, isAlive } from './character.js';
import { effectiveHd, monsterSaves, SAVE_KEYS } from './classes.js';
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
  if (PERSON_IDS.has(m?.id) || m?.person) t.add('person');
  if (!t.has('undead')) t.add('living');
  if (/snake|serpent|viper|cobra|python|asp/i.test(`${m?.id ?? ''} ${m?.name ?? ''}`)) t.add('snake');
  return [...t];
}

/**
 * Monsters affected by charm person / hold person (PHB list of "persons":
 * humans, demi-humans and man-sized humanoids).
 */
export const PERSON_IDS = new Set([
  'human', 'dwarf', 'elf', 'gnome', 'halfElf', 'halfling', 'halfOrc', 'kobold', 'goblin', 'orc', 'hobgoblin', 'gnoll',
  'lizardMan', 'troglodyte', 'buccaneer', 'pirate', 'thug', 'bandit', 'brigand', 'mercenary', 'soldier', 'guard',
  'cultist', 'acolyte', 'priest', 'cleric', 'mage', 'magicUser', 'fighter', 'thief', 'noble', 'townsman',
  'orcLeader', 'hobgoblinLeader', 'koboldChief', 'goblinChief', 'norl', 'bishopBraccio', 'fighterNpc',
]);

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
  for (const f of FAMILY_PREFIXES) if (id === f || (id.startsWith(f) && /[A-Z]/.test(id[f.length] ?? ''))) return f;
  return id;
}
const FAMILY_PREFIXES = ['hobgoblin', 'goblin', 'kobold', 'halfOrc', 'orc', 'gnoll', 'bugbear', 'ogre', 'troll'];

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
  const base = c.saves ?? monsterSaves(monsterOf(c)?.hd ?? 1, monsterOf(c)?.hpBonus ?? 0);
  const fx = effectMods(c);
  const out = {};
  for (const k of SAVE_KEYS) out[k] = Math.max(2, base[k] - fx.save - (fx.saveVs[k] ?? 0));
  return out;
}

/** Current AC (melee) including effects. */
export function acOf(c, { missile = false, rear = false } = {}) {
  const ch = characterOf(c);
  if (ch) {
    const s = deriveStats(ch);
    return rear ? s.acRear : missile ? s.acMissile : s.ac;
  }
  const fx = effectMods(c);
  let ac = (c.ac ?? monsterOf(c)?.ac ?? 10) + fx.ac;
  if (!missile && fx.acVsMelee != null) ac = Math.min(ac, fx.acVsMelee);
  if (missile && fx.acVsMissile != null) ac = Math.min(ac, fx.acVsMissile);
  return ac;
}

/** THAC0 including effects' to-hit mods folded into a bonus: {thac0, hitBonus}. */
export function attackOf(c) {
  const ch = characterOf(c);
  if (ch) {
    const s = deriveStats(ch);
    return { thac0: s.thac0, hitBonus: s.hitBonus };
  }
  return { thac0: c.thac0 ?? monsterOf(c)?.thac0 ?? 20, hitBonus: (c.hitBonus ?? 0) + effectMods(c).hit };
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
