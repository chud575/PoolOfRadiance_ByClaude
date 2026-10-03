import * as THREE from 'three';
import { EDGE } from '../../data/maps/MapGrid.js';
import { getMaterial } from '../../render/materials.js';
import { getBlobTexture } from '../../render/textures/index.js';
import { GeoBuilder, hash } from './GeoBuilder.js';
import { CELL_SIZE, WALL_T } from './BlockBuilder.js';

const S = CELL_SIZE;
const T = WALL_T;
const tr = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const rotY = (a) => new THREE.Matrix4().makeRotationY(a);

/** Zones furnished as a tavern common room (generic wall clutter is skipped there). */
export function isTavernZone(map, x, y) {
  return /common room|tavern|taproom|\binn\b|alehouse/i.test(map.zoneAt?.(x, y) ?? '');
}

/**
 * Set dressing for tavern common rooms (explore-renderer): a bar counter with
 * the innkeeper behind it and a back shelf of bottles and jugs, trestle
 * tables with benches, tankards, trenchers and lit candles, and a stack of
 * casks. Laid out from the zone rectangle and the hearth wall.
 * @returns {{group: THREE.Group, lamps: any[], dispose: () => void}}
 */
export function dressRooms(map) {
  const group = new THREE.Group();
  group.name = 'rooms';
  const g = new GeoBuilder();
  const own = [];
  const lamps = [];
  const blobs = [];
  const zones = (map.zones ?? []).filter((z) => /common room|tavern|taproom|\binn\b|alehouse/i.test(z.name ?? ''));
  let patrons = 0;
  for (const z of zones) commonRoom(z);

  function commonRoom(z) {
    const x0 = z.x * S;
    const z0 = z.y * S;
    const x1 = (z.x + z.w) * S;
    const z1 = (z.y + z.h) * S;
    const hearths = [...(map.hearths ?? []), ...(map.hearth ? [map.hearth] : [])];
    const hearth = hearths.find((h) => h.x >= z.x && h.x < z.x + z.w && h.y >= z.y && h.y < z.y + z.h);
    const hDir = hearth?.dir ?? 'W';
    // the bar runs along the side wall to the right of the hearth, its near end by the hearth
    const alongX = hDir === 'W' || hDir === 'E';
    const hearthAtMin = hDir === 'W' || hDir === 'N';
    const barLen = Math.min(alongX ? x1 - x0 : z1 - z0, 1.45 * S) - 0.4;
    const barSideMin = true; // north (or west) wall
    const inset = T / 2 + 1.25;
    let barA;
    let barB;
    let barC;
    if (alongX) {
      barA = hearthAtMin ? x0 + T / 2 + 0.3 : x1 - T / 2 - 0.3 - barLen;
      barB = barA + barLen;
      barC = barSideMin ? z0 + inset : z1 - inset;
    } else {
      barA = hearthAtMin ? z0 + T / 2 + 0.3 : z1 - T / 2 - 0.3 - barLen;
      barB = barA + barLen;
      barC = barSideMin ? x0 + inset : x1 - inset;
    }
    const P = (a, y, c) => (alongX ? new THREE.Vector3(a, y, c) : new THREE.Vector3(c, y, a));
    const M = (a, y, c, ang = 0) => {
      const p = P(a, y, c);
      return tr(p.x, p.y, p.z).multiply(rotY((alongX ? 0 : Math.PI / 2) + ang));
    };
    const len = barB - barA;
    const mid = (barA + barB) / 2;
    // counter: plank front panels, a thick top with a rounded nosing, a foot rail
    g.box('prop_wood', { matrix: M(mid, 0.52, barC), s: [len, 1.04, 0.55], chamfer: 0.02, uv: 'along', tint: [0.62, 0.48, 0.36] });
    g.box('prop_wood', { matrix: M(mid, 1.07, barC + 0.02), s: [len + 0.12, 0.07, 0.72], chamfer: 0.025, uv: 'along', tint: [0.8, 0.62, 0.45] });
    for (let a = barA + 0.25; a < barB - 0.1; a += 0.5) g.box('prop_wood', { matrix: M(a, 0.52, barC + 0.285), s: [0.06, 1.0, 0.04], uv: 'along', tint: [0.45, 0.34, 0.25] });
    g.box('prop_iron', { matrix: M(mid, 0.15, barC + 0.42), s: [len, 0.035, 0.035] });
    blobs.push({ ...vec2(P(mid, 0, barC)), r: len * 0.55, a: 0.45 });
    // things on the counter: tankards, a jug, a candle, the rag
    for (let k = 0; k < 4; k++) tankard(M(barA + 0.4 + k * (len - 0.8) / 3 + (hash(z.name, k, 'tk') - 0.5) * 0.3, 1.105, barC + 0.08, hash(z.name, k) * 6));
    jug(M(barB - 0.5, 1.105, barC - 0.1));
    candle(M(barA + 0.7, 1.105, barC - 0.12));
    // back shelf against the wall: bottles, jugs, a row of casks underneath
    const wallC = barSideMin ? (alongX ? z0 : x0) + T / 2 : (alongX ? z1 : x1) - T / 2;
    const sh = barSideMin ? 1 : -1;
    for (const y of [1.25, 1.75]) {
      g.box('prop_wood', { matrix: M(mid, y, wallC + sh * 0.18), s: [len - 0.2, 0.04, 0.34], uv: 'along', tint: [0.55, 0.42, 0.3] });
      for (let k = 0; k < 9; k++) {
        const a = barA + 0.35 + k * ((len - 0.7) / 8);
        const kind = hash(z.name, y, k, 'sh');
        if (kind < 0.55) bottle(M(a, y + 0.02, wallC + sh * 0.16), kind);
        else if (kind < 0.8) jug(M(a, y + 0.02, wallC + sh * 0.16), 0.75);
      }
    }
    for (let k = 0; k < 3; k++) cask(M(barA + 0.6 + k * 0.85, 0.42, wallC + sh * 0.42, Math.PI / 2), 0.78);
    // the innkeeper behind his counter, between the bar and the back shelf, facing the room
    innkeeper(M(barA + len * 0.38, 0, barC - sh * 0.66, sh > 0 ? 0 : Math.PI));
    // trestle tables in the open cells (keep the hearth's approach and the bar clear)
    const cells = [];
    for (let j = 0; j < z.h; j++) {
      for (let i = 0; i < z.w; i++) {
        const cx = z.x + i;
        const cy = z.y + j;
        const cc = new THREE.Vector3(cx * S + S / 2, 0, cy * S + S / 2);
        const onBar = alongX ? Math.abs(cc.z - barC) < 1.6 && cc.x > barA - 0.5 && cc.x < barB + 0.5 : Math.abs(cc.x - barC) < 1.6 && cc.z > barA - 0.5 && cc.z < barB + 0.5;
        const hearthFront = hearth && ((alongX && cy === hearth.y && cx === hearth.x) || (!alongX && cx === hearth.x && cy === hearth.y));
        // the cell before the hearth approach keeps a table, pushed aside so the fire stays in view
        const nearHearth = hearth && ((alongX && cy === hearth.y && Math.abs(cx - hearth.x) === 1) || (!alongX && cx === hearth.x && Math.abs(cy - hearth.y) === 1));
        if (onBar || hearthFront) continue;
        if (nearHearth) {
          cc.near = true;
          if (alongX) cc.z += 0.95;
          else cc.x += 0.95;
        }
        cells.push(cc);
      }
    }
    // a stair up to the rooms along the far side wall (rising away from the door end toward the
    // hearth wall), with a newel, balusters and a handrail; the cells it runs past stay clear
    const stairSideC = barSideMin ? (alongX ? z1 : x1) - T / 2 : (alongX ? z0 : x0) + T / 2;
    const ss = barSideMin ? -1 : 1;
    const ceil = 3.3;
    const nSteps = 13;
    const rise = (ceil - 0.05) / nSteps;
    const run = 0.27;
    const stairStart = hearthAtMin ? barA + nSteps * run + 1.2 : barB - nSteps * run - 1.2;
    const dirA = hearthAtMin ? -1 : 1;
    const sw = 0.95;
    for (let k = 0; k < nSteps; k++) {
      const a = stairStart + dirA * (k + 0.5) * run;
      const y = (k + 1) * rise;
      g.box('prop_wood', { matrix: M(a, y - 0.03, stairSideC + ss * sw / 2), s: [run + 0.03, 0.05, sw], chamfer: 0.008, uv: 'along', tint: [0.7, 0.55, 0.4] });
      g.box('prop_wood', { matrix: M(a - dirA * (run / 2 - 0.01), y - rise / 2 - 0.02, stairSideC + ss * sw / 2), s: [0.025, rise - 0.04, sw - 0.04], uv: 'along', tint: [0.45, 0.34, 0.25] });
      // a baluster per tread
      g.box('prop_wood', { matrix: M(a, y + 0.45, stairSideC + ss * (sw - 0.03)), s: [0.035, 0.9, 0.035], chamfer: 0.006, uv: 'along', tint: [0.55, 0.42, 0.3] });
    }
    // strings (sloping side boards) and the handrail
    {
      const aEnd = stairStart + dirA * nSteps * run;
      const L = Math.hypot(nSteps * run, ceil);
      const ang = Math.atan2(ceil, nSteps * run) * dirA * (alongX ? 1 : -1);
      const am = (stairStart + aEnd) / 2;
      // deep closed strings either side, and a boarded soffit underneath: the stair is a solid
      // piece of joinery, not a see-through ladder of treads
      for (const off of [0.02, sw - 0.02]) g.box('prop_wood', { matrix: M(am, ceil / 2 - 0.16, stairSideC + ss * off).multiply(new THREE.Matrix4().makeRotationZ(ang)), s: [L, 0.42, 0.055], chamfer: 0.01, uv: 'along', tint: [0.5, 0.38, 0.28] });
      g.box('prop_wood', { matrix: M(am, ceil / 2 - 0.33, stairSideC + ss * sw / 2).multiply(new THREE.Matrix4().makeRotationZ(ang)), s: [L, 0.03, sw - 0.06], uv: 'along', tint: [0.36, 0.28, 0.21], ao: 0.55 });
      // a stout carriage post propping the string at mid-flight
      g.box('prop_wood', { matrix: M(am, ceil / 4 - 0.22, stairSideC + ss * (sw - 0.03)), s: [0.12, ceil / 2 - 0.44, 0.12], chamfer: 0.015, uv: 'along', tint: [0.5, 0.38, 0.28] });
      g.box('prop_wood', { matrix: M(am, ceil / 2 + 0.85, stairSideC + ss * (sw - 0.03)).multiply(new THREE.Matrix4().makeRotationZ(ang)), s: [L, 0.07, 0.08], chamfer: 0.02, uv: 'along', tint: [0.68, 0.52, 0.38] });
      // newel post at the foot with a turned cap
      g.box('prop_wood', { matrix: M(stairStart, 0.6, stairSideC + ss * (sw - 0.03)), s: [0.12, 1.2, 0.12], chamfer: 0.015, uv: 'along', tint: [0.6, 0.46, 0.33] });
      const cap = new THREE.SphereGeometry(0.08, 10, 6);
      g.geometry('prop_wood', cap, M(stairStart, 1.25, stairSideC + ss * (sw - 0.03)), { uv: 'world', tint: [0.6, 0.46, 0.33] });
      cap.dispose();
      // a dark trap in the ceiling the stair climbs through
      const trap = new THREE.PlaneGeometry(nSteps * run * 0.45, sw + 0.1);
      trap.rotateX(Math.PI / 2);
      g.geometry('arch_beam_dark', trap, M(aEnd - dirA * nSteps * run * 0.22, ceil - 0.03, stairSideC + ss * sw / 2), { uv: 'world', tint: [0.06, 0.05, 0.04], ao: 0.3 });
      trap.dispose();
      blobs.push({ ...vec2(P(am, 0, stairSideC + ss * sw / 2)), r: 1.4, a: 0.4 });
    }
    // under the stair: stacked casks, sacks of meal and a crate
    for (let k = 0; k < 2; k++) cask(M(stairStart + dirA * (1.9 + k * 0.85), 0.42, stairSideC + ss * 0.45, Math.PI / 2), 0.8);
    cask(M(stairStart + dirA * 2.3, 1.05, stairSideC + ss * 0.45, Math.PI / 2), 0.72);
    for (let k = 0; k < 3; k++) {
      const sk = new THREE.LatheGeometry([[0, 0], [0.18, 0.01], [0.24, 0.08], [0.25, 0.2], [0.22, 0.34], [0.14, 0.42], [0.06, 0.48], [0.07, 0.54], [0, 0.56]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
      g.geometry('prop_cloth', sk, M(stairStart + dirA * (3.4 + k * 0.42), 0, stairSideC + ss * (0.35 + (k % 2) * 0.2), k), { uv: 'world', tint: [0.75, 0.66, 0.5] });
      sk.dispose();
    }
    // bunches of drying herbs and a string of onions hung from the joists over the bar
    for (let k = 0; k < 7; k++) {
      const a = barA + 0.4 + k * ((len - 0.8) / 6);
      const hm = M(a, ceil - 0.2, barC - sh * 0.2 + (hash(z.name, k, 'hz') - 0.5) * 0.3);
      g.box('prop_burlap', { matrix: hm.clone().multiply(tr(0, 0.08, 0)), s: [0.006, 0.2, 0.006], tint: [0.5, 0.42, 0.3] });
      const bunch = new THREE.ConeGeometry(0.07 + hash(z.name, k, 'hb') * 0.04, 0.32, 7);
      const herbT = k % 3 === 2 ? [0.62, 0.5, 0.3] : [0.42, 0.5, 0.26];
      g.geometry('prop_cloth', bunch, hm.clone().multiply(tr(0, -0.18, 0)), { uv: 'world', tint: herbT });
      bunch.dispose();
    }
    // (the table drawn up by the hearth first: it is where the regulars sit)
    const order = [...cells.entries()].sort((a, b) => (b[1].near ? 1 : 0) - (a[1].near ? 1 : 0));
    for (const [k, c] of order) {
      if (!c.near && hash(z.name, k, 'tbl') < 0.25) continue;
      // keep the stair's foot clear
      const ca = alongX ? c.x : c.z;
      const cc = alongX ? c.z : c.x;
      if (Math.abs(cc - stairSideC) < 1.6 && (dirA < 0 ? ca < stairStart + 0.8 : ca > stairStart - 0.8)) continue;
      tableSet(c, c.near ? (alongX ? 0 : Math.PI / 2) : hash(z.name, k, 'tr') < 0.5 ? 0 : Math.PI / 2, k);
    }
    // the innkeeper's apron and a coat on pegs by the back shelf, a slate of prices
    {
      const pegA = barB - 0.15;
      const pm = M(pegA, 1.62, wallC + sh * 0.03);
      g.box('prop_wood', { matrix: pm.clone(), s: [0.7, 0.07, 0.04], chamfer: 0.01, uv: 'along', tint: [0.5, 0.38, 0.28] });
      for (const dx of [-0.22, 0.2]) g.box('prop_wood', { matrix: pm.clone().multiply(tr(dx, 0.0, sh * 0.06)).multiply(new THREE.Matrix4().makeRotationX(sh * 0.5)), s: [0.025, 0.025, 0.12], uv: 'along', tint: [0.42, 0.32, 0.24] });
      // apron: a stiff leather panel hanging from its neck strap, folded over at the waist tie
      const apron = new THREE.PlaneGeometry(0.42, 0.72, 4, 6);
      const ap = apron.attributes.position;
      for (let i = 0; i < ap.count; i++) {
        const x = ap.getX(i);
        const y = ap.getY(i);
        ap.setZ(i, Math.cos(x * 7) * 0.012 + (0.36 - y) * 0.05);
        ap.setX(i, x * (1 - (0.36 - y) * 0.12));
      }
      apron.computeVertexNormals();
      g.geometry('prop_cloth', apron, pm.clone().multiply(tr(-0.22, -0.4, sh * 0.03)).multiply(rotY(sh > 0 ? 0 : Math.PI)), { uv: 'world', tint: [0.55, 0.4, 0.28] });
      apron.dispose();
      g.box('prop_cloth', { matrix: pm.clone().multiply(tr(-0.22, -0.02, sh * 0.03)), s: [0.18, 0.012, 0.01], tint: [0.4, 0.3, 0.22] });
      // a dark wool cloak bunched on the other peg
      const cl = new THREE.CylinderGeometry(0.06, 0.2, 0.95, 9, 3, true);
      g.geometry('prop_cloth', cl, pm.clone().multiply(tr(0.2, -0.47, sh * 0.1)), { uv: 'world', tint: [0.3, 0.27, 0.3] });
      cl.dispose();
    }
  }

  function vec2(p) {
    return { x: p.x, z: p.z };
  }

  function tankard(m, rot = 0) {
    const mm = m.clone().multiply(rotY(rot));
    const body = new THREE.CylinderGeometry(0.045, 0.05, 0.13, 10, 1);
    g.geometry('prop_staves', body, mm.clone().multiply(tr(0, 0.065, 0)), { uv: 'world', tint: [0.8, 0.7, 0.6] });
    body.dispose();
    for (const y of [0.025, 0.105]) {
      const hoop = new THREE.TorusGeometry(0.049, 0.006, 4, 12);
      hoop.rotateX(Math.PI / 2);
      g.geometry('prop_iron', hoop, mm.clone().multiply(tr(0, y, 0)), { uv: 'world' });
      hoop.dispose();
    }
    const handle = new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI);
    handle.rotateZ(-Math.PI / 2);
    g.geometry('prop_wood', handle, mm.clone().multiply(tr(0.05, 0.07, 0)), { uv: 'world', tint: [0.6, 0.5, 0.4] });
    handle.dispose();
    const foam = new THREE.CircleGeometry(0.042, 10);
    foam.rotateX(-Math.PI / 2);
    g.geometry('prop_bone', foam, mm.clone().multiply(tr(0, 0.125, 0)), { uv: 'world', tint: [1, 0.95, 0.85] });
    foam.dispose();
  }
  function jug(m, sc = 1) {
    const geo = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.085, 0.05], [0.09, 0.12], [0.06, 0.2], [0.04, 0.24], [0.05, 0.26], [0, 0.26]].map(([r, y]) => new THREE.Vector2(r * sc, y * sc)), 12);
    g.geometry('arch_brick', geo, m, { uv: 'world', tint: [0.9, 0.72, 0.55] });
    geo.dispose();
    const h = new THREE.TorusGeometry(0.05 * sc, 0.01 * sc, 4, 10, Math.PI);
    h.rotateZ(-Math.PI / 2);
    g.geometry('arch_brick', h, m.clone().multiply(tr(0.085 * sc, 0.15 * sc, 0)), { uv: 'world', tint: [0.9, 0.72, 0.55] });
    h.dispose();
  }
  function bottle(m, k) {
    const geo = new THREE.LatheGeometry([[0, 0], [0.04, 0], [0.045, 0.02], [0.045, 0.16], [0.018, 0.22], [0.014, 0.28], [0, 0.28]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
    g.geometry('prop_iron', geo, m, { uv: 'world', tint: k < 0.25 ? [0.4, 0.8, 0.45] : k < 0.4 ? [0.8, 0.55, 0.3] : [0.55, 0.45, 0.7] });
    geo.dispose();
  }
  function cask(m, sc) {
    const prof = [[0.25, 0], [0.27, 0.05], [0.31, 0.25], [0.325, 0.42], [0.31, 0.6], [0.27, 0.8], [0.25, 0.85]].map(([r, y]) => new THREE.Vector2(r * sc, (y - 0.425) * sc));
    const body = new THREE.LatheGeometry(prof, 16);
    body.rotateZ(Math.PI / 2);
    g.geometry('prop_staves', body, m, { uv: 'world' });
    body.dispose();
    for (const s of [-1, 1]) {
      const lid = new THREE.CircleGeometry(0.25 * sc, 16);
      lid.rotateY((s * Math.PI) / 2);
      g.geometry('prop_wood', lid, m.clone().multiply(tr(s * 0.42 * sc, 0, 0)), { uv: 'world', tint: [0.7, 0.55, 0.4] });
      lid.dispose();
    }
    g.box('prop_wood', { matrix: m.clone().multiply(tr(0, -0.3 * sc, 0)), s: [0.7 * sc, 0.08, 0.5 * sc], uv: 'along', tint: [0.5, 0.4, 0.3] });
  }
  function candle(m) {
    const c = new THREE.CylinderGeometry(0.022, 0.026, 0.11, 8);
    g.geometry('prop_bone', c, m.clone().multiply(tr(0, 0.07, 0)), { uv: 'world', tint: [1, 0.95, 0.85] });
    c.dispose();
    const dish = new THREE.CylinderGeometry(0.06, 0.05, 0.015, 12);
    g.geometry('prop_iron', dish, m.clone().multiply(tr(0, 0.008, 0)), { uv: 'world' });
    dish.dispose();
    lamps.push({ pos: new THREE.Vector3(0, 0.16, 0).applyMatrix4(m), kind: 'candle', lit: true, seed: Math.floor(Math.abs(m.elements[12] * 31 + m.elements[14] * 17)) % 997 });
  }
  function tableSet(c, rot, k) {
    const m = tr(c.x + (hash(k, 'tx') - 0.5) * 0.4, 0, c.z + (hash(k, 'tz') - 0.5) * 0.4).multiply(rotY(rot + (hash(k, 'ta') - 0.5) * 0.15));
    // trestle table: thick top, splayed trestles, a stretcher
    g.box('prop_wood', { matrix: m.clone().multiply(tr(0, 0.78, 0)), s: [1.7, 0.07, 0.78], chamfer: 0.02, uv: 'along', tint: [0.72, 0.56, 0.42] });
    for (const x of [-0.6, 0.6]) {
      for (const s of [-1, 1]) g.box('prop_wood', { matrix: m.clone().multiply(tr(x, 0.38, s * 0.16)).multiply(new THREE.Matrix4().makeRotationX(s * 0.38)), s: [0.08, 0.8, 0.08], uv: 'along', tint: [0.55, 0.43, 0.32] });
      g.box('prop_wood', { matrix: m.clone().multiply(tr(x, 0.72, 0)), s: [0.1, 0.06, 0.66], uv: 'along', tint: [0.55, 0.43, 0.32] });
    }
    g.box('prop_wood', { matrix: m.clone().multiply(tr(0, 0.3, 0)), s: [1.3, 0.06, 0.07], uv: 'along', tint: [0.55, 0.43, 0.32] });
    // benches (and whoever is drinking at them)
    const seated = [];
    for (const s of [-1, 1]) {
      if (hash(k, s, 'bench') < 0.2) continue;
      const bm = m.clone().multiply(tr(0, 0, s * 0.68)).multiply(rotY((hash(k, s, 'br') - 0.5) * 0.12));
      g.box('prop_wood', { matrix: bm.clone().multiply(tr(0, 0.45, 0)), s: [1.6, 0.06, 0.3], chamfer: 0.012, uv: 'along', tint: [0.66, 0.52, 0.4] });
      for (const x of [-0.65, 0.65]) g.box('prop_wood', { matrix: bm.clone().multiply(tr(x, 0.22, 0)), s: [0.06, 0.44, 0.26], uv: 'along', tint: [0.55, 0.43, 0.32] });
      if (patrons < 3 && hash(k, s, 'pat') < 0.85) {
        const px = (hash(k, s, 'ppx') - 0.5) * 0.7;
        patron(bm.clone().multiply(tr(px, 0, 0)).multiply(rotY(s > 0 ? Math.PI : 0)), k * 3 + s + 7);
        seated.push([px, s]);
        patrons++;
      }
    }
    // on the table
    const top = m.clone().multiply(tr(0, 0.815, 0));
    for (let q = 0; q < 3; q++) if (hash(k, q, 'mug') < 0.75) tankard(top.clone().multiply(tr(-0.55 + q * 0.5 + (hash(k, q, 'mx') - 0.5) * 0.2, 0, (hash(k, q, 'mz') - 0.5) * 0.4)), hash(k, q) * 6);
    const plate = new THREE.CylinderGeometry(0.13, 0.11, 0.02, 14);
    for (let q = 0; q < 2; q++) {
      const pm = top.clone().multiply(tr(-0.3 + q * 0.65, 0.01, (q ? -0.18 : 0.2)));
      g.geometry('prop_wood', plate, pm, { uv: 'world', tint: [0.8, 0.65, 0.5] });
      // a heel of bread on the trencher
      const bread = new THREE.SphereGeometry(0.07, 8, 6);
      bread.scale(1.3, 0.6, 1);
      g.geometry('prop_burlap', bread, pm.clone().multiply(tr(0.02, 0.035, 0)), { uv: 'world', tint: [1.1, 0.8, 0.5] });
      bread.dispose();
    }
    plate.dispose();
    // a drinker's clutter before each seated patron: tankards bunched by the hand, a bowl of
    // pottage with a spoon, crusts, and a dark spill soaking into the boards
    for (const [px, s] of seated) {
      const base = top.clone().multiply(tr(px, 0, s * 0.2));
      for (let q = 0; q < 2 + (hash(k, s, 'tq') < 0.5 ? 1 : 0); q++) tankard(base.clone().multiply(tr(0.16 + q * 0.1, 0, (q % 2) * 0.09 - 0.03)), hash(k, s, q, 'tr') * 6);
      const bowl = new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.085, 0.03], [0.095, 0.06], [0.088, 0.062], [0.075, 0.035], [0, 0.03]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
      g.geometry('prop_wood', bowl, base.clone().multiply(tr(-0.12, 0.002, 0)), { uv: 'world', tint: [0.7, 0.52, 0.36] });
      bowl.dispose();
      const stew = new THREE.CircleGeometry(0.078, 12);
      stew.rotateX(-Math.PI / 2);
      g.geometry('prop_burlap', stew, base.clone().multiply(tr(-0.12, 0.05, 0)), { uv: 'world', tint: [0.62, 0.38, 0.18] });
      stew.dispose();
      g.box('prop_iron', { matrix: base.clone().multiply(tr(-0.05, 0.055, 0.02)).multiply(rotY(0.6)).multiply(new THREE.Matrix4().makeRotationZ(0.35)), s: [0.15, 0.008, 0.016] });
      const spill = new THREE.CircleGeometry(0.07 + hash(k, s, 'sp') * 0.06, 10);
      spill.rotateX(-Math.PI / 2);
      spill.scale(1.5, 1, 1);
      g.geometry('arch_beam_dark', spill, base.clone().multiply(tr(0.28, 0.002, -0.06)), { uv: 'world', tint: [0.3, 0.2, 0.12] });
      spill.dispose();
    }
    if (seated.length) {
      // a roast fowl on a board, shared
      const fm = top.clone().multiply(tr(0.45, 0.012, 0));
      g.box('prop_wood', { matrix: fm, s: [0.34, 0.025, 0.24], chamfer: 0.006, uv: 'along', tint: [0.75, 0.58, 0.42] });
      const bird = new THREE.SphereGeometry(0.075, 10, 8);
      bird.scale(1.3, 0.75, 1);
      g.geometry('prop_burlap', bird, fm.clone().multiply(tr(0, 0.055, 0)), { uv: 'world', tint: [0.9, 0.52, 0.22] });
      bird.dispose();
      for (const sz of [-1, 1]) {
        const leg = new THREE.CapsuleGeometry(0.022, 0.06, 3, 6);
        leg.rotateZ(Math.PI / 2 - 0.4);
        g.geometry('prop_burlap', leg, fm.clone().multiply(tr(0.09, 0.05, sz * 0.045)), { uv: 'world', tint: [0.85, 0.48, 0.2] });
        leg.dispose();
      }
    }
    candle(top.clone().multiply(tr(0.1, 0, 0.02)));
    blobs.push({ x: c.x, z: c.z, r: 1.2, a: 0.45 });
  }

  /**
   * A drinker seated on a bench, hunched over the table (origin: on the floor under the bench
   * seat, facing +z toward the table): cloak or jerkin, hood up or a felt cap, forearms on the
   * board, one hand round a tankard. Built from smooth lathe/capsule forms in muted wool.
   */
  function patron(m, seed) {
    const cloth = (geo, mm, tint) => {
      g.geometry('prop_cloth', geo, mm, { uv: 'world', tint });
      geo.dispose();
    };
    const pal = [[0.36, 0.3, 0.26], [0.28, 0.32, 0.38], [0.42, 0.26, 0.2], [0.3, 0.34, 0.24], [0.46, 0.4, 0.3]];
    const coat = pal[Math.floor(hash(seed, 'pc') * pal.length)];
    const hood = hash(seed, 'ph') < 0.5;
    const lean = 0.28 + hash(seed, 'pl') * 0.15;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // thighs along the bench toward the table, shins down, boots
    for (const sx of [-1, 1]) {
      const th = new THREE.CapsuleGeometry(0.075, 0.36, 4, 8);
      th.rotateX(Math.PI / 2);
      cloth(th, m.clone().multiply(tr(sx * 0.1, 0.52, 0.16)), [0.26, 0.22, 0.2]);
      const sh = new THREE.CapsuleGeometry(0.06, 0.34, 4, 8);
      cloth(sh, m.clone().multiply(tr(sx * 0.11, 0.27, 0.36)).multiply(new THREE.Matrix4().makeRotationX(-0.12)), [0.24, 0.2, 0.18]);
      const boot = new THREE.BoxGeometry(0.11, 0.09, 0.22);
      g.geometry('prop_wood', boot, m.clone().multiply(tr(sx * 0.11, 0.045, 0.42)), { uv: 'world', tint: [0.3, 0.22, 0.16] });
      boot.dispose();
    }
    // torso: hips on the bench, hunched forward over the table
    const tm = m.clone().multiply(tr(0, 0.5, 0)).multiply(new THREE.Matrix4().makeRotationX(lean));
    const body = new THREE.LatheGeometry([[0, 0], [0.19, 0.02], [0.21, 0.14], [0.22, 0.32], [0.2, 0.5], [0.15, 0.6], [0.07, 0.64], [0, 0.65]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
    body.scale(1, 1, 0.75);
    cloth(body, tm, coat);
    // a cloak falling over the shoulders and down the back
    const cl = new THREE.CylinderGeometry(0.2, 0.27, 0.62, 12, 2, true, Math.PI * 0.55, Math.PI * 0.9);
    cl.scale(1, 1, 0.82);
    cloth(cl, tm.clone().multiply(tr(0, 0.3, -0.02)), coat.map((v) => v * 0.8));
    // arms resting on the board
    const sJ = (sx) => new THREE.Vector3(sx * 0.2, 0.56, 0).applyMatrix4(tm);
    const inv = new THREE.Matrix4().copy(m).invert();
    for (const sx of [-1, 1]) {
      const a = sJ(sx).applyMatrix4(inv);
      const e = V(sx * 0.24, 0.84, 0.3);
      const h = V(sx * 0.1, 0.84, 0.52);
      for (const [p0, p1, r] of [[a, e, 0.065], [e, h, 0.055]]) {
        const d = p1.clone().sub(p0);
        const L = d.length();
        const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, L - r), 4, 8);
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
        cloth(geo, m.clone().multiply(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, V(1, 1, 1))), coat.map((v) => v * 0.92));
      }
      const hand = new THREE.SphereGeometry(0.045, 8, 6);
      hand.scale(1, 0.7, 1.25);
      g.geometry('prop_skin', hand, m.clone().multiply(tr(sx * 0.08, 0.86, 0.57)), { uv: 'world' });
      hand.dispose();
    }
    // head bowed toward the drink
    const hp = new THREE.Vector3(0, 0.76, 0.04).applyMatrix4(tm).applyMatrix4(inv);
    const hm = m.clone().multiply(tr(hp.x, hp.y, hp.z)).multiply(new THREE.Matrix4().makeRotationX(0.25));
    face(hm, seed, { cap: !hood });
    if (hood) {
      // hood up: a cowl round the back and sides of the head, open at the face
      const hd = new THREE.SphereGeometry(0.14, 14, 10, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.74);
      hd.scale(0.98, 1.12, 1.08);
      cloth(hd, hm.clone().multiply(tr(0, 0.025, -0.012)), coat.map((v) => v * 0.85));
    }
    const base = new THREE.Vector3(0, 0, 0.2).applyMatrix4(m);
    blobs.push({ x: base.x, z: base.z, r: 0.45, a: 0.45 });
  }

  /**
   * A weathered face on a head (hm: origin at the head centre, +z = facing): skull, jaw, nose,
   * ears, brow ridge over dark sockets, a beard over jaw and chin, and a felt cap if asked.
   */
  function face(hm, seed, { cap = false } = {}) {
    const skin = hash(seed, 'sk') < 0.5 ? [1, 0.95, 0.9] : [0.78, 0.66, 0.56];
    const head = new THREE.SphereGeometry(0.1, 14, 12);
    head.scale(0.9, 1.1, 1);
    g.geometry('prop_skin', head, hm, { uv: 'world', tint: skin });
    head.dispose();
    const jaw = new THREE.SphereGeometry(0.075, 10, 8);
    jaw.scale(1, 0.8, 1);
    g.geometry('prop_skin', jaw, hm.clone().multiply(tr(0, -0.06, 0.03)), { uv: 'world', tint: skin });
    jaw.dispose();
    const nose = new THREE.SphereGeometry(0.024, 8, 6);
    nose.scale(0.75, 1.1, 1.2);
    g.geometry('prop_skin', nose, hm.clone().multiply(tr(0, -0.01, 0.098)), { uv: 'world', tint: skin.map((v, i) => v * [1.08, 0.92, 0.88][i]) });
    nose.dispose();
    for (const sx of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.024, 6, 5);
      ear.scale(0.5, 1, 0.8);
      g.geometry('prop_skin', ear, hm.clone().multiply(tr(sx * 0.092, 0, 0)), { uv: 'world', tint: skin });
      ear.dispose();
      g.box('arch_beam_dark', { matrix: hm.clone().multiply(tr(sx * 0.034, 0.022, 0.086)), s: [0.024, 0.012, 0.01], tint: [0.1, 0.07, 0.05] });
      g.box('prop_skin', { matrix: hm.clone().multiply(tr(sx * 0.036, 0.04, 0.088)).multiply(new THREE.Matrix4().makeRotationZ(-sx * 0.12)), s: [0.045, 0.014, 0.018], tint: skin.map((v) => v * 0.9) });
    }
    const hair = hash(seed, 'bc') < 0.5 ? [0.48, 0.34, 0.22] : hash(seed, 'bc2') < 0.5 ? [0.2, 0.16, 0.13] : [0.72, 0.68, 0.6];
    if (hash(seed, 'beard') < 0.7) {
      const brd = new THREE.SphereGeometry(0.1, 12, 8, Math.PI / 2 - 1.2, 2.4, Math.PI * 0.58, Math.PI * 0.36);
      brd.scale(0.95, 1.15, 1.05);
      g.geometry('arch_beam_dark', brd, hm.clone().multiply(tr(0, -0.02, 0.012)), { uv: 'world', tint: hair });
      brd.dispose();
    }
    const mo = new THREE.CapsuleGeometry(0.012, 0.06, 3, 6);
    mo.rotateZ(Math.PI / 2);
    g.geometry('arch_beam_dark', mo, hm.clone().multiply(tr(0, -0.04, 0.095)), { uv: 'world', tint: hair });
    mo.dispose();
    const scalp = new THREE.SphereGeometry(0.104, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
    scalp.scale(0.92, 1.1, 1.02);
    g.geometry(cap ? 'prop_cloth' : 'arch_beam_dark', scalp, hm.clone().multiply(tr(0, 0.006, -0.006)), { uv: 'world', tint: cap ? [0.36, 0.25, 0.17] : hair });
    scalp.dispose();
  }

  /** A burly innkeeper in a leather apron, one hand on the bar, the other with a rag. */
  function innkeeper(m) {
    const cloth = (geo, mm, tint) => g.geometry('prop_cloth', geo, mm, { uv: 'world', tint });
    const tunic = [0.42, 0.5, 0.36];
    const apron = [0.9, 0.84, 0.72];
    // body (lathe): hips → chest → shoulders, a little barrel-bellied
    const body = new THREE.LatheGeometry([[0, 0.8], [0.2, 0.82], [0.24, 0.95], [0.27, 1.12], [0.26, 1.3], [0.22, 1.44], [0.12, 1.5], [0, 1.52]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
    body.scale(1, 1, 0.72);
    cloth(body, m, tunic);
    body.dispose();
    // legs (mostly hidden by the counter)
    for (const s of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.08, 0.07, 0.82, 8);
      cloth(leg, m.clone().multiply(tr(s * 0.11, 0.41, 0)), [0.3, 0.26, 0.22]);
      leg.dispose();
    }
    // apron: a slightly curved panel on the front, with a neck strap
    const ap = new THREE.CylinderGeometry(0.275, 0.29, 0.62, 12, 1, true, -0.95, 1.9);
    ap.scale(1, 1, 0.74);
    cloth(ap, m.clone().multiply(tr(0, 1.05, 0.012)).multiply(rotY(Math.PI / 2)), apron);
    ap.dispose();
    g.box('prop_cloth', { matrix: m.clone().multiply(tr(0, 1.42, 0.13)).multiply(new THREE.Matrix4().makeRotationX(-0.4)), s: [0.22, 0.12, 0.02], tint: apron });
    // arms: shoulder → elbow → hand; right arm braced on the counter, left holding a rag
    const limb = (a, b, r0, r1, key, tint) => {
      const dir = b.clone().sub(a);
      const l = dir.length();
      const geo = new THREE.CylinderGeometry(r1, r0, l, 8);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      const mm = m.clone().multiply(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
      g.geometry(key, geo, mm, { uv: 'world', tint });
      geo.dispose();
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    limb(V(0.26, 1.42, 0), V(0.34, 1.12, 0.18), 0.075, 0.065, 'prop_cloth', tunic);
    limb(V(0.34, 1.12, 0.18), V(0.3, 1.1, 0.52), 0.06, 0.05, 'prop_skin');
    limb(V(-0.26, 1.42, 0), V(-0.36, 1.15, 0.12), 0.075, 0.065, 'prop_cloth', tunic);
    limb(V(-0.36, 1.15, 0.12), V(-0.18, 1.12, 0.46), 0.06, 0.05, 'prop_skin');
    for (const [x, z] of [[0.3, 0.55], [-0.15, 0.5]]) {
      const hand = new THREE.SphereGeometry(0.055, 8, 6);
      hand.scale(1, 0.7, 1.3);
      g.geometry('prop_skin', hand, m.clone().multiply(tr(x, 1.1, z)), { uv: 'world' });
      hand.dispose();
    }
    // the rag
    g.box('prop_burlap', { matrix: m.clone().multiply(tr(-0.12, 1.1, 0.56)).multiply(rotY(0.5)), s: [0.18, 0.03, 0.14], tint: [0.85, 0.8, 0.7] });
    // neck and head: broad face, bald crown with a fringe, big moustache and beard
    const neck = new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8);
    g.geometry('prop_skin', neck, m.clone().multiply(tr(0, 1.56, 0.01)), { uv: 'world' });
    neck.dispose();
    const head = new THREE.SphereGeometry(0.115, 14, 12);
    head.scale(0.95, 1.12, 1.0);
    const hm = m.clone().multiply(tr(0, 1.71, 0.02));
    g.geometry('prop_skin', head, hm, { uv: 'world' });
    head.dispose();
    const nose = new THREE.SphereGeometry(0.03, 8, 6);
    nose.scale(0.8, 1, 1.1);
    g.geometry('prop_skin', nose, hm.clone().multiply(tr(0, -0.01, 0.11)), { uv: 'world', tint: [1.05, 0.9, 0.85] });
    nose.dispose();
    for (const s of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.028, 6, 5);
      ear.scale(0.5, 1, 0.8);
      g.geometry('prop_skin', ear, hm.clone().multiply(tr(s * 0.11, 0, 0)), { uv: 'world' });
      ear.dispose();
      // eyes: small dark sockets under a heavy brow
      g.box('arch_beam_dark', { matrix: hm.clone().multiply(tr(s * 0.04, 0.025, 0.1)), s: [0.025, 0.012, 0.01], tint: [0.12, 0.08, 0.06] });
      g.box('arch_beam_dark', { matrix: hm.clone().multiply(tr(s * 0.045, 0.05, 0.1)).multiply(new THREE.Matrix4().makeRotationZ(-s * 0.15)), s: [0.05, 0.015, 0.02], tint: [0.5, 0.42, 0.36] });
    }
    const beard = new THREE.SphereGeometry(0.11, 12, 8, Math.PI / 2 - 1.2, 2.4, Math.PI * 0.6, Math.PI * 0.36);
    beard.scale(0.98, 1.2, 1.02);
    g.geometry('arch_beam_dark', beard, hm.clone().multiply(tr(0, -0.015, 0.01)), { uv: 'world', tint: [0.62, 0.52, 0.44] });
    beard.dispose();
    const mous = new THREE.CapsuleGeometry(0.018, 0.09, 3, 6);
    mous.rotateZ(Math.PI / 2);
    g.geometry('arch_beam_dark', mous, hm.clone().multiply(tr(0, -0.045, 0.105)), { uv: 'world', tint: [0.62, 0.52, 0.44] });
    mous.dispose();
    const fringe = new THREE.TorusGeometry(0.1, 0.03, 6, 14, Math.PI * 1.3);
    fringe.rotateX(Math.PI / 2);
    fringe.rotateY(Math.PI * 0.35 + Math.PI);
    g.geometry('arch_beam_dark', fringe, hm.clone().multiply(tr(0, 0.0, -0.005)), { uv: 'world', tint: [0.62, 0.52, 0.44] });
    fringe.dispose();
    const base = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
    blobs.push({ x: base.x, z: base.z, r: 0.5, a: 0.5 });
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
  if (blobs.length) {
    const pos = [];
    const uv = [];
    const col = [];
    for (const bl of blobs) {
      for (const [a, c] of [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]) {
        pos.push(bl.x + a * bl.r, 0.013, bl.z + c * bl.r);
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
  void EDGE;
  return {
    group,
    lamps,
    dispose() {
      for (const o of own) o.dispose?.();
      group.removeFromParent();
    },
  };
}
