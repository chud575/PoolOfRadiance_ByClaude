import { Instrument } from './base.js';
import { mtof } from '../core/notes.js';
import { sample } from '../dsp/bank.js';
import { ksString } from '../dsp/synth.js';

/**
 * Physically-modelled plucked strings (Karplus–Strong buffers, cached per
 * pitch × velocity layer × round-robin variant). Courses (doubled strings, as
 * on a lute or dulcimer) are a second, slightly detuned string.
 */
export const PLUCK_PRESETS = {
  // t60 at C4; low notes ring longer. bright 0..1, pos = pluck position.
  lute: { t60: 1.6, bright: 0.42, pos: 0.18, course: 1.0018, dampAfter: 0.25, pick: 0.45,
    eq: [{ type: 'peaking', f: 220, q: 1.4, g: 4 }, { type: 'peaking', f: 520, q: 2, g: 2.5 }, { type: 'highshelf', f: 5000, g: -6 }] },
  harp: { t60: 3.4, bright: 0.62, pos: 0.32, course: 0, dampAfter: 2.5, pick: 0.12,
    eq: [{ type: 'peaking', f: 180, q: 1, g: 2 }, { type: 'highshelf', f: 6500, g: -5 }] },
  dulcimer: { t60: 2.6, bright: 0.85, pos: 0.11, course: 1.0026, dampAfter: 1.4, pick: 0.6,
    eq: [{ type: 'peaking', f: 330, q: 1.5, g: 2 }, { type: 'highshelf', f: 7000, g: -4 }] },
  pizz: { t60: 0.7, bright: 0.3, pos: 0.4, course: 1.003, dampAfter: 0.15, pick: 0.2,
    eq: [{ type: 'peaking', f: 250, q: 1, g: 3 }, { type: 'lowpass', f: 3500, q: 0.6 }] },
  bass: { t60: 1.4, bright: 0.25, pos: 0.3, course: 0, dampAfter: 0.3, pick: 0.25,
    eq: [{ type: 'peaking', f: 110, q: 1, g: 3 }, { type: 'lowpass', f: 2200, q: 0.5 }] },
  harmonic: { t60: 2.8, bright: 0.9, pos: 0.5, course: 0, dampAfter: 2.5, pick: 0.05,
    eq: [{ type: 'highpass', f: 400, q: 0.5 }, { type: 'highshelf', f: 7000, g: -6 }] },
};

export class Plucked extends Instrument {
  constructor(ac, o) {
    const p = PLUCK_PRESETS[o.preset ?? 'lute'];
    super(ac, { ...o, eq: [...p.eq, ...(o.eq ?? [])] });
    this.p = p;
    this.name = o.preset ?? 'lute';
    this.rr = 0;
  }

  _buf(m, vel, variant) {
    const p = this.p;
    const vb = vel < 0.45 ? 0 : vel < 0.75 ? 1 : 2;
    const v = [0.35, 0.65, 0.95][vb];
    const f = mtof(m);
    // Lower strings ring longer; highs die faster.
    const t60 = p.t60 * Math.pow(261.6 / f, 0.45);
    const dur = Math.min(8, Math.max(0.6, t60 * 1.3));
    return sample(this.ac, `ks:${this.name}:${m}:${vb}:${variant}`, (sr) =>
      ksString(sr, { freq: f, dur, t60, bright: p.bright * (0.75 + 0.35 * v), pos: p.pos, vel: v, pick: p.pick, seed: m * 31 + vb * 7 + variant * 1009 }),
    );
  }

  play(t, m, dur, vel = 0.7, opts = {}) {
    const ac = this.ac;
    const variant = this.rr++ % 3;
    const g = ac.createGain();
    const v = 0.4 + 0.6 * vel;
    g.gain.value = v;
    const stopAt = t + dur + (opts.ring ?? this.p.dampAfter);
    // Damping: hand/finger stops the string after the written length (+ring).
    g.gain.setValueAtTime(v, stopAt);
    g.gain.setTargetAtTime(0, stopAt, 0.05);
    const dest = this.voicePan(opts.pan);
    g.connect(dest);
    const strings = this.p.course ? 2 : 1;
    for (let s = 0; s < strings; s++) {
      const src = ac.createBufferSource();
      src.buffer = this._buf(m, vel, (variant + s) % 3);
      if (s) src.playbackRate.value = this.p.course;
      const sg = ac.createGain();
      sg.gain.value = s ? 0.55 : 1;
      src.connect(sg).connect(g);
      src.start(t + s * 0.003);
      src.stop(Math.min(t + src.buffer.duration, stopAt + 0.4));
    }
  }
}
