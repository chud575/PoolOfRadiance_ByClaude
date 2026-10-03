import { kbq } from '../instruments/base.js';
import { noiseBuffer, noiseOffset, sample } from '../dsp/bank.js';
import { AudioRng } from '../core/rng.js';

/**
 * The procedural SFX library. Each entry is `(fx, t, opts) => void` where `fx`
 * is a toolkit bound to the destination bus (see toolkit.js) and `t` an
 * absolute AudioContext time. Names are what scenes pass to `audio.sfx()`.
 */

/** One-shots with sharp transients that get their own peak limiter (Fx `limit`). */
export const LIMITED = /^(hit|hit_armor|hit_bone|crit|shield|parry|block|bite|claw|arrow_hit|death|spell_shock|spell_fire|spell_lightning|spell_cone|spell_turn|trap|door|door_close|door_locked|chest|vox_(dragon|ogre|troll|giant)(_die)?)$/;
/** Large events that get a stereo spread (Fx `wide`): blasts, storms, collapses, the biggest roars. */
export const WIDE = /^(spell_fire|spell_lightning|spell_cone|spell_cloud|spell_turn|spell_holy|trap|levelup|vox_(dragon|giant)(_die)?)$/;

// ------------------------------------------------------------------ footsteps
/**
 * One footfall = heel strike, roll, toe-off — all contact noise, no tonal
 * "kick". Each surface has its own contact band, resonance and granular
 * texture: dungeon flagstones are one hard slab (a bright click and a dull
 * stone "thock"), cobbles are loose stones that rock and knock against each
 * other at their own pitches, gravel crunches, dirt pads, grass swishes,
 * boards boom and creak, water splashes.
 */
function foot(fx, t, surface, v = 1, pan = 0) {
  const r = fx.rng;
  const p = { pan };
  const toe = t + r.range(0.055, 0.09);
  // Shoe leather on the ground (shared by every surface): a soft broadband contact.
  const contact = (tt, peak, f, q = 0.9, d = 0.025) => fx.burst(tt, { a: 0.002, dur: d, peak: peak * v, filters: [{ type: 'bandpass', f: f * r.range(0.88, 1.12), q }], ...p });
  // Weight landing: low-passed noise (body of the step), never a sine.
  const weight = (tt, peak, f = 320, d = 0.06) => fx.burst(tt, { kind: 'pink', a: 0.004, dur: d, peak: peak * v, filters: [{ type: 'lowpass', f: f * r.range(0.9, 1.1) }, { type: 'highpass', f: 70 }], ...p });
  switch (surface) {
    case 'gravel':
    case 'rubble':
      weight(t, 0.22, 420, 0.07);
      fx.grains(t, { count: 22, spread: 0.1, curve: 1.6, fLo: 1300, fHi: 6500, peak: 0.2 * v, q: 2.5, ...p });
      fx.grains(toe, { count: 14, spread: 0.09, curve: 1.4, fLo: 1800, fHi: 7500, peak: 0.13 * v, q: 2.5, ...p });
      break;
    case 'dirt':
      weight(t, 0.32, 380, 0.08);
      contact(t, 0.08, 900, 0.7, 0.04);
      fx.grains(t + 0.012, { count: 7, spread: 0.07, fLo: 700, fHi: 2600, peak: 0.07 * v, ...p });
      weight(toe, 0.14, 500, 0.05);
      break;
    case 'grass':
      fx.burst(t, { a: 0.025, dur: 0.15, peak: 0.1 * v, filters: [{ type: 'bandpass', f: 3600 * r.range(0.8, 1.2), q: 0.7 }], ...p });
      fx.grains(t, { count: 12, spread: 0.13, fLo: 2500, fHi: 8000, peak: 0.045 * v, ...p });
      weight(t + 0.01, 0.2, 300, 0.07);
      fx.burst(toe, { a: 0.02, dur: 0.1, peak: 0.06 * v, filters: [{ type: 'bandpass', f: 4200, q: 0.8 }], ...p });
      break;
    case 'wood': {
      // Boards: a hollow boom from the joists, board modes, the occasional creak.
      const bf = r.range(165, 210);
      fx.modes(t, { f: bf, ratios: [1, 2.32, 3.9], decays: [0.09, 0.05, 0.03], amps: [1, 0.45, 0.2], peak: 0.24 * v, pan });
      contact(t, 0.16, 1400, 0.8, 0.02);
      weight(t, 0.2, 260, 0.08);
      fx.modes(toe, { f: bf * r.range(1.15, 1.35), ratios: [1, 2.32], decays: [0.06, 0.03], amps: [1, 0.4], peak: 0.12 * v, pan });
      contact(toe, 0.09, 1900, 0.8, 0.015);
      if (r.chance(0.2)) creak(fx, t + 0.04, { rate: [35, 55], dur: 0.25, f: 900, peak: 0.05 * v, pan });
      break;
    }
    case 'water':
      fx.burst(t, { dur: 0.22, peak: 0.3 * v, filters: [{ type: 'bandpass', f: 1300, f1: 600, q: 1.2 }], ...p });
      weight(t, 0.12, 300, 0.1);
      for (let i = 0; i < 5; i++) fx.tone(t + r.range(0.02, 0.2), { f: r.range(500, 1300), f1: r.range(1400, 2200), dur: 0.035, peak: 0.04 * v, ...p });
      fx.burst(toe + 0.04, { a: 0.03, dur: 0.18, peak: 0.12 * v, filters: [{ type: 'bandpass', f: 2200, f1: 900, q: 1 }], ...p });
      break;
    case 'cobble': {
      // Loose cobbles: the heel lands on one stone, which rocks and knocks its
      // neighbour; the toe finds another stone at its own pitch.
      contact(t, 0.2, 2100, 1, 0.018);
      weight(t, 0.16, 520, 0.045);
      fx.modes(t + 0.002, { f: r.range(780, 1250), ratios: [1, 2.1, 3.4], decays: [0.03, 0.018, 0.01], amps: [1, 0.5, 0.25], peak: 0.13 * v, pan, jitter: 0.04 });
      fx.modes(t + r.range(0.012, 0.03), { f: r.range(1300, 2100), ratios: [1, 2.3], decays: [0.02, 0.01], amps: [1, 0.4], peak: 0.07 * v, pan, jitter: 0.04 });
      fx.grains(t + 0.004, { count: 6, spread: 0.05, fLo: 2500, fHi: 6000, peak: 0.08 * v, q: 3, ...p });
      contact(toe, 0.12, 2600, 1.1, 0.014);
      fx.modes(toe, { f: r.range(900, 1600), ratios: [1, 2.2], decays: [0.022, 0.012], amps: [1, 0.4], peak: 0.07 * v, pan, jitter: 0.04 });
      break;
    }
    case 'stone':
    default: {
      // Dressed flagstones: one big slab — a sharp hard-sole click on a dead,
      // heavy stone body; a scuff of grit as the foot rolls; a lighter toe tap.
      contact(t, 0.26, 3000, 1.3, 0.012);
      fx.burst(t, { a: 0.002, dur: 0.04, peak: 0.2 * v, filters: [{ type: 'bandpass', f: 230 * r.range(0.9, 1.1), q: 2.2 }], ...p });
      weight(t, 0.1, 700, 0.03);
      fx.burst(t + 0.02, { a: 0.015, dur: 0.05, peak: 0.035 * v, filters: [{ type: 'bandpass', f: 5200, q: 1.2 }], ...p });
      contact(toe, 0.13, 3600, 1.4, 0.009);
      fx.burst(toe, { a: 0.002, dur: 0.025, peak: 0.08 * v, filters: [{ type: 'bandpass', f: 300, q: 2 }], ...p });
    }
  }
}

/** Stick–slip creak: a train of resonant micro-clicks at a gliding rate. */
function creak(fx, t, { rate = [40, 90], dur = 0.5, f = 1000, q = 14, peak = 0.12, pan } = {}) {
  let tt = t;
  while (tt < t + dur) {
    const k = (tt - t) / dur;
    const rr = rate[0] + (rate[1] - rate[0]) * Math.sin(k * Math.PI);
    fx.burst(tt, { dur: 0.012, peak: peak * 4 * (0.6 + 0.4 * Math.sin(k * Math.PI)) * fx.rng.range(0.6, 1), filters: [{ type: 'bandpass', f: f * (1 + 0.15 * Math.sin(k * 5)), q }], pan });
    tt += 1 / rr * fx.rng.range(0.85, 1.15);
  }
}

/** Party marching: several feet, slightly out of step, plus kit jingle. */
function partyStep(fx, t, o) {
  const s = o.surface ?? 'stone';
  const r = fx.rng;
  foot(fx, t, s, 1, -0.05);
  foot(fx, t + 0.07 + r.range(0, 0.04), s, 0.6, 0.25);
  foot(fx, t + 0.15 + r.range(0, 0.05), s, 0.45, -0.3);
  fx.grains(t + 0.02, { count: 5, spread: 0.16, fLo: 5000, fHi: 9500, peak: 0.025, q: 6 });
}

// ------------------------------------------------------------------ metal & wood helpers
const clink = (fx, t, f, peak = 0.1, decay = 1, pan) => fx.modes(t, { f, ratios: [1, 2.31, 3.94, 5.1], decays: [0.14, 0.08, 0.05, 0.03], amps: [1, 0.6, 0.35, 0.2], peak, decay, pan, jitter: 0.01 });
const knock = (fx, t, f = 300, peak = 0.3, pan) => {
  fx.modes(t, { f, ratios: [1, 2.3, 3.7], decays: [0.08, 0.04, 0.02], amps: [1, 0.5, 0.2], peak, pan });
  fx.burst(t, { dur: 0.02, peak: peak * 0.6, filters: [{ type: 'bandpass', f: f * 4, q: 1 }], pan });
};
/** A heavy body meeting the floor: low noise weight + a dull modal thump of the boards/flags. */
const thud = (fx, t, peak = 0.5, f = 85) => {
  fx.burst(t, { kind: 'brown', a: 0.003, dur: 0.22, peak: peak * 1.1, filters: [{ type: 'lowpass', f: f * 4, f1: f * 2 }, { type: 'highpass', f: 40 }] });
  fx.modes(t, { f: f * 1.6, ratios: [1, 1.7, 2.6], decays: [0.12, 0.07, 0.04], amps: [1, 0.5, 0.25], peak: peak * 0.35 });
  fx.burst(t, { dur: 0.12, peak: peak * 0.6, filters: [{ type: 'lowpass', f: 380 }] });
};

/**
 * An arcing swish: air pushed aside by a blade or limb. The level follows a
 * bell (swelling to the closest point of the arc at ~60 %, then falling away)
 * while a band of noise sweeps up to f1 and back down (the doppler of the
 * arc), plus a thin high "edge" layer that peaks with it — 150–300 ms, not a tick.
 */
function whoosh(fx, t, { f0 = 500, f1 = 2000, dur = 0.22, peak = 0.3, q = 1.4, pan } = {}) {
  const ac = fx.ac;
  const len = Math.max(0.12, dur * 1.25);
  const N = 32;
  const bell = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    const k = x < 0.6 ? x / 0.6 : 1 - (x - 0.6) / 0.4;
    bell[i] = Math.max(0.0001, Math.pow(Math.sin((Math.PI / 2) * Math.max(0, k)), 2.2)) * peak * 2.6;
  }
  const layer = (lo, hi, qq, amp, kind) => {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, kind);
    const bp = kbq(ac);
    bp.type = 'bandpass';
    bp.Q.value = qq;
    bp.frequency.setValueAtTime(lo * fx.pitch, t);
    bp.frequency.exponentialRampToValueAtTime(hi * fx.pitch, t + len * 0.6);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, lo * 1.3 * fx.pitch), t + len);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(bell.map((v) => v * amp), t, len);
    src.connect(bp).connect(g).connect(fx._dest({ pan }));
    src.start(t, noiseOffset(fx.rng, 2));
    src.stop(t + len + 0.02);
  };
  layer(f0, f1, q, 1, 'pink');
  layer(f1 * 1.4, Math.min(12000, f1 * 3), 2.5, 0.25, 'white');
}

function metalClang(fx, t, peak = 0.25, f = 820) {
  fx.modes(t, { f, ratios: [1, 2.08, 2.79, 3.9, 5.43, 6.1, 7.3], decays: [0.6, 0.4, 0.32, 0.22, 0.16, 0.11, 0.08], amps: [1, 0.7, 0.6, 0.4, 0.3, 0.2, 0.1], peak, jitter: 0.03 });
  fx.burst(t, { dur: 0.04, peak: peak * 1.4, filters: [{ type: 'highpass', f: 2500 }] });
}

// ------------------------------------------------------------------ spells
function shimmer(fx, t, { notes = [880, 1108, 1318, 1760, 2217, 2637], step = 0.05, dur = 0.6, peak = 0.06 } = {}) {
  notes.forEach((f, i) => fx.tone(t + i * step, { f, dur, peak, vib: [6, 0.003], pan: (i / notes.length - 0.5) * 0.8 }));
}

function bell(fx, t, f, peak = 0.2, decay = 1) {
  fx.modes(t, { f, ratios: [0.5, 1, 1.19, 1.5, 2, 2.5, 2.66, 3.01], decays: [3, 2.4, 2, 1.6, 1.3, 1, 0.9, 0.7], amps: [0.5, 1, 0.6, 0.4, 0.5, 0.25, 0.2, 0.15], peak, decay });
}

/** Frequency ratio that moves a figure written in `base` (pitch class) to the score's `key` (nearest way). */
export function keyRatio(key, base = 2) {
  if (key === undefined || key === null) return 1;
  const d = ((((key - base) % 12) + 18) % 12) - 6;
  return Math.pow(2, d / 12);
}

function chord(fx, t, freqs, { dur = 1.2, peak = 0.08, vowel = 'a', a = 0.3, k = 1 } = {}) {
  for (const f0 of freqs) {
    const f = f0 * k;
    fx.voice(t, { dur, a, release: 0.6, peak, contour: [[0, f], [1, f]], vowels: [vowel], voices: 2, vib: [5, 0.006], breath: 0.03, jitter: 0.004, shimmer: 0.03, walk: 0.002 });
  }
}

function explosion(fx, t, size = 1) {
  fx.tone(t, { f: 70, f1: 28, dur: 0.9 * size, peak: 0.75 });
  fx.burst(t, { kind: 'brown', dur: 1.3 * size, peak: 0.7, filters: [{ type: 'lowpass', f: 700, f1: 140, dt: 1 }] });
  fx.burst(t, { kind: 'pink', dur: 0.5, peak: 0.35, filters: [{ type: 'lowpass', f: 3000, f1: 400 }] });
  fx.grains(t + 0.05, { count: Math.round(40 * size), spread: 1.6 * size, curve: 1.6, fLo: 1200, fHi: 6000, peak: 0.12, dHi: 0.012 });
}

function thunder(fx, t, peak = 0.6) {
  fx.burst(t, { kind: 'brown', a: 0.04, dur: 2.2, peak, filters: [{ type: 'lowpass', f: 500, f1: 70, dt: 2 }] });
  fx.tone(t, { f: 48, f1: 35, dur: 1.6, peak: peak * 0.6 });
  fx.burst(t + 0.4, { kind: 'brown', a: 0.3, dur: 1.4, peak: peak * 0.5, filters: [{ type: 'lowpass', f: 250 }] });
}

function zap(fx, t, dur = 0.3, peak = 0.4) {
  fx.grains(t, { count: Math.round(dur * 140), spread: dur, curve: 1.4, fLo: 1800, fHi: 9500, peak, dLo: 0.002, dHi: 0.007, q: 1.5 });
  fx.tone(t, { type: 'sawtooth', f: 62, hold: dur * 0.7, dur: dur * 0.4, peak: peak * 0.3, filters: [{ type: 'highpass', f: 700 }] });
  fx.tone(t, { type: 'square', f: 1240, f1: 300, dur: dur, peak: peak * 0.06 });
}

// ------------------------------------------------------------------ throat texture
/**
 * The non-periodic part of a big creature's voice, rendered in JS (cached per
 * take): throat rasp (band-passed noise gated by an irregular, spiky
 * modulator — vocal-fold chaos), a subharmonic growl an octave under the
 * voice whose period wanders cycle to cycle (period doubling), and saliva —
 * sparse wet clicks and bubbles. Laid under the formant voice it turns a
 * "synth vowel" into a throat.
 */
function throatData(sr, { dur, f0, rasp, sub, wet, seed }) {
  const rng = new AudioRng(seed);
  const N = Math.ceil(sr * (dur + 0.25));
  const out = new Float32Array(N);
  const rel = Math.floor(sr * 0.12);
  const att = Math.floor(sr * 0.03);
  const end = Math.floor(sr * dur);
  const env = (i) => (i < att ? i / att : i < end ? 1 : Math.max(0, 1 - (i - end) / rel));
  // Rasp: noise → two-pole band 350–1600 Hz, gated by a slow random spiky modulator.
  let b1 = 0;
  let b2 = 0;
  let lp = 0;
  let m = 0;
  const kb = Math.exp((-2 * Math.PI * 1600) / sr);
  const kh = Math.exp((-2 * Math.PI * 350) / sr);
  const km = Math.exp((-2 * Math.PI * 38) / sr);
  let hp = 0;
  for (let i = 0; i < N; i++) {
    const w = rng.next() * 2 - 1;
    b1 = (1 - kb) * w + kb * b1;
    b2 = (1 - kb) * b1 + kb * b2;
    hp = (1 - kh) * b2 + kh * hp;
    m = (1 - km) * (rng.next() * 2 - 1) + km * m;
    lp = Math.max(0, m * 9);
    out[i] += (b2 - hp) * lp * lp * rasp * env(i);
  }
  // Subharmonic growl: one pulse per two glottal periods, each period jittered (±12 %).
  if (sub > 0) {
    let i = Math.floor(rng.range(0, 0.01) * sr);
    let y = 0;
    const k = Math.exp((-2 * Math.PI * 320) / sr);
    const buf = new Float32Array(N);
    while (i < N) {
      buf[i] += rng.range(0.6, 1);
      i += Math.max(8, Math.floor((sr / (f0 / 2)) * (1 + rng.gauss(0.06))));
    }
    for (let j = 0; j < N; j++) {
      y = (1 - k) * buf[j] + k * y;
      out[j] += y * 6 * sub * env(j);
    }
  }
  // Saliva: clicks (2.5–6 kHz, 1–3 ms) and small wet bubbles (damped chirps).
  if (wet > 0) {
    let t = rng.range(0, 0.05);
    while (t < dur) {
      const i0 = Math.floor(t * sr);
      if (rng.chance(0.7)) {
        const f = rng.range(2500, 6000);
        const len = Math.floor(rng.range(0.001, 0.003) * sr);
        const a = rng.range(0.3, 1) * wet;
        for (let j = 0; j < len && i0 + j < N; j++) out[i0 + j] += Math.sin((2 * Math.PI * f * j) / sr) * a * (1 - j / len) * (rng.next() * 0.6 + 0.4);
      } else {
        const f = rng.range(280, 900);
        const len = Math.floor(rng.range(0.012, 0.03) * sr);
        const a = rng.range(0.2, 0.6) * wet;
        let ph = 0;
        for (let j = 0; j < len && i0 + j < N; j++) {
          ph += (2 * Math.PI * f * (1 + (j / len) * 0.8)) / sr;
          out[i0 + j] += Math.sin(ph) * a * Math.exp((-j / len) * 4);
        }
      }
      t += -Math.log(1 - rng.next() * 0.98) / 26;
    }
  }
  // Normalise to a fixed peak so `peak` means the same for every take.
  let pk = 1e-6;
  for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(out[i]));
  for (let i = 0; i < N; i++) out[i] /= pk;
  return out;
}

/** Lay a throat texture (rasp, growl, saliva) under a big voice at `t`. */
function throat(fx, t, { dur = 0.8, f0 = 90, peak = 0.12, rasp = 1, sub = 0.6, wet = 0.4, takes = 4 } = {}) {
  const ac = fx.ac;
  const take = Math.floor(fx.rng.next() * takes);
  const q = (x) => Math.round(x * 20) / 20;
  const key = `throat:${q(dur)}:${Math.round(f0 / 5) * 5}:${q(rasp)}:${q(sub)}:${q(wet)}:${take}`;
  const buf = sample(ac, key, (sr) => throatData(sr, { dur: q(dur), f0: Math.round(f0 / 5) * 5, rasp, sub, wet, seed: 9001 + take * 7919 + Math.round(f0) }));
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = fx.pitch;
  const g = ac.createGain();
  g.gain.value = peak;
  src.connect(g).connect(fx._dest({}));
  src.start(t);
  src.stop(t + buf.duration / fx.pitch + 0.05);
}

// ------------------------------------------------------------------ party voices
/** [pitch scale, vocal-tract (formant) scale, roughness] by race. */
const PARTY_VOICE = { human: [1, 1, 0.12], elf: [1.08, 1.05, 0.06], halfElf: [1.04, 1.03, 0.08], dwarf: [0.8, 0.88, 0.3], halfling: [1.35, 1.24, 0.08], gnome: [1.25, 1.18, 0.12], halfOrc: [0.88, 0.93, 0.38] };

function partyVox(fx, t, mode, { race = 'human', gender = 'male' } = {}) {
  const [ps, fs, rough] = PARTY_VOICE[race] ?? PARTY_VOICE.human;
  const fem = gender === 'female';
  const f0 = (fem ? 215 : 122) * ps;
  const formant = fs * (fem ? 1.17 : 1);
  const base = { formant, rough, breath: fem ? 0.2 : 0.14, roughRate: fem ? 90 : 60 };
  if (mode === 'die') {
    fx.voice(t, { ...base, dur: 0.75, a: 0.015, contour: [[0, f0 * 1.7], [0.15, f0 * 1.95], [0.6, f0 * 1.3], [1, f0 * 0.8]], vowels: ['a', 'a', 'o'], peak: 0.38 });
    fx.voice(t + 0.85, { whisper: true, dur: 0.5, vowels: ['a', 'u'], formant, peak: 0.07 });
  } else if (mode === 'hurt') {
    fx.voice(t, { ...base, dur: 0.2, a: 0.008, release: 0.08, contour: [[0, f0 * 1.55], [1, f0 * 1.1]], vowels: ['a', 'u'], peak: 0.36 });
  } else {
    fx.voice(t, { ...base, dur: 0.24, a: 0.01, release: 0.08, contour: [[0, f0 * 1.15], [0.3, f0 * 1.45], [1, f0]], vowels: ['a', 'a'], peak: 0.36 });
  }
}

// ------------------------------------------------------------------ monsters
const VOX = {
  kobold: (fx, t, m) => {
    const up = m === 'die' ? 0.8 : m === 'hurt' ? 1.25 : 1;
    for (let i = 0; i < (m === 'die' ? 1 : 2); i++) fx.voice(t + i * 0.17, { dur: m === 'die' ? 0.5 : 0.13, contour: m === 'die' ? [[0, 640], [0.3, 700], [1, 320]] : [[0, 520 * up], [0.4, 720 * up], [1, 470 * up]], vowels: ['i', 'a'], formant: 1.35, rough: 0.2, peak: 0.28, breath: 0.05 });
  },
  goblin: (fx, t, m) => {
    const n = m === 'die' ? 1 : 4;
    for (let i = 0; i < n; i++) fx.voice(t + i * 0.11, { dur: m === 'die' ? 0.6 : 0.08, contour: m === 'die' ? [[0, 400], [1, 180]] : [[0, 340 - i * 12], [1, 290 - i * 12]], vowels: ['e', 'a'], formant: 1.2, rough: 0.25, peak: 0.26 });
  },
  orc: (fx, t, m) => {
    const d = m === 'die' ? 0.9 : m === 'hurt' ? 0.3 : 0.7;
    fx.voice(t, { dur: d, contour: m === 'die' ? [[0, 150], [0.2, 160], [1, 70]] : m === 'hurt' ? [[0, 170], [1, 130]] : [[0, 105], [0.25, 140], [1, 92]], vowels: ['a', 'o'], rough: 0.5, drive: 0.5, voices: 2, breath: 0.12, peak: 0.42 });
    throat(fx, t, { dur: d, f0: m === 'attack' ? 110 : 150, peak: 0.1, rasp: 0.9, sub: m === 'attack' ? 0.5 : 0.2, wet: 0.35 });
  },
  gnoll: (fx, t, m) => {
    for (let i = 0; i < (m === 'die' ? 1 : 3); i++) fx.voice(t + i * 0.16, { dur: m === 'die' ? 0.7 : 0.12, contour: m === 'die' ? [[0, 420], [1, 160]] : [[0, 300], [0.5, 520], [1, 380]], vowels: ['i', 'a'], rough: 0.3, peak: 0.3, formant: 1.1 });
  },
  ogre: (fx, t, m) => {
    if (m === 'die') {
      // A strained cry that breaks, a sobbing groan sinking away, then the great body falls.
      fx.voice(t, { dur: 0.45, a: 0.03, contour: [[0, 105], [0.4, 135], [1, 96]], vowels: ['a', 'a'], rough: 0.6, drive: 0.5, voices: 3, formant: 0.75, breath: 0.15, peak: 0.42 });
      fx.voice(t + 0.5, { dur: 1.3, a: 0.08, contour: [[0, 92], [0.5, 70], [1, 42]], vowels: ['o', 'u', 'u'], rough: 0.8, roughRate: 35, pulse: [6.5, 0.6, 3], voices: 2, formant: 0.7, breath: 0.3, peak: 0.34 });
      throat(fx, t + 0.5, { dur: 1.3, f0: 70, peak: 0.12, rasp: 0.8, sub: 0.7, wet: 0.6 });
      thud(fx, t + 1.75, 0.6, 60);
      thud(fx, t + 1.95, 0.35, 55);
      fx.grains(t + 1.78, { count: 18, spread: 0.5, curve: 1.6, fLo: 900, fHi: 3500, peak: 0.08 });
      return;
    }
    const d = m === 'hurt' ? 0.45 : 1.1;
    fx.voice(t, { dur: d, contour: m === 'hurt' ? [[0, 95], [1, 70]] : [[0, 68], [0.3, 88], [1, 55]], vowels: ['o', 'u'], rough: 0.7, drive: 0.7, voices: 3, formant: 0.72, breath: 0.1, peak: 0.45 });
    throat(fx, t, { dur: d, f0: m === 'hurt' ? 85 : 70, peak: 0.16, rasp: 1, sub: 0.9, wet: 0.5 });
    fx.burst(t, { kind: 'brown', a: 0.1, hold: d * 0.5, dur: 0.4, peak: 0.3, filters: [{ type: 'lowpass', f: 220 }] });
  },
  troll: (fx, t, m) => {
    if (m === 'die') {
      fx.voice(t, { dur: 1.4, a: 0.02, contour: [[0, 140], [0.2, 160], [1, 55]], vowels: ['r', 'a', 'u'], rough: 0.95, roughRate: 28, drive: 0.4, voices: 2, formant: 0.85, breath: 0.25, peak: 0.36 });
      throat(fx, t, { dur: 1.4, f0: 110, peak: 0.15, rasp: 0.9, sub: 0.6, wet: 1 });
      fx.grains(t + 0.3, { count: 26, spread: 1.0, fLo: 250, fHi: 900, q: 3, peak: 0.12, dLo: 0.02, dHi: 0.06 }); // gurgle
      thud(fx, t + 1.35, 0.55, 65);
      return;
    }
    // A wet, snarling gurgle.
    fx.voice(t, { dur: m === 'hurt' ? 0.35 : 0.8, contour: m === 'hurt' ? [[0, 180], [1, 130]] : [[0, 115], [0.4, 135], [1, 95]], vowels: ['r', 'a'], rough: 0.9, roughRate: 40, drive: 0.55, voices: 2, formant: 0.85, breath: 0.2, peak: 0.4 });
    throat(fx, t, { dur: m === 'hurt' ? 0.35 : 0.8, f0: 115, peak: 0.17, rasp: 1, sub: 0.7, wet: 1 });
    fx.grains(t + 0.05, { count: 12, spread: 0.5, fLo: 250, fHi: 800, q: 3, peak: 0.08, dLo: 0.02, dHi: 0.05 });
  },
  giant: (fx, t, m) => {
    if (m === 'die') {
      fx.voice(t, { dur: 1.6, a: 0.05, contour: [[0, 110], [0.15, 125], [1, 50]], vowels: ['a', 'o', 'u'], rough: 0.4, drive: 0.3, voices: 3, formant: 0.78, breath: 0.25, peak: 0.42 });
      throat(fx, t, { dur: 1.6, f0: 90, peak: 0.1, rasp: 0.7, sub: 0.5, wet: 0.4 });
      thud(fx, t + 1.5, 0.7, 50);
      thud(fx, t + 1.7, 0.4, 48);
      return;
    }
    // A huge, almost human bellow.
    fx.voice(t, { dur: m === 'hurt' ? 0.4 : 1.0, contour: m === 'hurt' ? [[0, 130], [1, 100]] : [[0, 82], [0.3, 108], [1, 75]], vowels: ['a', 'a', 'o'], rough: 0.35, drive: 0.4, voices: 3, formant: 0.8, breath: 0.15, peak: 0.45 });
    throat(fx, t, { dur: m === 'hurt' ? 0.4 : 1.0, f0: 90, peak: 0.12, rasp: 0.8, sub: 0.6, wet: 0.3 });
  },
  skeleton: (fx, t, m) => {
    const n = m === 'die' ? 22 : 12;
    let tt = t;
    for (let i = 0; i < n; i++) {
      knock(fx, tt, fx.rng.range(500, 1500), 0.14, fx.rng.range(-0.4, 0.4));
      tt += fx.rng.range(0.015, m === 'die' ? 0.06 : 0.04);
    }
    if (m !== 'die') knock(fx, tt + 0.05, 900, 0.25); // jaw clack
  },
  zombie: (fx, t, m) => {
    fx.voice(t, { dur: m === 'hurt' ? 0.5 : 1.3, contour: m === 'die' ? [[0, 110], [1, 55]] : [[0, 98], [0.5, 125], [1, 84]], vowels: ['o', 'u', 'o'], rough: 0.35, breath: 0.25, vib: [3, 0.03], peak: 0.34 });
  },
  ghost: (fx, t, m) => {
    fx.voice(t, { whisper: true, dur: 1.4, vowels: ['u', 'i', 'u'], peak: 0.25, qScale: 2 });
    fx.tone(t, { f: 700, f1: m === 'die' ? 200 : 1100, dur: 1.2, a: 0.4, peak: 0.05, vib: [6, 0.02] });
    fx.tone(t + 0.1, { f: 1050, f1: m === 'die' ? 300 : 1500, dur: 1.1, a: 0.5, peak: 0.03, vib: [5, 0.02] });
  },
  rat: (fx, t, m) => {
    // Squeaks are tiny, high voices (formants ×3.4) with a rough edge, and paws scrabbling.
    if (m === 'die') {
      fx.voice(t, { dur: 0.55, a: 0.01, contour: [[0, 2500], [0.15, 3100], [1, 1400]], vowels: ['i', 'e'], formant: 3.2, rough: 0.45, roughRate: 120, breath: 0.15, peak: 0.16 });
      fx.grains(t + 0.1, { count: 12, spread: 0.5, curve: 1.5, fLo: 1500, fHi: 5000, q: 4, peak: 0.05 });
      return;
    }
    const n = m === 'hurt' ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.11 + fx.rng.range(0, 0.03);
      const f0 = fx.rng.range(2100, 2700) * (m === 'hurt' ? 1.2 : 1);
      fx.voice(tt, { dur: fx.rng.range(0.05, 0.09), a: 0.006, release: 0.04, contour: [[0, f0], [0.5, f0 * 1.35], [1, f0 * 1.1]], vowels: ['i', 'e'], formant: 3.4, rough: 0.25, roughRate: 150, breath: 0.1, peak: 0.15 });
    }
    fx.grains(t, { count: 12, spread: 0.35, fLo: 2500, fHi: 7000, q: 5, peak: 0.045 });
  },
  wolf: (fx, t, m) => {
    if (m === 'attack') fx.voice(t, { dur: 0.5, contour: [[0, 140], [1, 120]], vowels: ['r'], rough: 0.6, drive: 0.4, peak: 0.35 });
    else if (m === 'die' || m === 'hurt') {
      // A yelp that breaks and falls: sharp rise, then a rough whimpering slide down.
      const d = m === 'die' ? 0.75 : 0.32;
      fx.voice(t, { dur: d, a: 0.012, contour: m === 'die' ? [[0, 620], [0.08, 940], [0.3, 780], [0.65, 430], [1, 260]] : [[0, 700], [0.25, 980], [1, 620]], vowels: ['i', 'a', 'u'], formant: 1.25, rough: 0.35, roughRate: 90, breath: 0.12, vib: [11, 0.025], peak: 0.24 });
      if (m === 'die') fx.voice(t + 0.82, { dur: 0.45, a: 0.06, contour: [[0, 340], [1, 210]], vowels: ['u', 'u'], formant: 1.1, rough: 0.5, breath: 0.25, peak: 0.08 });
    } else fx.voice(t, { type: 'triangle', dur: 1.6, contour: [[0, 380], [0.2, 560], [0.8, 540], [1, 420]], vowels: ['u', 'o', 'u'], vib: [5, 0.01], breath: 0.03, peak: 0.3 });
  },
  spider: (fx, t, m) => {
    if (m === 'die') {
      // Death rattle: chitter that slows and sinks, legs scrabbling, a wet collapse.
      let tt = t;
      for (let i = 0; i < 16; i++) {
        const k = i / 15;
        fx.burst(tt, { dur: 0.018 + k * 0.03, peak: 0.22 * (1 - k * 0.6), filters: [{ type: 'bandpass', f: 3000 - k * 2100, q: 7 }] });
        tt += 0.03 + k * k * 0.09;
      }
      fx.grains(t + 0.1, { count: 14, spread: 0.8, curve: 1.8, fLo: 600, fHi: 1800, q: 4, peak: 0.12 });
      fx.burst(t + 0.05, { kind: 'pink', a: 0.08, hold: 0.25, dur: 0.6, peak: 0.12, filters: [{ type: 'bandpass', f: 1800, f1: 500, q: 1.5, dt: 0.9 }] });
      thud(fx, tt + 0.05, 0.25, 70);
      return;
    }
    fx.burst(t, { a: 0.05, hold: 0.3, dur: 0.2, peak: 0.14, filters: [{ type: 'highpass', f: 3000 }] });
    fx.grains(t, { count: 9, spread: 0.35, fLo: 1800, fHi: 3200, q: 9, peak: 0.25 });
  },
  frog: (fx, t, m) => {
    // A croak is pulsed phonation through a resonant throat sac, not a square wave.
    if (m === 'die') {
      fx.voice(t, { dur: 1.1, a: 0.02, contour: [[0, 120], [0.5, 92], [1, 52]], vowels: ['r', 'o', 'u'], formant: 0.85, pulse: [26, 0.9, 9], rough: 0.3, breath: 0.12, voices: 2, peak: 0.18 });
      fx.voice(t + 1.0, { whisper: true, dur: 0.6, vowels: ['o', 'u'], peak: 0.07, qScale: 1.5 });
      thud(fx, t + 1.05, 0.3, 70);
      return;
    }
    for (let c = 0; c < (m === 'hurt' ? 1 : 2); c++) {
      const tt = t + c * 0.46;
      fx.voice(tt, { dur: 0.34, a: 0.012, release: 0.06, contour: [[0, 135], [0.3, 150], [1, 118]], vowels: ['r', 'o'], formant: 0.9, pulse: [m === 'hurt' ? 34 : 28, 0.95], rough: 0.25, breath: 0.05, voices: 2, peak: 0.2 });
      fx.burst(tt, { a: 0.02, dur: 0.3, peak: 0.05, filters: [{ type: 'bandpass', f: 420, q: 6 }] }); // throat sac
    }
  },
  lizard: (fx, t, m) => {
    if (m === 'die') {
      // Hiss turning to a rattling gurgle that sinks away.
      fx.burst(t, { a: 0.02, hold: 0.15, dur: 0.5, peak: 0.12, filters: [{ type: 'bandpass', f: 2600, f1: 900, q: 2, dt: 0.6 }] });
      fx.voice(t + 0.08, { dur: 1.0, contour: [[0, 170], [0.3, 140], [1, 60]], vowels: ['r', 'o', 'u'], rough: 0.9, roughRate: 35, drive: 0.3, breath: 0.2, peak: 0.3 });
      thud(fx, t + 0.9, 0.3, 75);
      return;
    }
    fx.burst(t, { a: 0.04, hold: 0.25, dur: 0.2, peak: 0.12, filters: [{ type: 'bandpass', f: 2600, q: 2 }] });
    fx.voice(t + 0.15, { dur: 0.35, contour: [[0, 150], [1, 115]], vowels: ['r'], rough: 0.6, peak: 0.3 });
  },
  human: (fx, t, m) => {
    fx.voice(t, { dur: m === 'die' ? 0.6 : 0.28, contour: m === 'die' ? [[0, 220], [0.2, 240], [1, 110]] : m === 'hurt' ? [[0, 240], [1, 190]] : [[0, 165], [0.2, 205], [1, 140]], vowels: m === 'die' ? ['a', 'o', 'u'] : ['a', 'a', 'o'], breath: 0.15, rough: 0.15, peak: 0.38 });
  },
  dragon: (fx, t, m) => {
    if (m === 'die') {
      // The roar breaks into a shriek, three failing gasps, then the mountain falls.
      fx.voice(t, { dur: 0.9, a: 0.03, contour: [[0, 150], [0.3, 260], [1, 110]], vowels: ['i', 'a'], rough: 0.8, drive: 0.6, voices: 3, formant: 0.75, breath: 0.25, peak: 0.5 });
      for (let i = 0; i < 3; i++) fx.voice(t + 1.0 + i * 0.42, { dur: 0.3, a: 0.04, contour: [[0, 90 - i * 12], [1, 60 - i * 8]], vowels: ['a', 'u'], rough: 0.9, roughRate: 30, voices: 2, formant: 0.6, breath: 0.35, peak: 0.3 - i * 0.06 });
      thunder(fx, t + 2.3, 0.6);
      thud(fx, t + 2.3, 0.8, 45);
      return;
    }
    fx.voice(t, { dur: m === 'hurt' ? 0.8 : 2, contour: m === 'hurt' ? [[0, 110], [0.3, 140], [1, 80]] : [[0, 62], [0.3, 92], [1, 48]], vowels: ['a', 'o', 'u'], rough: 0.9, drive: 0.8, voices: 3, formant: 0.6, breath: 0.2, peak: 0.55 });
    throat(fx, t, { dur: m === 'hurt' ? 0.8 : 2, f0: m === 'hurt' ? 110 : 70, peak: 0.2, rasp: 1, sub: 1, wet: 0.45 });
    if (m !== 'hurt') {
      // The breath behind the roar: a furnace draught.
      fx.burst(t + 0.1, { kind: 'pink', a: 0.2, hold: 1.2, dur: 0.6, peak: 0.25, filters: [{ type: 'lowpass', f: 1200 }] });
      fx.burst(t, { kind: 'brown', a: 0.2, hold: 1.3, dur: 0.6, peak: 0.4, filters: [{ type: 'lowpass', f: 160 }] });
    }
  },
  /** The party: per race and sex (opts.race, opts.gender). */
  party: (fx, t, m, o = {}) => partyVox(fx, t, m, o),
};

/** Monster id → voice family. */
export const VOICE_OF = {
  kobold: 'kobold', koboldChief: 'kobold', goblin: 'goblin', orc: 'orc', orcLeader: 'orc', hobgoblin: 'orc', hobgoblinChief: 'orc', bugbear: 'orc',
  gnoll: 'gnoll', giantRat: 'rat', skeleton: 'skeleton', zombie: 'zombie', ghoul: 'zombie', ghast: 'zombie', shadow: 'ghost', wight: 'ghost', spectre: 'ghost',
  lizardMan: 'lizard', ogre: 'ogre', troll: 'troll', hillGiant: 'giant', buccaneer: 'human', thug: 'human', bandit: 'human', banditLeader: 'human', acolyte: 'human', banePriest: 'human',
  giantSpider: 'spider', giantCentipede: 'spider', wolf: 'wolf', giantFrog: 'frog', tyranthraxus: 'dragon',
};

// ------------------------------------------------------------------ the library
export const SFX = {
  // --- movement
  step: (fx, t, o) => partyStep(fx, t, o),
  footstep: (fx, t, o) => foot(fx, t, o.surface ?? 'stone', 1, o.pan ?? 0),
  walk: (fx, t, o) => {
    for (let i = 0; i < (o.n ?? 3); i++) foot(fx, t + i * 0.19, o.surface ?? 'stone', i % 2 ? 0.75 : 0.9, i % 2 ? 0.1 : -0.1);
  },
  bump: (fx, t) => {
    thud(fx, t, 0.45, 90);
    fx.grains(t + 0.01, { count: 6, spread: 0.12, fLo: 4000, fHi: 8000, peak: 0.05 });
    fx.grains(t + 0.03, { count: 5, spread: 0.3, fLo: 900, fHi: 3000, peak: 0.05 }); // dust and grit
  },
  turn: (fx, t, o) => {
    fx.burst(t, { a: 0.03, dur: 0.1, peak: 0.035, filters: [{ type: 'bandpass', f: 2500, q: 0.8 }] });
    foot(fx, t + 0.02, o.surface ?? 'stone', 0.25, 0.2);
  },

  // --- doors & world
  door: (fx, t) => {
    clink(fx, t, 2300, 0.14);
    clink(fx, t + 0.05, 1700, 0.1);
    creak(fx, t + 0.12, { rate: [38, 85], dur: 0.6, f: 950, peak: 0.1 });
    creak(fx, t + 0.18, { rate: [60, 110], dur: 0.4, f: 1550, q: 18, peak: 0.04 });
    whoosh(fx, t + 0.25, { f0: 300, f1: 900, dur: 0.5, peak: 0.07, q: 0.8 });
    thud(fx, t + 0.78, 0.32, 75);
    knock(fx, t + 0.78, 170, 0.25);
  },
  door_close: (fx, t) => {
    whoosh(fx, t, { f0: 900, f1: 300, dur: 0.35, peak: 0.07, q: 0.8 });
    thud(fx, t + 0.3, 0.5, 70);
    knock(fx, t + 0.3, 160, 0.3);
    clink(fx, t + 0.38, 2100, 0.12);
  },
  door_locked: (fx, t) => {
    for (let i = 0; i < 4; i++) clink(fx, t + i * 0.07 + fx.rng.range(0, 0.02), fx.rng.range(1600, 2600), 0.12, 0.6);
    knock(fx, t + 0.05, 210, 0.3);
    knock(fx, t + 0.2, 200, 0.25);
  },
  door_secret: (fx, t) => {
    fx.burst(t, { kind: 'brown', a: 0.2, hold: 1.0, dur: 0.4, peak: 0.45, filters: [{ type: 'lowpass', f: 380 }] });
    fx.burst(t, { a: 0.2, hold: 1.0, dur: 0.4, peak: 0.08, filters: [{ type: 'bandpass', f: 700, q: 2 }] });
    fx.grains(t + 0.1, { count: 30, spread: 1.2, fLo: 600, fHi: 2500, peak: 0.08 });
    thud(fx, t + 1.35, 0.55, 60);
  },
  chest: (fx, t) => {
    clink(fx, t, 2000, 0.12);
    creak(fx, t + 0.08, { rate: [30, 70], dur: 0.5, f: 750, peak: 0.1 });
    for (let i = 0; i < 6; i++) clink(fx, t + 0.4 + i * fx.rng.range(0.02, 0.06), fx.rng.range(2600, 4200), 0.05);
  },
  trap: (fx, t) => {
    clink(fx, t, 3000, 0.2, 0.5);
    whoosh(fx, t + 0.05, { f0: 2000, f1: 5000, dur: 0.15, peak: 0.25 });
    metalClang(fx, t + 0.18, 0.2, 640);
  },
  splash: (fx, t) => foot(fx, t, 'water', 1.4),
  omen: (fx, t) => {
    // Something stirs: a low swell, a breath of wind, a far-off growl.
    fx.tone(t, { type: 'sawtooth', f: 55, a: 0.8, dur: 0.9, peak: 0.08, filters: [{ type: 'lowpass', f: 300 }] });
    fx.tone(t, { type: 'sawtooth', f: 58.3, a: 0.8, dur: 0.9, peak: 0.06, filters: [{ type: 'lowpass', f: 300 }] });
    fx.burst(t, { kind: 'pink', a: 0.9, curve: 'lin', dur: 0.6, peak: 0.12, filters: [{ type: 'bandpass', f: 500, f1: 1400, q: 1.5, dt: 1.2 }] });
    fx.voice(t + 0.6, { whisper: true, dur: 0.8, vowels: ['u', 'a'], peak: 0.08, qScale: 1.5 });
  },

  // --- weapons
  swing: (fx, t, o) => whoosh(fx, t, { f0: 380 * (o.heavy ? 0.7 : 1), f1: 1700, dur: 0.24, peak: 0.28, q: 1.1 }),
  miss: (fx, t) => {
    whoosh(fx, t, { f0: fx.rng.range(450, 650), f1: fx.rng.range(1800, 2600), dur: 0.22, peak: 0.26 });
    whoosh(fx, t + 0.08, { f0: 2400, f1: 900, dur: 0.18, peak: 0.08 });
  },
  /**
   * A blade into flesh. Six round-robin takes vary every layer: the edge's
   * transient click, the blade's brief ring, the chop (cloth/leather giving),
   * the wet squelch of the wound and the body's weight taking the blow.
   */
  hit: (fx, t, o) => {
    if (o.material === 'armor') return SFX.hit_armor(fx, t, o);
    if (o.material === 'bone') return SFX.hit_bone(fx, t, o);
    const r = fx.rng;
    const v = r.int(0, 5);
    const k = 0.85 + v * 0.06;
    fx.burst(t, { a: 0.0005, dur: 0.007, peak: 0.32, filters: [{ type: 'highpass', f: 3200 + v * 450 }] });
    fx.modes(t + 0.001, { f: 2400 + v * 330, ratios: [1, 1.47, 2.09, 2.74], decays: [0.08, 0.055, 0.035, 0.025], amps: [1, 0.6, 0.4, 0.25], peak: 0.03 + (v % 3) * 0.008, jitter: 0.02 });
    fx.burst(t + 0.001, { a: 0.002, dur: 0.09 + v * 0.01, peak: 0.6, filters: [{ type: 'bandpass', f: 1100 * k, f1: 480 * k, q: 1.3 }] });
    fx.grains(t + 0.004, { count: 6 + v, spread: 0.09 + v * 0.01, fLo: 280, fHi: 1100, q: 2.2, peak: 0.4, dLo: 0.015, dHi: 0.04 });
    fx.burst(t, { kind: 'pink', a: 0.002, dur: 0.18, peak: 0.9, filters: [{ type: 'lowpass', f: 300 * k, f1: 130 }, { type: 'highpass', f: 55 }] });
    fx.burst(t + 0.01, { kind: 'brown', a: 0.004, dur: 0.14, peak: 0.6, filters: [{ type: 'lowpass', f: 500 }] });
    if (v % 2) fx.burst(t + 0.008, { a: 0.006, dur: 0.08, peak: 0.12, filters: [{ type: 'bandpass', f: 3300, f1: 1700, q: 2 }] });
    if (o.crit) SFX.crit(fx, t, o);
  },
  /** Steel on plate or mail: the edge bites, two plates ring, the blade grinds off, the body under it thumps. */
  hit_armor: (fx, t, o) => {
    const r = fx.rng;
    const v = r.int(0, 5);
    const sets = [[1, 2.08, 2.79, 3.9, 5.43], [1, 1.73, 2.61, 3.51, 4.88], [1, 2.31, 2.95, 4.2, 5.9], [1, 1.89, 2.44, 3.67, 5.02], [1, 2.17, 3.12, 4.06, 6.2], [1, 1.61, 2.53, 3.33, 4.71]];
    fx.burst(t, { a: 0.0005, dur: 0.006, peak: 0.34, filters: [{ type: 'highpass', f: 4000 }] });
    fx.modes(t, { f: r.range(620, 980), ratios: sets[v], decays: [0.5, 0.35, 0.25, 0.16, 0.1], amps: [1, 0.7, 0.55, 0.35, 0.2], peak: 0.18, jitter: 0.03 });
    fx.modes(t + 0.004, { f: r.range(1500, 2300), ratios: sets[(v + 3) % 6], decays: [0.25, 0.16, 0.1, 0.07, 0.05], amps: [1, 0.6, 0.4, 0.3, 0.2], peak: 0.07, jitter: 0.03 });
    // The edge grinding off the plate (or rasping across mail rings on odd takes).
    if (v % 2) fx.grains(t + 0.01, { count: 14, spread: 0.12, fLo: 2500, fHi: 6500, q: 4, peak: 0.07, dLo: 0.003, dHi: 0.01 });
    else fx.burst(t + 0.008, { a: 0.008, dur: 0.12, peak: 0.1, filters: [{ type: 'bandpass', f: 4200, f1: 2200, q: 4, dt: 0.12 }] });
    fx.burst(t, { kind: 'pink', a: 0.002, dur: 0.08, peak: 0.35, filters: [{ type: 'lowpass', f: 300 }, { type: 'highpass', f: 60 }] });
    if (o.crit) SFX.crit(fx, t, o);
  },
  /** Bone: a dry crack, splinters and a hollow rattle. */
  hit_bone: (fx, t) => {
    const r = fx.rng;
    fx.burst(t, { a: 0.0005, dur: 0.006, peak: 0.34, filters: [{ type: 'highpass', f: 2500 }] });
    fx.modes(t, { f: r.range(620, 880), ratios: [1, 1.6, 2.4, 3.3], decays: [0.06, 0.04, 0.03, 0.02], amps: [1, 0.6, 0.35, 0.2], peak: 0.26, jitter: 0.05 });
    fx.grains(t, { count: 9, spread: 0.08, fLo: 1500, fHi: 4500, peak: 0.26, q: 3 });
    fx.burst(t, { dur: 0.03, peak: 0.28, filters: [{ type: 'bandpass', f: 2600, q: 2 }] });
    for (let i = 0; i < 4; i++) knock(fx, t + 0.04 + i * r.range(0.025, 0.05), r.range(700, 1400), 0.06);
  },
  /** Critical: the blow lands with real weight — a heavy body thump, crunch and a bright "shing". */
  crit: (fx, t) => {
    fx.modes(t, { f: 72, ratios: [1, 1.58, 2.3], decays: [0.3, 0.16, 0.08], amps: [1, 0.45, 0.2], peak: 0.45 });
    fx.burst(t, { kind: 'brown', dur: 0.35, peak: 0.45, filters: [{ type: 'lowpass', f: 260 }] });
    fx.grains(t + 0.005, { count: 8, spread: 0.06, fLo: 500, fHi: 1600, q: 2, peak: 0.22, dLo: 0.01, dHi: 0.03 });
    fx.modes(t + 0.01, { f: 3300, ratios: [1, 1.41, 2.03], decays: [0.25, 0.15, 0.1], amps: [1, 0.5, 0.3], peak: 0.035 });
  },
  /** A bite: teeth clack, flesh tears, the wound gives. */
  bite: (fx, t) => {
    const r = fx.rng;
    knock(fx, t, r.range(1500, 1900), 0.1);
    knock(fx, t + 0.035, r.range(1100, 1400), 0.08);
    fx.burst(t + 0.01, { a: 0.01, dur: 0.16, peak: 0.24, filters: [{ type: 'bandpass', f: 1600, f1: 500, q: 1.6 }] });
    fx.grains(t + 0.02, { count: 8, spread: 0.14, fLo: 400, fHi: 1400, q: 2, peak: 0.15, dLo: 0.01, dHi: 0.03 });
    fx.burst(t, { kind: 'pink', a: 0.003, dur: 0.1, peak: 0.34, filters: [{ type: 'lowpass', f: 300 }, { type: 'highpass', f: 60 }] });
  },
  claw: (fx, t) => {
    whoosh(fx, t, { f0: 1200, f1: 3500, dur: 0.15, peak: 0.2 });
    fx.burst(t + 0.1, { dur: 0.08, peak: 0.3, filters: [{ type: 'bandpass', f: 2200, f1: 900, q: 2 }] });
  },
  block: (fx, t) => {
    metalClang(fx, t, 0.16, 1100);
    knock(fx, t, 260, 0.25);
  },
  // Blade meets blade: a bright ring with a scrape as the edges slide apart.
  parry: (fx, t) => {
    metalClang(fx, t, 0.2, fx.rng.range(1150, 1450));
    fx.burst(t + 0.015, { a: 0.01, dur: 0.16, peak: 0.12, filters: [{ type: 'bandpass', f: 4200, f1: 2400, q: 3, dt: 0.15 }] });
    fx.tone(t, { f: 160, f1: 110, dur: 0.06, peak: 0.12 });
  },
  // A blow caught on a wooden, iron-rimmed shield.
  shield: (fx, t) => {
    knock(fx, t, fx.rng.range(150, 190), 0.45);
    fx.burst(t, { dur: 0.09, peak: 0.25, filters: [{ type: 'lowpass', f: 900 }] });
    clink(fx, t + 0.005, fx.rng.range(1800, 2300), 0.06, 0.7);
  },
  // A sidestep: cloth and leather, the blade cutting air close by.
  dodge: (fx, t) => {
    whoosh(fx, t, { f0: 700, f1: 2600, dur: 0.18, peak: 0.16 });
    fx.burst(t + 0.05, { a: 0.03, dur: 0.12, peak: 0.05, filters: [{ type: 'bandpass', f: 1600, q: 0.8 }] });
    foot(fx, t + 0.1, 'stone', 0.3, 0.2);
  },
  // Wind-up of an attack before we know what it is: leather creak, gear shifting.
  ready: (fx, t) => {
    creak(fx, t, { rate: [55, 80], dur: 0.12, f: 1300, q: 8, peak: 0.025 });
    fx.burst(t, { a: 0.03, dur: 0.12, peak: 0.05, filters: [{ type: 'bandpass', f: 1200, q: 0.7 }] });
    fx.grains(t + 0.02, { count: 4, spread: 0.12, fLo: 3500, fHi: 7000, q: 7, peak: 0.02 });
  },
  // An incoming arrow: a rising whistle that ends at the target.
  arrow_in: (fx, t) => {
    fx.burst(t, { kind: 'pink', a: 0.16, dur: 0.06, peak: 0.25, curve: 'lin', filters: [{ type: 'bandpass', f: 1800, f1: 3800, q: 6, dt: 0.18 }] });
    fx.tone(t, { f: 2600, f1: 3400, a: 0.15, dur: 0.05, peak: 0.02 });
  },
  bow: (fx, t) => {
    fx.tone(t, { type: 'triangle', f: 215, f1: 200, dur: 0.28, peak: 0.22 });
    fx.tone(t, { type: 'sawtooth', f: 108, dur: 0.12, peak: 0.07, filters: [{ type: 'lowpass', f: 1200 }] });
    fx.burst(t, { dur: 0.03, peak: 0.2, filters: [{ type: 'bandpass', f: 2600, q: 1 }] });
    fx.burst(t + 0.04, { a: 0.04, dur: 0.35, peak: 0.1, filters: [{ type: 'bandpass', f: 3200, f1: 1400, q: 2 }], pan: 0.3 });
  },
  arrow_hit: (fx, t) => {
    knock(fx, t, 290, 0.32);
    fx.tone(t + 0.01, { type: 'triangle', f: 160, dur: 0.25, peak: 0.05, vib: [28, 0.12] }); // shaft quiver
  },
  death: (fx, t) => {
    thud(fx, t, 0.55, 80);
    fx.grains(t + 0.02, { count: 10, spread: 0.25, fLo: 3000, fHi: 8000, peak: 0.07, q: 5 });
    thud(fx, t + 0.18, 0.28, 70);
  },

  // --- spells (by family)
  spell: (fx, t, o) => {
    shimmer(fx, t, { notes: [880, 1108, 1318, 1760, 2217, 2637].map((f) => f * keyRatio(o.key, 9)) });
    fx.burst(t, { a: 0.3, dur: 0.5, peak: 0.05, filters: [{ type: 'highpass', f: 4000 }] });
    fx.tone(t, { f: 220, f1: 440, a: 0.3, dur: 0.5, peak: 0.09 });
  },
  spell_fire: (fx, t) => {
    whoosh(fx, t, { f0: 300, f1: 2200, dur: 0.45, peak: 0.3, q: 0.8 });
    explosion(fx, t + 0.38, 1);
    fx.burst(t + 0.4, { kind: 'pink', a: 0.1, hold: 0.4, dur: 1, peak: 0.22, filters: [{ type: 'lowpass', f: 900 }] });
    // The roar of the fireball itself: a 200 Hz–2 kHz body that blooms for
    // half a second after the boom (what small speakers hear), the flames
    // fluttering through it, falling as the burst burns out.
    for (const [pan, f, f1] of [[-0.35, 700, 420], [0.35, 950, 520]]) {
      fx.burst(t + 0.43, { kind: 'pink', a: 0.22, hold: 0.35, dur: 0.75, peak: 0.36, pan, filters: [{ type: 'highpass', f: 200 }, { type: 'bandpass', f, f1, q: 0.55, dt: 1.2 }, { type: 'lowpass', f: 2200 }] });
    }
    fx.grains(t + 0.5, { count: 40, spread: 0.9, curve: 1.2, fLo: 300, fHi: 1400, q: 2, peak: 0.07, dLo: 0.01, dHi: 0.04 });
  },
  spell_cone: (fx, t) => {
    fx.burst(t, { kind: 'pink', a: 0.06, hold: 0.5, dur: 0.5, peak: 0.35, filters: [{ type: 'bandpass', f: 600, f1: 1500, q: 0.8, dt: 0.6 }] });
    fx.grains(t + 0.05, { count: 30, spread: 1, fLo: 1500, fHi: 6000, peak: 0.1 });
    fx.tone(t, { f: 80, hold: 0.4, dur: 0.4, peak: 0.2 });
  },
  spell_lightning: (fx, t) => {
    fx.tone(t, { type: 'sawtooth', f: 90, f1: 400, a: 0.25, dur: 0.1, peak: 0.06, filters: [{ type: 'highpass', f: 600 }] });
    zap(fx, t + 0.25, 0.32, 0.45);
    thunder(fx, t + 0.4, 0.65);
  },
  spell_shock: (fx, t) => zap(fx, t, 0.18, 0.7),
  /** Magic missiles: arcane bolts — a resonant zing sweeping down, a sparking whoosh, a soft impact pop. */
  spell_missile: (fx, t, o) => {
    const n = o.n ?? 3;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.09;
      const pan = (i - (n - 1) / 2) * 0.35;
      fx.tone(tt, { type: 'sawtooth', f: 1300, f1: 480, dur: 0.24, peak: 0.07, pan, filters: [{ type: 'bandpass', f: 3400, f1: 900, q: 7, dt: 0.24 }] });
      fx.burst(tt, { kind: 'pink', a: 0.04, dur: 0.18, peak: 0.25, pan, filters: [{ type: 'bandpass', f: 2600, f1: 1100, q: 2.5, dt: 0.2 }] });
      fx.grains(tt, { count: 6, spread: 0.2, fLo: 5000, fHi: 10000, peak: 0.04, pan });
      knock(fx, tt + 0.26, 380 + i * 40, 0.12, pan);
    }
  },
  spell_sleep: (fx, t) => {
    [1568, 1318, 1175, 988, 784].forEach((f, i) => fx.tone(t + i * 0.13, { f, dur: 1.2, peak: 0.07, a: 0.04, vib: [5, 0.004], pan: 0.4 - i * 0.2 }));
    fx.burst(t, { a: 0.4, dur: 1, peak: 0.05, filters: [{ type: 'bandpass', f: 2000, q: 0.8 }] });
    fx.tone(t, { f: 196, a: 0.3, dur: 1, peak: 0.05 });
  },
  spell_mind: (fx, t) => {
    fx.tone(t, { f: 600, a: 0.2, dur: 1, peak: 0.1, vib: [7, 0.08] });
    fx.tone(t, { f: 906, a: 0.3, dur: 0.9, peak: 0.07, vib: [5.3, 0.1] });
    fx.burst(t, { a: 0.7, curve: 'lin', dur: 0.1, peak: 0.12, filters: [{ type: 'bandpass', f: 1500, q: 2 }] });
  },
  spell_cloud: (fx, t) => {
    for (let i = 0; i < 26; i++) {
      const f = fx.rng.range(140, 460);
      fx.tone(t + fx.rng.range(0, 1.5), { f, f1: f * 1.9, dur: 0.06, peak: 0.08, pan: fx.rng.range(-0.6, 0.6) });
    }
    fx.burst(t, { a: 0.3, hold: 0.6, dur: 0.6, peak: 0.08, filters: [{ type: 'lowpass', f: 1500 }] });
    fx.burst(t, { kind: 'brown', a: 0.4, hold: 0.5, dur: 0.6, peak: 0.25, filters: [{ type: 'lowpass', f: 200 }] });
  },
  spell_heal: (fx, t, o) => {
    const k = keyRatio(o.key, 0);
    [523, 659, 784, 1047].forEach((f, i) => fx.modes(t + i * 0.1, { f: f * k, ratios: [1, 2.76, 5.4], decays: [1.2, 0.5, 0.25], peak: 0.09 }));
    chord(fx, t, [262, 330, 392], { dur: 0.9, peak: 0.05, k });
    fx.grains(t + 0.2, { count: 12, spread: 0.8, fLo: 6000, fHi: 11000, peak: 0.03, q: 8 });
  },
  heal: (fx, t, o) => SFX.spell_heal(fx, t, o),
  spell_holy: (fx, t, o) => {
    const k = keyRatio(o.key, 2);
    bell(fx, t, 587 * k, 0.14);
    chord(fx, t, [294, 370, 440, 587], { dur: 1.4, peak: 0.05, k });
    shimmer(fx, t + 0.1, { notes: [1175, 1480, 1760, 2349].map((f) => f * k), step: 0.07, dur: 0.9, peak: 0.04 });
  },
  spell_curse: (fx, t) => {
    fx.tone(t, { type: 'sawtooth', f: 73, a: 0.4, dur: 0.8, peak: 0.12, filters: [{ type: 'lowpass', f: 600 }] });
    fx.tone(t, { type: 'sawtooth', f: 77.8, a: 0.4, dur: 0.8, peak: 0.1, filters: [{ type: 'lowpass', f: 600 }] });
    fx.burst(t, { a: 0.6, curve: 'lin', dur: 0.1, peak: 0.15, filters: [{ type: 'lowpass', f: 900 }] });
    fx.voice(t + 0.1, { whisper: true, dur: 0.9, vowels: ['a', 'u'], peak: 0.15, qScale: 1.5 });
  },
  spell_ward: (fx, t) => {
    fx.tone(t, { f: 400, f1: 1600, dur: 0.5, peak: 0.1 });
    fx.tone(t, { type: 'triangle', f: 800, f1: 3200, dur: 0.45, peak: 0.04 });
    fx.modes(t + 0.3, { f: 1320, ratios: [1, 2.32, 4.25], decays: [0.8, 0.5, 0.3], peak: 0.1 });
    fx.burst(t, { a: 0.2, dur: 0.4, peak: 0.04, filters: [{ type: 'highpass', f: 5000 }] });
  },
  spell_turn: (fx, t, o) => {
    const k = keyRatio(o.key, 2);
    bell(fx, t, 294 * k, 0.22, 1.4);
    chord(fx, t + 0.05, [294, 370, 440], { dur: 1.6, peak: 0.07, k });
    shimmer(fx, t + 0.2, { notes: [1175, 1480, 1760, 2349, 2960].map((f) => f * k), step: 0.06, dur: 1, peak: 0.04 });
  },
  spell_fizzle: (fx, t) => {
    fx.burst(t, { dur: 0.3, peak: 0.12, filters: [{ type: 'bandpass', f: 3000, f1: 600, q: 2 }] });
    fx.tone(t, { f: 600, f1: 200, dur: 0.3, peak: 0.05 });
  },
  potion: (fx, t) => {
    clink(fx, t, 2800, 0.06, 0.5);
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.15 + i * 0.16;
      fx.tone(tt, { f: 260 + i * 25, f1: 480 + i * 30, dur: 0.07, peak: 0.12 });
      fx.burst(tt, { dur: 0.06, peak: 0.08, filters: [{ type: 'lowpass', f: 900 }] });
    }
  },

  /** A weapon passing harmlessly through an incorporeal foe: air, a cold hollow shimmer, a whisper. */
  pass_through: (fx, t) => {
    whoosh(fx, t, { f0: 500, f1: 2200, dur: 0.3, peak: 0.24 });
    fx.voice(t + 0.06, { whisper: true, dur: 0.6, vowels: ['u', 'i'], peak: 0.12, qScale: 2 });
    shimmer(fx, t + 0.04, { notes: [1480, 1568, 2217, 2349], step: 0.035, dur: 0.8, peak: 0.03 });
    fx.burst(t + 0.05, { a: 0.12, dur: 0.4, peak: 0.05, filters: [{ type: 'highpass', f: 6000 }] });
  },

  // --- ui
  /** Keyboard / gamepad focus moving between menu items (quieter, rounder than a pointer hover). */
  focus: (fx, t) => {
    fx.modes(t, { f: 1700, ratios: [1, 2.4], decays: [0.03, 0.012], amps: [1, 0.3], peak: 0.04 });
    fx.burst(t, { dur: 0.006, peak: 0.01, filters: [{ type: 'highpass', f: 5000 }] });
  },
  click: (fx, t) => {
    fx.modes(t, { f: 1850, ratios: [1, 2.6], decays: [0.025, 0.012], peak: 0.16 });
    fx.burst(t, { dur: 0.01, peak: 0.05, filters: [{ type: 'highpass', f: 4000 }] });
  },
  hover: (fx, t) => {
    fx.tone(t, { f: 2400, dur: 0.035, peak: 0.025 });
    fx.burst(t, { dur: 0.006, peak: 0.012, filters: [{ type: 'highpass', f: 6000 }] });
  },
  confirm: (fx, t) => {
    fx.modes(t, { f: 988, ratios: [1, 2.76, 5.4], decays: [0.3, 0.1, 0.05], peak: 0.11 });
    fx.modes(t + 0.075, { f: 1319, ratios: [1, 2.76, 5.4], decays: [0.45, 0.12, 0.06], peak: 0.12 });
  },
  cancel: (fx, t) => {
    fx.modes(t, { f: 1175, ratios: [1, 2.76], decays: [0.18, 0.06], peak: 0.08 });
    fx.modes(t + 0.07, { f: 880, ratios: [1, 2.76], decays: [0.25, 0.07], peak: 0.08 });
  },
  error: (fx, t) => {
    fx.tone(t, { type: 'square', f: 150, dur: 0.1, peak: 0.07, filters: [{ type: 'lowpass', f: 900 }] });
    fx.tone(t + 0.12, { type: 'square', f: 125, dur: 0.14, peak: 0.07, filters: [{ type: 'lowpass', f: 800 }] });
  },
  page: (fx, t) => {
    fx.burst(t, { a: 0.02, dur: 0.12, peak: 0.07, filters: [{ type: 'bandpass', f: 3500, q: 0.6 }] });
    fx.grains(t, { count: 8, spread: 0.15, fLo: 3000, fHi: 7500, peak: 0.035 });
  },
  open: (fx, t) => {
    fx.burst(t, { a: 0.06, dur: 0.18, peak: 0.06, filters: [{ type: 'lowpass', f: 1200, f1: 3500 }] });
    SFX.page(fx, t + 0.05);
  },
  close: (fx, t) => {
    fx.burst(t, { a: 0.04, dur: 0.15, peak: 0.05, filters: [{ type: 'lowpass', f: 3000, f1: 900 }] });
    knock(fx, t + 0.1, 420, 0.06);
  },
  map: (fx, t) => {
    fx.burst(t, { a: 0.15, dur: 0.4, peak: 0.06, filters: [{ type: 'bandpass', f: 2500, q: 0.7 }] });
    fx.grains(t + 0.05, { count: 16, spread: 0.45, fLo: 2500, fHi: 7000, peak: 0.035 });
  },
  coins: (fx, t, o) => {
    let tt = t;
    const n = o.n ?? fx.rng.int(6, 9);
    for (let i = 0; i < n; i++) {
      clink(fx, tt, fx.rng.range(2600, 4300), 0.09 * (1 - i / (n * 1.4)), 1, fx.rng.range(-0.3, 0.3));
      tt += fx.rng.range(0.02, 0.09) * (1 - i / (n * 1.5));
    }
    fx.burst(t, { dur: 0.08, peak: 0.12, filters: [{ type: 'lowpass', f: 500 }] });
  },
  save: (fx, t) => {
    fx.modes(t, { f: 1760, ratios: [1, 2.76], decays: [0.6, 0.2], peak: 0.08 });
    fx.modes(t + 0.12, { f: 2637, ratios: [1, 2.76], decays: [0.8, 0.25], peak: 0.07 });
  },
  equip: (fx, t) => {
    fx.burst(t, { a: 0.02, dur: 0.12, peak: 0.08, filters: [{ type: 'bandpass', f: 1800, q: 0.8 }] });
    clink(fx, t + 0.06, 1900, 0.08, 0.7);
    clink(fx, t + 0.1, 2700, 0.05, 0.5);
  },
  sparkle: (fx, t) => shimmer(fx, t, { notes: [2093, 2637, 3136, 4186], step: 0.05, dur: 0.6, peak: 0.04 }),
  // Level up: a rising arpeggio of struck bells (D major, the motif's fifth on
  // top), a warm swell underneath and a final glint.
  levelup: (fx, t, o) => {
    const k = keyRatio(o.key, 2);
    [587, 740, 880, 1175, 1760].forEach((f, i) => fx.modes(t + i * 0.085, { f: f * k, ratios: [1, 2.76, 5.4], decays: [1.4 - i * 0.15, 0.5, 0.2], amps: [1, 0.35, 0.12], peak: 0.09 + i * 0.01, pan: (i - 2) * 0.18 }));
    chord(fx, t + 0.1, [294, 440, 587], { dur: 1.1, peak: 0.04, vowel: 'o', a: 0.25, k });
    fx.tone(t + 0.42, { f: 3520 * k, dur: 0.9, peak: 0.025, vib: [6, 0.004] });
    fx.burst(t + 0.38, { a: 0.2, dur: 0.6, peak: 0.03, filters: [{ type: 'highpass', f: 6000 }] });
  },
};

/** Monster vocalisation: kind = voice family or monster id; mode = attack|hurt|die. */
export function monsterVox(fx, t, kind, mode = 'attack') {
  const fam = VOX[kind] ? kind : VOICE_OF[kind] ?? 'human';
  VOX[fam](fx, t, mode);
}

for (const fam of Object.keys(VOX)) {
  SFX[`vox_${fam}`] = (fx, t, o) => VOX[fam](fx, t, o.mode ?? 'attack', o);
  SFX[`vox_${fam}_die`] = (fx, t, o) => VOX[fam](fx, t, 'die', o);
}

export { foot, creak };
