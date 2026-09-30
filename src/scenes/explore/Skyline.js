import * as THREE from 'three';
import { getLambertMaterial, getWindowMaterial } from '../../render/materials.js';
import { getTextureSet } from '../../render/textures/index.js';
import { GeoBuilder, hash } from './GeoBuilder.js';
import { CELL_SIZE } from './BlockBuilder.js';

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
  const own = [];
  const W = map.w * S;
  const H = map.h * S;
  const cx = W / 2;
  const cz = H / 2;
  const ruins = ts.skyline === 'ruins';
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
    if (z > H + 20) continue;
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
  const wmesh = new THREE.Mesh(wgeo, water);
  wmesh.position.set(cx, -2.6, H + 26 + 450);
  wmesh.receiveShadow = false;
  wmesh.renderOrder = 6;
  group.add(wmesh);
  own.push(wgeo, water);
  // quay wall along the harbour
  g.box('arch_stone_cold', { c: [cx, -2.2, H + 26], s: [800, 1.4, 1.6], ao: 0.8 });
  // a few moored cogs' masts as silhouettes
  for (let k = 0; k < 6; k++) {
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
  const tints = [[1, 0.96, 0.86], [0.92, 0.9, 0.84], [1, 0.9, 0.78], [0.86, 0.88, 0.9]];
  const tint = plaster ? tints[Math.floor(hash(id, 't') * tints.length)] : undefined;
  if (ruined) {
    // jagged broken shell: 4 walls with random heights
    const th = 0.4;
    for (const [sx, sz, lx, lz] of [[0, -1, w, th], [0, 1, w, th], [-1, 0, th, d], [1, 0, th, d]]) {
      const n = 3;
      for (let k = 0; k < n; k++) {
        const hh = h * (0.3 + hash(id, sx, sz, k) * 0.7);
        const off = (k - (n - 1) / 2) / n;
        const px = x + sx * (w / 2) + (lz > lx ? 0 : off * w);
        const pz = z + sz * (d / 2) + (lz > lx ? off * d : 0);
        g.box(wallKey, { c: [px, y0 + hh / 2, pz], s: [lx > lz ? w / n : th, hh, lz > lx ? d / n : th] });
      }
    }
    return;
  }
  g.box(wallKey, { c: [x, y0 + h / 2, z], s: [w, h, d], tint });
  // gable roof
  const A = rotX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const B = rotX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const la = (rotX ? w : d) / 2 + 0.3;
  const lb = (rotX ? d : w) / 2 + 0.4;
  const rise = lb * (0.8 + hash(id, 'pitch') * 0.5);
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
        const lit = night > 0.3 && hash(id, f, c, 'lit') < 0.45;
        (lit ? winLit : winDark).quad('win', P1, P0, P3, P2, [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
      }
    }
  }
}

function tower(g, x, z, r, h, broken, id, night, winLit, base = -0.5) {
  const sides = 8;
  const geo = new THREE.CylinderGeometry(r, r * 1.08, h, sides, 1, true);
  if (broken) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        const k = Math.round(Math.atan2(p.getZ(i), p.getX(i)) * 10);
        p.setY(i, h / 2 - hash(id, k, 'brk') * h * 0.35);
      }
    }
    geo.computeVertexNormals();
  }
  g.geometry(broken ? 'arch_ruin' : 'arch_stone_cold', geo, new THREE.Matrix4().makeTranslation(x, base + h / 2, z), { uv: 'world' });
  geo.dispose();
  if (!broken) {
    // corbelled parapet + merlons, or a conical roof
    if (hash(id, 'cone') < 0.5) {
      const cone = new THREE.ConeGeometry(r * 1.25, r * 2.4, sides, 1, true);
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
