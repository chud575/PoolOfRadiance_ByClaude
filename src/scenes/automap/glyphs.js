import { INK, makeCanvas } from './ink.js';

/**
 * Map glyphs, drawn with Canvas2D at any size. Each draws centred on (x, y)
 * with nominal size s (≈ one cell). Used on the sheet, the overlay and in
 * the legend / notes list (via glyphDataURL).
 */

function withTransform(g, x, y, s, fn) {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  fn(g);
  g.restore();
}

/**
 * Party pointer, hand-painted: a vermilion wash with a darker shaded flank, a
 * pale highlight stroke, brush streaks and an inked outline, pointing up
 * (rotated by angle). `glow` (0..1) only deepens the soft shadow beneath.
 */
export function drawPartyArrow(g, x, y, s, angle = 0, { glow = 0.5 } = {}) {
  // a compass-rose point painted in vermilion: one flank in a pale wash, the
  // other in the full-strength pigment, a centre rib and a quill outline
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(s / 100, s / 100);
  const tip = [0, -50];
  const lw = [-25, 26];
  const rw = [25, 26];
  const notch = [0, 12];
  const flank = (side) => {
    g.beginPath();
    g.moveTo(tip[0], tip[1]);
    const w = side < 0 ? lw : rw;
    g.quadraticCurveTo(w[0] * 0.38, -12, w[0], w[1]);
    g.quadraticCurveTo(w[0] * 0.45, 17, notch[0], notch[1]);
    g.closePath();
  };
  const outline = () => {
    g.beginPath();
    g.moveTo(tip[0], tip[1]);
    g.quadraticCurveTo(rw[0] * 0.38, -12, rw[0], rw[1]);
    g.quadraticCurveTo(rw[0] * 0.45, 17, notch[0], notch[1]);
    g.quadraticCurveTo(lw[0] * 0.45, 17, lw[0], lw[1]);
    g.quadraticCurveTo(lw[0] * 0.38, -12, tip[0], tip[1]);
    g.closePath();
  };
  // a soft wash shadow, as if the point were cut from paper and laid on
  g.save();
  g.translate(3.5, 4.5);
  outline();
  g.fillStyle = `rgba(70,34,12,${(0.16 + glow * 0.06).toFixed(3)})`;
  g.fill();
  g.restore();
  // lit flank: thin vermilion wash pooling toward its edge
  flank(-1);
  const lit = g.createLinearGradient(-26, 0, 0, 0);
  lit.addColorStop(0, 'rgba(206,84,52,0.95)');
  lit.addColorStop(1, 'rgba(232,140,96,0.9)');
  g.fillStyle = lit;
  g.fill();
  // shaded flank: full pigment, darker at the rib
  flank(1);
  const sh = g.createLinearGradient(0, 0, 26, 0);
  sh.addColorStop(0, 'rgba(120,24,14,0.98)');
  sh.addColorStop(1, 'rgba(168,40,24,0.96)');
  g.fillStyle = sh;
  g.fill();
  // brush texture: a few dry streaks along the point
  g.save();
  outline();
  g.clip();
  g.strokeStyle = 'rgba(255,214,180,0.16)';
  g.lineWidth = 1.2;
  for (let i = 1; i <= 3; i++) { g.beginPath(); g.moveTo(-i * 2.5, -40 + i * 6); g.lineTo(-i * 7, 20 - i); g.stroke(); }
  g.restore();
  // quill outline + rib
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(43,22,10,0.95)';
  g.lineWidth = 2.6;
  outline();
  g.stroke();
  g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(tip[0], tip[1] + 3); g.lineTo(notch[0], notch[1] - 1); g.stroke();
  // a little gilt pivot, as on a compass card
  g.fillStyle = INK.goldHi;
  g.beginPath(); g.arc(0, 4, 4.2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(43,22,10,0.9)';
  g.lineWidth = 1.2;
  g.stroke();
  g.restore();
}

/** The party's view: a soft vermilion-ochre wash wedge (cached canvas). */
let coneCache = null;
export function partyConeCanvas() {
  if (coneCache) return coneCache;
  const S = 256;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  g.filter = 'blur(9px)';
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.48);
  gr.addColorStop(0, 'rgba(196,84,46,0.42)');
  gr.addColorStop(0.5, 'rgba(210,136,72,0.2)');
  gr.addColorStop(1, 'rgba(214,150,80,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(S / 2, S / 2);
  g.arc(S / 2, S / 2, S * 0.46, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
  g.closePath();
  g.fill();
  coneCache = c;
  return c;
}

/** Pin kinds for player notes (muted illuminator's pigments). */
export const PIN_KINDS = {
  note: { label: 'Note', color: '#a8323a', wash: [158, 62, 50], mark: 'quill' },
  danger: { label: 'Danger', color: '#3a2a22', wash: [112, 52, 42], mark: 'skull' },
  treasure: { label: 'Treasure', color: '#b8862a', wash: [196, 146, 58], mark: 'gem' },
  quest: { label: 'Quest', color: '#2c4a8c', wash: [58, 86, 146], mark: 'star' },
};
export const PIN_ORDER = ['note', 'danger', 'treasure', 'quest'];

/**
 * A note pin as the cartographer paints it: a roundel of paper ringed with a
 * watercolour band in the kind's pigment, ruled with two ink circles, the
 * kind's emblem drawn in pen and hatched. Flat, matte, in the sheet's own ink.
 */
export function drawPin(g, x, y, s, kind = 'note', { lift = 0 } = {}) {
  const k = PIN_KINDS[kind] ?? PIN_KINDS.note;
  const w = k.wash;
  withTransform(g, x, y - lift, s, (g) => {
    const ring = (R, wob) => {
      g.beginPath();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const r = R + Math.sin(i * 2.7 + R) * wob + Math.cos(i * 5.1) * wob * 0.6;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
    };
    // flat, painted on the sheet like the other glyphs: a pigment band laid in one even
    // wash (no gloss, no bevel, no cast shadow), ruled with fine ink and engraved hatching
    ring(34, 1.1);
    g.fillStyle = `rgba(${w[0]},${w[1]},${w[2]},${(0.6 + lift * 0.004).toFixed(3)})`;
    g.fill();
    // the engraver's hatching across the band
    g.save();
    ring(34, 1.1);
    g.clip();
    g.strokeStyle = `rgba(${w[0] * 0.45 | 0},${w[1] * 0.45 | 0},${w[2] * 0.45 | 0},0.32)`;
    g.lineWidth = 0.8;
    g.beginPath();
    for (let i = -40; i < 40; i += 3.4) { g.moveTo(i, -36); g.lineTo(i + 22, 36); }
    g.stroke();
    g.restore();
    g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2);
    g.fillStyle = 'rgb(243,233,206)';
    g.fill();
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.6;
    ring(34, 1.1);
    g.stroke();
    g.lineWidth = 0.8;
    g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.3;
    g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.stroke();
    drawMark(g, k.mark, w);
  });
}

function drawMark(g, mark, w) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = INK.ink;
  const tint = `rgba(${w[0]},${w[1]},${w[2]},0.55)`;
  const hatch = (clip, a = 0.8) => {
    g.save();
    clip();
    g.clip();
    g.lineWidth = 0.9;
    g.globalAlpha = 0.6;
    g.beginPath();
    for (let i = -24; i < 24; i += 3.2) { g.moveTo(i, -20); g.lineTo(i + 20 * a, 20); }
    g.stroke();
    g.restore();
  };
  if (mark === 'quill') {
    const vane = () => { g.beginPath(); g.moveTo(-11, 15); g.bezierCurveTo(-6, -2, 4, -12, 15, -17); g.bezierCurveTo(8, -4, 2, 6, -11, 15); g.closePath(); };
    vane(); g.fillStyle = tint; g.fill();
    g.save(); g.translate(0, 0); hatch(() => { g.beginPath(); g.moveTo(-11, 15); g.bezierCurveTo(-4, 4, 6, -6, 15, -17); g.lineTo(15, 20); g.lineTo(-11, 20); g.closePath(); }); g.restore();
    vane(); g.lineWidth = 2.2; g.stroke();
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(-15, 19); g.lineTo(-11, 15); g.quadraticCurveTo(0, 2, 13, -15); g.stroke();
  } else if (mark === 'skull') {
    const cran = () => { g.beginPath(); g.arc(0, -3, 12.5, Math.PI * 0.82, Math.PI * 2.18); g.lineTo(7, 9); g.lineTo(6, 14); g.lineTo(-6, 14); g.lineTo(-7, 9); g.closePath(); };
    cran(); g.fillStyle = 'rgba(232,220,196,0.95)'; g.fill();
    hatch(() => { g.beginPath(); g.rect(1, -16, 14, 32); }, 0.5);
    cran(); g.lineWidth = 2.2; g.stroke();
    g.fillStyle = INK.ink;
    g.beginPath(); g.ellipse(-5, -2, 3.6, 4.2, 0.2, 0, Math.PI * 2); g.ellipse(5, -2, 3.6, 4.2, -0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(0, 3); g.lineTo(-2, 7); g.lineTo(2, 7); g.closePath(); g.fill();
    g.lineWidth = 1.2;
    g.beginPath(); for (let i = -1; i <= 1; i++) { g.moveTo(i * 3, 10); g.lineTo(i * 3, 14); } g.stroke();
  } else if (mark === 'gem') {
    const gem = () => { g.beginPath(); g.moveTo(-14, -5); g.lineTo(-7, -13); g.lineTo(7, -13); g.lineTo(14, -5); g.lineTo(0, 15); g.closePath(); };
    gem(); g.fillStyle = tint; g.fill();
    hatch(() => { g.beginPath(); g.moveTo(0, -5); g.lineTo(14, -5); g.lineTo(0, 15); g.closePath(); });
    gem(); g.lineWidth = 2.2; g.stroke();
    g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(-14, -5); g.lineTo(14, -5); g.moveTo(-7, -13); g.lineTo(-4, -5); g.lineTo(0, 15); g.lineTo(4, -5); g.lineTo(7, -13); g.stroke();
  } else {
    const star = () => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? 6.5 : 16;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
    };
    star(); g.fillStyle = tint; g.fill();
    hatch(() => { g.beginPath(); g.rect(0, -18, 18, 36); });
    star(); g.lineWidth = 2.2; g.stroke();
  }
  g.restore();
}

/** Multiply a #rrggbb colour's brightness. */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/**
 * Marker glyphs in ink. kind: sign | text | battle | treasure | exit | stairs | shop | boat | shrine
 */
export function drawMarker(g, kind, x, y, s, { color = INK.ink, accent = INK.vermilion, angle = 0, seed = 0 } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(s / 100, s / 100);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 5;
  switch (kind) {
    case 'sign': {
      g.beginPath(); g.moveTo(-26, -24); g.lineTo(26, -24); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-16, -24); g.lineTo(-16, -14); g.moveTo(16, -24); g.lineTo(16, -14); g.stroke();
      g.fillStyle = 'rgba(150,112,70,0.45)';
      g.fillRect(-24, -14, 48, 28);
      g.lineWidth = 4;
      g.strokeRect(-24, -14, 48, 28);
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-14, -4); g.lineTo(14, -4); g.moveTo(-14, 5); g.lineTo(8, 5); g.stroke();
      break;
    }
    case 'text': {
      // unrolled scroll
      g.fillStyle = 'rgba(245,230,195,0.9)';
      g.beginPath(); g.moveTo(-22, -20); g.lineTo(22, -20); g.lineTo(22, 20); g.lineTo(-22, 20); g.closePath(); g.fill();
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = color;
      g.beginPath(); g.ellipse(-22, 0, 6, 22, 0, 0, Math.PI * 2); g.ellipse(22, 0, 6, 22, 0, 0, Math.PI * 2); g.fill();
      g.lineWidth = 2.5;
      g.beginPath(); for (let i = -1; i <= 1; i++) { g.moveTo(-12, i * 9); g.lineTo(12, i * 9); } g.stroke();
      break;
    }
    case 'battle': {
      // crossed swords, inked, with a touch of vermilion on the grips
      const jit = ((seed * 9301 + 49297) % 233280) / 233280;
      g.rotate((jit - 0.5) * 0.35);
      const sword = (dir) => {
        g.save();
        g.scale(dir, 1);
        g.rotate(-Math.PI / 4);
        g.fillStyle = 'rgba(236,226,204,0.95)';
        g.beginPath(); g.moveTo(0, -40); g.lineTo(4.5, -32); g.lineTo(4, 14); g.lineTo(-4, 14); g.lineTo(-4.5, -32); g.closePath();
        g.fill();
        g.lineWidth = 3; g.strokeStyle = color; g.stroke();
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(0, -30); g.lineTo(0, 10); g.stroke();
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(-13, 16); g.lineTo(13, 16); g.stroke();
        g.fillStyle = accent;
        g.fillRect(-3, 18, 6, 14);
        g.lineWidth = 2; g.strokeRect(-3, 18, 6, 14);
        g.fillStyle = color;
        g.beginPath(); g.arc(0, 36, 4.5, 0, Math.PI * 2); g.fill();
        g.restore();
      };
      sword(1);
      sword(-1);
      break;
    }
    case 'treasure': {
      g.fillStyle = 'rgba(150,104,60,0.6)';
      g.beginPath(); g.rect(-24, -6, 48, 26); g.fill();
      g.lineWidth = 4; g.stroke();
      g.save(); g.beginPath(); g.rect(4, -6, 20, 26); g.clip(); g.lineWidth = 1.4; g.globalAlpha = 0.6;
      g.beginPath(); for (let i = -10; i < 30; i += 5) { g.moveTo(i, -6); g.lineTo(i + 14, 20); } g.stroke(); g.restore();
      g.beginPath(); g.moveTo(-24, -6); g.quadraticCurveTo(0, -30, 24, -6); g.closePath();
      g.fillStyle = 'rgba(176,130,76,0.55)'; g.fill(); g.stroke();
      g.fillStyle = 'rgba(214,180,110,0.9)';
      g.beginPath(); g.rect(-5, -2, 10, 12); g.fill();
      g.lineWidth = 2; g.stroke();
      break;
    }
    case 'exit': {
      g.fillStyle = accent;
      g.beginPath(); g.moveTo(0, -28); g.lineTo(22, 2); g.lineTo(8, 2); g.lineTo(8, 26); g.lineTo(-8, 26); g.lineTo(-8, 2); g.lineTo(-22, 2); g.closePath();
      g.fill();
      g.lineWidth = 3; g.strokeStyle = color; g.stroke();
      break;
    }
    case 'stairs': {
      g.lineWidth = 4;
      for (let i = 0; i < 5; i++) {
        const w = 44 - i * 8;
        g.strokeRect(-w / 2, -24 + i * 10, w, 8);
      }
      break;
    }
    case 'shop': {
      g.fillStyle = 'rgba(190,140,50,0.8)';
      g.beginPath(); g.moveTo(-10, -18); g.quadraticCurveTo(0, -10, 10, -18); g.lineTo(6, -10); g.quadraticCurveTo(26, 4, 16, 20); g.lineTo(-16, 20); g.quadraticCurveTo(-26, 4, -6, -10); g.closePath();
      g.fill(); g.lineWidth = 4; g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(-7, -10); g.lineTo(7, -10); g.stroke();
      break;
    }
    case 'boat': {
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(-28, 6); g.quadraticCurveTo(0, 26, 28, 6); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(0, 6); g.lineTo(0, -28); g.stroke();
      g.fillStyle = 'rgba(245,230,195,0.85)';
      g.beginPath(); g.moveTo(3, -26); g.quadraticCurveTo(22, -12, 3, 2); g.closePath(); g.fill(); g.stroke();
      break;
    }
    case 'shrine': {
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(-18, 20); g.lineTo(18, 20); g.moveTo(-12, 20); g.lineTo(-12, -6); g.moveTo(12, 20); g.lineTo(12, -6); g.stroke();
      g.beginPath(); g.moveTo(-20, -6); g.lineTo(0, -24); g.lineTo(20, -6); g.closePath(); g.stroke();
      g.fillStyle = accent;
      g.beginPath(); g.arc(0, 6, 5, 0, Math.PI * 2); g.fill();
      break;
    }
    default: {
      g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

/** Render a glyph to a small data URL (legend / notes list icons). */
const urlCache = new Map();
export function glyphDataURL(key, draw, size = 40) {
  if (urlCache.has(key)) return urlCache.get(key);
  const c = makeCanvas(size * 2);
  const g = c.getContext('2d');
  draw(g, size, size, size * 1.6);
  const u = c.toDataURL();
  urlCache.set(key, u);
  return u;
}
