/**
 * Procedural painted portraits (Gold Box "head + body" combos, painted in oils).
 *
 * Everything is drawn with Canvas 2D: layered bezier masses with soft blurred
 * shading, strand-by-strand hair and beards, metal/chain/cloth/leather bodies,
 * key light from the upper left (torch), cool rim light from the right (moon),
 * and a final painterly pass that restamps the image as small oriented brush
 * strokes over a canvas-weave grain. Fully deterministic for a given look.
 *
 * look = {seed, head, body, skin, hair, eyes, cloth}  (indices; see defaultLook)
 */

export const PORTRAIT_W = 300;
export const PORTRAIT_H = 375;

// ------------------------------------------------------------------ palettes

export const SKIN_TONES = {
  pale: '#f2d6c0', fair: '#ecc3a2', light: '#dfae88', golden: '#d9a77a', ruddy: '#d99478',
  tan: '#c58c62', olive: '#b0865c', brown: '#8a5a3c', dark: '#5f3b28',
};
export const RACE_SKINS = {
  human: ['fair', 'light', 'tan', 'olive', 'brown', 'dark'],
  elf: ['pale', 'fair', 'golden', 'light'],
  halfElf: ['fair', 'light', 'golden', 'tan', 'olive'],
  dwarf: ['ruddy', 'light', 'tan', 'brown'],
  gnome: ['tan', 'ruddy', 'light', 'brown'],
  halfling: ['fair', 'ruddy', 'light', 'tan'],
};
export const HAIR_COLORS = [
  ['Raven', '#17110e'], ['Umber', '#3a2416'], ['Chestnut', '#62351b'], ['Auburn', '#8a3a1a'],
  ['Copper', '#b3602a'], ['Honey', '#b8904c'], ['Flaxen', '#dcc285'], ['Silver', '#b9b5ae'],
  ['Ash', '#6f6a64'], ['Snow', '#e4e0d8'],
];
export const EYE_COLORS = ['#3f6788', '#4f7336', '#5e3f24', '#7d6034', '#4a4d58', '#6fa0b8', '#94762c'];
export const CLOTH_COLORS = [
  ['Crimson', '#7c1e1c'], ['Royal', '#1f3a7c'], ['Forest', '#2c5634'], ['Violet', '#523672'],
  ['Umber', '#6a5234'], ['Sable', '#2a2a31'], ['Ochre', '#8f6a1c'], ['Teal', '#1c5a5e'],
];

/** Head templates per gender (8 each). The race modifies proportions and beards. */
export const HEADS = {
  male: [
    { name: 'Soldier', hair: 'short', beard: 'none' },
    { name: 'Wanderer', hair: 'swept', beard: 'full' },
    { name: 'Noble', hair: 'long', beard: 'goatee' },
    { name: 'Veteran', hair: 'bald', beard: 'full', scar: true, age: 0.7 },
    { name: 'Guardsman', hair: 'short', beard: 'moustache', helm: true },
    { name: 'Rogue', hair: 'topknot', beard: 'stubble' },
    { name: 'Hooded', hair: 'hood', beard: 'stubble' },
    { name: 'Sage', hair: 'long', beard: 'long', age: 1 },
  ],
  female: [
    { name: 'Maiden', hair: 'long', beard: 'none' },
    { name: 'Ranger', hair: 'braid', beard: 'none' },
    { name: 'Priestess', hair: 'bun', beard: 'none' },
    { name: 'Duelist', hair: 'bob', beard: 'none' },
    { name: 'Sorceress', hair: 'wavy', beard: 'none' },
    { name: 'Shieldmaiden', hair: 'long', beard: 'none', helm: true },
    { name: 'Hooded', hair: 'hood', beard: 'none' },
    { name: 'Mercenary', hair: 'crop', beard: 'none', scar: true },
  ],
};
/** Bodies (8), usable by anyone; defaults follow the class. */
export const BODIES = [
  { id: 'plate', name: 'Plate' },
  { id: 'chain', name: 'Mail' },
  { id: 'scale', name: 'Scale' },
  { id: 'leather', name: 'Leathers' },
  { id: 'robe', name: 'Robes' },
  { id: 'tabard', name: 'Tabard' },
  { id: 'fur', name: 'Furs' },
  { id: 'vestments', name: 'Vestments' },
];
const CLASS_BODY = { fighter: 0, cleric: 5, magicUser: 4, thief: 3 };
const CLASS_HEAD = { male: { fighter: 0, cleric: 1, magicUser: 7, thief: 5 }, female: { fighter: 5, cleric: 2, magicUser: 4, thief: 3 } };

// ------------------------------------------------------------------ utilities

function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashNum(...xs) {
  let h = 2166136261;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
/** rgba() from a hex or rgb triple, scaled by k, tinted toward `tint` by amount t. */
function col(c, k = 1, a = 1, tint = null, t = 0) {
  let [r, g, b] = Array.isArray(c) ? c : hex(c);
  r *= k; g *= k; b *= k;
  if (tint) {
    const [tr, tg, tb] = Array.isArray(tint) ? tint : hex(tint);
    r += (tr - r) * t; g += (tg - g) * t; b += (tb - b) * t;
  }
  return `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${a})`;
}
const WARM = '#ffc27a';
const COOL = '#8fb4ff';

/** Catmull-Rom through points → canvas path (open or closed). */
function smooth(g, pts, closed = true, tension = 0.5) {
  const n = pts.length;
  if (n < 2) return;
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  g.moveTo(pts[0][0], pts[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const k = tension / 3;
    g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
  }
  if (closed) g.closePath();
}
/** Evaluate a Catmull-Rom polyline at u ∈ [0,1] (open). */
function curveAt(pts, u) {
  const n = pts.length;
  if (n === 1) return pts[0];
  const f = Math.max(0, Math.min(0.99999, u)) * (n - 1);
  const i = Math.floor(f);
  const t = f - i;
  const P = (j) => pts[Math.max(0, Math.min(n - 1, j))];
  const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  const t2 = t * t, t3 = t2 * t;
  const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}
const mirror = (pts, cx) => pts.map(([x, y]) => [2 * cx - x, y]);
function soft(g, blur, fn) {
  g.save();
  g.filter = `blur(${blur}px)`;
  fn();
  g.restore();
}
function ellipse(g, x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

/**
 * A lock of hair/fur: strands running from `root` through `mid` to `tip`
 * (three polylines sampled at the same parameter t across the lock).
 */
function lock(g, R, o) {
  const { root, mid, tip } = o;
  const base = o.color;
  const at = (t) => {
    const r = curveAt(root, t), m = curveAt(mid, t), e = curveAt(tip, t);
    const c = [2 * m[0] - (r[0] + e[0]) / 2, 2 * m[1] - (r[1] + e[1]) / 2];
    return { r, c, e };
  };
  const strandPts = (t, steps = 10) => {
    const { r, c, e } = at(t);
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const s = i / steps, a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, d = s * s;
      out.push([a * r[0] + b * c[0] + d * e[0], a * r[1] + b * c[1] + d * e[1]]);
    }
    return out;
  };
  // Silhouette.
  const outline = [...strandPts(0)];
  for (let i = 1; i < 12; i++) outline.push(curveAt(tip, i / 12));
  outline.push(...strandPts(1).reverse());
  for (let i = 11; i > 0; i--) outline.push(curveAt(root, i / 12));
  g.save();
  g.beginPath();
  outline.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  if (o.shadow !== false) {
    g.save();
    g.filter = 'blur(3px)';
    g.fillStyle = col(base, 0.35, 0.55);
    g.translate(2, 3);
    g.fill();
    g.restore();
  }
  g.fillStyle = col(base, 0.72);
  g.fill();
  if (o.clip !== false) g.clip();
  // Strands: dark underlayer, mid body, then light sheen strokes.
  const n = o.strands ?? 70;
  const [w0, w1] = o.width ?? [1, 2.6];
  const light = o.light ?? ((x, y) => 1);
  for (let pass = 0; pass < 3; pass++) {
    const count = pass === 2 ? Math.round(n * 0.45) : n;
    for (let i = 0; i < count; i++) {
      const t = R();
      const pts = strandPts(t, 12);
      const jit = (o.jitter ?? 1.5) * (R() - 0.5) * 2;
      const kr = R();
      const s0 = pass === 2 ? Math.floor(R() * 5) : 0;
      const s1 = pass === 2 ? Math.min(12, s0 + 3 + Math.floor(R() * 5)) : 12 - Math.floor(R() * 3);
      const lw = w0 + (w1 - w0) * R() * (pass === 2 ? 0.6 : 1);
      const segs = pass === 2 ? [[s0, s1]] : [[s0, 4], [4, 8], [8, s1]];
      g.lineCap = 'round';
      g.lineWidth = lw;
      for (const [a0, a1] of segs) {
        const [mx, my] = pts[Math.round((a0 + a1) / 2)];
        const L = light(mx, my);
        let k;
        let al;
        if (pass === 0) { k = 0.45 + kr * 0.25; al = 0.7; }
        else if (pass === 1) { k = (0.75 + kr * 0.45) * L; al = 0.55; }
        else { k = (1.15 + kr * 0.5) * L; al = 0.35 * Math.max(0, L - 0.55); }
        if (al <= 0.01) continue;
        g.strokeStyle = col(base, k, al, L > 1 ? WARM : COOL, Math.min(0.25, Math.abs(L - 1) * 0.3));
        g.beginPath();
        for (let j = a0; j <= a1; j++) {
          const [x, y] = pts[j];
          const wob = Math.sin(j * 0.9 + t * 40) * jit;
          if (j === a0) g.moveTo(x + wob, y);
          else g.lineTo(x + wob, y);
        }
        g.stroke();
      }
    }
  }
  g.restore();
  // Wisps past the tips break up the silhouette.
  const wisps = o.wisps ?? Math.round(n * 0.18);
  for (let i = 0; i < wisps; i++) {
    const t = R();
    const pts = strandPts(t, 12);
    const [ax, ay] = pts[9];
    const [bx, by] = pts[12];
    const ext = 0.25 + R() * 0.5;
    g.strokeStyle = col(base, 0.9 + R() * 0.5, 0.45);
    g.lineWidth = 0.6 + R() * 0.6;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(bx, by, bx + (bx - ax) * ext + (R() - 0.5) * 4, by + (by - ay) * ext + (R() - 0.5) * 3);
    g.stroke();
  }
}

// ------------------------------------------------------------------ looks

/**
 * Complete a (possibly partial) look for a character. Deterministic from look.seed.
 * @param {{race:string, gender?:string, classSpec?:string, look?:object}} ch
 */
export function defaultLook(ch) {
  const look = { ...(ch.look ?? {}) };
  const seed = look.seed ?? hashNum(ch.name ?? '', ch.race, ch.classSpec);
  const R = rngFrom(seed * 31 + 7);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const cls = String(ch.classSpec ?? 'fighter').split('/')[0];
  const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
  look.seed = seed;
  look.head ??= CLASS_HEAD[gender][cls] ?? Math.floor(R() * 8);
  look.body ??= CLASS_BODY[cls] ?? 0;
  look.skin ??= Math.floor(R() * skins.length);
  const hairPool = ch.race === 'elf' ? [0, 5, 6, 7, 9, 2] : ch.race === 'dwarf' ? [3, 4, 2, 1, 0, 8] : ch.race === 'gnome' ? [8, 9, 1, 4, 2] : [0, 1, 2, 3, 4, 5, 6];
  look.hair ??= hairPool[Math.floor(R() * hairPool.length)];
  look.eyes ??= Math.floor(R() * EYE_COLORS.length);
  look.cloth ??= Math.floor(R() * CLOTH_COLORS.length);
  return look;
}

// ------------------------------------------------------------------ painting

const RACE_SHAPE = {
  //         half-width  skull  chin  jaw   eyes   nose  ears
  human: { hw: 53, top: 90, chin: 84, jaw: 0.86, eye: 0.42, nose: 1, ear: 'round' },
  elf: { hw: 47, top: 94, chin: 90, jaw: 0.74, eye: 0.44, nose: 0.85, ear: 'elf' },
  halfElf: { hw: 50, top: 92, chin: 86, jaw: 0.8, eye: 0.43, nose: 0.92, ear: 'half' },
  dwarf: { hw: 60, top: 80, chin: 74, jaw: 0.96, eye: 0.4, nose: 1.3, ear: 'round' },
  gnome: { hw: 55, top: 80, chin: 72, jaw: 0.84, eye: 0.42, nose: 1.7, ear: 'half' },
  halfling: { hw: 54, top: 82, chin: 74, jaw: 0.84, eye: 0.44, nose: 0.9, ear: 'half' },
};

function faceGeometry(race, gender, R, head) {
  const s = RACE_SHAPE[race] ?? RACE_SHAPE.human;
  const fem = gender === 'female';
  const cx = 150;
  const cy = race === 'dwarf' || race === 'gnome' || race === 'halfling' ? 168 : 160;
  const hw = s.hw * (fem ? 0.94 : 1) * (0.97 + R() * 0.06);
  const F = {
    cx, cy, hw, race, fem, head,
    top: cy - s.top * (fem ? 0.97 : 1),
    jawY: cy + 46,
    jawW: hw * s.jaw * (fem ? 0.9 : 1) * (0.96 + R() * 0.08),
    chinY: cy + s.chin * (fem ? 0.9 : 1),
    chinW: hw * (fem ? 0.26 : 0.36) * (0.9 + R() * 0.25),
    eyeY: cy - 2,
    eyeDX: hw * s.eye,
    eyeW: (race === 'elf' ? 15 : 13.5) * (fem ? 1.05 : 1),
    eyeH: fem ? 6.4 : 5.6,
    tilt: race === 'elf' ? 2.6 : race === 'halfElf' ? 1.2 : 0,
    noseY: cy + (race === 'dwarf' || race === 'gnome' ? 28 : 30),
    noseW: 10 * s.nose * (fem ? 0.88 : 1) * (0.92 + R() * 0.2),
    noseLen: s.nose,
    mouthY: cy + (race === 'dwarf' || race === 'gnome' || race === 'halfling' ? 47 : 51),
    mouthW: (fem ? 17 : 19) * (0.92 + R() * 0.16),
    brow: fem ? 1.6 : race === 'dwarf' ? 3.4 : 2.6,
    ear: s.ear,
    age: head.age ?? 0,
  };
  F.browY = F.eyeY - 15;
  return F;
}

function facePath(g, F) {
  const { cx, cy, hw, top, jawY, jawW, chinY, chinW } = F;
  const right = [
    [cx + hw * 0.74, top + 13], [cx + hw * 0.98, cy - 42], [cx + hw * 1.0, cy - 6],
    [cx + hw * 0.95, cy + 22], [cx + jawW, jawY], [cx + chinW * 1.55, chinY - 13], [cx + chinW * 0.8, chinY - 2],
  ];
  const pts = [[cx, top], ...right, [cx, chinY], ...mirror(right, cx).reverse()];
  g.beginPath();
  smooth(g, pts, true, 0.55);
}

function paintBackground(g, R, look, cloth) {
  const W = PORTRAIT_W, H = PORTRAIT_H;
  const hue = cloth;
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, col('#2b2418', 1));
  grd.addColorStop(0.55, col(hue, 0.32, 1, '#15120e', 0.55));
  grd.addColorStop(1, col('#07080c', 1));
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // Warm glow behind the head (separates the silhouette), cool at the right edge.
  const glow = g.createRadialGradient(118, 120, 10, 130, 150, 210);
  glow.addColorStop(0, 'rgba(255,196,120,0.55)');
  glow.addColorStop(0.45, 'rgba(160,110,60,0.22)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  const rim = g.createLinearGradient(W, 0, W * 0.6, 0);
  rim.addColorStop(0, 'rgba(90,130,200,0.28)');
  rim.addColorStop(1, 'rgba(90,130,200,0)');
  g.fillStyle = rim;
  g.fillRect(0, 0, W, H);
  // Loose background brushwork.
  for (let i = 0; i < 220; i++) {
    const x = R() * W, y = R() * H;
    const d = Math.hypot(x - 125, y - 140) / 220;
    g.strokeStyle = col(R() < 0.5 ? '#c89a5c' : hue, 0.5 + R() * 0.7, 0.05 + 0.06 * (1 - Math.min(1, d)));
    g.lineWidth = 6 + R() * 16;
    g.lineCap = 'round';
    const a = -0.9 + R() * 0.5;
    const L = 20 + R() * 50;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (R() - 0.5) * 12, y + Math.sin(a) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
    g.stroke();
  }
}

// ----- body

function torsoPath(g, F, wide = 1) {
  const { cx } = F;
  const sy = F.chinY + 20;
  const pts = [
    [cx - 38, sy - 8], [cx - 98 * wide, sy + 6], [cx - 138 * wide, sy + 28], [cx - 156 * wide, sy + 80], [cx - 160, 420],
    [cx + 160, 420], [cx + 156 * wide, sy + 80], [cx + 138 * wide, sy + 28], [cx + 98 * wide, sy + 6], [cx + 38, sy - 8],
  ];
  g.beginPath();
  smooth(g, pts, true, 0.45);
}

/** Light term across the body: warm key from the upper left, falling off to the right. */
function bodyShade(g, F) {
  const W = PORTRAIT_W;
  const lg = g.createLinearGradient(0, 0, W, 0);
  lg.addColorStop(0, 'rgba(255,190,120,0.16)');
  lg.addColorStop(0.45, 'rgba(0,0,0,0)');
  lg.addColorStop(0.75, 'rgba(5,8,20,0.35)');
  lg.addColorStop(1, 'rgba(5,8,20,0.55)');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, PORTRAIT_H);
  const vg = g.createLinearGradient(0, F.chinY + 28, 0, PORTRAIT_H);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, PORTRAIT_H);
}

function metalGrad(g, x0, y0, x1, y1, base = '#8a919c', warm = 0.25) {
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, col(base, 0.45));
  m.addColorStop(0.18, col(base, 1.25, 1, WARM, warm));
  m.addColorStop(0.3, col(base, 1.7, 1, '#fff4dc', 0.3));
  m.addColorStop(0.42, col(base, 0.9));
  m.addColorStop(0.7, col(base, 0.42));
  m.addColorStop(0.9, col(base, 0.7, 1, COOL, 0.35));
  m.addColorStop(1, col(base, 0.35));
  return m;
}

function rivet(g, x, y, r = 2.2) {
  const rg = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 0.2, x, y, r);
  rg.addColorStop(0, '#fff3d6');
  rg.addColorStop(0.5, '#9a9ea6');
  rg.addColorStop(1, '#2a2c30');
  g.fillStyle = rg;
  ellipse(g, x, y, r, r);
  g.fill();
}

function paintChainArea(g, R, F, x0, x1, y0, y1, tone = '#9aa0a8') {
  g.fillStyle = col(tone, 0.28);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let y = y0, row = 0; y < y1; y += 4.2, row++) {
    for (let x = x0 + (row % 2) * 3; x < x1; x += 6) {
      const L = 1.25 - (x - 40) / 260 - (y - 250) / 500;
      g.strokeStyle = col(tone, Math.max(0.35, L) * (0.85 + R() * 0.3), 0.9, L > 0.9 ? WARM : COOL, 0.25);
      g.lineWidth = 1.3;
      g.beginPath();
      g.ellipse(x, y, 2.6, 2.1, 0, Math.PI * 0.95, Math.PI * 2.05);
      g.stroke();
    }
  }
}

function emblem(g, x, y, s, color = '#e7c46a') {
  // Balanced scales of Tyr on a sunburst.
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.strokeStyle = col(color, 1.1);
  g.fillStyle = col(color, 1);
  g.lineWidth = 1.6;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
    g.lineTo(Math.cos(a) * (i % 2 ? 13 : 16), Math.sin(a) * (i % 2 ? 13 : 16));
    g.stroke();
  }
  ellipse(g, 0, 0, 8, 8);
  g.fill();
  g.strokeStyle = col('#2a1a08', 1, 0.9);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(0, -5); g.lineTo(0, 5);
  g.moveTo(-5, -3); g.lineTo(5, -3);
  g.moveTo(-5, -3); g.lineTo(-6.5, 1); g.lineTo(-3.5, 1); g.closePath();
  g.moveTo(5, -3); g.lineTo(6.5, 1); g.lineTo(3.5, 1); g.closePath();
  g.stroke();
  g.restore();
}

function trimBand(g, pts, width, color = '#d8b25a') {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = col(color, 0.35);
  g.lineWidth = width + 2;
  g.beginPath(); smooth(g, pts, false); g.stroke();
  g.strokeStyle = col(color, 0.95);
  g.lineWidth = width;
  g.beginPath(); smooth(g, pts, false); g.stroke();
  g.strokeStyle = col(color, 1.5, 0.8, '#fff6d8', 0.4);
  g.lineWidth = 1;
  g.setLineDash([2, 3]);
  g.beginPath(); smooth(g, pts, false); g.stroke();
  g.restore();
}

function paintBody(g, R, F, look) {
  const body = BODIES[look.body % BODIES.length].id;
  const cloth = CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1];
  const { cx } = F;
  const sy = F.chinY + 20; // shoulder line top (neck base)
  // Cast shadow of the head on the chest.
  g.save();
  torsoPath(g, F, body === 'plate' || body === 'fur' ? 1.06 : 1);
  g.clip();
  if (body === 'plate' || body === 'scale') {
    g.fillStyle = metalGrad(g, 20, sy, 290, PORTRAIT_H, body === 'scale' ? '#9a8458' : '#8c939e');
    g.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H);
    if (body === 'scale') {
      for (let y = sy - 4, row = 0; y < PORTRAIT_H + 8; y += 7, row++) {
        for (let x = (row % 2) * 5; x < PORTRAIT_W + 10; x += 10) {
          const L = 1.3 - x / 300 - (y - sy) / 400;
          const sg = g.createLinearGradient(x, y - 4, x, y + 6);
          sg.addColorStop(0, col('#b89a5c', 1.35 * Math.max(0.4, L), 1, WARM, 0.2));
          sg.addColorStop(1, col('#6a5530', 0.5 * Math.max(0.5, L)));
          g.fillStyle = sg;
          g.beginPath();
          g.moveTo(x - 5, y - 3);
          g.quadraticCurveTo(x - 5, y + 6, x, y + 7);
          g.quadraticCurveTo(x + 5, y + 6, x + 5, y - 3);
          g.closePath();
          g.fill();
          g.strokeStyle = 'rgba(20,14,6,0.55)';
          g.lineWidth = 0.8;
          g.stroke();
        }
      }
    } else {
      // Breastplate: central ridge and plate edges.
      const ridge = g.createLinearGradient(cx - 30, 0, cx + 30, 0);
      ridge.addColorStop(0, 'rgba(0,0,0,0)');
      ridge.addColorStop(0.45, 'rgba(255,240,210,0.35)');
      ridge.addColorStop(0.55, 'rgba(10,12,20,0.35)');
      ridge.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ridge;
      g.fillRect(cx - 30, sy + 20, 60, 200);
      for (const yy of [sy + 70, sy + 102]) {
        g.strokeStyle = 'rgba(10,10,14,0.55)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx - 70, yy + 12); g.quadraticCurveTo(cx, yy - 8, cx + 70, yy + 12);
        g.stroke();
        g.strokeStyle = 'rgba(255,236,200,0.35)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx - 70, yy + 14); g.quadraticCurveTo(cx, yy - 6, cx + 70, yy + 14);
        g.stroke();
      }
    }
  } else if (body === 'chain') {
    paintChainArea(g, R, F, 0, PORTRAIT_W, sy - 10, PORTRAIT_H);
    // Leather baldric.
    g.strokeStyle = col('#5a3a1e', 1);
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(cx - 95, sy + 20); g.lineTo(cx + 70, PORTRAIT_H + 10);
    g.stroke();
    g.strokeStyle = 'rgba(255,220,160,0.25)';
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(cx - 99, sy + 16); g.lineTo(cx + 66, PORTRAIT_H + 6);
    g.stroke();
    g.setLineDash([]);
    rivet(g, cx - 40, sy + 67, 5);
  } else if (body === 'leather' || body === 'fur') {
    const lg = g.createLinearGradient(20, sy, 280, PORTRAIT_H);
    lg.addColorStop(0, '#7a5230');
    lg.addColorStop(0.5, '#4a3019');
    lg.addColorStop(1, '#22150b');
    g.fillStyle = lg;
    g.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H);
    for (let i = 0; i < 260; i++) {
      const x = R() * PORTRAIT_W, y = sy + R() * 160;
      g.strokeStyle = col('#8a5e36', 0.6 + R() * 0.8, 0.12);
      g.lineWidth = 1 + R() * 3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 18, y + R() * 10); g.stroke();
    }
    // Jerkin panels with stitched seams + laced collar.
    g.strokeStyle = 'rgba(15,8,4,0.7)';
    g.lineWidth = 2;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + s * 24, sy + 4); g.quadraticCurveTo(cx + s * 44, sy + 80, cx + s * 30, PORTRAIT_H);
      g.stroke();
      g.save();
      g.strokeStyle = 'rgba(230,200,150,0.45)';
      g.lineWidth = 1;
      g.setLineDash([2.5, 3]);
      g.beginPath();
      g.moveTo(cx + s * 29, sy + 4); g.quadraticCurveTo(cx + s * 49, sy + 80, cx + s * 35, PORTRAIT_H);
      g.stroke();
      g.restore();
    }
    for (let i = 0; i < 5; i++) {
      const y = sy + 18 + i * 13;
      g.strokeStyle = 'rgba(210,180,130,0.6)';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx - 22 + i, y); g.lineTo(cx + 22 - i, y + 7); g.moveTo(cx + 22 - i, y); g.lineTo(cx - 22 + i, y + 7); g.stroke();
    }
  } else {
    // Cloth: robe / tabard / vestments.
    const base = body === 'vestments' ? '#d9ceb4' : cloth;
    const cg = g.createLinearGradient(20, sy, 280, PORTRAIT_H);
    cg.addColorStop(0, col(base, 1.25, 1, WARM, 0.12));
    cg.addColorStop(0.5, col(base, 0.8));
    cg.addColorStop(1, col(base, 0.4, 1, COOL, 0.1));
    if (body === 'tabard') {
      paintChainArea(g, R, F, 0, PORTRAIT_W, sy - 10, PORTRAIT_H);
    } else {
      g.fillStyle = cg;
      g.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H);
      // Folds.
      for (let i = 0; i < 26; i++) {
        const x = R() * PORTRAIT_W;
        const dark = R() < 0.5;
        g.strokeStyle = col(base, dark ? 0.45 : 1.45, 0.22, dark ? COOL : WARM, 0.1);
        g.lineWidth = 3 + R() * 8;
        g.lineCap = 'round';
        soft(g, 3, () => {
          g.beginPath();
          g.moveTo(x, sy + 20 + R() * 30);
          g.bezierCurveTo(x + (R() - 0.5) * 30, sy + 80, x + (R() - 0.5) * 40, sy + 130, x + (R() - 0.5) * 30, PORTRAIT_H + 10);
          g.stroke();
        });
      }
    }
    if (body === 'tabard' || body === 'vestments') {
      // Central panel / stole with emblem.
      const panel = body === 'tabard' ? cloth : '#7c1e1c';
      const w = body === 'tabard' ? 52 : 20;
      const pg = g.createLinearGradient(cx - w, 0, cx + w, 0);
      pg.addColorStop(0, col(panel, 1.2, 1, WARM, 0.1));
      pg.addColorStop(0.6, col(panel, 0.8));
      pg.addColorStop(1, col(panel, 0.5));
      g.fillStyle = pg;
      if (body === 'tabard') {
        g.beginPath();
        g.moveTo(cx - w, sy + 10); g.lineTo(cx + w, sy + 10); g.lineTo(cx + w + 6, PORTRAIT_H + 5); g.lineTo(cx - w - 6, PORTRAIT_H + 5);
        g.closePath();
        g.fill();
        trimBand(g, [[cx - w, sy + 12], [cx - w - 6, PORTRAIT_H + 5]], 3);
        trimBand(g, [[cx + w, sy + 12], [cx + w + 6, PORTRAIT_H + 5]], 3);
        emblem(g, cx, sy + 72, 1.35);
      } else {
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx + s * 26, sy + 2); g.lineTo(cx + s * 50, sy + 2); g.lineTo(cx + s * 40, PORTRAIT_H + 5); g.lineTo(cx + s * 16, PORTRAIT_H + 5);
          g.closePath();
          g.fill();
          trimBand(g, [[cx + s * 26, sy + 4], [cx + s * 16, PORTRAIT_H + 5]], 2);
        }
        emblem(g, cx - 32, sy + 86, 0.8);
      }
    }
  }
  bodyShade(g, F);
  // Pauldrons for plate / scale / fur mantle.
  if (body === 'plate' || body === 'scale') {
    for (const s of [-1, 1]) {
      const px = cx + s * 112;
      const py = sy + 50;
      for (let k = 2; k >= 0; k--) {
        const yy = py + k * 17;
        g.fillStyle = metalGrad(g, px - 60, yy - 40, px + 60, yy + 40, '#8c939e', s < 0 ? 0.35 : 0.05);
        g.beginPath();
        g.ellipse(px + s * k * 3, yy, 58 - k * 4, 34 - k * 3, s * 0.35, Math.PI, Math.PI * 2);
        g.lineTo(px + s * k * 3 + (58 - k * 4), yy + 8);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(8,8,12,0.7)';
        g.lineWidth = 1.5;
        g.stroke();
        g.strokeStyle = s < 0 ? 'rgba(255,225,170,0.55)' : 'rgba(150,185,255,0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(px + s * k * 3, yy + 1, 56 - k * 4, 32 - k * 3, s * 0.35, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
      if (look.cloth % 2 === 0) trimBand(g, [[px - 52, py + 6], [px - 30, py - 26], [px + 20, py - 34], [px + 54, py - 6]].map(([x, y]) => [x, y + (s > 0 ? 6 : 0)]), 2.5);
      for (let k = 0; k < 4; k++) rivet(g, px - 30 + k * 20, py - 22 + Math.abs(k - 1.5) * 4);
    }
  }
  if (body === 'fur') {
    for (const s of [-1, 1]) {
      lock(g, R, {
        root: [[cx + s * 30, sy], [cx + s * 80, sy + 8], [cx + s * 130, sy + 30]],
        mid: [[cx + s * 38, sy + 22], [cx + s * 96, sy + 36], [cx + s * 150, sy + 60]],
        tip: [[cx + s * 30, sy + 60], [cx + s * 100, sy + 70], [cx + s * 160, sy + 90]],
        color: '#7a6450', strands: 140, width: [1.2, 3.2], jitter: 3,
        light: (x) => 1.25 - x / 320,
      });
    }
    rivet(g, cx, sy + 40, 7);
  }
  g.restore();
  // Collar / gorget, drawn over the torso top.
  if (body === 'plate') {
    for (let k = 0; k < 3; k++) {
      g.fillStyle = metalGrad(g, cx - 60, sy - 10, cx + 60, sy + 30);
      g.beginPath();
      g.ellipse(cx, sy + 8 + k * 9, 48 + k * 8, 16 + k * 4, 0, 0, Math.PI);
      g.ellipse(cx, sy + 2 + k * 9, 44 + k * 8, 10 + k * 4, 0, Math.PI, 0, true);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(8,8,12,0.6)';
      g.lineWidth = 1.2;
      g.stroke();
    }
  } else if (body === 'robe') {
    // High standing collar with embroidered trim.
    for (const s of [-1, 1]) {
      const cg = g.createLinearGradient(cx + s * 20, 0, cx + s * 70, 0);
      cg.addColorStop(0, col(cloth, 0.55));
      cg.addColorStop(1, col(cloth, s < 0 ? 1.3 : 0.7));
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(cx + s * 22, sy + 30);
      g.quadraticCurveTo(cx + s * 34, sy - 40, cx + s * 70, sy - 58);
      g.quadraticCurveTo(cx + s * 76, sy - 10, cx + s * 64, sy + 18);
      g.closePath();
      g.fill();
      trimBand(g, [[cx + s * 22, sy + 28], [cx + s * 34, sy - 36], [cx + s * 70, sy - 56]], 3);
    }
    trimBand(g, [[cx - 20, sy + 30], [cx - 6, PORTRAIT_H]], 3);
    trimBand(g, [[cx + 20, sy + 30], [cx + 6, PORTRAIT_H]], 3);
    g.fillStyle = '#e8c86a';
    ellipse(g, cx, sy + 34, 6, 6);
    g.fill();
    g.fillStyle = '#6ad0ff';
    ellipse(g, cx - 1, sy + 33, 3, 3);
    g.fill();
  } else if (body === 'leather' || body === 'chain' || body === 'tabard') {
    // Cloth collar / cowl.
    g.fillStyle = col(body === 'leather' ? '#3a2a1c' : cloth, 0.8);
    g.beginPath();
    g.ellipse(cx, sy + 10, 52, 22, 0, 0, Math.PI);
    g.ellipse(cx, sy + 2, 40, 12, 0, Math.PI, 0, true);
    g.closePath();
    g.fill();
  }
}

// ----- head

function paintNeck(g, F, skin) {
  const { cx, hw, chinY } = F;
  const w = hw * (F.fem ? 0.5 : 0.66);
  g.beginPath();
  g.moveTo(cx - w, chinY - 40);
  g.lineTo(cx - w * 1.08, chinY + 34);
  g.quadraticCurveTo(cx, chinY + 58, cx + w * 1.12, chinY + 34);
  g.lineTo(cx + w, chinY - 40);
  g.closePath();
  const ng = g.createLinearGradient(cx - w, 0, cx + w, 0);
  ng.addColorStop(0, col(skin, 0.95, 1, WARM, 0.1));
  ng.addColorStop(0.6, col(skin, 0.7));
  ng.addColorStop(1, col(skin, 0.45, 1, COOL, 0.15));
  g.fillStyle = ng;
  g.fill();
  // Shadow under the jaw.
  g.save();
  g.clip();
  soft(g, 7, () => {
    g.fillStyle = col(skin, 0.3, 0.75);
    ellipse(g, cx + 6, chinY - 4, hw * 0.9, 20);
    g.fill();
  });
  if (!F.fem && F.race !== 'elf') {
    // Adam's apple hint.
    g.strokeStyle = col(skin, 1.15, 0.25);
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx - 2, chinY + 12); g.quadraticCurveTo(cx - 4, chinY + 22, cx - 1, chinY + 30); g.stroke();
  }
  g.restore();
}

function paintEars(g, F, skin) {
  const { cx, cy, hw } = F;
  for (const s of [-1, 1]) {
    const x = cx + s * hw * 0.96;
    const y = cy + 6;
    g.beginPath();
    if (F.ear === 'elf' || F.ear === 'half') {
      const tipX = x + s * (F.ear === 'elf' ? 30 : 16);
      const tipY = y - (F.ear === 'elf' ? 44 : 26);
      g.moveTo(x - s * 2, y - 16);
      g.quadraticCurveTo(tipX - s * 4, tipY + 10, tipX, tipY);
      g.quadraticCurveTo(x + s * 16, y - 6, x + s * 10, y + 14);
      g.quadraticCurveTo(x + s * 4, y + 24, x - s * 3, y + 20);
    } else {
      g.moveTo(x - s * 2, y - 18);
      g.bezierCurveTo(x + s * 14, y - 24, x + s * 16, y + 4, x + s * 8, y + 16);
      g.quadraticCurveTo(x + s * 4, y + 26, x - s * 3, y + 20);
    }
    g.closePath();
    const eg = g.createLinearGradient(x - 10, 0, x + 20, 0);
    eg.addColorStop(0, col(skin, s < 0 ? 1.0 : 0.55, 1, s < 0 ? WARM : COOL, 0.1));
    eg.addColorStop(1, col(skin, s < 0 ? 0.8 : 0.45, 1, '#c05040', 0.1));
    g.fillStyle = eg;
    g.fill();
    // Inner ear.
    g.save();
    g.clip();
    soft(g, 2, () => {
      g.strokeStyle = col(skin, 0.45, 0.6, '#802020', 0.15);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + s * 2, y - 10);
      g.quadraticCurveTo(x + s * 10, y - 4, x + s * 5, y + 12);
      g.stroke();
    });
    g.restore();
  }
}

function paintFace(g, R, F, skin) {
  const { cx, cy, hw, top, chinY, eyeY, eyeDX, noseY, mouthY } = F;
  facePath(g, F);
  const base = g.createRadialGradient(cx - hw * 0.35, cy - 25, 8, cx, cy, hw * 1.6);
  base.addColorStop(0, col(skin, 1.12, 1, WARM, 0.1));
  base.addColorStop(0.55, col(skin, 0.95));
  base.addColorStop(1, col(skin, 0.62, 1, '#6a3020', 0.1));
  g.fillStyle = base;
  g.fill();
  g.save();
  facePath(g, F);
  g.clip();
  // Form shadow on the far (right) side, cooled by the rim environment.
  const side = g.createLinearGradient(cx - hw * 0.1, 0, cx + hw * 1.05, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(0.5, col(skin, 0.45, 0.42, '#402040', 0.2));
  side.addColorStop(1, col(skin, 0.28, 0.72, '#203050', 0.3));
  g.fillStyle = side;
  g.fillRect(cx - hw * 1.2, top - 10, hw * 2.4, chinY - top + 20);
  soft(g, 9, () => {
    // Forehead & cheekbone highlights.
    g.fillStyle = col(skin, 1.3, 0.35, WARM, 0.25);
    ellipse(g, cx - hw * 0.28, cy - 46, hw * 0.45, 18);
    g.fill();
    ellipse(g, cx - hw * 0.52, cy + 14, hw * 0.26, 11, -0.3);
    g.fill();
    // Cheek hollows and temple shading.
    g.fillStyle = col(skin, 0.5, 0.28, '#502030', 0.2);
    ellipse(g, cx + hw * 0.62, cy + 30, hw * 0.3, 20, 0.3);
    g.fill();
    ellipse(g, cx - hw * 0.66, cy + 34, hw * 0.2, 16, -0.3);
    g.fill();
    ellipse(g, cx + hw * 0.85, cy - 30, hw * 0.2, 26);
    g.fill();
  });
  soft(g, 5, () => {
    // Eye sockets.
    g.fillStyle = col(skin, 0.5, 0.42, '#401a28', 0.25);
    for (const s of [-1, 1]) {
      ellipse(g, cx + s * eyeDX, eyeY - 3, F.eyeW + 6, F.eyeH + 6);
      g.fill();
    }
    // Blush.
    g.fillStyle = `rgba(205,85,70,${F.fem ? 0.2 : 0.13})`;
    for (const s of [-1, 1]) {
      ellipse(g, cx + s * hw * 0.52, cy + 26, hw * 0.24, 13);
      g.fill();
    }
    // Nose side shadow + under-nose.
    g.fillStyle = col(skin, 0.45, 0.45, '#401a20', 0.2);
    g.beginPath();
    g.moveTo(cx + 3, eyeY + 2);
    g.quadraticCurveTo(cx + F.noseW * 0.9, noseY - 8, cx + F.noseW * 1.1, noseY + 4);
    g.lineTo(cx + 2, noseY + 2);
    g.closePath();
    g.fill();
    ellipse(g, cx + 2, noseY + 9, F.noseW * 0.95, 4.5);
    g.fill();
    // Under the lower lip, and the chin's form.
    ellipse(g, cx + 2, mouthY + 12, F.mouthW * 0.6, 4);
    g.fill();
    g.fillStyle = col(skin, 1.25, 0.3, WARM, 0.2);
    ellipse(g, cx - 5, chinY - 14, F.chinW * 1.1, 8);
    g.fill();
  });
  // Jaw shadow along the bottom right.
  soft(g, 8, () => {
    g.fillStyle = col(skin, 0.35, 0.4, '#302040', 0.2);
    ellipse(g, cx + hw * 0.5, chinY + 4, hw * 0.9, 16, -0.25);
    g.fill();
  });
  // Skin texture: fine mottling.
  for (let i = 0; i < 380; i++) {
    const x = cx - hw + R() * hw * 2, y = top + R() * (chinY - top);
    g.fillStyle = col(skin, 0.75 + R() * 0.5, 0.06, R() < 0.5 ? '#d06050' : WARM, 0.2);
    ellipse(g, x, y, 1 + R() * 3, 1 + R() * 2);
    g.fill();
  }
  // Painterly skin: warm impasto on the lit planes, cool strokes in the shadows.
  for (let i = 0; i < 260; i++) {
    const x = cx - hw + R() * hw * 2;
    const y = top + 10 + R() * (chinY - top - 10);
    const lit = x < cx + hw * 0.1;
    const ang = Math.atan2(y - cy, x - cx) + Math.PI / 2 + (R() - 0.5) * 0.5;
    const L = 3 + R() * 7;
    g.strokeStyle = lit ? col(skin, 1.1 + R() * 0.25, 0.1, WARM, 0.25) : col(skin, 0.6 + R() * 0.2, 0.1, '#5060a0', 0.25);
    g.lineWidth = 1.5 + R() * 2.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - Math.cos(ang) * L, y - Math.sin(ang) * L);
    g.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L);
    g.stroke();
  }
  // Age lines.
  if (F.age > 0) {
    g.strokeStyle = col(skin, 0.55, 0.35 * F.age);
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = cy - 48 + i * 7;
      g.beginPath(); g.moveTo(cx - hw * 0.4, y + 2); g.quadraticCurveTo(cx, y - 2, cx + hw * 0.4, y + 2); g.stroke();
    }
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + s * F.noseW * 0.9, noseY + 4);
      g.quadraticCurveTo(cx + s * (F.mouthW + 6), mouthY - 2, cx + s * (F.mouthW + 4), mouthY + 12);
      g.stroke();
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(cx + s * (eyeDX + F.eyeW + 2), eyeY + k * 3 - 2);
        g.lineTo(cx + s * (eyeDX + F.eyeW + 9), eyeY + k * 5 - 5);
        g.stroke();
      }
    }
  }
  // Rim light on the right contour.
  g.save();
  facePath(g, F);
  const rim = g.createLinearGradient(cx + hw * 0.5, 0, cx + hw * 1.05, 0);
  rim.addColorStop(0, 'rgba(160,195,255,0)');
  rim.addColorStop(1, 'rgba(170,205,255,0.8)');
  g.strokeStyle = rim;
  g.lineWidth = 5;
  g.filter = 'blur(1.5px)';
  g.stroke();
  g.restore();
  g.restore();
}

function paintEyes(g, R, F, eyeCol, skin) {
  const { cx, eyeY, eyeDX, eyeW, eyeH, tilt } = F;
  for (const s of [-1, 1]) {
    const x = cx + s * eyeDX;
    const inner = [x - s * eyeW, eyeY + 0.5];
    const outer = [x + s * eyeW, eyeY - tilt];
    const shape = () => {
      g.beginPath();
      g.moveTo(inner[0], inner[1]);
      g.bezierCurveTo(x - s * eyeW * 0.4, eyeY - eyeH * 1.35, x + s * eyeW * 0.5, eyeY - eyeH * 1.2 - tilt * 0.6, outer[0], outer[1]);
      g.bezierCurveTo(x + s * eyeW * 0.4, eyeY + eyeH * 0.9, x - s * eyeW * 0.4, eyeY + eyeH * 0.95, inner[0], inner[1]);
      g.closePath();
    };
    // Sclera, shaded by the lid.
    shape();
    const sg = g.createLinearGradient(0, eyeY - eyeH, 0, eyeY + eyeH);
    sg.addColorStop(0, col('#d8c8b8', s < 0 ? 0.8 : 0.62));
    sg.addColorStop(0.6, col('#efe4d6', s < 0 ? 1 : 0.8));
    sg.addColorStop(1, col('#c8b0a0', 0.85));
    g.fillStyle = sg;
    g.fill();
    g.save();
    shape();
    g.clip();
    // Iris.
    const ix = x + s * 0.5 - 1, iy = eyeY - 0.8;
    const ir = eyeH * 0.98;
    const ig = g.createRadialGradient(ix - 1, iy + 1.5, 0.5, ix, iy, ir);
    ig.addColorStop(0, col(eyeCol, 1.6));
    ig.addColorStop(0.55, col(eyeCol, 1.0));
    ig.addColorStop(0.9, col(eyeCol, 0.45));
    ig.addColorStop(1, col(eyeCol, 0.2));
    g.fillStyle = ig;
    ellipse(g, ix, iy, ir, ir);
    g.fill();
    g.fillStyle = '#0a0706';
    ellipse(g, ix, iy, ir * 0.42, ir * 0.42);
    g.fill();
    // Lid shadow across the top of the eye.
    const lid = g.createLinearGradient(0, eyeY - eyeH * 1.3, 0, eyeY);
    lid.addColorStop(0, 'rgba(30,10,10,0.6)');
    lid.addColorStop(1, 'rgba(30,10,10,0)');
    g.fillStyle = lid;
    g.fillRect(x - eyeW - 2, eyeY - eyeH * 1.5, eyeW * 2 + 4, eyeH * 1.5);
    g.restore();
    // Catchlight.
    g.fillStyle = 'rgba(255,250,240,0.95)';
    ellipse(g, ix - 2, iy - 2.2, 1.5, 1.4);
    g.fill();
    // Upper lid line + lashes, lower lid, crease.
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(28,12,8,0.92)';
    g.lineWidth = F.fem ? 2.4 : 1.9;
    g.beginPath();
    g.moveTo(inner[0], inner[1]);
    g.bezierCurveTo(x - s * eyeW * 0.4, eyeY - eyeH * 1.35, x + s * eyeW * 0.5, eyeY - eyeH * 1.2 - tilt * 0.6, outer[0] + s * (F.fem ? 3 : 1), outer[1] - (F.fem ? 1.5 : 0));
    g.stroke();
    if (F.fem) {
      g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const u = 0.55 + k * 0.13;
        const px = x - s * eyeW + s * 2 * eyeW * u;
        const py = eyeY - eyeH * 1.1 * Math.sin(Math.PI * u) - tilt * u;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * 2.5, py - 2.5); g.stroke();
      }
    }
    g.strokeStyle = col(skin, 0.5, 0.55);
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(x - s * eyeW * 0.8, eyeY - eyeH * 1.75);
    g.quadraticCurveTo(x + s * eyeW * 0.1, eyeY - eyeH * 2.4 - tilt, x + s * eyeW * 1.05, eyeY - eyeH * 1.2 - tilt);
    g.stroke();
    g.strokeStyle = col(skin, 0.55, 0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(inner[0] + s * 2, inner[1] + 1);
    g.bezierCurveTo(x - s * eyeW * 0.3, eyeY + eyeH * 1.05, x + s * eyeW * 0.4, eyeY + eyeH * 0.95, outer[0], outer[1] + 0.5);
    g.stroke();
    g.strokeStyle = col(skin, 1.2, 0.16, WARM, 0.2);
    g.beginPath();
    g.moveTo(x - s * eyeW * 0.6, eyeY + eyeH * 1.6);
    g.quadraticCurveTo(x, eyeY + eyeH * 1.9, x + s * eyeW * 0.6, eyeY + eyeH * 1.5);
    g.stroke();
  }
}

function paintBrows(g, R, F, hairCol) {
  const { cx, browY, eyeDX, eyeW, tilt } = F;
  for (const s of [-1, 1]) {
    const x = cx + s * eyeDX;
    const n = F.fem ? 26 : 40;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const px = x - s * eyeW * 1.05 + s * u * eyeW * 2.2;
      const arch = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (F.fem ? 5 : 3.5);
      const py = browY - arch - tilt * u * 1.4 + (R() - 0.5) * 1.2 + (F.race === 'dwarf' ? 2 : 0);
      const thick = F.brow * (1 - u * 0.55);
      g.strokeStyle = col(hairCol, 0.55 + R() * 0.4, 0.75);
      g.lineWidth = 0.8 + R() * 0.8;
      g.beginPath();
      g.moveTo(px, py + thick * 0.6);
      g.lineTo(px + s * (2.5 + R() * 2), py - thick * 0.6);
      g.stroke();
    }
  }
}

function paintNose(g, F, skin) {
  const { cx, eyeY, noseY, noseW } = F;
  g.lineCap = 'round';
  // Bridge highlight.
  g.save();
  g.filter = 'blur(1.2px)';
  g.strokeStyle = col(skin, 1.3, 0.28, WARM, 0.2);
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(cx - 3, eyeY + 8);
  g.quadraticCurveTo(cx - 4, noseY - 12, cx - 2.5, noseY - 3);
  g.stroke();
  // Shadow plane down the far side of the nose.
  g.strokeStyle = col(skin, 0.45, 0.4, '#401a20', 0.2);
  g.lineWidth = 3.2;
  g.beginPath();
  g.moveTo(cx + 4, eyeY + 6);
  g.quadraticCurveTo(cx + noseW * 0.55, noseY - 10, cx + noseW * 0.95, noseY - 1);
  g.stroke();
  g.restore();
  // Tip.
  const tg = g.createRadialGradient(cx - 2, noseY - 1, 0.5, cx, noseY, noseW * 0.8);
  tg.addColorStop(0, col(skin, 1.3, 0.55, WARM, 0.15));
  tg.addColorStop(1, col(skin, 1, 0));
  g.fillStyle = tg;
  ellipse(g, cx, noseY, noseW * 0.8, noseW * 0.65);
  g.fill();
  if (F.race === 'gnome' || F.race === 'dwarf') {
    g.fillStyle = 'rgba(200,70,60,0.18)';
    ellipse(g, cx, noseY, noseW * 0.9, noseW * 0.7);
    g.fill();
  }
  // Nostril wings.
  g.strokeStyle = col(skin, 0.5, 0.35, '#401010', 0.2);
  g.lineWidth = 1.1;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * noseW * 0.95, noseY - 3);
    g.quadraticCurveTo(cx + s * noseW * 1.05, noseY + 5, cx + s * noseW * 0.35, noseY + 5.5);
    g.stroke();
  }
  g.fillStyle = col(skin, 0.3, 0.7);
  for (const s of [-1, 1]) {
    ellipse(g, cx + s * noseW * 0.45, noseY + 4.5, 2.3, 1.2, s * 0.3);
    g.fill();
  }
}

function paintMouth(g, F, skin) {
  const { cx, mouthY, mouthW } = F;
  const lip = F.fem ? '#b04a48' : '#a0584a';
  const up = F.fem ? 4.2 : 3.2;
  const lo = F.fem ? 5.5 : 4.4;
  // Upper lip (cupid's bow), darker (faces down, away from light).
  g.beginPath();
  g.moveTo(cx - mouthW, mouthY);
  g.bezierCurveTo(cx - mouthW * 0.6, mouthY - up * 0.8, cx - mouthW * 0.25, mouthY - up * 1.3, cx, mouthY - up * 0.7);
  g.bezierCurveTo(cx + mouthW * 0.25, mouthY - up * 1.3, cx + mouthW * 0.6, mouthY - up * 0.8, cx + mouthW, mouthY);
  g.quadraticCurveTo(cx, mouthY + 1, cx - mouthW, mouthY);
  g.fillStyle = col(skin, 0.62, 0.9, lip, F.fem ? 0.55 : 0.35);
  g.fill();
  // Lower lip with a highlight.
  g.beginPath();
  g.moveTo(cx - mouthW * 0.9, mouthY + 0.5);
  g.quadraticCurveTo(cx, mouthY + lo * 2.2, cx + mouthW * 0.9, mouthY + 0.5);
  g.quadraticCurveTo(cx, mouthY + 1.5, cx - mouthW * 0.9, mouthY + 0.5);
  const lg = g.createLinearGradient(0, mouthY, 0, mouthY + lo * 1.8);
  lg.addColorStop(0, col(skin, 0.8, 0.9, lip, F.fem ? 0.6 : 0.35));
  lg.addColorStop(1, col(skin, 0.95, 0.7, lip, 0.25));
  g.fillStyle = lg;
  g.fill();
  g.fillStyle = 'rgba(255,235,220,0.35)';
  ellipse(g, cx - mouthW * 0.25, mouthY + lo * 0.8, mouthW * 0.3, 1.2);
  g.fill();
  // Mouth line.
  g.strokeStyle = 'rgba(50,16,14,0.85)';
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - mouthW - 1, mouthY - 0.5);
  g.bezierCurveTo(cx - mouthW * 0.4, mouthY + 1.2, cx + mouthW * 0.4, mouthY + 1.2, cx + mouthW + 1, mouthY - 0.5);
  g.stroke();
  // Philtrum.
  g.strokeStyle = col(skin, 0.7, 0.35);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - 2.5, mouthY - up - 1); g.lineTo(cx - 3, F.noseY + 7);
  g.moveTo(cx + 2.5, mouthY - up - 1); g.lineTo(cx + 3, F.noseY + 7);
  g.stroke();
}

function paintScar(g, F, skin) {
  const { cx, eyeY, eyeDX } = F;
  const x = cx + eyeDX + 4;
  g.strokeStyle = col(skin, 1.3, 0.7, '#ffe0d0', 0.3);
  g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(x - 6, eyeY - 24); g.quadraticCurveTo(x, eyeY, x + 6, eyeY + 26); g.stroke();
  g.strokeStyle = col(skin, 0.55, 0.6);
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - 5, eyeY - 24); g.quadraticCurveTo(x + 1.5, eyeY, x + 7, eyeY + 26); g.stroke();
}

function hairLight(F) {
  return (x, y) => {
    const lx = (F.cx - x) / (F.hw * 1.3); // + on the lit left side
    const band = Math.exp(-(((y - (F.top + 18)) / 34) ** 2));
    return 0.9 + 0.24 * lx + 0.38 * band * (0.7 + 0.3 * Math.max(-1, Math.min(1, lx)));
  };
}

/** Hair behind the head (long falls, buns, hood backs). */
function paintBackHair(g, R, F, style, hairCol, clothCol) {
  const { cx, hw, top, cy } = F;
  const light = hairLight(F);
  if (style === 'long' || style === 'wavy' || style === 'braid') {
    const len = F.fem ? 150 : 110;
    for (const s of [-1, 1]) {
      lock(g, R, {
        root: [[cx - s * 4, top + 4], [cx + s * hw * 0.5, top + 8]],
        mid: [[cx + s * hw * 0.8, top + 14], [cx + s * hw * 1.2, cy - 10]],
        tip: [[cx + s * hw * 0.6, cy + len * 0.6], [cx + s * hw * 1.5, cy + len * (style === 'wavy' ? 0.95 : 0.85)]],
        color: hairCol, strands: 110, width: [1, 3], jitter: style === 'wavy' ? 5 : 1.5, light,
      });
    }
  } else if (style === 'bun') {
    const bx = cx + 4, by = top - 14, r = 24;
    const bg = g.createRadialGradient(bx - 8, by - 8, 2, bx, by, r);
    bg.addColorStop(0, col(hairCol, 1.2, 1, WARM, 0.1));
    bg.addColorStop(1, col(hairCol, 0.45));
    g.fillStyle = bg;
    ellipse(g, bx, by, r, r * 0.8);
    g.fill();
    for (let i = 0; i < 90; i++) {
      const rr = r * (0.2 + R() * 0.8);
      const a0 = R() * Math.PI * 2;
      const L = light(bx + Math.cos(a0) * rr, by + Math.sin(a0) * rr);
      g.strokeStyle = col(hairCol, (0.7 + R() * 0.6) * L, 0.55);
      g.lineWidth = 0.8 + R() * 1.4;
      g.beginPath();
      g.ellipse(bx, by, rr, rr * 0.8, 0, a0, a0 + 0.8 + R() * 1.4);
      g.stroke();
    }
  } else if (style === 'hood') {
    g.fillStyle = col(clothCol, 0.45);
    g.beginPath();
    smooth(g, [[cx, top - 26], [cx + hw * 1.45, top + 30], [cx + hw * 1.7, cy + 70], [cx + hw * 1.9, cy + 150], [cx - hw * 1.9, cy + 150], [cx - hw * 1.7, cy + 70], [cx - hw * 1.45, top + 30]], true);
    g.fill();
  }
}

/** Hair over the forehead and framing the face. */
function paintFrontHair(g, R, F, style, hairCol) {
  const { cx, hw, top, cy } = F;
  const light = hairLight(F);
  const n = 90;
  // Strands run from the part line (front → crown) over the skull to the hairline.
  const capHalf = (s, hairline, flow = 0) => lock(g, R, {
    root: [[cx - s * 4 + flow, top + 26], [cx - s * 4 + flow, top + 8], [cx - s * 3 + flow * 0.5, top - 6]],
    mid: [[cx + s * 8 + flow, top + 30], [cx + s * hw * 0.62, top + 4], [cx + s * hw * 1.1, cy - 52]],
    tip: hairline,
    color: hairCol, strands: n, width: [1, 2.4], light, shadow: false,
  });
  if (style !== 'bald' && style !== 'hood') {
    // Crown underlayer so the two halves of the cap meet without a gap.
    soft(g, 2, () => {
      g.fillStyle = col(hairCol, 0.62);
      ellipse(g, cx, top + 12, hw * 0.42, 16);
      g.fill();
    });
  }
  if (style === 'bald') {
    // Crown sheen + a fringe of cropped hair at the sides.
    g.save();
    facePath(g, F);
    g.clip();
    soft(g, 6, () => {
      g.fillStyle = 'rgba(255,230,190,0.45)';
      ellipse(g, cx - hw * 0.3, top + 16, hw * 0.35, 10, -0.3);
      g.fill();
    });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 90; i++) {
        const y = cy - 38 + R() * 30;
        const x = cx + s * (hw * 0.86 + R() * hw * 0.14);
        g.strokeStyle = col(hairCol, 0.6 + R() * 0.5, 0.45);
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * 2, y + 4); g.stroke();
      }
    }
    g.restore();
    return;
  }
  if (style === 'hood') return;
  if (style === 'short' || style === 'crop' || style === 'topknot' || style === 'swept') {
    const lineY = top + (style === 'swept' ? 30 : 36);
    // Short hair: strands spring from the hairline and sweep up and back over the skull.
    for (const s of [-1, 1]) {
      const flow = style === 'swept' ? -s * 10 : 0;
      const ly = lineY + (style === 'crop' ? 4 : 0);
      lock(g, R, {
        root: [[cx - s * 6, ly], [cx + s * hw * 0.5, ly - 4], [cx + s * hw * 0.92, cy - 36], [cx + s * hw * 1.0, cy - 8]],
        mid: [[cx - s * 4 + flow, ly - 22], [cx + s * hw * 0.62 + flow, top + 2], [cx + s * hw * 1.1, cy - 52], [cx + s * hw * 1.12, cy - 26]],
        tip: [[cx - s * 2 + flow * 1.5, top - (style === 'swept' ? 12 : 6)], [cx + s * hw * 0.45 + flow, top - 4], [cx + s * hw * 0.9, top + 14], [cx + s * hw * 1.06, cy - 50]],
        color: hairCol, strands: 110, width: [1, 2.4], light, shadow: false, wisps: 22,
      });
    }
    if (style === 'topknot') {
      lock(g, R, {
        root: [[cx - 12, top + 4], [cx + 12, top + 4]],
        mid: [[cx - 14, top - 22], [cx + 14, top - 22]],
        tip: [[cx - 4, top - 36], [cx + 4, top - 36]],
        color: hairCol, strands: 50, width: [1, 2.4], light,
      });
      g.fillStyle = '#6a4a22';
      g.fillRect(cx - 11, top - 12, 22, 6);
    }
    return;
  }
  // Framing styles: long, wavy, braid, bun, bob.
  const hairline = [[cx - 4, top + 30], [cx + hw * 0.55, top + 26], [cx + hw * 0.95, cy - 30], [cx + hw * 1.02, cy]];
  for (const s of [-1, 1]) capHalf(s, s > 0 ? hairline : mirror(hairline, cx), 0);
  if (style === 'bob') {
    for (const s of [-1, 1]) {
      lock(g, R, {
        root: [[cx + s * hw * 0.5, top + 10], [cx + s * hw * 0.95, cy - 40]],
        mid: [[cx + s * hw * 1.02, cy - 20], [cx + s * hw * 1.25, cy + 10]],
        tip: [[cx + s * hw * 0.88, F.jawY + 10], [cx + s * hw * 1.2, F.jawY + 16]],
        color: hairCol, strands: 80, width: [1, 2.6], light,
      });
    }
  } else if (style !== 'bun') {
    const len = F.fem ? 150 : 110;
    for (const s of [-1, 1]) {
      lock(g, R, {
        root: [[cx + s * hw * 0.4, top + 12], [cx + s * hw * 0.9, cy - 46]],
        mid: [[cx + s * hw * 0.98, cy - 10], [cx + s * hw * 1.2, cy + 10]],
        tip: [[cx + s * hw * 0.95, cy + len * 0.75], [cx + s * hw * 1.35, cy + len * 0.8]],
        color: hairCol, strands: 90, width: [1, 2.8], jitter: style === 'wavy' ? 5 : 1.5, light,
      });
    }
  }
  if (style === 'braid') {
    // A thick three-strand braid over the left shoulder.
    let x = cx - hw * 0.92;
    let y = cy + 26;
    for (let k = 0; k < 9; k++) {
      const side = k % 2 ? 1 : -1;
      const w = 11 - k * 0.45;
      lock(g, R, {
        root: [[x + side * w, y - 6], [x, y - 8]],
        mid: [[x + side * w * 0.6, y + 2], [x - side * w * 0.2, y + 1]],
        tip: [[x - side * w * 0.5, y + 10], [x - side * w, y + 8]],
        color: hairCol, strands: 26, width: [0.9, 2], light, wisps: 2,
      });
      x -= 2.2;
      y += 11;
    }
    g.fillStyle = '#7a1e1c';
    g.fillRect(x - 6, y - 4, 12, 5);
  }
}

function paintBeard(g, R, F, style, hairCol, skin) {
  const { cx, hw, cy, chinY, mouthY, noseY, jawW } = F;
  const light = hairLight(F);
  if (style === 'stubble' || style === 'full' || style === 'goatee' || style === 'long' || style === 'dwarf') {
    // Shadow of stubble over the whole beard area.
    g.save();
    facePath(g, F);
    g.clip();
    soft(g, 4, () => {
      g.fillStyle = col(hairCol, 0.6, style === 'stubble' ? 0.28 : 0.2, skin, 0.4);
      g.beginPath();
      g.moveTo(cx - hw * 0.95, cy + 5);
      g.quadraticCurveTo(cx - hw * 0.5, mouthY - 12, cx - F.noseW, noseY + 8);
      g.lineTo(cx + F.noseW, noseY + 8);
      g.quadraticCurveTo(cx + hw * 0.5, mouthY - 12, cx + hw * 0.95, cy + 5);
      g.lineTo(cx + hw, chinY + 10);
      g.lineTo(cx - hw, chinY + 10);
      g.closePath();
      g.fill();
    });
    for (let i = 0; i < 700; i++) {
      const x = cx - hw + R() * hw * 2;
      const y = noseY + 6 + R() * (chinY - noseY);
      if (Math.abs(x - cx) < F.mouthW * 1.05 && Math.abs(y - mouthY - 1) < 5) continue;
      g.fillStyle = col(hairCol, 0.5 + R() * 0.4, 0.35);
      g.fillRect(x, y, 1, 1.4);
    }
    g.restore();
  }
  if (style === 'full' || style === 'long' || style === 'dwarf') {
    const len = style === 'dwarf' ? 120 : style === 'long' ? 105 : 34;
    for (const s of [-1, 1]) {
      lock(g, R, {
        root: [[cx + s * hw * 0.98, cy - 4], [cx + s * hw * 0.62, mouthY - 6], [cx + s * F.mouthW * 0.9, mouthY + 7]],
        mid: [[cx + s * hw * 1.04, cy + 30], [cx + s * jawW * 0.9, chinY + 4], [cx + s * 10, chinY + 10]],
        tip: [[cx + s * jawW * 0.8, chinY + len * 0.5], [cx + s * jawW * 0.45, chinY + len * 0.85], [cx + s * 4, chinY + len]],
        color: hairCol, strands: 150, width: [1, 2.8], jitter: 2.5, light,
      });
    }
    lock(g, R, {
      root: [[cx - F.mouthW * 0.95, mouthY + 6], [cx, mouthY + 9], [cx + F.mouthW * 0.95, mouthY + 6]],
      mid: [[cx - F.mouthW * 0.8, chinY + 2], [cx, chinY + 6], [cx + F.mouthW * 0.8, chinY + 2]],
      tip: [[cx - jawW * 0.35, chinY + len * 0.8], [cx, chinY + len * 1.02], [cx + jawW * 0.35, chinY + len * 0.8]],
      color: hairCol, strands: 110, width: [1, 2.6], jitter: 2.5, light,
    });
    if (style === 'dwarf') {
      // Braided beard rings.
      for (const s of [-1, 1]) {
        const bx = cx + s * 16;
        const by = chinY + len * 0.72;
        const rg = g.createLinearGradient(bx - 8, 0, bx + 8, 0);
        rg.addColorStop(0, '#f5d98b');
        rg.addColorStop(0.5, '#a07a30');
        rg.addColorStop(1, '#5a4018');
        g.fillStyle = rg;
        g.fillRect(bx - 8, by, 16, 7);
        g.fillRect(bx - 7, by + 14, 14, 6);
      }
    }
  }
  if (style === 'goatee') {
    lock(g, R, {
      root: [[cx - F.mouthW * 0.7, mouthY + 7], [cx + F.mouthW * 0.7, mouthY + 7]],
      mid: [[cx - F.mouthW * 0.6, chinY], [cx + F.mouthW * 0.6, chinY]],
      tip: [[cx - 4, chinY + 22], [cx + 4, chinY + 22]],
      color: hairCol, strands: 70, width: [1, 2.2], light,
    });
  }
  if (style === 'moustache' || style === 'full' || style === 'goatee' || style === 'long' || style === 'dwarf') {
    for (const s of [-1, 1]) {
      lock(g, R, {
        root: [[cx + s * 2, noseY + 8], [cx + s * F.noseW * 1.1, noseY + 6]],
        mid: [[cx + s * F.mouthW * 0.6, mouthY - 4], [cx + s * F.mouthW * 1.2, mouthY - 3]],
        tip: [[cx + s * F.mouthW * 0.9, mouthY + 4], [cx + s * F.mouthW * (style === 'moustache' ? 1.7 : 1.3), mouthY + (style === 'moustache' ? 12 : 8)]],
        color: hairCol, strands: 55, width: [1, 2.2], light, shadow: true,
      });
    }
  }
}

function paintHelm(g, R, F) {
  const { cx, hw, top, eyeY, noseY } = F;
  const rim = eyeY - 18;
  const W = hw * 1.12;
  g.save();
  // Shadow cast on the brow.
  g.save();
  facePath(g, F);
  g.clip();
  soft(g, 6, () => {
    g.fillStyle = 'rgba(10,6,4,0.55)';
    g.fillRect(cx - W, rim - 4, W * 2, 18);
  });
  g.restore();
  g.beginPath();
  g.moveTo(cx - W, rim + 4);
  g.bezierCurveTo(cx - W * 1.05, top - 20, cx + W * 1.05, top - 20, cx + W, rim + 4);
  g.closePath();
  g.fillStyle = metalGrad(g, cx - W, top - 10, cx + W, rim, '#8c939e', 0.4);
  g.fill();
  // Specular streak on the dome.
  soft(g, 3, () => {
    g.strokeStyle = 'rgba(255,245,225,0.7)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx - W * 0.6, rim - 6);
    g.quadraticCurveTo(cx - W * 0.55, top + 4, cx - W * 0.1, top - 6);
    g.stroke();
  });
  // Crest ridge.
  g.strokeStyle = 'rgba(20,20,26,0.6)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, top - 13); g.quadraticCurveTo(cx + 2, rim - 20, cx, rim); g.stroke();
  // Brow band with rivets.
  const bg = g.createLinearGradient(0, rim - 6, 0, rim + 8);
  bg.addColorStop(0, '#c9ced6');
  bg.addColorStop(0.5, '#6a707a');
  bg.addColorStop(1, '#2a2d33');
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(cx - W - 2, rim - 2);
  g.quadraticCurveTo(cx, rim - 12, cx + W + 2, rim - 2);
  g.lineTo(cx + W + 2, rim + 8);
  g.quadraticCurveTo(cx, rim - 2, cx - W - 2, rim + 8);
  g.closePath();
  g.fill();
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    const x = cx - W + u * 2 * W;
    rivet(g, x, rim + 2 - Math.sin(u * Math.PI) * 5, 2);
  }
  // Nasal guard.
  const ng = g.createLinearGradient(cx - 5, 0, cx + 5, 0);
  ng.addColorStop(0, '#d9dde3');
  ng.addColorStop(0.5, '#8a909a');
  ng.addColorStop(1, '#30333a');
  g.fillStyle = ng;
  g.beginPath();
  g.moveTo(cx - 5, rim - 2); g.lineTo(cx + 5, rim - 2); g.lineTo(cx + 3.5, noseY - 4); g.lineTo(cx - 3.5, noseY - 4);
  g.closePath();
  g.fill();
  g.restore();
}

function paintHoodFront(g, F, clothCol) {
  const { cx, hw, top, cy } = F;
  g.save();
  g.beginPath();
  smooth(g, [[cx, top - 28], [cx + hw * 1.48, top + 28], [cx + hw * 1.72, cy + 70], [cx + hw * 1.95, cy + 160], [cx - hw * 1.95, cy + 160], [cx - hw * 1.72, cy + 70], [cx - hw * 1.48, top + 28]], true);
  // Face opening (even-odd hole).
  smooth(g, [[cx, top + 6], [cx + hw * 0.98, top + 38], [cx + hw * 1.06, cy + 20], [cx + hw * 0.8, F.chinY + 20], [cx, F.chinY + 40], [cx - hw * 0.8, F.chinY + 20], [cx - hw * 1.06, cy + 20], [cx - hw * 0.98, top + 38]], true);
  const hg = g.createLinearGradient(cx - hw * 1.8, 0, cx + hw * 1.8, 0);
  hg.addColorStop(0, col(clothCol, 1.3, 1, WARM, 0.12));
  hg.addColorStop(0.45, col(clothCol, 0.85));
  hg.addColorStop(1, col(clothCol, 0.35, 1, COOL, 0.15));
  g.fillStyle = hg;
  g.fill('evenodd');
  g.restore();
  // Folds.
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const s = i % 2 ? 1 : -1;
    const k = 1.1 + (i >> 1) * 0.12;
    g.strokeStyle = col(clothCol, i % 3 ? 0.4 : 1.4, 0.3);
    g.lineWidth = 4;
    soft(g, 2.5, () => {
      g.beginPath();
      g.moveTo(cx + s * hw * k * 0.9, top + 30 + i * 4);
      g.quadraticCurveTo(cx + s * hw * k * 1.25, cy + 30, cx + s * hw * k * 1.4, cy + 130);
      g.stroke();
    });
  }
  g.restore();
  // Deep shadow cast by the brim onto the face.
  g.save();
  facePath(g, F);
  g.clip();
  soft(g, 10, () => {
    g.fillStyle = 'rgba(8,4,6,0.72)';
    ellipse(g, cx + 6, top + 18, hw * 1.2, 40);
    g.fill();
    g.fillStyle = 'rgba(8,4,6,0.35)';
    ellipse(g, cx + hw * 0.9, cy + 10, hw * 0.4, 60);
    g.fill();
  });
  g.restore();
}

/** Painterly pass: restamp the image as short oriented strokes, then glaze, grain and vignette. */
function paintPost(g, R, W, H) {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const lum = (x, y) => {
    const i = ((Math.max(0, Math.min(H - 1, y)) * W) + Math.max(0, Math.min(W - 1, x))) * 4;
    return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  };
  g.lineCap = 'round';
  const N = Math.round(W * H / 22);
  const sc = W / PORTRAIT_W;
  for (let k = 0; k < N; k++) {
    const x = Math.floor(R() * W), y = Math.floor(R() * H);
    const i = (y * W + x) * 4;
    // Stroke along the isophote; long strokes in flat areas, tiny ones on edges.
    const gx = lum(x + 1, y) - lum(x - 1, y);
    const gy = lum(x, y + 1) - lum(x, y - 1);
    const mag = Math.hypot(gx, gy);
    if (mag > 60) continue;
    const ang = mag > 3 ? Math.atan2(gy, gx) + Math.PI / 2 : -0.75 + (R() - 0.5) * 0.5;
    const len = sc * (0.8 + (R() * 6) / (1 + mag / 6));
    g.strokeStyle = `rgba(${d[i]},${d[i + 1]},${d[i + 2]},${0.22 + R() * 0.2})`;
    g.lineWidth = sc * (0.9 + R() * 1.4) * (mag > 12 ? 0.7 : 1);
    g.beginPath();
    g.moveTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  // Warm glaze (unifies the palette like a varnish).
  g.save();
  g.globalCompositeOperation = 'soft-light';
  const gl = g.createLinearGradient(0, 0, W, H);
  gl.addColorStop(0, 'rgba(255,190,110,0.5)');
  gl.addColorStop(1, 'rgba(40,60,120,0.45)');
  g.fillStyle = gl;
  g.fillRect(0, 0, W, H);
  g.restore();
  // Canvas weave + grain.
  const grain = g.getImageData(0, 0, W, H);
  const gd = grain.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const weave = ((x % 2) ^ (y % 2) ? 1.5 : -1.5) + (R() - 0.5) * 7;
      gd[i] = clamp255(gd[i] + weave);
      gd[i + 1] = clamp255(gd[i + 1] + weave);
      gd[i + 2] = clamp255(gd[i + 2] + weave * 0.9);
    }
  }
  g.putImageData(grain, 0, 0);
  // Vignette.
  const vg = g.createRadialGradient(W * 0.46, H * 0.42, W * 0.25, W * 0.5, H * 0.5, W * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

/**
 * Paint a portrait into a new canvas.
 * @param {{race:string, gender?:string, classSpec?:string, look?:object, name?:string}} ch
 * @param {{scale?:number, post?:boolean}} [o]
 * @returns {HTMLCanvasElement}
 */
export function paintPortrait(ch, o = {}) {
  const look = defaultLook(ch);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const head = HEADS[gender][look.head % 8];
  const R = rngFrom(hashNum(look.seed, look.head, look.body, ch.race, gender));
  const scale = o.scale ?? 1;
  const W = Math.round(PORTRAIT_W * scale), H = Math.round(PORTRAIT_H * scale);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.scale(scale, scale);
  const F = faceGeometry(ch.race, gender, R, head);
  const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
  const skin = SKIN_TONES[skins[look.skin % skins.length]];
  const hairCol = HAIR_COLORS[look.hair % HAIR_COLORS.length][1];
  const eyeCol = EYE_COLORS[look.eyes % EYE_COLORS.length];
  const clothCol = CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1];
  let hair = head.hair;
  let beard = head.beard;
  if (ch.race === 'dwarf' && gender === 'male') beard = head.beard === 'none' || head.beard === 'stubble' || head.beard === 'moustache' ? 'full' : 'dwarf';
  if ((ch.race === 'elf' || ch.race === 'halfElf') && beard !== 'none') beard = ch.race === 'elf' ? 'none' : beard === 'long' ? 'goatee' : beard;
  if (ch.race === 'halfling' && beard !== 'none' && beard !== 'stubble') beard = 'none';

  paintBackground(g, R, look, clothCol);
  g.translate(150, F.eyeY);
  g.scale(1.18, 1.18);
  g.translate(-150, -F.eyeY + 6);
  paintBackHair(g, R, F, hair, hairCol, clothCol);
  paintBody(g, R, F, look);
  paintNeck(g, F, skin);
  if (hair !== 'hood') paintEars(g, F, skin);
  paintFace(g, R, F, skin);
  paintEyes(g, R, F, eyeCol, skin);
  paintBrows(g, R, F, hairCol);
  paintNose(g, F, skin);
  paintMouth(g, F, skin);
  if (head.scar) paintScar(g, F, skin);
  if (!head.helm) paintFrontHair(g, R, F, hair, hairCol);
  else paintFrontHair(g, R, F, hair === 'long' ? 'long' : 'bald', hairCol);
  if (beard !== 'none') paintBeard(g, R, F, beard, hairCol, skin);
  if (head.helm) paintHelm(g, R, F);
  if (hair === 'hood') paintHoodFront(g, F, clothCol);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (o.post !== false) paintPost(g, R, W, H);
  return c;
}

const urlCache = new Map();
/** Stable cache key for a character's portrait. */
export function portraitKey(ch, scale = 1) {
  const l = defaultLook(ch);
  return [ch.race, ch.gender, l.seed, l.head, l.body, l.skin, l.hair, l.eyes, l.cloth, scale].join('|');
}
/**
 * PNG data URL of a character's portrait (cached).
 * @param {object} ch  character or {race, gender, classSpec, look}
 * @param {number} [scale]
 */
export function portraitURL(ch, scale = 1) {
  const key = portraitKey(ch, scale);
  let u = urlCache.get(key);
  if (!u) {
    u = paintPortrait(ch, { scale }).toDataURL('image/png');
    if (urlCache.size > 160) urlCache.delete(urlCache.keys().next().value);
    urlCache.set(key, u);
  }
  return u;
}
