import { roll } from './dice.js';
import {
  ABILITIES, strengthTable, dexterityMods, conHpBonus, wisdomBonusSpells, addStrength, constitutionTable,
} from './abilities.js';
import {
  RACES, racialSaveBonus, racialPoisonBonus, raceAllowsClass, racialLevelLimit, raceAbilityCaps,
} from './races.js';
import {
  CLASSES, splitClasses, levelForXp, xpForLevel, thac0For, savesFor, SAVE_KEYS, spellSlots, thiefSkills,
  thiefDexAdj, classSpecName, classSpecAbbr, PR_LEVEL_CAPS, allowedAlignments, fighterAttacksPerRound,
  backstabMultiplier,
} from './classes.js';
import { ITEMS } from '../data/items.js';
import {
  itemMagic, itemWeight, coinWeight, encumbranceCategory, armorMoveLimit, rateOfFire, makeEntry, itemRulesOf,
  isThrownWeapon, missileRangeBands, missileRange, throwableDef,
} from './items.js';
import { effectMods, onDamaged, addEffect, removeEffect, hasEffect } from './conditions.js';

/**
 * Characters: creation, derived stats, equipment, experience & training,
 * damage & healing. Characters are plain JSON; everything derived is computed
 * by deriveStats(ch) and never stored.
 *
 * @typedef {Object} InventoryEntry
 * @property {string} id        item id (data/items.js)
 * @property {number} [qty]
 * @property {boolean} [equipped]
 * @property {boolean} [identified]
 * @property {number} [charges]
 * @property {number} [magic]   enchantment override (+N) for treasure-made items
 * @property {string[]} [spells] scroll contents
 * @property {boolean} [cursed]
 *
 * @typedef {Object} Character  Plain, JSON-serialisable.
 * @property {string} id
 * @property {string} name
 * @property {string} race              races.js id
 * @property {string} classSpec         'fighter' | 'fighter/thief' ...
 * @property {'male'|'female'} gender
 * @property {string} alignment         'LG','NG','CG','LN','TN','CN','LE','NE','CE'
 * @property {{str:number,strPct:number,int:number,wis:number,dex:number,con:number,cha:number}} abilities
 * @property {Record<string,number>} xp       per class id
 * @property {Record<string,number>} levels   per class id
 * @property {Record<string,number[]>} hpRolls per class id: raw die rolls per level (no con)
 * @property {{cur:number,max:number}} hp
 * @property {InventoryEntry[]} inventory
 * @property {number} gold
 * @property {Record<string,number>} [coins]   other denominations {cp,sp,ep,pp}
 * @property {{memorized: Record<string,string[]>, book: string[], queue?: Record<string,string[]>}} spells
 * @property {'ok'|'unconscious'|'dying'|'dead'|'stoned'|'fled'|'gone'} status
 * @property {string[]} conditions      condition ids (mirrors effects, see conditions.js)
 * @property {import('./conditions.js').Effect[]} [effects]  timed effects
 * @property {{from:string, level:number}} [dual]  human dual-class: former class & level
 * @property {number} age
 * @property {{seed:number, palette?:number, style?:string}} look   portrait/combat-icon parameters
 */

/**
 * Character ids are scoped to the Rng that rolls the character, not to the
 * session: a per-Rng sequence number plus one draw from it, so the same seed
 * yields the same ids on a fresh load and after a long session. Without an
 * Rng the id is a stable hash of the character's defining fields (pass
 * `opts.id` to choose one).
 */
const ID_SEQ = new WeakMap();
function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const newId = (rng, o = {}) => {
  if (o.id) return String(o.id);
  if (!rng) return `c_${strHash(JSON.stringify([o.name, o.race, o.classSpec, o.gender, o.abilities, o.level]))}`;
  const n = (ID_SEQ.get(rng) ?? 0) + 1;
  ID_SEQ.set(rng, n);
  return `c${n.toString(36)}${rng.int(0, 36 ** 5).toString(36)}`;
};

/**
 * Roll ability scores.
 * @param {import('./dice.js').Rng} rng
 * @param {'4d6'|'3d6'} [method] '4d6' = 4d6 drop lowest (modern QoL default)
 */
export function rollAbilityScores(rng, method = '4d6') {
  const one = () => {
    if (method === '3d6') return roll(rng, '3d6');
    const d = [rng.die(6), rng.die(6), rng.die(6), rng.die(6)].sort((a, b) => a - b);
    return d[1] + d[2] + d[3];
  };
  const a = Object.fromEntries(ABILITIES.map((k) => [k, one()]));
  a.strPct = 0;
  return a;
}

/** Apply racial adjustments and clamp to race min/max. Returns a new object. */
export function applyRace(abilities, raceId, gender = 'male') {
  const race = RACES[raceId];
  const { max } = raceAbilityCaps(raceId, gender);
  const out = { ...abilities };
  for (const k of ABILITIES) {
    out[k] = (out[k] ?? 10) + (race.adjust[k] ?? 0);
    out[k] = Math.max(race.min[k], Math.min(max[k], out[k]));
  }
  return out;
}

/** True if abilities satisfy all class minimums for a class spec. */
export function meetsClassMinimums(abilities, classSpec) {
  return splitClasses(classSpec).every((c) =>
    Object.entries(CLASSES[c].minAbilities).every(([k, v]) => abilities[k] >= v),
  );
}

/**
 * Roll exceptional strength for an 18-STR fighter, capped by race/gender.
 * @returns {number} 0 when not applicable
 */
export function rollExceptionalStr(rng, abilities, raceId, classSpec, gender = 'male') {
  if (abilities.str !== 18 || !splitClasses(classSpec).includes('fighter')) return 0;
  const cap = raceAbilityCaps(raceId, gender).maxStrPct;
  if (!cap) return 0;
  return rng.int(1, cap); // uniform up to the race/gender cap (not min(cap, d100))
}

/**
 * Roll a legal ability set for race+class (re-rolls until minimums met, max 200 tries,
 * then bumps the required scores). Gives 18/xx exceptional strength to fighters.
 */
export function rollLegalAbilities(rng, raceId, classSpec, method = '4d6', gender = 'male') {
  let a;
  for (let i = 0; i < 200; i++) {
    a = applyRace(rollAbilityScores(rng, method), raceId, gender);
    if (meetsClassMinimums(a, classSpec)) break;
  }
  for (const c of splitClasses(classSpec)) {
    for (const [k, v] of Object.entries(CLASSES[c].minAbilities)) a[k] = Math.max(a[k], v);
  }
  a.strPct = rollExceptionalStr(rng, a, raceId, classSpec, gender);
  return a;
}

/**
 * Validate a character concept (race, class, alignment, abilities).
 * @returns {string[]} problems; empty when legal
 */
export function validateConcept({ race, classSpec, alignment, abilities, gender = 'male' }) {
  const out = [];
  if (!RACES[race]) return [`unknown race ${race}`];
  if (!raceAllowsClass(race, classSpec)) out.push(`${RACES[race].name} cannot be ${classSpec}`);
  if (alignment && !allowedAlignments(classSpec).includes(alignment)) out.push(`${alignment} not allowed for ${classSpec}`);
  if (abilities) {
    if (!meetsClassMinimums(abilities, classSpec)) out.push('ability minimums not met');
    const { max, maxStrPct } = raceAbilityCaps(race, gender);
    for (const k of ABILITIES) {
      if (abilities[k] < RACES[race].min[k]) out.push(`${k} too low for race`);
      if (abilities[k] > max[k]) out.push(`${k} too high for race`);
    }
    if (abilities.strPct && (abilities.str !== 18 || abilities.strPct > maxStrPct || !splitClasses(classSpec).includes('fighter'))) out.push('illegal exceptional strength');
  }
  return out;
}

/** Starting age for race + class spec (multiclass: the oldest option). */
export function startingAge(rng, raceId, classSpec) {
  const table = RACES[raceId].age ?? {};
  let best = 0;
  for (const c of splitClasses(classSpec)) {
    const [base, dice] = table[c] ?? [18, '1d4'];
    best = Math.max(best, base + roll(rng, dice));
  }
  return best;
}

/**
 * Create a character.
 * @param {Object} opts
 * @param {import('./dice.js').Rng} opts.rng
 * @param {string} opts.name
 * @param {string} opts.race
 * @param {string} opts.classSpec
 * @param {Object} [opts.abilities]      pre-rolled (already race adjusted)
 * @param {'male'|'female'} [opts.gender]
 * @param {string} [opts.alignment]
 * @param {boolean} [opts.maxHpAtFirst]  QoL: max HP at level 1 (default true)
 * @param {string[]} [opts.items]        item ids to add (equipped when sensible)
 * @param {number} [opts.level]          start at this level in every class (debug/test parties), capped by the
 *                                       racial level limit unless `opts.ignoreLimits`
 * @param {boolean} [opts.ignoreLimits]
 * @param {string[]} [opts.spellbook]    magic-user starting spells
 * @returns {Character}
 */
export function createCharacter(opts) {
  const { rng, name, race, classSpec } = opts;
  if (!RACES[race]) throw new Error(`Unknown race ${race}`);
  if (!raceAllowsClass(race, classSpec)) throw new Error(`${race} cannot be ${classSpec}`);
  const classes = splitClasses(classSpec);
  const gender = opts.gender ?? 'male';
  const abilities = opts.abilities ?? rollLegalAbilities(rng, race, classSpec, '4d6', gender);
  const level = opts.level ?? 1;
  const ch = {
    id: newId(rng, opts),
    name,
    race,
    classSpec,
    gender,
    alignment: opts.alignment ?? (allowedAlignments(classSpec).includes('TN') ? 'TN' : allowedAlignments(classSpec)[0]),
    abilities: { strPct: 0, ...abilities },
    xp: {},
    levels: {},
    hpRolls: {},
    hp: { cur: 0, max: 0 },
    inventory: [],
    gold: 0,
    spells: { memorized: {}, book: [] },
    status: 'ok',
    conditions: [],
    effects: [],
    age: startingAge(rng, race, classSpec),
    look: { seed: rng.int(1, 1e9) },
  };
  for (const c of classes) {
    ch.levels[c] = 1;
    ch.xp[c] = 0;
    const die = CLASSES[c].hitDie;
    ch.hpRolls[c] = [opts.maxHpAtFirst === false ? rng.die(die) : die];
    if (c === 'cleric' || c === 'magicUser') ch.spells.memorized[c] = [];
  }
  // Racial level limits apply to pre-built characters too (a half-elf cleric
  // stops at 5th); `ignoreLimits: true` for test rigs that need more.
  for (let l = 2; l <= level; l++) {
    for (const c of classes) {
      if (!opts.ignoreLimits && l > racialLevelLimit(race, c, ch.abilities)) continue;
      ch.xp[c] = Math.max(ch.xp[c], xpForLevel(c, l));
      advanceClassLevel(ch, c, rng);
    }
  }
  ch.hp.max = computeMaxHp(ch);
  ch.hp.cur = ch.hp.max;
  ch.gold = roll(rng, CLASSES[classes[0]].startGold);
  for (const id of opts.items ?? []) addItem(ch, id, { equip: true });
  if (classes.includes('magicUser')) ch.spells.book = [...(opts.spellbook ?? ['magicMissile', 'sleep', 'shield', 'readMagic'])];
  return ch;
}

/** Raise one class by one level, rolling hit points (no XP change). */
export function advanceClassLevel(ch, classId, rng) {
  const cls = CLASSES[classId];
  const next = ch.levels[classId] + 1;
  ch.levels[classId] = next;
  if (next <= cls.hdCap) ch.hpRolls[classId].push(rng.die(cls.hitDie));
  else ch.hpRolls[classId].push(cls.hpAfterCap);
}

/**
 * Max HP: per class sum(rolls) + con bonus per HD level (up to hdCap), divided
 * by number of classes (multiclass rule). Minimum 1 per level. The fighter's
 * CON bonus (+3 at 17, +4 at 18) applies to fighter dice; for a multiclass
 * that includes fighter it applies to every class's dice before dividing
 * (Gold Box ruling). Dual-classed humans keep their old class's hit points —
 * each class's dice with that class's own CON bonus, so a magic-user turned
 * fighter gains nothing retroactively — and gain the new class's only once it
 * exceeds the old level. Temporary hit points (Potion of Heroism) are added.
 */
export function computeMaxHp(ch) {
  const con = ch.abilities.con;
  const perClass = (c, fighterBonus, from = 0) => {
    const cls = CLASSES[c];
    return (ch.hpRolls[c] ?? []).slice(from).reduce((t, r, i) => t + Math.max(1, r + (from + i < cls.hdCap ? conHpBonus(con, fighterBonus) : 0)), 0);
  };
  const temp = tempHpOf(ch);
  if (ch.dual) {
    const now = splitClasses(ch.classSpec)[0];
    const oldHp = perClass(ch.dual.from, ch.dual.from === 'fighter');
    const extra = perClass(now, now === 'fighter', ch.dual.level);
    return Math.max(1, oldHp + extra) + temp;
  }
  const classes = Object.keys(ch.hpRolls);
  const isFighter = classes.includes('fighter');
  const total = classes.reduce((t, c) => t + perClass(c, isFighter), 0);
  return Math.max(1, Math.floor(total / classes.length)) + temp;
}

/** Temporary hit points from effects (Potion of Heroism dice), counted in hp.max while they last. */
export function tempHpOf(ch) {
  return (ch.effects ?? []).reduce((t, e) => t + (e.data?.tempHp ?? 0), 0);
}

/** Update max hp after a CON change or level-up, adjusting current hp by the difference. */
export function refreshHp(ch) {
  const oldMax = ch.hp.max;
  ch.hp.max = computeMaxHp(ch);
  ch.hp.cur = Math.min(ch.hp.max, ch.hp.cur + (ch.hp.max - oldMax));
}

// ------------------------------------------------------------------ inventory

const SLOT_OF = { weapon: 'hand', armor: 'body', shield: 'offhand', helm: 'head', ring: 'ring', ammo: 'quiver', cloak: 'cloak', bracers: 'arms', gauntlets: 'hands', girdle: 'waist', boots: 'feet', amulet: 'neck' };
export const EQUIP_SLOTS = Object.freeze({ ...SLOT_OF });

/** Equipment slot of an item def (undefined = not equippable). */
export function slotOf(def) {
  return def ? def.slot ?? SLOT_OF[def.type] : undefined;
}

/** Add an item to inventory. Auto-equip when opts.equip and slot is free. */
export function addItem(ch, itemId, opts = {}) {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`Unknown item ${itemId}`);
  const entry = makeEntry(itemId, opts);
  ch.inventory.push(entry);
  if (opts.equip && canEquip(ch, itemId) && !slotOccupied(ch, def)) equipItem(ch, ch.inventory.length - 1);
  return entry;
}

/** Remove inventory[index] (or `qty` of a stack). Cursed equipped items refuse. Returns the entry or null. */
export function removeItem(ch, index, qty) {
  const e = ch.inventory[index];
  if (!e) return null;
  if (e.equipped && e.cursed) return null;
  if (qty && (e.qty ?? 1) > qty) {
    e.qty -= qty;
    return { ...e, qty, equipped: false };
  }
  ch.inventory.splice(index, 1);
  return e;
}

/** True if an equipped item already fills the slot `def` would use (rings allow 2). */
function slotOccupied(ch, def) {
  const slot = slotOf(def);
  if (!slot) return true;
  const inSlot = ch.inventory.filter((e) => e.equipped && slotOf(ITEMS[e.id]) === slot).length;
  if (slot === 'ring') return inSlot >= 2;
  if (slot === 'offhand' && ch.inventory.some((e) => e.equipped && ITEMS[e.id].twoHanded)) return true;
  if (slot === 'hand' && def.twoHanded && ch.inventory.some((e) => e.equipped && ITEMS[e.id].type === 'shield')) return true;
  return inSlot > 0;
}

/**
 * Why a character cannot use an item, or null if they can.
 * @returns {string|null}
 */
export function equipProblem(ch, itemId) {
  const def = itemRulesOf(itemId);
  if (!def) return 'unknown item';
  const classes = splitClasses(ch.classSpec);
  if (def.classes && !classes.some((c) => def.classes.includes(c))) return 'class cannot use';
  if (def.type === 'weapon') {
    // 1e: a multiclassed cleric keeps the cleric's weapon restriction (blunt only).
    if (classes.includes('cleric') && !CLASSES.cleric.weapons.includes(def.weaponGroup)) return 'clerics may not shed blood';
    const ok = classes.some((c) => CLASSES[c].weapons === 'any' || CLASSES[c].weapons.includes(def.weaponGroup));
    return ok ? null : 'weapon not allowed';
  }
  if (def.type === 'armor') {
    // Multiclass thieves/MUs may wear armour but lose abilities (see deriveStats).
    const ok = classes.some((c) => CLASSES[c].armor === 'any' || (Array.isArray(CLASSES[c].armor) && CLASSES[c].armor.includes(def.armorGroup)));
    return ok ? null : 'armor not allowed';
  }
  if (def.type === 'shield') return classes.some((c) => CLASSES[c].shield) ? null : 'shield not allowed';
  return slotOf(def) ? null : 'not equippable';
}

/** Can this character use/equip the item (class armor/weapon restrictions)? */
export function canEquip(ch, itemId) {
  return equipProblem(ch, itemId) === null;
}

/** Equip inventory[index], unequipping anything in the same slot. */
export function equipItem(ch, index) {
  const entry = ch.inventory[index];
  if (!entry) return false;
  const def = ITEMS[entry.id];
  const slot = slotOf(def);
  if (!slot) return false;
  if (slot === 'ring' && !entry.equipped && ch.inventory.filter((e) => e.equipped && slotOf(ITEMS[e.id]) === 'ring').length >= 2) {
    const other = ch.inventory.find((e) => e.equipped && slotOf(ITEMS[e.id]) === 'ring' && !e.cursed);
    if (!other) return false;
    other.equipped = false;
  }
  for (const e of ch.inventory) {
    if (e === entry || !e.equipped) continue;
    const d = ITEMS[e.id];
    const s = slotOf(d);
    const clash = (s === slot && slot !== 'ring') || (def.twoHanded && s === 'offhand') || (def.type === 'shield' && d.twoHanded);
    if (clash) {
      if (e.cursed) return false;
      e.equipped = false;
    }
  }
  entry.equipped = true;
  return true;
}

/** Unequip inventory[index]. Cursed items refuse (remove curse first). */
export function unequipItem(ch, index) {
  const e = ch.inventory[index];
  if (!e || !e.equipped) return false;
  if (e.cursed) return false;
  e.equipped = false;
  return true;
}

/** Equipped items as [entry, def] pairs. */
export function equipped(ch) {
  return ch.inventory.filter((e) => e.equipped && ITEMS[e.id]).map((e) => [e, ITEMS[e.id]]);
}

/** Total carried weight in cn (items + coins). */
export function carriedWeight(ch) {
  return ch.inventory.reduce((t, e) => t + itemWeight(e), 0) + coinWeight(ch);
}

// ------------------------------------------------------------ derived values

/** Rings / cloaks subject to the DMG protection-stacking rules (see deriveStats). */
export const PROTECTION_RING = /^ringProtection/;
export const PROTECTION_CLOAK = /^cloakProtection/;

/**
 * Current ability scores after magic: gauntlets of ogre power / girdles (setStr),
 * the Strength spell and potions (strBonus / strSet), Enlarge, Ray of
 * Enfeeblement (strLossPct), Friends (cha).
 */
export function effectiveAbilities(ch) {
  const a = { ...ch.abilities, strPct: ch.abilities.strPct ?? 0 };
  const fx = effectMods(ch);
  // PHB: exceptional strength is a fighter's — a dual-classed ex-fighter loses
  // the percentile while the fighter class lies dormant, and regains it after.
  const fighter = activeClasses(ch).includes('fighter');
  if (!fighter) a.strPct = 0;
  if (fx.strBonus) Object.assign(a, addStrength(a.str, a.strPct, fx.strBonus, fighter));
  const sets = [];
  for (const [e, d] of equipped(ch)) if (d.setStr && canEquip(ch, d.id)) sets.push({ strPct: 0, ...d.setStr, _e: e });
  if (fx.strSet) sets.push(fx.strSet);
  for (const s of sets) if (s.str * 1000 + (s.str === 18 ? s.strPct : 0) > a.str * 1000 + (a.str === 18 ? a.strPct : 0)) { a.str = s.str; a.strPct = s.str === 18 ? s.strPct : 0; }
  if (fx.strLossPct) {
    const eff = a.str + (a.str === 18 ? a.strPct / 100 : 0);
    a.str = Math.max(3, Math.floor(eff * (1 - fx.strLossPct / 100)));
    a.strPct = 0;
  }
  if (fx.strDrain) {
    // Shadow's touch: whole STR points; exceptional strength goes first.
    a.str = Math.max(0, a.str - fx.strDrain);
    a.strPct = 0;
  }
  if (fx.cha) a.cha = Math.min(18, a.cha + fx.cha);
  return a;
}

/** Classes whose abilities are currently usable (dual-class: old class only once surpassed). */
export function activeClasses(ch) {
  const now = splitClasses(ch.classSpec);
  if (!ch.dual) return now;
  const newLvl = ch.levels[now[0]] ?? 1;
  return newLvl > ch.dual.level ? [ch.dual.from, ...now] : now;
}

/**
 * Level at which the character turns undead: the cleric level, but only while
 * the cleric class is active (activeClasses) — a human who dual-classed away
 * from cleric cannot turn until the new class exceeds the old level (PHB).
 * Paladins are not in Pool of Radiance. 0 = cannot turn. Accepts a Character
 * or a Combatant (its `ref`).
 */
export function turnLevel(c) {
  const ch = c?.classSpec ? c : c?.ref?.classSpec ? c.ref : null;
  if (!ch || !activeClasses(ch).includes('cleric')) return 0;
  return ch.levels?.cleric ?? 0;
}

/** Can the character turn undead now? (turnLevel > 0) */
export function canTurnUndead(c) {
  return turnLevel(c) > 0;
}

/**
 * Highest level among the character's classes (used for caster level
 * fallbacks, UI). It deliberately counts a dual-class's dormant old class
 * too: an F8 → MU1 is still an 8th-level creature for Sleep's HD limit and
 * level-keyed effects (Gold Box ruling; activeClasses gates what the old
 * class can *do*: THAC0, saves, spells, turning, backstab).
 */
export function highestLevel(ch) {
  return Math.max(1, ...Object.values(ch.levels ?? {}));
}

/**
 * Can the character cast arcane spells in their current armour? No armour or
 * shield, except elfin chain, which only elves and half-elves can cast in (1e).
 */
export function armorAllowsArcane(ch) {
  const elfish = ch.race === 'elf' || ch.race === 'halfElf';
  return !equipped(ch).some(([, d]) => d.type === 'armor' && !(d.armorGroup === 'elfin' && elfish)) && !equipped(ch).some(([, d]) => d.type === 'shield');
}

/** Can the character use thief skills in their current armour? */
export function armorAllowsThieving(ch) {
  const body = equipped(ch).find(([, d]) => d.type === 'armor')?.[1];
  return !body || ['leather', 'padded', 'studded', 'elfin'].includes(body.armorGroup);
}

/**
 * All derived combat stats. Pure function of the character.
 * @returns {{thac0:number, ac:number, acRear:number, acMissile:number, saves:Record<string,number>, savePoison:number,
 *   hitBonus:number, dmgBonus:number, missileHit:number, weapon: import('../data/schema.js').ItemDef|null,
 *   weaponEntry: InventoryEntry|null, weaponMagic:number, weaponMagicVs:Record<string,number>|null, ranged:boolean, range:number, damage:string,
 *   damageLarge:string, attacks:number, move:number, baseMove:number, weight:number,
 *   encumbrance:{category:number, move:number, label:string, next:number}, spellSlots:Record<string,number[]>,
 *   canCastArcane:boolean, thief:Record<string,number>|null, backstab:number, levels:string, className:string,
 *   classAbbr:string, classLevels:string, dual:boolean, dualActive:boolean, abilities:object, mods:object, immune:string[], resist:Record<string,number>,
 *   images:number, attackerHit:number, missChance:number}}
 */
export function deriveStats(ch) {
  const classes = activeClasses(ch);
  const race = RACES[ch.race];
  const a = effectiveAbilities(ch);
  const str = strengthTable(a.str, a.strPct);
  const dex = dexterityMods(a.dex);
  const fx = effectMods(ch);
  // Heroism: temporary fighter levels (fighters only) for THAC0, saves and attack rate.
  const lvlOf = (c) => (ch.levels[c] ?? 1) + (c === 'fighter' ? fx.fighterLevels : 0);
  const thac0 = Math.min(...classes.map((c) => thac0For(c, lvlOf(c))));
  const gear = equipped(ch);

  // ---- armour class
  let base = 10;
  let armorDef = null;
  let armorMagic = 0;
  let shieldAc = 0;
  let otherAc = 0;
  let saveBonus = 0;
  let weapon = null;
  let weaponEntry = null;
  // DMG protection-item rules: a ring of protection's AC bonus does not add
  // to magic armour (its save bonus still counts) and two rings do not stack;
  // a cloak of protection does nothing at all over magic armour or any armour
  // but leather; bracers of defense are armour + shield in one (they don't
  // work under body armour, and a shield adds only its enchantment to them).
  const bodyArmor = gear.find(([, d]) => d.type === 'armor');
  const magicArmor = !!bodyArmor && itemMagic(bodyArmor[0]) > 0;
  const bracers = !bodyArmor && gear.some(([, d]) => d.acBase !== undefined);
  let ringAc = 0;
  let ringSave = 0;
  for (const [e, d] of gear) {
    const m = itemMagic(e);
    if (d.type === 'armor') {
      armorDef = d;
      armorMagic = m;
      base = Math.min(base, d.ac - m);
    } else if (d.acBase !== undefined && !bodyArmor) {
      base = Math.min(base, d.acBase); // bracers of defense: do not stack with armour
    }
    if (PROTECTION_RING.test(d.id ?? '')) {
      // Rings of protection: the best one counts.
      ringAc = Math.max(ringAc, magicArmor ? 0 : (d.acBonus ?? m));
      ringSave = Math.max(ringSave, d.saveBonus ?? m);
      continue;
    }
    if (PROTECTION_CLOAK.test(d.id ?? '')) {
      const ok = !magicArmor && (!bodyArmor || bodyArmor[1].armorGroup === 'leather');
      if (ok) { otherAc += d.acBonus ?? m; saveBonus += d.saveBonus ?? m; }
      continue;
    }
    if (d.type === 'shield') shieldAc += bracers ? Math.max(0, m) : (d.acBonus ?? 1) + m;
    else if (d.type !== 'armor') otherAc += (d.acBonus ?? 0) + (d.type === 'helm' ? m : 0);
    if (d.type === 'weapon' && !weapon) { weapon = d; weaponEntry = e; }
    saveBonus += d.saveBonus ?? 0;
  }
  otherAc += ringAc;
  saveBonus += ringSave;
  const dexAc = hasEffect(ch, 'blinded') ? Math.max(0, dex.ac) : dex.ac; // blind: no dex bonus
  let ac = base - shieldAc - otherAc + dexAc + fx.ac;
  const acRear = base - otherAc + Math.max(0, dexAc) + fx.ac;
  // Shield spell (PHB): AC 2 vs hand-hurled missiles, AC 3 vs device-propelled
  // (arrows, bolts, sling stones), AC 4 vs everything else.
  let acMissile = ac;
  let acHurled = ac;
  if (fx.acVsMelee != null) ac = Math.min(ac, fx.acVsMelee);
  if (fx.acVsMissile != null || fx.acVsHurled != null) {
    acMissile = Math.min(acMissile, fx.acVsMissile ?? 99);
    acHurled = Math.min(acHurled, fx.acVsHurled ?? fx.acVsMissile ?? 99);
  } else acMissile = acHurled = ac;

  // ---- saving throws
  const saves = {};
  const magicBonus = racialSaveBonus(ch.race, ch.abilities.con);
  const poisonBonus = racialPoisonBonus(ch.race, ch.abilities.con);
  for (const k of SAVE_KEYS) {
    saves[k] = Math.min(...classes.map((c) => savesFor(c, lvlOf(c))[k]));
    if (k === 'rsw' || k === 'sp') saves[k] -= magicBonus;
    // The stout races' poison bonus is NOT folded into ppdm (it would also
    // cover paralysis and death magic): rollSave({poison:true}) adds it.
    saves[k] -= saveBonus + fx.save + (fx.saveVs[k] ?? 0);
    saves[k] = Math.max(2, saves[k]);
  }
  // Display-only: the number this character needs against poison.
  const savePoison = Math.max(2, saves.ppdm - poisonBonus);

  // ---- weapon
  const ranged = !!weapon?.ranged;
  const wMagic = weaponEntry ? itemMagic(weaponEntry) : 0;
  const racial = racialWeaponHit(ch.race, weapon);
  const thrown = ranged && isThrownWeapon(weapon);
  // Thrown weapons get both the DEX missile and the STR to-hit adjustments (DMG).
  // A launcher in hand shoots its best (or equipped) ammunition: an arrow's or
  // bolt's enchantment adds to hit and damage, the launcher's to hit only (DMG).
  const ammoMagic = ranged && !thrown && weapon.ammo ? (missileProfile(ch)?.entry === weaponEntry ? missileProfile(ch).ammoMagic : 0) : 0;
  const hitBonus = (ranged ? dex.missile + (thrown ? str.hit : 0) : str.hit) + wMagic + ammoMagic + racial + fx.hit;
  const dmgBonus = (ranged && !thrown ? ammoMagic : str.dmg + wMagic) + fx.dmg;

  // ---- attacks per round
  const fighterLvl = classes.includes('fighter') ? lvlOf('fighter') : 0;
  let attacks = ranged ? rateOfFire(weapon) : fighterLvl ? fighterAttacksPerRound(fighterLvl) : 1;
  attacks *= fx.attackMult;

  // ---- movement & encumbrance
  const weight = carriedWeight(ch);
  const enc = encumbranceCategory(weight, str.weight);
  const baseMove = Math.min(race.move, armorMoveLimit(armorDef, armorMagic), enc.category >= 4 ? 12 : enc.move);
  const move = enc.category >= 4 ? 0 : Math.max(1, Math.round(baseMove * fx.moveMult));

  // ---- spells
  const slots = {};
  for (const c of classes) {
    if (c === 'cleric') {
      const baseSlots = spellSlots('cleric', ch.levels.cleric);
      const bonus = wisdomBonusSpells(a.wis);
      slots.cleric = baseSlots.map((n, i) => n + (bonus[i] ?? 0));
    } else if (c === 'magicUser') {
      slots.magicUser = spellSlots('magicUser', ch.levels.magicUser);
    }
  }

  // ---- thief
  let thief = null;
  if (classes.includes('thief')) {
    thief = thiefSkills(ch.levels.thief, race.thiefAdj, thiefDexAdj(a.dex));
    if (!armorAllowsThieving(ch)) for (const k of Object.keys(thief)) if (k !== 'rl' && k !== 'hn') thief[k] = 0;
  }

  return {
    thac0,
    ac,
    acRear,
    acMissile,
    acHurled,
    saves,
    savePoison,
    hitBonus,
    dmgBonus,
    missileHit: dex.missile + (thrown ? str.hit : 0) + wMagic + ammoMagic + racial + fx.hit,
    weapon,
    weaponEntry,
    weaponMagic: ammoMagic ? Math.max(wMagic, ammoMagic) : wMagic,
    // Situational enchantment ({undead: 2} → +2 more vs the undead); read per
    // target by rules/combat magicVsFor(). Null when the weapon has none.
    weaponMagicVs: weapon?.magicVs || weaponEntry?.magicVs ? { ...(weapon?.magicVs ?? {}), ...(weaponEntry?.magicVs ?? {}) } : null,
    ranged,
    range: ranged ? missileRange(weapon) ?? weapon.range ?? 1 : weapon?.range ?? 1,
    damage: weapon?.damage ?? '1d2',
    damageLarge: weapon?.damageLarge ?? '1d2',
    attacks,
    move,
    baseMove,
    weight,
    encumbrance: enc,
    spellSlots: slots,
    canCastArcane: armorAllowsArcane(ch),
    thief,
    backstab: backstabMultiplierOf(ch),
    ...classLabels(ch),
    abilities: a,
    mods: fx,
    immune: [...fx.immune],
    resist: fx.resist,
    images: fx.images,
    attackerHit: fx.attackerHit,
    missChance: fx.missChance,
  };
}

/**
 * Racial to-hit bonus with a weapon (PHB): halflings +3 with any bow or a
 * sling; elves +1 with bows and with short and long swords. They do not stack.
 */
export function racialWeaponHit(raceId, weapon) {
  if (!weapon) return 0;
  const g = weapon.weaponGroup ?? weapon.id;
  let n = 0;
  const race = RACES[raceId];
  if (weapon.ranged && race?.missileBonus && ['sling', 'shortBow', 'longBow', 'compositeBow'].includes(g)) n = race.missileBonus;
  if (raceId === 'elf' && ['shortBow', 'longBow', 'compositeBow', 'shortSword', 'longSword'].includes(g)) n = Math.max(n, 1);
  return n;
}

/**
 * The character's missile attack. The weapon is chosen in this order: the
 * equipped missile weapon (bow, crossbow, sling, darts), else one in the pack
 * (Gold Box: the bow is drawn when the foe is out of reach), else a spare
 * throwable weapon (a dagger, hand axe, spear or javelin that is not the one
 * in hand, or a stack of two or more of them).
 *
 * Launchers need ammunition of their kind: the equipped stack, else the one
 * with the best enchantment (a cursed -1 stack is used only when nothing else
 * is left). Per the DMG an arrow's or bolt's enchantment adds to hit AND
 * damage, while the launcher's adds to hit only; the attack counts as magic
 * of the better of the two (magicToHit, silver/+N to hit shadows and the like).
 * Thrown weapons add the STR to-hit and damage adjustments and their own
 * enchantment to both. DEX missile adjustment, racial bonus (halfling sling or
 * bow +3, elf bow +1) and the timed effects already on the character (bless,
 * prayer, curse, blindness, disease...: `fxHit`/`fxDmg`) are all included.
 *
 * `consumes` is the inventory entry one missile uses up (the ammo stack or
 * the thrown stack itself); combat decrements its qty per missile, and the
 * profile is null once it is empty.
 * `null` when there is no usable missile weapon or no ammunition for it.
 * @returns {{def:object, entry:object, hitBonus:number, dmgBonus:number, damage:string, damageLarge:string,
 *   range:number, bands:{short:number, medium:number, long:number}, thrown:boolean, magic:number,
 *   launcherMagic:number, ammoMagic:number, ammo:string|null, ammoEntry:object|null, consumes:object|null,
 *   fxHit:number, fxDmg:number, rateOfFire:number}|null}
 */
export function missileProfile(ch) {
  const inv = ch?.inventory ?? [];
  const has = (e) => (e.qty ?? 1) > 0;
  const ammoFor = (def) => {
    if (!def.ammo) return undefined;
    const stacks = inv.filter((e) => e.id === def.ammo && has(e));
    if (!stacks.length) return null;
    return stacks.find((e) => e.equipped) ?? stacks.reduce((b, e) => (itemMagic(e) > itemMagic(b) ? e : b));
  };
  const usable = (e) => {
    const d = ITEMS[e.id];
    return d?.type === 'weapon' && d.ranged && has(e) && ammoFor(d) !== null;
  };
  let entry = inv.find((e) => e.equipped && usable(e)) ?? inv.find(usable);
  let def = entry && ITEMS[entry.id];
  if (!entry) {
    // A spare throwable weapon: never the only one in hand.
    const spare = (e) => has(e) && !ITEMS[e.id]?.ranged && throwableDef(ITEMS[e.id]) && (!e.equipped || (e.qty ?? 1) > 1);
    entry = inv.find((e) => spare(e) && !e.equipped) ?? inv.find(spare);
    if (!entry) return null;
    def = throwableDef(ITEMS[entry.id]);
  }
  const ammoEntry = ammoFor(def) ?? null;
  const a = effectiveAbilities(ch);
  const str = strengthTable(a.str, a.strPct);
  const dex = dexterityMods(a.dex);
  const fx = effectMods(ch);
  const launcherMagic = itemMagic(entry);
  const ammoMagic = ammoEntry ? itemMagic(ammoEntry) : 0;
  const thrown = isThrownWeapon(def);
  return {
    def, entry, thrown,
    magic: ammoEntry ? Math.max(launcherMagic, ammoMagic) : launcherMagic,
    launcherMagic, ammoMagic,
    ammo: def.ammo ?? null, ammoEntry,
    consumes: ammoEntry ?? (thrown ? entry : null),
    hitBonus: dex.missile + launcherMagic + ammoMagic + racialWeaponHit(ch.race, def) + (thrown ? str.hit : 0) + fx.hit,
    dmgBonus: (thrown ? str.dmg + launcherMagic : ammoMagic) + fx.dmg,
    fxHit: fx.hit, fxDmg: fx.dmg,
    damage: def.damage, damageLarge: def.damageLarge ?? def.damage,
    range: missileRange(def) ?? def.range ?? 8, bands: missileRangeBands(def), rateOfFire: rateOfFire(def) * fx.attackMult,
  };
}

/**
 * Use up one missile of a profile (missileProfile().consumes): an arrow,
 * bolt, dart or thrown dagger. Thrown weapons that run out leave the pack (the
 * empty entry is removed; it lies on the battlefield). Returns the entry used.
 */
export function useMissile(ch, profile = missileProfile(ch)) {
  const e = profile?.consumes;
  if (!e) return null;
  e.qty = Math.max(0, (e.qty ?? 1) - 1);
  if (e.qty === 0 && profile.thrown) {
    const i = ch.inventory.indexOf(e);
    if (i >= 0) ch.inventory.splice(i, 1);
  }
  return e;
}

/** Can this character backstab now (an active thief class, armour that allows it)? */
export function canBackstab(ch) {
  return !!ch?.levels && backstabMultiplierOf(ch) > 0 && armorAllowsThieving(ch);
}

/**
 * Backstab damage multiplier (PHB: ×2 at thief levels 1-4, ×3 at 5-8...),
 * 0 when the thief class is not active (a dual-classed human whose thief
 * career is dormant, or no thief class at all).
 */
export function backstabMultiplierOf(ch) {
  if (!ch?.levels || !activeClasses(ch).includes('thief')) return 0;
  return backstabMultiplier(ch.levels.thief);
}

/**
 * Class/level labels for sheets: multiclass 'F2/MU2'; a dual-classed human
 * shows both careers, old first ('8/3', 'Fighter/Magic-User', 'F8 / MU3'),
 * with `dual` set and `dualActive` once the old class's abilities are back.
 * @returns {{levels:string, className:string, classAbbr:string, classLevels:string, dual:boolean, dualActive:boolean}}
 */
export function classLabels(ch) {
  const now = splitClasses(ch.classSpec);
  const cls = ch.dual ? [ch.dual.from, ...now.filter((c) => c !== ch.dual.from)] : now;
  const lvl = (c) => (ch.dual && c === ch.dual.from ? ch.dual.level : ch.levels[c]);
  return {
    levels: cls.map(lvl).join('/'),
    className: ch.dual ? `${cls.map((c) => CLASSES[c].name).join('/')} (dual)` : classSpecName(ch.classSpec),
    classAbbr: cls.map((c) => CLASSES[c].abbr).join('/'),
    classLevels: cls.map((c) => `${CLASSES[c].abbr}${lvl(c)}`).join(' / '),
    dual: !!ch.dual,
    dualActive: !!ch.dual && activeClasses(ch).includes(ch.dual.from),
  };
}

// ------------------------------------------------------- experience & levels

/** Maximum level reachable in a class: min(racial limit, Pool of Radiance cap). */
export function maxLevel(ch, classId, { caps = PR_LEVEL_CAPS } = {}) {
  const racial = racialLevelLimit(ch.race, classId, ch.abilities);
  return Math.min(racial, caps?.[classId] ?? Infinity);
}

/**
 * PHB prime requisite bonus: +10% XP for a single-classed character whose prime
 * requisite is 16+ (and for dual-classed humans in their new class).
 */
export function xpBonusPct(ch) {
  const classes = splitClasses(ch.classSpec);
  if (classes.length > 1) return 0;
  const prime = CLASSES[classes[0]].primeReq;
  return prime.every((k) => ch.abilities[k] >= 16) ? 10 : 0;
}

/**
 * Award XP; split evenly among classes for multiclass, +10% prime-requisite
 * bonus. Gold Box rule: a class can bank XP only up to one point short of the
 * level after next (you must train), and never past its maximum level.
 * @param {Character} ch
 * @param {number} amount
 * @param {{cap?:boolean, caps?:Record<string,number>}} [o]
 * @returns {string[]} classes that can now train
 */
export function awardXp(ch, amount, o = {}) {
  if (ch.status === 'dead' || ch.status === 'stoned' || ch.status === 'gone') return [];
  const classes = splitClasses(ch.classSpec);
  const share = Math.floor((amount * (100 + xpBonusPct(ch))) / 100 / classes.length);
  const ready = [];
  for (const c of classes) {
    const limit = maxLevel(ch, c, o);
    let xp = (ch.xp[c] ?? 0) + share;
    if (o.cap !== false) {
      const capLevel = Math.min(ch.levels[c] + 2, limit + 1);
      xp = Math.min(xp, xpForLevel(c, capLevel) - 1);
      xp = Math.max(xp, ch.xp[c] ?? 0);
    }
    ch.xp[c] = xp;
    if (Math.min(levelForXp(c, xp), limit) > ch.levels[c]) ready.push(c);
  }
  return ready;
}

/** Classes with enough XP to train (and not at their maximum level). */
export function trainableClasses(ch, o = {}) {
  return splitClasses(ch.classSpec).filter((c) => ch.levels[c] < maxLevel(ch, c, o) && levelForXp(c, ch.xp[c]) > ch.levels[c]);
}

/**
 * Cost to train. Pool of Radiance charges a flat 1,000 gp per training session
 * (all eligible classes at once); `mode:'dmg'` uses the DMG's 1,500 gp × level.
 */
export function trainingCost(ch, { mode = 'por' } = {}) {
  const classes = trainableClasses(ch);
  if (!classes.length) return 0;
  if (mode === 'dmg') return classes.reduce((t, c) => t + 1500 * ch.levels[c], 0);
  return 1000;
}

/** Perform training: raise every eligible class by one level (PoR rule: one level at a time). */
export function trainLevels(ch, rng, o = {}) {
  const raised = [];
  for (const c of trainableClasses(ch, o)) {
    advanceClassLevel(ch, c, rng);
    raised.push(c);
  }
  if (raised.length) refreshHp(ch);
  return raised;
}

/**
 * Energy drain (MM wight 1 level, spectre 2): each level is lost from the
 * character's highest-level class (ties: first listed), counting a dual-classed
 * human's dormant old class (its `dual.level` follows). The class's hit die
 * for that level goes, XP drops to the midpoint of the new level (DMG), and
 * hit points are recomputed (current hp falls by the same amount). Only when
 * every class is at 1st level does a drain kill.
 * @returns {{drained:{cls:string, level:number}[], died:boolean}}
 */
export function drainLevel(ch, n = 1) {
  const out = { drained: [], died: false };
  if (!isAlive(ch)) return out;
  for (let i = 0; i < n; i++) {
    // Every class with a level counts — a dual-classed human's dormant old
    // class too — and the highest goes first; death only when all are at 1.
    const classes = Object.keys(ch.levels ?? {}).filter((c) => (ch.levels[c] ?? 0) > 1);
    const cls = classes.reduce((best, c) => (ch.levels[c] > ch.levels[best] ? c : best), classes[0]);
    if (!cls) {
      ch.status = 'dead';
      ch.hp.cur = Math.min(ch.hp.cur, -10);
      out.died = true;
      return out;
    }
    const lvl = ch.levels[cls] - 1;
    ch.levels[cls] = lvl;
    ch.hpRolls[cls]?.pop();
    if (ch.dual && ch.dual.from === cls) ch.dual.level = lvl;
    ch.xp[cls] = Math.floor((xpForLevel(cls, lvl) + xpForLevel(cls, lvl + 1)) / 2);
    out.drained.push({ cls, level: lvl });
  }
  const oldMax = ch.hp.max;
  ch.hp.max = computeMaxHp(ch);
  ch.hp.cur -= Math.max(0, oldMax - ch.hp.max);
  if (ch.hp.cur <= -10) ch.status = 'dead';
  else if (ch.hp.cur < 0 && ch.status === 'ok') ch.status = 'dying';
  else if (ch.hp.cur === 0 && ch.status === 'ok') ch.status = 'unconscious';
  out.died = ch.status === 'dead';
  return out;
}

/**
 * Human dual-classing (PHB): needs 15+ in every prime requisite of the current
 * class and 17+ in those of the new one.
 * @returns {string|null} problem or null when allowed
 */
export function dualClassProblem(ch, newClass) {
  if (!RACES[ch.race].canDualClass) return 'only humans may change class';
  if (ch.dual) return 'already dual-classed';
  const cur = splitClasses(ch.classSpec);
  if (cur.length > 1) return 'multiclassed characters cannot change class';
  if (cur[0] === newClass) return 'same class';
  if (!CLASSES[newClass]) return 'unknown class';
  if (!CLASSES[cur[0]].primeReq.every((k) => ch.abilities[k] >= 15)) return 'needs 15 in current prime requisite';
  if (!CLASSES[newClass].primeReq.every((k) => ch.abilities[k] >= 17)) return 'needs 17 in new prime requisite';
  if (!meetsClassMinimums(ch.abilities, newClass)) return 'ability minimums not met';
  if (!allowedAlignments(newClass).includes(ch.alignment)) return 'alignment not allowed';
  return null;
}

/**
 * Classes a human may change to at the Training Hall right now (PoR lets
 * humans switch class there; the hall charges its usual training fee):
 * [{cls, ok, reason}] for every other base class, `ok` when dualClassProblem
 * allows it — the shop lists them with the reason as the tooltip.
 */
export function dualClassChoices(ch) {
  const from = splitClasses(ch.classSpec)[0];
  return Object.keys(CLASSES).filter((c) => !splitClasses(ch.classSpec).includes(c)).map((cls) => {
    const reason = dualClassProblem(ch, cls);
    const cap = maxLevel(ch, cls);
    return { cls, ok: !reason, reason, warning: dualClassWarning(ch, cls), regainAt: (ch.levels[from] ?? 1) + 1, cap };
  });
}

/**
 * The trap in dual-classing under Pool of Radiance caps: the old class's
 * abilities come back only once the new class *exceeds* the old level. If the
 * new class's maximum (PR cap or racial limit) is at or below the current
 * level, they never will. Returns a warning string, or null.
 * e.g. "you will never regain Fighter abilities (MU cap 6 ≤ F8)".
 */
export function dualClassWarning(ch, newClass) {
  if (ch.dual || !CLASSES[newClass]) return null;
  const cur = splitClasses(ch.classSpec);
  if (cur.length !== 1 || cur[0] === newClass) return null;
  const from = cur[0];
  const lvl = ch.levels[from] ?? 1;
  const cap = maxLevel(ch, newClass);
  if (cap > lvl) return null;
  return `you will never regain ${CLASSES[from].name} abilities (${CLASSES[newClass].abbr} cap ${cap} \u2264 ${CLASSES[from].abbr}${lvl})`;
}

/** Switch a human to a new class at level 1 (keeps old hp/levels in reserve). */
export function dualClass(ch, newClass) {
  const p = dualClassProblem(ch, newClass);
  if (p) throw new Error(p);
  const from = ch.classSpec;
  ch.dual = { from, level: ch.levels[from] };
  ch.classSpec = newClass;
  ch.levels[newClass] = 1;
  ch.xp[newClass] = 0;
  // New-class hit dice only add hp for levels beyond the old class level.
  ch.hpRolls[newClass] = [CLASSES[newClass].hitDie];
  if ((newClass === 'cleric' || newClass === 'magicUser')) ch.spells.memorized[newClass] ??= [];
  if (newClass === 'magicUser' && !ch.spells.book.length) ch.spells.book = ['readMagic'];
  refreshHp(ch);
  return ch;
}

// ------------------------------------------------------- damage & healing

/** Can act in combat / exploration. */
export function isConscious(ch) {
  return ch.status === 'ok' && ch.hp.cur > 0;
}

/** Alive in any form (dying and unconscious count; dead, stoned, gone don't). */
export function isAlive(ch) {
  return !['dead', 'stoned', 'gone'].includes(ch.status);
}

/**
 * Apply damage with 1e death's door: 0 → unconscious, -1..-9 dying (bleeds 1
 * hp/round until bandaged), <= -10 dead. Damage wakes magical sleepers.
 * @returns {string} new status
 */
export function applyDamage(ch, dmg) {
  if (dmg <= 0 || !isAlive(ch)) return ch.status;
  ch.hp.cur -= dmg;
  onDamaged(ch);
  if (ch.hp.cur <= -10) {
    ch.status = 'dead';
    removeEffect(ch, 'bandaged');
  } else if (ch.hp.cur < 0) {
    ch.status = 'dying';
    removeEffect(ch, 'bandaged');
  } else if (ch.hp.cur === 0) ch.status = 'unconscious';
  return ch.status;
}

/**
 * One round of bleeding for a dying, unbandaged character.
 * @returns {boolean} true if hp was lost
 */
export function bleed(ch) {
  if (ch.status !== 'dying' || hasEffect(ch, 'bandaged')) return false;
  ch.hp.cur -= 1;
  if (ch.hp.cur <= -10) ch.status = 'dead';
  return true;
}

/** Bandage a dying character: bleeding stops; they stay unconscious. */
export function bandage(ch) {
  if (ch.status !== 'dying') return false;
  ch.status = 'unconscious';
  addEffect(ch, 'bandaged');
  return true;
}

/** Heal; brings the unconscious/dying back to consciousness above 0 hp. Returns hp restored. */
export function heal(ch, amount) {
  if (!isAlive(ch)) return 0;
  const before = ch.hp.cur;
  ch.hp.cur = Math.min(ch.hp.max, ch.hp.cur + Math.max(0, amount));
  if (ch.hp.cur > 0 && (ch.status === 'dying' || ch.status === 'unconscious')) {
    ch.status = 'ok';
    removeEffect(ch, 'bandaged');
  } else if (ch.status === 'dying' && amount > 0) {
    // DMG ruling: any healing stops the bleeding, even if the total is still
    // below zero; the character stays unconscious until above 0 hp.
    ch.status = 'unconscious';
    if (ch.hp.cur < 0) addEffect(ch, 'bandaged');
  }
  return ch.hp.cur - before;
}

/**
 * Raise dead (temple or spell): resurrection survival roll vs CON; success
 * returns the character at 1 hp and costs 1 point of CON (PHB).
 * @returns {{ok:boolean, roll:number, needed:number}}
 */
export function raiseDead(rng, ch, { allowElves = false } = {}) {
  if (ch.status !== 'dead') return { ok: false, roll: 0, needed: 0 };
  // PHB: elves cannot be raised (only resurrected).
  if (ch.race === 'elf' && !allowElves) return { ok: false, roll: 0, needed: 0, reason: 'elf' };
  const needed = constitutionTable(ch.abilities.con).resurrection;
  const r = rng.int(1, 100);
  if (r > needed) {
    ch.status = 'gone';
    return { ok: false, roll: r, needed };
  }
  ch.abilities.con = Math.max(3, ch.abilities.con - 1);
  ch.status = 'ok';
  ch.hp.max = computeMaxHp(ch);
  ch.hp.cur = 1;
  ch.effects = [];
  ch.conditions = [];
  return { ok: true, roll: r, needed };
}

/** Stone to flesh (temple): system shock roll. */
export function stoneToFlesh(rng, ch) {
  if (ch.status !== 'stoned') return { ok: false, roll: 0, needed: 0 };
  const needed = constitutionTable(ch.abilities.con).systemShock;
  const r = rng.int(1, 100);
  if (r > needed) {
    ch.status = 'dead';
    return { ok: false, roll: r, needed };
  }
  ch.status = ch.hp.cur > 0 ? 'ok' : 'unconscious';
  removeEffect(ch, 'stoned');
  return { ok: true, roll: r, needed };
}

/** Plain-language status line for the roster ("OKAY", "DYING", "POISONED"...). */
export function statusLabel(ch) {
  if (ch.status === 'ok') {
    if (hasEffect(ch, 'poisoned')) return 'Poisoned';
    if (hasEffect(ch, 'asleep')) return 'Asleep';
    if (hasEffect(ch, 'held') || hasEffect(ch, 'paralyzed')) return 'Held';
    if (hasEffect(ch, 'charmed')) return 'Charmed';
    return 'Okay';
  }
  return { unconscious: 'Unconscious', dying: 'Dying', dead: 'Dead', stoned: 'Stoned', fled: 'Fled', gone: 'Gone' }[ch.status] ?? ch.status;
}
