import * as THREE from 'three';
import { materialCanvases } from './canvas.js';
import * as G from './generators.js';

/**
 * Procedural texture library entry point.
 *   getTextureSet('wall_stone') → {map, normalMap, roughnessMap}
 * Generated once per session and cached. Sizes are powers of two; keep total
 * generation time < ~1.5s on SwiftShader (it's CPU JS, not GPU).
 */
export const TEXTURE_DEFS = {
  wall_stone: { size: 512, gen: () => G.stoneBlocks({ seed: 11 }), normalStrength: 3 },
  wall_timber: { size: 512, gen: () => G.timberPlaster({ seed: 12 }), normalStrength: 2 },
  wall_ruin: { size: 512, gen: () => G.ruinStone({ seed: 13 }), normalStrength: 3 },
  floor_cobble: { size: 512, gen: () => G.cobbles({ seed: 14 }), normalStrength: 4 },
  floor_flag: { size: 512, gen: () => G.flagstones({ seed: 15 }), normalStrength: 3 },
  floor_wood: { size: 256, gen: () => G.planks({ seed: 16 }), normalStrength: 2 },
  floor_rubble: { size: 256, gen: () => G.rubbleGround({ seed: 17 }), normalStrength: 3 },
  door_wood: { size: 256, gen: () => G.planks({ seed: 18, count: 4, vertical: true, base: [0.32, 0.19, 0.1], studs: true }), normalStrength: 3 },
  ceiling_wood: { size: 256, gen: () => G.planks({ seed: 19, count: 6, base: [0.22, 0.14, 0.08] }), normalStrength: 2 },
};

const cache = new Map();

/**
 * @param {string} name key of TEXTURE_DEFS
 * @param {{anisotropy?: number, repeat?: [number, number]}} [opts]
 * @returns {{map: THREE.Texture, normalMap: THREE.Texture, roughnessMap: THREE.Texture}}
 */
export function getTextureSet(name, opts = {}) {
  if (cache.has(name)) return cache.get(name);
  const def = TEXTURE_DEFS[name];
  if (!def) throw new Error(`Unknown texture set "${name}"`);
  const { color, normal, rough } = materialCanvases(def.size, def.gen(), { normalStrength: def.normalStrength });
  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = opts.anisotropy ?? 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const set = { map: mk(color, true), normalMap: mk(normal, false), roughnessMap: mk(rough, false) };
  cache.set(name, set);
  return set;
}

/** Dispose everything (e.g. on context loss). */
export function disposeTextures() {
  for (const set of cache.values()) for (const t of Object.values(set)) t.dispose();
  cache.clear();
}

/** Canvas-drawn radial glow sprite texture (for flames, motes, magic). */
let glowTex = null;
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
