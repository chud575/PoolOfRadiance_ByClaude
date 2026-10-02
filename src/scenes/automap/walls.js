import { INK, prng, wobblePoints } from './ink.js';
import { SERIF } from './ornaments.js';

/**
 * Walls, towers and doors for the survey sheets, drawn the way an architect's
 * plan shows masonry and timber: coursed stone blocks bedded in dark mortar
 * with ink stipple on their shadow side, timber framing as irregular oak posts
 * with braced wattle-and-daub infill, the city wall twice as thick with a
 * crenellated parapet and round bastions, plank doors swung on a pencilled
 * arc, locked doors barred in vermilion with an iron padlock, secret doors as
 * a dotted gap under a rubricated S. Units are sheet units; all seeded.
 */

const MORTAR = 'rgba(52,34,20,0.94)';
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function frame(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { len, ux, uy, nx: -uy, ny: ux, P: (t, o) => [x0 + ux * t + -uy * o, y0 + uy * t + ux * o] };
}

/** A fine, slightly wobbling ink line along one face of a wall. */
function face(g, A, B, { amp = 0.35, seed = 0, width = 1, alpha = 0.92 } = {}) {
  const pts = wobblePoints(A[0], A[1], B[0], B[1], { amp, step: 7, seed });
  g.save();
  g.strokeStyle = INK.ink;
  g.globalAlpha = alpha;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
  g.restore();
}

/** Ink stipple inside a quad, denser toward its shadow (south-east) side. */
function stippleQuad(g, q, r, count, shadeDir) {
  const [a, b, c, d] = q;
  g.fillStyle = INK.ink;
  for (let i = 0; i < count; i++) {
    let u = r();
    let v = r();
    // bias toward the shaded face
    if (shadeDir > 0) v = 1 - v * v; else if (shadeDir < 0) v *= v;
    const x = a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v + (a[0] - b[0] - d[0] + c[0]) * u * v;
    const y = a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v + (a[1] - b[1] - d[1] + c[1]) * u * v;
    g.globalAlpha = 0.28 + r() * 0.4;
    g.beginPath();
    g.arc(x, y, 0.28 + r() * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/**
 * A coursed stone wall from (x0,y0) to (x1,y1), `width` thick.
 * courses: blocks across the thickness; tone: base stone colour.
 */
export function stoneWall(g, x0, y0, x1, y1, { width = 8, seed = 1, courses = 1, tone = [156, 138, 112], faces = true, ragged = 0, faceW = null } = {}) {
  const f = frame(x0, y0, x1, y1);
  const r = prng(seed * 7 + 11);
  const hw = width / 2;
  // which side is in shadow (light from the north-west): +1 if the +n face looks south/east
  const shadeDir = f.nx + f.ny > 0 ? 1 : -1;
  // mortar bed: the wall's footprint in dark ink-brown
  const jag = (t) => (ragged ? (r() - 0.5) * width * ragged : 0);
  const outline = [f.P(0 + jag(), -hw), f.P(f.len + jag(), -hw), f.P(f.len + jag(), hw), f.P(0 + jag(), hw)];
  g.save();
  poly(g, outline);
  g.fillStyle = MORTAR;
  g.fill();
  // blocks, course by course, joints staggered
  const ins = Math.max(0.35, width * 0.05);
  for (let c = 0; c < courses; c++) {
    const o0 = -hw + (c / courses) * width;
    const o1 = -hw + ((c + 1) / courses) * width;
    const cw = o1 - o0;
    let t = c % 2 ? -cw * (0.4 + r() * 0.5) : -r() * cw * 0.6;
    while (t < f.len) {
      const L = cw * (courses > 1 ? 1.1 + r() * 1.2 : 0.95 + r() * 1.0);
      const ta = Math.max(0, t) + ins;
      const tb = Math.min(f.len, t + L) - ins;
      t += L;
      if (tb - ta < ins * 2) continue;
      const j = () => (r() - 0.5) * ins * 0.8;
      const q = [f.P(ta + j(), o0 + ins + j()), f.P(tb + j(), o0 + ins + j()), f.P(tb + j(), o1 - ins + j()), f.P(ta + j(), o1 - ins + j())];
      const v = 0.82 + r() * 0.3;
      poly(g, q);
      g.fillStyle = rgb([tone[0] * v, tone[1] * v, tone[2] * v * (0.97 + r() * 0.06)]);
      g.fill();
      // a worn or weathered stone now and then
      if (r() < 0.12) {
        g.fillStyle = 'rgba(70,48,30,0.22)';
        g.fill();
      }
      const area = (tb - ta) * (cw - ins * 2);
      const side = courses > 1 ? (c === (shadeDir > 0 ? courses - 1 : 0) ? shadeDir : 0) : shadeDir;
      stippleQuad(g, q, r, Math.round(area * 0.16 * (0.6 + r() * 0.8)), side);
    }
  }
  g.restore();
  if (faces) {
    const fw = faceW ?? Math.max(1.2, width * 0.17);
    const e0 = width * (0.1 + r() * 0.35);
    const e1 = width * (0.1 + r() * 0.35);
    for (const s of [-1, 1]) face(g, f.P(-e0, s * hw), f.P(f.len + e1, s * hw), { seed: seed + s * 7, width: fw * (s === shadeDir ? 1.25 : 0.9) });
  }
}

/**
 * A timber-framed wall: oak posts at irregular centres, a sill line, braced
 * wattle-and-daub panels between (hatched infill).
 */
export function timberWall(g, x0, y0, x1, y1, { width = 6, seed = 1, cs = 50 } = {}) {
  const f = frame(x0, y0, x1, y1);
  const r = prng(seed * 5 + 3);
  const hw = width / 2;
  g.save();
  const body = [f.P(0, -hw), f.P(f.len, -hw), f.P(f.len, hw), f.P(0, hw)];
  // daub: a pale lime-washed infill, mottled
  poly(g, body);
  g.fillStyle = 'rgba(176,146,104,0.97)';
  g.fill();
  g.save();
  poly(g, body);
  g.clip();
  // wattle: woven hurdles show as a fine cross-hatch through the daub
  g.strokeStyle = 'rgba(70,46,26,0.32)';
  g.lineWidth = 0.35;
  g.beginPath();
  for (let t = -width; t < f.len + width; t += 1.5 + r() * 1.1) {
    const [ax, ay] = f.P(t, -hw);
    const [bx, by] = f.P(t + width * 0.7, hw);
    g.moveTo(ax, ay); g.lineTo(bx, by);
  }
  g.stroke();
  // daub stains: soft blotches of damp
  for (let t = r() * cs * 0.3; t < f.len; t += cs * (0.2 + r() * 0.4)) {
    const [cx, cy] = f.P(t, (r() - 0.5) * hw);
    g.fillStyle = `rgba(110,80,48,${(0.08 + r() * 0.12).toFixed(3)})`;
    g.beginPath(); g.ellipse(cx, cy, width * (0.5 + r()), hw * 0.8, Math.atan2(f.uy, f.ux), 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // posts at irregular centres (studs crowd here, bays open there)
  const posts = [0];
  let t = 0;
  while (true) {
    t += cs * (0.22 + r() * 0.5);
    if (t > f.len - cs * 0.12) break;
    posts.push(t);
  }
  posts.push(f.len);
  // braces in some bays
  g.strokeStyle = 'rgba(62,40,22,0.92)';
  g.lineCap = 'butt';
  for (let i = 0; i < posts.length - 1; i++) {
    if (r() > 0.4 || posts[i + 1] - posts[i] < cs * 0.3) continue;
    const s = r() < 0.5 ? 1 : -1;
    const [ax, ay] = f.P(posts[i] + width * 0.4, -hw * 0.5 * s);
    const [bx, by] = f.P(posts[i + 1] - width * 0.4, hw * 0.5 * s);
    g.lineWidth = width * 0.2;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  for (const p of posts) {
    // squared oak, flush with the faces; length and shade vary post to post
    const ps = width * (0.96 + r() * 0.1);
    const pl = width * (0.7 + r() * 0.75);
    const [cx, cy] = f.P(p + (r() - 0.5) * 1.6, 0);
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.atan2(f.uy, f.ux) + (r() - 0.5) * 0.08);
    const v = r();
    g.fillStyle = `rgba(${74 + v * 26 | 0},${50 + v * 16 | 0},${30 + v * 10 | 0},0.97)`;
    g.fillRect(-pl / 2, -ps / 2, pl, ps);
    // end grain: growth rings as a few arcs, and a radial check
    g.strokeStyle = 'rgba(200,160,110,0.3)';
    g.lineWidth = 0.3;
    g.beginPath(); g.arc(-pl * 0.15, ps * 0.1, Math.min(pl, ps) * 0.28, 0, Math.PI * 1.4); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(pl * 0.35, -ps * 0.3); g.stroke();
    g.strokeStyle = INK.ink;
    g.lineWidth = 0.5;
    g.strokeRect(-pl / 2, -ps / 2, pl, ps);
    g.restore();
  }
  // sole and head plates: dark oak beams running both faces of the wall
  const plate = Math.max(0.9, width * 0.27);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let t = -width * 0.3; t <= f.len + width * 0.3; t += cs * 0.25) pts.push(f.P(Math.min(t, f.len + width * 0.3), s * (hw - plate / 2) + (r() - 0.5) * 0.25));
    g.strokeStyle = `rgba(${58 + r() * 14 | 0},${38 + r() * 8 | 0},${22 + r() * 6 | 0},0.96)`;
    g.lineWidth = plate;
    g.lineCap = 'butt';
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();
  }
  g.restore();
  for (const s of [-1, 1]) face(g, f.P(-width * 0.2, s * hw), f.P(f.len + width * 0.2, s * hw), { seed: seed + s * 3, width: (f.nx + f.ny) * s > 0 ? 1.6 : 1.1, amp: 0.3 });
}

/**
 * The city wall: a thick coursed curtain with the wall-walk dashed along its
 * inner side and the parapet's merlons and crenels on the outer face.
 * out: unit vector pointing outside the city.
 */
export function cityWall(g, x0, y0, x1, y1, { width = 16, seed = 1, out = [0, -1] } = {}) {
  stoneWall(g, x0, y0, x1, y1, { width, seed, courses: 3, tone: [158, 148, 130], faceW: 2.7 });
  const f = frame(x0, y0, x1, y1);
  const r = prng(seed + 41);
  const so = Math.sign(f.nx * out[0] + f.ny * out[1]) || 1;
  const hw = width / 2;
  // parapet: crenels cut into the outer course
  const step = width * 0.85;
  g.save();
  for (let t = step * (0.3 + r() * 0.4); t < f.len - step * 0.3; t += step) {
    const a = t;
    const b = t + step * 0.42;
    const q = [f.P(a, so * hw), f.P(b, so * hw), f.P(b, so * hw * 0.42), f.P(a, so * hw * 0.42)];
    poly(g, q);
    g.fillStyle = 'rgba(214,200,170,0.92)';
    g.fill();
    g.strokeStyle = INK.ink;
    g.lineWidth = 0.55;
    g.stroke();
  }
  // wall-walk
  g.setLineDash([2.4, 2.2]);
  g.strokeStyle = 'rgba(43,26,13,0.6)';
  g.lineWidth = 0.6;
  const [ax, ay] = f.P(0, -so * hw * 0.25);
  const [bx, by] = f.P(f.len, -so * hw * 0.25);
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  g.restore();
}

/** A round bastion: a ring of voussoir blocks round a timber floor with a stair, arrow slits outward. */
export function tower(g, cx, cy, R, { seed = 1, out = null } = {}) {
  const r = prng(seed * 3 + 5);
  g.save();
  // soft cast shadow to the south-east
  g.fillStyle = 'rgba(60,36,18,0.2)';
  g.beginPath(); g.arc(cx + R * 0.16, cy + R * 0.2, R * 1.04, 0, Math.PI * 2); g.fill();
  g.fillStyle = MORTAR;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  const ri = R * 0.58;
  const n = Math.max(10, Math.round((Math.PI * 2 * R) / (R * 0.42)));
  for (const [ra, rb, off] of [[ri, (ri + R) / 2, 0], [(ri + R) / 2, R, 0.5]]) {
    for (let i = 0; i < n; i++) {
      const a0 = ((i + off) / n) * Math.PI * 2 + 0.02;
      const a1 = ((i + 1 + off) / n) * Math.PI * 2 - 0.02;
      const i0 = ra + 0.45;
      const i1 = rb - 0.45;
      g.beginPath();
      g.arc(cx, cy, i1, a0, a1);
      g.arc(cx, cy, i0, a1, a0, true);
      g.closePath();
      const v = 0.82 + r() * 0.3;
      g.fillStyle = rgb([160 * v, 148 * v, 128 * v]);
      g.fill();
      // stipple toward the south-east of the drum
      const am = (a0 + a1) / 2;
      const shade = Math.max(0, Math.cos(am - Math.PI / 4));
      g.fillStyle = INK.ink;
      const cnt = Math.round(2 + shade * 9 * (0.6 + r() * 0.6));
      for (let k = 0; k < cnt; k++) {
        const aa = a0 + r() * (a1 - a0);
        const rr = i0 + r() * (i1 - i0);
        g.globalAlpha = 0.3 + r() * 0.4;
        g.beginPath(); g.arc(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, 0.3 + r() * 0.3, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
  }
  // the floor inside, with a spiral stair
  g.fillStyle = 'rgba(206,186,148,0.98)';
  g.beginPath(); g.arc(cx, cy, ri, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(43,26,13,0.55)';
  g.lineWidth = 0.5;
  const s0 = r() * Math.PI * 2;
  for (let i = 0; i < 9; i++) {
    const a = s0 + (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * ri * 0.2, cy + Math.sin(a) * ri * 0.2); g.lineTo(cx + Math.cos(a) * ri * 0.92, cy + Math.sin(a) * ri * 0.92); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, ri * 0.2, 0, Math.PI * 2); g.fillStyle = INK.ink; g.fill();
  // arrow slits facing outward
  if (out) {
    const base = Math.atan2(out[1], out[0]);
    g.strokeStyle = INK.ink;
    g.lineWidth = Math.max(0.8, R * 0.08);
    for (const da of [-0.9, 0, 0.9]) {
      const a = base + da;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri); g.lineTo(cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02); g.stroke();
    }
  }
  g.strokeStyle = INK.ink;
  g.lineWidth = Math.max(1.2, R * 0.09);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 0.7;
  g.beginPath(); g.arc(cx, cy, ri, 0, Math.PI * 2); g.stroke();
  g.restore();
}

/** A loose, outlined masonry chunk (ruins, rubble spill). */
export function chunk(g, x, y, rad, r) {
  g.beginPath();
  const n = 4 + Math.floor(r() * 3);
  const rot = r() * 6;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const q = rad * (0.7 + r() * 0.5);
    if (i === 0) g.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q * 0.85); else g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q * 0.85);
  }
  g.closePath();
  const v = 0.85 + r() * 0.25;
  g.fillStyle = rgb([170 * v, 152 * v, 124 * v], 0.95);
  g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.6;
  g.stroke();
  g.fillStyle = INK.ink;
  for (let k = 0; k < 3; k++) {
    g.globalAlpha = 0.4;
    g.beginPath(); g.arc(x + rad * 0.3 + (r() - 0.3) * rad * 0.4, y + rad * 0.3 + (r() - 0.3) * rad * 0.4, 0.35, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/**
 * A plank door in plan, hung at (hx,hy) and swung to `angle`: boards ruled
 * along its length, two iron straps, the swing traced as a pencilled arc
 * from `closedAngle`.
 */
export function doorLeaf(g, hx, hy, angle, closedAngle, L, t) {
  g.save();
  // swing arc
  g.strokeStyle = 'rgba(43,26,13,0.55)';
  g.lineWidth = 0.6;
  g.setLineDash([1.6, 1.8]);
  g.beginPath();
  g.arc(hx, hy, L, Math.min(angle, closedAngle), Math.max(angle, closedAngle));
  g.stroke();
  g.setLineDash([]);
  g.translate(hx, hy);
  g.rotate(angle);
  // a soft shadow
  g.fillStyle = 'rgba(60,36,18,0.18)';
  g.fillRect(0.8, -t / 2 + 1, L, t);
  g.fillStyle = 'rgba(150,108,66,0.9)';
  g.fillRect(0, -t / 2, L, t);
  g.strokeStyle = 'rgba(60,36,18,0.6)';
  g.lineWidth = 0.35;
  g.beginPath();
  for (const o of [-t / 6, t / 6]) { g.moveTo(0.5, o); g.lineTo(L - 0.5, o); }
  g.stroke();
  g.strokeStyle = 'rgba(30,22,16,0.9)';
  g.lineWidth = 0.9;
  g.beginPath();
  for (const a of [0.22, 0.78]) { g.moveTo(L * a, -t / 2); g.lineTo(L * a, t / 2); }
  g.stroke();
  g.strokeStyle = INK.ink;
  g.lineWidth = 0.8;
  g.strokeRect(0, -t / 2, L, t);
  g.fillStyle = INK.ink;
  g.beginPath(); g.arc(0, 0, t * 0.55, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** A locked door: the leaf shut across the opening as a thick vermilion bar with a padlock. */
export function lockedDoor(g, mx, my, horiz, L, t, side = 1) {
  g.save();
  g.translate(mx, my);
  if (!horiz) g.rotate(Math.PI / 2);
  g.fillStyle = 'rgba(60,20,10,0.25)';
  g.fillRect(-L / 2 + 0.8, -t / 2 + 1.2, L, t);
  g.fillStyle = 'rgba(176,50,32,0.96)';
  g.fillRect(-L / 2, -t / 2, L, t);
  // boards and iron bands
  g.strokeStyle = 'rgba(70,14,8,0.55)';
  g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(L / 2, 0); g.stroke();
  g.strokeStyle = 'rgba(28,18,14,0.95)';
  g.lineWidth = Math.max(1, t * 0.18);
  g.beginPath();
  for (const a of [-0.36, 0.36]) { g.moveTo(L * a, -t / 2); g.lineTo(L * a, t / 2); }
  g.stroke();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1;
  g.strokeRect(-L / 2, -t / 2, L, t);
  // the padlock, hung on the room side of the bar
  const s = t * 1.9;
  g.translate(0, side * (t / 2 + s * 0.42));
  g.lineWidth = s * 0.16;
  g.strokeStyle = INK.ink;
  g.beginPath(); g.arc(0, -s * 0.12 * side, s * 0.3, side > 0 ? Math.PI : 0, side > 0 ? Math.PI * 2 : Math.PI); g.stroke();
  g.fillStyle = 'rgba(70,64,60,0.98)';
  g.beginPath();
  g.rect(-s * 0.42, -s * 0.12 * side - (side > 0 ? 0 : s * 0.62), s * 0.84, s * 0.62);
  g.fill();
  g.lineWidth = 0.8;
  g.stroke();
  g.fillStyle = 'rgba(236,206,140,0.95)';
  g.beginPath(); g.arc(0, s * 0.16 * side, s * 0.1, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** A found secret door: the wall left as a dotted gap of loose stones, and a large rubricated S. */
export function secretDoor(g, ax, ay, bx, by, { width = 8, cs = 50, side = [0, -1], seed = 1 } = {}) {
  const f = frame(ax, ay, bx, by);
  const r = prng(seed);
  g.save();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * f.len;
    const [x, y] = f.P(t, (r() - 0.5) * 0.8);
    const s = width * (0.55 + r() * 0.2);
    g.fillStyle = 'rgba(52,34,20,0.85)';
    g.beginPath(); g.arc(x, y, s / 2, 0, Math.PI * 2); g.fill();
  }
  // a dotted pencil line where the wall's faces run on
  g.setLineDash([1.2, 2.4]);
  g.strokeStyle = 'rgba(43,26,13,0.7)';
  g.lineWidth = 0.6;
  for (const s of [-1, 1]) {
    const [x0, y0] = f.P(0, s * width / 2);
    const [x1, y1] = f.P(f.len, s * width / 2);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.setLineDash([]);
  // the rubric S sits right on the wall line, about the size of a door leaf
  const mx = (ax + bx) / 2 + side[0] * 0;
  const my = (ay + by) / 2 + side[1] * 0;
  const fs = Math.max(8, Math.round(cs * 0.34));
  // the rubricator's S, lettered with a fine pen straight over the wall line
  g.font = `italic ${fs}px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(242,230,200,0.9)';
  g.lineWidth = fs * 0.22;
  g.strokeText('S', mx, my + fs * 0.04);
  g.fillStyle = INK.vermilion;
  g.fillText('S', mx, my + fs * 0.04);
  g.restore();
}
