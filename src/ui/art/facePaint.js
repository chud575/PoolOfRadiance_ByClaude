import { makeCanvas, rngOf, hexRgb } from './paint.js';

/**
 * Painted NPC portraits: an oil-sketch bust built the way a portrait painter
 * works, not a raw render. A head is roughed in as a 2.5D relief (soft-unioned
 * ellipsoids for skull, cheekbones, jaw, chin, brow, nose and lips, with the
 * eye sockets, temples and cheek hollows pressed in), lit by one warm key, and
 * then *painted*: the light is grouped into a few value families with a crisp
 * terminator (the planes of the face), shadows go cool and red at the turn,
 * blood warms the cheeks, nose and ears, and the whole is re-laid in short
 * strokes that follow the form. Over that the features are drawn by hand from
 * projected 3D landmarks (lidded almond eyes that share one gaze and one
 * catchlight, a lip line with a cupid's bow, carved nostrils, hair-stroke
 * brows), then hair as clumped, light-catching locks, beards, headwear and
 * the costume.
 *
 *   paintFace(design, W, H) → canvas
 *
 * design (see data/npcs.js `paint`): {seed, sex, age, skin, yaw, pitch, roll, gaze:[x,y],
 *   face:{w, jaw, chin, cheek, hollow, brow, neck}, nose:{len, w, hook, broken, tip},
 *   eyes:{c, size, lid, tilt}, mouth:{w, full, smile, c}, brows:{c, w, arch},
 *   hair:{style, c, part}, beard:{style, c}, head:{kind, c, trim}, scar, spectacles, quill,
 *   costume:{kind, a, b, c, trim, symbol}, bg:[a,b], aura, light}
 * Deterministic for a design (seeded strokes; no clocks).
 */

// ------------------------------------------------------------------ small maths

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const rgbOf = (c) => hexRgb(c);
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const css = (c, a = 1) => `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${a})`;

function matRot(yaw, pitch, roll) {
  // R = Ry(yaw) * Rx(pitch) * Rz(roll); head-local coords: x right, y down, z toward the viewer
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  return mul(Ry, mul(Rx, Rz));
}
function mul(A, B) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
}
const ap = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const tr = (M) => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];

// ------------------------------------------------------------------ the painter

export function paintFace(D, W = 600, H = 750) {
  const R = rngOf((D.seed ?? 7) * 9973 + 17);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const F = { w: 1, jaw: 1, chin: 1, cheek: 1, hollow: 0, brow: 1, neck: 1, ...(D.face ?? {}) };
  const fem = D.sex === 'f';
  const age = D.age ?? 0.3;
  const skin = rgbOf(D.skin ?? '#d9a77a');
  const U = W * 0.205 * (D.zoom ?? 1); // head half-width in px
  const cx = W * (0.5 + (D.dx ?? 0));
  const cy = H * (0.4 + (D.dy ?? 0));
  const HR = matRot(D.yaw ?? -0.3, D.pitch ?? 0.04, D.roll ?? 0);
  const NR = matRot((D.yaw ?? -0.3) * 0.45, 0, (D.roll ?? 0) * 0.3);
  const BR = matRot((D.yaw ?? -0.3) * 0.25, 0, 0);
  const rotOf = (grp) => (grp === 'body' ? BR : grp === 'neck' ? NR : HR);
  // body parts are hung from the neck base, which the head turns about
  const P = (p, grp = 'head') => {
    const q = ap(rotOf(grp), p);
    return [cx + q[0] * U, cy + q[1] * U, q[2]];
  };
  const L = norm3(D.key ?? [-0.62, -0.58, 0.55]); // key: high and to the left, in front
  const aura = rgbOf(D.aura ?? '#ffcf8a');
  const keyC = rgbOf(D.light ?? '#ffe6c8');

  // ---------------------------------------------------------------- background
  if (D.__pre) g.drawImage(D.__pre, 0, 0);
  else paintBackground(g, W, H, D, R, cx, cy, U);

  // ---------------------------------------------------------------- relief
  const prims = [];
  const E = (grp, mat, cc, rr, rot = null, k = 1) => prims.push({ grp, mat, c: cc, r: rr, rot, k });
  const w = F.w;
  const jw = F.jaw;
  // skull, face (one long mask narrowing to the jaw), forehead
  E('head', 'skin', [0, -0.36, -0.12], [0.98 * w, 1.0, 1.06]);
  E('head', 'skin', [0, 0.05, 0.22], [0.8 * w, 0.92, 0.78]);
  E('head', 'skin', [0, -0.5, 0.28], [0.78 * w, 0.56, 0.72]);
  // the jaw: the face mask is tapered toward the chin (see taper), a chin ball at its point
  E('head', 'skin', [0, 0.5, 0.12], [0.8 * w, 0.62, 0.7]);
  E('head', 'skin', [0, 0.96 * F.chin, 0.56], [0.27 * jw * (fem ? 0.8 : 1), 0.2, 0.28]);
  // the muzzle round the mouth, brow ridge, eyeballs under the lids
  E('head', 'skin', [0, 0.66, 0.68], [0.36, 0.3, 0.3]);
  E('head', 'skin', [0, -0.22, 0.68], [0.6, (fem ? 0.08 : 0.12) * F.brow, 0.17]);
  for (const s of [-1, 1]) E('head', 'skin', [s * 0.34, 0.03, 0.6], [0.17, 0.13, 0.13]);
  // nose: bridge, tip, wings (a broken nose kinks off the line)
  const N = { len: 1, w: 1, hook: 0, broken: 0, tip: 1, ...(D.nose ?? {}) };
  const nb = N.broken;
  E('head', 'skin', [nb * 0.03, 0.1 * N.len, 0.88], [0.075 * N.w, 0.3 * N.len, 0.13 + N.hook * 0.04], [-0.28, 0, nb * 0.25]);
  if (N.hook) E('head', 'skin', [0, 0.06, 0.97], [0.06, 0.1, 0.07]);
  if (nb) E('head', 'skin', [nb * 0.05, 0.12, 0.95], [0.08, 0.06, 0.07]);
  E('head', 'skin', [nb * 0.05, 0.42 * N.len, 1.0 + (N.len - 1) * 0.1], [0.11 * N.w * N.tip, 0.1 * N.tip, 0.1 * N.tip]);
  for (const s of [-1, 1]) E('head', 'skin', [s * 0.13 * N.w + nb * 0.04, 0.48 * N.len, 0.88], [0.085 * N.w, 0.07, 0.08]);
  // lips
  const M = { w: 1, full: 1, smile: 0, ...(D.mouth ?? {}) };
  E('head', 'lip', [0, 0.705, 0.92], [0.21 * M.w, 0.055 * M.full, 0.07 * M.full]);
  E('head', 'lip', [0, 0.815, 0.885], [0.18 * M.w, 0.07 * M.full, 0.08 * M.full]);
  // ears
  for (const s of [-1, 1]) E('head', 'ear', [s * 0.95 * w, 0.1, -0.12], [0.1, 0.28, 0.2], [0, s * 0.5, s * 0.1]);
  // neck and body (a bull neck is nearly as wide as the jaw); the shoulders sit close under the jaw
  E('neck', 'skin', [0, 1.1, -0.22], [0.47 * F.neck * (fem ? 0.86 : 1), 0.62, 0.46 * F.neck]);
  const cos = D.costume ?? {};
  const bw = D.build ?? 1;
  const shoulderW = (fem ? 1.35 : 1.55) * bw;
  for (const s of [-1, 1]) {
    E('body', 'cloth', [s * 0.7 * bw, 1.52, -0.4], [0.8, 0.24, 0.36], [0, 0, s * 0.36]);
    E('body', 'cloth', [s * shoulderW, 1.95, -0.35], [0.5, 0.42, 0.36]);
  }
  E('body', 'cloth', [0, 2.3, -0.25], [shoulderW + 0.15, 0.82, 0.48]);
  if (fem) for (const s of [-1, 1]) E('body', 'cloth', [s * 0.4, 2.42, 0.1], [0.36, 0.3, 0.3]);

  // the face narrows from the cheekbones to the jaw angle, then to the chin; a heavy jaw tapers less
  const jawK = clamp(0.32 / jw, 0.12, 0.42);
  const taper = (y) => 1 - jawK * sstep(0.15, 0.85, y) - (fem ? 0.2 : 0.12) * sstep(0.7, 1.2, y) * (1 / jw);
  const relief = buildRelief(prims, W, H, P, rotOf, U, { cx, cy, taper });
  const { Z, MAT, mask } = relief;

  // dents: sockets, temples, cheek hollows, the groove under the lower lip, the philtrum
  const dent = (p, sx, sy, amp, grp = 'head') => {
    const q = P(p, grp);
    gauss(Z, mask, W, H, q[0], q[1], sx * U, sy * U, -amp);
  };
  for (const s of [-1, 1]) {
    dent([s * 0.55 * w, 0.12, 0.5], 0.22, 0.13, -0.07 * F.cheek); // cheekbones (a raised plane)
    dent([s * 0.34, -0.02, 0.8], 0.22, 0.17, 0.09);
    dent([s * 0.76 * w, -0.32, 0.4], 0.16, 0.22, 0.05);
    dent([s * 0.5 * w, 0.5, 0.55], 0.16, 0.22, 0.06 * (F.hollow + 0.25));
    dent([s * 0.25, 0.58, 0.8], 0.06, 0.16, 0.025 + age * 0.03); // nasolabial
  }
  dent([0, 0.92, 0.9], 0.18, 0.05, 0.035);
  dent([0, 0.6, 1.0], 0.03, 0.06, 0.02);
  dent([0, 1.1, 0.2], 0.5, 0.14, 0.03, 'neck'); // under the jaw
  blurField(Z, mask, W, H, Math.max(1, Math.round(U * 0.02)));
  // the big forms: a broadly blurred copy decides light or shadow, so small bumps never break the planes
  const ZB = Float32Array.from(Z);
  blurField(ZB, mask, W, H, Math.round(U * 0.09));

  // ---------------------------------------------------------------- paint the light
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const pal = {
    skin: { base: skin, light: mixc(mixc(skin, [255, 236, 214], 0.28), keyC, 0.12), shade: mixc(mulc(skin, 0.42), [70, 40, 58], 0.35), turn: mixc(mulc(skin, 0.78), [200, 72, 60], 0.38), warm: [214, 92, 82] },
    lip: { base: mixc(skin, rgbOf(M.c ?? (fem ? '#b84852' : '#a86458')), fem ? 0.75 : 0.42) },
    ear: { base: mixc(skin, [220, 110, 96], 0.2) },
  };
  pal.lip.light = mixc(pal.lip.base, [255, 220, 210], 0.22); pal.lip.shade = mixc(mulc(pal.lip.base, 0.45), [60, 20, 40], 0.3); pal.lip.turn = mixc(pal.lip.base, [190, 40, 50], 0.3);
  pal.ear.light = mixc(pal.ear.base, [255, 230, 210], 0.25); pal.ear.shade = mixc(mulc(pal.ear.base, 0.45), [90, 30, 40], 0.35); pal.ear.turn = mixc(pal.ear.base, [210, 70, 60], 0.45);
  const clothA = rgbOf(cos.a ?? '#3a3a50');
  pal.cloth = { base: clothA, light: mixc(clothA, keyC, 0.22), shade: mixc(mulc(clothA, 0.35), [20, 18, 34], 0.3), turn: mulc(clothA, 0.7) };
  // warm zones (blood under the skin) and the cool beard shadow of a shaved man
  const warmZ = [];
  const zone = (p, sx, sy, k) => { const q = P(p); warmZ.push([q[0], q[1], sx * U, sy * U, k]); };
  for (const s of [-1, 1]) { zone([s * 0.48, 0.3, 0.6], 0.26, 0.2, fem ? 0.5 : 0.32); zone([s * 0.95, 0.1, -0.1], 0.14, 0.3, 0.6); }
  zone([0, 0.38, 1.05], 0.13, 0.13, 0.45);
  const coolZ = !fem && D.beard?.style !== 'full' && D.beard?.style !== 'long' ? P([0, 0.85, 0.7]) : null;
  const scalpZ = ['shaved', 'topknot', 'tonsure', 'bald'].includes(D.hair?.style) ? P([0, -0.9, 0.2]) : null;
  const rim = norm3([0.75, -0.25, -0.35]);
  const H3 = norm3([L[0], L[1], L[2] + 1]);
  const px = 2 / U;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const a = mask[i];
      if (!a) continue;
      const zx = (Z[i + 1] - Z[i - 1]) / px;
      const zy = (Z[i + W] - Z[i - W]) / px;
      const il = 1 / Math.hypot(zx, zy, 1);
      const nx = -zx * il, ny = -zy * il, nz = il;
      const lam = nx * L[0] + ny * L[1] + nz * L[2];
      const bx = (ZB[i + 1] - ZB[i - 1]) / px, by = (ZB[i + W] - ZB[i - W]) / px;
      const bl = 1 / Math.hypot(bx, by, 1);
      const lamB = (-bx * L[0] - by * L[1] + L[2]) * bl;
      const m = MAT[i];
      const pp = m === 1 ? pal.lip : m === 2 ? pal.ear : m === 3 ? pal.cloth : pal.skin;
      // value families: shadow | turn | halftone | light | highlight, with a crisp terminator
      const lit = sstep(0.1, 0.22, lamB * 0.75 + lam * 0.25);
      const up = sstep(0.4, 0.85, lamB * 0.5 + lam * 0.5);
      let col = mixc(pp.shade, pp.base, lit);
      col = mixc(col, pp.light, up * 0.85);
      const turn = Math.max(0, 1 - Math.abs(lamB * 0.75 + lam * 0.25 - 0.15) / 0.1) * (m === 3 ? 0.3 : 1);
      col = mixc(col, pp.turn, turn * 0.55);
      // bounce light into the shadows from below (the costume and the chest)
      const bounce = Math.max(0, nx * 0.3 + ny * 0.75 + nz * 0.2) * (1 - lit);
      col = mixc(col, mixc(pp.base, clothA, 0.4), bounce * 0.28);
      if (m !== 3) {
        // blood: cheeks, nose, ears; the shaved jaw goes cool; a shaved scalp takes a bluish sheen
        let wz = 0;
        for (const [zx0, zy0, sx, sy, k] of warmZ) wz += k * Math.exp(-(((x - zx0) / sx) ** 2 + ((y - zy0) / sy) ** 2));
        col = mixc(col, pal.skin.warm, Math.min(0.32, wz * 0.28) * (0.6 + 0.4 * lit));
        if (coolZ) { const dz = Math.exp(-(((x - coolZ[0]) / (U * 0.5)) ** 2 + ((y - coolZ[1]) / (U * 0.32)) ** 2)); col = mixc(col, [92, 100, 116], dz * (0.1 + age * 0.06)); }
        if (scalpZ && y < scalpZ[1] + U * 0.45) { const dz = Math.exp(-(((x - scalpZ[0]) / (U * 0.9)) ** 2 + ((y - scalpZ[1]) / (U * 0.6)) ** 2)); col = mixc(col, [110, 112, 124], dz * 0.14); }
        // a soft sheen on the forehead, nose tip, cheekbone tops and lower lip
        const hd = nx * H3[0] + ny * H3[1] + nz * H3[2];
        const sp = Math.pow(Math.max(0, hd), m === 1 ? 26 : 36) * (m === 1 ? 0.55 : 0.32 + (scalpZ && y < scalpZ[1] + U * 0.4 ? 0.3 : 0));
        col = mixc(col, [255, 246, 232], sp);
      }
      // rim of the aura from behind on the right
      const rk = Math.pow(Math.max(0, 1 - nz), 2.4) * Math.max(0, nx * rim[0] + ny * rim[1] + 0.3);
      col = mixc(col, mixc(aura, [255, 255, 255], 0.2), clamp(rk * 0.75));
      const o = i * 4;
      const aa = a / 255;
      d[o] = d[o] * (1 - aa) + col[0] * aa;
      d[o + 1] = d[o + 1] * (1 - aa) + col[1] * aa;
      d[o + 2] = d[o + 2] * (1 - aa) + col[2] * aa;
    }
  }
  // cavities: wherever the surface sits below its blurred self (sockets, nostrils, mouth corners, under the jaw)
  cavity(d, Z, mask, W, H, Math.round(U * 0.09), 0.55);
  // skin mottling
  const nr = rngOf((D.seed ?? 7) + 3);
  for (let k = 0; k < W * H * 0.02; k++) {
    const x = Math.floor(nr() * W); const y = Math.floor(nr() * H); const i = y * W + x;
    if (!mask[i] || MAT[i] === 3) continue;
    const o = i * 4; const v = (nr() - 0.5) * 14;
    d[o] += v; d[o + 1] += v * 0.8; d[o + 2] += v * 0.7;
  }
  g.putImageData(img, 0, 0);
  // the painterly pass: short strokes that follow the form, laid in the colour beneath
  brushOver(g, d, mask, Z, W, H, U, R);

  // ---------------------------------------------------------------- costume and features
  const ctx = { g, W, H, U, P, R, D, fem, age, skin, pal, cx, cy, HR, L, aura, F, N, M, w };
  paintCostume(ctx);
  paintEars(ctx);
  paintEyes(ctx);
  paintBrows(ctx);
  paintNose(ctx);
  paintMouth(ctx);
  paintAge(ctx);
  if (D.scar) paintScar(ctx);
  paintBeard(ctx);
  paintHair(ctx, 'front');
  paintHeadwear(ctx);
  if (D.spectacles) paintSpectacles(ctx);
  if (D.quill) paintQuill(ctx);

  // ---------------------------------------------------------------- finish
  finish(g, W, H, D, R);
  return c;
}

// ------------------------------------------------------------------ relief

function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

function buildRelief(prims, W, H, P, rotOf, U, warp = null) {
  const Z = new Float32Array(W * H).fill(-1e9);
  const S = new Float32Array(W * H);
  const BEST = new Float32Array(W * H).fill(-1e9);
  const MAT = new Uint8Array(W * H);
  const cov = new Float32Array(W * H);
  const K = 0.1; // smooth-union radius, head units
  const matId = { skin: 0, lip: 1, ear: 2, cloth: 3 };
  for (const p of prims) {
    const RM = rotOf(p.grp);
    const local = p.rot ? matRot(p.rot[1], p.rot[0], p.rot[2]) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const full = mul(RM, local);
    const C = ap(RM, p.c);
    // inverse: q = diag(1/r) * full^T * (X - C)
    const FT = tr(full);
    const Minv = [FT[0] / p.r[0], FT[1] / p.r[0], FT[2] / p.r[0], FT[3] / p.r[1], FT[4] / p.r[1], FT[5] / p.r[1], FT[6] / p.r[2], FT[7] / p.r[2], FT[8] / p.r[2]];
    const m2 = [Minv[2], Minv[5], Minv[8]];
    const a = m2[0] * m2[0] + m2[1] * m2[1] + m2[2] * m2[2];
    const ext = Math.max(p.r[0], p.r[1], p.r[2]);
    const sx = P(p.c, p.grp);
    const x0 = Math.max(0, Math.floor(sx[0] - ext * U - 2)), x1 = Math.min(W - 1, Math.ceil(sx[0] + ext * U + 2));
    const y0 = Math.max(0, Math.floor(sx[1] - ext * U - 2)), y1 = Math.min(H - 1, Math.ceil(sx[1] + ext * U + 2));
    const id = matId[p.mat] ?? 0;
    const cx = (sx[0] - C[0] * U); // screen origin of head space
    const cy = (sx[1] - C[1] * U);
    const tp = warp && p.grp === 'head';
    for (let y = y0; y <= y1; y++) {
      const Y = (y - cy) / U - C[1];
      const tk = tp ? warp.taper((y - warp.cy) / U) : 1;
      for (let xx = x0; xx <= x1; xx++) {
        // the head is drawn tapered: sample the untapered prims further out from the axis
        const x = tp ? warp.cx + (xx - warp.cx) / tk : xx;
        const X = (x - cx) / U - C[0];
        const q0 = [Minv[0] * X + Minv[1] * Y + Minv[2] * -C[2], Minv[3] * X + Minv[4] * Y + Minv[5] * -C[2], Minv[6] * X + Minv[7] * Y + Minv[8] * -C[2]];
        const b = 2 * (q0[0] * m2[0] + q0[1] * m2[1] + q0[2] * m2[2]);
        const cc = q0[0] * q0[0] + q0[1] * q0[1] + q0[2] * q0[2] - 1;
        const disc = b * b - 4 * a * cc;
        const i = y * W + xx;
        if (disc <= 0) continue;
        const z = (-b + Math.sqrt(disc)) / (2 * a) + 0;
        // coverage: antialias the silhouette from the chord length
        const edge = Math.min(1, Math.sqrt(disc) / (2 * a) * U * 0.9 * tk);
        if (edge > cov[i]) cov[i] = Math.max(cov[i], edge);
        S[i] += Math.exp(Math.min(40, z / K));
        if (z > BEST[i]) { BEST[i] = z; MAT[i] = id; }
      }
    }
  }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (S[i] > 0) { Z[i] = K * Math.log(S[i]); mask[i] = Math.round(255 * Math.min(1, cov[i])); }
  }
  // fill outside with the nearest-ish depth so gradients at the rim stay sane
  for (let i = 0; i < W * H; i++) if (!S[i]) Z[i] = -3;
  return { Z, MAT, mask };
}

function gauss(Z, mask, W, H, gx, gy, sx, sy, amp) {
  const x0 = Math.max(0, Math.floor(gx - sx * 3)), x1 = Math.min(W - 1, Math.ceil(gx + sx * 3));
  const y0 = Math.max(0, Math.floor(gy - sy * 3)), y1 = Math.min(H - 1, Math.ceil(gy + sy * 3));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    Z[i] += amp * Math.exp(-(((x - gx) / sx) ** 2 + ((y - gy) / sy) ** 2));
  }
}

function blurField(Z, mask, W, H, r) {
  const T = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      let acc = 0, n = 0;
      for (let x = -r; x < W + r; x++) {
        const xa = x + r; if (xa < W) { acc += Z[y * W + xa]; n++; }
        const xb = x - r - 1; if (xb >= 0) { acc -= Z[y * W + xb]; n--; }
        if (x >= 0 && x < W) T[y * W + x] = acc / n;
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0, n = 0;
      for (let y = -r; y < H + r; y++) {
        const ya = y + r; if (ya < H) { acc += T[ya * W + x]; n++; }
        const yb = y - r - 1; if (yb >= 0) { acc -= T[yb * W + x]; n--; }
        if (y >= 0 && y < H) { const i = y * W + x; if (mask[i]) Z[i] = acc / n; }
      }
    }
  }
}

function cavity(d, Z, mask, W, H, r, k) {
  const B = Float32Array.from(Z);
  blurField(B, mask, W, H, r);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const c = clamp((B[i] - Z[i]) * 9, 0, 1) * k;
    if (c <= 0) continue;
    const o = i * 4;
    // occlusion is warm and dark, never grey
    d[o] *= 1 - c * 0.85; d[o + 1] *= 1 - c * 0.95; d[o + 2] *= 1 - c * 0.9;
  }
}

/** Re-lay the paint in short strokes along the form (perpendicular to the depth gradient). */
function brushOver(g, d, mask, Z, W, H, U, R) {
  g.save();
  g.lineCap = 'round';
  const n = Math.round(W * H * 0.012);
  for (let k = 0; k < n; k++) {
    const x = 2 + Math.floor(R() * (W - 4));
    const y = 2 + Math.floor(R() * (H - 4));
    const i = y * W + x;
    if (mask[i] < 250) continue;
    const zx = Z[i + 1] - Z[i - 1];
    const zy = Z[i + W] - Z[i - W];
    let ax = -zy, ay = zx;
    const l = Math.hypot(ax, ay);
    if (l < 1e-6) { ax = 1; ay = 0.3; } else { ax /= l; ay /= l; }
    const o = i * 4;
    const len = U * (0.06 + R() * 0.1);
    const j = (R() - 0.5) * 16;
    g.strokeStyle = `rgba(${Math.round(d[o] + j)},${Math.round(d[o + 1] + j * 0.7)},${Math.round(d[o + 2] + j * 0.5)},${0.45 + R() * 0.35})`;
    g.lineWidth = U * (0.025 + R() * 0.035);
    g.beginPath();
    g.moveTo(x - ax * len * 0.5, y - ay * len * 0.5);
    g.quadraticCurveTo(x + ay * len * 0.08, y - ax * len * 0.08, x + ax * len * 0.5, y + ay * len * 0.5);
    g.stroke();
  }
  g.restore();
}

// ------------------------------------------------------------------ background & finish

function paintBackground(g, W, H, D, R, cx, cy, U) {
  const [b0, b1] = D.bg ?? ['#5a4430', '#0c0806'];
  const bg = g.createRadialGradient(cx - U * 0.6, cy - U * 0.4, U * 0.2, cx, cy + U, H * 0.9);
  bg.addColorStop(0, b0);
  bg.addColorStop(0.55, css(mixc(rgbOf(b0), rgbOf(b1), 0.6)));
  bg.addColorStop(1, b1);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // loose scumbled strokes
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = R() * W; const y = R() * H; const a = -0.9 + R() * 0.6; const l = W * (0.04 + R() * 0.14);
    g.strokeStyle = R() < 0.5 ? css(mixc(rgbOf(b0), [255, 230, 190], 0.15), 0.06) : css(rgbOf(b1), 0.1);
    g.lineWidth = W * (0.01 + R() * 0.03);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // the aura as a glow behind the head
  const au = rgbOf(D.aura ?? '#ffcf8a');
  const gl = g.createRadialGradient(cx + U * 0.5, cy - U * 0.3, 0, cx + U * 0.5, cy - U * 0.3, U * 2.4);
  gl.addColorStop(0, css(au, 0.22));
  gl.addColorStop(1, css(au, 0));
  g.fillStyle = gl;
  g.fillRect(0, 0, W, H);
  g.restore();
}

function finish(g, W, H, D, R) {
  // warm glaze, vignette, canvas tooth
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(190,130,70,0.28)';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(W * 0.48, H * 0.42, H * 0.25, W * 0.5, H * 0.5, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(8,4,2,0.6)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  // canvas tooth: a fine irregular weave of light and dark flecks
  for (let k = 0; k < W * H * 0.02; k++) {
    const x = R() * W; const y = R() * H;
    g.fillStyle = R() < 0.5 ? 'rgba(255,240,210,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(x, y, 1 + R() * 2, 1);
  }
  g.restore();
}

// ------------------------------------------------------------------ drawing helpers

/** Catmull-Rom through 2D points → dense polyline. */
function spline(pts, seg = 8) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** A tapered stroke along a polyline (closed ribbon), widths from w0 → w1 (or a function of t). */
function ribbon(g, line, w0, w1) {
  const n = line.length;
  const L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const t = i / (n - 1);
    const wv = (typeof w0 === 'function' ? w0(t) : lerp(w0, w1, t)) / 2;
    L.push([line[i][0] - ty * wv, line[i][1] + tx * wv]);
    Rr.push([line[i][0] + ty * wv, line[i][1] - tx * wv]);
  }
  g.beginPath();
  g.moveTo(L[0][0], L[0][1]);
  for (const p of L) g.lineTo(p[0], p[1]);
  for (let i = n - 1; i >= 0; i--) g.lineTo(Rr[i][0], Rr[i][1]);
  g.closePath();
}

function strokeLine(g, line, width, color, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(line[0][0], line[0][1]);
  for (const p of line) g.lineTo(p[0], p[1]);
  g.stroke();
  g.restore();
}

function softDot(g, x, y, r, color, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, css(color, a));
  gr.addColorStop(1, css(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

// ------------------------------------------------------------------ features

function paintEyes(ctx) {
  const { g, U, P, D, fem, age, HR, skin } = ctx;
  const E = { c: '#5a4030', size: 1, lid: 0, tilt: 0, ...(D.eyes ?? {}) };
  const gz = D.gaze ?? [0, 0];
  // the gaze is a direction in the viewer's space, so both eyes converge on one point
  const gazeCam = norm3([gz[0], gz[1], 1]);
  const gazeLocal = ap(tr(HR), gazeCam);
  const iris = rgbOf(E.c);
  for (const s of [-1, 1]) {
    const sz = E.size * (fem ? 1.06 : 1);
    const ball = [s * 0.34, 0.03, 0.6];
    const inner = [s * 0.18, 0.05, 0.84];
    const outer = [s * (0.5 + 0.02 * sz), 0.02 - E.tilt * 0.04 - (fem ? 0.02 : 0), 0.7];
    const upH = (0.1 - E.lid * 0.035 - age * 0.012) * sz;
    const loH = 0.045 * sz;
    const up = [], lo = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const base = [lerp(inner[0], outer[0], t), lerp(inner[1], outer[1], t), lerp(inner[2], outer[2], t) + Math.sin(Math.PI * t) * 0.06];
      // the upper lid peaks toward the inner third, the lower lid dips toward the outer third
      const ut = Math.sin(Math.PI * Math.pow(t, s < 0 ? 0.8 : 0.8));
      const lt = Math.sin(Math.PI * Math.pow(t, 1.35));
      up.push(P([base[0], base[1] - upH * ut, base[2] + 0.02 * ut]));
      lo.push(P([base[0], base[1] + loH * lt, base[2]]));
    }
    const almond = () => {
      g.beginPath();
      g.moveTo(up[0][0], up[0][1]);
      for (const p of up) g.lineTo(p[0], p[1]);
      for (let k = lo.length - 1; k >= 0; k--) g.lineTo(lo[k][0], lo[k][1]);
      g.closePath();
    };
    const ew = Math.hypot(up[12][0] - up[0][0], up[12][1] - up[0][1]);
    // sclera, shaded: corners and the top (under the lid) darker
    g.save();
    almond();
    g.clip();
    const sc = mixc([232, 222, 208], skin, 0.18);
    const mid = P([s * 0.34, 0.02, 0.86]);
    const sg = g.createRadialGradient(mid[0], mid[1] + ew * 0.05, ew * 0.05, mid[0], mid[1], ew * 0.6);
    sg.addColorStop(0, css(sc));
    sg.addColorStop(1, css(mixc(sc, [120, 90, 90], 0.55)));
    g.fillStyle = sg;
    g.fillRect(mid[0] - ew, mid[1] - ew, ew * 2, ew * 2);
    // iris on the eyeball, turned by the shared gaze
    const ic = P([ball[0] + gazeLocal[0] * 0.2, ball[1] + gazeLocal[1] * 0.2, ball[2] + gazeLocal[2] * 0.2]);
    const ir = ew * 0.27 * (fem ? 1.04 : 1);
    const foreX = Math.max(0.55, Math.abs(ap(HR, gazeLocal)[2]));
    g.save();
    g.translate(ic[0], ic[1]);
    g.scale(foreX, 1);
    const ig = g.createRadialGradient(0, 0, ir * 0.15, 0, 0, ir);
    ig.addColorStop(0, css(mixc(iris, [255, 240, 200], 0.25)));
    ig.addColorStop(0.55, css(iris));
    ig.addColorStop(0.85, css(mulc(iris, 0.6)));
    ig.addColorStop(1, css(mulc(iris, 0.25)));
    g.fillStyle = ig;
    g.beginPath(); g.arc(0, 0, ir, 0, Math.PI * 2); g.fill();
    // radial fibres
    g.strokeStyle = css(mixc(iris, [255, 230, 190], 0.35), 0.35);
    g.lineWidth = Math.max(0.6, ir * 0.06);
    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * ir * 0.35, Math.sin(a) * ir * 0.35); g.lineTo(Math.cos(a) * ir * 0.8, Math.sin(a) * ir * 0.8); g.stroke(); }
    g.fillStyle = '#080506';
    g.beginPath(); g.arc(0, 0, ir * 0.38, 0, Math.PI * 2); g.fill();
    g.restore();
    // the upper lid casts its shadow across the top of the eye
    const lg = g.createLinearGradient(0, mid[1] - ew * 0.3, 0, mid[1] + ew * 0.05);
    lg.addColorStop(0, 'rgba(40,18,14,0.75)');
    lg.addColorStop(1, 'rgba(40,18,14,0)');
    g.fillStyle = lg;
    g.fillRect(mid[0] - ew, mid[1] - ew, ew * 2, ew * 1.05);
    // one catchlight, up and toward the key, the same in both eyes
    g.fillStyle = 'rgba(255,252,244,0.95)';
    g.beginPath(); g.ellipse(ic[0] - ir * 0.38, ic[1] - ir * 0.42, ir * 0.2, ir * 0.17, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,252,244,0.35)';
    g.beginPath(); g.arc(ic[0] + ir * 0.35, ic[1] + ir * 0.35, ir * 0.09, 0, Math.PI * 2); g.fill();
    g.restore();
    // inner corner (caruncle)
    softDot(g, lerp(up[0][0], lo[0][0], 0.5) + s * ew * 0.03, lerp(up[0][1], lo[0][1], 0.5), ew * 0.08, [196, 110, 104], 0.8);
    // lid margin: a dark lash line on top, heavier at the outer corner; a lighter waterline below
    const lash = fem ? [26, 12, 10] : [40, 20, 14];
    g.save();
    g.fillStyle = css(lash, 0.92);
    ribbon(g, up, (t) => ew * (fem ? 0.075 : 0.055) * (0.35 + 0.8 * Math.pow(t, s < 0 ? 1.2 : 1.2)) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.1))));
    g.fill();
    if (fem) {
      // a flick of lashes off the outer corner
      const o = up[12]; const p = up[10];
      const dx = o[0] - p[0], dy = o[1] - p[1];
      strokeLine(g, [o, [o[0] + dx * 0.9, o[1] + dy * 0.9 - ew * 0.04]], ew * 0.035, css(lash), 0.9);
    }
    strokeLine(g, lo.slice(2), ew * 0.025, css(mixc(skin, [120, 60, 50], 0.5)), 0.55);
    strokeLine(g, lo.slice(3, 12).map((p) => [p[0], p[1] + ew * 0.035]), ew * 0.03, css(mixc(skin, [255, 230, 210], 0.4)), 0.3);
    // the lid crease, and on the older a heavy fold and pouches below
    const crease = up.map((p, k) => [p[0], p[1] - ew * (0.13 + 0.06 * Math.sin(Math.PI * k / 12)) - E.lid * ew * 0.04]);
    strokeLine(g, crease.slice(1, 12), ew * 0.035, css(mixc(skin, [90, 40, 34], 0.55)), 0.45);
    strokeLine(g, crease.slice(2, 11).map((p) => [p[0], p[1] - ew * 0.03]), ew * 0.03, css(mixc(skin, [255, 236, 214], 0.35)), 0.3);
    if (age > 0.4) {
      const bag = lo.map((p, k) => [p[0], p[1] + ew * (0.14 + 0.05 * Math.sin(Math.PI * k / 12))]);
      strokeLine(g, bag.slice(3, 11), ew * 0.03, css(mixc(skin, [90, 40, 34], 0.5)), 0.35 * age);
    }
    g.restore();
  }
}

function paintBrows(ctx) {
  const { g, U, P, D, fem, age, R } = ctx;
  const B = { c: D.hair?.c ?? '#3a2416', w: 1, arch: 0, ...(D.brows ?? {}) };
  const col = rgbOf(B.c);
  for (const s of [-1, 1]) {
    const pts = [[0.12, -0.17], [0.27, -0.24 - B.arch * 0.03], [0.42, -0.255 - B.arch * 0.05], [0.58, -0.2]].map(([x, y]) => P([s * x, y + (fem ? -0.02 : 0), 0.82 - Math.abs(x) * 0.25]));
    const line = spline(pts, 6);
    // a soft base tone, then individual hairs: upright at the head of the brow, lying along it toward the tail
    g.save();
    g.fillStyle = css(col, 0.35);
    ribbon(g, line, (t) => U * (fem ? 0.05 : 0.07) * B.w * (1 - t * 0.7));
    g.filter = `blur(${(U * 0.012).toFixed(1)}px)`;
    g.fill();
    g.filter = 'none';
    const n = Math.round(60 * B.w);
    for (let k = 0; k < n; k++) {
      const t = R();
      const i = Math.min(line.length - 2, Math.floor(t * (line.length - 1)));
      const p = line[i]; const q = line[i + 1];
      let tx = q[0] - p[0], ty = q[1] - p[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const wv = U * (fem ? 0.045 : 0.06) * B.w * (1 - t * 0.7);
      const off = (R() - 0.5) * wv;
      const bx = p[0] - ty * off, by = p[1] + tx * off;
      const up = (1 - t) * 0.9;
      const dx = tx * (1 - up) + -ty * up * 0 + (0) ; const dy = ty * (1 - up) - up;
      const hl = U * (0.05 + R() * 0.04);
      const grey = age > 0.5 && R() < age * 0.6;
      g.strokeStyle = css(grey ? [200, 194, 186] : mulc(col, 0.8 + R() * 0.5), 0.7);
      g.lineWidth = Math.max(0.7, U * 0.008);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + dx * hl * s * (s < 0 ? 1 : 1) * (tx >= 0 ? 1 : 1), by + dy * hl); g.stroke();
    }
    g.restore();
  }
}

function paintNose(ctx) {
  const { g, U, P, N, skin } = ctx;
  const nb = N.broken;
  // nostrils: dark commas tucked under the wings
  for (const s of [-1, 1]) {
    const a = P([s * 0.1 * N.w + nb * 0.04, 0.53 * N.len, 0.99]);
    const b = P([s * 0.05 * N.w + nb * 0.04, 0.555 * N.len, 1.02]);
    g.save();
    g.fillStyle = css(mixc(mulc(skin, 0.25), [60, 10, 10], 0.4), 0.85);
    g.beginPath(); g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, U * 0.045 * N.w, U * 0.02, Math.atan2(b[1] - a[1], b[0] - a[0]), 0, Math.PI * 2);
    g.fill();
    g.restore();
    // the crease of each wing
    const w0 = P([s * 0.19 * N.w + nb * 0.04, 0.42 * N.len, 0.88]); const w1 = P([s * 0.21 * N.w + nb * 0.04, 0.5 * N.len, 0.9]); const w2 = P([s * 0.14 * N.w + nb * 0.04, 0.55 * N.len, 0.96]);
    strokeLine(g, spline([w0, w1, w2], 5), U * 0.02, css(mixc(skin, [80, 30, 26], 0.6)), 0.5);
  }
  // a highlight down the bridge and on the tip
  const b0 = P([nb * 0.0 - 0.02, -0.02, 0.97]); const b1 = P([nb * 0.04 - 0.02, 0.3 * N.len, 1.08]);
  strokeLine(g, [b0, b1], U * 0.03, css(mixc(skin, [255, 240, 225], 0.5)), 0.35);
  const tip = P([nb * 0.05 - 0.03, 0.4 * N.len, 1.13]);
  softDot(g, tip[0], tip[1], U * 0.05, [255, 244, 232], 0.55);
  if (nb) {
    // the old break: a bump and a pale scar on the bridge
    const k = P([nb * 0.04, 0.1, 1.0]);
    strokeLine(g, [[k[0] - U * 0.04, k[1]], [k[0] + U * 0.03, k[1] + U * 0.02]], U * 0.015, css(mixc(skin, [255, 230, 220], 0.5)), 0.6);
  }
}

function paintMouth(ctx) {
  const { g, U, P, M, fem, skin, pal, age } = ctx;
  const sm = M.smile;
  const mw = M.w;
  const cy0 = 0.765;
  const corner = (s) => P([s * 0.25 * mw, cy0 - sm * 0.05, 0.84]);
  const parting = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10 * 2 - 1; // -1..1
    const x = t * 0.25 * mw;
    const y = cy0 + (1 - t * t) * 0.012 - sm * 0.05 * t * t + (Math.abs(t) < 0.18 ? 0.008 : 0);
    parting.push(P([x, y, 0.84 + (1 - t * t) * 0.13]));
  }
  // upper lip: a cupid's bow over the parting
  const upLip = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10 * 2 - 1;
    const x = t * 0.25 * mw;
    const bow = Math.abs(t) < 0.3 ? 0.02 * (1 - Math.cos(Math.abs(t) / 0.3 * Math.PI)) * 0.5 : 0;
    const y = cy0 - (0.06 * M.full) * (1 - Math.pow(Math.abs(t), 1.6)) - bow * (fem ? 1.3 : 0.8) + 0.02 * (t === 0 ? 0 : 0) - sm * 0.05 * t * t;
    upLip.push(P([x, y - (Math.abs(t) < 0.3 ? -bow * 1.4 + 0.008 : 0), 0.86 + (1 - t * t) * 0.13]));
  }
  const loLip = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10 * 2 - 1;
    const x = t * 0.23 * mw;
    const y = cy0 + 0.085 * M.full * (1 - Math.pow(Math.abs(t), 1.8)) - sm * 0.05 * t * t;
    loLip.push(P([x, y, 0.84 + (1 - t * t) * 0.12]));
  }
  const lipC = pal.lip.base;
  const shape = (top, bot) => { g.beginPath(); g.moveTo(top[0][0], top[0][1]); for (const p of top) g.lineTo(p[0], p[1]); for (let k = bot.length - 1; k >= 0; k--) g.lineTo(bot[k][0], bot[k][1]); g.closePath(); };
  g.save();
  // colour the lips over the modelled form: upper lip in shade (it faces down), lower lip catching light
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = fem ? 0.85 : 0.45;
  shape(upLip, parting);
  g.fillStyle = css(mixc(lipC, [255, 255, 255], 0.25));
  g.fill();
  shape(parting, loLip);
  g.fillStyle = css(mixc(lipC, [255, 255, 255], 0.4));
  g.fill();
  g.restore();
  g.save();
  shape(upLip, parting);
  g.fillStyle = css(mulc(lipC, 0.75), fem ? 0.45 : 0.25);
  g.fill();
  // a crisp edge to the upper lip (the vermilion border catches light)
  strokeLine(g, upLip, U * 0.014, css(mixc(skin, [255, 236, 220], 0.4)), fem ? 0.35 : 0.2);
  // lower lip highlight
  const hl = loLip.slice(3, 8).map((p, k) => [p[0], p[1] - U * 0.03]);
  strokeLine(g, hl, U * 0.028, 'rgba(255,240,232,1)', fem ? 0.45 : 0.22);
  // the parting line: darkest at the centre and in the corners
  g.fillStyle = css(mixc(mulc(lipC, 0.25), [30, 6, 8], 0.5), 0.92);
  ribbon(g, parting, (t) => U * (0.012 + 0.018 * Math.max(0, 1 - Math.abs(t - 0.5) * 3) + 0.012 * Math.pow(Math.abs(t - 0.5) * 2, 6)));
  g.fill();
  // corners tucked in, lifted by a smile
  for (const s of [-1, 1]) {
    const q = corner(s);
    softDot(g, q[0], q[1], U * 0.04, [60, 20, 18], 0.5);
    if (sm > 0.2) strokeLine(g, [q, [q[0] + s * U * 0.03, q[1] - U * 0.04 * sm]], U * 0.012, css(mixc(skin, [80, 30, 26], 0.6)), 0.4);
  }
  // shadow under the lower lip
  const ul = loLip.slice(2, 9).map((p) => [p[0], p[1] + U * 0.035]);
  strokeLine(g, ul, U * 0.05, css(mixc(mulc(skin, 0.4), [60, 20, 30], 0.3)), 0.3);
  g.restore();
}

function paintEars(ctx) {
  const { g, U, P, skin } = ctx;
  for (const s of [-1, 1]) {
    const q = P([s * 1.0, 0.1, -0.1]);
    const z = ap(ctx.HR, [s, 0, 0])[2];
    if (z < -0.2) continue; // the far ear hides behind the head
    // the helix rim and the dark bowl of the concha
    const pts = [[s * 0.98, -0.12, -0.05], [s * 1.06, 0.0, -0.12], [s * 1.06, 0.2, -0.14], [s * 1.0, 0.34, -0.08]].map((p) => P(p));
    strokeLine(g, spline(pts, 5), U * 0.025, css(mixc(skin, [255, 220, 200], 0.3)), 0.45);
    softDot(g, q[0] - s * U * 0.01, q[1] + U * 0.05, U * 0.05, [80, 30, 26], 0.55);
  }
}

function paintAge(ctx) {
  const { g, U, P, age, skin, D } = ctx;
  if (age < 0.3) return;
  const line = (pts, wdt, a) => {
    const p = spline(pts.map((x) => P(x)), 5);
    strokeLine(g, p, U * wdt, css(mixc(skin, [80, 34, 28], 0.6)), a);
    strokeLine(g, p.map((q) => [q[0], q[1] + U * 0.018]), U * wdt * 0.8, css(mixc(skin, [255, 236, 214], 0.35)), a * 0.5);
  };
  const hid = (D.beard?.style === 'full' || D.beard?.style === 'long');
  for (const s of [-1, 1]) {
    if (!hid) line([[s * 0.19, 0.5, 0.92], [s * 0.27, 0.64, 0.86], [s * 0.3, 0.8, 0.8]], 0.016, 0.55 * age); // nasolabial
    line([[s * 0.56, -0.02, 0.62], [s * 0.64, 0.04, 0.55]], 0.01, 0.4 * age); // crow's feet
    line([[s * 0.55, 0.06, 0.62], [s * 0.63, 0.14, 0.55]], 0.009, 0.35 * age);
  }
  for (let k = 0; k < 3; k++) line([[-0.42, -0.5 - k * 0.1, 0.72], [0, -0.53 - k * 0.1, 0.84], [0.42, -0.5 - k * 0.1, 0.72]], 0.009, 0.32 * age);
  line([[-0.1, -0.12, 0.86], [-0.06, -0.3, 0.86]], 0.01, 0.4 * age);
  line([[0.1, -0.12, 0.86], [0.06, -0.3, 0.86]], 0.01, 0.4 * age);
}

function paintScar(ctx) {
  const { g, U, P, skin, D } = ctx;
  const pts = (D.scar === true ? [[0.22, -0.52, 0.8], [0.34, -0.12, 0.84], [0.44, 0.18, 0.74], [0.5, 0.42, 0.64]] : D.scar).map((p) => P(p));
  const line = spline(pts, 6);
  strokeLine(g, line.map((p) => [p[0] + U * 0.012, p[1] + U * 0.006]), U * 0.035, css(mixc(skin, [120, 40, 40], 0.6)), 0.5);
  strokeLine(g, line, U * 0.022, css(mixc(skin, [255, 224, 214], 0.55)), 0.85);
  for (let i = 2; i < line.length - 2; i += 4) {
    const p = line[i];
    strokeLine(g, [[p[0] - U * 0.03, p[1] + U * 0.012], [p[0] + U * 0.03, p[1] - U * 0.012]], U * 0.008, css(mixc(skin, [255, 220, 210], 0.4)), 0.5);
  }
}

// ------------------------------------------------------------------ hair

function hairPal(c) {
  const b = rgbOf(c);
  return { base: b, dark: mixc(mulc(b, 0.35), [20, 10, 14], 0.3), light: mixc(b, [255, 240, 210], 0.4), hi: mixc(b, [255, 250, 235], 0.7) };
}

/**
 * One clump of hair: a tapered ribbon that may wave, its base tone, a shadowed edge on the side away
 * from the key, strands along it, and light caught in bands across each wave crest.
 * o: {grp, taper, wave (amplitude in head units), freq (waves along the lock), ph, strands, sheen, edge, value}
 */
function lock(ctx, pts3, w0, w1, hp, o = {}) {
  const { g, U, P, R } = ctx;
  let line = spline(pts3.map((p) => P(p, o.grp ?? 'head')), 10);
  const n = line.length;
  const nrm = (i) => {
    const q = line[Math.min(n - 1, i + 1)], pp = line[Math.max(0, i - 1)];
    let tx = q[0] - pp[0], ty = q[1] - pp[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    return [-ty, tx, tx, ty];
  };
  const amp = (o.wave === true ? 0.05 : o.wave ?? 0) * U;
  const fr = o.freq ?? 3;
  const ph = o.ph ?? 0;
  if (amp) {
    line = line.map((p, i) => {
      const t = i / (n - 1);
      const [nx, ny] = nrm(i);
      const k = Math.sin(t * fr * Math.PI * 2 + ph) * amp * Math.min(1, t * 4);
      return [p[0] + nx * k, p[1] + ny * k];
    });
  }
  const wf = (t) => U * lerp(w0, w1, Math.pow(t, o.taper ?? 1));
  const val = o.value ?? 1;
  const base = mulc(hp.base, val);
  g.save();
  ribbon(g, line, wf);
  g.fillStyle = css(base);
  g.fill();
  g.clip();
  // the shadowed side of the clump (away from the light, i.e. on the right of a falling lock)
  const sideL = [], sideR = [];
  for (let i = 0; i < n; i++) {
    const q = line[Math.min(n - 1, i + 1)], pp = line[Math.max(0, i - 1)];
    let tx = q[0] - pp[0], ty = q[1] - pp[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const wv = wf(i / (n - 1)) * 0.38;
    // the side whose outward normal points away from the key (screen right / down)
    const nx = -ty, ny = tx;
    const away = nx * 0.75 + ny * 0.3 > 0 ? 1 : -1;
    sideR.push([line[i][0] + nx * wv * away, line[i][1] + ny * wv * away]);
    sideL.push([line[i][0] - nx * wv * away, line[i][1] - ny * wv * away]);
  }
  strokeLine(g, sideR, wf(0.3) * 0.5, css(hp.dark), 0.55);
  strokeLine(g, sideL, wf(0.3) * 0.3, css(mixc(base, hp.light, 0.6)), 0.4);
  // strands
  const ns = o.strands ?? 7;
  for (let k = 0; k < ns; k++) {
    const off = (R() - 0.5) * 0.95;
    const sl = line.map((p, i) => {
      const q = line[Math.min(n - 1, i + 1)]; const pp = line[Math.max(0, i - 1)];
      let tx = q[0] - pp[0], ty = q[1] - pp[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const wv = wf(i / (n - 1)) * off;
      return [p[0] - ty * wv, p[1] + tx * wv];
    });
    const lit = R() < 0.45;
    strokeLine(g, sl, Math.max(0.7, U * 0.007), css(lit ? hp.light : hp.dark), lit ? 0.35 : 0.3);
  }
  // light across the crests: the hair turns toward the key at each wave and flashes there
  const sheen = o.sheen ?? 0.5;
  if (amp) {
    for (let i = 2; i < n - 2; i++) {
      const t = i / (n - 1);
      const phase = t * fr * Math.PI * 2 + ph;
      const c = Math.cos(phase);
      if (Math.abs(c) > 0.35) continue;
      const q = line[i + 1], pp = line[i - 1];
      let tx = q[0] - pp[0], ty = q[1] - pp[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const wv = wf(t);
      const cxp = line[i][0] - (-ty) * wv * 0.12, cyp = line[i][1] - tx * wv * 0.12;
      g.strokeStyle = css(hp.hi, sheen * (1 - Math.abs(c) / 0.35) * (Math.sin(phase) > 0 ? 1 : 0.55));
      g.lineWidth = Math.max(1, wv * 0.22);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cxp - tx * wv * 0.5 + ty * wv * 0.3, cyp - ty * wv * 0.5 - tx * wv * 0.3);
      g.lineTo(cxp + tx * wv * 0.5 - ty * wv * 0.3, cyp + ty * wv * 0.5 + tx * wv * 0.3);
      g.stroke();
    }
  } else {
    const s0 = Math.floor(n * (o.sheenAt ?? 0.3)); const s1 = Math.min(n - 1, s0 + Math.floor(n * 0.22));
    strokeLine(g, sideL.slice(s0, s1), wf(0.3) * 0.25, css(hp.hi), sheen * 0.8);
  }
  g.restore();
  if (o.edge !== false) {
    g.save();
    ribbon(g, line, wf);
    g.strokeStyle = css(hp.dark, 0.3);
    g.lineWidth = Math.max(0.7, U * 0.007);
    g.stroke();
    g.restore();
  }
}

/** The hair cap over the skull: a mass clipped to the head's outline above a designed hairline, combed in strokes. */
function capMass(ctx, hp, o = {}) {
  const { g, U, P, R } = ctx;
  const vol = o.vol ?? 1.08;
  // projected outline of the cranium (an ellipsoid projects to a convex outline)
  const pts = [];
  for (let i = 0; i < 24; i++) for (let j = 1; j < 12; j++) {
    const th = (i / 24) * Math.PI * 2; const ph = (j / 12) * Math.PI;
    pts.push(P([Math.cos(th) * Math.sin(ph) * 0.98 * vol * (ctx.w ?? 1), -0.36 + Math.cos(ph) * 1.0 * vol, -0.12 + Math.sin(th) * Math.sin(ph) * 1.06 * vol]));
  }
  const hull = convexHull(pts);
  const peak = o.peak ?? 0;
  const part = o.part ?? 0;
  const hl = [[-0.94, 0.08, 0.05], [-0.9, -0.3, 0.4], [-0.62, -0.7, 0.72], [-0.25 + part, -0.82 + peak, 0.84], [part, -0.78 + peak + (o.widow ? 0.06 : 0), 0.86], [0.25 + part, -0.82 + peak, 0.84], [0.62, -0.7, 0.72], [0.9, -0.3, 0.4], [0.94, 0.08, 0.05]].map((q) => P(q));
  const line = spline(hl, 6);
  g.save();
  g.beginPath(); g.moveTo(hull[0][0], hull[0][1]); for (const q of hull) g.lineTo(q[0], q[1]); g.closePath();
  g.clip();
  g.beginPath();
  g.moveTo(line[0][0], line[0][1]);
  for (const q of line) g.lineTo(q[0], q[1]);
  const back = [[1.4, 0.6, -0.6], [1.2, -2.2, -0.3], [-1.2, -2.2, -0.3], [-1.4, 0.6, -0.6]].map((q) => P(q));
  // close round the back of the head (the side away from the viewer is all hair)
  for (const q of back) g.lineTo(q[0], q[1]);
  g.closePath();
  const top = P([0, -1.4, 0.2]); const bot = P([0, -0.2, 0.6]);
  const gr = g.createLinearGradient(P([-1, 0, 0])[0], top[1], P([1, 0, 0])[0], bot[1]);
  gr.addColorStop(0, css(hp.light)); gr.addColorStop(0.45, css(hp.base)); gr.addColorStop(1, css(hp.dark));
  g.fillStyle = gr;
  g.fill();
  g.clip();
  // combed strands from the crown (or the parting) out to the hairline
  const crown = P([part * 0.5, -1.25, 0.1]);
  for (let k = 0; k < (o.strands ?? 120); k++) {
    const t = R();
    const q = line[Math.floor(t * (line.length - 1))];
    const mx = (crown[0] + q[0]) / 2 + (R() - 0.5) * U * 0.2; const my = (crown[1] + q[1]) / 2 - U * 0.15;
    const lit = (q[0] < crown[0]) !== (R() < 0.25);
    g.strokeStyle = css(lit ? hp.light : hp.dark, 0.3 + R() * 0.25);
    g.lineWidth = Math.max(0.8, U * (0.008 + R() * 0.01));
    g.beginPath(); g.moveTo(crown[0] + (R() - 0.5) * U * 0.3, crown[1]); g.quadraticCurveTo(mx, my, q[0], q[1]); g.stroke();
  }
  // a sheen band across the crown
  const sh0 = P([-0.7, -0.95, 0.5]); const sh1 = P([0.1, -1.25, 0.45]);
  strokeLine(g, [sh0, [(sh0[0] + sh1[0]) / 2, Math.min(sh0[1], sh1[1]) - U * 0.08], sh1], U * 0.09, css(hp.hi), 0.22);
  g.restore();
  // soften the hairline: a few fine strands spilling onto the skin
  for (let k = 0; k < 26; k++) {
    const q = line[Math.floor(R() * (line.length - 1))];
    strokeLine(g, [q, [q[0] + (R() - 0.5) * U * 0.05, q[1] + U * (0.02 + R() * 0.04)]], Math.max(0.6, U * 0.006), css(hp.base), 0.5);
  }
}

function convexHull(pts) {
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

function paintHair(ctx, layer) {
  const { D, R } = ctx;
  const Hh = D.hair ?? { style: 'short', c: '#3a2416' };
  const hp = hairPal(Hh.c ?? '#3a2416');
  const st = Hh.style;
  if (layer === 'back') return; // back masses are drawn into the background before the relief (see paintHairBack)
  if (st === 'long' || st === 'short' || st === 'bun') capMass(ctx, hp, { part: st === 'wavy' ? 0.22 : st === 'bun' ? 0 : 0.1, peak: st === 'short' ? 0.06 : 0, strands: 160 });
  if (st === 'wavy') {
    // a side parting: clumps sweep off the part over the crown and fall in loose waves past the
    // shoulders; neighbouring clumps differ in value, so the hair reads as locks, not a sheet
    const part = 0.24;
    const sides = [];
    for (let k = 0; k < 9; k++) sides.push([-1, k]);
    for (let k = 0; k < 5; k++) sides.push([1, k]);
    // far-to-near: the outer locks first
    for (const [s, k] of sides.sort((a, b) => b[1] - a[1])) {
      const n = s < 0 ? 9 : 5;
      const u = k / (n - 1); // 0 at the part .. 1 at the ear
      const start = [part - s * 0.02 * k, -1.24 + u * 0.08, 0.32 - u * 0.25];
      const over = [s * (0.25 + u * 0.5), -1.12 + u * 0.35, 0.6 - u * 0.35];
      const temple = [s * (0.78 + u * 0.12), -0.6 + u * 0.35, 0.55 - u * 0.55];
      const cheek = [s * (0.92 + u * 0.15), 0.15 + u * 0.1, 0.45 - u * 0.6];
      const shoulder = [s * (1.05 + u * 0.2), 1.0, 0.4 - u * 0.5];
      const end = [s * (1.0 + u * 0.3 + (k % 2) * 0.08), 1.9 + (k % 3) * 0.2, 0.45 - u * 0.4];
      lock(ctx, [start, over, temple, cheek, shoulder, end], 0.22 - u * 0.04, 0.05, hp, { wave: 0.06, freq: 2.6, ph: k * 0.9 + (s > 0 ? 1.4 : 0), strands: 9, taper: 1.5, value: 0.82 + ((k * 7) % 5) * 0.08, sheen: 0.55 });
    }
    // two loose locks in front of the shoulders, catching the light
    for (const s of [-1, 1]) lock(ctx, [[s * 0.86, 0.1, 0.55], [s * 0.98, 0.7, 0.6], [s * 0.92, 1.4, 0.75], [s * 1.0, 2.1, 0.85], [s * 0.94, 2.6, 0.9]], 0.18, 0.03, hp, { wave: 0.07, freq: 2.4, ph: s * 2, strands: 8, value: 1.1, sheen: 0.6 });
    return;
  }
  if (st === 'bun') {
    // drawn back from the face; a centre parting, the sides smoothed over the ears, a few strays
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) lock(ctx, [[s * 0.03, -1.3, 0.25], [s * (0.35 + k * 0.12), -1.15 + k * 0.08, 0.5 - k * 0.12], [s * (0.78 + k * 0.05), -0.6 + k * 0.1, 0.25 - k * 0.1], [s * 0.92, -0.05 + k * 0.05, -0.15]], 0.3, 0.16, hp, { strands: 8, sheenAt: 0.15, taper: 1 });
    for (const s of [-1, 1]) lock(ctx, [[s * 0.72, -0.5, 0.55], [s * 0.86, -0.05, 0.55], [s * 0.82, 0.35, 0.6]], 0.05, 0.01, hp, { strands: 2, edge: false });
    return;
  }
  if (st === 'short') {
    // tousled forelocks breaking the hairline
    for (let k = 0; k < 9; k++) {
      const a = -0.8 + (k / 8) * 1.6;
      lock(ctx, [[a * 0.3, -1.2, 0.45], [a * 0.55 + 0.04, -0.98, 0.72], [a * 0.68 + 0.1, -0.76 + Math.abs(a) * 0.15, 0.78 - Math.abs(a) * 0.25]], 0.16, 0.03, hp, { strands: 4, sheenAt: 0.15, edge: false, taper: 1.3 });
    }
    return;
  }
  if (st === 'tonsure' || st === 'fringeRing') {
    // the crown shaved; a ring of cropped hair round the sides and back, above the ears
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
      lock(ctx, [[s * (0.62 + k * 0.03), -0.92 + k * 0.08, 0.55 - k * 0.2], [s * (0.86 + k * 0.02), -0.55 + k * 0.05, 0.3 - k * 0.2], [s * 0.97, -0.18, 0.05 - k * 0.2]], 0.2, 0.15, hp, { strands: 6, sheenAt: 0.1, sheen: 0.3 });
    }
    // a little forelock left at the front of the tonsure
    lock(ctx, [[-0.12, -1.18, 0.62], [0.04, -1.12, 0.72], [0.16, -1.02, 0.78]], 0.12, 0.05, hp, { strands: 4, sheen: 0.3 });
    return;
  }
  if (st === 'topknot') {
    // stubble shadow is in the relief; the knot sits on the crown, bound with a cord, a short tail falling back
    const kn = [[0.02, -1.36, -0.25], [0.0, -1.62, -0.35]];
    lock(ctx, [[0, -1.12, 0.15], kn[0], kn[1]], 0.3, 0.26, hp, { strands: 8, sheenAt: 0.4 });
    lock(ctx, [kn[1], [0.12, -1.86, -0.45], [0.32, -1.78, -0.62], [0.48, -1.4, -0.8], [0.56, -0.9, -0.85]], 0.2, 0.05, hp, { strands: 7, wave: true, sheenAt: 0.1 });
    const { g, P, U } = ctx;
    const band = P([0.01, -1.5, -0.3]);
    g.save();
    g.fillStyle = '#3a1a10';
    g.beginPath(); g.ellipse(band[0], band[1], U * 0.17, U * 0.05, -0.1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(210,170,100,0.7)'; g.lineWidth = U * 0.015;
    g.beginPath(); g.ellipse(band[0], band[1] - U * 0.012, U * 0.15, U * 0.03, -0.1, Math.PI, Math.PI * 2); g.stroke();
    g.restore();
    return;
  }
  if (st === 'long') {
    for (let k = 0; k < 8; k++) {
      const s = k % 2 ? 1 : -1;
      const off = Math.floor(k / 2) * 0.08;
      lock(ctx, [[0.0, -1.3, 0.3], [s * (0.45 + off * 0.3), -1.1, 0.6], [s * (0.8 + off * 0.2), -0.55, 0.5], [s * 0.95, 0.2, 0.25], [s * 1.0, 1.0, 0.2], [s * 1.0, 1.9, 0.4]], 0.24, 0.05, hp, { strands: 8, sheenAt: 0.15 });
    }
  }
}

/** Hair masses that hang behind the head and shoulders. */
function paintHairBack(ctx) {
  const { g, U, P, D } = ctx;
  const Hh = D.hair ?? {};
  const hp = hairPal(Hh.c ?? '#3a2416');
  const st = Hh.style;
  if (st === 'wavy' || st === 'long') {
    const pts = [[-0.95, -0.9, -0.3], [-1.25, 0.2, -0.4], [-1.45, 1.6, -0.3], [-1.3, 2.9, -0.2], [1.3, 2.9, -0.2], [1.45, 1.6, -0.3], [1.25, 0.2, -0.4], [0.95, -0.9, -0.3], [0, -1.4, -0.3]].map((p) => P(p));
    const line = spline([...pts, pts[0]], 8);
    g.save();
    g.beginPath(); g.moveTo(line[0][0], line[0][1]); for (const p of line) g.lineTo(p[0], p[1]); g.closePath();
    const gr = g.createLinearGradient(0, P([0, -1.2, 0])[1], 0, P([0, 2.8, 0])[1]);
    gr.addColorStop(0, css(hp.base)); gr.addColorStop(1, css(hp.dark));
    g.fillStyle = gr; g.fill();
    g.restore();
    for (let k = 0; k < 12; k++) {
      const s = k % 2 ? 1 : -1; const off = (k >> 1) * 0.07;
      lock(ctx, [[s * (0.6 + off), -0.9, -0.3], [s * (1.15 + off * 0.5), 0.4, -0.35], [s * (1.25 + Math.sin(k) * 0.1), 1.5, -0.3], [s * (1.15 + off), 2.6, -0.2]], 0.28, 0.06, { ...hp, light: hp.base, hi: hp.light }, { wave: true, ph: k, strands: 6, sheen: 0.25, edge: false });
    }
  }
  if (st === 'bun') {
    const b = P([0.25, -0.95, -0.85]);
    g.save();
    const gr = g.createRadialGradient(b[0] - U * 0.1, b[1] - U * 0.1, U * 0.05, b[0], b[1], U * 0.5);
    gr.addColorStop(0, css(hp.light)); gr.addColorStop(0.6, css(hp.base)); gr.addColorStop(1, css(hp.dark));
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(b[0], b[1], U * 0.46, U * 0.4, 0.3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = css(hp.dark, 0.5); g.lineWidth = U * 0.012;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(b[0], b[1], U * (0.12 + k * 0.055), U * (0.1 + k * 0.05), 0.3 + k * 0.4, 0.4, 2.6); g.stroke(); }
    g.restore();
  }
}

function paintBeard(ctx) {
  const { g, U, P, D, R, skin } = ctx;
  const B = D.beard;
  if (!B || !B.style || B.style === 'none') return;
  const hp = hairPal(B.c ?? D.hair?.c ?? '#3a2416');
  const st = B.style;
  if (st === 'stubble') {
    g.save();
    for (let k = 0; k < 900; k++) {
      const x = (R() - 0.5) * 1.3; const y = 0.45 + R() * 0.75;
      if (Math.abs(x) < 0.3 && y > 0.66 && y < 0.88) continue;
      if (y < 0.6 && Math.abs(x) < 0.45) continue;
      const p = P([x, y, 0.75 - Math.abs(x) * 0.4]);
      g.fillStyle = css(hp.dark, 0.25);
      g.fillRect(p[0], p[1], Math.max(1, U * 0.008), Math.max(1, U * 0.008));
    }
    g.restore();
    return;
  }
  if (st === 'full' || st === 'long') {
    const long = st === 'long';
    // jaw mass from ear to ear, then hanging clumps of strands with their own tips
    const outline = [[-0.84, 0.15, 0.1], [-0.78, 0.65, 0.3], [-0.5, 1.15 + (long ? 0.4 : 0), 0.6], [0, 1.35 + (long ? 0.75 : 0.1), 0.75], [0.5, 1.15 + (long ? 0.4 : 0), 0.6], [0.78, 0.65, 0.3], [0.84, 0.15, 0.1], [0.55, 0.42, 0.6], [0.3, 0.62, 0.82], [0, 0.6, 0.92], [-0.3, 0.62, 0.82], [-0.55, 0.42, 0.6]].map((p) => P(p));
    const line = spline([...outline, outline[0]], 6);
    g.save();
    g.beginPath(); g.moveTo(line[0][0], line[0][1]); for (const p of line) g.lineTo(p[0], p[1]); g.closePath();
    const gr = g.createLinearGradient(P([-0.8, 0, 0])[0], 0, P([0.8, 0, 0])[0], 0);
    gr.addColorStop(0, css(hp.light)); gr.addColorStop(0.5, css(hp.base)); gr.addColorStop(1, css(hp.dark));
    g.fillStyle = gr;
    g.fill();
    g.restore();
    for (let k = 0; k < 13; k++) {
      const u = k / 12 - 0.5;
      const top = [u * 1.4, 0.55 + Math.abs(u) * 0.05, 0.7 - Math.abs(u) * 0.4];
      const lenC = (long ? 1.4 : 0.7) * (1 - Math.abs(u) * 1.2) + 0.25;
      lock(ctx, [top, [u * 1.25, top[1] + lenC * 0.5, top[2] + 0.05], [u * 0.8 + Math.sin(k * 2.3) * 0.05, top[1] + lenC, top[2]]], 0.2, 0.03, hp, { strands: 6, sheenAt: 0.2, sheen: 0.3 });
    }
    // the mouth shows through
    paintMoustache(ctx, hp, false);
    return;
  }
  if (st === 'goatee') {
    lock(ctx, [[0, 0.88, 0.92], [0, 1.1, 0.85], [0.02, 1.32, 0.7]], 0.32, 0.08, hp, { strands: 8 });
    paintMoustache(ctx, hp, false);
    return;
  }
  if (st === 'moustache') { paintMoustache(ctx, hp, false); return; }
  if (st === 'braided') { paintMoustache(ctx, hp, true); }
}

function paintMoustache(ctx, hp, braided) {
  const { g, U, P } = ctx;
  for (const s of [-1, 1]) {
    lock(ctx, [[s * 0.02, 0.6, 1.0], [s * 0.16, 0.62, 0.98], [s * 0.28, 0.72, 0.86], [s * 0.32, 0.84, 0.8]], 0.12, 0.06, hp, { strands: 6, sheenAt: 0.1, edge: false });
    if (braided) {
      // the ends plaited and hanging past the chin, bound with iron rings
      const pts = [[s * 0.32, 0.82, 0.8], [s * 0.34, 1.1, 0.75], [s * 0.33, 1.4, 0.72], [s * 0.3, 1.72, 0.7]];
      const line = spline(pts.map((p) => P(p)), 8);
      for (let i = 0; i < line.length - 3; i += 3) {
        const p = line[i]; const q = line[i + 3];
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        g.save();
        g.translate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
        g.rotate(ang + ((i / 3) % 2 ? 0.5 : -0.5));
        const gr = g.createLinearGradient(-U * 0.04, 0, U * 0.04, 0);
        gr.addColorStop(0, css(hp.light)); gr.addColorStop(1, css(hp.dark));
        g.fillStyle = gr;
        g.beginPath(); g.ellipse(0, 0, U * 0.05, U * 0.032, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      for (const t of [0.35, 0.92]) {
        const p = line[Math.floor(t * (line.length - 1))];
        g.save();
        const gr = g.createLinearGradient(p[0] - U * 0.05, 0, p[0] + U * 0.05, 0);
        gr.addColorStop(0, '#d8d8d8'); gr.addColorStop(0.5, '#6a6a70'); gr.addColorStop(1, '#2a2a30');
        g.fillStyle = gr;
        g.fillRect(p[0] - U * 0.045, p[1] - U * 0.025, U * 0.09, U * 0.05);
        g.restore();
      }
    }
  }
}

// ------------------------------------------------------------------ headwear, props

function paintHeadwear(ctx) {
  const { g, U, P, D, R } = ctx;
  const Hd = D.head;
  if (!Hd || !Hd.kind) return;
  if (Hd.kind === 'hood' || Hd.kind === 'mitre') {
    const hc = rgbOf(Hd.c ?? '#6a7488');
    // the cowl: a deep fold framing the face, the face opening in shadow
    const outer = [[-1.2, 1.3, -0.1], [-1.25, 0.2, 0.0], [-1.1, -0.85, 0.1], [-0.6, -1.35, 0.25], [0.0, -1.48, 0.3], [0.6, -1.35, 0.25], [1.1, -0.85, 0.1], [1.25, 0.2, 0.0], [1.2, 1.3, -0.1], [1.6, 2.2, -0.3], [-1.6, 2.2, -0.3]].map((p) => P(p));
    const inner = [[-0.88, 1.15, 0.3], [-0.92, 0.2, 0.45], [-0.82, -0.7, 0.55], [-0.45, -1.12, 0.65], [0, -1.2, 0.68], [0.45, -1.12, 0.65], [0.82, -0.7, 0.55], [0.92, 0.2, 0.45], [0.88, 1.15, 0.3]].map((p) => P(p));
    const ol = spline(outer, 6); const il = spline(inner, 6);
    g.save();
    g.beginPath();
    g.moveTo(ol[0][0], ol[0][1]); for (const p of ol) g.lineTo(p[0], p[1]); g.closePath();
    g.moveTo(il[0][0], il[0][1]); for (const p of il) g.lineTo(p[0], p[1]); g.lineTo(il[0][0], il[0][1] + U * 1.2); g.closePath();
    const gr = g.createLinearGradient(P([-1.2, 0, 0])[0], 0, P([1.2, 0, 0])[0], 0);
    gr.addColorStop(0, css(mixc(hc, [255, 240, 220], 0.25))); gr.addColorStop(0.45, css(hc)); gr.addColorStop(1, css(mulc(hc, 0.35)));
    g.fillStyle = gr;
    g.fill('evenodd');
    g.clip('evenodd');
    // folds of the cowl
    for (let k = 0; k < 14; k++) {
      const a = -1 + (k / 13) * 2;
      const p0 = P([a * 1.1, -1.2 + Math.abs(a) * 0.5, 0.3]); const p1 = P([a * 1.35, 0.6 + Math.abs(a) * 0.4, 0]);
      strokeLine(g, [p0, [(p0[0] + p1[0]) / 2 + U * 0.08 * Math.sin(k), (p0[1] + p1[1]) / 2], p1], U * (0.03 + R() * 0.04), css(k % 2 ? mulc(hc, 0.5) : mixc(hc, [255, 245, 230], 0.3)), 0.35);
    }
    g.restore();
    // the shadow the hood throws onto the brow and temples
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.beginPath(); g.moveTo(il[0][0], il[0][1]); for (const p of il) g.lineTo(p[0], p[1]);
    g.lineWidth = U * 0.22; g.strokeStyle = 'rgba(70,50,60,0.45)'; g.filter = `blur(${(U * 0.06).toFixed(1)}px)`; g.stroke();
    g.restore();
    if (Hd.kind === 'mitre') {
      const mc = rgbOf(Hd.mitre ?? '#7a8aa6');
      const trim = rgbOf(Hd.trim ?? '#d8b050');
      const base = [[-0.78, -1.02, 0.45], [0.78, -1.02, 0.45]];
      const tip = P([0.02, -2.25, 0.05]);
      const b0 = P(base[0]); const b1 = P(base[1]);
      const sh0 = P([-0.86, -1.7, 0.25]); const sh1 = P([0.86, -1.7, 0.25]);
      g.save();
      g.beginPath();
      g.moveTo(b0[0], b0[1]); g.quadraticCurveTo(sh0[0], sh0[1], tip[0], tip[1]); g.quadraticCurveTo(sh1[0], sh1[1], b1[0], b1[1]);
      g.quadraticCurveTo((b0[0] + b1[0]) / 2, b0[1] + U * 0.14, b0[0], b0[1]);
      const mg = g.createLinearGradient(b0[0], 0, b1[0], 0);
      mg.addColorStop(0, css(mixc(mc, [255, 250, 240], 0.3))); mg.addColorStop(0.5, css(mc)); mg.addColorStop(1, css(mulc(mc, 0.4)));
      g.fillStyle = mg; g.fill();
      g.clip();
      // orphrey bands: the circlet and the upright, in gold with a scales device
      g.fillStyle = css(trim);
      g.beginPath(); g.moveTo(b0[0], b0[1] - U * 0.12); g.quadraticCurveTo((b0[0] + b1[0]) / 2, b0[1] - U * 0.02, b1[0], b1[1] - U * 0.12); g.lineTo(b1[0], b1[1] + U * 0.1); g.quadraticCurveTo((b0[0] + b1[0]) / 2, b0[1] + U * 0.22, b0[0], b0[1] + U * 0.1); g.closePath(); g.fill();
      const up0 = P([0, -1.05, 0.5]);
      g.fillRect(up0[0] - U * 0.08, tip[1], U * 0.16, up0[1] - tip[1]);
      g.strokeStyle = css(mulc(trim, 0.5)); g.lineWidth = U * 0.012;
      for (let k = 0; k < 9; k++) { const x = lerp(b0[0], b1[0], k / 8); g.beginPath(); g.arc(x, b0[1] + U * 0.04 - Math.sin(k / 8 * Math.PI) * U * 0.08, U * 0.02, 0, Math.PI * 2); g.stroke(); }
      // the device
      const dv = P([0, -1.55, 0.35]);
      g.strokeStyle = '#3a2a10'; g.lineWidth = U * 0.018;
      g.beginPath(); g.moveTo(dv[0], dv[1] - U * 0.12); g.lineTo(dv[0], dv[1] + U * 0.1); g.moveTo(dv[0] - U * 0.14, dv[1] - U * 0.06); g.lineTo(dv[0] + U * 0.14, dv[1] - U * 0.06); g.stroke();
      for (const s of [-1, 1]) { g.beginPath(); g.arc(dv[0] + s * U * 0.13, dv[1] + U * 0.0, U * 0.05, 0, Math.PI); g.stroke(); }
      // light down the left face of the cap
      g.globalAlpha = 0.25; g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(b0[0] + U * 0.08, b0[1]); g.quadraticCurveTo(sh0[0] + U * 0.1, sh0[1], tip[0], tip[1] + U * 0.05); g.lineTo(tip[0] - U * 0.02, tip[1] + U * 0.2); g.quadraticCurveTo(sh0[0] + U * 0.25, sh0[1] + U * 0.1, b0[0] + U * 0.25, b0[1]); g.fill();
      g.restore();
      // lappets hanging behind are part of the costume
    }
  }
}

function paintSpectacles(ctx) {
  const { g, U, P, HR } = ctx;
  // round wire rims pinched on the nose; the arms run back to the ears and end there
  g.save();
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      pts.push(P([s * 0.35 + Math.cos(a) * 0.19, 0.06 + Math.sin(a) * 0.15, 1.0 - Math.abs(Math.cos(a)) * 0.05 * s * s]));
    }
    // glass: a faint cool tint and a sliver of reflected window light
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath();
    g.fillStyle = 'rgba(200,220,235,0.08)'; g.fill();
    const gl0 = P([s * 0.35 - 0.1, -0.02, 1.02]); const gl1 = P([s * 0.35 - 0.02, -0.07, 1.02]);
    strokeLine(g, [gl0, gl1], U * 0.022, 'rgba(255,255,250,1)', 0.55);
    strokeLine(g, pts, U * 0.02, '#2a2016', 0.9);
    strokeLine(g, pts.slice(14, 22), U * 0.012, '#e8c878', 0.8);
    // the arm: from the rim's outer edge back to the ear — clipped there, never down the neck
    const a0 = P([s * 0.54, 0.04, 0.92]); const a1 = P([s * 0.98, 0.02, 0.1]);
    const far = ap(HR, [s, 0, 0])[2] < -0.15;
    if (!far) strokeLine(g, [a0, a1], U * 0.018, '#2a2016', 0.85);
  }
  const br0 = P([-0.16, 0.04, 1.02]); const brm = P([0, 0.0, 1.07]); const br1 = P([0.16, 0.04, 1.02]);
  strokeLine(g, spline([br0, brm, br1], 4), U * 0.02, '#2a2016', 0.9);
  g.restore();
}

function paintQuill(ctx) {
  const { g, U, P } = ctx;
  // a goose quill tucked behind the ear
  const a = P([0.9, 0.55, 0.15]); const b = P([1.2, -0.95, -0.15]);
  g.save();
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  g.translate(a[0], a[1]); g.rotate(ang);
  // vane
  g.beginPath();
  g.moveTo(len * 0.25, 0);
  g.quadraticCurveTo(len * 0.6, -U * 0.16, len * 1.02, -U * 0.04);
  g.quadraticCurveTo(len * 0.7, U * 0.07, len * 0.25, 0);
  const vg = g.createLinearGradient(0, -U * 0.15, 0, U * 0.08);
  vg.addColorStop(0, '#f4ecdc'); vg.addColorStop(1, '#9a907e');
  g.fillStyle = vg; g.fill();
  g.strokeStyle = 'rgba(120,110,90,0.5)'; g.lineWidth = 1;
  for (let k = 0; k < 16; k++) { const x = len * (0.3 + k * 0.045); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + len * 0.05, -U * 0.1 * Math.sin((k / 16) * Math.PI)); g.stroke(); }
  // shaft and the inked nib
  g.strokeStyle = '#efe6d2'; g.lineWidth = U * 0.022; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
  g.strokeStyle = '#1a1210'; g.lineWidth = U * 0.02;
  g.beginPath(); g.moveTo(-U * 0.02, 0); g.lineTo(U * 0.08, 0); g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ costume

function paintCostume(ctx) {
  const { g, U, P, D, R, fem, skin } = ctx;
  const C = D.costume ?? {};
  const kind = C.kind ?? 'tunic';
  const A = rgbOf(C.a ?? '#3a3a50');
  const Bc = rgbOf(C.b ?? '#d8ccb0');
  const T = rgbOf(C.trim ?? '#c8a050');
  const body = (p) => P([p[0], p[1] - 0.18, p[2]], 'body');
  const neckBase = body([0, 1.85, 0.25]);
  const fold = (p0, p1, w, a, dark = true) => strokeLine(g, spline([body(p0), body([(p0[0] + p1[0]) / 2 + 0.05, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]), body(p1)], 5), U * w, css(dark ? mulc(A, 0.45) : mixc(A, [255, 240, 220], 0.3)), a);
  // folds radiating from the shoulders and the neck
  for (let k = 0; k < 9; k++) {
    const s = k % 2 ? 1 : -1; const off = (k >> 1) * 0.22;
    fold([s * (0.55 + off), 2.15, 0.3], [s * (0.75 + off * 1.3), 3.6, 0.3], 0.03 + R() * 0.03, 0.35, k % 3 !== 0);
  }
  if (kind === 'robe' || kind === 'priest') {
    // a V of collar over an undershirt
    const v = [body([-0.5, 1.9, 0.38]), body([0, 2.75, 0.62]), body([0.5, 1.9, 0.38])];
    g.save();
    g.beginPath(); g.moveTo(v[0][0], v[0][1]); g.lineTo(v[1][0], v[1][1]); g.lineTo(v[2][0], v[2][1]); g.closePath();
    g.fillStyle = css(Bc); g.fill();
    g.clip();
    const sg = g.createLinearGradient(0, v[0][1], 0, v[1][1]);
    sg.addColorStop(0, 'rgba(40,20,10,0.55)'); sg.addColorStop(0.4, 'rgba(40,20,10,0.1)'); sg.addColorStop(1, 'rgba(40,20,10,0.4)');
    g.fillStyle = sg; g.fillRect(v[0][0], v[0][1] - U, v[2][0] - v[0][0], U * 3);
    g.restore();
    // collar bands
    for (const s of [-1, 1]) {
      const band = [body([s * 0.52, 1.85, 0.36]), body([s * 0.3, 2.3, 0.55]), body([s * 0.02, 2.8, 0.64])];
      strokeLine(g, spline(band, 6), U * 0.13, css(C.collar ? rgbOf(C.collar) : mulc(A, 0.8)), 1);
      strokeLine(g, spline(band, 6).map((p) => [p[0] - s * U * 0.05, p[1]]), U * 0.02, css(mixc(C.collar ? rgbOf(C.collar) : A, [255, 240, 220], 0.4)), 0.6);
    }
    if (C.stole) {
      const sc = rgbOf(C.stole);
      for (const s of [-1, 1]) {
        const st = [body([s * 0.62, 1.95, 0.32]), body([s * 0.55, 2.6, 0.55]), body([s * 0.5, 3.8, 0.6])];
        strokeLine(g, spline(st, 6), U * 0.26, css(sc), 1);
        strokeLine(g, spline(st, 6).map((p) => [p[0] - U * 0.1, p[1]]), U * 0.025, css(T), 0.9);
        strokeLine(g, spline(st, 6).map((p) => [p[0] + U * 0.1, p[1]]), U * 0.025, css(T), 0.9);
        if (C.symbol === 'scales') {
          const q = body([s * 0.52, 3.15, 0.6]);
          g.save(); g.strokeStyle = css(T); g.lineWidth = U * 0.02;
          g.beginPath(); g.moveTo(q[0], q[1] - U * 0.1); g.lineTo(q[0], q[1] + U * 0.1); g.moveTo(q[0] - U * 0.09, q[1] - U * 0.06); g.lineTo(q[0] + U * 0.09, q[1] - U * 0.06); g.stroke();
          for (const t of [-1, 1]) { g.beginPath(); g.arc(q[0] + t * U * 0.08, q[1], U * 0.035, 0, Math.PI); g.stroke(); }
          g.restore();
        }
      }
    }
    if (C.ink) {
      // ink spatter on the clerk's breast
      for (let k = 0; k < 7; k++) { const q = body([-0.9 + R() * 0.5, 2.6 + R() * 0.5, 0.5]); softDot(g, q[0], q[1], U * (0.015 + R() * 0.03), [10, 10, 24], 0.8); }
    }
  } else if (kind === 'gown') {
    // a square neckline over a chemise edged in lace, a gold chain and a rose pendant
    const nl = [body([-0.72, 2.05, 0.45]), body([-0.62, 2.62, 0.62]), body([0.62, 2.62, 0.62]), body([0.72, 2.05, 0.45])];
    g.save();
    // skin of the chest above the neckline (painted, with the collarbones)
    const sk = [body([-0.85, 1.92, 0.3]), body([-0.72, 2.05, 0.45]), ...nl.slice(1, 3), body([0.72, 2.05, 0.45]), body([0.85, 1.92, 0.3]), body([0.45, 1.75, 0.35]), body([-0.45, 1.75, 0.35])];
    g.beginPath(); g.moveTo(sk[0][0], sk[0][1]); for (const p of sk) g.lineTo(p[0], p[1]); g.closePath();
    const kg = g.createLinearGradient(sk[0][0], 0, sk[5][0], 0);
    kg.addColorStop(0, css(mixc(skin, [255, 236, 214], 0.25))); kg.addColorStop(0.55, css(skin)); kg.addColorStop(1, css(mixc(mulc(skin, 0.5), [80, 40, 60], 0.3)));
    g.fillStyle = kg; g.fill();
    for (const s of [-1, 1]) strokeLine(g, spline([body([s * 0.12, 2.0, 0.52]), body([s * 0.4, 1.96, 0.5]), body([s * 0.7, 2.0, 0.42])], 5), U * 0.02, css(mixc(skin, [255, 240, 225], 0.5)), 0.5);
    // the chain and pendant
    const ch = spline([body([-0.45, 1.85, 0.42]), body([-0.2, 2.25, 0.58]), body([0, 2.35, 0.62]), body([0.2, 2.25, 0.58]), body([0.45, 1.85, 0.42])], 8);
    for (let k = 0; k < ch.length; k += 2) softDot(g, ch[k][0], ch[k][1], U * 0.022, [240, 200, 110], 0.95);
    const pd = body([0, 2.43, 0.64]);
    g.fillStyle = '#b01a2a'; g.beginPath(); g.arc(pd[0], pd[1], U * 0.07, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 5; k++) { const a = k * 1.2566; g.fillStyle = '#d83040'; g.beginPath(); g.arc(pd[0] + Math.cos(a) * U * 0.05, pd[1] + Math.sin(a) * U * 0.05, U * 0.04, 0, Math.PI * 2); g.fill(); }
    softDot(g, pd[0] - U * 0.02, pd[1] - U * 0.03, U * 0.03, [255, 220, 220], 0.8);
    // chemise lace along the neckline
    const lace = spline(nl, 6);
    strokeLine(g, lace, U * 0.07, css(Bc), 1);
    for (let k = 0; k < lace.length; k += 2) softDot(g, lace[k][0], lace[k][1] - U * 0.03, U * 0.025, [255, 250, 240], 0.7);
    strokeLine(g, lace.map((p) => [p[0], p[1] + U * 0.05]), U * 0.04, css(T), 0.85);
    g.restore();
  } else if (kind === 'bodice') {
    const nl = spline([body([-0.6, 1.95, 0.42]), body([-0.3, 2.55, 0.6]), body([0.3, 2.55, 0.6]), body([0.6, 1.95, 0.42])], 6);
    g.save();
    g.beginPath(); g.moveTo(nl[0][0], nl[0][1]); for (const p of nl) g.lineTo(p[0], p[1]); g.closePath();
    g.fillStyle = css(Bc); g.fill();
    g.restore();
    strokeLine(g, nl, U * 0.04, css(mulc(Bc, 0.7)), 0.8);
    // lacing down the front
    for (let k = 0; k < 4; k++) { const y = 2.65 + k * 0.22; const a0 = body([-0.14, y, 0.66]); const a1 = body([0.14, y + 0.18, 0.66]); const b0 = body([0.14, y, 0.66]); const b1 = body([-0.14, y + 0.18, 0.66]); strokeLine(g, [a0, a1], U * 0.02, '#2a1810', 0.9); strokeLine(g, [b0, b1], U * 0.02, '#2a1810', 0.9); }
    if (C.kerchief) {
      const kc = rgbOf(C.kerchief);
      const kp = [body([-0.85, 1.9, 0.3]), body([0, 2.35, 0.6]), body([0.85, 1.9, 0.3]), body([0.4, 2.0, 0.5]), body([0, 2.6, 0.62]), body([-0.4, 2.0, 0.5])];
      g.save(); g.beginPath(); g.moveTo(kp[0][0], kp[0][1]); for (const p of kp) g.lineTo(p[0], p[1]); g.closePath(); g.fillStyle = css(kc, 0.9); g.fill(); g.restore();
    }
  } else if (kind === 'smith') {
    // open shirt, the leather apron's bib and straps, soot
    const v = [body([-0.35, 1.85, 0.38]), body([0, 2.45, 0.62]), body([0.35, 1.85, 0.38])];
    g.save(); g.beginPath(); g.moveTo(v[0][0], v[0][1]); g.lineTo(v[1][0], v[1][1]); g.lineTo(v[2][0], v[2][1]); g.closePath();
    g.fillStyle = css(mixc(skin, [120, 70, 50], 0.25)); g.fill(); g.restore();
    const ap0 = rgbOf(C.apron ?? '#4a2e1a');
    const bib = [body([-0.62, 2.7, 0.6]), body([0.62, 2.7, 0.6]), body([0.7, 3.9, 0.6]), body([-0.7, 3.9, 0.6])];
    g.save(); g.beginPath(); g.moveTo(bib[0][0], bib[0][1]); for (const p of bib) g.lineTo(p[0], p[1]); g.closePath();
    const bg = g.createLinearGradient(bib[0][0], 0, bib[1][0], 0);
    bg.addColorStop(0, css(mixc(ap0, [255, 220, 180], 0.2))); bg.addColorStop(1, css(mulc(ap0, 0.5)));
    g.fillStyle = bg; g.fill(); g.restore();
    for (const s of [-1, 1]) strokeLine(g, [body([s * 0.55, 2.72, 0.6]), body([s * 0.75, 1.95, 0.35])], U * 0.09, css(mulc(ap0, 0.8)), 1);
    for (let k = 0; k < 18; k++) { const q = body([-1.2 + R() * 2.4, 2.3 + R() * 1.4, 0.5]); softDot(g, q[0], q[1], U * (0.03 + R() * 0.06), [20, 14, 10], 0.22); }
  } else if (kind === 'mail') {
    // riveted mail over a padded collar, leather at the shoulders, a cloak pinned at the throat
    g.save();
    const area = [body([-2.2, 2.0, 0]), body([-0.55, 1.9, 0.35]), body([0.55, 1.9, 0.35]), body([2.2, 2.0, 0]), body([2.3, 4.0, 0]), body([-2.3, 4.0, 0])];
    g.beginPath(); g.moveTo(area[0][0], area[0][1]); for (const p of area) g.lineTo(p[0], p[1]); g.closePath(); g.clip();
    const rr = U * 0.045;
    for (let y = area[1][1] - rr; y < ctx.H; y += rr * 1.1) {
      for (let x = 0, k = 0; x < ctx.W; x += rr * 1.25, k++) {
        const xx = x + ((Math.round(y / rr) % 2) ? rr * 0.6 : 0);
        const lx = (xx - ctx.cx) / (U * 2.2);
        const lit = clamp(0.62 - lx * 0.45 + (R() - 0.5) * 0.25);
        g.strokeStyle = css(mixc([40, 42, 48], [215, 218, 226], lit), 0.9);
        g.lineWidth = rr * 0.32;
        g.beginPath(); g.arc(xx, y, rr * 0.5, Math.PI * 0.95, Math.PI * 2.05); g.stroke();
        if (lit > 0.7) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(xx - rr * 0.3, y - rr * 0.5, rr * 0.2, rr * 0.12); }
      }
    }
    g.restore();
    // padded leather collar and pauldrons
    const lc = rgbOf(C.b ?? '#5a3a22');
    const col = spline([body([-0.7, 1.95, 0.3]), body([0, 2.2, 0.55]), body([0.7, 1.95, 0.3])], 6);
    strokeLine(g, col, U * 0.18, css(lc), 1);
    strokeLine(g, col.map((p) => [p[0], p[1] - U * 0.06]), U * 0.03, css(mixc(lc, [255, 220, 180], 0.35)), 0.6);
    for (const s of [-1, 1]) {
      const pa = body([s * 1.6, 2.3, 0.1]);
      g.save();
      const pg = g.createRadialGradient(pa[0] - U * 0.2, pa[1] - U * 0.2, U * 0.1, pa[0], pa[1], U * 0.75);
      pg.addColorStop(0, css(mixc(lc, [255, 220, 180], 0.3))); pg.addColorStop(1, css(mulc(lc, 0.35)));
      g.fillStyle = pg; g.beginPath(); g.ellipse(pa[0], pa[1], U * 0.72, U * 0.42, s * 0.25, Math.PI, Math.PI * 2.05); g.fill();
      for (let k = 0; k < 3; k++) softDot(g, pa[0] + (k - 1) * U * 0.25, pa[1] - U * 0.12, U * 0.03, [230, 210, 160], 0.9);
      g.restore();
    }
    if (C.cloak) {
      const cc = rgbOf(C.cloak);
      for (const s of [-1, 1]) {
        const cl = [body([s * 1.2, 2.0, -0.2]), body([s * 2.4, 2.4, -0.3]), body([s * 2.6, 4.0, -0.3]), body([s * 2.05, 4.0, 0]), body([s * 1.9, 2.8, 0.2])];
        g.save(); g.beginPath(); g.moveTo(cl[0][0], cl[0][1]); for (const p of cl) g.lineTo(p[0], p[1]); g.closePath();
        g.fillStyle = css(s < 0 ? cc : mulc(cc, 0.5)); g.fill(); g.restore();
      }
    }
  } else if (kind === 'tabard') {
    const tb = rgbOf(C.a);
    g.save();
    const area = [body([-1.1, 2.3, 0.5]), body([1.1, 2.3, 0.5]), body([1.2, 4.0, 0.5]), body([-1.2, 4.0, 0.5])];
    g.beginPath(); g.moveTo(area[0][0], area[0][1]); for (const p of area) g.lineTo(p[0], p[1]); g.closePath();
    g.fillStyle = css(mulc(tb, 1.05)); g.fill();
    g.restore();
    const sw = body([0, 3.1, 0.6]);
    g.save(); g.strokeStyle = '#e0e0e8'; g.lineWidth = U * 0.06; g.lineCap = 'round';
    g.beginPath(); g.moveTo(sw[0], sw[1] - U * 0.45); g.lineTo(sw[0], sw[1] + U * 0.4); g.stroke();
    g.strokeStyle = '#d8b050'; g.beginPath(); g.moveTo(sw[0] - U * 0.22, sw[1] - U * 0.22); g.lineTo(sw[0] + U * 0.22, sw[1] - U * 0.22); g.stroke();
    g.restore();
  } else {
    const v = spline([body([-0.42, 1.9, 0.38]), body([0, 2.3, 0.6]), body([0.42, 1.9, 0.38])], 6);
    strokeLine(g, v, U * 0.08, css(Bc), 0.95);
  }
  if (C.clasp) {
    const q = body([0, 2.08, 0.5]);
    softDot(g, q[0], q[1], U * 0.1, [255, 220, 140], 0.9);
  }
}

// ------------------------------------------------------------------ entry point with back layers

/**
 * paintPortrait: background, hair/hood masses behind the head, the painted head and bust, then
 * everything in front. (paintFace draws the background itself; the back layers are slotted in
 * by wrapping the background step.)
 */
export function paintPortraitDesign(D, W = 600, H = 750) {
  return paintFaceWithBack(D, W, H);
}

function paintFaceWithBack(D, W, H) {
  // paint the back hair onto the background first, then run the face painter over it
  const pre = makeCanvas(W, H);
  const pg = pre.getContext('2d');
  const R = rngOf((D.seed ?? 7) * 31 + 5);
  const U = W * 0.205 * (D.zoom ?? 1);
  const cx = W * (0.5 + (D.dx ?? 0));
  const cy = H * (0.4 + (D.dy ?? 0));
  const HR = matRot(D.yaw ?? -0.3, D.pitch ?? 0.04, D.roll ?? 0);
  const P = (p) => { const q = ap(HR, p); return [cx + q[0] * U, cy + q[1] * U, q[2]]; };
  paintBackground(pg, W, H, D, R, cx, cy, U);
  paintHairBack({ g: pg, U, P, D, R, W, H });
  if (D.head?.kind === 'hood' || D.head?.kind === 'mitre') {
    // the back of the cowl behind the head
    const hc = rgbOf(D.head.c ?? '#6a7488');
    const pts = [[-1.25, 1.3, -0.4], [-1.3, -0.4, -0.5], [-0.8, -1.4, -0.4], [0, -1.55, -0.4], [0.8, -1.4, -0.4], [1.3, -0.4, -0.5], [1.25, 1.3, -0.4]].map(P);
    const l = spline(pts, 6);
    pg.save(); pg.beginPath(); pg.moveTo(l[0][0], l[0][1]); for (const p of l) pg.lineTo(p[0], p[1]); pg.closePath();
    pg.fillStyle = css(mulc(hc, 0.35)); pg.fill(); pg.restore();
  }
  return paintFace({ ...D, __pre: pre }, W, H);
}

