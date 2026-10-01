import { AudioRng } from '../core/rng.js';

/**
 * Instrument base. Each instance owns a small processing chain:
 *   voices → this.input → [eq…] → this.out(gain) → panner → dest
 *                                              └→ sendGain → send (reverb)
 * Subclasses implement `play(t, midi, dur, vel, opts)` where `t` is an
 * AudioContext time, `dur` seconds, `vel` 0..1.
 */
export class Instrument {
  /**
   * @param {BaseAudioContext} ac
   * @param {{dest: AudioNode, send?: AudioNode, gain?: number, pan?: number, reverb?: number, eq?: Array, seed?: number}} o
   */
  constructor(ac, o) {
    this.ac = ac;
    this.o = o;
    this.rng = new AudioRng(o.seed ?? 1234);
    this.input = ac.createGain();
    this.out = ac.createGain();
    this.out.gain.value = o.gain ?? 1;
    let node = this.input;
    for (const e of o.eq ?? []) {
      const f = ac.createBiquadFilter();
      f.type = e.type;
      f.frequency.value = e.f;
      if (e.q !== undefined) f.Q.value = e.q;
      if (e.g !== undefined) f.gain.value = e.g;
      node.connect(f);
      node = f;
    }
    node.connect(this.out);
    const pan = ac.createStereoPanner();
    pan.pan.value = o.pan ?? 0;
    this.out.connect(pan).connect(o.dest);
    if (o.send) {
      this.sendGain = ac.createGain();
      this.sendGain.gain.value = o.reverb ?? 0.3;
      this.out.connect(this.sendGain).connect(o.send);
    }
  }

  /** Per-note stereo placement helper: returns a node to connect a voice into. */
  voicePan(p) {
    if (!p) return this.input;
    const sp = this.ac.createStereoPanner();
    sp.pan.value = Math.max(-1, Math.min(1, p));
    sp.connect(this.input);
    return sp;
  }

  // eslint-disable-next-line no-unused-vars
  play(t, midi, dur, vel, opts) {}
}

/**
 * ADSR on an AudioParam. Release starts at t+dur.
 * @returns {number} time when the voice is silent
 */
export function adsr(param, t, dur, { a = 0.01, d = 0.1, s = 0.7, r = 0.2, peak = 1 } = {}) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (dur > a) param.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
  const rel = Math.max(t + a, t + dur);
  param.setTargetAtTime(0, rel, Math.max(0.002, r / 4));
  return rel + r * 1.6;
}

export const cents = (c) => Math.pow(2, c / 1200);
