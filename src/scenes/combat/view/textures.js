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
    const rows = 10;
    const cols = 8;
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
    let c = [0.52 + id * 0.12, 0.26 + id * 0.06, 0.16 + id * 0.03];
    c = c.map((x) => x * (0.7 + curve * 0.35) * (0.65 + lip * 0.35) * (0.85 + n * 0.3));
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

const texCache = new Map();

/** @returns {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture}} */
export function detailSet(name, size = ['chain', 'metal', 'roof', 'thatch', 'plank'].includes(name) ? 256 : 128) {
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
