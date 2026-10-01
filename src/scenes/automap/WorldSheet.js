import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { TRAVEL } from '../../data/travel.js';
import { INK, makeCanvas, makeParchment, inkLine, hatchRect, prng, wobblePoints } from './ink.js';
import { drawMarker } from './glyphs.js';
import { analyseMap } from './BlockSheet.js';
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
  const canvas = makeParchment((W + 2 * M) * k, (H + 2 * M) * k, { seed: 1340, margin: M * k, tone: [238, 222, 182], age: 1.2 });
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
  for (let x = -10; x <= W + 10; x += 8) sea.lineTo(x, coastY(x));
  sea.lineTo(W + 10, H + 10);
  sea.lineTo(-10, H + 10);
  sea.closePath();
  // island
  const isl = new Path2D();
  const icx = 250;
  const icy = 885;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const rr = 108 + (fbm(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5, { period: 64, octaves: 3, seed: 8 }) - 0.5) * 40;
    const px = icx + Math.cos(a) * rr * 1.15;
    const py = icy + Math.sin(a) * rr * 0.8;
    if (i === 0) isl.moveTo(px, py); else isl.lineTo(px, py);
  }
  isl.closePath();
  g.save();
  g.clip(sea);
  // sea wash: deeper toward the bottom
  const sg = g.createLinearGradient(0, 760, 0, H);
  sg.addColorStop(0, 'rgba(80,130,160,0.35)');
  sg.addColorStop(1, 'rgba(40,80,130,0.55)');
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = sg;
  g.fillRect(0, 700, W, 400);
  g.globalCompositeOperation = 'source-over';
  // engraved wave lines following the coast
  g.strokeStyle = 'rgba(30,60,100,0.35)';
  g.lineWidth = 0.8;
  for (let i = 1; i < 14; i++) {
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 10) {
      const y = coastY(x) + i * 13 + Math.sin(x / 23 + i) * 1.5;
      if (x === -10) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.globalAlpha = Math.max(0.1, 1 - i / 9);
    g.stroke();
  }
  g.globalAlpha = 1;
  // little wave marks
  const r = prng(55);
  g.strokeStyle = 'rgba(30,60,100,0.5)';
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const y = coastY(x) + 40 + r() * 200;
    if (y > H - 10) continue;
    g.beginPath();
    g.moveTo(x - 7, y);
    g.quadraticCurveTo(x - 3.5, y - 4, x, y);
    g.quadraticCurveTo(x + 3.5, y - 4, x + 7, y);
    g.stroke();
  }
  g.restore();
  // coast line (double ink with shore hatching)
  g.save();
  g.strokeStyle = INK.ink;
  g.lineWidth = 2;
  g.beginPath();
  for (let x = -10; x <= W + 10; x += 8) (x === -10 ? g.moveTo(x, coastY(x)) : g.lineTo(x, coastY(x)));
  g.stroke();
  g.lineWidth = 0.6;
  for (let x = -10; x <= W + 10; x += 6) {
    const y = coastY(x);
    g.beginPath(); g.moveTo(x, y - 1); g.lineTo(x - 2, y - 7); g.stroke();
  }
  // island fill
  g.fillStyle = 'rgba(226,208,164,1)';
  g.fill(isl);
  g.fillStyle = 'rgba(140,150,90,0.25)';
  g.fill(isl);
  g.lineWidth = 2;
  g.stroke(isl);
  g.restore();
  // river Stojanow: a band from the north down to the sea east of the gate
  const riverX = (y) => 965 + Math.sin(y / 130) * 26 + (fbm(y / 200, 1, { period: 64, octaves: 3, seed: 5 }) - 0.5) * 30;
  const rw = (y) => 18 + y * 0.018;
  const river = new Path2D();
  river.moveTo(riverX(-10) - rw(-10), -10);
  for (let y = -10; y <= 820; y += 10) river.lineTo(riverX(y) - rw(y), y);
  for (let y = 820; y >= -10; y -= 10) river.lineTo(riverX(y) + rw(y), y);
  river.closePath();
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(80,130,165,0.5)';
  g.fill(river);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.6;
  g.stroke(river);
  g.clip(river);
  g.strokeStyle = 'rgba(30,60,100,0.45)';
  g.lineWidth = 0.7;
  for (let y = 0; y < 820; y += 16) {
    g.beginPath();
    g.moveTo(riverX(y) - 8, y);
    g.quadraticCurveTo(riverX(y), y - 4, riverX(y) + 8, y);
    g.stroke();
  }
  g.restore();
  g.save();
  g.translate(riverX(560) + 34, 560);
  g.rotate(Math.PI / 2 - 0.1);
  g.font = `italic 17px ${SERIF}`;
  g.textAlign = 'center';
  g.letterSpacing = '4px';
  haloText(g, 'Stojanow River', 0, 0, { color: '#2c3f60', width: 3 });
  g.restore();

  // ---------------- countryside: hills and trees outside the walls ----------------
  const tree = (x, y, s) => {
    g.save();
    g.fillStyle = 'rgba(95,120,60,0.55)';
    g.strokeStyle = INK.ink;
    g.lineWidth = 0.9;
    g.beginPath(); g.arc(x, y - s, s, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.3); g.stroke();
    g.fillStyle = 'rgba(40,30,15,0.35)';
    g.beginPath(); g.arc(x + s * 0.3, y - s * 0.8, s * 0.55, -0.5, 1.6); g.fill();
    g.restore();
  };
  const hill = (x, y, s) => {
    g.save();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(x - s, y); g.quadraticCurveTo(x - s * 0.2, y - s * 1.2, x + s, y); g.stroke();
    g.lineWidth = 0.6;
    for (let i = 0; i < 5; i++) {
      const t = 0.5 + i * 0.1;
      const hx = x - s + t * 2 * s;
      g.beginPath(); g.moveTo(hx, y - s * 0.55 * (1 - Math.abs(t - 0.45) * 1.5)); g.lineTo(hx + s * 0.08, y - 1); g.stroke();
    }
    g.restore();
  };
  const tr = prng(99);
  const avoid = (x, y, pad) => blocks.some((b) => x > b.cx - b.s / 2 - pad && x < b.cx + b.s / 2 + pad && y > b.cy - b.s / 2 - pad && y < b.cy + b.s / 2 + pad);
  for (let i = 0; i < 260; i++) {
    const x = 20 + tr() * (W - 40);
    const y = 20 + tr() * 760;
    if (y > coastY(x) - 20) continue;
    if (Math.abs(x - riverX(y)) < rw(y) + 10) continue;
    if (avoid(x, y, 40)) continue;
    if (x < 510 && y < 250) continue; // cartouche
    if (x > 890 && y < 230 && x < 1270) continue; // key
    const inWall = x > 140 && x < 900 && y > 50 && y < 790;
    if (inWall) continue;
    if (x > 1000 || y < 60) tree(x, y, 6 + tr() * 4);
    else hill(x, y, 12 + tr() * 8);
  }

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
    else drawMiniBlock(g, b, m, { seen: seenFn(m), secrets: secretsFn(b.id), known: b.known, here: b.id === here });
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
  g.letterSpacing = '16px';
  haloText(g, 'THE MOONSEA', 800, 925, { color: '#23385e', halo: 'rgba(210,220,220,0.35)', width: 3 });
  g.letterSpacing = '2px';
  g.font = `italic 15px ${SERIF}`;
  haloText(g, 'Thorn Island', 420, 985, { color: '#2c3f20', width: 3 });
  g.restore();
  drawShip(g, 560, 880, 36);
  drawSerpent(g, 470, 958, 34);
  drawCompassRose(g, 1175, 865, 76);

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
  g.font = `${known ? 'bold ' : ''}14px ${SERIF}`;
  g.letterSpacing = '2px';
  const label = text.toUpperCase();
  const w = Math.min(g.measureText(label).width + 26, 176);
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
    g.fillStyle = 'rgba(236,222,186,0.85)';
    g.fillRect(cx - w / 2 + 6, cy - hh / 2 + 2, w - 12, hh - 4);
    g.fillStyle = 'rgba(80,65,50,0.7)';
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitFont(g, label, w - 16, 14, known ? 'bold' : 'italic');
  g.fillText(known ? label : text, cx, cy + 1);
  g.restore();
}

/** A block as a miniature survey square. */
function drawMiniBlock(g, b, m, { seen, secrets, known, here }) {
  const { x, y, s } = b;
  const cs = s / m.w;
  const info = analyseMap(m);
  g.save();
  // plate: shadow + paper
  g.fillStyle = 'rgba(50,30,10,0.25)';
  g.fillRect(x + 4, y + 5, s, s);
  g.fillStyle = known ? 'rgba(246,234,204,0.95)' : 'rgba(230,214,176,0.6)';
  g.fillRect(x, y, s, s);
  if (!known) {
    hatchRect(g, x, y, s, s, { seed: [...b.id].length * 17, size: 12, width: 0.6, color: '#6a5a44', alpha: 0.4 });
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(80,65,50,0.6)';
    g.lineWidth = 1.2;
    g.strokeRect(x, y, s, s);
    g.setLineDash([]);
    g.font = `italic 44px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(80,65,50,0.35)';
    g.fillText('?', b.cx, b.cy + 2);
    g.restore();
    return;
  }
  const wild = m.tileset === 'wilderness' || m.tileset === 'graveyard';
  const fill = {
    [CELL.STREET]: wild ? 'rgba(130,160,90,0.45)' : 'rgba(214,184,128,0.45)',
    [CELL.INTERIOR]: 'rgba(190,86,72,0.55)',
    [CELL.RUBBLE]: 'rgba(150,128,100,0.55)',
    [CELL.WATER]: 'rgba(70,120,170,0.7)',
    [CELL.COURTYARD]: 'rgba(150,160,150,0.5)',
  };
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const X = x + i * cs;
    const Y = y + j * cs;
    if (info.isRock(i, j)) {
      g.fillStyle = 'rgba(90,70,50,0.35)';
      g.fillRect(X, Y, cs, cs);
    } else if (seen(i, j)) {
      g.fillStyle = fill[m.getCell(i, j)] ?? fill[CELL.STREET];
      g.fillRect(X, Y, cs + 0.3, cs + 0.3);
    } else {
      g.fillStyle = 'rgba(120,95,60,0.16)';
      g.fillRect(X, Y, cs + 0.3, cs + 0.3);
    }
  }
  // walls
  g.strokeStyle = INK.ink;
  g.lineCap = 'square';
  g.lineWidth = 1.2;
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
  // frame
  g.lineWidth = here ? 2.6 : 1.8;
  g.strokeStyle = here ? INK.vermilion : INK.ink;
  g.strokeRect(x, y, s, s);
  if (here) {
    g.strokeStyle = goldGradient(g, x, y, x + s, y + s);
    g.lineWidth = 1.2;
    g.strokeRect(x - 4, y - 4, s + 8, s + 8);
  }
  g.restore();
}

/** A dungeon below ground as a round medallion (white ink on slate). */
function drawMedallion(g, b, m, { seen, secrets, known }) {
  const { cx, cy, r } = b;
  const info = analyseMap(m);
  g.save();
  g.fillStyle = 'rgba(40,25,10,0.3)';
  g.beginPath(); g.arc(cx + 3, cy + 4, r + 5, 0, Math.PI * 2); g.fill();
  // gilt ring
  g.fillStyle = goldGradient(g, cx - r, cy - r, cx + r, cy + r);
  g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.2;
  g.stroke();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  const slate = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  slate.addColorStop(0, known ? '#3a4054' : '#6f6556');
  slate.addColorStop(1, known ? '#1a1d2a' : '#4a4236');
  g.fillStyle = slate;
  g.fill();
  g.stroke();
  g.clip();
  if (known) {
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
    g.strokeStyle = 'rgba(230,220,200,0.18)';
    g.lineWidth = 0.7;
    for (let i = -r; i < r; i += 7) { g.beginPath(); g.moveTo(cx + i, cy - r); g.lineTo(cx + i + r, cy + r); g.stroke(); }
    g.font = `italic 36px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(240,230,205,0.35)';
    g.fillText('?', cx, cy + 2);
  }
  g.restore();
}

function drawKey(g, x, y, w, h) {
  g.save();
  g.fillStyle = 'rgba(246,234,204,0.85)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.6;
  g.strokeRect(x, y, w, h);
  g.lineWidth = 0.7;
  g.strokeRect(x + 5, y + 5, w - 10, h - 10);
  g.font = `bold 15px ${SERIF}`;
  g.letterSpacing = '5px';
  g.textAlign = 'center';
  g.fillStyle = INK.ink;
  g.fillText('KEY', x + w / 2, y + 26);
  g.letterSpacing = '0px';
  drawFlourish(g, x + w / 2, y + 38, 120, { color: '#5a3a1c', width: 1 });
  const rows = [
    ['block', 'Surveyed block'], ['unknown', 'Not yet explored'], ['road', 'Road or lane'], ['sea', 'Sea passage'],
    ['under', 'Stair below ground'], ['wall', 'The old city wall'], ['here', 'Your block'], ['party', 'The party'],
  ];
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  rows.forEach(([k, label], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + 24 + col * (w / 2 - 6);
    const cy = y + 62 + row * 32;
    g.save();
    switch (k) {
      case 'block': g.fillStyle = 'rgba(190,86,72,0.55)'; g.fillRect(cx - 10, cy - 8, 20, 16); g.strokeStyle = INK.ink; g.lineWidth = 1.4; g.strokeRect(cx - 10, cy - 8, 20, 16); break;
      case 'unknown': g.setLineDash([3, 3]); g.strokeStyle = 'rgba(80,65,50,0.7)'; g.strokeRect(cx - 10, cy - 8, 20, 16); break;
      case 'road': g.strokeStyle = '#4a3220'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.stroke(); g.strokeStyle = '#e9d6a8'; g.lineWidth = 4; g.stroke(); break;
      case 'sea': g.setLineDash([4, 4]); g.strokeStyle = 'rgba(40,40,60,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.stroke(); break;
      case 'under': drawMarker(g, 'stairs', cx, cy, 20, { color: INK.vermilion }); break;
      case 'wall': g.strokeStyle = '#4a3220'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.stroke(); g.fillStyle = '#d9c49a'; g.lineWidth = 1.2; g.strokeStyle = '#3a2716'; g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill(); g.stroke(); break;
      case 'here': g.fillStyle = '#c0402e'; g.fillRect(cx - 12, cy - 6, 24, 12); g.strokeStyle = INK.ink; g.lineWidth = 1; g.strokeRect(cx - 12, cy - 6, 24, 12); break;
      case 'party': {
        g.translate(cx, cy);
        g.fillStyle = '#c63a28';
        g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill();
        g.strokeStyle = INK.goldLo; g.lineWidth = 1.2; g.stroke();
        break;
      }
      default:
    }
    g.restore();
    g.font = `italic 14px ${SERIF}`;
    g.fillStyle = '#3b2412';
    g.fillText(label, cx + 20, cy);
  });
  g.restore();
}

function drawShip(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 40, s / 40);
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.3;
  g.fillStyle = '#8a5a2c';
  g.beginPath(); g.moveTo(-26, 0); g.quadraticCurveTo(0, 12, 26, 0); g.lineTo(20, -3); g.lineTo(-22, -3); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-2, -3); g.lineTo(-2, -36); g.stroke();
  g.fillStyle = '#f1e4c4';
  g.beginPath(); g.moveTo(-1, -34); g.quadraticCurveTo(16, -22, -1, -8); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-3, -32); g.quadraticCurveTo(-16, -22, -3, -10); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = INK.vermilion;
  g.beginPath(); g.moveTo(-2, -36); g.lineTo(8, -39); g.lineTo(-2, -41); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(30,60,100,0.5)';
  g.beginPath(); g.moveTo(-34, 6); g.quadraticCurveTo(-28, 3, -22, 6); g.moveTo(24, 6); g.quadraticCurveTo(30, 3, 36, 6); g.stroke();
  g.restore();
}

function drawSerpent(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 40, s / 40);
  g.lineCap = 'round';
  g.strokeStyle = INK.ink;
  g.fillStyle = '#4f7f5a';
  for (let i = 0; i < 3; i++) {
    const hx = -40 + i * 26;
    g.beginPath();
    g.moveTo(hx - 10, 4);
    g.bezierCurveTo(hx - 8, -18, hx + 8, -18, hx + 10, 4);
    g.lineTo(hx + 4, 4);
    g.bezierCurveTo(hx + 3, -8, hx - 3, -8, hx - 4, 4);
    g.closePath();
    g.fill();
    g.lineWidth = 1.2;
    g.stroke();
  }
  // head
  g.beginPath();
  g.moveTo(34, 4);
  g.bezierCurveTo(36, -20, 44, -30, 56, -26);
  g.lineTo(62, -22);
  g.lineTo(52, -18);
  g.bezierCurveTo(46, -16, 42, -6, 42, 4);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#f3d98c';
  g.beginPath(); g.arc(52, -24, 1.6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(30,60,100,0.6)';
  g.lineWidth = 1;
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(-52 + i * 20, 7); g.quadraticCurveTo(-46 + i * 20, 4, -40 + i * 20, 7); g.stroke(); }
  g.restore();
}

export { wobblePoints };
