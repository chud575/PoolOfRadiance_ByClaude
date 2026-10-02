/**
 * Painterly Canvas-2D toolkit for the illustrated encounter / shop panels.
 * Everything is deterministic for a given seed (no Math.random).
 */

/** mulberry32 → () => [0,1) */
export function rngOf(seed) {
  let s = (seed >>> 0) || 1;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}

export function hashStr(...xs) {
  let h = 2166136261;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ colour

export function hexRgb(c) {
  if (Array.isArray(c)) return c;
  if (c.startsWith('rgb')) {
    const m = c.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2]];
  }
  const n = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c;
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}
/** rgba() string from hex/triple, brightness k, alpha a, optional tint mix. */
export function rgba(c, a = 1, k = 1, tint = null, t = 0) {
  let [r, g, b] = hexRgb(c);
  r *= k; g *= k; b *= k;
  if (tint) {
    const [tr, tg, tb] = hexRgb(tint);
    r += (tr - r) * t; g += (tg - g) * t; b += (tb - b) * t;
  }
  const q = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${q(r)},${q(g)},${q(b)},${a})`;
}
export function mix(c1, c2, t) {
  const a = hexRgb(c1);
  const b = hexRgb(c2);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ------------------------------------------------------------------ canvases

export function makeCanvas(w, h, { gpu = false } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  // the painters read pixels back constantly (relief shading, engraving, masks): keep their canvases
  // in CPU memory, or every getImageData stalls on a GPU readback (crippling under SwiftShader)
  if (!gpu) c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** A GPU-backed copy of a finished canvas, for compositing every frame. */
export function gpuCopy(src) {
  const c = makeCanvas(src.width, src.height, { gpu: true });
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

const noiseCache = new Map();
/**
 * Tileable fractal value-noise canvas (grayscale, alpha 255).
 * @param {number} size  power of two
 * @param {number} cells base lattice cells across
 */
export function noiseCanvas(size = 256, cells = 8, octaves = 4, seed = 1) {
  const key = `${size}|${cells}|${octaves}|${seed}`;
  if (noiseCache.has(key)) return noiseCache.get(key);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const acc = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const r = rngOf(seed * 131 + o * 17);
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * n;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const y1 = (y0 + 1) % n;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % n;
        const a = lat[y0 * n + x0] + (lat[y0 * n + x1] - lat[y0 * n + x0]) * sx;
        const b = lat[y1 * n + x0] + (lat[y1 * n + x1] - lat[y1 * n + x0]) * sx;
        acc[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < acc.length; i++) {
    const v = Math.round((acc[i] / total) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseCache.set(key, c);
  return c;
}

/**
 * Overlay noise texture over a rect (optionally clipped by the caller).
 * mode: 'multiply' darkens grime, 'overlay'/'soft-light' adds texture, 'screen' lightens.
 */
export function texture(g, x, y, w, h, { alpha = 0.3, mode = 'overlay', cells = 8, octaves = 4, seed = 1, scale = 1 } = {}) {
  const n = noiseCanvas(256, cells, octaves, seed);
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = mode;
  const pat = g.createPattern(n, 'repeat');
  if (scale !== 1 && pat.setTransform) pat.setTransform(new DOMMatrix().scale(scale, scale));
  g.fillStyle = pat;
  g.fillRect(x, y, w, h);
  g.restore();
}

// ------------------------------------------------------------------ light

/** Soft radial glow. mode 'lighter' for emitters, 'screen' for haze. */
export function glow(g, x, y, r, color, alpha = 1, mode = 'lighter', inner = 0) {
  g.save();
  g.globalCompositeOperation = mode;
  const gr = g.createRadialGradient(x, y, r * inner, x, y, r);
  gr.addColorStop(0, rgba(color, alpha));
  gr.addColorStop(0.35, rgba(color, alpha * 0.45));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/** Elliptical glow (for floor light pools). */
export function glowEllipse(g, x, y, rx, ry, color, alpha = 1, mode = 'lighter') {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  glow(g, 0, 0, rx, color, alpha, mode);
  g.restore();
}

/** Volumetric shaft of light from a window/hole: a soft quad fading along its length. */
export function lightShaft(g, x0, y0, w0, x1, y1, w1, color, alpha = 0.25) {
  g.save();
  g.globalCompositeOperation = 'screen';
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, rgba(color, alpha));
  gr.addColorStop(0.6, rgba(color, alpha * 0.4));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.filter = 'blur(6px)';
  g.beginPath();
  g.moveTo(x0 - w0 / 2, y0);
  g.lineTo(x0 + w0 / 2, y0);
  g.lineTo(x1 + w1 / 2, y1);
  g.lineTo(x1 - w1 / 2, y1);
  g.closePath();
  g.fill();
  g.restore();
}

/** Horizontal fog band. */
export function fog(g, W, y, h, color, alpha = 0.5, seed = 3) {
  g.save();
  const gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  gr.addColorStop(0, rgba(color, 0));
  gr.addColorStop(0.5, rgba(color, alpha));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, y - h / 2, W, h);
  // break it up with noise
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 0.35;
  const pat = g.createPattern(noiseCanvas(256, 4, 3, seed), 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(3, 0.8));
  g.fillStyle = pat;
  g.fillRect(0, y - h / 2, W, h);
  g.restore();
}

export function vignette(g, W, H, strength = 0.6, color = '#000') {
  g.save();
  const gr = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.58);
  gr.addColorStop(0, rgba(color, 0));
  gr.addColorStop(1, rgba(color, strength));
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.restore();
}

/** Split-tone colour grade: tint shadows and highlights (soft-light). */
export function grade(g, W, H, { shadow = '#1a2440', highlight = '#ffcc88', amount = 0.35 } = {}) {
  g.save();
  g.globalCompositeOperation = 'soft-light';
  const gr = g.createLinearGradient(0, H, 0, 0);
  gr.addColorStop(0, rgba(shadow, amount));
  gr.addColorStop(1, rgba(highlight, amount * 0.7));
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.restore();
}

const grainCache = new Map();
/** Fine film grain / canvas weave. */
export function grain(g, W, H, amount = 0.08, seed = 9) {
  g.save();
  g.globalAlpha = amount;
  g.globalCompositeOperation = 'overlay';
  const key = `${seed}`;
  let nz = grainCache.get(key);
  if (!nz) { nz = gpuCopy(noiseCanvas(128, 64, 1, seed)); grainCache.set(key, nz); }
  const pat = g.createPattern(nz, 'repeat');
  g.fillStyle = pat;
  g.fillRect(0, 0, W, H);
  g.restore();
}

/** Painterly pass: re-stamp the image as short oriented strokes (subtle). */
export function brushPass(g, W, H, { seed = 5, count = 2600, size = 7, alpha = 0.22 } = {}) {
  const src = g.getImageData(0, 0, W, H).data;
  const r = rngOf(seed);
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = r() * W;
    const y = r() * H;
    const idx = ((y | 0) * W + (x | 0)) * 4;
    const len = size * (0.6 + r() * 0.9);
    const a = -0.6 + r() * 0.5;
    g.strokeStyle = `rgba(${src[idx]},${src[idx + 1]},${src[idx + 2]},${alpha})`;
    g.lineWidth = size * 0.45;
    g.beginPath();
    g.moveTo(x - Math.cos(a) * len * 0.5, y - Math.sin(a) * len * 0.5);
    g.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5);
    g.stroke();
  }
  g.restore();
}

// ------------------------------------------------------------------ shapes

export function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

export function linGrad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}

/** Rounded arch path (window/door): rect with semicircular top. */
export function archPath(g, x, y, w, h) {
  const r = w / 2;
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, y + r);
  g.arc(x + r, y + r, r, Math.PI, 0);
  g.lineTo(x + w, y + h);
  g.closePath();
}

/** Pointed (gothic) arch path. */
export function gothicPath(g, x, y, w, h) {
  const r = w * 0.85;
  const sh = w * 0.62; // spring height
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, y + sh);
  g.arcTo(x, y, x + w / 2, y, r * 0.9);
  g.lineTo(x + w / 2, y);
  g.arcTo(x + w, y, x + w, y + sh, r * 0.9);
  g.lineTo(x + w, y + h);
  g.closePath();
}

/**
 * Masonry: courses of blocks with per-block tone, bevel light on top edges,
 * dark mortar and grime. Clip to your shape before calling.
 */
export function masonry(g, x, y, w, h, { base = '#6a6258', course = 22, blockW = 48, jitter = 0.18, seed = 1, mortar = 'rgba(20,16,12,0.65)', light = 'rgba(255,230,190,0.16)', ruined = 0 } = {}) {
  const r = rngOf(seed);
  const [br, bg, bb] = hexRgb(base);
  g.save();
  g.fillStyle = mortar;
  g.fillRect(x, y, w, h);
  let row = 0;
  for (let cy = y; cy < y + h; cy += course, row++) {
    const ch = Math.min(course, y + h - cy);
    let cx = x - (row % 2 ? blockW * 0.5 : 0) - r() * blockW * 0.3;
    while (cx < x + w) {
      const bw = blockW * (0.7 + r() * 0.6);
      if (ruined && r() < ruined) { cx += bw; continue; }
      const k = 1 + (r() - 0.5) * 2 * jitter;
      const warm = (r() - 0.5) * 14;
      g.fillStyle = `rgb(${Math.round(br * k + warm)},${Math.round(bg * k)},${Math.round(bb * k - warm * 0.5)})`;
      g.fillRect(cx + 1.2, cy + 1.2, bw - 2.4, ch - 2.4);
      g.fillStyle = light;
      g.fillRect(cx + 1.2, cy + 1.2, bw - 2.4, Math.max(1, ch * 0.12));
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(cx + 1.2, cy + ch * 0.78, bw - 2.4, ch * 0.2);
      cx += bw;
    }
  }
  g.restore();
  texture(g, x, y, w, h, { alpha: 0.35, mode: 'overlay', cells: 16, seed: seed + 3 });
  texture(g, x, y, w, h, { alpha: 0.25, mode: 'multiply', cells: 4, octaves: 3, seed: seed + 7 });
}

/** Wooden planks (vertical or horizontal). */
export function planks(g, x, y, w, h, { base = '#5a3a22', width = 26, vertical = true, seed = 2 } = {}) {
  const r = rngOf(seed);
  const [br, bgc, bb] = hexRgb(base);
  g.save();
  g.fillStyle = 'rgba(10,6,4,1)';
  g.fillRect(x, y, w, h);
  const span = vertical ? w : h;
  for (let p = 0; p < span; p += width) {
    const k = 0.8 + r() * 0.4;
    g.fillStyle = `rgb(${Math.round(br * k)},${Math.round(bgc * k)},${Math.round(bb * k)})`;
    if (vertical) g.fillRect(x + p + 1, y, width - 2, h);
    else g.fillRect(x, y + p + 1, w, width - 2);
  }
  g.restore();
  texture(g, x, y, w, h, { alpha: 0.4, mode: 'overlay', cells: vertical ? 32 : 4, octaves: 3, seed: seed + 11, scale: 1 });
}

/** Stroke a shape's right/left edge with a rim light by offset-clipping. */
export function rimLight(g, path, color, width = 3, dx = 2, alpha = 0.8) {
  g.save();
  path();
  g.clip();
  g.translate(-dx, 0);
  path();
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = width;
  g.strokeStyle = rgba(color, alpha);
  g.stroke();
  g.restore();
}

/** Soft contact shadow ellipse under figures/props. */
export function contactShadow(g, x, y, rx, ry, alpha = 0.55) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(0,0,0,${alpha})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

/** Flame shape (teardrop) with hot core, drawn additively. phase animates. */
export function flame(g, x, y, s, phase = 0, color = '#ff9a3a') {
  const f = 1 + Math.sin(phase * 9.1) * 0.08 + Math.sin(phase * 23.7) * 0.05;
  const sway = Math.sin(phase * 6.3) * s * 0.12;
  g.save();
  g.globalCompositeOperation = 'lighter';
  glow(g, x, y - s * 0.5, s * 3.2 * f, color, 0.28);
  for (const [k, c, a] of [[1, color, 0.85], [0.62, '#ffd070', 0.9], [0.32, '#fff4d0', 1]]) {
    g.fillStyle = rgba(c, a);
    g.beginPath();
    g.moveTo(x - s * 0.42 * k, y);
    g.bezierCurveTo(x - s * 0.5 * k, y - s * 0.7 * k * f, x + sway - s * 0.1 * k, y - s * 1.2 * k * f, x + sway, y - s * 1.6 * k * f);
    g.bezierCurveTo(x + sway + s * 0.1 * k, y - s * 1.2 * k * f, x + s * 0.5 * k, y - s * 0.7 * k * f, x + s * 0.42 * k, y);
    g.quadraticCurveTo(x, y + s * 0.25 * k, x - s * 0.42 * k, y);
    g.fill();
  }
  g.restore();
}

/** Perspective helper: point on a quad by (u,v) bilinear. q = [tl, tr, br, bl]. */
export function quadPt(q, u, v) {
  const top = [lerp(q[0][0], q[1][0], u), lerp(q[0][1], q[1][1], u)];
  const bot = [lerp(q[3][0], q[2][0], u), lerp(q[3][1], q[2][1], u)];
  return [lerp(top[0], bot[0], v), lerp(top[1], bot[1], v)];
}
