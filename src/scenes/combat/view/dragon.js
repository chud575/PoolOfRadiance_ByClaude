import * as THREE from 'three';
import { RigBuilder } from './rig.js';
import { SculptBuilder, skinSculpt, sculptMaterial } from './sculpted.js';
import { mAlongY, mEuler } from '../../../ui/components/sdfSculpt.js';

/**
 * Tyranthraxus, the Flamed One, wearing the body of a great bronze dragon.
 *
 * One continuous sculpted hide (signed-distance masses melted together and
 * auto-skinned to the skeleton, see sculpted.js): a deep keeled chest and
 * shoulder masses, an S-curved neck tapering to a wedge skull with heavy brow
 * ridges, an open hinged jaw full of teeth, swept horns and a spined frill;
 * pillar forelegs and digitigrade hind legs with real thigh mass on splayed,
 * clawed feet; a tail that thins to a whip and curls along the ground.
 * The bronze is a dedicated scale pattern (keeled plates, worn bright crowns,
 * verdigris crusted in every crevice). Bat wings: finger bones carrying a
 * scalloped, sagging membrane that glows where the fire behind shines through.
 *
 * The sculpt is authored at 1/K scale (so its surface detail lands at
 * palm-sized scales in the world) and the rig root is scaled by K.
 */
const K = 2.75;

const v = (x, y, z) => [x, y, z];
const mirror = (p) => [-p[0], p[1], p[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Bind-pose joint positions (figure space, sculpt units; +Z forward, ground y=0).
const JW = {
  body: v(0, 1.05, -0.15),
  chest: v(0, 1.2, 0.55),
  neck1: v(0, 1.42, 0.86),
  neck2: v(0, 1.74, 1.08),
  neck3: v(0, 2.04, 1.02),
  head: v(0, 2.26, 1.1),
  jaw: v(0, 2.2, 1.14),
  tail1: v(0, 1.0, -0.64),
  tail2: v(0, 0.8, -1.1),
  tail3: v(0.08, 0.48, -1.46),
  tail4: v(0.42, 0.2, -1.78),
  tail5: v(0.88, 0.1, -1.9),
  wingL: v(0.26, 1.52, 0.46),
  legFL: v(0.34, 1.06, 0.66),
  kneeFL: v(0.38, 0.6, 0.78),
  footFL: v(0.36, 0.13, 0.72),
  legBL: v(0.4, 0.96, -0.26),
  kneeBL: v(0.46, 0.52, 0.04),
  ankBL: v(0.45, 0.15, -0.26),
};
for (const k of Object.keys(JW)) if (k.endsWith('L') && !k.startsWith('tail')) JW[k.slice(0, -1) + 'R'] = mirror(JW[k]);
JW.wingR = mirror(JW.wingL);

const PARENT = {
  body: null, chest: 'body', neck1: 'chest', neck2: 'neck1', neck3: 'neck2', head: 'neck3', jaw: 'head',
  tail1: 'body', tail2: 'tail1', tail3: 'tail2', tail4: 'tail3', tail5: 'tail4',
  wingL: 'chest', wingR: 'chest',
  legFL: 'chest', kneeFL: 'legFL', footFL: 'kneeFL', legFR: 'chest', kneeFR: 'legFR', footFR: 'kneeFR',
  legBL: 'body', kneeBL: 'legBL', ankBL: 'kneeBL', legBR: 'body', kneeBR: 'legBR', ankBR: 'kneeBR',
};
const ORDER = Object.keys(PARENT);

let _cache = null;

/** The sculpted hide (meshed once, shared by every Tyranthraxus). */
function dragonHide() {
  if (_cache) return _cache;
  const B = new SculptBuilder();
  B.mat('bronze', 0xb8823a, { pattern: 'dscale', rough: 0.38, metal: 0.62, edge: 0.55, wash: 0.95, soft: 0.02 })
    .mat('back', 0x7a5222, { pattern: 'dscale', rough: 0.4, metal: 0.78, edge: 0.6, wash: 1.0, soft: 0.03 })
    .mat('belly', 0xd8b068, { pattern: 'dplate', rough: 0.45, metal: 0.45, edge: 0.45, wash: 0.85, soft: 0.02 })
    .mat('horn', 0x2c2218, { pattern: 'smooth', rough: 0.5, metal: 0.05, edge: 0.6, wash: 0.6, soft: 0.004 })
    .mat('mouth', 0x4a0e06, { pattern: 'smooth', rough: 0.35, edge: 0, wash: 0.4, soft: 0.004 })
    .mat('frill', 0x6a3a16, { pattern: 'skin', rough: 0.55, metal: 0.3, edge: 0.4, wash: 0.9, soft: 0.01 });
  const ell = (bone, c, r, o = {}) => B.ell(bone, c, r, { k: 0.06, ...o });
  const cone = (bone, a, b, ra, rb, o = {}) => B.cone(bone, a, b, ra, rb, { k: 0.05, ...o });
  const R = (pitch, yaw = 0, roll = 0) => mEuler(pitch, yaw, roll);

  // ---- torso: a deep, keeled chest, a narrower waist, heavy haunches.
  ell('chest', v(0, 1.2, 0.46), v(0.4, 0.46, 0.52), { mat: 'bronze', k: 0.12 });
  ell('chest', v(0, 0.98, 0.5), v(0.3, 0.3, 0.42), { mat: 'belly', k: 0.1 });
  ell('body', v(0, 1.06, -0.1), v(0.36, 0.38, 0.5), { mat: 'bronze', k: 0.14 });
  ell('body', v(0, 0.86, -0.06), v(0.27, 0.22, 0.44), { mat: 'belly', k: 0.1 });
  ell('body', v(0, 1.08, -0.48), v(0.34, 0.32, 0.3), { mat: 'bronze', k: 0.12 });
  // Shoulder masses and the dark spine line.
  for (const sx of [1, -1]) ell('chest', v(sx * 0.3, 1.2, 0.62), v(0.19, 0.27, 0.24), { mat: 'bronze', k: 0.12 });
  ell('chest', v(0, 1.58, 0.42), v(0.16, 0.1, 0.42), { mat: 'back', k: 0.12, R: R(-0.2) });
  ell('body', v(0, 1.42, -0.2), v(0.16, 0.08, 0.5), { mat: 'back', k: 0.12, R: R(0.05) });
  // Ribs under the hide: shallow ridges along the flank.
  for (let i = 0; i < 4; i++) for (const sx of [1, -1]) ell('chest', v(sx * 0.37, 1.12 - i * 0.02, 0.62 - i * 0.16), v(0.05, 0.3, 0.05), { mat: 'bronze', k: 0.06, R: R(0.3, 0, sx * 0.25) });

  // ---- the neck: an S-curve (forward out of the chest, back, then the head
  // thrust forward), thinning steadily, with ventral plates down the throat.
  const neck = [v(0, 1.32, 0.78), v(0, 1.52, 0.98), JW.neck2, v(0, 1.9, 1.07), JW.neck3, v(0, 2.16, 1.05), v(0, 2.22, 1.1)];
  const nr = [0.27, 0.23, 0.2, 0.175, 0.155, 0.135, 0.12];
  const ntag = ['chest', 'neck1', 'neck1', 'neck2', 'neck2', 'neck3', 'neck3'];
  for (let i = 0; i < neck.length - 1; i++) cone(ntag[i + 1], neck[i], neck[i + 1], nr[i], nr[i + 1], { mat: 'bronze', k: 0.08 });
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const p = lerp3(neck[Math.floor(t * 6)], neck[Math.floor(t * 6) + 1], (t * 6) % 1);
    ell(ntag[Math.min(6, Math.floor(t * 6) + 1)], [p[0], p[1] - 0.02, p[2] + nr[Math.floor(t * 6)] * 0.62], v(nr[Math.floor(t * 6)] * 0.72, 0.07, 0.07), { mat: 'belly', k: 0.05 });
  }

  // ---- the skull: a long wedge, heavy brow ridges over deep sockets, cheek
  // plates at the jaw hinge, a broad flat snout with flared nostrils.
  const H = JW.head;
  const hp = (x, y, z) => [H[0] + x, H[1] + y, H[2] + z];
  ell('head', hp(0, 0.0, 0.03), v(0.13, 0.115, 0.16), { mat: 'bronze', k: 0.06 });
  ell('head', hp(0, -0.01, 0.24), v(0.105, 0.075, 0.22), { mat: 'bronze', k: 0.07, R: R(0.1) });
  ell('head', hp(0, -0.03, 0.44), v(0.085, 0.06, 0.1), { mat: 'bronze', k: 0.05 });
  ell('head', hp(0, 0.05, 0.3), v(0.06, 0.035, 0.22), { mat: 'back', k: 0.05, R: R(0.18) });
  for (const sx of [1, -1]) {
    ell('head', hp(sx * 0.08, 0.075, 0.13), v(0.06, 0.032, 0.11), { mat: 'back', k: 0.03, R: R(0.25, sx * 0.25) });
    ell('head', hp(sx * 0.1, -0.05, 0.02), v(0.055, 0.07, 0.08), { mat: 'bronze', k: 0.04 });
    // Eye sockets (the glowing eye sits in each, as rigid kit).
    B.sph('head', hp(sx * 0.098, 0.03, 0.15), 0.03, { mat: 'horn', sub: true, k: 0.012 });
    ell('head', hp(sx * 0.04, 0.0, 0.52), v(0.028, 0.022, 0.03), { mat: 'bronze', k: 0.02 });
    B.sph('head', hp(sx * 0.04, 0.005, 0.545), 0.014, { mat: 'mouth', sub: true, k: 0.006 });
    // Swept horns: a great pair from the brow raking back, a lesser pair below.
    cone('head', hp(sx * 0.07, 0.08, -0.02), hp(sx * 0.13, 0.2, -0.24), 0.036, 0.018, { mat: 'horn', k: 0.015 });
    cone('head', hp(sx * 0.13, 0.2, -0.24), hp(sx * 0.17, 0.2, -0.42), 0.018, 0.004, { mat: 'horn', k: 0.008 });
    cone('head', hp(sx * 0.12, -0.02, -0.03), hp(sx * 0.22, 0.0, -0.2), 0.025, 0.005, { mat: 'horn', k: 0.01 });
    // Frill: spines fanning back from the cheek with a webbed hide between.
    for (let k = 0; k < 4; k++) {
      const a = -0.3 + k * 0.32;
      const base = hp(sx * 0.11, -0.03 + k * 0.02, -0.04);
      const tip = hp(sx * (0.2 + k * 0.012), -0.08 + Math.sin(a) * 0.14 + 0.08, -0.16 - Math.cos(a) * 0.06);
      cone('head', base, tip, 0.012, 0.003, { mat: 'horn', k: 0.008 });
    }
    ell('head', hp(sx * 0.17, 0.0, -0.1), v(0.012, 0.09, 0.07), { mat: 'frill', k: 0.03, R: R(0.1, sx * 0.5, 0) });
  }
  // Upper teeth line / mouth cavity under the snout.
  ell('head', hp(0, -0.075, 0.28), v(0.075, 0.025, 0.2), { mat: 'mouth', k: 0.02 });
  // ---- the lower jaw, hinged and open.
  const J = JW.jaw;
  const jp = (x, y, z) => [J[0] + x, J[1] + y, J[2] + z];
  for (const sx of [1, -1]) cone('jaw', jp(sx * 0.085, -0.02, -0.02), jp(sx * 0.045, -0.16, 0.36), 0.04, 0.022, { mat: 'bronze', k: 0.035 });
  ell('jaw', jp(0, -0.11, 0.18), v(0.06, 0.03, 0.18), { mat: 'belly', k: 0.04, R: R(-0.42) });
  ell('jaw', jp(0, -0.09, 0.2), v(0.05, 0.02, 0.15), { mat: 'mouth', k: 0.02, R: R(-0.42) });
  cone('jaw', jp(0, -0.1, -0.02), jp(0, -0.17, 0.14), 0.02, 0.006, { mat: 'horn', k: 0.01 });

  // ---- limbs. Forelegs: muscled upper arm, scaled forearm, broad hand.
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const L = (k) => JW[k + side];
    ell(`legF${side}`, lerp3(L('legF'), L('kneeF'), 0.35), v(0.17, 0.26, 0.19), { mat: 'bronze', k: 0.1 });
    cone(`legF${side}`, L('legF'), L('kneeF'), 0.16, 0.1, { mat: 'bronze', k: 0.07 });
    cone(`kneeF${side}`, L('kneeF'), L('footF'), 0.095, 0.065, { mat: 'bronze', k: 0.06 });
    ell(`kneeF${side}`, sub(L('kneeF'), [0, 0.02, 0.03]), v(0.08, 0.07, 0.07), { mat: 'back', k: 0.05 });
    ell(`footF${side}`, [L('footF')[0], 0.07, L('footF')[2] + 0.06], v(0.11, 0.06, 0.13), { mat: 'bronze', k: 0.05 });
    for (let t = 0; t < 4; t++) {
      const a = (t - 1.5) * 0.32;
      const f = L('footF');
      const base = [f[0] + Math.sin(a) * 0.07, 0.06, f[2] + 0.1];
      const knuckle = [f[0] + Math.sin(a) * 0.13, 0.05, f[2] + 0.1 + Math.cos(a) * 0.1];
      cone(`footF${side}`, base, knuckle, 0.035, 0.026, { mat: 'bronze', k: 0.03 });
      cone(`footF${side}`, knuckle, [knuckle[0] + Math.sin(a) * 0.05, 0.005, knuckle[2] + Math.cos(a) * 0.07], 0.022, 0.003, { mat: 'horn', k: 0.008 });
    }
    // Hind legs: a heavy thigh, a forward knee, a long shank to the raised hock,
    // and a splayed, three-toed foot with a dew-claw (digitigrade).
    ell(`legB${side}`, [sx * 0.4, 0.9, -0.2], v(0.2, 0.3, 0.27), { mat: 'bronze', k: 0.12, R: R(-0.35) });
    cone(`legB${side}`, L('legB'), L('kneeB'), 0.18, 0.1, { mat: 'bronze', k: 0.08 });
    cone(`kneeB${side}`, L('kneeB'), L('ankB'), 0.095, 0.06, { mat: 'bronze', k: 0.06 });
    ell(`kneeB${side}`, L('kneeB'), v(0.085, 0.08, 0.08), { mat: 'back', k: 0.05 });
    const A = L('ankB');
    cone(`ankB${side}`, A, [A[0], 0.06, A[2] + 0.2], 0.06, 0.05, { mat: 'bronze', k: 0.05 });
    for (let t = 0; t < 3; t++) {
      const a = (t - 1) * 0.42;
      const base = [A[0] + Math.sin(a) * 0.03, 0.06, A[2] + 0.2];
      const knuckle = [A[0] + Math.sin(a) * 0.12, 0.045, A[2] + 0.2 + Math.cos(a) * 0.15];
      cone(`ankB${side}`, base, knuckle, 0.04, 0.028, { mat: 'bronze', k: 0.03 });
      cone(`ankB${side}`, knuckle, [knuckle[0] + Math.sin(a) * 0.05, 0.005, knuckle[2] + Math.cos(a) * 0.08], 0.024, 0.003, { mat: 'horn', k: 0.008 });
    }
    cone(`ankB${side}`, [A[0] - sx * 0.04, 0.12, A[2] + 0.04], [A[0] - sx * 0.09, 0.03, A[2] - 0.02], 0.02, 0.004, { mat: 'horn', k: 0.01 });
    // Wing roots: the shoulder knuckle the wing arm grows from.
    ell('chest', [sx * 0.24, 1.52, 0.44], v(0.1, 0.09, 0.12), { mat: 'bronze', k: 0.08 });
  }

  // ---- the tail: tapering segments that curl along the ground to a whip.
  const tail = [v(0, 1.04, -0.5), JW.tail1, JW.tail2, JW.tail3, JW.tail4, JW.tail5, v(1.22, 0.07, -1.74), v(1.42, 0.06, -1.5)];
  const tr = [0.3, 0.24, 0.18, 0.13, 0.09, 0.06, 0.035, 0.012];
  const ttag = ['body', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail5', 'tail5'];
  for (let i = 0; i < tail.length - 1; i++) cone(ttag[i + 1], tail[i], tail[i + 1], tr[i], tr[i + 1], { mat: 'bronze', k: 0.06 });
  for (let i = 1; i < tail.length - 2; i++) ell(ttag[i], [tail[i][0], tail[i][1] - tr[i] * 0.55, tail[i][2]], v(tr[i] * 0.75, tr[i] * 0.4, tr[i] * 0.8), { mat: 'belly', k: 0.05 });

  // ---- dorsal spines: neck, back and tail, largest over the shoulders.
  const ridge = [];
  for (let i = 0; i < neck.length - 1; i++) ridge.push([ntag[i + 1], lerp3(neck[i], neck[i + 1], 0.5), nr[i] * 0.95, 0.06 + i * 0.005, [0, 0.4, -1]]);
  ridge.push(['chest', v(0, 1.66, 0.6), 0.0, 0.1, [0, 0.6, -0.8]], ['chest', v(0, 1.66, 0.36), 0, 0.11, [0, 0.6, -0.8]], ['chest', v(0, 1.62, 0.12), 0, 0.1, [0, 0.6, -0.8]]);
  ridge.push(['body', v(0, 1.5, -0.12), 0, 0.095, [0, 0.6, -0.8]], ['body', v(0, 1.46, -0.36), 0, 0.085, [0, 0.6, -0.8]], ['body', v(0, 1.38, -0.58), 0, 0.075, [0, 0.6, -0.8]]);
  for (let i = 1; i < tail.length - 2; i++) ridge.push([ttag[i], [tail[i][0], tail[i][1] + tr[i] * 0.85, tail[i][2]], 0, 0.07 - i * 0.009, [0, 0.55, -0.85]]);
  for (const [bone, p, off, len, dir] of ridge) {
    const base = [p[0], p[1] + off, p[2]];
    const l = Math.hypot(...dir);
    const tip = [base[0] + (dir[0] / l) * len, base[1] + (dir[1] / l) * len, base[2] + (dir[2] / l) * len];
    cone(bone, base, tip, len * 0.32, 0.003, { mat: 'horn', k: 0.012 });
  }

  const names = ORDER;
  const geometry = skinSculpt(B.sc, B.tags, names, { cell: 0.0165, ao: 0.03, sigma: 0.05 });
  _cache = { geometry, names };
  return _cache;
}

// ------------------------------------------------------------------ wing membrane
let _wingTex = null;
function wingTextures() {
  if (_wingTex) return _wingTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // Albedo: a leathery membrane, darker toward the bones and the ragged edge.
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#7a5428');
  grd.addColorStop(0.5, '#9a6a34');
  grd.addColorStop(1, '#5a3a18');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const e = document.createElement('canvas');
  e.width = e.height = S;
  const ge = e.getContext('2d');
  // Emissive = light shining through the thin hide: bright between the veins,
  // fading to dark near the finger bones (u=0/1) and the trailing edge (v=1).
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  const r = (i) => {
    const x = Math.sin(i * 91.7 + 13.1) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const u = x / S;
      const w = y / S;
      const thin = Math.sin(u * Math.PI) ** 0.7 * (0.35 + 0.65 * w) * (1 - Math.max(0, w - 0.9) * 6);
      const k = Math.max(0, thin);
      ge.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(175 * k)},${Math.round(90 * k * k)})`;
      ge.fillRect(x, y, 2, 2);
    }
  }
  // Veins: branching dark lines from the bones into the membrane.
  const vein = (ctx, col, wdt) => {
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const fromLeft = i % 2 === 0;
      let x = fromLeft ? 0 : S;
      let y = r(i) * S;
      ctx.lineWidth = wdt * (1.2 + r(i + 7));
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        x += (fromLeft ? 1 : -1) * (14 + r(i * 13 + k) * 18);
        y += 8 + (r(i * 7 + k) - 0.3) * 26;
        ctx.lineTo(x, y);
        ctx.lineWidth *= 0.8;
      }
      ctx.stroke();
    }
  };
  vein(ge, 'rgba(0,0,0,0.85)', 3);
  vein(g, 'rgba(30,12,4,0.7)', 2.5);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  _wingTex = { map, emissiveMap };
  return _wingTex;
}

/**
 * A membrane panel between two finger bones (each a polyline from the wrist),
 * sagging between them and scalloped along the trailing edge. UV: u across the
 * panel (bone to bone), v from the wrist out to the edge.
 */
function panelGeometry(a0, a1, b0, b1, sag, nu = 8, nv = 10) {
  const pos = [];
  const uv = [];
  const idx = [];
  const A0 = new THREE.Vector3(...a0), A1 = new THREE.Vector3(...a1), B0 = new THREE.Vector3(...b0), B1 = new THREE.Vector3(...b1);
  const n = new THREE.Vector3().subVectors(A1, A0).cross(new THREE.Vector3().subVectors(B1, B0)).normalize();
  for (let j = 0; j <= nv; j++) {
    const t = j / nv;
    const pa = A0.clone().lerp(A1, t);
    const pb = B0.clone().lerp(B1, t);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      // Scallop: the trailing edge is cut back between the bone tips.
      const cut = t * (1 - 0.32 * Math.sin(u * Math.PI));
      const qa = A0.clone().lerp(A1, cut);
      const qb = B0.clone().lerp(B1, cut);
      const p = qa.lerp(qb, u);
      p.addScaledVector(n, -sag * Math.sin(u * Math.PI) * (0.35 + 0.65 * t));
      pos.push(p.x, p.y, p.z);
      uv.push(u, cut);
      void pa;
      void pb;
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tubeBetween(a, b, r0, r1, seg = 8) {
  const A = new THREE.Vector3(...a);
  const Bv = new THREE.Vector3(...b);
  const d = Bv.clone().sub(A);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), seg, 1);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

/** Build Tyranthraxus. Quad-rig bone names, so the quadruped clips drive it. */
export function buildGreatDragon(sp) {
  const R = new RigBuilder();
  for (const name of ORDER) {
    const p = PARENT[name];
    const w = JW[name];
    const o = p ? sub(w, JW[p]) : w;
    R.bone(name, p, o[0], o[1], o[2]);
  }
  const hide = dragonHide();
  R.skin(hide.geometry, sculptMaterial(), hide.names);

  // Rigid kit -------------------------------------------------------------
  const boneM = new THREE.MeshStandardMaterial({ color: 0x8a5a24, metalness: 0.8, roughness: 0.38 });
  boneM.name = 'gold|dragonBone';
  const tooth = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.35, metalness: 0 });
  const claw = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.45, metalness: 0 });
  claw.name = 'bone|dragonClaw';
  tooth.name = 'bone|dragonTooth';
  const eye = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(sp.eyes ?? 0xffc030), emissiveIntensity: 6 });
  eye.name = 'glow|dragonEye';
  const fire = new THREE.MeshStandardMaterial({ color: 0x200400, emissive: new THREE.Color(0xff6a18), emissiveIntensity: 3.2, roughness: 1 });
  fire.name = 'glow|dragonThroat';
  const wt = wingTextures();
  const membrane = new THREE.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.emissiveMap, emissive: new THREE.Color(0xffb870), emissiveIntensity: 0.32, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide });
  membrane.name = 'dragonWing';

  // Eyes, set into the sockets under the brow.
  const H = JW.head;
  const hl = (x, y, z) => [x, y, z]; // head-local offsets
  for (const sx of [1, -1]) {
    const g = new THREE.SphereGeometry(0.022, 10, 8);
    g.scale(1, 0.62, 1.15);
    R.part('head', g, eye, { p: hl(sx * 0.098, 0.03, 0.155) });
  }
  // Teeth: upper row under the snout, lower row along the open jaw.
  for (let k = 0; k < 7; k++) {
    for (const sx of [1, -1]) {
      const z = 0.12 + k * 0.055;
      const up = new THREE.ConeGeometry(0.008 + (k === 1 ? 0.004 : 0), 0.035 + (k === 1 ? 0.02 : 0), 5);
      up.rotateX(Math.PI);
      R.part('head', up, tooth, { p: hl(sx * (0.066 - k * 0.004), -0.085, z) });
      const J0 = sub(JW.jaw, H);
      void J0;
      const lo = new THREE.ConeGeometry(0.007 + (k === 1 ? 0.004 : 0), 0.03 + (k === 1 ? 0.018 : 0), 5);
      const t = k / 7;
      R.part('jaw', lo, tooth, { p: [sx * (0.08 - t * 0.035), -0.02 - t * 0.13 + 0.02, -0.0 + t * 0.34], r: [-0.4, 0, 0] });
    }
  }
  // The fire in its throat, glowing between the open jaws.
  {
    const g = new THREE.SphereGeometry(0.06, 12, 8);
    g.scale(1, 0.55, 2.2);
    R.part('jaw', g, fire, { p: [0, -0.06, 0.1], r: [-0.3, 0, 0] });
  }

  // Wings: arm + fingers (bronze bone) and four membrane panels each.
  for (const [n, sx] of [['wingL', 1], ['wingR', -1]]) {
    const X = (p) => [p[0] * sx, p[1], p[2]];
    const sh = X([0, 0, 0]);
    // Mantled in threat: the arm raised high, the fingers fanned out and down,
    // the membrane spread broadside like a sail behind the shoulders.
    const elbow = X([0.36, 0.5, -0.3]);
    const wrist = X([0.58, 1.08, -0.12]);
    const tips = [X([0.95, 1.55, -0.72]), X([1.02, 1.12, -1.32]), X([0.9, 0.55, -1.6]), X([0.62, 0.02, -1.45])];
    const root = X([0.12, -0.18, -0.85]);
    R.part(n, tubeBetween(sh, elbow, 0.05, 0.04), boneM);
    R.part(n, tubeBetween(elbow, wrist, 0.04, 0.03), boneM);
    R.part(n, new THREE.SphereGeometry(0.045, 8, 6), boneM, { p: elbow });
    R.part(n, new THREE.SphereGeometry(0.04, 8, 6), boneM, { p: wrist });
    // Wrist thumb-claw.
    R.part(n, tubeBetween(wrist, X([0.64, 1.2, 0.0]), 0.02, 0.003), claw);
    for (const tp of tips) R.part(n, tubeBetween(wrist, tp, 0.024, 0.006, 6), boneM);
    // Membranes: wrist→finger panels, then the last finger back to the flank.
    const chain = [[elbow, wrist], ...tips.map((tp) => [wrist, tp])];
    for (let i = 1; i < chain.length - 1; i++) R.part(n, panelGeometry(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1], 0.06), membrane);
    // Propatagium (shoulder→wrist leading web) and the inner panel to the body.
    R.part(n, panelGeometry(sh, X([0.32, 0.62, 0.0]), sh, wrist, 0.0, 4, 4), membrane);
    R.part(n, panelGeometry(wrist, tips[3], elbow, root, 0.08), membrane);
    R.part(n, panelGeometry(elbow, root, sh, root, 0.02, 4, 4), membrane);
  }

  const built = R.build();
  built.root.scale.setScalar(K);
  const S = K;
  return {
    ...built,
    rig: 'quad',
    dragon: true,
    height: 2.4 * S,
    radius: 1.15 * S,
    span: 1.9 * S,
    top: 3.05 * S,
    scale: 0.42 * S,
    hasTail: true,
    eyesColor: sp.eyes,
    eyesBurn: true,
    eyeAt: [0, 0.03, 0.16],
    flameSpots: [
      ['neck1', [0, 0.24, 0.06], 0.32], ['neck2', [0, 0.2, -0.02], 0.3], ['chest', [0, 0.5, 0.1], 0.42], ['chest', [0, 0.52, -0.08], 0.5],
      ['chest', [0, 0.49, -0.26], 0.55], ['chest', [0, 0.45, -0.44], 0.55], ['body', [0, 0.46, 0.12], 0.58], ['body', [0, 0.44, -0.06], 0.55],
      ['body', [0, 0.4, -0.26], 0.5], ['body', [0, 0.34, -0.44], 0.45], ['tail1', [0, 0.24, -0.12], 0.38], ['tail1', [0, 0.2, -0.32], 0.3],
    ],
  };
}

export const DRAGON_K = K;
export { JW as DRAGON_JOINTS };
void mAlongY;
