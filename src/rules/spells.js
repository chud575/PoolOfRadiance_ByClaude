import { roll } from './dice.js';
import { SPELLS as DATA_SPELLS } from '../data/spells.js';
import { splitClasses, CLASSES } from './classes.js';
import { deriveStats, activeClasses, armorAllowsArcane, highestLevel, effectiveAbilities } from './character.js';
import { wisdomSpellFailure } from './abilities.js';
import {
  addEffect, removeEffect, hasEffect, effectMods, conditionsAllowCasting, clearEffects, CONDITIONS,
  ROUNDS_PER_TURN, ROUNDS_PER_HOUR,
} from './conditions.js';
import {
  characterOf, monsterOf, tagsOf, isUndead, isPerson, hitDiceOf, nameOf, sideOf, effectHost,
  damageCreature, healCreature, isAliveCreature, isDownCreature, acOf, attackOf, hasTag,
} from './creature.js';
import { rollSave } from './saves.js';
import { RACES } from './races.js';
import { neededToHit } from './tohit.js';

/**
 * The complete Pool of Radiance spell list (cleric 1-3, magic-user 1-3) plus
 * the temple-only healing magic, as data with small formula functions, and a
 * resolver that applies them to any creatures. Combat, camp and scripted
 * events all call castSpell(); presentation (targeting UI, VFX) stays in the
 * scenes.
 *
 * Units: range/area in battle squares (1 square = 10'), durations in rounds.
 *
 * @typedef {Object} SpellOp  one step of a spell's effect program
 * @property {string} op   damage | heal | condition | remove | sleep | dispel | hammer | touch |
 *                         flag | strength | mirror | haste | charm | removeCurse | enlarge | age
 *
 * @typedef {Object} SpellRules
 * @property {string} id
 * @property {string} name
 * @property {Record<string,number>} schools   casting class → spell level
 * @property {'combat'|'camp'|'both'} usable
 * @property {number|function(number,string):number} castTime  segments (initiative delay); per class for
 *   spells both classes cast (PHB: MU Hold Person / Dispel Magic 3, cleric 5 / 6)
 * @property {number|function(number):number} range  squares (0 = self, 1 = touch)
 * @property {'self'|'ally'|'enemy'|'creature'|'area'|'direction'|'party'|'none'} target
 * @property {{shape:'single'|'radius'|'square'|'cone'|'line'|'all', size?:number|function(number):number}} area
 * @property {number|function(number):number} [maxTargets]
 * @property {number|function(number):number} [duration]  rounds
 * @property {{key:string, type:'neg'|'half'}} [save]
 * @property {boolean} [mental]  WIS adjusts the save
 * @property {boolean} [dodge]   DEX adjusts the save
 * @property {string} [element]
 * @property {string} [affects]  'any'|'person'|'living'|'undead'|'snake'|'allies'|'enemies'
 * @property {boolean} [hostile]
 * @property {string} [reverse]  id of the reversed form
 * @property {boolean} [templeOnly]
 * @property {boolean} [itemOnly]   released only by a magic item (Wand of Paralyzation)
 * @property {SpellOp[]} ops
 * @property {string} desc  terse, evocative
 * @property {string} tip   mechanics summary for tooltips
 */

const lvlDice = (n, die) => `${Math.max(1, n)}d${die}`;
/**
 * Spells whose PHB duration runs in turns or hours (or until broken): their
 * effects outlive a battle — clearCombatEffects keeps them and passTime /
 * syncPartyTime expire them — so a buff cast in camp is not wasted by the
 * first fight. Round-measured spells (Bless, Haste, Mirror Image...) end with
 * the battle.
 */
export const LONG_DURATION_SPELLS = new Set([
  'resistCold', 'resistFire', 'slowPoison', 'bestowCurse', 'enlarge', 'reduce', 'strength', 'protNormalMissiles',
  'invisibility', 'invisibility10', 'detectInvisibility', 'detectMagic', 'findTraps', 'cureBlindness', 'causeBlindness',
  'causeDisease',
]);
const persistsOf = (s) => LONG_DURATION_SPELLS.has(s.id) || undefined;

const R = (n) => n; // rounds
const T = (n) => n * ROUNDS_PER_TURN; // turns → rounds
const H = (n) => n * ROUNDS_PER_HOUR; // hours → rounds

/** @type {Record<string, SpellRules>} */
export const SPELL_RULES = {
  // ============================================================ CLERIC 1
  bless: {
    name: 'Bless', schools: { cleric: 1 }, usable: 'both', castTime: 10, range: 6, target: 'party',
    area: { shape: 'square', size: 5 }, affects: 'allies', duration: 6, reverse: 'curse',
    ops: [{ op: 'condition', id: 'blessed' }],
    desc: 'A benediction steels the hearts of your companions.', tip: 'Allies: +1 to hit and morale for 6 rounds.',
  },
  curse: {
    name: 'Curse', schools: { cleric: 1 }, usable: 'combat', castTime: 10, range: 6, target: 'area',
    area: { shape: 'square', size: 5 }, affects: 'enemies', duration: 6, hostile: true, reverse: 'bless',
    ops: [{ op: 'condition', id: 'cursed' }],
    desc: 'A malediction saps the resolve of your foes.', tip: 'Enemies in a 5x5 area: -1 to hit for 6 rounds.',
  },
  cureLightWounds: {
    name: 'Cure Light Wounds', schools: { cleric: 1 }, usable: 'both', castTime: 5, range: 1, target: 'ally',
    area: { shape: 'single' }, affects: 'living', reverse: 'causeLightWounds',
    ops: [{ op: 'heal', dice: '1d8' }],
    desc: 'Warm light knits torn flesh.', tip: 'Touch: heals 1d8 hit points.',
  },
  causeLightWounds: {
    name: 'Cause Light Wounds', schools: { cleric: 1 }, usable: 'combat', castTime: 5, range: 1, target: 'enemy',
    area: { shape: 'single' }, affects: 'living', hostile: true, reverse: 'cureLightWounds',
    ops: [{ op: 'touch' }, { op: 'damage', dice: '1d8' }],
    desc: 'A withering touch opens wounds.', tip: 'Touch attack: 1d8 damage.',
  },
  detectMagic: {
    name: 'Detect Magic', schools: { cleric: 1, magicUser: 1 }, usable: 'camp', castTime: (L, s) => (s === 'magicUser' ? 1 : 10), range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L, s) => (s === 'magicUser' ? R(2 * L) : T(1)),
    ops: [{ op: 'flag', flag: 'detectMagic' }, { op: 'condition', id: 'detectMagic' }],
    desc: 'Enchanted things shimmer with a faint blue radiance.', tip: 'Reveals which carried items are magical.',
  },
  protectionFromEvil: {
    name: 'Protection from Evil', schools: { cleric: 1, magicUser: 1 }, usable: 'both', castTime: (L, s) => (s === 'magicUser' ? 1 : 4), range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L, s) => (s === 'magicUser' ? R(2 * L) : R(3 * L)), reverse: 'protectionFromGood',
    ops: [{ op: 'condition', id: 'protEvil' }],
    desc: 'A ward of silver light turns aside evil.', tip: 'Touch: -2 AC and +2 saves against evil attackers.',
  },
  protectionFromGood: {
    name: 'Protection from Good', schools: { cleric: 1, magicUser: 1 }, usable: 'both', castTime: (L, s) => (s === 'magicUser' ? 1 : 4), range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L, s) => (s === 'magicUser' ? R(2 * L) : R(3 * L)), reverse: 'protectionFromEvil',
    ops: [{ op: 'condition', id: 'protGood' }],
    desc: 'A dark ward repels the righteous.', tip: 'Touch: -2 AC and +2 saves against good attackers.',
  },
  resistCold: {
    name: 'Resist Cold', schools: { cleric: 1 }, usable: 'both', castTime: 10, range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L) => T(L),
    ops: [{ op: 'condition', id: 'resistCold' }],
    desc: 'Frost cannot find purchase on the blessed.', tip: 'Touch: half damage from cold, +3 to saves vs cold.',
  },

  // ============================================================ CLERIC 2
  findTraps: {
    name: 'Find Traps', schools: { cleric: 2 }, usable: 'camp', castTime: 5, range: 0, target: 'self',
    area: { shape: 'single' }, duration: T(3),
    ops: [{ op: 'flag', flag: 'findTraps' }, { op: 'condition', id: 'findTraps' }],
    desc: 'Hidden snares glow to the cleric\'s eye.', tip: 'Reveals traps ahead for 3 turns.',
  },
  holdPerson: {
    name: 'Hold Person', schools: { cleric: 2, magicUser: 3 }, usable: 'combat', castTime: (L, s) => (s === 'magicUser' ? 3 : 5), range: (L, s) => (s === 'magicUser' ? 12 : 6), target: 'area',
    area: { shape: 'radius', size: 1 }, affects: 'person', hostile: true, mental: true,
    maxTargets: (L, s) => (s === 'magicUser' ? 4 : 3),
    duration: (L, s) => (s === 'magicUser' ? R(2 * L) : R(4 + L)),
    save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'condition', id: 'held' }],
    desc: 'Limbs lock rigid as the spell takes hold.', tip: 'Paralyzes up to 3 persons (4 for magic-users). Save vs spell negates; a lone target saves at -2 (-3 vs a magic-user), two at -1.',
  },
  resistFire: {
    name: 'Resist Fire', schools: { cleric: 2 }, usable: 'both', castTime: 5, range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L) => T(L),
    ops: [{ op: 'condition', id: 'resistFire' }],
    desc: 'Flame parts around the warded one.', tip: 'Touch: half damage from fire, +3 to saves vs fire.',
  },
  silence15: {
    name: "Silence 15' Radius", schools: { cleric: 2 }, usable: 'combat', castTime: 5, range: 12, target: 'area',
    area: { shape: 'radius', size: 1 }, hostile: true, duration: (L) => R(2 * L),
    save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'condition', id: 'silenced' }],
    desc: 'Sound dies. Lips move, but no words come.', tip: 'Creatures in the area cannot cast spells. Save vs spell negates.',
  },
  slowPoison: {
    name: 'Slow Poison', schools: { cleric: 2 }, usable: 'both', castTime: 1, range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L) => H(L),
    ops: [{ op: 'condition', id: 'slowPoison' }, { op: 'flag', flag: 'poisonSlowed' }],
    desc: 'The venom\'s march through the blood is stayed.', tip: 'Touch: a poisoned character does not die for 1 hour/level.',
  },
  snakeCharm: {
    name: 'Snake Charm', schools: { cleric: 2 }, usable: 'combat', castTime: 5, range: 3, target: 'area',
    area: { shape: 'radius', size: 1 }, affects: 'snake', hostile: true, duration: (L, s, rng) => R(4) + (rng ? rng.die(4) : 2),
    ops: [{ op: 'condition', id: 'charmedSnake', hdPool: 'casterHp' }],
    desc: 'Serpents sway, entranced by the chant.', tip: 'Snakes whose HP total no more than the cleric\'s are entranced.',
  },
  spiritualHammer: {
    name: 'Spiritual Hammer', schools: { cleric: 2 }, usable: 'combat', castTime: 5, range: (L) => Math.max(1, L), target: 'enemy',
    area: { shape: 'single' }, hostile: true, duration: (L) => R(L),
    ops: [{ op: 'hammer' }],
    desc: 'A hammer of pure force strikes at the cleric\'s command.', tip: 'Magical attack each round: 1d4+1 (1d4 vs large), +1 to hit and damage per 6 levels or fraction.',
  },
  chant: {
    name: 'Chant', schools: { cleric: 2 }, usable: 'combat', castTime: 10, range: 0, target: 'party',
    area: { shape: 'all' }, duration: (L) => R(Math.max(3, L)),
    ops: [{ op: 'condition', id: 'chant', side: 'allies' }, { op: 'condition', id: 'chantFoe', side: 'enemies' }],
    desc: 'The cleric\'s chant rises: allies surge, foes falter.', tip: 'Allies +1 to hit, damage and saves; enemies -1.',
  },

  // ============================================================ CLERIC 3
  cureBlindness: {
    name: 'Cure Blindness', schools: { cleric: 3 }, usable: 'both', castTime: 10, range: 1, target: 'ally',
    area: { shape: 'single' }, reverse: 'causeBlindness',
    ops: [{ op: 'remove', ids: ['blinded'] }],
    desc: 'Sight returns in a rush of light.', tip: 'Touch: cures blindness.',
  },
  causeBlindness: {
    name: 'Cause Blindness', schools: { cleric: 3 }, usable: 'combat', castTime: 10, range: 1, target: 'enemy',
    area: { shape: 'single' }, hostile: true, reverse: 'cureBlindness', save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'touch' }, { op: 'condition', id: 'blinded', rounds: Infinity }],
    desc: 'Darkness falls over the victim\'s eyes.', tip: 'Touch: blinds (-4 to hit, +4 AC). Save vs spell negates.',
  },
  cureDisease: {
    name: 'Cure Disease', schools: { cleric: 3 }, usable: 'both', castTime: 10, range: 1, target: 'ally',
    area: { shape: 'single' }, reverse: 'causeDisease',
    ops: [{ op: 'remove', ids: ['diseased'] }],
    desc: 'Fever breaks; the sickness is purged.', tip: 'Touch: cures disease.',
  },
  causeDisease: {
    name: 'Cause Disease', schools: { cleric: 3 }, usable: 'combat', castTime: 10, range: 1, target: 'enemy',
    area: { shape: 'single' }, hostile: true, reverse: 'cureDisease', save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'touch' }, { op: 'condition', id: 'diseased', rounds: Infinity }],
    desc: 'A sickly touch spreads rot.', tip: 'Touch: disease (-2 to hit, no natural healing). Save vs spell negates.',
  },
  dispelMagic: {
    name: 'Dispel Magic', schools: { cleric: 3, magicUser: 3 }, usable: 'both', castTime: (L, s) => (s === 'magicUser' ? 3 : 6), range: (L, s) => (s === 'magicUser' ? 12 : 6), target: 'area',
    area: { shape: 'radius', size: 1 },
    ops: [{ op: 'dispel' }],
    desc: 'Weaves of magic unravel.', tip: 'Ends magical effects in the area: 50%, +5% per level the caster is above the magic\'s caster, -2% per level below.',
  },
  prayer: {
    name: 'Prayer', schools: { cleric: 3 }, usable: 'combat', castTime: 6, range: 0, target: 'party',
    area: { shape: 'all' }, duration: (L) => R(L),
    ops: [{ op: 'condition', id: 'prayer', side: 'allies' }, { op: 'condition', id: 'prayerFoe', side: 'enemies' }],
    desc: 'A great prayer goes up; the gods take notice.', tip: 'Allies +1 to hit, damage and saves; enemies -1, 1 round/level.',
  },
  removeCurse: {
    name: 'Remove Curse', schools: { cleric: 3 }, usable: 'both', castTime: 6, range: 1, target: 'ally',
    area: { shape: 'single' }, reverse: 'bestowCurse',
    ops: [{ op: 'removeCurse' }],
    desc: 'The curse lifts like a weight from the shoulders.', tip: 'Touch: removes curses; cursed items may be discarded.',
  },
  bestowCurse: {
    name: 'Bestow Curse', schools: { cleric: 3 }, usable: 'combat', castTime: 6, range: 1, target: 'enemy',
    area: { shape: 'single' }, hostile: true, reverse: 'removeCurse', duration: (L) => T(L),
    save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'touch' }, { op: 'condition', id: 'bestowCurse' }],
    desc: 'Ill fortune clings to the accursed.', tip: 'Touch: -4 to hit and saves, 1 turn/level. Save vs spell negates.',
  },

  // ======================================== TEMPLE (cleric 4-5, not memorizable in PoR)
  cureSeriousWounds: {
    name: 'Cure Serious Wounds', schools: { cleric: 4 }, usable: 'both', castTime: 7, range: 1, target: 'ally', templeOnly: true,
    area: { shape: 'single' }, ops: [{ op: 'heal', dice: '2d8+1' }],
    desc: 'Deep wounds close.', tip: 'Heals 2d8+1 hit points.',
  },
  neutralizePoison: {
    name: 'Neutralize Poison', schools: { cleric: 4 }, usable: 'both', castTime: 7, range: 1, target: 'ally', templeOnly: true,
    area: { shape: 'single' }, ops: [{ op: 'remove', ids: ['poisoned', 'slowPoison'] }, { op: 'flag', flag: 'poisonCured' }],
    desc: 'The venom turns to water.', tip: 'Cures poison.',
  },
  cureCriticalWounds: {
    name: 'Cure Critical Wounds', schools: { cleric: 5 }, usable: 'both', castTime: 8, range: 1, target: 'ally', templeOnly: true,
    area: { shape: 'single' }, ops: [{ op: 'heal', dice: '3d8+3' }],
    desc: 'Even grievous harm is undone.', tip: 'Heals 3d8+3 hit points.',
  },
  raiseDead: {
    name: 'Raise Dead', schools: { cleric: 5 }, usable: 'camp', castTime: 60, range: 1, target: 'ally', templeOnly: true,
    area: { shape: 'single' }, affects: 'dead', ops: [{ op: 'flag', flag: 'raiseDead' }],
    desc: 'The soul is called back to its body.', tip: 'Returns the dead to life (resurrection survival roll; -1 CON).',
  },

  // ======================================================== MAGIC-USER 1
  burningHands: {
    name: 'Burning Hands', schools: { magicUser: 1 }, usable: 'combat', castTime: 1, range: 1, target: 'direction',
    area: { shape: 'cone', size: 3 }, hostile: true, element: 'fire',
    ops: [{ op: 'damage', dice: (L) => String(L), element: 'fire' }],
    desc: 'A fan of flame roars from outspread fingers.', tip: 'Cone: 1 hp of fire damage per level, no save.',
  },
  charmPerson: {
    name: 'Charm Person', schools: { magicUser: 1 }, usable: 'combat', castTime: 1, range: 12, target: 'enemy',
    area: { shape: 'single' }, affects: 'person', hostile: true, mental: true, duration: Infinity,
    save: { key: 'sp', type: 'neg' }, racialResist: true,
    ops: [{ op: 'charm' }],
    desc: 'The foe\'s eyes soften: you are its dearest friend.', tip: 'A person fights for you. Save vs spell negates.',
  },
  enlarge: {
    name: 'Enlarge', schools: { magicUser: 1 }, usable: 'both', castTime: 1, range: 1, target: 'creature',
    area: { shape: 'single' }, duration: (L) => T(L), reverse: 'reduce',
    ops: [{ op: 'enlarge' }],
    desc: 'The subject swells to giant stature.', tip: 'Strength rises with caster level (18/50 at 1st to 18/00 at 6th); 1 turn/level.',
  },
  reduce: {
    name: 'Reduce', schools: { magicUser: 1 }, usable: 'combat', castTime: 1, range: 1, target: 'enemy',
    area: { shape: 'single' }, hostile: true, duration: (L) => T(L), reverse: 'enlarge', save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'condition', id: 'reduced' }],
    desc: 'The subject dwindles.', tip: 'Shrinks a creature: -2 damage. Save vs spell negates.',
  },
  friends: {
    name: 'Friends', schools: { magicUser: 1 }, usable: 'camp', castTime: 1, range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L) => R(L),
    ops: [{ op: 'condition', id: 'friends', mods: (L, rng) => ({ cha: roll(rng, '2d4') }) }, { op: 'flag', flag: 'friends' }],
    desc: 'An aura of easy charm settles about the caster.', tip: '+2d4 charisma for 1 round/level (parleys, shops).',
  },
  magicMissile: {
    name: 'Magic Missile', schools: { magicUser: 1 }, usable: 'combat', castTime: 1, range: (L) => 6 + L, target: 'enemy',
    area: { shape: 'single' }, hostile: true,
    missiles: (L) => 1 + Math.floor((L - 1) / 2),
    ops: [{ op: 'damage', dice: (L) => { const n = 1 + Math.floor((L - 1) / 2); return `${n}d4+${n}`; }, immuneIf: 'magicMissile' }],
    desc: 'Darts of force streak unerringly to the mark.', tip: '1d4+1 per missile (1 + 1 per 2 levels above 1st); never misses.',
  },
  readMagic: {
    name: 'Read Magic', schools: { magicUser: 1 }, usable: 'camp', castTime: 1, range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L) => R(2 * L),
    ops: [{ op: 'flag', flag: 'readMagic' }],
    desc: 'Arcane script resolves into meaning.', tip: 'Read magic-user scrolls so they can be scribed.',
  },
  shield: {
    name: 'Shield', schools: { magicUser: 1 }, usable: 'both', castTime: 1, range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L) => R(5 * L),
    ops: [{ op: 'condition', id: 'shielded' }],
    desc: 'An invisible barrier hums before the caster.', tip: 'Self: AC 2 vs missiles, AC 4 vs melee, immune to magic missile.',
  },
  shockingGrasp: {
    name: 'Shocking Grasp', schools: { magicUser: 1 }, usable: 'combat', castTime: 1, range: 1, target: 'enemy',
    area: { shape: 'single' }, hostile: true, element: 'electricity',
    ops: [{ op: 'touch' }, { op: 'damage', dice: (L) => `1d8+${L}`, element: 'electricity' }],
    desc: 'Lightning crackles from the caster\'s palm.', tip: 'Touch attack: 1d8 +1 per level electrical damage.',
  },
  sleep: {
    name: 'Sleep', schools: { magicUser: 1 }, usable: 'combat', castTime: 1, range: (L) => 3 + L, target: 'area',
    area: { shape: 'radius', size: 1 }, hostile: true, duration: (L) => R(5 * L), racialResist: true,
    ops: [{ op: 'sleep' }],
    desc: 'A drowsy hush falls; weapons slip from nerveless hands.', tip: 'Sleeps 4d4 creatures of 1 HD or less, fewer of up to 4+4 HD. No save.',
  },

  // ======================================================== MAGIC-USER 2
  detectInvisibility: {
    name: 'Detect Invisibility', schools: { magicUser: 2 }, usable: 'both', castTime: 2, range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L) => R(5 * L),
    ops: [{ op: 'condition', id: 'detectInvisibility' }, { op: 'flag', flag: 'detectInvisibility' }],
    desc: 'The unseen stand revealed.', tip: 'See invisible creatures, 5 rounds/level.',
  },
  invisibility: {
    name: 'Invisibility', schools: { magicUser: 2 }, usable: 'both', castTime: 2, range: 1, target: 'ally',
    area: { shape: 'single' }, duration: Infinity,
    ops: [{ op: 'condition', id: 'invisible' }],
    desc: 'The subject fades from sight.', tip: 'Invisible until attacking: foes -4 to hit and cannot target with spells.',
  },
  knock: {
    name: 'Knock', schools: { magicUser: 2 }, usable: 'camp', castTime: 2, range: 6, target: 'none',
    area: { shape: 'single' },
    ops: [{ op: 'flag', flag: 'unlock' }],
    desc: 'Locks spring and bars slide aside.', tip: 'Opens a locked or stuck door.',
  },
  mirrorImage: {
    name: 'Mirror Image', schools: { magicUser: 2 }, usable: 'combat', castTime: 2, range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L) => R(3 * L),
    ops: [{ op: 'mirror' }],
    desc: 'The caster splits into shimmering doubles.', tip: '1d4 images for 3 rounds/level (1e PHB); each attack that hits has a chance to strike an image instead.',
  },
  rayOfEnfeeblement: {
    name: 'Ray of Enfeeblement', schools: { magicUser: 2 }, usable: 'combat', castTime: 2, range: (L) => 1 + Math.floor(L / 4), target: 'enemy',
    area: { shape: 'single' }, hostile: true, duration: (L) => R(L), save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'condition', id: 'enfeebled', mods: (L) => ({ strLossPct: 25 + 2 * Math.max(0, L - 3) }) }],
    desc: 'A sickly ray drains the strength from limbs.', tip: 'Strength (damage) cut by 25% +2%/level above 3rd. Save vs spell negates.',
  },
  stinkingCloud: {
    name: 'Stinking Cloud', schools: { magicUser: 2 }, usable: 'combat', castTime: 2, range: 3, target: 'area',
    area: { shape: 'square', size: 2 }, hostile: true, affects: 'living', save: { key: 'ppdm', type: 'neg', poison: true },
    ops: [{ op: 'condition', id: 'nauseous', rounds: (L, s, rng) => 1 + (rng ? rng.die(4) : 2) }],
    desc: 'A choking yellow fog rolls out.', tip: 'Creatures in a 2x2 area are helpless 1d4+1 rounds. Save vs poison negates.',
  },
  strength: {
    name: 'Strength', schools: { magicUser: 2 }, usable: 'both', castTime: 1, range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L) => H(L),
    ops: [{ op: 'strength' }],
    desc: 'Sinews tighten with borrowed might.', tip: '+1d8 STR for fighters, 1d6 clerics/thieves, 1d4 magic-users; 1 hour/level.',
  },

  // ======================================================== MAGIC-USER 3
  blink: {
    name: 'Blink', schools: { magicUser: 3 }, usable: 'combat', castTime: 1, range: 0, target: 'self',
    area: { shape: 'single' }, duration: (L) => R(L),
    ops: [{ op: 'condition', id: 'blinking' }],
    desc: 'The caster flickers in and out of the world.', tip: 'Half of all attacks against the caster miss; 1 round/level.',
  },
  fireball: {
    name: 'Fireball', schools: { magicUser: 3 }, usable: 'combat', castTime: 3, range: (L) => 10 + L, target: 'area',
    area: { shape: 'radius', size: 2 }, hostile: true, element: 'fire', dodge: true, save: { key: 'sp', type: 'half' },
    ops: [{ op: 'damage', dice: (L) => lvlDice(L, 6), element: 'fire' }],
    desc: 'A bead of flame blossoms into a roaring sphere.', tip: '1d6 per level fire damage in a 2-square radius. Save vs spell for half.',
  },
  haste: {
    name: 'Haste', schools: { magicUser: 3 }, usable: 'combat', castTime: 3, range: 6, target: 'party',
    area: { shape: 'radius', size: 2 }, affects: 'allies', maxTargets: (L) => L, duration: (L) => R(3 + L),
    ops: [{ op: 'haste' }],
    desc: 'The world slows; your companions move like the wind.', tip: 'Up to 1 ally/level: double moves and attacks, 3+1/level rounds. Ages 1 year.',
  },
  invisibility10: {
    name: "Invisibility 10' Radius", schools: { magicUser: 3 }, usable: 'both', castTime: 3, range: 0, target: 'party',
    area: { shape: 'radius', size: 1 }, affects: 'allies', duration: Infinity,
    ops: [{ op: 'condition', id: 'invisible' }],
    desc: 'The whole company fades from view.', tip: 'Allies within 1 square turn invisible until they attack.',
  },
  lightningBolt: {
    name: 'Lightning Bolt', schools: { magicUser: 3 }, usable: 'combat', castTime: 3, range: (L) => 4 + L, target: 'direction',
    area: { shape: 'line', size: 8 }, hostile: true, element: 'electricity', dodge: true, save: { key: 'sp', type: 'half' },
    ops: [{ op: 'damage', dice: (L) => lvlDice(L, 6), element: 'electricity' }],
    desc: 'A blinding stroke of lightning splits the air.', tip: '1d6 per level electrical damage along a line. Save vs spell for half.',
  },
  protEvil10: {
    name: "Prot. from Evil 10' Radius", schools: { magicUser: 3 }, usable: 'both', castTime: 3, range: 0, target: 'party',
    area: { shape: 'radius', size: 1 }, affects: 'allies', duration: (L) => R(2 * L),
    ops: [{ op: 'condition', id: 'protEvil' }],
    desc: 'A silver circle wards the company.', tip: 'Allies within 1 square: -2 AC and +2 saves vs evil.',
  },
  protGood10: {
    name: "Prot. from Good 10' Radius", schools: { magicUser: 3 }, usable: 'both', castTime: 3, range: 0, target: 'party',
    area: { shape: 'radius', size: 1 }, affects: 'allies', duration: (L) => R(2 * L),
    ops: [{ op: 'condition', id: 'protGood' }],
    desc: 'A dark circle wards the company.', tip: 'Allies within 1 square: -2 AC and +2 saves vs good.',
  },
  protNormalMissiles: {
    name: 'Prot. from Normal Missiles', schools: { magicUser: 3 }, usable: 'both', castTime: 3, range: 1, target: 'ally',
    area: { shape: 'single' }, duration: (L) => T(L),
    ops: [{ op: 'condition', id: 'protNormalMissiles' }],
    desc: 'Arrows veer aside as if striking glass.', tip: 'Touch: immune to non-magical missiles, 1 turn/level.',
  },
  slow: {
    name: 'Slow', schools: { magicUser: 3 }, usable: 'combat', castTime: 3, range: (L) => 9 + L, target: 'area',
    area: { shape: 'radius', size: 2 }, affects: 'enemies', hostile: true, maxTargets: (L) => L, duration: (L) => R(3 + L),
    save: { key: 'sp', type: 'neg' },
    ops: [{ op: 'condition', id: 'slowed' }],
    desc: 'Foes wade as through deep water.', tip: 'Up to 1 enemy/level: half moves and attacks. Save vs spell negates.',
  },

  // ===================================== ITEM-ONLY (released by magic items, never memorized)
  wandParalyzation: {
    name: 'Paralyzation', schools: { magicUser: 3 }, usable: 'combat', castTime: 1, range: 1, target: 'direction', itemOnly: true,
    area: { shape: 'cone', size: 6 }, hostile: true, duration: (L, s, rng) => (rng ? roll(rng, '5d4') : 12),
    save: { key: 'rsw', type: 'neg' },
    ops: [{ op: 'condition', id: 'paralyzed' }],
    desc: 'A pale ray fans out; limbs lock rigid.', tip: 'Wand: a 6-square cone; any creature saves vs wand or is paralyzed 5d4 rounds.',
  },
};

for (const [id, s] of Object.entries(SPELL_RULES)) {
  s.id = id;
  s.level = Math.min(...Object.values(s.schools));
  s.school = Object.keys(s.schools)[0];
}

export const SPELL_IDS = Object.keys(SPELL_RULES);

/** Spells a Pool of Radiance caster can memorize (not temple-only or item-only), by class and level. */
export function spellsForClass(classId, level) {
  return SPELL_IDS.filter((id) => SPELL_RULES[id].schools[classId] === level && !SPELL_RULES[id].templeOnly && !SPELL_RULES[id].itemOnly);
}

/**
 * Merged spell definition: rules mechanics + display data (desc, icon...) from
 * data/spells.js when present.
 */
export function getSpell(id) {
  const r = SPELL_RULES[id];
  const d = DATA_SPELLS[id];
  if (!r && !d) return null;
  return { ...(d ?? {}), ...(r ?? {}), desc: d?.desc ?? r?.desc, flavor: r?.desc, tip: r?.tip ?? d?.desc };
}

/** Level of a spell for a casting class (holdPerson: cleric 2, magic-user 3). */
export function spellLevel(id, classId) {
  const s = SPELL_RULES[id];
  if (!s) return DATA_SPELLS[id]?.level ?? 1;
  return s.schools[classId] ?? s.level;
}

const val = (v, L, school, rng) => (typeof v === 'function' ? v(L, school, rng) : v);

/**
 * Which class casts this spell for a caster. Multiclass casters keep separate
 * memories, so the class comes from the memorized slot: pass `cls` when the
 * caller knows it (a {id, cls} slot); otherwise the first class — in
 * `ch.spells.memorized` order, the same order consumeMemorized() spends —
 * that has the spell memorized; otherwise the first active class whose list
 * holds it. A half-elf C/MU with Hold Person memorized only as a magic-user
 * casts the magic-user version (range 12, up to 4 persons, -3 alone).
 */
export function castingClass(caster, id, cls) {
  const s = SPELL_RULES[id];
  const ch = characterOf(caster);
  if (!s) return DATA_SPELLS[id]?.school ?? 'magicUser';
  if (cls && s.schools[cls] !== undefined) return cls;
  if (ch) {
    const active = activeClasses(ch).filter((c) => s.schools[c] !== undefined);
    const mem = ch.spells?.memorized ?? {};
    const held = Object.keys(mem).find((c) => active.includes(c) && Array.isArray(mem[c]) && mem[c].includes(id));
    if (held) return held;
    if (active.length) return active[0];
  }
  return Object.keys(s.schools)[0];
}

/** Caster level for a spell (in the casting class, see castingClass). Monsters use `casterLevel` or HD. */
export function casterLevel(caster, id, cls) {
  const ch = characterOf(caster);
  cls = castingClass(caster, id, cls);
  if (ch) return ch.levels?.[cls] ?? highestLevel(ch);
  const m = monsterOf(caster);
  return caster.casterLevel ?? m?.casterLevel ?? Math.max(1, Math.floor(m?.hd ?? 1));
}

/**
 * Targeting metadata for a spell at a caster level (for combat targeting UI).
 * @returns {{target:string, range:number, shape:string, size:number, maxTargets:number, hostile:boolean,
 *   affects:string, duration:number, castTime:number}}
 */
export function spellTargeting(id, level = 1, school) {
  const s = SPELL_RULES[id];
  const sc = school ?? s.school;
  return {
    target: s.target,
    range: val(s.range, level, sc),
    shape: s.area?.shape ?? 'single',
    size: val(s.area?.size ?? 1, level, sc),
    maxTargets: val(s.maxTargets ?? Infinity, level, sc),
    hostile: !!s.hostile,
    affects: s.affects ?? 'any',
    duration: val(s.duration ?? 0, level, sc),
    castTime: val(s.castTime ?? 1, level, sc),
  };
}

/**
 * 1e casting time in segments (1 round = 10 segments, matching the d10
 * initiative span) for a spell at a caster level and class: Magic Missile 1,
 * Fireball 3, Cure Light Wounds 5, Bless 10 (a full round: it goes off at the
 * end of the round). Hold Person and Dispel Magic differ by class. Items
 * (wands, scrolls read in battle...) release their magic at once: pass
 * `{fromItem:true}` for 0.
 * @param {{fromItem?:boolean}} [o]
 */
export function castingDelay(id, cls, L = 1, o = {}) {
  if (o.fromItem) return 0;
  const s = SPELL_RULES[id];
  if (!s) return 0;
  const seg = val(s.castTime ?? 1, L, cls ?? s.school);
  return Math.max(0, Math.min(10, Math.round(seg)));
}

/**
 * Why a character cannot cast a spell right now, or null.
 * Checks the spell is memorized (unless opts.ignoreMemory), conditions
 * (silence, held, asleep...), and armour for arcane magic.
 */
export function castProblem(caster, id, opts = {}) {
  const s = SPELL_RULES[id];
  if (!s) return 'unknown spell';
  const ch = characterOf(caster);
  if (!conditionsAllowCasting(effectHost(caster))) return 'cannot cast now';
  if (ch) {
    if (!isAliveCreature(ch) || ch.status !== 'ok') return 'not conscious';
    if (!activeClasses(ch).some((c) => s.schools[c] !== undefined)) return 'not a spell of this class';
    const cls = castingClass(ch, id, opts.cls);
    if (cls === 'magicUser' && !armorAllowsArcane(ch)) return 'armor prevents arcane casting';
    if (!opts.ignoreMemory && !isMemorized(ch, id, opts.cls)) return 'not memorized';
    if (opts.context === 'camp' && s.usable === 'combat') return 'only in combat';
    if (opts.context === 'combat' && s.usable === 'camp') return 'not in combat';
  }
  return null;
}

/** True if the character currently has the spell memorized (in class `cls`, or in any class). */
export function isMemorized(ch, id, cls) {
  const mem = ch.spells?.memorized ?? {};
  if (cls) return Array.isArray(mem[cls]) && mem[cls].includes(id);
  return Object.values(mem).some((ids) => Array.isArray(ids) && ids.includes(id));
}

/**
 * Remove one memorized instance (the spell is forgotten when cast) from the
 * class it is cast as: `cls` when given, else castingClass() — so the slot
 * spent is always the one whose version of the spell takes effect.
 */
export function consumeMemorized(ch, id, cls) {
  const mem = ch.spells?.memorized ?? {};
  const from = cls ?? castingClass(ch, id);
  const order = [from, ...Object.keys(mem).filter((k) => k !== from && !cls)];
  for (const k of order) {
    const ids = mem[k];
    if (!Array.isArray(ids)) continue;
    const i = ids.indexOf(id);
    if (i >= 0) {
      ids.splice(i, 1);
      return true;
    }
  }
  return false;
}

// -------------------------------------------------------------- resolution

/**
 * @typedef {Object} TargetResult
 * @property {object} target
 * @property {string} name
 * @property {boolean} affected     the spell took effect on this creature
 * @property {boolean} [saved]
 * @property {{roll:number,target:number,bonus:number}} [save]
 * @property {boolean} [resisted]   racial/magic resistance
 * @property {boolean} [immune]
 * @property {boolean} [missed]     touch attack missed
 * @property {number} [damage]
 * @property {number} [healed]
 * @property {string[]} applied     condition ids added
 * @property {string[]} removed     condition ids removed
 * @property {boolean} [down]       went down from this spell
 * @property {boolean} [charmed]
 *
 * @typedef {Object} CastResult
 * @property {boolean} ok
 * @property {string} [reason]
 * @property {string} spellId
 * @property {string} school
 * @property {number} level        caster level
 * @property {TargetResult[]} results
 * @property {Record<string, any>} flags   utility outcomes (detectMagic, unlock, readMagic, raiseDead...)
 * @property {string[]} log        terse Gold Box style lines
 */

function touches(rng, caster, target) {
  const { thac0, hitBonus } = attackOf(caster);
  const needed = neededToHit(thac0, acOf(target), hitBonus);
  const r = rng.die(20);
  return r !== 1 && (r === 20 || r >= needed);
}

function affectsTarget(s, caster, t) {
  const tags = tagsOf(t);
  switch (s.affects) {
    case 'person': return tags.includes('person');
    case 'living': return !tags.includes('undead');
    case 'undead': return tags.includes('undead');
    case 'snake': return tags.includes('snake');
    case 'dead': return characterOf(t)?.status === 'dead';
    case 'allies': return sideOf(t) === sideOf(caster);
    case 'enemies': return sideOf(t) !== sideOf(caster);
    default: return true;
  }
}

/** Mind-affecting spells do not work on the undead and mindless. */
function mindImmune(s, t) {
  const mental = s.mental || ['sleep', 'charmPerson', 'holdPerson', 'snakeCharm'].includes(s.id);
  return mental && (isUndead(t) || hasTag(t, 'mindless'));
}

/** Elves 90% and half-elves 30% resist sleep and charm. */
function racialResists(rng, s, t) {
  if (!s.racialResist) return false;
  const ch = characterOf(t);
  const race = ch ? RACES[ch.race] : null;
  const pct = race?.resistSleepCharm ?? monsterOf(t)?.resistSleepCharm ?? 0;
  return pct > 0 && rng.int(1, 100) <= pct;
}

/**
 * Magic resistance % of a creature: a numeric `magicResistance` field or the
 * `magicResist:N` tag (Tyranthraxus 20%). DMG: the listed figure is against
 * an 11th-level caster; it rises 5% per level the caster is below 11th and
 * falls 5% per level above.
 */
export function magicResistanceOf(t, casterLvl = 11) {
  const m = monsterOf(t);
  if (!m) return 0;
  let base = m.magicResistance ?? 0;
  if (!base) {
    const tag = (m.special ?? []).find?.((x) => String(x).startsWith('magicResist:'));
    if (tag) base = Number(String(tag).split(':')[1]) || 0;
  }
  if (!base) return 0;
  return Math.max(0, Math.min(100, base + 5 * (11 - casterLvl)));
}

function magicResists(rng, t, casterLvl) {
  const mr = magicResistanceOf(t, casterLvl);
  return mr > 0 && rng.int(1, 100) <= mr;
}

function applyElement(host, dmg, element) {
  if (!element) return dmg;
  const mult = effectMods(host).resist[element] ?? 1;
  const res = monsterOf(host)?.resist?.[element];
  return Math.floor(dmg * mult * (res ?? 1));
}

/**
 * PHB Sleep table, on hitDiceOf() values (a "+" counts as half a die):
 * up to 1 HD → 4d4 creatures; 1+1 to 2 → 2d4; 2+1 to 3 → 1d4;
 * 3+1 to 4 → 1-2 (1d2); 4+1 to 4+4 → 0-1 (1d2-1). Above 4+4: immune.
 */
export const SLEEP_BANDS = [
  { max: 1, dice: '4d4', label: 'up to 1 HD' },
  { max: 2, dice: '2d4', label: '1+1 to 2 HD' },
  { max: 3, dice: '1d4', label: '2+1 to 3 HD' },
  { max: 4, dice: '1d2', label: '3+1 to 4 HD' },
  { max: 4.5, dice: '1d2-1', label: '4+1 to 4+4 HD' },
];

/**
 * Cast a spell. The caller chooses the targets (in priority order: the primary
 * target or nearest first) according to spellTargeting(); the engine filters
 * those the spell cannot affect, applies maxTargets, saves and effects.
 *
 * @param {import('./dice.js').Rng} rng
 * @param {string} id
 * @param {object} caster  Character, Combatant or monster
 * @param {object[]} [targets]
 * `opts.cls` (alias `school`) is the casting class of the memorized slot
 * ({id, cls}); without it castingClass() decides. `opts.saveKey` overrides
 * the spell's save category — item-released magic from wands, staves and
 * rods saves vs Rod/Staff/Wand ('rsw', DMG); scrolls and potions keep the
 * spell's own.
 * @param {{level?:number, cls?:string, school?:string, consume?:boolean, check?:boolean, context?:'combat'|'camp',
 *   fromItem?:boolean, saveKey?:string, noFailure?:boolean, ignoreMemory?:boolean}} [opts]
 * @returns {CastResult}
 */
export function castSpell(rng, id, caster, targets = [], opts = {}) {
  const s = SPELL_RULES[id];
  const res = { ok: false, spellId: id, school: s?.school ?? 'magicUser', level: 1, results: [], flags: {}, log: [] };
  if (!s) {
    res.reason = 'unknown spell';
    return res;
  }
  const ch = characterOf(caster);
  if (opts.check !== false && !opts.fromItem) {
    // Memory is always checked unless the caller says otherwise explicitly
    // (scripted casts, or a combat engine that already spent the slot).
    const p = castProblem(caster, id, { ignoreMemory: !!opts.ignoreMemory, context: opts.context, cls: opts.cls ?? opts.school });
    if (p) {
      res.reason = p;
      return res;
    }
  }
  const school = castingClass(caster, id, opts.cls ?? opts.school);
  const L = opts.level ?? casterLevel(caster, id, school);
  res.school = school;
  res.level = L;
  res.ok = true;
  if (opts.consume && ch) consumeMemorized(ch, id, school);
  const cname = nameOf(caster);
  // PHB: clerics of low wisdom risk spell failure (the spell is lost).
  if (ch && school === 'cleric' && !opts.fromItem && !opts.noFailure) {
    const pct = wisdomSpellFailure(effectiveAbilities(ch).wis);
    if (pct > 0 && rng.int(1, 100) <= pct) {
      res.ok = false;
      res.failed = true;
      res.reason = 'spell failed';
      res.log.push(`${cname} prays for ${s.name}, but the god is silent.`);
      return res;
    }
  }
  res.log.push(opts.fromItem ? `${s.name} is released.` : `${cname} casts ${s.name}.`);

  // Self-targeted spells ignore the target list.
  let list = s.target === 'self' ? [caster] : targets.length ? [...targets] : ['ally', 'creature', 'party'].includes(s.target) ? [caster] : [];
  list = list.filter((t) => t && (s.affects === 'dead' || isAliveCreature(t)));
  for (const t of list.filter((x) => !affectsTarget(s, caster, x))) {
    if (s.affects === 'allies' || s.affects === 'enemies') continue;
    res.results.push({ target: t, name: nameOf(t), affected: false, immune: true, applied: [], removed: [] });
    res.log.push(`${nameOf(t)} is unaffected.`);
  }
  list = list.filter((t) => affectsTarget(s, caster, t));
  const maxT = val(s.maxTargets ?? Infinity, L, school);
  if (list.length > maxT) list = list.slice(0, maxT);
  const duration = val(s.duration ?? 0, L, school, rng);

  // Sleep chooses victims from the weakest up, spending a per-band pool.
  if (s.ops[0]?.op === 'sleep') return resolveSleep(rng, s, caster, list, L, duration, res);

  // Hold person: fewer targets → harsher save.
  // PHB: cleric one target -2, two -1; magic-user one target -3, two -1.
  const holdPenalty = s.id === 'holdPerson' ? (list.length === 1 ? (school === 'magicUser' ? -3 : -2) : list.length === 2 ? -1 : 0) : 0;
  // Snake charm spends the caster's current hp as a pool of snake hp.
  let hpPool = s.id === 'snakeCharm' ? (ch ? ch.hp.cur : caster.hp?.cur ?? 10) : Infinity;

  for (const t of list) {
    const tr = { target: t, name: nameOf(t), affected: false, applied: [], removed: [] };
    res.results.push(tr);
    const host = effectHost(t);
    // Harmful magic allows saves/resistance for anyone caught in it (friend or foe).
    const hostile = !!s.hostile;
    if (hostile && hasEffect(host, 'invisible') && s.area?.shape === 'single' && s.target === 'enemy') {
      tr.immune = true;
      res.log.push(`${tr.name} cannot be seen!`);
      continue;
    }
    if (hostile && mindImmune(s, t)) {
      tr.immune = true;
      res.log.push(`${tr.name} is unaffected.`);
      continue;
    }
    if (hostile && magicResists(rng, t, L)) {
      tr.resisted = true;
      res.log.push(`${tr.name} resists the magic!`);
      continue;
    }
    if (hostile && racialResists(rng, s, t)) {
      tr.resisted = true;
      res.log.push(`${tr.name} resists!`);
      continue;
    }
    if (s.id === 'snakeCharm') {
      const hp = t.hp?.cur ?? 1;
      if (hp > hpPool) continue;
      hpPool -= hp;
    }
    let saved = false;
    if (s.save && hostile) {
      const sv = rollSave(rng, t, opts.saveKey ?? s.save.key, { bonus: holdPenalty, mental: s.mental, dodge: s.dodge, poison: !!s.save.poison && !opts.saveKey, element: s.element, source: caster });
      tr.save = { roll: sv.roll, target: sv.target, bonus: sv.bonus };
      tr.saved = saved = sv.saved;
      if (saved && s.save.type === 'neg') {
        res.log.push(`${tr.name} saves!`);
        continue;
      }
    }
    for (const op of s.ops) {
      if (op.side === 'allies' && sideOf(t) !== sideOf(caster)) continue;
      if (op.side === 'enemies' && sideOf(t) === sideOf(caster)) continue;
      const stop = applyOp(rng, op, { s, caster, t, host, tr, L, school, duration, saved, res });
      if (stop) break;
    }
  }
  // Self/party spells with ops that only set flags (detect magic...)
  if (!list.length && s.ops.every((o) => o.op === 'flag')) for (const o of s.ops) res.flags[o.flag] = true;
  return res;
}

function applyOp(rng, op, ctx) {
  const { s, caster, t, host, tr, L, school, duration, saved, res } = ctx;
  switch (op.op) {
    case 'touch': {
      if (sideOf(t) === sideOf(caster)) return false;
      if (!touches(rng, caster, t)) {
        tr.missed = true;
        res.log.push(`${nameOf(caster)} misses ${tr.name}.`);
        return true;
      }
      return false;
    }
    case 'damage': {
      if (op.immuneIf && effectMods(host).immune.has(op.immuneIf)) {
        tr.immune = true;
        res.log.push(`The spell spends itself against ${tr.name}'s shield.`);
        return true;
      }
      let dmg = roll(rng, val(op.dice, L, school));
      if (saved && s.save?.type === 'half') dmg = Math.floor(dmg / 2);
      dmg = Math.max(0, applyElement(host, dmg, op.element));
      const wasDown = isDownCreature(t);
      tr.damage = (tr.damage ?? 0) + dmg;
      tr.affected = true;
      const down = damageCreature(t, dmg);
      tr.down = down && !wasDown;
      res.log.push(`${tr.name} takes ${dmg} damage${saved ? ' (saved)' : ''}.${tr.down ? ` ${tr.name} ${characterOf(t) ? 'is down' : 'is slain'}!` : ''}`);
      return false;
    }
    case 'heal': {
      const n = roll(rng, val(op.dice, L, school));
      if (isUndead(t)) {
        tr.immune = true; // the undead are not mended by holy healing
        return true;
      }
      const healed = healCreature(t, n);
      tr.healed = (tr.healed ?? 0) + healed;
      tr.affected = true;
      res.log.push(healed ? `${tr.name} is healed ${healed} hit points.` : `${tr.name} is already whole.`);
      return false;
    }
    case 'condition': {
      if (op.id === 'slowed' && removeEffect(host, 'hasted')) {
        // 1e: slow cast on a hasted creature cancels the haste.
        tr.removed.push('hasted');
        tr.affected = true;
        res.log.push(`${tr.name} moves at normal speed again.`);
        return false;
      }
      const rounds = op.rounds !== undefined ? val(op.rounds, L, school, rng) : duration || Infinity;
      const mods = op.mods ? op.mods(L, rng) : undefined;
      addEffect(host, op.id, { rounds, source: s.id, casterId: caster.id, level: L, mods, persist: persistsOf(s) });
      tr.applied.push(op.id);
      tr.affected = true;
      res.log.push(conditionLine(tr.name, op.id));
      return false;
    }
    case 'remove': {
      for (const id of op.ids) if (removeEffect(host, id)) tr.removed.push(id);
      tr.affected = true;
      res.log.push(tr.removed.length ? `${tr.name} is cured.` : `Nothing ails ${tr.name}.`);
      return false;
    }
    case 'dispel': {
      const removed = clearEffects(host, (e, def) => {
        if (!def.magical) return false;
        return rng.int(1, 100) <= dispelChance(L, e.level ?? L);
      });
      tr.removed.push(...removed);
      tr.affected = removed.length > 0;
      if (removed.length) res.log.push(`The magic about ${tr.name} unravels.`);
      return false;
    }
    case 'hammer': {
      // PHB: +1 per 6 levels or fraction thereof (1st-6th +1, 7th-12th +2).
      const magic = Math.max(1, Math.ceil(L / 6));
      addEffect(effectHost(caster), 'spiritualHammer', { rounds: duration, source: s.id, level: L, data: { magic, damage: '1d4+1', damageLarge: '1d4', targetId: t.id } });
      const h = hammerStrike(rng, caster, t, magic);
      res.log.push(h.text);
      if (!h.hit) {
        tr.missed = true;
        return true;
      }
      tr.damage = h.damage;
      tr.affected = true;
      tr.down = h.down;
      return false;
    }
    case 'flag': {
      res.flags[op.flag] = true;
      tr.affected = true;
      return false;
    }
    case 'strength': {
      const tch = characterOf(t);
      let die = 4;
      if (tch) {
        const cls = splitClasses(tch.classSpec);
        die = cls.includes('fighter') ? 8 : cls.includes('cleric') || cls.includes('thief') ? 6 : 4;
      } else die = 6;
      const bonus = rng.die(die);
      addEffect(host, 'strength', { rounds: duration, source: s.id, level: L, persist: true, mods: tch ? { strBonus: bonus } : { dmg: 1 }, data: { bonus } });
      tr.applied.push('strength');
      tr.affected = true;
      res.log.push(`${tr.name} grows stronger.`);
      return false;
    }
    case 'enlarge': {
      const tch = characterOf(t);
      const pct = L <= 1 ? 50 : L <= 3 ? 75 : L <= 5 ? 90 : 100;
      const mods = tch ? { dmg: 0, strSet: { str: 18, strPct: pct } } : { dmg: 1 + Math.floor(L / 2) };
      addEffect(host, 'enlarged', { rounds: duration, source: s.id, level: L, mods, persist: true });
      tr.applied.push('enlarged');
      tr.affected = true;
      res.log.push(`${tr.name} swells to giant size.`);
      return false;
    }
    case 'mirror': {
      const images = rng.die(4);
      addEffect(host, 'mirrorImage', { rounds: duration, source: s.id, level: L, data: { images } });
      tr.applied.push('mirrorImage');
      tr.affected = true;
      res.log.push(`${images} image${images > 1 ? 's' : ''} of ${tr.name} appear${images > 1 ? '' : 's'}.`);
      return false;
    }
    case 'haste': {
      const tch = characterOf(t);
      if (tch) tch.age = (tch.age ?? 20) + 1;
      // 1e: haste and slow cancel — a slowed creature returns to normal speed.
      if (removeEffect(host, 'slowed')) {
        tr.removed.push('slowed');
        tr.affected = true;
        res.log.push(`${tr.name} moves at normal speed again.`);
        return false;
      }
      addEffect(host, 'hasted', { rounds: duration, source: s.id, level: L });
      tr.applied.push('hasted');
      tr.affected = true;
      res.log.push(`${tr.name} is hasted.`);
      return false;
    }
    case 'charm': {
      addEffect(host, 'charmed', { rounds: duration, source: s.id, casterId: caster.id, level: L, data: { side: sideOf(caster) } });
      tr.applied.push('charmed');
      tr.charmed = true;
      tr.affected = true;
      res.log.push(`${tr.name} is charmed.`);
      return false;
    }
    case 'removeCurse': {
      for (const id of ['bestowCurse', 'cursed']) if (removeEffect(host, id)) tr.removed.push(id);
      const tch = characterOf(t);
      let items = 0;
      for (const e of tch?.inventory ?? []) if (e.cursed) { e.cursed = false; items++; }
      tr.affected = true;
      res.flags.uncursedItems = (res.flags.uncursedItems ?? 0) + items;
      res.log.push(tr.removed.length || items ? `The curse upon ${tr.name} is lifted.` : `${tr.name} bears no curse.`);
      return false;
    }
    default:
      return false;
  }
}

/**
 * One blow of a Spiritual Hammer (the cast, and each later round the cleric
 * directs it): to-hit as the cleric with the hammer's +1 per 6 levels, 1d4+1
 * (1d4 vs large) + that bonus. Returns {hit, damage, down, roll, needed, text}.
 */
export function hammerStrike(rng, caster, t, magic = 1) {
  const { thac0 } = attackOf(caster);
  const needed = neededToHit(thac0, acOf(t), magic);
  const r = rng.die(20);
  const name = nameOf(t);
  if (r === 1 || (r !== 20 && r < needed)) return { hit: false, damage: 0, down: false, roll: r, needed, text: `The hammer misses ${name}.` };
  const damage = roll(rng, sizeLarge(t) ? '1d4' : '1d4+1') + magic;
  const wasDown = isDownCreature(t);
  const down = damageCreature(t, damage) && !wasDown;
  return { hit: true, damage, down, roll: r, needed, text: `The hammer strikes ${name} for ${damage}.${down ? ` ${name} is slain!` : ''}` };
}

/**
 * DMG dispel magic: 50% base, +5% per level the dispeller is above the
 * caster of the magic, -2% per level below (clamped 1..99).
 */
export function dispelChance(dispellerLevel, casterLevelOfMagic) {
  const d = dispellerLevel - casterLevelOfMagic;
  return Math.max(1, Math.min(99, 50 + (d > 0 ? 5 * d : 2 * d)));
}

function sizeLarge(t) {
  return (t.size ?? monsterOf(t)?.size) === 'L';
}

/**
 * 1e Sleep. Each band of the PHB table says how many creatures *of that
 * band* one casting puts to sleep (4d4 / 2d4 / 1d4 / 1-2 / 0-1). Against a
 * mixed group the spell's capacity is shared: a band's number is rolled the
 * first time a creature of that band is reached (weakest first), and each
 * sleeper uses 1/N of the whole spell, N being its band's roll. A group of
 * one kind therefore gets exactly the PHB number (two bugbears, 3+1 HD: 1d2
 * asleep), and goblins slept first leave less for the hobgoblins behind
 * them. Undead, mindless creatures and anything over 4+4 HD are unaffected.
 * SLEEP_COST is the old fixed cost in 1-HD creatures, kept for UI estimates.
 */
export const SLEEP_COST = [1, 2, 4, 8, 16];

function resolveSleep(rng, s, caster, list, L, duration, res) {
  const sorted = [...list].sort((a, b) => hitDiceOf(a) - hitDiceOf(b));
  const counts = []; // band → creatures of that band this casting can sleep
  let used = 0; // fraction of the spell's capacity spent
  const EPS = 1e-9;
  for (const t of sorted) {
    const tr = { target: t, name: nameOf(t), affected: false, applied: [], removed: [] };
    res.results.push(tr);
    const hd = hitDiceOf(t);
    const band = SLEEP_BANDS.findIndex((b) => hd <= b.max);
    if (band < 0 || isUndead(t) || hasTag(t, 'mindless') || hasTag(t, 'noSleep')) {
      tr.immune = true;
      res.log.push(`${tr.name} is unaffected.`);
      continue;
    }
    if (counts[band] === undefined) {
      counts[band] = Math.max(0, roll(rng, SLEEP_BANDS[band].dice));
      if (band === 0) res.sleepBudget = counts[0];
    }
    const n = counts[band];
    if (n <= 0 || used + 1 / n > 1 + EPS) continue;
    used += 1 / n;
    if (magicResists(rng, t, L) || racialResists(rng, s, t)) {
      tr.resisted = true;
      res.log.push(`${tr.name} resists!`);
      continue;
    }
    addEffect(effectHost(t), 'asleep', { rounds: duration, source: s.id, casterId: caster.id, level: L });
    tr.applied.push('asleep');
    tr.affected = true;
    res.log.push(`${tr.name} falls asleep.`);
  }
  res.sleepCounts = counts.map((n, b) => (n === undefined ? null : { band: SLEEP_BANDS[b].label, n }));
  res.sleepUsed = used;
  return res;
}

const CONDITION_LINES = {
  blessed: 'is blessed', cursed: 'is cursed', held: 'is held fast', silenced: 'is silenced', slowed: 'is slowed',
  nauseous: 'is overcome by the stench', blinded: 'is struck blind', diseased: 'is diseased', asleep: 'falls asleep',
  prayer: 'is uplifted', prayerFoe: 'falters', chant: 'is uplifted', chantFoe: 'falters', shielded: 'is shielded',
  invisible: 'vanishes', enfeebled: 'is enfeebled', reduced: 'shrinks', protEvil: 'is warded from evil',
  protGood: 'is warded from good', resistCold: 'is warded from cold', resistFire: 'is warded from fire',
  blinking: 'begins to blink', protNormalMissiles: 'is warded from missiles', bestowCurse: 'is accursed',
  charmedSnake: 'is entranced', slowPoison: 'feels the poison slow', paralyzed: 'is paralyzed', afraid: 'flees in terror',
};

export function conditionLine(name, id) {
  return `${name} ${CONDITION_LINES[id] ?? `is affected (${CONDITIONS[id]?.name ?? id})`}.`;
}
