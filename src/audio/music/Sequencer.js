import { createInstrument } from '../instruments/index.js';
import { AudioRng, hashStr } from '../core/rng.js';

/**
 * Song format (see music/themes/*.js):
 * {
 *   id, bpm, barQ (quarters per bar), loop (bool), gain,
 *   instruments: { key: presetName | {preset, pan, gain, reverb, ...} },
 *   build(pass, rng) → { lengthQ, events: [{inst, t, midi:number[]|number, dur, vel, layer?, opts?, roll?}] , tailQ? }
 * }
 * Times/durations in quarter notes; the player converts with 60/bpm.
 * Layers (0 base, 1 mid, 2 high) are gain-faded by `intensity` (adaptive music).
 */
export class TrackPlayer {
  /**
   * @param {BaseAudioContext} ac
   * @param {object} song
   * @param {{dest: AudioNode, send: AudioNode, at?: number, fadeIn?: number, intensity?: number, seed?: number}} o
   */
  constructor(ac, song, o) {
    this.ac = ac;
    this.song = song;
    this.spq = 60 / song.bpm;
    this.rng = new AudioRng(o.seed ?? hashStr(song.id));
    this.out = ac.createGain();
    this.out.connect(o.dest);
    this.sendOut = ac.createGain();
    this.sendOut.connect(o.send);
    const start = o.at ?? ac.currentTime + 0.05;
    const g = (song.gain ?? 1);
    if (o.fadeIn) {
      this.out.gain.setValueAtTime(0.0001, start);
      this.out.gain.linearRampToValueAtTime(g, start + o.fadeIn);
    } else this.out.gain.setValueAtTime(g, start);
    this.sendOut.gain.value = 1;
    this.layers = [0, 1, 2].map(() => {
      const lg = ac.createGain();
      const ls = ac.createGain();
      lg.connect(this.out);
      ls.connect(this.sendOut);
      return { g: lg, s: ls };
    });
    this.intensity = o.intensity ?? song.intensity ?? 1;
    this._applyIntensity(start, 0);
    this.inst = new Map();
    this.pass = 0;
    this.passStart = start;
    this.done = false;
    this.stopped = false;
    this._load();
  }

  _load() {
    const r = this.song.build(this.pass, this.rng.fork(this.pass + 1));
    this.events = r.events.slice().sort((a, b) => a.t - b.t);
    this.lengthQ = r.lengthQ;
    this.tailQ = r.tailQ ?? 0;
    this.cursor = 0;
  }

  _instrument(key, layer) {
    const id = `${key}@${layer}`;
    let ins = this.inst.get(id);
    if (!ins) {
      const spec = this.song.instruments[key];
      if (!spec) throw new Error(`song ${this.song.id}: no instrument "${key}"`);
      const L = this.layers[layer];
      ins = createInstrument(this.ac, spec, L.g, L.s, hashStr(this.song.id + id));
      this.inst.set(id, ins);
    }
    return ins;
  }

  /** Layer gains from intensity (0..1). */
  _layerGain(i, x) {
    const ss = (a, b) => {
      const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    return i === 0 ? 1 : i === 1 ? ss(0.2, 0.5) : ss(0.55, 0.85);
  }

  _applyIntensity(t, tc) {
    this.layers.forEach((L, i) => {
      const v = Math.max(0.0001, this._layerGain(i, this.intensity));
      if (tc) {
        L.g.gain.setTargetAtTime(v, t, tc);
        L.s.gain.setTargetAtTime(v, t, tc);
      } else {
        L.g.gain.setValueAtTime(v, t);
        L.s.gain.setValueAtTime(v, t);
      }
    });
  }

  setIntensity(x, seconds = 2) {
    this.intensity = Math.max(0, Math.min(1, x));
    this._applyIntensity(this.ac.currentTime, seconds / 3);
  }

  /** Schedule everything that starts before `horizon` (AudioContext seconds). */
  tick(horizon) {
    if (this.done || this.stopped) return;
    for (;;) {
      while (this.cursor < this.events.length) {
        const e = this.events[this.cursor];
        const at = this.passStart + e.t * this.spq;
        if (at > horizon) return;
        this.cursor++;
        this._play(e, at);
      }
      // End of pass.
      const passEnd = this.passStart + this.lengthQ * this.spq;
      if (!this.song.loop) {
        this.done = true;
        this.endTime = passEnd + this.tailQ * this.spq;
        return;
      }
      if (passEnd - 0.5 > horizon) return; // build next pass a little ahead
      this.pass++;
      this.passStart = passEnd;
      this._load();
    }
  }

  _play(e, at) {
    const layer = e.layer ?? 0;
    // Layers faded out by the current intensity cost nothing: don't schedule them.
    if (layer && this._layerGain(layer, this.intensity) < 0.02) return;
    const ins = this._instrument(e.inst, layer);
    const human = e.exact ? 0 : this.rng.range(-0.006, 0.006);
    const t = Math.max(this.ac.currentTime, at + human);
    const dur = e.dur * this.spq;
    const vel = Math.max(0.05, Math.min(1, (e.vel ?? 0.7) + (e.exact ? 0 : this.rng.range(-0.04, 0.04))));
    if (e.roll) {
      ins.roll(t, Array.isArray(e.midi) ? e.midi[0] : e.midi, dur, e.roll[0], e.roll[1], e.opts ?? {});
      return;
    }
    const notes = Array.isArray(e.midi) ? e.midi : [e.midi];
    notes.forEach((m, i) => {
      // Strummed chords on plucked instruments: spread the onsets.
      const strum = (e.opts?.strum ?? 0) * i;
      ins.play(t + strum, m, dur, vel, e.opts ?? {});
    });
  }

  /** Fade out and stop scheduling. */
  fadeOut(seconds = 2) {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ac.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, seconds));
    const s = this.sendOut.gain;
    s.cancelScheduledValues(t);
    s.setValueAtTime(Math.max(0.0001, s.value), t);
    s.linearRampToValueAtTime(0, t + Math.max(0.05, seconds) + 0.5);
    this._disposeAt = t + seconds + 1;
  }

  dispose() {
    try {
      this.out.disconnect();
      this.sendOut.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
