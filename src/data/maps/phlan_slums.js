import { MapGrid, EDGE, CELL } from './MapGrid.js';
import { applyTravel } from './helpers.js';

/**
 * The Slums of Phlan — the first ruined block beyond the palisade.
 * Edge styles: 0 = old stone, 1 = timber & plaster, 2 = crumbling ruin.
 * Exits: west gate → New Phlan, north arch → Kuto's Well, east lane → Podol Plaza.
 * Commission: kill the orc Slumlord in the counting-house (south row).
 */
export function buildPhlanSlums() {
  const m = new MapGrid({
    id: 'phlan_slums',
    name: 'The Slums',
    kind: 'city',
    wallSet: 'phlan_stone',
    outdoors: true,
    start: { x: 1, y: 14, dir: 'E' },
  });
  m.tileset = 'city';
  m.border(EDGE.WALL, 0);
  m.fill(0, 0, 16, 16, CELL.STREET);

  m.building(1, 1, 4, 3, { style: 1, doors: [{ x: 2, y: 3, dir: 'S' }] });
  m.building(6, 1, 4, 2, { style: 0, doors: [{ x: 7, y: 2, dir: 'S' }] });
  m.building(11, 1, 4, 4, { style: 1, doors: [{ x: 11, y: 3, dir: 'W' }] });
  m.building(1, 6, 3, 4, { style: 2, cell: CELL.RUBBLE, doors: [{ x: 3, y: 7, dir: 'E' }] });
  // Ruined temple in the courtyard, entered through an arch.
  m.fill(5, 5, 6, 6, CELL.COURTYARD);
  m.building(6, 6, 3, 3, { style: 0, doors: [{ x: 7, y: 8, dir: 'S', type: EDGE.ARCH }] });
  m.building(12, 7, 3, 4, { style: 1, doors: [{ x: 12, y: 8, dir: 'W', type: EDGE.LOCKED }] });
  m.building(1, 12, 4, 2, { style: 1, doors: [{ x: 2, y: 12, dir: 'N' }] });
  // The old counting-house: the Slumlord's lair.
  m.building(6, 12, 5, 3, { style: 0, doors: [{ x: 8, y: 12, dir: 'N' }, { x: 10, y: 13, dir: 'E', type: EDGE.SECRET }] });
  m.building(12, 12, 3, 3, { style: 2, doors: [{ x: 13, y: 12, dir: 'N' }] });
  // Collapsed wall segments out in the street.
  m.setEdge(5, 3, 'E', EDGE.WALL, 2);
  m.setEdge(10, 5, 'S', EDGE.WALL, 2);

  m.zone('Ruined Temple of Tyr', 5, 5, 6, 6);
  m.zone('Collapsed Tenements', 1, 6, 3, 4);
  m.zone('The Old Counting-House', 6, 12, 5, 3);
  m.zone('Slum Gate', 0, 13, 2, 3);

  m.event({ id: 'slums_sign', x: 7, y: 9, type: 'sign', text: 'Weathered letters above the arch read: "TYR JUDGES ALL". The temple beyond lies in ruin.' });
  m.event({ id: 'slums_kobolds', x: 5, y: 14, type: 'encounter', ref: 'kobolds_1', once: true });
  m.event({ id: 'slums_rats', x: 2, y: 7, type: 'encounter', ref: 'rats_1', once: true });
  m.event({ id: 'slums_skeletons', x: 7, y: 7, type: 'encounter', ref: 'skeletons_1', once: true });
  m.event({ id: 'slums_shrine', x: 7, y: 6, type: 'encounter', ref: 'ev_slums_shrine' });
  m.event({ id: 'slums_survivor', x: 2, y: 3, type: 'encounter', ref: 'ev_slums_survivor', once: true });
  m.event({ id: 'slums_goblins', x: 7, y: 1, type: 'encounter', ref: 'slums_goblins', once: true });
  m.event({ id: 'slums_overheard', x: 11, y: 6, type: 'encounter', ref: 'ev_slums_overheard', once: true });
  m.event({ id: 'slums_thugs', x: 4, y: 11, type: 'encounter', ref: 'thugs_1', once: true });
  m.event({ id: 'slums_boss', x: 8, y: 12, type: 'encounter', ref: 'ev_slums_boss_door' });
  m.event({ id: 'slums_rats_wander', x: 10, y: 10, type: 'encounter', ref: 'rats_1', chance: 12 });
  m.event({ id: 'slums_cache', x: 13, y: 13, type: 'treasure', text: 'Beneath a loose flagstone you find a small purse.', once: true, gold: 35 });
  m.event({ id: 'slums_hoard', x: 9, y: 14, type: 'treasure', text: 'Behind the Slumlord\'s cushions: a strongbox of stolen coin.', once: true, gold: 180 });
  m.event({ id: 'slums_tenement_note', x: 12, y: 3, type: 'text', text: 'Scratched into the plaster above a child\'s bed: WE WENT TO THE WALL. COME FIND US.' });
  applyTravel(m);
  return m;
}
