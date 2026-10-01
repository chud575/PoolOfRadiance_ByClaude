/**
 * Small seeded RNG for the audio engine (mulberry32). Audio never touches the
 * game's ctx.rng (that would perturb game-logic determinism), but it is still
 * seeded so offline renders are reproducible bit-for-bit.
 */
export class AudioRng {
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0;
  }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** Integer in [a, b] inclusive. */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p) {
    return this.next() < p;
  }

  /** Approximately normal (sum of 3 uniforms), mean 0, sd ≈ s. */
  gauss(s = 1) {
    return (this.next() + this.next() + this.next() - 1.5) * 2 * s;
  }

  fork(salt = 1) {
    return new AudioRng((this.s ^ Math.imul(salt + 0x51ed27, 0x2c1b3c6d)) >>> 0);
  }
}

/** Stable 32-bit string hash (FNV-1a) — used to seed per-cue generators. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
