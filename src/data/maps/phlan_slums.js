import { MapGrid, EDGE, CELL } from './MapGrid.js';

/**
 * The Slums of Phlan — first ruined block north of civilized Phlan.
 * Seed layout for the vertical slice; world-content agents own and expand it.
 * Edge styles: 0 = old stone, 1 = timber & plaster, 2 = crumbling ruin.
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
  m.building(6, 12, 5, 3, { style: 0, doors: [{ x: 8, y: 12, dir: 'N' }, { x: 10, y: 13, dir: 'E', type: EDGE.SECRET }] });
  m.building(12, 12, 3, 3, { style: 2, doors: [{ x: 13, y: 12, dir: 'N' }] });
  // Collapsed wall segments out in the street.
  m.setEdge(5, 3, 'E', EDGE.WALL, 2);
  m.setEdge(10, 5, 'S', EDGE.WALL, 2);
  // Gate back to civilized Phlan (west edge).
  m.setEdge(0, 14, 'W', EDGE.ARCH, 0);
  m.exits.push({ x: 0, y: 14, dir: 'W', to: 'phlan_civilized', tx: 15, ty: 14, tdir: 'W' });

  m.zone('Ruined Temple of Tyr', 5, 5, 6, 6);
  m.zone('Collapsed Tenements', 1, 6, 3, 4);

  m.event({ id: 'slums_sign', x: 7, y: 9, type: 'sign', text: 'Weathered letters above the arch read: "TYR JUDGES ALL". The temple beyond lies in ruin.' });
  m.event({ id: 'slums_kobolds', x: 5, y: 14, type: 'encounter', ref: 'kobolds_1', once: true });
  m.event({ id: 'slums_rats', x: 2, y: 7, type: 'encounter', ref: 'rats_1', once: true });
  m.event({ id: 'slums_skeletons', x: 7, y: 7, type: 'encounter', ref: 'skeletons_1', once: true });
  m.event({ id: 'slums_armory', x: 7, y: 1, type: 'shop', ref: 'phlan_armory' });
  m.event({ id: 'slums_cache', x: 13, y: 13, type: 'treasure', text: 'Beneath a loose flagstone you find a small purse.', once: true, gold: 35 });
  m.event({ id: 'slums_exit', x: 0, y: 14, type: 'exit', ref: 'phlan_civilized', facing: 'W', text: 'The gate to Civilized Phlan.' });
  return m;
}
