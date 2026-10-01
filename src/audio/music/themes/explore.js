import { chart, mel, pad, arp, drums, soften, counter, riff } from '../compose.js';
import { midi } from '../../core/notes.js';

/**
 * Exploration moods: ruins (tense, sparse — E phrygian), dungeon (dark,
 * C minor with Db shadows), crypt (chant + tolling bell, D dorian) and the
 * wilds (open A dorian, harp and flute). All are slow and leave space: they
 * play for hours under footsteps and ambience.
 */

/**
 * Which of `n` genuinely different passes to play: all of them before any
 * repeats (seeded order), never the same twice running.
 */
function variant(pass, rng, state, n) {
  if (!state.bag?.length) {
    const bag = [...Array(n).keys()];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (pass === 0) bag.splice(bag.indexOf(0), 1), bag.unshift(0);
    if (bag[0] === state.last && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
    state.bag = bag;
  }
  const v = state.bag.shift();
  state.last = v;
  return v;
}

/** Long exploration cues fall silent for a while every few minutes (see TrackPlayer). */
const REST = { after: [130, 190], length: [45, 110] };

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
  key: 4,
  room: 'hall',
  wet: 0.6,
  rest: REST,
  instruments: {
    celli: { preset: 'celli', pan: 0.4 },
    basses: { preset: 'basses', pan: 0.6 },
    pizz: { preset: 'pizz', pan: -0.35 },
    choir: { preset: 'choirOo', pan: 0 },
    harmonics: { preset: 'harmonics', pan: -0.55 },
    harp: { preset: 'harp', pan: -0.3, reverb: 0.6 },
    flute: { preset: 'flute', pan: 0.3, reverb: 0.6 },
    horn: { preset: 'horn', pan: -0.5, reverb: 0.9, gain: 0.5, eq: [{ type: 'lowpass', f: 1800, q: 0.5 }] },
    taiko: { preset: 'taiko', pan: 0, gain: 0.7, reverb: 0.5 },
    violins: { preset: 'violins', pan: -0.2 },
    chime: { preset: 'chime', pan: 0.5 },
  },
  build(pass, rng, state = {}) {
    const ev = [];
    const v = variant(pass, rng, state, 4);
    if (v === 2) {
      // III. "The Cellist in the Rubble": a solo cello lament over pizzicato and a low bell-like harp.
      const ch = chart('Em | Dm | F | Em | Am | G | F | Em | Em | Dm | C | Bm | Am | F | B | Em', 4);
      ev.push(...pad('basses', chart('Em | Dm | F | Em | Am | G | F | Em', 8), { low: 'E2', count: 1, vel: 0.32, opts: { attack: 1.5 } }));
      ev.push(...arp('pizz', ch, { low: 'E3', pattern: [0, null, 2, null, 1, null, null, null], step: 0.5, vel: 0.38 }));
      ev.push(...mel('celli', 'r:w | E3:h F3:q G3:q | A3:h. G3:e F3:e | E3:w | C4:h B3:q A3:q | B3:h. G3:q | A3:q G3:q F3:q D3:q | E3:w', { at: 0, vel: 0.52 }));
      ev.push(...mel('celli', 'r:w | B3:h C4:q D4:q | E4:h. D4:e C4:e | B3:h F#3:h | A3:h. B3:e C4:e | A3:h F3:h | D#3:w | E3:w', { at: 32, vel: 0.55 }));
      ev.push(...pad('choir', chart('Em | F | Am | Em', 16), { low: 'G3', count: 3, vel: 0.22, layer: 1 }));
      ev.push(...glints('harmonics', rng, { scale: [0, 1, 3, 7, 8], low: 'E5', bars: 16, perBar: 0.4, vel: 0.3, dur: 3 }));
    } else if (v === 3) {
      // IV. "Ghosts of the Market": a distant wordless choir sings the old town jig, slowed and broken, over a heartbeat.
      ev.push({ inst: 'basses', t: 0, midi: 28, dur: 64, vel: 0.36, opts: { attack: 4, release: 4 } });
      ev.push(...drums('taiko', 'X..x............', { bars: 16, vel: 0.32 }));
      ev.push(...mel('choir', 'E4:h. G4:q | B4:h A4:h | G4:q F4:q E4:h | E4:w | G4:h. B4:q | D5:h C5:h | B4:q A4:q G4:q F4:q | E4:w', { vel: 0.4 }));
      ev.push(...mel('choir', 'B4:h. C5:q | D5:h C5:h | B4:h A4:h | G4:w | F4:h. G4:q | A4:h G4:q F4:q | E4:h D#4:h | E4:w', { at: 32, vel: 0.36 }));
      ev.push(...pad('celli', chart('Em | Am | Em | B', 16), { low: 'E2', count: 2, vel: 0.28, opts: { art: 'swell' } }));
      ev.push(...mel('flute', 'r:w | r:w | r:w | r:w | r:w | r:w | E5:h F5:h | E5:w', { at: 32, vel: 0.35, opts: { vib: 2 } }));
      ev.push(...glints('chime', rng, { scale: [0, 7], low: 'E4', bars: 16, perBar: 0.18, vel: 0.28 }));
    } else {
      const ch = chart('Em | Em | F | F | Em | Em | Dm | C | Em | Em | F | F | Am | G | F | Em', 4);
      ev.push({ inst: 'basses', t: 0, midi: 28, dur: 32, vel: 0.4, opts: { attack: 3, release: 3 } });
      ev.push({ inst: 'basses', t: 32, midi: 28, dur: 32, vel: 0.42, opts: { attack: 3, release: 3 } });
      ev.push(...pad('celli', chart('Em | F | Em | Dm,C | Em | F | Am,G | F,Em', 8), { low: 'E2', count: 2, vel: 0.32, opts: { art: 'trem', tremRate: 9 } }));
      ev.push(...pad('choir', ch, { low: 'G3', count: 3, vel: 0.32 }));
      ev.push(...glints('harmonics', rng, { scale: [0, 1, 3, 7, 8], low: 'E5', bars: 16, perBar: 0.8, vel: 0.35, dur: 3 }));
      if (v === 0) {
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
    }
    return { lengthQ: 64, events: ev, tailQ: 4, section: `v${v}` };
  },
};

export const dungeon = {
  id: 'dungeon',
  bpm: 50,
  barQ: 4,
  loop: true,
  gain: 0.5,
  intensity: 0.4,
  key: 0,
  room: 'vault',
  wet: 0.55,
  rest: REST,
  instruments: {
    choirMm: { preset: 'choirMm', pan: -0.2 },
    pizz: { preset: 'pizz', pan: 0.35 },
    horn: { preset: 'horn', pan: -0.45, reverb: 0.9, gain: 0.6 },
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
  build(pass, rng, state = {}) {
    const ev = [];
    const v = variant(pass, rng, state, 4);
    ev.push({ inst: 'drone', t: 0, midi: [36, 43], dur: 64, vel: v === 3 ? 0.3 : 0.45, opts: { attack: 4, release: 4, bright: 3, fifth: 0 } });
    if (v === 2) {
      // III. "Music Box": a celesta tune from some lost child's box, a humming choir, nothing else.
      const ch = chart('Cm | Ab | Fm | G | Cm | Ab | Db | G', 8);
      ev.push(...pad('choirMm', ch, { low: 'G3', count: 3, vel: 0.3 }));
      ev.push(...pad('basses', ch, { low: 'C2', count: 1, vel: 0.3, opts: { attack: 2 } }));
      ev.push(...mel('celesta', 'G5:q Eb5:q C5:q Eb5:q | D5:h. r:q | Ab5:q G5:q F5:q Eb5:q | D5:w | F5:q Eb5:q D5:q C5:q | B4:h. r:q | C5:q D5:q Eb5:q G5:q | G5:w', { vel: 0.4, slur: false }));
      ev.push(...mel('celesta', 'G5:q Eb5:q C5:q Eb5:q | D5:h. r:q | Ab5:q G5:q F5:q Ab5:q | G5:w | F5:q Eb5:q Db5:q C5:q | B4:h. r:q | D5:q C5:q B4:q D5:q | C5:w', { at: 32, vel: 0.36, slur: false }));
      ev.push(...glints('harmonics', rng, { scale: [0, 1, 6], low: 'C5', bars: 16, perBar: 0.2, vel: 0.22, dur: 3 }));
    } else if (v === 3) {
      // IV. "Something Follows": a pizzicato heartbeat, far horn calls, a timpani pulse that comes closer.
      const ch = chart('Cm | Cm | Db | Cm | Cm | Fm | Db | G', 8);
      ev.push(...arp('pizz', ch, { low: 'C2', pattern: [0, null, null, 0, null, null, null, null], step: 0.5, vel: 0.5 }));
      ev.push(...drums('timpani', 'x.......o.......', { bars: 16, vel: 0.35, midi: 31 }));
      ev.push(...mel('horn', 'r:w | r:w | G3:q. C4:e C4:h | r:w | r:w | r:w | Ab3:q. Db4:e Db4:h | B3:w', { vel: 0.5 }));
      ev.push(...mel('horn', 'r:w | r:w | C4:q. G4:e G4:h | r:w | r:w | Ab3:h G3:h | F#3:w | G3:w', { at: 32, vel: 0.55 }));
      ev.push(...pad('celli', ch, { low: 'C3', count: 2, vel: 0.26, opts: { art: 'trem', tremRate: 8 }, layer: 1 }));
      ev.push(...drums('taiko', 'X.......x.......', { bars: 8, at: 32, vel: 0.4, layer: 1 }));
    } else {
      const ch = chart('Cm | Cm | Db | Db | Cm | Cm | Ab | G | Cm | Cm | Fm | Fm | Db | Db | G | G', 4);
      ev.push(...pad('choir', ch, { low: 'G3', count: 3, vel: 0.3 }));
      ev.push(...pad('basses', chart('Cm | Db | Cm | Ab,G | Cm | Fm | Db | G', 8), { low: 'C2', count: 1, vel: 0.35 }));
      ev.push(...mel(v === 1 ? 'bassoon' : 'lowbrass', 'C3:h Eb3:q D3:q | Db3:w | C3:h. Bb2:q | B2:w', { at: 16, vel: 0.5 }));
      if (v === 1) ev.push(...mel('celli', 'G3:h Ab3:q G3:q | F3:h Eb3:h | Db3:h. C3:q | B2:w', { at: 48, vel: 0.4 }));
      else ev.push(...mel('lowbrass', 'Ab2:h G2:q F2:q | G2:w~w', { at: 48, vel: 0.45 }));
      ev.push(...glints('celesta', rng, { scale: [0, 2, 3, 7, 8], low: 'C6', bars: 16, perBar: 0.5, vel: 0.3, dur: 2 }));
      ev.push(...glints('harmonics', rng, { scale: [0, 1, 6], low: 'C5', bars: 16, perBar: 0.25, vel: 0.25, dur: 3 }));
      ev.push({ inst: 'timpani', t: 26, midi: 31, dur: 6, vel: 0.5, roll: [0.08, 0.55] });
      ev.push({ inst: 'timpani', t: 58, midi: 31, dur: 6, vel: 0.5, roll: [0.08, 0.6] });
      ev.push(...drums('taiko', 'X...............|................', { bars: 16, vel: 0.4, layer: 1 }));
      ev.push({ inst: 'celli', t: 50, midi: [54, 60], dur: 6, vel: 0.35, opts: { art: 'swell' }, layer: 1 });
    }
    return { lengthQ: 64, events: ev, tailQ: 6, section: `v${v}` };
  },
};

export const crypt = {
  id: 'crypt',
  bpm: 56,
  barQ: 4,
  loop: true,
  gain: 0.75,
  key: 2,
  room: 'cathedral',
  wet: 0.6,
  rest: REST,
  instruments: {
    kyrie: { preset: 'choir', pan: 0, text: ['ee', 'ee', 'eh', 'eh', 'ee', 'oh', 'ah', 'ee'] },
    chant: { preset: 'choirOh', pan: 0, voices: 5 },
    choir: { preset: 'choirOo', pan: 0 },
    bell: { preset: 'churchBell', pan: -0.2 },
    drone: { preset: 'organ', gain: 0.35 },
    harmonics: { preset: 'harmonics', pan: 0.4 },
    celli: { preset: 'celli', pan: 0.3 },
    harp: { preset: 'harp', pan: -0.4 },
  },
  build(pass, rng, state = {}) {
    const ev = [];
    const v = variant(pass, rng, state, 4);
    ev.push({ inst: 'drone', t: 0, midi: [38, 45], dur: 64, vel: 0.4, opts: { attack: 4, release: 4, bright: 2.5, fifth: 0 } });
    for (let b = 0; b < 16; b += 4) ev.push({ inst: 'bell', t: b * 4, midi: 50, dur: 4, vel: v === 2 ? 0.3 : 0.45 });
    ev.push(...glints('harmonics', rng, { scale: [0, 2, 3, 7, 9], low: 'D5', bars: 16, perBar: 0.5, vel: 0.3, dur: 3 }));
    const chant = 'D4:h F4:q E4:q | D4:h C4:h | D4:q F4:q G4:q A4:q | A4:w | G4:h F4:q E4:q | F4:h D4:h | E4:h. C4:q | D4:w';
    if (v === 2) {
      // III. "Elegy": no voices — harp and a cello duet over the drone.
      ev.push(...arp('harp', chart('Dm | Bb | C | Dm | Gm | Dm | A | Dm', 8), { low: 'D3', pattern: [0, 2, 4, 5, 4, 2, 1, 2], step: 1, vel: 0.36, ring: 3 }));
      ev.push(...mel('celli', 'A3:h. G3:e F3:e | F3:w | E3:h. F3:e G3:e | A3:w | Bb3:h. A3:e G3:e | A3:h F3:h | E3:q F3:q G3:q E3:q | D3:w', { vel: 0.5 }));
      ev.push(...mel('celli', 'D4:h. C4:e Bb3:e | A3:w | G3:h. A3:e Bb3:e | C4:w | D4:h. C4:e Bb3:e | A3:h D4:h | C#4:h. D4:e E4:e | D4:w', { at: 32, vel: 0.52 }));
      ev.push(...pad('choir', chart('Dm | Gm | A | Dm', 16, 0), { low: 'A3', count: 3, vel: 0.2, layer: 1 }));
    } else if (v === 3) {
      // IV. "Kyrie": the full choir in homophony, word by word, answering the bell.
      const ch = chart('Dm | C | Bb | A | Dm | Gm | A | Dm', 8);
      ev.push(...pad('kyrie', ch, { low: 'A3', count: 4, vel: 0.36, cadence: true }));
      ev.push(...mel('chant', 'D4:h D4:h | F4:h E4:h | D4:h C4:h | A3:w | D4:h F4:h | G4:h A4:h | G4:h F4:h | E4:w | F4:h F4:h | E4:h D4:h | E4:h C#4:h | D4:w | F4:h G4:h | A4:h G4:h | E4:h. E4:q | D4:w', { vel: 0.4, transpose: -12 }));
    } else {
      ev.push(...mel('chant', chant, { at: 0, vel: 0.45, transpose: -12 }));
      if (v === 1) ev.push(...mel('chant', chant, { at: 32, vel: 0.42 }));
      else ev.push(...pad('choir', chart('Dm | C | Dm | Am | Gm | Dm | C | Dm', 4, 32), { low: 'A3', count: 3, vel: 0.3 }));
      ev.push(...pad('celli', chart('Dm | Dm | C | Dm', 16), { low: 'D2', count: 2, vel: 0.3, opts: { art: 'trem', tremRate: 7 } }));
      ev.push(...arp('harp', chart('Dm | C | Gm | Dm', 4, 48), { low: 'D3', pattern: [0, 2, 4, null, 3, null, 1, null], step: 0.5, vel: 0.35, ring: 3 }));
    }
    return { lengthQ: 64, events: ev, tailQ: 6, section: `v${v}` };
  },
};

export const wilds = {
  id: 'wilds',
  bpm: 72,
  barQ: 4,
  loop: true,
  gain: 0.94,
  key: 9,
  room: 'hall',
  wet: 0.5,
  rest: REST,
  instruments: {
    harp: { preset: 'harp', pan: -0.6 },
    flute: { preset: 'flute', pan: 0.25 },
    recorder: { preset: 'recorder', pan: 0.2 },
    lute: { preset: 'lute', pan: 0.5 },
    pizz: { preset: 'pizz', pan: 0.4 },
    violins: { preset: 'violins', pan: -0.55 },
    strings: { preset: 'strings', pan: 0 },
    celli: { preset: 'celli', pan: 0.4, gain: 0.8 },
    basses: { preset: 'basses', pan: 0.6 },
    horn: { preset: 'horn', pan: -0.3, reverb: 0.7 },
    frame: { preset: 'frame', pan: 0.35, gain: 0.5 },
  },
  build(pass, rng, state = {}) {
    const ev = [];
    const v = variant(pass, rng, state, 4);
    if (v === 2) {
      // III. "Shepherd's Tune": recorder and lute, a dancing 3+3+2 over pizzicato — a lighter road.
      const ch = chart('Am | G | F | E | Am | G | F,G | Am | C | G | Am | Em | F | C | Dm,E | Am', 4);
      ev.push(...arp('lute', ch, { low: 'A2', pattern: [0, null, null, 2, null, null, 1, null], step: 0.5, vel: 0.5, ring: 2 }));
      ev.push(...riff('pizz', ch, 'R..5..8.', { low: 'E2', step: 0.5, vel: 0.4 }));
      ev.push(...mel('recorder', 'A4:e B4:e C5:e. B4:s A4:q E5:q | D5:e C5:e B4:e. A4:s G4:h | F4:e G4:e A4:e. B4:s C5:q A4:q | G#4:h. r:q | A4:e B4:e C5:e. B4:s A4:q E5:q | G5:e F5:e E5:e. D5:s C5:h | A4:q. B4:e C5:t D5:t C5:t B4:q | A4:h. r:q', { vel: 0.55 }));
      ev.push(...mel('recorder', 'E5:q. D5:e C5:q E5:q | D5:q. C5:e B4:h | C5:e D5:e E5:e. D5:s C5:q A4:q | B4:h. r:q | A4:q. G4:e F4:q A4:q | G4:q. F4:e E4:h | F4:e G4:e A4:e. B4:s C5:q B4:q | A4:h. r:q', { at: 32, vel: 0.52 }));
      ev.push(...drums('frame', 'X..x..x.X..x..x.', { bars: 16, step: 0.25, vel: 0.35, skipBars: [0, 1] }));
    } else if (v === 3) {
      // IV. "The Open Moonsea": strings in unison, a broad tune; the horns answer in the second half.
      const ca = chart('Am | F | C | G | Am | F | Dm | E', 4);
      const cb = chart('F | C | G | Am | F | C | Dm,E | Am', 4, 32);
      const all = [...ca, ...cb];
      ev.push(...pad('strings', all, { low: 'A3', count: 3, vel: 0.28, cadence: true }));
      ev.push(...pad('basses', all, { low: 'E2', count: 1, vel: 0.34 }));
      ev.push(...arp('harp', all, { low: 'A2', pattern: [0, 2, 4, 2], step: 1, vel: 0.38, ring: 2 }));
      ev.push(...mel('violins', 'E5:w | F5:h. E5:q | E5:h D5:h | D5:w | C5:h. D5:q | E5:h A5:h | F5:h. E5:q | E5:w', { vel: 0.5 }));
      ev.push(...mel('celli', 'A3:w | A3:h. C4:q | G3:h E3:h | G3:w | A3:h. B3:q | C4:h F3:h | A3:h. B3:q | G#3:w', { vel: 0.4 }));
      ev.push(...mel('horn', 'A3:h. C4:q | E4:h G4:h | D4:h. E4:q | C4:w | A3:h. C4:q | E4:h G4:h | F4:q E4:q D4:q E4:q | A3:w', { at: 32, vel: 0.55 }));
      ev.push(...mel('violins', 'C5:w | G5:h. E5:q | D5:h E5:h | C5:w | C5:h. D5:q | E5:h G5:h | F5:h E5:h | E5:w', { at: 32, vel: 0.42 }));
    } else {
      const ca = chart('Am | G | Am,G | Am | Am | C | D | Am', 4);
      const cb = chart('C | G | Am | Em | F | C | D | E', 4, 32);
      const all = [...ca, ...cb];
      ev.push(...pad('strings', all, { low: 'A3', count: 3, vel: 0.3, cadence: true }));
      ev.push(...counter('celli', all, { low: 'E3', vel: 0.26, scale: [0, 2, 3, 5, 7, 9, 10], key: 9 }));
      ev.push(...pad('basses', all, { low: 'E2', count: 1, vel: 0.35 }));
      ev.push(...arp('harp', all, { low: 'A2', pattern: [0, 2, 3, 4, 5, 4, 3, 2], step: 0.5, vel: 0.42 }));
      ev.push(...mel('flute', 'A4:q. B4:e C5:q E5:q | D5:h B4:h | C5:q. B4:e A4:q G4:q | A4:w | E5:q. D5:e C5:q D5:q | E5:h G5:h | F#5:q E5:q D5:q B4:q | A4:w', { vel: 0.58 }));
      const bLead = v === 1 ? 'horn' : 'violins';
      ev.push(...mel(bLead, 'E5:h. C5:q | D5:h B4:h | C5:q E5:q A5:q G5:q | E5:w | F5:h. E5:q | E5:q D5:q C5:h | D5:q E5:q F#5:q A5:q | G#5:w', { at: 32, vel: 0.55, transpose: bLead === 'horn' ? -12 : 0 }));
      ev.push(...drums('frame', 'X.....x.X.......', { bars: 16, step: 0.25, vel: 0.4, skipBars: [0, 1, 2, 3] }));
    }
    return { lengthQ: 64, events: ev, tailQ: 4, rit: [[60, 64, 0.85]], section: `v${v}` };
  },
};

export const camp = {
  id: 'camp',
  bpm: 80,
  barQ: 3,
  loop: true,
  gain: 1.06,
  key: 5,
  room: 'hall',
  wet: 0.38,
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
