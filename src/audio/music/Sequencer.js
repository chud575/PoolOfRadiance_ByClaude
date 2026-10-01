import { createInstrument } from '../instruments/index.js';
import { AudioRng, hashStr } from '../core/rng.js';
import { musicGain } from '../loudness.js';
import { noiseBuffer } from '../dsp/bank.js';

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Seconds from quarter 0 to quarter `q` given ritardando segments [[q0, q1, k]]
 * (tempo eases linearly from 1 to k across each segment).
 */
export function ritSeconds(q, rit, spq) {
  let sec = 0;
  let at = 0;
  for (const [q0, q1, k] of rit) {
    if (q <= q0) break;
    sec += (q0 - at) * spq;
    const L = q1 - q0;
    const u = Math.min(q, q1) - q0;
    // tempo(x) = 1 + (k-1)·x/L  →  ∫ spq / tempo dx
    sec += Math.abs(k - 1) < 1e-6 ? u * spq : ((spq * L) / (k - 1)) * Math.log(1 + ((k - 1) * u) / L);
    at = Math.min(q, q1);
    if (q <= q1) return sec;
  }
  return sec + (q - at) * spq;
}

/**
 * Song format (see music/themes/*.js):
 * {
 *   id, bpm, barQ (quarters per bar), loop (bool), gain,
 *   instruments: { key: presetName | {preset, pan, gain, reverb, ...} },
 *   build(pass, rng) → { lengthQ, events: [{inst, t, midi:number[]|number, dur, vel, layer?, opts?, roll?, slur?}],
 *                        tailQ?, rit?: [[q0, q1, k]] (tempo eases from 1 to k over q0..q1: k < 1 = ritardando) }
 *   coda?(rng) → events played on the downbeat where the cue is cut (e.g. combat's final hit)
 * }
 * Times/durations in quarter notes; the player converts with 60/bpm.
 * Layers (0 base, 1 mid, 2 high) are gain-faded by `intensity` (adaptive music).
 * Consecutive `slur` notes of one instrument (gap < 30 ms) are joined into a
 * legato phrase: one envelope, gliding pitch (Instrument.phrase).
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
    this.dest = o.dest;
    this.send = o.send;
    this.out = ac.createGain();
    this.out.connect(o.dest);
    this.sendOut = ac.createGain();
    this.sendOut.connect(o.send);
    const start = o.at ?? ac.currentTime + 0.05;
    const g = o.rawGain ? (o.gainOverride ?? 1) : musicGain(song);
    this.gain = g;
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
    this._skipped = [];
    // Sample buffers (drums, plucks, noise) are rendered in JS: warm them a few
    // ms at a time between ticks instead of all at once when a note first needs them.
    this._warmQ = [() => noiseBuffer(ac, 'white'), () => noiseBuffer(ac, 'pink')];
    this._warmed = new Set();
    this._load();
  }

  _queueWarm() {
    for (const e of this.events) {
      const layer = e.layer ?? 0;
      const notes = e.phrase ? e.phrase.map((n) => n.midi) : [].concat(e.midi ?? 0);
      for (const m of notes) {
        const k = `${e.inst}@${layer}|${m}|${e.roll ? 'r' : Math.round((e.vel ?? 0.7) * 3)}`;
        if (this._warmed.has(k)) continue;
        this._warmed.add(k);
        const ins = this._instrument(e.inst, layer);
        if (ins.warm) this._warmQ.push(...ins.warm(m, e.vel ?? 0.7, e.opts ?? {}, !!e.roll));
      }
    }
  }

  /** Run queued cache-warming tasks for at most `ms` milliseconds. */
  warmSome(ms = 6) {
    if (!this._warmQ.length) return;
    const t0 = clock();
    while (this._warmQ.length && clock() - t0 < ms) this._warmQ.shift()();
  }

  _load() {
    this.state ??= {};
    const r = this.song.build(this.pass, this.rng.fork(this.pass + 1), this.state);
    this.section = r.section ?? null;
    this.events = this._slurs(r.events.slice().sort((a, b) => a.t - b.t));
    this.lengthQ = r.lengthQ;
    this.tailQ = r.tailQ ?? 0;
    this.rit = (r.rit ?? []).slice().sort((a, b) => a[0] - b[0]);
    this.cursor = 0;
    this._queueWarm();
  }

  /** Join slurred single notes of one instrument/layer into legato phrase events. */
  _slurs(events) {
    const tol = 0.03 / this.spq + 1e-6;
    const open = new Map();
    const out = [];
    for (const e of events) {
      const key = `${e.inst}@${e.layer ?? 0}`;
      const single = !e.roll && (!Array.isArray(e.midi) || e.midi.length === 1);
      if (!e.slur || !single) {
        if (!e.roll) open.delete(key);
        out.push(e);
        continue;
      }
      const note = { t: e.t, midi: Array.isArray(e.midi) ? e.midi[0] : e.midi, dur: e.dur, vel: e.vel ?? 0.7 };
      const ch = open.get(key);
      if (ch && Math.abs(ch.end - e.t) < tol) {
        ch.ev.phrase.push(note);
        ch.ev.dur = e.t + e.dur - ch.ev.t;
        ch.end = e.t + e.dur;
        continue;
      }
      const ev = { ...e, phrase: [note] };
      out.push(ev);
      open.set(key, { ev, end: e.t + e.dur });
    }
    for (const e of out) if (e.phrase && e.phrase.length === 1) delete e.phrase;
    return out;
  }

  /** Seconds from the start of the pass to quarter `q` (honours ritardandi). */
  secAt(q) {
    return ritSeconds(q, this.rit, this.spq);
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
    // Long notes of a layer that was silent when they began (choir pads,
    // whole-note brass) join in now instead of waiting for the next onset.
    const now = this.ac.currentTime;
    this._skipped = this._skipped.filter((s) => {
      if (s.end < now + 0.4) return false;
      if (this._layerGain(s.e.layer, this.intensity) < 0.02) return true;
      const t = now + 0.05;
      const ins = this._instrument(s.e.inst, s.e.layer);
      const notes = Array.isArray(s.e.midi) ? s.e.midi : [s.e.midi];
      for (const m of notes) ins.play(t, m, s.end - t, (s.e.vel ?? 0.6) * 0.9, { ...(s.e.opts ?? {}), attack: Math.min(0.8, (s.end - t) * 0.3) });
      return false;
    });
  }

  /** Schedule everything that starts before `horizon` (AudioContext seconds). */
  tick(horizon) {
    if (this.done || this.stopped) return;
    this.warmSome();
    if (this.stopAt !== undefined) {
      if (horizon >= this.stopAt) {
        horizon = this.stopAt;
        this.stopped = true; // after this final fill
      }
    }
    for (;;) {
      while (this.cursor < this.events.length) {
        const e = this.events[this.cursor];
        const at = this.passStart + this.secAt(e.t);
        if (at > horizon) return;
        this.cursor++;
        if (this.stopAt !== undefined && at >= this.stopAt) continue;
        this._play(e, at);
      }
      // End of pass.
      const passEnd = this.passStart + this.secAt(this.lengthQ);
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
    // Layers faded out by the current intensity cost nothing: don't schedule them
    // (but remember long notes so they can join if the intensity rises mid-note).
    if (layer && this._layerGain(layer, this.intensity) < 0.02) {
      const len = this.secAt(e.t + e.dur) - this.secAt(e.t);
      if (len > 1.5 && !e.roll && e.midi !== undefined && !e.phrase) this._skipped.push({ e, end: at + len });
      if (this._skipped.length > 64) this._skipped.splice(0, this._skipped.length - 64);
      return;
    }
    const ins = this._instrument(e.inst, layer);
    const human = e.exact ? 0 : this.rng.gauss(0.005);
    const t = Math.max(this.ac.currentTime, at + human);
    const dur = this.secAt(e.t + e.dur) - this.secAt(e.t);
    const vel = Math.max(0.05, Math.min(1, (e.vel ?? 0.7) + (e.exact ? 0 : this.rng.gauss(0.025))));
    if (e.phrase) {
      const notes = e.phrase.map((n, i) => ({
        t: i ? this.passStart + this.secAt(n.t) + this.rng.gauss(0.003) : t,
        midi: n.midi,
        dur: this.secAt(n.t + n.dur) - this.secAt(n.t),
        vel: Math.max(0.05, Math.min(1, n.vel + this.rng.gauss(0.02))),
      }));
      // Keep the chain gapless after humanising.
      for (let i = 0; i < notes.length - 1; i++) notes[i].dur = Math.max(0.02, notes[i + 1].t - notes[i].t);
      ins.phrase(notes, e.opts ?? {});
      return;
    }
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

  /** Seconds until the next bar line (for quantised transitions); `min` skips bar lines closer than that. */
  untilNextBar(min = 0) {
    const bar = (this.song.barQ ?? 4) * this.spq;
    const el = this.ac.currentTime - this.passStart;
    if (el < 0) return -el;
    let d = bar - (el % bar);
    while (d < min) d += bar;
    return d;
  }

  /**
   * End the cue on a downbeat: everything stops at `at` (AudioContext time)
   * with a short release, and the song's coda (a final hit or cadence on
   * layer 0) sounds on that downbeat.
   */
  endWithCoda(at) {
    const evs = this.song.coda?.(this.rng.fork(99)) ?? [];
    this.fadeOut(0.12, at);
    if (!evs.length) return null;
    const song = { ...this.song, id: `${this.song.id}:coda`, loop: false, gain: this.gain, build: () => ({ lengthQ: 4, tailQ: 2, events: evs.map((e) => ({ ...e, layer: 0, exact: true })) }) };
    const p = new TrackPlayer(this.ac, song, { dest: this.dest, send: this.send, at });
    p.tick(at + 8);
    return p;
  }

  /** Keep playing until `at` (AudioContext time), then fade out over `seconds`. */
  fadeOut(seconds = 2, at = this.ac.currentTime) {
    if (this.stopped || this.stopAt !== undefined) return;
    const t = Math.max(this.ac.currentTime, at);
    if (t <= this.ac.currentTime + 0.01) this.stopped = true;
    else this.stopAt = t;
    const hold = (p) => {
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
      else {
        p.cancelScheduledValues(t);
        p.setValueAtTime(Math.max(0.0001, p.value), t);
      }
    };
    const g = this.out.gain;
    hold(g);
    g.linearRampToValueAtTime(0.0001, t + Math.max(0.05, seconds));
    const s = this.sendOut.gain;
    hold(s);
    s.linearRampToValueAtTime(0, t + Math.max(0.05, seconds) + 0.5);
    this._disposeAt = t + seconds + 1.5;
  }

  dispose() {
    for (const ins of this.inst.values()) ins.dispose?.();
    try {
      this.out.disconnect();
      this.sendOut.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
