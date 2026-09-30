/** Text for the character creation screens (terse, Gold Box flavoured). */
export const CREATE_TEXT = {
  hub: 'Phlan needs heroes. Gather up to six adventurers — create them here, or add companions from your roster — then set out for the ruined city.',
  emptyParty: 'No one has answered the call yet. Create a character to begin.',
  roster: 'Every character you create is kept on the roster, so they can rejoin later parties.',
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
