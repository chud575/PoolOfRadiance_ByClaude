import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Non-indexed copy (no-op if already non-indexed). */
export const ni = (g) => (g.index ? g.toNonIndexed() : g);

/** Deterministic mulberry32 PRNG (visual placement only). */
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

/**
 * Re-project UVs in world metres (triplanar-by-normal) so tiled textures keep a
 * constant texel density on any transformed primitive.
 */
export function worldUV(geo, scale = 3) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / scale, z / scale);
    else if (ax >= az) uv.setXY(i, z / scale, y / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  geo.setAttribute('uv', uv);
  return geo;
}

/** Fill a vertex colour attribute (optionally darkened toward the bottom → cheap AO). */
export function tint(geo, color, { aoBottom = null, aoTop = null, aoStrength = 0.45 } = {}) {
  const pos = geo.attributes.position;
  const c = new THREE.Color(color);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let k = 1;
    if (aoBottom != null && aoTop != null) {
      const f = THREE.MathUtils.clamp((pos.getY(i) - aoBottom) / Math.max(0.01, aoTop - aoBottom), 0, 1);
      k = 1 - aoStrength * (1 - f) * (1 - f);
    }
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Box with its base at y=0, transformed. */
export function box(w, h, d, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

/** Gable roof prism: ridge along local X, eaves overhang `o`. */
export function gable(w, d, rise, { x = 0, y = 0, z = 0, ry = 0, o = 0.35 } = {}) {
  const hw = d / 2 + o;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w + o * 2, bevelEnabled: false });
  g.translate(0, 0, -(w + o * 2) / 2);
  g.rotateY(Math.PI / 2);
  g.rotateY(ry);
  g.translate(x, y, z);
  return ni(g);
}

/** Hip/pyramid roof (4-sided cone). */
export function pyramid(w, rise, { x = 0, y = 0, z = 0, ry = 0 } = {}) {
  const g = new THREE.ConeGeometry(w * 0.72, rise, 4, 1, true);
  g.rotateY(Math.PI / 4 + ry);
  g.translate(x, y + rise / 2, z);
  return ni(g);
}

export function cylinder(rt, rb, h, seg, { x = 0, y = 0, z = 0, open = false } = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  g.translate(x, y + h / 2, z);
  return ni(g);
}

export function cone(r, h, seg, { x = 0, y = 0, z = 0 } = {}) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, true);
  g.translate(x, y + h / 2, z);
  return ni(g);
}

/** Merge a list of geometries (normalising index/attributes). */
export function merge(list) {
  const norm = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  const out = mergeGeometries(norm, false);
  for (const g of list) g.dispose();
  // degenerate faces (collapsed slivers, coincident extrude points) leave zero
  // normals; normalize(vec3(0)) is NaN in GLSL and one NaN pixel spreads across
  // the whole frame through the bloom blur, so patch them to face up
  const n = out.attributes.normal;
  if (n) {
    const a = n.array;
    for (let i = 0; i < a.length; i += 3) {
      const l = a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2];
      if (!(l > 1e-10)) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; }
    }
  }
  return out;
}
