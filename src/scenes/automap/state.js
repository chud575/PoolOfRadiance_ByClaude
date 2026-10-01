import { getMap, hasMap } from '../../data/maps/index.js';
import { DIRS } from '../../data/maps/MapGrid.js';
import { analyseMap } from './BlockSheet.js';

/**
 * Automap state helpers over GameState: exploration queries, found secrets,
 * player notes (stored in game.flags.automapNotes so they save with the game)
 * and a deterministic demo exploration for debug screenshots.
 */

export function foundSecrets(game, mapId) {
  const prefix = `${mapId}:`;
  return new Set((game.flags.secrets ?? []).filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length)));
}

/** @returns {{x:number,y:number,kind:string,text:string}[]} */
export function notesFor(game, mapId) {
  const all = (game.flags.automapNotes ??= {});
  return (all[mapId] ??= []);
}

export function setNote(game, mapId, note) {
  const list = notesFor(game, mapId);
  const i = list.findIndex((n) => n.x === note.x && n.y === note.y);
  if (i >= 0) list[i] = note; else list.push(note);
}

export function removeNote(game, mapId, x, y) {
  const list = notesFor(game, mapId);
  const i = list.findIndex((n) => n.x === x && n.y === y);
  if (i >= 0) list.splice(i, 1);
}

/** Explored fraction of the walkable cells of a map (0..1), and counts. */
export function exploredStats(game, map, reveal = false) {
  const info = analyseMap(map);
  let total = 0;
  let seen = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (info.isRock(x, y)) continue;
    total++;
    if (reveal || game.isExplored(map.id, x, y, map.w)) seen++;
  }
  return { total, seen, frac: total ? seen / total : 0 };
}

/** Breadth-first walk over passable edges (secret doors closed) up to `depth` steps. */
export function walkable(map, sx, sy, depth) {
  const out = new Set([`${sx},${sy}`]);
  let frontier = [[sx, sy]];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const dir of DIRS) {
        const r = map.tryMove(x, y, dir);
        if (!r.ok || r.leaves) continue;
        const key = `${r.nx},${r.ny}`;
        if (out.has(key)) continue;
        out.add(key);
        next.push([r.nx, r.ny]);
      }
    }
    frontier = next;
  }
  return out;
}

function markAll(game, map, cells) {
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number);
    game.markExplored(map.id, x, y, map.w);
  }
}

/**
 * Debug-only: a plausible, deterministic exploration history so screenshots
 * show fog of war, spent encounters, a found secret door and a few notes.
 */
export function applyDemoExploration(game, mapId) {
  const loc = game.location;
  const plan = [
    ['phlan_civilized', 15, 14, 40],
    ['phlan_slums', 0, 14, 0],
    ['podol_plaza', 0, 9, 9],
    ['kutos_well', 13, 15, 7],
    ['sokol_keep', 7, 15, 6],
  ];
  for (const [id, x, y, depth] of plan) {
    if (!hasMap(id)) continue;
    const m = getMap(id);
    if (id === 'phlan_slums') continue;
    markAll(game, m, walkable(m, x, y, depth));
  }
  if (hasMap('phlan_slums')) {
    const m = getMap('phlan_slums');
    // the route a party takes: in at the gate, along the south row, up through the temple court
    const cells = new Set([
      ...walkable(m, 0, 14, 8),
      ...walkable(m, 4, 10, 6),
      ...walkable(m, 7, 9, 3),
      ...walkable(m, 11, 6, 3),
    ]);
    for (let x = 1; x <= 14; x++) cells.add(`${x},15`);
    markAll(game, m, cells);
    Object.assign(game.spentEvents, { slums_kobolds: true, slums_thugs: true, slums_rats: true, slums_skeletons: true, slums_cache: true });
    const secrets = (game.flags.secrets ??= []);
    if (!secrets.includes('phlan_slums:10,13,E')) secrets.push('phlan_slums:10,13,E');
    if (!game.flags.automapNotes?.phlan_slums?.length) {
      setNote(game, 'phlan_slums', { x: 12, y: 8, kind: 'danger', text: 'Locked. Orc voices inside. Bring the thief.' });
      setNote(game, 'phlan_slums', { x: 9, y: 13, kind: 'treasure', text: 'Slumlord\'s strongbox, behind the cushions?' });
      setNote(game, 'phlan_slums', { x: 2, y: 3, kind: 'quest', text: 'Survivor: her family went "to the wall".' });
    }
  }
  if (loc && hasMap(mapId)) {
    const m = getMap(mapId);
    game.markExplored(m.id, loc.x, loc.y, m.w);
  }
}
