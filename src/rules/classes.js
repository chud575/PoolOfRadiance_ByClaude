/**
 * AD&D 1e class tables (PHB + DMG): hit dice, XP progression, THAC0 (DMG attack
 * matrices), saving throws, spell slots, thief skills, turn undead, alignment
 * and weapon/armour permissions, plus Pool of Radiance's level caps.
 *
 * Class ids: fighter, cleric, magicUser, thief. A character's class spec is
 * 'fighter' or a multiclass joined by '/' (e.g. 'fighter/magicUser/thief');
 * rules functions accept class ids.
 */

const ALL_ALIGN = ['LG', 'NG', 'CG', 'LN', 'TN', 'CN', 'LE', 'NE', 'CE'];
export const ALIGNMENTS = ALL_ALIGN;
export const ALIGNMENT_NAMES = {
  LG: 'Lawful Good', NG: 'Neutral Good', CG: 'Chaotic Good',
  LN: 'Lawful Neutral', TN: 'True Neutral', CN: 'Chaotic Neutral',
  LE: 'Lawful Evil', NE: 'Neutral Evil', CE: 'Chaotic Evil',
};

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
    // PHB: XP needed for each level (level = index + 1); beyond: +250,000/level.
    xp: [0, 2001, 4001, 8001, 18001, 35001, 70001, 125001, 250001, 500001, 750001],
    xpStep: 250000,
    weapons: 'any',
    armor: 'any',
    shield: true,
    alignments: ALL_ALIGN,
    /** DMG attack matrix: THAC0 by level band [maxLevel, thac0]. Level 0 = 21. */
    thac0: [[0, 21], [2, 20], [4, 18], [6, 16], [8, 14], [10, 12], [12, 10], [14, 8], [16, 6], [99, 4]],
    startGold: '5d4x10',
    desc: 'Masters of arms and armour; the backbone of any party.',
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
    xp: [0, 1501, 3001, 6001, 13001, 27501, 55001, 110001, 225001, 450001, 675001],
    xpStep: 225000,
    // Blunt weapons only (no edged weapons that draw blood).
    weapons: ['club', 'flail', 'hammer', 'mace', 'staff', 'morningStar'],
    armor: 'any',
    shield: true,
    alignments: ALL_ALIGN,
    thac0: [[3, 20], [6, 18], [9, 16], [12, 14], [15, 12], [18, 10], [99, 9]],
    startGold: '3d6x10',
    desc: 'Priests of Tyr and the gods of Phlan: healers, warders and turners of the undead.',
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
    xp: [0, 2501, 5001, 10001, 22501, 40001, 60001, 90001, 135001, 250001, 375001, 750001, 1125001, 1500001, 1875001],
    xpStep: 375000,
    weapons: ['dagger', 'dart', 'staff'],
    armor: 'none',
    shield: false,
    alignments: ALL_ALIGN,
    thac0: [[5, 21], [10, 19], [15, 16], [20, 13], [99, 11]],
    startGold: '2d4x10',
    desc: 'Frail scholars of the Art whose spells can turn a battle in a single round.',
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
    xp: [0, 1251, 2501, 5001, 10001, 20001, 42501, 70001, 110001, 160001, 220001],
    xpStep: 220000,
    weapons: ['club', 'dagger', 'dart', 'shortSword', 'longSword', 'broadSword', 'sling'],
    armor: ['leather', 'padded', 'studded'],
    shield: false,
    // PHB: thieves are neutral or evil (neutral good is allowed; LG/CG are not).
    alignments: ['NG', 'LN', 'TN', 'CN', 'LE', 'NE', 'CE'],
    thac0: [[4, 21], [8, 19], [12, 16], [16, 14], [20, 12], [99, 10]],
    startGold: '2d6x10',
    desc: 'Scouts, lock-pickers and backstabbers who strike from the shadows.',
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

/**
 * Pool of Radiance level caps (the game engine's ceiling, below the racial
 * limits). Training halls will not train beyond these.
 */
export const PR_LEVEL_CAPS = { fighter: 8, cleric: 6, magicUser: 6, thief: 9 };

/** Split 'fighter/thief' → ['fighter','thief'] */
export function splitClasses(spec) {
  return String(spec).split('/');
}

export function classSpecName(spec) {
  return splitClasses(spec).map((c) => CLASSES[c].name).join('/');
}

/** Short form "F/MU/T". */
export function classSpecAbbr(spec) {
  return splitClasses(spec).map((c) => CLASSES[c].abbr).join('/');
}

/** XP needed to reach `level` in class. */
export function xpForLevel(classId, level) {
  const { xp: table, xpStep } = CLASSES[classId];
  if (level <= 1) return 0;
  if (level <= table.length) return table[level - 1];
  return table[table.length - 1] + (level - table.length) * xpStep;
}

/** Level for a given XP in a single class (ignores caps and training). */
export function levelForXp(classId, xp) {
  const { xp: table, xpStep } = CLASSES[classId];
  const last = table[table.length - 1];
  if (xp >= last) return table.length + Math.floor((xp - last) / xpStep);
  let lvl = 1;
  for (let i = 0; i < table.length; i++) if (xp >= table[i]) lvl = i + 1;
  return lvl;
}

/** THAC0 for one class at a level (DMG attack matrices). */
export function thac0For(classId, level) {
  const rows = CLASSES[classId].thac0;
  return rows.find(([max]) => level <= max)[1];
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
export const SAVE_SHORT = { ppdm: 'Para/Poison/Death', pp: 'Petri/Poly', rsw: 'Rod/Staff/Wand', bw: 'Breath', sp: 'Spell' };

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

/**
 * Effective hit dice of a monster for saves/attacks: each +N hp bonus of 1-2
 * counts as a partial die (DMG: 1+1 HD saves as 2 HD). < 1 HD = 0.
 */
export function effectiveHd(hd, hpBonus = 0) {
  if (hd < 1) return 0;
  return Math.floor(hd) + (hpBonus > 0 ? 1 : 0);
}

/** Monster saves: as fighter of level = effective HD (0-level for < 1 HD). */
export function monsterSaves(hd, hpBonus = 0) {
  return savesFor('fighter', effectiveHd(hd, hpBonus));
}

/**
 * Monster THAC0 by hit dice (DMG monster attack matrix).
 * @param {number} hd
 * @param {number} [hpBonus]
 */
export function monsterThac0(hd, hpBonus = 0) {
  if (hd < 1) return 20;
  if (hd === 1 && hpBonus < 0) return 20;
  if (hd === 1 && hpBonus === 0) return 19;
  if (hd < 2) return 18; // 1+
  if (hd < 4) return 16; // 2 to 3+
  if (hd < 6) return 15;
  if (hd < 8) return 13;
  if (hd < 10) return 12;
  if (hd < 12) return 10;
  if (hd < 14) return 9;
  if (hd < 16) return 8;
  return 7;
}

/** Spell slots per level for cleric (without wisdom bonus). Index = char level - 1. */
const CLERIC_SLOTS = [
  [1], [2], [2, 1], [3, 2], [3, 3, 1], [3, 3, 2], [3, 3, 2, 1], [3, 3, 3, 2], [4, 4, 3, 2, 1],
  [4, 4, 3, 3, 2], [5, 4, 4, 3, 2, 1], [6, 5, 5, 3, 2, 2], [6, 6, 6, 4, 2, 2], [6, 6, 6, 5, 3, 2],
];
const MU_SLOTS = [
  [1], [2], [2, 1], [3, 2], [4, 2, 1], [4, 2, 2], [4, 3, 2, 1], [4, 3, 3, 2], [4, 3, 3, 2, 1],
  [4, 4, 3, 2, 2], [4, 4, 4, 3, 3], [4, 4, 4, 4, 4, 1], [5, 5, 5, 4, 4, 2], [5, 5, 5, 4, 4, 2, 1],
];

/** @returns {number[]} slots indexed by spell level-1 */
export function spellSlots(classId, level) {
  const t = classId === 'cleric' ? CLERIC_SLOTS : classId === 'magicUser' ? MU_SLOTS : null;
  if (!t || level < 1) return [];
  return [...t[Math.min(level, t.length) - 1]];
}

/** Highest spell level castable by class/level (0 if none). */
export function maxSpellLevel(classId, level) {
  return spellSlots(classId, level).length;
}

/** Base thief skills by level (PHB): pp, ol, ft, ms, hs, hn (in 6-sided "x in d100"), cw, rl. */
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
  { pp: 90, ol: 72, ft: 70, ms: 86, hs: 70, hn: 35, cw: 99, rl: 55 },
  { pp: 100, ol: 77, ft: 75, ms: 94, hs: 77, hn: 35, cw: 99, rl: 60 },
  { pp: 105, ol: 82, ft: 80, ms: 99, hs: 85, hn: 40, cw: 99, rl: 65 },
  { pp: 110, ol: 87, ft: 85, ms: 99, hs: 93, hn: 40, cw: 99, rl: 70 },
  { pp: 115, ol: 92, ft: 90, ms: 99, hs: 99, hn: 50, cw: 99, rl: 75 },
];
export const THIEF_SKILL_IDS = ['pp', 'ol', 'ft', 'ms', 'hs', 'hn', 'cw', 'rl'];
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

/** PHB dexterity adjustments to thief skills. */
export function thiefDexAdj(dex) {
  const t = {
    9: { pp: -15, ol: -10, ft: -10, ms: -20, hs: -10 },
    10: { pp: -10, ol: -5, ft: -10, ms: -15, hs: -5 },
    11: { pp: -5, ol: 0, ft: -5, ms: -10, hs: 0 },
    12: { pp: 0, ol: 0, ft: 0, ms: -5, hs: 0 },
    16: { ol: 5 },
    17: { pp: 5, ol: 10, ms: 5, hs: 5 },
    18: { pp: 10, ol: 15, ft: 5, ms: 10, hs: 10 },
    19: { pp: 15, ol: 20, ft: 10, ms: 15, hs: 15 },
  };
  if (dex < 9) return { ...t[9] };
  return { ...(t[Math.min(19, dex)] ?? {}) };
}

/**
 * Thief skill percentages. Accepts any number of adjustment objects (racial,
 * dexterity, armour) and sums them. Results clamp to 0..99 (read languages to
 * 0..80 per PHB).
 */
export function thiefSkills(level, ...adjs) {
  const base = { ...THIEF_SKILLS[Math.max(1, Math.min(level, THIEF_SKILLS.length)) - 1] };
  for (const adj of adjs) {
    for (const [k, v] of Object.entries(adj ?? {})) if (k in base) base[k] += v;
  }
  for (const k of THIEF_SKILL_IDS) base[k] = Math.max(0, Math.min(k === 'rl' ? 80 : 99, base[k]));
  return base;
}

/** Backstab damage multiplier. */
export function backstabMultiplier(level) {
  return level <= 4 ? 2 : level <= 8 ? 3 : level <= 12 ? 4 : 5;
}

/**
 * Fighter melee attacks per round (PHB): 1/1 at 1-6, 3/2 at 7-12, 2/1 at 13+.
 * Returned as a rational number (1.5 = 3 attacks every 2 rounds).
 */
export function fighterAttacksPerRound(level) {
  return level >= 13 ? 2 : level >= 7 ? 1.5 : 1;
}

/**
 * Attacks this round for a rate (1.5 → alternates 1,2,1,2 by round parity).
 * @param {number} rate
 * @param {number} round 1-based combat round
 */
export function attacksThisRound(rate, round = 1) {
  const whole = Math.floor(rate);
  const frac = rate - whole;
  return whole + (frac > 0 && round % Math.round(1 / frac) === 0 ? 1 : 0);
}

/**
 * AD&D 1e Turn Undead matrix (DMG p.75). Rows by undead type, columns by cleric
 * level 1,2,3,4,5,6,7,8,9-13,14+. Number = d20 needed, 'T' = turned
 * automatically, 'D' = destroyed, 'D*' = destroyed, d6+6 affected, '-' = no effect.
 */
export const TURN_UNDEAD = {
  skeleton: [10, 7, 4, 'T', 'T', 'D', 'D', 'D*', 'D*', 'D*'],
  zombie: [13, 10, 7, 'T', 'T', 'D', 'D', 'D', 'D*', 'D*'],
  ghoul: [16, 13, 10, 4, 'T', 'T', 'D', 'D', 'D', 'D*'],
  shadow: [19, 16, 13, 7, 4, 'T', 'T', 'D', 'D', 'D*'],
  wight: [20, 19, 16, 10, 7, 4, 'T', 'T', 'D', 'D'],
  ghast: ['-', 20, 19, 13, 10, 7, 4, 'T', 'T', 'D'],
  wraith: ['-', '-', 20, 16, 13, 10, 7, 4, 'T', 'D'],
  mummy: ['-', '-', '-', 20, 16, 13, 10, 7, 4, 'T'],
  spectre: ['-', '-', '-', '-', 20, 16, 13, 10, 7, 'T'],
  vampire: ['-', '-', '-', '-', '-', 20, 16, 13, 10, 4],
  ghost: ['-', '-', '-', '-', '-', '-', 20, 16, 13, 7],
  lich: ['-', '-', '-', '-', '-', '-', '-', 19, 16, 10],
  special: ['-', '-', '-', '-', '-', '-', '-', 20, 19, 13],
};
export const UNDEAD_TYPES = Object.keys(TURN_UNDEAD);

/** Column index into TURN_UNDEAD for a cleric level. */
export function turnColumn(level) {
  if (level >= 14) return 9;
  if (level >= 9) return 8;
  return Math.max(0, level - 1);
}

/** What a cleric of `level` needs vs undead `type` (number, 'T', 'D', 'D*' or '-'). */
export function turnNeeded(level, type) {
  const row = TURN_UNDEAD[type] ?? TURN_UNDEAD.zombie;
  return row[turnColumn(level)];
}

/**
 * Alignments legal for a class spec (intersection for multiclass).
 * @returns {string[]}
 */
export function allowedAlignments(spec) {
  return splitClasses(spec).reduce((acc, c) => acc.filter((a) => CLASSES[c].alignments.includes(a)), ALL_ALIGN);
}

/** Is the character's class spec one that includes a spellcasting class? */
export function casterClasses(spec) {
  return splitClasses(spec).filter((c) => c === 'cleric' || c === 'magicUser');
}
