import { Figure, mat, add, sub, scl, norm, ap3, mul3, rotX, rotY, rotZ, alignY, ik, shade, mixc } from './sculpt.js';
import { sculptHead, handShape } from './anatomy.js';
import { weapon } from './bodies.js';
import { rngOf } from './paint.js';

/**
 * Costumed townsfolk for the SDF figure renderer: an anatomical skeleton
 * (IK arms and legs, spine lean/twist), a sculpted head (anatomy.js) and an
 * outfit built in layers — a shirt or chemise with long, rolled, puffed or
 * bell sleeves; a bodice, doublet, jerkin or tabard over it; a floor-length
 * skirt or robe whose hem carries real fold geometry; an apron, stole, sash,
 * belt and pouch; trousers and boots; a mantle or cape — each layer its own
 * smooth group, so garments meet at crisp seams while flesh and cloth inside
 * a layer flow together.
 *
 *   buildNpc(spec) → {fig, top}
 *   spec: {gender, race, age, build, skin, hair, hairStyle, beard, eyeC, pose, outfit, seed}
 *   outfit: {shirt, sleeves:'long'|'rolled'|'bell'|'puffed', top, topKind:'bodice'|'doublet'|'jerkin'|'tabard'|'robe'|'chain',
 *            skirt, skirtLen:'floor'|'knee', apron, stole, sash, belt, trousers, boots, mantle, hood, collar, symbol}
 *
 * Poses (a small library keyed by name, so scenes can switch them as a dialogue
 * unfolds): idle, clasped, bless, welcome, clerk, smith, barkeep, trainer, point, cower, threat.
 */

const cloth = (c, o = {}) => mat(c, { pattern: 'cloth', scale: 0.014, rough: 0.92, spec: 0.04, ...o });
const leather = (c) => mat(c, { pattern: 'leather', scale: 0.025, rough: 0.6, spec: 0.22 });
const metal = (c) => mat(c, { pattern: 'metal', metal: true, rough: 0.3, spec: 0.95, scale: 0.05 });
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Hand targets per pose, in the torso frame relative to each shoulder (d = -1 right/viewer-left, +1 left). */
const POSES = {
  idle: { lean: 0.02, hands: (d) => ({ at: [d * 0.035, -0.31, 0.045], dir: [d * 0.1, -1, 0.15], curl: 0.45, pole: [d, -0.2, -0.6] }) },
  clasped: { lean: 0.03, headPitch: 0.05, hands: (d) => ({ at: [-d * 0.075, -0.25, 0.13], dir: [-d * 0.9, -0.3, 0.3], curl: 0.7, pole: [d, -0.6, -0.3] }) },
  bless: { lean: -0.03, headPitch: -0.06, hands: (d) => ({ at: [d * 0.12, -0.12, 0.2], dir: [d * 0.5, 0.7, 0.5], curl: 0.15, spread: 0.7, pole: [d * 0.8, -0.8, -0.2] }) },
  welcome: { lean: 0.02, twist: 0.1, headYaw: -0.1, hands: (d) => d < 0 ? { at: [-0.05, -0.13, 0.22], dir: [-0.6, 0.35, 0.7], curl: 0.2, spread: 0.6, pole: [-1, -0.5, -0.2] } : { at: [0.03, -0.3, 0.04], dir: [0.1, -1, 0.15], curl: 0.45, pole: [1, -0.2, -0.6] } },
  clerk: { lean: 0.16, headPitch: 0.22, headYaw: -0.05, hands: (d) => d < 0 ? { at: [0.07, -0.24, 0.24], dir: [0.2, -0.2, 1], grip: true, weapon: 'quill', pole: [-1, -0.4, -0.2] } : { at: [-0.06, -0.25, 0.24], dir: [-0.3, 0, 1], curl: 0.3, pole: [1, -0.4, -0.2] } },
  smith: { lean: 0.1, twist: -0.22, headYaw: 0.35, headPitch: 0.15, hands: (d) => d < 0 ? { at: [-0.06, 0.15, 0.02], dir: [0.5, 0.45, -0.5], grip: true, weapon: 'hammer', pole: [-0.8, -0.2, -0.3] } : { at: [-0.05, -0.2, 0.25], dir: [-0.3, 0, 1], grip: true, weapon: 'tongs', pole: [1, -0.4, -0.2] } },
  barkeep: { lean: 0.08, twist: 0.15, headYaw: -0.2, headTilt: 0.06, hands: (d) => d < 0 ? { at: [0.05, -0.2, 0.2], dir: [0, 1, 0.1], grip: true, weapon: 'tankard', pole: [-1, -0.5, -0.2] } : { at: [-0.06, -0.22, 0.22], dir: [-0.5, 0.2, 1], curl: 0.6, spread: 0.3, rag: true, pole: [1, -0.5, -0.2] } },
  // both hands stacked on the pommel of a longsword whose point rests on the floor before him
  trainer: { lean: -0.03, headPitch: -0.04, headYaw: 0.1, hands: (d) => ({ at: [-d * 0.1, d < 0 ? -0.29 : -0.25, 0.2], dir: [0, -1, 0.04], grip: true, weapon: d < 0 ? 'longsword' : null, pole: [d, -0.3, -0.5] }) },
  // the clerk raises the ledger to read from it, quill poised
  ledger: { lean: 0.05, headPitch: 0.16, headYaw: -0.08, hands: (d) => d > 0 ? { at: [-0.05, -0.13, 0.25], dir: [-0.15, 0.25, 1], grip: true, weapon: 'ledger', pole: [1, -0.6, -0.2] } : { at: [0.06, -0.15, 0.24], dir: [0.3, 0.6, 0.6], grip: true, weapon: 'quill', pole: [-1, -0.5, -0.2] } },
  // Tyr's priest: the right hand raised in judgement, the left holding a small balance by its ring
  judge: { lean: -0.02, headPitch: -0.04, hands: (d) => d < 0 ? { at: [-0.03, 0.02, 0.17], dir: [-0.1, 1, 0.2], curl: 0.2, spread: 0.3, pole: [-1, -0.6, -0.3] } : { at: [0.02, -0.12, 0.24], dir: [0, 1, 0.2], grip: true, weapon: 'balance', pole: [1, -0.6, -0.2] } },
  // seated on a stool or bench, hands on the knees (a mug in one)
  sit: { lean: 0.08, sit: true, headPitch: 0.04, hands: (d) => d < 0 ? { at: [0.02, -0.22, 0.24], dir: [0, 1, 0.2], grip: true, weapon: 'tankard', pole: [-1, -0.4, -0.4] } : { at: [-0.01, -0.29, 0.2], dir: [0, -0.4, 1], curl: 0.5, pole: [1, -0.4, -0.4] } },
  // at the oars: seated on the thwart, leaning into the stroke, fists round the looms
  row: { lean: 0.22, sit: true, headPitch: -0.12, headYaw: 0.35, hands: (d) => ({ at: [-d * 0.02, -0.1, 0.3], dir: [-d * 0.7, 0.05, 0.7], grip: true, pole: [d, -0.4, -0.4] }) },
  // leaning over a table, knuckles down — the dice game
  lean: { lean: 0.3, headPitch: 0.25, hands: (d) => ({ at: [-d * 0.01, -0.2, 0.26], dir: [0, -0.5, 1], curl: 0.7, pole: [d, -0.3, -0.5] }) },
  // a watchman jabbing a finger mid-argument
  argue: { lean: 0.06, twist: 0.12, headPitch: -0.02, hands: (d) => d < 0 ? { at: [0.03, 0.02, 0.3], dir: [0.15, 0.2, 1], curl: 0.15, pole: [-1, -0.4, -0.2] } : { at: [0.025, -0.3, 0.05], dir: [0.1, -1, 0.15], curl: 0.45, pole: [1, -0.2, -0.6] } },
  // arms folded across the chest
  folded: { lean: -0.03, headPitch: -0.03, hands: (d) => ({ at: [-d * 0.15, -0.14, 0.1], dir: [-d, 0.15, 0.1], curl: 0.55, pole: [d, -0.9, 0.1] }) },
  point: { lean: 0.04, twist: 0.12, hands: (d) => d < 0 ? { at: [0.02, 0.0, 0.3], dir: [0.1, 0.1, 1], curl: 0.15, pole: [-1, -0.3, -0.2] } : { at: [0.03, -0.3, 0.04], dir: [0.1, -1, 0.15], curl: 0.45, pole: [1, -0.2, -0.6] } },
  cower: { lean: 0.28, crouch: 0.3, headPitch: 0.3, hands: (d) => ({ at: [d * 0.0, -0.02, 0.17], dir: [-d * 0.3, 0.8, 0.4], curl: 0.3, pole: [d, -0.8, 0] }) },
  threat: { lean: 0.12, crouch: 0.12, headPitch: 0.1, hands: (d) => d < 0 ? { at: [-0.04, 0.12, 0.12], dir: [0.4, 0.8, 0.3], grip: true, pole: [-1, -0.3, -0.4] } : { at: [-0.03, -0.18, 0.22], dir: [-0.2, 0.3, 1], curl: 0.5, pole: [1, -0.5, -0.2] } },
};
export const PERSON_POSES = Object.keys(POSES);

export function buildNpc(spec) {
  const R = rngOf((spec.seed ?? 7) * 7919 + 13);
  const f = new Figure();
  const fem = spec.gender === 'female';
  const race = spec.race ?? 'human';
  const short = race === 'dwarf' || race === 'halfling' || race === 'gnome';
  const b = (race === 'dwarf' ? 1.22 : 1) * (spec.build ?? 1);
  const O = spec.outfit ?? {};
  const P = { ...POSES.idle, ...(POSES[spec.pose] ?? {}) };
  const age = spec.age ?? 0;
  const skinM = mat(spec.skin ?? '#d9a77a', { pattern: 'skin', scale: 0.018, sss: 0.5, rough: 0.82, spec: 0.08 });
  const shirtM = cloth(O.shirt ?? '#d8ccb0');
  const robe = O.topKind === 'robe';
  const topM = O.topKind === 'chain' ? mat('#8a8c94', { pattern: 'mail', metal: true, scale: 0.05, rough: 0.45, spec: 0.7 })
    : O.top ? (O.topKind === 'jerkin' ? leather(O.top) : cloth(O.top, { scale: 0.012 })) : shirtM;
  const skirtM = O.skirtMail ? topM : O.skirt ? cloth(O.skirt) : robe ? topM : null;
  const trouserM = cloth(O.trousers ?? shade(O.shirt ?? '#6a5234', 0.55));
  const bootM = leather(O.boots ?? '#2e2016');
  const beltM = leather(O.belt ?? '#3a2616');
  const brass = metal('#b08a40');

  // ---- skeleton
  const crouch = P.crouch ?? 0;
  const sit = !!P.sit;
  const legH = short ? 0.4 : 0.49;
  const hipH = sit ? legH * 0.56 : legH * (1 - crouch * 0.25);
  const torso = (short ? 0.3 : 0.33);
  // heroic proportion: a head big enough to carry a face at panel size
  const hr = short ? 0.084 : 0.075;
  const lean = (P.lean ?? 0) + age * 0.12 + (spec.hunch ?? 0);
  const twist = P.twist ?? 0;
  const TR = mul3(rotY(twist), rotX(lean));
  const T = (v) => ap3(TR, v);
  const pelvis = [0, hipH + 0.02, 0];
  const up = T([0, 1, 0]);
  const waist = add(pelvis, scl(up, 0.1));
  const chest = add(pelvis, scl(up, torso * 0.64));
  const neck = add(pelvis, scl(up, torso));
  const shW = (fem ? 0.09 : 0.104) * b;
  const sh = { [-1]: add(chest, T([-shW, 0.064, -0.012])), [1]: add(chest, T([shW, 0.064, -0.012])) };
  const headC = add(neck, T([0, hr * (fem ? 1.12 : 1.3), hr * 0.22]));

  // ---- legs (hidden under long skirts: only the shoe tips show)
  const longSkirt = skirtM && (O.skirtLen ?? 'floor') === 'floor';
  const stance = 0.065 * b;
  for (const d of [-1, 1]) {
    // seated: feet planted forward of the stool, shins near vertical
    const foot = sit ? [d * stance * 1.2, 0, 0.2 + (d < 0 ? 0.02 : -0.01)] : [d * stance, 0, d < 0 ? 0.02 : -0.02];
    const hip = add(pelvis, [d * 0.058 * b, -0.03, 0]);
    const ankle = add(foot, [0, 0.045, -0.015]);
    const knee = ik(hip, ankle, (legH - 0.03) * 0.52, (legH - 0.03) * 0.5, sit ? [d * 0.05, 1, 0.6] : [d * 0.1, 0, 1]);
    if (!longSkirt) {
      f.cone(hip, knee, 0.05 * b, 0.037 * b, trouserM, { group: 'legs', k: 0.02 });
      f.ell(lerp3(hip, knee, 0.4), [0.052 * b, 0.1, 0.05 * b], trouserM, { group: 'legs', k: 0.03, R: alignY(sub(knee, hip)) });
      f.cone(knee, ankle, 0.037 * b, 0.026 * b, trouserM, { group: 'legs', k: 0.02 });
      f.ell(lerp3(knee, ankle, 0.3), [0.04 * b, 0.07, 0.038 * b], trouserM, { group: 'legs', k: 0.03, R: alignY(sub(ankle, knee)) });
      // boots to below the knee, folded cuff
      f.cone(lerp3(knee, ankle, 0.3), ankle, 0.041 * b, 0.031 * b, bootM, { group: `boot${d}`, k: 0.01 });
      f.cone(lerp3(knee, ankle, 0.26), lerp3(knee, ankle, 0.36), 0.045 * b, 0.043 * b, bootM, { group: `boot${d}`, k: 0.01 });
    }
    // shoe
    const toe = add(ankle, [d * 0.006, -0.03, 0.085]);
    f.cone(ankle, toe, 0.028 * b, 0.022 * b, bootM, { group: `boot${d}`, k: 0.012 });
    f.ell(add(lerp3(ankle, toe, 0.62), [0, -0.012, 0]), [0.027 * b, 0.016, 0.05], bootM, { group: `boot${d}`, k: 0.012 });
  }

  // ---- torso: the body under the top layer
  const tg = { group: 'torso', k: 0.04 };
  f.push(pelvis, TR, 1);
  f.ell([0, 0, 0], [(fem ? 0.098 : 0.09) * b, 0.075, 0.068 * b], topM, tg);
  f.ell([0, 0.1, 0.004], [(fem ? 0.07 : 0.08) * b, 0.07, (fem ? 0.056 : 0.062) * b], topM, tg);
  f.ell([0, torso * 0.64, 0], [(fem ? 0.09 : 0.105) * b, 0.098, (fem ? 0.066 : 0.074) * b], topM, tg);
  f.ell([0, torso * 0.64 + 0.05, -0.006], [(fem ? 0.094 : 0.108) * b, 0.046, 0.064 * b], topM, tg);
  if (fem) for (const d of [-1, 1]) f.ell([d * 0.04, torso * 0.6, 0.05], [0.044, 0.042, 0.04], topM, { group: 'torso', k: 0.03 });
  if (spec.belly) f.ell([0, 0.12, 0.04], [0.085 * b, 0.09, 0.07 * b], topM, tg);
  // neckline: a chemise or shirt collar showing at the throat, skin above it
  const neckM = O.top && !robe ? shirtM : topM;
  f.ell([0, torso * 0.94, 0.004], [0.05, 0.016, 0.038], neckM, { group: 'collar', k: 0.01 });
  if (O.collar) f.ell([0, torso * 0.96, -0.004], [0.07, 0.026, 0.06], cloth(O.collar), { group: 'collar2', k: 0.01 });
  if (O.topKind === 'bodice') {
    // laced bodice: cross lacing over the front, a low chemise neckline
    for (let i = 0; i < 4; i++) {
      const y = torso * (0.35 + i * 0.12);
      f.cone([-0.016, y, 0.074 * b], [0.016, y + 0.04, 0.072 * b], 0.0028, 0.0028, mat('#3a2418', { rough: 0.85 }), { group: null });
      f.cone([0.016, y, 0.074 * b], [-0.016, y + 0.04, 0.072 * b], 0.0028, 0.0028, mat('#3a2418', { rough: 0.85 }), { group: null });
    }
    f.ell([0, torso * 0.9, 0.012], [0.074, 0.02, 0.042], shirtM, { group: 'chemise', k: 0.02 });
  }
  if (O.topKind === 'doublet' || O.topKind === 'tabard') for (let i = 0; i < 5; i++) f.sphere([0, torso * (0.25 + i * 0.13), 0.073 * b], 0.0055, brass, { group: null });
  if (O.topKind === 'tabard' && O.symbol) emblem(f, O.symbol, [0, torso * 0.55, 0.077 * b], 0.03);
  f.pop();
  // neck: a real column set into sloping trapezius muscles, the head carried forward of the spine
  f.cone(add(neck, T([0, -0.03, -0.006])), add(headC, T([0, -hr * 0.55, -hr * 0.12])), (fem ? 0.03 : 0.037) * b, (fem ? 0.026 : 0.031) * b, skinM, { group: 'neck', k: 0.025 });
  for (const d of [-1, 1]) {
    const tq = add(neck, T([d * 0.05 * b, -0.03, -0.014]));
    f.ell(tq, [0.05 * b, 0.024, 0.04 * b], O.top && !robe && O.topKind !== 'chain' ? topM : neckM, { group: 'torso', k: 0.04, R: mul3(TR, rotZ(d * 0.42)) });
  }

  // ---- skirt / robe / tunic hem with hanging folds
  if (skirtM) {
    const top = add(waist, T([0, -0.01, 0]));
    const floor = (O.skirtLen ?? 'floor') === 'floor';
    const hemY = floor ? 0.015 : hipH - 0.19;
    const rTop = (fem ? 0.084 : 0.09) * b;
    const rBot = (floor ? 0.165 : 0.11) * b;
    f.cone(top, [0, hemY + (floor ? 0.03 : 0), 0.004], rTop, rBot, skirtM, { group: 'skirt', k: 0.02, disp: { amp: floor ? 0.013 : 0.008, freq: floor ? 15 : 11, twist: 1.6 } });
    // a floor-length hem breaks on the floor and is cut flat there (a round cone's cap reads as a bowling pin)
    if (floor) f.carve('box', [0, -0.25, 0], [0.5, 0.25, 0.5], null, { group: 'skirt', k: 0.006 });
    f.ell(add(waist, T([0, -0.035, 0])), [rTop * 1.04, 0.05, rTop * 0.82], skirtM, { group: 'skirt', k: 0.03 });
  }
  // tabards, doublets and jerkins hang below the belt: a hem to mid-thigh, split at the sides,
  // so no one stands about in a leotard
  if (!skirtM && O.top && ['tabard', 'doublet', 'jerkin'].includes(O.topKind)) {
    const top = add(waist, T([0, -0.012, 0]));
    const len = O.topKind === 'tabard' ? 0.2 : O.topKind === 'jerkin' ? 0.13 : 0.1;
    const hemY = waist[1] - len;
    if (O.topKind === 'tabard') {
      for (const z of [1, -1]) {
        const a = add(top, T([0, 0, z * 0.05 * b]));
        const bot = [0, hemY, z * 0.075 * b];
        f.box(lerp3(a, bot, 0.5), [0.072 * b, Math.hypot(...sub(a, bot)) / 2, 0.007], topM, { group: `tabard${z}`, k: 0.01, bevel: 0.005, R: alignY(sub(a, bot), [1, 0, 0]), disp: { amp: 0.003, freq: 40 } });
      }
      if (O.symbol) emblem(f, O.symbol, [0, waist[1] - len * 0.45, 0.085 * b], 0.024);
    } else {
      f.cone(top, [0, hemY, 0.004], 0.088 * b, 0.1 * b, topM, { group: 'hem', k: 0.02, disp: { amp: 0.004, freq: 12, twist: 1 } });
    }
  }
  if (O.apron) {
    const am = cloth(O.apron, { scale: 0.01 });
    const top = add(waist, T([0, -0.02, 0.06 * b]));
    const len = (longSkirt ? 0.38 : 0.26);
    const bot = [0, waist[1] - len, 0.14 * b];
    const mid = lerp3(top, bot, 0.5);
    f.box(mid, [0.075 * b, len / 2, 0.006], am, { group: 'apron', k: 0.01, bevel: 0.005, R: alignY(sub(top, bot), [1, 0, 0]), disp: { amp: 0.0025, freq: 16 } });
    if (fem) f.box(add(chest, T([0, -0.02, 0.078 * b])), [0.05, 0.05, 0.005], am, { group: 'apron', k: 0.01, bevel: 0.004, R: TR });
  }
  // belt or sash with a pouch
  if (O.sash) {
    const sm = cloth(O.sash);
    f.ell(add(waist, T([0, -0.01, 0])), [0.088 * b, 0.022, 0.07 * b], sm, { group: 'sash', k: 0.01 });
    // the knotted tail hangs as a flat ribbon, not a rod
    const s0 = add(waist, T([0.05, -0.03, 0.068])); const s1 = add(waist, T([0.07, -0.2, 0.085]));
    f.box(lerp3(s0, s1, 0.5), [0.016, Math.hypot(...sub(s1, s0)) / 2, 0.004], sm, { group: 'sashTail', k: 0.004, bevel: 0.003, R: alignY(sub(s0, s1), [1, 0, 0]), disp: { amp: 0.002, freq: 20 } });
    f.sphere(s0, 0.016, sm, { group: 'sashTail', k: 0.006 });
  } else if (O.belt !== false) {
    f.ell(add(waist, T([0, -0.02, 0])), [(fem ? 0.079 : 0.086) * b, 0.016, (fem ? 0.064 : 0.07) * b], beltM, { group: 'belt', k: 0.006 });
    f.box(add(waist, T([0, -0.02, (fem ? 0.066 : 0.072) * b])), [0.014, 0.012, 0.005], brass, { group: null, bevel: 0.003, R: TR });
    f.box(add(waist, T([0.07 * b, -0.05, 0.045])), [0.022, 0.03, 0.013], beltM, { group: 'pouch', k: 0.004, bevel: 0.01, R: mul3(TR, rotY(0.6)) });
  }
  if (O.stole) {
    const st = cloth(O.stole, { scale: 0.01 });
    for (const d of [-1, 1]) {
      const a = add(neck, T([d * 0.045, -0.01, 0.045]));
      const z = add(waist, T([d * 0.04, longSkirt ? -0.3 : -0.18, 0.1 * b]));
      f.box(lerp3(a, z, 0.5), [0.02, Math.hypot(...sub(a, z)) / 2, 0.004], st, { group: `stole${d}`, k: 0.004, bevel: 0.003, R: alignY(sub(a, z), [1, 0, 0]) });
      if (O.symbol) emblem(f, O.symbol, add(z, T([0, 0.035, 0.008])), 0.016);
    }
  }
  if (O.mantle) {
    const mm = cloth(O.mantle, { scale: 0.016 });
    const top = add(chest, T([0, 0.07, -0.075 * b]));
    f.ell(add(chest, T([0, 0.075, -0.02])), [0.14 * b, 0.05, 0.085 * b], mm, { group: 'mantle', k: 0.03 });
    for (let i = 0; i < 4; i++) {
      const a = -0.75 + i * 0.5;
      const tx = Math.sin(a) * 0.16 * b;
      f.cone(add(top, [tx * 0.6, 0, 0]), [tx * 1.25, 0.03, -0.1 * b - Math.cos(a) * 0.03], 0.045 * b, 0.075 * b, mm, { group: 'mantle', k: 0.03, disp: { amp: 0.008, freq: 9, twist: 1 } });
    }
  }

  // ---- arms: shoulder cap, sleeves, hands
  const hands = {};
  for (const d of [-1, 1]) {
    const hp = P.hands(d);
    const wrist = add(sh[d], T(hp.at));
    const dir = norm(T(hp.dir));
    const upper = 0.168 * (short ? 0.88 : 1);
    const fore = 0.152 * (short ? 0.88 : 1);
    const elbow = ik(sh[d], wrist, upper, fore, T(hp.pole ?? [d * 0.7, -0.35, -0.7]));
    hands[d] = { wrist, dir, elbow };
    const sleeveTop = O.topKind === 'doublet' || O.topKind === 'chain' || robe ? topM : shirtM;
    const sg = { group: `arm${d}`, k: 0.025 };
    f.sphere(sh[d], 0.043 * b, sleeveTop, { group: 'torso', k: 0.05 });
    const sleeves = O.sleeves ?? (robe ? 'bell' : 'long');
    if (sleeves === 'puffed') f.ell(lerp3(sh[d], elbow, 0.35), [0.058 * b, 0.075, 0.056 * b], sleeveTop, { ...sg, R: alignY(sub(elbow, sh[d])) });
    f.cone(sh[d], elbow, 0.042 * b, 0.036 * b, sleeveTop, sg);
    if (sleeves === 'bell') {
      // wide sleeve: flares from the elbow and hangs below the wrist
      // gravity: on a raised or forward arm the wide cuff drapes down off the
      // forearm instead of opening toward the viewer like a bowl
      const fw = norm(sub(wrist, elbow));
      const lift = Math.max(0, fw[1] + 0.35) + Math.max(0, fw[2]) * 0.6;
      const hang = add(wrist, [0, -0.02 - 0.05 * lift, -0.015 * lift]);
      // the bell: a flared cone with a few long folds (shallow, so the rim stays a clean edge)
      const ax = norm(sub(hang, elbow));
      const mouth = lerp3(elbow, hang, 1.0);
      const rM = 0.054 * b;
      f.cone(elbow, mouth, 0.038 * b, rM, sleeveTop, { ...sg, disp: { amp: 0.0035, freq: 7, twist: 0.6 } });
      // the mouth of the sleeve: a hollow behind a thin rim (a flat-bottomed cut along the axis, not a
      // scooped ellipsoid whose folds read as black notches), lined in the undershirt colour, with
      // the shirt cuff and the wrist coming out of it
      f.carve('cone', add(mouth, scl(ax, 0.03)), add(mouth, scl(ax, -0.012)), rM * 0.8, { group: `arm${d}`, k: 0.006, rb: rM * 0.78 });
      f.ell(add(mouth, scl(ax, -0.009)), [rM * 0.8, 0.005, rM * 0.8], cloth(shade(O.lining ?? O.shirt ?? '#d8ccb0', 0.5)), { group: `lining${d}`, k: 0.004, R: alignY(ax) });
      f.cone(lerp3(elbow, wrist, 0.55), lerp3(elbow, wrist, 0.92), 0.03, 0.028, cloth(O.cuff ?? O.shirt ?? '#d8ccb0'), { group: `cuff${d}`, k: 0.008 });
      f.cone(lerp3(elbow, wrist, 0.85), wrist, 0.025, 0.022, skinM, { group: `wrist${d}`, k: 0.01 });
    } else if (sleeves === 'rolled') {
      f.cone(lerp3(elbow, wrist, 0.12), wrist, 0.034 * b, 0.024 * b, skinM, { group: `forearm${d}`, k: 0.02 });
      f.ell(lerp3(elbow, wrist, 0.3), [0.036 * b, 0.05, 0.034 * b], skinM, { group: `forearm${d}`, k: 0.02, R: alignY(sub(wrist, elbow)) });
      f.cone(lerp3(elbow, wrist, -0.05), lerp3(elbow, wrist, 0.14), 0.046 * b, 0.045 * b, sleeveTop, { group: `cuff${d}`, k: 0.012 });
    } else {
      f.cone(elbow, wrist, 0.039 * b, 0.03 * b, O.topKind === 'chain' ? shirtM : sleeveTop, sg);
      f.cone(lerp3(elbow, wrist, 0.86), lerp3(elbow, wrist, 1.02), 0.034 * b, 0.034 * b, O.cuff ? cloth(O.cuff) : sleeveTop, { group: `cuff${d}`, k: 0.008 });
    }
    // hand
    const palm = add(wrist, scl(dir, 0.03));
    f.push(palm, alignY(dir, T([d, 0, 0])), 0.92 * b);
    handShape(f, skinM, d, { grip: !!hp.grip, curl: hp.curl, spread: hp.spread });
    f.pop();
    if (hp.weapon) weapon(f, hp.weapon, palm, dir, d, {});
    if (hp.rag) f.ell(add(palm, T([0, -0.03, 0.02])), [0.03, 0.045, 0.012], cloth('#d8d0b8'), { group: 'rag', k: 0.01, disp: { amp: 0.004, freq: 70 } });
  }
  // a hood or mantle collar falls over the shoulders before the head goes on
  // ---- head
  const HR = mul3(rotY(twist + (P.headYaw ?? 0) + (spec.headYaw ?? 0)), mul3(rotX(-lean * 0.8 + (P.headPitch ?? 0)), rotZ((P.headTilt ?? 0) + (R() - 0.5) * 0.06)));
  f.push(headC, HR, hr);
  sculptHead(f, skinM, { smile: spec.smile, lipC: spec.lipC, gender: spec.gender, age, hair: spec.hair, hairStyle: spec.hairStyle, beard: spec.beard, eyeC: spec.eyeC, hood: O.hood ?? null, helm: O.helm, nose: spec.nose, jaw: spec.jaw, spectacles: O.spectacles, cap: O.cap, mitre: O.mitre, mitreTrim: O.mitreTrim });
  f.pop();
  f.top = headC[1] + hr * 1.15;
  return { fig: f, top: f.top, sp: { legs: short ? 0.4 : 0.49 }, hands, head: { c: headC, R: HR, r: hr } };
}

/** A small holy symbol / heraldic charge in relief. */
function emblem(f, kind, at, s) {
  const gold = metal('#d8b050');
  const silver = metal('#c8ccd4');
  if (kind === 'scales') {
    f.cone(add(at, [0, s * 0.9, 0]), add(at, [0, -s * 0.9, 0]), s * 0.08, s * 0.08, gold, { group: null });
    f.cone(add(at, [-s * 0.8, s * 0.6, 0]), add(at, [s * 0.8, s * 0.6, 0]), s * 0.07, s * 0.07, gold, { group: null });
    for (const d of [-1, 1]) f.ell(add(at, [d * s * 0.75, s * 0.05, 0.002]), [s * 0.28, s * 0.1, s * 0.12], gold, { group: null });
  } else if (kind === 'rose' || kind === 'sune') {
    f.sphere(at, s * 0.55, mat('#c02838', { rough: 0.5, spec: 0.4 }), { group: null });
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; f.sphere(add(at, [Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5, -0.002]), s * 0.32, mat('#e04050', { rough: 0.5 }), { group: null }); }
  } else if (kind === 'sword' || kind === 'tempus') {
    f.cone(add(at, [0, s, 0]), add(at, [0, -s * 0.9, 0]), s * 0.12, s * 0.04, silver, { group: null });
    f.cone(add(at, [-s * 0.5, s * 0.45, 0]), add(at, [s * 0.5, s * 0.45, 0]), s * 0.08, s * 0.08, gold, { group: null });
  } else if (kind === 'hand' || kind === 'bane') {
    f.ell(at, [s * 0.5, s * 0.55, s * 0.15], mat('#101010', { rough: 0.4, spec: 0.5 }), { group: null });
    for (let i = 0; i < 4; i++) f.cone(add(at, [(i - 1.5) * s * 0.22, s * 0.4, 0]), add(at, [(i - 1.5) * s * 0.26, s * 0.95, 0]), s * 0.1, s * 0.08, mat('#101010', { rough: 0.4, spec: 0.5 }), { group: null });
  } else {
    f.sphere(at, s * 0.5, gold, { group: null });
  }
}

export { mixc };
