/**
 * The 1e to-hit roll. THAC0 - AC gives the d20 roll needed, with the DMG's
 * "repeating 20" rule: a natural 20 is needed for six consecutive AC steps
 * before the requirement climbs to 21+ (so THAC0 21 still hits AC 0 on a 20,
 * and a roll of 20 hits anything up to 5 AC steps beyond a flat 20).
 *
 * @param {number} thac0
 * @param {number} ac      defender armour class
 * @param {number} [bonus] attacker's total to-hit bonus (STR/DEX, magic, bless...)
 * @returns {number} d20 roll needed (may be > 20 = impossible, <= 1 = always hits on a non-1)
 */
export function neededToHit(thac0, ac, bonus = 0) {
  const raw = thac0 - ac - bonus;
  if (raw <= 20) return raw;
  if (raw <= 25) return 20;
  return raw - 5;
}
