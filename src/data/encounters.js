/** Seed encounter table. See schema.js EncounterDef. */
export const ENCOUNTERS = {
  kobolds_1: {
    id: 'kobolds_1',
    name: 'Kobold Patrol',
    groups: [{ monster: 'kobold', count: 6 }],
    intro: 'A pack of snarling kobolds bursts from the rubble, rusty blades raised. Their leader yaps an order in a guttural tongue.',
    options: ['combat', 'wait', 'flee', 'parley'],
    terrain: 'slums_street',
    treasure: { gold: '2d10' },
  },
  orcs_1: {
    id: 'orcs_1',
    name: 'Orc Raiders',
    groups: [{ monster: 'orc', count: 4 }, { monster: 'hobgoblin', count: 1 }],
    intro: 'Orcs wearing the tattered colours of the Bloodied Skull clan block the alley.',
    options: ['combat', 'wait', 'flee', 'parley'],
    terrain: 'slums_street',
    treasure: { gold: '3d12' },
  },
  skeletons_1: {
    id: 'skeletons_1',
    name: 'Restless Dead',
    groups: [{ monster: 'skeleton', count: 5 }],
    intro: 'Bones rattle across the flagstones. Skeletons, their empty sockets glowing faintly, shamble toward you.',
    options: ['combat', 'flee'],
    terrain: 'slums_courtyard',
  },
  rats_1: {
    id: 'rats_1',
    name: 'Giant Rats',
    groups: [{ monster: 'giantRat', count: 8 }],
    intro: 'The rubble seethes with fat, red-eyed rats the size of dogs.',
    options: ['combat', 'flee'],
    terrain: 'slums_street',
  },
  thugs_1: {
    id: 'thugs_1',
    name: 'Slum Thugs',
    groups: [{ monster: 'thug', count: 4 }, { monster: 'buccaneer', count: 2 }],
    intro: '"Your purses, strangers, or your lives!" A gang of cutthroats steps out of the shadows.',
    options: ['combat', 'wait', 'flee', 'parley'],
    terrain: 'slums_street',
    treasure: { gold: '4d10' },
  },
};

export function getEncounter(id) {
  const e = ENCOUNTERS[id];
  if (!e) throw new Error(`Unknown encounter "${id}"`);
  return e;
}
