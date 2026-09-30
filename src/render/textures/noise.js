/**
 * Seeded procedural noise for texture generation (CPU side).
 * All functions are tileable when given `period` (integer lattice wrap).
 */
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

/** Tileable value noise in [0,1). */
export function valueNoise(x, y, period = 256, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = mod(xi, period);
  const y0 = mod(yi, period);
  const x1 = mod(xi + 1, period);
  const y1 = mod(yi + 1, period);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal Brownian motion, tileable over `period` at base frequency. */
export function fbm(x, y, { octaves = 5, period = 8, seed = 0, lacunarity = 2, gain = 0.5 } = {}) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(fx, fy, p, seed + i * 31);
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
    p *= lacunarity;
  }
  return sum / norm;
}

/** Tileable Worley (cellular) noise: returns {f1, f2, id}. */
export function worley(x, y, period = 8, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = mod(cx, period);
      const wy = mod(cy, period);
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 17);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 5);
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
