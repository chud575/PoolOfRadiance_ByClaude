import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { TRAVEL } from '../../data/travel.js';
import { INK, makeCanvas, makeParchment, inkLine, quillStroke, lineShade, featherMask, mottleTile, prng, wobblePoints } from './ink.js';
import { regions, washRegion, hatchBand, deckleMask, boundaryPath } from './paint.js';
import { drawMarker } from './glyphs.js';
import { analyseMap, collectEdges, mergeRuns } from './BlockSheet.js';
import { SERIF, drawCompassRose, drawCartouche, drawIlluminatedInitial, drawFlourish, haloText, goldGradient, fitFont } from './ornaments.js';
import { fbm } from '../../render/textures/noise.js';
import { drawOldCity, drawCityWall, drawHarbour, inPoly } from './worldcity.js';

/**
 * Overview of Phlan: every block drawn as its own miniature survey (explored
 * cells inked, the rest pencilled), the palisade and the ruined old wall, the
 * Stojanow river, the Moonsea with Thorn Island, roads and stairs between
 * blocks, cartouche, key and compass rose.
 * Sheet units 1300 x 1000 (+ margin).
 */
export const WORLD = { W: 1300, H: 1000, M: 40 };

const S = 150;
/** Block placement (centre, units). Dungeons are round medallions. */
export const LAYOUT = {
  phlan_civilized: [250, 690],
  phlan_slums: [430, 690],
  podol_plaza: [610, 690],
  cadorna_textile: [790, 690],
  kutos_well: [430, 510],
  mendors_library: [610, 510],
  valhingen_graveyard: [430, 330],
  stojanow_gate: [790, 330],
  valjevo_castle: [790, 150],
  wilderness: [1140, 330],
  sokol_keep: [250, 885],
  kutos_warrens: [250, 510, 'round'],
  temple_bane: [250, 330, 'round'],
  pool_pyramid: [610, 175, 'round'],
};

const UNDER = {
  kutos_warrens: { parent: 'kutos_well', x: 7, y: 9 },
  temple_bane: { parent: 'valhingen_graveyard', x: 7, y: 2 },
  pool_pyramid: { parent: 'valjevo_castle', x: 7, y: 1 },
};

const RUMOURS = {
  phlan_civilized: 'New Phlan: the council\'s walled foothold on the old city.',
  phlan_slums: 'The nearest of the lost blocks, just past the palisade.',
  podol_plaza: 'The old market square. Someone is charging tolls.',
  cadorna_textile: 'A great warehouse, chained shut from the inside.',
  kutos_well: 'Kobolds, they say, and something that bargains from the well.',
  mendors_library: 'A library of the old city. Fire-scarred, but not empty.',
  valhingen_graveyard: 'The dead do not rest in Valhingen.',
  stojanow_gate: 'The great gate on the river road, held by a war-band.',
  valjevo_castle: 'The castle of the old lords. Its new master is not seen.',
  wilderness: 'Beyond the gate: the river road and the wild Moonsea shore.',
  sokol_keep: 'The old keep on Thorn Island. Lights burn there at night.',
  kutos_warrens: 'Tunnels beneath Kuto\'s Well.',
  temple_bane: 'A stair beneath the mausoleum, and green light below.',
  pool_pyramid: 'Something beneath Valjevo breathes.',
};

// hand-routed roads where a straight link would cross another block
const ROUTES = {
  well_gate: [[520, null], [520, 420], [700, 420], [700, null]],
};

// ---------------- wards: the districts as the old streets cut them ----------------
// A lattice of street junctions inside the wall, each nudged off the grid so the
// streets run at angles; every block's district is the cell of that lattice, inset
// by half a street, with a bend in each side and the corners cut back at the plazas.
const LX = [150, 340, 520, 700, 906];
const LY = [52, 240, 420, 600, 780];
const WALLPTS = [[150, 250], [160, 60], [700, 48], [890, 50], [905, 250], [915, 470], [900, 780], [140, 780], [150, 250]];
const PLAZAS = [[2, 3], [3, 2], [1, 2]];
const hashW = (a, b, sd) => {
  const v = Math.sin(a * 127.1 + b * 311.7 + sd * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
function latticePt(i, j) {
  let x = LX[i];
  let y = LY[j];
  if (i > 0 && i < LX.length - 1) x += (hashW(i, j, 1) - 0.5) * 66;
  if (j > 0 && j < LY.length - 1) y += (hashW(i, j, 2) - 0.5) * 52;
  return [x, y];
}
/** Inset a closed polygon edge by edge (d per edge), intersecting neighbouring offset lines. */
function insetPoly(pts, ds) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [ax, ay] = pts[i]; const [bx, by] = pts[(i + 1) % n]; area += ax * by - bx * ay; }
  const sgn = area > 0 ? 1 : -1;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    // inward normal for this winding
    const nx = (-dy / L) * sgn;
    const ny = (dx / L) * sgn;
    const d = ds[i];
    return [a[0] + nx * d, a[1] + ny * d, dx, dy];
  });
  return lines.map((l1, i) => {
    const l0 = lines[(i - 1 + n) % n];
    const den = l0[2] * l1[3] - l0[3] * l1[2];
    if (Math.abs(den) < 1e-6) return [l1[0], l1[1]];
    const t = ((l1[0] - l0[0]) * l1[3] - (l1[1] - l0[1]) * l1[2]) / den;
    return [l0[0] + l0[2] * t, l0[1] + l0[3] * t];
  });
}
/** The district polygon of lattice cell (i, j). */
function wardPoly(i, j) {
  const c = [latticePt(i, j), latticePt(i + 1, j), latticePt(i + 1, j + 1), latticePt(i, j + 1)];
  const wallSide = [j === 0, i + 1 === LX.length - 1, j + 1 === LY.length - 1, i === 0];
  // edge keys shared with the neighbour, so a street bends the same way on both kerbs
  const keys = [`h${i},${j}`, `v${i + 1},${j}`, `h${i},${j + 1}`, `v${i},${j}`];
  const pts = [];
  const ds = [];
  for (let e = 0; e < 4; e++) {
    const a = c[e];
    const b = c[(e + 1) % 4];
    const d = wallSide[e] ? 24 : 11;
    pts.push(a);
    ds.push(d);
    if (!wallSide[e]) {
      const kh = [...keys[e]].reduce((q, ch) => q * 31 + ch.charCodeAt(0), 3);
      const bend = (hashW(kh, 7, 3) - 0.5) * 30;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      pts.push([(a[0] + b[0]) / 2 + ((b[1] - a[1]) / L) * bend, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / L) * bend]);
      ds.push(d);
    }
  }
  let poly = insetPoly(pts, ds);
  // cut the corners back where a plaza opens at the junction
  const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
  for (const [pi, pj] of PLAZAS) {
    const ci = corners.findIndex(([a, b]) => a === pi && b === pj);
    if (ci < 0) continue;
    const [px, py] = latticePt(pi, pj);
    const R = 40;
    const out = [];
    const nP = poly.length;
    for (let q = 0; q < nP; q++) {
      const v = poly[q];
      if (Math.hypot(v[0] - px, v[1] - py) >= R) { out.push(v); continue; }
      const prev = poly[(q - 1 + nP) % nP];
      const next = poly[(q + 1) % nP];
      const along = (from, to) => {
        for (let t = 0; t <= 1; t += 0.02) {
          const x = from[0] + (to[0] - from[0]) * t;
          const y = from[1] + (to[1] - from[1]) * t;
          if (Math.hypot(x - px, y - py) >= R) return [x, y];
        }
        return from;
      };
      const a0 = along(v, prev);
      const a1 = along(v, next);
      const t0 = Math.atan2(a0[1] - py, a0[0] - px);
      let t1 = Math.atan2(a1[1] - py, a1[0] - px);
      while (t1 - t0 > Math.PI) t1 -= Math.PI * 2;
      while (t0 - t1 > Math.PI) t1 += Math.PI * 2;
      for (let k2 = 0; k2 <= 5; k2++) {
        const t = t0 + (t1 - t0) * (k2 / 5);
        out.push([px + Math.cos(t) * R, py + Math.sin(t) * R]);
      }
    }
    poly = out;
  }
  return poly;
}
const polyPath = (pts) => {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
};
/** Inside the ward, or within pad of its kerb. */
function wardHit(poly, x, y, pad = 0) {
  if (inPoly(poly, x, y)) return true;
  if (!pad) return false;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < pad) return true;
  }
  return false;
}
/** Street centre lines along the lattice (with each side's bend), as [x0,y0,x1,y1,w] runs. */
function latticeStreets() {
  const out = [];
  for (let j = 0; j < LY.length; j++) for (let i = 0; i < LX.length; i++) {
    const a = latticePt(i, j);
    if (i + 1 < LX.length && j > 0 && j < LY.length - 1) { const b = latticePt(i + 1, j); out.push([a[0], a[1], b[0], b[1], 9]); }
    if (j + 1 < LY.length && i > 0 && i < LX.length - 1) { const b = latticePt(i, j + 1); out.push([a[0], a[1], b[0], b[1], 9]); }
  }
  return out;
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i]; const [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}
function polyCentroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/**
 * @param {{k?:number, seenFn:(m:any)=>(x:number,y:number)=>boolean, secretsFn:(id:string)=>Set<string>, spent:Record<string,boolean>, known:(id:string)=>boolean, here:string}} o
 */
export function buildWorldSheet({ k = 2, seenFn, secretsFn, known, here }) {
  const { W, H, M } = WORLD;
  const canvas = makeParchment((W + 2 * M) * k, (H + 2 * M) * k, { seed: 1340, margin: M * k, tone: [238, 222, 182], age: 1.2, ring: null });
  const g = canvas.getContext('2d');
  g.save();
  g.scale(k, k);
  g.translate(M, M);

  const blocks = [];
  for (const [id, [cx, cy, shape]] of Object.entries(LAYOUT)) {
    if (!hasMap(id)) continue;
    const round = shape === 'round';
    const r = id === 'pool_pyramid' ? 88 : 64;
    const s = round ? r * Math.SQRT2 * 0.92 : S;
    blocks.push({ id, cx, cy, round, r, s, x: cx - s / 2, y: cy - s / 2, rot: 0, known: known(id), rumour: RUMOURS[id] });
  }
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const cellToUnits = (b, x, y) => {
    const u = (x / 16 - 0.5) * b.s;
    const v = (y / 16 - 0.5) * b.s;
    const c = Math.cos(b.rot);
    const sn = Math.sin(b.rot);
    return [b.cx + u * c - v * sn, b.cy + u * sn + v * c];
  };

  // ---------------- sea, coast, island, river ----------------
  const coastY = (x) => 800 + (fbm(x / 160, 3, { period: 64, octaves: 4, seed: 21 }) - 0.5) * 60 + Math.max(0, x - 950) * 0.05;
  const sea = new Path2D();
  sea.moveTo(-10, coastY(-10));
  for (let x = -10; x <= W + 10; x += 6) sea.lineTo(x, coastY(x));
  sea.lineTo(W + 10, H + 10);
  sea.lineTo(-10, H + 10);
  sea.closePath();
  // Thorn Island: an irregular rocky outline around Sokol Keep
  const icx = 250;
  const icy = 886;
  const islandR = (a) => 1 + (fbm(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, { period: 64, octaves: 4, seed: 8 }) - 0.5) * 0.55;
  const islandPt = (a, grow = 0) => {
    const q = islandR(a);
    return [icx + Math.cos(a) * (146 * q + grow), icy + Math.sin(a) * (104 * q + grow * 0.8)];
  };
  const isl = new Path2D();
  for (let i = 0; i <= 120; i++) {
    const [px, py] = islandPt((i / 120) * Math.PI * 2);
    if (i === 0) isl.moveTo(px, py); else isl.lineTo(px, py);
  }
  isl.closePath();
  // each block's district: a lattice ward inside the walls, a clearing in the woods,
  // or the island itself; the block's plan is laid into it, turned with its streets
  for (const b of blocks) {
    if (b.round) continue;
    let poly;
    if (b.id === 'sokol_keep') {
      poly = [];
      for (let i = 0; i < 64; i++) poly.push(islandPt((i / 64) * Math.PI * 2, -22));
    } else if (b.cx > 950) {
      poly = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const q = 1 + (fbm(Math.cos(a) * 1.3 + 2, Math.sin(a) * 1.3 + 2, { period: 64, octaves: 3, seed: 31 }) - 0.5) * 0.4;
        poly.push([b.cx + Math.cos(a) * 92 * q, b.cy + Math.sin(a) * 96 * q]);
      }
    } else {
      const i = Math.round((b.cx - 250) / 180);
      const j = Math.round((b.cy - 150) / 180);
      poly = wardPoly(i, j);
      const c0 = latticePt(i, j);
      const c1 = latticePt(i + 1, j);
      const c2 = latticePt(i + 1, j + 1);
      const c3 = latticePt(i, j + 1);
      const angT = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]);
      const angB = Math.atan2(c2[1] - c3[1], c2[0] - c3[0]);
      b.rot = Math.max(-0.12, Math.min(0.12, (angT + angB) / 2));
    }
    b.poly = poly;
    const [pcx, pcy] = polyCentroid(poly);
    b.cx = pcx;
    b.cy = pcy;
    b.s = Math.sqrt(polyArea(poly)) * (b.id === 'sokol_keep' ? 0.82 : 1.02);
    b.x = b.cx - b.s / 2;
    b.y = b.cy - b.s / 2;
    let maxY = -Infinity;
    for (const p of poly) maxY = Math.max(maxY, p[1]);
    b.labelY = maxY + 6;
  }
  g.save();
  g.clip(sea);
  // sea wash: deeper toward the bottom, mottled
  const sg = g.createLinearGradient(0, 770, 0, H);
  sg.addColorStop(0, 'rgba(150,190,180,0.3)');
  sg.addColorStop(0.25, 'rgba(96,146,164,0.42)');
  sg.addColorStop(1, 'rgba(40,78,124,0.72)');
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = sg;
  g.fillRect(0, 700, W, 400);
  g.globalCompositeOperation = 'source-over';
  const r = prng(55);
  // engraved swell: rows of broken wave strokes, parallel to the shore
  g.lineCap = 'round';
  for (let j = 0; j < 22; j++) {
    const fade = Math.max(0.12, 1 - j / 22);
    let x = -10 + r() * 30;
    while (x < W + 10) {
      const len = 16 + r() * 34;
      const y = coastY(x) + 12 + j * 9 + (r() - 0.5) * 2;
      if (y > H) break;
      g.strokeStyle = `rgba(24,50,90,${(0.62 * fade + 0.12).toFixed(3)})`;
      g.lineWidth = 0.7 + r() * 0.45;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y - 2.6, x + len * 0.6, y + 1.6, x + len, y - 0.6);
      g.stroke();
      x += len + 4 + r() * 18;
    }
  }
  // scalloped wave crests (the engraver's sea), sparse, away from the coast
  for (let i = 0; i < 120; i++) {
    const x = r() * W;
    const y = coastY(x) + 50 + r() * 190;
    if (y > H - 8) continue;
    const s0 = 4 + r() * 4;
    g.strokeStyle = 'rgba(28,58,98,0.5)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x - s0 * 2, y);
    g.quadraticCurveTo(x - s0, y - s0 * 0.9, x, y);
    g.quadraticCurveTo(x + s0, y - s0 * 0.9, x + s0 * 2, y);
    g.stroke();
  }
  // portolan rhumb lines radiating from the compass rose across the sea
  {
    const [rx, ry] = [1175, 860];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      g.strokeStyle = i % 4 === 0 ? 'rgba(43,26,13,0.5)' : i % 2 ? 'rgba(160,48,32,0.45)' : 'rgba(40,96,60,0.45)';
      g.lineWidth = i % 4 === 0 ? 0.9 : 0.7;
      g.beginPath();
      g.moveTo(rx + Math.cos(a) * 76, ry + Math.sin(a) * 76);
      g.lineTo(rx + Math.cos(a) * 1600, ry + Math.sin(a) * 1600);
      g.stroke();
    }
  }
  // surf on the island shore
  for (let k2 = 1; k2 <= 3; k2++) {
    g.strokeStyle = `rgba(28,58,98,${(0.4 / k2).toFixed(3)})`;
    g.lineWidth = 0.7;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const [px, py] = islandPt((i / 120) * Math.PI * 2, k2 * 6);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
  // coast: double ink line with surf hatching on the water side
  g.save();
  g.strokeStyle = INK.ink;
  g.lineWidth = 2.2;
  g.beginPath();
  for (let x = -10; x <= W + 10; x += 6) (x === -10 ? g.moveTo(x, coastY(x)) : g.lineTo(x, coastY(x)));
  g.stroke();
  g.lineWidth = 0.7;
  g.strokeStyle = 'rgba(43,26,13,0.7)';
  g.beginPath();
  for (let x = -10; x <= W + 10; x += 6) (x === -10 ? g.moveTo(x, coastY(x) + 5) : g.lineTo(x, coastY(x) + 5 + Math.sin(x / 7) * 0.8));
  g.stroke();
  // water-lining: the engraver's concentric rules following the shore, fading out to sea
  for (let q = 1; q <= 6; q++) {
    const off = 5 + q * q * 1.6 + q * 4;
    g.strokeStyle = `rgba(28,58,98,${(0.75 / (0.6 + q * 0.45)).toFixed(3)})`;
    g.lineWidth = 0.8;
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 5) {
      const y = coastY(x) + off + Math.sin(x / (9 + q * 3) + q) * 0.7 * q;
      if (x === -10) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let x = -10; x <= W + 10; x += 3.2) {
    const y = coastY(x);
    const L = 3 + r() * 5;
    g.strokeStyle = 'rgba(28,58,98,0.55)';
    g.lineWidth = 0.5;
    g.beginPath(); g.moveTo(x, y + 7); g.lineTo(x + 1, y + 7 + L); g.stroke();
  }
  // land side: a band of shore stipple
  g.fillStyle = 'rgba(90,70,40,0.35)';
  for (let x = -10; x <= W + 10; x += 2.4) {
    const y = coastY(x) - 3 - r() * 9;
    g.beginPath(); g.arc(x + r() * 2, y, 0.5 + r() * 0.6, 0, Math.PI * 2); g.fill();
  }
  // island: land wash, ink coast, rocks and thorn scrub
  g.fillStyle = 'rgba(230,212,168,1)';
  g.fill(isl);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(160,160,100,0.3)';
  g.fill(isl);
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = 2.2;
  g.strokeStyle = INK.ink;
  g.stroke(isl);
  g.lineWidth = 0.7;
  g.beginPath();
  for (let i = 0; i <= 120; i++) {
    const [px, py] = islandPt((i / 120) * Math.PI * 2, -5);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const [px, py] = islandPt(a, -12 - r() * 14);
    if (Math.abs(px - icx) < 82 && Math.abs(py - icy) < 82) continue;
    if (r() < 0.55) thorn(g, px, py, 4 + r() * 3, r);
    else rock(g, px, py, 3 + r() * 4, r);
  }
  g.restore();
  // river Stojanow: rising from a mere in the north woods, meandering down to the sea
  const LAKE = { x: 962, y: 262, rx: 46, ry: 19 };
  const riverTop = LAKE.y + LAKE.ry - 3;
  const riverX = (y) => {
    const t = Math.max(0, y - riverTop);
    return 962 + Math.sin(t / 64) * 26 * Math.min(1, t / 60) + Math.sin(t / 23 + 1) * 5 + (fbm(y / 180, 1, { period: 64, octaves: 3, seed: 5 }) - 0.5) * 22;
  };
  const rw = (y) => (y < riverTop ? -40 : 3.5 + Math.min(1, (y - riverTop) / 40) * 2 + (y - riverTop) * 0.03);
  const riverEnd = coastY(riverX(830)) + 6;
  const river = new Path2D();
  const bankL = [];
  const bankR = [];
  for (let y = riverTop; y <= riverEnd; y += 6) {
    // the mouth flares into a little delta of sandbars
    const flare = Math.max(0, y - (riverEnd - 40)) ** 1.6 * 0.12;
    bankL.push([riverX(y) - rw(y) - flare, y]);
    bankR.push([riverX(y) + rw(y) + flare, y]);
  }
  river.moveTo(bankL[0][0], bankL[0][1] - 8);
  for (const [x, y] of bankL) river.lineTo(x, y);
  for (let i = bankR.length - 1; i >= 0; i--) river.lineTo(bankR[i][0], bankR[i][1]);
  river.lineTo(bankR[0][0], bankR[0][1] - 8);
  river.closePath();
  const lake = new Path2D();
  for (let i = 0; i <= 64; i++) {
    const a2 = (i / 64) * Math.PI * 2;
    const q = 1 + (fbm(Math.cos(a2) * 1.4 + 3, Math.sin(a2) * 1.4 + 3, { period: 64, octaves: 3, seed: 17 }) - 0.5) * 0.5;
    const px = LAKE.x + Math.cos(a2) * LAKE.rx * q;
    const py = LAKE.y + Math.sin(a2) * LAKE.ry * q;
    if (i === 0) lake.moveTo(px, py); else lake.lineTo(px, py);
  }
  lake.closePath();
  g.save();
  // reeds and a damp margin along the banks
  g.strokeStyle = 'rgba(70,84,40,0.55)';
  g.lineWidth = 0.6;
  const rr0 = prng(808);
  for (let i = 0; i < bankL.length; i += 2) {
    for (const [bx, by, side] of [[...bankL[i], -1], [...bankR[i], 1]]) {
      if (rr0() < 0.55) continue;
      for (let k2 = 0; k2 < 3; k2++) {
        const x0 = bx + side * (2 + rr0() * 4);
        const y0 = by + (rr0() - 0.5) * 6;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + side * 1.2, y0 - 3 - rr0() * 3); g.stroke();
      }
    }
  }
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(78,128,165,0.55)';
  g.fill(river);
  g.fill(lake);
  g.globalCompositeOperation = 'source-over';
  // banks: a firm ink line and a fainter water-line just inside it
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  for (const bank of [bankL, bankR]) {
    g.beginPath();
    bank.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  g.stroke(lake);
  g.strokeStyle = 'rgba(28,58,98,0.5)';
  g.lineWidth = 0.6;
  for (const [bank, side] of [[bankL, 1], [bankR, -1]]) {
    g.beginPath();
    bank.forEach(([x, y], i) => {
      const w2 = Math.min(2.4, rw(y) * 0.35);
      return i ? g.lineTo(x + side * w2, y) : g.moveTo(x + side * w2, y);
    });
    g.stroke();
  }
  g.save();
  g.translate(LAKE.x, LAKE.y);
  g.scale(1, LAKE.ry / LAKE.rx);
  for (const q of [0.78, 0.58]) { g.beginPath(); g.arc(0, 0, LAKE.rx * q, 0, Math.PI * 2); g.stroke(); }
  g.restore();
  // current: short strokes down the middle of the stream
  g.save();
  g.clip(river);
  g.strokeStyle = 'rgba(30,60,100,0.45)';
  g.lineWidth = 0.6;
  for (let y = riverTop + 14; y < riverEnd - 10; y += 15) {
    const cx = riverX(y);
    const w2 = Math.max(2, rw(y) * 0.5);
    g.beginPath();
    g.moveTo(cx - w2, y);
    g.quadraticCurveTo(cx, y - 3, cx + w2, y);
    g.stroke();
  }
  g.restore();
  // two brooks feeding the mere, tapering out into the woods like a pen flourish
  for (const [pts, w0] of [[[[1010, 254], [1040, 246], [1066, 252], [1094, 240]], 2.6], [[[930, 270], [906, 274], [894, 262]], 2]]) {
    for (let i = 0; i < pts.length - 1; i++) {
      quillStroke(g, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], { width: w0 * (1 - i / pts.length), color: '#3c5a78', amp: 0.8, seed: 31 + i, pool: 0, taper: 0.6, alpha: 0.85 });
    }
  }
  g.restore();
  g.save();
  g.translate(riverX(560) + 30, 560);
  g.rotate(Math.PI / 2 - 0.1);
  g.font = `italic 14px ${SERIF}`;
  g.textAlign = 'center';
  g.letterSpacing = '5px';
  haloText(g, 'STOJANOW RIVER', 0, 0, { color: '#2c3f60', width: 3 });
  g.restore();

  // ---------------- countryside: hills, forest, marsh; the ruins inside the walls ----------------
  const tr = prng(99);
  const avoid = (x, y, pad) => blocks.some((b) => x > b.cx - b.s / 2 - pad && x < b.cx + b.s / 2 + pad && y > b.cy - b.s / 2 - pad && y < b.cy + b.s / 2 + pad);
  const inCartouche = (x, y) => (x < 510 && y < 250) || (x > 890 && y < 245 && x < 1285);
  // the Barren Hills: a massed range west of the walls, peaks crowded two and three deep
  // along a spine, foothills stepping down toward the wall, a shadow wash under the mass
  {
    const peaks = [];
    const spine = (y) => 62 + Math.sin(y / 90) * 14 + (fbm(y / 120, 7, { period: 64, octaves: 2, seed: 44 }) - 0.5) * 20;
    for (let y = 236; y < 780; y += 11 + tr() * 6) {
      if (y > coastY(spine(y)) - 30) continue;
      // the main ridge, big and close; flanking rows smaller (back) and foothills (front, east)
      peaks.push([spine(y) + (tr() - 0.5) * 12, y, 48 + tr() * 30, 26 + tr() ** 1.3 * 26]);
      if (tr() < 0.7) peaks.push([spine(y) - 30 + (tr() - 0.5) * 10, y - 6, 34 + tr() * 18, 18 + tr() * 14]);
      if (tr() < 0.75) peaks.push([spine(y) + 42 + tr() * 22, y + 8, 26 + tr() * 16, 9 + tr() * 9]);
    }
    for (let i = 0; i < 14; i++) peaks.push([200 + tr() * 680, 22 + tr() * 18, 22 + tr() * 16, 10 + tr() * 8]);
    const shown = peaks.filter(([x, y]) => !inCartouche(x, y) && x > 4);
    // the range's shadow and earth: one warm granulated wash under all of it
    const mw = makeCanvas(W * k, H * k);
    const mg = mw.getContext('2d');
    mg.scale(k, k);
    mg.filter = `blur(${(7 * k).toFixed(0)}px)`;
    mg.fillStyle = 'rgba(150,110,62,0.4)';
    for (const [x, y, ww, hh] of shown) { if (x > 160) continue; mg.beginPath(); mg.ellipse(x + ww * 0.1, y - hh * 0.3, ww * 0.6, hh * 0.75, 0, 0, Math.PI * 2); mg.fill(); }
    mg.filter = 'none';
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.globalCompositeOperation = 'destination-out';
    mg.globalAlpha = 0.4;
    mg.fillStyle = mg.createPattern(mottleTile(), 'repeat');
    mg.fillRect(0, 0, W * k, H * k);
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.drawImage(mw, 0, 0, W, H);
    g.restore();
    shown.sort((a, b) => a[1] - b[1]).forEach(([x, y, ww, hh]) => hill(g, x, y, ww, hh, tr));
  }
  // the Quivering Forest east of the river, clustered by noise
  const trees = [];
  for (let i = 0; i < 5000; i++) {
    const x = 1000 + tr() * 290;
    const y = 250 + tr() * 560;
    if (y > coastY(x) - 14) continue;
    if (Math.abs(x - riverX(y)) < rw(y) + 16) continue;
    if (Math.hypot((x - LAKE.x) / (LAKE.rx + 16), (y - LAKE.y) / (LAKE.ry + 14)) < 1) continue;
    if (avoid(x, y, 26) || inCartouche(x, y)) continue;
    if (Math.abs(x - 1158) < 128 && y > 618 && y < 668) continue; // a clearing for the forest's name
    const n = fbm(x / 70, y / 70, { period: 64, octaves: 3, seed: 12 });
    if (n < 0.43 || tr() > (n - 0.43) * 8) continue;
    if (trees.some(([tx, ty]) => Math.hypot(tx - x, (ty - y) * 1.5) < 8)) continue;
    trees.push([x, y, 4.8 + tr() ** 1.6 * 5.5, 1]);
  }
  // a few copses west and north, and along the river
  for (let i = 0; i < 160; i++) {
    const x = 20 + tr() * 1260;
    const y = 30 + tr() * 760;
    if (y > coastY(x) - 14 || inCartouche(x, y) || avoid(x, y, 30)) continue;
    const inWall = x > 135 && x < 915 && y > 40 && y < 790;
    const nearRiver = Math.abs(x - riverX(y)) < rw(y) + 34 && Math.abs(x - riverX(y)) > rw(y) + 8;
    if (inWall || (!nearRiver && tr() < 0.75)) continue;
    if (trees.some(([tx, ty]) => Math.hypot(tx - x, (ty - y) * 1.4) < 11)) continue;
    trees.push([x, y, 4.5 + tr() * 4]);
  }
  // marsh by the river mouth
  for (let i = 0; i < 70; i++) {
    const x = 990 + tr() * 170;
    const y = coastY(x) - 6 - tr() * 46;
    if (Math.abs(x - riverX(y)) < rw(y) + 6 || trees.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 9)) continue;
    marsh(g, x, y, 4 + tr() * 3, tr);
  }
  // the forest floor: a granulated sap-green wash pooled under the canopies, so the
  // woods read as masses rather than scattered trees
  {
    const fw = makeCanvas(W * k, H * k);
    const fg = fw.getContext('2d');
    fg.scale(k, k);
    fg.filter = `blur(${(6 * k).toFixed(0)}px)`;
    fg.fillStyle = 'rgba(120,128,82,0.34)';
    fg.beginPath();
    for (const [x, y, sz] of trees) { fg.moveTo(x + sz * 2.1, y - sz); fg.arc(x, y - sz, sz * 2.1, 0, Math.PI * 2); }
    fg.fill();
    fg.filter = 'none';
    fg.setTransform(1, 0, 0, 1, 0, 0);
    fg.globalCompositeOperation = 'destination-out';
    const mp = fg.createPattern(mottleTile(), 'repeat');
    fg.globalAlpha = 0.45;
    fg.fillStyle = mp;
    fg.fillRect(0, 0, W * k, H * k);
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.drawImage(fw, 0, 0, W, H);
    g.restore();
  }
  trees.sort((a, b) => a[1] - b[1]).forEach(([x, y, sz]) => tree(g, x, y, sz, tr));
  // the forest edge: one continuous inked line round the massed canopy (the union of
  // the crowns, dilated a hair), so the wood reads as a drawn mass, not a scatter
  {
    const fm = makeCanvas(W * k, H * k);
    const fmg = fm.getContext('2d');
    fmg.scale(k, k);
    fmg.fillStyle = '#000';
    for (const [x, y, sz, f] of trees) { if (!f) continue; fmg.beginPath(); fmg.arc(x, y - sz * 1.05, sz * 1.2, 0, Math.PI * 2); fmg.fill(); }
    const ring = makeCanvas(W * k, H * k);
    const rg = ring.getContext('2d');
    const d = 1.3 * k;
    for (let a = 0; a < 8; a++) rg.drawImage(fm, Math.cos(a * Math.PI / 4) * d, Math.sin(a * Math.PI / 4) * d);
    rg.globalCompositeOperation = 'destination-out';
    rg.drawImage(fm, 0, 0);
    rg.globalCompositeOperation = 'source-in';
    rg.fillStyle = 'rgba(43,26,13,0.85)';
    rg.fillRect(0, 0, W * k, H * k);
    g.drawImage(ring, 0, 0, W, H);
  }
  // the Old City between the blocks: streets, plazas and rooftops, ruins thickening northward
  const wallPts = [[150, 250], [160, 60], [700, 48], [890, 50], [905, 250], [915, 470], [900, 780], [140, 780], [150, 250]];
  drawOldCity(g, {
    wall: wallPts,
    seed: 77,
    blocked: (x, y) => inCartouche(x, y) || Math.abs(x - riverX(y)) < rw(y) + 14 || PLAZAS.some(([pi, pj]) => { const [px, py] = latticePt(pi, pj); return Math.hypot(x - px, y - py) < 36; }) || blocks.some((b) => (b.round ? Math.hypot(x - b.cx, y - b.cy) < b.r + 14 : b.poly ? wardHit(b.poly, x, y, 6) : false)),
    streets: latticeStreets(),
    muted: true,
  });
  // plazas at the junctions: open paving, a fountain or a market cross
  PLAZAS.forEach(([pi, pj], n) => {
    const [px, py] = latticePt(pi, pj);
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(226,210,176,0.5)';
    g.beginPath(); g.arc(px, py, 30, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(43,26,13,0.5)';
    g.lineWidth = 0.6;
    for (let rr2 = 8; rr2 < 30; rr2 += 4.5) { g.beginPath(); g.arc(px, py, rr2, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(246,236,210,1)';
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.1;
    if (n % 2 === 0) {
      g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = 'rgba(90,130,170,0.6)';
      g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px, py, 1.5, 0, Math.PI * 2); g.fillStyle = INK.ink; g.fill();
    } else {
      g.fillRect(px - 4, py - 4, 8, 8); g.strokeRect(px - 4, py - 4, 8, 8);
      g.beginPath(); g.moveTo(px, py - 9); g.lineTo(px, py + 9); g.moveTo(px - 6, py - 3); g.lineTo(px + 6, py - 3); g.stroke();
    }
    g.restore();
  });
  g.save();
  g.translate(1158, 646);
  g.rotate(-0.06);
  g.textAlign = 'center';
  g.font = `italic 16px ${SERIF}`;
  g.letterSpacing = '5px';
  haloText(g, 'THE QUIVERING FOREST', 0, 0, { color: '#22301a', halo: 'rgba(240,228,196,0.95)', width: 7 });
  g.restore();
  g.save();
  g.translate(24, 520);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.font = `italic 17px ${SERIF}`;
  g.letterSpacing = '6px';
  haloText(g, 'THE BARREN HILLS', 0, 0, { color: '#4a2e14', halo: 'rgba(240,228,196,0.95)', width: 7 });
  g.restore();

  // ---------------- the old city wall: a continuous crenellated curtain, towers, gates, two breaches ----------------
  drawCityWall(g, wallPts, {
    seed: 4,
    gates: [[908.6, 330, Math.PI / 2], [340, 780, 0], [700, 780, 0], [143.4, 600, Math.PI / 2], [520, 51, 0]],
    breaches: [[380, 56], [909, 640]],
  });
  // the harbour along the shore below the wall, and the wharves at the river mouth
  drawHarbour(g, { coastY, x0: 120, x1: 930, jetties: [330, 470, 620, 760, 880], riverMouth: [riverX(riverEnd - 20), riverEnd - 6, rw(riverEnd - 20)], seed: 9 });

  // ---------------- roads & links ----------------
  const edgePoint = (b, x, y, facing) => {
    const [px, py] = cellToUnits(b, x + 0.5, y + 0.5);
    const half = b.s / 32;
    const [ox, oy] = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[facing];
    return [px + ox * half, py + oy * half, ox, oy];
  };
  const done = new Set();
  const road = (pts, { dashed = false, color = '#4a3220', sea = false } = {}) => {
    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    };
    if (sea) {
      g.setLineDash([6, 6]);
      g.strokeStyle = 'rgba(40,40,60,0.7)';
      g.lineWidth = 1.5;
      path(); g.stroke();
    } else {
      // a road through the old streets: a fine double kerb line, not a pipe
      if (dashed) g.setLineDash([5, 4]);
      g.strokeStyle = color;
      g.globalAlpha = 0.8;
      g.lineWidth = 5.4;
      path(); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.strokeStyle = dashed ? 'rgba(232,217,182,0.95)' : 'rgba(236,220,182,0.98)';
      g.lineWidth = 3.4;
      path(); g.stroke();
    }
    g.restore();
  };
  for (const t of TRAVEL) {
    const a = byId[t.from];
    const b = byId[t.to.map];
    if (!a || !b) continue;
    const key = [t.from, t.to.map].sort().join('|');
    if (done.has(key)) continue;
    done.add(key);
    const both = a.known && b.known;
    if (t.art === 'docks' || t.art === 'keep') {
      const [x0, y0] = cellToUnits(a, t.at.x + 0.5, t.at.y + 1);
      const [x1, y1] = cellToUnits(b, t.to.x + 0.5, t.to.y + 1);
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        pts.push([x0 + (x1 - x0) * u + Math.sin(u * Math.PI) * 70, y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 20]);
      }
      road(pts, { sea: true });
      drawMarker(g, 'boat', pts[10][0] + 8, pts[10][1] - 4, 26, { color: INK.ink });
      continue;
    }
    if (b.round || a.round) continue;
    const back = TRAVEL.find((q) => q.from === t.to.map && q.to.map === t.from);
    const [x0, y0, ox0, oy0] = edgePoint(a, t.at.x, t.at.y, t.at.facing);
    const rev = back ? back.at : { x: t.to.x, y: t.to.y, facing: { N: 'S', S: 'N', E: 'W', W: 'E' }[t.at.facing] };
    const [x1, y1, ox1, oy1] = edgePoint(b, rev.x, rev.y, rev.facing);
    const route = ROUTES[t.id] ?? (back ? ROUTES[back.id]?.slice().reverse() : null);
    let pts;
    if (route) {
      const first = ROUTES[t.id] ? [x0, y0] : [x1, y1];
      const last = ROUTES[t.id] ? [x1, y1] : [x0, y0];
      pts = [first, ...route.map(([px, py], i) => [px, py ?? (i === 0 ? first[1] : last[1])]), last];
      if (!ROUTES[t.id]) pts.reverse();
    } else {
      pts = [[x0, y0], [x0 + ox0 * 8, y0 + oy0 * 8], [x1 + ox1 * 8, y1 + oy1 * 8], [x1, y1]];
    }
    road(pts, { dashed: !both });
    // bridge over the river
    if ((t.from === 'stojanow_gate' && t.to.map === 'wilderness') || (t.to.map === 'stojanow_gate' && t.from === 'wilderness')) {
      const by = (y0 + y1) / 2;
      const bx = riverX(by);
      g.save();
      g.fillStyle = '#c9a877';
      g.strokeStyle = INK.ink;
      g.lineWidth = 1.4;
      g.fillRect(bx - rw(by) - 8, by - 7, (rw(by) + 8) * 2, 14);
      g.strokeRect(bx - rw(by) - 8, by - 7, (rw(by) + 8) * 2, 14);
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(bx + i * 10, by - 7); g.lineTo(bx + i * 10, by + 7); g.stroke(); }
      g.restore();
    }
  }
  // stairs down to the dungeons
  for (const [id, u] of Object.entries(UNDER)) {
    const d = byId[id];
    const p = byId[u.parent];
    if (!d || !p) continue;
    const [x0, y0] = cellToUnits(p, u.x + 0.5, u.y + 0.5);
    const ang = Math.atan2(y0 - d.cy, x0 - d.cx);
    const x1 = d.cx + Math.cos(ang) * (d.r + 4);
    const y1 = d.cy + Math.sin(ang) * (d.r + 4);
    g.save();
    g.setLineDash([3, 4]);
    g.strokeStyle = d.known ? INK.vermilion : 'rgba(90,70,50,0.5)';
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.restore();
  }

  // ---------------- the blocks ----------------
  for (const b of blocks) {
    const m = getMap(b.id);
    if (b.round) drawMedallion(g, b, m, { seen: seenFn(m), secrets: secretsFn(b.id), known: b.known });
    else drawMiniBlock(g, b, m, { seen: seenFn(m), secrets: secretsFn(b.id), known: b.known, here: b.id === here, k });
  }
  for (const [id, u] of Object.entries(UNDER)) {
    const p = byId[u.parent];
    if (!p || !byId[id]) continue;
    const [x0, y0] = cellToUnits(p, u.x + 0.5, u.y + 0.5);
    if (p.known) drawMarker(g, 'stairs', x0, y0, 16, { color: INK.vermilion });
  }
  // labels (ribbons)
  {
    // ribbons never overprint one another: a ribbon that would collide steps down (or up)
    const placedR = [];
    g.save();
    g.font = `bold 15px ${SERIF}`;
    for (const b of blocks) {
      const m = getMap(b.id);
      const label = m.name.toUpperCase();
      g.letterSpacing = label.length > 16 ? '1px' : '2px';
      const rw2 = Math.min(g.measureText(label).width + 24, 220) + 30;
      const ly0 = b.round ? b.cy + b.r + (b.id === 'pool_pyramid' ? 24 : 16) : b.labelY ?? b.y + b.s + 16;
      let best = null;
      for (const dy of [0, -12, 12, -24, 24, -36, 36]) {
        for (const dx of [0, -30, 30, -60, 60]) {
          const box = [b.cx + dx - rw2 / 2, ly0 + dy - 13, rw2, 26];
          let score = Math.abs(dy) * 0.4 + Math.abs(dx) * 0.3;
          for (const o of placedR) {
            const ov = Math.max(0, Math.min(box[0] + box[2], o[0] + o[2]) - Math.max(box[0], o[0])) * Math.max(0, Math.min(box[1] + box[3], o[1] + o[3]) - Math.max(box[1], o[1]));
            if (ov > 0) score += 100 + ov;
          }
          if (!best || score < best.score) best = { score, box, x: b.cx + dx, y: ly0 + dy };
        }
      }
      placedR.push(best.box);
      b.ribbon = best.box;
      drawRibbon(g, best.x, best.y, m.name, { known: b.known, here: b.id === here });
    }
    g.restore();
  }

  // ---------------- sea labels, island, ship, serpent ----------------
  g.save();
  g.textAlign = 'center';
  g.font = `italic 34px ${SERIF}`;
  g.letterSpacing = '14px';
  haloText(g, 'THE MOONSEA', 770, 872, { color: '#1f3358', halo: 'rgba(220,226,222,0.6)', width: 5 });
  g.letterSpacing = '5px';
  g.font = `italic 15px ${SERIF}`;
  g.translate(364, 888);
  g.rotate(Math.PI / 2);
  haloText(g, 'THORN ISLAND', 0, 0, { color: '#2c3518', halo: 'rgba(236,226,200,0.8)', width: 5 });
  g.restore();
  drawShip(g, 520, 938, 88);
  drawSerpent(g, 830, 978, 80);
  drawCompassRose(g, 1175, 860, 72);
  // scale of leagues
  g.save();
  const sx0 = 1105;
  const sy0 = 970;
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#efe0bb' : INK.ink;
    g.fillRect(sx0 + i * 34, sy0, 34, 5);
    g.strokeRect(sx0 + i * 34, sy0, 34, 5);
  }
  g.font = `16px ${SERIF}`;
  g.textAlign = 'center';
  g.fillStyle = '#2b1a0d';
  ['0', '1', '2'].forEach((t, i) => g.fillText(t, sx0 + i * 68, sy0 - 6));
  g.font = `italic 16px ${SERIF}`;
  g.fillText('miles', sx0 + 68, sy0 + 21);
  g.restore();

  // ---------------- cartouche ----------------
  drawCartouche(g, 36, 30, 452, 196);
  drawIlluminatedInitial(g, 'P', 60, 58, 116, { seed: 1340 });
  g.save();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = INK.ink;
  g.font = `bold 58px ${SERIF}`;
  g.letterSpacing = '9px';
  g.fillText('HLAN', 180, 130);
  g.letterSpacing = '1px';
  g.font = `italic 19px ${SERIF}`;
  g.fillStyle = '#4a2c14';
  g.fillText('and the ruins of the Old City,', 186, 160);
  g.fillText('upon the northern Moonsea', 186, 184);
  drawFlourish(g, 330, 204, 200, { color: '#5a3a1c', width: 1 });
  g.restore();

  // ---------------- key ----------------
  drawKey(g, 915, 34, 350, 196);

  g.restore();
  return { canvas, k, blocks, cellToUnits };
}

function drawRibbon(g, cx, cy, text, { known, here }) {
  g.save();
  const label = text.toUpperCase();
  g.font = `bold 15px ${SERIF}`;
  g.letterSpacing = label.length > 16 ? '1px' : '2px';
  const w = Math.min(g.measureText(label).width + 24, 220);
  const hh = 23;
  g.globalAlpha = known ? 1 : 0.88;
  g.fillStyle = 'rgba(60,35,10,0.2)';
  g.fillRect(cx - w / 2 + 3, cy - hh / 2 + 3, w, hh);
  // folded tails
  g.fillStyle = here ? '#8e2a1e' : known ? '#6b4a26' : '#8a7458';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * (w / 2 - 4), cy - hh / 2 + 4);
    g.lineTo(cx + s * (w / 2 + 12), cy - hh / 2 + 4);
    g.lineTo(cx + s * (w / 2 + 6), cy + 2);
    g.lineTo(cx + s * (w / 2 + 12), cy + hh / 2 + 4);
    g.lineTo(cx + s * (w / 2 - 4), cy + hh / 2 + 4);
    g.closePath();
    g.fill();
  }
  g.fillStyle = here ? '#c0402e' : known ? '#efe0bb' : '#e2d4b0';
  g.fillRect(cx - w / 2, cy - hh / 2, w, hh);
  g.strokeStyle = known || here ? INK.ink : 'rgba(43,26,13,0.65)';
  g.lineWidth = 1;
  g.strokeRect(cx - w / 2, cy - hh / 2, w, hh);
  g.fillStyle = here ? '#fff2d6' : known ? INK.ink : '#5a4028';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitFont(g, label, w - 14, 15, 'bold');
  g.fillText(label, cx, cy + 1);
  g.restore();
}

const infoCache = new Map();
const info0 = (m) => infoCache.get(m.id) ?? (infoCache.set(m.id, analyseMap(m)), infoCache.get(m.id));

const regCache = new Map();
const regs0 = (m) => regCache.get(m.id) ?? (regCache.set(m.id, regions(m, info0(m))), regCache.get(m.id));
const PIGMENT = { stone: [[184, 98, 72], [150, 136, 128], [176, 148, 108], [160, 112, 84], [178, 120, 106], [134, 128, 132]], timber: [[204, 148, 72], [192, 102, 58], [200, 128, 74], [178, 90, 72], [208, 168, 98]], ruin: [[150, 128, 104], [132, 126, 112]] };
const SECOND = [[110, 70, 44], [78, 86, 120], [140, 60, 52], [96, 100, 60]];

/**
 * A surveyed block as a little ink plan: watercolour roofs and ground, thin
 * quill walls, and a deckled survey edge where the party's knowledge stops.
 */
function drawMiniBlock(g, b, m, { seen, secrets, known, here, k }) {
  if (!known) return drawUnknownBlock(g, b, m, { k });
  const { x, y, s } = b;
  const cs = s / m.w;
  const info = info0(m);
  const L = Math.ceil(s * k);
  const CX = (i) => i * cs;
  const CY = (j) => j * cs;
  const seenCell = (i, j) => m.inBounds(i, j) && !info.isRock(i, j) && seen(i, j);
  const wild = m.tileset === 'wilderness' || m.tileset === 'graveyard';
  const seed = [...m.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  // knowledge mask (deckled)
  const rects = [];
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (seenCell(i, j)) rects.push([CX(i) * k, CY(j) * k, cs * k, cs * k]);
  const soft = featherMask(L, L, rects, { blur: cs * k * 0.4, grow: cs * k * 0.3 });
  const { mask, edge } = deckleMask(soft, { seed: seed + 2, scale: cs * k * 0.7, amount: 0.7 });
  // unknown remainder: the same hand-laid graphite as the block sheets, drawn finer for the plate
  // a clean vellum patch under the surveyed squares (the knowledge mask, tinted)
  const clean = makeCanvas(L, L);
  {
    const cg = clean.getContext('2d');
    cg.fillStyle = 'rgba(252,246,228,0.85)';
    cg.fillRect(0, 0, L, L);
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(mask, 0, 0);
  }
  // washes
  const wash = makeCanvas(L, L);
  {
    const w = wash.getContext('2d');
    w.scale(k, k);
    const P = { CX, CY, cs, k, walled: (i, j, d) => m.getEdge(i, j, d) !== EDGE.OPEN };
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      if (!info.isRock(i, j)) continue;
      w.fillStyle = 'rgba(110,90,70,0.3)';
      w.fillRect(CX(i), CY(j), cs, cs);
    }
    for (const rg of regs0(m).list) {
      const rs = seed + rg.index * 37;
      const rr = prng(rs);
      let color;
      let alpha;
      if (rg.type === CELL.INTERIOR) {
        const pal = rg.style === 1 ? PIGMENT.timber : rg.style === 2 ? PIGMENT.ruin : PIGMENT.stone;
        const c = pal[Math.floor(rr() * pal.length)];
        const v = 0.86 + rr() * 0.26;
        const hj = (rr() - 0.5) * 0.5;
        color = [c[0] * v + hj * 40, c[1] * v + hj * 10, c[2] * v - hj * 25];
        alpha = 0.56 + rr() * 0.14;
      } else if (rg.type === CELL.WATER) { color = [60, 110, 170]; alpha = 0.6; } else if (rg.type === CELL.RUBBLE) { color = [150, 130, 104]; alpha = 0.42; } else if (rg.type === CELL.COURTYARD) { color = [170, 168, 150]; alpha = 0.3; } else { color = wild ? [120, 150, 80] : [214, 186, 132]; alpha = wild ? 0.42 : 0.24; }
      const roof = rg.type === CELL.INTERIOR;
      washRegion(w, rg.cells, { ...P, color, alpha, seed: rs, edge: roof ? 0.7 : 0.25, blooms: 0, mottle: 0.2, gran: 0.3, glaze: roof ? 0.4 + rr() * 0.3 : 0, second: SECOND[Math.floor(rr() * SECOND.length)] });
      if (roof) {
        hatchBand(w, rg.cells, { ...P, seed: rs + 1, angle: 0.6 + rr() * 0.5, band: 0.32, alpha: 0.5, color: '#4a1e12', width: 0.35 });
        roofLines(w, rg.cells, CX, CY, cs, rr);
      }
    }
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'destination-in';
    w.drawImage(mask, 0, 0);
  }
  // walls
  const ink = makeCanvas(L, L);
  {
    const ig = ink.getContext('2d');
    ig.scale(k, k);
    const { segs, effective } = collectEdges(m, info, seenCell, secrets);
    const runs = mergeRuns(segs.filter((q) => effective(q) !== EDGE.OPEN && effective(q) !== EDGE.ARCH && effective(q) !== EDGE.DOOR).map((q) => ({ ...q, x0: CX(q.x0), y0: CY(q.y0), x1: CX(q.x1), y1: CY(q.y1) })));
    for (const r of runs) quillStroke(ig, r.x0, r.y0, r.x1, r.y1, { width: r.style === 2 ? cs * 0.12 : cs * 0.16, amp: 0.12, seed: (r.x0 * 3 + r.y0 * 7) | 0, pool: 0.6, dry: r.style === 2 ? 1 : 0 });
  }
  // the council's old plan of the district, faint, where the survey has not reached
  const lay = councilPlan(m, s, k, seed, 0.85);
  const ward = b.poly ? polyPath(b.poly) : null;
  g.save();
  if (ward) {
    // the district's ground: a cleaner, warmer wash than the old city round it
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(244,230,196,0.9)';
    g.fill(ward);
    g.restore();
    g.fillStyle = 'rgba(250,242,220,0.55)';
    g.fill(ward);
    g.clip(ward);
  }
  g.translate(b.cx, b.cy);
  g.rotate(b.rot ?? 0);
  g.translate(-s / 2, -s / 2);
  if (!ward) {
    g.fillStyle = 'rgba(248,238,212,0.75)';
    g.fillRect(0, 0, s, s);
  }
  // unknown squares: the faint council plan on the ward's ground; the surveyed part
  // is laid on a clean vellum patch so it leads the eye
  g.globalAlpha = 0.7;
  g.drawImage(lay, 0, 0, s, s);
  g.globalAlpha = 1;
  g.drawImage(clean, 0, 0, s, s);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(wash, 0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(edge, 0, 0, s, s);
  g.drawImage(ink, 0, 0, s, s);
  g.restore();
  // the kerb: the street's edge inked round the district (a gilt rule for the party's own)
  if (b.poly) {
    g.save();
    g.lineJoin = 'round';
    g.strokeStyle = here ? INK.vermilion : INK.ink;
    g.lineWidth = here ? 2.6 : 1.5;
    g.stroke(ward);
    g.lineWidth = 0.6;
    g.strokeStyle = 'rgba(43,26,13,0.7)';
    g.stroke(polyPath(insetPoly(b.poly, b.poly.map(() => -4))));
    if (here) {
      g.strokeStyle = goldGradient(g, b.cx - 80, b.cy - 80, b.cx + 80, b.cy + 80);
      g.lineWidth = 2;
      g.stroke(polyPath(insetPoly(b.poly, b.poly.map(() => -7))));
    }
    g.restore();
  }
}

/** The council's old plan of a block: washed roofs and pencilled outlines from the map data, at plate size. */
function councilPlan(m, s, k, seed, alpha = 0.75) {
  const cs = s / m.w;
  const L = Math.ceil(s * k);
  const lay = makeCanvas(L, L);
  const lg = lay.getContext('2d');
  lg.scale(k, k);
  const CX = (i) => i * cs;
  const CY = (j) => j * cs;
  const gr = prng(seed + 9);
  const wild = m.tileset === 'wilderness' || m.tileset === 'graveyard';
  for (const rg of regs0(m).list) {
    const path = new Path2D();
    for (const [i, j] of rg.cells) path.rect(CX(i) - 0.2, CY(j) - 0.2, cs + 0.4, cs + 0.4);
    if (rg.type === CELL.INTERIOR) {
      const c = (rg.style === 1 ? PIGMENT.timber : rg.style === 2 ? PIGMENT.ruin : PIGMENT.stone)[Math.floor(gr() * 4) % 4] ?? PIGMENT.stone[0];
      const mc = [c[0] * 0.4 + 150 * 0.6, c[1] * 0.4 + 128 * 0.6, c[2] * 0.4 + 100 * 0.6];
      lg.fillStyle = `rgba(${mc[0] | 0},${mc[1] | 0},${mc[2] | 0},${(0.42 * alpha).toFixed(3)})`;
      lg.fill(path);
      roofLines(lg, rg.cells, CX, CY, cs, gr, { alpha: 0.6 * alpha });
      lg.strokeStyle = `rgba(43,26,13,${(0.6 * alpha).toFixed(3)})`;
      lg.lineWidth = 0.6;
      lg.stroke(boundaryPath(rg.cells, CX, CY));
    } else if (rg.type === CELL.WATER) {
      lg.fillStyle = 'rgba(70,120,170,0.3)';
      lg.fill(path);
    } else if (wild && rg.type === CELL.STREET) {
      lg.fillStyle = 'rgba(120,150,80,0.2)';
      lg.fill(path);
    }
  }
  return lay;
}

/**
 * The roofs of a building in plan, within its own footprint: a ridge along the
 * long axis, hips to the corners and faint tile courses (clipped to the cells).
 */
function roofLines(g, cells, CX, CY, cs, rr, { alpha = 1 } = {}) {
  let x0 = 99; let y0 = 99; let x1 = -1; let y1 = -1;
  for (const [i, j] of cells) { x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i + 1); y1 = Math.max(y1, j + 1); }
  const X0 = CX(x0) + cs * 0.12;
  const Y0 = CY(y0) + cs * 0.12;
  const X1 = CX(x1) - cs * 0.12;
  const Y1 = CY(y1) - cs * 0.12;
  const w = X1 - X0;
  const h = Y1 - Y0;
  const clip = new Path2D();
  for (const [i, j] of cells) clip.rect(CX(i), CY(j), cs, cs);
  g.save();
  g.clip(clip);
  const long = w >= h;
  const inset = Math.min(w, h) / 2;
  const [rx0, ry0, rx1, ry1] = long ? [X0 + inset, (Y0 + Y1) / 2, X1 - inset, (Y0 + Y1) / 2] : [(X0 + X1) / 2, Y0 + inset, (X0 + X1) / 2, Y1 - inset];
  g.strokeStyle = `rgba(60,28,14,${(0.22 * alpha).toFixed(3)})`;
  g.lineWidth = 0.3;
  g.beginPath();
  if (long) for (let t = Y0 + 1.1; t < Y1; t += 1.3) { g.moveTo(X0, t); g.lineTo(X1, t); } else for (let t = X0 + 1.1; t < X1; t += 1.3) { g.moveTo(t, Y0); g.lineTo(t, Y1); }
  g.stroke();
  g.strokeStyle = `rgba(43,22,10,${(0.8 * alpha).toFixed(3)})`;
  g.lineWidth = 0.55;
  g.beginPath();
  g.moveTo(rx0, ry0); g.lineTo(rx1, ry1);
  g.moveTo(X0, Y0); g.lineTo(rx0, ry0); g.lineTo(X0, Y1);
  g.moveTo(X1, Y0); g.lineTo(rx1, ry1); g.lineTo(X1, Y1);
  g.stroke();
  if (rr() < 0.6) {
    g.fillStyle = `rgba(43,22,10,${(0.85 * alpha).toFixed(3)})`;
    g.fillRect(X0 + w * (0.2 + rr() * 0.6), Y0 + h * (0.15 + rr() * 0.25), 1.1, 1.1);
  }
  g.restore();
}

/**
 * An unexplored district: its ward under a soft graphite wash with the council's
 * old plan showing faintly through, a unique engraved vignette of what is said to
 * stand there, and the clerks' hearsay lettered beneath it.
 */
function drawUnknownBlock(g, b, m, { k }) {
  const { s } = b;
  const seed = [...m.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  const ward = b.poly ? polyPath(b.poly) : null;
  const lay = councilPlan(m, s, k, seed, 0.5);
  g.save();
  if (ward) {
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(214,200,172,0.75)';
    g.fill(ward);
    g.restore();
    g.clip(ward);
  }
  g.save();
  g.translate(b.cx, b.cy);
  g.rotate(b.rot ?? 0);
  g.globalAlpha = 0.5;
  g.drawImage(lay, -s / 2, -s / 2, s, s);
  g.restore();
  // a calm pencil hatch over the whole ward (the unsurveyed)
  if (ward) {
    g.strokeStyle = 'rgba(80,64,48,0.13)';
    g.lineWidth = 0.6;
    g.beginPath();
    for (let t = -260; t < 260; t += 3.2) { g.moveTo(b.cx + t - 120, b.cy - 120); g.lineTo(b.cx + t + 120, b.cy + 120); }
    g.stroke();
  }
  // a pale ground for the vignette, so its line work reads
  const vg = g.createRadialGradient(b.cx, b.cy - 6, 8, b.cx, b.cy - 6, 62);
  vg.addColorStop(0, 'rgba(246,236,212,0.92)');
  vg.addColorStop(0.7, 'rgba(246,236,212,0.6)');
  vg.addColorStop(1, 'rgba(246,236,212,0)');
  g.fillStyle = vg;
  g.fillRect(b.cx - 70, b.cy - 70, 140, 130);
  (DISTRICT_VIGNETTES[b.id] ?? DISTRICT_VIGNETTES.houses)(g, b.cx, b.cy - 10, 1);
  // (the hearsay lives in the tooltip and the side panel's rumours, never in tiny print here)
  g.restore();
  if (ward) {
    g.save();
    g.setLineDash([5, 3.5]);
    g.strokeStyle = 'rgba(43,26,13,0.7)';
    g.lineWidth = 1.1;
    g.stroke(ward);
    g.restore();
  }
}

/** Engraving helpers: a filled, inked shape and hatched shade inside a clip. */
const ENG = {
  fill: 'rgba(244,234,208,1)',
  shape(g, path, fill = ENG.fill, lw = 1.1) {
    g.fillStyle = fill;
    g.fill(path);
    g.strokeStyle = INK.ink;
    g.lineWidth = lw;
    g.stroke(path);
  },
  hatch(g, path, { gap = 2, ang = 1, a = 0.7 } = {}) {
    g.save();
    g.clip(path);
    g.strokeStyle = `rgba(43,26,13,${a})`;
    g.lineWidth = 0.55;
    g.beginPath();
    for (let t = -80; t < 80; t += gap) { g.moveTo(t - 60 * ang, -60); g.lineTo(t + 60 * ang, 60); }
    g.stroke();
    g.restore();
  },
  rect(x, y, w, h) { const p = new Path2D(); p.rect(x, y, w, h); return p; },
  poly(pts) { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; },
  ground(g, w = 50) {
    g.strokeStyle = 'rgba(43,26,13,0.7)';
    g.lineWidth = 0.7;
    g.beginPath();
    for (let x = -w; x < w; x += 5) { g.moveTo(x, 22 + Math.sin(x) * 0.6); g.lineTo(x + 3, 22 + Math.sin(x) * 0.6); }
    g.stroke();
  },
};

/** One engraved vignette per district never walked (each ~100 units wide, drawn at its centre). */
const DISTRICT_VIGNETTES = {
  // the market square: a fountain between two awninged stalls
  podol_plaza(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    for (const sx of [-30, 30]) {
      const body = ENG.rect(sx - 13, 4, 26, 18);
      ENG.shape(g, body);
      ENG.hatch(g, ENG.rect(sx - 13, 4, 26, 6), { gap: 1.6 });
      const aw = ENG.poly([[sx - 17, 4], [sx + 17, 4], [sx + 12, -8], [sx - 12, -8]]);
      ENG.shape(g, aw, 'rgba(176,64,44,0.75)');
      g.strokeStyle = 'rgba(246,236,210,0.9)'; g.lineWidth = 2.2;
      for (let i = -9; i <= 9; i += 6) { g.beginPath(); g.moveTo(sx + i * 1.15, 3); g.lineTo(sx + i * 0.8, -7); g.stroke(); }
    }
    ENG.shape(g, ENG.poly([[-10, 22], [10, 22], [7, 12], [-7, 12]]));
    const basin = new Path2D(); basin.ellipse(0, 12, 12, 4, 0, 0, Math.PI * 2);
    ENG.shape(g, basin, 'rgba(110,150,180,0.65)');
    ENG.shape(g, ENG.rect(-1.6, -6, 3.2, 18));
    g.strokeStyle = 'rgba(60,100,140,0.85)'; g.lineWidth = 0.8;
    for (const d of [-1, 1]) { g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(d * 8, -14, d * 10, 8); g.stroke(); }
    g.restore();
  },
  // the textile house: a long warehouse, its great door chained
  cadorna_textile(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    const wall = ENG.rect(-36, -2, 72, 24);
    ENG.shape(g, wall);
    ENG.hatch(g, ENG.rect(16, -2, 20, 24), { gap: 1.8 });
    const roof = ENG.poly([[-40, -2], [40, -2], [30, -18], [-30, -18]]);
    ENG.shape(g, roof, 'rgba(150,112,80,0.7)');
    g.strokeStyle = 'rgba(43,26,13,0.5)'; g.lineWidth = 0.5;
    for (let t = -16; t < -2; t += 2.4) { g.beginPath(); g.moveTo(-38 + (t + 18) * 0.5, t); g.lineTo(38 - (t + 18) * 0.5, t); g.stroke(); }
    const door = ENG.rect(-9, 4, 18, 18);
    ENG.shape(g, door, 'rgba(96,64,40,0.85)');
    g.strokeStyle = 'rgba(200,190,170,1)'; g.lineWidth = 1.6;
    g.beginPath(); for (let i = 0; i < 7; i++) { g.moveTo(-12 + i * 4, 10 + (i % 2) * 2.5); g.arc(-12 + i * 4 + 1.6, 10 + (i % 2) * 2.5, 1.6, Math.PI, Math.PI * 3); } g.stroke();
    for (const wx of [-28, -20, 20, 28]) ENG.shape(g, ENG.rect(wx - 2.5, 4, 5, 7), 'rgba(60,40,24,0.8)', 0.7);
    g.restore();
  },
  // Kuto's well: a stone well under a windlass roof
  kutos_well(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g, 34);
    const drum = new Path2D(); drum.moveTo(-16, 6); drum.lineTo(-16, 22); drum.ellipse(0, 22, 16, 4, 0, Math.PI, 0, true); drum.lineTo(16, 6); drum.closePath();
    ENG.shape(g, drum);
    ENG.hatch(g, drum, { gap: 2.4, a: 0.4 });
    g.strokeStyle = 'rgba(43,26,13,0.75)'; g.lineWidth = 0.6;
    for (let r2 = 0; r2 < 3; r2++) { g.beginPath(); g.ellipse(0, 11 + r2 * 4.5, 16, 4, 0, 0, Math.PI); g.stroke(); }
    const mouth = new Path2D(); mouth.ellipse(0, 6, 16, 4.5, 0, 0, Math.PI * 2);
    ENG.shape(g, mouth, 'rgba(30,20,12,0.9)');
    for (const sx of [-13, 13]) ENG.shape(g, ENG.rect(sx - 1.5, -20, 3, 26));
    ENG.shape(g, ENG.poly([[-20, -18], [20, -18], [0, -32]]), 'rgba(140,100,70,0.75)');
    g.strokeStyle = INK.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(-13, -12); g.lineTo(13, -12); g.moveTo(0, -12); g.lineTo(0, 0); g.stroke();
    ENG.shape(g, ENG.poly([[-3, 0], [3, 0], [2.4, 5], [-2.4, 5]]), 'rgba(120,90,60,0.9)', 0.8);
    g.restore();
  },
  // Mendor's library: an arcaded front, an open book, smoke curling from a broken roof
  mendors_library(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    const front = ENG.rect(-30, -14, 60, 36);
    ENG.shape(g, front);
    ENG.shape(g, ENG.poly([[-34, -14], [34, -14], [0, -30]]), 'rgba(160,132,104,0.7)');
    for (let i = -2; i <= 2; i++) {
      const ar = new Path2D(); ar.moveTo(i * 11 - 4, 22); ar.lineTo(i * 11 - 4, -2); ar.arc(i * 11, -2, 4, Math.PI, 0); ar.lineTo(i * 11 + 4, 22); ar.closePath();
      ENG.shape(g, ar, 'rgba(46,32,22,0.85)', 0.8);
    }
    g.strokeStyle = 'rgba(90,80,70,0.7)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(14, -26); g.bezierCurveTo(22, -34, 10, -40, 20, -48); g.stroke();
    g.beginPath(); g.moveTo(20, -24); g.bezierCurveTo(30, -30, 18, -38, 28, -44); g.stroke();
    const book = ENG.poly([[-14, 26], [0, 23], [14, 26], [14, 32], [0, 29], [-14, 32]]);
    ENG.shape(g, book, 'rgba(250,244,226,1)', 0.9);
    g.beginPath(); g.moveTo(0, 23); g.lineTo(0, 29); g.stroke();
    g.restore();
  },
  // Valhingen: headstones, a cross and a dead tree under a crescent
  valhingen_graveyard(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    g.strokeStyle = INK.ink; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(26, 22); g.lineTo(24, -6); g.moveTo(24, -2); g.lineTo(34, -14); g.moveTo(24, -4); g.lineTo(14, -18); g.moveTo(29, -8); g.lineTo(32, -22); g.stroke();
    for (const [sx, sz] of [[-26, 1], [-8, 1.2], [8, 0.9]]) {
      const st = new Path2D(); st.moveTo(sx - 6 * sz, 22); st.lineTo(sx - 6 * sz, 8 - 6 * sz); st.arc(sx, 8 - 6 * sz, 6 * sz, Math.PI, 0); st.lineTo(sx + 6 * sz, 22); st.closePath();
      ENG.shape(g, st);
      ENG.hatch(g, ENG.rect(sx + 2 * sz, -10, 6, 34), { gap: 1.4 });
    }
    ENG.shape(g, ENG.poly([[-1.5, -20], [1.5, -20], [1.5, -14], [6, -14], [6, -11], [1.5, -11], [1.5, 2], [-1.5, 2], [-1.5, -11], [-6, -11], [-6, -14], [-1.5, -14]]));
    const moon = new Path2D(); moon.arc(-26, -26, 7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(244,234,208,1)'; g.fill(moon); g.strokeStyle = INK.ink; g.lineWidth = 0.9; g.stroke(moon);
    g.fillStyle = 'rgba(214,200,172,1)'; g.beginPath(); g.arc(-23, -28, 6, 0, Math.PI * 2); g.fill();
    g.restore();
  },
  // Stojanow gate: twin drum towers, the arch and its portcullis, a war-band's banner
  stojanow_gate(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    ENG.shape(g, ENG.rect(-16, -10, 32, 32));
    const arch = new Path2D(); arch.moveTo(-8, 22); arch.lineTo(-8, 4); arch.arc(0, 4, 8, Math.PI, 0); arch.lineTo(8, 22); arch.closePath();
    ENG.shape(g, arch, 'rgba(36,24,16,0.9)');
    g.strokeStyle = 'rgba(200,190,170,0.9)'; g.lineWidth = 0.7;
    g.beginPath(); for (let i = -6; i <= 6; i += 3) { g.moveTo(i, -2); g.lineTo(i, 14); } for (let j = 0; j < 14; j += 4) { g.moveTo(-7, j); g.lineTo(7, j); } g.stroke();
    for (const sx of [-24, 24]) {
      const tw = ENG.rect(sx - 10, -22, 20, 44);
      ENG.shape(g, tw);
      ENG.hatch(g, ENG.rect(sx + 3, -22, 7, 44), { gap: 1.6 });
      for (let i = 0; i < 3; i++) ENG.shape(g, ENG.rect(sx - 10 + i * 7.5, -27, 5, 5), ENG.fill, 0.8);
      ENG.shape(g, ENG.rect(sx - 1.5, -12, 3, 6), 'rgba(36,24,16,0.9)', 0.6);
    }
    g.strokeStyle = INK.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(24, -27); g.lineTo(24, -44); g.stroke();
    ENG.shape(g, ENG.poly([[24, -44], [40, -40], [24, -35]]), 'rgba(40,40,40,0.85)', 0.8);
    g.restore();
  },
  // Valjevo: the castle keep on its rise, towers and a flag
  valjevo_castle(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.shape(g, ENG.poly([[-46, 24], [-30, 14], [30, 14], [46, 24]]), 'rgba(200,184,150,0.8)', 0.8);
    ENG.shape(g, ENG.rect(-30, -2, 60, 18));
    for (let i = 0; i < 8; i++) ENG.shape(g, ENG.rect(-30 + i * 8, -6, 5, 4), ENG.fill, 0.7);
    ENG.shape(g, ENG.rect(-11, -30, 22, 30));
    ENG.hatch(g, ENG.rect(3, -30, 8, 46), { gap: 1.5 });
    for (let i = 0; i < 3; i++) ENG.shape(g, ENG.rect(-11 + i * 8, -35, 6, 5), ENG.fill, 0.7);
    for (const sx of [-30, 30]) {
      ENG.shape(g, ENG.rect(sx - 6, -14, 12, 30));
      ENG.shape(g, ENG.poly([[sx - 8, -14], [sx + 8, -14], [sx, -26]]), 'rgba(90,96,110,0.8)', 0.8);
    }
    ENG.shape(g, ENG.rect(-2, -22, 4, 8), 'rgba(36,24,16,0.9)', 0.6);
    g.strokeStyle = INK.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -35); g.lineTo(0, -50); g.stroke();
    ENG.shape(g, ENG.poly([[0, -50], [14, -46], [0, -42]]), 'rgba(150,40,30,0.85)', 0.8);
    g.restore();
  },
  // the wild shore beyond the gate: a road winding off between trees
  wilderness(g, x, y) {
    g.save(); g.translate(x, y);
    const road = new Path2D(); road.moveTo(-6, 26); road.bezierCurveTo(-20, 8, 20, 0, 4, -20); road.lineTo(8, -20); road.bezierCurveTo(26, 0, -12, 8, 6, 26); road.closePath();
    ENG.shape(g, road, 'rgba(226,206,164,1)', 0.9);
    for (const [tx, ty, ts] of [[-30, 0, 1.2], [-20, -18, 0.9], [26, 12, 1.1], [30, -14, 1], [-36, 18, 0.8], [18, -26, 0.7]]) {
      const tr2 = new Path2D(); tr2.moveTo(tx, ty - 16 * ts); tr2.lineTo(tx + 8 * ts, ty + 4 * ts); tr2.lineTo(tx - 8 * ts, ty + 4 * ts); tr2.closePath();
      ENG.shape(g, tr2, 'rgba(120,140,90,0.85)', 0.9);
      ENG.hatch(g, tr2, { gap: 1.6, a: 0.5 });
      g.strokeStyle = INK.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(tx, ty + 4 * ts); g.lineTo(tx, ty + 9 * ts); g.stroke();
    }
    g.restore();
  },
  // Sokol keep: a lone tower on the rocks with a light in its window
  sokol_keep(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.shape(g, ENG.poly([[-40, 24], [-26, 10], [-12, 14], [6, 6], [24, 12], [40, 24]]), 'rgba(170,150,120,0.8)', 0.9);
    ENG.shape(g, ENG.poly([[-9, 10], [9, 10], [7, -30], [-7, -30]]));
    ENG.hatch(g, ENG.poly([[2, 10], [9, 10], [7, -30], [2, -30]]), { gap: 1.5 });
    for (let i = 0; i < 3; i++) ENG.shape(g, ENG.rect(-9 + i * 6.5, -35, 4.5, 5), ENG.fill, 0.7);
    ENG.shape(g, ENG.rect(-2, -18, 4, 6), 'rgba(240,190,90,1)', 0.7);
    g.restore();
  },
  // the slums: a huddle of roofs and a broken wall
  houses(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    for (const [hx, hw, hh] of [[-26, 18, 16], [-6, 20, 22], [16, 16, 14], [32, 12, 18]]) {
      ENG.shape(g, ENG.rect(hx - hw / 2, 22 - hh, hw, hh));
      ENG.shape(g, ENG.poly([[hx - hw / 2 - 2, 22 - hh], [hx + hw / 2 + 2, 22 - hh], [hx, 22 - hh - 10]]), 'rgba(160,110,80,0.75)', 0.9);
      ENG.shape(g, ENG.rect(hx - 2, 14, 4, 8), 'rgba(40,26,16,0.9)', 0.6);
    }
    g.restore();
  },
};

/** What the council's clerks wrote across the blocks no one has walked. */
const HEARSAY = {
  valhingen_graveyard: 'the dead walk here',
  stojanow_gate: 'held by a war-band',
  valjevo_castle: 'its lord is not seen',
  cadorna_textile: 'chained from within',
  mendors_library: 'fire-scarred stacks',
  wilderness: 'the river road, wild',
  kutos_well: 'kobolds, they say',
  podol_plaza: 'tolls are taken',
  sokol_keep: 'lights burn by night',
  phlan_slums: 'just past the palisade',
};
const WAX = [[150, 34, 26], [104, 26, 30], [52, 82, 52], [120, 70, 30], [128, 30, 60]];

/** A seal printed flat on the sheet: one even pigment, an engraved ring and letter (no gloss). */
function drawSeal(g, x, y, r, letter, { seed = 1, color = [150, 34, 26], emblem = null } = {}) {
  const rnd = prng(seed);
  g.save();
  g.translate(x, y);
  g.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const q = r * (1 + (rnd() - 0.5) * 0.08);
    if (i === 0) g.moveTo(Math.cos(a) * q, Math.sin(a) * q); else g.lineTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  g.closePath();
  g.fillStyle = `rgba(${color.join(',')},0.82)`;
  g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.9;
  g.stroke();
  g.strokeStyle = 'rgba(250,236,210,0.8)';
  g.lineWidth = r * 0.07;
  g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(250,236,210,0.92)';
  g.strokeStyle = g.fillStyle;
  if (emblem) emblem(g, r);
  else if (letter) {
    g.font = `bold ${Math.round(r * 0.95)}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 0, r * 0.06);
  }
  g.restore();
}

/** Emblems pressed into the dungeon seals. */
const EMBLEMS = {
  // a pick and a lantern for the warrens
  kutos_warrens: (g, r) => {
    g.lineWidth = r * 0.12;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r * 0.4, r * 0.4); g.lineTo(r * 0.3, -r * 0.3); g.stroke();
    g.beginPath(); g.moveTo(r * 0.02, -r * 0.48); g.quadraticCurveTo(r * 0.42, -r * 0.42, r * 0.5, -r * 0.02); g.stroke();
  },
  // the black hand of Bane
  temple_bane: (g, r) => {
    g.beginPath();
    g.moveTo(-r * 0.3, r * 0.45); g.lineTo(-r * 0.32, -r * 0.05);
    for (let i = 0; i < 4; i++) {
      const fx = -r * 0.3 + i * r * 0.17;
      g.lineTo(fx, -r * (0.42 + (i === 1 || i === 2 ? 0.1 : 0)));
      g.lineTo(fx + r * 0.12, -r * (0.42 + (i === 1 || i === 2 ? 0.1 : 0)));
      g.lineTo(fx + r * 0.12, -r * 0.08);
    }
    g.lineTo(r * 0.42, -r * 0.18); g.lineTo(r * 0.45, r * 0.05); g.lineTo(r * 0.3, r * 0.45);
    g.closePath();
    g.fill();
  },
  // a stepped pyramid with rays (the Pool of Radiance)
  pool_pyramid: (g, r) => {
    for (let i = 0; i < 4; i++) g.fillRect(-r * (0.5 - i * 0.12), r * (0.38 - i * 0.16), r * (1 - i * 0.24), r * 0.13);
    g.lineWidth = r * 0.06;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * r * 0.12, -r * 0.28); g.lineTo(i * r * 0.28, -r * 0.55); g.stroke(); }
  },
};

/**
 * A dungeon below ground as an illuminated roundel on the parchment: a band of
 * the dungeon's pigment between two ruled ink circles with engraved ticks, and
 * inside it either the surveyed plan in sepia ink, or, while unexplored, an
 * engraved vignette of what is rumoured to lie below, with its motto.
 */
function drawMedallion(g, b, m, { seen, secrets, known }) {
  const { cx, cy, r } = b;
  const info = analyseMap(m);
  const md = MEDALS[b.id] ?? MEDALS.kutos_warrens;
  const R = r + (b.id === 'pool_pyramid' ? 10 : 7);
  g.save();
  if (b.id === 'pool_pyramid') {
    // the Pool's radiance: a gilt sunburst of alternating straight and flame rays behind the roundel
    g.save();
    const glow = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6);
    glow.addColorStop(0, 'rgba(232,184,80,0.42)');
    glow.addColorStop(1, 'rgba(232,184,80,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, R * 1.6, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const L = R * (i % 2 ? 1.32 : 1.5);
      const hw = i % 2 ? 0.035 : 0.06;
      g.beginPath();
      g.moveTo(cx + Math.cos(a - hw) * R, cy + Math.sin(a - hw) * R);
      if (i % 2) g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      else g.quadraticCurveTo(cx + Math.cos(a + 0.05) * L * 0.85, cy + Math.sin(a + 0.05) * L * 0.85, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      g.lineTo(cx + Math.cos(a + hw) * R, cy + Math.sin(a + hw) * R);
      g.closePath();
      g.fillStyle = goldGradient(g, cx - R, cy - R, cx + R, cy + R);
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(90,60,20,0.8)';
      g.lineWidth = 0.6;
      g.stroke();
    }
    g.restore();
  }
  // a pale wash shadow and the paper disc
  g.fillStyle = 'rgba(70,40,16,0.16)';
  g.beginPath(); g.arc(cx + 2.5, cy + 3, R + 1, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(244,232,204,0.97)';
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  // pigment band, granulated, with fine engraved ticks
  const w = md.wash;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.arc(cx, cy, r, 0, Math.PI * 2, true);
  g.fillStyle = `rgba(${w[0]},${w[1]},${w[2]},0.62)`;
  g.fill();
  g.strokeStyle = 'rgba(43,26,13,0.55)';
  g.lineWidth = 0.5;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1)); g.lineTo(cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * (R - 1)); g.stroke();
  }
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.6;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 0.9;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  // four gilt studs at the cardinal points
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    g.fillStyle = goldGradient(g, cx - 3, cy - 3, cx + 3, cy + 3);
    g.beginPath(); g.arc(cx + Math.cos(a) * (R - 3.5), cy + Math.sin(a) * (R - 3.5), 2.2, 0, Math.PI * 2); g.fill();
    g.lineWidth = 0.5; g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  g.clip();
  if (known) {
    const { x, y, s } = b;
    const cs = s / m.w;
    g.fillStyle = 'rgba(214,196,160,0.35)';
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      if (info.isRock(i, j) || !seen(i, j)) continue;
      g.fillStyle = m.getCell(i, j) === CELL.WATER ? 'rgba(70,120,170,0.5)' : 'rgba(250,240,214,0.9)';
      g.fillRect(x + i * cs, y + j * cs, cs + 0.3, cs + 0.3);
    }
    // bedrock hatched where it borders the survey
    g.strokeStyle = 'rgba(43,26,13,0.35)';
    g.lineWidth = 0.4;
    g.beginPath();
    for (let t = -r * 2; t < r * 2; t += 2.2) { g.moveTo(cx + t, cy - r); g.lineTo(cx + t + r * 2, cy + r); }
    g.save();
    const rockPath = new Path2D();
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (info.isRock(i, j) || !seen(i, j)) rockPath.rect(x + i * cs, y + j * cs, cs + 0.3, cs + 0.3);
    g.clip(rockPath);
    g.stroke();
    g.restore();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.1;
    g.beginPath();
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      if (!seen(i, j) || info.isRock(i, j)) continue;
      for (const d of DIRS) {
        let e = m.getEdge(i, j, d);
        if (e === EDGE.SECRET && !secrets.has(`${i},${j},${d}`)) e = EDGE.WALL;
        if (e !== EDGE.WALL && e !== EDGE.LOCKED) continue;
        const X = x + i * cs;
        const Y = y + j * cs;
        const seg = { N: [X, Y, X + cs, Y], S: [X, Y + cs, X + cs, Y + cs], W: [X, Y, X, Y + cs], E: [X + cs, Y, X + cs, Y + cs] }[d];
        g.moveTo(seg[0], seg[1]);
        g.lineTo(seg[2], seg[3]);
      }
    }
    g.stroke();
  } else {
    // an engraved vignette, toned with a thin wash of the dungeon's pigment
    g.fillStyle = `rgba(${w[0]},${w[1]},${w[2]},0.12)`;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    (VIGNETTES[b.id] ?? VIGNETTES.kutos_warrens)(g, cx, cy - 4, r);
    g.restore();
    g.save();
    if (b.id === 'pool_pyramid') arcText(g, md.motto, cx, cy, r * 0.82, Math.PI / 2, { font: `italic bold ${b.id === 'pool_pyramid' ? 15 : 13}px ${SERIF}`, color: 'rgba(60,30,14,0.95)', spacing: md.motto.length > 13 ? 0.4 : 1.2 });
  }
  g.restore();
}

const MEDALS = {
  kutos_warrens: { motto: 'SVBTER TERRAM', wash: [120, 92, 60] },
  temple_bane: { motto: 'HIC SVNT MONSTRA', wash: [70, 74, 96] },
  pool_pyramid: { motto: 'HIC SVNT DRACONES', wash: [176, 132, 54] },
};

/** Engraved vignettes for the unexplored dungeons (ink line work, hatched shade). */
const VIGNETTES = {
  // the Pool of Radiance: a stepped pyramid over a glowing pool, rays behind
  pool_pyramid: (g, cx, cy, r) => {
    g.save();
    g.strokeStyle = 'rgba(150,100,30,0.55)';
    g.lineWidth = 0.6;
    for (let i = 0; i < 28; i++) {
      const a = -Math.PI + (i / 27) * Math.PI;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.3, cy - r * 0.05 + Math.sin(a) * r * 0.3); g.lineTo(cx + Math.cos(a) * r, cy - r * 0.05 + Math.sin(a) * r); g.stroke();
    }
    const base = cy + r * 0.28;
    for (let i = 0; i < 5; i++) {
      const hw = r * (0.56 - i * 0.1);
      const top = base - (i + 1) * r * 0.12;
      g.fillStyle = 'rgba(232,214,176,0.98)';
      g.fillRect(cx - hw, top, hw * 2, r * 0.12);
      g.save();
      g.beginPath(); g.rect(cx, top, hw, r * 0.12); g.clip();
      g.strokeStyle = 'rgba(43,26,13,0.6)'; g.lineWidth = 0.45;
      g.beginPath(); for (let t = 0; t < hw + 8; t += 1.6) { g.moveTo(cx + t, top); g.lineTo(cx + t + 4, top + r * 0.12); } g.stroke();
      g.restore();
      g.strokeStyle = INK.ink; g.lineWidth = 0.8;
      g.strokeRect(cx - hw, top, hw * 2, r * 0.12);
    }
    // the pool
    g.fillStyle = 'rgba(214,170,70,0.55)';
    g.beginPath(); g.ellipse(cx, base + r * 0.16, r * 0.5, r * 0.1, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink; g.lineWidth = 0.8; g.stroke();
    g.strokeStyle = 'rgba(43,26,13,0.5)'; g.lineWidth = 0.45;
    for (const q of [0.62, 0.32]) { g.beginPath(); g.ellipse(cx, base + r * 0.16, r * 0.5 * q, r * 0.1 * q, 0, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  },
  // the Temple of Bane: a black-pillared portal down a stair, the black hand above
  temple_bane: (g, cx, cy, r) => {
    g.save();
    const w = r * 0.9;
    const top = cy - r * 0.22;
    // pediment
    g.fillStyle = 'rgba(226,214,190,0.98)';
    g.beginPath(); g.moveTo(cx - w * 0.6, top); g.lineTo(cx, top - r * 0.28); g.lineTo(cx + w * 0.6, top); g.closePath(); g.fill();
    g.strokeStyle = INK.ink; g.lineWidth = 0.9; g.stroke();
    // columns and the dark door
    for (const s of [-1, 1]) for (const k of [0.32, 0.5]) {
      g.fillStyle = 'rgba(226,214,190,0.98)';
      g.fillRect(cx + s * w * k - 2, top, 4, r * 0.5);
      g.strokeRect(cx + s * w * k - 2, top, 4, r * 0.5);
    }
    g.fillStyle = 'rgba(30,26,30,0.92)';
    g.beginPath(); g.moveTo(cx - w * 0.16, top + r * 0.5); g.lineTo(cx - w * 0.16, top + r * 0.12); g.quadraticCurveTo(cx, top - r * 0.02, cx + w * 0.16, top + r * 0.12); g.lineTo(cx + w * 0.16, top + r * 0.5); g.closePath(); g.fill();
    // steps
    for (let i = 0; i < 3; i++) { g.strokeRect(cx - w * (0.6 + i * 0.06), top + r * (0.5 + i * 0.07), w * (1.2 + i * 0.12), r * 0.07); }
    // the hand of Bane, inked in the pediment
    g.fillStyle = INK.ink;
    const hx = cx;
    const hy = top - r * 0.1;
    g.beginPath(); g.ellipse(hx, hy + 1.5, 2.6, 2.2, 0, 0, Math.PI * 2); g.fill();
    for (let i = -1.5; i <= 1.5; i++) g.fillRect(hx + i * 1.5 - 0.5, hy - 3.8, 1, 3.2);
    g.restore();
  },
  // Kuto's warrens: a cave mouth in the rock, hatched dark within, a pick and lantern beside
  kutos_warrens: (g, cx, cy, r) => {
    g.save();
    const rock = new Path2D();
    rock.moveTo(cx - r, cy + r * 0.45);
    rock.lineTo(cx - r * 0.7, cy - r * 0.1);
    rock.lineTo(cx - r * 0.42, cy - r * 0.32);
    rock.lineTo(cx - r * 0.1, cy - r * 0.42);
    rock.lineTo(cx + r * 0.3, cy - r * 0.36);
    rock.lineTo(cx + r * 0.66, cy - r * 0.12);
    rock.lineTo(cx + r, cy + r * 0.45);
    rock.closePath();
    g.fillStyle = 'rgba(214,196,160,0.98)';
    g.fill(rock);
    g.strokeStyle = INK.ink; g.lineWidth = 0.9; g.stroke(rock);
    // crags
    g.strokeStyle = 'rgba(43,26,13,0.55)'; g.lineWidth = 0.5;
    for (const [ax, ay, bx, by] of [[-0.6, 0.0, -0.45, 0.3], [0.5, -0.05, 0.38, 0.25], [-0.25, -0.35, -0.3, -0.18], [0.2, -0.3, 0.28, -0.12]]) { g.beginPath(); g.moveTo(cx + ax * r, cy + ay * r); g.lineTo(cx + bx * r, cy + by * r); g.stroke(); }
    // the mouth
    const mouth = new Path2D();
    mouth.moveTo(cx - r * 0.34, cy + r * 0.45);
    mouth.quadraticCurveTo(cx - r * 0.3, cy - r * 0.12, cx, cy - r * 0.14);
    mouth.quadraticCurveTo(cx + r * 0.3, cy - r * 0.12, cx + r * 0.34, cy + r * 0.45);
    mouth.closePath();
    g.fillStyle = 'rgba(40,30,22,0.9)';
    g.fill(mouth);
    g.strokeStyle = INK.ink; g.lineWidth = 1; g.stroke(mouth);
    // two eyes in the dark
    g.fillStyle = 'rgba(230,180,80,0.95)';
    for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * 2.6, cy + r * 0.12, 0.9, 0, Math.PI * 2); g.fill(); }
    // the ground line
    g.strokeStyle = INK.ink; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(cx - r, cy + r * 0.45); g.lineTo(cx + r, cy + r * 0.45); g.stroke();
    g.restore();
  },
};

/** Letters set around a circle, centred on an angle (reading left to right along the bottom). */
function arcText(g, text, cx, cy, R, at, { font, color, spacing = 1 } = {}) {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, w) => a + w, 0);
  // along the bottom the text runs right-to-left in angle, so it reads upright
  let a = at + total / R / 2;
  for (const [i, ch] of [...text].entries()) {
    const da = widths[i] / R;
    a -= da / 2;
    g.save();
    g.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.rotate(a - Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    a -= da / 2;
  }
  g.restore();
}

// ---------------------------------------------------------------- countryside glyphs

/**
 * A hill in the engraver's manner: an irregular one- or two-peaked profile,
 * a ridge line falling from the summit, and hachures laid down the shadowed
 * (east) flank, denser near the crest.
 */
function hill(g, x, y, w, h, r) {
  g.save();
  const peaks = [{ u: 0.38 + (r() - 0.5) * 0.25, hgt: 1 }];
  if (r() < 0.45) peaks.push({ u: peaks[0].u + (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.12), hgt: 0.5 + r() * 0.3 });
  const N = 22;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let v = 0;
    for (const pk of peaks) {
      const d = Math.abs(u - pk.u) / (u < pk.u ? pk.u + 0.02 : 1.02 - pk.u);
      v = Math.max(v, pk.hgt * Math.max(0, 1 - d * d) ** 1.6);
    }
    v *= 1 + (r() - 0.5) * 0.12;
    prof.push([x - w / 2 + u * w, y - v * h]);
  }
  const shape = new Path2D();
  shape.moveTo(prof[0][0], y);
  for (const [px, py] of prof) shape.lineTo(px, py);
  shape.lineTo(prof[N][0], y);
  shape.closePath();
  const tv = 0.92 + r() * 0.12;
  g.fillStyle = `rgba(${222 * tv | 0},${196 * tv | 0},${148 * tv | 0},0.94)`;
  g.fill(shape);
  g.save();
  g.clip(shape);
  // a wash on the shadowed flank of each summit
  for (const pk of peaks) {
    const px = x - w / 2 + pk.u * w;
    g.fillStyle = 'rgba(110,76,40,0.34)';
    g.beginPath(); g.moveTo(px, y - pk.hgt * h - 2); g.lineTo(px + w * 0.7, y + 1); g.lineTo(px + w * 0.02, y + 1); g.closePath(); g.fill();
  }
  // hachures down the east flanks
  g.strokeStyle = 'rgba(43,26,13,0.75)';
  g.lineCap = 'round';
  for (let i = 1; i < N; i++) {
    const [px, py] = prof[i];
    const [qx, qy] = prof[i + 1];
    if (qy <= py) continue; // only where the profile falls away to the east
    const depth = y - py;
    if (depth < 2) continue;
    for (let k = 0; k < 2; k++) {
      const sx = px + (qx - px) * (k * 0.5 + r() * 0.2);
      const sy = py + (qy - py) * (k * 0.5) + 0.8;
      const L = depth * (0.45 + r() * 0.35);
      g.lineWidth = 0.45 + r() * 0.25;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + L * 0.28, sy + L); g.stroke();
    }
  }
  g.restore();
  // outline (heavier on the shadow side), ridge line from each summit
  g.strokeStyle = INK.ink;
  g.lineJoin = 'round';
  g.lineWidth = 1.05;
  g.beginPath();
  prof.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.stroke();
  g.lineWidth = 0.6;
  for (const pk of peaks) {
    const px = x - w / 2 + pk.u * w;
    const py = y - pk.hgt * h;
    g.beginPath();
    g.moveTo(px, py + 1);
    g.quadraticCurveTo(px + w * 0.05, py + (y - py) * 0.5, px + w * (0.02 + r() * 0.08), y - 1);
    g.stroke();
  }
  // scrub at the foot
  g.strokeStyle = 'rgba(43,26,13,0.5)';
  g.lineWidth = 0.5;
  for (let i = 0; i < 3; i++) {
    const sx = x - w / 2 + r() * w;
    g.beginPath(); g.moveTo(sx, y + 1.5); g.lineTo(sx + 1, y - 1); g.moveTo(sx + 1.6, y + 1.5); g.lineTo(sx + 2.2, y - 0.6); g.stroke();
  }
  g.restore();
}

/**
 * A tree as an engraver cuts it: a scalloped crown outlined in ink, left
 * almost white on the lit side and built up with stipple and short hatching
 * toward the shadowed south-east, a short trunk, and its shadow laid on the
 * ground as a few horizontal cuts. One in five is a conifer of stacked chevrons.
 */
function tree(g, x, y, s, r) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // shadow on the ground: short horizontal cuts to the south-east
  g.strokeStyle = 'rgba(43,26,13,0.42)';
  g.lineWidth = 0.45;
  for (let i = 0; i < 4; i++) {
    const yy = y + 0.4 + i * 1.1;
    g.beginPath(); g.moveTo(x + s * (0.1 + i * 0.12), yy); g.lineTo(x + s * (0.95 - i * 0.08), yy); g.stroke();
  }
  if (r() < 0.2) {
    const H = s * (2.2 + r() * 0.6);
    const W = s * (0.85 + r() * 0.2);
    g.strokeStyle = INK.ink;
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - H); g.stroke();
    for (let k = 0; k < 7; k++) {
      const t = k / 7;
      const yy = y - H * 0.12 - t * H * 0.85;
      const ww = W * (1 - t * 0.85);
      g.lineWidth = 0.7;
      g.strokeStyle = 'rgba(43,26,13,0.55)';
      g.beginPath(); g.moveTo(x, yy - ww * 0.5); g.lineTo(x - ww, yy); g.stroke();
      g.strokeStyle = INK.ink;
      g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(x, yy - ww * 0.5); g.lineTo(x + ww, yy); g.stroke();
      g.lineWidth = 0.4;
      g.beginPath(); g.moveTo(x + ww * 0.3, yy - ww * 0.3); g.lineTo(x + ww * 0.7, yy - ww * 0.05); g.stroke();
    }
    g.restore();
    return;
  }
  const R = s * (0.82 + r() * 0.2);
  const cy = y - s * 1.05;
  const n = 9 + Math.floor(r() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.2;
    pts.push([x + Math.cos(a) * R * (0.82 + r() * 0.16), cy + Math.sin(a) * R * 0.9 * (0.82 + r() * 0.16), a]);
  }
  const crown = new Path2D();
  crown.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const [ax, ay, aa] = pts[i];
    const [bx, by, ba] = pts[(i + 1) % n];
    const am = (aa + (ba < aa ? ba + Math.PI * 2 : ba)) / 2;
    crown.quadraticCurveTo(x + Math.cos(am) * R * 1.18, cy + Math.sin(am) * R * 1.06, bx, by);
    void ax; void ay;
  }
  crown.closePath();
  // trunk
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 0.03, cy + R * 0.6); g.stroke();
  g.fillStyle = 'rgba(232,226,196,0.96)';
  g.fill(crown);
  g.save();
  g.clip(crown);
  g.fillStyle = 'rgba(128,146,84,0.5)';
  g.fill(crown);
  // stipple toward the shadowed side
  g.fillStyle = INK.ink;
  const dots = Math.round(R * R * 3.2);
  for (let i = 0; i < dots; i++) {
    const px = x + (r() * 2 - 1) * R * 1.1;
    const py = cy + (r() * 2 - 1) * R;
    const shade = Math.max(0, Math.min(1, ((px - x) + (py - cy)) / (2.2 * R) + 0.5));
    if (r() > shade * shade * 1.2) continue;
    g.globalAlpha = 0.45 + r() * 0.4;
    g.beginPath(); g.arc(px, py, 0.32 + r() * 0.22, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // a few hatched cuts along the lee edge
  g.strokeStyle = 'rgba(30,22,12,0.6)';
  g.lineWidth = 0.42;
  for (let i = 0; i < 6; i++) {
    const a = 0.1 + (i / 6) * 1.5;
    const ex = x + Math.cos(a) * R * 0.95;
    const ey = cy + Math.sin(a) * R * 0.85;
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - R * 0.35, ey - R * 0.2); g.stroke();
  }
  g.restore();
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.8;
  g.stroke(crown);
  g.restore();
}

/** Reeds and standing water. */
function marsh(g, x, y, s, r) {
  g.save();
  g.strokeStyle = 'rgba(28,58,98,0.55)';
  g.lineWidth = 0.6;
  for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(x - s * 1.2 + i * s * 0.5, y + 1.5 + i * 2.2); g.lineTo(x + s * 0.6 + i * s * 0.6, y + 1.5 + i * 2.2); g.stroke(); }
  g.strokeStyle = 'rgba(52,64,28,0.85)';
  g.lineWidth = 0.7;
  for (let i = -2; i <= 2; i++) {
    const h = s * (1 + r() * 0.8) * (1 - Math.abs(i) * 0.18);
    g.beginPath(); g.moveTo(x + i * s * 0.25, y); g.quadraticCurveTo(x + i * s * 0.3, y - h * 0.6, x + i * s * 0.45 + (r() - 0.5) * s * 0.3, y - h); g.stroke();
  }
  g.restore();
}

function thorn(g, x, y, s, r) {
  g.save();
  g.strokeStyle = 'rgba(40,46,20,0.85)';
  g.lineWidth = 0.6;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); g.stroke();
  }
  g.restore();
}

function rock(g, x, y, s, r) {
  g.save();
  g.beginPath();
  g.moveTo(x - s, y);
  g.lineTo(x - s * 0.6, y - s * (0.6 + r() * 0.4));
  g.lineTo(x + s * 0.2, y - s * (0.8 + r() * 0.4));
  g.lineTo(x + s, y);
  g.closePath();
  g.fillStyle = 'rgba(200,186,160,0.95)';
  g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.7;
  g.stroke();
  g.beginPath(); g.moveTo(x + s * 0.15, y - s * 0.7); g.lineTo(x + s * 0.4, y); g.stroke();
  g.restore();
}

/** A tiny ruined house footprint (the Old City between the blocks). */
function ruinHouse(g, x, y, w, h, r) {
  g.save();
  g.translate(x, y);
  g.rotate((r() - 0.5) * 0.12);
  g.fillStyle = 'rgba(160,110,80,0.16)';
  g.fillRect(-w / 2, -h / 2, w, h);
  lineShade(g, -w / 2, -h / 2, w, h, { gap: 1.6, angle: -Math.PI / 4, color: '#3a2a1a', width: 0.35, alpha: 0.35 });
  g.strokeStyle = 'rgba(43,26,13,0.55)';
  g.lineWidth = 0.7;
  const broken = r() < 0.45;
  g.beginPath();
  g.moveTo(-w / 2, -h / 2); g.lineTo(w / 2, -h / 2); g.lineTo(w / 2, h / 2);
  if (broken) { g.moveTo(w * 0.1, h / 2); g.lineTo(-w / 2, h / 2); } else g.lineTo(-w / 2, h / 2);
  g.lineTo(-w / 2, -h / 2);
  g.stroke();
  g.restore();
}

function drawKey(g, x, y, w, h) {
  g.save();
  g.fillStyle = 'rgba(246,234,204,0.88)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.6;
  g.strokeRect(x, y, w, h);
  g.lineWidth = 0.7;
  g.strokeRect(x + 5, y + 5, w - 10, h - 10);
  g.font = `bold 20px ${SERIF}`;
  g.letterSpacing = '6px';
  g.textAlign = 'center';
  g.fillStyle = INK.ink;
  g.fillText('KEY', x + w / 2 + 3, y + 30);
  g.letterSpacing = '0px';
  drawFlourish(g, x + w / 2, y + 44, 120, { color: '#5a3a1c', width: 1 });
  // few entries, lettered large
  const rows = [
    ['block', 'Surveyed'], ['unknown', 'Unexplored'], ['road', 'Road'], ['sea', 'Sea route'],
    ['under', 'Stair down'], ['here', 'You are here'],
  ];
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  rows.forEach(([k, label], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + 30 + col * (w / 2 - 8);
    const cy = y + 76 + row * 40;
    g.save();
    switch (k) {
      case 'block': g.fillStyle = 'rgba(248,238,212,0.9)'; g.fillRect(cx - 13, cy - 10, 26, 20); g.fillStyle = 'rgba(190,96,70,0.6)'; g.fillRect(cx - 9, cy - 6, 10, 7); g.fillRect(cx + 3, cy, 7, 6); g.strokeStyle = INK.ink; g.lineWidth = 1.2; g.strokeRect(cx - 13, cy - 10, 26, 20); break;
      case 'unknown': {
        g.fillStyle = 'rgba(214,200,172,0.8)'; g.fillRect(cx - 13, cy - 10, 26, 20);
        g.save(); g.beginPath(); g.rect(cx - 13, cy - 10, 26, 20); g.clip();
        g.strokeStyle = 'rgba(80,64,48,0.35)'; g.lineWidth = 0.6; g.beginPath();
        for (let t = -30; t < 30; t += 3) { g.moveTo(cx + t - 10, cy - 10); g.lineTo(cx + t + 10, cy + 10); }
        g.stroke(); g.restore();
        g.setLineDash([3, 2]); g.strokeStyle = 'rgba(43,26,13,0.8)'; g.lineWidth = 1; g.strokeRect(cx - 13, cy - 10, 26, 20); g.setLineDash([]);
        // a tiny engraved tower: the vignettes that stand on unwalked districts
        g.fillStyle = 'rgba(244,234,208,1)'; g.fillRect(cx - 3, cy - 6, 6, 12); g.strokeStyle = INK.ink; g.strokeRect(cx - 3, cy - 6, 6, 12);
        break;
      }
      case 'road': g.strokeStyle = '#4a3220'; g.lineWidth = 8; g.beginPath(); g.moveTo(cx - 15, cy); g.lineTo(cx + 15, cy); g.stroke(); g.strokeStyle = '#e9d6a8'; g.lineWidth = 5; g.stroke(); break;
      case 'sea': g.setLineDash([5, 4]); g.strokeStyle = 'rgba(40,40,60,0.85)'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx - 15, cy); g.lineTo(cx + 15, cy); g.stroke(); break;
      case 'under': drawMarker(g, 'stairs', cx, cy, 24, { color: INK.vermilion }); break;
      case 'here': {
        g.fillStyle = 'rgba(248,238,212,0.9)'; g.fillRect(cx - 13, cy - 10, 26, 20);
        g.strokeStyle = INK.vermilion; g.lineWidth = 2; g.strokeRect(cx - 13, cy - 10, 26, 20);
        g.translate(cx, cy);
        g.fillStyle = '#c63a28';
        g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill();
        g.strokeStyle = INK.ink; g.lineWidth = 0.8; g.stroke();
        break;
      }
      default:
    }
    g.restore();
    g.font = `20px ${SERIF}`;
    g.fillStyle = '#2e1b0d';
    g.fillText(label, cx + 24, cy + 1);
  });
  g.restore();
}

/** A carrack under sail, engraved: planked hull, two masts, bellied square sails, pennants and wake. */
function drawShip(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 60, s / 60);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // wake and reflection
  g.strokeStyle = 'rgba(28,58,98,0.55)';
  g.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.moveTo(-34 - i * 9, 6 + i * 2.2); g.quadraticCurveTo(-40 - i * 9, 4 + i * 2.2, -48 - i * 10, 7 + i * 2.6); g.stroke();
  }
  g.beginPath(); g.moveTo(-30, 9); g.quadraticCurveTo(0, 13, 32, 8); g.stroke();
  // hull: high stern castle, low waist, raised forecastle
  const hull = new Path2D();
  hull.moveTo(-32, -10);
  hull.lineTo(-30, 2);
  hull.quadraticCurveTo(-24, 9, -6, 9);
  hull.lineTo(16, 9);
  hull.quadraticCurveTo(30, 7, 36, -6);
  hull.lineTo(28, -6);
  hull.lineTo(26, -2);
  hull.lineTo(-18, -2);
  hull.lineTo(-20, -10);
  hull.closePath();
  g.fillStyle = '#b08250';
  g.fill(hull);
  g.save();
  g.clip(hull);
  g.strokeStyle = 'rgba(40,22,8,0.7)';
  g.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-34, -8 + i * 3.6); g.quadraticCurveTo(0, -1 + i * 3.4, 38, -8 + i * 3.4); g.stroke(); }
  g.fillStyle = 'rgba(30,14,4,0.35)';
  g.fillRect(-34, 3, 72, 8);
  g.restore();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.4;
  g.stroke(hull);
  // gunports and the stern lantern
  g.fillStyle = INK.ink;
  for (let i = 0; i < 4; i++) g.fillRect(-10 + i * 7, 1.5, 2.4, 2);
  g.fillStyle = INK.goldHi;
  g.beginPath(); g.arc(-33, -13, 1.6, 0, Math.PI * 2); g.fill();
  // masts and rigging
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(-4, -2); g.lineTo(-4, -52); g.moveTo(16, -2); g.lineTo(16, -38); g.moveTo(-24, -10); g.lineTo(-24, -30); g.stroke();
  g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(-4, -52); g.lineTo(36, -6); g.moveTo(-4, -52); g.lineTo(-31, -10); g.moveTo(16, -38); g.lineTo(36, -6); g.stroke();
  // square sails, bellied by the wind, shaded with engraved lines
  const sail = (cx, top, w, h) => {
    const p = new Path2D();
    p.moveTo(cx - w / 2, top);
    p.lineTo(cx + w / 2, top);
    p.quadraticCurveTo(cx + w / 2 + 4, top + h * 0.5, cx + w / 2 - 1, top + h);
    p.quadraticCurveTo(cx, top + h + 4, cx - w / 2 + 1, top + h);
    p.quadraticCurveTo(cx - w / 2 + 4, top + h * 0.5, cx - w / 2, top);
    g.fillStyle = '#f3e8cc';
    g.fill(p);
    g.save();
    g.clip(p);
    g.strokeStyle = 'rgba(60,40,20,0.45)';
    g.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(cx + w * 0.1 + i * 2.4, top); g.quadraticCurveTo(cx + w * 0.3 + i * 2.4, top + h * 0.5, cx + w * 0.12 + i * 2.4, top + h + 2); g.stroke(); }
    g.restore();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1;
    g.stroke(p);
    g.beginPath(); g.moveTo(cx - w / 2 - 2, top); g.lineTo(cx + w / 2 + 2, top); g.stroke();
  };
  sail(-4, -48, 26, 18);
  sail(-4, -27, 30, 20);
  sail(16, -34, 18, 24);
  // lateen on the mizzen
  g.beginPath(); g.moveTo(-24, -30); g.lineTo(-14, -12); g.lineTo(-32, -12); g.closePath();
  g.fillStyle = '#efe2c2'; g.fill(); g.stroke();
  // pennants
  g.fillStyle = INK.vermilion;
  g.beginPath(); g.moveTo(-4, -52); g.quadraticCurveTo(6, -55, 14, -51); g.quadraticCurveTo(6, -52, -4, -49); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(16, -38); g.quadraticCurveTo(22, -40, 27, -37); g.quadraticCurveTo(22, -38, 16, -36); g.closePath(); g.fill();
  g.restore();
}

/** The Moonsea serpent: scaled coils breaking the water, a finned crest and an open jaw. */
function drawSerpent(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 60, s / 60);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const body = '#a3a68e';
  const coil = (hx, w, h) => {
    const outer = new Path2D();
    outer.moveTo(hx - w / 2, 2);
    outer.bezierCurveTo(hx - w / 2, -h, hx + w / 2, -h, hx + w / 2, 2);
    outer.lineTo(hx + w / 2 - 6, 2);
    outer.bezierCurveTo(hx + w / 2 - 6, -h + 9, hx - w / 2 + 6, -h + 9, hx - w / 2 + 6, 2);
    outer.closePath();
    g.fillStyle = body;
    g.fill(outer);
    g.save();
    g.clip(outer);
    // belly band and scales
    g.strokeStyle = 'rgba(232,214,160,0.4)';
    g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(hx - w / 2 + 4.5, 2); g.bezierCurveTo(hx - w / 2 + 4.5, -h + 7, hx + w / 2 - 4.5, -h + 7, hx + w / 2 - 4.5, 2); g.stroke();
    g.strokeStyle = 'rgba(20,40,24,0.6)';
    g.lineWidth = 0.5;
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const px = hx - w / 2 + 2 + t * (w - 4);
      const py = -h * 0.75 * Math.sin(t * Math.PI) + 1;
      g.beginPath(); g.arc(px, py, 2, 0.2, Math.PI - 0.2); g.stroke();
    }
    // engraved shading: fine parallel cuts on the shadowed half of each coil
    g.save();
    g.beginPath(); g.rect(hx - w * 0.05, -h - 2, w, h + 6); g.clip();
    lineShade(g, hx - w, -h - 4, w * 2, h + 10, { gap: 1.6, angle: -1.1, color: '#14281a', width: 0.45, alpha: 0.7 });
    g.restore();
    g.restore();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.2;
    g.stroke(outer);
    // dorsal fin spikes
    g.fillStyle = '#b8b094';
    for (let i = 0; i < 4; i++) {
      const t = 0.25 + i * 0.17;
      const px = hx - w / 2 + t * w;
      const py = -h * 0.76 * Math.sin(t * Math.PI);
      g.beginPath(); g.moveTo(px - 2.5, py + 1); g.lineTo(px - 1, py - 6); g.lineTo(px + 2.5, py + 1); g.closePath(); g.fill(); g.lineWidth = 0.6; g.stroke();
    }
  };
  coil(-46, 26, 20);
  coil(-16, 30, 26);
  // tail flick
  g.fillStyle = body;
  g.beginPath(); g.moveTo(-64, 2); g.quadraticCurveTo(-70, -8, -78, -10); g.quadraticCurveTo(-72, -2, -70, 2); g.closePath(); g.fill();
  g.strokeStyle = INK.ink; g.lineWidth = 1; g.stroke();
  // neck and head
  const neck = new Path2D();
  neck.moveTo(6, 2);
  neck.bezierCurveTo(8, -18, 14, -34, 28, -38);
  neck.lineTo(42, -40);
  neck.lineTo(50, -36);
  neck.lineTo(40, -33);
  neck.lineTo(48, -29);
  neck.lineTo(36, -28);
  neck.bezierCurveTo(26, -26, 18, -12, 16, 2);
  neck.closePath();
  g.fillStyle = body;
  g.fill(neck);
  g.save();
  g.clip(neck);
  lineShade(g, 16, -42, 40, 46, { gap: 1.6, angle: -1.1, color: '#14281a', width: 0.45, alpha: 0.7 });
  g.strokeStyle = 'rgba(240,220,160,0.5)';
  g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(14, 2); g.bezierCurveTo(17, -12, 24, -24, 36, -29); g.stroke();
  g.restore();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.2;
  g.stroke(neck);
  // jaw: a dark cut where the mouth opens
  g.fillStyle = INK.ink;
  g.beginPath(); g.moveTo(40, -33); g.lineTo(50, -32.5); g.lineTo(46, -31); g.closePath(); g.fill();
  // crest / frill, cut in line like the rest of the block
  g.fillStyle = '#b8b094';
  g.beginPath(); g.moveTo(22, -34); g.lineTo(18, -46); g.lineTo(26, -40); g.lineTo(26, -50); g.lineTo(31, -41); g.lineTo(34, -48); g.lineTo(35, -39); g.closePath(); g.fill();
  g.lineWidth = 0.7; g.stroke();
  // eye: a small slit cut into the block
  g.strokeStyle = INK.ink;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(35.6, -36.4); g.lineTo(38.6, -35.6); g.stroke();
  // foam where the coils break the water
  g.strokeStyle = 'rgba(250,244,226,0.85)';
  g.lineWidth = 1;
  for (const fx of [-59, -33, -1, 21, 6]) {
    g.beginPath(); g.moveTo(fx - 5, 1); g.quadraticCurveTo(fx - 2, -3, fx, 0); g.quadraticCurveTo(fx + 2, -3, fx + 5, 1); g.stroke();
  }
  // water breaking around the coils
  g.strokeStyle = 'rgba(28,58,98,0.65)';
  g.lineWidth = 0.8;
  for (let i = -5; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 13 - 6, 4 + (i & 1)); g.quadraticCurveTo(i * 13, 1 + (i & 1), i * 13 + 6, 4 + (i & 1)); g.stroke();
  }
  g.restore();
}

export { wobblePoints };
