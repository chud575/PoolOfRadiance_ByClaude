import { EDGE, DIRS } from '../../data/maps/MapGrid.js';
import { INK, prng } from './ink.js';

/**
 * Floor plans for the buildings on a survey sheet: plank, flagstone or broken
 * paving drawn inside each room, then the furniture a surveyor would note in
 * plan symbols (hearth, table and stools, bed, chest, barrels, crates,
 * shelves, counter, altar and pews ...), chosen by what the place is called.
 * Everything is seeded and deterministic.
 */

const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const PAPER = 'rgba(240,226,192,0.92)';

/** What kind of place a zone name describes. */
export function themeOf(name = '') {
  const n = name.toLowerCase();
  if (/temple|chapel|shrine|sanctum|mausoleum|ossuary/.test(n)) return 'temple';
  if (/tankard|oar|inn|tavern|arms\b(?! &)|alehouse/.test(n)) return 'tavern';
  if (/counting|treasury|hoss|city hall|council/.test(n)) return 'counting';
  if (/library|reading|scriptor|quill|gallery/.test(n)) return 'library';
  if (/barrack|training|armou?r|gatehouse|guard|keep|castle|throne/.test(n)) return 'barracks';
  if (/warehouse|grain|loading|weaving|dye|textile|provision|store|bay/.test(n)) return 'store';
  return 'house';
}

function cellSet(cells) {
  const s = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x, y) => s.has(`${x},${y}`);
}

function regionPath(cells, CX, CY, cs, grow = 0) {
  const p = new Path2D();
  for (const [x, y] of cells) p.rect(CX(x) - grow, CY(y) - grow, cs + grow * 2, cs + grow * 2);
  return p;
}

/**
 * Lay a floor inside a room. kind: 'planks' | 'flags' | 'broken'.
 */
export function drawFloor(g, cells, { CX, CY, cs, seed = 1, kind = 'planks' }) {
  const r = prng(seed);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of cells) { x0 = Math.min(x0, CX(x)); y0 = Math.min(y0, CY(y)); x1 = Math.max(x1, CX(x + 1)); y1 = Math.max(y1, CY(y + 1)); }
  g.save();
  g.clip(regionPath(cells, CX, CY, cs));
  g.lineCap = 'round';
  if (kind === 'planks') {
    // boards run the long way of the room, butt joints staggered
    const horiz = x1 - x0 >= y1 - y0;
    const bw = cs * (0.15 + r() * 0.03);
    const [a0, a1, b0, b1] = horiz ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
    g.strokeStyle = 'rgba(70,40,18,0.34)';
    g.lineWidth = 0.55;
    g.beginPath();
    for (let b = b0 + bw; b < b1; b += bw) {
      if (horiz) { g.moveTo(a0, b); g.lineTo(a1, b); } else { g.moveTo(b, a0); g.lineTo(b, a1); }
    }
    g.stroke();
    // joints and a few knots / grain flicks
    g.beginPath();
    for (let b = b0; b < b1; b += bw) {
      let a = a0 + r() * cs * 0.9;
      while (a < a1) {
        if (horiz) { g.moveTo(a, b + 0.6); g.lineTo(a, b + bw - 0.6); } else { g.moveTo(b + 0.6, a); g.lineTo(b + bw - 0.6, a); }
        a += cs * (0.75 + r() * 0.7);
      }
    }
    g.stroke();
    g.strokeStyle = 'rgba(70,40,18,0.18)';
    g.lineWidth = 0.45;
    g.beginPath();
    for (let b = b0; b < b1; b += bw) {
      for (let a = a0 + r() * cs * 0.3; a < a1; a += cs * (0.18 + r() * 0.3)) {
        const L = cs * (0.08 + r() * 0.16);
        const o = bw * (0.3 + r() * 0.4);
        if (horiz) { g.moveTo(a, b + o); g.lineTo(a + L, b + o + (r() - 0.5) * 0.8); } else { g.moveTo(b + o, a); g.lineTo(b + o + (r() - 0.5) * 0.8, a + L); }
      }
    }
    g.stroke();
  } else {
    // flagstones in running courses; broken paving loses some, cracks others
    const broken = kind === 'broken';
    const rh = cs * (0.24 + r() * 0.06);
    for (let y = y0; y < y1; y += rh) {
      let x = x0 - r() * cs * 0.3;
      while (x < x1) {
        const w = cs * (0.26 + r() * 0.24);
        const jx = (r() - 0.5) * 1.2;
        const jy = (r() - 0.5) * 1.2;
        const gone = broken && r() < 0.22;
        if (!gone) {
          const v = 200 + r() * 40;
          g.fillStyle = `rgba(${v | 0},${(v * 0.93) | 0},${(v * 0.8) | 0},${(0.12 + r() * 0.16).toFixed(2)})`;
          g.fillRect(x + 1 + jx, y + 1 + jy, w - 2, rh - 2);
          g.strokeStyle = `rgba(60,40,22,${(0.3 + r() * 0.15).toFixed(2)})`;
          g.lineWidth = 0.55;
          g.strokeRect(x + 1 + jx, y + 1 + jy, w - 2, rh - 2);
          if (broken && r() < 0.4) {
            g.beginPath();
            const cx = x + w * (0.2 + r() * 0.6);
            g.moveTo(cx, y + 1);
            g.lineTo(cx + (r() - 0.5) * w * 0.4, y + rh * 0.5);
            g.lineTo(cx + (r() - 0.5) * w * 0.5, y + rh - 1);
            g.stroke();
          }
        } else {
          // a hole in the paving: a few loose stones in the earth
          g.fillStyle = 'rgba(90,64,40,0.2)';
          g.fillRect(x + 1, y + 1, w - 2, rh - 2);
          g.fillStyle = 'rgba(60,40,22,0.4)';
          for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x + r() * w, y + r() * rh, 0.6 + r() * 0.8, 0, Math.PI * 2); g.fill(); }
        }
        x += w;
      }
    }
  }
  g.restore();
}

/** Diagonal shadow hatching inside the north and west walls of a room. */
export function wallShadow(g, cells, { CX, CY, cs, seed = 1, walled, band = 0.24, alpha = 0.42 }) {
  const has = cellSet(cells);
  const r = prng(seed);
  const bw = cs * band;
  g.save();
  g.clip(regionPath(cells, CX, CY, cs));
  g.strokeStyle = '#3a1e0e';
  g.lineCap = 'round';
  for (const [x, y] of cells) {
    for (const side of 'NW') {
      const [dx, dy] = DV[side];
      if (has(x + dx, y + dy) || !walled(x, y, side)) continue;
      const horiz = side === 'N';
      const base = horiz ? CY(y) : CX(x);
      const a0 = horiz ? CX(x) : CY(y);
      for (let p = a0 - bw; p < a0 + cs; p += cs * (0.05 + r() * 0.025)) {
        const L = bw * (0.7 + r() * 0.5);
        g.globalAlpha = alpha * (0.7 + r() * 0.5);
        g.lineWidth = 0.5 + r() * 0.3;
        g.beginPath();
        if (horiz) { g.moveTo(p, base); g.lineTo(p + L, base + L); } else { g.moveTo(base, p); g.lineTo(base + L, p + L); }
        g.stroke();
      }
    }
  }
  g.restore();
}

// ------------------------------------------------------------------ furniture symbols
// Each draws in a local frame: origin at the anchor, +y pointing away from the wall
// it stands against (into the room); sizes in cell units multiplied by cs.

function outline(g, lw = 0.8) {
  g.strokeStyle = INK.ink;
  g.lineWidth = lw;
  g.stroke();
}

function box(g, x, y, w, h, fill = PAPER) {
  g.beginPath();
  g.rect(x, y, w, h);
  g.fillStyle = fill;
  g.fill();
  outline(g);
}

const SYMBOLS = {
  hearth(g, cs) {
    const w = cs * 0.62;
    const d = cs * 0.26;
    box(g, -w / 2, 0, w, d, 'rgba(206,190,160,0.95)');
    // firebox, soot-hatched, with a glowing heart
    g.beginPath(); g.rect(-w * 0.3, 0, w * 0.6, d * 0.62); g.fillStyle = 'rgba(40,24,14,0.85)'; g.fill();
    g.fillStyle = 'rgba(200,90,40,0.75)';
    g.beginPath(); g.arc(0, d * 0.32, d * 0.16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink; g.lineWidth = 0.5;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-w / 2 + 2, d * (0.2 + (i + 2) * 0.15)); g.lineTo(-w * 0.32, d * (0.2 + (i + 2) * 0.15)); g.moveTo(w * 0.32, d * (0.2 + (i + 2) * 0.15)); g.lineTo(w / 2 - 2, d * (0.2 + (i + 2) * 0.15)); g.stroke(); }
  },
  bed(g, cs) {
    const w = cs * 0.4;
    const L = cs * 0.66;
    box(g, -w / 2, 0.5, w, L);
    box(g, -w * 0.38, cs * 0.04, w * 0.76, cs * 0.12, 'rgba(250,244,226,0.95)');
    // the blanket turned down
    g.beginPath(); g.rect(-w / 2, cs * 0.24, w, L - cs * 0.24 + 0.5); g.fillStyle = 'rgba(150,70,52,0.55)'; g.fill(); outline(g, 0.6);
    g.beginPath(); g.moveTo(-w / 2, cs * 0.3); g.lineTo(w / 2, cs * 0.3); outline(g, 0.5);
  },
  chest(g, cs) {
    const w = cs * 0.34;
    const d = cs * 0.2;
    box(g, -w / 2, cs * 0.03, w, d, 'rgba(176,122,66,0.85)');
    g.beginPath(); g.moveTo(-w / 2, cs * 0.03 + d * 0.5); g.lineTo(w / 2, cs * 0.03 + d * 0.5); outline(g, 0.5);
    g.fillStyle = INK.goldHi; g.beginPath(); g.arc(0, cs * 0.03 + d, 1.4, 0, Math.PI * 2); g.fill(); outline(g, 0.5);
  },
  table(g, cs, r) {
    const round = r() < 0.5;
    if (round) {
      g.beginPath(); g.arc(0, cs * 0.5, cs * 0.17, 0, Math.PI * 2); g.fillStyle = 'rgba(190,140,84,0.8)'; g.fill(); outline(g);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.6 + r() * 0.3;
        g.beginPath(); g.arc(Math.cos(a) * cs * 0.28, cs * 0.5 + Math.sin(a) * cs * 0.28, cs * 0.055, 0, Math.PI * 2); g.fillStyle = PAPER; g.fill(); outline(g, 0.6);
      }
    } else {
      box(g, -cs * 0.24, cs * 0.36, cs * 0.48, cs * 0.26, 'rgba(190,140,84,0.8)');
      for (const sx of [-0.14, 0.14]) for (const sy of [0.26, 0.72]) box(g, sx * cs - cs * 0.05, sy * cs - cs * 0.04, cs * 0.1, cs * 0.08);
    }
  },
  barrels(g, cs, r) {
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * cs * 0.2;
      const y = cs * (0.13 + (i % 2) * 0.12);
      g.beginPath(); g.arc(x, y, cs * 0.095, 0, Math.PI * 2); g.fillStyle = 'rgba(170,112,60,0.85)'; g.fill(); outline(g, 0.7);
      g.beginPath(); g.arc(x, y, cs * 0.055, 0, Math.PI * 2); outline(g, 0.45);
    }
  },
  crates(g, cs, r) {
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const s = cs * (0.17 + r() * 0.06);
      const x = (i - (n - 1) / 2) * cs * 0.19 + (r() - 0.5) * 2;
      const y = cs * (0.04 + (i % 2) * 0.15);
      g.save(); g.translate(x, y + s / 2); g.rotate((r() - 0.5) * 0.3);
      box(g, -s / 2, -s / 2, s, s, 'rgba(206,166,104,0.85)');
      g.beginPath(); g.moveTo(-s / 2, -s / 2); g.lineTo(s / 2, s / 2); g.moveTo(s / 2, -s / 2); g.lineTo(-s / 2, s / 2); outline(g, 0.45);
      g.restore();
    }
  },
  sacks(g, cs, r) {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * cs * 0.16;
      const y = cs * (0.12 + (i % 2) * 0.08);
      g.beginPath(); g.ellipse(x, y, cs * 0.08, cs * 0.1, (r() - 0.5) * 0.8, 0, Math.PI * 2); g.fillStyle = 'rgba(214,190,140,0.9)'; g.fill(); outline(g, 0.6);
    }
  },
  shelves(g, cs) {
    const w = cs * 0.84;
    box(g, -w / 2, 0.5, w, cs * 0.12, 'rgba(176,122,66,0.75)');
    g.beginPath();
    for (let i = 1; i < 8; i++) { g.moveTo(-w / 2 + (i / 8) * w, 0.5); g.lineTo(-w / 2 + (i / 8) * w, cs * 0.12 + 0.5); }
    outline(g, 0.45);
  },
  counter(g, cs) {
    const w = cs * 0.9;
    box(g, -w / 2, cs * 0.22, w, cs * 0.13, 'rgba(176,122,66,0.85)');
    box(g, -cs * 0.08, cs * 0.04, cs * 0.16, cs * 0.12, 'rgba(120,110,100,0.85)');
    g.fillStyle = INK.goldHi; g.beginPath(); g.arc(0, cs * 0.1, 1.5, 0, Math.PI * 2); g.fill();
  },
  desk(g, cs) {
    box(g, -cs * 0.22, cs * 0.06, cs * 0.44, cs * 0.2, 'rgba(176,122,66,0.85)');
    box(g, -cs * 0.06, cs * 0.32, cs * 0.12, cs * 0.1);
    // an open ledger
    g.beginPath(); g.rect(-cs * 0.1, cs * 0.1, cs * 0.2, cs * 0.11); g.fillStyle = 'rgba(250,244,226,0.95)'; g.fill(); outline(g, 0.45);
    g.beginPath(); g.moveTo(0, cs * 0.1); g.lineTo(0, cs * 0.21); outline(g, 0.45);
  },
  altar(g, cs) {
    const w = cs * 0.7;
    // two steps and the altar stone, with a candle either side
    box(g, -w / 2, 0.5, w, cs * 0.42, 'rgba(214,204,184,0.9)');
    box(g, -w * 0.4, 0.5, w * 0.8, cs * 0.3, 'rgba(226,216,196,0.95)');
    box(g, -w * 0.28, cs * 0.04, w * 0.56, cs * 0.18, 'rgba(236,228,210,0.98)');
    g.save(); g.beginPath(); g.rect(-w * 0.28, cs * 0.04, w * 0.56, cs * 0.18); g.clip();
    g.strokeStyle = 'rgba(43,26,13,0.5)'; g.lineWidth = 0.45;
    for (let i = -6; i < 8; i++) { g.beginPath(); g.moveTo(i * 3, cs * 0.04); g.lineTo(i * 3 + cs * 0.18, cs * 0.22); g.stroke(); }
    g.restore();
    // Tyr's balance, a small cross-and-bar
    g.beginPath(); g.moveTo(0, cs * 0.07); g.lineTo(0, cs * 0.19); g.moveTo(-cs * 0.06, cs * 0.1); g.lineTo(cs * 0.06, cs * 0.1); outline(g, 0.9);
    for (const s of [-1, 1]) { g.beginPath(); g.arc(s * w * 0.36, cs * 0.12, 1.8, 0, Math.PI * 2); g.fillStyle = INK.goldHi; g.fill(); outline(g, 0.5); }
  },
  pews(g, cs) {
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) box(g, s > 0 ? cs * 0.06 : -cs * 0.42, cs * (0.12 + i * 0.27), cs * 0.36, cs * 0.08, 'rgba(176,122,66,0.75)');
    }
  },
  brazier(g, cs) {
    g.beginPath(); g.arc(0, cs * 0.2, cs * 0.1, 0, Math.PI * 2); g.fillStyle = 'rgba(120,110,100,0.9)'; g.fill(); outline(g);
    g.fillStyle = 'rgba(220,110,40,0.8)';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const q = i % 2 ? cs * 0.035 : cs * 0.075;
      if (i === 0) g.moveTo(Math.cos(a) * q, cs * 0.2 + Math.sin(a) * q); else g.lineTo(Math.cos(a) * q, cs * 0.2 + Math.sin(a) * q);
    }
    g.closePath(); g.fill();
  },
  rack(g, cs) {
    const w = cs * 0.7;
    box(g, -w / 2, 0.5, w, cs * 0.07, 'rgba(176,122,66,0.75)');
    g.strokeStyle = INK.ink; g.lineWidth = 0.7;
    for (let i = 0; i < 5; i++) { const x = -w / 2 + (i + 0.5) * (w / 5); g.beginPath(); g.moveTo(x, 0.5); g.lineTo(x, cs * 0.26); g.stroke(); g.beginPath(); g.moveTo(x - 1.5, cs * 0.24); g.lineTo(x, cs * 0.29); g.lineTo(x + 1.5, cs * 0.24); g.stroke(); }
  },
  lectern(g, cs) {
    g.save(); g.translate(0, cs * 0.45); g.rotate(0.3);
    box(g, -cs * 0.1, -cs * 0.07, cs * 0.2, cs * 0.14, 'rgba(176,122,66,0.85)');
    g.beginPath(); g.rect(-cs * 0.08, -cs * 0.05, cs * 0.16, cs * 0.1); g.fillStyle = 'rgba(250,244,226,0.95)'; g.fill(); outline(g, 0.45);
    g.restore();
  },
  font(g, cs) {
    g.beginPath(); g.arc(0, cs * 0.5, cs * 0.14, 0, Math.PI * 2); g.fillStyle = 'rgba(214,204,184,0.95)'; g.fill(); outline(g);
    g.beginPath(); g.arc(0, cs * 0.5, cs * 0.09, 0, Math.PI * 2); g.fillStyle = 'rgba(80,120,160,0.55)'; g.fill(); outline(g, 0.5);
  },
  debris(g, cs, r) {
    // a broken beam and scattered stones
    g.save(); g.translate(0, cs * 0.4); g.rotate((r() - 0.5) * 1.6);
    box(g, -cs * 0.3, -cs * 0.035, cs * 0.6, cs * 0.07, 'rgba(120,80,44,0.8)');
    g.restore();
    g.fillStyle = 'rgba(214,196,160,0.9)';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc((r() - 0.5) * cs * 0.6, cs * (0.15 + r() * 0.6), cs * (0.02 + r() * 0.03), 0, Math.PI * 2); g.fill(); outline(g, 0.5); }
  },
};

// [symbol, needs a wall?, centre-of-cell item?]
const KIT = {
  house: [['hearth', 1], ['bed', 1], ['table', 0], ['chest', 1], ['barrels', 1], ['bed', 1], ['shelves', 1]],
  tavern: [['hearth', 1], ['counter', 1], ['table', 0], ['table', 0], ['barrels', 1], ['table', 0], ['barrels', 1]],
  temple: [['altar', 1], ['pews', 0], ['brazier', 1], ['font', 0], ['brazier', 1], ['pews', 0]],
  counting: [['counter', 1], ['desk', 1], ['chest', 1], ['shelves', 1], ['desk', 1], ['table', 0]],
  library: [['shelves', 1], ['shelves', 1], ['table', 0], ['lectern', 0], ['shelves', 1], ['desk', 1]],
  barracks: [['bed', 1], ['bed', 1], ['rack', 1], ['table', 0], ['bed', 1], ['chest', 1]],
  store: [['crates', 1], ['barrels', 1], ['sacks', 1], ['crates', 1], ['table', 0], ['barrels', 1]],
};

/**
 * Furnish one room in plan symbols.
 * @param {{CX:Function, CY:Function, cs:number, seed:number, map:any, theme:string, ruined?:boolean, avoid?:(x:number,y:number)=>boolean}} o
 */
export function furnish(g, cells, { CX, CY, cs, seed = 1, map, theme = 'house', ruined = false, avoid = () => false }) {
  const r = prng(seed);
  const has = cellSet(cells);
  const doorNear = (x, y) => DIRS.some((d) => {
    const e = map.getEdge(x, y, d);
    return e === EDGE.DOOR || e === EDGE.LOCKED || e === EDGE.ARCH || e === EDGE.SECRET;
  });
  const wallSides = (x, y) => DIRS.filter((d) => map.getEdge(x, y, d) === EDGE.WALL && !has(x + DV[d][0], y + DV[d][1]));
  const used = new Set();
  const free = cells.filter(([x, y]) => !avoid(x, y));
  // the temple's altar goes against the north wall if it can
  const order = [...free].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const kit = ruined ? [['debris', 0], ...KIT[theme].slice(0, 2), ['debris', 0], KIT[theme][2]] : KIT[theme];
  const budget = Math.min(kit.length, Math.max(1, Math.round(cells.length * (ruined ? 0.4 : 0.6))));
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (let i = 0; i < budget; i++) {
    const [sym, wall] = kit[i];
    let spot = null;
    const pool = sym === 'altar' ? order : [...free].sort(() => r() - 0.5);
    for (const [x, y] of pool) {
      const key = `${x},${y}`;
      if (used.has(key) || doorNear(x, y)) continue;
      const sides = wallSides(x, y);
      if (wall && !sides.length) continue;
      if (!wall && sides.length > 1 && cells.length > 3) continue;
      const side = wall ? (sym === 'altar' && sides.includes('N') ? 'N' : sides[Math.floor(r() * sides.length)]) : 'N';
      spot = { x, y, side };
      break;
    }
    if (!spot) continue;
    used.add(`${spot.x},${spot.y}`);
    const { x, y, side } = spot;
    const cx = CX(x) + cs / 2;
    const cy = CY(y) + cs / 2;
    const inset = cs * 0.08;
    const ang = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 }[side];
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    g.translate(0, -cs / 2 + (wall ? inset : 0));
    // a soft pencil shadow (light from the north-west)
    g.save();
    g.globalAlpha = 0.22;
    g.translate(1.4, 1.6);
    SYMBOLS[sym](g, cs, prng(seed + i * 17));
    g.restore();
    SYMBOLS[sym](g, cs, prng(seed + i * 17));
    g.restore();
  }
  g.restore();
}

/**
 * A light timber partition across a large open room, with a doorway gap,
 * so big halls read as divided spaces.
 */
export function partition(g, cells, { CX, CY, cs, seed = 1 }) {
  if (cells.length < 9) return;
  const r = prng(seed);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of cells) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 3 && h < 3) return;
  const has = cellSet(cells);
  const vertical = w >= h;
  const at = vertical ? x0 + Math.max(1, Math.round(w * (0.35 + r() * 0.15))) : y0 + Math.max(1, Math.round(h * (0.35 + r() * 0.15)));
  const span = vertical ? [y0, y1] : [x0, x1];
  const gapAt = span[0] + Math.floor(r() * (span[1] - span[0]));
  g.save();
  g.strokeStyle = 'rgba(43,26,13,0.75)';
  g.lineCap = 'butt';
  for (let t = span[0]; t < span[1]; t++) {
    const a = vertical ? has(at - 1, t) && has(at, t) : has(t, at - 1) && has(t, at);
    if (!a || t === gapAt) continue;
    const gx = vertical ? CX(at) : CX(t);
    const gy = vertical ? CY(t) : CY(at);
    // a thin double rule (studs and boards)
    for (const o of [-1.1, 1.1]) {
      g.lineWidth = 0.6;
      g.beginPath();
      if (vertical) { g.moveTo(gx + o, gy); g.lineTo(gx + o, gy + cs); } else { g.moveTo(gx, gy + o); g.lineTo(gx + cs, gy + o); }
      g.stroke();
    }
    g.lineWidth = 1.4;
    g.beginPath();
    for (let k = 0; k <= 2; k++) {
      if (vertical) { g.moveTo(gx - 1.1, gy + (k / 2) * cs); g.lineTo(gx + 1.1, gy + (k / 2) * cs); } else { g.moveTo(gx + (k / 2) * cs, gy - 1.1); g.lineTo(gx + (k / 2) * cs, gy + 1.1); }
    }
    g.stroke();
  }
  g.restore();
}
