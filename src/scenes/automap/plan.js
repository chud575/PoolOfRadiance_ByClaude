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
const PAPER = 'rgba(224,204,162,0.95)';
// one muted ink-and-wash palette for every plan symbol
const WOOD = 'rgba(150,98,54,0.78)';
const WOOD_D = 'rgba(112,72,40,0.82)';
const STONE = 'rgba(176,164,142,0.88)';
const LINEN = 'rgba(238,226,198,0.96)';

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
  } else if (kind === 'earth' || kind === 'broken') {
    // beaten earth: a mottled umber wash, straw and grit; a ruin keeps a few
    // shattered flags lying where they fell
    const broken = kind === 'broken';
    g.fillStyle = broken ? 'rgba(132,104,72,0.14)' : 'rgba(156,120,76,0.12)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / (cs * cs) * 7; i++) {
      const px = x0 + r() * (x1 - x0);
      const py = y0 + r() * (y1 - y0);
      g.fillStyle = `rgba(96,66,38,${(0.03 + r() * 0.05).toFixed(3)})`;
      g.beginPath(); g.ellipse(px, py, cs * (0.1 + r() * 0.2), cs * (0.06 + r() * 0.12), r() * 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = broken ? 'rgba(60,44,28,0.4)' : 'rgba(120,90,40,0.45)';
    g.lineWidth = 0.5;
    g.beginPath();
    for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / (cs * cs) * (broken ? 14 : 26); i++) {
      const px = x0 + r() * (x1 - x0);
      const py = y0 + r() * (y1 - y0);
      const a = r() * Math.PI;
      const L = cs * (broken ? 0.02 + r() * 0.03 : 0.04 + r() * 0.07);
      g.moveTo(px, py); g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
    }
    g.stroke();
    if (broken) {
      for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / (cs * cs) * 3; i++) {
        const px = x0 + r() * (x1 - x0);
        const py = y0 + r() * (y1 - y0);
        const R = cs * (0.07 + r() * 0.09);
        const nv = 4 + Math.floor(r() * 3);
        const a0 = r() * 6;
        g.beginPath();
        for (let q = 0; q < nv; q++) {
          const t = a0 + (q / nv) * Math.PI * 2;
          const rr = R * (0.6 + r() * 0.5);
          if (q) g.lineTo(px + Math.cos(t) * rr, py + Math.sin(t) * rr); else g.moveTo(px + Math.cos(t) * rr, py + Math.sin(t) * rr);
        }
        g.closePath();
        const v = 176 + r() * 40;
        g.fillStyle = `rgba(${v | 0},${(v * 0.94) | 0},${(v * 0.82) | 0},0.55)`;
        g.fill();
        g.strokeStyle = 'rgba(52,36,22,0.6)';
        g.lineWidth = 0.6;
        g.stroke();
      }
    }
  } else {
    // flagstones: courses of hand-dressed slabs, each its own size and tone, with
    // a broken inked joint, a darker bed of mortar and the odd crack
    const rh0 = cs * (0.25 + r() * 0.06);
    for (let y = y0; y < y1; ) {
      const rh = rh0 * (0.8 + r() * 0.4);
      let x = x0 - r() * cs * 0.3;
      while (x < x1) {
        const w = cs * (0.24 + r() * 0.3);
        const J = () => (r() - 0.5) * cs * 0.025;
        const q = [[x + 1 + J(), y + 1 + J()], [x + w - 1 + J(), y + 1 + J()], [x + w - 1 + J(), y + rh - 1 + J()], [x + 1 + J(), y + rh - 1 + J()]];
        const quad = () => { g.beginPath(); q.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); };
        quad();
        g.strokeStyle = 'rgba(70,48,28,0.2)';
        g.lineWidth = 1.6;
        g.stroke();
        const v = 186 + r() * 50;
        const warm = r();
        g.fillStyle = `rgba(${v | 0},${(v * (0.9 + warm * 0.05)) | 0},${(v * (0.74 + warm * 0.08)) | 0},${(0.22 + r() * 0.2).toFixed(2)})`;
        g.fill();
        g.strokeStyle = `rgba(56,38,22,${(0.4 + r() * 0.2).toFixed(2)})`;
        g.lineWidth = 0.55;
        g.beginPath();
        for (let i = 0; i < 4; i++) {
          if (r() < 0.18) continue;
          const [ax, ay] = q[i];
          const [bx, by] = q[(i + 1) % 4];
          g.moveTo(ax, ay); g.lineTo(bx, by);
        }
        g.stroke();
        if (r() < 0.16) {
          g.beginPath();
          const cx = x + w * (0.2 + r() * 0.6);
          g.moveTo(cx, y + 1);
          g.lineTo(cx + (r() - 0.5) * w * 0.4, y + rh * 0.5);
          g.lineTo(cx + (r() - 0.5) * w * 0.5, y + rh - 1);
          g.stroke();
        }
        x += w;
      }
      y += rh;
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

function outline(g, lw = 1.05) {
  g.strokeStyle = INK.ink;
  g.lineWidth = lw;
  g.stroke();
}

/** A plan symbol's body: muted wash, hatched on its shadow (south-east) side, inked outline. */
function box(g, x, y, w, h, fill = PAPER) {
  g.beginPath();
  g.rect(x, y, w, h);
  g.fillStyle = fill;
  g.fill();
  if (w > 3 && h > 3) {
    g.save();
    g.beginPath();
    g.rect(x + w * 0.55, y, w * 0.45, h);
    g.clip();
    g.strokeStyle = 'rgba(43,26,13,0.38)';
    g.lineWidth = 0.4;
    g.beginPath();
    for (let t = -h; t < w + h; t += 1.5) { g.moveTo(x + t, y); g.lineTo(x + t + h, y + h); }
    g.stroke();
    g.restore();
  }
  g.beginPath();
  g.rect(x, y, w, h);
  outline(g);
}

const SYMBOLS = {
  hearth(g, cs) {
    const w = cs * 0.62;
    const d = cs * 0.26;
    box(g, -w / 2, 0, w, d, STONE);
    // firebox, soot-hatched, with a glowing heart
    g.beginPath(); g.rect(-w * 0.3, 0, w * 0.6, d * 0.62); g.fillStyle = 'rgba(40,24,14,0.85)'; g.fill();
    g.fillStyle = 'rgba(184,96,52,0.55)';
    g.beginPath(); g.arc(0, d * 0.32, d * 0.16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink; g.lineWidth = 0.5;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-w / 2 + 2, d * (0.2 + (i + 2) * 0.15)); g.lineTo(-w * 0.32, d * (0.2 + (i + 2) * 0.15)); g.moveTo(w * 0.32, d * (0.2 + (i + 2) * 0.15)); g.lineTo(w / 2 - 2, d * (0.2 + (i + 2) * 0.15)); g.stroke(); }
  },
  bed(g, cs) {
    const w = cs * 0.4;
    const L = cs * 0.66;
    box(g, -w / 2, 0.5, w, L);
    box(g, -w * 0.38, cs * 0.04, w * 0.76, cs * 0.12, LINEN);
    // the blanket turned down
    g.beginPath(); g.rect(-w / 2, cs * 0.24, w, L - cs * 0.24 + 0.5); g.fillStyle = 'rgba(146,72,56,0.32)'; g.fill(); outline(g, 0.6);
    g.beginPath(); g.moveTo(-w / 2, cs * 0.3); g.lineTo(w / 2, cs * 0.3); outline(g, 0.5);
  },
  chest(g, cs) {
    const w = cs * 0.34;
    const d = cs * 0.2;
    box(g, -w / 2, cs * 0.03, w, d, WOOD_D);
    g.beginPath(); g.moveTo(-w / 2, cs * 0.03 + d * 0.5); g.lineTo(w / 2, cs * 0.03 + d * 0.5); outline(g, 0.5);
    g.fillStyle = INK.goldHi; g.beginPath(); g.arc(0, cs * 0.03 + d, 1.4, 0, Math.PI * 2); g.fill(); outline(g, 0.5);
  },
  table(g, cs, r) {
    const round = r() < 0.5;
    if (round) {
      g.beginPath(); g.arc(0, cs * 0.5, cs * 0.17, 0, Math.PI * 2); g.fillStyle = WOOD; g.fill(); outline(g);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.6 + r() * 0.3;
        g.beginPath(); g.arc(Math.cos(a) * cs * 0.28, cs * 0.5 + Math.sin(a) * cs * 0.28, cs * 0.055, 0, Math.PI * 2); g.fillStyle = PAPER; g.fill(); outline(g, 0.6);
      }
    } else {
      box(g, -cs * 0.24, cs * 0.36, cs * 0.48, cs * 0.26, WOOD);
      for (const sx of [-0.14, 0.14]) for (const sy of [0.26, 0.72]) box(g, sx * cs - cs * 0.05, sy * cs - cs * 0.04, cs * 0.1, cs * 0.08);
    }
  },
  barrels(g, cs, r) {
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * cs * 0.2;
      const y = cs * (0.13 + (i % 2) * 0.12);
      g.beginPath(); g.arc(x, y, cs * 0.095, 0, Math.PI * 2); g.fillStyle = WOOD_D; g.fill(); outline(g, 0.7);
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
      box(g, -s / 2, -s / 2, s, s, WOOD);
      g.beginPath(); g.moveTo(-s / 2, -s / 2); g.lineTo(s / 2, s / 2); g.moveTo(s / 2, -s / 2); g.lineTo(-s / 2, s / 2); outline(g, 0.45);
      g.restore();
    }
  },
  sacks(g, cs, r) {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * cs * 0.16;
      const y = cs * (0.12 + (i % 2) * 0.08);
      g.beginPath(); g.ellipse(x, y, cs * 0.08, cs * 0.1, (r() - 0.5) * 0.8, 0, Math.PI * 2); g.fillStyle = 'rgba(206,184,140,0.6)'; g.fill(); outline(g, 0.6);
    }
  },
  shelves(g, cs) {
    const w = cs * 0.84;
    box(g, -w / 2, 0.5, w, cs * 0.12, WOOD);
    g.beginPath();
    for (let i = 1; i < 8; i++) { g.moveTo(-w / 2 + (i / 8) * w, 0.5); g.lineTo(-w / 2 + (i / 8) * w, cs * 0.12 + 0.5); }
    outline(g, 0.45);
  },
  counter(g, cs) {
    const w = cs * 0.9;
    box(g, -w / 2, cs * 0.22, w, cs * 0.13, WOOD_D);
    box(g, -cs * 0.08, cs * 0.04, cs * 0.16, cs * 0.12, 'rgba(120,110,100,0.55)');
    g.fillStyle = INK.goldHi; g.beginPath(); g.arc(0, cs * 0.1, 1.5, 0, Math.PI * 2); g.fill();
  },
  desk(g, cs) {
    box(g, -cs * 0.22, cs * 0.06, cs * 0.44, cs * 0.2, WOOD_D);
    box(g, -cs * 0.06, cs * 0.32, cs * 0.12, cs * 0.1);
    // an open ledger
    g.beginPath(); g.rect(-cs * 0.1, cs * 0.1, cs * 0.2, cs * 0.11); g.fillStyle = LINEN; g.fill(); outline(g, 0.45);
    g.beginPath(); g.moveTo(0, cs * 0.1); g.lineTo(0, cs * 0.21); outline(g, 0.45);
  },
  altar(g, cs) {
    const w = cs * 0.7;
    // two steps and the altar stone, with a candle either side
    box(g, -w / 2, 0.5, w, cs * 0.42, STONE);
    box(g, -w * 0.4, 0.5, w * 0.8, cs * 0.3, 'rgba(214,206,188,0.75)');
    box(g, -w * 0.28, cs * 0.04, w * 0.56, cs * 0.18, 'rgba(230,222,204,0.85)');
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
      for (const s of [-1, 1]) box(g, s > 0 ? cs * 0.06 : -cs * 0.42, cs * (0.12 + i * 0.27), cs * 0.36, cs * 0.08, WOOD);
    }
  },
  brazier(g, cs) {
    g.beginPath(); g.arc(0, cs * 0.2, cs * 0.1, 0, Math.PI * 2); g.fillStyle = 'rgba(120,110,100,0.6)'; g.fill(); outline(g);
    g.fillStyle = 'rgba(190,104,56,0.6)';
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
    box(g, -w / 2, 0.5, w, cs * 0.07, WOOD);
    g.strokeStyle = INK.ink; g.lineWidth = 0.7;
    for (let i = 0; i < 5; i++) { const x = -w / 2 + (i + 0.5) * (w / 5); g.beginPath(); g.moveTo(x, 0.5); g.lineTo(x, cs * 0.26); g.stroke(); g.beginPath(); g.moveTo(x - 1.5, cs * 0.24); g.lineTo(x, cs * 0.29); g.lineTo(x + 1.5, cs * 0.24); g.stroke(); }
  },
  lectern(g, cs) {
    g.save(); g.translate(0, cs * 0.45); g.rotate(0.3);
    box(g, -cs * 0.1, -cs * 0.07, cs * 0.2, cs * 0.14, WOOD_D);
    g.beginPath(); g.rect(-cs * 0.08, -cs * 0.05, cs * 0.16, cs * 0.1); g.fillStyle = LINEN; g.fill(); outline(g, 0.45);
    g.restore();
  },
  font(g, cs) {
    g.beginPath(); g.arc(0, cs * 0.5, cs * 0.14, 0, Math.PI * 2); g.fillStyle = STONE; g.fill(); outline(g);
    g.beginPath(); g.arc(0, cs * 0.5, cs * 0.09, 0, Math.PI * 2); g.fillStyle = 'rgba(80,110,140,0.4)'; g.fill(); outline(g, 0.5);
  },
  debris(g, cs, r) {
    // a broken beam and scattered stones
    g.save(); g.translate(0, cs * 0.4); g.rotate((r() - 0.5) * 1.6);
    box(g, -cs * 0.3, -cs * 0.035, cs * 0.6, cs * 0.07, WOOD_D);
    g.restore();
    g.fillStyle = STONE;
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
    g.globalAlpha = 0.34;
    g.translate(1.8, 2.1);
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
