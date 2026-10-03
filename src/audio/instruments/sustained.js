import { Instrument, adsr, cents, voiceBudget, kbq, kosc } from './base.js';
import { mtof } from '../core/notes.js';
import { noiseBuffer, noiseOffset, sample } from '../dsp/bank.js';
import { harmonic, WAVE_PARTIALS } from '../dsp/spectra.js';
import { renderNote } from '../dsp/notesynth.js';
import { AudioRng } from '../core/rng.js';

/** Shared PeriodicWaves (per context) for more instrument-like spectra than raw saws. */
const waveCache = new WeakMap();
function wave(ac, name) {
  let m = waveCache.get(ac);
  if (!m) waveCache.set(ac, (m = new Map()));
  if (m.has(name)) return m.get(name);
  const H = WAVE_PARTIALS;
  const re = new Float32Array(H);
  const im = new Float32Array(H);
  for (let n = 1; n < H; n++) im[n] = harmonic(name, n);
  const w = ac.createPeriodicWave(re, im);
  m.set(name, w);
  return w;
}

function lfo(ac, t, rate, depth, delay = 0, rampTo = 0.4) {
  const o = kosc(ac);
  o.frequency.value = rate;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.setValueAtTime(0, t + delay);
  g.gain.linearRampToValueAtTime(depth, t + delay + rampTo);
  o.connect(g);
  o.start(t);
  return { o, g };
}

/**
 * Shared phrase envelope: one continuous gain curve over a slurred line.
 * Each note re-articulates with a small dip (bow change / tongue) whose depth
 * is `dip` (doubled on repeated pitches), and moves to its own velocity level,
 * so phrases breathe instead of retriggering from silence.
 * @returns {number} time when the voice is silent
 */
function phraseEnv(param, notes, { a, r, s = 0.88, dip = 0.2, level }) {
  const n0 = notes[0];
  // Automation times must never run backwards: `at` tracks the last event.
  let at = n0.t + a;
  param.setValueAtTime(0, n0.t);
  param.linearRampToValueAtTime(level(n0.vel), at);
  let cur = level(n0.vel);
  const ramp = (v, t) => {
    if (t <= at + 1e-4) return;
    param.linearRampToValueAtTime(v, t);
    at = t;
  };
  for (let i = 1; i < notes.length; i++) {
    const n = notes[i];
    const p = notes[i - 1];
    const lv = level(n.vel);
    const held = cur * s;
    ramp(held, Math.min(n.t - 0.002, Math.max(p.t + a + 0.005, n.t - 0.035)));
    const d = Math.min(0.85, dip * (n.midi === p.midi ? 2.2 : 1));
    if (d > 0.01) {
      ramp(held * (1 - d), n.t + 0.004);
      ramp(lv, n.t + Math.min(0.06, Math.max(0.02, n.dur * 0.3)));
    } else ramp(lv, n.t + Math.min(0.08, Math.max(0.01, n.dur * 0.4)));
    cur = lv;
  }
  const last = notes[notes.length - 1];
  const end = last.t + last.dur;
  const relStart = Math.max(last.t + 0.02, end, at);
  if (relStart - last.t > 0.12) ramp(cur * s, relStart);
  param.setTargetAtTime(0, relStart, Math.max(0.004, r / 4));
  return relStart + r * 1.7;
}

/**
 * Pitch changes inside a slurred phrase. Real legato is a fast change — the
 * new pitch arrives in 15–35 ms (`glide`), mostly at once — not synth
 * portamento; only large string intervals slide audibly, and then only at
 * expressive moments: with probability `slide` (an explicit `gliss` mark
 * makes it 1) for leaps of at least `big` semitones, over 70–110 ms.
 */
function glideFreqs(params, notes, { glide = 0.025, slide = 0, big = 5, rng = null } = {}) {
  let at = notes[0].t + 0.065; // after the first note's scoop
  for (let i = 1; i < notes.length; i++) {
    const n = notes[i];
    const p = notes[i - 1];
    if (n.midi === p.midi) continue;
    const leap = Math.abs(n.midi - p.midi) >= big;
    const port = slide > 0 && leap && (slide >= 1 || (rng ? rng.chance(slide) : false));
    const want = port ? 0.07 + 0.04 * Math.min(1, Math.abs(n.midi - p.midi) / 12) : Math.max(0.015, Math.min(0.035, glide));
    const g = Math.max(0.012, Math.min(want, n.dur * 0.35, p.dur * 0.5));
    // A slide leaves late and lands on the beat; a legato change straddles it.
    const t0 = Math.max(at, port ? n.t - g * 0.8 : n.t - g * 0.5);
    const t1 = Math.max(t0 + 0.01, port ? n.t + g * 0.2 : n.t + g * 0.5);
    for (const [param, det] of params) {
      param.setValueAtTime(mtof(p.midi) * det, t0);
      param.exponentialRampToValueAtTime(mtof(n.midi) * det, t1);
    }
    at = t1 + 0.001;
  }
}

/** Body resonances of the violin family (Hz, Q, gain dB), scaled by register. */
const BODY = [[285, 3.2, 3.5], [470, 4.5, 2], [1060, 5, 3.5], [1600, 4, -3.5], [2700, 1.8, 3.5], [4300, 3, -2.5]];
/**
 * Narrow, irregular body modes (peaks and dips a few % wide). A partial that
 * vibrato sweeps across them rises and falls in level, so vibrato reads as
 * the shimmering amplitude/timbre modulation of a real wooden box, not just
 * a pitch wobble.
 */
const MODES = [[640, 14, 4.5], [905, 16, -4.5], [1370, 15, 4.5], [1830, 14, -4], [2330, 16, 4], [3150, 15, -3.5]];

/**
 * A control signal (ConstantSource) carrying a phrase-shaped envelope: bow
 * pressure / breath. Connect it (through gains) to filter frequencies, EQ
 * gains and layer levels so a note's *spectrum* follows its dynamics.
 */
function pressureSignal(ac, notes, o) {
  const cs = ac.createConstantSource();
  cs.offset.value = 0;
  const end = phraseEnv(cs.offset, notes, o);
  cs.start(notes[0].t);
  cs.stop(end + 0.05);
  return { cs, end };
}

/** Connect `src` scaled by `k` into AudioParam `param`. */
function drive(ac, src, param, k) {
  const g = ac.createGain();
  g.gain.value = k;
  src.connect(g).connect(param);
  return g;
}

/**
 * Bowed string section (violins → basses by register): an ensemble of 4–8
 * players. Each player has their own intonation (±6 cents), slow pitch drift,
 * vibrato (rate, depth and onset all individual), bow-change timing and seat
 * in the section's stereo width — divisi chords split the section between
 * the notes. The spectrum follows bow pressure across every note: a
 * pressure envelope opens the brightness filter, lifts the bridge-hill
 * formant (~2.5–3.5 kHz) and drives the rosin noise, so swells darken and
 * bloom like real strings instead of a static synth comb. Narrow body
 * resonances let vibrato shimmer through the body modes.
 * Articulations: legato (default; slurred phrases glide), spic, trem, swell.
 */
export class Strings extends Instrument {
  constructor(ac, o) {
    const body = o.body ?? (0.25 + 0.75 * Math.min(1, Math.max(0, ((o.bright ?? 0.5) - 0.28) / 0.34)));
    const eq = BODY.map(([f, q, g], i) => ({ type: 'peaking', f: i >= 4 ? f * (0.65 + 0.35 * body) : f * (0.3 + 0.7 * body), q, g }));
    for (const [f, q, g] of MODES) eq.push({ type: 'peaking', f: f * (0.45 + 0.55 * body), q, g });
    eq.push({ type: 'highshelf', f: 9000, g: -3 });
    // Spiccato buffers arrive already seated across the section; legato notes
    // are one mono chain seated at the section's centre, widened by the
    // section chorus (two modulated copies either side of the section).
    const center = o.pan ?? 0;
    const spread = o.spread ?? 0.32;
    super(ac, { eq, chorus: (o.voices ?? 6) > 1 ? 1 : 0, chorusLevel: 0.42, ...o, pan: 0, chorusPan: center, chorusWidth: Math.min(0.6, spread * 1.5 + 0.08) });
    this.center = center;
    this.seat = ac.createStereoPanner();
    this.seat.pan.value = center;
    this.seat.connect(this.input);
    this.voices = o.voices ?? 6;
    this.bright = o.bright ?? 0.5;
    this.spread = o.spread ?? 0.32;
    this.body = body;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  /**
   * A divisi chord: the section's bow is one gesture, so the chord shares one
   * envelope, bow-pressure filter chain and rosin; each chord tone gets its
   * own players (intonation, vibrato depth, onset).
   */
  chord(t, midis, dur, vel = 0.6, opts = {}) {
    if (opts.art === 'spic') {
      for (const m of midis) this._spic({ t, midi: m, dur, vel }, opts);
      return;
    }
    const sorted = midis.slice().sort((a, b) => a - b);
    this.phrase([{ t, midi: sorted[Math.floor((sorted.length - 1) / 2)], dur, vel }], { ...opts, divisi: midis.length, tones: midis });
  }

  phrase(notes, opts = {}) {
    if (opts.art === 'spic') {
      for (const n of notes) this._spic(n, opts);
      return;
    }
    const ac = this.ac;
    const rng = this.rng;
    const art = opts.art ?? 'legato';
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const vel = n0.vel;
    const base = 0.07 + (1 - vel) * 0.16;
    const a = opts.attack ?? (art === 'swell' ? total * 0.6 : Math.min(base, 0.25 * n0.dur));
    const r = opts.release ?? Math.min(0.5, 0.18 + total * 0.08);
    // Players for this note: a line gets up to four, a divisi chord two per
    // note — the section chorus turns them into a full desk-by-desk section.
    const divisi = Math.max(1, opts.divisi ?? 1);
    const tones = opts.tones ?? [n0.midi];
    const T = tones.length;
    const want = Math.min(this.voices, divisi > 1 ? 2 : 3);
    // Players per chord tone (a stretched budget thins every tone alike, never below one).
    const nv = Math.max(1, Math.round(voiceBudget(ac, n0.t, last.t + last.dur + 0.5, want * T, Math.min(2, want) * T) / T));
    const g = ac.createGain();
    const lvl = (v) => ((0.16 + 0.22 * v) * 0.42 * 1.1) / Math.sqrt(nv);
    const envO = { a, r, s: art === 'swell' ? 1 : 0.9, dip: opts.dip ?? 0.12 };
    const end = phraseEnv(g.gain, notes, { ...envO, level: lvl });
    // Bow pressure: rises a little behind the amplitude (the bow bites, then the tone blooms).
    const pr = pressureSignal(ac, notes, { ...envO, a: a * 1.4 + 0.01, level: (v) => 0.25 + 0.75 * v });
    // Brightness follows pressure (two poles: soft bowing really loses the upper partials).
    const lp = kbq(ac, 'lowpass');
    lp.Q.value = 0.45;
    const lo = Math.min(9000, Math.max(f * 4.5, 1000));
    const top = Math.min(16000, Math.max(f * 11, 2600 + 9000 * this.bright));
    lp.frequency.value = lo;
    drive(ac, pr.cs, lp.frequency, top - lo);
    const lp2 = kbq(ac, 'lowpass');
    lp2.Q.value = 0.5;
    lp2.frequency.value = lo * 1.6;
    drive(ac, pr.cs, lp2.frequency, (top - lo) * 1.6);
    // The bridge hill: a broad formant that grows with bow pressure.
    const hill = kbq(ac, 'peaking');
    hill.frequency.value = 2500 + 1000 * this.body;
    hill.Q.value = 0.9;
    hill.gain.value = -4;
    drive(ac, pr.cs, hill.gain, 10);
    lp.connect(lp2).connect(hill).connect(g);
    const nodes = [pr.cs];
    if (art === 'trem') {
      const tr = kosc(ac);
      tr.type = 'triangle';
      tr.frequency.value = opts.tremRate ?? 13;
      const tg = ac.createGain();
      tg.gain.value = 0.5;
      const g2 = ac.createGain();
      g2.gain.value = 0.5;
      tr.connect(tg).connect(g2.gain);
      g.connect(g2).connect(this.seat);
      tr.start(n0.t);
      nodes.push(tr);
    } else g.connect(this.seat);
    const freqParams = [];
    const vibOn = total >= 0.18;
    // Slow intonation drift on long notes: one wandering LFO, the players drifting against each other.
    let drift = null;
    if (vibOn && total > 3) {
      const d = lfo(ac, n0.t, rng.range(0.1, 0.3), f * 0.0035, 0, 0.5);
      const inv = ac.createGain();
      inv.gain.value = -1;
      d.g.connect(inv);
      drift = [d.g, inv];
      nodes.push(d.o);
    }
    // Vibrato rate wanders (players speed up and relax): one slow LFO shared
    // by the section, each desk following it with its own sign and depth.
    let rateWob = null;
    if (vibOn && total > 2.5 && T === 1) {
      rateWob = lfo(ac, n0.t, rng.range(0.25, 0.55), 1, 0, 0.3);
      nodes.push(rateWob.o);
    }
    const waves = ['bowed', 'bowed2', 'bowed3'];
    const deskVib = [];
    for (let i = 0; i < nv * T; i++) {
      const pg = ac.createGain();
      pg.connect(lp);
      const o = kosc(ac);
      // Every player's instrument has its own spectrum.
      o.setPeriodicWave(wave(ac, waves[(i + (this.o.seed ?? 0)) % 3]));
      const det = cents(rng.range(-6, 6));
      const ft = T > 1 ? mtof(tones[i % T]) : f;
      o.frequency.setValueAtTime(ft * det, n0.t);
      freqParams.push([o.frequency, det]);
      if (vibOn) {
        // Own vibrato: ±15–25 cents (a real section, not a synth pad), rate,
        // depth and a delayed onset; stand partners share one vibrato, each at
        // their own depth; shorter notes vibrate less.
        const depthC = rng.range(15, 25) * Math.min(1, 0.45 + total * 0.5) * (opts.vib ?? 1);
        // (Chords: the desks of the whole section share two vibratos.)
        const desk = T > 1 ? i % 2 : i >> 1;
        let v = deskVib[desk];
        if (!v) {
          v = lfo(ac, n0.t, rng.range(4.8, 6.3), f * (cents(depthC) - 1), Math.min(0.4, n0.dur * rng.range(0.25, 0.5)), rng.range(0.35, 0.8));
          if (rateWob) drive(ac, rateWob.g, v.o.frequency, rng.range(-0.7, 0.7));
          nodes.push(v.o);
          deskVib[desk] = v;
          if (ft === f) v.g.connect(o.frequency);
          else drive(ac, v.g, o.frequency, ft / f);
        } else drive(ac, v.g, o.frequency, rng.range(0.7, 1.25) * (ft / f));
        if (drift) {
          if (ft === f) drift[i % 2].connect(o.frequency);
          else drive(ac, drift[i % 2], o.frequency, ft / f);
        }
      }
      o.connect(pg);
      // Each player's own bow attack (no step when a late player joins a sounding section).
      const ts = n0.t + rng.range(0, 0.035);
      pg.gain.setValueAtTime(0, ts);
      pg.gain.linearRampToValueAtTime(rng.range(0.8, 1.15), ts + 0.03);
      o.start(ts);
      nodes.push(o);
    }
    glideFreqs(freqParams, notes, { glide: opts.glide ?? 0.03, slide: opts.gliss ? 1 : 0.25, big: 5, rng });
    // Rosin: continuous bow noise that follows bow pressure, brightest on each
    // bow change (one per chord, not one per divisi note).
    const rosin = !opts.noBow && vel > 0.15 && total >= 0.2 && (divisi === 1 || (this._rosinAt ?? -1) < n0.t - 0.05);
    if (rosin) {
      this._rosinAt = n0.t;
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(ac, 'white');
      const bp = kbq(ac, 'bandpass');
      bp.frequency.value = Math.min(7500, Math.max(1800, f * 7));
      bp.Q.value = 0.7;
      const ng = ac.createGain();
      ng.gain.value = 0;
      drive(ac, pr.cs, ng.gain, 0.022 * (0.5 + this.bright) * Math.sqrt(divisi) / Math.sqrt(nv));
      // Extra scrape on each bow change.
      for (const x of notes) {
        ng.gain.setValueAtTime(0, Math.max(n0.t, x.t - 0.001));
        ng.gain.linearRampToValueAtTime(0.025 * x.vel, x.t + 0.006);
        ng.gain.setTargetAtTime(0, x.t + 0.01, 0.02);
      }
      n.connect(bp).connect(ng).connect(lp);
      n.start(n0.t, noiseOffset(rng, total + 1));
      nodes.push(n);
    }
    for (const o of nodes) o.stop(end);
  }
}

/** Velocity layers of the cached short notes (a stroke's gain is scaled from the nearest layer). */
const VLAYERS = [0.35, 0.6, 0.85];
const vlayer = (v) => (v < 0.475 ? 0 : v < 0.725 ? 1 : 2);
/** Exponential approach (setTargetAtTime) evaluated in closed form. */
const approach = (from, to, dt, tau) => to + (from - to) * Math.exp(-dt / tau);

/**
 * Spiccato: a short bounced stroke — four players across the section's seats,
 * the bow's bite as a burst of rosin and a brightness that depends on how hard
 * the stroke is. Ostinati fire many of these a second, so each stroke is
 * rendered once (pitch × velocity layer × three round-robin takes × length)
 * into a cached stereo buffer by dsp/notesynth.js and played as one buffer
 * source: no oscillators, filters or panners per stroke on the audio thread.
 */
Strings.prototype._spicBuf = function spicBuf(m, vb, variant, len) {
  const center = this.center;
  const spread = this.spread;
  const bright = this.bright;
  const key = `spic:${bright}:${spread}:${center}:${m}:${vb}:${variant}:${len}`;
  return sample(this.ac, key, (sr) => {
    const vel = VLAYERS[vb];
    const f = mtof(m);
    const rng = new AudioRng(m * 977 + vb * 131 + variant * 7919 + Math.round(len * 1000));
    const peak = (((0.16 + 0.22 * vel) * 0.42) / Math.sqrt(2)) * 1.2;
    const top = Math.min(14000, Math.max(f * 6, 1500 + 7000 * bright * (0.3 + vel)));
    const players = [-1, -0.33, 0.33, 1].map((seat) => ({
      det: cents(rng.range(-8, 8)),
      onset: rng.range(0, 0.007),
      gain: 0.72 * rng.range(0.85, 1.1),
      pan: Math.max(-1, Math.min(1, center + seat * spread * 0.8)),
    }));
    const vAt = (t) => {
      if (t < 0.006) return (peak * t) / 0.006;
      if (t < 0.012) return peak;
      const vl = len > 0.012 ? approach(peak, peak * 0.35, len - 0.012, len * 0.5) : peak;
      if (t < len) return approach(peak, peak * 0.35, t - 0.012, len * 0.5);
      return vl * Math.exp(-(t - len) / 0.025);
    };
    return renderNote(sr, {
      wave: ['bowed', 'bowed2', 'bowed3'][variant % 3],
      freq: f,
      dur: len + 0.17,
      players,
      amp: vAt,
      cutoff: (t) => (t < 0.01 ? top : approach(top, top * 0.5, t - 0.01, 0.04)),
      q: 0.5,
      playerAttack: 0.002,
      noise: vel > 0.5 ? { f: Math.min(7500, Math.max(1800, f * 7)), q: 0.8, post: true, env: (t) => (t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / 0.012)) * 0.05 * vel * (0.5 + bright) / peak } : null,
      seed: rng.int(1, 1e9),
    });
  });
};

Strings.prototype._spic = function spic(n) {
  const ac = this.ac;
  const vb = vlayer(n.vel);
  const len = Math.round(Math.max(0.03, Math.min(n.dur, 0.09)) * 100) / 100;
  const buf = this._spicBuf(n.midi, vb, (this.rr = ((this.rr ?? 0) + 1) % 3), len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = (0.16 + 0.22 * n.vel) / (0.16 + 0.22 * VLAYERS[vb]);
  src.connect(g).connect(this.input);
  src.start(n.t);
  src.stop(n.t + buf.duration);
};

/** Pre-render a spiccato stroke's takes (idle-time cache warming). */
Strings.prototype.warm = function warm(m, vel = 0.6, opts = {}) {
  if (opts.art !== 'spic') return [];
  const vb = vlayer(vel);
  return [0, 1, 2].flatMap((variant) => [0.07, 0.09].map((len) => () => this._spicBuf(m, vb, variant, len)));
};

/** Formants per vowel: [Hz, amplitude, Q] × 4. */
const VOWELS = {
  ah: [[730, 1, 9], [1090, 0.5, 10], [2440, 0.22, 12], [3400, 0.08, 14]],
  eh: [[530, 1, 9], [1840, 0.35, 11], [2480, 0.18, 12], [3500, 0.06, 14]],
  ee: [[290, 1, 9], [2200, 0.32, 13], [2950, 0.2, 14], [3600, 0.06, 15]],
  oh: [[500, 1, 9], [880, 0.45, 10], [2500, 0.1, 12], [3300, 0.05, 14]],
  oo: [[330, 1, 8], [780, 0.3, 10], [2400, 0.06, 12], [3200, 0.03, 14]],
  mm: [[250, 1, 5], [1500, 0.04, 8], [2500, 0.02, 10], [3300, 0.01, 12]],
};
/** Default sung text (vowel per syllable, consonant onsets) per preset vowel. */
const TEXTS = {
  ah: ['ah', 'eh', 'ah', 'oh', 'ah', 'ee', 'ah', 'oh'],
  oh: ['oh', 'ah', 'oh', 'oo', 'oh', 'eh'],
  oo: ['oo', 'oh', 'oo', 'oo', 'ah', 'oo'],
  mm: ['mm'],
};
const CONSONANTS = ['', 'l', 's', '', 'k', 'n', '', 't', 'l', ''];

/**
 * Choir: two half-sections, each with its own vocal tract (a formant bank
 * jittered per half — different singers, different throats), 2–4 singers per
 * note in each half with personal pitch, vibrato and onset. The whole choir
 * sings one text: the vowel changes syllable by syllable (and drifts inside
 * long notes, ah→oh), syllables start with soft consonants — s, t, k bursts
 * or an l/n dip — and every note of a chord sings the same syllable, so the
 * choir sings words, not a fixed "aah". The formant banks are shared by all
 * the notes of the instrument (one vocal tract per half, not one per note):
 * a fraction of the audio-thread work for a sustained six-part chord.
 */
export class Choir extends Instrument {
  constructor(ac, o) {
    // Two half-sections of two singers per note, widened into a full choir by
    // the section chorus (modulated copies either side of the choir).
    super(ac, { chorus: 1, chorusLevel: 0.5, chorusRate: 0.8, ...o, pan: 0, chorusPan: o.pan ?? 0, chorusWidth: 0.55 });
    this.center = o.pan ?? 0;
    this.vowel = o.vowel ?? 'ah';
    this.text = o.text ?? TEXTS[this.vowel] ?? [this.vowel];
    this.voices = o.voices ?? 6;
    this.shift = o.formantShift ?? 1;
    this.breath = o.breath ?? 0.06;
    this.syl = 0;
    this.sylAt = new Map();
    this.banks = null;
  }

  /** The two half-sections' vocal tracts (built on first use). */
  _banks(t) {
    if (this.banks) return this.banks;
    const ac = this.ac;
    const rng = this.rng;
    const V0 = VOWELS[this.vowel === 'mm' ? 'mm' : this.text[0]];
    this.banks = [0, 1].map((half) => {
      const sh = this.shift * (half ? rng.range(1.015, 1.05) : rng.range(0.95, 0.985));
      const sec = ac.createGain();
      const pn = ac.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, this.center + (half ? 0.32 : -0.32)));
      sec.connect(pn).connect(this.input);
      const src = ac.createGain();
      const bps = [];
      const fgs = [];
      for (let fi = 0; fi < 4; fi++) {
        const bp = kbq(ac);
        bp.type = 'bandpass';
        bp.Q.value = V0[fi][2];
        bp.frequency.setValueAtTime(V0[fi][0] * sh, t);
        const fg = ac.createGain();
        fg.gain.setValueAtTime(V0[fi][1] * 3.2, t);
        src.connect(bp).connect(fg).connect(sec);
        bps.push(bp);
        fgs.push(fg);
      }
      // Breath air above the formants.
      const air = kbq(ac);
      air.type = 'highpass';
      air.frequency.value = 4500;
      const ag = ac.createGain();
      ag.gain.value = 0.3;
      src.connect(air).connect(ag).connect(sec);
      return { sh, sec, src, bps, fgs };
    });
    return this.banks;
  }

  /** The syllable sung at `t` (shared by every note that starts within 20 ms of it). */
  _syllable(t) {
    const key = Math.round(t * 50);
    for (const k of [key, key - 1, key + 1]) {
      const s = this.sylAt.get(k);
      if (s) return { ...s, fresh: false };
    }
    const k = this.syl++;
    const fixed = this.vowel === 'mm';
    const s = { v: fixed ? 'mm' : this.text[k % this.text.length], c: fixed ? '' : CONSONANTS[(k * 7 + 3) % CONSONANTS.length] };
    this.sylAt.set(key, s);
    if (this.sylAt.size > 256) for (const old of this.sylAt.keys()) if (old < key - 500) this.sylAt.delete(old);
    return { ...s, fresh: true };
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  /** A chord: the choir breathes and sings the syllable together — one envelope per half, singers per chord tone. */
  chord(t, midis, dur, vel = 0.6, opts = {}) {
    const sorted = midis.slice().sort((a, b) => a - b);
    this.phrase([{ t, midi: sorted[Math.floor((sorted.length - 1) / 2)], dur, vel }], { ...opts, divisi: midis.length, tones: midis });
  }

  phrase(notes, opts = {}) {
    const ac = this.ac;
    const rng = this.rng;
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const divisi = Math.max(1, opts.divisi ?? 1);
    const tones = opts.tones ?? [n0.midi];
    const T = tones.length;
    const nv = Math.max(2, Math.round(voiceBudget(ac, n0.t, last.t + last.dur + 0.8, Math.min(4, Math.max(2, Math.round(this.voices / Math.sqrt(divisi)))) * T, 2 * T) / T));
    const banks = this._banks(n0.t);
    const a = opts.attack ?? Math.min(0.32, 0.3 * n0.dur + 0.04);
    const envO = { a, r: opts.release ?? 0.7, s: 0.94, dip: 0.1, level: (v) => ((0.18 + 0.3 * v) * 0.42 * 1.15) / Math.sqrt(nv) };
    const syl = notes.map((n) => this._syllable(n.t));
    // The text: formant moves for each new syllable (both vocal tracts).
    notes.forEach((n, k) => {
      const s = syl[k];
      if (!s.fresh) return;
      for (const B of banks) {
        for (let fi = 0; fi < 4; fi++) {
          const V = VOWELS[s.v][fi];
          B.bps[fi].frequency.setTargetAtTime(V[0] * B.sh, Math.max(0, n.t - 0.02), 0.035);
          B.fgs[fi].gain.setTargetAtTime(V[1] * 3.2, Math.max(0, n.t - 0.02), 0.035);
          // Long notes drift toward a darker vowel (ah → oh, eh → ah …).
          if (n.dur > 1.2 && s.v !== 'mm') {
            const to = VOWELS[{ ah: 'oh', eh: 'ah', ee: 'eh', oh: 'oo', oo: 'oh' }[s.v]][fi];
            B.bps[fi].frequency.setTargetAtTime(V[0] * B.sh * 0.6 + to[0] * B.sh * 0.4, n.t + n.dur * 0.45, n.dur * 0.25);
          }
        }
      }
    });
    const nodes = [];
    const fp = [];
    let end = 0;
    for (let half = 0; half < 2; half++) {
      const B = banks[half];
      const g = ac.createGain();
      end = phraseEnv(g.gain, notes, envO);
      g.connect(B.src);
      // Singers.
      const per = Math.ceil(nv / 2);
      // Every singer is a person: own vibrato depth (4.8–6.2 Hz, ±15–30 cents,
      // arriving late on long notes) and a slow pitch scatter (±8 cents): the
      // half-section shares one vibrato and one wandering LFO that each singer
      // follows with their own weights.
      const long = total > 0.5;
      const wander = long && total > 2 && T === 1 ? lfo(ac, n0.t, rng.range(0.07, 0.23), f * (cents(8) - 1), 0, 0.6) : null;
      if (wander) nodes.push(wander.o);
      const vib = long ? lfo(ac, n0.t, rng.range(4.8, 6.2), f * (cents(rng.range(15, 30)) - 1), rng.range(0.12, Math.min(0.6, total * 0.3)), rng.range(0.4, 0.9)) : null;
      if (vib) nodes.push(vib.o);
      for (let i = 0; i < per * T; i++) {
        const o = kosc(ac);
        o.setPeriodicWave(wave(ac, 'voice'));
        const det = cents(rng.range(-9, 9));
        const ft = T > 1 ? mtof(tones[i % T]) : f;
        o.frequency.setValueAtTime(ft * det, n0.t);
        fp.push([o.frequency, det]);
        if (vib) {
          if (i || ft !== f) drive(ac, vib.g, o.frequency, rng.range(0.6, 1.3) * (ft / f));
          else vib.g.connect(o.frequency);
          if (wander) drive(ac, wander.g, o.frequency, rng.range(-1, 1) * (ft / f));
        }
        const og = ac.createGain();
        const ts = n0.t + rng.range(0, 0.07);
        og.gain.setValueAtTime(0, ts);
        og.gain.linearRampToValueAtTime(rng.range(0.75, 1.1), ts + 0.05);
        o.connect(og).connect(g);
        o.start(ts);
        nodes.push(o);
      }
      // Breath: aspiration through this half's vocal tract (once per chord).
      if (syl[0].fresh) {
        const n = ac.createBufferSource();
        n.buffer = noiseBuffer(ac, 'pink');
        const ng = ac.createGain();
        ng.gain.value = this.breath * n0.vel * 1.6 * Math.sqrt(Math.max(1, divisi));
        n.connect(ng).connect(g);
        n.start(n0.t, noiseOffset(rng, total + 1));
        nodes.push(n);
      }
      // Consonant onsets, once per syllable for the whole choir (slightly different timing per half).
      notes.forEach((nt, k) => {
        const c = syl[k].c;
        if (!syl[k].fresh || !c || nt.vel < 0.2) return;
        const t0 = Math.max(n0.t, nt.t - (c === 's' ? 0.07 : 0.02)) + rng.range(0, 0.015);
        const ns = ac.createBufferSource();
        ns.buffer = noiseBuffer(ac, 'white');
        const flt = kbq(ac);
        flt.type = c === 's' ? 'highpass' : 'bandpass';
        flt.frequency.value = c === 's' ? 5500 : c === 'k' ? 2200 : c === 't' ? 3800 : 900;
        flt.Q.value = c === 's' ? 0.7 : 1.5;
        const cg = ac.createGain();
        const pk = (c === 's' ? 0.05 : c === 'l' || c === 'n' ? 0.015 : 0.06) * nt.vel * 0.75;
        const len = c === 's' ? 0.08 : c === 'l' || c === 'n' ? 0.05 : 0.018;
        cg.gain.setValueAtTime(0, t0);
        cg.gain.linearRampToValueAtTime(pk, t0 + Math.min(0.02, len * 0.4));
        cg.gain.linearRampToValueAtTime(0, t0 + len);
        ns.connect(flt).connect(cg).connect(B.sec);
        ns.start(t0, noiseOffset(rng, 1));
        ns.stop(t0 + len + 0.02);
      });
    }
    glideFreqs(fp, notes, { glide: 0.035, slide: opts.gliss ? 1 : 0.15, big: 5, rng });
    for (const o of nodes) o.stop(end);
  }
}

/**
 * Wind instruments: flute / recorder / horn / brass / lowbrass / bassoon /
 * shawm. Brass are a small section (3–4 players, own intonation and onset)
 * whose timbre follows breath pressure: a pressure envelope opens the
 * lowpass and crossfades a clean (dark) path into a saturated (blaring) one,
 * so the spectral tilt changes across every note — soft horns are round,
 * fortissimo ones blare. Articulations: legato (slurred phrases glide), rip
 * (fast smeared run up into the note), fall (pitch drops off the release),
 * flutter (flutter-tongue). Breath noise and tongue chiff on every note.
 */
const WIND = {
  flute: { wave: 'flute', a: 0.07, r: 0.18, breath: 0.12, chiff: 0.25, vib: [5.1, 0.006, 0.25], lp: 7, scoop: 0, dip: 0.3 },
  recorder: { wave: 'flute', a: 0.03, r: 0.08, breath: 0.07, chiff: 0.45, vib: [5.6, 0.0025, 0.3], lp: 9, scoop: 0, tri: 0.25, dip: 0.45 },
  horn: { wave: 'horn', a: 0.05, r: 0.25, breath: 0.03, chiff: 0.1, vib: [4.8, 0.0018, 0.35], lp: 2.2, lpVel: 7, scoop: -28, voices: 4, dip: 0.3, blare: 0.7 },
  brass: { wave: 'horn', a: 0.035, r: 0.2, breath: 0.03, chiff: 0.12, vib: [5, 0.0012, 0.4], lp: 2.8, lpVel: 11, scoop: -30, voices: 3, dip: 0.35, blare: 1 },
  lowbrass: { wave: 'horn', a: 0.06, r: 0.3, breath: 0.025, chiff: 0.08, vib: [4.5, 0.001, 0.5], lp: 2.6, lpVel: 8, scoop: -18, voices: 3, dip: 0.3, blare: 0.85 },
  bassoon: { wave: 'reed', a: 0.05, r: 0.15, breath: 0.03, chiff: 0.1, vib: [5, 0.003, 0.3], lp: 5, scoop: -10, dip: 0.3 },
  // Orchestral reeds. Oboe: nasal double reed with a 1.1 k / 3 k formant pair and a quick, singing vibrato.
  oboe: { wave: 'oboe', a: 0.035, r: 0.12, breath: 0.035, chiff: 0.2, vib: [5.3, 0.0042, 0.3], lp: 14, lpVel: 8, scoop: -8, dip: 0.35 },
  // Clarinet: hollow chalumeau, almost no vibrato, breath a touch louder, soft tongue.
  clarinet: { wave: 'clarinet', a: 0.05, r: 0.14, breath: 0.05, chiff: 0.12, vib: [4.8, 0.0008, 0.5], lp: 9, lpVel: 10, scoop: -4, dip: 0.28 },
  shawm: { wave: 'reed', a: 0.025, r: 0.08, breath: 0.04, chiff: 0.2, vib: [5.8, 0.004, 0.2], lp: 12, scoop: -15, dip: 0.4 },
};

function softClipCurve(k) {
  const N = 1024;
  const c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

export class Wind extends Instrument {
  constructor(ac, o) {
    const p = WIND[o.preset ?? 'flute'];
    const RES = {
      // Oboe bore + reed formants (fixed: they stay put as the pitch moves, as on the real instrument).
      oboe: [{ type: 'highpass', f: 220, q: 0.7 }, { type: 'peaking', f: 1150, q: 2.2, g: 7 }, { type: 'peaking', f: 2950, q: 2.6, g: 5 }, { type: 'peaking', f: 1900, q: 4, g: -3 }, { type: 'highshelf', f: 7500, g: -6 }],
      // Clarinet: woody low register body, register-key 'throat' dip, soft top.
      clarinet: [{ type: 'peaking', f: 420, q: 1.4, g: 3 }, { type: 'peaking', f: 1500, q: 1.8, g: 2.5 }, { type: 'peaking', f: 2600, q: 3, g: -2.5 }, { type: 'highshelf', f: 6000, g: -7 }],
    };
    const eq = RES[p.wave] ?? (p.wave === 'horn' ? [{ type: 'peaking', f: 600, q: 0.8, g: 1.5 }, { type: 'peaking', f: 1400, q: 1.2, g: 1 }, { type: 'highshelf', f: 7000, g: -4 }] : p.wave === 'flute' ? [{ type: 'highshelf', f: 8000, g: -6 }] : [{ type: 'peaking', f: 1200, q: 1.2, g: 3 }, { type: 'highshelf', f: 6000, g: -6 }]);
    const brass = p.wave === 'horn';
    // Brass: a mono section chain seated once, its ensemble chorus seated
    // either side of the section's own place on the stage (not the centre).
    super(ac, { eq, ...(brass ? { chorus: 1, chorusLevel: 0.36, chorusRate: 1.2 } : {}), ...o, ...(brass ? { pan: 0, chorusPan: o.pan ?? 0, chorusWidth: 0.2 } : {}) });
    this.center = o.pan ?? 0;
    this.p = p;
    this.brass = brass;
    if (brass) {
      this.clip = softClipCurve(2.6);
      // The section's seat: every note's chain stays mono (half the work on the
      // audio thread) and is placed here once.
      this.seat = ac.createStereoPanner();
      this.seat.pan.value = this.center;
      this.seat.connect(this.input);
    }
  }

  play(t, m, dur, vel = 0.65, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  /** A chord: brass sections breathe together — one breath/filter chain, two players per chord tone. */
  chord(t, midis, dur, vel = 0.65, opts = {}) {
    if (!this.brass) {
      for (const m of midis) this.phrase([{ t, midi: m, dur, vel }], opts);
      return;
    }
    const sorted = midis.slice().sort((a, b) => a - b);
    this.phrase([{ t, midi: sorted[Math.floor((sorted.length - 1) / 2)], dur, vel }], { ...opts, divisi: midis.length, tones: midis });
  }

  phrase(notes, opts = {}) {
    const ac = this.ac;
    const p = this.p;
    const rng = this.rng;
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const vel = n0.vel;
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const isBrass = this.brass;
    const art = opts.art ?? 'legato';
    // Short brass stabs (battle ostinati fire several a second) come from cached buffers.
    if (isBrass && notes.length === 1 && total < 0.5 && (art === 'legato' || art === 'stab') && !opts.scoop) {
      for (const m of opts.tones ?? [n0.midi]) this._stab({ ...n0, midi: m }, opts);
      return;
    }
    const tones = opts.tones ?? [n0.midi];
    const T = tones.length;
    const g = ac.createGain();
    const a = opts.attack ?? Math.min(p.a * (isBrass ? 1.6 - vel : 1), 0.3 * n0.dur);
    const rel = opts.release ?? (art === 'fall' ? Math.max(p.r, 0.35) : p.r);
    const envO = { a, r: rel, s: 0.86, dip: opts.dip ?? p.dip };
    const end = phraseEnv(g.gain, notes, { ...envO, level: (v) => (0.22 + 0.25 * v) * 0.36 });
    const nodes = [];
    const lp = kbq(ac);
    lp.type = 'lowpass';
    lp.Q.value = isBrass ? 0.9 : 0.5;
    const topOf = (mm, v) => Math.min(14000, mtof(mm) * (p.lp + (p.lpVel ?? 0) * v * v));
    let head = lp;
    if (isBrass && total < 0.5 && art !== 'flutter') {
      // Short stab: the same tilt (dark → blaring with force) fixed per note,
      // with the filter opening on the attack — a fraction of the nodes, since
      // battle ostinati fire several of these a second.
      const pv = 0.15 + 0.85 * vel * vel;
      const lo = f * 1.3;
      const top = lo + (topOf(n0.midi, 1) - lo) * pv;
      lp.frequency.setValueAtTime(lo, n0.t);
      lp.frequency.linearRampToValueAtTime(top, n0.t + a * 1.2 + 0.015);
      lp.frequency.setTargetAtTime(lo + (top - lo) * 0.6, n0.t + total, 0.05);
      const dark = ac.createGain();
      dark.gain.value = 1 - 0.6 * pv;
      const pre = ac.createGain();
      pre.gain.value = 0.05 + 1.4 * pv;
      const ws = ac.createWaveShaper();
      ws.curve = this.clip;
      const bright = ac.createGain();
      bright.gain.value = 0.55 * (p.blare ?? 1) * pv;
      lp.connect(dark).connect(g);
      lp.connect(pre).connect(ws).connect(bright).connect(g);
      g.connect(this.seat);
    } else if (isBrass) {
      // Breath pressure: the lips bite in after the tongue, so pressure lags the attack a little.
      const pr = pressureSignal(ac, notes, { ...envO, a: a * 1.2 + 0.015, level: (v) => 0.15 + 0.85 * v * v });
      nodes.push(pr.cs);
      const lo = f * 1.3;
      lp.frequency.value = lo;
      drive(ac, pr.cs, lp.frequency, Math.max(200, topOf(n0.midi, 1) - lo));
      const lp2 = kbq(ac);
      lp2.type = 'lowpass';
      lp2.Q.value = 0.5;
      lp2.frequency.value = lo * 1.5;
      drive(ac, pr.cs, lp2.frequency, Math.max(300, (topOf(n0.midi, 1) - lo) * 1.5));
      // Dark (clean) path fades as pressure rises; the bright path is driven
      // hard into a soft clipper and fades in with pressure: dynamic spectral tilt.
      const dark = ac.createGain();
      dark.gain.value = 1;
      drive(ac, pr.cs, dark.gain, -0.6);
      // Drive into the clipper scales with pressure too: soft notes stay linear (round), loud ones saturate.
      const pre = ac.createGain();
      pre.gain.value = 0.05;
      // A chord shares the saturator: less drive per tone keeps its intermodulation down.
      drive(ac, pr.cs, pre.gain, 1.4 / Math.sqrt(T));
      const ws = ac.createWaveShaper();
      ws.curve = this.clip;
      const bright = ac.createGain();
      bright.gain.value = 0;
      drive(ac, pr.cs, bright.gain, 0.55 * (p.blare ?? 1));
      lp.connect(lp2);
      lp2.connect(dark).connect(g);
      lp2.connect(pre).connect(ws).connect(bright).connect(g);
      if (art === 'flutter') {
        const fl = ac.createBufferSource();
        fl.buffer = noiseBuffer(ac, 'white');
        const fll = kbq(ac);
        fll.type = 'bandpass';
        fll.frequency.value = 22;
        fll.Q.value = 2;
        const flg = ac.createGain();
        flg.gain.value = 12;
        const am = ac.createGain();
        am.gain.value = 0.75;
        fl.connect(fll).connect(flg).connect(am.gain);
        g.connect(am);
        fl.start(n0.t, noiseOffset(rng, total + 1));
        nodes.push(fl);
        am.connect(this.seat);
      } else g.connect(this.seat);
    } else {
      const top = topOf(n0.midi, vel);
      lp.frequency.setValueAtTime(top, n0.t);
      for (let i = 1; i < notes.length; i++) lp.frequency.setTargetAtTime(topOf(notes[i].midi, notes[i].vel), notes[i].t, 0.03);
      lp.connect(g);
      g.connect(this.voicePan(opts.pan));
    }
    // Two players per note: the section chorus supplies the rest of the desk.
    const wantV = Math.min(2, p.voices ?? 1);
    const voices = wantV > 1 ? Math.max(1, Math.round(voiceBudget(ac, n0.t, last.t + last.dur + rel, wantV * T, T) / T)) : wantV;
    const fp = [];
    const vibOk = total > p.vib[2] + 0.1;
    const sharedVib = !isBrass && vibOk ? lfo(ac, n0.t, p.vib[0] + rng.range(-0.3, 0.3), f * p.vib[1] * (opts.vib ?? 1), p.vib[2], 0.45) : null;
    if (sharedVib) nodes.push(sharedVib.o);
    // Brass: one vibrato for the section, each player following it at their own depth.
    const brassVib = isBrass && vibOk ? lfo(ac, n0.t, p.vib[0] + rng.range(-0.4, 0.4), f * p.vib[1] * (opts.vib ?? 1), p.vib[2] + rng.range(0, 0.2), 0.5) : null;
    if (brassVib) nodes.push(brassVib.o);
    for (let i = 0; i < voices * T; i++) {
      const o = kosc(ac);
      o.setPeriodicWave(wave(ac, p.wave));
      // Chord tones ride on the same section chain: their pitch ratio is folded into `det`.
      const det = cents(voices > 1 ? rng.range(-5, 5) : 0) * (T > 1 ? mtof(tones[i % T]) / f : 1);
      const t0 = n0.t + (voices > 1 ? rng.range(0, 0.025) : 0);
      // Scoop into the first note of a phrase only; a rip smears up from a fifth below.
      if (art === 'rip') {
        o.frequency.setValueAtTime(f * det * cents(-900 - rng.range(0, 200)), t0);
        o.frequency.exponentialRampToValueAtTime(f * det * cents(-150), t0 + 0.1);
        o.frequency.exponentialRampToValueAtTime(f * det, t0 + 0.14);
      } else {
        o.frequency.setValueAtTime(f * det * cents(opts.scoop ?? p.scoop ?? 0), t0);
        o.frequency.exponentialRampToValueAtTime(f * det, t0 + 0.06);
      }
      fp.push([o.frequency, det]);
      if (sharedVib) sharedVib.g.connect(o.frequency);
      else if (brassVib) drive(ac, brassVib.g, o.frequency, rng.range(0.6, 1.4) * (T > 1 ? mtof(tones[i % T]) / f : 1));
      if (voices > 1) {
        const og = ac.createGain();
        og.gain.setValueAtTime(0, t0);
        og.gain.linearRampToValueAtTime(rng.range(0.8, 1.1) / Math.sqrt(voices / 2), t0 + 0.012);
        o.connect(og).connect(head);
      } else o.connect(head);
      o.start(t0);
      nodes.push(o);
    }
    glideFreqs(fp, notes, { glide: isBrass ? 0.028 : 0.022 });
    // Fall: the pitch drops away as the note is released.
    if (art === 'fall') {
      const tf = last.t + last.dur - 0.02;
      for (const [param, det] of fp) {
        param.setValueAtTime(mtof(last.midi) * det, tf);
        param.exponentialRampToValueAtTime(mtof(last.midi) * det * cents(-700), tf + rel);
      }
    }
    if (p.tri) {
      const o = kosc(ac);
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 2, n0.t);
      glideFreqs([[o.frequency, 2]], notes, { glide: 0.022 });
      const tg = ac.createGain();
      tg.gain.value = p.tri * 0.3;
      o.connect(tg).connect(head);
      o.start(n0.t);
      nodes.push(o);
    }
    // Breath noise (tuned band) + tongue chiff on every articulation.
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac, 'white');
    const bp = kbq(ac);
    bp.type = 'bandpass';
    bp.frequency.value = isBrass ? Math.min(3500, Math.max(900, f * 3)) : Math.min(12000, f * 2);
    bp.Q.value = isBrass ? 1.2 : 2;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0, n0.t);
    for (const x of notes) {
      const pk = p.breath * 0.5 + p.chiff * 0.6 * x.vel * (x === n0 ? 1 : 0.5) * (art === 'rip' && x === n0 ? 2 : 1);
      ng.gain.setValueAtTime(p.breath * 0.3, Math.max(n0.t, x.t - 0.001));
      ng.gain.linearRampToValueAtTime(pk, x.t + 0.012);
      ng.gain.setTargetAtTime(p.breath * 0.3, x.t + 0.02, 0.03);
    }
    ng.gain.setTargetAtTime(0, last.t + last.dur, 0.05);
    n.connect(bp).connect(ng).connect(isBrass ? lp : g);
    n.start(n0.t, noiseOffset(rng, total + 1));
    nodes.push(n);
    for (const o of nodes) o.stop(end);
  }
}

/**
 * A short brass stab rendered once into a cached buffer (pitch × velocity
 * layer × three takes × length): the same horn spectrum, scoop, filter that
 * opens on the attack, dark/blaring tilt (tanh saturation) and breath chiff as
 * the live chain, at the section's seat — one buffer source per stab.
 */
Wind.prototype._stabBuf = function stabBuf(m, vb, variant, dur) {
  const p = this.p;
  const key = `stab:${this.o.preset}:${this.center}:${m}:${vb}:${variant}:${dur}`;
  return sample(this.ac, key, (sr) => {
    const vel = VLAYERS[vb];
    const f = mtof(m);
    const rng = new AudioRng(m * 613 + vb * 97 + variant * 7907 + Math.round(dur * 1000));
    const pv = 0.15 + 0.85 * vel * vel;
    const lo = f * 1.3;
    const topOf = (v) => Math.min(14000, f * (p.lp + (p.lpVel ?? 0) * v * v));
    const top = lo + (topOf(1) - lo) * pv;
    const a = Math.min(p.a * (1.6 - vel), 0.3 * dur);
    const level = (0.22 + 0.25 * vel) * 0.36;
    const relStart = Math.max(0.02, dur);
    const r = p.r;
    const amp = (t) => {
      if (t < a) return (level * t) / a;
      if (t < relStart) return relStart > 0.12 ? level - level * 0.14 * ((t - a) / Math.max(1e-3, relStart - a)) : level;
      const v0 = relStart > 0.12 ? level * 0.86 : level;
      return v0 * Math.exp(-(t - relStart) / Math.max(0.004, r / 4));
    };
    const lpAt = (t) => {
      const ta = a * 1.2 + 0.015;
      if (t < ta) return lo + (top - lo) * (t / ta);
      if (t < dur) return top;
      return approach(top, lo + (top - lo) * 0.6, t - dur, 0.05);
    };
    const voices = 2;
    const players = [0, 1].map(() => ({ det: cents(rng.range(-5, 5)), onset: rng.range(0, 0.025), gain: rng.range(0.8, 1.1) / Math.sqrt(voices / 2), pan: this.center }));
    const pk = p.breath * 0.5 + p.chiff * 0.6 * vel;
    const b3 = p.breath * 0.3;
    return renderNote(sr, {
      wave: p.wave,
      freq: f,
      dur: relStart + r * 1.7 + 0.03,
      players,
      amp,
      cutoff: lpAt,
      q: 0.9,
      scoop: p.scoop ?? 0,
      scoopTime: 0.06,
      playerAttack: 0.012,
      clip: { dark: 1 - 0.6 * pv, pre: 0.05 + 1.4 * pv, bright: 0.55 * (p.blare ?? 1) * pv, k: 2.6 },
      noise: { f: Math.min(3500, Math.max(900, f * 3)), q: 1.2, env: (t) => (t < 0.012 ? b3 + (pk - b3) * (t / 0.012) : t < 0.02 ? pk : t < dur ? approach(pk, b3, t - 0.02, 0.03) : approach(pk, b3, dur - 0.02, 0.03) * Math.exp(-(t - dur) / 0.05)) },
      seed: rng.int(1, 1e9),
    });
  });
};

Wind.prototype._stab = function stab(n) {
  const ac = this.ac;
  const vb = vlayer(n.vel);
  const dur = Math.round(Math.max(0.06, Math.min(0.5, n.dur)) * 50) / 50;
  this.rr = ((this.rr ?? 0) + 1) % 3;
  const buf = this._stabBuf(n.midi, vb, this.rr, dur);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = (0.22 + 0.25 * n.vel) / (0.22 + 0.25 * VLAYERS[vb]);
  src.connect(g).connect(this.seat);
  src.start(n.t);
  src.stop(n.t + buf.duration);
};

/** Pre-render the cached stab takes a short brass note will need. */
Wind.prototype.warm = function warm(m, vel = 0.7) {
  if (!this.brass) return [];
  const vb = vlayer(vel);
  return [0, 1, 2].map((variant) => () => this._stabBuf(m, vb, variant, 0.16));
};

/**
 * Hurdy-gurdy / organ drone. Long notes; optional rhythmic "trompette" buzz
 * (opts.buzz = pulses per second).
 */
export class Drone extends Instrument {
  constructor(ac, o) {
    const reed = (o.wave ?? 'reed') === 'reed';
    super(ac, { eq: reed ? [{ type: 'peaking', f: 900, q: 1.5, g: 4 }, { type: 'peaking', f: 2400, q: 2, g: 3 }, { type: 'highshelf', f: 6000, g: -4 }] : [{ type: 'peaking', f: 900, q: 1.5, g: 4 }, { type: 'highshelf', f: 4500, g: -9 }], ...o });
    this.waveName = o.wave ?? 'reed';
    this.reed = reed;
  }

  play(t, m, dur, vel = 0.5, opts = {}) {
    const ac = this.ac;
    const f = mtof(m);
    const g = ac.createGain();
    const end = adsr(g.gain, t, dur, { a: opts.attack ?? 0.6, d: 0.3, s: 1, r: opts.release ?? 1.2, peak: (0.12 + 0.15 * vel) * 0.6 });
    const lp = kbq(ac);
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(12000, this.reed && opts.bright === undefined ? Math.max(f * 14, 3800) : f * (opts.bright ?? 6));
    lp.connect(g).connect(this.voicePan(opts.pan));
    const nodes = [];
    for (const [ratio, det, amp] of [[1, -3, 1], [1, 4, 0.7], [1.5, 0, opts.fifth ?? 0.35]]) {
      if (!amp) continue;
      const o = kosc(ac);
      o.setPeriodicWave(wave(ac, this.waveName));
      o.frequency.value = f * ratio * cents(det);
      const og = ac.createGain();
      og.gain.value = amp;
      o.connect(og).connect(lp);
      o.start(t);
      nodes.push(o);
    }
    // Wheel wobble: the rosined wheel never turns perfectly evenly.
    const w = lfo(ac, t, 0.7 + this.rng.range(0, 0.3), f * 0.6, 0, 1);
    w.g.connect(lp.frequency);
    nodes.push(w.o);
    if (opts.buzz) {
      // Trompette: the "dog" bridge rattles on every crank stroke — a raspy,
      // hard-clipped copy of the melody string gated by a smoothed pulse.
      const rasp = kosc(ac);
      rasp.type = 'sawtooth';
      rasp.frequency.value = f * 2;
      const pre = ac.createGain();
      pre.gain.value = 3;
      const ws = ac.createWaveShaper();
      const N = 512;
      const c = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        c[i] = Math.sign(x) * Math.min(1, Math.abs(x) * 2.5) ** 0.6;
      }
      ws.curve = c;
      const bp = kbq(ac);
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 1.1;
      const gate = ac.createGain();
      gate.gain.value = 0;
      const pulse = kosc(ac);
      pulse.type = 'square';
      pulse.frequency.value = opts.buzz;
      const sm = kbq(ac);
      sm.type = 'lowpass';
      sm.frequency.value = 45;
      const pd = ac.createGain();
      pd.gain.value = 0.5 * (opts.buzzLevel ?? 1);
      const dc = ac.createConstantSource ? ac.createConstantSource() : null;
      pulse.connect(sm).connect(pd).connect(gate.gain);
      if (dc) {
        dc.offset.value = 0.5 * (opts.buzzLevel ?? 1);
        dc.connect(gate.gain);
        dc.start(t);
        nodes.push(dc);
      }
      rasp.connect(pre).connect(ws).connect(bp).connect(gate);
      const rg = ac.createGain();
      rg.gain.value = 0.22;
      gate.connect(rg).connect(g);
      rasp.start(t);
      pulse.start(t);
      nodes.push(rasp, pulse);
    }
    for (const o of nodes) o.stop(end);
  }
}

/** Additive bells: church bell, hand bell, glockenspiel, celesta. */
const BELLS = {
  church: { partials: [[0.5, 1, 4], [1, 0.8, 3], [1.19, 0.6, 2.4], [1.5, 0.4, 2], [2, 0.5, 1.6], [2.5, 0.25, 1.2], [2.66, 0.2, 1.1], [3.01, 0.15, 0.9], [4.1, 0.1, 0.6]], hum: true },
  hand: { partials: [[1, 1, 1.6], [2.76, 0.35, 0.7], [5.4, 0.15, 0.35], [8.93, 0.06, 0.2]] },
  glock: { partials: [[1, 1, 1.1], [2.756, 0.45, 0.4], [5.404, 0.2, 0.18]] },
  celesta: { partials: [[1, 1, 1.2], [4, 0.18, 0.3], [2, 0.12, 0.6]] },
};

export class Bell extends Instrument {
  constructor(ac, o) {
    super(ac, o);
    this.b = BELLS[o.preset ?? 'hand'];
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    const ac = this.ac;
    const f = mtof(m);
    const dest = this.voicePan(opts.pan);
    const scale = opts.decay ?? 1;
    for (const [ratio, amp, dec] of this.b.partials) {
      const fr = f * ratio;
      if (fr > 16000) continue;
      const o = kosc(ac);
      o.frequency.value = fr * cents(this.rng.range(-3, 3));
      const g = ac.createGain();
      const pk = amp * (0.12 + 0.2 * vel);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(pk, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, dec * scale / 3);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dec * scale * 2.4 + 0.05);
    }
  }
}
