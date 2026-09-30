import { buildPhlanSlums } from './phlan_slums.js';

/**
 * Map registry. Maps are built lazily from builder functions and cached.
 * World-content agents: add `id: builderFn` entries here.
 */
const BUILDERS = {
  phlan_slums: buildPhlanSlums,
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
