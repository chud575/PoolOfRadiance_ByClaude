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
  const NS = 14; // stations stem→stern
  const NJ = 7; // strakes per side
  const station = (t) => {
    const u = t * 2 - 1; // -1 stern … +1 bow
    const half = (B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.6)), 0.55);
    const top = F + sheer * u * u + (u > 0 ? u * u * 0.25 : 0);
    const bot = -D * (1 - Math.pow(Math.abs(u), 6) * 0.65);
    const x = u * (L / 2);
    return { x, half, top, bot };
  };
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
  const strake = (s, j) => {
    // section: keel (j=0) → gunwale (j=NJ), U-shaped, flaring out above the waterline
    const f = j / NJ;
    const y = s.bot + (s.top - s.bot) * f;
    const w = s.half * (1 - Math.pow(1 - f, 2.4)) * (0.92 + 0.08 * f);
    return [y, w];
  };
  const tone = (j) => (j % 2 ? [0.82, 0.74, 0.66] : [0.95, 0.86, 0.76]);
  for (let i = 0; i < NS; i++) {
    const a = station(i / NS);
    const b = station((i + 1) / NS);
    for (let j = 0; j < NJ; j++) {
      const [ya0, wa0] = strake(a, j);
      const [ya1, wa1] = strake(a, j + 1);
      const [yb0, wb0] = strake(b, j);
      const [yb1, wb1] = strake(b, j + 1);
      // clinker: each strake's upper edge laps outward over the next
      const lap = 0.04;
      for (const side of [-1, 1]) {
        const p0 = P(a.x, ya0, side * wa0);
        const p1 = P(b.x, yb0, side * wb0);
        const p2 = P(b.x, yb1, side * (wb1 + lap));
        const p3 = P(a.x, ya1, side * (wa1 + lap));
        const tint = tone(j + (ya1 < 0 ? 0 : 0)).map((v) => v * (ya1 < 0.05 ? 0.55 : 1)); // wet, weedy below the waterline
        if (side > 0) g.quad('arch_beam_dark', p0, p1, p2, p3, null, { tint, ao: 0.6 + 0.4 * (j / NJ) });
        else g.quad('arch_beam_dark', p1, p0, p3, p2, null, { tint, ao: 0.6 + 0.4 * (j / NJ) });
      }
    }
    // deck
    const da = strake(a, NJ - 1);
    const db = strake(b, NJ - 1);
    const dy = F * 0.55;
    g.quad('arch_beam', P(a.x, dy, -da[1]), P(a.x, dy, da[1]), P(b.x, dy, db[1]), P(b.x, dy, -db[1]), null, { ao: 0.75, tint: [0.75, 0.66, 0.55] });
  }
  // wale: a heavy rubbing strake along the sheer
  for (let i = 0; i < NS; i++) {
    const a = station(i / NS);
    const b = station((i + 1) / NS);
    for (const side of [-1, 1]) {
      const ya = a.top - 0.35;
      const yb = b.top - 0.35;
      const p0 = P(a.x, ya - 0.14, side * (a.half + 0.08));
      const p1 = P(b.x, yb - 0.14, side * (b.half + 0.08));
      const p2 = P(b.x, yb + 0.14, side * (b.half + 0.08));
      const p3 = P(a.x, ya + 0.14, side * (a.half + 0.08));
      if (side > 0) g.quad('arch_beam_dark', p0, p1, p2, p3, null, { tint: [0.45, 0.38, 0.32], ao: 0.9 });
      else g.quad('arch_beam_dark', p1, p0, p3, p2, null, { tint: [0.45, 0.38, 0.32], ao: 0.9 });
    }
  }
  // stem and stern posts (straight, raking)
  const at = (x, y, z, rz = 0) => M.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(new THREE.Matrix4().makeRotationZ(rz));
  g.box('arch_beam_dark', { matrix: at(L / 2 + 0.2, (F + sheer) / 2 - D * 0.3, 0, -0.45), s: [0.3, F + sheer + D, 0.28], ao: 0.8 });
  g.box('arch_beam_dark', { matrix: at(-L / 2 - 0.1, (F + sheer) / 2 - D * 0.3, 0, 0.2), s: [0.3, F + sheer + D, 0.28], ao: 0.8 });
  // castles: a boxy aftcastle with a crenellated rail, and a smaller triangular forecastle
  const sternTop = F + sheer;
  const acL = L * 0.24;
  const acX = -L / 2 + acL / 2 + 0.3;
  const acW = Math.max(station(0.12).half, station(0.2).half * 0.9) * 2.05; // sits on the gunwales, no overhang
  g.box('arch_beam_dark', { matrix: at(acX, sternTop + 0.65, 0), s: [acL, 1.3, acW], chamfer: 0.05, ao: 0.85, tint: [0.9, 0.82, 0.72] });
  g.box('arch_beam', { matrix: at(acX, sternTop + 1.33, 0), s: [acL + 0.3, 0.08, acW + 0.3], ao: 0.9, tint: [0.7, 0.62, 0.52] });
  for (let k = 0; k < 7; k++) {
    for (const side of [-1, 1]) g.box('arch_beam_dark', { matrix: at(acX - acL / 2 + (k + 0.5) * (acL / 7), sternTop + 1.62, side * (acW / 2 + 0.1)), s: [acL / 7 - 0.12, 0.55, 0.1], ao: 0.85, tint: k % 2 ? [0.55, 0.12, 0.1] : [0.85, 0.75, 0.6] });
  }
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) g.box('arch_beam_dark', { matrix: at(acX - acL / 2 + 0.05, sternTop + 1.62, side * (k - 1) * (acW / 3)), s: [0.1, 0.55, acW / 3 - 0.12], ao: 0.85 });
  const fcX = L / 2 - L * 0.12;
  const bowTop = F + sheer + 0.25;
  const fcW = station(0.86).half * 2.0;
  g.box('arch_beam_dark', { matrix: at(fcX, bowTop + 0.3, 0), s: [L * 0.16, 0.9, fcW], chamfer: 0.05, ao: 0.85, tint: [0.9, 0.82, 0.72] });
  g.box('arch_beam', { matrix: at(fcX, bowTop + 0.78, 0), s: [L * 0.18, 0.07, fcW + 0.2], ao: 0.9, tint: [0.7, 0.62, 0.52] });
  // mast, top and yard
  const mastH = L * 1.05;
  const mastX = L * 0.04;
  const mast = new THREE.CylinderGeometry(0.16, 0.26, mastH, 8);
  g.geometry('arch_beam_dark', mast, at(mastX, mastH / 2 + F * 0.5, 0), { uv: 'world', ao: 0.85 });
  mast.dispose();
  const top = new THREE.CylinderGeometry(0.75, 0.55, 0.6, 10);
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
    const NX = 8;
    const NY = 6;
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
    const roll = new THREE.CylinderGeometry(0.3, 0.3, yardL * 0.92, 8, 6);
    const rp = roll.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const k = 1 + 0.25 * Math.sin(rp.getY(i) * 2.3 + seed) + 0.1 * Math.sin(rp.getY(i) * 7.1);
      rp.setX(i, rp.getX(i) * k);
      rp.setZ(i, rp.getZ(i) * k * 1.2);
    }
    roll.computeVertexNormals();
    roll.rotateX(Math.PI / 2);
    g.geometry('arch_plaster', roll, at(mastX + 0.25, yardY - 0.32, 0), { uv: 'world', ao: 0.85, tint: [0.92, 0.88, 0.8] });
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
