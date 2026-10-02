import { Instrument, adsr, cents, voiceBudget, kbq } from './base.js';
import { mtof } from '../core/notes.js';
import { noiseBuffer, noiseOffset } from '../dsp/bank.js';

/** Shared PeriodicWaves (per context) for more instrument-like spectra than raw saws. */
const waveCache = new WeakMap();
function wave(ac, name) {
  let m = waveCache.get(ac);
  if (!m) waveCache.set(ac, (m = new Map()));
  if (m.has(name)) return m.get(name);
  // Enough partials that even a low C (65 Hz) reaches ~10 kHz: real bowed strings,
  // brass and reeds carry energy far above the old 48-harmonic ceiling.
  const H = 160;
  const re = new Float32Array(H);
  const im = new Float32Array(H);
  for (let n = 1; n < H; n++) {
    let a = 0;
    switch (name) {
      case 'bowed': // saw-like with a body formant bump and a rolled-off top
        a = (1 / Math.pow(n, 1.05)) * (1 + 0.8 * Math.exp(-((n - 4) ** 2) / 6)) * (n > 24 ? 0.6 : 1);
        break;
      case 'bowed2': // another player / instrument: bump higher, a weaker 2nd, slightly darker top
        a = (1 / Math.pow(n, 1.12)) * (1 + 0.9 * Math.exp(-((n - 6) ** 2) / 8)) * (n === 2 ? 0.7 : 1) * (n > 20 ? 0.65 : 1);
        break;
      case 'bowed3': // a brighter, thinner fiddle: lower bump, a notch near the 9th (bow position)
        a = (1 / Math.pow(n, 0.98)) * (1 + 0.6 * Math.exp(-((n - 3) ** 2) / 4)) * (1 - 0.7 * Math.exp(-((n - 9) ** 2) / 2)) * (n > 28 ? 0.55 : 1);
        break;
      case 'oboe': // double reed: weak fundamental, strong 2nd–5th, formants ~1.1 k and ~3 k (applied as EQ)
        a = (n === 1 ? 0.45 : n <= 5 ? 1 / Math.pow(n, 0.35) : 1.2 / Math.pow(n, 1.1)) * (n > 30 ? 0.5 : 1);
        break;
      case 'clarinet': // cylindrical bore: odd harmonics dominate low, evens fill in high up
        a = (n % 2 ? 1 / Math.pow(n, 0.9) : (n < 6 ? 0.06 : 0.35) / Math.pow(n, 1.0)) * (n > 26 ? 0.5 : 1);
        break;
      case 'horn': // brass: strong 2-5th harmonics
        a = (1 / Math.pow(n, 1.35)) * (n >= 2 && n <= 6 ? 1.6 : 1);
        break;
      case 'reed': // odd-heavy (shawm / bassoon flavour)
        a = (n % 2 ? 1 : 0.35) / Math.pow(n, 0.95);
        break;
      case 'flute':
        a = n === 1 ? 1 : n === 2 ? 0.22 : n === 3 ? 0.08 : n === 4 ? 0.03 : 0;
        break;
      case 'organ':
        a = [0, 1, 0.5, 0.25, 0.3, 0.1, 0.12, 0, 0.08][n] ?? 0;
        break;
      case 'voice':
        a = 1 / Math.pow(n, 1.2);
        break;
      default:
        a = 1 / n;
    }
    im[n] = a;
  }
  const w = ac.createPeriodicWave(re, im);
  m.set(name, w);
  return w;
}

function lfo(ac, t, rate, depth, delay = 0, rampTo = 0.4) {
  const o = ac.createOscillator();
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

/** Glide every frequency param between successive notes of a phrase (portamento ≤ 80 ms). */
function glideFreqs(params, notes, ratioOf, { glide = 0.06 } = {}) {
  let at = notes[0].t + 0.065; // after the first note's scoop
  for (let i = 1; i < notes.length; i++) {
    const n = notes[i];
    const p = notes[i - 1];
    if (n.midi === p.midi) continue;
    const g = Math.max(0.025, Math.min(glide, n.dur * 0.3, p.dur * 0.5));
    const t0 = Math.max(at, n.t - g * 0.5);
    const t1 = Math.max(t0 + 0.015, n.t + g * 0.5);
    for (const [param, det] of params) {
      param.setValueAtTime(mtof(p.midi) * det, t0);
      param.exponentialRampToValueAtTime(mtof(n.midi) * det, t1);
    }
    at = t1 + 0.001;
  }
  void ratioOf;
}

/** Body resonances of the violin family (Hz, Q, gain dB), scaled by register. */
const BODY = [[285, 3.2, 3.5], [470, 4.5, 2], [1060, 5, 3.5], [1600, 4, -3.5], [2700, 1.8, 3.5], [4300, 3, -2.5]];
/**
 * Narrow, irregular body modes (peaks and dips a few % wide). A partial that
 * vibrato sweeps across them rises and falls in level, so vibrato reads as
 * the shimmering amplitude/timbre modulation of a real wooden box, not just
 * a pitch wobble.
 */
const MODES = [[640, 14, 4.5], [905, 16, -4.5], [1370, 15, 4.5], [1830, 14, -4], [2330, 16, 4], [3150, 15, -3.5], [3700, 13, 3]];

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
    // Players are seated individually: the section is panned per player, not as a block.
    super(ac, { eq, ...o, pan: 0, chorus: 0 });
    this.center = o.pan ?? 0;
    this.voices = o.voices ?? 6;
    this.bright = o.bright ?? 0.5;
    this.spread = o.spread ?? 0.32;
    this.body = body;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
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
    const spic = false;
    const vel = n0.vel;
    const base = 0.07 + (1 - vel) * 0.16;
    const a = opts.attack ?? (spic ? 0.006 : art === 'swell' ? total * 0.6 : Math.min(base, 0.25 * n0.dur));
    const r = opts.release ?? (spic ? 0.08 : Math.min(0.5, 0.18 + total * 0.08));
    // Section size for this note: divisi chords share the players.
    const divisi = Math.max(1, opts.divisi ?? 1);
    const want = spic ? Math.min(3, this.voices) : Math.max(this.voices > 1 ? 2 : 1, Math.round(this.voices / Math.sqrt(divisi)));
    const nv = voiceBudget(ac, n0.t, last.t + last.dur + 0.5, want, Math.min(2, want));
    const g = ac.createGain();
    const lvl = (v) => ((0.16 + 0.22 * v) * 0.42) / Math.sqrt(nv);
    const envNotes = spic ? notes.map((n) => ({ ...n, dur: Math.min(n.dur, 0.09) })) : notes;
    const envO = spic ? { a, r, s: 0.3, dip: 0.6 } : { a, r, s: art === 'swell' ? 1 : 0.9, dip: opts.dip ?? 0.12 };
    const end = phraseEnv(g.gain, envNotes, { ...envO, level: lvl });
    // Bow pressure: rises a little behind the amplitude (the bow bites, then the tone blooms).
    const pr = pressureSignal(ac, envNotes, { ...envO, a: a * 1.4 + 0.01, level: (v) => 0.25 + 0.75 * v });
    g.connect(this.input);
    // Brightness follows pressure.
    const lp = kbq(ac);
    lp.type = 'lowpass';
    lp.Q.value = 0.45;
    const lo = Math.min(9000, Math.max(f * 4.5, 1000));
    const top = Math.min(16000, Math.max(f * 11, 2600 + 9000 * this.bright));
    lp.frequency.value = lo;
    drive(ac, pr.cs, lp.frequency, top - lo);
    // A second pole: soft bowing really does lose the upper partials (24 dB/oct).
    const lp2 = kbq(ac);
    lp2.type = 'lowpass';
    lp2.Q.value = 0.5;
    lp2.frequency.value = lo * 1.6;
    drive(ac, pr.cs, lp2.frequency, (top - lo) * 1.6);
    // The bridge hill: a broad formant that grows with bow pressure.
    const hill = kbq(ac);
    hill.type = 'peaking';
    hill.frequency.value = 2500 + 1000 * this.body;
    hill.Q.value = 0.9;
    hill.gain.value = -4;
    drive(ac, pr.cs, hill.gain, 10);
    lp.connect(lp2).connect(hill).connect(g);
    if (art === 'trem') {
      const tr = ac.createOscillator();
      tr.type = 'triangle';
      tr.frequency.value = opts.tremRate ?? 13;
      const tg = ac.createGain();
      tg.gain.value = 0.5;
      const g2 = ac.createGain();
      g2.gain.value = 0.5;
      tr.connect(tg).connect(g2.gain);
      g.disconnect();
      g.connect(g2).connect(this.input);
      tr.start(n0.t);
      tr.stop(end);
    }
    const nodes = [pr.cs];
    const freqParams = [];
    const vibOn = !spic && total >= 0.18;
    // Desks: two players share a stand (and a stereo position) across the section's width.
    const desks = Math.max(1, Math.ceil(nv / 2));
    const deskIn = [];
    for (let k = 0; k < desks; k++) {
      const seat = desks > 1 ? k / (desks - 1) - 0.5 : 0;
      const pn = ac.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, this.center + seat * 2 * this.spread + rng.range(-0.04, 0.04)));
      pn.connect(lp);
      deskIn.push(pn);
    }
    // Slow intonation drift on long notes: one wandering LFO, the desks drifting against each other.
    let drift = null;
    if (vibOn && total > 1.5) {
      const d = lfo(ac, n0.t, rng.range(0.1, 0.3), f * 0.0035, 0, 0.5);
      const inv = ac.createGain();
      inv.gain.value = -1;
      d.g.connect(inv);
      drift = [d.g, inv];
      nodes.push(d.o);
    }
    // Vibrato rate wanders (players speed up and relax): one slow LFO shared
    // by the section, each player following it with their own sign and depth.
    let rateWob = null;
    if (vibOn && total > 0.6) {
      rateWob = lfo(ac, n0.t, rng.range(0.25, 0.55), 1, 0, 0.3);
      nodes.push(rateWob.o);
    }
    const waves = ['bowed', 'bowed2', 'bowed3'];
    const deskVib = [];
    for (let i = 0; i < nv; i++) {
      const pg = ac.createGain();
      pg.connect(deskIn[i % desks]);
      const o = ac.createOscillator();
      // Every player's instrument has its own spectrum.
      o.setPeriodicWave(wave(ac, waves[(i + (this.o.seed ?? 0)) % 3]));
      const det = cents(rng.range(-6, 6));
      o.frequency.setValueAtTime(f * det, n0.t);
      freqParams.push([o.frequency, det]);
      if (vibOn) {
        // Own vibrato: ±15–25 cents (a real section, not a synth pad), rate,
        // depth and a delayed onset all personal; shorter notes vibrate less.
        const depthC = rng.range(15, 25) * Math.min(1, 0.45 + total * 0.5) * (opts.vib ?? 1);
        const rate = rng.range(4.8, 6.3);
        // Big sections share one vibrato per desk (the stand partners still
        // differ in depth and intonation): half the LFOs for the audio thread.
        const desk = i % desks;
        let v = nv > 4 ? deskVib[desk] : null;
        if (!v) {
          v = lfo(ac, n0.t, rate, f * (cents(depthC) - 1), Math.min(0.4, n0.dur * rng.range(0.25, 0.5)), rng.range(0.35, 0.8));
          if (rateWob) drive(ac, rateWob.g, v.o.frequency, rng.range(-0.7, 0.7));
          nodes.push(v.o);
          if (nv > 4) deskVib[desk] = v;
          v.g.connect(o.frequency);
        } else drive(ac, v.g, o.frequency, rng.range(0.7, 1.25));
        if (drift) drift[i % 2].connect(o.frequency);
      }
      o.connect(pg);
      // Each player's own bow attack (no step when a late player joins a sounding section).
      const ts = n0.t + rng.range(0, spic ? 0.006 : 0.035);
      pg.gain.setValueAtTime(0, ts);
      pg.gain.linearRampToValueAtTime(rng.range(0.8, 1.15), ts + (spic ? 0.004 : 0.03));
      o.start(ts);
      nodes.push(o);
    }
    glideFreqs(freqParams, notes, null, { glide: opts.glide ?? 0.07 });
    // Rosin: continuous bow noise that follows bow pressure, brightest on the attack.
    if (!opts.noBow && (spic ? vel > 0.5 : vel > 0.15 && total >= 0.2)) {
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(ac, 'white');
      const bp = kbq(ac);
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(7500, Math.max(1800, f * 7));
      bp.Q.value = 0.7;
      const ng = ac.createGain();
      ng.gain.value = 0;
      drive(ac, pr.cs, ng.gain, (spic ? 0.06 : 0.02) * (0.5 + this.bright) / Math.sqrt(nv));
      // Extra scrape on each bow change.
      const sc = ac.createGain();
      sc.gain.value = 0;
      for (const x of notes) {
        sc.gain.setValueAtTime(0, Math.max(n0.t, x.t - 0.001));
        sc.gain.linearRampToValueAtTime(0.02 * x.vel, x.t + 0.006);
        sc.gain.setTargetAtTime(0, x.t + 0.01, 0.02);
      }
      n.connect(bp);
      bp.connect(ng).connect(lp);
      bp.connect(sc).connect(lp);
      n.start(n0.t, noiseOffset(rng, total + 1));
      nodes.push(n);
    }
    for (const o of nodes) o.stop(end);
  }
}

/**
 * Spiccato: a short bounced stroke — two desks, the bow's bite as a burst of
 * rosin and a brightness that depends on how hard the stroke is. (Its own
 * lean voice: ostinati fire many of these per second.)
 */
Strings.prototype._spic = function spic(n, opts = {}) {
  const ac = this.ac;
  const rng = this.rng;
  const f = mtof(n.midi);
  const vel = n.vel;
  const len = Math.min(n.dur, 0.09);
  const g = ac.createGain();
  const peak = ((0.16 + 0.22 * vel) * 0.42) / Math.sqrt(2) * 1.2;
  g.gain.setValueAtTime(0, n.t);
  g.gain.linearRampToValueAtTime(peak, n.t + 0.006);
  g.gain.setTargetAtTime(peak * 0.35, n.t + 0.012, len * 0.5);
  g.gain.setTargetAtTime(0, n.t + len, 0.025);
  const end = n.t + len + 0.15;
  const lp = kbq(ac);
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  const top = Math.min(14000, Math.max(f * 6, 1500 + 7000 * this.bright * (0.3 + vel)));
  lp.frequency.setValueAtTime(top, n.t);
  lp.frequency.setTargetAtTime(top * 0.5, n.t + 0.01, 0.04);
  lp.connect(g).connect(this.input);
  for (let k = 0; k < 2; k++) {
    const o = ac.createOscillator();
    o.setPeriodicWave(wave(ac, 'bowed'));
    o.frequency.value = f * cents(rng.range(-7, 7));
    const pn = ac.createStereoPanner();
    pn.pan.value = Math.max(-1, Math.min(1, this.center + (k ? 1 : -1) * this.spread * 0.8));
    o.connect(pn).connect(lp);
    const ts = n.t + rng.range(0, 0.006);
    o.start(ts);
    o.stop(end);
  }
  if (!opts.noBow && vel > 0.5) {
    const ns = ac.createBufferSource();
    ns.buffer = noiseBuffer(ac, 'white');
    const bp = kbq(ac);
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(7500, Math.max(1800, f * 7));
    bp.Q.value = 0.8;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0, n.t);
    ng.gain.linearRampToValueAtTime(0.05 * vel * (0.5 + this.bright), n.t + 0.004);
    ng.gain.setTargetAtTime(0, n.t + 0.008, 0.012);
    ns.connect(bp).connect(ng).connect(g);
    ns.start(n.t, noiseOffset(rng, 1));
    ns.stop(n.t + 0.08);
  }
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
 * Choir: two half-sections per note, each with its own formant bank whose
 * frequencies are jittered per section (different singers, different
 * vocal tracts), 2–4 singers each with personal pitch, vibrato and onset.
 * The vowel changes syllable by syllable through a phrase (and drifts inside
 * long notes, ah→oh), and syllables start with soft consonants — s, t, k
 * bursts or an l/n dip — so the choir sings words, not a fixed "aah".
 */
export class Choir extends Instrument {
  constructor(ac, o) {
    super(ac, { ...o, pan: 0, chorus: 0 });
    this.center = o.pan ?? 0;
    this.vowel = o.vowel ?? 'ah';
    this.text = o.text ?? TEXTS[this.vowel] ?? [this.vowel];
    this.voices = o.voices ?? 6;
    this.shift = o.formantShift ?? 1;
    this.breath = o.breath ?? 0.06;
    this.syl = 0;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  phrase(notes, opts = {}) {
    const ac = this.ac;
    const rng = this.rng;
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const divisi = Math.max(1, opts.divisi ?? 1);
    const nv = voiceBudget(ac, n0.t, last.t + last.dur + 0.8, Math.max(2, Math.round(this.voices / Math.sqrt(divisi))), 2);
    const g = ac.createGain();
    const a = opts.attack ?? Math.min(0.32, 0.3 * n0.dur + 0.04);
    const end = phraseEnv(g.gain, notes, { a, r: opts.release ?? 0.7, s: 0.94, dip: 0.1, level: (v) => ((0.18 + 0.3 * v) * 0.42) / Math.sqrt(nv) });
    g.connect(this.input);
    const syl = notes.map(() => {
      const k = this.syl++;
      const fixed = this.vowel === 'mm';
      return { v: fixed ? 'mm' : this.text[k % this.text.length], c: fixed ? '' : CONSONANTS[(k * 7 + 3) % CONSONANTS.length] };
    });
    const nodes = [];
    const fp = [];
    for (let half = 0; half < 2; half++) {
      // This half-section's vocal tract.
      const sh = this.shift * (half ? rng.range(1.015, 1.05) : rng.range(0.95, 0.985));
      const sec = ac.createGain();
      const pn = ac.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, this.center + (half ? 0.32 : -0.32)));
      sec.connect(pn).connect(g);
      const src = ac.createGain();
      for (let fi = 0; fi < 4; fi++) {
        const bp = kbq(ac);
        bp.type = 'bandpass';
        const V0 = VOWELS[syl[0].v][fi];
        bp.Q.value = V0[2];
        bp.frequency.setValueAtTime(V0[0] * sh, n0.t);
        const fg = ac.createGain();
        fg.gain.setValueAtTime(V0[1] * 3.2, n0.t);
        notes.forEach((n, k) => {
          const V = VOWELS[syl[k].v][fi];
          if (k) {
            bp.frequency.setTargetAtTime(V[0] * sh, n.t - 0.02, 0.035);
            fg.gain.setTargetAtTime(V[1] * 3.2, n.t - 0.02, 0.035);
          }
          // Long notes drift toward a darker vowel (ah → oh, eh → ah …).
          if (n.dur > 1.2 && syl[k].v !== 'mm') {
            const to = VOWELS[{ ah: 'oh', eh: 'ah', ee: 'eh', oh: 'oo', oo: 'oh' }[syl[k].v]][fi];
            const t1 = n.t + n.dur * 0.45;
            bp.frequency.setTargetAtTime(V[0] * sh * 0.6 + to[0] * sh * 0.4, t1, n.dur * 0.25);
          }
        });
        src.connect(bp).connect(fg).connect(sec);
      }
      // Breath air above the formants.
      const air = kbq(ac);
      air.type = 'highpass';
      air.frequency.value = 4500;
      const ag = ac.createGain();
      ag.gain.value = 0.3;
      src.connect(air).connect(ag).connect(sec);
      // Singers.
      const per = Math.ceil(nv / 2);
      // Every singer is a person: own vibrato (4.8–6.2 Hz, ±15–30 cents,
      // arriving late on long notes) and a slow pitch scatter (±8 cents) made
      // from two wandering LFOs that each singer follows with their own weights.
      const long = total > 0.5;
      const wander = long ? [0, 1].map(() => lfo(ac, n0.t, rng.range(0.07, 0.23), f * (cents(8) - 1), 0, 0.6)) : [];
      nodes.push(...wander.map((x) => x.o));
      let pairVib = null;
      for (let i = 0; i < per; i++) {
        const o = ac.createOscillator();
        o.setPeriodicWave(wave(ac, 'voice'));
        const det = cents(rng.range(-9, 9));
        o.frequency.setValueAtTime(f * det, n0.t);
        fp.push([o.frequency, det]);
        if (long) {
          // Large sections pair neighbours on one vibrato (own depth each); small ones are all individual.
          let v = per > 3 && i % 2 ? pairVib : null;
          if (v) drive(ac, v.g, o.frequency, rng.range(0.7, 1.3));
          else {
            v = lfo(ac, n0.t, rng.range(4.8, 6.2), f * (cents(rng.range(15, 30)) - 1), rng.range(0.12, Math.min(0.6, total * 0.3)), rng.range(0.4, 0.9));
            v.g.connect(o.frequency);
            nodes.push(v.o);
            pairVib = v;
          }
          for (const w of wander) drive(ac, w.g, o.frequency, rng.range(-1, 1));
        }
        const og = ac.createGain();
        const ts = n0.t + rng.range(0, 0.07);
        og.gain.setValueAtTime(0, ts);
        og.gain.linearRampToValueAtTime(rng.range(0.75, 1.1), ts + 0.05);
        o.connect(og).connect(src);
        o.start(ts);
        nodes.push(o);
      }
      // Consonant onsets for this half (slightly different timing per half).
      notes.forEach((n, k) => {
        const c = syl[k].c;
        if (!c || n.vel < 0.2) return;
        const t0 = Math.max(n0.t, n.t - (c === 's' ? 0.07 : 0.02)) + rng.range(0, 0.015);
        const ns = ac.createBufferSource();
        ns.buffer = noiseBuffer(ac, 'white');
        const flt = kbq(ac);
        flt.type = c === 's' ? 'highpass' : 'bandpass';
        flt.frequency.value = c === 's' ? 5500 : c === 'k' ? 2200 : c === 't' ? 3800 : 900;
        flt.Q.value = c === 's' ? 0.7 : 1.5;
        const cg = ac.createGain();
        const pk = (c === 's' ? 0.05 : c === 'l' || c === 'n' ? 0.015 : 0.06) * n.vel / Math.sqrt(nv);
        const len = c === 's' ? 0.08 : c === 'l' || c === 'n' ? 0.05 : 0.018;
        cg.gain.setValueAtTime(0, t0);
        cg.gain.linearRampToValueAtTime(pk, t0 + Math.min(0.02, len * 0.4));
        cg.gain.linearRampToValueAtTime(0, t0 + len);
        ns.connect(flt).connect(cg).connect(sec);
        ns.start(t0, noiseOffset(rng, 1));
        ns.stop(t0 + len + 0.02);
      });
    }
    glideFreqs(fp, notes, null, { glide: 0.09 });
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac, 'pink');
    const ng = ac.createGain();
    ng.gain.value = this.breath * n0.vel;
    n.connect(ng).connect(g);
    n.start(n0.t, noiseOffset(rng, total + 1));
    nodes.push(n);
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
    super(ac, { eq, ...o, ...(brass ? { pan: 0 } : {}) });
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
      drive(ac, pr.cs, pre.gain, 1.4);
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
    // Short stabs: half the section (keeps fast brass figures cheap and tight).
    const voices = total < 0.5 ? Math.min(2, p.voices ?? 1) : p.voices ?? 1;
    const fp = [];
    const vibOk = total > p.vib[2] + 0.1;
    const sharedVib = !isBrass && vibOk ? lfo(ac, n0.t, p.vib[0] + rng.range(-0.3, 0.3), f * p.vib[1] * (opts.vib ?? 1), p.vib[2], 0.45) : null;
    if (sharedVib) nodes.push(sharedVib.o);
    // Brass: one vibrato for the section, each player following it at their own depth.
    const brassVib = isBrass && vibOk ? lfo(ac, n0.t, p.vib[0] + rng.range(-0.4, 0.4), f * p.vib[1] * (opts.vib ?? 1), p.vib[2] + rng.range(0, 0.2), 0.5) : null;
    if (brassVib) nodes.push(brassVib.o);
    for (let i = 0; i < voices; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, p.wave));
      const det = cents(voices > 1 ? rng.range(-5, 5) : 0);
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
      else if (brassVib) drive(ac, brassVib.g, o.frequency, rng.range(0.6, 1.4));
      if (voices > 1) {
        const og = ac.createGain();
        og.gain.setValueAtTime(0, t0);
        og.gain.linearRampToValueAtTime(rng.range(0.8, 1.1) / Math.sqrt(voices / 2), t0 + 0.012);
        o.connect(og).connect(head);
      } else o.connect(head);
      o.start(t0);
      nodes.push(o);
    }
    glideFreqs(fp, notes, null, { glide: isBrass ? 0.05 : 0.045 });
    // Fall: the pitch drops away as the note is released.
    if (art === 'fall') {
      const tf = last.t + last.dur - 0.02;
      for (const [param, det] of fp) {
        param.setValueAtTime(mtof(last.midi) * det, tf);
        param.exponentialRampToValueAtTime(mtof(last.midi) * det * cents(-700), tf + rel);
      }
    }
    if (p.tri) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 2, n0.t);
      glideFreqs([[o.frequency, 2]], notes, null, { glide: 0.045 });
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
      const o = ac.createOscillator();
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
      const rasp = ac.createOscillator();
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
      const pulse = ac.createOscillator();
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
      const o = ac.createOscillator();
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
