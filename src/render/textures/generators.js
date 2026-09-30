import { fbm, worley, hash2, clamp01, lerp, smooth, valueNoise } from './noise.js';

/**
 * Procedural material generators. Each returns a per-pixel function for
 * materialCanvases(): (u, v) → {c:[r,g,b], h, r}. u,v in [0,1), tileable.
 * Explore-renderer agents: add generators here and register them in index.js.
 */
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** Running-bond ashlar stone blocks. */
export function stoneBlocks({ seed = 1, rows = 6, cols = 3, base = [0.46, 0.43, 0.39], mortar = [0.22, 0.2, 0.18], weather = 0.5 } = {}) {
  return (u, v) => {
    const ry = v * rows;
    const row = Math.floor(ry);
    const off = row % 2 ? 0.5 : 0;
    const rx = u * cols + off;
    const col = Math.floor(rx);
    const fx = rx - col;
    const fy = ry - row;
    const id = hash2(((col % cols) + cols) % cols, row, seed);
    const edge = Math.min(fx, 1 - fx) * (rows / cols) * 1.0;
    const edgeY = Math.min(fy, 1 - fy);
    const e = Math.min(edge, edgeY);
    const n = fbm(u * 8, v * 8, { octaves: 5, period: 8, seed });
    const chip = fbm(u * 24, v * 24, { octaves: 3, period: 24, seed: seed + 9 });
    const mortarW = 0.06 + chip * 0.05;
    const inStone = smooth(mortarW, mortarW + 0.05, e);
    const bevel = smooth(0, 0.22, e);
    let c = mix3(base, mul3(base, 0.7 + id * 0.55), 0.8);
    c = mix3(c, [0.36, 0.38, 0.3], clamp01((n - 0.55) * 2.5) * weather); // lichen/moss tint
    c = mul3(c, 0.75 + n * 0.45);
    const grime = smooth(0.3, 1, v) * 0.25 * weather;
    c = mul3(c, 1 - grime);
    const col3 = mix3(mul3(mortar, 0.8 + chip * 0.4), c, inStone);
    const h = inStone * (0.55 + bevel * 0.35 + n * 0.2) + (1 - inStone) * chip * 0.15;
    return { c: col3, h, r: lerp(0.95, 0.78 + id * 0.12, inStone) };
  };
}

/** Timber frame + plaster (Tudor-style) wall. */
export function timberPlaster({ seed = 2 } = {}) {
  return (u, v) => {
    const n = fbm(u * 6, v * 6, { octaves: 5, period: 6, seed });
    const beamV = Math.min(Math.abs(u - 0.02), Math.abs(u - 0.98), Math.abs(u - 0.5)) < 0.045;
    const beamH = Math.abs(v - 0.08) < 0.04 || Math.abs(v - 0.92) < 0.04 || Math.abs(v - 0.5) < 0.03;
    const diag = Math.abs((u % 0.5) * 2 - v) < 0.035 && v > 0.5;
    const isBeam = beamV || beamH || diag;
    const grain = valueNoise(u * 4, v * 90, 4, seed + 3);
    if (isBeam) {
      const c = mul3([0.24, 0.15, 0.09], 0.7 + grain * 0.5 + n * 0.2);
      return { c, h: 0.8 + grain * 0.1, r: 0.8 };
    }
    const stain = clamp01((fbm(u * 3, v * 3, { octaves: 4, period: 3, seed: seed + 7 }) - 0.45) * 2);
    let c = mix3([0.82, 0.76, 0.62], [0.55, 0.5, 0.4], stain * 0.7);
    c = mul3(c, 0.85 + n * 0.25);
    const crack = worley(u * 10, v * 10, 10, seed).f2 - worley(u * 10, v * 10, 10, seed).f1 < 0.012 ? 0.82 : 1;
    return { c: mul3(c, crack), h: 0.45 + n * 0.1 - (crack < 1 ? 0.2 : 0), r: 0.92 };
  };
}

/** Crumbling ruin: broken blocks with dark gaps and rubble stains. */
export function ruinStone({ seed = 3 } = {}) {
  const blocks = stoneBlocks({ seed, rows: 5, cols: 2, base: [0.4, 0.37, 0.33], weather: 1 });
  return (u, v, x, y) => {
    const s = blocks(u, v, x, y);
    const hole = fbm(u * 3, v * 3, { octaves: 4, period: 3, seed: seed + 11 });
    const broken = smooth(0.62, 0.7, hole) * smooth(0.2, 0.5, 1 - v);
    s.c = mix3(s.c, [0.06, 0.05, 0.05], broken);
    s.h = lerp(s.h, 0.05, broken);
    s.c = mix3(s.c, [0.2, 0.26, 0.14], smooth(0.75, 1, v) * 0.5 * fbm(u * 12, v * 12, { period: 12, seed }));
    return s;
  };
}

/** Rounded cobblestones (Worley). */
export function cobbles({ seed = 4, scale = 7, base = [0.42, 0.4, 0.38] } = {}) {
  return (u, v) => {
    const w = worley(u * scale, v * scale, scale, seed);
    const gap = w.f2 - w.f1;
    const stone = smooth(0.04, 0.16, gap);
    const n = fbm(u * 16, v * 16, { octaves: 4, period: 16, seed: seed + 2 });
    let c = mul3(base, 0.65 + w.id * 0.5);
    c = mix3(c, [0.45, 0.36, 0.28], (w.id > 0.7 ? 0.4 : 0));
    c = mul3(c, 0.8 + n * 0.35);
    const dirt = mul3([0.16, 0.13, 0.1], 0.8 + n * 0.4);
    return { c: mix3(dirt, c, stone), h: stone * (0.6 + (1 - w.f1) * 0.4) + n * 0.08, r: lerp(0.98, 0.7 + n * 0.2, stone) };
  };
}

/** Large square flagstones. */
export function flagstones({ seed = 5 } = {}) {
  return stoneBlocks({ seed, rows: 3, cols: 3, base: [0.5, 0.48, 0.44], mortar: [0.18, 0.17, 0.15], weather: 0.7 });
}

/** Wooden planks (floors, doors). */
export function planks({ seed = 6, count = 5, base = [0.36, 0.22, 0.12], vertical = false, studs = false } = {}) {
  return (u0, v0) => {
    const u = vertical ? u0 : v0;
    const v = vertical ? v0 : u0;
    const p = Math.floor(u * count);
    const fu = u * count - p;
    const id = hash2(p, 0, seed);
    const grain = valueNoise(fu * 3 + id * 10, v * 40 + id * 50, 1000, seed) * 0.6 + valueNoise(fu * 8, v * 120, 1000, seed + 1) * 0.4;
    const ring = Math.sin((v * 12 + grain * 3 + id * 6) * Math.PI) * 0.5 + 0.5;
    const gap = smooth(0, 0.05, Math.min(fu, 1 - fu));
    let c = mul3(base, 0.7 + id * 0.5);
    c = mul3(c, 0.8 + grain * 0.3 + ring * 0.08);
    let h = gap * (0.6 + grain * 0.2);
    if (studs) {
      const sx = (fu - 0.5) * 2;
      for (const sy of [0.12, 0.88]) {
        const d = Math.hypot(sx * 0.2, (v - sy) * 1.0);
        if (d < 0.025) {
          c = [0.18, 0.17, 0.16];
          h = 1;
        }
      }
      const band = Math.abs(v - 0.12) < 0.03 || Math.abs(v - 0.88) < 0.03;
      if (band) {
        c = mul3([0.2, 0.19, 0.18], 0.8 + grain * 0.4);
        h = 0.85;
      }
    }
    return { c: mul3(c, lerp(0.3, 1, gap)), h, r: 0.75 };
  };
}

/** Packed dirt with pebbles and grass tufts (rubble ground). */
export function rubbleGround({ seed = 7 } = {}) {
  return (u, v) => {
    const n = fbm(u * 5, v * 5, { octaves: 6, period: 5, seed });
    const w = worley(u * 14, v * 14, 14, seed + 1);
    const pebble = 1 - smooth(0.12, 0.25, w.f1);
    const grass = smooth(0.58, 0.7, fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: seed + 3 }));
    let c = mul3([0.3, 0.25, 0.19], 0.7 + n * 0.5);
    c = mix3(c, mul3([0.45, 0.43, 0.4], 0.7 + w.id * 0.5), pebble * (w.id > 0.5 ? 1 : 0));
    c = mix3(c, [0.2, 0.28, 0.12], grass * 0.7);
    return { c, h: n * 0.5 + pebble * (w.id > 0.5 ? 0.4 : 0), r: 0.95 };
  };
}
