import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { TRAVEL } from '../../data/travel.js';
import { INK, makeCanvas, makeParchment, quillStroke, planWall, pencilShade, hatchRect, lineShade, stipple, featherMask, prng } from './ink.js';
import { regions, washRegion, hatchBand, cobbleRegion, scatter, deckleMask } from './paint.js';
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
export const SHEET = { W: 1300, H: 1000, M: 40, MX: 78, MY: 78, MS: 844 };

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
export function buildBlockSheet(map, { k = 2, seen, secrets, spent, inkWalls = true, zoneLabels = false, subtitle = 'Phlan, upon the Moonsea' }) {
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
  const seenCell = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && seen(x, y);
  const wild = map.tileset === 'wilderness' || map.tileset === 'graveyard';
  const dungeon = map.tileset === 'dungeon' || map.kind === 'dungeon';

  // ---------- pencil survey grid (everywhere) ----------
  g.save();
  g.strokeStyle = 'rgba(90,75,55,0.16)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (let i = 0; i <= map.w; i++) { g.moveTo(CX(i), MY); g.lineTo(CX(i), MY + MS); }
  for (let j = 0; j <= map.h; j++) { g.moveTo(MX, CY(j)); g.lineTo(MX + MS, CY(j)); }
  g.stroke();
  g.restore();

  // ---------- fog mask (explored cells, feathered then deckled) ----------
  const mk = 1; // mask resolution (px per unit)
  const rects = [];
  const nearSeen = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (seenCell(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (seenCell(x, y) || (info.isRock(x, y) && nearSeen(x, y))) rects.push([CX(x) * mk, CY(y) * mk, cs * mk, cs * mk]);
  }
  const soft = featherMask(W * mk, H * mk, rects, { blur: cs * mk * 0.2, grow: cs * mk * 0.16 });
  const { mask, edge: tideLine } = deckleMask(soft, { seed: seed + 5, scale: cs * mk * 0.45, amount: 0.6 });

  // unexplored tone: a faint sepia wash + graphite hatching everywhere the ink hasn't reached
  const fog = makeCanvas(W * k, H * k);
  {
    const f = fog.getContext('2d');
    f.scale(k, k);
    // the unknown stays cool grey pencil; the survey is warm ink and wash
    f.fillStyle = 'rgba(78,72,66,0.2)';
    f.fillRect(MX, MY, MS, MS);
    pencilShade(f, MX, MY, MS, MS, { gap: 5.2, angle: -Math.PI / 3.2, color: '#3c3a3c', width: 0.55, alpha: 0.32, seed: seed + 21 });
    pencilShade(f, MX, MY, MS, MS, { gap: 12, angle: Math.PI / 3.4, color: '#3c3a3c', width: 0.45, alpha: 0.14, seed: seed + 22 });
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'destination-out';
    f.imageSmoothingEnabled = true;
    f.drawImage(mask, 0, 0, W * k, H * k);
  }
  g.drawImage(fog, 0, 0, W, H);

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
        washRegion(w, rg.cells, { ...P, color: jit(base, 0.5, 0.22), alpha: 0.48 + rr() * 0.16, seed: rs, edge: 0.55 + rr() * 0.2, blooms: rr() < 0.6 ? 1 : 0, mottle: 0.18 + rr() * 0.14, gran: 0.22 + rr() * 0.15, glaze: 0.35 + rr() * 0.35, second: SECOND[Math.floor(rr() * SECOND.length)] });
        hatchBand(w, rg.cells, { ...P, seed: rs + 1, angle: 0.5 + rr() * 0.7, band: 0.22 + rr() * 0.14, alpha: 0.3 + rr() * 0.15, color: '#4a1e12' });
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
    // texture: drawn setts on plazas, grit on the streets, broken masonry in rubble, ripples on water
    for (const rg of reg.list) {
      if (rg.type === CELL.COURTYARD) cobbleRegion(w, rg.cells, { ...P, seed: seed + rg.index * 17 });
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
  // dried tide line where the survey's wash meets bare paper
  g.drawImage(tideLine, 0, 0, W, H);

  // ---------- walls: a surveyor's drafted plan on its own ink layer ----------
  const wallW = cs * 0.13;
  const { segs: cellSegs, effective } = collectEdges(map, info, seenCell, secrets);
  const segs = cellSegs.map((q) => ({ ...q, x0: CX(q.x0), y0: CY(q.y0), x1: CX(q.x1), y1: CY(q.y1) }));
  const exitAt = new Set(info.travel.filter((t) => t.edge).map((t) => `${t.at.x},${t.at.y},${t.at.facing}`));
  const ruin = (q) => q.style === 2 && !dungeon;
  const border = (q) => !dungeon && !wild && ((q.horiz && (q.cell[1] === 0 && q.cell[2] === 'N' || q.cell[1] === map.h - 1 && q.cell[2] === 'S')) || (!q.horiz && (q.cell[0] === 0 && q.cell[2] === 'W' || q.cell[0] === map.w - 1 && q.cell[2] === 'E')));
  const runs = mergeRuns(segs.filter((q) => effective(q) === EDGE.WALL && !ruin(q)));
  const inkL = makeCanvas(W * k, H * k);
  const ig = inkL.getContext('2d');
  ig.scale(k, k);
  const outward = (q) => (q.horiz ? [0, q.cell[2] === 'N' ? -1 : 1] : [q.cell[2] === 'W' ? -1 : 1, 0]);
  /** a broken stone, outlined, for ruins and rubble spill */
  const chunk = (x, y, rad, rr) => {
    ig.beginPath();
    const n = 4 + Math.floor(rr() * 3);
    const rot = rr() * 6;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const q = rad * (0.7 + rr() * 0.5);
      if (i === 0) ig.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q * 0.8); else ig.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q * 0.8);
    }
    ig.closePath();
    ig.fillStyle = 'rgba(214,196,160,0.9)';
    ig.fill();
    ig.strokeStyle = INK.ink;
    ig.lineWidth = 0.6;
    ig.stroke();
  };
  if (inkWalls) {
    for (const rn of runs) {
      const city = border(rn);
      const timber = rn.style === 1 && !city && !dungeon;
      const width = wallW * (city ? 1.55 : timber ? 0.72 : 1);
      const ext = width * 0.5;
      const dx = rn.horiz ? ext : 0;
      const dy = rn.horiz ? 0 : ext;
      const sd = (rn.x0 * 7 + rn.y0 * 13) | 0;
      planWall(ig, rn.x0 - dx, rn.y0 - dy, rn.x1 + dx, rn.y1 + dy, { width, seed: sd, amp: cs * 0.012, dry: timber ? 0.2 : 0.45, fill: timber ? 0.55 : 0.82, over: city ? 0.6 : 1 });
      const rr = prng(sd + 9);
      const len = Math.hypot(rn.x1 - rn.x0, rn.y1 - rn.y0);
      const ux = (rn.x1 - rn.x0) / len;
      const uy = (rn.y1 - rn.y0) / len;
      if (timber) {
        // timber framing: square posts along the run
        ig.fillStyle = INK.ink;
        const n = Math.max(1, Math.round(len / cs));
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * len;
          const ps = width * (1.12 + rr() * 0.15);
          ig.globalAlpha = 0.9;
          ig.fillRect(rn.x0 + ux * t - ps / 2, rn.y0 + uy * t - ps / 2, ps, ps);
        }
        ig.globalAlpha = 1;
      }
      if (city) {
        // the city wall: a finer rule on the inner face, merlons on the outer
        const [ox, oy] = outward(rn);
        const io = -width * 1.05;
        quillStroke(ig, rn.x0 - dx + ox * io, rn.y0 - dy + oy * io, rn.x1 + dx + ox * io, rn.y1 + dy + oy * io, { width: wallW * 0.22, amp: cs * 0.01, seed: sd + 3, pool: 0, taper: 0.5 });
        ig.fillStyle = INK.ink;
        const n = Math.floor(len / (cs * 0.32));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) * (len / n);
          const mw = cs * 0.09;
          const md = width * 0.42;
          const cx = rn.x0 + ux * t + ox * (width * 0.5 + md * 0.5);
          const cy = rn.y0 + uy * t + oy * (width * 0.5 + md * 0.5);
          ig.globalAlpha = 0.78 + rr() * 0.2;
          ig.fillRect(cx - (rn.horiz ? mw : md) / 2, cy - (rn.horiz ? md : mw) / 2, rn.horiz ? mw : md, rn.horiz ? md : mw);
        }
        ig.globalAlpha = 1;
      }
    }
    // crumbling ruin walls: broken lengths with ragged ends and spilled masonry
    for (const sg of segs.filter((q) => effective(q) === EDGE.WALL && ruin(q))) {
      const r = prng((sg.x0 * 3 + sg.y0 * 7) | 0);
      const n = 1 + Math.floor(r() * 3);
      const [ox, oy] = outward(sg);
      for (let i = 0; i < n; i++) {
        const t0 = i / n + r() * 0.1;
        const t1 = (i + 1) / n - 0.1 - r() * 0.15;
        if (t1 - t0 < 0.12) continue;
        planWall(ig, sg.x0 + (sg.x1 - sg.x0) * t0, sg.y0 + (sg.y1 - sg.y0) * t0, sg.x0 + (sg.x1 - sg.x0) * t1, sg.y0 + (sg.y1 - sg.y0) * t1, { width: wallW * (0.7 + r() * 0.3), seed: i + sg.x0 * 3 + sg.y0, dry: 0.9, fill: 0.62, over: 0.4, amp: 0.6 });
      }
      for (let i = 0; i < 4; i++) {
        const t = 0.1 + r() * 0.8;
        const side = (r() < 0.5 ? -1 : 1) * (wallW * 0.8 + r() * cs * 0.12);
        chunk(sg.x0 + (sg.x1 - sg.x0) * t + ox * side, sg.y0 + (sg.y1 - sg.y0) * t + oy * side, cs * (0.025 + r() * 0.035), r);
      }
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
      const timber = sg.style === 1 && !dungeon;
      const ww = wallW * (timber ? 0.72 : 1);
      const P = (a) => [sg.x0 + (sg.x1 - sg.x0) * a, sg.y0 + (sg.y1 - sg.y0) * a];
      const piece = (a, b2, o = {}) => {
        const [ax, ay] = P(a);
        const [bx, by] = P(b2);
        planWall(ig, ax, ay, bx, by, { width: ww, seed: sd + a * 10, amp: cs * 0.01, dry: 0.3, fill: timber ? 0.55 : 0.82, ...o });
      };
      if (t === EDGE.SECRET) {
        // the wall in broken dashes, and a vermilion S
        for (let i = 0; i < 5; i++) piece(i / 5 + 0.03, (i + 0.6) / 5, { width: ww * 0.8, faces: false, dry: 0 });
        ig.save();
        ig.font = `italic bold ${Math.round(cs * 0.42)}px ${SERIF}`;
        ig.textAlign = 'center';
        ig.textBaseline = 'middle';
        ig.fillStyle = INK.vermilion;
        ig.fillText('S', mx + (sg.horiz ? 0 : cs * 0.22), my + (sg.horiz ? -cs * 0.2 : 0));
        ig.restore();
        continue;
      }
      piece(-ww * 0.5 / cs, 0.5 - gap / cs, { over: 0.5 });
      piece(0.5 + gap / cs, 1 + ww * 0.5 / cs, { over: 0.5 });
      // jambs: short pen strokes across the opening's ends
      const jl = ww * 0.95;
      ig.save();
      ig.strokeStyle = INK.ink;
      ig.lineWidth = 1.1;
      ig.lineCap = 'round';
      for (const sgn of [-1, 1]) {
        const jx = mx + along[0] * gap * sgn;
        const jy = my + along[1] * gap * sgn;
        ig.beginPath(); ig.moveTo(jx - along[1] * jl, jy - along[0] * jl); ig.lineTo(jx + along[1] * jl, jy + along[0] * jl); ig.stroke();
      }
      ig.restore();
      if (t === EDGE.ARCH) {
        const out = exitAt.has(sg.cell.join(','));
        ig.save();
        ig.fillStyle = INK.ink;
        for (const sgn of [-1, 1]) {
          const px = mx + along[0] * gap * sgn;
          const py = my + along[1] * gap * sgn;
          const ps = ww * 1.9;
          ig.globalAlpha = 0.9;
          ig.fillRect(px - ps / 2, py - ps / 2, ps, ps);
        }
        ig.globalAlpha = 1;
        ig.strokeStyle = out ? INK.vermilion : INK.ink;
        ig.lineWidth = 0.9;
        ig.setLineDash([2.2, 2.4]);
        ig.beginPath();
        ig.moveTo(mx - along[0] * gap, my - along[1] * gap);
        ig.lineTo(mx + along[0] * gap, my + along[1] * gap);
        ig.stroke();
        ig.restore();
      } else {
        // a plan door: the leaf hung from one jamb, swung open over a pencilled arc;
        // locked doors are drawn shut, washed vermilion, with a gilt lock
        const [ox, oy] = sg.horiz ? [0, sg.cell[2] === 'N' ? 1 : -1] : [sg.cell[2] === 'W' ? 1 : -1, 0];
        const hx = mx - along[0] * gap;
        const hy = my - along[1] * gap;
        const L = gap * 2;
        const lt = Math.max(1.8, ww * 0.7);
        ig.save();
        if (t === EDGE.LOCKED) {
          ig.translate(mx, my);
          if (!sg.horiz) ig.rotate(Math.PI / 2);
          ig.fillStyle = 'rgba(168,52,32,0.92)';
          ig.fillRect(-L / 2, -lt * 0.9, L, lt * 1.8);
          ig.strokeStyle = INK.ink;
          ig.lineWidth = 0.8;
          ig.strokeRect(-L / 2, -lt * 0.9, L, lt * 1.8);
          ig.fillStyle = INK.goldHi;
          ig.beginPath(); ig.arc(0, 0, lt * 1.15, 0, Math.PI * 2); ig.fill();
          ig.lineWidth = 0.7;
          ig.stroke();
          ig.fillStyle = INK.ink;
          ig.beginPath(); ig.arc(0, -lt * 0.25, lt * 0.32, 0, Math.PI * 2); ig.fill();
          ig.fillRect(-lt * 0.13, -lt * 0.2, lt * 0.26, lt * 0.65);
        } else {
          const a0 = Math.atan2(along[1], along[0]);
          const a1 = Math.atan2(oy, ox);
          let da = a1 - a0;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const open = a0 + da * 0.82;
          // swing arc
          ig.strokeStyle = 'rgba(43,26,13,0.7)';
          ig.lineWidth = 0.7;
          ig.setLineDash([2.2, 1.8]);
          ig.beginPath();
          ig.arc(hx, hy, L, Math.min(a0, a0 + da * 0.82), Math.max(a0, a0 + da * 0.82));
          ig.stroke();
          ig.setLineDash([]);
          // leaf: oak, washed and ruled
          ig.translate(hx, hy);
          ig.rotate(open);
          ig.fillStyle = 'rgba(176,118,58,0.92)';
          ig.fillRect(0, -lt / 2, L, lt);
          ig.strokeStyle = INK.ink;
          ig.lineWidth = 0.8;
          ig.strokeRect(0, -lt / 2, L, lt);
          ig.fillStyle = INK.ink;
          ig.beginPath(); ig.arc(0, 0, lt * 0.55, 0, Math.PI * 2); ig.fill();
        }
        ig.restore();
      }
    }
  }
  g.drawImage(inkL, 0, 0, W, H);

  // ---------- markers ----------
  const markerSpots = [];
  for (const ev of map.events) {
    if (!seenCell(ev.x, ev.y)) continue;
    const mk2 = eventMarker(ev, !!spent[ev.id]);
    if (!mk2) continue;
    const same = map.events.filter((e) => e.x === ev.x && e.y === ev.y && eventMarker(e, !!spent[e.id]));
    const idx = same.indexOf(ev);
    const off = same.length > 1 ? (idx - (same.length - 1) / 2) * cs * 0.32 : 0;
    const mxp = CX(ev.x) + cs / 2 + off;
    const myp = CY(ev.y) + cs / 2;
    drawMarker(g, mk2, mxp, myp, cs * 0.42, { color: INK.ink, seed: ev.x * 31 + ev.y });
    markerSpots.push([mxp - cs * 0.22, myp - cs * 0.22, cs * 0.44, cs * 0.44]);
  }
  // exits: arrows in the margin + destination names
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

  // ---------- terra incognita: label the largest unexplored tract ----------
  {
    let best = null;
    const unseen = (x, y) => !seenCell(x, y) && !info.isRock(x, y);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      for (let h2 = 1; y + h2 <= map.h; h2++) {
        let w2 = 0;
        for (; x + w2 < map.w; w2++) {
          let col = true;
          for (let j = y; j < y + h2; j++) if (!unseen(x + w2, j)) { col = false; break; }
          if (!col) break;
        }
        if (w2 === 0) break;
        if (w2 >= 4 && h2 >= 2 && (!best || w2 * h2 > best.w * best.h)) best = { x, y, w: w2, h: h2 };
      }
    }
    if (best && best.w * best.h >= 10) {
      g.save();
      g.translate(CX(best.x + best.w / 2), CY(best.y + best.h / 2));
      g.rotate(-0.05);
      const fs = Math.min(cs * 0.85, (best.w * cs) / 6.2);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `italic ${Math.round(fs)}px ${SERIF}`;
      g.letterSpacing = `${(fs * 0.1).toFixed(1)}px`;
      haloText(g, 'Terra Incognita', 0, -fs * 0.1, { color: 'rgba(74,44,20,0.8)', halo: 'rgba(236,222,186,0.6)', width: fs * 0.25 });
      g.letterSpacing = '1px';
      drawFlourish(g, 0, fs * 0.58, Math.min(best.w * cs * 0.6, fs * 6), { color: 'rgba(74,44,20,0.7)', width: 1.1 });
      if (best.h >= 3) {
        g.font = `italic ${Math.round(fs * 0.4)}px ${SERIF}`;
        haloText(g, 'not yet walked by the Company', 0, fs * 1.3, { color: 'rgba(74,44,20,0.75)', width: 2 });
      }
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
  for (let i = 0; i < map.w; i++) {
    g.fillText(String(i), CX(i) + cs / 2, MY - 40);
    g.fillText(String(i), MX - 42, CY(i) + cs / 2);
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

  drawCompassRose(g, RX + RW / 2, 450, 104);

  // key
  const KY = 600;
  g.save();
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = INK.ink;
  g.font = `bold 17px ${SERIF}`;
  g.letterSpacing = '5px';
  g.fillText('KEY', RX + RW / 2, KY);
  g.letterSpacing = '0px';
  drawFlourish(g, RX + RW / 2, KY + 16, RW * 0.5, { color: '#5a3a1c', width: 1 });
  const rows = [
    ['wall', 'Wall'], ['door', 'Door'], ['locked', 'Locked door'], ['secret', 'Secret door (found)'], ['arch', 'Archway / gate'],
    ['exit', 'Way out'], ['sign', 'Inscription'], ['text', 'Writing'], ['battle', 'Battle won'], ['treasure', 'Treasure taken'], ['rock', 'Solid rock'],
  ];
  const rowH = 27;
  rows.forEach(([key, label], i) => {
    const col = i < 6 ? 0 : 1;
    const row = col ? i - 6 : i;
    const x = RX + 10 + col * (RW / 2);
    const y = KY + 44 + row * rowH;
    drawKeySwatch(g, key, x + 16, y, 26);
    g.font = `italic 14px ${SERIF}`;
    g.textAlign = 'left';
    g.fillStyle = '#3b2412';
    const lines = wrapText(g, label, RW / 2 - 44);
    lines.forEach((l, j) => g.fillText(l, x + 34, y + (j - (lines.length - 1) / 2) * 14));
  });
  // scale bar
  const sy = KY + 44 + 6 * rowH + 18;
  g.strokeStyle = INK.ink;
  g.lineWidth = 1;
  const bx = RX + RW / 2 - cs * 2;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#efe0bb' : INK.ink;
    g.fillRect(bx + i * cs, sy, cs, 6);
    g.strokeRect(bx + i * cs, sy, cs, 6);
  }
  g.fillStyle = '#3b2412';
  g.font = `italic 13px ${SERIF}`;
  g.textAlign = 'center';
  ['0', '10', '20', '30', '40'].forEach((t, i) => g.fillText(t, bx + i * cs, sy - 9));
  g.fillText('paces  (one square, ten paces)', RX + RW / 2, sy + 20);
  g.restore();

  g.restore();
  const wallRects = segs.filter((q) => effective(q) !== EDGE.OPEN).map((q) => [Math.min(q.x0, q.x1) - wallW, Math.min(q.y0, q.y1) - wallW, Math.abs(q.x1 - q.x0) + wallW * 2, Math.abs(q.y1 - q.y0) + wallW * 2]);
  return { canvas, k, cs, info, seenCell, wallRects, cellRect: (x, y) => [M + CX(x), M + CY(y), cs, cs], seed, labels, markerSpots, regions: reg };
}

/** Small legend swatch drawn in sheet units. */
export function drawKeySwatch(g, key, x, y, s) {
  const h = s / 2;
  g.save();
  g.strokeStyle = INK.ink;
  g.fillStyle = INK.ink;
  const wall = (a, b) => planWall(g, x - h + a * s, y, x - h + b * s, y, { width: s * 0.17, amp: 0.25, seed: 3 + a * 7, dry: 0, over: 0.4 });
  switch (key) {
    case 'wall': wall(0, 1); break;
    case 'door':
    case 'locked': {
      wall(0, 0.25); wall(0.75, 1);
      if (key === 'locked') {
        g.fillStyle = 'rgba(168,52,32,0.92)';
        g.fillRect(x - s * 0.25, y - s * 0.07, s * 0.5, s * 0.14);
        g.lineWidth = 0.8; g.strokeRect(x - s * 0.25, y - s * 0.07, s * 0.5, s * 0.14);
        g.fillStyle = INK.goldHi; g.beginPath(); g.arc(x, y, s * 0.09, 0, Math.PI * 2); g.fill(); g.stroke();
      } else {
        g.save();
        g.strokeStyle = 'rgba(43,26,13,0.55)'; g.lineWidth = 0.6; g.setLineDash([1.5, 1.8]);
        g.beginPath(); g.arc(x - s * 0.25, y, s * 0.5, -Math.PI * 0.41, 0); g.stroke();
        g.setLineDash([]);
        g.translate(x - s * 0.25, y); g.rotate(-Math.PI * 0.41);
        g.fillStyle = 'rgba(176,118,58,0.92)'; g.fillRect(0, -s * 0.045, s * 0.5, s * 0.09);
        g.lineWidth = 0.8; g.strokeStyle = INK.ink; g.strokeRect(0, -s * 0.045, s * 0.5, s * 0.09);
        g.restore();
      }
      break;
    }
    case 'secret': {
      g.setLineDash([s * 0.14, s * 0.09]);
      g.lineWidth = s * 0.1;
      g.beginPath(); g.moveTo(x - h, y + s * 0.12); g.lineTo(x + h, y + s * 0.12); g.stroke();
      g.setLineDash([]);
      g.font = `italic bold ${Math.round(s * 0.55)}px ${SERIF}`;
      g.textAlign = 'center';
      g.fillStyle = INK.vermilion;
      g.fillText('S', x, y - s * 0.1);
      break;
    }
    case 'arch': {
      wall(0, 0.25); wall(0.75, 1);
      g.fillRect(x - s * 0.33, y - s * 0.12, s * 0.2, s * 0.24);
      g.fillRect(x + s * 0.13, y - s * 0.12, s * 0.2, s * 0.24);
      g.setLineDash([2, 2]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - s * 0.16, y); g.lineTo(x + s * 0.16, y); g.stroke();
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
