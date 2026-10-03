import * as THREE from 'three';
import { EDGE, CELL } from '../../data/maps/MapGrid.js';
import { getMaterial, getWindowMaterial } from '../../render/materials.js';
import { getInscriptionTexture, getEmberTexture, getSootTexture, getScorchTexture, getBlobTexture, getRunoffTexture, getPlinthGrimeTexture, getRutTexture, getInscriptionNormal } from '../../render/textures/index.js';
import { GeoBuilder, hash, defaultAO, roughBlockGeometry, roughen } from './GeoBuilder.js';
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
/** Rise of the Temple of Bane's groin vaults (they spring this far below the ceiling). */
const BANE_VAULT_RISE = 1.25;

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
  const spots = { wallBase: [], lamp: [], banner: [], floorCells: [], cobweb: [], ivy: [], cave: [], bane: [] };
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
        let frontDir = null;
        for (const [cx, cy] of cells) {
          for (const d of ['N', 'S', 'E', 'W']) {
            const t = map.getEdge(cx, cy, d);
            if (t === EDGE.ARCH || t === EDGE.DOOR || t === EDGE.LOCKED) {
              frontAxis = d === 'N' || d === 'S' ? 'z' : 'x';
              frontDir = d;
            }
          }
        }
        // a named ruin that still stands: gutted — the back of the roof has fallen in, the facade is scorched
        const partRuin = !ruined && /ruin/i.test(zone);
        if (style === 1 && H < 5) H = 5.4;
        comps.push({ id, cells, style, ruined, partRuin, H, temple, frontAxis, frontDir, roofKind: ['arch_roof_slate', 'arch_roof_clay', 'arch_roof_shake'][Math.floor(hash(map.id, id, 'roof') * 3)], tint: PLASTER_TINTS[Math.floor(hash(map.id, id, 'tint') * PLASTER_TINTS.length)] });
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

  /** A land cell standing out into the harbour (water on two or more sides): built as a timber pier. */
  const waterAt = (x, y) => (map.inBounds(x, y) ? map.getCell(x, y) === CELL.WATER : !!map.harbour && y >= Hh);
  const isPier = (x, y) => {
    if (indoor || !map.harbour || !map.inBounds(x, y) || map.getCell(x, y) === CELL.WATER) return false;
    let n = 0;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (waterAt(x + dx, y + dy)) n++;
    return n >= 2;
  };
  /** Round timber pile from below the water up to `top` (a mooring post when it stands proud of the deck). */
  function pile(x, z, top, r = 0.13, seed = 0) {
    const geo = new THREE.CylinderGeometry(r * 0.92, r, top + 2.4, 9, 1);
    g.geometry('prop_wood', geo, new THREE.Matrix4().makeTranslation(x, (top - 2.4) / 2, z).multiply(new THREE.Matrix4().makeRotationZ((hash(seed, 'pl') - 0.5) * 0.05)), { uv: 'world', tint: [0.62, 0.55, 0.48], ao: (p) => (p.y < -0.3 ? 0.35 : 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, -0.3, 0.6)) });
    geo.dispose();
    if (top > 0.3) {
      // a squared-off oak post top: chamfered, end grain dark and checked, an iron band below it
      const cap = new THREE.CylinderGeometry(r * 0.8, r * 0.92, 0.05, 9);
      g.geometry('prop_wood', cap, new THREE.Matrix4().makeTranslation(x, top + 0.02, z), { uv: 'world', tint: [0.36, 0.32, 0.28] });
      cap.dispose();
      const band = new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.05, 9, 1, true);
      g.geometry('prop_iron', band, new THREE.Matrix4().makeTranslation(x, top - 0.08, z), { uv: 'world', tint: [0.8, 0.7, 0.62] });
      band.dispose();
      for (let k = 0; k < 3; k++) {
        const t = new THREE.TorusGeometry(r + 0.02, 0.018, 5, 14);
        t.rotateX(Math.PI / 2);
        g.geometry('prop_burlap', t, new THREE.Matrix4().makeTranslation(x, top - 0.18 - k * 0.04, z), { uv: 'world', tint: [0.75, 0.66, 0.5] });
        t.dispose();
      }
    }
    // weed and wet darkening at the waterline
    const ring = new THREE.CylinderGeometry(r * 1.04, r * 1.06, 0.35, 9, 1, true);
    g.geometry('prop_wood', ring, new THREE.Matrix4().makeTranslation(x, -0.35, z), { uv: 'world', tint: [0.2, 0.24, 0.16], ao: 0.6 });
    ring.dispose();
  }

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
    const stoneDoor = ['stone', 'dungeon', 'int_stone', 'dungeon_brick', 'cave', 'ruin', 'hewn', 'basalt'].includes(ts.walls[e.style]);
    // a stone doorway is cut up to its arch crown (the tympanum and voussoirs fill the head)
    if (isDoor) openings.push({ s0: -DOOR_W / 2, s1: DOOR_W / 2, y0: 0, y1: DOOR_H + (stoneDoor ? 0.22 : 0), kind: 'door' });
    if (isArch) openings.push({ s0: -ARCH_W / 2, s1: ARCH_W / 2, y0: 0, y1: ARCH_SPRING + ARCH_W / 2, kind: 'arch' });
    const inA = map.inBounds(sides[0].cx, sides[0].cy);
    const inB = map.inBounds(sides[1].cx, sides[1].cy);
    const seen = (sd) => map.inBounds(sd.cx, sd.cy) && !(solidCell(sd.cx, sd.cy) && (indoor || covered(sd.cx, sd.cy)));
    if (!seen(sides[0]) && !seen(sides[1])) return;
    // walls against open water are quay parapets (a pier's sides), or nothing at all out at sea
    {
      // beyond the southern edge of a waterfront block is the open sea
      const isW = (sd) => (map.inBounds(sd.cx, sd.cy) ? map.getCell(sd.cx, sd.cy) === CELL.WATER : !!map.harbour && sd.cy >= Hh);
      const wa = isW(sides[0]);
      const wb = isW(sides[1]);
      if (!indoor && (wa || wb) && !isDoor && !isArch) {
        const landA = inA && !wa;
        const landB = inB && !wb;
        void 0;
        if (!landA && !landB) return;
        const sd = landA ? sides[0] : sides[1];
        const Tn = new THREE.Vector3().crossVectors(UP, sd.N);
        const pf = { basis: new THREE.Matrix4().makeBasis(Tn, UP, sd.N).setPosition(M) };
        if (isPier(sd.cx, sd.cy)) {
          // timber pier edge: a fascia over the piles, piles every 1.5 m (proud as mooring posts at the
          // corners), and a low kerb log along the deck edge with gaps where the lines run out
          localBox(pf, 'prop_wood', -S / 2, S / 2, -0.32, -0.02, T / 2 - 0.02, T / 2 + 0.08, { uv: 'along', tint: [0.55, 0.48, 0.42] });
          for (let k = 0; k < 3; k++) {
            const sv = -S / 2 + 0.15 + k * ((S - 0.3) / 2);
            const corner = k !== 1 && hash(e.key, k, 'mp') < 0.75;
            const pp = new THREE.Vector3(sv, 0, T / 2 - 0.1).applyMatrix4(pf.basis);
            pile(pp.x, pp.z, corner ? 0.55 + hash(e.key, k, 'mh') * 0.25 : -0.04, corner ? 0.16 : 0.12, seedE + k);
          }
          let a = -S / 2 + 0.35;
          for (let k = 0; a < S / 2 - 0.4; k++) {
            const l = Math.min(S / 2 - 0.35 - a, 0.7 + hash(e.key, k, 'kl') * 0.6);
            localBox(pf, 'prop_wood', a, a + l, 0.0, 0.13, T / 2 - 0.2, T / 2 - 0.04, { uv: 'along', chamfer: 0.02, tint: [0.66, 0.58, 0.5] });
            a += l + 0.25;
          }
          spots.wallBase.push({ face: { ...pf, N: sd.N, T: Tn, M, e, H: 0.3, openings: [], ends: {}, seed: seedE, cell: { x: sd.cx, y: sd.cy, type: map.getCell(sd.cx, sd.cy) }, quay: true, pier: true }, cell: { x: sd.cx, y: sd.cy, type: map.getCell(sd.cx, sd.cy) }, style: e.style, recipe: 'quay' });
          return;
        }
        // battered face into the water, then a dwarf wall with a moulded coping
        localBox(pf, 'arch_stone_cold', -S / 2 - T / 2, S / 2 + T / 2, -1.6, 0.0, -T / 2 - 0.2, T / 2, { tint: [0.72, 0.74, 0.7] });
        localBox(pf, 'arch_stone', -S / 2 - T / 2, S / 2 + T / 2, 0.0, 0.62, -T / 2 + 0.06, T / 2);
        let a = -S / 2 - T / 2;
        for (let k = 0; a < S / 2 + T / 2 - 0.02; k++) {
          const l = Math.min(S / 2 + T / 2 - a, 0.7 + hash(e.key, k, 'pc') * 0.5);
          localBox(pf, 'arch_dressed', a + 0.01, a + l - 0.01, 0.62, 0.8, -T / 2 + 0.01, T / 2 + 0.07, { chamfer: 0.03, tint: [0.85 + hash(e.key, k, 'pt') * 0.12, 0.84, 0.8] });
          a += l;
        }
        spots.wallBase.push({ face: { ...pf, N: sd.N, T: Tn, M, e, H: 0.8, openings: [], ends: {}, seed: seedE, cell: { x: sd.cx, y: sd.cy, type: map.getCell(sd.cx, sd.cy) }, quay: true }, cell: { x: sd.cx, y: sd.cy, type: map.getCell(sd.cx, sd.cy) }, style: e.style, recipe: 'quay' });
        return;
      }
    }
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
    if (indoor && ts.id === 'interior' && (!inA || !inB) && !isDoor && !hearthEdge && seedE < 0.55) openings.push({ s0: -0.46, s1: 0.46, y0: 1.05, y1: 2.2, kind: 'window', ground: true, border: true }); // same size as street windows: one lattice scale
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
        gut: !interiorFace && !!c?.partRuin,
        ends: {},
        seed: hash(e.key, si, map.id),
      };
      // per-face texture offset: no two walls show the same stones / plaster blemishes
      // (keyed by the wall's line + facing so a straight run stays continuous — no seams between cells)
      const lineKey = horizontal ? `h${e.j}:${sd.N.z}` : `v${e.i}:${sd.N.x}`;
      face.uvOff = [Math.floor(hash(map.id, lineKey, 'uo') * 97) / 7.3, Math.floor(hash(map.id, lineKey, 'vo') * 13) / 3.7];
      // corner classification at both ends
      for (const end of [-1, 1]) face.ends[end] = classifyEnd(e, sd.N, Tn, end, horizontal);
      RECIPES[recipe]?.(face);
      if (face.gut || (!interiorFace && (recipe === 'ruin' || recipe === 'ruin_timber') && hash(face.seed, 'fire') < (recipe === 'ruin_timber' ? 0.75 : 0.45))) scorch(face);
      if (hearthEdge && interiorFace) {
        const wallDir = sd.N.x > 0.5 ? 'W' : sd.N.x < -0.5 ? 'E' : sd.N.z > 0.5 ? 'N' : 'S';
        if (hearths.some((h) => h.x === sd.cx && h.y === sd.cy && h.dir === wallDir)) buildHearth(face);
      }
      if (!isDoor && !isArch && ts.outdoors && (!interiorFace || hearthEdge || !face.openings.some((o) => o.border))) {
        // outside: street clutter; inside a roofed house on a city block: furniture
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
      if (!inA || !inB) {
        // the town wall: merlons along the wall-walk (a broken skyline against the sky; a few have
        // fallen) and a battered buttress on every other bay of the town-side face
        const inSign = inA ? 1 : -1; // basis +N side is fA's side; town side is the in-bounds one
        for (let k = 0; k < 3; k++) {
          if (hash(e.key, k, 'mer') < 0.18) continue;
          const sc = -S / 2 + 0.5 + k * 1.0 + (hash(e.key, k, 'mo') - 0.5) * 0.1;
          const mh = 0.55 + (hash(e.key, k, 'mh') - 0.5) * 0.12;
          const mg = roughBlockGeometry(0.62, mh, T + 0.06, { bevel: 0.03, amp: 0.012, seed: hash(e.key, k, 'ms') * 100, chip: 0.05 });
          g.geometry('arch_trim', mg, localMatrix(ef, sc, hc + 0.16 + mh / 2, 0, (hash(e.key, k, 'mr') - 0.5) * 0.03), { uv: 'world', ao: 0.9 });
          mg.dispose();
        }
        if ((e.i + e.j) % 2 === 0 && e.H > 2.5) {
          const fd = (fA === 0 ? 1 : -1) * inSign;
          const d0 = fd > 0 ? T / 2 : -T / 2 - 0.55;
          const d1 = fd > 0 ? T / 2 + 0.55 : -T / 2;
          localBox(ef, 'arch_stone', -0.32, 0.32, 0, e.H * 0.55, Math.min(d0, d1), Math.max(d0, d1), { chamfer: 0.04 });
          const t0 = fd > 0 ? T / 2 : -T / 2 - 0.3;
          const t1 = fd > 0 ? T / 2 + 0.3 : -T / 2;
          localBox(ef, 'arch_stone', -0.3, 0.3, e.H * 0.55, e.H * 0.85, Math.min(t0, t1), Math.max(t0, t1), { chamfer: 0.04 });
          localBox(ef, 'arch_trim', -0.36, 0.36, e.H * 0.55 - 0.08, e.H * 0.55 + 0.04, Math.min(d0, d1) - 0.02, Math.max(d0, d1) + 0.02, { chamfer: 0.03 });
        }
      }
    }
    // ruin tops: capstones scattered
  }

  /** Fire-blackening licking up from the openings of a gutted building, plus a few smoke stains. */
  function scorch(f) {
    const d = T / 2 + 0.02;
    const P = (sv, y) => new THREE.Vector3(sv, y, d).applyMatrix4(f.basis);
    for (const op of f.openings) {
      const w = (op.s1 - op.s0) * 1.9;
      const cx = (op.s0 + op.s1) / 2;
      const y0 = op.y1 - 0.08;
      const y1 = Math.min(f.H, op.y1 + 1.6 + hash(f.seed, op.s0, 'sh') * 0.8);
      sootQuads.push([P(cx - w / 2, y0), P(cx + w / 2, y0), P(cx + w / 2, y1), P(cx - w / 2, y1)]);
    }
    // free-floating smoke stains read as random blobs mid-wall: only plinth-level smoke now,
    // rising from the ground where debris burned against the wall
    for (let k = 0; k < 2; k++) {
      if (hash(f.seed, k, 'sp') > 0.35) continue;
      const cx = (hash(f.seed, k, 'sx') - 0.5) * 2.2;
      const y0 = -0.05;
      const w = 0.9 + hash(f.seed, k, 'sw') * 0.8;
      if (f.openings.some((op) => op.s0 < cx + w / 2 && op.s1 > cx - w / 2 && op.y0 < y0 + w * 1.6 && op.y1 > y0)) continue;
      sootQuads.push([P(cx - w / 2, y0), P(cx + w / 2, y0), P(cx + w / 2, y0 + w * 1.6), P(cx - w / 2, y0 + w * 1.6)]);
    }
  }
  const sootQuads = [];
  const spillQuads = [];
  const torchSpill = [];
  // weathering decals: rain runoff under ledges, splash/damp at wall feet ([corners], [uvs])
  const runQuads = [];
  const plinthQuads = [];
  /** Runoff streaks hanging below a ledge at height y (face-local span s0..s1, depth d). */
  function runoffUnder(f, s0, s1, y, len, d) {
    if (indoor || f.interior || s1 - s0 < 0.1) return;
    const yb = Math.max(0.02, y - len);
    if (y - yb < 0.15) return;
    const P = (sv, yy) => new THREE.Vector3(sv, yy, d).applyMatrix4(f.basis);
    const uo = hash(f.seed, s0, y, 'ro') * 7;
    const vb = 1 - (y - yb) / 2.2; // texture spans 2.2 m vertically
    runQuads.push([[P(s0, yb), P(s1, yb), P(s1, y), P(s0, y)], [[uo + s0, vb], [uo + s1, vb], [uo + s1, 1], [uo + s0, 1]]]);
  }
  /** Splash + rising damp band at a wall foot (v: 0 at the ground .. 1 at 0.9 m). */
  function plinthBand(f, y0, y1, d, spans) {
    if (indoor || f.interior) return;
    const P = (sv, yy) => new THREE.Vector3(sv, yy, d).applyMatrix4(f.basis);
    const uo = hash(f.seed, 'pg') * 5;
    for (const [a, b] of spans) {
      if (b - a < 0.05) continue;
      plinthQuads.push([[P(a, y0), P(b, y0), P(b, y1), P(a, y1)], [[uo + a / 2, y0 / 0.9], [uo + b / 2, y0 / 0.9], [uo + b / 2, y1 / 0.9], [uo + a / 2, y1 / 0.9]]]);
    }
  }
  /** Wall-foot spans clear of doors/arches, extended to the face ends. */
  const footSpans = (f, ext = 0) => {
    const spans = [];
    let a = -S / 2 - ext;
    for (const op of [...f.openings].filter((o) => o.y0 < 0.3).sort((x, y) => x.s0 - y.s0)) {
      if (op.s0 > a) spans.push([a, op.s0]);
      a = Math.max(a, op.s1);
    }
    if (a < S / 2 + ext) spans.push([a, S / 2 + ext]);
    return spans;
  };

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
    // an irregular broken line: long raking slopes where courses slid away, short steep breaks,
    // the odd V-notch where a stone dropped out — never square, stepped notches
    const n = 8 + Math.floor(seed * 4);
    const course = 0.3 / Math.max(1, e.H);
    const xs = [];
    const hs = [];
    const step = [];
    let h = 0.55 + hash(e.key, 'j0') * 0.4;
    let slope = (hash(e.key, 'jsl') - 0.5) * 0.25;
    for (let k = 0; k <= n; k++) {
      xs.push(sa + ((sb - sa) * k) / n + (k > 0 && k < n ? (hash(e.key, 'jx', k) - 0.5) * ((sb - sa) / n) * 0.7 : 0));
      if (hash(e.key, 'jbrk', k) < 0.3) slope = (hash(e.key, 'jsl', k) - 0.5) * 0.45;
      h += slope + (hash(e.key, 'j', k) - 0.5) * 0.12;
      if (hash(e.key, 'jv', k) < 0.12) h -= 0.12; // a dropped stone
      if (h < 0.3 || h > 1) slope = -slope;
      h = THREE.MathUtils.clamp(h, 0.3, 1);
      hs.push(h);
      step.push(false);
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
    if (jag && key === 'arch_ruin' && !f.interior && ts.outdoors) talus(f, sa, sb, y0, y1, d1, ops);
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
  /**
   * Talus at a ruined wall's foot: where the break dips low, the fallen courses lie heaped
   * against the wall (rough blocks half-buried in a mound of rubble), on its own face side.
   */
  function talus(f, sa, sb, y0, y1, d1, ops) {
    const jag = f.jag;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const sv = THREE.MathUtils.lerp(sa + 0.25, sb - 0.25, (k + hash(f.seed, k, 'tsx')) / n);
      if (ops.some((op) => op.y0 < 0.5 && op.s0 - 0.35 < sv && op.s1 + 0.35 > sv)) continue;
      const lost = 1 - jag(sv); // how much of the wall fell here
      if (lost < 0.3 || hash(f.seed, k, 'tsk') > 0.35 + lost * 0.6) continue;
      const big = 0.5 + lost * 0.9;
      // mound
      const mg = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      roughen(mg, { amp: 0.18, seed: hash(f.seed, k, 'tm') * 100, freq: 2.5 });
      const mm = localMatrix(f, sv, -0.04, d1 + 0.18 * big);
      mm.multiply(new THREE.Matrix4().makeScale(0.55 * big, 0.26 * big, 0.42 * big));
      g.geometry('prop_rock', mg, mm, { uv: 'world', tint: [0.62, 0.58, 0.52], ao: (p, nn) => (nn.y > 0.4 ? 0.85 : 0.55) });
      mg.dispose();
      // fallen ashlar blocks, tumbled and half-buried
      const nb = 2 + Math.floor(hash(f.seed, k, 'tnb') * 3);
      for (let q = 0; q < nb; q++) {
        const bs = [0.3 + hash(f.seed, k, q, 'bx') * 0.3, 0.18 + hash(f.seed, k, q, 'by') * 0.1, 0.22 + hash(f.seed, k, q, 'bz') * 0.12];
        const bm = localMatrix(f, sv + (hash(f.seed, k, q, 'bo') - 0.5) * 0.9 * big, 0.04 + q * 0.07 * big, d1 + 0.1 + hash(f.seed, k, q, 'bd') * 0.5 * big, (hash(f.seed, k, q, 'brz') - 0.5) * 0.9);
        bm.multiply(new THREE.Matrix4().makeRotationY((hash(f.seed, k, q, 'bry') - 0.5) * 1.6)).multiply(new THREE.Matrix4().makeRotationX((hash(f.seed, k, q, 'brx') - 0.5) * 0.6));
        const bg = roughBlockGeometry(bs[0], bs[1], bs[2], { bevel: 0.025, amp: 0.012, seed: hash(f.seed, k, q, 'bs') * 100, chip: 0.05 });
        g.geometry('arch_ruin', bg, bm, { uv: 'world', ao: (p, nn) => (nn.y < -0.3 ? 0.35 : 0.8) });
        bg.dispose();
      }
    }
    void y0;
    void y1;
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
        // rain off the string course and cornice runs down the face in dark streaks
        for (const [a, b] of freeSpans(f, 2.9)) runoffUnder(f, a, b, 3.05, 0.9 + hash(f.seed, a, 'rl') * 0.7, T / 2 + 0.004);
        for (const [a, b] of freeSpans(f, H - 0.5)) runoffUnder(f, a, b, H - 0.28, 1.0 + hash(f.seed, b, 'rc') * 0.9, T / 2 + 0.004);
      }
      // splash and rising damp: on the plinth course, then fading up the wall above it
      plinthBand(f, 0, 0.42, T / 2 + 0.073, footSpans(f));
      plinthBand(f, 0.42, 0.9, T / 2 + 0.004, footSpans(f));
      quoins(f, 'arch_trim');
      if (f.temple) templeOrder(f);
    },
    timber(f) {
      const H = f.H;
      const lowTop = Math.min(H, 3.05);
      const d1 = T / 2;
      slab(f, 'arch_stone', 0, 0.55, 0, d1 + 0.05, { chamfer: 0.025 });
      slab(f, 'arch_plaster', 0.55, lowTop, 0, d1, { tint: f.tint });
      plinthBand(f, 0, 0.55, d1 + 0.054, footSpans(f));
      plinthBand(f, 0.55, 0.9, d1 + 0.004, footSpans(f));
      // drip off the jetty bressumer streaks the ground-floor daub
      if (H > 3.5) for (const [a, b] of freeSpans(f, lowTop - 0.4)) runoffUnder(f, a, b, lowTop - 0.15, 0.7 + hash(f.seed, a, 'rj') * 0.6, d1 + 0.004);
      frameBays(f, 0.55, lowTop, d1, 'arch_beam');
      if (H > 3.5) {
        const J = JETTY;
        // jetty: joist ends + bressumer + upper storey pushed out
        for (let s = -S / 2 + 0.2, k = 0; s < S / 2 - 0.1; s += 0.38 + hash(f.seed, k, 'js') * 0.12, k++) {
          // hand-hewn joist ends: uneven sizes, projections and the odd sag
          const jw = 0.055 + hash(f.seed, k, 'jw') * 0.025;
          const jy = (hash(f.seed, k, 'jy') - 0.5) * 0.03;
          localBox(f, 'arch_beam', s - jw, s + jw, lowTop - 0.15 + jy, lowTop + 0.02, d1 - 0.05, d1 + J + (hash(f.seed, k, 'jp') - 0.5) * 0.05, { uv: 'along', skip: ['nz'], chamfer: 0.01 });
        }
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
      // the daub has burnt and fallen away: what stands is the rubble-stone nogging behind it,
      // a full wall thick with a broken top, with a few scorched scraps of plaster still clinging
      slab(f, 'arch_ruin', 1.2, f.H, 0, T / 2, { jag: true, tint: [0.8, 0.76, 0.72] });
      const np = 1 + Math.floor(hash(f.seed, 'pp') * 2);
      for (let k = 0; k < np; k++) {
        const c = (hash(f.seed, k, 'pc') - 0.5) * (S - 1.2);
        const hw = 0.35 + hash(f.seed, k, 'pw') * 0.45;
        if (f.openings.some((o) => c + hw > o.s0 - 0.05 && c - hw < o.s1 + 0.05)) continue;
        const top = Math.min(f.H, 1.2 + (f.H - 1.2) * (f.jag ? f.jag(c) : 1)) - 0.35;
        if (top < 1.6) continue;
        localBox(f, 'arch_plaster', c - hw, c + hw, 1.25, Math.min(top, 1.3 + 0.6 + hash(f.seed, k, 'ph') * 0.8), T / 2, T / 2 + 0.025, { chamfer: 0.01, tint: [0.62, 0.56, 0.5] });
      }
      ruinFrame(f);
    },
    cave(f) {
      slab(f, 'arch_ruin', 0, f.H, 0, T / 2);
    },
    dungeon(f) {
      const H = f.H;
      // engaged piers hide every cell joint, so each bay may show its own part of the texture
      // (a per-line offset would repeat the same 3 m of masonry in every bay of a corridor)
      f.uvOff = [hash(f.seed, 'bu') * 7.3, hash(f.seed, 'bv') * 3.1];
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
    hewn(f) {
      // rough-hewn rock: the face itself is flat (normal-mapped); lumps, roots and refuse come from the dressing pass
      slab(f, 'arch_hewn', 0, f.H, 0, T / 2);
      spots.cave.push(f);
    },
    basalt(f) {
      const H = f.H;
      f.uvOff = [hash(f.seed, 'bu') * 7.3, hash(f.seed, 'bv') * 3.1];
      slab(f, 'arch_basalt', 0, H, 0, T / 2);
      slab(f, 'arch_basalt', 0, 0.42, T / 2, T / 2 + 0.09, { chamfer: 0.02, tint: [0.7, 0.66, 0.66] });
      // impost moulding at the vault's springing line (the groin vault rises from here)
      const SP = H - BANE_VAULT_RISE - 0.05;
      slab(f, 'arch_basalt', SP - 0.2, SP, T / 2, T / 2 + 0.16, { chamfer: 0.03, tint: [0.85, 0.8, 0.8] });
      slab(f, 'arch_basalt', SP - 0.26, SP - 0.2, T / 2, T / 2 + 0.1, { chamfer: 0.01, tint: [0.6, 0.55, 0.55] });
      for (const end of [-1, 1]) {
        if (f.ends[end] === 'inside' || f.ends[end] === 'free') continue;
        const s = end * (S / 2);
        localBox(f, 'arch_basalt', s - 0.28, s + 0.28, 0, SP - 0.28, T / 2, T / 2 + 0.15, { chamfer: 0.015, tint: [0.8, 0.78, 0.78] }); // a fine arris: a wide polished chamfer reads as a pale stripe
        localBox(f, 'arch_basalt', s - 0.36, s + 0.36, 0, 0.55, T / 2, T / 2 + 0.22, { chamfer: 0.04, tint: [0.7, 0.66, 0.66] });
        // capital carrying the ribs
        localBox(f, 'arch_basalt', s - 0.38, s + 0.38, SP - 0.28, SP + 0.02, T / 2, T / 2 + 0.24, { chamfer: 0.05, tint: [0.9, 0.85, 0.85] });
      }
      const free = !f.openings.length && f.ends[-1] !== 'free';
      if (free && hash(f.seed, 'relief') < 0.5) {
        // carved relief panel of the Black Hand, set in a moulded frame
        const d = T / 2 + 0.02;
        const P = (sv, y) => new THREE.Vector3(sv, y, d).applyMatrix4(f.basis);
        g.quad('arch_relief', P(-0.62, 1.15), P(0.62, 1.15), P(0.62, 2.39), P(-0.62, 2.39), [[0, 1], [1, 1], [1, 0], [0, 0]], { ao: 0.95 });
        localBox(f, 'arch_basalt', -0.74, 0.74, 1.03, 1.15, T / 2, T / 2 + 0.1, { chamfer: 0.02, tint: [0.9, 0.85, 0.85] });
        localBox(f, 'arch_basalt', -0.74, 0.74, 2.39, 2.51, T / 2, T / 2 + 0.1, { chamfer: 0.02, tint: [0.9, 0.85, 0.85] });
        localBox(f, 'arch_basalt', -0.74, -0.62, 1.15, 2.39, T / 2, T / 2 + 0.1, { chamfer: 0.02, tint: [0.9, 0.85, 0.85] });
        localBox(f, 'arch_basalt', 0.62, 0.74, 1.15, 2.39, T / 2, T / 2 + 0.1, { chamfer: 0.02, tint: [0.9, 0.85, 0.85] });
        f.relief = true;
      }
      spots.bane.push(f);
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

  /**
   * The burnt-out frame of a ruined timber house: a broken sill, a few surviving posts at uneven
   * spacing (others gone), each snapped off at its own height and angle with a charred, splintered
   * end, the odd stub of rail, and at most one sagging brace that ends in the air — never a tidy
   * pair of verticals joined by a diagonal (those read as letters).
   */
  function ruinFrame(f) {
    const H = f.H;
    const d0 = T / 2 - 0.02;
    const d1 = T / 2 + 0.05;
    const sd = f.seed;
    const plasterTop = (sv) => (f.jag ? 1.2 + (H - 1.2) * f.jag(sv) : H);
    const clear = (sv, w) => !f.openings.some((o) => sv + w > o.s0 - 0.05 && sv - w < o.s1 + 0.05);
    const char = [0.24, 0.2, 0.17];
    const wood = [1.3, 1.2, 1.08]; // silver-grey weathered oak (never a black cut-out against the sky)
    // sill: two lengths, the shorter one dropped at one end
    const cut = -0.4 + hash(sd, 'sc') * 0.8;
    localBox(f, 'arch_beam_dark', -S / 2, cut - 0.06, 1.2, 1.36, d0, d1, { uv: 'along', skip: ['nz'], tint: wood });
    beam(f, 'arch_beam_dark', [cut + 0.04, 1.28], [S / 2, 1.28 - 0.08 - hash(sd, 'sd') * 0.1], 0.15, d0, d1, { tint: wood });
    // surviving posts
    const cand = [-S / 2 + 0.12, -0.75 + hash(sd, 'p1') * 0.3, 0.35 + hash(sd, 'p2') * 0.4, S / 2 - 0.12];
    let kept = 0;
    const posts = [];
    cand.forEach((sv, k) => {
      if (!clear(sv, 0.1)) return;
      if (hash(sd, k, 'keep') < 0.38 && kept + (cand.length - k) > 1) return;
      kept++;
      const pt = plasterTop(sv);
      const top = Math.min(H - 0.05, Math.max(1.6, pt + (hash(sd, k, 'ht') - 0.35) * 1.3));
      const lean = (hash(sd, k, 'ln') - 0.5) * 0.12;
      const w = 0.15 + hash(sd, k, 'w') * 0.04;
      const len = top - 1.36;
      const m = localMatrix(f, sv, 1.36 + len / 2, (d0 + d1) / 2, lean);
      g.box('arch_beam_dark', { matrix: m, s: [w, len, d1 - d0], uv: 'along', skip: ['nz'], tint: wood });
      // charred, snapped end: a blackened collar and a splinter standing off one side at an angle
      const cm = localMatrix(f, sv - Math.sin(lean) * (len / 2 - 0.12), top - 0.12, (d0 + d1) / 2, lean);
      g.box('arch_beam_dark', { matrix: cm, s: [w + 0.012, 0.26, d1 - d0 + 0.012], uv: 'along', skip: ['nz'], tint: char });
      const side = hash(sd, k, 'sp') < 0.5 ? -1 : 1;
      const spl = 0.12 + hash(sd, k, 'sl') * 0.22;
      const sm = localMatrix(f, sv - Math.sin(lean) * len / 2 + side * w * 0.25, top + spl / 2 - 0.02, (d0 + d1) / 2, lean + side * (0.1 + hash(sd, k, 'sa') * 0.25));
      g.box('arch_beam_dark', { matrix: sm, s: [w * 0.4, spl, (d1 - d0) * 0.8], uv: 'along', skip: ['nz'], tint: char });
      posts.push({ sv, top });
    });
    // one stub of rail off a post, sagging, burnt at its free end
    if (posts.length && hash(sd, 'rail') < 0.6) {
      const p0 = posts[Math.floor(hash(sd, 'rp') * posts.length)];
      const y = Math.min(p0.top - 0.3, 2.2 + hash(sd, 'ry') * 0.3);
      if (y > 1.7) {
        const dir = p0.sv > 0 ? -1 : 1;
        const len = 0.35 + hash(sd, 'rl') * 0.45;
        beam(f, 'arch_beam_dark', [p0.sv, y], [p0.sv + dir * len, y - 0.06 - hash(sd, 'rs') * 0.12], 0.14, d0 + 0.005, d1 - 0.005, { tint: wood });
        localBox(f, 'arch_beam_dark', p0.sv + dir * len - 0.07, p0.sv + dir * len + 0.07, y - 0.24, y - 0.04, d0 + 0.004, d1 - 0.004, { rotZ: dir * 0.3, uv: 'along', skip: ['nz'], tint: char });
      }
    }
    // at most one brace, at a shallow sag, rising from a post foot and ending in mid-air
    if (posts.length && hash(sd, 'br') < 0.45) {
      const p0 = posts[Math.floor(hash(sd, 'bp') * posts.length)];
      const dir = p0.sv > 0 ? -1 : 1;
      const ang = 0.35 + hash(sd, 'ba') * 0.25;
      const len = 0.7 + hash(sd, 'bl') * 0.5;
      const b = [p0.sv + dir * Math.cos(ang) * len, 1.36 + Math.sin(ang) * len];
      beam(f, 'arch_beam_dark', [p0.sv + dir * 0.06, 1.38], b, 0.12, d0 + 0.01, d1 - 0.01, { tint: wood });
    }
  }

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
    const stoneFrame = style === 'stone' || style === 'dungeon' || style === 'int_stone' || style === 'dungeon_brick' || style === 'cave' || style === 'ruin' || style === 'hewn' || style === 'basalt';
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
    // jambs: alternating long/short dressed blocks with individual depth, chamfer, tone
    // and a hair of misalignment (stone), or a single post (timber)
    const blockKey = style === 'basalt' ? 'arch_basalt' : style === 'hewn' ? 'arch_dungeon' : stoneFrame ? 'arch_dressed' : frameKey;
    const tone = (k, sgn) => {
      const t = 0.86 + hash(e.key, sgn, k, 'jt') * 0.2;
      const w = (hash(e.key, sgn, k, 'jw') - 0.5) * 0.08;
      return [t * (1 + w), t, t * (1 - w * 1.4)];
    };
    /**
     * Dressed jamb block in plan: a rectangle whose two arrises on the opening side are cut back
     * to a 45-degree chamfer (front and back), extruded up the block's height with small worn
     * bevels, then roughened. Centred on the origin; `inner` = +1 if the opening lies toward +s.
     */
    const jambGeo = (sx, sy, sz, inner, cham, seed) => {
      const hx = sx / 2;
      const hz = sz / 2;
      const c = Math.min(cham, sx * 0.4, hz * 0.4);
      const shp = new THREE.Shape();
      const pts = inner > 0
        ? [[-hx, -hz], [hx - c, -hz], [hx, -hz + c], [hx, hz - c], [hx - c, hz], [-hx, hz]]
        : [[hx, -hz], [hx, hz], [-hx + c, hz], [-hx, hz - c], [-hx, -hz + c], [-hx + c, -hz]];
      shp.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) shp.lineTo(pts[i][0], pts[i][1]);
      shp.closePath();
      const bv = 0.008;
      const geo = new THREE.ExtrudeGeometry(shp, { depth: Math.max(0.001, sy - 2 * bv), bevelEnabled: true, bevelThickness: bv, bevelSize: bv * 0.7, bevelSegments: 1, curveSegments: 1 });
      // extrusion runs along +z: stand it up (z -> y) and centre it
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -(sy - 2 * bv) / 2, 0);
      return roughen(geo, { amp: 0.004, seed, chip: 0.012, freq: 7 });
    };
    const jambOut = 0.22; // jamb width on the wall face
    for (const sgn of [-1, 1]) {
      const a = sgn < 0 ? -w / 2 - jambOut : w / 2;
      const b = sgn < 0 ? -w / 2 : w / 2 + jambOut;
      if (stoneFrame) {
        let y = 0;
        for (let k = 0; y < h - 0.01; k++) {
          // block-and-start jamb: alternating long (bonded into the wall) and short stones,
          // course heights cut to land exactly on the springing at the jamb top
          const left = h - y;
          let bh = 0.36 + hash(e.key, sgn, k, 'jb') * 0.16;
          if (left - bh < 0.24) bh = left;
          const long = (k + (sgn > 0 ? 1 : 0)) % 2 === 0;
          const ext = long ? 0.07 + hash(e.key, sgn, k, 'je') * 0.06 : 0.0;
          const proud = hash(e.key, sgn, k, 'jp') * 0.012; // some blocks sit a hair proud of the others
          const s0 = sgn < 0 ? a - ext : a;
          const s1 = sgn < 0 ? b : b + ext;
          const m = localMatrix(f, (s0 + s1) / 2, y + bh / 2, 0, (hash(e.key, sgn, k, 'jr') - 0.5) * 0.006);
          // the jambs stand proud of the wall so the door sits deep in its reveal; the opening-side
          // arrises are chamfered; joints are tight (4 mm) over a lime bed
          const jg = jambGeo(s1 - s0 - 0.004, bh - 0.004, fd1 - fd0 + 0.1 + proud * 2 + (long ? 0 : -0.02), -sgn, 0.045, hash(e.key, sgn, k, 'js') * 100);
          g.geometry(blockKey, jg, m, { uv: 'world', ao: revealAO, tint: tone(k, sgn) });
          jg.dispose();
          y += bh;
        }
        // lime bed behind the dressings: the joints show mortar, never daylight or a void
        localBox(f, 'arch_trim', sgn < 0 ? a - 0.03 : a + 0.004, sgn < 0 ? b - 0.004 : b + 0.03, 0, h, fd0 + 0.045, fd1 - 0.045, { tint: [0.5, 0.47, 0.42], ao: 0.6 });
      } else localBox(f, frameKey, a, b, 0, h, fd0, fd1, { chamfer: 0.03, uv: fu, ao: revealAO });
    }
    if (stoneFrame) {
      // segmental arch springing straight off the jamb tops: the springers are cut flat on the
      // jamb and radial above; wedge voussoirs on a true arc with tight radial joints and a proud
      // keystone. Under it a recessed tympanum of dressed stone fills the head of the opening
      // down to the door (no lintel, no gap).
      const c = w / 2;
      const rise = 0.22;
      const R = (c * c + rise * rise) / (2 * rise);
      const cyA = h + rise - R;
      const th0 = Math.asin(c / R);
      const vd = fd1 - fd0 + 0.08;
      const pr = (rr, aa) => [Math.sin(aa) * rr, cyA + Math.cos(aa) * rr];
      // tympanum: dressed panel, set back in the reveal, with a lime bed behind the arch
      const tym = new THREE.Shape();
      tym.moveTo(-c, h);
      tym.lineTo(c, h);
      for (let i = 0; i <= 12; i++) {
        const aa = th0 - (2 * th0 * i) / 12;
        const q = pr(R, aa);
        tym.lineTo(q[0], q[1]);
      }
      tym.closePath();
      const tg = new THREE.ExtrudeGeometry(tym, { depth: fd1 - fd0 - 0.24, bevelEnabled: false, curveSegments: 1 });
      tg.translate(0, 0, -(fd1 - fd0 - 0.24) / 2);
      g.geometry(blockKey, tg, f.basis, { uv: 'world', ao: (p, n) => revealAO(p, n) * 0.9 + 0.1, tint: [0.92, 0.88, 0.82] });
      tg.dispose();
      localBox(f, 'arch_trim', -c - jambOut - 0.06, c + jambOut + 0.06, h, h + rise + 0.5, fd0 + 0.09, fd1 - 0.09, { tint: [0.5, 0.47, 0.42], ao: 0.6 });
      const n = 9;
      const wts = [];
      for (let k = 0; k < n; k++) wts.push(k === (n - 1) / 2 ? 1.3 : 0.85 + hash(e.key, k, 'vw') * 0.35);
      const wsum = wts.reduce((p, q) => p + q, 0);
      let acc = 0;
      const gap = 0.004;
      for (let k = 0; k < n; k++) {
        const a0 = -th0 + (2 * th0 * acc) / wsum + (k ? gap / R : 0);
        acc += wts[k];
        const a1 = -th0 + (2 * th0 * acc) / wsum - (k < n - 1 ? gap / R : 0);
        const isKey = k === (n - 1) / 2;
        const vh = isKey ? 0.33 : 0.25 + hash(e.key, k, 'vh') * 0.04;
        const r1 = R + vh;
        let q;
        if (k === 0 || k === n - 1) {
          // springer: flat bed on the jamb top, outer face plumb with the jamb, radial joint above
          const side = k === 0 ? -1 : 1;
          const aIn = k === 0 ? a1 : a0;
          const inner = pr(R, aIn);
          const outer = pr(r1, aIn);
          q = side < 0
            ? [[-c, h], inner, outer, [-c - jambOut, outer[1]], [-c - jambOut, h]]
            : [[c, h], [c + jambOut, h], [c + jambOut, outer[1]], outer, inner];
        } else {
          q = [pr(R, a0), pr(R, a1), pr(r1, a1), pr(r1, a0)];
        }
        // the shape must wind counter-clockwise (front face toward +d)
        let area = 0;
        for (let i = 0; i < q.length; i++) {
          const p0 = q[i];
          const p1 = q[(i + 1) % q.length];
          area += p0[0] * p1[1] - p1[0] * p0[1];
        }
        if (area < 0) q.reverse();
        const shp = new THREE.Shape();
        shp.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i < q.length; i++) shp.lineTo(q[i][0], q[i][1]);
        shp.closePath();
        const dep = vd + (isKey ? 0.06 : hash(e.key, k, 'vp') * 0.02);
        const bv = 0.009;
        const geo = new THREE.ExtrudeGeometry(shp, { depth: dep - bv * 2, bevelEnabled: true, bevelThickness: bv, bevelSize: bv * 0.7, bevelSegments: 1, curveSegments: 1 });
        geo.translate(0, 0, -(dep - bv * 2) / 2);
        roughen(geo, { amp: 0.004, seed: hash(e.key, k, 'vs') * 100, chip: 0.015, freq: 7 });
        g.geometry(blockKey, geo, f.basis, { uv: 'world', ao: revealAO, tint: tone(k, 7) });
        geo.dispose();
      }
    } else localBox(f, frameKey, -w / 2 - 0.32, w / 2 + 0.32, h, h + 0.26, fd0 - 0.02, fd1 + 0.02, { chamfer: 0.035, uv: fu, ao: revealAO });
    localBox(f, stoneFrame ? blockKey : 'arch_trim', -w / 2 - 0.05, w / 2 + 0.05, 0, 0.06, fd0 - 0.12, fd1 + 0.12, { chamfer: 0.02, tint: [0.8, 0.78, 0.74] }); // worn threshold step

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
    const hasGrille = hash(e.key, 'grille') < 0.6;
    for (let k = 0; k < np; k++) {
      const x0 = k * pw + 0.004;
      const x1 = (k + 1) * pw - 0.004;
      const tk = th - hash(e.key, k, 'pt') * 0.012;
      const dz = (hash(e.key, k, 'pz') - 0.5) * 0.006;
      // vertical segments concentrate vertex AO near the head of the door
      const segs = [[0, 0.32], [0.32, lh - 0.6], [lh - 0.6, lh - 0.18], [lh - 0.18, lh - hash(e.key, k, 'ph') * 0.02]];
      const hx0 = lw / 2 - 0.15;
      const hx1 = lw / 2 + 0.15;
      const cut = hasGrille && x1 > hx0 && x0 < hx1;
      for (const [y0, y1] of segs) {
        const pieces = [];
        if (cut && y0 < 1.42 && y1 > 1.68) {
          // the speak-hole is cut through this plank: leave the wood around it
          pieces.push([x0, x1, y0, 1.42], [x0, x1, 1.68, y1]);
          if (x0 < hx0) pieces.push([x0, hx0, 1.42, 1.68]);
          if (x1 > hx1) pieces.push([hx1, x1, 1.42, 1.68]);
        } else pieces.push([x0, x1, y0, y1]);
        for (const [a0, a1, b0, b1] of pieces) {
          lg.box('arch_door', { c: [(a0 + a1) / 2, (b0 + b1) / 2, dz], s: [a1 - a0, b1 - b0, tk], uv: 'local', chamfer: 0.006, uvRect: [a0 / lw, b0 / lh, a1 / lw, b1 / lh], skip: b0 > 0 && !cut ? ['ny'] : b1 < lh - 0.1 && !cut ? ['py'] : [] });
        }
      }
    }
    const rivet = new THREE.SphereGeometry(0.016, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    rivet.rotateX(Math.PI / 2);
    const rivetBack = rivet.clone().rotateY(Math.PI);
    const strapYs = [0.82, lh - 0.42];
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
        if (hasGrille && Math.abs(x - lw / 2) < 0.24 && Math.abs(y - 1.55) < 0.2) continue;
        for (const sgnZ of [1, -1]) lg.geometry('prop_iron', sgnZ > 0 ? rivet : rivetBack, new THREE.Matrix4().makeTranslation(x, y, sgnZ * (th / 2 + 0.002)), { ao: 0.9 });
      }
    }
    rivet.dispose();
    rivetBack.dispose();
    if (hasGrille) {
      // speak-hole: a moulded oak surround proud of the planks, the opening recessed into the
      // leaf with a forged lattice set back in it, and a sliding shutter behind, half drawn
      const gy = 1.55;
      const gx = lw / 2;
      const gw = 0.3;
      const gh = 0.26;
      for (const sz of [1, -1]) {
        const zf = sz * (th / 2 + 0.012);
        lg.box('arch_beam_dark', { c: [gx, gy + gh / 2 + 0.03, zf], s: [gw + 0.12, 0.06, 0.03], uv: 'local', chamfer: 0.01 });
        lg.box('arch_beam_dark', { c: [gx, gy - gh / 2 - 0.035, zf], s: [gw + 0.14, 0.07, 0.034], uv: 'local', chamfer: 0.012 }); // sill
        for (const bx of [-1, 1]) lg.box('arch_beam_dark', { c: [gx + bx * (gw / 2 + 0.03), gy, zf], s: [0.06, gh, 0.03], uv: 'local', chamfer: 0.01 });
        // reveal of the cut-out: dark end grain lining the hole
        for (const bx of [-1, 1]) lg.box('arch_beam_dark', { c: [gx + bx * (gw / 2 - 0.006), gy, sz * th * 0.25], s: [0.012, gh, th * 0.5], uv: 'local', ao: 0.4 });
        lg.box('arch_beam_dark', { c: [gx, gy + gh / 2 - 0.006, sz * th * 0.25], s: [gw, 0.012, th * 0.5], uv: 'local', ao: 0.35 });
        lg.box('arch_beam_dark', { c: [gx, gy - gh / 2 + 0.006, sz * th * 0.25], s: [gw, 0.012, th * 0.5], uv: 'local', ao: 0.55 });
      }
      // lattice set back ~2.5 cm in the opening: two uprights and a cross-bar, riveted at the laps
      const zb = th / 2 - 0.026;
      for (const bx of [-0.075, 0.0, 0.075]) lg.box('prop_iron', { c: [gx + bx, gy, zb], s: [0.018, gh, 0.016], chamfer: 0.004 });
      for (const by of [-0.06, 0.06]) lg.box('prop_iron', { c: [gx, gy + by, zb - 0.012], s: [gw, 0.018, 0.014], chamfer: 0.004 });
      // the shutter: an oak slide in a groove at the back, drawn two-thirds across
      lg.box('arch_door', { c: [gx + gw * 0.2, gy, -th / 2 + 0.018], s: [gw * 0.68, gh + 0.02, 0.02], uv: 'local', uvRect: [0.4, 0.5, 0.48, 0.58], chamfer: 0.004, ao: 0.45 });
      lg.box('prop_iron', { c: [gx - gw * 0.1, gy, -th / 2 + 0.03], s: [0.02, 0.05, 0.02], chamfer: 0.006 }); // its knob
      lg.box('arch_beam_dark', { c: [gx - gw * 0.2, gy, -th / 2 + 0.008], s: [gw * 0.5, gh, 0.012], uv: 'local', ao: 0.08 }); // dark beyond the gap
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
    return { stone: 'arch_stone', ruin: 'arch_ruin', dungeon: 'arch_dungeon', dungeon_brick: 'arch_brick', cave: 'arch_ruin', hewn: 'arch_hewn', basalt: 'arch_basalt', int_stone: 'arch_stone_cold', int_plaster: 'arch_plaster_int', int_panel: 'arch_wainscot', ruin_timber: 'arch_ruin' }[rec] ?? 'arch_stone';
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
    if (!indoor) {
      // runoff from the sill down the wall below it (outside face only)
      const fo = { basis: f.basis, seed: hash(e.key, o.y0, 'sr'), interior: false };
      const dFace = outSign * (T / 2 + jetty + 0.004);
      const L = Math.min(y0 - 0.1 - 0.05, 0.8 + hash(e.key, o.y0, 'sl') * 0.9);
      if (outSign > 0) runoffUnder(fo, s0 - 0.12, s1 + 0.12, y0 - 0.1, L, dFace);
      else runoffUnder({ ...fo, basis: f.basis.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI)) }, -s1 - 0.12, -s0 + 0.12, y0 - 0.1, L, -dFace);
    }
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
    if (!indoor && night > 0.3) {
      // warm lamplight spilling out: a glow on the reveal/sill/wall around the opening and,
      // for ground-floor windows, a pool on the street below
      const dw = dOut + outSign * 0.012;
      const W2 = (s1 - s0) / 2 + 0.75;
      const cxs = (s0 + s1) / 2;
      const P = (sv, yy, dd) => new THREE.Vector3(sv, yy, dd).applyMatrix4(f.basis);
      const q = [P(cxs - W2, y0 - 0.9, dw), P(cxs + W2, y0 - 0.9, dw), P(cxs + W2, y1 + 0.5, dw), P(cxs - W2, y1 + 0.5, dw)];
      spillQuads.push(outSign > 0 ? q : [q[1], q[0], q[3], q[2]]);
      if (!o.upper) {
        const gq = [P(cxs - W2 - 0.3, 0.015, dOut), P(cxs + W2 + 0.3, 0.015, dOut), P(cxs + W2 + 0.3, 0.045, dOut + outSign * 2.2), P(cxs - W2 - 0.3, 0.045, dOut + outSign * 2.2)];
        spillQuads.push(gq);
      }
    }
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
    if (!indoor && !o.upper && ((r > 0.92 && night < 0.3) || templeWall)) {
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
    // hood: a canted stone smoke-hood above the mantel narrowing into the chimney breast
    {
      const P = (sv, y, dd) => new THREE.Vector3(sv, y, dd).applyMatrix4(f.basis);
      const yb = 1.42;
      const yt = 2.45;
      const wb = 1.2;
      const wt = 0.82;
      const db = d + depth + 0.06;
      const dt = d + depth - 0.12;
      const hk = 'arch_stone';
      const tint = [0.86, 0.82, 0.76];
      // hood front as a subdivided grid so the soot plume can be painted in per vertex: black at the
      // lip above the firebox, fanning out and fading up the hood
      {
        const NX = 10;
        const NY = 8;
        const soot = (u, v) => {
          const cx = Math.abs(u - 0.5) * 2;
          const plume = (1 - THREE.MathUtils.smoothstep(cx, 0.25 + v * 0.5, 0.55 + v * 0.6)) * (1 - v * 0.75);
          return 1 - 0.72 * plume;
        };
        for (let j = 0; j < NY; j++) {
          for (let i = 0; i < NX; i++) {
            const pt = (ii, jj) => {
              const u = ii / NX;
              const v = jj / NY;
              const w = wb + (wt - wb) * v;
              return [P(-w + 2 * w * u, yb + (yt - yb) * v, db + (dt - db) * v), soot(u, v)];
            };
            const [a, sa] = pt(i, j);
            const [b, sb] = pt(i + 1, j);
            const [c, sc] = pt(i + 1, j + 1);
            const [e, se] = pt(i, j + 1);
            const sAvg = (sa + sb + sc + se) / 4;
            g.quad(hk, a, b, c, e, null, { tint: [tint[0] * sAvg, tint[1] * sAvg, tint[2] * sAvg], ao: 0.9, uvOff: [0.37, 0.11] });
          }
        }
      }
      g.quad(hk, P(-wb, yb, d), P(-wb, yb, db), P(-wt, yt, dt), P(-wt, yt, d), null, { tint, ao: 0.8 });
      g.quad(hk, P(wb, yb, db), P(wb, yb, d), P(wt, yt, d), P(wt, yt, dt), null, { tint, ao: 0.8 });
      g.quad(hk, P(-wb, yb, d), P(wb, yb, d), P(wb, yb, db), P(-wb, yb, db), null, { tint, ao: 0.5 });
      localBox(f, 'arch_stone', -wt, wt, yt, H, d, dt, { tint: [0.62, 0.58, 0.54] });
      // a crowning cornice on the hood lip and a carved shield of arms on its face
      localBox(f, 'arch_dressed', -wb - 0.05, wb + 0.05, yb - 0.02, yb + 0.07, d, db + 0.05, { chamfer: 0.025, tint: [0.7, 0.66, 0.6] });
      {
        const sm = localMatrix(f, 0, (yb + yt) / 2 + 0.02, (db + dt) / 2 + 0.03, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(db - dt, yt - yb)));
        const sh = new THREE.Shape();
        sh.moveTo(-0.2, 0.22);
        sh.lineTo(0.2, 0.22);
        sh.lineTo(0.2, 0.0);
        sh.quadraticCurveTo(0.18, -0.18, 0, -0.27);
        sh.quadraticCurveTo(-0.18, -0.18, -0.2, 0.0);
        sh.closePath();
        const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 });
        g.geometry('arch_dressed', sg, sm, { uv: 'world', tint: [0.55, 0.16, 0.12], ao: 0.9 });
        sg.dispose();
        // a gilt chevron on the field
        const cv = new THREE.Shape();
        cv.moveTo(-0.17, -0.06);
        cv.lineTo(0, 0.1);
        cv.lineTo(0.17, -0.06);
        cv.lineTo(0.17, 0.0);
        cv.lineTo(0, 0.16);
        cv.lineTo(-0.17, 0.0);
        cv.closePath();
        const cg = new THREE.ExtrudeGeometry(cv, { depth: 0.012, bevelEnabled: false });
        g.geometry('gilt', cg, sm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.055)), { uv: 'world' });
        cg.dispose();
      }
      // a moulded string course where hood meets breast
      localBox(f, 'arch_dressed', -wt - 0.06, wt + 0.06, yt, yt + 0.1, d, dt + 0.06, { chamfer: 0.02, tint: [0.9, 0.86, 0.8] });
      // stone corbels under the mantel ends
      for (const sx of [-1.08, 1.08]) localBox(f, 'arch_dressed', sx - 0.1, sx + 0.1, 0.95, 1.2, d, d + depth + 0.08, { chamfer: 0.025, tint: [0.84, 0.8, 0.75] });
      // things on the mantel: candlesticks, a pewter plate, two jars
      const top = 1.42;
      for (const sx of [-0.95, 0.95]) {
        const cs = new THREE.CylinderGeometry(0.03, 0.05, 0.2, 8);
        g.geometry('arch_iron', cs, localMatrix(f, sx, top + 0.1, d + depth - 0.02), { uv: 'world' });
        cs.dispose();
        const cn = new THREE.CylinderGeometry(0.02, 0.022, 0.12, 8);
        g.geometry('arch_trim', cn, localMatrix(f, sx, top + 0.26, d + depth - 0.02), { uv: 'world', tint: [1.1, 1.05, 0.95] });
        cn.dispose();
      }
      const plate = new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16);
      plate.rotateX(Math.PI / 2 - 0.25);
      g.geometry('arch_iron', plate, localMatrix(f, 0, top + 0.17, d + depth - 0.06), { uv: 'world' });
      plate.dispose();
      for (const sx of [-0.5, 0.45]) {
        const jar = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.08, 0.06], [0.07, 0.15], [0.045, 0.18], [0.05, 0.2], [0, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
        g.geometry('arch_brick', jar, localMatrix(f, sx, top, d + depth), { uv: 'world', tint: [0.95, 0.75, 0.55] });
        jar.dispose();
      }
    }
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
      const emat = new THREE.MeshStandardMaterial({ color: 0x050302, emissive: new THREE.Color(0xff6a24), emissiveMap: getEmberTexture(), emissiveIntensity: 1.25, roughness: 1 });
      const egeo = new THREE.PlaneGeometry(1.0, 0.42);
      egeo.rotateX(-Math.PI / 2);
      const em = new THREE.Mesh(egeo, emat);
      em.applyMatrix4(localMatrix(f, 0, 0.1, d + 0.3, 0));
      em.userData.ownMaterial = true;
      group.add(em);
      // soot plume up the chimney breast above the firebox
      const smat = new THREE.MeshStandardMaterial({ color: 0x050403, alphaMap: getSootTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
      // soot darkening the hood's face (canted) and fading up the breast
      const tilt = Math.atan2(0.18, 1.03);
      const sgeo = new THREE.PlaneGeometry(2.0, 1.05);
      const sm = new THREE.Mesh(sgeo, smat);
      sm.applyMatrix4(localMatrix(f, 0, (1.42 + 2.45) / 2, d + depth - 0.03 + 0.008, 0).multiply(new THREE.Matrix4().makeRotationX(-tilt)));
      sm.userData.ownMaterial = true;
      sm.renderOrder = 3;
      group.add(sm);
      const sb2 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, Math.max(0.3, H - 2.55)), smat);
      sb2.applyMatrix4(localMatrix(f, 0, 2.55 + Math.max(0.3, H - 2.55) / 2, d + depth - 0.12 + 0.006, 0));
      sb2.renderOrder = 3;
      group.add(sb2);
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
    // bracket: forged back-plate with a scrolled finial, two rivets, a strap arm and a collar ring
    const bv = hash(face.seed, s, y, 'bv');
    const plateL = 0.26 + bv * 0.16;
    const plateW = bv < 0.33 ? 0.07 : bv < 0.66 ? 0.09 : 0.11;
    localBox(face, 'arch_iron', s - plateW / 2, s + plateW / 2, y - plateL, y + 0.02, d, d + 0.018, { chamfer: 0.012 });
    if (bv < 0.66) localBox(face, 'arch_iron', s - 0.022, s + 0.022, y + 0.02, y + 0.08 + bv * 0.05, d, d + 0.016, { chamfer: 0.01 });
    else {
      // a scrolled finial: a small forged ring above the plate
      const fr = new THREE.TorusGeometry(0.035, 0.008, 5, 12);
      g.geometry('arch_iron', fr, localMatrix(face, s, y + 0.06, d + 0.01), { uv: 'world' });
      fr.dispose();
    }
    for (const yy of [y - 0.29, y - 0.03]) {
      const rv = new THREE.SphereGeometry(0.014, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      rv.rotateX(Math.PI / 2);
      g.geometry('arch_iron', rv, localMatrix(face, s, yy, d + 0.017), { uv: 'world' });
      rv.dispose();
    }
    beamIron(face, [s, y - 0.25, d + 0.015], [s, y - 0.12, d + 0.22], 0.022);
    beamIron(face, [s, y - 0.04, d + 0.015], [s, y - 0.12, d + 0.22], 0.022);
    let tip = new THREE.Vector3(s, y + 0.06, d + 0.27).applyMatrix4(face.basis);
    if (kind === 'torch') {
      // tapered haft of split ash, bound with twine, leaning out of a forged collar;
      // the head is pitch-soaked rag in an open iron cage of curved bars
      const lean = 0.24;
      const m = localMatrix(face, s, y - 0.1, d + 0.245);
      m.multiply(new THREE.Matrix4().makeRotationX(lean));
      const haft = new THREE.CylinderGeometry(0.026, 0.017, 0.58, 10, 4);
      // slight irregularity in the turned haft
      const hp = haft.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const a = Math.atan2(hp.getZ(i), hp.getX(i));
        const k = 1 + 0.08 * Math.sin(a * 3 + hp.getY(i) * 9) * 0.5;
        hp.setX(i, hp.getX(i) * k);
        hp.setZ(i, hp.getZ(i) * k);
      }
      haft.computeVertexNormals();
      g.geometry('arch_beam', haft, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.04, 0)), { uv: 'world', tint: [0.75, 0.62, 0.5] });
      haft.dispose();
      // twine bindings
      const bind = new THREE.TorusGeometry(0.024, 0.006, 4, 12);
      bind.rotateX(Math.PI / 2);
      for (const by of [-0.2, -0.17, -0.14, 0.02, 0.05]) g.geometry('prop_burlap', bind, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, by, 0)).multiply(new THREE.Matrix4().makeScale(1 - by * 0.4, 1, 1 - by * 0.4)), { uv: 'world', tint: [0.6, 0.5, 0.38] });
      bind.dispose();
      // forged collar on the arm
      const ring = new THREE.TorusGeometry(0.036, 0.009, 6, 14);
      ring.rotateX(Math.PI / 2);
      g.geometry('arch_iron', ring, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.02, 0)), { uv: 'world' });
      ring.dispose();
      // head: a fist of charred, pitch-soaked rag wound round the haft end, held in a forged cup
      // of four plain straps (no cage)
      const prof = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        prof.push(new THREE.Vector2(0.021 + Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.5) * 0.013 - t * t * 0.012 + (k % 2) * 0.002, -0.05 + t * 0.14));
      }
      const head = new THREE.LatheGeometry(prof, 12);
      const mc = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.27, 0));
      tip = new THREE.Vector3(0, 0.06, 0).applyMatrix4(mc);
      g.geometry('arch_beam_dark', head, mc, { uv: 'world', tint: [0.14, 0.11, 0.09] });
      head.dispose();
      const variant = Math.floor(hash(face.seed, s, 'tv') * 3);
      const nS = variant === 2 ? 3 : 4;
      for (let k = 0; k < nS; k++) {
        const a = (k * Math.PI * 2) / nS + 0.4;
        const bm = mc.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeTranslation(0.031, -0.02, 0)).multiply(new THREE.Matrix4().makeRotationZ(-0.22));
        g.box('arch_iron', { matrix: bm, s: [0.008, 0.08, 0.013] });
      }
      const band = new THREE.TorusGeometry(0.03, 0.005, 4, 14);
      band.rotateX(Math.PI / 2);
      g.geometry('arch_iron', band, mc.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.055, 0)), { uv: 'world' });
      if (variant !== 1) g.geometry('arch_iron', band, mc.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.018, 0)).multiply(new THREE.Matrix4().makeScale(1.25, 1, 1.25)), { uv: 'world' });
      band.dispose();
    } else {
      // candle lantern
      localBox(face, 'arch_iron', s - 0.1, s + 0.1, y - 0.1, y - 0.07, d + 0.16, d + 0.36);
      localBox(face, 'arch_iron', s - 0.11, s + 0.11, y + 0.22, y + 0.26, d + 0.15, d + 0.37, { chamfer: 0.01 });
    }
    if (kind === 'torch') {
      // years of pitch smoke: a soot plume fanning up the wall above the torch head
      const dd = d + 0.006;
      const P = (sv, yy) => new THREE.Vector3(sv, yy, dd).applyMatrix4(face.basis);
      const w = 0.62 + hash(face.seed, s, 'sootw') * 0.3;
      const y0 = y - 0.02;
      const y1 = Math.min(face.H - 0.05, y + 1.25 + hash(face.seed, s, 'sooth') * 0.5);
      if (y1 > y0 + 0.4) sootQuads.push([P(s - w / 2, y0), P(s + w / 2, y0), P(s + w / 2, y1), P(s - w / 2, y1)]);
      if (lit) {
        // the warm radial falloff the flame throws on the stone around it (reads even by day)
        const dg = d + 0.07;
        const G = (sv, yy) => new THREE.Vector3(sv, yy, dg).applyMatrix4(face.basis);
        const R = 1.25;
        const yc = y + 0.2;
        torchSpill.push([G(s - R, Math.max(0.02, yc - R)), G(s + R, Math.max(0.02, yc - R)), G(s + R, Math.min(face.H - 0.02, yc + R)), G(s - R, Math.min(face.H - 0.02, yc + R))]);
      }
    }
    torches.push({ pos: kind === 'torch' ? tip.clone().add(new THREE.Vector3(0, 0.1, 0)) : tip.clone(), base, N: out, lit, kind, seed: Math.floor(face.seed * 1000) });
  }
  function beamIron(face, a, b, w = 0.03) {
    const va = new THREE.Vector3(...a).applyMatrix4(face.basis);
    const vb = new THREE.Vector3(...b).applyMatrix4(face.basis);
    const len = va.distanceTo(vb);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize());
    g.box('arch_iron', { matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), s: [w, len, w * 0.8], chamfer: w * 0.2 });
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
  /** Distance (m, ground plane) from (px, pz) to the nearest wall/door edge around it. */
  const wallDist = (px, pz) => {
    const cx = Math.floor(px / S);
    const cz = Math.floor(pz / S);
    let best = 9;
    for (let y = cz - 1; y <= cz + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (!map.inBounds(x, y)) continue;
        for (const d of ['N', 'W', 'S', 'E']) {
          if (map.getEdge(x, y, d) === EDGE.OPEN) continue;
          // edge segment
          const ax = d === 'E' ? (x + 1) * S : x * S;
          const az = d === 'S' ? (y + 1) * S : y * S;
          const bx = d === 'N' || d === 'S' ? ax + S : ax;
          const bz = d === 'W' || d === 'E' ? az + S : az;
          const tx = THREE.MathUtils.clamp(bx === ax ? 0 : (px - ax) / (bx - ax), 0, 1);
          const tz = THREE.MathUtils.clamp(bz === az ? 0 : (pz - az) / (bz - az), 0, 1);
          const qx = ax + (bx - ax) * (bx === ax ? 0 : tx);
          const qz = az + (bz - az) * (bz === az ? 0 : tz);
          best = Math.min(best, Math.hypot(px - qx, pz - qz));
        }
      }
    }
    return best;
  };
  /** Street crown: the carriageway rises gently toward its middle (drains to the wall gutters). */
  const crownAt = (px, pz) => {
    if (indoor) return 0;
    const cx = Math.floor(px / S);
    const cz = Math.floor(pz / S);
    if (!map.inBounds(cx, cz) || map.getCell(cx, cz) !== CELL.STREET) return 0;
    return 0.03 * THREE.MathUtils.smoothstep(wallDist(px, pz), 0.9, 1.7);
  };
  const groundDecals = { dirt: [], rut: [] };
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
      if (isPier(x, y)) {
        // deck planks across the pier on two stringers, ends staggered, a few boards sprung or missing
        const alongX = waterAt(x, y - 1) || waterAt(x, y + 1);
        const n = Math.round(S / 0.3);
        for (let k = 0; k < n; k++) {
          if (hash(map.id, x, y, k, 'gone') < 0.03) continue;
          const t = (k + 0.5) * (S / n);
          const w = S / n - 0.025;
          const lift = (hash(map.id, x, y, k, 'lf') - 0.5) * 0.012;
          const tint = 0.78 + hash(map.id, x, y, k, 'tn') * 0.3;
          const c = alongX ? [x0 + t, -0.025 + lift, z0 + S / 2] : [x0 + S / 2, -0.025 + lift, z0 + t];
          g.box('arch_boards', { c, s: alongX ? [w, 0.06, S + 0.02] : [S + 0.02, 0.06, w], uv: 'world', tint: [tint, tint * 0.95, tint * 0.88], rotY: (hash(map.id, x, y, k, 'ry') - 0.5) * 0.01, ao: (p, nn) => (nn.y > 0.5 ? 0.95 : 0.5) });
        }
        for (const o of [-0.9, 0.9]) {
          const c = alongX ? [x0 + S / 2, -0.17, z0 + S / 2 + o] : [x0 + S / 2 + o, -0.17, z0 + S / 2];
          g.box('prop_wood', { c, s: alongX ? [S, 0.22, 0.2] : [0.2, 0.22, S], uv: 'along', tint: [0.45, 0.4, 0.35], ao: 0.5 });
        }
        spots.floorCells.push({ x, y, cell, covered: false, pier: true });
        continue;
      }
      const street = !indoor && cell === CELL.STREET;
      const sub = street ? 8 : SUB;
      const Y = (px, pz) => fy + (street ? crownAt(px, pz) : 0);
      for (let j = 0; j < sub; j++) {
        if (cell === CELL.WATER && map.harbour) break; // the open sea plane runs under the quay
        for (let i = 0; i < sub; i++) {
          const ax = x0 + (i / sub) * S;
          const bx = x0 + ((i + 1) / sub) * S;
          const az = z0 + (j / sub) * S;
          const bz = z0 + ((j + 1) / sub) * S;
          g.quad(key, new THREE.Vector3(ax, Y(ax, bz), bz), new THREE.Vector3(bx, Y(bx, bz), bz), new THREE.Vector3(bx, Y(bx, az), az), new THREE.Vector3(ax, Y(ax, az), az), null, { ao: aoF });
        }
      }
      if (!indoor && (cell === CELL.STREET || cell === CELL.COURTYARD)) {
        // sand, grit and leaf litter swept against the wall feet (on the paving, in the joints)
        for (const [d, has] of [['N', wallN], ['S', wallS], ['W', wallW], ['E', wallE]]) {
          if (!has) continue;
          const reach = 0.55 + hash(map.id, x, y, d, 'dr') * 0.45;
          const P = (a, b) => {
            // a: along the wall 0..S, b: distance from the wall face
            const off = T / 2 + b;
            const px = d === 'W' ? x0 + off : d === 'E' ? x0 + S - off : x0 + a;
            const pz = d === 'N' ? z0 + off : d === 'S' ? z0 + S - off : z0 + a;
            return new THREE.Vector3(px, Y(px, pz) + 0.006, pz);
          };
          const uo = hash(map.id, x, y, d, 'du') * 4;
          groundDecals.dirt.push([[P(0, 0), P(S, 0), P(S, reach), P(0, reach)], [[uo, 0], [uo + S / 2, 0], [uo + S / 2, 1], [uo, 1]]]);
        }
        // cart ruts worn along the run of a street: two polished, darker tracks
        const runX = (wallN || wallS) && !(wallW && wallE);
        const runZ = (wallW || wallE) && !(wallN && wallS);
        if (street && runX !== runZ) {
          for (const o of [-0.62, 0.62]) {
            const w = 0.34;
            const ctr = S / 2 + o + (hash(map.id, runX ? y : x, o, 'rw') - 0.5) * 0.12;
            const P = (a, b) => {
              const px = runX ? x0 + a : x0 + b;
              const pz = runX ? z0 + b : z0 + a;
              return new THREE.Vector3(px, Y(px, pz) + 0.005, pz);
            };
            const n = 4;
            for (let k = 0; k < n; k++) {
              const a0 = (k / n) * S;
              const a1 = ((k + 1) / n) * S;
              const ua = (runX ? x0 : z0) + a0;
              const ub = (runX ? x0 : z0) + a1;
              groundDecals.rut.push([[P(a0, ctr - w / 2), P(a1, ctr - w / 2), P(a1, ctr + w / 2), P(a0, ctr + w / 2)], [[ua / 3, 0], [ub / 3, 0], [ub / 3, 1], [ua / 3, 1]]]);
            }
          }
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
      // a kerb of long edging stones where the courtyard paving meets the street cobbles
      if (cell === CELL.COURTYARD && !indoor) {
        for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
          if (map.getEdge(x, y, d) !== EDGE.OPEN || map.getCell(x + dx, y + dy) !== CELL.STREET) continue;
          let a = 0;
          for (let k = 0; a < S - 0.05; k++) {
            const len = Math.min(S - a, 0.55 + hash(map.id, x, y, d, k, 'kl') * 0.5);
            const hgt = 0.05 + hash(map.id, x, y, d, k, 'kh') * 0.035;
            const along = a + len / 2;
            const inset = 0.16;
            const cxk = dx ? x0 + (dx > 0 ? S - inset : inset) : x0 + along;
            const czk = dy ? z0 + (dy > 0 ? S - inset : inset) : z0 + along;
            g.box('arch_trim', { c: [cxk, hgt / 2 - 0.01, czk], s: dx ? [0.34, hgt + 0.02, len - 0.03] : [len - 0.03, hgt + 0.02, 0.34], rotY: (hash(map.id, x, y, d, k, 'kr') - 0.5) * 0.04, chamfer: 0.035, tint: [0.95, 0.92, 0.86], ao: (p, n) => (n.y > 0.5 ? 0.95 : 0.6) });
            a += len;
          }
        }
      }
      // ceiling
      const ceilKey = indoor ? ts.ceiling : cov ? 'arch_ceiling' : null;
      if (ceilKey) {
        const ch = indoor ? ceilH : ceilH;
        g.quad(ceilKey, new THREE.Vector3(x0, ch, z0), new THREE.Vector3(x0 + S, ch, z0), new THREE.Vector3(x0 + S, ch, z0 + S), new THREE.Vector3(x0, ch, z0 + S), null, { ao: 0.8 });
        if (ts.variant === 'warrens') {
          // natural rock roof: no ribs; the dressing pass hangs roots and lumps from it
        } else if (ts.variant === 'bane') {
          baneVault(x, y, ch);
        } else if (ts.id === 'dungeon') {
          // stone ribs across open cell boundaries (N and W) → rhythmic vaulting; the cross ribs
          // vary cell to cell (some missing, some fallen to a single beam) so the vault never repeats
          const rk = ts.variant === 'bane' ? 'arch_basalt' : 'arch_dungeon';
          for (const [d, horiz] of [['N', true], ['W', false]]) {
            if (map.getEdge(x, y, d) !== EDGE.OPEN) continue;
            if (horiz) g.box(rk, { c: [x0 + S / 2, ch - 0.22, z0], s: [S + T, 0.44, 0.5], chamfer: 0.06, ao: 0.75 });
            else g.box(rk, { c: [x0, ch - 0.22, z0 + S / 2], s: [0.5, 0.44, S + T], chamfer: 0.06, ao: 0.75 });
            // the rib springs from stepped stone corbels on the walls (it is carried, never floating)
            for (const end of [-1, 1]) {
              const wallSide = horiz ? (end < 0 ? 'W' : 'E') : end < 0 ? 'N' : 'S';
              if (map.getEdge(x, y, wallSide) === EDGE.OPEN) continue;
              const face = (end < 0 ? 0 : S) + end * -(T / 2);
              for (const [dy, out, hh, wd] of [[0.0, 0.32, 0.22, 0.56], [0.22, 0.2, 0.18, 0.46], [0.4, 0.1, 0.14, 0.36]]) {
                const yc = ch - 0.44 - dy - hh / 2;
                const ctr = face - end * out / 2;
                if (horiz) g.box('arch_trim', { c: [x0 + ctr, yc, z0], s: [out, hh, wd], chamfer: 0.025, ao: 0.7, tint: [0.62, 0.6, 0.57] });
                else g.box('arch_trim', { c: [x0, yc, z0 + ctr], s: [wd, hh, out], chamfer: 0.025, ao: 0.7, tint: [0.62, 0.6, 0.57] });
              }
            }
          }
          const cv = hash(map.id, x, y, 'vault');
          if (cv < 0.45) {
            g.box(rk, { c: [x0 + S / 2, ch - 0.12, z0 + S / 2], s: [0.28, 0.24, S], chamfer: 0.04, ao: 0.7 });
            g.box(rk, { c: [x0 + S / 2, ch - 0.12, z0 + S / 2], s: [S, 0.24, 0.28], chamfer: 0.04, ao: 0.7 });
            g.box(rk, { c: [x0 + S / 2, ch - 0.2, z0 + S / 2], s: [0.46, 0.2, 0.46], chamfer: 0.06, ao: 0.7, tint: [0.85, 0.82, 0.8] }); // boss
          } else if (cv < 0.7) {
            const ax = hash(map.id, x, y, 'vax') < 0.5;
            g.box(rk, { c: [x0 + S / 2, ch - 0.12, z0 + S / 2], s: ax ? [S, 0.24, 0.3] : [0.3, 0.24, S], chamfer: 0.04, ao: 0.7 });
          }
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

  /**
   * A ribbed groin vault over one cell of the Temple of Bane: two intersecting barrels (the ceiling
   * is the higher of the two at each point), so semicircular lunettes meet the walls and the webs
   * fold down along the diagonals. Heavy chamfered ribs follow both groins and every transverse arch
   * over an open cell boundary, with a carved boss at the crown.
   */
  function baneVault(x, y, ch) {
    const x0 = x * S;
    const z0 = y * S;
    const rise = BANE_VAULT_RISE;
    const base = ch - rise - 0.05;
    const hw = S / 2;
    const vy = (u, v) => base + rise * Math.max(Math.sqrt(Math.max(0, 1 - u * u)), Math.sqrt(Math.max(0, 1 - v * v)));
    const N = 14;
    const P = (u, v) => new THREE.Vector3(x0 + hw + u * hw, vy(u, v), z0 + hw + v * hw);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u0 = -1 + (2 * i) / N;
        const u1 = -1 + (2 * (i + 1)) / N;
        const v0 = -1 + (2 * j) / N;
        const v1 = -1 + (2 * (j + 1)) / N;
        // faces down (seen from below)
        // the webs are rubble rendered over and limewashed, long since smoked dark (stone ribs carry them)
        // coursed basalt rubble webs, smoke-blackened toward the crown (never a pale lit panel)
        // one continuous projection across the whole vault (per-quad planar UVs flip axis on the
        // curved webs and turn the courses into a patchwork of tiles)
        const q4 = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
        const vuv = q4.map((p) => [(p.x + (p.y - base) * 0.6 * Math.sign(p.x - x0 - hw)) / 2.2, (p.z + (p.y - base) * 0.6 * Math.sign(p.z - z0 - hw)) / 2.2]);
        g.quad('arch_basalt_vault', q4[0], q4[1], q4[2], q4[3], vuv, { tint: [0.8, 0.8, 0.78], ao: (p) => 0.8 - 0.35 * THREE.MathUtils.smoothstep(p.y, base, ch - 0.1) });
      }
    }
    // ribs: short chamfered segments following a curve
    const rib = (pts, w, d) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const mid = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -d / 2 + 0.02, 0));
        const dir = b.clone().sub(a);
        const len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
        g.box('arch_basalt_vault', { matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), s: [len + 0.03, d, w], chamfer: 0.03, tint: [1.35, 1.3, 1.3], ao: 0.9 });
      }
    };
    const M = 16;
    for (const sgn of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= M; k++) {
        const t = -1 + (2 * k) / M;
        pts.push(P(t * 0.999, sgn * t * 0.999));
      }
      rib(pts, 0.16, 0.14);
    }
    for (const [d, horiz, sgn] of [['N', true, -1], ['W', false, -1], ['S', true, 1], ['E', false, 1]]) {
      if (map.getEdge(x, y, d) !== EDGE.OPEN) continue;
      if (sgn > 0 && (d === 'S' ? y + 1 < Hh : x + 1 < W)) continue; // shared arches drawn once (by the N/W cell)
      const pts = [];
      for (let k = 0; k <= M; k++) {
        const t = -1 + (2 * k) / M;
        pts.push(horiz ? P(t, sgn * 0.999) : P(sgn * 0.999, t));
      }
      rib(pts, 0.34, 0.2);
    }
    // carved boss at the crown
    const boss = new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    g.geometry('arch_basalt_vault', boss, new THREE.Matrix4().makeTranslation(x0 + hw, ch - 0.06, z0 + hw), { uv: 'world', tint: [0.9, 0.85, 0.85], ao: 0.8 });
    boss.dispose();
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
      const top = type === EDGE.ARCH ? ARCH_SPRING + ARCH_W / 2 + 0.55 : DOOR_H + 0.78;
      const f = { basis };
      localBox(f, 'arch_trim', -1.05, 1.05, top - 0.06, top + 0.52, T / 2 - 0.02, T / 2 + 0.07, { chamfer: 0.03 });
      const ruinPlaque = ts.id === 'ruins' || !!compAt(ev.x + dx, ev.y + dy)?.partRuin;
      const mat = new THREE.MeshStandardMaterial({ map: getInscriptionTexture(m[1].toUpperCase(), { weathered: ruinPlaque }), normalMap: getInscriptionNormal(m[1].toUpperCase()), normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.92, alphaTest: 0.5 });
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
    // a temple's roof ends behind its raking cornice (the sima hides the tile edge) and barely overhangs
    const oh = c.temple ? 0.22 : 0.5;
    const rise = spanB * Math.tan(pitch);
    const cx = (X0 + X1) / 2;
    const cz = (Z0 + Z1) / 2;
    // local roof frame: A along ridge, B across, y up
    const A = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const B = alongX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0);
    const P = (a, yy, b) => new THREE.Vector3(cx, yy, cz).addScaledVector(A, a).addScaledVector(B, b);
    const L = spanA + off + (c.temple ? 0.04 : 0.35);
    // gutted ruins keep only the front of the roof; the rest is bare, charred structure
    const fv = { N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], W: [-1, 0, 0] }[c.frontDir] ?? [0, 0, 1];
    const frontSign = Math.sign(A.x * fv[0] + A.z * fv[2]) || 1;
    const gut = c.partRuin;
    const keep = Math.min(L, 1.6);
    const aLo = gut ? (frontSign > 0 ? L - keep : -L) : -L;
    const aHi = gut ? (frontSign > 0 ? L : -L + keep) : L;
    const brkSide = gut ? (hash(c.id, 'brk') < 0.5 ? -1 : 1) : 0;
    if (gut) c.pedimentBreak = brkSide;
    const rk = c.roofKind;
    const tsR = 2;
    const th = 0.16;
    const slopeLen = Math.hypot(spanB + oh, rise + oh * Math.tan(pitch));
    for (const sb of [-1, 1]) {
      if (sb === brkSide) continue; // that slope fell in with the pediment's broken half
      const eaveB = sb * (spanB + oh);
      const eaveY = He - oh * Math.tan(pitch);
      const r0 = P(aLo, He + rise, 0);
      const r1 = P(aHi, He + rise, 0);
      const e0 = P(aLo, eaveY, eaveB);
      const e1 = P(aHi, eaveY, eaveB);
      // top surface (normal outward/up)
      const nrm = new THREE.Vector3().subVectors(e0, r0).cross(new THREE.Vector3().subVectors(r1, r0));
      const up = nrm.y < 0;
      const uvs = [[aLo / tsR, 0], [aHi / tsR, 0], [aHi / tsR, slopeLen / tsR], [aLo / tsR, slopeLen / tsR]];
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
      // eave course: a row of tile ends overhanging the fascia (reads as tiles, not a slab)
      for (let a = aLo + 0.12; a < aHi - 0.1; a += 0.26) {
        const ctr = P(a, eaveY + th + 0.01, eaveB + sb * 0.03);
        const m = new THREE.Matrix4().compose(ctr, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), A), new THREE.Vector3(1, 1, 1));
        m.multiply(new THREE.Matrix4().makeRotationX(-sb * pitch));
        g.box(rk, { matrix: m, s: [0.24, 0.05 + hash(c.id, a, sb, 'et') * 0.02, 0.32], ao: 0.85 });
      }
      // barge boards along the gable edges
      for (const sa of [-1, 1]) {
        if (gut && sa !== frontSign) continue;
        if (c.temple) continue; // the stone raking cornice is the verge
        const a0 = P(sa * (L + 0.02), He + rise + th / 2, 0);
        const a1 = P(sa * (L + 0.02), eaveY + th / 2, eaveB);
        alongBox('arch_beam_dark', a0, a1, A, [0.08, 0.3], { uv: 'along', ao: 0.8 });
        // verge: the tile courses show their ends along the gable edge, each course lapping the next
        const n = Math.max(3, Math.round(a0.distanceTo(a1) / 0.3));
        for (let k = 0; k < n; k++) {
          const t0 = k / n;
          const t1 = (k + 1.15) / n;
          const v0 = a0.clone().lerp(a1, t0).add(new THREE.Vector3(0, th * 0.55 + (k % 2) * 0.01, 0)).addScaledVector(A, sa * 0.03);
          const v1 = a0.clone().lerp(a1, Math.min(1, t1)).add(new THREE.Vector3(0, th * 0.55, 0)).addScaledVector(A, sa * 0.03);
          alongBox(rk, v0, v1, A, [0.14 + hash(c.id, sb, sa, k, 'vt') * 0.03, 0.06], { ao: 0.85 });
        }
      }
      // rafter tails under the eave
      for (let a = -spanA + 0.2; a < spanA; a += 0.6) {
        if (a < aLo || a > aHi) continue;
        const p0 = P(a, He - 0.05, sb * (spanB - 0.1));
        const p1 = P(a, eaveY + 0.02, sb * (spanB + oh - 0.05));
        alongBox('arch_beam_dark', p0, p1, A, [0.09, 0.12], { uv: 'along', ao: 0.55 });
      }
    }
    // ridge cap
    {
      const m = new THREE.Matrix4().compose(P(0, He + rise + th + 0.05, 0), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), A), new THREE.Vector3(1, 1, 1));
      if (gut) m.multiply(new THREE.Matrix4().makeTranslation((aLo + aHi) / 2, 0, 0));
      g.box(rk === 'arch_roof_clay' ? 'arch_roof_clay' : 'arch_trim', { matrix: m, s: [aHi - aLo + 0.05, 0.16, 0.34], chamfer: 0.05, ao: 0.9 });
    }
    if (gut) gutted(c, P, A, { aLo, aHi, L, spanA, spanB, He, rise, eaveY: He - oh * Math.tan(pitch), oh, frontSign, rk, brkSide });
    // gable walls
    const gKey = timber ? 'arch_plaster' : c.style === 2 ? 'arch_ruin' : 'arch_stone';
    for (const sa of [-1, 1]) {
      if (gut && sa !== frontSign) continue; // the back gable has fallen with the roof
      const aa = sa * (spanA + off);
      const q0 = P(aa, He, -spanB);
      const q1 = P(aa, He, spanB);
      const q2 = P(aa, He + rise, 0);
      const n = new THREE.Vector3().subVectors(q1, q0).cross(new THREE.Vector3().subVectors(q2, q0));
      const outward = A.clone().multiplyScalar(sa);
      const orient = (t) => {
        const nn = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
        return nn.dot(outward) > 0 ? t : [t[0], t[2], t[1]];
      };
      const gableTris = [];
      if (gut) {
        // broken pediment: one half stands to the apex, the other has fallen to a ragged stepped edge
        const qm = P(aa, He, 0);
        const brk = brkSide;
        const qEave = brk > 0 ? q1 : q0;
        const qKeep = brk > 0 ? q0 : q1;
        gableTris.push(orient([qKeep, qm, q2]));
        const steps = 4;
        let prev = qm.clone().setY(He + rise * 0.62);
        gableTris.push(orient([qm, prev, P(aa, He, brk * spanB * 0.25)]));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const b = brk * spanB * t;
          const yTop = He + rise * 0.62 * (1 - t) * (0.75 + 0.25 * hash(c.id, k, 'pst')) + (k === steps ? 0.2 : 0);
          const pTop = P(aa, yTop, b);
          gableTris.push(orient([P(aa, He, b - brk * spanB / steps), prev, pTop]));
          gableTris.push(orient([P(aa, He, b - brk * spanB / steps), pTop, P(aa, He, b)]));
          prev = pTop;
        }
        void qEave;
        c.pedimentBreak = brk;
      } else gableTris.push(n.dot(outward) > 0 ? [q0, q1, q2] : [q0, q2, q1]);
      const tri = gableTris[0];
      for (const t of gableTris) {
        g.tri(gKey, t, null, { ao: 0.95, tint: timber ? c.tint : undefined, uvOff: [hash(c.id, sa, x, y, 'gu') * 9.1, hash(c.id, sa, 'gv') * 3.3] });
        // back side (attic) to avoid see-through from odd angles
        const back = t.map((p) => p.clone().addScaledVector(outward, -0.15));
        g.tri(gKey, [back[0], back[2], back[1]], null, { ao: 0.4 });
        if (gut) {
          // the broken half must read from either winding (stepped rubble face)
          const fr = t.map((p) => p.clone().addScaledVector(outward, 0.004));
          g.tri(gKey, [fr[0], fr[2], fr[1]], null, { ao: 0.9, uvOff: [hash(c.id, sa, 'gu2') * 9.1, 1.7] });
        }
      }
      void tri;
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
          let a1 = apex.clone().add(new THREE.Vector3(0, 0.12, 0)).add(out(0.14));
          if (gut && sb === c.pedimentBreak) {
            // the raking cornice on the fallen side is gone: a few of its stones still lie where they
            // slid onto the horizontal cornice (resting on it, fractured), the rest are on the ground
            for (let k = 0; k < 3; k++) {
              const bb = sb * spanB * (0.28 + k * 0.26 + hash(c.id, k, 'rbb') * 0.08);
              const sz = [0.5 + hash(c.id, k, 'rsx') * 0.35, 0.22 + hash(c.id, k, 'rsy') * 0.1, 0.34];
              const rp = P(aa, He + 0.12 + 0.17 + sz[1] * 0.4, bb).add(out(0.12 + hash(c.id, k, 'rso') * 0.1));
              const rq = new THREE.Quaternion().setFromEuler(new THREE.Euler((hash(c.id, k, 'rrx') - 0.5) * 0.3, Math.atan2(outward.x, outward.z) + (hash(c.id, k, 'rry') - 0.5) * 0.5, (hash(c.id, k, 'rrz') - 0.5) * 0.5));
              const rg = roughBlockGeometry(sz[0], sz[1], sz[2], { bevel: 0.03, amp: 0.02, seed: hash(c.id, k, 'rgs') * 100, chip: 0.06 });
              g.geometry('arch_dressed', rg, new THREE.Matrix4().compose(rp, rq, new THREE.Vector3(1, 1, 1)), { uv: 'world', ao: 0.8 });
              rg.dispose();
            }
            // a snapped stub of the raking cornice still runs down from the apex, its end broken
            // off raw, so the collapse reads as damage to a complete pediment
            {
              const stubEnd = a1.clone().lerp(e0, 0.3 + hash(c.id, 'stub') * 0.08);
              alongBox('arch_trim', a1, stubEnd, outward, [0.42, 0.32], { chamfer: 0.04, ao: 0.95 });
              const bm = new THREE.Matrix4().compose(stubEnd.clone().add(new THREE.Vector3(0, -0.04, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, Math.atan2(outward.x, outward.z), 0.5)), new THREE.Vector3(1, 1, 1));
              const sg = roughBlockGeometry(0.34, 0.3, 0.36, { bevel: 0.02, amp: 0.03, seed: hash(c.id, 'stg') * 50, chip: 0.1 });
              g.geometry('prop_rock', sg, bm, { uv: 'world', ao: 0.75 });
              sg.dispose();
            }
            // the broken tympanum edge shows its rubble core: rough lumps along the stepped break
            for (let k = 0; k < 5; k++) {
              const t = (k + 0.5) / 5;
              const yTop = He + rise * 0.62 * (1 - t) * 0.85 + 0.05;
              const cp = P(aa, yTop, sb * spanB * t).add(out(-0.06));
              const rg = roughBlockGeometry(0.32, 0.2, 0.26, { bevel: 0.02, amp: 0.04, seed: hash(c.id, k, 'core') * 80, chip: 0.12 });
              g.geometry('prop_rock', rg, new THREE.Matrix4().compose(cp, new THREE.Quaternion().setFromEuler(new THREE.Euler(hash(c.id, k, 'cx') - 0.5, hash(c.id, k, 'cy') * 3, hash(c.id, k, 'cz') - 0.5)), new THREE.Vector3(1, 1, 1)), { uv: 'world', ao: 0.7 });
              rg.dispose();
            }
            a1 = null;
            // the fallen half lies heaped below: big dressed cornice blocks on top of a skirt of
            // smaller broken stone and grit spilling onto the paving
            for (let k = 0; k < 9; k++) {
              const big = k < 3;
              const fb = P(aa, big ? 0.24 + k * 0.08 : 0.08 + hash(c.id, k, 'fy0') * 0.1, sb * (spanB * (0.2 + hash(c.id, k, 'fbs') * 0.75))).add(out(0.6 + hash(c.id, k, 'fbo') * (big ? 0.9 : 1.6)));
              const fm = new THREE.Matrix4().compose(fb, new THREE.Quaternion().setFromEuler(new THREE.Euler(hash(c.id, k, 'fx') - 0.5, hash(c.id, k, 'fy') * 3, (hash(c.id, k, 'fz') - 0.5) * 0.6)), new THREE.Vector3(1, 1, 1));
              if (big) g.box('arch_dressed', { matrix: fm, s: [0.9, 0.36, 0.42], chamfer: 0.04, ao: 0.75 });
              else {
                const sz = 0.18 + hash(c.id, k, 'fsz') * 0.22;
                const rg = roughBlockGeometry(sz * 1.4, sz * 0.8, sz, { bevel: 0.02, amp: 0.03, seed: hash(c.id, k, 'frg') * 60, chip: 0.1 });
                g.geometry('prop_rock', rg, fm, { uv: 'world', ao: 0.7 });
                rg.dispose();
              }
            }
          }
          if (a1) alongBox('arch_trim', e0, a1, outward, [0.42, 0.32], { chamfer: 0.04, ao: 0.95 });
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
          if (!gut) g.box('arch_trim', { matrix: am, s: [0.46, 0.5, 0.4], chamfer: 0.06, ao: 0.95 });
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
          if (night > 0.3 && hash(c.id, sa, 'atl') < 0.75) {
            // an attic light: someone is still up under the roof (warm glazing in a stone frame)
            const pc = (u, v) => new THREE.Vector3(u, v, 0.035).applyMatrix4(mm);
            panes.quad('win_ext', pc(-0.24, -0.34), pc(0.24, -0.34), pc(0.24, 0.34), pc(-0.24, 0.34), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
            for (const [cx2, cy2, sx2, sy2] of [[-0.28, 0, 0.08, 0.78], [0.28, 0, 0.08, 0.78], [0, 0.38, 0.64, 0.08], [0, 0, 0.04, 0.7], [0, 0.05, 0.5, 0.035]]) g.box('arch_beam_dark', { matrix: mm.clone().multiply(new THREE.Matrix4().makeTranslation(cx2, cy2, 0.04)), s: [sx2, sy2, 0.06], ao: 0.7 });
          } else g.box('arch_beam_dark', { matrix: mm, s: [0.5, 0.7, 0.06], ao: 0.4 });
          g.box('arch_trim', { matrix: mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.4, 0.02)), s: [0.7, 0.1, 0.12], chamfer: 0.02 });
        }
      }
    }
    // chimney
    if (!gut && hash(c.id, x, y, 'chim') < 0.7) {
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

  /**
   * The fallen part of a gutted roof: charred rafter pairs (some missing, some snapped and
   * hanging), broken purlins and ridge, and a ragged edge of slipped tiles where the roof ends.
   */
  function gutted(c, P, A, o) {
    const { aLo, aHi, L, spanB, He, rise, eaveY, oh, frontSign, rk, brkSide } = o;
    const char = [0.48, 0.42, 0.38];
    const from0 = frontSign > 0 ? aLo : aHi;
    const to = frontSign > 0 ? -L : L;
    const front = frontSign > 0 ? L - 0.3 : -L + 0.3;
    const step = 0.7 * Math.sign(to - from0);
    let k = 0;
    // on the fallen side the bare rafters run right up to the front gable
    for (let a = front + step * 0.5; Math.abs(a - front) < Math.abs(to - front) - 0.2; a += step, k++) {
      const miss = hash(c.id, k, 'gm');
      if (miss < 0.3) continue;
      for (const sb of [-1, 1]) {
        if (sb !== brkSide && Math.abs(a - front) < Math.abs(from0 - front)) continue;
        if (hash(c.id, k, sb, 'gs') < 0.2) continue;
        const snapped = hash(c.id, k, sb, 'gn') < 0.35;
        const p0 = P(a, He + 0.05, sb * spanB);
        let p1 = P(a, He + rise - 0.1, 0);
        if (snapped) {
          // snapped halfway: the stub droops toward the floor
          const mid = p0.clone().lerp(p1, 0.5 + hash(c.id, k, sb, 'gl') * 0.2);
          p1 = mid.add(new THREE.Vector3(0, -0.5 - hash(c.id, k, 'gd') * 0.6, 0));
        }
        alongBox('arch_beam_dark', p0, p1, A, [0.12, 0.16], { uv: 'along', ao: 0.7, tint: char });
      }
    }
    // purlins: one per slope, broken off short of the far gable
    const from = from0;
    for (const sb of [-1, 1]) {
      const len = (0.35 + hash(c.id, sb, 'pl') * 0.5) * Math.abs(to - from);
      const p0 = P(from, He + rise * 0.5, sb * spanB * 0.5);
      const p1 = P(from + Math.sign(to - from) * len, He + rise * 0.5 - hash(c.id, sb, 'pd') * 0.6, sb * spanB * 0.5);
      alongBox('arch_beam_dark', p0, p1, new THREE.Vector3(0, 1, 0), [0.16, 0.16], { uv: 'along', ao: 0.7, tint: char });
    }
    {
      const len = (0.5 + hash(c.id, 'rl') * 0.3) * Math.abs(to - from);
      alongBox('arch_beam_dark', P(from, He + rise - 0.05, 0), P(from + Math.sign(to - from) * len, He + rise - 0.25, 0), new THREE.Vector3(0, 1, 0), [0.2, 0.2], { uv: 'along', ao: 0.7, tint: char });
    }
    // ragged edge of the surviving roof: slipped tile slabs along the break
    const slope = Math.hypot(spanB + oh, rise + (He - eaveY));
    for (const sb of [-1, 1]) {
      if (sb === brkSide) continue;
      for (let q = 0; q < 7; q++) {
        const t = (q + hash(c.id, sb, q, 'tt')) / 7;
        const b = sb * (spanB + oh) * (1 - t);
        const y = eaveY + (He + rise - eaveY) * t + 0.12;
        const a = from + Math.sign(to - from) * (0.15 + hash(c.id, sb, q, 'ta') * 0.6);
        const ctr = P(a, y, b);
        const m = new THREE.Matrix4().compose(ctr, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), A), new THREE.Vector3(1, 1, 1));
        m.multiply(new THREE.Matrix4().makeRotationX(-sb * Math.atan2(rise, spanB))).multiply(new THREE.Matrix4().makeRotationY((hash(c.id, sb, q, 'tr') - 0.5) * 0.5));
        g.box(rk, { matrix: m, s: [0.5 + hash(c.id, sb, q, 'tw') * 0.4, 0.06, 0.45], ao: 0.8 });
      }
    }
    void slope;
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
  if (sootQuads.length) {
    const sb = new GeoBuilder();
    for (const q of sootQuads) sb.quad('soot', q[0], q[1], q[2], q[3], [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    const geo = sb.build().get('soot');
    geo.deleteAttribute('color');
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0806, alphaMap: getScorchTexture(), transparent: true, opacity: 0.78, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.userData.ownMaterial = true;
    group.add(mesh);
  }
  for (const [list, tex, col, op, key] of [[runQuads, getRunoffTexture(), 0x15120d, 0.82, 'runoff'], [plinthQuads, getPlinthGrimeTexture(), 0x1f1810, 0.8, 'plinth']]) {
    if (!list.length) continue;
    const sb = new GeoBuilder();
    for (const [q, uv] of list) sb.quad(key, q[0], q[1], q[2], q[3], uv, { ao: 1 });
    const geo = sb.build().get(key);
    geo.deleteAttribute('color');
    const mat = new THREE.MeshStandardMaterial({ color: col, alphaMap: tex, transparent: true, opacity: op, depthWrite: false, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.userData.ownMaterial = true;
    group.add(mesh);
  }
  for (const [kind, tex, col, op, rough] of [['dirt', getPlinthGrimeTexture(), 0x4a3c2a, 0.55, 0.98], ['rut', getRutTexture(), 0x16130f, 0.5, 0.42]]) {
    const list = groundDecals[kind];
    if (!list.length) continue;
    const sb = new GeoBuilder();
    for (const [q, uv] of list) sb.quad(kind, q[0], q[3], q[2], q[1], [uv[0], uv[3], uv[2], uv[1]], { ao: 1 });
    const geo = sb.build().get(kind);
    geo.deleteAttribute('color');
    const mat = new THREE.MeshStandardMaterial({ color: col, alphaMap: tex, transparent: true, opacity: op, depthWrite: false, roughness: rough, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.receiveShadow = true;
    mesh.userData.ownMaterial = true;
    group.add(mesh);
  }
  if (torchSpill.length) {
    const sb = new GeoBuilder();
    for (const q of torchSpill) sb.quad('tspill', q[0], q[1], q[2], q[3], [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    const geo = sb.build().get('tspill');
    geo.deleteAttribute('color');
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ts.variant === 'bane' ? 0x56c860 : 0xff8a3a).multiplyScalar(ts.variant === 'bane' ? 0.1 : indoor ? 0.22 : 0.12 + 0.1 * night), map: getBlobTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    mesh.userData.ownMaterial = true;
    group.add(mesh);
  }
  if (spillQuads.length) {
    const sb = new GeoBuilder();
    for (const q of spillQuads) sb.quad('spill', q[0], q[1], q[2], q[3], [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    const geo = sb.build().get('spill');
    geo.deleteAttribute('color');
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a48).multiplyScalar(0.06 + 0.12 * night), map: getBlobTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    mesh.userData.ownMaterial = true;
    group.add(mesh);
  }
  for (const [key, geo] of panes.build()) {
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, getWindowMaterial(key === 'win_ext' ? 'ext' : 'int'));
    mesh.name = key;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  // shadow-only core inside every roofed building: the shells are hollow, so a low sun would
  // otherwise shine in at one opening and out of another and print bright rectangles on the
  // street. Invisible (no colour/depth writes); it only blocks the sun in the shadow pass.
  if (!indoor) {
    const boxes = [];
    for (const c of comps) {
      if (c.ruined) continue;
      for (const [cx, cy] of c.cells) {
        const own = (dx, dy) => compAt(cx + dx, cy + dy) === c;
        const x0 = cx * S + (own(-1, 0) ? 0 : T / 2 + 0.12);
        const x1 = (cx + 1) * S - (own(1, 0) ? 0 : T / 2 + 0.12);
        const z0 = cy * S + (own(0, -1) ? 0 : T / 2 + 0.12);
        const z1 = (cy + 1) * S - (own(0, 1) ? 0 : T / 2 + 0.12);
        const bx = new THREE.BoxGeometry(x1 - x0, c.H - 0.5, z1 - z0);
        bx.translate((x0 + x1) / 2, 0.15 + (c.H - 0.5) / 2, (z0 + z1) / 2);
        boxes.push(bx);
      }
    }
    if (boxes.length) {
      const pos = [];
      for (const b of boxes) {
        const ng = b.toNonIndexed();
        pos.push(...ng.attributes.position.array);
        ng.dispose();
        b.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
      core.castShadow = true;
      core.frustumCulled = false;
      core.userData.ownMaterial = true;
      core.name = 'shadow_core';
      group.add(core);
    }
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
  return { group, doors, torches, windows, chimneys, spots, tileset: ts, meshes, comps, compAt, covered, heightAt, crownAt };
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
