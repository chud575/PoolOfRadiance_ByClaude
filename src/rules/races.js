/**
 * The six player races of Pool of Radiance (AD&D 1e PHB), with ability
 * adjustments, racial minimum/maximum scores (after adjustment), the class and
 * multiclass options PoR offers, ability-dependent level limits, thief skill
 * adjustments, starting age, infravision and base movement.
 *
 * Level limit `Infinity` = unlimited by race (the game's own caps still apply,
 * see classes.js PR_LEVEL_CAPS).
 */

const U = Infinity;

export const RACES = {
  human: {
    id: 'human',
    name: 'Human',
    adjust: {},
    min: { str: 3, int: 3, wis: 3, dex: 3, con: 3, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 18, con: 18, cha: 18 },
    /** Maximum exceptional strength percentile (18/xx); female max below. */
    maxStrPct: { male: 100, female: 50 },
    femaleMaxStr: 18,
    classes: ['fighter', 'cleric', 'magicUser', 'thief'],
    levelLimits: { fighter: U, cleric: U, magicUser: U, thief: U },
    /** [ability, [score→limit...]] ability-dependent limits (PHB): value at ≥ score. */
    limitBy: {},
    infravision: 0,
    move: 12,
    size: 'M',
    saveBonusCon: false,
    thiefAdj: {},
    canDualClass: true,
    languages: ['Common'],
    age: { fighter: [15, '1d4'], cleric: [18, '1d4'], magicUser: [24, '2d8'], thief: [18, '1d4'] },
    desc: 'Adaptable and ambitious; the only race that may rise without limit and change class.',
  },
  elf: {
    id: 'elf',
    name: 'Elf',
    adjust: { dex: 1, con: -1 },
    min: { str: 3, int: 8, wis: 3, dex: 7, con: 6, cha: 8 },
    max: { str: 18, int: 18, wis: 18, dex: 19, con: 18, cha: 18 },
    maxStrPct: { male: 75, female: 0 },
    femaleMaxStr: 16,
    classes: ['fighter', 'magicUser', 'thief', 'fighter/magicUser', 'fighter/thief', 'magicUser/thief', 'fighter/magicUser/thief'],
    levelLimits: { fighter: 7, magicUser: 11, thief: U },
    limitBy: { fighter: ['str', [[18, 7], [17, 6], [0, 5]]], magicUser: ['int', [[18, 11], [17, 10], [0, 9]]] },
    infravision: 60,
    move: 12,
    size: 'M',
    saveBonusCon: false,
    resistSleepCharm: 90,
    thiefAdj: { pp: 5, ol: -5, ms: 5, hs: 10, hn: 5 },
    languages: ['Common', 'Elvish', 'Gnome', 'Halfling', 'Goblin', 'Hobgoblin', 'Orcish', 'Gnoll'],
    age: { fighter: [130, '5d6'], magicUser: [150, '5d6'], thief: [100, '5d6'] },
    desc: 'Graceful and long-lived. 90% resistant to sleep and charm; +1 to hit with swords and bows.',
  },
  halfElf: {
    id: 'halfElf',
    name: 'Half-Elf',
    adjust: {},
    min: { str: 3, int: 4, wis: 3, dex: 6, con: 6, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 18, con: 18, cha: 18 },
    maxStrPct: { male: 90, female: 0 },
    femaleMaxStr: 17,
    classes: ['fighter', 'cleric', 'magicUser', 'thief', 'cleric/fighter', 'cleric/magicUser', 'cleric/fighter/magicUser', 'fighter/magicUser', 'fighter/thief', 'magicUser/thief', 'fighter/magicUser/thief'],
    levelLimits: { cleric: 5, fighter: 8, magicUser: 8, thief: U },
    limitBy: { fighter: ['str', [[18, 8], [17, 7], [0, 6]]], magicUser: ['int', [[18, 8], [17, 7], [0, 6]]] },
    infravision: 60,
    move: 12,
    size: 'M',
    saveBonusCon: false,
    resistSleepCharm: 30,
    thiefAdj: { pp: 10, hs: 5 },
    languages: ['Common', 'Elvish', 'Gnome', 'Halfling', 'Goblin', 'Hobgoblin', 'Orcish', 'Gnoll'],
    age: { fighter: [22, '3d4'], cleric: [40, '2d4'], magicUser: [30, '2d8'], thief: [22, '3d8'] },
    desc: 'Heirs of two peoples, with the widest choice of multiple classes. 30% resistant to sleep and charm.',
  },
  dwarf: {
    id: 'dwarf',
    name: 'Dwarf',
    adjust: { con: 1, cha: -1 },
    min: { str: 8, int: 3, wis: 3, dex: 3, con: 12, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 17, con: 19, cha: 16 },
    maxStrPct: { male: 99, female: 0 },
    femaleMaxStr: 17,
    classes: ['fighter', 'thief', 'fighter/thief'],
    levelLimits: { fighter: 9, thief: U },
    limitBy: { fighter: ['str', [[18, 9], [17, 8], [0, 7]]] },
    infravision: 60,
    move: 6,
    size: 'M',
    saveBonusCon: true,
    thiefAdj: { ol: 10, ft: 15, cw: -10, rl: -5 },
    vsGiants: true,
    /** PHB: these creatures suffer -4 to hit a dwarf (applied as -4 AC in combat). */
    acVs: ['giant', 'ogre', 'titan', 'troll'],
    /** PHB: +1 to hit these. */
    bonusVs: ['orc', 'halfOrc', 'goblin', 'hobgoblin'],
    languages: ['Common', 'Dwarvish', 'Gnome', 'Goblin', 'Kobold', 'Orcish'],
    age: { fighter: [40, '5d4'], thief: [75, '3d6'] },
    desc: 'Stout and stubborn. Bonus saves vs magic and poison; giants and ogres strike them less often.',
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    adjust: {},
    min: { str: 6, int: 7, wis: 3, dex: 3, con: 8, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 18, con: 18, cha: 18 },
    maxStrPct: { male: 50, female: 0 },
    femaleMaxStr: 15,
    classes: ['fighter', 'thief', 'fighter/thief'],
    levelLimits: { fighter: 6, thief: U },
    limitBy: { fighter: ['str', [[18, 6], [17, 5], [0, 4]]] },
    infravision: 60,
    move: 6,
    size: 'S',
    saveBonusCon: true,
    thiefAdj: { ol: 5, ft: 10, ms: 5, hs: 5, hn: 10, cw: -15 },
    vsGiants: true,
    acVs: ['bugbear', 'giant', 'gnoll', 'ogre', 'titan', 'troll'],
    bonusVs: ['kobold', 'goblin'],
    languages: ['Common', 'Dwarvish', 'Gnome', 'Halfling', 'Goblin', 'Kobold'],
    age: { fighter: [60, '5d4'], thief: [80, '5d4'] },
    desc: 'Clever tinkers of the hills. Bonus saves vs magic; giants and ogres strike them less often.',
  },
  halfling: {
    id: 'halfling',
    name: 'Halfling',
    adjust: { str: -1, dex: 1 },
    min: { str: 6, int: 6, wis: 3, dex: 8, con: 10, cha: 3 },
    max: { str: 17, int: 18, wis: 17, dex: 18, con: 19, cha: 18 },
    maxStrPct: { male: 0, female: 0 },
    femaleMaxStr: 14,
    classes: ['fighter', 'thief', 'fighter/thief'],
    // PoR lists halfling fighters at 6th level flat. (The PHB's STR-dependent
    // 4/5/6 can never reach 6 because halfling STR tops out at 17.)
    levelLimits: { fighter: 6, thief: U },
    limitBy: {},
    infravision: 30,
    move: 9,
    size: 'S',
    saveBonusCon: true,
    thiefAdj: { pp: 5, ol: 5, ft: 5, ms: 10, hs: 15, hn: 5, cw: -15, rl: -5 },
    missileBonus: 3,
    languages: ['Common', 'Halfling', 'Dwarvish', 'Elvish', 'Gnome', 'Goblin', 'Orcish'],
    age: { fighter: [20, '3d4'], thief: [40, '2d4'] },
    desc: 'Small, quiet and lucky. Bonus saves vs magic and poison; +3 to hit with slings and bows.',
  },
};

export const RACE_IDS = Object.keys(RACES);

/**
 * Dwarf/gnome/halfling save bonus vs magic (rod/staff/wand, spell) & poison
 * (dwarves and halflings only) based on CON: +1 per 3.5 points, max +5.
 * @param {string} raceId
 * @param {number} con
 */
export function racialSaveBonus(raceId, con) {
  if (!RACES[raceId]?.saveBonusCon) return 0;
  return Math.min(5, Math.floor(con / 3.5));
}

/** Gnomes get their CON bonus vs magic only, not vs poison. */
export function racialPoisonBonus(raceId, con) {
  if (raceId === 'gnome') return 0;
  return racialSaveBonus(raceId, con);
}

/** @param {string} raceId @param {string} classSpec e.g. 'fighter/thief' */
export function raceAllowsClass(raceId, classSpec) {
  return RACES[raceId]?.classes.includes(classSpec) ?? false;
}

/**
 * Racial maximum level in a class, accounting for the PHB's ability-dependent
 * limits (e.g. an elf fighter with 18 STR may reach 7th, 17 STR 6th, else 5th).
 * @param {string} raceId
 * @param {string} classId
 * @param {{str:number,int:number}} [abilities] omit for the best-case limit
 * @returns {number} Infinity when unlimited, 0 when the class is not allowed
 */
export function racialLevelLimit(raceId, classId, abilities) {
  const race = RACES[raceId];
  if (!race) return 0;
  const base = race.levelLimits[classId];
  if (base === undefined) return 0;
  const by = race.limitBy[classId];
  if (!by || !abilities) return base;
  const [key, rows] = by;
  const score = abilities[key] ?? 0;
  return rows.find(([min]) => score >= min)[1];
}

/**
 * Race-legal maximum ability values for a gender (females have a lower STR
 * cap and exceptional strength cap in 1e).
 * @returns {{max:Record<string,number>, maxStrPct:number}}
 */
export function raceAbilityCaps(raceId, gender = 'male') {
  const race = RACES[raceId];
  const max = { ...race.max };
  if (gender === 'female') max.str = Math.min(max.str, race.femaleMaxStr);
  const maxStrPct = max.str === 18 ? race.maxStrPct[gender] ?? 0 : 0;
  return { max, maxStrPct };
}

/**
 * Validate an ability set against race min/max (already adjusted scores).
 * @returns {string[]} problems (empty = legal)
 */
export function checkRaceAbilities(raceId, abilities, gender = 'male') {
  const race = RACES[raceId];
  const { max, maxStrPct } = raceAbilityCaps(raceId, gender);
  const out = [];
  for (const k of Object.keys(race.min)) {
    if (abilities[k] < race.min[k]) out.push(`${k} below ${race.min[k]}`);
    if (abilities[k] > max[k]) out.push(`${k} above ${max[k]}`);
  }
  if (abilities.str === 18 && (abilities.strPct ?? 0) > maxStrPct) out.push(`exceptional strength above 18/${maxStrPct}`);
  return out;
}
