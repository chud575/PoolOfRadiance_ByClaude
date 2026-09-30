/**
 * AD&D 1st Edition ability score tables (Players Handbook), as used by the
 * Gold Box games. Strength uses {str, strPct} where strPct 1..100 (100 = 18/00)
 * only applies to 18 STR fighters.
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

/**
 * Strength to-hit and damage adjustments.
 * @param {number} str
 * @param {number} [pct] exceptional strength 1..100 (only meaningful at 18)
 * @returns {{hit:number, dmg:number}}
 */
export function strengthMods(str, pct = 0) {
  if (str <= 3) return { hit: -3, dmg: -1 };
  if (str <= 5) return { hit: -2, dmg: -1 };
  if (str <= 7) return { hit: -1, dmg: 0 };
  if (str <= 16) return { hit: 0, dmg: 0 };
  if (str === 17) return { hit: 1, dmg: 1 };
  if (str === 18) {
    if (!pct) return { hit: 1, dmg: 2 };
    if (pct <= 50) return { hit: 1, dmg: 3 };
    if (pct <= 75) return { hit: 2, dmg: 3 };
    if (pct <= 90) return { hit: 2, dmg: 4 };
    if (pct <= 99) return { hit: 2, dmg: 5 };
    return { hit: 3, dmg: 6 };
  }
  // 19+ (magical)
  const extra = str - 19;
  return { hit: 3 + Math.ceil(extra / 2), dmg: 7 + extra };
}

/** Dexterity: AC adjustment (negative = better) and reaction/missile to-hit adj. */
export function dexterityMods(dex) {
  const ac = { 3: 4, 4: 3, 5: 2, 6: 1, 15: -1, 16: -2, 17: -3, 18: -4 }[Math.min(dex, 18)] ?? 0;
  const missile = { 3: -3, 4: -2, 5: -1, 16: 1, 17: 2, 18: 3 }[Math.min(dex, 18)] ?? 0;
  return { ac, missile, reaction: missile };
}

/**
 * Constitution hit point adjustment per hit die.
 * Only fighters benefit from +3/+4 at 17/18.
 * @param {number} con
 * @param {boolean} isFighter
 */
export function conHpBonus(con, isFighter) {
  if (con <= 3) return -2;
  if (con <= 6) return -1;
  if (con <= 14) return 0;
  if (con === 15) return 1;
  if (con === 16) return 2;
  if (con === 17) return isFighter ? 3 : 2;
  return isFighter ? 4 : 2;
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

/** Format STR the old-school way: "18(76)" or "18(00)". */
export function formatStr(str, pct) {
  if (str === 18 && pct) return `18(${pct === 100 ? '00' : String(pct).padStart(2, '0')})`;
  return String(str);
}
