import { chart, mel, pad, arp } from '../compose.js';

/** One-shot cues: fanfares and stings (loop: false). */
export const victory = {
  id: 'victory',
  bpm: 100,
  barQ: 4,
  loop: false,
  gain: 0.65,
  instruments: {
    brass: { preset: 'brass', pan: 0.1 },
    horn: { preset: 'horn', pan: -0.2 },
    lowbrass: { preset: 'lowbrass' },
    strings: { preset: 'strings', pan: 0.2 },
    violins: { preset: 'violins', pan: -0.3 },
    basses: { preset: 'basses' },
    harp: { preset: 'harp', pan: -0.45 },
    choir: { preset: 'choir' },
    timpani: { preset: 'timpani' },
    crash: { preset: 'crash', pan: 0.3 },
    glock: { preset: 'glock', pan: 0.4 },
  },
  build() {
    const ev = [];
    const ch = chart('D | G,A | D | D', 4);
    ev.push(...mel('brass', 'A3:t! A3:t A3:t D4:q! A4:q. F#4:e | G4:e. A4:s B4:e. G4:s A4:h | D5:w! | r:w', { vel: 0.85 }));
    ev.push(...mel('horn', 'F#3:t F#3:t F#3:t A3:q F#4:q. D4:e | D4:e. E4:s G4:e. E4:s E4:h | A4:w | r:w', { vel: 0.7 }));
    ev.push(...pad('lowbrass', ch.slice(0, 3), { low: 'D2', count: 2, vel: 0.6 }));
    ev.push(...pad('strings', ch, { low: 'F#3', count: 3, vel: 0.5 }));
    ev.push(...pad('basses', ch, { low: 'D2', count: 1, vel: 0.55 }));
    ev.push({ inst: 'violins', t: 8, midi: [86, 90], dur: 7, vel: 0.6 });
    ev.push(...pad('choir', chart('D | D', 4, 8), { low: 'F#3', count: 4, vel: 0.6 }));
    ev.push(...arp('harp', chart('D', 2, 6), { low: 'D4', pattern: [0, 1, 2, 3, 4, 5, 6, 7], step: 0.25, vel: 0.5 }));
    ev.push({ inst: 'timpani', t: 0, midi: 38, dur: 1, vel: 0.9 });
    ev.push({ inst: 'timpani', t: 1, midi: 33, dur: 1, vel: 0.7 });
    ev.push({ inst: 'timpani', t: 6, midi: 33, dur: 2, vel: 0.5, roll: [0.3, 0.9] });
    ev.push({ inst: 'timpani', t: 8, midi: 38, dur: 1, vel: 1 });
    ev.push({ inst: 'crash', t: 8, dur: 2, vel: 0.85 });
    ev.push({ inst: 'glock', t: 8, midi: 86, dur: 2, vel: 0.55 });
    ev.push({ inst: 'glock', t: 8.5, midi: 90, dur: 2, vel: 0.45 });
    ev.push({ inst: 'glock', t: 9, midi: 93, dur: 2, vel: 0.45 });
    return { lengthQ: 13, events: ev, tailQ: 3 };
  },
};

export const defeat = {
  id: 'defeat',
  bpm: 58,
  barQ: 4,
  loop: false,
  gain: 0.65,
  instruments: {
    strings: { preset: 'strings', pan: 0.15 },
    celli: { preset: 'celli', pan: 0.3 },
    basses: { preset: 'basses' },
    choir: { preset: 'choirOo' },
    bell: { preset: 'churchBell', pan: -0.2 },
    boom: { preset: 'boom' },
    lowbrass: { preset: 'lowbrass' },
    flute: { preset: 'flute', pan: 0.3 },
  },
  build() {
    const ev = [];
    const ch = chart('Dm | A | Gm,A | Dm', 4);
    ev.push({ inst: 'boom', t: 0, dur: 2, vel: 0.9 });
    ev.push({ inst: 'bell', t: 0, midi: 50, dur: 4, vel: 0.6 });
    ev.push({ inst: 'bell', t: 8, midi: 50, dur: 4, vel: 0.45 });
    ev.push(...mel('strings', 'A4:h G4:q F4:q | E4:h D4:h | Bb3:h A3:h | D4:w', { vel: 0.5 }));
    ev.push(...mel('flute', 'r:w | r:w | D5:h C#5:h | D5:w', { vel: 0.35 }));
    ev.push(...pad('choir', ch, { low: 'D3', count: 3, vel: 0.45 }));
    ev.push(...pad('celli', ch, { low: 'D2', count: 2, vel: 0.4 }));
    ev.push(...pad('basses', ch, { low: 'D1', count: 1, vel: 0.45 }));
    ev.push({ inst: 'lowbrass', t: 0, midi: [38, 45], dur: 4, vel: 0.45 });
    return { lengthQ: 16, events: ev, tailQ: 4 };
  },
};

export const levelup = {
  id: 'levelup',
  bpm: 120,
  barQ: 4,
  loop: false,
  gain: 0.9,
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
  gain: 0.85,
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
  gain: 1,
  instruments: {
    boom: { preset: 'boom' },
    taiko: { preset: 'taiko' },
    lowbrass: { preset: 'lowbrass' },
    brass: { preset: 'brass' },
    violins: { preset: 'violins' },
    celli: { preset: 'celli' },
    sus: { preset: 'sus' },
  },
  build() {
    const ev = [];
    ev.push({ inst: 'boom', t: 0, dur: 2, vel: 1 });
    ev.push({ inst: 'taiko', t: 0, dur: 1, vel: 1 });
    ev.push({ inst: 'taiko', t: 0.75, dur: 1, vel: 0.7 });
    ev.push({ inst: 'taiko', t: 1.5, dur: 1, vel: 0.9 });
    ev.push({ inst: 'lowbrass', t: 0, midi: [38, 39, 45], dur: 2.5, vel: 0.8 });
    ev.push({ inst: 'brass', t: 0, midi: [62, 63, 69], dur: 1.5, vel: 0.75 });
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
  gain: 0.85,
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
  gain: 0.9,
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
