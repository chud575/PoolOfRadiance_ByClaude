import * as THREE from 'three';
import { ashlarTextures } from './campTextures.js';

/**
 * Masonry for the camp's ruins: every block its own chipped stone. Blocks are merged into one
 * faceted mesh per call — arrises and corners knocked in (harder on the broken top courses), the
 * faces a little proud, world-scaled UVs offset per block so no two read alike — with vertex colour
 * carrying each block's tone, damp at the foot of the wall, moss on the upward faces and soot
 * streaks where the city burned. Mortar beds sit just behind each block, so the joints read as
 * pointing, not as gaps into the dark.
 */

const hr = (i, s = 0) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const h3 = (x, y, z, s) => hr(Math.round(x * 97) * 31 + Math.round(y * 89) * 17 + Math.round(z * 83) * 7, s);

let base = null;
function unitBox() {
  if (!base) base = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  return base;
}

/**
 * @typedef {{p:number[], s:number[], r?:number[], col?:number[], dmg?:number, moss?:number, soot?:number, mortar?:boolean, frame?:THREE.Matrix4}} Block
 * @param {Block[]} blocks
 * @returns {THREE.BufferGeometry}
 */
export function masonryGeometry(blocks) {
  const src = unitBox();
  const sp = src.attributes.position, sn = src.attributes.normal, si = src.index;
  const triCount = si.count / 3;
  const N = blocks.length * triCount * 3;
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), col = new Float32Array(N * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), wn = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let o = 0;
  blocks.forEach((b, bi) => {
    const [sx, sy, sz] = b.s;
    q.setFromEuler(e.set(...(b.r ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(1, 1, 1));
    if (b.frame) m.premultiply(b.frame);
    nm.getNormalMatrix(m);
    const dmg = b.dmg ?? 0;
    const seed = bi * 13 + 7;
    const uo = hr(seed, 1) * 7, vo = hr(seed, 2) * 7;
    const tone = b.col ?? [0.8, 0.78, 0.74];
    for (let t = 0; t < si.count; t++) {
      const k = si.getX(t);
      const lx = sp.getX(k), ly = sp.getY(k), lz = sp.getZ(k);
      const fx = sn.getX(k), fy = sn.getY(k), fz = sn.getZ(k);
      // chip: corners and arrises knocked in toward the block's centre; face centres a touch proud
      const ex = Math.abs(lx) > 0.49 ? 1 : 0, ey = Math.abs(ly) > 0.49 ? 1 : 0, ez = Math.abs(lz) > 0.49 ? 1 : 0;
      const edgeN = ex + ey + ez;
      let px = lx * sx, py = ly * sy, pz = lz * sz;
      if (!b.mortar) {
        const r = h3(lx, ly, lz, seed);
        const amt = edgeN === 3 ? 0.012 + r * (0.03 + dmg * 0.09) : edgeN === 2 ? r * (0.008 + dmg * 0.05) : -0.006 - r * 0.008;
        const len = Math.hypot(px, py, pz) || 1;
        // the top of a broken course loses more from its upper arrises
        const topK = ly > 0.4 ? 1 + dmg * 1.4 : 1;
        px -= (px / len) * amt * topK; py -= (py / len) * amt * topK; pz -= (pz / len) * amt * topK;
      }
      v.set(px, py, pz).applyMatrix4(m);
      pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      // world-scaled planar UVs on each face
      let u, w;
      if (Math.abs(fx) > 0.5) { u = lz * sz; w = ly * sy; } else if (Math.abs(fy) > 0.5) { u = lx * sx; w = lz * sz; } else { u = lx * sx; w = ly * sy; }
      uv[o * 2] = u + uo; uv[o * 2 + 1] = w + vo;
      // colour: tone, damp at the foot, moss on upward faces, soot streaks
      wn.set(fx, fy, fz).applyMatrix3(nm).normalize();
      let cr = tone[0], cg = tone[1], cb = tone[2];
      if (b.mortar) { cr = 0.62; cg = 0.6; cb = 0.55; }
      const damp = Math.max(0, 1 - v.y / 0.7) * 0.3;
      cr *= 1 - damp; cg *= 1 - damp * 0.8; cb *= 1 - damp * 0.9;
      const moss = (b.moss ?? 0.5) * Math.max(0, wn.y - 0.55) * 2.2 * (0.4 + 0.6 * hr(Math.round(v.x * 7) + Math.round(v.z * 7) * 31, 5));
      cr = cr * (1 - moss * 0.6) + moss * 0.16; cg = cg * (1 - moss * 0.45) + moss * 0.24; cb = cb * (1 - moss * 0.7) + moss * 0.07;
      if (b.soot) {
        const streak = 0.55 + 0.45 * Math.sin(v.x * 11 + Math.sin(v.x * 3.1) * 2) * Math.sin(v.z * 9 + 1.3);
        const sk = b.soot * Math.min(1, Math.max(0, v.y - 0.3) / 1.6) * streak;
        cr *= 1 - sk * 0.75; cg *= 1 - sk * 0.77; cb *= 1 - sk * 0.78;
      }
      col[o * 3] = cr; col[o * 3 + 1] = cg; col[o * 3 + 2] = cb;
      o++;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

let mat = null;
/** The shared masonry material (limestone, vertex-coloured). */
export function masonryMaterial(night = 1) {
  if (mat) { mat.color.set(night ? 0xd8d4ce : 0xf0ece6); return mat; }
  const t = ashlarTextures();
  mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 1, color: night ? 0xd8d4ce : 0xf0ece6 });
  mat.userData.shared = true;
  return mat;
}

/**
 * A run of wall laid in courses along +x (local), w long, up to h high, d thick, with a broken top.
 * @returns {{blocks: Block[], prof: (x:number)=>number, courseH:number}}
 */
export function wallBlocks(w, h, d, seed, o = {}) {
  const blocks = [];
  const courseH = o.courseH ?? 0.34;
  const courses = Math.max(1, Math.ceil(h / courseH));
  const prof = o.prof ?? ((x) => {
    const u = x / w;
    const big = 0.62 + 0.38 * Math.sin(u * 2.4 + seed) * Math.sin(u * 1.3 + seed * 0.7 + 1.2);
    const edge = Math.min(1, u * 5, (1 - u) * 3.5);
    return Math.max(1, Math.round(courses * Math.max(0.3, big) * (0.6 + 0.4 * edge) + (hr(Math.floor(x * 2), seed) - 0.5) * 1.6));
  });
  const soot = o.soot ?? 0;
  for (let c = 0; c < courses; c++) {
    let x = (c % 2) * 0.28 - 0.1 * hr(c, seed);
    let i = 0;
    while (x < w) {
      const len = 0.38 + hr(c * 31 + i, seed + 1) * 0.46;
      const cx = x + len / 2;
      const top = cx > 0 && cx < w ? prof(cx) : 0;
      if (cx > 0 && cx < w && c < top) {
        const isTop = c === top - 1;
        const lost = isTop && hr(c * 7 + i, seed + 5) < 0.28;
        // a few blocks fallen out of the face below the top
        const hole = !isTop && c > 0 && hr(c * 11 + i, seed + 6) < 0.035;
        const y = c * courseH + courseH / 2;
        for (let leaf = 0; leaf < 2; leaf++) {
          const dz = (leaf - 0.5) * d * 0.5;
          if (!lost && !(hole && leaf === (c % 2))) {
            const tone = 0.66 + hr(c * 13 + i * 3 + leaf, seed + 2) * 0.34;
            const warm = (hr(c * 5 + i, seed + 8) - 0.5) * 0.08;
            blocks.push({
              p: [cx + (hr(i, c + seed) - 0.5) * 0.025, y + (hr(i + 9, c) - 0.5) * 0.015, dz + (hr(i + 4, c + leaf) - 0.5) * 0.02],
              s: [len - 0.03, courseH - 0.028, d * 0.5 - 0.03],
              r: [(hr(i, c + 3) - 0.5) * (isTop ? 0.12 : 0.02), (hr(i, c + 4) - 0.5) * (isTop ? 0.16 : 0.03), (hr(i, c + 5) - 0.5) * (isTop ? 0.1 : 0.015)],
              col: [tone * (1.02 + warm), tone, tone * (0.93 - warm)],
              dmg: isTop ? 0.6 + hr(i, c + 6) * 0.4 : hr(i, c + 7) * 0.3,
              soot, moss: o.moss ?? 0.6,
            });
          }
        }
        // the mortar bed behind the faces (fills the joints from within)
        if (!lost) blocks.push({ p: [cx, y, 0], s: [len + 0.01, courseH + (isTop ? -0.04 : 0.006), d - 0.09], mortar: true });
      }
      x += len;
      i++;
    }
  }
  return { blocks, prof, courseH };
}
