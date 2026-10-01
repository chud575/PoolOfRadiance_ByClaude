import { chart, mel, pad, riff, drums } from '../compose.js';

/**
 * Battle! D minor, 138 bpm, 3-3-2 accents. Adaptive layers:
 *   L0 (always)  taiko ostinato, spiccato celli 16ths, bass, low brass roots
 *   L1 (≥ .35)   horn theme (the title's D–A–A motif, compressed), brass stabs, toms/snare
 *   L2 (≥ .7)    choir, high violins, crashes, timpani — desperate / boss fights
 */
const MA = 'D4:q. A4:e A4:q G4:e F4:e | E4:q. F4:e D4:h | D4:q. Bb4:e Bb4:q A4:e G4:e | G4:q. A4:e E4:h | D5:q. A4:e A4:q Bb4:e C5:e | D5:q. C5:e A4:h | G4:e A4:e Bb4:e C5:e A4:q G4:e E4:e | A4:w';
const MB = 'G5:h. F5:e E5:e | D5:h Bb4:h | A4:q. D5:e F5:q A5:q | A5:h. G5:e F5:e | F5:q. E5:e D5:q F5:q | E5:q. D5:e C5:q E5:q | C#5:q. D5:e E5:q A5:q | A5:w';

function stabs(inst, ch, { low = 'D3', times = [0, 1.5, 3], vel = 0.75, layer }) {
  return pad(inst, ch, { low, count: 3, vel, layer }).flatMap((p) =>
    times.filter((x) => x < (p.dur - 0.05)).map((x) => ({ ...p, t: p.t + x, dur: 0.38 })),
  );
}

export default {
  id: 'combat',
  bpm: 138,
  barQ: 4,
  loop: true,
  gain: 0.69,
  intensity: 0.55,
  instruments: {
    taiko: { preset: 'taiko', pan: -0.05 },
    taiko2: { preset: 'taiko', pan: 0.35, gain: 0.6 },
    tom: { preset: 'tom', pan: -0.3 },
    snare: { preset: 'snare', pan: 0.2 },
    celli: { preset: 'celli', pan: 0.25, reverb: 0.2 },
    violins: { preset: 'violins', pan: -0.3 },
    violins2: { preset: 'violins', pan: 0.3, gain: 0.6 },
    basses: { preset: 'basses', pan: 0.1 },
    lowbrass: { preset: 'lowbrass', pan: 0 },
    brass: { preset: 'brass', pan: 0.15 },
    horn: { preset: 'horn', pan: -0.15 },
    choir: { preset: 'choir', pan: 0 },
    crash: { preset: 'crash', pan: 0.35 },
    timpani: { preset: 'timpani', pan: 0.05 },
  },
  build(pass) {
    const ev = [];
    const ca = chart('Dm | Dm | Bb | C | Dm | F | Gm | A', 4);
    const cb = chart('Gm | Gm | Dm | Dm | Bb | C | A | A', 4, 32);
    const all = [...ca, ...cb];
    // L0: the engine room.
    ev.push(...riff('celli', all, 'RRRRRRRRRRRRRRRR', { low: 'D2', step: 0.25, vel: 0.5, accents: '>..>..>.>..>..>.', opts: { art: 'spic' }, gate: 0.6 }));
    ev.push(...riff('basses', all, 'R..R..R.R..R..R.', { low: 'D1', step: 0.25, vel: 0.45, opts: { art: 'spic' } }));
    ev.push(...pad('lowbrass', all, { low: 'D2', count: 2, vel: 0.45 }));
    ev.push(...drums('taiko', 'X..x..X.X..x..x.|X..x..X.X..x.xx.', { bars: 16, vel: 0.72 }));
    ev.push(...drums('taiko2', '..x.....x...x...', { bars: 16, vel: 0.5, midi: 48 }));
    // L1: the fight.
    ev.push(...mel('horn', MA, { vel: 0.78, layer: 1 }));
    ev.push(...stabs('brass', ca, { low: 'F3', vel: 0.72, layer: 1 }));
    ev.push(...pad('horn', cb, { low: 'G3', count: 3, vel: 0.55, layer: 1 }));
    ev.push(...drums('tom', '....x.......x.xx|....x.....x.xxxx', { bars: 16, vel: 0.6, layer: 1 }));
    ev.push(...drums('snare', 'x.xxx.x.x.xxx.x.', { bars: 16, vel: 0.35, layer: 1, skipBars: pass ? [] : [0, 1, 2, 3] }));
    ev.push(...riff('violins2', all, 'R5R8R5R3', { low: 'D4', step: 0.5, vel: 0.4, opts: { art: 'spic' }, layer: 1 }));
    // L2: desperate.
    ev.push(...mel('violins', MA, { vel: 0.6, transpose: 12, layer: 2 }));
    ev.push(...mel('violins', MB, { at: 32, vel: 0.7, layer: 2 }));
    ev.push(...mel('brass', MB, { at: 32, vel: 0.7, transpose: -12, layer: 2 }));
    ev.push(...pad('choir', all, { low: 'A3', count: 3, vel: 0.55, layer: 2 }));
    ev.push({ inst: 'crash', t: 0, dur: 2, vel: 0.75, layer: 2 });
    ev.push({ inst: 'crash', t: 32, dur: 2, vel: 0.8, layer: 2 });
    ev.push({ inst: 'timpani', t: 28, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 0.95], layer: 2 });
    ev.push({ inst: 'timpani', t: 60, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 1], layer: 1 });
    return { lengthQ: 64, events: ev };
  },
};

/** Hostile parley / ambush standoff: tremolo strings, heartbeat drums, horn calls. */
export const encounter = {
  id: 'encounter',
  bpm: 92,
  barQ: 4,
  loop: true,
  gain: 0.75,
  instruments: {
    celli: { preset: 'celli', pan: 0.2 },
    violins: { preset: 'violins', pan: -0.25 },
    basses: { preset: 'basses' },
    taiko: { preset: 'taiko', gain: 0.8 },
    horn: { preset: 'horn', pan: -0.4, reverb: 0.7 },
    lowbrass: { preset: 'lowbrass' },
    harmonics: { preset: 'harmonics', pan: 0.4 },
  },
  build() {
    const ev = [];
    const ch = chart('Dm | Dm | Eb | Dm | Dm | Bb | Eb | A', 4);
    ev.push(...pad('celli', ch, { low: 'D3', count: 3, vel: 0.4, opts: { art: 'trem', tremRate: 11 } }));
    ev.push(...pad('basses', ch, { low: 'D2', count: 1, vel: 0.45 }));
    ev.push(...drums('taiko', 'X.......X..x....', { bars: 8, vel: 0.6 }));
    ev.push(...mel('horn', 'r:w | A3:q. D4:e D4:h | r:w | r:w | r:w | A3:q. D4:e F4:q E4:q | Eb4:w | E4:w', { vel: 0.6 }));
    ev.push(...mel('lowbrass', 'r:w | r:w | Eb2:w | r:w | r:w | r:w | Eb2:w | A1:w', { vel: 0.5 }));
    ev.push({ inst: 'violins', t: 24, midi: [81, 82], dur: 8, vel: 0.3, opts: { art: 'swell' } });
    ev.push(...[2, 10, 18, 26].map((t) => ({ inst: 'harmonics', t, midi: 86, dur: 2, vel: 0.3 })));
    return { lengthQ: 32, events: ev };
  },
};
