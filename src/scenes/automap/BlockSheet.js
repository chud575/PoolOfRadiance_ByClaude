import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { TRAVEL } from '../../data/travel.js';
import { INK, makeCanvas, makeParchment, inkLine, hatchRect, lineShade, stipple, featherMask, prng } from './ink.js';
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

const WASH = {
  [CELL.STREET]: 'rgba(236,214,170,0.10)',
  [CELL.INTERIOR]: 'rgba(196,92,78,0.34)',
  [CELL.RUBBLE]: 'rgba(150,128,100,0.34)',
  [CELL.WATER]: 'rgba(70,120,170,0.55)',
  [CELL.COURTYARD]: 'rgba(150,160,150,0.34)',
};
const GREEN = 'rgba(120,150,80,0.36)';

/**
 * Build the sheet canvas.
 * @param {import('../../data/maps/MapGrid.js').MapGrid} map
 * @param {{k?:number, seen:(x:number,y:number)=>boolean, secrets:Set<string>, spent:Record<string,boolean>, inkWalls?:boolean, subtitle?:string}} o
 */
export function buildBlockSheet(map, { k = 2, seen, secrets, spent, inkWalls = true, subtitle = 'Phlan, upon the Moonsea' }) {
  const { W, H, M, MX, MY, MS } = SHEET;
  const info = analyseMap(map);
  const seed = [...map.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  const canvas = makeParchment((W + 2 * M) * k, (H + 2 * M) * k, { seed, margin: M * k, tone: [240, 224, 186] });
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

  // ---------- fog mask (explored cells, feathered) ----------
  const mk = 0.5; // mask resolution (px per unit)
  const rects = [];
  const nearSeen = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (seenCell(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (seenCell(x, y) || (info.isRock(x, y) && nearSeen(x, y))) rects.push([CX(x) * mk, CY(y) * mk, cs * mk, cs * mk]);
  }
  const mask = featherMask(W * mk, H * mk, rects, { blur: cs * mk * 0.22, grow: cs * mk * 0.2 });

  // unexplored tone: a faint sepia wash + graphite hatching everywhere the ink hasn't reached
  const fog = makeCanvas(W * k, H * k);
  {
    const f = fog.getContext('2d');
    f.scale(k, k);
    f.fillStyle = 'rgba(92,66,36,0.24)';
    f.fillRect(MX, MY, MS, MS);
    lineShade(f, MX, MY, MS, MS, { gap: 5.5, angle: -Math.PI / 3.2, color: '#4a3826', width: 0.55, alpha: 0.3 });
    lineShade(f, MX, MY, MS, MS, { gap: 11, angle: Math.PI / 3.2, color: '#4a3826', width: 0.45, alpha: 0.12 });
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'destination-out';
    f.imageSmoothingEnabled = true;
    f.drawImage(mask, 0, 0, W * k, H * k);
  }
  g.drawImage(fog, 0, 0, W, H);

  // ---------- washes (masked) ----------
  const wash = makeCanvas(W * k, H * k);
  {
    const w = wash.getContext('2d');
    w.scale(k, k);
    const r = prng(seed + 11);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const X = CX(x);
      const Y = CY(y);
      if (info.isRock(x, y)) {
        w.fillStyle = 'rgba(120,100,80,0.22)';
        w.fillRect(X, Y, cs, cs);
        hatchRect(w, X, Y, cs, cs, { seed: seed + y * 97 + x, size: cs * 0.36, width: 0.9, alpha: 0.62, color: '#3a2716' });
        continue;
      }
      const t = map.getCell(x, y);
      w.fillStyle = wild && t === CELL.STREET ? GREEN : (dungeon && t === CELL.INTERIOR ? 'rgba(200,170,120,0.28)' : WASH[t] ?? WASH[CELL.STREET]);
      w.fillRect(X - 0.3, Y - 0.3, cs + 0.6, cs + 0.6);
      if (t === CELL.STREET) {
        if (wild) {
          w.strokeStyle = 'rgba(70,90,40,0.5)';
          w.lineWidth = 0.9;
          for (let i = 0; i < 3; i++) {
            const px = X + cs * (0.15 + r() * 0.7);
            const py = Y + cs * (0.2 + r() * 0.7);
            w.beginPath();
            w.moveTo(px - 3, py); w.lineTo(px - 1, py - 5); w.moveTo(px, py); w.lineTo(px, py - 6); w.moveTo(px + 3, py); w.lineTo(px + 1, py - 5);
            w.stroke();
          }
        } else {
          // cobbles: tiny rounded stones
          w.strokeStyle = 'rgba(110,80,45,0.26)';
          w.lineWidth = 0.6;
          for (let i = 0; i < 7; i++) {
            const px = X + cs * (0.1 + r() * 0.8);
            const py = Y + cs * (0.1 + r() * 0.8);
            w.beginPath();
            w.ellipse(px, py, cs * 0.05, cs * 0.035, r() * 3, 0, Math.PI * 2);
            w.stroke();
          }
        }
      } else if (t === CELL.INTERIOR) {
        if (dungeon) stipple(w, X, Y, cs, cs, { seed: seed + x * 7 + y * 131, count: 10, r: 0.8, color: '#5a4630', alpha: 0.35 });
        else lineShade(w, X, Y, cs, cs, { gap: cs / 7, angle: -Math.PI / 4, color: '#7a2a24', width: 0.6, alpha: 0.35 });
      } else if (t === CELL.COURTYARD) {
        w.strokeStyle = 'rgba(80,80,70,0.32)';
        w.lineWidth = 0.6;
        w.beginPath();
        const q = cs / 2;
        w.moveTo(X, Y + q); w.lineTo(X + cs, Y + q);
        w.moveTo(X + q + ((y & 1) ? q / 2 : 0), Y); w.lineTo(X + q + ((y & 1) ? q / 2 : 0), Y + q);
        w.moveTo(X + ((y & 1) ? q / 2 : q / 4) + q * 0.1, Y + q); w.lineTo(X + ((y & 1) ? q / 2 : q / 4) + q * 0.1, Y + cs);
        w.stroke();
      } else if (t === CELL.RUBBLE) {
        stipple(w, X, Y, cs, cs, { seed: seed + x * 13 + y * 71, count: 26, r: 0.9, color: '#3d2c1c', alpha: 0.55 });
        w.strokeStyle = 'rgba(50,35,20,0.6)';
        w.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
          const px = X + cs * (0.15 + r() * 0.7);
          const py = Y + cs * (0.15 + r() * 0.7);
          const s = cs * (0.05 + r() * 0.06);
          w.beginPath();
          w.moveTo(px - s, py); w.lineTo(px - s * 0.3, py - s * 0.9); w.lineTo(px + s, py - s * 0.4); w.lineTo(px + s * 0.7, py + s * 0.6); w.closePath();
          w.stroke();
        }
      } else if (t === CELL.WATER) {
        w.strokeStyle = 'rgba(30,60,110,0.45)';
        w.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
          const py = Y + cs * (0.25 + i * 0.25);
          const ox = (r() - 0.5) * cs * 0.2;
          w.beginPath();
          w.moveTo(X + cs * 0.15 + ox, py);
          w.quadraticCurveTo(X + cs * 0.3 + ox, py - cs * 0.07, X + cs * 0.45 + ox, py);
          w.quadraticCurveTo(X + cs * 0.6 + ox, py + cs * 0.07, X + cs * 0.75 + ox, py);
          w.stroke();
        }
      }
    }
    // soft watercolour edge darkening: re-stroke the cell-type boundaries with a blurred pass
    w.filter = `blur(${cs * 0.08 * k}px)`;
    w.globalAlpha = 0.5;
    w.drawImage(wash, 0, 0, W, H);
    w.filter = 'none';
    w.globalAlpha = 1;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'destination-in';
    w.imageSmoothingEnabled = true;
    w.drawImage(mask, 0, 0, W * k, H * k);
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.drawImage(wash, 0, 0, W, H);
  g.restore();

  // ---------- walls ----------
  const wallW = cs * 0.12;
  const { segs: cellSegs, effective } = collectEdges(map, info, seenCell, secrets);
  const segs = cellSegs.map((q) => ({ ...q, x0: CX(q.x0), y0: CY(q.y0), x1: CX(q.x1), y1: CY(q.y1) }));
  const exitAt = new Set(info.travel.filter((t) => t.edge).map((t) => `${t.at.x},${t.at.y},${t.at.facing}`));
  const ruin = (q) => q.style === 2 && !dungeon;
  const runs = mergeRuns(segs.filter((q) => effective(q) === EDGE.WALL && !ruin(q)));
  if (inkWalls) {
    // drop shadow (south-east) for relief
    g.save();
    g.globalAlpha = 0.22;
    for (const r of runs) inkLine(g, r.x0 + wallW * 0.45, r.y0 + wallW * 0.55, r.x1 + wallW * 0.45, r.y1 + wallW * 0.55, { width: wallW * 1.3, color: '#3a2410', amp: 0.4, seed: r.x0 + r.y0 * 3 });
    g.restore();
    for (const r of runs) {
      const ext = wallW * 0.35;
      const dx = r.horiz ? ext : 0;
      const dy = r.horiz ? 0 : ext;
      inkLine(g, r.x0 - dx, r.y0 - dy, r.x1 + dx, r.y1 + dy, { width: wallW * (r.style === 2 ? 1.15 : 1), color: '#1c110a', amp: cs * (r.style === 2 ? 0.05 : 0.012), seed: (r.x0 * 7 + r.y0 * 13) | 0, bleed: wallW * 0.7 });
    }
    // crumbling ruin walls: broken strokes and spill
    for (const s of segs.filter((q) => effective(q) === EDGE.WALL && ruin(q))) {
      const r = prng((s.x0 * 3 + s.y0 * 7) | 0);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const t0 = i / n + r() * 0.06;
        const t1 = (i + 1) / n - 0.06 - r() * 0.08;
        inkLine(g, s.x0 + (s.x1 - s.x0) * t0, s.y0 + (s.y1 - s.y0) * t0, s.x0 + (s.x1 - s.x0) * t1, s.y0 + (s.y1 - s.y0) * t1, { width: wallW * (0.7 + r() * 0.3), amp: 0.8, seed: i + s.x0 });
      }
      const mx = (s.x0 + s.x1) / 2;
      const my = (s.y0 + s.y1) / 2;
      stipple(g, mx - cs * 0.4, my - cs * 0.18, cs * 0.8, cs * 0.36, { seed: (mx + my) | 0, count: 14, r: 1.1, color: INK.ink, alpha: 0.7 });
    }
    // doors, locked doors, arches, found secret doors
    for (const s of segs) {
      const t = effective(s);
      if (t === EDGE.WALL) continue;
      const mx = (s.x0 + s.x1) / 2;
      const my = (s.y0 + s.y1) / 2;
      const along = s.horiz ? [1, 0] : [0, 1];
      const gap = cs * 0.26;
      const seg = (a, b) => inkLine(g, s.x0 + (s.x1 - s.x0) * a, s.y0 + (s.y1 - s.y0) * a, s.x0 + (s.x1 - s.x0) * b, s.y0 + (s.y1 - s.y0) * b, { width: wallW, amp: 0.3, seed: (s.x0 + s.y0) | 0, bleed: wallW * 0.6, cap: 'butt' });
      if (t === EDGE.SECRET) {
        // dashed wall + vermilion S
        g.save();
        g.setLineDash([cs * 0.1, cs * 0.07]);
        g.strokeStyle = INK.ink;
        g.lineWidth = wallW * 0.8;
        g.beginPath(); g.moveTo(s.x0, s.y0); g.lineTo(s.x1, s.y1); g.stroke();
        g.restore();
        g.save();
        g.font = `italic bold ${Math.round(cs * 0.42)}px ${SERIF}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        haloText(g, 'S', mx + (s.horiz ? 0 : cs * 0.22), my + (s.horiz ? -cs * 0.2 : 0), { color: INK.vermilion, width: 3 });
        g.restore();
        continue;
      }
      seg(0, 0.5 - gap / cs);
      seg(0.5 + gap / cs, 1);
      // jambs
      g.save();
      g.strokeStyle = INK.ink;
      g.lineWidth = 1.2;
      const jl = wallW * 1.1;
      for (const sgn of [-1, 1]) {
        const jx = mx + along[0] * gap * sgn;
        const jy = my + along[1] * gap * sgn;
        g.beginPath();
        g.moveTo(jx - along[1] * jl, jy - along[0] * jl);
        g.lineTo(jx + along[1] * jl, jy + along[0] * jl);
        g.stroke();
      }
      g.restore();
      if (t === EDGE.ARCH) {
        const outward = exitAt.has(s.cell.join(','));
        g.save();
        g.fillStyle = INK.ink;
        for (const sgn of [-1, 1]) {
          g.fillRect(mx + along[0] * gap * sgn - wallW * 0.8, my + along[1] * gap * sgn - wallW * 0.8, wallW * 1.6, wallW * 1.6);
        }
        g.strokeStyle = outward ? INK.vermilion : INK.ink;
        g.lineWidth = 1;
        g.setLineDash([2.5, 2.5]);
        g.beginPath();
        g.moveTo(mx - along[0] * gap, my - along[1] * gap);
        g.lineTo(mx + along[0] * gap, my + along[1] * gap);
        g.stroke();
        g.restore();
      } else {
        // door leaf
        const lw = gap * 1.7;
        const lt = wallW * 1.35;
        g.save();
        g.translate(mx, my);
        if (!s.horiz) g.rotate(Math.PI / 2);
        g.fillStyle = t === EDGE.LOCKED ? '#9c3b25' : '#a8743a';
        g.fillRect(-lw / 2, -lt / 2, lw, lt);
        g.strokeStyle = INK.ink;
        g.lineWidth = 1.1;
        g.strokeRect(-lw / 2, -lt / 2, lw, lt);
        g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(-lw / 2, 0); g.lineTo(lw / 2, 0); g.stroke();
        if (t === EDGE.LOCKED) {
          g.fillStyle = INK.goldHi;
          g.beginPath(); g.arc(0, 0, lt * 0.62, 0, Math.PI * 2); g.fill();
          g.strokeStyle = INK.ink; g.lineWidth = 0.8; g.stroke();
          g.fillStyle = INK.ink;
          g.beginPath(); g.arc(0, -lt * 0.12, lt * 0.18, 0, Math.PI * 2); g.fill();
          g.fillRect(-lt * 0.07, -lt * 0.1, lt * 0.14, lt * 0.36);
        }
        g.restore();
      }
    }
  }

  // ---------- markers ----------
  for (const ev of map.events) {
    if (!seenCell(ev.x, ev.y)) continue;
    const mk2 = eventMarker(ev, !!spent[ev.id]);
    if (!mk2) continue;
    const same = map.events.filter((e) => e.x === ev.x && e.y === ev.y && eventMarker(e, !!spent[e.id]));
    const idx = same.indexOf(ev);
    const off = same.length > 1 ? (idx - (same.length - 1) / 2) * cs * 0.32 : 0;
    drawMarker(g, mk2, CX(ev.x) + cs / 2 + off, CY(ev.y) + cs / 2, cs * 0.42, { color: INK.ink });
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
        haloText(g, label, ax, ay + oy * cs * 0.42, { width: 3 });
      } else {
        g.save();
        g.translate(ax + ox * cs * 0.22, ay);
        g.rotate(facing === 'E' ? Math.PI / 2 : -Math.PI / 2);
        g.textAlign = 'center';
        haloText(g, label, 0, -cs * 0.14, { width: 3 });
        g.restore();
      }
    } else {
      const glyph = t.art === 'docks' || t.art === 'keep' ? 'boat' : 'stairs';
      drawMarker(g, glyph, X, Y, cs * 0.5, { color: INK.ink });
      g.font = `italic ${Math.round(cs * 0.27)}px ${SERIF}`;
      g.textAlign = 'center';
      haloText(g, t.destName, X, Y + cs * 0.52, { width: 3 });
    }
  }
  g.restore();

  // ---------- zone names ----------
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const z of map.zones) {
    let any = false;
    for (let y = z.y; y < z.y + z.h && !any; y++) for (let x = z.x; x < z.x + z.w; x++) if (seenCell(x, y)) { any = true; break; }
    if (!any) continue;
    const zw = z.w * cs * 0.92;
    const fs = Math.min(cs * 0.34, Math.max(cs * 0.22, zw / 7));
    g.font = `italic ${Math.round(fs)}px ${SERIF}`;
    g.letterSpacing = `${(fs * 0.06).toFixed(1)}px`;
    const lines = wrapText(g, z.name, Math.max(zw, cs * 1.8));
    const cx = CX(z.x + z.w / 2);
    const cy = CY(z.y + z.h / 2) - ((lines.length - 1) * fs * 1.05) / 2 + (z.h <= 2 ? 0 : -cs * 0.08);
    lines.forEach((l, i) => haloText(g, l, cx, cy + i * fs * 1.05, { color: '#3b2210', halo: 'rgba(243,230,196,0.85)', width: fs * 0.3 }));
  }
  g.letterSpacing = '0px';
  g.restore();

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
    if (i % 2) continue;
    g.fillStyle = 'rgba(43,26,13,0.8)';
    g.fillRect(CX(i), MY - 22, cs, 6);
    g.fillRect(CX(i), MY + MS + 16, cs, 6);
    g.fillRect(MX - 22, CY(i), 6, cs);
    g.fillRect(MX + MS + 16, CY(i), 6, cs);
  }
  g.font = `italic ${Math.round(cs * 0.26)}px ${SERIF}`;
  g.fillStyle = '#4a3320';
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
  return { canvas, k, cs, info, seenCell, cellRect: (x, y) => [M + CX(x), M + CY(y), cs, cs], seed };
}

/** Small legend swatch drawn in sheet units. */
export function drawKeySwatch(g, key, x, y, s) {
  const h = s / 2;
  g.save();
  g.strokeStyle = INK.ink;
  g.fillStyle = INK.ink;
  const wall = (a, b) => inkLine(g, x - h + a * s, y, x - h + b * s, y, { width: s * 0.13, amp: 0.2, seed: 3 });
  switch (key) {
    case 'wall': wall(0, 1); break;
    case 'door':
    case 'locked': {
      wall(0, 0.25); wall(0.75, 1);
      g.fillStyle = key === 'locked' ? '#9c3b25' : '#a8743a';
      g.fillRect(x - s * 0.24, y - s * 0.09, s * 0.48, s * 0.18);
      g.lineWidth = 1; g.strokeRect(x - s * 0.24, y - s * 0.09, s * 0.48, s * 0.18);
      if (key === 'locked') { g.fillStyle = INK.goldHi; g.beginPath(); g.arc(x, y, s * 0.08, 0, Math.PI * 2); g.fill(); g.stroke(); }
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
      g.fillRect(x - s * 0.3, y - s * 0.08, s * 0.14, s * 0.16);
      g.fillRect(x + s * 0.16, y - s * 0.08, s * 0.14, s * 0.16);
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
