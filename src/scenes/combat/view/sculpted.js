import * as THREE from 'three';
import { Sculpt, meshSculpt, M_ID, mEuler } from '../../../ui/components/sdfSculpt.js';

/**
 * Sculpted, auto-skinned monster flesh for tactical combat.
 *
 * The body of a monster is described as signed-distance primitives (ellipsoid
 * muscle masses, tapered limbs, snouts, brows, horns, ears...) placed on the
 * figure's bind-pose skeleton. Primitives of one layer melt together with a
 * smooth union, so a kobold is one continuous scaly hide rather than a chain of
 * capsules; clothing layers (pants, jerkins, mail) are grown copies of the body
 * clipped to shape. The field is meshed once per species (surface nets, see
 * ui/components/sdfSculpt.js) and every vertex is skinned to the bones whose
 * primitives it lies on, blended across joints (soft-min of the primitive
 * distances), so elbows, knees, necks and tails bend smoothly.
 *
 * Rigid kit (weapons, shields, helmets, straps, eyes) stays as bone-attached
 * parts (rig.js), so per-individual gear costs nothing extra.
 */

export const PAT = { skin: 0, scales: 1, fur: 2, cloth: 3, bone: 4, leather: 5, smooth: 6, spots: 7, metal: 8, mail: 9 };

const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

const CACHE = new Map();

class Builder {
  constructor() {
    this.sc = new Sculpt();
    this.tags = [];
    this.mats = {};
  }

  mat(name, hex, o = {}) {
    this.mats[name] = this.sc.material({ color: lin(hex), rough: o.rough ?? 0.75, metal: o.metal ?? 0, pattern: PAT[o.pattern ?? 'skin'], edge: o.edge ?? 0.35, wash: o.wash ?? 0.7, soft: o.soft ?? 0.006 });
    return this;
  }

  _o(o = {}) {
    return { ...o, mat: this.mats[o.mat ?? 'skin'] ?? 0 };
  }

  _t(i, bone) {
    this.tags[i] = bone;
    return i;
  }

  ell(bone, c, r, o = {}) {
    return this._t(this.sc.ellipsoid(c, r, o.R ?? M_ID, this._o(o)), bone);
  }

  sph(bone, c, r, o = {}) {
    return this._t(this.sc.ellipsoid(c, [r, r, r], M_ID, this._o(o)), bone);
  }

  cone(bone, a, b, ra, rb, o = {}) {
    return this._t(this.sc.cone(a, b, ra, rb, this._o(o)), bone);
  }

  box(bone, c, hh, o = {}) {
    return this._t(this.sc.box(c, hh, o.R ?? M_ID, o.rr ?? 0.004, this._o(o)), bone);
  }
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hashf = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ------------------------------------------------------------------ species looks
/** Colours / patterns per species (hide, accent, belly, horn, cloth). */
export const LOOKS = {
  kobold: { skin: [0x6e3a20, 'scales'], back: [0x2e1810, 'scales'], belly: [0xb08050, 'scales'], horn: 0xa89068, cloth: 0x4a3a28, head: 'kobold' },
  goblin: { skin: [0x86963a, 'skin'], back: [0x5a6a26, 'skin'], belly: [0xa0aa60, 'skin'], horn: 0xd8c8a0, cloth: 0x4a3020, head: 'goblin', pants: 0x3a2a1a },
  orc: { skin: [0x464a38, 'skin'], back: [0x2a2c22, 'skin'], belly: [0x56584a, 'skin'], horn: 0xa89a7c, cloth: 0x2e2418, head: 'orc', pants: 0x2a221a, jerkin: 0x2a1c12, plate: 0x3e3630, hair: 0x0e0c0a },
  hobgoblin: { skin: [0xb0582a, 'skin'], back: [0x7a3618, 'skin'], belly: [0xc0703a, 'skin'], horn: 0xe0d0b0, cloth: 0x5a1e18, head: 'hobgoblin', pants: 0x3a2018, mail: 0x8a8070, hair: 0x1e1a18, nose: 0x5a3a5a },
  gnoll: { skin: [0xa88450, 'spots'], back: [0x6a5030, 'fur'], belly: [0xc8a878, 'fur'], horn: 0xe0d4b0, cloth: 0x3a2e22, head: 'gnoll', hair: 0x2a1a10, pants: 0x3a2e22 },
  bugbear: { skin: [0x7a5a30, 'fur'], back: [0x4a3418, 'fur'], belly: [0x9a7a50, 'fur'], horn: 0xd8c8a0, cloth: 0x3a2a1a, head: 'bugbear', hair: 0x2a1a0a, pants: 0x3a2a1a },
  lizardMan: { skin: [0x4a6a3a, 'scales'], back: [0x2e4a26, 'scales'], belly: [0xb0b07a, 'scales'], horn: 0xd8d0a0, cloth: 0x4a3a20, head: 'lizard' },
  skeleton: { skin: [0xbfb08e, 'bone'], back: [0x9a8a6a, 'bone'], belly: [0xbfb08e, 'bone'], horn: 0xe8e0c8, head: 'skull', shirt: 0x3a3028 },
  zombie: { skin: [0x7a8466, 'skin'], back: [0x5a6450, 'skin'], belly: [0x8a9070, 'skin'], horn: 0xd8d0b0, cloth: 0x3a3a30, head: 'zombie', pants: 0x2e2c26, shirt: 0x4a4438, hair: 0x2a2620 },
  ghoul: { skin: [0x9a9a88, 'skin'], back: [0x6a6a5c, 'skin'], belly: [0xa8a898, 'skin'], horn: 0xe0d8c0, cloth: 0x2a2a28, head: 'ghoul', pants: 0x2a2a28, hair: 0x1a1a18 },
  ogre: { skin: [0xa08a5a, 'skin'], back: [0x7a6a42, 'skin'], belly: [0xb09a6a, 'skin'], horn: 0xd8c8a0, cloth: 0x4a3a28, head: 'ogre', pants: 0x4a3a28, hair: 0x2a1e12 },
  troll: { skin: [0x4e6e3e, 'skin'], back: [0x34502a, 'skin'], belly: [0x6a8250, 'skin'], horn: 0x3a3024, cloth: 0x2a2a1a, head: 'troll', hair: 0x1e2a14 },
};

/**
 * Mesh (or fetch from cache) the sculpted flesh of a biped.
 * @param {string} key   cache key (species + build)
 * @param {object} o     {species, J: joint positions by bone name (bind pose), s, w, hs, armLen, legW, bw, hunch, tail, belly, digitigrade, thickNeck, claws, kit}
 * @returns {{geometry: THREE.BufferGeometry, names: string[], eyes: number[][]|null, eyeR: number}}
 */
export function sculptedFlesh(key, o) {
  if (CACHE.has(key)) return CACHE.get(key);
  const look = LOOKS[o.species] ?? LOOKS.orc;
  const B = new Builder();
  B.mat('skin', look.skin[0], { pattern: look.skin[1], rough: look.skin[1] === 'scales' ? 0.5 : 0.7 })
    .mat('back', look.back[0], { pattern: look.back[1], rough: 0.6 })
    .mat('belly', look.belly[0], { pattern: look.belly[1], rough: 0.65, edge: 0.2 })
    .mat('horn', look.horn, { pattern: 'smooth', rough: 0.55, edge: 0.25, wash: 0.9 })
    .mat('tooth', 0xb4a688, { pattern: 'smooth', rough: 0.55, edge: 0.3, wash: 0.6 })
    .mat('dark', 0x1a0e0a, { pattern: 'smooth', rough: 0.5, edge: 0, wash: 0.2 })
    .mat('mouth', 0x3a0e0a, { pattern: 'smooth', rough: 0.4, edge: 0, wash: 0.4 })
    .mat('hair', look.hair ?? 0x1a120c, { pattern: 'fur', rough: 0.9, edge: 0.5, wash: 0.8 })
    .mat('cloth', look.pants ?? look.cloth ?? 0x3a3024, { pattern: 'cloth', rough: 0.92, edge: 0.4, wash: 0.8 })
    .mat('leather', look.jerkin ?? 0x3a2618, { pattern: 'leather', rough: 0.6, edge: 0.6, wash: 0.8 })
    .mat('shirt', look.shirt ?? 0x4a4438, { pattern: 'cloth', rough: 0.95, edge: 0.4, wash: 0.9 })
    .mat('mail', look.mail ?? 0x8a8070, { pattern: 'mail', rough: 0.45, metal: 0.7, edge: 0.6, wash: 0.8 })
    .mat('plate', look.plate ?? 0x6a4a34, { pattern: 'metal', rough: 0.78, metal: 0.4, edge: 0.9, wash: 0.9 })
    .mat('nose', look.nose ?? look.back[0], { pattern: 'skin', rough: 0.5 });
  const res = o.species === 'skeleton' ? skeletonBody(B, o) : fleshBody(B, o, look);
  const geometry = toGeometry(B, o, res);
  const out = { geometry, names: res.names, eyes: res.eyes, eyeR: res.eyeR };
  CACHE.set(key, out);
  return out;
}

// ------------------------------------------------------------------ bodies
function fleshBody(B, o, look) {
  const { J, s, w } = o;
  const bw = o.bw;
  const lw = o.legW;
  const sp = o.species;
  const K = 0.045 * s;
  const G = { torso: 0, armL: 1, armR: 2, legL: 3, legR: 4, hard: 5, hair: 6, pantsL: 7, pantsR: 8, jerkin: 9, plate: 10, sleeveL: 11, sleeveR: 12 };
  const bk = o.belly ? 1.35 : 1;
  const scaly = look.skin[1] === 'scales';
  // ---- torso: pelvis, glutes, abdomen, ribcage, pecs, traps — one smooth mass.
  const T = { k: K, g: G.torso };
  B.ell('hips', add(J.hips, [0, -0.01 * s, -0.005 * s]), [0.15 * w * s, 0.1 * s, 0.115 * s], T);
  for (const sx of [1, -1]) B.ell('hips', add(J.hips, [sx * 0.065 * w * s, -0.045 * s, -0.05 * s]), [0.075 * s, 0.08 * s, 0.07 * s], T);
  B.ell('spine', add(J.spine, [0, 0.07 * s, 0.012 * s]), [0.138 * w * bk * s, 0.12 * s, 0.112 * bk * s], T);
  B.ell('chest', add(J.chest, [0, 0.085 * s, 0]), [0.17 * w * s, 0.15 * s, 0.122 * s], T);
  for (const sx of [1, -1]) B.ell('chest', add(J.chest, [sx * 0.072 * w * s, 0.12 * s, 0.062 * s]), [0.082 * w * s, 0.068 * s, 0.058 * s], T);
  B.ell('chest', add(J.chest, [0, 0.19 * s, -0.025 * s]), [0.15 * w * s, 0.062 * s, 0.085 * s], T);
  for (const sx of [1, -1]) {
    // Lats flare from the armpits into the waist.
    B.ell('chest', add(J.chest, [sx * 0.12 * w * s, 0.06 * s, -0.03 * s]), [0.06 * s, 0.12 * s, 0.08 * s], T);
  }
  // Brutes: a thick yoke of trapezius so the head sits low between the shoulders.
  if (sp === 'orc' || sp === 'ogre' || sp === 'troll') {
    B.ell('chest', add(J.chest, [0, 0.225 * s, -0.045 * s]), [0.15 * w * s, 0.085 * s, 0.085 * s], T);
    for (const sx of [1, -1]) B.ell('chest', add(J.chest, [sx * 0.1 * w * s, 0.2 * s, -0.02 * s]), [0.075 * s, 0.07 * s, 0.075 * s], T);
  }
  if (o.belly) B.ell('spine', add(J.spine, [0, 0.07 * s, 0.075 * s]), [0.19 * w * s, 0.17 * s, 0.15 * s], { ...T, mat: 'belly' });
  // Belly / chest plate colour (reptiles' pale scutes, furred chests).
  if (sp === 'kobold' || sp === 'lizardMan') {
    B.ell('spine', add(J.spine, [0, 0.08 * s, 0.06 * s]), [0.1 * w * s, 0.13 * s, 0.065 * s], { k: 0.02 * s, g: G.torso, mat: 'belly' });
    B.ell('chest', add(J.chest, [0, 0.07 * s, 0.07 * s]), [0.11 * w * s, 0.12 * s, 0.065 * s], { k: 0.02 * s, g: G.torso, mat: 'belly' });
  }
  // Deltoids melt the shoulder into the arm (weighted to the upper arm).
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    B.ell(`upperArm${side}`, add(J[`upperArm${side}`], [sx * 0.01 * s, -0.015 * s, 0]), [0.068 * bw * s, 0.08 * bw * s, 0.07 * bw * s], T);
  }
  // Neck.
  const neckR = (o.thickNeck ? 0.072 : 0.056) * s * Math.sqrt(w);
  B.cone('neck', add(J.neck, [0, -0.04 * s, -0.01 * s]), add(J.head, [0, 0.04 * s, o.thickNeck ? 0.02 * s : 0]), neckR * 1.15, neckR, T);
  // Dorsal back colour (darker hide down the spine) and spines for reptiles.
  B.ell('chest', add(J.chest, [0, 0.12 * s, -0.075 * s]), [0.1 * w * s, 0.14 * s, 0.06 * s], { k: 0.03 * s, g: G.torso, mat: 'back' });
  B.ell('spine', add(J.spine, [0, 0.06 * s, -0.07 * s]), [0.08 * w * s, 0.12 * s, 0.055 * s], { k: 0.03 * s, g: G.torso, mat: 'back' });
  if (scaly || sp === 'gnoll') {
    for (let k = 0; k < 6; k++) {
      const y = J.neck[1] + 0.02 * s - k * 0.075 * s;
      const z = -0.1 * s - Math.sin(k * 0.5) * 0.015 * s;
      B.cone(k < 3 ? 'chest' : 'spine', [0, y, z + 0.03 * s], [0, y + 0.02 * s, z - (sp === 'gnoll' ? 0.04 : 0.055) * s], 0.022 * s, 0.003 * s, { k: 0.012 * s, g: G.torso, mat: sp === 'gnoll' ? 'hair' : 'back' });
    }
  }
  // ---- arms
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const g = side === 'L' ? G.armL : G.armR;
    const A = { k: 0.03 * s, g };
    const ua = J[`upperArm${side}`];
    const fa = J[`foreArm${side}`];
    const ha = J[`hand${side}`];
    B.cone(`upperArm${side}`, add(ua, [0, -0.02 * s, 0]), fa, 0.054 * bw * s, 0.042 * bw * s, A);
    B.ell(`upperArm${side}`, add(mid(ua, fa, 0.45), [0, 0, 0.014 * s]), [0.048 * bw * s, 0.085 * bw * s, 0.05 * bw * s], A);
    B.ell(`upperArm${side}`, add(mid(ua, fa, 0.5), [0, 0, -0.018 * s]), [0.045 * bw * s, 0.08 * bw * s, 0.045 * bw * s], A);
    B.cone(`foreArm${side}`, fa, add(ha, [0, 0.01 * s, 0]), 0.045 * bw * s, 0.032 * bw * s, A);
    B.ell(`foreArm${side}`, add(fa, [sx * 0.008 * s, -0.065 * s, 0.006 * s]), [0.048 * bw * s, 0.08 * bw * s, 0.043 * bw * s], A);
    // Fist (weapons are gripped along +z) and thumb.
    B.ell(`hand${side}`, add(ha, [0, -0.048 * s, 0.01 * s]), [0.04 * bw * s, 0.05 * bw * s, 0.038 * bw * s], A);
    B.cone(`hand${side}`, add(ha, [sx * -0.026 * s, -0.03 * s, 0.02 * s]), add(ha, [sx * -0.022 * s, -0.06 * s, 0.045 * s]), 0.014 * s, 0.011 * s, A);
    if (o.claws || scaly || sp === 'gnoll') {
      for (let k = 0; k < 3; k++) {
        const base = add(ha, [(k - 1) * 0.022 * s, -0.085 * s, 0.035 * s]);
        B.cone(`hand${side}`, base, add(base, [0, -0.01 * s, 0.035 * s * (o.claws ? 1.8 : 1)]), 0.009 * s, 0.002 * s, { g: G.hard, mat: 'horn' });
      }
    }
    // Sleeves (mail shirts, shirts): grown upper-arm, clipped at the elbow.
    if (o.kit.armor === 'scale' || o.kit.tattered) {
      const cut = mid(ua, fa, o.kit.armor === 'scale' ? 0.55 : 0.75)[1];
      B.cone(`upperArm${side}`, add(ua, [0, 0.01 * s, 0]), fa, 0.06 * bw * s, 0.05 * bw * s, { g: side === 'L' ? G.sleeveL : G.sleeveR, k: 0.02 * s, grow: 0.01 * s, mat: o.kit.armor === 'scale' ? 'mail' : 'shirt', clip: [[0, -1, 0, -cut]] });
    }
  }
  // ---- legs
  const pants = !!look.pants && !['kobold', 'lizardMan'].includes(sp) && o.kit.armor !== 'loincloth';
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const g = side === 'L' ? G.legL : G.legR;
    const L = { k: 0.03 * s, g };
    const th = J[`thigh${side}`];
    const sh = J[`shin${side}`];
    const ft = J[`foot${side}`];
    B.cone(`thigh${side}`, add(th, [0, 0.03 * s, 0]), sh, 0.082 * lw * s, 0.056 * lw * s, L);
    B.ell(`thigh${side}`, add(mid(th, sh, 0.42), [sx * 0.008 * s, 0, 0.02 * s]), [0.07 * lw * s, 0.14 * lw * s, 0.068 * lw * s], L);
    B.sph(`shin${side}`, add(sh, [0, 0, 0.008 * s]), 0.056 * lw * s, L);
    B.cone(`shin${side}`, sh, add(ft, [0, 0.01 * s, 0]), 0.056 * lw * s, 0.038 * lw * s, L);
    B.ell(`shin${side}`, add(sh, [0, -0.12 * s, -0.025 * s]), [0.052 * lw * s, 0.1 * s, 0.052 * lw * s], L);
    if (o.digitigrade) {
      // Long clawed lizard / hyena foot: a raised heel and splayed toes.
      B.ell(`foot${side}`, add(ft, [0, -0.035 * s, 0.05 * s]), [0.042 * s, 0.03 * s, 0.1 * s], L);
      B.sph(`foot${side}`, add(ft, [0, -0.01 * s, -0.025 * s]), 0.036 * s, L);
      for (let k = 0; k < 3; k++) {
        const base = add(ft, [(k - 1) * 0.026 * s, -0.05 * s, 0.13 * s]);
        B.cone(`foot${side}`, add(base, [0, 0.008 * s, -0.04 * s]), base, 0.016 * s, 0.012 * s, L);
        B.cone(`foot${side}`, base, add(base, [(k - 1) * 0.006 * s, -0.012 * s, 0.035 * s]), 0.009 * s, 0.002 * s, { g: G.hard, mat: 'horn' });
      }
    } else {
      B.ell(`foot${side}`, add(ft, [0, -0.04 * s, 0.05 * s]), [0.05 * bw * s, 0.036 * s, 0.115 * s], L);
      B.sph(`foot${side}`, add(ft, [0, -0.02 * s, -0.02 * s]), 0.04 * s, L);
    }
    if (pants) {
      const P = { g: side === 'L' ? G.pantsL : G.pantsR, k: 0.03 * s, grow: 0.012 * s, mat: 'cloth' };
      const ank = ft[1] + 0.1 * s;
      B.cone(`thigh${side}`, add(th, [0, 0.05 * s, 0]), sh, 0.084 * lw * s, 0.058 * lw * s, { ...P, clip: [[0, -1, 0, -ank]] });
      B.ell(`thigh${side}`, add(mid(th, sh, 0.42), [sx * 0.008 * s, 0, 0.02 * s]), [0.07 * lw * s, 0.14 * lw * s, 0.068 * lw * s], { ...P, clip: [[0, -1, 0, -ank]] });
      B.cone(`shin${side}`, sh, add(ft, [0, 0.02 * s, 0]), 0.06 * lw * s, 0.046 * lw * s, { ...P, clip: [[0, -1, 0, -ank]] });
      // Rolled cuff.
      B.cone(`shin${side}`, [ft[0], ank + 0.012 * s, ft[2]], [ft[0], ank - 0.005 * s, ft[2]], 0.052 * lw * s, 0.052 * lw * s, { ...P, grow: 0.006 * s });
    }
  }
  // Pants seat (one piece across the hips).
  if (pants) B.ell('hips', add(J.hips, [0, -0.03 * s, -0.005 * s]), [0.158 * w * s, 0.1 * s, 0.12 * s], { g: G.pantsL, k: 0.03 * s, grow: 0.01 * s, mat: 'cloth', clip: [[0, 1, 0, J.hips[1] + 0.06 * s]] });
  // ---- torso clothing
  const jerkin = (mat, g, grow, top, bottom, front = null) => {
    const clip = [[0, 1, 0, top], [0, -1, 0, -bottom]];
    if (front !== null) clip.push([0, 0, -1, -front]);
    const C = { g, k: K, grow, mat, clip, clipK: 0.01 * s };
    B.ell('spine', add(J.spine, [0, 0.07 * s, 0.012 * s]), [0.138 * w * bk * s, 0.12 * s, 0.112 * bk * s], C);
    B.ell('chest', add(J.chest, [0, 0.085 * s, 0]), [0.17 * w * s, 0.15 * s, 0.122 * s], C);
    for (const sx of [1, -1]) B.ell('chest', add(J.chest, [sx * 0.072 * w * s, 0.12 * s, 0.062 * s]), [0.082 * w * s, 0.068 * s, 0.058 * s], C);
    B.ell('chest', add(J.chest, [0, 0.19 * s, -0.025 * s]), [0.15 * w * s, 0.062 * s, 0.085 * s], C);
    for (const sx of [1, -1]) B.ell('chest', add(J.chest, [sx * 0.12 * w * s, 0.06 * s, -0.03 * s]), [0.06 * s, 0.12 * s, 0.08 * s], C);
    B.ell('hips', add(J.hips, [0, 0.0 * s, -0.005 * s]), [0.152 * w * s, 0.1 * s, 0.115 * s], C);
  };
  if (o.kit.armor === 'orcish') {
    jerkin('leather', G.jerkin, 0.012 * s, J.neck[1] - 0.03 * s, J.hips[1] - 0.05 * s);
    // A dented, rusty pauldron on the weapon shoulder (sculpted over the deltoid).
    for (const [side, sx] of [['R', -1], ['L', 1]]) {
      if (side === 'L' && (o.kit.variant ?? 0) < 0.5) continue;
      const sh = J[`upperArm${side}`];
      const P = { g: G.plate, k: 0.01 * s, mat: 'plate', clip: [[0, -1, 0, -(sh[1] - 0.07 * s)]], clipK: 0.006 * s };
      B.ell(`upperArm${side}`, add(sh, [sx * 0.015 * s, 0.0, 0]), [0.085 * s, 0.075 * s, 0.085 * s], { ...P, R: mEuler(0, 0, sx * 0.35) });
      B.ell(`upperArm${side}`, add(sh, [sx * 0.03 * s, -0.04 * s, 0]), [0.075 * s, 0.05 * s, 0.08 * s], { ...P, clip: [[0, -1, 0, -(sh[1] - 0.1 * s)]], R: mEuler(0, 0, sx * 0.5) });
    }
    if ((o.kit.variant ?? 0) < 0.75 || true) jerkin('plate', G.plate, 0.03 * s, J.neck[1] - 0.05 * s, J.spine[1] + 0.02 * s, 0.03 * s);
  } else if (o.kit.armor === 'scale') {
    jerkin('mail', G.jerkin, 0.014 * s, J.neck[1] - 0.025 * s, J.hips[1] - 0.12 * s);
  } else if (o.kit.tattered) {
    jerkin('shirt', G.jerkin, 0.01 * s, J.neck[1] - 0.04 * s, J.hips[1] - 0.1 * s);
  } else if (o.kit.armor === 'scraps') {
    jerkin('leather', G.jerkin, 0.012 * s, J.chest[1] + 0.2 * s, J.chest[1] + 0.02 * s);
  }
  // ---- tail (one smooth mass with the pelvis)
  if (o.tail) {
    const tk = o.tail === 'long' ? 1.35 : 1;
    const t1 = J.tail1;
    const t2 = J.tail2;
    const t3 = J.tail3;
    const tip = add(t3, [0, -0.03 * s, -0.22 * s * tk]);
    const TT = { k: 0.04 * s, g: G.torso };
    B.cone('tail1', add(t1, [0, 0.02 * s, 0.05 * s]), t2, 0.07 * tk * s, 0.05 * tk * s, TT);
    B.cone('tail2', t2, t3, 0.05 * tk * s, 0.03 * tk * s, TT);
    B.cone('tail3', t3, tip, 0.03 * tk * s, 0.006 * s, TT);
    B.cone('tail1', add(t1, [0, 0.05 * s, -0.02 * s]), add(t2, [0, 0.04 * s, 0]), 0.03 * s, 0.025 * s, { ...TT, mat: 'back' });
    B.cone('tail2', add(t2, [0, 0.03 * s, 0]), add(t3, [0, 0.022 * s, 0]), 0.025 * s, 0.015 * s, { ...TT, mat: 'back' });
    for (let k = 0; k < 5; k++) {
      const p = k < 2 ? mid(t1, t2, 0.3 + k * 0.4) : k < 4 ? mid(t2, t3, (k - 2) * 0.5 + 0.2) : mid(t3, tip, 0.3);
      const r = (0.065 - k * 0.011) * tk * s;
      B.cone(k < 2 ? 'tail1' : k < 4 ? 'tail2' : 'tail3', add(p, [0, r * 0.6, 0]), add(p, [0, r * 1.25, -r * 0.6]), 0.014 * s, 0.002 * s, { k: 0.01 * s, g: G.torso, mat: 'back' });
    }
  }
  // ---- head
  const hd = HEADS[look.head] ?? HEADS.orc;
  const H = (x, y, z) => add(J.head, [x * o.hs, y * o.hs, z * o.hs]);
  const eyes = hd(B, H, o.hs, { K: 0.03 * o.hs, G, o, s });
  return { names: Object.keys(J), eyes: eyes.eyes, eyeR: eyes.r };
}

// ------------------------------------------------------------------ heads (head-joint local, units of head scale)
const HEADS = {
  kobold(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    // Big round skull, heavy cheeks, a long blunt dog-lizard snout.
    B.ell('head', H(0, 0.1, -0.02), [0.088 * hs, 0.082 * hs, 0.096 * hs], T);
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.045, 0.075, 0.035), [0.04 * hs, 0.04 * hs, 0.05 * hs], T);
    B.cone('head', H(0, 0.096, 0.04), H(0, 0.074, 0.222), 0.054 * hs, 0.032 * hs, T);
    B.cone('head', H(0, 0.12, 0.02), H(0, 0.094, 0.18), 0.03 * hs, 0.022 * hs, { ...T, mat: 'back' });
    B.cone('head', H(0, 0.044, 0.03), H(0, 0.044, 0.196), 0.04 * hs, 0.022 * hs, { ...T, mat: 'belly' });
    // Mouth line + nostrils + eye sockets carved.
    B.box('head', H(0, 0.06, 0.15), [0.05 * hs, 0.0045 * hs, 0.075 * hs], { g: G.torso, sub: true, k: 0.004 * hs, R: mEuler(-0.08, 0, 0) });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.015, 0.088, 0.222), 0.008 * hs, { g: G.torso, sub: true, k: 0.004 * hs });
      B.sph('head', H(sx * 0.042, 0.112, 0.07), 0.02 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
    }
    // Heavy brow ridges.
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.042, 0.13, 0.068), [0.032 * hs, 0.016 * hs, 0.03 * hs], { ...T, k: 0.012 * hs, mat: 'back' });
    // Horns sweeping back, ear frills, a crest of spines.
    for (const sx of [1, -1]) {
      B.cone('head', H(sx * 0.042, 0.158, -0.02), H(sx * 0.07, 0.205, -0.115), 0.022 * hs, 0.011 * hs, { g: G.hard, k: 0.01 * hs, mat: 'horn' });
      B.cone('head', H(sx * 0.07, 0.205, -0.115), H(sx * 0.08, 0.2, -0.19), 0.011 * hs, 0.003 * hs, { g: G.hard, k: 0.01 * hs, mat: 'horn' });
      B.ell('head', H(sx * 0.088, 0.1, -0.045), [0.012 * hs, 0.052 * hs, 0.042 * hs], { ...T, k: 0.012 * hs, mat: 'back', R: mEuler(0.3, 0, sx * 0.55) });
      // Teeth along the upper jaw.
      for (let k = 0; k < 4; k++) B.cone('head', H(sx * 0.028, 0.064, 0.1 + k * 0.03), H(sx * 0.026, 0.046, 0.102 + k * 0.03), 0.006 * hs, 0.0015 * hs, { g: G.hard, mat: 'tooth' });
    }
    for (let k = 0; k < 4; k++) B.cone('head', H(0, 0.165 - k * 0.025, -0.06 - k * 0.035), H(0, 0.19 - k * 0.03, -0.1 - k * 0.04), 0.016 * hs, 0.003 * hs, { k: 0.01 * hs, g: G.torso, mat: 'back' });
    return { eyes: [[0.042, 0.112, 0.072], [-0.042, 0.112, 0.072]], r: 0.015 };
  },
  lizard(B, H, hs, ctx) {
    return HEADS.kobold(B, H, hs, ctx);
  },
  goblin(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.1, 0), [0.1 * hs, 0.088 * hs, 0.095 * hs], T);
    B.ell('head', H(0, 0.055, 0.04), [0.072 * hs, 0.045 * hs, 0.06 * hs], T);
    B.cone('head', H(0, 0.1, 0.08), H(0, 0.075, 0.15), 0.022 * hs, 0.01 * hs, T);
    for (const sx of [1, -1]) {
      B.ell('head', H(sx * 0.15, 0.115, -0.02), [0.07 * hs, 0.026 * hs, 0.012 * hs], { ...T, k: 0.02 * hs, R: mEuler(0, 0.3 * sx, sx * -0.3) });
      B.sph('head', H(sx * 0.04, 0.11, 0.082), 0.02 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      B.ell('head', H(sx * 0.04, 0.128, 0.078), [0.03 * hs, 0.012 * hs, 0.02 * hs], { ...T, k: 0.01 * hs, mat: 'back' });
    }
    B.box('head', H(0, 0.045, 0.09), [0.04 * hs, 0.004 * hs, 0.02 * hs], { g: G.torso, sub: true, k: 0.004 * hs });
    for (let k = -2; k <= 2; k++) B.cone('head', H(k * 0.014, 0.05, 0.095), H(k * 0.014, 0.036, 0.097), 0.005 * hs, 0.001 * hs, { g: G.hard, mat: 'tooth' });
    return { eyes: [[0.04, 0.11, 0.084], [-0.04, 0.11, 0.084]], r: 0.016 };
  },
  orc(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    // Low sloped cranium, a jutting underbite jaw, brow shelf, flat broad nose.
    B.ell('head', H(0, 0.112, -0.022), [0.094 * hs, 0.082 * hs, 0.1 * hs], T);
    B.ell('head', H(0, 0.06, 0.04), [0.086 * hs, 0.052 * hs, 0.07 * hs], T);
    B.box('head', H(0, 0.032, 0.075), [0.062 * hs, 0.028 * hs, 0.036 * hs], { ...T, rr: 0.022 * hs, R: mEuler(-0.15, 0, 0) });
    // Heavy, knotted brow shelf that shadows the eyes.
    B.ell('head', H(0, 0.126, 0.084), [0.1 * hs, 0.03 * hs, 0.04 * hs], { ...T, k: 0.018 * hs, mat: 'back' });
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.042, 0.13, 0.1), [0.036 * hs, 0.02 * hs, 0.026 * hs], { ...T, k: 0.012 * hs, mat: 'back', R: mEuler(0, 0, sx * -0.25) });
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.05, 0.094, 0.075), [0.032 * hs, 0.022 * hs, 0.026 * hs], { ...T, k: 0.014 * hs });
    B.ell('head', H(0, 0.09, 0.112), [0.028 * hs, 0.024 * hs, 0.024 * hs], { ...T, k: 0.012 * hs });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.012, 0.078, 0.13), 0.007 * hs, { g: G.torso, sub: true, k: 0.003 * hs });
      B.sph('head', H(sx * 0.04, 0.108, 0.092), 0.019 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      // Swept-back pointed ears.
      B.ell('head', H(sx * 0.098, 0.108, -0.015), [0.013 * hs, 0.032 * hs, 0.06 * hs], { ...T, k: 0.012 * hs, R: mEuler(-0.55, sx * 0.35, 0) });
      // (Tusks are rigid kit parts — too fine for the sculpt grid; see models.js.)
    }
    B.box('head', H(0, 0.052, 0.108), [0.046 * hs, 0.004 * hs, 0.02 * hs], { g: G.torso, sub: true, k: 0.003 * hs });
    // Greasy black topknot.
    B.cone('head', H(0, 0.19, -0.03), H(0, 0.2, -0.1), 0.03 * hs, 0.022 * hs, { g: G.hair, k: 0.02 * hs, mat: 'hair' });
    B.cone('head', H(0, 0.2, -0.1), H(0, 0.13, -0.18), 0.022 * hs, 0.01 * hs, { g: G.hair, k: 0.02 * hs, mat: 'hair' });
    return { eyes: [[0.04, 0.108, 0.094], [-0.04, 0.108, 0.094]], r: 0.012 };
  },
  hobgoblin(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.112, -0.015), [0.09 * hs, 0.086 * hs, 0.095 * hs], T);
    B.ell('head', H(0, 0.058, 0.038), [0.078 * hs, 0.052 * hs, 0.066 * hs], T);
    B.ell('head', H(0, 0.132, 0.072), [0.084 * hs, 0.022 * hs, 0.032 * hs], { ...T, k: 0.016 * hs, mat: 'back' });
    // A big, flushed nose.
    B.cone('head', H(0, 0.118, 0.09), H(0, 0.082, 0.13), 0.02 * hs, 0.022 * hs, { ...T, k: 0.012 * hs, mat: 'nose' });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.038, 0.108, 0.085), 0.019 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      // Large pointed ears jutting out sideways: they read from above.
      B.ell('head', H(sx * 0.13, 0.13, -0.025), [0.07 * hs, 0.03 * hs, 0.012 * hs], { ...T, k: 0.018 * hs, R: mEuler(0, sx * 0.25, sx * -0.4) });
      B.cone('head', H(sx * 0.03, 0.045, 0.098), H(sx * 0.034, 0.075, 0.104), 0.008 * hs, 0.002 * hs, { g: G.hard, mat: 'tooth' });
    }
    B.box('head', H(0, 0.05, 0.1), [0.042 * hs, 0.004 * hs, 0.02 * hs], { g: G.torso, sub: true, k: 0.003 * hs });
    // Dark-grey hair: a swept crest and a short beard.
    B.ell('head', H(0, 0.17, -0.03), [0.04 * hs, 0.035 * hs, 0.1 * hs], { g: G.hair, k: 0.02 * hs, mat: 'hair' });
    B.ell('head', H(0, 0.04, 0.062), [0.062 * hs, 0.03 * hs, 0.04 * hs], { g: G.hair, k: 0.02 * hs, mat: 'hair' });
    return { eyes: [[0.038, 0.108, 0.087], [-0.038, 0.108, 0.087]], r: 0.012 };
  },
  gnoll(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.112, -0.03), [0.085 * hs, 0.085 * hs, 0.09 * hs], T);
    B.cone('head', H(0, 0.095, 0.03), H(0, 0.076, 0.24), 0.056 * hs, 0.033 * hs, T);
    B.cone('head', H(0, 0.046, 0.02), H(0, 0.046, 0.205), 0.038 * hs, 0.022 * hs, { ...T, mat: 'belly' });
    B.ell('head', H(0, 0.082, 0.235), [0.03 * hs, 0.026 * hs, 0.026 * hs], { ...T, k: 0.01 * hs, mat: 'dark' });
    B.cone('head', H(0, 0.11, 0.06), H(0, 0.094, 0.2), 0.032 * hs, 0.022 * hs, { ...T, mat: 'back' });
    B.box('head', H(0, 0.062, 0.16), [0.05 * hs, 0.0045 * hs, 0.075 * hs], { g: G.torso, sub: true, k: 0.004 * hs, R: mEuler(-0.08, 0, 0) });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.04, 0.118, 0.07), 0.018 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      // Round upright hyena ears.
      B.ell('head', H(sx * 0.062, 0.2, -0.045), [0.036 * hs, 0.048 * hs, 0.012 * hs], { ...T, k: 0.012 * hs, mat: 'back', R: mEuler(-0.2, sx * 0.2, sx * -0.35) });
      for (let k = 0; k < 3; k++) B.cone('head', H(sx * 0.03, 0.066, 0.12 + k * 0.03), H(sx * 0.028, 0.048, 0.122 + k * 0.03), 0.006 * hs, 0.0015 * hs, { g: G.hard, mat: 'tooth' });
    }
    // Shaggy mane down the neck.
    B.cone('head', H(0, 0.17, -0.06), H(0, -0.12, -0.14), 0.04 * hs, 0.05 * hs, { g: G.hair, k: 0.03 * hs, mat: 'hair' });
    return { eyes: [[0.04, 0.118, 0.072], [-0.04, 0.118, 0.072]], r: 0.013 };
  },
  bugbear(B, H, hs, ctx) {
    const { K, G } = ctx;
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.11, -0.01), [0.1 * hs, 0.09 * hs, 0.1 * hs], T);
    B.cone('head', H(0, 0.085, 0.05), H(0, 0.07, 0.15), 0.05 * hs, 0.035 * hs, T);
    B.ell('head', H(0, 0.078, 0.15), [0.028 * hs, 0.022 * hs, 0.02 * hs], { ...T, k: 0.01 * hs, mat: 'dark' });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.042, 0.115, 0.085), 0.018 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      B.sph('head', H(sx * 0.07, 0.19, -0.03), 0.032 * hs, { ...T, k: 0.012 * hs, mat: 'back' });
      B.cone('head', H(sx * 0.03, 0.05, 0.12), H(sx * 0.032, 0.085, 0.13), 0.009 * hs, 0.002 * hs, { g: G.hard, mat: 'tooth' });
    }
    return { eyes: [[0.042, 0.115, 0.088], [-0.042, 0.115, 0.088]], r: 0.012 };
  },
  zombie(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.112, -0.005), [0.084 * hs, 0.095 * hs, 0.092 * hs], T);
    B.ell('head', H(0, 0.05, 0.035), [0.058 * hs, 0.05 * hs, 0.055 * hs], T);
    B.ell('head', H(0, 0.1, 0.085), [0.016 * hs, 0.026 * hs, 0.02 * hs], { ...T, k: 0.01 * hs });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.036, 0.112, 0.078), 0.022 * hs, { g: G.torso, sub: true, k: 0.01 * hs });
      B.ell('head', H(sx * 0.04, 0.07, 0.055), [0.02 * hs, 0.02 * hs, 0.02 * hs], { g: G.torso, sub: true, k: 0.012 * hs });
    }
    // Slack, gaping mouth.
    B.ell('head', H(0, 0.04, 0.085), [0.026 * hs, 0.018 * hs, 0.03 * hs], { g: G.torso, sub: true, k: 0.006 * hs });
    B.ell('head', H(0.01, 0.175, -0.035), [0.07 * hs, 0.035 * hs, 0.08 * hs], { g: G.hair, k: 0.02 * hs, mat: 'hair' });
    return { eyes: [[0.036, 0.112, 0.082], [-0.036, 0.112, 0.082]], r: 0.009 };
  },
  ghoul(B, H, hs, ctx) {
    const r = HEADS.zombie(B, H, hs, ctx);
    for (const sx of [1, -1]) ctx.o && B.cone('head', H(sx * 0.02, 0.05, 0.1), H(sx * 0.022, 0.025, 0.104), 0.006 * hs, 0.001 * hs, { g: ctx.G.hard, mat: 'tooth' });
    return r;
  },
  ogre(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.1, 0.0), [0.1 * hs, 0.085 * hs, 0.095 * hs], T);
    B.ell('head', H(0, 0.05, 0.05), [0.11 * hs, 0.06 * hs, 0.075 * hs], T);
    B.ell('head', H(0, 0.125, 0.075), [0.085 * hs, 0.022 * hs, 0.032 * hs], { ...T, k: 0.016 * hs, mat: 'back' });
    B.ell('head', H(0, 0.09, 0.11), [0.03 * hs, 0.028 * hs, 0.026 * hs], { ...T, k: 0.012 * hs });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.038, 0.108, 0.09), 0.016 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      B.ell('head', H(sx * 0.105, 0.1, 0.0), [0.018 * hs, 0.035 * hs, 0.03 * hs], { ...T, k: 0.012 * hs });
      B.cone('head', H(sx * 0.05, 0.04, 0.115), H(sx * 0.055, 0.08, 0.12), 0.012 * hs, 0.003 * hs, { g: G.hard, mat: 'tooth' });
    }
    B.box('head', H(0, 0.045, 0.118), [0.06 * hs, 0.004 * hs, 0.02 * hs], { g: G.torso, sub: true, k: 0.003 * hs });
    B.ell('head', H(0, 0.165, -0.02), [0.06 * hs, 0.03 * hs, 0.07 * hs], { g: G.hair, k: 0.02 * hs, mat: 'hair' });
    return { eyes: [[0.038, 0.108, 0.092], [-0.038, 0.108, 0.092]], r: 0.01 };
  },
  troll(B, H, hs, { K, G }) {
    const T = { k: K, g: G.torso };
    B.ell('head', H(0, 0.105, -0.01), [0.085 * hs, 0.1 * hs, 0.1 * hs], T);
    B.cone('head', H(0, 0.1, 0.08), H(0, 0.04, 0.2), 0.026 * hs, 0.018 * hs, { ...T, k: 0.014 * hs });
    B.ell('head', H(0, 0.03, 0.06), [0.06 * hs, 0.035 * hs, 0.06 * hs], T);
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.038, 0.12, 0.085), 0.018 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      B.ell('head', H(sx * 0.11, 0.11, -0.02), [0.06 * hs, 0.02 * hs, 0.01 * hs], { ...T, k: 0.014 * hs, R: mEuler(0, sx * 0.3, sx * -0.3) });
      for (let k = 0; k < 4; k++) B.sph('head', H(sx * (0.03 + hashf(k) * 0.04), 0.06 + hashf(k + 3) * 0.08, 0.06 + hashf(k + 7) * 0.03), 0.008 * hs, { ...T, k: 0.006 * hs, mat: 'back' });
    }
    for (let k = 0; k < 6; k++) B.cone('head', H((k - 2.5) * 0.022, 0.19, -0.02), H((k - 2.5) * 0.04, 0.1, -0.2), 0.016 * hs, 0.006 * hs, { g: G.hair, k: 0.012 * hs, mat: 'hair' });
    return { eyes: [[0.038, 0.12, 0.088], [-0.038, 0.12, 0.088]], r: 0.011 };
  },
  skull(B, H, hs, { G }) {
    const T = { k: 0.012 * hs, g: G.torso, mat: 'skin' };
    B.ell('head', H(0, 0.112, -0.01), [0.078 * hs, 0.085 * hs, 0.094 * hs], T);
    B.box('head', H(0, 0.06, 0.05), [0.048 * hs, 0.03 * hs, 0.038 * hs], { ...T, rr: 0.018 * hs });
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.05, 0.075, 0.045), [0.018 * hs, 0.016 * hs, 0.03 * hs], T);
    B.ell('head', H(0, 0.118, 0.07), [0.07 * hs, 0.02 * hs, 0.03 * hs], T);
    for (const sx of [1, -1]) B.sph('head', H(sx * 0.032, 0.1, 0.08), 0.024 * hs, { g: G.torso, sub: true, k: 0.006 * hs });
    B.cone('head', H(0, 0.075, 0.09), H(0, 0.06, 0.09), 0.012 * hs, 0.006 * hs, { g: G.torso, sub: true, k: 0.003 * hs });
    // Jaw (own layer → a crisp hinge line), teeth.
    B.box('head', H(0, 0.022, 0.05), [0.044 * hs, 0.014 * hs, 0.042 * hs], { g: G.hard, k: 0.006 * hs, rr: 0.012 * hs, mat: 'skin' });
    for (let k = 0; k < 6; k++) {
      const x = (k - 2.5) * 0.013;
      B.box('head', H(x, 0.037, 0.087 - Math.abs(x) * 0.6), [0.005 * hs, 0.008 * hs, 0.004 * hs], { g: G.hard, mat: 'tooth', rr: 0.002 * hs });
    }
    return { eyes: [[0.032, 0.1, 0.084], [-0.032, 0.1, 0.084]], r: 0.01 };
  },
};

// ------------------------------------------------------------------ skeleton
function skeletonBody(B, o) {
  const { J, s, w } = o;
  const G = { torso: 0, armL: 1, armR: 2, legL: 3, legR: 4, hard: 5, hair: 6 };
  const bone = { k: 0.008 * s, g: G.torso, mat: 'skin' };
  const R = 0.02 * s;
  // Spine: vertebrae from the pelvis to the skull.
  const back = -0.04 * s;
  const y0 = J.hips[1] + 0.02 * s;
  const y1 = J.head[1];
  for (let k = 0; k <= 11; k++) {
    const y = y0 + (y1 - y0) * (k / 11);
    const tag = y < J.spine[1] ? 'hips' : y < J.chest[1] ? 'spine' : y < J.neck[1] ? 'chest' : 'neck';
    const z = back + Math.sin((k / 11) * Math.PI) * -0.01 * s + (tag === 'neck' ? 0.03 * s : 0);
    B.ell(tag, [0, y, z], [0.022 * s, 0.014 * s, 0.02 * s], bone);
    B.cone(tag, [0, y, z], [0, y, z - 0.022 * s], 0.008 * s, 0.004 * s, bone);
  }
  // Pelvis bowl (iliac wings) with the hollow carved out.
  B.ell('hips', add(J.hips, [0, 0.0, 0]), [0.125 * w * s, 0.065 * s, 0.075 * s], bone);
  B.ell('hips', add(J.hips, [0, 0.03 * s, 0.01 * s]), [0.09 * w * s, 0.07 * s, 0.05 * s], { g: G.torso, sub: true, k: 0.01 * s });
  B.ell('hips', add(J.hips, [0, -0.05 * s, 0.03 * s]), [0.05 * s, 0.03 * s, 0.05 * s], { g: G.torso, sub: true, k: 0.01 * s });
  // Ribcage: curved ribs (clipped tori) from the spine round to the sternum.
  for (let k = 0; k < 6; k++) {
    const y = J.chest[1] + 0.02 * s + k * 0.036 * s;
    const rr = (0.125 - Math.abs(k - 2.2) * 0.012) * w * s;
    const tor = B.sc.torus([0, y, -0.005 * s], rr, 0.0125 * s, mEuler(-0.32, 0, 0), { mat: B.mats.skin, g: G.torso, k: 0.006 * s, clip: [[0, 0, 1, 0.075 * s], [0, 0, -1, 0.035 * s]] });
    B.tags[tor] = 'chest';
    void tor;
  }
  B.box('chest', add(J.chest, [0, 0.11 * s, 0.085 * s]), [0.014 * s, 0.085 * s, 0.008 * s], { ...bone, rr: 0.006 * s, R: mEuler(-0.25, 0, 0) });
  // Clavicles + shoulder blades.
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const sh = J[`upperArm${side}`];
    B.cone('chest', add(J.chest, [sx * 0.02 * s, 0.205 * s, 0.05 * s]), add(sh, [-sx * 0.01 * s, 0.01 * s, 0.01 * s]), 0.011 * s, 0.01 * s, bone);
    B.ell('chest', add(J.chest, [sx * 0.08 * s, 0.14 * s, -0.08 * s]), [0.05 * s, 0.06 * s, 0.01 * s], { ...bone, R: mEuler(0, sx * 0.4, 0) });
  }
  // Limb bones with knobbly joint ends.
  const longBone = (tag, a, b, g, r0 = R, r1 = R * 0.85) => {
    const L = { k: 0.01 * s, g, mat: 'skin' };
    B.cone(tag, a, b, r0, r1, L);
    B.sph(tag, mid(a, b, 0.06), r0 * 1.45, L);
    B.sph(tag, mid(a, b, 0.94), r1 * 1.45, L);
  };
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const gA = side === 'L' ? G.armL : G.armR;
    const gL = side === 'L' ? G.legL : G.legR;
    longBone(`upperArm${side}`, J[`upperArm${side}`], J[`foreArm${side}`], gA, 0.019 * s, 0.016 * s);
    longBone(`foreArm${side}`, J[`foreArm${side}`], J[`hand${side}`], gA, 0.015 * s, 0.013 * s);
    // Bony hand: a palm and four finger rays.
    const ha = J[`hand${side}`];
    B.box(`hand${side}`, add(ha, [0, -0.04 * s, 0.008 * s]), [0.03 * s, 0.03 * s, 0.012 * s], { k: 0.006 * s, g: gA, mat: 'skin', rr: 0.008 * s });
    for (let k = 0; k < 4; k++) B.cone(`hand${side}`, add(ha, [(k - 1.5) * 0.016 * s, -0.065 * s, 0.01 * s]), add(ha, [(k - 1.5) * 0.017 * s, -0.08 * s, 0.045 * s]), 0.006 * s, 0.004 * s, { k: 0.004 * s, g: gA, mat: 'skin' });
    longBone(`thigh${side}`, add(J[`thigh${side}`], [0, 0.01 * s, 0]), J[`shin${side}`], gL, 0.024 * s, 0.02 * s);
    longBone(`shin${side}`, J[`shin${side}`], J[`foot${side}`], gL, 0.02 * s, 0.016 * s);
    B.sph(`shin${side}`, add(J[`shin${side}`], [0, 0.01 * s, 0.025 * s]), 0.02 * s, { k: 0.008 * s, g: gL, mat: 'skin' });
    const ft = J[`foot${side}`];
    B.box(`foot${side}`, add(ft, [0, -0.035 * s, 0.03 * s]), [0.032 * s, 0.018 * s, 0.05 * s], { k: 0.008 * s, g: gL, mat: 'skin', rr: 0.012 * s });
    for (let k = 0; k < 4; k++) B.cone(`foot${side}`, add(ft, [(k - 1.5) * 0.018 * s, -0.045 * s, 0.07 * s]), add(ft, [(k - 1.5) * 0.02 * s, -0.05 * s, 0.12 * s]), 0.008 * s, 0.006 * s, { k: 0.004 * s, g: gL, mat: 'skin' });
    void sx;
  }
  // Rotted rag of a loincloth / tabard scrap: hard layer.
  B.box('hips', add(J.hips, [0, -0.11 * s, 0.07 * s]), [0.06 * s, 0.1 * s, 0.006 * s], { g: G.hair, mat: 'shirt', rr: 0.004 * s, disp: (x, y) => Math.sin(x * 160 + y * 40) * 0.003 * s, amp: 0.003 * s });
  const H = (x, y, z) => add(J.head, [x * o.hs, y * o.hs, z * o.hs]);
  const e = HEADS.skull(B, H, o.hs, { G });
  return { names: Object.keys(J), eyes: e.eyes, eyeR: e.r };
}

// ------------------------------------------------------------------ mesh + skin
function toGeometry(B, o, res) {
  const s = o.s;
  const cell = Math.max(0.0068, Math.min(0.0115, 0.0105 * s * (o.species === 'skeleton' ? 0.85 : 1)));
  const m = meshSculpt(B.sc, { cell, ao: 0.012 * s });
  const n = m.count;
  const prims = B.sc.prims;
  const names = res.names;
  const bi = new Map(names.map((nm, i) => [nm, i]));
  const tagIdx = prims.map((p, i) => (p.sub ? -1 : bi.get(B.tags[i]) ?? bi.get('chest') ?? 0));
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const D = new Float64Array(prims.length);
  const acc = new Float64Array(names.length);
  const sigma = 0.022 * s;
  for (let v = 0; v < n; v++) {
    const x = m.position[v * 3];
    const y = m.position[v * 3 + 1];
    const z = m.position[v * 3 + 2];
    let best = -1;
    let dmin = Infinity;
    for (let i = 0; i < prims.length; i++) {
      if (tagIdx[i] < 0) continue;
      const d = prims[i].f(x, y, z);
      D[i] = d;
      if (d < dmin) {
        dmin = d;
        best = i;
      }
    }
    acc.fill(0);
    const g = prims[best].g;
    for (let i = 0; i < prims.length; i++) {
      if (tagIdx[i] < 0 || prims[i].g !== g) continue;
      const e = D[i] - dmin;
      if (e > sigma * 5) continue;
      acc[tagIdx[i]] += Math.exp(-e / sigma);
    }
    // Top four bones.
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      let bj = -1;
      let bv = 0;
      for (let j = 0; j < acc.length; j++) if (acc[j] > bv) { bv = acc[j]; bj = j; }
      if (bj < 0) break;
      si[v * 4 + k] = bj;
      sw[v * 4 + k] = bv;
      tot += bv;
      acc[bj] = 0;
    }
    for (let k = 0; k < 4; k++) sw[v * 4 + k] /= tot || 1;
    if (!tot) {
      si[v * 4] = tagIdx[best];
      sw[v * 4] = 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(m.mat, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------ material
let _mat = null;
/** Shared base material for sculpted flesh (cloned per figure by the animator). */
export function sculptMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  _mat.userData.sculpt = true;
  _mat.name = 'sculpt-flesh';
  return _mat;
}

/**
 * Shader patch for sculpted flesh: per-vertex roughness/metalness and an
 * object-space procedural micro-surface per material pattern (scales, fur,
 * spotted hide, cloth weave, leather grain, mail rings, bone), bump-mapped via
 * screen derivatives and faded out where it would alias at tactics zoom.
 */
export function patchSculptShader(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aMat; varying vec4 vMat; varying vec3 vObj;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vObj = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec4 vMat; varying vec3 vObj;
      float sh3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float sn3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(sh3(i), sh3(i + vec3(1,0,0)), f.x), mix(sh3(i + vec3(0,1,0)), sh3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(sh3(i + vec3(0,0,1)), sh3(i + vec3(1,0,1)), f.x), mix(sh3(i + vec3(0,1,1)), sh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
      vec2 cell3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z)); vec3 o = vec3(sh3(i + g), sh3(i + g + 7.1), sh3(i + g + 3.3));
          float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return vec2(d1, d2); }
      // Height + albedo factor for a pattern at object position p.
      void sculptDetail(float pid, vec3 p, out float h, out float alb) {
        h = 0.0; alb = 1.0;
        float big = sn3(p * 9.0) * 0.65 + sn3(p * 3.0) * 0.35;
        if (pid < 0.5) { h = sn3(p * 90.0) * 0.5 + sn3(p * 260.0) * 0.25; alb = 0.8 + big * 0.36; }
        else if (pid < 1.5) { vec2 c = cell3(p * 34.0); float e = smoothstep(0.0, 0.25, c.y - c.x); h = e * (0.7 + 0.3 * (1.0 - c.x)); alb = mix(0.55, 1.0, e) * (0.82 + 0.3 * big); }
        else if (pid < 2.5) { h = sn3(p * vec3(170.0, 40.0, 170.0)) * 0.7 + sn3(p * 60.0) * 0.3; alb = 0.78 + h * 0.35; }
        else if (pid < 3.5) { float wv = sin(p.x * 900.0) * sin(p.y * 900.0 + p.z * 900.0); h = wv * 0.25 + sn3(p * 40.0) * 0.4; alb = 0.88 + sn3(p * 14.0) * 0.24; }
        else if (pid < 4.5) { h = sn3(p * 50.0) * 0.6; float cr = smoothstep(0.02, 0.0, abs(sn3(p * 22.0) - 0.5)); h -= cr * 0.5; alb = 0.82 + sn3(p * 7.0) * 0.3 - cr * 0.3; }
        else if (pid < 5.5) { vec2 c = cell3(p * 70.0); h = smoothstep(0.0, 0.12, c.y - c.x) * 0.5 + sn3(p * 30.0) * 0.4; alb = 0.8 + sn3(p * 11.0) * 0.35; }
        else if (pid < 6.5) { h = sn3(p * 30.0) * 0.2; alb = 0.95 + sn3(p * 12.0) * 0.1; }
        else if (pid < 7.5) { vec2 c = cell3(p * 16.0); float spot = smoothstep(0.32, 0.22, c.x); h = sn3(p * vec3(170.0, 40.0, 170.0)) * 0.6; alb = mix(0.95, 0.42, spot) * (0.85 + h * 0.3); }
        else if (pid < 8.5) { h = sn3(p * 40.0) * 0.3; alb = 0.75 + sn3(p * 6.0) * 0.45; }
        else { vec3 q = p * 140.0; float r = length(fract(vec2(q.x + floor(q.y) * 0.5, q.y)) - 0.5); h = smoothstep(0.45, 0.25, r) * 0.8; alb = 0.6 + h * 0.5; }
      }
      vec3 sculptBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
        vec3 sx = dFdx(surf_pos); vec3 sy = dFdy(surf_pos); vec3 r1 = cross(sy, surf_norm); vec3 r2 = cross(surf_norm, sx);
        float det = dot(sx, r1) * faceDir; vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
        return normalize(abs(det) * surf_norm - grad); }
      float sculptH; float sculptAlb;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      // Micro detail only where it resolves (a texel bigger than a pixel); at
      // tactics zoom just the broad colour breakup (cheap) remains.
      float sculptFade = 1.0 - smoothstep(0.004, 0.012, length(fwidth(vObj)));
      if (sculptFade > 0.01) {
        sculptDetail(floor(vMat.x + 0.5), vObj, sculptH, sculptAlb);
        sculptAlb = mix(0.8 + 0.4 * sn3(vObj * 4.0), sculptAlb, sculptFade);
      } else { sculptH = 0.4; sculptAlb = 0.8 + 0.4 * sn3(vObj * 4.0); }
      diffuseColor.rgb *= sculptAlb;`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vMat.y + (sculptH - 0.4) * 0.15, 0.08, 1.0);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.z;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = sculptBump(-vViewPosition, normal, vec2(dFdx(sculptH), dFdy(sculptH)) * 0.0022 * sculptFade, faceDirection);`);
}

// ------------------------------------------------------------------ statue
let _statue = null;
/**
 * The cracked statue of Tyr for the ruined temple: a robed, blindfolded,
 * bearded god, warhammer raised in his left hand, the right ending at the
 * wrist — one sculpted stone mesh with baked occlusion (origin at the plinth top).
 */
export function statueGeometry() {
  if (_statue) return _statue;
  const B = new Builder();
  B.mat('skin', 0x86817a, { pattern: 'smooth', rough: 0.9, edge: 0.3, wash: 1.0 })
    .mat('dark', 0x4a4640, { pattern: 'smooth', rough: 0.95, edge: 0.3, wash: 1.0 })
    .mat('moss', 0x5a6440, { pattern: 'smooth', rough: 1, edge: 0.2, wash: 1.0 });
  const sc = B.sc;
  const S = { k: 0.06, g: 0, mat: B.mats.skin };
  // Robe: a flared skirt with deep vertical folds, belted waist, broad shoulders.
  sc.cone([0, 0.0, 0], [0, 1.45, 0], 0.44, 0.27, S);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.2;
    sc.cone([Math.sin(a) * 0.4, 0.02, Math.cos(a) * 0.36], [Math.sin(a) * 0.25, 1.3, Math.cos(a) * 0.22], 0.07, 0.03, { ...S, k: 0.05 });
  }
  sc.ellipsoid([0, 1.72, 0], [0.31, 0.33, 0.22], M_ID, S);
  sc.ellipsoid([0, 1.97, -0.01], [0.36, 0.12, 0.2], M_ID, S);
  sc.torus([0, 1.42, 0], 0.27, 0.035, M_ID, { g: 1, mat: B.mats.skin, k: 0.01 });
  sc.cone([0, 2.0, 0], [0, 2.13, 0.01], 0.08, 0.07, S);
  // Head, beard, the carved blindfold.
  sc.ellipsoid([0, 2.26, 0.01], [0.13, 0.155, 0.14], M_ID, S);
  sc.ellipsoid([0, 2.12, 0.08], [0.1, 0.14, 0.07], M_ID, { ...S, k: 0.04 });
  sc.ellipsoid([0, 2.22, 0.125], [0.03, 0.04, 0.03], M_ID, { ...S, k: 0.02 });
  sc.torus([0, 2.29, 0.01], 0.135, 0.022, mEuler(0.12, 0, 0), { g: 1, mat: B.mats.dark, k: 0.01 });
  sc.ellipsoid([0, 2.36, -0.02], [0.135, 0.07, 0.14], M_ID, { ...S, k: 0.03 });
  // Left arm raised with the warhammer of justice.
  sc.cone([-0.32, 1.96, 0], [-0.5, 2.28, 0.06], 0.075, 0.06, S);
  sc.cone([-0.5, 2.28, 0.06], [-0.56, 2.62, 0.06], 0.06, 0.05, S);
  sc.ellipsoid([-0.56, 2.66, 0.06], [0.055, 0.06, 0.055], M_ID, S);
  sc.cone([-0.56, 2.1, 0.06], [-0.56, 3.2, 0.06], 0.026, 0.026, { g: 2, mat: B.mats.skin, k: 0.005 });
  sc.box([-0.56, 3.22, 0.06], [0.18, 0.09, 0.09], M_ID, 0.02, { g: 2, mat: B.mats.skin, k: 0.01 });
  // Right arm: forearm ends at the wrist (Tyr's lost hand).
  sc.cone([0.32, 1.96, 0], [0.42, 1.62, 0.16], 0.075, 0.06, S);
  sc.cone([0.42, 1.62, 0.16], [0.5, 1.5, 0.36], 0.06, 0.05, S);
  // Weathering: a great crack, chips, moss in the folds.
  sc.box([0.1, 1.2, 0.3], [0.008, 0.6, 0.06], mEuler(0, 0, 0.25), 0.003, { g: 0, sub: true, k: 0.004 });
  sc.sphere([0.2, 1.98, 0.12], 0.05, { g: 0, sub: true, k: 0.02 });
  for (let k = 0; k < 5; k++) sc.ellipsoid([Math.sin(k * 1.7) * 0.38, 0.05 + k * 0.02, Math.cos(k * 1.7) * 0.33], [0.08, 0.04, 0.08], M_ID, { g: 3, mat: B.mats.moss, k: 0.03 });
  const m = meshSculpt(sc, { cell: 0.016, ao: 0.03 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  _statue = geo;
  return geo;
}
