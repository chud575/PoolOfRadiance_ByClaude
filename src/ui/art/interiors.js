import {
  rngOf, rgba, mix, glow, glowEllipse, lightShaft, texture, masonry, planks, poly, linGrad, lerp, archPath, gothicPath, contactShadow, makeCanvas, fog, quadPt, softwareGL, weather,
} from './paint.js';
import * as P from './props.js';
import { S, roomScene, persp } from './settings.js';
import { Figure, mat, renderFigure, rotX, rotY, rotZ, ap3, mul3, alignY } from './sculpt.js';
import { M, weapon } from './bodies.js';
import { buildNpc } from './people.js';
import { stainedGlass, drawGlass, glassPool } from './glass.js';

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
  const r = renderFigure(fig, { ppu, yaw: o.yaw ?? 0, pitch: o.pitch ?? 0.16, rig: lr, ink: o.ink ?? 0.55, ss: o.ss ?? (softwareGL() ? 1.4 : 2), haze: o.haze ?? 0, hazeColor: o.hazeColor });
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

const I3z = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
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
  const tip = [at[0], at[1] + h + r * 0.7, at[2]];
  tip.candle = { at, h, r, seed };
  return tip;
}

/**
 * Paint lit wax over the sculpted candles: ivory wax glowing warm and translucent under the flame,
 * a molten pool at the rim, drips down the sides, a dark wick, and the candle's light falling in a
 * warm pool on whatever it stands on.
 */
function waxCandles(g, tips, x, y, ppu, yaw = 0, o = {}) {
  for (const t of tips) {
    const c = t.candle;
    if (!c) continue;
    const R = rngOf(c.seed * 13 + 5);
    const [bx, by] = proj(x, y, ppu, c.at, yaw);
    const [tx, ty] = proj(x, y, ppu, [c.at[0], c.at[1] + c.h, c.at[2]], yaw);
    const w = Math.max(2.5, c.r * ppu * 2.1);
    const hh = by - ty;
    if (hh < 3) continue;
    paintWax(g, bx, by, tx, ty, w, R, o.pool);
  }
}

/** One lit wax candle in 2D from its foot (bx, by) to its rim (tx, ty), w px wide. */
function paintWax(g, bx, by, tx, ty, w, R, pool) {
  const hh = by - ty;
  const o = { pool };
  // the light it throws on the surface beneath
  glowEllipse(g, bx, by + 1, w * 7, w * 1.7, o.pool ?? '#ffb860', 0.4, 'screen');
  glowEllipse(g, bx, by + 1, w * 2.6, w * 0.7, '#fff0c8', 0.3, 'screen');
  g.save();
  // body: warm ivory, rounded by the light from its own flame and the room
  const bg = g.createLinearGradient(bx - w / 2, 0, bx + w / 2, 0);
  bg.addColorStop(0, '#d8c49c'); bg.addColorStop(0.3, '#fff2d6'); bg.addColorStop(0.65, '#ead6ae'); bg.addColorStop(1, '#8a7452');
  g.fillStyle = bg;
  g.beginPath();
  // tapered: a church candle narrows a little toward its burning end
  g.moveTo(bx - w * 0.55, by); g.lineTo(tx - w * 0.42, ty + w * 0.15);
  g.quadraticCurveTo(tx, ty - w * 0.16, tx + w * 0.42, ty + w * 0.15);
  g.lineTo(bx + w * 0.55, by); g.closePath(); g.fill();
  // the flame lights the wax from inside near the top: warm, translucent
  const tg = g.createLinearGradient(0, ty, 0, ty + Math.min(hh, w * 3.5));
  tg.addColorStop(0, 'rgba(255,190,90,0.75)'); tg.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = tg;
  g.fillRect(tx - w / 2, ty - w * 0.2, w, Math.min(hh, w * 3.5) + w * 0.2);
  // drips running down from the rim, catching light on their left
  for (let k = 0; k < 3; k++) {
    const dx = (R() - 0.5) * w * 0.9;
    const dl = hh * (0.15 + R() * 0.55);
    g.fillStyle = 'rgba(255,244,220,0.9)';
    g.beginPath();
    g.moveTo(tx + dx - w * 0.09, ty + w * 0.1);
    g.lineTo(tx + dx - w * 0.07, ty + dl);
    g.arc(tx + dx, ty + dl, w * 0.08, Math.PI, 0, true);
    g.lineTo(tx + dx + w * 0.09, ty + w * 0.1);
    g.closePath(); g.fill();
  }
  // the molten pool at the rim
  g.fillStyle = 'rgba(255,214,140,0.95)';
  g.beginPath(); g.ellipse(tx, ty + w * 0.08, w * 0.42, w * 0.13, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,250,230,0.9)';
  g.beginPath(); g.ellipse(tx - w * 0.12, ty + w * 0.04, w * 0.14, w * 0.04, 0, 0, Math.PI * 2); g.fill();
  // wick
  g.strokeStyle = '#1a120c'; g.lineWidth = Math.max(1, w * 0.12); g.lineCap = 'round';
  g.beginPath(); g.moveTo(tx, ty + w * 0.05); g.lineTo(tx + w * 0.05, ty - w * 0.35); g.stroke();
  // the pooled wax at its foot
  g.fillStyle = 'rgba(240,226,196,0.85)';
  g.beginPath(); g.ellipse(bx, by, w * 0.8, w * 0.22, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  // warm glow round the top of the candle
  glow(g, tx, ty - w * 0.6, w * 4, '#ffb050', 0.22, 'screen');
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
  // a squat elm stump, roots splayed into the floor, its top sawn flat (no hoops: it is no barrel)
  f.cone([0, 0, 0], [0, 0.17, 0], 0.115, 0.095, oak, { group: 'stump', k: 0.03, disp: { amp: 0.006, freq: 11, twist: 2.5 } });
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.4; f.cone([Math.cos(a) * 0.08, 0.05, Math.sin(a) * 0.08], [Math.cos(a) * 0.15, 0.004, Math.sin(a) * 0.15], 0.035, 0.012, oak, { group: 'stump', k: 0.03 }); }
  f.ell([0, 0.17, 0], [0.094, 0.008, 0.094], mat('#8a6a44', { pattern: 'wood', scale: 0.006 }), { group: null });
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
  // coopered staves: each a bowed plank of its own tone, bulging at the belly, with a chamfered
  // head and iron hoops riveted round (no single faceted box: that read as a chevron pattern)
  const base = R() < 0.5 ? '#5a3a20' : '#6a4826';
  const n = 16;
  const rB = 0.088; const rM = 0.108; const hgt = 0.32;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const tone = mat(shadeHex(base, 0.82 + R() * 0.32), { pattern: 'wood', scale: 0.01, rough: 0.82, spec: 0.06 });
    const ca = Math.cos(a); const sa = Math.sin(a);
    const Rr = rotY(-a);
    const p0 = [ca * rB, 0.005, sa * rB]; const p1 = [ca * rM, hgt / 2, sa * rM]; const p2 = [ca * rB, hgt, sa * rB];
    for (const [q0, q1] of [[p0, p1], [p1, p2]]) {
      const c = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, (q0[2] + q1[2]) / 2];
      const d = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
      const L = Math.hypot(...d) / 2;
      f.box(c, [0.02, L + 0.004, 0.009], tone, { group: null, bevel: 0.004, R: mul3(alignY(d, [-sa, 0, ca]), I3z) });
    }
    void Rr;
  }
  f.ell([0, hgt / 2, 0], [rM - 0.006, hgt / 2 - 0.004, rM - 0.006], mat('#1a0e06', { rough: 1 }), { group: null });
  for (const y of [0.035, 0.1, 0.22, 0.285]) {
    const bul = rB + (rM - rB) * (1 - Math.pow((y - hgt / 2) / (hgt / 2), 2));
    f.ell([0, y, 0], [bul + 0.006, 0.008, bul + 0.006], M.iron, { group: null });
  }
  const headM = open && water ? mat('#0c1216', { rough: 0.04, spec: 1.2, metal: true }) : mat(shadeHex(base, 0.7), { pattern: 'wood', scale: 0.01 });
  f.ell([0, hgt - 0.008, 0], [rB - 0.004, 0.004, rB - 0.004], headM, { group: null });
  return f;
}

/** A wooden armour stand: crossbar shoulders, a breastplate with fauld and pauldrons, mail skirt, a helm. */
function armourStand3d(seed = 1, { plate = true } = {}) {
  const f = new Figure();
  const R = rngOf(seed);
  const wood = M.darkWood;
  const steel = mat('#a8acb4', { pattern: 'metal', metal: true, rough: 0.28, spec: 1, scale: 0.05 });
  const mail = mat('#7a7c84', { pattern: 'mail', metal: true, scale: 0.05, rough: 0.45, spec: 0.7 });
  // feet and post
  for (const a of [0, Math.PI / 2]) f.box([0, 0.018, 0], [0.13, 0.016, 0.022], wood, { group: null, bevel: 0.008, R: rotY(a + 0.3) });
  f.cone([0, 0.02, 0], [0, 0.86, 0], 0.016, 0.014, wood, { group: null });
  f.cone([-0.15, 0.7, 0], [0.15, 0.7, 0], 0.014, 0.014, wood, { group: null });
  // mail skirt and hauberk under the plate
  f.cone([0, 0.62, 0], [0, 0.4, 0.004], 0.1, 0.12, mail, { group: 'mail', k: 0.02, disp: { amp: 0.004, freq: 16, twist: 1 } });
  if (plate) {
    // breastplate: a ridged, waisted shell with a rolled neck edge, then fauld lames
    f.ell([0, 0.62, 0.012], [0.112, 0.105, 0.078], steel, { group: 'plate', k: 0.03 });
    f.ell([0, 0.55, 0.016], [0.098, 0.06, 0.07], steel, { group: 'plate', k: 0.03 });
    f.cone([0, 0.5, 0.075], [0, 0.69, 0.088], 0.006, 0.006, steel, { group: 'plate', k: 0.01 }); // medial ridge
    f.ell([0, 0.715, 0.02], [0.07, 0.014, 0.05], mat('#c8a050', { metal: true, rough: 0.3, spec: 0.9 }), { group: null }); // brass neck roll
    for (let i = 0; i < 3; i++) f.ell([0, 0.49 - i * 0.03, 0.01 + i * 0.002], [0.106 + i * 0.006, 0.017, 0.078 + i * 0.004], steel, { group: null });
    for (const d of [-1, 1]) {
      // pauldrons: three overlapping lames over the bar's ends
      for (let i = 0; i < 3; i++) f.ell([d * (0.13 + i * 0.008), 0.705 - i * 0.026, 0], [0.058 - i * 0.004, 0.026, 0.06 - i * 0.004], steel, { group: null, R: rotZ(d * (0.35 + i * 0.1)) });
      for (let k = 0; k < 4; k++) f.sphere([d * 0.06, 0.66 - k * 0.04, 0.083], 0.0045, mat('#c8a050', { metal: true }), { group: null }); // rivets
    }
  } else {
    f.ell([0, 0.62, 0.006], [0.11, 0.1, 0.075], mat('#5a3a22', { pattern: 'leather', scale: 0.03 }), { group: 'plate', k: 0.03 });
  }
  // a bascinet hung on the post-top, visor up
  f.ell([0, 0.9, 0], [0.068, 0.078, 0.074], steel, { group: 'helm', k: 0.02 });
  f.cone([0, 0.92, -0.01], [0, 0.99, -0.03], 0.05, 0.006, steel, { group: 'helm', k: 0.03 });
  f.ell([0, 0.875, 0.06], [0.06, 0.02, 0.03], steel, { group: null, R: rotX(-0.5) });
  f.box([0, 0.86, 0.072], [0.04, 0.003, 0.006], M.dark, { group: null, bevel: 0.002 });
  if (R() < 2) f.ell([0, 0.83, 0], [0.074, 0.032, 0.074], mail, { group: null }); // aventail
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

/** Straw practice pell: a burlap torso stuffed and roped, straw bursting at the seams, crossbar arms, a hacked shield and a dented helm. */
function dummy3d(seed = 1) {
  const R = rngOf(seed);
  const f = new Figure();
  const post = mat('#4a3018', { pattern: 'wood', scale: 0.016, rough: 0.85 });
  const straw = mat('#c8a860', { pattern: 'fur', scale: 0.006, rough: 0.95 });
  const sack = mat('#8a7450', { pattern: 'cloth', scale: 0.006, rough: 0.95 });
  // a squared post in a cross-foot, the timber split and darkened
  f.box([0, 0.45, 0], [0.018, 0.45, 0.018], post, { group: null, bevel: 0.006 });
  f.box([0, 0.025, 0], [0.13, 0.022, 0.03], post, { group: null, bevel: 0.01 });
  f.box([0, 0.025, 0], [0.03, 0.022, 0.13], post, { group: null, bevel: 0.01 });
  for (const d of [-1, 1]) f.box([d * 0.06, 0.07, 0], [0.008, 0.05, 0.012], post, { group: null, bevel: 0.004, R: rotZ(d * 0.8) });
  // the torso: a stuffed sack, broad at the chest and pinched at the waist by rope
  f.ell([0, 0.66, 0], [0.13, 0.12, 0.085], sack, { group: 'body', k: 0.05, disp: { amp: 0.006, freq: 9 } });
  f.ell([0, 0.52, 0.004], [0.1, 0.09, 0.075], sack, { group: 'body', k: 0.05, disp: { amp: 0.006, freq: 9 } });
  for (const y of [0.58, 0.47]) f.ell([0, y, 0.002], [0.103, 0.009, 0.08], M.rope, { group: null });
  // straw bursting from a slash and the bottom of the sack
  for (let i = 0; i < 18; i++) {
    const a = R() * Math.PI * 2;
    const y = i < 10 ? 0.43 : 0.64 + R() * 0.06;
    const r0 = i < 10 ? 0.08 : 0.04;
    const o0 = [Math.cos(a) * r0 * (i < 10 ? 1 : 0.6), y, i < 10 ? Math.sin(a) * r0 * 0.8 : 0.07];
    const o1 = [o0[0] * 1.5 + (R() - 0.5) * 0.04, y - 0.04 - R() * 0.05, o0[2] * 1.4 + 0.01];
    f.cone(o0, o1, 0.006, 0.002, straw, { group: null });
  }
  // crossbar arms wrapped in straw and bound
  f.box([0, 0.73, 0], [0.24, 0.012, 0.012], post, { group: null, bevel: 0.005 });
  for (const d of [-1, 1]) {
    f.cone([d * 0.11, 0.73, 0], [d * 0.22, 0.725, 0], 0.03, 0.022, straw, { group: `arm${d}`, k: 0.01, disp: { amp: 0.004, freq: 30, twist: 3 } });
    f.ell([d * 0.17, 0.73, 0], [0.006, 0.032, 0.032], M.rope, { group: null });
  }
  // a hacked round shield hung on one arm
  const sd = seed % 2 ? 1 : -1;
  f.ell([sd * 0.2, 0.62, 0.05], [0.085, 0.085, 0.012], mat(seed % 2 ? '#6a2018' : '#20365a', { pattern: 'wood', scale: 0.01 }), { group: 'shield', k: 0.004, R: rotY(sd * 0.3) });
  f.ell([sd * 0.2, 0.62, 0.062], [0.088, 0.088, 0.006], M.iron, { group: null, R: rotY(sd * 0.3) });
  f.carve('box', [sd * 0.26, 0.66, 0.06], [0.03, 0.01, 0.03], null, { group: 'shield', k: 0.004 });
  f.sphere([sd * 0.2, 0.62, 0.07], 0.02, M.iron, { group: null });
  // the head: a tied sack under a dented helm
  f.ell([0, 0.83, 0], [0.065, 0.075, 0.06], sack, { group: 'head', k: 0.02, disp: { amp: 0.005, freq: 8 } });
  f.ell([0, 0.765, 0], [0.04, 0.012, 0.035], M.rope, { group: null });
  f.ell([0, 0.875, 0], [0.074, 0.06, 0.07], mat('#7a7c80', { pattern: 'metal', metal: true, rough: 0.5, spec: 0.6, scale: 0.03 }), { group: 'helm', k: 0.01 });
  f.carve('ell', [0.05, 0.9, 0.05], [0.03, 0.02, 0.02], null, { group: 'helm', k: 0.01 });
  f.ell([0, 0.85, 0], [0.08, 0.008, 0.076], M.iron, { group: null });
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
  // draw every shaft and pool into one layer, then blur it once (filters are costly)
  const W = g.canvas.width;
  const H = g.canvas.height;
  const k = 0.5;
  const L = makeCanvas(W * k, H * k);
  const lg = L.getContext('2d');
  lg.scale(k, k);
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const sx = from.x + (t - 0.5) * from.w;
    const ex = to.x + (t - 0.5) * to.w * spread;
    const c = palette[(i + (R() < 0.3 ? 1 : 0)) % palette.length];
    const a = alpha * (0.6 + R() * 0.6);
    const w0 = from.w / 9 * 1.6;
    const w1 = to.w / 9 * 1.8;
    const gr = lg.createLinearGradient(sx, from.y, ex, to.y);
    gr.addColorStop(0, rgba(c, a));
    gr.addColorStop(0.6, rgba(c, a * 0.4));
    gr.addColorStop(1, rgba(c, 0));
    lg.fillStyle = gr;
    poly(lg, [[sx - w0 / 2, from.y], [sx + w0 / 2, from.y], [ex + w1 / 2, to.y], [ex - w1 / 2, to.y]]);
    lg.fill();
  }
  for (let i = 0; i < 40; i++) {
    const u = R() - 0.5;
    const v = R() - 0.5;
    const c = palette[Math.floor(R() * palette.length)];
    lg.fillStyle = rgba(c, Math.max(0, alpha * 0.55 * (1 - Math.hypot(u, v) * 1.2)));
    lg.beginPath();
    lg.ellipse(to.x + u * to.w * spread, to.y + v * to.h, to.w * 0.07, to.h * 0.12, 0, 0, Math.PI * 2);
    lg.fill();
  }
  g.save();
  g.globalCompositeOperation = 'screen';
  g.filter = 'blur(4px)';
  g.drawImage(L, 0, 0, W, H);
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
  const at = (t) => [lerp(x0, x1, t), lerp(y0, y1, t) + Math.sin(t * Math.PI) * sag];
  // the cord, then pointed serrated leaves along it, then the roses in clusters of three
  g.strokeStyle = 'rgba(40,30,14,0.8)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i <= 30; i++) { const [x, y] = at(i / 30); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  const leaf = (x, y, a, l) => {
    g.save(); g.translate(x, y); g.rotate(a);
    const lg = g.createLinearGradient(0, -l * 0.3, 0, l * 0.3);
    lg.addColorStop(0, '#4a7a34'); lg.addColorStop(1, '#16300f');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(l * 0.5, -l * 0.38, l, 0); g.quadraticCurveTo(l * 0.5, l * 0.38, 0, 0); g.fill();
    g.strokeStyle = 'rgba(160,200,120,0.35)'; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(l * 0.1, 0); g.lineTo(l * 0.9, 0); g.stroke();
    g.restore();
  };
  for (let i = 0; i <= 46; i++) {
    const [x, y] = at(i / 46);
    leaf(x, y, (R() - 0.5) * 2.4 + (R() < 0.5 ? Math.PI : 0), 7 + R() * 5);
  }
  // a rose: a dark cup, petals spiralling in toward a tight bud, a lit rim on each petal
  const rose = (x, y, r) => {
    g.fillStyle = '#3a0408';
    g.beginPath(); g.arc(x, y + r * 0.1, r, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4 + R();
      const rr = r * (1 - k * 0.11);
      const px = x + Math.cos(a) * r * 0.18 * (1 - k / 7), py = y + Math.sin(a) * r * 0.14 * (1 - k / 7);
      const gr = g.createRadialGradient(px - rr * 0.3, py - rr * 0.4, rr * 0.1, px, py, rr);
      gr.addColorStop(0, k > 4 ? '#ff8a94' : '#e8384a'); gr.addColorStop(0.7, '#a8101e'); gr.addColorStop(1, '#4a0408');
      g.fillStyle = gr;
      g.beginPath(); g.arc(px, py, rr, a, a + Math.PI * 1.3); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,170,170,0.45)'; g.lineWidth = Math.max(0.6, r * 0.08);
      g.beginPath(); g.arc(px, py, rr * 0.92, a + 0.2, a + Math.PI * 1.1); g.stroke();
    }
    g.fillStyle = '#5a0610';
    g.beginPath(); g.arc(x + r * 0.05, y, r * 0.18, 0, Math.PI * 2); g.fill();
  };
  for (let i = 1; i < 9; i++) {
    const [x, y] = at(i / 9 + (R() - 0.5) * 0.02);
    const r = 5 + R() * 2;
    for (const [dx, dy, k] of [[-r * 1.1, r * 0.3, 0.8], [r * 1.05, r * 0.4, 0.75], [0, 0, 1]]) rose(x + dx, y + dy, r * k);
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
  // a modelled oak pew: plank seat with a rounded front edge, a slatted back on posts, carved
  // end boards with a scrolled top, wood grain and worn, lighter edges; broken ones snap short
  const R = rngOf(seed);
  const f = new Figure();
  const oak = mat('#4a2e16', { pattern: 'wood', scale: 0.01, rough: 0.7, spec: 0.12 });
  const oakL = mat('#5e3c1e', { pattern: 'wood', scale: 0.01, rough: 0.6, spec: 0.16 });
  const L = 0.8 * (broken ? 1 - broken * 0.45 : 1);
  const x0 = -0.4; const x1 = x0 + L;
  f.box([(x0 + x1) / 2, 0.2, 0], [L / 2, 0.012, 0.09], oakL, { group: null, bevel: 0.008 });
  f.box([(x0 + x1) / 2, 0.19, 0.088], [L / 2, 0.02, 0.008], oak, { group: null, bevel: 0.006 });
  for (let k = 0; k < 3; k++) f.box([(x0 + x1) / 2, 0.29 + k * 0.07, -0.085], [L / 2 - (broken && k === 2 ? 0.08 : 0), 0.024, 0.008], k % 2 ? oak : oakL, { group: null, bevel: 0.005, R: rotX(-0.12) });
  for (const ex of [x0, broken ? null : x1]) {
    if (ex == null) continue;
    f.box([ex, 0.25, -0.01], [0.014, 0.25, 0.11], oak, { group: null, bevel: 0.008 });
    f.ell([ex, 0.5, -0.04], [0.016, 0.045, 0.08], oak, { group: null });
    f.box([ex + (ex < 0 ? 0.016 : -0.016), 0.3, 0.04], [0.003, 0.08, 0.04], oakL, { group: null, bevel: 0.002 }); // carved panel
  }
  if (broken) {
    // the snapped end: splintered plank tips hanging down
    for (let k = 0; k < 4; k++) f.cone([x1, 0.2, -0.06 + k * 0.04], [x1 + 0.02 + R() * 0.03, 0.16 - R() * 0.06, -0.06 + k * 0.04], 0.01, 0.002, oakL, { group: null });
    f.box([x1 + 0.08, 0.02, 0.05], [0.07, 0.01, 0.03], oakL, { group: null, bevel: 0.005, R: rotY(0.6) });
  }
  f.box([(x0 + x1) / 2, 0.06, 0], [L / 2, 0.01, 0.012], oak, { group: null, bevel: 0.004 }); // stretcher
  const lr = rig({ key: [-0.3, 0.8, 0.5], keyC: '#d8f0ff', keyI: 1.1, rimC: '#9ff4ff', rim: [0.6, 0.4, -0.6], amb: 0.35, sky: '#2a3a48', ground: '#0e0c0a' });
  prop3d(g, f, x + w / 2, y, w / 0.95, lr, { yaw: side * 0.35, pitch: 0.22, shadowW: 0.5, shadowA: 0.65, ss: 1.4 });
  void s;
}

// ================================================================== City Hall

S.cityhall = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#7a6450', wallKind: 'plaster', wainscot: '#3a2616', floor: 'marble', floorColor: '#5e4c3a', by0: 0.04, by1: 0.66, bx0: 0.12, bx1: 0.7, ceiling: '#120c08', spall: 0.3 });
  const lights = [];
  // tall west windows in late light; shafts slant across the chamber toward the desk
  for (const [x, i] of [[0.17, 0], [0.3, 1]]) {
    P.windowLit(g, W * x, H * 0.1, W * 0.075, H * 0.38, { arch: true, color: '#ffd49a', lit: 1, frame: '#1a120a' });
    lightShaft(g, W * (x + 0.037), H * 0.32, W * 0.06, W * (x + 0.3), H * 0.99, W * 0.17, '#ffd8a0', 0.2 + i * 0.04);
  }
  glowEllipse(g, W * 0.6, H * 0.92, W * 0.22, H * 0.07, '#ffd090', 0.18);
  // the arms of New Phlan: a great tapestry behind the clerk
  const tx = W * 0.74;
  P.banner(g, tx, H * 0.07, W * 0.14, H * 0.44, '#5a1a14', { emblem: 'scales', trim: '#d8b25a', seed: 4 });
  P.banner(g, W * 0.5, H * 0.12, W * 0.04, H * 0.26, '#1d3574', { emblem: 'crown', tatter: 0.15, seed: 5 });
  // pigeonholes of rolled deeds on the back wall right
  {
    // an oak cabinet: a moulded cornice, stiles, and niches each holding a few rolled deeds seen
    // end-on (paper spirals, wooden end caps, a ribbon or a wax seal hanging from some)
    const x0 = W * 0.395, y0 = H * 0.41, cw = W * 0.1, ch = H * 0.22;
    g.fillStyle = linGrad(g, x0, 0, x0 + cw, 0, [[0, '#4a301a'], [0.5, '#5e3e22'], [1, '#2e1c0e']]);
    g.fillRect(x0 - 4, y0 - 6, cw + 8, ch + 10);
    g.fillStyle = linGrad(g, 0, y0 - 12, 0, y0, [[0, '#7a5430'], [1, '#2a180a']]);
    g.fillRect(x0 - 8, y0 - 12, cw + 16, 7);
    const nx = 4, ny = 4, gap = 3;
    const cwid = (cw - gap * (nx + 1)) / nx, chgt = (ch - gap * (ny + 1)) / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = x0 + gap + i * (cwid + gap), cy = y0 + gap + j * (chgt + gap);
      g.fillStyle = '#0c0703';
      g.fillRect(cx, cy, cwid, chgt);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(cx, cy, cwid, chgt * 0.25);
      const n = 1 + Math.floor(R() * 3.2);
      for (let k = 0; k < n; k++) {
        const r = Math.min(cwid, chgt) * (0.2 + R() * 0.07);
        const sx = cx + cwid * (0.28 + (k % 2) * 0.42) + (R() - 0.5) * 2;
        const sy = cy + chgt - r - 1 - (k > 1 ? r * 1.6 : 0);
        // paper roll end: cream with a dark spiral; some carry a turned wooden end cap
        const cap = R() < 0.45;
        const rg = g.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r);
        rg.addColorStop(0, cap ? '#a8784a' : '#f4e8c8'); rg.addColorStop(1, cap ? '#4a2c14' : '#a89068');
        g.fillStyle = rg;
        g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = cap ? 'rgba(30,16,6,0.7)' : 'rgba(110,84,50,0.75)';
        g.lineWidth = Math.max(0.5, r * 0.12);
        g.beginPath();
        if (cap) { g.arc(sx, sy, r * 0.55, 0, Math.PI * 2); }
        else for (let a = 0; a < Math.PI * 5; a += 0.3) { const rr = r * 0.85 * (a / (Math.PI * 5)); const px = sx + Math.cos(a) * rr, py = sy + Math.sin(a) * rr; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.stroke();
        if (R() < 0.3) { g.fillStyle = R() < 0.5 ? '#9a1a14' : '#1d3574'; g.fillRect(sx - r * 0.15, sy + r * 0.6, r * 0.3, r * 1.6); }
        if (R() < 0.2) { g.fillStyle = '#b02018'; g.beginPath(); g.arc(sx + r * 0.4, sy + r * 1.3, r * 0.4, 0, Math.PI * 2); g.fill(); }
      }
      // the niche's lit lower lip
      g.fillStyle = 'rgba(255,210,150,0.18)';
      g.fillRect(cx, cy + chgt - 1, cwid, 1);
    }
  }
  // right wall: ledgers to the ceiling, built along the wall in true perspective
  wallBookcase(g, [[rm.bx1, rm.by0], [W, -H * 0.05], [W, H * 1.05], [rm.bx1, rm.by1]], 0.12, 0.8, 0.1, 0.8, R);
  // left wall: proclamations
  g.save();
  g.transform(1, -0.25, 0, 1, 0, 0);
  P.noticeBoard(g, W * 0.02, H * 0.42, W * 0.08, H * 0.22, 5);
  g.restore();
  // a painted map of the old city in a gilt frame, and the council's second banner
  {
    const mx = W * 0.2, my = H * 0.1, mw = W * 0.09, mh = H * 0.1;
    g.fillStyle = linGrad(g, mx, my, mx + mw, my + mh, [[0, '#e0c070'], [0.5, '#7a5a20'], [1, '#c8a050']]);
    g.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    g.fillStyle = '#c8b48a';
    g.fillRect(mx, my, mw, mh);
    texture(g, mx, my, mw, mh, { alpha: 0.4, mode: 'multiply', cells: 5, seed: 31 });
    g.strokeStyle = 'rgba(60,40,20,0.7)'; g.lineWidth = 1;
    g.beginPath(); // the shore of the Moonsea and the city wall
    g.moveTo(mx, my + mh * 0.7); g.bezierCurveTo(mx + mw * 0.3, my + mh * 0.55, mx + mw * 0.6, my + mh * 0.85, mx + mw, my + mh * 0.6);
    g.moveTo(mx + mw * 0.2, my + mh * 0.6); g.lineTo(mx + mw * 0.25, my + mh * 0.2); g.lineTo(mx + mw * 0.75, my + mh * 0.15); g.lineTo(mx + mw * 0.8, my + mh * 0.55);
    g.stroke();
    g.fillStyle = 'rgba(70,90,120,0.35)';
    g.beginPath(); g.moveTo(mx, my + mh * 0.7); g.bezierCurveTo(mx + mw * 0.3, my + mh * 0.55, mx + mw * 0.6, my + mh * 0.85, mx + mw, my + mh * 0.6); g.lineTo(mx + mw, my + mh); g.lineTo(mx, my + mh); g.fill();
  }
  P.banner(g, W * 0.62, H * 0.12, W * 0.04, H * 0.26, '#5a1a14', { emblem: 'scales', tatter: 0.1, seed: 6 });
  chandelier(g, W * 0.36, H * 0.2, W * 0.06, lights);
  // the petitioners' bench under the windows, and those waiting their turn at the desk: a widow
  // with a basket and a carter with his hat in his hands, a merchant come to argue his tariff
  const plr = rig({ key: [-0.8, 0.5, 0.35], keyC: '#ffd8a0', keyI: 1.25, rimC: '#ffb060', rim: [0.7, 0.4, -0.6], amb: 0.42, sky: '#4a3a30', ground: '#2a1c10' });
  pew(g, W * 0.13, H * 0.8, W * 0.2, 1, { side: 1, seed: 7 });
  const petitioner = (spec, x, y, hh, yaw) => {
    const bn = buildNpc({ eyeC: '#3a2a1a', age: 0.3, build: 1, ...spec });
    const r = renderFigure(bn.fig, { ppu: (H * hh) / bn.top, yaw, rig: plr, pitch: 0.12, ink: 0.7, haze: 0.18, hazeColor: '#3a2a1c', ss: 1.25 });
    if (!r) return;
    contactShadow(g, W * x, H * y, H * hh * 0.16, H * hh * 0.03, 0.5);
    g.drawImage(r.canvas, W * x - r.ox, H * y - r.oy);
  };
  petitioner({ seed: 31, gender: 'female', age: 0.6, skin: '#d8a888', hair: '#8a8278', hairStyle: 'bun', pose: 'sit', outfit: { shirt: '#c8bca4', top: '#3a3a4a', topKind: 'bodice', skirt: '#4a3a2a', apron: '#b8ac90', sleeves: 'long' } }, 0.2, 0.795, 0.27, 0.55);
  petitioner({ seed: 32, gender: 'male', skin: '#b88060', hair: '#3a2416', beard: 'stubble', pose: 'sit', outfit: { shirt: '#8a7a5a', top: '#4a3a24', topKind: 'jerkin', trousers: '#3a3a40', boots: '#2a1c10', sleeves: 'rolled' } }, 0.28, 0.8, 0.27, 0.7);
  petitioner({ seed: 33, gender: 'male', age: 0.5, skin: '#d4a080', hair: '#2a1a10', beard: 'moustache', belly: true, pose: 'clasped', outfit: { shirt: '#d8ccb0', top: '#5a3a1e', topKind: 'doublet', sleeves: 'puffed', trousers: '#2a1e14', boots: '#1e140c', mantle: '#3a2414' } }, 0.52, 0.86, 0.34, 1.05);
  // dais under the desk
  g.fillStyle = linGrad(g, 0, H * 0.8, 0, H * 0.86, [[0, '#7a6450'], [0.2, '#4a3a2a'], [1, '#1a120a']]);
  poly(g, [[W * 0.24, H * 0.8], [W * 0.8, H * 0.8], [W * 0.86, H * 0.88], [W * 0.18, H * 0.88]]);
  g.fill();
  // foreground: the desk (3D) in front of the clerk, and a column framing the left
  const ppu = H * 0.8;
  const d = desk3d();
  const lr = rig({ key: [-0.75, 0.45, 0.5], keyC: '#ffd090', keyI: 1.2, rimC: '#ffb060', amb: 0.45, sky: '#4a3a30', ground: '#24180e' });
  const dx = W * 0.8;
  const dy = H * 1.02;
  prop3d(fg, d.f, dx, dy, ppu, lr, { yaw: -0.12, shadowW: 0.5 });
  waxCandles(fg, d.tips, dx, dy, ppu, -0.12, { pool: '#ffb050' });
  for (const t of d.tips) { const [x, y] = proj(dx, dy, ppu, t, -0.12); lights.push({ x, y, s: 5, kind: 'candle', color: '#ffc060', front: true }); }
  P.column(fg, W * 0.035, -10, H * 1.02, 74, { base: '#7a6a58', seed: 9 });
  return { ...rm, lights, motes: { color: '#ffe0b0', count: 55, rise: 0.03 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.81, y: H * 0.9, h: H * 0.78, pose: 'ledger', yaw: -0.25 } };
};

// ================================================================== Roland's forge

S.smithy = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#4a4038', wallKind: 'stone', floor: 'dirt', floorColor: '#3a3028', bx0: 0.3, bx1: 0.94, by0: 0.1, by1: 0.66, damp: 0.35, soot: [{ x: W * 0.4, y: H * 0.66 - 120, r: 150, a: 0.85 }, { x: W * 0.75, y: H * 0.2, r: 160, a: 0.35 }] });
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
  // the great bellows beside the forge on a trestle: two boards with pleated leather between
  // them, a brass nozzle into the hearth, and the lever arm overhead
  {
    const bx = fx - 205; const by = fy - 44;
    g.fillStyle = '#1e140c';
    for (const lx of [bx + 10, bx + 66]) g.fillRect(lx, by + 18, 7, fy - by - 18); // trestle legs
    g.fillRect(bx, by + 16, 84, 6);
    contactShadow(g, bx + 42, fy + 2, 60, 6, 0.5);
    g.fillStyle = linGrad(g, 0, by - 22, 0, by + 16, [[0, '#6a4428'], [1, '#2a180c']]);
    poly(g, [[bx, by - 4], [bx + 80, by - 16], [bx + 84, by - 10], [bx + 4, by + 2]]); g.fill(); // upper board
    g.fillStyle = linGrad(g, 0, by, 0, by + 16, [[0, '#4a2e18'], [1, '#1a0e06']]);
    poly(g, [[bx + 2, by + 4], [bx + 84, by - 4], [bx + 86, by + 12], [bx + 2, by + 16]]); g.fill(); // leather
    g.strokeStyle = 'rgba(10,6,2,0.8)'; g.lineWidth = 1.2;
    for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(bx + 2 + k * 16, by + 4 - k * 1.6); g.lineTo(bx + 2 + k * 16, by + 16); g.stroke(); }
    g.fillStyle = linGrad(g, bx + 84, 0, bx + 110, 0, [[0, '#c89a50'], [1, '#6a4a20']]);
    poly(g, [[bx + 84, by - 2], [bx + 112, by + 2], [bx + 112, by + 6], [bx + 84, by + 10]]); g.fill(); // nozzle
    g.strokeStyle = '#2a1a0c'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(bx + 6, by - 6); g.lineTo(bx - 10, by - 60); g.stroke(); // lever
    g.strokeStyle = 'rgba(255,150,70,0.35)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(bx + 80, by - 16); g.lineTo(bx + 84, by - 10); g.stroke();
  }
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
  // foreground: the anvil and a quench tub, sculpted
  const lr = rig({ key: [-0.85, 0.35, 0.4], keyC: '#ff9a40', keyI: 1.45, rimC: '#ffb070', rim: [0.7, 0.5, -0.5], amb: 0.32, sky: '#3a2a24', ground: '#1e100a' });
  const ppu = H * 0.95;
  const ax = W * 0.5;
  const ay = H * 1.03;
  prop3d(fg, anvil3d(), ax, ay, ppu, lr, { yaw: 0.25, shadowW: 0.32 });
  const [wx, wy] = proj(ax, ay, ppu, [0.03, 0.3, 0.01], 0.25);
  lights.push({ x: wx, y: wy, s: 14, kind: 'glow', color: '#ff8030', front: true });
  prop3d(fg, barrel3d(5, { open: true, water: true }), W * 0.76, H * 1.02, ppu * 0.95, lr, { yaw: 0.3 });
  prop3d(g, armourStand3d(3), W * 0.9, H * 0.95, H * 0.62, lr, { yaw: -0.4, shadowW: 0.22 });
  return { ...rm, lights, motes: { color: '#ffa050', count: 80, rise: 0.45 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.6, y: H * 1.0, h: H * 0.78, pose: 'smith', yaw: -0.3, apron: true } };
};

// ================================================================== temples

/** Tyr: a domed rotunda of pale stone, an oculus beam on the altar, the great scales. */
function templeTyr(g, W, H, R, o, d) {
  const fg = o.fg ?? g;
  const lights = [];
  const floorY = H * 0.68;
  // dome and apse: the dome's underside lit from the oculus, cool and pale
  const cx = W / 2;
  const dg = g.createRadialGradient(cx, -H * 0.05, H * 0.05, cx, 0, W * 0.6);
  dg.addColorStop(0, '#9a9ca4');
  dg.addColorStop(0.45, '#4a4c56');
  dg.addColorStop(1, '#121318');
  g.fillStyle = dg;
  g.fillRect(0, 0, W, H);
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
      const k = 0.95 - ring * 0.12;
      g.fillStyle = rgba('#b4b6bc', 1, k + R() * 0.06);
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
  // big dressed blocks of cold pale limestone — a hall of judgment, not a brick shed
  masonry(g, 0, H * 0.06, W, floorY - H * 0.06, { base: '#aeb0b0', course: 44, blockW: 96, seed: 211, mortar: 'rgba(30,32,40,0.45)', light: 'rgba(230,240,255,0.18)', damp: 0.25 });
  texture(g, 0, H * 0.06, W, floorY - H * 0.06, { alpha: 0.22, cells: 6, seed: 214 });
  // an inscription band in gilt capitals, and the carved, gilded balance of Tyr above the altar
  const iy = H * 0.09; // high on the apse wall, above the priest's mitre
  g.fillStyle = 'rgba(16,20,34,0.8)';
  g.fillRect(0, iy, W, H * 0.045);
  g.fillStyle = 'rgba(216,178,90,0.45)';
  g.fillRect(0, iy, W, 1.5);
  g.fillRect(0, iy + H * 0.043, W, 1.5);
  g.font = `600 ${Math.round(H * 0.026)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e8c870';
  g.fillText('I V S T I T I A   ·   L E X   ·   O F F I C I V M   ·   I V S T I T I A   ·   L E X   ·   O F F I C I V M', cx, iy + H * 0.023);
  for (const nx of [0.18, 0.82]) carvedBalance(g, W * nx, H * 0.6, H * 0.06);
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
    const cw = 34 + near * 56;
    const top = H * 0.06 - near * H * 0.05;
    marbleColumn(g, x, top, by, cw, { base: '#c4c6c8', seed: Math.round(a * 10) + 20 });
    // the architrave block the capital carries, running out of frame
    g.fillStyle = linGrad(g, x - cw, 0, x + cw, 0, [[0, '#4a4a50'], [0.35, '#a8a8ac'], [1, '#3a3a40']]);
    g.fillRect(x - cw * 0.85, top - H * 0.08, cw * 1.7, H * 0.08);
    g.fillStyle = 'rgba(10,10,14,0.5)';
    g.fillRect(x - cw * 0.85, top - H * 0.012, cw * 1.7, H * 0.012);
    // ambient occlusion where shaft meets floor, and the plinth's shadow on the marble
    contactShadow(g, x, by, cw * 1.1, 9 + near * 6, 0.6);
    glowEllipse(g, x + cw * 0.5, by + 4, cw * 1.4, 10 + near * 8, '#000000', 0.25, 'source-over');
  }
  // the oculus beam
  lightShaft(g, cx, -10, W * 0.12, cx, H * 0.95, W * 0.3, '#fff4d8', 0.42);
  lightShaft(g, cx, -10, W * 0.06, cx, H * 0.95, W * 0.16, '#ffffff', 0.25);
  glowEllipse(g, cx, H * 0.9, W * 0.2, H * 0.06, '#fff0c8', 0.35);
  glow(g, cx, 0, W * 0.2, '#fff8e8', 0.5);
  // the great scales hang above the altar
  const lr = rig({ key: [0.0, 0.95, 0.3], keyC: '#fff0d0', keyI: 1.4, rimC: '#a8c0ff', amb: 0.45, sky: '#3a4060', ground: '#2a2418' });
  // cold north light pooling on the pale floor
  glowEllipse(g, cx, H * 0.95, W * 0.45, H * 0.1, '#c8d8ff', 0.18, 'screen');
  // altar & candelabra in front of the priest
  const al = altar3d({ stone: '#dcd4c4', runner: d.banner ?? '#1d3574', emblemC: '#e0b850', candles: 6, seed: 31 });
  const ppu = H * 0.78;
  prop3d(fg, al.f, cx, H * 1.04, ppu, lr, { shadowW: 0.5 });
  waxCandles(fg, al.tips, cx, H * 1.04, ppu, 0, { pool: '#ffd080' });
  for (const t of al.tips) { const [x, y] = proj(cx, H * 1.04, ppu, t); lights.push({ x, y, s: 5, kind: 'candle', color: '#ffd070', front: true }); }
  return { lights, motes: { color: '#fff4d8', count: 90, rise: 0.02 }, floorY, fgUsed: true, actorSlot: { x: cx, y: H * 0.92, h: H * 0.74, pose: 'priest', yaw: 0, vestments: '#1d3574' } };
}

/**
 * A fluted marble column: warm veined stone, concave flutes each with its own shadowed and lit
 * edge, an Ionic capital with volutes and an egg-and-dart band, an Attic base, grime at the foot.
 */
function marbleColumn(g, x, yTop, yBot, w, { base = '#c4c6c8', seed = 1 } = {}) {
  const R = rngOf(seed);
  const stone = mix(base, '#e8dcc8', 0.45).map((v) => Math.round(v));
  const shaft = (k) => rgba(stone, 1, k);
  const top = yTop + w * 0.5;
  const bot = yBot - w * 0.45;
  g.save();
  g.beginPath(); g.rect(x - w / 2, yTop, w, yBot - yTop); g.clip();
  // the round of the shaft
  g.fillStyle = linGrad(g, x - w / 2, 0, x + w / 2, 0, [[0, shaft(0.42)], [0.2, shaft(1.08)], [0.36, shaft(1.0)], [0.72, shaft(0.6)], [1, shaft(0.28)]]);
  g.fillRect(x - w / 2, yTop, w, yBot - yTop);
  // mottling in the stone
  for (let i = 0; i < 26; i++) {
    const vx = x + (R() - 0.5) * w; const vy = yTop + R() * (yBot - yTop);
    glowEllipse(g, vx, vy, w * (0.1 + R() * 0.2), w * (0.3 + R() * 0.8), R() < 0.5 ? '#fff6e6' : '#6a6458', 0.07, 'source-over');
  }
  // flutes: concave channels, each dark on its lit side's lip and bright on the far wall
  const n = 11;
  for (let i = 0; i < n; i++) {
    const u0 = i / n; const u1 = (i + 1) / n;
    const x0 = x + Math.sin((u0 - 0.5) * Math.PI) * w * 0.5;
    const x1 = x + Math.sin((u1 - 0.5) * Math.PI) * w * 0.5;
    const fw = x1 - x0;
    if (fw < 1.2) continue;
    const lit = 1 - (u0 + u1) / 2;
    const fg = g.createLinearGradient(x0, 0, x1, 0);
    fg.addColorStop(0, `rgba(20,16,12,${0.42 + (1 - lit) * 0.25})`);
    fg.addColorStop(0.4, 'rgba(20,16,12,0.1)');
    fg.addColorStop(0.82, `rgba(255,250,236,${0.2 + lit * 0.28})`);
    fg.addColorStop(1, 'rgba(20,16,12,0.35)');
    g.fillStyle = fg;
    g.fillRect(x0 + 0.5, top, fw - 1, bot - top);
    // the channel's rounded ends
    g.beginPath(); g.ellipse((x0 + x1) / 2, top, fw * 0.45, fw * 0.6, 0, Math.PI, 0); g.fill();
  }
  // veins: wandering grey-blue threads with a few warm ones, branching
  for (let i = 0; i < 7; i++) {
    let vx = x + (R() - 0.5) * w * 0.9; let vy = yTop + R() * (yBot - yTop) * 0.5;
    g.strokeStyle = R() < 0.3 ? 'rgba(160,120,60,0.35)' : 'rgba(70,76,92,0.38)';
    g.lineWidth = Math.max(0.6, w * (0.008 + R() * 0.018));
    g.beginPath(); g.moveTo(vx, vy);
    const steps = 14;
    for (let k = 0; k < steps; k++) {
      vx += (R() - 0.5) * w * 0.18; vy += (yBot - yTop) / steps * (0.4 + R() * 0.8);
      g.lineTo(vx, vy);
      if (R() < 0.12) { g.moveTo(vx, vy); g.lineTo(vx + (R() - 0.5) * w * 0.4, vy + w * 0.3 * R()); g.moveTo(vx, vy); }
    }
    g.stroke();
  }
  // grime rising from the floor and soot beneath the capital
  g.fillStyle = linGrad(g, 0, bot - w * 1.6, 0, yBot, [[0, 'rgba(40,30,20,0)'], [1, 'rgba(40,30,20,0.45)']]);
  g.fillRect(x - w / 2, bot - w * 1.6, w, yBot - bot + w * 1.6);
  g.fillStyle = linGrad(g, 0, yTop, 0, top + w * 1.2, [[0, 'rgba(20,16,12,0.5)'], [1, 'rgba(20,16,12,0)']]);
  g.fillRect(x - w / 2, yTop, w, top + w * 1.2 - yTop);
  g.restore();
  // Ionic capital: abacus slab, an egg-and-dart band and two volutes
  const cy = yTop + Math.max(0, -yTop);
  g.fillStyle = linGrad(g, x - w, 0, x + w, 0, [[0, shaft(0.5)], [0.3, shaft(1.15)], [1, shaft(0.35)]]);
  g.fillRect(x - w * 0.78, cy, w * 1.56, w * 0.16);
  g.fillStyle = 'rgba(20,16,12,0.35)';
  g.fillRect(x - w * 0.78, cy + w * 0.16, w * 1.56, w * 0.03);
  for (let k = 0; k < 7; k++) {
    const ex = x - w * 0.45 + k * w * 0.15;
    g.fillStyle = linGrad(g, ex - w * 0.05, 0, ex + w * 0.05, 0, [[0, shaft(1.1)], [1, shaft(0.5)]]);
    g.beginPath(); g.ellipse(ex, cy + w * 0.27, w * 0.05, w * 0.07, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(20,16,12,0.45)';
    g.fillRect(ex + w * 0.065, cy + w * 0.21, Math.max(1, w * 0.015), w * 0.12);
  }
  for (const d of [-1, 1]) {
    const vx = x + d * w * 0.6; const vy = cy + w * 0.3;
    g.fillStyle = linGrad(g, vx - w * 0.18, 0, vx + w * 0.18, 0, [[0, shaft(d < 0 ? 1.1 : 0.7)], [1, shaft(d < 0 ? 0.6 : 0.35)]]);
    g.beginPath(); g.arc(vx, vy, w * 0.18, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,26,22,0.6)';
    g.lineWidth = Math.max(1, w * 0.025);
    g.beginPath();
    for (let a = 0; a < Math.PI * 4; a += 0.2) { const r = w * 0.15 * (1 - a / (Math.PI * 4.4)); const px = vx + Math.cos(a * d) * r; const py = vy + Math.sin(a) * r; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); }
    g.stroke();
  }
  // Attic base: two tori and a plinth, chipped
  g.fillStyle = linGrad(g, x - w, 0, x + w, 0, [[0, shaft(0.5)], [0.3, shaft(1.1)], [1, shaft(0.3)]]);
  g.beginPath(); g.ellipse(x, yBot - w * 0.42, w * 0.62, w * 0.1, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(20,16,12,0.35)';
  g.beginPath(); g.ellipse(x, yBot - w * 0.35, w * 0.6, w * 0.05, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = linGrad(g, x - w, 0, x + w, 0, [[0, shaft(0.5)], [0.3, shaft(1.1)], [1, shaft(0.3)]]);
  g.beginPath(); g.ellipse(x, yBot - w * 0.26, w * 0.7, w * 0.12, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(x - w * 0.75, yBot - w * 0.18, w * 1.5, w * 0.18);
  g.fillStyle = 'rgba(30,22,14,0.4)';
  g.fillRect(x - w * 0.75, yBot - w * 0.05, w * 1.5, w * 0.05);
}

/** Tyr's balance carved in relief into the apse wall and gilded: shadow, gilt, highlight. */
function carvedBalance(g, cx, cy, s) {
  const draw = (dx, dy, col, lw) => {
    g.save();
    g.translate(dx, dy);
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s * 0.95); g.stroke();
    g.beginPath(); g.moveTo(cx - s * 1.2, cy - s * 0.6); g.quadraticCurveTo(cx, cy - s * 0.78, cx + s * 1.2, cy - s * 0.6); g.stroke();
    for (const d of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + d * s * 1.2, cy - s * 0.6); g.lineTo(cx + d * s * 0.9, cy + s * 0.15); g.moveTo(cx + d * s * 1.2, cy - s * 0.6); g.lineTo(cx + d * s * 1.5, cy + s * 0.15); g.stroke();
      g.beginPath(); g.ellipse(cx + d * s * 1.2, cy + s * 0.18, s * 0.36, s * 0.1, 0, 0, Math.PI); g.fill();
    }
    g.beginPath(); g.moveTo(cx - s * 0.45, cy + s * 0.95); g.lineTo(cx + s * 0.45, cy + s * 0.95); g.stroke();
    g.beginPath(); g.arc(cx, cy - s, s * 0.1, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  draw(2, 3, 'rgba(10,12,20,0.55)', s * 0.11);
  draw(0, 0, '#b08a3a', s * 0.09);
  draw(-1, -1, 'rgba(255,236,170,0.55)', s * 0.03);
  glow(g, cx, cy, s * 2.2, '#ffe8a8', 0.12, 'screen');
}

/** Sune: a candlelit boudoir-chapel of rose marble and gilt, the great rose window, her mirror. */
function templeSune(g, W, H, R, o, d) {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#b88c84', wallKind: 'plaster', floor: 'marble', floorColor: '#7a5450', by0: 0.04, by1: 0.66, bx0: 0.1, bx1: 0.64, beams: false, ceiling: '#2a1418', spall: 0, damp: 0.25 });
  const lights = [];
  const pal = ['#c01e34', '#ff8aa0', '#ffd890', '#7a1430', '#f8f0e0'];
  // rose marble panelling in gilt mouldings over the plaster: veins, inset panels, pilasters
  const { bx0, bx1, by0, by1 } = rm;
  const panels = 5;
  for (let i = 0; i < panels; i++) {
    const px = bx0 + ((bx1 - bx0) * i) / panels;
    const pw = (bx1 - bx0) / panels;
    g.fillStyle = linGrad(g, px, by0, px + pw, by1, [[0, '#d8aaa0'], [0.5, '#c0928a'], [1, '#a87a74']]);
    g.fillRect(px + pw * 0.08, by0 + (by1 - by0) * 0.08, pw * 0.84, (by1 - by0) * 0.84);
    g.strokeStyle = 'rgba(120,60,60,0.25)';
    g.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      const vx = px + pw * (0.2 + R() * 0.6);
      g.moveTo(vx, by0 + (by1 - by0) * 0.1);
      g.bezierCurveTo(vx + (R() - 0.5) * pw, by0 + (by1 - by0) * 0.4, vx + (R() - 0.5) * pw, by0 + (by1 - by0) * 0.6, vx + (R() - 0.5) * pw * 0.5, by1 - (by1 - by0) * 0.1);
      g.stroke();
    }
    g.strokeStyle = '#d8a848';
    g.lineWidth = 2;
    g.strokeRect(px + pw * 0.08, by0 + (by1 - by0) * 0.08, pw * 0.84, (by1 - by0) * 0.84);
    g.strokeStyle = 'rgba(60,20,20,0.5)';
    g.lineWidth = 1;
    g.strokeRect(px + pw * 0.08 + 3, by0 + (by1 - by0) * 0.08 + 3, pw * 0.84 - 6, (by1 - by0) * 0.84 - 6);
  }
  // crimson silk drapes either side of the window, gathered with gold cord
  for (const [x0, x1] of [[0.12, 0.2], [0.52, 0.6]]) {
    for (let i = 0; i < 8; i++) {
      const x = W * lerp(x0, x1, i / 8);
      g.fillStyle = linGrad(g, x, 0, x + W * 0.012, 0, [[0, '#7a1020'], [0.5, '#d03444'], [1, '#3a0610']]);
      g.fillRect(x, H * 0.04, W * 0.011, rm.by1 - H * 0.04);
    }
    g.fillStyle = '#e8b850';
    g.fillRect(W * x0, H * 0.4, W * (x1 - x0), 4);
  }
  roseWindow(g, W * 0.36, H * 0.27, H * 0.19, pal, 41);
  godRays(g, { x: W * 0.36, y: H * 0.3, w: H * 0.3 }, { x: W * 0.42, y: H * 0.9, w: W * 0.32, h: H * 0.12 }, pal, { alpha: 0.18, seed: 42 });
  // the window's colours lie on the marble in a sheared pool (red, rose and gold quarries)
  {
    const fy = H * 0.78;
    g.save();
    g.globalCompositeOperation = 'screen';
    const RR = rngOf(45);
    for (let i = 0; i < 38; i++) {
      const a = RR() * Math.PI * 2, rr = Math.sqrt(RR());
      const px = W * 0.24 + Math.cos(a) * rr * W * 0.13;
      const py = fy + Math.sin(a) * rr * H * 0.045;
      const col = pal[Math.floor(RR() * pal.length)];
      glowEllipse(g, px, py, W * (0.018 + RR() * 0.02), H * (0.008 + RR() * 0.01), col, 0.3, 'screen');
    }
    glowEllipse(g, W * 0.24, fy, W * 0.16, H * 0.06, '#ff9aa8', 0.22, 'screen');
    g.restore();
  }
  garland(g, W * 0.12, H * 0.08, W * 0.6, H * 0.08, H * 0.06, 43);
  garland(g, W * 0.64, H * 0.12, W * 0.98, H * -0.02, H * 0.05, 44);
  const lr = rig({ key: [-0.3, 0.5, 0.8], keyC: '#ffb890', keyI: 1.3, rimC: '#ff9aa8', amb: 0.45, sky: '#7a3a44', ground: '#3a1414' });
  // Sune's mirror: a tall cheval glass in a gilt frame, reflecting the candlelit room
  sunesMirror(g, W * 0.83, H * 0.94, H * 0.66, R);
  // roses on plinths
  for (const [x, y, sc] of [[0.08, 0.98, 0.7], [0.68, 0.8, 0.45]]) {
    g.fillStyle = linGrad(g, W * x - 30 * sc, 0, W * x + 30 * sc, 0, [[0, '#f0dcd4'], [1, '#6a4a48']]);
    g.fillRect(W * x - 26 * sc, H * y - 120 * sc, 52 * sc, 120 * sc);
    prop3d(g, roses3d(Math.round(x * 100)), W * x, H * y - 120 * sc, H * sc, lr, { shadow: false });
  }
  // tall candelabra either side of the altar: the room's warm rose light
  for (const [x, y, sc] of [[0.2, 0.9, 1], [0.6, 0.9, 1], [0.95, 0.99, 1.2]]) {
    const cx = W * x;
    const base = H * y;
    const top = base - H * 0.42 * sc;
    g.fillStyle = linGrad(g, cx - 4, 0, cx + 4, 0, [[0, '#f0c868'], [1, '#6a4a18']]);
    g.fillRect(cx - 3 * sc, top, 6 * sc, base - top);
    g.beginPath(); g.ellipse(cx, base, 22 * sc, 6 * sc, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c89a40';
    g.lineWidth = 3 * sc;
    g.beginPath(); g.moveTo(cx - 34 * sc, top); g.quadraticCurveTo(cx, top + 26 * sc, cx + 34 * sc, top); g.stroke();
    for (const dx of [-34, -17, 0, 17, 34]) {
      const ty = top - (dx === 0 ? 10 : Math.abs(dx) === 17 ? 4 : 0) * sc;
      paintWax(g, cx + dx * sc, ty, cx + dx * sc, ty - 16 * sc, 5.5 * sc, R, '#ffb090');
      lights.push({ x: cx + dx * sc, y: ty - 18 * sc, s: 4.5 * sc, kind: 'candle', color: '#ffb070' });
    }
    glow(g, cx, top - 14 * sc, 230 * sc, '#ff9a70', 0.32, 'screen');
    glowEllipse(g, cx, base, 160 * sc, 30 * sc, '#ffb090', 0.25, 'screen');
  }
  // votive candles crowding the altar step
  for (let i = 0; i < 14; i++) {
    const vx = W * (0.27 + R() * 0.26);
    const vy = H * (0.82 + R() * 0.04);
    paintWax(g, vx, vy, vx, vy - 7, 4, R, '#ffc080');
    lights.push({ x: vx, y: vy - 8, s: 2.5, kind: 'candle', color: '#ffc080' });
  }
  // petals on the floor
  for (let i = 0; i < 90; i++) {
    const x = W * (0.12 + R() * 0.76);
    const y = H * (0.8 + R() * 0.2);
    g.fillStyle = rgba('#c0182a', 0.85, 0.7 + R() * 0.6);
    g.beginPath();
    g.ellipse(x, y, 3 + R() * 2, 1.6, R() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // a warm rose wash over the whole room, darker at the edges so the candles carry it
  g.save();
  g.globalCompositeOperation = 'multiply';
  const wash = g.createRadialGradient(W * 0.42, H * 0.6, H * 0.15, W * 0.42, H * 0.6, W * 0.7);
  wash.addColorStop(0, '#fff0e8');
  wash.addColorStop(0.6, '#d08a80');
  wash.addColorStop(1, '#5a2a30');
  g.fillStyle = wash;
  g.fillRect(0, 0, W, H);
  g.restore();
  // the rose window's light, laid over the wash so it reads: a sheared projection of its wheel of
  // quarries across the marble (petal segments in red, rose and gold), and the same colours
  // climbing the face of the altar
  const projectRose = (ctx, cx, cy, rx, ry, shear, alpha, seed) => {
    const tmp = makeCanvas(W, H);
    const tg = tmp.getContext('2d');
    const RR = rngOf(seed);
    for (let ring = 0; ring < 3; ring++) {
      const n = 8 + ring * 4;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2 + ring * 0.2;
        const a1 = ((k + 0.86) / n) * Math.PI * 2 + ring * 0.2;
        const r0 = 0.18 + ring * 0.28;
        const r1 = r0 + 0.24;
        const pts = [[a0, r0], [a1, r0], [a1, r1], [a0, r1]].map(([a, r]) => {
          const ex = Math.cos(a) * r * rx;
          const ey = Math.sin(a) * r * ry;
          return [cx + ex + ey * shear, cy + ey];
        });
        tg.fillStyle = pal[Math.floor(RR() * 3)];
        tg.globalAlpha = 0.55 + RR() * 0.4;
        poly(tg, pts);
        tg.fill();
      }
    }
    tg.globalAlpha = 0.9;
    tg.fillStyle = '#ffe0a0';
    tg.beginPath(); tg.ellipse(cx, cy, rx * 0.16, ry * 0.16, 0, 0, Math.PI * 2); tg.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(4px)';
    ctx.globalAlpha = alpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.filter = 'blur(26px)';
    ctx.globalAlpha = alpha * 0.8;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  };
  projectRose(g, W * 0.29, H * 0.79, W * 0.17, H * 0.075, 0.5, 0.75, 61);
  godRays(g, { x: W * 0.36, y: H * 0.3, w: H * 0.26 }, { x: W * 0.3, y: H * 0.79, w: W * 0.3, h: H * 0.1 }, pal, { alpha: 0.2, seed: 62 });
  const al = altar3d({ stone: '#e8cac0', runner: '#a01e2c', emblemC: '#f0c870', candles: 6, seed: 51 });
  const ppu = H * 0.78;
  prop3d(fg, al.f, W * 0.4, H * 1.04, ppu, lr, { shadowW: 0.5 });
  {
    // the window's colours on the altar's face (tinting only the stone that is there)
    fg.save();
    fg.globalCompositeOperation = 'source-atop';
    const gr = fg.createRadialGradient(W * 0.34, H * 0.9, 0, W * 0.34, H * 0.9, W * 0.16);
    gr.addColorStop(0, 'rgba(255,120,150,0.42)');
    gr.addColorStop(0.5, 'rgba(255,170,110,0.22)');
    gr.addColorStop(1, 'rgba(255,120,150,0)');
    fg.fillStyle = gr;
    fg.fillRect(0, 0, W, H);
    fg.restore();
  }
  waxCandles(fg, al.tips, W * 0.4, H * 1.04, ppu, 0, { pool: '#ffb878' });
  for (const t of al.tips) { const [x, y] = proj(W * 0.4, H * 1.04, ppu, t); lights.push({ x, y, s: 5, kind: 'candle', color: '#ffc880', front: true }); }
  return { ...rm, lights, motes: { color: '#ffc0c8', count: 70, rise: 0.04 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.4, y: H * 0.92, h: H * 0.74, pose: 'priest', yaw: 0.15, vestments: '#a01e2c' } };
}

/** A cheval glass: a gilt oval frame on a carved stand, the glass holding a soft reflection of the room. */
function sunesMirror(g, x, y, h, R) {
  const fw = h * 0.34;
  const fh = h * 0.6;
  const cy = y - h * 0.62;
  // stand: two turned posts and feet
  for (const d of [-1, 1]) {
    g.fillStyle = linGrad(g, x + d * fw * 0.62 - 5, 0, x + d * fw * 0.62 + 5, 0, [[0, '#f0c868'], [1, '#5a3a10']]);
    g.fillRect(x + d * fw * 0.6 - 4, cy - fh * 0.1, 8, y - cy + fh * 0.1);
    g.beginPath(); g.ellipse(x + d * fw * 0.6, y, 26, 7, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + d * fw * 0.6, cy - fh * 0.12, 7, 0, Math.PI * 2); g.fill();
  }
  // the glass: the room reflected — rose walls, a candle's bloom, a pale streak of window light
  g.save();
  g.beginPath();
  g.ellipse(x, cy, fw / 2, fh / 2, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = linGrad(g, x - fw / 2, cy - fh / 2, x + fw / 2, cy + fh / 2, [[0, '#e8c4bc'], [0.45, '#a8706a'], [1, '#4a2428']]);
  g.fillRect(x - fw, cy - fh, fw * 2, fh * 2);
  glow(g, x - fw * 0.15, cy - fh * 0.05, fw * 0.5, '#ffb070', 0.6, 'screen');
  g.fillStyle = '#fff4d8';
  g.fillRect(x - fw * 0.16, cy - fh * 0.08, 3, 10);
  g.globalCompositeOperation = 'screen';
  for (const [ox, wv, a] of [[-0.3, 0.12, 0.35], [-0.1, 0.05, 0.25]]) {
    g.fillStyle = `rgba(255,250,240,${a})`;
    g.beginPath();
    g.moveTo(x + fw * ox, cy - fh / 2);
    g.lineTo(x + fw * (ox + wv), cy - fh / 2);
    g.lineTo(x + fw * (ox + wv + 0.3), cy + fh / 2);
    g.lineTo(x + fw * (ox + 0.3), cy + fh / 2);
    g.fill();
  }
  g.restore();
  // gilt frame: a thick bevelled oval with a crest of roses
  for (const [lw, col] of [[fw * 0.16, '#4a2c0a'], [fw * 0.12, '#d8a848'], [fw * 0.04, '#fff0b8']]) {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.beginPath();
    g.ellipse(x, cy, fw / 2, fh / 2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.fillStyle = i % 2 ? '#f0d070' : '#a87a28';
    g.beginPath();
    g.arc(x + Math.cos(a) * fw / 2, cy + Math.sin(a) * fh / 2, fw * 0.035, 0, Math.PI * 2);
    g.fill();
  }
  for (const dx of [-0.12, 0, 0.12]) {
    g.fillStyle = '#b01828';
    g.beginPath(); g.arc(x + dx * fw, cy - fh / 2 - fw * 0.06, fw * 0.07, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,160,170,0.6)';
    g.beginPath(); g.arc(x + dx * fw - 2, cy - fh / 2 - fw * 0.08, fw * 0.03, 0, Math.PI * 2); g.fill();
  }
  glow(g, x, cy, fh * 0.7, '#ffd0c0', 0.18, 'screen');
  void R;
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
  return { ...rm, lights, motes: { color: '#ffa060', count: 70, rise: 0.35 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.5, y: H * 0.92, h: H * 0.78, pose: 'trainer', yaw: -0.1 } };
}

S.temple = (g, W, H, R, o) => {
  const d = o.deity ?? { name: 'Tyr', banner: '#1d3574', symbol: 'scales' };
  if (d.name === 'Sune') return templeSune(g, W, H, R, o, d);
  if (d.name === 'Tempus') return templeTempus(g, W, H, R, o, d);
  return templeTyr(g, W, H, R, o, d);
};

// ================================================================== Sokol Keep chapel (ruined, haunted)

S.chapel = (g, W, H, R, o) => {
  const rm = roomScene(g, W, H, R, { wall: '#4e4e56', wallKind: 'stone', floor: 'flags', floorColor: '#34343a', by0: 0.13, by1: 0.62, bx0: 0.31, bx1: 0.69, beams: false, damp: 0.85, moss: 0.9, ceiling: '#06070c', vault: { stone: '#3e3e48', hole: [0.62, 0.45, 0.14] } });
  const lights = [];
  const fg = o.fg ?? g;
  // the east lancet: Saint Ferran's vigil — a designed window, not a mosaic
  const wx = W * 0.44;
  const wy = H * 0.15;
  const ww = W * 0.12;
  const wh = H * 0.43;
  const east = stainedGlass('knight', ww, wh, { seed: 71, broken: 0.04 });
  drawGlass(g, east, wx, wy, { glowA: 0.4 });
  // side lancets carry the arms of Sokol Keep, receding down the nave; a few smashed
  const pools = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const t = persp(i / 3 + 0.1, 3);
      const x = s < 0 ? lerp(W * 0.05, W * 0.3, t) : lerp(W * 0.95, W * 0.7, t);
      const w = lerp(W * 0.065, W * 0.022, t);
      const top = lerp(H * 0.1, H * 0.12, t);
      const h = lerp(H * 0.5, H * 0.3, t);
      const c = stainedGlass('heraldry', Math.max(8, w), h, { seed: 80 + i + s * 10, broken: i === 1 ? 0.25 : 0.06, alt: (i + (s > 0 ? 1 : 0)) % 2 });
      drawGlass(g, c, x - w / 2, top, { glowA: 0.3 });
      if (i === 0) pools.push({ c, x, w, s });
    }
  }
  // the windows' light lying on the floor in their own colours
  const floorY = rm.by1;
  glassPool(g, east, { x: W * 0.42, y: floorY + H * 0.05, w: W * 0.16, h: H * 0.16, shear: -W * 0.02, alpha: 0.32 });
  for (const p of pools) glassPool(g, p.c, { x: p.s < 0 ? W * 0.14 : W * 0.66, y: floorY + H * 0.14, w: W * 0.2, h: H * 0.2, shear: p.s < 0 ? W * 0.16 : -W * 0.16, alpha: 0.3 });
  const pal = ['#1a3a8a', '#b01a24', '#e8b830', '#f2ecd8'];
  // moonlight shafts through the lancets
  godRays(g, { x: W * 0.12, y: H * 0.3, w: W * 0.08 }, { x: W * 0.3, y: H * 0.86, w: W * 0.24, h: H * 0.12 }, ['#4a6ad8', '#d83040', '#f0c040', '#c8d8ff'], { alpha: 0.12, seed: 73 });
  godRays(g, { x: W * 0.5, y: H * 0.3, w: W * 0.08 }, { x: W * 0.5, y: H * 0.74, w: W * 0.22, h: H * 0.08 }, pal, { alpha: 0.12, seed: 74 });
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
  waxCandles(g, al.tips, ax, ay, ppu, 0, { pool: '#ffb050' });
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
  return { ...rm, lights, motes: { color: '#aef4ff', count: 70, rise: 0.06 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.37, y: H * 0.96, h: H * 0.56, pose: 'vigil', yaw: 0.75, vigilYaw: 1.95, altar: [ax, ay] } };
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
    yardView(g, x, top, w, bot - top, i, R);
    g.restore();
    g.strokeStyle = '#4a3e30';
    g.lineWidth = 6;
    archPath(g, x, top, w, bot - top);
    g.stroke();
    lightShaft(g, x + w / 2, H * 0.4, w * 0.9, x + w / 2 - W * 0.12, H * 0.98, w * 1.6, '#fff4d8', 0.32);
  }
  // the sand floor of the hall: raked lines, scuffed circles where pairs have sparred, footprints
  for (let k = 0; k < 9; k++) {
    const y = lerp(rm.by1, H, persp((k + 1) / 10, 2));
    g.strokeStyle = 'rgba(90,70,40,0.18)';
    g.lineWidth = 1 + k * 0.2;
    g.beginPath(); g.moveTo(0, y + Math.sin(k) * 3); g.bezierCurveTo(W * 0.3, y - 4, W * 0.7, y + 5, W, y); g.stroke();
  }
  for (const [x, y, r] of [[0.55, 0.82, 0.12], [0.3, 0.9, 0.09]]) {
    g.strokeStyle = 'rgba(70,52,30,0.22)';
    g.lineWidth = 6;
    g.beginPath(); g.ellipse(W * x, H * y, W * r, H * r * 0.28, 0, 0, Math.PI * 2); g.stroke();
  }
  for (let k = 0; k < 40; k++) {
    const fx = W * (0.25 + R() * 0.6);
    const fy = H * (0.72 + R() * 0.26);
    const sc = (fy / H - 0.6) * 1.6;
    g.fillStyle = 'rgba(60,44,24,0.28)';
    g.beginPath(); g.ellipse(fx, fy, 5 * sc, 2.2 * sc, R() * 3, 0, Math.PI * 2); g.fill();
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
  return { ...rm, lights, motes: { color: '#fff0c8', count: 80, rise: 0.02 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.42, y: H * 1.02, h: H * 0.74, pose: 'trainer', yaw: 0.2 } };
};

/**
 * Floor-to-ceiling shelves of ledgers along a side wall, drawn in the wall's own
 * perspective (quad = the wall's [far-top, near-top, near-bottom, far-bottom]).
 */
function wallBookcase(g, quad, u0, u1, v0, v1, R) {
  const Q = (u, v) => quadPt(quad, u, v);
  const shelves = 6;
  // carcass
  g.fillStyle = '#24160c';
  poly(g, [Q(u0, v0), Q(u1, v0), Q(u1, v1), Q(u0, v1)]);
  g.fill();
  const cols = 34;
  for (let sh = 0; sh < shelves; sh++) {
    const va = lerp(v0, v1, sh / shelves) + 0.012;
    const vb = lerp(v0, v1, (sh + 1) / shelves) - 0.006;
    for (let c = 0; c < cols; c++) {
      const ua = lerp(u0, u1, persp(c / cols, 1.2));
      const ub = lerp(u0, u1, persp((c + 0.85) / cols, 1.2));
      if (R() < 0.08) continue; // gaps where volumes are out
      const top = vb - (vb - va) * (0.62 + R() * 0.34);
      const col = R.pick ? R.pick(['#5a1a14', '#2a3a5a', '#3a4a2a', '#6a4a20', '#4a2a3a', '#7a5a3a', '#2a2a2a']) : '#5a1a14';
      g.fillStyle = rgba(col, 1, 0.75 + R() * 0.5);
      poly(g, [Q(ua, top), Q(ub, top), Q(ub, vb), Q(ua, vb)]);
      g.fill();
      // a gilt band on the spine
      if (R() < 0.5) {
        const bv = top + (vb - top) * 0.25;
        g.fillStyle = 'rgba(216,178,90,0.55)';
        poly(g, [Q(ua, bv), Q(ub, bv), Q(ub, bv + 0.006), Q(ua, bv + 0.006)]);
        g.fill();
      }
    }
    // the shelf board
    g.fillStyle = '#4a2e18';
    poly(g, [Q(u0, vb), Q(u1, vb), Q(u1, vb + 0.014), Q(u0, vb + 0.014)]);
    g.fill();
  }
  // uprights
  for (const u of [u0, (u0 + u1) / 2, u1]) {
    const ua = u - 0.012; const ub = u + 0.012;
    g.fillStyle = '#3a2412';
    poly(g, [Q(ua, v0), Q(ub, v0), Q(ub, v1), Q(ua, v1)]);
    g.fill();
  }
  // shadow deepening into the far corner
  g.fillStyle = linGrad(g, Q(u0, 0.5)[0], 0, Q(u1, 0.5)[0], 0, [[0, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0.1)']]);
  poly(g, [Q(u0, v0), Q(u1, v0), Q(u1, v1), Q(u0, v1)]);
  g.fill();
}

/** The sunlit yard seen through an arch: sky with cloud, a crenellated yard wall, a real tree, a pell. */
function yardView(g, x, y, w, h, i, R) {
  const hz = y + h * 0.56;
  g.fillStyle = linGrad(g, 0, y, 0, hz, [[0, '#6a9ad0'], [0.7, '#b8d0e8'], [1, '#e8eef0']]);
  g.fillRect(x, y, w, hz - y);
  // clouds: soft lobes lit from above
  for (let k = 0; k < 3; k++) {
    const cx = x + w * (0.2 + R() * 0.7);
    const cy = y + h * (0.12 + R() * 0.2);
    for (let j = 0; j < 5; j++) {
      const rr = w * (0.06 + R() * 0.08);
      const gr = g.createRadialGradient(cx + (j - 2) * rr * 0.7, cy - rr * 0.3, 1, cx + (j - 2) * rr * 0.7, cy, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(230,236,245,0)');
      g.fillStyle = gr;
      g.fillRect(cx - rr * 3, cy - rr * 2, rr * 6, rr * 3);
    }
  }
  // New Phlan beyond the yard: steep roofs and a watch-tower with the Council's pennant
  {
    const ry = hz - h * 0.12;
    for (let k = 0; k < 4; k++) {
      const rx = x + w * (k / 4) + (R() - 0.5) * w * 0.05;
      const rw = w * (0.22 + R() * 0.1);
      const rh = h * (0.05 + R() * 0.05);
      g.fillStyle = k % 2 ? '#8a6a5a' : '#7a5a4c';
      poly(g, [[rx, ry], [rx + rw / 2, ry - rh], [rx + rw, ry]]);
      g.fill();
      g.fillStyle = 'rgba(255,240,220,0.18)';
      poly(g, [[rx, ry], [rx + rw / 2, ry - rh], [rx + rw * 0.5, ry]]);
      g.fill();
    }
    if (i === 2) {
      const tx2 = x + w * 0.7;
      g.fillStyle = '#a89878';
      g.fillRect(tx2 - w * 0.05, ry - h * 0.2, w * 0.1, h * 0.2);
      g.fillStyle = '#6a4a3a';
      poly(g, [[tx2 - w * 0.065, ry - h * 0.2], [tx2, ry - h * 0.29], [tx2 + w * 0.065, ry - h * 0.2]]);
      g.fill();
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(tx2, ry - h * 0.29); g.lineTo(tx2, ry - h * 0.36); g.stroke();
      g.fillStyle = '#1d3574';
      poly(g, [[tx2, ry - h * 0.36], [tx2 + w * 0.12, ry - h * 0.345], [tx2, ry - h * 0.325]]);
      g.fill();
    }
  }
  // far yard wall with crenels, shaded stone
  const wy = hz - h * 0.12;
  g.fillStyle = linGrad(g, 0, wy, 0, hz, [[0, '#c8b898'], [1, '#9a8a6a']]);
  g.fillRect(x, wy, w, hz - wy);
  for (let k = 0; k < 8; k++) g.fillRect(x + (k / 8) * w, wy - h * 0.035, w / 16, h * 0.036);
  g.fillStyle = 'rgba(60,50,30,0.25)';
  for (let k = 0; k < 6; k++) g.fillRect(x, wy + (k / 6) * (hz - wy), w, 1);
  // sand of the yard, raked and scuffed
  g.fillStyle = linGrad(g, 0, hz, 0, y + h, [[0, '#d8c090'], [1, '#b89a68']]);
  g.fillRect(x, hz, w, y + h - hz);
  g.strokeStyle = 'rgba(120,90,50,0.25)';
  for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x, hz + (k + 1) * h * 0.05); g.lineTo(x + w, hz + (k + 1) * h * 0.06); g.stroke(); }
  if (i !== 1) {
    // wooden stands against the yard wall, a few onlookers watching the bouts
    const sy = hz + h * 0.005;
    for (let tier = 0; tier < 3; tier++) {
      const ty = sy - tier * h * 0.035;
      g.fillStyle = tier % 2 ? '#7a5a38' : '#8a6a44';
      g.fillRect(x, ty - h * 0.008, w, h * 0.016);
      g.fillStyle = 'rgba(40,24,10,0.45)';
      g.fillRect(x, ty + h * 0.008, w, h * 0.004);
      for (let k = 0; k < 7; k++) {
        if (R() < 0.35) continue;
        const px = x + w * (0.06 + k * 0.14 + (R() - 0.5) * 0.05);
        const cc = ['#7a2a1e', '#2a3a6a', '#5a5a2a', '#6a4a2a', '#3a5a4a', '#8a7a5a'][Math.floor(R() * 6)];
        g.fillStyle = cc;
        g.beginPath(); g.ellipse(px, ty - h * 0.018, w * 0.028, h * 0.016, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = ['#d8a888', '#c08a6a', '#a87050'][Math.floor(R() * 3)];
        g.beginPath(); g.arc(px, ty - h * 0.04, w * 0.016, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // a split-rail fence round the sparring ring
  {
    const fy = hz + h * 0.16;
    g.fillStyle = '#5a4028';
    for (let k = 0; k < 6; k++) {
      const px = x + w * (0.05 + k * 0.19);
      g.fillRect(px - w * 0.012, fy - h * 0.06, w * 0.024, h * 0.065);
    }
    g.fillStyle = '#7a5a38';
    g.fillRect(x, fy - h * 0.05, w, h * 0.008);
    g.fillRect(x, fy - h * 0.025, w, h * 0.007);
    g.fillStyle = 'rgba(255,240,210,0.3)';
    g.fillRect(x, fy - h * 0.05, w, h * 0.002);
  }
  if (i === 1) {
    // a plane tree in the yard: trunk with branches, foliage built of lit clusters
    const tx = x + w * 0.62;
    const tb = hz + h * 0.02;
    g.strokeStyle = '#4a3624';
    g.lineCap = 'round';
    g.lineWidth = w * 0.06;
    g.beginPath(); g.moveTo(tx, tb); g.lineTo(tx - w * 0.02, tb - h * 0.2); g.stroke();
    g.lineWidth = w * 0.025;
    for (const [dx, dy] of [[-0.14, -0.3], [0.12, -0.32], [0.02, -0.38]]) { g.beginPath(); g.moveTo(tx - w * 0.02, tb - h * 0.18); g.lineTo(tx + w * dx, tb + h * dy); g.stroke(); }
    // canopy: irregular lobes of thousands of leaf dabs, dark in the core and under the lobes,
    // sunlit on the upper left, with sky holes and a ragged silhouette (no green balls)
    const lobes = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + R() * 0.5;
      lobes.push([tx + Math.cos(a) * w * 0.13 * (0.6 + R() * 0.5), tb - h * 0.34 + Math.sin(a) * h * 0.09 * (0.6 + R() * 0.5), w * (0.07 + R() * 0.04)]);
    }
    lobes.push([tx, tb - h * 0.36, w * 0.11]);
    const leafC = ['#1e3418', '#2c4a22', '#3e6430', '#5a8040', '#86a85a', '#b0c878'];
    for (let pass = 0; pass < 3; pass++) {
      for (const [lx, ly, lr2] of lobes) {
        const nn = 140;
        for (let k = 0; k < nn; k++) {
          const a = R() * Math.PI * 2;
          const rr = Math.sqrt(R()) * lr2;
          const cx = lx + Math.cos(a) * rr;
          const cy = ly + Math.sin(a) * rr * 0.8;
          // light: up-left of the lobe is lit; each later pass sits on top and is brighter
          const lit = Math.max(0, Math.min(1, 0.5 - ((cx - lx) / lr2) * 0.35 - ((cy - ly) / lr2) * 0.45 + pass * 0.18 + (R() - 0.5) * 0.35));
          if (pass === 2 && lit < 0.55) continue;
          const ci = Math.min(leafC.length - 1, Math.floor(lit * leafC.length));
          g.fillStyle = leafC[ci];
          g.globalAlpha = 0.85;
          g.beginPath();
          g.ellipse(cx, cy, w * (0.006 + R() * 0.006), w * (0.003 + R() * 0.003), R() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
    // a few sky holes punched through the canopy
    for (let k = 0; k < 7; k++) { g.fillStyle = 'rgba(200,220,240,0.55)'; g.beginPath(); g.arc(tx + (R() - 0.5) * w * 0.26, tb - h * 0.34 + (R() - 0.5) * h * 0.14, w * 0.005, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(40,50,30,0.3)';
    g.beginPath(); g.ellipse(tx + w * 0.05, tb + h * 0.02, w * 0.22, h * 0.025, 0, 0, Math.PI * 2); g.fill();
  } else {
    // a pell post scarred by practice blows
    const px = x + w * (i === 0 ? 0.4 : 0.55);
    g.fillStyle = linGrad(g, px - 5, 0, px + 5, 0, [[0, '#8a6a44'], [1, '#4a3420']]);
    g.fillRect(px - w * 0.03, hz - h * 0.2, w * 0.06, h * 0.22);
    g.fillStyle = 'rgba(30,20,10,0.4)';
    for (let k = 0; k < 4; k++) g.fillRect(px - w * 0.03, hz - h * (0.05 + k * 0.04), w * 0.06, 1.5);
    g.fillStyle = 'rgba(40,30,20,0.3)';
    g.beginPath(); g.ellipse(px + w * 0.04, hz + h * 0.02, w * 0.1, h * 0.012, 0, 0, Math.PI * 2); g.fill();
  }
  // haze of sunlight
  g.fillStyle = 'rgba(255,248,230,0.12)';
  g.fillRect(x, y, w, h);
}

// ================================================================== taverns

S.tavern = (g, W, H, R, o) => {
  const fg = o.fg ?? g;
  const rm = roomScene(g, W, H, R, { wall: '#6a4e34', wallKind: 'plaster', wainscot: '#3a2414', floor: 'boards', floorColor: '#3e2a18', bx0: 0.06, bx1: 0.56, by0: 0.12, by1: 0.64, soot: [{ x: W * 0.25, y: H * 0.64 - 150, r: 120, a: 0.7 }, { x: W * 0.18, y: H * 0.16, r: 60, a: 0.4 }, { x: W * 0.45, y: H * 0.16, r: 60, a: 0.4 }] });
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
  lights.push({ x: hx, y: hy - 16, s: 46, kind: 'flame', color: '#ff7a20' });
  lights.push({ x: hx - 22, y: hy - 8, s: 30, kind: 'flame', color: '#ff9a30' });
  glow(g, hx, hy - 30, 640, '#ff7a20', 0.42);
  glowEllipse(g, hx, hy + 80, 640, 150, '#ff8a30', 0.38);
  // logs and a bed of embers in the hearth mouth
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#3a2010' : '#2a160a'; g.save(); g.translate(hx + (i - 1.5) * 16, hy - 10); g.rotate((i - 1.5) * 0.25); g.fillRect(-26, -5, 52, 10); g.restore(); }
  glowEllipse(g, hx, hy - 8, 52, 12, '#ffb040', 0.7, 'screen');
  g.fillStyle = '#2a1a0e';
  g.fillRect(hx - 120, hy - 150, 240, 14);
  // the mantel: pewter plates, a jug and a hanging ham catch the firelight
  g.fillStyle = '#3a2414';
  g.fillRect(hx - 130, hy - 158, 260, 10);
  for (let i = 0; i < 5; i++) {
    const px = hx - 100 + i * 50;
    g.fillStyle = linGrad(g, px - 14, hy - 200, px + 14, hy - 160, [[0, '#d8d0c0'], [1, '#5a5650']]);
    g.beginPath(); g.ellipse(px, hy - 178, 13, 18, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,20,10,0.6)'; g.lineWidth = 2; g.stroke();
  }
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
  // the room the prose promises: an old sailor by the fire, a dwarf and a halfling at dice,
  // two off-duty watchmen arguing over the Slum Wall (o.cast picks who is in tonight)
  const cast = o.cast ?? ['dice', 'watch', 'sailor'];
  // the fire is the room's key: it falls off with distance, and the lanterns give a dim warm fill
  // from the front so nobody is a black cut-out against the bar
  const fireRig = (x) => {
    const dx = Math.abs(x * W - hx) / W;
    const k = Math.max(0.35, 1 - dx * 1.6);
    return rig({ key: [x * W < hx ? 0.85 : -0.85, 0.28, 0.42], keyC: '#ff9038', keyI: 1.1 + 1.3 * k, rimC: '#ffb060', rim: [x * W < hx ? -0.6 : 0.6, 0.4, -0.6], rimI: 1.0, amb: 0.36, sky: '#4a3424', ground: '#3a1e0c', fill: { dir: [0.25, 0.45, 0.85], color: '#ffb878', i: 0.55 } });
  };
  const lrFire = fireRig(0.2);
  const person = (spec, x, y, hh, yaw, haze = 0) => {
    const short = spec.race === 'dwarf' || spec.race === 'halfling';
    const lrFire = fireRig(x);
    const bn = buildNpc({ seed: spec.seed, race: spec.race ?? 'human', gender: spec.gender ?? 'male', age: spec.age ?? 0.2, build: spec.build ?? 1, skin: spec.skin ?? '#c58c62', hair: spec.hair ?? '#3a2416', hairStyle: spec.hairStyle ?? 'short', beard: spec.beard ?? 'none', eyeC: '#3a2a1a', pose: spec.pose, outfit: spec.outfit, belly: spec.belly });
    const r = renderFigure(bn.fig, { ppu: (H * hh * (short ? (spec.race === 'halfling' ? 0.62 : 0.76) : 1)) / bn.top, yaw, rig: lrFire, pitch: 0.12, ink: 0.7, haze, hazeColor: '#2a1a10', ss: 1.25 });
    if (!r) return;
    contactShadow(g, W * x, H * y, H * hh * 0.17, H * hh * 0.03, 0.55);
    g.drawImage(r.canvas, W * x - r.ox, H * y - r.oy);
  };
  if (cast.includes('sailor')) {
    // Old Tam on a stool at the fire, mug in hand
    const st = new Figure();
    st.cone([0, 0.2, 0], [0, 0.23, 0], 0.11, 0.11, M.wood, { group: null });
    for (let i = 0; i < 3; i++) { const a = i * 2.1; st.cone([Math.cos(a) * 0.07, 0.2, Math.sin(a) * 0.07], [Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11], 0.012, 0.012, M.darkWood, { group: null }); }
    prop3d(g, st, W * 0.105, H * 0.83, H * 0.46, lrFire, { yaw: 0.3, shadowW: 0.25 });
    person({ seed: 31, age: 0.85, skin: '#b07a58', hair: '#e0dcd4', hairStyle: 'bald', beard: 'full', pose: 'sit', outfit: { shirt: '#c8bca4', top: '#24344e', topKind: 'jerkin', sleeves: 'rolled', trousers: '#3a3a40', boots: '#1e1810', sash: '#7a1a1a' } }, 0.105, 0.86, 0.46, 0.95);
  }
  if (cast.includes('watch')) {
    // two watchmen in the Watch's blue tabards, toe to toe
    const tab = (seed, top) => ({ seed, outfit: { shirt: '#4a4a5a', top, topKind: 'tabard', symbol: 'tower', sleeves: 'long', trousers: '#2a2a30', boots: '#1a1410', belt: '#2a1a0e' } });
    // a stride apart: one jabs a finger and leans in, the other rocks back with his palms up
    person({ ...tab(41, '#1d3574'), hair: '#5a3a1e', beard: 'moustache', pose: 'argue' }, 0.352, 0.745, 0.44, 1.0, 0.12);
    person({ ...tab(43, '#22407e'), age: 0.5, hair: '#2a1a10', beard: 'full', build: 1.1, belly: true, pose: 'rebuff' }, 0.478, 0.752, 0.45, -0.95, 0.12);
  }
  if (cast.includes('sailors')) {
    person({ seed: 51, age: 0.5, skin: '#a87050', hair: '#1a1210', beard: 'full', pose: 'folded', outfit: { shirt: '#b8ac94', top: '#2a3040', topKind: 'jerkin', sleeves: 'rolled', trousers: '#2a2a30', boots: '#1a1410' } }, 0.12, 0.84, 0.5, 0.7);
    person({ seed: 53, age: 0.3, skin: '#c08a66', hair: '#6a3a1a', beard: 'stubble', pose: 'argue', outfit: { shirt: '#d0c4a8', top: '#5a2a1a', topKind: 'jerkin', sleeves: 'rolled', trousers: '#3a3024', boots: '#1e1810' } }, 0.42, 0.76, 0.44, -0.8, 0.12);
  }
  if (cast.includes('dice')) {
    // a dwarf and a halfling hunched over dice at a trestle table in the foreground
    person({ seed: 61, race: 'dwarf', age: 0.4, skin: '#c8906a', hair: '#8a3a1a', hairStyle: 'short', beard: 'long', build: 1.1, pose: 'lean', outfit: { shirt: '#6a5a3a', top: '#4a3020', topKind: 'jerkin', sleeves: 'long', trousers: '#3a3024', boots: '#24180e', belt: '#2a1a0e' } }, 0.175, 0.97, 0.66, 0.85);
    person({ seed: 63, race: 'halfling', age: 0.2, skin: '#e0b090', hair: '#5a3a1a', hairStyle: 'short', beard: 'none', pose: 'lean', outfit: { shirt: '#e0d4b8', top: '#3a6a3a', topKind: 'doublet', sleeves: 'rolled', trousers: '#5a4a2a', boots: '#3a2416' } }, 0.335, 0.97, 0.66, -0.85);
    const tb = new Figure();
    tb.box([0, 0.3, 0], [0.26, 0.016, 0.12], M.wood, { group: null, bevel: 0.006 });
    for (const dx of [-0.22, 0.22]) tb.box([dx, 0.15, 0], [0.016, 0.15, 0.1], M.darkWood, { group: null, bevel: 0.006 });
    tb.box([0, 0.08, 0], [0.22, 0.012, 0.012], M.darkWood, { group: null, bevel: 0.004 });
    const bone = mat('#efe6cc', { rough: 0.5, spec: 0.3 });
    for (const [dx, dz, a] of [[-0.03, 0.03, 0.4], [0.02, 0.05, 1.1], [0.06, 0.0, 0.2]]) tb.box([dx, 0.326, dz], [0.011, 0.011, 0.011], bone, { group: null, bevel: 0.003, R: rotY(a) });
    for (const [dx, dz] of [[-0.18, -0.02], [0.17, 0.04]]) {
      tb.cone([dx, 0.316, dz], [dx, 0.37, dz], 0.024, 0.022, M.darkWood, { group: null });
      tb.ell([dx, 0.37, dz], [0.022, 0.006, 0.022], mat('#f0e4c8', { rough: 0.9 }), { group: null });
    }
    for (let i = 0; i < 6; i++) tb.cone([-0.09 + i * 0.012, 0.318, -0.05], [-0.09 + i * 0.012, 0.322, -0.05], 0.009, 0.009, M.gold, { group: null });
    prop3d(g, tb, W * 0.255, H * 1.0, H * 0.78, lrFire, { yaw: 0.05, shadowW: 0.55, shadowA: 0.6 });
  }
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
    prop3d(fg, f, W * x, top + 4 - (x - 0.5) * 30, H * 0.42 * s, lrBar, { shadowW: 0.09 });
  }
  return { ...rm, lights, motes: { color: '#ffc880', count: 35, rise: 0.15 }, floorY: rm.by1, fgUsed: true, actorSlot: { x: W * 0.73, y: H * 0.92, h: H * 0.8, pose: 'barkeep', yaw: -0.35 } };
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
  return { ...info, fgUsed: true, actorSlot: { x: W * 0.46, y: H * 0.92, h: H * 0.74, pose: 'barkeep', yaw: 0.2 } };
};

const oldCurio = S.curio;
S.curio = (g, W, H, R, o) => {
  const info = oldCurio(g, W, H, R, o);
  return { ...info, fgUsed: false, actorSlot: null };
};

void toHex; void alignY;
