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
    // Ensemble chorus (sections): two slowly modulated short delays panned
    // apart — one oscillator-free way to turn 3 voices into a section.
    if (o.chorus) {
      for (const [side, base, rate] of [[-0.75, 0.014, 0.31], [0.75, 0.021, 0.23]]) {
        const d = ac.createDelay(0.05);
        d.delayTime.value = base;
        const l = ac.createOscillator();
        l.frequency.value = rate;
        const lg = ac.createGain();
        lg.gain.value = 0.0025 * o.chorus;
        l.connect(lg).connect(d.delayTime);
        l.start();
        const g = ac.createGain();
        g.gain.value = 0.4;
        const p = ac.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, (o.pan ?? 0) + side));
        this.out.connect(d).connect(g).connect(p).connect(o.dest);
        this._chorusLfos = [...(this._chorusLfos ?? []), l];
      }
    }
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

  /**
   * A slurred (legato) phrase: notes [{t, midi, dur, vel}] that follow each
   * other without gaps. Sustained instruments override this to glide between
   * pitches on one continuous envelope; the default just plays the notes.
   */
  phrase(notes, opts = {}) {
    for (const n of notes) this.play(n.t, n.midi, n.dur, n.vel, opts);
  }

  /** Stop free-running modulators (call when the owning player is gone). */
  dispose() {
    for (const l of this._chorusLfos ?? []) {
      try {
        l.stop();
      } catch {
        /* not started */
      }
    }
    this._chorusLfos = [];
  }
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
