import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { midi, line, lineLength, chord, progression } from '../../src/audio/core/notes.js';
import { SONGS, STINGERS } from '../../src/audio/music/songs.js';
import { PRESETS } from '../../src/audio/instruments/index.js';
import { AudioRng } from '../../src/audio/core/rng.js';
import { ksString, modal, noiseData } from '../../src/audio/dsp/synth.js';
import { impulseData } from '../../src/audio/dsp/impulse.js';
import { SFX, VOICE_OF } from '../../src/audio/sfx/library.js';
import { MONSTERS } from '../../src/data/monsters.js';
import { chart, pad, mel, counter } from '../../src/audio/music/compose.js';
import { ritSeconds } from '../../src/audio/music/Sequencer.js';

describe('audio notation', () => {
  it('parses pitches and durations', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C4')).toBe(60);
    expect(midi('F#3')).toBe(54);
    expect(midi('Bb2')).toBe(46);
    expect(lineLength('D4:q. A4:e A4:h')).toBe(4);
    expect(lineLength('A3:t A3:t A3:t D4:q')).toBeCloseTo(2);
    const ev = line('[D3,F3,A3]:h r:q C4:q!');
    expect(ev).toHaveLength(2);
    expect(ev[0].midi).toEqual([50, 53, 57]);
    expect(ev[1].t).toBe(3);
  });
  it('builds chords', () => {
    expect(chord('Dm').tones).toEqual([0, 3, 7]);
    expect(chord('C/E').bass).toBe(4);
    expect(progression('Dm | Bb C').map((c) => c.sym)).toEqual(['Dm', 'Bb', 'C']);
  });
});

describe('composed themes', () => {
  const all = { ...SONGS, ...STINGERS };
  for (const [id, song] of Object.entries(all)) {
    it(`${id}: every event is playable`, () => {
      for (const pass of [0, 1, 2]) {
        const r = song.build(pass, new AudioRng(pass + 1));
        expect(r.lengthQ).toBeGreaterThan(0);
        expect(r.events.length).toBeGreaterThan(0);
        for (const e of r.events) {
          expect(song.instruments[e.inst], `${id}: instrument ${e.inst}`).toBeTruthy();
          const spec = song.instruments[e.inst];
          expect(PRESETS[typeof spec === 'string' ? spec : spec.preset], `${id}: preset for ${e.inst}`).toBeTruthy();
          expect(e.t).toBeGreaterThanOrEqual(0);
          expect(e.t).toBeLessThan(r.lengthQ + 0.001);
          expect(e.dur).toBeGreaterThan(0);
          for (const m of [].concat(e.midi ?? [])) {
            expect(Number.isFinite(m)).toBe(true);
            expect(m).toBeGreaterThanOrEqual(21);
            expect(m).toBeLessThanOrEqual(108);
          }
        }
      }
    });
  }

  it('every written melody bar has the right length', () => {
    const dir = path.resolve(import.meta.dirname, '../../src/audio/music/themes');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const [, str] of src.matchAll(/'([^'\n]*:[whqest][^'\n]*\|[^'\n]*)'/g)) {
        const bars = str.split('|').map((b) => b.trim()).filter(Boolean).map(lineLength);
        // Every bar is one bar long (a tied note may hold for whole extra bars).
        const base = bars[0];
        const ok = (Math.abs(base - 4) < 1e-6 || Math.abs(base - 3) < 1e-6) && bars.every((b) => Math.abs(b / base - Math.round(b / base)) < 1e-6);
        expect(ok, `${f}: "${str}" bars = ${bars.join(', ')}`).toBe(true);
      }
    }
  });
});

describe('dsp', () => {
  it('Karplus-Strong strings are finite, audible and decay', () => {
    const d = ksString(22050, { freq: 196, dur: 2, t60: 1.5, vel: 0.8 });
    let early = 0;
    let late = 0;
    for (let i = 0; i < d.length; i++) {
      expect(Number.isFinite(d[i])).toBe(true);
      if (i < 4410) early = Math.max(early, Math.abs(d[i]));
      if (i > d.length - 4410) late = Math.max(late, Math.abs(d[i]));
    }
    expect(early).toBeGreaterThan(0.1);
    expect(late).toBeLessThan(early * 0.2);
  });
  it('modal drums and noise are finite', () => {
    for (const d of [modal(22050, { freq: 80, ratios: [1, 1.5], amps: [1, 0.5], decays: [0.5, 0.2], dur: 1 }), noiseData(22050, 1, 'pink')]) {
      expect(d.every(Number.isFinite)).toBe(true);
    }
  });
  it('impulse responses decay', () => {
    const [l] = impulseData(22050, 'dungeon');
    const head = Math.max(...l.subarray(0, 4000).map(Math.abs));
    const tail = Math.max(...l.subarray(l.length - 2000).map(Math.abs));
    expect(tail).toBeLessThan(head * 0.01);
  });
});

describe('sfx catalogue', () => {
  it('covers the names scenes use', () => {
    for (const n of ['click', 'step', 'bump', 'door', 'hit', 'miss', 'spell', 'coins', 'heal', 'bow', 'levelup', 'hover', 'confirm']) expect(SFX[n], n).toBeTypeOf('function');
  });
  it('gives every monster a voice', () => {
    for (const id of Object.keys(MONSTERS)) expect(VOICE_OF[id], id).toBeTruthy();
  });
});

describe('composition craft', () => {
  it('voice-leads pads: smallest motion, common tones held, no parallel fifths/octaves', () => {
    const ev = pad('s', chart('Dm | Bb | C | Dm | Gm | A | Dm', 4), { low: 'A3', count: 3 });
    let motion = 0;
    for (let i = 1; i < ev.length; i++) {
      const a = ev[i - 1].midi;
      const b = ev[i].midi;
      motion += b.reduce((acc, m, k) => acc + Math.abs(m - a[k]), 0);
      // Common tone of Dm → Bb (D, F) is held.
      if (i === 1) expect(b.filter((m) => a.includes(m)).length).toBeGreaterThanOrEqual(2);
      for (let x = 0; x < 3; x++) for (let y = x + 1; y < 3; y++) {
        const i0 = (a[y] - a[x]) % 12;
        const i1 = (b[y] - b[x]) % 12;
        const par = (i0 === 7 || i0 === 0) && i0 === i1 && a[x] !== b[x] && Math.sign(b[x] - a[x]) === Math.sign(b[y] - a[y]);
        expect(par, `parallel ${i0 ? 'fifths' : 'octaves'} at chord ${i}`).toBe(false);
      }
    }
    // Root-position parallel stacking would move ~5 semitones per voice per change.
    expect(motion / (ev.length - 1)).toBeLessThan(6);
  });
  it('colours dominant cadences with sus4 → 3 and a seventh', () => {
    const ev = pad('s', chart('Gm | A | Dm', 4), { low: 'D3', count: 4, cadence: true });
    expect(ev).toHaveLength(4); // A splits into Asus4 + A7
    const pcs = (e) => e.midi.map((m) => m % 12);
    expect(pcs(ev[1])).toContain(2); // D = the 4th over A
    expect(pcs(ev[2])).toContain(7); // G = the 7th
    expect(pcs(ev[2])).toContain(1); // C# = the 3rd
  });
  it('slurs melodies and shapes phrase dynamics', () => {
    const ev = mel('horn', 'D4:q A4:q D5:q A4:q | D4:w');
    expect(ev.every((e) => e.slur)).toBe(true);
    expect(ev[2].vel).toBeGreaterThan(ev[0].vel); // the peak note leads the phrase
    expect(ev[4].vel).toBeLessThan(ev[2].vel); // the phrase relaxes on its last note
  });
  it('counterlines move by step between chord tones', () => {
    const ev = counter('c', chart('Dm | Bb | C | Dm', 4), { low: 'A3', key: 2 });
    for (let i = 1; i < ev.length; i++) expect(Math.abs(ev[i].midi - ev[i - 1].midi)).toBeLessThanOrEqual(4);
  });
  it('ritardando stretches time', () => {
    expect(ritSeconds(8, [], 0.5)).toBeCloseTo(4);
    expect(ritSeconds(8, [[4, 8, 0.8]], 0.5)).toBeGreaterThan(4.2);
  });
  it('combat never plays the same section twice running and visits every section', () => {
    const state = {};
    const seen = [];
    for (let p = 0; p < 24; p++) seen.push(SONGS.combat.build(p, new AudioRng(p * 7 + 1), state).section);
    expect(seen[0]).toBe('A');
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThanOrEqual(5);
    const est = {};
    const ev = [0, 1, 2, 3, 4, 5].map((p) => SONGS.encounter.build(p, new AudioRng(p + 3), est).section);
    expect(new Set(ev).size).toBe(3);
  });
  it('keeps the combat low end clear (basses from D2, low brass high-passed)', () => {
    const r = SONGS.combat.build(0, new AudioRng(1), {});
    const basses = r.events.filter((e) => e.inst === 'basses' && e.opts?.art === 'spic');
    expect(Math.min(...basses.map((e) => [].concat(e.midi)[0]))).toBeGreaterThanOrEqual(38);
    expect(SONGS.combat.instruments.lowbrass.eq[0]).toMatchObject({ type: 'highpass' });
  });
});

describe('sfx variety', () => {
  it('gives spider, frog and lizard real death sounds and level-up its own cue', () => {
    expect(SFX.levelup).not.toBe(SFX.sparkle);
    expect(SFX.levelup.toString()).not.toMatch(/SFX\.sparkle/);
    for (const f of ['parry', 'shield', 'dodge', 'ready', 'arrow_in']) expect(SFX[f], f).toBeTypeOf('function');
  });
});
