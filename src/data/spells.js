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
  holdPerson: S('holdPerson', 'Hold Person', 'cleric', 2, { range: '12 squares', save: 'neg:sp', desc: 'Paralyzes up to 3 humanoids.' }),
  silence15: S('silence15', "Silence 15' Radius", 'cleric', 2, { range: '12 squares', desc: 'Prevents spellcasting in an area.' }),
  // Cleric 3
  dispelMagic: S('dispelMagic', 'Dispel Magic', 'cleric', 3, { desc: 'Ends magical effects.' }),
  prayer: S('prayer', 'Prayer', 'cleric', 3, { area: 'all', desc: '+1 allies / -1 enemies.' }),
  // Magic-User 1
  burningHands: S('burningHands', 'Burning Hands', 'magicUser', 1, { range: '1 square', area: 'cone', desc: '1 hp damage per level to all in the cone.' }),
  charmPerson: S('charmPerson', 'Charm Person', 'magicUser', 1, { range: '12 squares', save: 'neg:sp', desc: 'A humanoid fights for you.' }),
  enlarge: S('enlarge', 'Enlarge', 'magicUser', 1, { usable: 'both', desc: 'Grows a creature, increasing strength.' }),
  friends: S('friends', 'Friends', 'magicUser', 1, { usable: 'camp', range: 'self', desc: 'Raises charisma.' }),
  magicMissile: S('magicMissile', 'Magic Missile', 'magicUser', 1, { range: '6 squares', desc: '1d4+1 per missile, never misses.' }),
  readMagic: S('readMagic', 'Read Magic', 'magicUser', 1, { usable: 'camp', range: 'self', desc: 'Read magical scrolls.' }),
  shield: S('shield', 'Shield', 'magicUser', 1, { usable: 'both', range: 'self', desc: 'AC 2 vs missiles, blocks magic missile.' }),
  shockingGrasp: S('shockingGrasp', 'Shocking Grasp', 'magicUser', 1, { desc: '1d8 + 1/level electrical damage.' }),
  sleep: S('sleep', 'Sleep', 'magicUser', 1, { range: '6 squares', area: '3x3', desc: 'Puts 2d4 HD of creatures to sleep.' }),
  // Magic-User 2
  invisibility: S('invisibility', 'Invisibility', 'magicUser', 2, { usable: 'both', desc: 'Target becomes invisible.' }),
  mirrorImage: S('mirrorImage', 'Mirror Image', 'magicUser', 2, { range: 'self', desc: 'Creates illusory duplicates.' }),
  strength: S('strength', 'Strength', 'magicUser', 2, { usable: 'camp', desc: 'Raises strength.' }),
  stinkingCloud: S('stinkingCloud', 'Stinking Cloud', 'magicUser', 2, { range: '3 squares', area: '2x2', save: 'neg:ppdm', desc: 'Helpless nausea.' }),
  // Magic-User 3
  fireball: S('fireball', 'Fireball', 'magicUser', 3, { range: '10 squares', area: 'radius 2', save: 'half:sp', desc: '1d6 per level fire damage.' }),
  lightningBolt: S('lightningBolt', 'Lightning Bolt', 'magicUser', 3, { range: '8 squares', area: 'line', save: 'half:sp', desc: '1d6 per level electrical damage.' }),
  haste: S('haste', 'Haste', 'magicUser', 3, { area: 'party', desc: 'Doubles movement and attacks.' }),
};

export function spellsFor(school, level) {
  return Object.values(SPELLS).filter((s) => s.school === school && s.level === level);
}
