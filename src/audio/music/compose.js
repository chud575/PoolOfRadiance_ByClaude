import { line, chord, voicing, rootIn, midi } from '../core/notes.js';
import { voiceLead, colourChord } from './voicelead.js';

/**
 * Composition helpers: turn chord charts, melody lines and drum grids into
 * TrackPlayer events. All times in quarter notes.
 */

/**
 * Chord chart → timed chords. Bars separated by `|`; `C,F` splits a bar.
 * @returns {{ch: ReturnType<typeof chord>, t: number, len: number, bar: number}[]}
 */
export function chart(src, barQ = 4, at = 0) {
  const out = [];
  src
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((bar, b) => {
      const parts = bar.split(',').map((s) => s.trim());
      const len = barQ / parts.length;
      parts.forEach((sym, i) => out.push({ ch: chord(sym), t: at + b * barQ + i * len, len, bar: b }));
    });
  return out;
}

/**
 * Melody line → events for `inst`. Notes are slurred by default (sustained
 * instruments then play each unbroken run as one legato phrase) and shaped
 * dynamically: each phrase (run between rests) swells toward its highest
 * notes and relaxes on its last note, as a player would breathe it.
 * o.shape scales the dynamic shaping (0 = flat), o.slur = false detaches.
 */
export function mel(inst, src, o = {}) {
  const notes = line(src, o);
  const shape = o.shape ?? 1;
  if (shape) {
    let i = 0;
    while (i < notes.length) {
      let j = i;
      while (j + 1 < notes.length && Math.abs(notes[j + 1].t - (notes[j].t + notes[j].dur)) < 1e-6) j++;
      const run = notes.slice(i, j + 1);
      const ps = run.map((n) => n.midi[0]);
      const lo = Math.min(...ps);
      const hi = Math.max(...ps);
      run.forEach((n, k) => {
        const h = hi > lo ? (n.midi[0] - lo) / (hi - lo) : 0.5;
        let k2 = 0.92 + 0.16 * h;
        if (run.length > 2 && k === run.length - 1) k2 *= 0.9;
        n.vel = Math.min(1, n.vel * (1 + (k2 - 1) * shape));
      });
      i = j + 1;
    }
  }
  return notes.map((n) => ({ inst, t: n.t, midi: n.midi, dur: n.dur, vel: n.vel, layer: o.layer, opts: o.opts, slur: o.slur ?? n.midi.length === 1 }));
}

/**
 * Sustained chords (pads), one per chart slot, with real voice leading: each
 * chord takes the inversion nearest the previous voicing (smallest total
 * motion, common tones held, no parallel fifths/octaves where avoidable).
 * o.cadence: dominant chords that resolve (V → I) get a sus4 → 3 and, with
 * 4+ voices, a minor seventh. o.bassOct adds the bass (slash chords honoured).
 * o.center: preferred middle of the voicing (defaults to `low` + a fifth).
 */
export function pad(inst, ch, { low = 'D3', count = 4, vel = 0.5, layer, opts, overlap = 0.05, bassOct = false, cadence = false, center } = {}) {
  const lo = typeof low === 'string' ? midi(low) : low;
  const ctr = center ?? lo + 6;
  const out = [];
  let prev = null;
  ch.forEach((c, i) => {
    const parts = cadence ? colourChord(c, ch[i + 1], count) : [{ ch: c.ch, t: c.t, len: c.len }];
    for (const part of parts) {
      const notes = count === 1 ? [rootIn(part.ch, lo, part.ch.bass)] : voiceLead(prev, part.ch, lo, count, ctr);
      prev = notes;
      const ev = notes.slice();
      if (bassOct) ev.unshift(rootIn(part.ch, lo - 12, part.ch.bass));
      out.push({ inst, t: part.t, midi: ev, dur: part.len + overlap, vel, layer, opts });
    }
  });
  return out;
}

/**
 * Inner-voice counterline: a slurred line that walks between chord tones,
 * holding common tones and passing by step (through `scale`, pitch classes)
 * toward the next chord on the second half of long slots.
 */
export function counter(inst, ch, { low = 'A3', vel = 0.4, scale = [0, 2, 3, 5, 7, 8, 10], key = 2, layer, opts, start } = {}) {
  const lo = typeof low === 'string' ? midi(low) : low;
  const pcs = scale.map((x) => (x + key) % 12);
  const near = (target, c) => {
    let best = null;
    for (let m = lo - 2; m <= lo + 14; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (!c.ch.tones.some((tn) => (c.ch.root + tn) % 12 === pc)) continue;
      if (best === null || Math.abs(m - target) < Math.abs(best - target) || (Math.abs(m - target) === Math.abs(best - target) && m < best)) best = m;
    }
    return best ?? target;
  };
  const step = (from, to) => {
    const dir = Math.sign(to - from);
    for (let m = from + dir; dir && m !== to; m += dir) if (pcs.includes(((m % 12) + 12) % 12)) return m;
    return null;
  };
  const ev = [];
  let cur = start !== undefined ? (typeof start === 'string' ? midi(start) : start) : lo + 5;
  ch.forEach((c, i) => {
    cur = near(cur, c);
    const nxt = ch[i + 1];
    const target = nxt ? near(cur, nxt) : cur;
    const pass = c.len >= 2 && target !== cur ? step(cur, target) : null;
    if (pass !== null && Math.abs(target - cur) >= 2) {
      const h = c.len / 2;
      ev.push({ inst, t: c.t, midi: cur, dur: h, vel, layer, opts, slur: true });
      ev.push({ inst, t: c.t + h, midi: pass, dur: c.len - h, vel: vel * 0.92, layer, opts, slur: true });
      cur = pass;
    } else ev.push({ inst, t: c.t, midi: cur, dur: c.len, vel, layer, opts, slur: true });
  });
  return ev;
}

/**
 * Arpeggio over each chord. `pattern` indexes chord tones upward (0 = root,
 * 3 = root +8va for triads…); `step` in quarters; `null` = rest.
 */
export function arp(inst, ch, { low = 'D3', pattern = [0, 1, 2, 3, 2, 1], step = 0.5, vel = 0.55, accent = 0.15, layer, opts, ring = 1 } = {}) {
  const lo = typeof low === 'string' ? midi(low) : low;
  const ev = [];
  for (const c of ch) {
    const tones = voicing(c.ch, lo, 8);
    const n = Math.round(c.len / step);
    for (let i = 0; i < n; i++) {
      const p = pattern[i % pattern.length];
      if (p === null || p === undefined) continue;
      ev.push({ inst, t: c.t + i * step, midi: tones[p], dur: step * ring, vel: vel + (i % pattern.length === 0 ? accent : 0), layer, opts });
    }
  }
  return ev;
}

/**
 * Bass/ostinato from a rhythm string per chord slot: characters
 * `R` root, `5` fifth, `8` octave, `3` third, `.` rest, `-` hold previous.
 */
export function riff(inst, ch, rhythm, { low = 'D2', step = 0.5, vel = 0.7, accents = '', layer, opts, gate = 0.9 } = {}) {
  const lo = typeof low === 'string' ? midi(low) : low;
  const ev = [];
  for (const c of ch) {
    const r = rootIn(c.ch, lo, c.ch.bass);
    const steps = Math.round(c.len / step);
    let last = null;
    for (let i = 0; i < steps; i++) {
      const sym = rhythm[i % rhythm.length];
      if (sym === '.') {
        last = null;
        continue;
      }
      if (sym === '-') {
        if (last) last.dur += step;
        continue;
      }
      const off = { R: 0, 5: 7, 8: 12, 3: c.ch.tones[1], 4: 5, 7: c.ch.tones[3] ?? 10, b: -2, '2': 2, l: -5 }[sym] ?? 0;
      const acc = accents[i % (accents.length || 1)] === '>' ? 0.2 : 0;
      last = { inst, t: c.t + i * step, midi: r + off, dur: step * gate, vel: Math.min(1, vel + acc), layer, opts };
      ev.push(last);
    }
  }
  return ev;
}

/**
 * Drum grid: one character per `step`. `x` normal, `X` accent, `o` soft,
 * `r` roll (to the next hit), `.` rest. Pattern repeats for `bars`.
 */
export function drums(inst, pattern, { bars = 1, barQ = 4, step = 0.25, at = 0, vel = 0.7, midi: m, layer, opts, skipBars = [] } = {}) {
  const ev = [];
  const p = pattern.replace(/\s|\|/g, '');
  const perBar = Math.round(barQ / step);
  for (let b = 0; b < bars; b++) {
    if (skipBars.includes(b)) continue;
    for (let i = 0; i < perBar; i++) {
      const c = p[(b * perBar + i) % p.length];
      if (c === '.' || c === undefined) continue;
      const t = at + b * barQ + i * step;
      if (c === 'r') {
        ev.push({ inst, t, midi: m, dur: step * 2, vel: vel * 0.6, roll: [vel * 0.3, vel * 0.8], layer, opts });
        continue;
      }
      ev.push({ inst, t, midi: m, dur: step, vel: c === 'X' ? Math.min(1, vel * 1.3) : c === 'o' ? vel * 0.55 : vel, layer, opts });
    }
  }
  return ev;
}

/** Shift events in time. */
export const shift = (ev, dt) => ev.map((e) => ({ ...e, t: e.t + dt }));

/** Set a layer on all events. */
export const onLayer = (ev, layer) => ev.map((e) => ({ ...e, layer }));

/** Transpose events by semitones. */
export const transpose = (ev, n) => ev.map((e) => ({ ...e, midi: Array.isArray(e.midi) ? e.midi.map((x) => x + n) : e.midi + n }));

/** Velocity scale. */
export const soften = (ev, k) => ev.map((e) => ({ ...e, vel: (e.vel ?? 0.7) * k }));
