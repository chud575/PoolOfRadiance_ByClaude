import { Instrument, adsr, cents } from './base.js';
import { mtof } from '../core/notes.js';
import { noiseBuffer } from '../dsp/bank.js';

/** Shared PeriodicWaves (per context) for more instrument-like spectra than raw saws. */
const waveCache = new WeakMap();
function wave(ac, name) {
  let m = waveCache.get(ac);
  if (!m) waveCache.set(ac, (m = new Map()));
  if (m.has(name)) return m.get(name);
  const H = 48;
  const re = new Float32Array(H);
  const im = new Float32Array(H);
  for (let n = 1; n < H; n++) {
    let a = 0;
    switch (name) {
      case 'bowed': // saw-like with a body formant bump and a rolled-off top
        a = (1 / Math.pow(n, 1.05)) * (1 + 0.8 * Math.exp(-((n - 4) ** 2) / 6)) * (n > 24 ? 0.5 : 1);
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
 * Bowed string section (violins → basses by register). Ensemble of detuned
 * "bowed" waves with independent vibrato, brightness tracking velocity, and
 * articulations: legato (default), spic (spiccato), trem (tremolo), swell.
 */
export class Strings extends Instrument {
  constructor(ac, o) {
    super(ac, { eq: [{ type: 'peaking', f: 300, q: 1, g: 2 }, { type: 'peaking', f: 2600, q: 1.2, g: -2.5 }, { type: 'highshelf', f: 7500, g: -8 }], ...o });
    this.voices = o.voices ?? 3;
    this.bright = o.bright ?? 0.5;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    const ac = this.ac;
    const art = opts.art ?? 'legato';
    const f = mtof(m);
    const spic = art === 'spic';
    const a = opts.attack ?? (spic ? 0.006 : art === 'swell' ? dur * 0.6 : 0.18 + (1 - vel) * 0.25);
    const r = opts.release ?? (spic ? 0.08 : 0.45);
    const g = ac.createGain();
    const end = adsr(g.gain, t, spic ? Math.min(dur, 0.09) : dur, { a, d: spic ? 0.05 : 0.3, s: spic ? 0.25 : 0.85, r, peak: ((0.16 + 0.22 * vel) * 0.42) / Math.sqrt(this.voices) });
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    const top = Math.min(15000, f * (2.5 + 11 * this.bright * (0.5 + vel)));
    lp.frequency.setValueAtTime(spic ? top : f * 2, t);
    lp.frequency.linearRampToValueAtTime(top, t + Math.max(0.01, a * 0.8));
    lp.connect(g).connect(this.voicePan(opts.pan));
    // Spiccato notes are too short for vibrato: skip the LFOs (and a voice) to stay cheap.
    const vib = spic ? null : lfo(ac, t, 5.2 + this.rng.range(-0.4, 0.4), f * 0.0042 * (opts.vib ?? 1), 0.12, 0.5);
    const vib2 = spic ? null : lfo(ac, t, 4.6 + this.rng.range(-0.4, 0.4), f * 0.0035 * (opts.vib ?? 1), 0.2, 0.6);
    const oscs = spic ? [] : [vib.o, vib2.o];
    const nv = spic ? 1 : this.voices;
    for (let i = 0; i < nv; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, 'bowed'));
      o.frequency.value = f * cents((i - (nv - 1) / 2) * 6 + this.rng.range(-2, 2));
      if (!spic) (i % 2 ? vib2 : vib).g.connect(o.frequency);
      o.connect(lp);
      oscs.push(o);
      o.start(t + this.rng.range(0, spic ? 0.004 : 0.02));
    }
    if (art === 'trem') {
      const tr = ac.createOscillator();
      tr.type = 'triangle';
      tr.frequency.value = opts.tremRate ?? 13;
      const tg = ac.createGain();
      tg.gain.value = 0.5;
      // g2 = 0.5 + 0.5*tri → amplitude chop
      const g2 = ac.createGain();
      g2.gain.value = 0.5;
      tr.connect(tg).connect(g2.gain);
      lp.disconnect();
      lp.connect(g2).connect(g);
      tr.start(t);
      oscs.push(tr);
    }
    // Bow noise: a breath of rosin on the attack.
    if (vel > 0.3 && !opts.noBow && !spic) {
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(ac, 'white');
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(9000, f * 6);
      bp.Q.value = 1.2;
      const ng = ac.createGain();
      adsr(ng.gain, t, spic ? 0.03 : 0.12, { a: 0.01, d: 0.05, s: 0.3, r: 0.1, peak: 0.02 * vel });
      n.connect(bp).connect(ng).connect(g);
      n.start(t, this.rng.range(0, 3));
      n.stop(t + 0.5);
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
 * (vowel per instance), several singers per note with independent vibrato.
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
    // Breath bed through the same formants.
    this.breath = o.breath ?? 0.06;
  }

  play(t, m, dur, vel = 0.6, opts = {}) {
    const ac = this.ac;
    const f = mtof(m);
    const g = ac.createGain();
    const end = adsr(g.gain, t, dur, { a: opts.attack ?? 0.35, d: 0.3, s: 0.9, r: opts.release ?? 0.7, peak: ((0.18 + 0.3 * vel) * 0.42) / Math.sqrt(this.voices) });
    g.connect(this.formIn);
    const nodes = [];
    // One vibrato + one slow drift LFO per note, fanned out to the singers at
    // different depths (cheap, and the detune keeps the section chorused).
    const v = lfo(ac, t, 5 + this.rng.range(-0.5, 0.5), f * 0.006, 0.25, 0.6);
    const dr = lfo(ac, t, 0.23 + this.rng.range(0, 0.2), f * 0.003, 0, 0.1);
    nodes.push(v.o, dr.o);
    for (let i = 0; i < this.voices; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, 'voice'));
      o.frequency.value = f * cents(this.rng.range(-9, 9));
      (i % 2 ? dr : v).g.connect(o.frequency);
      o.connect(g);
      o.start(t + this.rng.range(0, 0.06));
      nodes.push(o);
    }
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac, 'pink');
    const ng = ac.createGain();
    ng.gain.value = this.breath * vel;
    n.connect(ng).connect(g);
    n.start(t, this.rng.range(0, 3));
    nodes.push(n);
    for (const o of nodes) o.stop(end);
  }
}

/**
 * Wind instruments: flute / recorder / horn / brass / bassoon / shawm.
 * Brass get a velocity-tracking filter sweep ("blat") and a pitch scoop.
 */
const WIND = {
  flute: { wave: 'flute', a: 0.07, r: 0.18, breath: 0.12, chiff: 0.25, vib: [5.1, 0.006, 0.25], lp: 7, scoop: 0 },
  recorder: { wave: 'flute', a: 0.03, r: 0.08, breath: 0.07, chiff: 0.45, vib: [5.6, 0.0025, 0.3], lp: 9, scoop: 0, tri: 0.25 },
  horn: { wave: 'horn', a: 0.06, r: 0.25, breath: 0.015, chiff: 0, vib: [4.8, 0.0018, 0.35], lp: 2.2, lpVel: 7, scoop: -28, sweep: 0.09, voices: 2 },
  brass: { wave: 'horn', a: 0.04, r: 0.2, breath: 0.01, chiff: 0, vib: [5, 0.0012, 0.4], lp: 3, lpVel: 11, scoop: -35, sweep: 0.06, voices: 2 },
  lowbrass: { wave: 'horn', a: 0.07, r: 0.3, breath: 0.01, chiff: 0, vib: [4.5, 0.001, 0.5], lp: 2.5, lpVel: 7, scoop: -20, sweep: 0.1, voices: 2 },
  bassoon: { wave: 'reed', a: 0.05, r: 0.15, breath: 0.03, chiff: 0.1, vib: [5, 0.003, 0.3], lp: 5, scoop: -10 },
  shawm: { wave: 'reed', a: 0.025, r: 0.08, breath: 0.04, chiff: 0.2, vib: [5.8, 0.004, 0.2], lp: 12, scoop: -15 },
};

export class Wind extends Instrument {
  constructor(ac, o) {
    const p = WIND[o.preset ?? 'flute'];
    const eq = p.wave === 'horn' ? [{ type: 'peaking', f: 600, q: 0.8, g: 2 }, { type: 'highshelf', f: 5000, g: -7 }] : p.wave === 'flute' ? [{ type: 'highshelf', f: 8000, g: -6 }] : [{ type: 'peaking', f: 1200, q: 1.2, g: 3 }, { type: 'highshelf', f: 6000, g: -6 }];
    super(ac, { eq, ...o });
    this.p = p;
  }

  play(t, m, dur, vel = 0.65, opts = {}) {
    const ac = this.ac;
    const p = this.p;
    const f = mtof(m);
    const g = ac.createGain();
    const isBrass = p.wave === 'horn';
    const end = adsr(g.gain, t, dur, { a: opts.attack ?? p.a * (isBrass ? 1.6 - vel : 1), d: 0.15, s: 0.82, r: opts.release ?? p.r, peak: (0.22 + 0.25 * vel) * 0.36 });
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = isBrass ? 1.1 : 0.5;
    const top = Math.min(14000, f * (p.lp + (p.lpVel ?? 0) * vel * vel));
    if (isBrass) {
      lp.frequency.setValueAtTime(f * 1.1, t);
      lp.frequency.linearRampToValueAtTime(top, t + p.sweep * (1.4 - vel));
      lp.frequency.setTargetAtTime(top * 0.7, t + p.sweep * 2, 0.25);
      lp.frequency.setTargetAtTime(f * 1.2, t + dur, 0.08);
    } else lp.frequency.value = top;
    lp.connect(g).connect(this.voicePan(opts.pan));
    const nodes = [];
    // Short notes never reach the vibrato onset: skip the LFO.
    const vib = dur > p.vib[2] + 0.1 ? lfo(ac, t, p.vib[0] + this.rng.range(-0.3, 0.3), f * p.vib[1] * (opts.vib ?? 1), p.vib[2], 0.45) : null;
    if (vib) nodes.push(vib.o);
    const voices = p.voices ?? 1;
    for (let i = 0; i < voices; i++) {
      const o = ac.createOscillator();
      o.setPeriodicWave(wave(ac, p.wave));
      const det = voices > 1 ? (i - (voices - 1) / 2) * 7 : 0;
      o.frequency.setValueAtTime(f * cents(det + (p.scoop || 0)), t);
      o.frequency.exponentialRampToValueAtTime(f * cents(det), t + 0.06);
      vib?.g.connect(o.frequency);
      o.connect(lp);
      o.start(t);
      nodes.push(o);
    }
    if (p.tri) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * 2;
      const tg = ac.createGain();
      tg.gain.value = p.tri * 0.3;
      o.connect(tg).connect(lp);
      o.start(t);
      nodes.push(o);
    }
    // Breath noise (tuned band) + attack chiff (brass: inaudible, skipped).
    if (isBrass) {
      for (const o of nodes) o.stop(end);
      return;
    }
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac, 'white');
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(12000, f * 2);
    bp.Q.value = 2;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(p.breath * 0.5 + p.chiff * 0.6 * vel, t + 0.012);
    ng.gain.setTargetAtTime(p.breath * 0.35, t + 0.02, 0.03);
    ng.gain.setTargetAtTime(0, t + dur, 0.05);
    n.connect(bp).connect(ng).connect(g);
    n.start(t, this.rng.range(0, 3));
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
    super(ac, { eq: [{ type: 'peaking', f: 900, q: 1.5, g: 4 }, { type: 'highshelf', f: 4500, g: -9 }], ...o });
    this.waveName = o.wave ?? 'reed';
  }

  play(t, m, dur, vel = 0.5, opts = {}) {
    const ac = this.ac;
    const f = mtof(m);
    const g = ac.createGain();
    const end = adsr(g.gain, t, dur, { a: opts.attack ?? 0.6, d: 0.3, s: 1, r: opts.release ?? 1.2, peak: (0.12 + 0.15 * vel) * 0.6 });
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(9000, f * (opts.bright ?? 6));
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
      const b = ac.createOscillator();
      b.type = 'square';
      b.frequency.value = opts.buzz;
      const bg = ac.createGain();
      bg.gain.value = 0.25;
      const am = ac.createGain();
      am.gain.value = 0.75;
      b.connect(bg).connect(am.gain);
      lp.disconnect();
      lp.connect(am).connect(g);
      b.start(t);
      nodes.push(b);
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
