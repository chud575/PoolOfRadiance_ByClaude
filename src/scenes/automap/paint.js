import { EDGE, DIRS } from '../../data/maps/MapGrid.js';
import { prng, mottleTile, granTile } from './ink.js';
import { fbm, valueNoise } from '../../render/textures/noise.js';

/**
 * Watercolour and hand-hatching for the survey sheets: connected regions of
 * ground, per-region washes with mottling, granulation, edge darkening and
 * back-runs, hand-drawn shadow hatching, drawn cobbles / flagstones, scattered
 * rubble and street grit. Everything is seeded and deterministic.
 */

const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/**
 * Connected regions of one ground type joined through open edges (a building
 * interior, a street network, a plaza). Each region knows its dominant wall style.
 * @returns {{id:Int32Array, list:{type:number, cells:number[][], style:number, index:number}[]}}
 */
export function regions(map, info) {
  const w = map.w;
  const id = new Int32Array(map.w * map.h).fill(-1);
  const list = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (info.isRock(x, y) || id[y * w + x] >= 0) continue;
    const type = map.getCell(x, y);
    const cells = [];
    const q = [[x, y]];
    const index = list.length;
    id[y * w + x] = index;
    const styles = [0, 0, 0, 0];
    while (q.length) {
      const [cx, cy] = q.pop();
      cells.push([cx, cy]);
      for (const d of DIRS) {
        const e = map.getEdge(cx, cy, d);
        if (e !== EDGE.OPEN) styles[map.getEdgeStyle(cx, cy, d) & 3]++;
        const nx = cx + DV[d][0];
        const ny = cy + DV[d][1];
        if (!map.inBounds(nx, ny) || info.isRock(nx, ny) || id[ny * w + nx] >= 0) continue;
        if (map.getCell(nx, ny) !== type || e !== EDGE.OPEN) continue;
        id[ny * w + nx] = index;
        q.push([nx, ny]);
      }
    }
    const style = styles.indexOf(Math.max(...styles));
    list.push({ type, cells, style, index });
  }
  return { id, list };
}

function cellSet(cells) {
  const s = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x, y) => s.has(`${x},${y}`);
}

/** Boundary segments of a cell region as a Path2D, optionally only some sides. */
export function boundaryPath(cells, CX, CY, sides = 'NESW', walled = () => true) {
  const has = cellSet(cells);
  const p = new Path2D();
  for (const [x, y] of cells) {
    if (sides.includes('N') && !has(x, y - 1) && walled(x, y, 'N')) { p.moveTo(CX(x), CY(y)); p.lineTo(CX(x + 1), CY(y)); }
    if (sides.includes('S') && !has(x, y + 1) && walled(x, y, 'S')) { p.moveTo(CX(x), CY(y + 1)); p.lineTo(CX(x + 1), CY(y + 1)); }
    if (sides.includes('W') && !has(x - 1, y) && walled(x, y, 'W')) { p.moveTo(CX(x), CY(y)); p.lineTo(CX(x), CY(y + 1)); }
    if (sides.includes('E') && !has(x + 1, y) && walled(x, y, 'E')) { p.moveTo(CX(x + 1), CY(y)); p.lineTo(CX(x + 1), CY(y + 1)); }
  }
  return p;
}

function shapePath(cells, CX, CY, cs, grow = 0.4) {
  const p = new Path2D();
  for (const [x, y] of cells) p.rect(CX(x) - grow, CY(y) - grow, cs + grow * 2, cs + grow * 2);
  return p;
}

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

/**
 * A watercolour wash over a region. g must be a dedicated wash layer (it erases
 * pigment with destination-out for mottling and back-runs).
 */
export function washRegion(g, cells, { CX, CY, cs, k = 2, color, alpha = 0.4, seed = 1, edge = 0.4, blooms = 1, mottle = 0.35, gran = 0.3, walled }) {
  const rnd = prng(seed);
  const shape = shapePath(cells, CX, CY, cs);
  const edges = boundaryPath(cells, CX, CY, 'NESW', walled);
  const dark = [color[0] * 0.5, color[1] * 0.45, color[2] * 0.45];
  g.save();
  g.clip(shape);
  g.fillStyle = rgba(color, alpha);
  g.fill(shape);
  if (mottle > 0) {
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = mottle;
    const p = g.createPattern(mottleTile(), 'repeat');
    p.setTransform(new DOMMatrix().translateSelf(rnd() * 900, rnd() * 900).scaleSelf(cs / 30));
    g.fillStyle = p;
    g.fill(shape);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  // pigment collects at the edge where the wash dried
  if (edge > 0) {
    g.filter = `blur(${(cs * 0.06 * k).toFixed(1)}px)`;
    g.strokeStyle = rgba(dark, edge);
    g.lineWidth = cs * 0.2;
    g.stroke(edges);
    g.filter = 'none';
    g.strokeStyle = rgba(dark, edge * 0.55);
    g.lineWidth = cs * 0.035;
    g.stroke(edges);
  }
  // back-runs: a pale bloom with a cauliflower rim
  const nb = cells.length >= 3 ? blooms : 0;
  for (let i = 0; i < nb; i++) {
    const [bx, by] = cells[Math.floor(rnd() * cells.length)];
    const cx = CX(bx) + cs * (0.2 + rnd() * 0.6);
    const cy = CY(by) + cs * (0.2 + rnd() * 0.6);
    const rad = cs * (0.22 + rnd() * 0.25);
    g.globalCompositeOperation = 'destination-out';
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, 'rgba(0,0,0,0.32)');
    gr.addColorStop(0.75, 'rgba(0,0,0,0.2)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    g.globalCompositeOperation = 'source-over';
    g.beginPath();
    const s0 = rnd() * 100;
    for (let j = 0; j <= 40; j++) {
      const a = (j / 40) * Math.PI * 2;
      const q = rad * (0.82 + 0.22 * valueNoise(s0 + Math.cos(a) * 2.2, s0 + Math.sin(a) * 2.2, 256, 9));
      const px = cx + Math.cos(a) * q;
      const py = cy + Math.sin(a) * q;
      if (j === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokeStyle = rgba(dark, edge * 0.35);
    g.lineWidth = cs * 0.018;
    g.stroke();
  }
  if (gran > 0) {
    g.globalAlpha = gran;
    const p = g.createPattern(granTile(), 'repeat');
    p.setTransform(new DOMMatrix().translateSelf(rnd() * 256, rnd() * 256).scaleSelf(0.5));
    g.fillStyle = p;
    g.fill(shape);
    g.globalAlpha = 1;
  }
  g.restore();
}

/**
 * Hand-drawn shadow hatching in a band inside a region's shadowed walls
 * (south and east by default): slanted strokes of varying spacing and length.
 */
export function hatchBand(g, cells, { CX, CY, cs, seed = 1, angle = 0.8, color = '#3a2010', alpha = 0.42, band = 0.3, sides = 'SE', width = 0.55 }) {
  const has = cellSet(cells);
  const r = prng(seed);
  const bw = cs * band;
  const shape = shapePath(cells, CX, CY, cs, 0);
  g.save();
  g.clip(shape);
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.globalAlpha *= alpha;
  const t = Math.tan(angle);
  for (const [x, y] of cells) {
    for (const side of sides) {
      const [dx, dy] = DV[side];
      if (has(x + dx, y + dy)) continue;
      const horiz = side === 'N' || side === 'S';
      const base = side === 'S' ? CY(y + 1) : side === 'N' ? CY(y) : side === 'E' ? CX(x + 1) : CX(x);
      const inward = side === 'S' || side === 'E' ? -1 : 1;
      const a0 = horiz ? CX(x) : CY(y);
      let p = a0 - bw * 0.5 + r() * cs * 0.06;
      while (p < a0 + cs + bw * 0.5) {
        const L = bw * (0.55 + r() * 0.5);
        g.lineWidth = width * (0.7 + r() * 0.6);
        g.beginPath();
        if (horiz) { g.moveTo(p, base); g.lineTo(p + L * t * 0.6, base + inward * L); } else { g.moveTo(base, p); g.lineTo(base + inward * L, p + L * t * 0.6); }
        g.stroke();
        p += cs * (0.055 + r() * 0.05);
      }
    }
  }
  g.restore();
}

function stone(g, x, y, rad, rnd, verts = 6, squash = 0.8) {
  const rot = rnd() * Math.PI;
  g.beginPath();
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const q = rad * (0.75 + rnd() * 0.4);
    const px = Math.cos(a) * q;
    const py = Math.sin(a) * q * squash;
    const X = x + px * Math.cos(rot) - py * Math.sin(rot);
    const Y = y + px * Math.sin(rot) + py * Math.cos(rot);
    if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
  }
  g.closePath();
}

/**
 * A cobbled plaza: individually drawn setts, tightly packed in the middle and
 * thinning out irregularly at the edge of the paved region.
 */
export function cobbleRegion(g, cells, { CX, CY, cs, seed = 1, ink = '#3a2a18' }) {
  const has = cellSet(cells);
  const rnd = prng(seed);
  const step = cs * 0.19;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of cells) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); }
  // distance (in cells) to the region's outside, coarse
  const edgeDist = (ux, uy) => {
    const cx = Math.floor(ux);
    const cy = Math.floor(uy);
    let d = 3;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      if (has(cx + i, cy + j)) continue;
      const ex = Math.max(cx + i, Math.min(ux, cx + i + 1));
      const ey = Math.max(cy + j, Math.min(uy, cy + j + 1));
      d = Math.min(d, Math.hypot(ux - ex, uy - ey));
    }
    return d;
  };
  g.save();
  g.lineJoin = 'round';
  let row = 0;
  for (let uy = minY; uy < maxY; uy += step / cs, row++) {
    for (let ux = minX + (row & 1 ? 0.5 * step / cs : 0); ux < maxX; ux += step / cs) {
      const jx = ux + (rnd() - 0.5) * 0.06;
      const jy = uy + (rnd() - 0.5) * 0.06;
      if (!has(Math.floor(jx), Math.floor(jy))) continue;
      const d = edgeDist(jx, jy);
      const n = fbm(jx * 0.9, jy * 0.9, { period: 64, octaves: 2, seed: seed + 3 });
      if (d < 0.6 && rnd() > d / 0.6 * (0.6 + n * 0.6)) continue;
      const X = CX(0) + jx * cs;
      const Y = CY(0) + jy * cs;
      const rad = step * (0.34 + rnd() * 0.2) * (d < 0.4 ? 0.75 : 1);
      stone(g, X, Y, rad, rnd, 5 + Math.floor(rnd() * 3), 0.78);
      const v = 150 + rnd() * 50;
      g.fillStyle = `rgba(${v | 0},${(v * 0.95) | 0},${(v * 0.82) | 0},${(0.25 + rnd() * 0.25).toFixed(2)})`;
      g.fill();
      g.strokeStyle = ink;
      g.globalAlpha = 0.35 + rnd() * 0.3;
      g.lineWidth = 0.45 + rnd() * 0.35;
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  g.restore();
}

/**
 * Scatter across every cell `test(x, y)` accepts: grit and small stones whose
 * density follows a noise field (bare patches and clusters, never a stamp).
 * kind: 'street' (sparse pebbles), 'rubble' (broken masonry with shadows), 'grass' (tufts).
 */
export function scatter(g, map, test, { CX, CY, cs, seed = 1, kind = 'street', ink = '#3a2716' }) {
  const rnd = prng(seed);
  const per = kind === 'rubble' ? 16 : kind === 'grass' ? 6 : 7;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (!test(x, y)) continue;
    for (let i = 0; i < per; i++) {
      const ux = x + rnd();
      const uy = y + rnd();
      const n = fbm(ux * 0.55, uy * 0.55, { period: 64, octaves: 3, seed: seed + 9 });
      const keep = kind === 'rubble' ? 0.25 + n : (n - 0.42) * 2.4;
      if (rnd() > keep) continue;
      const X = CX(0) + ux * cs;
      const Y = CY(0) + uy * cs;
      if (kind === 'rubble') {
        const big = rnd() < 0.22;
        const rad = cs * (big ? 0.1 + rnd() * 0.07 : 0.03 + rnd() * 0.04);
        stone(g, X, Y, rad, rnd, big ? 5 : 4, 0.7);
        g.fillStyle = `rgba(${(200 + rnd() * 30) | 0},${(184 + rnd() * 25) | 0},${(150 + rnd() * 20) | 0},0.7)`;
        g.fill();
        g.strokeStyle = ink;
        g.globalAlpha = 0.75;
        g.lineWidth = big ? 0.9 : 0.6;
        g.stroke();
        if (big) {
          // a couple of shadow strokes on the lee side
          g.globalAlpha = 0.5;
          g.lineWidth = 0.5;
          for (let k = 0; k < 3; k++) {
            g.beginPath();
            g.moveTo(X + rad * (0.2 + k * 0.25), Y + rad * 0.9);
            g.lineTo(X + rad * (0.5 + k * 0.25), Y + rad * 0.3);
            g.stroke();
          }
        }
        g.globalAlpha = 1;
      } else if (kind === 'grass') {
        g.strokeStyle = 'rgba(60,80,34,0.55)';
        g.lineWidth = 0.7;
        const s = cs * (0.06 + rnd() * 0.05);
        g.beginPath();
        g.moveTo(X - s * 0.6, Y); g.quadraticCurveTo(X - s * 0.5, Y - s * 0.6, X - s * 0.9, Y - s);
        g.moveTo(X, Y); g.quadraticCurveTo(X + s * 0.05, Y - s * 0.7, X - s * 0.1, Y - s * 1.3);
        g.moveTo(X + s * 0.6, Y); g.quadraticCurveTo(X + s * 0.5, Y - s * 0.6, X + s * 0.9, Y - s * 0.9);
        g.stroke();
      } else {
        if (rnd() < 0.55) {
          g.fillStyle = ink;
          g.globalAlpha = 0.25 + rnd() * 0.25;
          g.beginPath(); g.arc(X, Y, 0.35 + rnd() * 0.5, 0, Math.PI * 2); g.fill();
        } else {
          stone(g, X, Y, cs * (0.025 + rnd() * 0.035), rnd, 5, 0.75);
          g.strokeStyle = ink;
          g.globalAlpha = 0.25 + rnd() * 0.25;
          g.lineWidth = 0.5;
          g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
  }
  g.restore();
}

/**
 * Turn a soft (blurred) coverage mask into a deckled one: the threshold is
 * perturbed by noise so the boundary meanders like a hand-laid wash, and the
 * returned `edge` canvas carries the dried tide line along it.
 * @param {HTMLCanvasElement} mask white with soft alpha
 */
export function deckleMask(mask, { seed = 1, scale = 16, amount = 0.5, tide = [70, 45, 22] } = {}) {
  const w = mask.width;
  const h = mask.height;
  const g = mask.getContext('2d');
  const img = g.getImageData(0, 0, w, h);
  const edge = document.createElement('canvas');
  edge.width = w;
  edge.height = h;
  const eg = edge.getContext('2d', { willReadFrequently: true });
  const ei = eg.createImageData(w, h);
  const d = img.data;
  const e = ei.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const m = d[i + 3] / 255;
    if (m <= 0.001 || m >= 0.999) {
      if (m >= 0.999) d[i + 3] = 255;
      continue;
    }
    const n = valueNoise(x / scale, y / scale, 4096, seed) * 0.65 + valueNoise(x / (scale * 0.3), y / (scale * 0.3), 4096, seed + 1) * 0.35;
    const t = 0.5 + (n - 0.5) * amount;
    const a = Math.max(0, Math.min(1, (m - t + 0.05) / 0.1));
    d[i + 3] = a * 255;
    const tl = Math.exp(-(((m - t) / 0.045) ** 2));
    e[i] = tide[0]; e[i + 1] = tide[1]; e[i + 2] = tide[2];
    e[i + 3] = tl * 120;
  }
  g.putImageData(img, 0, 0);
  eg.putImageData(ei, 0, 0);
  return { mask, edge };
}
