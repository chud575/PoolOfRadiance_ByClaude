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
import { registerBookFonts } from './bookFace.js';

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
function leatherTexture(size, { seed = 23, base = [26, 36, 80], cells = 22 } = {}) {
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
      const k = 0.42 + 0.58 * crease + dome * 0.24 + pore * 1.6 + mott * 1.4;
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
 * Corner filigree (top-left orientation; CSS mirrors for other corners). The
 * frame's own corner sits at (26,26) of the 100-unit box, so the ornament
 * straddles the gilt band instead of sprawling over the panel's content: a
 * jewelled rosette boss on the corner, C-scroll volutes and acanthus curling
 * OUTWARD along both arms, a bevelled double fillet laid along the band, and
 * only a small fleuron reaching inside. Every stroke is laid twice (a dark
 * bevel shadow offset down-right, then the gilt face) so it reads as raised,
 * chased metal. CSS: size --cs, offset -0.26 * --cs.
 */
function cornerSVG() {
  const s = 100;
  const C = 26;
  const curlT = spiral(52, 13, 9, 1.35, -1, Math.PI * 0.5);
  const curlL = spiral(13, 52, 9, 1.35, 1, Math.PI);
  const curlT2 = spiral(80, 16, 5.2, 1.15, 1, Math.PI * 1.5);
  const curlL2 = spiral(16, 80, 5.2, 1.15, -1, 0);
  const strokes = `
      <path d="M${C} ${C - 4} H97" stroke-width="2.4"/>
      <path d="M${C - 4} ${C} V97" stroke-width="2.4"/>
      <path d="M${C + 6} ${C + 4} H74" stroke-width="1"/>
      <path d="M${C + 4} ${C + 6} V74" stroke-width="1"/>
      <path d="M30 18 C38 6 52 2 60 9 C65 14 62 22 55 21" stroke-width="2.2"/>
      <path d="M18 30 C6 38 2 52 9 60 C14 65 22 62 21 55" stroke-width="2.2"/>
      <path d="${P(curlT)}" stroke-width="1.6"/>
      <path d="${P(curlL)}" stroke-width="1.6"/>
      <path d="M60 9 C68 5 74 8 80 11" stroke-width="1.4"/>
      <path d="M9 60 C5 68 8 74 11 80" stroke-width="1.4"/>
      <path d="${P(curlT2)}" stroke-width="1.15"/>
      <path d="${P(curlL2)}" stroke-width="1.15"/>
      <path d="M62 21 C70 22 78 20 88 21" stroke-width="1"/>
      <path d="M21 62 C22 70 20 78 21 88" stroke-width="1"/>
      <path d="M14 14 C8 8 6 4 2 2" stroke-width="1.5"/>`;
  const fills = `
    <path d="M36 14 C42 10 50 11 52 17 C46 19 40 18 36 14 Z"/>
    <path d="M14 36 C10 42 11 50 17 52 C19 46 18 40 14 36 Z"/>
    <path d="M68 13 C72 10 76 11 77 15 C73 16 70 15 68 13 Z"/>
    <path d="M13 68 C10 72 11 76 15 77 C16 73 15 70 13 68 Z"/>
    <path d="M${C + 3} ${C + 3} C${C + 12} ${C + 5} ${C + 15} ${C + 9} ${C + 14} ${C + 14} C${C + 9} ${C + 15} ${C + 5} ${C + 12} ${C + 3} ${C + 3} Z"/>
    <circle cx="${C + 17}" cy="${C + 17}" r="1.5"/>
    <circle cx="88" cy="21" r="1.4"/><circle cx="21" cy="88" r="1.4"/>
    <path d="M6 1 C9 4 9 7 6 9 C3 7 3 4 6 1 Z" transform="rotate(-45 6 6)"/>`;
  // the rosette boss: eight petals round a cabochon, centred on the frame corner
  const petals = Array.from({ length: 8 }, (_, i) => `<path d="M0 -12.5 C3.6 -9 3.6 -5.5 0 -4 C-3.6 -5.5 -3.6 -9 0 -12.5 Z" transform="rotate(${i * 45 + 22.5})"/>`).join('');
  const body = `
    <g fill="none" stroke="#120a02" stroke-linecap="round" transform="translate(0.9 1.2)" opacity=".9">${strokes}</g>
    <g fill="#120a02" transform="translate(0.9 1.2)" opacity=".9">${fills}</g>
    <g fill="none" stroke="url(#g)" stroke-linecap="round">${strokes}</g>
    <g fill="none" stroke="#fff6d8" stroke-linecap="round" opacity=".4" transform="translate(-0.4 -0.5)"><path d="M${C} ${C - 4} H97" stroke-width="0.7"/><path d="M${C - 4} ${C} V97" stroke-width="0.7"/></g>
    <g fill="url(#g)" stroke="#3a2808" stroke-width=".5">${fills}</g>
    <g transform="translate(${C - 3} ${C - 3})">
      <g fill="#120a02" transform="translate(0.9 1.2)">${petals}<circle r="8.6"/></g>
      <g fill="url(#g)" stroke="#2a1a04" stroke-width=".6">${petals}</g>
      <circle r="8.4" fill="url(#g)" stroke="#2a1a04" stroke-width=".7"/>
      <circle r="6.6" fill="none" stroke="#5a3e10" stroke-width=".6"/>
      <circle r="5" fill="#0b2a40" stroke="#2a1a04" stroke-width=".6"/>
      <circle r="3.9" fill="url(#gem)"/>
      <circle cx="-1.4" cy="-1.5" r="1.2" fill="#fff"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">${GILT_DEFS('g', 100, 100)}<defs><radialGradient id="gem" cx=".4" cy=".35"><stop offset="0" stop-color="#e8ffff"/><stop offset=".45" stop-color="#5fd8f0"/><stop offset="1" stop-color="#0d4a6a"/></radialGradient></defs>${body}</svg>`;
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

/**
 * Vellum (tileable): a warm calfskin ground with soft cloudy mottling, long
 * hair-fine fibres running mostly one way, faint follicle pits, and foxing —
 * rust-brown spots with a darker core and a soft tide-line halo.
 */
function vellumTexture(size = 512, seed = 31) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const spots = [];
  for (let i = 0; i < 30; i++) spots.push([hash(i, 1, seed) * size, hash(i, 2, seed) * size, 1.4 + hash(i, 3, seed) ** 3 * 9, 0.18 + hash(i, 4, seed) * 0.42]);
  // foxing splatted per spot over its own footprint (wrapping), not tested per pixel
  const foxMap = new Float32Array(size * size);
  for (const [sx, sy, r, st] of spots) {
    const R3 = Math.ceil(r * 3);
    for (let dy = -R3; dy <= R3; dy++) {
      for (let dx = -R3; dx <= R3; dx++) {
        const d = Math.hypot(dx + (sx % 1), dy + (sy % 1)) / r;
        if (d >= 3) continue;
        const ii = (((Math.floor(sx) + dx) % size) + size) % size, jj = (((Math.floor(sy) + dy) % size) + size) % size;
        const q = jj * size + ii;
        foxMap[q] = Math.max(foxMap[q], st * (Math.exp(-d * d * 1.8) + 0.12 * Math.exp(-((d - 1.6) ** 2) * 5)));
      }
    }
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      let n = 0, a = 0.5, f = 3, tot = 0;
      for (let o = 0; o < 5; o++) { n += a * valueNoise(u * f, v * f, seed + o, f); tot += a; a *= 0.5; f *= 2; }
      n /= tot;
      // fibres: stretched along a slight diagonal, two scales
      // hair-fine fibres: short and broken (a wobble in their direction), never a grain
      const wob = valueNoise(u * 5, v * 5, seed + 44, 5) * 3;
      const fu = u * 48 + wob, fv = v * 160 + u * 24;
      const fib = (valueNoise(fu, fv, seed + 40, 160) - 0.5) * 0.1 + (valueNoise(u * 120 + v * 30, v * 120 - u * 30, seed + 41, 120) - 0.5) * 0.06;
      const pit = hash(i, j, seed + 7) > 0.996 ? -0.07 : 0;
      // broad cloudy tonal drift (the hide's thicker and thinner areas) + mottling
      const cloud = (valueNoise(u * 2, v * 2, seed + 60, 2) - 0.5) * 0.22;
      let k = 1 + (n - 0.5) * 0.46 + cloud + fib + pit;
      const fox = foxMap[j * size + i];
      const p = (j * size + i) * 4;
      img.data[p] = Math.max(0, Math.min(255, 232 * k - fox * 70));
      img.data[p + 1] = Math.max(0, Math.min(255, 214 * k - fox * 96));
      img.data[p + 2] = Math.max(0, Math.min(255, 174 * k - fox * 112));
      img.data[p + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Vellum sheet overlay (non-tiling, stretched over a panel): deckle edges that
 * darken and brown irregularly, a scorched tide-line, foxing clustered toward
 * the margins, and the curl — the sheet bowing so its top and bottom roll away
 * from the light. Transparent in the middle; drawn over the tiled vellum.
 */
function vellumSheet(size = 640, seed = 57) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      const ragged = (valueNoise(u * 22, v * 22, seed, 22) - 0.5) * 0.035 + (valueNoise(u * 7, v * 7, seed + 1, 7) - 0.5) * 0.05;
      const e = Math.min(u, 1 - u, v, 1 - v) + ragged;
      const edge = Math.max(0, 1 - e / 0.09) ** 1.6; // deckle browning
      const fall = Math.max(0, 1 - e / 0.4) ** 2.2 * 0.3; // the sheet darkens and yellows toward its edges
      const tide = Math.exp(-(((e - 0.052) / 0.01) ** 2)) * 0.16; // the tide-line
      // curl: top and bottom edges roll away (darker), a lit ridge just inside them
      const curl = Math.max(0, 1 - Math.min(v, 1 - v) / 0.12) ** 2.2 * 0.17 - Math.exp(-(((Math.min(v, 1 - v) - 0.15) / 0.04) ** 2)) * 0.06;
      const fox = Math.max(0, valueNoise(u * 9, v * 9, seed + 3, 9) - 0.72) * 2.4 * Math.max(0, 1 - e / 0.2) * 0.16;
      const a = Math.min(0.94, edge * 0.85 + fall + tide + Math.max(0, curl) + fox * 1.6);
      const p = (j * size + i) * 4;
      // browns: darker and redder toward the very edge
      img.data[p] = 120 - edge * 60;
      img.data[p + 1] = 78 - edge * 44;
      img.data[p + 2] = 34 - edge * 20;
      img.data[p + 3] = Math.max(0, a) * 255;
      if (curl < 0) {
        // the lit ridge: a whisper of warm white instead
        img.data[p] = 255; img.data[p + 1] = 246; img.data[p + 2] = 220;
        img.data[p + 3] = -curl * 255;
      }
    }
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * The Council's wax seal: an irregular blob of red wax with a raised rim, a
 * pressed sigil (the tower of Phlan over the waves, with a ring of beads) in
 * relief — lit edge up-left, shadowed edge down-right — and a hot specular.
 */
function waxSealSVG() {
  const blob = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = 46 + Math.sin(a * 3 + 1) * 2.4 + Math.sin(a * 7) * 1.6 + (hash(i, 9, 3) - 0.5) * 2.4;
    blob.push(`${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`);
  }
  const tower = 'M38 66 L38 44 L35 44 L35 37 L39 37 L39 40 L43 40 L43 37 L47 37 L47 40 L53 40 L53 37 L57 37 L57 40 L61 40 L61 37 L65 37 L65 44 L62 44 L62 66 Z M47 66 L47 57 Q50 53 53 57 L53 66 Z';
  const waves = 'M30 72 Q35 68 40 72 T50 72 T60 72 T70 72';
  const beads = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return `<circle cx="${(50 + Math.cos(a) * 33).toFixed(1)}" cy="${(50 + Math.sin(a) * 33).toFixed(1)}" r="1.6"/>`;
  }).join('');
  const relief = (fill, dx, dy, op) => `<g transform="translate(${dx} ${dy})" fill="${fill}" stroke="${fill}" opacity="${op}"><path d="${tower}" stroke="none"/><path d="${waves}" fill="none" stroke-width="2.6" stroke-linecap="round"/>${beads}<circle cx="50" cy="50" r="37" fill="none" stroke-width="1.6"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <radialGradient id="w" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#e2493c"/><stop offset="0.45" stop-color="#a81e16"/><stop offset="0.85" stop-color="#6a0d08"/><stop offset="1" stop-color="#4a0805"/></radialGradient>
      <radialGradient id="pool" cx="50%" cy="52%" r="50%"><stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="0.86" stop-color="#3a0402" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <radialGradient id="spec" cx="34%" cy="28%" r="22%"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <polygon points="${blob.join(' ')}" fill="url(#w)"/>
    <circle cx="50" cy="51" r="40" fill="url(#pool)"/>
    <circle cx="50" cy="50" r="39" fill="none" stroke="#ff8a70" stroke-opacity="0.35" stroke-width="1.2" transform="translate(-0.8 -0.8)"/>
    <circle cx="50" cy="50" r="39" fill="none" stroke="#2a0201" stroke-opacity="0.6" stroke-width="1.2" transform="translate(0.8 0.8)"/>
    ${relief('#2a0302', 1.1, 1.2, 0.75)}
    ${relief('#ff9a7e', -0.8, -0.9, 0.55)}
    ${relief('#a01a12', 0, 0, 1)}
    <ellipse cx="36" cy="30" rx="16" ry="10" fill="url(#spec)" transform="rotate(-25 36 30)"/>
  </svg>`;
}

const url = (svg) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** Generate textures + filigree and publish them as CSS custom properties. */
export function installSkin() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement.style;
  registerBookFonts();
  try {
    root.setProperty('--tex-parchment', `url(${vellumTexture(512)})`);
    root.setProperty('--tex-vellum-sheet', `url(${vellumSheet(640)})`);
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
  root.setProperty('--wax-seal', url(waxSealSVG()));
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
  // text-size bucket for layouts that reflow at big sizes (settings rows stack, help pane trims)
  el.dataset.text = get('fontSize');
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
    // index.html may already have set data-classic pre-boot: the bitmap face
    // must still be generated, so register it before the early-out
    if (on) registerBitmapFont();
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
  // last input device (data-input = kb | pad): prompts show keycaps or pad
  // glyphs, not both, so legends stay uncluttered
  el.dataset.input ??= 'kb';
  ctx.bus?.on?.('input:action', ({ code } = {}) => {
    const next = String(code ?? '').startsWith('pad:') ? 'pad' : 'kb';
    if (el.dataset.input !== next) el.dataset.input = next;
  });
  const toKb = () => el.dataset.input !== 'kb' && (el.dataset.input = 'kb');
  window.addEventListener('keydown', toKb, true);
  window.addEventListener('pointerdown', toKb, true);
}
