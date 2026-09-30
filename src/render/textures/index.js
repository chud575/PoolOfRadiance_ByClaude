import * as THREE from 'three';
import { materialData } from './canvas.js';
import { TEXTURE_DEFS } from './defs.js';

export { TEXTURE_DEFS };

/**
 * Procedural texture library entry point.
 *   getTextureSet('wall_stone') → {map, normalMap, roughnessMap}   (sync; generates on demand)
 *   await preloadTextureSets(['hd_ashlar', ...])                     (parallel, Web Workers)
 * Sets are generated once per session and cached. Scenes should preload what
 * they need in enter() so the main thread never stalls on generation.
 */

const cache = new Map();
const pending = new Map();

function makeTex(data, size, srgb, anisotropy = 8) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function toSet(name, d) {
  const set = {
    map: makeTex(d.color, d.size, true),
    normalMap: makeTex(d.normal, d.size, false),
    roughnessMap: makeTex(d.rough, d.size, false),
  };
  for (const t of Object.values(set)) t.name = name;
  cache.set(name, set);
  return set;
}

/**
 * @param {string} name key of TEXTURE_DEFS
 * @returns {{map: THREE.Texture, normalMap: THREE.Texture, roughnessMap: THREE.Texture}}
 */
export function getTextureSet(name) {
  if (cache.has(name)) return cache.get(name);
  const def = TEXTURE_DEFS[name];
  if (!def) throw new Error(`Unknown texture set "${name}"`);
  const d = materialData(def.size, def.gen(), { normalStrength: def.normalStrength, cavity: def.cavity ?? 0.35 });
  return toSet(name, d);
}

/** True if the set is already generated. */
export function hasTextureSet(name) {
  return cache.has(name);
}

// ---------------------------------------------------------------- worker pool
let pool = null;
function getPool() {
  if (pool !== null) return pool;
  pool = [];
  try {
    if (typeof Worker === 'undefined') return pool;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2)));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./texWorker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      pool.push(w);
    }
  } catch {
    pool = [];
  }
  return pool;
}

/**
 * Generate texture sets in parallel (Web Workers; falls back to the main
 * thread). Resolves once every named set is cached.
 * @param {string[]} names
 */
export async function preloadTextureSets(names) {
  const todo = [...new Set(names)].filter((n) => !cache.has(n) && TEXTURE_DEFS[n]);
  if (!todo.length) return;
  const workers = getPool();
  if (!workers.length) {
    for (const n of todo) getTextureSet(n);
    return;
  }
  // biggest first for better packing
  todo.sort((a, b) => TEXTURE_DEFS[b].size - TEXTURE_DEFS[a].size);
  const jobs = todo.map((name) => {
    if (pending.has(name)) return pending.get(name);
    let resolve;
    const p = new Promise((r) => (resolve = r));
    p.job = { name, resolve };
    pending.set(name, p);
    queue.push(p.job);
    return p;
  });
  for (const w of workers) if (!w.busy) pump(w);
  await Promise.all(jobs);
}

const queue = [];
function finish(job) {
  pending.delete(job.name);
  job.resolve();
}
function pump(w) {
  const job = queue.shift();
  if (!job) {
    w.busy = false;
    return;
  }
  w.busy = true;
  w.onmessage = (e) => {
    const m = e.data;
    if (m.error) {
      console.warn(`[textures] worker failed for ${m.name}: ${m.error}; generating on main thread`);
      getTextureSet(m.name);
    } else if (!cache.has(m.name)) toSet(m.name, m);
    finish(job);
    pump(w);
  };
  w.onerror = (err) => {
    err.preventDefault?.();
    getTextureSet(job.name);
    finish(job);
    pump(w);
  };
  w.postMessage({ name: job.name });
}

/** Dispose everything (e.g. on context loss). */
export function disposeTextures() {
  for (const set of cache.values()) for (const t of Object.values(set)) t.dispose();
  cache.clear();
  for (const t of canvasCache.values()) t.dispose();
  canvasCache.clear();
}

// ------------------------------------------------------------ canvas textures
const canvasCache = new Map();
function canvasTex(key, w, h, draw, { srgb = true, repeat = false, mips = true } = {}) {
  if (canvasCache.has(key)) return canvasCache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = mips;
  t.anisotropy = 4;
  t.name = key;
  canvasCache.set(key, t);
  return t;
}

/** Canvas-drawn radial glow sprite texture (for flames, motes, magic). */
export function getGlowTexture() {
  return canvasTex('glow', 128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
}

/** Very soft falloff (fog wisps, smoke, light cones). */
export function getSoftTexture() {
  return canvasTex('soft', 128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Leaded window glass, drawn as an emissive map: warm lit interior behind
 * diamond quarrels, with a silhouette of curtains/furniture for depth.
 * variant: 'lit' (warm) | 'dark' (unlit, sky reflection handled by material)
 */
export function getWindowTexture(variant = 'lit') {
  return canvasTex(`window_${variant}`, 128, 256, (g, w, h) => {
    const r = rng(variant === 'lit' ? 7 : 9);
    if (variant === 'lit') {
      const grd = g.createRadialGradient(w * 0.5, h * 0.62, 10, w * 0.5, h * 0.6, h * 0.7);
      grd.addColorStop(0, '#ffd89a');
      grd.addColorStop(0.45, '#e39a48');
      grd.addColorStop(1, '#5a2a10');
      g.fillStyle = grd;
    } else {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#3a4a5c');
      grd.addColorStop(1, '#0c0f14');
      g.fillStyle = grd;
    }
    g.fillRect(0, 0, w, h);
    // interior silhouettes (curtain edges, a beam)
    g.fillStyle = variant === 'lit' ? 'rgba(60,20,5,0.55)' : 'rgba(0,0,0,0.5)';
    g.fillRect(0, 0, w * 0.18, h);
    g.fillRect(w * 0.84, 0, w * 0.16, h);
    g.fillRect(0, h * 0.12, w, h * 0.06);
    // glass tint variation per quarrel
    const qw = 22;
    const qh = 34;
    g.save();
    for (let y = -qh; y < h + qh; y += qh / 2) {
      for (let x = -qw; x < w + qw; x += qw) {
        const ox = ((y / (qh / 2)) & 1) * (qw / 2);
        g.fillStyle = `rgba(${r() < 0.5 ? '255,240,200' : '120,90,60'},${0.05 + r() * 0.12})`;
        g.beginPath();
        g.moveTo(x + ox, y - qh / 2);
        g.lineTo(x + ox + qw / 2, y);
        g.lineTo(x + ox, y + qh / 2);
        g.lineTo(x + ox - qw / 2, y);
        g.closePath();
        g.fill();
      }
    }
    // lead cames (diamond lattice)
    g.strokeStyle = 'rgba(12,10,8,0.95)';
    g.lineWidth = 2.2;
    for (let k = -h; k < w + h; k += qw) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + h * (qw / qh), h);
      g.stroke();
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k - h * (qw / qh), h);
      g.stroke();
    }
    g.restore();
    // mullion/transom
    g.fillStyle = '#120c08';
    g.fillRect(w / 2 - 3, 0, 6, h);
    g.fillRect(0, h * 0.42, w, 6);
  });
}

/**
 * Heraldic cloth banner. variant selects field/charge.
 * Alpha cut swallow-tail at the bottom.
 */
export function getBannerTexture(variant = 0) {
  return canvasTex(`banner_${variant}`, 128, 256, (g, w, h) => {
    const fields = [
      ['#7a1a16', '#d8b25a'],
      ['#1d2f66', '#d8b25a'],
      ['#2a4a2a', '#e8dcc0'],
      ['#4a1a4a', '#d8b25a'],
    ];
    const [field, charge] = fields[variant % fields.length];
    const r = rng(31 + variant);
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(w, h);
    g.lineTo(w / 2, h * 0.82);
    g.lineTo(0, h);
    g.closePath();
    g.fillStyle = field;
    g.fill();
    g.save();
    g.clip();
    // weave + fading
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.07})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    // border
    g.strokeStyle = charge;
    g.lineWidth = 5;
    g.strokeRect(8, 8, w - 16, h - 16);
    // charge: variant 0 = gilt tower (Phlan), 1 = scales of Tyr, 2 = tree, 3 = star
    g.fillStyle = charge;
    g.strokeStyle = charge;
    const cx = w / 2;
    const cy = h * 0.4;
    if (variant % 4 === 0) {
      g.fillRect(cx - 18, cy - 20, 36, 50);
      for (let k = -18; k < 18; k += 12) g.fillRect(cx + k, cy - 30, 8, 12);
      g.fillStyle = field;
      g.fillRect(cx - 5, cy + 12, 10, 18);
    } else if (variant % 4 === 1) {
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, cy - 34);
      g.lineTo(cx, cy + 30);
      g.moveTo(cx - 34, cy - 18);
      g.lineTo(cx + 34, cy - 18);
      g.stroke();
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(cx + s * 28, cy + 2, 13, 0, Math.PI);
        g.fill();
        g.beginPath();
        g.moveTo(cx + s * 28, cy - 18);
        g.lineTo(cx + s * 16, cy + 2);
        g.moveTo(cx + s * 28, cy - 18);
        g.lineTo(cx + s * 40, cy + 2);
        g.stroke();
      }
    } else if (variant % 4 === 2) {
      g.beginPath();
      g.arc(cx, cy - 8, 26, 0, Math.PI * 2);
      g.fill();
      g.fillRect(cx - 5, cy, 10, 36);
    } else {
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? 13 : 32;
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    }
    // grime at the hem
    const grd = g.createLinearGradient(0, h * 0.6, 0, h);
    grd.addColorStop(0, 'rgba(20,12,6,0)');
    grd.addColorStop(1, 'rgba(20,12,6,0.55)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.restore();
  });
}

/** Alpha-tested grass/weed tuft card (clumps of blades). */
export function getGrassTexture() {
  return canvasTex('grass', 128, 128, (g, w, h) => {
    const r = rng(77);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = w * (0.2 + r() * 0.6);
      const bh = h * (0.3 + r() * 0.65);
      const bend = (r() - 0.5) * 40;
      const gcol = [85 + r() * 60, 115 + r() * 60, 35 + r() * 35];
      if (r() < 0.3) {
        gcol[0] += 70;
        gcol[1] += 40;
        gcol[2] += 10;
      }
      g.strokeStyle = `rgb(${gcol[0] | 0},${gcol[1] | 0},${gcol[2] | 0})`;
      g.lineWidth = 1.5 + r() * 2;
      g.beginPath();
      g.moveTo(x, h);
      g.quadraticCurveTo(x + bend * 0.3, h - bh * 0.6, x + bend, h - bh);
      g.stroke();
    }
  });
}

/** Ivy / creeper leaves sheet (alpha) for ruined walls. */
export function getIvyTexture() {
  return canvasTex('ivy', 256, 256, (g, w, h) => {
    const r = rng(91);
    g.clearRect(0, 0, w, h);
    // stems
    g.strokeStyle = 'rgb(50,40,25)';
    for (let i = 0; i < 9; i++) {
      let x = r() * w;
      let y = 0;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      g.moveTo(x, y);
      while (y < h) {
        x += (r() - 0.5) * 30;
        y += 10 + r() * 20;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 900; i++) {
      const x = r() * w;
      const y = Math.pow(r(), 0.7) * h;
      const s = 4 + r() * 7;
      const t = r();
      g.fillStyle = `rgb(${(30 + t * 50) | 0},${(60 + t * 70) | 0},${(20 + t * 25) | 0})`;
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.beginPath();
      g.moveTo(0, -s);
      g.quadraticCurveTo(s, -s * 0.2, 0, s);
      g.quadraticCurveTo(-s, -s * 0.2, 0, -s);
      g.fill();
      g.restore();
    }
  });
}

/** Cobweb (alpha) for dungeon corners. */
export function getCobwebTexture() {
  return canvasTex('cobweb', 256, 256, (g, w, h) => {
    const r = rng(55);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(230,230,225,0.55)';
    g.lineWidth = 1;
    const spokes = 11;
    const ang = [];
    for (let i = 0; i < spokes; i++) ang.push((i / (spokes - 1)) * (Math.PI / 2) + (r() - 0.5) * 0.08);
    for (const a of ang) {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * w * 1.3, Math.sin(a) * h * 1.3);
      g.stroke();
    }
    for (let rr = 14; rr < w * 1.2; rr += 10 + r() * 12) {
      g.beginPath();
      ang.forEach((a, i) => {
        const q = rr * (0.92 + r() * 0.12);
        const x = Math.cos(a) * q;
        const y = Math.sin(a) * q;
        if (i === 0) g.moveTo(x, y);
        else g.quadraticCurveTo(Math.cos(a - 0.07) * q * 0.94, Math.sin(a - 0.07) * q * 0.94, x, y);
      });
      g.globalAlpha = 0.35 + r() * 0.4;
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

/** Puddle / wet decal mask (alpha = wetness). */
export function getPuddleTexture() {
  return canvasTex('puddle', 128, 128, (g, w, h) => {
    const r = rng(13);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      const x = w * (0.3 + r() * 0.4);
      const y = h * (0.3 + r() * 0.4);
      const rad = w * (0.08 + r() * 0.18);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  }, { srgb: false });
}

/** Grime / soot decal (alpha) for wall bases and under windows. */
export function getGrimeTexture() {
  return canvasTex('grime', 256, 128, (g, w, h) => {
    const r = rng(19);
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.9)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.3})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 8, 4 + r() * 30);
    }
  });
}
