import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createFlameBatch } from '../../../render/lighting.js';
import { NOISE } from './glsl.js';
import { prng, ni, worldUV, tint, box, gable, pyramid, cylinder, cone, merge } from './geom.js';
import { column, dome, gableRoof, robedFigure, addRimLight } from './arch.js';

export const CITY_TEXTURES = ['hd2_ashlar', 'hd2_ruin', 'hd2_plaster', 'hd_mud', 'hd_cobble', 'hd_roof_clay', 'hd_roof_slate', 'hd_roof_shake', 'hd_beam_dark', 'hd_limestone'];

const GROUND = -14;

/**
 * Ruined Phlan at dusk, seen from the hill of the old temple: New Phlan's lit
 * streets (west), the burnt-out old city (east) with fires and smoke, the
 * city wall, Valjevo Castle on its mound, the harbour and ships on the Moonsea.
 * Everything is merged into a handful of draw calls.
 */
export function createCity({ seed = 1988 } = {}) {
  const R = prng(seed);
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

  /** One house: box + roof (or a ruined shell). */
  const house = (x, z, w, d, h, ry, { ruined = false, lit = 0.3, base = GROUND, detail = true } = {}) => {
    const col = R.pick(stoneCols);
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, base, z);
    if (ruined) {
      // four walls of differing broken heights, no roof
      const t = 0.5;
      const segs = [
        [0, d / 2, w, 0], [0, -d / 2, w, 0], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, Math.PI / 2],
      ];
      for (const [ox, oz, len, r] of segs) {
        if (R.chance(0.18)) continue;
        const pieces = R.int(1, 3);
        for (let k = 0; k < pieces; k++) {
          const pl = len / pieces;
          const off = -len / 2 + pl * (k + 0.5);
          const hh = h * R.range(0.25, 1);
          const g = box(pl + 0.02, hh, t, { x: 0, y: 0, z: 0 });
          g.translate(off, 0, 0);
          g.rotateY(r);
          g.translate(ox, 0, oz);
          g.applyMatrix4(m);
          rubble.push(tint(worldUV(g, 2.2), new THREE.Color(col).multiplyScalar(0.8), { aoBottom: base, aoTop: base + 3 }));
        }
      }
      if (R.chance(0.4)) {
        const g = box(w * 0.7, 0.8, d * 0.6);
        g.applyMatrix4(m);
        rubble.push(tint(worldUV(g, 2.2), 0x5a524a));
      }
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
    plaster.push(tint(worldUV(g, 2.6), lime, { aoBottom: base, aoTop: base + 3, aoStrength: 0.3 }));
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
    const kind = R.next();
    if (kind < 0.66) {
      const rise = d * R.range(0.36, 0.55);
      const gr = gableRoof(w, d, rise, { o: R.range(0.35, 0.6), t: R.range(0.18, 0.26) });
      const mm = new THREE.Matrix4().makeTranslation(0, h, 0).premultiply(m);
      const pick = R.next();
      const list = pick < 0.45 ? roofs : pick < 0.78 ? slate : shake;
      const rc = list === roofs ? R.pick(roofCols) : list === slate ? R.pick(slateCols) : R.pick(shakeCols);
      for (const g of gr.roof) list.push(tint(g.applyMatrix4(mm), rc));
      for (const g of gr.caps) list.push(tint(g.applyMatrix4(mm), new THREE.Color(rc).multiplyScalar(0.8)));
      for (const g of gr.gables) plaster.push(tint(worldUV(g.applyMatrix4(mm), 2.6), lime));
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
          else if (detail) addWin(m, wx, wy, d / 2 + 0.03, 0, 0.5, 0.8, 0.07);
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

  const tower = (x, z, r, h, { roof = 'cone', base = GROUND, lit = 0, list = walls } = {}) => {
    const col = R.pick(stoneCols);
    list.push(tint(worldUV(cylinder(r, r * 1.08, h, 18, { x, y: base, z }), 3.2), col, { aoBottom: base, aoTop: base + 5 }));
    // string course a third of the way up
    fine.push(tint(worldUV(cylinder(r * 1.12, r * 1.12, 0.3, 16, { x, y: base + h * 0.62, z }), 2), new THREE.Color(col).multiplyScalar(1.12)));
    if (roof === 'cone') {
      // eaves ring, conical roof, lead finial
      beams.push(tint(worldUV(cylinder(r * 1.32, r * 1.18, 0.3, 16, { x, y: base + h - 0.05, z }), 2), 0x3a2a1e));
      slate.push(tint(worldUV(cone(r * 1.28, r * 2.6, 16, { x, y: base + h + 0.2, z }), 2), R.pick(slateCols)));
      fine.push(tint(worldUV(cylinder(0.06, 0.1, r * 0.9, 6, { x, y: base + h + 0.2 + r * 2.5, z }), 1), 0x6a6050));
    } else {
      // corbelled, crenellated top
      fine.push(tint(worldUV(cylinder(r * 1.15, r * 1.04, 0.55, 16, { x, y: base + h - 0.55, z }), 2), new THREE.Color(col).multiplyScalar(0.95)));
      list.push(tint(worldUV(cylinder(r * 1.15, r * 1.15, 0.9, 18, { x, y: base + h, z }), 3.2), col));
      const n = Math.round(r * 3);
      for (let i = 0; i < n; i++) {
        if (roof === 'broken' && R.chance(0.4)) continue;
        const a = (i / n) * Math.PI * 2;
        list.push(tint(worldUV(box(0.7, 0.8, 0.5, { x: x + Math.cos(a) * r * 1.1, y: base + h + 0.9, z: z + Math.sin(a) * r * 1.1, ry: -a }), 3.2), col));
      }
    }
    if (lit) {
      const m = new THREE.Matrix4().setPosition(x, base, z);
      for (let k = 0; k < 2; k++) addWin(m, 0, h * (0.45 + k * 0.25), r * 1.02 + 0.05, 0, 0.5, 0.9, 1.2);
    }
  };

  const crenel = (x0, z0, x1, z1, y, t, col, list = walls) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / 1.3);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      list.push(tint(worldUV(box(0.7, 0.8, t, { x: x0 + (x1 - x0) * f, y, z: z0 + (z1 - z0) * f, ry: -ang }), 3.2), col));
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
      const east = x > 14;
      const w = R.range(4.2, 7.5);
      const d = R.range(4.2, 7.2);
      const far = gz / 15;
      const h = R.range(3.2, 7.0) * (1 + far * 0.25) * (R.chance(0.08) ? 1.5 : 1);
      const ry = (R.chance(0.5) ? 0 : Math.PI / 2) + R.range(-0.12, 0.12);
      const ruined = east ? R.chance(0.55) : R.chance(0.08);
      // timber framing and window joinery only where the camera ever gets close
      const near = (gz < 6 && Math.abs(x) < 120) || (x > 10 && x < 110 && gz < 12);
      house(x, z, w, d, h, ry, { ruined, lit: east ? 0.05 : 0.5, detail: near });
      if (!ruined && R.chance(0.06)) tower(x + w * 0.6, z, R.range(1.4, 2.2), h + R.range(5, 10), { roof: R.chance(0.5) ? 'cone' : 'flat', lit: east ? 0 : 1 });
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
    const mound = new THREE.CylinderGeometry(20, 30, 4, 28, 2);
    mound.translate(cx, GROUND + 2, cz);
    rubble.push(tint(worldUV(mound, 3), 0x5d564c));
    castle.push(tint(worldUV(box(14, 15, 12, { x: cx, y: base, z: cz }), 3.6), 0x9a8e7e, { aoBottom: base, aoTop: base + 6 }));
    // buttresses, machicolation band and lit arrow slits on the keep
    for (const bx of [-4.6, 0, 4.6]) castle.push(tint(worldUV(box(1.2, 13.5, 0.9, { x: cx + bx, y: base, z: cz + 6.3 }), 3.6), 0x928676, { aoBottom: base, aoTop: base + 6 }));
    fine.push(tint(worldUV(box(14.8, 0.9, 12.8, { x: cx, y: base + 14.1, z: cz }), 2), 0x958a7c));
    for (let k = 0; k < 4; k++) addWin(new THREE.Matrix4().setPosition(cx, base, cz), -6.9 + k * 4.6 + 2.3 * (k % 2 ? 0 : 0), 9.5, 6.06, 0, 0.35, 1.1, 0.8);
    crenel(cx - 7, cz + 6, cx + 7, cz + 6, base + 15, 0.6, 0x9a8e7e, castle);
    crenel(cx - 7, cz - 6, cx + 7, cz - 6, base + 15, 0.6, 0x9a8e7e, castle);
    for (const [dx, dz] of [[-10, 8], [10, 8], [-10, -8], [10, -8]]) tower(cx + dx, cz + dz, 2.4, 19, { roof: dx > 0 && dz > 0 ? 'broken' : 'cone', base, list: castle });
    wallRun(cx - 18, cz + 14, cx + 18, cz + 14, 9, { base: GROUND + 5, list: castle });
    wallRun(cx - 18, cz + 14, cx - 18, cz - 14, 9, { base: GROUND + 5, list: castle });
    wallRun(cx + 18, cz + 14, cx + 18, cz - 14, 9, { base: GROUND + 5, gaps: 0.4, list: castle });
    tower(cx - 18, cz + 14, 3.2, 13, { roof: 'flat', base: GROUND + 5, list: castle });
    tower(cx + 18, cz + 14, 3.2, 11, { roof: 'broken', base: GROUND + 5, list: castle });
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
    for (const g of hr.roof) slate.push(tint(g.applyMatrix4(rm), 0x66708a));
    for (const g of hr.caps) fine.push(tint(g.applyMatrix4(rm), 0x8a8f9a));
    for (const g of hr.gables) hall.push(tint(worldUV(g.applyMatrix4(rm), 2.6), 0xb0a28c));
    const hm = new THREE.Matrix4().setPosition(hx, GROUND, hz);
    for (let f = 0; f < 2; f++) for (let i = 0; i < 8; i++) {
      if (f === 0 && (i >= 2 && i <= 5)) continue;
      addWin(hm, -7.7 + i * 2.2, 2.0 + f * 3.8, hd / 2 + 0.04, 0, 0.8, 1.7, 0.75);
      // window surrounds (lintel + sill)
      fine.push(tint(worldUV(box(1.15, 0.18, 0.2, { x: hx - 7.7 + i * 2.2, y: GROUND + 2.0 + f * 3.8 + 0.88, z: hz + hd / 2 + 0.08 }), 1), 0xc4b8a2));
      fine.push(tint(worldUV(box(1.05, 0.12, 0.26, { x: hx - 7.7 + i * 2.2, y: GROUND + 2.0 + f * 3.8 - 0.94, z: hz + hd / 2 + 0.1 }), 1), 0xc4b8a2));
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
    const ped = gableRoof(3.6, 12.2, 2.0, { o: 0.25, t: 0.26, ridge: false });
    const pm = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(hx, colBase + 6.96, pz + 2.2);
    for (const g of ped.roof) slate.push(tint(g.applyMatrix4(pm), 0x66708a));
    for (const g of ped.gables) fine.push(tint(g.applyMatrix4(pm), 0xc6baa4));
    // tympanum roundel (the Council's sun-and-scales)
    const tymp = new THREE.CircleGeometry(0.62, 24);
    tymp.translate(hx, colBase + 7.75, pz + 4.02);
    fine.push(tint(worldUV(ni(tymp), 1), 0xd8b25a));
    addWin(hm, 0, 1.75, hd / 2 + 0.05, 0, 2.2, 3.1, 0.95); // open doors, warm light within
    lamps.push(new THREE.Vector3(hx - 2.2, GROUND + 3.4, pz + 3.9), new THREE.Vector3(hx + 2.2, GROUND + 3.4, pz + 3.9));
    for (const lx of [-12, -4, 4, 12]) {
      walls.push(tint(worldUV(cylinder(0.08, 0.1, 3.4, 6, { x: hx + lx, y: GROUND, z: pz + 12 }), 1), 0x2a2622));
      lamps.push(new THREE.Vector3(hx + lx, GROUND + 3.5, pz + 12));
    }
    banners.push([hx - 3.6, pz + 3.3], [hx + 3.6, pz + 3.3]);
    tower(hx + 10.5, hz, 2.2, 19, { roof: 'cone', lit: 1 });
    // townsfolk gathered on the steps to read the proclamation; a guard at the door
    const folk = [
      [-1.6, 6.6, 0x6a2018, 0.2], [-0.9, 7.2, 0x2a3a5a, -0.3], [0.4, 6.9, 0x4a3a28, 0.1], [1.4, 7.4, 0x3a2a40, 0.4],
      [2.4, 6.4, 0x5a4a30, -0.2], [-2.8, 7.6, 0x2a2a2a, 0.6], [-0.2, 4.6, 0x7a1a14, 3.14], [3.6, 5.2, 0x1a2a4a, 2.6],
    ];
    folk.forEach(([fx, fz, c, ry], i) => {
      const f = robedFigure({ height: 1.62 + (i % 3) * 0.08, robe: c, hood: i % 2 === 0, seed: i + 3 });
      const level = fz < 5.6 ? 0.78 : 0;
      const fm = new THREE.Matrix4().makeRotationY(ry).setPosition(hx + fx, GROUND + level, pz + fz);
      for (const g of [...f.cloth, ...f.skin]) people.push(g.applyMatrix4(fm));
    });
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
  const wallMat = addRimLight(texMat('hd2_ashlar'), rimU, 1);
  // the castle gets its own, brighter rim and a touch of warm self-light so it
  // separates from the town in the dusk haze
  const castleMat = addRimLight(texMat('hd2_ashlar', { emissive: 0x1a0c06 }), rimU, 2.2);
  const hallMat = addRimLight(texMat('hd2_ashlar'), rimU, 1);
  const plasterMat = addRimLight(texMat('hd2_plaster'), rimU, 0.9);
  const rubbleMat = addRimLight(texMat('hd2_ruin'), rimU, 1);
  const groundMat = texMat('hd_mud');
  const cobbleMat = texMat('hd_cobble', { polygonOffset: true, polygonOffsetFactor: -1 });
  const roofMat = addRimLight(texMat('hd_roof_clay'), rimU, 1.2);
  const slateMat = addRimLight(texMat('hd_roof_slate', { metalness: 0.05 }), rimU, 1.2);
  const shakeMat = addRimLight(texMat('hd_roof_shake'), rimU, 1.2);
  const beamMat = addRimLight(texMat('hd_beam_dark'), rimU, 0.8);
  const fineMat = addRimLight(texMat('hd_limestone'), rimU, 1);
  const peopleMat = addRimLight(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), rimU, 1.4);
  disposables.push(wallMat, castleMat, hallMat, plasterMat, rubbleMat, groundMat, cobbleMat, roofMat, slateMat, shakeMat, beamMat, fineMat, peopleMat);
  const addMesh = (list, mat, shadow = false) => {
    if (!list.length) return null;
    const g = merge(list);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = shadow;
    group.add(mesh);
    disposables.push(g);
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
    s.scale.setScalar(0.65);
    s.userData.base = 0.65;
    s.userData.seed = 10 + i;
    group.add(s);
    glows.push(s);
  });
  if (banners.length) {
    const bg = [];
    for (const [bx, bz] of banners) {
      const g = new THREE.PlaneGeometry(1.1, 3.6, 8, 10);
      const p = g.attributes.position;
      const col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k);
        // vertical folds + a swallow-tail hem
        p.setZ(k, Math.sin(x * 11) * 0.07 + Math.sin(y * 1.4) * 0.05);
        if (y < -1.7) p.setY(k, y - (0.55 - Math.abs(x)) * 0.6);
        const hem = Math.abs(x) > 0.47 || y > 1.66 ? 1 : 0;
        const device = Math.hypot(x, y - 0.5) < 0.28 && Math.hypot(x, y - 0.5) > 0.2 ? 1 : 0;
        const c = hem || device ? [0.85, 0.62, 0.25] : [0.55, 0.1, 0.08];
        col.set(c, k * 3);
      }
      g.computeVertexNormals();
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.translate(bx, GROUND + 4.2, bz);
      bg.push(g);
    }
    const bgeo = merge(bg);
    const bmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x1a0402 });
    disposables.push(bgeo, bmat);
    group.add(new THREE.Mesh(bgeo, bmat));
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
      const west = R.chance(0.82);
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
