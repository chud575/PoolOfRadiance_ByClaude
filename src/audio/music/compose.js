import { line, chord, voicing, rootIn, midi } from '../core/notes.js';

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

/** Melody line → events for `inst`. */
export function mel(inst, src, o = {}) {
  return line(src, o).map((n) => ({ inst, t: n.t, midi: n.midi, dur: n.dur, vel: n.vel, layer: o.layer, opts: o.opts }));
}

/** Sustained chords (pads), one per chart slot. */
export function pad(inst, ch, { low = 'D3', count = 4, vel = 0.5, layer, opts, overlap = 0.05, bassOct = false } = {}) {
  const lo = typeof low === 'string' ? midi(low) : low;
  return ch.map((c) => {
    const notes = voicing(c.ch, lo, count);
    if (bassOct) notes.unshift(rootIn(c.ch, lo - 12, c.ch.bass));
    return { inst, t: c.t, midi: notes, dur: c.len + overlap, vel, layer, opts };
  });
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
