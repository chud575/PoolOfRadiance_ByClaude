import { Instrument, adsr, cents } from './base.js';
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
 * Bowed string section (violins → basses by register). An ensemble of
 * detuned Helmholtz (saw-like) voices, spread across the section's stereo
 * width, through a narrow-band body resonance bank so that vibrato makes the
 * harmonics shimmer in and out of the body modes (what makes real strings
 * sound alive). Continuous rosin noise follows bow pressure (velocity).
 * Articulations: legato (default, slurred phrases glide), spic, trem, swell.
 */
export class Strings extends Instrument {
  constructor(ac, o) {
    const body = o.body ?? (0.25 + 0.75 * Math.min(1, Math.max(0, ((o.bright ?? 0.5) - 0.28) / 0.34)));
    const eq = BODY.map(([f, q, g], i) => ({ type: 'peaking', f: i >= 4 ? f * (0.65 + 0.35 * body) : f * (0.3 + 0.7 * body), q, g }));
    eq.push({ type: 'highshelf', f: 9000, g: -3 });
    super(ac, { eq, ...o });
    this.voices = o.voices ?? 3;
    this.bright = o.bright ?? 0.5;
    this.spread = o.spread ?? 0.22;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  phrase(notes, opts = {}) {
    const ac = this.ac;
    const art = opts.art ?? 'legato';
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const spic = art === 'spic';
    const vel = n0.vel;
    const base = 0.07 + (1 - vel) * 0.16;
    const a = opts.attack ?? (spic ? 0.006 : art === 'swell' ? total * 0.6 : Math.min(base, 0.25 * n0.dur));
    const r = opts.release ?? (spic ? 0.08 : Math.min(0.5, 0.18 + total * 0.08));
    const g = ac.createGain();
    const lvl = (v) => ((0.16 + 0.22 * v) * 0.42) / Math.sqrt(this.voices);
    let end;
    if (spic) end = phraseEnv(g.gain, notes.map((n) => ({ ...n, dur: Math.min(n.dur, 0.09) })), { a, r, s: 0.3, dip: 0.6, level: lvl });
    else end = phraseEnv(g.gain, notes, { a, r, s: art === 'swell' ? 1 : 0.9, dip: opts.dip ?? 0.12, level: lvl });
    g.connect(this.voicePan(opts.pan));
    // Brightness: rosin energy up to several kHz even in the celli/basses.
    const topOf = (mm, v) => Math.min(16000, Math.max(mtof(mm) * 8, 2000 + 8000 * this.bright * (0.35 + v)));
    const nv = spic ? 1 : this.voices;
    const groups = nv > 1 ? 2 : 1;
    // One (stereo) brightness filter per note; the section's desks sit left
    // and right of the instrument's position ahead of it.
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    const top = topOf(n0.midi, vel);
    lp.frequency.setValueAtTime(spic ? top : Math.max(f * 2, top * 0.35), n0.t);
    lp.frequency.linearRampToValueAtTime(top, n0.t + Math.max(0.01, a * 0.8));
    for (let i = 1; i < notes.length; i++) lp.frequency.setTargetAtTime(topOf(notes[i].midi, notes[i].vel), notes[i].t, 0.04);
    lp.connect(g);
    const head = [];
    for (let k = 0; k < groups; k++) {
      if (groups > 1) {
        const p = ac.createStereoPanner();
        p.pan.value = (k ? 1 : -1) * this.spread;
        p.connect(lp);
        head.push(p);
      } else head.push(lp);
    }
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
      g.connect(g2).connect(this.voicePan(opts.pan));
      tr.start(n0.t);
      tr.stop(end);
    }
    const oscs = [];
    const freqParams = [];
    // One vibrato oscillator, fanned out to the desks at two depths.
    const vib = spic || total < 0.18 ? null : lfo(ac, n0.t, 5.2 + this.rng.range(-0.5, 0.5), f * 0.0045 * (opts.vib ?? 1), Math.min(0.25, n0.dur * 0.4), 0.5);
    let vib2 = vib;
    if (vib) {
      oscs.push(vib.o);
      const g2 = ac.createGain();
      g2.gain.value = -0.8;
      vib.g.connect(g2);
      vib2 = { g: g2 };
    }
    for (let i = 0; i < nv; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, 'bowed'));
      const det = cents((i - (nv - 1) / 2) * 7 + this.rng.range(-2.5, 2.5));
      o.frequency.setValueAtTime(f * det, n0.t);
      freqParams.push([o.frequency, det]);
      if (vib) (i % 2 ? vib2 : vib).g.connect(o.frequency);
      o.connect(head[i % groups]);
      oscs.push(o);
      o.start(n0.t + this.rng.range(0, spic ? 0.004 : 0.018));
    }
    glideFreqs(freqParams, notes, null, { glide: opts.glide ?? 0.07 });
    // Rosin: continuous bow noise following bow pressure, brightest on the attack.
    if (!opts.noBow && (spic ? vel > 0.55 : vel > 0.15 && total >= 0.2)) {
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(ac, 'white');
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(7500, Math.max(1800, f * 7));
      bp.Q.value = 0.7;
      const ng = ac.createGain();
      const bl = (v) => (spic ? 0.05 : 0.016) * v * (0.5 + this.bright);
      phraseEnv(ng.gain, notes.map((x) => ({ ...x, dur: spic ? 0.03 : x.dur })), { a: Math.min(0.02, a), r: 0.08, s: spic ? 0.2 : 0.45, dip: 0, level: bl });
      n.connect(bp).connect(ng).connect(head[0]);
      n.start(n0.t, noiseOffset(this.rng, total + 1));
      oscs.push(n);
    }
    for (const o of oscs) o.stop(end);
  }
}

const VOWELS = {
  ah: [[730, 1, 9], [1090, 0.5, 10], [2440, 0.22, 12], [3400, 0.08, 14]],
  oh: [[500, 1, 9], [880, 0.45, 10], [2500, 0.1, 12], [3300, 0.05, 14]],
  oo: [[330, 1, 8], [780, 0.3, 10], [2400, 0.06, 12]],
  ee: [[290, 1, 9], [2200, 0.32, 13], [2950, 0.2, 14]],
  mm: [[250, 1, 5], [1500, 0.04, 8]],
};

/**
 * Choir: buzzy voice sources through a shared parallel formant bank
 * (vowel per instance), several singers per note with independent vibrato,
 * spread across the stage. Slurred phrases glide.
 */
export class Choir extends Instrument {
  constructor(ac, o) {
    super(ac, o);
    const vowel = VOWELS[o.vowel ?? 'ah'];
    this.voices = o.voices ?? 4;
    this.formIn = ac.createGain();
    for (const [f, amp, q] of vowel) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (o.formantShift ?? 1);
      bp.Q.value = q;
      const g = ac.createGain();
      g.gain.value = amp * 3.2;
      this.formIn.connect(bp).connect(g).connect(this.input);
    }
    // Sibilant air above the formants (the "breath" of a real choir).
    const air = ac.createBiquadFilter();
    air.type = 'highpass';
    air.frequency.value = 4500;
    const ag = ac.createGain();
    ag.gain.value = 0.35;
    this.formIn.connect(air).connect(ag).connect(this.input);
    this.breath = o.breath ?? 0.06;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  phrase(notes, opts = {}) {
    const ac = this.ac;
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const g = ac.createGain();
    const a = opts.attack ?? Math.min(0.32, 0.3 * n0.dur + 0.04);
    const end = phraseEnv(g.gain, notes, { a, r: opts.release ?? 0.7, s: 0.94, dip: 0.08, level: (v) => ((0.18 + 0.3 * v) * 0.42) / Math.sqrt(this.voices) });
    g.connect(this.formIn);
    const nodes = [];
    const v = lfo(ac, n0.t, 5 + this.rng.range(-0.5, 0.5), f * 0.006, 0.25, 0.6);
    const dr = lfo(ac, n0.t, 0.23 + this.rng.range(0, 0.2), f * 0.003, 0, 0.1);
    nodes.push(v.o, dr.o);
    const fp = [];
    const cp = [-0.3, 0.3].map((x) => {
      const p = ac.createStereoPanner();
      p.pan.value = x;
      p.connect(g);
      return p;
    });
    for (let i = 0; i < this.voices; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, 'voice'));
      const det = cents(this.rng.range(-9, 9));
      o.frequency.setValueAtTime(f * det, n0.t);
      fp.push([o.frequency, det]);
      (i % 2 ? dr : v).g.connect(o.frequency);
      o.connect(cp[i % 2]);
      o.start(n0.t + this.rng.range(0, 0.06));
      nodes.push(o);
    }
    glideFreqs(fp, notes, null, { glide: 0.09 });
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac, 'pink');
    const ng = ac.createGain();
    ng.gain.value = this.breath * n0.vel;
    n.connect(ng).connect(g);
    n.start(n0.t, noiseOffset(this.rng, total + 1));
    nodes.push(n);
    for (const o of nodes) o.stop(end);
  }
}

/**
 * Wind instruments: flute / recorder / horn / brass / bassoon / shawm.
 * Brass get a velocity-tracking filter sweep ("blat"), a pitch scoop on the
 * first note of a phrase only, breath noise and lip buzz (a soft-clipping
 * stage that turns loud notes brassy). Slurred phrases glide and tongue.
 */
const WIND = {
  flute: { wave: 'flute', a: 0.07, r: 0.18, breath: 0.12, chiff: 0.25, vib: [5.1, 0.006, 0.25], lp: 7, scoop: 0, dip: 0.3 },
  recorder: { wave: 'flute', a: 0.03, r: 0.08, breath: 0.07, chiff: 0.45, vib: [5.6, 0.0025, 0.3], lp: 9, scoop: 0, tri: 0.25, dip: 0.45 },
  horn: { wave: 'horn', a: 0.05, r: 0.25, breath: 0.03, chiff: 0.1, vib: [4.8, 0.0018, 0.35], lp: 2.6, lpVel: 7, scoop: -28, sweep: 0.08, voices: 2, dip: 0.3 },
  brass: { wave: 'horn', a: 0.035, r: 0.2, breath: 0.03, chiff: 0.12, vib: [5, 0.0012, 0.4], lp: 3.2, lpVel: 11, scoop: -30, sweep: 0.05, voices: 2, dip: 0.35 },
  lowbrass: { wave: 'horn', a: 0.06, r: 0.3, breath: 0.025, chiff: 0.08, vib: [4.5, 0.001, 0.5], lp: 3, lpVel: 8, scoop: -18, sweep: 0.09, voices: 2, dip: 0.3 },
  bassoon: { wave: 'reed', a: 0.05, r: 0.15, breath: 0.03, chiff: 0.1, vib: [5, 0.003, 0.3], lp: 5, scoop: -10, dip: 0.3 },
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
    const eq = p.wave === 'horn' ? [{ type: 'peaking', f: 600, q: 0.8, g: 2 }, { type: 'peaking', f: 1400, q: 1.2, g: 1.5 }, { type: 'highshelf', f: 6500, g: -5 }] : p.wave === 'flute' ? [{ type: 'highshelf', f: 8000, g: -6 }] : [{ type: 'peaking', f: 1200, q: 1.2, g: 3 }, { type: 'highshelf', f: 6000, g: -6 }];
    super(ac, { eq, ...o });
    this.p = p;
    if (p.wave === 'horn') this.clip = softClipCurve(1.6);
  }

  play(t, m, dur, vel = 0.65, opts = {}) {
    this.phrase([{ t, midi: m, dur, vel }], opts);
  }

  phrase(notes, opts = {}) {
    const ac = this.ac;
    const p = this.p;
    const n0 = notes[0];
    const f = mtof(n0.midi);
    const vel = n0.vel;
    const last = notes[notes.length - 1];
    const total = last.t + last.dur - n0.t;
    const g = ac.createGain();
    const isBrass = p.wave === 'horn';
    const a = opts.attack ?? Math.min(p.a * (isBrass ? 1.6 - vel : 1), 0.3 * n0.dur);
    const end = phraseEnv(g.gain, notes, { a, r: opts.release ?? p.r, s: 0.86, dip: opts.dip ?? p.dip, level: (v) => (0.22 + 0.25 * v) * 0.36 });
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = isBrass ? 1.1 : 0.5;
    const topOf = (mm, v) => Math.min(14000, mtof(mm) * (p.lp + (p.lpVel ?? 0) * v * v));
    const top = topOf(n0.midi, vel);
    if (isBrass) {
      const sw = n0.t + p.sweep * (1.4 - vel);
      lp.frequency.setValueAtTime(f * 1.1, n0.t);
      lp.frequency.linearRampToValueAtTime(top, sw);
      let ft = Math.max(sw, n0.t + p.sweep * 2);
      lp.frequency.setTargetAtTime(top * 0.75, ft, 0.25);
      for (let i = 1; i < notes.length; i++) {
        const tp = topOf(notes[i].midi, notes[i].vel);
        const t1 = Math.max(ft + 0.001, notes[i].t);
        lp.frequency.setTargetAtTime(tp, t1, 0.02);
        ft = t1 + 0.12;
        lp.frequency.setTargetAtTime(tp * 0.75, ft, 0.25);
      }
      lp.frequency.setTargetAtTime(mtof(last.midi) * 1.2, Math.max(ft + 0.001, last.t + last.dur), 0.08);
    } else {
      lp.frequency.setValueAtTime(top, n0.t);
      for (let i = 1; i < notes.length; i++) lp.frequency.setTargetAtTime(topOf(notes[i].midi, notes[i].vel), notes[i].t, 0.03);
    }
    lp.connect(g);
    if (!isBrass) g.connect(this.voicePan(opts.pan));
    else {
      // Lip buzz, per note (a shared shaper would intermodulate chords into mud):
      // drive → soft clip → makeup, so loud notes turn brassy.
      const drive = ac.createGain();
      drive.gain.value = 3.2;
      const ws = ac.createWaveShaper();
      ws.curve = this.clip;
      const make = ac.createGain();
      make.gain.value = 1 / 3.2;
      g.connect(drive).connect(ws).connect(make).connect(this.voicePan(opts.pan));
    }
    const nodes = [];
    const vib = total > p.vib[2] + 0.1 ? lfo(ac, n0.t, p.vib[0] + this.rng.range(-0.3, 0.3), f * p.vib[1] * (opts.vib ?? 1), p.vib[2], 0.45) : null;
    if (vib) nodes.push(vib.o);
    const voices = p.voices ?? 1;
    const fp = [];
    for (let i = 0; i < voices; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, p.wave));
      const det = cents(voices > 1 ? (i - (voices - 1) / 2) * 7 : 0);
      // Scoop into the first note of a phrase only.
      o.frequency.setValueAtTime(f * det * cents(opts.scoop ?? p.scoop ?? 0), n0.t);
      o.frequency.exponentialRampToValueAtTime(f * det, n0.t + 0.06);
      fp.push([o.frequency, det]);
      vib?.g.connect(o.frequency);
      if (voices > 1) {
        const pn = ac.createStereoPanner();
        pn.pan.value = (i ? 1 : -1) * 0.12;
        o.connect(pn).connect(lp);
      } else o.connect(lp);
      o.start(n0.t);
      nodes.push(o);
    }
    glideFreqs(fp, notes, null, { glide: isBrass ? 0.05 : 0.045 });
    if (p.tri) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 2, n0.t);
      glideFreqs([[o.frequency, 2]], notes, null, { glide: 0.045 });
      const tg = ac.createGain();
      tg.gain.value = p.tri * 0.3;
      o.connect(tg).connect(lp);
      o.start(n0.t);
      nodes.push(o);
    }
    // Breath noise (tuned band) + tongue chiff on every articulation.
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac, 'white');
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isBrass ? Math.min(3500, Math.max(900, f * 3)) : Math.min(12000, f * 2);
    bp.Q.value = isBrass ? 1.2 : 2;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0, n0.t);
    for (const x of notes) {
      const pk = p.breath * 0.5 + p.chiff * 0.6 * x.vel * (x === n0 ? 1 : 0.5);
      ng.gain.setValueAtTime(p.breath * 0.3, Math.max(n0.t, x.t - 0.001));
      ng.gain.linearRampToValueAtTime(pk, x.t + 0.012);
      ng.gain.setTargetAtTime(p.breath * 0.3, x.t + 0.02, 0.03);
    }
    ng.gain.setTargetAtTime(0, last.t + last.dur, 0.05);
    n.connect(bp).connect(ng).connect(g);
    n.start(n0.t, noiseOffset(this.rng, total + 1));
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
    const lp = ac.createBiquadFilter();
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
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 1.1;
      const gate = ac.createGain();
      gate.gain.value = 0;
      const pulse = ac.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = opts.buzz;
      const sm = ac.createBiquadFilter();
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
