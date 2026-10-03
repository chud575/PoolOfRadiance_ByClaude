/** Text for the character creation screens (terse, Gold Box flavoured). */
export const CREATE_TEXT = {
  hub: 'Phlan needs heroes. Gather up to six adventurers — create them here, or add companions from your roster — then set out for the ruined city.',
  emptyParty: 'No one has answered the call yet. Create a character to begin.',
  roster: 'Dropped characters wait here. ADD brings one back.',
  rosterAll: 'All kept characters are in the party. DROP sends one here.',
  rosterEmpty: 'Everyone you CREATE is kept here for ADD.',
  race: 'Your blood decides your gifts and your limits. Humans may rise without bound; the elder races trade that for talents of their own and multiple classes.',
  raceShort: {
    human: 'Unlimited levels; may dual-class.',
    elf: 'Resists sleep & charm; bow and sword.',
    halfElf: 'Most multi-class choices.',
    dwarf: 'Tough; saves vs magic & poison.',
    gnome: 'Clever; saves vs magic.',
    halfling: 'Deadly with sling; stealthy.',
  },
  cls: 'Your calling. Multi-class characters share experience between their classes and advance more slowly, but master several arts at once.',
  multi: (cs) => `${cs.length} classes · XP split ${cs.length} ways · hp averaged`,
  multiNote: 'Multi-class: experience is divided equally, hit points are averaged, and the character uses the best THAC0 and saves of their classes. Thieving and arcane casting still suffer in heavy armour.',
  align: 'Your moral compass. In Pool of Radiance alignment colours how others treat you, and some classes forbid certain paths.',
  stats: {
    '4d6': 'Modern roll: four dice per ability, the lowest discarded. Reroll as often as you like; racial adjustments are applied.',
    '3d6': 'The 1988 way: three dice per ability, straight down the line. Reroll until the gods smile.',
    buy: 'Spend points to set each score (8 is free; 15+ costs double, 17+ triple). Racial adjustments are applied afterwards.',
  },
  portrait: 'As in the original, pick a head and a body — here painted in oils. Colours dress both the portrait and your combat miniature.',
  icon: 'The miniature on the plinth is your combat icon: it wears your chosen armour and colours on the battlefield.',
  name: 'Fifteen letters at most. The bards of Phlan will want something they can sing.',
};

export const NAMES = {
  human: { male: ['Taran', 'Gareth', 'Aldric', 'Roderick', 'Brennan', 'Corwin', 'Marcus', 'Tobin', 'Evander', 'Halvard'], female: ['Aveline', 'Mira', 'Seraphine', 'Brenna', 'Isolde', 'Maren', 'Talia', 'Rowena', 'Elsbeth', 'Kestrel'] },
  elf: { male: ['Aerendil', 'Thalion', 'Faelar', 'Ilphas', 'Sylvar', 'Elorin'], female: ['Ilyra', 'Shalana', 'Naelia', 'Amarith', 'Lirael', 'Sariel'] },
  halfElf: { male: ['Kieran', 'Laeroth', 'Varis', 'Daelin', 'Orrin'], female: ['Meralda', 'Siana', 'Elaith', 'Tessaly', 'Carys'] },
  dwarf: { male: ['Durgin', 'Thorbek', 'Brottor', 'Harbek', 'Orsik', 'Vondal'], female: ['Helja', 'Dagna', 'Vistra', 'Eldeth', 'Gunnloda'] },
  gnome: { male: ['Fonkin', 'Orryn', 'Wrenn', 'Dimble', 'Zook'], female: ['Nissa', 'Bimpnottin', 'Ellyjobell', 'Carlin', 'Roywyn'] },
  halfling: { male: ['Pip', 'Merric', 'Corrin', 'Milo', 'Roscoe', 'Wendel'], female: ['Lidda', 'Verna', 'Callie', 'Seraphina', 'Bree'] },
};

/**
 * Starting kit built from ALL the classes of a (multi-)class spec, so armour never blocks a calling:
 * arcane casters go unarmoured, thieves wear leather, warriors and priests take mail and shield.
 * Clerics keep to blunt weapons. Pure fighters get a bow; the arrows ride in the pack (unreadied)
 * until the bow is readied.
 * An elf or half-elf fighter/magic-user (no thieving) inherits a shirt of elfin chain: the one armour
 * an elven caster may cast in, so the warrior-mage starts armoured as the 1e elf was meant to.
 * @param {string} classSpec e.g. 'fighter/thief'
 * @param {string} [race]
 * @returns {string[]} item ids
 */
export function kitFor(classSpec, race) {
  const cs = classSpec.split('/');
  const has = (c) => cs.includes(c);
  const arcane = has('magicUser');
  const thief = has('thief');
  const kit = [];
  // Hand weapon.
  if (has('cleric')) kit.push(arcane ? 'staff' : 'mace');
  else if (has('fighter')) kit.push(thief || arcane ? (thief ? 'shortSword' : 'longSword') : 'longSword');
  else if (thief) kit.push(arcane ? 'dagger' : 'shortSword');
  else kit.push('staff');
  // Body: arcane casting forbids armour; thieving needs leather at most.
  if (!arcane && thief) kit.push('leather');
  else if (!arcane && (has('fighter') || has('cleric'))) kit.push('shield', 'chainMail');
  else if (arcane && has('fighter') && !thief && (race === 'elf' || race === 'halfElf')) kit.push('elfinChain');
  // Extras.
  if (has('cleric')) kit.push('holySymbol');
  if (arcane && !has('cleric') && !kit.includes('dagger')) kit.push('dagger');
  if (thief) kit.push('sling');
  if (classSpec === 'fighter') kit.push('shortBow', 'arrows');
  return kit;
}
