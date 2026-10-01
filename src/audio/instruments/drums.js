import { Instrument } from './base.js';
import { sample } from '../dsp/bank.js';
import { modal } from '../dsp/synth.js';
import { AudioRng } from '../core/rng.js';

/**
 * Percussion kit rendered by modal synthesis (cached buffers, 3 velocity
 * layers × 3 round-robin variants). `midi` selects pitch for tuned drums
 * (timpani); kit pieces are addressed by name through opts.kind or the
 * instrument preset.
 */
const KIT = {
  // Japanese-style war drum: huge, low, slow tension drop.
  taiko: (f) => ({ freq: f ?? 62, ratios: [1, 1.58, 2.14, 2.62, 3.4], amps: [1, 0.45, 0.25, 0.14, 0.06], decays: [0.75, 0.35, 0.22, 0.15, 0.1], dur: 2.0, glide: 0.35, noise: 0.5, noiseDecay: 0.02, noiseLp: 0.15 }),
  // Orchestral timpani (tuned): near-harmonic modes of a loaded membrane.
  timpani: (f) => ({ freq: f ?? 98, ratios: [1, 1.504, 1.742, 2.0, 2.245, 2.494, 2.8], amps: [1, 0.7, 0.4, 0.35, 0.22, 0.15, 0.08], decays: [2.4, 1.5, 1.0, 1.1, 0.8, 0.6, 0.4], dur: 3.2, glide: 0.04, noise: 0.25, noiseDecay: 0.012, noiseLp: 0.25 }),
  tom: (f) => ({ freq: f ?? 120, ratios: [1, 1.6, 2.3], amps: [1, 0.4, 0.2], decays: [0.35, 0.18, 0.1], dur: 0.9, glide: 0.25, noise: 0.5, noiseDecay: 0.015, noiseLp: 0.3 }),
  frame: (f) => ({ freq: f ?? 150, ratios: [1, 1.59, 2.14, 2.3], amps: [1, 0.5, 0.3, 0.2], decays: [0.22, 0.12, 0.08, 0.06], dur: 0.6, glide: 0.08, noise: 0.7, noiseDecay: 0.01, noiseLp: 0.45 }),
  frameSlap: (f) => ({ freq: f ?? 380, ratios: [1, 1.7, 2.6], amps: [0.5, 0.4, 0.3], decays: [0.05, 0.04, 0.03], dur: 0.3, glide: 0.05, noise: 1.2, noiseDecay: 0.012, noiseLp: 0.7 }),
  snare: (f) => ({ freq: f ?? 190, ratios: [1, 1.74, 2.6], amps: [0.6, 0.35, 0.2], decays: [0.08, 0.06, 0.04], dur: 0.5, glide: 0.04, noise: 1.4, noiseDecay: 0.06, noiseLp: 0.85 }),
  rim: () => ({ freq: 1700, ratios: [1, 2.3], amps: [1, 0.4], decays: [0.02, 0.012], dur: 0.15, noise: 0.4, noiseDecay: 0.004, noiseLp: 0.9 }),
  bigboom: () => ({ freq: 38, ratios: [1, 1.5, 2.2], amps: [1, 0.4, 0.2], decays: [1.6, 0.7, 0.4], dur: 3.0, glide: 0.5, noise: 0.6, noiseDecay: 0.04, noiseLp: 0.08 }),
};

/** Metallic noise percussion (tambourine jingles, cymbals) rendered in JS. */
function metal(sr, kind, vel, seed) {
  const rng = new AudioRng(seed);
  const dur = { tamb: 0.45, crash: 3.2, sus: 4.5, hat: 0.18, chime: 2.5 }[kind];
  const N = Math.ceil(sr * dur);
  const out = new Float32Array(N);
  // Inharmonic partial cloud.
  const parts = kind === 'tamb' ? 14 : kind === 'chime' ? 9 : 40;
  for (let p = 0; p < parts; p++) {
    const f = kind === 'tamb' ? rng.range(4800, 11000) : kind === 'chime' ? 1800 * Math.pow(1.17, p) * rng.range(0.99, 1.01) : rng.range(2500, 13000);
    const d = (kind === 'tamb' ? rng.range(0.06, 0.25) : kind === 'hat' ? 0.05 : kind === 'chime' ? rng.range(0.6, 2) : rng.range(0.6, dur * 0.5));
    const a = rng.range(0.3, 1) / Math.sqrt(parts);
    // Recursive sine (rotation) with a running decay: cheap, and stops once inaudible.
    const w = (6.283185307179586 * f) / sr;
    const c = Math.cos(w);
    const sn = Math.sin(w);
    const p0 = rng.next() * 6.283185307179586;
    let x = Math.cos(p0);
    let y = Math.sin(p0);
    let env = a;
    const kd = Math.exp(-1 / (sr * d));
    const floor = a * 1e-5;
    for (let n = 0; n < N && env > floor; n++) {
      out[n] += y * env;
      const x1 = x * c - y * sn;
      y = x * sn + y * c;
      x = x1;
      env *= kd;
    }
  }
  // Noise layer (highpassed).
  let prev = 0;
  let hp = 0;
  const nd = kind === 'tamb' ? 0.05 : kind === 'hat' ? 0.03 : kind === 'chime' ? 0.002 : 0.9;
  for (let n = 0; n < N; n++) {
    const w = rng.next() * 2 - 1;
    hp = 0.85 * (hp + w - prev);
    prev = w;
    let env = Math.exp(-n / sr / nd);
    if (kind === 'sus') env = Math.min(1, n / (sr * 2.6)) * Math.exp(-Math.max(0, n / sr - 2.6) / 0.5); // swell
    out[n] += hp * env * (kind === 'chime' ? 0.2 : 0.55);
  }
  // Suspended-cymbal swell: partials grow in with the noise.
  if (kind === 'sus') for (let n = 0; n < N; n++) out[n] *= Math.min(1, (n / (sr * 2.6)) ** 1.5) * Math.exp(-Math.max(0, n / sr - 2.6) / 0.6);
  // Tambourine: two shakes of jingles (a hit is never a single transient).
  if (kind === 'tamb') {
    const lag = Math.floor(sr * 0.022);
    for (let n = N - 1; n >= lag; n--) out[n] += out[n - lag] * 0.45;
  }
  let peak = 1e-6;
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(out[n]));
  const g = ((0.3 + 0.7 * vel) / peak) * 0.7;
  const att = Math.floor(sr * 0.001);
  for (let n = 0; n < N; n++) out[n] *= g * (n < att ? n / att : 1) * (n > N - 2000 ? (N - n) / 2000 : 1);
  return out;
}

export class Drums extends Instrument {
  constructor(ac, o) {
    super(ac, o);
    this.kind = o.kind ?? 'taiko';
    this.rr = 0;
  }

  _buf(kind, m, vb, variant) {
    const v = [0.4, 0.7, 1][vb];
    const tuned = kind === 'timpani' || kind === 'tom' || kind === 'taiko' || kind === 'frame';
    const f = tuned && m ? 440 * Math.pow(2, (m - 69) / 12) : undefined;
    const key = `drum:${kind}:${tuned && m ? m : 0}:${vb}:${variant}`;
    return sample(this.ac, key, (sr) => {
      if (KIT[kind]) {
        const spec = KIT[kind](f);
        // Round-robin: tiny tuning / decay jitter per variant.
        spec.freq *= 1 + (variant - 1) * 0.012;
        return modal(sr, { ...spec, vel: v, seed: variant * 101 + vb * 7 + (m ?? 0) });
      }
      return metal(sr, kind, v, variant * 31 + vb);
    });
  }

  /** Pre-render the sample buffers a note will need (idle-time cache warming). */
  warm(m, vel = 0.8, opts = {}, all = false) {
    const kind = opts.kind ?? this.kind;
    const vbs = all ? [0, 1, 2] : [vel < 0.45 ? 0 : vel < 0.78 ? 1 : 2];
    const out = [];
    for (const vb of vbs) for (let variant = 0; variant < 3; variant++) out.push(() => this._buf(kind, m, vb, variant));
    return out;
  }

  play(t, m, dur, vel = 0.8, opts = {}) {
    const kind = opts.kind ?? this.kind;
    const vb = vel < 0.45 ? 0 : vel < 0.78 ? 1 : 2;
    const variant = this.rr++ % 3;
    const buf = this._buf(kind, m, vb, variant);
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const g = this.ac.createGain();
    g.gain.value = 0.35 + 0.65 * vel;
    if (opts.choke) {
      g.gain.setValueAtTime(g.gain.value, t + opts.choke);
      g.gain.setTargetAtTime(0, t + opts.choke, 0.03);
    }
    src.connect(g).connect(this.voicePan(opts.pan));
    src.start(t);
    src.stop(t + buf.duration);
  }

  /** Roll: many soft strokes swelling from v0 to v1 over `dur` seconds. */
  roll(t, m, dur, v0 = 0.3, v1 = 0.9, opts = {}) {
    const rate = opts.rate ?? 14;
    const n = Math.max(2, Math.floor(dur * rate));
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      this.play(t + i / rate + (i ? this.rng.range(-0.004, 0.004) : 0), m, 0.1, v0 + (v1 - v0) * k * k, { ...opts, pan: (opts.pan ?? 0) + (i % 2 ? 0.05 : -0.05) });
    }
  }
}
