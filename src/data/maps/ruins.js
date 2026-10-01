import { MapGrid, EDGE, CELL } from './MapGrid.js';
import { applyTravel, pillar, sign } from './helpers.js';

/**
 * The occupied blocks of old Phlan that lie open to the sky.
 * Edge styles: 0 = dressed stone, 1 = timber, 2 = ruin.
 */

// ------------------------------------------------------------------ Sokol Keep
export function buildSokolKeep() {
  const m = new MapGrid({ id: 'sokol_keep', name: 'Sokol Keep', kind: 'city', wallSet: 'ruin', outdoors: true, start: { x: 7, y: 15, dir: 'N' } });
  m.tileset = 'ruins';
  m.border(EDGE.WALL, 0);
  m.fill(0, 0, 16, 16, CELL.COURTYARD);
  m.fill(0, 15, 16, 1, CELL.WATER);
  m.fill(6, 14, 3, 2, CELL.STREET);
  m.fill(1, 11, 5, 2, CELL.RUBBLE);
  // Curtain wall with the sea-gate.
  for (let x = 0; x < 16; x++) m.setEdge(x, 13, 'S', EDGE.WALL, 0);
  m.setEdge(7, 13, 'S', EDGE.ARCH, 0);
  m.building(1, 1, 4, 3, { style: 0, doors: [{ x: 2, y: 3, dir: 'S' }] }); // chapel
  m.building(6, 1, 4, 4, { style: 0, doors: [{ x: 7, y: 4, dir: 'S' }] }); // keep hall
  m.building(12, 1, 3, 3, { style: 0, doors: [{ x: 12, y: 2, dir: 'W' }] }); // beacon tower
  m.building(1, 6, 3, 4, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 3, y: 8, dir: 'E' }] }); // barracks
  m.building(12, 6, 3, 3, { style: 2, doors: [{ x: 12, y: 7, dir: 'W' }] }); // storehouse
  pillar(m, 7, 8, 0); // the well-head of the bailey
  m.setEdge(11, 10, 'E', EDGE.WALL, 2).setEdge(11, 11, 'E', EDGE.WALL, 2);

  m.zone('Chapel of Sokol', 1, 1, 4, 3);
  m.zone('The Great Hall', 6, 1, 4, 4);
  m.zone('Beacon Tower', 12, 1, 3, 3);
  m.zone('Barracks', 1, 6, 3, 4);
  m.zone('The Bailey', 4, 5, 8, 8);
  m.zone('Sea Landing', 0, 14, 16, 2);

  sign(m, 'sokol_sign', 7, 14, 'Cut into the keystone of the sea-gate: "WE HOLD"');
  m.event({ id: 'sokol_landing', x: 7, y: 13, type: 'encounter', ref: 'ev_sokol_landing', once: true });
  m.event({ id: 'sokol_skeletons', x: 7, y: 10, type: 'encounter', ref: 'sokol_skeletons', once: true });
  m.event({ id: 'sokol_ghouls', x: 2, y: 8, type: 'encounter', ref: 'sokol_ghouls', once: true });
  m.event({ id: 'sokol_shadows', x: 7, y: 3, type: 'encounter', ref: 'sokol_shadows', once: true });
  m.event({ id: 'sokol_zombies', x: 13, y: 11, type: 'encounter', ref: 'sokol_zombies', once: true });
  m.event({ id: 'sokol_ferran', x: 2, y: 2, type: 'encounter', ref: 'ev_ferran' });
  m.event({ id: 'sokol_beacon', x: 12, y: 2, type: 'encounter', ref: 'ev_sokol_beacon' });
  m.event({ id: 'sokol_wander', x: 9, y: 6, type: 'encounter', ref: 'sokol_skeletons', chance: 10 });
  m.event({ id: 'sokol_hall_chest', x: 8, y: 1, type: 'treasure', text: 'The castellan\'s strongbox, its lock rusted through.', once: true, gold: 150 });
  m.event({ id: 'sokol_barracks_loot', x: 1, y: 9, type: 'treasure', text: 'A soldier\'s pay, hidden under a bunk.', once: true, gold: 60 });
  m.event({ id: 'sokol_store', x: 13, y: 7, type: 'text', text: 'Barrels of salt pork and pitch, and a smell of the sea. The garrison was provisioned for a year-long siege. It lasted a night.' });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Kuto's Well
export function buildKutosWell() {
  const m = new MapGrid({ id: 'kutos_well', name: "Kuto's Well", kind: 'city', wallSet: 'ruin', outdoors: true, start: { x: 13, y: 15, dir: 'N' } });
  m.tileset = 'ruins';
  m.border(EDGE.WALL, 2);
  m.fill(0, 0, 16, 16, CELL.RUBBLE);
  m.fill(4, 4, 8, 8, CELL.COURTYARD);
  m.building(1, 1, 4, 3, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 3, y: 3, dir: 'S' }] });
  m.building(10, 1, 4, 2, { style: 1, doors: [{ x: 11, y: 2, dir: 'S' }] });
  m.building(1, 10, 3, 4, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 3, y: 11, dir: 'E' }] });
  m.building(10, 12, 3, 3, { style: 0, doors: [{ x: 10, y: 13, dir: 'W' }] });
  m.building(7, 7, 2, 2, { style: 0, cell: CELL.WATER }); // the well-head
  m.setEdge(5, 5, 'E', EDGE.WALL, 2).setEdge(10, 9, 'S', EDGE.WALL, 2).setEdge(4, 10, 'N', EDGE.WALL, 2);
  m.zone("Kuto's Well", 4, 4, 8, 8);
  m.zone('Well-Wrights\' Row', 1, 1, 4, 3);

  sign(m, 'well_sign', 7, 9, 'Worn into the lip of the well: "KUTO DUG DEEP"');
  m.event({ id: 'well_head_s', x: 7, y: 9, type: 'encounter', ref: 'ev_well_head', facing: 'N' });
  m.event({ id: 'well_head_s2', x: 8, y: 9, type: 'encounter', ref: 'ev_well_head', facing: 'N' });
  m.event({ id: 'well_kobolds', x: 10, y: 8, type: 'encounter', ref: 'kobolds_1', once: true });
  m.event({ id: 'well_thugs', x: 3, y: 6, type: 'encounter', ref: 'slums_goblins', once: true });
  m.event({ id: 'well_rats', x: 12, y: 5, type: 'encounter', ref: 'rats_1', chance: 12 });
  m.event({ id: 'well_cat', x: 2, y: 12, type: 'text', text: 'A grey cat watches you from a windowsill, blinks once, and is gone. Its collar had a little silver whistle on it.' });
  m.event({ id: 'well_cache', x: 11, y: 13, type: 'treasure', text: 'A well-wright\'s savings in a clay jar.', once: true, gold: 70 });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Podol Plaza
export function buildPodolPlaza() {
  const m = new MapGrid({ id: 'podol_plaza', name: 'Podol Plaza', kind: 'city', wallSet: 'phlan_stone', outdoors: true, start: { x: 0, y: 9, dir: 'E' } });
  m.tileset = 'city';
  m.border(EDGE.WALL, 0);
  m.fill(0, 0, 16, 16, CELL.STREET);
  m.fill(3, 3, 10, 9, CELL.COURTYARD);
  m.building(5, 0, 6, 1, { style: 0, doors: [{ x: 7, y: 0, dir: 'S' }] }); // library portico
  m.building(1, 1, 3, 3, { style: 1, doors: [{ x: 3, y: 2, dir: 'E', type: EDGE.LOCKED }] }); // Hoss's counting-house
  m.building(12, 1, 3, 4, { style: 1, doors: [{ x: 12, y: 3, dir: 'W' }] });
  m.building(1, 12, 4, 3, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 3, y: 12, dir: 'N' }] });
  m.building(11, 12, 4, 3, { style: 0, doors: [{ x: 11, y: 13, dir: 'W' }] }); // grain hall
  m.building(6, 12, 3, 2, { style: 1, doors: [{ x: 7, y: 12, dir: 'N' }] });
  pillar(m, 7, 5, 0); // statue of the founder
  // Market stalls.
  for (const [x, y] of [[4, 8], [10, 8], [4, 5], [10, 5]]) m.setEdge(x, y, 'S', EDGE.WALL, 1);
  m.zone('Podol Plaza', 3, 3, 10, 9);
  m.zone('Counting-House of Hoss', 1, 1, 3, 3);
  m.zone('The Grain Hall', 11, 12, 4, 3);

  m.event({ id: 'podol_hoss', x: 4, y: 2, type: 'encounter', ref: 'ev_podol_hoss', facing: 'W' });
  m.event({ id: 'podol_statue', x: 7, y: 6, type: 'encounter', ref: 'ev_podol_statue', facing: 'N' });
  m.event({ id: 'podol_bandits', x: 3, y: 9, type: 'encounter', ref: 'podol_bandits', once: true });
  m.event({ id: 'podol_captain', x: 8, y: 9, type: 'encounter', ref: 'podol_captain', once: true });
  m.event({ id: 'podol_gnolls', x: 12, y: 13, type: 'encounter', ref: 'podol_gnolls', once: true });
  m.event({ id: 'podol_wander', x: 10, y: 10, type: 'encounter', ref: 'podol_bandits', chance: 10 });
  m.event({ id: 'podol_stall', x: 13, y: 3, type: 'treasure', text: 'A money-changer\'s drawer, overlooked by the looters.', once: true, gold: 90 });
  m.event({ id: 'podol_block', x: 8, y: 8, type: 'text', text: 'The auctioneer\'s block. Chalked on it, a long list of names — some crossed out.' });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Valhingen Graveyard
export function buildValhingen() {
  const m = new MapGrid({ id: 'valhingen_graveyard', name: 'Valhingen Graveyard', kind: 'city', wallSet: 'ruin', outdoors: true, start: { x: 7, y: 15, dir: 'N' } });
  m.tileset = 'graveyard'; // explore falls back to 'ruins' until it has a graveyard set
  m.border(EDGE.WALL, 0);
  m.fill(0, 0, 16, 16, CELL.RUBBLE);
  m.fill(6, 3, 3, 13, CELL.COURTYARD);
  m.building(6, 0, 3, 2, { style: 0, doors: [{ x: 7, y: 1, dir: 'S' }] }); // Valhingen mausoleum
  m.building(1, 1, 3, 2, { style: 0, doors: [{ x: 2, y: 2, dir: 'S' }] });
  m.building(11, 1, 3, 2, { style: 0, doors: [{ x: 12, y: 2, dir: 'S' }] });
  m.building(1, 12, 2, 2, { style: 0, doors: [{ x: 2, y: 12, dir: 'N' }] });
  m.building(12, 12, 2, 2, { style: 0, doors: [{ x: 12, y: 12, dir: 'N' }] });
  // Tombs and headstones.
  for (const [x, y] of [[2, 5], [4, 5], [2, 8], [4, 8], [11, 5], [13, 5], [11, 8], [13, 8], [4, 11], [11, 11]]) pillar(m, x, y, 0);
  m.zone('Valhingen Mausoleum', 6, 0, 3, 2);
  m.zone('The Avenue of Angels', 6, 3, 3, 13);

  sign(m, 'grave_sign', 7, 2, 'Graven over the bronze doors: "VALHINGEN — WE SLEEP"');
  m.event({ id: 'grave_angel', x: 4, y: 9, type: 'encounter', ref: 'ev_grave_angel', facing: 'N' });
  m.event({ id: 'grave_mausoleum', x: 7, y: 3, type: 'encounter', ref: 'ev_grave_mausoleum', once: true });
  m.event({ id: 'grave_zombies', x: 9, y: 11, type: 'encounter', ref: 'grave_zombies', once: true });
  m.event({ id: 'grave_ghouls', x: 3, y: 6, type: 'encounter', ref: 'grave_ghouls', once: true });
  m.event({ id: 'grave_wights', x: 12, y: 3, type: 'encounter', ref: 'grave_wights', once: true });
  m.event({ id: 'grave_wander', x: 7, y: 8, type: 'encounter', ref: 'grave_zombies', chance: 10 });
  m.event({ id: 'grave_tomb', x: 12, y: 13, type: 'treasure', text: 'Grave-goods of some forgotten alderman: rings, and a purse for the ferryman.', once: true, gold: 220 });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Stojanow Gate
export function buildStojanowGate() {
  const m = new MapGrid({ id: 'stojanow_gate', name: 'Stojanow Gate', kind: 'city', wallSet: 'ruin', outdoors: true, start: { x: 0, y: 8, dir: 'E' } });
  m.tileset = 'ruins';
  m.border(EDGE.WALL, 0);
  m.fill(0, 0, 16, 16, CELL.RUBBLE);
  m.fill(0, 13, 16, 3, CELL.WATER); // the Stojanow river
  m.fill(0, 7, 16, 2, CELL.STREET);
  m.building(12, 3, 3, 4, { style: 0, doors: [{ x: 12, y: 5, dir: 'W' }] }); // north tower
  m.building(12, 9, 3, 3, { style: 0, doors: [{ x: 12, y: 10, dir: 'W' }] }); // south tower
  m.building(2, 2, 4, 3, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 4, y: 4, dir: 'S' }] });
  m.building(2, 10, 4, 2, { style: 1, doors: [{ x: 3, y: 10, dir: 'N' }] });
  m.building(7, 2, 3, 3, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 8, y: 4, dir: 'S' }] });
  m.zone('The Gatehouse', 11, 3, 5, 9);
  m.zone('River Street', 0, 7, 11, 2);

  m.event({ id: 'stoj_gatehouse', x: 11, y: 7, type: 'encounter', ref: 'ev_gate_road', facing: 'E' });
  m.event({ id: 'stoj_hobgoblins', x: 6, y: 8, type: 'encounter', ref: 'gate_hobgoblins', once: true });
  m.event({ id: 'stoj_wander', x: 8, y: 7, type: 'encounter', ref: 'orcs_1', chance: 10 });
  m.event({ id: 'stoj_armoury', x: 13, y: 5, type: 'treasure', text: 'The war-band\'s paymaster kept his chest in the tower.', once: true, gold: 260 });
  m.event({ id: 'stoj_river', x: 5, y: 12, type: 'text', text: 'The Stojanow runs fast and brown under the broken bridge. Something large turns over in the current, and is gone.' });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Wilderness (overland stub)
export function buildWilderness() {
  const m = new MapGrid({ id: 'wilderness', name: 'The Moonsea Wilds', kind: 'wilderness', wallSet: 'ruin', outdoors: true, start: { x: 0, y: 7, dir: 'E' } });
  m.tileset = 'wilderness'; // explore falls back to 'ruins'
  m.border(EDGE.WALL, 2);
  m.fill(0, 0, 16, 16, CELL.RUBBLE);
  m.fill(0, 7, 16, 1, CELL.STREET);
  m.fill(9, 10, 5, 4, CELL.WATER);
  for (const [x, y] of [[2, 3], [3, 3], [5, 2], [6, 4], [2, 11], [4, 12], [6, 10], [12, 3], [13, 4], [10, 2], [14, 12]]) pillar(m, x, y, 2);
  m.zone('The River Road', 0, 6, 16, 3);
  m.event({ id: 'wild_wolves', x: 5, y: 7, type: 'encounter', ref: 'wild_wolves', chance: 25 });
  m.event({ id: 'wild_ogres', x: 9, y: 7, type: 'encounter', ref: 'wild_ogres', once: true });
  m.event({ id: 'wild_camp', x: 11, y: 5, type: 'encounter', ref: 'ev_wild_camp' });
  m.event({ id: 'wild_end', x: 14, y: 7, type: 'encounter', ref: 'ev_wild_return', facing: 'E' });
  applyTravel(m);
  return m;
}
