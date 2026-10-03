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
  // the sea stops at the sheet's ruled border: a clean strip of paper below it
  g.beginPath();
  g.rect(15, 15, W - 30, H - 30);
  g.clip();
  // sea wash: a little deeper offshore, mottled (never a dark vignette at the border)
  const sg = g.createLinearGradient(0, 770, 0, H);
  sg.addColorStop(0, 'rgba(150,190,180,0.3)');
  sg.addColorStop(0.3, 'rgba(100,148,166,0.4)');
  sg.addColorStop(1, 'rgba(76,116,150,0.5)');
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = sg;
  g.fillRect(0, 700, W, 400);
  g.globalCompositeOperation = 'source-over';
  const r = prng(55);
  // engraved swell: rows of broken wave strokes, parallel to the shore
  g.lineCap = 'round';
  for (let j = 0; j < 22; j++) {
    const fade = Math.max(0.32, 1 - j / 26);
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
  // the Barren Hills: a range of engraved mountains west of the walls — great crags
  // and broad massifs along the spine, a horn or two, rounded foothills stepping down
  // toward the wall — each drawn with its own silhouette, hatched on the shadowed east
  {
    const mts = [];
    // three ranks in depth: a pale far range against the sheet's edge, the great peaks of
    // the spine, and a lower front rank, then foothills rolling down to the wall
    // a scatter of peaks over the whole band (no ranks, no rows): the greatest along the
    // spine of the range, smaller and lower toward its margins, each kept a little apart
    // from its neighbours so silhouettes overlap in depth rather than stack
    {
      const cand = [];
      for (let i = 0; i < 900; i++) {
        const x = 12 + tr() * 140;
        const y = 262 + tr() * 512;
        const spineD = Math.abs(x - (84 + Math.sin(y / 130) * 14)) / 70;
        const swell = fbm(x / 60, y / 90, { period: 64, octaves: 2, seed: 44 });
        const size = Math.max(0.15, (1 - spineD) * 0.75 + swell * 0.6 + (tr() - 0.5) * 0.3);
        cand.push({ x, y, size });
      }
      cand.sort((p, q) => q.size - p.size);
      const kept = [];
      for (const c of cand) {
        const w = 26 + c.size * 84;
        const h = w * (0.4 + tr() * 0.32) * (c.size > 0.8 ? 1.15 : 1);
        if (c.x - w / 2 < 4 || c.x + w / 2 > 164) continue;
        if (kept.some((q) => Math.abs(q.x - c.x) < (q.w + w) * 0.32 && Math.abs(q.y - c.y) < (q.h + h) * 0.3)) continue;
        const type = c.size > 0.85 ? (tr() < 0.5 ? 'crag' : 'horn') : c.size > 0.55 ? (tr() < 0.55 ? 'massif' : 'crag') : tr() < 0.6 ? 'foot' : 'massif';
        kept.push({ x: c.x, y: c.y, w, h, type, fade: 1, back: c.size < 0.45 && c.x < 70 });
        if (kept.length > 46) break;
      }
      mts.push(...kept);
    }
    // foothills rolling out of the range toward the wall and down to the shore, fading
    for (let y = 280; y < 784; y += 24 + tr() * 18) {
      mts.push({ x: 138 + tr() * 14, y: y + tr() * 8, w: 26 + tr() * 18, h: 7 + tr() * 8, type: 'foot', fade: 0.6 + tr() * 0.3, foot: true });
    }
    // the northern heights beyond the wall
    for (let x = 220; x < 880; x += 40 + tr() * 46) mts.push({ x, y: 38 + tr() * 8, w: 30 + tr() * 30, h: 12 + tr() * 14, type: tr() < 0.5 ? 'foot' : tr() < 0.5 ? 'massif' : 'crag', fade: 0.55 + tr() * 0.3 });
    const shown = mts.filter((q) => !inCartouche(q.x, q.y) && q.y < coastY(q.x) - 22 && (q.y < 100 || (q.x - q.w / 2 > 6 && q.x + q.w / 2 < 160)));
    // the range's shadow and earth: one warm granulated wash under all of it
    const mw = makeCanvas(W * k, H * k);
    const mg = mw.getContext('2d');
    mg.scale(k, k);
    mg.filter = `blur(${(7 * k).toFixed(0)}px)`;
    mg.fillStyle = 'rgba(150,110,62,0.4)';
    for (const q of shown) { if (q.x > 170) continue; mg.beginPath(); mg.ellipse(q.x + q.w * 0.1, q.y - q.h * 0.3, q.w * 0.55, q.h * 0.7, 0, 0, Math.PI * 2); mg.fill(); }
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
    // far to near: by base line, the pale far rank first; each peak's paper occludes the
    // ones behind, and the far ones are veiled with paper tone (atmospheric recession)
    shown.sort((p, q) => p.y - q.y).forEach((q) => {
      const shape = mountain(g, q.x, q.y, q.w, q.h, tr, q.type, q.back);
      if (q.fade < 1) {
        g.save();
        g.fillStyle = `rgba(236,222,186,${((1 - q.fade) * 0.6).toFixed(3)})`;
        g.fill(shape);
        g.restore();
      }
    });
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
    // a clearing in the wood for its name: an oval glade, its rim thick with trees
    const glade = Math.hypot((x - 1166) / 132, (y - 652) / 40);
    if (glade < 1) continue;
    const rim = glade < 1.3 ? 0.12 : 0;
    // the wood is dense and old in the north-east, thinning to scattered trees toward
    // the river and the shore
    const n = fbm(x / 70, y / 70, { period: 64, octaves: 3, seed: 12 });
    const thr = 0.47 - ((x - 1000) / 290) * 0.1 - ((790 - y) / 540) * 0.06 - rim;
    if (n < thr || tr() > (n - thr) * 8 + rim * 4) continue;
    if (trees.some(([tx, ty]) => Math.hypot(tx - x, (ty - y) * 1.5) < 8)) continue;
    trees.push([x, y, (4.2 + tr() ** 1.8 * 6.5) * (0.8 + (n - thr) * 1.2), 1]);
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
  g.translate(1166, 656);
  g.rotate(-0.04);
  g.textAlign = 'center';
  g.font = `italic 14px ${SERIF}`;
  g.letterSpacing = '1.5px';
  haloText(g, 'THE QUIVERING FOREST', 0, 0, { color: '#22301a', halo: 'rgba(240,228,196,0.95)', width: 7 });
  g.restore();
  // the range's name runs up the clear margin of paper west of the peaks
  g.save();
  g.translate(19, 520);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.font = `italic bold 16px ${SERIF}`;
  g.letterSpacing = '7px';
  haloText(g, 'THE BARREN HILLS', 0, 0, { color: '#4a2e14', halo: 'rgba(240,228,196,0.95)', width: 6 });
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
  // the island's name in open water off its eastern shore, following the swell
  g.translate(520, 904);
  g.rotate(-0.06);
  g.font = `italic bold 17px ${SERIF}`;
  haloText(g, 'THORN ISLAND', 0, 0, { color: '#1e2a12', halo: 'rgba(226,230,224,0.9)', width: 5 });
  g.restore();
  drawShip(g, 690, 952, 100);
  drawSerpent(g, 860, 975, 92);
  drawCompassRose(g, 1180, 822, 66);
  // scale of leagues, set clear above the sheet's lower border
  g.save();
  const sx0 = 1112;
  const sy0 = 925;
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#efe0bb' : INK.ink;
    g.fillRect(sx0 + i * 34, sy0, 34, 5);
    g.strokeRect(sx0 + i * 34, sy0, 34, 5);
  }
  g.textAlign = 'center';
  g.font = `bold 19px ${SERIF}`;
  ['0', '1', '2'].forEach((t, i) => haloText(g, t, sx0 + i * 68, sy0 - 8, { color: '#2b1a0d', halo: 'rgba(236,228,206,0.85)', width: 4 }));
  g.font = `italic bold 19px ${SERIF}`;
  haloText(g, 'miles', sx0 + 68, sy0 + 24, { color: '#2b1a0d', halo: 'rgba(236,228,206,0.85)', width: 4 });
  g.restore();
  // a ruled border round the whole sheet, so its lower edge reads clear of the sea
  g.save();
  g.strokeStyle = INK.ink;
  g.lineWidth = 2.2;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.lineWidth = 0.7;
  g.strokeRect(15, 15, W - 30, H - 30);
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
    cg.fillStyle = 'rgba(244,234,206,0.45)';
    cg.fillRect(0, 0, L, L);
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(mask, 0, 0);
  }
  // washes
  const wash = makeCanvas(L, L);
  let fullPlan = null;
  {
    const w = wash.getContext('2d');
    w.scale(k, k);
    const P = { CX, CY, cs, k, walled: (i, j, d) => m.getEdge(i, j, d) !== EDGE.OPEN };
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      if (!info.isRock(i, j)) continue;
      w.fillStyle = 'rgba(110,90,70,0.3)';
      w.fillRect(CX(i), CY(j), cs, cs);
    }
    const later = [];
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
      } else if (rg.type === CELL.WATER) { color = [60, 110, 170]; alpha = 0.6; } else if (rg.type === CELL.RUBBLE) { color = [150, 130, 104]; alpha = 0.42; } else if (rg.type === CELL.COURTYARD) { color = [170, 168, 150]; alpha = 0.3; } else { color = wild ? [120, 150, 80] : [206, 176, 124]; alpha = wild ? 0.42 : 0.36; }
      const roof = rg.type === CELL.INTERIOR;
      if (roof) {
        later.push([rg, rr, color]);
      } else {
        washRegion(w, rg.cells, { ...P, color, alpha, seed: rs, edge: 0.25, blooms: 0, mottle: 0.2, gran: 0.3 });
        if (!wild && (rg.type === CELL.STREET || rg.type === CELL.COURTYARD)) pavingMarks(w, rg.cells, CX, CY, cs, rr, rg.type === CELL.COURTYARD);
      }
    }
    // roofs last, so each casts its shadow over the street paving
    for (const [rg, rr, color] of later) engravedRoof(w, rg.cells, CX, CY, cs, rr, color);
    w.setTransform(1, 0, 0, 1, 0, 0);
    // the whole district engraved from the council's plan, kept before the mask cuts it
    // to the surveyed squares: drawn in sepia under the graphite where not yet walked
    fullPlan = makeCanvas(L, L);
    fullPlan.getContext('2d').drawImage(wash, 0, 0);
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
    g.fillStyle = 'rgba(250,242,220,0.3)';
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
  // (the island keep is engraved as buildings instead: see below)
  if (m.id !== 'sokol_keep') {
    if (fullPlan) {
      // the unwalked remainder: the same engraved roofs and paving, drained to a sepia
      // proof under a graphite tone, so a surveyed ward reads finished, its walked
      // squares coloured in
      g.save();
      g.filter = 'grayscale(1) sepia(0.6) contrast(1.35)';
      g.globalAlpha = 0.95;
      g.globalCompositeOperation = 'multiply';
      g.drawImage(fullPlan, 0, 0, s, s);
      g.restore();
    } else {
      g.globalAlpha = 0.7;
      g.drawImage(lay, 0, 0, s, s);
      g.globalAlpha = 1;
    }
  }
  g.drawImage(clean, 0, 0, s, s);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(wash, 0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(edge, 0, 0, s, s);
  g.drawImage(ink, 0, 0, s, s);
  g.restore();
  // Thorn Island: the keep and its outbuildings not yet walked stand engraved in the
  // oblique, as the vignettes do (a crenellated keep, a drum tower, gabled ranges)
  if (m.id === 'sokol_keep') {
    const blds = [];
    for (const rg of regs0(m).list) {
      if (rg.type !== CELL.INTERIOR || rg.cells.some(([i, j]) => seenCell(i, j))) continue;
      let i0 = 99; let j0 = 99; let i1 = -1; let j1 = -1;
      for (const [i, j] of rg.cells) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1); }
      blds.push({ i0, j0, i1, j1, n: rg.cells.length });
    }
    blds.sort((p, q) => q.n - p.n);
    const keep = blds[0];
    g.save();
    g.translate(b.cx - s / 2, b.cy - s / 2);
    blds.sort((p, q) => p.j1 - q.j1).forEach((q) => {
      const w = (q.i1 - q.i0) * cs * 0.92;
      const d = (q.j1 - q.j0) * cs * 0.55;
      const x = ((q.i0 + q.i1) / 2) * cs;
      const y = q.j1 * cs - 1;
      if (q === keep) {
        SOLID.block(g, x, y, w, 26, d, { crenel: true });
        SOLID.dark(g, ENG.rect(x - 3, y - 9, 6, 9));
        SOLID.tower(g, x + w * 0.5, y + 2, 6.5, 36, { roof: 'cone', roofFill: 'rgba(110,84,70,0.9)' });
        ENG.shape(g, ENG.rect(x + w * 0.5 - 1.6, y - 26, 3.2, 4.5), 'rgba(240,190,90,1)', 0.6);
      } else {
        SOLID.block(g, x, y, w, 9 + Math.min(6, q.n), d, { roof: 'gable', rh: 6 + Math.min(5, d * 0.3), roofFill: 'rgba(150,108,78,0.85)' });
      }
    });
    g.restore();
  }
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
 * A building's roof as an engraver cuts it in plan: a cast shadow hatched on the
 * ground to the south-east, a pale pigment wash, then a hipped roof whose four
 * slopes are cut with lines running down the fall of each slope — sparse on the
 * lit north and west, close and crossed on the shadowed south and east — the
 * ridge and hips inked, the eaves outlined.
 */
function engravedRoof(g, cells, CX, CY, cs, rr, color) {
  const path = new Path2D();
  for (const [i, j] of cells) path.rect(CX(i), CY(j), cs + 0.05, cs + 0.05);
  const sh = cs * 0.28;
  g.save();
  // cast shadow
  const shadow = new Path2D();
  for (const [i, j] of cells) shadow.rect(CX(i) + sh, CY(j) + sh, cs, cs);
  g.save();
  g.clip(shadow);
  g.strokeStyle = 'rgba(43,26,13,0.62)';
  g.lineWidth = 0.4;
  g.beginPath();
  let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
  for (const [i, j] of cells) { x0 = Math.min(x0, CX(i)); y0 = Math.min(y0, CY(j)); x1 = Math.max(x1, CX(i + 1)); y1 = Math.max(y1, CY(j + 1)); }
  for (let t = x0 - (y1 - y0); t < x1 + sh * 2; t += 1.1) { g.moveTo(t, y0); g.lineTo(t + (y1 - y0) + sh * 2, y1 + sh * 2); }
  g.stroke();
  g.restore();
  // the roof: opaque paper, then its pigment, pale
  g.fillStyle = 'rgba(240,228,198,1)';
  g.fill(path);
  const c = color.map((v) => v * 0.55 + 200 * 0.45);
  g.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0.75)`;
  g.fill(path);
  g.clip(path);
  const inset = cs * 0.08;
  const X0 = x0 + inset; const Y0 = y0 + inset; const X1 = x1 - inset; const Y1 = y1 - inset;
  const w = X1 - X0;
  const h = Y1 - Y0;
  const long = w >= h;
  const half = Math.min(w, h) / 2;
  const [rx0, ry0, rx1, ry1] = long ? [X0 + half, (Y0 + Y1) / 2, X1 - half, (Y0 + Y1) / 2] : [(X0 + X1) / 2, Y0 + half, (X0 + X1) / 2, Y1 - half];
  const slopes = [
    // [polygon, cut direction (dx,dy), gap, alpha, crossed]
    [[[X0, Y0], [X1, Y0], [rx1, ry1], [rx0, ry0]], [0, 1], 1.7, 0.36, false],
    [[[X0, Y1], [X1, Y1], [rx1, ry1], [rx0, ry0]], [0, 1], 0.95, 0.62, true],
    [[[X0, Y0], [rx0, ry0], [X0, Y1]], [1, 0], 1.9, 0.32, false],
    [[[X1, Y0], [rx1, ry1], [X1, Y1]], [1, 0], 0.95, 0.62, true],
  ];
  for (const [poly, [dx, dy], gap, a, crossed] of slopes) {
    const sp = new Path2D();
    poly.forEach(([px, py], i) => (i ? sp.lineTo(px, py) : sp.moveTo(px, py)));
    sp.closePath();
    g.save();
    g.clip(sp);
    g.strokeStyle = `rgba(52,26,12,${a})`;
    g.lineWidth = 0.38;
    g.beginPath();
    if (dx === 0) for (let t = X0 - 2; t < X1 + 2; t += gap) { g.moveTo(t, Y0 - 2); g.lineTo(t, Y1 + 2); }
    else for (let t = Y0 - 2; t < Y1 + 2; t += gap) { g.moveTo(X0 - 2, t); g.lineTo(X1 + 2, t); }
    g.stroke();
    if (crossed) {
      g.strokeStyle = `rgba(52,26,12,${(a * 0.45).toFixed(3)})`;
      g.beginPath();
      for (let t = X0 - h; t < X1 + h; t += 1.6) { g.moveTo(t, Y0); g.lineTo(t + h, Y1); }
      g.stroke();
    }
    g.restore();
  }
  g.strokeStyle = 'rgba(36,18,8,0.9)';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(rx0, ry0); g.lineTo(rx1, ry1);
  g.moveTo(X0, Y0); g.lineTo(rx0, ry0); g.lineTo(X0, Y1);
  g.moveTo(X1, Y0); g.lineTo(rx1, ry1); g.lineTo(X1, Y1);
  g.stroke();
  // a chimney stack now and then
  if (rr() < 0.55) {
    const cx = X0 + w * (0.2 + rr() * 0.6);
    const cy = Y0 + h * (0.15 + rr() * 0.2);
    g.fillStyle = 'rgba(240,228,198,1)';
    g.fillRect(cx, cy, cs * 0.18, cs * 0.18);
    g.strokeRect(cx, cy, cs * 0.18, cs * 0.18);
    g.fillStyle = 'rgba(36,18,8,0.85)';
    g.fillRect(cx + cs * 0.18, cy + cs * 0.04, cs * 0.1, cs * 0.16);
  }
  g.restore();
}

/** Streets and plazas on a plate: rows of tiny setts along each street, flags on a plaza. */
function pavingMarks(g, cells, CX, CY, cs, rr, plaza) {
  g.save();
  g.strokeStyle = 'rgba(52,34,20,0.55)';
  g.lineWidth = 0.4;
  g.beginPath();
  for (const [i, j] of cells) {
    const x = CX(i);
    const y = CY(j);
    if (plaza) {
      for (let a = 0; a <= 3; a++) { g.moveTo(x, y + (a * cs) / 3); g.lineTo(x + cs, y + (a * cs) / 3); }
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const xx = x + ((b + (a % 2) * 0.5) * cs) / 3; g.moveTo(xx, y + (a * cs) / 3); g.lineTo(xx, y + ((a + 1) * cs) / 3); }
    } else {
      const n = 4;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        const px = x + ((b + 0.5 + (a % 2) * 0.4) * cs) / n + (rr() - 0.5) * 0.4;
        const py = y + ((a + 0.5) * cs) / n;
        g.moveTo(px - cs * 0.07, py); g.lineTo(px + cs * 0.07, py);
      }
    }
  }
  g.stroke();
  g.restore();
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
  // a hard-edged reserve for the vignette, as an engraver leaves the plate clean
  // round his subject: an oval of paper ringed by a thin double rule
  {
    const ox = b.cx;
    const oy = b.cy - 6;
    const rx = 56;
    const ry = 47;
    g.save();
    g.fillStyle = 'rgba(70,40,16,0.14)';
    g.beginPath(); g.ellipse(ox + 2, oy + 2.5, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(245,236,212,0.97)';
    g.beginPath(); g.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.1;
    g.stroke();
    g.lineWidth = 0.45;
    g.beginPath(); g.ellipse(ox, oy, rx - 3, ry - 3, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(ox, oy, rx - 4, ry - 4, 0, 0, Math.PI * 2); g.clip();
    g.translate(b.cx, b.cy - 10);
    // a sky of fine horizontal cuts behind the subject, fading upward
    for (let yy = -40; yy < 20; yy += 1.8) {
      g.strokeStyle = `rgba(43,26,13,${(0.04 + Math.max(0, (yy + 40) / 60) * 0.12).toFixed(3)})`;
      g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(-60, yy); g.lineTo(60, yy); g.stroke();
    }
    g.restore();
  }
  g.save();
  g.translate(b.cx, b.cy - 8);
  g.scale(1.32, 1.32);
  (DISTRICT_VIGNETTES[b.id] ?? DISTRICT_VIGNETTES.houses)(g, 0, 0, 1);
  g.restore();
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
  /** a filled shape, toned with the engraver's tint (fine parallel cuts) and inked, heavier on its shadow side */
  shape(g, path, fill = ENG.fill, lw = 1.1) {
    g.fillStyle = fill;
    g.fill(path);
    g.save();
    g.clip(path);
    g.strokeStyle = fill === ENG.fill ? 'rgba(43,26,13,0.16)' : 'rgba(43,26,13,0.3)';
    g.lineWidth = 0.4;
    g.beginPath();
    for (let t = -70; t < 70; t += fill === ENG.fill ? 1.7 : 1.3) { g.moveTo(-70, t); g.lineTo(70, t); }
    g.stroke();
    g.restore();
    g.strokeStyle = INK.ink;
    g.lineWidth = lw * 0.9;
    g.lineJoin = 'round';
    g.stroke(path);
    // the shadow side: the same outline again, nudged south-east, so edges facing
    // away from the light carry a swelling line
    g.save();
    g.translate(0.45, 0.45);
    g.lineWidth = lw * 0.7;
    g.stroke(path);
    g.restore();
  },
  /** shade: close diagonal cuts crossed by a second set (a dark engraved tone) */
  hatch(g, path, { gap = 2, ang = 1, a = 0.7 } = {}) {
    g.save();
    g.clip(path);
    g.strokeStyle = `rgba(43,26,13,${a})`;
    g.lineWidth = 0.5;
    g.beginPath();
    for (let t = -80; t < 80; t += gap) { g.moveTo(t - 60 * ang, -60); g.lineTo(t + 60 * ang, 60); }
    g.stroke();
    g.strokeStyle = `rgba(43,26,13,${(a * 0.6).toFixed(3)})`;
    g.lineWidth = 0.4;
    g.beginPath();
    for (let t = -80; t < 80; t += gap * 1.4) { g.moveTo(t + 60 * ang, -60); g.lineTo(t - 60 * ang, 60); }
    g.stroke();
    g.restore();
  },
  rect(x, y, w, h) { const p = new Path2D(); p.rect(x, y, w, h); return p; },
  poly(pts) { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; },
  ground(g, w = 50) {
    // an engraved ground: horizontal cuts thinning out to either side, a darker
    // band of cast shadow under the subject
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const yy = 22 + i * 2.2;
      const half = w * (1 - i * 0.18);
      g.strokeStyle = `rgba(43,26,13,${(0.7 - i * 0.14).toFixed(3)})`;
      g.lineWidth = 0.6 - i * 0.08;
      g.beginPath();
      for (let x = -half; x < half; x += 6 + i * 2) { g.moveTo(x, yy + Math.sin(x * 1.7) * 0.4); g.lineTo(x + 4 - i * 0.6, yy + Math.sin(x * 1.7 + 2) * 0.4); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(43,26,13,0.55)';
    g.lineWidth = 0.5;
    g.beginPath();
    for (let x = -w * 0.5; x < w * 0.7; x += 1.4) { g.moveTo(x, 22.6); g.lineTo(x + 3, 25.4); }
    g.stroke();
  },
};

/**
 * Engraved solids in a light oblique projection (depth recedes up and to the
 * right): a lit front face in a fine tint, the side face in close crossed cuts,
 * a pale top, cast shadows hatched on the ground to the east.
 */
const OB = [0.62, -0.42];
const SOLID = {
  /** a box standing on the baseline y, centred on x */
  block(g, x, y, w, h, d, { roof = 'flat', rh = 0, fill = ENG.fill, roofFill = 'rgba(150,108,78,0.85)', crenel = false } = {}) {
    const dx = d * OB[0];
    const dy = d * OB[1];
    const L = x - w / 2;
    const R = x + w / 2;
    const T = y - h;
    // cast shadow on the ground
    ENG.hatch(g, ENG.poly([[R, y], [R + dx + h * 0.5, y + dy * 0.2 + 3], [R + dx + h * 0.5 + 6, y + 4], [R + 2, y + 4]]), { gap: 1.2, a: 0.55 });
    ENG.shape(g, ENG.poly([[L, y], [R, y], [R, T], [L, T]]), fill);
    const side = ENG.poly([[R, y], [R + dx, y + dy], [R + dx, T + dy], [R, T]]);
    ENG.shape(g, side, fill, 1);
    ENG.hatch(g, side, { gap: 1.25, a: 0.62 });
    if (roof === 'flat') {
      ENG.shape(g, ENG.poly([[L, T], [R, T], [R + dx, T + dy], [L + dx, T + dy]]), 'rgba(236,226,200,1)', 0.9);
      if (crenel) {
        const n = Math.max(2, Math.round(w / 7));
        for (let i = 0; i < n; i++) {
          const mx = L + (i + 0.5) * (w / n);
          const mw = (w / n) * 0.55;
          ENG.shape(g, ENG.poly([[mx - mw / 2, T], [mx + mw / 2, T], [mx + mw / 2, T - 4], [mx - mw / 2, T - 4]]), fill, 0.8);
        }
        const m = Math.max(1, Math.round(d / 7));
        for (let i = 0; i < m; i++) {
          const t = (i + 0.5) / m;
          const px = R + dx * t;
          const py = T + dy * t;
          const sp = ENG.poly([[px - 1.6, py], [px + 1.6, py - 1], [px + 1.6, py - 5], [px - 1.6, py - 4]]);
          ENG.shape(g, sp, fill, 0.7);
          ENG.hatch(g, sp, { gap: 1.1, a: 0.6 });
        }
      }
    } else {
      // a gable to the front, the roof running back
      ENG.shape(g, ENG.poly([[L - 2, T], [x, T - rh], [R + 2, T]]), fill);
      const slope = ENG.poly([[x, T - rh], [x + dx, T - rh + dy], [R + 2 + dx, T + dy], [R + 2, T]]);
      ENG.shape(g, slope, roofFill, 1);
      ENG.hatch(g, slope, { gap: 1.3, a: 0.55 });
      g.strokeStyle = 'rgba(43,26,13,0.45)';
      g.lineWidth = 0.4;
      for (let t = 0.15; t < 1; t += 0.15) { g.beginPath(); g.moveTo(x + dx * t, T - rh + dy * t); g.lineTo(R + 2 + dx * t, T + dy * t); g.stroke(); }
    }
  },
  /** a round tower: cylinder shaded across its width, a battlement or cone roof */
  tower(g, x, y, r, h, { roof = 'crenel', roofFill = 'rgba(96,100,112,0.85)' } = {}) {
    const ry = r * 0.36;
    ENG.hatch(g, ENG.poly([[x + r * 0.6, y], [x + r + h * 0.5, y + 2], [x + r + h * 0.5 + 4, y + 5], [x, y + ry]]), { gap: 1.2, a: 0.5 });
    const body = new Path2D();
    body.moveTo(x - r, y - h); body.lineTo(x - r, y); body.ellipse(x, y, r, ry, 0, Math.PI, 0, true); body.lineTo(x + r, y - h); body.closePath();
    ENG.shape(g, body);
    // shading builds toward the east limb
    g.save();
    g.clip(body);
    for (let t = -r; t < r; t += 1.1) {
      const k = (t + r) / (2 * r);
      if (k < 0.45) continue;
      g.strokeStyle = `rgba(43,26,13,${(0.15 + (k - 0.45) * 1.1).toFixed(3)})`;
      g.lineWidth = 0.45;
      g.beginPath(); g.moveTo(x + t, y - h - 2); g.lineTo(x + t, y + ry + 2); g.stroke();
    }
    g.restore();
    // courses
    g.strokeStyle = 'rgba(43,26,13,0.35)';
    g.lineWidth = 0.4;
    for (let yy = y - h + 5; yy < y; yy += 5) { g.beginPath(); g.ellipse(x, yy, r, ry, 0, 0.1, Math.PI - 0.1); g.stroke(); }
    if (roof === 'cone') {
      const cone = ENG.poly([[x - r - 2, y - h], [x, y - h - r * 2.2], [x + r + 2, y - h]]);
      ENG.shape(g, cone, roofFill);
      ENG.hatch(g, ENG.poly([[x, y - h - r * 2.2], [x + r + 2, y - h], [x + 1, y - h]]), { gap: 1.1, a: 0.6 });
    } else {
      const top = new Path2D(); top.ellipse(x, y - h, r, ry, 0, 0, Math.PI * 2);
      ENG.shape(g, top, 'rgba(236,226,200,1)', 0.9);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.1 + i * 0.2);
        const mx = x - Math.cos(a) * r * 0.92;
        const my = y - h + Math.sin(a) * ry * 0.92;
        const mp = ENG.poly([[mx - 1.8, my], [mx + 1.8, my], [mx + 1.8, my - 4], [mx - 1.8, my - 4]]);
        ENG.shape(g, mp, ENG.fill, 0.7);
        if (i > 2) ENG.hatch(g, mp, { gap: 1, a: 0.6 });
      }
    }
  },
  dark(g, path) { ENG.shape(g, path, 'rgba(34,22,14,0.92)', 0.8); },
  flag(g, x, y, h, color) {
    g.strokeStyle = INK.ink; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
    const f = new Path2D(); f.moveTo(x, y - h); f.quadraticCurveTo(x + 7, y - h - 2, x + 14, y - h + 3); f.quadraticCurveTo(x + 7, y - h + 5, x, y - h + 8); f.closePath();
    ENG.shape(g, f, color, 0.7);
  },
};

/** One engraved vignette per district never walked (each ~100 units wide, drawn at its centre). */
const DISTRICT_VIGNETTES = {
  // the market square: a fountain between two awninged stalls
  podol_plaza(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    for (const sx of [-28, 26]) {
      SOLID.block(g, sx, 22, 22, 13, 10);
      const aw = ENG.poly([[sx - 14, 9], [sx + 14, 9], [sx + 14 + 6, 3], [sx - 8, 3]]);
      ENG.shape(g, aw, 'rgba(176,64,44,0.8)', 0.9);
      g.save(); g.clip(aw); g.strokeStyle = 'rgba(246,236,210,0.9)'; g.lineWidth = 2;
      for (let i = -16; i <= 20; i += 5) { g.beginPath(); g.moveTo(sx + i, 10); g.lineTo(sx + i + 6, 2); g.stroke(); }
      g.restore();
      SOLID.dark(g, ENG.rect(sx - 4, 14, 8, 8));
    }
    const basin = new Path2D(); basin.moveTo(-12, 16); basin.lineTo(-12, 21); basin.ellipse(0, 21, 12, 4, 0, Math.PI, 0, true); basin.lineTo(12, 16); basin.closePath();
    ENG.shape(g, basin); ENG.hatch(g, ENG.rect(4, 14, 10, 12), { gap: 1.2, a: 0.55 });
    const water = new Path2D(); water.ellipse(0, 16, 12, 4, 0, 0, Math.PI * 2);
    ENG.shape(g, water, 'rgba(110,150,180,0.7)', 0.8);
    SOLID.tower(g, 0, 16, 1.8, 18, { roof: 'cone', roofFill: ENG.fill });
    g.strokeStyle = 'rgba(60,100,140,0.85)'; g.lineWidth = 0.8;
    for (const d of [-1, 1]) { g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(d * 8, -10, d * 10, 14); g.stroke(); }
    g.restore();
  },
  // the textile house: a long warehouse, its great door chained
  cadorna_textile(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    SOLID.block(g, -6, 22, 64, 22, 20, { roof: 'gable', rh: 13, roofFill: 'rgba(150,112,80,0.85)' });
    SOLID.dark(g, ENG.rect(-15, 6, 18, 16));
    g.strokeStyle = 'rgba(210,200,180,1)'; g.lineWidth = 1.5;
    g.beginPath(); for (let i = 0; i < 6; i++) { g.moveTo(-17 + i * 4, 12 + (i % 2) * 2.5); g.arc(-17 + i * 4 + 1.6, 12 + (i % 2) * 2.5, 1.6, Math.PI, Math.PI * 3); } g.stroke();
    for (const wx of [-32, -24, 10, 18]) SOLID.dark(g, ENG.rect(wx - 2.4, 6, 4.8, 6));
    g.restore();
  },
  // Kuto's well: a stone well under a windlass roof
  kutos_well(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g, 34);
    for (const sx of [-13, 13]) SOLID.block(g, sx, 6, 3, 26, 3);
    SOLID.tower(g, 0, 22, 16, 15, { roof: 'none' });
    const mouth = new Path2D(); mouth.ellipse(0, 7, 13.5, 4.4, 0, 0, Math.PI * 2);
    SOLID.dark(g, mouth);
    g.strokeStyle = INK.ink; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-13, -12); g.lineTo(13, -12); g.moveTo(0, -12); g.lineTo(0, 2); g.stroke();
    const rf = ENG.poly([[-21, -18], [21, -18], [0, -31]]);
    ENG.shape(g, rf, 'rgba(140,100,70,0.85)');
    ENG.hatch(g, ENG.poly([[0, -31], [21, -18], [0, -18]]), { gap: 1.1, a: 0.6 });
    ENG.shape(g, ENG.poly([[-3, 0], [3, 0], [2.4, 5], [-2.4, 5]]), 'rgba(120,90,60,0.9)', 0.8);
    g.restore();
  },
  // Mendor's library: an arcaded front under a pediment, smoke from a broken roof
  mendors_library(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    SOLID.block(g, -4, 22, 56, 30, 18, { roof: 'gable', rh: 14, roofFill: 'rgba(160,132,104,0.85)' });
    for (let i = -2; i <= 2; i++) {
      const ar = new Path2D(); ar.moveTo(-4 + i * 10.5 - 3.6, 22); ar.lineTo(-4 + i * 10.5 - 3.6, 2); ar.arc(-4 + i * 10.5, 2, 3.6, Math.PI, 0); ar.lineTo(-4 + i * 10.5 + 3.6, 22); ar.closePath();
      SOLID.dark(g, ar);
    }
    // the broken roof: a ragged hole with charred rafters
    const hole = ENG.poly([[10, -10], [18, -14], [24, -8], [18, -4]]);
    SOLID.dark(g, hole);
    g.strokeStyle = 'rgba(90,80,70,0.75)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(17, -12); g.bezierCurveTo(25, -20, 13, -26, 23, -34); g.stroke();
    g.beginPath(); g.moveTo(21, -11); g.bezierCurveTo(31, -17, 19, -25, 29, -31); g.stroke();
    g.restore();
  },
  // Valhingen: headstones, a cross and a dead tree under a crescent
  valhingen_graveyard(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    g.strokeStyle = INK.ink; g.lineWidth = 1.7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(30, 22); g.lineTo(28, -6); g.moveTo(28, -2); g.lineTo(38, -14); g.moveTo(28, -4); g.lineTo(18, -18); g.moveTo(33, -8); g.lineTo(36, -22); g.moveTo(18, -18); g.lineTo(14, -20); g.stroke();
    for (const [sx, sz] of [[-28, 1], [-10, 1.2], [8, 0.9]]) {
      const w = 11 * sz;
      const h = 16 * sz;
      const d = 4;
      const dx = d * OB[0];
      const dy = d * OB[1];
      ENG.hatch(g, ENG.poly([[sx + w / 2, 22], [sx + w / 2 + 10, 23], [sx + w / 2 + 12, 25], [sx + w / 2, 25]]), { gap: 1.1, a: 0.55 });
      const side = ENG.poly([[sx + w / 2, 22], [sx + w / 2 + dx, 22 + dy], [sx + w / 2 + dx, 22 - h + w / 2 + dy], [sx + w / 2, 22 - h + w / 2]]);
      ENG.shape(g, side); ENG.hatch(g, side, { gap: 1.1, a: 0.65 });
      const st = new Path2D(); st.moveTo(sx - w / 2, 22); st.lineTo(sx - w / 2, 22 - h + w / 2); st.arc(sx, 22 - h + w / 2, w / 2, Math.PI, 0); st.lineTo(sx + w / 2, 22); st.closePath();
      ENG.shape(g, st);
      g.strokeStyle = 'rgba(43,26,13,0.6)'; g.lineWidth = 0.45;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(sx - w * 0.28, 22 - h * 0.55 + k * 2.4); g.lineTo(sx + w * 0.28, 22 - h * 0.55 + k * 2.4); g.stroke(); }
    }
    SOLID.block(g, -1, 22, 3.2, 20, 2.5);
    SOLID.block(g, -1, 8, 12, 3.2, 2.5);
    const moon = new Path2D(); moon.arc(-26, -26, 7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(244,234,208,1)'; g.fill(moon); g.strokeStyle = INK.ink; g.lineWidth = 0.9; g.stroke(moon);
    g.fillStyle = 'rgba(214,200,172,1)'; g.beginPath(); g.arc(-23, -28, 6, 0, Math.PI * 2); g.fill();
    g.restore();
  },
  // Stojanow gate: twin drum towers, the arch and its portcullis, a war-band's banner
  stojanow_gate(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    SOLID.tower(g, -24, 22, 10, 40);
    SOLID.block(g, 0, 22, 32, 30, 14, { crenel: true });
    const arch = new Path2D(); arch.moveTo(-8, 22); arch.lineTo(-8, 6); arch.arc(0, 6, 8, Math.PI, 0); arch.lineTo(8, 22); arch.closePath();
    SOLID.dark(g, arch);
    g.strokeStyle = 'rgba(200,190,170,0.9)'; g.lineWidth = 0.7;
    g.beginPath(); for (let i = -6; i <= 6; i += 3) { g.moveTo(i, 0); g.lineTo(i, 16); } for (let j = 2; j < 16; j += 4) { g.moveTo(-7, j); g.lineTo(7, j); } g.stroke();
    SOLID.tower(g, 24, 22, 10, 40);
    SOLID.flag(g, 24, -22, 18, 'rgba(40,40,40,0.9)');
    g.restore();
  },
  // Valjevo: the castle keep on its rise, towers and a flag
  valjevo_castle(g, x, y) {
    g.save(); g.translate(x, y);
    const mound = ENG.poly([[-50, 26], [-34, 16], [34, 16], [50, 26]]);
    ENG.shape(g, mound, 'rgba(206,190,154,0.9)', 0.8);
    ENG.hatch(g, ENG.poly([[20, 16], [34, 16], [50, 26], [30, 26]]), { gap: 1.3, a: 0.5 });
    SOLID.block(g, 2, 18, 22, 46, 14, { crenel: true });
    SOLID.flag(g, 2, -32, 16, 'rgba(150,40,30,0.9)');
    SOLID.dark(g, ENG.rect(-1, -16, 4, 8));
    SOLID.block(g, 0, 22, 58, 16, 16, { crenel: true });
    SOLID.dark(g, (() => { const p = new Path2D(); p.moveTo(-5, 22); p.lineTo(-5, 14); p.arc(0, 14, 5, Math.PI, 0); p.lineTo(5, 22); p.closePath(); return p; })());
    SOLID.tower(g, -31, 24, 7, 26, { roof: 'cone' });
    SOLID.tower(g, 31, 24, 7, 26, { roof: 'cone' });
    g.restore();
  },
  // the wild shore beyond the gate: a road winding off between trees
  wilderness(g, x, y) {
    g.save(); g.translate(x, y);
    const road = new Path2D(); road.moveTo(-6, 26); road.bezierCurveTo(-20, 8, 20, 0, 4, -20); road.lineTo(8, -20); road.bezierCurveTo(26, 0, -12, 8, 6, 26); road.closePath();
    ENG.shape(g, road, 'rgba(226,206,164,1)', 0.9);
    const r = prng(808);
    for (const [tx, ty, ts] of [[-20, -14, 9.5], [21, -22, 8.4], [34, -4, 10], [-33, 6, 11], [27, 18, 10.4], [-40, 24, 9], [42, 28, 8.4]].sort((p, q) => p[1] - q[1])) tree(g, tx, ty, ts, r);
    g.restore();
  },
  // Sokol keep: a lone tower on the rocks with a light in its window
  sokol_keep(g, x, y) {
    g.save(); g.translate(x, y);
    const rocks = ENG.poly([[-42, 26], [-28, 10], [-14, 14], [4, 6], [24, 12], [42, 26]]);
    ENG.shape(g, rocks, 'rgba(176,156,124,0.9)', 0.9);
    ENG.hatch(g, ENG.poly([[4, 6], [24, 12], [42, 26], [10, 26]]), { gap: 1.2, a: 0.55 });
    SOLID.tower(g, -2, 12, 9, 40);
    ENG.shape(g, ENG.rect(-4, -12, 4, 6), 'rgba(240,190,90,1)', 0.7);
    g.restore();
  },
  // the slums: a huddle of roofs and a broken wall
  houses(g, x, y) {
    g.save(); g.translate(x, y);
    ENG.ground(g);
    for (const [hx, hw, hh, hd] of [[-28, 16, 15, 10], [-8, 20, 22, 12], [14, 15, 13, 10], [32, 11, 18, 8]]) {
      SOLID.block(g, hx, 22, hw, hh, hd, { roof: 'gable', rh: 9, roofFill: 'rgba(160,110,80,0.85)' });
      SOLID.dark(g, ENG.rect(hx - 2, 15, 4, 7));
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
  if (!known && SOLID_DUNGEONS[b.id]) {
    // unexplored below ground: the same engraved-solid vignette in a double-ruled oval
    // reserve as the districts above (no pigment band)
    const rx = r * 0.98;
    const ry = r * 0.84;
    g.save();
    g.fillStyle = 'rgba(70,40,16,0.14)';
    g.beginPath(); g.ellipse(cx + 2, cy + 2.5, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(245,236,212,0.97)';
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.1;
    g.stroke();
    g.lineWidth = 0.45;
    g.beginPath(); g.ellipse(cx, cy, rx - 3, ry - 3, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(cx, cy, rx - 4, ry - 4, 0, 0, Math.PI * 2); g.clip();
    for (let yy = -ry; yy < ry * 0.3; yy += 1.8) {
      g.strokeStyle = `rgba(43,26,13,${(0.04 + Math.max(0, (yy + ry) / (ry * 1.3)) * 0.12).toFixed(3)})`;
      g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(cx - rx, cy + yy); g.lineTo(cx + rx, cy + yy); g.stroke();
    }
    g.translate(cx, cy - 4);
    g.scale(r / 56, r / 56);
    SOLID_DUNGEONS[b.id](g);
    g.restore();
    return;
  }
  g.save();
  if (b.id === 'pool_pyramid') {
    // the Pool's radiance, engraved: alternating straight and flame rays cut in ink
    // round the roundel, filled with a thin muted-gold wash (no glow)
    g.save();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const L = R * (i % 2 ? 1.24 : 1.4);
      const hw = i % 2 ? 0.03 : 0.05;
      g.beginPath();
      g.moveTo(cx + Math.cos(a - hw) * R, cy + Math.sin(a - hw) * R);
      if (i % 2) g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      else g.quadraticCurveTo(cx + Math.cos(a + 0.05) * L * 0.85, cy + Math.sin(a + 0.05) * L * 0.85, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      g.lineTo(cx + Math.cos(a + hw) * R, cy + Math.sin(a + hw) * R);
      g.closePath();
      g.fillStyle = 'rgba(196,160,92,0.32)';
      g.fill();
      // a hatch down one flank of each ray, as the engraver shades it
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(43,26,13,0.45)';
      g.lineWidth = 0.4;
      for (let t = 0; t < 1; t += 0.07) {
        const rr = R + (L - R) * t;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        g.lineTo(cx + Math.cos(a + hw) * rr, cy + Math.sin(a + hw) * rr);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(43,26,13,0.8)';
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

/** Engraved-solid vignettes (the districts' style) for the dungeons not yet entered, centred, ~100 units wide. */
const SOLID_DUNGEONS = {
  // the Temple of Bane: a squat black-roofed mausoleum, its door open on a stair going
  // down into a green glow, the black hand over the lintel, a dead yew beside it
  temple_bane(g) {
    ENG.ground(g);
    g.strokeStyle = INK.ink; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-36, 22); g.lineTo(-37, -4); g.moveTo(-37, 0); g.lineTo(-46, -12); g.moveTo(-37, -2); g.lineTo(-28, -16); g.moveTo(-40, -6); g.lineTo(-42, -20); g.stroke();
    SOLID.block(g, 4, 22, 46, 26, 16, { roof: 'gable', rh: 13, roofFill: 'rgba(52,50,58,0.92)' });
    for (const px of [-14, 22]) SOLID.block(g, px, 22, 5, 24, 3);
    const door = new Path2D(); door.moveTo(-6, 22); door.lineTo(-6, 7); door.arc(1, 7, 7, Math.PI, 0); door.lineTo(8, 22); door.closePath();
    SOLID.dark(g, door);
    g.fillStyle = 'rgba(110,170,90,0.55)';
    g.beginPath(); g.ellipse(1, 19, 5, 2.6, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(200,190,170,0.85)'; g.lineWidth = 0.7;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-5 + k, 20 - k * 3.4); g.lineTo(7 - k, 20 - k * 3.4); g.stroke(); }
    g.fillStyle = INK.ink;
    g.beginPath(); g.ellipse(1, -6.5, 3, 2.4, 0, 0, Math.PI * 2); g.fill();
    for (let i = -1.5; i <= 1.5; i++) g.fillRect(1 + i * 1.6 - 0.55, -11.5, 1.1, 4.4);
  },
  // Kuto's warrens: a rocky outcrop split by a dark tunnel mouth shored with timbers,
  // a lantern hung on the prop and a kobold's spear leant against the rock
  kutos_warrens(g) {
    ENG.ground(g);
    const rocks = ENG.poly([[-48, 24], [-40, 2], [-26, -12], [-8, -18], [10, -16], [28, -8], [42, 6], [50, 24]]);
    ENG.shape(g, rocks, 'rgba(196,176,140,0.95)', 1);
    ENG.hatch(g, ENG.poly([[10, -16], [28, -8], [42, 6], [50, 24], [16, 24]]), { gap: 1.2, a: 0.6 });
    g.strokeStyle = 'rgba(43,26,13,0.55)'; g.lineWidth = 0.6;
    for (const [ax, ay, bx, by] of [[-34, 2, -26, 14], [-18, -10, -22, 2], [30, -2, 24, 10], [-40, 16, -30, 20]]) { g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
    const mouth = new Path2D(); mouth.moveTo(-13, 24); mouth.lineTo(-13, 4); mouth.quadraticCurveTo(0, -8, 13, 4); mouth.lineTo(13, 24); mouth.closePath();
    SOLID.dark(g, mouth);
    SOLID.block(g, -15, 24, 3.2, 22, 2.6);
    SOLID.block(g, 15, 24, 3.2, 22, 2.6);
    SOLID.block(g, 0, 2, 36, 3.4, 2.6);
    g.strokeStyle = INK.ink; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(15, 4); g.lineTo(15, 8); g.stroke();
    ENG.shape(g, ENG.rect(12.6, 8, 4.8, 6), 'rgba(240,190,90,1)', 0.7);
    g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(26, 24); g.lineTo(34, -6); g.stroke();
    ENG.shape(g, ENG.poly([[34, -6], [33, -12], [36.5, -5.5]]), 'rgba(200,200,205,1)', 0.6);
  },
};

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
 * A mountain in the engraver's manner. type: 'crag' (several jagged summits),
 * 'massif' (a broad shouldered mass), 'horn' (one sharp spire), 'foot' (a low
 * rounded foothill). The silhouette is built by midpoint displacement between
 * its summits; spurs fall from each summit, and everything east of a spur (the
 * side away from the light) is laid in with close hachures following the fall
 * of the slope, crossed again near the foot.
 */
function mountain(g, x, y, w, h, r, type = 'crag', back = false) {
  const rough = { crag: 0.11, massif: 0.06, horn: 0.07, foot: 0.02 }[type];
  const summits = [];
  if (type === 'crag') {
    const n = r() < 0.7 ? 2 : 3;
    for (let i = 0; i < n; i++) summits.push({ u: 0.3 + (i / Math.max(1, n - 1)) * 0.4 + (r() - 0.5) * 0.06, v: i === Math.floor(n / 2) ? 1 : 0.7 + r() * 0.2 });
  } else if (type === 'massif') {
    summits.push({ u: 0.3 + r() * 0.1, v: 0.86 + r() * 0.1 }, { u: 0.52 + r() * 0.08, v: 1 }, { u: 0.72 + r() * 0.06, v: 0.7 + r() * 0.15 });
  } else if (type === 'horn') {
    summits.push({ u: 0.44 + r() * 0.1, v: 1 });
    if (r() < 0.6) summits.push({ u: 0.7, v: 0.45 + r() * 0.15 });
  } else {
    summits.push({ u: 0.45 + r() * 0.1, v: 1 });
  }
  // control points: feet, summits and cols between them
  let ctrl = [[0, 0]];
  summits.forEach((sm, i) => {
    if (i) {
      const pv = summits[i - 1];
      ctrl.push([(pv.u + sm.u) / 2, Math.min(pv.v, sm.v) * (type === 'massif' ? 0.86 + r() * 0.08 : 0.72 + r() * 0.12)]);
    }
    ctrl.push([sm.u, sm.v]);
  });
  ctrl.push([1, 0]);
  if (type === 'horn') ctrl = ctrl.map(([u, v], i) => (i === 0 || i === ctrl.length - 1 ? [u, v] : [u, v]));
  // shape the flanks: concave for horns, convex shoulders for massifs and foothills
  const flank = (t) => (type === 'horn' ? t ** 1.5 : type === 'foot' ? Math.sin(t * Math.PI / 2) : Math.sin(t * Math.PI / 2) ** 1.3);
  let pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [u0, v0] = ctrl[i];
    const [u1, v1] = ctrl[i + 1];
    const n = 6;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const up = v1 > v0;
      const f = up ? flank(t) : 1 - flank(1 - t);
      pts.push([u0 + (u1 - u0) * t, v0 + (v1 - v0) * f]);
    }
  }
  pts.push([1, 0]);
  // midpoint displacement for the jagged skyline
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ua, va] = pts[i];
      const [ub, vb] = pts[i + 1];
      out.push(pts[i]);
      const L = Math.hypot(ub - ua, vb - va);
      out.push([(ua + ub) / 2, Math.max(0, (va + vb) / 2 + (r() - 0.5) * L * rough * 3 * (pass ? 0.5 : 1))]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const P = pts.map(([u, v]) => [x - w / 2 + u * w, y - v * h]);
  const shape = new Path2D();
  shape.moveTo(P[0][0], y);
  for (const [px, py] of P) shape.lineTo(px, py);
  shape.lineTo(P[P.length - 1][0], y);
  shape.closePath();
  g.save();
  const tv = back ? 0.97 : 0.92 + r() * 0.06;
  g.fillStyle = `rgba(${226 * tv | 0},${202 * tv | 0},${156 * tv | 0},0.97)`;
  g.fill(shape);
  g.save();
  g.clip(shape);
  g.lineCap = 'round';
  // the shadow side of each summit: east of a spur that falls from it to the foot
  for (const sm of summits) {
    const sx = x - w / 2 + sm.u * w;
    const sy = y - sm.v * h;
    const fx = sx + w * (0.04 + r() * 0.1);
    const side = new Path2D();
    side.moveTo(sx, sy - 2);
    side.quadraticCurveTo(sx + w * 0.02, sy + (y - sy) * 0.5, fx, y + 2);
    side.lineTo(x + w, y + 2);
    side.lineTo(x + w, sy - 2);
    side.closePath();
    g.save();
    g.clip(side);
    g.fillStyle = back ? 'rgba(120,88,52,0.18)' : 'rgba(110,76,40,0.28)';
    g.fillRect(x - w, y - h * 1.2, w * 2, h * 1.3);
    // hachures down the fall line, close and dark near the crest
    g.strokeStyle = back ? 'rgba(43,26,13,0.4)' : 'rgba(43,26,13,0.72)';
    const gap = back ? 2.4 : 1.55;
    for (let t = sx - 2; t < x + w / 2 + 4; t += gap * (0.85 + r() * 0.3)) {
      // where the skyline is at this x
      let top = y;
      for (let i = 0; i < P.length - 1; i++) if (P[i][0] <= t && P[i + 1][0] >= t) { const q = (t - P[i][0]) / Math.max(0.01, P[i + 1][0] - P[i][0]); top = P[i][1] + (P[i + 1][1] - P[i][1]) * q; break; }
      const L = (y - top) * (0.55 + r() * 0.4);
      g.lineWidth = back ? 0.4 : 0.45 + r() * 0.3;
      g.beginPath();
      g.moveTo(t, top + 0.6);
      g.lineTo(t + L * 0.16, top + L);
      g.stroke();
    }
    // crossed near the foot where the shade deepens
    if (!back && type !== 'foot') {
      g.strokeStyle = 'rgba(43,26,13,0.4)';
      g.lineWidth = 0.4;
      for (let t = sx - h; t < x + w; t += 2.2) { g.beginPath(); g.moveTo(t, y - h * 0.28); g.lineTo(t + h * 0.3, y + 1); g.stroke(); }
    }
    g.restore();
  }
  // the lit (west) faces: no hatching, only an engraver's stipple thinning toward the light
  {
    g.fillStyle = 'rgba(43,26,13,0.6)';
    for (const sm of summits) {
      const sx = x - w / 2 + sm.u * w;
      const sy = y - sm.v * h;
      const n = Math.round(w * h * 0.02);
      for (let i = 0; i < n; i++) {
        const t = r();
        const px = sx - t * w * 0.42;
        const py = sy + (y - sy) * (0.15 + r() * 0.85);
        if (r() > 1 - t * 0.85) continue;
        g.beginPath(); g.arc(px, py, 0.3 + r() * 0.3, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // a few strata and crags on the lit face
  if (type !== 'foot') {
    g.strokeStyle = back ? 'rgba(43,26,13,0.3)' : 'rgba(43,26,13,0.5)';
    g.lineWidth = 0.45;
    for (let i = 0; i < (type === 'crag' ? 5 : 3); i++) {
      const sm = summits[Math.floor(r() * summits.length)];
      const sx = x - w / 2 + sm.u * w - w * (0.05 + r() * 0.2);
      const sy = y - sm.v * h * (0.3 + r() * 0.5);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + w * 0.06, sy + h * 0.04); g.lineTo(sx + w * 0.1, sy + h * 0.02); g.stroke();
    }
  }
  g.restore();
  // outline: heavier on the shadowed (descending) runs
  g.strokeStyle = back ? 'rgba(43,26,13,0.7)' : INK.ink;
  g.lineJoin = 'round';
  for (let i = 0; i < P.length - 1; i++) {
    const down = P[i + 1][1] > P[i][1];
    g.lineWidth = (back ? 0.6 : 0.9) * (down ? 1.5 : 0.9);
    g.beginPath(); g.moveTo(P[i][0], P[i][1]); g.lineTo(P[i + 1][0], P[i + 1][1]); g.stroke();
  }
  // spurs from each summit
  g.lineWidth = back ? 0.45 : 0.7;
  for (const sm of summits) {
    const sx = x - w / 2 + sm.u * w;
    const sy = y - sm.v * h;
    g.beginPath();
    g.moveTo(sx, sy + 1);
    g.quadraticCurveTo(sx + w * 0.03, sy + (y - sy) * 0.45, sx + w * (0.05 + r() * 0.06), y - (y - sy) * 0.15);
    g.stroke();
  }
  // scree and scrub at the foot
  if (!back) {
    g.strokeStyle = 'rgba(43,26,13,0.5)';
    g.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const fx = x - w / 2 + r() * w;
      g.beginPath(); g.moveTo(fx, y + 1.5); g.lineTo(fx + 1, y - 1); g.moveTo(fx + 1.6, y + 1.5); g.lineTo(fx + 2.2, y - 0.6); g.stroke();
    }
  }
  g.restore();
  return shape;
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
