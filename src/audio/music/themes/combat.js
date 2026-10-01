import { chart, mel, pad, riff, drums, counter, arp } from '../compose.js';

/**
 * Battle! D minor, 138 bpm, 3-3-2 accents. Gold Box fights run for many
 * minutes, so the cue is built from five 16-bar sections chosen pass by pass
 * (seeded, never the same twice running):
 *   A   the theme (horns, the title's D–A–A motif compressed) + violin answer
 *   A2  the theme re-orchestrated: violins + trumpets lead, horns counterline
 *   B   new theme in the relative major, horn call and violin reply
 *   C   breakdown: percussion alone, then a 3-3-2 build back in
 *   D   development in G minor: the title motif in augmentation (low brass,
 *       celli) under driving violin ostinati
 * Adaptive layers in every section:
 *   L0 (always)  taiko ostinato, celli root–fifth–octave figures, basses, low brass
 *   L1 (≥ .35)   melody, brass stabs, toms/snare, violin spiccato
 *   L2 (≥ .7)    choir, high violins, crashes, timpani — desperate / boss fights
 */
const MA = 'D4:q. A4:e A4:q G4:e F4:e | E4:q. F4:e D4:h | D4:q. Bb4:e Bb4:q A4:e G4:e | G4:q. A4:e E4:h | D5:q. A4:e A4:q Bb4:e C5:e | D5:q. C5:e A4:h | G4:e A4:e Bb4:e C5:e A4:q G4:e E4:e | A4:w';
const MB = 'G5:h. F5:e E5:e | D5:h Bb4:h | A4:q. D5:e F5:q A5:q | A5:h. G5:e F5:e | F5:q. E5:e D5:q F5:q | E5:q. D5:e C5:q E5:q | C#5:q. D5:e E5:q A5:q | A5:w';
const MC = 'F4:q. D4:e F4:q G4:q | E4:q. C4:e E4:q G4:q | A4:h. F4:q | D4:h. r:q | G4:q. Bb4:e A4:q G4:q | G4:q. Eb4:e G4:q Bb4:q | A4:w | C#5:h A4:h';
const MC2 = 'D5:e E5:e F5:e G5:e A5:q F5:q | E5:e F5:e G5:e A5:e Bb5:q G5:q | A5:q. G5:e F5:e E5:e D5:q | D5:w | Bb4:e C5:e D5:e Eb5:e F5:q D5:q | Eb5:e F5:e G5:e A5:e Bb5:q G5:q | A5:h. G5:e F5:e | E5:w';
// The title motif in augmentation (G minor, then home in D minor).
const AUG1 = 'G3:h. D4:q | D4:w | C4:q Bb3:q C4:q D4:q | Bb3:w | Eb4:h. D4:q | C4:h F4:h | F#4:w | F#4:h D4:h';
const AUG2 = 'D4:h. A4:q | A4:w | G4:q F4:q G4:q A4:q | F4:w | F4:h. G4:q | E4:h C4:h | C#4:w | E4:h A3:h';

const CA = 'Dm | Dm | Bb | C | Dm | F | Gm | A';
const CB = 'Gm | Gm/Bb | Dm/A | Dm | Bb | C | A | A';

function stabs(inst, ch, { low = 'D3', times = [0, 1.5, 3], vel = 0.75, layer }) {
  return pad(inst, ch, { low, count: 3, vel, layer }).flatMap((p) =>
    times.filter((x) => x < (p.dur - 0.05)).map((x) => ({ ...p, t: p.t + x, dur: 0.38 })),
  );
}

/** The engine room (L0) over a chart: taiko, celli figures, spiccato basses, low brass. */
function engine(ev, all, at, bars, { taiko = 'X..x..X.X..x..x.|X..x..X.X..x.xx.', celli = 'R..5R.8.R..5R.85', brassVel = 0.42 } = {}) {
  ev.push(...riff('celli', all, celli, { low: 'D3', step: 0.25, vel: 0.5, accents: '>..>..>.>..>..>.', opts: { art: 'spic' }, gate: 0.6 }));
  ev.push(...riff('basses', all, 'R..R..R.R..R..R.', { low: 'D2', step: 0.25, vel: 0.42, opts: { art: 'spic' } }));
  ev.push(...pad('lowbrass', all, { low: 'F2', count: 2, vel: brassVel }));
  ev.push(...drums('taiko', taiko, { bars, at, vel: 0.72 }));
  ev.push(...drums('taiko2', '..x.....x...x...', { bars, at, vel: 0.5, midi: 48 }));
}

const SECTIONS = {
  A(ev, at, { first }) {
    const ca = chart(CA, 4, at);
    const cb = chart(CB, 4, at + 32);
    const all = [...ca, ...cb];
    engine(ev, all, at, 16);
    ev.push(...mel('horn', MA, { at, vel: 0.8, layer: 1 }));
    ev.push(...stabs('brass', ca, { low: 'F3', vel: 0.72, layer: 1 }));
    ev.push(...pad('horn2', cb, { low: 'G3', count: 3, vel: 0.55, layer: 1, cadence: true }));
    ev.push(...drums('tom', '....x.......x.xx|....x.....x.xxxx', { bars: 16, at, vel: 0.6, layer: 1 }));
    ev.push(...drums('snare', 'x.xxx.x.x.xxx.x.', { bars: 16, at, vel: 0.35, layer: 1, skipBars: first ? [0, 1, 2, 3] : [] }));
    ev.push(...riff('violins2', all, 'R5R8R5R3', { low: 'D4', step: 0.5, vel: 0.4, opts: { art: 'spic' }, layer: 1 }));
    ev.push(...mel('violins', MA, { at, vel: 0.6, transpose: 12, layer: 2 }));
    ev.push(...mel('violins', MB, { at: at + 32, vel: 0.7, layer: 2 }));
    ev.push(...mel('brass', MB, { at: at + 32, vel: 0.7, transpose: -12, layer: 2 }));
    ev.push(...pad('choir', all, { low: 'A3', count: 3, vel: 0.55, layer: 2, cadence: true }));
    ev.push({ inst: 'crash', t: at, dur: 2, vel: 0.75, layer: 2 });
    ev.push({ inst: 'crash', t: at + 32, dur: 2, vel: 0.8, layer: 2 });
    ev.push({ inst: 'timpani', t: at + 28, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 0.95], layer: 2 });
    ev.push({ inst: 'timpani', t: at + 60, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 1], layer: 1 });
  },
  A2(ev, at) {
    const ca = chart(CA, 4, at);
    const cb = chart('Gm | Eb | Dm/F | Dm | Bb | C | A | A', 4, at + 32);
    const all = [...ca, ...cb];
    engine(ev, all, at, 16, { taiko: 'X.x.X..xX.x.X.x.|X.x.X..xX.x.XXxx', celli: 'R.R5R.R8R.R5R.8.' });
    ev.push(...mel('violins', MA, { at, vel: 0.72, transpose: 12, layer: 1 }));
    ev.push(...mel('brass', MA, { at, vel: 0.62, layer: 1 }));
    ev.push(...counter('horn2', ca, { low: 'A3', vel: 0.5, key: 2, layer: 1 }));
    ev.push(...mel('horn', MB, { at: at + 32, vel: 0.78, transpose: -12, layer: 1 }));
    ev.push(...riff('violins2', cb, 'R8R8R8R8', { low: 'D5', step: 0.25, vel: 0.36, opts: { art: 'spic' }, layer: 1 }));
    ev.push(...drums('snare', '....x.......x.x.', { bars: 16, at, vel: 0.45, layer: 1 }));
    ev.push(...drums('tom', 'x.x.....x.x..x..', { bars: 16, at, vel: 0.5, layer: 1 }));
    ev.push(...mel('violins', MB, { at: at + 32, vel: 0.7, layer: 2 }));
    ev.push(...pad('choir', all, { low: 'D4', count: 3, vel: 0.5, layer: 2, cadence: true }));
    ev.push(...stabs('brass', cb, { low: 'A3', times: [0, 1.5, 3], vel: 0.7, layer: 2 }));
    ev.push({ inst: 'crash', t: at + 32, dur: 2, vel: 0.8, layer: 1 });
    ev.push({ inst: 'timpani', t: at + 60, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 1], layer: 1 });
  },
  B(ev, at) {
    const c1 = chart('Bb | C | Dm | Dm | Gm | Eb | A | A', 4, at);
    const c2 = chart('Bb | C | Dm | Bb | Gm | Eb | A | A', 4, at + 32);
    const all = [...c1, ...c2];
    engine(ev, all, at, 16, { taiko: 'X...X..xX...X.x.|X...X..xX..xX.xx', celli: 'R.5.R.8.R.5.8.5.', brassVel: 0.38 });
    ev.push(...mel('horn', MC, { at, vel: 0.8, layer: 1 }));
    ev.push(...mel('violins', MC2, { at: at + 32, vel: 0.68, layer: 1 }));
    ev.push(...pad('strings', all, { low: 'A3', count: 3, vel: 0.42, layer: 1, cadence: true }));
    ev.push(...drums('snare', 'x..x..x.x..x.xxx', { bars: 16, at, vel: 0.32, layer: 1 }));
    ev.push(...mel('brass', MC, { at: at + 32, vel: 0.66, layer: 2 }));
    ev.push(...mel('violins2', MC, { at, vel: 0.5, transpose: 12, layer: 2 }));
    ev.push(...pad('choir', all, { low: 'A3', count: 3, vel: 0.5, layer: 2, cadence: true }));
    ev.push({ inst: 'crash', t: at, dur: 2, vel: 0.7, layer: 2 });
    ev.push({ inst: 'timpani', t: at + 28, midi: 33, dur: 4, vel: 0.65, roll: [0.25, 0.9], layer: 1 });
    ev.push({ inst: 'timpani', t: at + 60, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 1], layer: 1 });
  },
  C(ev, at) {
    // 8 bars of drums alone over a low pedal, then the build.
    ev.push({ inst: 'basses', t: at, midi: 38, dur: 32, vel: 0.35, opts: { attack: 1.5 } });
    ev.push({ inst: 'celli', t: at, midi: [50, 57], dur: 32, vel: 0.28, opts: { art: 'trem', tremRate: 12 } });
    ev.push(...drums('taiko', 'X..x..x.X.x..x..|X..x..x.X.x.xXX.', { bars: 8, at, vel: 0.8 }));
    ev.push(...drums('taiko2', '..x...x...x..x..|..x...x...xx.x.x', { bars: 8, at, vel: 0.55, midi: 48 }));
    ev.push(...drums('tom', 'x.x...x.....x.x.', { bars: 8, at, vel: 0.5, layer: 1 }));
    ev.push(...drums('rim', 'x..x..x.x..x..x.', { bars: 8, at, vel: 0.45, layer: 1 }));
    const cb = chart('Dm | Dm | Bb | Bb | Gm | Gm | A | A', 4, at + 32);
    engine(ev, cb, at + 32, 8, { taiko: 'X..x..X.X..x..x.|X..x..X.XxxXxXXX' });
    ev.push(...stabs('brass', cb, { low: 'F3', times: [0, 1.5, 3], vel: 0.7, layer: 1 }));
    ev.push({ inst: 'snare', t: at + 48, dur: 16, vel: 0.6, roll: [0.08, 0.85], layer: 1 });
    ev.push(...mel('violins', 'D5:w | Eb5:w | D5:w | F5:w | G5:w | Bb5:w | A5:w | A5:w', { at: at + 32, vel: 0.4, opts: { art: 'trem', tremRate: 14 }, layer: 1, slur: false }));
    ev.push(...mel('horn', 'r:w | r:w | r:w | r:w | D4:q. A4:e A4:h | Bb4:q. A4:e G4:h | A4:w | E4:h A4:h', { at: at + 32, vel: 0.78, layer: 2 }));
    ev.push(...pad('choir', cb, { low: 'A3', count: 3, vel: 0.5, layer: 2 }));
    ev.push({ inst: 'sus', t: at + 60, dur: 4, vel: 0.7, layer: 1 });
  },
  D(ev, at) {
    const c1 = chart('Gm | Gm | Cm | Gm | Eb | F | D | D', 4, at);
    const c2 = chart('Dm | Dm | Gm | Dm | Bb | C | A | A', 4, at + 32);
    const all = [...c1, ...c2];
    ev.push(...riff('celli', all, 'R..5R..8R..5R.85', { low: 'D3', step: 0.25, vel: 0.48, opts: { art: 'spic' }, gate: 0.6 }));
    ev.push(...riff('basses', all, 'R.......R...R...', { low: 'D2', step: 0.25, vel: 0.45, opts: { art: 'spic' } }));
    ev.push(...drums('taiko', 'X.......X..x....|X.......X..x.x..', { bars: 16, at, vel: 0.75 }));
    ev.push(...drums('taiko2', '....x.......x...', { bars: 16, at, vel: 0.5, midi: 48 }));
    ev.push(...mel('lowbrass', AUG1, { at, vel: 0.62, transpose: -12 }));
    ev.push(...mel('lowbrass', AUG2, { at: at + 32, vel: 0.66, transpose: -12 }));
    ev.push(...arp('violins2', all, { low: 'D4', pattern: [0, 1, 2, 3, 2, 1, 2, 1], step: 0.5, vel: 0.4, opts: { art: 'spic' }, layer: 1 }));
    ev.push(...mel('horn', AUG1, { at, vel: 0.7, layer: 1 }));
    ev.push(...mel('horn', AUG2, { at: at + 32, vel: 0.74, layer: 1 }));
    ev.push(...drums('snare', '....x.......x...', { bars: 16, at, vel: 0.4, layer: 1 }));
    ev.push(...mel('violins', AUG2, { at: at + 32, vel: 0.66, transpose: 12, layer: 2 }));
    ev.push(...pad('choir', all, { low: 'G3', count: 3, vel: 0.55, layer: 2, cadence: true }));
    ev.push(...pad('strings', c1, { low: 'D4', count: 3, vel: 0.45, layer: 2, opts: { art: 'trem', tremRate: 12 } }));
    ev.push({ inst: 'timpani', t: at + 24, midi: 38, dur: 8, vel: 0.65, roll: [0.2, 0.95], layer: 1 });
    ev.push({ inst: 'crash', t: at + 32, dur: 2, vel: 0.8, layer: 2 });
    ev.push({ inst: 'timpani', t: at + 60, midi: 33, dur: 4, vel: 0.7, roll: [0.3, 1], layer: 1 });
  },
};

/** Section after `prev`: seeded, never the same twice running; a breakdown is followed by a big theme. */
const NEXT = { A: ['B', 'D', 'C', 'A2'], A2: ['B', 'D', 'C'], B: ['A2', 'C', 'D', 'A'], C: ['A', 'A2', 'D'], D: ['A', 'B', 'C', 'A2'] };

export function combatSection(pass, prev, rng) {
  if (pass === 0) return 'A';
  return rng.pick(NEXT[prev] ?? NEXT.A);
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
    taiko2: { preset: 'taiko', pan: 0.4, gain: 0.6 },
    tom: { preset: 'tom', pan: -0.4 },
    snare: { preset: 'snare', pan: 0.25 },
    rim: { preset: 'rim', pan: 0.45 },
    celli: { preset: 'celli', pan: 0.3, reverb: 0.2 },
    violins: { preset: 'violins', pan: -0.45 },
    violins2: { preset: 'violins', pan: -0.2, gain: 0.6 },
    strings: { preset: 'strings', pan: -0.1 },
    basses: { preset: 'basses', pan: 0.45, eq: [{ type: 'highpass', f: 45, q: 0.6 }] },
    lowbrass: { preset: 'lowbrass', pan: 0.12, eq: [{ type: 'highpass', f: 110, q: 0.6 }] },
    brass: { preset: 'brass', pan: 0.25 },
    horn: { preset: 'horn', pan: -0.25 },
    horn2: { preset: 'horn', pan: 0.35, gain: 0.8 },
    choir: { preset: 'choir', pan: 0 },
    crash: { preset: 'crash', pan: 0.35 },
    sus: { preset: 'sus', pan: -0.3 },
    timpani: { preset: 'timpani', pan: 0.05 },
    boom: { preset: 'boom' },
  },
  build(pass, rng, state = {}) {
    const ev = [];
    const sec = combatSection(pass, state.prev, rng);
    state.prev = sec;
    SECTIONS[sec](ev, 0, { first: pass === 0 });
    return { lengthQ: 64, events: ev, section: sec };
  },
  /** Final hit when the fight is won: the cue ends here and the fanfare begins. */
  coda() {
    return [
      { inst: 'timpani', t: 0, midi: 38, dur: 2, vel: 1 },
      { inst: 'taiko', t: 0, dur: 2, vel: 1 },
      { inst: 'boom', t: 0, dur: 2, vel: 0.8 },
      { inst: 'crash', t: 0, dur: 3, vel: 0.85 },
      { inst: 'lowbrass', t: 0, midi: [50, 57], dur: 1.2, vel: 0.85 },
      { inst: 'brass', t: 0, midi: [62, 69, 74], dur: 1.2, vel: 0.85 },
      { inst: 'basses', t: 0, midi: 38, dur: 1.5, vel: 0.8 },
      { inst: 'celli', t: 0, midi: [50, 57], dur: 1.5, vel: 0.75 },
      { inst: 'violins', t: 0, midi: [74, 81, 86], dur: 1.5, vel: 0.7 },
    ];
  },
};

/**
 * Hostile parley / ambush standoff: tremolo strings, heartbeat drums, horn
 * calls. Three 8-bar variants rotate (seeded) so a long parley never loops
 * audibly: the standoff, the heartbeat (near silence, harmonics and low
 * horns), and the stalking ostinato (pizzicato + flute flutter).
 */
const ENC = {
  standoff(ev) {
    const ch = chart('Dm | Dm | Eb | Dm | Dm | Bb | Eb | A', 4);
    ev.push(...pad('celli', ch, { low: 'D3', count: 3, vel: 0.4, opts: { art: 'trem', tremRate: 11 } }));
    ev.push(...pad('basses', ch, { low: 'D2', count: 1, vel: 0.45 }));
    ev.push(...drums('taiko', 'X.......X..x....', { bars: 8, vel: 0.6 }));
    ev.push(...mel('horn', 'r:w | A3:q. D4:e D4:h | r:w | r:w | r:w | A3:q. D4:e F4:q E4:q | Eb4:w | E4:w', { vel: 0.6 }));
    ev.push(...mel('lowbrass', 'r:w | r:w | Eb2:w | r:w | r:w | r:w | Eb2:w | A1:w', { vel: 0.5, slur: false }));
    ev.push({ inst: 'violins', t: 24, midi: [81, 82], dur: 8, vel: 0.3, opts: { art: 'swell' } });
    ev.push(...[2, 10, 18, 26].map((t) => ({ inst: 'harmonics', t, midi: 86, dur: 2, vel: 0.3 })));
  },
  heartbeat(ev, rng) {
    ev.push({ inst: 'basses', t: 0, midi: 38, dur: 16, vel: 0.35, opts: { attack: 2 } });
    ev.push({ inst: 'basses', t: 16, midi: 39, dur: 16, vel: 0.38, opts: { attack: 2 } });
    ev.push(...drums('taiko', 'X..x............', { bars: 8, vel: 0.55 }));
    ev.push(...mel('horn', 'r:w | r:w | D3:h. A3:q | A3:w | r:w | r:w | Eb3:h. Bb3:q | A3:w', { vel: 0.55 }));
    ev.push({ inst: 'violins', t: 8, midi: [86, 87], dur: 8, vel: 0.22, opts: { art: 'swell' } });
    ev.push({ inst: 'violins', t: 24, midi: [87, 93], dur: 8, vel: 0.26, opts: { art: 'swell' } });
    for (let b = 0; b < 8; b++) if (rng.chance(0.6)) ev.push({ inst: 'harmonics', t: b * 4 + rng.pick([1, 2, 3]), midi: rng.pick([81, 86, 87, 93]), dur: 2, vel: 0.28 });
  },
  stalk(ev) {
    const ch = chart('Dm | Dm | Dm | Eb | Dm | Dm | Bb | A', 4);
    ev.push(...riff('pizz', ch, 'R.5.8.5.', { low: 'D3', step: 0.5, vel: 0.5 }));
    ev.push(...pad('celli', ch, { low: 'D3', count: 2, vel: 0.3, opts: { art: 'trem', tremRate: 9 } }));
    ev.push(...drums('taiko', 'X.......x.......', { bars: 8, vel: 0.5 }));
    ev.push(...drums('rim', '..x...x...x...xx', { bars: 8, vel: 0.35 }));
    ev.push(...mel('flute', 'r:w | r:h D5:q Eb5:q | D5:w | r:w | r:w | r:h A4:q Bb4:q | A4:h G#4:h | A4:w', { vel: 0.45, opts: { vib: 2 } }));
    ev.push(...mel('lowbrass', 'r:w | r:w | r:w | Eb2:w | r:w | r:w | r:w | A1:w', { vel: 0.45, slur: false }));
  },
};

export const encounter = {
  id: 'encounter',
  bpm: 92,
  barQ: 4,
  loop: true,
  gain: 0.75,
  instruments: {
    celli: { preset: 'celli', pan: 0.3 },
    violins: { preset: 'violins', pan: -0.4 },
    basses: { preset: 'basses', pan: 0.4 },
    taiko: { preset: 'taiko', gain: 0.8 },
    horn: { preset: 'horn', pan: -0.4, reverb: 0.7 },
    lowbrass: { preset: 'lowbrass', pan: 0.15 },
    harmonics: { preset: 'harmonics', pan: 0.45 },
    pizz: { preset: 'pizz', pan: -0.3 },
    flute: { preset: 'flute', pan: 0.35, reverb: 0.6 },
    rim: { preset: 'rim', pan: 0.4 },
  },
  build(pass, rng, state = {}) {
    const ev = [];
    const order = ['standoff', 'heartbeat', 'stalk'];
    const v = pass === 0 ? 'standoff' : rng.pick(order.filter((x) => x !== state.prev));
    state.prev = v;
    ENC[v](ev, rng);
    return { lengthQ: 32, events: ev, section: v };
  },
};
