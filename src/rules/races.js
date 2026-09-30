/**
 * Races available in Pool of Radiance, with PoR's class options and level limits.
 * Level limit `Infinity` = unlimited. Ability min/max are after adjustment.
 */
export const RACES = {
  human: {
    id: 'human',
    name: 'Human',
    adjust: {},
    min: { str: 3, int: 3, wis: 3, dex: 3, con: 3, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 18, con: 18, cha: 18 },
    classes: ['fighter', 'cleric', 'magicUser', 'thief'],
    levelLimits: { fighter: Infinity, cleric: Infinity, magicUser: Infinity, thief: Infinity },
    infravision: 0,
    move: 12,
    saveBonusCon: false,
    thiefAdj: {},
  },
  elf: {
    id: 'elf',
    name: 'Elf',
    adjust: { dex: 1, con: -1 },
    min: { str: 3, int: 8, wis: 3, dex: 7, con: 6, cha: 8 },
    max: { str: 18, int: 18, wis: 18, dex: 19, con: 18, cha: 18 },
    classes: ['fighter', 'magicUser', 'thief', 'fighter/magicUser', 'fighter/thief', 'magicUser/thief', 'fighter/magicUser/thief'],
    levelLimits: { fighter: 7, magicUser: 11, thief: Infinity },
    infravision: 60,
    move: 12,
    saveBonusCon: false,
    thiefAdj: { pp: 5, ol: -5, ms: 5, hs: 10, hn: 5 },
  },
  halfElf: {
    id: 'halfElf',
    name: 'Half-Elf',
    adjust: {},
    min: { str: 3, int: 4, wis: 3, dex: 6, con: 6, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 18, con: 18, cha: 18 },
    classes: ['fighter', 'cleric', 'magicUser', 'thief', 'cleric/fighter', 'cleric/magicUser', 'cleric/fighter/magicUser', 'fighter/magicUser', 'fighter/thief', 'magicUser/thief', 'fighter/magicUser/thief'],
    levelLimits: { cleric: 5, fighter: 8, magicUser: 8, thief: Infinity },
    infravision: 60,
    move: 12,
    saveBonusCon: false,
    thiefAdj: { pp: 10, hs: 5 },
  },
  dwarf: {
    id: 'dwarf',
    name: 'Dwarf',
    adjust: { con: 1, cha: -1 },
    min: { str: 8, int: 3, wis: 3, dex: 3, con: 12, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 17, con: 19, cha: 16 },
    classes: ['fighter', 'thief', 'fighter/thief'],
    levelLimits: { fighter: 9, thief: Infinity },
    infravision: 60,
    move: 6,
    saveBonusCon: true,
    thiefAdj: { ol: 15, ft: 15, cw: -10, rl: -5 },
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    adjust: {},
    min: { str: 6, int: 7, wis: 3, dex: 3, con: 8, cha: 3 },
    max: { str: 18, int: 18, wis: 18, dex: 18, con: 18, cha: 18 },
    classes: ['fighter', 'thief', 'fighter/thief'],
    levelLimits: { fighter: 6, thief: Infinity },
    infravision: 60,
    move: 6,
    saveBonusCon: true,
    thiefAdj: { ol: 5, ft: 10, ms: 5, hs: 5, hn: 10, cw: -15 },
  },
  halfling: {
    id: 'halfling',
    name: 'Halfling',
    adjust: { str: -1, dex: 1 },
    min: { str: 6, int: 6, wis: 3, dex: 8, con: 10, cha: 3 },
    max: { str: 17, int: 18, wis: 17, dex: 18, con: 19, cha: 18 },
    classes: ['fighter', 'thief', 'fighter/thief'],
    levelLimits: { fighter: 6, thief: Infinity },
    infravision: 60,
    move: 6,
    saveBonusCon: true,
    thiefAdj: { pp: 5, ol: 5, ft: 5, ms: 10, hs: 15, hn: 5, cw: -15, rl: -5 },
  },
};

export const RACE_IDS = Object.keys(RACES);

/**
 * Dwarf/gnome/halfling save bonus vs magic & poison based on CON: +1 per 3.5 CON.
 * @param {string} raceId
 * @param {number} con
 */
export function racialSaveBonus(raceId, con) {
  if (!RACES[raceId]?.saveBonusCon) return 0;
  return Math.min(5, Math.floor(con / 3.5));
}

/** @param {string} raceId @param {string} classSpec e.g. 'fighter/thief' */
export function raceAllowsClass(raceId, classSpec) {
  return RACES[raceId]?.classes.includes(classSpec) ?? false;
}
