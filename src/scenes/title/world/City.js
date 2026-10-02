import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createFlameBatch } from '../../../render/lighting.js';
import { NOISE } from './glsl.js';
import { prng, ni, worldUV, tint, box, gable, pyramid, cylinder, cone, merge } from './geom.js';
import { column, dome, gableRoof, robedFigure, addRimLight, contactShadow } from './arch.js';
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
  const rubble = []; // burnt rubble-stone shells of the old city
  const ground = []; // packed mud and ash
  const cobbles = []; // the avenue and the council plaza
  const roofs = [];
  const slate = [];
  const shake = [];
  const beams = [];
  const fine = []; // dressed limestone (columns, mouldings)
  const people = [];
  const windows = [];
  const fires = [];
  const lamps = [];
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

  /** Oak window frame: lintel, sill and a pair of shutters folded back. */
  const winFrame = (m, lx, ly, lz, ry, w = 0.5, h = 0.8) => {
    const off = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    const put = (geo, list, c) => { geo.applyMatrix4(m); list.push(tint(worldUV(geo, 1.2), c)); };
    put(box(w + 0.22, 0.11, 0.14, { x: lx, y: ly + h / 2, z: lz, ry }), beams, 0x3a2a1e);
    put(box(w + 0.28, 0.08, 0.2, { x: lx + off.x * 0.04, y: ly - h / 2 - 0.08, z: lz + off.z * 0.04, ry }), beams, 0x4a3424);
    const side = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
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
  const house = (x, z, ...rest) => {
    const saved = R;
    R = prng((Math.round(x * 131.7) * 73856093) ^ (Math.round(z * 97.3) * 19349663) ^ seed);
    try {
      houseImpl(x, z, ...rest);
    } finally {
      R = saved;
    }
  };
  const houseImpl = (x, z, w, d, h, ry, { ruined = false, burnt = false, lit = 0.3, base = GROUND, detail = true } = {}) => {
    const col = R.pick(stoneCols);
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
        const g = ruinWall(len + tt, h * R.range(0.55, 1.05), tt, { openings: detail, tops: detail ? [] : null });
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
    // lime-washed plaster between oak timbers on a rubble-stone plinth
    const lime = new THREE.Color().setHSL(0.09 + R.range(-0.02, 0.03), R.range(0.18, 0.32), R.range(0.62, 0.74));
    const g = box(w, h, d);
    g.applyMatrix4(m);
    if (burnt) plaster.push(sootify(tint(worldUV(g, 2.6), lime.clone().multiplyScalar(0.72), { aoBottom: base, aoTop: base + 3, aoStrength: 0.3 }), base, base + h, { ivy: 0.25 }));
    else plaster.push(tint(worldUV(g, 2.6), lime, { aoBottom: base, aoTop: base + 3, aoStrength: 0.3 }));
    const pl = box(w + 0.16, 0.9, d + 0.16);
    pl.applyMatrix4(m);
    walls.push(tint(worldUV(pl, 2.4), new THREE.Color(col).multiplyScalar(0.85), { aoBottom: base, aoTop: base + 1 }));
    if (detail) {
      const T = 0.2, P = 0.05; // timber width, proud of the plaster
      const tc = R.chance(0.5) ? 0x3a2a1e : 0x4a3424;
      const floorsN = Math.max(1, Math.floor(h / 2.6));
      const tim = (geo) => { geo.applyMatrix4(m); beams.push(tint(worldUV(geo, 1.6), tc)); };
      // corner posts
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tim(box(T + P * 2, h - 0.9, T + P * 2, { x: cx * (w / 2 - T / 2 + P), y: 0.9, z: cz * (d / 2 - T / 2 + P) }));
      // sill, floor and wall-plate beams round the house
      for (let f = 0; f <= floorsN; f++) {
        const y = f === floorsN ? h - T : 0.9 + f * 2.6 - T / 2;
        if (y > h - T + 0.01) continue;
        tim(box(w + P * 2, T, T * 0.6, { y, z: d / 2 + P - T * 0.3 }));
        tim(box(w + P * 2, T, T * 0.6, { y, z: -d / 2 - P + T * 0.3 }));
        tim(box(T * 0.6, T, d + P * 2, { x: w / 2 + P - T * 0.3, y }));
        tim(box(T * 0.6, T, d + P * 2, { x: -w / 2 - P + T * 0.3, y }));
      }
      // studs and a pair of down-braces on the street front
      const studs = Math.max(2, Math.round(w / 1.6));
      for (let i = 1; i < studs; i++) {
        const x = -w / 2 + (w / studs) * i;
        tim(box(T * 0.7, h - 1.0, T * 0.5, { x, y: 0.95, z: d / 2 + P }));
      }
      const bh = Math.min(2.4, h - 1.1);
      const run = w / studs - T;
      const blen = Math.hypot(run, bh);
      for (const sx of [-1, 1]) tim(box(T * 0.6, blen, T * 0.45, { x: sx * (w / 2 - T), y: 0.9, z: d / 2 + P + 0.01, rz: Math.atan2(sx * run, bh) }));
    }
    const kind = burnt ? 0 : R.next();
    if (kind < 0.66 && burnt) {
      // burnt out: one roof slope fallen in, the charred rafters of the other
      // still standing against the sky
      const rise = d * R.range(0.36, 0.5);
      const o = 0.4;
      const gr = gableRoof(w, d, rise, { o, t: 0.2, ridge: false });
      const mm = new THREE.Matrix4().makeTranslation(0, h, 0).premultiply(m);
      const keep = R.chance(0.5) ? 0 : 1;
      const list = R.chance(0.5) ? roofs : shake;
      list.push(sootify(tint(gr.roof[keep].applyMatrix4(mm), new THREE.Color(list === roofs ? R.pick(roofCols) : R.pick(shakeCols)).multiplyScalar(0.62)), base + h, base + h + rise));
      const nR = Math.max(3, Math.round(w / 0.7));
      for (let k = 0; k < nR; k++) {
        if (R.chance(0.3)) continue;
        const rr = gableRoof(0.13, d, rise, { o: o * R.range(0.2, 1), t: 0.15, ridge: false }).roof[1 - keep];
        rr.translate(-w / 2 + 0.2 + (w - 0.4) * (k / (nR - 1)), 0, 0);
        beams.push(tint(worldUV(rr.applyMatrix4(mm), 1.5), 0x1e1612));
      }
      for (const g2 of gr.gables) plaster.push(sootify(tint(worldUV(g2.applyMatrix4(mm), 2.6), lime.clone().multiplyScalar(0.6)), base + h - 1, base + h + rise));
    } else if (kind < 0.66) {
      const rise = d * R.range(0.36, 0.55);
      const gr = gableRoof(w, d, rise, { o: R.range(0.35, 0.6), t: R.range(0.18, 0.26) });
      const mm = new THREE.Matrix4().makeTranslation(0, h, 0).premultiply(m);
      const pick = R.next();
      const list = pick < 0.45 ? roofs : pick < 0.78 ? slate : shake;
      const rc = list === roofs ? R.pick(roofCols) : list === slate ? R.pick(slateCols) : R.pick(shakeCols);
      for (const g of gr.roof) list.push(tint(g.applyMatrix4(mm), rc));
      for (const g of gr.caps) list.push(tint(g.applyMatrix4(mm), new THREE.Color(rc).multiplyScalar(0.8)));
      for (const g of gr.gables) plaster.push(tint(worldUV(g.applyMatrix4(mm), 2.6), lime));
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
    // lit windows (facing the camera and the flanks)
    if (lit > 0) {
      const floors = Math.max(1, Math.floor(h / 2.6));
      for (let f = 0; f < floors; f++) {
        const wy = 1.4 + f * 2.6;
        const nx = Math.max(1, Math.floor(w / 1.8));
        for (let i = 0; i < nx; i++) {
          const wx = -w / 2 + (w / nx) * (i + 0.5);
          if (R.chance(lit)) addWin(m, wx, wy, d / 2 + 0.03, 0, 0.5, 0.8, R.range(0.8, 1.4));
          else if (detail) addWin(m, wx, wy, d / 2 + 0.03, 0, 0.5, 0.8, burnt ? 0.0 : 0.07);
          if (h < 9 && detail) winFrame(m, wx, wy, d / 2 + 0.03, 0);
        }
        for (let i = 0; i < nx; i++) {
          if (R.chance(lit * 0.45)) addWin(m, -w / 2 + (w / nx) * (i + 0.5), wy, -d / 2 - 0.03, Math.PI, 0.5, 0.8, R.range(0.8, 1.5));
        }
        const nz = Math.max(1, Math.floor(d / 2));
        for (let i = 0; i < nz; i++) {
          if (R.chance(lit * 0.6)) addWin(m, w / 2 + 0.03, wy, -d / 2 + (d / nz) * (i + 0.5), Math.PI / 2, 0.5, 0.8, R.range(0.7, 1.3));
          if (R.chance(lit * 0.6)) addWin(m, -w / 2 - 0.03, wy, -d / 2 + (d / nz) * (i + 0.5), -Math.PI / 2, 0.5, 0.8, R.range(0.7, 1.3));
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
      if (R.chance(0.12)) continue;
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
      house(x, z, w, d, h, ry, { ruined, burnt: east && !ruined, lit: east ? 0 : 0.5, detail: near });
      if (!ruined && R.chance(0.06)) tower(x + w * 0.6, z, R.range(1.4, 2.2), h + R.range(5, 10), { roof: east ? 'broken' : R.chance(0.5) ? 'cone' : 'flat', lit: east ? 0 : 1 });
      if (east && ruined && R.chance(0.22) && fires.length < 9) fires.push(new THREE.Vector3(x + R.range(-1, 1), GROUND + 0.5, z));
    }
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
    const mound = new THREE.CylinderGeometry(20, 31, 4, 40, 4);
    {
      const mp = mound.attributes.position;
      for (let i = 0; i < mp.count; i++) {
        const x0 = mp.getX(i), y0 = mp.getY(i), z0 = mp.getZ(i);
        const a = Math.atan2(z0, x0);
        if (y0 < 1.99) {
          const k = 1 + 0.07 * Math.sin(a * 5 + 1.3) + 0.05 * Math.sin(a * 11);
          mp.setXYZ(i, x0 * k, y0 + (y0 > -1.99 ? 0.5 * Math.sin(a * 7) : 0), z0 * k);
        }
      }
      mound.computeVertexNormals();
    }
    mound.translate(cx, GROUND + 2, cz);
    rubble.push(tint(worldUV(ni(mound), 3), 0x5a5a40, { aoBottom: GROUND, aoTop: GROUND + 4, aoStrength: 0.5 }));
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
      for (const g of gr.roof) slate.push(tint(g.applyMatrix4(mm), 0x5a6070));
      for (const g of gr.caps) slate.push(tint(g.applyMatrix4(mm), 0x4a4f5c));
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
    wallRun(cx - 18, cz + 14, cx + 18, cz + 14, 9, { base: GROUND + 5, list: castle });
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
    for (const lx of [-7.2, 7.2]) {
      walls.push(tint(worldUV(cylinder(0.12, 0.2, 1.1, 8, { x: hx + lx, y: GROUND, z: pz + 6.2 }), 1), 0x3a3430));
      fine.push(tint(worldUV(cylinder(0.42, 0.22, 0.32, 12, { x: hx + lx, y: GROUND + 1.1, z: pz + 6.2 }), 1), 0x5a4a38));
      lamps.push(new THREE.Vector3(hx + lx, GROUND + 1.6, pz + 6.2));
    }
    banners.push([hx - 3.6, pz + 3.3], [hx + 3.6, pz + 3.3]);
    tower(hx + 10.5, hz, 2.2, 19, { roof: 'cone', lit: 1 });
    // townsfolk gathered at the steps to read the proclamation, a guard at the
    // door: sculpted figures (faces, hands, clothes) from the miniature rig
    const folk = [
      [-3.0, 5.6, Math.PI - 0.15, { gender: 'male', classSpec: 'fighter', look: { seed: 71, head: 1, body: 0, cloth: 2, hair: 3 } }],
      [-1.9, 6.1, Math.PI + 0.25, { gender: 'female', classSpec: 'cleric', look: { seed: 72, head: 4, body: 5, cloth: 1, hair: 4 } }],
      [-0.6, 5.7, Math.PI - 0.35, { gender: 'male', classSpec: 'thief', look: { seed: 73, head: 3, body: 2, cloth: 4, hair: 0 } }],
      [0.6, 6.4, Math.PI + 0.1, { gender: 'male', classSpec: 'magicUser', look: { seed: 74, head: 6, body: 4, cloth: 6, hair: 8 } }],
      [1.8, 5.6, Math.PI - 0.5, { gender: 'female', classSpec: 'thief', look: { seed: 75, head: 5, body: 3, cloth: 3, hair: 2 } }],
      [-4.2, 6.6, Math.PI + 0.4, { gender: 'male', classSpec: 'cleric', look: { seed: 76, head: 2, body: 7, cloth: 5, hair: 7 } }],
    ];
    // built on demand (only the City Hall shot ever sees them)
    buildCrowd = () => {
      for (const [fx, fz, ry, ch] of folk) {
        const f = buildMiniature({ race: 'human', ...ch }, { pose: 'stand', base: false, gear: false, quality: 0.0108, faceSize: 256, noWeapon: true, noShield: true, rayHead: true, headGain: 0.75, fog: true });
        f.position.set(hx + fx, GROUND, pz + fz);
        f.rotation.y = ry;
        group.add(f);
        figures.push(f);
        const sh = contactShadow(0.45, 0.36);
        sh.position.set(hx + fx, GROUND + 0.04, pz + fz);
        group.add(sh);
      }
      // the door guard (robed in the Council's red) on the top step, facing the plaza
      const guard = buildMiniature({ race: 'human', gender: 'male', classSpec: 'fighter', look: { seed: 77, head: 0, body: 0, cloth: 0, hair: 1 } }, { pose: 'guard', base: false, gear: true, quality: 0.0108, faceSize: 256, rayHead: true, headGain: 0.75, fog: true });
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

  // ---- ground --------------------------------------------------------------
  {
    // packed mud and ash everywhere, cobbled where the city still keeps its streets:
    // the great avenue down to the harbour, the council plaza and the quay road
    const g = new THREE.PlaneGeometry(460, 160, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, GROUND, -80);
    ground.push(tint(worldUV(ni(g), 4.5), 0x6a5e50));
    const lay = (w, d, x, z, c = 0x8a8278) => {
      const q = new THREE.PlaneGeometry(w, d, 1, 1);
      q.rotateX(-Math.PI / 2);
      q.translate(x, GROUND + 0.03, z);
      cobbles.push(tint(worldUV(ni(q), 2.6), c));
    };
    lay(11, 128, 0, -92);
    lay(36, 34, -20, -50, 0x9a9288);
    lay(380, 7, 0, -150, 0x7a7268);
    lay(160, 6, -80, -40);
  }

  // ---- meshes --------------------------------------------------------------
  const texMat = (name, extra = {}) => {
    const t = getTextureSet(name);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, vertexColors: true, roughness: 1, ...extra });
  };
  const rimU = { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uRimColor: { value: new THREE.Color(1.0, 0.55, 0.28) } };
  const wallMat = addRimLight(texMat('hd2_ashlar'), rimU, 1, { weather: 1 });
  // the castle gets its own, brighter rim and a touch of warm self-light so it
  // separates from the town in the dusk haze
  const castleMat = addRimLight(texMat('hd2_ashlar', { emissive: 0x1a0c06 }), rimU, 2.2, { weather: 1, ground: -10 });
  const hallMat = addRimLight(texMat('hd2_ashlar'), rimU, 1, { weather: 0.55 });
  const plasterMat = addRimLight(texMat('hd2_plaster'), rimU, 0.9);
  const rubbleMat = addRimLight(texMat('hd2_ruin'), rimU, 1, { weather: 0.8 });
  const groundMat = texMat('hd_mud');
  const cobbleMat = texMat('hd_cobble', { polygonOffset: true, polygonOffsetFactor: -1 });
  const roofMat = addRimLight(texMat('hd_roof_clay'), rimU, 1.2);
  const slateMat = addRimLight(texMat('hd_roof_slate', { metalness: 0.05 }), rimU, 1.2);
  const shakeMat = addRimLight(texMat('hd_roof_shake'), rimU, 1.2);
  const beamMat = addRimLight(texMat('hd_beam_dark'), rimU, 0.8);
  const fineMat = addRimLight(texMat('hd_limestone'), rimU, 1);
  const peopleMat = addRimLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), rimU, 1.4);
  disposables.push(wallMat, castleMat, hallMat, plasterMat, rubbleMat, groundMat, cobbleMat, roofMat, slateMat, shakeMat, beamMat, fineMat, peopleMat);
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
  addMesh(rubble, rubbleMat);
  addMesh(ground, groundMat);
  addMesh(cobbles, cobbleMat);
  addMesh(roofs, roofMat);
  addMesh(slate, slateMat);
  addMesh(shake, shakeMat);
  addMesh(beams, beamMat);
  addMesh(fine, fineMat);
  addMesh(people, peopleMat);
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
      for (const s of glows) s.visible = !on;
    },
    /** @param {number} t @param {THREE.Camera} [camera] @param {THREE.Vector3} [sunDir] */
    update(t, camera, sunDir) {
      if (camera && sunDir) rimU.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      smoke.update(t);
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
function createSmoke(points, R) {
  const per = 26;
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
        float hgt = 38.0 * aSeed.w;
        p.y += life * hgt;
        p.x += -life * life * 26.0 + (aSeed.y - 0.5) * 3.0 * life;
        p.z += (aSeed.z - 0.5) * 5.0 * life + life * 6.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = (2.5 + life * 16.0) * aSeed.w;
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
        float a = puff * smoothstep(0.0, 0.07, vLife) * (1.0 - smoothstep(0.35, 1.0, vLife)) * 0.34;
        vec3 col = mix(vec3(0.03, 0.025, 0.03), vec3(0.11, 0.08, 0.09), n);
        col += vec3(0.8, 0.28, 0.06) * (1.0 - smoothstep(0.0, 0.12, vLife)) * 0.8;
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
