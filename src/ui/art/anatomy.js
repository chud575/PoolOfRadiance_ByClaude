import { mat, add, scl, rotX, rotY, rotZ, mul3, shade, mixc } from './sculpt.js';

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
const MOUTH = mat('#2a0c0a', { rough: 0.6, spec: 0.2, ink: 0.2 });
const LASH = mat('#1a0e08', { rough: 0.7, spec: 0.1, ink: 0 });

/**
 * @param f Figure (pushed to the head frame, scale = head radius)
 * @param skinM skin material
 * @param o {gender, age (0..1), hair, hairStyle, beard, eyeC, hood, helm, helmM, trimM, crest, bandana, lipC, brow, jaw, nose}
 */
export function sculptHead(f, skinM, o = {}) {
  const fem = o.gender === 'female';
  const age = o.age ?? 0;
  const S = { group: 'head', k: 0.22 };
  const soft = { group: 'head', k: 0.16 };
  const fine = { group: 'head', k: 0.08 };
  const jaw = (o.jaw ?? (fem ? 0.78 : 1));
  const lipC = o.lipC ?? mixc(skinM.color, fem ? '#b04a48' : '#9a5a4c', fem ? 0.55 : 0.4);
  const lipM = mat(lipC, { pattern: 'skin', scale: skinM.scale, sss: 0.55, rough: 0.45, spec: 0.35 });
  // skull and face masses
  f.ell([0, 0.2, -0.12], [0.84, 0.93, 0.96], skinM, S);
  f.ell([0, -0.1, 0.3], [0.7, 0.82, 0.62], skinM, S);
  f.ell([0, 0.4, 0.42], [0.66, 0.42, 0.46], skinM, S);
  // brow ridge, cheekbones, fleshy cheeks
  f.ell([0, 0.21, 0.74], [0.6, fem ? 0.08 : 0.11, fem ? 0.13 : 0.17], skinM, soft);
  for (const d of [-1, 1]) {
    f.ell([d * 0.44, -0.06, 0.58], [0.24, 0.15, 0.22], skinM, { ...soft, R: rotZ(d * 0.35) });
    f.ell([d * 0.35, -0.38, 0.52], [0.25, 0.25, 0.26], skinM, soft);
    // jaw line from the ear to the chin
    f.cone([d * 0.62, -0.18, -0.02], [d * 0.24 * jaw, -0.78, 0.52], 0.17 * jaw, 0.13 * jaw, skinM, soft);
  }
  f.ell([0, -0.82, 0.6], [0.24 * jaw, 0.17, 0.2], skinM, soft);
  f.ell([0, -0.47, 0.72], [0.33, 0.22, 0.22], skinM, soft);
  if (age > 0.4) for (const d of [-1, 1]) f.carve('ell', [d * 0.4, -0.3, 0.74], [0.12, 0.2, 0.08], null, { k: 0.12 });
  // nose: bridge, tip, alae, nostrils
  const nw = (o.nose ?? 1) * (fem ? 0.85 : 1);
  f.cone([0, 0.14, 0.84], [0, -0.24, 1.04], 0.07 * nw, 0.1 * nw, skinM, fine);
  f.sphere([0, -0.25, 1.02], 0.105 * nw, skinM, fine);
  for (const d of [-1, 1]) {
    f.ell([d * 0.12 * nw, -0.3, 0.91], [0.085, 0.07, 0.075], skinM, fine);
    f.carve('ell', [d * 0.07, -0.37, 0.97], [0.04, 0.025, 0.045], null, { k: 0.03 });
  }
  // eye sockets carved under the brow, lidded eyeballs, iris, pupil, catchlight
  const eyeM = mat(o.eyeC ?? '#4a3020', { rough: 0.2, spec: 0.9, ink: 0 });
  for (const d of [-1, 1]) {
    f.carve('ell', [d * 0.31, 0.05, 0.86], [0.21, 0.13, 0.17], null, { k: 0.12 });
    const c = [d * 0.31, 0.05, 0.6];
    const eg = { group: `eye${d}`, k: 0.02 };
    f.sphere(c, 0.14, WHITE, eg);
    f.ell(add(c, [d * -0.01, 0, 0.115]), [0.072, 0.072, 0.035], eyeM, { group: null });
    f.ell(add(c, [d * -0.01, 0, 0.138]), [0.034, 0.034, 0.018], PUPIL, { group: null });
    f.sphere(add(c, [d * -0.01 - 0.028, 0.03, 0.146]), 0.016, SHINE, { group: null, shadow: false });
    // upper lid (covers the top of the eyeball, with a crease) and lower lid
    f.ell(add(c, [0, 0.112, 0.025]), [0.17, 0.07, 0.15], skinM, { group: 'head', k: 0.05, R: rotZ(d * -0.1) });
    f.ell(add(c, [0, -0.122, 0.02]), [0.155, 0.045, 0.135], skinM, { group: 'head', k: 0.05 });
    // lash line along the lid edge: what makes an eye read at a distance
    f.ell(add(c, [d * 0.005, 0.05, 0.125]), [0.15, 0.016, 0.045], LASH, { group: null, R: rotZ(d * -0.1) });
    if (!fem && age < 0.6) f.ell([d * 0.34, 0.27, 0.76], [0.19, 0.05, 0.07], hairMat(o.hair ?? '#3a2416', o.brow ?? 1), { group: null, R: rotZ(d * -0.15) });
    else f.ell([d * 0.34, 0.26, 0.77], [0.18, 0.03, 0.05], hairMat(o.hair ?? '#3a2416', 0.8), { group: null, R: rotZ(d * -0.22) });
  }
  // lips and the mouth line
  f.ell([0, -0.47, 0.89], [0.19, fem ? 0.06 : 0.05, 0.07], lipM, { group: 'head', k: 0.06 });
  f.ell([0, -0.57, 0.87], [0.16, fem ? 0.07 : 0.06, 0.075], lipM, { group: 'head', k: 0.06 });
  f.carve('ell', [0, -0.515, 0.95], [0.18, 0.014, 0.06], null, { k: 0.03 });
  f.ell([0, -0.515, 0.86], [0.17, 0.012, 0.03], MOUTH, { group: null });
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
    f.ell([c[0], c[1], c[2] + 0.01], [r * 0.92, r * 0.8, 0.012], mat('#c8d8e8', { rough: 0.05, spec: 1.2, ink: 0, emissive: '#1a2228' }), { group: null, shadow: false });
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
    f.ell([0, 0.38, -0.2], [0.93, 0.84, 0.98], hairM, hard);
    for (const d of [-1, 1]) f.ell([d * 0.72, 0.12, -0.12], [0.24, 0.5, 0.6], hairM, hard);
    if (style === 'fringe') f.ell([0, 0.66, 0.42], [0.78, 0.24, 0.42], hairM, { ...hard, R: rotX(0.4) });
    if (style === 'short') f.ell([0.2, 0.78, 0.25], [0.6, 0.22, 0.5], hairM, { ...hard, R: rotZ(-0.2) });
    if (style === 'long' || style === 'wavy') {
      const wav = style === 'wavy' ? 0.07 : 0.035;
      f.ell([0, -0.35, -0.55], [0.86, 1.15, 0.5], hairM, { ...hard, disp: { amp: wav, freq: 14 } });
      for (const d of [-1, 1]) f.cone([d * 0.66, 0.3, -0.1], [d * 0.78, -1.45, -0.3], 0.3, 0.26, hairM, { ...hard, disp: { amp: wav * 0.6, freq: 16, twist: 2 } });
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
    f.ell([0, -0.66, 0.42], [0.7, 0.42, 0.55], bm, bg);
    f.ell([0, beard === 'long' ? -1.05 : -0.86, 0.6], [0.5, beard === 'long' ? 0.75 : 0.36, 0.38], bm, { ...bg, disp: { amp: 0.04, freq: 18 } });
    for (const d of [-1, 1]) f.ell([d * 0.55, -0.4, 0.3], [0.2, 0.42, 0.34], bm, bg);
    f.carve('ell', [0, -0.52, 1.0], [0.16, 0.05, 0.12], null, { group: 'beard', k: 0.05 });
  }
  if (beard === 'goatee') f.ell([0, -0.84, 0.66], [0.22, 0.28, 0.2], bm, bg);
  if (beard === 'moustache' || beard === 'full' || beard === 'long' || beard === 'goatee') {
    for (const d of [-1, 1]) f.cone([d * 0.04, -0.4, 0.98], [d * 0.27, -0.56, 0.84], 0.065, 0.035, bm, { group: 'beard', k: 0.06 });
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
