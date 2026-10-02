/**
 * The illustrator's hand over a rendered portrait: a stroke-based repaint in
 * the manner of an oil sketch (after Hertzmann's layered painterly rendering).
 *
 * The render is the reference photograph. A coarse layer lays in the masses
 * with broad strokes — the backdrop in loose directional sweeps, the figure
 * with strokes that follow its forms (along the isophotes, perpendicular to
 * the light gradient). Finer layers repaint only where the canvas still
 * differs from the reference, so the brushwork is broad in the planes and
 * tight around the eyes, nose and mouth. A last, sparse layer of tiny strokes
 * restores the accents; then a little of the reference is glazed back so the
 * likeness never drifts. Deterministic for a seed; CPU canvas only.
 */

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Separable box blur of an RGBA buffer (radius r, two passes ≈ gaussian). */
function blur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  const pass = (a, b, horiz) => {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let j = 0; j < m; j++) {
      let sr = 0, sg = 0, sb = 0;
      const idx = (i) => (horiz ? j * w + i : i * w + j) * 3;
      for (let i = -r; i <= r; i++) {
        const k = idx(Math.min(n - 1, Math.max(0, i)));
        sr += a[k]; sg += a[k + 1]; sb += a[k + 2];
      }
      for (let i = 0; i < n; i++) {
        const k = idx(i);
        b[k] = sr / (2 * r + 1); b[k + 1] = sg / (2 * r + 1); b[k + 2] = sb / (2 * r + 1);
        const ka = idx(Math.min(n - 1, i + r + 1)), kr = idx(Math.max(0, i - r));
        sr += a[ka] - a[kr]; sg += a[ka + 1] - a[kr + 1]; sb += a[ka + 2] - a[kr + 2];
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

/**
 * Repaint `canvas` in place with brush strokes.
 * @param {HTMLCanvasElement} canvas
 * @param {{seed?: number, fine?: boolean, strength?: number, face?: {x:number, y:number, rx:number, ry:number}}} [o]
 *   face: the head's ellipse in pixels — inside it only fine strokes go down and most of the
 *   render is kept (features stay crisp; the brushwork lives in hair, costume and backdrop).
 */
export function paintStrokes(canvas, o = {}) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, w, h);
  const D = img.data;
  const ref = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < D.length; i += 4, j += 3) { ref[j] = D[i]; ref[j + 1] = D[i + 1]; ref[j + 2] = D[i + 2]; }
  const R = rng((o.seed ?? 1) * 2654435761);
  const k = w / 300; // brush scale relative to the full-size portrait
  // Structure: gradient of the softly blurred luminance gives the stroke direction.
  const soft = blur(ref, w, h, Math.max(1, Math.round(2 * k)));
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.3 * soft[i * 3] + 0.59 * soft[i * 3 + 1] + 0.11 * soft[i * 3 + 2];
  const grad = (x, y) => {
    const xi = Math.min(w - 2, Math.max(1, x | 0)), yi = Math.min(h - 2, Math.max(1, y | 0));
    const gx = lum[yi * w + xi + 1] - lum[yi * w + xi - 1];
    const gy = lum[(yi + 1) * w + xi] - lum[(yi - 1) * w + xi];
    return [gx, gy];
  };
  // Where the figure is: the backdrop is darker and flatter; strokes there sweep on a diagonal.
  const isBackdrop = (x, y) => {
    const [gx, gy] = grad(x, y);
    const l = lum[Math.min(h - 1, y | 0) * w + Math.min(w - 1, x | 0)];
    return Math.hypot(gx, gy) < 2.2 && l < 70;
  };
  const F = o.face;
  /** 1 deep inside the face, 0 outside it. */
  const faceW = (x, y) => {
    if (!F) return 0;
    const d = Math.hypot((x - F.x) / F.rx, (y - F.y) / F.ry);
    return Math.max(0, Math.min(1, (1.15 - d) / 0.3));
  };
  const cur = new Float32Array(w * h * 3);
  for (let i = 0; i < cur.length; i++) cur[i] = ref[i];
  // The canvas starts as a toned ground: the reference blurred heavily (the underpainting).
  const ground = blur(ref, w, h, Math.max(2, Math.round(6 * k)));
  const out = g.createImageData(w, h);
  for (let i = 0, j = 0; j < ground.length; i += 4, j += 3) {
    const x = (j / 3) % w, y = ((j / 3) / w) | 0;
    const f = faceW(x, y);
    for (let c = 0; c < 3; c++) { ground[j + c] = ground[j + c] * (1 - f) + ref[j + c] * f; out.data[i + c] = ground[j + c]; }
    out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  for (let i = 0; i < cur.length; i++) cur[i] = ground[i];
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const layers = o.fine === false
    ? [{ r: 5, blur: 3, thr: 0, a: 0.85 }, { r: 2.4, blur: 1, thr: 14, a: 0.8 }]
    : [{ r: 7, blur: 4, thr: 0, a: 0.8 }, { r: 3.6, blur: 2, thr: 12, a: 0.82 }, { r: 1.9, blur: 1, thr: 16, a: 0.85 }, { r: 1.1, blur: 0, thr: 26, a: 0.9 }];
  for (const L of layers) {
    const r = Math.max(0.8, L.r * k);
    const src = L.blur ? blur(ref, w, h, Math.max(1, Math.round(L.blur * k))) : ref;
    const step = Math.max(1, r * 0.9);
    const strokes = [];
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const px = Math.min(w - 1, Math.max(0, x + (R() - 0.5) * step)), py = Math.min(h - 1, Math.max(0, y + (R() - 0.5) * step));
        const idx = ((py | 0) * w + (px | 0)) * 3;
        if (L.thr > 0) {
          // Paint only where the canvas still differs from the reference.
          const e = Math.abs(cur[idx] - ref[idx]) + Math.abs(cur[idx + 1] - ref[idx + 1]) + Math.abs(cur[idx + 2] - ref[idx + 2]);
          if (e < L.thr * 3) continue;
        }
        const fw = faceW(px, py);
        // On the face: no broad strokes; the fine ones model the planes (colour from a softened
        // reference so a dark lash never smears across a cheek).
        if (fw > 0 && L.r > 2.5 && R() < fw) continue;
        strokes.push([px, py, R(), R()]);
      }
    }
    // Shuffle so strokes overlap naturally rather than in rows.
    for (let i = strokes.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = strokes[i]; strokes[i] = strokes[j]; strokes[j] = t; }
    for (const [x, y, r1, r2] of strokes) {
      const idx = ((y | 0) * w + (x | 0)) * 3;
      const onFace = faceW(x, y);
      const sc = onFace > 0 ? soft : src;
      let cr = sc[idx], cg = sc[idx + 1], cb = sc[idx + 2];
      if (onFace > 0) {
        // The painter's temperature: lights lean warm, shadows lean cool (never one waxy orange).
        const l = (0.3 * cr + 0.59 * cg + 0.11 * cb) / 255;
        const warm = Math.max(0, l - 0.45) * 2, cool = Math.max(0, 0.42 - l) * 2;
        cr += (18 * warm - 10 * cool) * onFace; cg += (8 * warm - 2 * cool) * onFace; cb += (-10 * warm + 16 * cool) * onFace;
      }
      let dx, dy, len;
      if (isBackdrop(x, y)) {
        // Loose diagonal sweeps on the backdrop, a little wavy.
        const a = -0.62 + (r1 - 0.5) * 0.5;
        dx = Math.cos(a); dy = Math.sin(a);
        len = r * (3.2 + r2 * 3);
      } else {
        const [gx, gy] = grad(x, y);
        const m = Math.hypot(gx, gy);
        if (m < 0.4) { const a = r1 * Math.PI; dx = Math.cos(a); dy = Math.sin(a); } else { dx = -gy / m; dy = gx / m; }
        len = r * (1.6 + r2 * (m > 6 ? 1 : 2.4));
      }
      // Slight colour jitter per stroke (pigment variation).
      const jv = (r2 - 0.5) * 10;
      g.strokeStyle = `rgba(${Math.round(cr + jv)},${Math.round(cg + jv * 0.8)},${Math.round(cb + jv * 0.6)},${L.a})`;
      g.lineWidth = r * (0.85 + r1 * 0.4);
      g.beginPath();
      const hx = dx * len * 0.5, hy = dy * len * 0.5;
      const bend = (r1 - 0.5) * r * 0.6;
      g.moveTo(x - hx, y - hy);
      g.quadraticCurveTo(x - dy * bend, y + dx * bend, x + hx, y + hy);
      g.stroke();
      // Track the canvas state roughly (the stroke's footprint takes its colour).
      const rr = Math.ceil(r * 0.6);
      for (let oy = -rr; oy <= rr; oy++) for (let ox = -rr; ox <= rr; ox++) {
        const qx = (x + ox) | 0, qy = (y + oy) | 0;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = (qy * w + qx) * 3;
        cur[q] += (cr - cur[q]) * L.a; cur[q + 1] += (cg - cur[q + 1]) * L.a; cur[q + 2] += (cb - cur[q + 2]) * L.a;
      }
    }
  }
  // Glaze a little of the reference back so the likeness holds (eyes, lips), then a faint weave.
  const painted = g.getImageData(0, 0, w, h);
  const P = painted.data;
  const keep = o.strength != null ? 1 - o.strength : 0.28;
  for (let i = 0, j = 0; i < P.length; i += 4, j += 3) {
    // Keep more of the reference where it is detailed (edges), less in flat planes.
    const x = (j / 3) % w, y = ((j / 3) / w) | 0;
    const [gx, gy] = grad(x, y);
    const e = Math.min(1, Math.hypot(gx, gy) / 30);
    const kk = Math.min(1, keep + e * 0.3 + faceW(x, y) * 0.5);
    P[i] = P[i] * (1 - kk) + ref[j] * kk;
    P[i + 1] = P[i + 1] * (1 - kk) + ref[j + 1] * kk;
    P[i + 2] = P[i + 2] * (1 - kk) + ref[j + 2] * kk;
    const weave = (((x + y) & 1) * 2 - 1) * 1.6;
    P[i] += weave; P[i + 1] += weave; P[i + 2] += weave;
  }
  g.putImageData(painted, 0, 0);
  return canvas;
}
