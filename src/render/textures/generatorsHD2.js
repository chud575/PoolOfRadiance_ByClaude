import { worley, hash2, clamp01, lerp, smooth, valueNoise } from './noise.js';

/**
 * Second-generation masonry generators (explore-renderer workstream).
 *
 * Built for 1024² tiles: every noise field is baked once into a small tileable
 * grid and bilinearly sampled, so a 1024² material costs about what the old
 * 512² generators did. Stones have crisp arrises (narrow, linear chamfers),
 * flat dressed faces with a per-stone tilt and micro relief, sharp-edged chips
 * and spalls, and mortar that sits recessed as a soft groove — no pillowing.
 * Same contract as generatorsHD: (u, v) → {c, h, r}.
 */

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const fract = (x) => x - Math.floor(x);

const fade = (t) => t * t * (3 - 2 * t);
const wrap = (a, n) => ((a % n) + n) % n;
/** Value noise with independent integer periods per axis (tileable). */
function vnoise2(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const x0 = wrap(xi, px);
  const x1 = wrap(xi + 1, px);
  const y0 = wrap(yi, py);
  const y1 = wrap(yi + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm2(u, v, px, py, octaves, seed) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const k = 1 << i;
    sum += amp * vnoise2(u * px * k, v * py * k, px * k, py * k, seed + i * 31);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Bake a tileable fbm field into a res² grid; returns a bilinear sampler
 * f(u, v) over the unit tile (wraps). `aniso` scales the v frequency
 * (rounded to keep it tileable): < 1 stretches features vertically.
 */
export function bake(res, period, { octaves = 4, seed = 0, warp = 0, aniso = 1 } = {}) {
  const d = new Float32Array(res * res);
  const py = Math.max(1, Math.round(period * aniso));
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      let u = x / res;
      let v = y / res;
      if (warp) {
        u += warp * (fbm2(u, v, 4, 4, 2, seed + 91) - 0.5) / 4;
        v += warp * (fbm2(u + 0.31, v + 0.17, 4, 4, 2, seed + 92) - 0.5) / 4;
      }
      d[y * res + x] = fbm2(u, v, period, py, octaves, seed);
    }
  }
  return (u, v) => {
    const fx = fract(u) * res;
    const fy = fract(v) * res;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const x1 = (x0 + 1) % res;
    const y1 = (y0 + 1) % res;
    const a = d[y0 * res + x0];
    const b = d[y0 * res + x1];
    const c = d[y1 * res + x0];
    const e = d[y1 * res + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  };
}

/** Running-bond layout with irregular course heights / stone lengths (tileable). */
function layout({ rows, seed, minW, maxW }) {
  const rb = [0];
  const weights = [];
  for (let r = 0; r < rows; r++) weights.push(0.7 + hash2(r, 7, seed) * 0.6);
  const tot = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let r = 0; r < rows; r++) {
    acc += weights[r] / tot;
    rb.push(acc);
  }
  rb[rows] = 1;
  const breaks = [];
  for (let r = 0; r < rows; r++) {
    const list = [];
    let x = hash2(r, 3, seed);
    const start = x;
    list.push(fract(x));
    for (let k = 0; k < 30; k++) {
      x += minW + hash2(r, k + 11, seed) * (maxW - minW);
      if (x - start > 1 - minW * 0.6) break;
      list.push(fract(x));
    }
    list.sort((a, b) => a - b);
    breaks.push(list);
  }
  return (u, v) => {
    let row = 0;
    while (row < rows - 1 && v >= rb[row + 1]) row++;
    const y0 = rb[row];
    const y1 = rb[row + 1];
    const list = breaks[row];
    let col = list.length - 1;
    for (let k = 0; k < list.length; k++) if (u >= list[k]) col = k;
    const a = list[col];
    const b = col + 1 < list.length ? list[col + 1] : list[0] + 1;
    const uu = u < a ? u + 1 : u;
    return { row, col, x0: a, x1: b, y0, y1, uu, v };
  };
}

const PALETTES = {
  warm: [[0.56, 0.5, 0.42], [0.52, 0.47, 0.4], [0.58, 0.52, 0.43], [0.5, 0.46, 0.41], [0.54, 0.48, 0.39], [0.6, 0.55, 0.47], [0.47, 0.43, 0.37], [0.57, 0.5, 0.41]],
  cold: [[0.4, 0.39, 0.38], [0.35, 0.35, 0.35], [0.44, 0.42, 0.39], [0.32, 0.32, 0.33], [0.38, 0.38, 0.36], [0.42, 0.39, 0.35], [0.3, 0.3, 0.3]],
  dungeon: [[0.33, 0.31, 0.29], [0.29, 0.28, 0.27], [0.36, 0.33, 0.29], [0.27, 0.27, 0.28], [0.31, 0.3, 0.28], [0.38, 0.35, 0.31], [0.25, 0.25, 0.25]],
  basalt: [[0.22, 0.215, 0.225], [0.19, 0.19, 0.205], [0.24, 0.23, 0.23], [0.17, 0.17, 0.185], [0.21, 0.205, 0.21], [0.26, 0.25, 0.25]],
};

/**
 * Crisp dressed ashlar. Tile ≈ texScale metres (3 m for walls).
 * @param {{seed?:number, rows?:number, minW?:number, maxW?:number, palette?:string, mortarW?:number,
 *   chamfer?:number, chips?:number, erosion?:number, moss?:number, soot?:number, mortar?:number[], sheen?:number}} o
 */
export function ashlar2({ seed = 21, rows = 10, minW = 0.12, maxW = 0.26, palette = 'warm', mortarW = 0.0035, chamfer = 0.004, chips = 1, erosion = 1, moss = 0.3, soot = 0, mortar = null, sheen = 0, joints = true, cracks = 0 } = {}) {
  const lay0 = layout({ rows, seed, minW, maxW });
  // jointless variant (single dressed blocks: jambs, voussoirs, quoins carry their own geometry bevels)
  const lay = joints ? lay0 : (u, v) => ({ row: 0, col: 0, x0: -2, x1: 3, y0: -2, y1: 3, uu: u, v });
  const pal = PALETTES[palette] ?? PALETTES.warm;
  const mortarC = mortar ?? (palette === 'basalt' ? [0.2, 0.17, 0.15] : palette === 'dungeon' ? [0.3, 0.28, 0.25] : [0.52, 0.49, 0.43]);
  // baked fields (cheap to sample)
  const fBig = bake(128, 5, { octaves: 4, seed: seed + 1, warp: 0.3 });
  const fMid = bake(256, 22, { octaves: 3, seed: seed + 2 });
  const fFine = bake(512, 90, { octaves: 2, seed: seed + 3 });
  const fMicro = bake(1024, 340, { octaves: 1, seed: seed + 4 });
  const fChip = bake(512, 60, { octaves: 3, seed: seed + 5 });
  const fChipLo = bake(256, 16, { octaves: 2, seed: seed + 6 });
  const fStreak = bake(256, 30, { octaves: 3, seed: seed + 7, aniso: 0.08 });
  const fLichen = bake(256, 7, { octaves: 4, seed: seed + 8, warp: 0.4 });
  const fCrust = bake(256, 24, { octaves: 3, seed: seed + 9 });
  const fSoot = bake(128, 3, { octaves: 3, seed: seed + 10, aniso: 0.5 });
  return (u, v) => {
    const L = lay(u, v);
    const sid = hash2(L.row * 131 + L.col, L.row, seed + 77);
    const sA = hash2(L.row * 57 + L.col, 3, seed + 41);
    const sB = hash2(L.row * 57 + L.col, 5, seed + 43);
    const sC = hash2(L.row * 57 + L.col, 9, seed + 47);
    const bw = L.x1 - L.x0;
    const bh = L.y1 - L.y0;
    const dxl = L.uu - L.x0;
    const dxr = L.x1 - L.uu;
    const dyt = L.v - L.y0;
    const dyb = L.y1 - L.v;
    const dx = Math.min(dxl, dxr);
    const dy = Math.min(dyt, dyb);
    // joint distance (tile units); the joint wanders very slightly
    const mw = mortarW * (0.8 + hash2(L.row, 19, seed) * 0.4);
    const big = fBig(u, v);
    const mid = fMid(u, v);
    const fine = fFine(u, v);
    const micro = fMicro(u, v);
    let e = Math.min(dx, dy) + (mid - 0.5) * 0.0012;
    // chips: notches bitten out of the arrises, deeper at corners and on worn stones
    const wear = (0.4 + sB * sB * 1.4) * erosion;
    const cornerD = Math.hypot(dx, dy);
    const chipField = fChip(u, v) * 0.65 + fChipLo(u, v) * 0.35;
    const chipDepth = Math.max(0, chipField - 0.5) * 0.05 * wear * chips + (1 - smooth(0, 0.02 + sB * 0.03, cornerD + (chipField - 0.5) * 0.02)) * 0.012 * wear * chips;
    const inChip = e < mw + chamfer + chipDepth ? 1 : 0;
    const chipEdge = smooth(mw + chipDepth + chamfer - 0.0012, mw + chipDepth + chamfer, e);
    // stone mask (crisp: ~1 px transition at 1024)
    const inStone = smooth(mw - 0.0006, mw + 0.0006, e);
    // chamfer: linear ramp from the joint to the face
    const cham = clamp01((e - mw) / Math.max(1e-4, chamfer * (0.6 + sA * 0.8)));
    // face: flat plane with a per-stone tilt, a little broad wind and micro relief
    const tilt = ((dxl / bw - 0.5) * (hash2(L.row, L.col, seed + 61) - 0.5) + (dyt / bh - 0.5) * (hash2(L.row, L.col, seed + 62) - 0.5)) * 0.06;
    const dressing = sA > 0.75 ? (fine - 0.5) * 0.1 + (mid - 0.5) * 0.08 : (fine - 0.5) * 0.04 + (mid - 0.5) * 0.035;
    // tooled striations (diagonal batting) on some stones
    const tool = sA < 0.4 ? (valueNoise((u * Math.cos(sC) + v * Math.sin(sC)) * 900, 0.5, 1000, seed + 31) - 0.5) * 0.012 : 0;
    // spalls: shallow scars in the face with a sharp rim
    // (only weathered stones spall: skip the cellular lookup on the rest — it dominates the cost)
    let spall = 0;
    if (sB > 0.55 - 0.1 * erosion) {
      const sp = worley(u * 18 + (chipField - 0.5) * 1.6, v * 18 + (mid - 0.5) * 1.6, 18, seed + 13);
      spall = sp.id > 0.86 - 0.05 * erosion ? smooth(0.37, 0.28, sp.f1 + (fine - 0.5) * 0.25) : 0;
    }
    // hairline cracks: a few stones are split by a wandering fracture (each its own angle / path)
    let crk = 0;
    if (cracks && sC < cracks * 0.45) {
      const ang = sid * 6.283;
      const lx = dxl / bw - 0.5;
      const ly = dyt / bh - 0.5;
      const along = lx * Math.cos(ang) + ly * Math.sin(ang);
      const across = -lx * Math.sin(ang) + ly * Math.cos(ang) + (hash2(L.row, L.col, seed + 83) - 0.5) * 0.4 + (mid - 0.5) * 0.35 + (fine - 0.5) * 0.08;
      const reach = 1 - smooth(0.25 + sB * 0.3, 0.5 + sB * 0.3, Math.abs(along + (sA - 0.5) * 0.4));
      crk = (1 - smooth(0.0, 0.012 + fine * 0.01, Math.abs(across))) * reach;
    }
    let face = 0.62 + tilt + (big - 0.5) * 0.05 + dressing + tool + (micro - 0.5) * 0.012 - spall * 0.05 - crk * 0.05;
    // chip surface: fractured, lower, rougher
    const chipH = 0.62 - 0.06 - chipDepth * 3 + (fine - 0.5) * 0.08 + (micro - 0.5) * 0.02;
    const top = inChip && chipEdge < 1 ? lerp(chipH, face, chipEdge) : face;
    const stoneH = lerp(0.3, top, Math.min(cham, 1)) ;
    // mortar: recessed soft groove (rounded), slightly sandy
    const groove = 0.12 + 0.12 * smooth(0, mw, e) + (fine - 0.5) * 0.03;
    const h = lerp(groove, stoneH, inStone);

    // ---------------------------------------------------------------- colour
    let c = pal[Math.floor(sid * pal.length)];
    c = mul3(c, 0.88 + hash2(L.row, L.col, seed + 1) * 0.22);
    c = [c[0] * (1 + (sC - 0.5) * 0.08), c[1], c[2] * (1 - (sC - 0.5) * 0.09)];
    c = mul3(c, 0.84 + big * 0.3 + (mid - 0.5) * 0.16 + (fine - 0.5) * 0.1 + (micro - 0.5) * 0.08);
    // mineral speckle
    if (micro > 0.86) c = mul3(c, 1.08);
    else if (micro < 0.1) c = mul3(c, 0.88);
    // fresh stone in chips and spalls; slight lightening on worn arrises
    const fresh = inChip ? 1 - chipEdge : 0;
    // (kept subtle: a strong fresh tint outlines every block like a stencil)
    c = mul3(c, 1 + fresh * 0.05 + spall * 0.04 + (1 - cham) * 0.04 * inStone - crk * 0.45);
    c = [c[0] * (1 + fresh * 0.01), c[1], c[2] * (1 - fresh * 0.015)];
    // weathering: rain streaks running down, lichen, crusts, soot
    const streak = fStreak(u, v);
    c = mul3(c, 1 - smooth(0.58, 0.82, streak) * 0.16 * erosion);
    const lich = fLichen(u, v);
    c = mix3(c, [0.44, 0.45, 0.31], smooth(0.64, 0.74, lich) * 0.5 * moss);
    c = mix3(c, [0.66, 0.64, 0.56], smooth(0.74, 0.8, fCrust(u, v)) * 0.25 * moss);
    if (soot) c = mul3(c, 1 - smooth(0.45, 0.8, fSoot(u, v)) * soot);
    // mortar colour: lime, partly lost (darker voids), greener in the damp
    let mc = mul3(mortarC, 0.78 + mid * 0.3 + (micro - 0.5) * 0.1);
    mc = mix3(mc, mul3(mortarC, 0.6), smooth(0.55, 0.72, big) * 0.6);
    mc = mix3(mc, [0.22, 0.27, 0.15], smooth(0.62, 0.8, lich) * moss * 0.8);
    const col = mix3(mc, c, inStone);
    // roughness: honed faces a touch smoother, chips and mortar matte
    let r = 0.78 + sB * 0.12 + (fine - 0.5) * 0.08 - sheen * (1 - sA) * 0.35;
    r = lerp(r, 0.93, fresh);
    r = lerp(0.97, clamp01(r), inStone);
    return { c: col, h, r };
  };
}

/**
 * Rough-hewn rock (kobold warrens): pick-scarred tunnel walls with bedding
 * strata, fractures, wet seeps and pale mineral veins. No joints. Tile ≈ 3 m.
 */
export function hewnRock({ seed = 241, base = [0.33, 0.29, 0.24], floor = false, ceiling = false } = {}) {
  const fBig = bake(128, 4, { octaves: 5, seed: seed + 1, warp: 0.5 });
  const fMid = bake(256, 14, { octaves: 4, seed: seed + 2, warp: 0.3 });
  const fFine = bake(512, 60, { octaves: 3, seed: seed + 3 });
  const fMicro = bake(1024, 300, { octaves: 1, seed: seed + 4 });
  const fSeep = bake(256, 10, { octaves: 4, seed: seed + 5, aniso: 0.12 });
  const fVein = bake(256, 6, { octaves: 3, seed: seed + 6, warp: 0.6 });
  return (u, v) => {
    const big = fBig(u, v);
    const mid = fMid(u, v);
    const fine = fFine(u, v);
    const micro = fMicro(u, v);
    // strata: tilted bedding planes with steps
    const sv = floor ? big * 9 : v * 7 + big * 2.2 + u * 0.6;
    const layer = Math.floor(sv);
    const lf = sv - layer;
    const strataStep = ceiling ? 0 : smooth(0.0, 0.08, lf) * 0.06;
    const layerTone = ceiling ? 0.96 + hash2(layer, 1, seed) * 0.08 : 0.85 + hash2(layer, 1, seed) * 0.3;
    // pick scars: short diagonal gouges
    const pk = worley(u * 34, v * 22, 34, seed + 7);
    const gouge = floor ? 0 : (1 - smooth(0.0, 0.18, Math.abs(pk.f2 - pk.f1))) * 0.5 * (pk.id > 0.4 ? 1 : 0);
    // fractures
    const fr = worley(u * 9, v * 9, 9, seed + 8);
    const crack = (1 - smooth(0.0, 0.018, fr.f2 - fr.f1 + (fine - 0.5) * 0.04)) * (hash2(Math.floor(fr.id * 97), 3, seed) > 0.55 ? 1 : 0.15);
    const h = 0.5 + (big - 0.5) * 0.5 + (mid - 0.5) * 0.28 + (fine - 0.5) * 0.08 + (micro - 0.5) * 0.02 + strataStep - gouge * 0.05 - crack * 0.12;
    let c = mul3(base, layerTone * (0.78 + (big - 0.5) * 0.4 + (mid - 0.5) * 0.25 + (fine - 0.5) * 0.12 + (micro - 0.5) * 0.08));
    c = mul3(c, 1 - crack * 0.55 + gouge * 0.08);
    const vein = (1 - smooth(0.0, 0.012, Math.abs(fVein(u, v) - 0.5))) * smooth(0.45, 0.65, big);
    c = mix3(c, [0.5, 0.48, 0.43], vein * 0.08);
    // seeps darken; only the wettest cores of a seep lose roughness (and never on the roof: no glints)
    const seep = ceiling ? smooth(0.6, 0.85, fSeep(u, v)) * 0.5 : smooth(0.55, 0.8, fSeep(u, v));
    c = mix3(c, mul3(c, 0.55), seep * 0.6);
    c = mix3(c, [0.2, 0.26, 0.14], smooth(0.68, 0.8, mid) * seep * 0.6);
    const r = ceiling ? clamp01(0.96 + (fine - 0.5) * 0.04) : clamp01(0.9 + (fine - 0.5) * 0.08 - smooth(0.75, 0.95, seep) * 0.3);
    return { c, h, r };
  };
}

/**
 * Carved relief panel for the Temple of Bane (basalt): a border frame with a
 * raised clenched black hand inside a ring of spikes. Tile = one panel.
 */
export function baneRelief({ seed = 251 } = {}) {
  const fFine = bake(256, 40, { octaves: 3, seed: seed + 1 });
  const fMicro = bake(512, 200, { octaves: 1, seed: seed + 2 });
  const handSDF = (x, y) => {
    // palm (rounded box) + four fingers + thumb, in [-1,1]² (y up)
    const box = (px, py, cx, cy, hx, hy, r) => {
      const qx = Math.abs(px - cx) - hx + r;
      const qy = Math.abs(py - cy) - hy + r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };
    let d = box(x, y, 0, -0.18, 0.3, 0.28, 0.1);
    for (let k = 0; k < 4; k++) d = Math.min(d, box(x, y, -0.24 + k * 0.16, 0.22 + (k === 1 || k === 2 ? 0.06 : 0), 0.065, 0.2 + (k === 1 || k === 2 ? 0.05 : 0), 0.06));
    {
      const a = 0.55;
      const tx = x - 0.33;
      const ty = y + 0.12;
      d = Math.min(d, box(tx * Math.cos(a) + ty * Math.sin(a), -tx * Math.sin(a) + ty * Math.cos(a), 0, 0, 0.07, 0.17, 0.06));
    }
    d = Math.min(d, box(x, y, 0, -0.56, 0.18, 0.12, 0.04)); // wrist
    return d;
  };
  return (u, v) => {
    const x = u * 2 - 1;
    const y = 1 - v * 2;
    const fine = fFine(u, v);
    const micro = fMicro(u, v);
    const border = Math.max(Math.abs(x), Math.abs(y));
    const frame = smooth(0.8, 0.82, border) * (1 - smooth(0.93, 0.95, border));
    const r0 = Math.hypot(x, y);
    const ring = smooth(0.66, 0.68, r0) * (1 - smooth(0.72, 0.74, r0));
    const ang = Math.atan2(y, x);
    const spikes = (1 - smooth(0.0, 0.02, r0 - 0.74 - 0.08 * Math.max(0, Math.cos(ang * 12)) ** 6)) * smooth(0.72, 0.74, r0);
    const hand = 1 - smooth(-0.01, 0.01, handSDF(x * 1.15, y * 1.15 + 0.02));
    const relief = Math.max(frame, ring, spikes * 0.9, hand);
    const h = 0.35 + relief * 0.35 + (fine - 0.5) * 0.04 + (micro - 0.5) * 0.015 - (border > 0.97 ? 0.15 : 0);
    let c = mul3([0.11, 0.105, 0.11], 0.85 + (fine - 0.5) * 0.3 + (micro - 0.5) * 0.1);
    // raised parts are polished (worn by hands) and slightly lighter; recesses keep a dull red pigment
    c = mix3(c, [0.32, 0.05, 0.04], (1 - relief) * smooth(0.0, 0.66, 0.66 - Math.abs(r0 - 0.33)) * 0.0);
    c = mix3(c, mul3(c, 1.35), relief * 0.5);
    const pigment = (1 - relief) * (r0 < 0.66 ? 1 : 0);
    c = mix3(c, [0.24, 0.035, 0.03], pigment * 0.55);
    const r = lerp(0.82, 0.38, relief) + (fine - 0.5) * 0.08;
    return { c, h, r };
  };
}

/**
 * Blackened forged iron: hammer facets, dark oxide scale with a faint blue
 * temper, worn bright on the high spots, rust only as small blooms in pits.
 * Tile ≈ 0.5 m.
 */
export function forgedIron({ seed = 157 } = {}) {
  const fBig = bake(64, 4, { octaves: 4, seed: seed + 1, warp: 0.4 });
  const fMid = bake(256, 24, { octaves: 3, seed: seed + 2 });
  const fMicro = bake(256, 120, { octaves: 1, seed: seed + 3 });
  return (u, v) => {
    const big = fBig(u, v);
    const mid = fMid(u, v);
    const micro = fMicro(u, v);
    const ham = worley(u * 16, v * 16, 16, seed + 4);
    const facet = smooth(0.0, 0.5, ham.f1) * 0.06;
    const rust = smooth(0.66, 0.8, big + (micro - 0.5) * 0.3) * 0.85;
    let c = mul3([0.13, 0.13, 0.14], 0.8 + mid * 0.45 + (micro - 0.5) * 0.15 + ham.id * 0.1);
    c = mix3(c, [0.12, 0.13, 0.17], smooth(0.4, 0.7, mid) * 0.3);
    c = mix3(c, mul3([0.3, 0.17, 0.09], 0.7 + micro * 0.5), rust);
    const h = 0.5 + facet + (mid - 0.5) * 0.08 + (micro - 0.5) * 0.02 + rust * 0.05;
    const r = lerp(0.48 - mid * 0.12, 0.92, rust);
    return { c, h, r };
  };
}
