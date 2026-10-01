import { EDGE, DIRS } from './MapGrid.js';
import { TRAVEL } from '../travel.js';

/**
 * Map-building helpers shared by the block builders.
 *
 * City blocks start open and add buildings (MapGrid.building); dungeons and
 * interiors start solid (every edge a wall) and carve rooms and corridors.
 */

/** Wall every edge of every cell. */
export function solid(m, style = 0) {
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) for (const d of DIRS) m.setEdge(x, y, d, EDGE.WALL, style);
  return m;
}

/** Open every internal edge of a rectangle (room/corridor) and restyle its perimeter. */
export function carve(m, x, y, w, h, style = 0) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (i < x + w - 1) m.setEdge(i, j, 'E', EDGE.OPEN, style);
      if (j < y + h - 1) m.setEdge(i, j, 'S', EDGE.OPEN, style);
    }
  }
  for (let i = x; i < x + w; i++) {
    m.setEdge(i, y, 'N', m.getEdge(i, y, 'N'), style);
    m.setEdge(i, y + h - 1, 'S', m.getEdge(i, y + h - 1, 'S'), style);
  }
  for (let j = y; j < y + h; j++) {
    m.setEdge(x, j, 'W', m.getEdge(x, j, 'W'), style);
    m.setEdge(x + w - 1, j, 'E', m.getEdge(x + w - 1, j, 'E'), style);
  }
  return m;
}

/** A free-standing pillar/obstacle: wall all four sides of one cell. */
export function pillar(m, x, y, style = 0) {
  for (const d of DIRS) m.setEdge(x, y, d, EDGE.WALL, style);
  return m;
}

/** Set one edge (door by default). */
export function door(m, x, y, dir, type = EDGE.DOOR, style = 0) {
  m.setEdge(x, y, dir, type, style);
  return m;
}

/**
 * Install the travel links leaving this map (data/travel.js): an 'encounter'
 * event that opens the travel prompt when the party faces the way out, an
 * arch in the border for edge exits, and a MapGrid exit record.
 */
export function applyTravel(m) {
  for (const t of TRAVEL) {
    if (t.from !== m.id) continue;
    const { x, y, facing } = t.at;
    m.event({ id: `go_${t.id}`, x, y, type: 'encounter', ref: `go_${t.id}`, facing });
    if (t.edge) {
      m.setEdge(x, y, facing, EDGE.ARCH, m.getEdgeStyle(x, y, facing));
      m.exits.push({ x, y, dir: facing, to: t.to.map, tx: t.to.x, ty: t.to.y, tdir: t.to.dir });
    }
  }
  return m;
}

/** Carved inscription over a door/arch: the explore renderer draws quoted sign text as a plaque. */
export function sign(m, id, x, y, text) {
  return m.event({ id, x, y, type: 'sign', text });
}
