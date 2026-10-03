import { AudioRng } from '../core/rng.js';
import { harmonic, WAVE_PARTIALS } from './spectra.js';

/**
 * Pure-JS renderer for short orchestral notes (spiccato strokes, brass stabs).
 *
 * Why: a 16th-note ostinato played live builds a dozen audio nodes per stroke
 * (oscillators, panners, swept filters, noise) and every one of them sits in
 * the render graph from the moment it is scheduled (1.8 s of lookahead) until
 * it ends — the single biggest load on the audio thread in a battle. Rendered
 * once into a cached buffer (per pitch × velocity layer × round-robin take),
 * a stroke costs one buffer source and one gain.
 *
 * The source is the same harmonic spectrum the live instrument uses
 * (spectra.js) read from a band-limited single-cycle table, through the same
 * swept two-pole lowpass, envelope, rosin / breath burst and (brass) soft
 * saturation — so cached and live notes of one instrument match.
 */

const TABLE = 2048;
const tables = new Map();
const norms = new Map();

/** Peak of the full-band waveform (Chrome normalises a PeriodicWave by it). */
function normOf(name) {
  let n = norms.get(name);
  if (n) return n;
  const N = 4096;
  let peak = 1e-6;
  for (let i = 0; i < N; i++) {
    const x = (i / N) * Math.PI * 2;
    let v = 0;
    for (let h = 1; h < WAVE_PARTIALS; h++) v += harmonic(name, h) * Math.sin(h * x);
    peak = Math.max(peak, Math.abs(v));
  }
  norms.set(name, (n = 1 / peak));
  return n;
}

/** Band-limited single cycle (harmonics 1..maxH) of a named spectrum. */
function table(name, maxH) {
  const k = `${name}|${maxH}`;
  let t = tables.get(k);
  if (t) return t;
  t = new Float32Array(TABLE + 1);
  const amps = [];
  for (let h = 1; h <= maxH; h++) amps.push(harmonic(name, h));
  for (let h = 1; h <= maxH; h++) {
    const a = amps[h - 1];
    if (!a) continue;
    const w = (Math.PI * 2 * h) / TABLE;
    // Rotation recurrence: cheap and exact enough for a 2048-point table.
    const c = Math.cos(w);
    const s = Math.sin(w);
    let x = 1;
    let y = 0;
    for (let i = 0; i < TABLE; i++) {
      t[i] += a * y;
      const x1 = x * c - y * s;
      y = x * s + y * c;
      x = x1;
    }
  }
  const g = normOf(name);
  for (let i = 0; i < TABLE; i++) t[i] *= g;
  t[TABLE] = t[0];
  tables.set(k, t);
  if (tables.size > 400) tables.delete(tables.keys().next().value);
  return t;
}

/** RBJ biquad coefficients (normalised) for lowpass / bandpass. */
function coefs(type, f, q, sr) {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cw = Math.cos(w0);
  const al = Math.sin(w0) / (2 * q);
  const a0 = 1 + al;
  if (type === 'bandpass') return [al / a0, 0, -al / a0, (-2 * cw) / a0, (1 - al) / a0];
  return [(1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, (-2 * cw) / a0, (1 - al) / a0];
}

/** Web Audio's Q for lowpass is in dB (resonance); convert to the RBJ linear Q. */
const lpQ = (qdb) => Math.pow(10, qdb / 20);

/**
 * @param {number} sr
 * @param {object} o
 * @param {string} o.wave           spectrum name (spectra.js)
 * @param {number} o.freq           Hz
 * @param {number} o.dur            seconds rendered
 * @param {{det:number, onset:number, gain:number, pan:number}[]} o.players
 * @param {(t:number)=>number} o.amp      amplitude envelope
 * @param {(t:number)=>number} o.cutoff   lowpass cutoff (Hz) over time
 * @param {number} [o.q]            lowpass Q (Web Audio dB units)
 * @param {number} [o.pole2]        second lowpass pole at cutoff × pole2 (0 = none)
 * @param {number} [o.scoop]        cents the pitch starts away from the note
 * @param {number} [o.scoopTime]    seconds to reach the pitch
 * @param {number} [o.playerAttack] seconds of each player's onset ramp
 * @param {{dark:number, pre:number, bright:number, k:number}} [o.clip] brass blare (dark + tanh-saturated paths)
 * @param {{f:number, q:number, env:(t:number)=>number, post?:boolean}} [o.noise] band-passed noise (rosin, breath)
 * @param {number} [o.seed]
 * @returns {Float32Array[]} [left, right]
 */
export function renderNote(sr, o) {
  const N = Math.ceil(sr * o.dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const rng = new AudioRng(o.seed ?? 1);
  const maxH = Math.max(1, Math.min(WAVE_PARTIALS - 1, Math.floor((sr * 0.45) / (o.freq * 1.04))));
  const tab = table(o.wave, maxH);
  const scoop = o.scoop ?? 0;
  const sT = Math.max(1e-3, o.scoopTime ?? 0.06);
  const pa = o.playerAttack ?? 0.01;
  // Players: each its own detune, onset and seat; mixed mono for the filter,
  // then the filtered sum is split back to the seats by each player's share.
  const players = o.players;
  const bufs = players.map(() => new Float32Array(N));
  players.forEach((p, k) => {
    const out = bufs[k];
    let ph = rng.next() * TABLE;
    const n0 = Math.floor(p.onset * sr);
    const inc0 = (o.freq * p.det * TABLE) / sr;
    for (let i = n0; i < N; i++) {
      const t = (i - n0) / sr;
      const r = scoop && t < sT ? Math.pow(2, (scoop / 1200) * (1 - t / sT)) : 1;
      ph += inc0 * r;
      if (ph >= TABLE) ph -= TABLE * Math.floor(ph / TABLE);
      const j = ph | 0;
      const fr = ph - j;
      const v = tab[j] + (tab[j + 1] - tab[j]) * fr;
      out[i] = v * p.gain * Math.min(1, t / pa);
    }
  });
  // Players sharing a seat share the filter (the brass section is one mono
  // chain, seated once); players on different seats are filtered apart so the
  // stereo image of the section survives.
  const seats = new Map();
  players.forEach((p, k) => {
    const key = Math.round(p.pan * 1000);
    if (!seats.has(key)) seats.set(key, { pan: p.pan, buf: new Float32Array(N), first: seats.size === 0 });
    const s = seats.get(key).buf;
    const b = bufs[k];
    for (let i = 0; i < N; i++) s[i] += b[i];
  });
  const noise = o.noise;
  const addNoise = (dst, gain) => {
    const [b0, b1, b2, a1, a2] = coefs('bandpass', noise.f, noise.q, sr);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < N; i++) {
      const x = rng.next() * 2 - 1;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      dst[i] += y * noise.env(i / sr) * gain;
    }
  };
  const q = lpQ(o.q ?? 0.5);
  const poles = o.pole2 ? [1, o.pole2] : [1];
  const nSeats = seats.size;
  for (const seat of seats.values()) {
    const x0 = seat.buf;
    // Breath / rosin is shared by the section: split across the seats.
    if (noise && !noise.post) addNoise(x0, 1 / nSeats);
    // Swept lowpass (one or two poles), coefficients per 32 samples.
    for (const k of poles) {
      let s1 = 0;
      let s2 = 0;
      let c = null;
      for (let i = 0; i < N; i++) {
        if ((i & 31) === 0) c = coefs('lowpass', o.cutoff(i / sr) * k, k === 1 ? q : lpQ(0.5), sr);
        const x = x0[i];
        // Transposed direct form II.
        const y = c[0] * x + s1;
        s1 = c[1] * x - c[3] * y + s2;
        s2 = c[2] * x - c[4] * y;
        x0[i] = y;
      }
    }
    // Brass blare: the clean path fades as the saturated one comes in.
    if (o.clip) {
      const { dark, pre, bright, k } = o.clip;
      const tk = Math.tanh(k);
      for (let i = 0; i < N; i++) {
        const x = Math.max(-1, Math.min(1, x0[i] * pre));
        x0[i] = x0[i] * dark + (Math.tanh(k * x) / tk) * bright;
      }
    }
    if (noise && noise.post) addNoise(x0, 1 / nSeats);
    // Envelope and seat (equal-power pan, as a StereoPanner on a mono input).
    const th = ((Math.max(-1, Math.min(1, seat.pan)) + 1) * Math.PI) / 4;
    const gl = Math.cos(th);
    const gr = Math.sin(th);
    for (let i = 0; i < N; i++) {
      const v = x0[i] * o.amp(i / sr);
      L[i] += v * gl;
      R[i] += v * gr;
    }
  }
  // Soft end (no click at the buffer's edge).
  const fade = Math.min(N, Math.floor(sr * 0.01));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    L[N - 1 - i] *= g;
    R[N - 1 - i] *= g;
  }
  return [L, R];
}
