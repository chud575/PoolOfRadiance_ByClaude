import { chart, mel, pad, arp } from '../compose.js';

/** One-shot cues: fanfares and stings (loop: false). */
export const victory = {
  id: 'victory',
  bpm: 100,
  barQ: 4,
  loop: false,
  gain: 0.81,
  key: 2,
  instruments: {
    brass: { preset: 'brass', pan: 0.3 },
    horn: { preset: 'horn', pan: -0.3 },
    lowbrass: { preset: 'lowbrass', pan: 0.45 },
    strings: { preset: 'strings', pan: 0.05 },
    violins: { preset: 'violins', pan: -0.6 },
    celli: { preset: 'celli', pan: 0.45 },
    basses: { preset: 'basses', pan: 0.65 },
    harp: { preset: 'harp', pan: -0.65 },
    choir: { preset: 'choir' },
    timpani: { preset: 'timpani', pan: 0.15 },
    crash: { preset: 'crash', pan: 0.5 },
    glock: { preset: 'glock', pan: 0.45 },
  },
  build() {
    const ev = [];
    // The title's motif turned major (D–A–A and the leap to the octave), a
    // second phrase that climbs to F#, then a held D major chord under a
    // fermata: everyone sustains, the release is written (long, staggered)
    // and the hall rings on after it — no hard stop.
    const ch = chart('D | A | D,Bm | G,A | D | D', 4);
    const rel = { release: 2.4 };
    ev.push(...mel('brass', 'D4:q.! A4:e A4:q. D5:e | C#5:e. B4:s A4:e. B4:s C#5:q E5:q | D5:h. A4:e D5:e | F#5:h E5:q. D5:e | D5:w~w', { vel: 0.85, opts: rel }));
    ev.push(...mel('horn', 'A3:q. F#4:e F#4:q. A4:e | A4:e. G4:s E4:e. G4:s A4:q C#5:q | A4:h. F#4:e A4:e | B4:h C#5:q. A4:e | A4:w~w', { vel: 0.7, opts: rel }));
    ev.push(...pad('lowbrass', ch, { low: 'D2', count: 2, vel: 0.58, opts: rel }));
    ev.push(...pad('strings', ch, { low: 'F#3', count: 3, vel: 0.5, cadence: true, opts: rel }));
    ev.push(...pad('basses', ch, { low: 'D2', count: 1, vel: 0.55, opts: { release: 2.8 } }));
    ev.push(...mel('celli', 'D3:h A3:h | A2:h E3:h | D3:h B2:h | G2:h A2:h | D3:w~w', { vel: 0.5, opts: rel }));
    ev.push(...mel('violins', 'r:w | r:w | F#5:h. A5:e B5:e | D6:h C#6:q. A5:e | A5:w~w', { vel: 0.55, opts: { release: 3 } }));
    ev.push(...pad('choir', chart('D,Bm | G,A | D | D', 4, 8), { low: 'F#3', count: 4, vel: 0.58, opts: { release: 3 } }));
    ev.push(...arp('harp', chart('D', 2, 6), { low: 'D4', pattern: [0, 1, 2, 3, 4, 5, 6, 7], step: 0.25, vel: 0.5 }));
    ev.push(...arp('harp', chart('D', 4, 16), { low: 'D3', pattern: [0, 1, 2, 3, 4, 5, 6, 7, null, null, null, null, null, null, null, null], step: 0.25, vel: 0.45, ring: 6 }));
    ev.push({ inst: 'timpani', t: 0, midi: 38, dur: 1, vel: 0.9 });
    ev.push({ inst: 'timpani', t: 1, midi: 33, dur: 1, vel: 0.7 });
    ev.push({ inst: 'timpani', t: 6, midi: 33, dur: 2, vel: 0.5, roll: [0.3, 0.9] });
    ev.push({ inst: 'timpani', t: 8, midi: 38, dur: 1, vel: 0.9 });
    ev.push({ inst: 'timpani', t: 14, midi: 33, dur: 2, vel: 0.45, roll: [0.2, 0.85] });
    ev.push({ inst: 'timpani', t: 16, midi: 38, dur: 6, vel: 0.75, roll: [0.7, 0.15] });
    ev.push({ inst: 'crash', t: 8, dur: 2, vel: 0.7 });
    ev.push({ inst: 'crash', t: 16, dur: 3, vel: 0.85 });
    ev.push({ inst: 'glock', t: 16, midi: 86, dur: 3, vel: 0.5 });
    ev.push({ inst: 'glock', t: 16.5, midi: 90, dur: 3, vel: 0.42 });
    ev.push({ inst: 'glock', t: 17, midi: 93, dur: 3, vel: 0.4 });
    // Broaden into the fermata.
    return { lengthQ: 24, events: ev, tailQ: 8, rit: [[12, 16, 0.78]] };
  },
};

export const defeat = {
  id: 'defeat',
  bpm: 58,
  barQ: 4,
  loop: false,
  gain: 0.81,
  key: 2,
  room: 'cathedral',
  wet: 0.6,
  instruments: {
    strings: { preset: 'strings', pan: -0.2 },
    celli: { preset: 'celli', pan: 0.45 },
    basses: { preset: 'basses', pan: 0.6 },
    choir: { preset: 'choirOo' },
    bell: { preset: 'churchBell', pan: -0.4 },
    boom: { preset: 'boom', eq: [{ type: 'highpass', f: 75, q: 0.7 }] },
    lowbrass: { preset: 'lowbrass', eq: [{ type: 'highpass', f: 70, q: 0.7 }] },
    flute: { preset: 'flute', pan: 0.3 },
    oboe: { preset: 'oboe', pan: 0.25, reverb: 0.6 },
  },
  build() {
    const ev = [];
    // The motif again, broken: D–A–A in mourning, sinking to the tonic; the
    // oboe tries the octave leap once more and falls back. Six bars.
    const ch = chart('Dm | F/C | Gm,A | Dm | Bb | Gm,A', 4);
    ev.push({ inst: 'boom', t: 0, dur: 2, vel: 0.75 });
    ev.push({ inst: 'bell', t: 0, midi: 50, dur: 4, vel: 0.6 });
    ev.push({ inst: 'bell', t: 8, midi: 50, dur: 4, vel: 0.45 });
    ev.push({ inst: 'bell', t: 20, midi: 50, dur: 4, vel: 0.32 });
    ev.push(...mel('strings', 'D4:h. A4:q | A4:h G4:q F4:q | Bb3:h A3:h | D4:w | D4:h. F4:q | E4:h C#4:h', { vel: 0.5 }));
    ev.push(...mel('flute', 'r:w | r:w | D5:h C#5:h | D5:w', { vel: 0.35 }));
    ev.push(...mel('oboe', 'r:w | r:w | r:w | r:h A4:q. D5:e | D5:h C5:q Bb4:q | A4:h. G4:e E4:e', { vel: 0.42 }));
    ev.push(...pad('choir', ch, { low: 'D3', count: 3, vel: 0.45 }));
    ev.push(...pad('celli', ch, { low: 'D2', count: 2, vel: 0.4 }));
    ev.push(...pad('basses', ch, { low: 'D2', count: 1, vel: 0.42 }));
    ev.push({ inst: 'lowbrass', t: 0, midi: [38, 45], dur: 4, vel: 0.45 });
    // Final tonic, a picardy-less open fifth that just fades.
    ev.push({ inst: 'strings', t: 24, midi: [50, 57], dur: 6, vel: 0.35, opts: { release: 2 } });
    ev.push({ inst: 'basses', t: 24, midi: 38, dur: 6, vel: 0.35 });
    return { lengthQ: 30, events: ev, tailQ: 4, rit: [[20, 26, 0.8]] };
  },
};

export const levelup = {
  id: 'levelup',
  bpm: 120,
  barQ: 4,
  loop: false,
  gain: 1.12,
  instruments: {
    brass: { preset: 'brass', pan: 0.1 },
    harp: { preset: 'harp', pan: -0.4 },
    glock: { preset: 'glock', pan: 0.4 },
    strings: { preset: 'strings' },
    timpani: { preset: 'timpani' },
  },
  build() {
    const ev = [];
    ev.push(...arp('harp', chart('D', 1), { low: 'D3', pattern: [0, 1, 2, 3, 4, 5, 6, 7], step: 0.125, vel: 0.5 }));
    ev.push(...mel('brass', 'r:q D4:e F#4:e A4:e D5:q. | [F#4,A4,D5]:w', { vel: 0.8 }));
    ev.push({ inst: 'strings', t: 1, midi: [62, 66, 69, 74], dur: 5, vel: 0.5 });
    ev.push({ inst: 'timpani', t: 3, midi: 38, dur: 1, vel: 0.8 });
    ev.push(...[3, 3.25, 3.5].map((t, i) => ({ inst: 'glock', t, midi: [86, 90, 93][i], dur: 2, vel: 0.5 })));
    return { lengthQ: 8, events: ev, tailQ: 2 };
  },
};

export const discovery = {
  id: 'discovery',
  bpm: 90,
  barQ: 4,
  loop: false,
  gain: 1.06,
  instruments: {
    harp: { preset: 'harp', pan: -0.3 },
    celesta: { preset: 'celesta', pan: 0.4 },
    choir: { preset: 'choir' },
    strings: { preset: 'strings' },
  },
  build() {
    const ev = [];
    // F lydian shimmer: the "you found something" sting.
    ev.push(...mel('harp', 'F4:s A4:s C5:s E5:s G5:s B5:s C6:h.', { vel: 0.5 }));
    ev.push(...mel('celesta', 'r:e C6:e E6:e G6:e B6:h', { vel: 0.45 }));
    ev.push({ inst: 'choir', t: 0.5, midi: [65, 69, 72, 76], dur: 3, vel: 0.45 });
    ev.push({ inst: 'strings', t: 0.25, midi: [53, 60, 71], dur: 3.5, vel: 0.35, opts: { art: 'swell' } });
    return { lengthQ: 4, events: ev, tailQ: 3 };
  },
};

export const danger = {
  id: 'danger',
  bpm: 120,
  barQ: 4,
  loop: false,
  gain: 1.25,
  instruments: {
    boom: { preset: 'boom', eq: [{ type: 'highpass', f: 52, q: 0.7 }] },
    taiko: { preset: 'taiko', pan: -0.35 },
    taiko2: { preset: 'taiko', pan: 0.4, gain: 0.8 },
    lowbrass: { preset: 'lowbrass', pan: 0.4 },
    brass: { preset: 'brass', pan: 0.25 },
    horn: { preset: 'horn', pan: -0.35 },
    violins: { preset: 'violins', pan: -0.6 },
    celli: { preset: 'celli', pan: 0.5 },
    sus: { preset: 'sus', pan: -0.5 },
  },
  build() {
    const ev = [];
    ev.push({ inst: 'boom', t: 0, dur: 2, vel: 1 });
    ev.push({ inst: 'taiko', t: 0, dur: 1, vel: 1 });
    ev.push({ inst: 'taiko2', t: 0.75, dur: 1, vel: 0.7 });
    ev.push({ inst: 'taiko', t: 1.5, dur: 1, vel: 0.9 });
    ev.push({ inst: 'taiko2', t: 1.75, dur: 1, vel: 0.6 });
    ev.push({ inst: 'lowbrass', t: 0, midi: [38, 39, 45], dur: 2.5, vel: 0.8, opts: { art: 'fall' } });
    ev.push({ inst: 'brass', t: 0, midi: [62, 63, 69], dur: 1.5, vel: 0.8, opts: { art: 'rip' } });
    ev.push({ inst: 'horn', t: 0.02, midi: [57, 62], dur: 2, vel: 0.8, opts: { art: 'flutter' } });
    ev.push({ inst: 'celli', t: 0, midi: [50, 51], dur: 3, vel: 0.5, opts: { art: 'trem', tremRate: 15 } });
    ev.push({ inst: 'violins', t: 0.5, midi: [86, 87], dur: 2.5, vel: 0.4, opts: { art: 'trem', tremRate: 15 } });
    return { lengthQ: 4, events: ev, tailQ: 2 };
  },
};

export const quest = {
  id: 'quest',
  bpm: 96,
  barQ: 4,
  loop: false,
  gain: 1.06,
  instruments: {
    harp: { preset: 'harp', pan: -0.3 },
    handbell: { preset: 'handbell', pan: 0.3 },
    horn: { preset: 'horn' },
    strings: { preset: 'strings' },
  },
  build() {
    const ev = [];
    ev.push(...mel('horn', 'D4:e A4:e D5:h.', { vel: 0.6 }));
    ev.push(...mel('handbell', 'r:e r:e D5:q F#5:q A5:q', { vel: 0.5 }));
    ev.push(...arp('harp', chart('D', 4), { low: 'D3', pattern: [0, 2, 4, 6, 7, 6, 4, 2], step: 0.25, vel: 0.4 }));
    ev.push({ inst: 'strings', t: 0, midi: [50, 57, 62, 66], dur: 4, vel: 0.4 });
    return { lengthQ: 4, events: ev, tailQ: 3 };
  },
};

export const fallen = {
  id: 'fallen',
  bpm: 60,
  barQ: 4,
  loop: false,
  gain: 1.12,
  instruments: {
    choir: { preset: 'choirOo' },
    bell: { preset: 'churchBell' },
    celli: { preset: 'celli' },
  },
  build() {
    return {
      lengthQ: 4,
      tailQ: 3,
      events: [
        { inst: 'bell', t: 0, midi: 45, dur: 3, vel: 0.5 },
        { inst: 'choir', t: 0, midi: [50, 53, 57], dur: 2, vel: 0.4 },
        { inst: 'choir', t: 2, midi: [49, 52, 57], dur: 2, vel: 0.35 },
        { inst: 'celli', t: 0, midi: [38], dur: 4, vel: 0.4 },
      ],
    };
  },
};
