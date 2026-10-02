import { AudioRng } from '../core/rng.js';

/**
 * Offline (pure JS) synthesis of sample buffers: physical-modelling plucks
 * (Karplus–Strong with fractional tuning, pluck position, frequency-dependent
 * loss) and modal drums. Everything returns Float32Arrays so it can be cached
 * per sample rate and turned into AudioBuffers on any (Offline)AudioContext.
 */

/**
 * Extended Karplus–Strong string.
 * @param {number} sr
 * @param {object} o
 * @param {number} o.freq   fundamental (Hz)
 * @param {number} o.dur    seconds rendered
 * @param {number} o.t60    decay time of the fundamental (s)
 * @param {number} [o.bright] 0 dark … 1 bright (loss-filter blend)
 * @param {number} [o.pos]  pluck position 0..0.5 (0.5 = mellow middle, 0.1 = nasal bridge)
 * @param {number} [o.vel]  0..1
 * @param {number} [o.seed]
 * @param {number} [o.pick] amount of pick/nail transient
 */
export function ksString(sr, o) {
  const rng = new AudioRng(o.seed ?? 1);
  const N = Math.ceil(sr * o.dur);
  const out = new Float32Array(N);
  const vel = o.vel ?? 0.7;
  const bright = o.bright ?? 0.5;
  // Loss filter y = s*x[n] + (1-s)*x[n-1] has delay (1-s); s = 0.5 → classic.
  const s = 0.5 + bright * 0.42; // 0.5 (dark) .. 0.92 (bright)
  const period = sr / o.freq;
  const filtDelay = 1 - s;
  const total = period - filtDelay;
  const L = Math.max(2, Math.floor(total - 0.1));
  const frac = total - L; // allpass fractional delay
  const C = (1 - frac) / (1 + frac);
  // Per-period loop gain from T60 (fundamental); highs additionally die via loss filter.
  const g = Math.pow(10, -3 / (o.freq * o.t60));
  // Excitation: velocity-shaped noise, comb-filtered by pluck position.
  const exc = new Float32Array(L);
  let lp = 0;
  const a = 0.15 + 0.8 * vel * (0.4 + bright * 0.6);
  for (let i = 0; i < L; i++) {
    lp += a * (rng.next() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const P = Math.max(1, Math.round(L * (o.pos ?? 0.25)));
  const ex2 = new Float32Array(L);
  for (let i = 0; i < L; i++) ex2[i] = exc[i] - (i >= P ? exc[i - P] : 0) * 0.9;
  // Remove DC from excitation.
  let mean = 0;
  for (let i = 0; i < L; i++) mean += ex2[i];
  mean /= L;
  const buf = new Float32Array(L);
  for (let i = 0; i < L; i++) buf[i] = ex2[i] - mean;
  let idx = 0;
  let prevX = 0;
  let apX = 0;
  let apY = 0;
  let dcX = 0;
  let dcY = 0;
  const pick = (o.pick ?? 0.3) * vel;
  for (let n = 0; n < N; n++) {
    const x = buf[idx];
    // loss filter
    const y = g * (s * x + (1 - s) * prevX);
    prevX = x;
    // allpass fractional delay
    const ap = C * y + apX - C * apY;
    apX = y;
    apY = ap;
    buf[idx] = ap;
    idx = idx + 1 === L ? 0 : idx + 1;
    // DC blocker on output
    dcY = x - dcX + 0.995 * dcY;
    dcX = x;
    out[n] = dcY;
  }
  // Pick transient: a few ms of bright noise.
  const pn = Math.floor(sr * 0.004);
  for (let n = 0; n < pn && n < N; n++) out[n] += (rng.next() * 2 - 1) * pick * 0.35 * (1 - n / pn);
  // Normalise to velocity loudness.
  let peak = 1e-6;
  for (let n = 0; n < Math.min(N, sr * 0.1); n++) peak = Math.max(peak, Math.abs(out[n]));
  const gain = (0.25 + 0.75 * vel) / peak * 0.6;
  // Gentle end fade so cached buffers never click when truncated.
  const fade = Math.floor(sr * 0.05);
  for (let n = 0; n < N; n++) out[n] *= gain * (n > N - fade ? (N - n) / fade : 1);
  return out;
}

/**
 * Modal membrane / bar: a sum of exponentially decaying partials plus a
 * filtered-noise strike, with an optional downward pitch glide (tension drop).
 * @param {number} sr
 * @param {object} o
 * @param {number} o.freq
 * @param {number[]} o.ratios
 * @param {number[]} o.amps
 * @param {number[]} o.decays  seconds (e-folding)
 * @param {number} o.dur
 * @param {number} [o.glide]   fractional pitch drop over the first 80 ms (0.1 = 10%)
 * @param {number} [o.noise]   strike noise level
 * @param {number} [o.noiseDecay]
 * @param {number} [o.noiseLp] 0..1 noise lowpass coefficient
 * @param {number} [o.vel]
 * @param {number} [o.seed]
 */
export function modal(sr, o) {
  const rng = new AudioRng(o.seed ?? 3);
  const N = Math.ceil(sr * o.dur);
  const out = new Float32Array(N);
  const vel = o.vel ?? 0.8;
  const glide = o.glide ?? 0;
  for (let p = 0; p < o.ratios.length; p++) {
    const f0 = o.freq * o.ratios[p];
    if (f0 > sr * 0.45) continue;
    const amp = o.amps[p] * (p === 0 ? 1 : 0.6 + 0.4 * vel);
    const dec = o.decays[p];
    let ph = rng.next() * 0.2;
    // Running multipliers instead of exp() per sample, and stop once the partial is inaudible.
    let env = amp;
    const kd = Math.exp(-1 / (sr * dec));
    let gl = glide;
    const kg = Math.exp(-1 / (sr * 0.08));
    const floor = amp * 1e-5;
    const inv = 1 / sr;
    for (let n = 0; n < N && env > floor; n++) {
      ph += f0 * (1 + gl) * inv;
      gl *= kg;
      out[n] += Math.sin(6.283185307179586 * ph) * env;
      env *= kd;
    }
  }
  const nl = o.noise ?? 0.3;
  if (nl > 0) {
    const nd = o.noiseDecay ?? 0.03;
    const a = o.noiseLp ?? 0.3;
    let lp = 0;
    const M = Math.min(N, Math.ceil(sr * nd * 8));
    let env = nl * vel * 3;
    const kd = Math.exp(-1 / (sr * nd));
    for (let n = 0; n < M; n++) {
      lp += a * (rng.next() * 2 - 1 - lp);
      out[n] += lp * env;
      env *= kd;
    }
  }
  // Soft attack (1 ms) to kill the step discontinuity, normalise.
  const att = Math.floor(sr * 0.0008);
  for (let n = 0; n < att; n++) out[n] *= n / att;
  let peak = 1e-6;
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(out[n]));
  const g = (0.3 + 0.7 * vel) / peak * 0.8;
  const fade = Math.floor(sr * 0.04);
  for (let n = 0; n < N; n++) out[n] *= g * (n > N - fade ? (N - n) / fade : 1);
  return out;
}

/** Simple coloured noise. kind: white | pink | brown */
export function noiseData(sr, seconds, kind = 'white', seed = 11) {
  const rng = new AudioRng(seed);
  const N = Math.ceil(sr * seconds);
  const out = new Float32Array(N);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let n = 0; n < N; n++) {
    const w = rng.next() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[n] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (kind === 'brown') {
      br = (br + 0.02 * w) / 1.02;
      out[n] = br * 3.5;
    } else out[n] = w;
  }
  // Crossfade the loop seam so looped noise never clicks.
  const xf = Math.floor(sr * 0.05);
  for (let i = 0; i < xf; i++) {
    const a = i / xf;
    out[i] = out[i] * a + out[N - xf + i] * (1 - a);
  }
  return out.subarray(0, N - xf);
}

/**
 * Glottal source for creature and party voices: a Rosenberg glottal-flow
 * pulse train, differentiated (lip radiation), with everything that makes a
 * throat sound alive rather than a clean harmonic ladder —
 *   jitter   per-period pitch scatter (1–3 %),
 *   shimmer  per-period amplitude scatter,
 *   walk     a slow random walk of the pitch around the written contour,
 *   sub      subharmonic / period doubling (alternate periods long and weak:
 *            the f0/2 growl of orcs, ogres, trolls),
 *   breath   aspiration noise, louder while the folds are open (pulsed with
 *            the voice, as in real breathy phonation),
 *   vib      [rate Hz, depth fraction] vibrato/tremor.
 * Returns mono samples (DC-blocked, RMS-normalised to ~0.35).
 * @param {number} sr
 * @param {{dur:number, contour:number[][], jitter?:number, shimmer?:number, walk?:number, sub?:number, breath?:number, vib?:number[], open?:number, seed?:number}} o
 */
export function glottal(sr, o) {
  const rng = new AudioRng(o.seed ?? 7);
  const dur = o.dur;
  const N = Math.max(16, Math.ceil(sr * dur));
  const out = new Float32Array(N);
  const c = o.contour;
  const f0At = (k) => {
    if (k <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (k <= c[i][0]) return c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * (k - c[i - 1][0])) / Math.max(1e-6, c[i][0] - c[i - 1][0]);
    return c[c.length - 1][1];
  };
  const jit = o.jitter ?? 0.015;
  const shim = o.shimmer ?? 0.08;
  const walkSd = o.walk ?? 0.006;
  const sub = o.sub ?? 0;
  const breath = o.breath ?? 0;
  const openQ = o.open ?? 0.6;
  const vib = o.vib;
  let walk = 0;
  let n = 0;
  let period = 0;
  let prevFlow = 0;
  let lp = 0;
  while (n < N) {
    const t = n / sr;
    walk = walk * 0.97 + rng.gauss(walkSd);
    let f = f0At(t / dur) * (1 + walk) * (1 + rng.gauss(jit));
    if (vib) f *= 1 + vib[1] * Math.sin(6.283185307179586 * vib[0] * t);
    let P = Math.max(4, sr / Math.max(20, f));
    let amp = Math.max(0.2, 1 + rng.gauss(shim));
    if (sub > 0 && period % 2 === 1) {
      P *= 1 + sub * 0.35;
      amp *= 1 - sub * 0.55;
    }
    const To = P * openQ;
    const Tp = To * 0.68;
    const Tn = To - Tp;
    // Larger periods give a bigger flow pulse; scale the derivative so loudness is pitch-independent.
    const scale = (P / 60) * amp;
    const end = Math.min(N, n + Math.round(P));
    for (let i = 0; n < end; i++, n++) {
      let flow = 0;
      if (i < Tp) flow = 0.5 * (1 - Math.cos((Math.PI * i) / Tp));
      else if (i < To) flow = Math.cos((Math.PI * (i - Tp)) / (2 * Tn));
      let v = (flow - prevFlow) * scale;
      prevFlow = flow;
      if (breath > 0) {
        lp += 0.55 * (rng.next() * 2 - 1 - lp);
        v += lp * breath * (0.25 + flow) * 0.3;
      }
      out[n] = v;
    }
    period++;
  }
  // DC blocker, then RMS normalisation and click-free edges.
  let x1 = 0;
  let y1 = 0;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const y = out[i] - x1 + 0.995 * y1;
    x1 = out[i];
    y1 = y;
    out[i] = y;
    sum += y * y;
  }
  const g = 0.35 / Math.sqrt(sum / N + 1e-12);
  const fi = Math.min(N >> 2, Math.floor(sr * 0.003));
  const fo = Math.min(N >> 2, Math.floor(sr * 0.012));
  for (let i = 0; i < N; i++) out[i] *= g * Math.min(1, i / Math.max(1, fi), (N - i) / Math.max(1, fo));
  return out;
}
