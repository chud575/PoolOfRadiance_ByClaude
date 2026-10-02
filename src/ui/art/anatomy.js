import { mat, add, scl, rotX, rotY, rotZ, mul3, shade, mixc, lerp3 } from './sculpt.js';

/**
 * Sculpted anatomy for the SDF figure renderer: a human head built in planes
 * (brow ridge, cheekbones, jaw, chin, a nose with alae and carved nostrils,
 * lips parted by a carved line, eye sockets carved out of the skull with
 * lidded eyeballs, irises and catchlights, ears with a carved concha), hair as
 * real masses with strand relief (cap, fringe, long falls, bun, braid), beards,
 * a hood with its face opening carved out, and articulated hands (palm,
 * three-segment fingers in a relaxed curl, an opposed thumb, or a fist whose
 * fingers wrap the shaft one by one).
 *
 * Head units: 1 = head radius, origin at the head centre, +z = face, +y = up.
 */

const WHITE = mat('#e9e2d6', { rough: 0.25, spec: 0.7, ink: 0, sss: 0.3 });
const PUPIL = mat('#050403', { rough: 0.1, spec: 1, ink: 0 });
const SHINE = mat('#ffffff', { emissive: '#d8d0c0', ink: 0 });
const MOUTH = mat('#6a2c26', { rough: 0.6, spec: 0.2, ink: 0 });
const LASH = mat('#1a0e08', { rough: 0.7, spec: 0.1, ink: 0 });

/**
 * @param f Figure (pushed to the head frame, scale = head radius)
 * @param skinM skin material
 * @param o {gender, age (0..1), hair, hairStyle, beard, eyeC, hood, helm, helmM, trimM, crest, bandana, lipC, brow, jaw, nose}
 */
export function sculptHead(f, skinM, o = {}) {
  // carves subtract from the figure's current group: make that the head while it is built
  const g0 = f.group;
  f.group = 'head';
  sculptHeadIn(f, skinM, o);
  f.group = g0;
}

function sculptHeadIn(f, skinM, o) {
  const fem = o.gender === 'female';
  const age = o.age ?? 0;
  const S = { group: 'head', k: 0.2 };
  const soft = { group: 'head', k: 0.14 };
  const fine = { group: 'head', k: 0.07 };
  const jaw = (o.jaw ?? (fem ? 0.8 : 1));
  const lipC = o.lipC ?? mixc(skinM.color, fem ? '#b84a50' : '#9a5a4c', fem ? 0.6 : 0.38);
  const lipM = mat(lipC, { pattern: 'skin', scale: skinM.scale, sss: 0.6, rough: fem ? 0.4 : 0.55, spec: fem ? 0.4 : 0.25 });
  // cranium, face mask, forehead
  f.ell([0, 0.18, -0.1], [0.86, 0.95, 0.98], skinM, S);
  f.ell([0, -0.06, 0.28], [fem ? 0.64 : 0.7, 0.84, 0.63], skinM, S);
  f.ell([0, 0.42, 0.36], [0.68, 0.42, 0.52], skinM, S);
  // brow ridge (heavier on men), cheekbones, the jaw from ear to chin, the chin, the muzzle round the mouth
  f.ell([0, 0.22, 0.74], [0.56, fem ? 0.06 : 0.09, fem ? 0.1 : 0.14], skinM, soft);
  for (const d of [-1, 1]) {
    f.ell([d * 0.44, -0.1, 0.52], [0.2, 0.11, 0.2], skinM, { ...S, R: rotZ(d * 0.3) });
    f.cone([d * 0.6, -0.2, 0.0], [d * 0.21 * jaw, -0.76, 0.5], 0.16 * jaw, 0.12 * jaw, skinM, soft);
  }
  f.ell([0, -0.78, 0.56], [0.2 * jaw, 0.13, 0.16], skinM, S);
  // the warm cheeks (blood under the skin colours the cheek, nose tip and ears, not the forehead)
  const blushM = mat(mixc(skinM.color, '#c8505a', fem ? 0.15 : 0.09), { pattern: 'skin', scale: skinM.scale, sss: 0.6, rough: 0.78, spec: 0.08 });
  for (const d of [-1, 1]) f.ell([d * 0.4, -0.22, 0.56], [fem ? 0.24 : 0.2, fem ? 0.2 : 0.16, 0.22], blushM, { group: 'head', k: 0.3 });
  f.ell([0, -0.48, 0.64], [0.32, 0.25, 0.26], skinM, soft);
  // age: nasolabial folds and hollow temples (only where no beard hides them)
  if (age > 0.35 && !['full', 'long'].includes(o.beard)) {
    for (const d of [-1, 1]) f.carve('ell', [d * 0.27, -0.38, 0.86], [0.025, 0.14, 0.04], null, { k: 0.06, R: rotZ(d * -0.35) });
  }
  // nose: bridge, tip, alae, nostrils
  const nw = (o.nose ?? 1) * (fem ? 0.84 : 1);
  f.cone([0, 0.12, 0.84], [0, -0.22, 1.0], 0.06 * nw, 0.085 * nw, skinM, fine);
  f.sphere([0, -0.24, 0.99], 0.095 * nw, skinM, fine);
  for (const d of [-1, 1]) {
    f.ell([d * 0.11 * nw, -0.3, 0.9], [0.075, 0.062, 0.07], skinM, fine);
    f.carve('ell', [d * 0.06, -0.355, 0.95], [0.035, 0.02, 0.04], null, { k: 0.02 });
  }
  // eyes: shallow sockets, eyeballs, irises with a darker limbal ring, pupils and a wet catchlight,
  // and lids that wrap the ball to an almond opening
  const eyeM = mat(o.eyeC ?? '#4a3020', { rough: 0.15, spec: 0.9, ink: 0 });
  const ringM = mat(shade(o.eyeC ?? '#4a3020', 0.45), { rough: 0.15, spec: 0.9, ink: 0 });
  for (const d of [-1, 1]) {
    // the ball stands just proud of the face; no carved orbit (carved holes read as goggles once
    // ambient occlusion darkens them) — the lids and the brow ridge model the socket instead
    const c = [d * 0.3, 0.035, 0.745];
    const R0 = fem ? 0.162 : 0.155;
    f.sphere(c, R0, WHITE, { group: `eye${d}`, k: 0.01 });
    const ic = add(c, [-d * 0.008, -0.012, 0]);
    const zf = R0 - 0.02;
    f.ell(add(ic, [0, 0, zf - 0.004]), [0.066, 0.066, 0.028], ringM, { group: null });
    f.ell(add(ic, [0, 0, zf + 0.001]), [0.057, 0.057, 0.028], eyeM, { group: null });
    f.ell(add(ic, [0, 0, zf + 0.014]), [0.027, 0.027, 0.017], PUPIL, { group: null });
    f.sphere(add(ic, [-0.022, 0.02, zf + 0.022]), 0.011, SHINE, { group: null, shadow: false });
    // lids: separate groups, so neither melts across the eye
    // lids as shells that follow the eyeball (a thin skin over the ball, not a pill stuck on the
    // face), cut to an almond opening by two curved margins: the upper lid rests just over the
    // top of the iris, the lower lid touches its bottom rim; the outer corner tilts up a touch
    const lidM = { ...skinM, ink: 0 };
    const tilt = d * (fem ? 0.1 : 0.05); // the outer corner lifts (a drooping corner reads as sorrow)
    const lidT = rotZ(tilt);
    const lidEdge = (fem ? 0.05 : 0.03) - age * 0.02; // upper margin at the pupil, eye frame
    const lowEdge = (fem ? -0.066 : -0.058) + age * 0.008;
    const rx = fem ? 0.27 : 0.25;
    f.sphere(c, R0 + 0.014, lidM, { group: `ulid${d}`, k: 0.01 });
    f.carve('ell', add(c, [0, lidEdge - 0.3, 0.22]), [rx, 0.3, 0.4], null, { group: `ulid${d}`, k: 0.012, R: lidT });
    f.sphere(c, R0 + 0.006, lidM, { group: `llid${d}`, k: 0.01 });
    f.carve('ell', add(c, [0, lowEdge + 0.26, 0.22]), [rx, 0.26, 0.4], null, { group: `llid${d}`, k: 0.012, R: lidT });
    // the lid fold above (a soft crease under the brow) and the puffy lower lid
    f.ell(add(c, [d * 0.01, lidEdge + 0.075, 0.07]), [0.17, 0.045, 0.1], skinM, { group: 'head', k: 0.05, R: lidT });
    // lash line traced along the upper margin (women: heavier, flicked out at the corner)
    const lw = fem ? 0.011 : 0.0075;
    let prev = null;
    for (let i = 0; i <= 6; i++) {
      const u = -1 + (i / 6) * 2;
      const dx = u * 0.15;
      const y = lidEdge - 0.3 + 0.3 * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2)) + 0.003;
      const z = Math.sqrt(Math.max(0, (R0 + 0.016) ** 2 - dx * dx - y * y));
      const q = add(c, [dx * Math.cos(tilt) - y * Math.sin(tilt), dx * Math.sin(tilt) + y * Math.cos(tilt), z]);
      if (prev) f.cone(prev, q, lw * (0.7 + 0.3 * (1 - Math.abs(u))), lw * (0.7 + 0.3 * (1 - Math.abs(u))), LASH, { group: null, shadow: false });
      prev = q;
    }
    if (fem) f.cone(add(c, [d * 0.15, lidEdge + d * 0.15 * tilt - 0.012, 0.075]), add(c, [d * 0.2, lidEdge + d * 0.2 * tilt + 0.02, 0.035]), 0.008, 0.002, LASH, { group: null });
    // brows on the brow ridge
    const browM = hairMat(o.hair ?? '#3a2416', age > 0.5 ? 0.95 : fem ? 0.6 : 0.8);
    // a tapered brow: thick at the inner end, thinning and arching toward the temple
    // the brow follows the ridge: each point sits on the skin (the union of brow ridge and forehead),
    // a flat layer of hair a hair's breadth proud of it (a deep lens through a sloping forehead
    // read as a thick bar)
    const ridgeRy = fem ? 0.06 : 0.09; const ridgeRz = fem ? 0.1 : 0.14;
    const surf = (x, y) => Math.max(
      0.74 + ridgeRz * Math.sqrt(Math.max(0, 1 - (x / 0.56) ** 2 - ((y - 0.22) / ridgeRy) ** 2)),
      0.36 + 0.52 * Math.sqrt(Math.max(0, 1 - (x / 0.68) ** 2 - ((y - 0.42) / 0.42) ** 2)),
      0.28 + 0.63 * Math.sqrt(Math.max(0, 1 - (x / (fem ? 0.64 : 0.7)) ** 2 - ((y + 0.06) / 0.84) ** 2)),
    );
    const pts = fem ? [[0.12, 0.215], [0.24, 0.25], [0.37, 0.258], [0.5, 0.215]] : [[0.13, 0.215], [0.26, 0.235], [0.37, 0.232], [0.48, 0.205]];
    const wid = fem ? [0.026, 0.024, 0.018, 0.009] : [0.03, 0.028, 0.022, 0.012];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1];
      const xm = (x0 + x1) / 2; const ym = (y0 + y1) / 2;
      const ang = Math.atan2(y1 - y0, (x1 - x0)) * d;
      const half = Math.hypot(x1 - x0, y1 - y0) / 2 + 0.012;
      f.ell([d * xm, ym, surf(xm, ym) + 0.022], [half, (wid[i] + wid[i + 1]) / 2, 0.032], { ...browM, ink: 0 }, { group: `brow${d}`, k: 0.012, R: rotZ(ang), shadow: false });
    }
  }
  // lips, the parting line, a shadowed mouth slit deep inside the line, corners tucked in
  // upper lip as two lobes meeting under the philtrum (a cupid's bow), the lower lip one fuller
  // cushion that sits a touch behind the upper
  for (const d of [-1, 1]) f.ell([d * (fem ? 0.072 : 0.058), -0.474, 0.84], [fem ? 0.105 : 0.09, fem ? 0.03 : 0.028, fem ? 0.05 : 0.05], lipM, { group: 'head', k: 0.05, R: rotZ(d * (0.1 + (o.smile ?? 0) * 0.22)) });
  f.ell([0, -0.545, 0.828], [fem ? 0.14 : 0.115, fem ? 0.042 : 0.038, fem ? 0.055 : 0.052], lipM, { group: 'head', k: 0.06 });
  // the parting line, its corners lifted by a smile (o.smile 0..1)
  const sm = o.smile ?? 0;
  for (const d of [-1, 1]) f.carve('cone', [0, -0.507, 0.9], [d * (fem ? 0.16 : 0.13), -0.507 + sm * 0.07, 0.86], 0.008, { k: 0.02, rb: 0.005 });
  f.ell([0, -0.507, 0.85], [0.08, 0.004, 0.02], MOUTH, { group: null });
  if (sm > 0) for (const d of [-1, 1]) f.ell([d * 0.2, -0.47, 0.8], [0.06, 0.05, 0.06], skinM, { group: 'head', k: 0.06 }); // cheeks lift
  // ears
  for (const d of [-1, 1]) {
    f.ell([d * 0.84, -0.04, -0.06], [0.1, 0.24, 0.15], skinM, { group: 'head', k: 0.06, R: rotY(d * 0.35) });
    f.carve('ell', [d * 0.92, -0.04, -0.03], [0.05, 0.13, 0.08], null, { k: 0.04 });
  }
  headwear(f, skinM, o);
  if (o.spectacles) spectacles(f, o.spectacles === true ? '#b08a40' : o.spectacles);
}

/** Round wire spectacles on the nose, with a black ribbon looping from the temples to the chest. */
function spectacles(f, wire) {
  const wm = mat(wire, { metal: true, rough: 0.3, spec: 0.9, ink: 0.6 });
  const g = { group: null, blend: 0 };
  const r = 0.17;
  for (const d of [-1, 1]) {
    const c = [d * 0.31, 0.03, 1.0];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      f.cone([c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r * 0.86, c[2] - Math.abs(Math.cos(a0)) * 0.03], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r * 0.86, c[2] - Math.abs(Math.cos(a1)) * 0.03], 0.02, 0.02, wm, g);
    }
    // faint lens glint
    // a small glint on the glass (a full lens disc reads as opaque white in an SDF render)
    f.ell([c[0] - r * 0.4, c[1] + r * 0.42, c[2] + 0.012], [r * 0.22, r * 0.08, 0.006], mat('#ffffff', { emissive: '#c8d8e8', ink: 0 }), { group: null, shadow: false, R: rotZ(0.6) });
    // temple arm back to the ear, and the ribbon hanging from it
    f.cone([c[0] + d * r, c[1] + 0.02, c[2] - 0.04], [d * 0.86, 0.06, 0.05], 0.018, 0.018, wm, g);
    f.cone([d * 0.86, 0.04, 0.02], [d * 0.62, -1.2, 0.35], 0.022, 0.022, mat('#141010', { pattern: 'cloth', scale: 0.004, rough: 0.9 }), g);
  }
  f.cone([-0.31 + r * 0.98, 0.06, 0.99], [0.31 - r * 0.98, 0.06, 0.99], 0.02, 0.02, wm, g);
}

function hairMat(c, k = 1) {
  return mat(shade(c, k), { pattern: 'fur', scale: 0.006, rough: 0.5, spec: 0.35 });
}

function headwear(f, skinM, o) {
  const hairM = hairMat(o.hair ?? '#3a2416');
  const hard = { group: 'hair', k: 0.12 };
  const style = o.hairStyle ?? 'short';
  if (o.hood) {
    const hm = mat(o.hood, { pattern: 'cloth', scale: 0.015, rough: 0.95, spec: 0.03 });
    const hg = { group: 'hood', k: 0.2 };
    f.ell([0, 0.22, -0.08], [1.14, 1.24, 1.12], hm, hg);
    f.ell([0, 0.85, -0.55], [0.6, 0.55, 0.6], hm, hg); // the peak falls back
    // the cowl drapes onto the shoulders
    f.cone([0, -0.55, -0.15], [0, -1.55, -0.2], 1.0, 1.45, hm, { ...hg, disp: { amp: 0.05, freq: 9, twist: 1 } });
    // face opening
    f.carve('ell', [0, -0.12, 1.02], [0.78, 1.02, 0.78], null, { group: 'hood', k: 0.14 });
    f.carve('cone', [0, -0.6, 0.85], [0, -1.6, 0.9], 0.62, { group: 'hood', k: 0.12, rb: 0.55 });
    return;
  }
  if (o.helm) {
    const hm = o.helmM ?? mat('#b8bcc6', { pattern: 'metal', metal: true, rough: 0.25, spec: 1, scale: 0.05 });
    const hh = { group: 'helm', k: 0.06 };
    f.ell([0, 0.3, -0.06], [1.0, 0.94, 1.06], hm, hh);
    f.box([0, -0.02, 1.0], [0.07, 0.42, 0.05], hm, { ...hh, bevel: 0.03 });
    for (const d of [-1, 1]) f.ell([d * 0.86, -0.25, 0.08], [0.14, 0.58, 0.64], hm, hh);
    f.ell([0, 0.3, -0.06], [1.02, 0.1, 1.08], o.trimM ?? mat('#a07838', { metal: true, rough: 0.3, spec: 0.9 }), { group: null });
    if (o.crest) f.ell([0, 1.02, -0.15], [0.12, 0.5, 0.9], mat(o.crest, { pattern: 'fur', scale: 0.01 }), { group: null });
    return;
  }
  if (o.bandana) {
    const bm = mat(o.bandana, { pattern: 'cloth', scale: 0.01 });
    f.ell([0, 0.36, -0.08], [0.92, 0.8, 1.0], bm, { group: 'band', k: 0.1 });
    f.cone([-0.55, 0.3, -0.8], [-0.72, -0.35, -1.0], 0.13, 0.05, bm, { group: 'band', k: 0.08 });
  } else if (style === 'bald') {
    f.ell([0, -0.02, -0.42], [0.88, 0.42, 0.66], hairM, hard);
  } else {
    // cap following the skull, ending at a hairline above the forehead
    if (style === 'bun') {
      // hair drawn back off the face into the bun: a sleek cap with a soft centre parting and the
      // sides swept back over the ears (a full cap with side masses reads as a bowl cut)
      f.ell([0, 0.36, -0.26], [0.92, 0.86, 0.96], hairM, hard);
      for (const d of [-1, 1]) f.ell([d * 0.7, 0.16, -0.32], [0.24, 0.42, 0.52], hairM, hard);
      f.carve('cone', [0, 1.0, 0.25], [0, 0.72, 0.62], 0.025, { group: 'hair', k: 0.03, rb: 0.02 });
    } else {
      f.ell([0, 0.38, -0.2], [0.93, 0.84, 0.98], hairM, hard);
      for (const d of [-1, 1]) f.ell([d * 0.72, 0.12, -0.12], [0.24, 0.5, 0.6], hairM, hard);
    }
    if (style === 'fringe') f.ell([0, 0.66, 0.42], [0.78, 0.24, 0.42], hairM, { ...hard, R: rotX(0.4) });
    if (style === 'short') f.ell([0.2, 0.78, 0.25], [0.6, 0.22, 0.5], hairM, { ...hard, R: rotZ(-0.2) });
    if (style === 'long' || style === 'wavy') {
      const wav = style === 'wavy' ? 0.045 : 0.03;
      f.ell([0, -0.35, -0.55], [0.86, 1.15, 0.5], hairM, { ...hard, disp: { amp: wav, freq: 14 } });
      for (const d of [-1, 1]) f.cone([d * 0.66, 0.3, -0.1], [d * 0.78, -1.45, -0.3], 0.3, 0.26, hairM, { ...hard, disp: { amp: wav * 0.6, freq: 16, twist: 2 } });
      // a side parting: the hair sweeps from the part across the brow in two soft wings that
      // frame the face (no straight cap edge), then falls in locks in front of the shoulders
      const part = [0.2, 0.95, 0.3];
      for (const d of [-1, 1]) {
        const mid = [d * 0.46, d > 0 ? 0.66 : 0.74, 0.6];
        const temple = [d * 0.8, 0.22, 0.4];
        f.cone(part, mid, 0.1, 0.09, hairM, { ...hard, k: 0.22 });
        f.cone(mid, temple, 0.09, 0.075, hairM, { ...hard, k: 0.22 });
        // locks over the shoulder, waved, thinning to a tip
        const s0 = [d * 0.8, 0.1, 0.32];
        const s1 = [d * 0.92, -0.9, 0.28];
        const s2 = [d * 0.98, -2.0, 0.5];
        f.cone(s0, s1, 0.17, 0.16, hairM, { group: `lock${d}`, k: 0.1, disp: { amp: wav, freq: 12, twist: 2 } });
        f.cone(s1, s2, 0.16, 0.06, hairM, { group: `lock${d}`, k: 0.1, disp: { amp: wav, freq: 12, twist: 2 } });
      }
    }
    if (style === 'bun') {
      f.ell([0, 0.1, -0.62], [0.72, 0.62, 0.5], hairM, hard);
      f.sphere([0, 0.42, -1.02], 0.36, hairM, hard);
      f.ell([0, 0.42, -0.92], [0.42, 0.14, 0.34], mat('#6a1a1a', { pattern: 'cloth', scale: 0.01 }), { group: null, R: rotX(0.6) });
    }
    if (style === 'braid') {
      f.ell([0, -0.1, -0.6], [0.8, 0.8, 0.45], hairM, hard);
      for (let i = 0; i < 6; i++) f.sphere([0.06 * Math.sin(i * 1.7), -0.5 - i * 0.24, -0.78 - i * 0.04], 0.17 - i * 0.012, hairM, { group: 'braid', k: 0.06 });
    }
  }
  const beard = o.beard ?? 'none';
  const bm = hairMat(o.hair ?? '#3a2416', 0.92);
  const bg = { group: 'beard', k: 0.18 };
  if (beard === 'full' || beard === 'long') {
    const long = beard === 'long';
    // the mass that hides the jaw, then hanging clumps of strands with their own tips
    // (a ragged, tapering silhouette instead of a block)
    f.ell([0, -0.62, 0.42], [0.68, 0.38, 0.52], bm, bg);
    for (const d of [-1, 1]) f.ell([d * 0.56, -0.36, 0.28], [0.18, 0.4, 0.32], bm, bg);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5; // -0.5..0.5 across the chin
      const ax = u * 1.05;
      const top = [ax, -0.7 + Math.abs(u) * 0.3, 0.6 - Math.abs(u) * 0.35];
      const lenC = (long ? 0.95 : 0.5) * (1 - Math.abs(u) * 1.1) + 0.12 + ((i * 37) % 7) * 0.025;
      const tip = [ax * 0.62 + Math.sin(i * 2.3) * 0.04, top[1] - lenC, top[2] + 0.06 - Math.abs(u) * 0.1];
      f.cone(top, tip, 0.21 - Math.abs(u) * 0.07, 0.06, bm, { group: 'beard', k: 0.14, disp: { amp: 0.014, freq: 26, twist: 2 } });
    }
    // the mouth shows through the beard: a soft parting with the lower lip in it (not a cut-out box)
    f.carve('ell', [0, -0.53, 0.98], [0.16, 0.055, 0.14], null, { group: 'beard', k: 0.08 });
  }
  if (beard === 'goatee') f.ell([0, -0.84, 0.66], [0.22, 0.28, 0.2], bm, bg);
  if (beard === 'moustache' || beard === 'full' || beard === 'long' || beard === 'goatee') {
    // one moustache over the philtrum, drooping to the corners of the mouth
    f.ell([0, -0.415, 0.955], [0.1, 0.042, 0.05], bm, { group: 'beard', k: 0.06 });
    for (const d of [-1, 1]) f.cone([d * 0.03, -0.42, 0.965], [d * 0.27, -0.57, 0.84], 0.06, 0.03, bm, { group: 'beard', k: 0.06 });
  }
  if (beard === 'stubble') f.ell([0, -0.56, 0.44], [0.64, 0.42, 0.52], mat(shade(o.hair ?? '#3a2416', 0.65), { pattern: 'skin', scale: 0.003, rough: 0.9 }), { group: 'head', k: 0.05 });
}

/**
 * A hand at `at` (palm centre), fingers along `dir` (open) or wrapped around a
 * shaft along `dir` (grip). Built in the hand's own frame by the caller's
 * push(at, alignY(dir, [side,0,0]), s). Units: figure units at s = 1.
 * o: {grip, curl (0 open .. 1 closed), spread, claws, clawM, nails}
 */
export function handShape(f, m, side, o = {}) {
  const g = { group: 'hand', k: 0.006 };
  const claws = o.claws ? (o.clawM ?? mat('#d8ccae', { pattern: 'bone', scale: 0.01 })) : null;
  if (o.grip) {
    // palm behind the shaft, four fingers wrapping it one by one, thumb over the top
    f.box([side * -0.004, 0.004, -0.017], [0.02, 0.028, 0.009], m, { ...g, bevel: 0.008 });
    for (let i = 0; i < 4; i++) {
      const y = 0.021 - i * 0.0135;
      const r = 0.0064 - (i === 3 ? 0.0012 : 0);
      const p0 = [side * 0.016, y, -0.014];
      const p1 = [side * 0.019, y, 0.008];
      const p2 = [side * 0.004, y - 0.001, 0.021];
      const p3 = [side * -0.011, y - 0.002, 0.014];
      f.cone(p0, p1, r * 1.1, r, m, g);
      f.cone(p1, p2, r, r * 0.95, m, g);
      f.cone(p2, p3, r * 0.95, r * 0.85, m, g);
      if (claws) f.cone(p3, add(p3, [side * -0.006, -0.003, -0.008]), 0.0035, 0.001, claws, { group: null });
    }
    f.cone([side * -0.018, 0.012, -0.012], [side * -0.016, 0.03, 0.006], 0.0085, 0.007, m, g);
    f.cone([side * -0.016, 0.03, 0.006], [side * -0.004, 0.034, 0.016], 0.007, 0.006, m, g);
    return;
  }
  const curl = o.curl ?? 0.35;
  const spread = o.spread ?? 0.4;
  f.box([0, 0.004, 0], [0.021, 0.026, 0.0085], m, { ...g, bevel: 0.0075 });
  const lens = [[0.024, 0.016, 0.012], [0.027, 0.018, 0.013], [0.025, 0.017, 0.012], [0.02, 0.013, 0.01]];
  for (let i = 0; i < 4; i++) {
    const x = (1.5 - i) * 0.0105 * -side;
    const a = (i - 1.5) * 0.12 * spread * -side;
    let p = [x, 0.028, 0.001];
    let dir = [Math.sin(a), Math.cos(a), 0];
    let r = 0.0058 - (i === 3 ? 0.0009 : 0);
    const c = curl * (0.8 + i * 0.12);
    for (let s = 0; s < 3; s++) {
      // each knuckle bends the finger toward the palm (+z)
      const ang = c * (s === 0 ? 0.55 : 0.75);
      const cy = Math.cos(ang); const sy = Math.sin(ang);
      dir = [dir[0], dir[1] * cy - dir[2] * sy, dir[1] * sy + dir[2] * cy];
      const q = add(p, scl(dir, lens[i][s]));
      f.cone(p, q, r, r * 0.9, m, g);
      p = q;
      r *= 0.88;
    }
    if (claws) f.cone(p, add(p, scl(dir, 0.012)), 0.004, 0.0008, claws, { group: null });
  }
  // thumb: from the heel of the palm, opposed
  const t0 = [side * 0.02, -0.012, 0.004];
  const t1 = add(t0, [side * 0.014, 0.018, 0.012 + curl * 0.006]);
  const t2 = add(t1, [side * (0.004 - curl * 0.012), 0.016, 0.008 + curl * 0.01]);
  f.cone(t0, t1, 0.0085, 0.0068, m, g);
  f.cone(t1, t2, 0.0068, 0.0055, m, g);
  if (claws) f.cone(t2, add(t2, [0, 0.01, 0.006]), 0.0035, 0.0008, claws, { group: null });
}

export { mul3 };
