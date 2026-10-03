import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getLambertMaterial, getWindowMaterial } from '../../render/materials.js';
import { getTextureSet } from '../../render/textures/index.js';
import { GeoBuilder, hash } from './GeoBuilder.js';
import { CELL_SIZE } from './BlockBuilder.js';
import { buildCog, drawSail } from './Ships.js';
import { createSea } from './Sea.js';
import { timeOfDayKeys } from '../../render/lighting.js';
import { createFlameBatch, createGlowBatch, FLAME_UNIFORMS } from '../../render/lighting.js';

const PROP_TIME = FLAME_UNIFORMS.uTime;

const S = CELL_SIZE;

/**
 * Backdrop beyond the block walls: a ring of rooftops and gables, the city
 * wall, ruined towers, Valjevo Castle on its hill to the north-east, the
 * Moonsea to the south and hills on the horizon. Merged per material.
 * @param {any} map @param {any} ts tileset
 * @param {{night?: number, hour?: number}} opts
 */
export function buildSkyline(map, ts, opts = {}) {
  const night = opts.night ?? 0;
  const group = new THREE.Group();
  group.name = 'skyline';
  const g = new GeoBuilder();
  g.aoFn = (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, -1, 4);
  // ruined Phlan: what still stands of its towers has lost its roofs
  g.noCones = ts.skyline === 'ruins';
  const own = [];
  const W = map.w * S;
  const H = map.h * S;
  const cx = W / 2;
  const cz = H / 2;
  const ruins = ts.skyline === 'ruins';
  const harbour = !!map.harbour; // the block itself is the waterfront: open water to the south
  const seedBase = map.id;
  const winLit = new GeoBuilder();
  const winDark = new GeoBuilder();
  const smoke = [];

  const insideMap = (x, z, m) => x > -m && x < W + m && z > -m && z < H + m;

  // ---------------------------------------------------------- houses ring
  const lot = 5.2;
  const band = 44;
  for (let gz = -band; gz < H + band; gz += lot) {
    for (let gx = -band; gx < W + band; gx += lot) {
      const x = gx + lot / 2 + (hash(seedBase, gx, gz, 'jx') - 0.5) * 1.4;
      const z = gz + lot / 2 + (hash(seedBase, gx, gz, 'jz') - 0.5) * 1.4;
      if (insideMap(x, z, 3.2)) continue;
      // south: the harbour slope then the Moonsea
      if (z > H + 24) continue;
      if (harbour && z > H - 6) continue;
      const dist = Math.max(-x, x - W, -z, z - H, 0);
      const r = hash(seedBase, gx, gz, 'lot');
      if (r < 0.12) continue;
      const w = 3.4 + hash(gx, gz, 'w') * 1.8;
      const d = 3.4 + hash(gx, gz, 'd') * 1.8;
      const base = z > H ? -((z - H) / 24) * 2.5 : 0; // slope down to the harbour
      let h = 4.5 + hash(gx, gz, 'h') * 3.5 + Math.min(dist, 30) * 0.08;
      if (hash(gx, gz, 'tall') < 0.1) h += 3.5;
      const ruined = ruins ? r < 0.75 : r < 0.24;
      house(g, winLit, winDark, x, base, z, w, d, h, hash(gx, gz, 'rot') < 0.5, ruined, `${gx},${gz}`, night, cx, cz, smoke);
    }
  }

  // ---------------------------------------------------------- streets beyond the block
  {
    const y = -0.02;
    const X0 = -170;
    const X1 = W + 170;
    const Z0 = -170;
    const Z1 = H + 24;
    const q = (a, b, c, d) => g.quad('arch_cobble', new THREE.Vector3(a, y, d), new THREE.Vector3(c, y, d), new THREE.Vector3(c, y, b), new THREE.Vector3(a, y, b), null, { ao: 0.85 });
    q(X0, Z0, X1, 0); // north
    // south: slopes down to the harbour
    if (!harbour) g.quad('arch_cobble', new THREE.Vector3(X0, -2.5, Z1), new THREE.Vector3(X1, -2.5, Z1), new THREE.Vector3(X1, y, H), new THREE.Vector3(X0, y, H), null, { ao: 0.85 });
    q(X0, 0, 0, H); // west
    q(W, 0, X1, H); // east
  }

  // ---------------------------------------------------------- city wall
  const wallR = band + 6;
  const segs = [
    [[-wallR, -wallR], [W + wallR, -wallR]],
    [[W + wallR, -wallR], [W + wallR, H + 16]],
    [[-wallR, -wallR], [-wallR, H + 16]],
  ];
  for (const [[x0, z0], [x1, z1]] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(len / 20);
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const ax = x0 + (x1 - x0) * t0;
      const az = z0 + (z1 - z0) * t0;
      const bx = x0 + (x1 - x0) * t1;
      const bz = z0 + (z1 - z0) * t1;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const sl = Math.hypot(bx - ax, bz - az);
      const along = Math.abs(bx - ax) > Math.abs(bz - az);
      const broken = hash(seedBase, k, x0, z0, 'wb') < (ruins ? 0.5 : 0.18);
      const wh = broken ? 3 + hash(k, x0, 'bh') * 3 : 8;
      g.box('arch_stone_cold', { c: [mx, wh / 2 - 0.5, mz], s: along ? [sl, wh, 2.2] : [2.2, wh, sl], ao: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 6) });
      if (!broken) {
        for (let m = 0; m < sl / 1.6; m++) {
          if (m % 2) continue;
          const t = (m + 0.5) / (sl / 1.6);
          const px = along ? ax + (bx - ax) * t : mx;
          const pz = along ? mz : az + (bz - az) * t;
          g.box('arch_stone_cold', { c: [px, wh - 0.5 + 0.5, pz], s: along ? [0.8, 1, 2.2] : [2.2, 1, 0.8] });
        }
      }
      // wall towers every other segment
      if (k % 2 === 0) tower(g, ax, az, 3.2, 13 + hash(k, x0, 'th') * 4, broken || hash(k, z0, 'tr') < (ruins ? 0.6 : 0.3), `wt${k}${x0}${z0}`, night, winLit);
    }
  }

  // ---------------------------------------------------------- towers & castle
  const towers = ruins ? 9 : 6;
  for (let k = 0; k < towers; k++) {
    const a = hash(seedBase, k, 'ta') * Math.PI * 2;
    const rr = Math.max(W, H) * 0.5 + 18 + hash(seedBase, k, 'tr') * 36;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    if (z > H + 20 || (harbour && z > H - 12)) continue;
    tower(g, x, z, 2.4 + hash(k, 'rad') * 1.5, 15 + hash(k, 'hh') * 14, hash(k, 'broken') < (ruins ? 0.85 : 0.45), `t${k}`, night, winLit);
  }
  // Valjevo Castle on its hill, north-east
  {
    const hx = cx + 115;
    const hz = cz - 150;
    const hill = new THREE.ConeGeometry(60, 26, 18, 3);
    const hp = hill.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      const f = 1 + (hash(i % 19, Math.round(y), 'hill') - 0.5) * 0.25;
      hp.setXYZ(i, hp.getX(i) * f, y, hp.getZ(i) * f);
    }
    hill.computeVertexNormals();
    g.geometry('arch_mud', hill, new THREE.Matrix4().makeTranslation(hx, 10, hz), { uv: 'world', ao: 0.7 });
    hill.dispose();
    const top = 23;
    const ring = [[-12, -8], [12, -9], [14, 8], [-10, 10]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[(k + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      g.box('arch_stone_cold', { c: [hx + (ax + bx) / 2, top + 4, hz + (az + bz) / 2], s: [len, 9, 2.4], rotY: -ang });
      tower(g, hx + ax, hz + az, 3.4, 20 + k * 2.5, k === 2, `vc${k}`, night, winLit, top);
    }
    tower(g, hx + 1, hz, 5, 30, false, 'keep', night, winLit, top);
  }

  // ---------------------------------------------------------- hills on the horizon
  {
    const n = 96;
    const R = 330;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const southness = (a) => Math.max(0, Math.sin(a)); // +z = south
      const hgt = (a, i) => (1 - southness(a) * 0.95) * (18 + 40 * noise1(a * 3 + 1.7) + 30 * noise1(a * 7.1 + i) * (1 - southness(a)));
      const h0 = hgt(a0, 0);
      const h1 = hgt(a1, 0);
      const p0 = new THREE.Vector3(cx + Math.cos(a0) * R, -2, cz + Math.sin(a0) * R);
      const p1 = new THREE.Vector3(cx + Math.cos(a1) * R, -2, cz + Math.sin(a1) * R);
      const q0 = p0.clone().setY(h0);
      const q1 = p1.clone().setY(h1);
      g.quad('arch_mud', p0, p1, q1, q0, null, { ao: 0.5 });
    }
  }

  // ---------------------------------------------------------- the Moonsea
  const waterNormal = getTextureSet('hd_water').normalMap;
  const water = new THREE.MeshStandardMaterial({ color: night > 0.5 ? 0x060a10 : 0x1e3444, roughness: 0.14, metalness: 0.0, normalMap: waterNormal, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.2 });
  const wgeo = new THREE.PlaneGeometry(1600, 900, 1, 1);
  wgeo.rotateX(-Math.PI / 2);
  const uv = wgeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 160, uv.getY(i) * 90);
  if (harbour) sunGlitter(water, opts.sunDir, opts.sunColor);
  if (harbour) {
    // a true mirror: the hulls, sails, quay and sky reflected in the swell
    const k = timeOfDayKeys(opts.hour ?? 12);
    const sea = createSea({
      normalMap: waterNormal,
      size: [1600, 900],
      deep: new THREE.Color(night > 0.5 ? 0x02050a : 0x183038),
      sunDir: opts.sunDir ?? new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(opts.sunColor ?? 0xffd8a0).multiplyScalar(night > 0.5 ? 0.5 : 1),
      skyTop: new THREE.Color(k.top),
      skyHor: new THREE.Color(k.hor),
      fogColor: new THREE.Color(k.fog),
      fogDensity: k.fogDensity * 0.3,
      night,
    });
    sea.position.set(cx, -0.42, H + 442);
    group.add(sea);
    own.push(wgeo, water, { dispose: () => sea.dispose() });
  } else {
    const wmesh = new THREE.Mesh(wgeo, water);
    wmesh.position.set(cx, -2.6, H + 26 + 450);
    wmesh.receiveShadow = false;
    wmesh.renderOrder = 6;
    group.add(wmesh);
    own.push(wgeo, water);
  }
  // quay wall along the harbour
  if (!harbour) g.box('arch_stone_cold', { c: [cx, -2.2, H + 26], s: [800, 1.4, 1.6], ao: 0.8 });
  const rig = { sails: [], lines: [], lamps: [] };
  // warm lit windows that read even at dusk (lighthouse, keep): their own unlit emissive mesh
  const glow = new GeoBuilder();
  const shadows = [];
  let beacon = null;
  if (harbour) {
    // moored and anchored cogs (clinker hulls, castles, set or furled sails, shrouds with ratlines)
    // an anchorage, not a parade: cogs at staggered depths, swinging to their cables at different
    // headings, sails set on some and furled on others (dx from the block centre, dz past the quay)
    // one hero cog lying broadside at mid-distance, the rest scattered in depth, heading and size
    const FLEET = [[-4, 30, 0.42, 18, true], [-36, 52, 2.35, 12, false], [24, 78, 3.55, 11, true], [40, 40, 1.05, 14, false], [-66, 104, 0.45, 10, true], [74, 128, 2.9, 12, false], [6, 150, 1.6, 9, false]];
    FLEET.forEach(([dx, dz, rot, len, set], k) => {
      const x = cx + dx + (hash(seedBase, k, 'hx') - 0.5) * 4;
      const z = H + dz + (hash(seedBase, k, 'hz') - 0.5) * 4;
      const M = new THREE.Matrix4().makeTranslation(x, -0.2, z).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(new THREE.Matrix4().makeRotationX((hash(k, 'heel') - 0.5) * 0.06));
      buildCog(g, M, { len, seed: k + 1, set }, rig);
      shadows.push([x, z, len * 0.62, rot]);
    });
    // breakwater running out into the bay: rough blocks with a paved top and a beacon tower at its head
    {
      const bx = cx - 70;
      const bz = H + 70;
      const ang = 0.5;
      const dirx = Math.sin(ang);
      const dirz = Math.cos(ang);
      for (let k = 0; k < 40; k++) {
        const t = (k / 40 - 0.5) * 120;
        const px = bx + dirx * t;
        const pz = bz + dirz * t;
        g.box('arch_stone_cold', { c: [px, -0.35 + hash(k, 'bwh') * 0.15, pz], s: [6 + hash(k, 'bww') * 0.8, 1.5, 3.1], rotY: ang + (hash(k, 'bwr') - 0.5) * 0.06, chamfer: 0.25, ao: 0.75, tint: [0.8 + hash(k, 'bt') * 0.25, 0.8 + hash(k, 'bt') * 0.25, 0.8 + hash(k, 'bt') * 0.22] });
        if (k % 3 === 0) g.box('arch_ruin', { c: [px + dirz * 3.4, -0.6, pz - dirx * 3.4], s: [1.6, 1.0, 1.4], rotY: hash(k, 'rr') * 3, chamfer: 0.3, ao: 0.6 });
      }
    }
    beacon = beaconTower(g, glow, cx - 40, H + 122, -0.6);
    // Sokol Keep on its island: a dark crag with a black curtain wall and keep
    {
      const ix = cx + 150;
      const iz = H + 300;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const r = 26 + hash(k, 'isl') * 10;
        const rock = new THREE.IcosahedronGeometry(1, 1);
        g.geometry('arch_ruin', rock, new THREE.Matrix4().makeTranslation(ix + Math.cos(a) * r * 0.6, -1, iz + Math.sin(a) * r * 0.4).multiply(new THREE.Matrix4().makeScale(r * 0.55, 6 + hash(k, 'ih') * 8, r * 0.45)), { uv: 'world', ao: 0.6, tint: [0.55, 0.55, 0.58] });
        rock.dispose();
      }
      sokolKeep(g, glow, ix, iz);
    }
    // the far shore: two receding ridges of hills across the water, with a dark tree line
    for (const [dist, amp, base, tnt] of [[520, 14, 4, 0.55], [380, 7, 1.5, 0.7]]) {
      for (let k = 0; k < 48; k++) {
        const x0 = cx - 700 + k * 30;
        const h0 = base + noise1(k * 0.35 + dist) * amp + noise1(k * 1.7 + dist * 0.3) * amp * 0.25;
        const h1 = base + noise1((k + 1) * 0.35 + dist) * amp + noise1((k + 1) * 1.7 + dist * 0.3) * amp * 0.25;
        g.quad('arch_mud', new THREE.Vector3(x0, -0.5, H + dist), new THREE.Vector3(x0 + 30, -0.5, H + dist), new THREE.Vector3(x0 + 30, h1, H + dist), new THREE.Vector3(x0, h0, H + dist), null, { ao: 0.5, tint: [tnt * 0.8, tnt * 0.9, tnt] });
      }
    }
  }
  // a few moored cogs' masts as silhouettes
  for (let k = 0; k < (harbour ? 0 : 6); k++) {
    const x = cx + (hash(seedBase, k, 'ship') - 0.5) * 140;
    const z = H + 34 + hash(seedBase, k, 'sz') * 30;
    g.box('arch_beam_dark', { c: [x, -1.6, z], s: [7, 1.6, 2.4], chamfer: 0.4, ao: 0.6 });
    g.box('arch_beam_dark', { c: [x, 4, z], s: [0.25, 11, 0.25], ao: 0.6 });
    g.box('arch_beam_dark', { c: [x, 7.5, z], s: [0.15, 0.15, 5], ao: 0.6 });
  }

  // ---------------------------------------------------------- assemble
  for (const [key, geo] of g.build()) {
    const mesh = new THREE.Mesh(geo, getLambertMaterial(key));
    mesh.name = `sky:${key}`;
    mesh.renderOrder = 5;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    own.push(geo);
  }
  // sails (cloth) and rigging (lines)
  if (rig.sails.length) {
    const arr = rig.sails;
    const n = arr.length / 5;
    const pos = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos.set([arr[i * 5], arr[i * 5 + 1], arr[i * 5 + 2]], i * 3);
      uvs.set([arr[i * 5 + 3], arr[i * 5 + 4]], i * 2);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    // weld the triangle soup so the cloth shades smoothly (no facets on the bellied sail)
    const sgw = mergeVertices(sg, 1e-3);
    sgw.computeVertexNormals();
    sg.dispose();
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    drawSail(c.getContext('2d'), 256, 256, 11);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sm = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, color: night > 0.5 ? 0x50586a : 0xf0e8dc });
    const mesh = new THREE.Mesh(sgw, sm);
    mesh.renderOrder = 5;
    group.add(mesh);
    own.push(sgw, sm, tex);
  }
  if (rig.lines.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(rig.lines, 3));
    const lm = new THREE.LineBasicMaterial({ color: 0x1a140f, transparent: true, opacity: 0.75 });
    const lines = new THREE.LineSegments(lg, lm);
    lines.renderOrder = 5;
    group.add(lines);
    own.push(lg, lm);
  }
  if (shadows.length) {
    // dark reflections of the hulls on the water (cheap stand-in for planar reflection): a soft dark
    // pool along the hull, streaked toward the viewer, plus a broken ring of foam/wavelets at the
    // waterline so each hull sits *in* the water
    const pos = [];
    const uvs = [];
    const fpos = [];
    const fuv = [];
    for (const [x, z, r, rot] of shadows) {
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      const P2 = (u, v, k = 1) => [x + (u * ca + v * sa) * k, z + (-u * sa + v * ca) * k];
      for (const [a, c] of [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]) {
        const [px, pz] = P2(a * r, c * r * 0.5);
        pos.push(px, -0.38, pz - (c > 0 ? 0 : r * 0.5));
        uvs.push((a + 1) / 2, (c + 1) / 2);
        const [fx, fz] = P2(a * r * 1.12, c * r * 0.46);
        fpos.push(fx, -0.37, fz);
        fuv.push((a + 1) / 2, (c + 1) / 2);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const sm = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, alphaMap: softAlpha() });
    // (the mirror sea reflects the hulls themselves: the dark stand-in pools are only for the far bay)
    if (!harbour) {
      const mesh = new THREE.Mesh(sg, sm);
      mesh.renderOrder = 7;
      group.add(mesh);
    }
    own.push(sg, sm);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    const fm = new THREE.MeshBasicMaterial({ color: night > 0.5 ? 0x30384a : 0xd8d4cc, transparent: true, opacity: night > 0.5 ? 0.25 : 0.42, depthWrite: false, alphaMap: foamAlpha() });
    const fmesh = new THREE.Mesh(fg, fm);
    fmesh.renderOrder = 7;
    group.add(fmesh);
    own.push(fg, fm);
  }
  const gw = glow.build().get('glow');
  if (gw) {
    gw.deleteAttribute('color');
    const gm = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: new THREE.Color(0xffa04a).multiplyScalar(0.55 + 1.1 * Math.min(1, night * 1.5 + ((opts.hour ?? 12) > 16.5 ? 0.35 : 0))), fog: true });
    const mesh = new THREE.Mesh(gw, gm);
    mesh.renderOrder = 5;
    group.add(mesh);
    own.push(gw, gm);
  }
  if (rig.lamps.length) {
    // stern lanterns: a warm horn-glazed box and a soft halo, brighter as the light goes
    const k = 0.5 + 1.4 * Math.min(1, night * 1.5 + ((opts.hour ?? 12) > 16.5 ? 0.4 : 0));
    const lb = new GeoBuilder();
    for (const p of rig.lamps) lb.box('lamp', { c: [p.x, p.y, p.z], s: [0.26, 0.4, 0.26] });
    const lgeo = lb.build().get('lamp');
    lgeo.deleteAttribute('color');
    const lmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb862).multiplyScalar(k), fog: true });
    group.add(new THREE.Mesh(lgeo, lmat));
    const halo = createGlowBatch(rig.lamps.map((p, i) => ({ pos: p, size: 1.4, color: 0xffa050, seed: i * 3.1, opacity: Math.min(1, 0.35 + night * 0.8) })));
    group.add(halo);
    own.push(lgeo, lmat, { dispose: () => halo.userData.dispose() });
  }
  if (beacon && (night > 0.2 || (opts.hour ?? 12) > 16.5)) {
    const fl = createFlameBatch([{ pos: beacon, scale: 2.6 }]);
    group.add(fl);
    own.push(fl.geometry);
  }
  const lit = winLit.build().get('win');
  if (lit) {
    const mesh = new THREE.Mesh(lit, getWindowMaterial('ext'));
    group.add(mesh);
    own.push(lit);
  }
  const dark = winDark.build().get('win');
  if (dark) {
    const m = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.3, map: getWindowMaterial('ext').map });
    const mesh = new THREE.Mesh(dark, m);
    group.add(mesh);
    own.push(dark, m);
  }
  return {
    group,
    water,
    smoke,
    dispose() {
      for (const o of own) o.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * Sun glitter on the sea: a sparkling path of facets toward the low sun
 * (high-power specular on the perturbed normal, broken up by a sparkle noise).
 */
function sunGlitter(mat, sunDir, sunColor) {
  if (!sunDir) return;
  const uSun = { value: sunDir.clone().normalize() };
  const uCol = { value: new THREE.Color(sunColor ?? 0xffd8a0) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlSun = uSun;
    sh.uniforms.uGlCol = uCol;
    sh.uniforms.uTime = PROP_TIME;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGlW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvGlW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlSun; uniform vec3 uGlCol; uniform float uTime; varying vec3 vGlW;\nfloat glH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 sv = normalize((viewMatrix * vec4(uGlSun, 0.0)).xyz);
          vec3 r = reflect(-normalize(vViewPosition), normal);
          float lobe = pow(max(dot(r, sv), 0.0), 60.0);
          vec2 cell = floor(vGlW.xz * 3.0 + vec2(uTime * 0.7, uTime * 0.4));
          float sparkle = step(0.82, glH(cell)) * (0.6 + 0.4 * sin(uTime * 6.0 + glH(cell + 3.1) * 40.0));
          float broad = pow(max(dot(r, sv), 0.0), 8.0) * 0.08;
          reflectedLight.directSpecular += uGlCol * (lobe * (0.4 + sparkle * 4.0) + broad);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'sea_glitter';
}

let _foamAlpha = null;
/** Broken elliptical ring of foam (alpha): bright at the hull line, flecked and fading outward. */
function foamAlpha() {
  if (_foamAlpha) return _foamAlpha;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  let s = 5;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2;
    const rr = 0.66 + Math.pow(r(), 2.5) * 0.3;
    const x = 64 + Math.cos(a) * rr * 60;
    const y = 64 + Math.sin(a) * rr * 60;
    g.fillStyle = `rgba(255,255,255,${(1 - (rr - 0.66) / 0.3) * (0.25 + r() * 0.5)})`;
    g.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
  }
  _foamAlpha = new THREE.CanvasTexture(c);
  return _foamAlpha;
}

let _softAlpha = null;
function softAlpha() {
  if (_softAlpha) return _softAlpha;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(1, '#000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _softAlpha = new THREE.CanvasTexture(c);
  return _softAlpha;
}

function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i, 'n1');
  const b = hash(i + 1, 'n1');
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

function house(g, winLit, winDark, x, y0, z, w, d, h, rotX, ruined, id, night, cx, cz, smoke) {
  const plaster = hash(id, 'mat') < 0.55;
  const wallKey = ruined ? 'arch_ruin' : plaster ? 'arch_plaster' : 'arch_stone';
  // limewash in many batches: cream, ochre, ox-blood, sage, rose and smoke-browned daub
  const tints = [[1, 0.96, 0.86], [0.92, 0.9, 0.84], [1, 0.86, 0.64], [0.86, 0.62, 0.5], [0.8, 0.84, 0.76], [0.98, 0.82, 0.76], [0.72, 0.66, 0.58], [0.86, 0.88, 0.9]];
  const tint = plaster ? tints[Math.floor(hash(id, 't') * tints.length)] : ruined ? [0.7, 0.66, 0.62] : [0.9 + hash(id, 'st') * 0.2, 0.88 + hash(id, 'st') * 0.18, 0.85 + hash(id, 'st') * 0.15];
  if (ruined) {
    // a burnt-out shell: charred wall heads, a few blackened rafters still spanning the gap
    const ch = [0.42, 0.38, 0.35];
    for (let k = 0; k < 3; k++) {
      if (hash(id, k, 'raft') < 0.45) continue;
      const along = (k - 1) * (rotX ? w : d) * 0.3;
      const hh = h * (0.55 + hash(id, k, 'rh') * 0.3);
      const ang = (hash(id, k, 'ra') - 0.5) * 0.5;
      const m = new THREE.Matrix4().makeTranslation(x + (rotX ? along : 0), y0 + hh, z + (rotX ? 0 : along)).multiply(new THREE.Matrix4().makeRotationY(rotX ? 0 : Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationX(ang));
      g.box('arch_beam_dark', { matrix: m, s: [0.16, 0.18, (rotX ? d : w) * 0.95], ao: 0.8, tint: [0.3, 0.26, 0.24] });
    }
    void ch;
    // jagged broken shell: 4 walls with random heights
    const th = 0.4;
    for (const [sx, sz, lx, lz] of [[0, -1, w, th], [0, 1, w, th], [-1, 0, th, d], [1, 0, th, d]]) {
      const n = 3;
      for (let k = 0; k < n; k++) {
        const hh = h * (0.3 + hash(id, sx, sz, k) * 0.7);
        const off = (k - (n - 1) / 2) / n;
        const px = x + sx * (w / 2) + (lz > lx ? 0 : off * w);
        const pz = z + sz * (d / 2) + (lz > lx ? off * d : 0);
        g.box(wallKey, { c: [px, y0 + hh / 2, pz], s: [lx > lz ? w / n : th, hh, lz > lx ? d / n : th], tint: hh > h * 0.75 ? [0.55, 0.5, 0.47] : tint });
      }
    }
    return;
  }
  const jetty = plaster && h > 5 && hash(id, 'jet') < 0.6;
  if (jetty) {
    // ground storey in stone, the upper storeys jettied out over it on a bressumer
    g.box('arch_stone', { c: [x, y0 + 1.4, z], s: [w - 0.4, 2.8, d - 0.4], tint: [0.85, 0.83, 0.8] });
    g.box(wallKey, { c: [x, y0 + 2.8 + (h - 2.8) / 2, z], s: [w, h - 2.8, d], tint });
    g.box('arch_beam_dark', { c: [x, y0 + 2.8, z], s: [w + 0.08, 0.22, d + 0.08], ao: 0.7 });
  } else g.box(wallKey, { c: [x, y0 + h / 2, z], s: [w, h, d], tint });
  // gable roof
  const A = rotX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const B = rotX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const la = (rotX ? w : d) / 2 + 0.3;
  const lb = (rotX ? d : w) / 2 + 0.4;
  const rise = lb * (0.55 + hash(id, 'pitch') * 0.95);
  const P = (a, yy, b) => new THREE.Vector3(x, yy, z).addScaledVector(A, a).addScaledVector(B, b);
  const rk = ['arch_roof_slate', 'arch_roof_clay', 'arch_roof_slate'][Math.floor(hash(id, 'rk') * 3)];
  const top = y0 + h;
  const slope = Math.hypot(lb, rise);
  for (const sb of [-1, 1]) {
    const r0 = P(-la, top + rise, 0);
    const r1 = P(la, top + rise, 0);
    const e1 = P(la, top - 0.3, sb * lb);
    const e0 = P(-la, top - 0.3, sb * lb);
    const n = new THREE.Vector3().subVectors(r1, r0).cross(new THREE.Vector3().subVectors(e0, r0));
    const uvs = [[-la / 2, 0], [la / 2, 0], [la / 2, slope / 2], [-la / 2, slope / 2]];
    if (n.y > 0) g.quad(rk, r0, r1, e1, e0, uvs, { ao: 0.85 });
    else g.quad(rk, r1, r0, e0, e1, [uvs[1], uvs[0], uvs[3], uvs[2]], { ao: 0.85 });
  }
  for (const sa of [-1, 1]) {
    const aa = sa * (la - 0.3);
    const q0 = P(aa, top, -lb + 0.4);
    const q1 = P(aa, top, lb - 0.4);
    const q2 = P(aa, top + rise * 0.92, 0);
    const n = new THREE.Vector3().subVectors(q1, q0).cross(new THREE.Vector3().subVectors(q2, q0));
    const out = A.clone().multiplyScalar(sa);
    g.tri(wallKey, n.dot(out) > 0 ? [q0, q1, q2] : [q0, q2, q1], null, { ao: 0.9, tint });
    if (plaster) {
      // gable timbering: tie beam, king post and a collar, so the gable is framed, not a blank plane
      const o = A.clone().multiplyScalar(sa * (la - 0.26));
      const ctr = new THREE.Vector3(x, 0, z).add(o);
      const ang = Math.atan2(B.x, B.z);
      const bm = (cy, along, sx, sy) => g.box('arch_beam_dark', { c: [ctr.x + B.x * along, cy, ctr.z + B.z * along], s: [sx, sy, 0.1], rotY: ang - Math.PI / 2, ao: 0.8 });
      bm(top + 0.06, 0, lb * 2 - 0.8, 0.16);
      bm(top + rise * 0.46, 0, 0.14, rise * 0.92);
      bm(top + rise * 0.5, 0, lb - 0.55, 0.12);
    }
  }
  // ridge tiles, fascia boards under the eaves and bargeboards up the gables
  {
    const ridgeC = P(0, top + rise + 0.05, 0);
    g.box(rk, { c: [ridgeC.x, ridgeC.y, ridgeC.z], s: rotX ? [la * 2 + 0.1, 0.22, 0.3] : [0.3, 0.22, la * 2 + 0.1], ao: 0.8, tint: [0.75, 0.72, 0.7] });
    for (const sb of [-1, 1]) {
      const e = P(0, top - 0.42, sb * (lb - 0.02));
      g.box('arch_beam_dark', { c: [e.x, e.y, e.z], s: rotX ? [la * 2, 0.2, 0.08] : [0.08, 0.2, la * 2], ao: 0.7 });
    }
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const a0 = P(sa * (la + 0.02), top - 0.3, sb * lb);
        const a1 = P(sa * (la + 0.02), top + rise, 0);
        const mid = a0.clone().lerp(a1, 0.5);
        const len = a0.distanceTo(a1);
        const ang = Math.atan2(rise + 0.3, lb);
        const m = new THREE.Matrix4().makeTranslation(mid.x, mid.y, mid.z);
        if (rotX) m.multiply(new THREE.Matrix4().makeRotationX(sb * ang));
        else m.multiply(new THREE.Matrix4().makeRotationZ(-sb * ang));
        g.box('arch_beam_dark', { matrix: m, s: rotX ? [0.08, 0.22, len] : [len, 0.22, 0.08], ao: 0.75 });
      }
    }
  }
  if (hash(id, 'ch') < 0.45) {
    const p = P(la * 0.5, top + rise * 0.7, lb * 0.3);
    g.box('arch_brick', { c: [p.x, p.y + 0.6, p.z], s: [0.7, rise * 0.6 + 1.4, 0.7], ao: 0.8 });
    if (hash(id, 'smoke') < 0.5) smoke.push(new THREE.Vector3(p.x, p.y + rise * 0.3 + 1.4, p.z));
  }
  // windows on the two faces most visible from the block
  const toC = new THREE.Vector3(cx - x, 0, cz - z).normalize();
  for (const [nx, nz, len] of [[1, 0, d], [-1, 0, d], [0, 1, w], [0, -1, w]]) {
    if (nx * toC.x + nz * toC.z < 0.2) continue;
    const floors = Math.floor((h - 1) / 2.6);
    const cols = Math.max(1, Math.floor(len / 1.6));
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        if (hash(id, f, c, nx, nz) < 0.3) continue;
        const along = (c - (cols - 1) / 2) * (len / cols);
        const px = x + nx * ((nx ? w : 0) / 2 + 0.03) + (nz ? along : 0);
        const pz = z + nz * ((nz ? d : 0) / 2 + 0.03) + (nx ? along : 0);
        const wy = y0 + 1.4 + f * 2.6;
        const T = new THREE.Vector3(-nz, 0, nx);
        const P0 = new THREE.Vector3(px, wy, pz).addScaledVector(T, -0.35);
        const P1 = new THREE.Vector3(px, wy, pz).addScaledVector(T, 0.35);
        const P2 = P1.clone().setY(wy + 1.1);
        const P3 = P0.clone().setY(wy + 1.1);
        // by day every pane is glazing that reflects the sky (the ext window material); by night
        // some glow and the rest go dark
        const lit = night <= 0.3 || hash(id, f, c, 'lit') < 0.6;
        (lit ? winLit : winDark).quad('win', P1, P0, P3, P2, [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
        // frame, mullion and sill so windows read as joinery, not holes
        const fk = plaster ? 'arch_beam_dark' : 'arch_trim';
        const N = new THREE.Vector3(nx, 0, nz);
        const ctr = new THREE.Vector3(px, wy + 0.55, pz).addScaledVector(N, 0.04);
        const ang = Math.atan2(T.x, T.z);
        const box = (k, dt, dy, sx, sy, sz) => g.box(k, { c: ctr.clone().addScaledVector(T, dt).add(new THREE.Vector3(0, dy, 0)), s: [sx, sy, sz], rotY: ang - Math.PI / 2, ao: 0.85 });
        box(fk, -0.4, 0, 0.1, 1.25, 0.1);
        box(fk, 0.4, 0, 0.1, 1.25, 0.1);
        box(fk, 0, 0.6, 0.9, 0.12, 0.12);
        box(fk, 0, 0, 0.05, 1.1, 0.06);
        box('arch_trim', 0, -0.6, 0.95, 0.08, 0.2);
      }
    }
    // timber framing on plaster houses: floor rails, corner posts, braces
    if (plaster) {
      const N = new THREE.Vector3(nx, 0, nz);
      const T = new THREE.Vector3(-nz, 0, nx);
      const fc = new THREE.Vector3(x + nx * (w / 2 + 0.05), 0, z + nz * (d / 2 + 0.05));
      const ang = Math.atan2(T.x, T.z);
      const bx = (dt, y, sx, sy, rz = 0) => {
        const m = new THREE.Matrix4().makeTranslation(fc.x + T.x * dt, y, fc.z + T.z * dt).multiply(new THREE.Matrix4().makeRotationY(ang - Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationZ(rz));
        g.box('arch_beam_dark', { matrix: m, s: [sx, sy, 0.1], ao: 0.85 });
      };
      for (let fy = 0; fy * 2.6 < h - 0.5; fy++) bx(0, y0 + fy * 2.6 + 0.08, len + 0.1, 0.16);
      bx(0, y0 + h - 0.1, len + 0.1, 0.18);
      for (const e of [-1, 1]) bx(e * (len / 2 - 0.08), y0 + h / 2, 0.18, h);
      // studs between the window bays on every storey, so the frame reads as joinery at range
      const cols = Math.max(1, Math.floor(len / 1.6));
      for (let fy = 0; fy * 2.6 < h - 1; fy++) {
        const sh = Math.min(2.6, h - fy * 2.6) - 0.2;
        for (let c = 0; c < cols - 1; c++) bx((c - (cols - 1) / 2 + 0.5) * (len / cols), y0 + fy * 2.6 + 0.1 + sh / 2, 0.12, sh);
      }
      // a rubble-stone plinth under the sill beam
      g.box('arch_stone', { c: [fc.x - N.x * 0.03, y0 + 0.02 + 0.35, fc.z - N.z * 0.03], s: nx ? [0.08, 0.7, len] : [len, 0.7, 0.08], ao: 0.7, tint: [0.8, 0.78, 0.74] });
      if (hash(id, nx, nz, 'brace') < 0.7) {
        const fl = Math.min(2.6, h) - 0.2;
        for (const e of [-1, 1]) bx(e * (len / 2 - 0.55), y0 + 0.1 + fl / 2 + 2.6 * (h > 5.5 ? 1 : 0), 0.12, Math.hypot(0.9, fl), e * Math.atan2(0.9, fl));
      }
    }
  }
}

/** Warm window slot on a cylinder face (glow builder), facing outward at angle a. */
function glowSlot(glow, x, z, r, a, y, w, h) {
  const nx = Math.cos(a);
  const nz = Math.sin(a);
  const T = new THREE.Vector3(-nz, 0, nx);
  const c = new THREE.Vector3(x + nx * (r + 0.04), y, z + nz * (r + 0.04));
  const P0 = c.clone().addScaledVector(T, -w / 2);
  const P1 = c.clone().addScaledVector(T, w / 2);
  glow.quad('glow', P1, P0, P0.clone().setY(y + h), P1.clone().setY(y + h), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
}

/**
 * The harbour light at the head of the breakwater: a battered drum with a corbelled,
 * crenellated wall-walk, a narrower upper stage with string courses and warm windows, and an
 * open lantern of stone piers under a slate cap. Returns the fire position.
 */
function beaconTower(g, glow, x, z, base) {
  const sides = 16;
  const ring = (r0, r1, y0, h, key, tint) => {
    const geo = new THREE.CylinderGeometry(r1, r0, h, sides, 1, true);
    g.geometry(key, geo, new THREE.Matrix4().makeTranslation(x, base + y0 + h / 2, z), { uv: 'world', ao: 0.85, tint });
    geo.dispose();
  };
  const cap = (r, y) => {
    const geo = new THREE.CylinderGeometry(r, r, 0.2, sides, 1, false);
    g.geometry('arch_stone_cold', geo, new THREE.Matrix4().makeTranslation(x, base + y, z), { uv: 'world', ao: 0.9 });
    geo.dispose();
  };
  // stage 1: battered drum on a rough plinth
  ring(5.0, 5.3, 0, 1.6, 'arch_stone_cold', [0.6, 0.62, 0.6]);
  ring(4.6, 4.2, 1.6, 6.4, 'arch_stone_cold');
  // corbel table + crenellated wall-walk
  ring(4.25, 4.75, 8.0, 0.7, 'arch_trim', [0.75, 0.73, 0.7]);
  ring(4.75, 4.75, 8.7, 1.0, 'arch_stone_cold');
  cap(4.75, 9.7);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    g.box('arch_stone_cold', { c: [x + Math.cos(a) * 4.55, base + 10.25, z + Math.sin(a) * 4.55], s: [0.95, 1.0, 0.45], rotY: -a + Math.PI / 2, ao: 0.9 });
  }
  // stage 2: the tower proper, string courses, warm windows climbing the stair
  ring(3.0, 2.8, 9.7, 7.8, 'arch_stone_cold');
  for (const y of [12.2, 14.8]) ring(3.02, 3.02, y, 0.3, 'arch_trim', [0.75, 0.73, 0.7]);
  ring(2.8, 3.25, 17.5, 0.5, 'arch_trim', [0.75, 0.73, 0.7]);
  cap(3.25, 18.0);
  for (let k = 0; k < 4; k++) glowSlot(glow, x, z, 2.88, -1.2 + k * 0.9, base + 10.8 + k * 1.7, 0.45, 0.95);
  for (let k = 0; k < 3; k++) glowSlot(glow, x, z, 4.3, -1.0 + k * 1.1, base + 4.5 + (k % 2) * 1.5, 0.5, 1.0);
  // stage 3: open lantern — six stone piers, the fire inside, a slate cone over all
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.box('arch_stone_cold', { c: [x + Math.cos(a) * 2.2, base + 19.3, z + Math.sin(a) * 2.2], s: [0.55, 2.6, 0.55], rotY: -a, ao: 0.85 });
  }
  cap(2.6, 20.6);
  const cone = new THREE.ConeGeometry(2.9, 3.0, 16, 2, true);
  g.geometry('arch_roof_slate', cone, new THREE.Matrix4().makeTranslation(x, base + 22.2, z), { uv: 'world', ao: 0.85 });
  cone.dispose();
  return new THREE.Vector3(x, base + 18.2, z);
}

/** Sokol Keep: a crenellated curtain on its crag, round corner towers, a stepped square keep. */
function sokolKeep(g, glow, ix, iz) {
  const dark = [0.36, 0.36, 0.4];
  g.box('arch_stone_cold', { c: [ix, 10, iz], s: [34, 8, 20], ao: 0.6, tint: dark });
  // wall-walk merlons along all four sides
  for (const [ax, len, fixed, alongX] of [[0, 34, -10, true], [0, 34, 10, true], [-17, 20, 0, false], [17, 20, 0, false]]) {
    const n = Math.round(len / 1.8);
    for (let k = 0; k < n; k++) {
      const t = -len / 2 + (k + 0.5) * (len / n);
      const c = alongX ? [ix + t, 14.6, iz + fixed] : [ix + ax, 14.6, iz + t];
      g.box('arch_stone_cold', { c, s: alongX ? [1.0, 1.2, 0.8] : [0.8, 1.2, 1.0], ao: 0.85, tint: dark });
    }
  }
  for (const [dx, dz] of [[-17, -10], [17, -10], [-17, 10], [17, 10]]) {
    const geo = new THREE.CylinderGeometry(2.5, 2.8, 12, 12, 1, true);
    g.geometry('arch_stone_cold', geo, new THREE.Matrix4().makeTranslation(ix + dx, 12, iz + dz), { uv: 'world', ao: 0.75, tint: dark });
    geo.dispose();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.box('arch_stone_cold', { c: [ix + dx + Math.cos(a) * 2.6, 18.6, iz + dz + Math.sin(a) * 2.6], s: [0.9, 1.2, 0.6], rotY: -a + Math.PI / 2, ao: 0.85, tint: dark });
    }
    glowSlot(glow, ix + dx, iz + dz, 2.55, -Math.PI / 2, 13 + (dx > 0 ? 1.5 : 0), 0.35, 0.9);
  }
  // the keep: a tall square donjon, a set-back upper stage with its own battlements and a turret
  const kx = ix + 3;
  const kz = iz + 1;
  g.box('arch_stone_cold', { c: [kx, 17, kz], s: [10, 18, 9], ao: 0.7, tint: [0.4, 0.4, 0.44] });
  g.box('arch_trim', { c: [kx, 26.3, kz], s: [10.8, 0.6, 9.8], ao: 0.85, tint: [0.6, 0.6, 0.62] });
  for (let k = 0; k < 6; k++) {
    for (const sz of [-1, 1]) g.box('arch_stone_cold', { c: [kx - 4.6 + k * 1.84, 27.2, kz + sz * 4.7], s: [1.0, 1.2, 0.6], ao: 0.85, tint: dark });
  }
  g.box('arch_stone_cold', { c: [kx - 1, 29.5, kz], s: [6, 5, 5.5], ao: 0.7, tint: [0.42, 0.42, 0.46] });
  for (let k = 0; k < 4; k++) g.box('arch_stone_cold', { c: [kx - 3.4 + k * 1.6, 32.6, kz - 2.75], s: [0.9, 1.1, 0.5], ao: 0.85, tint: dark });
  const tur = new THREE.CylinderGeometry(1.2, 1.2, 6, 10, 1, true);
  g.geometry('arch_stone_cold', tur, new THREE.Matrix4().makeTranslation(kx + 3.8, 31, kz - 3.6), { uv: 'world', ao: 0.8, tint: dark });
  tur.dispose();
  const tc = new THREE.ConeGeometry(1.5, 2.6, 10, 1, true);
  g.geometry('arch_roof_slate', tc, new THREE.Matrix4().makeTranslation(kx + 3.8, 35.3, kz - 3.6), { uv: 'world', ao: 0.85 });
  tc.dispose();
  // warm windows on the face toward the city (-z)
  const wq = (x, y, w, h) => {
    const z = kz - 4.52;
    glow.quad('glow', new THREE.Vector3(x - w / 2, y, z), new THREE.Vector3(x + w / 2, y, z), new THREE.Vector3(x + w / 2, y + h, z), new THREE.Vector3(x - w / 2, y + h, z), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
  };
  wq(kx - 2.5, 20, 0.6, 1.4);
  wq(kx + 1.5, 22.5, 0.6, 1.4);
  wq(kx - 0.5, 16.5, 0.5, 1.1);
  glow.quad('glow', new THREE.Vector3(kx - 2.5, 29, kz - 2.77), new THREE.Vector3(kx - 1.9, 29, kz - 2.77), new THREE.Vector3(kx - 1.9, 30.3, kz - 2.77), new THREE.Vector3(kx - 2.5, 30.3, kz - 2.77), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
}

function tower(g, x, z, r, h, broken, id, night, winLit, base = -0.5) {
  const sides = 8;
  if (broken) {
    brokenTower(g, x, z, r, h, id, base);
    return;
  }
  const geo = new THREE.CylinderGeometry(r, r * 1.08, h, sides, 1, true);
  g.geometry('arch_stone_cold', geo, new THREE.Matrix4().makeTranslation(x, base + h / 2, z), { uv: 'world' });
  geo.dispose();
  if (!broken) {
    // string courses so the shaft reads as built masonry at a distance, and a darker weathered base
    for (const f of [0.33, 0.66]) {
      const ring = new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.35, sides, 1, true);
      g.geometry('arch_trim', ring, new THREE.Matrix4().makeTranslation(x, base + h * f, z), { uv: 'world', ao: 0.8, tint: [0.75, 0.73, 0.7] });
      ring.dispose();
    }
    const plinth = new THREE.CylinderGeometry(r * 1.12, r * 1.2, 1.6, sides, 1, true);
    g.geometry('arch_stone_cold', plinth, new THREE.Matrix4().makeTranslation(x, base + 0.8, z), { uv: 'world', ao: 0.6, tint: [0.6, 0.62, 0.6] });
    plinth.dispose();
    for (let k = 0; k < 3; k++) {
      // dark slit windows up the shaft
      const a = k * 2.1 + hash(id, 'sl') * 6;
      g.box('arch_beam_dark', { c: [x + Math.cos(a) * (r + 0.02), base + h * (0.25 + k * 0.22), z + Math.sin(a) * (r + 0.02)], s: [0.25, 1.1, 0.3], rotY: -a, tint: [0.15, 0.12, 0.1] });
    }
    // corbelled parapet + merlons, or a conical roof
    if (hash(id, 'cone') < 0.5 && id !== 'beacon' && !g.noCones) {
      const cone = new THREE.ConeGeometry(r * 1.25, r * 2.4, 20, 3, true);
      g.geometry('arch_roof_slate', cone, new THREE.Matrix4().makeTranslation(x, base + h + r * 1.2, z), { uv: 'world', ao: 0.85 });
      cone.dispose();
    } else {
      const ring = new THREE.CylinderGeometry(r * 1.18, r * 1.05, 1.2, sides, 1, false);
      g.geometry('arch_stone_cold', ring, new THREE.Matrix4().makeTranslation(x, base + h + 0.6, z), { uv: 'world' });
      ring.dispose();
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
        g.box('arch_stone_cold', { c: [x + Math.cos(a) * r * 1.1, base + h + 1.7, z + Math.sin(a) * r * 1.1], s: [0.7, 1.0, 0.7], rotY: -a });
      }
    }
    // a lit arrow-slit or two at night
    if (night > 0.3 && hash(id, 'slit') < 0.6) {
      const a = hash(id, 'sa') * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const px = x + nx * (r + 0.05);
      const pz = z + nz * (r + 0.05);
      const T = new THREE.Vector3(-nz, 0, nx);
      const y = base + h * 0.6;
      const P0 = new THREE.Vector3(px, y, pz).addScaledVector(T, -0.25);
      const P1 = new THREE.Vector3(px, y, pz).addScaledVector(T, 0.25);
      winLit.quad('win', P1, P0, P0.clone().setY(y + 1.3), P1.clone().setY(y + 1.3), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    }
  }
}

/**
 * A ruined tower: a thick masonry shell whose top has fallen away in
 * course-height steps toward one side (so the break reads as masonry, never
 * as a spiky wedge), with the inner face and the wall thickness visible
 * through the breach, and a skirt of fallen stone at its foot.
 */
function brokenTower(g, x, z, r, h, id, base) {
  const sides = 14;
  const wall = 0.7;
  const course = 0.55;
  const slopeA = hash(id, 'slope') * Math.PI * 2;
  const tops = [];
  for (let k = 0; k < sides; k++) {
    const a = ((k + 0.5) / sides) * Math.PI * 2;
    const fall = 0.5 + 0.5 * Math.cos(a - slopeA); // 1 on the high side
    const t = h * (0.45 + 0.55 * fall) - hash(id, k, 'brk') * h * 0.12;
    tops.push(Math.max(course * 2, Math.round(t / course) * course));
  }
  const P = (a, rr, y) => new THREE.Vector3(x + Math.cos(a) * rr, base + y, z + Math.sin(a) * rr);
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2;
    const a1 = ((k + 1) / sides) * Math.PI * 2;
    const t = tops[k];
    const ro0 = r * 1.06;
    const ro1 = r;
    // outer face (slight batter), inner face (reversed), and the top of the wall
    g.quad('arch_ruin', P(a1, ro0, 0), P(a0, ro0, 0), P(a0, ro1, t), P(a1, ro1, t), null, { ao: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y - base, 0, 5) });
    g.quad('arch_ruin', P(a0, r - wall, 0), P(a1, r - wall, 0), P(a1, r - wall, t), P(a0, r - wall, t), null, { ao: 0.45, tint: [0.8, 0.8, 0.8] });
    g.quad('prop_rock', P(a0, r - wall, t), P(a1, r - wall, t), P(a1, ro1, t), P(a0, ro1, t), null, { ao: 0.8 });
    // the step to the next segment's height: a vertical end face of masonry
    const tn = tops[(k + 1) % sides];
    if (Math.abs(tn - t) > 0.01) {
      const lo = Math.min(t, tn);
      const hi = Math.max(t, tn);
      const ac = a1;
      const q = [P(ac, r - wall, lo), P(ac, ro1, lo), P(ac, ro1, hi), P(ac, r - wall, hi)];
      if (t > tn) g.quad('arch_ruin', q[0], q[1], q[2], q[3], null, { ao: 0.7 });
      else g.quad('arch_ruin', q[1], q[0], q[3], q[2], null, { ao: 0.7 });
    }
  }
  // fallen blocks around the foot
  for (let k = 0; k < 7; k++) {
    const a = slopeA + Math.PI + (hash(id, k, 'fa') - 0.5) * 2.2;
    const rr = r + 1 + hash(id, k, 'fr') * 4;
    const sz = 0.8 + hash(id, k, 'fs') * 1.2;
    g.box('arch_ruin', { c: [x + Math.cos(a) * rr, base + sz * 0.3, z + Math.sin(a) * rr], s: [sz * 1.3, sz * 0.7, sz], rotY: hash(id, k, 'fy') * 3, chamfer: 0.15, ao: 0.6 });
  }
}
