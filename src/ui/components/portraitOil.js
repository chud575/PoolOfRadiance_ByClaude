/**
 * The oil repaint of a rendered portrait (portraitGL.js): strokes laid down
 * the way a portrait painter works — a toned ground, the masses blocked in
 * with broad strokes, then smaller and smaller brushes only where the canvas
 * still differs from the sitter, the face and eyes last with the finest
 * brush. Unlike a photo filter, every stroke knows what it paints: the
 * renderer hands over a G-buffer with the region (backdrop, skin, eye, hair,
 * cloth, metal), the stroke direction (hair along its flow, skin and cloth
 * round the forms) and how much detail must survive (eyes, mouth). Bristle
 * texture follows each stroke; a canvas weave and a varnish glaze finish it.
 *
 * Deterministic for a seed. CPU only (Canvas 2D; an OffscreenCanvas in a worker).
 */

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Separable box blur (two passes ≈ gaussian) of a 3-channel float buffer. */
function blur3(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  const n2 = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sr = 0, sg = 0, sb = 0;
    for (let i = -r; i <= r; i++) { const k = (y * w + Math.min(w - 1, Math.max(0, i))) * 3; sr += src[k]; sg += src[k + 1]; sb += src[k + 2]; }
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 3;
      tmp[k] = sr / n2; tmp[k + 1] = sg / n2; tmp[k + 2] = sb / n2;
      const a = (y * w + Math.min(w - 1, x + r + 1)) * 3, b = (y * w + Math.max(0, x - r)) * 3;
      sr += src[a] - src[b]; sg += src[a + 1] - src[b + 1]; sb += src[a + 2] - src[b + 2];
    }
  }
  for (let x = 0; x < w; x++) {
    let sr = 0, sg = 0, sb = 0;
    for (let i = -r; i <= r; i++) { const k = (Math.min(h - 1, Math.max(0, i)) * w + x) * 3; sr += tmp[k]; sg += tmp[k + 1]; sb += tmp[k + 2]; }
    for (let y = 0; y < h; y++) {
      const k = (y * w + x) * 3;
      out[k] = sr / n2; out[k + 1] = sg / n2; out[k + 2] = sb / n2;
      const a = (Math.min(h - 1, y + r + 1) * w + x) * 3, b = (Math.max(0, y - r) * w + x) * 3;
      sr += tmp[a] - tmp[b]; sg += tmp[a + 1] - tmp[b + 1]; sb += tmp[a + 2] - tmp[b + 2];
    }
  }
  return out;
}

const REG = { bg: 0, skin: 1, eye: 2, hair: 3, cloth: 4, metal: 5 };

/**
 * @param {Uint8ClampedArray|Uint8Array} color  RGBA, alpha = detail (0..255)
 * @param {Uint8ClampedArray|Uint8Array} info   RGBA: r region code, g/b stroke direction, a key light
 * @param {number} w
 * @param {number} h
 * @param {{seed?: number, scale?: number}} [o]
 * @returns {HTMLCanvasElement}
 */
export function oilPaint(color, info, w, h, o = {}) {
  const N = w * h;
  const R = rng(((o.seed ?? 1) * 2654435761) >>> 0);
  const k = w / 300;
  const ref = new Float32Array(N * 3);
  const detail = new Float32Array(N);
  const region = new Uint8Array(N);
  const dirX = new Float32Array(N);
  const dirY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ref[i * 3] = color[i * 4]; ref[i * 3 + 1] = color[i * 4 + 1]; ref[i * 3 + 2] = color[i * 4 + 2];
    detail[i] = color[i * 4 + 3] / 255;
    region[i] = Math.round((info[i * 4] / 255) * 5);
    const dx = info[i * 4 + 1] / 127.5 - 1, dy = info[i * 4 + 2] / 127.5 - 1;
    const m = Math.hypot(dx, dy) || 1;
    dirX[i] = dx / m; dirY[i] = dy / m;
  }
  // Backdrop strokes: cross-laid sweeps whose direction wanders over the canvas.
  const bgDir = (x, y) => {
    const a = 0.75 + Math.sin(x * 0.019 / k + y * 0.011 / k) * 0.9 + Math.cos(y * 0.023 / k - x * 0.007 / k) * 0.6;
    return [Math.cos(a), Math.sin(a)];
  };
  const canvas = makeCanvas(w, h);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  // The ground: the sitter heavily softened (the underpainting).
  const ground = blur3(ref, w, h, Math.max(2, Math.round(5 * k)));
  const cur = new Float32Array(ground);
  const img = g.createImageData(w, h);
  for (let i = 0; i < N; i++) {
    img.data[i * 4] = ground[i * 3]; img.data[i * 4 + 1] = ground[i * 3 + 1]; img.data[i * 4 + 2] = ground[i * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const fine = (o.scale ?? 1) >= 0.6;
  // r: brush radius (px at full size) · blur: reference softening · thr: repaint threshold · a: opacity
  const layers = fine
    ? [{ r: 6.5, blur: 4, thr: 0, a: 0.82 }, { r: 3.4, blur: 2, thr: 10, a: 0.85 }, { r: 1.9, blur: 1, thr: 13, a: 0.85 }, { r: 1.05, blur: 0, thr: 20, a: 0.9 }]
    : [{ r: 5, blur: 3, thr: 0, a: 0.85 }, { r: 2.4, blur: 1, thr: 12, a: 0.85 }, { r: 1.3, blur: 0, thr: 18, a: 0.9 }];
  for (const L of layers) {
    const r = Math.max(0.7, L.r * k);
    const src = L.blur ? blur3(ref, w, h, Math.max(1, Math.round(L.blur * k))) : ref;
    const step = Math.max(1, r * 0.85);
    const strokes = [];
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const px = Math.min(w - 1, Math.max(0, x + (R() - 0.5) * step)) | 0;
        const py = Math.min(h - 1, Math.max(0, y + (R() - 0.5) * step)) | 0;
        const i = py * w + px;
        const reg = region[i];
        const det = detail[i];
        // The finest features are left to the last brushes; broad brushes never cross an eye.
        if (det > 0.55 && L.r > 2.5) continue;
        if (reg === REG.eye && L.r > 1.5) continue;
        if (L.thr > 0) {
          const e = Math.abs(cur[i * 3] - ref[i * 3]) + Math.abs(cur[i * 3 + 1] - ref[i * 3 + 1]) + Math.abs(cur[i * 3 + 2] - ref[i * 3 + 2]);
          const thr = L.thr * 3 * (reg === REG.skin ? 0.5 : reg === REG.bg ? 1.6 : 1);
          if (e < thr) continue;
        }
        strokes.push(i, R(), R());
      }
    }
    // Shuffle so strokes overlap naturally rather than in rows.
    const n = strokes.length / 3;
    for (let a = n - 1; a > 0; a--) {
      const b = (R() * (a + 1)) | 0;
      for (let c = 0; c < 3; c++) { const t = strokes[a * 3 + c]; strokes[a * 3 + c] = strokes[b * 3 + c]; strokes[b * 3 + c] = t; }
    }
    for (let s = 0; s < n; s++) {
      const i = strokes[s * 3], r1 = strokes[s * 3 + 1], r2 = strokes[s * 3 + 2];
      const x = i % w, y = (i / w) | 0;
      const reg = region[i];
      let cr = src[i * 3], cg = src[i * 3 + 1], cb = src[i * 3 + 2];
      let dx, dy, len, wid;
      if (reg === REG.bg) {
        [dx, dy] = bgDir(x, y);
        const a = (r1 - 0.5) * 0.7;
        const ca = Math.cos(a), sa = Math.sin(a);
        [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
        len = r * (2.5 + r2 * 3);
        wid = r * (1.1 + r1 * 0.5);
      } else {
        dx = dirX[i]; dy = dirY[i];
        const jit = (r1 - 0.5) * (reg === REG.hair ? 0.15 : 0.35);
        const ca = Math.cos(jit), sa = Math.sin(jit);
        [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
        if (reg === REG.hair) { len = r * (3.2 + r2 * 3.5); wid = r * (0.55 + r1 * 0.3); }
        else if (reg === REG.skin) { len = r * (1.4 + r2 * 1.2); wid = r * (0.9 + r1 * 0.3); }
        else if (reg === REG.eye) { len = r * 1.2; wid = r * 0.8; }
        else if (reg === REG.metal) { len = r * (1.8 + r2 * 2.0); wid = r * (0.8 + r1 * 0.3); }
        else { len = r * (1.5 + r2 * 1.6); wid = r * (1.05 + r1 * 0.35); }
      }
      // pigment variation
      const jv = (r2 - 0.5) * (reg === REG.skin ? 6 : 12);
      cr += jv; cg += jv * 0.85; cb += jv * 0.7;
      g.strokeStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${L.a})`;
      g.lineWidth = wid;
      const hx = dx * len * 0.5, hy = dy * len * 0.5;
      const bend = (r1 - 0.5) * r * 0.7;
      g.beginPath();
      g.moveTo(x - hx, y - hy);
      g.quadraticCurveTo(x - dy * bend, y + dx * bend, x + hx, y + hy);
      g.stroke();
      // Track the canvas roughly (the stroke's footprint takes its colour).
      const rr = Math.ceil(wid * 0.5);
      const ll = Math.ceil(len * 0.5);
      for (let t = -ll; t <= ll; t += Math.max(1, rr)) {
        const qx0 = x + dx * t, qy0 = y + dy * t;
        for (let oy = -rr; oy <= rr; oy++) for (let ox = -rr; ox <= rr; ox++) {
          const qx = (qx0 + ox) | 0, qy = (qy0 + oy) | 0;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = (qy * w + qx) * 3;
          cur[q] += (cr - cur[q]) * L.a; cur[q + 1] += (cg - cur[q + 1]) * L.a; cur[q + 2] += (cb - cur[q + 2]) * L.a;
        }
      }
    }
  }
  // Glaze the sitter back where the likeness lives (eyes, lips), bristle texture along the strokes,
  // a canvas weave.
  const painted = g.getImageData(0, 0, w, h);
  const P = painted.data;
  const hash = (a, b) => {
    let t = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  for (let i = 0; i < N; i++) {
    const x = i % w, y = (i / w) | 0;
    const reg = region[i];
    const keep = Math.min(1, detail[i] * 0.8 + (reg === REG.eye ? 0.6 : reg === REG.skin ? 0.12 : 0.04));
    let pr = P[i * 4] * (1 - keep) + ref[i * 3] * keep;
    let pg = P[i * 4 + 1] * (1 - keep) + ref[i * 3 + 1] * keep;
    let pb = P[i * 4 + 2] * (1 - keep) + ref[i * 3 + 2] * keep;
    let dx = dirX[i], dy = dirY[i];
    if (reg === REG.bg) [dx, dy] = bgDir(x, y);
    const along = x * dx + y * dy, across = -x * dy + y * dx;
    const br = (vn(along * 0.09 / k, across * 0.75 / k) - 0.5) * (reg === REG.eye ? 0 : reg === REG.cloth ? 0.55 : reg === REG.hair ? 1.2 : 1);
    const m = 1 + br * 0.09 * (1 - keep * 0.7);
    const weave = (Math.sin(x * 2.2) * Math.sin(y * 2.05)) * 2.2;
    P[i * 4] = pr * m + weave; P[i * 4 + 1] = pg * m + weave; P[i * 4 + 2] = pb * m + weave;
  }
  g.putImageData(painted, 0, 0);
  return canvas;
}
