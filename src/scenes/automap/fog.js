import { makeCanvas, prng } from './ink.js';

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
