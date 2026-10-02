import {
  Sculpt, sdEllipsoid, v3, vadd, vsub, vscale, vdot, vcross, vlen, vnorm, vlerp,
  M_ID, mAxes, mApply, mMul, mEuler, mAlongY, mRotX, ik2,
} from './sdfSculpt.js';

/**
 * The party miniature, sculpted as a signed-distance figure from a resolved
 * appearance (lookData.resolveAppearance): a posed skeleton (two-bone IK for
 * arms and legs), a continuous body with tapered limbs and gripping fists, a
 * head with a real skull, jaw, cheekbones, nose, lids and lips whose
 * proportions follow race, sex and the chosen head template (jaw width, nose
 * length and bridge, eye spacing, brow mass, expression), hair and beards
 * as grooved strand clumps, and the armour or clothes of the body template
 * or readied gear — plate, mail, scale, leathers, robes, tabard, furs or
 * vestments, cloaks, hoods and helms — plus sleepers' blankets.
 *
 * buildFigure(app, pose, opt) → {sculpt, frames}   (no three.js here)
 *   frames: face (for the painted face texture), hands, weapon, shield, height
 */

export const PATTERN = { none: 0, mail: 1, scale: 2, cloth: 3, leather: 4, hair: 5, metal: 6, fur: 7, wood: 8, skin: 9, linen: 10, eye: 11 };

const RACE_BODY = {
  //          H     head    leg   torso  shoulder hip    girth  arm
  human: { H: 1.78, head: 0.232, leg: 0.5, torso: 0.29, sh: 0.18, hip: 0.09, girth: 1.0, arm: 0.335 },
  elf: { H: 1.68, head: 0.222, leg: 0.52, torso: 0.29, sh: 0.158, hip: 0.083, girth: 0.82, arm: 0.345 },
  halfElf: { H: 1.74, head: 0.228, leg: 0.51, torso: 0.29, sh: 0.17, hip: 0.087, girth: 0.92, arm: 0.34 },
  dwarf: { H: 1.32, head: 0.238, leg: 0.37, torso: 0.335, sh: 0.215, hip: 0.112, girth: 1.42, arm: 0.37 },
  gnome: { H: 1.04, head: 0.218, leg: 0.39, torso: 0.31, sh: 0.142, hip: 0.086, girth: 1.02, arm: 0.34 },
  halfling: { H: 0.98, head: 0.208, leg: 0.41, torso: 0.3, sh: 0.135, hip: 0.086, girth: 0.98, arm: 0.34 },
};

/** Race face shape (multiplies the head template's own face values). */
const RACE_FACE = {
  human: {},
  elf: { w: 0.9, jaw: 0.8, cheek: 1.25, nose: 0.88, bridge: 0.8, long: 1.06, chin: 0.85, brow: 0.7, eye: 1.08, slant: 0.45 },
  halfElf: { w: 0.94, jaw: 0.9, cheek: 1.15, nose: 0.94, long: 1.03, brow: 0.85, slant: 0.5 },
  dwarf: { w: 1.16, jaw: 1.25, cheek: 1.08, nose: 1.32, bridge: 1.4, tip: 1.4, long: 0.95, brow: 1.3, eye: 0.92, lips: 0.85 },
  gnome: { w: 1.02, jaw: 0.92, cheek: 1.2, nose: 1.9, bridge: 1.2, tip: 2.1, long: 0.95, eye: 1.08, brow: 1.1, ears: 1.35 },
  halfling: { w: 1.1, jaw: 0.86, cheek: 1.4, nose: 0.82, tip: 1.15, long: 0.88, chin: 0.85, eye: 1.18, lips: 1.08, brow: 0.8 },
};

export function faceParams(app) {
  const f = { w: 1, jaw: 1, chin: 1, cheek: 1, nose: 1, bridge: 1, tip: 1, eye: 1, sp: 1, brow: 1, lips: 1, mouth: 1, long: 1, lid: 0, slant: 0, ears: 1 };
  const t = app.face ?? {};
  const r = RACE_FACE[app.race] ?? {};
  // Template deviations are exaggerated (as a caricaturist would) so the
  // heads read apart at thumbnail size; race shapes apply on top.
  const EX = 1.75;
  for (const k of Object.keys(f)) {
    if (k === 'lid' || k === 'slant') f[k] = (t[k] ?? 0) * 1.3 + (r[k] ?? 0);
    else f[k] = Math.max(0.55, 1 + ((t[k] ?? 1) - 1) * EX) * (r[k] ?? 1);
  }
  if (app.fem) {
    f.jaw *= 0.84; f.chin *= 0.8; f.brow *= 0.55; f.nose *= 0.88; f.bridge *= 0.85; f.lips *= 1.06; f.cheek *= 1.06; f.w *= 0.95; f.eye *= 1.05;
  }
  // Demi-human women keep their race's cues but read as women: a dwarf woman's broad face is
  // softened at jaw, nose and brow, with fuller lips and larger eyes.
  if (app.fem && (app.race === 'dwarf' || app.race === 'gnome')) { f.jaw *= 0.84; f.nose *= 0.86; f.bridge *= 0.85; f.brow *= 0.75; f.w *= 0.95; f.lips *= 1.12; f.eye *= 1.07; f.chin *= 0.9; }
  if (app.fem && app.race === 'halfling') { f.cheek *= 1.05; f.eye *= 1.03; }
  if (app.expr === 'weary') f.lid += 0.4;
  f.brow = Math.min(1.7, f.brow);
  return f;
}

/**
 * Where the features sit on the head (head-local metres, human scale; multiply
 * by the race head scale). Shared by the sculpt and the painted face texture.
 */
export function faceLayout(app) {
  const fp = faceParams(app);
  const fw = fp.w;
  const fl = fp.long;
  return {
    fp,
    ex: 0.0305 * fp.sp * fw,
    eyeY: 0.006,
    er: 0.0112 * fp.eye ** 0.5,
    mouthY: -0.062 * fl,
    mw: fp.mouth,
    tipY: -0.03 * fp.nose,
    browTilt: app.expr === 'scowl' ? 0.32 : app.expr === 'weary' ? -0.18 : app.expr === 'proud' ? -0.06 : app.expr === 'stern' ? 0.12 : 0,
    smirk: app.expr === 'smirk' ? 0.16 : 0,
    fw, fl,
  };
}

// ------------------------------------------------------------------ poses

/**
 * Pose specs. Positions are scaled by s = H / 1.78 and measured from the
 * figure origin (feet on y = 0, facing +z; the character's right is −x).
 */
const POSES = {
  stand: (B) => ({
    pelvis: [0.0, B.hipY - 0.012 * B.H, 0], pelvisRot: [0, -0.14, 0.035], torso: [0.03, 0.2, -0.03], head: [-0.03, 0.1, 0.03],
    feet: { R: [-0.12, 0, -0.03], L: [0.13, 0, 0.14] }, footYaw: { R: -0.32, L: 0.22 }, kneePole: [0, 0.2, 1],
    hands: { R: { from: 'shoulderR', d: [-0.07, -0.3, 0.25] }, L: { from: 'chest', d: [0.11, -0.13, 0.3] } },
    elbowPole: { R: [-1, -0.7, -0.5], L: [1, -0.6, -0.5] },
    grip: { R: [-0.12, 0.95, 0.28], L: [0.05, 1, 0.05] },
    shieldN: [0.38, 0.04, 1],
  }),
  display: (B) => ({
    pelvis: [0, B.hipY - 0.008 * B.H, 0], pelvisRot: [0, -0.05, 0.02], torso: [0.02, 0.06, -0.02], head: [-0.02, 0.04, 0.02],
    feet: { R: [-0.12, 0, 0.0], L: [0.12, 0, 0.06] }, footYaw: { R: -0.3, L: 0.28 }, kneePole: [0, 0.2, 1],
    hands: { R: { from: 'shoulderR', d: [-0.1, -0.36, 0.17] }, L: { from: 'chest', d: [0.2, -0.2, 0.24] } },
    elbowPole: { R: [-1, -0.6, -0.4], L: [1, -0.5, -0.4] },
    grip: { R: [-0.35, 0.86, 0.36], L: [0.05, 1, 0.05] },
    shieldN: [0.45, 0.04, 1],
  }),
  guard: (B) => ({
    pelvis: [0, B.hipY - 0.006 * B.H, 0], pelvisRot: [0, 0.1, -0.02], torso: [0.0, -0.08, 0.02], head: [0.04, -0.3, 0],
    feet: { R: [-0.13, 0, 0.02], L: [0.13, 0, 0.0] }, footYaw: { R: -0.3, L: 0.3 }, kneePole: [0, 0.2, 1],
    hands: { R: { from: 'shoulderR', d: [-0.1, -0.3, 0.16] }, L: { from: 'hipL', d: [0.1, 0.06, 0.1] } },
    elbowPole: { R: [-1, -0.5, -0.6], L: [1, 0, -0.4] },
    grip: { R: [0, 1, 0.06], L: [0, 1, 0.2] },
    shieldN: [1, 0.05, 0.35],
  }),
  sit: (B) => ({
    pelvis: [0, B.seatH + 0.075 * B.s, -0.03], pelvisRot: [0, 0, 0], torso: [0.32, 0, 0], head: [-0.24, 0, 0],
    feet: { R: [-0.15, 0, 0.47], L: [0.16, 0, 0.45] }, footYaw: { R: -0.2, L: 0.2 }, kneePole: [0, 1, 1.2],
    hands: { R: { from: 'kneeR', d: [0.02, 0.06, -0.08] }, L: { from: 'kneeL', d: [-0.02, 0.06, -0.08] } },
    elbowPole: { R: [-1, -0.4, -0.6], L: [1, -0.4, -0.6] },
    grip: { R: [0.9, 0, 0.3], L: [-0.9, 0, 0.3] },
    seat: true,
  }),
  sleep: (B) => ({
    pelvis: [0, B.hipY, 0], pelvisRot: [0, 0, 0], torso: [0, 0, 0], head: [-0.05, 0.42, 0.1],
    feet: { R: [-0.08, 0, 0.0], L: [0.08, 0, 0.0] }, footYaw: { R: -0.35, L: 0.35 }, kneePole: [0, 0.3, 1],
    hands: { R: { from: 'hipR', d: [-0.07, -0.05, 0.06] }, L: { from: 'hipL', d: [0.06, -0.02, 0.07] } },
    elbowPole: { R: [-1, 0.2, -0.3], L: [1, 0.2, -0.3] },
    grip: { R: [0, 0.2, 1], L: [0, 0.2, 1] },
    asleep: true,
  }),
  portrait: (B) => ({
    pelvis: [0, B.hipY, 0], pelvisRot: [0, 0.28, 0], torso: [0.02, 0.0, 0], head: [-0.06, -0.32, 0.0],
    feet: { R: [-0.11, 0, 0], L: [0.11, 0, 0] }, footYaw: { R: -0.2, L: 0.2 }, kneePole: [0, 0.2, 1],
    hands: { R: { from: 'hipR', d: [-0.07, -0.08, 0.05] }, L: { from: 'hipL', d: [0.07, -0.08, 0.05] } },
    elbowPole: { R: [-1, 0, -0.6], L: [1, 0, -0.6] },
    grip: { R: [0, 0.2, 1], L: [0, 0.2, 1] },
  }),
};

function bodyOf(app) {
  const R = { ...(RACE_BODY[app.race] ?? RACE_BODY.human) };
  if (app.fem) { R.H *= 0.94; R.girth *= 0.88; R.sh *= 0.87; R.hip *= 1.08; R.head *= 0.97; }
  // A dwarf woman is broad and strong, not barrel-round: trim the girth toward a waist.
  if (app.fem && app.race === 'dwarf') { R.girth *= 0.88; R.sh *= 1.04; }
  const H = R.H;
  const s = H / 1.78;
  const g = s * R.girth;
  const hipY = R.leg * H;
  const ankle = 0.072 * s;
  const legL = hipY - ankle - 0.01 * s;
  return {
    ...R, H, s, g, hipY,
    ankle,
    thigh: legL * 0.505,
    shin: legL * 0.495,
    torsoL: R.torso * H,
    upper: R.arm * H * 0.53,
    fore: R.arm * H * 0.47,
    hs: R.head / 0.232,
    hand: (0.86 + 0.14 * R.girth) * Math.max(0.62, s),
    seatH: 0.24 * H,
  };
}

/** Solve the skeleton for a pose. */
/** Interaction variants layered on a pose (camp: hands to the fire, heads turned to a neighbour). */
const POSE_MODS = {
  warm: { torso: [0.12, 0, 0], head: [0.05, 0, 0], hands: { R: { from: 'shoulderR', d: [0.02, -0.16, 0.4] }, L: { from: 'shoulderL', d: [-0.02, -0.16, 0.4] } }, elbowPole: { R: [-1, -1, 0], L: [1, -1, 0] }, grip: { R: [0, 0.3, 1], L: [0, 0.3, 1] } },
  talkL: { head: [0, 0.75, 0.05], torso: [0, 0.2, 0], hands: { L: { from: 'chest', d: [0.18, -0.06, 0.26] } }, grip: { L: [0, 0.6, 1] } },
  talkR: { head: [0, -0.75, -0.05], torso: [0, -0.2, 0], hands: { R: { from: 'chest', d: [-0.18, -0.08, 0.24] } }, grip: { R: [0, 0.6, 1] } },
  listen: { head: [0.18, 0.45, 0.12], torso: [0.06, 0.1, 0], hands: { R: { from: 'kneeL', d: [-0.06, 0.07, -0.02] }, L: { from: 'kneeL', d: [0.04, 0.1, -0.06] } } },
};

function skeleton(B, poseName, modName) {
  const P = { ...(POSES[poseName] ?? POSES.stand)(B) };
  const mod = POSE_MODS[modName];
  if (mod) {
    if (mod.head) P.head = P.head.map((v, i) => v + mod.head[i]);
    if (mod.torso) P.torso = P.torso.map((v, i) => v + mod.torso[i]);
    if (mod.hands) P.hands = { ...P.hands, ...mod.hands };
    if (mod.elbowPole) P.elbowPole = { ...P.elbowPole, ...mod.elbowPole };
    if (mod.grip) P.grip = { ...P.grip, ...mod.grip };
  }
  const s = B.s;
  const J = { pose: P, name: poseName };
  J.pelvis = [P.pelvis[0] * s, P.pelvis[1], P.pelvis[2] * s];
  if (poseName !== 'sit') J.pelvis[0] = P.pelvis[0] * s;
  J.pelvisR = mEuler(...P.pelvisRot);
  J.spineR = mMul(J.pelvisR, mEuler(...P.torso));
  const up = (R) => [R[3], R[4], R[5]];
  const side = (R) => [R[0], R[1], R[2]];
  const fwd = (R) => [R[6], R[7], R[8]];
  J.up = up(J.spineR);
  J.side = side(J.spineR);
  J.fwd = fwd(J.spineR);
  J.neck = vadd(J.pelvis, vscale(J.up, B.torsoL));
  J.chest = vadd(J.pelvis, vscale(J.up, B.torsoL * 0.7));
  J.waist = vadd(J.pelvis, vscale(J.up, B.torsoL * 0.3));
  J.headR = mMul(J.spineR, mEuler(...P.head));
  const hup = up(J.headR);
  const neckL = (0.055 + 0.02 * (B.hs - 1)) * Math.max(0.6, s);
  J.neckTop = vadd(J.neck, vadd(vscale(J.up, neckL * 0.6), vscale(hup, neckL * 0.4)));
  J.hs = B.hs;
  J.head = vadd(J.neckTop, vadd(vscale(hup, 0.085 * B.hs), vscale(fwd(J.headR), 0.012 * B.hs)));
  const pS = side(J.pelvisR);
  const pU = up(J.pelvisR);
  for (const k of ['L', 'R']) {
    const sg = k === 'L' ? 1 : -1;
    J[`shoulder${k}`] = vadd(J.neck, vadd(vscale(J.side, sg * B.sh), vscale(J.up, -0.035 * s)));
    J[`hip${k}`] = vadd(J.pelvis, vadd(vscale(pS, sg * B.hip), vscale(pU, -0.035 * s)));
  }
  // Legs.
  for (const k of ['L', 'R']) {
    const f = P.feet[k];
    const ank = [f[0] * s, B.ankle + f[1] * s, f[2] * s];
    const hip = J[`hip${k}`];
    const pole = vadd(vlerp(hip, ank, 0.5), vscale(vnorm(P.kneePole), 0.5));
    J[`knee${k}`] = ik2(hip, ank, B.thigh, B.shin, pole);
    // ik2 clamps: recompute the ankle on the reachable sphere.
    const kn = J[`knee${k}`];
    const dir = vnorm(vsub(ank, kn));
    J[`ankle${k}`] = vadd(kn, vscale(dir, B.shin));
    const yaw = P.footYaw[k];
    J[`toe${k}`] = vnorm([Math.sin(yaw) * (k === 'L' ? 1 : 1), 0, Math.cos(yaw)]);
  }
  // Arms.
  for (const k of ['L', 'R']) {
    const hd = P.hands[k];
    const from = hd.from === 'chest' ? J.chest : J[hd.from];
    const tgt = vadd(from, vscale(hd.d, s));
    const sh = J[`shoulder${k}`];
    const pole = vadd(vlerp(sh, tgt, 0.5), vscale(vnorm(P.elbowPole[k]), 0.5));
    const el = ik2(sh, tgt, B.upper, B.fore, pole);
    J[`elbow${k}`] = el;
    const fdir = vnorm(vsub(tgt, el));
    J[`wrist${k}`] = vadd(el, vscale(fdir, B.fore));
    // Fist frame: Y = grip axis, X = knuckles (forearm direction ⟂ grip).
    let g = vnorm(P.grip[k]);
    let kx = vsub(fdir, vscale(g, vdot(fdir, g)));
    if (vlen(kx) < 0.2) { g = vnorm(vcross(fdir, [0, 0, 1])); kx = vsub(fdir, vscale(g, vdot(fdir, g))); }
    kx = vnorm(kx);
    const kz = vnorm(vcross(kx, g));
    const hsz = B.hand;
    J[`hand${k}`] = { c: vadd(J[`wrist${k}`], vscale(fdir, 0.042 * hsz)), R: mAxes(kx, g, kz), fdir, size: hsz };
  }
  return J;
}

// ------------------------------------------------------------------ sculpting

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const grey = (a) => (a[0] + a[1] + a[2]) / 3;
const desat = (a, t) => mix(a, [grey(a), grey(a), grey(a)], t);
const hashf = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * Build the sculpt for an appearance in a pose.
 * @param {ReturnType<import('./lookData.js').resolveAppearance>} app
 * @param {string} poseName  stand | display | guard | sit | sleep | portrait
 * @param {{blanket?: string, wounded?: boolean, noWeapon?: boolean, bust?: boolean, noHead?: boolean}} [opt]
 */
export function buildFigure(app, poseName = 'stand', opt = {}) {
  const B = bodyOf(app);
  const J = skeleton(B, poseName, opt.mod);
  const P = J.pose;
  const sc = new Sculpt();
  const s = B.s;
  const g = B.g;
  const hs = B.hs;
  const L = app.lin;
  const fp = faceParams(app);
  const body = app.body;
  const asleep = !!P.asleep;
  const sitting = !!P.seat;

  // ---- materials
  const skinC = desat(L(app.skinHex), 0.26);
  const hairC = L(app.hairHex);
  const clothC = L(app.clothHex);
  const trimC = L(app.trimHex);
  const mat = (color, o = {}) => sc.material({ color, ...o });
  const M = {
    skin: mat(skinC, { rough: 0.52, pattern: PATTERN.skin, soft: 0.004, edge: 0.18, wash: 0.55, face: 1 }),
    lip: mat(mix(skinC, [0.4, 0.14, 0.12], app.fem ? 0.16 : 0.08), { rough: 0.42, pattern: PATTERN.skin, soft: 0.004, face: 1, edge: 0.15 }),
    eye: mat([0.56, 0.52, 0.47], { rough: 0.15, pattern: PATTERN.eye, soft: 0.001, edge: 0, wash: 0.3, face: 1 }),
    hair: mat(hairC, { rough: 0.62, pattern: PATTERN.hair, soft: 0.007, edge: 0.55, wash: 0.75 }),
    cloth: mat(clothC, { rough: 0.92, pattern: PATTERN.cloth, soft: 0.003, edge: 0.3, wash: 0.65 }),
    clothDark: mat(mulc(clothC, 0.55), { rough: 0.95, pattern: PATTERN.cloth, edge: 0.3, wash: 0.6 }),
    trim: mat(trimC, { rough: 0.9, pattern: PATTERN.cloth, edge: 0.3 }),
    trousers: mat(L('#33323a'), { rough: 0.95, pattern: PATTERN.cloth, edge: 0.25, wash: 0.6 }),
    linen: mat(L('#a89c82'), { rough: 0.9, pattern: PATTERN.linen, edge: 0.25, wash: 0.7 }),
    leather: mat(L('#4a2c18'), { rough: 0.6, pattern: PATTERN.leather, edge: 0.45, wash: 0.65 }),
    darkLeather: mat(L('#2f2016'), { rough: 0.58, pattern: PATTERN.leather, edge: 0.45, wash: 0.6 }),
    boots: mat(L('#33241a'), { rough: 0.5, pattern: PATTERN.leather, edge: 0.5, wash: 0.6 }),
    steel: mat(L('#a9adb5'), { rough: 0.42, metal: 1, pattern: PATTERN.metal, edge: 0.35, wash: 0.5 }),
    darkSteel: mat(L('#666a72'), { rough: 0.5, metal: 1, pattern: PATTERN.metal, edge: 0.35, wash: 0.5 }),
    mail: mat(L('#80858d'), { rough: 0.6, metal: 1, pattern: PATTERN.mail, edge: 0.2, wash: 0.6 }),
    scale: mat(L('#9a7c48'), { rough: 0.48, metal: 1, pattern: PATTERN.scale, edge: 0.3, wash: 0.65 }),
    gilt: mat(L('#d0a650'), { rough: 0.3, metal: 1, pattern: PATTERN.metal, edge: 0.4 }),
    fur: mat(L('#8a7258'), { rough: 0.95, pattern: PATTERN.fur, edge: 0.6, wash: 0.8, soft: 0.006 }),
    rope: mat(L('#9a8458'), { rough: 0.9, pattern: PATTERN.cloth, edge: 0.4 }),
    blanket: mat(L(opt.blanket ?? '#5a4a3a'), { rough: 0.95, pattern: PATTERN.cloth, edge: 0.35, wash: 0.75 }),
    pillow: mat(L('#b8ab90'), { rough: 0.95, pattern: PATTERN.linen, edge: 0.3, wash: 0.7 }),
    book: mat(L('#5a1e1a'), { rough: 0.6, pattern: PATTERN.leather, edge: 0.5 }),
  };
  const GR = { body: 0, garment: 1, armor: 2, plate: 3, cloak: 4, eyes: 5, belt: 6, blanket: 7, hair: 8 };

  const robe = body === 'robe' || body === 'vestments';
  const mailBody = body === 'chain' || body === 'tabard';
  const scaleBody = body === 'scale';
  const plate = body === 'plate';
  const leatherBody = body === 'leather' || body === 'fur';
  const tunic = body === 'tunic';
  const halfling = app.race === 'halfling';

  // Base garment colours by body.
  const torsoMat = robe ? (body === 'vestments' ? M.linen : M.cloth) : tunic ? M.cloth : M.clothDark;
  const legMat = robe ? M.trousers : M.trousers;
  const armMat = robe ? (body === 'vestments' ? M.linen : M.cloth) : tunic ? M.cloth : M.clothDark;

  const limb = (a, b, ra, rb, m, o = {}) => sc.cone(a, b, ra, rb, { mat: m, g: GR.body, k: 0.03 * s, ...o });
  const E = (c, r, R, m, o = {}) => sc.ellipsoid(c, r, R, { mat: m, g: GR.body, k: 0.035 * s, ...o });
  const pR = J.pelvisR;
  const sR = J.spineR;
  const at = (base, R, d) => vadd(base, mApply(R, vscale(d, s)));

  // ================================================================ BODY
  // Pelvis, belly, ribcage and shoulder girdle melt into one torso.
  const hipW = B.hip / 0.09;
  E(at(J.pelvis, pR, [0, 0.0, -0.012]), [0.145 * g * hipW, 0.105 * s, 0.1 * g], pR, torsoMat);
  E(vlerp(J.pelvis, J.neck, 0.36), [0.132 * g, 0.13 * s, 0.09 * g], sR, torsoMat);
  const chestC = at(vlerp(J.pelvis, J.neck, 0.66), sR, [0, 0, 0.008]);
  E(chestC, [(app.fem ? 0.138 : 0.158) * g, 0.15 * s, (app.fem ? 0.098 : 0.108) * g], sR, torsoMat);
  if (app.fem) for (const sg of [-1, 1]) E(at(chestC, sR, [sg * 0.05, -0.03, 0.05]), [0.05 * g, 0.045 * s, 0.04 * g], sR, torsoMat, { k: 0.07 * s });
  E(at(J.neck, sR, [0, -0.04, -0.01]), [B.sh * 0.92, 0.055 * s, 0.085 * g], sR, torsoMat, { k: 0.05 * s });
  // Neck and trapezius.
  const headLocal = (p) => vadd(J.head, mApply(J.headR, vscale(p, hs)));
  const neckTopP = headLocal([0, -0.075, -0.018]);
  if (!opt.noHead) limb(at(J.neck, sR, [0, -0.02, -0.005]), neckTopP, (app.fem ? 0.044 : 0.05) * g, (app.fem ? 0.036 : 0.042) * hs, M.skin, { k: 0.025 * s });
  for (const sg of [-1, 1]) limb(at(J.neck, sR, [0, 0.0, -0.02]), at(J[sg > 0 ? 'shoulderL' : 'shoulderR'], sR, [0, 0.01, -0.01]), 0.036 * g, 0.034 * g, torsoMat, { k: 0.04 * s });

  // Arms: deltoid, upper arm, forearm, fist.
  const arms = {};
  for (const k of ['L', 'R']) {
    const sh = J[`shoulder${k}`];
    const el = J[`elbow${k}`];
    const wr = J[`wrist${k}`];
    const dl = app.fem || robe ? 0.046 : 0.052;
    E(sh, [dl * g, dl * 1.06 * g, dl * g], sR, armMat, { k: 0.03 * s });
    limb(sh, el, 0.047 * g, 0.036 * g, armMat, { k: 0.025 * s });
    E(vlerp(el, wr, 0.22), [0.04 * g, 0.06 * s, 0.038 * g], mAlongY(vsub(wr, el)), armMat, { k: 0.025 * s });
    limb(el, wr, 0.037 * g, 0.026 * g, armMat, { k: 0.02 * s });
    arms[k] = { sh, el, wr };
  }

  // Fists: a palm block, knuckles, curled fingers and a thumb around the grip.
  const fist = (k, m) => {
    const hd = J[`hand${k}`];
    const z = hd.size;
    const R = hd.R;
    const c = hd.c;
    const lp = (x, y, w) => vadd(c, mApply(R, [x * z, y * z, w * z]));
    sc.box(lp(-0.004, 0, -0.004), [0.026 * z, 0.04 * z, 0.021 * z], R, 0.014 * z, { mat: m, g: GR.body, k: 0.012 * s });
    for (let i = 0; i < 4; i++) {
      const yy = (-0.027 + i * 0.018) * (i === 3 ? 0.95 : 1);
      sc.ellipsoid(lp(0.024, yy, 0.004), [0.012 * z, 0.0095 * z, 0.016 * z], R, { mat: m, g: GR.body, k: 0.006 * s });
      sc.ellipsoid(lp(0.016, yy, 0.02), [0.011 * z, 0.0088 * z, 0.01 * z], R, { mat: m, g: GR.body, k: 0.006 * s });
    }
    sc.cone(lp(-0.012, 0.03, -0.018), lp(0.012, 0.038, 0.012), 0.0105 * z, 0.0085 * z, { mat: m, g: GR.body, k: 0.008 * s });
    // Wrist into the fist.
    sc.cone(J[`wrist${k}`], lp(-0.02, 0, -0.004), 0.025 * g, 0.023 * z, { mat: m, g: GR.body, k: 0.015 * s });
  };
  const handMat = plate ? M.steel : leatherBody || mailBody || scaleBody ? M.darkLeather : M.skin;
  fist('L', handMat);
  fist('R', handMat);

  // Legs.
  const legs = {};
  for (const k of ['L', 'R']) {
    const hip = J[`hip${k}`];
    const kn = J[`knee${k}`];
    const an = J[`ankle${k}`];
    limb(hip, kn, 0.083 * g, 0.054 * g, legMat, { k: 0.035 * s });
    E(vlerp(hip, kn, 0.3), [0.075 * g, 0.12 * s, 0.072 * g], mAlongY(vsub(kn, hip)), legMat, { k: 0.04 * s });
    limb(kn, an, 0.052 * g, 0.032 * g, legMat, { k: 0.025 * s });
    const calfR = mAlongY(vsub(an, kn), J.side);
    E(vadd(vlerp(kn, an, 0.28), mApply(calfR, [0, 0, -0.012 * g])), [0.048 * g, 0.1 * s, 0.05 * g], calfR, legMat, { k: 0.03 * s });
    legs[k] = { hip, kn, an };
  }

  // Feet and boots (halflings go barefoot on hairy feet).
  for (const k of ['L', 'R']) {
    const an = J[`ankle${k}`];
    const t = J[`toe${k}`];
    let footDir = t;
    if (asleep) footDir = vnorm(vadd(t, [0, -0.15, 0]));
    const fR = mAxes(vnorm(vcross([0, 1, 0], footDir)), [0, 1, 0], footDir);
    const fm = halfling ? M.skin : plate ? M.darkSteel : M.boots;
    sc.box(vadd(an, vadd(vscale(footDir, 0.055 * s), [0, -0.04 * s, 0])), [0.042 * g, 0.034 * s, 0.11 * s], fR, 0.03 * s, { mat: fm, g: GR.body, k: 0.03 * s });
    if (!halfling) {
      // Boot shaft over the lower shin.
      const kn = J[`knee${k}`];
      sc.cone(an, vlerp(an, kn, plate ? 0.85 : 0.62), 0.04 * g, 0.054 * g, { mat: fm, g: GR.armor, k: 0.01 * s });
      sc.ellipsoid(vadd(vlerp(an, kn, plate ? 0.85 : 0.62), [0, 0, 0]), [0.058 * g, 0.012 * s, 0.058 * g], mAlongY(vsub(kn, an)), { mat: fm, g: GR.armor, k: 0.006 * s });
    } else {
      sc.ellipsoid(vadd(an, vadd(vscale(footDir, 0.06 * s), [0, -0.005, 0])), [0.045 * g, 0.03 * s, 0.07 * s], fR, { mat: M.hair, g: GR.hair, k: 0.01 * s, disp: grooveDisp(an, 0.004 * s, 30) });
    }
  }

  const Hc = J.head;
  const HR = J.headR;
  // With opt.noHead the head, hair, beard and helm are drawn by the ray-marched head (headShader.js).
  if (!opt.noHead) {
    // ================================================================ HEAD
    const toL = (x, y, z) => {
      const px = x - Hc[0], py = y - Hc[1], pz = z - Hc[2];
      return [(HR[0] * px + HR[1] * py + HR[2] * pz) / hs, (HR[3] * px + HR[4] * py + HR[5] * pz) / hs, (HR[6] * px + HR[7] * py + HR[8] * pz) / hs];
    };
    const hE = (c, r, R, m, o = {}) => sc.ellipsoid(headLocal(c), vscale(r, hs), R ? mMul(HR, R) : HR, { mat: m, g: GR.body, k: 0.012 * hs, ...o });
    const hCone = (a, b, ra, rb, m, o = {}) => sc.cone(headLocal(a), headLocal(b), ra * hs, rb * hs, { mat: m, g: GR.body, k: 0.008 * hs, ...o });
    const hClip = (planes) => planes.map(([nx, ny, nz, d]) => {
      const n = mApply(HR, vnorm([nx, ny, nz]));
      const l = Math.hypot(nx, ny, nz);
      return [n[0], n[1], n[2], (d / l) * hs + vdot(n, Hc)];
    });
    const fw = fp.w;
    const fl = fp.long;
    const sk = M.skin;
    // Cranium and face masses.
    hE([0, 0.026, -0.014], [0.074 * fw, 0.094, 0.097], null, sk, { k: 0.02 * hs });
    hE([0, -0.024 * fl, 0.027], [0.053 * fw, 0.072 * fl, 0.066], null, sk, { k: 0.045 * hs });
    // Temples and zygomatic arches fill the seam between skull and face masses.
    for (const sg of [-1, 1]) hE([sg * 0.047 * fw, 0.006, 0.024], [0.017, 0.038, 0.042], null, sk, { k: 0.036 * hs });
    // Cheekbones (high on elves, round on halflings).
    const ckY = -0.006 + (fp.cheek - 1) * 0.012;
    for (const sg of [-1, 1]) hE([sg * 0.043 * fw, ckY, 0.058], [0.021 * fp.cheek ** 0.5, 0.016 * fp.cheek, 0.019], mEulerSafe(0, 0, sg * -0.3), sk, { k: 0.026 * hs });
    if (app.race === 'halfling') for (const sg of [-1, 1]) hE([sg * 0.04, -0.035, 0.06], [0.026, 0.022, 0.022], null, sk, { k: 0.02 * hs });
    // Jaw and chin.
    const jw = fp.jaw;
    // Jaw: a bony line from the angle below the ear to the chin.
    for (const sg of [-1, 1]) {
      hCone([sg * 0.046 * fw * (0.88 + 0.12 * jw), -0.045 * fl, -0.008], [sg * 0.03 * fw * jw, -0.087 * fl, 0.044], 0.0135 * (0.85 + 0.15 * jw), 0.012, sk, { k: 0.03 * hs });
      hCone([sg * 0.03 * fw * jw, -0.087 * fl, 0.044], [sg * 0.01, -0.099 * fl, 0.064], 0.012, 0.012 * fp.chin, sk, { k: 0.026 * hs });
    }
    // Gonial angles: the corners of the jaw (squarer on men and dwarves).
    if (!app.fem) for (const sg of [-1, 1]) hE([sg * 0.044 * fw * (0.9 + 0.1 * jw), -0.074 * fl, 0.006], [0.012 * jw, 0.013, 0.016], null, sk, { k: 0.022 * hs });
    hE([0, -0.096 * fl, 0.066 - (1 - fp.chin) * 0.01], [0.019 * fp.chin * (0.85 + 0.15 * jw), 0.016 * fp.chin, 0.018], null, sk, { k: 0.016 * hs });
    // Muzzle (between nose and chin).
    hE([0, -0.054 * fl, 0.06], [0.03 * fw, 0.03 * fl, 0.026], null, sk, { k: 0.028 * hs });
    // Cheeks either side of the mouth.
    for (const sg of [-1, 1]) hE([sg * 0.033 * fw, -0.032 * fl, 0.054], [0.014, 0.018, 0.015], null, sk, { k: 0.03 * hs });
    // Brow ridge — scowls pinch it down at the centre, weary eyes let the outer ends sag.
    const ex = 0.0305 * fp.sp * fw;
    const eyeY = 0.006;
    const browTilt = app.expr === 'scowl' ? 0.32 : app.expr === 'weary' ? -0.18 : app.expr === 'proud' ? -0.06 : app.expr === 'stern' ? 0.12 : 0;
    for (const sg of [-1, 1]) {
      hE([sg * ex * 0.95, 0.025 - (app.expr === 'scowl' ? 0.003 : 0), 0.0745], [0.027 * fw, 0.0085 * fp.brow, 0.0125 + 0.004 * (fp.brow - 1)], mEulerSafe(0, sg * -0.25, sg * browTilt), sk, { k: 0.012 * hs });
    }
    hE([0, 0.03, 0.08], [0.016, 0.012, 0.012], null, sk, { k: 0.014 * hs });
    // Eye sockets carved, eyeballs set in, lids over them.
    const er = 0.0112 * fp.eye ** 0.5;
    const lidDrop = fp.lid * 0.004;
    for (const sg of [-1, 1]) {
      sc.ellipsoid(headLocal([sg * ex, eyeY + 0.002, 0.0845]), vscale([0.0155 * fp.eye ** 0.5, 0.0102, 0.011], hs), HR, { mat: sk, g: GR.body, k: 0.012 * hs, sub: true });
      sc.sphere(headLocal([sg * ex, eyeY, 0.0712]), er * hs, { mat: M.eye, g: GR.eyes });
      if (!asleep) {
        // Upper lid (droops for weary faces), lower lid.
        // A soft upper-lid fold above the eyeball (the opening itself is painted).
        // Thin lids that hug the eyeball: an upper cap whose edge is the lash
        // line, and a narrow lower rim (no swollen fold above the eye).
        sc.sphere(headLocal([sg * ex, eyeY + 0.0004, 0.0716]), (er + 0.0018) * hs, { mat: sk, g: GR.body, k: 0.004 * hs, clip: hClip([[0, -1, 0.12 * sg * fp.slant, -(eyeY + 0.0042 - lidDrop)]]), clipK: 0.0015 * hs });
        sc.sphere(headLocal([sg * ex, eyeY, 0.0714]), (er + 0.001) * hs, { mat: sk, g: GR.body, k: 0.003 * hs, clip: hClip([[0, 1, 0, eyeY - 0.0056]]), clipK: 0.0012 * hs });
      } else {
        hE([sg * ex, eyeY - 0.0005, 0.0748], [0.0145, 0.0115, 0.0112], null, sk, { k: 0.004 * hs });
      }
    }
    // Nose: bridge, tip, wings.
    const nl = fp.nose;
    const tipY = -0.03 * nl;
    const tipZ = 0.106 + 0.012 * (nl - 1);
    hCone([0, 0.016, 0.086], [0, tipY + 0.004, tipZ - 0.004], 0.0068 * fp.bridge, 0.0098 * fp.tip, sk, { k: 0.008 * hs });
    hE([0, tipY, tipZ - 0.006], [0.0108 * fp.tip, 0.0098 * fp.tip, 0.0102 * fp.tip], null, sk, { k: 0.006 * hs });
    for (const sg of [-1, 1]) hE([sg * 0.0115 * fp.tip ** 0.6, tipY + 0.001, tipZ - 0.016], [0.0085 * fp.tip ** 0.7, 0.0068, 0.0085], null, sk, { k: 0.007 * hs });
    // Lips (corners lifted for smirks and kind faces).
    const mw = fp.mouth;
    const lipsK = fp.lips;
    const smirk = app.expr === 'smirk' ? 0.16 : 0;
    const mouthY = -0.062 * fl;
    hE([0, mouthY + 0.0046, 0.0812], [0.0195 * mw, 0.0046 * lipsK, 0.0075], mEulerSafe(0, 0, smirk * 0.6), M.lip, { k: 0.004 * hs });
    hE([0, mouthY - 0.0052, 0.0792], [0.0168 * mw, 0.0055 * lipsK, 0.0075], mEulerSafe(0, 0, smirk * 0.4), M.lip, { k: 0.004 * hs });
    if (app.expr === 'smirk') hE([0.022 * mw, mouthY + 0.004, 0.083], [0.007, 0.006, 0.006], null, sk, { k: 0.006 * hs });
    // Ears.
    for (const sg of [-1, 1]) {
      const ear = fp.ears;
      hE([sg * 0.072 * fw, 0.0, -0.01], [0.011, 0.029 * ear, 0.019 * ear], mEulerSafe(0, sg * 0.3, sg * 0.1), sk, { k: 0.008 * hs });
      if (app.race === 'elf' || app.race === 'halfElf') {
        const len = app.race === 'elf' ? 1 : 0.6;
        hCone([sg * 0.074 * fw, 0.012, -0.012], [sg * (0.088 + 0.012 * len) * fw, 0.03 + 0.03 * len, -0.03 - 0.012 * len], 0.011, 0.0025, sk, { k: 0.008 * hs });
      }
    }

    // ---- hair
    const hairOn = !app.helm || app.hair === 'long' || app.hair === 'braid';
    const hairG = { mat: M.hair, g: GR.body, k: 0.012 * hs };
    const grooveH = (amp, n, flow = 0) => (x, y, z) => {
      const l = toL(x, y, z);
      const th = Math.atan2(l[0], l[2] + 0.02 + flow * l[1]);
      // Irregular strand clumps: a warped ridge pattern plus broad lobes.
      const w = th * n + Math.sin(th * 2.3 + l[1] * 14) * 1.7 + l[1] * 7;
      const ridge = Math.abs(Math.sin(w));
      const lobe = Math.sin(th * n * 0.31 + l[1] * 17 + 1.3) * 0.5 + Math.sin(th * 4.7 - l[1] * 9) * 0.35;
      return amp * hs * (0.35 - ridge * 0.55 + lobe * 0.6);
    };
    const capClip = (front, side) => hClip([[0, -0.6, 0.8, front], [0, -1, 0.62, side]]);
    if (app.hood) {
      // Hood: a cloth shell around the head with the face left open, falling into a cowl.
      const hoodR = [0.1, 0.128, 0.122];
      const shell = sc.ellipsoid(headLocal([0, 0.024, -0.012]), vscale(hoodR, hs), HR, { mat: M.cloth, g: GR.cloak, k: 0, shell: 0.0065 * hs, disp: grooveH(0.0014, 7), amp: 0.002 * hs, clip: hClip([[0, -0.32, 1, 0.052]]), clipK: 0.004 * hs });
      void shell;
      sc.ellipsoid(headLocal([0, -0.022, 0.11]), vscale([0.077 * fw, 0.112, 0.1], hs), HR, { g: GR.cloak, sub: true, k: 0.012 * hs });
      sc.ellipsoid(headLocal([0, -0.03, -0.06]), vscale([0.11, 0.09, 0.09], hs), HR, { g: GR.cloak, sub: true, k: 0.01 * hs });
    } else if (hairOn && app.hair !== 'bald') {
      const style = app.hair;
      const tight = style === 'crop' || (style === 'short' && !app.fem);
      const r = tight ? [0.0795, 0.1005, 0.103] : [0.083, 0.104, 0.107];
      const sideClip = style === 'bob' ? 0.05 : style === 'long' || style === 'wavy' || style === 'braid' ? 0.016 : -0.012;
      const front = style === 'swept' ? 0.022 : style === 'crop' ? 0.01 : style === 'long' || style === 'wavy' || style === 'bob' ? 0.018 : 0.014;
      // The hair is an offset of the skull whose thickness tapers to nothing at
      // a natural hairline (receding at the temples), so it grows out of the
      // scalp instead of sitting on it like a cap.
      const T = (tight ? 0.0082 : style === 'swept' || style === 'long' || style === 'wavy' ? 0.0125 : 0.0105) * hs;
      const cran = sdEllipsoid(headLocal([0, 0.026, -0.014]), vscale([0.074 * fw, 0.094, 0.097], hs), HR);
      const fr0 = front;
      const sd0 = sideClip;
      const groove = (x, y, z) => { const l = toL(x, y, z); const th = Math.atan2(l[0], l[2] + 0.02); return 0.0016 * hs * (Math.sin(th * 3.2 + l[1] * 21 + 0.7) * 0.6 + Math.sin(th * 7.3 - l[1] * 13) * 0.4); };
      sc.custom((x, y, z) => {
        const l = toL(x, y, z);
        // Irregular, tufted hairline; sideburns in front of the ears.
        const tuft = 0.0022 * Math.sin(l[0] * 95 + 1.3) + 0.0012 * Math.sin(l[0] * 210 + l[1] * 40);
        const hlF = (fr0 + tuft - 2.6 * l[0] * l[0]) - (-0.6 * l[1] + 0.8 * l[2]);
        const burn = Math.max(0, 1 - Math.abs(Math.abs(l[0]) - 0.07) / 0.012) * Math.max(0, 1 - Math.abs(l[2] - 0.022) / 0.016) * 0.045;
        const hlS = (sd0 + burn + tuft * 0.6 - (-l[1] + 0.62 * l[2])) / 1.177;
        const hl = Math.min(hlF, hlS);
        const t = Math.max(0, Math.min(1, hl / 0.03));
        const top = Math.max(0, Math.min(1, l[1] / 0.1));
        const th = t * t * (3 - 2 * t) * (style === 'swept' ? 0.8 + 0.9 * top * Math.max(0, Math.min(1, (l[2] + 0.06) / 0.1)) : 0.75 + 0.45 * top);
        // Where the hair thins to nothing it sinks just under the scalp, so the
        // skin (not a hair-tinted blend) shows below the hairline.
        return cran(x, y, z) - T * th + groove(x, y, z) * th + 0.0022 * hs * Math.max(0, 1 - th * 5);
      }, bbOf(headLocal([0, 0.026, -0.014]), 0.13 * hs), { ...hairG, k: 0.006 * hs });
      void r; void capClip;
      if (style === 'short' && app.fem) hE([0, 0.0, -0.05], [0.082, 0.07, 0.07], null, M.hair, { k: 0.02 * hs, disp: grooveH(0.002, 18), amp: 0.003 * hs });
      if (style === 'long' || style === 'wavy') {
        const len = app.fem ? 0.27 : 0.2;
        const wav = style === 'wavy' ? 1 : 0;
        // A mantle of hair down the back, parted over the shoulders.
        sc.custom((x, y, z) => {
          const l = toL(x, y, z);
          const t = Math.min(1, Math.max(0, (0.02 - l[1]) / len));
          const w = (0.084 + t * 0.03) * fw + wav * 0.006 * Math.sin(l[1] * 60);
          const cz = -0.04 - t * 0.045;
          const ex2 = Math.hypot(l[0] / w, (l[2] - cz) / (0.07 + t * 0.01)) - 1;
          let d = ex2 * 0.07;
          d = Math.max(d, l[1] - 0.04, -(l[1] + 0.02 + len), l[2] - 0.035 + Math.max(0, -l[1] - 0.02) * 0.4);
          const th = Math.atan2(l[0], l[2] + 0.03);
          d += 0.0012 * (0.5 - Math.abs(Math.sin(th * 13 + Math.sin(l[1] * (30 + wav * 40)) * (0.8 + wav) + Math.sin(th * 3.7) * 1.2))) + 0.0022 * Math.sin(th * 5 + l[1] * 13);
          return d * hs;
        }, bbOf(headLocal([0, -0.1, -0.05]), 0.32 * hs), { ...hairG, k: 0.018 * hs });
        // Side locks framing the face.
        for (const sg of [-1, 1]) hCone([sg * 0.075 * fw, 0.04, 0.012], [sg * (0.086 + wav * 0.01) * fw, -0.1, -0.03], 0.014, 0.009, M.hair, { k: 0.016 * hs, disp: grooveH(0.0012, 12), amp: 0.002 * hs });
      }
      if (style === 'bob') {
        sc.custom((x, y, z) => {
          const l = toL(x, y, z);
          const ex2 = Math.hypot(l[0] / (0.088 * fw), (l[1] - 0.02) / 0.115, (l[2] + 0.012) / 0.11) - 1;
          let d = ex2 * 0.08;
          d = Math.max(d, -(l[1] + 0.072), -0.6 * l[1] + 0.8 * l[2] - 0.045);
          const th = Math.atan2(l[0], l[2]);
          d += 0.002 * (0.55 - Math.abs(Math.sin(th * 22 + l[1] * 10)));
          return d * hs;
        }, bbOf(headLocal([0, 0.0, -0.01]), 0.16 * hs), { ...hairG });
      }
      if (style === 'braid') {
        // A thick plait drawn forward over the left shoulder (it frames the face).
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          const x = (0.072 + 0.03 * t) * fw;
          const y = -0.02 - t * 0.3;
          const z = -0.01 + 0.075 * Math.min(1, t * 1.6);
          hE([x + Math.sin(i * 1.9) * 0.004, y, z], [0.02 - t * 0.006, 0.021, 0.018 - t * 0.004], mEulerSafe(0.1, 0, (i % 2 ? 1 : -1) * 0.5), M.hair, { k: 0.006 * hs });
        }
        hE([0.1 * fw, -0.335, 0.07], [0.008, 0.012, 0.008], null, M.leather, { k: 0.003 * hs });
        hE([0, -0.03, -0.08], [0.06, 0.06, 0.045], null, M.hair, { k: 0.02 * hs, disp: grooveH(0.002, 20), amp: 0.003 * hs });
      }
      if (style === 'bun') {
        // A high crown bun, visible above the head.
        hE([0, 0.132, -0.068], [0.04, 0.034, 0.038], null, M.hair, { k: 0.015 * hs, disp: grooveH(0.002, 14), amp: 0.003 * hs });
        hE([0, 0.0, -0.075], [0.078, 0.06, 0.05], null, M.hair, { k: 0.02 * hs, disp: grooveH(0.002, 20), amp: 0.003 * hs });
      }
      if (style === 'topknot') {
        hE([0, 0.13, -0.035], [0.024, 0.026, 0.024], null, M.hair, { k: 0.012 * hs });
        hCone([0, 0.135, -0.05], [0, 0.06, -0.135], 0.016, 0.006, M.hair, { k: 0.01 * hs, disp: grooveH(0.0015, 14), amp: 0.002 * hs });
      }
    } else if (app.hair === 'bald' && !app.helm) {
      // A fringe of hair around the back and sides.
      sc.ellipsoid(headLocal([0, 0.0, -0.02]), vscale([0.081 * fw, 0.06, 0.104], hs), HR, { ...hairG, clip: hClip([[0, 1, 0, 0.03], [0, -1, 0, 0.01], [0, -0.3, 1, 0.04]]), disp: grooveH(0.0018, 22), amp: 0.002 * hs });
    }

    // ---- beard
    const beard = app.beard;
    const bClip = hClip([[0, 1, 0.42, -0.012]]);
    if (beard === 'full' || beard === 'long') {
      const dwarf = app.race === 'dwarf';
      hE([0, -0.074 * fl, 0.04], [(app.race === 'dwarf' ? 0.076 : 0.069) * fw * jw ** 0.4, 0.064, 0.062], null, M.hair, { k: 0.012 * hs, clip: bClip, clipK: 0.01 * hs, disp: grooveH(0.0018, 14), amp: 0.003 * hs });
      if (beard === 'long' || dwarf) {
        // A broad lower mass falling onto the chest (forked for dwarves).
        hE([0, -0.15, 0.058], [dwarf ? 0.066 : 0.048, dwarf ? 0.075 : 0.07, dwarf ? 0.045 : 0.034], mEulerSafe(-0.2, 0, 0), M.hair, { k: 0.03 * hs, disp: grooveH(0.0018, 12), amp: 0.003 * hs });
        if (dwarf) for (const sg of [-1, 1]) hCone([sg * 0.022, -0.17, 0.065], [sg * 0.028, -0.26, 0.072], 0.03, 0.012, M.hair, { k: 0.025 * hs, disp: grooveH(0.0016, 12), amp: 0.003 * hs });
        else hCone([0, -0.18, 0.06], [0, -0.25, 0.07], 0.03, 0.01, M.hair, { k: 0.03 * hs, disp: grooveH(0.0016, 12), amp: 0.003 * hs });
      }
      // Moustache over the upper lip.
      for (const sg of [-1, 1]) hCone([sg * 0.006, mouthY + 0.014, 0.1], [sg * 0.03, mouthY - 0.004, 0.088], 0.0085, 0.006, M.hair, { k: 0.006 * hs });
    } else if (beard === 'goatee') {
      hE([0, -0.1 * fl, 0.064], [0.027, 0.03, 0.026], null, M.hair, { k: 0.012 * hs, disp: grooveH(0.0012, 12), amp: 0.002 * hs });
      hCone([0, -0.118, 0.07], [0, -0.155, 0.074], 0.018, 0.008, M.hair, { k: 0.014 * hs, disp: grooveH(0.001, 12), amp: 0.0015 * hs });
      for (const sg of [-1, 1]) hCone([sg * 0.006, mouthY + 0.014, 0.1], [sg * 0.028, mouthY - 0.012, 0.087], 0.0075, 0.005, M.hair, { k: 0.006 * hs });
    } else if (beard === 'moustache') {
      for (const sg of [-1, 1]) hCone([sg * 0.006, mouthY + 0.014, 0.1], [sg * 0.034, mouthY - 0.016, 0.086], 0.009, 0.0045, M.hair, { k: 0.006 * hs });
    }

    // ---- helm
    if (app.helm) {
      const hg = { mat: M.steel, g: GR.plate, k: 0 };
      sc.ellipsoid(headLocal([0, 0.034, -0.013]), vscale([0.088 * fw, 0.108, 0.111], hs), HR, { ...hg, clip: hClip([[0, -1, 0.214, 0.0064]]) });
      // Brow band, nasal, crest.
      sc.ellipsoid(headLocal([0, 0.018, -0.013]), vscale([0.091 * fw, 0.112, 0.115], hs), HR, { ...hg, mat: M.darkSteel, clip: hClip([[0, -1, 0.214, 0.0064], [0, 1, -0.214, 0.0064 + 0.014]]) });
      sc.box(headLocal([0, 0.0, 0.108]), vscale([0.0065, 0.024, 0.005], hs), mMul(HR, mRotX(-0.36)), 0.003 * hs, hg);
      sc.box(headLocal([0, 0.125, -0.01]), vscale([0.006, 0.012, 0.09], hs), HR, 0.004 * hs, { ...hg, mat: M.gilt });
      // Mail aventail over the neck.
      sc.custom((x, y, z) => {
        const l = toL(x, y, z);
        const d = Math.hypot(l[0] / (0.094 * fw), (l[2] + 0.015) / 0.112) - 1;
        return Math.max(d * 0.09, l[1] - 0.0, -(l[1] + 0.105), -0.6 * l[1] + 0.8 * l[2] - 0.035) * hs - 0.0;
      }, bbOf(headLocal([0, -0.05, -0.01]), 0.15 * hs), { mat: M.mail, g: GR.armor, k: 0.01 * hs });
    }
  }

  // ================================================================ GARMENTS & ARMOUR
  const A = (c, r, R, m, o = {}) => sc.ellipsoid(c, r, R, { mat: m, g: GR.armor, k: 0.02 * s, ...o });
  const AC = (a, b, ra, rb, m, o = {}) => sc.cone(a, b, ra, rb, { mat: m, g: GR.armor, k: 0.018 * s, ...o });
  const PL = (c, r, R, o = {}) => sc.ellipsoid(c, r, R, { mat: M.steel, g: GR.plate, k: 0, ...o });
  const torsoShell = (m, grow, o = {}) => {
    A(at(J.pelvis, pR, [0, 0.0, -0.012]), [0.145 * g * hipW + grow, 0.105 * s + grow * 0.5, 0.1 * g + grow], pR, m, o);
    A(vlerp(J.pelvis, J.neck, 0.36), [0.132 * g + grow, 0.13 * s, 0.09 * g + grow], sR, m, o);
    A(chestC, [(app.fem ? 0.138 : 0.158) * g + grow, 0.15 * s, (app.fem ? 0.098 : 0.108) * g + grow], sR, m, o);
    if (app.fem && (mailBody || scaleBody || plate)) for (const sg of [-1, 1]) A(at(chestC, sR, [sg * 0.05, -0.025, 0.055]), [0.055 * g + grow, 0.05 * s + grow, 0.045 * g + grow], sR, m, { k: 0.07 * s, ...o });
    A(at(J.neck, sR, [0, -0.04, -0.01]), [B.sh * 0.92 + grow, 0.055 * s + grow, 0.085 * g + grow], sR, m, { k: 0.04 * s, ...o });
  };
  const sleeves = (m, grow, toFore = 0) => {
    for (const k of ['L', 'R']) {
      const { sh, el, wr } = arms[k];
      A(sh, [0.056 * g + grow, 0.06 * g + grow, 0.056 * g + grow], sR, m, { k: 0.025 * s });
      AC(sh, el, 0.047 * g + grow, 0.036 * g + grow, m);
      if (toFore) AC(el, vlerp(el, wr, toFore), 0.037 * g + grow, (0.037 - 0.011 * toFore) * g + grow, m);
    }
  };
  const waistY = (t) => vlerp(J.pelvis, J.neck, t);
  const skirt = (m, len, flare, o = {}) => {
    // Standing: a flared cone from the waist; sitting: draped over the thighs.
    if (!sitting) {
      const top = at(J.pelvis, pR, [0, 0.02, -0.005]);
      const dn = vscale(mApply(pR, [0, -1, 0]), len);
      AC(top, vadd(top, dn), 0.15 * g * hipW, (0.15 * hipW + flare) * g, m, { k: 0.02 * s, ...o });
    } else {
      for (const k of ['L', 'R']) {
        const { hip, kn } = legs[k];
        AC(hip, vlerp(hip, kn, Math.min(1, len / B.thigh)), 0.1 * g, 0.085 * g, m, { k: 0.06 * s, ...o });
      }
    }
  };

  // A hauberk's skirt split front and back: a short ring at the hips and a flap down each thigh to
  // the knee, so the legs read through it (no 'nappy' cone over the pelvis).
  const splitSkirt = (m, len, o = {}) => {
    skirt(m, 0.16 * s, 0.035, o);
    for (const k of ['L', 'R']) {
      const { hip, kn } = legs[k];
      const sg = k === 'L' ? 1 : -1;
      const top = vadd(hip, mApply(pR, [sg * 0.02 * s, 0.04 * s, 0]));
      const along = vlerp(hip, kn, Math.min(1, len / B.thigh));
      const hang = sitting ? along : vlerp(along, vadd(top, mApply(pR, [sg * 0.012 * s, -len, 0])), 0.6);
      AC(top, hang, 0.09 * g, (sitting ? 0.088 : 0.104) * g, m, { k: 0.06 * s, ...o });
    }
  };
  if (mailBody || scaleBody) {
    const m = scaleBody ? M.scale : M.mail;
    torsoShell(m, 0.012 * s);
    sleeves(m, 0.011 * s, 0.35);
    splitSkirt(m, (scaleBody ? 0.36 : 0.42) * s);
    if (body === 'chain' && !sitting) {
      // A short surcoat skirt in the house colour over the mail, open at the sides: it hangs over the
      // thighs and breaks the line of the legs.
      for (const sg of [1, -1]) {
        const c = at(J.pelvis, pR, [0, -0.13, sg * 0.165]);
        sc.box(c, [0.125 * g, 0.2 * s, 0.007 * s], mMul(pR, mRotX(sg * -0.16)), 0.005 * s, { mat: M.cloth, g: GR.cloak, k: 0, disp: (x, y, z) => 0.003 * s * Math.sin(x * 90 + y * 8), amp: 0.004 * s });
      }
    }
    if (body === 'tabard') {
      // Surcoat panels front and back in the house colour, hanging to the knee and breaking the legs' line.
      for (const sg of [1, -1]) {
        const c = at(J.pelvis, sR, [0, sitting ? 0.04 : -0.06, sg * 0.13]);
        sc.box(c, [0.115 * g, (sitting ? 0.2 : 0.36) * s, 0.008 * s], mMul(sR, mRotX(sg * -0.06)), 0.006 * s, { mat: M.cloth, g: GR.cloak, k: 0 });
      }
      sc.ellipsoid(at(chestC, sR, [0, 0.02, 0.131]), [0.04 * s, 0.045 * s, 0.006 * s], sR, { mat: M.gilt, g: GR.belt });
    }
  } else if (plate) {
    torsoShell(M.mail, 0.008 * s);
    sleeves(M.mail, 0.008 * s, 0.2);
    splitSkirt(M.mail, 0.3 * s);
    // Breastplate with a central ridge, backplate.
    const bp = at(chestC, sR, [0, -0.02, 0.006]);
    PL(bp, [0.172 * g, 0.19 * s, 0.122 * g], sR, { clip: [planeAlong(sR, [0, -1, 0], at(J.pelvis, sR, [0, 0.11, 0])), planeAlong(sR, [0, 1, 0], at(J.neck, sR, [0, -0.045, 0]))], clipK: 0.006 * s });
    sc.ellipsoid(bp, [0.176 * g, 0.19 * s, 0.126 * g], sR, { mat: M.gilt, g: GR.plate, clip: [planeAlong(sR, [0, 1, 0], at(J.neck, sR, [0, -0.045, 0])), planeAlong(sR, [0, -1, 0], at(J.neck, sR, [0, -0.06, 0]))] });
    PL(at(bp, sR, [0, 0.0, 0.03]), [0.025 * s, 0.17 * s, 0.11 * g], sR, { clip: [planeAlong(sR, [0, -1, 0], at(J.pelvis, sR, [0, 0.12, 0]))], mat: M.steel });
    // Faulds: hooped lames over the hips.
    for (let i = 0; i < 3; i++) {
      const c = at(J.pelvis, pR, [0, 0.08 - i * 0.042, 0.0]);
      PL(c, [(0.165 + i * 0.008) * g * hipW, 0.04 * s, (0.13 + i * 0.006) * g], pR, { clip: [planeAlong(pR, [0, 1, 0], at(c, pR, [0, 0.02, 0])), planeAlong(pR, [0, -1, 0], at(c, pR, [0, -0.022, 0]))] });
    }
    // Pauldrons (three lames), couters, vambraces, gauntlet cuffs.
    for (const k of ['L', 'R']) {
      const sg = k === 'L' ? 1 : -1;
      const { sh, el, wr } = arms[k];
      for (let i = 0; i < 3; i++) {
        const Rl = mMul(sR, mEulerSafe(0, 0, sg * (0.42 + i * 0.22)));
        const c = vadd(sh, mApply(sR, [sg * (0.006 + i * 0.016) * s, (0.012 - i * 0.03) * s, 0]));
        PL(c, [(0.074 - i * 0.008) * g, 0.052 * g, (0.07 - i * 0.006) * g], Rl, { clip: [planeAlong(Rl, [0, -1, 0], vadd(c, mApply(Rl, [0, 0.006 * s, 0])))], clipK: 0.004 * s });
      }
      PL(el, [0.05 * g, 0.05 * g, 0.05 * g], sR, {});
      AC(vlerp(el, wr, 0.15), vlerp(el, wr, 0.92), 0.042 * g, 0.034 * g, M.steel, { g: GR.plate, k: 0 });
      AC(vlerp(sh, el, 0.25), vlerp(sh, el, 0.9), 0.052 * g, 0.044 * g, M.steel, { g: GR.plate, k: 0 });
      // Legs: cuisses, poleyns, greaves.
      const { hip, kn, an } = legs[k];
      AC(vlerp(hip, kn, 0.3), vlerp(hip, kn, 0.95), 0.084 * g, 0.062 * g, M.steel, { g: GR.plate, k: 0 });
      // Poleyn: a shallow cop over the knee with a side wing, not a ball.
      const kR = mAlongY(vsub(an, kn), J.side);
      PL(vadd(kn, mApply(kR, [0, 0, 0.022 * s])), [0.052 * g, 0.048 * g, 0.03 * g], kR, {});
      PL(vadd(kn, mApply(kR, [sg * 0.03 * s, 0, 0.01 * s])), [0.012 * g, 0.04 * g, 0.034 * g], kR, {});
      AC(vlerp(kn, an, 0.1), vlerp(kn, an, 0.9), 0.06 * g, 0.042 * g, M.steel, { g: GR.plate, k: 0 });
    }
    // Gorget.
    PL(at(J.neck, sR, [0, 0.005, 0.0]), [0.085 * g, 0.03 * s, 0.075 * g], sR, {});
  } else if (leatherBody) {
    const pcL = J.pelvis;
    torsoShell(M.leather, 0.012 * s, { k: 0.02 * s, disp: (x, y, z) => { const a = Math.atan2(x - pcL[0], z - pcL[2]); return 0.0022 * s * Math.max(0, 1 - Math.abs(Math.sin(a * 3)) * 12); }, amp: 0.003 * s });
    // A baldric across the chest (right shoulder to left hip) with a buckle.
    {
      const a = at(J.neck, sR, [-0.11, -0.03, 0.0]);
      const b2 = at(J.pelvis, pR, [0.12, 0.06, 0.0]);
      const mid = vlerp(a, b2, 0.5);
      const dir = vsub(a, b2);
      const Rb = mAlongY(dir, J.fwd);
      const torsoE = sdEllipsoid(at(vlerp(J.pelvis, J.neck, 0.55), sR, [0, 0, 0.004]), [0.168 * g + 0.016 * s, 0.3 * s, 0.122 * g + 0.016 * s], sR);
      const half = vlen(dir) / 2;
      sc.custom((x, y, z) => {
        const px = x - mid[0], py = y - mid[1], pz = z - mid[2];
        const lx = Rb[0] * px + Rb[1] * py + Rb[2] * pz;
        const ly = Rb[3] * px + Rb[4] * py + Rb[5] * pz;
        return Math.max(Math.abs(torsoE(x, y, z)) - 0.005 * s, Math.abs(lx) - 0.022 * s, Math.abs(ly) - half);
      }, [mid[0] - 0.35, mid[1] - 0.4, mid[2] - 0.35, mid[0] + 0.35, mid[1] + 0.4, mid[2] + 0.35], { mat: M.darkLeather, g: GR.belt, k: 0 });
    }
    // Linen shirt at the open collar, laced front, stitched seams.
    sc.torus(at(J.neck, sR, [0, -0.005, 0.0]), 0.06 * g, 0.016 * s, sR, { mat: M.linen, g: GR.belt, k: 0 });
    for (let i = 0; i < 4; i++) sc.torus(at(chestC, sR, [0, 0.12 - i * 0.03, 0.112 * g / s + 0.016]), 0.016 * s, 0.0028 * s, mMul(sR, mRotX(Math.PI / 2)), { mat: M.darkLeather, g: GR.belt, k: 0 });
    sleeves(M.cloth, 0.004 * s, 0.7);
    splitSkirt(M.cloth, 0.3 * s);
    skirt(M.leather, 0.13 * s, 0.045, { k: 0.01 * s });
    for (const k of ['L', 'R']) {
      const sg = k === 'L' ? 1 : -1;
      const { sh, el, wr } = arms[k];
      A(vadd(sh, mApply(sR, [sg * 0.01 * s, 0.015 * s, 0])), [0.07 * g, 0.045 * g, 0.068 * g], mMul(sR, mEulerSafe(0, 0, sg * 0.35)), M.leather, { k: 0.01 * s, clip: [planeAlong(sR, [0, -1, 0], vadd(sh, mApply(sR, [0, -0.02 * s, 0])))] });
      AC(vlerp(el, wr, 0.35), vlerp(el, wr, 0.95), 0.036 * g, 0.03 * g, M.darkLeather, { k: 0.008 * s });
    }
    if (body === 'fur') {
      // A fur mantle across the shoulders.
      const c = at(J.neck, sR, [0, -0.02, -0.01]);
      sc.torus(c, B.sh * 0.68, 0.06 * g, sR, { mat: M.fur, g: GR.cloak, k: 0, disp: furDisp(0.006 * s), amp: 0.008 * s });
    }
  } else if (robe) {
    const m = body === 'vestments' ? M.linen : M.cloth;
    const pc = J.pelvis;
    torsoShell(m, 0.01 * s, { disp: (x, y, z) => 0.0028 * s * Math.sin(Math.atan2(x - pc[0], z - pc[2]) * 9 + y * 18), amp: 0.003 * s });
    // Collar and a trimmed front opening.
    sc.torus(at(J.neck, sR, [0, -0.012, 0.0]), 0.068 * g, 0.018 * s, sR, { mat: body === 'vestments' ? M.gilt : M.trim, g: GR.belt, k: 0 });
    sc.box(at(chestC, sR, [0, 0.0, 0.112 * g / s + 0.014]), [0.018 * s, 0.17 * s, 0.006 * s], mMul(sR, mRotX(-0.08)), 0.004 * s, { mat: body === 'vestments' ? M.gilt : M.trim, g: GR.belt, k: 0 });
    // A short shoulder cape (mozzetta) over the robe, closed at the throat.
    {
      const cc = at(J.neck, sR, [0, -0.2, -0.012]);
      const capR = [B.sh * 1.62 + 0.03 * s, 0.235 * s, 0.18 * g];
      const pcC = J.neck;
      sc.ellipsoid(cc, capR, sR, {
        mat: body === 'vestments' ? M.cloth : M.trim, g: GR.cloak, k: 0, shell: 0.0075 * s,
        clip: [planeAlong(sR, [0, -1, 0], at(J.neck, sR, [0, -0.19, 0])), planeAlong(sR, [0, 1, 0], at(J.neck, sR, [0, 0.0, 0]))],
        disp: (x, y, z) => 0.006 * s * Math.sin(Math.atan2(x - pcC[0], z - pcC[2]) * 11) * Math.max(0, Math.min(1, (pcC[1] - y) / (0.15 * s))), amp: 0.007 * s,
      });
    }
    // A cowl bunched at the nape.
    if (!app.hood) sc.ellipsoid(at(J.neck, sR, [0, 0.0, -0.08]), [0.11 * g, 0.05 * s, 0.05 * s], sR, { mat: m, g: GR.cloak, k: 0, disp: (x, y, z) => 0.004 * s * Math.sin(x * 120 + y * 40), amp: 0.005 * s });
    // Bell sleeves.
    for (const k of ['L', 'R']) {
      const { sh, el, wr } = arms[k];
      AC(sh, el, 0.05 * g, 0.046 * g, m);
      AC(el, vlerp(el, wr, 0.85), 0.05 * g, 0.065 * g, m, { k: 0.015 * s });
    }
    // Long skirt with folds (standing) or draped over the knees (sitting).
    if (!sitting && !asleep) {
      const top = at(J.pelvis, pR, [0, 0.03, -0.005]);
      const len = top[1] - 0.012;
      sc.custom(robeSkirt(top, pR, len, 0.155 * g * hipW, 0.27 * g, 0.012 * s), [top[0] - 0.4 * s, 0, top[2] - 0.4 * s, top[0] + 0.4 * s, top[1] + 0.02, top[2] + 0.4 * s], { mat: m, g: GR.armor, k: 0.02 * s });
    } else if (sitting) {
      skirt(m, B.thigh * 0.98, 0, { k: 0.08 * s });
      for (const k of ['L', 'R']) AC(legs[k].kn, vadd(legs[k].an, [0, -0.02 * s, 0]), 0.075 * g, 0.1 * g, m, { k: 0.08 * s });
    } else {
      const top = at(J.pelvis, pR, [0, 0.03, -0.005]);
      AC(top, vadd(legs.L.an, vscale(vsub(legs.R.an, legs.L.an), 0.5)), 0.155 * g, 0.16 * g, m, { k: 0.05 * s });
    }
    if (body === 'vestments') {
      // Stole and a gilt-edged hem.
      for (const sg of [-1, 1]) {
        const a = at(J.neck, sR, [sg * 0.06, -0.01, 0.07]);
        const b2 = at(J.pelvis, pR, [sg * 0.07, sitting ? 0 : -0.3, 0.13]);
        sc.box(vlerp(a, b2, 0.5), [0.026 * s, vlen(vsub(b2, a)) / 2, 0.006 * s], mAlongY(vsub(a, b2), J.side), 0.004 * s, { mat: M.cloth, g: GR.cloak, k: 0 });
      }
    }
  } else if (tunic) {
    // A loose tunic with folds and a dark collar over a linen shirt.
    const pcT = J.pelvis;
    // A quilted gambeson: stitched horizontal channels over loose folds (never a skin-tight suit).
    torsoShell(M.cloth, 0.036 * s, { disp: (x, y, z) => {
      const fold = 0.004 * s * Math.sin(Math.atan2(x - pcT[0], z - pcT[2]) * 7 + y * 12) * (0.6 + 0.4 * Math.sin(y * 31 + x * 17));
      const ch = (y / (0.034 * s)) % 1;
      const quilt = -0.0035 * s * Math.max(0, 1 - Math.abs(ch - 0.5) * 9);
      return fold + quilt;
    }, amp: 0.008 * s });
    sc.torus(at(J.neck, sR, [0, -0.01, 0.0]), 0.064 * g, 0.016 * s, sR, { mat: M.clothDark, g: GR.belt, k: 0 });
    sc.box(at(chestC, sR, [0, 0.09, 0.118 * g / s + 0.012]), [0.02 * s, 0.06 * s, 0.006 * s], mMul(sR, mRotX(-0.12)), 0.004 * s, { mat: M.linen, g: GR.belt, k: 0 });
    sleeves(M.clothDark, 0.006 * s, 0.75);
    splitSkirt(M.cloth, 0.38 * s, { disp: (x, y, z) => 0.003 * s * Math.sin(Math.atan2(x - pcT[0], z - pcT[2]) * 10 + y * 6), amp: 0.004 * s });
    if (sitting) for (const k of ['L', 'R']) AC(legs[k].hip, vlerp(legs[k].hip, legs[k].kn, 0.85), 0.135 * g, 0.12 * g, M.cloth, { k: 0.08 * s });
    // A loose blouse over the belt (bloused tunic): the waist reads as cloth, not skin.
    A(vlerp(J.pelvis, J.neck, 0.3), [0.15 * g + 0.03 * s, 0.09 * s, 0.11 * g + 0.03 * s], sR, M.cloth, { k: 0.04 * s });
    // A short travelling capelet in the trim colour over the shoulders: breaks the line of the torso.
    {
      const cc = at(J.neck, sR, [0, -0.17, -0.012]);
      const pcC = J.neck;
      sc.ellipsoid(cc, [B.sh * 1.55 + 0.03 * s, 0.2 * s, 0.17 * g + 0.02 * s], sR, {
        mat: M.trim, g: GR.cloak, k: 0, shell: 0.008 * s,
        clip: [planeAlong(sR, [0, -1, 0], at(J.neck, sR, [0, -0.17, 0])), planeAlong(sR, [0, 1, 0], at(J.neck, sR, [0, 0.0, 0]))],
        disp: (x, y, z) => 0.007 * s * Math.sin(Math.atan2(x - pcC[0], z - pcC[2]) * 9) * Math.max(0, Math.min(1, (pcC[1] - y) / (0.12 * s))), amp: 0.008 * s,
      });
    }
  }

  // Belt with buckle and pouch (a rope cord for robes).
  {
    const bc = at(J.pelvis, pR, [0, 0.06, -0.004]);
    const grow = plate ? 0.03 : mailBody || scaleBody ? 0.02 : 0.014;
    const bm = robe ? M.rope : M.darkLeather;
    sc.ellipsoid(bc, [0.142 * g * hipW + grow * s, 0.1 * s, 0.105 * g + grow * s], pR, {
      mat: bm, g: GR.belt, k: 0,
      clip: [planeAlong(pR, [0, 1, 0], at(bc, pR, [0, robe ? 0.008 : 0.016, 0])), planeAlong(pR, [0, -1, 0], at(bc, pR, [0, robe ? -0.008 : -0.016, 0]))],
    });
    if (!robe) sc.box(at(bc, pR, [0, 0, 0.113 * g / s + grow + 0.004]), [0.022 * s, 0.02 * s, 0.006 * s], pR, 0.003 * s, { mat: M.gilt, g: GR.belt });
    sc.box(at(bc, pR, [-0.11 * g / s, -0.05, 0.07 * g / s]), [0.03 * s, 0.038 * s, 0.018 * s], mMul(pR, mEulerSafe(0, 0.6, 0)), 0.012 * s, { mat: M.leather, g: GR.belt, k: 0 });
    if (app.caster) sc.box(at(bc, pR, [0.13 * g / s, -0.06, 0.03]), [0.018 * s, 0.06 * s, 0.05 * s], mMul(pR, mEulerSafe(0, -0.4, 0.08)), 0.006 * s, { mat: M.book, g: GR.belt, k: 0 });
    if (app.cleric) sc.torus(at(J.neck, sR, [0, -0.11, 0.115 * g / s + 0.01]), 0.014 * s, 0.0035 * s, mMul(sR, mRotX(Math.PI / 2)), { mat: M.gilt, g: GR.belt });
  }

  // Cloak from the shoulders (or a collar for robed casters).
  if (app.cloak && !app.hood) {
    const top = at(J.neck, sR, [0, -0.015, -0.01]);
    const len = sitting ? top[1] - 0.005 : asleep ? 0.0 : Math.min(top[1] - 0.06 * s, 1.05 * s);
    if (len > 0.1) {
      sc.custom(cloakFn(top, sR, len, B.sh * 1.22 + 0.02 * s, 0.12 * s, 0.009 * s, sitting), [top[0] - 0.5 * s, 0, top[2] - 0.6 * s, top[0] + 0.5 * s, top[1] + 0.06 * s, top[2] + 0.3 * s], { mat: M.cloth, g: GR.cloak, k: 0 });
      sc.torus(top, 0.072 * g, 0.022 * s, sR, { mat: M.cloth, g: GR.cloak, k: 0 });
      for (const sg of [-1, 1]) sc.sphere(at(J.neck, sR, [sg * 0.07, -0.02, 0.08 * g / s]), 0.013 * s, { mat: M.gilt, g: GR.belt });
    }
  } else if (app.hood) {
    // The hood's cowl over the shoulders.
    const top = at(J.neck, sR, [0, 0.0, -0.01]);
    sc.custom(cloakFn(top, sR, Math.min(top[1] - 0.02, (sitting ? 0.35 : 0.95) * s), B.sh * 1.22 + 0.02 * s, 0.12 * s, 0.009 * s, sitting), [top[0] - 0.5 * s, 0, top[2] - 0.6 * s, top[0] + 0.5 * s, top[1] + 0.06 * s, top[2] + 0.3 * s], { mat: M.cloth, g: GR.cloak, k: 0 });
    sc.torus(top, 0.07 * g, 0.032 * s, sR, { mat: M.cloth, g: GR.cloak, k: 0, disp: furDisp(0.003 * s), amp: 0.004 * s });
  }

  // ================================================================ SLEEPERS
  if (asleep && opt.blanket) {
    // A blanket over the body from the shoulders down, hems on the bedroll.
    const back = -0.13 * g;
    const neckY = J.neck[1] - 0.05 * s;
    const footY = 0.06 * s;
    const bl = { mat: M.blanket, g: GR.blanket, k: 0.12 * s, clip: [[0, 1, 0, neckY]], clipK: 0.03 * s };
    const fold = (x, y) => 0.008 * s * Math.sin(x * 26 / s + y * 7 / s) + 0.005 * s * Math.sin(y * 19 / s - x * 11 / s);
    // One loose drape over the body (not a second skin), a rise over the toes, the hem on the bedroll.
    const midY = (neckY + footY) / 2;
    const dw = B.sh + 0.085 * g;
    sc.ellipsoid([J.pelvis[0], midY, back + 0.08 * g], [dw * 1.12, (neckY - footY) / 2 + 0.07 * s, 0.24 * g], M_ID, { ...bl, disp: fold, amp: 0.012 * s });
    sc.ellipsoid([J.pelvis[0], footY + 0.04 * s, back + 0.13 * s], [0.19 * g, 0.09 * s, 0.13 * s], M_ID, { ...bl, disp: fold, amp: 0.012 * s });
    sc.box([0, (neckY - 0.02) / 2 - 0.01, back - 0.004], [0.36 * s, (neckY + 0.06) / 2, 0.012 * s], M_ID, 0.01 * s, { ...bl, disp: (x, y) => 0.006 * s * Math.sin(y * 31 / s + x * 9 / s) * Math.min(1, Math.abs(x) / (0.2 * s)), amp: 0.007 * s });
    // A folded-back edge at the chest.
    sc.box([J.pelvis[0], neckY - 0.03 * s, back + 0.08 * g + 0.16 * g], [dw, 0.03 * s, 0.035 * s], M_ID, 0.02 * s, { mat: M.blanket, g: GR.blanket, k: 0.05 * s });
    // Pillow under the head.
    sc.box([0, Hc[1] + 0.01 * s, back - 0.02 * s], [0.17 * s, 0.11 * s, 0.045 * s], M_ID, 0.04 * s, { mat: M.pillow, g: GR.cloak, k: 0 });
  }

  // ---- frames for meshes placed by Miniature.js
  const frames = {
    face: { c: Hc, R: HR, hs },
    hands: { L: J.handL, R: J.handR },
    height: (J.head[1] + 0.125 * hs),
    joints: J,
    body: B,
    asleep,
    sitting,
  };
  // Weapon: held in the right fist, or resting beside a sitter.
  if (!asleep && !opt.noWeapon && app.weapon) {
    if (sitting) {
      const hipR = J.hipR;
      frames.weapon = { pos: [hipR[0] - 0.2 * s, app.weapon === 'staff' || app.weapon === 'spear' ? 0.62 * s : 0.36 * s, hipR[2] + 0.06 * s], dir: vnorm(app.weapon === 'staff' || app.weapon === 'spear' ? [0.18, 1, 0.12] : [0.25, -1, 0.05]), resting: true };
    } else {
      frames.weapon = { pos: J.handR.c, dir: [J.handR.R[3], J.handR.R[4], J.handR.R[5]], knuckle: [J.handR.R[0], J.handR.R[1], J.handR.R[2]] };
    }
  }
  if (!asleep && app.shield) {
    if (sitting) {
      frames.shield = { pos: [J.hipL[0] + 0.3 * s, 0.22 * s, J.hipL[2] + 0.02], n: vnorm([1, 0.25, 0.35]), up: [0, 1, 0] };
    } else {
      const el = J.elbowL;
      const wr = J.wristL;
      const n = vnorm(P.shieldN ?? [0, 0, 1]);
      const mid = vlerp(el, wr, 0.62);
      const fwdA = vnorm(vsub(wr, el));
      const upv = vnorm(vsub([0, 1, 0], vscale(n, n[1])));
      frames.shield = { pos: vadd(mid, vscale(n, 0.066 * g + 0.02 * s)), n, up: vnorm(vlerp(upv, vsub(fwdA, vscale(n, vdot(fwdA, n))), 0.15)), scale: Math.max(0.7, s * 0.95 + 0.05) };
    }
  }
  frames.scale = s;
  return { sculpt: sc, frames, mats: M };
}

// ------------------------------------------------------------------ helpers

function mEulerSafe(p, y, r) {
  return mEuler(p, y, r);
}

function bbOf(c, r) {
  return [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r];
}

/** Plane through point p with outward normal n given in frame R (keep n·x ≤ n·p). */
function planeAlong(R, nLocal, p) {
  const n = vnorm(mApply(R, nLocal));
  return [n[0], n[1], n[2], vdot(n, p)];
}

function grooveDisp(c, amp, n) {
  return (x, y, z) => amp * (0.5 - Math.abs(Math.sin(Math.atan2(x - c[0], z - c[2]) * n + y * 40)));
}

function furDisp(amp) {
  return (x, y, z) => amp * (Math.sin(x * 211 + y * 97) * Math.sin(z * 173 + y * 131) * 0.6 + Math.sin(x * 61 - z * 47 + y * 83) * 0.4);
}

/** A long robe skirt: a flared elliptic cone with vertical folds. */
function robeSkirt(top, R, len, r0, r1, amp) {
  const X = [R[0], R[1], R[2]];
  const Z = [R[6], R[7], R[8]];
  return (x, y, z) => {
    const px = x - top[0], py = y - top[1], pz = z - top[2];
    const t = Math.min(1, Math.max(0, -py / len));
    const lx = px * X[0] + py * X[1] + pz * X[2];
    const lz = px * Z[0] + py * Z[1] + pz * Z[2];
    const r = r0 + (r1 - r0) * t ** 1.3;
    const th = Math.atan2(lx, lz);
    const fold = amp * t * (Math.sin(th * 7 + 0.6) * 0.7 + Math.sin(th * 13 + 1.1) * 0.3);
    const d = (Math.hypot(lx, lz * 1.18) - r - fold) * 0.9;
    return Math.max(d, py, -(py + len));
  };
}

/** A cloak hanging from the shoulders behind the body, open at the front, with folds. */
function cloakFn(top, R, len, r0, flare, thick, sitting) {
  const X = [R[0], R[1], R[2]];
  const Y = [R[3], R[4], R[5]];
  const Z = [R[6], R[7], R[8]];
  return (x, y, z) => {
    const px = x - top[0], py = y - top[1], pz = z - top[2];
    const lx = px * X[0] + py * X[1] + pz * X[2];
    const ly = px * Y[0] + py * Y[1] + pz * Y[2];
    const lz = px * Z[0] + py * Z[1] + pz * Z[2];
    const t = Math.min(1, Math.max(0, -ly / len));
    const a = r0 * (0.96 + 0.1 * t) + flare * t;
    const b = r0 * 0.62 + flare * 0.7 * t + (sitting ? t * t * 0.25 : 0);
    const cz = -0.015 - 0.03 * t - (sitting ? t * t * 0.2 : 0);
    const th = Math.atan2(lx, -(lz - cz));
    const fold = 0.016 * t * Math.sin(th * 6.5) + 0.006 * t * Math.sin(th * 15 + 1);
    const e = (Math.hypot(lx / a, (lz - cz) / b) - 1) * Math.min(a, b) - fold;
    let d = Math.abs(e) - thick;
    // Drape over the shoulder tops.
    const capTop = ly - 0.03 + (lx * lx) * 0.6;
    d = Math.max(d, capTop, -(ly + len), lz - (0.05 - 0.03 * t), -y + 0.004);
    return d;
  };
}
