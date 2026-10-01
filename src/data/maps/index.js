import { buildPhlanSlums } from './phlan_slums.js';
import { buildPhlanCivilized } from './phlan_civilized.js';
import { buildSokolKeep, buildKutosWell, buildPodolPlaza, buildValhingen, buildStojanowGate, buildWilderness } from './ruins.js';
import { buildMendorsLibrary, buildCadornaTextile } from './interiors.js';
import { buildKutosWarrens, buildTempleBane, buildValjevoCastle, buildPoolPyramid } from './dungeons.js';

/**
 * Map registry. Maps are built lazily from builder functions and cached.
 * Each block sets `tileset` ('city' | 'ruins' | 'dungeon' | 'interior', plus
 * 'graveyard' / 'wilderness' which renderers may map to their closest set).
 */
const BUILDERS = {
  phlan_civilized: buildPhlanCivilized,
  phlan_slums: buildPhlanSlums,
  sokol_keep: buildSokolKeep,
  kutos_well: buildKutosWell,
  kutos_warrens: buildKutosWarrens,
  podol_plaza: buildPodolPlaza,
  mendors_library: buildMendorsLibrary,
  cadorna_textile: buildCadornaTextile,
  valhingen_graveyard: buildValhingen,
  temple_bane: buildTempleBane,
  valjevo_castle: buildValjevoCastle,
  stojanow_gate: buildStojanowGate,
  pool_pyramid: buildPoolPyramid,
  wilderness: buildWilderness,
};

const cache = new Map();

/** @param {string} id @returns {import('./MapGrid.js').MapGrid} */
export function getMap(id) {
  if (!cache.has(id)) {
    const b = BUILDERS[id];
    if (!b) throw new Error(`Unknown map "${id}"`);
    cache.set(id, b());
  }
  return cache.get(id);
}

export function hasMap(id) {
  return id in BUILDERS;
}

export const MAP_IDS = Object.keys(BUILDERS);
