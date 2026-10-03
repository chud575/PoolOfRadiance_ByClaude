import { MapGrid, EDGE, CELL } from './MapGrid.js';
import { applyTravel, solid, carve, pillar, door, hiddenRoom } from './helpers.js';

/**
 * Underground and fortress blocks. Dungeon edge styles: 0 = cut stone,
 * 1 = brick, 2 = natural cave.
 */

// ------------------------------------------------------------------ Kuto's Warrens
export function buildKutosWarrens() {
  const m = new MapGrid({ id: 'kutos_warrens', name: "Kuto's Warrens", kind: 'dungeon', wallSet: 'dungeon', outdoors: false, start: { x: 7, y: 13, dir: 'N' } });
  m.tileset = 'dungeon';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 2);
  carve(m, 6, 12, 3, 3, 0); // well-shaft chamber
  m.setCell(7, 14, CELL.INTERIOR);
  carve(m, 7, 5, 1, 7, 2); // north tunnel
  door(m, 7, 11, 'S', EDGE.OPEN, 2);
  carve(m, 9, 3, 6, 6, 2); // flooded cavern
  m.fill(11, 5, 3, 3, CELL.WATER);
  carve(m, 8, 6, 1, 1, 2);
  door(m, 7, 6, 'E', EDGE.OPEN, 2);
  door(m, 8, 6, 'E', EDGE.OPEN, 2);
  carve(m, 1, 1, 5, 5, 1); // kobold throne-hall
  carve(m, 6, 3, 1, 1, 2);
  door(m, 5, 3, 'E', EDGE.OPEN, 2);
  door(m, 6, 3, 'E', EDGE.OPEN, 2);
  door(m, 7, 5, 'N', EDGE.OPEN, 2);
  carve(m, 7, 3, 1, 2, 2);
  carve(m, 1, 8, 4, 5, 2); // centipede nest
  carve(m, 5, 9, 2, 1, 2);
  door(m, 4, 9, 'E', EDGE.OPEN, 2);
  door(m, 6, 9, 'E', EDGE.OPEN, 2);
  m.zone('The Well-Shaft', 6, 12, 3, 3);
  m.zone('Flooded Cavern', 9, 3, 6, 6);
  m.zone('Throne of Doors', 1, 1, 5, 5);
  m.zone('The Nest', 1, 8, 4, 5);
  m.event({ id: 'warrens_chief', x: 3, y: 3, type: 'encounter', ref: 'ev_well_chief' });
  m.event({ id: 'warrens_frogs', x: 10, y: 5, type: 'encounter', ref: 'well_frogs', once: true });
  m.event({ id: 'warrens_centipedes', x: 3, y: 10, type: 'encounter', ref: 'well_centipedes', once: true });
  m.event({ id: 'warrens_hoard', x: 1, y: 1, type: 'treasure', text: 'The kobolds\' hoard: buttons, spoons, a crown of tin — and a surprising amount of real silver.', once: true, gold: 110 });
  m.event({ id: 'warrens_nest', x: 1, y: 12, type: 'treasure', text: 'Among the husks, the remains of an earlier adventurer and his purse.', once: true, gold: 65 });
  // the chieftain's bolt-hole: a crawl from the well-shaft to a dry chamber
  carve(m, 9, 13, 2, 1, 2);
  hiddenRoom(m, { id: 'warrens_bolthole', room: [11, 12, 3, 2], door: [8, 13, 'E'], carveIt: true, style: 2, at: [13, 12],
    note: 'The kobolds\' bolt-hole: a low chamber scratched with their marks, where the chief kept what he would not share.',
    text: 'The chieftain\'s private hoard: a silver cup, a lady\'s brooch, and coins in a boot.', gold: 95 });
  door(m, 10, 13, 'E', EDGE.OPEN, 2);
  // Traps (rules resolveTrap via triggerMapTrap; state in game.flags.traps).
  m.event({ id: 'warrens_darts', x: 7, y: 8, type: 'trap', trap: 'dartVolley', avoidable: true, text: 'Kobold darts hiss from holes bored in the tunnel wall.' });
  m.event({ id: 'warrens_pit', x: 5, y: 9, type: 'trap', trap: 'pit', avoidable: true, text: 'The packed earth gives way: a kobold pit, stakes at the bottom.' });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Temple of Bane
export function buildTempleBane() {
  const m = new MapGrid({ id: 'temple_bane', name: 'Temple of Bane', kind: 'dungeon', wallSet: 'dungeon', outdoors: false, start: { x: 7, y: 15, dir: 'N' } });
  m.tileset = 'dungeon';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 0);
  carve(m, 7, 8, 1, 8, 0); // processional
  carve(m, 4, 1, 8, 6, 1); // sanctum
  door(m, 7, 7, 'N', EDGE.DOOR, 0);
  carve(m, 7, 7, 1, 1, 0);
  door(m, 7, 7, 'S', EDGE.OPEN, 0);
  for (const [x, y] of [[5, 2], [10, 2], [5, 5], [10, 5]]) pillar(m, x, y, 1);
  carve(m, 1, 8, 3, 6, 2); // ossuary
  door(m, 6, 10, 'E', EDGE.OPEN, 0);
  carve(m, 4, 10, 3, 1, 0);
  door(m, 3, 10, 'E', EDGE.DOOR, 0);
  carve(m, 12, 8, 3, 4, 1); // treasury
  carve(m, 8, 9, 4, 1, 0);
  door(m, 7, 9, 'E', EDGE.OPEN, 0);
  door(m, 11, 9, 'E', EDGE.SECRET, 1);
  m.zone('The Processional', 7, 8, 1, 8);
  m.zone('Sanctum of the Black Hand', 4, 1, 8, 6);
  m.zone('Ossuary', 1, 8, 3, 6);
  m.zone('Treasury', 12, 8, 3, 4);
  m.event({ id: 'bane_acolytes', x: 7, y: 10, type: 'encounter', ref: 'bane_acolytes', once: true });
  m.event({ id: 'bane_altar', x: 7, y: 3, type: 'encounter', ref: 'ev_bane_altar' });
  m.event({ id: 'bane_ossuary', x: 2, y: 11, type: 'encounter', ref: 'grave_zombies', once: true });
  m.event({ id: 'bane_treasury', x: 13, y: 9, type: 'treasure', text: 'The tithes of the Black Hand: coin from a dozen cities, and every piece stamped with a black thumbprint.', once: true, gold: 600 });
  m.event({ id: 'bane_stair', x: 7, y: 14, type: 'text', text: 'Green light seeps up the stair, and with it a low chanting, many voices speaking as one.' });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Valjevo Castle
export function buildValjevoCastle() {
  const m = new MapGrid({ id: 'valjevo_castle', name: 'Valjevo Castle', kind: 'dungeon', wallSet: 'dungeon', outdoors: false, start: { x: 7, y: 15, dir: 'N' } });
  m.tileset = 'dungeon';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 1);
  carve(m, 6, 11, 3, 5, 1); // gatehall
  carve(m, 2, 7, 12, 4, 0); // great hall
  door(m, 7, 11, 'N', EDGE.DOOR, 1);
  for (const x of [4, 7, 10]) pillar(m, x, 9, 0);
  carve(m, 4, 1, 8, 5, 1); // throne room
  door(m, 7, 6, 'S', EDGE.DOOR, 1);
  carve(m, 7, 6, 1, 1, 1);
  door(m, 7, 5, 'S', EDGE.OPEN, 1);
  carve(m, 12, 12, 3, 3, 2); // dungeon cells
  door(m, 12, 10, 'S', EDGE.DOOR, 2);
  carve(m, 12, 11, 1, 1, 2);
  door(m, 12, 11, 'S', EDGE.OPEN, 2);
  carve(m, 1, 12, 3, 3, 1); // armoury
  door(m, 2, 10, 'S', EDGE.DOOR, 1);
  carve(m, 2, 11, 1, 1, 1);
  door(m, 2, 11, 'S', EDGE.OPEN, 1);
  m.hearths = [{ x: 2, y: 8, dir: 'W' }];
  m.zone('Gatehall', 6, 11, 3, 5);
  m.zone('The Great Hall', 2, 7, 12, 4);
  m.zone('Throne Room', 4, 1, 8, 5);
  m.zone('Dungeons', 12, 11, 3, 4);
  m.zone('Armoury', 1, 11, 3, 4);
  m.event({ id: 'valjevo_hobs', x: 7, y: 10, type: 'encounter', ref: 'valjevo_hobgoblins', once: true });
  m.event({ id: 'valjevo_ogres', x: 3, y: 8, type: 'encounter', ref: 'valjevo_ogres', once: true });
  m.event({ id: 'valjevo_throne', x: 7, y: 3, type: 'encounter', ref: 'ev_valjevo_throne' });
  m.event({ id: 'valjevo_prisoner', x: 13, y: 13, type: 'encounter', ref: 'ev_valjevo_prisoner' });
  m.event({ id: 'valjevo_armoury', x: 1, y: 13, type: 'treasure', text: 'Racks of black-lacquered hobgoblin arms, and a paymaster\'s coffer.', once: true, gold: 400 });
  // the warlord's privy chamber behind the throne-room tapestry
  hiddenRoom(m, { id: 'valjevo_privy', room: [12, 2, 2, 2], door: [11, 2, 'E'], carveIt: true, style: 1, at: [13, 3],
    note: 'Behind the tapestry of the Valjevo hunt, a narrow door. The warlord kept his own counsel here — and his own coin.',
    text: 'The warlord\'s privy chest: his share of every raid on the river road.', gold: 320 });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ The Pool of Radiance
export function buildPoolPyramid() {
  const m = new MapGrid({ id: 'pool_pyramid', name: 'The Pool of Radiance', kind: 'dungeon', wallSet: 'dungeon', outdoors: false, start: { x: 7, y: 15, dir: 'N' } });
  m.tileset = 'dungeon';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 0);
  carve(m, 7, 9, 1, 7, 0); // the long stair
  carve(m, 3, 1, 10, 8, 0); // chamber of the Pool
  door(m, 7, 8, 'S', EDGE.ARCH, 0);
  m.fill(6, 2, 4, 4, CELL.WATER);
  for (const [x, y] of [[4, 2], [11, 2], [4, 6], [11, 6]]) pillar(m, x, y, 1);
  m.zone('The Long Stair', 7, 9, 1, 7);
  m.zone('The Pool of Radiance', 3, 1, 10, 8);
  m.event({ id: 'pool_guardians', x: 7, y: 11, type: 'encounter', ref: 'pool_guardians', once: true });
  m.event({ id: 'pool_pool', x: 7, y: 6, type: 'encounter', ref: 'ev_pool', facing: 'N' });
  m.event({ id: 'pool_pool2', x: 8, y: 6, type: 'encounter', ref: 'ev_pool', facing: 'N' });
  m.event({ id: 'pool_light', x: 7, y: 9, type: 'text', text: 'The light ahead is golden and cold, and it moves on the walls like sunlight through water.' });
  // the offering-niche of the drowned, off the long stair
  carve(m, 4, 12, 3, 1, 0);
  hiddenRoom(m, { id: 'pool_offerings', room: [1, 11, 3, 3], door: [6, 12, 'E'], carveIt: true, style: 0, at: [1, 12],
    note: 'A seam in the stair wall gives under your hand. Beyond, a passage leads to a chamber heaped with offerings.',
    text: 'Offerings left by those who came to bathe in the Pool and did not come back: rings, coin, a child\'s wooden horse.', gold: 260 });
  door(m, 3, 12, 'E', EDGE.OPEN, 0);
  applyTravel(m);
  return m;
}
