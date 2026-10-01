import { fbm, valueNoise, hash2 } from '../../render/textures/noise.js';

/**
 * Pen-and-ink primitives for the cartographer's map: seeded PRNG, wobbly
 * hand-drawn lines, Dyson-style hatching, stipple, watercolour washes, and
 * the procedural parchment / desk surfaces. Everything is deterministic.
 */

/** Small seeded PRNG (mulberry32). */
export function prng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  // Software-backed: these are static, built once, then blitted. (Keeps blur filters
  // and large paths off the GPU rasteriser, which is pathological under SwiftShader.)
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** Ink colours (sepia iron-gall family plus a few illuminator's pigments). */
export const INK = {
  ink: '#2b1a0d',
  inkSoft: 'rgba(43,26,13,0.55)',
  sepia: '#5a3a1c',
  graphite: 'rgba(70,60,50,0.22)',
  vermilion: '#b8321f',
  carmine: '#a8323a',
  ultramarine: '#2c4a8c',
  verdigris: '#3f7f6a',
  gold: '#c9a045',
  goldHi: '#f3d98c',
  goldLo: '#7a5a1c',
  paper: '#efe0bb',
};

/**
 * Polyline points of a hand-drawn line between two points.
 * amp: max perpendicular wobble (px); step: segment length (px).
 */
export function wobblePoints(x0, y0, x1, y1, { amp = 1, step = 10, seed = 0 } = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const n = Math.max(2, Math.ceil(len / step));
  const pts = [];
  const s = (seed * 13.37) % 1000;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = Math.sin(Math.PI * t);
    const o = (valueNoise(s + t * len / 40, s * 0.7, 4096, 7) - 0.5) * 2 * amp * (0.35 + 0.65 * taper);
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  return pts;
}

/** Stroke a wobbly ink line; optional soft bleed underneath. */
export function inkLine(g, x0, y0, x1, y1, { width = 2, color = INK.ink, amp = 1, seed = 0, bleed = 0, cap = 'round' } = {}) {
  const pts = wobblePoints(x0, y0, x1, y1, { amp, seed, step: Math.max(4, width * 3) });
  g.lineCap = cap;
  g.lineJoin = 'round';
  const path = () => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  };
  if (bleed > 0) {
    g.save();
    g.globalAlpha *= 0.18;
    g.strokeStyle = color;
    g.lineWidth = width + bleed;
    path();
    g.stroke();
    g.restore();
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  path();
  g.stroke();
}

/** Short hatching strokes filling a rectangle in the Dyson style (clusters of parallel strokes). */
export function hatchRect(g, x, y, w, h, { seed = 0, size = 10, color = INK.ink, width = 0.8, alpha = 0.7, density = 1 } = {}) {
  const r = prng(seed);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.globalAlpha *= alpha;
  const step = size / density;
  for (let cy = y - step; cy < y + h + step; cy += step) {
    for (let cx = x - step; cx < x + w + step; cx += step) {
      const px = cx + (r() - 0.5) * step * 0.8;
      const py = cy + (r() - 0.5) * step * 0.8;
      const a = r() * Math.PI;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const n = 3 + Math.floor(r() * 2);
      const L = size * (0.55 + r() * 0.35);
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) * size * 0.2;
        const ox = px - sa * o;
        const oy = py + ca * o;
        const l = L * (0.75 + r() * 0.3);
        g.moveTo(ox - ca * l / 2, oy - sa * l / 2);
        g.lineTo(ox + ca * l / 2, oy + sa * l / 2);
      }
      g.stroke();
    }
  }
  g.restore();
}

/** Parallel diagonal lines (engraver's shading) in a rect. */
export function lineShade(g, x, y, w, h, { gap = 5, angle = -Math.PI / 4, color = INK.ink, width = 0.6, alpha = 0.25 } = {}) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.globalAlpha *= alpha;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const R = Math.hypot(w, h) / 2 + gap;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  g.beginPath();
  for (let o = -R; o <= R; o += gap) {
    g.moveTo(cx - sa * o - ca * R, cy + ca * o - sa * R);
    g.lineTo(cx - sa * o + ca * R, cy + ca * o + sa * R);
  }
  g.stroke();
  g.restore();
}

/** Random dots (stipple). */
export function stipple(g, x, y, w, h, { seed = 0, count = 20, r = 1, color = INK.ink, alpha = 0.5 } = {}) {
  const rnd = prng(seed);
  g.save();
  g.fillStyle = color;
  g.globalAlpha *= alpha;
  g.beginPath();
  for (let i = 0; i < count; i++) {
    const px = x + rnd() * w;
    const py = y + rnd() * h;
    const rr = r * (0.5 + rnd() * 0.8);
    g.moveTo(px + rr, py);
    g.arc(px, py, rr, 0, Math.PI * 2);
  }
  g.fill();
  g.restore();
}

/** A tileable fine paper-grain canvas (used as a pattern). */
let grainCache = null;
export function grainTile() {
  if (grainCache) return grainCache;
  const S = 256;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 16, y / 16, { period: 16, octaves: 3, seed: 91 }) * 0.6 + hash2(x, y, 5) * 0.4;
    const fib = valueNoise(x / 40, y / 2.2, 256, 12);
    const v = 200 + (n - 0.5) * 70 + (fib - 0.5) * 26;
    const i = (y * S + x) * 4;
    img.data[i] = v;
    img.data[i + 1] = v * 0.97;
    img.data[i + 2] = v * 0.9;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCache = c;
  return c;
}

/**
 * Deckled parchment sheet with foxing, stains, darkened edges and fibres.
 * Returns a canvas of size (w, h); the sheet occupies an inset rect with
 * a transparent margin carrying a baked contact shadow.
 * @param {number} w @param {number} h @param {{seed?:number, margin?:number, tone?:number[], age?:number, ring?:number[]|null}} opts
 */
export function makeParchment(w, h, { seed = 1, margin = 0, tone = [238, 222, 184], age = 1, ring = [0.015, 0.985] } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const sx = margin;
  const sy = margin;
  const sw = w - margin * 2;
  const sh = h - margin * 2;
  // deckled outline
  const edge = [];
  const per = 2 * (sw + sh);
  const N = Math.ceil(per / 6);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * per;
    let x;
    let y;
    let nx;
    let ny;
    if (t < sw) { x = sx + t; y = sy; nx = 0; ny = -1; } else if (t < sw + sh) { x = sx + sw; y = sy + t - sw; nx = 1; ny = 0; } else if (t < 2 * sw + sh) { x = sx + sw - (t - sw - sh); y = sy + sh; nx = 0; ny = 1; } else { x = sx; y = sy + sh - (t - 2 * sw - sh); nx = -1; ny = 0; }
    const d = (fbm(t / 60, seed, { period: 1024, octaves: 4, seed: seed + 3 }) - 0.5) * 14 + (hash2(i, seed, 9) - 0.5) * 2.4 - 3;
    edge.push([x + nx * d, y + ny * d]);
  }
  const outline = () => {
    g.beginPath();
    g.moveTo(edge[0][0], edge[0][1]);
    for (const p of edge) g.lineTo(p[0], p[1]);
    g.closePath();
  };
  // baked shadow
  if (margin > 0) {
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.75)';
    g.shadowBlur = margin * 0.7;
    g.shadowOffsetX = margin * 0.12;
    g.shadowOffsetY = margin * 0.25;
    g.fillStyle = '#6b5332';
    outline();
    g.fill();
    g.restore();
  }
  g.save();
  outline();
  g.clip();
  // low-res colour field
  const lw = Math.ceil(sw / 4);
  const lh = Math.ceil(sh / 4);
  const low = makeCanvas(lw, lh);
  const lg = low.getContext('2d');
  const img = lg.createImageData(lw, lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const u = x / lw;
    const v = y / lh;
    const n = fbm(u * 6, v * 6 * lh / lw, { period: 64, octaves: 5, seed });
    const st = fbm(u * 3 + 10, v * 3 + 4, { period: 64, octaves: 4, seed: seed + 7 });
    const blot = Math.max(0, st - 0.6) * 2.2;
    const ex = Math.min(u, 1 - u) * lw / Math.min(lw, lh);
    const ey = Math.min(v, 1 - v) * lh / Math.min(lw, lh);
    const e = Math.min(ex, ey);
    const edgeDark = Math.max(0, 1 - e / 0.09) ** 1.6 * 0.42 + Math.max(0, 1 - e / 0.3) * 0.08;
    const k = (0.9 + (n - 0.5) * 0.28 - blot * 0.18 * age - edgeDark * age);
    const i = (y * lw + x) * 4;
    img.data[i] = tone[0] * k;
    img.data[i + 1] = tone[1] * (k - edgeDark * 0.05);
    img.data[i + 2] = tone[2] * (k - edgeDark * 0.12 - blot * 0.05);
    img.data[i + 3] = 255;
  }
  lg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(low, sx, sy, sw, sh);
  // grain
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.5;
  g.fillStyle = g.createPattern(grainTile(), 'repeat');
  g.fillRect(sx, sy, sw, sh);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const r = prng(seed * 7 + 1);
  // fibres
  g.lineCap = 'round';
  for (let i = 0; i < (sw * sh) / 900; i++) {
    const x = sx + r() * sw;
    const y = sy + r() * sh;
    const a = r() * Math.PI;
    const l = 3 + r() * 12;
    g.strokeStyle = r() < 0.5 ? 'rgba(255,248,225,0.18)' : 'rgba(90,60,30,0.08)';
    g.lineWidth = 0.6 + r() * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // foxing spots + a coffee ring
  for (let i = 0; i < 26 * age; i++) {
    const x = sx + r() * sw;
    const y = sy + r() * sh;
    const rr = 2 + r() ** 3 * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(120,70,25,${0.1 + r() * 0.16})`);
    gr.addColorStop(0.7, 'rgba(120,70,25,0.05)');
    gr.addColorStop(1, 'rgba(120,70,25,0)');
    g.fillStyle = gr;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  if (age > 0.5 && ring) {
    // a cup-ring left in the margin, mostly run off the corner of the sheet
    const x = sx + sw * ring[0];
    const y = sy + sh * ring[1];
    const rr = Math.min(sw, sh) * 0.075;
    g.strokeStyle = 'rgba(110,65,25,0.07)';
    for (let k = 0; k < 3; k++) {
      g.lineWidth = rr * (0.03 + k * 0.02);
      g.beginPath();
      g.ellipse(x + k, y - k, rr * (1 - k * 0.02), rr * 0.97, 0.3, 0.2 + k, Math.PI * 1.7 + k);
      g.stroke();
    }
  }
  // fold creases (a map that lives in a satchel)
  const crease = (x0, y0, x1, y1) => {
    const gr = g.createLinearGradient(x0 - 8 * (y1 - y0 ? 1 : 0), y0 - 8 * (x1 - x0 ? 1 : 0), x0 + 8 * (y1 - y0 ? 1 : 0), y0 + 8 * (x1 - x0 ? 1 : 0));
    gr.addColorStop(0, 'rgba(80,50,20,0)');
    gr.addColorStop(0.45, 'rgba(80,50,20,0.09)');
    gr.addColorStop(0.55, 'rgba(255,250,230,0.14)');
    gr.addColorStop(1, 'rgba(255,250,230,0)');
    g.fillStyle = gr;
    if (x1 === x0) g.fillRect(x0 - 8, y0, 16, y1 - y0);
    else g.fillRect(x0, y0 - 8, x1 - x0, 16);
  };
  crease(sx + sw / 2, sy, sx + sw / 2, sy + sh);
  crease(sx, sy + sh / 2, sx + sw, sy + sh / 2);
  g.restore();
  // edge line (slightly darker torn fibre edge)
  g.save();
  g.strokeStyle = 'rgba(70,40,15,0.35)';
  g.lineWidth = 1.2;
  outline();
  g.stroke();
  g.restore();
  return c;
}

/**
 * The cartographer's desk: dark walnut planks lit by a warm candle pool.
 * @param {number} w @param {number} h @param {{cx?:number, cy?:number}} [light]
 */
export function makeDesk(w, h, { cx = 0.45, cy = 0.45, seed = 4, lit = true, tone = [70, 40, 22] } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const lw = Math.ceil(w / 3);
  const lh = Math.ceil(h / 3);
  const low = makeCanvas(lw, lh);
  const lg = low.getContext('2d');
  const img = lg.createImageData(lw, lh);
  const plank = lh / 4.3;
  for (let y = 0; y < lh; y++) {
    const pi = Math.floor(y / plank);
    const py = (y % plank) / plank;
    for (let x = 0; x < lw; x++) {
      const u = x / lw;
      const grain = fbm(u * 3 + pi * 7.3, y / 26 + pi * 3.1, { period: 256, octaves: 4, seed: seed + pi });
      const ring = Math.sin((grain * 16 + y / 5.5 + pi * 9) * 1.3) * 0.5 + 0.5;
      const knot = fbm(u * 1.5, y / 60, { period: 64, octaves: 2, seed: seed + 40 });
      let v = 0.5 + (grain - 0.5) * 0.7 + ring * 0.16 + (knot - 0.5) * 0.2;
      const seam = Math.min(py, 1 - py);
      if (seam < 0.035) v *= 0.35 + seam / 0.035 * 0.65;
      const i = (y * lw + x) * 4;
      img.data[i] = tone[0] * v + 8;
      img.data[i + 1] = tone[1] * v + 5;
      img.data[i + 2] = tone[2] * v + 3;
      img.data[i + 3] = 255;
    }
  }
  lg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(low, 0, 0, w, h);
  if (!lit) return c;
  // varnish sheen streak
  g.globalCompositeOperation = 'screen';
  const sheen = g.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0.2, 'rgba(255,200,140,0)');
  sheen.addColorStop(0.45, 'rgba(255,200,140,0.06)');
  sheen.addColorStop(0.6, 'rgba(255,200,140,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
  // candle pool
  const R = Math.max(w, h);
  const pool = g.createRadialGradient(w * cx, h * cy, 0, w * cx, h * cy, R * 0.7);
  pool.addColorStop(0, 'rgba(255,170,90,0.30)');
  pool.addColorStop(0.5, 'rgba(255,140,60,0.08)');
  pool.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  // vignette
  const vig = g.createRadialGradient(w * cx, h * cy, R * 0.2, w * cx, h * cy, R * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.78)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  return c;
}

/** Fill a canvas-sized soft mask from a list of cell rectangles, feathered by blur. */
export function featherMask(w, h, rects, { blur = 6, grow = 0 } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.filter = `blur(${blur}px)`;
  g.fillStyle = '#fff';
  g.beginPath();
  for (const [x, y, rw, rh] of rects) g.rect(x - grow, y - grow, rw + grow * 2, rh + grow * 2);
  g.fill();
  g.filter = 'none';
  return c;
}

/**
 * A quill stroke: a filled ribbon whose width follows the pen pressure
 * (noise), lands heavy, lifts off thin, wobbles slightly, carries an
 * iron-gall tide line at its edges and pools ink at both ends. With `dry`
 * (0..1) it also scratches a few dry-brush gaps out of the stroke; only use
 * that on a transparent ink layer (it erases with destination-out).
 */
export function quillStroke(g, x0, y0, x1, y1, { width = 2, color = INK.ink, amp = 0.6, seed = 0, pool = 1, taper = 0.3, alpha = 0.93, dry = 0 } = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const step = Math.max(1.2, width * 0.7);
  const n = Math.max(3, Math.ceil(len / step));
  const s = ((seed * 7.31) % 977 + 977) % 977;
  const L = [];
  const R = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * len;
    const wob = (valueNoise(s + d / 34, s * 0.37, 4096, 3) - 0.5) * 2 * amp + (valueNoise(s + d / 6, 3.3, 4096, 4) - 0.5) * amp * 0.35;
    const press = 0.74 + 0.4 * valueNoise(s + d / 22, 11.3 + s, 4096, 5);
    const endIn = Math.min(1, d / (width * 2.4));
    const endOut = Math.min(1, (len - d) / (width * 3.2));
    const tp = (1 - taper) + taper * Math.min(Math.sqrt(endIn), endOut);
    const w = width * press * tp * 0.5;
    const cx = x0 + ux * d + nx * wob;
    const cy = y0 + uy * d + ny * wob;
    L.push([cx + nx * w, cy + ny * w]);
    R.push([cx - nx * w, cy - ny * w]);
  }
  g.save();
  g.beginPath();
  g.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < L.length; i++) g.lineTo(L[i][0], L[i][1]);
  for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath();
  g.fillStyle = color;
  g.globalAlpha *= alpha * 0.86;
  g.fill();
  // tide line: iron-gall ink dries darker at its edges
  g.globalAlpha = Math.min(1, g.globalAlpha / 0.86);
  g.strokeStyle = color;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(0.3, width * 0.13);
  g.stroke();
  if (pool) {
    const r = prng(seed + 17);
    g.fillStyle = color;
    const blob = (x, y, rad) => {
      g.beginPath();
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const q = rad * (0.85 + r() * 0.3);
        if (i === 0) g.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
      }
      g.closePath();
      g.fill();
    };
    blob(x0 + ux * width * 0.15, y0 + uy * width * 0.15, width * 0.58 * pool);
    blob(x1 - ux * width * 0.1, y1 - uy * width * 0.1, width * 0.46 * pool);
  }
  g.restore();
  if (dry > 0 && len > width * 6) {
    const r = prng(seed * 3 + 5);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    const count = Math.floor(len / (width * 9) * dry + r() * 1.4);
    for (let i = 0; i < count; i++) {
      const a = 0.12 + r() * 0.7;
      const b = Math.min(0.95, a + 0.05 + r() * 0.18);
      const strands = 2 + Math.floor(r() * 3);
      for (let k = 0; k < strands; k++) {
        const o = (r() - 0.5) * width * 0.75;
        g.globalAlpha = 0.35 + r() * 0.5;
        g.lineWidth = width * (0.06 + r() * 0.1);
        const aa = a + r() * 0.04;
        const bb = b - r() * 0.04;
        g.beginPath();
        g.moveTo(x0 + dx * aa + nx * o, y0 + dy * aa + ny * o);
        g.lineTo(x0 + dx * bb + nx * o, y0 + dy * bb + ny * o);
        g.stroke();
      }
    }
    g.restore();
  }
}

/** A tileable soft mottling (low-frequency fbm) used to break up washes. */
let mottleCache = null;
export function mottleTile() {
  if (mottleCache) return mottleCache;
  const S = 256;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 64, y / 64, { period: 4, octaves: 4, seed: 404 });
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.max(0, Math.min(255, (n - 0.38) * 2.2 * 255));
  }
  g.putImageData(img, 0, 0);
  mottleCache = c;
  return c;
}

/** Pigment granulation: dark specks clustered by noise (tileable). */
let granCache = null;
export function granTile() {
  if (granCache) return granCache;
  const S = 256;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cl = fbm(x / 32, y / 32, { period: 8, octaves: 3, seed: 77 });
    const h = hash2(x, y, 41);
    const v = h > 0.985 - cl * 0.12 ? 1 : h > 0.93 - cl * 0.2 ? 0.45 : 0;
    const i = (y * S + x) * 4;
    img.data[i] = 40; img.data[i + 1] = 22; img.data[i + 2] = 10;
    img.data[i + 3] = v * 255;
  }
  g.putImageData(img, 0, 0);
  granCache = c;
  return c;
}

/**
 * A wall drawn the way a surveyor drafts a plan: the wall's thickness laid in
 * as a dark iron-gall poché (a pressure-varied quill ribbon, dry-brushed in
 * places), then both faces ruled as fine wobbling pen lines that overshoot
 * the ends a little, as a draughtsman's construction lines do. Where two
 * walls meet, their translucent ink overlaps and pools darker on its own.
 * Use on a transparent ink layer (dry-brush erases with destination-out).
 * @param {CanvasRenderingContext2D} g
 */
export function planWall(g, x0, y0, x1, y1, { width = 6, seed = 0, color = INK.ink, fill = 0.78, dry = 0.4, over = 1, faces = true, amp = 0.5 } = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const r = prng(seed * 5 + 3);
  // poché: the wall's body
  quillStroke(g, x0, y0, x1, y1, { width: width * 0.96, color, amp: amp * 0.6, seed, pool: 0, taper: 0.08, alpha: fill, dry });
  if (!faces) return;
  // the two faces: fine pen lines with their own wobble and overshoot
  g.save();
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const o = side * width * 0.5;
    const e0 = width * (0.15 + r() * 0.9) * over;
    const e1 = width * (0.15 + r() * 0.9) * over;
    const pts = wobblePoints(x0 - ux * e0 + nx * o, y0 - uy * e0 + ny * o, x1 + ux * e1 + nx * o, y1 + uy * e1 + ny * o, { amp, step: Math.max(4, width * 1.6), seed: seed * 3 + side * 17 });
    g.globalAlpha = 0.85 + r() * 0.15;
    g.lineWidth = Math.max(0.45, width * (0.13 + r() * 0.05));
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
  g.restore();
}

/**
 * Pencil shading laid by hand: long parallel strokes whose spacing, angle,
 * pressure and length wander a little, each broken into a few dashes where the
 * pencil skipped over the paper's tooth. (lineShade is the ruled engraver's
 * version.)
 */
export function pencilShade(g, x, y, w, h, { gap = 6, angle = -Math.PI / 4, color = '#4a3826', width = 0.5, alpha = 0.25, seed = 1 } = {}) {
  const r = prng(seed);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineCap = 'round';
  const cx = x + w / 2;
  const cy = y + h / 2;
  const R = Math.hypot(w, h) / 2 + gap;
  for (let o = -R; o <= R; o += gap * (0.7 + r() * 0.6)) {
    const a = angle + (r() - 0.5) * 0.05;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let t = -R + r() * gap * 3;
    while (t < R) {
      const L = gap * (6 + r() * 26);
      g.globalAlpha = alpha * (0.45 + r() * 0.8);
      g.lineWidth = width * (0.7 + r() * 0.6);
      g.beginPath();
      g.moveTo(cx - sa * o + ca * t, cy + ca * o + sa * t);
      g.lineTo(cx - sa * o + ca * (t + L), cy + ca * o + sa * (t + L));
      g.stroke();
      t += L + gap * (0.3 + r() * 2.2);
    }
  }
  g.restore();
}
