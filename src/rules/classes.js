/**
 * AD&D 1e class tables: hit dice, XP progression, THAC0, saving throws,
 * spell slots, thief skills. Class ids: fighter, cleric, magicUser, thief.
 * A character's class spec is 'fighter' or a multiclass joined by '/'
 * (e.g. 'fighter/magicUser/thief'); rules functions accept class ids.
 */

export const CLASSES = {
  fighter: {
    id: 'fighter',
    name: 'Fighter',
    abbr: 'F',
    hitDie: 10,
    hdCap: 9,
    hpAfterCap: 3,
    primeReq: ['str'],
    minAbilities: { str: 9, con: 7 },
    xp: [0, 2000, 4000, 8000, 18000, 35000, 70000, 125000, 250000, 500000, 750000, 1000000],
    weapons: 'any',
    armor: 'any',
    thacoStep: { every: 2, by: 2 },
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    abbr: 'C',
    hitDie: 8,
    hdCap: 9,
    hpAfterCap: 2,
    primeReq: ['wis'],
    minAbilities: { wis: 9 },
    xp: [0, 1500, 3000, 6000, 13000, 27500, 55000, 110000, 225000, 450000, 675000, 900000],
    weapons: ['club', 'flail', 'hammer', 'mace', 'staff', 'morningStar'],
    armor: 'any',
    thacoStep: { every: 3, by: 2 },
  },
  magicUser: {
    id: 'magicUser',
    name: 'Magic-User',
    abbr: 'MU',
    hitDie: 4,
    hdCap: 11,
    hpAfterCap: 1,
    primeReq: ['int'],
    minAbilities: { int: 9, dex: 6 },
    xp: [0, 2500, 5000, 10000, 22500, 40000, 60000, 90000, 135000, 250000, 375000, 750000],
    weapons: ['dagger', 'dart', 'staff'],
    armor: 'none',
    thacoStep: { every: 5, by: 2 },
  },
  thief: {
    id: 'thief',
    name: 'Thief',
    abbr: 'T',
    hitDie: 6,
    hdCap: 10,
    hpAfterCap: 2,
    primeReq: ['dex'],
    minAbilities: { dex: 9 },
    xp: [0, 1250, 2500, 5000, 10000, 20000, 42500, 70000, 110000, 160000, 220000, 440000],
    weapons: ['club', 'dagger', 'dart', 'shortSword', 'longSword', 'sling', 'shortBow'],
    armor: ['leather', 'padded'],
    thacoStep: { every: 4, by: 2 },
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

/** Split 'fighter/thief' → ['fighter','thief'] */
export function splitClasses(spec) {
  return String(spec).split('/');
}

export function classSpecName(spec) {
  return splitClasses(spec).map((c) => CLASSES[c].name).join('/');
}

/** Level for a given XP in a single class. */
export function levelForXp(classId, xp) {
  const table = CLASSES[classId].xp;
  let lvl = 1;
  for (let i = 0; i < table.length; i++) if (xp >= table[i]) lvl = i + 1;
  // Beyond the table: fighters +250000/level etc. (approximation of PHB)
  const last = table[table.length - 1];
  const step = last - table[table.length - 2];
  if (xp > last) lvl = table.length + Math.floor((xp - last) / step);
  return lvl;
}

/** XP needed to reach `level` in class. */
export function xpForLevel(classId, level) {
  const table = CLASSES[classId].xp;
  if (level <= table.length) return table[level - 1];
  const last = table[table.length - 1];
  const step = last - table[table.length - 2];
  return last + (level - table.length) * step;
}

/** THAC0 for one class at a level (all classes start at 20). */
export function thac0For(classId, level) {
  const { every, by } = CLASSES[classId].thacoStep;
  return Math.max(1, 20 - Math.floor((level - 1) / every) * by);
}

/**
 * Saving throw table rows: [PPDM, PetPoly, RSW, Breath, Spell]
 * ppdm = Paralyzation/Poison/Death Magic, pp = Petrification/Polymorph,
 * rsw = Rod/Staff/Wand, bw = Breath Weapon, sp = Spell.
 */
export const SAVE_KEYS = ['ppdm', 'pp', 'rsw', 'bw', 'sp'];
export const SAVE_NAMES = {
  ppdm: 'Paralyzation, Poison, Death Magic',
  pp: 'Petrification, Polymorph',
  rsw: 'Rod, Staff, Wand',
  bw: 'Breath Weapon',
  sp: 'Spell',
};

const SAVE_TABLES = {
  fighter: [
    [0, [16, 17, 18, 20, 19]],
    [2, [14, 15, 16, 17, 17]],
    [4, [13, 14, 15, 16, 16]],
    [6, [11, 12, 13, 13, 14]],
    [8, [10, 11, 12, 12, 13]],
    [10, [8, 9, 10, 9, 11]],
    [12, [7, 8, 9, 8, 10]],
    [14, [5, 6, 7, 5, 8]],
    [16, [4, 5, 6, 4, 7]],
    [99, [3, 4, 5, 4, 6]],
  ],
  cleric: [
    [3, [10, 13, 14, 16, 15]],
    [6, [9, 12, 13, 15, 14]],
    [9, [7, 10, 11, 13, 12]],
    [12, [6, 9, 10, 12, 11]],
    [15, [5, 8, 9, 11, 10]],
    [18, [4, 7, 8, 10, 9]],
    [99, [2, 5, 6, 8, 7]],
  ],
  magicUser: [
    [5, [14, 13, 11, 15, 12]],
    [10, [13, 11, 9, 13, 10]],
    [15, [11, 9, 7, 11, 8]],
    [20, [10, 7, 5, 9, 6]],
    [99, [8, 5, 3, 7, 4]],
  ],
  thief: [
    [4, [13, 12, 14, 16, 15]],
    [8, [12, 11, 12, 15, 13]],
    [12, [11, 10, 10, 14, 11]],
    [16, [10, 9, 8, 13, 9]],
    [20, [9, 8, 6, 12, 7]],
    [99, [8, 7, 4, 11, 5]],
  ],
};

/** @returns {{ppdm:number,pp:number,rsw:number,bw:number,sp:number}} */
export function savesFor(classId, level) {
  const rows = SAVE_TABLES[classId];
  const row = rows.find(([maxLvl]) => level <= maxLvl)[1];
  return Object.fromEntries(SAVE_KEYS.map((k, i) => [k, row[i]]));
}

/** Monster saves: as fighter of level = HD (0-level for < 1 HD). */
export function monsterSaves(hd) {
  return savesFor('fighter', Math.max(0, Math.floor(hd)));
}

/** Spell slots per level for cleric (without wisdom bonus). Index = char level - 1. */
const CLERIC_SLOTS = [
  [1], [2], [2, 1], [3, 2], [3, 3, 1], [3, 3, 2], [3, 3, 2, 1], [3, 3, 3, 2], [4, 4, 3, 2, 1],
  [4, 4, 3, 3, 2], [5, 4, 4, 3, 2, 1], [6, 5, 5, 3, 2, 2],
];
const MU_SLOTS = [
  [1], [2], [2, 1], [3, 2], [4, 2, 1], [4, 2, 2], [4, 3, 2, 1], [4, 3, 3, 2], [4, 3, 3, 2, 1],
  [4, 4, 3, 2, 2], [4, 4, 4, 3, 3], [4, 4, 4, 4, 4, 1],
];

/** @returns {number[]} slots indexed by spell level-1 */
export function spellSlots(classId, level) {
  const t = classId === 'cleric' ? CLERIC_SLOTS : classId === 'magicUser' ? MU_SLOTS : null;
  if (!t || level < 1) return [];
  return [...t[Math.min(level, t.length) - 1]];
}

/** Base thief skills by level (pp, ol, ft, ms, hs, hn, cw, rl) in percent. */
const THIEF_SKILLS = [
  { pp: 30, ol: 25, ft: 20, ms: 15, hs: 10, hn: 10, cw: 85, rl: 0 },
  { pp: 35, ol: 29, ft: 25, ms: 21, hs: 15, hn: 10, cw: 86, rl: 0 },
  { pp: 40, ol: 33, ft: 30, ms: 27, hs: 20, hn: 15, cw: 87, rl: 0 },
  { pp: 45, ol: 37, ft: 35, ms: 33, hs: 25, hn: 15, cw: 88, rl: 20 },
  { pp: 50, ol: 42, ft: 40, ms: 40, hs: 31, hn: 20, cw: 90, rl: 25 },
  { pp: 55, ol: 47, ft: 45, ms: 47, hs: 37, hn: 20, cw: 92, rl: 30 },
  { pp: 60, ol: 52, ft: 50, ms: 55, hs: 43, hn: 25, cw: 94, rl: 35 },
  { pp: 65, ol: 57, ft: 55, ms: 62, hs: 49, hn: 25, cw: 96, rl: 40 },
  { pp: 70, ol: 62, ft: 60, ms: 70, hs: 56, hn: 30, cw: 98, rl: 45 },
  { pp: 80, ol: 67, ft: 65, ms: 78, hs: 63, hn: 30, cw: 99, rl: 50 },
];
export const THIEF_SKILL_NAMES = {
  pp: 'Pick Pockets',
  ol: 'Open Locks',
  ft: 'Find/Remove Traps',
  ms: 'Move Silently',
  hs: 'Hide in Shadows',
  hn: 'Hear Noise',
  cw: 'Climb Walls',
  rl: 'Read Languages',
};

export function thiefSkills(level, raceAdj = {}) {
  const base = { ...THIEF_SKILLS[Math.min(level, THIEF_SKILLS.length) - 1] };
  for (const [k, v] of Object.entries(raceAdj)) base[k] = Math.max(0, Math.min(99, base[k] + v));
  return base;
}

/** Backstab damage multiplier. */
export function backstabMultiplier(level) {
  return level <= 4 ? 2 : level <= 8 ? 3 : level <= 12 ? 4 : 5;
}
