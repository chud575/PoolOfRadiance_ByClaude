import * as THREE from 'three';
import { CELL } from '../../data/maps/MapGrid.js';
import { getMaterial, getLampGlassMaterial, SURFACE_UNIFORMS } from '../../render/materials.js';
import { getBannerTexture, getGrassTexture, getIvyTexture, getCobwebTexture, getPuddleTexture, getSoftTexture } from '../../render/textures/index.js';
import { GeoBuilder, hash } from './GeoBuilder.js';
import { CELL_SIZE, WALL_T } from './BlockBuilder.js';

const S = CELL_SIZE;
const T = WALL_T;

/** Uniforms for animated props (banner cloth, grass sway). */
export const PROP_UNIFORMS = { uTime: { value: 0 }, uWind: { value: 1 } };

/**
 * Dress a built block with props: street clutter, lamps, banners, vegetation,
 * decals. Everything static is merged per material.
 * @returns {{group: THREE.Group, lamps: any[], dispose: () => void}}
 */
export function buildProps(map, block, opts = {}) {
  const ts = block.tileset;
  const night = opts.night ?? 0;
  const group = new THREE.Group();
  group.name = 'props';
  const g = new GeoBuilder();
  g.aoFn = (p) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(p.y, 0, 0.6);
  const own = []; // disposables
  const lamps = [];
  const geos = makePropGeometries();
  own.push(...Object.values(geos).flat());

  const grassCards = [];
  const ivyCards = [];
  const webCards = [];
  const puddles = [];
  const pools = [];
  const banners = [[], [], [], []];

  const place = (face, s, d, rot = 0) => {
    const m = new THREE.Matrix4().multiplyMatrices(face.basis, new THREE.Matrix4().makeTranslation(s, 0, d));
    if (rot) m.multiply(new THREE.Matrix4().makeRotationY(rot));
    return m;
  };
  const addBarrel = (m, scale = 1) => {
    const mm = m.clone().multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    g.geometry('prop_staves', geos.barrel[0], mm, { uvScale: [1, 1] });
    g.geometry('prop_iron', geos.barrel[1], mm, { uv: 'world' });
    g.geometry('prop_wood', geos.barrel[2], mm, { uvScale: [0.6, 0.6] });
  };
  const addCrate = (m, size) => {
    g.geometry('prop_crate', geos.crate, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, size / 2, 0)).multiply(new THREE.Matrix4().makeScale(size, size, size)));
  };
  const addSack = (m, scale) => g.geometry('prop_burlap', geos.sack, m.clone().multiply(new THREE.Matrix4().makeScale(scale, scale * (0.85 + (scale % 0.1)), scale)), { uvScale: [2, 2] });
  const addRubble = (m, seed, n, spread, big = 1) => {
    for (let i = 0; i < n; i++) {
      const a = hash(seed, i, 'ra') * Math.PI * 2;
      const r = Math.sqrt(hash(seed, i, 'rr')) * spread;
      const sc = (0.25 + hash(seed, i, 'rs') * 0.6) * big * (1 - (r / spread) * 0.5);
      const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * r, sc * 0.18, Math.sin(a) * r * 0.6));
      mm.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(hash(seed, i, 'x') * 3, hash(seed, i, 'y') * 6, hash(seed, i, 'z') * 3)));
      mm.multiply(new THREE.Matrix4().makeScale(sc, sc * 0.7, sc));
      g.geometry(i % 3 === 0 ? 'prop_stone' : 'prop_rubble', geos.rock[i % geos.rock.length], mm, { uv: 'world' });
    }
  };
  const addBlock = (m, seed) => {
    const mm = m.clone().multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, hash(seed, 'by') * 1.2 - 0.6, hash(seed, 'bz') * 0.3)));
    g.box('prop_stone', { matrix: mm.multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0)), s: [0.7 + hash(seed, 'bl') * 0.4, 0.4, 0.45], chamfer: 0.05 });
  };
  const addGrass = (face, s, d, scale, seed) => {
    const p = new THREE.Vector3(s, 0, d).applyMatrix4(face.basis);
    grassCards.push({ p, scale, rot: hash(seed, 'gr') * Math.PI });
  };

  // ------------------------------------------------------------ wall-base clutter
  for (const spot of block.spots.wallBase) {
    const f = spot.face;
    const cell = spot.cell;
    const seed = f.seed;
    const r = hash(seed, 'prop', map.id);
    const street = cell.type === CELL.STREET;
    const rubble = cell.type === CELL.RUBBLE;
    const court = cell.type === CELL.COURTYARD;
    const sPos = (hash(seed, 'sp') - 0.5) * 1.6;
    const dungeon = ts.id === 'dungeon';
    const interior = ts.id === 'interior' || (f.interior && ts.outdoors);
    // no clutter where a ground window's sill is (keep them readable) — windows start at 1.05m so fine
    if (interior && !dungeon) {
      if (r < 0.2) {
        // table with a candle & tankards
        const m = place(f, sPos * 0.6, T / 2 + 0.75, 0);
        table(g, m, seed);
        const cp = new THREE.Vector3(0, 0.84, 0).applyMatrix4(m);
        lamps.push({ pos: cp.clone().add(new THREE.Vector3(0, 0.12, 0)), kind: 'candle', lit: true, seed: Math.floor(seed * 999) });
        g.geometry('prop_bone', geos.candle, new THREE.Matrix4().makeTranslation(cp.x, cp.y, cp.z));
      } else if (r < 0.36) {
        shelf(g, place(f, sPos * 0.5, T / 2 + 0.2), seed, geos);
      } else if (r < 0.48) {
        addBarrel(place(f, sPos, T / 2 + 0.36, seed * 7), 0.9);
        if (r < 0.43) addBarrel(place(f, sPos + 0.62, T / 2 + 0.36, seed * 3), 0.85);
      } else if (r < 0.58) {
        addCrate(place(f, sPos, T / 2 + 0.35, (seed - 0.5) * 0.4), 0.6);
        addSack(place(f, sPos + 0.55, T / 2 + 0.3, seed * 5), 0.9);
      }
      continue;
    }
    if (dungeon) {
      if (r < 0.14) addRubble(place(f, sPos, T / 2 + 0.4), seed, 9, 0.6);
      else if (r < 0.22) {
        addBarrel(place(f, sPos, T / 2 + 0.35, seed * 5), 0.95);
        addCrate(place(f, sPos + 0.7, T / 2 + 0.38, 0.3), 0.62);
      } else if (r < 0.3) bones(g, place(f, sPos, T / 2 + 0.35, seed * 6), seed, geos);
      else if (r < 0.36) {
        // hanging chains with shackles
        for (const o of [-0.3, 0.3]) {
          const m = place(f, sPos + o, T / 2 + 0.06);
          for (let k = 0; k < 8; k++) g.geometry('prop_iron', geos.link, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.4 - k * 0.09, 0)).multiply(new THREE.Matrix4().makeRotationY(k % 2 ? Math.PI / 2 : 0)), { uv: 'world' });
        }
      }
      // cobwebs in inside corners near the ceiling
      for (const end of [-1, 1]) if (f.ends[end] === 'inside' && hash(seed, end, 'web') < 0.35) webCards.push({ face: f, end });
      continue;
    }
    // ---- outdoors
    const ruinish = spot.recipe === 'ruin' || ts.id === 'ruins';
    if (ruinish || rubble) {
      if (r < 0.55) addRubble(place(f, sPos, T / 2 + 0.45), seed, 8 + Math.floor(hash(seed, 'n') * 8), 0.8, 1.1);
      if (r > 0.3 && r < 0.5) addBlock(place(f, -sPos * 0.8, T / 2 + 0.5), seed);
      if (r > 0.75 && r < 0.85) {
        // fallen beam leaning on the wall
        const m = place(f, sPos, T / 2 + 0.55);
        m.multiply(new THREE.Matrix4().makeRotationZ(0.9)).multiply(new THREE.Matrix4().makeRotationY(0.2));
        g.box('prop_wood', { matrix: m.multiply(new THREE.Matrix4().makeTranslation(0.9, 0, 0)), s: [2.2, 0.2, 0.2], chamfer: 0.02, uv: 'along' });
      }
    } else if (street || court) {
      if (r < 0.13) {
        const n = 1 + Math.floor(hash(seed, 'bn') * 3);
        for (let k = 0; k < n; k++) addBarrel(place(f, sPos + (k - (n - 1) / 2) * 0.64, T / 2 + 0.36 + (k === 1 ? 0.1 : 0), seed * 11 + k), 0.92 + hash(seed, k) * 0.12);
        if (n === 3 && hash(seed, 'stk') < 0.5) addBarrel(place(f, sPos, T / 2 + 0.4, 1).multiply(new THREE.Matrix4().makeTranslation(0, 0.8, 0)), 0.9);
      } else if (r < 0.23) {
        const c0 = 0.62 + hash(seed, 'cs') * 0.18;
        addCrate(place(f, sPos, T / 2 + 0.4, (hash(seed, 'cr') - 0.5) * 0.5), c0);
        addCrate(place(f, sPos + c0 * 0.95, T / 2 + 0.38, (hash(seed, 'cr2') - 0.5) * 0.6), c0 * 0.85);
        if (hash(seed, 'ct') < 0.6) addCrate(place(f, sPos + 0.1, T / 2 + 0.42, (hash(seed, 'cr3') - 0.5) * 0.8).multiply(new THREE.Matrix4().makeTranslation(0, c0, 0)), c0 * 0.8);
      } else if (r < 0.29) {
        for (let k = 0; k < 3; k++) addSack(place(f, sPos + k * 0.42, T / 2 + 0.3 + (k % 2) * 0.12, seed * 3 + k), 0.85 + hash(seed, k, 's') * 0.3);
      } else if (r < 0.32 && street) {
        cart(g, place(f, sPos * 0.4, T / 2 + 0.75, 0), seed, geos);
      } else if (r < 0.39 && ts.outdoors) {
        lampPost(g, place(f, sPos, T / 2 + 0.28), lamps, seed, night);
      } else if (r < 0.45) {
        addRubble(place(f, sPos, T / 2 + 0.3), seed, 5, 0.4, 0.7);
      }
      // banners on tall facades
      if (f.H >= 5 && hash(seed, 'ban') < 0.28 && !f.openings.some((o) => o.upper && Math.abs(o.s0) < 0.8 && false)) {
        const s = (hash(seed, 'bs') < 0.5 ? -1 : 1) * 1.0;
        const jet = spot.recipe === 'timber' ? 0.32 : 0;
        banner(g, f, s, 4.5, T / 2 + jet, banners[Math.floor(hash(seed, 'bv') * 4)]);
      }
    }
    // weeds at the foot of outdoor walls
    const nG = ruinish || rubble ? 4 : 2;
    for (let k = 0; k < nG; k++) {
      if (hash(seed, k, 'g') > (ruinish || rubble ? 0.7 : 0.4)) continue;
      addGrass(f, (hash(seed, k, 'gs') - 0.5) * 2.6, T / 2 + 0.04 + hash(seed, k, 'gd') * 0.1, 0.16 + hash(seed, k, 'gz') * 0.2, seed + k);
    }
  }
  // ivy on ruined faces
  for (const f of block.spots.ivy) {
    if (hash(f.seed, 'ivy') > 0.5) continue;
    ivyCards.push({ face: f, s: (hash(f.seed, 'is') - 0.5) * 1.4, w: 1.2 + hash(f.seed, 'iw') * 1.2, h: 1.4 + hash(f.seed, 'ih') * 1.4, top: f.H * (0.5 + hash(f.seed, 'it') * 0.25) });
  }
  // flower boxes
  for (const sp of block.spots.lamp) {
    if (sp.kind !== 'flowers') continue;
    for (let k = 0; k < 5; k++) {
      const p = sp.pos.clone().addScaledVector(sp.T, (k / 4 - 0.5) * sp.w);
      grassCards.push({ p, scale: 0.28, rot: k, flower: true });
    }
  }

  // ------------------------------------------------------------ floor decals + scattered bits
  for (const fc of block.spots.floorCells) {
    const h = hash(map.id, fc.x, fc.y, 'pud');
    const cx = fc.x * S + S / 2;
    const cz = fc.y * S + S / 2;
    const wet = ts.id === 'dungeon' ? 0.3 : fc.cell === CELL.STREET ? 0.22 : fc.cell === CELL.RUBBLE ? 0.25 : 0.1;
    if (h < wet) puddles.push({ x: cx + (hash(fc.x, fc.y, 'px') - 0.5) * 1.6, z: cz + (hash(fc.x, fc.y, 'pz') - 0.5) * 1.6, s: 0.9 + hash(fc.x, fc.y, 'ps') * 1.2, r: hash(fc.x, fc.y, 'pr') * 6 });
    if ((fc.cell === CELL.RUBBLE || ts.id === 'ruins') && hash(fc.x, fc.y, 'rb') < 0.5) {
      addRubble(new THREE.Matrix4().makeTranslation(cx + (hash(fc.x, fc.y, 'rx') - 0.5) * 1.4, 0, cz + (hash(fc.x, fc.y, 'rz') - 0.5) * 1.4), hash(fc.x, fc.y, 'rs'), 6, 0.7, 0.8);
    }
    if ((fc.cell === CELL.RUBBLE || fc.cell === CELL.COURTYARD) && ts.outdoors) {
      for (let k = 0; k < 3; k++) {
        if (hash(fc.x, fc.y, k, 'fg') > (fc.cell === CELL.RUBBLE ? 0.5 : 0.2)) continue;
        grassCards.push({ p: new THREE.Vector3(cx + (hash(fc.x, fc.y, k, 'x') - 0.5) * 2.6, 0, cz + (hash(fc.x, fc.y, k, 'z') - 0.5) * 2.6), scale: 0.12 + hash(fc.x, fc.y, k) * 0.14, rot: k });
      }
    }
    if (ts.id === 'interior' && hash(fc.x, fc.y, 'rug') < 0.2 && !fc.edge) {
      const m = new THREE.Matrix4().makeTranslation(cx, 0.012, cz).multiply(new THREE.Matrix4().makeRotationY(hash(fc.x, fc.y) < 0.5 ? 0 : Math.PI / 2));
      g.box('prop_burlap', { matrix: m, s: [1.8, 0.015, 1.2], uv: 'local', tint: [0.75, 0.25, 0.18], ao: 1 });
    }
  }
  // warm light pools under lit windows at night
  if (night > 0.3 && ts.outdoors) {
    for (const w of block.windows) {
      if (w.border) continue;
      const p = w.pos.clone().addScaledVector(w.N, w.upper ? 1.6 : 0.9);
      pools.push({ x: p.x, z: p.z, sx: w.upper ? 2.2 : 1.6, sz: w.upper ? 2.6 : 1.8, N: w.N, a: (w.upper ? 0.16 : 0.28) * night });
    }
  }

  // ------------------------------------------------------------ assemble static props
  for (const [key, geo] of g.build()) {
    const mesh = new THREE.Mesh(geo, getMaterial(key));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `props:${key}`;
    mesh.renderOrder = 2;
    group.add(mesh);
    own.push(geo);
  }

  // grass cards (alpha tested, wind sway)
  if (grassCards.length) {
    const mat = new THREE.MeshStandardMaterial({ map: getGrassTexture(), alphaTest: 0.5, side: THREE.FrontSide, roughness: 0.9, color: 0xffffff });
    swayPatch(mat);
    const flowerMat = mat;
    const pos = [];
    const uv = [];
    const nrm = [];
    const col = [];
    for (const c of grassCards) {
      for (let k = 0; k < 2; k++) {
        const a = c.rot + (k * Math.PI) / 2;
        const dx = Math.cos(a) * c.scale;
        const dz = Math.sin(a) * c.scale;
        const h = c.scale * 1.1;
        const q = [[-dx, 0, -dz, 0, 0], [dx, 0, dz, 1, 0], [dx, h, dz, 1, 1], [-dx, h, -dz, 0, 1]];
        for (const i of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) {
          pos.push(c.p.x + q[i][0], c.p.y + q[i][1], c.p.z + q[i][2]);
          uv.push(q[i][3], q[i][4]);
          nrm.push(0, 1, 0);
          const fl = c.flower ? [1.4, 0.8, 0.9] : [1, 1, 1];
          col.push(fl[0], fl[1], fl[2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    mat.vertexColors = true;
    const mesh = new THREE.Mesh(geo, flowerMat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    own.push(geo, mat);
  }
  // ivy sheets
  if (ivyCards.length) {
    const mat = new THREE.MeshStandardMaterial({ map: getIvyTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: 0xa8b098 });
    const b = new GeoBuilder();
    for (const c of ivyCards) {
      const f = c.face;
      const d = T / 2 + 0.015;
      const P = (s, y) => new THREE.Vector3(s, y, d).applyMatrix4(f.basis);
      const s0 = c.s - c.w / 2;
      const s1 = c.s + c.w / 2;
      const y1 = c.top;
      const y0 = Math.max(0, y1 - c.h);
      b.quad('ivy', P(s0, y0), P(s1, y0), P(s1, y1), P(s0, y1), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    }
    const geo = b.build().get('ivy');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    own.push(geo, mat);
  }
  // cobwebs
  if (webCards.length) {
    const mat = new THREE.MeshBasicMaterial({ map: getCobwebTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x9a9a92, opacity: 0.8 });
    const b = new GeoBuilder();
    for (const c of webCards) {
      const f = c.face;
      const H = ts.ceilH - 0.05;
      const se = c.end * (S / 2 - T / 2 - 0.02);
      const d = T / 2 + 0.02;
      const sz = 0.9;
      const P = (s, y, dd) => new THREE.Vector3(s, y, dd).applyMatrix4(f.basis);
      // triangle spanning corner: along wall, down, and out from the other wall
      const a = P(se, H, d);
      const bb = P(se - c.end * sz, H, d + 0.05);
      const cc = P(se, H - sz, d + sz * 0.7);
      b.tri('web', [a, bb, cc], [[0, 0], [1, 0], [0, 1]], { ao: 1 });
    }
    const geo = b.build().get('web');
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    own.push(geo, mat);
  }
  // puddles (glossy decals that reflect the environment)
  if (puddles.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.06, metalness: 0.0, transparent: true, alphaMap: getPuddleTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.7 });
    mat.opacity = 0.6;
    const b = new GeoBuilder();
    for (const p of puddles) {
      const c = Math.cos(p.r) * p.s * 0.5;
      const s = Math.sin(p.r) * p.s * 0.5;
      const y = 0.01;
      b.quad('pud', new THREE.Vector3(p.x - c + s, y, p.z + s + c), new THREE.Vector3(p.x + c + s, y, p.z - s + c), new THREE.Vector3(p.x + c - s, y, p.z - s - c), new THREE.Vector3(p.x - c - s, y, p.z + s - c), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    }
    const geo = b.build().get('pud');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
    own.push(geo, mat);
  }
  // window light pools
  if (pools.length) {
    const mat = new THREE.MeshBasicMaterial({ map: getSoftTexture(), color: 0xffa050, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, vertexColors: true });
    const b = new GeoBuilder();
    for (const p of pools) {
      const Tt = new THREE.Vector3(-p.N.z, 0, p.N.x);
      const P = (a, c) => new THREE.Vector3(p.x, 0.02, p.z).addScaledVector(Tt, a * p.sx * 0.5).addScaledVector(p.N, c * p.sz * 0.5);
      b.quad('pool', P(-1, -1), P(-1, 1), P(1, 1), P(1, -1), [[0, 0], [0, 1], [1, 1], [1, 0]], { ao: p.a });
    }
    const geo = b.build().get('pool');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    group.add(mesh);
    own.push(geo, mat);
  }
  // banners
  banners.forEach((list, v) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ map: getBannerTexture(v), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    clothPatch(mat);
    const b = new GeoBuilder();
    for (const q of list) b.quad('ban', q[0], q[1], q[2], q[3], [[0, 1], [1, 1], [1, 0], [0, 0]], { ao: 1 });
    const geo = b.build().get('ban');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    own.push(geo, mat);
  });

  return {
    group,
    lamps,
    dispose() {
      for (const o of own) o.dispose?.();
      group.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------- pieces
function makePropGeometries() {
  const barrelProfile = [[0, 0], [0.25, 0], [0.27, 0.05], [0.31, 0.25], [0.325, 0.42], [0.31, 0.6], [0.27, 0.8], [0.25, 0.85], [0, 0.85]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(barrelProfile.slice(1, 8), 18);
  const hoops = [];
  for (const [y, r] of [[0.09, 0.283], [0.3, 0.322], [0.55, 0.322], [0.76, 0.283]]) {
    const hg = new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.045, 18, 1, true);
    hg.translate(0, y, 0);
    hoops.push(hg);
  }
  const hoop = mergeSimple(hoops);
  const lid = new THREE.CircleGeometry(0.255, 18);
  lid.rotateX(-Math.PI / 2);
  lid.translate(0, 0.83, 0);
  const crate = new THREE.BoxGeometry(1, 1, 1);
  const sackPts = [[0, 0], [0.18, 0.01], [0.24, 0.08], [0.25, 0.2], [0.22, 0.34], [0.14, 0.42], [0.06, 0.48], [0.07, 0.54], [0, 0.56]].map(([r, y]) => new THREE.Vector2(r, y));
  const sack = new THREE.LatheGeometry(sackPts, 12);
  const rock = [];
  for (let k = 0; k < 3; k++) {
    const d0 = new THREE.DodecahedronGeometry(0.5, 0);
    const d = d0.index ? d0.toNonIndexed() : d0;
    const p = d.attributes.position;
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let f = seen.get(key);
      if (f === undefined) {
        f = 0.75 + hash(k, key) * 0.45;
        seen.set(key, f);
      }
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * (k === 1 ? 0.7 : 1), p.getZ(i) * f);
    }
    d.computeVertexNormals();
    rock.push(d);
  }
  const link = new THREE.TorusGeometry(0.04, 0.012, 5, 10);
  link.scale(1, 1.4, 1);
  const candle = new THREE.CylinderGeometry(0.025, 0.028, 0.12, 8);
  candle.translate(0, 0.06, 0);
  const wheel = new THREE.TorusGeometry(0.42, 0.04, 6, 20);
  const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10);
  hub.rotateX(Math.PI / 2);
  const pot = new THREE.CylinderGeometry(0.1, 0.07, 0.24, 10);
  pot.translate(0, 0.12, 0);
  const skull = new THREE.SphereGeometry(0.1, 10, 8);
  skull.scale(1, 0.9, 1.15);
  return { barrel: [body, hoop, lid], crate, sack, rock, link, candle, wheel, hub, pot, skull };
}

function mergeSimple(list) {
  const pos = [];
  const nrm = [];
  const uv = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    g0.dispose();
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

function table(g, m, seed) {
  const top = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.8, 0));
  g.box('prop_wood', { matrix: top, s: [1.4, 0.07, 0.8], chamfer: 0.015, uv: 'along' });
  for (const [x, z] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.39, z)), s: [0.08, 0.78, 0.08], chamfer: 0.01, uv: 'along' });
  g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.25, 0)), s: [1.2, 0.06, 0.06], uv: 'along' });
  // bench
  const bm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.75));
  g.box('prop_wood', { matrix: bm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.45, 0)), s: [1.3, 0.06, 0.3], chamfer: 0.01, uv: 'along' });
  for (const x of [-0.5, 0.5]) g.box('prop_wood', { matrix: bm.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.22, 0)), s: [0.06, 0.44, 0.26], uv: 'along' });
  // tankards
  for (let k = 0; k < 2; k++) {
    const x = (hash(seed, k, 'tk') - 0.5) * 0.9;
    g.box('prop_iron', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.9, (k - 0.5) * 0.3)), s: [0.09, 0.14, 0.09], chamfer: 0.02 });
  }
}

function shelf(g, m, seed, geos) {
  for (const x of [-0.7, 0.7]) g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.95, 0)), s: [0.06, 1.9, 0.4], uv: 'along' });
  for (const y of [0.1, 0.7, 1.3, 1.85]) {
    g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, y, 0)), s: [1.46, 0.04, 0.4], uv: 'along' });
    if (y > 1.8) continue;
    for (let k = 0; k < 4; k++) {
      if (hash(seed, y, k) < 0.3) continue;
      const x = -0.55 + k * 0.36 + (hash(seed, y, k, 'x') - 0.5) * 0.1;
      const sc = 0.7 + hash(seed, y, k, 's') * 0.6;
      g.geometry(hash(seed, y, k, 'm') < 0.5 ? 'arch_brick' : 'prop_iron', geos.pot, m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y + 0.02, 0)).multiply(new THREE.Matrix4().makeScale(sc, sc, sc)), { uv: 'world' });
    }
  }
}

function bones(g, m, seed, geos) {
  g.geometry('prop_bone', geos.skull, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.08, 0)).multiply(new THREE.Matrix4().makeRotationY(seed * 6)), { uv: 'world' });
  for (let k = 0; k < 5; k++) {
    const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation((hash(seed, k, 'bx') - 0.5) * 0.8, 0.025, (hash(seed, k, 'bz') - 0.5) * 0.5));
    mm.multiply(new THREE.Matrix4().makeRotationY(hash(seed, k) * 6));
    g.box('prop_bone', { matrix: mm, s: [0.35 + hash(seed, k, 'l') * 0.2, 0.035, 0.035], chamfer: 0.01 });
  }
}

function cart(g, m, seed, geos) {
  const rot = m.clone();
  // bed
  g.box('prop_wood', { matrix: rot.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.62, 0)), s: [1.7, 0.08, 0.95], chamfer: 0.02, uv: 'along' });
  for (const z of [-0.46, 0.46]) g.box('prop_wood', { matrix: rot.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.8, z)), s: [1.7, 0.3, 0.05], chamfer: 0.01, uv: 'along' });
  for (const x of [-0.84, 0.84]) g.box('prop_wood', { matrix: rot.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.8, 0)), s: [0.05, 0.3, 0.95], chamfer: 0.01, uv: 'along' });
  // wheels
  for (const z of [-0.56, 0.56]) {
    const wm = rot.clone().multiply(new THREE.Matrix4().makeTranslation(-0.1, 0.44, z));
    g.geometry('prop_iron', geos.wheel, wm, { uv: 'world' });
    g.geometry('prop_wood', geos.hub, wm, { uv: 'world' });
    for (let k = 0; k < 8; k++) g.box('prop_wood', { matrix: wm.clone().multiply(new THREE.Matrix4().makeRotationZ((k / 8) * Math.PI * 2)).multiply(new THREE.Matrix4().makeTranslation(0, 0.21, 0)), s: [0.04, 0.4, 0.03], uv: 'along' });
  }
  g.box('prop_wood', { matrix: rot.clone().multiply(new THREE.Matrix4().makeTranslation(-0.1, 0.44, 0)), s: [0.07, 0.07, 1.2], uv: 'along' });
  // shafts resting on the ground
  for (const z of [-0.35, 0.35]) {
    const sm = rot.clone().multiply(new THREE.Matrix4().makeTranslation(1.45, 0.35, z)).multiply(new THREE.Matrix4().makeRotationZ(0.36));
    g.box('prop_wood', { matrix: sm, s: [1.5, 0.07, 0.07], chamfer: 0.01, uv: 'along' });
  }
  // cargo
  if (hash(seed, 'cargo') < 0.6) g.geometry('prop_burlap', geos.sack, rot.clone().multiply(new THREE.Matrix4().makeTranslation(-0.3, 0.66, 0.1)).multiply(new THREE.Matrix4().makeScale(1.2, 0.8, 1.2)), { uvScale: [2, 2] });
}

function lampPost(g, m, lamps, seed, night) {
  g.box('prop_stone', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0)), s: [0.34, 0.4, 0.34], chamfer: 0.04 });
  g.box('prop_iron', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.6, 0)), s: [0.08, 2.8, 0.08], chamfer: 0.015 });
  g.box('prop_iron', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.95, 0)), s: [0.16, 0.06, 0.16], chamfer: 0.01 });
  // lantern cage
  const lm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 3.2, 0));
  for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]]) g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, z)), s: [0.025, 0.36, 0.025] });
  g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.22, 0)), s: [0.34, 0.06, 0.34], chamfer: 0.02 });
  g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.3, 0)), s: [0.18, 0.1, 0.18], chamfer: 0.03 });
  g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.2, 0)), s: [0.28, 0.04, 0.28] });
  const pos = new THREE.Vector3(0, 3.2, 0).applyMatrix4(m);
  lamps.push({ pos, kind: 'lamp', lit: night > 0.35, seed: Math.floor(seed * 997), glass: true });
}

function banner(g, f, s, y, d, list) {
  // iron pole out from the wall, cloth hanging perpendicular to the facade
  const len = 0.95;
  const m = new THREE.Matrix4().multiplyMatrices(f.basis, new THREE.Matrix4().makeTranslation(s, y, d + len / 2));
  g.box('prop_iron', { matrix: m, s: [0.035, 0.035, len] });
  g.box('prop_iron', { matrix: new THREE.Matrix4().multiplyMatrices(f.basis, new THREE.Matrix4().makeTranslation(s, y, d + 0.02)), s: [0.12, 0.2, 0.04], chamfer: 0.01 });
  const g0 = new THREE.Vector3(s, y - 0.03, d + 0.12).applyMatrix4(f.basis);
  const g1 = new THREE.Vector3(s, y - 0.03, d + len - 0.05).applyMatrix4(f.basis);
  const b1 = new THREE.Vector3(s, y - 1.75, d + len - 0.05).applyMatrix4(f.basis);
  const b0 = new THREE.Vector3(s, y - 1.75, d + 0.12).applyMatrix4(f.basis);
  list.push([g0, g1, b1, b0]);
}

/** Cloth wave for banners (uv.y = 1 at the pole). */
function clothPatch(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = PROP_UNIFORMS.uTime;
    sh.uniforms.uWind = PROP_UNIFORMS.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float hang = 1.0 - uv.y;
          vec4 wp0 = modelMatrix * vec4(position, 1.0);
          float ph = wp0.x * 0.7 + wp0.z * 0.9;
          float w = sin(uTime * 2.1 + ph + hang * 3.0) * 0.07 + sin(uTime * 3.7 + ph * 1.3 + hang * 5.0) * 0.03;
          transformed.x += w * hang * hang * uWind;
          transformed.z += w * hang * hang * uWind * 0.6;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'cloth';
}

/** Gentle wind sway for grass cards (uv.y = 1 at the tips). */
function swayPatch(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = PROP_UNIFORMS.uTime;
    Object.assign(sh.uniforms, { uFxSunDir: SURFACE_UNIFORMS.uFxSunDir });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp0 = modelMatrix * vec4(position, 1.0);
          float s = sin(uTime * 1.7 + wp0.x * 1.3 + wp0.z * 0.8) * 0.06 * uv.y * uv.y;
          transformed.x += s;
          transformed.z += s * 0.5;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'grass';
}

export { getLampGlassMaterial };

/**
 * Additive volumetric light shafts falling through windows (interiors by day).
 * @param {{pos: THREE.Vector3, N: THREE.Vector3, w: number, h: number}[]} windows  N = outward normal
 * @param {THREE.Vector3} sunDir direction toward the light
 */
export function buildLightShafts(windows, sunDir, { color = 0xfff0d8, strength = 0.12, length = 4.5 } = {}) {
  const ray = sunDir.clone().multiplyScalar(-1).normalize();
  const pos = [];
  const uv = [];
  const Y = new THREE.Vector3(0, 1, 0);
  for (const w of windows) {
    if (ray.dot(w.N) > -0.05) continue;
    const c = w.pos.clone().addScaledVector(w.N, -0.3);
    const Tt = new THREE.Vector3(-w.N.z, 0, w.N.x);
    const hw = w.w / 2;
    const hh = w.h / 2;
    const P = [
      c.clone().addScaledVector(Tt, -hw).addScaledVector(Y, -hh),
      c.clone().addScaledVector(Tt, hw).addScaledVector(Y, -hh),
      c.clone().addScaledVector(Tt, hw).addScaledVector(Y, hh),
      c.clone().addScaledVector(Tt, -hw).addScaledVector(Y, hh),
    ];
    const Q = P.map((p) => p.clone().addScaledVector(ray, length));
    for (let k = 0; k < 4; k++) {
      const a = P[k];
      const b = P[(k + 1) % 4];
      const bq = Q[(k + 1) % 4];
      const aq = Q[k];
      const quad = [[a, 0, 0], [b, 1, 0], [bq, 1, 1], [a, 0, 0], [bq, 1, 1], [aq, 0, 1]];
      for (const [p, u, v] of quad) {
        pos.push(p.x, p.y, p.z);
        uv.push(u, v);
      }
    }
    // a soft core card through the middle of the shaft
    const m0 = P[0].clone().lerp(P[3], 0.5);
    const m1 = P[1].clone().lerp(P[2], 0.5);
    const quad = [[m0, 0, 0], [m1, 1, 0], [m1.clone().addScaledVector(ray, length), 1, 1], [m0, 0, 0], [m1.clone().addScaledVector(ray, length), 1, 1], [m0.clone().addScaledVector(ray, length), 0, 1]];
    for (const [p, u, v] of quad) {
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: PROP_UNIFORMS.uTime },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; uniform float uTime; varying vec2 vUv; varying vec3 vW;
      void main(){
        float edge = pow(sin(3.14159 * clamp(vUv.x, 0.0, 1.0)), 2.0);
        float along = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 2.2);
        float motes = 0.85 + 0.15 * sin(vW.x * 7.0 + vW.y * 5.0 + uTime * 0.6) * sin(vW.z * 6.0 - uTime * 0.4);
        gl_FragColor = vec4(uColor * edge * along * uStrength * motes, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  mesh.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  return mesh;
}
