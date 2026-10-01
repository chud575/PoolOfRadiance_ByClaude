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
  return canvasTex('embers', 128, 128, (g, w, h) => {
    const r = rng(83);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 3 + r() * 9;
      const hot = r();
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, hot > 0.7 ? 'rgba(255,200,90,1)' : 'rgba(255,90,20,0.9)');
      gr.addColorStop(0.6, 'rgba(160,30,5,0.6)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // dark coal crusts on top
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(10,6,4,${0.5 + r() * 0.5})`;
      g.beginPath();
      g.arc(r() * w, r() * h, 2 + r() * 6, 0, Math.PI * 2);
      g.fill();
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
  return canvasTex(`rug_${variant}`, 256, 192, (g, w, h) => {
    const r = rng(101 + variant);
    const pals = [['#6e1f1a', '#c89a4a', '#1f2a48', '#e0cfa0'], ['#1f3050', '#b88a40', '#6a1c18', '#d8c8a0']];
    const [field, gold, dark, pale] = pals[variant % pals.length];
    g.fillStyle = field;
    g.fillRect(0, 0, w, h);
    const band = (i, col) => {
      g.strokeStyle = col;
      g.lineWidth = 6;
      g.strokeRect(i, i, w - 2 * i, h - 2 * i);
    };
    band(8, dark);
    band(16, gold);
    band(24, dark);
    // zig-zag border motif
    g.strokeStyle = pale;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 30; x < w - 30; x += 10) g.lineTo(x, 34 + ((x / 10) % 2) * 6);
    g.stroke();
    g.beginPath();
    for (let x = 30; x < w - 30; x += 10) g.lineTo(x, h - 34 - ((x / 10) % 2) * 6);
    g.stroke();
    // medallion
    g.save();
    g.translate(w / 2, h / 2);
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(0, -42);
    g.lineTo(62, 0);
    g.lineTo(0, 42);
    g.lineTo(-62, 0);
    g.closePath();
    g.fill();
    g.fillStyle = gold;
    g.beginPath();
    g.moveTo(0, -26);
    g.lineTo(38, 0);
    g.lineTo(0, 26);
    g.lineTo(-38, 0);
    g.closePath();
    g.fill();
    g.fillStyle = field;
    g.fillRect(-8, -8, 16, 16);
    g.restore();
    // weave noise + wear
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,210'},${r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
    }
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6);
    grd.addColorStop(0, 'rgba(230,210,170,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
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
  }, { srgb: false });
}
