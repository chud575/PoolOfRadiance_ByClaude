/**
 * "Lit clay" figure renderer: a tiny deterministic software ray caster for
 * painted creature and NPC figures.
 *
 * A Figure is a list of analytic volumes (round cones / capsules, ellipsoids,
 * bevelled boxes) in figure space (human height ≈ 1, feet on y = 0, x right,
 * z toward the viewer). renderFigure() ray-casts them orthographically into
 * a z-buffer, softly blends the normals of touching volumes of the same group
 * (organic joints instead of mannequin seams), evaluates per-material surface
 * patterns (scales, fur, cloth, leather, metal, wood, skin, bone), lights the
 * result with a key light (with a real shadow map, so arms and heads cast
 * shadows), a hemisphere ambient, a rim light and Blinn specular, adds
 * screen-space ambient occlusion and a painterly ink contour, and returns an
 * opaque, antialiased sprite. Ghost mode turns the same render into a
 * spectral, fresnel-lit, additive figure with its plate seams traced in light.
 *
 * Everything is a pure function of the figure and options: no Math.random.
 */

import { sdfAvailable, traceFigure } from './sdfgl.js';

// ------------------------------------------------------------------ math

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mul3(A, B) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
}
export const ap3 = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
export const tr3 = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export function rotX(a) { const c = Math.cos(a); const s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(a) { const c = Math.cos(a); const s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(a) { const c = Math.cos(a); const s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
/** Euler (applied Z, then X, then Y): yaw y, pitch x, roll z. */
export const euler = (x = 0, y = 0, z = 0) => mul3(rotY(y), mul3(rotX(x), rotZ(z)));
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Rotation whose Y axis points along dir (X chosen near `side`). */
export function alignY(dir, side = [1, 0, 0]) {
  const y = norm(dir);
  let z = cross(side, y);
  if (len(z) < 1e-4) z = cross([0, 0, 1], y);
  z = norm(z);
  const x = cross(y, z);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/**
 * Two-bone IK: joint position for a limb root→target with segment lengths
 * l1, l2, bending toward `pole`.
 */
export function ik(root, target, l1, l2, pole) {
  const d = sub(target, root);
  let dl = len(d);
  const maxL = (l1 + l2) * 0.999;
  let tgt = target;
  if (dl > maxL) { tgt = add(root, scl(d, maxL / dl)); dl = maxL; }
  const dir = norm(sub(tgt, root));
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub(pole, scl(dir, dot(pole, dir)));
  if (len(p) < 1e-5) p = [0, 0, 1];
  p = norm(p);
  return add(add(root, scl(dir, a)), scl(p, h));
}

// ------------------------------------------------------------------ noise

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth 2D value noise in [0,1]. */
export function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function fbm(x, y, oct = 3) {
  let s = 0;
  let a = 0.5;
  let t = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x, y) * a; t += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5; }
  return s / t;
}
function vnoise3(x, y, z) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const fx = x - xi; const fy = y - yi; const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy); const sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c00 = l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), sx);
  const c10 = l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), sx);
  const c01 = l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), sx);
  const c11 = l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), sx);
  return l(l(c00, c10, sy), l(c01, c11, sy), sz);
}

// ------------------------------------------------------------------ colour

export function hex(c) {
  if (Array.isArray(c)) return c;
  const n = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c;
  return [parseInt(n.slice(1, 3), 16) / 255, parseInt(n.slice(3, 5), 16) / 255, parseInt(n.slice(5, 7), 16) / 255];
}
export const mixc = (a, b, t) => { const A = hex(a); const B = hex(b); return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]; };
export const shade = (c, k) => { const A = hex(c); return [A[0] * k, A[1] * k, A[2] * k]; };

/**
 * Material: {color, pattern, rough (0 glossy .. 1 matte), spec, metal, sss (wrap), emissive, scale (pattern size in units),
 *            tint2 (secondary colour for patterns), group}
 */
export function mat(color, o = {}) {
  return { color: hex(color), pattern: o.pattern ?? null, rough: o.rough ?? (o.pattern === 'cloth' ? 0.9 : 0.7), spec: o.spec ?? (o.pattern === 'cloth' ? 0.05 : 0.15), metal: !!o.metal, sss: o.sss ?? 0.25, emissive: o.emissive ? hex(o.emissive) : null, scale: o.scale ?? 0.03, tint2: o.tint2 ? hex(o.tint2) : null, ink: o.ink ?? 1 };
}

// ------------------------------------------------------------------ figure

const M_SUB = mat('#000000');

/**
 * Default relief for cloth and hair volumes: hanging fold ridges around big cloth
 * cones (robes, skirts, sleeves, capes) and strand streaks on hair masses.
 */
function autoDisp(p) {
  const m = p.mat;
  if (!m || p.sub) return null;
  if (m.pattern === 'cloth' && p.type === 0) {
    const r = Math.max(p.ra, p.rb);
    if (r < 0.03) return null;
    const L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
    if (L < r * 1.2) return null;
    return { amp: Math.min(0.012, r * 0.09), freq: Math.round(Math.min(18, Math.max(7, r * 120))), twist: 1.5 };
  }
  if (m.pattern === 'fur' && p.type === 1) {
    const e = Math.min(p.r[0], p.r[1], p.r[2]);
    if (e < 0.012) return null;
    return { amp: Math.min(0.006, e * 0.12), freq: 1 / Math.max(0.002, m.scale) * 0.5 };
  }
  return null;
}

/** Builder for a figure: a list of volumes with a transform stack. */
export class Figure {
  constructor() {
    this.prims = [];
    this.stack = [{ R: I3, t: [0, 0, 0], s: 1 }];
    this.emit = [];
    this.group = 'body';
    this.layer = 'main';
  }

  get T() { return this.stack[this.stack.length - 1]; }
  /** World point from local. */
  P(p) { const T = this.T; return add(ap3(T.R, scl(p, T.s)), T.t); }

  push(t = [0, 0, 0], R = I3, s = 1) {
    const T = this.T;
    this.stack.push({ R: mul3(T.R, R), t: add(ap3(T.R, scl(t, T.s)), T.t), s: T.s * s });
    return this;
  }

  pop() { this.stack.pop(); return this; }

  _add(p, o) {
    p.group = o.group === undefined ? this.group : o.group;
    p.layer = o.layer ?? this.layer;
    // blend: world units; k: blend radius in local units (scaled with the transform stack)
    p.blend = o.k != null ? o.k * this.T.s : o.blend ?? 0.03;
    p.shadow = o.shadow ?? !o.sub;
    if (o.sub) p.sub = true; // smooth subtraction from its group (GPU renderer; ignored by the CPU caster)
    const disp = o.disp === undefined ? autoDisp(p) : o.disp;
    if (disp) p.disp = { seed: (this.prims.length * 7.31) % 13, ...disp };
    this.prims.push(p);
    return p;
  }

  /** Smoothly carve a volume out of a group (eye sockets, mouth line, nostrils, hollows). */
  carve(kind, a, b, c, o = {}) {
    const opt = { group: this.group, k: 0.08, ...o, sub: true };
    if (kind === 'ell') return this.ell(a, b, M_SUB, opt);
    if (kind === 'cone') return this.cone(a, b, c, o.rb, M_SUB, opt);
    return this.box(a, b, M_SUB, opt);
  }

  /** Round cone (tapered capsule) from a (radius ra) to b (radius rb). */
  cone(a, b, ra, rb, m, o = {}) {
    const s = this.T.s;
    return this._add({ type: 0, a: this.P(a), b: this.P(b), ra: ra * s, rb: (rb ?? ra) * s, mat: m }, o);
  }

  sphere(c, r, m, o = {}) { return this.ell(c, [r, r, r], m, o); }

  ell(c, r, m, o = {}) {
    const T = this.T;
    return this._add({ type: 1, c: this.P(c), R: mul3(T.R, o.R ?? I3), r: scl(r, T.s), mat: m }, o);
  }

  box(c, h, m, o = {}) {
    const T = this.T;
    return this._add({ type: 2, c: this.P(c), R: mul3(T.R, o.R ?? I3), h: scl(h, T.s), bevel: (o.bevel ?? Math.min(h[0], h[1], h[2]) * 0.4) * T.s, mat: m }, o);
  }

  /** A glowing point (eyes, embers) painted after compositing. */
  glow(c, r, color, a = 0.8) { this.emit.push({ p: this.P(c), r: r * this.T.s, color, a }); }
}

// ------------------------------------------------------------------ intersection (ray o=(x,y,0), d=(0,0,-1))

// Each returns z of the nearest hit (largest z) or -Infinity; writes normal into N.
const N = [0, 0, 0];
const L3 = [0, 0, 0]; // local coords scratch

function hitCone(p, x, y) {
  const pa = p.va;
  const pb = p.vb;
  const ra = p.ra;
  const rb = p.rb;
  const bax = pb[0] - pa[0]; const bay = pb[1] - pa[1]; const baz = pb[2] - pa[2];
  const oax = x - pa[0]; const oay = y - pa[1]; const oaz = -pa[2];
  const obx = x - pb[0]; const oby = y - pb[1]; const obz = -pb[2];
  const rr = ra - rb;
  const m0 = bax * bax + bay * bay + baz * baz;
  const m1 = bax * oax + bay * oay + baz * oaz;
  const m2 = -baz;
  const m3 = -oaz;
  const m5 = oax * oax + oay * oay + oaz * oaz;
  const m6 = -obz;
  const m7 = obx * obx + oby * oby + obz * obz;
  const d2 = m0 - rr * rr;
  const k2 = d2 - m2 * m2;
  const k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  const k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra;
  const h = k1 * k1 - k0 * k2;
  if (h >= 0 && Math.abs(k2) > 1e-12) {
    const t = (-Math.sqrt(h) - k1) / k2;
    const yy = m1 - ra * rr + t * m2;
    if (yy > 0 && yy < d2) {
      const nx = d2 * oax - bax * yy; const ny = d2 * oay - bay * yy; const nz = d2 * (oaz - t) - baz * yy;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[0] = nx / l; N[1] = ny / l; N[2] = nz / l;
      p._u = yy / d2;
      return -t;
    }
  }
  const h1 = m3 * m3 - m5 + ra * ra;
  const h2 = m6 * m6 - m7 + rb * rb;
  if (h1 < 0 && h2 < 0) return -Infinity;
  let best = Infinity;
  if (h1 >= 0) {
    const t = -m3 - Math.sqrt(h1);
    best = t;
    N[0] = oax / ra; N[1] = oay / ra; N[2] = (oaz - t) / ra;
    p._u = 0;
  }
  if (h2 >= 0) {
    const t = -m6 - Math.sqrt(h2);
    if (t < best) {
      best = t;
      N[0] = obx / rb; N[1] = oby / rb; N[2] = (obz - t) / rb;
      p._u = 1;
    }
  }
  return -best;
}

function hitEll(p, x, y) {
  // local = Rᵀ (o - c) / r ; d = Rᵀ(0,0,-1) / r
  const R = p.vR;
  const ox = x - p.vc[0]; const oy = y - p.vc[1]; const oz = -p.vc[2];
  const r = p.r;
  const lx = (R[0] * ox + R[3] * oy + R[6] * oz) / r[0];
  const ly = (R[1] * ox + R[4] * oy + R[7] * oz) / r[1];
  const lz = (R[2] * ox + R[5] * oy + R[8] * oz) / r[2];
  const dx = -R[6] / r[0]; const dy = -R[7] / r[1]; const dz = -R[8] / r[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - 1;
  const h = b * b - a * c;
  if (h < 0) return -Infinity;
  const t = (-b - Math.sqrt(h)) / a;
  const px = lx + t * dx; const py = ly + t * dy; const pz = lz + t * dz;
  L3[0] = px; L3[1] = py; L3[2] = pz;
  const gx = px / r[0]; const gy = py / r[1]; const gz = pz / r[2];
  const nx = R[0] * gx + R[1] * gy + R[2] * gz;
  const ny = R[3] * gx + R[4] * gy + R[5] * gz;
  const nz = R[6] * gx + R[7] * gy + R[8] * gz;
  const l = Math.hypot(nx, ny, nz) || 1;
  N[0] = nx / l; N[1] = ny / l; N[2] = nz / l;
  return -t;
}

function hitBox(p, x, y) {
  const R = p.vR;
  const ox = x - p.vc[0]; const oy = y - p.vc[1]; const oz = -p.vc[2];
  const lo = [R[0] * ox + R[3] * oy + R[6] * oz, R[1] * ox + R[4] * oy + R[7] * oz, R[2] * ox + R[5] * oy + R[8] * oz];
  const ld = [-R[6], -R[7], -R[8]];
  const hh = p.h;
  let tn = -Infinity;
  let tf = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (Math.abs(lo[i]) > hh[i]) return -Infinity;
      continue;
    }
    let t1 = (-hh[i] - lo[i]) / ld[i];
    let t2 = (hh[i] - lo[i]) / ld[i];
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tn) tn = t1;
    if (t2 < tf) tf = t2;
    if (tn > tf) return -Infinity;
  }
  const px = lo[0] + tn * ld[0]; const py = lo[1] + tn * ld[1]; const pz = lo[2] + tn * ld[2];
  L3[0] = px; L3[1] = py; L3[2] = pz;
  // rounded-box normal: sign(p) * max(|p| - (h - bevel), 0)
  const bv = p.bevel;
  let qx = Math.max(Math.abs(px) - (hh[0] - bv), 0) * Math.sign(px);
  let qy = Math.max(Math.abs(py) - (hh[1] - bv), 0) * Math.sign(py);
  let qz = Math.max(Math.abs(pz) - (hh[2] - bv), 0) * Math.sign(pz);
  if (qx === 0 && qy === 0 && qz === 0) {
    const ex = Math.abs(px) / hh[0]; const ey = Math.abs(py) / hh[1]; const ez = Math.abs(pz) / hh[2];
    if (ex >= ey && ex >= ez) qx = Math.sign(px); else if (ey >= ez) qy = Math.sign(py); else qz = Math.sign(pz);
  }
  const nx = R[0] * qx + R[1] * qy + R[2] * qz;
  const ny = R[3] * qx + R[4] * qy + R[5] * qz;
  const nz = R[6] * qx + R[7] * qy + R[8] * qz;
  const l = Math.hypot(nx, ny, nz) || 1;
  N[0] = nx / l; N[1] = ny / l; N[2] = nz / l;
  return -tn;
}

const HIT = [hitCone, hitEll, hitBox];

/** Transform prims into a view (rotation V), computing screen-space bboxes in view units. */
function toView(prims, V) {
  const out = [];
  for (const p of prims) {
    const q = { ...p, src: p.src ?? p };
    if (p.type === 0) {
      q.va = ap3(V, p.a);
      q.vb = ap3(V, p.b);
      q.x0 = Math.min(q.va[0] - p.ra, q.vb[0] - p.rb);
      q.x1 = Math.max(q.va[0] + p.ra, q.vb[0] + p.rb);
      q.y0 = Math.min(q.va[1] - p.ra, q.vb[1] - p.rb);
      q.y1 = Math.max(q.va[1] + p.ra, q.vb[1] + p.rb);
      const ax = norm(sub(q.vb, q.va));
      let e1 = cross(ax, [0, 0, 1]);
      if (len(e1) < 1e-3) e1 = cross(ax, [1, 0, 0]);
      e1 = norm(e1);
      q.ax = ax;
      q.e1 = e1;
      q.e2 = cross(ax, e1);
      q.L = len(sub(q.vb, q.va));
      q.z0 = Math.min(q.va[2] - p.ra, q.vb[2] - p.rb);
      q.z1 = Math.max(q.va[2] + p.ra, q.vb[2] + p.rb);
    } else {
      q.vc = ap3(V, p.c);
      q.vR = mul3(V, p.R);
      const ext = p.type === 1 ? p.r : p.h;
      // bbox half extents: |R| * ext
      const R = q.vR;
      const ex = Math.abs(R[0]) * ext[0] + Math.abs(R[1]) * ext[1] + Math.abs(R[2]) * ext[2];
      const ey = Math.abs(R[3]) * ext[0] + Math.abs(R[4]) * ext[1] + Math.abs(R[5]) * ext[2];
      const ez = Math.abs(R[6]) * ext[0] + Math.abs(R[7]) * ext[1] + Math.abs(R[8]) * ext[2];
      q.x0 = q.vc[0] - ex; q.x1 = q.vc[0] + ex; q.y0 = q.vc[1] - ey; q.y1 = q.vc[1] + ey;
      q.z0 = q.vc[2] - ez; q.z1 = q.vc[2] + ez;
    }
    out.push(q);
  }
  return out;
}

// ------------------------------------------------------------------ patterns

/**
 * Perturb the normal / albedo of a hit by its material pattern.
 * u,v: surface coordinates in units; tu, tv: tangents (view space).
 * Returns albedo multiplier; writes the perturbed normal into N.
 */
function pattern(m, u, v, tu, tv, wp, out) {
  const s = m.scale;
  let k = 1;
  let du = 0;
  let dv = 0;
  switch (m.pattern) {
    case 'scales': {
      // domain warp so the rows wander like real hide, not basketwork
      const wu = (vnoise(u / (s * 6), v / (s * 6)) - 0.5) * s * 1.6;
      const wv = (vnoise(u / (s * 6) + 9, v / (s * 6) + 4) - 0.5) * s * 1.6;
      u += wu;
      v += wv;
      const row = Math.floor(u / (s * 0.8));
      const fu = u / (s * 0.8) - row;
      const vv = v / s + (row & 1) * 0.5;
      const col = Math.floor(vv);
      const fv = vv - col;
      const cv = (fv - 0.5) * 2;
      // each scale is a dome whose lower edge overlaps the next row
      const hgt = 1 - cv * cv - fu * fu * 0.9;
      const edge = Math.max(0, 1 - hgt * 3.2);
      du = -fu * 0.9 * 0.55;
      dv = -cv * 0.55;
      const rnd = hash2(row, col);
      k = (0.9 + rnd * 0.14) * (1 - edge * 0.2) * (0.82 + fbm(u / (s * 9), v / (s * 9), 2) * 0.36);
      out.edge = edge;
      if (m.tint2) out.t2 = Math.max(0, Math.min(1, (rnd - 0.55) * 2.5));
      break;
    }
    case 'fur': {
      const n1 = vnoise(u / (s * 2.4), v / (s * 0.22));
      const n2 = vnoise(u / (s * 0.9) + 7, v / (s * 0.12) + 3);
      dv = (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.5;
      du = (vnoise(u / (s * 0.5), v / (s * 0.5)) - 0.5) * 0.3;
      k = 0.72 + n1 * 0.35 + n2 * 0.12;
      break;
    }
    case 'cloth': {
      const fold = Math.sin(v / (s * 1.4) + fbm(u / (s * 6), v / (s * 6)) * 5);
      const weave = (Math.sin(u / (s * 0.06)) * Math.sin(v / (s * 0.06))) * 0.06;
      dv = fold * 0.28 + weave;
      du = (vnoise(u / (s * 3), v / (s * 3)) - 0.5) * 0.25;
      k = 0.86 + fold * 0.06 + fbm(u / (s * 2), v / (s * 2), 2) * 0.16;
      break;
    }
    case 'leather': {
      const n = fbm(u / (s * 1.5), v / (s * 1.5), 3);
      const w = vnoise(u / (s * 0.25), v / (s * 0.9));
      du = (n - 0.5) * 0.35;
      dv = (w - 0.5) * 0.25;
      k = 0.78 + n * 0.32;
      break;
    }
    case 'metal': {
      const br = vnoise(u / (s * 4), v / (s * 0.08));
      const dent = vnoise(u / (s * 1.2) + 11, v / (s * 1.2));
      du = (dent - 0.5) * 0.25;
      dv = (br - 0.5) * 0.12;
      k = 0.82 + br * 0.18 + (dent > 0.78 ? -0.12 : 0);
      out.rust = Math.max(0, fbm(wp[0] * 9 + 3, wp[1] * 9, 3) - 0.62) * 2.4;
      break;
    }
    case 'mail': {
      const row = Math.floor(u / (s * 0.22));
      const vv = v / (s * 0.22) + (row & 1) * 0.5;
      const fu = u / (s * 0.22) - row - 0.5;
      const fv = vv - Math.floor(vv) - 0.5;
      const r = Math.hypot(fu, fv);
      const ring = Math.abs(r - 0.32) < 0.13 ? 1 : 0;
      du = ring ? fu * 0.9 : 0;
      dv = ring ? fv * 0.9 : 0;
      k = ring ? 1.08 : 0.45;
      break;
    }
    case 'wood': {
      const g = Math.sin(v / (s * 0.1) + fbm(u / (s * 3), v / (s * 0.5), 2) * 6);
      k = 0.82 + g * 0.12;
      dv = g * 0.12;
      break;
    }
    case 'skin': {
      const n = fbm(wp[0] / (s * 1.2), wp[1] / (s * 1.2) + wp[2] / (s * 3), 3);
      k = 0.9 + n * 0.16;
      du = (n - 0.5) * 0.2;
      break;
    }
    case 'bone': {
      const n = fbm(u / (s * 1.4), v / (s * 0.8), 3);
      const crack = Math.abs(vnoise(u / (s * 0.7), v / (s * 0.3)) - 0.5) < 0.03 ? 0.6 : 1;
      k = (0.8 + n * 0.3) * crack;
      du = (n - 0.5) * 0.3;
      break;
    }
    case 'stone': {
      const n = fbm(wp[0] / s, wp[1] / s + wp[2] / s, 4);
      k = 0.75 + n * 0.4;
      du = (n - 0.5) * 0.5;
      dv = (vnoise(wp[0] / (s * 0.3), wp[1] / (s * 0.3)) - 0.5) * 0.3;
      break;
    }
    default:
      return 1;
  }
  N[0] += tu[0] * du + tv[0] * dv;
  N[1] += tu[1] * du + tv[1] * dv;
  N[2] += tu[2] * du + tv[2] * dv;
  const l = Math.hypot(N[0], N[1], N[2]) || 1;
  N[0] /= l; N[1] /= l; N[2] /= l;
  return k;
}

// ------------------------------------------------------------------ render

/**
 * Lights (world space; dirs point from the surface toward the light):
 *   key: {dir, color, i}, rim: {dir, color, i}, sky, ground (ambient colours), amb (intensity)
 */
export const DEFAULT_RIG = {
  key: { dir: [-0.6, 0.55, 0.6], color: '#ffb070', i: 1.25 },
  rim: { dir: [0.75, 0.35, -0.6], color: '#9ab8ff', i: 0.9 },
  sky: '#4a5a80', ground: '#2a1e16', amb: 0.55,
};

/**
 * Render a figure into an antialiased sprite.
 * @param {Figure} fig
 * @param {object} o
 *   ppu        output pixels per unit (≈ pixel height of a human)
 *   yaw        rotation of the figure about its vertical axis (radians, + turns it to its left)
 *   pitch      camera elevation (radians, + looks down on the figure)
 *   rig        lights (see DEFAULT_RIG)
 *   ss         supersampling (default 2)
 *   haze       0..1 depth fog toward hazeColor
 *   ghost      spectral render mode (colour = ghost colour)
 *   layer      which layer to render ('main' default, or e.g. 'tail')
 *   ink        contour strength (0..1)
 * @returns {{canvas:HTMLCanvasElement, ox:number, oy:number, emit:{x:number,y:number,r:number,color:string,a:number}[]}}
 */
export function renderFigure(fig, o = {}) {
  const ss = o.ss ?? 2;
  const P = (o.ppu ?? 200) * ss;
  const V = mul3(rotX(o.pitch ?? 0.06), rotY(o.yaw ?? 0));
  const rig = o.rig ?? DEFAULT_RIG;
  const layer = o.layer ?? 'main';
  const allV = toView(fig.prims, V);
  const all = allV.filter((p) => !p.sub);
  const prims = all.filter((p) => p.layer === layer);
  if (!prims.length) return null;
  // extents (view units)
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const p of prims) { x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1); }
  const pad = 4 * ss;
  const W = Math.ceil((x1 - x0) * P) + pad * 2;
  const H = Math.ceil((y1 - y0) * P) + pad * 2;
  const offX = -x0 * P + pad;
  const offY = y1 * P + pad;
  if (o.gpu !== false && sdfAvailable()) {
    const r = renderGL(fig, o, { all, prims: allV.filter((p) => p.layer === layer), V, rig, ss, P, W, H, offX, offY, x0, x1, y0, y1 });
    if (r) return r;
  }
  const n = W * H;
  const zb = new Float32Array(n).fill(-Infinity);
  const ib = new Int16Array(n).fill(-1);
  // pass A: depth
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const hit = HIT[p.type];
    const px0 = Math.max(0, Math.floor(p.x0 * P + offX));
    const px1 = Math.min(W - 1, Math.ceil(p.x1 * P + offX));
    const py0 = Math.max(0, Math.floor(-p.y1 * P + offY));
    const py1 = Math.min(H - 1, Math.ceil(-p.y0 * P + offY));
    for (let py = py0; py <= py1; py++) {
      const y = -(py + 0.5 - offY) / P;
      for (let px = px0; px <= px1; px++) {
        const x = (px + 0.5 - offX) / P;
        const z = hit(p, x, y);
        const idx = py * W + px;
        if (z > zb[idx]) { zb[idx] = z; ib[idx] = i; }
      }
    }
  }
  // pass B: normals, blending, patterns
  const nxb = new Float32Array(n); const nyb = new Float32Array(n); const nzb = new Float32Array(n);
  const cr = new Float32Array(n); const cg = new Float32Array(n); const cb = new Float32Array(n);
  const aw = new Float32Array(n); // accumulated blend weight
  const fnx = new Float32Array(n); const fny = new Float32Array(n); const fnz = new Float32Array(n); // front normal (perturbed)
  const fk = new Float32Array(n); // pattern albedo multiplier
  const fx = new Float32Array(n); // edge / rust / tint2 scratch packed
  const fy = new Float32Array(n);
  const scratch = {};
  const VT = tr3(V);
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const hit = HIT[p.type];
    const px0 = Math.max(0, Math.floor(p.x0 * P + offX));
    const px1 = Math.min(W - 1, Math.ceil(p.x1 * P + offX));
    const py0 = Math.max(0, Math.floor(-p.y1 * P + offY));
    const py1 = Math.min(H - 1, Math.ceil(-p.y0 * P + offY));
    const m = p.mat;
    for (let py = py0; py <= py1; py++) {
      const y = -(py + 0.5 - offY) / P;
      for (let px = px0; px <= px1; px++) {
        const idx = py * W + px;
        const front = ib[idx];
        if (front < 0) continue;
        if (front !== i) {
          const fp = prims[front];
          if (p.group == null || fp.group !== p.group) continue;
          const k = Math.max(p.blend, fp.blend);
          const zf = zb[idx];
          const x = (px + 0.5 - offX) / P;
          const z = hit(p, x, y);
          if (z === -Infinity || z < zf - k) continue;
          const w = (1 - (zf - z) / k) ** 2 * 0.85;
          nxb[idx] += N[0] * w; nyb[idx] += N[1] * w; nzb[idx] += N[2] * w;
          cr[idx] += m.color[0] * w; cg[idx] += m.color[1] * w; cb[idx] += m.color[2] * w;
          aw[idx] += w;
          continue;
        }
        const x = (px + 0.5 - offX) / P;
        const z = hit(p, x, y);
        // surface coordinates & tangents
        let u = 0; let v = 0; let tu; let tv;
        const nrm = [N[0], N[1], N[2]];
        if (m.pattern) {
          if (p.type === 0) {
            const qx = x - p.va[0]; const qy = y - p.va[1]; const qz = z - p.va[2];
            u = qx * p.ax[0] + qy * p.ax[1] + qz * p.ax[2];
            const a1 = qx * p.e1[0] + qy * p.e1[1] + qz * p.e1[2];
            const a2 = qx * p.e2[0] + qy * p.e2[1] + qz * p.e2[2];
            v = Math.atan2(a2, a1) * (p.ra + p.rb) * 0.5;
            tu = p.ax;
            tv = norm(cross(nrm, p.ax));
          } else {
            const ext = p.type === 1 ? p.r : p.h;
            if (p.type === 1) {
              u = Math.asin(Math.max(-1, Math.min(1, L3[1]))) * ext[1];
              v = Math.atan2(L3[0], L3[2]) * (ext[0] + ext[2]) * 0.5;
            } else {
              u = L3[1];
              v = L3[0] + L3[2];
            }
            const R = p.vR;
            const ay = [R[1], R[4], R[7]];
            tu = norm(sub(ay, scl(nrm, dot(ay, nrm))));
            tv = cross(nrm, tu);
          }
        }
        scratch.edge = 0; scratch.rust = 0; scratch.t2 = 0;
        const wp = ap3(VT, [x, y, z]);
        N[0] = nrm[0]; N[1] = nrm[1]; N[2] = nrm[2];
        const k = m.pattern ? pattern(m, u, v, tu, tv, wp, scratch) : 1;
        fnx[idx] = N[0]; fny[idx] = N[1]; fnz[idx] = N[2];
        fk[idx] = k;
        fx[idx] = scratch.edge + scratch.rust * 10;
        fy[idx] = scratch.t2;
        // base normal into the blend accumulator (weight 1)
        nxb[idx] += nrm[0]; nyb[idx] += nrm[1]; nzb[idx] += nrm[2];
        let c0 = m.color;
        if (m.tint2 && scratch.t2 > 0) c0 = [c0[0] + (m.tint2[0] - c0[0]) * scratch.t2, c0[1] + (m.tint2[1] - c0[1]) * scratch.t2, c0[2] + (m.tint2[2] - c0[2]) * scratch.t2];
        cr[idx] += c0[0]; cg[idx] += c0[1]; cb[idx] += c0[2];
        aw[idx] += 1;
      }
    }
  }
  // shadow map from the key light
  const keyW = norm(rig.key.dir);
  const keyV = ap3(V, keyW);
  let shadowAt = null;
  if (o.shadow !== false) {
    // light-space rotation: maps keyW to +z
    const Lr = (() => {
      const z = keyW;
      let x = cross([0, 1, 0], z);
      if (len(x) < 1e-3) x = [1, 0, 0];
      x = norm(x);
      const y = cross(z, x);
      return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
    })();
    const lp = toView(all.filter((p) => p.shadow), Lr);
    if (lp.length) {
      let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
      for (const p of lp) { a0 = Math.min(a0, p.x0); a1 = Math.max(a1, p.x1); b0 = Math.min(b0, p.y0); b1 = Math.max(b1, p.y1); }
      const SP = P * 0.5;
      const SW = Math.ceil((a1 - a0) * SP) + 4;
      const SH = Math.ceil((b1 - b0) * SP) + 4;
      const sm = new Float32Array(SW * SH).fill(-Infinity);
      const sox = -a0 * SP + 2;
      const soy = b1 * SP + 2;
      for (const p of lp) {
        const hit = HIT[p.type];
        const qx0 = Math.max(0, Math.floor(p.x0 * SP + sox));
        const qx1 = Math.min(SW - 1, Math.ceil(p.x1 * SP + sox));
        const qy0 = Math.max(0, Math.floor(-p.y1 * SP + soy));
        const qy1 = Math.min(SH - 1, Math.ceil(-p.y0 * SP + soy));
        for (let qy = qy0; qy <= qy1; qy++) {
          const yy = -(qy + 0.5 - soy) / SP;
          for (let qx = qx0; qx <= qx1; qx++) {
            const z = hit(p, (qx + 0.5 - sox) / SP, yy);
            const k = qy * SW + qx;
            if (z > sm[k]) sm[k] = z;
          }
        }
      }
      const bias = 2.2 / SP;
      shadowAt = (w) => {
        const l = ap3(Lr, w);
        const fxp = l[0] * SP + sox - 0.5;
        const fyp = -l[1] * SP + soy - 0.5;
        let lit = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = Math.round(fxp + dx);
            const sy = Math.round(fyp + dy);
            cnt++;
            if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) { lit++; continue; }
            if (l[2] >= sm[sy * SW + sx] - bias) lit++;
          }
        }
        return lit / cnt;
      };
    }
  }
  // screen-space AO: blurred depth vs depth
  const zf = new Float32Array(n);
  const cov = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (ib[i] >= 0) { zf[i] = zb[i]; cov[i] = 1; } }
  const blur = (src, rad) => {
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -rad; x < W; x++) {
        if (x + rad < W) acc += src[row + x + rad];
        if (x - rad - 1 >= 0) acc -= src[row + x - rad - 1];
        if (x >= 0) tmp[row + x] = acc;
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -rad; y < H; y++) {
        if (y + rad < H) acc += tmp[(y + rad) * W + x];
        if (y - rad - 1 >= 0) acc -= tmp[(y - rad - 1) * W + x];
        if (y >= 0) out[y * W + x] = acc;
      }
    }
    return out;
  };
  const aoR = Math.max(2, Math.round(P * 0.035));
  const zs = blur(zf, aoR);
  const cs = blur(cov, aoR);
  // shading
  const img = new ImageData(W, H);
  const D = img.data;
  const kc0 = hex(rig.key.color); const ks = o.keySat ?? 0.55; const kc = [kc0[0] + (1 - kc0[0]) * (1 - ks) * 0.85, kc0[1] + (0.95 - kc0[1]) * (1 - ks) * 0.85, kc0[2] + (0.88 - kc0[2]) * (1 - ks) * 0.85]; const ki = rig.key.i ?? 1.2;
  const rimW = norm(rig.rim?.dir ?? [0.7, 0.3, -0.6]);
  const rimV = ap3(V, rimW);
  const rc = hex(rig.rim?.color ?? '#9ab0ff'); const ri = rig.rim?.i ?? 0.8;
  const sky = hex(rig.sky ?? '#4a5a80'); const gnd = hex(rig.ground ?? '#2a1e16'); const amb = rig.amb ?? 0.5;
  const fill = rig.fill ? { d: ap3(V, norm(rig.fill.dir)), c: hex(rig.fill.color), i: rig.fill.i ?? 0.3 } : null;
  const hv = norm([keyV[0], keyV[1], keyV[2] + 1]);
  const haze = o.haze ?? 0;
  const hz = hex(o.hazeColor ?? '#202830');
  const ghost = o.ghost ? hex(o.ghost === true ? '#9ff4ff' : o.ghost) : null;
  const zmin = (() => { let m = Infinity; for (let i = 0; i < n; i++) if (ib[i] >= 0 && zb[i] < m) m = zb[i]; return m; })();
  const yFeet = offY; // pixel row of y = 0
  const figH = (y1 - Math.max(0, y0)) * P;
  const lum = new Float32Array(n);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      const pi = ib[idx];
      if (pi < 0) continue;
      const p = prims[pi];
      const m = p.mat;
      const w = aw[idx];
      // blended base normal + front perturbation
      let nx = nxb[idx]; let ny = nyb[idx]; let nz = nzb[idx];
      let l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      // add the pattern perturbation (front normal minus its base direction is small; blend toward it)
      nx = nx * 0.45 + fnx[idx] * 0.55; ny = ny * 0.45 + fny[idx] * 0.55; nz = nz * 0.45 + fnz[idx] * 0.55;
      l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const k = fk[idx];
      let ar = (cr[idx] / w) * k; let ag = (cg[idx] / w) * k; let ab = (cb[idx] / w) * k;
      const extra = fx[idx];
      const rust = extra >= 10 ? Math.min(1, Math.floor(extra) / 10) : 0;
      if (m.metal && rust > 0) { const t = Math.min(0.7, rust); ar += (0.36 - ar) * t; ag += (0.2 - ag) * t; ab += (0.1 - ab) * t; }
      // world position for shadows
      const z = zb[idx];
      const x = (px + 0.5 - offX) / P;
      const y = -(py + 0.5 - offY) / P;
      const sh = shadowAt ? shadowAt([VT[0] * x + VT[1] * y + VT[2] * z, VT[3] * x + VT[4] * y + VT[5] * z, VT[6] * x + VT[7] * y + VT[8] * z]) : 1;
      // AO
      const zavg = cs[idx] > 0 ? zs[idx] / cs[idx] : z;
      const occ = Math.max(0, zavg - z) * 6 + (1 - cs[idx] / ((aoR * 2 + 1) ** 2)) * 0.1;
      const ao = Math.max(0.35, 1 - occ);
      // ground contact darkening & height gradient (Darkest-Dungeon style)
      const hgt = Math.max(0, Math.min(1, (yFeet - py) / Math.max(1, figH)));
      const footDark = 0.62 + 0.38 * Math.min(1, hgt * 4.5);
      // lighting
      const ndl = nx * keyV[0] + ny * keyV[1] + nz * keyV[2];
      const wrap = m.sss;
      const diff = Math.max(0, (ndl + wrap) / (1 + wrap)) * sh;
      const hemi = ny * 0.5 + 0.5;
      const ambR = (gnd[0] + (sky[0] - gnd[0]) * hemi) * amb * ao;
      const ambG = (gnd[1] + (sky[1] - gnd[1]) * hemi) * amb * ao;
      const ambB = (gnd[2] + (sky[2] - gnd[2]) * hemi) * amb * ao;
      let fr = 0; let fg = 0; let fb = 0;
      if (fill) { const fd = Math.max(0, nx * fill.d[0] + ny * fill.d[1] + nz * fill.d[2]) * fill.i; fr = fill.c[0] * fd; fg = fill.c[1] * fd; fb = fill.c[2] * fd; }
      const fres = 1 - Math.max(0, nz);
      const rimT = Math.max(0, nx * rimV[0] + ny * rimV[1] + nz * rimV[2] + 0.35) * fres ** 2.2 * ri;
      const shin = 6 + (1 - m.rough) * 90;
      const ndh = Math.max(0, nx * hv[0] + ny * hv[1] + nz * hv[2]);
      const spec = m.spec * ndh ** shin * sh * ki * (m.metal ? 2.2 : 1);
      let r; let g; let b;
      const dk = ki * diff;
      if (m.metal) {
        // metals: darker diffuse, coloured specular, strong environment reflection of sky/ground
        const env = hemi;
        r = ar * (dk * 0.55 * kc[0] + ambR * 0.8 + fr) + spec * kc[0] * (0.4 + ar) + (gnd[0] + (sky[0] - gnd[0]) * env) * 0.25 * ar * ao + rimT * rc[0] * (0.5 + ar);
        g = ag * (dk * 0.55 * kc[1] + ambG * 0.8 + fg) + spec * kc[1] * (0.4 + ag) + (gnd[1] + (sky[1] - gnd[1]) * env) * 0.25 * ag * ao + rimT * rc[1] * (0.5 + ag);
        b = ab * (dk * 0.55 * kc[2] + ambB * 0.8 + fb) + spec * kc[2] * (0.4 + ab) + (gnd[2] + (sky[2] - gnd[2]) * env) * 0.25 * ab * ao + rimT * rc[2] * (0.5 + ab);
      } else {
        // subsurface tint in the terminator for skin/organic materials
        const sss = wrap > 0.3 ? Math.max(0, 1 - Math.abs(ndl) * 3) * 0.18 * sh : 0;
        r = ar * (dk * kc[0] + ambR + fr) + spec * kc[0] + rimT * rc[0] * (0.35 + ar * 0.6) + sss * ar * 1.2;
        g = ag * (dk * kc[1] + ambG + fg) + spec * kc[1] + rimT * rc[1] * (0.35 + ag * 0.6) + sss * ag * 0.35;
        b = ab * (dk * kc[2] + ambB + fb) + spec * kc[2] + rimT * rc[2] * (0.35 + ab * 0.6) + sss * ab * 0.2;
      }
      r *= footDark; g *= footDark; b *= footDark;
      if (m.emissive) { r += m.emissive[0]; g += m.emissive[1]; b += m.emissive[2]; }
      // soft tone curve
      r = r / (1 + r * 0.28) * 1.18; g = g / (1 + g * 0.28) * 1.18; b = b / (1 + b * 0.28) * 1.18;
      // depth haze: overall plus a little more toward the back of the figure
      const dz = Math.max(0, Math.min(1, (z - zmin) * 3));
      const hh = Math.min(0.92, haze * (1.08 - dz * 0.16));
      if (hh > 0) { r += (hz[0] - r) * hh; g += (hz[1] - g) * hh; b += (hz[2] - b) * hh; }
      lum[idx] = diff * 0.7 + fres * 0.3;
      if (ghost) {
        const L = Math.min(1.4, 0.18 + diff * 0.55 + spec * 0.6 + rimT * 0.9 + (m.emissive ? 1 : 0));
        r = ghost[0] * L; g = ghost[1] * L; b = ghost[2] * L;
        lum[idx] = 0.3 + fres * 0.7;
      }
      const o4 = idx * 4;
      D[o4] = Math.max(0, Math.min(255, r * 255));
      D[o4 + 1] = Math.max(0, Math.min(255, g * 255));
      D[o4 + 2] = Math.max(0, Math.min(255, b * 255));
      D[o4 + 3] = 255;
    }
  }
  // painterly pass: a Kuwahara filter turns smooth shading into flat oil-paint strokes
  const kr = o.paint ?? Math.max(1, Math.round(ss * 1.2));
  if (kr > 0 && !ghost) kuwahara(D, ib, W, H, kr);
  // ink contour: silhouette + depth / group discontinuities
  const ink = o.ink ?? 0.8;
  if (ink > 0 || ghost) {
    const inkC = ghost ? [0.85, 1, 1] : [0.07, 0.04, 0.03];
    const thr = 0.012 * (o.inkDepth ?? 1);
    const edge = new Float32Array(n);
    const rad = Math.max(1, Math.round(ss * 0.75));
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = py * W + px;
        const pi = ib[idx];
        if (pi < 0) continue;
        let e = 0;
        const z = zb[idx];
        const g0 = prims[pi].group;
        for (let d = 1; d <= rad; d++) {
          for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
            const qx = px + dx; const qy = py + dy;
            if (qx < 0 || qy < 0 || qx >= W || qy >= H) { e = Math.max(e, 1); continue; }
            const q = qy * W + qx;
            const qi = ib[q];
            if (qi < 0) { e = Math.max(e, 1); continue; }
            const dz = zb[q] - z;
            if (dz > thr) e = Math.max(e, Math.min(1, (dz - thr) / (thr * 2)) * (prims[qi].group === g0 && g0 != null ? 0.45 : 0.85));
          }
        }
        edge[idx] = e * prims[pi].mat.ink;
      }
    }
    for (let i = 0; i < n; i++) {
      const e = edge[i];
      if (e <= 0) continue;
      const o4 = i * 4;
      const a = ghost ? e * 0.9 : e * ink;
      D[o4] += (inkC[0] * 255 - D[o4]) * a;
      D[o4 + 1] += (inkC[1] * 255 - D[o4 + 1]) * a;
      D[o4 + 2] += (inkC[2] * 255 - D[o4 + 2]) * a;
      if (ghost) lum[i] = Math.max(lum[i], e);
    }
  }
  if (ghost) {
    // spectral: alpha from fresnel/edges, fading toward the feet into mist
    for (let py = 0; py < H; py++) {
      const hgt = Math.max(0, Math.min(1, (yFeet - py) / Math.max(1, figH)));
      const fade = Math.min(1, 0.15 + hgt * 1.6);
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        if (ib[i] < 0) continue;
        D[i * 4 + 3] = Math.max(0, Math.min(255, (0.22 + lum[i] * 0.78) * fade * 255));
      }
    }
  }
  const big = document.createElement('canvas');
  big.width = W;
  big.height = H;
  big.getContext('2d').putImageData(img, 0, 0);
  const outW = Math.ceil(W / ss);
  const outH = Math.ceil(H / ss);
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const g2 = c.getContext('2d');
  g2.imageSmoothingEnabled = true;
  g2.imageSmoothingQuality = 'high';
  g2.drawImage(big, 0, 0, outW, outH);
  const emit = [];
  for (const e of fig.emit) {
    const v = ap3(V, e.p);
    const ex = Math.round(v[0] * P + offX);
    const ey = Math.round(-v[1] * P + offY);
    if (ex >= 0 && ey >= 0 && ex < W && ey < H && ib[ey * W + ex] >= 0 && zb[ey * W + ex] > v[2] + e.r * 0.6) continue;
    emit.push({ x: (v[0] * P + offX) / ss, y: (-v[1] * P + offY) / ss, r: e.r * P / ss, color: e.color, a: e.a, z: v[2] });
  }
  return { canvas: c, ox: offX / ss, oy: offY / ss, emit, ppu: P / ss };
}

/** In-place generalized Kuwahara (4 quadrants) over covered pixels. */
function kuwahara(D, ib, W, H, r) {
  const src = new Uint8ClampedArray(D);
  // summed-area tables of r, g, b and luminance² for O(1) quadrant stats
  const W1 = W + 1;
  const n = W1 * (H + 1);
  const sr = new Float64Array(n); const sg = new Float64Array(n); const sb = new Float64Array(n); const sl = new Float64Array(n); const sl2 = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    let ar = 0; let ag = 0; let ab = 0; let al = 0; let al2 = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11;
      ar += src[i]; ag += src[i + 1]; ab += src[i + 2]; al += l; al2 += l * l;
      const k = (y + 1) * W1 + x + 1;
      sr[k] = sr[k - W1] + ar; sg[k] = sg[k - W1] + ag; sb[k] = sb[k - W1] + ab; sl[k] = sl[k - W1] + al; sl2[k] = sl2[k - W1] + al2;
    }
  }
  const box = (T, x0, y0, x1, y1) => T[(y1 + 1) * W1 + x1 + 1] - T[y0 * W1 + x1 + 1] - T[(y1 + 1) * W1 + x0] + T[y0 * W1 + x0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (ib[idx] < 0) continue;
      let best = Infinity; let br = 0; let bg = 0; let bb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : Math.max(0, x - r);
        const x1 = q & 1 ? Math.min(W - 1, x + r) : x;
        const y0 = q & 2 ? y : Math.max(0, y - r);
        const y1 = q & 2 ? Math.min(H - 1, y + r) : y;
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const m = box(sl, x0, y0, x1, y1) / cnt;
        const v = box(sl2, x0, y0, x1, y1) / cnt - m * m;
        if (v < best) { best = v; br = box(sr, x0, y0, x1, y1) / cnt; bg = box(sg, x0, y0, x1, y1) / cnt; bb = box(sb, x0, y0, x1, y1) / cnt; }
      }
      const o4 = idx * 4;
      D[o4] = br; D[o4 + 1] = bg; D[o4 + 2] = bb;
    }
  }
}

/** Light-space rotation that maps the (world) key direction to +z. */
function lightBasis(keyW) {
  const z = keyW;
  let x = cross([0, 1, 0], z);
  if (len(x) < 1e-3) x = [1, 0, 0];
  x = norm(x);
  const y = cross(z, x);
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

/** GPU path of renderFigure (sdfgl.js): smooth-min sculpting, fold geometry, SDF shadows/AO. */
function renderGL(fig, o, c) {
  const { all, prims, V, rig, ss, P, W, H, offX, offY, y0, y1 } = c;
  const VT = tr3(V);
  const keyW = norm(rig.key.dir);
  const keyV = ap3(V, keyW);
  // light space as seen from view space: Lv = Lr(world) * VT
  let shadowPrims = null;
  let Lv = null;
  if (o.shadow !== false) {
    const LB = lightBasis(keyW);
    Lv = mul3(LB, VT);
    const sp = fig.prims.filter((p) => p.shadow);
    if (sp.length) {
      // view-space geometry (what the shader evaluates), binned by light-space bounds
      const lb = toView(sp, LB);
      const vp = toView(sp, V);
      shadowPrims = vp.map((q, i) => ({ ...q, x0: lb[i].x0, x1: lb[i].x1, y0: lb[i].y0, y1: lb[i].y1, z0: lb[i].z0, z1: lb[i].z1 }));
    }
  }
  const kc0 = hex(rig.key.color); const ks = o.keySat ?? 0.55;
  const kc = [kc0[0] + (1 - kc0[0]) * (1 - ks) * 0.85, kc0[1] + (0.95 - kc0[1]) * (1 - ks) * 0.85, kc0[2] + (0.88 - kc0[2]) * (1 - ks) * 0.85];
  let zmin = Infinity;
  for (const p of prims) if (!p.sub) zmin = Math.min(zmin, (p.z0 + p.z1) * 0.5);
  const ghost = o.ghost ? hex(o.ghost === true ? '#9ff4ff' : o.ghost) : null;
  const t0 = performance.now();
  const big = traceFigure(prims, shadowPrims, {
    P, W, H, offX, offY, ss, VT, Lr: Lv,
    keyV, kc, ki: rig.key.i ?? 1.2,
    rimV: ap3(V, norm(rig.rim?.dir ?? [0.7, 0.3, -0.6])), rc: hex(rig.rim?.color ?? '#9ab0ff'), ri: rig.rim?.i ?? 0.8,
    sky: hex(rig.sky ?? '#4a5a80'), gnd: hex(rig.ground ?? '#2a1e16'), amb: rig.amb ?? 0.5,
    fill: rig.fill ? { d: ap3(V, norm(rig.fill.dir)), c: hex(rig.fill.color), i: rig.fill.i ?? 0.3 } : null,
    haze: o.haze ?? 0, hz: hex(o.hazeColor ?? '#202830'), ghost,
    ink: o.ink ?? 0.8, paint: o.paint ?? Math.max(1, Math.round(ss * 1.2)), inkDepth: o.inkDepth,
    yFeet: offY, figH: (y1 - Math.max(0, y0)) * P, zmin,
  });
  if (!big) return null;
  if (globalThis.__SDF_LOG) console.log(`sdf ${W}x${H} prims=${prims.length} ${(performance.now() - t0).toFixed(0)}ms`);
  const outW = Math.ceil(W / ss);
  const outH = Math.ceil(H / ss);
  const cv = document.createElement('canvas');
  cv.width = outW;
  cv.height = outH;
  const g2 = cv.getContext('2d');
  g2.imageSmoothingEnabled = true;
  g2.imageSmoothingQuality = 'high';
  g2.drawImage(big, 0, 0, outW, outH);
  // glows hidden behind the figure are dropped (analytic front depth at that pixel)
  const emit = [];
  for (const e of fig.emit) {
    const v = ap3(V, e.p);
    let zf = -Infinity;
    for (const p of prims) {
      if (v[0] < p.x0 || v[0] > p.x1 || v[1] < p.y0 || v[1] > p.y1) continue;
      if (p.sub) continue;
      const z = HIT[p.type](p, v[0], v[1]);
      if (z > zf) zf = z;
    }
    if (zf > v[2] + e.r * 0.6) continue;
    emit.push({ x: (v[0] * P + offX) / ss, y: (-v[1] * P + offY) / ss, r: e.r * P / ss, color: e.color, a: e.a, z: v[2] });
  }
  return { canvas: cv, ox: offX / ss, oy: offY / ss, emit, ppu: P / ss };
}
