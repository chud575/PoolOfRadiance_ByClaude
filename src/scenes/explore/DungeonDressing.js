import * as THREE from 'three';
import { CELL, EDGE } from '../../data/maps/MapGrid.js';
import { getMaterial } from '../../render/materials.js';
import { getBaneBannerTexture, getRunnerTexture, getBlobTexture, getSoftTexture, getAltarClothTexture, getAltarClothORM } from '../../render/textures/index.js';
import { GeoBuilder, roughBlockGeometry, hash } from './GeoBuilder.js';
import { CELL_SIZE, WALL_T } from './BlockBuilder.js';
import { fracturedRock, PROP_UNIFORMS } from './Props.js';

const S = CELL_SIZE;
const T = WALL_T;
const M4 = () => new THREE.Matrix4();
const tr = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Unholy fire of Bane's braziers and sconces. */
export const BANE_FLAME = 0x6cff4a;
export const BANE_LIGHT = 0x86e07a;

/**
 * Themed dressing for dungeon tileset variants (explore-renderer):
 *  - 'warrens': rock lumps and outcrops, hanging roots, ceiling knuckles,
 *    a stone-lined water runnel along corridors, kobold refuse (bone piles,
 *    potsherds, rag nests, skull-topped stakes).
 *  - 'bane': crimson banners of the Black Hand, green-fire braziers, a
 *    processional runner and the altar of the sanctum with its stele.
 * @returns {{group: THREE.Group, lamps: any[], dispose: () => void}}
 */
export function dressDungeon(map, block, opts = {}) {
  const ts = block.tileset;
  const group = new THREE.Group();
  group.name = 'dressing';
  const own = [];
  const lamps = [];
  const g = new GeoBuilder();
  const blobs = [];
  const haloQuads = [];
  const runnelQuads = [];
  const rocks = [0, 1, 2, 3, 4].map((k) => fracturedRock(40 + k, false));
  const chunks = [0, 1, 2].map((k) => fracturedRock(60 + k, true));
  own.push(...rocks, ...chunks);
  const P = (f, s, y, d) => new THREE.Vector3(s, y, d).applyMatrix4(f.basis);
  const onFace = (f, s, y, d) => new THREE.Matrix4().multiplyMatrices(f.basis, tr(s, y, d));

  if (ts.variant === 'warrens') warrens();
  else if (ts.variant === 'bane') bane();

  /**
   * Hewn faces are flat slabs; this lays a displaced rock skin over each one: pick-scarred bulges and
   * hollows (up to ~25 cm proud), tapering flat at the face ends, the roof and around openings so it
   * always meets the neighbouring geometry cleanly. Noise is seeded in world space → no two walls match.
   */
  function rockSkin(f) {
    const H = f.H;
    const nS = 16;
    const nY = Math.max(8, Math.round(H * 3.5));
    const half = S / 2;
    const ops = f.openings;
    const vn = (x, y, sd) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const a = hash(sd, ix, iy);
      const b = hash(sd, ix + 1, iy);
      const c = hash(sd, ix, iy + 1);
      const d = hash(sd, ix + 1, iy + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
    const opDist = (s, y) => {
      let m = 9;
      for (const o of ops) {
        const dx = Math.max(o.s0 - s, 0, s - o.s1);
        const dy = Math.max(o.y0 - y, 0, y - o.y1);
        m = Math.min(m, Math.hypot(dx, dy));
      }
      return m;
    };
    const rockN = (w, y) => {
      const n = vn(w * 1.1, y * 1.3, 'rk1') * 0.55 + vn(w * 2.9, y * 3.1, 'rk2') * 0.3 + vn(w * 7, y * 6.5, 'rk3') * 0.15;
      return Math.max(0, n - 0.3) / 0.7; // flat floors between bulges
    };
    const inOp = (s, y) => ops.some((o) => s > o.s0 && s < o.s1 && y > o.y0 && y < o.y1);
    const pos = [];
    const idx = [];
    const wp = new THREE.Vector3();
    for (let j = 0; j <= nY; j++) {
      for (let i = 0; i <= nS; i++) {
        const sv = -half + (S * i) / nS;
        const y = (H * j) / nY;
        wp.set(sv, y, 0).applyMatrix4(f.basis);
        const w = wp.x + wp.z; // along-wall world coordinate (faces are axis-aligned)
        const n = rockN(w, y);
        // horizontal pick-bench steps: the miners worked the face in lifts
        const lift = Math.abs(((y + vn(w * 0.8, 3, 'rk4') * 0.4) % 0.9) / 0.9 - 0.5) < 0.04 ? -0.025 : 0;
        const te = THREE.MathUtils.smoothstep(Math.min(sv + half, half - sv), 0.05, 0.55);
        const tr2 = THREE.MathUtils.smoothstep(H - y, 0.0, 0.45) * (0.75 + 0.25 * THREE.MathUtils.smoothstep(y, 0, 0.3));
        const to = THREE.MathUtils.smoothstep(opDist(sv, y), 0.02, 0.4);
        const disp = (n * 0.42 + lift) * te * tr2 * to;
        pos.push(sv, y, T / 2 + 0.008 + Math.max(0, disp));
      }
    }
    for (let j = 0; j < nY; j++) {
      for (let i = 0; i < nS; i++) {
        const sc = -half + (S * (i + 0.5)) / nS;
        const yc = (H * (j + 0.5)) / nY;
        if (inOp(sc, yc)) continue;
        const a = j * (nS + 1) + i;
        const b = a + 1;
        const c = a + nS + 1;
        const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.geometry('arch_hewn', geo, f.basis, { uv: 'world', ao: (p) => (0.5 + 0.5 * Math.min(1, rockN(p.x + p.z, p.y) * 1.6)) * (0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, 0, 0.9)) * (0.75 + 0.25 * THREE.MathUtils.smoothstep(H - p.y, 0, 0.5)) });
    geo.dispose();
  }

  /** Smooth world-space value noise for the rock roof / corners. */
  function vn2(x, y, sd) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(sd, ix, iy);
    const b = hash(sd, ix + 1, iy);
    const c = hash(sd, ix, iy + 1);
    const d = hash(sd, ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /**
   * Hewn roof over one cell: a displaced grid hanging *below* the flat ceiling (so it always hides it),
   * world-space noise so neighbouring cells join seamlessly, and a rounded haunch wherever a wall
   * meets the roof — the tunnel reads as cut rock, not a box with a lid. Matte material (no glints).
   */
  function rockRoof(fc) {
    const ceil = ts.ceilH;
    const N = 12;
    const x0 = fc.x * S;
    const z0 = fc.y * S;
    const wallD = {};
    for (const d of ['N', 'S', 'W', 'E']) wallD[d] = map.getEdge(fc.x, fc.y, d) !== EDGE.OPEN;
    const haunch = (x, z) => {
      // distance to the nearest walled cell edge (metres)
      let m = 9;
      if (wallD.W) m = Math.min(m, x - x0);
      if (wallD.E) m = Math.min(m, x0 + S - x);
      if (wallD.N) m = Math.min(m, z - z0);
      if (wallD.S) m = Math.min(m, z0 + S - z);
      const reach = 0.5 + vn2(x * 1.3 + 7, z * 1.3, 'hr') * 0.9;
      const t = 1 - THREE.MathUtils.smoothstep(m, T / 2 - 0.05, T / 2 + reach);
      return t * t * (0.2 + vn2(x * 1.7, z * 1.7 + 3, 'ha') * 0.75);
    };
    const pos = [];
    const idx = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = x0 + (S * i) / N;
        const z = z0 + (S * j) / N;
        const n = vn2(x * 0.9, z * 0.9, 'rf1') * 0.55 + vn2(x * 2.6, z * 2.6, 'rf2') * 0.3 + vn2(x * 6.5, z * 6.5, 'rf3') * 0.15;
        const sag = Math.max(0, n - 0.32) * 0.5 + haunch(x, z);
        pos.push(x, ceil - 0.02 - sag, z);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1); // faces down
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // one continuous top-down projection over the whole lumpy roof: per-normal planar UVs flip axis
    // across the haunches and smear the texture into contour-like striations
    const ruv = [];
    for (let i = 0; i < pos.length; i += 3) ruv.push(pos[i] / 3, pos[i + 2] / 3);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.geometry('arch_hewn_ceil', geo, M4(), { ao: (p) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(ceil - p.y, 0.0, 0.45) });
    geo.dispose();
    // a few knuckles of harder rock hanging well clear of the roof (never a flat disc)
    for (let k = 0; k < 2; k++) {
      if (hash(map.id, fc.x, fc.y, k, 'ck') > 0.45) continue;
      const sc = 0.45 + hash(map.id, fc.x, fc.y, k, 'cs') * 0.4;
      const m = tr(x0 + S / 2 + (hash(map.id, fc.x, fc.y, k, 'cx') - 0.5) * 2.2, ceil - 0.12 - sc * 0.12, z0 + S / 2 + (hash(map.id, fc.x, fc.y, k, 'cz') - 0.5) * 2.2)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI + (hash(map.id, fc.x, fc.y, k, 'rx') - 0.5) * 0.6, hash(map.id, fc.x, fc.y, k) * 6.3, 0)))
        .multiply(new THREE.Matrix4().makeScale(sc * 1.3, sc * 0.9, sc));
      g.geometry('arch_hewn_ceil', rocks[(fc.x + k) % rocks.length], m, { uv: 'world', tint: rt(fc.x, fc.y + k), ao: 0.55 });
    }
  }

  /**
   * Convex corners (a tunnel mouth seen head-on) get a column of fractured rock lumps straddling the
   * edge, floor to roof, plus a shoulder bulging out under the roof: no straight vertical cut lines.
   */
  function cornerRocks(f) {
    const H = f.H;
    for (const end of [-1, 1]) {
      const kind = f.ends[end];
      if (kind !== 'convexExt' && kind !== 'convexNon') continue;
      const sd = hash(f.seed, end, 'crn');
      const sC = end * (S / 2 + T / 2 - 0.06);
      let y = -0.05;
      // bedded rock: flat, fractured slabs of varying thickness stacked with a common dip, each
      // stepping in or out a little (the strata weather back unevenly), never round lumps
      const dip = (hash(sd, 'dip') - 0.5) * 0.16;
      for (let k = 0; y < H - 0.1 && k < 16; k++) {
        const th = 0.16 + hash(sd, k, 'th') * 0.26;
        const wd = 0.55 + hash(sd, k, 'cz') * 0.35;
        const m = onFace(f, sC + (hash(sd, k, 'cs') - 0.5) * 0.16 - end * 0.05, y + th * 0.5, T / 2 - 0.12 + hash(sd, k, 'cd') * 0.14)
          .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(dip + (hash(sd, k, 'rx') - 0.5) * 0.06, (hash(sd, k, 'ry') - 0.5) * 0.5, dip * 0.5 + (hash(sd, k, 'rz') - 0.5) * 0.06)))
          .multiply(new THREE.Matrix4().makeScale(wd * 1.1, th / 0.62, wd));
        g.geometry('arch_hewn', chunks[(k + Math.floor(sd * 3)) % chunks.length], m, { uv: 'world', tint: rt(sd, k).map((v) => v * (0.85 + (k % 2) * 0.2)), ao: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, 0.8) });
        y += th * 0.96;
      }
      // overhanging shoulder where the corner meets the roof
      const m = onFace(f, sC - end * 0.1, H - 0.3, T / 2 - 0.1)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.5, sd * 6.3, 0.6 * end)))
        .multiply(new THREE.Matrix4().makeScale(0.75, 0.6, 0.65));
      g.geometry('arch_hewn_ceil', rocks[Math.floor(sd * 5) % rocks.length], m, { uv: 'world', tint: rt(sd, 99), ao: 0.6 });
    }
  }

  // ---------------------------------------------------------------- WARRENS
  function warrens() {
    const ceil = ts.ceilH;
    for (const f of block.spots.cave) {
      const sd = f.seed;
      const clear = (s) => !f.openings.some((o) => o.s0 - 0.4 < s && o.s1 + 0.4 > s);
      rockSkin(f);
      cornerRocks(f);
      // boulders at the foot of the wall, half buried in it
      const nb = 2 + Math.floor(hash(sd, 'nb') * 3);
      for (let k = 0; k < nb; k++) {
        const s = (hash(sd, k, 'bs') - 0.5) * (S - 0.4);
        if (!clear(s)) continue;
        const sc = 0.45 + hash(sd, k, 'bz') * 0.6;
        const m = onFace(f, s, sc * 0.18, T / 2 + sc * 0.12).multiply(new THREE.Matrix4().makeRotationY(hash(sd, k, 'br') * 6.3)).multiply(new THREE.Matrix4().makeScale(sc * 1.3, sc * 0.9, sc));
        g.geometry('arch_hewn', rocks[k % rocks.length], m, { uv: 'world', tint: rt(sd, k), ao: (p) => 0.55 + 0.45 * THREE.MathUtils.smoothstep(p.y, 0, 0.5) });
        const c = P(f, s, 0, T / 2 + sc * 0.3);
        blobs.push({ x: c.x, z: c.z, r: sc * 0.9, a: 0.55 });
      }
      // outcrops and ledges higher up: the rock was never dressed flat
      const no = 1 + Math.floor(hash(sd, 'no') * 3);
      for (let k = 0; k < no; k++) {
        const s = (hash(sd, k, 'os') - 0.5) * (S - 0.3);
        const y = 0.9 + hash(sd, k, 'oy') * (ceil - 1.4);
        if (!clear(s) && y < 2.6) continue;
        const sc = 0.5 + hash(sd, k, 'oz') * 0.7;
        const m = onFace(f, s, y, T / 2 - sc * 0.22).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(hash(sd, k, 'ox') * 3, hash(sd, k, 'oyr') * 6.3, hash(sd, k, 'oz2') * 3))).multiply(new THREE.Matrix4().makeScale(sc * 1.6, sc * 0.8, sc * 0.75));
        g.geometry('arch_hewn', rocks[(k + 2) % rocks.length], m, { uv: 'world', tint: rt(sd, k + 9), ao: 0.85 });
      }
      // roots breaking through where the wall meets the roof
      if (hash(sd, 'roots') < 0.7) {
        const nr = 2 + Math.floor(hash(sd, 'nr') * 4);
        for (let k = 0; k < nr; k++) {
          const s0 = (hash(sd, k, 'rs') - 0.5) * (S - 0.4);
          const len = 0.5 + hash(sd, k, 'rl') * 1.4;
          const pts = [];
          let s = s0;
          let d = T / 2 + 0.02;
          for (let q = 0; q <= 6; q++) {
            const t = q / 6;
            s += (hash(sd, k, q, 'rw') - 0.5) * 0.12;
            d += 0.015 + hash(sd, k, q, 'rd') * 0.04 * t;
            pts.push(P(f, s, ceil + 0.02 - t * len, d));
          }
          const tube = taperTube(pts, 0.028 + hash(sd, k, 'rr') * 0.03, 0.004, 5);
          g.geometry('prop_wood', tube, M4(), { uv: 'world', tint: [0.42, 0.32, 0.24], ao: 0.85 });
          tube.dispose();
          // a few rootlets off the main root
          for (let q = 2; q < 6; q += 2) {
            const a = pts[q];
            const b = a.clone().add(new THREE.Vector3((hash(sd, k, q, 'lx') - 0.5) * 0.3, -0.15 - hash(sd, k, q, 'ly') * 0.3, (hash(sd, k, q, 'lz') - 0.5) * 0.3));
            const t2 = taperTube([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.03, 0)), b], 0.01, 0.002, 4);
            g.geometry('prop_wood', t2, M4(), { uv: 'world', tint: [0.4, 0.3, 0.22], ao: 0.85 });
            t2.dispose();
          }
        }
      }
    }
    for (const fc of block.spots.floorCells) {
      const cx = fc.x * S + S / 2;
      const cz = fc.y * S + S / 2;
      // the roof is hewn rock too: a sagging, lumpy vault that rounds down into the walls
      rockRoof(fc);
      const walls = ['N', 'S', 'W', 'E'].filter((d) => map.getEdge(fc.x, fc.y, d) === EDGE.WALL);
      // a runnel of seep water along corridors (two facing walls)
      const ns = walls.includes('E') && walls.includes('W');
      const ew = walls.includes('N') && walls.includes('S');
      if ((ns || ew) && hash(map.id, fc.x, fc.y, 'run') < 0.75) runnel(cx, cz, ns);
      // kobold refuse against the walls
      for (const d of walls) {
        const r = hash(map.id, fc.x, fc.y, d, 'ref');
        if (r > 0.55) continue;
        const [nx, nz] = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[d];
        const along = (hash(map.id, fc.x, fc.y, d, 'al') - 0.5) * 1.6;
        const px = cx - nx * (S / 2 - T / 2 - 0.45) + nz * along;
        const pz = cz - nz * (S / 2 - T / 2 - 0.45) + nx * along;
        const m = tr(px, 0, pz).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(nx, nz) + hash(map.id, fc.x, fc.y, d) * 0.6));
        const seed = hash(map.id, fc.x, fc.y, d, 'sd') * 100;
        if (r < 0.18) bonePile(m, seed);
        else if (r < 0.3) potsherds(m, seed);
        else if (r < 0.42) ragNest(m, seed);
        else skullStake(m, seed);
        blobs.push({ x: px, z: pz, r: 0.75, a: 0.45 });
      }
    }
  }

  function runnel(cx, cz, alongZ) {
    // a shallow channel cut beside the walkway: kerb stones either side, dark water between
    const off = 0.72;
    const len = S;
    const water = [];
    for (const side of [-1, 1]) {
      let a = -len / 2;
      for (let k = 0; a < len / 2 - 0.05; k++) {
        const l = Math.min(len / 2 - a, 0.35 + hash(cx, cz, side, k, 'kl') * 0.35);
        const mid = a + l / 2;
        const w = side * 0.17;
        const x = alongZ ? cx + off + w : cx + mid;
        const z = alongZ ? cz + mid : cz + off + w;
        const h = 0.035 + hash(cx, cz, side, k, 'kh') * 0.025;
        g.box('arch_dungeon', { c: [x, h / 2 - 0.005, z], s: alongZ ? [0.13, h, l - 0.02] : [l - 0.02, h, 0.13], chamfer: 0.02, rotY: (hash(cx, cz, side, k) - 0.5) * 0.05, tint: [0.75, 0.72, 0.68], ao: (p, n) => (n.y > 0.5 ? 0.95 : 0.6) });
        a += l;
      }
    }
    water.push(alongZ ? [cx + off, cz] : [cx, cz + off]);
    for (const [x, z] of water) {
      const sx = alongZ ? 0.22 : len;
      const sz = alongZ ? len : 0.22;
      runnelQuads.push([x, z, sx, sz]);
    }
  }

  function bonePile(m, seed) {
    const skull = new THREE.SphereGeometry(0.095, 12, 9);
    skull.scale(1, 0.92, 1.18);
    const jaw = new THREE.BoxGeometry(0.1, 0.035, 0.08);
    const n = 6 + Math.floor(hash(seed, 'n') * 5);
    for (let k = 0; k < n; k++) {
      const len = 0.22 + hash(seed, k, 'l') * 0.24;
      const mm = m.clone().multiply(tr((hash(seed, k, 'x') - 0.5) * 0.6, 0.03 + (k % 3) * 0.035, (hash(seed, k, 'z') - 0.5) * 0.4)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((hash(seed, k, 'rx') - 0.5) * 0.5, hash(seed, k, 'ry') * 6.3, Math.PI / 2 + (hash(seed, k, 'rz') - 0.5) * 0.4)));
      longBone(mm, len);
    }
    for (let q = 0; q < 1 + Math.floor(hash(seed, 'sk') * 2); q++) {
      const sm = m.clone().multiply(tr((hash(seed, q, 'sx') - 0.5) * 0.4, 0.085, (hash(seed, q, 'sz') - 0.5) * 0.25)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.2, hash(seed, q) * 6.3, 0.15)));
      g.geometry('prop_bone', skull, sm, { uv: 'world', tint: [0.9, 0.84, 0.72] });
      g.geometry('prop_bone', jaw, sm.clone().multiply(tr(0, -0.07, 0.05)), { uv: 'world', tint: [0.8, 0.74, 0.62] });
      // eye sockets
      for (const ex of [-0.035, 0.035]) g.box('arch_beam_dark', { matrix: sm.clone().multiply(tr(ex, 0.01, 0.1)), s: [0.035, 0.03, 0.02], tint: [0.1, 0.08, 0.07] });
    }
    skull.dispose();
    jaw.dispose();
  }
  function longBone(m, len) {
    const shaft = new THREE.CylinderGeometry(0.016, 0.014, len, 6);
    g.geometry('prop_bone', shaft, m, { uv: 'world', tint: [0.86, 0.8, 0.68] });
    shaft.dispose();
    const knob = new THREE.SphereGeometry(0.03, 6, 5);
    for (const sy of [-1, 1]) for (const kx of [-0.012, 0.012]) g.geometry('prop_bone', knob, m.clone().multiply(tr(kx, (sy * len) / 2, 0)), { uv: 'world', tint: [0.88, 0.82, 0.7] });
    knob.dispose();
  }
  function potsherds(m, seed) {
    // broken jars: curved shards (open cylinder segments) and a cracked pot still standing
    for (let k = 0; k < 7; k++) {
      const a0 = hash(seed, k, 'a') * Math.PI * 2;
      const shard = new THREE.CylinderGeometry(0.12, 0.1, 0.1 + hash(seed, k, 'h') * 0.08, 6, 1, true, a0, 0.7 + hash(seed, k, 'w') * 0.8);
      const mm = m.clone().multiply(tr((hash(seed, k, 'x') - 0.5) * 0.7, 0.04, (hash(seed, k, 'z') - 0.5) * 0.45)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + (hash(seed, k, 'rx') - 0.5), hash(seed, k, 'ry') * 6.3, 0)));
      g.geometry('arch_brick', shard, mm, { uv: 'world', tint: [0.75, 0.6, 0.5] });
      shard.dispose();
    }
    const pot = new THREE.LatheGeometry([[0, 0], [0.11, 0], [0.15, 0.1], [0.14, 0.22], [0.08, 0.28], [0.09, 0.31], [0.0, 0.31]].map(([r, y]) => new THREE.Vector2(r, y)), 10, 0, Math.PI * 1.55);
    g.geometry('arch_brick', pot, m.clone().multiply(tr(0.25, 0, 0.05)), { uv: 'world', tint: [0.8, 0.64, 0.52] });
    pot.dispose();
  }
  function ragNest(m, seed) {
    // a sleeping nest: flattened sacking, straw tufts and gnawed sticks
    for (let k = 0; k < 4; k++) {
      const sack = new THREE.SphereGeometry(0.3, 8, 5);
      const mm = m.clone().multiply(tr((hash(seed, k, 'x') - 0.5) * 0.6, 0.05, (hash(seed, k, 'z') - 0.5) * 0.4)).multiply(new THREE.Matrix4().makeRotationY(hash(seed, k) * 6.3)).multiply(new THREE.Matrix4().makeScale(1.1, 0.22, 0.8));
      g.geometry('prop_burlap', sack, mm, { uv: 'world', tint: k % 2 ? [0.6, 0.5, 0.4] : [0.42, 0.36, 0.3] });
      sack.dispose();
    }
    for (let k = 0; k < 9; k++) {
      const mm = m.clone().multiply(tr((hash(seed, k, 'sx') - 0.5) * 0.9, 0.06, (hash(seed, k, 'sz') - 0.5) * 0.6)).multiply(new THREE.Matrix4().makeRotationY(hash(seed, k, 'sr') * 6.3));
      g.box('prop_wood', { matrix: mm, s: [0.3 + hash(seed, k, 'sl') * 0.3, 0.018, 0.018], uv: 'along', tint: [0.6, 0.5, 0.4] });
    }
  }
  function skullStake(m, seed) {
    // a sharpened stake with a skull: kobold territory marker, with a rag tied on
    const lean = (hash(seed, 'ln') - 0.5) * 0.2;
    const sm = m.clone().multiply(tr(0, 0.62, 0)).multiply(new THREE.Matrix4().makeRotationZ(lean));
    const stake = new THREE.CylinderGeometry(0.018, 0.03, 1.24, 6);
    g.geometry('prop_wood', stake, sm, { uv: 'world', tint: [0.55, 0.45, 0.35] });
    stake.dispose();
    const skull = new THREE.SphereGeometry(0.075, 10, 8);
    skull.scale(1, 0.9, 1.25);
    const top = sm.clone().multiply(tr(0, 0.66, 0)).multiply(new THREE.Matrix4().makeRotationY(hash(seed, 'sy') - 0.5));
    g.geometry('prop_bone', skull, top, { uv: 'world', tint: [0.88, 0.82, 0.7] });
    for (const ex of [-0.028, 0.028]) g.box('arch_beam_dark', { matrix: top.clone().multiply(tr(ex, 0.01, 0.08)), s: [0.028, 0.024, 0.016], tint: [0.1, 0.08, 0.07] });
    skull.dispose();
    const rag = new THREE.PlaneGeometry(0.12, 0.3, 1, 3);
    rag.translate(0.06, -0.15, 0);
    g.geometry('prop_burlap', rag, sm.clone().multiply(tr(0.02, 0.4, 0)).multiply(new THREE.Matrix4().makeRotationY(0.6)), { uv: 'world', tint: [0.55, 0.2, 0.15] });
    g.geometry('prop_burlap', rag, sm.clone().multiply(tr(0.02, 0.4, 0)).multiply(new THREE.Matrix4().makeRotationY(0.6 + Math.PI)), { uv: 'world', tint: [0.55, 0.2, 0.15] });
    rag.dispose();
    // rubble wedging the foot
    for (let k = 0; k < 4; k++) {
      const sc = 0.12 + hash(seed, k, 'rz') * 0.12;
      g.geometry('arch_hewn', rocks[k % rocks.length], m.clone().multiply(tr(Math.cos(k * 1.7) * 0.12, sc * 0.2, Math.sin(k * 1.7) * 0.12)).multiply(new THREE.Matrix4().makeScale(sc, sc * 0.7, sc)), { uv: 'world', tint: rt(seed, k) });
    }
  }

  // ---------------------------------------------------------------- BANE
  function bane() {
    const banners = [];
    const runner = [];
    for (const f of block.spots.bane) {
      if (f.openings.length) continue;
      const sd = f.seed;
      if (f.relief) {
        // a brazier before each relief in the halls (corridors stay clear to walk)
        const [cx, cy] = [f.cell.x, f.cell.y];
        const corridor = ['N', 'S', 'E', 'W'].filter((d) => map.getEdge(cx, cy, d) === EDGE.WALL).length >= 2;
        if (!corridor) brazier(onFace(f, 0, 0, T / 2 + 0.55), sd);
        continue;
      }
      if (hash(sd, 'ban') < 0.75) banners.push({ f, s: (hash(sd, 'bs') - 0.5) * 0.4, top: ts.ceilH - 0.75 });
    }
    // the processional: a long crimson runner down every corridor cell of a processional/sanctum zone
    for (const fc of block.spots.floorCells) {
      const zone = map.zoneAt(fc.x, fc.y) ?? '';
      const cx = fc.x * S + S / 2;
      const cz = fc.y * S + S / 2;
      const walls = ['N', 'S', 'W', 'E'].filter((d) => map.getEdge(fc.x, fc.y, d) === EDGE.WALL);
      const ns = walls.includes('E') && walls.includes('W');
      const ew = walls.includes('N') && walls.includes('S');
      if (/processional|sanctum|nave|aisle/i.test(zone) && (ns || ew || /sanctum/i.test(zone))) {
        const alongZ = !ew;
        if (!/sanctum/i.test(zone) || fc.x === 7) runner.push({ cx, cz, alongZ });
      }
    }
    // the sanctum nave: pairs of braziers (each a different casting) march toward the altar, and
    // fire-bowls on brackets light the side walls, so the hall reads as architecture, not void
    for (const fc of block.spots.floorCells) {
      if (!/sanctum/i.test(map.zoneAt(fc.x, fc.y) ?? '')) continue;
      const cx = fc.x * S + S / 2;
      const cz = fc.y * S + S / 2;
      if ((fc.x === 6 || fc.x === 9) && (fc.y === 2 || fc.y === 4)) {
        const sx = fc.x === 6 ? -0.9 : 0.9;
        brazier(tr(cx + sx, 0, cz), fc.x * 13 + fc.y, (fc.y === 2 ? 1 : 2));
      }
    }
    for (const f of block.spots.bane) {
      if (f.openings.length || f.relief) continue;
      if (!/sanctum/i.test(map.zoneAt(f.cell.x, f.cell.y) ?? '')) continue;
      if (hash(f.seed, 'wb') > 0.6) continue;
      const bm = onFace(f, 0, 2.15, T / 2);
      g.box('prop_iron', { matrix: bm.clone().multiply(tr(0, -0.1, 0.02)), s: [0.12, 0.34, 0.03], chamfer: 0.01 });
      g.box('prop_iron', { matrix: bm.clone().multiply(tr(0, -0.06, 0.18)), s: [0.04, 0.04, 0.34], chamfer: 0.008 });
      const cup = new THREE.LatheGeometry([[0, 0], [0.08, 0.01], [0.17, 0.08], [0.2, 0.14], [0.17, 0.14], [0, 0.07]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
      g.geometry('prop_iron', cup, bm.clone().multiply(tr(0, -0.06, 0.38)), { uv: 'world' });
      cup.dispose();
      lamps.push({ pos: new THREE.Vector3(0, 0.08, 0.38).applyMatrix4(bm), kind: 'brazier', lit: true, seed: Math.floor(f.seed * 997), flameColor: BANE_FLAME, lightColor: BANE_LIGHT });
    }
    // the altar: wherever an event names it (or the sanctum's heart)
    const altarEv = (map.events ?? []).find((e) => /altar/i.test(`${e.id} ${e.ref ?? ''}`));
    if (altarEv) altar(altarEv.x, altarEv.y);

    if (banners.length) {
      const mat = new THREE.MeshStandardMaterial({ map: getBaneBannerTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, color: 0xe0d0d0 });
      clothSway(mat);
      const pos = [];
      const uvs = [];
      const idx = [];
      for (const bn of banners) {
        const { f, s, top } = bn;
        const w = 1.0;
        const h = 2.7;
        const NU = 20;
        const NV = 12;
        const d = T / 2 + 0.06;
        const ph = hash(f.seed, 'fold') * 6.3;
        const base = pos.length / 3;
        // heavy wool hanging from the rod: gathered into soft vertical folds that deepen toward
        // the hem, the hem itself swinging slightly out from the wall (smooth-shaded)
        for (let j = 0; j <= NV; j++) {
          for (let i = 0; i <= NU; i++) {
            const u = i / NU;
            const v = j / NV; // 0 = top
            const fold = Math.sin(u * Math.PI * 5 + ph) * (0.025 + 0.045 * v) + Math.sin(u * Math.PI * 11 + ph * 2) * 0.008 * v;
            const sv = s - w / 2 + w * u + Math.sin(u * Math.PI * 5 + ph) * 0.01 * v;
            const p = P(f, sv, top - h * v, d + 0.04 + fold + v * v * 0.05);
            pos.push(p.x, p.y, p.z);
            uvs.push(u, 1 - v);
          }
        }
        for (let j = 0; j < NV; j++) {
          for (let i = 0; i < NU; i++) {
            const a = base + j * (NU + 1) + i;
            idx.push(a, a + NU + 1, a + 1, a + 1, a + NU + 1, a + NU + 2);
          }
        }
        // iron rod with finials, on two brackets
        g.box('prop_iron', { matrix: onFace(f, s, top + 0.03, d + 0.03), s: [w + 0.24, 0.035, 0.035] });
        for (const e of [-1, 1]) {
          g.box('prop_iron', { matrix: onFace(f, s + e * (w / 2 + 0.12), top + 0.03, d + 0.03), s: [0.06, 0.06, 0.06], chamfer: 0.015 });
          g.box('prop_iron', { matrix: onFace(f, s + e * (w / 2 - 0.05), top + 0.03, T / 2 + 0.04), s: [0.025, 0.025, 0.09] });
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      own.push(geo, mat);
    }
    if (runner.length) {
      const tex = getRunnerTexture();
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: 0xd8c8c8 });
      const b = new GeoBuilder();
      for (const r of runner) {
        const hw = 0.55;
        const y = 0.012;
        const a = r.alongZ ? [r.cx - hw, r.cz - S / 2] : [r.cx - S / 2, r.cz - hw];
        const c = r.alongZ ? [r.cx + hw, r.cz + S / 2] : [r.cx + S / 2, r.cz + hw];
        const v0 = (r.alongZ ? r.cz - S / 2 : r.cx - S / 2) / 1.1;
        const v1 = v0 + S / 1.1;
        if (r.alongZ) b.quad('run', new THREE.Vector3(a[0], y, c[1]), new THREE.Vector3(c[0], y, c[1]), new THREE.Vector3(c[0], y, a[1]), new THREE.Vector3(a[0], y, a[1]), [[0, v1], [1, v1], [1, v0], [0, v0]], { ao: 1 });
        else b.quad('run', new THREE.Vector3(a[0], y, c[1]), new THREE.Vector3(c[0], y, c[1]), new THREE.Vector3(c[0], y, a[1]), new THREE.Vector3(a[0], y, a[1]), [[1, v0], [1, v1], [0, v1], [0, v0]], { ao: 1 });
      }
      const geo = b.build().get('run');
      geo.deleteAttribute('color');
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      group.add(mesh);
      own.push(geo, mat);
    }
  }

  function brazier(m, seed, style = Math.floor(hash(seed, 'bst') * 3)) {
    if (style === 1) {
      // a tall fluted basalt pedestal carrying a wide, lipped bronze-black bowl on four claws
      const ped = new THREE.LatheGeometry([[0, 0], [0.26, 0], [0.26, 0.08], [0.2, 0.12], [0.13, 0.2], [0.11, 0.7], [0.15, 0.78], [0.2, 0.84], [0, 0.84]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
      g.geometry('arch_basalt', ped, m, { uv: 'world', tint: [0.9, 0.86, 0.86] });
      ped.dispose();
      const bw = new THREE.LatheGeometry([[0.02, 0], [0.18, 0.02], [0.34, 0.1], [0.42, 0.2], [0.45, 0.24], [0.41, 0.24], [0.3, 0.14], [0, 0.1]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
      g.geometry('prop_iron', bw, m.clone().multiply(tr(0, 0.86, 0)), { uv: 'world', tint: [0.75, 0.62, 0.45] });
      bw.dispose();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const cm = m.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(tr(0.22, 0.86, 0)).multiply(new THREE.Matrix4().makeRotationZ(-0.7));
        g.box('prop_iron', { matrix: cm, s: [0.05, 0.2, 0.05], chamfer: 0.01 });
      }
      const co = new THREE.CircleGeometry(0.38, 16);
      co.rotateX(-Math.PI / 2);
      g.geometry('arch_beam_dark', co, m.clone().multiply(tr(0, 1.06, 0)), { uv: 'world', tint: [0.16, 0.13, 0.11] });
      co.dispose();
      const c = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      blobs.push({ x: c.x, z: c.z, r: 0.65, a: 0.6 });
      lamps.push({ pos: new THREE.Vector3(0, 1.1, 0).applyMatrix4(m), kind: 'brazier', big: true, lit: true, seed: Math.floor(seed * 991) % 997, flameColor: BANE_FLAME, lightColor: BANE_LIGHT });
      return;
    }
    if (style === 2) {
      // a squat iron cauldron-brazier on three lion-paw legs, ring handles, a riveted band
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + seed;
        const lm = m.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(tr(0.27, 0.22, 0)).multiply(new THREE.Matrix4().makeRotationZ(-0.25));
        g.box('prop_iron', { matrix: lm, s: [0.07, 0.46, 0.07], chamfer: 0.02 });
        const paw = new THREE.SphereGeometry(0.07, 8, 6);
        paw.scale(1.2, 0.6, 1);
        g.geometry('prop_iron', paw, m.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(tr(0.33, 0.03, 0)), { uv: 'world' });
        paw.dispose();
      }
      const cauld = new THREE.LatheGeometry([[0, 0.3], [0.2, 0.32], [0.34, 0.42], [0.38, 0.56], [0.36, 0.68], [0.39, 0.7], [0.34, 0.7], [0.3, 0.6], [0, 0.55]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
      g.geometry('prop_iron', cauld, m, { uv: 'world' });
      cauld.dispose();
      const band = new THREE.TorusGeometry(0.385, 0.018, 5, 24);
      band.rotateX(Math.PI / 2);
      g.geometry('prop_iron', band, m.clone().multiply(tr(0, 0.55, 0)), { uv: 'world', tint: [1.3, 1.2, 1.1] });
      band.dispose();
      for (const sx of [-1, 1]) {
        const ring = new THREE.TorusGeometry(0.07, 0.014, 5, 12);
        g.geometry('prop_iron', ring, m.clone().multiply(tr(sx * 0.42, 0.6, 0)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), { uv: 'world' });
        ring.dispose();
      }
      const co = new THREE.CircleGeometry(0.33, 16);
      co.rotateX(-Math.PI / 2);
      g.geometry('arch_beam_dark', co, m.clone().multiply(tr(0, 0.66, 0)), { uv: 'world', tint: [0.16, 0.13, 0.11] });
      co.dispose();
      const c = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      blobs.push({ x: c.x, z: c.z, r: 0.65, a: 0.6 });
      lamps.push({ pos: new THREE.Vector3(0, 0.72, 0).applyMatrix4(m), kind: 'brazier', big: true, lit: true, seed: Math.floor(seed * 991) % 997, flameColor: BANE_FLAME, lightColor: BANE_LIGHT });
      return;
    }
    // iron tripod with a deep bowl of coals; green fire
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + seed;
      const lm = m.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(tr(0.16, 0.42, 0)).multiply(new THREE.Matrix4().makeRotationZ(0.22));
      g.box('prop_iron', { matrix: lm, s: [0.035, 0.88, 0.035], chamfer: 0.008 });
      g.box('prop_iron', { matrix: m.clone().multiply(new THREE.Matrix4().makeRotationY(a)).multiply(tr(0.26, 0.02, 0)), s: [0.09, 0.04, 0.06], chamfer: 0.012 });
    }
    const bowl = new THREE.LatheGeometry([[0.02, 0], [0.12, 0.01], [0.24, 0.08], [0.3, 0.18], [0.31, 0.2], [0.28, 0.2], [0.21, 0.1], [0.0, 0.06]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
    g.geometry('prop_iron', bowl, m.clone().multiply(tr(0, 0.82, 0)), { uv: 'world' });
    bowl.dispose();
    const coals = new THREE.CircleGeometry(0.27, 14);
    coals.rotateX(-Math.PI / 2);
    g.geometry('arch_beam_dark', coals, m.clone().multiply(tr(0, 0.99, 0)), { uv: 'world', tint: [0.18, 0.14, 0.12] });
    coals.dispose();
    const c = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
    blobs.push({ x: c.x, z: c.z, r: 0.6, a: 0.6 });
    lamps.push({ pos: new THREE.Vector3(0, 1.05, 0).applyMatrix4(m), kind: 'brazier', lit: true, seed: Math.floor(seed * 991) % 997, flameColor: BANE_FLAME, lightColor: BANE_LIGHT });
  }

  function altar(x, y) {
    const cx = x * S + S / 2;
    const cz = y * S + S / 2;
    // the altar faces the way into the sanctum (south by default)
    const rot = 0;
    // the altar is the hall's focus: built a third over life size on a broad three-step dais
    const m = tr(cx, 0.16, cz).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(new THREE.Matrix4().makeScale(1.32, 1.32, 1.32));
    const at = (px, py, pz) => m.clone().multiply(tr(px, py, pz));
    {
      const lowest = roughBlockGeometry(4.2, 0.16, 3.4, { bevel: 0.03, amp: 0.006, seed: 11, chip: 0.02 });
      g.geometry('arch_basalt', lowest, tr(cx, 0.08, cz - 0.2), { uv: 'world', tint: [0.72, 0.68, 0.68] });
      lowest.dispose();
    }
    // stepped dais: two chamfered treads, each with a worn, slightly lighter nosing
    g.box('arch_basalt', { matrix: at(0, 0.1, -0.2), s: [2.9, 0.2, 2.2], chamfer: 0.03, tint: [0.8, 0.76, 0.76] });
    g.box('arch_basalt', { matrix: at(0, 0.27, -0.35), s: [2.4, 0.15, 1.5], chamfer: 0.03, tint: [0.85, 0.8, 0.8] });
    // altar: moulded plinth, a body with sunken front panels between half-round colonnettes,
    // and a two-stage top slab (fillet + overhanging cornice)
    const zA = -0.35;
    g.box('arch_basalt', { matrix: at(0, 0.42, zA), s: [1.98, 0.16, 1.02], chamfer: 0.035, tint: [0.92, 0.88, 0.88] });
    g.box('arch_basalt', { matrix: at(0, 0.53, zA), s: [1.88, 0.06, 0.94], chamfer: 0.02 });
    g.box('arch_basalt', { matrix: at(0, 0.88, zA), s: [1.76, 0.66, 0.82], chamfer: 0.02 });
    for (const px of [-0.86, 0.86]) {
      for (const pz of [zA + 0.42, zA - 0.42]) {
        const col = new THREE.CylinderGeometry(0.06, 0.065, 0.66, 12);
        g.geometry('arch_basalt', col, at(px, 0.88, pz), { uv: 'world', tint: [1.05, 1.0, 1.0] });
        col.dispose();
        for (const [cy, r] of [[0.57, 0.085], [1.19, 0.085]]) {
          const ring = new THREE.CylinderGeometry(r, r, 0.05, 12);
          g.geometry('arch_basalt', ring, at(px, cy, pz), { uv: 'world', tint: [1.1, 1.05, 1.05] });
          ring.dispose();
        }
      }
    }
    // sunken side panels (the cloth covers the middle of the front)
    for (const px of [-0.62, 0.62]) {
      g.box('arch_basalt', { matrix: at(px, 0.88, zA + 0.415), s: [0.34, 0.5, 0.03], chamfer: 0.01, tint: [0.7, 0.66, 0.66] });
      g.box('arch_basalt', { matrix: at(px, 0.88, zA + 0.43), s: [0.24, 0.4, 0.02], chamfer: 0.006, tint: [1.1, 1.05, 1.05] });
    }
    g.box('arch_basalt', { matrix: at(0, 1.245, zA), s: [1.9, 0.07, 0.94], chamfer: 0.015, tint: [1.05, 1.0, 1.0] });
    g.box('arch_basalt', { matrix: at(0, 1.32, zA), s: [2.02, 0.09, 1.04], chamfer: 0.03, tint: [1.15, 1.1, 1.1] });
    const topY = 1.365;
    // draped altar cloth: runs from the back of the top over the front edge and hangs in folds,
    // flaring and rippling more towards the fringed hem
    {
      const nu = 28;
      const nv = 34;
      const half = 0.52;
      const zBack = zA - 0.42;
      const zFront = zA + 0.52 + 0.012;
      const Ltop = zFront - zBack;
      const pos = [];
      const uv = [];
      const idx = [];
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const u = i / nu;
          const x0 = (u * 2 - 1) * half;
          const drop = 0.82 + 0.035 * Math.sin(x0 * 11 + 1.3) + 0.02 * Math.sin(x0 * 23);
          const L = Ltop + 0.04 + drop;
          const sArc = (j / nv) * L;
          let px;
          let py;
          let pz;
          if (sArc <= Ltop) {
            px = x0;
            py = topY + 0.004 + 0.004 * Math.sin(x0 * 14 + sArc * 9);
            pz = zBack + sArc;
          } else if (sArc <= Ltop + 0.04) {
            // roll over the rounded edge
            const a = ((sArc - Ltop) / 0.04) * (Math.PI / 2);
            px = x0;
            py = topY - 0.025 + Math.cos(a) * 0.03;
            pz = zFront - 0.02 + Math.sin(a) * 0.03;
          } else {
            const d = sArc - Ltop - 0.04;
            const k = d / drop;
            const flare = 1 + 0.07 * k * k;
            px = x0 * flare;
            py = topY - 0.025 - d;
            // folds: a few deep pleats plus finer ripples, growing with the hang
            const fold = (0.012 + 0.05 * k) * Math.sin(x0 * 8.5 + 0.6) + (0.004 + 0.018 * k) * Math.sin(x0 * 21 + 2.0) + 0.008 * k * k * Math.sin(x0 * 37);
            pz = zFront + 0.012 + 0.03 * k * k + fold;
          }
          pos.push(px, py, pz);
          uv.push(u, 1 - Math.min(1, sArc / L) * (1 - 0) );
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const q = j * (nu + 1) + i;
          idx.push(q, q + 1, q + nu + 1, q + 1, q + nu + 2, q + nu + 1);
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      cg.setIndex(idx);
      cg.computeVertexNormals();
      const orm = getAltarClothORM();
      const cloth = new THREE.MeshStandardMaterial({ map: getAltarClothTexture(), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, alphaTest: 0.5, side: THREE.DoubleSide });
      cloth.map.flipY = true;
      const cm = new THREE.Mesh(cg, cloth);
      cm.applyMatrix4(m);
      cm.castShadow = true;
      cm.receiveShadow = true;
      group.add(cm);
      own.push(cg, cloth);
    }
    // offerings: a gilt chalice, a bowl of blood, a ritual dagger, scattered coins, a skull
    {
      const chalice = new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.072, 0.012], [0.02, 0.03], [0.014, 0.1], [0.03, 0.12], [0.06, 0.15], [0.065, 0.21], [0.058, 0.21], [0.05, 0.16], [0, 0.15]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
      g.geometry('gilt', chalice, at(0.42, topY, zA + 0.05), { uv: 'world' });
      chalice.dispose();
      const bowl = new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.13, 0.04], [0.15, 0.08], [0.14, 0.085], [0.11, 0.05], [0, 0.04]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
      g.geometry('arch_iron', bowl, at(-0.4, topY, zA + 0.02), { uv: 'world', tint: [0.6, 0.55, 0.5] });
      bowl.dispose();
      const blood = new THREE.CircleGeometry(0.12, 16);
      blood.rotateX(-Math.PI / 2);
      const bm = new THREE.MeshStandardMaterial({ color: 0x2a0303, roughness: 0.08, metalness: 0 });
      const bmesh = new THREE.Mesh(blood, bm);
      bmesh.applyMatrix4(at(-0.4, topY + 0.07, zA + 0.02));
      group.add(bmesh);
      own.push(blood, bm);
      // dagger laid across the cloth: blade, crossguard, grip, pommel
      const dm = at(0.0, topY + 0.012, zA + 0.18).multiply(new THREE.Matrix4().makeRotationY(0.35));
      g.box('arch_iron', { matrix: dm.clone().multiply(tr(0.13, 0, 0)), s: [0.24, 0.006, 0.035], chamfer: 0.002, tint: [1.3, 1.3, 1.35] });
      g.box('gilt', { matrix: dm.clone().multiply(tr(0.0, 0.004, 0)), s: [0.016, 0.014, 0.1], chamfer: 0.004 });
      g.box('arch_beam_dark', { matrix: dm.clone().multiply(tr(-0.06, 0.004, 0)), s: [0.1, 0.018, 0.02], chamfer: 0.006, tint: [0.3, 0.2, 0.15] });
      const pom = new THREE.SphereGeometry(0.016, 8, 6);
      g.geometry('gilt', pom, dm.clone().multiply(tr(-0.115, 0.004, 0)), { uv: 'world' });
      pom.dispose();
      const coin = new THREE.CylinderGeometry(0.014, 0.014, 0.003, 10);
      for (let k = 0; k < 9; k++) {
        const ccm = at(0.15 + (hash(x, y, k, 'cx') - 0.5) * 0.5, topY + 0.008 + (k % 3) * 0.003, zA + 0.2 + (hash(x, y, k, 'cz') - 0.5) * 0.2).multiply(new THREE.Matrix4().makeRotationX((hash(x, y, k, 'ct') - 0.5) * 0.4));
        g.geometry('gilt', coin, ccm, { uv: 'world' });
      }
      coin.dispose();
      const skull = new THREE.SphereGeometry(0.085, 14, 10);
      skull.scale(1, 0.9, 1.2);
      const sm = at(-0.7, topY + 0.07, zA - 0.12).multiply(new THREE.Matrix4().makeRotationY(0.5));
      g.geometry('prop_bone', skull, sm, { uv: 'world', tint: [0.86, 0.8, 0.68] });
      for (const ex of [-0.03, 0.03]) g.box('arch_beam_dark', { matrix: sm.clone().multiply(tr(ex, 0.01, 0.09)), s: [0.032, 0.028, 0.02], tint: [0.08, 0.06, 0.05] });
      skull.dispose();
    }
    // the stele behind it: a tall slab carrying a great relief of the Black Hand
    g.box('arch_basalt', { matrix: at(0, 1.9, -1.25), s: [2.3, 3.8, 0.4], chamfer: 0.05 });
    g.box('arch_basalt', { matrix: at(0, 3.86, -1.25), s: [2.6, 0.18, 0.55], chamfer: 0.04, tint: [0.9, 0.85, 0.85] });
    blackHand(m.clone().multiply(tr(0, 2.5, -1.05)));
    // candles of oxblood wax along the back of the altar: varied heights, drips running down,
    // wax pooled at the foot, a melted cup at the top
    for (let k = 0; k < 7; k++) {
      const px = -0.78 + k * 0.26 + (hash(x, y, k, 'cjx') - 0.5) * 0.06;
      const pz = -0.66 + (hash(x, y, k, 'cjz') - 0.5) * 0.08 + (k % 2) * 0.06;
      const ch = 0.1 + hash(x, y, k, 'cand') * 0.22;
      const r0 = 0.024 + hash(x, y, k, 'cr') * 0.012;
      const wax = [0.32, 0.07, 0.06];
      const cyl = new THREE.CylinderGeometry(r0 * 0.96, r0, ch, 12);
      g.geometry('prop_limestone', cyl, at(px, topY + ch / 2, pz), { uv: 'world', tint: wax });
      cyl.dispose();
      const pool = new THREE.CylinderGeometry(r0 * 2.1, r0 * 2.4, 0.008, 12);
      g.geometry('prop_limestone', pool, at(px, topY + 0.004, pz), { uv: 'world', tint: wax });
      pool.dispose();
      for (let q = 0; q < 4; q++) {
        const a = hash(x, y, k, q, 'da') * Math.PI * 2;
        const len = 0.02 + hash(x, y, k, q, 'dl') * ch * 0.7;
        const drip = new THREE.CapsuleGeometry(0.006, len, 3, 6);
        g.geometry('prop_limestone', drip, at(px + Math.cos(a) * r0, topY + ch - len / 2 - 0.004, pz + Math.sin(a) * r0), { uv: 'world', tint: [wax[0] * 1.15, wax[1] * 1.15, wax[2] * 1.15] });
        drip.dispose();
      }
      const lip = new THREE.TorusGeometry(r0 * 0.8, 0.006, 5, 12);
      lip.rotateX(Math.PI / 2);
      g.geometry('prop_limestone', lip, at(px, topY + ch, pz), { uv: 'world', tint: [0.42, 0.12, 0.1] });
      lip.dispose();
      if (k % 2 === 0 || k === 3) lamps.push({ pos: new THREE.Vector3(px, topY + ch + 0.012, pz).applyMatrix4(m), kind: 'candle', lit: true, seed: 300 + k });
    }
    // braziers either side of the dais
    for (const sx of [-1.75, 1.75]) brazier(at(sx, 0, 0.3), x * 7 + sx);
    blobs.push({ x: cx, z: cz - 0.35, r: 1.6, a: 0.5 });
  }

  /**
   * The Black Hand: an open gauntleted hand of black iron, deep-carved (thick extrusion, bevelled
   * knuckles and finger joints), raised palm-out inside a ring of iron spikes, with a sickly green
   * halo behind it that rims the silhouette. m: origin at the palm centre, +z out of the stele.
   */
  function blackHand(m) {
    const at2 = (x, y, z) => m.clone().multiply(tr(x, y, z));
    // sunken roundel the hand stands in (a dark recess with a moulded rim)
    const rim = new THREE.TorusGeometry(0.86, 0.06, 8, 40);
    g.geometry('arch_basalt', rim, at2(0, 0, 0.02), { uv: 'world', tint: [0.95, 0.9, 0.9] });
    rim.dispose();
    const back = new THREE.CircleGeometry(0.86, 40);
    g.geometry('arch_basalt', back, at2(0, 0, 0.005), { uv: 'world', tint: [0.35, 0.33, 0.34], ao: 0.6 });
    back.dispose();
    // spikes radiating from the ring
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const len = k % 2 ? 0.22 : 0.34;
      const sp = new THREE.ConeGeometry(0.045, len, 6);
      const sm = at2(Math.cos(a) * (0.9 + len / 2), Math.sin(a) * (0.9 + len / 2), 0.03).multiply(new THREE.Matrix4().makeRotationZ(a - Math.PI / 2));
      g.geometry('prop_iron', sp, sm, { uv: 'world', tint: [0.5, 0.48, 0.5] });
      sp.dispose();
    }
    const parts = [];
    const rr = (x0, y0, w, h, r) => {
      const sh = new THREE.Shape();
      sh.moveTo(x0 + r, y0);
      sh.lineTo(x0 + w - r, y0);
      sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
      sh.lineTo(x0 + w, y0 + h - r);
      sh.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
      sh.lineTo(x0 + r, y0 + h);
      sh.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
      sh.lineTo(x0, y0 + r);
      sh.quadraticCurveTo(x0, y0, x0 + r, y0);
      return sh;
    };
    // palm + cuff
    parts.push([rr(-0.3, -0.4, 0.6, 0.62, 0.12), 0.16, 0, 0]);
    parts.push([rr(-0.26, -0.72, 0.52, 0.34, 0.05), 0.12, 0, 0]);
    // four fingers in two phalanx segments each (a hair apart so the joints read), thumb angled out
    const fx = [-0.235, -0.078, 0.078, 0.235];
    const fl = [0.36, 0.44, 0.42, 0.32];
    fx.forEach((x, i) => {
      parts.push([rr(x - 0.055, 0.24, 0.11, fl[i] * 0.5, 0.045), 0.13, 0, 0]);
      parts.push([rr(x - 0.05, 0.25 + fl[i] * 0.53, 0.1, fl[i] * 0.45, 0.05), 0.12, 0, 0]);
    });
    parts.push([rr(-0.07, -0.12, 0.14, 0.36, 0.06), 0.13, -0.36, 0.7]);
    for (const [sh, dep, ox, ang] of parts) {
      const eg = new THREE.ExtrudeGeometry(sh, { depth: dep, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 3, curveSegments: 6 });
      const pm = at2(ox, ang ? -0.05 : 0, 0.08).multiply(new THREE.Matrix4().makeRotationZ(ang));
      g.geometry('prop_iron', eg, pm, { uv: 'world', tint: [0.42, 0.4, 0.42], ao: 0.95 });
      eg.dispose();
    }
    // knuckle studs across the back of the gauntlet cuff
    for (let k = 0; k < 4; k++) {
      const st = new THREE.SphereGeometry(0.03, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      st.rotateX(Math.PI / 2);
      g.geometry('prop_iron', st, at2(-0.18 + k * 0.12, -0.55, 0.28), { uv: 'world', tint: [0.7, 0.68, 0.7] });
      st.dispose();
    }
    // green halo behind the hand (additive): rims the black silhouette, the hand never glows itself
    haloQuads.push(new THREE.Vector3(0, 0, 0.04).applyMatrix4(m), 1.05, m);
  }

  // ---------------------------------------------------------------- assemble
  if (haloQuads.length) {
    const mat = new THREE.MeshBasicMaterial({ map: getSoftTexture(), color: new THREE.Color(BANE_LIGHT).multiplyScalar(0.12), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (let i = 0; i < haloQuads.length; i += 3) {
      const r = haloQuads[i + 1];
      const pg = new THREE.PlaneGeometry(r * 2.2, r * 2.2);
      const mesh = new THREE.Mesh(pg, mat);
      mesh.applyMatrix4(haloQuads[i + 2].clone().multiply(tr(0, 0, 0.045)));
      mesh.renderOrder = 4;
      group.add(mesh);
      own.push(pg);
    }
    own.push(mat);
  }
  for (const [key, geo] of g.build()) {
    const mesh = new THREE.Mesh(geo, getMaterial(key));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    group.add(mesh);
    own.push(geo);
  }
  if (runnelQuads.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a1012, roughness: 0.05, metalness: 0, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -2 });
    const b = new GeoBuilder();
    for (const [x, z, sx, sz] of runnelQuads) b.quad('w', new THREE.Vector3(x - sx / 2, 0.006, z + sz / 2), new THREE.Vector3(x + sx / 2, 0.006, z + sz / 2), new THREE.Vector3(x + sx / 2, 0.006, z - sz / 2), new THREE.Vector3(x - sx / 2, 0.006, z - sz / 2), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    const geo = b.build().get('w');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.userData.glossy = true;
    group.add(mesh);
    own.push(geo, mat);
  }
  // pools of fire-light on the floor around braziers (the pooled real-time lights can't reach them all)
  const glowPools = lamps.filter((l) => l.kind === 'brazier');
  if (glowPools.length) {
    const mat = new THREE.MeshBasicMaterial({ map: getSoftTexture(), color: BANE_LIGHT, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
    const b = new GeoBuilder();
    for (const l of glowPools) {
      const r = 1.8;
      b.quad('gp', new THREE.Vector3(l.pos.x - r, 0.02, l.pos.z + r), new THREE.Vector3(l.pos.x + r, 0.02, l.pos.z + r), new THREE.Vector3(l.pos.x + r, 0.02, l.pos.z - r), new THREE.Vector3(l.pos.x - r, 0.02, l.pos.z - r), [[0, 0], [1, 0], [1, 1], [0, 1]], { ao: 1 });
    }
    const geo = b.build().get('gp');
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    group.add(mesh);
    own.push(geo, mat);
  }
  if (blobs.length) {
    const pos = [];
    const uv = [];
    const col = [];
    for (const bl of blobs) {
      for (const [a, c] of [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]) {
        pos.push(bl.x + a * bl.r, 0.014, bl.z + c * bl.r);
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
  void opts;
  void CELL;
  return {
    group,
    lamps,
    dispose() {
      for (const o of own) o.dispose?.();
      group.removeFromParent();
    },
  };
}

/** Per-rock tone jitter. */
function rt(a, b) {
  const t = 0.78 + hash(a, b, 'rt') * 0.35;
  const w = (hash(a, b, 'rw') - 0.5) * 0.1;
  return [t * (1 + w), t, t * (1 - w)];
}

/**
 * Tube along points with a radius tapering from r0 to r1 (roots, rootlets).
 * @returns {THREE.BufferGeometry}
 */
export function taperTube(points, r0, r1, radial = 5) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const n = points.length;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const tng = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    const ref = Math.abs(tng.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3().crossVectors(tng, ref).normalize();
    const b = new THREE.Vector3().crossVectors(tng, a).normalize();
    const r = r0 + (r1 - r0) * (i / (n - 1));
    const ring = [];
    for (let k = 0; k < radial; k++) {
      const th = (k / radial) * Math.PI * 2;
      const dir = a.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
      ring.push({ p: p.clone().addScaledVector(dir, r), n: dir });
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i][k], rings[i + 1][k2], rings[i + 1][k]];
      for (const v of q) {
        pos.push(v.p.x, v.p.y, v.p.z);
        nrm.push(v.n.x, v.n.y, v.n.z);
        uv.push(k / radial, i / n);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/** Gentle cloth sway (uv.y = 1 at the rod). */
function clothSway(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = PROP_UNIFORMS.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float hang = 1.0 - uv.y;
          vec4 wp0 = modelMatrix * vec4(position, 1.0);
          float ph = wp0.x * 0.7 + wp0.z * 0.9;
          float w = sin(uTime * 0.9 + ph + hang * 2.0) * 0.025;
          transformed.x += w * hang * hang;
          transformed.z += w * hang * hang * 0.6;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'cloth_slow';
}
