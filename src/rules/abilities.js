/**
 * AD&D 1st Edition ability score tables (Players Handbook pp. 9-13), as used by
 * the Gold Box games. Strength uses {str, strPct} where strPct 1..100 (100 =
 * 18/00) only applies to 18 STR fighters. All functions are pure.
 */
export const ABILITIES = ['str', 'int', 'wis', 'dex', 'con', 'cha'];
export const ABILITY_NAMES = {
  str: 'Strength',
  int: 'Intelligence',
  wis: 'Wisdom',
  dex: 'Dexterity',
  con: 'Constitution',
  cha: 'Charisma',
};
export const ABILITY_ABBR = { str: 'STR', int: 'INT', wis: 'WIS', dex: 'DEX', con: 'CON', cha: 'CHA' };

const clampIdx = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Strength table row. `weight` = extra carrying allowance in coins (gp weight),
 * `doors` = open doors "x in 6", `bars` = bend bars/lift gates %.
 * @param {number} str
 * @param {number} [pct] exceptional strength 1..100 (only meaningful at 18)
 * @returns {{hit:number, dmg:number, weight:number, doors:number, bars:number}}
 */
export function strengthTable(str, pct = 0) {
  if (str <= 3) return { hit: -3, dmg: -1, weight: -350, doors: 1, bars: 0 };
  if (str <= 5) return { hit: -2, dmg: -1, weight: -250, doors: 1, bars: 0 };
  if (str <= 7) return { hit: -1, dmg: 0, weight: -150, doors: 1, bars: 0 };
  if (str <= 9) return { hit: 0, dmg: 0, weight: 0, doors: 2, bars: 1 };
  if (str <= 11) return { hit: 0, dmg: 0, weight: 0, doors: 2, bars: 2 };
  if (str <= 13) return { hit: 0, dmg: 0, weight: 100, doors: 2, bars: 4 };
  if (str <= 15) return { hit: 0, dmg: 0, weight: 200, doors: 2, bars: 7 };
  if (str === 16) return { hit: 0, dmg: 1, weight: 350, doors: 3, bars: 10 };
  if (str === 17) return { hit: 1, dmg: 1, weight: 500, doors: 3, bars: 13 };
  if (str === 18) {
    if (!pct) return { hit: 1, dmg: 2, weight: 750, doors: 3, bars: 16 };
    if (pct <= 50) return { hit: 1, dmg: 3, weight: 1000, doors: 3, bars: 20 };
    if (pct <= 75) return { hit: 2, dmg: 3, weight: 1250, doors: 4, bars: 25 };
    if (pct <= 90) return { hit: 2, dmg: 4, weight: 1500, doors: 4, bars: 30 };
    if (pct <= 99) return { hit: 2, dmg: 5, weight: 2000, doors: 4, bars: 35 };
    return { hit: 3, dmg: 6, weight: 3000, doors: 5, bars: 40 };
  }
  // 19+ : giant strength (magical). DMG giant strength table.
  const GIANT = {
    19: { hit: 3, dmg: 7, weight: 4500, doors: 7, bars: 50 },
    20: { hit: 3, dmg: 8, weight: 5000, doors: 7, bars: 60 },
    21: { hit: 4, dmg: 9, weight: 6000, doors: 9, bars: 70 },
    22: { hit: 4, dmg: 10, weight: 7500, doors: 11, bars: 80 },
    23: { hit: 5, dmg: 11, weight: 9000, doors: 11, bars: 90 },
    24: { hit: 6, dmg: 12, weight: 12000, doors: 19, bars: 100 },
    25: { hit: 7, dmg: 14, weight: 15000, doors: 19, bars: 100 },
  };
  return { ...GIANT[clampIdx(str, 19, 25)] };
}

/**
 * Strength to-hit and damage adjustments (the combat-relevant part of strengthTable).
 * @returns {{hit:number, dmg:number}}
 */
export function strengthMods(str, pct = 0) {
  const { hit, dmg } = strengthTable(str, pct);
  return { hit, dmg };
}

/**
 * Dexterity: `ac` adjustment (negative = better), `missile` to-hit adj,
 * `reaction` (surprise/initiative) adj. The defensive adjustment also applies to
 * saving throws vs dodgeable magic (fireball, lightning bolt): use `-ac`.
 */
export function dexterityMods(dex) {
  const d = clampIdx(dex, 3, 19);
  const ac = { 3: 4, 4: 3, 5: 2, 6: 1, 15: -1, 16: -2, 17: -3, 18: -4, 19: -4 }[d] ?? 0;
  const missile = { 3: -3, 4: -2, 5: -1, 16: 1, 17: 2, 18: 3, 19: 3 }[d] ?? 0;
  return { ac, missile, reaction: missile };
}

/**
 * Constitution hit point adjustment per hit die. Only fighters benefit from
 * +3/+4 at 17/18 (and +5 at 19).
 */
export function conHpBonus(con, isFighter) {
  if (con <= 3) return -2;
  if (con <= 6) return -1;
  if (con <= 14) return 0;
  if (con === 15) return 1;
  if (con === 16) return 2;
  if (con === 17) return isFighter ? 3 : 2;
  if (con === 18) return isFighter ? 4 : 2;
  return isFighter ? 5 : 2;
}

/** Constitution: system shock % and resurrection survival %. */
export function constitutionTable(con) {
  const c = clampIdx(con, 3, 19);
  const shock = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 88, 91, 95, 97, 99, 99][c - 3] ?? 99;
  const res = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 92, 94, 96, 98, 100, 100][c - 3] ?? 100;
  return { hp: conHpBonus(c, false), hpFighter: conHpBonus(c, true), systemShock: shock, resurrection: res };
}

/** Wisdom bonus cleric spells per spell level [L1, L2, L3, L4]. */
export function wisdomBonusSpells(wis) {
  const b = [0, 0, 0, 0];
  if (wis >= 13) b[0]++;
  if (wis >= 14) b[0]++;
  if (wis >= 15) b[1]++;
  if (wis >= 16) b[1]++;
  if (wis >= 17) b[2]++;
  if (wis >= 18) b[3]++;
  return b;
}

/**
 * Wisdom magical attack adjustment: bonus (or penalty) to saving throws vs
 * mind-affecting magic (charm, hold, fear, illusion...).
 */
export function wisdomSaveAdj(wis) {
  const w = clampIdx(wis, 3, 19);
  return { 3: -3, 4: -2, 5: -1, 6: -1, 7: -1, 15: 1, 16: 2, 17: 3, 18: 4, 19: 4 }[w] ?? 0;
}

/** Cleric chance of spell failure (%) for low wisdom. */
export function wisdomSpellFailure(wis) {
  if (wis <= 8) return 25 + (8 - Math.max(3, wis)) * 5;
  return { 9: 20, 10: 15, 11: 10, 12: 5 }[wis] ?? 0;
}

/**
 * Intelligence for magic-users: highest spell level learnable, % chance to know
 * each spell, minimum/maximum number of spells per level in the spell book.
 */
export function intelligenceTable(int) {
  const i = clampIdx(int, 3, 19);
  // PHB "possible # of additional languages" column (19: DMG).
  const languages = { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1, 9: 1, 10: 2, 11: 2, 12: 3, 13: 3, 14: 4, 15: 4, 16: 5, 17: 6, 18: 7, 19: 8 }[i];
  if (i <= 8) return { maxSpellLevel: 0, knowChance: 0, minSpells: 0, maxSpells: 0, languages };
  if (i === 9) return { maxSpellLevel: 4, knowChance: 35, minSpells: 4, maxSpells: 6, languages };
  if (i <= 12) return { maxSpellLevel: 5, knowChance: 45, minSpells: 5, maxSpells: 7, languages };
  if (i <= 14) return { maxSpellLevel: 6, knowChance: 55, minSpells: 6, maxSpells: 9, languages };
  if (i <= 16) return { maxSpellLevel: 7, knowChance: 65, minSpells: 7, maxSpells: 11, languages };
  if (i === 17) return { maxSpellLevel: 8, knowChance: 75, minSpells: 8, maxSpells: 14, languages };
  if (i === 18) return { maxSpellLevel: 9, knowChance: 85, minSpells: 9, maxSpells: 18, languages };
  return { maxSpellLevel: 9, knowChance: 95, minSpells: 10, maxSpells: Infinity, languages };
}

/** Charisma: max henchmen, loyalty base %, reaction adjustment %. */
export function charismaTable(cha) {
  const c = clampIdx(cha, 3, 18);
  const hench = [1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 7, 8, 10, 15][c - 3];
  const loyalty = [-30, -25, -20, -15, -10, -5, 0, 0, 0, 0, 0, 5, 15, 20, 30, 40][c - 3];
  // PHB: 8-12 neutral, then 13:+5 14:+10 15:+15 16:+25 17:+30 18:+35.
  const reaction = [-25, -20, -15, -10, -5, 0, 0, 0, 0, 0, 5, 10, 15, 25, 30, 35][c - 3];
  return { henchmen: hench, loyalty, reaction };
}

/**
 * Everything the character sheet wants to show about one ability, keyed by
 * ability id (tooltip-ready).
 */
export function abilitySummary(abilities) {
  const a = abilities;
  return {
    str: strengthTable(a.str, a.strPct),
    int: intelligenceTable(a.int),
    wis: { saveAdj: wisdomSaveAdj(a.wis), bonusSpells: wisdomBonusSpells(a.wis), failure: wisdomSpellFailure(a.wis) },
    dex: dexterityMods(a.dex),
    con: constitutionTable(a.con),
    cha: charismaTable(a.cha),
  };
}

/** Format STR the old-school way: "18(76)" or "18(00)". */
export function formatStr(str, pct) {
  if (str === 18 && pct) return `18(${pct === 100 ? '00' : String(pct).padStart(2, '0')})`;
  return String(str);
}

/**
 * Add `points` of strength to a (str, pct) pair, the way the Strength spell
 * does. PHB: "a number of points — or tenths of points after 18 strength is
 * attained (only if the character is a fighter)": above 18 each point is 10%
 * exceptional strength (18 → 18/10 ... 18/90 → 18/00), capped at 18/00;
 * non-fighters stop at 18.
 * @returns {{str:number, strPct:number}}
 */
export function addStrength(str, pct, points, exceptional = true) {
  let s = str;
  let p = pct || 0;
  for (let i = 0; i < points; i++) {
    if (s < 18) { s++; continue; }
    if (!exceptional || p >= 100) break;
    p = Math.min(100, p + 10);
  }
  return { str: s, strPct: s === 18 ? p : 0 };
}

/** Compare strengths: > 0 when a is stronger than b. */
export function compareStr(a, ap, b, bp) {
  return (a - b) * 1000 + ((a === 18 ? ap || 0 : 0) - (b === 18 ? bp || 0 : 0));
}
