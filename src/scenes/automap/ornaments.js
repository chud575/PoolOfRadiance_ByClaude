import { INK, prng } from './ink.js';

/**
 * Cartographic ornaments: compass rose, illuminated initial, cartouche,
 * double-ruled borders and flourishes. All coordinates in the caller's units.
 */

export const SERIF = '"FreeSerif", "Bitstream Charter", "DejaVu Serif", Georgia, serif';

export function goldGradient(g, x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#fff1c4');
  gr.addColorStop(0.28, '#e2bd62');
  gr.addColorStop(0.55, '#9a7128');
  gr.addColorStop(0.78, '#d9b45c');
  gr.addColorStop(1, '#f6e1a0');
  return gr;
}

/** A 32-point compass rose with fleur-de-lis north. */
export function drawCompassRose(g, cx, cy, R, { rotation = 0 } = {}) {
  g.save();
  g.translate(cx, cy);
  // soft wash disc
  const wash = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.05);
  wash.addColorStop(0, 'rgba(210,170,90,0.16)');
  wash.addColorStop(1, 'rgba(210,170,90,0)');
  g.fillStyle = wash;
  g.beginPath(); g.arc(0, 0, R * 1.05, 0, Math.PI * 2); g.fill();
  g.rotate(rotation);
  // rings
  g.strokeStyle = INK.ink;
  g.lineWidth = R * 0.012;
  for (const r of [0.98, 0.9, 0.62]) { g.beginPath(); g.arc(0, 0, R * r, 0, Math.PI * 2); g.stroke(); }
  // degree ticks between outer rings
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const L = i % 16 === 0 ? 0.08 : i % 4 === 0 ? 0.05 : 0.025;
    g.lineWidth = R * (i % 4 === 0 ? 0.01 : 0.006);
    g.beginPath();
    g.moveTo(Math.sin(a) * R * 0.9, -Math.cos(a) * R * 0.9);
    g.lineTo(Math.sin(a) * R * (0.9 + L), -Math.cos(a) * R * (0.9 + L));
    g.stroke();
  }
  // alternating ring band (vermilion / paper)
  for (let i = 0; i < 32; i++) {
    const a0 = (i / 32) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / 32) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.arc(0, 0, R * 0.62, a0, a1);
    g.arc(0, 0, R * 0.56, a1, a0, true);
    g.closePath();
    g.fillStyle = i % 2 ? 'rgba(168,50,40,0.75)' : 'rgba(245,230,195,0.9)';
    g.fill();
  }
  g.lineWidth = R * 0.008;
  g.beginPath(); g.arc(0, 0, R * 0.56, 0, Math.PI * 2); g.stroke();
  const point = (a, len, wid, light, dark) => {
    g.save();
    g.rotate(a);
    g.beginPath(); g.moveTo(0, -len); g.lineTo(wid, 0); g.lineTo(0, 0); g.closePath();
    g.fillStyle = dark; g.fill();
    g.beginPath(); g.moveTo(0, -len); g.lineTo(-wid, 0); g.lineTo(0, 0); g.closePath();
    g.fillStyle = light; g.fill();
    g.beginPath(); g.moveTo(0, -len); g.lineTo(wid, 0); g.lineTo(-wid, 0); g.closePath();
    g.strokeStyle = INK.ink; g.lineWidth = R * 0.01; g.stroke();
    g.restore();
  };
  for (let i = 0; i < 16; i++) point((i + 0.5) * Math.PI / 8, R * 0.5, R * 0.04, '#f1e4c4', '#6b4a22');
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + i * Math.PI / 2, R * 0.68, R * 0.085, '#e9d9b4', INK.ultramarine);
  const gold = goldGradient(g, -R, -R, R, R);
  for (let i = 0; i < 4; i++) point(i * Math.PI / 2, R * 0.97, R * 0.12, i === 0 ? '#f7e7bd' : '#efe0bb', i === 0 ? INK.vermilion : INK.ink);
  // centre boss
  g.fillStyle = gold;
  g.beginPath(); g.arc(0, 0, R * 0.075, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK.ink; g.lineWidth = R * 0.012; g.stroke();
  g.fillStyle = INK.vermilion;
  g.beginPath(); g.arc(0, 0, R * 0.03, 0, Math.PI * 2); g.fill();
  // fleur-de-lis north
  drawFleur(g, 0, -R * 1.13, R * 0.2);
  // cardinal letters
  g.fillStyle = INK.ink;
  g.font = `italic ${Math.round(R * 0.16)}px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('E', R * 1.1, 0);
  g.fillText('S', 0, R * 1.1);
  g.fillText('W', -R * 1.1, 0);
  g.restore();
}

/** Stylised fleur-de-lis (gilt with ink outline), centred at (x, y). */
export function drawFleur(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  g.beginPath();
  g.moveTo(0, -60);
  g.bezierCurveTo(22, -34, 20, -8, 6, 16);
  g.lineTo(-6, 16);
  g.bezierCurveTo(-20, -8, -22, -34, 0, -60);
  g.moveTo(8, 8);
  g.bezierCurveTo(24, -26, 66, -16, 50, 14);
  g.bezierCurveTo(44, 0, 30, 2, 12, 20);
  g.moveTo(-8, 8);
  g.bezierCurveTo(-24, -26, -66, -16, -50, 14);
  g.bezierCurveTo(-44, 0, -30, 2, -12, 20);
  g.fillStyle = goldGradient(g, -50, -60, 50, 30);
  g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = INK.vermilion;
  g.fillRect(-26, 18, 52, 12);
  g.strokeRect(-26, 18, 52, 12);
  g.beginPath();
  g.moveTo(-6, 30); g.lineTo(-10, 48); g.lineTo(0, 40); g.lineTo(10, 48); g.lineTo(6, 30);
  g.fillStyle = goldGradient(g, -10, 30, 10, 48);
  g.fill(); g.stroke();
  g.restore();
}

/**
 * Illuminated initial: gold-leaf frame, ultramarine field with white filigree,
 * a gilt capital with ink outline. (x, y) top-left, size s.
 */
export function drawIlluminatedInitial(g, letter, x, y, s, { seed = 3 } = {}) {
  g.save();
  g.translate(x, y);
  const r = prng(seed);
  // gold leaf square with slight raised edge
  g.fillStyle = goldGradient(g, 0, 0, s, s);
  g.fillRect(0, 0, s, s);
  g.strokeStyle = INK.ink;
  g.lineWidth = s * 0.02;
  g.strokeRect(0, 0, s, s);
  const m = s * 0.09;
  // field: quartered ultramarine / carmine like a Gothic initial
  const field = g.createLinearGradient(0, 0, s, s);
  field.addColorStop(0, '#34579f');
  field.addColorStop(1, '#1d3470');
  g.fillStyle = field;
  g.fillRect(m, m, s - m * 2, s - m * 2);
  g.save();
  g.beginPath(); g.rect(m, m, s - m * 2, s - m * 2); g.clip();
  g.fillStyle = 'rgba(160,40,50,0.85)';
  g.beginPath(); g.moveTo(m, m); g.lineTo(s - m, s - m); g.lineTo(m, s - m); g.closePath(); g.fill();
  // white filigree vines
  g.strokeStyle = 'rgba(250,240,220,0.75)';
  g.lineWidth = s * 0.012;
  for (let i = 0; i < 9; i++) {
    const cx = m + r() * (s - 2 * m);
    const cy = m + r() * (s - 2 * m);
    const rr = s * (0.05 + r() * 0.06);
    g.beginPath();
    for (let t = 0; t < 1.6 * Math.PI * 2; t += 0.2) {
      const q = rr * (1 - t / (1.8 * Math.PI * 2));
      const px = cx + Math.cos(t + i) * q;
      const py = cy + Math.sin(t + i) * q;
      if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
  g.fillStyle = 'rgba(250,240,220,0.8)';
  for (let i = 0; i < 16; i++) {
    g.beginPath(); g.arc(m + r() * (s - 2 * m), m + r() * (s - 2 * m), s * 0.01, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  g.strokeStyle = INK.ink;
  g.lineWidth = s * 0.015;
  g.strokeRect(m, m, s - m * 2, s - m * 2);
  // the capital
  g.font = `bold ${Math.round(s * 0.74)}px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(20,10,0,0.85)';
  g.lineWidth = s * 0.05;
  g.strokeText(letter, s / 2, s * 0.54);
  g.fillStyle = goldGradient(g, s * 0.2, s * 0.15, s * 0.8, s * 0.9);
  g.fillText(letter, s / 2, s * 0.54);
  g.strokeStyle = 'rgba(255,245,210,0.55)';
  g.lineWidth = s * 0.008;
  g.strokeText(letter, s / 2 - s * 0.006, s * 0.535);
  // corner pips
  g.fillStyle = INK.vermilion;
  for (const [px, py] of [[0, 0], [s, 0], [0, s], [s, s]]) {
    g.beginPath(); g.arc(px, py, s * 0.05, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink; g.lineWidth = s * 0.012; g.stroke();
  }
  g.restore();
}

/** Scrolled strapwork cartouche frame (x, y, w, h). */
export function drawCartouche(g, x, y, w, h) {
  g.save();
  const n = 16; // corner notch radius
  const path = (o) => {
    const X = x + o;
    const Y = y + o;
    const W = w - 2 * o;
    const H = h - 2 * o;
    const r = Math.max(2, n - o);
    g.beginPath();
    g.moveTo(X + r, Y);
    g.lineTo(X + W - r, Y);
    g.arc(X + W, Y, r, Math.PI, Math.PI / 2, true);
    g.lineTo(X + W, Y + H - r);
    g.arc(X + W, Y + H, r, -Math.PI / 2, Math.PI, true);
    g.lineTo(X + r, Y + H);
    g.arc(X, Y + H, r, 0, -Math.PI / 2, true);
    g.lineTo(X, Y + r);
    g.arc(X, Y, r, Math.PI / 2, 0, true);
    g.closePath();
  };
  g.save();
  g.shadowColor = 'rgba(60,35,10,0.35)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  const body = g.createLinearGradient(x, y, x, y + h);
  body.addColorStop(0, 'rgba(251,241,214,0.97)');
  body.addColorStop(1, 'rgba(236,218,178,0.97)');
  g.fillStyle = body;
  path(0);
  g.fill();
  g.restore();
  g.strokeStyle = goldGradient(g, x, y, x + w, y + h);
  g.lineWidth = 6;
  path(5);
  g.stroke();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.4;
  path(0);
  g.stroke();
  g.lineWidth = 0.9;
  path(9);
  g.stroke();
  // corner fleurons
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    g.fillStyle = INK.vermilion;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 3 : 7;
      if (i === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.lineWidth = 0.8;
    g.stroke();
  }
  g.restore();
}

/** A horizontal calligraphic flourish centred at (cx, cy). */
export function drawFlourish(g, cx, cy, w, { color = INK.ink, width = 1.4 } = {}) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  const h = w * 0.08;
  g.beginPath();
  g.moveTo(cx - w / 2, cy);
  g.bezierCurveTo(cx - w * 0.3, cy - h * 2, cx - w * 0.15, cy + h * 2, cx - w * 0.04, cy);
  g.moveTo(cx + w / 2, cy);
  g.bezierCurveTo(cx + w * 0.3, cy - h * 2, cx + w * 0.15, cy + h * 2, cx + w * 0.04, cy);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx, cy - h * 0.9); g.lineTo(cx + h * 0.7, cy); g.lineTo(cx, cy + h * 0.9); g.lineTo(cx - h * 0.7, cy); g.closePath();
  g.fill();
  g.restore();
}

/** Fit text into maxWidth by shrinking the font; returns the font size used. */
export function fitFont(g, text, maxWidth, size, style = '') {
  let s = size;
  for (;;) {
    g.font = `${style} ${s}px ${SERIF}`;
    if (g.measureText(text).width <= maxWidth || s <= 6) return s;
    s -= 1;
  }
}

/** Word-wrap into lines no wider than maxWidth with the current font. */
export function wrapText(g, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Text with a paper-coloured halo so it reads over ink. */
export function haloText(g, text, x, y, { halo = 'rgba(240,226,190,0.9)', width = 4, color = INK.ink } = {}) {
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = halo;
  g.lineWidth = width;
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}
