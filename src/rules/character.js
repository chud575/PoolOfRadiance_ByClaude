import { roll } from './dice.js';
import { ABILITIES, strengthMods, dexterityMods, conHpBonus, wisdomBonusSpells } from './abilities.js';
import { RACES, racialSaveBonus, raceAllowsClass } from './races.js';
import {
  CLASSES, splitClasses, levelForXp, thac0For, savesFor, SAVE_KEYS, spellSlots, thiefSkills, classSpecName,
} from './classes.js';
import { ITEMS } from '../data/items.js';

/**
 * @typedef {Object} InventoryEntry
 * @property {string} id        item id (data/items.js)
 * @property {number} [qty]
 * @property {boolean} [equipped]
 * @property {boolean} [identified]
 * @property {number} [charges]
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
 * @property {{memorized: Record<string,string[]>, book: string[]}} spells
 * @property {'ok'|'unconscious'|'dying'|'dead'|'stoned'|'fled'|'gone'} status
 * @property {string[]} conditions      transient effects ('blessed','asleep','held',...)
 * @property {number} age
 * @property {{seed:number, palette?:number, style?:string}} look   portrait/combat-icon parameters
 */

let _idCounter = 0;
const newId = (rng) => `c${Date.now().toString(36)}${(_idCounter++).toString(36)}${rng ? rng.int(0, 1e6).toString(36) : ''}`;

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
export function applyRace(abilities, raceId) {
  const race = RACES[raceId];
  const out = { ...abilities };
  for (const k of ABILITIES) {
    out[k] = (out[k] ?? 10) + (race.adjust[k] ?? 0);
    out[k] = Math.max(race.min[k], Math.min(race.max[k], out[k]));
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
 * Roll a legal ability set for race+class (re-rolls until minimums met, max 200 tries,
 * then bumps the required scores). Gives 18/xx exceptional strength to fighters.
 */
export function rollLegalAbilities(rng, raceId, classSpec, method = '4d6') {
  let a;
  for (let i = 0; i < 200; i++) {
    a = applyRace(rollAbilityScores(rng, method), raceId);
    if (meetsClassMinimums(a, classSpec)) break;
  }
  for (const c of splitClasses(classSpec)) {
    for (const [k, v] of Object.entries(CLASSES[c].minAbilities)) a[k] = Math.max(a[k], v);
  }
  a.strPct = a.str === 18 && splitClasses(classSpec).includes('fighter') ? rng.int(1, 100) : 0;
  return a;
}

/**
 * Create a level-1 character.
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
 * @returns {Character}
 */
export function createCharacter(opts) {
  const { rng, name, race, classSpec } = opts;
  if (!RACES[race]) throw new Error(`Unknown race ${race}`);
  if (!raceAllowsClass(race, classSpec)) throw new Error(`${race} cannot be ${classSpec}`);
  const classes = splitClasses(classSpec);
  const abilities = opts.abilities ?? rollLegalAbilities(rng, race, classSpec);
  const level = opts.level ?? 1;
  const ch = {
    id: newId(rng),
    name,
    race,
    classSpec,
    gender: opts.gender ?? 'male',
    alignment: opts.alignment ?? 'TN',
    abilities: { ...abilities },
    xp: {},
    levels: {},
    hpRolls: {},
    hp: { cur: 0, max: 0 },
    inventory: [],
    gold: 0,
    spells: { memorized: {}, book: [] },
    status: 'ok',
    conditions: [],
    age: 16 + rng.int(1, 12),
    look: { seed: rng.int(1, 1e9) },
  };
  for (const c of classes) {
    ch.levels[c] = 1;
    ch.xp[c] = 0;
    const die = CLASSES[c].hitDie;
    ch.hpRolls[c] = [opts.maxHpAtFirst === false ? rng.die(die) : die];
  }
  for (let l = 2; l <= level; l++) {
    for (const c of classes) {
      ch.xp[c] = CLASSES[c].xp[l - 1] ?? ch.xp[c];
      advanceClassLevel(ch, c, rng);
    }
  }
  ch.hp.max = computeMaxHp(ch);
  ch.hp.cur = ch.hp.max;
  const goldDice = { fighter: '5d4x10', cleric: '3d6x10', magicUser: '2d4x10', thief: '2d6x10' };
  ch.gold = roll(rng, goldDice[classes[0]]);
  for (const id of opts.items ?? []) addItem(ch, id, { equip: true });
  if (classes.includes('magicUser')) ch.spells.book = ['magicMissile', 'sleep', 'shield', 'readMagic'];
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
 * by number of classes (multiclass rule). Minimum 1 per level.
 */
export function computeMaxHp(ch) {
  const classes = splitClasses(ch.classSpec);
  const isFighter = classes.includes('fighter');
  let total = 0;
  for (const c of classes) {
    const rolls = ch.hpRolls[c];
    const cls = CLASSES[c];
    rolls.forEach((r, i) => {
      const bonus = i < cls.hdCap ? conHpBonus(ch.abilities.con, isFighter) : 0;
      total += Math.max(1, r + bonus);
    });
  }
  return Math.max(1, Math.floor(total / classes.length));
}

/** Add an item to inventory. Auto-equip when opts.equip and slot is free. */
export function addItem(ch, itemId, opts = {}) {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`Unknown item ${itemId}`);
  const entry = { id: itemId, qty: def.qty ?? 1, identified: !def.unidName, equipped: false };
  if (def.charges) entry.charges = def.charges;
  ch.inventory.push(entry);
  if (opts.equip && canEquip(ch, itemId) && !slotOccupied(ch, def)) equipItem(ch, ch.inventory.length - 1);
  return entry;
}

/** True if an equipped item already fills the slot `def` would use (rings allow 2). */
function slotOccupied(ch, def) {
  const slot = SLOT_OF[def.type];
  if (!slot) return true;
  const inSlot = ch.inventory.filter((e) => e.equipped && SLOT_OF[ITEMS[e.id].type] === slot).length;
  if (slot === 'ring') return inSlot >= 2;
  if (slot === 'offhand' && ch.inventory.some((e) => e.equipped && ITEMS[e.id].twoHanded)) return true;
  if (slot === 'hand' && def.twoHanded && ch.inventory.some((e) => e.equipped && ITEMS[e.id].type === 'shield')) return true;
  return inSlot > 0;
}

/** Can this character use/equip the item (class armor/weapon restrictions)? */
export function canEquip(ch, itemId) {
  const def = ITEMS[itemId];
  const classes = splitClasses(ch.classSpec);
  if (def.type === 'weapon') {
    return classes.some((c) => CLASSES[c].weapons === 'any' || CLASSES[c].weapons.includes(def.weaponGroup));
  }
  if (def.type === 'armor') {
    // Multiclass thieves/MUs may wear armor but lose abilities; PoR: MU can't cast in armor.
    return classes.some((c) => CLASSES[c].armor === 'any' || (Array.isArray(CLASSES[c].armor) && CLASSES[c].armor.includes(def.armorGroup)));
  }
  if (def.type === 'shield') return classes.some((c) => c === 'fighter' || c === 'cleric');
  return ['helm', 'ring', 'ammo'].includes(def.type);
}

const SLOT_OF = { weapon: 'hand', armor: 'body', shield: 'offhand', helm: 'head', ring: 'ring', ammo: 'quiver' };

/** Equip inventory[index], unequipping anything in the same slot. */
export function equipItem(ch, index) {
  const entry = ch.inventory[index];
  const def = ITEMS[entry.id];
  const slot = SLOT_OF[def.type];
  if (!slot) return false;
  for (const e of ch.inventory) {
    if (e === entry || !e.equipped) continue;
    const d = ITEMS[e.id];
    const s = SLOT_OF[d.type];
    if (s === slot && slot !== 'ring') e.equipped = false;
    if (def.twoHanded && s === 'offhand') e.equipped = false;
    if (def.type === 'shield' && d.twoHanded) e.equipped = false;
  }
  if (slot === 'ring' && ch.inventory.filter((e) => e.equipped && ITEMS[e.id].type === 'ring').length >= 2) return false;
  // A ranged weapon (bow) is held instead of the melee weapon; PoR swaps via READY.
  entry.equipped = true;
  return true;
}

/** Equipped items as [entry, def] pairs. */
export function equipped(ch) {
  return ch.inventory.filter((e) => e.equipped).map((e) => [e, ITEMS[e.id]]);
}

/**
 * All derived combat stats. Pure function of the character.
 * @returns {{thac0:number, ac:number, saves:Record<string,number>, hitBonus:number, dmgBonus:number,
 *   weapon: import('../data/schema.js').ItemDef|null, damage:string, damageLarge:string, attacks:number,
 *   move:number, spellSlots:Record<string,number[]>, thief:Record<string,number>|null, levels:string, className:string}}
 */
export function deriveStats(ch) {
  const classes = splitClasses(ch.classSpec);
  const race = RACES[ch.race];
  const a = ch.abilities;
  const str = strengthMods(a.str, a.strPct);
  const dex = dexterityMods(a.dex);
  const thac0 = Math.min(...classes.map((c) => thac0For(c, ch.levels[c])));
  const saves = {};
  const raceBonus = racialSaveBonus(ch.race, a.con);
  let ringSave = 0;
  let ac = 10;
  let weapon = null;
  let magicHit = 0;
  for (const [, d] of equipped(ch)) {
    if (d.type === 'armor') ac = Math.min(ac, d.ac - (d.magic ?? 0));
    if (d.type === 'weapon' && !weapon) weapon = d;
    if (d.saveBonus) ringSave += d.saveBonus;
  }
  for (const [, d] of equipped(ch)) {
    if (d.type === 'shield' || d.type === 'helm' || d.type === 'ring') ac -= (d.acBonus ?? 0) + (d.type !== 'ring' ? d.magic ?? 0 : 0);
  }
  ac += dex.ac;
  if (weapon) magicHit = weapon.magic ?? 0;
  for (const k of SAVE_KEYS) {
    saves[k] = Math.min(...classes.map((c) => savesFor(c, ch.levels[c])[k]));
    if (k === 'ppdm' || k === 'rsw' || k === 'sp') saves[k] -= raceBonus; // dwarves etc. vs magic/poison
    saves[k] -= ringSave;
  }
  const slots = {};
  for (const c of classes) {
    if (c === 'cleric') {
      const base = spellSlots('cleric', ch.levels.cleric);
      const bonus = wisdomBonusSpells(a.wis);
      slots.cleric = base.map((n, i) => n + (bonus[i] ?? 0));
    } else if (c === 'magicUser') {
      slots.magicUser = spellSlots('magicUser', ch.levels.magicUser);
    }
  }
  const fighterLvl = ch.levels.fighter ?? 0;
  const ranged = !!weapon?.ranged;
  return {
    thac0,
    ac,
    saves,
    hitBonus: (ranged ? dex.missile : str.hit) + magicHit,
    dmgBonus: (ranged ? 0 : str.dmg) + magicHit,
    weapon,
    damage: weapon?.damage ?? '1d2',
    damageLarge: weapon?.damageLarge ?? '1d2',
    attacks: fighterLvl >= 13 ? 2 : fighterLvl >= 7 ? 1.5 : 1,
    move: armorMove(ch, race.move),
    spellSlots: slots,
    thief: classes.includes('thief') ? thiefSkills(ch.levels.thief, race.thiefAdj) : null,
    levels: classes.map((c) => ch.levels[c]).join('/'),
    className: classSpecName(ch.classSpec),
  };
}

function armorMove(ch, base) {
  const body = equipped(ch).find(([, d]) => d.type === 'armor')?.[1];
  if (!body || body.magic) return base;
  if (['chain', 'banded', 'splint', 'plate'].includes(body.armorGroup)) return Math.max(3, base - 3);
  return base;
}

/**
 * Award XP; splits among classes for multiclass. Returns list of classes that
 * can now train (PoR requires a Training Hall to actually level).
 */
export function awardXp(ch, amount) {
  const classes = splitClasses(ch.classSpec);
  const share = Math.floor(amount / classes.length);
  const ready = [];
  for (const c of classes) {
    ch.xp[c] += share;
    const limit = RACES[ch.race].levelLimits[c] ?? Infinity;
    const target = Math.min(levelForXp(c, ch.xp[c]), limit);
    if (target > ch.levels[c]) ready.push(c);
  }
  return ready;
}

/** Perform training: raise every eligible class by one level (PoR rule: one level at a time). */
export function trainLevels(ch, rng) {
  const raised = [];
  for (const c of splitClasses(ch.classSpec)) {
    const limit = RACES[ch.race].levelLimits[c] ?? Infinity;
    if (levelForXp(c, ch.xp[c]) > ch.levels[c] && ch.levels[c] < limit) {
      advanceClassLevel(ch, c, rng);
      raised.push(c);
    }
  }
  const oldMax = ch.hp.max;
  ch.hp.max = computeMaxHp(ch);
  ch.hp.cur += ch.hp.max - oldMax;
  return raised;
}

/** Can act in combat / exploration. */
export function isConscious(ch) {
  return ch.status === 'ok' && ch.hp.cur > 0;
}

/**
 * Apply damage with 1e-style death's door: 0 → unconscious, -1..-9 dying, <= -10 dead.
 * (Gold Box: at 0 or below unconscious/dying; dying loses 1 hp/round until bandaged.)
 */
export function applyDamage(ch, dmg) {
  ch.hp.cur -= dmg;
  if (ch.hp.cur <= -10) ch.status = 'dead';
  else if (ch.hp.cur < 0) ch.status = 'dying';
  else if (ch.hp.cur === 0) ch.status = 'unconscious';
  return ch.status;
}

export function heal(ch, amount) {
  if (ch.status === 'dead' || ch.status === 'stoned') return 0;
  const before = ch.hp.cur;
  ch.hp.cur = Math.min(ch.hp.max, ch.hp.cur + amount);
  if (ch.hp.cur > 0 && (ch.status === 'dying' || ch.status === 'unconscious')) ch.status = 'ok';
  return ch.hp.cur - before;
}
