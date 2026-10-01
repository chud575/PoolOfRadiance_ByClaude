import { chart, mel, pad, arp, drums, soften, counter } from '../compose.js';
import { midi } from '../../core/notes.js';

/**
 * Exploration moods: ruins (tense, sparse — E phrygian), dungeon (dark,
 * C minor with Db shadows), crypt (chant + tolling bell, D dorian) and the
 * wilds (open A dorian, harp and flute). All are slow and leave space: they
 * play for hours under footsteps and ambience.
 */

/** Seeded sparse "glints": random notes from a scale, `perBar` on average. */
function glints(inst, rng, { scale, low, bars, barQ = 4, perBar = 1, vel = 0.3, step = 0.5, layer, dur = 2 }) {
  const ev = [];
  const slots = Math.round(barQ / step);
  for (let b = 0; b < bars; b++) {
    let n = 0;
    for (let i = 0; i < slots; i++) if (rng.chance(perBar / slots)) {
      const deg = rng.int(0, scale.length * 2 - 1);
      const m = midi(low) + scale[deg % scale.length] + 12 * Math.floor(deg / scale.length);
      ev.push({ inst, t: b * barQ + i * step, midi: m, dur, vel: vel * rng.range(0.6, 1.1), layer });
      if (++n > perBar + 1) break;
    }
  }
  return ev;
}

export const ruins = {
  id: 'ruins',
  bpm: 58,
  barQ: 4,
  loop: true,
  gain: 0.55,
  intensity: 0.4,
  instruments: {
    celli: { preset: 'celli', pan: 0.3 },
    basses: { preset: 'basses', pan: 0.45 },
    choir: { preset: 'choirOo', pan: 0 },
    harmonics: { preset: 'harmonics', pan: -0.55 },
    harp: { preset: 'harp', pan: -0.3, reverb: 0.6 },
    flute: { preset: 'flute', pan: 0.3, reverb: 0.6 },
    horn: { preset: 'horn', pan: -0.5, reverb: 0.9, gain: 0.5, eq: [{ type: 'lowpass', f: 1800, q: 0.5 }] },
    taiko: { preset: 'taiko', pan: 0, gain: 0.7, reverb: 0.5 },
    violins: { preset: 'violins', pan: -0.2 },
    chime: { preset: 'chime', pan: 0.5 },
  },
  build(pass, rng) {
    const ev = [];
    const ch = chart('Em | Em | F | F | Em | Em | Dm | C | Em | Em | F | F | Am | G | F | Em', 4);
    ev.push({ inst: 'basses', t: 0, midi: 28, dur: 32, vel: 0.4, opts: { attack: 3, release: 3 } });
    ev.push({ inst: 'basses', t: 32, midi: 28, dur: 32, vel: 0.42, opts: { attack: 3, release: 3 } });
    ev.push(...pad('celli', chart('Em | F | Em | Dm,C | Em | F | Am,G | F,Em', 8), { low: 'E2', count: 2, vel: 0.32, opts: { art: 'trem', tremRate: 9 } }));
    ev.push(...pad('choir', ch, { low: 'G3', count: 3, vel: 0.32 }));
    ev.push(...glints('harmonics', rng, { scale: [0, 1, 3, 7, 8], low: 'E5', bars: 16, perBar: 0.8, vel: 0.35, dur: 3 }));
    if (pass % 2 === 0) {
      ev.push(...mel('flute', 'E5:h F5:q E5:q | D5:h. B4:q | C5:w | B4:w', { at: 16, vel: 0.45 }));
      ev.push(...mel('flute', 'A4:h C5:q E5:q | D5:h. B4:q | C5:h A4:h | B4:w', { at: 48, vel: 0.45 }));
    } else {
      ev.push(...mel('horn', 'B3:q. E4:e E4:h | F4:q E4:q B3:h', { at: 32, vel: 0.5 }));
      ev.push(...mel('harp', 'E4:e F4:e G4:e B4:e C5:h | B4:e A4:e G4:e F4:e E4:h', { at: 20, vel: 0.4 }));
      ev.push(...mel('violins', 'B4:w | C5:w | E5:h D5:h | B4:w', { at: 48, vel: 0.35, layer: 1 }));
    }
    ev.push(...drums('taiko', 'Xo..............', { bars: 8, at: 32, vel: 0.45, layer: 1 }));
    ev.push(...glints('chime', rng, { scale: [0], low: 'E4', bars: 16, perBar: 0.12, vel: 0.3 }));
    // Dissonant swell before the turn.
    ev.push({ inst: 'violins', t: 40, midi: [77, 83], dur: 8, vel: 0.3, opts: { art: 'swell' }, layer: 1 });
    return { lengthQ: 64, events: ev, tailQ: 4 };
  },
};

export const dungeon = {
  id: 'dungeon',
  bpm: 50,
  barQ: 4,
  loop: true,
  gain: 0.5,
  intensity: 0.4,
  instruments: {
    drone: { preset: 'drone', pan: 0, gain: 0.5 },
    choir: { preset: 'choirOo', pan: 0, formantShift: 0.9 },
    lowbrass: { preset: 'lowbrass', pan: -0.2, reverb: 0.7 },
    celli: { preset: 'celli', pan: 0.3 },
    basses: { preset: 'basses' },
    celesta: { preset: 'celesta', pan: 0.5, reverb: 0.9, gain: 0.35 },
    harmonics: { preset: 'harmonics', pan: -0.5 },
    timpani: { preset: 'timpani', pan: 0.1 },
    taiko: { preset: 'taiko', gain: 0.6, reverb: 0.7 },
    bassoon: { preset: 'bassoon', pan: -0.3, reverb: 0.6 },
  },
  build(pass, rng) {
    const ev = [];
    ev.push({ inst: 'drone', t: 0, midi: [36, 43], dur: 64, vel: 0.45, opts: { attack: 4, release: 4, bright: 3, fifth: 0 } });
    const ch = chart('Cm | Cm | Db | Db | Cm | Cm | Ab | G | Cm | Cm | Fm | Fm | Db | Db | G | G', 4);
    ev.push(...pad('choir', ch, { low: 'G3', count: 3, vel: 0.3 }));
    ev.push(...pad('basses', chart('Cm | Db | Cm | Ab,G | Cm | Fm | Db | G', 8), { low: 'C2', count: 1, vel: 0.35 }));
    ev.push(...mel(pass % 2 ? 'bassoon' : 'lowbrass', 'C3:h Eb3:q D3:q | Db3:w | C3:h. Bb2:q | B2:w', { at: 16, vel: 0.5 }));
    if (pass % 2) ev.push(...mel('celli', 'G3:h Ab3:q G3:q | F3:h Eb3:h | Db3:h. C3:q | B2:w', { at: 48, vel: 0.4 }));
    else ev.push(...mel('lowbrass', 'Ab2:h G2:q F2:q | G2:w~w', { at: 48, vel: 0.45 }));
    ev.push(...glints('celesta', rng, { scale: [0, 2, 3, 7, 8], low: 'C6', bars: 16, perBar: 0.5, vel: 0.3, dur: 2 }));
    ev.push(...glints('harmonics', rng, { scale: [0, 1, 6], low: 'C5', bars: 16, perBar: 0.25, vel: 0.25, dur: 3 }));
    ev.push({ inst: 'timpani', t: 26, midi: 31, dur: 6, vel: 0.5, roll: [0.08, 0.55] });
    ev.push({ inst: 'timpani', t: 58, midi: 31, dur: 6, vel: 0.5, roll: [0.08, 0.6] });
    ev.push(...drums('taiko', 'X...............|................', { bars: 16, vel: 0.4, layer: 1 }));
    ev.push({ inst: 'celli', t: 50, midi: [54, 60], dur: 6, vel: 0.35, opts: { art: 'swell' }, layer: 1 });
    return { lengthQ: 64, events: ev, tailQ: 6 };
  },
};

export const crypt = {
  id: 'crypt',
  bpm: 56,
  barQ: 4,
  loop: true,
  gain: 0.75,
  instruments: {
    chant: { preset: 'choirOh', pan: 0, voices: 5 },
    choir: { preset: 'choirOo', pan: 0 },
    bell: { preset: 'churchBell', pan: -0.2 },
    drone: { preset: 'organ', gain: 0.35 },
    harmonics: { preset: 'harmonics', pan: 0.4 },
    celli: { preset: 'celli', pan: 0.3 },
    harp: { preset: 'harp', pan: -0.4 },
  },
  build(pass, rng) {
    const ev = [];
    ev.push({ inst: 'drone', t: 0, midi: [38, 45], dur: 64, vel: 0.4, opts: { attack: 4, release: 4, bright: 2.5, fifth: 0 } });
    const chant = 'D4:h F4:q E4:q | D4:h C4:h | D4:q F4:q G4:q A4:q | A4:w | G4:h F4:q E4:q | F4:h D4:h | E4:h. C4:q | D4:w';
    ev.push(...mel('chant', chant, { at: 0, vel: 0.45, transpose: -12 }));
    if (pass % 2) ev.push(...mel('chant', chant, { at: 32, vel: 0.42 }));
    else ev.push(...pad('choir', chart('Dm | C | Dm | Am | Gm | Dm | C | Dm', 4, 32), { low: 'A3', count: 3, vel: 0.3 }));
    for (let b = 0; b < 16; b += 4) ev.push({ inst: 'bell', t: b * 4, midi: 50, dur: 4, vel: 0.45 });
    ev.push(...glints('harmonics', rng, { scale: [0, 2, 3, 7, 9], low: 'D5', bars: 16, perBar: 0.5, vel: 0.3, dur: 3 }));
    ev.push(...pad('celli', chart('Dm | Dm | C | Dm', 16), { low: 'D2', count: 2, vel: 0.3, opts: { art: 'trem', tremRate: 7 } }));
    ev.push(...arp('harp', chart('Dm | C | Gm | Dm', 4, 48), { low: 'D3', pattern: [0, 2, 4, null, 3, null, 1, null], step: 0.5, vel: 0.35, ring: 3 }));
    return { lengthQ: 64, events: ev, tailQ: 6 };
  },
};

export const wilds = {
  id: 'wilds',
  bpm: 72,
  barQ: 4,
  loop: true,
  gain: 0.94,
  instruments: {
    harp: { preset: 'harp', pan: -0.55 },
    flute: { preset: 'flute', pan: 0.3 },
    violins: { preset: 'violins', pan: -0.4 },
    strings: { preset: 'strings', pan: -0.1 },
    celli: { preset: 'celli', pan: 0.3, gain: 0.8 },
    basses: { preset: 'basses', pan: 0.45 },
    horn: { preset: 'horn', pan: -0.3, reverb: 0.7 },
    frame: { preset: 'frame', pan: 0.35, gain: 0.5 },
  },
  build(pass) {
    const ev = [];
    const ca = chart('Am | G | Am,G | Am | Am | C | D | Am', 4);
    const cb = chart('C | G | Am | Em | F | C | D | E', 4, 32);
    const all = [...ca, ...cb];
    ev.push(...pad('strings', all, { low: 'A3', count: 3, vel: 0.3, cadence: true }));
    ev.push(...counter('celli', all, { low: 'E3', vel: 0.26, scale: [0, 2, 3, 5, 7, 9, 10], key: 9 }));
    ev.push(...pad('basses', all, { low: 'E2', count: 1, vel: 0.35 }));
    ev.push(...arp('harp', all, { low: 'A2', pattern: [0, 2, 3, 4, 5, 4, 3, 2], step: 0.5, vel: 0.42 }));
    ev.push(...mel('flute', 'A4:q. B4:e C5:q E5:q | D5:h B4:h | C5:q. B4:e A4:q G4:q | A4:w | E5:q. D5:e C5:q D5:q | E5:h G5:h | F#5:q E5:q D5:q B4:q | A4:w', { vel: 0.58 }));
    const bLead = pass % 2 ? 'horn' : 'violins';
    ev.push(...mel(bLead, 'E5:h. C5:q | D5:h B4:h | C5:q E5:q A5:q G5:q | E5:w | F5:h. E5:q | E5:q D5:q C5:h | D5:q E5:q F#5:q A5:q | G#5:w', { at: 32, vel: 0.55, transpose: bLead === 'horn' ? -12 : 0 }));
    ev.push(...drums('frame', 'X.....x.X.......', { bars: 16, step: 0.25, vel: 0.4, skipBars: [0, 1, 2, 3] }));
    return { lengthQ: 64, events: ev, tailQ: 4, rit: [[60, 64, 0.85]] };
  },
};

export const camp = {
  id: 'camp',
  bpm: 80,
  barQ: 3,
  loop: true,
  gain: 1.06,
  instruments: {
    harp: { preset: 'harp', pan: -0.5 },
    lute: { preset: 'lute', pan: 0.45 },
    flute: { preset: 'flute', pan: 0.2 },
    recorder: { preset: 'recorder', pan: 0.15 },
    strings: { preset: 'strings', pan: -0.1, gain: 0.7 },
    violins: { preset: 'violins', pan: -0.4, gain: 0.7 },
    violins2: { preset: 'violins', pan: -0.25, gain: 0.6 },
    basses: { preset: 'basses', pan: 0.4, gain: 0.7 },
  },
  build(pass) {
    const ev = [];
    const ca = chart('F | Gm | F | C | F | Bb | C | F', 3);
    const cb = chart('Am | F | Gm | F | C | Bb | C | F', 3, 24);
    const all = [...ca, ...cb];
    const MA = 'A4:h C5:q | Bb4:h G4:q | A4:q G4:q F4:q | G4:h. | A4:h C5:q | D5:h C5:q | Bb4:q A4:q G4:q | F4:h.';
    // Bar 5 of the second strain whispers the title motif (a fifth, held), in F major.
    const MB = 'C5:h D5:q | C5:h A4:q | Bb4:h C5:q | A4:h. | G4:q. D5:e D5:q | Bb4:h D5:q | C5:q Bb4:q G4:q | F4:h.';
    ev.push(...arp(pass % 2 ? 'lute' : 'harp', all, { low: 'F2', pattern: [0, 2, 3, 4, 3, 2], step: 0.5, vel: 0.42, ring: 1.5 }));
    ev.push(...pad('strings', all, { low: 'A3', count: 3, vel: 0.22, cadence: true }));
    ev.push(...counter('violins2', cb, { low: 'F4', vel: 0.2, scale: [0, 2, 4, 5, 7, 9, 10], key: 5 }));
    ev.push(...pad('basses', all, { low: 'F2', count: 1, vel: 0.28 }));
    const lead = ['flute', 'lute', 'recorder'][pass % 3];
    ev.push(...mel(lead, MA, { vel: 0.52, transpose: lead === 'lute' ? 0 : 0 }));
    ev.push(...mel(lead, MB, { at: 24, vel: 0.5 }));
    if (pass % 3 === 2) ev.push(...soften(mel('violins', MB, { at: 24, transpose: -12 }), 0.55));
    return { lengthQ: 48, events: ev, tailQ: 3, rit: [[45, 48, 0.85]] };
  },
};
