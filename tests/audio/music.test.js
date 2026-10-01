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
