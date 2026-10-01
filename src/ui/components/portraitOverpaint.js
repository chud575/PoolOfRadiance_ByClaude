import * as THREE from 'three';
import { faceLayout } from './figureRig.js';
import { rngFrom, hashNum } from './lookData.js';
import { renderToCanvas } from './paintPass.js';

/**
 * The illustrator's finishing layer for a portrait bust: after the sculpt is
 * rendered and oil-filtered (paintPass.js), the features that make a face
 * read at thumbnail size are painted over it in screen space, at the final
 * resolution, registered to the sculpt through the camera:
 *   - eyes: almond of eye-white, iris, pupil, catch-light, lid shadow, lash
 *     line, crease, socket glaze (shaped by race, sex and expression);
 *   - brows as hair strokes, the mouth line and lip light, nostrils;
 *   - hair and beards as layered strand clumps — dark grooves, mid strokes and
 *     lit highlights that follow a flow field from the crown (or down from
 *     the chin), fading out softly past the silhouette;
 *   - impasto skin strokes and a cool rim on the shadow side.
 * A material-ID pass (skin / hair / eye) masks every layer, so nothing is
 * painted over a helm, a hood or armour. Deterministic from the look seed.
 */

const MASK_VS = /* glsl */`
attribute vec4 aMat;
varying float vPid;
void main() { vPid = aMat.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const MASK_FS = /* glsl */`
varying float vPid;
void main() {
  float p = floor(vPid + 0.5);
  gl_FragColor = vec4(abs(p - 9.0) < 0.5 ? 12.0 : 0.0, abs(p - 5.0) < 0.5 ? 12.0 : 0.0, abs(p - 11.0) < 0.5 ? 12.0 : 0.0, 1.0);
}`;
let maskMat = null;
let blackMat = null;
/** Materials for the ID pass (R skin, G hair, B eye). */
export function maskMaterials() {
  if (!maskMat) {
    maskMat = new THREE.ShaderMaterial({ vertexShader: MASK_VS, fragmentShader: MASK_FS, toneMapped: false });
    blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  }
  return { maskMat, blackMat };
}

const hexRGB = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const clamp = (x, a = 0, b = 255) => Math.max(a, Math.min(b, x));
const rgba = (c, a = 1, k = 1) => `rgba(${clamp(Math.round(c[0] * k))},${clamp(Math.round(c[1] * k))},${clamp(Math.round(c[2] * k))},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function layer(W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  // CPU-backed: these layers are composited and read back, which is far
  // cheaper in software rendering than GPU canvases.
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** Blur a canvas cheaply (down/up sampling — canvas filters are slow in software). */
function softened(src, f) {
  const W = src.width, H = src.height;
  const a = layer(Math.max(1, Math.round(W / f)), Math.max(1, Math.round(H / f)));
  const ga = a.getContext('2d');
  ga.imageSmoothingEnabled = true;
  ga.imageSmoothingQuality = 'high';
  ga.drawImage(src, 0, 0, a.width, a.height);
  const b = layer(W, H);
  const gb = b.getContext('2d');
  gb.imageSmoothingEnabled = true;
  gb.imageSmoothingQuality = 'high';
  gb.drawImage(a, 0, 0, W, H);
  return b;
}

/**
 * Paint the finishing layer onto `out` (the painted render).
 * @param {HTMLCanvasElement} out    painted portrait (modified in place)
 * @param {HTMLCanvasElement} mask   ID pass, same size (R skin, G hair, B eye)
 * @param {object} app               resolveAppearance()
 * @param {{project:(p:number[])=>number[], frames:object}} view  head-local → canvas px
 */
export function overpaintPortrait(out, mask, app, view) {
  const mini = !!view.mini;
  const W = out.width, H = out.height;
  const k = W / 300; // px scale relative to a full-size portrait
  const g = out.getContext('2d', { willReadFrequently: true });
  const R = rngFrom(hashNum(app.seed, app.look.head, app.race, 'overpaint'));
  const F = faceLayout(app);
  const fp = F.fp;
  const src = g.getImageData(0, 0, W, H).data;
  const md = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const at = (x, y) => {
    const xi = clamp(Math.round(x), 0, W - 1), yi = clamp(Math.round(y), 0, H - 1);
    const i = (yi * W + xi) * 4;
    return [src[i], src[i + 1], src[i + 2]];
  };
  const isHair = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
    return md[(yi * W + xi) * 4 + 1] > 110;
  };
  const P = view.project;
  const skin = hexRGB(app.skinHex);
  const hair = hexRGB(app.hairHex);
  const eyeC = hexRGB(app.eyeHex);
  const lineC = mixc([30, 16, 10], hair, 0.25);

  // Skin+eye region mask (soft) — features never leave the face.
  const faceMask = layer(W, H);
  {
    const fg = faceMask.getContext('2d');
    const im = fg.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(md[i * 4], md[i * 4 + 2]) > 110 ? 255 : 0;
      im.data[i * 4 + 3] = v;
    }
    fg.putImageData(im, 0, 0);
  }
  const faceSoft = softened(faceMask, Math.max(1.5, 2 * k));

  // ---- relight: the sculpt's broad light is replaced by a painter's simple
  // form (an ideal ovoid under the key light, darker toward the jaw) while
  // the features' own small-scale shading is kept. Removes the pale 'mask'
  // band the separate face masses catch.
  function relight(filled, ar, ag, ab) {
    const lumOf = (r, g2, b) => r * 0.3 + g2 * 0.59 + b * 0.11;
    const fl = filled.getContext('2d');
    fl.drawImage(out, 0, 0);
    fl.globalCompositeOperation = 'destination-in';
    fl.drawImage(faceMask, 0, 0);
    fl.globalCompositeOperation = 'destination-over';
    fl.fillStyle = `rgb(${Math.round(ar)},${Math.round(ag)},${Math.round(ab)})`;
    fl.fillRect(0, 0, W, H);
    fl.globalCompositeOperation = 'source-over';
    const lb = softened(filled, Math.max(4, 11 * k)).getContext('2d').getImageData(0, 0, W, H).data;
    const ma = faceSoft.getContext('2d').getImageData(0, 0, W, H).data;
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const c0 = P([0, -0.008, 0.02]);
    const rx = Math.abs(P([0.074, -0.008, 0.02])[0] - c0[0]) + 1;
    const ryT = Math.abs(P([0, 0.105, 0.02])[1] - c0[1]) + 1;
    const ryB = Math.abs(P([0, -0.118, 0.02])[1] - c0[1]) + 1;
    const chinY = P([0, -0.098 * F.fl, 0.05])[1];
    let lx = -0.62, ly = 0.55, lz = 0.58;
    const ll = Math.hypot(lx, ly, lz);
    lx /= ll; ly /= ll; lz /= ll;
    const S = new Float32Array(W * H);
    let sum = 0, cnt = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (ma[i * 4 + 3] < 8) continue;
        const dx = (x - c0[0]) / rx;
        const dyr = y - c0[1];
        const dy = dyr / (dyr < 0 ? ryT : ryB);
        const r2 = dx * dx + dy * dy;
        const nz = Math.sqrt(Math.max(0.04, 1 - Math.min(1, r2)));
        const nl = Math.hypot(dx, dy, nz);
        const lam = Math.max(0, ((dx * lx - dy * ly + nz * lz) / nl + 0.3) / 1.3);
        let sh = 0.2 + 1.0 * lam ** 1.25;
        if (dy > 0.5) sh *= 1 - Math.min(0.3, (dy - 0.5) * 0.55);
        // The neck sits in the jaw's shadow.
        if (y > chinY) sh *= 0.5 + 0.5 * Math.max(0, 1 - (y - chinY) / (6 * k));
        S[i] = sh;
        sum += sh; cnt++;
      }
    }
    if (!cnt) return;
    const meanS = sum / cnt;
    const avgL = lumOf(ar, ag, ab);
    for (let i = 0; i < W * H; i++) {
      const a = ma[i * 4 + 3] / 255;
      if (a < 0.03 || !S[i]) continue;
      const lB = Math.max(6, lumOf(lb[i * 4], lb[i * 4 + 1], lb[i * 4 + 2]));
      const T = avgL * S[i] / meanS;
      let f = Math.min(1.8, Math.max(0.42, T / lB)) ** 0.85;
      f = 1 + (f - 1) * a * 0.92;
      d[i * 4] = clamp(d[i * 4] * f);
      d[i * 4 + 1] = clamp(d[i * 4 + 1] * f);
      d[i * 4 + 2] = clamp(d[i * 4 + 2] * f);
    }
    g.putImageData(img, 0, 0);
  }

  // ---- broad planes: soften the sculpt's lumps the way a painter simplifies
  // skin into planes (a blur of the skin alone, laid over at partial strength).
  if (!mini) {
    let sr = 0, sg2 = 0, sb = 0, n = 0;
    for (let i = 0; i < W * H; i += 3) {
      if (md[i * 4] > 110) { sr += src[i * 4]; sg2 += src[i * 4 + 1]; sb += src[i * 4 + 2]; n++; }
    }
    if (n > 10) {
      const skinOnly = layer(W, H);
      const so = skinOnly.getContext('2d');
      so.drawImage(out, 0, 0);
      so.globalCompositeOperation = 'destination-in';
      so.drawImage(faceMask, 0, 0);
      const filled = layer(W, H);
      const fl = filled.getContext('2d');
      fl.fillStyle = `rgb(${Math.round(sr / n)},${Math.round(sg2 / n)},${Math.round(sb / n)})`;
      fl.fillRect(0, 0, W, H);
      fl.drawImage(skinOnly, 0, 0);
      const blur = softened(filled, Math.max(3, 7 * k));
      const bg2 = blur.getContext('2d');
      bg2.globalCompositeOperation = 'destination-in';
      bg2.drawImage(softened(faceMask, Math.max(2, 4 * k)), 0, 0);
      g.globalAlpha = 0.3;
      g.drawImage(blur, 0, 0);
      g.globalAlpha = 1;
      relight(filled, sr / n, sg2 / n, sb / n);
    }
  }

  // ---- impasto: short strokes of the skin's own colour, nudged warm or cool
  // and lighter or darker, laid along the forms (visible brushwork).
  if (!mini) {
    const cur = g.getImageData(0, 0, W, H).data;
    const lumAt = (x, y) => {
      const i = (clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)) * 4;
      return cur[i] * 0.3 + cur[i + 1] * 0.59 + cur[i + 2] * 0.11;
    };
    const N = Math.round(700 * k * k);
    g.save();
    g.lineCap = 'round';
    let placed = 0;
    for (let t = 0; t < N * 6 && placed < N; t++) {
      const x = R() * W, y = R() * H;
      const xi = Math.round(x), yi = Math.round(y);
      if (md[(yi * W + xi) * 4] < 110) continue;
      placed++;
      const i = (yi * W + xi) * 4;
      const gx = lumAt(x + 2 * k, y) - lumAt(x - 2 * k, y);
      const gy = lumAt(x, y + 2 * k) - lumAt(x, y - 2 * k);
      let dx = -gy, dy = gx;
      const gl = Math.hypot(dx, dy);
      if (gl < 1.5) { dx = 0.7; dy = -0.7; } else { dx /= gl; dy /= gl; }
      const v = 0.9 + R() * 0.2;
      const warm = R() < 0.5 ? [8, 2, -4] : [-4, 0, 6];
      g.strokeStyle = `rgba(${clamp(Math.round(cur[i] * v + warm[0]))},${clamp(Math.round(cur[i + 1] * v + warm[1]))},${clamp(Math.round(cur[i + 2] * v + warm[2]))},0.32)`;
      g.lineWidth = (1.4 + R() * 1.8) * k;
      const L = (3 + R() * 6) * k;
      g.beginPath();
      g.moveTo(x - dx * L * 0.5, y - dy * L * 0.5);
      g.lineTo(x + dx * L * 0.5, y + dy * L * 0.5);
      g.stroke();
    }
    g.restore();
  }

  /** Local affine frame on the face: head-local point c, units of 1 mm. */
  const frame = (gc, c) => {
    const o = P(c);
    const px = P([c[0] + 0.001, c[1], c[2]]);
    const py = P([c[0], c[1] + 0.001, c[2]]);
    gc.setTransform(px[0] - o[0], px[1] - o[1], py[0] - o[0], py[1] - o[1], o[0], o[1]);
    return o;
  };

  // ================================================================ features
  const feat = layer(W, H);
  const fg = feat.getContext('2d');
  fg.lineCap = 'round';
  fg.lineJoin = 'round';
  const { ex, eyeY, er } = F;
  const helmed = app.helm;
  const sleepy = fp.lid;
  const elfish = app.race === 'elf' ? 1 : app.race === 'halfElf' ? 0.5 : 0;

  // ---- eyes
  for (const sg of [-1, 1]) {
    const cx = sg * ex;
    const c = [cx, eyeY, 0.082];
    const o = frame(fg, c);
    const local = at(o[0], o[1]);
    const lum = (local[0] * 0.3 + local[1] * 0.59 + local[2] * 0.11) / 255;
    const lit = clamp(lum * 2.1, 0.6, 1.15);
    // mm units from here (x toward the character's left, y up — the frame flips y).
    const es = fp.eye ** 0.5 * (app.race === 'halfling' ? 1.08 : 1) * 1.12;
    const wIn = 11.6 * es, wOut = 12.8 * es;
    const op = (elfish ? 5.0 : 6.0) * es * (1 - sleepy * 0.28) * (app.expr === 'scowl' ? 0.86 : 1);
    const lo = 4.6 * es * (app.expr === 'kind' ? 0.8 : 1);
    const slant = fp.slant * 2.2;
    const inner = [-sg * wIn, -0.6];
    const outer = [sg * wOut, 0.5 + slant];
    const up1 = [-sg * wIn * 0.45, op * 1.35], up2 = [sg * wOut * 0.4, op * 1.32 + slant * 0.6];
    const lo1 = [sg * wOut * 0.45, -lo * 0.95 + slant * 0.3], lo2 = [-sg * wIn * 0.4, -lo * 1.05];
    const almond = () => {
      fg.beginPath();
      fg.moveTo(...inner);
      fg.bezierCurveTo(...up1, ...up2, ...outer);
      fg.bezierCurveTo(...lo1, ...lo2, ...inner);
      fg.closePath();
    };
    // Lids painted over the sculpt's deep socket: skin sampled from the brow
    // and cheek beside this eye, a little cooler and darker on the upper lid.
    {
      const up = P([cx + sg * 0.004, eyeY + 0.032, 0.088]);
      const dn = P([cx + sg * 0.006, eyeY - 0.024, 0.078]);
      const cu = at(up[0], up[1]);
      const cd = at(dn[0], dn[1]);
      const lidU = mixc(cu, [70, 40, 46], 0.12).map((v) => v * 0.9);
      const lidD = mixc(cd, [80, 50, 50], 0.06);
      const lg = fg.createLinearGradient(0, 14, 0, -12);
      lg.addColorStop(0, rgba(cu, 0));
      lg.addColorStop(0.25, rgba(lidU, 0.85));
      lg.addColorStop(0.55, rgba(lidU, 0.9));
      lg.addColorStop(0.75, rgba(lidD, 0.85));
      lg.addColorStop(1, rgba(cd, 0));
      fg.save();
      fg.beginPath();
      fg.ellipse(sg * 0.6, 0.6, 18 * es, 13.5 * es, 0, 0, Math.PI * 2);
      fg.clip();
      fg.fillStyle = lg;
      fg.fillRect(-24, -16, 48, 32);
      fg.restore();
      // Feather the lid paint's outer edge back into the sculpt.
      const fe = fg.createRadialGradient(sg * 0.6, 0.6, 12 * es, sg * 0.6, 0.6, 18.5 * es);
      fe.addColorStop(0, 'rgba(0,0,0,0)');
      fe.addColorStop(1, 'rgba(0,0,0,0)');
      void fe;
    }
    // Socket glaze: a soft cool shadow around and above the eye.
    const sock = fg.createRadialGradient(sg * 1, 2.5, 2, sg * 1, 2.5, 19 * es);
    sock.addColorStop(0, rgba(mixc(local, [40, 24, 30], 0.6), 0.16));
    sock.addColorStop(0.55, rgba(mixc(local, [40, 24, 30], 0.6), 0.08));
    sock.addColorStop(1, rgba(local, 0));
    fg.fillStyle = sock;
    fg.beginPath();
    fg.ellipse(sg * 1, 2.5, 19 * es, 13 * es, 0, 0, Math.PI * 2);
    fg.fill();
    // Upper-lid skin a touch darker under the brow.
    fg.fillStyle = rgba(mixc(local, [60, 30, 30], 0.35), 0.35);
    fg.beginPath();
    fg.ellipse(sg * 0.5, op + 1.8, wOut * 1.02, 3.6, sg * slant * 0.04, 0, Math.PI * 2);
    fg.fill();
    fg.save();
    almond();
    fg.clip();
    // Eye white (never pure white; shaded by the lid and the light on this side).
    const white = mixc([226, 214, 200], local, 0.22);
    const wg = fg.createLinearGradient(0, op + 1, 0, -lo - 1);
    wg.addColorStop(0, rgba(white, 1, 0.42 * lit));
    wg.addColorStop(0.5, rgba(white, 1, 0.86 * lit));
    wg.addColorStop(1, rgba(white, 1, 0.74 * lit));
    fg.fillStyle = wg;
    fg.fillRect(-20, -12, 40, 24);
    // Corners darker (the ball turns away).
    for (const side of [inner, outer]) {
      const cg = fg.createRadialGradient(side[0], side[1], 0, side[0], side[1], 6);
      cg.addColorStop(0, rgba(mixc(local, [90, 40, 40], 0.4), 0.7));
      cg.addColorStop(1, rgba(local, 0));
      fg.fillStyle = cg;
      fg.fillRect(side[0] - 7, side[1] - 7, 14, 14);
    }
    // Iris and pupil — looking at the viewer, tucked under the upper lid.
    const ir = er * 1000 * 0.52 * (app.race === 'halfling' ? 1.06 : 1);
    const ix = -sg * 0.3, iy = 0.9 + (sleepy > 0.3 ? 0.9 : 0);
    const ig = fg.createRadialGradient(ix - 0.6, iy - 1.2, 0, ix, iy, ir);
    ig.addColorStop(0, rgba(eyeC, 1, 1.5 * lit));
    ig.addColorStop(0.45, rgba(eyeC, 1, 1.1 * lit));
    ig.addColorStop(0.82, rgba(eyeC, 1, 0.62 * lit));
    ig.addColorStop(1, rgba([22, 16, 14], 1));
    fg.fillStyle = ig;
    fg.beginPath();
    fg.arc(ix, iy, ir, 0, Math.PI * 2);
    fg.fill();
    // Iris fibres.
    fg.strokeStyle = rgba(eyeC, 0.35, 1.7 * lit);
    fg.lineWidth = 0.35;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + R() * 0.3;
      fg.beginPath();
      fg.moveTo(ix + Math.cos(a) * ir * 0.42, iy + Math.sin(a) * ir * 0.42);
      fg.lineTo(ix + Math.cos(a) * ir * 0.85, iy + Math.sin(a) * ir * 0.85);
      fg.stroke();
    }
    fg.fillStyle = 'rgb(10,7,6)';
    fg.beginPath();
    fg.arc(ix, iy, ir * 0.38, 0, Math.PI * 2);
    fg.fill();
    // Lid shadow across the top of the eye.
    const ls = fg.createLinearGradient(0, op * 1.1, 0, op * 0.1);
    ls.addColorStop(0, 'rgba(24,12,10,0.7)');
    ls.addColorStop(1, 'rgba(24,12,10,0)');
    fg.fillStyle = ls;
    fg.fillRect(-20, -1, 40, 13);
    // Catch-light (key light from the upper left of the picture).
    fg.fillStyle = `rgba(255,250,240,${0.55 + 0.4 * Math.min(1, lit)})`;
    fg.beginPath();
    fg.ellipse(ix - ir * 0.34, iy + ir * 0.34, ir * 0.2, ir * 0.17, 0, 0, Math.PI * 2);
    fg.fill();
    fg.restore();
    // Lash line: heavy, tapering, heavier at the outer corner; women get a flick.
    const lw = (app.fem ? 1.9 : 1.6);
    fg.strokeStyle = rgba(lineC, 0.92);
    fg.lineWidth = lw;
    fg.beginPath();
    fg.moveTo(...inner);
    fg.bezierCurveTo(...up1, ...up2, ...outer);
    fg.stroke();
    fg.lineWidth = lw * 1.6;
    fg.beginPath();
    fg.moveTo(up2[0] * 0.6, op * 1.0 + slant * 0.4);
    fg.quadraticCurveTo(up2[0], up2[1] * 0.98, outer[0], outer[1]);
    fg.stroke();
    if (app.fem) {
      fg.lineWidth = 1.0;
      fg.beginPath();
      fg.moveTo(outer[0] - sg * 1.5, outer[1] + 0.2);
      fg.lineTo(outer[0] + sg * 2.6, outer[1] + 1.8);
      fg.stroke();
    }
    // Lower lid: a soft line and a lit rim of the lower lid.
    fg.strokeStyle = rgba(mixc(local, [50, 24, 20], 0.55), 0.55);
    fg.lineWidth = 0.6;
    fg.beginPath();
    fg.moveTo(...inner);
    fg.bezierCurveTo(lo2[0], lo2[1], lo1[0], lo1[1], ...outer);
    fg.stroke();
    fg.strokeStyle = rgba(mixc(local, [255, 220, 200], 0.4), 0.3 * lit);
    fg.lineWidth = 0.7;
    fg.beginPath();
    fg.moveTo(inner[0] * 0.7, inner[1] - 1.2);
    fg.bezierCurveTo(lo2[0], lo2[1] - 1.1, lo1[0], lo1[1] - 1.1, outer[0] * 0.75, outer[1] - 1.4);
    fg.stroke();
    // Crease above the lid (hooded and heavy on weary or old faces).
    const crease = op + 3.2 - sleepy * 1.4;
    fg.strokeStyle = rgba(mixc(local, [40, 20, 18], 0.6), 0.5);
    fg.lineWidth = 0.8;
    fg.beginPath();
    fg.moveTo(-sg * wIn * 0.75, op * 0.4 + 1.4);
    fg.quadraticCurveTo(sg * 1.5, crease + 1.6, sg * wOut * 1.0, op * 0.4 + 1.2 + slant);
    fg.stroke();
    // Tear duct.
    fg.fillStyle = rgba([186, 98, 90], 0.7 * lit);
    fg.beginPath();
    fg.ellipse(inner[0] + sg * 1.1, inner[1] + 0.1, 1.2, 0.9, 0, 0, Math.PI * 2);
    fg.fill();
    // Under-eye: shadow and age.
    const age = app.age + (app.expr === 'weary' ? 0.35 : 0) + (app.race === 'dwarf' ? 0.2 : 0);
    fg.strokeStyle = rgba(mixc(local, [50, 24, 30], 0.6), 0.18 + age * 0.25);
    fg.lineWidth = 0.9;
    fg.beginPath();
    fg.moveTo(-sg * wIn * 0.5, -lo - 2.6);
    fg.quadraticCurveTo(sg * 1, -lo - 4.4 - age * 1.5, sg * wOut * 0.8, -lo - 1.6);
    fg.stroke();
    if (age > 0.15) {
      fg.lineWidth = 0.6;
      for (let i = 0; i < 3; i++) {
        fg.beginPath();
        fg.moveTo(outer[0] + sg * 2.5, outer[1] + 1.5 - i * 2.4);
        fg.lineTo(outer[0] + sg * (7 + R() * 2), outer[1] + 3 - i * 4.2);
        fg.stroke();
      }
    }
  }

  // ---- brows: hair strokes along an arc set by the expression
  const tilt = F.browTilt;
  const browCol = app.age >= 0.9 ? [204, 198, 190] : hair.map((v) => v * 0.85);
  for (const sg of [-1, 1]) {
    if (helmed) break;
    const o = frame(fg, [0, 0, 0.09]);
    const local = at(o[0], o[1]);
    const lumB = (local[0] + local[1] + local[2]) / 765;
    const mass = Math.min(1.5, fp.brow) * (app.fem ? 0.8 : 1.12);
    // Expression lives in the brows: scowls knit them low at the centre,
    // weary brows lift inside and sag outside, proud ones arch, smirks cock one.
    const cock = app.expr === 'smirk' && sg > 0 ? 3 : 0;
    const iy = 23 - tilt * 22 + (app.expr === 'proud' ? 2.5 : 0) + (app.expr === 'weary' ? 3.5 : 0) + (app.expr === 'kind' ? 1.5 : 0) + cock;
    const inner = [sg * (ex * 1000 - 13 + (app.expr === 'scowl' ? 1.5 : 0)), iy];
    const peak = [sg * (ex * 1000 + 3), 28.4 - tilt * 3 + (app.fem ? 1.8 : 0) + elfish * 1.8 + (app.expr === 'proud' ? 2 : 0) + cock];
    const outer = [sg * (ex * 1000 + 17.5), 22.5 + tilt * 8 - (app.expr === 'weary' ? 5 : 0) + elfish * 3.5 + cock * 0.6];
    const bz = (t) => {
      const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), cc = t * t;
      return [inner[0] * a + peak[0] * b + outer[0] * cc, inner[1] * a + peak[1] * b + outer[1] * cc];
    };
    // A soft underlayer, then individual hairs.
    fg.strokeStyle = rgba(browCol, 0.62, 0.75);
    fg.lineWidth = 4.8 * mass;
    fg.beginPath();
    fg.moveTo(...bz(0.02));
    for (let t = 0.1; t <= 1.001; t += 0.1) fg.lineTo(...bz(t));
    fg.stroke();
    const n = 120;
    for (let i = 0; i < n; i++) {
      const t = R();
      const p = bz(t);
      const th = (3.4 - t * 1.9) * mass;
      const off = (R() - 0.5) * th;
      // Inner hairs grow up and out, outer hairs lie along the arc.
      const ang = (0.5 - t) * 1.2 + (R() - 0.5) * 0.35;
      const l = (2.6 + R() * 2.4) * mass;
      const dirx = sg * Math.cos(ang), diry = Math.sin(ang) * 0.9 + 0.15;
      const light = R() < 0.25 ? 1.45 : 0.75 + R() * 0.3;
      fg.strokeStyle = rgba(browCol, (0.35 + R() * 0.45) * (app.fem ? 0.85 : 1), light * (lumB < 0.25 ? 0.8 : 1));
      fg.lineWidth = 0.35 + R() * 0.45;
      fg.beginPath();
      fg.moveTo(p[0], p[1] + off);
      fg.quadraticCurveTo(p[0] + dirx * l * 0.5, p[1] + off + diry * l * 0.6, p[0] + dirx * l, p[1] + off + diry * l * 0.4);
      fg.stroke();
    }
    if (app.expr === 'scowl' || app.expr === 'stern') {
      fg.strokeStyle = rgba(mixc(local, [40, 20, 18], 0.6), app.expr === 'scowl' ? 0.5 : 0.25);
      fg.lineWidth = 0.8;
      fg.beginPath();
      fg.moveTo(sg * 3.6, 27);
      fg.quadraticCurveTo(sg * 5, 22, sg * 4.2, 17);
      fg.stroke();
    }
  }

  // ---- character lines: age, weather and expression written into the skin
  if (!mini) {
    const age = app.age + (app.expr === 'weary' ? 0.3 : 0) + (app.race === 'dwarf' ? 0.25 : 0) + (app.race === 'gnome' ? 0.3 : 0) - (app.race === 'elf' ? 0.3 : 0) - (app.fem ? 0.1 : 0);
    const o = frame(fg, [0, 0, 0.088]);
    const local = at(o[0], o[1]);
    const line = mixc(local, [60, 26, 22], 0.6);
    const lit = mixc(local, [255, 236, 220], 0.35);
    const pair = (fn, a, w) => {
      // A crease is a dark line with a lit lip beside it.
      fg.strokeStyle = rgba(line, a);
      fg.lineWidth = w;
      fg.beginPath(); fn(0); fg.stroke();
      fg.strokeStyle = rgba(lit, a * 0.45);
      fg.lineWidth = w * 0.8;
      fg.beginPath(); fn(1); fg.stroke();
    };
    if (age > 0.12) {
      const a = Math.min(0.6, 0.2 + age * 0.4);
      // Forehead lines.
      for (let i = 0; i < Math.round(1 + age * 3); i++) {
        const y = 40 + i * 7;
        pair((d) => { fg.moveTo(-26, y + 1 - d * 1.4); fg.quadraticCurveTo(0, y - 2.5 - d * 1.4, 26, y + 1 - d * 1.4); }, a * (1 - i * 0.15), 0.9);
      }
    }
    const fold = Math.max(age, app.expr === 'smirk' || app.expr === 'kind' ? 0.35 : 0, app.expr === 'scowl' ? 0.3 : 0);
    if (fold > 0.12) {
      const tip = F.tipY * 1000, my = F.mouthY * 1000;
      for (const sg of [-1, 1]) {
        const deep = sg > 0 && app.expr === 'smirk' ? 1.4 : 1;
        pair((d) => {
          fg.moveTo(sg * (13 + d * 1.2), tip - 3);
          fg.quadraticCurveTo(sg * (27 + d * 1.5), my + 2, sg * (25 + d * 1.5), my - 13);
        }, Math.min(0.55, 0.18 + fold * 0.38) * deep, 1.1);
      }
    }
    if (app.expr === 'scowl' || (app.expr === 'stern' && age > 0.3)) {
      for (const sg of [-1, 1]) pair((d) => { fg.moveTo(sg * (3.5 + d), 31); fg.quadraticCurveTo(sg * (5 + d), 25, sg * (4 + d), 19); }, 0.5, 0.9);
    }
    if (age > 0.6) {
      // Hollow cheeks and loose skin under the jaw.
      for (const sg of [-1, 1]) {
        const cg = fg.createRadialGradient(sg * 40, -40, 0, sg * 40, -40, 16);
        cg.addColorStop(0, rgba(line, 0.25));
        cg.addColorStop(1, rgba(line, 0));
        fg.fillStyle = cg;
        fg.fillRect(sg * 40 - 16, -56, 32, 32);
      }
    }
    if (app.scar) {
      const ex2 = ex * 1000;
      fg.strokeStyle = rgba([140, 62, 58], 0.75);
      fg.lineWidth = 1.6;
      fg.beginPath(); fg.moveTo(ex2 + 4, 42); fg.lineTo(ex2 + 17, -30); fg.stroke();
      fg.strokeStyle = 'rgba(255,226,212,0.4)';
      fg.lineWidth = 0.6;
      fg.beginPath(); fg.moveTo(ex2 + 4.6, 42); fg.lineTo(ex2 + 17.6, -30); fg.stroke();
    }
  }

  // ---- nose: nostrils and the shadow under the tip
  {
    const tipZ = 0.106 + 0.012 * (fp.nose - 1);
    const o = frame(fg, [0, F.tipY, tipZ - 0.008]);
    const tip = 0;
    const local = at(o[0], o[1] + 3 * k);
    const dark = mixc(local, [40, 14, 12], 0.7);
    const ts = fp.tip ** 0.6;
    for (const sg of [-1, 1]) {
      fg.fillStyle = rgba(dark, 0.62);
      fg.beginPath();
      fg.ellipse(sg * 5.6 * ts, tip - 4.6, 2.4 * ts, 1.3, sg * -0.35, 0, Math.PI * 2);
      fg.fill();
      // Alar crease.
      fg.strokeStyle = rgba(dark, 0.32);
      fg.lineWidth = 0.7;
      fg.beginPath();
      fg.arc(sg * 7.5 * ts, tip - 1.5, 4.2 * ts, sg > 0 ? -1.4 : Math.PI + 1.4 - 1.6, sg > 0 ? 0.2 : Math.PI + 1.4);
      fg.stroke();
    }
    const ns = fg.createRadialGradient(0, tip - 7.5, 0, 0, tip - 7.5, 10);
    ns.addColorStop(0, rgba(dark, 0.38));
    ns.addColorStop(1, rgba(dark, 0));
    fg.fillStyle = ns;
    fg.fillRect(-11, tip - 18, 22, 21);
    // The nose's cast shadow falls down and away from the key light.
    {
      const cs = fg.createRadialGradient(5.5, 6, 0, 5.5, 6, 13);
      cs.addColorStop(0, rgba(dark, 0.3));
      cs.addColorStop(1, rgba(dark, 0));
      fg.save();
      fg.translate(5.5, 6);
      fg.scale(0.42, 1);
      fg.translate(-5.5, -6);
      fg.fillStyle = cs;
      fg.fillRect(-10, -10, 32, 32);
      fg.restore();
    }
    // Light on the bridge and tip.
    fg.strokeStyle = rgba([255, 236, 218], 0.07);
    fg.lineWidth = 2.4;
    fg.beginPath();
    fg.moveTo(-0.8, -F.tipY * 1000 - 4);
    fg.lineTo(-1.2, tip + 2);
    fg.stroke();
    fg.fillStyle = 'rgba(255,236,220,0.28)';
    fg.beginPath();
    fg.ellipse(-1.4, tip + 0.5, 2.4, 1.6, 0, 0, Math.PI * 2);
    fg.fill();
  }

  // ---- cheekbone planes: the hollow under each cheekbone (deeper on the shadow side)
  for (const sg of [-1, 1]) {
    const o = frame(fg, [sg * 0.047 * F.fw, -0.036, 0.062]);
    const local = at(o[0], o[1]);
    const dark = mixc(local, [50, 22, 26], 0.6);
    const cg = fg.createRadialGradient(0, 0, 0, 0, 0, 13);
    cg.addColorStop(0, rgba(dark, sg > 0 ? 0.3 : 0.16));
    cg.addColorStop(1, rgba(dark, 0));
    fg.save();
    fg.rotate(sg * 0.35);
    fg.scale(0.55, 1);
    fg.fillStyle = cg;
    fg.fillRect(-14, -14, 28, 28);
    fg.restore();
  }

  // ---- mouth
  {
    const my = F.mouthY * 1000;
    const o = frame(fg, [0, F.mouthY, 0.086]);
    const local = at(o[0], o[1] - 5 * k);
    const mw = 21 * F.mw * (app.race === 'halfling' ? 0.9 : 1);
    const lipC = app.fem ? [172, 72, 70] : mixc(local, [150, 70, 62], 0.5);
    const cornerL = app.expr === 'kind' ? 2.2 : app.expr === 'scowl' ? -2.2 : app.expr === 'stern' ? -1.2 : app.expr === 'weary' ? -1.4 : app.expr === 'proud' ? -0.6 : 0;
    const cornerR = cornerL + (app.expr === 'smirk' ? 4.2 : 0);
    const covered = app.beard === 'full' || app.beard === 'long';
    // Lips: upper lip in shadow, lower lip catching light.
    if (!covered) {
      fg.fillStyle = rgba(lipC, app.fem ? 0.5 : 0.3, 0.75);
      fg.beginPath();
      fg.moveTo(-mw, cornerL);
      fg.bezierCurveTo(-mw * 0.5, 4.8 * fp.lips, -mw * 0.12, 4.6 * fp.lips, 0, 3.6 * fp.lips);
      fg.bezierCurveTo(mw * 0.12, 4.6 * fp.lips, mw * 0.5, 4.8 * fp.lips, mw, cornerR);
      fg.bezierCurveTo(mw * 0.4, -0.8, -mw * 0.4, -0.8, -mw, cornerL);
      fg.fill();
      fg.fillStyle = rgba(lipC, app.fem ? 0.45 : 0.26);
      fg.beginPath();
      fg.moveTo(-mw * 0.9, cornerL);
      fg.bezierCurveTo(-mw * 0.4, -1.2, mw * 0.4, -1.2, mw * 0.9, cornerR);
      fg.bezierCurveTo(mw * 0.5, -7 * fp.lips, -mw * 0.5, -7 * fp.lips, -mw * 0.9, cornerL);
      fg.fill();
      fg.strokeStyle = `rgba(255,232,218,${app.fem ? 0.34 : 0.22})`;
      fg.lineWidth = 1.3;
      fg.beginPath();
      fg.moveTo(-mw * 0.32, -4.3 * fp.lips);
      fg.quadraticCurveTo(0, -5 * fp.lips, mw * 0.28, -4.3 * fp.lips);
      fg.stroke();
      // Shadow under the lower lip.
      const ul = fg.createRadialGradient(0, -9.5 * fp.lips, 0, 0, -9.5 * fp.lips, mw * 0.7);
      ul.addColorStop(0, rgba(mixc(local, [40, 16, 14], 0.6), 0.3));
      ul.addColorStop(1, rgba(local, 0));
      fg.fillStyle = ul;
      fg.fillRect(-mw, -16, mw * 2, 12);
    }
    // The mouth line.
    fg.strokeStyle = rgba([52, 20, 16], covered ? 0.6 : 0.95);
    fg.lineWidth = 1.35;
    fg.beginPath();
    fg.moveTo(-mw * 0.95, cornerL);
    fg.bezierCurveTo(-mw * 0.35, -1.0, mw * 0.35, -1.0, mw * 0.95, cornerR);
    fg.stroke();
    // Corner shadows.
    fg.fillStyle = rgba([60, 26, 22], 0.4);
    for (const [x, y] of [[-mw * 0.98, cornerL], [mw * 0.98, cornerR]]) {
      fg.beginPath();
      fg.arc(x, y, 1.1, 0, Math.PI * 2);
      fg.fill();
    }
    // Philtrum.
    if (!covered && app.beard !== 'moustache') {
      fg.strokeStyle = rgba(mixc(local, [60, 30, 24], 0.5), 0.22);
      fg.lineWidth = 0.7;
      for (const sg of [-1, 1]) {
        fg.beginPath();
        fg.moveTo(sg * 2.6, 4.2 * fp.lips);
        fg.lineTo(sg * 2.0, (F.tipY * 1000 - my) - 7);
        fg.stroke();
      }
    }
    void my;
  }
  // Mask features to the face and lay them on.
  fg.setTransform(1, 0, 0, 1, 0, 0);
  fg.globalCompositeOperation = 'destination-in';
  fg.drawImage(faceSoft, 0, 0);
  g.drawImage(feat, 0, 0);

  // ================================================================ hair strands
  let hairPx = 0;
  for (let i = 1; i < md.length; i += 16) if (md[i] > 110) hairPx++;
  if (hairPx > 20 && !mini) {
    const hl = layer(W, H);
    const hg = hl.getContext('2d');
    hg.lineCap = 'round';
    const crown = P([0, 0.115, -0.03]);
    const chin = P([0, -0.11, 0.07]);
    const mouth = P([0, F.mouthY, 0.09]);
    const headC = P([0, 0, 0]);
    const headR = Math.abs(P([0.08, 0, 0])[0] - headC[0]) + 1;
    const beardStyle = app.beard;
    const bearded = beardStyle !== 'none' && beardStyle !== 'stubble';
    const hairLum = (hair[0] * 0.3 + hair[1] * 0.59 + hair[2] * 0.11) / 255;
    const flow = (x, y) => {
      // Beard: hair falls from the cheeks and chin, curling slightly outward.
      if (bearded && y > mouth[1] - 6 * k && Math.abs(x - chin[0]) < headR * 1.25) {
        const dx = (x - chin[0]) / headR;
        return [dx * 0.35, 1];
      }
      // Scalp: radial from the crown, bending downward with distance (gravity).
      let dx = x - crown[0], dy = y - crown[1];
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const grav = Math.min(1, Math.max(0, (y - headC[1]) / (headR * 1.2)));
      dx = dx * (1 - grav * 0.7);
      dy = dy * (1 - grav) + grav;
      // A side parting / sweep for some styles.
      if (app.hair === 'swept' && y < headC[1]) dx += 0.6;
      return [dx, dy];
    };
    // Strand clumps: each clump is a few near-parallel strands of one value
    // (groove, body or lit), so the hair reads as locks rather than noise.
    const hiCol = mixc(hair.map((v) => Math.min(255, v * 1.9 + 28)), [255, 232, 196], 0.18);
    const loCol = hair.map((v) => v * 0.38);
    const N = Math.round(Math.min(900, hairPx * 16 * 0.09) * Math.min(1, 0.35 + 0.65 * k));
    let placed = 0;
    for (let tries = 0; tries < N * 8 && placed < N; tries++) {
      const x = R() * W, y = R() * H;
      if (!isHair(x, y)) continue;
      placed++;
      const base = at(x, y);
      const lum = (base[0] * 0.3 + base[1] * 0.59 + base[2] * 0.11) / 255;
      const litAmt = Math.min(1, Math.max(0, lum / Math.max(0.1, hairLum * 0.85) - 0.25));
      const pick = R();
      let col, a, w;
      if (pick < 0.45) { col = mixc(base, loCol, 0.5); a = 0.34; w = 0.9; }
      else if (pick < 0.45 + 0.4 * (1 - litAmt * 0.5)) { col = mixc(base, hair, 0.4); a = 0.3; w = 1.0; }
      else { col = mixc(base, hiCol, 0.25 + 0.35 * litAmt); a = 0.14 + 0.3 * litAmt; w = 0.6; }
      const longLocks = app.hair === 'long' || app.hair === 'wavy' || app.hair === 'braid' || (bearded && y > mouth[1]);
      const len = (longLocks ? 16 + R() * 22 : 7 + R() * 10) * k;
      const strands = (k < 0.6 ? 2 : 3) + Math.floor(R() * 4);
      const wob = (R() - 0.5) * 0.45 + (app.hair === 'wavy' ? 0.7 : 0) + (bearded && y > mouth[1] && app.race === 'dwarf' ? 0.35 : 0);
      const spread = (1.2 + R() * 1.6) * k;
      // One path per clump (strands share colour and width): far fewer stroke calls.
      hg.strokeStyle = rgba(col, a * (0.7 + R() * 0.3), 0.92 + R() * 0.16);
      hg.lineWidth = w * k * (0.6 + R() * 0.5);
      hg.beginPath();
      const steps = k < 0.6 ? 3 : 5;
      for (let sI = 0; sI < strands; sI++) {
        let [fx, fy] = flow(x, y);
        const fl0 = Math.hypot(fx, fy) || 1;
        fx /= fl0; fy /= fl0;
        const off = (sI - (strands - 1) / 2) * spread / strands * 2;
        let px = x - fy * off, py = y + fx * off;
        hg.moveTo(px, py);
        const ll = len * (0.75 + R() * 0.4);
        for (let st = 0; st < steps; st++) {
          let [dx, dy] = flow(px, py);
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl; dy /= dl;
          const curl = Math.sin(st * 1.1 + x * 0.07) * wob;
          const nx = dx * Math.cos(curl) - dy * Math.sin(curl);
          const ny = dx * Math.sin(curl) + dy * Math.cos(curl);
          px += nx * ll / steps;
          py += ny * ll / steps;
          hg.lineTo(px, py);
        }
      }
      hg.stroke();
    }
    // Clip to the hair with soft, slightly spilling edges (no cut-out hairline).
    const hm = layer(W, H);
    {
      const g2 = hm.getContext('2d');
      const im = g2.createImageData(W, H);
      for (let i = 0; i < W * H; i++) im.data[i * 4 + 3] = md[i * 4 + 1] > 110 ? 255 : 0;
      g2.putImageData(im, 0, 0);
    }
    hg.globalCompositeOperation = 'destination-in';
    hg.drawImage(softened(hm, Math.max(2, 3 * k)), 0, 0);
    hg.drawImage(softened(hm, Math.max(2, 3 * k)), 0, 0);
    g.drawImage(hl, 0, 0);
    // Soften the hard hairline: a feathered band where hair meets skin.
    const edge = layer(W, H);
    const eg = edge.getContext('2d');
    eg.drawImage(softened(hm, Math.max(3, 5 * k)), 0, 0);
    eg.globalCompositeOperation = 'destination-in';
    eg.drawImage(faceSoft, 0, 0);
    eg.globalCompositeOperation = 'source-in';
    eg.fillStyle = rgba(mixc(hair, skin, 0.35), 1, 0.7);
    eg.fillRect(0, 0, W, H);
    g.globalAlpha = 0.32;
    g.drawImage(edge, 0, 0);
    g.globalAlpha = 1;
  }
  void view.frames;
}

/**
 * Render the material-ID pass of a figure already posed in `scene` and paint
 * the finishing layer onto `out` (the finished render of the same view).
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} cam
 * @param {THREE.Object3D} fig  the miniature root (userData.frames)
 * @param {HTMLCanvasElement} out
 * @param {object} app  resolveAppearance()
 * @param {{mini?: boolean, key?: string}} [o]  mini: features only (snapshots of the whole figure)
 */
export function finishFace(renderer, scene, cam, fig, out, app, o = {}) {
  const W = out.width, H = out.height;
  const { maskMat: mm, blackMat: bm } = maskMaterials();
  const saved = [];
  fig.traverse((m) => {
    if (!m.isMesh) return;
    saved.push([m, m.material]);
    m.material = m.geometry.getAttribute('aMat') ? mm : bm;
  });
  const hidden = [];
  scene.traverse((m) => { if (m.isMesh && m.visible && !saved.some(([x]) => x === m)) { hidden.push(m); m.visible = false; } });
  const bgSaved = scene.background;
  scene.background = null;
  let mask;
  try {
    mask = renderToCanvas(renderer, scene, cam, { w: W, h: H, ss: 1, paint: false, key: o.key ?? 'faceMask' });
  } finally {
    for (const [m, mt] of saved) m.material = mt;
    for (const m of hidden) m.visible = true;
    scene.background = bgSaved;
  }
  const body = saved.find(([m]) => m.geometry.getAttribute('aMat'))?.[0];
  if (!body) return;
  body.updateMatrixWorld(true);
  cam.updateMatrixWorld();
  const fr = fig.userData.frames;
  const v = new THREE.Vector3();
  const { c: Hc0, R: HR0, hs: hs0 } = fr.face;
  const project = (p) => {
    const q = [p[0] * hs0, p[1] * hs0, p[2] * hs0];
    v.set(
      Hc0[0] + HR0[0] * q[0] + HR0[3] * q[1] + HR0[6] * q[2],
      Hc0[1] + HR0[1] * q[0] + HR0[4] * q[1] + HR0[7] * q[2],
      Hc0[2] + HR0[2] * q[0] + HR0[5] * q[1] + HR0[8] * q[2],
    ).applyMatrix4(body.matrixWorld).project(cam);
    return [(v.x + 1) * 0.5 * W, (1 - v.y) * 0.5 * H];
  };
  overpaintPortrait(out, mask, app, { project, frames: fr, mini: !!o.mini });
}
