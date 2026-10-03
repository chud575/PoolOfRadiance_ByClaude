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
export function washRegion(g, cells, { CX, CY, cs, k = 2, color, alpha = 0.4, seed = 1, edge = 0.4, blooms = 1, mottle = 0.35, gran = 0.3, walled, glaze = 0, second = null }) {
  const rnd = prng(seed);
  const shape = shapePath(cells, CX, CY, cs);
  const edges = boundaryPath(cells, CX, CY, 'NESW', walled);
  const dark = [color[0] * 0.5, color[1] * 0.45, color[2] * 0.45];
  g.save();
  g.clip(shape);
  g.fillStyle = rgba(color, alpha);
  g.fill(shape);
  if (glaze > 0) {
    // wet-in-wet: a second pigment dropped in at one side, fading across the region,
    // plus a few soft pools where the paper held more water
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of cells) { x0 = Math.min(x0, CX(x)); y0 = Math.min(y0, CY(y)); x1 = Math.max(x1, CX(x + 1)); y1 = Math.max(y1, CY(y + 1)); }
    const a = rnd() * Math.PI * 2;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const R = Math.hypot(x1 - x0, y1 - y0) / 2;
    const c2 = second ?? [color[0] * 0.72, color[1] * 0.62, color[2] * 0.7];
    const lg = g.createLinearGradient(mx - Math.cos(a) * R, my - Math.sin(a) * R, mx + Math.cos(a) * R, my + Math.sin(a) * R);
    lg.addColorStop(0, rgba(c2, alpha * glaze));
    lg.addColorStop(0.55, rgba(c2, alpha * glaze * 0.25));
    lg.addColorStop(1, rgba(c2, 0));
    g.fillStyle = lg;
    g.fill(shape);
    const pools = Math.min(4, 1 + Math.floor(cells.length / 4));
    for (let i = 0; i < pools; i++) {
      const [bx, by] = cells[Math.floor(rnd() * cells.length)];
      const px = CX(bx) + cs * rnd();
      const py = CY(by) + cs * rnd();
      const pr = cs * (0.35 + rnd() * 0.5);
      const rg = g.createRadialGradient(px, py, 0, px, py, pr);
      rg.addColorStop(0, rgba(c2, alpha * glaze * 0.55));
      rg.addColorStop(1, rgba(c2, 0));
      g.fillStyle = rg;
      g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
  }
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
    gr.addColorStop(0, 'rgba(0,0,0,0.16)');
    gr.addColorStop(0.75, 'rgba(0,0,0,0.1)');
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
    g.strokeStyle = rgba(dark, edge * 0.28);
    g.lineWidth = cs * 0.014;
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

// the inked survey's stone washes: paper, a light and a deeper tint of one warm grey
export const FLAG_TONES = [[220, 203, 170], [198, 180, 148], [170, 152, 122]];
export const SETT_TONES = [[216, 198, 164], [194, 175, 142], [166, 147, 117]];

// light falls from the north-west: an edge whose outward normal looks south-east is in shadow
const SHADOW = [Math.SQRT1_2, Math.SQRT1_2];

/**
 * An irregular hand-cut stone: a jittered box with some corners knocked off
 * and some faces bulged or dished, 5-7 sides (more with `extra`).
 * Points are local, clockwise (screen y down), centred on the origin.
 */
export function irregularStone(rnd, hw, hh, { extra = [1, 3], jit = 0.13, bulge = 0.1, chamfer = 0.24 } = {}) {
  const m = Math.min(hw, hh);
  const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [x + (rnd() - 0.5) * 2 * m * jit, y + (rnd() - 0.5) * 2 * m * jit]);
  const nExtra = extra[0] + Math.floor(rnd() * (extra[1] - extra[0] + 1));
  const slots = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const pick = new Set(slots.slice(0, nExtra));
  const pts = [];
  const toward = (p, q, d) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [p[0] + ((q[0] - p[0]) / L) * d, p[1] + ((q[1] - p[1]) / L) * d];
  };
  for (let i = 0; i < 4; i++) {
    const p = c[i];
    const prev = c[(i + 3) % 4];
    const next = c[(i + 1) % 4];
    if (pick.has(i)) {
      const d = m * chamfer * (0.6 + rnd() * 0.9);
      pts.push(toward(p, prev, d), toward(p, next, d));
    } else pts.push(p);
    if (pick.has(4 + i)) {
      const t = 0.3 + rnd() * 0.4;
      const ex = next[0] - p[0];
      const ey = next[1] - p[1];
      const L = Math.hypot(ex, ey) || 1;
      const o = (rnd() - 0.3) * m * bulge * 2;
      pts.push([p[0] + ex * t + (ey / L) * o, p[1] + ey * t - (ex / L) * o]);
    }
  }
  return pts;
}

/**
 * Ink one stone at (X, Y), turned by `ang`: a bed of grit round it, its own
 * wash, lit from the north-west (a pale crown, a shaded south-east flank), a
 * pit or crack now and then, and an outline drawn in broken pen strokes that
 * swell on the shadow side, thin to nothing on the lit side and pool at the
 * shadowed corners.
 */
export function inkStone(g, pts, { X, Y, ang = 0, rgb = [170, 158, 136], alpha = 0.85, lw = 0.7, rnd, ink = '43,26,13', bed = 0.24, crack = 0.08, pits = 0.4, worn = 0, style = 'ink', hatch = 0.34 } = {}) {
  const n = pts.length;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  g.save();
  g.translate(X, Y);
  g.rotate(ang);
  const path = () => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  };
  let r0 = 0;
  for (const [x, y] of pts) r0 = Math.max(r0, Math.hypot(x, y));
  if (bed > 0) {
    path();
    g.strokeStyle = `rgba(58,40,24,${(bed * (0.8 + rnd() * 0.4)).toFixed(3)})`;
    g.lineWidth = Math.max(1, r0 * 0.28);
    g.lineJoin = 'round';
    g.stroke();
  }
  path();
  g.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${alpha.toFixed(3)})`;
  g.fill();
  // modelling: light toward the north-west corner, shade toward the south-east
  const lx = -(ca + sa) * Math.SQRT1_2;
  const ly = -(-sa + ca) * Math.SQRT1_2;
  g.save();
  path();
  g.clip();
  if (style === 'ink') {
    // an engraver's shadow: the stone's south-east crescent laid in with fine
    // parallel strokes (no airbrushed gradient), the crown left as clean paper
    const d = r0 * (0.26 + rnd() * 0.12);
    g.beginPath();
    g.rect(-r0 * 2, -r0 * 2, r0 * 4, r0 * 4);
    g.moveTo(pts[0][0] + lx * d, pts[0][1] + ly * d);
    for (let i = 1; i < n; i++) g.lineTo(pts[i][0] + lx * d, pts[i][1] + ly * d);
    g.closePath();
    g.clip('evenodd');
    g.strokeStyle = `rgba(${ink},${(hatch * (0.8 + rnd() * 0.4)).toFixed(3)})`;
    g.lineWidth = Math.max(0.28, lw * 0.5);
    g.beginPath();
    const gap = Math.max(0.95, r0 * 0.16);
    // strokes run across the light (north-east to south-west in the sheet's frame)
    const hx = -ly;
    const hy = lx;
    for (let o = -r0 * 1.2; o <= r0 * 1.2; o += gap) {
      const cx0 = -lx * o;
      const cy0 = -ly * o;
      g.moveTo(cx0 - hx * r0 * 1.3, cy0 - hy * r0 * 1.3);
      g.lineTo(cx0 + hx * r0 * 1.3, cy0 + hy * r0 * 1.3);
    }
    g.stroke();
    g.restore();
    g.save();
    path();
    g.clip();
  } else {
    const lg = g.createLinearGradient(lx * r0, ly * r0, -lx * r0, -ly * r0);
    lg.addColorStop(0, `rgba(255,248,226,${(0.2 + rnd() * 0.12).toFixed(3)})`);
    lg.addColorStop(0.45, 'rgba(255,248,226,0)');
    lg.addColorStop(0.62, 'rgba(36,22,10,0)');
    lg.addColorStop(1, `rgba(36,22,10,${(0.26 + rnd() * 0.14).toFixed(3)})`);
    g.fillStyle = lg;
    g.fillRect(-r0, -r0, r0 * 2, r0 * 2);
  }
  if (worn > 0 && style !== 'ink') {
    // a dished, foot-polished crown
    g.fillStyle = `rgba(255,246,220,${(worn * 0.16).toFixed(3)})`;
    g.beginPath(); g.ellipse(lx * r0 * 0.15, ly * r0 * 0.15, r0 * 0.5, r0 * 0.36, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  if (rnd() < pits) {
    g.fillStyle = `rgba(${ink},0.42)`;
    const np = 2 + Math.floor(rnd() * 4);
    for (let q = 0; q < np; q++) { g.beginPath(); g.arc((rnd() - 0.5) * r0 * 1.1, (rnd() - 0.5) * r0 * 0.9, 0.25 + rnd() * 0.35, 0, Math.PI * 2); g.fill(); }
  }
  if (rnd() < crack) {
    // a hairline crack from one face toward the middle, forking once
    const a = pts[Math.floor(rnd() * n)];
    const mx = (rnd() - 0.5) * r0 * 0.5;
    const my = (rnd() - 0.5) * r0 * 0.5;
    g.strokeStyle = `rgba(${ink},0.6)`;
    g.lineWidth = lw * 0.55;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(a[0] * 0.98, a[1] * 0.98);
    g.lineTo((a[0] + mx) * 0.5 + (rnd() - 0.5) * r0 * 0.2, (a[1] + my) * 0.5 + (rnd() - 0.5) * r0 * 0.2);
    g.lineTo(mx, my);
    g.lineTo(mx + (rnd() - 0.5) * r0 * 0.5, my + (rnd() - 0.5) * r0 * 0.5);
    g.stroke();
  }
  g.restore();
  // the pen: each face its own stroke, weight by how far it turns from the light
  g.lineCap = 'round';
  const face = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const ex = bx - ax;
    const ey = by - ay;
    const L = Math.hypot(ex, ey) || 1;
    // outward normal (local), turned into the sheet's frame
    const nx = ey / L;
    const ny = -ex / L;
    const wx = nx * ca - ny * sa;
    const wy = nx * sa + ny * ca;
    face[i] = wx * SHADOW[0] + wy * SHADOW[1];
  }
  for (let i = 0; i < n; i++) {
    const f = face[i];
    const shade = Math.max(0, Math.min(1, f * 0.6 + 0.5));
    if (rnd() < (f < -0.2 ? 0.34 : f < 0.3 ? 0.12 : 0.03)) continue;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    // strokes start a touch late and stop a touch early on the lit side
    const t0 = f < 0 ? rnd() * 0.18 : 0;
    const t1 = f < 0 ? 1 - rnd() * 0.18 : 1;
    const sx = ax + (bx - ax) * t0;
    const sy = ay + (by - ay) * t0;
    const exx = ax + (bx - ax) * t1;
    const eyy = ay + (by - ay) * t1;
    const mxx = (sx + exx) / 2 + (rnd() - 0.5) * lw * 0.9;
    const myy = (sy + eyy) / 2 + (rnd() - 0.5) * lw * 0.9;
    g.strokeStyle = `rgba(${ink},${(0.5 + shade * 0.45).toFixed(3)})`;
    g.lineWidth = lw * (0.35 + shade ** 1.4 * 1.45) * (0.85 + rnd() * 0.3);
    g.beginPath();
    g.moveTo(sx, sy);
    g.quadraticCurveTo(mxx, myy, exx, eyy);
    g.stroke();
  }
  // ink pools where two shadowed faces meet (and now and then where the pen paused)
  g.fillStyle = `rgba(${ink},0.85)`;
  for (let i = 0; i < n; i++) {
    const f0 = face[(i + n - 1) % n];
    const f1 = face[i];
    if ((f0 > 0.15 && f1 > 0.15) || rnd() < 0.08) {
      g.beginPath();
      g.arc(pts[i][0], pts[i][1], lw * (0.5 + rnd() * 0.45), 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/**
 * Paved ground laid as a street mason would: setts in courses that run with
 * the street (axisAt(x, y) → 'h' | 'v' per cell), continuous along the whole
 * walkable network; a strip of bare earth at the foot of every wall; wear
 * patches where feet and wheels concentrate (wearAt(x, y) → 0..1: junctions,
 * doorways, the gate), where stones have been lifted or lie loose; alleys
 * (bareAt) left as beaten earth. kind: 'setts' | 'flags' (a plaza of large
 * squared flags).
 */
export function cobbleRegion(g, cells, { CX, CY, cs, seed = 1, ink = '43,26,13', axisAt = null, wearAt = () => 0, bareAt = () => false, groundAt = null, kind = 'setts', classAt = () => 'main' }) {
  const has = cellSet(cells);
  const rnd = prng(seed);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of cells) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); }
  const regionAxis = maxX - minX >= maxY - minY ? 'h' : 'v';
  const axisOf = axisAt ?? (() => regionAxis);
  const paved = (x, y) => (groundAt ? groundAt(x, y) : has(x, y)) && !bareAt(x, y) && classAt(x, y) !== 'yard';
  const own = (x, y) => has(x, y) && !bareAt(x, y) && classAt(x, y) !== 'yard';
  // distance (cells) to the nearest unpaved ground: the earth strip at the wall foot
  const edgeDist = (ux, uy) => {
    const cx = Math.floor(ux);
    const cy = Math.floor(uy);
    let d = 2;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (paved(cx + i, cy + j)) continue;
      const ex = Math.max(cx + i, Math.min(ux, cx + i + 1));
      const ey = Math.max(cy + j, Math.min(uy, cy + j + 1));
      d = Math.min(d, Math.hypot(ux - ex, uy - ey));
    }
    return d;
  };
  // the wear field: each worn cell spreads a soft, ragged patch round its centre
  const wearCells = [];
  for (const [x, y] of cells) { const w = wearAt(x, y); if (w > 0) wearCells.push([x + 0.5, y + 0.5, w]); }
  const wearField = (ux, uy) => {
    let w = 0;
    for (const [wx, wy, a] of wearCells) {
      const d = Math.hypot(ux - wx, uy - wy);
      if (d < 1.1) w = Math.max(w, a * (1 - d / 1.1));
    }
    const n = fbm(ux * 1.3, uy * 1.3, { period: 64, octaves: 3, seed: seed + 41 });
    return w * (0.55 + n * 0.9) + Math.max(0, n - 0.74) * 1.4;
  };
  g.save();
  g.lineJoin = 'round';
  // the bed: a dark earth wash under every paved square, so joints and gaps read as soil
  for (const [x, y] of cells) {
    g.fillStyle = `rgba(118,88,58,${(bareAt(x, y) ? 0.1 : 0.16).toFixed(3)})`;
    g.fillRect(CX(x), CY(y), cs, cs);
  }
  const flags = kind === 'flags';
  const base = cs * (flags ? 0.21 : 0.135);
  for (const ax of ['h', 'v']) {
    const [u0, u1, v0, v1] = ax === 'h' ? [minX, maxX, minY, maxY] : [minY, maxY, minX, maxX];
    const ph = rnd() * 6;
    let v = v0;
    while (v < v1) {
      const ch = base * (flags ? 0.62 + rnd() * 0.8 : 0.82 + rnd() * 0.36);
      const chu = ch / cs;
      let u = u0 - rnd() * chu;
      while (u < u1) {
        const w = ch * (flags ? 0.7 + rnd() * 1.3 : 1.1 + rnd() * 0.7);
        const wu = w / cs;
        const cu = u + wu / 2;
        const bend = flags ? 0 : Math.sin(cu * 1.1 + ph + v * 0.3) * 0.045;
        const cv = v + chu / 2 + bend;
        u += wu;
        const x = ax === 'h' ? cu : cv;
        const y = ax === 'h' ? cv : cu;
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        if (!own(ix, iy) || axisOf(ix, iy) !== ax) continue;
        // a lane keeps only a scatter of setts in its beaten earth
        const lane = classAt(ix, iy) === 'lane';
        if (lane && rnd() > 0.34 + 0.3 * fbm(x * 0.9, y * 0.9, { period: 64, octaves: 2, seed: seed + 77 })) continue;
        const d = edgeDist(x, y);
        // bare earth hugging the wall foot, the paving ragged at its margin
        const foot = d - 0.12 - rnd() * 0.14;
        if (foot < 0) continue;
        const wear = wearField(x, y);
        const X = CX(0) + x * cs;
        const Y = CY(0) + y * cs;
        const ang = (ax === 'h' ? 0 : Math.PI / 2) + (flags ? (rnd() - 0.5) * 0.04 : Math.atan(Math.cos(cu * 1.1 + ph) * 0.05) * (ax === 'h' ? 1 : -1) + (rnd() - 0.5) * 0.16);
        if (wear > 0.7) {
          // lifted: a soft hollow of earth, now and then a loose stone left tilted in it
          g.fillStyle = `rgba(104,74,46,${(0.08 + rnd() * 0.08).toFixed(3)})`;
          g.beginPath(); g.ellipse(X, Y, w * 0.55, ch * 0.5, ang + (rnd() - 0.5), 0, Math.PI * 2); g.fill();
          if (rnd() < 0.2) {
            const pts = irregularStone(rnd, w * 0.24, ch * 0.24, { extra: [2, 3], jit: 0.2 });
            inkStone(g, pts, { X: X + (rnd() - 0.5) * w * 0.3, Y, ang: ang + (rnd() - 0.5) * 1.2, rgb: [176, 160, 132], alpha: 0.8, lw: 0.55, rnd, ink, bed: 0.1, crack: 0, pits: 0.2 });
          }
          continue;
        }
        const scale = Math.min(1, 0.7 + foot * 1.5);
        const loose = wear > 0.5;
        const tight = flags ? 0.06 : 0;
        const sw = w * (0.88 + tight + rnd() * 0.06) * scale * (loose ? 0.86 : 1);
        const sh = ch * (0.86 + tight + rnd() * 0.08) * scale * (loose ? 0.86 : 1);
        // a limited wash: three tones of one stone, chosen by a broad patina field so
        // darker and paler stretches read as weathering, never per-stone blotches
        const patina = fbm(x * 0.25, y * 0.25, { period: 64, octaves: 2, seed: seed + 11 });
        const tr = rnd() + (patina - 0.5) * 0.5 + (loose ? 0.25 : 0) + Math.max(0, 0.45 - d) * 0.5;
        const tone = tr < 0.62 ? 0 : tr < 0.93 ? 1 : 2;
        const rgb = (flags ? FLAG_TONES : SETT_TONES)[tone];
        const pts = irregularStone(rnd, sw / 2, sh / 2, flags ? { extra: [1, 2], jit: 0.1, bulge: 0.08, chamfer: 0.2 } : { extra: [1, 3], jit: 0.14, bulge: 0.12, chamfer: 0.28 });
        inkStone(g, pts, {
          X: X + (loose ? (rnd() - 0.5) * w * 0.12 : 0),
          Y: Y + (loose ? (rnd() - 0.5) * ch * 0.12 : 0),
          ang: ang + (loose ? (rnd() - 0.5) * 0.5 : 0),
          rgb, alpha: lane ? 0.6 : 0.78, lw: flags ? 0.8 : lane ? 0.5 : 0.58, rnd, ink, bed: flags ? 0.16 : lane ? 0.1 : 0.16,
          crack: flags ? 0.22 : 0.05, pits: flags ? 0.3 : 0.2, worn: wear > 0.25 ? 1 : 0, hatch: flags ? 0.48 : lane ? 0.2 : 0.3,
        });
      }
      v += chu;
    }
  }
  // yards: beaten dirt in stipple, a few pebbles and cart ruts, no paving at all
  for (const [x, y] of cells) {
    if (classAt(x, y) !== 'yard') continue;
    g.fillStyle = 'rgba(150,114,72,0.1)';
    g.fillRect(CX(x), CY(y), cs, cs);
    for (let i = 0; i < 70; i++) {
      const px = CX(x) + rnd() * cs;
      const py = CY(y) + rnd() * cs;
      const n = fbm((px / cs) * 1.6, (py / cs) * 1.6, { period: 64, octaves: 2, seed: seed + 5 });
      if (rnd() > n * 1.3) continue;
      g.fillStyle = `rgba(${ink},${(0.22 + rnd() * 0.3).toFixed(3)})`;
      g.beginPath(); g.arc(px, py, 0.3 + rnd() * 0.45, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 3; i++) {
      const X = CX(x) + rnd() * cs;
      const Y = CY(y) + rnd() * cs;
      stone(g, X, Y, cs * (0.03 + rnd() * 0.03), rnd, 5, 0.75);
      g.strokeStyle = `rgba(${ink},0.45)`;
      g.lineWidth = 0.5;
      g.stroke();
    }
  }
  // the main street's kerbs: a line of long dressed stones set in from the wall
  // foot, the strip behind them left as earth
  {
    const kerbIn = cs * 0.2;
    for (const [x, y] of cells) {
      if (classAt(x, y) !== 'main') continue;
      for (const side of ['N', 'S', 'E', 'W']) {
        const [dx, dy] = DV[side];
        if (paved(x + dx, y + dy) || (groundAt && groundAt(x + dx, y + dy))) continue;
        const horiz = side === 'N' || side === 'S';
        const base = side === 'N' ? CY(y) + kerbIn : side === 'S' ? CY(y + 1) - kerbIn : side === 'W' ? CX(x) + kerbIn : CX(x + 1) - kerbIn;
        let a = horiz ? CX(x) : CY(y);
        const aEnd = a + cs;
        // run the kerb into the corner where the street turns
        while (a < aEnd - 1) {
          const L = Math.min(aEnd - a, cs * (0.28 + rnd() * 0.22));
          const w = cs * 0.075;
          const cxk = horiz ? a + L / 2 : base;
          const cyk = horiz ? base : a + L / 2;
          const pts = irregularStone(rnd, (horiz ? L : w) / 2 - 0.5, (horiz ? w : L) / 2 - 0.5, { extra: [0, 1], jit: 0.05, bulge: 0.03, chamfer: 0.15 });
          inkStone(g, pts, { X: cxk, Y: cyk, rgb: [206, 190, 158], alpha: 0.9, lw: 0.7, rnd, ink, bed: 0.12, crack: 0.05, pits: 0.1, hatch: 0.25 });
          a += L;
        }
      }
    }
  }
  // puddle stains: a cool wash pooled in the low spots, darker at its rim
  const nP = Math.floor(cells.length / 10);
  for (let i = 0; i < nP; i++) {
    const [px, py] = cells[Math.floor(rnd() * cells.length)];
    const X = CX(px) + cs * (0.25 + rnd() * 0.5);
    const Y = CY(py) + cs * (0.25 + rnd() * 0.5);
    const rx = cs * (0.14 + rnd() * 0.2);
    const ry = rx * (0.45 + rnd() * 0.3);
    const a = rnd() * Math.PI;
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
      const t = (k / 16) * Math.PI * 2;
      const q = 1 + (rnd() - 0.5) * 0.25;
      const ex = Math.cos(t) * rx * q;
      const ey = Math.sin(t) * ry * q;
      const xx = X + ex * Math.cos(a) - ey * Math.sin(a);
      const yy = Y + ex * Math.sin(a) + ey * Math.cos(a);
      if (k === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
    }
    g.closePath();
    g.fillStyle = 'rgba(92,112,128,0.18)';
    g.fill();
    g.strokeStyle = 'rgba(56,66,76,0.3)';
    g.lineWidth = 0.6;
    g.stroke();
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
