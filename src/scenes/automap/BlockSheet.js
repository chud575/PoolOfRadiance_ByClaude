import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { TRAVEL } from '../../data/travel.js';
import { INK, makeCanvas, makeParchment, quillStroke, planWall, pencilShade, hatchRect, lineShade, stipple, featherMask, prng } from './ink.js';
import { regions, washRegion, hatchBand, cobbleRegion, scatter, boundaryPath } from './paint.js';
import { surveyFogGrid, paintUnsurveyed, paintFogEdge, sightLines } from './fog.js';
import { stoneWall, timberWall, cityWall, tower, chunk, doorLeaf, lockedDoor, secretDoor } from './walls.js';
import { drawFloor, wallShadow, furnish, partition, themeOf } from './plan.js';
import { drawMarker } from './glyphs.js';
import { SERIF, drawCompassRose, drawCartouche, drawIlluminatedInitial, drawFlourish, fitFont, wrapText, haloText, goldGradient } from './ornaments.js';

/**
 * The block sheet: one city block (16x16 cells) inked on parchment in the
 * manner of a cartographer's survey, with washes per ground type, hatched
 * bedrock, walls/doors/arches/secret doors, markers, zone names, exits,
 * a coordinate border, cartouche with illuminated initial, compass rose and
 * a key. Only what the party has explored is inked; the rest is bare paper
 * with a faint pencil survey grid.
 *
 * Sheet units: 1300 x 1000 (plus MARGIN on each side for the baked shadow).
 */
export const SHEET = { W: 1300, H: 940, M: 40, MX: 78, MY: 56, MS: 844 };

/** Pre-computed facts about a map used by the renderers. */
export function analyseMap(map) {
  const rock = new Uint8Array(map.w * map.h);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const all = DIRS.every((d) => map.getEdge(x, y, d) === EDGE.WALL);
    if (all && !map.events.some((e) => e.x === x && e.y === y)) rock[y * map.w + x] = 1;
  }
  const travel = TRAVEL.filter((t) => t.from === map.id).map((t) => ({
    ...t,
    destName: hasMap(t.to.map) ? getMap(t.to.map).name : t.to.map,
  }));
  return { rock, travel, isRock: (x, y) => !map.inBounds(x, y) || rock[y * map.w + x] === 1 };
}

/**
 * Visible edges around explored cells, in cell coordinates:
 * [{x0,y0,x1,y1,type,style,cell:[x,y,dir],horiz}] and effective(seg) → edge type
 * as the party knows it (unfound secret doors read as walls).
 */
export function collectEdges(map, info, seenCell, secrets) {
  const isFound = (x, y, d) => {
    const [dx, dy] = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[d];
    const opp = { N: 'S', E: 'W', S: 'N', W: 'E' }[d];
    return secrets.has(`${x},${y},${d}`) || secrets.has(`${x + dx},${y + dy},${opp}`);
  };
  const segs = [];
  for (let y = 0; y <= map.h; y++) for (let x = 0; x <= map.w; x++) {
    if (x < map.w) {
      const a = seenCell(x, y - 1);
      const b = seenCell(x, y);
      const rockBoth = info.isRock(x, y - 1) && info.isRock(x, y);
      const e = y < map.h ? map.getEdge(x, y, 'N') : map.getEdge(x, y - 1, 'S');
      if ((a || b) && e !== EDGE.OPEN && !rockBoth) {
        const cy = y < map.h ? y : y - 1;
        const d = y < map.h ? 'N' : 'S';
        segs.push({ x0: x, y0: y, x1: x + 1, y1: y, type: e, style: map.getEdgeStyle(x, cy, d), cell: [x, cy, d], horiz: true });
      }
    }
    if (y < map.h) {
      const a = seenCell(x - 1, y);
      const b = seenCell(x, y);
      const rockBoth = info.isRock(x - 1, y) && info.isRock(x, y);
      const e = x < map.w ? map.getEdge(x, y, 'W') : map.getEdge(x - 1, y, 'E');
      if ((a || b) && e !== EDGE.OPEN && !rockBoth) {
        const cx = x < map.w ? x : x - 1;
        const d = x < map.w ? 'W' : 'E';
        segs.push({ x0: x, y0: y, x1: x, y1: y + 1, type: e, style: map.getEdgeStyle(cx, y, d), cell: [cx, y, d], horiz: false });
      }
    }
  }
  const effective = (q) => (q.type === EDGE.SECRET && !isFound(...q.cell) ? EDGE.WALL : q.type);
  return { segs, effective };
}

/** Merge collinear, touching segments into longer runs. */
export function mergeRuns(list0) {
  const runs = [];
  for (const horiz of [true, false]) {
    const list = list0.filter((q) => q.horiz === horiz).sort((a, b) => (horiz ? a.y0 - b.y0 || a.x0 - b.x0 : a.x0 - b.x0 || a.y0 - b.y0));
    let cur = null;
    for (const q of list) {
      if (cur && (horiz ? cur.y0 === q.y0 && Math.abs(cur.x1 - q.x0) < 0.01 : cur.x0 === q.x0 && Math.abs(cur.y1 - q.y0) < 0.01)) {
        cur.x1 = q.x1;
        cur.y1 = q.y1;
      } else {
        cur = { ...q };
        runs.push(cur);
      }
    }
  }
  return runs;
}

/** Which marker glyph a map event shows (or null to keep it hidden). */
export function eventMarker(ev, spent) {
  if (typeof ev.ref === 'string' && ev.ref.startsWith('go_')) return null;
  if (ev.type === 'sign') return 'sign';
  if (ev.type === 'text') return 'text';
  if (ev.type === 'shop') return 'shop';
  if (ev.type === 'treasure') return spent ? 'treasure' : null;
  if (ev.type === 'encounter') {
    if (typeof ev.ref === 'string' && ev.ref.includes('shrine')) return 'shrine';
    if (ev.once && spent && !(ev.ref ?? '').startsWith('ev_')) return 'battle';
  }
  return null;
}

export const MARKER_LABELS = {
  sign: 'Inscription', text: 'Writing / clue', shop: 'Shop or service', treasure: 'Treasure taken',
  battle: 'Battle won', shrine: 'Shrine', exit: 'Way out', stairs: 'Stair / passage',
};

// roof / floor pigments per wall style (each building picks one, then jitters hue and value)
const ROOF_STONE = [[184, 98, 72], [150, 136, 128], [176, 148, 108], [160, 112, 84], [178, 120, 106], [134, 128, 132]];
const ROOF_TIMBER = [[204, 148, 72], [192, 102, 58], [200, 128, 74], [178, 90, 72], [208, 168, 98]];
const ROOF_RUIN = [[150, 128, 104], [140, 120, 100], [132, 126, 112]];
// pigments dropped wet-in-wet into a roof wash: sepia, indigo shadow, madder, sap
const SECOND = [[110, 70, 44], [78, 86, 120], [140, 60, 52], [96, 100, 60]];

/**
 * Build the sheet canvas.
 * @param {import('../../data/maps/MapGrid.js').MapGrid} map
 * @param {{k?:number, seen:(x:number,y:number)=>boolean, secrets:Set<string>, spent:Record<string,boolean>, inkWalls?:boolean, subtitle?:string}} o
 */
export function buildBlockSheet(map, { k = 2, seen, secrets, spent, inkWalls = true, zoneLabels = false, subtitle = 'Phlan, upon the Moonsea', party = null }) {
  const { W, H, M, MX, MY, MS } = SHEET;
  const info = analyseMap(map);
  const seed = [...map.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  const canvas = makeParchment((W + 2 * M) * k, (H + 2 * M) * k, { seed, margin: M * k, tone: [240, 224, 186], ring: [0.985, 0.99] });
  const g = canvas.getContext('2d');
  g.save();
  g.scale(k, k);
  g.translate(M, M);
  const cs = MS / map.w;
  const CX = (x) => MX + x * cs;
  const CY = (y) => MY + y * cs;
  const walkedCell = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && seen(x, y);
  const wild = map.tileset === 'wilderness' || map.tileset === 'graveyard';
  const dungeon = map.tileset === 'dungeon' || map.kind === 'dungeon';

  // ---------- fog of war: walked squares inked, squares in sight pencilled, a soft fade ----------
  // what the company saw from where it stood: down each street to the next wall, and
  // the whole of any room it entered (so the sheet rewards the very first step)
  const sighted = sightLines(map, walkedCell, info.isRock, { rooms: !dungeon });
  const seenCell = (x, y) => walkedCell(x, y) || sighted.has(`${x},${y}`);
  const nearSeen = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (seenCell(x + dx, y + dy)) return true;
    return false;
  };
  const stateOf = (x, y) => (walkedCell(x, y) ? 2 : seenCell(x, y) || (info.isRock(x, y) && nearSeen(x, y)) ? 1 : 0);
  const openGround = (x, y) => wild || (!info.isRock(x, y) && (map.getCell(x, y) === CELL.STREET || map.getCell(x, y) === CELL.COURTYARD));
  const fogArea = [MX, MY, MS, MS];
  const survey = surveyFogGrid(W, H, { mx: MX, my: MY, cs, w: map.w, h: map.h, state: stateOf, hard: (x, y) => !openGround(x, y), area: fogArea, seed: seed + 17 });
  const mask = survey.clean;
  const fogCov = survey.cover;
  g.drawImage(paintUnsurveyed(W, H, k, fogCov, fogArea, { seed: seed + 21 }), 0, 0, W, H);
  g.drawImage(paintFogEdge(W, H, k, survey.edge, fogArea, { seed: seed + 23 }), 0, 0, W, H);
  // buildings seen from the street but never entered: shut in pencil cross-hatching,
  // a closed graphite block with a darker rim inside its walls
  {
    const ub = makeCanvas(W * k, H * k);
    const ug = ub.getContext('2d');
    ug.scale(k, k);
    ug.lineCap = 'round';
    const ur = prng(seed + 57);
    for (const rg of regions(map, info).list) {
      if (rg.type !== CELL.INTERIOR) continue;
      if (rg.cells.some(([i, j]) => seenCell(i, j)) || !rg.cells.some(([i, j]) => nearSeen(i, j))) continue;
      const path = new Path2D();
      for (const [i, j] of rg.cells) path.rect(CX(i), CY(j), cs, cs);
      ug.save();
      ug.clip(path);
      // a clean reserve of paper inside the walls (the unknown ground's cross-hatch
      // stops at them), then the building's own hatch
      ug.fillStyle = 'rgb(226,208,170)';
      ug.fill(path);
      ug.fillStyle = 'rgba(104,90,74,0.26)';
      ug.fill(path);
      let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
      for (const [i, j] of rg.cells) { x0 = Math.min(x0, CX(i)); y0 = Math.min(y0, CY(j)); x1 = Math.max(x1, CX(i + 1)); y1 = Math.max(y1, CY(j + 1)); }
      const L = (x1 - x0) + (y1 - y0);
      // one uniform 45-degree graphite hatch, ruled evenly with a sharp lead
      ug.strokeStyle = 'rgba(50,38,28,0.6)';
      ug.lineWidth = 0.9;
      ug.beginPath();
      for (let o = -L; o < L; o += 3.1) {
        ug.moveTo(x0 + o, y1); ug.lineTo(x0 + o + (y1 - y0), y0);
      }
      ug.stroke();
      // a hard inner edge line pressed just inside the walls
      const inset = cs * 0.125 + 2.2;
      ug.strokeStyle = 'rgba(48,36,26,0.62)';
      ug.lineWidth = 0.9;
      ug.beginPath();
      for (const [i, j] of rg.cells) {
        const has = (a2, b2) => rg.cells.some(([p2, q2]) => p2 === a2 && q2 === b2);
        const X0 = CX(i) + (has(i - 1, j) ? 0 : inset);
        const X1 = CX(i + 1) - (has(i + 1, j) ? 0 : inset);
        const Y0 = CY(j) + (has(i, j - 1) ? 0 : inset);
        const Y1 = CY(j + 1) - (has(i, j + 1) ? 0 : inset);
        if (!has(i, j - 1)) { ug.moveTo(X0, Y0); ug.lineTo(X1, Y0); }
        if (!has(i, j + 1)) { ug.moveTo(X0, Y1); ug.lineTo(X1, Y1); }
        if (!has(i - 1, j)) { ug.moveTo(X0, Y0); ug.lineTo(X0, Y1); }
        if (!has(i + 1, j)) { ug.moveTo(X1, Y0); ug.lineTo(X1, Y1); }
      }
      ug.stroke();
      ug.restore();
      // the walls' outer border, a slightly ragged hand-drawn pencil line
      ug.save();
      ug.strokeStyle = 'rgba(52,38,26,0.7)';
      ug.lineWidth = 1.1;
      ug.beginPath();
      for (const [i, j] of rg.cells) {
        const has = (a2, b2) => rg.cells.some(([p2, q2]) => p2 === a2 && q2 === b2);
        const seg = (ax2, ay2, bx2, by2) => {
          const n = 4;
          ug.moveTo(ax2 + (ur() - 0.5) * 1.2, ay2 + (ur() - 0.5) * 1.2);
          for (let q = 1; q <= n; q++) ug.lineTo(ax2 + ((bx2 - ax2) * q) / n + (ur() - 0.5) * 1.3, ay2 + ((by2 - ay2) * q) / n + (ur() - 0.5) * 1.3);
        };
        if (!has(i, j - 1)) seg(CX(i) - 1, CY(j), CX(i + 1) + 1, CY(j));
        if (!has(i, j + 1)) seg(CX(i) - 1, CY(j + 1), CX(i + 1) + 1, CY(j + 1));
        if (!has(i - 1, j)) seg(CX(i), CY(j) - 1, CX(i), CY(j + 1) + 1);
        if (!has(i + 1, j)) seg(CX(i + 1), CY(j) - 1, CX(i + 1), CY(j + 1) + 1);
      }
      ug.stroke();
      ug.restore();
    }
    g.drawImage(ub, 0, 0, W, H);
  }
  // ---------- pencil survey grid: only where the ground is still unsurveyed (the inked
  // plan stands on its own, no squares showing through the floors) ----------
  {
    const gl = makeCanvas(W * k, H * k);
    const gg = gl.getContext('2d');
    gg.scale(k, k);
    gg.strokeStyle = 'rgba(90,75,55,0.2)';
    gg.lineWidth = 0.6;
    gg.beginPath();
    for (let i = 0; i <= map.w; i++) { gg.moveTo(CX(i), MY); gg.lineTo(CX(i), MY + MS); }
    for (let j = 0; j <= map.h; j++) { gg.moveTo(MX, CY(j)); gg.lineTo(MX + MS, CY(j)); }
    gg.stroke();
    gg.setTransform(1, 0, 0, 1, 0, 0);
    gg.globalCompositeOperation = 'destination-in';
    gg.drawImage(fogCov, 0, 0, W * k, H * k);
    g.drawImage(gl, 0, 0, W, H);
  }
  // under the unsurveyed shading, the council's old, faded street plan: loose pencilled
  // outlines of where the blocks of houses are said to stand (no doors, no secrets)
  if (!dungeon) {
    const gh = makeCanvas(W * k, H * k);
    const hg = gh.getContext('2d');
    hg.scale(k, k);
    hg.lineCap = 'round';
    const gr = prng(seed + 33);
    for (const rg of regions(map, info).list) {
      if (rg.type !== CELL.INTERIOR || rg.cells.length < 2) continue;
      // once its walls are charted, the old plan's guess is not repeated beside them
      if (rg.cells.some(([i, j]) => nearSeen(i, j))) continue;
      let x0 = 99; let y0 = 99; let x1 = -1; let y1 = -1;
      for (const [i, j] of rg.cells) { x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i + 1); y1 = Math.max(y1, j + 1); }
      const jt = () => (gr() - 0.5) * cs * 0.35;
      const pts = [[CX(x0) + jt(), CY(y0) + jt()], [CX(x1) + jt(), CY(y0) + jt()], [CX(x1) + jt(), CY(y1) + jt()], [CX(x0) + jt(), CY(y1) + jt()]];
      for (let q = 0; q < 4; q++) {
        if (gr() < 0.2) continue;
        const [ax, ay] = pts[q];
        const [bx, by] = pts[(q + 1) % 4];
        const ox = (bx - ax) * 0.07;
        const oy = (by - ay) * 0.07;
        hg.strokeStyle = `rgba(66,56,46,${(0.32 + gr() * 0.2).toFixed(2)})`;
        hg.lineWidth = 0.7 + gr() * 0.4;
        hg.beginPath();
        hg.moveTo(ax - ox, ay - oy);
        hg.quadraticCurveTo((ax + bx) / 2 + (gr() - 0.5) * 4, (ay + by) / 2 + (gr() - 0.5) * 4, bx + ox, by + oy);
        hg.stroke();
      }
    }
    hg.setTransform(1, 0, 0, 1, 0, 0);
    hg.globalCompositeOperation = 'destination-in';
    hg.drawImage(fogCov, 0, 0, W * k, H * k);
    g.drawImage(gh, 0, 0, W, H);
  }

  // ---------- watercolour washes (masked) ----------
  const reg = regions(map, info);
  const wash = makeCanvas(W * k, H * k);
  const P = { CX, CY, cs, k, walled: (x, y, d) => map.getEdge(x, y, d) !== EDGE.OPEN };
  {
    const w = wash.getContext('2d');
    w.scale(k, k);
    const r = prng(seed + 11);
    // bedrock: hatched solid ground
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!info.isRock(x, y)) continue;
      w.fillStyle = 'rgba(120,100,80,0.2)';
      w.fillRect(CX(x), CY(y), cs, cs);
      hatchRect(w, CX(x), CY(y), cs, cs, { seed: seed + y * 97 + x, size: cs * 0.36, width: 0.8, alpha: 0.55, color: '#3a2716' });
    }
    // soft cast shadows of the walls (south-east), laid in as a wash
    w.save();
    w.filter = `blur(${(cs * 0.05 * k).toFixed(1)}px)`;
    w.strokeStyle = 'rgba(70,40,18,0.22)';
    w.lineWidth = cs * 0.16;
    w.beginPath();
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (info.isRock(x, y)) continue;
      if (map.getEdge(x, y, 'N') !== EDGE.OPEN) { w.moveTo(CX(x) + cs * 0.1, CY(y) + cs * 0.1); w.lineTo(CX(x + 1) + cs * 0.1, CY(y) + cs * 0.1); }
      if (map.getEdge(x, y, 'W') !== EDGE.OPEN) { w.moveTo(CX(x) + cs * 0.1, CY(y) + cs * 0.1); w.lineTo(CX(x) + cs * 0.1, CY(y + 1) + cs * 0.1); }
    }
    w.stroke();
    w.restore();
    for (const rg of reg.list) {
      const rs = seed * 7 + rg.index * 131;
      const rr = prng(rs);
      const jit = (c, hj, vj) => {
        const v = 1 + (rr() - 0.5) * vj;
        const h0 = (rr() - 0.5) * hj;
        return [c[0] * v + h0 * 40, c[1] * v + h0 * 10, c[2] * v - h0 * 25];
      };
      const t = rg.type;
      if (t === CELL.INTERIOR && dungeon) {
        washRegion(w, rg.cells, { ...P, color: jit([200, 170, 125], 0.4, 0.15), alpha: 0.24, seed: rs, edge: 0.3, mottle: 0.4, gran: 0.25 });
      } else if (t === CELL.INTERIOR) {
        // roofs and floors: each building its own pigment
        const pal = rg.style === 1 ? ROOF_TIMBER : rg.style === 2 ? ROOF_RUIN : ROOF_STONE;
        const base = pal[Math.floor(rr() * pal.length)];
        washRegion(w, rg.cells, { ...P, color: jit(base, 0.5, 0.22), alpha: 0.34 + rr() * 0.12, seed: rs, edge: 0.45 + rr() * 0.2, blooms: rr() < 0.6 ? 1 : 0, mottle: 0.18 + rr() * 0.14, gran: 0.22 + rr() * 0.15, glaze: 0.3 + rr() * 0.3, second: SECOND[Math.floor(rr() * SECOND.length)] });
      } else if (t === CELL.RUBBLE) {
        washRegion(w, rg.cells, { ...P, color: jit([150, 130, 104], 0.3, 0.15), alpha: 0.3, seed: rs, edge: 0.35, mottle: 0.5, gran: 0.5 });
      } else if (t === CELL.COURTYARD) {
        washRegion(w, rg.cells, { ...P, color: [214, 184, 128], alpha: 0.21, seed: rs, edge: 0, mottle: 0.55, gran: 0.25, blooms: 0 });
      } else if (t === CELL.WATER) {
        washRegion(w, rg.cells, { ...P, color: jit([62, 112, 168], 0.2, 0.1), alpha: 0.5, seed: rs, edge: 0.55, mottle: 0.25, gran: 0.15, blooms: 2 });
      } else {
        washRegion(w, rg.cells, { ...P, color: wild ? [120, 152, 80] : [220, 184, 122], alpha: wild ? 0.3 : 0.22, seed: rs, edge: 0.22, mottle: 0.55, gran: 0.25, blooms: 0 });
      }
    }
    scatter(w, map, (x, y) => !info.isRock(x, y) && map.getCell(x, y) === CELL.STREET, { ...P, seed: seed + 3, kind: wild ? 'grass' : 'street' });
    scatter(w, map, (x, y) => !info.isRock(x, y) && map.getCell(x, y) === CELL.RUBBLE, { ...P, seed: seed + 4, kind: 'rubble' });
    if (dungeon) scatter(w, map, (x, y) => !info.isRock(x, y) && map.getCell(x, y) === CELL.INTERIOR, { ...P, seed: seed + 6, kind: 'street' });
    w.strokeStyle = 'rgba(30,60,110,0.45)';
    w.lineWidth = 0.7;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (info.isRock(x, y) || map.getCell(x, y) !== CELL.WATER) continue;
      for (let i = 0; i < 3; i++) {
        const py = CY(y) + cs * (0.25 + i * 0.25) + (r() - 0.5) * cs * 0.08;
        const ox = CX(x) + (r() - 0.5) * cs * 0.3;
        w.beginPath();
        w.moveTo(ox + cs * 0.15, py);
        w.quadraticCurveTo(ox + cs * 0.3, py - cs * 0.06, ox + cs * 0.45, py);
        w.quadraticCurveTo(ox + cs * 0.6, py + cs * 0.06, ox + cs * 0.75, py);
        w.stroke();
      }
    }
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'destination-in';
    w.imageSmoothingEnabled = true;
    w.drawImage(mask, 0, 0, W * k, H * k);
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.drawImage(wash, 0, 0, W, H);
  g.restore();

  // ---------- floor plans: paving / boards, partitions, furniture, wall shadow (masked) ----------
  const furniture = [];
  {
    const det = makeCanvas(W * k, H * k);
    const d = det.getContext('2d');
    d.scale(k, k);
    const busy = new Set();
    for (const ev of map.events) if (eventMarker(ev, !!spent[ev.id])) busy.add(`${ev.x},${ev.y}`);
    for (const t of info.travel) busy.add(`${t.at.x},${t.at.y}`);
    // paving: setts laid continuously along the street network, flags on the plazas
    if (!wild && !dungeon) {
      const ground = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && (map.getCell(x, y) === CELL.STREET || map.getCell(x, y) === CELL.COURTYARD);
      const DV2 = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
      const opn = (x, y, dd) => map.getEdge(x, y, dd) === EDGE.OPEN && ground(x + DV2[dd][0], y + DV2[dd][1]);
      const run = (x, y, a, b) => {
        let n = 1;
        for (const dd of [a, b]) {
          let cx = x; let cy = y;
          for (let i = 0; i < 6 && opn(cx, cy, dd); i++) { cx += DV2[dd][0]; cy += DV2[dd][1]; n++; }
        }
        return n;
      };
      const axisAt = (x, y) => {
        const h = run(x, y, 'E', 'W');
        const v = run(x, y, 'N', 'S');
        return h > v ? 'h' : v > h ? 'v' : (x + y) % 2 ? 'h' : 'v';
      };
      // alleys: one square wide between two walls, left as beaten earth
      const walled = (x, y, dd) => map.getEdge(x, y, dd) !== EDGE.OPEN;
      const bareAt = (x, y) => map.getCell(x, y) === CELL.STREET && ((walled(x, y, 'N') && walled(x, y, 'S')) || (walled(x, y, 'E') && walled(x, y, 'W')));
      // wear: before every door and arch, at the gates, and where lanes cross between buildings
      const wearAt = (x, y) => {
        let w = 0;
        for (const dd of DIRS) {
          const e = map.getEdge(x, y, dd);
          if (e === EDGE.DOOR || e === EDGE.ARCH || e === EDGE.LOCKED) w = Math.max(w, 0.62);
        }
        if (info.travel.some((t) => t.at.x === x && t.at.y === y)) w = 1;
        const opens = DIRS.filter((dd) => opn(x, y, dd)).length;
        let diag = 0;
        for (const [dx2, dy2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (!ground(x + dx2, y + dy2)) diag++;
        if (opens >= 3 && diag >= 2) w = Math.max(w, 0.42);
        return w;
      };
      // the street hierarchy: a main street (long straight runs inside the walls) paved
      // and kerbed, lanes left as earth with a scatter of setts, open yards as dirt
      const street = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && map.getCell(x, y) === CELL.STREET;
      const srun = (x, y, a, b) => {
        let n = 1;
        for (const dd of [a, b]) {
          let cx = x; let cy = y;
          for (let i = 0; i < 16 && map.getEdge(cx, cy, dd) === EDGE.OPEN && street(cx + DV2[dd][0], cy + DV2[dd][1]); i++) { cx += DV2[dd][0]; cy += DV2[dd][1]; n++; }
        }
        return n;
      };
      const rim = (x, y) => x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
      const isMain = (x, y) => street(x, y) && !rim(x, y) && Math.max(srun(x, y, 'E', 'W'), srun(x, y, 'N', 'S')) >= 10;
      const cls = new Map();
      const classAt = (x, y) => {
        const key = y * map.w + x;
        if (cls.has(key)) return cls.get(key);
        let c = 'lane';
        if (isMain(x, y)) c = 'main';
        else if (!rim(x, y)) {
          for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
            let ok = true;
            for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
              const qx = x + ox + i; const qy = y + oy + j;
              if (!street(qx, qy) || isMain(qx, qy)) { ok = false; break; }
              if (map.getEdge(qx, qy, i ? 'W' : 'E') !== EDGE.OPEN || map.getEdge(qx, qy, j ? 'N' : 'S') !== EDGE.OPEN) { ok = false; break; }
            }
            if (ok) { c = 'yard'; break; }
          }
        }
        cls.set(key, c);
        return c;
      };
      for (const rg of reg.list) {
        if (rg.type !== CELL.STREET && rg.type !== CELL.COURTYARD) continue;
        if (!rg.cells.some(([x, y]) => seenCell(x, y))) continue;
        const plaza = rg.type === CELL.COURTYARD;
        if (plaza) {
          // a plaza is flagged like the halls round it: the same inked, broken-coursed slabs
          drawFloor(d, rg.cells, { CX, CY, cs, seed: seed + rg.index * 23 + 5, kind: 'plaza' });
          continue;
        }
        cobbleRegion(d, rg.cells, { CX, CY, cs, seed: seed + rg.index * 23 + 5, axisAt, wearAt, groundAt: ground, bareAt: () => false, classAt, kind: 'setts' });
      }
    }
    for (const rg of reg.list) {
      if (rg.type !== CELL.INTERIOR) continue;
      if (!rg.cells.some(([x, y]) => seenCell(x, y))) continue;
      const rs = seed * 13 + rg.index * 71;
      const [ax, ay] = rg.cells[Math.floor(rg.cells.length / 2)];
      const ruined = rg.style === 2 && !dungeon;
      // each building its own floor, so neighbours never read as one stamped texture
      const theme = themeOf(map.zoneAt(ax, ay));
      const byTheme = { temple: 'slabs', counting: 'slabs', barracks: 'slabs', library: 'planks', tavern: 'planks', store: 'earth' };
      const kind = dungeon ? 'slabs' : ruined ? 'broken' : byTheme[theme] ?? (rg.style === 1 ? (rs % 3 === 0 ? 'earth' : 'planks') : 'slabs');
      drawFloor(d, rg.cells, { CX, CY, cs, seed: rs, kind });
      if (!dungeon) {
        wallShadow(d, rg.cells, { CX, CY, cs, seed: rs + 2, walled: P.walled });
        if (!ruined && !['temple', 'counting', 'library'].includes(theme)) partition(d, rg.cells, { CX, CY, cs, seed: rs + 3 });
        furnish(d, rg.cells, { CX, CY, cs, seed: rs + 5, map, theme: themeOf(map.zoneAt(ax, ay)), ruined, avoid: (x, y) => busy.has(`${x},${y}`), out: furniture });
      }
    }
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'destination-in';
    d.imageSmoothingEnabled = true;
    d.drawImage(mask, 0, 0, W * k, H * k);
    g.drawImage(det, 0, 0, W, H);
  }

  // ---------- walls: masonry, timber framing and the city wall, on their own ink layer ----------
  const wallW = cs * 0.25;
  const timberW = cs * 0.2;
  const cityW = cs * 0.32;
  const cityOff = cityW * 0.3; // the curtain stands a little inside the block's edge
  const { segs: cellSegs, effective } = collectEdges(map, info, seenCell, secrets);
  const segs = cellSegs.map((q) => ({ ...q, x0: CX(q.x0), y0: CY(q.y0), x1: CX(q.x1), y1: CY(q.y1) }));
  const exitAt = new Set(info.travel.filter((t) => t.edge).map((t) => `${t.at.x},${t.at.y},${t.at.facing}`));
  const ruin = (q) => q.style === 2 && !dungeon;
  const border = (q) => !dungeon && !wild && ((q.horiz && (q.cell[1] === 0 && q.cell[2] === 'N' || q.cell[1] === map.h - 1 && q.cell[2] === 'S')) || (!q.horiz && (q.cell[0] === 0 && q.cell[2] === 'W' || q.cell[0] === map.w - 1 && q.cell[2] === 'E')));
  const isTimber = (q) => q.style === 1 && !dungeon && !border(q);
  const widthOf = (q) => (border(q) ? cityW : isTimber(q) ? timberW : wallW);
  const outward = (q) => (q.horiz ? [0, q.cell[2] === 'N' ? -1 : 1] : [q.cell[2] === 'W' ? -1 : 1, 0]);
  const inkL = makeCanvas(W * k, H * k);
  const ig = inkL.getContext('2d');
  ig.scale(k, k);
  /** one length of wall in the style its edge calls for */
  const wallPiece = (q, ax, ay, bx, by, sd, { rag = 0 } = {}) => {
    if (Math.hypot(bx - ax, by - ay) < 0.5) return;
    if (border(q)) {
      const [ox, oy] = outward(q);
      cityWall(ig, ax - ox * cityOff, ay - oy * cityOff, bx - ox * cityOff, by - oy * cityOff, { width: cityW, seed: sd, out: [ox, oy] });
    } else if (isTimber(q)) timberWall(ig, ax, ay, bx, by, { width: timberW, seed: sd, cs, heavy: true });
    else stoneWall(ig, ax, ay, bx, by, { width: rag ? wallW * 0.8 : wallW, seed: sd, courses: 2, ragged: rag, poche: true });
  };
  const wallRects = [];
  // a cartographer's drop shadow: fine diagonal hatching cast on the ground south and east
  // of every wall (light from the north-west), drawn under the masonry
  if (inkWalls) {
    const hr = prng(seed + 91);
    ig.save();
    ig.strokeStyle = INK.ink;
    ig.lineCap = 'round';
    for (const rn of mergeRuns(segs.filter((q) => effective(q) !== EDGE.OPEN))) {
      const isB = border(rn);
      if (isB && ((rn.horiz && rn.cell[2] === 'S') || (!rn.horiz && rn.cell[2] === 'E'))) continue;
      const w0 = widthOf(rn) / 2 + (isB ? cityOff : 0);
      const band = cs * (isB ? 0.26 : ruin(rn) ? 0.12 : 0.19);
      const a0 = rn.horiz ? rn.x0 : rn.y0;
      const a1 = rn.horiz ? rn.x1 : rn.y1;
      const base = (rn.horiz ? rn.y0 : rn.x0) + w0;
      for (let p = a0 + hr() * 1.2; p < a1; p += 1.9 + hr() * 0.8) {
        // the shadow frays: strokes shorten here and there, never a ruled edge
        const L = band * (0.55 + hr() * 0.45) * (0.8 + 0.2 * Math.sin(p * 0.37));
        ig.globalAlpha = 0.34 + hr() * 0.26;
        ig.lineWidth = 0.45 + hr() * 0.3;
        ig.beginPath();
        if (rn.horiz) { ig.moveTo(p, base + 0.3); ig.lineTo(p + L * 0.75, base + L); } else { ig.moveTo(base + 0.3, p); ig.lineTo(base + L, p + L * 0.75); }
        ig.stroke();
      }
    }
    ig.restore();
  }
  const keepOut = (q, w) => wallRects.push([Math.min(q.x0, q.x1) - w / 2, Math.min(q.y0, q.y1) - w / 2, Math.abs(q.x1 - q.x0) + w, Math.abs(q.y1 - q.y0) + w]);
  if (inkWalls) {
    const runs = mergeRuns(segs.filter((q) => effective(q) === EDGE.WALL && !ruin(q)));
    for (const rn of runs) {
      const w = widthOf(rn);
      const ext = w * 0.5;
      const dx = rn.horiz ? ext : 0;
      const dy = rn.horiz ? 0 : ext;
      wallPiece(rn, rn.x0 - dx, rn.y0 - dy, rn.x1 + dx, rn.y1 + dy, (rn.x0 * 7 + rn.y0 * 13) | 0);
      keepOut(rn, w);
    }
    // crumbling ruin walls: broken lengths with ragged ends and spilled masonry
    for (const sg of segs.filter((q) => effective(q) === EDGE.WALL && ruin(q))) {
      const r = prng((sg.x0 * 3 + sg.y0 * 7) | 0);
      const n = 1 + Math.floor(r() * 3);
      const [ox, oy] = outward(sg);
      for (let i = 0; i < n; i++) {
        const t0 = i / n + r() * 0.1;
        const t1 = (i + 1) / n - 0.08 - r() * 0.15;
        if (t1 - t0 < 0.14) continue;
        wallPiece(sg, sg.x0 + (sg.x1 - sg.x0) * t0, sg.y0 + (sg.y1 - sg.y0) * t0, sg.x0 + (sg.x1 - sg.x0) * t1, sg.y0 + (sg.y1 - sg.y0) * t1, i + sg.x0 * 3 + sg.y0, { rag: 0.6 });
      }
      for (let i = 0; i < 5; i++) {
        const t = 0.05 + r() * 0.9;
        const side = (r() < 0.5 ? -1 : 1) * (wallW * 0.7 + r() * cs * 0.14);
        chunk(ig, sg.x0 + (sg.x1 - sg.x0) * t + ox * side, sg.y0 + (sg.y1 - sg.y0) * t + oy * side, cs * (0.025 + r() * 0.04), r);
      }
      keepOut(sg, wallW);
    }
    // doors, locked doors, arches, found secret doors
    for (const sg of segs) {
      const t = effective(sg);
      if (t === EDGE.WALL) continue;
      const mx = (sg.x0 + sg.x1) / 2;
      const my = (sg.y0 + sg.y1) / 2;
      const along = sg.horiz ? [1, 0] : [0, 1];
      const gap = cs * 0.26;
      const sd = (sg.x0 * 5 + sg.y0 * 11) | 0;
      const ww = widthOf(sg);
      const P = (a) => [sg.x0 + (sg.x1 - sg.x0) * a, sg.y0 + (sg.y1 - sg.y0) * a];
      const piece = (a, b2) => {
        const [ax, ay] = P(a);
        const [bx, by] = P(b2);
        wallPiece(sg, ax, ay, bx, by, sd + Math.round(a * 10), { rag: ruin(sg) ? 0.5 : 0 });
      };
      const [ox, oy] = outward(sg);
      keepOut(sg, ww);
      if (t === EDGE.SECRET) {
        secretDoor(ig, sg.x0, sg.y0, sg.x1, sg.y1, { width: ww, cs, side: [-ox, -oy], seed: sd });
        continue;
      }
      piece(-ww * 0.5 / cs, 0.5 - gap / cs);
      piece(0.5 + gap / cs, 1 + ww * 0.5 / cs);
      const shift = border(sg) ? -cityOff : 0;
      const cmx = mx + ox * shift;
      const cmy = my + oy * shift;
      if (t === EDGE.ARCH) {
        const out = exitAt.has(sg.cell.join(','));
        for (const sgn of [-1, 1]) {
          const px = cmx + along[0] * gap * sgn;
          const py = cmy + along[1] * gap * sgn;
          const ps = ww * 1.6;
          stoneWall(ig, px - along[0] * ps * 0.5, py - along[1] * ps * 0.5, px + along[0] * ps * 0.5, py + along[1] * ps * 0.5, { width: ps, seed: sd + sgn, courses: 1, poche: true, faceW: 1.3 });
        }
        ig.save();
        ig.strokeStyle = out ? INK.vermilion : INK.ink;
        ig.lineWidth = 0.9;
        ig.setLineDash([2.2, 2.4]);
        ig.beginPath();
        ig.moveTo(cmx - along[0] * gap * 0.8, cmy - along[1] * gap * 0.8);
        ig.lineTo(cmx + along[0] * gap * 0.8, cmy + along[1] * gap * 0.8);
        ig.stroke();
        ig.restore();
      } else if (t === EDGE.LOCKED) {
        // shut, barred in vermilion, padlocked on the side of the square that owns it
        const side = sg.horiz ? -oy : ox;
        lockedDoor(ig, cmx, cmy, sg.horiz, gap * 2.1, cs * 0.17, side);
      } else {
        // keep names clear of the leaf's swing into the room
        const sx0 = cmx - along[0] * gap - ox * gap * 2.1;
        const sy0 = cmy - along[1] * gap - oy * gap * 2.1;
        const sx1 = cmx + along[0] * gap;
        const sy1 = cmy + along[1] * gap;
        wallRects.push([Math.min(sx0, sx1), Math.min(sy0, sy1), Math.abs(sx1 - sx0) || 2, Math.abs(sy1 - sy0) || 2]);
        // a plan door: the leaf hung from one jamb, swung open over a pencilled arc
        const hx = cmx - along[0] * gap;
        const hy = cmy - along[1] * gap;
        const a0 = Math.atan2(along[1], along[0]);
        let da = Math.atan2(-oy, -ox) - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        doorLeaf(ig, hx, hy, a0 + da * 0.8, a0, gap * 2, Math.max(2.2, cs * 0.075));
      }
    }
    // the city wall's bastions: at its corners and either side of every gate (from the whole
    // block's plan, so a tower is never guessed at the edge of what has been seen)
    {
      const all = collectEdges(map, info, (x, y) => map.inBounds(x, y) && !info.isRock(x, y), new Set());
      const bRuns = mergeRuns(all.segs.filter((q) => border(q) && all.effective(q) === EDGE.WALL));
      const spots = [];
      const add = (x, y, out) => {
        if (spots.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1.2)) return;
        spots.push([x, y, out]);
      };
      for (const rn of bRuns) {
        const out = outward(rn);
        add(rn.x0, rn.y0, out);
        add(rn.x1, rn.y1, out);
        const len = Math.hypot(rn.x1 - rn.x0, rn.y1 - rn.y0);
        const n = Math.floor(len / 5.5);
        for (let i = 1; i <= n; i++) add(rn.x0 + ((rn.x1 - rn.x0) * i) / (n + 1), rn.y0 + ((rn.y1 - rn.y0) * i) / (n + 1), out);
      }
      for (const [x, y, out] of spots) {
        let near = false;
        for (let j = -1; j <= 0 && !near; j++) for (let i = -1; i <= 0; i++) if (seenCell(Math.floor(x) + i, Math.floor(y) + j)) { near = true; break; }
        if (!near) continue;
        const px = CX(x) - out[0] * cityOff;
        const py = CY(y) - out[1] * cityOff;
        const R = cityW * 1.12;
        // a corner tower faces both ways
        const corner = (x <= 0 || x >= map.w) && (y <= 0 || y >= map.h);
        const o2 = corner ? [x <= 0 ? -1 : 1, y <= 0 ? -1 : 1] : out;
        tower(ig, px, py, R, { seed: (x * 17 + y * 31) | 0, out: o2 });
        wallRects.push([px - R, py - R, R * 2, R * 2]);
      }
    }
  }
  g.drawImage(inkL, 0, 0, W, H);

  // ---------- markers ----------
  const markerSpots = [];
  const markers = [];
  for (const ev of map.events) {
    if (!walkedCell(ev.x, ev.y)) continue;
    const mk2 = eventMarker(ev, !!spent[ev.id]);
    if (!mk2) continue;
    const same = map.events.filter((e) => e.x === ev.x && e.y === ev.y && eventMarker(e, !!spent[e.id]));
    const idx = same.indexOf(ev);
    const off = same.length > 1 ? (idx - (same.length - 1) / 2) * cs * 0.32 : 0;
    const mxp = CX(ev.x) + cs / 2 + off;
    const myp = CY(ev.y) + cs / 2;
    // inked live by the viewer at a fixed screen size (see AutomapScene)
    markers.push({ kind: mk2, x: mxp, y: myp, seed: ev.x * 31 + ev.y });
    markerSpots.push([mxp - cs * 0.22, myp - cs * 0.22, cs * 0.44, cs * 0.44]);
  }
  // exits: arrows in the margin + destination names
  const exitSpans = [];
  g.save();
  g.textBaseline = 'middle';
  for (const t of info.travel) {
    const { x, y, facing } = t.at;
    if (!seenCell(x, y)) continue;
    const X = CX(x) + cs / 2;
    const Y = CY(y) + cs / 2;
    if (t.edge) {
      const ang = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 }[facing];
      const [ox, oy] = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[facing];
      const ax = X + ox * cs * 0.95;
      const ay = Y + oy * cs * 0.95;
      drawMarker(g, 'exit', ax, ay, cs * 0.5, { angle: ang, accent: INK.vermilion });
      g.font = `italic ${Math.round(cs * 0.3)}px ${SERIF}`;
      const label = `to ${t.destName}`;
      {
        // keep the margin's ruled numbers clear of this label and its arrow
        const half = g.measureText(label).width / 2 + cs * 0.15;
        const c = facing === 'N' || facing === 'S' ? ax : ay;
        exitSpans.push({ side: facing, a: Math.min(c - half, c - cs * 0.4), b: Math.max(c + half, c + cs * 0.4) });
      }
      if (facing === 'N' || facing === 'S') {
        g.textAlign = 'center';
        haloText(g, label, ax, ay + oy * cs * 0.42, { width: 3, color: '#3b2210' });
      } else {
        g.save();
        g.translate(ax + ox * cs * 0.22, ay);
        g.rotate(facing === 'E' ? Math.PI / 2 : -Math.PI / 2);
        g.textAlign = 'center';
        haloText(g, label, 0, -cs * 0.14, { width: 3, color: '#3b2210' });
        g.restore();
      }
    } else {
      const glyph = t.art === 'docks' || t.art === 'keep' ? 'boat' : 'stairs';
      drawMarker(g, glyph, X, Y, cs * 0.5, { color: INK.ink });
      markerSpots.push([X - cs * 0.25, Y - cs * 0.25, cs * 0.5, cs * 0.75]);
      g.font = `italic ${Math.round(cs * 0.27)}px ${SERIF}`;
      g.textAlign = 'center';
      haloText(g, t.destName, X, Y + cs * 0.52, { width: 3, color: '#3b2210' });
    }
  }
  g.restore();

  // ---------- zone names: placed live by the viewer (see AutomapScene), recorded here ----------
  const labels = [];
  for (const z of map.zones) {
    let any = false;
    for (let y = z.y; y < z.y + z.h && !any; y++) for (let x = z.x; x < z.x + z.w; x++) if (seenCell(x, y)) { any = true; break; }
    if (!any) continue;
    labels.push({ name: z.name, x: z.x, y: z.y, w: z.w, h: z.h });
  }
  if (zoneLabels) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const z of labels) {
      const fs = Math.min(cs * 0.34, Math.max(cs * 0.22, (z.w * cs * 0.92) / 7));
      g.font = `italic ${Math.round(fs)}px ${SERIF}`;
      const lines = wrapText(g, z.name, Math.max(z.w * cs * 0.92, cs * 1.8));
      const cx = CX(z.x + z.w / 2);
      const cy = CY(z.y + z.h / 2) - ((lines.length - 1) * fs * 1.05) / 2;
      lines.forEach((l, i) => haloText(g, l, cx, cy + i * fs * 1.05, { color: '#3b2210', width: fs * 0.3 }));
    }
    g.restore();
  }

  // ---------- terra incognita: only on a sheet barely begun (under a tenth surveyed) ----------
  {
    let tot = 0;
    let got = 0;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (info.isRock(x, y)) continue;
      tot++;
      if (walkedCell(x, y)) got++;
    }
    let best = null;
    // never over anything charted, nor within two squares of the party
    const unseen = (x, y) => !nearSeen(x, y) && !info.isRock(x, y) && !(party && Math.abs(x - party.x) <= 2 && Math.abs(y - party.y) <= 2);
    if (tot && got / tot < 0.1) {
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        for (let h2 = 1; y + h2 <= map.h; h2++) {
          let w2 = 0;
          for (; x + w2 < map.w; w2++) {
            let col = true;
            for (let j = y; j < y + h2; j++) if (!unseen(x + w2, j)) { col = false; break; }
            if (!col) break;
          }
          if (w2 === 0) break;
          if (w2 >= 5 && h2 >= 3 && (!best || w2 * h2 > best.w * best.h)) best = { x, y, w: w2, h: h2 };
        }
      }
    }
    if (best && best.w * best.h >= 15) {
      g.save();
      g.translate(CX(best.x + best.w / 2), CY(best.y + best.h / 2));
      g.rotate(-0.04);
      const fs = Math.min(cs * 0.8, (best.w * cs) / 6.6, (best.h * cs) / 2.4);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `italic ${Math.round(fs)}px ${SERIF}`;
      g.letterSpacing = `${(fs * 0.1).toFixed(1)}px`;
      haloText(g, 'Terra Incognita', 0, -fs * 0.35, { color: 'rgba(70,44,22,0.88)', halo: 'rgba(214,198,166,0.5)', width: fs * 0.2 });
      g.letterSpacing = '1px';
      g.font = `italic ${Math.round(fs * 0.38)}px ${SERIF}`;
      haloText(g, 'not yet walked by the Company', 0, fs * 0.42, { color: 'rgba(70,44,22,0.85)', halo: 'rgba(214,198,166,0.5)', width: 2 });
      // the flourish sits clear below the subtitle, never through it
      drawFlourish(g, 0, fs * 1.18, Math.min(best.w * cs * 0.5, fs * 4), { color: 'rgba(74,52,30,0.6)', width: 1 });
      g.restore();
    }
  }

  // ---------- border with coordinate ruler ----------
  g.save();
  g.strokeStyle = INK.ink;
  g.lineWidth = 2.6;
  g.strokeRect(MX - 22, MY - 22, MS + 44, MS + 44);
  g.lineWidth = 0.8;
  g.strokeRect(MX - 16, MY - 16, MS + 32, MS + 32);
  g.strokeRect(MX - 27, MY - 27, MS + 54, MS + 54);
  // alternating ruler bars between the rules
  for (let i = 0; i < map.w; i++) {
    g.fillStyle = i % 2 ? 'rgba(168,50,40,0.85)' : 'rgba(44,74,140,0.85)';
    g.fillRect(CX(i), MY - 22, cs, 6);
    g.fillRect(CX(i), MY + MS + 16, cs, 6);
    g.fillRect(MX - 22, CY(i), 6, cs);
    g.fillRect(MX + MS + 16, CY(i), 6, cs);
    g.fillStyle = INK.goldHi;
    for (const [px, py] of [[CX(i), MY - 19], [CX(i), MY + MS + 19], [MX - 19, CY(i)], [MX + MS + 19, CY(i)]]) {
      g.beginPath(); g.arc(px, py, 1.6, 0, Math.PI * 2); g.fill();
    }
  }
  g.font = `italic ${Math.round(cs * 0.28)}px ${SERIF}`;
  g.fillStyle = '#7a2a1c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const clearOf = (side, c) => !exitSpans.some((e) => e.side === side && c > e.a && c < e.b);
  for (let i = 0; i < map.w; i++) {
    if (clearOf('N', CX(i) + cs / 2)) g.fillText(String(i), CX(i) + cs / 2, MY - 40);
    if (clearOf('W', CY(i) + cs / 2)) g.fillText(String(i), MX - 42, CY(i) + cs / 2);
  }
  // corner rosettes
  for (const [px, py] of [[MX - 22, MY - 22], [MX + MS + 22, MY - 22], [MX - 22, MY + MS + 22], [MX + MS + 22, MY + MS + 22]]) {
    g.fillStyle = goldGradient(g, px - 8, py - 8, px + 8, py + 8);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 4 : 9;
      if (i === 0) g.moveTo(px + Math.cos(a) * r, py + Math.sin(a) * r); else g.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.lineWidth = 1;
    g.stroke();
  }
  g.restore();

  // ---------- right column: cartouche, compass, key ----------
  const RX = MX + MS + 58;
  const RW = W - RX - 36;
  drawCartouche(g, RX, 44, RW, 262);
  const main = map.name.replace(/^The\s+/i, '');
  drawIlluminatedInitial(g, main[0].toUpperCase(), RX + RW / 2 - 43, 66, 86, { seed });
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = INK.ink;
  const title = map.name.toUpperCase();
  g.letterSpacing = '3px';
  const fs = fitFont(g, title, RW - 50, 30, 'bold');
  const tl = fs < 20 ? wrapText(g, title, RW - 50) : [title];
  let ty = 186;
  if (tl.length > 1) {
    fitFont(g, tl.reduce((a, b) => (a.length > b.length ? a : b)), RW - 50, 26, 'bold');
    ty = 176;
  }
  tl.forEach((l, i) => g.fillText(l, RX + RW / 2, ty + i * 28));
  g.letterSpacing = '0px';
  g.font = `italic 17px ${SERIF}`;
  g.fillStyle = '#5a3a1c';
  g.fillText(subtitle, RX + RW / 2, 238);
  drawFlourish(g, RX + RW / 2, 262, RW * 0.6, { color: '#5a3a1c' });
  g.restore();

  drawCompassRose(g, RX + RW / 2, 428, 92);

  // key: few entries, lettered large enough to read at a glance
  const KY = 560;
  g.save();
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = INK.ink;
  g.font = `bold 21px ${SERIF}`;
  g.letterSpacing = '6px';
  g.fillText('KEY', RX + RW / 2 + 3, KY);
  g.letterSpacing = '0px';
  drawFlourish(g, RX + RW / 2, KY + 18, RW * 0.5, { color: '#5a3a1c', width: 1 });
  const rows = [
    ['wall', 'Stone wall'], ['timber', 'Timber'], ['city', 'City wall'], ['door', 'Door'], ['locked', 'Locked'], ['secret', 'Secret door'],
    ['arch', 'Archway'], ['exit', 'Way out'], ['sign', 'Inscription'], ['battle', 'Battle won'], ['treasure', 'Treasure'], ['rock', 'Solid rock'],
  ];
  const rowH = 36;
  rows.forEach(([key, label], i) => {
    const col = i < 6 ? 0 : 1;
    const row = col ? i - 6 : i;
    // a fixed glyph column (clipped, so no swatch ever reaches its label) and a fixed gutter
    const x = RX - 4 + col * (RW / 2 + 8);
    const y = KY + 50 + row * rowH;
    const GW = 46;
    g.save();
    g.beginPath();
    g.rect(x, y - rowH / 2, GW, rowH);
    g.clip();
    drawKeySwatch(g, key, x + GW / 2, y, 34);
    g.restore();
    g.font = `19px ${SERIF}`;
    g.textAlign = 'left';
    g.fillStyle = '#2e1b0d';
    g.fillText(label, x + GW + 9, y + 1);
  });
  // scale bar
  const sy = KY + 50 + 6 * rowH + 16;
  g.strokeStyle = INK.ink;
  g.lineWidth = 1;
  const bx = RX + RW / 2 - cs * 2;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#efe0bb' : INK.ink;
    g.fillRect(bx + i * cs, sy, cs, 7);
    g.strokeRect(bx + i * cs, sy, cs, 7);
  }
  g.fillStyle = '#2e1b0d';
  g.font = `18px ${SERIF}`;
  g.textAlign = 'center';
  ['0', '10', '20', '30', '40'].forEach((t, i) => g.fillText(t, bx + i * cs, sy - 12));
  g.font = `italic 18px ${SERIF}`;
  g.fillText('paces · a square is ten', RX + RW / 2, sy + 26);
  g.restore();

  g.restore();
  return { canvas, k, cs, info, seenCell, fog: fogCov, fogArea, wallRects, cellRect: (x, y) => [M + CX(x), M + CY(y), cs, cs], seed, labels, markerSpots, markers, regions: reg, furniture };
}

/** Small legend swatch drawn in sheet units. */
export function drawKeySwatch(g, key, x, y, s) {
  const h = s / 2;
  g.save();
  g.strokeStyle = INK.ink;
  g.fillStyle = INK.ink;
  const wall = (a, b) => stoneWall(g, x - h + a * s, y, x - h + b * s, y, { width: s * 0.26, seed: 3 + a * 7, faceW: 1, poche: true });
  switch (key) {
    case 'wall': wall(0, 1); break;
    case 'city':
      cityWall(g, x - h, y + s * 0.08, x + h * 0.4, y + s * 0.08, { width: s * 0.34, seed: 5, out: [0, 1] });
      tower(g, x + h * 0.45, y + s * 0.08, s * 0.3, { seed: 2, out: [1, 1] });
      break;
    case 'timber': timberWall(g, x - h, y, x + h, y, { width: s * 0.22, seed: 4, cs: s * 1.3, heavy: true }); break;
    case 'door':
      wall(0, 0.22); wall(0.78, 1);
      doorLeaf(g, x - s * 0.28, y, -Math.PI * 0.4, 0, s * 0.56, s * 0.1);
      break;
    case 'locked':
      wall(0, 0.22); wall(0.78, 1);
      lockedDoor(g, x, y, true, s * 0.58, s * 0.17, -1);
      break;
    case 'secret':
      wall(0, 0.18); wall(0.82, 1);
      secretDoor(g, x - s * 0.32, y + s * 0.12, x + s * 0.32, y + s * 0.12, { width: s * 0.2, cs: s * 0.7, side: [0, -0.62], seed: 3 });
      break;
    case 'arch': {
      wall(0, 0.18); wall(0.82, 1);
      for (const sx of [-1, 1]) stoneWall(g, x + sx * s * 0.27 - s * 0.1, y, x + sx * s * 0.27 + s * 0.1, y, { width: s * 0.34, seed: 6 + sx, faceW: 0.8, poche: true });
      g.setLineDash([2, 2]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - s * 0.14, y); g.lineTo(x + s * 0.14, y); g.stroke();
      g.setLineDash([]);
      break;
    }
    case 'rock': {
      g.fillStyle = 'rgba(120,100,80,0.25)';
      g.fillRect(x - h, y - h * 0.7, s, s * 0.7);
      hatchRect(g, x - h, y - h * 0.7, s, s * 0.7, { seed: 5, size: s * 0.35, width: 0.8, color: '#3a2716' });
      break;
    }
    default:
      drawMarker(g, key, x, y, s * 0.8, { color: INK.ink, angle: key === 'exit' ? Math.PI / 2 : 0 });
  }
  g.restore();
}
