import { Figure, mat, add, sub, scl, norm, cross, ap3, mul3, rotX, rotY, rotZ, euler, alignY, ik, mixc, shade, hex } from './sculpt.js';
import { rngOf } from './paint.js';
import { sculptHead, handShape } from './anatomy.js';

/**
 * Procedural rigs for the lit-clay figure renderer (sculpt.js): a humanoid
 * skeleton solved with two-bone IK, seeded poses and gear, eleven head
 * sculpts, weapons gripped by real fists, shields, armour and clothing, plus
 * the species table. Everything is built in figure units (≈ 1 = rig height,
 * feet on y = 0, facing +z toward the viewer; the character's right hand is
 * on the viewer's left, −x).
 *
 *   buildCreature(id, seed, {pose, leader}) → {fig, spec}
 *   buildPerson(look, {pose, ...}) → {fig}       (NPCs: clerk, smith, priest...)
 */

// ------------------------------------------------------------------ materials

export const M = {
  wood: mat('#6a4a2c', { pattern: 'wood', scale: 0.02, rough: 0.8, spec: 0.08 }),
  darkWood: mat('#3e2a18', { pattern: 'wood', scale: 0.02, rough: 0.8, spec: 0.08 }),
  iron: mat('#8a8c94', { pattern: 'metal', metal: true, rough: 0.35, spec: 0.9, scale: 0.05 }),
  steel: mat('#b8bcc6', { pattern: 'metal', metal: true, rough: 0.25, spec: 1, scale: 0.05 }),
  bronze: mat('#a07838', { pattern: 'metal', metal: true, rough: 0.35, spec: 0.9, scale: 0.05 }),
  gold: mat('#d4a84a', { metal: true, rough: 0.25, spec: 1 }),
  leather: mat('#5a3a22', { pattern: 'leather', scale: 0.03, rough: 0.6, spec: 0.2 }),
  darkLeather: mat('#2e2016', { pattern: 'leather', scale: 0.03, rough: 0.6, spec: 0.2 }),
  rope: mat('#8a7450', { pattern: 'cloth', scale: 0.006 }),
  bone: mat('#d8ccae', { pattern: 'bone', scale: 0.02, rough: 0.6, spec: 0.25, sss: 0.3 }),
  tooth: mat('#efe6cc', { rough: 0.4, spec: 0.4 }),
  dark: mat('#0c0806', { rough: 1, spec: 0, ink: 0 }),
  mouth: mat('#3a0e0a', { rough: 0.5, spec: 0.3, ink: 0.3 }),
  white: mat('#f2eee4', { rough: 0.3, spec: 0.6, ink: 0 }),
};
const eyeMat = (c) => mat('#000000', { emissive: c, ink: 0, rough: 0.2, spec: 0.8 });

// ------------------------------------------------------------------ species

/**
 * Humanoid species. legs: hip height (fraction of rig height); torso: pelvis→neck;
 * headR: head radius; build: girth; arm: arm length factor.
 */
export const SPECIES = {
  kobold: { head: 'kobold', skin: '#7e4026', skin2: '#3e2a22', skin3: '#9a6a34', pattern: 'scales', legs: 0.4, torso: 0.3, headR: 0.085, build: 0.8, digi: true, tail: 0.42, hunch: 0.22, cloth: ['#4a3a28', '#5a2a1a', '#3a3424', '#6a5a3a'], weapons: ['spear', 'spear', 'spear', 'shortsword', 'club', 'axe'], shield: 0.25, helm: 0.3, eyes: '#ffb020', claws: true },
  koboldChief: { head: 'kobold', skin: '#7a6a5a', skin2: '#a89070', pattern: 'scales', legs: 0.4, torso: 0.31, headR: 0.085, build: 0.92, digi: true, tail: 0.45, hunch: 0.18, cloth: ['#6a1e1a'], cape: '#5a1a14', weapons: ['longsword'], shield: 0, helm: 1, eyes: '#ffc030', claws: true, chief: true },
  goblin: { head: 'goblin', skin: '#7a8a3a', skin2: '#9aa04a', pattern: 'skin', legs: 0.42, torso: 0.3, headR: 0.09, build: 0.82, hunch: 0.15, cloth: ['#4a3020', '#3a3a28', '#5a2a1a'], weapons: ['shortsword', 'club', 'spear', 'axe'], shield: 0.35, helm: 0.3, eyes: '#ffe040' },
  orc: { head: 'orc', skin: '#5e6e44', skin2: '#4a5a34', pattern: 'skin', legs: 0.47, torso: 0.33, headR: 0.07, build: 1.18, hunch: 0.15, cloth: ['#3a2a1c', '#2a2218'], armor: 'scraps', weapons: ['axe', 'axe', 'mace', 'longsword', 'spear'], shield: 0.3, helm: 0.4, eyes: '#ff3a18' },
  orcLeader: { head: 'orc', skin: '#56663e', skin2: '#46562e', pattern: 'skin', legs: 0.47, torso: 0.34, headR: 0.07, build: 1.3, hunch: 0.1, cloth: ['#2a1a12'], armor: 'plate', cape: '#4a1010', weapons: ['greataxe'], shield: 0, helm: 1, eyes: '#ff3a18' },
  hobgoblin: { head: 'hobgoblin', skin: '#b0582a', skin2: '#c86a34', pattern: 'skin', legs: 0.48, torso: 0.33, headR: 0.07, build: 1.1, hunch: 0.05, cloth: ['#5a1e18'], armor: 'scale', weapons: ['longsword', 'spear', 'mace'], shield: 0.7, helm: 0.6, eyes: '#ffa020' },
  hobgoblinChief: { head: 'hobgoblin', skin: '#a04a22', skin2: '#b05a2a', pattern: 'skin', legs: 0.48, torso: 0.34, headR: 0.07, build: 1.2, cloth: ['#1a1612'], armor: 'plate', cape: '#1a1612', weapons: ['longsword'], shield: 1, helm: 1, eyes: '#ffa020' },
  gnoll: { head: 'gnoll', skin: '#9a7a4a', skin2: '#6a5030', pattern: 'fur', legs: 0.46, torso: 0.34, headR: 0.075, build: 1.15, digi: true, hunch: 0.25, cloth: ['#3a2e22'], armor: 'scraps', weapons: ['flail', 'spear', 'axe'], shield: 0.2, eyes: '#ffd040' },
  bugbear: { head: 'bugbear', skin: '#7a5a30', skin2: '#5a4020', pattern: 'fur', legs: 0.46, torso: 0.35, headR: 0.075, build: 1.35, hunch: 0.18, cloth: ['#3a2a1a'], armor: 'scraps', weapons: ['mace', 'club'], shield: 0, eyes: '#ffc040' },
  lizardMan: { head: 'lizard', skin: '#4a6a3a', skin2: '#8a9a5a', pattern: 'scales', legs: 0.46, torso: 0.33, headR: 0.07, build: 1.05, tail: 0.55, hunch: 0.1, cloth: ['#4a3a20'], weapons: ['spear', 'club'], shield: 0.6, eyes: '#ffe040' },
  thug: { head: 'human', skin: '#c08a6a', legs: 0.5, torso: 0.32, headR: 0.064, build: 1.05, cloth: ['#4a3a2a', '#3a3a40', '#5a4a30'], armor: 'vest', hood: 0.6, weapons: ['club', 'club', 'dagger'], shield: 0, human: true },
  bandit: { head: 'human', skin: '#b07a5a', legs: 0.5, torso: 0.32, headR: 0.064, build: 1.0, cloth: ['#5a4a30', '#3a3020'], armor: 'vest', hood: 0.8, weapons: ['shortsword', 'longsword', 'spear'], shield: 0.2, human: true },
  buccaneer: { head: 'human', skin: '#b07a5a', legs: 0.5, torso: 0.32, headR: 0.064, build: 1.0, cloth: ['#c8b8a0', '#a8a090'], armor: 'vest', bandana: ['#8a1a1a', '#1a3a6a', '#2a2a2a'], weapons: ['shortsword', 'dagger'], shield: 0, human: true },
  banditLeader: { head: 'human', skin: '#b07a5a', legs: 0.5, torso: 0.33, headR: 0.064, build: 1.1, cloth: ['#6a1a1a'], armor: 'scale', cape: '#2a1a14', bandana: ['#1a1a1a'], weapons: ['longsword'], shield: 0, human: true },
  acolyte: { head: 'human', skin: '#b08a6a', legs: 0.5, torso: 0.32, headR: 0.064, build: 0.95, cloth: ['#141414'], armor: 'robe', hood: 1, weapons: ['mace'], shield: 0, human: true, eyes: '#60ff80' },
  banePriest: { head: 'human', skin: '#a08070', legs: 0.5, torso: 0.33, headR: 0.064, build: 1.05, cloth: ['#0e0e0e'], armor: 'robe', hood: 1, cape: '#1a3a1a', weapons: ['mace'], shield: 0, human: true, eyes: '#60ff80', gauntlet: true },
  human: { head: 'human', skin: '#c08a6a', legs: 0.5, torso: 0.32, headR: 0.064, build: 1.0, cloth: ['#4a3a2a'], armor: 'vest', hood: 0.5, weapons: ['longsword'], shield: 0.3, human: true },
  skeleton: { head: 'skull', skin: '#d8ccb0', legs: 0.5, torso: 0.32, headR: 0.06, build: 0.75, skeletal: true, weapons: ['longsword', 'spear', 'axe'], shield: 0.6, eyes: '#60d0ff', cloth: ['#3a3028'] },
  zombie: { head: 'zombie', skin: '#7a8a6a', skin2: '#5a6a4a', pattern: 'skin', legs: 0.5, torso: 0.32, headR: 0.064, build: 1.0, hunch: 0.25, cloth: ['#3a3a30', '#4a3a2a'], armor: 'rags', weapons: [null], shield: 0, eyes: '#c0ff60', reach: true },
  ghoul: { head: 'zombie', skin: '#9a9a8a', skin2: '#7a7a6a', pattern: 'skin', legs: 0.48, torso: 0.32, headR: 0.064, build: 0.88, hunch: 0.4, cloth: ['#2a2a28'], armor: 'rags', weapons: [null], shield: 0, eyes: '#ff4030', claws: true, reach: true },
  ghast: { head: 'zombie', skin: '#8a8a7a', skin2: '#6a6a5a', pattern: 'skin', legs: 0.48, torso: 0.32, headR: 0.064, build: 0.95, hunch: 0.35, cloth: ['#1a1a18'], armor: 'rags', weapons: [null], shield: 0, eyes: '#ff2020', claws: true, reach: true },
  wight: { head: 'zombie', skin: '#8a9098', skin2: '#6a7078', pattern: 'skin', legs: 0.5, torso: 0.32, headR: 0.064, build: 1.0, hunch: 0.1, cloth: ['#2a2a3a'], armor: 'robe', weapons: ['longsword'], shield: 0, eyes: '#a0e8ff', crown: true },
  ogre: { head: 'ogre', skin: '#a08a5a', skin2: '#8a7448', pattern: 'skin', legs: 0.44, torso: 0.36, headR: 0.06, build: 1.55, hunch: 0.15, cloth: ['#4a3a28'], armor: 'scraps', weapons: ['bigclub'], shield: 0, eyes: '#ffa060', belly: true },
  hillGiant: { head: 'ogre', skin: '#b0906a', skin2: '#9a7a58', pattern: 'skin', legs: 0.45, torso: 0.36, headR: 0.058, build: 1.6, hunch: 0.1, cloth: ['#5a4a30'], armor: 'fur', weapons: ['bigclub'], shield: 0, eyes: '#ffa060', belly: true },
  troll: { head: 'troll', skin: '#4a6a3a', skin2: '#3a5a2a', pattern: 'skin', legs: 0.46, torso: 0.34, headR: 0.06, build: 0.95, hunch: 0.38, arm: 1.3, cloth: ['#2a2a1a'], armor: 'rags', weapons: [null], shield: 0, eyes: '#ffe020', claws: true, reach: true },
  ghostKnight: { head: 'human', skin: '#a8d8e0', legs: 0.5, torso: 0.33, headR: 0.064, build: 1.08, cloth: ['#3a6070'], armor: 'plate', cape: '#2a5060', weapons: ['longsword'], shield: 0, human: true, ghost: true, helm: 1 },
};

// ------------------------------------------------------------------ pieces

/** A gripping fist around a shaft along local +Y (origin = palm centre). */
function fist(f, at, dir, s, skinM, side, { claws = false, gauntlet = null } = {}) {
  f.push(at, alignY(dir, [side, 0, 0]), s);
  handShape(f, gauntlet ?? skinM, side, { grip: true, claws });
  f.pop();
}

/** An open hand / claw. */
function openHand(f, at, dir, s, skinM, side, { claws = false, spread = 0.5, curl = 0.35 } = {}) {
  f.push(at, alignY(dir, [side, 0, 0]), s);
  handShape(f, skinM, side, { claws, spread, curl });
  f.pop();
}

const WEAPON_GRIP2 = { spear: 0.26, greataxe: 0.22, bigclub: 0.2, staff: 0.3 };

/** Weapon along local +Y from the primary grip. Returns the second grip offset (or null). */
export function weapon(f, kind, at, dir, side, { len = 1, down = 0.35 } = {}) {
  if (!kind) return null;
  f.push(at, alignY(dir, [side, 0, 0]), 1);
  const g = { group: null, blend: 0 };
  switch (kind) {
    case 'spear':
    case 'javelin': {
      const r = kind === 'spear' ? 0.0105 : 0.008;
      f.cone([0, -down, 0], [0, 0.6 * len, 0], r, r * 0.85, M.wood, g);
      f.cone([0, 0.585 * len, 0], [0, 0.63 * len, 0], 0.013, 0.012, M.rope, g);
      f.ell([0, 0.7 * len, 0], [0.024, 0.085, 0.007], M.iron, g);
      f.cone([0, 0.63 * len, 0], [0, 0.66 * len, 0], 0.012, 0.01, M.iron, g);
      break;
    }
    case 'shortsword':
    case 'longsword': {
      const L = kind === 'longsword' ? 0.42 : 0.3;
      f.sphere([0, -0.06, 0], 0.017, M.bronze, g);
      f.cone([0, -0.05, 0], [0, 0.045, 0], 0.012, 0.011, M.darkLeather, g);
      f.box([0, 0.06, 0], [0.058, 0.009, 0.014], M.bronze, { ...g, bevel: 0.006 });
      f.box([0, 0.07 + L / 2, 0], [0.018, L / 2, 0.0045], M.steel, { ...g, bevel: 0.004 });
      f.ell([0, 0.07 + L, 0], [0.018, 0.035, 0.0045], M.steel, g);
      f.box([0, 0.07 + L * 0.45, 0.003], [0.003, L * 0.42, 0.002], mat('#6a6c74', { metal: true, rough: 0.4, spec: 0.6, ink: 0 }), { ...g, bevel: 0.001 });
      break;
    }
    case 'dagger': {
      f.cone([0, -0.04, 0], [0, 0.03, 0], 0.01, 0.009, M.darkLeather, g);
      f.box([0, 0.04, 0], [0.032, 0.007, 0.01], M.iron, { ...g, bevel: 0.004 });
      f.ell([0, 0.12, 0], [0.015, 0.08, 0.004], M.steel, g);
      break;
    }
    case 'axe':
    case 'greataxe': {
      const big = kind === 'greataxe';
      const L = big ? 0.75 : 0.5;
      f.cone([0, big ? -0.3 : -0.07, 0], [0, L, 0], 0.012, 0.011, M.wood, g);
      const hy = L - 0.06;
      f.box([side * -0.035, hy, 0], [0.03, big ? 0.05 : 0.035, 0.008], M.iron, { ...g, bevel: 0.006 });
      f.ell([side * -0.075, hy, 0], [0.025, big ? 0.1 : 0.065, 0.006], M.steel, g);
      if (big) f.ell([side * 0.06, hy, 0], [0.022, 0.08, 0.006], M.steel, g);
      f.cone([0, hy - 0.05, 0], [0, hy - 0.02, 0], 0.014, 0.014, M.leather, g);
      break;
    }
    case 'club':
    case 'bigclub': {
      const k = kind === 'bigclub' ? 1.35 : 1;
      f.cone([0, -0.06 * k, 0], [0, 0.42 * k, 0], 0.013 * k, 0.034 * k, M.wood, g);
      f.sphere([0, 0.42 * k, 0], 0.034 * k, M.wood, g);
      for (let i = 0; i < 4; i++) f.sphere([(i % 2 ? 1 : -1) * 0.024 * k, (0.2 + i * 0.06) * k, (i % 3 - 1) * 0.012], 0.01 * k, M.darkWood, g);
      if (kind === 'bigclub') for (let i = 0; i < 3; i++) f.cone([0.03 * k, (0.3 + i * 0.05) * k, 0], [0.05 * k, (0.31 + i * 0.05) * k, 0.01], 0.006, 0.002, M.iron, g);
      break;
    }
    case 'mace': {
      f.cone([0, -0.06, 0], [0, 0.34, 0], 0.011, 0.011, M.darkWood, g);
      f.sphere([0, 0.37, 0], 0.035, M.iron, g);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        f.box([Math.cos(a) * 0.035, 0.37, Math.sin(a) * 0.035], [0.012, 0.04, 0.004], M.iron, { ...g, R: rotY(-a), bevel: 0.003 });
      }
      break;
    }
    case 'flail': {
      f.cone([0, -0.06, 0], [0, 0.26, 0], 0.011, 0.011, M.darkWood, g);
      for (let i = 0; i < 5; i++) f.sphere([side * -0.012 * i, 0.28 + i * 0.022, 0.004 * i], 0.006, M.iron, g);
      f.sphere([side * -0.07, 0.4, 0.02], 0.034, M.iron, g);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        f.cone([side * -0.07 + Math.cos(a) * 0.03, 0.4 + Math.sin(a) * 0.03, 0.02], [side * -0.07 + Math.cos(a) * 0.05, 0.4 + Math.sin(a) * 0.05, 0.02], 0.007, 0.001, M.iron, g);
      }
      break;
    }
    case 'staff': {
      f.cone([0, -down, 0], [0, 0.8, 0], 0.012, 0.011, M.wood, g);
      break;
    }
    case 'quill': {
      f.cone([0, -0.02, 0], [0, 0.06, 0], 0.003, 0.002, M.darkWood, g);
      f.ell([0.006, 0.1, 0], [0.012, 0.06, 0.002], mat('#e8e0d0', { pattern: 'fur', scale: 0.004 }), g);
      break;
    }
    case 'tongs': {
      for (const d of [-1, 1]) f.cone([d * 0.006, -0.04, 0], [d * 0.012, 0.22, 0], 0.006, 0.005, M.iron, g);
      f.box([0, 0.25, 0], [0.03, 0.02, 0.012], mat('#ff7a20', { emissive: '#ff6a10', rough: 0.4 }), { ...g, bevel: 0.006 });
      f.glow([0, 0.25, 0], 0.05, '#ff7a20', 0.9);
      break;
    }
    case 'tankard': {
      f.cone([0.03, -0.03, 0.02], [0.03, 0.06, 0.02], 0.032, 0.03, M.darkWood, g);
      f.ell([0.03, 0.065, 0.02], [0.029, 0.008, 0.028], mat('#e8dcc0', { rough: 0.9 }), g);
      for (const y of [-0.015, 0.045]) f.ell([0.03, y, 0.02], [0.034, 0.006, 0.033], M.iron, g);
      break;
    }
    case 'hammer': {
      f.cone([0, -0.06, 0], [0, 0.3, 0], 0.011, 0.011, M.darkWood, g);
      f.box([0, 0.31, 0], [0.06, 0.026, 0.026], M.iron, { ...g, bevel: 0.008 });
      break;
    }
    default:
      break;
  }
  f.pop();
  return WEAPON_GRIP2[kind] ?? null;
}

export function shield(f, kind, at, facing, wood) {
  f.push(at, facing, 1);
  const g = { group: null };
  if (kind === 'kite') {
    f.box([0, 0.03, 0], [0.11, 0.1, 0.014], wood, { ...g, bevel: 0.01 });
    f.ell([0, -0.08, 0], [0.11, 0.14, 0.014], wood, g);
    f.box([0, 0.03, 0.012], [0.112, 0.012, 0.006], M.iron, { ...g, bevel: 0.004 });
    f.sphere([0, 0.0, 0.014], 0.03, mat('#9a2a1a', { rough: 0.5, spec: 0.3 }), g);
  } else {
    f.ell([0, 0, 0], [0.12, 0.12, 0.016], wood, g);
    f.ell([0, 0, -0.004], [0.126, 0.126, 0.012], M.iron, g);
    f.sphere([0, 0, 0.012], 0.032, M.iron, g);
    for (let i = 0; i < 3; i++) f.box([(i - 1) * 0.06, 0, 0.011], [0.004, 0.11 - Math.abs(i - 1) * 0.03, 0.003], M.darkWood, { ...g, bevel: 0.002 });
  }
  f.pop();
}

// ------------------------------------------------------------------ heads (unit = head radius, +z = face)

function head(f, kind, sp, skinM, R, o = {}) {
  const eye = sp.eyes ? eyeMat(sp.eyes) : null;
  const g = { group: 'head', blend: 0.08 };
  const hard = { group: null, blend: 0 };
  const eyes = (x, y, z, r, slit = false) => {
    for (const d of [-1, 1]) {
      f.ell([d * x, y, z - 0.05], [r * 1.5, r * 1.15, r], M.dark, { group: null });
      if (eye) {
        f.ell([d * x, y, z], slit ? [r * 0.95, r * 0.6, r * 0.5] : [r, r, r * 0.6], eye, hard);
        f.glow([d * x, y, z + r * 0.4], r * 4.5, sp.eyes, 0.8);
      }
    }
  };
  switch (kind) {
    case 'kobold': {
      // narrow cranium swept back over a long, dog-like reptilian muzzle
      f.ell([0, 0.12, -0.18], [0.74, 0.7, 0.84], skinM, g);
      f.ell([0, -0.12, 0.05], [0.66, 0.5, 0.62], skinM, g);
      // upper jaw: a tapering muzzle with a flat nasal ridge on top
      f.cone([0, -0.04, 0.3], [0, -0.16, 1.82], 0.46, 0.17, skinM, g);
      f.ell([0, 0.1, 0.95], [0.26, 0.13, 0.8], skinM, { ...g, R: rotX(0.08) });
      // lower jaw hanging slightly open, a dark mouth and a tongue between
      f.cone([0, -0.4, 0.2], [0, -0.6, 1.5], 0.3, 0.12, skinM, g);
      f.cone([0, -0.3, 0.42], [0, -0.42, 1.52], 0.27, 0.1, M.mouth, { group: null, blend: 0 });
      f.cone([0, -0.42, 0.6], [0, -0.48, 1.25], 0.12, 0.07, mat('#8a2a2a', { rough: 0.35, spec: 0.5 }), { group: null, blend: 0 });
      // needle teeth along both jaws
      for (let i = 0; i < 6; i++) for (const d of [-1, 1]) {
        const z = 0.62 + i * 0.17;
        const x = d * (0.24 - i * 0.025);
        f.cone([x, -0.2 - i * 0.02, z], [x * 0.96, -0.36 - i * 0.02, z + 0.02], 0.04, 0.008, M.tooth, hard);
        if (i % 2 === 0) f.cone([x * 0.9, -0.5 - i * 0.022, z], [x * 0.88, -0.38 - i * 0.022, z + 0.02], 0.032, 0.007, M.tooth, hard);
      }
      // nostrils at the snout tip
      for (const d of [-1, 1]) f.ell([d * 0.08, -0.06, 1.8], [0.045, 0.03, 0.04], M.dark, hard);
      // heavy brow ridges slanting down toward the snout: a scowl
      for (const d of [-1, 1]) {
        f.ell([d * 0.36, 0.34, 0.58], [0.3, 0.12, 0.3], skinM, { ...g, R: rotZ(d * 0.38) });
        f.ell([d * 0.5, -0.12, 0.4], [0.18, 0.16, 0.28], skinM, g); // cheek scute
        // short horns curving back from the brow
        f.cone([d * 0.32, 0.58, 0.0], [d * 0.46, 0.92, -0.42], 0.17, 0.09, M.bone, hard);
        f.cone([d * 0.46, 0.92, -0.42], [d * 0.5, 1.0, -0.85], 0.09, 0.02, M.bone, hard);
        // swept, finned ears
        f.ell([d * 0.68, 0.18, -0.5], [0.07, 0.24, 0.42], skinM, { ...g, R: mul3(rotY(d * 0.5), rotX(-0.5)) });
      }
      // a row of small spines down the back of the skull
      for (let i = 0; i < 4; i++) f.cone([0, 0.7 - i * 0.18, -0.55 - i * 0.18], [0, 0.88 - i * 0.2, -0.75 - i * 0.2], 0.07, 0.01, skinM, hard);
      eyes(0.4, 0.18, 0.66, 0.12, true);
      break;
    }
    case 'goblin': {
      f.ell([0, 0.05, 0], [1.05, 0.88, 0.9], skinM, g);
      f.ell([0, -0.4, 0.45], [0.7, 0.42, 0.55], skinM, g);
      f.cone([0, 0.05, 0.8], [0, -0.25, 1.25], 0.2, 0.12, skinM, g);
      f.ell([0, -0.5, 0.85], [0.45, 0.06, 0.12], M.mouth, hard);
      for (let i = -2; i <= 2; i++) f.cone([i * 0.14, -0.46, 0.92], [i * 0.14, -0.58, 0.95], 0.04, 0.01, M.tooth, hard);
      for (const d of [-1, 1]) {
        f.ell([d * 1.45, 0.3, -0.15], [0.7, 0.28, 0.08], skinM, { ...g, R: rotZ(d * -0.35) });
        f.ell([d * 0.4, 0.38, 0.7], [0.32, 0.12, 0.2], skinM, g);
      }
      eyes(0.4, 0.18, 0.78, 0.13);
      break;
    }
    case 'orc':
    case 'hobgoblin': {
      const orc = kind === 'orc';
      f.ell([0, 0.1, 0], [0.92, 1, 0.95], skinM, g);
      f.ell([0, -0.45, 0.4], [0.82, 0.5, 0.62], skinM, g);
      // heavy brow
      f.ell([0, 0.32, 0.72], [0.82, 0.2, 0.3], skinM, g);
      if (orc) {
        f.ell([0, -0.08, 1.0], [0.3, 0.24, 0.2], skinM, g);
        for (const d of [-1, 1]) f.sphere([d * 0.1, -0.12, 1.16], 0.07, M.dark, hard);
        for (const d of [-1, 1]) f.cone([d * 0.38, -0.7, 0.88], [d * 0.44, -0.18, 0.98], 0.1, 0.03, M.tooth, hard);
        f.cone([0, 0.9, -0.3], [0, 1.6, -0.6], 0.22, 0.12, mat('#141210', { pattern: 'fur', scale: 0.01 }), hard);
      } else {
        f.cone([0, 0.1, 0.9], [0, -0.2, 1.18], 0.18, 0.13, skinM, g);
        f.ell([0, -0.85, 0.5], [0.55, 0.4, 0.4], mat('#1a1210', { pattern: 'fur', scale: 0.008 }), hard);
      }
      f.ell([0, -0.55, 0.95], [0.38, 0.05, 0.1], M.mouth, hard);
      for (const d of [-1, 1]) f.cone([d * 0.85, 0.15, -0.1], [d * 1.4, 0.6, -0.3], 0.18, 0.03, skinM, g);
      eyes(0.36, 0.12, 0.84, 0.1);
      break;
    }
    case 'gnoll': {
      f.ell([0, 0.1, -0.1], [0.85, 0.9, 0.9], skinM, g);
      f.cone([0, -0.1, 0.4], [0, -0.3, 1.6], 0.5, 0.26, skinM, g);
      f.cone([0, -0.45, 0.3], [0, -0.5, 1.35], 0.34, 0.18, skinM, g);
      f.sphere([0, -0.2, 1.62], 0.16, M.dark, hard);
      for (let i = 0; i < 4; i++) for (const d of [-1, 1]) f.cone([d * 0.16, -0.36, 0.8 + i * 0.16], [d * 0.15, -0.5, 0.82 + i * 0.16], 0.04, 0.01, M.tooth, hard);
      for (const d of [-1, 1]) f.ell([d * 0.55, 0.95, -0.2], [0.24, 0.42, 0.12], skinM, { ...g, R: rotZ(d * -0.3) });
      // mane down the neck
      f.ell([0, 0.5, -0.7], [0.5, 0.9, 0.5], mat('#3a2814', { pattern: 'fur', scale: 0.012 }), hard);
      eyes(0.4, 0.22, 0.66, 0.11);
      break;
    }
    case 'bugbear': {
      f.ell([0, 0.05, 0], [1.05, 1, 0.95], skinM, g);
      f.ell([0, -0.4, 0.55], [0.6, 0.45, 0.5], skinM, g);
      f.sphere([0, -0.2, 1.02], 0.18, M.dark, hard);
      for (const d of [-1, 1]) f.sphere([d * 0.82, 0.75, -0.1], 0.28, skinM, g);
      f.ell([0, -0.62, 0.95], [0.4, 0.06, 0.1], M.mouth, hard);
      for (const d of [-1, 1]) f.cone([d * 0.25, -0.6, 0.98], [d * 0.24, -0.4, 1.02], 0.06, 0.015, M.tooth, hard);
      eyes(0.38, 0.15, 0.84, 0.1);
      break;
    }
    case 'lizard': {
      f.ell([0, 0.08, -0.1], [0.82, 0.78, 0.95], skinM, g);
      f.cone([0, -0.05, 0.3], [0, -0.22, 1.5], 0.55, 0.28, skinM, g);
      f.cone([0, -0.4, 0.2], [0, -0.46, 1.3], 0.38, 0.2, skinM, g);
      for (const d of [-1, 1]) f.ell([d * 0.7, 0.05, -0.45], [0.08, 0.5, 0.45], mat(sp.skin2 ?? '#8a9a5a', { pattern: 'scales', scale: 0.005 }), { ...g, R: rotZ(d * 0.3) });
      f.cone([0, 0.75, -0.2], [0, 0.6, -1.2], 0.12, 0.04, mat('#a04a2a'), hard);
      eyes(0.5, 0.22, 0.55, 0.14, true);
      break;
    }
    case 'skull': {
      const b = M.bone;
      f.ell([0, 0.12, 0], [0.86, 0.9, 1], b, g);
      f.ell([0, -0.35, 0.45], [0.62, 0.45, 0.5], b, g);
      for (const d of [-1, 1]) f.ell([d * 0.34, 0.0, 0.78], [0.24, 0.22, 0.2], M.dark, hard);
      f.cone([0, -0.2, 0.92], [0, -0.38, 0.92], 0.09, 0.04, M.dark, hard);
      f.ell([0, -0.78, 0.4], [0.5, 0.18, 0.42], b, { ...g, R: rotX(0.25) });
      for (let i = -3; i <= 3; i++) f.box([i * 0.11, -0.56, 0.86 - Math.abs(i) * 0.03], [0.045, 0.07, 0.03], M.tooth, { group: null, bevel: 0.02 });
      if (eye) for (const d of [-1, 1]) { f.sphere([d * 0.34, 0.0, 0.82], 0.07, eye, hard); f.glow([d * 0.34, 0, 0.9], 0.5, sp.eyes, 0.9); }
      break;
    }
    case 'zombie': {
      f.ell([0, 0.1, 0], [0.82, 0.98, 0.95], skinM, g);
      f.ell([0, -0.45, 0.35], [0.62, 0.45, 0.55], skinM, { ...g, R: rotX(0.3) });
      for (const d of [-1, 1]) f.ell([d * 0.32, 0.05, 0.78], [0.22, 0.18, 0.18], M.dark, hard);
      f.ell([0, -0.62, 0.78], [0.3, 0.2, 0.15], M.mouth, hard);
      for (let i = -2; i <= 2; i++) f.cone([i * 0.1, -0.48, 0.86], [i * 0.1, -0.6, 0.86], 0.04, 0.012, M.tooth, hard);
      f.cone([0, -0.05, 0.9], [0, -0.25, 1.0], 0.1, 0.06, skinM, g);
      // stringy hair
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + i * 0.4;
        f.cone([Math.sin(a) * 0.75, 0.7, Math.cos(a) * 0.4 - 0.3], [Math.sin(a) * 0.95, -0.4 - R() * 0.3, Math.cos(a) * 0.3 - 0.4], 0.07, 0.02, mat('#2a261c', { pattern: 'fur', scale: 0.006 }), hard);
      }
      if (eye) for (const d of [-1, 1]) { f.sphere([d * 0.32, 0.05, 0.82], 0.07, eye, hard); f.glow([d * 0.32, 0.05, 0.9], 0.45, sp.eyes, 0.8); }
      if (sp.crown) for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        f.cone([Math.sin(a) * 0.82, 0.62, Math.cos(a) * 0.82], [Math.sin(a) * 0.86, 0.95, Math.cos(a) * 0.86], 0.08, 0.02, M.gold, hard);
      }
      if (sp.crown) f.ell([0, 0.62, 0], [0.88, 0.1, 0.88], M.gold, hard);
      break;
    }
    case 'ogre': {
      f.ell([0, 0.1, 0], [1.0, 0.92, 0.95], skinM, g);
      f.ell([0, -0.5, 0.35], [1.0, 0.6, 0.7], skinM, g);
      f.ell([0, 0.3, 0.72], [0.9, 0.22, 0.32], skinM, g);
      f.ell([0, -0.05, 0.98], [0.3, 0.26, 0.24], skinM, g);
      for (const d of [-1, 1]) f.cone([d * 0.45, -0.8, 0.9], [d * 0.5, -0.3, 1.0], 0.1, 0.03, M.tooth, hard);
      f.ell([0, -0.62, 0.98], [0.5, 0.06, 0.12], M.mouth, hard);
      for (const d of [-1, 1]) f.sphere([d * 0.95, 0.05, 0], 0.2, skinM, g);
      f.ell([0, 0.72, -0.15], [0.85, 0.32, 0.8], mat('#2a2016', { pattern: 'fur', scale: 0.01 }), hard);
      eyes(0.34, 0.12, 0.86, 0.09);
      break;
    }
    case 'troll': {
      f.ell([0, 0.12, 0], [0.8, 1.02, 0.9], skinM, g);
      f.cone([0, 0.0, 0.8], [0, -0.45, 1.5], 0.22, 0.1, skinM, g);
      f.ell([0, -0.55, 0.45], [0.62, 0.45, 0.55], skinM, g);
      f.ell([0, -0.72, 0.88], [0.4, 0.07, 0.1], M.mouth, hard);
      for (let i = -2; i <= 2; i++) f.cone([i * 0.12, -0.66, 0.92], [i * 0.12, -0.84, 0.94], 0.045, 0.01, M.tooth, hard);
      for (const d of [-1, 1]) f.cone([d * 0.7, 0.1, -0.1], [d * 1.6, 0.3, -0.25], 0.18, 0.03, skinM, g);
      for (let i = 0; i < 9; i++) {
        const a = -1.6 + i * 0.4;
        f.cone([Math.sin(a) * 0.6, 0.85, Math.cos(a) * 0.5 - 0.2], [Math.sin(a) * 1.0, 1.5 + R() * 0.4, Math.cos(a) * 0.4 - 0.6], 0.1, 0.03, mat('#1a2a14', { pattern: 'fur', scale: 0.008 }), hard);
      }
      eyes(0.32, 0.22, 0.74, 0.1);
      break;
    }
    case 'human':
    default:
      humanHead(f, sp, skinM, o);
      break;
  }
}

/** A human head: skull, jaw, nose, brow, ears, eyes, hair / beard / hood / helm. */
function humanHead(f, sp, skinM, o) {
  sculptHead(f, skinM, o);
}

// ------------------------------------------------------------------ the humanoid rig

/**
 * Solve and build a humanoid.
 * pose: {stance, crouch, lean, twist, headYaw, headPitch, headTilt, weaponPose, offPose, sway}
 */
export function humanoid(f, sp, pose, R, gear) {
  const b = sp.build ?? 1;
  const hipH0 = sp.legs ?? 0.5;
  const crouch = pose.crouch ?? 0;
  const hipH = pose.kneel ? (hipH0 - 0.05) * 0.52 + 0.06 : hipH0 * (1 - crouch * 0.28);
  const torso = sp.torso ?? 0.32;
  const hr = sp.headR ?? 0.065;
  const lean = (sp.hunch ?? 0) + (pose.lean ?? 0);
  const twist = pose.twist ?? 0;
  const TR = mul3(rotY(twist), rotX(lean));
  const HR = mul3(rotY(twist * 0.35), rotZ(pose.hipTilt ?? 0));
  const skinM = gear.skinM;
  const clothM = gear.clothM;
  const sway = pose.sway ?? 0;
  const pelvis = [sway, hipH, 0];
  const up = ap3(TR, [0, 1, 0]);
  const chest = add(pelvis, scl(up, torso * 0.62));
  const neck = add(pelvis, scl(up, torso));
  const shW = 0.115 * b * (sp.skeletal ? 0.9 : 1);
  const hipW = 0.062 * b;
  const thigh = (hipH0 - 0.05) * 0.52;
  const shin = (hipH0 - 0.05) * 0.5;
  const armL = (0.31 + (hipH0 < 0.45 ? 0.02 : 0)) * (sp.arm ?? 1);
  const upper = armL * 0.52;
  const fore = armL * 0.48;
  const limb = 0.034 * b * (sp.skeletal ? 0.45 : 1);
  const legR = 0.042 * b * (sp.skeletal ? 0.4 : 1);
  const sk = sp.skeletal;
  const boneM = M.bone;
  const legM = gear.legM ?? skinM;
  const armM = gear.armM ?? skinM;
  const plate = gear.armor === 'plate';
  const robe = gear.armor === 'robe';
  const side = (d) => d; // d = -1 right (viewer left), +1 left

  // ---- legs
  const stance = pose.stance ?? 0.08;
  const feet = {};
  for (const d of [-1, 1]) {
    const hipJ = add(pelvis, ap3(HR, [d * hipW, -0.025, 0]));
    const fz = (pose.footZ?.[d > 0 ? 1 : 0] ?? 0);
    const foot = [sway * 0.4 + d * stance, 0, fz];
    feet[d] = foot;
    if (robe && !pose.kneel) {
      continue;
    }
    if (pose.kneel && d === pose.kneel) {
      // kneeling leg: knee on the ground, shin back
      const knee = [d * stance * 1.1, legR * 0.9, -0.04];
      const ankle = [d * stance * 1.1, legR * 0.7, knee[2] - shin * 0.97];
      limbSeg(f, hipJ, knee, legR * 1.15, legR * 0.85, legM, sk);
      limbSeg(f, knee, ankle, legR * 0.85, legR * 0.6, legM, sk);
      footShape(f, ankle, [0, 0.4, -1], legR, gear, sp, d);
      if (plate) kneeCop(f, knee, gear);
      continue;
    }
    if (pose.kneel) {
      // the other leg: foot planted forward, knee up
      const footP = [d * stance * 1.2, 0, 0.22];
      const ankle = add(footP, [0, 0.05, -0.02]);
      const knee = ik(hipJ, ankle, thigh, shin, [d * 0.1, 0.4, 1]);
      limbSeg(f, hipJ, knee, legR * 1.15, legR * 0.85, legM, sk);
      limbSeg(f, knee, ankle, legR * 0.85, legR * 0.6, legM, sk);
      footShape(f, ankle, [0, 0, 1], legR, gear, sp, d);
      if (plate) kneeCop(f, knee, gear);
      continue;
    }
    if (sp.digi) {
      const hock = add(foot, [0, hipH0 * 0.24, -0.06]);
      const knee = ik(hipJ, hock, thigh * 0.95, shin * 0.85, [d * 0.15, 0.1, 1]);
      limbSeg(f, hipJ, knee, legR * 1.35, legR * 0.85, legM, sk);
      limbSeg(f, knee, hock, legR * 0.8, legR * 0.5, legM, sk);
      limbSeg(f, hock, add(foot, [0, legR * 0.4, 0.02]), legR * 0.5, legR * 0.42, legM, sk);
      // three clawed toes
      for (let t = -1; t <= 1; t++) {
        const a = add(foot, [t * legR * 0.5, legR * 0.35, 0.02]);
        const e = add(a, [t * legR * 0.4, -legR * 0.15, legR * 1.6]);
        f.cone(a, e, legR * 0.32, legR * 0.2, legM, { blend: 0.01 });
        f.cone(e, add(e, [0, -legR * 0.25, legR * 0.6]), legR * 0.16, legR * 0.04, M.bone, { group: null });
      }
    } else {
      const ankle = add(foot, [0, 0.045, -0.015]);
      const knee = ik(hipJ, ankle, thigh, shin, [d * 0.12, 0, 1]);
      limbSeg(f, hipJ, knee, legR * 1.2, legR * 0.85, legM, sk);
      limbSeg(f, knee, ankle, legR * 0.88, legR * 0.58, legM, sk);
      if (gear.bootM && !sk) {
        f.cone(lerpP(knee, ankle, 0.38), ankle, legR * 0.98, legR * 0.74, gear.bootM, { group: null });
        if (gear.bootM !== gear.metalM) f.cone(lerpP(knee, ankle, 0.32), lerpP(knee, ankle, 0.42), legR * 1.12, legR * 1.06, gear.bootM, { group: null });
      }
      footShape(f, ankle, [0, 0, 1], legR, gear, sp, d);
      if (plate) kneeCop(f, knee, gear);
    }
  }
  if (sp.tail) {
    const L = sp.tail;
    const prev = f.layer;
    f.layer = 'tail';
    const root = add(pelvis, ap3(HR, [0, -0.01, -0.05]));
    const pts = [root];
    const flick = pose.tail ?? 0.4;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      pts.push(add(root, [Math.sin(t * 2.2 + flick) * L * 0.38 * t + t * L * 0.35 * (pose.tailSide ?? 1), -hipH * 0.85 * Math.min(1, t * 1.25) + Math.max(0, t - 0.8) * 0.12, -t * L * 0.55]));
    }
    for (let i = 0; i < 6; i++) f.cone(pts[i], pts[i + 1], legR * (1.1 - i * 0.16), legR * (0.95 - (i + 1) * 0.15) + 0.002, skinM, { blend: 0.02 });
    f.layer = prev;
  }

  // ---- torso
  if (sk) {
    // spine, pelvis, ribs
    f.ell(pelvis, [0.07, 0.04, 0.045], boneM, { group: 'body' });
    for (let i = 0; i < 6; i++) f.sphere(lerpP(pelvis, neck, i / 6), 0.016, boneM, { group: 'body' });
    f.push(chest, TR, 1);
    for (let i = 0; i < 5; i++) {
      const y = 0.06 - i * 0.03;
      const w = 0.085 - Math.abs(i - 1.5) * 0.008;
      for (const d of [-1, 1]) f.cone([d * 0.01, y, -0.04], [d * w, y - 0.02, 0.03], 0.008, 0.007, boneM, { group: 'body' });
      for (const d of [-1, 1]) f.cone([d * w, y - 0.02, 0.03], [d * 0.012, y - 0.035, 0.07], 0.007, 0.006, boneM, { group: 'body' });
    }
    f.box([0, 0.0, 0.07], [0.012, 0.06, 0.008], boneM, { group: 'body' });
    f.pop();
    f.cone(add(chest, ap3(TR, [-shW, 0.07, 0])), add(chest, ap3(TR, [shW, 0.07, 0])), 0.01, 0.01, boneM);
    // tattered remnant of a loincloth hanging from the pelvis
    if (gear.clothM) {
      f.box(add(pelvis, [0, -0.07, 0.045]), [0.035, 0.07, 0.004], gear.clothM, { group: null, R: rotX(0.12), bevel: 0.003 });
      f.ell(add(pelvis, [0, 0.005, 0]), [0.075, 0.012, 0.05], M.darkLeather, { group: null });
    }
  } else {
    const belly = sp.belly ? 0.035 : 0;
    f.push(pelvis, TR, 1);
    f.ell([0, 0.0, 0], [0.085 * b, 0.07, 0.065 * b], clothM, { group: 'body' });
    f.ell([0, torso * 0.3, 0.008 + belly * 0.7], [0.08 * b + belly * 0.4, 0.09, 0.062 * b + belly], gear.torsoM ?? skinM, { group: 'body' });
    f.ell([0, torso * 0.62, 0], [0.105 * b, 0.09, 0.07 * b], gear.torsoM ?? skinM, { group: 'body' });
    // trapezius slope from neck to shoulders, flat pectoral plane, lats
    f.ell([0, torso * 0.84, -0.012], [0.095 * b, 0.04, 0.05 * b], gear.torsoM ?? skinM, { group: 'body' });
    f.ell([0, torso * 0.66, 0.03 * b], [0.09 * b, 0.055, 0.045 * b], gear.torsoM ?? skinM, { group: 'body' });
    for (const d of [-1, 1]) f.ell([d * 0.07 * b, torso * 0.5, -0.01], [0.04 * b, 0.08, 0.05 * b], gear.torsoM ?? skinM, { group: 'body' });
    if (sp.head === 'kobold' && !gear.torsoM) {
      // pale ventral scutes down the chest and belly, a ridge of spines down the back
      const bellyM = mat(mixc(skinM.color ?? sp.skin, '#b08858', 0.45), { pattern: 'leather', scale: 0.03, rough: 0.55, spec: 0.3 });
      for (let i = 0; i < 6; i++) f.ell([0, torso * (0.12 + i * 0.13), 0.052 * b + Math.sin(i * 0.5) * 0.004], [0.045 * b - Math.abs(i - 3) * 0.003, 0.024, 0.022], bellyM, { group: 'body', blend: 0.015 });
      for (let i = 0; i < 6; i++) f.cone([0, torso * (0.2 + i * 0.13), -0.055 * b], [0, torso * (0.2 + i * 0.13) + 0.014, -0.078 * b], 0.011, 0.002, skinM, { group: null });
    }
    // neck
    f.cone([0, torso * 0.85, -0.005], [0, torso + hr * 0.6, 0.01 + (sp.hunch ?? 0) * 0.08], 0.032 * b * (sp.head === 'ogre' ? 1.6 : 1), 0.028 * b * (sp.head === 'ogre' ? 1.5 : 1), skinM, { group: 'body' });
    // armour / clothing layers
    if (gear.armor === 'plate') {
      const pm = gear.metalM;
      f.ell([0, torso * 0.6, 0.012], [0.112 * b, 0.105, 0.078 * b], pm, { group: null });
      f.box([0, torso * 0.6, 0.085 * b], [0.004, 0.09, 0.004], gear.trimM ?? pm, { group: null, bevel: 0.003 });
      for (let i = 0; i < 3; i++) f.ell([0, torso * (0.2 - i * 0.1), 0.01], [0.098 * b + i * 0.006, 0.026, 0.074 * b + i * 0.004], pm, { group: null });
      f.ell([0, torso * 0.95, 0], [0.06, 0.03, 0.055], pm, { group: null });
    } else if (gear.armor === 'scale' || gear.armor === 'mail') {
      const am = gear.armor === 'scale' ? mat(gear.metalM.color, { pattern: 'scales', metal: true, scale: 0.012, rough: 0.4, spec: 0.7 }) : mat('#8a8c92', { pattern: 'mail', metal: true, scale: 0.05, rough: 0.5, spec: 0.6 });
      f.ell([0, torso * 0.5, 0.008], [0.112 * b, torso * 0.52, 0.076 * b], am, { group: null });
      f.ell([0, -0.02, 0.01], [0.095 * b, 0.07, 0.07 * b], am, { group: null });
    } else if (gear.armor === 'vest' || gear.armor === 'scraps') {
      const vm = gear.armor === 'vest' ? gear.vestM : M.leather;
      // a jerkin that follows the chest and nips in at the waist
      f.ell([0, torso * 0.62, 0.003], [0.112 * b, torso * 0.29, 0.077 * b], vm, { group: 'vest', blend: 0.07 });
      f.ell([0, torso * 0.32, 0.005], [0.093 * b, torso * 0.25, 0.07 * b], vm, { group: 'vest', blend: 0.07 });
      for (let i = 0; i < 4; i++) f.sphere([0.014, torso * (0.22 + i * 0.13), 0.072 * b], 0.005, M.bronze, { group: null });
      if (gear.armor === 'scraps') {
        f.ell([-0.05 * b, torso * 0.62, 0.05], [0.06, 0.06, 0.03], gear.metalM, { group: null, R: rotZ(0.4) });
        f.cone([-0.1 * b, torso * 0.9, 0.03], [0.09 * b, torso * 0.25, 0.075], 0.012, 0.012, M.leather, { group: null });
      }
    } else if (gear.armor === 'fur') {
      f.ell([0, torso * 0.7, -0.005], [0.13 * b, 0.07, 0.085 * b], mat('#6a5034', { pattern: 'fur', scale: 0.012 }), { group: null });
    } else if (gear.armor === 'rags') {
      f.ell([0, torso * 0.38, 0.005], [0.09 * b, torso * 0.36, 0.068 * b], clothM, { group: null });
    }
    if (gear.tunic) {
      f.ell([0, torso * 0.42, 0.004], [0.1 * b, torso * 0.45, 0.07 * b], gear.tunicM, { group: null });
    }
    if (robe) {
      f.ell([0, torso * 0.45, 0.004], [0.102 * b, torso * 0.52, 0.072 * b], clothM, { group: null });
    }
    // belt and loincloth / skirt
    if (!robe) {
      f.ell([0, 0.025, 0.004], [0.09 * b, 0.018, 0.069 * b], gear.beltM ?? M.leather, { group: null });
      f.box([0, 0.026, 0.07 * b], [0.016, 0.014, 0.006], M.bronze, { group: null, bevel: 0.004 });
      if (gear.loin) {
        f.box([0, -0.06, 0.058 * b], [0.04 * b, 0.07, 0.008], clothM, { group: null, R: rotX(0.08), bevel: 0.006 });
        f.box([0, -0.06, -0.058 * b], [0.045 * b, 0.075, 0.008], clothM, { group: null, R: rotX(-0.1), bevel: 0.006 });
      }
    }
    if (gear.necklace) for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3;
      f.cone([Math.sin(a) * 0.05, torso * 0.86 - Math.cos(a) * 0.035, 0.05], [Math.sin(a) * 0.052, torso * 0.86 - Math.cos(a) * 0.035 - 0.014, 0.056], 0.0042, 0.0015, M.bone, { group: null });
    }
    f.pop();
    if (gear.skirtM && !robe) {
      // tunic hem: a short flared skirt with folds over the thighs, and a pouch on the belt
      const waist = add(pelvis, ap3(TR, [0, 0.0, 0]));
      const hem = [pelvis[0] + sway * 0.3, hipH - 0.17, 0.004];
      f.cone(waist, hem, 0.078 * b, 0.098 * b, gear.skirtM, { group: 'skirt', blend: 0.015 });
      for (let i = 0; i < 7; i++) {
        const a = -1.5 + i * 0.5;
        f.cone(add(waist, [Math.sin(a) * 0.07 * b, -0.03, Math.cos(a) * 0.066 * b]), add(hem, [Math.sin(a) * 0.09 * b, 0.004, Math.cos(a) * 0.087 * b]), 0.007, 0.012, gear.skirtM, { group: 'skirt', blend: 0.015 });
      }
      f.box(add(pelvis, ap3(TR, [0.08 * b, 0.0, 0.04])), [0.022, 0.028, 0.012], M.leather, { group: null, R: TR, bevel: 0.008 });
    }
    if (robe) {
      // robe skirt: a flared cone from the waist to the floor, with fold ridges
      const waist = add(pelvis, ap3(TR, [0, 0.02, 0]));
      f.cone(waist, [sway * 0.5, 0.03, 0.0], 0.088 * b, 0.135 * b, clothM, { group: null });
      for (let i = 0; i < 5; i++) {
        const a = -1.1 + i * 0.55;
        f.cone(add(waist, [Math.sin(a) * 0.06, -0.05, Math.cos(a) * 0.06]), [sway * 0.5 + Math.sin(a) * 0.12 * b, 0.025, Math.cos(a) * 0.12 * b], 0.018, 0.03, clothM, { group: null });
      }
    }
  }
  if (gear.cape) {
    const cm = gear.capeM;
    const top = add(chest, ap3(TR, [0, 0.07, -0.07 * b]));
    const prev = f.layer;
    f.ell(add(top, ap3(TR, [0, -0.02, 0])), [0.13 * b, 0.05, 0.07], cm, { group: null });
    for (let i = 0; i < 5; i++) {
      const a = -0.8 + i * 0.4;
      const tx = Math.sin(a) * 0.17 * b;
      const bot = [pelvis[0] + tx * 1.15 + (pose.capeWind ?? 0), Math.max(0.03, hipH * 0.15), -0.09 * b - Math.cos(a) * 0.03 - (pose.capeWind ? 0.04 : 0)];
      f.cone(add(top, [tx * 0.7, 0, -0.01]), bot, 0.035 * b, 0.055 * b, cm, { group: 'cape', blend: 0.03 });
    }
    f.layer = prev;
  }

  // ---- shoulders and arms
  const sh = {};
  for (const d of [-1, 1]) sh[d] = add(chest, ap3(TR, [d * shW, 0.065, -0.008]));
  for (const d of [-1, 1]) {
    if (gear.armor === 'plate' || gear.pauldrons) f.ell(add(sh[d], ap3(TR, [d * 0.015, 0.015, 0])), [0.058 * b, 0.045 * b, 0.06 * b], gear.metalM, { group: null, R: mul3(TR, rotZ(d * -0.35)) });
    else if (!sk) f.sphere(sh[d], limb * 1.1, gear.shoulderM ?? gear.torsoM ?? skinM, { group: 'body', blend: 0.05 });
  }
  const hands = solveHandsCustom(sp, pose, { pelvis, chest, sh, TR, b, armL, gear });
  for (const d of [-1, 1]) {
    const hnd = hands[d];
    const elbow = ik(sh[d], hnd.wrist, upper, fore, hnd.pole ?? ap3(TR, [d * 0.7, -0.35, -0.7]));
    limbSeg(f, sh[d], elbow, limb * 1.12, limb * 0.85, armM, sk, gear.sleeveM);
    limbSeg(f, elbow, hnd.wrist, limb * 0.88, limb * 0.66, gear.foreM ?? armM, sk);
    if (plate) {
      f.sphere(elbow, limb * 1.05, gear.metalM, { group: null });
      f.cone(lerpP(elbow, hnd.wrist, 0.2), hnd.wrist, limb * 1.0, limb * 0.85, gear.metalM, { group: null });
    }
    if (gear.bracerM && !plate && !sk) f.cone(lerpP(elbow, hnd.wrist, 0.45), lerpP(elbow, hnd.wrist, 0.95), limb * 0.95, limb * 0.78, gear.bracerM, { group: null });
    const hs = 0.95 * b * (sk ? 0.7 : 1) * (sp.head === 'kobold' ? 1.05 : 1);
    const handM = sk ? boneM : gear.gloveM ?? skinM;
    if (hnd.kind === 'grip') fist(f, hnd.at, hnd.dir, hs, handM, d, { claws: sp.claws });
    else openHand(f, hnd.at, hnd.dir, hs, handM, d, { claws: sp.claws, spread: hnd.spread ?? 0.6 });
    if (hnd.weapon) {
      const g2 = weapon(f, hnd.weapon, hnd.at, hnd.dir, d, { down: hnd.down ?? 0.35 });
      if (g2 && hands[-d].twoHand) hands[-d].at2 = g2;
    }
    if (hnd.shield) {
      const fwd = norm(add(ap3(TR, [d * 0.25, 0, 1]), [0, 0, 0]));
      const sR = alignY([0, 1, 0]);
      const face = mul3(rotY(Math.atan2(fwd[0], fwd[2])), sR);
      const at = add(lerpP(elbow, hnd.wrist, 0.6), ap3(TR, [d * 0.01, 0, 0.035]));
      shield(f, gear.shieldKind, at, face, gear.shieldM);
    }
  }

  // ---- head
  const hp = add(neck, ap3(TR, [0, hr * 0.95, hr * 0.25 + (sp.hunch ?? 0) * 0.05]));
  const headR = mul3(rotY(twist + (pose.headYaw ?? 0)), mul3(rotX(-(lean * 0.85) + (pose.headPitch ?? 0)), rotZ(pose.headTilt ?? 0)));
  f.push(hp, headR, hr);
  const prevG = f.group;
  head(f, sp.head, sp, skinM, R, gear.headOpts ?? {});
  if (gear.helmet && sp.head !== 'human') monsterHelm(f, sp.head, gear);
  f.group = prevG;
  f.pop();
  return { hp, hands, feet, chest, pelvis };
}

function kneeCop(f, knee, gear) {
  f.sphere(add(knee, [0, 0, 0.012]), 0.03, gear.metalM, { group: null });
}

function monsterHelm(f, kind, gear) {
  const hm = gear.helmM ?? M.iron;
  const hard = { group: null };
  if (kind === 'kobold' || kind === 'goblin' || kind === 'gnoll' || kind === 'lizard') {
    // a battered skullcap with a nasal or a leather cap
    const kob = kind === 'kobold';
    f.ell([0, kob ? 0.6 : 0.45, kob ? -0.22 : -0.1], kob ? [0.8, 0.46, 0.88] : [0.98, 0.62, 1.02], hm, hard);
    f.ell([0, kob ? 0.44 : 0.2, kob ? -0.22 : -0.1], kob ? [0.83, 0.07, 0.9] : [1.0, 0.1, 1.04], gear.trimM ?? M.leather, hard);
    if (gear.helmSpike) f.cone([0, kob ? 1.0 : 0.95, -0.25], [0, kob ? 1.4 : 1.45, -0.35], 0.12, 0.02, hm, hard);
  } else {
    f.ell([0, 0.42, -0.05], [1.02, 0.8, 1.04], hm, hard);
    f.ell([0, 0.18, -0.05], [1.04, 0.1, 1.06], gear.trimM ?? M.bronze, hard);
    f.box([0, 0.0, 0.98], [0.07, 0.42, 0.05], hm, { ...hard, bevel: 0.03 });
    if (gear.helmHorns) for (const d of [-1, 1]) f.cone([d * 0.8, 0.5, 0], [d * 1.4, 1.2, -0.3], 0.16, 0.03, M.bone, hard);
  }
}

const lerpP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function limbSeg(f, a, b, ra, rb, m, skeletal = false, sleeve = null, bulge = 0.3) {
  if (skeletal) {
    f.cone(a, b, ra * 0.9, rb * 0.9, M.bone, { group: 'body', blend: 0.006 });
    f.sphere(a, ra * 1.5, M.bone, { group: 'body', blend: 0.006 });
    return;
  }
  f.cone(a, b, ra, rb, m, { group: 'body' });
  if (bulge) {
    // a muscle belly along the segment so limbs read as anatomy, not tubes
    const d = sub(b, a);
    const L = Math.hypot(d[0], d[1], d[2]);
    const c = lerpP(a, b, bulge);
    f.ell(add(c, [0, 0, -ra * 0.05]), [ra * 1.03, L * 0.38, ra * 1.0], m, { group: 'body', R: alignY(d), blend: 0.05 });
  }
  if (sleeve) f.cone(a, lerpP(a, b, 0.75), ra * 1.18, rb * 1.12, sleeve, { group: null });
}

function footShape(f, ankle, dir, r, gear, sp, d) {
  const fm = sp.skeletal ? M.bone : gear.bootM ?? gear.legM ?? gear.skinM;
  const toe = add(ankle, [d * 0.008, -0.03, 0.08]);
  f.cone(ankle, toe, r * 0.65, r * 0.5, fm, { group: sp.skeletal ? 'body' : null, blend: 0.01 });
  f.ell(add(lerpP(ankle, toe, 0.6), [0, -0.012, 0]), [r * 0.62, r * 0.38, r * 1.15], fm, { group: null });
}

/**
 * Hand targets for a weapon pose. Returns {[-1]: right hand, [1]: left hand}
 * each {wrist, at, dir, kind:'grip'|'open', weapon?, shield?, pole?, twoHand?, down?}.
 */
function solveHands(sp, pose, ctx) {
  const { pelvis, chest, sh, TR, b, gear } = ctx;
  const T = (v) => ap3(TR, v);
  const wp = pose.weaponPose ?? 'guard';
  const wpn = gear.weapon;
  const hands = { [-1]: null, [1]: null };
  const wristFrom = (at, dir, d) => add(at, scl(norm(add(scl(dir, -1), T([d * 0.2, 0, -0.3]))), 0.03 * b));
  const grip = (d, at, dir, extra = {}) => ({ at, dir: norm(dir), kind: 'grip', wrist: wristFrom(at, norm(dir), d), ...extra });
  const open = (d, at, dir, extra = {}) => ({ at, dir: norm(dir), kind: 'open', wrist: add(at, scl(norm(dir), -0.035 * b)), ...extra });
  const R = -1;
  const Lh = 1;
  switch (wp) {
    case 'spearReady': {
      const dir = norm(T([0.28, 0.5, 0.82]));
      const at = add(pelvis, T([-0.1 * b, 0.06, 0.04]));
      hands[R] = grip(R, at, dir, { weapon: wpn });
      hands[Lh] = grip(Lh, add(at, scl(dir, 0.26)), dir, { twoHand: true });
      break;
    }
    case 'spearRest': {
      const dir = norm([0.04, 1, 0.08]);
      const at = add(sh[R], T([-0.07 * b, -0.18, 0.1]));
      hands[R] = grip(R, at, dir, { weapon: wpn, down: at[1] - 0.005 });
      break;
    }
    case 'spearRaised': {
      const dir = norm(T([0.18, 0.15, 1]));
      const at = add(sh[R], T([-0.06, 0.13, -0.08]));
      hands[R] = grip(R, at, dir, { weapon: wpn, pole: T([-0.6, -0.6, -0.4]) });
      break;
    }
    case 'raised': {
      const dir = norm(T([0.45, 0.55, -0.55]));
      const at = add(sh[R], T([-0.03, 0.18, 0.0]));
      hands[R] = grip(R, at, dir, { weapon: wpn, pole: T([-0.8, -0.3, -0.2]) });
      break;
    }
    case 'low': {
      const dir = norm(T([-0.12, 0.35, 0.92]));
      const at = add(pelvis, T([-0.13 * b, 0.0, 0.1]));
      hands[R] = grip(R, at, dir, { weapon: wpn });
      break;
    }
    case 'shoulder': {
      const dir = norm(T([0.2, 0.55, -0.75]));
      const at = add(sh[R], T([-0.02, -0.15, 0.14]));
      hands[R] = grip(R, at, dir, { weapon: wpn });
      break;
    }
    case 'twoHandHigh': {
      const dir = norm(T([0.35, 0.7, -0.4]));
      const at = add(chest, T([-0.05, 0.05, 0.16]));
      hands[R] = grip(R, at, dir, { weapon: wpn });
      hands[Lh] = grip(Lh, add(at, scl(dir, -0.09)), dir, { twoHand: true });
      break;
    }
    case 'vigil': {
      // kneeling knight: both hands on the pommel of a reversed sword, point to the floor
      const dir = [0, -1, 0.0];
      const at = add(chest, T([0, -0.06, 0.2]));
      hands[R] = grip(R, add(at, [0, 0.02, 0]), dir, { weapon: wpn, pole: T([-0.8, -0.5, -0.2]) });
      hands[Lh] = grip(Lh, add(at, [0, 0.055, 0]), dir, { pole: T([0.8, -0.5, -0.2]) });
      break;
    }
    case 'reach': {
      for (const d of [R, Lh]) hands[d] = open(d, add(sh[d], T([d * 0.02, -0.06 + (d > 0 ? 0.04 : 0), 0.26 * (sp.arm ?? 1)])), T([d * 0.1, 0.1, 1]), { spread: 0.9 });
      break;
    }
    case 'guard':
    default: {
      const dir = norm(T([0.2, 0.82, 0.5]));
      const at = add(chest, T([-0.07 * b, -0.08, 0.17]));
      hands[R] = grip(R, at, dir, { weapon: wpn });
      break;
    }
  }
  if (!hands[Lh]) {
    const off = pose.offPose ?? (gear.shield ? 'shield' : 'fist');
    if (off === 'shield') hands[Lh] = grip(Lh, add(chest, T([0.17 * b, -0.04, 0.12])), T([0, 1, 0.3]), { shield: true });
    else if (off === 'point') hands[Lh] = open(Lh, add(sh[Lh], T([0.06, 0.02, 0.27])), T([0.15, 0.25, 1]), { spread: 0.3 });
    else if (off === 'claw') hands[Lh] = open(Lh, add(sh[Lh], T([0.1, -0.1, 0.2])), T([0.3, 0.6, 0.8]), { spread: 1 });
    else if (off === 'hip') hands[Lh] = grip(Lh, add(pelvis, T([0.11 * b, 0.05, 0.02])), T([0, -1, 0.3]), { pole: T([1, 0, -0.3]) });
    else hands[Lh] = grip(Lh, add(pelvis, T([0.14 * b, -0.02, 0.06])), T([0.05, -0.2, 1]), {});
  }
  return hands;
}

// ------------------------------------------------------------------ creature assembly

const POSES_BY_WEAPON = {
  spear: ['spearReady', 'spearReady', 'spearRest', 'spearRaised'],
  javelin: ['spearRaised', 'spearRest'],
  shortsword: ['guard', 'raised', 'low'],
  longsword: ['guard', 'raised', 'low'],
  dagger: ['low', 'guard'],
  axe: ['raised', 'shoulder', 'guard'],
  greataxe: ['twoHandHigh'],
  club: ['shoulder', 'raised', 'low'],
  bigclub: ['shoulder', 'raised'],
  mace: ['raised', 'guard', 'shoulder'],
  flail: ['raised', 'guard'],
};

/**
 * Build a creature figure with seeded variation.
 * @returns {{fig: Figure, sp: object, pose: object}}
 */
export function buildCreature(id, seed = 1, o = {}) {
  const sp = SPECIES[id];
  if (!sp) return null;
  const R = rngOf(seed * 9301 + 49297);
  const f = new Figure();
  // tint variation: brightness and a nudge toward the secondary skin colour
  const tint = (R() - 0.5) * 0.3;
  const toward = R() * 0.7;
  let base = mixc(sp.skin, sp.skin2 ?? sp.skin, toward);
  if (sp.skin3 && R() < 0.35) base = mixc(base, sp.skin3, 0.5 + R() * 0.3);
  const skinC = shade(base, 1 + tint);
  const skinM = mat(skinC, { pattern: sp.pattern ?? 'skin', scale: sp.pattern === 'scales' ? 0.0075 : sp.pattern === 'fur' ? 0.012 : 0.02, rough: sp.pattern === 'scales' ? 0.45 : 0.7, spec: sp.pattern === 'scales' ? 0.35 : 0.15, sss: sp.skeletal ? 0.2 : 0.45, tint2: sp.pattern === 'scales' ? shade(sp.skin2 ?? sp.skin, 1.05) : null });
  const clothC = R.pick(sp.cloth ?? ['#4a3a28']);
  const clothM = mat(shade(clothC, 0.9 + R() * 0.25), { pattern: 'cloth', scale: 0.018, spec: 0.05, rough: 0.9 });
  const weaponK = o.weapon !== undefined ? o.weapon : R.pick(sp.weapons ?? [null]);
  const wantShield = !['spear', 'greataxe', 'bigclub'].includes(weaponK) && R() < (sp.shield ?? 0);
  const metalM = sp.ghost ? mat('#c8d8e0', { pattern: 'metal', metal: true, rough: 0.25, spec: 1, scale: 0.05 }) : mat(R() < 0.5 ? '#7a7c84' : '#8a8478', { pattern: 'metal', metal: true, rough: 0.4, spec: 0.8, scale: 0.05 });
  const gear = {
    skinM, clothM, weapon: weaponK, shield: wantShield, armor: sp.armor ?? null, metalM,
    shieldKind: id.startsWith('hobgoblinChief') ? 'kite' : 'round',
    shieldM: mat(R.pick(['#5a3a1e', '#4a2e18', '#6a4a2a', '#3a2a1a']), { pattern: 'wood', scale: 0.02 }),
    vestM: mat(R.pick(['#4a3220', '#3a2a1a', '#5a4028']), { pattern: 'leather', scale: 0.03 }),
    capeM: sp.cape ? mat(sp.cape, { pattern: 'cloth', scale: 0.02 }) : null,
    cape: !!sp.cape,
    loin: !sp.human && !sp.skeletal && sp.armor !== 'robe' && sp.armor !== 'plate',
    necklace: (sp.head === 'kobold' || sp.head === 'gnoll' || sp.head === 'orc') && R() < 0.35,
    helmet: !sp.human && R() < (sp.helm ?? 0),
    helmSpike: R() < 0.4,
    helmHorns: id === 'orcLeader',
    helmM: R() < 0.4 ? M.leather : metalM,
    trimM: sp.chief ? M.gold : null,
    bracerM: !sp.human && R() < 0.4 ? M.leather : null,
  };
  if (sp.human) {
    // layered costume: linen shirt, leather jerkin, coloured hose and hem, dark boots
    const shirtC = R.pick(['#b8a888', '#9a8a6a', '#c8bca4', '#7a6a58', '#a89878']);
    const legC = R.pick(['#3a3a40', '#4a3a2a', '#2e3a2e', '#5a4a3a']);
    gear.legM = mat(legC, { pattern: 'cloth', scale: 0.02 });
    gear.bootM = M.darkLeather;
    gear.armM = mat(shirtC, { pattern: 'cloth', scale: 0.016 });
    gear.foreM = R() < 0.4 ? skinM : gear.armM;
    gear.torsoM = gear.armM;
    gear.skirtM = mat(shade(clothC, 0.9), { pattern: 'cloth', scale: 0.016 });
    gear.bracerM = gear.foreM === skinM ? M.leather : null;
    gear.headOpts = {
      hair: R.pick(['#17110e', '#3a2416', '#62351b', '#6f6a64']),
      hairStyle: R.pick(['short', 'short', 'bald', 'long']),
      beard: R.pick(['none', 'stubble', 'full', 'moustache']),
      hood: R() < (sp.hood ?? 0) ? shade(clothC, 0.8) : null,
      bandana: sp.bandana ? R.pick(sp.bandana) : null,
    };
    if (sp.armor === 'robe') { gear.armM = clothM; gear.foreM = clothM; gear.torsoM = clothM; }
    if (sp.gauntlet) gear.gloveM = mat('#1a1a1a', { metal: true, rough: 0.4, spec: 0.6 });
    if (sp.ghost) {
      gear.legM = metalM; gear.armM = metalM; gear.foreM = metalM; gear.torsoM = metalM; gear.bootM = metalM; gear.gloveM = metalM;
      gear.headOpts = { helm: true, helmM: metalM, trimM: M.bronze, crest: '#5a8a98' };
    }
  } else if (sp.armor === 'plate') {
    gear.legM = metalM; gear.armM = skinM; gear.bootM = metalM; gear.torsoM = skinM;
  }
  if (sp.armor === 'robe' && !sp.human) { gear.armM = clothM; gear.torsoM = clothM; }
  // pose
  const poses = POSES_BY_WEAPON[weaponK] ?? (sp.reach ? ['reach'] : ['guard']);
  const weaponPose = o.pose ?? (o.leader ? (poses.includes('raised') ? 'raised' : poses.includes('spearReady') ? 'spearReady' : R.pick(poses)) : R.pick(poses));
  const offPose = gear.shield ? 'shield' : o.leader && weaponPose !== 'spearReady' ? 'point' : sp.claws && !weaponK ? 'claw' : R.pick(['fist', 'fist', 'hip', 'claw']);
  const pose = {
    weaponPose,
    offPose: weaponPose === 'spearReady' || weaponPose === 'twoHandHigh' ? null : offPose,
    stance: (0.06 + R() * 0.05) * (sp.build ?? 1),
    footZ: [(R() - 0.5) * 0.12, (R() - 0.5) * 0.12],
    crouch: sp.digi ? 0.15 + R() * 0.2 : R() * 0.15,
    lean: (R() - 0.3) * 0.12,
    twist: (R() - 0.5) * 0.35,
    headYaw: (R() < 0.5 ? -1 : 1) * (0.35 + R() * 0.4),
    headPitch: (R() - 0.5) * 0.18 + (o.leader ? -0.08 : 0),
    headTilt: (R() - 0.5) * 0.24,
    sway: (R() - 0.5) * 0.03,
    hipTilt: (R() - 0.5) * 0.08,
    tail: R() * 2,
    tailSide: R() < 0.5 ? -1 : 1,
    ...(o.poseOverride ?? {}),
  };
  if (['kobold', 'gnoll', 'lizard'].includes(sp.head) && o.yaw != null && o.poseOverride?.headYaw == null) {
    // a long muzzle pointed straight at the viewer foreshortens into a blob:
    // keep snouted heads at least three-quarter on, turned the way the body is
    const total = o.yaw + pose.twist + pose.headYaw;
    const want = 0.7;
    if (Math.abs(total) < want) {
      const sgn = Math.sign(o.yaw || pose.headYaw || 1);
      pose.headYaw = Math.max(-1.1, Math.min(1.1, sgn * want - o.yaw - pose.twist));
    }
  }
  if (sp.chief) gear.cape = true;
  const j = humanoid(f, sp, pose, R, gear);
  f.top = j.hp[1] + (sp.headR ?? 0.065);
  return { fig: f, sp, pose, yaw: (R() - 0.5) * 0.7 };
}

// ------------------------------------------------------------------ people (NPCs)

const SKIN_HEX = { pale: '#f2d6c0', fair: '#ecc3a2', light: '#dfae88', golden: '#d9a77a', ruddy: '#d99478', tan: '#c58c62', olive: '#b0865c', brown: '#8a5a3c', dark: '#5f3b28' };

/**
 * Build a townsperson from a portrait look (so the figure matches the portrait).
 * o: {pose: 'clerk'|'smith'|'priest'|'barkeep'|'trainer'|'stand', skin, hair, cloth, body, race, gender, hairStyle, beard, apron}
 */
export function buildPerson(o) {
  const R = rngOf((o.seed ?? 7) * 7919 + 13);
  const f = new Figure();
  const race = o.race ?? 'human';
  const short = race === 'dwarf' || race === 'halfling' || race === 'gnome';
  const sp = {
    head: 'human', human: true, legs: short ? 0.42 : 0.5, torso: short ? 0.3 : 0.32, headR: short ? 0.082 : 0.071,
    build: (race === 'dwarf' ? 1.25 : 1) * (o.gender === 'female' ? 0.9 : 1) * (o.build ?? 1), hunch: o.hunch ?? 0,
  };
  const skinM = mat(o.skin ?? '#d9a77a', { pattern: 'skin', scale: 0.02, sss: 0.5, rough: 0.6, spec: 0.2 });
  const clothM = mat(o.cloth ?? '#6a5234', { pattern: 'cloth', scale: 0.016, spec: 0.05, rough: 0.9 });
  const body = o.body ?? 'tabard';
  const metalM = mat(o.metal ?? '#9a9ca4', { pattern: 'metal', metal: true, rough: 0.35, spec: 0.9, scale: 0.05 });
  const gear = {
    skinM, clothM, metalM, weapon: o.weapon ?? null, armor: null,
    legM: mat(shade(o.cloth ?? '#6a5234', 0.6), { pattern: 'cloth', scale: 0.02 }),
    bootM: M.darkLeather,
    armM: clothM, foreM: clothM, torsoM: clothM,
    headOpts: { hair: o.hair ?? '#3a2416', hairStyle: o.hairStyle ?? 'short', beard: o.beard ?? 'none', eyeC: o.eyeC, hood: o.hood ?? null, gender: o.gender, age: o.age ?? 0 },
  };
  if (body === 'robe' || body === 'vestments') { gear.armor = 'robe'; }
  if (body === 'plate') { gear.armor = 'plate'; gear.legM = metalM; gear.bootM = metalM; gear.armM = metalM; gear.foreM = metalM; gear.gloveM = metalM; }
  if (body === 'chain' || body === 'scale') { gear.armor = body === 'chain' ? 'mail' : 'scale'; gear.armM = mat('#8a8c92', { pattern: 'mail', metal: true, scale: 0.05, rough: 0.5, spec: 0.6 }); gear.foreM = clothM; }
  if (body === 'leather') { gear.armor = 'vest'; gear.vestM = M.leather; }
  if (body === 'fur') { gear.armor = 'fur'; }
  if (body === 'tabard' || body === 'leather' || body === 'chain' || body === 'scale') gear.skirtM = clothM;
  if (body === 'tabard') { gear.tunic = true; gear.tunicM = clothM; gear.torsoM = mat(shade(o.cloth ?? '#6a5234', 0.7), { pattern: 'cloth', scale: 0.02 }); }
  if (o.apron) { gear.skirtM = M.leather; gear.tunic = true; gear.tunicM = M.leather; gear.armM = skinM; gear.foreM = skinM; gear.sleeveM = clothM; gear.torsoM = clothM; }
  if (o.vestments) { gear.cape = true; gear.capeM = mat(o.vestments, { pattern: 'cloth', scale: 0.02 }); }
  const P = {
    clerk: { weaponPose: 'clerk', lean: 0.1, headPitch: 0.1, headYaw: -0.1, crouch: 0 },
    smith: { weaponPose: 'smith', lean: 0.12, twist: -0.25, headYaw: 0.35, headPitch: 0.15 },
    priest: { weaponPose: 'bless', lean: -0.02, headPitch: -0.05 },
    barkeep: { weaponPose: 'bar', lean: 0.08, twist: 0.15, headYaw: -0.15 },
    trainer: { weaponPose: 'armsCrossed', lean: -0.03, headPitch: -0.04, headYaw: 0.1 },
    stand: { weaponPose: 'rest', lean: 0 },
  }[o.pose ?? 'stand'];
  const pose = { stance: 0.07 * sp.build, footZ: [0.02, -0.03], crouch: 0, twist: 0, headTilt: (R() - 0.5) * 0.1, ...P };
  personHands(sp, pose, gear);
  const j = humanoid(f, sp, pose, R, gear);
  f.top = j.hp[1] + sp.headR;
  return { fig: f, sp, pose, joints: j };
}

/** NPC hand poses are expressed through the generic solver with a few extras. */
function personHands(sp, pose, gear) {
  const wp = pose.weaponPose;
  if (wp === 'clerk') { pose.weaponPose = 'custom'; pose.custom = 'clerk'; }
  if (wp === 'smith') { pose.weaponPose = 'custom'; pose.custom = 'smith'; gear.weapon = 'hammer'; }
  if (wp === 'bless') { pose.weaponPose = 'custom'; pose.custom = 'bless'; }
  if (wp === 'bar') { pose.weaponPose = 'custom'; pose.custom = 'bar'; }
  if (wp === 'armsCrossed') { pose.weaponPose = 'custom'; pose.custom = 'armsCrossed'; }
  if (wp === 'rest') { pose.weaponPose = 'custom'; pose.custom = 'rest'; }
}

/** Custom (NPC) poses, kept apart from the combat poses in solveHands. */
function solveHandsCustom(sp, pose, ctx) {
  if (pose.weaponPose !== 'custom') return solveHands(sp, pose, ctx);
  const { pelvis, chest, sh, TR, b, gear } = ctx;
  const T = (v) => ap3(TR, v);
  const hands = {};
  const grip = (d, at, dir, extra = {}) => ({ at, dir: norm(dir), kind: 'grip', wrist: add(at, scl(norm(add(scl(norm(dir), -1), T([d * 0.2, 0, -0.3]))), 0.03 * b)), ...extra });
  const open = (d, at, dir, extra = {}) => ({ at, dir: norm(dir), kind: 'open', wrist: add(at, scl(norm(dir), -0.035 * b)), ...extra });
  switch (pose.custom) {
    case 'clerk':
      hands[-1] = grip(-1, add(chest, T([-0.06, -0.2, 0.2])), T([0.3, 0.6, 0.4]), { weapon: 'quill' });
      hands[1] = open(1, add(chest, T([0.1, -0.22, 0.2])), T([-0.2, 0.1, 1]), { spread: 0.3 });
      break;
    case 'smith':
      hands[-1] = grip(-1, add(sh[-1], T([-0.05, 0.16, 0.02])), T([0.5, 0.45, -0.5]), { weapon: 'hammer', pole: T([-0.8, -0.2, -0.3]) });
      hands[1] = grip(1, add(chest, T([0.1, -0.2, 0.24])), T([-0.3, 0, 1]), { weapon: 'tongs' });
      break;
    case 'bless':
      hands[-1] = open(-1, add(sh[-1], T([-0.07, -0.1, 0.22])), T([-0.25, 1, 0.5]), { spread: 0.4, pole: T([-0.6, -0.8, -0.2]) });
      hands[1] = open(1, add(sh[1], T([0.07, -0.1, 0.22])), T([0.25, 1, 0.5]), { spread: 0.4, pole: T([0.6, -0.8, -0.2]) });
      break;
    case 'bar':
      hands[-1] = grip(-1, add(chest, T([-0.08, -0.16, 0.2])), T([0, 1, 0.1]), { weapon: 'tankard' });
      hands[1] = open(1, add(chest, T([0.09, -0.18, 0.22])), T([-0.4, 0.2, 1]), { spread: 0.7, cloth: true });
      break;
    case 'armsCrossed':
      hands[-1] = grip(-1, add(chest, T([0.07, -0.02, 0.1])), T([1, 0.1, 0.1]), { pole: T([-1, -0.2, 0.3]) });
      hands[1] = grip(1, add(chest, T([-0.07, -0.05, 0.12])), T([-1, 0.1, 0.1]), { pole: T([1, -0.2, 0.3]) });
      break;
    case 'rest':
    default:
      hands[-1] = grip(-1, add(pelvis, T([-0.13 * b, -0.02, 0.04])), T([0, -1, 0.2]), { pole: T([-1, 0, -0.3]) });
      hands[1] = grip(1, add(pelvis, T([0.13 * b, -0.02, 0.04])), T([0, -1, 0.2]), { pole: T([1, 0, -0.3]) });
      break;
  }
  void gear;
  return hands;
}

// ------------------------------------------------------------------ beasts

/** Non-humanoid plans built by buildBeast(). */
export const BEASTS = {
  giantRat: { plan: 'quad', fur: '#4a3a30', fur2: '#6a5444', eyes: '#ff3020', len: 1.0, height: 0.3, lowSlung: true, snout: 1.25, ears: 'round', tail: 'rat', bulk: 0.9 },
  wolf: { plan: 'quad', fur: '#6a6660', fur2: '#8a8478', eyes: '#ffd040', len: 1.15, height: 0.55, snout: 1.1, ears: 'pointed', tail: 'bushy', bulk: 1 },
  giantSpider: { plan: 'spider', skin: '#2a2420', skin2: '#5a3a1a', eyes: '#ff2020' },
  giantFrog: { plan: 'frog', skin: '#6a8a4a', skin2: '#c8c890', eyes: '#ffe080' },
  giantCentipede: { plan: 'centipede', skin: '#7a3a1a', skin2: '#c86a2a', eyes: '#ff4020' },
  shadow: { plan: 'wraith', color: '#0a0a12', eyes: '#c8d0ff' },
  spectre: { plan: 'wraith', color: '#9ab0c8', eyes: '#ffffff', ghost: true },
};

export function buildBeast(id, seed = 1, o = {}) {
  const sp = BEASTS[id];
  if (!sp) return null;
  const R = rngOf(seed * 7907 + 31);
  const f = new Figure();
  const tint = 1 + (R() - 0.5) * 0.25;
  if (sp.plan === 'quad') quadruped(f, sp, R, tint);
  else if (sp.plan === 'spider') spider(f, sp, R, tint);
  else if (sp.plan === 'frog') frog(f, sp, R, tint);
  else if (sp.plan === 'centipede') centipede(f, sp, R, tint);
  else if (sp.plan === 'wraith') wraith(f, sp, R);
  f.top = f.top ?? 1;
  return { fig: f, sp: { ...sp, ghost: !!sp.ghost, legs: 0.3 }, pose: {}, yaw: (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.5) };
}

function eyePair(f, x, y, z, r, c) {
  for (const d of [-1, 1]) {
    f.sphere([d * x, y, z], r, eyeMat(c), { group: null });
    f.glow([d * x, y, z + r], r * 5, c, 0.8);
  }
}

function quadruped(f, sp, R, tint) {
  const fur = mat(shade(mixc(sp.fur, sp.fur2, R() * 0.6), tint), { pattern: 'fur', scale: 0.012, rough: 0.85, spec: 0.1 });
  const L = sp.len * 0.5;
  const Hh = sp.height;
  const b = sp.bulk;
  // the body points at the viewer (+z): hindquarters at -z
  const chest = [0, Hh * 0.95, L * 0.45];
  const hips = [0, Hh * 0.92, -L * 0.5];
  f.ell(chest, [0.13 * b, 0.14 * b, 0.17 * b], fur, { group: 'body' });
  f.ell([0, Hh * 0.9, 0], [0.12 * b, 0.12 * b, 0.25 * b], fur, { group: 'body' });
  f.ell(hips, [0.12 * b, 0.13 * b, 0.15 * b], fur, { group: 'body' });
  // legs: shoulder → elbow → paw, hip → hock → paw
  const crouch = R() * 0.08;
  for (const d of [-1, 1]) {
    const fz = L * 0.55 + (d > 0 ? 0.04 : -0.02);
    const sh = add(chest, [d * 0.08 * b, -0.05, 0.02]);
    const paw = [d * 0.09 * b, 0.02, fz + (R() - 0.5) * 0.06];
    const el = ik(sh, add(paw, [0, 0.03, 0]), Hh * 0.5, Hh * 0.5, [0, 0, -1]);
    f.cone(sh, el, 0.05 * b, 0.032 * b, fur, { group: 'body' });
    f.cone(el, add(paw, [0, 0.03, 0]), 0.03 * b, 0.022 * b, fur, { group: 'body' });
    f.ell(add(paw, [0, 0.015, 0.02]), [0.03 * b, 0.016, 0.042 * b], fur, { group: null });
    for (let t = -1; t <= 1; t++) f.cone(add(paw, [t * 0.012, 0.008, 0.055 * b]), add(paw, [t * 0.014, 0.0, 0.075 * b]), 0.006, 0.002, M.bone, { group: null });
    const hp = add(hips, [d * 0.08 * b, -0.04, -0.02]);
    const hpaw = [d * 0.1 * b, 0.02, -L * 0.6 + (R() - 0.5) * 0.05];
    const hock = add(hpaw, [0, Hh * 0.3, -0.05]);
    const knee = ik(hp, hock, Hh * 0.45, Hh * 0.4, [0, 0, 1]);
    f.cone(hp, knee, 0.07 * b, 0.04 * b, fur, { group: 'body' });
    f.cone(knee, hock, 0.035 * b, 0.025 * b, fur, { group: 'body' });
    f.cone(hock, add(hpaw, [0, 0.02, 0]), 0.024 * b, 0.02 * b, fur, { group: 'body' });
    f.ell(add(hpaw, [0, 0.012, 0.02]), [0.028 * b, 0.014, 0.04 * b], fur, { group: null });
  }
  // neck and head, lowered and snarling
  const nb = add(chest, [0, 0.06, 0.1]);
  const hp = add(chest, [(R() - 0.5) * 0.06, 0.06 - crouch, 0.24 * b]);
  f.cone(nb, hp, 0.09 * b, 0.07 * b, fur, { group: 'body' });
  f.push(hp, euler(0.2 + R() * 0.15, (R() - 0.5) * 0.5, (R() - 0.5) * 0.2), 0.075 * b);
  f.ell([0, 0, 0], [1, 0.85, 1.05], fur, { group: 'head', blend: 0.08 });
  f.cone([0, -0.15, 0.5], [0, -0.35, 0.5 + sp.snout * 1.1], 0.6, 0.28, fur, { group: 'head', blend: 0.08 });
  f.cone([0, -0.55, 0.4], [0, -0.62, 0.4 + sp.snout * 0.95], 0.35, 0.18, fur, { group: 'head', blend: 0.06 });
  f.cone([0, -0.42, 0.55], [0, -0.48, 0.45 + sp.snout * 0.95], 0.28, 0.14, M.mouth, { group: null });
  f.sphere([0, -0.28, 0.55 + sp.snout * 1.12], 0.17, M.dark, { group: null });
  for (let i = 0; i < 4; i++) for (const d of [-1, 1]) f.cone([d * 0.18, -0.38, 0.7 + i * 0.22 * sp.snout], [d * 0.17, -0.55, 0.72 + i * 0.22 * sp.snout], 0.06, 0.012, M.tooth, { group: null });
  if (sp.ears === 'round') for (const d of [-1, 1]) f.ell([d * 0.65, 0.7, -0.2], [0.35, 0.38, 0.1], mat(shade(sp.fur2, 0.9), { rough: 0.6, sss: 0.7 }), { group: null, R: rotZ(d * -0.3) });
  else for (const d of [-1, 1]) f.cone([d * 0.5, 0.6, -0.2], [d * 0.62, 1.4, -0.35], 0.28, 0.04, fur, { group: null });
  eyePair(f, 0.42, 0.18, 0.75, 0.12, sp.eyes);
  f.pop();
  // tail
  const tail = [hips];
  const naked = sp.tail === 'rat';
  const tm = naked ? mat('#c89a88', { pattern: 'skin', scale: 0.01, sss: 0.7 }) : fur;
  let p = add(hips, [0, 0.03, -0.12 * b]);
  tail.push(p);
  const side = R() < 0.5 ? -1 : 1;
  for (let i = 0; i < 7; i++) {
    p = add(p, [side * 0.05 * Math.sin(i * 0.6 + 0.4), naked ? -0.03 + i * 0.002 : 0.02 - i * 0.012, -0.07]);
    tail.push(p);
  }
  f.layer = 'tail';
  for (let i = 1; i < tail.length - 1; i++) f.cone(tail[i], tail[i + 1], (naked ? 0.022 : 0.05) * (1 - i / tail.length) + 0.004, (naked ? 0.022 : 0.05) * (1 - (i + 1) / tail.length) + 0.003, tm, { group: 'tail' });
  f.layer = 'main';
  f.top = Hh * 1.25;
}

function spider(f, sp, R, tint) {
  const chit = mat(shade(sp.skin, tint), { pattern: 'skin', scale: 0.03, rough: 0.35, spec: 0.6 });
  const mark = mat(sp.skin2, { pattern: 'fur', scale: 0.01, rough: 0.7 });
  const h = 0.32;
  f.ell([0, h, -0.28], [0.26, 0.22, 0.3], chit, { group: 'b' });
  f.ell([0, h + 0.12, -0.32], [0.12, 0.05, 0.2], mark, { group: null });
  f.ell([0, h - 0.02, 0.06], [0.16, 0.12, 0.17], chit, { group: 'b' });
  for (let i = 0; i < 4; i++) {
    for (const d of [-1, 1]) {
      const a = (-0.9 + i * 0.6);
      const root = [d * 0.12, h, 0.06 + Math.cos(a) * 0.08];
      const knee = [d * (0.3 + 0.05 * Math.cos(a)), h + 0.28 - i * 0.02, 0.06 + Math.sin(-a) * -0.28 + 0.1 * Math.cos(a)];
      const tip = [d * (0.5 + 0.08 * Math.cos(a)), 0.01, 0.06 + Math.sin(-a) * -0.55];
      f.cone(root, knee, 0.03, 0.022, chit, { group: null });
      f.cone(knee, tip, 0.022, 0.006, chit, { group: null });
      f.sphere(knee, 0.026, chit, { group: null });
    }
  }
  for (const d of [-1, 1]) f.cone([d * 0.05, h - 0.06, 0.2], [d * 0.03, h - 0.16, 0.24], 0.03, 0.006, M.bone, { group: null });
  for (const [x, y, r] of [[0.05, 0.05, 0.026], [0.1, 0.03, 0.02], [0.03, 0.09, 0.016], [0.08, 0.08, 0.014]]) for (const d of [-1, 1]) {
    f.sphere([d * x, h + y, 0.2], r, eyeMat(sp.eyes), { group: null });
    f.glow([d * x, h + y, 0.22], r * 3, sp.eyes, 0.6);
  }
  f.top = h + 0.3;
}

function frog(f, sp, R, tint) {
  const skin = mat(shade(sp.skin, tint), { pattern: 'skin', scale: 0.015, rough: 0.45, spec: 0.4, sss: 0.5 });
  const belly = mat(sp.skin2, { pattern: 'skin', scale: 0.02, rough: 0.3, spec: 0.5 });
  f.ell([0, 0.2, -0.05], [0.24, 0.17, 0.28], skin, { group: 'b' });
  f.ell([0, 0.16, 0.12], [0.2, 0.12, 0.16], belly, { group: 'b' });
  f.ell([0, 0.3, 0.18], [0.2, 0.1, 0.16], skin, { group: 'b' });
  f.ell([0, 0.24, 0.3], [0.2, 0.025, 0.06], M.mouth, { group: null });
  for (const d of [-1, 1]) {
    f.sphere([d * 0.12, 0.38, 0.2], 0.06, skin, { group: 'b' });
    f.sphere([d * 0.13, 0.4, 0.24], 0.04, eyeMat(sp.eyes), { group: null });
    f.glow([d * 0.13, 0.4, 0.27], 0.15, sp.eyes, 0.5);
    f.ell([d * 0.28, 0.14, -0.1], [0.1, 0.12, 0.2], skin, { group: 'b' });
    f.cone([d * 0.3, 0.06, -0.05], [d * 0.36, 0.01, 0.2], 0.04, 0.03, skin, { group: null });
    f.ell([d * 0.37, 0.01, 0.24], [0.07, 0.012, 0.06], skin, { group: null });
    f.cone([d * 0.14, 0.14, 0.2], [d * 0.18, 0.01, 0.3], 0.03, 0.022, skin, { group: null });
  }
  f.top = 0.48;
}

function centipede(f, sp, R, tint) {
  const plate = mat(shade(sp.skin, tint), { pattern: 'skin', scale: 0.02, rough: 0.35, spec: 0.6 });
  const legM = mat(sp.skin2, { rough: 0.5, spec: 0.4 });
  let p = [0, 0.32, 0.18];
  let a = 0;
  for (let i = 0; i < 12; i++) {
    const r = 0.06 - i * 0.002;
    f.ell(p, [r * 1.3, r * 0.8, r], plate, { group: 'c', blend: 0.01 });
    for (const d of [-1, 1]) f.cone(add(p, [d * r, -0.01, 0]), add(p, [d * (r + 0.08), Math.max(-p[1] + 0.005, -0.08), 0.02]), 0.008, 0.003, legM, { group: null });
    a += (R() - 0.5) * 0.7;
    p = add(p, [Math.sin(a) * 0.07, i < 2 ? -0.1 : 0, -Math.cos(a) * 0.08]);
    p[1] = Math.max(0.05, p[1]);
  }
  for (const d of [-1, 1]) f.cone([d * 0.03, 0.3, 0.24], [d * 0.05, 0.24, 0.32], 0.012, 0.003, M.bone, { group: null });
  eyePair(f, 0.035, 0.36, 0.22, 0.016, sp.eyes);
  f.top = 0.5;
}

function wraith(f, sp, R) {
  const robe = mat(sp.color, { pattern: 'cloth', scale: 0.02, rough: 0.9, spec: 0.05 });
  f.cone([0, 0.62, 0], [0, 0.15, 0], 0.13, 0.24, robe, { group: 'r' });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    f.cone([Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18], [Math.cos(a) * 0.26, 0.02 + R() * 0.08, Math.sin(a) * 0.26], 0.05, 0.012, robe, { group: 'r' });
  }
  f.ell([0, 0.78, 0], [0.16, 0.14, 0.12], robe, { group: 'r' });
  f.ell([0, 0.96, -0.02], [0.11, 0.12, 0.12], robe, { group: 'r' });
  f.ell([0, 0.93, 0.07], [0.07, 0.08, 0.04], M.dark, { group: null });
  eyePair(f, 0.03, 0.95, 0.1, 0.012, sp.eyes);
  for (const d of [-1, 1]) {
    f.cone([d * 0.14, 0.82, 0], [d * 0.26, 0.66, 0.16], 0.05, 0.035, robe, { group: 'r' });
    openHand(f, [d * 0.29, 0.62, 0.2], [d * 0.3, -0.2, 1], 1.1, mat('#c8d0d8', { pattern: 'bone', scale: 0.01 }), d, { claws: true, spread: 1 });
  }
  f.top = 1.1;
}
