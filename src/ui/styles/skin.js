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

import { registerBitmapFont } from './bitmapFontFace.js';

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
      if (fibres) fb = (valueNoise((i / size) * 32, (j / size) * 32, seed + 9, 32) - 0.5) * fibres;
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

/**
 * Pebbled book-binding leather (tileable): jittered cellular pebbles with dark
 * creases between them, a soft top-light on each pebble and fine pores.
 */
function leatherTexture(size, { seed = 23, base = [22, 30, 66], cells = 22 } = {}) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + 0.15 + hash(i, j, seed) * 0.7) / cells, (j + 0.15 + hash(i, j, seed + 1) * 0.7) / cells]);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let d1 = 9, d2 = 9, best = null;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
        const p = pts[jj * cells + ii];
        const dx = p[0] + (ci + di - ii) / cells - u;
        const dy = p[1] + (cj + dj - jj) / cells - v;
        const d = Math.hypot(dx, dy) * cells;
        if (d < d1) { d2 = d1; d1 = d; best = [dx, dy]; } else if (d < d2) d2 = d;
      }
      const crease = Math.min(1, (d2 - d1) * 3.2); // 0 at the crease
      const dome = best ? Math.max(0, -best[1] * cells * 0.9 + 0.2) : 0; // light from above
      const pore = hash(px, py, seed + 5) > 0.93 ? -0.06 : 0;
      const mott = (valueNoise(u * 4, v * 4, seed + 9, 4) - 0.5) * 0.18;
      const k = 0.62 + 0.38 * crease + dome * 0.12 + pore + mott;
      const o = (py * size + px) * 4;
      img.data[o] = base[0] * k;
      img.data[o + 1] = base[1] * k;
      img.data[o + 2] = base[2] * k * 1.02;
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Blind-tooled leather repeat (the --tex-brocade layer): a fine diamond
 * lattice of double fillets with a small four-petal fleuron at every crossing,
 * pressed into the hide — each line is a dark impression with a faint lit lip
 * below it, so it reads as tooling, not printed wallpaper. Low contrast by
 * design: it should only show where the light grazes the panel.
 */
function brocadeSVG() {
  const W = 48, H = 56;
  const lattice = `M0 0 L${W} ${H} M${W} 0 L0 ${H} M${-W / 2} ${H / 2} L${W / 2} ${H * 1.5} M${W / 2} ${-H / 2} L${W * 1.5} ${H / 2} M${W / 2} ${-H / 2} L${-W / 2} ${H / 2} M${W * 1.5} ${H / 2} L${W / 2} ${H * 1.5}`;
  const fleuron = (cx, cy) => `<g transform="translate(${cx} ${cy})"><path d="M0 -5 C1.6 -2.4 1.6 -1.2 0 0 C-1.6 -1.2 -1.6 -2.4 0 -5 Z M0 5 C1.6 2.4 1.6 1.2 0 0 C-1.6 1.2 -1.6 2.4 0 5 Z M-5 0 C-2.4 1.4 -1.2 1.4 0 0 C-1.2 -1.4 -2.4 -1.4 -5 0 Z M5 0 C2.4 1.4 1.2 1.4 0 0 C1.2 -1.4 2.4 -1.4 5 0 Z"/><circle r="0.9"/></g>`;
  const fl = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]].map(([x, y]) => fleuron(x, y)).join('');
  const dots = [[W / 2, 0], [0, H / 2], [W, H / 2], [W / 2, H]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.9"/>`).join('');
  const layer = (stroke, fill, dy, a) => `<g transform="translate(0 ${dy})" opacity="${a}">
      <path d="${lattice}" fill="none" stroke="${stroke}" stroke-width="0.7"/>
      <path d="${lattice}" fill="none" stroke="${stroke}" stroke-width="0.45" transform="translate(0 2.6)"/>
      <g fill="${fill}">${fl}${dots}</g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    ${layer('rgb(205,218,255)', 'rgb(205,218,255)', 0.7, 0.045)}
    ${layer('rgb(0,0,12)', 'rgb(0,0,12)', 0, 0.2)}
  </svg>`;
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

const GILT_DEFS = (id, w = 64, hh = 64) => `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="${hh}"><stop offset="0" stop-color="#fff1c4"/><stop offset=".35" stop-color="#e2bb62"/><stop offset=".6" stop-color="#9a7230"/><stop offset="1" stop-color="#f0d283"/></linearGradient></defs>`;

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
 * Corner filigree (top-left orientation; CSS mirrors for other corners), drawn
 * at 96 units for ~4em display: a bevelled double rule ending in a jewelled
 * boss, two C-scroll volutes curling off each arm, acanthus leaves and a
 * pendant bud. Every stroke is laid twice — a dark bevel shadow offset down-
 * right, then the two-tone gilt face — so it reads as raised metal.
 */
function cornerSVG() {
  const s = 96;
  const curlA = spiral(46, 16, 10, 1.3, -1, Math.PI * 0.5);
  const curlB = spiral(16, 46, 10, 1.3, 1, Math.PI);
  const curlC = spiral(70, 9, 5.5, 1.1, 1, Math.PI * 1.5);
  const curlD = spiral(9, 70, 5.5, 1.1, -1, 0);
  const strokes = `
      <path d="M5 5 H94" stroke-width="3"/>
      <path d="M5 5 V94" stroke-width="3"/>
      <path d="M12 12 H70" stroke-width="1.3"/>
      <path d="M12 12 V70" stroke-width="1.3"/>
      <path d="M16 16 C30 16 40 8 52 15 C58 19 56 27 50 26" stroke-width="2.1"/>
      <path d="M16 16 C16 30 8 40 15 52 C19 58 27 56 26 50" stroke-width="2.1"/>
      <path d="${P(curlA)}" stroke-width="1.7"/>
      <path d="${P(curlB)}" stroke-width="1.7"/>
      <path d="M52 15 C60 10 66 6 74 9" stroke-width="1.4"/>
      <path d="M15 52 C10 60 6 66 9 74" stroke-width="1.4"/>
      <path d="${P(curlC)}" stroke-width="1.2"/>
      <path d="${P(curlD)}" stroke-width="1.2"/>
      <path d="M24 24 C33 33 40 33 50 38" stroke-width="1.3"/>
      <path d="M24 24 C33 33 33 40 38 50" stroke-width="1.3"/>`;
  const fills = `
    <path d="M24 18 C32 20 36 26 34 34 C28 30 24 26 24 18 Z"/>
    <path d="M18 24 C20 32 26 36 34 34 C30 28 26 24 18 24 Z"/>
    <path d="M44 34 C49 31 54 33 55 38 C50 39 46 38 44 34 Z"/>
    <path d="M34 44 C31 49 33 54 38 55 C39 50 38 46 34 44 Z"/>
    <circle cx="51" cy="40" r="1.6"/><circle cx="40" cy="51" r="1.6"/>`;
  const body = `
    <g fill="none" stroke="#120a02" stroke-linecap="round" transform="translate(0.9 1.2)" opacity=".85">${strokes}</g>
    <g fill="#120a02" transform="translate(0.9 1.2)" opacity=".85">${fills}</g>
    <g fill="none" stroke="url(#g)" stroke-linecap="round">${strokes}</g>
    <g fill="none" stroke="#fff6d8" stroke-linecap="round" opacity=".35" transform="translate(-0.4 -0.5)"><path d="M5 5 H94" stroke-width="0.8"/><path d="M5 5 V94" stroke-width="0.8"/></g>
    <g fill="url(#g)" stroke="#3a2808" stroke-width=".5">${fills}</g>
    <path d="M7 -1 L15 7 L7 15 L-1 7 Z" fill="#120a02" transform="translate(0.8 1)"/>
    <path d="M7 -1 L15 7 L7 15 L-1 7 Z" fill="url(#g)" stroke="#2a1a04" stroke-width=".7"/>
    <circle cx="7" cy="7" r="3.2" fill="#0b2a40" stroke="#2a1a04" stroke-width=".6"/>
    <circle cx="7" cy="7" r="2.3" fill="url(#gem)"/>
    <circle cx="6.1" cy="6" r=".8" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${s} ${s}" width="${s}" height="${s}">${GILT_DEFS('g', 96, 96)}<defs><radialGradient id="gem"><stop offset="0" stop-color="#e8ffff"/><stop offset=".5" stop-color="#5fd8f0"/><stop offset="1" stop-color="#0d4a6a"/></radialGradient></defs>${body}</svg>`;
}

/** Centre crest for frame tops: lozenge with flanking scroll volutes. */
function crestSVG() {
  const l = spiral(26, 12, 6, 1.2, 1, 0);
  const r = spiral(94, 12, 6, 1.2, -1, Math.PI);
  const st = `<path d="M2 14 C14 14 18 4 30 6" stroke-width="1.5"/><path d="M118 14 C106 14 102 4 90 6" stroke-width="1.5"/><path d="${P(l)}" stroke-width="1.3"/><path d="${P(r)}" stroke-width="1.3"/><path d="M36 14 C44 20 52 20 60 14 C68 20 76 20 84 14" stroke-width="1.1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24" width="120" height="24">${GILT_DEFS('g', 120, 24)}
    <g fill="none" stroke="#120a02" stroke-linecap="round" transform="translate(.7 .9)">${st}</g>
    <g fill="none" stroke="url(#g)" stroke-linecap="round">${st}</g></svg>`;
}

/** Horizontal divider: fine double rule with a centre lozenge and scrolls. */
function ruleSVG() {
  const w = 320, h = 20, c = w / 2;
  const l = spiral(c - 22, 10, 5, 1.1, 1, 0);
  const r = spiral(c + 22, 10, 5, 1.1, -1, Math.PI);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">${GILT_DEFS('g', w, h)}
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 18" width="60" height="18">${GILT_DEFS('g', 60, 18)}
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
    root.setProperty('--tex-parchment', `url(${noiseTexture(256, { seed: 11, base: [228, 210, 170], amp: 0.22, scale: 4, fibres: 0.05, mottle: 0.22 })})`);
    root.setProperty('--tex-leather', `url(${leatherTexture(256)})`);
    root.setProperty('--tex-grain', `url(${grainTexture(128)})`);
  } catch {
    /* canvas unavailable: CSS falls back to gradients */
  }
  root.setProperty('--filigree-corner', url(cornerSVG()));
  root.setProperty('--filigree-crest', url(crestSVG()));
  root.setProperty('--tex-brocade', url(brocadeSVG()));
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

let boundCtx = null;
/**
 * Keep <html> in sync with the live context: skin/accessibility settings,
 * classic 1988 mode (data-classic → EGA UI skin + bitmap font) and frozen
 * debug clocks (data-frozen → CSS animations parked so shots are identical).
 * Idempotent; safe to call from any scene or panel.
 * @param {import('../../core/context.js').GameContext} ctx
 */
export function bindSkin(ctx) {
  if (typeof document === 'undefined' || !ctx) return;
  const el = document.documentElement;
  const syncClassic = (on) => {
    const next = on ? '1' : '0';
    if (el.dataset.classic === next) return;
    // flip the whole skin in one frame: park transitions while the EGA rules
    // come and go, so no row keeps a half-faded classic box or highlight bar
    el.dataset.snap = '1';
    el.dataset.classic = next;
    if (on) registerBitmapFont();
    void document.body?.offsetWidth;
    delete el.dataset.snap;
  };
  syncClassic(!!(ctx.render?.classic ?? ctx.settings?.get?.('classicMode')));
  if (ctx.clock?.frozen || ctx.debug?.frozen) el.dataset.frozen = '1';
  if (boundCtx === ctx) return;
  boundCtx = ctx;
  applySkinSettings(ctx.settings);
  ctx.bus?.on?.('settings:changed', ({ key, value }) => {
    if (key === 'classicMode') syncClassic(!!value);
    else if (key in SKIN_DEFAULTS) applySkinSettings(ctx.settings);
  });
}
