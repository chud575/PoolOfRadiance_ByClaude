import * as THREE from 'three';
import { fbm, worley, valueNoise, hash2, smooth, clamp01, lerp } from '../../../render/textures/noise.js';

/**
 * Procedural detail textures for combat models (neutral albedo, tinted per
 * material via .color) plus a PBR material factory. Generated once, cached.
 */
const GEN = {
  cloth: () => (u, v) => {
    const f = 32;
    const wx = Math.sin(u * f * Math.PI * 2) * 0.5 + 0.5;
    const wy = Math.sin(v * f * Math.PI * 2) * 0.5 + 0.5;
    const over = (Math.floor(u * f) + Math.floor(v * f)) % 2;
    const thread = over ? wx : wy;
    const n = fbm(u * 6, v * 6, { octaves: 4, period: 6, seed: 3 });
    const stain = smooth(0.55, 0.8, fbm(u * 3, v * 3, { octaves: 3, period: 3, seed: 9 }));
    const g = (0.72 + thread * 0.18 + (n - 0.5) * 0.25) * (1 - stain * 0.25);
    return { c: [g, g, g], h: thread * 0.6 + n * 0.3, r: 0.92 };
  },
  leather: () => (u, v) => {
    const w = worley(u * 18, v * 18, 18, 5);
    const n = fbm(u * 5, v * 5, { octaves: 5, period: 5, seed: 7 });
    const crease = smooth(0.0, 0.08, w.f2 - w.f1);
    const scuff = smooth(0.6, 0.85, fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: 21 }));
    const g = (0.55 + n * 0.35) * lerp(0.8, 1, crease) + scuff * 0.2;
    return { c: [g, g * 0.97, g * 0.94], h: crease * 0.5 + n * 0.4, r: lerp(0.75, 0.45, scuff) };
  },
  chain: () => (u, v) => {
    const f = 22;
    const row = Math.floor(v * f);
    const uu = u * f + (row % 2) * 0.5;
    const fx = uu - Math.floor(uu) - 0.5;
    const fy = v * f - row - 0.5;
    const d = Math.hypot(fx, fy * 1.25);
    const ring = 1 - smooth(0.06, 0.16, Math.abs(d - 0.36));
    const n = valueNoise(u * 40, v * 40, 40, 11);
    const rust = smooth(0.62, 0.8, fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: 12 }));
    const g = ring ? 0.55 + ring * 0.4 + n * 0.1 : 0.05;
    const c = [lerp(g, 0.35, rust * 0.6), lerp(g, 0.2, rust * 0.6), lerp(g, 0.1, rust * 0.6)];
    return { c, h: ring * (0.7 + n * 0.3), r: ring ? lerp(0.35, 0.85, rust) : 1 };
  },
  metal: () => (u, v) => {
    const brush = valueNoise(u * 3, v * 220, 220, 4) * 0.5 + valueNoise(u * 7, v * 400, 400, 5) * 0.5;
    const n = fbm(u * 4, v * 4, { octaves: 5, period: 4, seed: 6 });
    let scratch = 0;
    for (let i = 0; i < 3; i++) {
      const a = hash2(i, 1, 33) * Math.PI;
      const p = (u * Math.cos(a) + v * Math.sin(a)) * (6 + i * 5);
      scratch = Math.max(scratch, 1 - smooth(0, 0.015, Math.abs(p - Math.round(p))) * (valueNoise(u * 9, v * 9, 9, i + 40) > 0.6 ? 1 : 0));
    }
    const dirt = smooth(0.55, 0.85, n);
    const g = 0.78 + brush * 0.12 - dirt * 0.35 + scratch * 0.1;
    return { c: [g, g, g], h: n * 0.3 - scratch * 0.2, r: clamp01(0.28 + brush * 0.12 + dirt * 0.45 - scratch * 0.1) };
  },
  skin: () => (u, v) => {
    const n = fbm(u * 5, v * 5, { octaves: 5, period: 5, seed: 17 });
    const pores = valueNoise(u * 120, v * 120, 120, 18);
    const blotch = fbm(u * 2, v * 2, { octaves: 3, period: 2, seed: 19 });
    const g = 0.82 + (n - 0.5) * 0.18 + (pores - 0.5) * 0.05;
    return { c: [g * (1 + (blotch - 0.5) * 0.12), g, g * (1 - (blotch - 0.5) * 0.1)], h: pores * 0.3 + n * 0.3, r: 0.62 + pores * 0.15 };
  },
  scales: () => (u, v) => {
    const f = 16;
    const row = Math.floor(v * f);
    const uu = u * f + (row % 2) * 0.5;
    const fx = uu - Math.floor(uu) - 0.5;
    const fy = v * f - row;
    const d = Math.hypot(fx, fy * 0.9);
    const edge = smooth(0.35, 0.55, d);
    const n = fbm(u * 6, v * 6, { octaves: 4, period: 6, seed: 23 });
    const g = (0.7 + n * 0.3) * lerp(1, 0.55, edge);
    return { c: [g, g, g], h: (1 - edge) * (0.5 + fy * 0.4), r: lerp(0.45, 0.8, edge) };
  },
  fur: () => (u, v) => {
    const s = valueNoise(u * 90, v * 6, 90, 27) * 0.6 + valueNoise(u * 180, v * 12, 180, 28) * 0.4;
    const n = fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: 29 });
    const g = 0.45 + s * 0.45 + (n - 0.5) * 0.25;
    return { c: [g, g, g], h: s, r: 0.95 };
  },
  bone: () => (u, v) => {
    const n = fbm(u * 6, v * 6, { octaves: 5, period: 6, seed: 31 });
    const w = worley(u * 10, v * 10, 10, 32);
    const crack = 1 - smooth(0.0, 0.03, w.f2 - w.f1) * (n > 0.55 ? 1 : 0);
    const pore = valueNoise(u * 90, v * 90, 90, 33);
    const g = (0.78 + n * 0.2 - pore * 0.06) * lerp(0.6, 1, crack);
    return { c: [g, g * 0.96, g * 0.86], h: n * 0.4 + pore * 0.15 - (1 - crack) * 0.3, r: 0.7 };
  },
  wood: () => (u, v) => {
    const gr = valueNoise(u * 8, v * 90, 90, 41) * 0.6 + valueNoise(u * 20, v * 200, 200, 42) * 0.4;
    const ring = Math.sin((u * 10 + gr * 2.5) * Math.PI * 2) * 0.5 + 0.5;
    const g = 0.6 + gr * 0.25 + ring * 0.1;
    return { c: [g, g * 0.93, g * 0.85], h: gr * 0.6, r: 0.8 };
  },
  roof: () => (u, v) => {
    // Overlapping clay pantiles in staggered rows, with moss and soot.
    const rows = 12;
    const cols = 9;
    const ry = v * rows;
    const row = Math.floor(ry);
    const fy = ry - row;
    const ux = u * cols + (row % 2) * 0.5;
    const col = Math.floor(ux);
    const fx = ux - col;
    const id = hash2(((col % cols) + cols) % cols, row, 51);
    const curve = Math.sin(fx * Math.PI);
    const lip = smooth(0.0, 0.18, fy);
    const n = fbm(u * 6, v * 6, { octaves: 5, period: 6, seed: 52 });
    const moss = smooth(0.58, 0.78, fbm(u * 3, v * 3, { octaves: 4, period: 3, seed: 53 }));
    const soot = smooth(0.5, 0.8, fbm(u * 2, v * 2, { octaves: 3, period: 2, seed: 54 }));
    let c = [0.5 + id * 0.08, 0.31 + id * 0.05, 0.23 + id * 0.03];
    c = c.map((x) => x * (0.8 + curve * 0.25) * (0.8 + lip * 0.2) * (0.78 + n * 0.4) * (1 - soot * 0.4));
    c = [lerp(c[0], 0.22, moss * 0.7), lerp(c[1], 0.28, moss * 0.7), lerp(c[2], 0.12, moss * 0.7)];
    return { c, h: curve * 0.6 * lip + (1 - lip) * 0.1 + n * 0.1, r: lerp(0.75, 0.95, moss) };
  },
  thatch: () => (u, v) => {
    const s1 = valueNoise(u * 60, v * 5, 60, 61) * 0.6 + valueNoise(u * 140, v * 9, 140, 62) * 0.4;
    const band = smooth(0.0, 0.25, (v * 6) % 1);
    const n = fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: 63 });
    const g = (0.35 + s1 * 0.35) * (0.6 + band * 0.4) * (0.8 + n * 0.3);
    return { c: [g * 0.95, g * 0.8, g * 0.5], h: s1 * band, r: 0.95 };
  },
  plank: () => (u, v) => {
    const p = Math.floor(u * 4);
    const fu = u * 4 - p;
    const id = hash2(p, 0, 71);
    const gr = valueNoise(fu * 3 + id * 9, v * 40, 1000, 72) * 0.6 + valueNoise(fu * 9, v * 110, 1000, 73) * 0.4;
    const gap = smooth(0, 0.06, Math.min(fu, 1 - fu));
    const g = (0.35 + id * 0.15 + gr * 0.2) * lerp(0.3, 1, gap);
    return { c: [g, g * 0.72, g * 0.48], h: gap * (0.6 + gr * 0.3), r: 0.8 };
  },
};

/**
 * Half-timbered wall: oak posts, rails and braces (same layout as the shared
 * wall_timber set so the facades keep their rhythm) infilled with soft lime
 * render — low-frequency mottling, grime soaking out along the timbers, rain
 * streaks under the rails and a few spalls where the render has fallen away
 * to show the woven wattle or brick beneath. No crack network.
 */
function limeRender() {
  const posts = [0.02, 0.5, 0.98];
  const rails = [[0.08, 0.04], [0.5, 0.03], [0.92, 0.04]];
  return (u, v) => {
    // Hand-hewn timbers wander a little.
    const wob = (valueNoise(u * 3, v * 3, 3, 81) - 0.5) * 0.012;
    let dPost = 9;
    for (const p of posts) dPost = Math.min(dPost, Math.abs(u - p + wob) - 0.045);
    let dRail = 9;
    for (const [rv, w] of rails) dRail = Math.min(dRail, Math.abs(v - rv - wob * 0.6) - w);
    const dDiag = v > 0.5 ? Math.abs((u % 0.5) * 2 - v) / 2.24 - 0.035 / 2.24 : 9;
    const dBeam = Math.min(dPost, dRail, dDiag);
    const grain = valueNoise(u * 5, v * 70, 70, 82) * 0.6 + valueNoise(u * 13, v * 160, 160, 83) * 0.4;
    const n = fbm(u * 2.5, v * 2.5, { octaves: 4, period: 5, seed: 84 });
    if (dBeam < 0) {
      // Weathered oak: silvered on the faces, darker in the checks.
      const along = dDiag < Math.min(dPost, dRail) ? (u + v) * 40 : dPost < dRail ? v * 60 : u * 60;
      const check = smooth(0.82, 0.95, valueNoise(along * 0.4, (dPost < dRail ? u : v) * 300, 300, 85));
      const edge = smooth(0, 0.012, -dBeam);
      const g = (0.62 + grain * 0.32 + n * 0.12) * (1 - check * 0.5) * lerp(0.7, 1, edge);
      return { c: [0.27 * g, 0.18 * g, 0.12 * g], h: 0.85 + grain * 0.06 - check * 0.1 - (1 - edge) * 0.1, r: 0.86 };
    }
    // Lime render: broad soft mottle, warm/cool drift, no hard detail.
    const mott = fbm(u * 1.6 + 3.1, v * 1.6, { octaves: 3, period: 3.2, seed: 86 });
    const fine = valueNoise(u * 26, v * 26, 26, 87);
    let c = [0.83, 0.78, 0.67];
    const warm = mott - 0.5;
    c = [c[0] * (1 + warm * 0.1), c[1] * (1 + warm * 0.05), c[2] * (1 - warm * 0.06)];
    let k = 0.9 + (n - 0.5) * 0.16 + (fine - 0.5) * 0.03;
    // Grime soaking out of the timbers, heavier under the rails (water runs down).
    const soak = Math.exp(-dBeam / 0.022) * 0.3 + Math.exp(-dBeam / 0.07) * 0.1;
    let streak = 0;
    for (const [rv, w] of rails) {
      const below = rv - w - v;
      if (below > 0 && below < 0.3) streak = Math.max(streak, Math.exp(-below / 0.11) * smooth(0.45, 0.8, valueNoise(u * 34, v * 1.5, 34, 88)));
    }
    k *= 1 - soak - streak * 0.22;
    c = c.map((x, i) => x * k * (i === 2 ? 1 - soak * 0.3 : 1));
    // Spalls: a few blotches where the render has fallen, showing wattle or brick.
    const sp = fbm(u * 4.2 + 11, v * 4.2, { octaves: 3, period: 8.4, seed: 89 });
    const spall = smooth(0.77, 0.79, sp) * smooth(0.02, 0.05, dBeam);
    let h = 0.42 + (mott - 0.5) * 0.06 + (fine - 0.5) * 0.015;
    if (spall > 0) {
      const brick = hash2(Math.floor(u * 2), Math.floor(v * 2), 90) > 0.5;
      let ic;
      let ih;
      if (brick) {
        const row = Math.floor(v * 46);
        const bu = u * 18 + (row % 2) * 0.5;
        const mortar = Math.min(Math.abs(v * 46 - row - 0.5) > 0.38 ? 0 : 1, Math.abs(bu - Math.round(bu)) < 0.06 ? 0 : 1);
        const id = hash2(Math.floor(bu), row, 91);
        ic = mortar ? [0.42 + id * 0.12, 0.2 + id * 0.05, 0.13] : [0.3, 0.27, 0.22];
        ih = mortar ? 0.3 : 0.22;
      } else {
        // Woven hazel wattle: horizontal rods over vertical staves.
        const rod = Math.abs(Math.sin(v * 140)) ;
        const stave = Math.abs(Math.sin(u * 30));
        const w2 = Math.max(rod * 0.8, stave > 0.92 ? 1 : 0);
        ic = [0.36 * (0.6 + w2 * 0.5), 0.27 * (0.6 + w2 * 0.5), 0.17 * (0.6 + w2 * 0.5)];
        ih = 0.2 + w2 * 0.08;
      }
      // Shadowed, slightly raised broken lip of render around the hole.
      const lip = smooth(0.765, 0.775, sp) * (1 - smooth(0.785, 0.81, sp));
      c = [lerp(c[0], ic[0], spall), lerp(c[1], ic[1], spall), lerp(c[2], ic[2], spall)];
      c = c.map((x) => x * (1 - lip * 0.25));
      h = lerp(h, ih, spall) + lip * 0.04;
    }
    return { c, h, r: lerp(0.95, 0.88, spall) };
  };
}
GEN.lime = () => limeRender();

const texCache = new Map();

/** @returns {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture}} */
export function detailSet(name, size = name === 'lime' ? 512 : ['chain', 'metal', 'roof', 'thatch', 'plank'].includes(name) ? 256 : 128) {
  if (texCache.has(name)) return texCache.get(name);
  const d = genData(size, GEN[name](), name === 'chain' ? 5 : 3);
  const mk = (arr, srgb) => {
    const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const set = { map: mk(d.color, true), normalMap: mk(d.normal, false), roughnessMap: mk(d.rough, false) };
  texCache.set(name, set);
  return set;
}

/** Colour/normal/roughness byte arrays from a per-pixel generator (no 2D canvas: fast everywhere). */
function genData(size, fn, normalStrength) {
  const n = size * size;
  const height = new Float32Array(n);
  const color = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = fn(x / size, y / size, x, y);
      const i = y * size + x;
      height[i] = s.h;
      const o = i * 4;
      color[o] = Math.min(255, Math.max(0, s.c[0] * 255));
      color[o + 1] = Math.min(255, Math.max(0, s.c[1] * 255));
      color[o + 2] = Math.min(255, Math.max(0, s.c[2] * 255));
      color[o + 3] = 255;
      const r = Math.min(255, Math.max(0, (s.r ?? 0.85) * 255));
      rough[o] = r;
      rough[o + 1] = r;
      rough[o + 2] = r;
      rough[o + 3] = 255;
    }
  }
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * normalStrength;
      let ny = -dy * normalStrength;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      normal[o] = ((nx / l) * 0.5 + 0.5) * 255;
      normal[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      normal[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }
  return { color, normal, rough };
}

/** Material presets: detail texture + PBR params. */
const KIND = {
  cloth: { tex: 'cloth', roughness: 1, metalness: 0, normalScale: 0.5, repeat: 3 },
  leather: { tex: 'leather', roughness: 1, metalness: 0, normalScale: 0.7, repeat: 2 },
  chain: { tex: 'chain', roughness: 1, metalness: 0.9, normalScale: 1.2, repeat: 3 },
  metal: { tex: 'metal', roughness: 1.35, metalness: 1, normalScale: 0.4 },
  gold: { tex: 'metal', roughness: 0.8, metalness: 1, normalScale: 0.3 },
  skin: { tex: 'skin', roughness: 1, metalness: 0, normalScale: 0.15, repeat: 2 },
  scales: { tex: 'scales', roughness: 1, metalness: 0, normalScale: 1, repeat: 2 },
  reptile: { tex: 'skin', roughness: 0.78, metalness: 0, normalScale: 0.55, repeat: 4 },
  fur: { tex: 'fur', roughness: 1, metalness: 0, normalScale: 0.8, repeat: 3 },
  bone: { tex: 'bone', roughness: 1, metalness: 0, normalScale: 0.7 },
  wood: { tex: 'wood', roughness: 1, metalness: 0, normalScale: 0.6 },
  hair: { tex: 'fur', roughness: 0.75, metalness: 0, normalScale: 0.6, repeat: 3 },
  roof: { tex: 'roof', roughness: 1, metalness: 0, normalScale: 1.2 },
  thatch: { tex: 'thatch', roughness: 1, metalness: 0, normalScale: 1 },
  plank: { tex: 'plank', roughness: 1, metalness: 0, normalScale: 0.9 },
  eye: { roughness: 0.15, metalness: 0 },
  glow: { roughness: 0.5, metalness: 0 },
};

const matCache = new Map();

/**
 * Shared PBR material for a kind + tint. Never mutate the result.
 * @param {keyof KIND} kind
 * @param {number} color hex tint
 * @param {{emissive?:number, emissiveIntensity?:number, repeat?:number}} [o]
 */
export function pbr(kind, color, o = {}) {
  const key = `${kind}|${color}|${o.emissive ?? ''}|${o.emissiveIntensity ?? ''}|${o.repeat ?? ''}`;
  if (matCache.has(key)) return matCache.get(key);
  const k = KIND[kind];
  const params = { color, roughness: k.roughness, metalness: k.metalness };
  let m;
  if (k.tex) {
    let t = detailSet(k.tex);
    const repeat = o.repeat ?? k.repeat;
    if (repeat && repeat !== 1) {
      const rep = (tx) => {
        const c = tx.clone();
        c.repeat.set(repeat, repeat);
        c.needsUpdate = true;
        return c;
      };
      t = { map: rep(t.map), normalMap: rep(t.normalMap), roughnessMap: rep(t.roughnessMap) };
    }
    Object.assign(params, { map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, normalScale: new THREE.Vector2(k.normalScale, k.normalScale) });
  }
  m = new THREE.MeshStandardMaterial(params);
  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  m.name = key;
  matCache.set(key, m);
  return m;
}

/** Canvas heraldry for shields/tabards: device on a field. */
const heraldryCache = new Map();
export function heraldry(field, device, charge = 0xf5d98b) {
  const key = `${field}|${device}|${charge}`;
  if (heraldryCache.has(key)) return heraldryCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(field);
  g.fillRect(0, 0, 256, 256);
  // Weathering.
  for (let i = 0; i < 1800; i++) {
    const x = hash2(i, 1, 5) * 256;
    const y = hash2(i, 2, 5) * 256;
    g.fillStyle = `rgba(${hash2(i, 3, 5) > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + hash2(i, 4, 5) * 0.05})`;
    g.fillRect(x, y, 2 + hash2(i, 6, 5) * 6, 1 + hash2(i, 7, 5) * 3);
  }
  g.fillStyle = hex(charge);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 4;
  g.save();
  g.translate(128, 128);
  if (device === 'cross') {
    g.fillRect(-18, -90, 36, 180);
    g.fillRect(-70, -40, 140, 34);
  } else if (device === 'scales') {
    // Tyr's balance.
    g.fillRect(-6, -80, 12, 150);
    g.fillRect(-70, -60, 140, 10);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(s * 58, -10, 26, 0, Math.PI);
      g.fill();
      g.fillRect(s * 58 - 2, -55, 4, 45);
    }
    g.fillRect(-40, 66, 80, 12);
  } else if (device === 'chevron') {
    g.beginPath();
    g.moveTo(-100, 60); g.lineTo(0, -40); g.lineTo(100, 60); g.lineTo(100, 100); g.lineTo(0, 0); g.lineTo(-100, 100);
    g.closePath();
    g.fill();
  } else if (device === 'skull') {
    g.beginPath();
    g.arc(0, -10, 55, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-35, 30, 70, 40);
    g.fillStyle = hex(field);
    g.beginPath(); g.arc(-22, -10, 15, 0, Math.PI * 2); g.arc(22, -10, 15, 0, Math.PI * 2); g.fill();
    g.fillRect(-4, 10, 8, 18);
  } else if (device === 'hammer') {
    g.fillRect(-8, -60, 16, 150);
    g.fillRect(-55, -85, 110, 45);
  } else {
    // Star (Mystra-ish) / default.
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 34 : 88;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  g.restore();
  // Rim.
  g.strokeStyle = 'rgba(20,14,6,0.9)';
  g.lineWidth = 16;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  heraldryCache.set(key, t);
  return t;
}

/**
 * Granite setts for the combat street: one tile = 1 m with 9 courses of
 * small (~11 cm) rounded rectangular stones, staggered, varied in width,
 * tone and wear. Most stones are matte; a few are foot-polished. Deep mortar
 * joints filled with dark grit. The roughness map carries height in .r and
 * roughness in .g (the ground shader fills puddles into the low joints).
 * @returns {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture}}
 */
export function settsSet(size = 512) {
  if (texCache.has('setts')) return texCache.get('setts');
  const ROWS = 8;
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    // Stone widths for this course summing to exactly 1 (tileable in u).
    const n = 7 + Math.floor(hash2(r, 3, 51) * 3);
    const w = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = 0.75 + hash2(r, i, 52) * 0.6;
      w.push(x);
      sum += x;
    }
    const off = hash2(r, 9, 53);
    let acc = 0;
    rows.push({ edges: w.map((x) => (acc += x / sum) - x / sum), widths: w.map((x) => x / sum), off });
  }
  const N = size * size;
  const height = new Float32Array(N);
  const color = new Uint8Array(N * 4);
  const rough = new Uint8Array(N * 4);
  const normal = new Uint8Array(N * 4);
  const rh = 1 / ROWS;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    void 0;
    for (let x = 0; x < size; x++) {
      const u0 = x / size;
      // Gently undulating courses (tileable: whole sine periods).
      const vw = (v + Math.sin(u0 * Math.PI * 2) * 0.012 + Math.sin(u0 * Math.PI * 6 + 1) * 0.005 + 1) % 1;
      const r = Math.min(ROWS - 1, Math.floor(vw / rh));
      const row = rows[r];
      const fv = (vw - r * rh) / rh;
      const u = (u0 + row.off + 1) % 1;
      let k = row.edges.length - 1;
      for (let i = 0; i < row.edges.length; i++) if (u < row.edges[i] + row.widths[i]) { k = i; break; }
      const fu = (u - row.edges[k]) / row.widths[k];
      // Rounded-rect distance inside the stone (in stone-relative units, aspect-corrected).
      const sw = row.widths[k] / rh; // stone width / height ratio
      const jx = (hash2(r, k, 61) - 0.5) * 0.12;
      const jy = (hash2(r, k, 62) - 0.5) * 0.12;
      const px = (fu - 0.5 + jx * 0.3) * sw;
      const py = fv - 0.5 + jy * 0.3;
      const hx = sw * 0.5 - 0.09 - hash2(r, k, 63) * 0.05;
      const hy = 0.5 - 0.09 - hash2(r, k, 64) * 0.05;
      const rad = 0.16 + hash2(r, k, 65) * 0.12;
      const qx = Math.abs(px) - hx + rad;
      const qy = Math.abs(py) - hy + rad;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      // Edge noise so stones are chipped, not machined.
      const en = fbm(u0 * 24, v * 24, { octaves: 3, period: 24, seed: 71 }) - 0.5;
      const sd = outside + inside - rad + en * 0.08;
      const stone = smooth(0.02, -0.04, sd);
      // Dome: highest mid-stone, falling to the joint; worn tops are flatter.
      const dome = clamp01(-sd / 0.32);
      const n1 = fbm(u0 * 40, v * 40, { octaves: 3, period: 40, seed: 73 });
      const tone = hash2(r, k, 66);
      const warm = hash2(r, k, 67);
      const polish = hash2(r, k, 68) > 0.82 ? 1 : 0;
      const h = stone * (0.55 + 0.45 * Math.sqrt(dome)) + (n1 - 0.5) * 0.06 * stone;
      // Mortar: dark grit and dirt, damp and rough.
      const grit = fbm(u0 * 64, v * 64, { octaves: 2, period: 64, seed: 79 });
      let cr = 0.05 + grit * 0.035;
      let cg = 0.045 + grit * 0.03;
      let cb = 0.036 + grit * 0.025;
      // Stone albedo: grey granite, some warm, some blue-grey, speckled; edges darker (cavity).
      const g0 = (0.12 + tone * 0.2 + (n1 - 0.5) * 0.08) * (hash2(r, k, 69) > 0.9 ? 0.7 : 1);
      const sr = g0 * (0.96 + warm * 0.1);
      const sg = g0 * (0.95 + (0.5 - Math.abs(warm - 0.5)) * 0.04);
      const sb = g0 * (1.04 - warm * 0.12);
      const speck = hash2(x, y, 81) > 0.93 ? 0.85 : 1;
      const cav = 0.62 + 0.38 * Math.sqrt(dome);
      const sk = stone;
      cr = cr * (1 - sk) + sr * speck * cav * sk;
      cg = cg * (1 - sk) + sg * speck * cav * sk;
      cb = cb * (1 - sk) + sb * speck * cav * sk;
      const i = y * size + x;
      height[i] = h;
      const o = i * 4;
      color[o] = Math.min(255, Math.max(0, Math.pow(cr, 1 / 2.2) * 255));
      color[o + 1] = Math.min(255, Math.max(0, Math.pow(cg, 1 / 2.2) * 255));
      color[o + 2] = Math.min(255, Math.max(0, Math.pow(cb, 1 / 2.2) * 255));
      color[o + 3] = 255;
      const ro = sk * (polish ? 0.5 + n1 * 0.15 : 0.82 + n1 * 0.16) + (1 - sk) * 0.97;
      rough[o] = Math.min(255, h * 255);
      rough[o + 1] = Math.min(255, ro * 255);
      rough[o + 2] = rough[o];
      rough[o + 3] = 255;
    }
  }
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const ns = 5.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      const nx = -dx * ns;
      const ny = -dy * ns;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      normal[o] = ((nx / l) * 0.5 + 0.5) * 255;
      normal[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      normal[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }
  const mk = (arr, srgb) => {
    const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const set = { map: mk(color, true), normalMap: mk(normal, false), roughnessMap: mk(rough, false) };
  texCache.set('setts', set);
  return set;
}
