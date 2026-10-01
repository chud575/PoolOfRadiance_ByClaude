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
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(s / 100, s / 100);
  const outline = () => {
    g.beginPath();
    g.moveTo(0, -48);
    g.quadraticCurveTo(10, -14, 29, 27);
    g.quadraticCurveTo(14, 18, 0, 13);
    g.quadraticCurveTo(-14, 18, -29, 27);
    g.quadraticCurveTo(-10, -14, 0, -48);
    g.closePath();
  };
  // shadow on the paper
  g.save();
  g.translate(5, 6);
  outline();
  g.fillStyle = `rgba(60,28,10,${(0.18 + glow * 0.1).toFixed(3)})`;
  g.fill();
  g.restore();
  // body wash
  outline();
  g.fillStyle = 'rgba(190,52,30,0.94)';
  g.fill();
  g.save();
  outline();
  g.clip();
  // shaded flank
  g.fillStyle = 'rgba(110,22,12,0.55)';
  g.beginPath(); g.moveTo(0, -50); g.lineTo(34, 30); g.lineTo(0, 14); g.closePath(); g.fill();
  // pigment pooled toward the barbs
  const pool = g.createLinearGradient(0, -48, 0, 28);
  pool.addColorStop(0, 'rgba(255,170,120,0.18)');
  pool.addColorStop(0.6, 'rgba(0,0,0,0)');
  pool.addColorStop(1, 'rgba(90,15,8,0.35)');
  g.fillStyle = pool;
  g.fillRect(-32, -50, 64, 80);
  // brush streaks along the stroke
  g.strokeStyle = 'rgba(90,16,8,0.22)';
  g.lineWidth = 1.4;
  for (let i = -3; i <= 3; i++) {
    g.beginPath(); g.moveTo(i * 2.2, -40 + Math.abs(i) * 6); g.lineTo(i * 7.5, 22 - Math.abs(i)); g.stroke();
  }
  // pale highlight on the lit edge
  g.strokeStyle = 'rgba(255,214,170,0.55)';
  g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(-3, -36); g.quadraticCurveTo(-11, -6, -22, 20); g.stroke();
  g.restore();
  // ink outline
  outline();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(43,22,10,0.95)';
  g.lineWidth = 3.4;
  g.stroke();
  // gilt boss
  g.fillStyle = INK.goldHi;
  g.beginPath(); g.arc(0, 2, 5.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK.goldLo;
  g.lineWidth = 1.6;
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
  gr.addColorStop(0, 'rgba(200,80,40,0.55)');
  gr.addColorStop(0.5, 'rgba(210,130,64,0.28)');
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

/** Pin kinds for player notes. */
export const PIN_KINDS = {
  note: { label: 'Note', color: '#a8323a', mark: 'quill' },
  danger: { label: 'Danger', color: '#3a2a22', mark: 'skull' },
  treasure: { label: 'Treasure', color: '#b8862a', mark: 'gem' },
  quest: { label: 'Quest', color: '#2c4a8c', mark: 'star' },
};
export const PIN_ORDER = ['note', 'danger', 'treasure', 'quest'];

/** Wax-seal pin. */
export function drawPin(g, x, y, s, kind = 'note', { lift = 0 } = {}) {
  const k = PIN_KINDS[kind] ?? PIN_KINDS.note;
  withTransform(g, x, y - lift, s, (g) => {
    g.fillStyle = 'rgba(20,8,0,0.35)';
    g.beginPath(); g.ellipse(6, 10 + lift * 100 / s, 34, 30, 0, 0, Math.PI * 2); g.fill();
    // blobby seal edge
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = 36 + Math.sin(i * 2.7) * 2.5 + Math.cos(i * 5.1) * 1.8;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    const gr = g.createRadialGradient(-12, -14, 4, 0, 0, 40);
    gr.addColorStop(0, shade(k.color, 1.6));
    gr.addColorStop(0.55, k.color);
    gr.addColorStop(1, shade(k.color, 0.55));
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.stroke();
    // inner ring
    g.strokeStyle = shade(k.color, 0.6);
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,240,210,0.35)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(-1, -1, 25, Math.PI * 0.9, Math.PI * 1.7); g.stroke();
    drawMark(g, k.mark, shade(k.color, 0.45), 'rgba(255,235,200,0.35)');
  });
}

function drawMark(g, mark, dark, light) {
  g.save();
  const both = (fn) => {
    g.save(); g.translate(-1, -1); g.fillStyle = light; g.strokeStyle = light; fn(); g.restore();
    g.save(); g.fillStyle = dark; g.strokeStyle = dark; fn(); g.restore();
  };
  g.lineWidth = 4;
  g.lineCap = 'round';
  if (mark === 'quill') {
    both(() => {
      g.beginPath(); g.moveTo(-12, 14); g.quadraticCurveTo(0, -4, 14, -16); g.quadraticCurveTo(4, 2, -12, 14); g.fill();
      g.beginPath(); g.moveTo(-14, 16); g.lineTo(-4, 6); g.stroke();
    });
  } else if (mark === 'skull') {
    both(() => {
      g.beginPath(); g.arc(0, -3, 13, Math.PI * 0.9, Math.PI * 2.1); g.lineTo(8, 13); g.lineTo(-8, 13); g.closePath(); g.fill();
    });
    g.fillStyle = 'rgba(255,230,200,0.55)';
    g.beginPath(); g.arc(-5, -2, 3.5, 0, Math.PI * 2); g.arc(5, -2, 3.5, 0, Math.PI * 2); g.fill();
  } else if (mark === 'gem') {
    both(() => {
      g.beginPath(); g.moveTo(-13, -5); g.lineTo(-6, -13); g.lineTo(6, -13); g.lineTo(13, -5); g.lineTo(0, 14); g.closePath(); g.fill();
    });
    g.strokeStyle = 'rgba(255,240,210,0.4)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-13, -5); g.lineTo(13, -5); g.moveTo(-5, -5); g.lineTo(0, 14); g.lineTo(5, -5); g.stroke();
  } else {
    both(() => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? 6 : 15;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath(); g.fill();
    });
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
      g.fillStyle = 'rgba(160,110,50,0.55)';
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
      g.fillStyle = 'rgba(170,110,40,0.75)';
      g.beginPath(); g.rect(-24, -6, 48, 26); g.fill();
      g.lineWidth = 4; g.stroke();
      g.beginPath(); g.moveTo(-24, -6); g.quadraticCurveTo(0, -30, 24, -6); g.closePath();
      g.fillStyle = 'rgba(200,140,60,0.75)'; g.fill(); g.stroke();
      g.fillStyle = INK.gold;
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
