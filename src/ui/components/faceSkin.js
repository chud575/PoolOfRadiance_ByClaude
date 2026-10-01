import { faceLayout } from './figureRig.js';
import { rngFrom, hashNum } from './lookData.js';

/**
 * The painted face of a sculpted head: irises with catch-lights, lash lines,
 * brows set by the expression, lip colour, cheek blush, eye-socket glaze,
 * age lines, stubble and scars — painted as a front projection in head-local
 * space (x ∈ ±0.11, y ∈ −0.13…0.11 m at human scale) so it registers with
 * the sculpt's features (figureRig.faceLayout). Transparent where nothing is
 * painted, so the vertex-painted skin shows through.
 */

export const FACE_BOX = { x0: -0.11, x1: 0.11, y0: -0.13, y1: 0.11 };

const hexRGB = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const rgba = (c, a = 1, k = 1) => {
  const [r, g, b] = Array.isArray(c) ? c : hexRGB(c);
  return `rgba(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))},${a})`;
};

/**
 * @param {ReturnType<import('./lookData.js').resolveAppearance>} app
 * @param {{size?: number, asleep?: boolean}} [o]
 * @returns {HTMLCanvasElement}
 */
export function paintFaceSkin(app, o = {}) {
  const S = o.size ?? 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  let g = c.getContext('2d', { willReadFrequently: true });
  const F = faceLayout(app);
  const R = rngFrom(hashNum(app.seed, app.look.head, 'face'));
  const X = (x) => ((x - FACE_BOX.x0) / (FACE_BOX.x1 - FACE_BOX.x0)) * S;
  const Y = (y) => (1 - (y - FACE_BOX.y0) / (FACE_BOX.y1 - FACE_BOX.y0)) * S;
  const U = S / 0.22; // px per metre
  const skin = hexRGB(app.skinHex);
  const hair = hexRGB(app.hairHex);
  const dark = [Math.round(skin[0] * 0.45), Math.round(skin[1] * 0.3), Math.round(skin[2] * 0.26)];
  const browCol = app.age >= 0.9 ? [200, 196, 188] : hair.map((v) => Math.round(v * 0.82));
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Soft glazes: paint at low resolution and upscale (a cheap blur; canvas
  // filters are very slow in software rendering).
  const soft = (blur, fn) => {
    const f = Math.max(2, Math.min(16, 2 ** Math.round(Math.log2(Math.max(1, blur * 1.5)))));
    const w = Math.ceil(S / f);
    const sc2 = document.createElement('canvas');
    sc2.width = w;
    sc2.height = w;
    const g2 = sc2.getContext('2d', { willReadFrequently: true });
    g2.scale(1 / f, 1 / f);
    const g0 = g;
    g = g2;
    fn();
    g = g0;
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(sc2, 0, 0, S, S);
    g.restore();
  };
  const ell = (x, y, rx, ry, rot = 0) => {
    g.beginPath();
    g.ellipse(X(x), Y(y), Math.max(0.5, rx * U), Math.max(0.5, ry * U), rot, 0, Math.PI * 2);
  };

  const { ex, eyeY, er } = F;
  const fp = F.fp;
  // ---- painter's colour zones: warm ochre brow, ruddy cheeks/nose/ears, cool jaw.
  soft(S / 40, () => {
    g.fillStyle = 'rgba(214,170,96,0.16)';
    ell(0, 0.055, 0.06, 0.035);
    g.fill();
    g.fillStyle = `rgba(196,74,58,${app.fem ? 0.2 : 0.16})`;
    ell(0, -0.018, 0.05, 0.022);
    g.fill();
    for (const sg of [-1, 1]) { ell(sg * 0.07, 0.0, 0.01, 0.03); g.fill(); }
    if (!app.fem) {
      g.fillStyle = 'rgba(70,96,96,0.13)';
      ell(0, -0.088, 0.05, 0.028);
      g.fill();
    }
    g.fillStyle = 'rgba(90,40,70,0.12)';
    for (const sg of [-1, 1]) { ell(sg * ex, eyeY + 0.004, 0.02, 0.012); g.fill(); }
  });
  // Shadow under the cheekbones (models the face like a painter would).
  soft(S / 70, () => {
    for (const sg of [-1, 1]) {
      g.fillStyle = rgba(dark, 0.14 + (fp.cheek - 1) * 0.15);
      ell(sg * 0.05, -0.042, 0.012, 0.022, sg * 0.4);
      g.fill();
    }
  });
  // ---- glazes: eye sockets, cheeks, lips area, temples
  soft(S / 90, () => {
    for (const sg of [-1, 1]) {
      g.fillStyle = rgba(dark, 0.32);
      ell(sg * ex, eyeY + 0.008, 0.019, 0.011);
      g.fill();
      g.fillStyle = rgba([200, 90, 80], app.fem ? 0.2 : 0.13);
      ell(sg * 0.046, -0.028, 0.02, 0.014);
      g.fill();
      // Temple shadow.
      g.fillStyle = rgba(dark, 0.12);
      ell(sg * 0.068, 0.03, 0.012, 0.03);
      g.fill();
    }
    // Nose tip warmth and under-nose shadow.
    g.fillStyle = rgba([190, 90, 80], 0.14);
    ell(0, F.tipY + 0.002, 0.01, 0.009);
    g.fill();
    g.fillStyle = rgba(dark, 0.22);
    ell(0, F.tipY - 0.012, 0.012, 0.004);
    g.fill();
  });

  // ---- eyes
  for (const sg of [-1, 1]) {
    const cx = sg * ex;
    if (o.asleep) {
      g.strokeStyle = rgba(dark, 0.85);
      g.lineWidth = 0.0016 * U;
      g.beginPath();
      g.moveTo(X(cx - 0.012), Y(eyeY - 0.001));
      g.quadraticCurveTo(X(cx), Y(eyeY - 0.005), X(cx + 0.012), Y(eyeY - 0.001));
      g.stroke();
      continue;
    }
    // The eye opening is painted: an almond of eye-white and iris, with skin
    // painted over the rest of the eyeball so its curvature reads as lids.
    const droop = fp.lid * 0.0022;
    const slant = fp.slant * 0.0018;
    const op = (app.race === 'elf' ? 0.0044 : 0.0052) * (fp.eye ** 0.5);
    const inner = [cx - sg * 0.0118, eyeY - 0.0006];
    const outer = [cx + sg * 0.0128, eyeY + 0.0006 + slant];
    const almond = () => {
      g.beginPath();
      g.moveTo(X(inner[0]), Y(inner[1]));
      g.bezierCurveTo(X(cx - sg * 0.006), Y(eyeY + op - droop + 0.0012), X(cx + sg * 0.005), Y(eyeY + op - droop + 0.0012 + slant), X(outer[0]), Y(outer[1]));
      g.bezierCurveTo(X(cx + sg * 0.006), Y(eyeY - op * 0.85 + slant * 0.4), X(cx - sg * 0.005), Y(eyeY - op * 0.95), X(inner[0]), Y(inner[1]));
      g.closePath();
    };
    // Lids: skin over the eyeball, a little darker and cooler in the socket.
    const lidC = [Math.round(skin[0] * 0.74), Math.round(skin[1] * 0.66), Math.round(skin[2] * 0.66)];
    const lg = g.createRadialGradient(X(cx), Y(eyeY), 0, X(cx), Y(eyeY), 0.0158 * U);
    lg.addColorStop(0, rgba(lidC, 1));
    lg.addColorStop(0.72, rgba(lidC, 1));
    lg.addColorStop(1, rgba(lidC, 0));
    g.fillStyle = lg;
    ell(cx, eyeY, 0.0158, 0.0158);
    g.fill();
    soft(S / 300, () => {
      g.fillStyle = rgba([90, 50, 60], 0.22);
      ell(cx, eyeY + 0.006, 0.0148, 0.006);
      g.fill();
    });
    g.save();
    almond();
    g.clip();
    const wy = g.createLinearGradient(0, Y(eyeY + op), 0, Y(eyeY - op));
    wy.addColorStop(0, 'rgb(150,132,120)');
    wy.addColorStop(0.45, 'rgb(222,212,196)');
    wy.addColorStop(1, 'rgb(205,192,178)');
    g.fillStyle = wy;
    g.fillRect(X(cx - 0.016), Y(eyeY + 0.01), 0.032 * U, 0.02 * U);
    const look = -0.0004; // eyes on the viewer
    const ir = er * 0.56;
    const ix = cx + look;
    const iy = eyeY + 0.0008;
    const grd = g.createRadialGradient(X(ix), Y(iy), 0, X(ix), Y(iy), ir * U);
    const ec = hexRGB(app.eyeHex);
    grd.addColorStop(0, rgba(ec, 1, 1.35));
    grd.addColorStop(0.5, rgba(ec, 1, 1.05));
    grd.addColorStop(0.85, rgba(ec, 1, 0.6));
    grd.addColorStop(1, rgba([24, 18, 14], 1));
    g.fillStyle = grd;
    ell(ix, iy, ir, ir);
    g.fill();
    g.fillStyle = 'rgba(8,6,6,1)';
    ell(ix, iy, ir * 0.4, ir * 0.4);
    g.fill();
    // The upper lid's shadow across the eye.
    const sh = g.createLinearGradient(0, Y(eyeY + op), 0, Y(eyeY));
    sh.addColorStop(0, 'rgba(30,18,14,0.34)');
    sh.addColorStop(1, 'rgba(30,18,14,0)');
    g.fillStyle = sh;
    g.fillRect(X(cx - 0.016), Y(eyeY + 0.01), 0.032 * U, 0.01 * U);
    g.fillStyle = 'rgba(255,250,240,0.9)';
    ell(ix - ir * 0.32, iy + ir * 0.3, ir * 0.18, ir * 0.18);
    g.fill();
    g.restore();
    // Lash line along the upper lid (heavier at the outer corner), soft lower lid line.
    g.strokeStyle = rgba([26, 15, 10], app.fem ? 0.95 : 0.88);
    g.lineWidth = (app.fem ? 0.0016 : 0.0013) * U;
    g.beginPath();
    g.moveTo(X(inner[0]), Y(inner[1]));
    g.bezierCurveTo(X(cx - sg * 0.006), Y(eyeY + op - droop + 0.0012), X(cx + sg * 0.005), Y(eyeY + op - droop + 0.0012 + slant), X(outer[0]), Y(outer[1]));
    g.stroke();
    if (app.fem) {
      g.beginPath();
      g.moveTo(X(outer[0] - sg * 0.002), Y(outer[1] + 0.0004));
      g.lineTo(X(outer[0] + sg * 0.0028), Y(outer[1] + 0.0022));
      g.stroke();
    }
    g.strokeStyle = rgba(dark, 0.45);
    g.lineWidth = 0.0007 * U;
    g.beginPath();
    g.moveTo(X(inner[0]), Y(inner[1]));
    g.bezierCurveTo(X(cx - sg * 0.005), Y(eyeY - op * 0.95), X(cx + sg * 0.006), Y(eyeY - op * 0.85 + slant * 0.4), X(outer[0]), Y(outer[1]));
    g.stroke();
    // Tear duct and the lid crease.
    g.fillStyle = rgba([180, 96, 88], 0.7);
    ell(inner[0] + sg * 0.0012, inner[1], 0.0014, 0.0011);
    g.fill();
    g.strokeStyle = rgba(dark, 0.32);
    g.lineWidth = 0.0008 * U;
    g.beginPath();
    g.moveTo(X(cx - sg * 0.0105), Y(eyeY + 0.0042));
    g.quadraticCurveTo(X(cx), Y(eyeY + 0.0098 - droop * 0.5), X(cx + sg * 0.0132), Y(eyeY + 0.0045 + slant));
    g.stroke();
    // Under-eye shadow.
    soft(S / 200, () => {
      g.fillStyle = rgba(dark, 0.18 + app.age * 0.12);
      ell(cx + sg * 0.001, eyeY - 0.0068, 0.0105, 0.0022);
      g.fill();
    });
  }

  // ---- brows: strokes of hair along an arc shaped by the expression
  const tilt = F.browTilt;
  for (const sg of [-1, 1]) {
    const mass = fp.brow * (app.fem ? 0.75 : 1);
    const inner = [sg * (ex - 0.013), 0.0215 - tilt * 0.012 + (app.expr === 'proud' ? 0.002 : 0)];
    const peak = [sg * (ex + 0.002), 0.0262 - tilt * 0.002 + (app.fem ? 0.0015 : 0)];
    const outer = [sg * (ex + 0.0175), 0.0215 + tilt * 0.006 - (app.expr === 'weary' ? 0.004 : 0)];
    const at = (t) => {
      const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), cc = t * t;
      return [inner[0] * a + peak[0] * b + outer[0] * cc, inner[1] * a + peak[1] * b + outer[1] * cc];
    };
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = at(t + (R() - 0.5) * 0.04);
      const th = (0.0034 - t * 0.0018) * mass;
      const off = (R() - 0.5) * th;
      const ang = (sg > 0 ? 0 : Math.PI) + (0.5 - t) * 0.9 * sg + (R() - 0.5) * 0.3;
      const l = (0.0028 + R() * 0.0022) * mass;
      g.strokeStyle = rgba(browCol, (0.18 + R() * 0.3) * (app.fem ? 0.85 : 1));
      g.lineWidth = Math.max(0.6, (0.00045 + R() * 0.0004) * U);
      g.beginPath();
      g.moveTo(X(p[0]), Y(p[1] + off));
      g.lineTo(X(p[0] + Math.cos(ang) * l * 0.8), Y(p[1] + off + Math.sin(-ang) * l * 0.15 + l * 0.25 * (0.5 - t)));
      g.stroke();
    }
    if (app.expr === 'scowl') {
      g.strokeStyle = rgba(dark, 0.4);
      g.lineWidth = 0.0009 * U;
      g.beginPath();
      g.moveTo(X(sg * 0.004), Y(0.028));
      g.lineTo(X(sg * 0.006), Y(0.018));
      g.stroke();
    }
  }

  // ---- mouth
  const my = F.mouthY;
  const mw = 0.0175 * F.mw;
  const lipC = app.fem ? [168, 70, 66] : [150, 82, 70];
  soft(S / 260, () => {
    g.fillStyle = rgba(lipC, app.fem ? 0.42 : 0.28);
    ell(0, my + 0.0048, mw * 0.95, 0.0052 * fp.lips, F.smirk * 0.5);
    g.fill();
    ell(0, my - 0.0052, mw * 0.85, 0.0064 * fp.lips, F.smirk * 0.3);
    g.fill();
  });
  // Mouth line, corners lifted by smirks and kind faces, pulled down by scowls.
  const cornerL = app.expr === 'kind' ? 0.0022 : app.expr === 'scowl' ? -0.002 : app.expr === 'stern' ? -0.001 : app.expr === 'weary' ? -0.0012 : 0;
  const cornerR = cornerL + (app.expr === 'smirk' ? 0.0042 : 0);
  g.strokeStyle = rgba([70, 30, 24], 0.7);
  g.lineWidth = 0.0009 * U;
  g.beginPath();
  g.moveTo(X(-mw * 0.92), Y(my + cornerL));
  g.bezierCurveTo(X(-mw * 0.35), Y(my - 0.0012), X(mw * 0.35), Y(my - 0.0012), X(mw * 0.92), Y(my + cornerR));
  g.stroke();
  // Lower-lip highlight.
  g.strokeStyle = 'rgba(255,230,215,0.28)';
  g.lineWidth = 0.0012 * U;
  g.beginPath();
  g.moveTo(X(-mw * 0.3), Y(my - 0.0072));
  g.lineTo(X(mw * 0.3), Y(my - 0.0072));
  g.stroke();

  // ---- age lines, nasolabial folds
  const age = app.age + (app.expr === 'weary' ? 0.25 : 0) + (app.race === 'dwarf' ? 0.2 : 0);
  if (age > 0.1) {
    g.strokeStyle = rgba(dark, 0.18 + age * 0.22);
    g.lineWidth = 0.0009 * U;
    for (const sg of [-1, 1]) {
      g.beginPath();
      g.moveTo(X(sg * 0.014), Y(F.tipY - 0.004));
      g.quadraticCurveTo(X(sg * 0.026), Y(my), X(sg * 0.024), Y(my - 0.014));
      g.stroke();
      // Crow's feet.
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(X(sg * (ex + 0.015)), Y(eyeY + 0.001 - k * 0.002));
        g.lineTo(X(sg * (ex + 0.022)), Y(eyeY + 0.003 - k * 0.0045));
        g.stroke();
      }
    }
    for (let k = 0; k < Math.round(1 + age * 3); k++) {
      g.beginPath();
      const y = 0.042 + k * 0.007;
      g.moveTo(X(-0.03), Y(y + 0.001));
      g.quadraticCurveTo(X(0), Y(y - 0.002), X(0.03), Y(y + 0.001));
      g.stroke();
    }
  }

  // ---- stubble and beard shadow
  if (app.beard !== 'none' || (!app.fem && app.race !== 'elf' && app.race !== 'halfling')) {
    const strength = app.beard === 'stubble' ? 0.55 : app.beard === 'none' ? 0.18 : 0.35;
    const img = new ImageData(S, S);
    const d = img.data;
    for (let i = 0; i < S * S * 0.25; i++) {
      const x = -0.07 + R() * 0.14;
      const y = -0.115 + R() * 0.085;
      const r = Math.hypot(x / 0.07, (y + 0.07) / 0.05);
      const nearMouth = Math.hypot(x / (mw * 1.05), (y - my) / 0.009) < 1;
      if (r > 1 || nearMouth || y > F.tipY - 0.012 + Math.abs(x) * 0.3) continue;
      const px = Math.floor(X(x)), py = Math.floor(Y(y));
      const k = (py * S + px) * 4;
      const a = strength * (1 - r ** 3) * (0.4 + R() * 0.6);
      d[k] = hair[0] * 0.7; d[k + 1] = hair[1] * 0.7; d[k + 2] = hair[2] * 0.7;
      d[k + 3] = Math.max(d[k + 3], Math.round(a * 255));
    }
    const st = document.createElement('canvas');
    st.width = S;
    st.height = S;
    st.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
    g.drawImage(st, 0, 0);
  }

  // ---- scar
  if (app.scar) {
    g.strokeStyle = rgba([150, 70, 66], 0.8);
    g.lineWidth = 0.0016 * U;
    g.beginPath();
    g.moveTo(X(ex + 0.004), Y(0.04));
    g.lineTo(X(ex + 0.018), Y(-0.03));
    g.stroke();
    g.strokeStyle = 'rgba(255,225,210,0.45)';
    g.lineWidth = 0.0006 * U;
    g.stroke();
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      const x = ex + 0.004 + 0.014 * t, y = 0.04 - 0.07 * t;
      g.strokeStyle = rgba([120, 60, 56], 0.6);
      g.lineWidth = 0.0006 * U;
      g.beginPath();
      g.moveTo(X(x - 0.003), Y(y - 0.0006));
      g.lineTo(X(x + 0.003), Y(y + 0.0006));
      g.stroke();
    }
  }
  return c;
}
