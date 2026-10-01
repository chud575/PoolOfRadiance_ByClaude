import { rgba, glow, glowEllipse, linGrad, archPath, gothicPath, texture, masonry, planks, contactShadow, rngOf, poly, mix } from './paint.js';

/**
 * Painted props for the illustrated panels. Each draws at (x, y) = base
 * centre on the ground unless noted, sized by s (≈ px per metre).
 * Key light comes from the left (torch/sun), rim light from the right.
 */

export function windowLit(g, x, y, w, h, { lit = 1, color = '#ffb45a', arch = false, gothic = false, mullion = true, frame = '#2a1c10', glass = null } = {}) {
  g.save();
  const path = () => (gothic ? gothicPath(g, x, y, w, h) : arch ? archPath(g, x, y, w, h) : g.rect(x, y, w, h));
  g.beginPath();
  path();
  if (glass) {
    g.save();
    g.clip();
    stainedGlass(g, x, y, w, h, glass);
    g.restore();
  } else {
    g.fillStyle = lit > 0 ? linGrad(g, x, y, x, y + h, [[0, rgba(color, 0.95 * lit, 1.15)], [1, rgba(color, 0.85 * lit, 0.75)]]) : '#0b0d14';
    g.fill();
  }
  if (mullion) {
    g.strokeStyle = frame;
    g.lineWidth = Math.max(1.5, w * 0.07);
    g.beginPath();
    g.moveTo(x + w / 2, y + (arch || gothic ? w * 0.2 : 0));
    g.lineTo(x + w / 2, y + h);
    g.moveTo(x, y + h * 0.55);
    g.lineTo(x + w, y + h * 0.55);
    g.stroke();
  }
  g.lineWidth = Math.max(2, w * 0.09);
  g.strokeStyle = frame;
  g.beginPath();
  path();
  g.stroke();
  g.restore();
  if (lit > 0 && !glass) glow(g, x + w / 2, y + h / 2, Math.max(w, h) * 1.4, color, 0.35 * lit);
}

export function stainedGlass(g, x, y, w, h, colors) {
  const r = rngOf(Math.round(x * 7 + y * 13));
  const cols = Math.max(2, Math.round(w / 14));
  const rows = Math.max(3, Math.round(h / 16));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = colors[(i + j * 3 + (r() < 0.3 ? 1 : 0)) % colors.length];
      g.fillStyle = rgba(c, 1, 0.8 + r() * 0.5);
      g.fillRect(x + (i * w) / cols, y + (j * h) / rows, w / cols + 0.5, h / rows + 0.5);
    }
  }
  // central emblem roundel
  g.fillStyle = rgba(colors[1] ?? colors[0], 1, 1.25);
  g.beginPath();
  g.arc(x + w / 2, y + h * 0.42, w * 0.28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(20,14,10,0.9)';
  g.lineWidth = 1.4;
  for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo(x + (i * w) / cols, y); g.lineTo(x + (i * w) / cols, y + h); g.stroke(); }
  for (let j = 1; j < rows; j++) { g.beginPath(); g.moveTo(x, y + (j * h) / rows); g.lineTo(x + w, y + (j * h) / rows); g.stroke(); }
  g.beginPath();
  g.arc(x + w / 2, y + h * 0.42, w * 0.28, 0, Math.PI * 2);
  g.stroke();
  glow(g, x + w / 2, y + h * 0.4, Math.max(w, h) * 0.9, colors[0], 0.35, 'screen');
}

export function barrel(g, x, y, s, seed = 1) {
  const w = s * 0.62;
  const h = s * 0.9;
  contactShadow(g, x, y, w * 0.9, w * 0.25, 0.5);
  g.save();
  g.beginPath();
  g.moveTo(x - w * 0.42, y);
  g.bezierCurveTo(x - w * 0.56, y - h * 0.35, x - w * 0.56, y - h * 0.65, x - w * 0.42, y - h);
  g.lineTo(x + w * 0.42, y - h);
  g.bezierCurveTo(x + w * 0.56, y - h * 0.65, x + w * 0.56, y - h * 0.35, x + w * 0.42, y);
  g.closePath();
  g.fillStyle = linGrad(g, x - w * 0.55, 0, x + w * 0.55, 0, [[0, '#8a5a30'], [0.35, '#6a4222'], [0.8, '#2e1c0e'], [1, '#1a0f08']]);
  g.fill();
  g.clip();
  texture(g, x - w, y - h, w * 2, h, { alpha: 0.4, cells: 32, octaves: 2, seed });
  g.fillStyle = 'rgba(40,34,30,0.9)';
  for (const t of [0.16, 0.8]) g.fillRect(x - w, y - h * t - s * 0.03, w * 2, s * 0.05);
  g.fillStyle = 'rgba(200,180,150,0.25)';
  for (const t of [0.16, 0.8]) g.fillRect(x - w, y - h * t - s * 0.03, w * 2, s * 0.012);
  g.restore();
  g.fillStyle = '#3a2614';
  g.beginPath();
  g.ellipse(x, y - h, w * 0.42, w * 0.1, 0, 0, Math.PI * 2);
  g.fill();
}

export function crate(g, x, y, s, seed = 1) {
  const w = s * 0.8;
  contactShadow(g, x, y, w * 0.8, w * 0.18, 0.5);
  planks(g, x - w / 2, y - w, w, w, { base: '#6a4a2a', width: w / 4, vertical: false, seed });
  g.strokeStyle = 'rgba(20,12,6,0.9)';
  g.lineWidth = s * 0.04;
  g.strokeRect(x - w / 2, y - w, w, w);
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.lineTo(x + w / 2, y - w);
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x + w * 0.2, y - w, w * 0.3, w);
}

export function table(g, x, y, s, { cloth = null, items = true, seed = 1 } = {}) {
  const w = s * 1.8;
  const top = y - s * 0.75;
  contactShadow(g, x, y, w * 0.6, s * 0.15, 0.55);
  g.fillStyle = '#2a1a0e';
  for (const dx of [-0.42, 0.42]) g.fillRect(x + dx * w - s * 0.05, top, s * 0.1, s * 0.75);
  g.fillStyle = linGrad(g, 0, top - s * 0.08, 0, top + s * 0.06, [[0, '#8a6038'], [1, '#3a2412']]);
  g.fillRect(x - w / 2, top - s * 0.06, w, s * 0.12);
  if (cloth) {
    g.fillStyle = cloth;
    g.fillRect(x - w * 0.3, top - s * 0.06, w * 0.6, s * 0.3);
  }
  if (items) {
    const r = rngOf(seed);
    for (let i = 0; i < 3; i++) {
      const ix = x + (r() - 0.5) * w * 0.7;
      g.fillStyle = r() < 0.5 ? '#9a8a6a' : '#6a4a2a';
      g.fillRect(ix - s * 0.06, top - s * 0.22, s * 0.12, s * 0.16); // tankards
      g.fillStyle = 'rgba(255,220,160,0.3)';
      g.fillRect(ix - s * 0.06, top - s * 0.22, s * 0.03, s * 0.16);
    }
  }
}

/** Bookshelf with procedurally varied spines. x,y = top-left. */
export function bookshelf(g, x, y, w, h, { seed = 1, shelves = 5, wood = '#3a2414', dust = 0.2 } = {}) {
  const r = rngOf(seed);
  g.fillStyle = wood;
  g.fillRect(x, y, w, h);
  const sh = h / shelves;
  const spines = ['#6a1e1a', '#1e3a5a', '#2a4a24', '#5a3a1a', '#4a2a4a', '#7a5a2a', '#2a2a2a', '#8a6a3a', '#3a1a12'];
  for (let i = 0; i < shelves; i++) {
    const sy = y + i * sh;
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(x + w * 0.03, sy + sh * 0.08, w * 0.94, sh * 0.84);
    let bx = x + w * 0.04;
    while (bx < x + w * 0.95) {
      const bw = sh * (0.08 + r() * 0.1);
      if (r() < 0.07) { bx += bw * 2; continue; }
      const bh = sh * (0.55 + r() * 0.3);
      const lean = r() < 0.06 ? (r() - 0.5) * 0.4 : 0;
      g.save();
      g.translate(bx, sy + sh * 0.92);
      g.rotate(lean);
      g.fillStyle = rgba(r.pick(spines), 1, 0.7 + r() * 0.6);
      g.fillRect(0, -bh, bw, bh);
      g.fillStyle = 'rgba(230,190,110,0.5)';
      if (r() < 0.6) g.fillRect(0, -bh * 0.8, bw, Math.max(1, bh * 0.04));
      if (r() < 0.5) g.fillRect(0, -bh * 0.25, bw, Math.max(1, bh * 0.03));
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(bw * 0.7, -bh, bw * 0.3, bh);
      g.restore();
      bx += bw + 0.6;
    }
    g.fillStyle = linGrad(g, 0, sy + sh * 0.9, 0, sy + sh, [[0, '#5a3a20'], [1, '#1a0e06']]);
    g.fillRect(x, sy + sh * 0.9, w, sh * 0.1);
  }
  g.strokeStyle = '#1a0e06';
  g.lineWidth = w * 0.04;
  g.strokeRect(x, y, w, h);
  if (dust) texture(g, x, y, w, h, { alpha: dust, mode: 'screen', cells: 8, seed: seed + 5 });
}

/** Shelf of glowing bottles / jars. x,y top-left. */
export function bottleShelf(g, x, y, w, h, { seed = 1, shelves = 3, magic = false } = {}) {
  const r = rngOf(seed);
  const sh = h / shelves;
  g.fillStyle = '#24160c';
  g.fillRect(x, y, w, h);
  const cols = magic ? ['#5ad0ff', '#ff5a9a', '#9aff6a', '#ffd05a', '#b07aff'] : ['#6a8a4a', '#8a5a2a', '#5a6a7a', '#9a8a5a'];
  for (let i = 0; i < shelves; i++) {
    const sy = y + (i + 1) * sh;
    let bx = x + sh * 0.1;
    while (bx < x + w - sh * 0.2) {
      const bw = sh * (0.14 + r() * 0.12);
      const bh = sh * (0.35 + r() * 0.4);
      const c = r.pick(cols);
      g.fillStyle = rgba(c, 0.9, 0.7);
      g.beginPath();
      g.roundRect(bx, sy - bh - sh * 0.1, bw, bh, bw * 0.3);
      g.fill();
      g.fillRect(bx + bw * 0.35, sy - bh - sh * 0.1 - bh * 0.25, bw * 0.3, bh * 0.25);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(bx + bw * 0.15, sy - bh - sh * 0.05, bw * 0.12, bh * 0.6);
      if (magic && r() < 0.45) glow(g, bx + bw / 2, sy - bh * 0.5 - sh * 0.1, bh * 0.9, c, 0.35);
      bx += bw + sh * (0.05 + r() * 0.12);
    }
    g.fillStyle = linGrad(g, 0, sy - sh * 0.1, 0, sy, [[0, '#6a4424'], [1, '#1a0e06']]);
    g.fillRect(x, sy - sh * 0.1, w, sh * 0.1);
  }
}

export function banner(g, x, y, w, h, color, { emblem = null, trim = '#d8b25a', tatter = 0, seed = 1 } = {}) {
  const r = rngOf(seed);
  g.save();
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h);
  const n = 5;
  for (let i = n; i >= 0; i--) {
    const px = x + (w * i) / n;
    const py = y + h - (i % 2 ? h * 0.1 : 0) - (tatter ? r() * h * tatter : 0);
    g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = linGrad(g, x, 0, x + w, 0, [[0, rgba(color, 1, 1.25)], [0.45, rgba(color, 1, 0.95)], [0.7, rgba(color, 1, 0.7)], [1, rgba(color, 1, 0.45)]]);
  g.fill();
  g.clip();
  // folds
  for (let i = 1; i < 4; i++) {
    g.fillStyle = `rgba(0,0,0,${0.12 + (i % 2) * 0.1})`;
    g.fillRect(x + (w * i) / 4 - w * 0.03, y, w * 0.06, h);
  }
  texture(g, x, y, w, h, { alpha: 0.35, cells: 32, octaves: 2, seed });
  g.fillStyle = trim;
  g.fillRect(x, y + h * 0.04, w, h * 0.02);
  if (emblem) emblemShape(g, emblem, x + w / 2, y + h * 0.42, w * 0.3, trim);
  g.restore();
  g.fillStyle = '#2a1c10';
  g.fillRect(x - w * 0.08, y - h * 0.02, w * 1.16, h * 0.03);
}

export function emblemShape(g, kind, cx, cy, s, color) {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = s * 0.12;
  if (kind === 'scales') {
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.lineTo(cx, cy + s * 0.8);
    g.moveTo(cx - s, cy - s * 0.6);
    g.lineTo(cx + s, cy - s * 0.6);
    g.stroke();
    for (const d of [-1, 1]) {
      g.beginPath();
      g.arc(cx + d * s * 0.85, cy - s * 0.1, s * 0.35, 0, Math.PI);
      g.fill();
    }
  } else if (kind === 'heart') {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.8);
    g.bezierCurveTo(cx - s * 1.3, cy - s * 0.1, cx - s * 0.6, cy - s * 1.1, cx, cy - s * 0.4);
    g.bezierCurveTo(cx + s * 0.6, cy - s * 1.1, cx + s * 1.3, cy - s * 0.1, cx, cy + s * 0.8);
    g.fill();
  } else if (kind === 'sword') {
    g.fillRect(cx - s * 0.08, cy - s, s * 0.16, s * 1.7);
    g.fillRect(cx - s * 0.5, cy + s * 0.35, s, s * 0.14);
  } else if (kind === 'hand') {
    g.beginPath();
    g.ellipse(cx, cy + s * 0.2, s * 0.45, s * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 4; i++) g.fillRect(cx - s * 0.42 + i * s * 0.25, cy - s * 0.9, s * 0.17, s * 0.9);
    g.save();
    g.translate(cx - s * 0.5, cy + s * 0.1);
    g.rotate(-0.8);
    g.fillRect(-s * 0.08, -s * 0.5, s * 0.17, s * 0.5);
    g.restore();
  } else if (kind === 'eye') {
    g.beginPath();
    g.ellipse(cx, cy, s, s * 0.5, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'crown') {
    poly(g, [[cx - s, cy + s * 0.5], [cx - s, cy - s * 0.4], [cx - s * 0.5, cy], [cx, cy - s * 0.7], [cx + s * 0.5, cy], [cx + s, cy - s * 0.4], [cx + s, cy + s * 0.5]]);
    g.fill();
  } else {
    // chevron
    g.beginPath();
    g.moveTo(cx - s, cy + s * 0.4);
    g.lineTo(cx, cy - s * 0.5);
    g.lineTo(cx + s, cy + s * 0.4);
    g.stroke();
  }
  g.restore();
}

export function column(g, x, yTop, yBot, w, { base = '#7a7064', broken = 0, seed = 1 } = {}) {
  const top = yTop + broken * (yBot - yTop);
  g.save();
  g.fillStyle = linGrad(g, x - w / 2, 0, x + w / 2, 0, [[0, rgba(base, 1, 1.25)], [0.3, rgba(base, 1, 1.05)], [0.75, rgba(base, 1, 0.55)], [1, rgba(base, 1, 0.3)]]);
  if (broken) {
    const r = rngOf(seed);
    poly(g, [[x - w / 2, yBot], [x - w / 2, top + r() * w * 0.4], [x - w * 0.1, top - r() * w * 0.3], [x + w * 0.2, top + r() * w * 0.5], [x + w / 2, top + r() * w * 0.2], [x + w / 2, yBot]]);
    g.fill();
  } else {
    g.fillRect(x - w / 2, top, w, yBot - top);
    g.fillRect(x - w * 0.65, top, w * 1.3, w * 0.28);
  }
  // flutes
  g.globalAlpha = 0.25;
  g.fillStyle = '#000';
  for (let i = -2; i <= 2; i++) g.fillRect(x + i * w * 0.18 - w * 0.02, top + w * 0.3, w * 0.04, yBot - top - w * 0.6);
  g.globalAlpha = 1;
  g.fillStyle = linGrad(g, x - w * 0.7, 0, x + w * 0.7, 0, [[0, rgba(base, 1, 1.1)], [1, rgba(base, 1, 0.35)]]);
  g.fillRect(x - w * 0.7, yBot - w * 0.35, w * 1.4, w * 0.35);
  g.restore();
  texture(g, x - w * 0.7, top, w * 1.4, yBot - top, { alpha: 0.3, cells: 16, seed: seed + 2 });
}

export function gravestone(g, x, y, s, { kind = 0, lean = 0, base = '#8a8478', moss = 0.3, seed = 1 } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(lean);
  contactShadow(g, 0, 0, s * 0.6, s * 0.12, 0.55);
  const w = s * 0.55;
  const h = s * (kind === 2 ? 1.25 : 0.85);
  g.beginPath();
  if (kind === 0) archPath(g, -w / 2, -h, w, h);
  else if (kind === 1) g.rect(-w / 2, -h, w, h);
  else {
    // cross
    g.rect(-w * 0.14, -h, w * 0.28, h);
    g.rect(-w * 0.45, -h * 0.78, w * 0.9, w * 0.26);
  }
  g.fillStyle = linGrad(g, -w / 2, 0, w / 2, 0, [[0, rgba(base, 1, 1.2)], [0.6, rgba(base, 1, 0.75)], [1, rgba(base, 1, 0.35)]]);
  g.fill();
  g.save();
  g.clip();
  texture(g, -w, -h, w * 2, h, { alpha: 0.5, cells: 8, seed });
  g.fillStyle = `rgba(50,70,30,${moss})`;
  g.fillRect(-w, -h * 0.25, w * 2, h * 0.25);
  if (kind !== 2) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 3; i++) g.fillRect(-w * 0.3, -h * 0.62 + i * h * 0.12, w * 0.6, h * 0.035);
  }
  g.restore();
  g.restore();
}

/** Winged angel statue silhouette with moonlit rim. */
export function angelStatue(g, x, y, s, { base = '#9a9488', rim = '#b8c8ff' } = {}) {
  g.save();
  contactShadow(g, x, y, s * 0.7, s * 0.14, 0.6);
  // plinth
  g.fillStyle = linGrad(g, x - s * 0.4, 0, x + s * 0.4, 0, [[0, rgba(base, 1, 1)], [1, rgba(base, 1, 0.35)]]);
  g.fillRect(x - s * 0.4, y - s * 0.5, s * 0.8, s * 0.5);
  const top = y - s * 0.5;
  const body = () => {
    g.beginPath();
    g.moveTo(x - s * 0.25, top);
    g.quadraticCurveTo(x - s * 0.2, top - s * 0.8, x - s * 0.08, top - s * 1.25);
    g.arc(x, top - s * 1.38, s * 0.13, Math.PI * 0.8, Math.PI * 2.2);
    g.quadraticCurveTo(x + s * 0.2, top - s * 0.8, x + s * 0.25, top);
    g.closePath();
    // wings
    g.moveTo(x - s * 0.05, top - s * 1.1);
    g.bezierCurveTo(x - s * 0.6, top - s * 1.6, x - s * 0.8, top - s * 0.9, x - s * 0.55, top - s * 0.45);
    g.quadraticCurveTo(x - s * 0.3, top - s * 0.8, x - s * 0.05, top - s * 0.9);
    g.moveTo(x + s * 0.05, top - s * 1.1);
    g.bezierCurveTo(x + s * 0.6, top - s * 1.6, x + s * 0.8, top - s * 0.9, x + s * 0.55, top - s * 0.45);
    g.quadraticCurveTo(x + s * 0.3, top - s * 0.8, x + s * 0.05, top - s * 0.9);
  };
  body();
  g.fillStyle = linGrad(g, x - s * 0.6, 0, x + s * 0.6, 0, [[0, rgba(base, 1, 0.9)], [0.5, rgba(base, 1, 0.55)], [1, rgba(base, 1, 0.25)]]);
  g.fill();
  g.save();
  body();
  g.clip();
  texture(g, x - s, top - s * 1.7, s * 2, s * 1.7, { alpha: 0.45, cells: 8, seed: 31 });
  g.restore();
  g.save();
  g.globalCompositeOperation = 'screen';
  g.translate(-s * 0.03, 0);
  body();
  g.strokeStyle = rgba(rim, 0.35);
  g.lineWidth = s * 0.03;
  g.stroke();
  g.restore();
  g.restore();
}

export function pine(g, x, y, h, { color = '#0e1612', seed = 1 } = {}) {
  const r = rngOf(seed);
  g.fillStyle = color;
  g.fillRect(x - h * 0.02, y - h * 0.25, h * 0.04, h * 0.25);
  const layers = 6;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const ly = y - h * 0.15 - t * h * 0.85;
    const lw = h * 0.28 * (1 - t * 0.8) * (0.85 + r() * 0.3);
    g.beginPath();
    g.moveTo(x - lw, ly);
    g.lineTo(x, ly - h * 0.26);
    g.lineTo(x + lw, ly);
    g.closePath();
    g.fill();
  }
}

export function anvil(g, x, y, s) {
  contactShadow(g, x, y, s * 0.7, s * 0.14);
  g.fillStyle = '#2a2a2e';
  g.fillRect(x - s * 0.18, y - s * 0.45, s * 0.36, s * 0.45);
  g.fillStyle = linGrad(g, 0, y - s * 0.62, 0, y - s * 0.42, [[0, '#8a8c94'], [0.3, '#4a4c54'], [1, '#1a1a1e']]);
  poly(g, [[x - s * 0.62, y - s * 0.6], [x + s * 0.42, y - s * 0.62], [x + s * 0.5, y - s * 0.5], [x + s * 0.2, y - s * 0.44], [x - s * 0.2, y - s * 0.44], [x - s * 0.4, y - s * 0.52]]);
  g.fill();
  g.fillStyle = 'rgba(255,200,140,0.5)';
  g.fillRect(x - s * 0.5, y - s * 0.62, s * 0.9, s * 0.02);
}

/** Wall rack of weapons (x,y top-left). */
export function weaponRack(g, x, y, w, h, seed = 1) {
  const r = rngOf(seed);
  g.fillStyle = '#3a2412';
  g.fillRect(x, y + h * 0.08, w, h * 0.05);
  g.fillRect(x, y + h * 0.85, w, h * 0.05);
  const n = Math.floor(w / (h * 0.14));
  for (let i = 0; i < n; i++) {
    const cx = x + (i + 0.5) * (w / n);
    const kind = r.int(0, 3);
    g.save();
    g.translate(cx, y + h * 0.1);
    g.rotate((r() - 0.5) * 0.08);
    if (kind === 0) { // sword
      g.fillStyle = linGrad(g, -h * 0.02, 0, h * 0.02, 0, [[0, '#dcdce4'], [1, '#5a5c64']]);
      g.fillRect(-h * 0.018, h * 0.1, h * 0.036, h * 0.7);
      g.fillStyle = '#8a6a2a';
      g.fillRect(-h * 0.07, h * 0.08, h * 0.14, h * 0.025);
      g.fillStyle = '#3a2210';
      g.fillRect(-h * 0.015, -h * 0.02, h * 0.03, h * 0.1);
    } else if (kind === 1) { // spear
      g.fillStyle = '#5a3a1e';
      g.fillRect(-h * 0.012, 0, h * 0.024, h * 0.82);
      g.fillStyle = '#c8c8d0';
      poly(g, [[0, -h * 0.08], [h * 0.03, 0.02 * h], [-h * 0.03, 0.02 * h]]);
      g.fill();
    } else if (kind === 2) { // axe
      g.fillStyle = '#5a3a1e';
      g.fillRect(-h * 0.014, 0, h * 0.028, h * 0.75);
      g.fillStyle = linGrad(g, 0, 0, h * 0.12, 0, [[0, '#6a6c74'], [1, '#d0d0d8']]);
      poly(g, [[0, h * 0.05], [h * 0.12, 0], [h * 0.12, h * 0.2], [0, h * 0.15]]);
      g.fill();
    } else { // mace
      g.fillStyle = '#4a3018';
      g.fillRect(-h * 0.014, h * 0.1, h * 0.028, h * 0.65);
      g.fillStyle = '#7a7c84';
      g.beginPath();
      g.arc(0, h * 0.1, h * 0.05, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

/** Armour on a stand (x = centre, y = ground). */
export function armourStand(g, x, y, s, { plate = true } = {}) {
  contactShadow(g, x, y, s * 0.4, s * 0.1);
  g.fillStyle = '#2a1a0e';
  g.fillRect(x - s * 0.03, y - s * 1.5, s * 0.06, s * 1.5);
  g.fillRect(x - s * 0.25, y - s * 0.04, s * 0.5, s * 0.04);
  const body = () => {
    g.beginPath();
    g.moveTo(x - s * 0.32, y - s * 1.38);
    g.quadraticCurveTo(x, y - s * 1.5, x + s * 0.32, y - s * 1.38);
    g.lineTo(x + s * 0.24, y - s * 0.78);
    g.quadraticCurveTo(x, y - s * 0.7, x - s * 0.24, y - s * 0.78);
    g.closePath();
  };
  body();
  g.fillStyle = plate
    ? linGrad(g, x - s * 0.32, 0, x + s * 0.32, 0, [[0, '#e0e0e8'], [0.25, '#9a9ca6'], [0.55, '#5a5c66'], [0.8, '#2a2c34'], [1, '#6a6c78']])
    : linGrad(g, x - s * 0.32, 0, x + s * 0.32, 0, [[0, '#a8a8b0'], [1, '#2a2a30']]);
  g.fill();
  if (!plate) {
    g.save();
    body();
    g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    for (let yy = y - s * 1.5; yy < y - s * 0.7; yy += s * 0.03) {
      g.beginPath();
      for (let xx = x - s * 0.35; xx < x + s * 0.35; xx += s * 0.04) g.arc(xx, yy, s * 0.02, 0, Math.PI);
      g.stroke();
    }
    g.restore();
  }
  // helm
  g.fillStyle = linGrad(g, x - s * 0.13, 0, x + s * 0.13, 0, [[0, '#d0d0d8'], [0.6, '#5a5c66'], [1, '#2a2c34']]);
  g.beginPath();
  g.arc(x, y - s * 1.58, s * 0.13, Math.PI, 0);
  g.lineTo(x + s * 0.13, y - s * 1.46);
  g.lineTo(x - s * 0.13, y - s * 1.46);
  g.fill();
  g.fillStyle = '#0a0a0e';
  g.fillRect(x - s * 0.09, y - s * 1.56, s * 0.18, s * 0.025);
}

/** Weaving loom silhouette with warp threads (x centre, y ground). */
export function loom(g, x, y, s, { cloth = '#7a2a2a', seed = 1 } = {}) {
  contactShadow(g, x, y, s * 0.9, s * 0.15);
  const w = s * 1.4;
  const h = s * 1.5;
  g.fillStyle = '#3a2412';
  for (const dx of [-0.5, 0.5]) g.fillRect(x + dx * w - s * 0.05, y - h, s * 0.1, h);
  g.fillRect(x - w / 2, y - h, w, s * 0.08);
  g.fillRect(x - w / 2, y - h * 0.45, w, s * 0.07);
  // warp threads
  g.strokeStyle = 'rgba(220,200,160,0.45)';
  g.lineWidth = 0.8;
  for (let i = 0; i < 24; i++) {
    const tx = x - w * 0.45 + (i / 23) * w * 0.9;
    g.beginPath();
    g.moveTo(tx, y - h + s * 0.08);
    g.lineTo(tx, y - h * 0.45);
    g.stroke();
  }
  // woven cloth
  g.fillStyle = cloth;
  g.fillRect(x - w * 0.45, y - h * 0.62, w * 0.9, h * 0.17);
  texture(g, x - w * 0.45, y - h * 0.62, w * 0.9, h * 0.17, { alpha: 0.5, cells: 64, octaves: 1, seed });
}

/** Bolts of cloth stacked (x centre, y ground). */
export function clothBolts(g, x, y, s, seed = 1) {
  const r = rngOf(seed);
  const cols = ['#7a2a2a', '#2a4a7a', '#6a5a2a', '#3a5a3a', '#5a2a5a', '#8a7a5a'];
  for (let i = 0; i < 5; i++) {
    const by = y - i * s * 0.22;
    const bx = x + (r() - 0.5) * s * 0.2;
    g.fillStyle = linGrad(g, 0, by - s * 0.22, 0, by, [[0, rgba(r.pick(cols), 1, 1.2)], [1, rgba('#000000', 1)]]);
    g.beginPath();
    g.roundRect(bx - s * 0.6, by - s * 0.22, s * 1.2, s * 0.22, s * 0.1);
    g.fill();
  }
}

export function sarcophagus(g, x, y, s) {
  contactShadow(g, x, y, s * 1.1, s * 0.2);
  g.fillStyle = linGrad(g, 0, y - s * 0.6, 0, y, [[0, '#8a8478'], [1, '#2a2622']]);
  g.fillRect(x - s, y - s * 0.55, s * 2, s * 0.55);
  g.fillStyle = linGrad(g, 0, y - s * 0.72, 0, y - s * 0.55, [[0, '#b0aa9a'], [1, '#5a5448']]);
  poly(g, [[x - s * 1.05, y - s * 0.55], [x - s * 0.95, y - s * 0.72], [x + s * 0.95, y - s * 0.72], [x + s * 1.05, y - s * 0.55]]);
  g.fill();
  texture(g, x - s, y - s * 0.72, s * 2, s * 0.72, { alpha: 0.4, cells: 8, seed: 12 });
}

export function throne(g, x, y, s, { cloth = '#5a1a1a', metal = '#8a6a2a' } = {}) {
  contactShadow(g, x, y, s * 0.8, s * 0.15);
  g.fillStyle = linGrad(g, x - s * 0.5, 0, x + s * 0.5, 0, [[0, rgba(metal, 1, 1.3)], [1, rgba(metal, 1, 0.3)]]);
  poly(g, [[x - s * 0.45, y], [x - s * 0.45, y - s * 1.6], [x - s * 0.3, y - s * 1.9], [x, y - s * 2.05], [x + s * 0.3, y - s * 1.9], [x + s * 0.45, y - s * 1.6], [x + s * 0.45, y]]);
  g.fill();
  g.fillStyle = cloth;
  g.fillRect(x - s * 0.3, y - s * 1.6, s * 0.6, s * 1.0);
  g.fillStyle = rgba(cloth, 1, 0.6);
  g.fillRect(x - s * 0.5, y - s * 0.6, s, s * 0.18);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(x + s * 0.1, y - s * 1.6, s * 0.35, s * 1.6);
}

export function candle(g, x, y, s) {
  g.fillStyle = linGrad(g, x - s * 0.06, 0, x + s * 0.06, 0, [[0, '#f4ecd8'], [1, '#9a8a6a']]);
  g.fillRect(x - s * 0.05, y - s * 0.4, s * 0.1, s * 0.4);
}

export function brazier(g, x, y, s) {
  contactShadow(g, x, y, s * 0.5, s * 0.1);
  g.fillStyle = '#1a1a1c';
  for (const dx of [-0.25, 0, 0.25]) g.fillRect(x + dx * s - s * 0.03, y - s * 0.6, s * 0.06, s * 0.6);
  g.fillStyle = linGrad(g, x - s * 0.4, 0, x + s * 0.4, 0, [[0, '#6a5a4a'], [1, '#1a1612']]);
  g.beginPath();
  g.moveTo(x - s * 0.4, y - s * 0.75);
  g.quadraticCurveTo(x, y - s * 0.45, x + s * 0.4, y - s * 0.75);
  g.closePath();
  g.fill();
}

/** Sconce-mounted torch (the flame itself is drawn by the overlay). */
export function torchSconce(g, x, y, s) {
  g.fillStyle = '#1e1a16';
  g.fillRect(x - s * 0.03, y, s * 0.06, s * 0.35);
  g.fillStyle = '#3a2412';
  poly(g, [[x - s * 0.06, y], [x + s * 0.06, y], [x + s * 0.04, y + s * 0.3], [x - s * 0.04, y + s * 0.3]]);
  g.fill();
}

/** Notice board with pinned papers (x,y top-left). */
export function noticeBoard(g, x, y, w, h, seed = 1) {
  const r = rngOf(seed);
  planks(g, x, y, w, h, { base: '#4a3018', width: h / 5, vertical: false, seed });
  g.strokeStyle = '#1a0e06';
  g.lineWidth = w * 0.03;
  g.strokeRect(x, y, w, h);
  for (let i = 0; i < 9; i++) {
    const pw = w * (0.18 + r() * 0.12);
    const ph = pw * (1.1 + r() * 0.4);
    const px = x + r() * (w - pw);
    const py = y + r() * (h - ph);
    g.save();
    g.translate(px + pw / 2, py + ph / 2);
    g.rotate((r() - 0.5) * 0.25);
    g.fillStyle = rgba(mix('#efe2c0', '#b8a070', r()), 1);
    g.fillRect(-pw / 2, -ph / 2, pw, ph);
    g.fillStyle = 'rgba(60,40,20,0.55)';
    for (let l = 0; l < 5; l++) g.fillRect(-pw * 0.38, -ph * 0.3 + l * ph * 0.13, pw * (0.5 + r() * 0.26), ph * 0.03);
    g.fillStyle = r() < 0.5 ? '#8a1a1a' : '#2a2a2a';
    g.beginPath();
    g.arc(0, -ph * 0.42, pw * 0.05, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** Rubble heap (x centre, y ground). */
export function rubble(g, x, y, s, { base = '#5a544a', seed = 1 } = {}) {
  const r = rngOf(seed);
  contactShadow(g, x, y, s * 1.2, s * 0.2, 0.5);
  for (let i = 0; i < 16; i++) {
    const rx = x + (r() - 0.5) * s * 2;
    const ry = y - r() * s * 0.5 * (1 - Math.abs(rx - x) / (s * 1.1));
    const rs = s * (0.12 + r() * 0.2);
    g.fillStyle = linGrad(g, rx - rs, ry - rs, rx + rs, ry + rs, [[0, rgba(base, 1, 1.25)], [1, rgba(base, 1, 0.35)]]);
    poly(g, [[rx - rs, ry], [rx - rs * 0.6, ry - rs * 0.8], [rx + rs * 0.5, ry - rs * 0.9], [rx + rs, ry - rs * 0.1], [rx + rs * 0.3, ry + rs * 0.3]]);
    g.fill();
  }
  // a broken beam
  g.save();
  g.translate(x + s * 0.2, y - s * 0.3);
  g.rotate(-0.4 + r() * 0.3);
  g.fillStyle = '#2a1a0e';
  g.fillRect(-s, -s * 0.06, s * 2, s * 0.12);
  g.restore();
}

/** Stone well-head with a timber winch (x centre, y front ground, s ≈ radius). */
export function wellHead(g, x, y, s) {
  contactShadow(g, x, y + s * 0.05, s * 1.5, s * 0.3, 0.6);
  const ry = s * 0.32;
  const top = y - s * 0.62;
  // winch posts behind
  for (const d of [-1, 1]) {
    g.fillStyle = linGrad(g, x + d * s * 1.05 - 8, 0, x + d * s * 1.05 + 8, 0, [[0, '#6a4a2a'], [1, '#1e1208']]);
    g.fillRect(x + d * s * 1.05 - s * 0.07, top - s * 1.25, s * 0.14, s * 1.3);
  }
  g.fillStyle = linGrad(g, 0, top - s * 1.28, 0, top - s * 1.14, [[0, '#7a5530'], [1, '#2a1a0c']]);
  g.fillRect(x - s * 1.2, top - s * 1.28, s * 2.4, s * 0.13);
  // roof
  g.fillStyle = '#2a1c12';
  poly(g, [[x - s * 1.4, top - s * 1.2], [x, top - s * 1.75], [x + s * 1.4, top - s * 1.2], [x + s * 1.25, top - s * 1.12], [x, top - s * 1.6], [x - s * 1.25, top - s * 1.12]]);
  g.fill();
  // rope and bucket
  g.strokeStyle = 'rgba(160,130,90,0.9)';
  g.lineWidth = Math.max(1, s * 0.02);
  g.beginPath();
  g.moveTo(x + s * 0.1, top - s * 1.16);
  g.lineTo(x + s * 0.1, top - s * 0.3);
  g.stroke();
  g.fillStyle = linGrad(g, x - s * 0.02, 0, x + s * 0.24, 0, [[0, '#6a4a2a'], [1, '#1e1208']]);
  poly(g, [[x - s * 0.02, top - s * 0.34], [x + s * 0.22, top - s * 0.34], [x + s * 0.19, top - s * 0.12], [x + 0.01 * s, top - s * 0.12]]);
  g.fill();
  // mouth: dark interior with a faint glint of water far below
  g.save();
  g.beginPath();
  g.ellipse(x, top, s * 1.2, ry, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = linGrad(g, 0, top - ry, 0, top + ry, [[0, '#1a1814'], [0.5, '#050506'], [1, '#000']]);
  g.fillRect(x - s * 1.3, top - ry, s * 2.6, ry * 2);
  g.fillStyle = 'rgba(150,190,210,0.18)';
  g.beginPath();
  g.ellipse(x + s * 0.1, top + ry * 0.35, s * 0.3, ry * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // front wall (drum)
  g.save();
  g.beginPath();
  g.moveTo(x - s * 1.2, top);
  g.ellipse(x, top, s * 1.2, ry, 0, Math.PI, 0, true);
  g.lineTo(x + s * 1.2, y - ry * 0.2);
  g.ellipse(x, y - ry * 0.2, s * 1.2, ry, 0, 0, Math.PI);
  g.closePath();
  g.clip();
  masonry(g, x - s * 1.3, top - ry, s * 2.6, s * 1.2, { base: '#7a7266', course: s * 0.16, blockW: s * 0.34, seed: 44 });
  g.fillStyle = linGrad(g, x - s * 1.2, 0, x + s * 1.2, 0, [[0, 'rgba(255,200,140,0.18)'], [0.45, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.65)']]);
  g.fillRect(x - s * 1.3, top - ry, s * 2.6, s * 1.2);
  g.restore();
  // coping stones on the lip
  g.strokeStyle = '#b0a490';
  g.lineWidth = s * 0.09;
  g.beginPath();
  g.ellipse(x, top, s * 1.2, ry, 0, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * s * 1.15, top + Math.sin(a) * ry * 0.95);
    g.lineTo(x + Math.cos(a) * s * 1.25, top + Math.sin(a) * ry * 1.05);
    g.stroke();
  }
}
