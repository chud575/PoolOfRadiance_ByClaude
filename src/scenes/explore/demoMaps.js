import { MapGrid, EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';

/**
 * Tileset showcase maps used by the explore gallery shots (explore_dungeon,
 * explore_interior). They are only used when the requested map id is not in
 * the content registry, so the world-content agent's real maps always win.
 */

function solid(m, style = 0) {
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) for (const d of DIRS) m.setEdge(x, y, d, EDGE.WALL, style);
}
/** Open every internal edge of a rectangle (a room or corridor). */
function carve(m, x, y, w, h, style = 0) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (i < x + w - 1) m.setEdge(i, j, 'E', EDGE.OPEN, style);
      if (j < y + h - 1) m.setEdge(i, j, 'S', EDGE.OPEN, style);
    }
  }
  // restyle the perimeter
  for (let i = x; i < x + w; i++) {
    m.setEdge(i, y, 'N', m.getEdge(i, y, 'N'), style);
    m.setEdge(i, y + h - 1, 'S', m.getEdge(i, y + h - 1, 'S'), style);
  }
  for (let j = y; j < y + h; j++) {
    m.setEdge(x, j, 'W', m.getEdge(x, j, 'W'), style);
    m.setEdge(x + w - 1, j, 'E', m.getEdge(x + w - 1, j, 'E'), style);
  }
}

export function buildDemoDungeon() {
  const m = new MapGrid({ id: 'demo_dungeon', name: 'Catacombs beneath Phlan', kind: 'dungeon', outdoors: false, wallSet: 'dungeon', start: { x: 2, y: 7, dir: 'E' } });
  m.tileset = 'dungeon';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 0);
  carve(m, 1, 7, 7, 1, 0); // long gallery
  carve(m, 2, 2, 4, 4, 0); // guard room
  carve(m, 3, 6, 1, 1, 0);
  m.setEdge(3, 5, 'S', EDGE.DOOR, 0);
  m.setEdge(3, 6, 'S', EDGE.OPEN, 0);
  carve(m, 8, 5, 6, 6, 1); // brick crypt hall
  m.setEdge(7, 7, 'E', EDGE.DOOR, 0);
  // crypt piers
  for (const [x, y] of [[9, 6], [12, 6], [9, 9], [12, 9]]) for (const d of DIRS) m.setEdge(x, y, d, EDGE.WALL, 1);
  carve(m, 5, 8, 1, 5, 2); // collapsed cave passage
  m.setEdge(5, 7, 'S', EDGE.ARCH, 0);
  carve(m, 2, 12, 3, 2, 2);
  m.setEdge(4, 12, 'E', EDGE.OPEN, 2);
  m.zone('The Long Gallery', 1, 7, 7, 1);
  m.zone('Crypt of the Lost', 8, 5, 6, 6);
  return m;
}

export function buildDemoInterior() {
  const m = new MapGrid({ id: 'demo_interior', name: 'The Laughing Beholder', kind: 'city', outdoors: false, wallSet: 'interior', start: { x: 2, y: 2, dir: 'N' } });
  m.tileset = 'interior';
  m.fill(0, 0, 16, 16, CELL.INTERIOR);
  solid(m, 0);
  carve(m, 0, 0, 5, 3, 0); // common room
  carve(m, 5, 0, 3, 3, 1); // panelled snug
  m.setEdge(4, 1, 'E', EDGE.DOOR, 0);
  carve(m, 0, 4, 9, 1, 0); // passage
  m.setEdge(2, 2, 'S', EDGE.ARCH, 0);
  m.setEdge(2, 3, 'S', EDGE.OPEN, 0);
  carve(m, 2, 3, 1, 1, 0);
  carve(m, 0, 5, 3, 3, 2); // cellar stair room
  m.setEdge(1, 4, 'S', EDGE.DOOR, 2);
  m.zone('Common Room', 0, 0, 5, 3);
  m.hearth = { x: 0, y: 1, dir: 'W' };
  return m;
}

const DEMO = { demo_dungeon: buildDemoDungeon, demo_interior: buildDemoInterior };
const cache = new Map();
export function hasDemoMap(id) {
  return id in DEMO;
}
export function getDemoMap(id) {
  if (!cache.has(id)) cache.set(id, DEMO[id]());
  return cache.get(id);
}
