import { createInstrument } from '../instruments/index.js';
import { AudioRng, hashStr } from '../core/rng.js';
import { musicGain, musicCal, intensityCompDb } from '../loudness.js';
import { noiseBuffer } from '../dsp/bank.js';

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Scheduling horizon (seconds). Notes are handed to the audio thread this far
 * ahead, so a main-thread stall shorter than this (map loads, shader
 * compiles, the combat scene's slow frames) never reaches the speakers.
 */
export const LOOKAHEAD = 1.8;

/** A note that reaches the scheduler later than this (s) is dropped rather than bunched. */
export const LATE_DROP = 0.04;

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
    // Per-cue EQ (e.g. presence for the battle cue): out → filters → dest.
    let tail = this.out;
    for (const e of song.eq ?? []) {
      const f = ac.createBiquadFilter();
      f.type = e.type;
      f.frequency.value = e.f;
      if (e.q !== undefined) f.Q.value = e.q;
      if (e.g !== undefined) f.gain.value = e.g;
      tail.connect(f);
      tail = f;
    }
    tail.connect(o.dest);
    this.sendOut = ac.createGain();
    this.sendOut.connect(o.send);
    // Per-section loudness trim (multi-pass cues: every variant at the same
    // level) and the intensity compensation table, from the calibration.
    this.cal = o.cal ?? (o.rawGain ? {} : musicCal(song));
    this.noComp = !!o.noComp;
    this.trim = ac.createGain();
    this.trimS = ac.createGain();
    this.trim.connect(this.out);
    this.trimS.connect(this.sendOut);
    const start = o.at ?? ac.currentTime + 0.05;
    const g = o.rawGain ? (o.gainOverride ?? 1) : musicGain(song);
    this.gain = g;
    // The out-gain automation is tracked analytically (_curve) so fadeOut can
    // anchor its ramp at the exact scheduled value instead of trusting
    // cancelAndHoldAtTime, which (per spec) inserts no hold event after a
    // completed ramp / old setValueAtTime and makes the new ramp start from
    // that stale event — an instant gain drop.
    if (o.fadeIn) {
      this.out.gain.setValueAtTime(0.0001, start);
      this.out.gain.linearRampToValueAtTime(g, start + o.fadeIn);
      this._curve = { t0: start, v0: 0.0001, t1: start + o.fadeIn, v1: g };
    } else {
      this.out.gain.setValueAtTime(g, start);
      this._curve = { t0: start, v0: g, t1: start, v1: g };
    }
    this.sendOut.gain.value = 1;
    this.layers = [0, 1, 2].map(() => {
      const lg = ac.createGain();
      const ls = ac.createGain();
      lg.connect(this.trim);
      ls.connect(this.trimS);
      return { g: lg, s: ls };
    });
    this.intensity = o.intensity ?? song.intensity ?? 1;
    this._applyIntensity(start, 0);
    this.inst = new Map();
    this.pass = 0;
    this.passStart = start;
    this.startTime = start;
    this.done = false;
    this.stopped = false;
    this._skipped = [];
    this._silent = [];
    this.dropped = 0;
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
    let r;
    // Rest windows: long-running exploration cues fall silent (ambience only)
    // for a while every few minutes, so hours of grid crawling never wear the
    // score thin. Seeded per song, never on the first pass.
    const rest = this.song.rest;
    if (rest && this.pass > 0) {
      this.restAnchor ??= this.startTime;
      this.restAfter ??= this.rng.range(rest.after[0], rest.after[1]);
      if (this.section !== 'rest' && this.passStart - this.restAnchor >= this.restAfter) {
        const secs = this.rng.range(rest.length[0], rest.length[1]);
        const bar = this.song.barQ ?? 4;
        r = { lengthQ: Math.max(bar, Math.round(secs / this.spq / bar) * bar), events: [], section: 'rest' };
        this.restAnchor = this.passStart + secs;
        this.restAfter = this.rng.range(rest.after[0], rest.after[1]);
      }
    }
    let stem = null;
    if (!r && this._pre) {
      // The pass built ahead for a stem (load guard level 3).
      ({ r, stem } = this._pre);
      this._pre = null;
    }
    if (!r) r = this._buildNext();
    this.section = r.section ?? null;
    this._applyTrim();
    this.events = this._slurs(r.events.slice().sort((a, b) => a.t - b.t));
    this.lengthQ = r.lengthQ;
    this.tailQ = r.tailQ ?? 0;
    this.rit = (r.rit ?? []).slice().sort((a, b) => a[0] - b[0]);
    this.cursor = 0;
    if (stem?.buffer && this.degrade >= 3) this._playStem(stem.buffer);
    else this._queueWarm();
    if (this.degrade >= 3) this._prepStem();
  }

  _buildNext() {
    const mp = this.musicPass ?? 0;
    const r = this.song.build(mp, this.rng.fork(mp + 1), this.state);
    this.musicPass = mp + 1;
    return r;
  }

  /**
   * Structural degradation under load (the live engine's LoadGuard): 1 drops
   * the desperate layer, 2 the mid layer too, 3 also replaces the live
   * orchestra, from the next section on, with a stem of that section bounced
   * offline at a low sample rate (one buffer source instead of hundreds of
   * nodes). 0 restores everything.
   */
  setDegrade(level) {
    level = Math.max(0, Math.min(3, level | 0));
    if (level === (this.degrade ?? 0)) return;
    this.degrade = level;
    this.maxLayer = level >= 2 ? 0 : level >= 1 ? 1 : 2;
    this._applyIntensity(this.ac.currentTime, 0.4);
    if (level >= 3) this._prepStem();
  }

  /** Build the next pass now and bounce it to a stem in the background. */
  _prepStem() {
    if (this._pre || !this.song.loop || this.stopped || typeof OfflineAudioContext === 'undefined' || this.ac instanceof OfflineAudioContext) return;
    const r = this._buildNext();
    const stem = { buffer: null };
    this._pre = { r, stem };
    if (r.section === 'rest' || !r.events.length) return;
    const sr = 22050;
    const secs = ritSeconds(r.lengthQ, r.rit ?? [], this.spq) + (r.tailQ ?? 0) * this.spq + 2;
    let oac;
    try {
      oac = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
    } catch {
      return;
    }
    const sink = oac.createGain();
    const song = { ...this.song, loop: false, build: () => r };
    const p = new TrackPlayer(oac, song, { dest: oac.destination, send: sink, at: 0, intensity: this.intensity, cal: this.cal, rawGain: true, gainOverride: 1 });
    p.tick(LOOKAHEAD);
    for (let i = 1; i * 0.5 < secs - 0.1; i++) {
      oac.suspend(i * 0.5).then(() => {
        p.tick(i * 0.5 + LOOKAHEAD);
        oac.resume();
      });
    }
    oac.startRendering().then((buf) => {
      stem.buffer = buf;
    }, () => {});
  }

  /** Play this pass from its bounced stem (dry to the cue's output, a share to its room). */
  _playStem(buf) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const wet = ac.createGain();
    wet.gain.value = 0.4;
    src.connect(this.out);
    src.connect(wet).connect(this.sendOut);
    const at = Math.max(ac.currentTime, this.passStart);
    src.start(at, Math.max(0, ac.currentTime - this.passStart));
    this.events = [];
    this.stems = (this.stems ?? 0) + 1;
  }

  /** Section loudness trim at the start of the pass (rest windows keep the last one). */
  _applyTrim() {
    if (this.section === 'rest') return;
    const db = this.cal?.sections?.[this.section] ?? 0;
    const v = Math.pow(10, db / 20);
    const t = this.passStart;
    for (const p of [this.trim.gain, this.trimS.gain]) {
      if (this.pass === 0) p.setValueAtTime(v, t);
      else {
        p.setValueAtTime(this._trimV ?? 1, Math.max(this.ac.currentTime, t - 0.15));
        p.linearRampToValueAtTime(v, Math.max(this.ac.currentTime + 0.01, t + 0.05));
      }
    }
    this._trimV = v;
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
    if (i > (this.maxLayer ?? 2)) return 0;
    const ss = (a, b) => {
      const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    return i === 0 ? 1 : i === 1 ? ss(0.2, 0.5) : ss(0.55, 0.85);
  }

  /**
   * Overall lift with intensity (dB at the top layer, song.lift): the
   * desperate layer must feel *bigger*, not just brighter — everything
   * swells by `lift` dB and the top layer sends more to the room.
   */
  _lift(x) {
    const k = Math.max(0, Math.min(1, (x - 0.5) / 0.4));
    return Math.pow(10, ((this.song.lift ?? 0) * k * k * (3 - 2 * k)) / 20);
  }

  /**
   * Overall gain at intensity x: the calibrated compensation (combat: the
   * cue is as loud at 0.3 as at its typical 0.45, and swells by `lift` LU
   * to 1.0) when the song has an intensity curve, else the plain lift.
   */
  _level(x) {
    if (this.cal?.curve && !this.noComp) return Math.pow(10, intensityCompDb(this.song, this.cal.curve, x) / 20);
    return this._lift(x);
  }

  _applyIntensity(t, tc) {
    const lift = this._level(this.intensity);
    this.layers.forEach((L, i) => {
      const v = Math.max(0.0001, this._layerGain(i, this.intensity) * lift);
      const sv = v * (i === 2 ? 1.35 : 1);
      if (tc) {
        L.g.gain.setTargetAtTime(v, t, tc);
        L.s.gain.setTargetAtTime(sv, t, tc);
      } else {
        L.g.gain.setValueAtTime(v, t);
        L.s.gain.setValueAtTime(sv, t);
      }
    });
  }

  setIntensity(x, seconds = 2) {
    this.intensity = Math.max(0, Math.min(1, x));
    this._applyIntensity(this.ac.currentTime, seconds / 3);
    // Notes of a silent layer inside the lookahead window were not scheduled:
    // hand the ones still in the future to the audio thread now.
    const soon = this.ac.currentTime + 0.03;
    this._silent = this._silent.filter((s) => {
      if (s.at < soon) return false;
      if (this._layerGain(s.e.layer, this.intensity) < 0.02) return true;
      this._play(s.e, s.at, true);
      return false;
    });
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

  _play(e, at, rescued = false) {
    const layer = e.layer ?? 0;
    // Layers faded out by the current intensity cost nothing: don't schedule them
    // (but remember long notes so they can join if the intensity rises mid-note,
    // and notes inside the lookahead window so they can still be scheduled).
    if (!rescued && layer && this._layerGain(layer, this.intensity) < 0.02) {
      const len = this.secAt(e.t + e.dur) - this.secAt(e.t);
      if (len > 1.5 && !e.roll && e.midi !== undefined && !e.phrase) this._skipped.push({ e, end: at + len });
      if (this._skipped.length > 64) this._skipped.splice(0, this._skipped.length - 64);
      this._silent.push({ e, at });
      if (this._silent.length > 256) this._silent = this._silent.filter((s) => s.at > this.ac.currentTime);
      return;
    }
    const human = e.exact ? 0 : this.rng.gauss(0.005);
    let dur = this.secAt(e.t + e.dur) - this.secAt(e.t);
    const now = this.ac.currentTime;
    let t = at + human;
    if (e.phrase) {
      let notes = e.phrase.map((n, i) => ({
        t: i ? this.passStart + this.secAt(n.t) + this.rng.gauss(0.003) : t,
        midi: n.midi,
        dur: this.secAt(n.t + n.dur) - this.secAt(n.t),
        vel: Math.max(0.05, Math.min(1, n.vel + this.rng.gauss(0.02))),
      }));
      // Late (main thread stalled): the phrase picks up at its next note.
      if (t < now - LATE_DROP) {
        const keep = notes.filter((n) => n.t >= now);
        this.dropped += notes.length - keep.length;
        if (!keep.length) return;
        notes = keep;
      }
      notes[0].t = Math.max(now, notes[0].t);
      for (let i = 1; i < notes.length; i++) notes[i].t = Math.max(notes[i - 1].t + 0.01, notes[i].t);
      // Keep the chain gapless after humanising.
      for (let i = 0; i < notes.length - 1; i++) notes[i].dur = Math.max(0.02, notes[i + 1].t - notes[i].t);
      this._instrument(e.inst, layer).phrase(notes, e.opts ?? {});
      return;
    }
    // Robust to main-thread stalls: a note that arrives late is dropped, never
    // bunched up with its neighbours; a long held note joins mid-way instead.
    if (t < now - LATE_DROP) {
      const left = t + dur - now;
      if (dur < 1.2 || left < 0.6 || e.roll) {
        this.dropped++;
        return;
      }
      dur = left;
      t = now + 0.01;
      e = { ...e, opts: { ...(e.opts ?? {}), attack: Math.min(0.5, left * 0.3) } };
    }
    t = Math.max(now, t);
    const ins = this._instrument(e.inst, layer);
    const vel = Math.max(0.05, Math.min(1, (e.vel ?? 0.7) + (e.exact ? 0 : this.rng.gauss(0.025))));
    if (e.roll) {
      ins.roll(t, Array.isArray(e.midi) ? e.midi[0] : e.midi, dur, e.roll[0], e.roll[1], e.opts ?? {});
      return;
    }
    const notes = Array.isArray(e.midi) ? e.midi : [e.midi];
    // Sections play a chord as one gesture (one envelope / filter chain, players per tone).
    if (notes.length > 1 && ins.chord && !e.opts?.strum) {
      ins.chord(t, notes, dur, vel, e.opts ?? {});
      return;
    }
    // Chords: each note gets its share of the section (divisi).
    const o = notes.length > 1 ? { ...(e.opts ?? {}), divisi: notes.length } : e.opts ?? {};
    notes.forEach((m, i) => {
      // Strummed chords on plucked instruments: spread the onsets.
      const strum = (e.opts?.strum ?? 0) * i;
      ins.play(t + strum, m, dur, vel, o);
    });
  }

  /** AudioContext time a one-shot cue ends (its last pass plus tail), known before it is all scheduled. */
  plannedEnd() {
    if (this.endTime !== undefined) return this.endTime;
    return this.passStart + this.secAt(this.lengthQ) + (this.tailQ ?? 0) * this.spq;
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
    const p = new this.constructor(this.ac, song, { dest: this.dest, send: this.send, at });
    p.tick(Math.min(at + 8, this.ac.currentTime + LOOKAHEAD));
    return p;
  }

  /** Scheduled value of the out gain at time `t` (from the tracked automation). */
  gainAt(t) {
    const c = this._curve;
    if (t <= c.t0) return c.v0;
    if (t >= c.t1) return c.v1;
    return c.v0 + ((c.v1 - c.v0) * (t - c.t0)) / (c.t1 - c.t0);
  }

  /** Keep playing until `at` (AudioContext time), then fade out over `seconds`. */
  fadeOut(seconds = 2, at = this.ac.currentTime) {
    if (this.stopped || this.stopAt !== undefined) return;
    const now = this.ac.currentTime;
    const t = Math.max(now, at);
    if (t <= now + 0.01) this.stopped = true;
    else this.stopAt = t;
    const len = Math.max(0.05, seconds);
    // Out gain: cancel what lies ahead and re-anchor explicitly at t with the
    // value the curve has there, so the cue holds full level until t.
    const g = this.out.gain;
    const v = Math.max(0.0001, this.gainAt(t));
    g.cancelScheduledValues(now);
    const vNow = Math.max(0.0001, this.gainAt(now));
    g.setValueAtTime(vNow, now);
    if (t > now + 1e-4) g.linearRampToValueAtTime(v, t); // continues a running fade-in exactly
    g.setValueAtTime(v, t);
    g.linearRampToValueAtTime(0.0001, t + len);
    this._curve = { t0: t, v0: v, t1: t + len, v1: 0.0001 };
    // Reverb send: constant 1 until t, then a slightly longer release.
    const s = this.sendOut.gain;
    s.cancelScheduledValues(now);
    s.setValueAtTime(1, now);
    s.setValueAtTime(1, t);
    s.linearRampToValueAtTime(0, t + len + 0.5);
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
