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
  itemMagic, itemWeight, coinWeight, encumbranceCategory, armorMoveLimit, rateOfFire, makeEntry,
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

let _idCounter = 0;
const newId = (rng) => `c${(_idCounter++).toString(36)}${rng ? rng.int(0, 36 ** 5).toString(36) : ''}`;

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
  return Math.min(cap, rng.int(1, 100));
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
 * @param {number} [opts.level]          start at this level in every class (debug/test parties)
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
    id: newId(rng),
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
  for (let l = 2; l <= level; l++) {
    for (const c of classes) {
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
 * by number of classes (multiclass rule). Minimum 1 per level. Dual-classed
 * humans keep their old class's hit points and gain the new class's only once
 * it exceeds the old level.
 */
export function computeMaxHp(ch) {
  const classes = Object.keys(ch.hpRolls);
  const isFighter = classes.includes('fighter');
  const con = ch.abilities.con;
  const perClass = (c) => {
    const cls = CLASSES[c];
    return ch.hpRolls[c].reduce((t, r, i) => t + Math.max(1, r + (i < cls.hdCap ? conHpBonus(con, isFighter) : 0)), 0);
  };
  if (ch.dual) {
    const now = splitClasses(ch.classSpec)[0];
    const oldHp = perClass(ch.dual.from);
    const rolls = ch.hpRolls[now] ?? [];
    const extra = rolls.slice(ch.dual.level).reduce((t, r, i) => t + Math.max(1, r + (ch.dual.level + i < CLASSES[now].hdCap ? conHpBonus(con, isFighter) : 0)), 0);
    return Math.max(1, oldHp + extra);
  }
  const total = classes.reduce((t, c) => t + perClass(c), 0);
  return Math.max(1, Math.floor(total / classes.length));
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
  const def = ITEMS[itemId];
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

/**
 * Current ability scores after magic: gauntlets of ogre power / girdles (setStr),
 * the Strength spell and potions (strBonus / strSet), Enlarge, Ray of
 * Enfeeblement (strLossPct), Friends (cha).
 */
export function effectiveAbilities(ch) {
  const a = { ...ch.abilities, strPct: ch.abilities.strPct ?? 0 };
  const fx = effectMods(ch);
  const fighter = splitClasses(ch.classSpec).includes('fighter');
  if (fx.strBonus) Object.assign(a, addStrength(a.str, a.strPct, fx.strBonus, fighter));
  const sets = [];
  for (const [e, d] of equipped(ch)) if (d.setStr) sets.push({ strPct: 0, ...d.setStr, _e: e });
  if (fx.strSet) sets.push(fx.strSet);
  for (const s of sets) if (s.str * 1000 + (s.str === 18 ? s.strPct : 0) > a.str * 1000 + (a.str === 18 ? a.strPct : 0)) { a.str = s.str; a.strPct = s.str === 18 ? s.strPct : 0; }
  if (fx.strLossPct) {
    const eff = a.str + (a.str === 18 ? a.strPct / 100 : 0);
    a.str = Math.max(3, Math.floor(eff * (1 - fx.strLossPct / 100)));
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

/** Highest level among the character's classes (used for caster level fallbacks, UI). */
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
 * @returns {{thac0:number, ac:number, acRear:number, acMissile:number, saves:Record<string,number>,
 *   hitBonus:number, dmgBonus:number, missileHit:number, weapon: import('../data/schema.js').ItemDef|null,
 *   weaponEntry: InventoryEntry|null, weaponMagic:number, ranged:boolean, range:number, damage:string,
 *   damageLarge:string, attacks:number, move:number, baseMove:number, weight:number,
 *   encumbrance:{category:number, move:number, label:string, next:number}, spellSlots:Record<string,number[]>,
 *   canCastArcane:boolean, thief:Record<string,number>|null, backstab:number, levels:string, className:string,
 *   classAbbr:string, abilities:object, mods:object, immune:string[], resist:Record<string,number>,
 *   images:number, attackerHit:number, missChance:number}}
 */
export function deriveStats(ch) {
  const classes = activeClasses(ch);
  const race = RACES[ch.race];
  const a = effectiveAbilities(ch);
  const str = strengthTable(a.str, a.strPct);
  const dex = dexterityMods(a.dex);
  const fx = effectMods(ch);
  const thac0 = Math.min(...classes.map((c) => thac0For(c, ch.levels[c] ?? 1)));
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
  for (const [e, d] of gear) {
    const m = itemMagic(e);
    if (d.type === 'armor') {
      armorDef = d;
      armorMagic = m;
      base = Math.min(base, d.ac - m);
    } else if (d.acBase !== undefined) {
      base = Math.min(base, d.acBase); // bracers of defense: do not stack with armour
    }
    if (d.type === 'shield') shieldAc += (d.acBonus ?? 1) + m;
    else if (d.type !== 'armor') otherAc += (d.acBonus ?? 0) + (d.type === 'helm' ? m : 0);
    if (d.type === 'weapon' && !weapon) { weapon = d; weaponEntry = e; }
    saveBonus += d.saveBonus ?? 0;
  }
  const dexAc = hasEffect(ch, 'blinded') ? Math.max(0, dex.ac) : dex.ac; // blind: no dex bonus
  let ac = base - shieldAc - otherAc + dexAc + fx.ac;
  const acRear = base - otherAc + Math.max(0, dexAc) + fx.ac;
  let acMissile = ac;
  if (fx.acVsMelee != null) ac = Math.min(ac, fx.acVsMelee);
  if (fx.acVsMissile != null) acMissile = Math.min(acMissile, fx.acVsMissile);
  else acMissile = ac;

  // ---- saving throws
  const saves = {};
  const magicBonus = racialSaveBonus(ch.race, ch.abilities.con);
  const poisonBonus = racialPoisonBonus(ch.race, ch.abilities.con);
  for (const k of SAVE_KEYS) {
    saves[k] = Math.min(...classes.map((c) => savesFor(c, ch.levels[c] ?? 1)[k]));
    if (k === 'rsw' || k === 'sp') saves[k] -= magicBonus;
    if (k === 'ppdm') saves[k] -= poisonBonus;
    saves[k] -= saveBonus + fx.save + (fx.saveVs[k] ?? 0);
    saves[k] = Math.max(2, saves[k]);
  }

  // ---- weapon
  const ranged = !!weapon?.ranged;
  const wMagic = weaponEntry ? itemMagic(weaponEntry) : 0;
  let racial = 0;
  if (ranged && race.missileBonus && ['sling', 'shortBow', 'longBow', 'compositeBow'].includes(weapon.weaponGroup)) racial = race.missileBonus;
  if (ch.race === 'elf' && weapon && ['shortBow', 'longBow', 'shortSword', 'longSword'].includes(weapon.weaponGroup)) racial = Math.max(racial, 1);
  // Thrown weapons get both the DEX missile and the STR to-hit adjustments (DMG).
  const hitBonus = (ranged ? dex.missile + (weapon.thrown ? str.hit : 0) : str.hit) + wMagic + racial + fx.hit;
  const dmgBonus = (ranged && !weapon.thrown ? 0 : str.dmg) + wMagic + fx.dmg;

  // ---- attacks per round
  const fighterLvl = classes.includes('fighter') ? ch.levels.fighter ?? 0 : 0;
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
    saves,
    hitBonus,
    dmgBonus,
    missileHit: dex.missile + (weapon?.thrown ? str.hit : 0) + wMagic + fx.hit,
    weapon,
    weaponEntry,
    weaponMagic: wMagic,
    ranged,
    range: weapon?.range ?? 1,
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
    backstab: classes.includes('thief') ? backstabMultiplier(ch.levels.thief) : 0,
    levels: splitClasses(ch.classSpec).map((c) => ch.levels[c]).join('/'),
    className: classSpecName(ch.classSpec),
    classAbbr: classSpecAbbr(ch.classSpec),
    abilities: a,
    mods: fx,
    immune: [...fx.immune],
    resist: fx.resist,
    images: fx.images,
    attackerHit: fx.attackerHit,
    missChance: fx.missChance,
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
  } else if (ch.hp.cur === 0 && ch.status === 'dying') ch.status = 'unconscious';
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
