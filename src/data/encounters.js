/**
 * Encounter table. See schema.js EncounterDef.
 *
 * Two kinds share this table so that every map event of type 'encounter'
 * resolves through one id space:
 *   * monster encounters — `groups` of monsters, an `intro`, the classic
 *     COMBAT / WAIT / FLEE / PARLAY options and, for PARLAY, a reaction per
 *     Gold Box attitude (HAUGHTY / SLY / NICE / MEEK / ABUSIVE);
 *   * scripted events — `dialogue: '<id>'` points at data/dialogue.js; the
 *     dialogue scene plays the script (which may itself start a fight).
 *
 * Extra fields understood by the dialogue scene:
 *   art      {setting, light?}  backdrop for the painted encounter panel
 *   parley   {haughty|sly|nice|meek|abusive: Reaction}
 *            Reaction = 'fight' | 'leave' | 'flee' | 'bribe:<gp>' | 'talk:<dialogue id>'
 *   parleyText  {<reaction kind or attitude>: line}   optional flavour lines
 *   surprise    'party' | 'monsters'  forced surprise
 *   onWin       effects applied after a victory (see dialogue.js Effect), e.g. [{flag}]
 */

import { TRAVEL } from './travel.js';

const STD = ['combat', 'wait', 'flee', 'parley'];
const MINDLESS = ['combat', 'flee'];

export const ENCOUNTERS = {
  // ---------------------------------------------------------------- the Slums
  kobolds_1: {
    id: 'kobolds_1',
    name: 'Kobold Patrol',
    groups: [{ monster: 'kobold', count: 6 }],
    intro: 'A pack of snarling kobolds bursts from the rubble, rusty blades raised. Their leader yaps an order in a guttural tongue.',
    options: STD,
    terrain: 'slums_street',
    treasure: { gold: '2d10' },
    art: { setting: 'slums', light: 'dusk' },
    parley: { haughty: 'flee', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'fight' },
    parleyText: { flee: 'The kobolds exchange uneasy yelps — and scatter into the rubble.' },
  },
  orcs_1: {
    id: 'orcs_1',
    name: 'Orc Raiders',
    groups: [{ monster: 'orc', count: 4 }, { monster: 'hobgoblin', count: 1 }],
    intro: 'Orcs wearing the tattered colours of the Bloodied Skull clan block the alley.',
    options: STD,
    terrain: 'slums_street',
    treasure: { gold: '3d12' },
    art: { setting: 'slums', light: 'day' },
    parley: { haughty: 'fight', sly: 'bribe:50', nice: 'fight', meek: 'bribe:100', abusive: 'fight' },
  },
  skeletons_1: {
    id: 'skeletons_1',
    name: 'Restless Dead',
    groups: [{ monster: 'skeleton', count: 5 }],
    intro: 'Bones rattle across the flagstones. Skeletons, their empty sockets glowing faintly, shamble toward you.',
    options: MINDLESS,
    terrain: 'slums_courtyard',
    art: { setting: 'ruined_temple', light: 'night' },
  },
  rats_1: {
    id: 'rats_1',
    name: 'Giant Rats',
    groups: [{ monster: 'giantRat', count: 8 }],
    intro: 'The rubble seethes with fat, red-eyed rats the size of dogs.',
    options: MINDLESS,
    terrain: 'slums_street',
    art: { setting: 'tenement', light: 'dim' },
  },
  thugs_1: {
    id: 'thugs_1',
    name: 'Slum Thugs',
    groups: [{ monster: 'thug', count: 4 }, { monster: 'buccaneer', count: 2 }],
    intro: '"Your purses, strangers, or your lives!" A gang of cutthroats steps out of the shadows.',
    options: STD,
    terrain: 'slums_street',
    treasure: { gold: '4d10' },
    art: { setting: 'alley', light: 'night' },
    parley: { haughty: 'flee', sly: 'bribe:40', nice: 'fight', meek: 'bribe:80', abusive: 'fight' },
    parleyText: { flee: '"Not worth it, lads." The thugs melt back into the dark.' },
  },
  slums_goblins: {
    id: 'slums_goblins', name: 'Goblin Scavengers',
    groups: [{ monster: 'goblin', count: 7 }],
    intro: 'Goblins are picking through a collapsed shop, squabbling over a broken lamp. One of them looks up and shrieks.',
    options: STD, treasure: { gold: '2d12' }, art: { setting: 'slums', light: 'day' },
    parley: { haughty: 'flee', sly: 'leave', nice: 'fight', meek: 'fight', abusive: 'flee' },
  },
  slums_orc_boss: {
    id: 'slums_orc_boss', name: 'The Slumlord',
    groups: [{ monster: 'orcLeader', count: 1 }, { monster: 'orc', count: 6 }, { monster: 'kobold', count: 4 }],
    intro: 'In the shell of the old counting-house, a huge orc lounges on a heap of stolen cushions. "More meat for the Boss," he grunts, and his warriors laugh.',
    options: STD, treasure: { gold: '6d20', items: ['potionHealing'] }, art: { setting: 'tenement', light: 'torch' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'bribe:200', abusive: 'fight' },
    parleyText: { fight: '"Talk," says the orc, "is for the living." He stands.' },
  },

  // -------------------------------------------------------------- Sokol Keep
  sokol_skeletons: {
    id: 'sokol_skeletons', name: 'The Dead Garrison',
    groups: [{ monster: 'skeleton', count: 8 }],
    intro: 'The skeletons wear the rusted livery of the keep. They form a line, lower their spears, and advance in perfect step, as they were drilled to in life.',
    options: MINDLESS, art: { setting: 'keep', light: 'night' },
  },
  sokol_zombies: {
    id: 'sokol_zombies', name: 'Drowned Men',
    groups: [{ monster: 'zombie', count: 6 }],
    intro: 'Water streams from their clothes. The drowned men climb the sea-stair one slow step at a time.',
    options: MINDLESS, art: { setting: 'keep', light: 'night' },
  },
  sokol_ghouls: {
    id: 'sokol_ghouls', name: 'Ghouls in the Barracks',
    groups: [{ monster: 'ghoul', count: 4 }],
    intro: 'Hunched shapes crouch over the bunks, feeding. Their heads come up together, and their eyes are red.',
    options: MINDLESS, art: { setting: 'crypt', light: 'dim' },
  },
  sokol_shadows: {
    id: 'sokol_shadows', name: 'Shadows on the Wall',
    groups: [{ monster: 'shadow', count: 3 }],
    intro: 'Your torchlight throws your shadows on the wall — too many shadows. Three of them peel away from the stone.',
    options: MINDLESS, art: { setting: 'keep', light: 'dim' },
  },

  // ------------------------------------------------------------- Kuto's Well
  well_kobolds: {
    id: 'well_kobolds', name: 'Kobold Warband',
    groups: [{ monster: 'kobold', count: 10 }, { monster: 'koboldChief', count: 1 }],
    intro: 'Dozens of eyes shine in the dark of the warrens. A kobold in a helmet far too big for him points his spear at you and screeches.',
    options: STD, treasure: { gold: '5d10' }, art: { setting: 'well', light: 'torch' },
    parley: { haughty: 'fight', sly: 'talk:well_chief', nice: 'talk:well_chief', meek: 'fight', abusive: 'fight' },
  },
  well_frogs: {
    id: 'well_frogs', name: 'Things in the Water',
    groups: [{ monster: 'giantFrog', count: 5 }],
    intro: 'The black water ripples. Pale, bloated shapes rise, blinking slowly.',
    options: MINDLESS, art: { setting: 'well', light: 'dim' },
  },
  well_centipedes: {
    id: 'well_centipedes', name: 'Centipedes',
    groups: [{ monster: 'giantCentipede', count: 6 }],
    intro: 'Something skitters across the ceiling, then drops. Something with a great many legs.',
    options: MINDLESS, art: { setting: 'well', light: 'dim' },
  },

  // ------------------------------------------------------------- Podol Plaza
  podol_bandits: {
    id: 'podol_bandits', name: 'Toll Collectors',
    groups: [{ monster: 'bandit', count: 6 }, { monster: 'orc', count: 3 }],
    intro: 'A bandit in a stolen alderman\'s chain steps out, flanked by orcs. "Market\'s closed," he says. "Unless you pay the toll. Toll is everything you\'ve got."',
    options: STD, treasure: { gold: '4d12' }, art: { setting: 'plaza', light: 'day' },
    parley: { haughty: 'fight', sly: 'bribe:60', nice: 'fight', meek: 'bribe:150', abusive: 'fight' },
  },
  podol_captain: {
    id: 'podol_captain', name: 'The Bandit Captain',
    groups: [{ monster: 'banditLeader', count: 1 }, { monster: 'bandit', count: 6 }, { monster: 'hobgoblin', count: 4 }],
    intro: 'The captain holds court from the old auctioneer\'s block, a tally-book open on his knee. He licks his thumb, turns a page, and writes your names down.',
    options: STD, treasure: { gold: '8d20', items: ['scrollHoldPerson'] }, art: { setting: 'plaza', light: 'dusk' },
    onWin: [{ flag: 'podol_cleared' }],
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'bribe:300', abusive: 'fight' },
  },
  podol_gnolls: {
    id: 'podol_gnolls', name: 'Gnoll Pack',
    groups: [{ monster: 'gnoll', count: 5 }],
    intro: 'Gnolls lope out of the ruined grain-hall, laughing their horrible laughter.',
    options: STD, art: { setting: 'plaza', light: 'dusk' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'fight' },
  },

  // --------------------------------------------------------- Mendor's Library
  library_gnolls: {
    id: 'library_gnolls', name: 'Gnolls in the Stacks',
    groups: [{ monster: 'gnoll', count: 4 }, { monster: 'bugbear', count: 1 }],
    intro: 'Gnolls are burning books for warmth. The bugbear with them is reading one, very slowly, moving its lips.',
    options: STD, art: { setting: 'library', light: 'fire' },
    parley: { haughty: 'fight', sly: 'leave', nice: 'fight', meek: 'fight', abusive: 'fight' },
  },
  library_ghouls: {
    id: 'library_ghouls', name: 'The Scholars',
    groups: [{ monster: 'ghoul', count: 5 }],
    intro: 'They still wear their scholars\' robes. They were not always this hungry.',
    options: MINDLESS, art: { setting: 'library', light: 'dim' },
  },
  library_spider: {
    id: 'library_spider', name: 'The Reading-Room Spider',
    groups: [{ monster: 'giantSpider', count: 2 }],
    intro: 'Webs hang from the high shelves like grey banners. Something the size of a pony is watching you from the gallery.',
    options: MINDLESS, art: { setting: 'library', light: 'dim' },
  },

  // --------------------------------------------------- Cadorna Textile House
  textile_rats: {
    id: 'textile_rats', name: 'Rats in the Bolts',
    groups: [{ monster: 'giantRat', count: 10 }],
    intro: 'The bolts of rotten cloth are alive with rats.',
    options: MINDLESS, art: { setting: 'textile', light: 'dim' },
  },
  textile_lizardmen: {
    id: 'textile_lizardmen', name: 'Lizard Men',
    groups: [{ monster: 'lizardMan', count: 5 }],
    intro: 'The dye-vats have flooded. Lizard men rise from the green water, hissing.',
    options: STD, art: { setting: 'textile', light: 'dim' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'leave', meek: 'fight', abusive: 'fight' },
  },
  textile_trolls: {
    id: 'textile_trolls', name: 'The Troll in the Counting-Room',
    groups: [{ monster: 'troll', count: 1 }, { monster: 'orc', count: 4 }],
    intro: 'A troll sits on the Cadorna strongbox as if it were a stool, picking its teeth with a clerk\'s pen.',
    options: STD, treasure: { gold: '6d20' }, art: { setting: 'textile', light: 'torch' },
    onWin: [{ flag: 'textile_troll_dead' }],
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'bribe:400', abusive: 'fight' },
  },

  // ------------------------------------------------------- Valhingen Graveyard
  grave_zombies: {
    id: 'grave_zombies', name: 'The Unquiet Dead',
    groups: [{ monster: 'zombie', count: 8 }],
    intro: 'The earth heaves. Hands, then heads, then the dead of Phlan in their grave-clothes.',
    options: MINDLESS, art: { setting: 'graveyard', light: 'night' },
  },
  grave_ghouls: {
    id: 'grave_ghouls', name: 'Ghouls and a Ghast',
    groups: [{ monster: 'ghoul', count: 5 }, { monster: 'ghast', count: 1 }],
    intro: 'A stench like an open grave in high summer rolls over you. Then the ghouls come, and the thing that leads them.',
    options: MINDLESS, art: { setting: 'graveyard', light: 'night' },
  },
  grave_wights: {
    id: 'grave_wights', name: 'Barrow Wights',
    groups: [{ monster: 'wight', count: 3 }],
    intro: 'Three figures in rotted finery step from the mausoleum. Their eyes are pinpricks of cold light, and the air around them tastes of frost.',
    options: MINDLESS, art: { setting: 'graveyard', light: 'night' },
  },

  // ---------------------------------------------------------- Temple of Bane
  bane_acolytes: {
    id: 'bane_acolytes', name: 'Acolytes of Bane',
    groups: [{ monster: 'acolyte', count: 6 }, { monster: 'hobgoblin', count: 4 }],
    intro: 'Black-robed acolytes are chanting before a brazier of green flame. The chanting stops.',
    options: STD, treasure: { gold: '5d20' }, art: { setting: 'temple_bane', light: 'green' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'fight' },
    parleyText: { fight: '"The Black Lord hears no petitions," hisses the eldest.' },
  },
  bane_priest: {
    id: 'bane_priest', name: 'The Black Hand',
    groups: [{ monster: 'banePriest', count: 1 }, { monster: 'acolyte', count: 4 }, { monster: 'wight', count: 2 }],
    intro: 'The high priest raises a hand sheathed in black iron. "You have walked a long way to die," says the Black Hand. "Bane is patient. He will wait for the rest of your city."',
    options: ['combat', 'flee'], treasure: { gold: '10d20', items: ['blackHandSigil', 'maceplus1'] }, art: { setting: 'temple_bane', light: 'green' },
  },

  // ---------------------------------------------------------- Valjevo Castle
  valjevo_hobgoblins: {
    id: 'valjevo_hobgoblins', name: 'Castle Guard',
    groups: [{ monster: 'hobgoblin', count: 8 }, { monster: 'hobgoblinChief', count: 1 }],
    intro: 'Hobgoblins in black-lacquered scale snap to attention along the hall. Their chief draws his sword and points it at your throat.',
    options: STD, treasure: { gold: '6d20' }, art: { setting: 'castle', light: 'torch' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'fight' },
  },
  valjevo_ogres: {
    id: 'valjevo_ogres', name: 'Ogre Brutes',
    groups: [{ monster: 'ogre', count: 3 }],
    intro: 'Three ogres are playing a game with an iron ball and a prisoner. They stop playing.',
    options: STD, art: { setting: 'castle', light: 'torch' },
    parley: { haughty: 'fight', sly: 'bribe:250', nice: 'fight', meek: 'fight', abusive: 'fight' },
  },
  valjevo_giant: {
    id: 'valjevo_giant', name: 'The Giant Speaker',
    groups: [{ monster: 'hillGiant', count: 1 }, { monster: 'ogre', count: 2 }, { monster: 'hobgoblin', count: 6 }],
    intro: 'The hill giant rises from beside an empty throne. "The Boss is not receiving," it rumbles. "But I will take a message. I will take it off your corpses."',
    options: STD, treasure: { gold: '12d20', items: ['gauntletsOgrePower'] }, art: { setting: 'castle', light: 'torch' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'fight' },
  },

  // ----------------------------------------------------------- Stojanow Gate
  gate_hobgoblins: {
    id: 'gate_hobgoblins', name: 'Gate Watch',
    groups: [{ monster: 'hobgoblin', count: 8 }],
    intro: 'Horns blow from the gatehouse. Hobgoblins pour down the stair, forming a shield-wall across the road.',
    options: STD, treasure: { gold: '4d20' }, art: { setting: 'gate', light: 'day' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'bribe:200', abusive: 'fight' },
  },
  gate_chief: {
    id: 'gate_chief', name: 'Warlord of the Gate',
    groups: [{ monster: 'hobgoblinChief', count: 1 }, { monster: 'hobgoblin', count: 8 }, { monster: 'bugbear', count: 2 }],
    intro: 'The warlord wears a dead knight\'s helm with the visor torn off. He grins. "Phlan sends children now?"',
    options: STD, treasure: { gold: '10d20', items: ['shieldPlus1'] }, art: { setting: 'gate', light: 'dusk' },
    parley: { haughty: 'fight', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'fight' },
  },

  // --------------------------------------------------- The Pool / wilderness
  pool_guardians: {
    id: 'pool_guardians', name: 'Guardians of the Pool',
    groups: [{ monster: 'spectre', count: 2 }, { monster: 'wight', count: 3 }],
    intro: 'Golden light spills from the chamber ahead, and in it stand the dead who guard the Pool, hollow and patient.',
    options: MINDLESS, art: { setting: 'pool', light: 'gold' },
  },
  pool_tyranthraxus: {
    id: 'pool_tyranthraxus', name: 'Tyranthraxus',
    groups: [{ monster: 'tyranthraxus', count: 1 }],
    intro: 'The bronze dragon uncoils from the Pool, and the fire in its eyes is laughing.',
    options: ['combat'], art: { setting: 'pool', light: 'gold' },
  },
  wild_wolves: {
    id: 'wild_wolves', name: 'Wolf Pack',
    groups: [{ monster: 'wolf', count: 6 }],
    intro: 'Grey shapes flow between the pines, keeping pace with you. Then, all at once, they close.',
    options: MINDLESS, art: { setting: 'wilds', light: 'dusk' },
  },
  wild_ogres: {
    id: 'wild_ogres', name: 'Ogres on the Road',
    groups: [{ monster: 'ogre', count: 2 }, { monster: 'gnoll', count: 4 }],
    intro: 'A felled tree blocks the road. Ogres wait behind it, tossing stones from hand to hand.',
    options: STD, art: { setting: 'wilds', light: 'day' },
    parley: { haughty: 'fight', sly: 'bribe:150', nice: 'fight', meek: 'bribe:300', abusive: 'fight' },
  },

  // ======================================================= scripted events
  ev_gate_captain: { id: 'ev_gate_captain', name: 'The Slum Wall', groups: [], dialogue: 'gate_captain' },
  ev_slums_survivor: { id: 'ev_slums_survivor', name: 'A Survivor', groups: [], dialogue: 'slums_survivor' },
  ev_slums_overheard: { id: 'ev_slums_overheard', name: 'Voices', groups: [], dialogue: 'slums_overheard' },
  ev_slums_shrine: { id: 'ev_slums_shrine', name: 'The Fallen Shrine', groups: [], dialogue: 'slums_shrine' },
  ev_slums_boss_door: { id: 'ev_slums_boss_door', name: 'The Counting-House', groups: [], dialogue: 'slums_boss_door' },
  ev_silk: { id: 'ev_silk', name: 'A Voice in the Alley', groups: [], dialogue: 'silk' },
  ev_crier: { id: 'ev_crier', name: 'The Town Crier', groups: [], dialogue: 'crier' },
  ev_ferran: { id: 'ev_ferran', name: 'The Castellan', groups: [], dialogue: 'ferran' },
  ev_sokol_beacon: { id: 'ev_sokol_beacon', name: 'The Beacon', groups: [], dialogue: 'sokol_beacon' },
  ev_sokol_landing: { id: 'ev_sokol_landing', name: 'Sokol Landing', groups: [], dialogue: 'sokol_landing' },
  ev_well_head: { id: 'ev_well_head', name: 'Kuto\'s Well', groups: [], dialogue: 'well_head' },
  ev_well_chief: { id: 'ev_well_chief', name: 'The Kobold Throne', groups: [], dialogue: 'well_chief' },
  ev_podol_hoss: { id: 'ev_podol_hoss', name: 'The Counting-House', groups: [], dialogue: 'podol_hoss' },
  ev_podol_statue: { id: 'ev_podol_statue', name: 'The Statue', groups: [], dialogue: 'podol_statue' },
  ev_library_ione: { id: 'ev_library_ione', name: 'The Reading Room', groups: [], dialogue: 'library_ione' },
  ev_library_portrait: { id: 'ev_library_portrait', name: 'Portrait of Mendor', groups: [], dialogue: 'library_portrait' },
  ev_library_page: { id: 'ev_library_page', name: 'A Torn Page', groups: [], dialogue: 'library_page' },
  ev_textile_box: { id: 'ev_textile_box', name: 'The Strongbox', groups: [], dialogue: 'textile_box' },
  ev_grave_mausoleum: { id: 'ev_grave_mausoleum', name: 'The Mausoleum', groups: [], dialogue: 'grave_mausoleum' },
  ev_grave_angel: { id: 'ev_grave_angel', name: 'The Weeping Angel', groups: [], dialogue: 'grave_angel' },
  ev_bane_altar: { id: 'ev_bane_altar', name: 'The Altar of Bane', groups: [], dialogue: 'bane_altar' },
  ev_valjevo_prisoner: { id: 'ev_valjevo_prisoner', name: 'A Prisoner', groups: [], dialogue: 'valjevo_prisoner' },
  ev_valjevo_throne: { id: 'ev_valjevo_throne', name: 'The Empty Throne', groups: [], dialogue: 'valjevo_throne' },
  ev_gate_road: { id: 'ev_gate_road', name: 'The River Road', groups: [], dialogue: 'gate_road' },
  ev_pool: { id: 'ev_pool', name: 'The Pool of Radiance', groups: [], dialogue: 'the_pool' },
  ev_wild_camp: { id: 'ev_wild_camp', name: 'Abandoned Camp', groups: [], dialogue: 'wild_camp' },
  ev_wild_return: { id: 'ev_wild_return', name: 'The Way Back', groups: [], dialogue: 'wild_return' },
};

export function getEncounter(id) {
  const e = ENCOUNTERS[id];
  if (!e) throw new Error(`Unknown encounter "${id}"`);
  return e;
}

// Travel links (data/travel.js) resolve through the same id space: go_<id>.
for (const t of TRAVEL) ENCOUNTERS[`go_${t.id}`] = { id: `go_${t.id}`, name: t.title, groups: [], dialogue: `go_${t.id}`, travel: t.id };
