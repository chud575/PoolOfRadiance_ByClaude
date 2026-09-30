import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { NOISE } from './glsl.js';
import { prng, worldUV, tint, box, gable, pyramid, cylinder, cone, merge } from './geom.js';

export const CITY_TEXTURES = ['hd_ashlar', 'hd_roof_clay', 'hd_roof_slate', 'hd_rubble'];

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
  const walls = [];
  const roofs = [];
  const slate = [];
  const windows = [];
  const fires = [];
  const disposables = [];

  const stoneCols = [0x8a8076, 0x7a7068, 0x958778, 0x6f675f, 0x857a6b];
  const roofCols = [0xb0705a, 0x9a6050, 0xc08a6a, 0x8f5a48];
  const slateCols = [0x6e7688, 0x5d6475, 0x7a7f8c];

  const addWin = (m, lx, ly, lz, ry, w = 0.5, h = 0.8, warm = 1) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(ry);
    const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(m);
    g.translate(p.x, p.y, p.z);
    const c = new THREE.Color().setHSL(0.08 + R.range(-0.02, 0.03), 0.9, 0.55 + R.range(-0.1, 0.1));
    tint(g, c.multiplyScalar(warm));
    windows.push(g);
  };

  /** One house: box + roof (or a ruined shell). */
  const house = (x, z, w, d, h, ry, { ruined = false, lit = 0.3, base = GROUND } = {}) => {
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
          walls.push(tint(worldUV(g, 3), col, { aoBottom: base, aoTop: base + 3 }));
        }
      }
      if (R.chance(0.4)) {
        const g = box(w * 0.7, 0.8, d * 0.6);
        g.applyMatrix4(m);
        walls.push(tint(worldUV(g, 3), 0x5a524a));
      }
      return;
    }
    const g = box(w, h, d);
    g.applyMatrix4(m);
    walls.push(tint(worldUV(g, 3), col, { aoBottom: base, aoTop: base + 4 }));
    const kind = R.next();
    if (kind < 0.62) {
      const rg = gable(w, d, d * R.range(0.38, 0.55));
      rg.applyMatrix4(new THREE.Matrix4().makeRotationY(0).setPosition(0, h, 0));
      rg.applyMatrix4(m);
      const isSlate = R.chance(0.35);
      (isSlate ? slate : roofs).push(tint(worldUV(rg, 2), R.pick(isSlate ? slateCols : roofCols)));
    } else if (kind < 0.85) {
      const rg = pyramid(Math.max(w, d), Math.max(w, d) * 0.5, { y: h });
      rg.applyMatrix4(m);
      slate.push(tint(worldUV(rg, 2), R.pick(slateCols)));
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
          if (R.chance(lit)) addWin(m, -w / 2 + (w / nx) * (i + 0.5), wy, d / 2 + 0.03, 0, 0.5, 0.8, R.range(0.8, 1.6));
        }
        const nz = Math.max(1, Math.floor(d / 2));
        for (let i = 0; i < nz; i++) {
          if (R.chance(lit * 0.6)) addWin(m, w / 2 + 0.03, wy, -d / 2 + (d / nz) * (i + 0.5), Math.PI / 2, 0.5, 0.8, R.range(0.7, 1.3));
          if (R.chance(lit * 0.6)) addWin(m, -w / 2 - 0.03, wy, -d / 2 + (d / nz) * (i + 0.5), -Math.PI / 2, 0.5, 0.8, R.range(0.7, 1.3));
        }
      }
    }
  };

  const tower = (x, z, r, h, { roof = 'cone', base = GROUND, lit = 0 } = {}) => {
    const col = R.pick(stoneCols);
    walls.push(tint(worldUV(cylinder(r, r * 1.08, h, 14, { x, y: base, z }), 3), col, { aoBottom: base, aoTop: base + 5 }));
    if (roof === 'cone') {
      slate.push(tint(worldUV(cone(r * 1.25, r * 2.4, 14, { x, y: base + h, z }), 2), R.pick(slateCols)));
    } else {
      // crenellated top
      walls.push(tint(worldUV(cylinder(r * 1.15, r * 1.15, 0.9, 14, { x, y: base + h, z }), 3), col));
      const n = Math.round(r * 3);
      for (let i = 0; i < n; i++) {
        if (roof === 'broken' && R.chance(0.4)) continue;
        const a = (i / n) * Math.PI * 2;
        walls.push(tint(worldUV(box(0.7, 0.8, 0.5, { x: x + Math.cos(a) * r * 1.1, y: base + h + 0.9, z: z + Math.sin(a) * r * 1.1, ry: -a }), 3), col));
      }
    }
    if (lit) {
      const m = new THREE.Matrix4().setPosition(x, base, z);
      for (let k = 0; k < 2; k++) addWin(m, 0, h * (0.45 + k * 0.25), r * 1.02 + 0.05, 0, 0.5, 0.9, 1.2);
    }
  };

  const crenel = (x0, z0, x1, z1, y, t, col) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / 1.3);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      walls.push(tint(worldUV(box(0.7, 0.8, t, { x: x0 + (x1 - x0) * f, y, z: z0 + (z1 - z0) * f, ry: -ang }), 3), col));
    }
  };

  const wallRun = (x0, z0, x1, z1, h, { base = GROUND, gaps = 0 } = {}) => {
    const col = 0x857a6d;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const segs = Math.max(1, Math.round(len / 10));
    for (let i = 0; i < segs; i++) {
      if (R.chance(gaps)) continue;
      const f = (i + 0.5) / segs;
      const hh = R.chance(gaps) ? h * R.range(0.3, 0.7) : h;
      const cx = x0 + (x1 - x0) * f, cz = z0 + (z1 - z0) * f;
      walls.push(tint(worldUV(box(len / segs + 0.05, hh, 2.2, { x: cx, y: base, z: cz, ry: -ang }), 3), col, { aoBottom: base, aoTop: base + 3 }));
      if (hh === h) {
        const ax = x0 + (x1 - x0) * (i / segs), az = z0 + (z1 - z0) * (i / segs);
        const bx = x0 + (x1 - x0) * ((i + 1) / segs), bz = z0 + (z1 - z0) * ((i + 1) / segs);
        crenel(ax, az, bx, bz, base + h, 0.5, col);
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
      if (R.chance(0.12)) continue;
      const east = x > 14;
      const w = R.range(4.2, 7.5);
      const d = R.range(4.2, 7.2);
      const far = gz / 15;
      const h = R.range(3.2, 7.0) * (1 + far * 0.25) * (R.chance(0.08) ? 1.5 : 1);
      const ry = (R.chance(0.5) ? 0 : Math.PI / 2) + R.range(-0.12, 0.12);
      const ruined = east ? R.chance(0.55) : R.chance(0.08);
      house(x, z, w, d, h, ry, { ruined, lit: east ? 0.05 : 0.5 });
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
    walls.push(tint(worldUV(mound, 4), 0x5d564c));
    walls.push(tint(worldUV(box(14, 15, 12, { x: cx, y: base, z: cz }), 3), 0x8a7f72, { aoBottom: base, aoTop: base + 6 }));
    crenel(cx - 7, cz + 6, cx + 7, cz + 6, base + 15, 0.6, 0x8a7f72);
    crenel(cx - 7, cz - 6, cx + 7, cz - 6, base + 15, 0.6, 0x8a7f72);
    for (const [dx, dz] of [[-10, 8], [10, 8], [-10, -8], [10, -8]]) tower(cx + dx, cz + dz, 2.4, 19, { roof: dx > 0 && dz > 0 ? 'broken' : 'cone', base });
    wallRun(cx - 18, cz + 14, cx + 18, cz + 14, 9, { base: GROUND + 5 });
    wallRun(cx - 18, cz + 14, cx - 18, cz - 14, 9, { base: GROUND + 5 });
    wallRun(cx + 18, cz + 14, cx + 18, cz - 14, 9, { base: GROUND + 5, gaps: 0.4 });
    tower(cx - 18, cz + 14, 3.2, 13, { roof: 'flat', base: GROUND + 5 });
    tower(cx + 18, cz + 14, 3.2, 11, { roof: 'broken', base: GROUND + 5 });
    fires.push(new THREE.Vector3(cx + 10, base + 19, cz + 8));
  }

  // ---- Temple of Tyr (dome) and the Council hall (New Phlan) ----------------
  {
    const tx = -42, tz = -96;
    walls.push(tint(worldUV(box(14, 11, 14, { x: tx, z: tz, y: GROUND }), 3), 0xa39684, { aoBottom: GROUND, aoTop: GROUND + 4 }));
    walls.push(tint(worldUV(cylinder(6.4, 6.4, 2.5, 20, { x: tx, y: GROUND + 11, z: tz }), 3), 0xa39684));
    const dome = new THREE.SphereGeometry(6.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(tx, GROUND + 13.5, tz);
    slate.push(tint(worldUV(dome.toNonIndexed(), 2), 0x5f8a80));
    const m = new THREE.Matrix4().setPosition(tx, GROUND, tz);
    for (let i = 0; i < 4; i++) addWin(m, -4.5 + i * 3, 6, 7.05, 0, 0.8, 2.2, 1.5);
    // the council hall: long, many-windowed
    const hx = -20, hz = -58;
    house(hx, hz, 16, 8, 8, 0, { lit: 0 });
    const hm = new THREE.Matrix4().setPosition(hx, GROUND, hz);
    for (let f = 0; f < 2; f++) for (let i = 0; i < 7; i++) addWin(hm, -6.6 + i * 2.2, 2 + f * 3.2, 4.05, 0, 0.7, 1.3, 1.7);
    tower(hx + 9, hz, 2, 17, { roof: 'cone', lit: 1 });
  }

  // ---- harbour: quays, lighthouse ------------------------------------------
  walls.push(tint(worldUV(box(420, 1.6, 6, { x: 0, y: GROUND - 1.4, z: -156 }), 3), 0x6d655b));
  for (const px of [-70, -30, 20, 64]) walls.push(tint(worldUV(box(3, 1.2, 22, { x: px, y: GROUND - 1.4, z: -168 }), 3), 0x6a5a48));
  tower(-96, -170, 2.6, 18, { roof: 'flat', base: GROUND - 1 });
  const lighthouse = new THREE.Vector3(-96, GROUND - 1 + 19.5, -170);

  // ---- ground --------------------------------------------------------------
  const ground = new THREE.PlaneGeometry(460, 160, 1, 1);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, GROUND, -80);
  walls.push(tint(worldUV(ground.toNonIndexed(), 5), 0x3e3832));

  // ---- meshes --------------------------------------------------------------
  const texMat = (name, extra = {}) => {
    const t = getTextureSet(name);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, vertexColors: true, roughness: 1, ...extra });
  };
  const wallMat = texMat('hd_ashlar');
  const roofMat = texMat('hd_roof_clay');
  const slateMat = texMat('hd_roof_slate');
  disposables.push(wallMat, roofMat, slateMat);
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
  addMesh(roofs, roofMat);
  addMesh(slate, slateMat);
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3.2, 2.2, 1.3), fog: false });
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
    s.scale.setScalar(i === fires.length - 1 ? 7 : R.range(7, 13));
    s.userData.base = s.scale.x;
    s.userData.seed = i * 1.7;
    group.add(s);
    glows.push(s);
  });
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
    update(t) {
      smoke.update(t);
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

/** Rising smoke plumes: cylindrical billboards with scrolling noise, fire-lit at the base. */
function createSmoke(points, R) {
  const quads = [];
  for (const p of points) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 1);
    g.translate(0, 0.5, 0);
    const n = g.attributes.position.count;
    const centre = new Float32Array(n * 3);
    const params = new Float32Array(n * 3);
    const w = R.range(6, 10), h = R.range(34, 55), seed = R.range(0, 100);
    for (let i = 0; i < n; i++) {
      centre.set([p.x, p.y, p.z], i * 3);
      params.set([w, h, seed], i * 3);
    }
    g.setAttribute('aCentre', new THREE.BufferAttribute(centre, 3));
    g.setAttribute('aParams', new THREE.BufferAttribute(params, 3));
    quads.push(g);
  }
  const geo = quads.length ? mergeAttr(quads) : new THREE.BufferGeometry();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aCentre; attribute vec3 aParams;
      varying vec2 vUv; varying float vSeed;
      uniform float uTime;
      void main() {
        vUv = uv; vSeed = aParams.z;
        vec3 toCam = cameraPosition - aCentre; toCam.y = 0.0; toCam = normalize(toCam);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        float y = position.y;
        float lean = y * y * aParams.y * 0.35; // wind drifts it west
        float widen = 0.35 + y * 1.5;
        vec3 wp = aCentre + right * position.x * aParams.x * widen + vec3(-lean, y * aParams.y, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying float vSeed;
      ${NOISE}
      void main() {
        vec2 p = vec2(vUv.x * 2.0, vUv.y * 3.0 - uTime * 0.12);
        float n = fbm(p + vSeed);
        float edge = 1.0 - smoothstep(0.15, 0.5, abs(vUv.x - 0.5) + (n - 0.5) * 0.35);
        float a = edge * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y)) * (0.35 + 0.65 * n);
        vec3 col = mix(vec3(0.07, 0.05, 0.07), vec3(0.22, 0.13, 0.16), n);
        col += vec3(1.6, 0.55, 0.15) * (1.0 - smoothstep(0.0, 0.25, vUv.y)) * 0.8;
        gl_FragColor = vec4(col, a * 0.62);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, update: (t) => (mat.uniforms.uTime.value = t) };
}

function mergeAttr(list) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(list[0].attributes);
  let total = 0;
  const idx = [];
  for (const g of list) total += g.attributes.position.count;
  for (const n of names) {
    const size = list[0].attributes[n].itemSize;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of list) {
      arr.set(g.attributes[n].array, off * size);
      off += g.attributes[n].count;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  let base = 0;
  for (const g of list) {
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
    g.dispose();
  }
  out.setIndex(idx);
  return out;
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
