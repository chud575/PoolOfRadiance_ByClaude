import * as THREE from 'three';
import { paintDevice } from './heraldry.js';
import { materialCanvases, makeCanvas } from '../../render/textures/canvas.js';
import { fbm, valueNoise, clamp01, smooth } from '../../render/textures/noise.js';

/**
 * Procedural PBR texture sets for the 3D miniatures (character creation,
 * camp). Neutral-toned where possible so one texture serves every tint via
 * material.color. Cached for the page lifetime (small: 128-256 px each).
 */

const cache = new Map();

function toTex(canvas, srgb, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** @returns {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture}} */
function set(key, size, fn, strength = 2.5) {
  if (cache.has(key)) return cache.get(key);
  const c = materialCanvases(size, fn, { normalStrength: strength });
  const s = { map: toTex(c.color, true), normalMap: toTex(c.normal, false), roughnessMap: toTex(c.rough, false) };
  cache.set(key, s);
  return s;
}

const fract = (x) => x - Math.floor(x);

/** Riveted steel mail: interlocking rings in offset rows. */
export function mailSet() {
  return set('mail', 256, (u, v) => {
    const rows = 32;
    const cols = 24;
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const r = Math.floor(v * rows) + dy;
      const off = (r & 1) * 0.5;
      const cx = (Math.floor(u * cols - off) + 0.5 + off) / cols;
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx / cols;
        const py = (r + 0.5) / rows;
        const ddx = fract(u - px + 0.5) - 0.5;
        const d = Math.hypot(ddx * cols, (v - py) * rows * 0.78);
        const ring = Math.max(0, 1 - Math.abs(d - 0.42) / 0.17);
        // Lower rows overlap the upper ones.
        best = Math.max(best, ring * (0.75 + 0.25 * (dy + 1) / 2));
      }
    }
    const n = fbm(u * 6, v * 6, { octaves: 3, period: 6, seed: 3 });
    const k = 0.18 + best * (0.72 + n * 0.2);
    return { c: [k, k * 1.01, k * 1.04], h: best, r: 0.75 - best * 0.4 };
  }, 3.2);
}

/** Overlapping lamellar scales (tinted bronze/steel by material colour). */
export function scaleSet() {
  return set('scale', 256, (u, v) => {
    const rows = 12;
    const cols = 10;
    const r = Math.floor(v * rows);
    const fy = fract(v * rows);
    const off = (r & 1) * 0.5;
    const fx = fract(u * cols + off);
    // Rounded bottom edge, rising toward it.
    const edge = 1 - Math.hypot((fx - 0.5) * 1.3, Math.max(0, fy - 0.35) * 1.35);
    const inside = smooth(0.0, 0.08, edge);
    const h = inside * (0.35 + fy * 0.65);
    const n = fbm(u * 8, v * 8, { octaves: 3, period: 8, seed: 9 });
    const k = (0.3 + h * 0.6) * (0.85 + n * 0.3);
    return { c: [k, k * 0.92, k * 0.8], h, r: 0.55 - inside * 0.2 + n * 0.15 };
  }, 3.5);
}

/** Brushed, scratched plate steel. */
export function steelSet() {
  return set('steel', 256, (u, v) => {
    const brush = valueNoise(u * 4, v * 160, 160, 5) * 0.5 + valueNoise(u * 9, v * 300, 300, 6) * 0.5;
    const n = fbm(u * 5, v * 5, { octaves: 4, period: 5, seed: 7 });
    let scratch = 0;
    for (let i = 0; i < 3; i++) {
      const w = fract(u * (3 + i) + v * (1.7 - i * 0.9) + i * 0.37);
      scratch = Math.max(scratch, Math.max(0, 1 - Math.abs(w - 0.5) * 220) * (valueNoise(u * 10, v * 10, 10, i + 20) > 0.6 ? 1 : 0));
    }
    const k = 0.7 + brush * 0.1 + n * 0.12 - scratch * 0.1;
    return { c: [k, k, k * 1.02], h: brush * 0.03 - scratch * 0.15 + n * 0.25, r: 0.3 + n * 0.3 + scratch * 0.2 };
  }, 0.8);
}

/** Oiled leather with creases and a stitched seam. */
export function leatherSet() {
  return set('leather', 256, (u, v) => {
    const n = fbm(u * 6, v * 6, { octaves: 5, period: 6, seed: 11 });
    const crease = Math.abs(fbm(u * 3, v * 9, { octaves: 3, period: 3, seed: 12 }) - 0.5);
    const seamD = Math.min(Math.abs(fract(v * 2) - 0.02), Math.abs(fract(u * 2) - 0.02));
    const stitch = seamD < 0.012 && fract((u + v) * 60) < 0.5 ? 1 : 0;
    const groove = seamD < 0.03 ? 1 - seamD / 0.03 : 0;
    const k = 0.42 + n * 0.3 - (crease < 0.03 ? 0.12 : 0);
    return {
      c: stitch ? [0.62, 0.52, 0.36] : [k * 0.98, k * 0.9, k * 0.8],
      h: n * 0.4 - (crease < 0.03 ? 0.2 : 0) - groove * 0.25 + stitch * 0.2,
      r: 0.55 + n * 0.25,
    };
  }, 2.6);
}

/** Woven wool (neutral, tinted by the cloth colour). */
export function clothSet() {
  return set('cloth', 256, (u, v) => {
    const wx = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5;
    const wy = Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5;
    const over = (Math.floor(u * 64) + Math.floor(v * 64)) & 1 ? wx : wy;
    const n = fbm(u * 5, v * 5, { octaves: 4, period: 5, seed: 13 });
    const slub = valueNoise(u * 3, v * 90, 90, 14) * 0.15;
    const k = 0.72 + over * 0.12 + n * 0.22 - slub;
    return { c: [k, k, k], h: over * 0.5 + n * 0.3, r: 0.92 };
  }, 1.8);
}

/** Hair / beard strands running along v (neutral; tinted). */
export function hairSet() {
  return set('hair', 256, (u, v) => {
    const s = valueNoise(u * 96, v * 3, 96, 21) * 0.6 + valueNoise(u * 190, v * 5, 190, 22) * 0.4;
    const clump = valueNoise(u * 14, v * 1.5, 14, 23);
    const k = 0.55 + s * 0.5 + clump * 0.15;
    return { c: [k, k, k], h: s * 0.8 + clump * 0.4, r: 0.45 + (1 - s) * 0.3 };
  }, 3.0);
}

/** Short dense fur. */
export function furSet() {
  return set('fur', 256, (u, v) => {
    const s = valueNoise(u * 60 + Math.sin(v * 20) * 0.6, v * 24, 60, 31) * 0.7 + fbm(u * 8, v * 8, { octaves: 3, period: 8, seed: 32 }) * 0.5;
    const k = 0.45 + s * 0.55;
    return { c: [k, k * 0.95, k * 0.9], h: s, r: 0.95 };
  }, 4.0);
}

/** Wood grain for hafts and staves. */
export function woodSet() {
  return set('wood', 128, (u, v) => {
    const g = fbm(u * 3, v * 24, { octaves: 4, period: 3, seed: 41 });
    const ring = fract(g * 6);
    const k = 0.32 + ring * 0.18 + g * 0.1;
    return { c: [k * 1.2, k * 0.85, k * 0.55], h: ring * 0.4, r: 0.6 };
  }, 2.0);
}

/** Painted earth + grass for the miniature's base top. */
export function baseSet() {
  return set('base', 256, (u, v) => {
    const n = fbm(u * 6, v * 6, { octaves: 5, period: 6, seed: 51 });
    const peb = fbm(u * 20, v * 20, { octaves: 2, period: 20, seed: 52 });
    const grass = smooth(0.52, 0.62, fbm(u * 3, v * 3, { octaves: 3, period: 3, seed: 53 }));
    const stone = peb > 0.68 ? 1 : 0;
    const c = stone ? [0.42, 0.4, 0.37] : grass > 0.5 ? [0.2 + n * 0.1, 0.26 + n * 0.12, 0.1] : [0.24 + n * 0.12, 0.19 + n * 0.08, 0.12];
    return { c, h: n * 0.5 + stone * 0.4 + grass * 0.15, r: 0.95 - stone * 0.2 };
  }, 3.0);
}

/**
 * Heraldic device painted on a shield face: the character's arms (heraldry.js, the same device the
 * VIEW sheet and the shield item icon carry), worn enamel and a soft centre highlight.
 * @param {ReturnType<import('./heraldry.js').heraldryOf>} her
 * @param {'round'|'heater'} kind
 */
export function shieldFaceTexture(her, kind) {
  const key = `shield:${her.key}:${kind}`;
  if (cache.has(key)) return cache.get(key);
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = her.field;
  g.fillRect(0, 0, S, S);
  g.save();
  if (kind === 'round') {
    const k = S / 118;
    g.translate((S - 100 * k) / 2, (S - 120 * k) / 2 + 4 * k);
    g.scale(k, k);
  } else {
    // The heater mesh's UVs: the outer outline (8..92, 6..112 in the device box) spans u 0.048..0.952
    // and v 0.035..0.965.
    const sx = (S * 0.904) / 84, sy = (S * 0.93) / 106;
    g.translate(S * 0.048 - 8 * sx, S * 0.035 - 6 * sy);
    g.scale(sx, sy);
  }
  paintDevice(g, her, { clip: null, stroke: '#3a2008' });
  g.restore();
  // Painted wear and a soft centre highlight.
  const rg = g.createRadialGradient(S * 0.4, S * 0.35, 10, S * 0.5, S * 0.5, S * 0.7);
  rg.addColorStop(0, 'rgba(255,255,255,0.16)');
  rg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = fract(Math.sin(i * 12.9898) * 43758.5) * S;
    const y = fract(Math.sin(i * 78.233) * 12543.1) * S;
    g.fillStyle = `rgba(${i % 2 ? '0,0,0' : '255,240,220'},0.05)`;
    g.fillRect(x, y, 2 + (i % 5), 1 + (i % 3));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData = { device: her.key };
  cache.set(key, t);
  return t;
}

const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const rgba = (c, k = 1, a = 1) => {
  const [r, g, b] = hex(c);
  return `rgba(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))},${a})`;
};

/**
 * The face of a miniature's head, painted in equirectangular space so it maps
 * straight onto a (displaced) THREE.SphereGeometry. Direction (x,y,z) on the
 * unit sphere (z = forward) ↔ canvas (atan2(z,-x)/2π·W, acos(y)/π·H).
 * @param {{skin:string, eyes:string, hair:string, fem:boolean, stubble:number, age:number, brow:number}} o
 */
export function faceTexture(o) {
  const key = `face:${JSON.stringify(o)}`;
  if (cache.has(key)) return cache.get(key);
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const P = (x, y) => {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    let phi = Math.atan2(z, -x);
    if (phi < 0) phi += Math.PI * 2;
    return [(phi / (Math.PI * 2)) * W, (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * H];
  };
  const K = W / (Math.PI * 2); // px per unit near the front
  const ell = (x, y, rx, ry, fill, rot = 0) => {
    const [px, py] = P(x, y);
    g.beginPath();
    g.ellipse(px, py, rx * K, ry * K, rot, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  };
  g.fillStyle = o.skin;
  g.fillRect(0, 0, W, H);
  // Mottled skin.
  for (let i = 0; i < 900; i++) {
    const x = fract(Math.sin(i * 91.7) * 4375.5) * W;
    const y = fract(Math.sin(i * 17.3) * 2375.1) * H;
    g.fillStyle = i % 3 ? rgba(o.skin, 0.92, 0.12) : 'rgba(200,90,80,0.06)';
    g.beginPath();
    g.arc(x, y, 3 + (i % 7), 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'blur(6px)';
  // Warm cheeks, nose and ears; cool shade under the brow and jaw.
  ell(-0.42, -0.2, 0.2, 0.14, `rgba(210,90,75,${o.fem ? 0.3 : 0.2})`);
  ell(0.42, -0.2, 0.2, 0.14, `rgba(210,90,75,${o.fem ? 0.3 : 0.2})`);
  ell(0, -0.2, 0.08, 0.1, 'rgba(210,100,80,0.2)');
  for (const s of [-1, 1]) ell(s * 0.36, 0.05, 0.19, 0.12, rgba(o.skin, 0.55, 0.5));
  if (o.stubble > 0) {
    // Beard shadow over the lower face.
    g.fillStyle = rgba(o.hair, 1, 0.45 * o.stubble);
    const pts = [[-0.62, -0.18], [-0.3, -0.34], [0, -0.3], [0.3, -0.34], [0.62, -0.18], [0.55, -0.6], [0.2, -0.9], [-0.2, -0.9], [-0.55, -0.6]].map(([x, y]) => P(x, y));
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  }
  g.filter = 'none';
  // Brows.
  for (const s of [-1, 1]) {
    g.strokeStyle = rgba(o.hair, 0.9, 0.95);
    g.lineCap = 'round';
    g.lineWidth = (o.fem ? 0.028 : 0.042) * K * o.brow;
    const a = P(s * 0.18, 0.2);
    const b = P(s * 0.36, 0.25);
    const e = P(s * 0.54, 0.18);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.quadraticCurveTo(b[0], b[1] - 0.02 * K, e[0], e[1]);
    g.stroke();
  }
  // Eyes: sclera, iris, pupil, lid line, catchlight.
  for (const s of [-1, 1]) {
    const [ex, ey] = P(s * 0.36, 0.04);
    const ew = 0.13 * K;
    const eh = (o.fem ? 0.062 : 0.052) * K;
    g.save();
    g.beginPath();
    g.moveTo(ex - ew, ey);
    g.quadraticCurveTo(ex, ey - eh * 1.9, ex + ew, ey - (o.fem ? 0.012 * K : 0));
    g.quadraticCurveTo(ex, ey + eh * 1.3, ex - ew, ey);
    g.closePath();
    g.fillStyle = '#e6dccd';
    g.fill();
    g.clip();
    g.fillStyle = o.eyes;
    g.beginPath();
    g.arc(ex, ey - eh * 0.2, eh * 1.05, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0706';
    g.beginPath();
    g.arc(ex, ey - eh * 0.2, eh * 0.45, 0, Math.PI * 2);
    g.fill();
    const lid = g.createLinearGradient(0, ey - eh * 1.5, 0, ey);
    lid.addColorStop(0, 'rgba(40,15,10,0.7)');
    lid.addColorStop(1, 'rgba(40,15,10,0)');
    g.fillStyle = lid;
    g.fillRect(ex - ew, ey - eh * 2, ew * 2, eh * 2);
    g.restore();
    g.strokeStyle = 'rgba(25,10,6,0.95)';
    g.lineWidth = (o.fem ? 0.022 : 0.016) * K;
    g.beginPath();
    g.moveTo(ex - ew, ey);
    g.quadraticCurveTo(ex, ey - eh * 1.9, ex + ew * 1.08, ey - (o.fem ? 0.02 * K : 0));
    g.stroke();
    g.fillStyle = 'rgba(255,250,240,0.9)';
    g.beginPath();
    g.arc(ex - eh * 0.35, ey - eh * 0.55, eh * 0.22, 0, Math.PI * 2);
    g.fill();
  }
  // Nostrils + mouth.
  for (const s of [-1, 1]) ell(s * 0.05, -0.28, 0.022, 0.014, 'rgba(60,20,15,0.6)');
  {
    const [mx, my] = P(0, -0.45);
    const mw = (o.fem ? 0.14 : 0.16) * K;
    g.fillStyle = o.fem ? 'rgba(170,60,60,0.85)' : rgba(o.skin, 0.72, 0.9);
    g.beginPath();
    g.moveTo(mx - mw, my);
    g.quadraticCurveTo(mx - mw * 0.4, my - 0.045 * K, mx, my - 0.02 * K);
    g.quadraticCurveTo(mx + mw * 0.4, my - 0.045 * K, mx + mw, my);
    g.quadraticCurveTo(mx, my + 0.07 * K, mx - mw, my);
    g.fill();
    g.strokeStyle = 'rgba(60,20,15,0.8)';
    g.lineWidth = 0.014 * K;
    g.beginPath();
    g.moveTo(mx - mw, my);
    g.quadraticCurveTo(mx, my + 0.012 * K, mx + mw, my);
    g.stroke();
  }
  if (o.age > 0) {
    g.strokeStyle = rgba(o.skin, 0.6, 0.5 * o.age);
    g.lineWidth = 0.01 * K;
    for (let i = 0; i < 3; i++) {
      const a = P(-0.3, 0.38 + i * 0.06);
      const b = P(0.3, 0.38 + i * 0.06);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo((a[0] + b[0]) / 2, a[1] - 0.02 * K, b[0], b[1]);
      g.stroke();
    }
    for (const s of [-1, 1]) {
      const a = P(s * 0.12, -0.26);
      const b = P(s * 0.24, -0.5);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

export { clamp01 };
