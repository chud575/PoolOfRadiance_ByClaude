import { roll } from './dice.js';
import { ITEMS } from '../data/items.js';
import { makeEntry } from './items.js';
import { spellsForClass } from './spells.js';
import { COIN_VALUES_GP } from './items.js';

/**
 * Treasure generation after the Monster Manual / DMG treasure types, scaled
 * for Pool of Radiance's economy. Output is plain data the scene hands to the
 * party (VIEW/TAKE/POOL/SHARE in the treasure screen).
 *
 * @typedef {Object} Treasure
 * @property {{cp:number, sp:number, ep:number, gp:number, pp:number}} coins
 * @property {{name:string, value:number}[]} gems
 * @property {{name:string, value:number}[]} jewelry
 * @property {import('./character.js').InventoryEntry[]} items
 * @property {number} [maps]   treasure maps found (type W)
 */

/** [pct, dice] per column, dice in coins (already multiplied). Magic: [pct, count, kind]. */
export const TREASURE_TYPES = {
  A: { cp: [25, '1d6x1000'], sp: [30, '1d6x1000'], ep: [35, '1d6x1000'], gp: [40, '1d10x1000'], pp: [25, '1d4x100'], gems: [60, '4d10'], jewelry: [50, '3d10'], magic: [30, 3, 'any'] },
  B: { cp: [50, '1d8x1000'], sp: [25, '1d6x1000'], ep: [25, '1d4x1000'], gp: [25, '1d3x1000'], gems: [30, '1d8'], jewelry: [20, '1d4'], magic: [10, 1, 'armsArmor'] },
  C: { cp: [20, '1d12x1000'], sp: [30, '1d6x1000'], ep: [10, '1d4x1000'], gems: [25, '1d6'], jewelry: [20, '1d3'], magic: [10, 2, 'any'] },
  D: { cp: [10, '1d8x1000'], sp: [15, '1d12x1000'], ep: [15, '1d8x1000'], gp: [50, '1d6x1000'], gems: [30, '1d10'], jewelry: [25, '1d6'], magic: [15, 2, 'any'], potions: [15, 1] },
  E: { cp: [5, '1d10x1000'], sp: [25, '1d12x1000'], ep: [25, '1d6x1000'], gp: [25, '1d8x1000'], gems: [15, '1d12'], jewelry: [10, '1d8'], magic: [25, 3, 'any'], scrolls: [25, 1] },
  F: { sp: [10, '1d20x1000'], ep: [15, '1d12x1000'], gp: [40, '1d10x1000'], pp: [35, '1d8x100'], gems: [20, '3d10'], jewelry: [10, '1d10'], magic: [30, 3, 'noWeapons'], potions: [30, 1], scrolls: [30, 1] },
  G: { gp: [50, '10d4x1000'], pp: [50, '1d20x100'], gems: [30, '5d4'], jewelry: [25, '1d10'], magic: [35, 4, 'any'], scrolls: [35, 1] },
  H: { cp: [25, '5d6x1000'], sp: [40, '1d100x1000'], ep: [40, '10d4x1000'], gp: [55, '10d6x1000'], pp: [25, '5d10x100'], gems: [50, '1d100'], jewelry: [50, '10d4'], magic: [15, 4, 'any'], potions: [15, 1], scrolls: [15, 1] },
  I: { pp: [30, '3d6x100'], gems: [55, '2d10'], jewelry: [50, '1d12'], magic: [15, 1, 'any'] },
  // Individual / small hoards
  J: { cp: [100, '3d8'] },
  K: { sp: [100, '3d6'] },
  L: { ep: [100, '2d6'] },
  M: { gp: [100, '2d4'] },
  N: { pp: [100, '1d6'] },
  O: { cp: [25, '1d4x1000'], sp: [20, '1d3x1000'] },
  P: { sp: [30, '1d6x1000'], ep: [25, '1d2x1000'] },
  Q: { gems: [50, '1d4'] },
  R: { gp: [40, '2d4x1000'], pp: [50, '10d6x10'], gems: [55, '4d8'], jewelry: [45, '1d12'] },
  S: { potions: [40, '2d4'] },
  T: { scrolls: [50, '1d4'] },
  U: { gems: [90, '10d8'], jewelry: [80, '5d6'], magic: [70, 1, 'any'] },
  V: { magic: [85, 2, 'any'] },
  W: { gp: [60, '5d6x1000'], pp: [15, '1d8x100'], gems: [60, '10d8'], jewelry: [50, '5d8'], maps: [55, 1] },
  X: { magic: [60, 1, 'misc'], potions: [60, 1] },
  Y: { gp: [70, '2d6x1000'] },
  Z: { cp: [20, '1d3x1000'], sp: [25, '1d4x1000'], ep: [25, '1d4x1000'], gp: [30, '1d4x1000'], pp: [30, '1d6x100'], gems: [55, '10d6'], jewelry: [50, '5d6'], magic: [50, 3, 'any'] },
};

const GEM_NAMES = {
  10: ['azurite', 'banded agate', 'blue quartz', 'hematite', 'malachite', 'obsidian', 'tiger eye', 'turquoise'],
  50: ['bloodstone', 'carnelian', 'chalcedony', 'citrine', 'jasper', 'moonstone', 'onyx', 'sardonyx', 'zircon'],
  100: ['amber', 'alexandrite', 'amethyst', 'coral', 'garnet', 'jade', 'jet', 'pearl', 'spinel', 'tourmaline'],
  500: ['aquamarine', 'black pearl', 'peridot', 'topaz', 'violet garnet'],
  1000: ['black opal', 'emerald', 'fire opal', 'opal', 'oriental amethyst', 'sapphire', 'star ruby'],
  5000: ['black sapphire', 'diamond', 'jacinth', 'oriental emerald', 'ruby'],
};
const JEWELRY_NAMES = ['anklet', 'arm band', 'belt', 'bracelet', 'brooch', 'buckle', 'chain', 'chalice', 'circlet', 'clasp', 'comb', 'crown', 'earring', 'goblet', 'idol', 'locket', 'medallion', 'necklace', 'pendant', 'pin', 'ring', 'sceptre', 'statuette', 'tiara'];

/** DMG gem value table (d100). */
export function rollGem(rng) {
  const r = rng.int(1, 100);
  const value = r <= 25 ? 10 : r <= 50 ? 50 : r <= 70 ? 100 : r <= 90 ? 500 : r <= 99 ? 1000 : 5000;
  return { name: rng.pick(GEM_NAMES[value]), value };
}

/** DMG jewelry value table (d100). */
export function rollJewelry(rng) {
  const r = rng.int(1, 100);
  const dice = r <= 10 ? '1d10x100' : r <= 20 ? '2d6x100' : r <= 40 ? '3d6x100' : r <= 50 ? '5d6x100' : r <= 70 ? '1d6x1000' : r <= 90 ? '2d4x1000' : '2d6x1000';
  const material = r <= 10 ? 'silver' : r <= 20 ? 'silver and gold' : r <= 40 ? 'gold' : r <= 50 ? 'gold and gem-set' : 'jewelled';
  return { name: `${material} ${rng.pick(JEWELRY_NAMES)}`, value: roll(rng, dice) };
}

// ------------------------------------------------------------- magic items

/** Candidate ids per category; only ids that exist in data/items.js are used. */
const MAGIC_TABLE = {
  potions: [
    ['potionHealing', 30], ['potionExtraHealing', 10], ['potionGiantStrength', 8], ['potionSpeed', 8],
    ['potionInvisibility', 8], ['potionFireResistance', 6], ['potionNeutralizePoison', 5], ['potionHeroism', 5],
  ],
  scrolls: 'scroll',
  rings: [['ringProtection1', 50], ['ringProtection2', 20], ['ringProtection3', 5], ['ringFeatherFall', 10], ['ringInvisibility', 5], ['ringFireResistance', 10]],
  wands: [['wandMagicMissile', 50], ['wandParalyzation', 20], ['wandFire', 10], ['wandLightning', 10], ['wandSleep', 10]],
  misc: [['bracersAC6', 20], ['bracersAC4', 10], ['cloakProtection1', 25], ['cloakProtection2', 10], ['gauntletsOgrePower', 15], ['cloakDisplacement', 10], ['dustDisappearance', 10], ['necklaceMissiles', 5], ['manualBodilyHealth', 3]],
  // Enchanted versions of mundane weapons / armour (entry.magic).
  armor: [['chainMail', 30], ['leather', 15], ['bandedMail', 15], ['plateMail', 15], ['scaleMail', 10], ['shield', 30], ['ringMail', 5], ['studdedLeather', 5]],
  swords: [['longSword', 55], ['shortSword', 20], ['broadSword', 15], ['twoHandedSword', 10]],
  weapons: [['dagger', 20], ['mace', 15], ['battleAxe', 10], ['hammer', 10], ['spear', 8], ['flail', 8], ['morningStar', 8], ['arrows', 15], ['sling', 3], ['shortBow', 4], ['longBow', 4], ['halberd', 3], ['quarrels', 5], ['dart', 5]],
};

function weighted(rng, rows) {
  const avail = rows.filter(([id]) => ITEMS[id]);
  if (!avail.length) return null;
  const total = avail.reduce((t, [, w]) => t + w, 0);
  let r = rng.int(1, total);
  for (const [id, w] of avail) if ((r -= w) <= 0) return id;
  return avail[avail.length - 1][0];
}

/** +1 (70%), +2 (25%), +3 (5%). About 5% of weapons/armour are cursed -1. */
function rollPlus(rng) {
  const r = rng.int(1, 100);
  if (r <= 5) return -1;
  return r <= 70 ? 1 : r <= 95 ? 2 : 3;
}

/**
 * Generate one magic scroll entry with 1-3 spells of levels 1-3 of one school.
 * Needs a scroll-type item in data (any id with type 'scroll'); prefers 'scroll'.
 */
export function rollScroll(rng) {
  const base = ITEMS.scroll ? 'scroll' : Object.values(ITEMS).find((d) => d.type === 'scroll')?.id;
  if (!base) return null;
  const school = rng.chance(70) ? 'magicUser' : 'cleric';
  const count = rng.int(1, 3);
  const spells = [];
  for (let i = 0; i < count; i++) {
    const lvl = rng.chance(60) ? 1 : rng.chance(65) ? 2 : 3;
    const pool = spellsForClass(school, lvl);
    if (pool.length) spells.push(rng.pick(pool));
  }
  return makeEntry(base, { spells, identified: false });
}

/**
 * Roll one magic item of a kind: 'any' | 'armsArmor' | 'noWeapons' | 'misc' |
 * 'potions' | 'scrolls' | 'rings' | 'wands' | 'armor' | 'swords' | 'weapons'.
 * @returns {import('./character.js').InventoryEntry|null}
 */
export function rollMagicItem(rng, kind = 'any') {
  let cat = kind;
  if (kind === 'any' || kind === 'noWeapons' || kind === 'armsArmor') {
    const r = rng.int(1, 100);
    if (kind === 'armsArmor') cat = r <= 40 ? 'armor' : r <= 75 ? 'swords' : 'weapons';
    else {
      cat = r <= 20 ? 'potions' : r <= 35 ? 'scrolls' : r <= 40 ? 'rings' : r <= 45 ? 'wands' : r <= 57 ? 'misc' : r <= 72 ? 'armor' : r <= 86 ? 'swords' : 'weapons';
      if (kind === 'noWeapons' && (cat === 'swords' || cat === 'weapons')) cat = 'misc';
    }
  }
  if (cat === 'scrolls') return rollScroll(rng);
  const rows = MAGIC_TABLE[cat];
  const id = weighted(rng, rows);
  if (!id) return cat === 'misc' || cat === 'rings' || cat === 'wands' ? rollMagicItem(rng, 'potions') : null;
  if (cat === 'armor' || cat === 'swords' || cat === 'weapons') {
    const plus = rollPlus(rng);
    const e = makeEntry(id, { magic: plus, identified: false });
    if (plus < 0) e.cursed = true;
    if (ITEMS[id].type === 'ammo') e.qty = roll(rng, '2d6');
    return e;
  }
  const e = makeEntry(id, { identified: false });
  if (ITEMS[id].type === 'wand') e.charges = ITEMS[id].charges ? Math.max(1, ITEMS[id].charges - rng.int(0, 10)) : rng.int(5, 25);
  return e;
}

/**
 * Generate treasure of a type.
 * @param {import('./dice.js').Rng} rng
 * @param {string|string[]} types  e.g. 'B' or ['J','Q']
 * @param {{scale?:number, count?:number}} [o] scale multiplies coin amounts
 *   (PoR hoards are far smaller than MM lairs: default 0.1); count repeats
 *   individual types (J-N) per creature.
 * @returns {Treasure}
 */
export function generateTreasure(rng, types, o = {}) {
  const scale = o.scale ?? 0.1;
  const out = { coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, gems: [], jewelry: [], items: [] };
  for (const t of [].concat(types)) {
    const def = TREASURE_TYPES[t];
    if (!def) throw new Error(`Unknown treasure type ${t}`);
    const individual = 'JKLMN'.includes(t);
    const reps = individual ? o.count ?? 1 : 1;
    for (let rep = 0; rep < reps; rep++) {
      for (const k of ['cp', 'sp', 'ep', 'gp', 'pp']) {
        if (!def[k] || !rng.chance(def[k][0])) continue;
        out.coins[k] += Math.max(1, Math.round(roll(rng, def[k][1]) * (individual ? 1 : scale)));
      }
      if (def.gems && rng.chance(def.gems[0])) {
        const n = Math.max(1, Math.round(roll(rng, def.gems[1]) * (individual ? 1 : Math.max(scale, 0.25))));
        for (let i = 0; i < n; i++) out.gems.push(rollGem(rng));
      }
      if (def.jewelry && rng.chance(def.jewelry[0])) {
        const n = Math.max(1, Math.round(roll(rng, def.jewelry[1]) * (individual ? 1 : Math.max(scale, 0.25))));
        for (let i = 0; i < n; i++) out.jewelry.push(rollJewelry(rng));
      }
      if (def.magic && rng.chance(def.magic[0])) {
        for (let i = 0; i < def.magic[1]; i++) {
          const e = rollMagicItem(rng, def.magic[2]);
          if (e) out.items.push(e);
        }
      }
      if (def.maps && rng.chance(def.maps[0])) out.maps = (out.maps ?? 0) + def.maps[1];
      if (def.potions && rng.chance(def.potions[0])) {
        const n = typeof def.potions[1] === 'string' ? roll(rng, def.potions[1]) : def.potions[1];
        for (let i = 0; i < n; i++) {
          const e = rollMagicItem(rng, 'potions');
          if (e) out.items.push(e);
        }
      }
      if (def.scrolls && rng.chance(def.scrolls[0])) {
        const n = typeof def.scrolls[1] === 'string' ? roll(rng, def.scrolls[1]) : def.scrolls[1];
        for (let i = 0; i < n; i++) {
          const e = rollScroll(rng);
          if (e) out.items.push(e);
        }
      }
    }
  }
  return out;
}

/** Total gp value of a treasure (coins + gems + jewelry; items at list cost). */
export function treasureValue(t) {
  let v = 0;
  for (const [k, n] of Object.entries(t.coins)) v += n * COIN_VALUES_GP[k];
  for (const g of t.gems) v += g.value;
  for (const j of t.jewelry) v += j.value;
  return Math.floor(v);
}

/** Weight of the coins in a treasure (cn). */
export function treasureCoinWeight(t) {
  return Object.values(t.coins).reduce((a, b) => a + b, 0);
}

/**
 * 1e experience for treasure: 1 XP per gp of value recovered (optional rule;
 * Pool of Radiance awards XP mainly for monsters and quests).
 */
export function treasureXp(t, rate = 1) {
  return Math.floor(treasureValue(t) * rate);
}

/**
 * Split coins evenly among n living members (remainder to the first).
 * @returns {Array<{cp:number,sp:number,ep:number,gp:number,pp:number}>}
 */
export function shareCoins(coins, n) {
  const shares = Array.from({ length: n }, () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }));
  for (const [k, v] of Object.entries(coins)) {
    const each = Math.floor(v / n);
    shares.forEach((s, i) => { s[k] = each + (i === 0 ? v - each * n : 0); });
  }
  return shares;
}
