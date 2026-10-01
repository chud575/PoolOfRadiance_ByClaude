import { makeCanvas, rngOf, rgba, mix, gothicPath, glow } from './paint.js';

/**
 * Designed stained glass: windows composed like real medieval lancets, not
 * random mosaics. A field of diamond quarries, a border band of alternating
 * coloured slips, and a figure or a heraldic shield cut from large pieces —
 * each piece with its own pot-metal colour, streaks and density — held by a
 * hierarchy of lead (heavy around the figure, medium on the border, hairline
 * on the quarries) and iron saddle bars, with grisaille paint for faces and
 * folds. The window is rendered to its own canvas so it can also be thrown
 * across the floor as a coloured light pool (glassPool).
 *
 *   stainedGlass(design, w, h, {seed, broken}) → canvas (w×h, transparent outside the arch)
 *   drawGlass(g, canvas, x, y, {glow})          window + halation into a scene
 *   glassPool(g, canvas, quad, {alpha})         its light lying on the floor
 */

const POT = {
  blue: '#1c3c9a', deepBlue: '#10205e', ruby: '#a8141e', gold: '#e8b830', amber: '#d8841c', white: '#efe8d2', green: '#2a7a3e',
  flesh: '#f0d0b0', steel: '#9ab0c8', purple: '#5a2a8a', murrey: '#7a1a40', sky: '#5a8ad8', rose: '#e05a78',
};

/** A piece: a closed path in unit coordinates (u right, v down over the window rect). */
function piece(pts, color, lead = 2, o = {}) {
  return { pts, color, lead, ...o };
}

const ell = (cx, cy, rx, ry, n = 18) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
});

/** Saint Ferran's vigil: a haloed knight in a crimson surcoat, sword reversed before him. */
function knightDesign() {
  const P = [];
  // ground mound and the hem of the surcoat
  P.push(piece([[0.2, 0.93], [0.8, 0.93], [0.74, 0.86], [0.26, 0.86]], POT.green, 3));
  // cape behind, murrey
  P.push(piece([[0.27, 0.36], [0.73, 0.36], [0.8, 0.86], [0.2, 0.86]], POT.murrey, 3, { folds: 4 }));
  // mailed legs below the surcoat
  P.push(piece([[0.39, 0.74], [0.61, 0.74], [0.6, 0.86], [0.4, 0.86]], POT.steel, 3));
  // crimson surcoat, a gold tower of Sokol on the breast
  P.push(piece([[0.36, 0.38], [0.64, 0.38], [0.68, 0.76], [0.32, 0.76]], POT.ruby, 3, { folds: 3 }));
  P.push(piece([[0.455, 0.47], [0.545, 0.47], [0.545, 0.6], [0.455, 0.6]], POT.gold, 2, { tower: true }));
  // shoulders and mailed arms meeting at the pommel
  P.push(piece([[0.3, 0.36], [0.4, 0.34], [0.48, 0.47], [0.43, 0.5]], POT.steel, 3));
  P.push(piece([[0.7, 0.36], [0.6, 0.34], [0.52, 0.47], [0.57, 0.5]], POT.steel, 3));
  // the halo, then the head
  P.push(piece(ell(0.5, 0.25, 0.13, 0.085), POT.gold, 3));
  P.push(piece(ell(0.5, 0.265, 0.062, 0.055), POT.flesh, 3, { face: true }));
  // the reversed sword: blade from the hands to the ground, a gold cross-guard
  P.push(piece([[0.485, 0.5], [0.515, 0.5], [0.508, 0.88], [0.5, 0.91], [0.492, 0.88]], POT.white, 3));
  P.push(piece([[0.42, 0.48], [0.58, 0.48], [0.58, 0.505], [0.42, 0.505]], POT.gold, 3));
  P.push(piece(ell(0.5, 0.465, 0.022, 0.018, 10), POT.gold, 2));
  // a sun in the head of the arch
  P.push(piece(ell(0.5, 0.075, 0.07, 0.04, 14), POT.amber, 3, { rays: true }));
  return { field: 'deepBlue', border: [POT.ruby, POT.gold], pieces: P };
}

/** The arms of Sokol Keep: per pale azure and gules, a tower or. */
function heraldryDesign(alt = 0) {
  const P = [];
  const shield = [[0.24, 0.32], [0.76, 0.32], [0.76, 0.56], [0.7, 0.66], [0.5, 0.76], [0.3, 0.66], [0.24, 0.56]];
  P.push(piece(shield, alt ? POT.ruby : POT.blue, 4));
  // the right half of the field in the second tincture
  P.push(piece([[0.5, 0.32], [0.76, 0.32], [0.76, 0.56], [0.7, 0.66], [0.5, 0.76]], alt ? POT.blue : POT.ruby, 3));
  // the tower
  P.push(piece([[0.42, 0.62], [0.58, 0.62], [0.58, 0.44], [0.6, 0.44], [0.6, 0.39], [0.56, 0.39], [0.56, 0.42], [0.52, 0.42], [0.52, 0.39], [0.48, 0.39], [0.48, 0.42], [0.44, 0.42], [0.44, 0.39], [0.4, 0.39], [0.4, 0.44], [0.42, 0.44]], POT.gold, 3, { door: true }));
  // a crest above: a helm with mantling
  P.push(piece(ell(0.5, 0.24, 0.07, 0.05, 12), POT.steel, 3));
  P.push(piece([[0.43, 0.25], [0.3, 0.3], [0.33, 0.22]], alt ? POT.blue : POT.ruby, 2));
  P.push(piece([[0.57, 0.25], [0.7, 0.3], [0.67, 0.22]], alt ? POT.ruby : POT.blue, 2));
  // a scroll beneath
  P.push(piece([[0.28, 0.82], [0.72, 0.82], [0.75, 0.86], [0.72, 0.9], [0.28, 0.9], [0.25, 0.86]], POT.white, 3));
  return { field: 'white', border: [POT.blue, POT.gold], pieces: P, grisaille: true };
}

const DESIGNS = { knight: knightDesign, heraldry: heraldryDesign };

/**
 * @param {'knight'|'heraldry'} design
 * @returns {HTMLCanvasElement}
 */
export function stainedGlass(design, w, h, { seed = 1, broken = 0, alt = 0 } = {}) {
  const D = (DESIGNS[design] ?? knightDesign)(alt);
  const R = rngOf(seed);
  const c = makeCanvas(Math.ceil(w), Math.ceil(h));
  const g = c.getContext('2d');
  const arch = () => gothicPath(g, 0, 0, w, h);
  const U = (p) => [p[0] * w, p[1] * h];
  const path = (pts) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(...U(p)) : g.moveTo(...U(p))));
    g.closePath();
  };
  const lw = Math.max(1, w / 90); // base lead width
  g.save();
  arch();
  g.clip();
  g.fillStyle = '#06070c';
  g.fillRect(0, 0, w, h);
  // pot-metal fill: a slightly streaky, uneven colour with a brighter heart
  const glassFill = (pts, col, k = 1) => {
    const xs = pts.map((p) => p[0] * w);
    const ys = pts.map((p) => p[1] * h);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const rr = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.7 + 2;
    const v = (0.85 + R() * 0.3) * k;
    const gr = g.createRadialGradient(cx - rr * 0.2, cy - rr * 0.25, 1, cx, cy, rr);
    gr.addColorStop(0, rgba(mix(col, '#ffffff', 0.18), 1, v * 1.15));
    gr.addColorStop(1, rgba(col, 1, v * 0.78));
    path(pts);
    g.fillStyle = gr;
    g.fill();
    // streaks in the glass
    g.save();
    path(pts);
    g.clip();
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = rgba(R() < 0.5 ? '#ffffff' : '#000000', 0.06 + R() * 0.05);
      g.lineWidth = 1 + R() * rr * 0.12;
      const sx = cx + (R() - 0.5) * rr * 1.6;
      g.beginPath();
      g.moveTo(sx, cy - rr);
      g.quadraticCurveTo(sx + (R() - 0.5) * rr, cy, sx + (R() - 0.5) * rr * 0.5, cy + rr);
      g.stroke();
    }
    g.restore();
  };
  // ---- field of diamond quarries
  const q = 0.16;
  const quarries = [];
  for (let j = -1; j < h / (w * q) + 2; j++) {
    for (let i = -1; i < 1 / q + 2; i++) {
      const cx = (i + (j % 2 ? 0.5 : 0)) * q;
      const cy = (j * q * w * 0.62) / h;
      const dy = (q * w * 0.62) / h;
      quarries.push([[cx, cy - dy], [cx + q / 2, cy], [cx, cy + dy], [cx - q / 2, cy]]);
    }
  }
  const field = POT[D.field] ?? POT.deepBlue;
  for (const pts of quarries) glassFill(pts, D.grisaille ? mix(field, '#c8d0b0', R() * 0.25) : mix(field, POT.blue, R() * 0.35), D.grisaille ? 0.82 : 0.9);
  // grisaille trellis on pale quarries, a gold dot on blue ones
  for (const pts of quarries) {
    const [cx, cy] = U([(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2]);
    if (D.grisaille) {
      g.strokeStyle = 'rgba(60,50,30,0.35)';
      g.lineWidth = lw * 0.6;
      g.beginPath();
      g.arc(cx, cy, w * q * 0.14, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = rgba(POT.gold, 0.55);
      g.beginPath();
      g.arc(cx, cy, w * q * 0.06, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.strokeStyle = '#100a06';
  g.lineWidth = lw * 0.7;
  for (const pts of quarries) { path(pts); g.stroke(); }
  // ---- the figure / arms: large pieces, painted, heavily leaded
  for (const p of D.pieces) {
    const missing = broken && R() < broken;
    if (missing) { path(p.pts); g.fillStyle = '#0a0e18'; g.fill(); continue; }
    glassFill(p.pts, p.color, 1.05);
    g.save();
    path(p.pts);
    g.clip();
    const xs = p.pts.map((pp) => pp[0] * w);
    const ys = p.pts.map((pp) => pp[1] * h);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    g.strokeStyle = 'rgba(40,16,8,0.55)';
    g.lineCap = 'round';
    if (p.folds) {
      // grisaille fold lines running down the robe
      g.lineWidth = lw * 0.9;
      for (let i = 1; i <= p.folds; i++) {
        const fx = x0 + ((x1 - x0) * i) / (p.folds + 1);
        g.beginPath();
        g.moveTo(fx + (R() - 0.5) * lw * 3, y0 + (y1 - y0) * 0.1);
        g.quadraticCurveTo(fx + (R() - 0.5) * lw * 8, (y0 + y1) / 2, fx + (fx - (x0 + x1) / 2) * 0.15, y1);
        g.stroke();
      }
      // shading toward the edges
      const sg = g.createLinearGradient(x0, 0, x1, 0);
      sg.addColorStop(0, 'rgba(20,6,4,0.45)'); sg.addColorStop(0.3, 'rgba(20,6,4,0)'); sg.addColorStop(0.7, 'rgba(20,6,4,0)'); sg.addColorStop(1, 'rgba(20,6,4,0.45)');
      g.fillStyle = sg;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (p.face) {
      // painted eyes, brows, nose and mouth — the grisaille that makes a face read
      const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const fw = x1 - x0;
      g.lineWidth = Math.max(1, fw * 0.05);
      for (const d of [-1, 1]) {
        g.beginPath(); g.moveTo(cx + d * fw * 0.08, cy - fw * 0.12); g.quadraticCurveTo(cx + d * fw * 0.2, cy - fw * 0.2, cx + d * fw * 0.32, cy - fw * 0.12); g.stroke();
        g.beginPath(); g.ellipse(cx + d * fw * 0.19, cy - fw * 0.04, fw * 0.07, fw * 0.035, 0, 0, Math.PI * 2); g.stroke();
      }
      g.beginPath(); g.moveTo(cx, cy - fw * 0.05); g.lineTo(cx - fw * 0.03, cy + fw * 0.14); g.lineTo(cx + fw * 0.04, cy + fw * 0.15); g.stroke();
      g.beginPath(); g.moveTo(cx - fw * 0.1, cy + fw * 0.27); g.quadraticCurveTo(cx, cy + fw * 0.3, cx + fw * 0.1, cy + fw * 0.27); g.stroke();
      // a beard and hair framing it
      g.fillStyle = 'rgba(60,30,12,0.45)';
      g.beginPath(); g.ellipse(cx, cy + fw * 0.42, fw * 0.32, fw * 0.16, 0, 0, Math.PI); g.fill();
      g.beginPath(); g.ellipse(cx, cy - fw * 0.42, fw * 0.46, fw * 0.16, 0, Math.PI, 0); g.fill();
    }
    if (p.tower) {
      g.fillStyle = 'rgba(40,16,8,0.6)';
      const cx = (x0 + x1) / 2; const tw = x1 - x0;
      g.fillRect(cx - tw * 0.12, y1 - (y1 - y0) * 0.38, tw * 0.24, (y1 - y0) * 0.38);
      for (let i = 0; i < 3; i++) g.fillRect(x0 + tw * (0.08 + i * 0.34), y0, tw * 0.18, (y1 - y0) * 0.14);
    }
    if (p.door) {
      g.fillStyle = 'rgba(40,16,8,0.6)';
      const cx = (x0 + x1) / 2; const tw = x1 - x0;
      g.beginPath(); g.ellipse(cx, y1 - (y1 - y0) * 0.18, tw * 0.1, (y1 - y0) * 0.2, 0, Math.PI, 0); g.fill();
      g.fillRect(cx - tw * 0.1, y1 - (y1 - y0) * 0.18, tw * 0.2, (y1 - y0) * 0.18);
      for (const yy of [0.5, 0.7]) g.fillRect(x0 + tw * 0.2, y0 + (y1 - y0) * yy, tw * 0.6, lw * 0.6);
    }
    if (p.rays) {
      g.strokeStyle = rgba(POT.gold, 0.6);
      g.lineWidth = lw;
      const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (x1 - x0), cy + Math.sin(a) * (y1 - y0)); g.stroke(); }
    }
    g.restore();
  }
  // heavy lead around every figure piece
  g.strokeStyle = '#0c0805';
  g.lineJoin = 'round';
  for (const p of D.pieces) { g.lineWidth = lw * p.lead * 0.75; path(p.pts); g.stroke(); }
  g.strokeStyle = 'rgba(140,130,110,0.25)';
  g.lineWidth = lw * 0.4;
  for (const p of D.pieces) { path(p.pts); g.stroke(); }
  // ---- border band of alternating slips
  const bw = 0.085;
  const slips = 14;
  for (let i = 0; i < slips; i++) {
    const v0 = 0.12 + (i / slips) * 0.88;
    const v1 = 0.12 + ((i + 1) / slips) * 0.88;
    for (const [a, b2] of [[0, bw], [1 - bw, 1]]) glassFill([[a, v0], [b2, v0], [b2, v1], [a, v1]], D.border[i % 2], 1);
  }
  g.strokeStyle = '#0c0805';
  g.lineWidth = lw * 1.2;
  for (let i = 0; i <= slips; i++) {
    const v = (0.12 + (i / slips) * 0.88) * h;
    for (const [a, b2] of [[0, bw], [1 - bw, 1]]) { g.beginPath(); g.moveTo(a * w, v); g.lineTo(b2 * w, v); g.stroke(); }
  }
  g.lineWidth = lw * 1.6;
  for (const xx of [bw, 1 - bw]) { g.beginPath(); g.moveTo(xx * w, 0.12 * h); g.lineTo(xx * w, h); g.stroke(); }
  // light falls off toward the edges and the grimy sill
  const vg = g.createRadialGradient(w / 2, h * 0.42, w * 0.1, w / 2, h * 0.5, h * 0.62);
  vg.addColorStop(0, 'rgba(255,250,235,0.1)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  const sill = g.createLinearGradient(0, h * 0.75, 0, h);
  sill.addColorStop(0, 'rgba(10,8,4,0)');
  sill.addColorStop(1, 'rgba(10,8,4,0.45)');
  g.fillStyle = sill;
  g.fillRect(0, 0, w, h);
  // iron saddle bars
  g.strokeStyle = '#08060a';
  g.lineWidth = lw * 1.8;
  for (let j = 1; j < 5; j++) { const yy = h * (0.15 + j * 0.17); g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); }
  g.restore();
  // the stone frame of the arch
  g.lineWidth = Math.max(3, w * 0.05);
  g.strokeStyle = '#2a2a30';
  arch();
  g.stroke();
  g.lineWidth = Math.max(1, w * 0.012);
  g.strokeStyle = 'rgba(200,200,210,0.25)';
  arch();
  g.stroke();
  return c;
}

/** Draw a window into a scene, with halation of its own colours around it. */
export function drawGlass(g, c, x, y, { glowA = 0.5, w = c.width, h = c.height } = {}) {
  g.drawImage(c, x, y, w, h);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.filter = `blur(${Math.max(4, w * 0.18).toFixed(0)}px)`;
  g.globalAlpha = glowA;
  g.drawImage(c, x - w * 0.1, y - h * 0.05, w * 1.2, h * 1.1);
  g.restore();
}

/**
 * The window's light lying on the floor: its own picture, flattened and sheared
 * onto the ground plane, blurred and screened — so the pool's colours match the glass.
 * quad: {x, y, w, h, shear} — top-left of the pool, its size, and the horizontal shear.
 */
export function glassPool(g, c, { x, y, w, h, shear = 0, alpha = 0.35 }) {
  g.save();
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = alpha;
  g.filter = `blur(${Math.max(3, w * 0.05).toFixed(0)}px)`;
  g.setTransform(w / c.width, 0, shear / c.height, h / c.height, x, y);
  g.drawImage(c, 0, 0);
  g.restore();
  glow(g, x + w / 2 + shear / 2, y + h / 2, Math.max(w, h) * 0.6, '#c8d8ff', alpha * 0.25, 'screen');
}
