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

export const PAT = { skin: 0, scales: 1, fur: 2, cloth: 3, bone: 4, leather: 5, smooth: 6, spots: 7, metal: 8, mail: 9, scale: 10, dscale: 11, dplate: 12 };

const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

const CACHE = new Map();

export class SculptBuilder {
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
  // Iteration 4: dun olive-ochre scaled hide (red is reserved for the active
  // hero, the board's one standout colour),
  // near-black along the spine, a pale ochre belly and bone-white horns.
  kobold: { skin: [0x76643a, 'scales'], back: [0x2a2614, 'scales'], belly: [0xb8a06a, 'scales'], horn: 0xeee0b8, cloth: 0x4a3a28, head: 'kobold', jerkin: 0x9a6a38, boots: 0x3a2414 },
  goblin: { skin: [0x86963a, 'skin'], back: [0x5a6a26, 'skin'], belly: [0xa0aa60, 'skin'], horn: 0xd8c8a0, cloth: 0x4a3020, head: 'goblin', pants: 0x3a2a1a },
  orc: { skin: [0x5a6438, 'skin'], back: [0x2c3219, 'skin'], belly: [0x7a7c58, 'skin'], horn: 0xeadfc0, cloth: 0x3a2c1c, head: 'orc', pants: 0x3a2c1e, jerkin: 0x5a3a20, plate: 0x6a625a, hair: 0x0e0c0a },
  // Hobgoblins: dark rust-brown hide with an orange cast, a flat simian face,
  // bronze scale coats under a red-and-ochre legion tabard, leather boots.
  hobgoblin: { skin: [0x86663c, 'skin'], back: [0x4a3820, 'skin'], belly: [0xb08e62, 'skin'], horn: 0xeadcb8, cloth: 0x2a2a22, head: 'hobgoblin', pants: 0x2e1c12, mail: 0x6e5a3e, hair: 0x0e0a08, nose: 0x3a1a0e, tabard: 0x24261e, trim: 0xc89a3a, boots: 0x2a1a10 },
  gnoll: { skin: [0xa88450, 'spots'], back: [0x6a5030, 'fur'], belly: [0xc8a878, 'fur'], horn: 0xe0d4b0, cloth: 0x3a2e22, head: 'gnoll', hair: 0x2a1a10, pants: 0x3a2e22 },
  bugbear: { skin: [0x7a5a30, 'fur'], back: [0x4a3418, 'fur'], belly: [0x9a7a50, 'fur'], horn: 0xd8c8a0, cloth: 0x3a2a1a, head: 'bugbear', hair: 0x2a1a0a, pants: 0x3a2a1a },
  lizardMan: { skin: [0x4a6a3a, 'scales'], back: [0x2e4a26, 'scales'], belly: [0xb0b07a, 'scales'], horn: 0xd8d0a0, cloth: 0x4a3a20, head: 'lizard' },
  // Old grave bone: yellowed and earth-stained, darker in the hollows, with rags.
  skeleton: { skin: [0x9c9078, 'bone'], back: [0x5e5546, 'bone'], belly: [0xaea288, 'bone'], horn: 0xb8ac90, head: 'skull', shirt: 0x2c241a },
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
  const B = new SculptBuilder();
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
    .mat('nose', look.nose ?? look.back[0], { pattern: 'skin', rough: 0.5 })
    .mat('tabard', look.tabard ?? 0x3a3a26, { pattern: 'cloth', rough: 0.9, edge: 0.5, wash: 0.85 })
    .mat('trim', look.trim ?? 0xa08030, { pattern: 'cloth', rough: 0.8, edge: 0.4, wash: 0.7 })
    .mat('boots', look.boots ?? 0x2a1a10, { pattern: 'leather', rough: 0.65, edge: 0.7, wash: 0.85 })
    .mat('scale', look.mail ?? 0x6e5a3e, { pattern: 'scale', rough: 0.5, metal: 0.65, edge: 0.8, wash: 0.85 });
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
      B.cone(`upperArm${side}`, add(ua, [0, 0.01 * s, 0]), fa, 0.06 * bw * s, 0.05 * bw * s, { g: side === 'L' ? G.sleeveL : G.sleeveR, k: 0.02 * s, grow: 0.01 * s, mat: o.kit.armor === 'scale' ? (sp === 'hobgoblin' ? 'scale' : 'mail') : 'shirt', clip: [[0, -1, 0, -cut]] });
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
    // Three cuts of warband gear (the sculpt is cached per cut): a hide jerkin
    // with one pauldron; bare-chested under strapped pauldrons; a jerkin with a
    // rusted breastplate strapped over it.
    const vb = Math.floor((o.kit.variant ?? 0) * 3);
    if (vb !== 1) jerkin('leather', G.jerkin, 0.012 * s, J.neck[1] - 0.03 * s, J.hips[1] - 0.05 * s);
    // A dented, rusty pauldron on the weapon shoulder (sculpted over the deltoid).
    for (const [side, sx] of [['R', -1], ['L', 1]]) {
      if (side === 'L' && vb === 0) continue;
      const sh = J[`upperArm${side}`];
      const P = { g: G.plate, k: 0.01 * s, mat: 'plate', clip: [[0, -1, 0, -(sh[1] - 0.07 * s)]], clipK: 0.006 * s };
      B.ell(`upperArm${side}`, add(sh, [sx * 0.015 * s, 0.0, 0]), [0.085 * s, 0.075 * s, 0.085 * s], { ...P, R: mEuler(0, 0, sx * 0.35) });
      B.ell(`upperArm${side}`, add(sh, [sx * 0.03 * s, -0.04 * s, 0]), [0.075 * s, 0.05 * s, 0.08 * s], { ...P, clip: [[0, -1, 0, -(sh[1] - 0.1 * s)]], R: mEuler(0, 0, sx * 0.5) });
    }
    if (vb === 2) jerkin('plate', G.plate, 0.03 * s, J.neck[1] - 0.05 * s, J.spine[1] + 0.02 * s, 0.03 * s);
  } else if (o.kit.armor === 'scale') {
    const scaleMat = sp === 'hobgoblin' ? 'scale' : 'mail';
    jerkin(scaleMat, G.jerkin, 0.014 * s, J.neck[1] - 0.025 * s, J.hips[1] - 0.12 * s);
    if (sp === 'hobgoblin') {
      // Legion tabard over the scale coat: front and back panels to mid-thigh,
      // an ochre hem band and a broad belt; and laced leather boots.
      const top = J.chest[1] + 0.2 * s;
      for (const fz of [1, -1]) {
        const zc = fz * 0.118 * s;
        B.box('chest', [0, J.chest[1] + 0.06 * s, zc + fz * 0.012 * s], [0.12 * w * s, 0.15 * s, 0.012 * s], { g: G.plate, mat: 'tabard', rr: 0.006 * s, R: mEuler(fz * -0.05, 0, 0), clip: [[0, 1, 0, top]] });
        B.box('spine', [0, J.spine[1] + 0.04 * s, zc * 1.05 + fz * 0.014 * s], [0.115 * w * s, 0.13 * s, 0.012 * s], { g: G.plate, mat: 'tabard', rr: 0.006 * s });
        B.box('hips', [0, J.hips[1] - 0.12 * s, zc * 1.1 + fz * 0.016 * s], [0.1 * w * s, 0.13 * s, 0.01 * s], { g: G.plate, mat: 'tabard', rr: 0.006 * s, R: mEuler(fz * 0.08, 0, 0) });
        B.box('hips', [0, J.hips[1] - 0.245 * s, zc * 1.1 + fz * 0.026 * s], [0.102 * w * s, 0.014 * s, 0.012 * s], { g: G.plate, mat: 'trim', rr: 0.004 * s, R: mEuler(fz * 0.08, 0, 0) });
        // Ochre device: a broad chevron on the chest.
        for (const sx of [1, -1]) B.box('chest', [sx * 0.04 * w * s, J.chest[1] + 0.07 * s, zc + fz * 0.026 * s], [0.055 * s, 0.012 * s, 0.006 * s], { g: G.plate, mat: 'trim', rr: 0.003 * s, R: mEuler(0, 0, sx * 0.6) });
      }
      B.ell('hips', add(J.hips, [0, 0.03 * s, -0.005 * s]), [0.16 * w * s, 0.03 * s, 0.125 * s], { g: G.plate, k: 0.01 * s, mat: 'boots' });
      for (const side of ['L', 'R']) {
        const sh = J[`shin${side}`];
        const ft = J[`foot${side}`];
        const BT = { g: side === 'L' ? G.pantsL : G.pantsR, k: 0.02 * s, grow: 0.014 * s, mat: 'boots' };
        B.cone(`shin${side}`, add(sh, [0, -0.06 * s, 0]), add(ft, [0, 0.0, 0]), 0.06 * lw * s, 0.046 * lw * s, BT);
        B.ell(`foot${side}`, add(ft, [0, -0.04 * s, 0.05 * s]), [0.054 * s, 0.04 * s, 0.12 * s], BT);
        B.cone(`shin${side}`, add(sh, [0, -0.05 * s, 0]), add(sh, [0, -0.08 * s, 0]), 0.066 * lw * s, 0.066 * lw * s, { ...BT, grow: 0.018 * s });
      }
    }
  } else if (o.kit.tattered) {
    jerkin('shirt', G.jerkin, 0.01 * s, J.neck[1] - 0.04 * s, J.hips[1] - 0.1 * s);
  } else if (o.kit.armor === 'harness') {
    // Kobold war-gear: a boiled-leather jerkin over the chest and a hide kilt
    // of split tassets (three materials: scaled hide, leather, the belly scutes).
    jerkin('leather', G.jerkin, 0.014 * s, J.chest[1] + 0.2 * s, J.spine[1] - 0.02 * s);
    B.ell('hips', add(J.hips, [0, -0.02 * s, -0.005 * s]), [0.165 * w * s, 0.1 * s, 0.13 * s], { g: G.plate, k: 0.01 * s, grow: 0.012 * s, mat: 'leather', clip: [[0, 1, 0, J.hips[1] + 0.04 * s], [0, -1, 0, -(J.hips[1] - 0.12 * s)]], clipK: 0.006 * s });
    B.ell('hips', add(J.hips, [0, 0.035 * s, -0.005 * s]), [0.17 * w * s, 0.025 * s, 0.135 * s], { g: G.plate, k: 0.008 * s, mat: 'boots' });
  } else if (o.kit.armor === 'scraps') {
    jerkin('leather', G.jerkin, 0.012 * s, J.chest[1] + 0.2 * s, J.chest[1] + 0.02 * s);
  }
  // ---- tail (one smooth mass with the pelvis)
  if (o.tail) {
    const tk = o.tail === 'long' ? 1.45 : 1;
    const t1 = J.tail1;
    const t2 = J.tail2;
    const t3 = J.tail3;
    const tip = add(t3, [0, 0.02 * s, -0.3 * s * tk]);
    const TT = { k: 0.04 * s, g: G.torso };
    B.cone('tail1', add(t1, [0, 0.02 * s, 0.05 * s]), t2, 0.075 * tk * s, 0.05 * tk * s, TT);
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
    B.cone('head', H(0, 0.096, 0.04), H(0, 0.066, 0.31), 0.054 * hs, 0.03 * hs, T);
    B.cone('head', H(0, 0.12, 0.02), H(0, 0.088, 0.26), 0.03 * hs, 0.02 * hs, { ...T, mat: 'back' });
    B.cone('head', H(0, 0.044, 0.03), H(0, 0.038, 0.28), 0.04 * hs, 0.02 * hs, { ...T, mat: 'belly' });
    // Mouth line + nostrils + eye sockets carved.
    B.box('head', H(0, 0.056, 0.2), [0.05 * hs, 0.0045 * hs, 0.11 * hs], { g: G.torso, sub: true, k: 0.004 * hs, R: mEuler(-0.08, 0, 0) });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.015, 0.08, 0.308), 0.008 * hs, { g: G.torso, sub: true, k: 0.004 * hs });
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
      for (let k = 0; k < 4; k++) B.cone('head', H(sx * 0.028, 0.062, 0.12 + k * 0.035), H(sx * 0.026, 0.044, 0.122 + k * 0.035), 0.006 * hs, 0.0015 * hs, { g: G.hard, mat: 'tooth' });
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
    // Flat, simian face: broad cranium, a heavy brow shelf, a short prognathous
    // muzzle with a flat, wide nose and flared nostrils, small pointed ears.
    B.ell('head', H(0, 0.115, -0.018), [0.092 * hs, 0.084 * hs, 0.094 * hs], T);
    B.ell('head', H(0, 0.06, 0.042), [0.08 * hs, 0.05 * hs, 0.06 * hs], T);
    B.ell('head', H(0, 0.05, 0.075), [0.058 * hs, 0.036 * hs, 0.036 * hs], { ...T, k: 0.02 * hs });
    B.ell('head', H(0, 0.134, 0.074), [0.088 * hs, 0.024 * hs, 0.034 * hs], { ...T, k: 0.016 * hs, mat: 'back' });
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.054, 0.09, 0.06), [0.03 * hs, 0.024 * hs, 0.03 * hs], { ...T, k: 0.014 * hs });
    B.ell('head', H(0, 0.093, 0.102), [0.034 * hs, 0.017 * hs, 0.018 * hs], { ...T, k: 0.012 * hs, mat: 'nose' });
    for (const sx of [1, -1]) {
      B.sph('head', H(sx * 0.014, 0.086, 0.116), 0.007 * hs, { g: G.torso, sub: true, k: 0.003 * hs });
      B.sph('head', H(sx * 0.038, 0.11, 0.087), 0.019 * hs, { g: G.torso, sub: true, k: 0.008 * hs });
      // Small, swept pointed ears.
      B.ell('head', H(sx * 0.098, 0.12, -0.02), [0.04 * hs, 0.022 * hs, 0.01 * hs], { ...T, k: 0.014 * hs, R: mEuler(0, sx * 0.4, sx * -0.55) });
      B.cone('head', H(sx * 0.028, 0.04, 0.098), H(sx * 0.03, 0.066, 0.104), 0.007 * hs, 0.0015 * hs, { g: G.hard, mat: 'tooth' });
    }
    B.box('head', H(0, 0.046, 0.104), [0.044 * hs, 0.004 * hs, 0.02 * hs], { g: G.torso, sub: true, k: 0.003 * hs });
    // Coarse black side-whiskers framing the jaw.
    for (const sx of [1, -1]) B.ell('head', H(sx * 0.07, 0.06, 0.02), [0.022 * hs, 0.04 * hs, 0.035 * hs], { g: G.hair, k: 0.016 * hs, mat: 'hair' });
    return { eyes: [[0.038, 0.11, 0.089], [-0.038, 0.11, 0.089]], r: 0.011 };
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
    // The sockets are dark hollows (grave dirt and shadow), not more bone.
    for (const sx of [1, -1]) B.sph('head', H(sx * 0.032, 0.1, 0.066), 0.019 * hs, { g: G.hard, mat: 'dark', k: 0.003 * hs });
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
  const R = 0.026 * s;
  // Spine: vertebrae from the pelvis to the skull.
  const back = -0.04 * s;
  const y0 = J.hips[1] + 0.02 * s;
  const y1 = J.head[1];
  for (let k = 0; k <= 11; k++) {
    const y = y0 + (y1 - y0) * (k / 11);
    const tag = y < J.spine[1] ? 'hips' : y < J.chest[1] ? 'spine' : y < J.neck[1] ? 'chest' : 'neck';
    const z = back + Math.sin((k / 11) * Math.PI) * -0.01 * s + (tag === 'neck' ? 0.03 * s : 0);
    B.ell(tag, [0, y, z], [0.03 * s, 0.017 * s, 0.027 * s], bone);
    B.cone(tag, [0, y, z], [0, y, z - 0.03 * s], 0.011 * s, 0.005 * s, bone);
  }
  // Pelvis bowl (iliac wings) with the hollow carved out.
  B.ell('hips', add(J.hips, [0, 0.0, 0]), [0.145 * w * s, 0.08 * s, 0.085 * s], bone);
  B.ell('hips', add(J.hips, [0, 0.03 * s, 0.01 * s]), [0.09 * w * s, 0.07 * s, 0.05 * s], { g: G.torso, sub: true, k: 0.01 * s });
  B.ell('hips', add(J.hips, [0, -0.05 * s, 0.03 * s]), [0.05 * s, 0.03 * s, 0.05 * s], { g: G.torso, sub: true, k: 0.01 * s });
  // Ribcage: curved ribs (clipped tori) from the spine round to the sternum.
  for (let k = 0; k < 7; k++) {
    const y = J.chest[1] - 0.005 * s + k * 0.034 * s;
    const rr = (0.145 - Math.abs(k - 2.6) * 0.012) * w * s;
    const tor = B.sc.torus([0, y, -0.005 * s], rr, 0.017 * s, mEuler(-0.32, 0, 0), { mat: B.mats.skin, g: G.torso, k: 0.006 * s, clip: [[0, 0, 1, 0.075 * s], [0, 0, -1, 0.035 * s]] });
    B.tags[tor] = 'chest';
    void tor;
  }
  B.box('chest', add(J.chest, [0, 0.11 * s, 0.095 * s]), [0.022 * s, 0.1 * s, 0.01 * s], { ...bone, rr: 0.006 * s, R: mEuler(-0.25, 0, 0) });
  // Clavicles + shoulder blades.
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const sh = J[`upperArm${side}`];
    B.cone('chest', add(J.chest, [sx * 0.02 * s, 0.205 * s, 0.05 * s]), add(sh, [-sx * 0.01 * s, 0.01 * s, 0.01 * s]), 0.011 * s, 0.01 * s, bone);
    B.ell('chest', add(J.chest, [sx * 0.08 * s, 0.14 * s, -0.08 * s]), [0.05 * s, 0.06 * s, 0.01 * s], { ...bone, R: mEuler(0, sx * 0.4, 0) });
  }
  // Limb bones with knobbly joint ends.
  const longBone = (tag, a, b, g, r0 = R, r1 = R * 0.85) => {
    const L = { k: 0.01 * s, g, mat: 'skin' };
    // A touch heavier than anatomy so limbs read as bone, not wire, at tactics zoom.
    r0 *= 1.05;
    r1 *= 1.05;
    B.cone(tag, a, b, r0, r1, L);
    B.sph(tag, mid(a, b, 0.06), r0 * 1.45, L);
    B.sph(tag, mid(a, b, 0.94), r1 * 1.45, L);
  };
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const gA = side === 'L' ? G.armL : G.armR;
    const gL = side === 'L' ? G.legL : G.legR;
    longBone(`upperArm${side}`, J[`upperArm${side}`], J[`foreArm${side}`], gA, 0.025 * s, 0.021 * s);
    longBone(`foreArm${side}`, J[`foreArm${side}`], J[`hand${side}`], gA, 0.02 * s, 0.017 * s);
    // Bony hand: a palm and four finger rays.
    const ha = J[`hand${side}`];
    B.box(`hand${side}`, add(ha, [0, -0.04 * s, 0.008 * s]), [0.03 * s, 0.03 * s, 0.012 * s], { k: 0.006 * s, g: gA, mat: 'skin', rr: 0.008 * s });
    for (let k = 0; k < 4; k++) B.cone(`hand${side}`, add(ha, [(k - 1.5) * 0.016 * s, -0.065 * s, 0.01 * s]), add(ha, [(k - 1.5) * 0.017 * s, -0.08 * s, 0.045 * s]), 0.006 * s, 0.004 * s, { k: 0.004 * s, g: gA, mat: 'skin' });
    longBone(`thigh${side}`, add(J[`thigh${side}`], [0, 0.01 * s, 0]), J[`shin${side}`], gL, 0.032 * s, 0.026 * s);
    longBone(`shin${side}`, J[`shin${side}`], J[`foot${side}`], gL, 0.026 * s, 0.021 * s);
    B.sph(`shin${side}`, add(J[`shin${side}`], [0, 0.01 * s, 0.025 * s]), 0.02 * s, { k: 0.008 * s, g: gL, mat: 'skin' });
    const ft = J[`foot${side}`];
    B.box(`foot${side}`, add(ft, [0, -0.035 * s, 0.03 * s]), [0.032 * s, 0.018 * s, 0.05 * s], { k: 0.008 * s, g: gL, mat: 'skin', rr: 0.012 * s });
    for (let k = 0; k < 4; k++) B.cone(`foot${side}`, add(ft, [(k - 1.5) * 0.018 * s, -0.045 * s, 0.07 * s]), add(ft, [(k - 1.5) * 0.02 * s, -0.05 * s, 0.12 * s]), 0.008 * s, 0.006 * s, { k: 0.004 * s, g: gL, mat: 'skin' });
    void sx;
  }
  // Rotted rags: a loincloth scrap, a torn tabard hanging off the ribs and a
  // shroud remnant over one shoulder (hard layer).
  B.box('hips', add(J.hips, [0, -0.11 * s, 0.07 * s]), [0.06 * s, 0.1 * s, 0.006 * s], { g: G.hair, mat: 'shirt', rr: 0.004 * s, disp: (x, y) => Math.sin(x * 160 + y * 40) * 0.003 * s, amp: 0.003 * s });
  B.box('hips', add(J.hips, [0.02 * s, -0.08 * s, -0.07 * s]), [0.07 * s, 0.09 * s, 0.006 * s], { g: G.hair, mat: 'shirt', rr: 0.004 * s, disp: (x, y) => Math.sin(x * 140 - y * 60) * 0.004 * s, amp: 0.004 * s });
  B.box('chest', add(J.chest, [0.03 * s, 0.06 * s, 0.115 * s]), [0.07 * s, 0.13 * s, 0.006 * s], { g: G.hair, mat: 'shirt', rr: 0.004 * s, R: mEuler(-0.2, 0, 0.12), disp: (x, y) => Math.sin(x * 120 + y * 90) * 0.004 * s, amp: 0.004 * s });
  B.box('chest', add(J.chest, [-0.09 * s, 0.2 * s, -0.01 * s]), [0.06 * s, 0.02 * s, 0.12 * s], { g: G.hair, mat: 'shirt', rr: 0.006 * s, R: mEuler(0, 0, -0.5), disp: (x, y, z) => Math.sin(z * 150 + x * 50) * 0.004 * s, amp: 0.004 * s });
  const H = (x, y, z) => add(J.head, [x * o.hs, y * o.hs, z * o.hs]);
  const e = HEADS.skull(B, H, o.hs, { G });
  return { names: Object.keys(J), eyes: e.eyes, eyeR: e.r };
}

// ------------------------------------------------------------------ mesh + skin
function toGeometry(B, o, res) {
  const s = o.s;
  const cell = Math.max(0.0068, Math.min(0.0115, 0.0105 * s * (o.species === 'skeleton' ? 0.85 : 1)));
  return skinSculpt(B.sc, B.tags, res.names, { cell, ao: 0.012 * s, sigma: 0.022 * s });
}

/**
 * Mesh a Sculpt and auto-skin every vertex to the bones whose primitives it
 * lies on (soft-min blend across joints). `tags[i]` names the bone of prim i.
 * Exported for bespoke creatures (the dragon) that build their own sculpt.
 */
export function skinSculpt(sc, tags, names, { cell = 0.01, ao = 0.012, sigma = 0.022 } = {}) {
  const m = meshSculpt(sc, { cell, ao });
  const n = m.count;
  const prims = sc.prims;
  const bi = new Map(names.map((nm, i) => [nm, i]));
  const tagIdx = prims.map((p, i) => (p.sub ? -1 : bi.get(tags[i]) ?? bi.get('chest') ?? 0));
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const D = new Float64Array(prims.length);
  const acc = new Float64Array(names.length);
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
export const SCULPT_DETAIL_GLSL = `
      float sh3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float sn3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(sh3(i), sh3(i + vec3(1,0,0)), f.x), mix(sh3(i + vec3(0,1,0)), sh3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(sh3(i + vec3(0,0,1)), sh3(i + vec3(1,0,1)), f.x), mix(sh3(i + vec3(0,1,1)), sh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
      vec2 cell3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z)); vec3 o = vec3(sh3(i + g), sh3(i + g + 7.1), sh3(i + g + 3.3));
          float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return vec2(d1, d2); }
      // Surface detail per material pattern at object position p (metres).
      // Two bands: a MID band (2-8 cm features: scale rows, leather panels and
      // seams, mottled hide, rust blooms, mail rows, grime) that always resolves
      // at tactics zoom, and the FINE band (pores, weave, rings) blended in by
      // 'fine' only where a texel is smaller than a pixel.
      // Out: h (bump height), alb (rgb albedo multiplier), dr (roughness offset), dm (metal offset).
      float sdFw; // object-space metres per pixel, set by the caller
      void sculptDetail(float pid, vec3 p, float fine, out float h, out vec3 alb, out float dr, out float dm) {
        h = 0.0; alb = vec3(1.0); dr = 0.0; dm = 0.0;
        float big = sn3(p * 9.0) * 0.65 + sn3(p * 3.0) * 0.35;
        // Grime gradient: dirt and soot collect toward the feet and in the low folds.
        float grime = mix(0.72, 1.0, smoothstep(0.04, 0.55, p.y)) * (0.9 + 0.2 * sn3(p * 2.3));
        if (pid < 0.5) {
          // Skin: blotchy mottling, warts / pores, dirt; oily-to-dry roughness.
          float mot = sn3(p * 7.0) * 0.6 + sn3(p * 17.0) * 0.4;
          vec2 c = cell3(p * 46.0);
          float wart = smoothstep(0.2, 0.07, c.x);
          h = wart * 0.6 + mot * 0.3 + fine * (sn3(p * 90.0) * 0.5 + sn3(p * 260.0) * 0.25);
          alb = vec3(0.8 + mot * 0.34) * mix(vec3(1.0), vec3(1.08, 0.9, 0.82), smoothstep(0.55, 0.8, sn3(p * 5.0)));
          alb *= 1.0 - wart * 0.16;
          dr = (sn3(p * 21.0) - 0.5) * 0.25;
        } else if (pid < 1.5) {
          // Reptile scales: 3-5 cm plates with dark seams, banded tone.
          vec2 c = cell3(p * 24.0);
          float e = smoothstep(0.0, 0.22, c.y - c.x);
          vec2 cf = cell3(p * 60.0);
          float ef = smoothstep(0.0, 0.25, cf.y - cf.x);
          h = e * (0.7 + 0.3 * (1.0 - c.x)) + fine * ef * 0.4;
          alb = vec3(mix(0.72, 1.04, e) * (0.8 + 0.32 * big)) * mix(1.0, mix(0.7, 1.0, ef), fine);
          dr = (1.0 - e) * 0.25 - 0.08;
        } else if (pid < 2.5) {
          h = sn3(p * vec3(70.0, 14.0, 70.0)) * 0.7 + fine * sn3(p * vec3(170.0, 40.0, 170.0)) * 0.5;
          alb = vec3(0.74 + h * 0.36) * (0.85 + 0.25 * big);
          dr = 0.05;
        } else if (pid < 3.5) {
          // Cloth: folds, stains, a darker frayed hem, weave when close.
          float st = smoothstep(0.55, 0.8, sn3(p * 6.0 + 3.1));
          h = sn3(p * vec3(18.0, 6.0, 18.0)) * 0.5 + fine * (sin(p.x * 900.0) * sin(p.y * 900.0 + p.z * 900.0) * 0.25);
          alb = vec3(0.86 + sn3(p * 14.0) * 0.26) * (1.0 - st * 0.22) * grime;
          alb *= mix(vec3(1.0), vec3(0.95, 0.9, 0.8), st);
          dr = 0.04;
        } else if (pid < 4.5) {
          h = sn3(p * 50.0) * 0.6; float cr = smoothstep(0.02, 0.0, abs(sn3(p * 22.0) - 0.5)); h -= cr * 0.5;
          alb = vec3(0.82 + sn3(p * 7.0) * 0.3 - cr * 0.3) * mix(vec3(1.0), vec3(0.95, 0.93, 0.88), smoothstep(0.3, 0.8, sn3(p * 4.0)));
        } else if (pid < 5.5) {
          // Leather: cut panels with dark stitched seams, scuffed lighter wear, grain.
          vec2 c = cell3(p * 9.0);
          float seamD = c.y - c.x;
          float seam = 1.0 - smoothstep(0.015, 0.05, seamD);
          float stitch = seam * step(0.5, fract((p.x + p.y * 1.3 + p.z) * 70.0));
          float scuff = smoothstep(0.62, 0.85, sn3(p * 16.0));
          vec2 cg = cell3(p * 70.0);
          h = -seam * 0.6 + stitch * 0.3 + sn3(p * 30.0) * 0.3 + fine * smoothstep(0.0, 0.12, cg.y - cg.x) * 0.3;
          alb = vec3((0.82 + 0.3 * sn3(p * 11.0)) * (1.0 - seam * 0.45) + scuff * 0.22 + stitch * 0.18) * grime;
          dr = -0.15 + scuff * 0.25 + seam * 0.15;
        } else if (pid < 6.5) {
          h = sn3(p * 30.0) * 0.2; alb = vec3(0.95 + sn3(p * 12.0) * 0.1);
        } else if (pid < 7.5) {
          vec2 c = cell3(p * 16.0); float spot = smoothstep(0.32, 0.22, c.x);
          h = sn3(p * vec3(70.0, 14.0, 70.0)) * 0.6; alb = vec3(mix(0.95, 0.42, spot) * (0.85 + h * 0.3));
        } else if (pid < 8.5) {
          // Plate: rust blooms (orange-brown, rough, non-metal), dents, pitting.
          float rn = sn3(p * 8.0) * 0.6 + sn3(p * 23.0) * 0.4;
          float rust = smoothstep(0.5, 0.72, rn);
          float pit = smoothstep(0.75, 0.9, sn3(p * 60.0));
          h = sn3(p * 14.0) * 0.4 - pit * 0.3 + rust * 0.2;
          alb = mix(vec3(0.8 + sn3(p * 6.0) * 0.35), vec3(1.5, 0.82, 0.46) * (0.75 + 0.3 * rn), rust) * (1.0 - pit * 0.25);
          dr = rust * 0.4 + pit * 0.1 - 0.05; dm = -rust * 0.55;
        } else if (pid < 9.5) {
          // Mail (iteration 4): fine riveted rings (about 7 mm rows, not a
          // knit), each a bright steel crown with a near-black wash in the
          // gaps; the pattern resolves only where a ring spans a few pixels and
          // otherwise settles to worn, washed steel (no moire at board zoom).
          vec3 q = p * vec3(150.0, 140.0, 150.0);
          float row = floor(q.y);
          float u = fract(q.x + q.z + row * 0.5) - 0.5;
          float v = fract(q.y) - 0.5;
          float rr = length(vec2(u, v * 1.15));
          float link = smoothstep(0.5, 0.3, rr) * smoothstep(0.08, 0.2, rr);
          float rv = smoothstep(0.5, 0.0, rr);
          float ringVis = 1.0 - smoothstep(0.0025, 0.006, sdFw);
          float rust = smoothstep(0.62, 0.8, sn3(p * 9.0)) * (1.0 - smoothstep(0.4, 0.9, p.y));
          float washM = 0.55 + 0.45 * sn3(p * 11.0);
          vec3 ringA = vec3(0.32 + link * 0.95 + rv * 0.15);
          vec3 flatA = vec3(0.62 + 0.3 * washM) * (0.85 + 0.25 * big);
          alb = mix(flatA, ringA, ringVis);
          alb = mix(alb, vec3(1.2, 0.75, 0.45) * 0.8, rust) * grime;
          h = mix(0.0, link * 0.7, ringVis);
          dr = mix(0.05 - washM * 0.1, (1.0 - link) * 0.35 - 0.12, ringVis) + rust * 0.35; dm = -rust * 0.4 - (1.0 - link) * 0.3 * ringVis;
        } else if (pid > 10.5 && pid < 11.5) {
          // Great-wyrm bronze: big overlapping keeled scales (Voronoi plates
          // shingled along the body), each domed with a worn bright crown;
          // the crevices between them crusted with verdigris (teal, matte,
          // non-metal) and dark grime, so the metal reads as old cast bronze.
          vec3 q = p * vec3(23.0, 26.0, 17.0);
          vec2 c = cell3(q);
          float gap = c.y - c.x;
          float crown = 1.0 - smoothstep(0.0, 0.62, c.x);
          float crev = 1.0 - smoothstep(0.02, 0.16, gap);
          vec2 cf = cell3(p * 44.0);
          float crevF = 1.0 - smoothstep(0.0, 0.1, cf.y - cf.x);
          h = crown * 0.75 - crev * 0.6 + fine * (sn3(p * 120.0) * 0.2 - crevF * 0.3);
          float verd = crev * (0.55 + 0.45 * smoothstep(0.35, 0.75, sn3(p * 6.0))) + smoothstep(0.62, 0.8, sn3(p * 4.0 + 9.0)) * 0.35 * (1.0 - crown);
          verd = clamp(verd, 0.0, 1.0);
          alb = vec3(0.78 + crown * 0.42) * (0.85 + 0.3 * big);
          alb = mix(alb, vec3(0.42, 1.25, 1.35) * (0.7 + 0.3 * sn3(p * 13.0)), verd * 0.85);
          alb *= 1.0 - crev * 0.25;
          dr = -crown * 0.12 + verd * 0.5; dm = -verd * 0.75 - crev * 0.2;
        } else if (pid > 11.5) {
          // Ventral plates: broad transverse bands, polished where they rub, dark seams.
          float band = fract(p.z * 9.0 + p.y * 3.5);
          float seam = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.9, 1.0, band));
          h = seam * (0.6 + 0.4 * sin(band * 3.1416)) + fine * sn3(p * 90.0) * 0.2;
          alb = vec3(0.7 + 0.35 * seam) * (0.85 + 0.25 * big);
          float verd = (1.0 - seam) * 0.8;
          alb = mix(alb, vec3(0.5, 1.15, 1.2), verd * 0.6);
          dr = (1.0 - seam) * 0.35 - 0.05; dm = -(1.0 - seam) * 0.5;
        } else {
          // Armour scales: overlapping rounded plates in staggered rows, bright rims.
          vec2 uv = vec2((p.x + p.z * 0.6) * 34.0, p.y * 30.0);
          float rowI = floor(uv.y);
          vec2 f = vec2(fract(uv.x + rowI * 0.5), fract(uv.y));
          float d = length((f - vec2(0.5, 1.0)) * vec2(1.0, 0.75));
          float plate = 1.0 - smoothstep(0.42, 0.52, d);
          float rim = smoothstep(0.3, 0.48, d) * plate;
          h = plate * (1.0 - f.y) * 0.8;
          alb = vec3((0.55 + plate * 0.45 + rim * 0.3) * (0.82 + 0.3 * sn3(vec3(floor(uv.x + rowI * 0.5), rowI, 0.0) * 0.37))) * grime;
          float verd = smoothstep(0.6, 0.85, sn3(p * 7.0));
          alb = mix(alb, alb * vec3(0.7, 1.05, 0.95), verd);
          dr = (1.0 - plate) * 0.35 - rim * 0.15 + verd * 0.2; dm = -(1.0 - plate) * 0.4;
        }
      }
      vec3 sculptBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
        vec3 sx = dFdx(surf_pos); vec3 sy = dFdy(surf_pos); vec3 r1 = cross(sy, surf_norm); vec3 r2 = cross(surf_norm, sx);
        float det = dot(sx, r1) * faceDir; vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
        return normalize(abs(det) * surf_norm - grad); }
`;

export function patchSculptShader(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aMat; varying vec4 vMat; varying vec3 vObj;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vObj = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec4 vMat; varying vec3 vObj;
${SCULPT_DETAIL_GLSL}
      float sculptH; vec3 sculptAlb; float sculptDR; float sculptDM; float sculptMid;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      // Mid-band detail always (it resolves at tactics zoom); the fine band
      // fades in only where a texel is bigger than a pixel.
      float fw = length(fwidth(vObj));
      float sculptFine = 1.0 - smoothstep(0.004, 0.012, fw);
      sculptMid = 1.0 - smoothstep(0.03, 0.08, fw);
      sdFw = fw;
      sculptDetail(floor(vMat.x + 0.5), vObj, sculptFine, sculptH, sculptAlb, sculptDR, sculptDM);
      sculptAlb = mix(vec3(0.8 + 0.4 * sn3(vObj * 4.0)), sculptAlb, sculptMid);
      diffuseColor.rgb *= sculptAlb;`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vMat.y + sculptDR * sculptMid, 0.08, 1.0);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(vMat.z + sculptDM * sculptMid, 0.0, 1.0);')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = sculptBump(-vViewPosition, normal, vec2(dFdx(sculptH), dFdy(sculptH)) * 0.0035 * sculptMid, faceDirection);`);
}

/**
 * The same mid-band surface breakup for rigid kit parts (armour, cloth, leather,
 * weapons) on top of their detail textures, keyed by a pattern id, so a figure
 * reads as stitched leather / mail / rusty plate / stained cloth at tactics
 * zoom instead of smooth vinyl.
 */
export function patchRigidShader(sh, pid) {
  sh.uniforms.uPid = { value: pid };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vObjR;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjR = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uPid; varying vec3 vObjR;
      ${SCULPT_DETAIL_GLSL}
      float rgH; vec3 rgAlb; float rgDR; float rgDM; float rgMid;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      sdFw = length(fwidth(vObjR));
      rgMid = (1.0 - smoothstep(0.03, 0.08, sdFw)) * 0.8;
      sculptDetail(uPid, vObjR, 0.0, rgH, rgAlb, rgDR, rgDM);
      diffuseColor.rgb *= mix(vec3(1.0), rgAlb, rgMid);`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + rgDR * rgMid, 0.06, 1.0);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor + rgDM * rgMid, 0.0, 1.0);')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = sculptBump(-vViewPosition, normal, vec2(dFdx(rgH), dFdy(rgH)) * 0.0025 * rgMid, faceDirection);`);
}

// ------------------------------------------------------------------ statue
let _statueMat = null;
/**
 * Weathered limestone for the statue: chisel-grain and pitting bump, dark
 * rain streaks running down from every ledge, lichen blooms (grey-green and
 * rust-orange), grime pooled low and soot from centuries of candles.
 */
export function statueMaterial() {
  if (_statueMat) return _statueMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSO = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSO;
        ${SCULPT_DETAIL_GLSL}
        float stH;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vSO;
          float n1 = sn3(p * 3.0), n2 = sn3(p * 11.0), n3 = sn3(p * 37.0);
          vec2 cc = cell3(p * 18.0);
          float pit = smoothstep(0.16, 0.05, cc.x) * smoothstep(0.55, 0.75, n2);
          float streak = smoothstep(0.55, 0.85, sn3(vec3(p.x * 14.0, p.y * 0.8, p.z * 14.0))) * smoothstep(0.2, 1.4, p.y);
          float lichen = smoothstep(0.62, 0.78, n1 * 0.6 + n2 * 0.4);
          float rustL = smoothstep(0.7, 0.85, sn3(p * 5.0 + 3.7));
          float low = 1.0 - smoothstep(0.0, 0.9, p.y);
          vec3 c = diffuseColor.rgb * (0.82 + 0.3 * n2 + 0.1 * n3);
          c *= 1.0 - streak * 0.35;
          c = mix(c, vec3(0.42, 0.46, 0.36) * (0.8 + 0.4 * n3), lichen * 0.55);
          c = mix(c, vec3(0.62, 0.38, 0.18) * (0.8 + 0.4 * n3), rustL * 0.45);
          c *= 1.0 - low * 0.3 - pit * 0.35;
          diffuseColor.rgb = c;
          stH = n3 * 0.4 + n2 * 0.3 - pit * 0.8 + sin(p.y * 160.0 + n2 * 6.0) * 0.06;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = sculptBump(-vViewPosition, normal, vec2(dFdx(stH), dFdy(stH)) * 0.004, faceDirection);`);
  };
  m.customProgramCacheKey = () => 'statue-weathered-v1';
  _statueMat = m;
  return m;
}

let _statue = null;
/**
 * The cracked statue of Tyr for the ruined temple: a robed, blindfolded,
 * bearded god, warhammer raised in his left hand, the right ending at the
 * wrist — one sculpted stone mesh with baked occlusion (origin at the plinth top).
 */
export function statueGeometry() {
  if (_statue) return _statue;
  const B = new SculptBuilder();
  B.mat('skin', 0x86817a, { pattern: 'smooth', rough: 0.9, edge: 0.3, wash: 1.0 })
    .mat('dark', 0x4a4640, { pattern: 'smooth', rough: 0.95, edge: 0.3, wash: 1.0 })
    .mat('moss', 0x5a6440, { pattern: 'smooth', rough: 1, edge: 0.2, wash: 1.0 });
  const sc = B.sc;
  const S = { k: 0.06, g: 0, mat: B.mats.skin };
  // Robe: a flared skirt with deep vertical folds, belted waist, broad shoulders.
  sc.cone([0, 0.0, 0], [0, 1.45, 0], 0.44, 0.27, S);
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * Math.PI * 2 + 0.2;
    const big = k % 2 ? 0.065 : 0.095;
    sc.cone([Math.sin(a) * 0.42, 0.02, Math.cos(a) * 0.38], [Math.sin(a) * 0.25, 1.3, Math.cos(a) * 0.22], big, 0.025, { ...S, k: 0.035 });
  }
  // Toga sash: draped from the left shoulder across the chest to the right
  // hip in heavy swags, its loose end hanging down the side.
  for (let k = 0; k <= 8; k++) {
    const u = k / 8;
    const x = -0.26 + u * 0.52;
    const y = 2.0 - u * 0.62 - Math.sin(u * Math.PI) * 0.06;
    const z = 0.19 + Math.sin(u * Math.PI) * 0.06;
    sc.ellipsoid([x, y, z], [0.1, 0.075, 0.06], mEuler(0, 0, -0.85), { ...S, k: 0.03 });
    if (k % 2 === 0) sc.box([x, y + 0.01, z + 0.05], [0.08, 0.008, 0.02], mEuler(0, 0, -0.85), 0.004, { g: 0, sub: true, k: 0.012 });
  }
  sc.cone([0.3, 1.4, 0.18], [0.36, 0.7, 0.22], 0.085, 0.06, { ...S, k: 0.03 });
  sc.cone([0.36, 0.7, 0.22], [0.38, 0.35, 0.2], 0.06, 0.07, { ...S, k: 0.03 });
  // Cloak falling down the back in broad folds.
  for (let k = 0; k < 5; k++) {
    const x = (k - 2) * 0.13;
    sc.cone([x, 1.95, -0.2], [x * 1.5, 0.05, -0.36 - Math.abs(x) * 0.2], 0.09, 0.07, { ...S, k: 0.04 });
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
  // Left arm raised high with the longsword of justice, blade to the sky.
  sc.cone([-0.32, 1.96, 0], [-0.5, 2.28, 0.06], 0.08, 0.064, S);
  sc.cone([-0.5, 2.28, 0.06], [-0.56, 2.62, 0.06], 0.064, 0.052, S);
  sc.ellipsoid([-0.56, 2.66, 0.06], [0.06, 0.065, 0.06], M_ID, S);
  sc.sphere([-0.56, 2.55, 0.06], 0.04, { g: 2, mat: B.mats.skin, k: 0.005 });
  sc.cone([-0.56, 2.58, 0.06], [-0.56, 2.76, 0.06], 0.026, 0.026, { g: 2, mat: B.mats.skin, k: 0.005 });
  sc.box([-0.56, 2.77, 0.06], [0.22, 0.028, 0.05], M_ID, 0.012, { g: 2, mat: B.mats.skin, k: 0.008 });
  sc.box([-0.56, 3.22, 0.06], [0.05, 0.44, 0.014], M_ID, 0.008, { g: 2, mat: B.mats.skin, k: 0.004 });
  sc.cone([-0.56, 3.64, 0.06], [-0.56, 3.78, 0.06], 0.045, 0.004, { g: 2, mat: B.mats.skin, k: 0.004 });
  sc.box([-0.56, 3.15, 0.075], [0.008, 0.36, 0.006], M_ID, 0.002, { g: 2, sub: true, k: 0.002 });
  // Right arm: forearm ends at the wrist (Tyr's lost hand); from the stump
  // hang the Scales of Justice on a short chain.
  sc.cone([0.32, 1.96, 0], [0.42, 1.62, 0.16], 0.08, 0.064, S);
  sc.cone([0.42, 1.62, 0.16], [0.5, 1.5, 0.36], 0.064, 0.052, S);
  sc.cone([0.5, 1.47, 0.38], [0.5, 1.3, 0.42], 0.016, 0.016, { g: 2, mat: B.mats.skin, k: 0.004 });
  // (the gilt beam and pans themselves are metal, added by the diorama)
  // Carved detail: a mantle draped over the shoulders with a hem band, chest
  // folds, beard strands, cuffs and a knotted blindfold trailing behind.
  sc.ellipsoid([0, 1.9, -0.02], [0.4, 0.1, 0.25], M_ID, { ...S, k: 0.03, grow: 0.02, clip: [[0, -1, 0, -1.82]] });
  for (let k = 0; k < 5; k++) {
    const x = (k - 2) * 0.09;
    sc.box([x, 1.66, 0.22 - Math.abs(x) * 0.25], [0.012, 0.16, 0.02], mEuler(0.1, 0, x * 0.6), 0.006, { g: 0, sub: true, k: 0.02 });
  }
  for (let k = 0; k < 6; k++) {
    const x = (k - 2.5) * 0.028;
    sc.box([x, 2.07, 0.14], [0.004, 0.08, 0.02], mEuler(0.25, 0, x * 2.0), 0.002, { g: 0, sub: true, k: 0.006 });
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    sc.box([Math.sin(a) * 0.41, 0.55, Math.cos(a) * 0.37], [0.014, 0.5, 0.02], mEuler(0, a, 0), 0.008, { g: 0, sub: true, k: 0.03 });
  }
    sc.torus([0.48, 1.53, 0.31], 0.062, 0.014, mEuler(1.1, 0, 0.4), { g: 1, mat: B.mats.skin, k: 0.008 });
  sc.ellipsoid([0, 2.3, -0.15], [0.04, 0.03, 0.03], M_ID, { g: 1, mat: B.mats.dark, k: 0.01 });
  sc.cone([0.02, 2.29, -0.16], [0.05, 2.1, -0.2], 0.02, 0.012, { g: 1, mat: B.mats.dark, k: 0.01 });
  sc.cone([-0.02, 2.29, -0.16], [-0.06, 2.12, -0.19], 0.02, 0.012, { g: 1, mat: B.mats.dark, k: 0.01 });
  // Weathering: a great crack, chips, moss in the folds.
  sc.box([0.1, 1.2, 0.3], [0.008, 0.6, 0.06], mEuler(0, 0, 0.25), 0.003, { g: 0, sub: true, k: 0.004 });
  sc.sphere([0.2, 1.98, 0.12], 0.05, { g: 0, sub: true, k: 0.02 });
  sc.sphere([-0.3, 1.1, 0.3], 0.06, { g: 0, sub: true, k: 0.02 });
  sc.sphere([0.1, 0.25, 0.4], 0.07, { g: 0, sub: true, k: 0.025 });
  sc.box([-0.15, 0.9, 0.36], [0.006, 0.4, 0.05], mEuler(0, 0, -0.4), 0.002, { g: 0, sub: true, k: 0.004 });
  for (let k = 0; k < 5; k++) sc.ellipsoid([Math.sin(k * 1.7) * 0.38, 0.05 + k * 0.02, Math.cos(k * 1.7) * 0.33], [0.08, 0.04, 0.08], M_ID, { g: 3, mat: B.mats.moss, k: 0.03 });
  const m = meshSculpt(sc, { cell: 0.012, ao: 0.03 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  _statue = geo;
  return geo;
}
