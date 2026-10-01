import * as THREE from 'three';
import { CELL, EDGE } from '../../data/maps/MapGrid.js';
import { getMaterial } from '../../render/materials.js';
import { getBaneBannerTexture, getRunnerTexture, getBlobTexture, getSoftTexture } from '../../render/textures/index.js';
import { GeoBuilder, hash } from './GeoBuilder.js';
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
  const runnelQuads = [];
  const rocks = [0, 1, 2, 3, 4].map((k) => fracturedRock(40 + k, false));
  const chunks = [0, 1, 2].map((k) => fracturedRock(60 + k, true));
  own.push(...rocks, ...chunks);
  const P = (f, s, y, d) => new THREE.Vector3(s, y, d).applyMatrix4(f.basis);
  const onFace = (f, s, y, d) => new THREE.Matrix4().multiplyMatrices(f.basis, tr(s, y, d));

  if (ts.variant === 'warrens') warrens();
  else if (ts.variant === 'bane') bane();

  // ---------------------------------------------------------------- WARRENS
  function warrens() {
    const ceil = ts.ceilH;
    for (const f of block.spots.cave) {
      const sd = f.seed;
      const clear = (s) => !f.openings.some((o) => o.s0 - 0.4 < s && o.s1 + 0.4 > s);
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
      // knuckles of rock hanging from the roof
      for (let k = 0; k < 2; k++) {
        if (hash(map.id, fc.x, fc.y, k, 'ck') > 0.6) continue;
        const sc = 0.5 + hash(map.id, fc.x, fc.y, k, 'cs') * 0.7;
        const m = tr(cx + (hash(map.id, fc.x, fc.y, k, 'cx') - 0.5) * 2.2, ts.ceilH + 0.05, cz + (hash(map.id, fc.x, fc.y, k, 'cz') - 0.5) * 2.2)
          .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI, hash(map.id, fc.x, fc.y, k) * 6.3, 0)))
          .multiply(new THREE.Matrix4().makeScale(sc * 1.4, sc * 0.6, sc));
        g.geometry('arch_hewn', rocks[(fc.x + k) % rocks.length], m, { uv: 'world', tint: rt(fc.x, fc.y + k), ao: 0.7 });
      }
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
    // the altar: wherever an event names it (or the sanctum's heart)
    const altarEv = (map.events ?? []).find((e) => /altar/i.test(`${e.id} ${e.ref ?? ''}`));
    if (altarEv) altar(altarEv.x, altarEv.y);

    if (banners.length) {
      const mat = new THREE.MeshStandardMaterial({ map: getBaneBannerTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, color: 0xe0d0d0 });
      clothSway(mat);
      const b = new GeoBuilder();
      for (const bn of banners) {
        const { f, s, top } = bn;
        const w = 1.0;
        const h = 2.7;
        const segs = 8;
        const d = T / 2 + 0.06;
        for (let k = 0; k < segs; k++) {
          const s0 = s - w / 2 + (w * k) / segs;
          const s1 = s - w / 2 + (w * (k + 1)) / segs;
          const fold = (q) => 0.012 + 0.03 * Math.abs(Math.sin((q / segs) * Math.PI * 2.5));
          b.quad('ban', P(f, s0, top - h, d + fold(k) * 0.4), P(f, s1, top - h, d + fold(k + 1) * 0.4), P(f, s1, top, d + fold(k + 1)), P(f, s0, top, d + fold(k)), [[k / segs, 0], [(k + 1) / segs, 0], [(k + 1) / segs, 1], [k / segs, 1]], { ao: 1 });
        }
        // iron rod with finials, on two brackets
        g.box('prop_iron', { matrix: onFace(f, s, top + 0.03, d + 0.03), s: [w + 0.24, 0.035, 0.035] });
        for (const e of [-1, 1]) {
          g.box('prop_iron', { matrix: onFace(f, s + e * (w / 2 + 0.12), top + 0.03, d + 0.03), s: [0.06, 0.06, 0.06], chamfer: 0.015 });
          g.box('prop_iron', { matrix: onFace(f, s + e * (w / 2 - 0.05), top + 0.03, T / 2 + 0.04), s: [0.025, 0.025, 0.09] });
        }
      }
      const geo = b.build().get('ban');
      geo.deleteAttribute('color');
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

  function brazier(m, seed) {
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
    const m = tr(cx, 0, cz).multiply(new THREE.Matrix4().makeRotationY(rot));
    const at = (px, py, pz) => m.clone().multiply(tr(px, py, pz));
    // stepped dais
    g.box('arch_basalt', { matrix: at(0, 0.1, -0.2), s: [2.9, 0.2, 2.2], chamfer: 0.03, tint: [0.8, 0.76, 0.76] });
    g.box('arch_basalt', { matrix: at(0, 0.27, -0.35), s: [2.4, 0.15, 1.5], chamfer: 0.03, tint: [0.85, 0.8, 0.8] });
    // altar block with a polished top and a channel for the blood
    g.box('arch_basalt', { matrix: at(0, 0.82, -0.35), s: [1.8, 0.95, 0.85], chamfer: 0.04 });
    g.box('arch_basalt', { matrix: at(0, 1.33, -0.35), s: [1.95, 0.08, 0.98], chamfer: 0.02, tint: [1.1, 1.05, 1.05] });
    // red altar cloth hanging over the front
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6a0c0a, roughness: 0.9 });
    const cg = new THREE.BoxGeometry(0.9, 0.86, 0.012);
    const cm = new THREE.Mesh(cg, cloth);
    cm.applyMatrix4(at(0, 0.95, 0.09));
    cm.castShadow = true;
    cm.receiveShadow = true;
    group.add(cm);
    own.push(cg, cloth);
    // the stele behind it: a tall slab carrying a great relief of the Black Hand
    g.box('arch_basalt', { matrix: at(0, 1.9, -1.25), s: [2.3, 3.8, 0.4], chamfer: 0.05 });
    g.box('arch_basalt', { matrix: at(0, 3.86, -1.25), s: [2.6, 0.18, 0.55], chamfer: 0.04, tint: [0.9, 0.85, 0.85] });
    const rp = (px, py) => new THREE.Vector3(px, py, -1.04).applyMatrix4(m);
    g.quad('arch_relief', rp(-0.95, 1.55), rp(0.95, 1.55), rp(0.95, 3.45), rp(-0.95, 3.45), [[0, 1], [1, 1], [1, 0], [0, 0]], { ao: 1 });
    // black candles on the altar
    for (let k = 0; k < 5; k++) {
      const px = -0.75 + k * 0.375;
      const ch = 0.14 + hash(x, y, k, 'cand') * 0.12;
      const cyl = new THREE.CylinderGeometry(0.025, 0.028, ch, 8);
      g.geometry('arch_beam_dark', cyl, at(px, 1.37 + ch / 2, -0.62), { uv: 'world', tint: [0.12, 0.1, 0.1] });
      cyl.dispose();
      if (k % 2 === 0) lamps.push({ pos: new THREE.Vector3(px, 1.37 + ch + 0.03, -0.62).applyMatrix4(m), kind: 'candle', lit: true, seed: 300 + k });
    }
    // braziers either side of the dais
    for (const sx of [-1.75, 1.75]) brazier(at(sx, 0, 0.3), x * 7 + sx);
    blobs.push({ x: cx, z: cz - 0.35, r: 1.6, a: 0.5 });
  }

  // ---------------------------------------------------------------- assemble
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
