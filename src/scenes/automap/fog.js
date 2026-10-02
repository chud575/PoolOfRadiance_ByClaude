import { makeCanvas, prng } from './ink.js';
import { fbm, valueNoise } from '../../render/textures/noise.js';
import { EDGE } from '../../data/maps/MapGrid.js';

/**
 * Fog of war for the survey sheets: the unknown is a cool grey-blue vellum
 * wash laid with calm pencil hatching in short patches (8-20 px strokes, each
 * patch at its own angle, cross-hatched where two patches overlap). The
 * hatching is drawn in screen space so its density never changes with zoom;
 * the explored area cuts it away with a soft edge, bordered by a fine dashed
 * surveyor's line along the explored cells.
 */

const tiles = new Map();

/**
 * A tileable patch of pencil hatching (transparent background).
 * @param {number} [scale] device pixels per CSS pixel
 * @param {{color?:number[], alpha?:number, density?:number, seed?:number}} [o]
 */
export function hatchTile(scale = 1, { color = [52, 60, 80], alpha = 0.55, density = 1, seed = 71 } = {}) {
  const key = `${scale.toFixed(2)}|${color}|${alpha}|${density}|${seed}`;
  if (tiles.has(key)) return tiles.get(key);
  const S = Math.round(240 * scale);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const T = 240;
  const r = prng(seed);
  g.lineCap = 'round';
  const patches = Math.round(46 * density);
  // a jittered grid of patch centres, so patches never pile up or leave holes
  const n = Math.ceil(Math.sqrt(patches));
  const cell = T / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (r() > patches / (n * n)) continue;
    const cx = (i + 0.15 + r() * 0.7) * cell;
    const cy = (j + 0.15 + r() * 0.7) * cell;
    // a family of angles around 45 degrees, a few nearly upright or flat
    const a = (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.75) + (r() < 0.15 ? Math.PI / 2 : 0);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const strokes = 5 + Math.floor(r() * 5);
    const gap = 2.3 + r() * 0.9;
    const L = 8 + r() * 12;
    const press = alpha * (0.55 + r() * 0.6);
    for (let k = 0; k < strokes; k++) {
      const o = (k - (strokes - 1) / 2) * gap;
      const l = L * (0.7 + r() * 0.45) * (1 - Math.abs(o) / (strokes * gap) * 0.6);
      const sx = cx - sa * o + ca * (r() - 0.5) * 2.2;
      const sy = cy + ca * o + sa * (r() - 0.5) * 2.2;
      g.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${(press * (0.75 + r() * 0.4)).toFixed(3)})`;
      g.lineWidth = 0.6 + r() * 0.35;
      // draw wrapped copies so the tile repeats seamlessly
      for (const dy of [-T, 0, T]) for (const dx of [-T, 0, T]) {
        const x0 = sx - ca * l / 2 + dx;
        const y0 = sy - sa * l / 2 + dy;
        const x1 = sx + ca * l / 2 + dx;
        const y1 = sy + sa * l / 2 + dy;
        if (Math.max(x0, x1) < -2 || Math.min(x0, x1) > T + 2 || Math.max(y0, y1) < -2 || Math.min(y0, y1) > T + 2) continue;
        g.beginPath();
        g.moveTo(x0, y0);
        // a pencil stroke bows very slightly
        g.quadraticCurveTo((x0 + x1) / 2 - sa * 0.6, (y0 + y1) / 2 + ca * 0.6, x1, y1);
        g.stroke();
      }
    }
  }
  tiles.set(key, c);
  return c;
}

/**
 * Coverage of the unknown: white where fogged, transparent where surveyed,
 * with a soft edge `soft` units wide straddling the explored cells' border.
 * @param {number} W @param {number} H sheet size in units (1 px per unit)
 * @param {number[][]} rects explored cell rects [x, y, w, h] in units
 * @param {number[]} area the fog's extent [x, y, w, h]
 */
export function fogCoverage(W, H, rects, area, { soft = 14, res = 1 } = {}) {
  const c = makeCanvas(W * res, H * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  g.fillStyle = '#fff';
  g.fillRect(area[0], area[1], area[2], area[3]);
  g.globalCompositeOperation = 'destination-out';
  g.filter = `blur(${(soft * 0.42 * res).toFixed(1)}px)`;
  g.beginPath();
  for (const [x, y, w, h] of rects) g.rect(x, y, w, h);
  g.fill();
  g.filter = 'none';
  return c;
}

/**
 * Outline of a cell set as merged straight runs (cell units):
 * edges between a cell in the set and one outside it, skipping the map's rim.
 * @returns {number[][]} [x0, y0, x1, y1]
 */
export function setOutline(w, h, inSet) {
  const runs = [];
  // horizontal edges at y between rows y-1 and y
  for (let y = 1; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && inSet(x, y - 1) !== inSet(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { runs.push([start, y, x, y]); start = -1; }
    }
  }
  for (let x = 1; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && inSet(x - 1, y) !== inSet(x, y);
      if (on && start < 0) start = y;
      if (!on && start >= 0) { runs.push([x, start, x, y]); start = -1; }
    }
  }
  return runs;
}

/**
 * Draw the screen-space hatching over the fogged part of a sheet.
 * `g` is the viewer's context, currently transformed into sheet units.
 * @param {CanvasRenderingContext2D} g
 * @param {{fog:HTMLCanvasElement, fogRes?:number}} sheet
 * @param {number[]} area fog extent in units [x, y, w, h]
 */
export function drawFogHatch(g, layer, coverage, area, dims, { dpr = 1, alpha = 1 } = {}) {
  const m = g.getTransform();
  const cw = g.canvas.width;
  const ch = g.canvas.height;
  if (layer.width !== cw || layer.height !== ch) {
    layer.width = cw;
    layer.height = ch;
  }
  const f = layer.getContext('2d');
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, cw, ch);
  // fogged extent on screen
  const x0 = Math.max(0, Math.floor(m.a * area[0] + m.e));
  const y0 = Math.max(0, Math.floor(m.d * area[1] + m.f));
  const x1 = Math.min(cw, Math.ceil(m.a * (area[0] + area[2]) + m.e));
  const y1 = Math.min(ch, Math.ceil(m.d * (area[1] + area[3]) + m.f));
  if (x1 <= x0 || y1 <= y0) return;
  const pat = f.createPattern(hatchTile(dpr), 'repeat');
  f.fillStyle = pat;
  f.fillRect(x0, y0, x1 - x0, y1 - y0);
  f.globalCompositeOperation = 'destination-in';
  f.setTransform(m);
  f.imageSmoothingEnabled = true;
  f.drawImage(coverage, 0, 0, dims.W, dims.H);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = alpha;
  g.drawImage(layer, 0, 0);
  g.restore();
}

// ------------------------------------------------------------------ survey fog (v3)
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function blurredAlpha(W, H, rects, blur, grow) {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.filter = `blur(${blur.toFixed(1)}px)`;
  g.fillStyle = '#fff';
  g.beginPath();
  for (const [x, y, w, h] of rects) g.rect(x - grow, y - grow, w + grow * 2, h + grow * 2);
  g.fill();
  g.filter = 'none';
  const d = g.getImageData(0, 0, W, H).data;
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255;
  return out;
}

/**
 * The fog of war as a surveyor leaves it: what the company walked is clean
 * paper; what they only sighted down a street keeps a light veil; the rest is
 * unsurveyed. The boundary meanders with a low-frequency noise (a hand-laid
 * wash, never the cell grid) and is ruled by an irregular pencil limit line.
 * Everything is in sheet units at 1 px per unit.
 * @param {number} W @param {number} H
 * @param {number[][]} walk explored cell rects
 * @param {number[][]} sight sighted (or explored) cell rects
 * @param {number[]} area fog extent [x, y, w, h]
 * @returns {{cover:HTMLCanvasElement, walk:HTMLCanvasElement, limit:number[][]}} cover: alpha = fog; walk: alpha = clean survey; limit: contour segments
 */
export function surveyFog(W, H, walk, sight, area, { cs = 50, seed = 1 } = {}) {
  const mW = blurredAlpha(W, H, walk, cs * 0.34, cs * 0.16);
  const mS = sight.length > walk.length ? blurredAlpha(W, H, sight, cs * 0.3, cs * 0.08) : mW;
  const cover = makeCanvas(W, H);
  const cg = cover.getContext('2d');
  const img = cg.createImageData(W, H);
  const walkC = makeCanvas(W, H);
  const wg = walkC.getContext('2d');
  const wimg = wg.createImageData(W, H);
  const dW = new Float32Array(W * H);
  const [ax, ay, aw, ah] = area.map(Math.round);
  const n1 = (x, y) => fbm(x / (cs * 1.1), y / (cs * 1.1), { period: 256, octaves: 3, seed }) * 0.8 + valueNoise(x / (cs * 0.22), y / (cs * 0.22), 4096, seed + 5) * 0.2;
  for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) {
    const i = y * W + x;
    const w = mW[i];
    const s = mS[i];
    let fog;
    let clean = 0;
    if (s <= 0.002) {
      fog = 1;
      dW[i] = 0;
    } else if (w >= 0.998) {
      fog = 0;
      clean = 1;
      dW[i] = 1;
    } else {
      const n = n1(x, y) - 0.5;
      const dw = w + n * 0.62;
      const ds = s + n * 0.5;
      dW[i] = dw;
      fog = Math.max(1 - smooth(0.22, 0.5, ds), (1 - smooth(0.24, 0.52, dw)) * 0.42);
      clean = smooth(0.4, 0.56, dw);
    }
    wimg.data[i * 4] = wimg.data[i * 4 + 1] = wimg.data[i * 4 + 2] = 255;
    wimg.data[i * 4 + 3] = Math.round(clean * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(fog * 255);
  }
  cg.putImageData(img, 0, 0);
  wg.putImageData(wimg, 0, 0);
  // the limit of survey: marching squares on the walked field at a 2-unit step
  const limit = [];
  const st = 2;
  const v = (x, y) => dW[y * W + x];
  const lerp = (a, b) => (0.5 - a) / (b - a || 1e-6);
  for (let y = ay; y < ay + ah - st; y += st) for (let x = ax; x < ax + aw - st; x += st) {
    const a = v(x, y);
    const b = v(x + st, y);
    const c = v(x + st, y + st);
    const d = v(x, y + st);
    const idx = (a > 0.5 ? 8 : 0) | (b > 0.5 ? 4 : 0) | (c > 0.5 ? 2 : 0) | (d > 0.5 ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = [x + st * lerp(a, b), y];
    const R = [x + st, y + st * lerp(b, c)];
    const B = [x + st * lerp(d, c), y + st];
    const L = [x, y + st * lerp(a, d)];
    const add = (p, q) => limit.push([p[0], p[1], q[0], q[1]]);
    switch (idx) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 5: add(L, T); add(B, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(L, T); break;
      case 10: add(T, R); add(L, B); break;
      default:
    }
  }
  return { cover, walk: walkC, limit };
}

/**
 * Paint the unsurveyed ground onto a k-resolution layer (sheet units):
 * a cool graphite-and-wash field laid by hand in broad patches whose angle,
 * spacing, length and pressure drift across the sheet, so it reads as one
 * draughtsman's shading rather than a repeated stamp. Masked by `cover`.
 */
export function paintSurveyFog(W, H, k, cover, area, { seed = 1 } = {}) {
  const c = makeCanvas(W * k, H * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  const [ax, ay, aw, ah] = area;
  const r = prng(seed + 71);
  // the wash: a cool grey vellum tone, mottled at low frequency
  g.fillStyle = 'rgba(104,112,128,0.15)';
  g.fillRect(ax, ay, aw, ah);
  {
    const q = 8;
    const mw = Math.ceil(aw / q);
    const mh = Math.ceil(ah / q);
    const mc = makeCanvas(mw, mh);
    const mg = mc.getContext('2d');
    const im = mg.createImageData(mw, mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const n = fbm(x / 22, y / 22, { period: 64, octaves: 4, seed: seed + 3 });
      const i = (y * mw + x) * 4;
      im.data[i] = 70; im.data[i + 1] = 76; im.data[i + 2] = 92;
      im.data[i + 3] = Math.max(0, Math.min(255, (n - 0.35) * 1.4 * 255 * 0.32));
    }
    mg.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(mc, ax, ay, aw, ah);
  }
  // graphite: broad hand-laid patches of near-parallel strokes
  g.lineCap = 'round';
  const dens = (x, y) => fbm(x / 260, y / 260, { period: 64, octaves: 3, seed: seed + 9 });
  const drift = (x, y) => fbm(x / 340, y / 340, { period: 64, octaves: 2, seed: seed + 13 });
  const patches = Math.round((aw * ah) / 1500);
  for (let p = 0; p < patches; p++) {
    const cx = ax + r() * aw;
    const cy = ay + r() * ah;
    const d = dens(cx, cy);
    if (r() > (d - 0.22) * 1.7) continue;
    const R = 18 + r() * 44;
    const a = 0.78 + (drift(cx, cy) - 0.5) * 1.9 + (r() - 0.5) * 0.4 + (r() < 0.12 ? Math.PI / 2 : 0);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const gap = 2.4 + (1 - d) * 2.6 + r() * 0.8;
    const press = 0.13 + d * 0.3 + r() * 0.06;
    const bow = (r() - 0.5) * 3;
    for (let o = -R; o <= R; o += gap * (0.8 + r() * 0.4)) {
      const half = Math.sqrt(Math.max(0, R * R - o * o)) * (0.45 + r() * 0.55);
      if (half < 2) continue;
      const shift = (r() - 0.5) * R * 0.35;
      const sx = cx - sa * o + ca * shift;
      const sy = cy + ca * o + sa * shift;
      const x0 = sx - ca * half;
      const y0 = sy - sa * half;
      const x1 = sx + ca * half;
      const y1 = sy + sa * half;
      g.strokeStyle = `rgba(52,56,68,${(press * (0.6 + r() * 0.6)).toFixed(3)})`;
      g.lineWidth = 0.5 + r() * 0.45;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(sx - sa * bow, sy + ca * bow, x1, y1);
      g.stroke();
    }
  }
  // a little graphite dust caught in the paper's tooth
  for (let i = 0; i < (aw * ah) / 260; i++) {
    const x = ax + r() * aw;
    const y = ay + r() * ah;
    if (r() > dens(x, y)) continue;
    g.fillStyle = `rgba(50,54,66,${(0.08 + r() * 0.18).toFixed(3)})`;
    g.fillRect(x, y, 0.5 + r() * 0.7, 0.5 + r() * 0.5);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.imageSmoothingEnabled = true;
  g.drawImage(cover, 0, 0, W * k, H * k);
  return c;
}

/** The pencil "limit of survey": a pressure-varied graphite line with skips, traced twice. */
export function drawSurveyLimit(g, limit, { seed = 1 } = {}) {
  const buckets = [[], [], [], []];
  for (const s of limit) {
    const mx = (s[0] + s[2]) / 2;
    const my = (s[1] + s[3]) / 2;
    const n = valueNoise(mx / 26, my / 26, 4096, seed + 2);
    if (n < 0.16) continue;
    buckets[Math.min(3, Math.floor(n * 4))].push(s);
  }
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  buckets.forEach((list, i) => {
    if (!list.length) return;
    g.strokeStyle = `rgba(48,40,32,${(0.5 + i * 0.13).toFixed(2)})`;
    g.lineWidth = 0.85 + i * 0.22;
    g.beginPath();
    for (const [x0, y0, x1, y1] of list) { g.moveTo(x0, y0); g.lineTo(x1, y1); }
    g.stroke();
  });
  // the draughtsman's second, lighter pass a hair off the first
  g.strokeStyle = 'rgba(48,40,32,0.16)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (const [x0, y0, x1, y1] of limit) {
    const o = (valueNoise(x0 / 40, y0 / 40, 4096, seed + 4) - 0.5) * 3;
    g.moveTo(x0 + o + 0.8, y0 - o * 0.6 + 0.9);
    g.lineTo(x1 + o + 0.8, y1 - o * 0.6 + 0.9);
  }
  g.stroke();
  g.restore();
}

/**
 * Cells the company has sighted without walking: down each straight, open
 * line of sight from every walked cell, up to `reach` squares.
 */
export function sightedCells(map, walked, isRock, reach = 3) {
  const out = new Set();
  const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (!walked(x, y)) continue;
    for (const d of ['N', 'E', 'S', 'W']) {
      let cx = x;
      let cy = y;
      for (let i = 0; i < reach; i++) {
        const e = map.getEdge(cx, cy, d);
        if (e !== EDGE.OPEN && e !== EDGE.ARCH) break;
        cx += DV[d][0];
        cy += DV[d][1];
        if (!map.inBounds(cx, cy) || isRock(cx, cy)) break;
        if (!walked(cx, cy)) out.add(`${cx},${cy}`);
      }
    }
  }
  return out;
}
