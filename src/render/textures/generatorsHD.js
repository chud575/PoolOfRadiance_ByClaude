import { fbm, worley, hash2, clamp01, lerp, smooth, valueNoise } from './noise.js';

/**
 * High-detail procedural PBR generators (explore-renderer workstream).
 * Each factory returns (u, v) → {c:[r,g,b] linear-ish 0..1, h:0..1, r:roughness, a?:alpha}.
 * All are tileable on [0,1)². World scale is set by the material (texScale metres
 * per tile), so generators describe one tile of that many metres.
 * Pure JS, no DOM: safe to run inside the texture Web Workers.
 */

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const fract = (x) => x - Math.floor(x);
const wrapD = (d) => Math.min(d, 1 - d); // wrapped distance on unit interval

/** Domain-warped fbm (tileable). */
function wfbm(u, v, period, seed, octaves = 5, warp = 0.35) {
  const qx = fbm(u * period, v * period, { octaves: 3, period, seed: seed + 101 });
  const qy = fbm(u * period + 5.2, v * period + 1.3, { octaves: 3, period, seed: seed + 202 });
  return fbm(u * period + warp * period * (qx - 0.5), v * period + warp * period * (qy - 0.5), { octaves, period, seed });
}

/**
 * Row/column masonry layout helper: returns per-pixel block info for a running
 * bond with irregular row heights and block widths (tileable).
 */
function masonryLayout({ rows, seed, minW, maxW }) {
  // row boundaries in [0,1)
  const rb = [0];
  let acc = 0;
  const weights = [];
  for (let r = 0; r < rows; r++) weights.push(0.75 + hash2(r, 7, seed) * 0.5);
  const tot = weights.reduce((a, b) => a + b, 0);
  for (let r = 0; r < rows; r++) {
    acc += weights[r] / tot;
    rb.push(acc);
  }
  rb[rows] = 1;
  // per-row block breakpoints (sorted, in [0,1))
  const breaks = [];
  for (let r = 0; r < rows; r++) {
    const list = [];
    let x = hash2(r, 3, seed);
    const start = x;
    list.push(fract(x));
    for (let k = 0; k < 20; k++) {
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
    return {
      row,
      col,
      id: hash2(row * 31 + col, row, seed + 77),
      dx: Math.min(uu - a, b - uu), // distance to vertical joint (u units)
      dy: Math.min(v - y0, y1 - v), // distance to bed joint (v units)
      fx: (uu - a) / (b - a),
      fy: (v - y0) / (y1 - y0),
      bw: b - a,
      bh: y1 - y0,
    };
  };
}

/**
 * Weathered ashlar (dressed stone) — irregular courses, per-stone colour,
 * roughness, face dressing (smooth / pillowed / rock-faced) and arris wear,
 * chipped corners and spalls, recessed lime mortar with losses, pitting,
 * lichen and rain streaks. Tile ≈ 3 m.
 */
export function ashlar({ seed = 21, rows = 8, minW = 0.18, maxW = 0.34, palette = 'warm', mortarW = 0.0055, erosion = 1, moss = 0.35 } = {}) {
  const lay = masonryLayout({ rows, seed, minW, maxW });
  const pals = {
    warm: [[0.52, 0.48, 0.42], [0.47, 0.44, 0.4], [0.56, 0.5, 0.41], [0.45, 0.44, 0.42], [0.5, 0.45, 0.37], [0.58, 0.54, 0.47], [0.42, 0.39, 0.35]],
    cold: [[0.39, 0.38, 0.37], [0.34, 0.34, 0.34], [0.43, 0.41, 0.38], [0.31, 0.31, 0.32], [0.37, 0.37, 0.35], [0.41, 0.38, 0.34], [0.29, 0.29, 0.29]],
    dark: [[0.28, 0.27, 0.26], [0.24, 0.24, 0.24], [0.31, 0.29, 0.26], [0.22, 0.22, 0.23], [0.27, 0.26, 0.25], [0.33, 0.31, 0.28], [0.2, 0.2, 0.2]],
  };
  const pal = pals[palette] ?? pals.warm;
  const palMean = mul3(pal.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]), 1 / pal.length);
  const mortar = palette === 'dark' ? [0.27, 0.26, 0.23] : [0.5, 0.47, 0.41];
  return (u, v) => {
    const L = lay(u, v);
    const sid = L.id;
    const sA = hash2(L.row * 57 + L.col, 3, seed + 41); // dressing
    const sB = hash2(L.row * 57 + L.col, 5, seed + 43); // wear
    const sC = hash2(L.row * 57 + L.col, 9, seed + 47); // tone shift
    const chip = wfbm(u, v, 14, seed + 5, 4, 0.4);
    const chipF = fbm(u * 60, v * 60, { octaves: 3, period: 60, seed: seed + 6 });
    // worn arrises: per-stone erosion amount, much stronger on some stones
    const wear = (0.35 + sB * sB * 1.3) * erosion;
    // chips only bite into the stone (never shrink the joint below the mortar line)
    const edgeNoise = -Math.max(0, (chip - 0.45) * 0.006 * wear + (chipF - 0.5) * 0.0025 * wear);
    // distances in tile units; corners chip more
    const cornerD = Math.hypot(Math.min(L.fx, 1 - L.fx) * L.bw, Math.min(L.fy, 1 - L.fy) * L.bh);
    const cornerChip = (1 - smooth(0.0, 0.012 + sB * 0.02, cornerD)) * 0.006 * (0.5 + chipF);
    const e = Math.min(L.dx, L.dy) + edgeNoise - cornerChip;
    const mw = mortarW * (0.7 + hash2(L.row, 19, seed) * 0.35);
    const inStone = smooth(mw, mw + 0.005, e);
    const bevelW = 0.008 + sA * 0.03;
    const bevel = smooth(mw, mw + bevelW, e);
    const big = fbm(u * 6, v * 6, { octaves: 4, period: 6, seed });
    const fine = fbm(u * 48, v * 48, { octaves: 3, period: 48, seed: seed + 3 });
    const micro = valueNoise(u * 300, v * 300, 300, seed + 8);
    const pits = worley(u * 70, v * 70, 70, seed + 9);
    const pit = (1 - smooth(0.0, 0.08 + pits.id * 0.1, pits.f1)) * (pits.id > 0.78 ? 0.7 : 0) * (0.3 + sB);
    // stone base colour per block (+ per-stone hue drift)
    let c = mix3(palMean, pal[Math.floor(sid * pal.length)], 0.55);
    c = mul3(c, 0.9 + hash2(L.row, L.col, seed + 1) * 0.16);
    c = [c[0] * (1 + (sC - 0.5) * 0.08), c[1], c[2] * (1 - (sC - 0.5) * 0.08)];
    c = mul3(c, 0.8 + big * 0.35 + (fine - 0.5) * 0.24 + (micro - 0.5) * 0.03);
    // dressing: tooled (fine chisel striations), pillowed, or rock-faced (coarse hammer dressing)
    const rockFaced = sA > 0.78;
    const pillowAmt = sA < 0.35 ? 0.0 : sA < 0.78 ? (sA - 0.35) * 0.18 : 0.04;
    const tool = valueNoise((u + v * (sC > 0.5 ? 1 : -1)) * 260, (u - v) * 18, 1000, seed + 31);
    c = mul3(c, 1 + (tool - 0.5) * (sA < 0.35 ? 0.045 : 0.02));
    const rockN = rockFaced ? fbm(u * 26, v * 26, { octaves: 4, period: 26, seed: seed + 51 }) : 0.5;
    // worn arrises are lighter (exposed fresh stone) and smoother
    c = mul3(c, 1 + (1 - bevel) * 0.1 * inStone);
    // rain streaks
    const streak = fbm(u * 36, v * 2.2, { octaves: 3, period: 36, seed: seed + 13 });
    c = mul3(c, 1 - smooth(0.6, 0.85, streak) * 0.14);
    // lichen (yellow-green / grey patches) + white crustose dots
    const lich = wfbm(u, v, 5, seed + 17, 5);
    c = mix3(c, [0.42, 0.44, 0.3], smooth(0.62, 0.72, lich) * 0.55 * moss);
    c = mix3(c, [0.64, 0.62, 0.54], smooth(0.72, 0.8, fbm(u * 18, v * 18, { octaves: 3, period: 18, seed: seed + 19 })) * 0.32);
    c = mul3(c, 1 - pit * 0.45);
    // mortar: recessed, partly lost (dark voids), mossy in places
    const mn = fbm(u * 60, v * 60, { octaves: 2, period: 60, seed: seed + 23 });
    const loss = smooth(0.55, 0.7, fbm(u * 9, v * 9, { octaves: 3, period: 9, seed: seed + 29 }));
    let mc = mul3(mortar, 0.7 + mn * 0.4);
    mc = mix3(mc, mul3(mortar, 0.55), loss * 0.6);
    mc = mix3(mc, [0.2, 0.26, 0.14], smooth(0.55, 0.75, big) * moss);
    const col = mix3(mc, c, inStone);
    const pillow = Math.sin(Math.PI * clamp01(L.fx)) * Math.sin(Math.PI * clamp01(L.fy));
    const tilt = ((L.fx - 0.5) * (hash2(L.row, L.col, seed + 61) - 0.5) + (L.fy - 0.5) * (hash2(L.row, L.col, seed + 62) - 0.5)) * 0.05;
    const stoneH = 0.6 + bevel * 0.14 + pillow * pillowAmt + tilt + big * 0.08 + fine * 0.05 + micro * 0.006 + (rockN - 0.5) * 0.12 - pit * 0.1;
    const h = inStone * stoneH + (1 - inStone) * (0.3 + mn * 0.08 - loss * 0.08);
    const sr = 0.74 + sB * 0.16 + (rockFaced ? 0.06 : 0);
    const r = lerp(0.97, clamp01(sr + fine * 0.1 - pit * 0.1 - (1 - bevel) * 0.08), inStone);
    return { c: col, h, r };
  };
}

/**
 * Lime plaster / daub between timber framing: trowel texture, water stains,
 * fine hairline craquelure (≈ 5–30 cm cells, only in patches) and small
 * spalls where the render has fallen away exposing riven oak lath.
 * Tile ≈ 3 m.
 */
export function plaster({ seed = 31, base = [0.78, 0.72, 0.6], decay = 1, interior = false } = {}) {
  return (u, v) => {
    const big = wfbm(u, v, 3, seed, 5, 0.5);
    const mid = fbm(u * 12, v * 12, { octaves: 4, period: 12, seed: seed + 1 });
    const trowel = fbm(u * 30, v * 10, { octaves: 3, period: 30, seed: seed + 2 });
    const fine = valueNoise(u * 200, v * 200, 200, seed + 3);
    const sweep = fbm(u * 22 + v * 9, v * 22 - u * 6, { octaves: 2, period: 22, seed: seed + 12 });
    let c = mul3(base, 0.88 + (big - 0.5) * 0.22 + (mid - 0.5) * 0.1 + (fine - 0.5) * 0.05 + (sweep - 0.5) * 0.05);
    // limewash build-up: subtle lighter/darker brush patches
    c = mix3(c, mul3(base, 1.08), smooth(0.55, 0.75, fbm(u * 6, v * 6, { octaves: 3, period: 6, seed: seed + 13 })) * 0.35);
    // yellowed water stains + drips
    const stain = smooth(0.52, 0.78, fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: seed + 4 }));
    c = mix3(c, mul3([0.62, 0.53, 0.38], 0.92), stain * 0.26 * decay);
    const drip = fbm(u * 40, v * 1.4, { octaves: 3, period: 40, seed: seed + 5 });
    c = mul3(c, 1 - smooth(0.62, 0.86, drip) * 0.1 * decay);
    let h = 0.6 + trowel * 0.05 + mid * 0.04 + fine * 0.012 + sweep * 0.02;
    let r = 0.9 - fine * 0.05;
    // fine hairline craquelure: warped small cells, thin lines, only in patches
    const wu = u + (fbm(u * 18, v * 18, { octaves: 2, period: 18, seed: seed + 14 }) - 0.5) * 0.02;
    const wv = v + (fbm(u * 18 + 3.1, v * 18, { octaves: 2, period: 18, seed: seed + 15 }) - 0.5) * 0.02;
    const w = worley(wu * 22, wv * 22, 22, seed + 6);
    const crackMask = smooth(0.6, 0.72, fbm(u * 5, v * 5, { octaves: 3, period: 5, seed: seed + 7 })) * smooth(0.25, 0.6, w.id + 0.2);
    const crack = (1 - smooth(0.0, 0.012, w.f2 - w.f1)) * crackMask * decay;
    // a few longer settlement cracks (wandering lines, very thin)
    // two sparse settlement cracks per tile: thin, jagged at the cm scale, slowly drifting
    let settle = 0;
    for (let k = 0; k < 2; k++) {
      const x0 = hash2(k, 1, seed + 16);
      const sv = v * 48;
      const seg = Math.floor(sv);
      const t = sv - seg;
      const jag = (hash2(seg % 48, k, seed + 18) * (1 - t) + hash2((seg + 1) % 48, k, seed + 18) * t - 0.5) * 0.009;
      const drift = (fbm(v * 3 + k * 3.7, 0.5, { octaves: 2, period: 3, seed: seed + 17 + k }) - 0.5) * 0.05;
      const du = Math.abs(((u - x0 - drift - jag + 1.5) % 1) - 0.5);
      const span = smooth(0.0, 0.06, Math.abs(((v - hash2(k, 2, seed + 16) + 1.5) % 1) - 0.5) - 0.2);
      settle = Math.max(settle, (1 - smooth(0.0, 0.0018, du - 0.0004)) * (1 - span));
    }
    settle *= decay * 0.8;
    const ck = Math.max(crack * 0.7, settle);
    c = mul3(c, 1 - ck * 0.4);
    h -= ck * 0.06;
    // small spalls exposing riven oak lath (with dark gaps) behind the render
    if (!interior) {
      const sp = wfbm(u, v, 9, seed + 8, 4, 0.5);
      const spMask = smooth(0.7, 0.76, fbm(u * 2, v * 2, { octaves: 2, period: 2, seed: seed + 18 }));
      const spall = smooth(0.745, 0.755, sp) * decay * spMask;
      if (spall > 0) {
        const lv = v * 70 + (fbm(u * 8, v * 8, { octaves: 2, period: 8, seed: seed + 9 }) - 0.5) * 2;
        const lf = lv - Math.floor(lv);
        const lath = smooth(0.08, 0.2, lf) * (1 - smooth(0.72, 0.85, lf));
        const grain = valueNoise(u * 300, lv * 2, 1000, seed + 10);
        const wood = mul3([0.3, 0.22, 0.15], 0.7 + grain * 0.5);
        const under = mix3([0.16, 0.13, 0.1], wood, lath);
        c = mix3(c, under, spall);
        h = lerp(h, 0.3 + lath * 0.18, spall);
        r = lerp(r, 0.95, spall);
      }
      // raised rim of render around each spall (broken edge)
      const rim = smooth(0.72, 0.735, sp) * (1 - smooth(0.735, 0.745, sp)) * spMask * decay;
      c = mul3(c, 1 + rim * 0.08);
      h += rim * 0.05;
    }
    return { c, h, r };
  };
}

/**
 * Weathered oak beam — grain runs along V. Checks (drying cracks), nail heads.
 * Tile ≈ 1 m (beam width maps to part of U).
 */
export function oakBeam({ seed = 41, base = [0.26, 0.18, 0.12], grey = 0.35 } = {}) {
  return (u, v) => {
    const g1 = valueNoise(u * 40, v * 3, 40, seed);
    const g2 = valueNoise(u * 120, v * 6, 120, seed + 1);
    const g3 = fbm(u * 8, v * 1, { octaves: 3, period: 8, seed: seed + 2 });
    const ring = Math.sin((u * 26 + g3 * 5) * Math.PI * 2) * 0.5 + 0.5;
    let c = mul3(base, 0.72 + g1 * 0.3 + g2 * 0.15 + ring * 0.12);
    c = mix3(c, [0.36, 0.34, 0.31], grey * smooth(0.3, 0.8, fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: seed + 3 })));
    // checks along grain
    const chk = valueNoise(u * 18, v * 1.5, 18, seed + 4);
    const check = 1 - smooth(0.0, 0.03, Math.abs(chk - 0.5));
    const checkMask = smooth(0.4, 0.7, valueNoise(u * 5, v * 3, 5, seed + 5));
    c = mul3(c, 1 - check * checkMask * 0.7);
    let h = 0.6 + g1 * 0.12 + g2 * 0.08 + ring * 0.05 - check * checkMask * 0.4;
    // iron nail heads
    const nw = worley(u * 5, v * 5, 5, seed + 6);
    if (nw.id > 0.8 && nw.f1 < 0.06) {
      const k = 1 - nw.f1 / 0.06;
      c = mix3(c, [0.12, 0.1, 0.09], smooth(0, 0.3, k));
      h += k * 0.3;
    }
    return { c, h, r: 0.78 + g2 * 0.12 };
  };
}

/**
 * Roof: overlapping shingles/tiles in staggered courses; moss and lichen.
 * `kind`: 'slate' | 'clay' | 'shake' (wood). Courses run along U, slope along V
 * (v=0 top/ridge side). Tile ≈ 2 m.
 */
export function roofTiles({ seed = 51, kind = 'slate', courses = 11, perCourse = 9, moss = 0.5 } = {}) {
  const pals = {
    slate: [[0.2, 0.22, 0.25], [0.24, 0.25, 0.28], [0.17, 0.18, 0.21], [0.27, 0.27, 0.28]],
    clay: [[0.45, 0.22, 0.14], [0.52, 0.27, 0.16], [0.38, 0.19, 0.13], [0.48, 0.3, 0.2]],
    shake: [[0.3, 0.24, 0.18], [0.26, 0.2, 0.15], [0.35, 0.29, 0.22], [0.22, 0.18, 0.14]],
  };
  const pal = pals[kind] ?? pals.slate;
  return (u, v) => {
    const cy = v * courses;
    const course = Math.floor(cy);
    const fy = cy - course; // 0 at top of course (hidden under the course above), 1 at exposed lower edge
    const off = (course % 2) * 0.5 + hash2(course, 1, seed) * 0.15;
    const cx = u * perCourse + off;
    const idx = Math.floor(cx);
    const fx = cx - idx;
    const id = hash2(((idx % perCourse) + perCourse) % perCourse, course, seed);
    // irregular lower edge per tile
    const edgeJitter = (hash2(idx, course, seed + 3) - 0.5) * 0.12 + (kind === 'clay' ? Math.sin(fx * Math.PI) * 0.08 : 0);
    const lower = 0.96 + edgeJitter;
    const gap = smooth(0, 0.04, Math.min(fx, 1 - fx));
    const grain = kind === 'shake' ? valueNoise(fx * 8 + id * 20, fy * 1.2, 1000, seed + 4) : fbm(u * 30, v * 30, { octaves: 3, period: 30, seed: seed + 4 });
    let c = pal[Math.floor(id * pal.length)];
    c = mul3(c, 0.8 + id * 0.3 + (grain - 0.5) * 0.25);
    // thickness ramp → exposed lower edge casts a shadow line onto the course below
    let h = 0.25 + fy * 0.55;
    const below = fy > lower;
    if (below) {
      h = 0.2;
      c = mul3(c, 0.35);
    }
    h *= lerp(0.6, 1, gap);
    c = mul3(c, lerp(0.45, 1, gap));
    // moss & lichen thickening in the lower overlap region and on older tiles
    const mn = wfbm(u, v, 4, seed + 5, 5);
    const m = smooth(0.58, 0.72, mn + (1 - fy) * 0.1) * moss;
    c = mix3(c, mul3([0.26, 0.3, 0.14], 0.8 + grain * 0.4), m * 0.8);
    c = mix3(c, [0.58, 0.57, 0.48], smooth(0.78, 0.85, fbm(u * 22, v * 22, { octaves: 2, period: 22, seed: seed + 6 })) * 0.45);
    h += m * 0.08;
    const r = kind === 'slate' ? lerp(0.62, 0.9, m) : 0.88;
    return { c, h, r };
  };
}

/**
 * Street cobbles (setts): rounded, polished tops, dark sandy joints with
 * pebbles and occasional weeds. Tile ≈ 2 m at scale 11.
 */
export function cobbleSetts({ seed = 61, scale = 11, moss = 0.4, wet = 0.2 } = {}) {
  return (u, v) => {
    const wu = u + (fbm(u * 4, v * 4, { octaves: 2, period: 4, seed: seed + 1 }) - 0.5) * 0.02;
    const w = worley(wu * scale, v * scale * 1.3, scale, seed);
    const gap = w.f2 - w.f1;
    const stone = smooth(0.06, 0.2, gap);
    const dome = Math.sqrt(clamp01(gap / 0.55));
    const n = fbm(u * 40, v * 40, { octaves: 3, period: 40, seed: seed + 2 });
    const big = fbm(u * 3, v * 3, { octaves: 4, period: 3, seed: seed + 3 });
    const tones = [[0.4, 0.39, 0.37], [0.34, 0.34, 0.36], [0.45, 0.41, 0.35], [0.3, 0.29, 0.28], [0.42, 0.42, 0.43]];
    let c = tones[Math.floor(w.id * tones.length)];
    c = mul3(c, 0.78 + n * 0.3 + dome * 0.12);
    c = mul3(c, 0.85 + big * 0.3);
    const joint = worley(u * 90, v * 90, 90, seed + 4);
    let jc = mul3([0.17, 0.14, 0.11], 0.8 + joint.id * 0.5);
    jc = mix3(jc, [0.16, 0.22, 0.09], smooth(0.5, 0.7, big) * moss);
    const col = mix3(jc, c, stone);
    const puddle = smooth(0.62, 0.7, fbm(u * 2, v * 2, { octaves: 3, period: 2, seed: seed + 5 })) * wet;
    const h = stone * (0.4 + dome * 0.5 + n * 0.06) + (1 - stone) * (0.08 + joint.id * 0.08);
    let r = lerp(0.95, 0.62 + n * 0.2 - dome * 0.12, stone);
    r = lerp(r, 0.15, puddle * (1 - stone * 0.6));
    return { c: mul3(col, 1 - puddle * 0.25), h, r };
  };
}

/** Irregular (crazy-paving) flagstones with cracks and weeds. Tile ≈ 3 m. */
export function crazyFlags({ seed = 71, scale = 5, base = [0.5, 0.47, 0.42], weeds = 0.5 } = {}) {
  return (u, v) => {
    const w = worley(u * scale, v * scale, scale, seed);
    const gap = w.f2 - w.f1;
    const stone = smooth(0.025, 0.055, gap);
    const bevel = smooth(0.025, 0.14, gap);
    const n = fbm(u * 30, v * 30, { octaves: 4, period: 30, seed: seed + 1 });
    const big = wfbm(u, v, 3, seed + 2);
    let c = mul3(base, 0.75 + w.id * 0.35);
    c = mix3(c, [0.44, 0.4, 0.33], hash2(Math.floor(w.id * 100), 3, seed) > 0.6 ? 0.5 : 0);
    c = mul3(c, 0.8 + n * 0.3 + (big - 0.5) * 0.2);
    // hairline cracks inside slabs
    const cw = worley(u * 16, v * 16, 16, seed + 3);
    const crack = (1 - smooth(0, 0.02, cw.f2 - cw.f1)) * smooth(0.6, 0.75, fbm(u * 5, v * 5, { period: 5, seed: seed + 4 }));
    c = mul3(c, 1 - crack * 0.5);
    const gc = mix3([0.24, 0.21, 0.17], [0.22, 0.28, 0.12], smooth(0.45, 0.7, big) * weeds);
    const col = mix3(gc, c, stone);
    const h = stone * (0.55 + bevel * 0.25 + n * 0.08 - crack * 0.2) + (1 - stone) * 0.12;
    return { c: col, h, r: lerp(0.95, 0.72 + n * 0.2, stone) };
  };
}

/**
 * Rough-hewn dungeon masonry: big chunky blocks, deep joints, damp
 * streaks and white efflorescence. Tile ≈ 3 m.
 */
export function dungeonStone({ seed = 81 } = {}) {
  const base = ashlar({ seed, rows: 6, minW: 0.2, maxW: 0.38, palette: 'dark', mortarW: 0.006, erosion: 1.6, moss: 0.25 });
  return (u, v, x, y) => {
    const s = base(u, v, x, y);
    const rough = fbm(u * 14, v * 14, { octaves: 4, period: 14, seed: seed + 1 });
    const grit = valueNoise(u * 420, v * 420, 420, seed + 4);
    const hew = fbm(u * 30, v * 30, { octaves: 3, period: 30, seed: seed + 5 });
    s.h += (rough - 0.5) * 0.1 + (hew - 0.5) * 0.05 + (grit - 0.5) * 0.02;
    s.c = mul3(s.c, 0.82 + rough * 0.3 + (hew - 0.5) * 0.12 + (grit - 0.5) * 0.08);
    const damp = smooth(0.5, 0.78, fbm(u * 10, v * 1.5, { octaves: 4, period: 10, seed: seed + 2 }));
    s.c = mix3(s.c, mul3(s.c, 0.62), damp * 0.55);
    // matte, porous stone: only the dampest seams get a faint sheen
    s.r = clamp01(Math.max(s.r, 0.82) - damp * 0.18 + (grit - 0.5) * 0.06);
    const eff = smooth(0.7, 0.85, fbm(u * 20, v * 6, { octaves: 3, period: 20, seed: seed + 3 }));
    s.c = mix3(s.c, [0.62, 0.62, 0.58], eff * 0.35);
    s.c = mix3(s.c, [0.26, 0.27, 0.24], 0.2);
    return s;
  };
}

/** Rectangular courtyard pavers (random-length courses), weeds in the joints. Tile ≈ 3 m. */
export function pavers({ seed = 75, rows = 7, base = [0.52, 0.49, 0.44], weeds = 0.6 } = {}) {
  const lay = masonryLayout({ rows, seed, minW: 0.12, maxW: 0.3 });
  return (u, v) => {
    const L = lay(u, v);
    const n = fbm(u * 30, v * 30, { octaves: 4, period: 30, seed: seed + 1 });
    const e = Math.min(L.dx, L.dy) + (n - 0.5) * 0.006;
    const stone = smooth(0.004, 0.009, e);
    const bevel = smooth(0.004, 0.03, e);
    const big = wfbm(u, v, 3, seed + 2);
    const tones = [[1, 1, 1], [1.05, 0.98, 0.9], [0.92, 0.94, 0.97], [1.02, 0.96, 0.86], [0.88, 0.87, 0.85]];
    const tn = tones[Math.floor(L.id * tones.length)];
    let c = [base[0] * tn[0], base[1] * tn[1], base[2] * tn[2]];
    c = mul3(c, 0.78 + hash2(L.row, L.col, seed) * 0.3 + (n - 0.5) * 0.22 + (big - 0.5) * 0.18);
    const cw = worley(u * 14, v * 14, 14, seed + 3);
    const crack = (1 - smooth(0, 0.02, cw.f2 - cw.f1)) * (L.id > 0.75 ? 1 : 0);
    c = mul3(c, 1 - crack * 0.4);
    const jc = mix3([0.2, 0.18, 0.15], [0.2, 0.27, 0.11], smooth(0.4, 0.65, big) * weeds);
    const col = mix3(jc, c, stone);
    const h = stone * (0.6 + bevel * 0.2 + n * 0.08 - crack * 0.15) + (1 - stone) * 0.15;
    return { c: col, h, r: lerp(0.95, 0.74 + n * 0.18, stone) };
  };
}

/** Worn dungeon floor slabs, large rectangular, with dirt & wet patches. Tile ≈ 3 m. */
export function dungeonFloor({ seed = 91 } = {}) {
  const lay = masonryLayout({ rows: 4, seed, minW: 0.22, maxW: 0.4 });
  return (u, v) => {
    const L = lay(u, v);
    const e = Math.min(L.dx, L.dy) + (fbm(u * 30, v * 30, { octaves: 3, period: 30, seed }) - 0.5) * 0.01;
    const stone = smooth(0.008, 0.013, e);
    const bevel = smooth(0.008, 0.04, e);
    const n = fbm(u * 24, v * 24, { octaves: 4, period: 24, seed: seed + 1 });
    const big = wfbm(u, v, 3, seed + 2);
    let c = mul3([0.3, 0.29, 0.27], 0.7 + L.id * 0.4 + (n - 0.5) * 0.3);
    c = mul3(c, 0.85 + (big - 0.5) * 0.3);
    const wet = smooth(0.58, 0.68, big);
    const dirt = mul3([0.13, 0.11, 0.09], 0.8 + n * 0.3);
    let col = mix3(dirt, c, stone);
    col = mul3(col, 1 - wet * 0.3);
    const h = stone * (0.55 + bevel * 0.25 + n * 0.1) + (1 - stone) * 0.1;
    const r = lerp(lerp(0.96, 0.8 + n * 0.1, stone), 0.42, wet);
    return { c: col, h, r };
  };
}

/** Bricks (chimneys, hearths, cellar vaults). Tile ≈ 1 m. */
export function bricks({ seed = 101, rows = 14, cols = 4, base = [0.4, 0.25, 0.18], soot = 0.3 } = {}) {
  const tones = [[1, 1, 1], [1.08, 0.95, 0.85], [0.85, 0.82, 0.8], [1.12, 0.88, 0.72], [0.7, 0.62, 0.58], [0.95, 0.9, 0.86]];
  return (u, v) => {
    const ry = v * rows;
    const row = Math.floor(ry);
    const off = (row % 2) * 0.5 + (hash2(row, 3, seed) - 0.5) * 0.12;
    const rx = u * cols + off;
    const col = Math.floor(rx);
    const fx = rx - col;
    const fy = ry - row;
    const id = hash2(((col % cols) + cols) % cols, row, seed);
    const n = fbm(u * 30, v * 30, { octaves: 4, period: 30, seed: seed + 1 });
    const pit = valueNoise(u * 160, v * 160, 160, seed + 3);
    const e = Math.min(Math.min(fx, 1 - fx) * (1 / cols) * rows * 0.5, Math.min(fy, 1 - fy)) + (n - 0.5) * 0.08 * (0.5 + id);
    const brick = smooth(0.07, 0.1, e);
    const bev = smooth(0.07, 0.18, e);
    const tn = tones[Math.floor(id * tones.length)];
    let c = [base[0] * tn[0], base[1] * tn[1], base[2] * tn[2]];
    c = mul3(c, 0.78 + hash2(col, row, seed + 7) * 0.3 + (n - 0.5) * 0.22 + (pit - 0.5) * 0.08);
    // dark over-fired headers, efflorescence and soot
    if (hash2(col, row, seed + 9) > 0.86) c = mul3(c, 0.55);
    c = mix3(c, [0.6, 0.58, 0.54], smooth(0.72, 0.85, fbm(u * 8, v * 8, { octaves: 3, period: 8, seed: seed + 4 })) * 0.3);
    c = mix3(c, [0.12, 0.1, 0.09], smooth(0.5, 0.8, fbm(u * 3, v * 3, { octaves: 3, period: 3, seed: seed + 2 })) * soot);
    const m = mul3([0.44, 0.41, 0.36], 0.72 + n * 0.3);
    return { c: mix3(m, c, brick), h: brick * (0.58 + bev * 0.1 + n * 0.12 - pit * 0.04) + (1 - brick) * 0.12, r: lerp(0.95, 0.82 + pit * 0.1, brick) };
  };
}

/**
 * Interior wainscot panelling (lower wall): stiles, rails and raised fields.
 * Tile ≈ 1.5 m wide; grain vertical.
 */
export function wainscot({ seed = 111, panels = 2, base = [0.3, 0.19, 0.11] } = {}) {
  return (u, v) => {
    const pu = u * panels;
    const pi = Math.floor(pu);
    const fx = pu - pi;
    const g1 = valueNoise(u * 60, v * 4, 60, seed);
    const g2 = valueNoise(u * 180, v * 8, 180, seed + 1);
    let c = mul3(base, 0.75 + g1 * 0.3 + g2 * 0.12);
    const inField = fx > 0.14 && fx < 0.86 && v > 0.14 && v < 0.86;
    const edgeD = Math.min(fx - 0.14, 0.86 - fx, v - 0.14, 0.86 - v);
    let h = 0.7;
    if (inField) {
      h = 0.55 + smooth(0, 0.06, edgeD) * 0.25;
      c = mul3(c, 0.92 + smooth(0, 0.06, edgeD) * 0.1);
    } else {
      const d = Math.min(Math.abs(fx - 0.14), Math.abs(fx - 0.86), Math.abs(v - 0.14), Math.abs(v - 0.86));
      if (d < 0.015) {
        h = 0.5;
        c = mul3(c, 0.6);
      }
    }
    h += g1 * 0.05;
    return { c, h, r: 0.55 + g2 * 0.15 };
  };
}

/** Floor boards (interior): long boards, dark joints, nail pairs, wear path. Tile ≈ 2 m. */
export function floorBoards({ seed = 121, count = 9, base = [0.34, 0.22, 0.13] } = {}) {
  return (u, v) => {
    const p = Math.floor(u * count);
    const fu = u * count - p;
    const id = hash2(p, 0, seed);
    // stagger board ends
    const endOff = hash2(p, 1, seed);
    const fv = fract(v * 1 + endOff);
    const endGap = smooth(0, 0.006, Math.min(fv, 1 - fv));
    const g1 = valueNoise(fu * 4 + id * 17, v * 60 + id * 40, 1000, seed);
    const g2 = valueNoise(fu * 12 + id * 7, v * 200, 1000, seed + 1);
    const ring = Math.sin((v * 8 + g1 * 2.5 + id * 5) * Math.PI) * 0.5 + 0.5;
    const gap = smooth(0, 0.06, Math.min(fu, 1 - fu)) * endGap;
    let c = mul3(base, 0.68 + id * 0.45);
    c = mul3(c, 0.78 + g1 * 0.25 + g2 * 0.12 + ring * 0.08);
    const wear = smooth(0.4, 0.7, fbm(u * 2, v * 2, { octaves: 3, period: 2, seed: seed + 2 }));
    c = mix3(c, mul3(c, 1.25), wear * 0.3);
    let h = gap * (0.6 + g1 * 0.1 + ring * 0.04);
    const nd = Math.hypot((fu - 0.5) * 0.3, (fv - 0.03) * 1) ;
    const nd2 = Math.hypot((fu - 0.5) * 0.3, (fv - 0.97) * 1);
    if (Math.min(nd, nd2) < 0.006) {
      c = [0.08, 0.07, 0.06];
      h = 0.62;
    }
    return { c: mul3(c, lerp(0.25, 1, gap)), h, r: lerp(0.86, 0.66, wear) - g2 * 0.06 };
  };
}

/** Barrel staves (vertical boards, grain along V). */
export function staves({ seed = 131, count = 14, base = [0.36, 0.23, 0.13] } = {}) {
  return (u, v) => {
    const p = Math.floor(u * count);
    const fu = u * count - p;
    const id = hash2(p, 2, seed);
    const g1 = valueNoise(fu * 3 + id * 11, v * 30, 1000, seed);
    const g2 = valueNoise(fu * 9, v * 90 + id * 13, 1000, seed + 1);
    const gap = smooth(0, 0.08, Math.min(fu, 1 - fu));
    let c = mul3(base, 0.7 + id * 0.4 + g1 * 0.25 + g2 * 0.1);
    c = mix3(c, [0.3, 0.28, 0.24], smooth(0.5, 0.8, fbm(u * 4, v * 4, { octaves: 3, period: 4, seed: seed + 3 })) * 0.4);
    return { c: mul3(c, lerp(0.3, 1, gap)), h: gap * (0.6 + g1 * 0.15), r: 0.8 };
  };
}

/** Crate boards: horizontal planks with a darker braced frame. */
export function crateBoards({ seed = 141, base = [0.45, 0.32, 0.19] } = {}) {
  return (u, v) => {
    const frame = Math.min(u, 1 - u, v, 1 - v) < 0.1;
    const diag = !frame && Math.abs(u - v) < 0.07;
    const count = 5;
    const p = Math.floor(v * count);
    const fv = v * count - p;
    const id = hash2(p, 5, seed);
    const g1 = valueNoise(u * 40 + id * 9, fv * 3, 1000, seed);
    const g2 = valueNoise(u * 120, fv * 8 + id * 5, 1000, seed + 1);
    let c = mul3(base, 0.7 + id * 0.35 + g1 * 0.25 + g2 * 0.1);
    let h = smooth(0, 0.08, Math.min(fv, 1 - fv)) * 0.5;
    if (frame || diag) {
      c = mul3(base, 0.55 + g1 * 0.2);
      h = 0.9;
      const fe = frame ? Math.min(Math.abs(Math.min(u, 1 - u, v, 1 - v) - 0.1), 1) : Math.abs(Math.abs(u - v) - 0.07);
      if (fe < 0.012) {
        h = 0.55;
        c = mul3(c, 0.5);
      }
    }
    c = mix3(c, [0.28, 0.27, 0.24], smooth(0.5, 0.85, fbm(u * 3, v * 3, { octaves: 3, period: 3, seed: seed + 2 })) * 0.45);
    return { c, h, r: 0.82 };
  };
}

/** Wrought iron with rust. */
export function rustyIron({ seed = 151 } = {}) {
  return (u, v) => {
    const n = wfbm(u, v, 6, seed, 5, 0.5);
    const f = fbm(u * 40, v * 40, { octaves: 3, period: 40, seed: seed + 1 });
    const pit = valueNoise(u * 128, v * 128, 128, seed + 2);
    const rust = smooth(0.48, 0.66, n + (pit - 0.5) * 0.1);
    // forged iron: dark blue-grey with lighter hammer-polished highs, rust bloom in the lows
    const metal = mul3([0.2, 0.2, 0.22], 0.75 + f * 0.6);
    const c = mix3(metal, mul3([0.36, 0.18, 0.08], 0.65 + f * 0.6), rust);
    return { c, h: 0.5 + rust * 0.2 + f * 0.1 + pit * 0.04, r: lerp(0.38, 0.95, rust) };
  };
}

/** Rough coarse cloth (sacks, awnings, cart covers). */
export function burlap({ seed = 161, base = [0.5, 0.42, 0.3] } = {}) {
  return (u, v) => {
    const wx = Math.sin(u * 128 * Math.PI * 2) * 0.5 + 0.5;
    const wy = Math.sin(v * 128 * Math.PI * 2) * 0.5 + 0.5;
    const weave = (Math.floor(u * 128) + Math.floor(v * 128)) % 2 ? wx : wy;
    const n = fbm(u * 8, v * 8, { octaves: 4, period: 8, seed });
    let c = mul3(base, 0.75 + weave * 0.2 + (n - 0.5) * 0.3);
    c = mix3(c, [0.2, 0.17, 0.13], smooth(0.6, 0.85, n) * 0.5);
    return { c, h: 0.4 + weave * 0.3, r: 0.95 };
  };
}

/** Loose rubble / broken masonry chunks + gravel (for rubble props, ruins ground). */
export function rubbleStones({ seed = 171 } = {}) {
  return (u, v) => {
    const w = worley(u * 9, v * 9, 9, seed);
    const w2 = worley(u * 30, v * 30, 30, seed + 1);
    const n = fbm(u * 20, v * 20, { octaves: 4, period: 20, seed: seed + 2 });
    const stone = smooth(0.04, 0.16, w.f2 - w.f1);
    const grav = smooth(0.05, 0.2, w2.f2 - w2.f1);
    let c = mul3([0.46, 0.43, 0.39], 0.65 + w.id * 0.5 + (n - 0.5) * 0.3);
    const g = mul3([0.3, 0.27, 0.23], 0.6 + w2.id * 0.6);
    c = mix3(mix3([0.14, 0.12, 0.1], g, grav), c, stone);
    return { c, h: stone * (0.5 + (w.f2 - w.f1) * 0.6) + (1 - stone) * grav * 0.3, r: 0.93 };
  };
}

/**
 * Street dirt/mud ground with pebbles, straw bits and weeds (rubble cells,
 * courtyards gone to seed). Tile ≈ 3 m.
 */
export function mudGround({ seed = 181, grass = 0.5 } = {}) {
  return (u, v) => {
    const n = wfbm(u, v, 4, seed, 6, 0.5);
    const f = fbm(u * 40, v * 40, { octaves: 3, period: 40, seed: seed + 1 });
    const w = worley(u * 24, v * 24, 24, seed + 2);
    const pebble = (1 - smooth(0.1, 0.22, w.f1)) * (w.id > 0.55 ? 1 : 0);
    let c = mul3([0.28, 0.23, 0.17], 0.7 + n * 0.5 + (f - 0.5) * 0.2);
    c = mix3(c, mul3([0.44, 0.42, 0.38], 0.6 + w.id * 0.5), pebble);
    const gr = smooth(0.55, 0.68, fbm(u * 5, v * 5, { octaves: 5, period: 5, seed: seed + 3 })) * grass;
    c = mix3(c, mul3([0.19, 0.26, 0.1], 0.7 + f * 0.6), gr * 0.85);
    const wet = smooth(0.66, 0.72, n) * (1 - gr);
    c = mul3(c, 1 - wet * 0.35);
    return { c, h: n * 0.4 + pebble * 0.35 + f * 0.08 + gr * 0.1, r: lerp(0.95, 0.25, wet) };
  };
}

/** Timber ceiling boards with joists (interior). Grain along U. Tile ≈ 3 m. */
export function ceilingBoards({ seed = 191 } = {}) {
  const fb = floorBoards({ seed, count: 12, base: [0.2, 0.13, 0.08] });
  return (u, v, x, y) => {
    const s = fb(v, u, x, y);
    s.c = mul3(s.c, 0.9);
    return s;
  };
}

/** Choppy water height (normal map source). Tile ≈ 10 m. */
export function waterWaves({ seed = 201 } = {}) {
  return (u, v) => {
    let h = 0;
    for (let k = 0; k < 6; k++) {
      const a = hash2(k, 1, seed) * Math.PI * 2;
      const f = 2 + k * 3;
      const dx = Math.round(Math.cos(a) * f);
      const dy = Math.round(Math.sin(a) * f);
      h += Math.sin((u * dx + v * dy) * Math.PI * 2 + hash2(k, 2, seed) * 6) / (1 + k * 0.6);
    }
    h = h * 0.08 + 0.5 + (fbm(u * 16, v * 16, { octaves: 3, period: 16, seed }) - 0.5) * 0.25;
    return { c: [0.1, 0.15, 0.2], h, r: 0.1 };
  };
}

/** Weathered limestone/marble for columns and statuary (monolithic, no joints). Tile ≈ 1.5 m. */
export function limestone({ seed = 211, base = [0.5, 0.47, 0.41] } = {}) {
  return (u, v) => {
    const big = wfbm(u, v, 3, seed, 5, 0.5);
    const mid = fbm(u * 14, v * 14, { octaves: 4, period: 14, seed: seed + 1 });
    const fine = valueNoise(u * 160, v * 160, 160, seed + 2);
    const pits = worley(u * 36, v * 36, 36, seed + 3);
    const pit = (1 - smooth(0, 0.1, pits.f1)) * (pits.id > 0.7 ? 1 : 0);
    let c = mul3(base, 0.82 + (big - 0.5) * 0.3 + (mid - 0.5) * 0.15 + (fine - 0.5) * 0.05);
    const streak = fbm(u * 24, v * 2, { octaves: 3, period: 24, seed: seed + 4 });
    c = mul3(c, 1 - smooth(0.55, 0.85, streak) * 0.25);
    c = mix3(c, [0.45, 0.47, 0.34], smooth(0.62, 0.75, big) * 0.5);
    c = mix3(c, [0.8, 0.78, 0.66], smooth(0.75, 0.82, mid) * 0.3);
    c = mul3(c, 1 - pit * 0.35);
    return { c, h: 0.6 + mid * 0.1 + fine * 0.03 - pit * 0.2, r: 0.8 + fine * 0.1 };
  };
}

/**
 * Courtyard flagstones: mixed sizes in running-bond courses (some stones split
 * into two smaller ones), per-stone tilt/height, chipped corners, worn arrises,
 * wide dirt/moss-filled joints, lichen and stains. Tile ≈ 3 m.
 */
export function flagstones({ seed = 77, rows = 8, base = [0.5, 0.47, 0.42], weeds = 0.45, minW = 0.14, maxW = 0.34 } = {}) {
  const lay = masonryLayout({ rows, seed, minW, maxW });
  return (u, v) => {
    let L = lay(u, v);
    let id = L.id;
    // split some stones into two (vertical or horizontal) → mixed sizes
    const sp = hash2(L.row * 71 + L.col, 2, seed + 9);
    let fx = L.fx;
    let fy = L.fy;
    let bw = L.bw;
    let bh = L.bh;
    if (sp < 0.3 && bw > 0.26) {
      const cut = 0.4 + hash2(L.row, L.col, seed + 10) * 0.2;
      const right = fx > cut;
      fx = right ? (fx - cut) / (1 - cut) : fx / cut;
      bw = right ? bw * (1 - cut) : bw * cut;
      id = hash2(Math.floor(id * 1e6), right ? 1 : 0, seed + 11);
    } else if (sp > 0.86 && bh > 0.15) {
      const top = fy > 0.5;
      fy = top ? (fy - 0.5) * 2 : fy * 2;
      bh *= 0.5;
      id = hash2(Math.floor(id * 1e6), top ? 3 : 4, seed + 12);
    }
    const dx = Math.min(fx, 1 - fx) * bw;
    const dy = Math.min(fy, 1 - fy) * bh;
    const n = fbm(u * 30, v * 30, { octaves: 4, period: 30, seed: seed + 1 });
    const nf = fbm(u * 90, v * 90, { octaves: 2, period: 90, seed: seed + 13 });
    const wearS = hash2(Math.floor(id * 1e6), 5, seed);
    const cornerD = Math.hypot(dx, dy);
    const chipR = 0.004 + wearS * 0.012;
    const corner = (1 - smooth(chipR * 0.5, chipR * (1.2 + n), cornerD)) * 0.008;
    const e = Math.min(dx, dy) + (n - 0.5) * 0.005 * (0.6 + wearS * 1.4) + (nf - 0.5) * 0.002 - corner;
    const jw = 0.0028 + wearS * 0.002;
    const stone = smooth(jw, jw + 0.003, e);
    const bevel = smooth(jw, jw + 0.012 + wearS * 0.02, e);
    const big = wfbm(u, v, 3, seed + 2);
    const tones = [[1, 1, 1], [1.04, 0.99, 0.92], [0.94, 0.96, 0.98], [1.02, 0.97, 0.9], [0.9, 0.89, 0.87], [1.06, 1.03, 0.96], [0.86, 0.85, 0.82]];
    const tn = tones[Math.floor(id * tones.length)];
    let c = [base[0] * tn[0], base[1] * tn[1], base[2] * tn[2]];
    c = mul3(c, 0.84 + hash2(Math.floor(id * 1e5), 7, seed) * 0.2 + (n - 0.5) * 0.22 + (big - 0.5) * 0.16 + (nf - 0.5) * 0.06);
    // worn, slightly polished centres; lighter fresh chips at arrises
    c = mul3(c, 1 + (1 - bevel) * 0.1 * stone);
    // occasional hairline crack through a slab
    const cw = worley(u * 12, v * 12, 12, seed + 3);
    const crack = (1 - smooth(0, 0.012, cw.f2 - cw.f1)) * (id > 0.8 ? 1 : 0);
    c = mul3(c, 1 - crack * 0.45);
    // lichen rosettes and dark stains
    const lw = worley(u * 40, v * 40, 40, seed + 14);
    const lich = (1 - smooth(0.12, 0.3, lw.f1)) * (lw.id > 0.86 ? 1 : 0);
    c = mix3(c, [0.62, 0.62, 0.5], lich * 0.45);
    c = mul3(c, 1 - smooth(0.6, 0.8, fbm(u * 5, v * 5, { octaves: 3, period: 5, seed: seed + 15 })) * 0.22);
    // joints: compacted dirt, grit, moss/weeds in places
    const jn = valueNoise(u * 260, v * 260, 260, seed + 16);
    let jc = mul3([0.21, 0.19, 0.15], 0.75 + jn * 0.5);
    jc = mix3(jc, mul3([0.17, 0.25, 0.09], 0.8 + jn * 0.4), smooth(0.55, 0.72, big) * weeds);
    const halo = (1 - smooth(jw, jw + 0.01, e)) * 0.2; // dirt creeping onto the stone edge
    c = mix3(c, mul3(jc, 1.3), halo * (1 - bevel));
    const col = mix3(jc, c, stone);
    // per-stone tilt + settle (reads through the normal map as uneven paving)
    const tx = (hash2(Math.floor(id * 1e5), 21, seed) - 0.5) * 0.14;
    const ty = (hash2(Math.floor(id * 1e5), 22, seed) - 0.5) * 0.14;
    const settle = (hash2(Math.floor(id * 1e5), 23, seed) - 0.5) * 0.06;
    const sh = 0.6 + settle + (fx - 0.5) * tx * bw * 4 + (fy - 0.5) * ty * bh * 4 + bevel * 0.12 + n * 0.06 + nf * 0.02 - crack * 0.1;
    const h = stone * sh + (1 - stone) * (0.1 + jn * 0.06);
    const r = lerp(0.97, 0.72 + n * 0.16 + wearS * 0.08 - (1 - bevel) * 0.05, stone);
    return { c: col, h, r };
  };
}

/**
 * Vertical door planks (tile = one door leaf, local UVs): per-plank tone,
 * flowing grain with knots, end checks at top/bottom, weathered grey edges,
 * dark joints. Roughness follows wear.
 */
export function doorPlanks({ seed = 221, count = 5, base = [0.3, 0.2, 0.13] } = {}) {
  return (u, v) => {
    const p = Math.floor(u * count);
    const fu = u * count - p;
    const id = hash2(p, 1, seed);
    // knots: a couple per plank
    let kx = 0;
    let kAmt = 0;
    for (let k = 0; k < 2; k++) {
      const ky = hash2(p, 10 + k, seed);
      const kxp = 0.25 + hash2(p, 20 + k, seed) * 0.5;
      const dxk = (fu - kxp) * 1.0;
      const dyk = (v - ky) * count * 1.2;
      const d = Math.hypot(dxk, dyk);
      const infl = Math.exp(-d * d * 18);
      kx += infl * Math.sign(dxk || 1) * 0.25 * (1 - Math.min(1, d * 2));
      kAmt = Math.max(kAmt, 1 - smooth(0.03 + hash2(p, 30 + k, seed) * 0.03, 0.07 + hash2(p, 30 + k, seed) * 0.04, d));
    }
    const g1 = fbm(fu * 3 + id * 9, v * 4, { octaves: 3, period: 1000, seed: seed + 1 });
    const gx = fu + kx + (g1 - 0.5) * 0.3;
    const ring = Math.sin((gx * 9 + id * 7) * Math.PI * 2) * 0.5 + 0.5;
    const fine = valueNoise(gx * 120, v * 14, 1000, seed + 2);
    const pore = valueNoise(gx * 400, v * 60, 1000, seed + 3);
    let c = mul3(base, 0.7 + id * 0.4);
    c = mul3(c, 0.78 + ring * 0.16 + fine * 0.14 + (pore - 0.5) * 0.08);
    // knots: dark core with a ring
    c = mix3(c, mul3(base, 0.6), kAmt * 0.8);
    // weathering: greyed silver near plank edges and bottom (splash zone)
    const edge = 1 - smooth(0.0, 0.12, Math.min(fu, 1 - fu));
    const grey = clamp01(edge * 0.6 + (1 - smooth(0.0, 0.25, v)) * 0.5 + smooth(0.55, 0.8, fbm(u * 3, v * 3, { octaves: 3, period: 3, seed: seed + 4 })) * 0.4);
    c = mix3(c, mul3([0.38, 0.35, 0.31], 0.8 + fine * 0.3), grey * 0.62);
    // end checks: radial splits from top and bottom ends
    const endD = Math.min(v, 1 - v);
    const chk = valueNoise(fu * 7 + p * 3.1, 0.5, 1000, seed + 5);
    const check = (1 - smooth(0.0, 0.025, Math.abs(chk - 0.5))) * (1 - smooth(0.02, 0.09 + id * 0.06, endD));
    // long drying checks along the grain
    const lchk = (1 - smooth(0.0, 0.012, Math.abs(valueNoise(gx * 6 + 0.5, v * 1.2, 1000, seed + 6) - 0.5))) * smooth(0.55, 0.75, valueNoise(gx * 3, v * 2, 1000, seed + 7));
    const ck = Math.max(check, lchk * 0.8);
    c = mul3(c, 1 - ck * 0.7);
    const gap = smooth(0.0, 0.03, Math.min(fu, 1 - fu));
    c = mul3(c, lerp(0.2, 1, gap));
    const h = gap * (0.62 + ring * 0.05 + fine * 0.04 + pore * 0.01 - ck * 0.25 + kAmt * 0.04);
    const r = clamp01(0.72 + grey * 0.18 + pore * 0.06 - kAmt * 0.15);
    return { c, h, r };
  };
}

/** Fractured rock / broken masonry surface (no joints) for rubble meshes. Tile ≈ 1 m. */
export function rockFace({ seed = 231, base = [0.4, 0.38, 0.34] } = {}) {
  return (u, v) => {
    const big = wfbm(u, v, 4, seed, 5, 0.5);
    const mid = fbm(u * 16, v * 16, { octaves: 4, period: 16, seed: seed + 1 });
    const grit = valueNoise(u * 256, v * 256, 256, seed + 2);
    const strata = Math.sin((v * 9 + big * 2.5) * Math.PI * 2) * 0.5 + 0.5;
    let c = mul3(base, 0.78 + (big - 0.5) * 0.35 + (mid - 0.5) * 0.18 + (grit - 0.5) * 0.1 + strata * 0.05);
    c = mix3(c, [0.56, 0.54, 0.47], smooth(0.7, 0.8, fbm(u * 10, v * 10, { octaves: 3, period: 10, seed: seed + 3 })) * 0.3);
    c = mix3(c, [0.33, 0.36, 0.24], smooth(0.66, 0.76, big) * 0.35);
    return { c, h: 0.5 + big * 0.2 + mid * 0.12 + grit * 0.04 + strata * 0.03, r: 0.86 + grit * 0.1 };
  };
}
