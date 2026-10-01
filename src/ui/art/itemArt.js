import { Figure, mat, renderFigure, rotX, rotY, rotZ, mul3, alignY } from './sculpt.js';
import { M, weapon } from './bodies.js';

/**
 * Item art for shop cards and the examine panel: every item is sculpted and
 * lit in 3D (sculpt.js) so each reads at a glance — banded vs splint vs chain
 * vs scale mail, long bow vs short bow vs crossbow, blades by their shape.
 *
 *   itemArtURL(def, {magic, size}) → data URL (cached)
 */

const cache = new Map();

const RIG = {
  key: { dir: [-0.55, 0.7, 0.55], color: '#fff2dc', i: 1.85 },
  rim: { dir: [0.8, 0.3, -0.5], color: '#d0e0ff', i: 1.7 },
  sky: '#b8c4dc', ground: '#6a5a4a', amb: 1.05,
};

const steel = mat('#c4c8d2', { pattern: 'metal', metal: true, rough: 0.22, spec: 1.1, scale: 0.08 });
const silver = mat('#e4e8f0', { metal: true, rough: 0.15, spec: 1.2 });
const iron = mat('#7a7c84', { pattern: 'metal', metal: true, rough: 0.4, spec: 0.8, scale: 0.08 });
const brass = mat('#c8a050', { metal: true, rough: 0.25, spec: 1 });
const wood = mat('#7a5230', { pattern: 'wood', scale: 0.03, rough: 0.6, spec: 0.2 });
const darkWood = mat('#4a2e18', { pattern: 'wood', scale: 0.03, rough: 0.6, spec: 0.2 });
const leather = mat('#6a4226', { pattern: 'leather', scale: 0.05, rough: 0.6, spec: 0.25 });
const grip = mat('#3a2216', { pattern: 'leather', scale: 0.02, rough: 0.6, spec: 0.2 });
const cord = mat('#d8ccb0', { pattern: 'cloth', scale: 0.01 });

/** A straight blade along +y from y0 with length L and half-width w (tapering to a point). */
function blade(f, y0, L, w, m = steel, { taper = 0.75, fuller = true } = {}) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const ww = w * (1 - t0 * (1 - taper));
    f.box([0, y0 + L * (t0 + 0.5 / n) * 0.9, 0], [ww, (L * 0.9) / n / 2 + 0.002, 0.012], m, { group: null, bevel: 0.006 });
  }
  f.ell([0, y0 + L * 0.9, 0], [w * taper, L * 0.12, 0.012], m, { group: null });
  if (fuller) f.box([0, y0 + L * 0.42, 0.011], [w * 0.18, L * 0.36, 0.003], mat('#7a7e88', { metal: true, rough: 0.35, spec: 0.7, ink: 0 }), { group: null, bevel: 0.002 });
}

function hilt(f, y, { guard = 0.12, gripL = 0.16, pommel = 0.03, m = brass, twoHand = false } = {}) {
  f.box([0, y, 0], [guard, 0.016, 0.022], m, { group: null, bevel: 0.01 });
  for (const d of [-1, 1]) f.sphere([d * guard, y, 0], 0.022, m, { group: null });
  const gl = twoHand ? gripL * 1.8 : gripL;
  f.cone([0, y - 0.01, 0], [0, y - gl, 0], 0.022, 0.02, grip, { group: null });
  for (let i = 1; i < 5; i++) f.ell([0, y - (gl * i) / 5, 0], [0.024, 0.005, 0.024], mat('#2a160c', { rough: 0.7 }), { group: null });
  f.sphere([0, y - gl - pommel * 0.8, 0], pommel, m, { group: null });
}

function curvedBlade(f, y0, L, w, bend) {
  const n = 9;
  let x = 0;
  let y = y0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const seg = (L / n) * 1.04;
    const cx = x + Math.sin(a) * seg * 0.5;
    const cy = y + Math.cos(a) * seg * 0.5;
    f.box([cx, cy, 0], [w * (1 - t * 0.45), seg / 2, 0.011], steel, { group: null, R: rotZ(-a), bevel: 0.005 });
    x += Math.sin(a) * seg;
    y += Math.cos(a) * seg;
    a += bend / n;
  }
  f.ell([x, y, 0], [w * 0.5, 0.05, 0.011], steel, { group: null, R: rotZ(-a) });
}

/** Bow limb: a smooth arc of tapered segments in the xy plane. */
function bowArc(f, H, depth, m, { recurve = 0, r = 0.022 } = {}) {
  const n = 12;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n * 2 - 1; // -1..1
    let x = -depth * (1 - t * t);
    if (recurve) x += recurve * Math.max(0, Math.abs(t) - 0.75) * 4 * (Math.abs(t) - 0.75);
    pts.push([x, t * H / 2, 0]);
  }
  for (let i = 0; i < n; i++) {
    const t = Math.abs(i / n * 2 - 1);
    f.cone(pts[i], pts[i + 1], r * (1 - t * 0.5), r * (1 - Math.abs((i + 1) / n * 2 - 1) * 0.5), m, { group: 'bow', blend: 0.01 });
  }
  return pts;
}

/**
 * Body armour, each type with its own silhouette so it reads at a glance on a
 * card: a long quilted gambeson with sleeves, a leather cuirass with hanging
 * strips, a hooded mail hauberk, a flared coat of scales, banded plates that
 * wrap the body and the shoulders, vertical splints, and a ridged plate cuirass
 * with great pauldrons and tassets.
 */
function armour(f, kind) {
  const torso = (m, { waist = 0.26, chestW = 0.3 } = {}) => {
    f.ell([0, 0.08, 0], [chestW, 0.34, 0.16], m, { group: 'a' });
    f.ell([0, -0.22, 0], [waist, 0.14, 0.15], m, { group: 'a' });
    for (const d of [-1, 1]) f.ell([d * 0.3, 0.28, 0], [0.12, 0.1, 0.13], m, { group: 'a' });
    f.ell([0, 0.4, 0.02], [0.13, 0.05, 0.08], mat('#1a120a'), { group: null });
  };
  const sleeves = (m, len = 0.3, r = 0.075) => { for (const d of [-1, 1]) f.cone([d * 0.33, 0.27, 0], [d * (0.4 + len * 0.3), 0.27 - len, 0.02], r, r * 0.85, m, { group: 'a' }); };
  const skirt = (m, y1 = -0.55, flare = 0.34) => f.cone([0, -0.25, 0], [0, y1, 0.01], 0.25, flare, m, { group: 'a' });
  const leatherL = mat('#8a5a32', { pattern: 'leather', scale: 0.05, rough: 0.65, spec: 0.2 });
  const strap = mat('#3a2010', { pattern: 'leather', scale: 0.02 });
  switch (kind) {
    case 'padded': {
      // quilted gambeson: long sleeves, a skirt to the thigh, vertical quilting
      const cloth = mat('#e0d0a8', { pattern: 'cloth', scale: 0.03, rough: 0.9, spec: 0.05 });
      torso(cloth); sleeves(cloth, 0.42, 0.08); skirt(cloth, -0.5, 0.31);
      for (let i = -3; i <= 3; i++) f.box([i * 0.075, -0.05, 0.155 - Math.abs(i) * 0.012], [0.006, 0.4, 0.006], mat('#8a7a58', { rough: 1 }), { group: null });
      break;
    }
    case 'leather': {
      // boiled-leather cuirass, no sleeves; pteruges strips hang from the waist, buckled straps over the shoulders
      torso(leatherL, { waist: 0.24 });
      for (let i = -3; i <= 3; i++) f.box([i * 0.072, -0.42, 0.11 - Math.abs(i) * 0.015], [0.03, 0.11, 0.012], leatherL, { group: null, bevel: 0.008, R: rotZ(i * 0.04) });
      for (const d of [-1, 1]) f.box([d * 0.17, 0.3, 0.15], [0.03, 0.1, 0.012], strap, { group: null, bevel: 0.006 });
      f.box([0, -0.12, 0.16], [0.22, 0.02, 0.02], strap, { group: null, bevel: 0.01 });
      f.box([0, -0.12, 0.18], [0.035, 0.03, 0.01], brass, { group: null, bevel: 0.005 });
      break;
    }
    case 'studded': {
      const m = mat('#6a4224', { pattern: 'leather', scale: 0.05 });
      torso(m); sleeves(m, 0.18, 0.08); skirt(m, -0.42, 0.29);
      for (let j = 0; j < 8; j++) for (let i = -3; i <= 3; i++) f.sphere([i * 0.072 + (j % 2) * 0.036, 0.32 - j * 0.09, 0.15 + (Math.abs(i) < 3 ? 0.012 : -0.02) + (j > 5 ? 0.01 : 0)], 0.016, silver, { group: null });
      break;
    }
    case 'ring': {
      const m = mat('#6a4224', { pattern: 'leather', scale: 0.05 });
      torso(m); sleeves(m, 0.2, 0.08);
      for (let j = 0; j < 5; j++) for (let i = -3; i <= 3; i++) {
        f.ell([i * 0.075 + (j % 2) * 0.037, 0.3 - j * 0.1, 0.15 + (Math.abs(i) < 3 ? 0.01 : -0.03)], [0.028, 0.028, 0.006], steel, { group: null });
        f.ell([i * 0.075 + (j % 2) * 0.037, 0.3 - j * 0.1, 0.156 + (Math.abs(i) < 3 ? 0.01 : -0.03)], [0.013, 0.013, 0.004], mat('#2a1808'), { group: null });
      }
      break;
    }
    case 'scale': {
      // a coat of overlapping scales flaring to the thigh, short sleeves
      const m = mat('#b8b4a8', { pattern: 'scales', metal: true, scale: 0.06, rough: 0.35, spec: 0.9, tint2: '#8a7a5a' });
      torso(m); sleeves(m, 0.16, 0.085); skirt(m, -0.58, 0.38);
      break;
    }
    case 'chain':
    case 'elfin': {
      // a mail hauberk: elbow sleeves, hem to mid-thigh, and its coif rising behind the neck
      const m = mat(kind === 'elfin' ? '#dde4ee' : '#a8aab2', { pattern: 'mail', metal: true, scale: kind === 'elfin' ? 0.07 : 0.12, rough: kind === 'elfin' ? 0.2 : 0.4, spec: kind === 'elfin' ? 1.2 : 0.8 });
      torso(m); sleeves(m, 0.28, 0.08); skirt(m, -0.52, 0.32);
      f.ell([0, 0.5, -0.04], [0.17, 0.15, 0.15], m, { group: 'a' });
      f.ell([0, 0.47, 0.06], [0.1, 0.09, 0.06], mat('#120c08'), { group: null });
      break;
    }
    case 'banded': {
      // horizontal steel bands wrap the body; banded lames over each shoulder
      torso(mat('#5a4a3a', { pattern: 'mail', metal: true, scale: 0.12, rough: 0.5, spec: 0.5 }));
      for (let j = 0; j < 8; j++) {
        const y = 0.3 - j * 0.085;
        const w = 0.31 - Math.abs(j - 2.5) * 0.015;
        f.ell([0, y, 0.01], [w, 0.034, 0.175], steel, { group: null });
        for (const d of [-1, 1]) f.sphere([d * w * 0.55, y, 0.165], 0.013, brass, { group: null });
      }
      for (const d of [-1, 1]) for (let k = 0; k < 3; k++) f.ell([d * (0.33 + k * 0.03), 0.31 - k * 0.06, 0], [0.13, 0.035, 0.14], steel, { group: null, R: rotZ(d * -0.45) });
      break;
    }
    case 'splint': {
      // vertical splints riveted to leather, a skirt of splints, mail sleeves
      torso(mat('#5a3820', { pattern: 'leather', scale: 0.05 }));
      sleeves(mat('#9a9ca4', { pattern: 'mail', metal: true, scale: 0.12, rough: 0.4, spec: 0.8 }), 0.26, 0.075);
      for (let i = -4; i <= 4; i++) f.box([i * 0.06, 0.04, 0.15 - Math.abs(i) * 0.012], [0.024, 0.26, 0.012], iron, { group: null, R: rotY(i * 0.12), bevel: 0.008 });
      for (let i = -4; i <= 4; i++) f.box([i * 0.065, -0.42, 0.12 - Math.abs(i) * 0.014], [0.026, 0.12, 0.012], iron, { group: null, R: mul3(rotY(i * 0.12), rotZ(i * 0.05)), bevel: 0.008 });
      for (const y of [0.25, -0.2]) f.box([0, y, 0.165], [0.28, 0.012, 0.01], strap, { group: null, bevel: 0.005 });
      break;
    }
    case 'plate':
    default: {
      // a ridged breastplate, a gorget, great layered pauldrons and tassets
      f.ell([0, 0.08, 0.01], [0.3, 0.34, 0.17], steel, { group: 'p' });
      f.box([0, 0.1, 0.17], [0.008, 0.26, 0.008], silver, { group: null, bevel: 0.005 });
      for (let j = 0; j < 3; j++) f.ell([0, -0.2 - j * 0.07, 0.0], [0.27 - j * 0.01, 0.04, 0.16], steel, { group: null });
      for (const d of [-1, 1]) {
        for (let k = 0; k < 3; k++) f.ell([d * (0.34 + k * 0.02), 0.32 - k * 0.07, 0], [0.17 - k * 0.015, 0.11 - k * 0.02, 0.17], steel, { group: null, R: rotZ(d * (-0.35 - k * 0.1)) });
        f.box([d * 0.13, -0.46, 0.08], [0.1, 0.11, 0.015], steel, { group: null, bevel: 0.02, R: rotZ(d * 0.1) });
      }
      f.cone([0, 0.38, 0], [0, 0.5, 0], 0.15, 0.12, steel, { group: null });
      for (const d of [-1, 1]) f.sphere([d * 0.15, 0.32, 0.16], 0.016, brass, { group: null });
      break;
    }
  }
}

const POTION = { heal: '#e03030', 'heal:1d8': '#e03030', speed: '#40c0ff', invisibility: '#c8d0ff', fireResistance: '#ff8a20', neutralize: '#40e070', giantStrength: '#d0a040', heroism: '#ffd040' };

/** Build the 3D model for an item. Returns {f, rot, scale}. */
function model(def) {
  const f = new Figure();
  const id = def.id ?? '';
  const diag = euler3(0, 0, -0.78);
  switch (id) {
    case 'dagger': case 'silverDagger': {
      blade(f, 0.02, 0.36, 0.05, id === 'silverDagger' ? silver : steel, { taper: 0.55 });
      hilt(f, 0, { guard: 0.08, gripL: 0.13, pommel: 0.028, m: id === 'silverDagger' ? silver : brass });
      return { f, R: diag };
    }
    case 'shortSword': blade(f, 0.02, 0.5, 0.05); hilt(f, 0, { guard: 0.1 }); return { f, R: diag };
    case 'longSword': case 'longSwordPlus1': case 'longSwordPlus2': blade(f, 0.02, 0.72, 0.045); hilt(f, 0, { guard: 0.13 }); return { f, R: diag };
    case 'broadSword': blade(f, 0.02, 0.62, 0.07, steel, { taper: 0.85 }); hilt(f, 0, { guard: 0.15, m: iron }); f.ell([0, 0, 0.02], [0.05, 0.05, 0.02], brass, { group: null }); return { f, R: diag };
    case 'twoHandedSword': blade(f, 0.02, 0.86, 0.05); hilt(f, 0, { guard: 0.18, twoHand: true, m: iron }); for (const d of [-1, 1]) f.cone([d * 0.05, 0.06, 0], [d * 0.08, 0.1, 0], 0.012, 0.004, iron, { group: null }); return { f, R: diag };
    case 'scimitar': curvedBlade(f, 0.02, 0.62, 0.05, 0.9); hilt(f, 0, { guard: 0.07, m: brass }); return { f, R: euler3(0, 0, -0.6) };
    case 'battleAxe': case 'handAxe': {
      const big = id === 'battleAxe';
      const L = big ? 0.8 : 0.55;
      f.cone([0, -L * 0.45, 0], [0, L * 0.55, 0], 0.022, 0.02, wood, { group: null });
      f.box([0.06, L * 0.45, 0], [0.06, big ? 0.06 : 0.045, 0.014], iron, { group: null, bevel: 0.01 });
      f.ell([0.14, L * 0.45, 0], [0.04, big ? 0.16 : 0.1, 0.012], steel, { group: null });
      if (big) f.cone([-0.02, L * 0.45, 0], [-0.1, L * 0.45, 0], 0.03, 0.008, iron, { group: null });
      f.cone([0, -L * 0.45, 0], [0, -L * 0.3, 0], 0.025, 0.025, grip, { group: null });
      return { f, R: euler3(0, 0, -0.6) };
    }
    case 'mace': case 'morningStar': case 'flail': case 'club': case 'hammer': {
      f.cone([0, -0.4, 0], [0, 0.3, 0], 0.022, 0.02, id === 'club' ? wood : darkWood, { group: null });
      if (id === 'club') { f.cone([0, -0.1, 0], [0, 0.4, 0], 0.03, 0.07, wood, { group: null }); f.sphere([0, 0.4, 0], 0.07, wood, { group: null }); }
      if (id === 'mace') {
        f.sphere([0, 0.36, 0], 0.06, iron, { group: null });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; f.box([Math.cos(a) * 0.06, 0.36, Math.sin(a) * 0.06], [0.03, 0.08, 0.008], steel, { group: null, R: rotY(-a), bevel: 0.006 }); }
      }
      if (id === 'morningStar') {
        f.sphere([0, 0.38, 0], 0.08, iron, { group: null });
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const b = (i % 3 - 1) * 0.6; f.cone([Math.cos(a) * 0.07 * Math.cos(b), 0.38 + Math.sin(b) * 0.07, Math.sin(a) * 0.07 * Math.cos(b)], [Math.cos(a) * 0.13 * Math.cos(b), 0.38 + Math.sin(b) * 0.13, Math.sin(a) * 0.13 * Math.cos(b)], 0.016, 0.002, steel, { group: null }); }
      }
      if (id === 'flail') {
        for (let i = 0; i < 6; i++) f.ell([0.03 * i, 0.32 + 0.035 * i, 0], [0.012, 0.018, 0.006], iron, { group: null, R: rotZ(-0.6 + (i % 2) * 1.2) });
        f.sphere([0.22, 0.52, 0], 0.07, iron, { group: null });
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; f.cone([0.22 + Math.cos(a) * 0.06, 0.52 + Math.sin(a) * 0.06, 0], [0.22 + Math.cos(a) * 0.11, 0.52 + Math.sin(a) * 0.11, 0], 0.014, 0.002, steel, { group: null }); }
      }
      if (id === 'hammer') { f.box([0, 0.34, 0], [0.11, 0.045, 0.045], iron, { group: null, bevel: 0.012 }); f.cone([-0.1, 0.34, 0], [-0.2, 0.32, 0], 0.03, 0.006, iron, { group: null }); }
      f.cone([0, -0.4, 0], [0, -0.22, 0], 0.025, 0.025, grip, { group: null });
      return { f, R: euler3(0, 0, -0.6) };
    }
    case 'staff': {
      f.cone([0, -0.75, 0], [0, 0.75, 0], 0.024, 0.022, wood, { group: null });
      for (const y of [-0.74, 0.74]) f.sphere([0, y, 0], 0.035, darkWood, { group: null });
      f.cone([0, -0.05, 0], [0, 0.12, 0], 0.028, 0.028, grip, { group: null });
      return { f, R: euler3(0, 0, -0.78) };
    }
    case 'spear': case 'halberd': case 'glaive': {
      f.cone([0, -0.8, 0], [0, 0.55, 0], 0.018, 0.016, wood, { group: null });
      if (id === 'spear') { f.ell([0, 0.68, 0], [0.045, 0.15, 0.01], steel, { group: null }); f.cone([0, 0.52, 0], [0, 0.56, 0], 0.024, 0.02, cord, { group: null }); }
      if (id === 'halberd') {
        f.cone([0, 0.55, 0], [0, 0.85, 0], 0.02, 0.003, steel, { group: null });
        f.ell([0.11, 0.5, 0], [0.09, 0.13, 0.01], steel, { group: null, R: rotZ(0.15) });
        f.cone([-0.02, 0.52, 0], [-0.13, 0.58, 0], 0.025, 0.004, steel, { group: null });
      }
      if (id === 'glaive') { curvedBlade(f, 0.52, 0.36, 0.05, -0.5); f.cone([0, 0.5, 0], [0, 0.56, 0], 0.025, 0.025, iron, { group: null }); }
      return { f, R: euler3(0, 0, -0.78) };
    }
    case 'shortBow': case 'longBow': case 'compositeBow': {
      const long = id === 'longBow';
      const comp = id === 'compositeBow';
      const Hh = long ? 1.5 : comp ? 1.15 : 0.95;
      const pts = bowArc(f, Hh, long ? 0.18 : 0.15, comp ? mat('#3a2a1c', { pattern: 'wood', scale: 0.02, rough: 0.5, spec: 0.4 }) : wood, { recurve: comp ? 0.25 : 0, r: long ? 0.022 : 0.02 });
      f.cone(pts[0], pts[pts.length - 1], 0.004, 0.004, cord, { group: null });
      f.cone([-((long ? 0.18 : 0.15)), -0.07, 0], [-((long ? 0.18 : 0.15)), 0.07, 0], 0.03, 0.03, grip, { group: null });
      if (comp) for (const y of [-0.3, 0.3]) f.ell([pts[Math.round((y + 0.575) / 1.15 * 12)][0], y, 0], [0.028, 0.012, 0.028], mat('#e8dcc0', { rough: 0.4, spec: 0.5 }), { group: null });
      return { f, R: euler3(0, 0, -0.6) };
    }
    case 'lightCrossbow': case 'heavyCrossbow': {
      const heavy = id === 'heavyCrossbow';
      f.box([0, -0.05, 0], [0.04, heavy ? 0.46 : 0.38, 0.03], darkWood, { group: null, bevel: 0.015 });
      f.box([0, -0.4, 0], [0.05, 0.12, 0.04], wood, { group: null, bevel: 0.02, R: rotX(0.1) });
      const span = heavy ? 0.42 : 0.34;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * 2 - 1;
        const t1 = ((i + 1) / n) * 2 - 1;
        f.cone([t0 * span, 0.32 - t0 * t0 * 0.07, 0], [t1 * span, 0.32 - t1 * t1 * 0.07, 0], 0.016, 0.016, heavy ? iron : wood, { group: 'prod', blend: 0.01 });
      }
      f.cone([-span, 0.25, 0], [span, 0.25, 0], 0.004, 0.004, cord, { group: null });
      f.box([0, 0.3, 0], [0.05, 0.03, 0.035], iron, { group: null, bevel: 0.01 });
      f.box([0, -0.15, -0.03], [0.008, 0.06, 0.02], iron, { group: null, bevel: 0.004 });
      if (heavy) { f.cone([-0.08, -0.32, 0], [0.08, -0.32, 0], 0.03, 0.03, iron, { group: null }); for (const d of [-1, 1]) f.box([d * 0.1, -0.32, 0], [0.008, 0.06, 0.008], iron, { group: null, bevel: 0.004 }); }
      return { f, R: euler3(0, 0, -0.78) };
    }
    case 'arrows': case 'quarrels': {
      const q = id === 'quarrels';
      for (let i = -1; i <= 1; i++) {
        f.push([i * 0.07, 0, i === 0 ? 0.03 : 0], rotZ(i * 0.08), 1);
        const L = q ? 0.55 : 0.85;
        f.cone([0, -L / 2, 0], [0, L / 2, 0], q ? 0.013 : 0.009, q ? 0.013 : 0.009, wood, { group: null });
        f.ell([0, L / 2 + 0.04, 0], [q ? 0.024 : 0.018, 0.05, 0.006], iron, { group: null });
        for (const a of [0, 2.1, 4.2]) f.ell([Math.cos(a) * 0.016, -L / 2 + 0.06, Math.sin(a) * 0.016], [0.004, 0.06, 0.02], mat(q ? '#3a2a1a' : i === 0 ? '#a01e1e' : '#e8e0d0', { pattern: 'fur', scale: 0.005 }), { group: null, R: rotY(a) });
        f.pop();
      }
      f.box([0, -0.05, 0.03], [0.14, 0.02, 0.02], leather, { group: null, bevel: 0.01 });
      return { f, R: euler3(0, 0, -0.78) };
    }
    case 'sling': {
      // a broad leather cradle holding a stone, two plaited cords rising to a finger loop
      const cradle = mat('#a87a4a', { pattern: 'leather', scale: 0.04, rough: 0.6, spec: 0.25 });
      f.ell([0, -0.32, 0], [0.16, 0.09, 0.05], cradle, { group: 'p' });
      f.sphere([0, -0.3, 0.05], 0.065, mat('#a8a49a', { pattern: 'stone', scale: 0.03 }), { group: null });
      const cordM = mat('#e8dcc0', { pattern: 'cloth', scale: 0.008, rough: 0.8 });
      for (const d of [-1, 1]) f.cone([d * 0.15, -0.3, 0], [d * 0.03, 0.42, 0], 0.016, 0.014, cordM, { group: null });
      f.ell([0, 0.47, 0], [0.05, 0.06, 0.016], cordM, { group: null });
      f.ell([0, 0.47, 0.004], [0.028, 0.035, 0.02], mat('#0a0806'), { group: null });
      return { f, R: euler3(0, 0, -0.35) };
    }
    case 'dart': {
      f.cone([0, -0.3, 0], [0, 0.25, 0], 0.012, 0.01, wood, { group: null });
      f.cone([0, 0.25, 0], [0, 0.4, 0], 0.02, 0.002, steel, { group: null });
      for (const a of [0, 2.1, 4.2]) f.ell([Math.cos(a) * 0.02, -0.25, Math.sin(a) * 0.02], [0.004, 0.07, 0.03], mat('#c8b890', { pattern: 'fur', scale: 0.005 }), { group: null, R: rotY(a) });
      return { f, R: euler3(0, 0, -0.78) };
    }
    case 'padded': armour(f, 'padded'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'leather': armour(f, 'leather'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'studdedLeather': armour(f, 'studded'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'ringMail': armour(f, 'ring'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'scaleMail': armour(f, 'scale'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'chainMail': armour(f, 'chain'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'elfinChain': armour(f, 'elfin'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'bandedMail': armour(f, 'banded'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'splintMail': armour(f, 'splint'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'plateMail': case 'plateMailPlus1': armour(f, 'plate'); return { f, R: euler3(0.15, 0.3, 0) };
    case 'shield': case 'shieldPlus1': {
      f.ell([0, 0, 0], [0.42, 0.42, 0.05], mat('#6a3a1e', { pattern: 'wood', scale: 0.04 }), { group: null });
      f.ell([0, 0, -0.01], [0.44, 0.44, 0.04], iron, { group: null });
      f.sphere([0, 0, 0.04], 0.1, steel, { group: null });
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; f.sphere([Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.04], 0.022, brass, { group: null }); }
      f.box([0, 0.2, 0.05], [0.04, 0.12, 0.005], mat('#a01e1e', { pattern: 'cloth', scale: 0.01 }), { group: null, bevel: 0.003 });
      return { f, R: euler3(0.25, 0.4, 0) };
    }
    case 'helm': {
      f.ell([0, 0.05, 0], [0.26, 0.3, 0.28], steel, { group: 'h' });
      f.cone([0, -0.2, 0.02], [0, 0.0, 0.02], 0.25, 0.26, steel, { group: 'h' });
      f.box([0, -0.03, 0.27], [0.18, 0.012, 0.02], mat('#0a0a0e'), { group: null, bevel: 0.006 });
      f.box([0, 0.1, 0.28], [0.02, 0.18, 0.012], brass, { group: null, bevel: 0.006 });
      for (let i = 0; i < 5; i++) f.sphere([-0.06 + i * 0.03, -0.12, 0.27], 0.008, mat('#0a0a0e'), { group: null });
      return { f, R: euler3(0.1, 0.5, 0) };
    }
    default:
      break;
  }
  if (def.type === 'potion') {
    const c = POTION[def.effect] ?? (def.effect?.startsWith?.('heal') ? '#e03030' : '#a060ff');
    f.ell([0, -0.08, 0], [0.24, 0.26, 0.24], mat(c, { rough: 0.05, spec: 1.4, emissive: c.replace('#', '#').length ? null : null }), { group: 'p' });
    f.cone([0, 0.12, 0], [0, 0.34, 0], 0.07, 0.06, mat('#d8e8f0', { rough: 0.05, spec: 1.4 }), { group: 'p' });
    f.cone([0, 0.33, 0], [0, 0.42, 0], 0.07, 0.07, mat('#8a6a4a', { pattern: 'wood', scale: 0.02 }), { group: null });
    f.glow([0, -0.08, 0.2], 0.25, c, 0.45);
    return { f, R: euler3(0.1, 0, 0) };
  }
  if (def.type === 'scroll') {
    f.cone([-0.36, 0, 0], [0.36, 0, 0], 0.08, 0.08, mat('#e8dcbc', { pattern: 'cloth', scale: 0.006, rough: 0.9 }), { group: null });
    for (const d of [-1, 1]) f.ell([d * 0.37, 0, 0], [0.012, 0.085, 0.085], mat('#c8b890', { rough: 0.9 }), { group: null });
    f.ell([0, 0, 0], [0.04, 0.09, 0.09], mat(def.effect === 'sleep' ? '#3a4a8a' : def.effect === 'cureLight' ? '#a01e1e' : '#2c5634', { pattern: 'cloth', scale: 0.006 }), { group: null });
    f.sphere([0, -0.07, 0.07], 0.035, mat('#a8201a', { rough: 0.4, spec: 0.5 }), { group: null });
    return { f, R: euler3(0.3, 0.2, -0.45) };
  }
  return null;
}

function euler3(x, y, z) { return mul3(rotY(y), mul3(rotX(x), rotZ(z))); }

/**
 * Data URL of an item's 3D art (size×size), or null if the item has no model.
 * @param {object} def ItemDef
 * @param {{magic?:boolean, size?:number}} [o]
 */
export function itemArtURL(def, o = {}) {
  const size = o.size ?? 96;
  const key = `${def?.id}|${o.magic ? 1 : 0}|${size}`;
  if (cache.has(key)) return cache.get(key);
  const m = def ? model(def) : null;
  let url = null;
  if (m) {
    // orient the model for the card, then fit it into the square
    const f2 = new Figure();
    f2.prims = m.f.prims.map((p) => p);
    const thin = ['weapon', 'ammo'].includes(def.type);
    if (thin) fatten(m.f, 1.55);
    const r0 = renderFigure(orient(m.f, m.R), { ppu: 100, yaw: 0, pitch: 0, rig: RIG, ss: 1, ink: 0.7, paint: 0, shadow: true });
    const ext = Math.max(r0.canvas.width, r0.canvas.height) / 100;
    const ppu = (size * (thin ? 0.98 : 0.86)) / ext;
    const r = renderFigure(orient(m.f, m.R), { ppu, yaw: 0, pitch: 0, rig: RIG, ss: 2, ink: 0.8, paint: 1, shadow: true });
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (o.magic) {
      const rg = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
      rg.addColorStop(0, 'rgba(120,190,255,0.5)');
      rg.addColorStop(1, 'rgba(120,190,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, size, size);
    }
    // a warm lit disc behind every item so dark wood, leather and cord read against the navy cards
    const halo = g.createRadialGradient(size / 2, size * 0.46, size * 0.05, size / 2, size / 2, size * 0.5);
    halo.addColorStop(0, 'rgba(236,214,170,0.5)');
    halo.addColorStop(0.6, 'rgba(160,150,140,0.2)');
    halo.addColorStop(1, 'rgba(120,140,190,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);
    g.shadowColor = 'rgba(0,0,0,0.75)';
    g.shadowBlur = size * 0.06;
    g.shadowOffsetX = size * 0.02;
    g.shadowOffsetY = size * 0.035;
    g.drawImage(r.canvas, (size - r.canvas.width) / 2, (size - r.canvas.height) / 2);
    g.shadowColor = 'transparent';
    g.globalCompositeOperation = 'lighter';
    for (const e of r.emit) {
      const gr = g.createRadialGradient((size - r.canvas.width) / 2 + e.x, (size - r.canvas.height) / 2 + e.y, 0, (size - r.canvas.width) / 2 + e.x, (size - r.canvas.height) / 2 + e.y, e.r);
      gr.addColorStop(0, e.color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = e.a * 0.6;
      g.fillStyle = gr;
      g.fillRect(0, 0, size, size);
    }
    url = c.toDataURL('image/png');
  }
  cache.set(key, url);
  return url;
}

/** Thicken a model's cross-sections (keeps lengths): weapons read better as icons. */
function fatten(f, k) {
  for (const p of f.prims) {
    if (p._fat) continue;
    p._fat = true;
    if (p.type === 0) { p.ra *= k; p.rb *= k; } else if (p.type === 1) p.r = [p.r[0] * k, p.r[1], p.r[2] * k]; else p.h = [p.h[0] * k, p.h[1], p.h[2] * k];
  }
}

/** A copy of a figure with every primitive rotated by R about the origin. */
function orient(f, R) {
  const o = new Figure();
  o.push([0, 0, 0], R, 1);
  for (const p of f.prims) {
    const q = { ...p };
    if (p.type === 0) { q.a = rot(R, p.a); q.b = rot(R, p.b); } else { q.c = rot(R, p.c); q.R = mul3(R, p.R); }
    o.prims.push(q);
  }
  o.emit = f.emit.map((e) => ({ ...e, p: rot(R, e.p) }));
  return o;
}
const rot = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
void M; void weapon; void alignY; void iron;
