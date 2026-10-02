/** Seed spell list (PoR spell levels 1-3). See schema.js SpellDef. */
const S = (id, name, school, level, o) => ({ id, name, school, level, usable: 'combat', range: 'touch', duration: 'instant', save: 'none', effect: id, ...o });

export const SPELLS = {
  // Cleric 1
  bless: S('bless', 'Bless', 'cleric', 1, { usable: 'both', range: '6 squares', area: 'party', duration: '6 rounds', desc: '+1 to hit for allies.' }),
  curse: S('curse', 'Curse', 'cleric', 1, { range: '6 squares', area: '5x5', duration: '6 rounds', desc: '-1 to hit for enemies.' }),
  cureLightWounds: S('cureLightWounds', 'Cure Light Wounds', 'cleric', 1, { usable: 'both', desc: 'Heals 1d8 hit points.' }),
  causeLightWounds: S('causeLightWounds', 'Cause Light Wounds', 'cleric', 1, { desc: 'Touch deals 1d8 damage.' }),
  detectMagic: S('detectMagic', 'Detect Magic', 'cleric', 1, { usable: 'camp', range: 'self', desc: 'Reveals magical items.' }),
  protectionFromEvil: S('protectionFromEvil', 'Protection from Evil', 'cleric', 1, { usable: 'both', duration: '3 rounds/level', desc: '+2 AC and saves vs evil.' }),
  resistCold: S('resistCold', 'Resist Cold', 'cleric', 1, { usable: 'both', desc: 'Half damage from cold.' }),
  // Cleric 2
  findTraps: S('findTraps', 'Find Traps', 'cleric', 2, { usable: 'camp', range: 'self', desc: 'Reveals traps.' }),
  holdPerson: S('holdPerson', 'Hold Person', 'cleric', 2, { range: '6 squares', save: 'neg:sp', desc: 'Paralyzes up to 3 humanoids.' }),
  silence15: S('silence15', "Silence 15' Radius", 'cleric', 2, { range: '12 squares', desc: 'Prevents spellcasting in an area.' }),
  // Cleric 3
  dispelMagic: S('dispelMagic', 'Dispel Magic', 'cleric', 3, { desc: 'Ends magical effects.' }),
  prayer: S('prayer', 'Prayer', 'cleric', 3, { area: 'all', desc: '+1 allies / -1 enemies.' }),
  // Magic-User 1
  burningHands: S('burningHands', 'Burning Hands', 'magicUser', 1, { range: '1 square', area: 'adjacent', desc: '1 hp fire damage per level to the foe beside the caster.' }),
  charmPerson: S('charmPerson', 'Charm Person', 'magicUser', 1, { range: '12 squares', save: 'neg:sp', desc: 'A humanoid fights for you.' }),
  enlarge: S('enlarge', 'Enlarge', 'magicUser', 1, { usable: 'both', desc: 'Grows a creature, increasing strength.' }),
  friends: S('friends', 'Friends', 'magicUser', 1, { usable: 'camp', range: 'self', desc: 'Raises charisma.' }),
  magicMissile: S('magicMissile', 'Magic Missile', 'magicUser', 1, { range: '6 squares', desc: '1d4+1 per missile, never misses.' }),
  readMagic: S('readMagic', 'Read Magic', 'magicUser', 1, { usable: 'camp', range: 'self', desc: 'Read magical scrolls.' }),
  shield: S('shield', 'Shield', 'magicUser', 1, { usable: 'both', range: 'self', desc: 'AC 2 vs missiles, blocks magic missile.' }),
  shockingGrasp: S('shockingGrasp', 'Shocking Grasp', 'magicUser', 1, { desc: '1d8 + 1/level electrical damage.' }),
  sleep: S('sleep', 'Sleep', 'magicUser', 1, { range: '3 + 1/level squares', area: '3x3', desc: 'Puts 4d4 weak creatures to sleep (fewer of up to 4+4 HD).' }),
  // Magic-User 2
  invisibility: S('invisibility', 'Invisibility', 'magicUser', 2, { usable: 'both', desc: 'Target becomes invisible.' }),
  mirrorImage: S('mirrorImage', 'Mirror Image', 'magicUser', 2, { range: 'self', desc: 'Creates illusory duplicates.' }),
  strength: S('strength', 'Strength', 'magicUser', 2, { usable: 'camp', desc: 'Raises strength.' }),
  stinkingCloud: S('stinkingCloud', 'Stinking Cloud', 'magicUser', 2, { range: '3 squares', area: '2x2', save: 'neg:ppdm', desc: 'Helpless nausea.' }),
  // Magic-User 3
  fireball: S('fireball', 'Fireball', 'magicUser', 3, { range: '10 squares', area: 'radius 2', save: 'half:sp', desc: '1d6 per level fire damage.' }),
  lightningBolt: S('lightningBolt', 'Lightning Bolt', 'magicUser', 3, { range: '8 squares', area: 'line', save: 'half:sp', desc: '1d6 per level electrical damage.' }),
  haste: S('haste', 'Haste', 'magicUser', 3, { area: 'party', desc: 'Doubles movement and attacks.' }),
  // The rest of the Pool of Radiance list (mechanics: src/rules/spells.js SPELL_RULES).
  protectionFromGood: S('protectionFromGood', "Protection from Good", 'cleric', 1, { usable: 'both', desc: 'Touch: -2 AC and +2 saves against good attackers.' }),
  resistFire: S('resistFire', "Resist Fire", 'cleric', 2, { usable: 'both', desc: 'Touch: half damage from fire, +3 to saves vs fire.' }),
  slowPoison: S('slowPoison', "Slow Poison", 'cleric', 2, { usable: 'both', desc: 'Touch: a poisoned character does not die for 1 hour/level.' }),
  snakeCharm: S('snakeCharm', "Snake Charm", 'cleric', 2, { usable: 'combat', desc: 'Snakes whose HP total no more than the cleric\'s are entranced.' }),
  spiritualHammer: S('spiritualHammer', "Spiritual Hammer", 'cleric', 2, { usable: 'combat', desc: 'Magical attack each round: 1d4+1 (+1 per 6 levels to hit and damage).' }),
  chant: S('chant', "Chant", 'cleric', 2, { usable: 'combat', desc: 'Allies +1 to hit, damage and saves; enemies -1.' }),
  cureBlindness: S('cureBlindness', "Cure Blindness", 'cleric', 3, { usable: 'both', desc: 'Touch: cures blindness.' }),
  causeBlindness: S('causeBlindness', "Cause Blindness", 'cleric', 3, { usable: 'combat', save: 'neg:sp', desc: 'Touch: blinds (-4 to hit, +4 AC). Save vs spell negates.' }),
  cureDisease: S('cureDisease', "Cure Disease", 'cleric', 3, { usable: 'both', desc: 'Touch: cures disease.' }),
  causeDisease: S('causeDisease', "Cause Disease", 'cleric', 3, { usable: 'combat', save: 'neg:sp', desc: 'Touch: disease (-2 to hit, no natural healing). Save vs spell negates.' }),
  removeCurse: S('removeCurse', "Remove Curse", 'cleric', 3, { usable: 'both', desc: 'Touch: removes curses; cursed items may be discarded.' }),
  bestowCurse: S('bestowCurse', "Bestow Curse", 'cleric', 3, { usable: 'combat', save: 'neg:sp', desc: 'Touch: -4 to hit and saves, 1 turn/level. Save vs spell negates.' }),
  reduce: S('reduce', "Reduce", 'magicUser', 1, { usable: 'combat', save: 'neg:sp', desc: 'Shrinks a creature: -2 damage. Save vs spell negates.' }),
  detectInvisibility: S('detectInvisibility', "Detect Invisibility", 'magicUser', 2, { usable: 'both', desc: 'See invisible creatures, 5 rounds/level.' }),
  knock: S('knock', "Knock", 'magicUser', 2, { usable: 'camp', desc: 'Opens a locked or stuck door.' }),
  rayOfEnfeeblement: S('rayOfEnfeeblement', "Ray of Enfeeblement", 'magicUser', 2, { usable: 'combat', save: 'neg:sp', desc: 'Strength (damage) cut by 25% +2%/level above 3rd. Save vs spell negates.' }),
  blink: S('blink', "Blink", 'magicUser', 3, { usable: 'combat', desc: 'Half of all attacks against the caster miss; 1 round/level.' }),
  invisibility10: S('invisibility10', "Invisibility 10' Radius", 'magicUser', 3, { usable: 'both', desc: 'Allies within 1 square turn invisible until they attack.' }),
  protEvil10: S('protEvil10', "Prot. from Evil 10' Radius", 'magicUser', 3, { usable: 'both', desc: 'Allies within 1 square: -2 AC and +2 saves vs evil.' }),
  protGood10: S('protGood10', "Prot. from Good 10' Radius", 'magicUser', 3, { usable: 'both', desc: 'Allies within 1 square: -2 AC and +2 saves vs good.' }),
  protNormalMissiles: S('protNormalMissiles', "Prot. from Normal Missiles", 'magicUser', 3, { usable: 'both', desc: 'Touch: immune to non-magical missiles, 1 turn/level.' }),
  slow: S('slow', "Slow", 'magicUser', 3, { usable: 'combat', save: 'neg:sp', desc: 'Up to 1 enemy/level: half moves and attacks. Save vs spell negates.' }),
};

export function spellsFor(school, level) {
  return Object.values(SPELLS).filter((s) => s.school === school && s.level === level);
}
