import * as THREE from 'three';
import { materialData } from './canvas.js';
import { TEXTURE_DEFS } from './defs.js';
import { fbm } from './noise.js';

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
  if (variant === 'sky') return getWindowSkyTexture();
  return canvasTex(`window_${variant}`, 128, 256, (g, w, h) => {
    const r = rng(variant === 'lit' ? 7 : 9);
    if (variant === 'lit') {
      const grd = g.createRadialGradient(w * 0.5, h * 0.62, 10, w * 0.5, h * 0.6, h * 0.7);
      grd.addColorStop(0, '#ffd89a');
      grd.addColorStop(0.45, '#e39a48');
      grd.addColorStop(1, '#5a2a10');
      g.fillStyle = grd;
    } else {
      // daylight glazing: the sky and the roofs opposite reflected in the upper panes,
      // a dim room with a curtain edge seen through the lower ones
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#9aaec4');
      grd.addColorStop(0.35, '#5d7086');
      grd.addColorStop(0.5, '#262c33');
      grd.addColorStop(1, '#121417');
      g.fillStyle = grd;
    }
    g.fillRect(0, 0, w, h);
    if (variant !== 'lit') {
      // reflected rooftops opposite
      g.fillStyle = 'rgba(30,34,40,0.85)';
      g.beginPath();
      g.moveTo(0, h * 0.42);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, h * (0.3 + 0.08 * Math.abs(Math.sin(x * 0.07 + 1.3)) + (x % 32 < 8 ? -0.04 : 0)));
      g.lineTo(w, h * 0.42);
      g.closePath();
      g.fill();
      // a soft diagonal sheen across the glass
      const sh = g.createLinearGradient(0, 0, w, h * 0.6);
      sh.addColorStop(0.25, 'rgba(255,255,255,0)');
      sh.addColorStop(0.38, 'rgba(255,255,255,0.18)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.fillStyle = sh;
      g.fillRect(0, 0, w, h);
      // warm hint of the room within
      g.fillStyle = 'rgba(90,60,35,0.35)';
      g.fillRect(w * 0.2, h * 0.62, w * 0.6, h * 0.3);
    }
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
      const gcol = [70 + r() * 40, 95 + r() * 45, 40 + r() * 25];
      if (r() < 0.25) {
        gcol[0] += 50;
        gcol[1] += 25;
        gcol[2] += 15;
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

/** Puddle / wet decal mask (alpha = wetness): a lobed, ragged pool with a damp fringe. */
export function getPuddleTexture() {
  return canvasTex('puddle2', 256, 256, (g, w, h) => {
    const r = rng(13);
    const blobs = [];
    for (let i = 0; i < 7; i++) blobs.push([0.3 + r() * 0.4, 0.3 + r() * 0.4, 0.1 + r() * 0.14]);
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / h;
        let f = 0;
        for (const [bx, by, br] of blobs) f = Math.max(f, 1 - Math.hypot(u - bx, v - by) / br);
        // ragged shoreline: two octaves of noise eat into the edge (fingers into the joints)
        const n = fbm(u * 6, v * 6, { octaves: 4, period: 6, seed: 71 }) - 0.5;
        const n2 = fbm(u * 24, v * 24, { octaves: 2, period: 24, seed: 72 }) - 0.5;
        const e = f + n * 0.5 + n2 * 0.16;
        const edgeFade = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 8);
        const water = Math.min(1, Math.max(0, (e - 0.12) / 0.04));
        const damp = Math.min(1, Math.max(0, (e + 0.1) / 0.2)) * 0.32;
        const a = Math.max(water, damp) * edgeFade;
        const o = (y * w + x) * 4;
        // (three's alphaMap reads the green channel: store the mask in RGB, opaque)
        img.data[o] = img.data[o + 1] = img.data[o + 2] = a * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
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

/**
 * Carved stone inscription panel (weathered, engraved capitals). Cached by text.
 * `weathered`: ruin variant — cracked through, a corner broken away (alpha),
 * lichen and soot staining, letters partly lost.
 */
export function getInscriptionTexture(text, { weathered = false } = {}) {
  const key = `inscr_${text}${weathered ? '_w' : ''}`;
  return canvasTex(key, 1024, 256, (g, w, h) => {
    g.scale(2, 2);
    w /= 2;
    h /= 2;
    const r = rng(text.length * 13 + 5 + (weathered ? 101 : 0));
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, weathered ? '#8a8476' : '#9c9384');
    grd.addColorStop(1, weathered ? '#6a6458' : '#7d7568');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '40,34,28' : '220,210,190'},${r() * 0.12})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
    }
    // border moulding
    g.strokeStyle = 'rgba(40,32,24,0.6)';
    g.lineWidth = 4;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = 'rgba(230,220,200,0.35)';
    g.lineWidth = 2;
    g.strokeRect(14, 14, w - 28, h - 28);
    // engraved letters: dark cut + light lower lip
    g.font = `600 60px Georgia, 'Times New Roman', serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const sx = Math.min(1, (w - 80) / Math.max(1, g.measureText(text).width));
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(sx, 1);
    g.fillStyle = 'rgba(235,225,205,0.55)';
    g.fillText(text, 1, 3);
    g.fillStyle = weathered ? 'rgba(30,24,18,0.88)' : 'rgba(30,24,18,0.92)';
    g.fillText(text, 0, 1);
    g.restore();
    // wear: chip some of the letters away
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < (weathered ? 70 : 50); i++) {
      g.fillStyle = `rgba(${weathered ? '128,122,108' : '150,142,128'},${0.3 + r() * 0.5})`;
      g.beginPath();
      g.arc(r() * w, r() * h, 1.5 + r() * (weathered ? 6 : 5), 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    if (weathered) {
      // lichen rosettes and rain/soot streaks
      for (let i = 0; i < 14; i++) {
        const x = r() * w;
        const y = r() * h;
        const rad = 4 + r() * 16;
        const lg = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.6 ? '150,150,96' : '200,196,160';
        lg.addColorStop(0, `rgba(${c},0.75)`);
        lg.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = lg;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(20,16,12,${0.05 + r() * 0.12})`;
        g.fillRect(r() * w, 0, 1 + r() * 4, h * (0.4 + r() * 0.6));
      }
      // a crack running through the slab
      g.strokeStyle = 'rgba(18,14,10,0.85)';
      g.lineWidth = 2.2;
      g.beginPath();
      let x = w * (0.55 + r() * 0.1);
      let y = 0;
      g.moveTo(x, y);
      while (y < h) {
        x += (r() - 0.5) * 22;
        y += 6 + r() * 10;
        g.lineTo(x, y);
      }
      g.stroke();
      g.strokeStyle = 'rgba(230,220,200,0.25)';
      g.lineWidth = 1;
      g.stroke();
      // broken-off corner (cut out of the alpha channel with a ragged edge)
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,1)';
      g.beginPath();
      g.moveTo(w, h * 0.18);
      let cx = w;
      let cy = h * 0.18;
      for (let k = 0; k < 9; k++) {
        cx -= 6 + r() * 12;
        cy += 6 + r() * 9;
        g.lineTo(cx + (r() - 0.5) * 8, cy);
      }
      g.lineTo(w * 0.8, h);
      g.lineTo(w, h);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
  });
}

/**
 * Ivy leaf cluster (alpha): dense five-lobed leaves around a few stems, ragged
 * organic outline, a few dead/russet leaves. Cards of this overlap into mats.
 */
export function getIvyClusterTexture(variant = 0) {
  return canvasTex(`ivyc_${variant}`, 256, 256, (g, w, h) => {
    const r = rng(311 + variant * 17);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgb(62,48,30)';
    g.lineCap = 'round';
    const tips = [];
    for (let i = 0; i < 5; i++) {
      let x = w * 0.5 + (r() - 0.5) * 40;
      let y = h * 0.5 + (r() - 0.5) * 40;
      const a0 = r() * Math.PI * 2;
      g.lineWidth = 1.5 + r() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        const a = a0 + (r() - 0.5) * 1.2;
        x += Math.cos(a) * (10 + r() * 8);
        y += Math.sin(a) * (10 + r() * 8);
        g.lineTo(x, y);
        tips.push([x, y]);
      }
      g.stroke();
    }
    const leaf = (x, y, s, rot, col) => {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = col;
      g.beginPath();
      // five-lobed ivy leaf
      for (let k = 0; k <= 10; k++) {
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        const lobe = k % 2 === 0 ? 1 : 0.52;
        const rr = s * lobe * (k === 0 || k === 10 ? 1.15 : 1);
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.95);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(200,220,150,0.25)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(0, s * 0.6);
      g.lineTo(0, -s * 0.9);
      g.stroke();
      g.restore();
    };
    for (let i = 0; i < 260; i++) {
      // radial falloff → ragged, roughly round cluster
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.65) * w * 0.42;
      const [tx, ty] = tips[Math.floor(r() * tips.length)];
      const useTip = r() < 0.35;
      const x = useTip ? tx + (r() - 0.5) * 18 : w / 2 + Math.cos(a) * d;
      const y = useTip ? ty + (r() - 0.5) * 18 : h / 2 + Math.sin(a) * d;
      if (Math.hypot(x - w / 2, y - h / 2) > w * 0.47) continue;
      const t = r();
      const shade = 0.7 + (1 - d / (w * 0.42)) * 0.3;
      let col = [(48 + t * 58) * shade, (86 + t * 78) * shade, (28 + t * 30) * shade];
      if (r() < 0.06) col = [120 + r() * 40, 58 + r() * 30, 26];
      leaf(x, y, 7 + r() * 9, r() * Math.PI * 2, `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`);
    }
  });
}

/** Soft soot plume (alpha map: luminance in G) for above hearths: dense at the bottom, spreading up. */
export function getSootTexture() {
  return canvasTex('soot', 128, 256, (g, w, h) => {
    const r = rng(29);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const t = r();
      const y = h * (1 - t * 0.95);
      const x = w / 2 + (r() - 0.5) * w * (0.2 + t * 0.7);
      const rad = w * (0.12 + t * 0.35);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${0.16 * (1 - t * 0.7)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
  }, { srgb: false });
}

/** Radial falloff as an alpha map (luminance in G): contact shadows, halos. */
export function getBlobTexture() {
  return canvasTex('blob', 128, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 63);
    grd.addColorStop(0, 'rgb(255,255,255)');
    grd.addColorStop(0.45, 'rgb(170,170,170)');
    grd.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }, { srgb: false });
}

/** Glowing ember bed (emissive map): coals with hot cracks. */
export function getEmberTexture() {
  // a bed of charcoal: dark crusted lumps with glowing cracks between them, a few hot hearts
  return canvasTex('embers', 256, 128, (g, w, h) => {
    const r = rng(83);
    g.fillStyle = 'rgb(70,14,2)';
    g.fillRect(0, 0, w, h);
    // hot glow under everything, strongest in the middle of the bed
    const hg = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.5);
    hg.addColorStop(0, 'rgba(255,120,30,0.9)');
    hg.addColorStop(0.5, 'rgba(200,50,8,0.6)');
    hg.addColorStop(1, 'rgba(40,6,0,0.9)');
    g.fillStyle = hg;
    g.fillRect(0, 0, w, h);
    // charcoal lumps (leave thin bright cracks between them)
    for (let i = 0; i < 260; i++) {
      const x = r() * w;
      const y = r() * h;
      const rx = 4 + r() * 10;
      const ry = 3 + r() * 7;
      const v = 6 + r() * 16;
      g.fillStyle = `rgb(${v + 4},${v * 0.7},${v * 0.5})`;
      g.beginPath();
      g.ellipse(x, y, rx, ry, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
      if (r() < 0.25) {
        // a glowing rim on one side of the lump
        g.strokeStyle = `rgba(255,${90 + r() * 80},20,${0.3 + r() * 0.4})`;
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(x, y, rx, ry, r() * Math.PI, 0, Math.PI * (0.4 + r() * 0.6));
        g.stroke();
      }
    }
    // white-ash dusting
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(120,110,100,${0.15 + r() * 0.25})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
    }
  });
}

/** Woven wall tapestry: border, millefleur field, a stag beneath a tree. */
export function getTapestryTexture(variant = 0) {
  return canvasTex(`tapestry_${variant}`, 256, 384, (g, w, h) => {
    const r = rng(141 + variant);
    const pals = [['#5a1a18', '#2a3a26', '#c8a050', '#e8d8b0'], ['#1c2c48', '#4a2a20', '#c09848', '#e0d0a8']];
    const [border, field, gold, pale] = pals[variant % pals.length];
    g.fillStyle = border;
    g.fillRect(0, 0, w, h);
    g.fillStyle = field;
    g.fillRect(18, 18, w - 36, h - 50);
    g.strokeStyle = gold;
    g.lineWidth = 3;
    g.strokeRect(14, 14, w - 28, h - 42);
    // millefleur
    for (let i = 0; i < 260; i++) {
      const x = 22 + r() * (w - 44);
      const y = 22 + r() * (h - 60);
      g.fillStyle = ['#c8a050', '#b04030', '#d8d0b0', '#6a8a50'][Math.floor(r() * 4)];
      g.globalAlpha = 0.55;
      g.fillRect(x, y, 2 + r() * 2, 2 + r() * 2);
    }
    g.globalAlpha = 1;
    // tree
    g.fillStyle = '#3a2a1a';
    g.fillRect(w / 2 - 6, h * 0.3, 12, h * 0.36);
    g.fillStyle = '#3e5a30';
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.arc(w / 2 + (r() - 0.5) * 120, h * 0.26 + (r() - 0.5) * 80, 10 + r() * 14, 0, Math.PI * 2);
      g.fill();
    }
    // stag
    g.fillStyle = pale;
    g.save();
    g.translate(w / 2, h * 0.74);
    g.beginPath();
    g.ellipse(0, 0, 40, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-34, 6, 6, 32);
    g.fillRect(-20, 8, 6, 30);
    g.fillRect(18, 8, 6, 30);
    g.fillRect(30, 6, 6, 32);
    g.beginPath();
    g.moveTo(30, -8);
    g.lineTo(52, -34);
    g.lineTo(60, -28);
    g.lineTo(40, 0);
    g.fill();
    g.strokeStyle = pale;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(54, -32);
    g.lineTo(46, -58);
    g.moveTo(50, -46);
    g.lineTo(38, -52);
    g.moveTo(58, -32);
    g.lineTo(70, -56);
    g.moveTo(64, -44);
    g.lineTo(76, -46);
    g.stroke();
    g.restore();
    // fringe + weave texture + fading
    g.fillStyle = gold;
    for (let x = 4; x < w; x += 6) g.fillRect(x, h - 26, 3, 22 + r() * 4);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,210'},${r() * 0.07})`;
      g.fillRect(r() * w, r() * h, 1, 1 + r() * 2);
    }
  });
}

/** Parchment notices pinned to a board (alpha-free, includes the board). */
export function getNoticeTexture() {
  return canvasTex('notices', 256, 192, (g, w, h) => {
    const r = rng(171);
    g.fillStyle = '#4a3220';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.1})`;
      g.fillRect(0, i * 32 + 30, w, 2);
    }
    for (let i = 0; i < 7; i++) {
      const pw = 46 + r() * 36;
      const ph = 52 + r() * 40;
      const x = 10 + r() * (w - pw - 20);
      const y = 10 + r() * (h - ph - 20);
      g.save();
      g.translate(x + pw / 2, y + ph / 2);
      g.rotate((r() - 0.5) * 0.25);
      const t = 200 + r() * 40;
      g.fillStyle = `rgb(${t | 0},${(t * 0.92) | 0},${(t * 0.74) | 0})`;
      g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.fillStyle = 'rgba(60,40,20,0.75)';
      for (let l = 0; l < 7; l++) g.fillRect(-pw / 2 + 6, -ph / 2 + 10 + l * 7, (pw - 12) * (0.5 + r() * 0.5), 2);
      g.fillStyle = '#7a1a10';
      g.beginPath();
      g.arc(0, -ph / 2 + 4, 3, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  });
}

/** Woven rug with border bands and a central medallion. */
export function getRugTexture(variant = 0) {
  return canvasTex(`rug_${variant}`, 512, 384, (g, w, h) => {
    const r = rng(101 + variant);
    const pals = [['#6e1f1a', '#c89a4a', '#1f2a48', '#e0cfa0'], ['#1f3050', '#b88a40', '#6a1c18', '#d8c8a0']];
    const [field, gold, dark, pale] = pals[variant % pals.length];
    g.fillStyle = field;
    g.fillRect(0, 0, w, h);
    // abrash: hand-dyed wool batches give the field faint horizontal bands
    for (let y = 0; y < h; y += 6 + Math.floor(r() * 18)) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,230,200'},${0.03 + r() * 0.05})`;
      g.fillRect(0, y, w, 4 + r() * 14);
    }
    const band = (i, col, lw = 12) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.strokeRect(i, i, w - 2 * i, h - 2 * i);
    };
    band(14, dark);
    band(30, gold, 10);
    band(46, dark);
    // stepped (knotted) border motif: little hooked diamonds along the band
    g.fillStyle = pale;
    for (let x = 64; x < w - 64; x += 22) {
      for (const y of [30, h - 30]) {
        g.fillRect(x - 3, y - 6, 6, 12);
        g.fillRect(x - 6, y - 3, 12, 6);
      }
    }
    for (let y = 64; y < h - 64; y += 22) {
      for (const x of [30, w - 30]) {
        g.fillRect(x - 3, y - 6, 6, 12);
        g.fillRect(x - 6, y - 3, 12, 6);
      }
    }
    // medallion: stepped lozenge (knots make stairs, not smooth diagonals)
    const lozenge = (rx, ry, col) => {
      g.fillStyle = col;
      for (let y = -ry; y <= ry; y += 4) {
        const half = Math.round((rx * (1 - Math.abs(y) / ry)) / 4) * 4;
        g.fillRect(w / 2 - half, h / 2 + y, half * 2, 4);
      }
    };
    lozenge(124, 84, dark);
    lozenge(96, 64, pale);
    lozenge(76, 50, gold);
    lozenge(36, 24, field);
    lozenge(14, 10, dark);
    // corner guls
    for (const [cx, cy] of [[110, 100], [w - 110, 100], [110, h - 100], [w - 110, h - 100]]) {
      g.fillStyle = gold;
      for (let y = -16; y <= 16; y += 4) {
        const half = Math.round((22 * (1 - Math.abs(y) / 16)) / 4) * 4;
        g.fillRect(cx - half, cy + y, half * 2, 4);
      }
      g.fillStyle = dark;
      g.fillRect(cx - 4, cy - 4, 8, 8);
    }
    // knot grain: every 2 px a knot of slightly different wool
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const k = 0.86 + r() * 0.24;
        for (let yy = 0; yy < 2; yy++) {
          for (let xx = 0; xx < 2; xx++) {
            const i = ((y + yy) * w + x + xx) * 4;
            const sh = xx === 0 && yy === 0 ? 1.06 : yy === 1 ? 0.94 : 1;
            d[i] = Math.min(255, d[i] * k * sh);
            d[i + 1] = Math.min(255, d[i + 1] * k * sh);
            d[i + 2] = Math.min(255, d[i + 2] * k * sh);
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    // wear: a trodden path across the middle (pile worn down to the pale warp), soiled edges
    for (let i = 0; i < 260; i++) {
      const x = w * (0.2 + r() * 0.6);
      const y = h * (0.35 + r() * 0.3);
      const rad = 6 + r() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(205,185,150,${0.05 + r() * 0.05})`);
      gr.addColorStop(1, 'rgba(205,185,150,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const edge = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(20,12,6,0.35)');
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
    // vegetable dyes, decades of soot and boots: knock the saturation well down, and a few
    // old ale stains
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = 'rgba(128,128,128,0.45)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 4; i++) {
      const x = w * (0.15 + r() * 0.7);
      const y = h * (0.15 + r() * 0.7);
      const rad = 18 + r() * 40;
      const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      gr.addColorStop(0, 'rgba(150,120,90,0.5)');
      gr.addColorStop(0.8, 'rgba(120,95,70,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.globalCompositeOperation = 'source-over';
  });
}

/** Rug pile bump: knot grid + matted patches (luminance height). */
export function getRugBumpTexture() {
  return canvasTex('rug_bump', 256, 192, (g, w, h) => {
    const r = rng(117);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const knot = (x % 2 === 0 ? 30 : 0) + (y % 2 === 0 ? 20 : 0);
        const v = 120 + knot + r() * 60;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 40; i++) {
      const x = w * (0.2 + r() * 0.6);
      const y = h * (0.3 + r() * 0.4);
      const rad = 6 + r() * 18;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(60,60,60,0.35)');
      gr.addColorStop(1, 'rgba(60,60,60,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }, { srgb: false });
}

/** Rug fringe: knotted warp threads hanging off the short ends (alpha in the texture). */
export function getRugFringeTexture() {
  return canvasTex('rug_fringe', 256, 32, (g, w, h) => {
    const r = rng(131);
    g.clearRect(0, 0, w, h);
    for (let x = 1; x < w; x += 3) {
      const len = h * (0.55 + r() * 0.45);
      const sway = (r() - 0.5) * 3;
      const t = 200 + Math.floor(r() * 40);
      g.strokeStyle = `rgb(${t},${t - 18},${t - 52})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + sway * 0.5, len * 0.5, x + sway, len);
      g.stroke();
    }
    // knots where the warp is tied off against the selvedge
    for (let x = 4; x < w; x += 12) {
      g.fillStyle = 'rgba(190,170,130,1)';
      g.fillRect(x - 3, 0, 7, 4);
    }
  });
}

/**
 * Banner of Bane: a long crimson cloth with a black clenched hand within a
 * ring of black spikes, a black border and a ragged, singed hem (alpha).
 */
export function getBaneBannerTexture() {
  return canvasTex('banner_bane', 192, 512, (g, w, h) => {
    const r = rng(613);
    g.clearRect(0, 0, w, h);
    // ragged hem: a jagged line along the bottom
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(w, h * 0.9);
    for (let k = 12; k >= 0; k--) g.lineTo((w * k) / 12, h * (0.9 + (k % 2 ? 0.06 : 0.02) + r() * 0.03));
    g.closePath();
    g.save();
    g.clip();
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#4a0806');
    grad.addColorStop(0.5, '#7e100c');
    grad.addColorStop(1, '#4a0806');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // weave
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,90,60'},${r() * 0.06})`;
      g.fillRect(r() * w, r() * h, 1, 1 + r() * 3);
    }
    // black border bands
    g.fillStyle = '#0c0807';
    g.fillRect(0, 0, w, 22);
    g.fillRect(0, 22, 12, h);
    g.fillRect(w - 12, 22, 12, h);
    g.fillRect(0, h * 0.78, w, 10);
    // spiked ring
    const cx = w / 2;
    const cy = h * 0.38;
    g.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const rr = k % 2 ? 62 : 74;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#7e100c';
    g.beginPath();
    g.arc(cx, cy, 54, 0, Math.PI * 2);
    g.fill();
    // the black hand (fingers together, thumb out)
    g.fillStyle = '#0c0807';
    const rr = (x, y, ww, hh, rad) => {
      g.beginPath();
      g.moveTo(x + rad, y);
      g.arcTo(x + ww, y, x + ww, y + hh, rad);
      g.arcTo(x + ww, y + hh, x, y + hh, rad);
      g.arcTo(x, y + hh, x, y, rad);
      g.arcTo(x, y, x + ww, y, rad);
      g.fill();
    };
    rr(cx - 22, cy - 6, 44, 40, 8);
    for (let k = 0; k < 4; k++) rr(cx - 22 + k * 11.5, cy - 40 + (k === 1 || k === 2 ? -6 : 0), 9.5, 40, 4.5);
    g.save();
    g.translate(cx + 22, cy + 8);
    g.rotate(-0.6);
    rr(-5, -26, 10, 28, 5);
    g.restore();
    rr(cx - 14, cy + 30, 28, 14, 3);
    // tarnished gold thread motto line
    g.fillStyle = 'rgba(200,150,60,0.55)';
    for (let k = 0; k < 7; k++) g.fillRect(cx - 50 + k * 15, h * 0.62, 9, 3);
    // soot and singeing toward the hem, fading toward the folds
    const grd = g.createLinearGradient(0, h * 0.55, 0, h);
    grd.addColorStop(0, 'rgba(10,4,2,0)');
    grd.addColorStop(1, 'rgba(10,4,2,0.8)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.restore();
  });
}

/** Long processional runner: crimson wool, black and tarnished-gold borders (tiles along v). */
export function getRunnerTexture() {
  return canvasTex('runner_bane', 128, 256, (g, w, h) => {
    const r = rng(617);
    g.fillStyle = '#5e0c0a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0e0807';
    g.fillRect(0, 0, 14, h);
    g.fillRect(w - 14, 0, 14, h);
    g.fillStyle = '#8a6a30';
    g.fillRect(16, 0, 3, h);
    g.fillRect(w - 19, 0, 3, h);
    // stepped lozenges down the centre
    g.fillStyle = '#2a0605';
    for (let y = 0; y < h; y += 64) {
      g.beginPath();
      g.moveTo(w / 2, y + 8);
      g.lineTo(w / 2 + 26, y + 32);
      g.lineTo(w / 2, y + 56);
      g.lineTo(w / 2 - 26, y + 32);
      g.closePath();
      g.fill();
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,120,90'},${r() * 0.07})`;
      g.fillRect(r() * w, r() * h, 1, 1 + r() * 2);
    }
    // wear down the middle (trodden)
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0.3, 'rgba(30,20,16,0)');
    grd.addColorStop(0.5, 'rgba(30,20,16,0.25)');
    grd.addColorStop(0.7, 'rgba(30,20,16,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, { repeat: true });
}

/** Fire scorch above an opening (alpha in luminance): dense at the lintel, licking upward in tongues. */
export function getScorchTexture() {
  return canvasTex('scorch', 128, 256, (g, w, h) => {
    const r = rng(733);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const t = Math.pow(r(), 1.4);
      const y = h * (1 - t * 0.98);
      const x = w / 2 + (r() - 0.5) * w * (0.75 - t * 0.35) + Math.sin(t * 9 + i) * w * 0.08;
      const rad = w * (0.08 + (1 - t) * 0.22);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${0.32 * (1 - t * 0.8)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    // keep the sides soft
    const fade = g.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.18, 'rgba(0,0,0,0)');
    fade.addColorStop(0.82, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    // ...and the ends: the plume starts softly at the torch head and dies out at the top
    const vf = g.createLinearGradient(0, 0, 0, h);
    vf.addColorStop(0, 'rgba(0,0,0,1)');
    vf.addColorStop(0.12, 'rgba(0,0,0,0)');
    vf.addColorStop(0.84, 'rgba(0,0,0,0)');
    vf.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = vf;
    g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

/** Blotchy ground stain (alpha in luminance): soft irregular patch with drip-like lobes. */
export function getStainTexture(variant = 0) {
  return canvasTex(`stain_${variant}`, 256, 256, (g, w, h) => {
    const r = rng(907 + variant * 13);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.7) * w * 0.32;
      const x = w / 2 + Math.cos(a) * d;
      const y = h / 2 + Math.sin(a) * d * 0.8;
      const rad = w * (0.05 + r() * 0.13) * (1 - d / (w * 0.45));
      const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(2, rad));
      gr.addColorStop(0, `rgba(255,255,255,${0.12 + r() * 0.16})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    // fine speckle so the edge breaks up
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
      const a = r() * Math.PI * 2;
      const d = r() * w * 0.45;
      g.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 1 + r() * 2, 1 + r() * 2);
    }
  }, { srgb: false });
}

/**
 * Altar cloth of the Black Hand: crimson velvet with a gold-embroidered border, a running
 * key pattern, a black-hand roundel and a gold fringe at the hem. u across, v from the back
 * of the altar top (v=0) to the hem (v=1). Paired with getAltarClothORM() (G rough, B metal).
 */
function drawAltarCloth(g, w, h, orm) {
  const r = rng(733);
  const gold = orm ? 'rgb(0,90,255)' : '#c99a3a';
  const goldDk = orm ? 'rgb(0,140,200)' : '#7a5a1e';
  g.fillStyle = orm ? 'rgb(0,235,0)' : '#5e0a09';
  g.fillRect(0, 0, w, h);
  if (!orm) {
    // velvet: pile streaks and a soft sheen gradient across
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.5, 'rgba(255,60,40,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,80,60'},${r() * 0.07})`;
      g.fillRect(r() * w, r() * h, 1, 2 + r() * 5);
    }
    // wax drips and old stains near the top (where the candles stand)
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(20,4,4,${0.2 + r() * 0.3})`;
      g.beginPath();
      g.ellipse(r() * w, h * (0.1 + r() * 0.3), 3 + r() * 9, 2 + r() * 6, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // embroidered borders down both sides and above the hem
  const band = (x, y, ww, hh) => {
    g.fillStyle = goldDk;
    g.fillRect(x, y, ww, hh);
    g.fillStyle = gold;
    g.fillRect(x + 2, y + 2, ww - 4, 3);
    g.fillRect(x + 2, y + hh - 5, ww - 4, 3);
    // key pattern stitched inside
    const horiz = ww > hh;
    const n = Math.floor((horiz ? ww : hh) / 18);
    for (let k = 0; k < n; k++) {
      if (horiz) {
        const xx = x + k * 18 + 4;
        g.fillRect(xx, y + 8, 10, 3);
        g.fillRect(xx + 7, y + 8, 3, hh - 16);
        g.fillRect(xx, y + hh - 11, 10, 3);
      } else {
        const yy = y + k * 18 + 4;
        g.fillRect(x + 8, yy, 3, 10);
        g.fillRect(x + 8, yy + 7, ww - 16, 3);
        g.fillRect(x + ww - 11, yy, 3, 10);
      }
    }
  };
  band(10, 0, 30, h * 0.93);
  band(w - 40, 0, 30, h * 0.93);
  band(10, h * 0.86, w - 20, 30);
  // roundel with the black hand on the hanging front
  const cx = w / 2;
  const cy = h * 0.74;
  g.fillStyle = gold;
  g.beginPath();
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const rr = k % 2 ? 46 : 54;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.fill();
  g.fillStyle = orm ? 'rgb(0,230,0)' : '#120807';
  g.beginPath();
  g.arc(cx, cy, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = gold;
  const rr = (x, y, ww, hh, rad) => {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + ww, y, x + ww, y + hh, rad);
    g.arcTo(x + ww, y + hh, x, y + hh, rad);
    g.arcTo(x, y + hh, x, y, rad);
    g.arcTo(x, y, x + ww, y, rad);
    g.fill();
  };
  rr(cx - 15, cy - 2, 30, 26, 6);
  for (let k = 0; k < 4; k++) rr(cx - 15 + k * 7.8, cy - 26 + (k === 1 || k === 2 ? -4 : 0), 6.4, 28, 3);
  rr(cx + 12, cy + 2, 14, 7, 3);
  // fringe: gold threads below the last band (alpha-tested: the gaps are open)
  g.clearRect(0, h * 0.86 + 30, w, h);
  for (let x = 12; x < w - 12; x += 3) {
    g.fillStyle = r() < 0.5 ? gold : goldDk;
    g.fillRect(x, h * 0.86 + 30, 2, h * 0.14 - 30 - r() * 6);
  }
}
export function getAltarClothTexture() {
  return canvasTex('altar_cloth', 256, 512, (g, w, h) => drawAltarCloth(g, w, h, false));
}
export function getAltarClothORM() {
  return canvasTex('altar_cloth_orm', 256, 512, (g, w, h) => drawAltarCloth(g, w, h, true), { srgb: false });
}

/**
 * Daylight seen from inside through small leaded quarrels: bright blue-white sky, the roofs and a
 * chimney of the house opposite, the faint green of a garden — leading cames drawn dark.
 */
function getWindowSkyTexture() {
  return canvasTex('window_sky', 128, 256, (g, w, h) => {
    const r = rng(17);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#cfe0f6');
    grd.addColorStop(0.45, '#eef4fb');
    grd.addColorStop(0.62, '#f6f3ea');
    grd.addColorStop(1, '#b9c2a8');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // roofs opposite (a soft, light silhouette: they are bright too, in full daylight)
    g.fillStyle = 'rgba(120,118,124,0.55)';
    g.beginPath();
    g.moveTo(0, h * 0.72);
    g.lineTo(w * 0.35, h * 0.56);
    g.lineTo(w * 0.62, h * 0.7);
    g.lineTo(w * 0.62, h * 0.62);
    g.lineTo(w, h * 0.6);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
    g.fillRect(w * 0.7, h * 0.5, w * 0.08, h * 0.1);
    // glass: bullseye ripples and per-quarrel tint
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '150,170,190'},${r() * 0.12})`;
      g.beginPath();
      g.arc(r() * w, r() * h, 2 + r() * 6, 0, Math.PI * 2);
      g.fill();
    }
    // lead cames (diamond lattice)
    g.strokeStyle = 'rgba(20,20,24,0.9)';
    g.lineWidth = 2;
    for (let k = -h; k < w + h; k += 22) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + h * 0.65, h);
      g.stroke();
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k - h * 0.65, h);
      g.stroke();
    }
  });
}

/**
 * Rain runoff below a ledge (sill, string course, cornice), alpha in luminance. u tiles
 * horizontally (≈1 m per repeat); v runs from the ledge (v=0, top) down. Many thin drip
 * streaks of uneven length and weight, a darker wash right under the ledge, ragged ends.
 */
export function getRunoffTexture() {
  return canvasTex('runoff', 256, 512, (g, w, h) => {
    const r = rng(1201);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    // the wet band straight under the drip edge
    const band = g.createLinearGradient(0, 0, 0, h * 0.22);
    band.addColorStop(0, 'rgba(255,255,255,0.55)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = band;
    g.fillRect(0, 0, w, h * 0.22);
    // streaks: drawn three times shifted by ±w so they wrap seamlessly in u
    const streaks = [];
    for (let i = 0; i < 110; i++) {
      const len = Math.pow(r(), 1.6) * 0.95 + 0.05;
      streaks.push({ x: r() * w, wd: 0.6 + Math.pow(r(), 3) * 9, len, a: 0.05 + r() * 0.22 * (1.2 - len * 0.5), wob: r() * 6.28 });
    }
    for (const s of streaks) {
      for (const off of [-w, 0, w]) {
        const L = s.len * h;
        const gr = g.createLinearGradient(0, 0, 0, L);
        gr.addColorStop(0, `rgba(255,255,255,${s.a})`);
        gr.addColorStop(0.7, `rgba(255,255,255,${s.a * 0.6})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath();
        const x0 = s.x + off;
        g.moveTo(x0 - s.wd / 2, 0);
        for (let y = 0; y <= L; y += 8) g.lineTo(x0 - s.wd / 2 * (1 - (y / L) * 0.6) + Math.sin(y * 0.02 + s.wob) * 1.5, y);
        for (let y = L; y >= 0; y -= 8) g.lineTo(x0 + s.wd / 2 * (1 - (y / L) * 0.6) + Math.sin(y * 0.02 + s.wob) * 1.5, y);
        g.closePath();
        g.fill();
      }
    }
  }, { srgb: false, repeat: true });
}

/**
 * Ground splash and rising damp at a wall foot, alpha in luminance. u tiles (≈2 m); v=0 at the
 * ground, v=1 at the top of the band (≈0.9 m). Dense at the ground, a ragged tide line, mud
 * splash flecks thrown up the wall.
 */
export function getPlinthGrimeTexture() {
  return canvasTex('plinth_grime', 512, 256, (g, w, h) => {
    const r = rng(1301);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    // canvas y down: ground at the bottom row (v=0 maps to the bottom with flipY)
    const base = g.createLinearGradient(0, h, 0, 0);
    base.addColorStop(0, 'rgba(255,255,255,0.85)');
    base.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    base.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    base.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // ragged damp tide line: wrapped lobes
    for (let i = 0; i < 60; i++) {
      const x = r() * w;
      const top = h * (0.35 + r() * 0.35);
      const rad = 10 + r() * 40;
      for (const off of [-w, 0, w]) {
        const gr = g.createRadialGradient(x + off, top, 0, x + off, top, rad);
        gr.addColorStop(0, `rgba(255,255,255,${0.1 + r() * 0.12})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x + off - rad, top - rad, rad * 2, h);
      }
    }
    // splash flecks
    for (let i = 0; i < 1400; i++) {
      const t = Math.pow(r(), 2.2);
      const y = h - t * h * 0.9;
      g.fillStyle = `rgba(255,255,255,${(0.08 + r() * 0.3) * (1 - t)})`;
      const s = 1 + r() * 2.5;
      g.fillRect(r() * w, y, s, s * (0.7 + r() * 0.8));
    }
  }, { srgb: false, repeat: true });
}

/**
 * Cart rut along a street (alpha in luminance): a worn track across v (centre = v 0.5), tiling
 * in u (≈3 m). Broken, uneven edges; darker, polished core; occasional gaps where setts stand proud.
 */
export function getRutTexture() {
  return canvasTex('rut', 512, 128, (g, w, h) => {
    const r = rng(1401);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = r() * w;
      const y = h / 2 + (r() - 0.5) * h * 0.38;
      const rad = 6 + r() * 22;
      for (const off of [-w, 0, w]) {
        const gr = g.createRadialGradient(x + off, y, 0, x + off, y, rad);
        gr.addColorStop(0, `rgba(255,255,255,${0.05 + r() * 0.08})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x + off - rad, y - rad, rad * 2, rad * 2);
      }
    }
    // fade toward both edges of the strip
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.3, 'rgba(0,0,0,0)');
    fade.addColorStop(0.7, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
  }, { srgb: false, repeat: true });
}

/**
 * Normal map for a carved inscription plaque (pairs with getInscriptionTexture: same layout):
 * the letters are V-cut into the face, the border moulding stands proud, so each stroke catches
 * light on one lip and falls into shadow on the other.
 */
export function getInscriptionNormal(text) {
  const key = `inscrN_${text}`;
  return canvasTex(key, 1024, 256, (g, w, h) => {
    // height field: white = face, dark = cut
    const hc = document.createElement('canvas');
    hc.width = w;
    hc.height = h;
    const hg = hc.getContext('2d');
    hg.scale(2, 2);
    const W = w / 2;
    const H = h / 2;
    hg.fillStyle = '#c0c0c0';
    hg.fillRect(0, 0, W, H);
    hg.strokeStyle = '#ffffff';
    hg.lineWidth = 6;
    hg.strokeRect(11, 11, W - 22, H - 22);
    hg.font = `600 60px Georgia, 'Times New Roman', serif`;
    hg.textAlign = 'center';
    hg.textBaseline = 'middle';
    const sx = Math.min(1, (W - 80) / Math.max(1, hg.measureText(text).width));
    hg.save();
    hg.translate(W / 2, H / 2);
    hg.scale(sx, 1);
    hg.filter = 'blur(1.2px)';
    hg.fillStyle = '#202020';
    hg.fillText(text, 0, 1);
    hg.restore();
    const src = hg.getImageData(0, 0, w, h).data;
    const out = g.createImageData(w, h);
    const ht = (x, y) => src[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
    const k = 3.0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (ht(x + 1, y) - ht(x - 1, y)) * k;
        const dy = (ht(x, y + 1) - ht(x, y - 1)) * k;
        const nx = -dx;
        const ny = dy; // canvas y runs down; normal-map green is up
        const nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * w + x) * 4;
        out.data[i] = (nx / l * 0.5 + 0.5) * 255;
        out.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
        out.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
  }, { srgb: false });
}
