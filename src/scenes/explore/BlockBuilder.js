import * as THREE from 'three';
import { EDGE, CELL } from '../../data/maps/MapGrid.js';
import { getMaterial, getWindowMaterial } from '../../render/materials.js';
import { getInscriptionTexture, getEmberTexture, getSootTexture } from '../../render/textures/index.js';
import { GeoBuilder, hash, defaultAO } from './GeoBuilder.js';
import { TILESETS } from './tilesets.js';

/** World scale (metres). One grid cell = CELL_SIZE x CELL_SIZE. */
export const CELL_SIZE = 3;
export const WALL_T = 0.4;
export const WALL_H_STREET = 3.4;
export const WALL_H_BUILDING = 5.4;
export const CEIL_H = 3.3;
export const EYE_H = 1.62;
const S = CELL_SIZE;
const T = WALL_T;
const JETTY = 0.32;
const UP = new THREE.Vector3(0, 1, 0);

/** Centre of a cell in world space. */
export function cellCenter(x, y, out = new THREE.Vector3()) {
  return out.set(x * CELL_SIZE + CELL_SIZE / 2, 0, y * CELL_SIZE + CELL_SIZE / 2);
}

const DOOR_W = 1.36;
const DOOR_H = 2.36;
const ARCH_W = 2.0;
const ARCH_SPRING = 2.05;

/** Plaster limewash tints (vertex-colour multipliers) for timber buildings. */
const PLASTER_TINTS = [[1, 1, 1], [1.02, 0.95, 0.82], [0.95, 0.97, 1.0], [1.04, 0.9, 0.8], [0.93, 0.93, 0.86], [1.0, 0.98, 0.9]];

/**
 * Build the 3D representation of a MapGrid block.
 * @param {import('../../data/maps/MapGrid.js').MapGrid} map
 * @param {{foundSecrets?: Set<string>, tileset?: any, night?: number}} [opts]
 * @returns {{group: THREE.Group, doors: Map<string, any>, torches: any[], windows: any[], chimneys: THREE.Vector3[],
 *   spots: any, tileset: any, meshes: THREE.Mesh[]}}
 */
export function buildBlock(map, opts = {}) {
  const ts = opts.tileset ?? TILESETS.city;
  const night = opts.night ?? 0;
  const group = new THREE.Group();
  group.name = `block:${map.id}`;
  const g = new GeoBuilder();
  const panes = new GeoBuilder();
  const indoor = !ts.outdoors;
  const ceilH = ts.ceilH;
  if (indoor) {
    g.aoFn = (p, n) => {
      let a = 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, 1.0);
      a *= 1 - 0.35 * THREE.MathUtils.smoothstep(p.y, ceilH - 0.9, ceilH);
      if (n.y < -0.5) a *= 0.75;
      return a;
    };
  }
  const doors = new Map();
  const torches = [];
  const windows = [];
  const chimneys = [];
  const spots = { wallBase: [], lamp: [], banner: [], floorCells: [], cobweb: [], ivy: [] };
  const W = map.w;
  const Hh = map.h;
  /** Optional fireplaces: map.hearths [{x,y,dir}] (or a single map.hearth). */
  const hearths = [...(map.hearths ?? []), ...(map.hearth ? [map.hearth] : [])];
  const isHearthEdge = (x, y, dir) => hearths.some((h) => {
    if (h.x === x && h.y === y && h.dir === dir) return true;
    const [dx, dy] = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[h.dir];
    return h.x + dx === x && h.y + dy === y && { N: 'S', S: 'N', E: 'W', W: 'E' }[h.dir] === dir;
  });

  // ------------------------------------------------------------ components
  const comp = new Int32Array(W * Hh).fill(-1);
  const comps = [];
  const isInteriorCell = (x, y) => map.inBounds(x, y) && map.getCell(x, y) === CELL.INTERIOR;
  if (!indoor) {
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        if (!isInteriorCell(x, y) || comp[y * W + x] >= 0) continue;
        const id = comps.length;
        const cells = [];
        const stack = [[x, y]];
        comp[y * W + x] = id;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          cells.push([cx, cy]);
          for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!isInteriorCell(nx, ny) || comp[ny * W + nx] >= 0) continue;
            if (map.getEdge(cx, cy, d) === EDGE.WALL) continue;
            comp[ny * W + nx] = id;
            stack.push([nx, ny]);
          }
        }
        // perimeter style
        const styleCount = [0, 0, 0];
        for (const [cx, cy] of cells) {
          for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (map.inBounds(nx, ny) && comp[ny * W + nx] === id) continue;
            if (map.getEdge(cx, cy, d) !== EDGE.OPEN) styleCount[map.getEdgeStyle(cx, cy, d) % 3]++;
          }
        }
        const style = styleCount.indexOf(Math.max(...styleCount));
        const zone = map.zoneAt(x, y) ?? '';
        const temple = /temple|shrine|church/i.test(zone);
        const ruined = style === 2 || ts.id === 'ruins';
        const hs = ts.buildingH;
        let H = hs[Math.floor(hash(map.id, id, 'h') * hs.length)];
        if (temple) H = 5.8;
        // which way does the entrance face? (temples turn their pediment to it)
        let frontAxis = null;
        for (const [cx, cy] of cells) {
          for (const d of ['N', 'S', 'E', 'W']) {
            const t = map.getEdge(cx, cy, d);
            if (t === EDGE.ARCH || t === EDGE.DOOR || t === EDGE.LOCKED) frontAxis = d === 'N' || d === 'S' ? 'z' : 'x';
          }
        }
        if (style === 1 && H < 5) H = 5.4;
        comps.push({ id, cells, style, ruined, H, temple, frontAxis, roofKind: ['arch_roof_slate', 'arch_roof_clay', 'arch_roof_shake'][Math.floor(hash(map.id, id, 'roof') * 3)], tint: PLASTER_TINTS[Math.floor(hash(map.id, id, 'tint') * PLASTER_TINTS.length)] });
      }
    }
  }
  /** A cell walled on all four sides (no door/arch/secret) can never be seen from inside. */
  const solidCell = (x, y) => {
    if (!map.inBounds(x, y)) return true;
    for (const d of ['N', 'E', 'S', 'W']) if (map.getEdge(x, y, d) !== EDGE.WALL) return false;
    return true;
  };
  const compAt = (x, y) => (map.inBounds(x, y) && comp[y * W + x] >= 0 ? comps[comp[y * W + x]] : null);
  /** Cell has a ceiling (and interior wall finish). */
  const covered = (x, y) => {
    if (!map.inBounds(x, y)) return false;
    if (indoor) return map.getCell(x, y) !== CELL.WATER || true;
    const c = compAt(x, y);
    return !!c && !c.ruined;
  };

  // ------------------------------------------------------------ edges
  /** Horizontal edge H(i,j): vertices (i,j)-(i+1,j); vertical V(i,j): (i,j)-(i,j+1). */
  const edgeH = (i, j) => {
    if (i < 0 || i >= W || j < 0 || j > Hh) return null;
    return j < Hh ? { x: i, y: j, dir: 'N' } : { x: i, y: Hh - 1, dir: 'S' };
  };
  const edgeV = (i, j) => {
    if (j < 0 || j >= Hh || i < 0 || i > W) return null;
    return i < W ? { x: i, y: j, dir: 'W' } : { x: W - 1, y: j, dir: 'E' };
  };
  const edgeKey = (e) => `${e.x},${e.y},${e.dir}`;
  /** Edges that carry an inscription plaque (keep the wall above them clear). */
  const signEdges = new Set();
  for (const ev of map.events ?? []) {
    if (ev.type !== 'sign' || !/["“]/.test(ev.text ?? '')) continue;
    for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
      signEdges.add(`${ev.x},${ev.y},${d}`);
      signEdges.add(`${ev.x + dx},${ev.y + dy},${{ N: 'S', S: 'N', E: 'W', W: 'E' }[d]}`);
    }
  }
  const edgeInfo = new Map();

  const secretFound = (x, y, dir) => opts.foundSecrets?.has(`${x},${y},${dir}`);
  /** Height of the wall on an edge (exterior top). */
  function wallHeight(x, y, dir) {
    const [dx, dy] = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[dir];
    if (indoor) return ceilH;
    const a = compAt(x, y);
    const b = compAt(x + dx, y + dy);
    let h = 0;
    for (const c of [a, b]) if (c) h = Math.max(h, c.ruined ? c.H * 0.82 : c.H);
    if (h > 0) return h;
    return ts.streetWallH;
  }

  function getEdgeInfo(e) {
    if (!e) return null;
    const k = edgeKey(e);
    if (edgeInfo.has(k)) return edgeInfo.get(k);
    const type = map.getEdge(e.x, e.y, e.dir);
    let info = null;
    if (type !== EDGE.OPEN) {
      const style = map.getEdgeStyle(e.x, e.y, e.dir) % 3;
      const H = wallHeight(e.x, e.y, e.dir);
      info = { ...e, type, style, H, key: k };
    }
    edgeInfo.set(k, info);
    return info;
  }
  /** Wall edge leaving vertex (i,j) in direction (dx,dz). */
  const edgeFrom = (i, j, dx, dz) => {
    const e = dx === 1 ? edgeH(i, j) : dx === -1 ? edgeH(i - 1, j) : dz === 1 ? edgeV(i, j) : edgeV(i, j - 1);
    return getEdgeInfo(e);
  };

  // collect all wall edges once
  const allEdges = [];
  for (let j = 0; j <= Hh; j++) for (let i = 0; i < W; i++) { const e = getEdgeInfo(edgeH(i, j)); if (e) allEdges.push({ ...e, hv: 'H', i, j }); }
  for (let j = 0; j < Hh; j++) for (let i = 0; i <= W; i++) { const e = getEdgeInfo(edgeV(i, j)); if (e) allEdges.push({ ...e, hv: 'V', i, j }); }

  // ------------------------------------------------------------ per-edge build

  function buildEdge(e) {
    const horizontal = e.hv === 'H';
    // midpoint + tangent (+x or +z)
    const M = horizontal ? new THREE.Vector3((e.i + 0.5) * S, 0, e.j * S) : new THREE.Vector3(e.i * S, 0, (e.j + 0.5) * S);
    // side cells: for H edge (i,j): north cell (i,j-1) [N = -z], south cell (i,j) [N = +z]
    const sides = horizontal
      ? [{ cx: e.i, cy: e.j, N: new THREE.Vector3(0, 0, 1) }, { cx: e.i, cy: e.j - 1, N: new THREE.Vector3(0, 0, -1) }]
      : [{ cx: e.i, cy: e.j, N: new THREE.Vector3(1, 0, 0) }, { cx: e.i - 1, cy: e.j, N: new THREE.Vector3(-1, 0, 0) }];
    const found = e.type === EDGE.SECRET && secretFound(e.x, e.y, e.dir);
    const isDoor = e.type === EDGE.DOOR || e.type === EDGE.LOCKED || found;
    const isArch = e.type === EDGE.ARCH;
    const seedE = hash(map.id, e.key);
    // openings shared through the wall
    const openings = [];
    const hearthEdge = isHearthEdge(e.x, e.y, e.dir);
    if (isDoor) openings.push({ s0: -DOOR_W / 2, s1: DOOR_W / 2, y0: 0, y1: DOOR_H, kind: 'door' });
    if (isArch) openings.push({ s0: -ARCH_W / 2, s1: ARCH_W / 2, y0: 0, y1: ARCH_SPRING + ARCH_W / 2, kind: 'arch' });
    const inA = map.inBounds(sides[0].cx, sides[0].cy);
    const inB = map.inBounds(sides[1].cx, sides[1].cy);
    const seen = (sd) => map.inBounds(sd.cx, sd.cy) && !(solidCell(sd.cx, sd.cy) && (indoor || covered(sd.cx, sd.cy)));
    if (!seen(sides[0]) && !seen(sides[1])) return;
    const covA = covered(sides[0].cx, sides[0].cy);
    const covB = covered(sides[1].cx, sides[1].cy);
    const buildingWall = !indoor && (covA !== covB) && inA && inB;
    const faceExtH = e.H;
    if (!isDoor && !isArch && buildingWall && !hearthEdge && seedE < 0.62) openings.push({ s0: -0.46, s1: 0.46, y0: 1.05, y1: 2.2, kind: 'window', ground: true });
    if (buildingWall && faceExtH >= 5 && !((isArch || isDoor) && signEdges.has(e.key)) && hash(e.key, 'up', map.id) < 0.85) {
      const w = faceExtH >= 7 ? 0.6 : 0.46;
      openings.push({ s0: -w, s1: w, y0: 3.55, y1: faceExtH >= 7 ? 5.4 : 4.6, kind: 'window', upper: true });
    }
    // interior tileset: daylight windows in the outer border
    if (indoor && ts.id === 'interior' && (!inA || !inB) && !isDoor && !hearthEdge && seedE < 0.55) openings.push({ s0: -0.5, s1: 0.5, y0: 1.0, y1: 2.35, kind: 'window', ground: true, border: true });
    // ruin: jagged profile shared by both faces
    const jag = makeJag(e, seedE);

    for (let si = 0; si < 2; si++) {
      const sd = sides[si];
      if (!map.inBounds(sd.cx, sd.cy)) continue;
      if (map.getCell(sd.cx, sd.cy) === CELL.WATER && !indoor) continue;
      if (solidCell(sd.cx, sd.cy) && (indoor || covered(sd.cx, sd.cy))) continue;
      const Tn = new THREE.Vector3().crossVectors(UP, sd.N); // right-handed basis (T, up, N)
      const basis = new THREE.Matrix4().makeBasis(Tn, UP, sd.N).setPosition(M);
      const cov = covered(sd.cx, sd.cy);
      const interiorFace = indoor || cov;
      const recipe = indoor ? ts.walls[e.style] : cov ? ts.interiorFace : ts.walls[e.style];
      const Hf = interiorFace ? ceilH : faceExtH;
      const c = compAt(sd.cx, sd.cy) ?? compAt(sides[1 - si].cx, sides[1 - si].cy);
      const face = {
        e, basis, N: sd.N, T: Tn, M, interior: interiorFace, recipe, H: Hf, openings, jag, horizontal,
        cell: { x: sd.cx, y: sd.cy, type: map.getCell(sd.cx, sd.cy) },
        tint: c?.tint ?? PLASTER_TINTS[Math.floor(seedE * PLASTER_TINTS.length)],
        temple: !interiorFace && !!c?.temple,
        ends: {},
        seed: hash(e.key, si, map.id),
      };
      // per-face texture offset: no two walls show the same stones / plaster blemishes
      face.uvOff = [Math.floor(hash(face.seed, 'uo') * 97) / 7.3, Math.floor(hash(face.seed, 'vo') * 13) / 3.7];
      // corner classification at both ends
      for (const end of [-1, 1]) face.ends[end] = classifyEnd(e, sd.N, Tn, end, horizontal);
      RECIPES[recipe]?.(face);
      if (hearthEdge && interiorFace) {
        const wallDir = sd.N.x > 0.5 ? 'W' : sd.N.x < -0.5 ? 'E' : sd.N.z > 0.5 ? 'N' : 'S';
        if (hearths.some((h) => h.x === sd.cx && h.y === sd.cy && h.dir === wallDir)) buildHearth(face);
      }
      if (!interiorFace && !isDoor && !isArch && ts.outdoors) {
        spots.wallBase.push({ face, cell: face.cell, style: e.style, recipe });
      }
      if (indoor && !isDoor && !isArch) spots.wallBase.push({ face, cell: face.cell, style: e.style, recipe });
      // torches
      placeSconces(face, isDoor || isArch);
    }
    // ---- edge-level (through-wall) features
    const fA = map.inBounds(sides[0].cx, sides[0].cy) ? 0 : 1;
    const sd = sides[fA];
    const Tn = new THREE.Vector3().crossVectors(UP, sd.N);
    const basis = new THREE.Matrix4().makeBasis(Tn, UP, sd.N).setPosition(M);
    const ef = { e, basis, N: sd.N, T: Tn, M, horizontal, seed: seedE };
    if (isDoor) buildDoor(ef, e, sides, fA, found);
    if (isArch) buildArch(ef, e);
    for (const o of openings) if (o.kind === 'window') buildWindow(ef, e, o, sides, fA, covA, covB);
    // coping on free-standing walls
    if (!covA && !covB && !indoor && e.style !== 2 && !jag) {
      const s0 = -S / 2 - copingExt(e, sd.N, Tn, -1, horizontal);
      const s1 = S / 2 + copingExt(e, sd.N, Tn, 1, horizontal);
      const hc = e.H;
      localBox(ef, 'arch_trim', s0, s1, hc, hc + 0.16, -T / 2 - 0.06, T / 2 + 0.06, { chamfer: 0.035 });
    }
    // ruin tops: capstones scattered
  }

  /** Corner type for a face end: 'inside' | 'straight' | 'convexExt' | 'convexNon' | 'free' */
  function classifyEnd(e, N, Tn, end, horizontal) {
    // vertex at this end
    let vi;
    let vj;
    if (horizontal) {
      vj = e.j;
      vi = Tn.x * end > 0 ? e.i + 1 : e.i;
    } else {
      vi = e.i;
      vj = Tn.z * end > 0 ? e.j + 1 : e.j;
    }
    const dirT = [Math.round(Tn.x * end), Math.round(Tn.z * end)];
    const col = edgeFrom(vi, vj, dirT[0], dirT[1]);
    const perpIn = edgeFrom(vi, vj, Math.round(N.x), Math.round(N.z));
    const perpOut = edgeFrom(vi, vj, -Math.round(N.x), -Math.round(N.z));
    if (perpIn) return perpIn.H >= e.H - 0.01 || !col ? 'inside' : 'straight';
    if (col) return 'straight';
    if (perpOut) return horizontal ? 'convexExt' : 'convexNon';
    return 'free';
  }

  /**
   * Broken-wall profile shared by both faces of a ruined edge: a walk of
   * sloped breaks and course-height steps (missing stones), as a fraction of
   * the wall height.
   */
  function makeJag(e, seed) {
    const ruinish = (ts.walls[e.style] === 'ruin' || ts.walls[e.style] === 'cave' || ts.walls[e.style] === 'ruin_timber') && !indoor;
    if (!ruinish) return null;
    const sa = -S / 2 - T / 2;
    const sb = S / 2 + T / 2;
    const n = 5 + Math.floor(seed * 3);
    const course = 0.3 / Math.max(1, e.H);
    const xs = [];
    const hs = [];
    const step = [];
    let h = 0.55 + hash(e.key, 'j0') * 0.4;
    for (let k = 0; k <= n; k++) {
      xs.push(sa + ((sb - sa) * k) / n + (k > 0 && k < n ? (hash(e.key, 'jx', k) - 0.5) * ((sb - sa) / n) * 0.6 : 0));
      h += (hash(e.key, 'j', k) - 0.5) * 0.5;
      h = THREE.MathUtils.clamp(h, 0.3, 1);
      hs.push(h);
      step.push(hash(e.key, 'js', k) < 0.4);
    }
    return (s) => {
      let k = 0;
      while (k < n - 1 && s > xs[k + 1]) k++;
      const t = THREE.MathUtils.clamp((s - xs[k]) / (xs[k + 1] - xs[k]), 0, 1);
      if (step[k]) {
        // stepped course: stones missing in whole-course units
        const a = Math.round(hs[k] / course) * course;
        const b = Math.round(hs[k + 1] / course) * course;
        const nSteps = Math.max(1, Math.round(Math.abs(b - a) / course));
        return Math.min(1, a + (b - a) * Math.min(1, Math.floor(t * (nSteps + 1)) / nSteps));
      }
      return hs[k] + (hs[k + 1] - hs[k]) * t;
    };
  }

  /** Wall chunk with a sloped top (p..q along the face), rubble core on top. */
  function prism(f, key, p, q, yb, tp, tq, d0, d1, o) {
    const P = (sv, y, d) => new THREE.Vector3(sv, y, d).applyMatrix4(f.basis);
    g.quad(key, P(p, yb, d1), P(q, yb, d1), P(q, tq, d1), P(p, tp, d1), null, o);
    g.quad(key, P(q, yb, d0), P(p, yb, d0), P(p, tp, d0), P(q, tq, d0), null, o);
    g.quad(key, P(p, yb, d0), P(p, yb, d1), P(p, tp, d1), P(p, tp, d0), null, o);
    g.quad(key, P(q, yb, d1), P(q, yb, d0), P(q, tq, d0), P(q, tq, d1), null, o);
    // exposed rubble-and-mortar core on the broken top
    g.quad('prop_rock', P(p, tp, d1), P(q, tq, d1), P(q, tq, d0), P(p, tp, d0), null, { ao: 0.8 });
  }

  // ------------------------------------------------------------ slab helpers
  function localMatrix(f, cx, cy, cz, rotZ = 0) {
    const m = new THREE.Matrix4().makeTranslation(cx, cy, cz);
    if (rotZ) m.multiply(new THREE.Matrix4().makeRotationZ(rotZ));
    return new THREE.Matrix4().multiplyMatrices(f.basis, m);
  }
  function localBox(f, key, s0, s1, y0, y1, d0, d1, o = {}) {
    if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3 || d1 - d0 < 1e-3) return;
    g.box(key, { ...o, matrix: localMatrix(f, (s0 + s1) / 2, (y0 + y1) / 2, (d0 + d1) / 2, o.rotZ ?? 0), s: [s1 - s0, y1 - y0, d1 - d0] });
  }
  /** Beam between two local points (s,y) at depth range. */
  function beam(f, key, a, b, w, d0, d1, o = {}) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const m = localMatrix(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (d0 + d1) / 2, ang);
    g.box(key, { uv: 'along', skip: ['nz'], ...o, matrix: m, s: [len, w, d1 - d0] });
  }
  function endExt(f, end, d0, d1) {
    const m = f.ends[end];
    if (m === 'inside') return -d1;
    if (m === 'convexExt') return d1;
    if (m === 'convexNon') return d0;
    return 0;
  }
  /**
   * Slab on a face between heights y0..y1 and depths d0..d1 (d measured from
   * wall centre toward the face's cell), with the edge's openings cut out.
   */
  function slab(f, key, y0, y1, d0, d1, o0 = {}) {
    const o = f.uvOff ? { uvOff: f.uvOff, ...o0 } : o0;
    const sa = -S / 2 - endExt(f, -1, d0, d1) - (o.extra ?? 0);
    const sb = S / 2 + endExt(f, 1, d0, d1) + (o.extra ?? 0);
    const ops = (o.noOpenings ? [] : f.openings).filter((op) => op.y1 > y0 && op.y0 < y1 && (!op.border || true));
    const br = new Set([sa, sb]);
    for (const op of ops) {
      if (op.s0 > sa && op.s0 < sb) br.add(op.s0);
      if (op.s1 > sa && op.s1 < sb) br.add(op.s1);
    }
    const jag = o.jag ? f.jag : null;
    if (jag) for (let k = 0; k <= 24; k++) br.add(THREE.MathUtils.lerp(sa, sb, k / 24));
    const xs = [...br].sort((a, b) => a - b);
    for (let k = 0; k < xs.length - 1; k++) {
      const p = xs[k];
      const q = xs[k + 1];
      if (q - p < 1e-4) continue;
      const mid = (p + q) / 2;
      let top = y1;
      if (jag) top = Math.min(y1, y0 + (y1 - y0) * jag(mid));
      const cuts = ops.filter((op) => op.s0 <= mid && op.s1 >= mid).map((op) => [Math.max(y0, op.y0), Math.min(top, op.y1)]).sort((a, b) => a[0] - b[0]);
      let yy = y0;
      for (const [c0, c1] of cuts) {
        if (c0 > yy) localBox(f, key, p, q, yy, c0, d0, d1, o);
        yy = Math.max(yy, c1);
      }
      if (jag && !cuts.length) {
        const tp = Math.min(y1, y0 + (y1 - y0) * jag(p + 1e-4));
        const tq = Math.min(y1, y0 + (y1 - y0) * jag(q - 1e-4));
        prism(f, key, p, q, yy, tp, tq, d0, d1, o);
      } else if (top > yy) localBox(f, key, p, q, yy, top, d0, d1, o);
    }
    if (jag && key === 'arch_ruin') {
      // loose and half-dislodged stones along the break (stone-scale silhouette)
      const n = 4 + Math.floor(hash(f.seed, 'ln') * 4);
      for (let k = 0; k < n; k++) {
        const sv = THREE.MathUtils.lerp(sa + 0.2, sb - 0.2, (k + hash(f.seed, k, 'lsx')) / n);
        if (ops.some((op) => op.s0 - 0.3 < sv && op.s1 + 0.3 > sv)) continue;
        const top = y0 + (y1 - y0) * jag(sv);
        const lw = 0.28 + hash(f.seed, k, 'lw') * 0.26;
        const lh = 0.18 + hash(f.seed, k, 'lh') * 0.1;
        const m = localMatrix(f, sv, top + lh * (0.1 + hash(f.seed, k, 'ly') * 0.3), (d0 + d1) / 2 + (hash(f.seed, k, 'lz') - 0.5) * 0.06, (hash(f.seed, k, 'lr') - 0.5) * 0.5);
        m.multiply(new THREE.Matrix4().makeRotationY((hash(f.seed, k, 'lry') - 0.5) * 0.4));
        g.box(key, { matrix: m, s: [lw, lh, Math.max(0.12, d1 - d0 + 0.03)], chamfer: 0.03, uvOff: o.uvOff });
      }
    }
  }
  const freeSpans = (f, y) => {
    // s-intervals free of openings at height y (within main range)
    const ops = f.openings.filter((op) => op.y0 <= y && op.y1 >= y).sort((a, b) => a.s0 - b.s0);
    const spans = [];
    let s = -S / 2;
    for (const op of ops) {
      if (op.s0 > s) spans.push([s, op.s0]);
      s = Math.max(s, op.s1);
    }
    if (s < S / 2) spans.push([s, S / 2]);
    return spans;
  };

  // ------------------------------------------------------------ recipes
  const RECIPES = {
    stone(f) {
      const H = f.H;
      slab(f, 'arch_stone', 0, H, 0, T / 2);
      // plinth course
      slab(f, 'arch_trim', 0, 0.42, T / 2, T / 2 + 0.07, { chamfer: 0.03, noOpeningsAbove: true });
      if (H > 4.2) {
        slab(f, 'arch_trim', 3.05, 3.22, T / 2, T / 2 + 0.06, { chamfer: 0.025 });
        slab(f, 'arch_trim', H - 0.28, H, T / 2, T / 2 + 0.12, { chamfer: 0.04 });
      }
      quoins(f, 'arch_trim');
      if (f.temple) templeOrder(f);
    },
    timber(f) {
      const H = f.H;
      const lowTop = Math.min(H, 3.05);
      const d1 = T / 2;
      slab(f, 'arch_stone', 0, 0.55, 0, d1 + 0.05, { chamfer: 0.025 });
      slab(f, 'arch_plaster', 0.55, lowTop, 0, d1, { tint: f.tint });
      frameBays(f, 0.55, lowTop, d1, 'arch_beam');
      if (H > 3.5) {
        const J = JETTY;
        // jetty: joist ends + bressumer + upper storey pushed out
        for (let s = -S / 2 + 0.2; s < S / 2 - 0.1; s += 0.42) localBox(f, 'arch_beam', s - 0.06, s + 0.06, lowTop - 0.14, lowTop + 0.02, d1 - 0.05, d1 + J, { uv: 'along', skip: ['nz'] });
        slab(f, 'arch_beam', lowTop + 0.02, lowTop + 0.24, d1 + J - 0.18, d1 + J + 0.04, { uv: 'along', skip: ['nz'] });
        slab(f, 'arch_plaster', lowTop + 0.24, H, d1 + J - 0.16, d1 + J, { tint: f.tint });
        frameBays(f, lowTop + 0.24, H, d1 + J, 'arch_beam', true);
        slab(f, 'arch_beam', H - 0.2, H, d1 + J - 0.02, d1 + J + 0.05, { uv: 'along', skip: ['nz'] });
      } else {
        slab(f, 'arch_beam', H - 0.2, H, d1 - 0.02, d1 + 0.05, { uv: 'along', skip: ['nz'] });
      }
      cornerPost(f, 'arch_beam', 0.55, lowTop, d1);
    },
    ruin(f) {
      slab(f, 'arch_ruin', 0, f.H, 0, T / 2, { jag: true });
      spots.ivy.push(f);
    },
    ruin_timber(f) {
      slab(f, 'arch_ruin', 0, Math.min(1.2, f.H), 0, T / 2 + 0.03, { chamfer: 0.03 });
      slab(f, 'arch_plaster', 1.2, f.H, 0, T / 2, { jag: true, tint: [0.8, 0.76, 0.7] });
      frameBays(f, 1.2, f.H * 0.8, T / 2, 'arch_beam_dark');
    },
    cave(f) {
      slab(f, 'arch_ruin', 0, f.H, 0, T / 2);
    },
    dungeon(f) {
      const H = f.H;
      slab(f, 'arch_dungeon', 0, H, 0, T / 2);
      slab(f, 'arch_trim', 0, 0.3, T / 2, T / 2 + 0.08, { chamfer: 0.03, tint: [0.62, 0.62, 0.6] });
      // pilasters at the cell corners (engaged piers carrying the ribs)
      for (const end of [-1, 1]) {
        if (f.ends[end] === 'inside' || f.ends[end] === 'free') continue;
        const s = end * (S / 2);
        localBox(f, 'arch_dungeon', s - 0.3, s + 0.3, 0, H, T / 2, T / 2 + 0.16, { chamfer: 0.05 });
        localBox(f, 'arch_trim', s - 0.36, s + 0.36, 0, 0.4, T / 2, T / 2 + 0.22, { chamfer: 0.04, tint: [0.6, 0.6, 0.58] });
        localBox(f, 'arch_trim', s - 0.36, s + 0.36, H - 0.55, H - 0.35, T / 2, T / 2 + 0.24, { chamfer: 0.04, tint: [0.6, 0.6, 0.58] });
      }
    },
    dungeon_brick(f) {
      slab(f, 'arch_brick', 0.5, f.H, 0, T / 2, { tint: [0.7, 0.66, 0.62] });
      slab(f, 'arch_dungeon', 0, 0.5, 0, T / 2 + 0.06, { chamfer: 0.03 });
    },
    int_plaster(f) {
      const H = f.H;
      const d1 = T / 2;
      slab(f, 'arch_wainscot', 0, 1.05, 0, d1 + 0.03);
      slab(f, 'arch_beam_dark', 0, 0.14, d1 + 0.03, d1 + 0.06, { uv: 'along' });
      slab(f, 'arch_beam_dark', 1.02, 1.12, d1 + 0.03, d1 + 0.08, { uv: 'along', skip: ['nz'] });
      slab(f, 'arch_plaster_int', 1.05, H, 0, d1, { tint: f.tint });
      slab(f, 'arch_beam_dark', H - 0.18, H, d1, d1 + 0.06, { uv: 'along', skip: ['nz'] });
      for (const [s0, s1] of freeSpans(f, 1.6)) {
        if (s1 - s0 < 0.9) continue;
        for (const s of [s0 + 0.1, s1 - 0.1]) if (Math.abs(s) < S / 2 - 0.05) localBox(f, 'arch_beam_dark', s - 0.08, s + 0.08, 1.12, H - 0.18, d1, d1 + 0.05, { uv: 'along', skip: ['nz'] });
      }
    },
    int_panel(f) {
      const H = f.H;
      slab(f, 'arch_wainscot', 0, H - 0.2, 0, T / 2 + 0.02);
      slab(f, 'arch_beam_dark', H - 0.2, H, T / 2, T / 2 + 0.07, { uv: 'along', skip: ['nz'] });
      slab(f, 'arch_beam_dark', 0, 0.16, T / 2 + 0.02, T / 2 + 0.05, { uv: 'along' });
    },
    int_stone(f) {
      slab(f, 'arch_stone_cold', 0, f.H, 0, T / 2);
      slab(f, 'arch_trim', 0, 0.3, T / 2, T / 2 + 0.05, { chamfer: 0.02 });
    },
  };

  /** Timber framing: posts, rails, braces over the free bays of a storey. */
  function frameBays(f, y0, y1, d, key, upper = false) {
    const bw = 0.17;
    const dd0 = d - 0.02;
    const dd1 = d + 0.045;
    // sill & head
    slab(f, key, y0, y0 + 0.16, dd0, dd1, { uv: 'along', skip: ['nz'] });
    const posts = new Set();
    for (const end of [-1, 1]) if (f.ends[end] !== 'inside') posts.add(end * (S / 2 - (f.ends[end] === 'convexExt' || f.ends[end] === 'convexNon' ? 0 : 0.02)));
    for (const op of f.openings) {
      if (op.y1 < y0 || op.y0 > y1) continue;
      posts.add(op.s0 - bw / 2);
      posts.add(op.s1 + bw / 2);
    }
    const spans = freeSpans(f, (y0 + y1) / 2);
    for (const [a, b] of spans) {
      const wdt = b - a;
      if (wdt > 1.9) {
        const n = Math.round(wdt / 1.25);
        for (let k = 1; k < n; k++) posts.add(a + (wdt * k) / n);
      }
    }
    const ps = [...posts].filter((s) => s >= -S / 2 - 0.01 && s <= S / 2 + 0.01).sort((a, b) => a - b);
    for (const s of ps) localBox(f, key, s - bw / 2, s + bw / 2, y0 + 0.16, y1 - 0.02, dd0, dd1, { uv: 'along', skip: ['nz'] });
    // braces + mid-rails in free bays between consecutive posts
    for (let k = 0; k < ps.length - 1; k++) {
      const a = ps[k] + bw / 2;
      const b = ps[k + 1] - bw / 2;
      if (b - a < 0.35) continue;
      const mid = (a + b) / 2;
      const blocked = f.openings.some((op) => op.s0 < b && op.s1 > a && op.y1 > y0 && op.y0 < y1);
      const r = hash(f.seed, k, upper ? 'u' : 'l');
      if (blocked) {
        // rails above/below openings
        for (const op of f.openings) {
          if (op.s0 < b && op.s1 > a && op.y1 > y0 && op.y0 < y1) {
            if (op.y0 > y0 + 0.3) localBox(f, key, a, b, op.y0 - 0.14, op.y0, dd0, dd1 + 0.02, { uv: 'along', skip: ['nz'] });
            if (op.y1 < y1 - 0.3) localBox(f, key, a, b, op.y1, op.y1 + 0.14, dd0, dd1, { uv: 'along', skip: ['nz'] });
          }
        }
        continue;
      }
      const top = y1 - 0.02;
      const bot = y0 + 0.16;
      if (r < 0.4) {
        beam(f, key, [a, bot], [b, top], 0.15, dd0, dd1 - 0.005);
      } else if (r < 0.7) {
        beam(f, key, [a, top], [b, bot], 0.15, dd0, dd1 - 0.005);
      } else if (r < 0.88) {
        // St Andrew's cross / herringbone
        beam(f, key, [a, bot], [mid, (bot + top) / 2], 0.14, dd0, dd1 - 0.005);
        beam(f, key, [b, bot], [mid, (bot + top) / 2], 0.14, dd0, dd1 - 0.005);
        localBox(f, key, a, b, (bot + top) / 2 - 0.07, (bot + top) / 2 + 0.07, dd0, dd1, { uv: 'along', skip: ['nz'] });
      } else {
        localBox(f, key, a, b, (bot + top) / 2 - 0.07, (bot + top) / 2 + 0.07, dd0, dd1, { uv: 'along', skip: ['nz'] });
      }
    }
  }

  function cornerPost(f, key, y0, y1, d) {
    for (const end of [-1, 1]) {
      if (f.ends[end] !== 'convexExt') continue;
      const s = end * (S / 2 + d);
      localBox(f, key, s - 0.13, s + 0.13, y0, y1, d - 0.2, d + 0.06, { uv: 'along', skip: ['nz'] });
    }
  }

  /** Engaged pilasters with bases and capitals (temple facades). */
  function templeOrder(f) {
    const H = f.H;
    for (const end of [-1, 1]) {
      if (f.ends[end] === 'inside') continue;
      const s = end * (S / 2 - 0.05);
      if (f.openings.some((o) => o.s0 - 0.3 < s && o.s1 + 0.3 > s)) continue;
      localBox(f, 'arch_trim', s - 0.26, s + 0.26, 0.42, H - 0.3, T / 2, T / 2 + 0.12, { chamfer: 0.03 });
      localBox(f, 'arch_trim', s - 0.34, s + 0.34, 0.42, 0.75, T / 2, T / 2 + 0.18, { chamfer: 0.04 });
      localBox(f, 'arch_trim', s - 0.36, s + 0.36, H - 0.62, H - 0.3, T / 2, T / 2 + 0.2, { chamfer: 0.04 });
    }
  }

  /** Alternating long/short quoin blocks at convex corners. */
  function quoins(f, key) {
    for (const end of [-1, 1]) {
      const m = f.ends[end];
      if (m !== 'convexExt' && m !== 'convexNon') continue;
      const outer = S / 2 + T / 2 + (m === 'convexExt' ? 0.03 : -0.02);
      const h = 0.36;
      for (let y = 0.42, k = 0; y < f.H - 0.3; y += h, k++) {
        const len = (k + (m === 'convexExt' ? 0 : 1)) % 2 ? 0.34 : 0.62;
        const a = end * outer;
        const b = end * (outer - len);
        localBox(f, key, Math.min(a, b), Math.max(a, b), y + 0.012, y + h - 0.012, T / 2 - 0.02, T / 2 + 0.03, { chamfer: 0.025 });
      }
    }
  }

  /** Box whose local Y runs p0→p1 and local X follows `xHint` (orthogonalised). */
  function alongBox(key, p0, p1, xHint, [sx, sz], o = {}) {
    const dir = p1.clone().sub(p0);
    const len = dir.length();
    dir.normalize();
    const xa = xHint.clone().addScaledVector(dir, -xHint.dot(dir)).normalize();
    const za = new THREE.Vector3().crossVectors(xa, dir);
    const m = new THREE.Matrix4().makeBasis(xa, dir, za).setPosition(p0.clone().add(p1).multiplyScalar(0.5));
    g.box(key, { ...o, matrix: m, s: [sx, len, sz] });
  }

  /** Coping extension at an edge end (edge-level, full thickness). */
  function copingExt(e, N, Tn, end, horizontal) {
    let vi;
    let vj;
    if (horizontal) {
      vj = e.j;
      vi = Tn.x * end > 0 ? e.i + 1 : e.i;
    } else {
      vi = e.i;
      vj = Tn.z * end > 0 ? e.j + 1 : e.j;
    }
    const col = edgeFrom(vi, vj, Math.round(Tn.x * end), Math.round(Tn.z * end));
    const p1 = edgeFrom(vi, vj, Math.round(N.x), Math.round(N.z));
    const p2 = edgeFrom(vi, vj, -Math.round(N.x), -Math.round(N.z));
    const w = T / 2 + 0.06;
    if (col) return 0;
    if (!p1 && !p2) return w;
    const taller = [p1, p2].some((p) => p && p.H > e.H + 0.2);
    if (taller) return -T / 2;
    if (p1 && p2) return -w;
    return horizontal ? w : -w;
  }

  // ------------------------------------------------------------ doors / arches / windows
  function buildDoor(f, e, sides, fA, found) {
    const w = DOOR_W;
    const h = DOOR_H;
    const style = ts.walls[e.style];
    const stoneFrame = style === 'stone' || style === 'dungeon' || style === 'int_stone' || style === 'dungeon_brick' || style === 'cave' || style === 'ruin';
    const frameKey = stoneFrame ? 'arch_trim' : 'arch_beam_dark';
    const fd0 = -T / 2 - 0.05;
    const fd1 = T / 2 + 0.05;
    // ambient occlusion in the reveal: jamb faces turned toward the opening and the soffit are shaded
    const Tl = f.T;
    const revealAO = (p, n) => {
      let a = defaultAO(p, n);
      if (Math.abs(n.x * Tl.x + n.z * Tl.z) > 0.6) a *= 0.55;
      if (n.y < -0.5) a *= 0.45;
      return a;
    };
    const fu = stoneFrame ? 'world' : 'along';
    // jambs built from alternating long/short blocks (stone) or a single post (timber)
    for (const sgn of [-1, 1]) {
      const a = sgn < 0 ? -w / 2 - 0.2 : w / 2;
      const b = sgn < 0 ? -w / 2 : w / 2 + 0.2;
      if (stoneFrame) {
        let y = 0;
        for (let k = 0; y < h - 0.01; k++) {
          const bh = Math.min(h - y, 0.36 + hash(e.key, sgn, k, 'jb') * 0.16);
          const long = (k + (sgn > 0 ? 1 : 0)) % 2 === 0;
          const ext = long ? 0.12 : 0;
          localBox(f, frameKey, sgn < 0 ? a - ext : a, sgn < 0 ? b : b + ext, y + 0.006, y + bh - 0.006, fd0 + (long ? 0 : 0.015), fd1 - (long ? 0 : 0.015), { chamfer: 0.025 + hash(e.key, sgn, k, 'jc') * 0.02, uv: fu, ao: revealAO });
          y += bh;
        }
      } else localBox(f, frameKey, a, b, 0, h, fd0, fd1, { chamfer: 0.03, uv: fu, ao: revealAO });
    }
    localBox(f, frameKey, -w / 2 - 0.32, w / 2 + 0.32, h, h + 0.26, fd0 - 0.02, fd1 + 0.02, { chamfer: 0.035, uv: fu, ao: revealAO });
    if (stoneFrame) localBox(f, 'arch_trim', -0.14, 0.14, h + 0.02, h + 0.3, fd0 - 0.04, fd1 + 0.04, { chamfer: 0.03 }); // keystone
    localBox(f, 'arch_trim', -w / 2 - 0.05, w / 2 + 0.05, 0, 0.06, fd0 - 0.12, fd1 + 0.12, { chamfer: 0.02 }); // threshold step

    // door leaf (own mesh so it can swing): five planks, battens, forged strap hinges with rivets
    const lg = new GeoBuilder();
    const lw = w - 0.03;
    const lh = h - 0.03;
    const th = 0.08;
    // occlusion: darker toward the lintel and the jambs, as in a deep reveal
    lg.aoFn = (p) => {
      const top = 1 - 0.42 * THREE.MathUtils.smoothstep(p.y, lh - 0.55, lh);
      const side = 0.78 + 0.22 * THREE.MathUtils.smoothstep(Math.min(p.x, lw - p.x), 0.0, 0.18);
      return top * side * (0.8 + 0.2 * THREE.MathUtils.smoothstep(p.y, 0, 0.3));
    };
    const np = 5;
    const pw = lw / np;
    for (let k = 0; k < np; k++) {
      const x0 = k * pw + 0.004;
      const x1 = (k + 1) * pw - 0.004;
      const tk = th - hash(e.key, k, 'pt') * 0.012;
      const dz = (hash(e.key, k, 'pz') - 0.5) * 0.006;
      // vertical segments concentrate vertex AO near the head of the door
      for (const [y0, y1] of [[0, 0.32], [0.32, lh - 0.6], [lh - 0.6, lh - 0.18], [lh - 0.18, lh - hash(e.key, k, 'ph') * 0.02]]) {
        lg.box('arch_door', { c: [(x0 + x1) / 2, (y0 + y1) / 2, dz], s: [x1 - x0, y1 - y0, tk], uv: 'local', chamfer: 0.006, uvRect: [x0 / lw, y0 / lh, x1 / lw, y1 / lh], skip: y0 > 0 ? ['ny'] : y1 < lh - 0.1 ? ['py'] : [] });
      }
    }
    const rivet = new THREE.SphereGeometry(0.016, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    rivet.rotateX(Math.PI / 2);
    const rivetBack = rivet.clone().rotateY(Math.PI);
    const strapYs = [0.38, lh - 0.42];
    for (const yy of strapYs) {
      for (const sgnZ of [1, -1]) {
        const z = sgnZ * (th / 2 + 0.008);
        // strap tapering to a spearhead end
        lg.box('prop_iron', { c: [lw * 0.38, yy, z], s: [lw * 0.74, 0.075, 0.014], chamfer: 0.004 });
        const tipM = new THREE.Matrix4().makeTranslation(lw * 0.76, yy, z).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
        lg.box('prop_iron', { matrix: tipM, s: [0.075, 0.075, 0.014], chamfer: 0.004 });
        // rivet heads along the strap
        for (let k = 0; k < 6; k++) {
          const x = 0.1 + k * ((lw * 0.62) / 5);
          lg.geometry('prop_iron', sgnZ > 0 ? rivet : rivetBack, new THREE.Matrix4().makeTranslation(x, yy + (k % 2 ? 0.012 : -0.012), z + sgnZ * 0.007), { ao: 1 });
        }
      }
      // hinge knuckle wrapping the leaf edge + pintle on the jamb
      lg.box('prop_iron', { c: [0.012, yy, 0], s: [0.05, 0.12, th + 0.04], chamfer: 0.012 });
    }
    // clout nails in a grid on the face (both sides)
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < np; k++) {
        const x = (k + 0.5) * pw;
        const y = 0.75 + r * ((lh - 1.55) / 3);
        for (const sgnZ of [1, -1]) lg.geometry('prop_iron', sgnZ > 0 ? rivet : rivetBack, new THREE.Matrix4().makeTranslation(x, y, sgnZ * (th / 2 + 0.002)), { ao: 0.9 });
      }
    }
    rivet.dispose();
    rivetBack.dispose();
    if (hash(e.key, 'grille') < 0.6) {
      const gy = 1.55;
      const gx = lw / 2;
      for (const z of [th / 2 + 0.01, -th / 2 - 0.01]) {
        lg.box('prop_iron', { c: [gx, gy + 0.14, z], s: [0.34, 0.035, 0.022], chamfer: 0.006 });
        lg.box('prop_iron', { c: [gx, gy - 0.14, z], s: [0.34, 0.035, 0.022], chamfer: 0.006 });
        for (const bx of [-0.15, 0.15]) lg.box('prop_iron', { c: [gx + bx, gy, z], s: [0.035, 0.31, 0.022], chamfer: 0.006 });
        for (const bx of [-0.07, 0, 0.07]) lg.box('prop_iron', { c: [gx + bx, gy, z], s: [0.02, 0.26, 0.02] });
      }
      lg.box('arch_beam_dark', { c: [gx, gy, 0], s: [0.26, 0.24, th * 0.6], uv: 'local', ao: 0.25 }); // dark void behind
    }
    const ringGeo = new THREE.TorusGeometry(0.075, 0.013, 6, 14);
    for (const z of [th / 2 + 0.025, -th / 2 - 0.025]) {
      lg.geometry('prop_iron', ringGeo, new THREE.Matrix4().makeTranslation(lw - 0.24, 1.0, z), { ao: 1 });
      lg.box('prop_iron', { c: [lw - 0.24, 1.08, z * 0.8], s: [0.07, 0.07, 0.03], chamfer: 0.012 });
      lg.box('prop_iron', { c: [lw - 0.24, 1.25, z * 0.8], s: [0.09, 0.16, 0.012], chamfer: 0.006 }); // escutcheon
    }
    ringGeo.dispose();
    const pivot = new THREE.Group();
    const leaf = new THREE.Group();
    for (const [key, geo] of lg.build()) {
      const mesh = new THREE.Mesh(geo, getMaterial(key));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      leaf.add(mesh);
    }
    pivot.add(leaf);
    // hinge at s = -w/2, centred in wall thickness
    const hinge = new THREE.Vector3(-w / 2 + 0.015, 0, 0).applyMatrix4(f.basis);
    pivot.position.copy(hinge);
    const yaw = Math.atan2(-f.T.z, f.T.x);
    pivot.rotation.y = yaw;
    group.add(pivot);
    const door = {
      pivot,
      locked: e.type === EDGE.LOCKED,
      open: 0,
      anim: null,
      /** @param {number} t 0 closed .. 1 fully open; sign: +1 swings toward N side of face A, -1 away */
      setOpen(t, sign = 1) {
        door.open = t;
        pivot.rotation.y = yaw + sign * t * 1.85;
      },
      normal: f.N.clone(),
      center: new THREE.Vector3(0, 1.2, 0).applyMatrix4(f.basis),
    };
    const k1 = `${e.x},${e.y},${e.dir}`;
    doors.set(k1, door);
    const [dx, dy] = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[e.dir];
    const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }[e.dir];
    doors.set(`${e.x + dx},${e.y + dy},${opp}`, door);
    void found;
    void sides;
    void fA;
  }

  function buildArch(f, e) {
    const r = ARCH_W / 2;
    const spring = ARCH_SPRING;
    const H = e.H;
    const d0 = -T / 2;
    const d1 = T / 2;
    // spandrel fill (stepped strips hidden behind the voussoir ring)
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = -r + (2 * r * k) / n;
      const b = a + (2 * r) / n;
      const inner = Math.min(Math.abs(a), Math.abs(b));
      const y = spring + Math.sqrt(Math.max(0, r * r - inner * inner));
      const top = Math.max(y, H);
      if (top > y + 0.01) localBox(f, ts.walls[e.style] === 'timber' ? 'arch_stone' : wallKey(e), a, b, y, top, d0 + 0.01, d1 - 0.01);
    }
    // voussoirs
    const vn = 11;
    const ring = 0.38;
    for (let k = 0; k < vn; k++) {
      const a0 = (Math.PI * k) / vn;
      const a1 = (Math.PI * (k + 1)) / vn;
      const am = (a0 + a1) / 2;
      const rr = r + ring / 2;
      const cx = Math.cos(am) * rr;
      const cy = spring + Math.sin(am) * rr;
      const len = (a1 - a0) * rr * 0.97;
      const key = k === (vn - 1) / 2;
      const m = localMatrix(f, cx, cy, 0, am - Math.PI / 2);
      g.box('arch_trim', { matrix: m, s: [len * (key ? 1.15 : 1), ring * (key ? 1.25 : 1), T + (key ? 0.2 : 0.12)], chamfer: 0.035 });
    }
    // jamb piers + imposts
    for (const sgn of [-1, 1]) {
      localBox(f, 'arch_trim', sgn > 0 ? r : -r - 0.3, sgn > 0 ? r + 0.3 : -r, 0, spring, d0 - 0.06, d1 + 0.06, { chamfer: 0.04 });
      localBox(f, 'arch_trim', sgn > 0 ? r - 0.05 : -r - 0.42, sgn > 0 ? r + 0.42 : -r + 0.05, spring - 0.2, spring, d0 - 0.1, d1 + 0.1, { chamfer: 0.04 });
      localBox(f, 'arch_trim', sgn > 0 ? r - 0.02 : -r - 0.4, sgn > 0 ? r + 0.4 : -r + 0.02, 0, 0.35, d0 - 0.1, d1 + 0.1, { chamfer: 0.04 });
    }
    localBox(f, 'arch_trim', -r - 0.1, r + 0.1, 0, 0.05, d0 - 0.2, d1 + 0.2, { chamfer: 0.02 });
  }
  function wallKey(e) {
    const rec = ts.walls[e.style];
    return { stone: 'arch_stone', ruin: 'arch_ruin', dungeon: 'arch_dungeon', dungeon_brick: 'arch_brick', cave: 'arch_ruin', int_stone: 'arch_stone_cold', int_plaster: 'arch_plaster_int', int_panel: 'arch_wainscot', ruin_timber: 'arch_ruin' }[rec] ?? 'arch_stone';
  }

  function buildWindow(f, e, o, sides, fA, covA, covB) {
    const style = ts.walls[e.style];
    const timber = style === 'timber' || style === 'int_plaster' || style === 'int_panel' || style === 'ruin_timber';
    const fk = timber ? 'arch_beam_dark' : 'arch_trim';
    const { s0, s1, y0, y1 } = o;
    // which side is outside? (the uncovered one)
    const outSign = indoor ? (map.inBounds(sides[0].cx, sides[0].cy) ? -1 : 1) * (fA === 0 ? 1 : -1) : (fA === 0 ? (covA ? -1 : 1) : (covB ? -1 : 1));
    // outSign: +1 means +N (of basis side fA) is outside
    const jetty = o.upper && style === 'timber' ? JETTY : 0;
    const dOut = outSign * (T / 2 + jetty);
    const dIn = o.upper ? outSign * (T / 2 + jetty - 0.18) : -outSign * T / 2;
    const dMin = Math.min(dOut, dIn) - 0.03;
    const dMax = Math.max(dOut, dIn) + 0.03;
    const u = uvMode(timber);
    // frame (jambs, head, sill)
    localBox(f, fk, s0 - 0.09, s0, y0, y1, dMin, dMax, { uv: u });
    localBox(f, fk, s1, s1 + 0.09, y0, y1, dMin, dMax, { uv: u });
    localBox(f, fk, s0 - 0.16, s1 + 0.16, y1, y1 + 0.16, dMin - 0.01, dMax + 0.01, { chamfer: 0.02, uv: u });
    const sillOut = outSign > 0 ? [dMin, dMax + 0.12] : [dMin - 0.12, dMax];
    localBox(f, 'arch_trim', s0 - 0.14, s1 + 0.14, y0 - 0.1, y0, sillOut[0], sillOut[1], { chamfer: 0.02 });
    // mullion + transom
    const midD = dOut - outSign * 0.1;
    localBox(f, fk, -0.03, 0.03, y0, y1, midD - 0.03, midD + 0.03, { uv: u });
    localBox(f, fk, s0, s1, y0 + (y1 - y0) * 0.62 - 0.03, y0 + (y1 - y0) * 0.62 + 0.03, midD - 0.03, midD + 0.03, { uv: u });
    // glass panes: exterior-facing (lit at night) and interior-facing (daylight)
    const paneD = dOut - outSign * 0.12;
    // panes are merged per side into one mesh each (see assemble)
    const quad = (sign, key) => {
      const p = [[s0, y0], [s1, y0], [s1, y1], [s0, y1]].map(([s, y]) => new THREE.Vector3(s, y, paneD + sign * 0.004).applyMatrix4(f.basis));
      const u = sign > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[1, 0], [0, 0], [0, 1], [1, 1]];
      if (sign > 0) panes.quad(key, p[0], p[1], p[2], p[3], u, { ao: 1 });
      else panes.quad(key, p[1], p[0], p[3], p[2], [u[1], u[0], u[3], u[2]], { ao: 1 });
    };
    if (!indoor) quad(outSign, 'win_ext');
    if (!o.upper) quad(-outSign, 'win_int');
    // shutters (exterior, some windows), opened at an angle
    const r = hash(e.key, o.y0, 'sh');
    const templeWall = [sides[0], sides[1]].some((sd) => compAt(sd.cx, sd.cy)?.temple);
    if (!indoor && !templeWall && r < 0.55) {
      const sw = (s1 - s0) / 2 + 0.05;
      for (const sgn of [-1, 1]) {
        const hingeS = sgn < 0 ? s0 - 0.09 : s1 + 0.09;
        const ang = sgn * (1.9 + hash(e.key, sgn, 'a') * 0.5);
        const m = new THREE.Matrix4().multiplyMatrices(f.basis, new THREE.Matrix4().makeTranslation(hingeS, (y0 + y1) / 2, dOut + outSign * 0.03));
        m.multiply(new THREE.Matrix4().makeRotationY(outSign > 0 ? ang : -ang));
        m.multiply(new THREE.Matrix4().makeTranslation(-sgn * sw / 2, 0, 0));
        g.box('arch_door', { matrix: m, s: [sw, y1 - y0 + 0.05, 0.05], uv: 'local', tint: r < 0.25 ? [0.55, 0.75, 0.62] : [0.78, 0.5, 0.42] });
      }
    }
    // ground-floor iron bars on some windows
    if (!indoor && !o.upper && (r > 0.8 || templeWall)) {
      for (let s = s0 + 0.12; s < s1 - 0.05; s += 0.16) {
        const m = localMatrix(f, s, (y0 + y1) / 2, dOut + outSign * 0.02);
        g.box('arch_iron', { matrix: m, s: [0.025, y1 - y0, 0.025] });
      }
    }
    // flower box on some upper windows
    if (!indoor && !templeWall && o.upper && hash(e.key, 'fb') < 0.35) {
      localBox(f, 'arch_beam', s0 - 0.05, s1 + 0.05, y0 - 0.34, y0 - 0.1, outSign > 0 ? dOut + 0.02 : dOut - 0.26, outSign > 0 ? dOut + 0.26 : dOut - 0.02, { uv: 'along', skip: ['nz'] });
      spots.lamp.push({ kind: 'flowers', pos: new THREE.Vector3((s0 + s1) / 2, y0 - 0.1, dOut + outSign * 0.14).applyMatrix4(f.basis), T: f.T.clone(), w: s1 - s0 });
    }
    const lightPos = new THREE.Vector3((s0 + s1) / 2, (y0 + y1) / 2, dOut + outSign * 0.3).applyMatrix4(f.basis);
    const outN = f.N.clone().multiplyScalar(outSign);
    windows.push({ pos: lightPos, N: outN, upper: !!o.upper, w: s1 - s0, h: y1 - y0, y0, border: !!o.border });
  }
  const uvMode = (timber) => (timber ? 'along' : 'world');

  // ------------------------------------------------------------ hearth
  function buildHearth(f) {
    const d = T / 2;
    const H = f.H;
    const depth = 0.6;
    localBox(f, 'arch_trim', -1.2, 1.2, 0, 0.09, d, d + depth + 0.35, { chamfer: 0.03 });
    // chimney breast with firebox opening
    localBox(f, 'arch_trim', -1.05, -0.62, 0, 1.2, d, d + depth, { chamfer: 0.03, tint: [0.78, 0.74, 0.7] });
    localBox(f, 'arch_trim', 0.62, 1.05, 0, 1.2, d, d + depth, { chamfer: 0.03, tint: [0.78, 0.74, 0.7] });
    localBox(f, 'arch_trim', -0.95, 0.95, 1.2, H, d, d + depth - 0.08, { tint: [0.72, 0.68, 0.64] });
    localBox(f, 'arch_brick', -0.62, 0.62, 0.09, 1.2, d, d + 0.06, { tint: [0.35, 0.3, 0.28] });
    localBox(f, 'arch_brick', -0.62, 0.62, 1.05, 1.2, d, d + depth - 0.02, { tint: [0.3, 0.26, 0.24] });
    // mantel
    localBox(f, 'arch_beam_dark', -1.25, 1.25, 1.2, 1.42, d, d + depth + 0.14, { chamfer: 0.02, uv: 'along' });
    // logs (round, barked, charred ends) on andirons over a glowing ember bed
    const logGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.82, 9);
    logGeo.rotateZ(Math.PI / 2);
    for (const [a, yy, r, dz] of [[-0.1, 0.2, 0.22, 0.28], [0.12, 0.21, -0.18, 0.4], [0.0, 0.34, 0.05, 0.33]]) {
      const m = localMatrix(f, a, yy, d + dz, 0);
      m.multiply(new THREE.Matrix4().makeRotationY(r)).multiply(new THREE.Matrix4().makeRotationZ(yy > 0.3 ? 0.12 : 0.04));
      g.geometry('arch_beam_dark', logGeo, m, { uv: 'world', tint: [0.42, 0.33, 0.28], ao: 0.85 });
    }
    logGeo.dispose();
    for (const a of [-0.35, 0.35]) {
      localBox(f, 'arch_iron', a - 0.025, a + 0.025, 0.09, 0.3, d + 0.12, d + 0.56);
      localBox(f, 'arch_iron', a - 0.03, a + 0.03, 0.09, 0.42, d + 0.53, d + 0.58, { chamfer: 0.01 });
    }
    {
      const emat = new THREE.MeshStandardMaterial({ color: 0x050302, emissive: new THREE.Color(0xff6a24), emissiveMap: getEmberTexture(), emissiveIntensity: 2.6, roughness: 1 });
      const egeo = new THREE.PlaneGeometry(1.0, 0.42);
      egeo.rotateX(-Math.PI / 2);
      const em = new THREE.Mesh(egeo, emat);
      em.applyMatrix4(localMatrix(f, 0, 0.1, d + 0.3, 0));
      em.userData.ownMaterial = true;
      group.add(em);
      // soot plume up the chimney breast above the firebox
      const smat = new THREE.MeshStandardMaterial({ color: 0x050403, alphaMap: getSootTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
      const sgeo = new THREE.PlaneGeometry(1.5, 2.2);
      const sm = new THREE.Mesh(sgeo, smat);
      sm.applyMatrix4(localMatrix(f, 0, 1.42 + 1.1 - 0.15, d + depth - 0.08 + 0.004, 0));
      sm.userData.ownMaterial = true;
      sm.renderOrder = 3;
      group.add(sm);
      const sm2 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), smat);
      sm2.applyMatrix4(localMatrix(f, 0, 0.75, d + 0.064, 0));
      sm2.renderOrder = 3;
      group.add(sm2);
    }
    const pos = new THREE.Vector3(0, 0.22, d + 0.32).applyMatrix4(f.basis);
    torches.push({ pos, base: pos.clone(), N: f.N.clone(), lit: true, kind: 'hearth', seed: 77 });
  }

  // ------------------------------------------------------------ sconces
  function placeSconces(face, nearOpening) {
    const lit = indoor || night > 0.15;
    if (!face.interior && ts.outdoors) {
      if (!nearOpening) return;
      const r = hash(face.seed, 'sconce');
      if (r > 0.62) return;
      // on the viewer's left of the opening (the party roster covers the upper right of the view)
      const s = -(face.e.type === EDGE.ARCH ? ARCH_W / 2 + 0.75 : DOOR_W / 2 + 0.5);
      addSconce(face, s, 2.2, true);
      return;
    }
    if (indoor && nearOpening && face.e.type !== EDGE.SECRET) {
      const r = hash(face.seed, 'dsc');
      if (r < 0.55) addSconce(face, (r < 0.27 ? -1 : 1) * (face.e.type === EDGE.ARCH ? ARCH_W / 2 + 0.6 : DOOR_W / 2 + 0.45), ts.id === 'dungeon' ? 2.05 : 1.9, true, ts.id === 'interior' ? 'candle' : 'torch');
      return;
    }
    if (indoor && !nearOpening) {
      if (face.e.type === EDGE.WALL || face.e.type === EDGE.SECRET) {
        const k = `${face.cell.x},${face.cell.y}`;
        if (!plainFaces.has(k)) plainFaces.set(k, []);
        plainFaces.get(k).push(face);
      }
      const r = hash(face.seed, 'isc');
      if (r < (ts.id === 'dungeon' ? 0.13 : 0.1)) addSconce(face, 0, ts.id === 'dungeon' ? 2.05 : 1.9, true, ts.id === 'interior' ? 'candle' : 'torch');
    }
  }
  function addSconce(face, s, y, lit, kind = 'torch') {
    const d = T / 2 + (face.recipe === 'timber' && y > 3.1 ? JETTY : 0);
    const base = new THREE.Vector3(s, y, d).applyMatrix4(face.basis);
    const out = face.N.clone();
    // bracket: wall plate + arm + cup
    localBox(face, 'arch_iron', s - 0.06, s + 0.06, y - 0.28, y + 0.02, d, d + 0.03);
    beamIron(face, [s, y - 0.22, d + 0.02], [s, y - 0.1, d + 0.24]);
    const tip = new THREE.Vector3(s, y + 0.02, d + 0.26).applyMatrix4(face.basis);
    if (kind === 'torch') {
      // wooden torch stick, leaning out
      const m = localMatrix(face, s, y - 0.06, d + 0.25);
      m.multiply(new THREE.Matrix4().makeRotationX(-0.25));
      g.box('arch_beam_dark', { matrix: m, s: [0.05, 0.42, 0.05], uv: 'along' });
      const mc = localMatrix(face, s, y + 0.12, d + 0.3);
      g.box('arch_iron', { matrix: mc, s: [0.1, 0.1, 0.1], chamfer: 0.02 });
    } else {
      // candle lantern
      localBox(face, 'arch_iron', s - 0.1, s + 0.1, y - 0.1, y - 0.07, d + 0.16, d + 0.36);
      localBox(face, 'arch_iron', s - 0.11, s + 0.11, y + 0.22, y + 0.26, d + 0.15, d + 0.37, { chamfer: 0.01 });
    }
    torches.push({ pos: kind === 'torch' ? tip.clone().add(new THREE.Vector3(0, 0.14, 0)).addScaledVector(out, 0.06) : tip.clone(), base, N: out, lit, kind, seed: Math.floor(face.seed * 1000) });
  }
  function beamIron(face, a, b) {
    const va = new THREE.Vector3(...a).applyMatrix4(face.basis);
    const vb = new THREE.Vector3(...b).applyMatrix4(face.basis);
    const len = va.distanceTo(vb);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize());
    g.box('arch_iron', { matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), s: [0.03, len, 0.03] });
  }

  const plainFaces = new Map();
  for (const e of allEdges) buildEdge(e);

  // Dungeons: guarantee a lit sconce within reach of every walkable cell
  // (content maps rarely place lights; the lantern alone leaves voids).
  if (ts.id === 'dungeon') {
    const reach = 1.55 * S;
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        if (solidCell(x, y)) continue;
        const cx = x * S + S / 2;
        const cz = y * S + S / 2;
        if (torches.some((t) => t.lit && Math.abs(t.pos.x - cx) < reach && Math.abs(t.pos.z - cz) < reach)) continue;
        const faces = plainFaces.get(`${x},${y}`);
        if (!faces?.length) continue;
        const f = faces[Math.floor(hash(map.id, x, y, 'autosc') * faces.length)];
        addSconce(f, (hash(map.id, x, y, 'aso') - 0.5) * 0.8, 2.05, true, 'torch');
      }
    }
  }

  // ------------------------------------------------------------ floors & ceilings
  const SUB = 4;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const cell = map.getCell(x, y);
      if (solidCell(x, y) && (indoor || covered(x, y))) continue;
      const key = ts.floors[cell] ?? 'arch_cobble';
      const x0 = x * S;
      const z0 = y * S;
      const wallN = map.getEdge(x, y, 'N') !== EDGE.OPEN;
      const wallS = map.getEdge(x, y, 'S') !== EDGE.OPEN;
      const wallW = map.getEdge(x, y, 'W') !== EDGE.OPEN;
      const wallE = map.getEdge(x, y, 'E') !== EDGE.OPEN;
      const cov = covered(x, y);
      const aoF = (p) => {
        const lx = p.x - x0;
        const lz = p.z - z0;
        let a = 1;
        const k = (dist) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(dist - T / 2, 0, 0.75);
        if (wallN) a *= k(lz);
        if (wallS) a *= k(S - lz);
        if (wallW) a *= k(lx);
        if (wallE) a *= k(S - lx);
        if (cov) a *= 0.85;
        return a;
      };
      const fy = cell === CELL.WATER ? -0.45 : 0;
      for (let j = 0; j < SUB; j++) {
        if (cell === CELL.WATER && map.harbour) break; // the open sea plane runs under the quay
        for (let i = 0; i < SUB; i++) {
          const ax = x0 + (i / SUB) * S;
          const bx = x0 + ((i + 1) / SUB) * S;
          const az = z0 + (j / SUB) * S;
          const bz = z0 + ((j + 1) / SUB) * S;
          g.quad(key, new THREE.Vector3(ax, fy, bz), new THREE.Vector3(bx, fy, bz), new THREE.Vector3(bx, fy, az), new THREE.Vector3(ax, fy, az), null, { ao: aoF });
        }
      }
      if (cell === CELL.WATER) {
        // stone kerb around water
        for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
          if (map.getCell(x + dx, y + dy) === CELL.WATER) continue;
          const cxw = x0 + S / 2 + dx * (S / 2 - 0.15);
          const czw = z0 + S / 2 + dy * (S / 2 - 0.15);
          g.box('arch_trim', { c: [cxw, -0.2, czw], s: dx ? [0.3, 0.5, S] : [S, 0.5, 0.3], chamfer: 0.04 });
        }
      } else spots.floorCells.push({ x, y, cell, covered: cov });
      // ceiling
      const ceilKey = indoor ? ts.ceiling : cov ? 'arch_ceiling' : null;
      if (ceilKey) {
        const ch = indoor ? ceilH : ceilH;
        g.quad(ceilKey, new THREE.Vector3(x0, ch, z0), new THREE.Vector3(x0 + S, ch, z0), new THREE.Vector3(x0 + S, ch, z0 + S), new THREE.Vector3(x0, ch, z0 + S), null, { ao: 0.8 });
        if (ts.id === 'dungeon') {
          // stone ribs across open cell boundaries (N and W) → rhythmic vaulting
          for (const [d, horiz] of [['N', true], ['W', false]]) {
            if (map.getEdge(x, y, d) !== EDGE.OPEN) continue;
            if (horiz) g.box('arch_dungeon', { c: [x0 + S / 2, ch - 0.22, z0], s: [S + T, 0.44, 0.5], chamfer: 0.06, ao: 0.75 });
            else g.box('arch_dungeon', { c: [x0, ch - 0.22, z0 + S / 2], s: [0.5, 0.44, S + T], chamfer: 0.06, ao: 0.75 });
          }
          g.box('arch_dungeon', { c: [x0 + S / 2, ch - 0.12, z0 + S / 2], s: [0.28, 0.24, S], chamfer: 0.04, ao: 0.7 });
          g.box('arch_dungeon', { c: [x0 + S / 2, ch - 0.12, z0 + S / 2], s: [S, 0.24, 0.28], chamfer: 0.04, ao: 0.7 });
        } else {
          // timber beam across the cell + joists
          const alongX = hash(map.id, x, y, 'bm') < 0 || (y % 2 === 0) || true;
          if (alongX) {
            g.box('arch_beam_dark', { c: [x0 + S / 2, ch - 0.14, z0 + S / 2], s: [S + T, 0.28, 0.26], chamfer: 0.02, uv: 'along', ao: 0.7, skip: ['py'] });
            for (let k = 0; k < 4; k++) g.box('arch_beam_dark', { c: [x0 + 0.375 + k * 0.75, ch - 0.06, z0 + S / 2], s: [0.11, 0.12, S], uv: 'along', ao: 0.65, skip: ['py'] });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ inscriptions
  // A 'sign' event whose text quotes an inscription gets a carved plaque over
  // the adjacent arch/door of that cell.
  for (const ev of map.events ?? []) {
    if (ev.type !== 'sign' || !ev.text) continue;
    const m = /["“]([^"”]{2,40})["”]/.exec(ev.text);
    if (!m) continue;
    for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
      const type = map.getEdge(ev.x, ev.y, d);
      if (type !== EDGE.ARCH && type !== EDGE.DOOR) continue;
      // face on the sign's side: basis with N pointing into (ev.x, ev.y)
      const N = new THREE.Vector3(-dx, 0, -dy);
      const M = new THREE.Vector3((ev.x + 0.5 + dx * 0.5) * S, 0, (ev.y + 0.5 + dy * 0.5) * S);
      const Tn = new THREE.Vector3().crossVectors(UP, N);
      const basis = new THREE.Matrix4().makeBasis(Tn, UP, N).setPosition(M);
      const top = type === EDGE.ARCH ? ARCH_SPRING + ARCH_W / 2 + 0.55 : DOOR_H + 0.42;
      const f = { basis };
      localBox(f, 'arch_trim', -1.05, 1.05, top - 0.06, top + 0.52, T / 2 - 0.02, T / 2 + 0.07, { chamfer: 0.03 });
      const ruinPlaque = ts.id === 'ruins';
      const mat = new THREE.MeshStandardMaterial({ map: getInscriptionTexture(m[1].toUpperCase(), { weathered: ruinPlaque }), roughness: 0.92, alphaTest: 0.5 });
      const geo = new THREE.PlaneGeometry(1.9, 0.46);
      const plane = new THREE.Mesh(geo, mat);
      // in a ruin the slab has slipped in its frame
      const tilt = ruinPlaque ? new THREE.Matrix4().makeRotationZ(-0.05) : new THREE.Matrix4();
      plane.applyMatrix4(new THREE.Matrix4().multiplyMatrices(basis, new THREE.Matrix4().makeTranslation(0, top + 0.23 - (ruinPlaque ? 0.03 : 0), T / 2 + 0.075).multiply(tilt)));
      plane.receiveShadow = true;
      plane.userData.ownMaterial = true;
      group.add(plane);
    }
  }

  // ------------------------------------------------------------ roofs
  if (ts.roofs) for (const c of comps) buildRoofs(c);

  function buildRoofs(c) {
    const set = new Set(c.cells.map(([x, y]) => `${x},${y}`));
    const used = new Set();
    // greedy rectangle decomposition
    const cells = [...c.cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [x, y] of cells) {
      if (used.has(`${x},${y}`)) continue;
      let w = 1;
      while (set.has(`${x + w},${y}`) && !used.has(`${x + w},${y}`)) w++;
      let h = 1;
      outer: for (;;) {
        for (let i = 0; i < w; i++) if (!set.has(`${x + i},${y + h}`) || used.has(`${x + i},${y + h}`)) break outer;
        h++;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used.add(`${x + i},${y + j}`);
      if (c.ruined) ruinedRafters(c, x, y, w, h);
      else gableRoof(c, x, y, w, h);
    }
  }

  function gableRoof(c, x, y, w, h) {
    const X0 = x * S;
    const X1 = (x + w) * S;
    const Z0 = y * S;
    const Z1 = (y + h) * S;
    const alongX = c.temple && c.frontAxis ? c.frontAxis === 'z' ? false : true : X1 - X0 >= Z1 - Z0;
    const timber = c.style === 1;
    const off = timber ? JETTY : 0;
    const He = c.H;
    const spanB = (alongX ? Z1 - Z0 : X1 - X0) / 2 + T / 2 + off;
    const spanA = (alongX ? X1 - X0 : Z1 - Z0) / 2 + T / 2;
    const pitch = THREE.MathUtils.degToRad(c.temple ? 21 : 40 + hash(c.id, 'p') * 10);
    const oh = 0.5;
    const rise = spanB * Math.tan(pitch);
    const cx = (X0 + X1) / 2;
    const cz = (Z0 + Z1) / 2;
    // local roof frame: A along ridge, B across, y up
    const A = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const B = alongX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0);
    const P = (a, yy, b) => new THREE.Vector3(cx, yy, cz).addScaledVector(A, a).addScaledVector(B, b);
    const L = spanA + off + 0.35;
    const rk = c.roofKind;
    const tsR = 2;
    const th = 0.16;
    const slopeLen = Math.hypot(spanB + oh, rise + oh * Math.tan(pitch));
    for (const sb of [-1, 1]) {
      const eaveB = sb * (spanB + oh);
      const eaveY = He - oh * Math.tan(pitch);
      const r0 = P(-L, He + rise, 0);
      const r1 = P(L, He + rise, 0);
      const e0 = P(-L, eaveY, eaveB);
      const e1 = P(L, eaveY, eaveB);
      // top surface (normal outward/up)
      const nrm = new THREE.Vector3().subVectors(e0, r0).cross(new THREE.Vector3().subVectors(r1, r0));
      const up = nrm.y < 0;
      const uvs = [[-L / tsR, 0], [L / tsR, 0], [L / tsR, slopeLen / tsR], [-L / tsR, slopeLen / tsR]];
      const lift = new THREE.Vector3(0, th, 0);
      const t0 = r0.clone().add(lift);
      const t1 = r1.clone().add(lift);
      const t2 = e1.clone().add(lift);
      const t3 = e0.clone().add(lift);
      const aoRoof = (p) => 0.8 + 0.2 * THREE.MathUtils.clamp((p.y - eaveY) / 1.5, 0, 1);
      if (up) g.quad(rk, t0, t1, t2, t3, uvs, { ao: aoRoof });
      else g.quad(rk, t0, t3, t2, t1, [uvs[0], uvs[3], uvs[2], uvs[1]], { ao: aoRoof });
      // underside (soffit)
      if (up) g.quad('arch_beam_dark', r0, e0, e1, r1, null, { ao: 0.5 });
      else g.quad('arch_beam_dark', r0, r1, e1, e0, null, { ao: 0.5 });
      // fascia at eave
      const f0 = e0.clone();
      const f1 = e1.clone();
      const f2 = e1.clone().add(lift);
      const f3 = e0.clone().add(lift);
      if (sb > 0) g.quad('arch_beam_dark', f0, f1, f2, f3, null, { ao: 0.7 });
      else g.quad('arch_beam_dark', f1, f0, f3, f2, null, { ao: 0.7 });
      // barge boards along the gable edges
      for (const sa of [-1, 1]) {
        const a0 = P(sa * (L + 0.02), He + rise + th / 2, 0);
        const a1 = P(sa * (L + 0.02), eaveY + th / 2, eaveB);
        alongBox('arch_beam_dark', a0, a1, A, [0.08, 0.3], { uv: 'along', ao: 0.8 });
      }
      // rafter tails under the eave
      for (let a = -spanA + 0.2; a < spanA; a += 0.6) {
        const p0 = P(a, He - 0.05, sb * (spanB - 0.1));
        const p1 = P(a, eaveY + 0.02, sb * (spanB + oh - 0.05));
        alongBox('arch_beam_dark', p0, p1, A, [0.09, 0.12], { uv: 'along', ao: 0.55 });
      }
    }
    // ridge cap
    {
      const m = new THREE.Matrix4().compose(P(0, He + rise + th + 0.05, 0), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), A), new THREE.Vector3(1, 1, 1));
      g.box(rk === 'arch_roof_clay' ? 'arch_roof_clay' : 'arch_trim', { matrix: m, s: [2 * L + 0.05, 0.16, 0.34], chamfer: 0.05, ao: 0.9 });
    }
    // gable walls
    const gKey = timber ? 'arch_plaster' : c.style === 2 ? 'arch_ruin' : 'arch_stone';
    for (const sa of [-1, 1]) {
      const aa = sa * (spanA + off);
      const q0 = P(aa, He, -spanB);
      const q1 = P(aa, He, spanB);
      const q2 = P(aa, He + rise, 0);
      const n = new THREE.Vector3().subVectors(q1, q0).cross(new THREE.Vector3().subVectors(q2, q0));
      const outward = A.clone().multiplyScalar(sa);
      const tri = n.dot(outward) > 0 ? [q0, q1, q2] : [q0, q2, q1];
      g.tri(gKey, tri, null, { ao: 0.95, tint: timber ? c.tint : undefined, uvOff: [hash(c.id, sa, x, y, 'gu') * 9.1, hash(c.id, sa, 'gv') * 3.3] });
      // back side (attic) to avoid see-through from odd angles
      const back = tri.map((p) => p.clone().addScaledVector(outward, -0.15));
      g.tri(gKey, [back[0], back[2], back[1]], null, { ao: 0.4 });
      if (timber) {
        const d = 0.04;
        const Pd = (b, yy) => P(aa + sa * d, yy, b);
        const beamW = (p0, p1, wdt) => {
          const mid = p0.clone().add(p1).multiplyScalar(0.5);
          const dir = p1.clone().sub(p0);
          const len = dir.length();
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          const mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
          g.box('arch_beam', { matrix: mm, s: [wdt, len, wdt], chamfer: 0.015, uv: 'along', ao: 0.9 });
        };
        beamW(Pd(-spanB, He + 0.1), Pd(spanB, He + 0.1), 0.18);
        beamW(Pd(0, He + 0.1), Pd(0, He + rise - 0.1), 0.16);
        beamW(Pd(-spanB * 0.5, He + rise * 0.5), Pd(spanB * 0.5, He + rise * 0.5), 0.14);
        beamW(Pd(-spanB * 0.5, He + 0.2), Pd(0, He + rise * 0.5), 0.13);
        beamW(Pd(spanB * 0.5, He + 0.2), Pd(0, He + rise * 0.5), 0.13);
      } else if (c.temple) {
        // classical pediment: raking + horizontal cornices, acroteria and an oculus
        const out = (k) => outward.clone().multiplyScalar(k);
        const apex = P(aa, He + rise, 0);
        for (const sb of [-1, 1]) {
          const e0 = P(aa, He + 0.12, sb * (spanB + 0.25)).add(out(0.14));
          const a1 = apex.clone().add(new THREE.Vector3(0, 0.12, 0)).add(out(0.14));
          alongBox('arch_trim', e0, a1, outward, [0.42, 0.32], { chamfer: 0.04, ao: 0.95 });
          const cb = P(aa, He + 0.2, sb * (spanB + 0.2)).add(out(0.2));
          const mm = new THREE.Matrix4().compose(cb, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward), new THREE.Vector3(1, 1, 1));
          g.box('arch_trim', { matrix: mm, s: [0.5, 0.42, 0.5], chamfer: 0.05, ao: 0.9 }); // corner acroterion plinth
        }
        {
          const mid = P(aa, He - 0.05, 0).add(out(0.16));
          const mm = new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward), new THREE.Vector3(1, 1, 1));
          g.box('arch_trim', { matrix: mm, s: [2 * spanB + 0.6, 0.34, 0.42], chamfer: 0.04, ao: 0.9 });
          g.box('arch_trim', { matrix: mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.27, -0.06)), s: [2 * spanB + 0.3, 0.2, 0.3], chamfer: 0.03, ao: 0.8 });
          const ap = apex.clone().add(new THREE.Vector3(0, 0.38, 0)).add(out(0.14));
          const am = new THREE.Matrix4().compose(ap, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward), new THREE.Vector3(1, 1, 1));
          g.box('arch_trim', { matrix: am, s: [0.46, 0.5, 0.4], chamfer: 0.06, ao: 0.95 });
          // oculus
          const oc = P(aa, He + rise * 0.4, 0).add(out(0.04));
          const om = new THREE.Matrix4().compose(oc, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward), new THREE.Vector3(1, 1, 1));
          const ring = new THREE.TorusGeometry(0.36, 0.08, 6, 18);
          g.geometry('arch_trim', ring, om, { uv: 'world', ao: 0.9 });
          ring.dispose();
          const disc = new THREE.CircleGeometry(0.33, 18);
          g.geometry('arch_iron', disc, om.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.03)), { uv: 'world', ao: 0.35 });
          disc.dispose();
          for (let k = 0; k < 4; k++) g.box('arch_iron', { matrix: om.clone().multiply(new THREE.Matrix4().makeRotationZ((k * Math.PI) / 4)), s: [0.66, 0.025, 0.03], ao: 0.6 });
        }
      } else {
        // small louvred vent in stone gables
        if (rise > 2.2) {
          const vc = P(aa + sa * 0.02, He + rise * 0.45, 0);
          const mm = new THREE.Matrix4().compose(vc, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward), new THREE.Vector3(1, 1, 1));
          g.box('arch_beam_dark', { matrix: mm, s: [0.5, 0.7, 0.06], ao: 0.4 });
          g.box('arch_trim', { matrix: mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.4, 0.02)), s: [0.7, 0.1, 0.12], chamfer: 0.02 });
        }
      }
    }
    // chimney
    if (hash(c.id, x, y, 'chim') < 0.7) {
      const ca = (hash(c.id, 'ca') < 0.5 ? -1 : 1) * Math.max(0, spanA - 1.1);
      const cb = (hash(c.id, 'cb') < 0.5 ? -1 : 1) * spanB * 0.35;
      const roofY = He + rise * (1 - Math.abs(cb) / spanB);
      const top = He + rise + 1.1;
      const base = P(ca, (roofY - 0.4 + top) / 2, cb);
      const mm = new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), A), new THREE.Vector3(1, 1, 1));
      const ck = hash(c.id, 'ck') < 0.5 ? 'arch_brick' : 'arch_stone';
      g.box(ck, { matrix: mm, s: [0.8, top - roofY + 0.4, 0.8], ao: 0.9 });
      const capM = new THREE.Matrix4().compose(P(ca, top + 0.05, cb), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      g.box('arch_trim', { matrix: capM, s: [0.98, 0.12, 0.98], chamfer: 0.03, ao: 0.9 });
      const pot = new THREE.CylinderGeometry(0.1, 0.13, 0.4, 10);
      for (const o of [-0.18, 0.18]) g.geometry('arch_brick', pot, new THREE.Matrix4().makeTranslation(P(ca, top + 0.31, cb).addScaledVector(A, o)), { uv: 'world', ao: 0.9 });
      pot.dispose();
      chimneys.push(P(ca, top + 0.55, cb));
    }
  }

  function ruinedRafters(c, x, y, w, h) {
    const X0 = x * S;
    const X1 = (x + w) * S;
    const Z0 = y * S;
    const Z1 = (y + h) * S;
    const alongX = X1 - X0 < Z1 - Z0;
    const n = Math.max(1, Math.floor((alongX ? Z1 - Z0 : X1 - X0) / 2.2));
    for (let k = 0; k < n; k++) {
      if (hash(c.id, k, 'rf') < 0.45) continue;
      const t = (k + 0.5) / n;
      const yy = c.H * 0.62 - 0.2;
      const broken = hash(c.id, k, 'br') < 0.5;
      const len = (alongX ? X1 - X0 : Z1 - Z0) * (broken ? 0.55 : 1) + T;
      if (alongX) g.box('arch_beam_dark', { c: [X0 + len / 2 - T / 2, yy, Z0 + t * (Z1 - Z0)], s: [len, 0.22, 0.2], chamfer: 0.02, uv: 'along', rotZ: broken ? -0.25 : 0 });
      else g.box('arch_beam_dark', { c: [X0 + t * (X1 - X0), yy, Z0 + len / 2 - T / 2], s: [0.2, 0.22, len], chamfer: 0.02, uv: 'along', rotX: broken ? 0.25 : 0 });
    }
  }

  // ------------------------------------------------------------ assemble
  const meshes = [];
  for (const [key, geo] of g.build()) {
    const mesh = new THREE.Mesh(geo, getMaterial(key));
    mesh.name = key;
    mesh.receiveShadow = true;
    mesh.castShadow = !(key === 'arch_cobble' || key === 'arch_flags' || key === 'arch_mud' || key === 'arch_boards' || key === 'arch_dungeon_floor' || key === 'arch_water');
    // near-to-far draw order (three sorts opaque by material before depth): walls, then floors
    mesh.renderOrder = mesh.castShadow ? 1 : 2;
    group.add(mesh);
    meshes.push(mesh);
  }
  for (const [key, geo] of panes.build()) {
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, getWindowMaterial(key === 'win_ext' ? 'ext' : 'int'));
    mesh.name = key;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  // coarse occluder height field (for sun-shaft placement): walls, roofed buildings, and the
  // surrounding city beyond the block edge
  const HR = 4; // samples per metre
  const hfW = W * S * HR;
  const hfH = Hh * S * HR;
  const hf = new Float32Array(hfW * hfH);
  if (!indoor) {
    for (const c of comps) {
      if (c.ruined) continue;
      for (const [cx, cy] of c.cells) {
        for (let j = 0; j < S * HR; j++) for (let i = 0; i < S * HR; i++) hf[(cy * S * HR + j) * hfW + cx * S * HR + i] = c.H + 1.5;
      }
    }
    for (const e of allEdges) {
      const x0 = e.hv === 'H' ? e.i * S : e.i * S - T / 2;
      const x1 = e.hv === 'H' ? (e.i + 1) * S : e.i * S + T / 2;
      const z0 = e.hv === 'H' ? e.j * S - T / 2 : e.j * S;
      const z1 = e.hv === 'H' ? e.j * S + T / 2 : (e.j + 1) * S;
      const hgt = e.type === EDGE.ARCH || e.type === EDGE.DOOR ? e.H * 0.9 : e.H * (f0(e) ? 0.75 : 1);
      for (let z = Math.max(0, Math.floor(z0 * HR)); z < Math.min(hfH, Math.ceil(z1 * HR)); z++) {
        for (let x = Math.max(0, Math.floor(x0 * HR)); x < Math.min(hfW, Math.ceil(x1 * HR)); x++) hf[z * hfW + x] = Math.max(hf[z * hfW + x], hgt);
      }
    }
  }
  function f0(e) {
    return ts.walls[e.style] === 'ruin';
  }
  /** Occluder height at world (x, z); beyond the block the city stands ~6 m tall. */
  const heightAt = (x, z) => {
    const ix = Math.floor(x * HR);
    const iz = Math.floor(z * HR);
    if (ix < 0 || iz < 0 || ix >= hfW || iz >= hfH) return map.harbour && z > Hh * S - 1 ? 0 : 6.5;
    return hf[iz * hfW + ix];
  };
  return { group, doors, torches, windows, chimneys, spots, tileset: ts, meshes, comps, compAt, covered, heightAt };
}

export function disposeBlock(block) {
  block.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (o.userData.ownMaterial) o.material.dispose();
    }
  });
  block.group.removeFromParent();
}
