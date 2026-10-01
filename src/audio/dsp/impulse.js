import { AudioRng } from '../core/rng.js';

/**
 * Generated convolution-reverb impulse responses.
 *
 * Model: a handful of discrete early reflections (image-source-ish taps with
 * per-channel jitter for width), then a diffuse tail of decorrelated noise with
 * an exponential envelope (T60) whose high frequencies die faster than its lows
 * (a one-pole lowpass whose cutoff slides down over time — air + wall
 * absorption). A gentle highpass keeps the tail from booming.
 */
export const ROOMS = {
  // name: { t60, pre (s), damp (0 bright … 1 dark), early: count, size (m-ish), width, lowcut }
  hall: { t60: 2.9, pre: 0.022, damp: 0.55, early: 14, size: 26, width: 1, lowcut: 90 },
  cathedral: { t60: 4.6, pre: 0.035, damp: 0.6, early: 18, size: 40, width: 1, lowcut: 70 },
  dungeon: { t60: 3.4, pre: 0.012, damp: 0.72, early: 22, size: 9, width: 0.85, lowcut: 110 },
  room: { t60: 0.85, pre: 0.006, damp: 0.5, early: 10, size: 5, width: 0.7, lowcut: 140 },
  street: { t60: 1.3, pre: 0.018, damp: 0.6, early: 8, size: 14, width: 1, lowcut: 160 },
  open: { t60: 0.7, pre: 0.03, damp: 0.75, early: 4, size: 30, width: 1, lowcut: 220 },
};

/**
 * @param {number} sr sample rate
 * @param {keyof ROOMS | object} spec
 * @returns {[Float32Array, Float32Array]}
 */
export function impulseData(sr, spec, seed = 7) {
  const r = typeof spec === 'string' ? ROOMS[spec] : spec;
  const rng = new AudioRng(seed);
  const len = Math.ceil(sr * (r.pre + r.t60 * 1.15));
  const chans = [new Float32Array(len), new Float32Array(len)];
  const pre = Math.floor(r.pre * sr);
  const k = Math.log(1000) / r.t60; // amplitude e-folding so -60 dB at t60
  for (let c = 0; c < 2; c++) {
    const d = chans[c];
    // Diffuse tail with time-varying damping.
    let lp = 0;
    let hp = 0;
    let prev = 0;
    const lcA = Math.exp((-2 * Math.PI * r.lowcut) / sr);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      // Cutoff falls from ~sr/2.4 toward a few hundred Hz as the tail ages.
      const fc = 300 + (sr / 2.4) * Math.exp(-t * (1.2 + r.damp * 5));
      const a = Math.exp((-2 * Math.PI * fc) / sr);
      const n = rng.next() * 2 - 1;
      lp = (1 - a) * n + a * lp;
      // DC/low cut
      hp = lcA * (hp + lp - prev);
      prev = lp;
      // Build-up: diffuse field grows in over ~size/80 s.
      const grow = 1 - Math.exp(-t / Math.max(0.004, r.size / 900));
      d[i] = hp * Math.exp(-k * t) * grow * 0.9;
    }
    // Early reflections.
    for (let e = 0; e < r.early; e++) {
      const tt = r.pre * 0.4 + ((e + rng.next()) / r.early) * (r.size / 343) * 1.6;
      const idx = Math.floor(tt * sr * (1 + (c ? 0.013 : -0.011) * r.width * rng.next()));
      if (idx >= len) continue;
      const amp = (0.55 / (1 + e * 0.35)) * (rng.next() < 0.5 ? -1 : 1) * Math.exp(-k * tt);
      // Each reflection is a tiny smeared click (absorption softens it).
      for (let j = 0; j < 24 && idx + j < len; j++) d[idx + j] += amp * Math.exp(-j / (3 + r.damp * 6)) * (j ? 0.5 : 1);
    }
  }
  // Normalise energy so rooms sit at comparable loudness.
  let e = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2 + 1e-9) * 0.9;
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= g;
  return chans;
}

/** @param {BaseAudioContext} ac */
export function makeImpulse(ac, spec, seed) {
  const [l, r] = impulseData(ac.sampleRate, spec, seed);
  const buf = ac.createBuffer(2, l.length, ac.sampleRate);
  buf.copyToChannel(l, 0);
  buf.copyToChannel(r, 1);
  return buf;
}
