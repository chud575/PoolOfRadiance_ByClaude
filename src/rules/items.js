import { ITEMS } from '../data/items.js';

/**
 * Item rules: +N enchantments, names, values, weights, armour movement,
 * rate of fire, encumbrance. Items are ItemDefs in data/items.js; a character's
 * inventory holds InventoryEntry records which may override the enchantment
 * (`entry.magic`) so treasure can produce "Long Sword +2" from the plain
 * `longSword` definition without a data entry per combination.
 *
 * Optional ItemDef fields understood by the rules (all additive, see ARCHITECTURE.md):
 *   magic         +N to hit/damage (weapons) or AC (armour, shields, protection items)
 *   magicVs       { undead|evil|giant|...: extra +N } situational bonus
 *   acBase        sets base AC like armour (bracers of defense: 6, 4 ...)
 *   acBonus       AC improvement (shield 1, ring/cloak of protection N)
 *   saveBonus     bonus to all saving throws (ring/cloak of protection)
 *   setStr        {str, strPct} (gauntlets of ogre power: 18/00)
 *   rateOfFire    missiles per round (bows 2, darts 3)
 *   cursed        true: cannot be unequipped until remove curse
 *   spells        scroll: list of spell ids; effect: potion/wand effect string
 */

/** Coins weigh 1 "cn" each; 10 cn = 1 lb. Item weights in data are in cn. */
export const COIN_WEIGHT = 1;
export const COIN_VALUES_GP = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 5 };

/** PHB armour base movement (inches) by armour group. */
export const ARMOR_MOVE = {
  leather: 12, padded: 9, studded: 9, ring: 9, scale: 6, chain: 9, elfin: 12, banded: 9, splint: 6, plate: 6,
};

/** Default missile rate of fire (per round) by weapon group (PHB). */
export const RATE_OF_FIRE = { shortBow: 2, longBow: 2, compositeBow: 2, dart: 3, dagger: 2, lightCrossbow: 1, heavyCrossbow: 0.5, sling: 1, handAxe: 1, spear: 1 };

/**
 * DMG rules the world data does not (yet) state, merged over the ItemDef by
 * itemRulesOf(). Overrides win: the Wand of Paralyzation releases its own
 * cone (any creature, save vs wand) rather than Hold Person; Gauntlets of
 * Ogre Power are usable by clerics, fighters and thieves only; potions of
 * Giant Strength and Heroism are fighter-only (DMG 'F') — a non-fighter who
 * drinks one gains nothing; the Necklace of Missiles carries fireball beads
 * (DMG type I: one 5 HD and two 3 HD missiles).
 */
export const ITEM_RULES = Object.freeze({
  wandParalyzation: { effect: 'wandParalyzation' },
  gauntletsOgrePower: { classes: ['cleric', 'fighter', 'thief'] },
  potionGiantStrength: { fighterOnly: true },
  potionHeroism: { effect: 'heroism', fighterOnly: true },
  necklaceMissiles: { effect: 'necklaceMissiles', beads: [5, 3, 3] },
});

/**
 * The ItemDef with ITEM_RULES applied — what every rule that reads `classes`,
 * `effect`, `fighterOnly` or `beads` should use.
 * @param {string|{id:string}|object} idOrDef id, inventory entry or ItemDef
 */
export function itemRulesOf(idOrDef) {
  const def = ITEMS[typeof idOrDef === 'string' ? idOrDef : idOrDef?.id] ?? (typeof idOrDef === 'object' && idOrDef?.type ? idOrDef : undefined);
  if (!def) return undefined;
  const o = ITEM_RULES[def.id];
  return o ? { ...def, ...o } : def;
}

/**
 * @param {string|{id:string}} idOrEntry
 * @returns {import('../data/schema.js').ItemDef|undefined}
 */
export function itemDef(idOrEntry) {
  return ITEMS[typeof idOrEntry === 'string' ? idOrEntry : idOrEntry?.id];
}

/** Enchantment of an inventory entry (entry override → def → 0). */
export function itemMagic(entry) {
  return entry?.magic ?? itemDef(entry)?.magic ?? 0;
}

/** Is the entry magical at all (enchanted, or a magic-only item type)? */
export function isMagical(entry) {
  const d = itemDef(entry);
  if (!d) return false;
  return itemMagic(entry) !== 0 || ['potion', 'scroll', 'wand', 'ring'].includes(d.type) || !!(d.setStr || d.acBase || d.saveBonus || d.magicVs);
}

/**
 * Display name. Unidentified magic shows its mundane/unidentified name.
 * @param {import('./character.js').InventoryEntry} entry
 */
export function itemName(entry) {
  const d = itemDef(entry);
  if (!d) return entry?.id ?? '?';
  const m = entry.magic;
  if (entry.identified === false) return d.unidName ?? d.name.replace(/\s*[+-]\d+$/, '');
  if (m !== undefined && m !== (d.magic ?? 0)) {
    const base = d.name.replace(/\s*[+-]\d+$/, '');
    return m === 0 ? base : `${base} ${m > 0 ? '+' : ''}${m}`;
  }
  return d.name;
}

/** gp value (sale price at shops = half, the scene decides). */
export function itemValue(entry) {
  const d = itemDef(entry);
  if (!d) return 0;
  const qty = entry.qty ?? 1;
  const m = itemMagic(entry);
  const base = d.cost ?? 0;
  if (m === (d.magic ?? 0) || m <= 0) return base * (d.type === 'ammo' ? 1 : qty);
  // Treasure-made enchantments: DMG-like scaling.
  const perPlus = d.type === 'weapon' ? 1500 : d.type === 'armor' || d.type === 'shield' ? 1250 : 1000;
  return base + perPlus * m * m;
}

/** Weight in cn of an entry (magic armour weighs half, per DMG). */
export function itemWeight(entry) {
  const d = itemDef(entry);
  if (!d) return 0;
  const qty = d.type === 'ammo' ? 1 : entry.qty ?? 1;
  let w = (d.weight ?? 0) * qty;
  if ((d.type === 'armor') && itemMagic(entry) > 0) w = Math.ceil(w / 2);
  return w;
}

/** Missiles per round for a weapon def. */
export function rateOfFire(def) {
  if (!def?.ranged) return 1;
  return def.rateOfFire ?? RATE_OF_FIRE[def.weaponGroup] ?? 1;
}

/**
 * Base movement allowed by worn armour (PHB table). Magic armour moves at the
 * same base rate; its benefit is half weight (see itemWeight), which shows up
 * through encumbrance. `magic` is accepted for API compatibility.
 */
export function armorMoveLimit(armorDef, magic = 0) { // eslint-disable-line no-unused-vars
  if (!armorDef) return 12;
  return ARMOR_MOVE[armorDef.armorGroup] ?? 12;
}

/**
 * Total coin weight carried by a character (all denominations).
 * @param {{gold?:number, coins?:Record<string,number>}} ch
 */
export function coinWeight(ch) {
  // ch.gold is the gp purse; ch.coins (optional) holds the other denominations.
  let n = ch.gold ?? 0;
  for (const v of Object.values(ch.coins ?? {})) n += v;
  return n * COIN_WEIGHT;
}

/** Value in gp of a coin purse {cp,sp,ep,gp,pp}. */
export function coinsToGp(coins = {}) {
  let t = 0;
  for (const [k, v] of Object.entries(coins)) t += (COIN_VALUES_GP[k] ?? 0) * v;
  return Math.floor(t);
}

/**
 * PHB encumbrance: unencumbered to 350 cn, then 9"/6"/3" at 700/1050/1500,
 * each threshold raised by the STR weight allowance. Beyond the last, the
 * character cannot move (move 0 → the UI should warn "overloaded").
 * @param {number} weight  cn carried
 * @param {number} allowance  STR weight allowance (strengthTable().weight)
 * @returns {{category:0|1|2|3|4, move:number, label:string, next:number}}
 */
export function encumbranceCategory(weight, allowance = 0) {
  const t = [350, 700, 1050, 1500].map((v) => v + allowance);
  const labels = ['Unencumbered', 'Normal', 'Heavy', 'Very heavy', 'Overloaded'];
  const moves = [12, 9, 6, 3, 0];
  let cat = t.findIndex((v) => weight <= v);
  if (cat < 0) cat = 4;
  return { category: /** @type {0|1|2|3|4} */ (cat), move: moves[cat], label: labels[cat], next: t[cat] ?? Infinity };
}

/** Make a fresh inventory entry for an item id. */
export function makeEntry(itemId, o = {}) {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`Unknown item ${itemId}`);
  const entry = { id: itemId, qty: o.qty ?? def.qty ?? 1, identified: o.identified ?? !def.unidName, equipped: false };
  if (o.magic !== undefined) {
    entry.magic = o.magic;
    if (o.identified === undefined && o.magic !== 0) entry.identified = false;
  }
  if (def.charges || o.charges) entry.charges = o.charges ?? def.charges;
  const beads = ITEM_RULES[itemId]?.beads;
  if (beads && entry.charges === undefined) entry.charges = beads.length;
  if (o.spells) entry.spells = [...o.spells];
  if (o.cursed) entry.cursed = true;
  return entry;
}
