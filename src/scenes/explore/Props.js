import * as THREE from 'three';
import { CELL, EDGE } from '../../data/maps/MapGrid.js';
import { getMaterial, getLampGlassMaterial, SURFACE_UNIFORMS } from '../../render/materials.js';
import { getBannerTexture, getGrassTexture, getIvyClusterTexture, getCobwebTexture, getPuddleTexture, getSoftTexture, getRugTexture, getTapestryTexture, getNoticeTexture, getBlobTexture } from '../../render/textures/index.js';
import { GeoBuilder, hash } from './GeoBuilder.js';
import { puddleChance } from './exploreRules.js';
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
  const rugs = [];
  const aoBlobs = []; // soft contact shadows under props
  const tapestries = [[], []];
  const notices = [];
  const blob = (x, z, r, a = 0.55) => aoBlobs.push({ x, z, r, a });

  const place = (face, s, d, rot = 0) => {
    const m = new THREE.Matrix4().multiplyMatrices(face.basis, new THREE.Matrix4().makeTranslation(s, 0, d));
    if (rot) m.multiply(new THREE.Matrix4().makeRotationY(rot));
    return m;
  };
  const addBarrel = (m, scale = 1) => {
    const mm = m.clone().multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    const bc = new THREE.Vector3().applyMatrix4(m);
    if (bc.y < 0.1) blob(bc.x, bc.z, 0.48 * scale, 0.5);
    g.geometry('prop_staves', geos.barrel[0], mm, { uvScale: [1, 1] });
    g.geometry('prop_iron', geos.barrel[1], mm, { uv: 'world' });
    g.geometry('prop_wood', geos.barrel[2], mm, { uvScale: [0.6, 0.6] });
  };
  const addCrate = (m, size) => {
    const cc = new THREE.Vector3().applyMatrix4(m);
    if (cc.y < 0.1) blob(cc.x, cc.z, size * 0.85, 0.45);
    g.geometry('prop_crate', geos.crate, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, size / 2, 0)).multiply(new THREE.Matrix4().makeScale(size, size, size)));
  };
  const addSack = (m, scale) => g.geometry('prop_burlap', geos.sack, m.clone().multiply(new THREE.Matrix4().makeScale(scale, scale * (0.85 + (scale % 0.1)), scale)), { uvScale: [2, 2] });
  // fractured masonry chunks match the local walls (never pale trim stone in a dark dungeon)
  const chunkKey = ts.id === 'dungeon' ? ({ bane: 'arch_basalt', warrens: 'arch_hewn' }[ts.variant] ?? 'arch_dungeon') : 'arch_trim';
  const addRubble = (m, seed, n, spread, big = 1) => {
    // a heap: larger fractured blocks first, then smaller stones and chips around them
    for (let i = 0; i < n; i++) {
      const a = hash(seed, i, 'ra') * Math.PI * 2;
      const r = Math.sqrt(hash(seed, i, 'rr')) * spread;
      const sc = (0.2 + hash(seed, i, 'rs') * 0.55) * big * (1 - (r / spread) * 0.6) * (i < 2 ? 1.5 : 1);
      const chunk = hash(seed, i, 'ck') < 0.3;
      const geo = chunk ? geos.chunk[i % geos.chunk.length] : geos.rock[i % geos.rock.length];
      const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * r, sc * 0.17, Math.sin(a) * r * 0.6));
      mm.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((hash(seed, i, 'x') - 0.5) * 0.5, hash(seed, i, 'y') * 6.3, (hash(seed, i, 'z') - 0.5) * 0.5)));
      mm.multiply(new THREE.Matrix4().makeScale(sc, sc * 0.7, sc));
      const t = 0.72 + hash(seed, i, 'tn') * 0.4;
      const warm = hash(seed, i, 'tw') - 0.5;
      g.geometry(chunk ? chunkKey : 'prop_rock', geo, mm, { uv: 'world', tint: [t * (1 + warm * 0.08), t, t * (1 - warm * 0.1)], ao: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.35) });
    }
    const c = new THREE.Vector3().applyMatrix4(m);
    blob(c.x, c.z, spread * 1.4 + 0.3, 0.5);
  };
  const addBlock = (m, seed) => {
    const mm = m.clone().multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, hash(seed, 'by') * 1.2 - 0.6, hash(seed, 'bz') * 0.3)));
    g.box('prop_stone', { matrix: mm.multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0)), s: [0.7 + hash(seed, 'bl') * 0.4, 0.4, 0.45], chamfer: 0.05 });
  };
  /** A clump of weeds: a few cards of varied size, tallest in the middle. */
  const addGrass = (face, s, d, scale, seed) => {
    const n = 2 + Math.floor(hash(seed, 'gn') * 4);
    for (let k = 0; k < n; k++) {
      const off = (hash(seed, k, 'go') - 0.5) * scale * 2.2;
      const dd = d + hash(seed, k, 'gd2') * scale * 0.8;
      const p = new THREE.Vector3(s + off, 0, dd).applyMatrix4(face.basis);
      grassCards.push({ p, scale: scale * (k === 0 ? 1.1 : 0.55 + hash(seed, k, 'gsz') * 0.45), rot: hash(seed, k, 'gr') * Math.PI });
    }
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
      // wall dressing above the furniture line (never across a window or under a shelf)
      const deco = hash(seed, 'deco', map.id);
      const ds = (hash(seed, 'dsx') - 0.5) * 1.0;
      const freeWall = !f.openings.some((o) => o.s0 - 0.7 < ds && o.s1 + 0.7 > ds) && !(r >= 0.2 && r < 0.36);
      if (freeWall && f.recipe !== 'int_panel') {
        if (deco < 0.3) tapestries[Math.floor(hash(seed, 'tv') * 2)].push({ face: f, s: ds, w: 1.1, h: 1.45, y: 1.35 });
        else if (deco < 0.45 && r >= 0.36) weaponRack(g, place(f, ds, T / 2 + 0.02), seed);
        else if (deco < 0.58) {
          notices.push({ face: f, s: ds });
          g.box('prop_wood', { matrix: place(f, ds, T / 2 + 0.03).multiply(new THREE.Matrix4().makeTranslation(0, 1.55, 0)), s: [1.08, 0.82, 0.05], chamfer: 0.012, uv: 'along' });
        }
      }
      continue;
    }
    if (dungeon) {
      // a floor drain under some walls
      if (hash(seed, 'drain') < 0.12) {
        const dm = place(f, sPos * 0.6, T / 2 + 0.22);
        for (let k = 0; k < 5; k++) g.box('prop_iron', { matrix: dm.clone().multiply(new THREE.Matrix4().makeTranslation(-0.16 + k * 0.08, 0.012, 0)), s: [0.025, 0.02, 0.3] });
        g.box('prop_iron', { matrix: dm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.008, 0)), s: [0.4, 0.012, 0.34] });
        const dc = new THREE.Vector3().applyMatrix4(dm);
        blob(dc.x, dc.z, 0.5, 0.7);
      }
      if (ts.variant === 'bane') {
        // a kept temple: no rubble or stores, only the odd offering of bones
        if (r < 0.12) bones(g, place(f, sPos, T / 2 + 0.35, seed * 6), seed, geos);
        continue;
      }
      if (r < 0.14) addRubble(place(f, sPos, T / 2 + 0.4), seed, 9, 0.6);
      else if (r < 0.22) {
        addBarrel(place(f, sPos, T / 2 + 0.35, seed * 5), 0.95);
        addCrate(place(f, sPos + 0.7, T / 2 + 0.38, 0.3), 0.62);
      } else if (r < 0.32) bones(g, place(f, sPos, T / 2 + 0.35, seed * 6), seed, geos);
      else if (r < 0.42) {
        // hanging chains with shackles
        for (const o of [-0.32, 0.32]) {
          const m = place(f, sPos + o, T / 2 + 0.07);
          // forged staple: back plate, two rivets, eye ring
          g.box('prop_iron', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.5, -0.05)), s: [0.12, 0.16, 0.02], chamfer: 0.008 });
          g.geometry('prop_iron', geos.link, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.44, -0.02)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(1.3, 1, 1.3)), { uv: 'world' });
          const n = 7 + Math.floor(hash(seed, o, 'cl') * 4);
          for (let k = 0; k < n; k++) g.geometry('prop_iron', geos.link, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.36 - k * 0.1, 0)).multiply(new THREE.Matrix4().makeRotationY(k % 2 ? Math.PI / 2 : 0)).multiply(new THREE.Matrix4().makeScale(1.25, 1.25, 1.25)), { uv: 'world' });
          // open manacle hanging from the last link
          const cuff = new THREE.TorusGeometry(0.06, 0.014, 6, 14, Math.PI * 1.6);
          g.geometry('prop_iron', cuff, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.3 - n * 0.1, 0.02)).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI * 0.3)), { uv: 'world' });
          cuff.dispose();
        }
      }
      // cobwebs in inside corners near the ceiling
      for (const end of [-1, 1]) if (f.ends[end] === 'inside' && hash(seed, end, 'web') < 0.5) webCards.push({ face: f, end });
      continue;
    }
    // ---- outdoors
    const ruinish = spot.recipe === 'ruin' || ts.id === 'ruins';
    if (ruinish || rubble) {
      if (r < (f.jag ? 0.9 : 0.55)) addRubble(place(f, sPos, T / 2 + 0.45), seed, 9 + Math.floor(hash(seed, 'n') * 9), 0.85, 1.15);
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
    const nG = ruinish || rubble ? 3 : 2;
    for (let k = 0; k < nG; k++) {
      if (hash(seed, k, 'g') > (ruinish || rubble ? 0.65 : 0.35)) continue;
      // weeds take hold in the corners and along the wall foot, not out on the paving
      const corner = [-1, 1].find((end) => f.ends[end] === 'inside' && hash(seed, k, end, 'gc') < 0.7);
      const sx = corner ? corner * (S / 2 - T / 2 - 0.15 - hash(seed, k, 'gco') * 0.3) : (hash(seed, k, 'gs') - 0.5) * 2.4;
      addGrass(f, sx, T / 2 + 0.03 + hash(seed, k, 'gd') * 0.06, 0.13 + hash(seed, k, 'gz') * 0.16, seed + k);
    }
  }
  // ivy on ruined faces: clustered leaf cards climbing from the wall foot and
  // draping down from the broken top, following the wall's edges
  for (const f of block.spots.ivy) {
    if (hash(f.seed, 'ivy') > 0.55) continue;
    const ops = f.openings;
    const clear = (sv, y) => !ops.some((o) => sv > o.s0 - 0.15 && sv < o.s1 + 0.15 && y > o.y0 - 0.15 && y < o.y1 + 0.15);
    const topAt = (sv) => (f.jag ? f.H * f.jag(sv) : f.H);
    const nStems = 1 + Math.floor(hash(f.seed, 'ivn') * 2);
    for (let st = 0; st < nStems; st++) {
      let sv = (hash(f.seed, st, 'ivs') - 0.5) * 2.4;
      let y = 0.1;
      const top = topAt(sv) - 0.05;
      for (let k = 0; y < top && k < 30; k++) {
        if (clear(sv, y)) ivyCards.push({ face: f, s: sv, y, size: 0.32 + hash(f.seed, st, k, 'iz') * 0.28, rot: hash(f.seed, st, k, 'ir') * 6.3, v: k % 2, out: 0.02 + hash(f.seed, st, k, 'io') * 0.06 });
        sv += (hash(f.seed, st, k, 'iw') - 0.5) * 0.35;
        sv = THREE.MathUtils.clamp(sv, -1.45, 1.45);
        y += 0.16 + hash(f.seed, st, k, 'iy') * 0.12;
      }
      for (let k = 0; k < 10; k++) {
        const s2 = THREE.MathUtils.clamp(sv + (hash(f.seed, st, k, 'ts') - 0.5) * 1.6, -1.5, 1.5);
        const t2 = topAt(s2);
        const y2 = t2 - 0.05 - hash(f.seed, st, k, 'td') * 0.9 * (k % 3 === 0 ? 1.4 : 1);
        if (y2 > 0 && clear(s2, y2)) ivyCards.push({ face: f, s: s2, y: y2, size: 0.3 + hash(f.seed, st, k, 'tz') * 0.3, rot: hash(f.seed, st, k, 'tr') * 6.3, v: (k + 1) % 2, out: 0.03 + hash(f.seed, st, k, 'to') * 0.08 });
      }
    }
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
    // standing water only on open street/rubble ground and dungeon stone — never on indoor boards
    const wet = puddleChance(ts, fc);
    if (h < wet) puddles.push({ x: cx + (hash(fc.x, fc.y, 'px') - 0.5) * 1.6, z: cz + (hash(fc.x, fc.y, 'pz') - 0.5) * 1.6, s: 0.9 + hash(fc.x, fc.y, 'ps') * 1.2, r: hash(fc.x, fc.y, 'pr') * 6 });
    if ((fc.cell === CELL.RUBBLE || ts.id === 'ruins') && hash(fc.x, fc.y, 'rb') < 0.5) {
      addRubble(new THREE.Matrix4().makeTranslation(cx + (hash(fc.x, fc.y, 'rx') - 0.5) * 1.4, 0, cz + (hash(fc.x, fc.y, 'rz') - 0.5) * 1.4), hash(fc.x, fc.y, 'rs'), 6, 0.7, 0.8);
    }
    if ((fc.cell === CELL.RUBBLE || fc.cell === CELL.COURTYARD) && ts.outdoors) {
      // sparse tufts in paving joints (courtyards) or patches on rubble ground
      for (let k = 0; k < 3; k++) {
        if (hash(fc.x, fc.y, k, 'fg') > (fc.cell === CELL.RUBBLE ? 0.45 : 0.06)) continue;
        const px = cx + (hash(fc.x, fc.y, k, 'x') - 0.5) * 2.4;
        const pz = cz + (hash(fc.x, fc.y, k, 'z') - 0.5) * 2.4;
        for (let q = 0; q < 3; q++) grassCards.push({ p: new THREE.Vector3(px + (hash(fc.x, fc.y, k, q, 'qx') - 0.5) * 0.25, 0, pz + (hash(fc.x, fc.y, k, q, 'qz') - 0.5) * 0.25), scale: (0.08 + hash(fc.x, fc.y, k, q) * 0.1), rot: k + q });
      }
    }
    if (ts.id === 'interior' && hash(fc.x, fc.y, 'rug') < 0.2 && !fc.edge) {
      const m = new THREE.Matrix4().makeTranslation(cx, 0.008, cz).multiply(new THREE.Matrix4().makeRotationY(hash(fc.x, fc.y) < 0.5 ? 0 : Math.PI / 2));
      rugs.push({ m, v: hash(fc.x, fc.y, 'rv') < 0.5 ? 0 : 1 });
    }
  }
  // waterfront: mooring bollards along the quay edge, cargo waiting to be loaded
  if (map.harbour) {
    for (const fc of block.spots.floorCells) {
      if (map.getCell(fc.x, fc.y + 1) !== CELL.WATER || fc.cell === CELL.WATER) continue;
      const ez = (fc.y + 1) * S - 0.45;
      const cx = fc.x * S + S / 2;
      {
        // the quay edge: a battered stone face down into the water, a coping of long dressed
        // blocks overhanging it, timber fenders and an iron mooring ring
        const qz = (fc.y + 1) * S;
        g.box('arch_stone_cold', { c: [cx, -1.0, qz - 0.35], s: [S + 0.02, 2.0, 0.7], ao: (p) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(p.y, -0.6, 0.0), tint: [0.78, 0.8, 0.76] });
        let a = 0;
        for (let k = 0; a < S - 0.02; k++) {
          const l = Math.min(S - a, 0.7 + hash(fc.x, k, 'cpl') * 0.6);
          const hgt = 0.16 + hash(fc.x, k, 'cph') * 0.03;
          g.box('arch_dressed', { c: [fc.x * S + a + l / 2, hgt / 2 - 0.02, qz - 0.22], s: [l - 0.025, hgt, 0.66], rotY: (hash(fc.x, k, 'cpr') - 0.5) * 0.02, chamfer: 0.03, tint: [0.84 + hash(fc.x, k, 'cpt') * 0.14, 0.84, 0.8], ao: (p, n) => (n.y > 0.5 ? 1 : 0.7) });
          a += l;
        }
        for (let k = 0; k < 2; k++) {
          const fx = fc.x * S + 0.75 + k * 1.5;
          g.box('prop_wood', { c: [fx, -0.55, qz + 0.1], s: [0.2, 1.3, 0.18], chamfer: 0.02, uv: 'along', tint: [0.55, 0.5, 0.45] });
          g.box('prop_iron', { c: [fx, -0.08, qz + 0.1], s: [0.22, 0.05, 0.2] });
        }
        const ring = new THREE.TorusGeometry(0.09, 0.014, 6, 14);
        g.geometry('prop_iron', ring, new THREE.Matrix4().makeTranslation(cx + 0.3, -0.25, qz + 0.03), { uv: 'world' });
        ring.dispose();
      }
      if (fc.x % 2 === 0) {
        const bm = new THREE.Matrix4().makeTranslation(cx + (hash(fc.x, 'bo') - 0.5), 0, ez);
        const post = new THREE.CylinderGeometry(0.14, 0.17, 0.62, 10);
        g.geometry('prop_iron', post, bm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.31, 0)), { uv: 'world' });
        post.dispose();
        const cap = new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        g.geometry('prop_iron', cap, bm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.6, 0)), { uv: 'world' });
        cap.dispose();
        if (hash(fc.x, 'rope') < 0.6) {
          const rope = new THREE.TorusGeometry(0.22, 0.045, 6, 16);
          g.geometry('prop_burlap', rope, bm.clone().multiply(new THREE.Matrix4().makeTranslation(0.45, 0.05, -0.2)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), { uv: 'world' });
          g.geometry('prop_burlap', rope, bm.clone().multiply(new THREE.Matrix4().makeTranslation(0.45, 0.12, -0.2)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(0.85, 0.85, 1)), { uv: 'world' });
          rope.dispose();
        }
        blob(cx, ez, 0.4, 0.5);
      } else if (hash(fc.x, fc.y, 'cargo') < 0.55) {
        const m = new THREE.Matrix4().makeTranslation(cx, 0, ez - 0.9).multiply(new THREE.Matrix4().makeRotationY(hash(fc.x, 'cr') * 0.6 - 0.3));
        addCrate(m, 0.7);
        addCrate(m.clone().multiply(new THREE.Matrix4().makeTranslation(0.75, 0, 0.1)), 0.6);
        addBarrel(m.clone().multiply(new THREE.Matrix4().makeTranslation(-0.7, 0, 0.15)), 0.95);
      }
    }
  }
  // fallen column drums and broken shafts in temple precincts
  for (const fc of block.spots.floorCells) {
    if (fc.covered || !/temple|shrine/i.test(map.zoneAt(fc.x, fc.y) ?? '')) continue;
    const h = hash(map.id, fc.x, fc.y, 'col');
    if (h > 0.5) continue;
    // only against a wall, never in the walkway
    const walls = [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]].filter(([d]) => map.getEdge(fc.x, fc.y, d) === EDGE.WALL);
    if (!walls.length) continue;
    const [, wx, wy] = walls[Math.floor(hash(fc.x, fc.y, 'w') * walls.length)];
    const along = (hash(fc.x, fc.y, 'al') - 0.5) * 1.4;
    const cx = fc.x * S + S / 2 + wx * (S / 2 - T / 2 - 0.75) + wy * along;
    const cz = fc.y * S + S / 2 + wy * (S / 2 - T / 2 - 0.75) + wx * along;
    const m = new THREE.Matrix4().makeTranslation(cx, 0, cz).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(wx, wy) + Math.PI / 2 + (hash(fc.x, fc.y, 'r') - 0.5) * 0.5));
    if (h < 0.2) {
      // drum lying on its side
      g.geometry('prop_limestone', geos.drum, m.clone().multiply(new THREE.Matrix4().makeTranslation(-0.45, 0.36, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)), { uvScale: [2, 1] });
      g.geometry('prop_limestone', geos.drum, m.clone().multiply(new THREE.Matrix4().makeTranslation(0.45, 0.34, 0.12)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 + 0.08)).multiply(new THREE.Matrix4().makeRotationX(0.5)), { uvScale: [2, 1] });
    } else {
      // broken shaft on its plinth
      const colAO = (p) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(p.y, 0.0, 0.9);
      g.box('prop_limestone', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0)), s: [0.95, 0.4, 0.95], chamfer: 0.05, uv: 'local', ao: colAO });
      g.box('prop_limestone', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.45, 0)), s: [0.82, 0.1, 0.82], chamfer: 0.03, uv: 'local', ao: colAO });
      const sh = geos.shaft[Math.floor(hash(fc.x, fc.y, 'sv') * geos.shaft.length)];
      g.geometry('prop_limestone', sh, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)).multiply(new THREE.Matrix4().makeRotationY(hash(fc.x, fc.y, 'sr') * 6.3)), { uvScale: [2, 1.2], ao: colAO });
    }
    {
      const mc = new THREE.Vector3().applyMatrix4(m);
      blob(mc.x, mc.z, 0.9, 0.55);
    }
    addRubble(m, h * 100, 5, 0.9, 0.8);
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

  // soft contact shadows (ambient occlusion) under props
  if (aoBlobs.length) {
    const pos = [];
    const uv = [];
    const col = [];
    for (const bl of aoBlobs) {
      for (const [a, c] of [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]) {
        pos.push(bl.x + a * bl.r, 0.012, bl.z + c * bl.r);
        uv.push((a + 1) / 2, (c + 1) / 2);
        col.push(1, 1, 1, bl.a);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    const mat = new THREE.MeshBasicMaterial({ alphaMap: getBlobTexture(), color: 0x000000, transparent: true, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    group.add(mesh);
    own.push(geo, mat);
  }
  // tapestries (cloth hanging from a rod, gentle folds)
  tapestries.forEach((list, v) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ map: getTapestryTexture(v), roughness: 0.95, side: THREE.DoubleSide });
    const b = new GeoBuilder();
    for (const t of list) {
      const f = t.face;
      const d = T / 2 + 0.03;
      const segs = 6;
      const P = (sv, y, dd) => new THREE.Vector3(sv, y, dd).applyMatrix4(f.basis);
      for (let k = 0; k < segs; k++) {
        const s0 = t.s - t.w / 2 + (t.w * k) / segs;
        const s1 = t.s - t.w / 2 + (t.w * (k + 1)) / segs;
        const w0 = 0.02 + 0.025 * Math.sin((k / segs) * Math.PI * 3);
        const w1 = 0.02 + 0.025 * Math.sin(((k + 1) / segs) * Math.PI * 3);
        b.quad('tap', P(s0, t.y, d + w0), P(s1, t.y, d + w1), P(s1, t.y + t.h, d), P(s0, t.y + t.h, d), [[k / segs, 0], [(k + 1) / segs, 0], [(k + 1) / segs, 1], [k / segs, 1]], { ao: 1 });
      }
      g.box('prop_wood', { matrix: new THREE.Matrix4().multiplyMatrices(f.basis, new THREE.Matrix4().makeTranslation(t.s, t.y + t.h + 0.03, d + 0.02)), s: [t.w + 0.2, 0.05, 0.05], uv: 'along' });
    }
    const geo = b.build().get('tap');
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    own.push(geo, mat);
  });
  if (notices.length) {
    const mat = new THREE.MeshStandardMaterial({ map: getNoticeTexture(), roughness: 0.9 });
    const b = new GeoBuilder();
    for (const n of notices) {
      const P = (sv, y) => new THREE.Vector3(sv, y, T / 2 + 0.058).applyMatrix4(n.face.basis);
      b.quad('nt', P(n.s - 0.5, 1.17), P(n.s + 0.5, 1.17), P(n.s + 0.5, 1.93), P(n.s - 0.5, 1.93), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    }
    const geo = b.build().get('nt');
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    own.push(geo, mat);
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
  // ivy clusters (two texture variants, one draw call each)
  for (const v of [0, 1]) {
    const list = ivyCards.filter((c) => c.v === v);
    if (!list.length) continue;
    const mat = new THREE.MeshStandardMaterial({ map: getIvyClusterTexture(v), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, color: 0xe0e8d0 });
    const b = new GeoBuilder();
    for (const c of list) {
      const f = c.face;
      const hw = c.size / 2;
      const ca = Math.cos(c.rot) * hw;
      const sa = Math.sin(c.rot) * hw;
      const P = (ds, dy, out) => new THREE.Vector3(c.s + ds, c.y + dy, T / 2 + out).applyMatrix4(f.basis);
      b.quad('ivy', P(-ca + sa, -sa - ca, c.out + 0.05), P(ca + sa, sa - ca, c.out + 0.05), P(ca - sa, sa + ca, c.out), P(-ca - sa, -sa + ca, c.out), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    }
    const geo = b.build().get('ivy');
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: ts.outdoors ? 0.06 : 0.38, metalness: 0.0, transparent: true, alphaMap: getPuddleTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.7 });
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
  // rugs
  for (const r of rugs) {
    const mat = new THREE.MeshStandardMaterial({ map: getRugTexture(r.v), roughness: 0.95 });
    const geo = new THREE.BoxGeometry(2.0, 0.028, 1.4);
    geo.translate(0, 0.006, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.applyMatrix4(r.m);
    mesh.receiveShadow = true;
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
  const chunk = [];
  for (let k = 0; k < 5; k++) {
    rock.push(fracturedRock(k, false));
    if (k < 3) chunk.push(fracturedRock(k + 10, true));
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
  const drum = new THREE.CylinderGeometry(0.36, 0.36, 0.72, 16, 1);
  for (let i = 0, p = drum.attributes.position; i < p.count; i++) {
    // fluting
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const f = 1 - 0.04 * Math.max(0, Math.cos(a * 8));
    if (Math.hypot(p.getX(i), p.getZ(i)) > 0.3) p.setXYZ(i, p.getX(i) * f, p.getY(i), p.getZ(i) * f);
  }
  drum.computeVertexNormals();
  // broken column shafts: fluted, each with its own fracture (sloped shear, jagged, stump)
  const shaft = [];
  for (let v = 0; v < 3; v++) {
    const hgt = [1.6, 1.25, 0.9][v];
    const sg = new THREE.CylinderGeometry(0.32, 0.34, hgt, 20, 6);
    const p = sg.attributes.position;
    const slopeA = hash(v, 'sa') * Math.PI * 2;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const rr = Math.hypot(p.getX(i), p.getZ(i));
      if (rr > 0.25) {
        const fl = 1 - 0.05 * Math.max(0, Math.cos(a * 10));
        p.setX(i, p.getX(i) * fl);
        p.setZ(i, p.getZ(i) * fl);
      }
      if (p.getY(i) > hgt / 2 - 0.01) {
        const shear = Math.cos(a - slopeA) * (v === 0 ? 0.35 : 0.18);
        const jag = (hash(v, Math.round(a * 6), 'jg') - 0.5) * (v === 1 ? 0.4 : 0.14);
        p.setY(i, hgt / 2 - 0.25 + shear + jag);
      }
    }
    sg.translate(0, hgt / 2, 0);
    const ni = sg.toNonIndexed();
    sg.dispose();
    ni.computeVertexNormals();
    shaft.push(ni);
  }
  const skull = new THREE.SphereGeometry(0.1, 10, 8);
  skull.scale(1, 0.9, 1.15);
  const bottle = new THREE.LatheGeometry([[0, 0], [0.045, 0], [0.05, 0.02], [0.05, 0.14], [0.02, 0.19], [0.015, 0.25], [0, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const jar = new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.09, 0.06], [0.08, 0.14], [0.05, 0.17], [0.055, 0.19], [0, 0.19]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
  const plate = new THREE.CylinderGeometry(0.11, 0.09, 0.02, 14);
  return { barrel: [body, hoop, lid], crate, sack, rock, chunk, link, candle, wheel, hub, pot, skull, drum, shaft, bottle, jar, plate };
}

/**
 * Fractured stone: a sphere (or block) cut by random cleavage planes into flat
 * facets, jittered, with a flat seat; flat-shaded.
 */
export function fracturedRock(seed, block) {
  const base = block ? new THREE.BoxGeometry(1, 0.62, 0.72, 3, 2, 2) : new THREE.IcosahedronGeometry(0.5, 2);
  const g = base.index ? base.toNonIndexed() : base;
  if (g !== base) base.dispose();
  const p = g.attributes.position;
  const planes = [];
  const np = block ? 3 : 7;
  for (let k = 0; k < np; k++) {
    const th = hash(seed, k, 'pt') * Math.PI * 2;
    const ph = Math.acos(1 - 2 * hash(seed, k, 'pp'));
    const n = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.8, Math.sin(ph) * Math.sin(th)).normalize();
    planes.push({ n, d: (block ? 0.28 : 0.3) + hash(seed, k, 'pd') * 0.15 });
  }
  const v = new THREE.Vector3();
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let out = cache.get(key);
    if (!out) {
      out = v.clone();
      if (!block) out.multiplyScalar(1 + (hash(seed, key, 'j') - 0.5) * 0.12);
      else out.add(new THREE.Vector3((hash(seed, key, 'x') - 0.5) * 0.05, (hash(seed, key, 'y') - 0.5) * 0.04, (hash(seed, key, 'z') - 0.5) * 0.05));
      for (const pl of planes) {
        const dd = out.dot(pl.n) - pl.d;
        if (dd > 0) out.addScaledVector(pl.n, -dd);
      }
      if (out.y < -0.24) out.y = -0.24 - (out.y + 0.24) * 0.1;
      cache.set(key, out);
    }
    p.setXYZ(i, out.x, out.y, out.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Wall-mounted weapon rack: two spears, a sword and a round shield. */
function weaponRack(g, m, seed) {
  g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.9, 0.06)), s: [1.1, 0.08, 0.1], chamfer: 0.01, uv: 'along' });
  g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.9, 0.06)), s: [1.1, 0.08, 0.1], chamfer: 0.01, uv: 'along' });
  for (const [x, lean] of [[-0.38, 0.06], [-0.18, -0.04]]) {
    const sm = m.clone().multiply(new THREE.Matrix4().makeTranslation(x, 1.25, 0.14)).multiply(new THREE.Matrix4().makeRotationZ(lean));
    g.box('prop_wood', { matrix: sm, s: [0.035, 2.4, 0.035], uv: 'along' });
    g.box('prop_iron', { matrix: sm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.28, 0)), s: [0.06, 0.24, 0.015], chamfer: 0.006 });
  }
  const sw = m.clone().multiply(new THREE.Matrix4().makeTranslation(0.18, 1.35, 0.13));
  g.box('prop_iron', { matrix: sw, s: [0.05, 0.85, 0.01], chamfer: 0.004 });
  g.box('prop_iron', { matrix: sw.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.45, 0)), s: [0.24, 0.035, 0.03] });
  g.box('prop_wood', { matrix: sw.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.56, 0)), s: [0.035, 0.18, 0.035], uv: 'along' });
  const shm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0.42, 1.3, 0.1)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const disc = new THREE.CylinderGeometry(0.28, 0.28, 0.035, 18);
  g.geometry(hash(seed, 'sh') < 0.5 ? 'prop_crate' : 'prop_wood', disc, shm, { uv: 'world' });
  disc.dispose();
  const boss = new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.geometry('prop_iron', boss, m.clone().multiply(new THREE.Matrix4().makeTranslation(0.42, 1.3, 0.12)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), { uv: 'world' });
  boss.dispose();
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
  g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.95, -0.19)), s: [1.4, 1.9, 0.02], uv: 'along' });
  for (const y of [0.1, 0.7, 1.3, 1.85]) {
    g.box('prop_wood', { matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, y, 0)), s: [1.46, 0.04, 0.4], uv: 'along' });
    if (y > 1.8) continue;
    let x = -0.62;
    for (let k = 0; x < 0.6 && k < 12; k++) {
      const kind = hash(seed, y, k, 'kind');
      const sc = 0.8 + hash(seed, y, k, 's') * 0.5;
      const tm = (dx) => m.clone().multiply(new THREE.Matrix4().makeTranslation(x + dx, y + 0.02, (hash(seed, y, k, 'z') - 0.5) * 0.12));
      if (kind < 0.25) {
        // a row of books, the last one leaning
        const nb = 3 + Math.floor(hash(seed, y, k, 'nb') * 5);
        for (let b = 0; b < nb; b++) {
          const bh = 0.2 + hash(seed, y, k, b, 'bh') * 0.12;
          g.box(hash(seed, y, k, b, 'bk') < 0.5 ? 'prop_burlap' : 'prop_crate', { matrix: tm(b * 0.045).multiply(new THREE.Matrix4().makeTranslation(0, bh / 2, 0)).multiply(new THREE.Matrix4().makeRotationZ(b === nb - 1 ? -0.25 : 0)), s: [0.04, bh, 0.16 + hash(seed, y, k, b) * 0.05], uv: 'local' });
        }
        x += nb * 0.045 + 0.06;
      } else if (kind < 0.45) {
        g.geometry('prop_iron', geos.bottle, tm(0.03).multiply(new THREE.Matrix4().makeScale(sc, sc, sc)), { uv: 'world' });
        x += 0.12;
      } else if (kind < 0.65) {
        g.geometry('arch_brick', geos.jar, tm(0.06).multiply(new THREE.Matrix4().makeScale(sc, sc, sc)), { uv: 'world' });
        x += 0.2 * sc;
      } else if (kind < 0.78) {
        for (let q = 0; q < 3; q++) g.geometry('prop_bone', geos.plate, tm(0.1).multiply(new THREE.Matrix4().makeTranslation(0, 0.012 + q * 0.022, 0)), { uv: 'world' });
        x += 0.24;
      } else if (kind < 0.9) {
        g.geometry(hash(seed, y, k, 'm') < 0.5 ? 'arch_brick' : 'prop_iron', geos.pot, tm(0.06).multiply(new THREE.Matrix4().makeScale(sc, sc, sc)), { uv: 'world' });
        x += 0.18;
      } else x += 0.15;
    }
  }
}

function bones(g, m, seed, geos) {
  // a skull with sockets and jaw, ribs and long bones with knuckled ends, scattered
  const sm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.09, 0)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.15, seed * 6, 0.2)));
  g.geometry('prop_bone', geos.skull, sm, { uv: 'world', tint: [0.9, 0.84, 0.72] });
  g.box('prop_bone', { matrix: sm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.075, 0.05)), s: [0.1, 0.035, 0.08], chamfer: 0.01, tint: [0.8, 0.74, 0.62] });
  for (const ex of [-0.035, 0.035]) g.box('arch_beam_dark', { matrix: sm.clone().multiply(new THREE.Matrix4().makeTranslation(ex, 0.01, 0.105)), s: [0.035, 0.03, 0.02], tint: [0.1, 0.08, 0.07] });
  const knob = new THREE.SphereGeometry(0.028, 6, 5);
  for (let k = 0; k < 6; k++) {
    const len = 0.3 + hash(seed, k, 'l') * 0.22;
    const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation((hash(seed, k, 'bx') - 0.5) * 0.8, 0.03 + (k % 2) * 0.03, (hash(seed, k, 'bz') - 0.5) * 0.5));
    mm.multiply(new THREE.Matrix4().makeRotationY(hash(seed, k) * 6)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 + (hash(seed, k, 'tz') - 0.5) * 0.3));
    const shaft = new THREE.CylinderGeometry(0.017, 0.015, len, 6);
    g.geometry('prop_bone', shaft, mm, { uv: 'world', tint: [0.86, 0.8, 0.68] });
    shaft.dispose();
    for (const sy of [-1, 1]) for (const kx of [-0.012, 0.012]) g.geometry('prop_bone', knob, mm.clone().multiply(new THREE.Matrix4().makeTranslation(kx, (sy * len) / 2, 0)), { uv: 'world', tint: [0.88, 0.82, 0.7] });
  }
  knob.dispose();
  // a few curved ribs
  for (let k = 0; k < 4; k++) {
    const rib = new THREE.TorusGeometry(0.16, 0.009, 4, 10, Math.PI * 0.8);
    const rm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0.2 + (hash(seed, k, 'rx') - 0.5) * 0.3, 0.02, (hash(seed, k, 'rz') - 0.5) * 0.3)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + 0.2)).multiply(new THREE.Matrix4().makeRotationZ(hash(seed, k, 'rr') * 6));
    g.geometry('prop_bone', rib, rm, { uv: 'world', tint: [0.84, 0.78, 0.66] });
    rib.dispose();
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
  const at = (x, y, z) => m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  // octagonal stone plinth
  const plinth = new THREE.CylinderGeometry(0.2, 0.24, 0.42, 8);
  g.geometry('prop_stone', plinth, at(0, 0.21, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 8)), { uv: 'world', ao: (p) => 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.4) });
  plinth.dispose();
  // tapered wrought-iron post with collars
  const post = new THREE.CylinderGeometry(0.035, 0.055, 2.6, 10);
  g.geometry('prop_iron', post, at(0, 1.72, 0), { uv: 'world' });
  post.dispose();
  for (const [y, r] of [[0.46, 0.07], [0.62, 0.05], [2.7, 0.055], [2.98, 0.08]]) {
    const c = new THREE.CylinderGeometry(r, r, 0.05, 10);
    g.geometry('prop_iron', c, at(0, y, 0), { uv: 'world' });
    c.dispose();
  }
  // scroll brackets under the lantern
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const bm = at(0, 2.92, 0).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeTranslation(0.07, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(-0.7));
    g.box('prop_iron', { matrix: bm, s: [0.16, 0.018, 0.018] });
  }
  // lantern: base plate, corner stiles, glass (emissive, added by the scene), hipped cap + finial
  const lm = at(0, 3.2, 0);
  g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.19, 0)), s: [0.3, 0.035, 0.3], chamfer: 0.008 });
  for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]]) g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, z)), s: [0.022, 0.36, 0.022] });
  for (const y of [-0.15, 0.16]) for (const [x, z, sx, sz] of [[0, -0.12, 0.26, 0.016], [0, 0.12, 0.26, 0.016], [-0.12, 0, 0.016, 0.26], [0.12, 0, 0.016, 0.26]]) g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)), s: [sx, 0.016, sz] });
  const cap = new THREE.ConeGeometry(0.25, 0.2, 4, 1);
  g.geometry('prop_iron', cap, lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.28, 0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4)), { uv: 'world' });
  cap.dispose();
  const fin = new THREE.SphereGeometry(0.035, 8, 6);
  g.geometry('prop_iron', fin, lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.42, 0)), { uv: 'world' });
  fin.dispose();
  g.box('prop_iron', { matrix: lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.19, 0)), s: [0.3, 0.025, 0.3] });
  const pos = new THREE.Vector3(0, 3.2, 0).applyMatrix4(m);
  lamps.push({ pos, kind: 'lamp', lit: night > 0.12, seed: Math.floor(seed * 997), glass: true });
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
