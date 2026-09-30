import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Static geometry batcher: collects transformed primitives per material and
 * merges each bucket into one mesh (a whole diorama in a few dozen draw calls).
 */
export class Batcher {
  constructor() {
    this.buckets = new Map();
  }

  /**
   * @param {THREE.BufferGeometry} geo consumed
   * @param {THREE.Material} mat
   * @param {THREE.Matrix4|{p?:number[], r?:number[], s?:number[]|number}} [m]
   * @param {{cast?:boolean, receive?:boolean, tag?:string}} [o]
   */
  add(geo, mat, m = null, o = {}) {
    let g = geo;
    if (m) g.applyMatrix4(m instanceof THREE.Matrix4 ? m : toMatrix(m));
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const key = `${mat.uuid}|${o.cast !== false}|${o.tag ?? ''}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { mat, cast: o.cast !== false, receive: o.receive !== false, tag: o.tag, geos: [] });
    this.buckets.get(key).geos.push(g);
  }

  /** Merge into meshes added to `parent`; returns {meshes, byTag}. */
  flush(parent) {
    const meshes = [];
    const byTag = {};
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      parent.add(mesh);
      meshes.push(mesh);
      if (b.tag) (byTag[b.tag] ??= []).push(mesh);
    }
    this.buckets.clear();
    return { meshes, byTag };
  }
}

export function toMatrix(m) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(m.r ?? [0, 0, 0]), 'YXZ'));
  const s = typeof m.s === 'number' ? [m.s, m.s, m.s] : m.s ?? [1, 1, 1];
  return new THREE.Matrix4().compose(new THREE.Vector3(...(m.p ?? [0, 0, 0])), q, new THREE.Vector3(...s));
}

/** A box whose UVs are in world metres / texScale on every face (no stretching). */
export function worldBox(w, h, d, texScale = 2.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2;
    const y = pos.getY(i) + h / 2;
    const z = pos.getZ(i) + d / 2;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x / texScale, z / texScale);
    else if (nx > 0.5) uv.setXY(i, z / texScale, y / texScale);
    else uv.setXY(i, x / texScale, y / texScale);
  }
  return g;
}

/** Vertical wall quad from (0,0) to (len,h) in XY facing +Z, world-scaled UVs. */
export function wallQuad(len, h, texScale = 2.5, u0 = 0) {
  const g = new THREE.PlaneGeometry(len, h);
  g.translate(len / 2, h / 2, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + u0) / texScale, pos.getY(i) / texScale);
  return g;
}
