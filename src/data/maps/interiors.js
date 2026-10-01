import { MapGrid, EDGE, CELL } from './MapGrid.js';
import { applyTravel, solid, carve, pillar, door } from './helpers.js';

/**
 * Roofed blocks: Mendor's Library and the Cadorna Textile House.
 * Interior edge styles: 0 = plaster, 1 = panelling, 2 = bare stone.
 */

// ------------------------------------------------------------------ Mendor's Library
export function buildMendorsLibrary() {
  const m = new MapGrid({ id: 'mendors_library', name: "Mendor's Library", kind: 'city', wallSet: 'interior', outdoors: false, start: { x: 7, y: 15, dir: 'N' } });
  m.tileset = 'interior';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 1);
  carve(m, 6, 11, 3, 5, 2); // entrance hall
  carve(m, 3, 5, 10, 6, 1); // great reading hall
  door(m, 7, 11, 'N', EDGE.ARCH, 1);
  // Book-stacks: free-standing shelving runs down the hall.
  for (const y of [6, 8]) for (const x of [4, 5, 10, 11]) pillar(m, x, y, 1);
  carve(m, 13, 2, 2, 10, 1); // east gallery
  door(m, 12, 7, 'E', EDGE.DOOR, 1);
  carve(m, 1, 5, 2, 7, 2); // burnt west wing
  door(m, 3, 9, 'W', EDGE.DOOR, 2);
  m.fill(1, 5, 2, 7, CELL.RUBBLE);
  carve(m, 6, 1, 4, 3, 0); // warded reading room
  door(m, 7, 4, 'S', EDGE.OPEN, 0);
  carve(m, 7, 4, 1, 1, 0);
  door(m, 7, 4, 'N', EDGE.ARCH, 0);
  door(m, 7, 4, 'S', EDGE.ARCH, 1);
  carve(m, 1, 1, 3, 4, 2); // scriptorium (secret)
  door(m, 2, 4, 'S', EDGE.SECRET, 2);
  m.hearths = [{ x: 3, y: 10, dir: 'S' }];
  m.zone('Entrance Hall', 6, 11, 3, 5);
  m.zone('The Great Reading Hall', 3, 5, 10, 6);
  m.zone('East Gallery', 13, 2, 2, 10);
  m.zone('The Burnt Wing', 1, 5, 2, 7);
  m.zone('Warded Reading Room', 6, 1, 4, 3);
  m.zone('Scriptorium', 1, 1, 3, 4);

  m.event({ id: 'lib_page', x: 4, y: 10, type: 'encounter', ref: 'ev_library_page', once: true });
  m.event({ id: 'lib_gnolls', x: 7, y: 9, type: 'encounter', ref: 'library_gnolls', once: true });
  m.event({ id: 'lib_ghouls', x: 1, y: 6, type: 'encounter', ref: 'library_ghouls', once: true });
  m.event({ id: 'lib_spider', x: 13, y: 9, type: 'encounter', ref: 'library_spider', once: true });
  m.event({ id: 'lib_ione', x: 7, y: 3, type: 'encounter', ref: 'ev_library_ione' });
  m.event({ id: 'lib_portrait', x: 14, y: 3, type: 'encounter', ref: 'ev_library_portrait', facing: 'E' });
  m.event({ id: 'lib_scriptorium', x: 2, y: 1, type: 'treasure', text: 'In the scriptorium\'s strong-cupboard: inks, gold leaf, and a sealed scroll-case.', once: true, gold: 140 });
  m.event({ id: 'lib_entry', x: 7, y: 13, type: 'text', text: 'Dust and silence, and the smell of old paper and old smoke. Somewhere deeper in, something is turning pages.' });
  applyTravel(m);
  return m;
}

// ------------------------------------------------------------------ Cadorna Textile House
export function buildCadornaTextile() {
  const m = new MapGrid({ id: 'cadorna_textile', name: 'Cadorna Textile House', kind: 'city', wallSet: 'interior', outdoors: false, start: { x: 0, y: 7, dir: 'E' } });
  m.tileset = 'interior';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 2);
  carve(m, 0, 5, 4, 5, 2); // loading bay
  carve(m, 5, 2, 7, 11, 1); // weaving hall
  door(m, 3, 7, 'E', EDGE.OPEN, 2);
  carve(m, 4, 7, 1, 1, 2);
  door(m, 4, 7, 'E', EDGE.ARCH, 1);
  // Looms stand in rows.
  for (const y of [4, 7, 10]) for (const x of [6, 8, 10]) pillar(m, x, y, 1);
  carve(m, 12, 9, 3, 5, 2); // dye-house
  m.fill(13, 11, 2, 3, CELL.WATER);
  door(m, 11, 10, 'E', EDGE.DOOR, 2);
  carve(m, 12, 1, 3, 5, 0); // counting-room
  door(m, 11, 3, 'E', EDGE.DOOR, 0);
  carve(m, 6, 13, 4, 2, 2); // cellar passage
  door(m, 7, 12, 'S', EDGE.SECRET, 1);
  m.hearths = [{ x: 14, y: 3, dir: 'E' }];
  m.zone('Loading Bay', 0, 5, 4, 5);
  m.zone('The Weaving Hall', 5, 2, 7, 11);
  m.zone('Dye-House', 12, 9, 3, 5);
  m.zone('Counting-Room', 12, 1, 3, 5);

  m.event({ id: 'tex_rats', x: 7, y: 11, type: 'encounter', ref: 'textile_rats', once: true });
  m.event({ id: 'tex_lizards', x: 12, y: 11, type: 'encounter', ref: 'textile_lizardmen', once: true });
  m.event({ id: 'tex_troll', x: 12, y: 3, type: 'encounter', ref: 'textile_trolls', once: true });
  m.event({ id: 'tex_box', x: 13, y: 2, type: 'encounter', ref: 'ev_textile_box' });
  m.event({ id: 'tex_cellar', x: 8, y: 14, type: 'treasure', text: 'Bolts of cloth-of-gold, wrapped in oilskin, worth a small fortune even now.', once: true, gold: 240 });
  m.event({ id: 'tex_bay', x: 1, y: 7, type: 'text', text: 'Bales of wool rot where they were dropped. The loading doors were chained from within — someone meant to keep something in.' });
  applyTravel(m);
  return m;
}
