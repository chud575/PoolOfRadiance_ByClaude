import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createFlameBatch } from '../../../render/lighting.js';
import { NOISE } from './glsl.js';
import { prng, ni, worldUV, tint, box, gable, pyramid, cylinder, cone, merge } from './geom.js';
import { column, dome, gableRoof, robedFigure, addRimLight, contactShadow, matteFigure } from './arch.js';
import { bannerTexture } from './heraldry.js';
import { buildMiniature } from '../../../ui/components/Miniature.js';

export const CITY_TEXTURES = ['hd2_ashlar', 'hd2_ruin', 'hd2_plaster', 'hd_mud', 'hd_cobble', 'hd_roof_clay', 'hd_roof_slate', 'hd_roof_shake', 'hd_beam_dark', 'hd_limestone'];

const GROUND = -14;

/**
 * Ruined Phlan at dusk, seen from the hill of the old temple: New Phlan's lit
 * streets (west), the burnt-out old city (east) with fires and smoke, the
 * city wall, Valjevo Castle on its mound, the harbour and ships on the Moonsea.
 * Everything is merged into a handful of draw calls.
 */
export function createCity({ seed = 1988 } = {}) {
  const Rmain = prng(seed);
  const Rw = prng(seed + 11); // weathering details (never shifts the layout stream)
  let R = Rmain;
  const group = new THREE.Group();
  group.name = 'city';
  const walls = []; // dressed ashlar: city wall, towers, temple, keep outworks
  const castle = []; // Valjevo Castle's ashlar (its own material: stronger sun rim, key-lit)
  const hall = []; // City Hall's fine coursed ashlar
  const plaster = []; // lime-washed house walls between the timbers
  const charred = []; // the dead quarter's smoke-blackened washes (heavier soot, flaking)
  const rubble = []; // burnt rubble-stone shells of the old city
  const ground = []; // packed mud and ash
  const cobbles = []; // the avenue and the council plaza
  const roofs = [];
  const slate = [];
  const shake = [];
  const beams = [];
  const fine = []; // dressed limestone (columns, mouldings)
  const people = [];
  const weedGeo = []; // grass tufts over the dead quarter
  const moundGeo = []; // Valjevo's motte (vertex-coloured earth, grass and rock)
  const iron = []; // wrought-iron stands and fittings
  const windows = [];
  const fires = [];
  const lamps = [];
  const braziers = []; // City Hall plaza brazier mouths: real flames, not bare glow balls
  const banners = [];
  const disposables = [];
  const figures = [];
  let buildCrowd = null;
  const cityTime = { value: 0 };

  const stoneCols = [0x8a8076, 0x7a7068, 0x958778, 0x6f675f, 0x857a6b];
  const roofCols = [0xb0705a, 0x9a6050, 0xc08a6a, 0x8f5a48];
  const slateCols = [0x6e7688, 0x5d6475, 0x7a7f8c];
  const shakeCols = [0x8a6a4a, 0x7a5c40, 0x9a7a56];

  const addWin = (m, lx, ly, lz, ry, w = 0.5, h = 0.8, warm = 1) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(ry);
    const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(m);
    g.translate(p.x, p.y, p.z);
    const c = new THREE.Color().setHSL(0.075 + R.range(-0.02, 0.03), 0.85, 0.5 + R.range(-0.1, 0.1));
    tint(g, c.multiplyScalar(warm));
    windows.push(g);
  };

  const side0 = (ry) => new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
  /** Oak window frame: lintel, sill and a pair of shutters folded back. */
  const winFrame = (m, lx, ly, lz, ry, w = 0.5, h = 0.8) => {
    const off = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    const put = (geo, list, c) => { geo.applyMatrix4(m); list.push(tint(worldUV(geo, 1.2), c)); };
    put(box(w + 0.22, 0.11, 0.14, { x: lx, y: ly + h / 2, z: lz, ry }), beams, 0x3a2a1e);
    put(box(w + 0.28, 0.08, 0.2, { x: lx + off.x * 0.04, y: ly - h / 2 - 0.08, z: lz + off.z * 0.04, ry }), beams, 0x4a3424);
    const side = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
    // jambs: the opening's reveal, standing proud so the window reads recessed
    for (const sx of [-1, 1]) put(box(0.09, h + 0.04, 0.16, { x: lx + side0(ry).x * sx * (w / 2 + 0.045), y: ly - h / 2 - 0.02, z: lz + side0(ry).z * sx * (w / 2 + 0.045), ry }), beams, 0x33251a);
    for (const sx of [-1, 1]) put(box(w * 0.48, h * 0.98, 0.04, { x: lx + side.x * sx * (w * 0.76) + off.x * 0.03, y: ly - h * 0.49, z: lz + side.z * sx * (w * 0.76) + off.z * 0.03, ry }), beams, R.chance(0.5) ? 0x3a4a3a : 0x5a3a22);
  };

  /**
   * A broken wall of rubble masonry: an irregular top edge that falls away
   * toward a breach (noise on every 0.3 m, never stepped), empty window and
   * door openings, soot darkening toward the burnt top. Local frame: runs
   * along x from -len/2..len/2, base y=0, thickness along z.
   */
  const ruinWall = (len, h, t, { breach = R.chance(0.5) ? 1 : -1, openings = true, tops: topOut = null } = {}) => {
    const sh = new THREE.Shape();
    const n = Math.max(3, Math.round(len / (topOut ? 0.55 : 0.3)));
    const hi = h * R.range(0.75, 1);
    const lo = h * R.range(0.12, 0.45);
    sh.moveTo(-len / 2, 0);
    sh.lineTo(len / 2, 0);
    const tops = [];
    for (let i = n; i >= 0; i--) {
      const f = i / n; // 1 at +x end
      const along = breach > 0 ? f : 1 - f; // 1 at the breach side
      // a high shoulder that collapses into a ragged V toward the breach
      const prof = hi - (hi - lo) * Math.pow(THREE.MathUtils.smoothstep(along, 0.3, 1), 1.4);
      let y = Math.max(0.35, prof + (R.next() - 0.5) * 0.55 * Math.min(1, prof / 2));
      if (topOut) {
        // broken along the courses: each block's top sits on a 0.32 m bed joint,
        // and the break slopes within the block (no flat stepped card silhouette)
        y = Math.max(0.32, Math.round(y / 0.32) * 0.32);
        const x0 = -len / 2 + len * f;
        sh.lineTo(x0 + (i === n ? 0 : len / n * 0.15), y + R.range(-0.08, 0.1));
        topOut.push([x0, y]);
      }
      tops.push(y);
      sh.lineTo(-len / 2 + len * f, y);
    }
    sh.closePath();
    if (openings) {
      // empty window holes in the standing part, a door at ground level
      const k = Math.floor(len / 2.2);
      for (let i = 0; i < k; i++) {
        const cx = -len / 2 + (len / k) * (i + 0.5);
        const f = (cx + len / 2) / len;
        const topHere = tops[Math.round((1 - f) * n)] ?? 0;
        const wy = R.chance(0.25) && i === 0 ? 0 : 1.2;
        const wh = wy === 0 ? 2.0 : 1.0;
        if (topHere < wy + wh + 0.45 || R.chance(0.25)) continue;
        const hole = new THREE.Path();
        const ww = wy === 0 ? 0.9 : 0.55;
        hole.moveTo(cx - ww / 2, wy);
        hole.lineTo(cx + ww / 2, wy);
        hole.lineTo(cx + ww / 2, wy + wh * 0.8);
        hole.quadraticCurveTo(cx, wy + wh * 1.1, cx - ww / 2, wy + wh * 0.8);
        hole.closePath();
        sh.holes.push(hole);
      }
    }
    const g = topOut
      ? new THREE.ExtrudeGeometry(sh, { depth: t - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1, curveSegments: 3 })
      : new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, topOut ? -(t - 0.12) / 2 : -t / 2);
    g.userData.tops = topOut;
    return g;
  };
  /** Soot: darken a tinted geometry toward its burnt top (and green damp at the foot). */
  const sootify = (g, base, top, { ivy = 0 } = {}) => {
    const p = g.attributes.position;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const f = THREE.MathUtils.clamp((p.getY(i) - base) / Math.max(0.1, top - base), 0, 1);
      const k = 1 - 0.55 * Math.pow(f, 1.6);
      let r = c.getX(i) * k, gg = c.getY(i) * k, b = c.getZ(i) * k;
      if (ivy && f < 0.55 && R.chance(ivy)) { r *= 0.45; gg *= 0.8; b *= 0.4; }
      c.setXYZ(i, r, gg, b);
    }
    return g;
  };
  /** Rubble mound: a squashed, noise-displaced heap of broken stone with blocks on it. */
  const rubbleMound = (x, z, r, hgt, base, col, local = null) => {
    if (local) {
      // a heap placed in a wall's local frame
      const p = new THREE.Vector3(local.x, 0, local.z).applyMatrix4(local.m);
      ({ r, h: hgt, base, col } = local);
      x = p.x; z = p.z;
    }
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const n = 0.75 + 0.5 * Math.abs(Math.sin(vx * 5.1 + vz * 3.7 + x) * Math.cos(vz * 4.3 - vx * 2.2 + z));
      p.setXYZ(i, vx * r * n, Math.max(0, vy) * hgt * n, vz * r * n * R.range(0.85, 1.15));
    }
    g.computeVertexNormals();
    g.translate(x, base - 0.05, z);
    rubble.push(tint(worldUV(ni(g), 2.2), new THREE.Color(col).multiplyScalar(0.7), { aoBottom: base, aoTop: base + hgt, aoStrength: 0.35 }));
    const nb = R.int(3, 7);
    for (let k = 0; k < nb; k++) {
      const a = R.range(0, Math.PI * 2), d = R.range(0.2, r * 1.1);
      const bs = R.range(0.25, 0.6);
      const bx = box(bs, bs * R.range(0.5, 0.9), bs * R.range(0.7, 1.3), { x: x + Math.cos(a) * d, y: base + Math.max(0, hgt * (1 - d / r)) * 0.8 - 0.1, z: z + Math.sin(a) * d, ry: R.range(0, 3), rx: R.range(-0.4, 0.4), rz: R.range(-0.4, 0.4) });
      rubble.push(tint(worldUV(bx, 2.2), new THREE.Color(col).multiplyScalar(R.range(0.65, 0.95))));
    }
  };


  /** One house: box + roof (or a ruined shell). */
  // each house draws its details from its own stream (seeded by position), so
  // changing one building's dressing never reshuffles the whole skyline
  const lots = []; // empty lots of the old city (rubble fields)
  const chimneys = []; // chimney tops of the living town (hearth smoke over the title skyline)
  const foot = []; // building footprints: the ground mask darkens round them (contact AO)
  let RV = Rw; // per-house variety stream (wall build, wash colour): never shifts R
  const house = (x, z, ...rest) => {
    const saved = R;
    const hk = (Math.round(x * 131.7) * 73856093) ^ (Math.round(z * 97.3) * 19349663) ^ seed;
    R = prng(hk);
    RV = prng(hk ^ 0x5bd1e995);
    try {
      houseImpl(x, z, ...rest);
    } finally {
      R = saved;
    }
  };
  const houseImpl = (x, z, w, d, h, ry, { ruined = false, burnt = false, lit = 0.3, base = GROUND, detail = true } = {}) => {
    const col = R.pick(stoneCols);
    foot.push({ x, z, w, d, ry, ruined, burnt });
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, base, z);
    if (ruined) {
      // four walls of differing broken heights, no roof
      const t = 0.8;
      const segs = [
        [0, d / 2, w, 0], [0, -d / 2, w, 0], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, Math.PI / 2],
      ];
      for (const [ox, oz, len, r] of segs) {
        if (R.chance(0.22)) continue; // a wall gone entirely
        const tt = t * R.range(0.9, 1.2);
        // stub heights vary wildly: knee-high footings, half-height shells and
        // the odd gable end still standing near full height
        const hk = R.next();
        const wh = h * (hk < 0.22 ? R.range(0.16, 0.34) : hk < 0.75 ? R.range(0.45, 0.9) : R.range(1.0, 1.4));
        const g = ruinWall(len + tt, wh, tt, { openings: detail, tops: detail ? [] : null });
        const tops = g.userData.tops;
        g.rotateY(r);
        g.translate(ox, 0, oz);
        g.applyMatrix4(m);
        const c = new THREE.Color(col).multiplyScalar(R.range(0.7, 0.86));
        rubble.push(sootify(tint(worldUV(g, 2.2), c, { aoBottom: base, aoTop: base + 2.5 }), base, base + h, { ivy: 0.18 }));
        if (!detail || !tops) continue;
        // broken masonry: loose squared blocks sitting proud on the ragged top
        // (thicker than the core, some half-dislodged), and scree spilling from the foot
        const wm = new THREE.Matrix4().makeRotationY(r).setPosition(ox, 0, oz).premultiply(m);
        for (const [tx, ty] of tops) {
          if (R.chance(0.45)) continue;
          const bs = R.range(0.35, 0.6);
          const bg = box(bs * R.range(1, 1.6), bs * 0.7, tt * R.range(0.8, 1.25), { x: tx, y: ty - bs * 0.3, z: R.range(-0.12, 0.12), ry: R.range(-0.25, 0.25), rz: R.range(-0.3, 0.3) });
          bg.applyMatrix4(wm);
          rubble.push(sootify(tint(worldUV(bg, 2.2), c.clone().multiplyScalar(R.range(0.8, 1.05))), base, base + h));
        }
        for (const side of [-1, 1]) {
          const nb = R.int(4, 9);
          for (let k = 0; k < nb; k++) {
            const bs = R.range(0.2, 0.55);
            const bx = R.range(-len / 2, len / 2), bz = side * (tt / 2 + R.range(0.1, 1.2));
            const bg = box(bs, bs * R.range(0.5, 0.9), bs * R.range(0.7, 1.3), { x: bx, y: -0.08, z: bz, ry: R.range(0, 3), rx: R.range(-0.4, 0.4), rz: R.range(-0.4, 0.4) });
            bg.applyMatrix4(wm);
            rubble.push(tint(worldUV(bg, 2.2), c.clone().multiplyScalar(R.range(0.65, 0.95))));
          }
          if (R.chance(0.6)) rubbleMound(0, 0, 0, 0, 0, 0, { m: wm, x: R.range(-len / 3, len / 3), z: side * (tt / 2 + 0.5), r: R.range(0.9, 1.6), h: R.range(0.4, 0.9), base, col });
        }
      }
      // a lone chimney stack outliving the house (the classic burnt-town silhouette)
      if (R.chance(0.38)) {
        const sx = (R.chance(0.5) ? -1 : 1) * (w / 2 - 0.45), sz = R.range(-0.3, 0.3) * d;
        const shh = h * R.range(1.05, 1.5);
        const st = box(0.95, shh, 0.8, { x: sx, z: sz });
        st.applyMatrix4(m);
        rubble.push(sootify(tint(worldUV(st, 2.2), new THREE.Color(col).multiplyScalar(0.72), { aoBottom: base, aoTop: base + 2 }), base, base + shh));
        // the hearth opening at its foot
        const hb = box(0.7, 0.9, 0.12, { x: sx, y: 0.1, z: sz + 0.41 });
        hb.applyMatrix4(m);
        beams.push(tint(hb, 0x080605));
      }
      // what is left of an upper floor: charred joists still socketed in one
      // wall, a few boards on them, the rest fallen through
      if (detail && R.chance(0.55)) {
        const fy = Math.min(2.7, h * 0.42);
        const nj = R.int(3, 6);
        for (let k = 0; k < nj; k++) {
          const jx = -w / 2 + 0.4 + (w - 0.8) * (k / Math.max(1, nj - 1));
          const len2 = d * R.range(0.35, 0.95);
          const jg = box(0.16, 0.2, len2, { x: jx, y: fy, z: -d / 2 + len2 / 2, rx: R.range(-0.08, 0.12) });
          jg.applyMatrix4(m);
          beams.push(tint(worldUV(jg, 1.5), R.chance(0.5) ? 0x1c1410 : 0x34261a));
        }
        const bw = w * R.range(0.3, 0.6);
        const bd = box(bw, 0.05, d * 0.3, { x: -w / 2 + bw / 2 + 0.2, y: fy + 0.2, z: -d / 2 + d * 0.15 });
        bd.applyMatrix4(m);
        beams.push(tint(worldUV(bd, 1.5), 0x4a3828));
      }
      // heaps of fallen masonry inside the shell and spilling into the street
      rubbleMound(x + R.range(-w, w) * 0.25, z + R.range(-d, d) * 0.25, Math.min(w, d) * R.range(0.3, 0.45), R.range(0.7, 1.6), base, col);
      if (R.chance(0.5)) rubbleMound(x + R.range(-1, 1) * w * 0.6, z + R.range(-1, 1) * d * 0.6, R.range(0.8, 1.6), R.range(0.4, 0.9), base, col);
      // charred roof timbers: rafters still spanning wall to wall, others fallen
      // in and lying on the rubble (never hanging in mid-air)
      const nb = R.int(2, 4);
      for (let k = 0; k < nb; k++) {
        const fallen = R.chance(0.6);
        const bx = -w / 2 + w * R.range(0.15, 0.85);
        const g = fallen
          ? box(0.22, 0.24, d * R.range(0.5, 0.8), { x: bx, y: 0.02, z: R.range(-0.4, 0.4), ry: R.range(-0.6, 0.6), rx: R.range(-0.06, 0.06) })
          : box(0.22, 0.26, d + 0.3, { x: bx, y: h * 0.25 - 0.3, z: 0, rz: R.range(-0.04, 0.04) });
        g.applyMatrix4(m);
        beams.push(tint(worldUV(g, 1.5), R.chance(0.5) ? 0x2a1e16 : 0x4a3424));
      }
      if (R.chance(0.35)) {
        // a collapsed half-roof slab leaning into the shell
        const gr = gableRoof(w * 0.6, d, d * 0.45, { o: 0.2, t: 0.2, ridge: false });
        const mm = new THREE.Matrix4().makeRotationZ(R.range(0.25, 0.5)).setPosition(-w * 0.15, h * 0.35, 0).premultiply(m);
        roofs.push(tint(gr.roof[0].applyMatrix4(mm), 0x7a4a3a));
      }
      return;
    }
    // lime-washed plaster between oak timbers on a rubble-stone plinth. Near
    // houses of two storeys get a jettied upper floor (overhanging front and
    // back on projecting joists), so the street fronts read as hand-built
    // half-timbering rather than boxes.
    const lime = new THREE.Color().setHSL(0.09 + R.range(-0.02, 0.03), R.range(0.14, 0.26), R.range(0.64, 0.76));
    const jet = detail && h > 4.6 ? R.range(0.32, 0.5) : 0;
    const h1 = jet ? Math.min(3.0, h * R.range(0.46, 0.55)) : h;
    const dR = d + jet * 2; // depth under the roof
    // the dead quarter's houses are not one lime-wash: ochre, rose, grey and
    // dirty-white washes, smoke-blackened (their own charred material), and
    // many built on a rubble-stone ground storey with only the upper floor framed
    if (burnt) {
      const wash = RV.pick([[0.1, 0.38, 0.5], [0.04, 0.22, 0.52], [0.6, 0.05, 0.5], [0.09, 0.12, 0.6], [0.075, 0.3, 0.42]]);
      lime.setHSL(wash[0] + RV.range(-0.015, 0.015), wash[1], wash[2] * RV.range(0.88, 1.06));
    }
    const stoneF = detail && !jet && (burnt ? RV.chance(0.62) : RV.chance(0.22));
    const hS = stoneF ? (h < 3.8 ? h : Math.min(3.0, h * 0.5)) : 0.9; // top of the masonry storey
    const limeOf = (k = 1) => lime.clone().multiplyScalar((burnt ? 0.82 : 1) * k);
    const putPlaster = (g, k = 1) => {
      g.applyMatrix4(m);
      const t = tint(worldUV(g, 1.4), limeOf(k), { aoBottom: base, aoTop: base + 3, aoStrength: 0.3 });
      (burnt ? charred : plaster).push(burnt ? sootify(t, base, base + h, { ivy: 0.2 }) : t);
    };
    if (stoneF) {
      const sg = box(w + 0.06, hS, d + 0.06);
      sg.applyMatrix4(m);
      const sc = new THREE.Color(col).multiplyScalar(RV.range(0.72, 0.9));
      const st = tint(worldUV(sg, 2.2), sc, { aoBottom: base, aoTop: base + 2.2 });
      rubble.push(burnt ? sootify(st, base, base + hS + 1.5, { ivy: 0.25 }) : st);
      if (hS < h) putPlaster(box(w, h - hS, d, { y: hS }));
      // dressed quoins up the masonry corners
      for (const [qx, qz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        for (let y = 0.9, k = 0; y < hS - 0.3; y += 0.46, k++) {
          const q = box(k % 2 ? 0.42 : 0.7, 0.42, 0.12, { x: qx * (w / 2 - (k % 2 ? 0.21 : 0.35) + 0.04), y, z: qz * (d / 2 + 0.06) });
          q.applyMatrix4(m);
          fine.push(tint(worldUV(q, 1.2), new THREE.Color(0xa89c88).multiplyScalar((burnt ? 0.62 : 0.9) * RV.range(0.88, 1.08))));
        }
      }
    } else putPlaster(box(w, h1, d));
    if (jet) putPlaster(box(w, h - h1, dR, { y: h1 }), R.range(0.92, 1.04));
    const pl = box(w + 0.16, 0.9, d + 0.16);
    pl.applyMatrix4(m);
    walls.push(tint(worldUV(pl, 2.4), new THREE.Color(col).multiplyScalar(0.85), { aoBottom: base, aoTop: base + 1 }));
    // the face a storey's windows sit on (front/back of the upper floor stand proud)
    const faceZ = (y) => (jet && y > h1 ? d / 2 + jet : d / 2);
    if (detail) {
      const T = 0.2, P = 0.05; // timber width, proud of the plaster
      const tc = R.chance(0.5) ? 0x3a2a1e : 0x4a3424;
      const tim = (geo) => { geo.applyMatrix4(m); beams.push(tint(worldUV(geo, 1.6), tc)); };
      const storeys = jet ? [[0.9, h1, d / 2], [h1, h, d / 2 + jet]] : stoneF ? (hS < h - 0.5 ? [[hS, h, d / 2]] : []) : [[0.9, h, d / 2]];
      for (const [y0, y1, hz] of storeys) {
        const sh = y1 - y0;
        // corner posts
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tim(box(T + P * 2, sh, T + P * 2, { x: cx * (w / 2 - T / 2 + P), y: y0, z: cz * (hz - T / 2 + P) }));
        // sill / bressumer and wall plate round the storey
        for (const y of [y0 - (y0 > 1 ? 0 : T / 2), y1 - T]) {
          tim(box(w + P * 2, T, T * 0.6, { y, z: hz + P - T * 0.3 }));
          tim(box(w + P * 2, T, T * 0.6, { y, z: -hz - P + T * 0.3 }));
          tim(box(T * 0.6, T, hz * 2 + P * 2, { x: w / 2 + P - T * 0.3, y }));
          tim(box(T * 0.6, T, hz * 2 + P * 2, { x: -w / 2 - P + T * 0.3, y }));
        }
        // close studding on the street front, a pair of curved-looking down-braces
        const studs = Math.max(2, Math.round(w / (y0 > 1 ? 1.1 : 1.6)));
        for (let i = 1; i < studs; i++) tim(box(T * 0.7, sh - 0.1, T * 0.5, { x: -w / 2 + (w / studs) * i, y: y0 + 0.05, z: hz + P }));
        const bh = Math.min(2.2, sh - 0.3);
        const run = w / studs - T;
        const blen = Math.hypot(run, bh);
        for (const sx of [-1, 1]) tim(box(T * 0.6, blen, T * 0.45, { x: sx * (w / 2 - T), y: y0 + 0.1, z: hz + P + 0.01, rz: Math.atan2(sx * run, bh) }));
        // a mid-rail on the gable sides
        tim(box(T * 0.5, T * 0.8, hz * 2, { x: w / 2 + P, y: y0 + sh * 0.5 }));
        tim(box(T * 0.5, T * 0.8, hz * 2, { x: -w / 2 - P, y: y0 + sh * 0.5 }));
      }
      if (jet) {
        // joist ends carrying the overhang, front and back, and a moulded bressumer
        for (const sz of [-1, 1]) {
          for (let jx = -w / 2 + 0.25; jx <= w / 2 - 0.2; jx += 0.42) tim(box(0.14, 0.16, jet + 0.06, { x: jx, y: h1 - 0.2, z: sz * (d / 2 + jet / 2) }));
          tim(box(w + 0.3, 0.12, 0.12, { y: h1 - 0.06, z: sz * (d / 2 + jet + 0.04) }));
        }
      }
    }
    const kind = burnt ? 0 : R.next();
    if (kind < 0.66 && burnt) {
      // burnt out: one roof slope fallen in, the charred rafters of the other
      // still standing against the sky
      const rise = dR * R.range(0.36, 0.5);
      const o = 0.55;
      const gr = gableRoof(w, dR, rise, { o, t: 0.2, ridge: false });
      const mm = new THREE.Matrix4().makeTranslation(0, h, 0).premultiply(m);
      const keep = R.chance(0.5) ? 0 : 1;
      const list = R.chance(0.5) ? roofs : shake;
      // the surviving slope is broken into bays between the rafters: some
      // whole, some sagging off the ridge, some gone (rafters bare against the
      // sky), and a ragged eave where tiles have slid off - never one clean card
      {
        const rc = new THREE.Color(list === roofs ? R.pick(roofCols) : R.pick(shakeCols)).multiplyScalar(0.62);
        const nb = Math.max(2, Math.round((w + o * 2) / 1.7));
        const bw = (w + o * 2) / nb;
        const sg = keep === 0 ? -1 : 1;
        for (let k = 0; k < nb; k++) {
          const fate = R.next();
          if (fate < 0.22 && k > 0 && k < nb - 1) continue; // fallen through
          const oo = fate < 0.55 ? R.range(-dR * 0.22, o) : o * R.range(0.6, 1);
          const sl = gableRoof(bw - 0.04, dR, rise, { o: oo, t: 0.2, ridge: false }).roof[keep];
          if (fate > 0.8) {
            // a sagging bay: hinged at the ridge, dropped toward the shell
            const sag = R.range(0.12, 0.28);
            sl.translate(0, -rise, 0);
            sl.rotateX(sg * sag);
            sl.translate(0, rise - 0.05, 0);
          }
          sl.translate(-(w + o * 2) / 2 + bw * (k + 0.5), 0, 0);
          list.push(sootify(tint(sl.applyMatrix4(mm), rc.clone().multiplyScalar(R.range(0.8, 1.1))), base + h, base + h + rise));
        }
      }
      const nR = Math.max(3, Math.round(w / 0.7));
      for (let k = 0; k < nR; k++) {
        if (R.chance(0.3)) continue;
        const rr = gableRoof(0.13, dR, rise, { o: o * R.range(0.2, 1), t: 0.15, ridge: false }).roof[1 - keep];
        rr.translate(-w / 2 + 0.2 + (w - 0.4) * (k / (nR - 1)), 0, 0);
        beams.push(tint(worldUV(rr.applyMatrix4(mm), 1.5), 0x1e1612));
      }
      // gable ends broken down: the apex has fallen, leaving a ragged stepped
      // top in the plaster and lath, one side often lower than the other
      for (const sx of [-1, 1]) {
        const half = dR / 2;
        const cut = rise * R.range(0.2, 0.75);
        const sh = new THREE.Shape();
        sh.moveTo(-half, 0);
        sh.lineTo(half, 0);
        const n = 7;
        for (let i = 0; i <= n; i++) {
          const z = half - (2 * half * i) / n;
          const rake = rise * (1 - Math.abs(z) / half);
          const y = Math.max(0.05, Math.min(rake, cut + (R.next() - 0.5) * rise * 0.35 + (z * sx > 0 ? rise * 0.15 : -rise * 0.1)));
          sh.lineTo(z, y);
        }
        sh.closePath();
        const g2 = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false });
        g2.translate(0, 0, -0.09);
        g2.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        g2.translate(sx * (w / 2), 0, 0);
        charred.push(sootify(tint(worldUV(ni(g2).applyMatrix4(mm), 1.4), lime.clone().multiplyScalar(0.7)), base + h - 1, base + h + rise));
      }
      // the fallen roof and gable lie in a spill of tiles and rubble at the foot
      {
        const side = new THREE.Vector3(0, 0, (keep === 0 ? -1 : 1) * (d / 2 + 0.9)).applyMatrix4(m);
        rubbleMound(side.x, side.z, R.range(1.2, 2.0), R.range(0.5, 0.9), base, 0x4a3a30);
      }
      // the surviving slope has lost tiles in places: charred holes with the
      // battens showing across them
      {
        const ang = Math.atan2(rise, dR / 2);
        const L = (dR / 2 + o) / Math.cos(ang);
        const sgn = keep === 0 ? -1 : 1;
        const np = R.int(1, 3);
        for (let k = 0; k < np; k++) {
          const pw = R.range(0.6, 1.5), pd = R.range(0.6, 1.3);
          const px = R.range(-w / 2 + pw, w / 2 - pw), pz = R.range(0.25, 0.75) * L;
          const ph = box(pw, 0.24, pd, { x: px, y: -0.2 + 0.015, z: sgn * pz });
          ph.rotateX(sgn * ang);
          ph.translate(0, rise + 0.2 * 0.35, 0);
          beams.push(tint(worldUV(ph.applyMatrix4(mm), 1.5), 0x0e0a08));
          for (let q = -1; q <= 1; q += 2) {
            const bt = box(pw + 0.2, 0.05, 0.07, { x: px, y: 0.0, z: sgn * (pz + q * pd * 0.22) });
            bt.rotateX(sgn * ang);
            bt.translate(0, rise + 0.2 * 0.35, 0);
            beams.push(tint(worldUV(bt.applyMatrix4(mm), 1.5), 0x3a281a));
          }
        }
      }
    } else if (kind < 0.66) {
      const rise = dR * R.range(0.36, 0.55);
      const gr = gableRoof(w, dR, rise, { o: R.range(0.45, 0.7), t: R.range(0.18, 0.26) });
      const mm = new THREE.Matrix4().makeTranslation(0, h, 0).premultiply(m);
      const pick = R.next();
      const list = pick < 0.45 ? roofs : pick < 0.78 ? slate : shake;
      const rc = list === roofs ? R.pick(roofCols) : list === slate ? R.pick(slateCols) : R.pick(shakeCols);
      for (const g of gr.roof) list.push(tint(g.applyMatrix4(mm), rc));
      for (const g of gr.caps) list.push(tint(g.applyMatrix4(mm), new THREE.Color(rc).multiplyScalar(0.8)));
      for (const g of gr.gables) plaster.push(tint(worldUV(g.applyMatrix4(mm), 1.4), lime));
      if (R.chance(0.7)) {
        // a rubble-stone chimney stack through the roof, with a dressed cap and pots
        const chx = (R.chance(0.5) ? -1 : 1) * (w / 2 - 0.5), chz = R.range(-0.25, 0.25) * d;
        const chh = rise + R.range(0.9, 1.8);
        const cg = box(0.75, chh + 0.6, 0.75, { x: chx, y: -0.6, z: chz });
        cg.applyMatrix4(mm);
        walls.push(tint(worldUV(cg, 2.4), new THREE.Color(col).multiplyScalar(0.8)));
        const cap = box(0.95, 0.18, 0.95, { x: chx, y: chh, z: chz });
        cap.applyMatrix4(mm);
        fine.push(tint(worldUV(cap, 2), 0x8a8070));
        if (lit > 0) chimneys.push(new THREE.Vector3(chx, chh + 0.6, chz).applyMatrix4(mm));
        const pot = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 6).translate(chx, chh + 0.38, chz);
        pot.applyMatrix4(mm);
        roofs.push(tint(worldUV(ni(pot), 1), 0x8a4a34));
      }
    } else if (kind < 0.87) {
      const rg = pyramid(Math.max(w, d) * 1.12, Math.max(w, d) * 0.5, { y: h - 0.15 });
      rg.applyMatrix4(m);
      slate.push(tint(worldUV(rg, 2), R.pick(slateCols)));
      const fas = box(w + 0.5, 0.25, d + 0.5, { y: h - 0.2 });
      fas.applyMatrix4(m);
      beams.push(tint(worldUV(fas, 2), 0x3a2a1e));
    } else {
      // flat roof with parapet
      const pg = box(w + 0.2, 0.5, d + 0.2, { y: h });
      pg.applyMatrix4(m);
      walls.push(tint(worldUV(pg, 3), col));
    }
    if (R.chance(0.35)) {
      const cg = box(0.6, 1.6, 0.6, { x: w * 0.25, y: h + d * 0.2, z: 0 });
      cg.applyMatrix4(m);
      walls.push(tint(worldUV(cg, 3), col));
    }
    // windows (facing the camera and the flanks): lit panes in the living town;
    // in the dead quarter, dark empty openings - still framed, shuttered, with
    // a sill and a deep reveal, so the house reads as built, not boxed
    if (lit > 0 || detail) {
      const floors = Math.max(1, Math.floor(h / 2.6));
      for (let f = 0; f < floors; f++) {
        const wy = jet ? (f === 0 ? Math.min(1.5, h1 * 0.5) : h1 + (h - h1) * 0.5 + (f - 1) * 2.6) : 1.4 + f * 2.6;
        if (wy > h - 0.6) continue;
        const fz = faceZ(wy);
        const nx = Math.max(1, Math.floor(w / 1.8));
        for (let i = 0; i < nx; i++) {
          const wx = -w / 2 + (w / nx) * (i + 0.5);
          if (lit > 0 && R.chance(lit)) addWin(m, wx, wy, fz + 0.03, 0, 0.5, 0.8, R.range(0.8, 1.4));
          else if (detail) addWin(m, wx, wy, fz + 0.03, 0, 0.5, 0.8, burnt || lit === 0 ? (R.chance(0.12) ? 0.35 : 0.0) : 0.07);
          if (h < 11 && detail) winFrame(m, wx, wy, fz + 0.03, 0);
        }
        for (let i = 0; i < nx; i++) {
          if (R.chance(lit * 0.45)) addWin(m, -w / 2 + (w / nx) * (i + 0.5), wy, -fz - 0.03, Math.PI, 0.5, 0.8, R.range(0.8, 1.5));
        }
        const nz = Math.max(1, Math.floor(d / 2));
        for (let i = 0; i < nz; i++) {
          const zz = -d / 2 + (d / nz) * (i + 0.5);
          if (R.chance(lit * 0.6)) addWin(m, w / 2 + 0.03, wy, zz, Math.PI / 2, 0.5, 0.8, R.range(0.7, 1.3));
          else if (detail && lit === 0 && R.chance(0.5)) { addWin(m, w / 2 + 0.03, wy, zz, Math.PI / 2, 0.45, 0.7, 0); winFrame(m, w / 2 + 0.03, wy, zz, Math.PI / 2, 0.45, 0.7); }
          if (R.chance(lit * 0.6)) addWin(m, -w / 2 - 0.03, wy, zz, -Math.PI / 2, 0.5, 0.8, R.range(0.7, 1.3));
        }
      }
    }
  };

  const flags = []; // pennants on the castle and gate towers (vertex-coloured cloth)
  const slits = []; // arrow slits and loops: dark recesses that read at any distance
  /**
   * A round tower, hand-built: a battered (flared) foot, string course, arrow
   * slits staggered up the drum, and either a corbelled machicolation gallery
   * under crenels, a timber hoarding, or a conical roof whose pitch, eaves and
   * finial vary tower to tower (some carry a pennant).
   */
  const tower = (x, z, r, h, { roof = 'cone', base = GROUND, lit = 0, list = walls, flag = false, hoard = false } = {}) => {
    const col = R.pick(stoneCols);
    list.push(tint(worldUV(cylinder(r, r * 1.08, h, 18, { x, y: base, z }), 3.2), col, { aoBottom: base, aoTop: base + 5 }));
    // battered foot: a talus flaring out over the first metres
    list.push(tint(worldUV(cylinder(r * 1.08, r * 1.3, Math.min(3, h * 0.2), 18, { x, y: base, z }), 3.2), new THREE.Color(col).multiplyScalar(0.9), { aoBottom: base, aoTop: base + 3 }));
    // string course a third of the way up
    fine.push(tint(worldUV(cylinder(r * 1.12, r * 1.12, 0.3, 16, { x, y: base + h * 0.62, z }), 2), new THREE.Color(col).multiplyScalar(1.12)));
    // arrow slits: staggered round the drum, three tiers
    const nS = Math.max(3, Math.round(r * 2));
    for (let tier = 0; tier < 3; tier++) {
      const sy = base + h * (0.28 + tier * 0.22);
      for (let i = 0; i < nS; i++) {
        if (Rw.chance(0.3)) continue;
        const a = ((i + tier * 0.5) / nS) * Math.PI * 2;
        const rr = r * (1.075 - 0.08 * (sy - base) / h) + 0.02;
        slits.push(tint(box(0.16, 1.05, 0.12, { x: x + Math.cos(a) * rr, y: sy, z: z + Math.sin(a) * rr, ry: -a + Math.PI / 2 }), 0x060406));
      }
    }
    if (roof === 'cone') {
      if (hoard) {
        // timber hoarding: a boarded gallery cantilevered out on beams under the roof
        const hy = base + h - 1.9;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          beams.push(tint(worldUV(box(1.0, 0.18, 0.18, { x: x + Math.cos(a) * (r + 0.35), y: hy - 0.3, z: z + Math.sin(a) * (r + 0.35), ry: -a }), 1.2), 0x2e2016));
        }
        beams.push(tint(worldUV(cylinder(r * 1.32, r * 1.32, 1.9, 16, { x, y: hy, z, open: true }), 1.4), 0x4a3424));
        beams.push(tint(worldUV(cylinder(r * 1.34, r * 1.34, 0.12, 16, { x, y: hy + 0.5, z }), 1.4), 0x2a1c12));
      }
      if (!hoard && list === castle) {
        // a machicolated parapet under the roof: stepped corbels carrying an
        // oversailing wall-walk ring, murder-holes dark between them
        const py = base + h - 1.1;
        const nC = Math.max(10, Math.round(r * 6));
        for (let i = 0; i < nC; i++) {
          const a = (i / nC) * Math.PI * 2;
          for (let k = 0; k < 3; k++) {
            const cr = r * 1.0 + 0.1 + k * 0.11;
            fine.push(tint(worldUV(box(0.3, 0.2, 0.22 + k * 0.11, { x: x + Math.cos(a) * cr, y: py - 0.6 + k * 0.2, z: z + Math.sin(a) * cr, ry: -a + Math.PI / 2 }), 2), new THREE.Color(col).multiplyScalar(0.95 - k * 0.05)));
          }
          if (Rw.chance(0.7)) slits.push(tint(box(0.16, 0.2, 0.1, { x: x + Math.cos(a + Math.PI / nC) * (r * 1.0 + 0.25), y: py - 0.2, z: z + Math.sin(a + Math.PI / nC) * (r * 1.0 + 0.25), ry: -a + Math.PI / 2 }), 0x050304));
        }
        list.push(tint(worldUV(cylinder(r * 1.16, r * 1.12, 1.15, 18, { x, y: py, z }), 3.2), new THREE.Color(col).multiplyScalar(0.96)));
      }
      // eaves ring, conical roof (pitch varies tower to tower), lead finial
      const pitch = R.range(1.9, 3.3);
      const rr = r * (hoard ? 1.5 : R.range(1.2, 1.36));
      beams.push(tint(worldUV(cylinder(rr * 1.02, rr * 0.92, 0.3, 16, { x, y: base + h - 0.05, z }), 2), 0x3a2a1e));
      slate.push(tint(worldUV(cone(rr, r * pitch, 16, { x, y: base + h + 0.2, z }), 2), R.pick(slateCols)));
      // a bellcast kick at the eaves
      slate.push(tint(worldUV(cylinder(rr * 0.96, rr * 1.08, 0.45, 16, { x, y: base + h - 0.15, z, open: true }), 2), new THREE.Color(R.pick(slateCols)).multiplyScalar(0.85)));
      const tipY = base + h + 0.2 + r * pitch;
      fine.push(tint(worldUV(cylinder(0.06, 0.1, r * 0.9, 6, { x, y: tipY - 0.1, z }), 1), 0x6a6050));
      fine.push(tint(ni(new THREE.SphereGeometry(0.16, 8, 6).translate(x, tipY + 0.25, z)), 0x8a7a50));
      if (flag) pennant(x, tipY + r * 0.9 - 0.2, z);
    } else {
      // corbelled machicolation gallery: a ring of stepped corbels carrying an
      // oversailing parapet, murder-holes between them, crenels on top
      const py = base + h - 0.55;
      const nC = Math.max(10, Math.round(r * 6));
      for (let i = 0; i < nC; i++) {
        const a = (i / nC) * Math.PI * 2;
        for (let k = 0; k < 3; k++) {
          const cr = r * 1.02 + 0.12 + k * 0.12;
          fine.push(tint(worldUV(box(0.32, 0.22, 0.24 + k * 0.12, { x: x + Math.cos(a) * cr, y: py - 0.66 + k * 0.22, z: z + Math.sin(a) * cr, ry: -a + Math.PI / 2 }), 2), new THREE.Color(col).multiplyScalar(0.98 - k * 0.04)));
        }
      }
      fine.push(tint(worldUV(cylinder(r * 1.2, r * 1.12, 0.55, 18, { x, y: py, z }), 2), new THREE.Color(col).multiplyScalar(0.95)));
      list.push(tint(worldUV(cylinder(r * 1.2, r * 1.2, 0.9, 18, { x, y: base + h, z }), 3.2), col));
      const n = Math.round(r * 3.2);
      for (let i = 0; i < n; i++) {
        if (roof === 'broken' && R.chance(0.4)) continue;
        const a = (i / n) * Math.PI * 2;
        list.push(tint(worldUV(box(0.7, R.chance(0.2) ? 0.5 : 0.85, 0.5, { x: x + Math.cos(a) * r * 1.15, y: base + h + 0.9, z: z + Math.sin(a) * r * 1.15, ry: -a }), 3.2), col));
      }
      if (roof !== 'broken' && R.chance(0.5)) {
        // a stair turret riding the parapet, capped with a little cone
        const a = R.range(0, Math.PI * 2);
        const tx = x + Math.cos(a) * r * 0.75, tz = z + Math.sin(a) * r * 0.75;
        list.push(tint(worldUV(cylinder(r * 0.32, r * 0.34, 2.6, 12, { x: tx, y: base + h, z: tz }), 3.2), col));
        slate.push(tint(worldUV(cone(r * 0.44, r * 1.1, 12, { x: tx, y: base + h + 2.6, z: tz }), 2), R.pick(slateCols)));
      }
      if (flag) pennant(x, base + h + 1.0, z, 4.5);
    }
    if (lit) {
      const m = new THREE.Matrix4().setPosition(x, base, z);
      for (let k = 0; k < 2; k++) addWin(m, 0, h * (0.45 + k * 0.25), r * 1.02 + 0.05, 0, 0.5, 0.9, 1.2);
    }
  };
  /** A pole with a long swallow-tailed pennant streaming west on the sea wind. */
  const pennant = (x, y, z, pole = 2.2) => {
    fine.push(tint(ni(new THREE.CylinderGeometry(0.05, 0.07, pole, 6).translate(x, y + pole / 2, z)), 0x3a3028));
    const g = new THREE.PlaneGeometry(2.8, 0.9, 10, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 1.4) / 2.8;
      // taper toward the fly and cut a swallowtail into it
      let yy = p.getY(i) * (1 - u * 0.55);
      if (u > 0.8) yy *= 1 + (Math.abs(p.getY(i)) < 0.1 ? -0.9 : 0) * (u - 0.8) * 5;
      p.setXYZ(i, p.getX(i) + 1.4, yy, Math.sin(u * 7.0 + x) * 0.22 * u);
    }
    g.computeVertexNormals();
    g.rotateY(Math.PI + 0.35);
    g.translate(x, y + pole - 0.5, z);
    flags.push(tint(ni(g), R.chance(0.5) ? 0x8a1410 : 0x1a2a6a));
  };

  const crenel = (x0, z0, x1, z1, y, t, col, list = walls) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / 1.3);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      // fifty years of neglect: merlons fallen, others chipped lower
      if (Rw.chance(list === castle ? 0.2 : 0.12)) continue;
      const mh = Rw.chance(0.25) ? Rw.range(0.35, 0.65) : 0.8;
      list.push(tint(worldUV(box(0.7, mh, t, { x: x0 + (x1 - x0) * f, y, z: z0 + (z1 - z0) * f, ry: -ang + Rw.range(-0.04, 0.04) }), 3.2), new THREE.Color(col).multiplyScalar(Rw.range(0.86, 1.04))));
    }
  };

  const wallRun = (x0, z0, x1, z1, h, { base = GROUND, gaps = 0, list = walls } = {}) => {
    const col = 0x857a6d;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const segs = Math.max(1, Math.round(len / 10));
    for (let i = 0; i < segs; i++) {
      if (R.chance(gaps)) continue;
      const f = (i + 0.5) / segs;
      const hh = R.chance(gaps) ? h * R.range(0.3, 0.7) : h;
      const cx = x0 + (x1 - x0) * f, cz = z0 + (z1 - z0) * f;
      list.push(tint(worldUV(box(len / segs + 0.05, hh, 2.2, { x: cx, y: base, z: cz, ry: -ang }), 3.2), col, { aoBottom: base, aoTop: base + 3 }));
      if (hh === h) {
        const ax = x0 + (x1 - x0) * (i / segs), az = z0 + (z1 - z0) * (i / segs);
        const bx = x0 + (x1 - x0) * ((i + 1) / segs), bz = z0 + (z1 - z0) * ((i + 1) / segs);
        crenel(ax, az, bx, bz, base + h, 0.5, col, list);
      }
    }
  };

  // ---- the city blocks ----------------------------------------------------
  for (let gz = 0; gz < 15; gz++) {
    for (let gx = -19; gx <= 19; gx++) {
      const z = -26 - gz * 8.6 + R.range(-2, 2);
      const x = gx * 8.8 + R.range(-2.2, 2.2) + (gz % 2) * 4;
      if (Math.abs(x) < 7 && gz < 6) continue; // the great avenue down to the harbour
      if (Math.hypot(x - 55, z + 128) < 26) continue; // castle mound
      if (Math.hypot(x + 42, z + 96) < 11) continue; // temple close
      if (x > -38 && x < -2 && z < -33 && z > -67) continue; // council plaza
      if (R.chance(0.12)) {
        if (x > 8) lots.push([x, z]); // an empty lot in the dead quarter: a rubble field
        continue;
      }
      const east = x > 6;
      const w = R.range(4.2, 7.5);
      const d = R.range(4.2, 7.2);
      const far = gz / 15;
      const h = R.range(3.2, 7.0) * (1 + far * 0.25) * (R.chance(0.08) ? 1.5 : 1);
      const ry = (R.chance(0.5) ? 0 : Math.PI / 2) + R.range(-0.12, 0.12);
      // the dead quarter: most of the east is roofless shells, the rest burnt out
      const ruined = east ? R.chance(0.8) : R.chance(0.08);
      // timber framing and window joinery only where the camera ever gets close
      const near = (gz < 6 && Math.abs(x) < 120) || (x > 10 && x < 110 && gz < 12);
      // the streets right behind the terrace keep more hearths lit (the title skyline)
      house(x, z, w, d, h, ry, { ruined, burnt: east && !ruined, lit: east ? 0 : gz < 5 && Math.abs(x) < 60 ? 0.85 : 0.5, detail: near });
      if (!ruined && R.chance(0.06)) tower(x + w * 0.6, z, R.range(1.4, 2.2), h + R.range(5, 10), { roof: east ? 'broken' : R.chance(0.5) ? 'cone' : 'flat', lit: east ? 0 : 1 });
      if (east && ruined && R.chance(0.22) && fires.length < 9) fires.push(new THREE.Vector3(x + R.range(-1, 1), GROUND + 0.5, z));
    }
  }

  // ---- New Phlan rebuilding: skyline silhouettes behind the terrace ----------
  // (seen over the Pool on the title card) a timber treadwheel crane, a slender
  // belfry and scaffolding round half-rebuilt houses, so the midground skyline
  // has chimneys, poles and broken lines instead of a row of blocks
  {
    const Rs = prng(seed + 501);
    const savedR = R;
    R = Rs; // ruinWall/addWin draw from R: keep the main layout stream untouched
    const tb = (g, c = 0x3a2a1e) => beams.push(tint(worldUV(g, 1.5), c));
    // treadwheel crane
    {
      const cx = -9, cz = -41, b0 = GROUND;
      tb(box(0.5, 19, 0.5, { x: cx, y: b0, z: cz }));
      for (const a of [0, 2.1, 4.2]) tb(box(0.3, 8.5, 0.3, { x: cx + Math.cos(a) * 1.6, y: b0, z: cz + Math.sin(a) * 1.6, rx: Math.sin(a) * 0.2, rz: -Math.cos(a) * 0.2 }));
      const jib = box(0.35, 0.35, 13, { x: cx, y: b0 + 18.2, z: cz + 3.5, rx: -0.28 });
      tb(jib);
      tb(box(0.06, 7.5, 0.06, { x: cx, y: b0 + 12.2, z: cz + 9.4 }), 0x1a1410);
      tb(box(0.9, 0.7, 0.9, { x: cx, y: b0 + 11.5, z: cz + 9.4 }), 0x6a6056);
      const wheel = new THREE.TorusGeometry(2.0, 0.16, 6, 22);
      wheel.translate(cx + 1.1, b0 + 2.2, cz);
      tb(ni(wheel));
    }
    // a slender belfry with an open lantern and a pyramid cap
    {
      const bx = 24, bz = -47, b0 = GROUND;
      walls.push(tint(worldUV(box(3.0, 17, 3.0, { x: bx, y: b0, z: bz }), 2.4), 0x857a6b, { aoBottom: b0, aoTop: b0 + 4 }));
      for (const [ox, oz] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) fine.push(tint(worldUV(box(0.5, 3.2, 0.5, { x: bx + ox, y: b0 + 17, z: bz + oz }), 2), 0x9a8f80));
      fine.push(tint(worldUV(box(3.4, 0.35, 3.4, { x: bx, y: b0 + 20.2, z: bz }), 2), 0x9a8f80));
      slate.push(tint(worldUV(pyramid(3.6, 3.4, { x: bx, y: b0 + 20.5, z: bz }), 2), 0x5d6475));
      tb(box(0.9, 1.1, 0.9, { x: bx, y: b0 + 17.8, z: bz }), 0x7a5a2a);
      addWin(new THREE.Matrix4(), bx, b0 + 13, bz + 1.53, 0, 0.5, 1.0, 1.2);
      addWin(new THREE.Matrix4(), bx, b0 + 9, bz + 1.53, 0, 0.5, 1.0, 0.9);
    }
    // scaffolding: standards, ledgers and putlogs round two houses being rebuilt
    for (const [sx, sz, sw, sh] of [[-4, -36, 6, 11], [10, -43, 6, 12.5], [17, -35, 5, 10]]) {
      for (let i = 0; i <= Math.round(sw / 1.8); i++) {
        const x = sx - sw / 2 + (sw / Math.round(sw / 1.8)) * i;
        tb(box(0.12, sh + Rs.range(-0.6, 1.2), 0.12, { x, y: GROUND, z: sz, rz: Rs.range(-0.02, 0.02) }), 0x4a3a2a);
      }
      for (let y = 2; y < sh; y += 2.1) {
        tb(box(sw + 0.4, 0.1, 0.1, { x: sx, y: GROUND + y, z: sz }), 0x4a3a2a);
        if (Rs.chance(0.7)) tb(box(sw * Rs.range(0.4, 0.9), 0.06, 0.7, { x: sx + Rs.range(-1, 1), y: GROUND + y + 0.08, z: sz - 0.4 }), 0x5a4632);
      }
      tb(box(0.1, Math.hypot(sw, sh) * 0.9, 0.1, { x: sx, y: GROUND + 0.5, z: sz + 0.05, rz: Math.atan2(sw, sh) * 0.9 }), 0x4a3a2a);
      // the half-built gable behind it: a raw stone wall with a ragged top
      const g = ruinWall(sw - 0.6, sh - 1.5, 0.7, { openings: true });
      g.translate(sx, GROUND, sz - 1.2);
      walls.push(tint(worldUV(g, 2.2), 0x8a8072, { aoBottom: GROUND, aoTop: GROUND + 3 }));
    }
    // chimney stacks with smoke-pots poking above the near roofline
    for (let k = 0; k < 9; k++) {
      const x = Rs.range(-7, 16), z = Rs.range(-34, -56);
      const hh = Rs.range(9, 13.5);
      walls.push(tint(worldUV(box(0.8, hh, 0.8, { x, y: GROUND, z }), 2.4), 0x7a7068));
      fine.push(tint(worldUV(box(1.0, 0.2, 1.0, { x, y: GROUND + hh, z }), 2), 0x8a8070));
      roofs.push(tint(worldUV(ni(new THREE.CylinderGeometry(0.13, 0.16, 0.45, 6).translate(x + 0.2, GROUND + hh + 0.42, z)), 1), 0x8a4a34));
    }
    R = savedR;
  }

  // ---- city wall, gatehouse, towers ----------------------------------------
  wallRun(-190, -34, -12, -30, 7, { gaps: 0.05 });
  wallRun(12, -30, 190, -38, 7, { gaps: 0.35 });
  for (let x = -180; x <= 180; x += 32) {
    if (Math.abs(x) < 10) continue;
    tower(x, x < 0 ? -32 + x * -0.02 : -31 - x * 0.04, 3.2, x > 0 && R.chance(0.5) ? 7 : 10.5, { roof: x > 0 ? 'broken' : 'flat' });
  }

  // ---- Valjevo Castle on its mound ------------------------------------------
  {
    const cx = 55, cz = -128, base = GROUND + 4;
    // the motte: an earthen mound with a broken revetment, grass on its
    // shoulders, raw earth and rock where the slope has slumped, scree and
    // fallen masonry at its foot, and a worn track zig-zagging up to the gate
    {
      const Rm = prng(seed + 61);
      const RING = 30, SEG = 120;
      const pos = [], col = [];
      const prof = (r, a) => {
        const wob = 1 + 0.06 * Math.sin(a * 5 + 1.3) + 0.04 * Math.sin(a * 11 + 0.5) + 0.03 * Math.sin(a * 23);
        const rr = r / wob;
        // flat bailey top to r~19.5, a convex shoulder, the steep scarp, a toe of scree
        let y;
        if (rr < 19.5) y = 4;
        else if (rr < 33) {
          const k = (rr - 19.5) / 13.5;
          y = 4 * (1 - THREE.MathUtils.smoothstep(k, 0, 1) * 0.86 - k * 0.14);
          y += Math.sin(a * 17 + rr * 0.9) * 0.18 * Math.sin(k * Math.PI) + (Rm.next() - 0.5) * 0.12 * Math.sin(k * Math.PI);
        } else y = 0;
        return Math.max(0, y);
      };
      const vtx = (r, a) => {
        const y = prof(r, a);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        // colour: grass on the shoulder, slumped raw earth and rock in gullies on
        // the scarp, dark scree at the toe; the track up to the gate is bare and pale
        const k = THREE.MathUtils.clamp((r - 19.5) / 13.5, 0, 1);
        const gully = Math.pow(Math.abs(Math.sin(a * 9 + Math.sin(a * 3) * 1.5)), 6);
        const nn = 0.5 + 0.5 * Math.sin(a * 31 + r * 1.7) * Math.cos(a * 13 - r * 0.6);
        let c = new THREE.Color(0x46502a).lerp(new THREE.Color(0x5c5a32), nn);
        c.lerp(new THREE.Color(0x5a4a3a), THREE.MathUtils.smoothstep(k, 0.25, 0.7) * (0.35 + 0.65 * gully));
        if (nn > 0.78 && k > 0.2 && k < 0.85) c.lerp(new THREE.Color(0x6e6a62), 0.8); // rock outcrop
        c.lerp(new THREE.Color(0x3a332c), THREE.MathUtils.smoothstep(k, 0.82, 1) * 0.7);
        const da = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)); // 0 toward the gate (+z)
        const track = Math.exp(-Math.pow((da - (k - 0.5) * 0.5 * Math.sin(k * 9)) / 0.05, 2)) * (k > 0.02 ? 1 : 0);
        c.lerp(new THREE.Color(0x8a7a62), track * 0.75);
        return { p: [x, GROUND + y - 0.02, z], c: [c.r, c.g, c.b] };
      };
      const rAt = (i) => 18.5 + (i / RING) * 16;
      for (let i = 0; i < RING; i++) {
        for (let j = 0; j < SEG; j++) {
          const a0 = (j / SEG) * Math.PI * 2, a1 = ((j + 1) / SEG) * Math.PI * 2;
          const q = [vtx(rAt(i), a0), vtx(rAt(i), a1), vtx(rAt(i + 1), a1), vtx(rAt(i + 1), a0)];
          for (const t of [0, 2, 1, 0, 3, 2]) { pos.push(...q[t].p); col.push(...q[t].c); }
        }
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      mg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      mg.computeVertexNormals();
      moundGeo.push(worldUV(mg, 3.5));
      // rock outcrops breaking through the scarp, and scree fans at its toe
      const sv = R;
      R = Rm;
      for (let k = 0; k < 26; k++) {
        const a = Rm.range(0, Math.PI * 2), r = Rm.range(23, 31);
        const y = prof(r, a);
        rubbleMound(cx + Math.cos(a) * r, cz + Math.sin(a) * r, Rm.range(0.8, 1.9), Rm.range(0.4, 1.1), GROUND + y - 0.3, 0x6e665c);
      }
      // a slumped breach below the curtain: masonry fallen down the slope
      for (let k = 0; k < 9; k++) {
        const a = 0.9 + Rm.range(-0.1, 0.1), r = 19 + k * 1.4 + Rm.range(-0.5, 0.5);
        rubbleMound(cx + Math.cos(a) * r, cz + Math.sin(a) * r, Rm.range(1.0, 1.8) * (1 - k * 0.05), Rm.range(0.5, 1.0), GROUND + prof(r, a) - 0.25, 0x8a8070);
      }
      R = sv;
    }
    castle.push(tint(worldUV(box(14, 15, 12, { x: cx, y: base, z: cz }), 3.6), 0x9a8e7e, { aoBottom: base, aoTop: base + 6 }));
    // buttresses (stepped offsets), machicolation band and arrow loops on the keep
    for (const bx of [-4.6, 0, 4.6]) {
      castle.push(tint(worldUV(box(1.2, 13.5, 0.9, { x: cx + bx, y: base, z: cz + 6.3 }), 3.6), 0x928676, { aoBottom: base, aoTop: base + 6 }));
      castle.push(tint(worldUV(box(1.4, 3.2, 1.4, { x: cx + bx, y: base, z: cz + 6.4 }), 3.6), 0x8a7e6e, { aoBottom: base, aoTop: base + 3 }));
    }
    fine.push(tint(worldUV(box(14.8, 0.9, 12.8, { x: cx, y: base + 14.1, z: cz }), 2), 0x958a7c));
    // corbels under the oversailing parapet, all four faces
    for (const [len, fx, fz, ry] of [[14, 0, 6.3, 0], [14, 0, -6.3, 0], [12, 7.3, 0, Math.PI / 2], [12, -7.3, 0, Math.PI / 2]]) {
      const nC = Math.round(len / 0.9);
      for (let i = 0; i < nC; i++) {
        const f = -len / 2 + (i + 0.5) * (len / nC);
        const ox = ry ? fx : f, oz = ry ? f : fz;
        for (let k = 0; k < 2; k++) fine.push(tint(worldUV(box(0.3, 0.3, 0.3 + k * 0.25, { x: cx + ox + (ry ? Math.sign(fx) * k * 0.12 : 0), y: base + 13.3 + k * 0.3, z: cz + oz + (ry ? 0 : Math.sign(fz) * k * 0.12), ry }), 2), 0x968a7a));
      }
    }
    for (let k = 0; k < 4; k++) addWin(new THREE.Matrix4().setPosition(cx, base, cz), -6.9 + k * 4.6, 9.5, 6.06, 0, 0.35, 1.1, 0.8);
    for (let k = 0; k < 6; k++) for (const yy of [4.2, 7.0, 11.4]) {
      if (Rw.chance(0.35)) continue;
      slits.push(tint(box(0.18, 1.0, 0.1, { x: cx - 5.8 + k * 2.3, y: base + yy, z: cz + 6.04 }), 0x060406));
      slits.push(tint(box(0.1, 1.0, 0.18, { x: cx + 7.04, y: base + yy, z: cz - 4.8 + k * 1.9 }), 0x060406));
    }
    crenel(cx - 7.3, cz + 6.3, cx + 7.3, cz + 6.3, base + 15, 0.6, 0x9a8e7e, castle);
    crenel(cx - 7.3, cz - 6.3, cx + 7.3, cz - 6.3, base + 15, 0.6, 0x9a8e7e, castle);
    crenel(cx + 7.3, cz - 6.3, cx + 7.3, cz + 6.3, base + 15, 0.6, 0x9a8e7e, castle);
    // a steep lead-and-slate roof behind the keep's parapet with two chimney stacks
    {
      const gr = gableRoof(11.4, 9.6, 5.2, { o: 0.1, t: 0.25 });
      const mm = new THREE.Matrix4().makeTranslation(cx, base + 15, cz);
      // the south slope burnt through in the sack: only a band of slates at the
      // eaves survives, the charred rafters standing open to the sky above it
      const meanZ = (g) => { const p = g.attributes.position; let m = 0; for (let i = 0; i < p.count; i++) m += p.getZ(i); return m / p.count; };
      for (const g0 of gr.roof) g0.applyMatrix4(mm);
      const south = meanZ(gr.roof[0]) > meanZ(gr.roof[1]) ? 0 : 1;
      slate.push(tint(gr.roof[1 - south], 0x5a6070));
      {
        const g = gr.roof[south];
        const p = g.attributes.position;
        const y0 = base + 15, rise = 5.2, cut = y0 + 1.5;
        const dzdy = (4.8 + 0.1) / rise; // the slope runs out toward +z as it falls
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          if (y > cut) { p.setZ(i, p.getZ(i) + (y - cut) * dzdy); p.setY(i, cut); }
        }
        g.computeVertexNormals();
        slate.push(sootify(tint(g, 0x4a505c), y0, y0 + 1.5));
        for (let k = 0; k < 11; k++) {
          if (Rw.chance(0.25)) continue;
          const rf = gableRoof(0.18, 9.6, 5.2, { o: 0.1, t: 0.18, ridge: false });
          for (const q of rf.roof) q.applyMatrix4(mm);
          const rr = rf.roof[meanZ(rf.roof[0]) > meanZ(rf.roof[1]) ? 0 : 1];
          rr.translate(-5.3 + k * 1.06, 0, 0);
          beams.push(tint(worldUV(rr, 1.5), 0x1a1210));
        }
        beams.push(tint(worldUV(box(11.4, 0.3, 0.3, { x: cx, y: base + 15 + 5.0, z: cz }), 1.5), 0x1a1210));
      }
      for (const g of gr.caps) slate.push(tint(g.applyMatrix4(mm), 0x3a3c44));
      for (const g of gr.gables) castle.push(tint(worldUV(g.applyMatrix4(mm), 3.6), 0x8a7e6e));
      for (const [chx, chz] of [[-3.6, -2.2], [2.8, 2.4]]) {
        castle.push(tint(worldUV(box(0.9, 4.6, 0.9, { x: cx + chx, y: base + 15, z: cz + chz }), 3.6), 0x857a6a));
        fine.push(tint(worldUV(box(1.15, 0.25, 1.15, { x: cx + chx, y: base + 19.6, z: cz + chz }), 2), 0x958a7c));
      }
    }
    // bartizans: little corbelled turrets hanging off the keep's corners
    for (const [bx2, bz2] of [[-7.2, 6.2], [7.2, 6.2], [7.2, -6.2], [-7.2, -6.2]]) {
      const ty = base + 12.6;
      fine.push(tint(worldUV(ni(new THREE.ConeGeometry(1.15, 1.6, 12, 1, true).rotateX(Math.PI).translate(cx + bx2, ty - 0.8, cz + bz2)), 2), 0x928676));
      castle.push(tint(worldUV(cylinder(1.1, 1.1, 3.0, 12, { x: cx + bx2, y: ty, z: cz + bz2 }), 3.6), 0x9a8e7e));
      slate.push(tint(worldUV(cone(1.4, R.range(2.6, 3.4), 12, { x: cx + bx2, y: ty + 3.0, z: cz + bz2 }), 2), R.pick(slateCols)));
    }
    for (const [dx, dz, roof, hh, extra] of [[-10, 8, 'cone', 19, { flag: true, hoard: true }], [10, 8, 'broken', 17.5, {}], [-10, -8, 'cone', 22, { flag: true }], [10, -8, 'flat', 20.5, { flag: true }]]) {
      tower(cx + dx, cz + dz, dx < 0 && dz < 0 ? 2.7 : 2.4, hh, { roof, base, list: castle, ...extra });
    }
    {
      // the front curtain is breached right of the gate: two runs, the broken
      // ends ragged, the fallen masonry spilled down the motte (see the mound)
      for (let i = 0; i < 8; i++) R.next(); // the stream the single run consumed
      const sv = R;
      R = prng(seed + 71);
      wallRun(cx - 18, cz + 14, cx + 8.5, cz + 14, 9, { base: GROUND + 5, list: castle });
      wallRun(cx + 13.8, cz + 14, cx + 18, cz + 14, 9, { base: GROUND + 5, list: castle });
      for (const [ex, dir] of [[8.5, 1], [13.8, -1]]) {
        const g = ruinWall(2.6, 8.4, 2.2, { breach: dir, openings: false, tops: [] });
        g.translate(cx + ex + dir * 1.3, GROUND + 5, cz + 14);
        castle.push(sootify(tint(worldUV(g, 3.6), 0x8e8272, { aoBottom: GROUND + 5, aoTop: GROUND + 8 }), GROUND + 5, GROUND + 14));
      }
      rubbleMound(cx + 11.2, cz + 14.5, 3.2, 2.2, GROUND + 4.6, 0x8a8070);
      R = sv;
    }
    wallRun(cx - 18, cz + 14, cx - 18, cz - 14, 9, { base: GROUND + 5, list: castle });
    wallRun(cx + 18, cz + 14, cx + 18, cz - 14, 9, { base: GROUND + 5, gaps: 0.4, list: castle });
    tower(cx - 18, cz + 14, 3.2, 13, { roof: 'flat', base: GROUND + 5, list: castle, flag: true });
    tower(cx + 18, cz + 14, 3.2, 11, { roof: 'broken', base: GROUND + 5, list: castle });
    // the gatehouse: twin half-drum towers flanking a dark arched passage in the curtain
    for (const sx of [-1, 1]) tower(cx + sx * 3.4, cz + 15.2, 2.2, 13.5, { roof: 'cone', base: GROUND + 5, list: castle, flag: sx < 0 });
    castle.push(tint(worldUV(box(5.0, 4.0, 2.4, { x: cx, y: GROUND + 5 + 9, z: cz + 15.2 }), 3.6), 0x928676));
    slits.push(tint(box(2.2, 3.8, 0.2, { x: cx, y: GROUND + 5, z: cz + 16.45 }), 0x080506));
    // a cobbled bailey inside the curtain, worn into grass at the margins
    {
      const g = new THREE.CircleGeometry(19.5, 48, 0, Math.PI * 2);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, GROUND + 4.03, cz);
      const pp = g.attributes.position;
      const cc = new Float32Array(pp.count * 3);
      for (let i = 0; i < pp.count; i++) {
        const dx = pp.getX(i) - cx, dz = pp.getZ(i) - cz;
        const rr = Math.hypot(dx, dz) / 19.5;
        const grass = THREE.MathUtils.smoothstep(rr + 0.25 * Math.sin(dx * 0.7) * Math.cos(dz * 0.6), 0.55, 0.95);
        const c = new THREE.Color(0x9a9288).lerp(new THREE.Color(0x4e5a2e), grass);
        cc.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      cobbles.push(worldUV(ni(g), 2.0));
    }
    fires.push(new THREE.Vector3(cx + 10, base + 19, cz + 8));
    // watch-fires along the curtain wall (warm points that pick out the battlements)
    for (const [dx, dz] of [[-18, 14], [-6, 14], [6, 14], [-18, 0]]) lamps.push(new THREE.Vector3(cx + dx, GROUND + 5 + 10.2, cz + dz + 0.6));
  }

  // ---- Temple of Tyr (dome) and the Council hall (New Phlan) ----------------
  const xform = (list, geos, mtx) => { for (const g of geos) list.push(g.applyMatrix4(mtx)); };
  {
    const tx = -42, tz = -96;
    walls.push(tint(worldUV(box(14, 11, 14, { x: tx, z: tz, y: GROUND }), 3), 0xa39684, { aoBottom: GROUND, aoTop: GROUND + 4 }));
    walls.push(tint(worldUV(box(14.8, 0.6, 14.8, { x: tx, z: tz, y: GROUND + 10.6 }), 2), 0xb5a792));
    // corner pinnacles
    for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
      walls.push(tint(worldUV(box(1.2, 2.2, 1.2, { x: tx + dx, z: tz + dz, y: GROUND + 11.2 }), 2), 0xa89a86));
      slate.push(tint(worldUV(pyramid(1.3, 1.6, { x: tx + dx, z: tz + dz, y: GROUND + 13.4 }), 1), 0x5f8a80));
    }
    const dm = dome({ r: 6.2, drumH: 2.8, ribs: 16 });
    const mt = new THREE.Matrix4().makeTranslation(tx, GROUND + 11.2, tz);
    xform(fine, dm.stone, mt);
    xform(slate, dm.roof, mt);
    xform(windows, dm.windows, mt);
    const m = new THREE.Matrix4().setPosition(tx, GROUND, tz);
    for (let i = 0; i < 4; i++) addWin(m, -4.5 + i * 3, 6, 7.05, 0, 0.8, 2.2, 1.0);
    // the council hall: a long civic hall with a pedimented portico on its plaza
    const hx = -20, hz = -60, hw = 18, hd = 9, hh = 9;
    hall.push(tint(worldUV(box(hw, hh, hd, { x: hx, y: GROUND, z: hz }), 2.6), 0xb0a28c, { aoBottom: GROUND, aoTop: GROUND + 4 }));
    // string courses + plinth
    fine.push(tint(worldUV(box(hw + 0.4, 0.9, hd + 0.4, { x: hx, y: GROUND, z: hz }), 2), 0x9a8c78));
    fine.push(tint(worldUV(box(hw + 0.3, 0.25, hd + 0.3, { x: hx, y: GROUND + 4.3, z: hz }), 2), 0xbcae98));
    fine.push(tint(worldUV(box(hw + 0.8, 0.7, hd + 0.8, { x: hx, y: GROUND + hh, z: hz }), 2), 0xc0b29c));
    // quoins: long-and-short dressed blocks up every corner, standing proud of the
    // walling; a second string course at the upper sill line; a moulded plinth cap
    for (const [qx, qz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      for (let k = 0, y = 0.9; y < hh - 0.4; k++) {
        const bh = 0.52;
        const long = k % 2 === 0;
        const g = box(long ? 0.95 : 0.55, bh - 0.04, 0.14, { x: hx + qx * (hw / 2 - (long ? 0.475 : 0.275) + 0.03), y: GROUND + y, z: hz + qz * (hd / 2 + 0.05) });
        fine.push(tint(worldUV(g, 1.2), new THREE.Color(0xc2b49c).multiplyScalar(0.92 + 0.12 * Rw.next())));
        const g2 = box(0.14, bh - 0.04, long ? 0.55 : 0.95, { x: hx + qx * (hw / 2 + 0.05), y: GROUND + y, z: hz + qz * (hd / 2 - (long ? 0.275 : 0.475) + 0.03) });
        fine.push(tint(worldUV(g2, 1.2), new THREE.Color(0xc2b49c).multiplyScalar(0.92 + 0.12 * Rw.next())));
        y += bh;
      }
    }
    fine.push(tint(worldUV(box(hw + 0.3, 0.18, hd + 0.3, { x: hx, y: GROUND + 7.75, z: hz }), 2), 0xbcae98));
    fine.push(tint(worldUV(box(hw + 0.5, 0.16, hd + 0.5, { x: hx, y: GROUND + 0.9, z: hz }), 2), 0xb0a28c));
    const hr = gableRoof(hw, hd + 0.8, 3.8, { o: 0.55, t: 0.3 });
    const rm = new THREE.Matrix4().makeTranslation(hx, GROUND + hh + 0.7, hz);
    for (const g of hr.roof) slate.push(tint(g.applyMatrix4(rm), 0x8c96b4));
    for (const g of hr.caps) fine.push(tint(g.applyMatrix4(rm), 0x8a8f9a));
    for (const g of hr.gables) hall.push(tint(worldUV(g.applyMatrix4(rm), 2.6), 0xb0a28c));
    const hm = new THREE.Matrix4().setPosition(hx, GROUND, hz);
    for (let f = 0; f < 2; f++) for (let i = 0; i < 8; i++) {
      if (f === 0 && (i >= 2 && i <= 5)) continue;
      const wx = hx - 7.7 + i * 2.2, wy = GROUND + 2.0 + f * 3.8, wz = hz + hd / 2;
      addWin(hm, -7.7 + i * 2.2, 2.0 + f * 3.8, hd / 2 + 0.04, 0, 0.8, 1.7, 0.62);
      // deep stone reveals (jambs, lintel with keystone, projecting sill) and a
      // stone mullion + transom standing proud of the leaded glass: the window
      // reads as a recess with a lit room behind, not a decal
      for (const sx of [-1, 1]) fine.push(tint(worldUV(box(0.16, 1.86, 0.32, { x: wx + sx * 0.48, y: wy - 0.93, z: wz + 0.12 }), 1), 0xc4b8a2));
      fine.push(tint(worldUV(box(1.18, 0.2, 0.34, { x: wx, y: wy + 0.86, z: wz + 0.12 }), 1), 0xc8bca6));
      fine.push(tint(worldUV(box(0.22, 0.3, 0.38, { x: wx, y: wy + 0.84, z: wz + 0.14 }), 1), 0xd0c4ae));
      fine.push(tint(worldUV(box(1.12, 0.12, 0.42, { x: wx, y: wy - 0.97, z: wz + 0.16 }), 1), 0xbcb09a));
      fine.push(tint(worldUV(box(0.07, 1.7, 0.1, { x: wx, y: wy - 0.85, z: wz + 0.09 }), 1), 0xa89c86));
      fine.push(tint(worldUV(box(0.8, 0.07, 0.1, { x: wx, y: wy + 0.2, z: wz + 0.09 }), 1), 0xa89c86));
    }
    // portico: steps, six fluted drum columns with capitals, entablature, pediment
    const pz = hz + hd / 2;
    for (let k = 0; k < 4; k++) fine.push(tint(worldUV(box(12.6 - k * 0.5, 0.26, 5.0 - k * 0.42, { x: hx, y: GROUND + k * 0.26, z: pz + 2.5 - k * 0.21 }), 1.5), 0xb5a792, { aoBottom: GROUND, aoTop: GROUND + 1.2 }));
    const colBase = GROUND + 1.04;
    for (let i = 0; i < 6; i++) {
      const cm = new THREE.Matrix4().makeTranslation(hx - 4.5 + i * 1.8, colBase, pz + 3.4);
      xform(fine, column({ h: 5.4, r: 0.36, flutes: 18, seed: 40 + i, color: 0xd6cab4, plinth: true }), cm);
    }
    fine.push(tint(worldUV(box(11.8, 0.7, 3.4, { x: hx, y: colBase + 5.4, z: pz + 2.2 }), 2), 0xc8bca6));
    fine.push(tint(worldUV(box(11.8, 0.62, 3.3, { x: hx, y: colBase + 6.1, z: pz + 2.2 }), 2), 0xb8ac96));
    fine.push(tint(worldUV(box(12.4, 0.24, 3.8, { x: hx, y: colBase + 6.72, z: pz + 2.2 }), 2), 0xd0c4ae));
    // pediment: a stone raking cornice that stops flush with the entablature (no
    // slate end face catching the sun), tympanum set back behind it
    const ped = gableRoof(3.6, 12.2, 2.0, { o: 0.05, t: 0.3, ridge: false });
    const pm = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(hx, colBase + 6.96, pz + 2.2);
    for (const g of ped.roof) fine.push(tint(worldUV(g.applyMatrix4(pm), 2), 0x9a8e7a));
    for (const g of ped.gables) fine.push(tint(worldUV(g.applyMatrix4(pm), 2), 0xb8ac96));
    // tympanum relief: the Council's sun in a laurel ring, carved and gilded —
    // a recessed dark field, a raised torus rim, a domed boss and sixteen rays
    const ry0 = colBase + 7.72, rz0 = pz + 4.02;
    const field = new THREE.CircleGeometry(0.74, 32);
    field.translate(hx, ry0, rz0);
    fine.push(tint(worldUV(ni(field), 1), 0x6a5e4c));
    const rim = new THREE.TorusGeometry(0.72, 0.07, 8, 40);
    rim.translate(hx, ry0, rz0 + 0.02);
    fine.push(tint(ni(rim), 0xd8b25a));
    const boss = new THREE.SphereGeometry(0.26, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    boss.rotateX(Math.PI / 2);
    boss.scale(1, 1, 0.5);
    boss.translate(hx, ry0, rz0);
    fine.push(tint(ni(boss), 0xe0bc64));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const len = k % 2 ? 0.2 : 0.3;
      const ray = new THREE.ConeGeometry(0.055, len, 4);
      ray.translate(0, 0.3 + len / 2, 0);
      ray.rotateZ(a);
      ray.scale(1, 1, 0.6);
      ray.translate(hx, ry0, rz0 + 0.03);
      fine.push(tint(ni(ray), 0xd8b25a));
    }
    // acroteria at the apex and corners
    fine.push(tint(worldUV(box(0.5, 0.6, 0.5, { x: hx, y: colBase + 8.95, z: pz + 3.8 }), 1), 0xc6baa4));
    for (const sx of [-1, 1]) fine.push(tint(worldUV(box(0.45, 0.45, 0.45, { x: hx + sx * 5.9, y: colBase + 6.96, z: pz + 3.8 }), 1), 0xc6baa4));
    addWin(hm, 0, 1.75, hd / 2 + 0.05, 0, 2.2, 3.1, 0.95); // open doors, warm light within
    lamps.push(new THREE.Vector3(hx - 2.2, GROUND + 3.4, pz + 3.9), new THREE.Vector3(hx + 2.2, GROUND + 3.4, pz + 3.9));
    // the portico lanterns those glows belong to: iron cages on chains from the soffit
    for (const lx of [-2.2, 2.2]) {
      const X = hx + lx, Y = GROUND + 3.4, Z = pz + 3.9;
      beams.push(tint(worldUV(cylinder(0.02, 0.02, 2.6, 4, { x: X, y: Y + 0.42, z: Z }), 1), 0x151210));
      beams.push(tint(worldUV(ni(new THREE.ConeGeometry(0.24, 0.26, 6).translate(X, Y + 0.38, Z)), 1), 0x1a1612));
      beams.push(tint(worldUV(cylinder(0.2, 0.2, 0.05, 6, { x: X, y: Y - 0.32, z: Z }), 1), 0x1a1612));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        beams.push(tint(worldUV(box(0.03, 0.56, 0.03, { x: X + Math.cos(a) * 0.15, y: Y - 0.3, z: Z + Math.sin(a) * 0.15 }), 1), 0x1a1612));
      }
      const glass = new THREE.CylinderGeometry(0.13, 0.13, 0.5, 4, 1, true).rotateY(Math.PI / 4).translate(X, Y - 0.03, Z);
      windows.push(tint(ni(glass), new THREE.Color(0xffa040).multiplyScalar(1.4)));
    }
    // braziers on the plaza flank the steps (set wide, clear of the camera's path)
    // wrought-iron stands: three splayed legs with scrolled feet, a twisted stem
    // with forged collars, and a riveted bowl with a rolled lip, embers glowing in it
    for (const lx of [-7.2, 7.2]) {
      const X = hx + lx, Z = pz + 6.2;
      const ir = (g, c = 0x2a2624) => iron.push(tint(ni(g), c));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        const leg = new THREE.CylinderGeometry(0.035, 0.05, 1.05, 6);
        leg.translate(0, 0.52, 0);
        leg.rotateZ(0.32);
        leg.rotateY(-a);
        leg.translate(X + Math.cos(a) * 0.34, GROUND, Z + Math.sin(a) * 0.34);
        // splay outward: lean the leg's foot away from the stem
        ir(leg);
        const curl = new THREE.TorusGeometry(0.08, 0.02, 5, 12, Math.PI * 1.4);
        curl.rotateY(-a + Math.PI / 2);
        curl.translate(X + Math.cos(a) * 0.38, GROUND + 0.08, Z + Math.sin(a) * 0.38);
        ir(curl);
      }
      ir(new THREE.CylinderGeometry(0.045, 0.06, 1.0, 8).translate(X, GROUND + 0.6, Z));
      for (const cy of [0.35, 0.72, 1.02]) ir(new THREE.TorusGeometry(0.075, 0.025, 5, 12).rotateX(Math.PI / 2).translate(X, GROUND + cy, Z));
      const bowl = new THREE.LatheGeometry([[0.05, 0], [0.26, 0.04], [0.4, 0.16], [0.46, 0.3], [0.44, 0.33], [0.36, 0.2], [0.04, 0.1]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
      bowl.translate(X, GROUND + 1.08, Z);
      ir(bowl, 0x3a3230);
      ir(new THREE.TorusGeometry(0.45, 0.03, 5, 24).rotateX(Math.PI / 2).translate(X, GROUND + 1.39, Z), 0x3a3230);
      // the coal bed: glowing seams in the bowl
      windows.push(tint(ni(new THREE.CircleGeometry(0.38, 14).rotateX(-Math.PI / 2).translate(X, GROUND + 1.33, Z)), new THREE.Color(0xff6a20).multiplyScalar(1.1)));
      lamps.push(new THREE.Vector3(X, GROUND + 1.62, Z));
      braziers.push(new THREE.Vector3(X, GROUND + 1.36, Z));
    }
    // warm light spilled on the steps and setts: the open doors throw a long
    // pool down the stairs, each lit ground-floor window a soft patch, each
    // brazier a ring of firelight on the stones
    {
      const pools = [];
      const pool = (x, z, sx, sz, y = GROUND + 0.03, a = 1) => {
        const g = new THREE.PlaneGeometry(sx, sz);
        g.rotateX(-Math.PI / 2);
        g.translate(x, y, z);
        const c = new THREE.Color(0xffa050).multiplyScalar(a);
        tint(g, c);
        pools.push(g);
      };
      for (let k = 0; k < 4; k++) pool(hx, pz + 2.5 - k * 0.21 + 0.6, 4.2 - k * 0.3, 2.2, GROUND + (k + 1) * 0.26 + 0.01, 0.55);
      pool(hx, pz + 7.4, 7.5, 6.5, GROUND + 0.03, 0.85);
      for (const lx of [-7.2, 7.2]) pool(hx + lx, pz + 6.2, 6.4, 6.4, GROUND + 0.035, 0.6);
      for (let i = 0; i < 8; i++) if (i < 2 || i > 5) pool(hx - 7.7 + i * 2.2, pz + 1.1, 2.0, 2.0, GROUND + 0.03, 0.4);
      const pm = new THREE.MeshBasicMaterial({ map: getGlowTexture(), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
      disposables.push(pm);
      const pmesh = new THREE.Mesh(merge(pools), pm);
      pmesh.renderOrder = 2;
      pmesh.name = 'hallPools';
      group.add(pmesh);
    }
    banners.push([hx - 3.6, pz + 3.3], [hx + 3.6, pz + 3.3]);
    tower(hx + 10.5, hz, 2.2, 19, { roof: 'cone', lit: 1 });
    // townsfolk gathered at the steps to read the proclamation, a guard at the
    // door: sculpted figures (faces, hands, clothes) from the miniature rig
    // [x, z, facing, character, scale]: a knot of readers at the steps, two
    // turned to talk across the group, a pair half-facing the street (and the
    // camera), a dwarf and a lanky sellsword so the heights are never one row
    const toCam = -0.72; // facing back along the street toward the lens
    const folk = [
      [-3.0, 5.6, Math.PI - 0.15, { gender: 'male', classSpec: 'fighter', look: { seed: 71, head: 1, body: 0, cloth: 2, hair: 3 } }, 1.06],
      [-1.9, 6.1, Math.PI + 0.25, { gender: 'female', classSpec: 'cleric', look: { seed: 72, head: 4, body: 5, cloth: 1, hair: 4 } }, 0.94],
      [-0.7, 6.0, -Math.PI / 2 + 0.3, { gender: 'male', classSpec: 'thief', look: { seed: 73, head: 3, body: 2, cloth: 4, hair: 0 } }, 1.0],
      [0.5, 6.3, Math.PI / 2 + 0.5, { gender: 'male', classSpec: 'magicUser', look: { seed: 74, head: 6, body: 4, cloth: 6, hair: 8 } }, 0.98],
      [1.9, 7.4, toCam + 0.35, { gender: 'female', classSpec: 'thief', look: { seed: 75, head: 5, body: 3, cloth: 3, hair: 2 } }, 0.92],
      [-4.4, 7.0, toCam - 0.1, { gender: 'male', classSpec: 'cleric', look: { seed: 76, head: 2, body: 7, cloth: 5, hair: 7 } }, 1.02],
      [-2.4, 7.3, Math.PI - 0.6, { race: 'dwarf', gender: 'male', classSpec: 'fighter', look: { seed: 78, head: 2, body: 1, cloth: 7, hair: 5 } }, 1.0],
      [3.1, 6.0, Math.PI + 0.6, { gender: 'male', classSpec: 'fighter', look: { seed: 79, head: 7, body: 6, cloth: 0, hair: 6 } }, 1.1],
    ];
    // built on demand (only the City Hall shot ever sees them)
    buildCrowd = () => {
      // varied, asymmetric stances: some talk to a neighbour with a gesture, some
      // hold their hands out to the brazier, the rest read; each leans a little
      const mods = ['talkL', null, 'talkR', 'talkL', 'warm', 'talkR', null, 'warm'];
      folk.forEach(([fx, fz, ry, ch, sc], i) => {
        const f = buildMiniature({ race: 'human', ...ch }, { pose: 'stand', mod: mods[i] ?? undefined, base: false, gear: false, quality: 0.0108, faceSize: 256, noWeapon: true, noShield: true, rayHead: true, headGain: 0.75, fog: true });
        // backlit by the open doors: dim the front, a warm lit outline
        matteFigure(f, { dim: 0.42, rim: 0x6a3410 });
        f.position.set(hx + fx, GROUND, pz + fz);
        f.rotation.y = ry;
        f.rotation.z = (i % 2 ? 1 : -1) * 0.03;
        f.scale.setScalar(sc ?? 1);
        group.add(f);
        figures.push(f);
        const sh = contactShadow(0.45, 0.36);
        sh.position.set(hx + fx, GROUND + 0.04, pz + fz);
        group.add(sh);
      });
      // the door guard (robed in the Council's red) on the top step, facing the plaza
      const guard = buildMiniature({ race: 'human', gender: 'male', classSpec: 'fighter', look: { seed: 77, head: 0, body: 0, cloth: 0, hair: 1 } }, { pose: 'guard', base: false, gear: true, quality: 0.0108, faceSize: 256, rayHead: true, headGain: 0.75, fog: true });
      matteFigure(guard, { dim: 0.6, rim: 0x502a10 });
      guard.position.set(hx - 1.7, GROUND + 1.04, pz + 2.3);
      guard.rotation.y = 0.2;
      group.add(guard);
      figures.push(guard);
    };
  }

  // ---- harbour: quays, lighthouse ------------------------------------------
  walls.push(tint(worldUV(box(420, 1.6, 6, { x: 0, y: GROUND - 1.4, z: -156 }), 3), 0x6d655b));
  for (const px of [-70, -30, 20, 64]) walls.push(tint(worldUV(box(3, 1.2, 22, { x: px, y: GROUND - 1.4, z: -168 }), 3), 0x6a5a48));
  tower(-96, -170, 2.6, 18, { roof: 'flat', base: GROUND - 1 });
  const lighthouse = new THREE.Vector3(-96, GROUND - 1 + 19.5, -170);

  // ---- rubble fields in the old city's empty lots ---------------------------
  {
    const sv = R;
    R = prng(seed + 901); // rubbleMound / box draws: never shift the layout stream
    for (const [lx, lz] of lots) {
      const col = R.pick(stoneCols);
      const n = R.int(2, 4);
      for (let k = 0; k < n; k++) rubbleMound(lx + R.range(-2.6, 2.6), lz + R.range(-2.4, 2.4), R.range(1.1, 2.2), R.range(0.35, 1.0), GROUND, col);
      // a few charred beams and a broken wall stub sticking out of the heap
      for (let k = 0; k < R.int(1, 3); k++) {
        const g = box(0.2, 0.22, R.range(1.8, 3.6), { x: lx + R.range(-2, 2), y: GROUND + R.range(0.1, 0.4), z: lz + R.range(-2, 2), ry: R.range(0, 3), rx: R.range(-0.25, 0.25) });
        beams.push(tint(worldUV(g, 1.5), R.chance(0.5) ? 0x1c1410 : 0x2e2218));
      }
      if (R.chance(0.45)) {
        const wg = ruinWall(R.range(2.5, 4.5), R.range(1.0, 2.4), 0.7, { openings: false });
        wg.rotateY(R.range(0, Math.PI));
        wg.translate(lx + R.range(-2, 2), GROUND, lz + R.range(-2, 2));
        rubble.push(sootify(tint(worldUV(wg, 2.2), new THREE.Color(col).multiplyScalar(0.75), { aoBottom: GROUND, aoTop: GROUND + 1.5 }), GROUND, GROUND + 2.4));
      }
    }
    R = sv;
  }

  // smouldering fires in the shells nearest the Old City aerial: warm pools of
  // light on the ash and smoke threads that layer the depth (see the ground glow)
  {
    let n = 0;
    const cand = [...lots.map(([x, z]) => ({ x, z, lot: true })), ...foot.filter((f) => f.ruined)];
    for (const f of cand) {
      if (n >= 7 || f.x < 22 || f.x > 112 || f.z > -58 || f.z < -106) continue;
      if (Math.abs(Math.sin(f.x * 12.9898 + f.z * 78.233) * 43758.5453) % 1 > (f.lot ? 0.85 : 0.3)) continue;
      fires.push(new THREE.Vector3(f.x, GROUND + 0.9, f.z));
      n++;
    }
  }

  // ---- ground --------------------------------------------------------------
  // One terrain for the whole hill-foot, flat and paved in New Phlan and
  // undulating in the dead quarter (rubble lots heaped up, the old lanes worn
  // into hollows). Its shader reads a ground mask rasterised from the layout:
  // contact AO round every footprint, the old street grid (setts half-buried
  // in ash and weeds), scorched earth round the fires and burnt houses, and
  // the rubble lots; weeds grow along wall feet and in the lots.
  const GX0 = -230, GX1 = 230, GZ0 = 0, GZ1 = -160, MPX = 2; // 0.5 m per mask texel
  const MW = (GX1 - GX0) * MPX, MH = (GZ0 - GZ1) * MPX;
  const hsh = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  const vn = (x, z) => {
    const i = Math.floor(x), j = Math.floor(z);
    let fx = x - i, fz = z - j;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = hsh(i, j), b = hsh(i + 1, j), c = hsh(i, j + 1), d = hsh(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  const maskData = new Uint8Array(MW * MH * 4);
  {
    const mk = () => { const c = document.createElement('canvas'); c.width = MW; c.height = MH; return c; };
    const toPx = (x, z) => [(x - GX0) * MPX, (GZ0 - z) * MPX];
    const drawFoot = (ctx, f, grow = 0) => {
      const [px, py] = toPx(f.x, f.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(f.ry);
      ctx.fillRect(-(f.w / 2 + grow) * MPX, -(f.d / 2 + grow) * MPX, (f.w + 2 * grow) * MPX, (f.d + 2 * grow) * MPX);
      ctx.restore();
    };
    const blob = (ctx, x, z, r, a = 1) => {
      const [px, py] = toPx(x, z);
      const gr = ctx.createRadialGradient(px, py, 0, px, py, r * MPX);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(px - r * MPX, py - r * MPX, r * MPX * 2, r * MPX * 2);
    };
    // (canvas filters blur every draw call separately: draw sharp into a scratch
    // layer, then composite that layer through one blur)
    const soft = (ctx, px, draw) => {
      const tmp = mk(), tx = tmp.getContext('2d');
      draw(tx);
      ctx.filter = `blur(${px}px)`;
      ctx.drawImage(tmp, 0, 0);
      ctx.filter = 'none';
    };
    // R: contact AO (white = open ground)
    const ao = mk(), ax = ao.getContext('2d');
    ax.fillStyle = '#fff';
    ax.fillRect(0, 0, MW, MH);
    soft(ax, 5, (c) => { c.fillStyle = 'rgba(0,0,0,0.6)'; for (const f of foot) drawFoot(c, f, 0.6); });
    soft(ax, 1.5, (c) => { c.fillStyle = 'rgba(0,0,0,0.55)'; for (const f of foot) drawFoot(c, f, 0.08); });
    soft(ax, 10, (c) => {
      // the castle mound and its curtain throw a broad skirt of shade
      const [px, py] = toPx(55, -128);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.beginPath();
      c.ellipse(px, py, 33 * MPX, 31 * MPX, 0, 0, Math.PI * 2);
      c.fill();
    });
    // G: the old street grid (lanes between the block rows, cross lanes, the avenue)
    const st = mk(), sx = st.getContext('2d');
    sx.fillStyle = '#000';
    sx.fillRect(0, 0, MW, MH);
    soft(sx, 1.5, (c) => {
      c.strokeStyle = '#fff';
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const lane = (pts, wdt) => {
        c.lineWidth = wdt * MPX;
        c.beginPath();
        pts.forEach(([x, z], i) => { const [px, py] = toPx(x, z); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
        c.stroke();
      };
      for (let gz = 0; gz < 14; gz++) {
        const z0 = -26 - (gz + 0.5) * 8.6;
        const pts = [];
        for (let x = 7; x <= 180; x += 6) pts.push([x, z0 + Math.sin(x * 0.07 + gz) * 0.9 + (vn(x * 0.2, gz * 3.1) - 0.5) * 1.2]);
        lane(pts, 2.4 + (gz % 3 === 0 ? 1.2 : 0));
      }
      for (let gx = 1; gx <= 19; gx += 2) {
        const x0 = gx * 8.8 + 4.4;
        const pts = [];
        for (let z = -28; z >= -152; z -= 6) pts.push([x0 + Math.sin(z * 0.09 + gx) * 1.1, z]);
        lane(pts, 2.2);
      }
      lane([[0, -24], [0, -156]], 11);
      lane([[-200, -150], [200, -150]], 7);
      // no lanes under the castle mound
      const [mx, my] = toPx(55, -128);
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      c.arc(mx, my, 34 * MPX, 0, Math.PI * 2);
      c.fill();
      c.globalCompositeOperation = 'source-over';
    });
    // B: scorched earth (fires, burnt houses)
    const sc = mk(), cx2 = sc.getContext('2d');
    cx2.fillStyle = '#000';
    cx2.fillRect(0, 0, MW, MH);
    for (const p of fires) blob(cx2, p.x, p.z, 9, 0.95);
    for (const f of foot) if (f.burnt || (f.ruined && hsh(f.x, f.z) < 0.45)) blob(cx2, f.x, f.z, Math.max(f.w, f.d) * 0.95, 0.75);
    // A: rubble lots
    const lt = mk(), lx2 = lt.getContext('2d');
    lx2.fillStyle = '#000';
    lx2.fillRect(0, 0, MW, MH);
    for (const [x, z] of lots) blob(lx2, x, z, 5.2, 1);
    for (const f of foot) if (f.ruined) blob(lx2, f.x, f.z, Math.max(f.w, f.d) * 0.85, 0.55);
    const A = ax.getImageData(0, 0, MW, MH).data, B = sx.getImageData(0, 0, MW, MH).data;
    const Cd = cx2.getImageData(0, 0, MW, MH).data, D = lx2.getImageData(0, 0, MW, MH).data;
    for (let i = 0; i < MW * MH; i++) {
      maskData[i * 4] = A[i * 4];
      maskData[i * 4 + 1] = B[i * 4];
      maskData[i * 4 + 2] = Cd[i * 4];
      maskData[i * 4 + 3] = D[i * 4];
    }
  }
  const maskAt = (x, z, ch) => {
    const px = Math.min(MW - 1, Math.max(0, Math.round((x - GX0) * MPX)));
    const py = Math.min(MH - 1, Math.max(0, Math.round((GZ0 - z) * MPX)));
    return maskData[(py * MW + px) * 4 + ch] / 255;
  };
  const groundH = (x, z) => {
    const old = THREE.MathUtils.smoothstep(x, 5, 16) * THREE.MathUtils.smoothstep(z, -147, -140) * THREE.MathUtils.smoothstep(z, -22, -30);
    if (old <= 0) return 0;
    let y = 0.22 * vn(x * 0.11, z * 0.11) + 0.1 * vn(x * 0.45 + 7, z * 0.45);
    y += maskAt(x, z, 3) * (0.55 + 0.45 * vn(x * 0.7, z * 0.7)) * 0.75;
    y *= 1 - maskAt(x, z, 1) * 0.8;
    return y * old;
  };
  const maskTex = new THREE.DataTexture(maskData, MW, MH, THREE.RGBAFormat);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.needsUpdate = true;
  disposables.push(maskTex);
  {
    const g = new THREE.PlaneGeometry(GX1 - GX0, GZ0 - GZ1, 230, 80);
    g.rotateX(-Math.PI / 2);
    g.translate((GX0 + GX1) / 2, GROUND, (GZ0 + GZ1) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, GROUND + groundH(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    ground.push(tint(worldUV(ni(g), 4.5), 0x4e443a));
    const lay = (w, d, x, z, c = 0x8a8278) => {
      const q = new THREE.PlaneGeometry(w, d, 1, 1);
      q.rotateX(-Math.PI / 2);
      q.translate(x, GROUND + 0.03, z);
      cobbles.push(tint(worldUV(ni(q), 2.6), c));
    };
    lay(11, 128, 0, -92);
    lay(36, 34, -20, -50, 0x9a9288);
    lay(160, 6, -80, -40);
  }
  // weeds: tufts of grass and dock along the wall feet, in the lanes' verges
  // and over the rubble lots of the dead quarter (where the camera comes close)
  {
    const Rg = prng(seed + 333);
    const tufts = [];
    const cols = [0x4a5222, 0x5e5a26, 0x6e6430, 0x3e4a1e, 0x7a6a3a];
    for (let k = 0; k < 5200 && tufts.length < 1700; k++) {
      const x = Rg.range(12, 112), z = Rg.range(-44, -124);
      const ao = maskAt(x, z, 0), stv = maskAt(x, z, 1), lot = maskAt(x, z, 3), sct = maskAt(x, z, 2);
      if (ao < 0.3) continue; // under a building
      const want = (ao < 0.9 ? 0.55 : 0.1) + lot * 0.5 - stv * 0.5 - sct * 0.35 + (vn(x * 0.3, z * 0.3) - 0.5) * 0.6;
      if (Rg.next() > want) continue;
      const y = GROUND + groundH(x, z);
      const c = new THREE.Color(Rg.pick(cols)).multiplyScalar(Rg.range(0.7, 1.15));
      const nb = Rg.int(6, 11);
      const hgt = Rg.range(0.4, 1.1);
      const pos = [];
      for (let b = 0; b < nb; b++) {
        const a = Rg.range(0, Math.PI * 2), lean = Rg.range(0.1, 0.5);
        const sp = Rg.range(0.04, 0.35), ba = Rg.range(0, Math.PI * 2);
        const bx = x + Math.cos(ba) * sp, bz = z + Math.sin(ba) * sp;
        const hh = hgt * Rg.range(0.6, 1.1), wd = Rg.range(0.04, 0.08);
        const px = -Math.sin(a) * wd, pz = Math.cos(a) * wd;
        pos.push(bx - px, y, bz - pz, bx + px, y, bz + pz, bx + Math.cos(a) * lean * hh, y + hh, bz + Math.sin(a) * lean * hh);
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const nrm = new Float32Array(pos.length);
      for (let q = 0; q < nrm.length; q += 3) { nrm[q + 1] = 1; }
      tg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
      const tc = new Float32Array(pos.length);
      for (let q = 0; q < pos.length / 3; q++) {
        const tip = q % 3 === 2 ? 1.25 : 0.55;
        tc[q * 3] = c.r * tip; tc[q * 3 + 1] = c.g * tip; tc[q * 3 + 2] = c.b * tip;
      }
      tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      tufts.push(tg);
    }
    weedGeo.push(...tufts);
  }

  // ---- meshes --------------------------------------------------------------
  const texMat = (name, extra = {}) => {
    const t = getTextureSet(name);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, vertexColors: true, roughness: 1, ...extra });
  };
  const rimU = { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uRimColor: { value: new THREE.Color(1.0, 0.55, 0.28) } };
  const wallMat = addRimLight(texMat('hd2_ashlar'), rimU, 1, { weather: 1, courses: 0.22 });
  // the castle gets its own, brighter rim and a touch of warm self-light so it
  // separates from the town in the dusk haze
  const castleMat = addRimLight(texMat('hd2_ashlar', { emissive: 0x1a0c06 }), rimU, 2.2, { weather: 1.4, ground: -10, soot: 1.1, courses: 0.3 });
  const hallMat = addRimLight(texMat('hd2_ashlar'), rimU, 1, { weather: 1.0 });
  const plasterMat = addRimLight(texMat('hd2_plaster', { color: 0xd8ccbc }), rimU, 0.9, { weather: 0.65, soot: 0.3, flat: 0.8 });
  const rubbleMat = addRimLight(texMat('hd2_ruin'), rimU, 1, { weather: 0.8, soot: 0.6 });
  const groundMat = texMat('hd_mud');
  const FIRE_N = 16;
  const fireVec = Array.from({ length: FIRE_N }, (_, i) => {
    const p = fires[i];
    return p && p.y < GROUND + 2 ? new THREE.Vector4(p.x, p.y, p.z, 0.22) : new THREE.Vector4(0, -999, 0, 0);
  });
  {
    const cob = getTextureSet('hd_cobble');
    groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.uGMask = { value: maskTex };
      sh.uniforms.uCob = { value: cob.map };
      sh.uniforms.uFires = { value: fireVec };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vGW; uniform sampler2D uGMask; uniform sampler2D uCob; uniform vec4 uFires[${FIRE_N}];
          ${NOISE}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 w = vGW.xz;
            vec4 M = texture2D(uGMask, vec2((w.x + 230.0) / 460.0, -w.y / 160.0));
            float n1 = vnoise(w * 0.33), n2 = vnoise(w * 1.6 + 3.0), n3 = vnoise(w * 6.5 + 9.0);
            float old = smoothstep(4.0, 14.0, w.x);
            vec3 c = diffuseColor.rgb * (0.78 + 0.38 * n1) * (0.92 + 0.16 * n3);
            // the old lanes: setts showing through drifts of ash and dust
            float street = smoothstep(0.3, 0.75, M.g);
            float bare = street * smoothstep(0.35, 0.62, n2 * 0.7 + n1 * 0.5);
            vec3 cob = texture2D(uCob, w / 2.6).rgb * vec3(0.92, 0.9, 0.88);
            c = mix(c, c * 1.12 + vec3(0.035, 0.03, 0.022), street * 0.7 * old);
            c = mix(c, cob, bare * old);
            // rubble lots: grey stone chips and mortar dust
            float chips = M.a * smoothstep(0.42, 0.68, n3 + n2 * 0.25);
            c = mix(c, vec3(0.34, 0.32, 0.3) * (0.55 + 0.9 * n3), chips * 0.8 * old);
            // weeds: along the wall feet, in the lots, never in the trodden lanes
            float foot = smoothstep(0.98, 0.7, M.r) * smoothstep(0.25, 0.55, M.r);
            float weeds = smoothstep(0.6, 0.8, n1 * 0.6 + n2 * 0.45 + foot * 0.4 + M.a * 0.25 - M.g * 0.7 - M.b * 0.45);
            vec3 grass = mix(vec3(0.13, 0.16, 0.05), vec3(0.3, 0.27, 0.1), n3);
            c = mix(c, grass, weeds * 0.9 * old);
            // scorched earth: black char with grey ash drifts
            float sc = M.b * smoothstep(0.25, 0.6, n1 + 0.35 * n2);
            c = mix(c, mix(vec3(0.03, 0.027, 0.025), vec3(0.18, 0.17, 0.16), n3 * n2), sc * 0.88 * old);
            // contact shadow and ambient occlusion round every building
            c *= mix(0.28, 1.0, M.r);
            diffuseColor.rgb = c;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // firelight pooling on the ash round each burning shell
            for (int i = 0; i < ${FIRE_N}; i++) {
              vec4 F = uFires[i];
              float d = length(vGW.xz - F.xz);
              totalEmissiveRadiance += vec3(1.0, 0.42, 0.12) * F.w * exp(-d * 0.42) * (0.75 + 0.25 * vnoise(vGW.xz * 2.0));
            }
          }`);
    };
    groundMat.customProgramCacheKey = () => 'cityGround';
  }
  const charredMat = addRimLight(texMat('hd2_plaster', { color: 0xb8ac9c }), rimU, 0.7, { weather: 1.0, soot: 1.0, flat: 0.55, flake: 0.7 });
  const weedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const moundMat = texMat('hd_mud');
  moundMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMW;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // break the vertex colours up: tussocks, bare patches, stones in the turf
          float n1 = vnoise(vMW.xz * 0.6), n2 = vnoise(vMW.xz * 2.7 + 4.0), n3 = vnoise(vMW.xz * 9.0);
          diffuseColor.rgb *= 0.72 + 0.4 * n1 + 0.22 * (n2 - 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.34, 0.31) * (0.7 + 0.6 * n3), smoothstep(0.78, 0.86, n2 * 0.7 + n3 * 0.35) * 0.8);
        }`);
  };
  moundMat.customProgramCacheKey = () => 'cityMound';
  const cobbleMat = texMat('hd_cobble', { polygonOffset: true, polygonOffsetFactor: -1 });
  const roofMat = addRimLight(texMat('hd_roof_clay'), rimU, 1.2);
  const slateMat = addRimLight(texMat('hd_roof_slate', { metalness: 0.05 }), rimU, 1.2);
  const shakeMat = addRimLight(texMat('hd_roof_shake'), rimU, 1.2);
  const beamMat = addRimLight(texMat('hd_beam_dark'), rimU, 0.8);
  const fineMat = addRimLight(texMat('hd_limestone'), rimU, 1);
  const peopleMat = addRimLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), rimU, 1.4);
  disposables.push(charredMat, weedMat, moundMat, wallMat, castleMat, hallMat, plasterMat, rubbleMat, groundMat, cobbleMat, roofMat, slateMat, shakeMat, beamMat, fineMat, peopleMat);
  const solid = []; // opaque architecture that can join a shot's shadow pass
  const addMesh = (list, mat, shadow = false) => {
    if (!list.length) return null;
    const g = merge(list);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = shadow;
    group.add(mesh);
    disposables.push(g);
    if (mat.isMeshStandardMaterial) solid.push(mesh);
    return mesh;
  };
  addMesh(walls, wallMat);
  addMesh(castle, castleMat);
  addMesh(hall, hallMat);
  addMesh(plaster, plasterMat);
  addMesh(charred, charredMat);
  addMesh(moundGeo, moundMat);
  addMesh(weedGeo, weedMat);
  addMesh(rubble, rubbleMat);
  addMesh(ground, groundMat);
  addMesh(cobbles, cobbleMat);
  addMesh(roofs, roofMat);
  addMesh(slate, slateMat);
  addMesh(shake, shakeMat);
  addMesh(beams, beamMat);
  addMesh(fine, fineMat);
  addMesh(people, peopleMat);
  {
    const ironMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.8 });
    disposables.push(ironMat);
    addMesh(iron, ironMat);
  }
  const slitMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  disposables.push(slitMat);
  addMesh(slits, slitMat);
  const flagMat = addRimLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x1a0806 }), rimU, 1.6);
  disposables.push(flagMat);
  addMesh(flags, flagMat);
  // lit windows: leaded panes (mullions + transom), brighter at the sill like firelight within
  const winMat = new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: { uGain: { value: new THREE.Color(1.55, 1.0, 0.56) } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vCol; void main(){ vUv = uv; vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGain; varying vec2 vUv; varying vec3 vCol;
      void main(){
        // leaded lights: 2x4 panes, mullion + transom thicker than the cames
        vec2 g = vUv * vec2(2.0, 4.0);
        vec2 f = abs(fract(g) - 0.5);
        float cames = smoothstep(0.40, 0.46, max(f.x, f.y));
        float mull = 1.0 - smoothstep(0.035, 0.06, abs(vUv.x - 0.5));
        float trans = 1.0 - smoothstep(0.03, 0.05, abs(vUv.y - 0.62));
        float frame = smoothstep(0.86, 0.94, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
        // interior: warm hearth glow low and centred, falling to dim corners; a hint of a ceiling beam
        float glow = exp(-pow((vUv.x - 0.5) * 1.6, 2.0) - pow((vUv.y - 0.25) * 1.3, 2.0));
        float beam = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.05, abs(vUv.y - 0.86)));
        vec3 c = vCol * uGain * (0.35 + 0.8 * glow) * beam;
        float lead = max(max(cames * 0.7, mull), max(trans, frame));
        c *= 1.0 - lead * 0.88;
        gl_FragColor = vec4(min(c, vec3(1.25, 0.9, 0.6)), 1.0);
      }`,
  });
  disposables.push(winMat);
  addMesh(windows, winMat);
  // classic 1988 fills (see setClassic): unlit, fog-free flat EGA colours
  const classicBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.0, 0.0, 0.42), fog: false });
  const classicWin = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 0.3), fog: false });
  disposables.push(classicBlue, classicWin);

  // ---- fires, smoke, glow ---------------------------------------------------
  fires.push(lighthouse);
  const glowMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xff8a3a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  disposables.push(glowMat);
  const glows = [];
  fires.forEach((p, i) => {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(p);
    s.scale.setScalar(i === fires.length - 1 ? 6 : R.range(3.5, 5));
    s.userData.base = s.scale.x;
    s.userData.seed = i * 1.7;
    group.add(s);
    glows.push(s);
  });
  const lampMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  disposables.push(lampMat);
  lamps.forEach((p, i) => {
    const s = new THREE.Sprite(lampMat);
    s.position.copy(p);
    s.scale.setScalar(0.5);
    s.userData.base = 0.5;
    s.userData.seed = 10 + i;
    group.add(s);
    glows.push(s);
  });
  if (banners.length) {
    // the city's banners: the painted device of New Phlan on folded red cloth
    // (deep vertical pleats, a swallowtail cut, a gilt pole), hung between columns
    const bg = [];
    const poles = [];
    for (const [bx, bz] of banners) {
      const g = new THREE.PlaneGeometry(1.15, 3.7, 14, 16);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k);
        const hang = (1.85 - y) / 3.7; // 0 at the pole, 1 at the hem
        p.setZ(k, Math.sin(x * 10.5 + 0.6) * (0.05 + 0.07 * hang) + Math.sin(y * 1.3 + bx) * 0.04 * hang);
        // swallowtail: the hem's centre is cut up into a V
        if (y < -1.5) p.setY(k, y + Math.max(0, 0.55 - Math.abs(x) * 0.95) * (-1.5 - y) / 0.35 * 0.55);
      }
      g.computeVertexNormals();
      g.translate(bx, GROUND + 4.1, bz);
      bg.push(g);
      poles.push(tint(ni(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8).rotateZ(Math.PI / 2).translate(bx, GROUND + 6.0, bz)), 0xd0a040));
      for (const ex of [-0.75, 0.75]) poles.push(tint(ni(new THREE.SphereGeometry(0.06, 8, 6).translate(bx + ex, GROUND + 6.0, bz)), 0xe0b050));
    }
    const bgeo = merge(bg.map((g) => g.toNonIndexed()));
    const btex = bannerTexture();
    const bmat = new THREE.MeshStandardMaterial({ map: btex, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x220806, emissiveMap: btex });
    const pgeo = merge(poles);
    const pmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.8 });
    disposables.push(bgeo, bmat, btex, pgeo, pmat);
    group.add(new THREE.Mesh(bgeo, bmat), new THREE.Mesh(pgeo, pmat));
  }
  // licking flames in each burning ruin (several tongues per fire)
  const flameItems = [];
  fires.slice(0, -1).forEach((p) => {
    for (let k = 0; k < 4; k++) flameItems.push({ pos: new THREE.Vector3(p.x + R.range(-1.2, 1.2), p.y - 0.5, p.z + R.range(-1.2, 1.2)), scale: R.range(1.2, 2.4) });
  });
  // brazier fires: a cluster of short tongues sitting on the coal bed
  braziers.forEach((p, i) => {
    for (let k = 0; k < 4; k++) {
      const a = k * 2.1 + i;
      flameItems.push({ pos: new THREE.Vector3(p.x + Math.cos(a) * 0.12 * (k > 0), p.y, p.z + Math.sin(a) * 0.12 * (k > 0)), scale: k === 0 ? 0.62 : 0.4 });
    }
  });
  if (flameItems.length) group.add(createFlameBatch(flameItems));
  // street lanterns and hearth-glows twinkling across New Phlan
  {
    const n = 220;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const west = R.chance(0.97);
      pos.set([west ? R.range(-170, 12) : R.range(12, 170), GROUND + R.range(1.5, 4.5), R.range(-150, -34)], i * 3);
      seed[i] = R.next();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: cityTime },
      vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime; varying float vF;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          vF = 0.75 + 0.25 * sin(uTime * (3.0 + aSeed * 5.0) + aSeed * 40.0);
          gl_PointSize = clamp(1400.0 / -mv.z, 1.2, 7.0) * (0.6 + aSeed * 0.6); }`,
      fragmentShader: /* glsl */ `varying float vF; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
          float k = exp(-r * r * 10.0) + exp(-r * r * 2.5) * 0.25; gl_FragColor = vec4(vec3(1.6, 0.85, 0.35) * k * vF, 1.0); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    group.add(pts);
    disposables.push(g, m);
  }
  const smoke = createSmoke(fires.slice(0, -1), R);
  group.add(smoke.mesh);
  disposables.push(smoke.mesh.geometry, smoke.mesh.material);
  // hearth smoke: thin pale threads leaning off the chimneys behind the Pool
  const hearthPts = chimneys.filter((p) => Math.abs(p.x) < 48 && p.z > -80).sort((a, b) => b.z - a.z).slice(0, 9);
  const hearthSmoke = createSmoke(hearthPts, prng(seed + 404), { per: 18, height: 11, drift: 7, size: 0.32, alpha: 0.28, dark: [0.12, 0.1, 0.13], light: [0.3, 0.24, 0.28], fire: 0 });
  group.add(hearthSmoke.mesh);
  disposables.push(hearthSmoke.mesh.geometry, hearthSmoke.mesh.material);

  // ---- ships on the Moonsea ---------------------------------------------------
  const ships = createShips(R);
  group.add(ships.group);

  return {
    group,
    fires,
    ships,
    ground: GROUND,
    /** Sculpt the townsfolk at City Hall's steps (first time the shot needs them). */
    ensureCrowd() {
      if (buildCrowd) {
        const f = buildCrowd;
        buildCrowd = null;
        f();
      }
    },
    /** Cast and receive the shot key's shadows (the Old City aerial only: it costs a pass over the city). */
    setShadows(on) {
      for (const m of solid) { m.castShadow = on; m.receiveShadow = on; }
    },
    /** Classic 1988 mode: no smoke columns or glow sprites (they quantise to grey/orange blobs). */
    setClassic(on) {
      smoke.mesh.visible = !on;
      hearthSmoke.mesh.visible = !on;
      for (const s of glows) s.visible = !on;
      // 1988: the skyline is one flat mass of EGA blue with yellow windows
      for (const m of group.children) {
        if (!m.isMesh || !m.material) continue;
        if (on) {
          if (m.userData.preClassic) continue;
          m.userData.preClassic = m.material;
          m.material = m.material === winMat ? classicWin : classicBlue;
        } else if (m.userData.preClassic) {
          m.material = m.userData.preClassic;
          delete m.userData.preClassic;
        }
      }
    },
    /** @param {number} t @param {THREE.Camera} [camera] @param {THREE.Vector3} [sunDir] */
    update(t, camera, sunDir) {
      if (camera && sunDir) rimU.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      smoke.update(t);
      hearthSmoke.update(t);
      cityTime.value = t;
      for (const s of glows) {
        const f = 0.85 + 0.1 * Math.sin(t * 7 + s.userData.seed) + 0.05 * Math.sin(t * 17.3 + s.userData.seed * 3);
        s.scale.setScalar(s.userData.base * f);
      }
      ships.update(t);
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      for (const f of figures) f.userData.dispose?.();
      ships.dispose();
    },
  };
}

/**
 * Rising smoke from the burning ruins: GPU puff particles (normal-blended,
 * dark, fire-lit at the base) drifting west on the sea wind.
 */
function createSmoke(points, R, { per = 26, height = 38, drift = 26, size = 1, alpha = 0.34, dark = [0.03, 0.025, 0.03], light = [0.11, 0.08, 0.09], fire = 0.8 } = {}) {
  const n = points.length * per;
  const pos = new Float32Array(n * 3);
  const seeds = new Float32Array(n * 4);
  let k = 0;
  for (const p of points) {
    const scale = R.range(0.8, 1.3);
    for (let i = 0; i < per; i++, k++) {
      pos.set([p.x, p.y, p.z], k * 3);
      seeds.set([i / per + R.range(0, 0.02), R.next(), R.next(), scale], k * 4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime, uPx;
      varying float vLife; varying float vSeed;
      void main() {
        float life = fract(uTime * 0.035 + aSeed.x);
        vLife = life; vSeed = aSeed.y;
        vec3 p = position;
        float hgt = ${height.toFixed(1)} * aSeed.w;
        p.y += life * hgt;
        p.x += -life * life * ${drift.toFixed(1)} + (aSeed.y - 0.5) * 3.0 * life;
        p.z += (aSeed.z - 0.5) * 5.0 * life + life * 6.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = (2.5 + life * 16.0) * aSeed.w * ${size.toFixed(3)};
        gl_PointSize = clamp(size * uPx * 900.0 / -mv.z, 1.0, 320.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vLife; varying float vSeed;
      ${NOISE}
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        float n = fbm(gl_PointCoord * 3.0 + vSeed * 17.0);
        float puff = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
        float a = puff * smoothstep(0.0, 0.07, vLife) * (1.0 - smoothstep(0.35, 1.0, vLife)) * ${alpha.toFixed(3)};
        vec3 col = mix(vec3(${dark.map((v) => v.toFixed(3)).join(', ')}), vec3(${light.map((v) => v.toFixed(3)).join(', ')}), n);
        col += vec3(0.8, 0.28, 0.06) * (1.0 - smoothstep(0.0, 0.12, vLife)) * ${fire.toFixed(2)};
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    update: (t, px = 1) => {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uPx.value = px;
    },
  };
}

/** A few cogs and a caravel on the Moonsea, sails catching the last light. */
function createShips(R) {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.8 });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x3a1a08 });
  const ships = [];
  const specs = [
    { x: -40, z: -215, s: 1.4, ry: 0.3 },
    { x: 34, z: -260, s: 1.1, ry: -0.5 },
    { x: -120, z: -300, s: 1.0, ry: 0.9 },
    { x: 110, z: -230, s: 1.2, ry: 2.6 },
  ];
  for (const sp of specs) {
    const ship = new THREE.Group();
    const hs = new THREE.Shape();
    hs.moveTo(-4.5, 1.6);
    hs.quadraticCurveTo(-3.5, -0.4, 0, -0.6);
    hs.quadraticCurveTo(3.8, -0.4, 5.2, 2.0);
    hs.lineTo(3.8, 1.4);
    hs.lineTo(-3.6, 1.4);
    hs.closePath();
    const hull = new THREE.ExtrudeGeometry(hs, { depth: 2.2, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.4, bevelSegments: 2 });
    hull.translate(0, 0, -1.1);
    ship.add(new THREE.Mesh(hull, hullMat));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 6), hullMat);
    mast.position.set(0, 5.5, 0);
    ship.add(mast);
    const sail = new THREE.PlaneGeometry(4.4, 4.6, 6, 6);
    const p = sail.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.cos((p.getX(i) / 4.4) * Math.PI) * 0.7 * (1 - Math.abs(p.getY(i)) / 4));
    sail.computeVertexNormals();
    sail.rotateY(Math.PI / 2);
    const sm = new THREE.Mesh(sail, sailMat);
    sm.position.set(0.3, 5.8, 0);
    ship.add(sm);
    ship.position.set(sp.x, -15.1, sp.z);
    ship.rotation.y = sp.ry;
    ship.scale.setScalar(sp.s);
    ship.userData.seed = R.range(0, 10);
    ship.userData.base = { ...sp };
    group.add(ship);
    ships.push(ship);
  }
  return {
    group,
    ships,
    update(t) {
      for (const s of ships) {
        const k = s.userData.seed;
        s.position.y = -15.1 + Math.sin(t * 0.9 + k) * 0.12;
        s.rotation.z = Math.sin(t * 0.7 + k) * 0.035;
        s.rotation.x = Math.sin(t * 0.55 + k * 2) * 0.025;
      }
    },
    dispose() {
      hullMat.dispose();
      sailMat.dispose();
      group.traverse((o) => o.geometry?.dispose());
    },
  };
}
