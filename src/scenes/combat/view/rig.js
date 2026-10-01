import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Rigid-skinned procedural rig builder. Parts (primitive geometry) are attached
 * to named bones in the bone's local space; build() merges all parts sharing a
 * material into ONE SkinnedMesh bound to a shared skeleton, so a fully kitted
 * figure costs only ~4-7 draw calls while every limb animates independently.
 */
export class RigBuilder {
  constructor() {
    this.root = new THREE.Group();
    this.bones = {};
    this.boneList = [];
    /** @type {Map<THREE.Material, {geo: THREE.BufferGeometry, bone: number}[]>} */
    this.buckets = new Map();
    this.attachments = [];
    /** Pre-skinned meshes (sculpted flesh): {geo, mat, names} */
    this.skinned = [];
  }

  /**
   * Add a pre-skinned geometry in figure (bind-pose) space; its skinIndex
   * attribute indexes \`names\` (bone names), remapped to the skeleton at build().
   */
  skin(geo, mat, names) {
    this.skinned.push({ geo, mat, names });
    return this;
  }

  /** Create a bone under `parent` (name or null for root) at local offset. */
  bone(name, parent, x = 0, y = 0, z = 0) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    b.userData.rest = new THREE.Vector3(x, y, z);
    if (parent) this.bones[parent].add(b);
    else this.root.add(b);
    this.bones[name] = b;
    this.boneList.push(b);
    return b;
  }

  /**
   * Attach geometry to a bone. `m` positions it in bone space.
   * @param {string} boneName
   * @param {THREE.BufferGeometry} geo  (consumed)
   * @param {THREE.Material} mat
   * @param {{p?:number[], r?:number[], s?:number[]|number}} [m]
   */
  part(boneName, geo, mat, m = {}) {
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(m.r ?? [0, 0, 0])));
    const s = typeof m.s === 'number' ? [m.s, m.s, m.s] : m.s ?? [1, 1, 1];
    mtx.compose(new THREE.Vector3(...(m.p ?? [0, 0, 0])), q, new THREE.Vector3(...s));
    let g = geo.index ? geo : geo;
    g.applyMatrix4(mtx);
    if (!g.index) g = indexify(g);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push({ geo: g, bone: boneName });
    return this;
  }

  /** Non-skinned object parented to a bone (lights, sprites, cloth planes). */
  attach(boneName, obj) {
    this.bones[boneName].add(obj);
    this.attachments.push(obj);
    return obj;
  }

  build({ castShadow = true } = {}) {
    this.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.boneList);
    const index = new Map(this.boneList.map((b, i) => [b.name, i]));
    const meshes = [];
    for (const [mat, parts] of this.buckets) {
      const geos = parts.map(({ geo, bone }) => {
        const b = this.bones[bone];
        const g = geo.clone();
        g.applyMatrix4(b.matrixWorld);
        const n = g.attributes.position.count;
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        const bi = index.get(bone);
        for (let i = 0; i < n; i++) {
          si[i * 4] = bi;
          sw[i * 4] = 1;
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        geo.dispose();
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      const mesh = new THREE.SkinnedMesh(merged, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      mesh.bind(skeleton);
      meshes.push(mesh);
    }
    for (const { geo, mat, names } of this.skinned) {
      let g = geo;
      // The shared (cached) geometry indexes bones by name order; remap only if this rig differs.
      if (names.some((nm, i) => index.get(nm) !== i)) {
        g = geo.clone();
        const si = g.attributes.skinIndex;
        for (let i = 0; i < si.count * 4; i++) si.array[i] = index.get(names[si.array[i]]) ?? 0;
        si.needsUpdate = true;
      }
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeometry = g === geo;
      this.root.add(mesh);
      mesh.bind(skeleton);
      meshes.push(mesh);
    }
    return { root: this.root, bones: this.bones, skeleton, meshes };
  }
}

function indexify(g) {
  const n = g.attributes.position.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ------------------------------------------------------------------ shapes
/**
 * Organic limb/torso segment: a lathe from y=0 down to y=-len with radii r0
 * (top), r1 (bottom) and a mid bulge; rounded caps. zs flattens the section.
 */
export function limb(r0, r1, len, { bulge = 1.08, seg = 12, caps = true, zs = 1 } = {}) {
  const pts = [];
  const rm = ((r0 + r1) / 2) * bulge;
  if (caps) {
    pts.push(new THREE.Vector2(0.0001, -len - r1 * 0.95));
    pts.push(new THREE.Vector2(r1 * 0.6, -len - r1 * 0.75));
  }
  pts.push(new THREE.Vector2(r1, -len));
  pts.push(new THREE.Vector2(rm, -len * 0.45));
  pts.push(new THREE.Vector2(r0 * 1.0, -len * 0.08));
  if (caps) {
    pts.push(new THREE.Vector2(r0 * 0.75, r0 * 0.6));
    pts.push(new THREE.Vector2(0.0001, r0 * 0.95));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  if (zs !== 1) g.scale(1, 1, zs);
  return g;
}

/** Lathe from an explicit profile [[r, y], ...] listed bottom→top. */
export function lathe(profile, seg = 16, { xs = 1, zs = 1 } = {}) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg);
  g.scale(xs, 1, zs);
  return g;
}

export const sphere = (r, ws = 16, hs = 12, o = {}) => new THREE.SphereGeometry(r, ws, hs, o.phiStart ?? 0, o.phiLength ?? Math.PI * 2, o.thetaStart ?? 0, o.thetaLength ?? Math.PI);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
export const torus = (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);

/** Rounded box (bevelled via extrude). */
export function rbox(w, h, d, r = 0.02) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.9, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}

/** Flat extruded 2D outline (blades, axe heads). pts: [[x,y],...] */
export function blade(pts, depth = 0.01, bevel = 0.004) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}
