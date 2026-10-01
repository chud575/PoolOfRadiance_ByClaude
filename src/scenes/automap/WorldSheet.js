import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { TRAVEL } from '../../data/travel.js';
import { INK, makeCanvas, makeParchment, inkLine, quillStroke, lineShade, featherMask, mottleTile, prng, wobblePoints } from './ink.js';
import { regions, washRegion, hatchBand, deckleMask } from './paint.js';
import { hatchTile } from './fog.js';
import { drawMarker } from './glyphs.js';
import { analyseMap, collectEdges, mergeRuns } from './BlockSheet.js';
import { SERIF, drawCompassRose, drawCartouche, drawIlluminatedInitial, drawFlourish, haloText, goldGradient, fitFont } from './ornaments.js';
import { fbm } from '../../render/textures/noise.js';

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
    const r = 64;
    const s = round ? r * Math.SQRT2 * 0.92 : S;
    blocks.push({ id, cx, cy, round, r, s, x: cx - s / 2, y: cy - s / 2, known: known(id), rumour: RUMOURS[id] });
  }
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const cellToUnits = (b, x, y) => [b.x + (x / 16) * b.s, b.y + (y / 16) * b.s];

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
  g.save();
  g.clip(sea);
  // sea wash: deeper toward the bottom, mottled
  const sg = g.createLinearGradient(0, 760, 0, H);
  sg.addColorStop(0, 'rgba(110,160,170,0.26)');
  sg.addColorStop(1, 'rgba(56,100,140,0.46)');
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
      g.strokeStyle = `rgba(28,58,98,${(0.42 * fade).toFixed(3)})`;
      g.lineWidth = 0.55 + r() * 0.35;
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
  g.font = `italic 17px ${SERIF}`;
  g.textAlign = 'center';
  g.letterSpacing = '4px';
  haloText(g, 'Stojanow River', 0, 0, { color: '#2c3f60', width: 3 });
  g.restore();

  // ---------------- countryside: hills, forest, marsh; the ruins inside the walls ----------------
  const tr = prng(99);
  const avoid = (x, y, pad) => blocks.some((b) => x > b.cx - b.s / 2 - pad && x < b.cx + b.s / 2 + pad && y > b.cy - b.s / 2 - pad && y < b.cy + b.s / 2 + pad);
  const inCartouche = (x, y) => (x < 510 && y < 250) || (x > 890 && y < 245 && x < 1285);
  // hachured hills west of the walls, drawn back to front
  const hills = [];
  for (let i = 0; i < 70; i++) {
    const x = 18 + tr() * 112;
    const y = 250 + tr() * 520;
    if (y > coastY(x) - 26) continue;
    if (Math.abs(x - 70) < 34 && Math.abs(y - 520) < 104) continue; // keep the hills' name legible
    hills.push([x, y, 26 + tr() * 32, 9 + tr() ** 1.5 * 16]);
  }
  for (let i = 0; i < 14; i++) hills.push([200 + tr() * 680, 22 + tr() * 18, 22 + tr() * 16, 10 + tr() * 8]);
  hills.filter(([x, y]) => !inCartouche(x, y)).sort((a, b) => a[1] - b[1]).forEach(([x, y, w, hh]) => hill(g, x, y, w, hh, tr));
  // the Quivering Forest east of the river, clustered by noise
  const trees = [];
  for (let i = 0; i < 1500; i++) {
    const x = 1000 + tr() * 290;
    const y = 250 + tr() * 560;
    if (y > coastY(x) - 14) continue;
    if (Math.abs(x - riverX(y)) < rw(y) + 16) continue;
    if (Math.hypot((x - LAKE.x) / (LAKE.rx + 16), (y - LAKE.y) / (LAKE.ry + 14)) < 1) continue;
    if (avoid(x, y, 26) || inCartouche(x, y)) continue;
    if (Math.abs(x - 1135) < 122 && y > 618 && y < 676) continue; // a clearing for the forest's name
    const n = fbm(x / 70, y / 70, { period: 64, octaves: 3, seed: 12 });
    if (n < 0.46 || tr() > (n - 0.46) * 4) continue;
    if (trees.some(([tx, ty]) => Math.hypot(tx - x, (ty - y) * 1.5) < 9.5)) continue;
    trees.push([x, y, 4.6 + tr() ** 1.6 * 6]);
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
    fg.fillStyle = 'rgba(96,116,58,0.5)';
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
  // ruined houses of the old city between the blocks
  for (let i = 0; i < 520; i++) {
    const x = 165 + tr() * 730;
    const y = 70 + tr() * 700;
    if (avoid(x, y, 16) || inCartouche(x, y)) continue;
    if (Math.abs(x - riverX(y)) < rw(y) + 30) continue;
    ruinHouse(g, x, y, 6 + tr() * 9, 5 + tr() * 7, tr);
  }
  g.save();
  g.translate(1135, 640);
  g.rotate(-0.06);
  g.textAlign = 'center';
  g.font = `italic 19px ${SERIF}`;
  g.letterSpacing = '3px';
  haloText(g, 'The Quivering Forest', 0, 0, { color: '#22301a', halo: 'rgba(240,228,196,0.95)', width: 7 });
  g.restore();
  g.save();
  g.translate(70, 520);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.font = `italic 17px ${SERIF}`;
  g.letterSpacing = '6px';
  haloText(g, 'The Barren Hills', 0, 0, { color: '#4a2e14', halo: 'rgba(240,228,196,0.85)', width: 5 });
  g.restore();

  // ---------------- city wall (ruined old wall around the city) ----------------
  const wallPts = [[150, 250], [160, 60], [700, 48], [890, 50], [905, 250], [915, 470], [900, 780], [140, 780], [150, 250]];
  g.save();
  const wr = prng(4);
  for (let i = 0; i < wallPts.length - 1; i++) {
    const [x0, y0] = wallPts[i];
    const [x1, y1] = wallPts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(len / 60);
    for (let j = 0; j < n; j++) {
      const t0 = j / n;
      const t1 = (j + 1) / n;
      const broken = wr() < 0.18;
      const ax = x0 + (x1 - x0) * t0;
      const ay = y0 + (y1 - y0) * t0;
      const bx = x0 + (x1 - x0) * (broken ? t0 + (t1 - t0) * 0.35 : t1);
      const by = y0 + (y1 - y0) * (broken ? t0 + (t1 - t0) * 0.35 : t1);
      inkLine(g, ax, ay, bx, by, { width: 5, color: '#4a3220', amp: 0.8, seed: i * 31 + j, bleed: 3 });
      inkLine(g, ax, ay, bx, by, { width: 2, color: '#d9c49a', amp: 0.8, seed: i * 31 + j });
      if (broken) {
        g.fillStyle = 'rgba(60,40,20,0.6)';
        for (let q = 0; q < 6; q++) {
          const tt = t0 + (t1 - t0) * (0.4 + wr() * 0.55);
          g.beginPath(); g.arc(x0 + (x1 - x0) * tt + (wr() - 0.5) * 8, y0 + (y1 - y0) * tt + (wr() - 0.5) * 8, 1 + wr() * 1.5, 0, Math.PI * 2); g.fill();
        }
      }
      // tower
      g.fillStyle = '#d9c49a';
      g.strokeStyle = '#3a2716';
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(ax, ay, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = 'rgba(60,40,20,0.35)';
      g.beginPath(); g.arc(ax + 1.5, ay + 1.5, 3.5, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();

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
      if (dashed) g.setLineDash([5, 5]);
      g.strokeStyle = color;
      g.lineWidth = 9;
      path(); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = dashed ? '#e8d9b6' : '#e9d6a8';
      g.lineWidth = 6;
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
  for (const b of blocks) {
    const m = getMap(b.id);
    const ly = b.round ? b.cy + b.r + 16 : b.y + b.s + 16;
    drawRibbon(g, b.cx, ly, b.known ? m.name : m.name, { known: b.known, here: b.id === here });
  }

  // ---------------- sea labels, island, ship, serpent ----------------
  g.save();
  g.textAlign = 'center';
  g.font = `italic 34px ${SERIF}`;
  g.letterSpacing = '14px';
  haloText(g, 'THE MOONSEA', 770, 872, { color: '#1f3358', halo: 'rgba(220,226,222,0.6)', width: 5 });
  g.letterSpacing = '3px';
  g.font = `italic 20px ${SERIF}`;
  g.translate(364, 888);
  g.rotate(Math.PI / 2);
  haloText(g, 'Thorn Island', 0, 0, { color: '#2c3518', halo: 'rgba(236,226,200,0.8)', width: 5 });
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
  g.font = known ? `bold 14px ${SERIF}` : `bold italic 15px ${SERIF}`;
  g.letterSpacing = known ? '2px' : '0.5px';
  const label = text.toUpperCase();
  const w = Math.min(g.measureText(known ? label : text).width + 26, 186);
  const hh = 20;
  if (known) {
    g.fillStyle = 'rgba(60,35,10,0.2)';
    g.fillRect(cx - w / 2 + 3, cy - hh / 2 + 3, w, hh);
    // tails
    g.fillStyle = here ? '#8e2a1e' : '#6b4a26';
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
    g.fillStyle = here ? '#c0402e' : '#efe0bb';
    g.fillRect(cx - w / 2, cy - hh / 2, w, hh);
    g.strokeStyle = INK.ink;
    g.lineWidth = 1;
    g.strokeRect(cx - w / 2, cy - hh / 2, w, hh);
    g.fillStyle = here ? '#fff2d6' : INK.ink;
  } else {
    g.fillStyle = 'rgba(60,35,10,0.14)';
    g.fillRect(cx - w / 2 + 6, cy - hh / 2 + 4, w - 12, hh - 2);
    g.fillStyle = 'rgba(236,224,192,0.96)';
    g.fillRect(cx - w / 2 + 4, cy - hh / 2 + 1, w - 8, hh - 2);
    g.strokeStyle = 'rgba(60,40,22,0.6)';
    g.lineWidth = 0.8;
    g.setLineDash([3, 2]);
    g.strokeRect(cx - w / 2 + 4, cy - hh / 2 + 1, w - 8, hh - 2);
    g.setLineDash([]);
    g.fillStyle = '#3a2412';
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitFont(g, known ? label : text, w - 16, known ? 14 : 15, known ? 'bold' : 'bold italic');
  g.fillText(known ? label : text, cx, cy + 1);
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
  // unknown remainder: faint graphite hatching
  const fog = makeCanvas(L, L);
  {
    const f = fog.getContext('2d');
    f.scale(k, k);
    // the same cool vellum and pencil patches as the block sheets
    f.fillStyle = 'rgba(104,118,140,0.22)';
    f.fillRect(0, 0, s, s);
    const hp = f.createPattern(hatchTile(1), 'repeat');
    hp.setTransform(new DOMMatrix().scaleSelf(0.42));
    f.fillStyle = hp;
    f.fillRect(0, 0, s, s);
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'destination-out';
    f.drawImage(mask, 0, 0);
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
      if (roof) hatchBand(w, rg.cells, { ...P, seed: rs + 1, angle: 0.6 + rr() * 0.5, band: 0.32, alpha: 0.5, color: '#4a1e12', width: 0.35 });
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
  g.save();
  g.translate(x, y);
  // the plate: a cleaner patch of paper, laid down slightly askew in shadow
  g.fillStyle = 'rgba(60,35,12,0.16)';
  g.fillRect(3, 4, s, s);
  g.fillStyle = 'rgba(248,238,212,0.75)';
  g.fillRect(0, 0, s, s);
  g.drawImage(fog, 0, 0, s, s);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(wash, 0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(edge, 0, 0, s, s);
  g.drawImage(ink, 0, 0, s, s);
  // frame: double rule
  g.strokeStyle = here ? INK.vermilion : INK.ink;
  g.lineWidth = here ? 2.4 : 1.5;
  g.strokeRect(0, 0, s, s);
  g.lineWidth = 0.6;
  g.strokeStyle = INK.ink;
  g.strokeRect(-3.5, -3.5, s + 7, s + 7);
  if (here) {
    g.strokeStyle = goldGradient(g, 0, 0, s, s);
    g.lineWidth = 1.6;
    g.strokeRect(-6, -6, s + 12, s + 12);
  }
  g.restore();
}

/** An unexplored block: the council's faded old engraving of it, sealed. */
function drawUnknownBlock(g, b, m, { k }) {
  const { x, y, s } = b;
  const cs = s / m.w;
  const info = info0(m);
  const L = Math.ceil(s * k);
  const seed = [...m.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  const lay = makeCanvas(L, L);
  const lg = lay.getContext('2d');
  lg.scale(k, k);
  const CX = (i) => i * cs;
  const CY = (j) => j * cs;
  // a guessed street plan, pencilled from hearsay: loose house outlines where the
  // old city's buildings are said to stand, a few struck through, nothing ruled
  const gr = prng(seed + 9);
  lg.lineCap = 'round';
  lg.lineJoin = 'round';
  for (const rg of regs0(m).list) {
    if (rg.type !== CELL.INTERIOR || rg.cells.length < 2) continue;
    let x0 = 99; let y0 = 99; let x1 = -1; let y1 = -1;
    for (const [i, j] of rg.cells) { x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i + 1); y1 = Math.max(y1, j + 1); }
    const j = () => (gr() - 0.5) * cs * 0.6;
    const pts = [[CX(x0) + j(), CY(y0) + j()], [CX(x1) + j(), CY(y0) + j()], [CX(x1) + j(), CY(y1) + j()], [CX(x0) + j(), CY(y1) + j()]];
    lg.strokeStyle = 'rgba(70,46,24,0.75)';
    lg.lineWidth = 0.7;
    // each side drawn as its own stroke that overshoots a little, as a quick sketch does
    for (let q = 0; q < 4; q++) {
      if (gr() < 0.18) continue;
      const [ax, ay] = pts[q];
      const [bx, by] = pts[(q + 1) % 4];
      const ox = (bx - ax) * 0.08;
      const oy = (by - ay) * 0.08;
      lg.beginPath();
      lg.moveTo(ax - ox, ay - oy);
      lg.quadraticCurveTo((ax + bx) / 2 + (gr() - 0.5) * 2, (ay + by) / 2 + (gr() - 0.5) * 2, bx + ox, by + oy);
      lg.stroke();
    }
    if (gr() < 0.35) {
      lg.strokeStyle = 'rgba(70,46,24,0.35)';
      lg.lineWidth = 0.5;
      const w = pts[1][0] - pts[0][0];
      for (let t = 0.15; t < 1; t += 0.18) { lg.beginPath(); lg.moveTo(pts[0][0] + w * t, pts[0][1] + 1); lg.lineTo(pts[0][0] + w * (t - 0.15), pts[3][1] - 1); lg.stroke(); }
    }
  }
  // the streets as dotted pencil lanes
  lg.strokeStyle = 'rgba(70,46,24,0.4)';
  lg.lineWidth = 0.6;
  lg.setLineDash([1.5, 2.5]);
  for (let q = 0; q < 2; q++) {
    const t = 0.3 + gr() * 0.4;
    lg.beginPath();
    if ((seed + q) % 2) { lg.moveTo(0, s * t); lg.bezierCurveTo(s * 0.3, s * (t + 0.05), s * 0.7, s * (t - 0.05), s, s * t); } else { lg.moveTo(s * t, 0); lg.bezierCurveTo(s * (t - 0.05), s * 0.3, s * (t + 0.05), s * 0.7, s * t, s); }
    lg.stroke();
  }
  lg.setLineDash([]);
  // age: the engraving has faded unevenly and worn away toward its edges
  lg.setTransform(1, 0, 0, 1, 0, 0);
  lg.globalCompositeOperation = 'destination-out';
  const p = lg.createPattern(mottleTile(), 'repeat');
  p.setTransform(new DOMMatrix().translateSelf(seed % 200, (seed * 7) % 200).scaleSelf(0.8));
  lg.globalAlpha = 0.55;
  lg.fillStyle = p;
  lg.fillRect(0, 0, L, L);
  lg.globalAlpha = 1;
  const fade = lg.createRadialGradient(L / 2, L / 2, L * 0.2, L / 2, L / 2, L * 0.74);
  fade.addColorStop(0, 'rgba(0,0,0,0.1)');
  fade.addColorStop(1, 'rgba(0,0,0,0.9)');
  lg.fillStyle = fade;
  lg.fillRect(0, 0, L, L);
  g.save();
  g.translate(x, y);
  g.globalAlpha = 0.85;
  g.drawImage(lay, 0, 0, s, s);
  g.globalAlpha = 1;
  // hand-ruled frame with broken corners
  g.strokeStyle = 'rgba(60,40,22,0.55)';
  g.lineWidth = 1;
  for (const [ax, ay, bx, by] of [[6, 0, s - 6, 0], [s, 6, s, s - 6], [s - 6, s, 6, s], [0, s - 6, 0, 6]]) {
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  const note = HEARSAY[b.id] ?? 'terra incognita';
  g.font = `italic 16px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(s / 2, s * 0.76);
  g.rotate(((seed % 7) - 3) * 0.018);
  haloText(g, note, 0, 0, { color: 'rgba(80,44,20,0.95)', halo: 'rgba(240,228,196,0.9)', width: 6 });
  g.restore();
  const wax = WAX[seed % WAX.length];
  g.save();
  g.translate(s / 2 + ((seed % 5) - 2) * 4, s * 0.42 + ((seed % 3) - 1) * 4);
  g.rotate(((seed % 9) - 4) * 0.08);
  drawSeal(g, 0, 0, 19 + (seed % 4), m.name.replace(/^The\s+/i, '')[0], { seed, color: wax });
  g.restore();
  g.restore();
}

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
};
const WAX = [[150, 34, 26], [104, 26, 30], [52, 82, 52], [120, 70, 30], [128, 30, 60]];

/** A red wax seal pressed with a letter or emblem. */
function drawSeal(g, x, y, r, letter, { seed = 1, color = [150, 34, 26], emblem = null } = {}) {
  const rnd = prng(seed);
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(40,10,0,0.35)';
  g.beginPath(); g.ellipse(2, 3, r * 1.05, r, 0, 0, Math.PI * 2); g.fill();
  g.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const q = r * (1 + (rnd() - 0.5) * 0.14 + Math.sin(i * 2.3) * 0.04);
    if (i === 0) g.moveTo(Math.cos(a) * q, Math.sin(a) * q); else g.lineTo(Math.cos(a) * q, Math.sin(a) * q);
  }
  g.closePath();
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
  gr.addColorStop(0, `rgb(${Math.min(255, color[0] * 1.6) | 0},${Math.min(255, color[1] * 1.8) | 0},${Math.min(255, color[2] * 1.8) | 0})`);
  gr.addColorStop(0.55, `rgb(${color.join(',')})`);
  gr.addColorStop(1, `rgb(${(color[0] * 0.55) | 0},${(color[1] * 0.5) | 0},${(color[2] * 0.5) | 0})`);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = 'rgba(40,8,4,0.6)';
  g.lineWidth = 0.8;
  g.stroke();
  // pressed ring
  g.strokeStyle = `rgba(${(color[0] * 0.5) | 0},${(color[1] * 0.4) | 0},${(color[2] * 0.4) | 0},0.9)`;
  g.lineWidth = r * 0.08;
  g.beginPath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,220,200,0.35)';
  g.lineWidth = r * 0.04;
  g.beginPath(); g.arc(-r * 0.03, -r * 0.03, r * 0.72, Math.PI * 0.9, Math.PI * 1.7); g.stroke();
  const press = (fn) => {
    g.save(); g.translate(-r * 0.04, -r * 0.05); g.fillStyle = 'rgba(255,215,190,0.4)'; g.strokeStyle = 'rgba(255,215,190,0.4)'; fn(); g.restore();
    g.save(); g.fillStyle = `rgba(${(color[0] * 0.45) | 0},${(color[1] * 0.35) | 0},${(color[2] * 0.35) | 0},0.95)`; g.strokeStyle = g.fillStyle; fn(); g.restore();
  };
  if (emblem) press(() => emblem(g, r));
  else {
    g.font = `bold ${Math.round(r * 0.95)}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    press(() => g.fillText(letter, 0, r * 0.06));
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

/** A dungeon below ground as a round medallion: white ink on slate when known, a sealed emblem when not. */
function drawMedallion(g, b, m, { seen, secrets, known }) {
  const { cx, cy, r } = b;
  const info = analyseMap(m);
  g.save();
  g.fillStyle = 'rgba(40,25,10,0.3)';
  g.beginPath(); g.arc(cx + 3, cy + 4, r + 6, 0, Math.PI * 2); g.fill();
  // gilt ring with an engraved inner band
  g.fillStyle = goldGradient(g, cx - r, cy - r, cx + r, cy + r);
  g.beginPath(); g.arc(cx, cy, r + 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.2;
  g.stroke();
  g.lineWidth = 0.6;
  g.beginPath(); g.arc(cx, cy, r + 3, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3)); g.lineTo(cx + Math.cos(a) * (r + 5.5), cy + Math.sin(a) * (r + 5.5)); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  if (known) {
    const slate = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    slate.addColorStop(0, '#3a4054');
    slate.addColorStop(1, '#1a1d2a');
    g.fillStyle = slate;
    g.fill();
    g.stroke();
    g.clip();
    const { x, y, s } = b;
    const cs = s / m.w;
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      if (info.isRock(i, j) || !seen(i, j)) continue;
      g.fillStyle = m.getCell(i, j) === CELL.WATER ? 'rgba(90,150,200,0.6)' : 'rgba(220,210,180,0.22)';
      g.fillRect(x + i * cs, y + j * cs, cs + 0.3, cs + 0.3);
    }
    g.strokeStyle = 'rgba(240,230,205,0.9)';
    g.lineWidth = 1;
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
    // each sealed dungeon its own stone, engraving, motto and wax
    const md = MEDALS[b.id] ?? MEDALS.kutos_warrens;
    const stone = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    stone.addColorStop(0, md.stone[0]);
    stone.addColorStop(1, md.stone[1]);
    g.fillStyle = stone;
    g.fill();
    g.stroke();
    g.clip();
    g.strokeStyle = 'rgba(240,220,180,0.17)';
    g.lineWidth = 0.7;
    if (md.engrave === 'rays') {
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
      }
    } else if (md.engrave === 'rings') {
      for (let q = 0.52; q < 1; q += 0.07) { g.beginPath(); g.arc(cx, cy, r * q, 0, Math.PI * 2); g.stroke(); }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fillStyle = 'rgba(240,220,180,0.22)';
        g.beginPath(); g.arc(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86, 1.6, 0, Math.PI * 2); g.fill();
      }
    } else {
      // a field of engraved stars, like a night sky over the black temple
      const sr = prng(b.cx * 3 + 1);
      for (let i = 0; i < 26; i++) {
        const a = sr() * Math.PI * 2;
        const d = r * (0.5 + sr() * 0.45);
        const px = cx + Math.cos(a) * d;
        const py = cy + Math.sin(a) * d;
        const q = 1.2 + sr() * 1.6;
        g.beginPath(); g.moveTo(px - q, py); g.lineTo(px + q, py); g.moveTo(px, py - q); g.lineTo(px, py + q); g.stroke();
      }
    }
    g.restore();
    g.save();
    // the motto, cut around the lower rim
    arcText(g, md.motto, cx, cy, r * 0.8, Math.PI / 2, { font: `italic 11px ${SERIF}`, color: 'rgba(244,226,188,0.85)', spacing: md.motto.length > 13 ? 0.4 : 1.4 });
    drawSeal(g, cx, cy - 4, r * 0.46, '?', { seed: r * 13 + cx, color: md.wax, emblem: EMBLEMS[b.id] ?? null });
  }
  g.restore();
}

const MEDALS = {
  kutos_warrens: { motto: 'SVBTER TERRAM', stone: ['#62584c', '#2a241e'], wax: [128, 26, 22], engrave: 'rings' },
  temple_bane: { motto: 'HIC SVNT MONSTRA', stone: ['#3e4a48', '#141c1c'], wax: [44, 40, 46], engrave: 'stars' },
  pool_pyramid: { motto: 'HIC SVNT DRACONES', stone: ['#6a5238', '#2a1a10'], wax: [176, 128, 40], engrave: 'rays' },
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
  g.fillStyle = 'rgba(226,206,160,0.96)';
  g.fill(shape);
  g.save();
  g.clip(shape);
  // a light wash on the shadowed flank of each summit
  for (const pk of peaks) {
    const px = x - w / 2 + pk.u * w;
    g.fillStyle = 'rgba(122,88,46,0.2)';
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

const TREE_TONES = [[98, 112, 60], [72, 92, 58], [126, 124, 70], [88, 104, 72]];

/**
 * A tree in the engraver's manner: broadleaf crowns built from a few lobes
 * or a tiered conifer, in one of several muted greens, inked, with shadow
 * hatching on the lee (south-east) side and a cast shadow.
 */
function tree(g, x, y, s, r) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const tone = TREE_TONES[Math.floor(r() * TREE_TONES.length)];
  const v = 0.88 + r() * 0.22;
  const fill = `rgba(${(tone[0] * v) | 0},${(tone[1] * v) | 0},${(tone[2] * v) | 0},0.95)`;
  g.fillStyle = 'rgba(70,46,20,0.22)';
  g.beginPath(); g.ellipse(x + s * 0.7, y + s * 0.05, s * 1.0, s * 0.32, -0.12, 0, Math.PI * 2); g.fill();
  if (r() < 0.24) {
    // conifer: three ragged tiers on a short trunk
    const H = s * (2.3 + r() * 0.6);
    const W = s * (0.9 + r() * 0.2);
    const crown = new Path2D();
    crown.moveTo(x, y - H);
    for (let t = 0; t < 3; t++) {
      const ty = y - H + (H * 0.85) * ((t + 1) / 3);
      const tw = W * (0.55 + t * 0.22);
      crown.lineTo(x + tw, ty);
      crown.lineTo(x + tw * 0.45, ty - H * 0.06);
    }
    crown.lineTo(x - W * 0.99 * 0.45, y - H * 0.15 - H * 0.06);
    for (let t = 2; t >= 0; t--) {
      const ty = y - H + (H * 0.85) * ((t + 1) / 3);
      const tw = W * (0.55 + t * 0.22);
      crown.lineTo(x - tw, ty);
      if (t) crown.lineTo(x - tw * 0.45, ty - H * 0.28 + H * 0.06);
    }
    crown.closePath();
    g.strokeStyle = INK.ink; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - H * 0.18); g.stroke();
    g.fillStyle = fill;
    g.fill(crown);
    g.save();
    g.clip(crown);
    g.strokeStyle = 'rgba(24,34,16,0.7)';
    g.lineWidth = 0.5;
    for (let i = 0; i < 9; i++) { const hx = x + W * 0.05 + i * W * 0.11; g.beginPath(); g.moveTo(hx, y - H); g.lineTo(hx + W * 0.25, y); g.stroke(); }
    g.restore();
    g.strokeStyle = INK.ink; g.lineWidth = 0.85;
    g.stroke(crown);
    g.restore();
    return;
  }
  // broadleaf: 3-5 overlapping lobes
  const lobes = [];
  const n = 3 + Math.floor(r() * 3);
  const cy = y - s * 1.05;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8;
    const d = s * (0.3 + r() * 0.2);
    lobes.push([x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, s * (0.48 + r() * 0.22)]);
  }
  lobes.push([x, cy - s * 0.1, s * (0.55 + r() * 0.15)]);
  const crown = new Path2D();
  for (const [lx, ly, lr] of lobes) { crown.moveTo(lx + lr, ly); crown.arc(lx, ly, lr, 0, Math.PI * 2); }
  g.strokeStyle = INK.ink; g.lineWidth = 0.85;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 0.04, y - s * 0.55); g.stroke();
  // outline first (thick), then the fill covers the inner overlaps: one inked silhouette
  g.lineWidth = 1.7;
  g.stroke(crown);
  g.fillStyle = fill;
  g.fill(crown);
  g.save();
  g.clip(crown);
  // lee-side hatching and a few leaf scallops
  g.strokeStyle = 'rgba(22,32,14,0.7)';
  g.lineWidth = 0.5;
  for (let i = 0; i < 8; i++) {
    const hx = x - s * 0.05 + i * s * 0.17;
    g.beginPath(); g.moveTo(hx, cy + s * 1.1); g.lineTo(hx + s * 0.55, cy - s * 0.2); g.stroke();
  }
  g.strokeStyle = 'rgba(22,32,14,0.45)';
  for (let i = 0; i < 4; i++) {
    const lx = x + (r() - 0.6) * s * 0.9;
    const ly = cy + (r() - 0.5) * s * 0.8;
    g.beginPath(); g.arc(lx, ly, s * 0.18, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
  }
  g.fillStyle = 'rgba(240,236,200,0.18)';
  g.beginPath(); g.arc(x - s * 0.3, cy - s * 0.35, s * 0.3, 0, Math.PI * 2); g.fill();
  g.restore();
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
      case 'unknown': g.strokeStyle = 'rgba(80,65,50,0.6)'; g.strokeRect(cx - 13, cy - 10, 26, 20); drawSeal(g, cx, cy, 7.5, '', { seed: 3 }); break;
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
  const body = '#8fa486';
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
    g.fillStyle = '#7a3a2a';
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
  // jaw: open, with a red tongue
  g.fillStyle = '#a8323a';
  g.beginPath(); g.moveTo(40, -33); g.lineTo(52, -32); g.lineTo(55, -35); g.lineTo(53, -30); g.lineTo(46, -30); g.closePath(); g.fill();
  // crest / frill
  g.fillStyle = '#7a3a2a';
  g.beginPath(); g.moveTo(22, -34); g.lineTo(18, -46); g.lineTo(26, -40); g.lineTo(26, -50); g.lineTo(31, -41); g.lineTo(34, -48); g.lineTo(35, -39); g.closePath(); g.fill();
  g.lineWidth = 0.7; g.stroke();
  // eye
  g.fillStyle = INK.goldHi;
  g.beginPath(); g.arc(37, -36, 1.8, 0, Math.PI * 2); g.fill();
  g.fillStyle = INK.ink;
  g.beginPath(); g.arc(37.4, -36, 0.8, 0, Math.PI * 2); g.fill();
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
