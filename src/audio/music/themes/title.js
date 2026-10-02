import { chart, mel, pad, arp, riff, drums, shift, soften, counter } from '../compose.js';

/**
 * "The Pool of Radiance" — main title. D minor, heroic horn theme. Its
 * signature: the D–A–A fifth answered by a dotted leap to the octave
 * (D4 q. A4 e A4 q. D5 e) — the motif every other cue quotes (combat
 * compresses it, the development augments it, the fanfare turns it major,
 * camp and defeat echo it). The arc climbs phrase by phrase (D5, E5, the
 * bridge's E5, the climax's F5), lifting to F/Bb in the bridge, full
 * orchestra + choir at the climax. Later passes re-voice the A section gently
 * (flute + harp) so the loop never grows tiring.
 */
// Bar 2 answers with a dotted snap and a drop of a fourth; bar 3 flows up in eighths (one dotted cell per phrase, not three).
const A1 = 'D4:q. A4:e A4:q. D5:e | D5:e. C5:s Bb4:e A4:e Bb4:q F4:q | G4:e A4:e Bb4:e D5:e C5:q. Bb4:e | A4:h. r:q';
const A2 = 'D4:q. A4:e A4:q. E5:e | D5:e. C5:s Bb4:e A4:e G4:q D4:q | F4:e G4:e A4:e C5:e Bb4:q. A4:e | A4:h E4:h';
// The bridge breaks the dotted cell: a syncopated lift, a triplet turn, a long run into the climax.
const B = 'F4:e G4:e A4:q~e C5:e Bb4:e A4:e | G4:h A4:t Bb4:t C5:t D5:q | E5:q. D5:e C5:q Bb4:e C5:e | E5:h E5:t F5:t E5:t D5:e C5:e';
// Descant over A2 (violins): long arching notes against the horn tune, a suspension at the cadence.
const DESC = 'A5:h. G5:e F5:e | Bb5:h~e A5:e G5:e F5:e | F5:q. E5:e D5:q F5:q | E5:w';
// Horn counterline under the climax (contrary motion to the trumpets).
const CC = 'F4:h E4:q D4:q | C4:h F4:q E4:q | D4:q. E4:e E4:q C#4:q | D4:w';
const C = 'D5:q. A4:e A4:q. F5:e | E5:e D5:e C5:e Bb4:e A4:h | Bb4:q. C5:e D5:q E5:q | D5:w';
const OUT = 'A4:h. G4:e F4:e | F4:h D4:h | G4:h. F4:e E4:e | E4:w';

export const TITLE_MOTIF = { A1, A2, B, C };

export default {
  id: 'title',
  bpm: 76,
  barQ: 4,
  loop: true,
  gain: 0.81,
  key: 2,
  room: 'hall',
  wet: 0.55,
  instruments: {
    horn: { preset: 'horn', pan: -0.3 },
    brass: { preset: 'brass', pan: 0.3 },
    lowbrass: { preset: 'lowbrass', pan: 0.45 },
    violins: { preset: 'violins', pan: -0.6 },
    strings: { preset: 'strings', pan: -0.05 },
    celli: { preset: 'celli', pan: 0.45 },
    celli2: { preset: 'celli', pan: 0.35, gain: 0.8 },
    basses: { preset: 'basses', pan: 0.65 },
    harp: { preset: 'harp', pan: -0.65 },
    flute: { preset: 'flute', pan: 0.25 },
    oboe: { preset: 'oboe', pan: 0.15, reverb: 0.5 },
    clarinet: { preset: 'clarinet', pan: 0.3, reverb: 0.5 },
    choir: { preset: 'choir', pan: 0 },
    timpani: { preset: 'timpani', pan: 0.05 },
    taiko: { preset: 'taiko', pan: -0.1 },
    snare: { preset: 'snare', pan: 0.25 },
    crash: { preset: 'crash', pan: 0.3 },
    sus: { preset: 'sus', pan: -0.3 },
    glock: { preset: 'glock', pan: 0.4 },
  },
  build(pass) {
    const ev = [];
    const first = pass === 0;
    let t = 0;
    // ---- Intro (4 bars): first pass only — a gathering storm.
    if (first) {
      const ci = chart('Dm | Dm | C | A', 4);
      ev.push({ inst: 'timpani', t: 0, midi: 38, dur: 4, vel: 0.7, roll: [0.15, 0.8] });
      ev.push({ inst: 'timpani', t: 4, midi: 38, dur: 1, vel: 0.95 });
      ev.push(...pad('basses', ci, { low: 'D2', count: 1, vel: 0.55 }));
      ev.push(...pad('lowbrass', ci, { low: 'D2', count: 2, vel: 0.45 }));
      ev.push(...pad('celli', ci, { low: 'D3', count: 2, vel: 0.4, opts: { art: 'trem' } }));
      ev.push(...mel('horn', 'r:w | D4:q. A3:e D4:q F4:q | E4:q. C4:e E4:q G4:q | A4:w', { vel: 0.72 }));
      ev.push(...mel('brass', 'r:w | r:w | r:w | [A3,C#4,E4]:w', { vel: 0.55 }));
      ev.push(...drums('taiko', 'X...............|X.......X.......|X...x...X...x...|X.x.X.x.X.xxXXXX', { bars: 4, vel: 0.75 }));
      ev.push({ inst: 'snare', t: 12, dur: 4, vel: 0.6, roll: [0.1, 0.75] });
      ev.push({ inst: 'sus', t: 12.4, dur: 4, vel: 0.7 });
      t = 16;
    }
    // ---- A section (8 bars).
    const ca = chart('Dm | Bb | C | Dm | Dm | Gm | Bb | A', 4, t);
    const soft = !first && pass % 2 === 1;
    ev.push(...pad('basses', ca, { low: 'D2', count: 1, vel: 0.38 }));
    ev.push(...pad('strings', ca, { low: 'A3', count: 3, vel: soft ? 0.3 : 0.34, cadence: true }));
    ev.push(...counter('celli', ca, { low: 'D3', vel: 0.32, key: 2 }));
    ev.push(...arp('harp', ca, { low: 'D3', pattern: [0, 1, 2, 3, 4, 3, 2, 1], step: 0.5, vel: soft ? 0.55 : 0.45 }));
    if (soft) {
      // The quiet pass: the oboe sings the theme, the flute takes the answer.
      ev.push(...mel('oboe', A1, { at: t, vel: 0.6 }));
      ev.push(...mel('flute', A2, { at: t + 16, vel: 0.66 }));
      ev.push(...soften(mel('violins', A2, { at: t + 16, transpose: -12 }), 0.6));
    } else {
      ev.push(...mel('horn', A1, { at: t, vel: 0.72 }));
      ev.push(...mel('horn', A2, { at: t + 16, vel: 0.78 }));
      ev.push(...mel('violins', DESC, { at: t + 16, vel: 0.5 }));
      ev.push(...ca.filter((c) => c.bar % 2 === 0).map((c) => ({ inst: 'timpani', t: c.t, midi: c.ch.root === 2 ? 38 : 33, dur: 1, vel: 0.55 })));
      ev.push(...drums('taiko', 'X...............|X.......o.......', { bars: 8, at: t, vel: 0.4 }));
    }
    t += 32;
    // ---- B section (4 bars): the lift.
    const cb = chart('F | Gm | F,Bb | C', 4, t);
    ev.push(...pad('basses', cb, { low: 'D2', count: 1, vel: 0.55 }));
    ev.push(...pad('strings', cb, { low: 'A3', count: 3, vel: 0.5, opts: { art: 'swell' }, cadence: true }));
    ev.push(...pad('choir', cb, { low: 'A3', count: 3, vel: 0.45, cadence: true }));
    ev.push(...arp('harp', cb, { low: 'F3', pattern: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1], step: 0.25, vel: 0.42 }));
    ev.push(...mel('violins', B, { at: t, vel: 0.62 }));
    ev.push(...mel(soft ? 'horn' : 'flute', B, { at: t, vel: 0.58, transpose: soft ? -12 : 0 }));
    ev.push(...drums('taiko', 'X.......x.......', { bars: 3, at: t, vel: 0.45 }));
    ev.push({ inst: 'timpani', t: t + 12, midi: 36, dur: 4, vel: 0.6, roll: [0.2, 0.9] });
    ev.push({ inst: 'sus', t: t + 12.2, dur: 4, vel: 0.65 });
    t += 16;
    // ---- C: climax (4 bars), everyone.
    const cc = chart('Dm | C,F | Gm,A | Dm', 4, t);
    ev.push({ inst: 'crash', t, dur: 2, vel: 0.85 });
    ev.push({ inst: 'timpani', t, midi: 38, dur: 1, vel: 1 });
    ev.push(...pad('basses', cc, { low: 'D2', count: 1, vel: 0.7 }));
    ev.push(...pad('lowbrass', cc, { low: 'D2', count: 2, vel: 0.6 }));
    ev.push(...pad('strings', cc, { low: 'D4', count: 4, vel: 0.6, cadence: true }));
    ev.push(...counter('celli2', cc, { low: 'D3', vel: 0.55, key: 2 }));
    ev.push(...pad('choir', cc, { low: 'D4', count: 3, vel: 0.65, cadence: true }));
    ev.push(...mel('brass', C, { at: t, vel: 0.85 }));
    ev.push(...mel('horn', CC, { at: t, vel: 0.78 }));
    ev.push(...mel('violins', C, { at: t, vel: 0.7, transpose: 12 }));
    ev.push(...riff('celli', cc, 'R.RRR.RR', { low: 'D2', step: 0.5, vel: 0.55, opts: { art: 'spic' } }));
    ev.push(...drums('taiko', 'X..x..X.X..x..x.|X..x..X.X..x.xXX|X..x..X.X..x..x.|X...............', { bars: 4, at: t, vel: 0.75 }));
    ev.push(...drums('timpani', '................|................|........x.x.xxXX|X...............', { bars: 4, at: t, vel: 0.7, midi: 33 }));
    ev.push({ inst: 'glock', t: t + 12, midi: 86, dur: 2, vel: 0.5 });
    ev.push({ inst: 'crash', t: t + 12, dur: 2, vel: 0.7 });
    t += 16;
    // ---- Outro / breath before the loop (4 bars).
    const co = chart('Dm | Bb | Gm | A', 4, t);
    ev.push(...pad('strings', co, { low: 'A3', count: 3, vel: 0.3, cadence: true }));
    ev.push(...pad('basses', co, { low: 'D2', count: 1, vel: 0.35 }));
    ev.push(...arp('harp', co, { low: 'D3', pattern: [0, 2, 4, 2], step: 1, vel: 0.5, ring: 2 }));
    ev.push(...mel(pass % 2 ? 'clarinet' : 'flute', OUT, { at: t, vel: 0.5, transpose: pass % 2 ? -12 : 0 }));
    t += 16;
    // Breathe: broaden into the climax and into the loop point.
    const tb = t - 32;
    return { lengthQ: t, events: ev, tailQ: 4, rit: [[tb - 4, tb, 0.88], [t - 4, t, 0.8]] };
  },
};

export const intro = {
  id: 'intro',
  bpm: 62,
  barQ: 4,
  loop: true,
  gain: 0.88,
  key: 2,
  room: 'hall',
  wet: 0.6,
  instruments: {
    harp: { preset: 'harp', pan: -0.4 },
    flute: { preset: 'flute', pan: 0.25 },
    oboe: { preset: 'oboe', pan: 0.2, reverb: 0.55 },
    clarinet: { preset: 'clarinet', pan: 0.3, reverb: 0.55 },
    horn: { preset: 'horn', pan: -0.1, reverb: 0.6 },
    strings: { preset: 'strings', pan: 0.15 },
    celli: { preset: 'celli', pan: 0.3 },
    basses: { preset: 'basses' },
    choir: { preset: 'choirOo' },
    harmonics: { preset: 'harmonics', pan: 0.5 },
  },
  build(pass) {
    const ev = [];
    const ca = chart('Dm | Bb | C | Dm | Dm | Gm | Bb | A', 4);
    ev.push(...pad('strings', ca, { low: 'A3', count: 3, vel: 0.3 }));
    ev.push(...pad('basses', ca, { low: 'D2', count: 1, vel: 0.35 }));
    ev.push(...arp('harp', ca, { low: 'D3', pattern: [0, 2, 4, 5, 4, 2], step: 2 / 3, vel: 0.45, ring: 2 }));
    const lead = ['oboe', 'horn', 'flute'][pass % 3];
    ev.push(...mel(lead, A1, { vel: 0.5, transpose: lead === 'horn' ? -12 : 0 }));
    ev.push(...mel(lead === 'oboe' ? 'clarinet' : 'flute', A2, { at: 16, vel: 0.55, transpose: lead === 'oboe' ? -12 : 0 }));
    const cb = chart('F | Gm | F,Bb | C | Dm | C,F | Gm,A | Dm', 4, 32);
    ev.push(...pad('choir', cb, { low: 'A3', count: 3, vel: 0.35 }));
    ev.push(...pad('celli', cb, { low: 'D3', count: 2, vel: 0.3 }));
    ev.push(...pad('basses', cb, { low: 'D2', count: 1, vel: 0.35 }));
    ev.push(...arp('harp', cb, { low: 'F3', pattern: [0, 1, 2, 3, 2, 1], step: 2 / 3, vel: 0.4, ring: 2 }));
    ev.push(...mel('horn', B, { at: 32, vel: 0.5, transpose: -12 }));
    ev.push(...shift(mel('strings', C, { vel: 0.45 }), 48));
    ev.push(...[50, 54, 58, 62].map((tt, i) => ({ inst: 'harmonics', t: tt, midi: [86, 81, 84, 81][i], dur: 2, vel: 0.35 })));
    return { lengthQ: 64, events: ev, tailQ: 4 };
  },
};
