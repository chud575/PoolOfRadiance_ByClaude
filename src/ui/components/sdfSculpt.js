/**
 * Signed-distance sculpting for the party miniatures and portraits.
 *
 * A Sculpt is a list of analytic primitives (tapered round cones, ellipsoids,
 * rounded boxes) in figure space, each with a material, a smooth-union radius
 * and a layer ("group"). Primitives of one layer melt into each other with a
 * polynomial smooth-min (a continuous sculpted body instead of a mannequin of
 * parts); layers meet with a hard edge (armour over flesh, hair over skull).
 * Subtractive primitives carve (eye sockets, the mouth line). Optional clip
 * planes, shells (cloaks, hoods, helms) and bounded displacement functions
 * (strand clumps in hair, folds in cloth) refine each primitive.
 *
 * meshSculpt() samples the field on a sparse grid (blocks far from the surface
 * are skipped using per-block primitive lists), extracts a watertight mesh with
 * surface nets, then bakes per vertex: the SDF gradient normal, the material
 * (colours blended softly across material borders, e.g. a feathered hairline),
 * an SDF ambient-occlusion term (eye sockets, armpits, under belts) and a
 * curvature term used for the painted-miniature look (edge highlights, washed
 * recesses).
 *
 * Pure and deterministic: no randomness, no DOM, no three.js.
 */

const BIG = 1e9;

// ------------------------------------------------------------------ small vector helpers (arrays [x,y,z])

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a) => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 3×3 matrices as flat arrays, column-major: columns are the local X, Y, Z axes in world space. */
export const M_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mAxes(x, y, z) {
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}
/** Apply local→world: R·v */
export const mApply = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
/** world→local: Rᵀ·v */
export const mApplyT = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
export function mMul(A, B) {
  const c0 = mApply(A, [B[0], B[1], B[2]]);
  const c1 = mApply(A, [B[3], B[4], B[5]]);
  const c2 = mApply(A, [B[6], B[7], B[8]]);
  return [...c0, ...c1, ...c2];
}
export function mRotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; }
export function mRotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
export function mRotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; }
/** Yaw (Y), then pitch (X), then roll (Z), intrinsic. */
export const mEuler = (pitch = 0, yaw = 0, roll = 0) => mMul(mRotY(yaw), mMul(mRotX(pitch), mRotZ(roll)));
/** A frame whose Y axis is `dir`, with X as close as possible to `side`. */
export function mAlongY(dir, side = [1, 0, 0]) {
  const y = vnorm(dir);
  let z = vcross(side, y);
  if (vlen(z) < 1e-5) z = vcross([0, 0, 1], y);
  z = vnorm(z);
  const x = vcross(y, z);
  return mAxes(x, y, z);
}

/** Two-bone IK: the middle joint for root→target with lengths l1, l2, bending toward `pole`. */
export function ik2(root, target, l1, l2, pole) {
  let d = vsub(target, root);
  let dl = vlen(d);
  const maxL = (l1 + l2) * 0.9995;
  if (dl > maxL) { d = vscale(d, maxL / dl); dl = maxL; }
  const minL = Math.abs(l1 - l2) + 1e-4;
  if (dl < minL) { d = vscale(vnorm(d), minL); dl = minL; }
  const dir = vscale(d, 1 / dl);
  const a = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = vsub(pole, root);
  p = vsub(p, vscale(dir, vdot(p, dir)));
  if (vlen(p) < 1e-6) p = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  p = vnorm(p);
  return vadd(root, vadd(vscale(dir, a), vscale(p, hgt)));
}

// ------------------------------------------------------------------ primitives

const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

/** Round cone between a and b with radii ra, rb (iq). */
function fRoundCone(a, b, r1, r2) {
  const ba = vsub(b, a);
  const l2 = vdot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const ax = a[0], ay = a[1], az = a[2], bx = ba[0], by = ba[1], bz = ba[2];
  return (x, y, z) => {
    const px = x - ax, py = y - ay, pz = z - az;
    const yy = px * bx + py * by + pz * bz;
    const zz = yy - l2;
    const qx = px * l2 - bx * yy, qy = py * l2 - by * yy, qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

/** Ellipsoid (iq's bound) centred at c with radii r, frame R. */
function fEllipsoid(c, r, R) {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const R0 = R[0], R1 = R[1], R2 = R[2], R3 = R[3], R4 = R[4], R5 = R[5], R6 = R[6], R7 = R[7], R8 = R[8];
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const lx = R0 * px + R1 * py + R2 * pz;
    const ly = R3 * px + R4 * py + R5 * pz;
    const lz = R6 * px + R7 * py + R8 * pz;
    const ax = lx / rx, ay = ly / ry, az = lz / rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / rx, by = ay / ry, bz = az / rz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  };
}

/** Ellipsoid distance function factory (for custom primitives). */
export const sdEllipsoid = (c, r, R = M_ID) => fEllipsoid(c, r, R);

/** Rounded box centred at c, half extents h, frame R, corner radius rr. */
function fBox(c, hh, R, rr) {
  const [cx, cy, cz] = c;
  const hx = hh[0] - rr, hy = hh[1] - rr, hz = hh[2] - rr;
  const R0 = R[0], R1 = R[1], R2 = R[2], R3 = R[3], R4 = R[4], R5 = R[5], R6 = R[6], R7 = R[7], R8 = R[8];
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const qx = Math.abs(R0 * px + R1 * py + R2 * pz) - hx;
    const qy = Math.abs(R3 * px + R4 * py + R5 * pz) - hy;
    const qz = Math.abs(R6 * px + R7 * py + R8 * pz) - hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - rr;
  };
}

/** Torus in the local XZ plane of frame R: major radius ra, tube rb. */
function fTorus(c, ra, rb, R) {
  const [cx, cy, cz] = c;
  const R0 = R[0], R1 = R[1], R2 = R[2], R3 = R[3], R4 = R[4], R5 = R[5], R6 = R[6], R7 = R[7], R8 = R[8];
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const lx = R0 * px + R1 * py + R2 * pz;
    const ly = R3 * px + R4 * py + R5 * pz;
    const lz = R6 * px + R7 * py + R8 * pz;
    const q = Math.hypot(lx, lz) - ra;
    return Math.hypot(q, ly) - rb;
  };
}

function bbUnion(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
}
function bbPad(b, p) {
  return [b[0] - p, b[1] - p, b[2] - p, b[3] + p, b[4] + p, b[5] + p];
}
/** Bounds of a frame-oriented box of half extents h at c. */
function bbOriented(c, h, R) {
  const ex = Math.abs(R[0]) * h[0] + Math.abs(R[3]) * h[1] + Math.abs(R[6]) * h[2];
  const ey = Math.abs(R[1]) * h[0] + Math.abs(R[4]) * h[1] + Math.abs(R[7]) * h[2];
  const ez = Math.abs(R[2]) * h[0] + Math.abs(R[5]) * h[1] + Math.abs(R[8]) * h[2];
  return [c[0] - ex, c[1] - ey, c[2] - ez, c[0] + ex, c[1] + ey, c[2] + ez];
}

/**
 * @typedef {object} MaterialDef
 * @property {number[]} color   linear RGB 0..1
 * @property {number} [rough]   roughness
 * @property {number} [metal]   metalness
 * @property {number} [pattern] shader detail pattern id (see Miniature.js PATTERN)
 * @property {number} [soft]    colour feathering distance across borders (m)
 * @property {number} [edge]    painted edge-highlight strength (curvature)
 * @property {number} [wash]    painted recess darkening (curvature + AO)
 * @property {number} [face]    1 when the painted face texture may apply
 */

/**
 * @typedef {object} PrimOpts
 * @property {number} [mat]   material index
 * @property {number} [k]     smooth-union radius within the group (0 = hard)
 * @property {number} [g]     group (layer) index
 * @property {boolean} [sub]  subtract instead of union
 * @property {number[][]} [clip]  planes [nx,ny,nz,d]: keep n·p ≤ d
 * @property {number} [clipK] round the clipped edges with this radius
 * @property {number} [shell] hollow shell thickness (|d| − t)
 * @property {(x:number,y:number,z:number)=>number} [disp]  displacement added to d
 * @property {number} [amp]   displacement amplitude bound (for culling)
 * @property {number} [grow]  inflate the primitive by this distance
 */

export class Sculpt {
  constructor() {
    this.prims = [];
    this.mats = [];
    this.groups = 1;
  }

  /** @param {MaterialDef} def */
  material(def) {
    this.mats.push({ rough: 0.6, metal: 0, pattern: 0, soft: 0.002, edge: 0.25, wash: 0.5, face: 0, ...def });
    return this.mats.length - 1;
  }

  _push(f, bb, o) {
    const grow = o.grow ?? 0;
    const shell = o.shell ?? 0;
    const clip = o.clip ?? null;
    const disp = o.disp ?? null;
    let fn = f;
    if (grow) { const f0 = fn; fn = (x, y, z) => f0(x, y, z) - grow; }
    if (shell) { const f1 = fn; fn = (x, y, z) => Math.abs(f1(x, y, z)) - shell; }
    if (disp) { const f2 = fn; fn = (x, y, z) => f2(x, y, z) + disp(x, y, z); }
    if (clip) {
      const f3 = fn;
      const ck = o.clipK ?? 0;
      const planes = clip.map((p) => {
        const l = Math.hypot(p[0], p[1], p[2]) || 1;
        return [p[0] / l, p[1] / l, p[2] / l, p[3] / l];
      });
      fn = ck > 0
        ? (x, y, z) => {
          let d = f3(x, y, z);
          for (let i = 0; i < planes.length; i++) {
            const p = planes[i];
            d = smax(d, p[0] * x + p[1] * y + p[2] * z - p[3], ck);
          }
          return d;
        }
        : (x, y, z) => {
          let d = f3(x, y, z);
          for (let i = 0; i < planes.length; i++) {
            const p = planes[i];
            const e = p[0] * x + p[1] * y + p[2] * z - p[3];
            if (e > d) d = e;
          }
          return d;
        };
    }
    const k = o.k ?? 0;
    const g = o.g ?? 0;
    if (g + 1 > this.groups) this.groups = g + 1;
    const pad = grow + shell + (o.amp ?? 0) + k + 0.002;
    this.prims.push({ f: fn, bb: bbPad(bb, pad), mat: o.mat ?? 0, k, g, sub: !!o.sub });
    return this.prims.length - 1;
  }

  /** Tapered limb between a and b. */
  cone(a, b, ra, rb, o = {}) {
    if (vlen(vsub(b, a)) < 1e-5) return this.ellipsoid(a, [ra, ra, ra], M_ID, o);
    const bb = bbUnion(bbPad([a[0], a[1], a[2], a[0], a[1], a[2]], ra), bbPad([b[0], b[1], b[2], b[0], b[1], b[2]], rb));
    return this._push(fRoundCone(a, b, ra, rb), bb, o);
  }

  ellipsoid(c, r, R = M_ID, o = {}) {
    return this._push(fEllipsoid(c, r, R), bbOriented(c, r, R), o);
  }

  sphere(c, r, o = {}) {
    return this.ellipsoid(c, [r, r, r], M_ID, o);
  }

  box(c, hh, R = M_ID, rr = 0.004, o = {}) {
    return this._push(fBox(c, hh, R, Math.min(rr, hh[0], hh[1], hh[2])), bbOriented(c, hh, R), o);
  }

  torus(c, ra, rb, R = M_ID, o = {}) {
    return this._push(fTorus(c, ra, rb, R), bbOriented(c, [ra + rb, rb, ra + rb], R), o);
  }

  /** A custom primitive: f(x,y,z) → distance, with a conservative bound box. */
  custom(f, bb, o = {}) {
    return this._push(f, bb, o);
  }

  /** Bounds of all union primitives. */
  bounds() {
    let b = null;
    for (const p of this.prims) if (!p.sub) b = b ? bbUnion(b, p.bb) : p.bb.slice();
    return b ?? [0, 0, 0, 0, 0, 0];
  }
}

// ------------------------------------------------------------------ evaluation

/** Scratch state for one evaluation (materials of the two nearest layers). */
const EV = { d: 0, m1: -1, d1: BIG, m2: -1, d2: BIG };
let ACC = new Float64Array(16);

function evalList(prims, list, n, x, y, z, groups, wantMat) {
  if (ACC.length < groups) ACC = new Float64Array(groups * 2);
  const acc = ACC;
  for (let i = 0; i < groups; i++) acc[i] = BIG;
  let m1 = -1, d1 = BIG, m2 = -1, d2 = BIG;
  for (let i = 0; i < n; i++) {
    const p = prims[list[i]];
    const d = p.f(x, y, z);
    const g = p.g;
    if (p.sub) {
      acc[g] = p.k > 0 ? smax(acc[g], -d, p.k) : Math.max(acc[g], -d);
      continue;
    }
    acc[g] = p.k > 0 && acc[g] < BIG ? smin(acc[g], d, p.k) : Math.min(acc[g], d);
    if (wantMat) {
      if (d < d1) {
        if (p.mat !== m1) { m2 = m1; d2 = d1; }
        m1 = p.mat; d1 = d;
      } else if (d < d2 && p.mat !== m1) { m2 = p.mat; d2 = d; }
    }
  }
  let r = BIG;
  for (let i = 0; i < groups; i++) if (acc[i] < r) r = acc[i];
  if (wantMat) { EV.m1 = m1; EV.d1 = d1; EV.m2 = m2; EV.d2 = d2; }
  return r;
}

// Reusable big buffers (one figure is meshed at a time).
let GRID = new Float32Array(0);
let VIDX = new Int32Array(0);
let POS = new Float32Array(0);
let NRM = new Float32Array(0);
let IDX = new Uint32Array(0);

/**
 * Mesh a sculpt.
 * @param {Sculpt} sc
 * @param {{cell?: number, bounds?: number[], ao?: number}} [opt]
 *   bounds: optional [minx,miny,minz,maxx,maxy,maxz] crop (e.g. a portrait bust)
 * @returns {{position: Float32Array, normal: Float32Array, color: Float32Array, mat: Float32Array, index: Uint32Array, matId: Uint8Array, count: number}}
 *   mat = per-vertex [pattern, roughness, metalness, ao]
 */
export function meshSculpt(sc, opt = {}) {
  const cell = opt.cell ?? 0.008;
  const prims = sc.prims;
  const groups = sc.groups;
  let b = bbPad(sc.bounds(), cell * 2);
  if (opt.bounds) {
    const c = opt.bounds;
    b = [Math.max(b[0], c[0]), Math.max(b[1], c[1]), Math.max(b[2], c[2]), Math.min(b[3], c[3]), Math.min(b[4], c[4]), Math.min(b[5], c[5])];
  }
  const ox = b[0], oy = b[1], oz = b[2];
  const nx = Math.max(2, Math.ceil((b[3] - b[0]) / cell) + 1);
  const ny = Math.max(2, Math.ceil((b[4] - b[1]) / cell) + 1);
  const nz = Math.max(2, Math.ceil((b[5] - b[2]) / cell) + 1);
  const nxy = nx * ny;
  const total = nxy * nz;
  if (GRID.length < total) GRID = new Float32Array(Math.ceil(total * 1.1));
  const grid = GRID;

  // ---- sparse sampling in blocks, with per-block primitive lists pruned by
  // distance at the block centre (a primitive farther than the nearest one
  // plus the block size and its blend radius cannot shape the block).
  const B = 4;
  const bnx = Math.ceil(nx / B), bny = Math.ceil(ny / B), bnz = Math.ceil(nz / B);
  const blockLists = new Array(bnx * bny * bnz);
  const halfDiag = (B * cell * Math.sqrt(3)) / 2;
  const tmp = new Int32Array(prims.length);
  const dcs = new Float64Array(prims.length);
  const margin = 0.014;
  for (let bz = 0; bz < bnz; bz++) {
    for (let by = 0; by < bny; by++) {
      for (let bx = 0; bx < bnx; bx++) {
        const x0 = bx * B, y0 = by * B, z0 = bz * B;
        const x1 = Math.min(nx, x0 + B), y1 = Math.min(ny, y0 + B), z1 = Math.min(nz, z0 + B);
        const wx0 = ox + x0 * cell, wy0 = oy + y0 * cell, wz0 = oz + z0 * cell;
        const wx1 = ox + (x0 + B) * cell, wy1 = oy + (y0 + B) * cell, wz1 = oz + (z0 + B) * cell;
        const mx = (wx0 + wx1) / 2, my = (wy0 + wy1) / 2, mz = (wz0 + wz1) / 2;
        let n = 0;
        let U = BIG;
        for (let i = 0; i < prims.length; i++) {
          const pr = prims[i];
          const pb = pr.bb;
          if (pb[0] > wx1 || pb[3] < wx0 || pb[1] > wy1 || pb[4] < wy0 || pb[2] > wz1 || pb[5] < wz0) continue;
          const d = pr.f(mx, my, mz);
          dcs[n] = d;
          tmp[n++] = i;
          if (!pr.sub && d + halfDiag < U) U = d + halfDiag;
        }
        const bi = bx + bnx * (by + bny * bz);
        let m = 0;
        for (let j = 0; j < n; j++) {
          const pr = prims[tmp[j]];
          if (pr.sub || dcs[j] - halfDiag <= U + pr.k + margin) tmp[m++] = tmp[j];
        }
        let unions = 0;
        for (let j = 0; j < m; j++) if (!prims[tmp[j]].sub) unions++;
        if (!unions) {
          blockLists[bi] = null;
          for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) grid.fill(1, x0 + nx * y + nxy * z, x1 + nx * y + nxy * z);
          continue;
        }
        const list = tmp.slice(0, m);
        blockLists[bi] = list;
        const dc = evalList(prims, list, m, mx, my, mz, groups, false);
        if (Math.abs(dc) > halfDiag + 1.5 * cell) {
          for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) grid.fill(dc, x0 + nx * y + nxy * z, x1 + nx * y + nxy * z);
          continue;
        }
        for (let z = z0; z < z1; z++) {
          const wz = oz + z * cell;
          for (let y = y0; y < y1; y++) {
            const wy = oy + y * cell;
            let idx = x0 + nx * y + nxy * z;
            for (let x = x0; x < x1; x++, idx++) grid[idx] = evalList(prims, list, m, ox + x * cell, wy, wz, groups, false);
          }
        }
      }
    }
  }
  // Close the mesh at a crop boundary (the portrait bust) by forcing the border outside.
  if (opt.bounds) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) grid[x + nx * y + nxy * z] = Math.max(grid[x + nx * y + nxy * z], 1e-4);
    }
  }

  // ---- surface nets
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cells = cx * cy * cz;
  if (VIDX.length < cells) VIDX = new Int32Array(Math.ceil(cells * 1.1));
  const vidx = VIDX;
  let nv = 0;
  let ni = 0;
  const ensure = () => {
    if ((nv + 1) * 4 > NRM.length) { const t = new Float32Array(Math.max(40000, NRM.length * 2)); t.set(NRM); NRM = t; }
    if ((nv + 1) * 3 > POS.length) { const t = new Float32Array(Math.max(30000, POS.length * 2)); t.set(POS); POS = t; }
    if (ni + 18 > IDX.length) { const t = new Uint32Array(Math.max(60000, IDX.length * 2)); t.set(IDX); IDX = t; }
  };
  const corner = new Float64Array(8);
  const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
  const EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const COX = [0, 1, 0, 1, 0, 1, 0, 1], COY = [0, 0, 1, 1, 0, 0, 1, 1], COZ = [0, 0, 0, 0, 1, 1, 1, 1];
  const quadF = (flip, a, b1, c1, d1) => {
    if (a < 0 || b1 < 0 || c1 < 0 || d1 < 0) return;
    const P2 = POS;
    const dA = (P2[a * 3] - P2[c1 * 3]) ** 2 + (P2[a * 3 + 1] - P2[c1 * 3 + 1]) ** 2 + (P2[a * 3 + 2] - P2[c1 * 3 + 2]) ** 2;
    const dB = (P2[b1 * 3] - P2[d1 * 3]) ** 2 + (P2[b1 * 3 + 1] - P2[d1 * 3 + 1]) ** 2 + (P2[b1 * 3 + 2] - P2[d1 * 3 + 2]) ** 2;
    const I = IDX;
    if (flip) {
      if (dA < dB) { I[ni++] = a; I[ni++] = b1; I[ni++] = c1; I[ni++] = a; I[ni++] = c1; I[ni++] = d1; }
      else { I[ni++] = a; I[ni++] = b1; I[ni++] = d1; I[ni++] = b1; I[ni++] = c1; I[ni++] = d1; }
    } else if (dA < dB) { I[ni++] = a; I[ni++] = c1; I[ni++] = b1; I[ni++] = a; I[ni++] = d1; I[ni++] = c1; }
    else { I[ni++] = a; I[ni++] = d1; I[ni++] = b1; I[ni++] = b1; I[ni++] = d1; I[ni++] = c1; }
  };
  const cxy = cx * cy;
  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      let ci = cx * (y + cy * z);
      let g0 = nx * y + nxy * z;
      for (let x = 0; x < cx; x++, ci++, g0++) {
        const c0 = grid[g0], c1 = grid[g0 + 1], c2 = grid[g0 + nx], c3 = grid[g0 + nx + 1];
        const c4 = grid[g0 + nxy], c5 = grid[g0 + nxy + 1], c6 = grid[g0 + nxy + nx], c7 = grid[g0 + nxy + nx + 1];
        const mask = (c0 < 0 ? 1 : 0) | (c1 < 0 ? 2 : 0) | (c2 < 0 ? 4 : 0) | (c3 < 0 ? 8 : 0) | (c4 < 0 ? 16 : 0) | (c5 < 0 ? 32 : 0) | (c6 < 0 ? 64 : 0) | (c7 < 0 ? 128 : 0);
        if (mask === 0 || mask === 255) { vidx[ci] = -1; continue; }
        corner[0] = c0; corner[1] = c1; corner[2] = c2; corner[3] = c3; corner[4] = c4; corner[5] = c5; corner[6] = c6; corner[7] = c7;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = EA[e], bb2 = EB[e];
          const da = corner[a], db = corner[bb2];
          if ((da < 0) === (db < 0)) continue;
          const t = da / (da - db);
          sx += COX[a] + (COX[bb2] - COX[a]) * t;
          sy += COY[a] + (COY[bb2] - COY[a]) * t;
          sz += COZ[a] + (COZ[bb2] - COZ[a]) * t;
          cnt++;
        }
        ensure();
        // Gradient (normal) and Laplacian (curvature) from the grid: central
        // differences at the 8 cell corners, trilinearly weighted.
        {
          const fx = sx / cnt, fy = sy / cnt, fz = sz / cnt;
          let gx = 0, gy = 0, gz = 0, lp = 0;
          for (let k = 0; k < 8; k++) {
            const X = x + COX[k], Y = y + COY[k], Z = z + COZ[k];
            const w = (COX[k] ? fx : 1 - fx) * (COY[k] ? fy : 1 - fy) * (COZ[k] ? fz : 1 - fz);
            const gi = X + nx * Y + nxy * Z;
            const v0 = grid[gi];
            const xm = X > 0 ? grid[gi - 1] : v0, xp = X < nx - 1 ? grid[gi + 1] : v0;
            const ym = Y > 0 ? grid[gi - nx] : v0, yp = Y < ny - 1 ? grid[gi + nx] : v0;
            const zm = Z > 0 ? grid[gi - nxy] : v0, zp = Z < nz - 1 ? grid[gi + nxy] : v0;
            gx += (xp - xm) * w; gy += (yp - ym) * w; gz += (zp - zm) * w;
            lp += (xp + xm + yp + ym + zp + zm - 6 * v0) * w;
          }
          const gl = Math.hypot(gx, gy, gz) || 1;
          NRM[nv * 4] = gx / gl; NRM[nv * 4 + 1] = gy / gl; NRM[nv * 4 + 2] = gz / gl; NRM[nv * 4 + 3] = lp / (cell * cell);
        }
        POS[nv * 3] = ox + (x + sx / cnt) * cell;
        POS[nv * 3 + 1] = oy + (y + sy / cnt) * cell;
        POS[nv * 3 + 2] = oz + (z + sz / cnt) * cell;
        vidx[ci] = nv++;
        const in0 = c0 < 0;
        if (y > 0 && z > 0 && in0 !== (c1 < 0)) quadF(in0, vidx[ci], vidx[ci - cx], vidx[ci - cx - cxy], vidx[ci - cxy]);
        if (x > 0 && z > 0 && in0 !== (c2 < 0)) quadF(in0, vidx[ci], vidx[ci - cxy], vidx[ci - 1 - cxy], vidx[ci - 1]);
        if (x > 0 && y > 0 && in0 !== (c4 < 0)) quadF(in0, vidx[ci], vidx[ci - 1], vidx[ci - 1 - cx], vidx[ci - cx]);
      }
    }
  }

  // ---- per-vertex bake: gradient normal, curvature, material, AO
  const count = nv;
  const P = POS.slice(0, count * 3);
  const N = new Float32Array(count * 3);
  const C = new Float32Array(count * 3);
  const MA = new Float32Array(count * 4);
  const MID = new Uint8Array(count);
  const mats = sc.mats;
  const ic = 1 / (cell * B);
  const listAt = (x, y, z) => {
    const gx = Math.floor((x - ox) * ic), gy = Math.floor((y - oy) * ic), gz = Math.floor((z - oz) * ic);
    if (gx < 0 || gy < 0 || gz < 0 || gx >= bnx || gy >= bny || gz >= bnz) return null;
    return blockLists[gx + bnx * (gy + bny * gz)];
  };
  const sdf = (x, y, z) => {
    const l = listAt(x, y, z);
    return l ? evalList(prims, l, l.length, x, y, z, groups, false) : 1;
  };
  const aoStep = opt.ao ?? 0.014;
  for (let i = 0; i < count; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const l = listAt(x, y, z);
    if (l) evalList(prims, l, l.length, x, y, z, groups, true);
    const m1 = l ? EV.m1 : 0, d1 = EV.d1, m2 = l ? EV.m2 : -1, d2 = EV.d2;
    const gx = NRM[i * 4], gy = NRM[i * 4 + 1], gz = NRM[i * 4 + 2];
    N[i * 3] = gx; N[i * 3 + 1] = gy; N[i * 3 + 2] = gz;
    const lap = NRM[i * 4 + 3] * 2; // mean curvature ×2 (convex > 0)
    // AO along the normal.
    let occ = 0;
    let wgt = 1;
    for (let s2 = 1; s2 <= 3; s2++) {
      const hh = aoStep * s2 * 1.3;
      const ds = sdf(x + gx * hh, y + gy * hh, z + gz * hh);
      occ += Math.max(0, hh - ds) * wgt;
      wgt *= 0.55;
    }
    const ao = Math.max(0.12, Math.min(1, 1 - (occ / aoStep) * 0.6));
    // Material and feathered colour.
    const A = mats[Math.max(0, m1)];
    let r = A.color[0], g = A.color[1], bl = A.color[2];
    let rough = A.rough, metal = A.metal;
    if (m2 >= 0) {
      const Bm = mats[m2];
      const soft = Math.max(A.soft, Bm.soft);
      const w = 0.5 * Math.max(0, 1 - (d2 - d1) / soft);
      if (w > 0) {
        r += (Bm.color[0] - r) * w; g += (Bm.color[1] - g) * w; bl += (Bm.color[2] - bl) * w;
        rough += (Bm.rough - rough) * w; metal += (Bm.metal - metal) * w;
      }
    }
    // Painted-miniature treatment: highlight convex edges, wash recesses.
    const curv = Math.max(-1, Math.min(1, lap * 0.006));
    const shade = (1 + Math.max(0, curv) * A.edge * 1.5) * (1 - Math.max(0, -curv) * A.wash * 0.55) * (1 - (1 - ao) * A.wash * 0.6);
    C[i * 3] = Math.min(1, r * shade); C[i * 3 + 1] = Math.min(1, g * shade); C[i * 3 + 2] = Math.min(1, bl * shade);
    MA[i * 4] = A.pattern; MA[i * 4 + 1] = rough; MA[i * 4 + 2] = metal; MA[i * 4 + 3] = ao;
    MID[i] = Math.max(0, m1);
  }
  return { position: P, normal: N, color: C, mat: MA, index: IDX.slice(0, ni), matId: MID, count };
}
