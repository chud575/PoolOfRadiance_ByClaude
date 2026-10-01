import {
  rngOf, rgba, mix, glow, glowEllipse, lightShaft, texture, masonry, planks, poly, linGrad, lerp, archPath, gothicPath, contactShadow, makeCanvas, fog,
} from './paint.js';
import * as P from './props.js';
import { S, roomScene, persp } from './settings.js';
import { Figure, mat, renderFigure, rotX, rotY, rotZ, ap3, mul3, alignY } from './sculpt.js';
import { M, weapon, buildPerson } from './bodies.js';

/**
 * The service interiors of New Phlan and the haunted chapel of Sokol Keep,
 * each with its own architecture, props and light — and an actor slot, so the
 * clerk, the armourer, the priests, the weaponsmaster and the tavern keeper
 * stand in their own scenes behind their desk, anvil, altar or bar.
 *
 * Hero props are sculpted and lit in 3D (sculpt.js) so they sit on the floor
 * with real shading and contact shadows; architecture is painted.
 * Interiors draw occluders in front of the actor into opts.fg and return
 * {actorSlot:{x, y, h, pose, yaw}, fgUsed:true}.
 */

// ------------------------------------------------------------------ 3D prop helpers

const rig = (o = {}) => ({
  key: { dir: o.key ?? [-0.5, 0.45, 0.75], color: o.keyC ?? '#ffb070', i: o.keyI ?? 1.25 },
  rim: { dir: o.rim ?? [0.8, 0.4, -0.6], color: o.rimC ?? '#8aa8ff', i: o.rimI ?? 0.8 },
  sky: o.sky ?? '#3a3040', ground: o.ground ?? '#1e140c', amb: o.amb ?? 0.42,
  fill: o.fill ?? null,
});

/** Render a 3D prop figure standing at (x, y) (its origin) with a contact shadow. */
function prop3d(g, fig, x, y, ppu, lr, o = {}) {
  const r = renderFigure(fig, { ppu, yaw: o.yaw ?? 0, pitch: o.pitch ?? 0.16, rig: lr, ink: o.ink ?? 0.55, ss: 2, haze: o.haze ?? 0, hazeColor: o.hazeColor });
  if (!r) return null;
  if (o.shadow !== false) contactShadow(g, x + (o.shadowDx ?? 0), y + 2, (o.shadowW ?? 0.3) * ppu, (o.shadowW ?? 0.3) * ppu * 0.16, o.shadowA ?? 0.6);
  g.drawImage(r.canvas, x - r.ox, y - r.oy);
  for (const e of r.emit) glow(g, x - r.ox + e.x, y - r.oy + e.y, e.r, e.color, e.a);
  return r;
}

/** Screen position of a point of a prop drawn with prop3d at (x, y). */
function proj(x, y, ppu, p, yaw = 0, pitch = 0.16) {
  const v = ap3(mul3(rotX(pitch), rotY(yaw)), p);
  return [x + v[0] * ppu, y - v[1] * ppu];
}

const stoneM = (c, o = {}) => mat(c, { pattern: 'stone', scale: o.scale ?? 0.06, rough: 0.85, spec: 0.08, sss: 0.15, ...o });
const waxM = mat('#efe2c4', { pattern: 'skin', scale: 0.01, sss: 0.9, rough: 0.5, spec: 0.25, ink: 0.4 });
const clothM = (c) => mat(c, { pattern: 'cloth', scale: 0.012, rough: 0.8 });

/** A candle with wax drips; returns the wick tip (local). */
function candle3d(f, at, h, r, seed) {
  const R = rngOf(seed);
  f.cone(at, [at[0], at[1] + h, at[2]], r, r * 0.92, waxM, { group: 'wax', blend: 0.004 });
  // pooled wax at the foot and drips down the sides
  f.ell([at[0], at[1] + r * 0.2, at[2]], [r * 1.5, r * 0.35, r * 1.5], waxM, { group: 'wax', blend: 0.006 });
  for (let i = 0; i < 4; i++) {
    const a = R() * Math.PI * 2;
    const dl = h * (0.2 + R() * 0.5);
    const top = at[1] + h - R() * h * 0.1;
    f.cone([at[0] + Math.cos(a) * r * 0.95, top, at[2] + Math.sin(a) * r * 0.95], [at[0] + Math.cos(a) * r * 1.02, top - dl, at[2] + Math.sin(a) * r * 1.02], r * 0.28, r * 0.36, waxM, { group: 'wax', blend: 0.004 });
  }
  f.ell([at[0], at[1] + h, at[2]], [r * 1.02, r * 0.3, r * 1.02], waxM, { group: 'wax', blend: 0.004 });
  f.cone([at[0], at[1] + h, at[2]], [at[0], at[1] + h + r * 0.7, at[2]], r * 0.12, r * 0.08, M.dark, { group: null });
  return [at[0], at[1] + h + r * 0.7, at[2]];
}

/** Stone altar block with a slab top, carved front panel, runner and candles. */
function altar3d({ w = 0.42, d = 0.16, h = 0.36, stone = '#a8a092', runner = null, emblemC = '#e0b850', cracked = false, candles = 5, seed = 3, sword = false } = {}) {
  const f = new Figure();
  const sm = stoneM(stone);
  const dark = stoneM(mix(stone, '#000000', 0.25).map((v) => Math.round(v)).reduce((a, v) => a + v.toString(16).padStart(2, '0'), '#'));
  f.box([0, 0.012, 0], [w + 0.04, 0.012, d + 0.04], dark, { group: null, bevel: 0.006 });
  f.box([0, h / 2 + 0.02, 0], [w, h / 2, d], sm, { group: null, bevel: 0.01 });
  f.box([0, h + 0.035, 0], [w + 0.025, 0.018, d + 0.022], sm, { group: null, bevel: 0.008 });
  // carved front: three sunk panels with pillars
  for (let i = -1; i <= 1; i++) f.box([i * w * 0.62, h * 0.52, d + 0.002], [w * 0.24, h * 0.34, 0.006], dark, { group: null, bevel: 0.004 });
  for (let i = -2; i <= 2; i += 1) if (i % 2 === 0 || Math.abs(i) === 2) f.cone([i * w * 0.48, 0.04, d + 0.01], [i * w * 0.48, h, d + 0.01], 0.012, 0.012, sm, { group: null });
  if (cracked) {
    f.box([w * 0.55, h + 0.03, 0], [w * 0.2, 0.02, d * 0.9], sm, { group: null, R: rotZ(-0.22), bevel: 0.006 });
    f.box([-w * 0.95, 0.03, d * 0.9], [0.05, 0.02, 0.04], sm, { group: null, R: rotZ(0.4), bevel: 0.01 });
    f.box([-w * 0.75, 0.025, d * 1.4], [0.03, 0.018, 0.03], sm, { group: null, R: rotY(0.7), bevel: 0.01 });
  }
  if (runner) {
    const rm = clothM(runner);
    f.box([0, h + 0.056, 0], [w * 0.22, 0.004, d + 0.024], rm, { group: null, bevel: 0.002 });
    f.box([0, h - 0.06, d + 0.026], [w * 0.22, 0.12, 0.004], rm, { group: null, bevel: 0.002 });
    f.box([0, h - 0.19, d + 0.026], [w * 0.22, 0.008, 0.005], mat(emblemC, { metal: true, rough: 0.3, spec: 0.9 }), { group: null, bevel: 0.002 });
    f.ell([0, h - 0.05, d + 0.031], [0.03, 0.03, 0.004], mat(emblemC, { metal: true, rough: 0.3, spec: 0.9 }), { group: null });
  }
  const tips = [];
  const R = rngOf(seed);
  for (let i = 0; i < candles; i++) {
    const x = (i - (candles - 1) / 2) * (w * 1.7 / Math.max(1, candles - 1)) * (candles > 1 ? 1 : 0) + (R() - 0.5) * 0.02;
    if (runner && Math.abs(x) < w * 0.25) continue;
    const ch = 0.04 + R() * 0.09;
    tips.push(candle3d(f, [x, h + 0.054, (R() - 0.5) * d * 0.8], ch, 0.011 + R() * 0.004, seed * 17 + i));
  }
  if (sword) {
    weapon(f, 'longsword', [0, h + 0.25, 0], [0, -1, 0], 1);
  }
  return { f, tips };
}

/** Anvil on an oak stump with a glowing workpiece. */
function anvil3d() {
  const f = new Figure();
  const oak = mat('#4a3420', { pattern: 'wood', scale: 0.03, rough: 0.85 });
  f.cone([0, 0, 0], [0, 0.17, 0], 0.11, 0.1, oak, { group: null });
  f.ell([0, 0.17, 0], [0.1, 0.01, 0.1], mat('#7a5a38', { pattern: 'wood', scale: 0.01 }), { group: null });
  for (const y of [0.04, 0.13]) f.ell([0, y, 0], [0.113, 0.008, 0.113], M.iron, { group: null });
  const ir = mat('#4a4c52', { pattern: 'metal', metal: true, rough: 0.45, spec: 0.7, scale: 0.04 });
  f.box([0, 0.19, 0], [0.09, 0.016, 0.06], ir, { group: null, bevel: 0.008 });
  f.box([0, 0.22, 0], [0.05, 0.022, 0.035], ir, { group: null, bevel: 0.01 });
  f.box([0, 0.262, 0], [0.12, 0.024, 0.052], ir, { group: null, bevel: 0.008 });
  f.box([0, 0.287, 0], [0.118, 0.003, 0.05], mat('#9a9ca4', { metal: true, rough: 0.15, spec: 1 }), { group: null, bevel: 0.002 });
  f.cone([0.12, 0.27, 0], [0.24, 0.282, 0], 0.03, 0.005, ir, { group: null });
  f.box([-0.145, 0.27, 0], [0.028, 0.018, 0.04], ir, { group: null, bevel: 0.006 });
  // glowing blade on the face
  f.box([0.0, 0.296, 0.01], [0.075, 0.005, 0.012], mat('#ff8a30', { emissive: '#ff7a20', rough: 0.4, ink: 0 }), { group: null, bevel: 0.003 });
  f.glow([0.03, 0.3, 0.01], 0.06, '#ff8030', 0.8);
  return f;
}

function barrel3d(seed = 1, { open = false, water = false } = {}) {
  const f = new Figure();
  const R = rngOf(seed);
  const wood = mat(R() < 0.5 ? '#5a3a20' : '#6a4826', { pattern: 'wood', scale: 0.012, rough: 0.8 });
  f.ell([0, 0.17, 0], [0.11, 0.18, 0.11], wood, { group: null });
  f.box([0, 0.16, 0], [0.095, 0.16, 0.095], wood, { group: null, bevel: 0.09, R: rotY(0.4) });
  for (const y of [0.05, 0.12, 0.22, 0.29]) f.ell([0, y, 0], [0.108 + (y > 0.1 && y < 0.25 ? 0.006 : 0), 0.007, 0.108 + (y > 0.1 && y < 0.25 ? 0.006 : 0)], M.iron, { group: null });
  if (open) f.ell([0, 0.32, 0], [0.09, 0.004, 0.09], water ? mat('#10161c', { rough: 0.05, spec: 1, metal: true }) : wood, { group: null });
  return f;
}

/** The great bronze scales of Tyr. */
function scales3d() {
  const f = new Figure();
  const br = mat('#b08a40', { pattern: 'metal', metal: true, rough: 0.28, spec: 1, scale: 0.05 });
  f.cone([0, 0, 0], [0, 0.55, 0], 0.012, 0.01, br, { group: null });
  f.sphere([0, 0.58, 0], 0.025, br, { group: null });
  f.box([0, 0.52, 0], [0.26, 0.008, 0.008], br, { group: null, bevel: 0.004, R: rotZ(0.04) });
  for (const d of [-1, 1]) {
    const x = d * 0.25;
    const y = 0.52 + d * -0.01;
    for (const a of [-1, 0, 1]) f.cone([x, y, 0], [x + a * 0.06, y - 0.2, a === 0 ? 0.05 : -0.02], 0.002, 0.002, br, { group: null });
    f.ell([x, y - 0.21, 0], [0.075, 0.018, 0.075], br, { group: null });
    f.sphere([x, y, 0], 0.012, br, { group: null });
  }
  f.cone([0, 0, 0], [0, 0.03, 0], 0.07, 0.05, br, { group: null });
  return f;
}

function brazier3d() {
  const f = new Figure();
  const ir = mat('#3a3a3e', { pattern: 'metal', metal: true, rough: 0.5, spec: 0.5, scale: 0.04 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    f.cone([Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08], [Math.cos(a) * 0.035, 0.28, Math.sin(a) * 0.035], 0.008, 0.008, ir, { group: null });
  }
  f.ell([0, 0.32, 0], [0.12, 0.05, 0.12], ir, { group: null });
  f.ell([0, 0.355, 0], [0.105, 0.015, 0.105], mat('#ff6a10', { emissive: '#ff5a10', rough: 0.9, ink: 0 }), { group: null });
  for (let i = 0; i < 6; i++) { const a = i; f.sphere([Math.cos(a) * 0.06, 0.365, Math.sin(a) * 0.06], 0.02, mat('#2a1a10', { emissive: '#801a00', rough: 1 }), { group: null }); }
  f.glow([0, 0.37, 0], 0.12, '#ff7a20', 0.9);
  return f;
}

/** Straw practice dummy with a dented bucket helm. */
function dummy3d(seed = 1) {
  const R = rngOf(seed);
  const f = new Figure();
  const post = mat('#4a3018', { pattern: 'wood', scale: 0.02 });
  const straw = mat('#b89a58', { pattern: 'fur', scale: 0.01, rough: 0.9 });
  const sack = mat('#9a8460', { pattern: 'cloth', scale: 0.008 });
  f.cone([0, 0, 0], [0, 0.9, 0], 0.02, 0.018, post, { group: null });
  f.box([0, 0.03, 0], [0.12, 0.02, 0.03], post, { group: null, bevel: 0.01 });
  f.box([0, 0.03, 0], [0.03, 0.02, 0.12], post, { group: null, bevel: 0.01 });
  f.ell([0, 0.58, 0], [0.12, 0.2, 0.09], straw, { group: 'b' });
  f.cone([-0.2, 0.7, 0], [0.2, 0.7, 0], 0.016, 0.016, post, { group: null });
  for (const d of [-1, 1]) f.ell([d * 0.15, 0.7, 0], [0.07, 0.035, 0.035], straw, { group: null });
  f.sphere([0, 0.86, 0], 0.07, sack, { group: null });
  f.cone([0, 0.88, 0], [0, 0.97, 0], 0.075, 0.065, mat('#7a7c80', { pattern: 'metal', metal: true, rough: 0.5, spec: 0.6, scale: 0.03 }), { group: null });
  for (const y of [0.5, 0.64]) f.ell([0, y, 0], [0.122, 0.01, 0.092], M.rope, { group: null });
  if (R() < 0.6) f.box([0.04, 0.56, 0.09], [0.04, 0.05, 0.006], mat('#5a1a14', { pattern: 'cloth', scale: 0.008 }), { group: null, R: rotZ(0.2), bevel: 0.004 });
  return f;
}

/** Heavy clerk's desk with a ledger, inkwell, scrolls and a candle; returns candle tips. */
function desk3d() {
  const f = new Figure();
  const wd = mat('#4a2c16', { pattern: 'wood', scale: 0.018, rough: 0.55, spec: 0.3 });
  const wl = mat('#6a4224', { pattern: 'wood', scale: 0.018, rough: 0.5, spec: 0.35 });
  f.box([0, 0.415, 0], [0.42, 0.016, 0.16], wl, { group: null, bevel: 0.01 });
  f.box([0, 0.215, 0.13], [0.4, 0.185, 0.02], wd, { group: null, bevel: 0.01 });
  for (const d of [-1, 1]) f.box([d * 0.39, 0.2, 0], [0.025, 0.2, 0.15], wd, { group: null, bevel: 0.01 });
  for (let i = -1; i <= 1; i++) {
    f.box([i * 0.26, 0.22, 0.152], [0.1, 0.13, 0.004], wl, { group: null, bevel: 0.003 });
    f.box([i * 0.26, 0.22, 0.157], [0.075, 0.105, 0.003], wd, { group: null, bevel: 0.002 });
  }
  f.box([0, 0.03, 0.14], [0.41, 0.03, 0.03], wd, { group: null, bevel: 0.01 });
  // open ledger
  const page = mat('#e8dcbc', { pattern: 'cloth', scale: 0.002, rough: 0.95, spec: 0.05 });
  f.box([-0.06, 0.436, 0.04], [0.065, 0.004, 0.085], page, { group: null, R: rotZ(0.06), bevel: 0.002 });
  f.box([0.065, 0.436, 0.04], [0.065, 0.004, 0.085], page, { group: null, R: rotZ(-0.06), bevel: 0.002 });
  f.box([0, 0.43, 0.04], [0.135, 0.004, 0.09], mat('#5a1a10', { pattern: 'leather', scale: 0.01 }), { group: null, bevel: 0.003 });
  // inkwell & quill
  f.cone([0.2, 0.43, 0.06], [0.2, 0.46, 0.06], 0.022, 0.016, mat('#14141a', { rough: 0.2, spec: 0.9 }), { group: null });
  f.ell([0.215, 0.5, 0.05], [0.006, 0.05, 0.012], mat('#e8e0d0', { pattern: 'fur', scale: 0.004 }), { group: null, R: rotZ(-0.4) });
  // scrolls and a stack of ledgers
  for (let i = 0; i < 3; i++) f.cone([-0.36 + i * 0.01, 0.445 + i * 0.022, -0.06 + i * 0.03], [-0.18 + i * 0.012, 0.445 + i * 0.022, -0.04 + i * 0.03], 0.012, 0.012, page, { group: null });
  for (let i = 0; i < 4; i++) f.box([0.3, 0.44 + i * 0.022, -0.06], [0.07, 0.01, 0.05], mat(['#3a1a0e', '#1d3574', '#4a3a1a', '#2c5634'][i], { pattern: 'leather', scale: 0.01 }), { group: null, R: rotY(i * 0.15 - 0.2), bevel: 0.004 });
  // wax seal and brass candlestick
  f.ell([0.13, 0.434, 0.11], [0.014, 0.005, 0.014], mat('#a8201a', { rough: 0.4, spec: 0.5 }), { group: null });
  f.cone([-0.25, 0.43, 0.06], [-0.25, 0.45, 0.06], 0.03, 0.012, M.bronze, { group: null });
  const tip = candle3d(f, [-0.25, 0.45, 0.06], 0.07, 0.012, 11);
  return { f, tips: [tip] };
}

/** Tall oval mirror in a gilt frame (Sune). */
function mirror3d() {
  const f = new Figure();
  const gilt = mat('#d8a848', { metal: true, rough: 0.25, spec: 1 });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    f.sphere([Math.cos(a) * 0.13, 0.56 + Math.sin(a) * 0.24, 0], 0.022, gilt, { group: 'frame', blend: 0.02 });
  }
  f.ell([0, 0.56, -0.004], [0.13, 0.24, 0.006], mat('#c8d0e0', { metal: true, rough: 0.05, spec: 1.4 }), { group: null });
  f.sphere([0, 0.83, 0], 0.035, gilt, { group: null });
  for (const d of [-1, 1]) f.ell([d * 0.04, 0.86, 0], [0.04, 0.02, 0.015], gilt, { group: null, R: rotZ(d * 0.5) });
  f.cone([0, 0, 0], [0, 0.3, 0], 0.03, 0.02, gilt, { group: null });
  f.ell([0, 0.01, 0], [0.09, 0.012, 0.07], gilt, { group: null });
  return f;
}

/** A vase of red roses. */
function roses3d(seed = 1) {
  const R = rngOf(seed);
  const f = new Figure();
  const cer = mat('#e8dcc8', { rough: 0.25, spec: 0.8, sss: 0.4 });
  f.ell([0, 0.08, 0], [0.06, 0.08, 0.06], cer, { group: 'v' });
  f.cone([0, 0.12, 0], [0, 0.17, 0], 0.03, 0.04, cer, { group: 'v' });
  f.ell([0, 0.08, 0], [0.062, 0.012, 0.062], mat('#c8a040', { metal: true, rough: 0.3, spec: 0.9 }), { group: null });
  const leaf = mat('#2a4a20', { rough: 0.6, spec: 0.3 });
  const petal = mat('#a8141c', { rough: 0.45, spec: 0.35, sss: 0.6 });
  for (let i = 0; i < 9; i++) {
    const a = R() * Math.PI * 2;
    const rr = 0.02 + R() * 0.07;
    const top = [Math.cos(a) * rr, 0.24 + R() * 0.12, Math.sin(a) * rr];
    f.cone([0, 0.15, 0], top, 0.003, 0.003, leaf, { group: null });
    f.ell([top[0] + 0.015, top[1] - 0.04, top[2]], [0.018, 0.008, 0.01], leaf, { group: null, R: rotZ(0.6) });
    for (let k = 0; k < 4; k++) f.sphere([top[0] + Math.cos(k * 1.6) * 0.008, top[1] + 0.006 + k * 0.002, top[2] + Math.sin(k * 1.6) * 0.008], 0.014 - k * 0.002, petal, { group: 'rose' + i, blend: 0.006 });
  }
  return f;
}

/** Wall trophy of crossed swords behind a painted round shield (Tempus). */
function trophy3d(shieldC, seed = 1) {
  const R = rngOf(seed);
  const f = new Figure();
  for (const d of [-1, 1]) weapon(f, R() < 0.5 ? 'longsword' : 'axe', [d * 0.12, -0.12, -0.02], [-d * 0.6, 1, 0], d);
  const wood = mat(shieldC, { pattern: 'wood', scale: 0.02, rough: 0.6 });
  f.ell([0, 0.1, 0.02], [0.13, 0.13, 0.016], wood, { group: null });
  f.ell([0, 0.1, 0.016], [0.137, 0.137, 0.012], M.iron, { group: null });
  f.sphere([0, 0.1, 0.034], 0.032, M.iron, { group: null });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; f.sphere([Math.cos(a) * 0.115, 0.1 + Math.sin(a) * 0.115, 0.03], 0.008, M.iron, { group: null }); }
  return f;
}

/** Granite block with a greatsword driven into it (Tempus). */
function swordStone() {
  const f = new Figure();
  const gr = stoneM('#6a6460', { scale: 0.05 });
  f.box([0, 0.15, 0], [0.24, 0.15, 0.14], gr, { group: 'st', bevel: 0.05 });
  f.box([0.05, 0.3, -0.02], [0.17, 0.05, 0.11], gr, { group: 'st', bevel: 0.04, R: rotZ(0.08) });
  f.box([-0.17, 0.08, 0.13], [0.06, 0.05, 0.04], gr, { group: 'st', bevel: 0.03 });
  weapon(f, 'longsword', [0.03, 0.66, 0], [0, -1, 0], 1);
  return f;
}

// ------------------------------------------------------------------ painted glass & light

/**
 * Leaded stained glass: irregular panes in a motif, lead cames, iron saddle
 * bars, light glowing through, optional broken panes.
 * motif(u, v) → palette index (u: 0..1 across, v: 0..1 down)
 */
function leadedGlass(g, x, y, w, h, palette, { path, motif, seed = 1, broken = 0, glowA = 0.5, cell = 16 } = {}) {
  const R = rngOf(seed);
  g.save();
  path();
  g.clip();
  g.fillStyle = '#05070c';
  g.fillRect(x, y, w, h);
  const cols = Math.max(3, Math.round(w / cell));
  const rows = Math.max(4, Math.round(h / (cell * 1.1)));
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    pts.push([]);
    for (let i = 0; i <= cols; i++) {
      const jx = i === 0 || i === cols ? 0 : (R() - 0.5) * 0.6;
      const jy = j === 0 || j === rows ? 0 : (R() - 0.5) * 0.6;
      pts[j].push([x + ((i + jx) / cols) * w, y + ((j + jy) / rows) * h]);
    }
  }
  const panes = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = [pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]];
    // split some quads diagonally for a hand-cut look
    const tri = R() < 0.35;
    const u = (i + 0.5) / cols;
    const v = (j + 0.5) / rows;
    const idx = motif(u, v);
    if (tri) {
      panes.push({ q: [q[0], q[1], q[2]], idx, u, v });
      panes.push({ q: [q[0], q[2], q[3]], idx: R() < 0.2 ? (idx + 1) % palette.length : idx, u, v });
    } else panes.push({ q, idx, u, v });
  }
  for (const p of panes) {
    const missing = broken && R() < broken && p.v < 0.9;
    const c = palette[p.idx % palette.length];
    // light falls off toward the edges of the window; each pane has its own density
    const cx = (p.u - 0.5) * 2;
    const cy = (p.v - 0.45) * 2;
    const k = (0.65 + R() * 0.55) * (1.15 - 0.35 * Math.min(1, Math.hypot(cx * 0.8, cy * 0.6)));
    poly(g, p.q);
    if (missing) {
      g.fillStyle = '#0a1020';
      g.fill();
      continue;
    }
    const gx = p.q.reduce((a, q) => a + q[0], 0) / p.q.length;
    const gy = p.q.reduce((a, q) => a + q[1], 0) / p.q.length;
    const gr = g.createRadialGradient(gx - cell * 0.2, gy - cell * 0.2, 1, gx, gy, cell * 0.9);
    gr.addColorStop(0, rgba(c, 1, k * 1.35));
    gr.addColorStop(1, rgba(c, 1, k * 0.75));
    g.fillStyle = gr;
    g.fill();
  }
  // painted grisaille detail
  texture(g, x, y, w, h, { alpha: 0.35, mode: 'multiply', cells: 24, octaves: 3, seed: seed + 5 });
  // lead cames
  g.strokeStyle = '#120c08';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1.6, cell * 0.13);
  for (const p of panes) { poly(g, p.q); g.stroke(); }
  g.strokeStyle = 'rgba(120,110,100,0.25)';
  g.lineWidth = 0.8;
  for (const p of panes) { poly(g, p.q); g.stroke(); }
  // iron saddle bars
  g.strokeStyle = '#0a0806';
  g.lineWidth = Math.max(2.5, cell * 0.22);
  for (let j = 1; j < 5; j++) {
    const yy = y + (h * j) / 5;
    g.beginPath();
    g.moveTo(x, yy);
    g.lineTo(x + w, yy);
    g.stroke();
  }
  g.restore();
  // halation around the glass
  glow(g, x + w / 2, y + h * 0.45, Math.max(w, h) * 0.75, palette[0], glowA * 0.5, 'screen');
}

/** Coloured god rays from a window falling across the floor, with dappled pools. */
function godRays(g, from, to, palette, { alpha = 0.22, seed = 1, spread = 1 } = {}) {
  const R = rngOf(seed);
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const sx = from.x + (t - 0.5) * from.w;
    const ex = to.x + (t - 0.5) * to.w * spread;
    const c = palette[(i + (R() < 0.3 ? 1 : 0)) % palette.length];
    lightShaft(g, sx, from.y, from.w / 9 * 1.6, ex, to.y, to.w / 9 * 1.8, c, alpha * (0.6 + R() * 0.6));
  }
  g.restore();
  // dappled pools of coloured light on the floor
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(5px)';
  for (let i = 0; i < 40; i++) {
    const u = R() - 0.5;
    const v = R() - 0.5;
    const c = palette[Math.floor(R() * palette.length)];
    g.fillStyle = rgba(c, alpha * 0.55 * (1 - Math.hypot(u, v) * 1.2));
    g.beginPath();
    g.ellipse(to.x + u * to.w * spread, to.y + v * to.h, to.w * 0.07, to.h * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  glowEllipse(g, to.x, to.y, to.w * 0.6 * spread, to.h * 0.7, palette[1] ?? palette[0], alpha * 0.6);
}

/** A rose window: concentric rings of petal lights in stone tracery. */
function roseWindow(g, cx, cy, r, palette, seed = 1) {
  const R = rngOf(seed);
  // stone surround
  g.fillStyle = linGrad(g, cx - r * 1.2, cy - r * 1.2, cx + r * 1.2, cy + r * 1.2, [[0, '#c8b8a0'], [1, '#4a3e32']]);
  g.beginPath();
  g.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
  g.fill();
  texture(g, cx - r * 1.2, cy - r * 1.2, r * 2.4, r * 2.4, { alpha: 0.35, cells: 12, seed });
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#06070c';
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  const ring = (r0, r1, n, col, off = 0) => {
    for (let i = 0; i < n; i++) {
      const a0 = ((i + off) / n) * Math.PI * 2;
      const a1 = ((i + 1 + off) / n) * Math.PI * 2;
      g.beginPath();
      g.arc(cx, cy, r1, a0, a1);
      g.arc(cx, cy, r0, a1, a0, true);
      g.closePath();
      const c = palette[(col + i) % palette.length];
      const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
      gr.addColorStop(0, rgba(c, 1, 1.3 + R() * 0.2));
      gr.addColorStop(1, rgba(c, 1, 0.75 + R() * 0.2));
      g.fillStyle = gr;
      g.fill();
    }
  };
  ring(r * 0.62, r, 24, 0);
  ring(r * 0.28, r * 0.62, 12, 1, 0.5);
  ring(0, r * 0.28, 6, 2);
  texture(g, cx - r, cy - r, r * 2, r * 2, { alpha: 0.3, mode: 'multiply', cells: 20, seed: seed + 2 });
  // tracery: petals and roundels in stone
  g.strokeStyle = '#2a2018';
  g.lineWidth = r * 0.05;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.18, r * 0.09, a, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx + Math.cos(a + 0.13) * r * 0.81, cy + Math.sin(a + 0.13) * r * 0.81, r * 0.12, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = r * 0.025;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 0.28, cy + Math.sin(a) * r * 0.28);
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stroke();
  }
  for (const rr of [0.28, 0.62]) { g.lineWidth = r * 0.045; g.beginPath(); g.arc(cx, cy, r * rr, 0, Math.PI * 2); g.stroke(); }
  g.restore();
  g.strokeStyle = '#1a140e';
  g.lineWidth = r * 0.06;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  glow(g, cx, cy, r * 2.2, palette[0], 0.35, 'screen');
}

/** Hanging garland of roses along a curve. */
function garland(g, x0, y0, x1, y1, sag, seed = 1) {
  const R = rngOf(seed);
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = lerp(x0, x1, t);
    const y = lerp(y0, y1, t) + Math.sin(t * Math.PI) * sag;
    g.fillStyle = rgba('#1e3a18', 0.95, 0.8 + R() * 0.5);
    g.beginPath();
    g.ellipse(x + (R() - 0.5) * 8, y + (R() - 0.5) * 6, 6, 3, R() * 3, 0, Math.PI * 2);
    g.fill();
    if (i % 2 === 0) {
      const rx = x + (R() - 0.5) * 6;
      const ry = y + (R() - 0.5) * 5;
      const gr = g.createRadialGradient(rx - 1.5, ry - 1.5, 0.5, rx, ry, 5.5);
      gr.addColorStop(0, '#ff6a7a');
      gr.addColorStop(0.5, '#b0141e');
      gr.addColorStop(1, '#4a0408');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(rx, ry, 5 + R() * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

const toHex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Chain from the ceiling to a point. */
function chain(g, x, y0, y1, w = 2) {
  g.strokeStyle = '#1a1612';
  g.lineWidth = w;
  g.setLineDash([w * 2, w]);
  g.beginPath();
  g.moveTo(x, y0);
  g.lineTo(x, y1);
  g.stroke();
  g.setLineDash([]);
}

/** Iron ring chandelier with candles (2D silhouette, lights for the overlay). */
function chandelier(g, x, y, r, lights) {
  chain(g, x, 0, y, 2.5);
  g.strokeStyle = '#141008';
  g.lineWidth = 4;
  g.beginPath();
  g.ellipse(x, y, r, r * 0.22, 0, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const cx = x + Math.cos(a) * r;
    const cy = y + Math.sin(a) * r * 0.22;
    P.candle(g, cx, cy, 26);
    lights.push({ x: cx, y: cy - 12, s: 5, kind: 'candle', color: '#ffc060' });
  }
  glow(g, x, y - 10, r * 3.2, '#ffb050', 0.28);
}

/** Broken pew (painted) seen from the aisle. */
function pew(g, x, y, w, s, { broken = 0, side = 1, seed = 1 } = {}) {
  const R = rngOf(seed);
  const h = 34 * s;
  g.save();
  contactShadow(g, x + w / 2, y + 2, w * 0.6, 8 * s, 0.6);
  const x1 = broken ? x + w * (1 - broken * 0.5) : x + w;
  g.fillStyle = linGrad(g, 0, y - h, 0, y, [[0, '#4a3018'], [0.15, '#2e1c0e'], [1, '#120a04']]);
  if (broken) poly(g, [[x, y], [x, y - h], [x1, y - h], [x1 + 8 * s, y - h * 0.55], [x1 - 6 * s, y - h * 0.3], [x1 + 4 * s, y]]);
  else poly(g, [[x, y], [x, y - h], [x + w, y - h], [x + w, y]]);
  g.fill();
  planks(g, x, y - h * 1.6, x1 - x, h * 0.55, { base: '#3a2414', width: h * 0.18, vertical: false, seed });
  g.fillStyle = 'rgba(255,220,180,0.12)';
  g.fillRect(x, y - h, x1 - x, 2 * s);
  // end board
  const ex = side > 0 ? x : x1 - 10 * s;
  g.fillStyle = linGrad(g, ex, 0, ex + 10 * s, 0, [[0, '#5a3a1e'], [1, '#1a0e06']]);
  g.beginPath();
  g.moveTo(ex, y);
  g.lineTo(ex, y - h * 1.75);
  g.quadraticCurveTo(ex + 5 * s, y - h * 1.95, ex + 10 * s, y - h * 1.75);
  g.lineTo(ex + 10 * s, y);
  g.fill();
  texture(g, x, y - h * 2, w, h * 2, { alpha: 0.3, cells: 24, seed: seed + R.int(1, 9) });
  g.restore();
}

// ================================================================== City Hall

S.cityhall = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#6e5c4a', wallKind: 'stone', floor: 'marble', floorColor: '#5e4c3a', by0: 0.04, by1: 0.66, bx0: 0.12, bx1: 0.7, ceiling: '#120c08' });
  const lights = [];
  // tall west windows in late light; shafts slant across the chamber toward the desk
  for (const [x, i] of [[0.17, 0], [0.3, 1]]) {
    P.windowLit(g, W * x, H * 0.1, W * 0.075, H * 0.38, { arch: true, color: '#ffd49a', lit: 1, frame: '#1a120a' });
    lightShaft(g, W * (x + 0.037), H * 0.32, W * 0.06, W * (x + 0.3), H * 0.99, W * 0.17, '#ffd8a0', 0.2 + i * 0.04);
  }
  glowEllipse(g, W * 0.6, H * 0.92, W * 0.22, H * 0.07, '#ffd090', 0.18);
  // the arms of New Phlan: a great tapestry behind the clerk
  const tx = W * 0.6;
  P.banner(g, tx, H * 0.07, W * 0.14, H * 0.44, '#5a1a14', { emblem: 'scales', trim: '#d8b25a', seed: 4 });
  P.banner(g, W * 0.5, H * 0.12, W * 0.04, H * 0.26, '#1d3574', { emblem: 'crown', tatter: 0.15, seed: 5 });
  // pigeonholes of rolled deeds on the back wall right
  g.fillStyle = '#20140a';
  g.fillRect(W * 0.4, H * 0.42, W * 0.09, H * 0.2);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const cx = W * 0.407 + i * W * 0.021;
    const cy = H * 0.437 + j * H * 0.047;
    g.fillStyle = '#0a0604';
    g.fillRect(cx, cy, W * 0.018, H * 0.04);
    if (R() < 0.8) { g.fillStyle = rgba('#e8dcbc', 1, 0.7 + R() * 0.3); g.beginPath(); g.arc(cx + W * 0.009, cy + H * 0.022, W * 0.006, 0, Math.PI * 2); g.fill(); }
  }
  // right wall: ledgers to the ceiling
  g.save();
  g.transform(1, 0.22, 0, 1, 0, -W * 0.16);
  P.bookshelf(g, W * 0.76, H * 0.2, W * 0.18, H * 0.6, { seed: 6, shelves: 6 });
  g.restore();
  // left wall: proclamations
  g.save();
  g.transform(1, -0.25, 0, 1, 0, 0);
  P.noticeBoard(g, W * 0.02, H * 0.42, W * 0.08, H * 0.22, 5);
  g.restore();
  chandelier(g, W * 0.36, H * 0.2, W * 0.06, lights);
  // dais under the desk
  g.fillStyle = linGrad(g, 0, H * 0.8, 0, H * 0.86, [[0, '#7a6450'], [0.2, '#4a3a2a'], [1, '#1a120a']]);
  poly(g, [[W * 0.24, H * 0.8], [W * 0.8, H * 0.8], [W * 0.86, H * 0.88], [W * 0.18, H * 0.88]]);
  g.fill();
  // foreground: the desk (3D) in front of the clerk, and a column framing the left
  const ppu = H * 0.66;
  const d = desk3d();
  const lr = rig({ key: [-0.75, 0.45, 0.5], keyC: '#ffd090', keyI: 1.2, rimC: '#ffb060', amb: 0.45, sky: '#4a3a30', ground: '#24180e' });
  const dx = W * 0.7;
  const dy = H * 1.02;
  prop3d(fg, d.f, dx, dy, ppu, lr, { yaw: -0.12, shadowW: 0.5 });
  for (const t of d.tips) { const [x, y] = proj(dx, dy, ppu, t, -0.12); lights.push({ x, y, s: 5, kind: 'candle', color: '#ffc060' }); }
  P.column(fg, W * 0.035, -10, H * 1.02, 74, { base: '#7a6a58', seed: 9 });
  return { ...rm, lights, motes: { color: '#ffe0b0', count: 55, rise: 0.03 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.7, y: H * 0.85, h: H * 0.62, pose: 'clerk', yaw: -0.35 } };
};

// ================================================================== Roland's forge

S.smithy = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#4a4038', wallKind: 'stone', floor: 'dirt', floorColor: '#3a3028', bx0: 0.3, bx1: 0.94, by0: 0.1, by1: 0.66 });
  const lights = [];
  // the forge, in the back-left corner: brick body, glowing mouth, sooty hood
  const fx = W * 0.4;
  const fy = rm.by1;
  g.save();
  g.beginPath();
  g.rect(fx - 110, fy - 150, 220, 150);
  g.clip();
  masonry(g, fx - 110, fy - 150, 220, 150, { base: '#6a3e2a', course: 12, blockW: 26, seed: 111 });
  g.restore();
  archPath(g, fx - 56, fy - 96, 112, 84);
  g.fillStyle = '#1a0602';
  g.fill();
  g.save();
  archPath(g, fx - 56, fy - 96, 112, 84);
  g.clip();
  const coal = g.createRadialGradient(fx, fy - 20, 4, fx, fy - 30, 80);
  coal.addColorStop(0, '#fff0a0');
  coal.addColorStop(0.25, '#ff9a20');
  coal.addColorStop(0.6, '#b02a04');
  coal.addColorStop(1, '#200400');
  g.fillStyle = coal;
  g.fillRect(fx - 60, fy - 100, 120, 100);
  for (let i = 0; i < 40; i++) { g.fillStyle = rgba('#1a0602', 0.6); g.beginPath(); g.arc(fx + (R() - 0.5) * 100, fy - 14 - R() * 20, 3 + R() * 5, 0, Math.PI * 2); g.fill(); }
  g.restore();
  lights.push({ x: fx, y: fy - 22, s: 36, kind: 'flame', color: '#ff6a18' });
  glow(g, fx, fy - 30, 90, '#ff7a20', 0.9);
  glow(g, fx, fy - 20, 600, '#ff6a20', 0.42);
  glowEllipse(g, fx + 160, H * 0.9, 560, 120, '#ff6a20', 0.32);
  g.save();
  poly(g, [[fx - 124, fy - 148], [fx + 124, fy - 148], [fx + 52, 0], [fx - 52, 0]]);
  g.clip();
  masonry(g, fx - 130, 0, 260, fy - 146, { base: '#3e3630', course: 16, blockW: 30, seed: 112 });
  g.fillStyle = linGrad(g, 0, 0, 0, fy - 148, [[0, 'rgba(0,0,0,0.88)'], [0.7, 'rgba(0,0,0,0.45)'], [1, 'rgba(255,110,40,0.3)']]);
  g.fillRect(fx - 130, 0, 260, fy - 146);
  g.restore();
  g.fillStyle = '#2a221c';
  g.fillRect(fx - 128, fy - 156, 256, 10);
  // bellows beside the forge
  g.fillStyle = linGrad(g, fx - 200, 0, fx - 120, 0, [[0, '#4a2e18'], [1, '#1a0e06']]);
  poly(g, [[fx - 205, fy - 40], [fx - 125, fy - 62], [fx - 125, fy - 30], [fx - 205, fy - 10]]);
  g.fill();
  // back wall: racks of finished blades, shields and hanging tools
  P.weaponRack(g, W * 0.6, H * 0.2, W * 0.2, H * 0.34, 7);
  for (const [x, c] of [[0.85, '#5a1a14'], [0.9, '#1d3574']]) {
    const cx = W * x;
    const cy = H * 0.3;
    g.fillStyle = linGrad(g, cx - 26, cy - 26, cx + 26, cy + 26, [[0, rgba(c, 1, 1.4)], [1, rgba(c, 1, 0.5)]]);
    g.beginPath(); g.arc(cx, cy, 26, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8a8478'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#9a9488'; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 5; i++) {
    const x = W * (0.52 + i * 0.022);
    g.strokeStyle = '#141210';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, H * 0.12); g.lineTo(x + (i % 2) * 3, H * 0.2 + (i % 3) * 8); g.stroke();
    g.fillStyle = '#2a2826';
    g.fillRect(x - 6, H * 0.2 + (i % 3) * 8, 12, 6);
  }
  P.armourStand(g, W * 0.9, H * 0.94, 170, { plate: true });
  // foreground: the anvil and a quench tub, sculpted
  const lr = rig({ key: [-0.85, 0.35, 0.4], keyC: '#ff9a40', keyI: 1.45, rimC: '#ffb070', rim: [0.7, 0.5, -0.5], amb: 0.32, sky: '#3a2a24', ground: '#1e100a' });
  const ppu = H * 0.95;
  const ax = W * 0.5;
  const ay = H * 1.03;
  prop3d(fg, anvil3d(), ax, ay, ppu, lr, { yaw: 0.25, shadowW: 0.32 });
  const [wx, wy] = proj(ax, ay, ppu, [0.03, 0.3, 0.01], 0.25);
  lights.push({ x: wx, y: wy, s: 14, kind: 'glow', color: '#ff8030' });
  prop3d(fg, barrel3d(5, { open: true, water: true }), W * 0.76, H * 1.02, ppu * 0.95, lr, { yaw: 0.3 });
  return { ...rm, lights, motes: { color: '#ffa050', count: 80, rise: 0.45 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.6, y: H * 0.97, h: H * 0.8, pose: 'smith', yaw: -0.3, apron: true } };
};

// ================================================================== temples

/** Tyr: a domed rotunda of pale stone, an oculus beam on the altar, the great scales. */
function templeTyr(g, W, H, R, o, d) {
  const fg = o.fg ?? g;
  const lights = [];
  const floorY = H * 0.68;
  // dome and apse
  g.fillStyle = '#0c0a0e';
  g.fillRect(0, 0, W, H);
  const cx = W / 2;
  // coffered dome: concentric bands with sunk coffers, lit from the oculus
  for (let ring = 0; ring < 5; ring++) {
    const ry0 = H * (0.08 + ring * 0.06);
    const rx = W * (0.18 + ring * 0.08);
    const n = 9 + ring * 2;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + (i / n) * Math.PI;
      const a1 = Math.PI + ((i + 0.82) / n) * Math.PI;
      g.beginPath();
      g.ellipse(cx, ry0 * 0.2, rx, ry0 + H * 0.06, 0, a0, a1);
      g.ellipse(cx, ry0 * 0.2, rx - W * 0.06, ry0, 0, a1, a0, true);
      g.closePath();
      const k = 0.55 - ring * 0.08;
      g.fillStyle = rgba('#b8ae9c', 1, k + R() * 0.06);
      g.fill();
    }
  }
  // mosaic band of Tyr's blue and gold under the dome
  for (let i = 0; i < 2; i++) {
    g.strokeStyle = i ? '#d8b25a' : '#1d3574';
    g.lineWidth = i ? 3 : 12;
    g.beginPath();
    g.ellipse(cx, H * 0.06, W * 0.56, H * 0.36, 0, 0, Math.PI);
    g.stroke();
  }
  // apse wall: a half cylinder, darker toward its edges
  g.save();
  g.beginPath();
  g.ellipse(cx, H * 0.06, W * 0.56, H * 0.36, 0, 0, Math.PI);
  g.lineTo(W * -0.06, floorY);
  g.lineTo(W * 1.06, floorY);
  g.closePath();
  g.clip();
  masonry(g, 0, H * 0.06, W, floorY - H * 0.06, { base: '#b0a694', course: 22, blockW: 40, seed: 211 });
  g.fillStyle = linGrad(g, 0, 0, W, 0, [[0, 'rgba(0,0,0,0.8)'], [0.3, 'rgba(0,0,0,0.25)'], [0.5, 'rgba(0,0,0,0.05)'], [0.7, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0.8)']]);
  g.fillRect(0, 0, W, H);
  // niches with statues of the just
  for (const nx of [0.3, 0.7]) {
    archPath(g, W * nx - 24, H * 0.3, 48, 110);
    g.fillStyle = '#1a1612';
    g.fill();
    g.fillStyle = linGrad(g, W * nx - 14, 0, W * nx + 14, 0, [[0, '#d8d0c0'], [1, '#5a5448']]);
    g.beginPath();
    g.ellipse(W * nx, H * 0.38, 10, 12, 0, 0, Math.PI * 2);
    g.fill();
    poly(g, [[W * nx - 16, H * 0.3 + 110], [W * nx - 12, H * 0.41], [W * nx + 12, H * 0.41], [W * nx + 16, H * 0.3 + 110]]);
    g.fill();
  }
  g.restore();
  // floor: marble with an inlaid circle of the scales
  g.fillStyle = linGrad(g, 0, floorY, 0, H, [[0, '#6a6458'], [1, '#2a2620']]);
  g.fillRect(0, floorY, W, H - floorY);
  texture(g, 0, floorY, W, H - floorY, { alpha: 0.35, cells: 10, seed: 213 });
  for (let i = 1; i <= 4; i++) {
    g.strokeStyle = i % 2 ? 'rgba(29,53,116,0.7)' : 'rgba(216,178,90,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(cx, H * 0.86, W * 0.12 * i, H * 0.05 * i, 0, 0, Math.PI * 2);
    g.stroke();
  }
  // colonnade around the apse, far columns first
  const cols = [-1.25, -0.9, -0.55, 0.55, 0.9, 1.25];
  cols.sort((a, b) => Math.cos(b) - Math.cos(a));
  for (const a of cols) {
    const x = cx + Math.sin(a) * W * 0.4;
    const near = 1 - Math.cos(a);
    const by = floorY + near * H * 0.16;
    P.column(g, x, -10, by, 30 + near * 50, { base: '#c8bea8', seed: Math.round(a * 10) + 20 });
    contactShadow(g, x, by, 40 + near * 40, 8, 0.5);
  }
  // the oculus beam
  lightShaft(g, cx, -10, W * 0.12, cx, H * 0.95, W * 0.3, '#fff4d8', 0.42);
  lightShaft(g, cx, -10, W * 0.06, cx, H * 0.95, W * 0.16, '#ffffff', 0.25);
  glowEllipse(g, cx, H * 0.9, W * 0.2, H * 0.06, '#fff0c8', 0.35);
  glow(g, cx, 0, W * 0.2, '#fff8e8', 0.5);
  // the great scales hang above the altar
  const lr = rig({ key: [0.0, 0.95, 0.3], keyC: '#fff0d0', keyI: 1.4, rimC: '#a8c0ff', amb: 0.45, sky: '#3a4060', ground: '#2a2418' });
  chain(g, cx, 0, H * 0.18, 2.5);
  prop3d(g, scales3d(), cx, H * 0.53, H * 0.6, lr, { shadow: false, pitch: 0.05 });
  // altar & candelabra in front of the priest
  const al = altar3d({ stone: '#dcd4c4', runner: d.banner ?? '#1d3574', emblemC: '#e0b850', candles: 6, seed: 31 });
  const ppu = H * 0.78;
  prop3d(fg, al.f, cx, H * 1.04, ppu, lr, { shadowW: 0.5 });
  for (const t of al.tips) { const [x, y] = proj(cx, H * 1.04, ppu, t); lights.push({ x, y, s: 5, kind: 'candle', color: '#ffd070' }); }
  return { lights, motes: { color: '#fff4d8', count: 90, rise: 0.02 }, floorY, fgUsed: true, actorSlot: { x: cx, y: H * 0.86, h: H * 0.6, pose: 'priest', yaw: 0, vestments: '#1d3574' } };
}

/** Sune: warm rose marble, a great rose window, silk, roses and her mirror. */
function templeSune(g, W, H, R, o, d) {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#c8a49a', wallKind: 'plaster', floor: 'marble', floorColor: '#8a6660', by0: 0.04, by1: 0.66, bx0: 0.1, bx1: 0.64, beams: false, ceiling: '#2a1418' });
  const lights = [];
  const pal = ['#c01e34', '#ff8aa0', '#ffd890', '#7a1430', '#f8f0e0'];
  // crimson silk drapes either side of the window
  for (const [x0, x1] of [[0.12, 0.2], [0.52, 0.6]]) {
    for (let i = 0; i < 8; i++) {
      const x = W * lerp(x0, x1, i / 8);
      g.fillStyle = linGrad(g, x, 0, x + W * 0.012, 0, [[0, '#8a1424'], [0.5, '#d83a4a'], [1, '#4a0610']]);
      g.fillRect(x, H * 0.04, W * 0.011, rm.by1 - H * 0.04);
    }
  }
  roseWindow(g, W * 0.36, H * 0.27, H * 0.19, pal, 41);
  godRays(g, { x: W * 0.36, y: H * 0.3, w: H * 0.3 }, { x: W * 0.42, y: H * 0.9, w: W * 0.32, h: H * 0.12 }, pal, { alpha: 0.2, seed: 42 });
  garland(g, W * 0.12, H * 0.08, W * 0.6, H * 0.08, H * 0.06, 43);
  garland(g, W * 0.64, H * 0.12, W * 0.98, H * -0.02, H * 0.05, 44);
  // the right wall: Sune's mirror and roses on plinths
  const lr = rig({ key: [-0.4, 0.6, 0.7], keyC: '#ffc8a8', keyI: 1.25, rimC: '#ff9aa8', amb: 0.5, sky: '#6a3a40', ground: '#2a1414' });
  prop3d(g, mirror3d(), W * 0.82, H * 0.9, H * 0.72, lr, { yaw: -0.5, shadowW: 0.16 });
  glow(g, W * 0.8, H * 0.5, 120, '#ffe0e8', 0.25, 'screen');
  for (const [x, y, s] of [[0.08, 0.98, 0.7], [0.68, 0.8, 0.45]]) {
    g.fillStyle = linGrad(g, W * x - 30 * s, 0, W * x + 30 * s, 0, [[0, '#e8d8d0'], [1, '#6a5450']]);
    g.fillRect(W * x - 26 * s, H * y - 120 * s, 52 * s, 120 * s);
    prop3d(g, roses3d(Math.round(x * 100)), W * x, H * y - 120 * s, H * s, lr, { shadow: false });
  }
  // petals on the floor
  for (let i = 0; i < 70; i++) {
    const x = W * (0.15 + R() * 0.7);
    const y = H * (0.8 + R() * 0.2);
    g.fillStyle = rgba('#c0182a', 0.85, 0.7 + R() * 0.6);
    g.beginPath();
    g.ellipse(x, y, 3 + R() * 2, 1.6, R() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const al = altar3d({ stone: '#e2c4bc', runner: '#a01e2c', emblemC: '#f0c870', candles: 6, seed: 51 });
  const ppu = H * 0.78;
  prop3d(fg, al.f, W * 0.4, H * 1.04, ppu, lr, { shadowW: 0.5 });
  for (const t of al.tips) { const [x, y] = proj(W * 0.4, H * 1.04, ppu, t); lights.push({ x, y, s: 5, kind: 'candle', color: '#ffc880' }); }
  return { ...rm, lights, motes: { color: '#ffc0c8', count: 70, rise: 0.04 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.4, y: H * 0.86, h: H * 0.6, pose: 'priest', yaw: 0.15, vestments: '#a01e2c' } };
}

/** Tempus: a smoky war hall of timber and stone, trophies of arms, braziers, a sword in the stone. */
function templeTempus(g, W, H, R, o, d) {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#4e443a', wallKind: 'stone', floor: 'flags', floorColor: '#3a342c', by0: 0.12, by1: 0.66, bx0: 0.22, bx1: 0.8, ceiling: '#0e0806' });
  const lights = [];
  // the war banner of the Foehammer, flanked by trophies of arms
  P.banner(g, W * 0.45, H * 0.13, W * 0.1, H * 0.4, d.banner ?? '#5a1a14', { emblem: 'sword', trim: '#c8c8d0', tatter: 0.18, seed: 61 });
  const lr = rig({ key: [-0.6, 0.35, 0.7], keyC: '#ff9a50', keyI: 1.4, rimC: '#ff7030', rim: [0.8, 0.3, -0.5], amb: 0.3, sky: '#3a2820', ground: '#140a06' });
  const trophies = [[0.32, 0.3, '#5a1a14'], [0.68, 0.3, '#1a3a5a'], [0.29, 0.5, '#6a5a2a'], [0.71, 0.5, '#3a1a3a'], [0.38, 0.17, '#2a4a2a'], [0.62, 0.17, '#6a2a1a']];
  trophies.forEach(([x, y, c], i) => prop3d(g, trophy3d(c, i + 3), W * x, H * y + H * 0.08, H * 0.42, lr, { shadow: false, pitch: 0 }));
  // war banners hanging from the beams
  for (const [x, c] of [[0.08, '#5a1a14'], [0.9, '#5a1a14'], [0.18, '#2a2a2a']]) P.banner(g, W * x, H * 0.02, W * 0.05, H * 0.36, c, { emblem: 'sword', trim: '#a8a8b0', tatter: 0.3, seed: Math.round(x * 100) });
  // braziers
  for (const x of [0.2, 0.8]) {
    const by = H * 0.98;
    prop3d(g, brazier3d(), W * x, by, H * 0.75, lr, { shadowW: 0.16 });
    const [fx, fy] = proj(W * x, by, H * 0.75, [0, 0.37, 0]);
    lights.push({ x: fx, y: fy, s: 26, kind: 'flame', color: '#ff7a20' });
    glow(g, fx, fy, 420, '#ff7020', 0.32);
  }
  fog(g, W, H * 0.15, H * 0.3, '#2a1a12', 0.4, 62);
  const ppu = H * 0.78;
  prop3d(fg, swordStone(), W * 0.5, H * 1.04, ppu, lr, { shadowW: 0.4 });
  return { ...rm, lights, motes: { color: '#ffa060', count: 70, rise: 0.35 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.5, y: H * 0.86, h: H * 0.64, pose: 'trainer', yaw: -0.1 } };
}

S.temple = (g, W, H, R, o) => {
  const d = o.deity ?? { name: 'Tyr', banner: '#1d3574', symbol: 'scales' };
  if (d.name === 'Sune') return templeSune(g, W, H, R, o, d);
  if (d.name === 'Tempus') return templeTempus(g, W, H, R, o, d);
  return templeTyr(g, W, H, R, o, d);
};

// ================================================================== Sokol Keep chapel (ruined, haunted)

S.chapel = (g, W, H, R, o) => {
  const rm = roomScene(g, W, H, R, { wall: '#4e4e56', wallKind: 'stone', floor: 'flags', floorColor: '#34343a', by0: 0.02, by1: 0.62, bx0: 0.31, bx1: 0.69, beams: false, ceiling: '#06070c' });
  const lights = [];
  const fg = o.fg ?? g;
  // the east lancet: Saint Ferran's vigil in blue, crimson and gold
  const wx = W * 0.435;
  const wy = H * 0.07;
  const ww = W * 0.13;
  const wh = H * 0.46;
  const pal = ['#1a3a8a', '#b01a24', '#e8b830', '#f2ecd8', '#2a6a4a', '#5a2a8a'];
  const motif = (u, v) => {
    const cu = (u - 0.5) * 2;
    if (Math.abs(cu) > 0.78 || v > 0.93) return 2; // golden border
    if (Math.hypot(cu, (v - 0.3) * 2.2) < 0.4) return v < 0.22 ? 3 : 2; // halo
    if (Math.abs(cu) < 0.14 && v > 0.32 && v < 0.88) return 3; // the sword
    if (Math.abs(v - 0.44) < 0.04 && Math.abs(cu) < 0.4) return 2; // crossguard
    if (Math.abs(cu) < 0.4 && v > 0.45 && v < 0.85) return 1; // crimson surcoat
    return (Math.floor(u * 7) + Math.floor(v * 9)) % 5 === 0 ? 5 : 0;
  };
  const path = () => gothicPath(g, wx, wy, ww, wh);
  leadedGlass(g, wx, wy, ww, wh, pal, { path, motif, seed: 71, broken: 0.08, cell: 14, glowA: 0.6 });
  g.lineWidth = 9;
  g.strokeStyle = '#2a2a30';
  gothicPath(g, wx, wy, ww, wh);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(wx + ww / 2, wy + ww * 0.55);
  g.lineTo(wx + ww / 2, wy + wh);
  g.stroke();
  // side lancets in perspective, some smashed
  const side = [['#1a3a8a', '#e8b830', '#f2ecd8'], ['#2a6a4a', '#b01a24', '#e8b830']];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const t = persp(i / 3 + 0.1, 3);
      const x = s < 0 ? lerp(W * 0.05, W * 0.3, t) : lerp(W * 0.95, W * 0.7, t);
      const w = lerp(W * 0.065, W * 0.022, t);
      const top = lerp(H * 0.1, H * 0.12, t);
      const h = lerp(H * 0.5, H * 0.3, t);
      const p2 = () => gothicPath(g, x - w / 2, top, w, h);
      leadedGlass(g, x - w / 2, top, w, h, side[(i + (s > 0 ? 1 : 0)) % 2], { path: p2, motif: (u, v) => (Math.abs(u - 0.5) > 0.36 ? 1 : (Math.floor(v * 6) + (u > 0.5 ? 1 : 0)) % 3 === 0 ? 2 : 0), seed: 80 + i + s * 10, broken: 0.18, cell: Math.max(6, w / 4), glowA: 0.4 });
      g.lineWidth = Math.max(2, w * 0.1);
      g.strokeStyle = '#2a2a30';
      p2();
      g.stroke();
    }
  }
  // moonlight through the left lancets: coloured shafts and dappled pools across the floor
  godRays(g, { x: W * 0.12, y: H * 0.3, w: W * 0.08 }, { x: W * 0.46, y: H * 0.86, w: W * 0.3, h: H * 0.12 }, ['#4a6ad8', '#d83040', '#f0c040', '#c8d8ff'], { alpha: 0.2, seed: 73 });
  godRays(g, { x: W * 0.5, y: H * 0.3, w: W * 0.08 }, { x: W * 0.5, y: H * 0.74, w: W * 0.22, h: H * 0.08 }, pal.slice(0, 4), { alpha: 0.18, seed: 74 });
  // ivy and cobwebs where the roof has failed
  for (let i = 0; i < 160; i++) {
    const x = W * (R() < 0.5 ? R() * 0.12 : 0.88 + R() * 0.12);
    const y = H * R() * 0.6;
    g.fillStyle = rgba('#1e3220', 0.9, 0.6 + R() * 0.6);
    g.beginPath();
    g.ellipse(x, y, 6, 3.5, R() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // the broken altar, candles still burning for the dead
  const lr = rig({ key: [-0.75, 0.55, 0.35], keyC: '#a8c0ff', keyI: 1.1, rimC: '#ffc070', rim: [0.3, 0.5, 0.8], rimI: 0.7, amb: 0.32, sky: '#26304e', ground: '#101014', fill: { dir: [0, 0.5, 0.9], color: '#ffb060', i: 0.35 } });
  const al = altar3d({ stone: '#8e8a82', runner: '#4a1418', emblemC: '#a08040', cracked: true, candles: 7, seed: 77 });
  const ppu = H * 0.5;
  const ax = W * 0.5;
  const ay = rm.by1 + H * 0.12;
  prop3d(g, al.f, ax, ay, ppu, lr, { shadowW: 0.5, shadowA: 0.7 });
  for (const t of al.tips) { const [x, y] = proj(ax, ay, ppu, t); lights.push({ x, y, s: 4.5, kind: 'candle', color: '#ffc060' }); }
  glowEllipse(g, ax, ay - ppu * 0.42, ppu * 0.5, ppu * 0.12, '#ffb050', 0.3);
  glowEllipse(g, ax, ay, ppu * 0.7, ppu * 0.12, '#ffa040', 0.22);
  // rubble from the vault
  P.rubble(g, W * 0.24, H * 0.82, 60, { seed: 41, base: '#5a5a62' });
  P.rubble(g, W * 0.78, H * 0.76, 44, { seed: 42, base: '#5a5a62' });
  // broken pews in the foreground (in front of the kneeling ghost)
  pew(fg, W * -0.02, H * 1.0, W * 0.34, 1.8, { broken: 0.4, side: 1, seed: 3 });
  pew(fg, W * 0.7, H * 1.02, W * 0.34, 1.9, { side: -1, seed: 4 });
  pew(g, W * 0.06, H * 0.84, W * 0.26, 1.2, { side: 1, seed: 5 });
  pew(g, W * 0.68, H * 0.86, W * 0.26, 1.25, { broken: 0.6, side: -1, seed: 6 });
  return { ...rm, lights, motes: { color: '#aef4ff', count: 70, rise: 0.06 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.41, y: H * 0.93, h: H * 0.56, pose: 'vigil', yaw: 0.75 } };
};

// ================================================================== Hall of Training

S.training = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#8a7a62', wallKind: 'stone', floor: 'sand', floorColor: '#9a8460', bx0: 0.24, bx1: 0.88, by0: 0.08, by1: 0.64 });
  const lights = [];
  // an arcade open to the sunlit yard
  for (let i = 0; i < 3; i++) {
    const x = W * (0.29 + i * 0.2);
    const w = W * 0.14;
    const top = H * 0.16;
    const bot = rm.by1;
    g.save();
    archPath(g, x, top, w, bot - top);
    g.clip();
    g.fillStyle = linGrad(g, 0, top, 0, bot, [[0, '#9ac0e8'], [0.55, '#e8eef0'], [0.56, '#a8a074'], [1, '#c8b080']]);
    g.fillRect(x, top, w, bot - top);
    // far yard wall and a tree
    g.fillStyle = '#b8a888';
    g.fillRect(x, top + (bot - top) * 0.45, w, (bot - top) * 0.12);
    if (i === 1) { g.fillStyle = '#4a6a3a'; g.beginPath(); g.arc(x + w * 0.6, top + (bot - top) * 0.38, w * 0.3, 0, Math.PI * 2); g.fill(); g.fillStyle = '#3a2a1a'; g.fillRect(x + w * 0.57, top + (bot - top) * 0.45, w * 0.06, (bot - top) * 0.12); }
    g.restore();
    g.strokeStyle = '#4a3e30';
    g.lineWidth = 6;
    archPath(g, x, top, w, bot - top);
    g.stroke();
    lightShaft(g, x + w / 2, H * 0.4, w * 0.9, x + w / 2 - W * 0.12, H * 0.98, w * 1.6, '#fff4d8', 0.32);
  }
  // archery butt in the yard light, weapon racks on the left wall
  g.save();
  g.transform(1, -0.25, 0, 1, 0, 0);
  P.weaponRack(g, W * 0.03, H * 0.3, W * 0.15, H * 0.3, 31);
  g.restore();
  const lr = rig({ key: [-0.55, 0.7, 0.45], keyC: '#fff0d0', keyI: 1.25, rimC: '#c8d8ff', amb: 0.7, sky: '#8aa0c0', ground: '#6a5a40' });
  prop3d(g, dummy3d(1), W * 0.66, H * 0.74, H * 0.4, lr, { yaw: 0.2, shadowW: 0.14 });
  prop3d(g, dummy3d(2), W * 0.8, H * 0.95, H * 0.62, lr, { yaw: -0.5, shadowW: 0.16 });
  prop3d(fg, barrel3d(7, { open: true }), W * 0.12, H * 1.02, H * 0.85, lr, { yaw: 0.2 });
  // practice swords stood in the barrel
  for (let i = 0; i < 3; i++) {
    g.save();
    fg.save();
    fg.translate(W * 0.12 + (i - 1) * 16, H * 0.8);
    fg.rotate((i - 1) * 0.18);
    fg.fillStyle = linGrad(fg, -4, 0, 4, 0, [[0, '#8a6a40'], [1, '#3a2a14']]);
    fg.fillRect(-4, -150, 8, 150);
    fg.fillStyle = '#2a1a0a';
    fg.fillRect(-16, -40, 32, 7);
    fg.restore();
    g.restore();
  }
  return { ...rm, lights, motes: { color: '#fff0c8', count: 80, rise: 0.02 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.42, y: H * 0.97, h: H * 0.72, pose: 'trainer', yaw: 0.2 } };
};

// ================================================================== taverns

S.tavern = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#6a4e34', wallKind: 'plaster', wainscot: '#3a2414', floor: 'boards', floorColor: '#3e2a18', bx0: 0.06, bx1: 0.56, by0: 0.12, by1: 0.64 });
  const lights = [];
  // hearth on the back wall
  const hx = W * 0.25;
  const hy = rm.by1;
  g.save();
  g.beginPath();
  g.rect(hx - 100, hy - 140, 200, 140);
  g.clip();
  masonry(g, hx - 100, hy - 140, 200, 140, { base: '#6a6258', course: 14, blockW: 30, seed: 101 });
  g.restore();
  archPath(g, hx - 58, hy - 92, 116, 92);
  g.fillStyle = '#120804';
  g.fill();
  lights.push({ x: hx, y: hy - 16, s: 36, kind: 'flame', color: '#ff7a20' });
  glow(g, hx, hy - 30, 560, '#ff7a20', 0.36);
  glowEllipse(g, hx, hy + 70, 520, 120, '#ff8a30', 0.3);
  g.fillStyle = '#2a1a0e';
  g.fillRect(hx - 120, hy - 150, 240, 14);
  // a stag's antlers above the hearth
  g.strokeStyle = '#d8c8a0';
  g.lineWidth = 4;
  for (const d of [-1, 1]) { g.beginPath(); g.moveTo(hx, hy - 180); g.quadraticCurveTo(hx + d * 40, hy - 230, hx + d * 70, hy - 210); g.moveTo(hx + d * 30, hy - 205); g.lineTo(hx + d * 30, hy - 235); g.stroke(); }
  // casks and bottles along the right wall behind the bar
  g.save();
  g.transform(1, 0.16, 0, 1, 0, -W * 0.1);
  P.bottleShelf(g, W * 0.62, H * 0.16, W * 0.3, H * 0.3, { seed: 3, shelves: 3 });
  g.restore();
  for (let i = 0; i < 3; i++) {
    const cx = W * (0.68 + i * 0.1);
    const cy = H * (0.6 + i * 0.03);
    const r = 34 + i * 6;
    g.fillStyle = linGrad(g, cx - r, cy - r, cx + r, cy + r, [[0, '#7a5230'], [1, '#2a1608']]);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1410'; g.lineWidth = 4;
    for (const rr of [0.6, 0.95]) { g.beginPath(); g.arc(cx, cy, r * rr, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#3a2a1a'; g.fillRect(cx - 4, cy + r * 0.3, 8, r * 0.4);
  }
  // lanterns from the beams
  for (const lx of [0.18, 0.45]) {
    chain(g, W * lx, 0, H * 0.15, 2);
    g.fillStyle = '#2a1c10';
    g.fillRect(W * lx - 10, H * 0.15, 20, 26);
    lights.push({ x: W * lx, y: H * 0.15 + 18, s: 10, kind: 'candle', color: '#ffb050' });
    glow(g, W * lx, H * 0.19, 260, '#ffa040', 0.22);
  }
  // patrons at the hearth, dim and hazy
  const lrBack = rig({ key: [-0.8, 0.3, 0.3], keyC: '#ff9a40', keyI: 1.3, rimC: '#ff8a30', amb: 0.25, sky: '#3a2a20', ground: '#140a04' });
  for (const [x, y, h, seed, cloth, yaw] of [[0.37, 0.8, 0.42, 3, '#3a4a2a', -0.6], [0.12, 0.84, 0.46, 5, '#5a3a2a', 0.7]]) {
    const b = buildPerson({ seed, skin: '#c58c62', cloth, hair: '#3a2416', hairStyle: 'short', beard: seed === 3 ? 'full' : 'none', pose: 'stand', body: 'leather' });
    const r = renderFigure(b.fig, { ppu: H * h / b.fig.top, yaw, rig: lrBack, haze: 0.28, hazeColor: '#2a1a10', ink: 0.7 });
    contactShadow(g, W * x, H * y, H * h * 0.18, H * h * 0.03, 0.5);
    g.drawImage(r.canvas, W * x - r.ox, H * y - r.oy);
  }
  P.table(g, W * 0.24, H * 0.95, 100, { seed: 5 });
  // the bar (foreground): a long oak counter with tankards
  const top = H * 0.7;
  fg.fillStyle = linGrad(fg, 0, top, 0, H, [[0, '#7a5030'], [0.04, '#4a2c16'], [0.1, '#2a180a'], [1, '#100804']]);
  poly(fg, [[W * 0.5, top + 6], [W * 1.02, top - 10], [W * 1.02, H], [W * 0.5, H]]);
  fg.fill();
  planks(fg, W * 0.5, top + 20, W * 0.52, H - top, { base: '#3a2414', width: 40, vertical: true, seed: 9 });
  fg.fillStyle = linGrad(fg, 0, top - 14, 0, top + 8, [[0, '#a07048'], [1, '#4a2c14']]);
  poly(fg, [[W * 0.48, top + 4], [W * 1.02, top - 14], [W * 1.02, top - 2], [W * 0.48, top + 16]]);
  fg.fill();
  fg.fillStyle = 'rgba(255,220,170,0.35)';
  poly(fg, [[W * 0.48, top + 4], [W * 1.02, top - 14], [W * 1.02, top - 12], [W * 0.48, top + 6]]);
  fg.fill();
  const lrBar = rig({ key: [-0.8, 0.4, 0.45], keyC: '#ffa050', keyI: 1.3, rimC: '#ffb060', amb: 0.35, sky: '#3a2a20', ground: '#1a0e06' });
  for (const [x, s] of [[0.55, 1], [0.6, 0.9], [0.9, 1.05]]) {
    const f = new Figure();
    f.cone([0, 0, 0], [0, 0.1, 0], 0.045, 0.04, M.darkWood, { group: null });
    for (const y of [0.02, 0.08]) f.ell([0, y, 0], [0.048, 0.006, 0.048], M.iron, { group: null });
    f.ell([0, 0.1, 0], [0.04, 0.012, 0.04], mat('#f0e4c8', { rough: 0.9 }), { group: null });
    f.cone([0.045, 0.03, 0], [0.07, 0.065, 0], 0.008, 0.008, M.darkWood, { group: null });
    prop3d(fg, f, W * x, top + 4 - (x - 0.5) * 30, H * 0.7 * s, lrBar, { shadowW: 0.05 });
  }
  return { ...rm, lights, motes: { color: '#ffc880', count: 35, rise: 0.15 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.73, y: H * 0.84, h: H * 0.6, pose: 'barkeep', yaw: -0.35 } };
};

// ================================================================== shops with a counter

const oldShop = S.shop;
S.shop = (g, W, H, R, o) => {
  const info = oldShop(g, W, H, R, o);
  const fg = o.fg ?? g;
  // re-lay the counter in front of the keeper
  fg.fillStyle = linGrad(fg, 0, H * 0.74, 0, H, [[0, '#7a5030'], [0.08, '#3a2412'], [1, '#140a04']]);
  fg.fillRect(W * 0.1, H * 0.76, W * 0.8, H * 0.3);
  planks(fg, W * 0.1, H * 0.79, W * 0.8, H * 0.24, { base: '#3a2414', width: 46, vertical: true, seed: 12 });
  fg.fillStyle = 'rgba(255,220,160,0.32)';
  fg.fillRect(W * 0.1, H * 0.76, W * 0.8, 4);
  P.crate(fg, W * 0.92, H * 1.0, 100, 3);
  return { ...info, fgUsed: true, actorSlot: { x: W * 0.46, y: H * 0.84, h: H * 0.56, pose: 'barkeep', yaw: 0.2 } };
};

const oldCurio = S.curio;
S.curio = (g, W, H, R, o) => {
  const info = oldCurio(g, W, H, R, o);
  return { ...info, fgUsed: false, actorSlot: null };
};

void toHex; void alignY;
