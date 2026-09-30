/**
 * Procedural UI skin assets + accessibility application.
 *
 * installSkin() (idempotent, runs on first import of Frame.js) generates the
 * skin's textures at boot — parchment, leather, grain (canvas noise) and gilt
 * filigree (SVG scrollwork computed from spirals) — and exposes them as CSS
 * custom properties on :root. No image assets are loaded.
 *
 * applySkinSettings(settings) maps accessibility/UI settings onto <html>
 * attributes and CSS variables (index.html does the same pre-boot from
 * localStorage so the first frame is already correct).
 */

let installed = false;

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, s, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const P = (a) => ((a % period) + period) % period;
  const a = hash(P(xi), P(yi), s), b = hash(P(xi + 1), P(yi), s);
  const c = hash(P(xi), P(yi + 1), s), d = hash(P(xi + 1), P(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fbm canvas → data URL. */
function noiseTexture(size, { seed = 1, base, amp, octaves = 5, scale = 4, fibres = 0, alpha = 255, mottle = 0 }) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let n = 0, a = 0.5, f = scale, tot = 0;
      for (let o = 0; o < octaves; o++) {
        n += a * valueNoise((i / size) * f, (j / size) * f, seed + o, f);
        tot += a;
        a *= 0.5;
        f *= 2;
      }
      n /= tot;
      // fibres: stretched high-frequency streaks
      let fb = 0;
      if (fibres) fb = (valueNoise((i / size) * 64, (j / size) * 6, seed + 9, 64) - 0.5) * fibres;
      let m = 0;
      if (mottle) m = (valueNoise((i / size) * 3, (j / size) * 3, seed + 17, 3) - 0.5) * mottle;
      const k = (n - 0.5) * amp + fb + m;
      const p = (j * size + i) * 4;
      img.data[p] = Math.max(0, Math.min(255, base[0] + k * 255));
      img.data[p + 1] = Math.max(0, Math.min(255, base[1] + k * 235));
      img.data[p + 2] = Math.max(0, Math.min(255, base[2] + k * 200));
      img.data[p + 3] = alpha;
    }
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Grain overlay: transparent with light/dark specks. */
function grainTexture(size, seed = 3) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let p = 0; p < size * size; p++) {
    const r = hash(p % size, Math.floor(p / size), seed);
    const v = r > 0.5 ? 255 : 0;
    img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = v;
    img.data[p * 4 + 3] = Math.abs(r - 0.5) * 34;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const GILT_DEFS = (id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".35" stop-color="#e2bb62"/><stop offset=".6" stop-color="#9a7230"/><stop offset="1" stop-color="#f0d283"/></linearGradient></defs>`;

/** Spiral polyline points (Archimedean-ish, tightening), for scroll curls. */
function spiral(cx, cy, r0, turns, dir = 1, start = 0) {
  const pts = [];
  const steps = Math.round(turns * 28);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = start + dir * f * turns * Math.PI * 2;
    const r = r0 * (1 - f * 0.82);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
const P = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');

/**
 * Corner filigree (top-left orientation; CSS mirrors for other corners):
 * an L of double rules meeting in a jewelled boss, with C-scrolls curling off
 * both arms and a small acanthus leaf.
 */
function cornerSVG() {
  const s = 64;
  const curlA = spiral(30, 12, 7, 1.15, -1, Math.PI * 0.5);
  const curlB = spiral(12, 30, 7, 1.15, 1, Math.PI);
  const body = `
    <g fill="none" stroke="url(#g)" stroke-linecap="round">
      <path d="M4 4 H62" stroke-width="2.4"/>
      <path d="M4 4 V62" stroke-width="2.4"/>
      <path d="M10 10 H46" stroke-width="1.1" opacity=".85"/>
      <path d="M10 10 V46" stroke-width="1.1" opacity=".85"/>
      <path d="M12 12 C22 12 30 6 38 12 C42 15 40 20 36 19" stroke-width="1.6"/>
      <path d="M12 12 C12 22 6 30 12 38 C15 42 20 40 19 36" stroke-width="1.6"/>
      <path d="${P(curlA)}" stroke-width="1.3"/>
      <path d="${P(curlB)}" stroke-width="1.3"/>
      <path d="M20 20 C26 26 30 26 36 30" stroke-width="1" opacity=".8"/>
      <path d="M20 20 C26 26 26 30 30 36" stroke-width="1" opacity=".8"/>
    </g>
    <path d="M4 0 L8 4 L4 8 L0 4 Z" fill="url(#g)" stroke="#1a1004" stroke-width=".6"/>
    <path d="M18 14 Q22 18 18 22 Q14 18 18 14 Z" fill="url(#g)" opacity=".9"/>
    <circle cx="4" cy="4" r="1.6" fill="#8ff0ff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">${GILT_DEFS('g')}${body}</svg>`;
}

/** Horizontal divider: fine double rule with a centre lozenge and scrolls. */
function ruleSVG() {
  const w = 320, h = 20, c = w / 2;
  const l = spiral(c - 22, 10, 5, 1.1, 1, 0);
  const r = spiral(c + 22, 10, 5, 1.1, -1, Math.PI);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">${GILT_DEFS('g')}
    <g fill="none" stroke="url(#g)" stroke-linecap="round">
      <path d="M0 10 H${c - 34}" stroke-width="1.2"/><path d="M${c + 34} 10 H${w}" stroke-width="1.2"/>
      <path d="M${c - 34} 10 C${c - 30} 4 ${c - 24} 4 ${c - 20} 8" stroke-width="1.2"/>
      <path d="M${c + 34} 10 C${c + 30} 16 ${c + 24} 16 ${c + 20} 12" stroke-width="1.2"/>
      <path d="${P(l)}" stroke-width="1.1"/><path d="${P(r)}" stroke-width="1.1"/>
    </g>
    <path d="M${c} 3 L${c + 6} 10 L${c} 17 L${c - 6} 10 Z" fill="url(#g)" stroke="#1a1004" stroke-width=".6"/>
  </svg>`;
}

/** Small scroll flourish used as a heading ornament (left; mirror for right). */
function flourishSVG() {
  const sp = spiral(10, 9, 6, 1.2, 1, Math.PI);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 18" width="60" height="18">${GILT_DEFS('g')}
    <g fill="none" stroke="url(#g)" stroke-linecap="round"><path d="M58 9 C44 9 30 3 18 8" stroke-width="1.4"/><path d="${P(sp)}" stroke-width="1.3"/><path d="M40 9 C34 14 28 15 24 13" stroke-width="1"/></g>
    <path d="M56 5 L60 9 L56 13 L52 9 Z" fill="url(#g)"/></svg>`;
}

const url = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** Generate textures + filigree and publish them as CSS custom properties. */
export function installSkin() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement.style;
  try {
    root.setProperty('--tex-parchment', `url(${noiseTexture(256, { seed: 11, base: [226, 208, 168], amp: 0.34, scale: 3, fibres: 0.1, mottle: 0.16 })})`);
    root.setProperty('--tex-leather', `url(${noiseTexture(256, { seed: 23, base: [26, 30, 52], amp: 0.16, scale: 16, octaves: 4, mottle: 0.08 })})`);
    root.setProperty('--tex-grain', `url(${grainTexture(128)})`);
  } catch {
    /* canvas unavailable: CSS falls back to gradients */
  }
  root.setProperty('--filigree-corner', url(cornerSVG()));
  root.setProperty('--filigree-rule', url(ruleSVG()));
  root.setProperty('--filigree-flourish', url(flourishSVG()));
}

/** Setting keys + defaults owned by the UI skin (stored in core Settings). */
export const SKIN_DEFAULTS = {
  uiScale: 1, // 0.8 .. 1.5
  fontSize: 'normal', // small | normal | large | huge
  colorblind: 'off', // off | deutan | protan | tritan
  highContrast: false,
  reduceMotion: false,
  readableFont: false,
};

const FONT_SCALE = { small: 0.9, normal: 1, large: 1.14, huge: 1.3 };

/** Apply skin-related settings to the document. */
export function applySkinSettings(settings) {
  if (typeof document === 'undefined') return;
  const get = (k) => settings?.get?.(k) ?? SKIN_DEFAULTS[k];
  const el = document.documentElement;
  el.style.setProperty('--ui-user-scale', String(get('uiScale')));
  el.style.setProperty('--text-scale', String(FONT_SCALE[get('fontSize')] ?? 1));
  el.dataset.palette = get('colorblind');
  el.dataset.contrast = get('highContrast') ? 'high' : 'normal';
  el.dataset.motion = get('reduceMotion') ? 'reduce' : 'full';
  el.dataset.font = get('readableFont') ? 'readable' : 'classic';
}
