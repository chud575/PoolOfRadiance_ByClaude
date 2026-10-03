import * as THREE from 'three';
import { hash } from './GeoBuilder.js';

/**
 * Moonsea cogs (explore-renderer): clinker-built hull with sheer and
 * planking strakes, a wale, stern and fore castles with rails, a pole mast
 * with yard and top, a square sail either set (bellied, cloth-shaded) or
 * furled on the yard, and standing rigging with ratlines.
 *
 * Hull/castles/spars go into the caller's GeoBuilder (merged, Lambert);
 * sails and rigging are returned as their own buffers so the caller can give
 * them cloth / line materials.
 */

/**
 * @param {import('./GeoBuilder.js').GeoBuilder} g
 * @param {THREE.Matrix4} M  placement (origin at waterline amidships, +x = bow)
 * @param {{len?:number, seed?:number, set?:boolean}} o
 * @param {{sails:number[][], lines:number[]}} out  accumulates sail triangles [pos..] and line segments
 */
export function buildCog(g, M, o, out) {
  const L = o.len ?? 14;
  const seed = o.seed ?? 1;
  const B = L * 0.36; // beam: cogs were tubby
  const D = L * 0.13; // draught below the waterline
  const F = L * 0.12; // freeboard amidships
  const sheer = L * 0.07;
  const NS = 22; // stations stem→stern
  const NJ = 11; // strakes per side
  const CA = 1.7; // aftercastle: the hull is planked up this far above the main sheer at the stern
  const CF = 1.05; // forecastle rise at the bow
  const sm = THREE.MathUtils.smoothstep;
  const station = (t) => {
    const u = t * 2 - 1; // -1 stern … +1 bow
    // a full, bluff stern under the castle and a finer entry forward
    const ex = u < 0 ? 3.4 : 2.3;
    const half = (B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), ex)), 0.5);
    const main = F + sheer * u * u + (u > 0 ? u * u * 0.25 : 0);
    // the castles are part of the hull: its sheer steps up at both ends and the planking
    // continues up to the castle decks (no boxes perched on the gunwale)
    const aft = sm(-u, 0.42, 0.62);
    const fore = sm(u, 0.62, 0.8);
    const top = main + aft * CA + fore * CF;
    const bot = -D * (1 - Math.pow(Math.abs(u), 6) * 0.65);
    const x = u * (L / 2);
    return { x, u, half, top, main, bot, aft, fore };
  };
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
  const strake = (s, j) => {
    // section: keel (j=0) → gunwale (j=NJ), U-shaped, flaring out above the waterline, the
    // castle bulwarks rising nearly plumb above the main sheer
    const f = j / NJ;
    const y = s.bot + (s.top - s.bot) * f;
    const yf = Math.min(1, (y - s.bot) / Math.max(0.01, s.main - s.bot));
    const w = s.half * (1 - Math.pow(1 - yf, 2.4)) * (0.92 + 0.08 * yf) - Math.max(0, y - s.main) * 0.06;
    return [y, Math.max(0.05, w)];
  };
  // tarred oak strakes, each plank its own tone; a red-ochre band at the main sheer and a pale
  // painted strake on the castle sides, so the hull reads as planked timber, never a smooth tub
  const tone = (j, i, y, s) => {
    if (y > s.main + 0.15) return (j % 2 ? [1.2, 1.08, 0.92] : [1.45, 1.32, 1.1]).map((v) => v * (0.94 + hash(seed, i, j, 'cp') * 0.12));
    if (Math.abs(y - (s.main - 0.55)) < 0.3) return [1.35, 0.62, 0.42];
    const v = (j % 2 ? 0.9 : 1.16) * (0.9 + hash(seed, i, j, 'pl') * 0.22);
    // the boot-top: a wet, dark band just above the waterline where the swell slaps the strakes
    if (y > -0.1 && y < 0.45) return [v * 0.62, v * 0.56, v * 0.5];
    return [v * 1.25, v * 1.12, v * 0.98];
  };
  for (let i = 0; i < NS; i++) {
    const a = station(i / NS);
    const b = station((i + 1) / NS);
    for (let j = 0; j < NJ; j++) {
      const [ya0, wa0] = strake(a, j);
      const [ya1, wa1] = strake(a, j + 1);
      const [yb0, wb0] = strake(b, j);
      const [yb1, wb1] = strake(b, j + 1);
      // clinker: each strake's upper edge laps outward over the next; the lap throws a thin
      // dark line under it (the plank seams read at a distance)
      const lap = 0.045;
      const tint = tone(j, i, (ya0 + ya1) / 2, a).map((v, ci) => v * (ya1 < -0.05 ? [0.34, 0.42, 0.3][ci] : 1)); // weedy, slimed below the waterline
      const dark = tint.map((v) => v * 0.38);
      for (const side of [-1, 1]) {
        const p0 = P(a.x, ya0, side * wa0);
        const p1 = P(b.x, yb0, side * wb0);
        const p2 = P(b.x, yb1, side * (wb1 + lap));
        const p3 = P(a.x, ya1, side * (wa1 + lap));
        const q0 = P(a.x, ya0 + 0.06, side * (wa0 + 0.012));
        const q1 = P(b.x, yb0 + 0.06, side * (wb0 + 0.012));
        if (side > 0) {
          g.quad('arch_beam', p0, p1, q1, q0, null, { tint: dark, ao: 0.5 });
          g.quad('arch_beam', q0, q1, p2, p3, null, { tint, ao: 0.6 + 0.4 * (j / NJ) });
        } else {
          g.quad('arch_beam', p1, p0, q0, q1, null, { tint: dark, ao: 0.5 });
          g.quad('arch_beam', q1, q0, p3, p2, null, { tint, ao: 0.6 + 0.4 * (j / NJ) });
        }
      }
    }
    // inner face of the bulwarks (seen over the rail) and the decks: main deck amidships, the
    // castle decks a man's height above it at either end
    const da = strake(a, NJ);
    const db = strake(b, NJ);
    for (const side of [-1, 1]) {
      const i0 = P(a.x, a.top, side * (da[1] - 0.06));
      const i1 = P(b.x, b.top, side * (db[1] - 0.06));
      const j0 = P(a.x, F * 0.55, side * (da[1] - 0.06));
      const j1 = P(b.x, F * 0.55, side * (db[1] - 0.06));
      if (side > 0) g.quad('arch_beam', j1, j0, i0, i1, null, { tint: [0.62, 0.55, 0.46], ao: 0.55 });
      else g.quad('arch_beam', j0, j1, i1, i0, null, { tint: [0.62, 0.55, 0.46], ao: 0.55 });
    }
    const dk = (ua, ub, y) => g.quad('arch_beam', P(a.x, y, -ua), P(a.x, y, ua), P(b.x, y, ub), P(b.x, y, -ub), null, { ao: 0.75, tint: [0.75, 0.66, 0.55] });
    dk(da[1] - 0.06, db[1] - 0.06, F * 0.55);
    if (a.aft > 0.5 && b.aft > 0.5) dk(da[1] - 0.06, db[1] - 0.06, Math.min(a.top, b.top) - 0.95);
    if (a.fore > 0.5 && b.fore > 0.5) dk(da[1] - 0.06, db[1] - 0.06, Math.min(a.top, b.top) - 0.75);
  }
  const at = (x, y, z, rz = 0) => M.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(new THREE.Matrix4().makeRotationZ(rz));
  // keel: a heavy timber along the bottom, stem and stern posts rising from it
  g.box('arch_beam_dark', { matrix: at(0, -D - 0.12, 0), s: [L * 0.94, 0.32, 0.26], ao: 0.6 });
  // wales: two heavy rubbing strakes following the main sheer (not the castle step), with the
  // through-beam ends showing between them; the gunwale cap follows the full sheer
  for (let i = 0; i < NS; i++) {
    const a = station(i / NS);
    const b = station((i + 1) / NS);
    if (a.half < 0.3 || b.half < 0.3) continue;
    for (const side of [-1, 1]) {
      for (const off of [0.32, 1.05]) {
        const ya = a.main - off;
        const yb = b.main - off;
        const wa = strake(a, Math.round(((ya - a.bot) / (a.top - a.bot)) * NJ))[1] + 0.1;
        const wb = strake(b, Math.round(((yb - b.bot) / (b.top - b.bot)) * NJ))[1] + 0.1;
        const p0 = P(a.x, ya - 0.13, side * wa);
        const p1 = P(b.x, yb - 0.13, side * wb);
        const p2 = P(b.x, yb + 0.13, side * wb);
        const p3 = P(a.x, ya + 0.13, side * wa);
        const p4 = P(b.x, yb + 0.13, side * (wb - 0.12));
        const p5 = P(a.x, ya + 0.13, side * (wa - 0.12));
        if (side > 0) {
          g.quad('arch_beam_dark', p0, p1, p2, p3, null, { tint: [0.62, 0.52, 0.44], ao: 0.85 });
          g.quad('arch_beam_dark', p3, p2, p4, p5, null, { tint: [0.9, 0.8, 0.68], ao: 1 });
        } else {
          g.quad('arch_beam_dark', p1, p0, p3, p2, null, { tint: [0.62, 0.52, 0.44], ao: 0.85 });
          g.quad('arch_beam_dark', p2, p3, p5, p4, null, { tint: [0.9, 0.8, 0.68], ao: 1 });
        }
      }
      if (i % 3 === 1 && Math.abs(a.u) < 0.55) {
        const yy = a.main - 0.68;
        g.box('arch_beam_dark', { matrix: at(a.x, yy, side * (a.half + 0.06)), s: [0.2, 0.2, 0.22], ao: 0.8 });
      }
      // gunwale rail cap: a pale, worn top edge that catches the sky
      const q0 = P(a.x, a.top + 0.02, side * (a.half + 0.05));
      const q1 = P(b.x, b.top + 0.02, side * (b.half + 0.05));
      const q2 = P(b.x, b.top + 0.02, side * (b.half - 0.14));
      const q3 = P(a.x, a.top + 0.02, side * (a.half - 0.14));
      if (side > 0) g.quad('arch_beam', q3, q2, q1, q0, null, { tint: [1.7, 1.55, 1.3], ao: 1 });
      else g.quad('arch_beam', q0, q1, q2, q3, null, { tint: [1.7, 1.55, 1.3], ao: 1 });
      // open rail above the castle bulwarks: stanchions and a top rail
      if (a.aft > 0.85 || a.fore > 0.85) {
        g.box('arch_beam_dark', { matrix: at(a.x, a.top + 0.32, side * (a.half - 0.04)), s: [0.06, 0.6, 0.06], ao: 0.85 });
        const r0 = P(a.x, a.top + 0.62, side * (a.half - 0.04));
        const r1 = P(b.x, b.top + 0.62, side * (b.half - 0.04));
        const r2 = P(b.x, b.top + 0.7, side * (b.half - 0.04));
        const r3 = P(a.x, a.top + 0.7, side * (a.half - 0.04));
        if (b.aft > 0.85 || b.fore > 0.85) {
          g.quad('arch_beam_dark', r0, r1, r2, r3, null, { tint: [0.8, 0.7, 0.58], ao: 0.9 });
          g.quad('arch_beam_dark', r1, r0, r3, r2, null, { tint: [0.8, 0.7, 0.58], ao: 0.9 });
        }
      }
    }
  }
  // stem and stern posts (straight, raking)
  g.box('arch_beam_dark', { matrix: at(L / 2 + 0.2, (F + sheer + CF) / 2 - D * 0.3, 0, -0.45), s: [0.3, F + sheer + CF + D + 0.4, 0.28], ao: 0.8 });
  g.box('arch_beam_dark', { matrix: at(-L / 2 - 0.05, (F + sheer + CA) / 2 - D * 0.3, 0, 0.12), s: [0.32, F + sheer + CA + D + 0.3, 0.3], ao: 0.8 });
  // castle bulkheads facing the waist, with a dark doorway and two small lit-able lights
  const sternTop = F + sheer + CA;
  const bulk = (u, hgt, door) => {
    const st = station((u + 1) / 2);
    const w = strake(st, NJ)[1] * 2 - 0.12;
    g.box('arch_beam_dark', { matrix: at(st.x, F * 0.55 + hgt / 2, 0), s: [0.08, hgt, w], ao: 0.7, tint: [0.85, 0.76, 0.64] });
    if (door) g.box('arch_beam_dark', { matrix: at(st.x + Math.sign(u) * -0.045, F * 0.55 + 0.75, 0), s: [0.02, 1.4, 0.75], ao: 0.3, tint: [0.12, 0.1, 0.08] });
    return st;
  };
  const acSt = bulk(-0.52, CA + sheer * 0.27 + 0.2, true);
  // aftercastle lights: small framed windows down each side and across the stern, lamplit at dusk
  {
    const winY = F + sheer * 0.6 + CA * 0.55;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const st = station(0.12 + k * 0.09);
        const wz = side * (strake(st, NJ)[1] + 0.02);
        g.box('arch_beam_dark', { matrix: at(st.x, winY, wz), s: [0.62, 0.5, 0.06], ao: 0.8, tint: [0.7, 0.6, 0.5] });
        if (out.glow) out.glow.box('glow', { matrix: at(st.x, winY, wz + side * 0.035), s: [0.42, 0.32, 0.01] });
      }
    }
    const stS = station(0.015);
    for (const zz of [-0.55, 0.55]) {
      g.box('arch_beam_dark', { matrix: at(stS.x - 0.1, winY + 0.15, zz), s: [0.06, 0.52, 0.66], ao: 0.8, tint: [0.7, 0.6, 0.5] });
      if (out.glow) out.glow.box('glow', { matrix: at(stS.x - 0.14, winY + 0.15, zz), s: [0.01, 0.34, 0.46] });
    }
  }
  bulk(0.7, CF + 0.5, false);
  const acX = acSt.x;
  const acL = L / 2 + acX;
  // the stern lantern on an iron crane over the taffrail
  out.lamps?.push(P(-L / 2 - 0.55, sternTop + 0.95, 0));
  g.box('arch_beam_dark', { matrix: at(-L / 2 - 0.25, sternTop + 1.32, 0), s: [0.75, 0.07, 0.07], ao: 0.9 });
  g.box('arch_beam_dark', { matrix: at(-L / 2 + 0.08, sternTop + 0.9, 0), s: [0.07, 0.9, 0.07], ao: 0.9 });
  g.box('arch_beam_dark', { matrix: at(-L / 2 - 0.55, sternTop + 1.2, 0), s: [0.36, 0.08, 0.36], ao: 0.6, tint: [0.25, 0.2, 0.16] });
  g.box('arch_beam_dark', { matrix: at(-L / 2 - 0.55, sternTop + 0.7, 0), s: [0.3, 0.06, 0.3], ao: 0.6, tint: [0.25, 0.2, 0.16] });
  // a stubby bowsprit
  g.box('arch_beam_dark', { matrix: at(L / 2 + 1.3, F + sheer + CF + 0.2, 0, 0.32), s: [3.2, 0.18, 0.18], ao: 0.85 });
  // mast, top and yard
  const mastH = L * 1.05;
  const mastX = L * 0.04;
  const mast = new THREE.CylinderGeometry(0.16, 0.26, mastH, 8);
  g.geometry('arch_beam_dark', mast, at(mastX, mastH / 2 + F * 0.5, 0), { uv: 'world', ao: 0.85 });
  mast.dispose();
  const top = new THREE.CylinderGeometry(0.55, 0.42, 0.7, 10);
  g.geometry('arch_beam_dark', top, at(mastX, mastH * 0.9 + F * 0.5, 0), { uv: 'world', ao: 0.85 });
  top.dispose();
  const set = o.set ?? hash(seed, 'set') < 0.5;
  const yardY = set ? mastH * 0.84 + F * 0.5 : mastH * 0.62 + F * 0.5;
  const yardL = B * 1.9;
  const yard = new THREE.CylinderGeometry(0.1, 0.1, yardL, 6);
  yard.rotateX(Math.PI / 2);
  g.geometry('arch_beam_dark', yard, at(mastX + 0.25, yardY, 0), { uv: 'world', ao: 0.85 });
  yard.dispose();
  // pennant at the masthead
  const mh = mastH + F * 0.5;
  const sail = out.sails;
  const pushTri = (a, b, c, uv) => {
    for (const [p, t] of [[a, uv[0]], [b, uv[1]], [c, uv[2]]]) sail.push(p.x, p.y, p.z, t[0], t[1]);
  };
  pushTri(P(mastX, mh + 0.1, 0), P(mastX - 3, mh - 0.15, 0.3), P(mastX, mh - 0.5, 0), [[0.02, 0.98], [0.02, 0.9], [0.04, 0.98]]);
  if (set) {
    // bellied square sail: rows from the yard down to the foot, bulging forward (+x) in the middle
    const sh = mastH * 0.62;
    const NX = 18;
    const NY = 12;
    const pt = (i, j) => {
      const u = i / NX - 0.5;
      const v = j / NY;
      const belly = (1 - 4 * u * u) * Math.sin(Math.PI * Math.min(1, v * 1.05)) * B * 0.32;
      const z = u * yardL * (1 - v * 0.06);
      return P(mastX + 0.35 + belly + v * 0.25, yardY - 0.1 - v * sh, z);
    };
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const uv = (a, b) => [a / NX, 1 - b / NY];
        pushTri(pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), [uv(i, j), uv(i, j + 1), uv(i + 1, j + 1)]);
        pushTri(pt(i, j), pt(i + 1, j + 1), pt(i + 1, j), [uv(i, j), uv(i + 1, j + 1), uv(i + 1, j)]);
      }
    }
    // sheets down to the deck
    const lines = out.lines;
    const ft = (side) => pt(side > 0 ? NX : 0, NY);
    for (const side of [-1, 1]) {
      const a = ft(side);
      const b = P(acX + acL / 2, F + sheer * 0.3, side * B * 0.4);
      lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  } else {
    // sail furled on the yard: a lumpy roll of canvas with gaskets
    // a fat bunt in the middle, tapering to the yardarms, sagging between the gaskets
    // a slim, even bundle of canvas lashed along the yard (not a lens): full thickness to near the
    // yardarms, pinched at each gasket, sagging in festoons between them, a heavier bunt amidships
    const roll = new THREE.CylinderGeometry(0.44, 0.44, yardL * 0.9, 10, 40);
    const rp = roll.attributes.position;
    const hl = (yardL * 0.9) / 2;
    for (let i = 0; i < rp.count; i++) {
      const yy = rp.getY(i);
      const t = Math.abs(yy) / hl;
      const gs = Math.cos((yy / hl) * Math.PI * 4.5 + seed);
      const gasket = 1 - 0.32 * Math.pow(Math.max(0, gs), 16);
      const taper = 1 - 0.55 * Math.pow(Math.max(0, (t - 0.8) / 0.2), 1.5);
      const bunt = 1 + 0.35 * Math.max(0, 1 - t * 4);
      const k = taper * gasket * bunt * (1 + 0.08 * Math.sin(yy * 5.3 + seed * 2));
      const sag = 0.1 * (1 - Math.max(0, gs)) * taper + 0.12 * Math.max(0, 1 - t * 4);
      rp.setX(i, rp.getX(i) * k);
      rp.setZ(i, rp.getZ(i) * k * 1.2 + sag); // (becomes -y: the cloth hangs below the yard)
    }
    roll.computeVertexNormals();
    roll.rotateX(Math.PI / 2);
    roll.rotateY(Math.PI / 2);
    g.geometry('arch_plaster', roll, at(mastX + 0.25, yardY - 0.22, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), { uv: 'world', ao: 0.85, tint: [0.95, 0.9, 0.82] });
    roll.dispose();
  }
  // standing rigging: shrouds to the channels with ratlines, fore- and backstay
  const lines = out.lines;
  const head = P(mastX, mastH * 0.88 + F * 0.5, 0);
  for (const side of [-1, 1]) {
    const feet = [];
    for (let k = 0; k < 4; k++) {
      const s = station(0.5 + (mastX - 1.2 - k * 0.7) / L);
      const foot = P(mastX - 0.6 - k * 0.7, s.top - 0.3, side * (s.half + 0.12));
      feet.push(foot);
      lines.push(head.x, head.y, head.z, foot.x, foot.y, foot.z);
      // deadeye pair on the channel and the chain plate down the strakes
      const dm = at(mastX - 0.6 - k * 0.7, s.top - 0.3, side * (s.half + 0.14));
      const de = new THREE.CylinderGeometry(0.11, 0.11, 0.07, 8);
      de.rotateX(Math.PI / 2);
      g.geometry('arch_beam_dark', de, dm, { uv: 'world', ao: 0.8, tint: [0.5, 0.42, 0.34] });
      g.geometry('arch_beam_dark', de, dm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.32, 0)), { uv: 'world', ao: 0.8, tint: [0.5, 0.42, 0.34] });
      de.dispose();
      g.box('arch_beam_dark', { matrix: dm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.45, 0)), s: [0.05, 0.8, 0.04], ao: 0.7, tint: [0.3, 0.28, 0.26] });
    }
    // ratlines between adjacent shrouds every ~0.45 m
    for (let r = 1; r < 14; r++) {
      const t = r / 15;
      for (let k = 0; k < 3; k++) {
        const a = feet[k].clone().lerp(head, t);
        const b = feet[k + 1].clone().lerp(head, t);
        lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  }
  for (const side of [-1, 1]) {
    const s = station(0.5 + (mastX - 1.65) / L);
    g.box('arch_beam_dark', { matrix: at(mastX - 1.65, s.top - 0.42, side * (s.half + 0.1)), s: [3.2, 0.08, 0.24], ao: 0.75, tint: [0.7, 0.6, 0.5] });
  }
  // a mizzen on the aftercastle with a lateen yard (bigger ships), and a small foremast
  if (L >= 12) {
    const mzX = -L * 0.33;
    const st = station(0.5 + mzX / L);
    const deck = st.top - 0.95;
    const mzH = mastH * 0.5;
    const mz = new THREE.CylinderGeometry(0.09, 0.14, mzH, 7);
    g.geometry('arch_beam_dark', mz, at(mzX, deck + mzH / 2, 0), { uv: 'world', ao: 0.85 });
    mz.dispose();
    const Fp = P(mzX + 2.6, deck + 1.2, 0.2);
    const Ap = P(mzX - 3.2, deck + mzH * 1.12, 0.2);
    const yv = new THREE.Vector3().subVectors(Ap, Fp);
    const yl = yv.length();
    const yg = new THREE.CylinderGeometry(0.06, 0.06, yl, 6);
    const ym = new THREE.Matrix4().lookAt(new THREE.Vector3(), yv, new THREE.Vector3(0, 1, 0));
    yg.rotateX(Math.PI / 2);
    yg.applyMatrix4(ym);
    yg.translate((Fp.x + Ap.x) / 2, (Fp.y + Ap.y) / 2, (Fp.z + Ap.z) / 2);
    g.geometry('arch_beam_dark', yg, new THREE.Matrix4(), { uv: 'world', ao: 0.85 });
    yg.dispose();
    if (set) {
      // triangular lateen: luff along the yard, the clew sheeted aft and low, a gentle belly
      const C = P(mzX - 2.8, deck + 0.9, 0.2);
      const N = 8;
      const side = new THREE.Vector3(0, 0, 1).transformDirection(M);
      const q = (i, j) => {
        const top = Fp.clone().lerp(Ap, i / N);
        const pnt = top.lerp(C, j / N);
        return pnt.addScaledVector(side, Math.sin((Math.PI * i) / N) * Math.sin((Math.PI * j) / N) * 0.7);
      };
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const uv = (a, b) => [0.1 + (a / N) * 0.3, 1 - (b / N) * 0.6];
          pushTri(q(i, j), q(i, j + 1), q(i + 1, j + 1), [uv(i, j), uv(i, j + 1), uv(i + 1, j + 1)]);
          pushTri(q(i, j), q(i + 1, j + 1), q(i + 1, j), [uv(i, j), uv(i + 1, j + 1), uv(i + 1, j)]);
        }
      }
      out.lines.push(C.x, C.y, C.z, ...P(-L / 2 + 0.2, F + sheer + CA + 0.3, 0).toArray());
    } else {
      // brailed up along the yard
      const roll = new THREE.CylinderGeometry(0.2, 0.2, yl * 0.85, 8, 1);
      roll.rotateX(Math.PI / 2);
      roll.applyMatrix4(ym);
      roll.translate((Fp.x + Ap.x) / 2, (Fp.y + Ap.y) / 2 - 0.2, (Fp.z + Ap.z) / 2);
      g.geometry('arch_plaster', roll, new THREE.Matrix4(), { uv: 'world', ao: 0.85, tint: [0.95, 0.9, 0.82] });
      roll.dispose();
    }
    const mzTop = P(mzX, deck + mzH, 0);
    for (const sd of [-1, 1]) {
      const f = P(mzX - 0.4, st.top - 0.3, sd * (st.half + 0.1));
      out.lines.push(mzTop.x, mzTop.y, mzTop.z, f.x, f.y, f.z);
    }
  }
  if (L >= 14) {
    const fmX = L * 0.36;
    const st = station(0.5 + fmX / L);
    const deck = st.top - 0.75;
    const fmH = mastH * 0.45;
    const fm = new THREE.CylinderGeometry(0.09, 0.15, fmH, 7);
    g.geometry('arch_beam_dark', fm, at(fmX, deck + fmH / 2, 0), { uv: 'world', ao: 0.85 });
    fm.dispose();
    const fyL = B * 1.1;
    const fy = new THREE.CylinderGeometry(0.06, 0.06, fyL, 6);
    fy.rotateX(Math.PI / 2);
    g.geometry('arch_beam_dark', fy, at(fmX + 0.18, deck + fmH * 0.85, 0), { uv: 'world', ao: 0.85 });
    fy.dispose();
    const roll = new THREE.CylinderGeometry(0.22, 0.22, fyL * 0.85, 8, 1);
    roll.rotateX(Math.PI / 2);
    g.geometry('arch_plaster', roll, at(fmX + 0.18, deck + fmH * 0.85 - 0.2, 0), { uv: 'world', ao: 0.85, tint: [0.95, 0.9, 0.82] });
    roll.dispose();
    const fTop = P(fmX, deck + fmH, 0);
    const bs = P(L / 2 + 2.6, F + sheer + CF + 0.7, 0);
    out.lines.push(fTop.x, fTop.y, fTop.z, bs.x, bs.y, bs.z);
    for (const sd of [-1, 1]) {
      const f = P(fmX - 0.5, st.top - 0.3, sd * (st.half + 0.1));
      out.lines.push(fTop.x, fTop.y, fTop.z, f.x, f.y, f.z);
    }
  }
  const stem = P(L / 2 + 0.6, F + sheer + 0.6, 0);
  const stern = P(-L / 2 + 0.2, sternTop + 1.4, 0);
  const mtop = P(mastX, mastH * 0.95 + F * 0.5, 0);
  lines.push(mtop.x, mtop.y, mtop.z, stem.x, stem.y, stem.z);
  lines.push(mtop.x, mtop.y, mtop.z, stern.x, stern.y, stern.z);
  // halyard and lifts
  const yE = (side) => P(mastX + 0.25, yardY, side * yardL / 2);
  for (const side of [-1, 1]) {
    const e = yE(side);
    lines.push(mtop.x, mtop.y, mtop.z, e.x, e.y, e.z);
  }
}

/**
 * Canvas for sails: off-white panels with seams, patched, a faded red stripe.
 * Drawn into a CanvasTexture by the caller (needs DOM).
 */
export function drawSail(g, w, h, seed = 7) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#d9cfb8';
  g.fillRect(0, 0, w, h);
  // vertical cloths with seams
  const n = 9;
  for (let k = 0; k < n; k++) {
    const x = (k / n) * w;
    g.fillStyle = `rgba(${120 + r() * 40},${100 + r() * 30},${70},${0.05 + r() * 0.06})`;
    g.fillRect(x, 0, w / n, h);
    g.fillStyle = 'rgba(80,60,40,0.35)';
    g.fillRect(x, 0, 1.5, h);
  }
  // faded stripes (Phlan's red)
  g.fillStyle = 'rgba(150,40,30,0.45)';
  g.fillRect(w * 0.33, 0, w * 0.11, h);
  g.fillRect(w * 0.56, 0, w * 0.11, h);
  // patches and weathering at the foot
  for (let k = 0; k < 5; k++) {
    g.fillStyle = `rgba(${150 + r() * 40},${130 + r() * 30},${100},0.6)`;
    g.fillRect(r() * w * 0.9, r() * h * 0.9, 8 + r() * 14, 8 + r() * 12);
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(60,40,20,0.1)');
  grd.addColorStop(1, 'rgba(60,40,20,0.35)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // reef points
  g.fillStyle = 'rgba(70,50,30,0.6)';
  for (let k = 0; k < 18; k++) g.fillRect((k / 18) * w + 3, h * 0.18, 2, 4);
  // the pennant corner (top-left 4%): Phlan blue
  g.fillStyle = '#2a3e78';
  g.fillRect(0, 0, w * 0.06, h * 0.12);
}
