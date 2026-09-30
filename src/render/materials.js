import * as THREE from 'three';
import { getTextureSet } from './textures/index.js';

/**
 * Material library. getMaterial(key) returns a shared (cached) material —
 * never mutate the returned instance; clone() it if you need a variant.
 */
const DEFS = {
  wall_stone: { tex: 'wall_stone', roughness: 1, color: 0xffffff },
  wall_timber: { tex: 'wall_timber', roughness: 1, color: 0xffffff },
  wall_ruin: { tex: 'wall_ruin', roughness: 1, color: 0xffffff },
  floor_cobble: { tex: 'floor_cobble', roughness: 1, color: 0xffffff },
  floor_flag: { tex: 'floor_flag', roughness: 1, color: 0xffffff },
  floor_wood: { tex: 'floor_wood', roughness: 1, color: 0xffffff },
  floor_rubble: { tex: 'floor_rubble', roughness: 1, color: 0xffffff },
  door_wood: { tex: 'door_wood', roughness: 1, color: 0xffffff },
  ceiling_wood: { tex: 'ceiling_wood', roughness: 1, color: 0xbbbbbb },
  iron: { color: 0x3a3a40, roughness: 0.45, metalness: 0.9 },
  gilt: { color: 0xd8b25a, roughness: 0.3, metalness: 1 },
  water_dark: { color: 0x0a1a24, roughness: 0.05, metalness: 0.2 },
};

const cache = new Map();

/** @param {string} key @returns {THREE.MeshStandardMaterial} */
export function getMaterial(key) {
  if (cache.has(key)) return cache.get(key);
  const d = DEFS[key];
  if (!d) throw new Error(`Unknown material "${key}"`);
  const params = { color: d.color ?? 0xffffff, roughness: d.roughness ?? 1, metalness: d.metalness ?? 0 };
  if (d.tex) {
    const t = getTextureSet(d.tex);
    Object.assign(params, { map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap });
  }
  const m = new THREE.MeshStandardMaterial(params);
  m.name = key;
  cache.set(key, m);
  return m;
}

export const MATERIAL_KEYS = Object.keys(DEFS);

/** Wall material per MapGrid edge style index. */
export const WALL_STYLE_MATERIALS = ['wall_stone', 'wall_timber', 'wall_ruin'];
/** Floor material per MapGrid CELL type. */
export const FLOOR_MATERIALS = ['floor_cobble', 'floor_wood', 'floor_rubble', 'water_dark', 'floor_flag'];
