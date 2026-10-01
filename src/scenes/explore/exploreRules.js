import { CELL } from '../../data/maps/MapGrid.js';

/**
 * Small pure helpers for the explore scene (no three.js / DOM, unit-tested).
 */

/**
 * Whether the walking head-bob is on. The settings panel stores it as
 * 'cameraBob' ("Camera motion"); 'headBob' is accepted as a legacy alias.
 * 'reduceMotion' (accessibility) always turns it off. Defaults to on.
 * @param {{get: (k: string) => any}} settings
 */
export function headBobEnabled(settings) {
  if (settings?.get?.('reduceMotion')) return false;
  const v = settings?.get?.('cameraBob');
  if (v !== undefined && v !== null) return !!v;
  const legacy = settings?.get?.('headBob');
  if (legacy !== undefined && legacy !== null) return !!legacy;
  return true;
}

/**
 * Chance of a puddle decal on a floor cell: open street / rubble ground and
 * dungeon stone only — never roofed cells, house boards or interiors.
 * @param {{id: string}} ts tileset
 * @param {{cell: number, covered?: boolean}} fc floor cell
 */
export function puddleChance(ts, fc) {
  if (ts.id === 'interior') return 0;
  if (fc.cell === CELL.WATER) return 0;
  if (ts.id === 'dungeon') return fc.covered && fc.cell === CELL.INTERIOR ? 0.12 : 0.3;
  if (fc.covered || fc.cell === CELL.INTERIOR) return 0;
  if (fc.cell === CELL.STREET) return 0.22;
  if (fc.cell === CELL.RUBBLE) return 0.25;
  return 0;
}

/**
 * A map is a waterfront when at least half of its southern row is water.
 * @param {{w:number, h:number, getCell:(x:number,y:number)=>number, outdoors?:boolean, kind?:string}} map
 */
export function inferHarbour(map) {
  if (map.outdoors === false || map.kind === 'dungeon') return false;
  let n = 0;
  for (let x = 0; x < map.w; x++) if (map.getCell(x, map.h - 1) === CELL.WATER) n++;
  return n >= map.w / 2;
}
