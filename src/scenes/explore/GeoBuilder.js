import * as THREE from 'three';
import { materialTexScale } from '../../render/materials.js';

/**
 * Accumulates procedural geometry into one BufferGeometry per material key
 * (so a whole city block renders in a handful of draw calls).
 *
 * Every vertex gets: position, normal, uv, color (AO × tint).
 * UV modes:
 *   'world' – planar projection on the dominant axis of the face normal, in
 *             metres / material texScale (seamless across pieces)
 *   'along' – for beams/boards: v runs along the longest box axis, in metres / texScale
 *   'local' – 0..1 per face (doors, crates)
 */
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class GeoBuilder {
  constructor() {
    /** @type {Map<string, {pos:number[], nrm:number[], uv:number[], col:number[]}>} */
    this.buckets = new Map();
    /** Default AO function (world pos, world normal) → 0..1. */
    this.aoFn = defaultAO;
  }

  bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { pos: [], nrm: [], uv: [], col: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Push one triangle (world space) with a flat normal.
   * @param {string} key @param {THREE.Vector3[]} p 3 points (CCW seen from outside)
   * @param {number[][]|null} uvs 3 uv pairs or null for world projection
   */
  tri(key, p, uvs, opts = {}) {
    const b = this.bucket(key);
    _n.subVectors(p[1], p[0]).cross(_v.subVectors(p[2], p[0])).normalize();
    const ts = materialTexScale(key) || 1;
    const tint = opts.tint ?? WHITE;
    const ao = opts.ao;
    for (let i = 0; i < 3; i++) {
      const q = p[i];
      b.pos.push(q.x, q.y, q.z);
      b.nrm.push(_n.x, _n.y, _n.z);
      if (uvs) b.uv.push(uvs[i][0], uvs[i][1]);
      else {
        const [u, v] = planarUV(q, _n, ts);
        b.uv.push(u, v);
      }
      const a = typeof ao === 'number' ? ao : typeof ao === 'function' ? ao(q, _n) : this.aoFn(q, _n);
      b.col.push(tint[0] * a, tint[1] * a, tint[2] * a);
    }
  }

  /** Quad p0..p3 (CCW from outside), split into two triangles. */
  quad(key, p0, p1, p2, p3, uvs = null, opts = {}) {
    this.tri(key, [p0, p1, p2], uvs ? [uvs[0], uvs[1], uvs[2]] : null, opts);
    this.tri(key, [p0, p2, p3], uvs ? [uvs[0], uvs[2], uvs[3]] : null, opts);
  }

  /**
   * Box (optionally chamfered) given by centre/size and an optional rotation/matrix.
   * @param {string} key
   * @param {{c:number[]|THREE.Vector3, s:number[], rotY?:number, rotZ?:number, rotX?:number, matrix?:THREE.Matrix4,
   *   chamfer?:number, uv?:'world'|'along'|'local', tint?:number[], ao?:number|Function, skip?:string[]}} o
   */
  box(key, o) {
    const [sx, sy, sz] = o.s;
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c = Math.min(o.chamfer ?? 0, hx * 0.45, hy * 0.45, hz * 0.45);
    const m = o.matrix ? o.matrix.clone() : new THREE.Matrix4();
    if (!o.matrix) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0, 'YXZ'));
      const cc = Array.isArray(o.c) ? new THREE.Vector3(...o.c) : o.c;
      m.compose(cc, q, new THREE.Vector3(1, 1, 1));
    }
    const faces = boxFaces(hx, hy, hz, c, o.skip);
    const mode = o.uv ?? 'world';
    const ts = materialTexScale(key) || 1;
    const long = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    for (const f of faces) {
      const wp = f.v.map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m));
      let uvs = null;
      if (mode === 'along' || mode === 'local') {
        uvs = f.v.map((p) => localUV(p, f.n, long, [hx, hy, hz], mode, ts));
      }
      if (f.v.length === 3) this.tri(key, wp, uvs, o);
      else this.quad(key, wp[0], wp[1], wp[2], wp[3], uvs, o);
    }
  }

  /**
   * Add an existing BufferGeometry (indexed or not) transformed by matrix.
   * Its own UVs are kept (scaled by uvScale) unless uv:'world'.
   */
  geometry(key, geo, matrix, opts = {}) {
    const b = this.bucket(key);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const U = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    const ts = materialTexScale(key) || 1;
    const tint = opts.tint ?? WHITE;
    const us = opts.uvScale ?? [1, 1];
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(N, i).applyMatrix3(_m3).normalize();
      b.pos.push(_v.x, _v.y, _v.z);
      b.nrm.push(_n.x, _n.y, _n.z);
      if (opts.uv === 'world' || !U) {
        const [u, v] = planarUV(_v, _n, ts);
        b.uv.push(u, v);
      } else b.uv.push(U.getX(i) * us[0], U.getY(i) * us[1]);
      const a = typeof opts.ao === 'number' ? opts.ao : typeof opts.ao === 'function' ? opts.ao(_v, _n) : this.aoFn(_v, _n);
      b.col.push(tint[0] * a, tint[1] * a, tint[2] * a);
    }
    if (g !== geo) g.dispose();
  }

  /** @returns {Map<string, THREE.BufferGeometry>} */
  build() {
    const out = new Map();
    for (const [key, b] of this.buckets) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(key, g);
    }
    return out;
  }
}

const WHITE = [1, 1, 1];

/** Contact darkening near the ground plane and under overhangs. */
export function defaultAO(p, n) {
  const g = THREE.MathUtils.smoothstep(p.y, 0, 0.9);
  let a = 0.62 + 0.38 * g;
  if (n.y < -0.5) a *= 0.7; // undersides
  return a;
}

export function planarUV(p, n, ts) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return [p.x / ts, (n.y > 0 ? -p.z : p.z) / ts];
  if (ax >= az) return [(n.x > 0 ? -p.z : p.z) / ts, p.y / ts];
  return [(n.z > 0 ? p.x : -p.x) / ts, p.y / ts];
}

function localUV(p, n, long, h, mode, ts) {
  // pick the face's dominant local axis
  const an = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const fa = an[0] >= an[1] && an[0] >= an[2] ? 0 : an[1] >= an[2] ? 1 : 2;
  const others = [0, 1, 2].filter((i) => i !== fa);
  if (mode === 'local') {
    const a = others[0];
    const b = others[1];
    let u = (p[a] + h[a]) / (2 * h[a]);
    let v = (p[b] + h[b]) / (2 * h[b]);
    if (b !== 1 && a === 1) [u, v] = [v, u];
    return [u, v];
  }
  // along: v along the long axis (metres), u along the remaining axis
  if (fa === long) return [(p[others[0]] + h[others[0]]) / ts, (p[others[1]] + h[others[1]]) / ts];
  const across = others.find((i) => i !== long);
  return [(p[across] + h[across]) / ts, (p[long] + h[long]) / ts];
}

/**
 * Faces of an axis-aligned box centred at the origin, optionally chamfered.
 * Returns [{v:[[x,y,z]...3|4], n:[nx,ny,nz]}] oriented outward.
 * skip: list of face ids to omit ('px','nx','py','ny','pz','nz').
 */
function boxFaces(hx, hy, hz, c, skip) {
  const faces = [];
  const push = (verts) => {
    // orient outward
    const a = verts[0];
    const b = verts[1];
    const d = verts[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let cx = 0, cy = 0, cz = 0;
    for (const p of verts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    if (nx * cx + ny * cy + nz * cz < 0) {
      verts.reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    faces.push({ v: verts, n: [nx / l, ny / l, nz / l] });
  };
  const sk = new Set(skip ?? []);
  if (c <= 0) {
    const P = (sx, sy, sz) => [sx * hx, sy * hy, sz * hz];
    if (!sk.has('px')) push([P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)]);
    if (!sk.has('nx')) push([P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1)]);
    if (!sk.has('py')) push([P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)]);
    if (!sk.has('ny')) push([P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]);
    if (!sk.has('pz')) push([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]);
    if (!sk.has('nz')) push([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)]);
    return faces;
  }
  const h = [hx, hy, hz];
  // corner point on axis `ax` for signs s
  const Q = (s, ax) => {
    const p = [0, 0, 0];
    for (let i = 0; i < 3; i++) p[i] = s[i] * (i === ax ? h[i] : h[i] - c);
    return p;
  };
  const names = [['nx', 'px'], ['ny', 'py'], ['nz', 'pz']];
  // main faces
  for (let ax = 0; ax < 3; ax++) {
    for (const sa of [-1, 1]) {
      if (sk.has(names[ax][sa > 0 ? 1 : 0])) continue;
      const [a, b] = [0, 1, 2].filter((i) => i !== ax);
      const pts = [];
      for (const [sb, sc] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const s = [0, 0, 0];
        s[ax] = sa;
        s[a] = sb;
        s[b] = sc;
        pts.push(Q(s, ax));
      }
      push(pts);
    }
  }
  // edge chamfers
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const o = 3 - a - b;
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const s1 = [0, 0, 0];
        const s2 = [0, 0, 0];
        s1[a] = s2[a] = sa;
        s1[b] = s2[b] = sb;
        s1[o] = -1;
        s2[o] = 1;
        push([Q(s1, a), Q(s2, a), Q(s2, b), Q(s1, b)]);
      }
    }
  }
  // corner triangles
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const s = [sx, sy, sz];
    push([Q(s, 0), Q(s, 1), Q(s, 2)]);
  }
  return faces;
}

/** Deterministic hash → [0,1) for integers/strings. */
export function hash(...args) {
  let h = 2166136261;
  for (const a of args) {
    const s = typeof a === 'number' ? String(Math.round(a * 1000)) : String(a);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e37;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
