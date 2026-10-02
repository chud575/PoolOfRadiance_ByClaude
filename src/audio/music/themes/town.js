import { chart, mel, pad, arp, riff, drums, soften } from '../compose.js';

/**
 * "New Phlan" — the civilized town. A market band on the square: recorder,
 * fiddle and shawm over fingerpicked lute, hurdy-gurdy drone, bodhrán and
 * tambourine. Passes alternate between
 *   set   — a full jig set in AABB form: "The Moonsea Jig" (G mixolydian,
 *           strains A and B) then "Sokol's Fancy" (E dorian, strains C and D),
 *           every strain played twice, the repeat ornamented (triplet cuts,
 *           passing notes) and re-orchestrated — 64 bars, ~72 s;
 *   air   — "The Lament for Old Phlan", a slow air at half pace (32 bars of
 *           3/4 written in half-note beats, ~72 s): solo flute or fiddle over
 *           harp-like lute arpeggios and a soft drone.
 * Lead instruments and countermelodies rotate on every cycle, so the hub city
 * repeats itself only after several minutes; a rest window (ambience only)
 * follows every few minutes. The tavern plays the same book faster and
 * rowdier in a dry taproom (fiddle lead, dulcimer, slapped bodhrán) and its
 * own air is a lilting drinking song.
 */
// ---- Tune 1: The Moonsea Jig (G mixolydian), A and B strains + ornamented repeats.
const TA = 'G4:q B4:e D5:q B4:e | C5:q A4:e F4:q A4:e | G4:q B4:e D5:e. C5:s B4:e | A4:q. r:q D4:e | G4:q B4:e D5:q G5:e | F5:q D5:e C5:q A4:e | B4:e C5:e D5:e A4:q F#4:e | G4:q. r:q.';
const TA_ = 'G4:e A4:e B4:e D5:q B4:e | C5:e B4:e A4:e F4:q A4:e | G4:q B4:e D5:t E5:t D5:t B4:e | A4:q. A4:e B4:e C5:e | D5:q B4:e G5:q. | F5:e E5:e D5:e C5:q A4:e | B4:e C5:e D5:e A4:q F#4:e | G4:q. r:q.';
const TB = 'E5:q D5:e C5:q B4:e | A4:q B4:e C5:q. | D5:q C5:e B4:q A4:e | G4:q A4:e B4:q. | C5:q B4:e A4:q G4:e | F4:q G4:e A4:q. | B4:e A4:e G4:e F#4:q A4:e | G4:q. r:q.';
const TB_ = 'E5:q D5:e C5:e D5:e B4:e | A4:q B4:e C5:q. | D5:e E5:e D5:e B4:q A4:e | G4:q A4:e B4:q. | C5:e D5:e C5:e A4:q G4:e | F4:q G4:e A4:e B4:e C5:e | B4:e A4:e G4:e F#4:q A4:e | G4:q. G4:q.';
// Countermelodies (a real second part in thirds/sixths and contrary motion).
const CA = 'B3:q. D4:q. | A3:q. C4:q. | B3:q. G4:q. | F#4:q. r:q. | B3:q. D4:q. | A3:q. F4:q. | G4:q. D4:q. | B3:q. r:q.';
const CB = 'G4:q. E4:q. | E4:q. E4:q. | B4:q. G4:q. | E4:q. G4:q. | E4:q. C4:q. | A3:q. C4:q. | D4:q. C4:q. | B3:q. r:q.';
// ---- Tune 2: Sokol's Fancy (E dorian), C and D strains.
const TC = 'E5:e B4:e B4:e E5:e B4:e A4:e | G4:e A4:e B4:e D5:e B4:e A4:e | E5:e B4:e B4:e E5:e F#5:e G5:e | F#5:e D5:e B4:e A4:e F#4:e D4:e | E4:e G4:e B4:e E5:e B4:e G4:e | D5:e A4:e F#4:e D4:e F#4:e A4:e | B4:e G4:e E4:e D5:e B4:e A4:e | B4:q. E4:q.';
const TC_ = 'E5:e B4:e B4:e E5:t F#5:t E5:t A4:e | G4:e A4:e B4:e D5:e B4:e A4:e | E5:e B4:e B4:e E5:e F#5:e G5:e | A5:e F#5:e D5:e A4:e F#4:e D4:e | E4:e G4:e B4:e E5:e B4:e G4:e | D5:e A4:e F#4:e D4:t E4:t F#4:t A4:e | B4:e G4:e E4:e D5:e B4:e A4:e | B4:q. E4:q.';
const TD = 'G5:q E5:e F#5:q D5:e | E5:e F#5:e G5:e A5:q F#5:e | G5:q E5:e D5:q B4:e | A4:e B4:e A4:e F#4:q D4:e | E4:e F#4:e G4:e A4:e B4:e C#5:e | D5:q. A4:e F#4:e D4:e | E4:e G4:e B4:e A4:e F#4:e D4:e | E4:q. r:q.';
const TD_ = 'G5:q E5:e F#5:e E5:e D5:e | E5:e F#5:e G5:e A5:q F#5:e | G5:q E5:e D5:e C#5:e B4:e | A4:e B4:e A4:e F#4:q D4:e | E4:e F#4:e G4:e A4:e B4:e C#5:e | D5:q. A4:e F#4:e D4:e | E4:e G4:e B4:e A4:e F#4:e D4:e | E4:q. E4:q.';
const CC = 'G3:q. B3:q. | D4:q. B3:q. | G3:q. B3:q. | A3:q. F#3:q. | G3:q. E3:q. | F#3:q. A3:q. | G3:q. F#3:q. | E3:q. r:q.';
const CD = 'B3:q. A3:q. | G3:q. F#3:q. | E3:q. G3:q. | F#3:q. A3:q. | G3:q. A3:q. | F#3:q. D4:q. | B3:q. A3:q. | G3:q. r:q.';
// ---- The slow air (bar = 6 quarters: three half-note beats).
const AIR = [
  'D4:h G4:h A4:h | B4:w. | A4:h G4:h E4:h | D4:w. | D4:h G4:h B4:h | D5:w C5:h | B4:h A4:h G4:h | A4:w.',
  'B4:h C5:h D5:h | E5:w D5:h | C5:h B4:h A4:h | B4:w. | G4:h A4:h B4:h | D5:w B4:h | A4:h G4:h E4:h | G4:w.',
  'E5:w F#5:h | G5:w F#5:h | E5:h D5:h B4:h | D5:w. | C5:h B4:h A4:h | B4:h G4:h E4:h | F#4:h G4:h A4:h | D4:w.',
  'D4:h G4:h A4:h | B4:w. | A4:h G4:h E4:h | D4:w. | E4:h G4:h B4:h | D5:w B4:h | A4:h. B4:e A4:e G4:h | G4:w.',
];
const AIR_CH = ['G | Em | C | D | G | G | C,D | D', 'G | C | Am | Em | Em | D | C,D | G', 'Em | C | G | D | Am | Em | D | D', 'G | Em | C | D | Em | G | D | G'];
// A second voice for the air's return (a sixth below, moving against the tune).
const AIR_ALTO = 'B3:w. | G3:h B3:h D4:h | C4:w. | A3:h B3:h C4:h | B3:w. | G3:h A3:h B3:h | E4:w D4:h | D4:w.';

const BAR = 3;

/** One strain (8 bars) with its accompaniment, starting at quarter `at`. */
function strain(ev, at, { tune, counter, chords, lead, cm, tavern, repeat, strainIdx }) {
  const ch = chart(chords, BAR, at);
  ev.push(...mel(lead, tune, { at, vel: repeat ? 0.7 : 0.66 }));
  if (cm && counter) ev.push(...soften(mel(cm, counter, { at, transpose: cm === 'dulcimer' ? 12 : 0 }), 0.72));
  // Lute fingerpicking: bass on 1 and 4, chord tones between.
  ev.push(...arp('lute', ch, { low: 'G3', pattern: strainIdx % 2 ? [0, 2, 1, 3, 1, 2] : [0, 2, 1, 3, 2, 1], step: 0.5, vel: 0.5, accent: 0.12, ring: 1.5 }));
  ev.push(...riff('bass', ch, strainIdx % 2 ? 'R..5.8' : 'R..5..', { low: 'D2', step: 0.5, vel: 0.62 }));
  // Second time through: a lute strums the chords (down, down, up-pickup).
  if (repeat || tavern) {
    for (const p of pad('strum', ch, { low: 'G3', count: 5, vel: tavern ? 0.55 : 0.42 })) {
      for (const [dt, v, up] of [[0, 1, false], [1.5, 0.85, false], [2.5, 0.55, true]]) {
        if (dt >= p.dur - 0.06) continue;
        const notes = up ? p.midi.slice().reverse().slice(0, 3) : p.midi;
        ev.push({ ...p, t: p.t + dt, midi: notes, dur: up ? 0.4 : 0.9, vel: p.vel * v, opts: { strum: up ? 0.012 : 0.02 } });
      }
    }
  }
  // Bodhrán: a different groove per strain, rolls into the repeats.
  const grooves = tavern ? ['X.xX.x|X.xXxx', 'X.xX.x|XxxX.x'] : ['X..x.x|X..x.o', 'X.xx.x|X..x.x'];
  ev.push(...drums('frame', grooves[strainIdx % 2], { bars: 8, barQ: BAR, at, step: 0.5, vel: tavern ? 0.7 : 0.6 }));
  if (repeat || tavern) ev.push(...drums('tamb', tavern ? '..x..x' : '...x..', { bars: 8, barQ: BAR, at, step: 0.5, vel: 0.55 }));
  if (tavern) ev.push(...drums('slap', '.x..x.', { bars: 8, barQ: BAR, at, step: 0.5, vel: 0.4 }));
  // Drone: G for tune 1, E for tune 2.
  const root = strainIdx < 2 ? 43 : 40;
  ev.push({ inst: 'gurdy', t: at, midi: root, dur: 24, vel: 0.4, opts: { fifth: 0.5, buzz: (tavern ? 184 : 160) / 60 / 1.5, buzzLevel: tavern ? 1 : repeat ? 0.8 : 0.55 } });
}

/**
 * A band, not a sequencer: the accompaniment (lute picking and strums, bass,
 * bodhrán, tambourine) gets the jig's lilt — in each dotted-quarter beat the
 * first eighth leans long, the second comes late and light — plus per-hit
 * timing scatter (±8–15 ms) and velocity jitter, and every strain its own
 * accent shape (lean into bar 4, breathe, drive into bar 8). Slurred melody
 * lines keep their written jig rhythm (they already swing in q–e).
 */
function humanise(ev, from, rng, { tavern, at, strainIdx }) {
  const q = 60 / (tavern ? 184 : 160);
  const lilt = [0, 0.055, 0.025];
  const shape = (bar) => [0.9, 0.95, 1, 1.06, 0.92, 0.98, 1.04, 1.1][bar] ?? 1;
  const tilt = [1, 0.96, 1.03, 0.98][strainIdx % 4];
  for (let i = from; i < ev.length; i++) {
    const e = ev[i];
    if (e.slur || e.roll) continue;
    const rel = e.t - at;
    const pos = ((rel % 1.5) + 1.5) % 1.5;
    const k = Math.round(pos / 0.5);
    if (Math.abs(pos - k * 0.5) < 0.02) e.t += lilt[k % 3];
    // Scatter: σ ≈ 7 ms, clamped to ±15 ms.
    e.t = Math.max(0, e.t + Math.max(-0.015, Math.min(0.015, rng.gauss(0.007))) / q);
    const bar = Math.floor(rel / BAR);
    const v = e.vel ?? 0.6;
    e.vel = Math.max(0.05, Math.min(1, v * shape(bar) * tilt * (1 + rng.range(-0.1, 0.1)) * (k % 3 === 1 ? 0.9 : 1)));
  }
}

function jigSet(ev, cycle, tavern, rng) {
  const leads = tavern ? ['fiddle', 'recorder'] : ['recorder', 'fiddle', 'shawm'];
  const lead1 = leads[cycle % leads.length];
  const lead2 = leads[(cycle + 1) % leads.length];
  const cms = tavern ? ['dulcimer', 'recorder2'] : ['recorder2', 'dulcimer', 'fiddle2'];
  const cm = cms[cycle % cms.length];
  const plan = [
    [TA, null, 'G | F | G | D | G | F | G,D | G', lead1, null, 0],
    [TA_, CA, 'G | F | G | D | G | F | G,D | G', lead2, cm, 0],
    [TB, null, 'C | Am | G | Em | C | F | D | G', lead1, null, 1],
    [TB_, CB, 'C | Am | G | Em | C | F | D | G', lead2, cm, 1],
    [TC, null, 'Em | G | Em | D | Em | D | Em,D | Em', lead2, null, 2],
    [TC_, CC, 'Em | G | Em | D | Em | D | Em,D | Em', lead1, cm === 'dulcimer' ? 'dulcimer' : 'fiddle2', 2],
    [TD, null, 'Em | Em,D | Em,G | D | Em,A | D | Em,D | Em', lead1, null, 3],
    [TD_, CD, 'Em | Em,D | Em,G | D | Em,A | D | Em,D | Em', lead2, cm === 'dulcimer' ? 'dulcimer' : 'fiddle2', 3],
  ];
  plan.forEach(([tune, counter, chords, lead, c, si], i) => {
    const from = ev.length;
    strain(ev, i * 24, { tune, counter, chords, lead, cm: tavern && !c ? 'dulcimer' : c, tavern, repeat: i % 2 === 1, strainIdx: si });
    humanise(ev, from, rng, { tavern, at: i * 24, strainIdx: si });
  });
  return 8 * 24;
}

function slowAir(ev, cycle, tavern) {
  const lead = tavern ? (cycle % 2 ? 'recorder' : 'fiddle') : ['flute', 'fiddle', 'recorder'][cycle % 3];
  const L = 6;
  AIR.forEach((phrase, k) => {
    const at = k * 8 * L;
    const ch = chart(AIR_CH[k], L, at);
    ev.push(...mel(k === 2 && !tavern ? 'fiddle' : lead, phrase, { at, vel: k === 2 ? 0.62 : 0.56 }));
    // Harp-like lute: a slow rolling arpeggio, low bass on each bar.
    ev.push(...arp('lute', ch, { low: 'G3', pattern: [0, 1, 2, 3, 2, 1], step: 1, vel: 0.42, accent: 0.1, ring: 2.5 }));
    ev.push(...riff('bass', ch, 'R.....', { low: 'D2', step: 1, vel: 0.5, gate: 2 }));
    if (k === 3) ev.push(...soften(mel(tavern ? 'dulcimer' : 'recorder2', AIR_ALTO, { at, transpose: tavern ? 12 : 0 }), 0.7));
    if (k >= 2) ev.push(...drums('frame', 'X.....|......', { bars: 8, barQ: L, at, step: 0.5, vel: 0.4 }));
    ev.push({ inst: 'gurdy', t: at, midi: k === 2 ? 40 : 43, dur: 8 * L, vel: 0.3, opts: { fifth: 0.4 } });
    if (tavern) ev.push(...drums('tamb', '......|...x..', { bars: 8, barQ: L, at, step: 0.5, vel: 0.35 }));
  });
  return 4 * 8 * L;
}

function build(pass, rng, { tavern }) {
  const ev = [];
  const cycle = Math.floor(pass / 2);
  const lengthQ = pass % 2 === 0 ? jigSet(ev, cycle, tavern, rng) : slowAir(ev, cycle, tavern);
  return { lengthQ, events: ev, tailQ: 3, section: pass % 2 === 0 ? 'set' : 'air', rit: pass % 2 ? [[lengthQ - 6, lengthQ, 0.75]] : [] };
}

// A real market band, spread across the square.
const instruments = {
  recorder: { preset: 'recorder', pan: 0.15 },
  recorder2: { preset: 'recorder', pan: -0.5, gain: 0.45 },
  flute: { preset: 'flute', pan: 0.2 },
  fiddle: { preset: 'fiddle', pan: 0.3 },
  fiddle2: { preset: 'fiddle', pan: -0.45, gain: 0.55 },
  shawm: { preset: 'shawm', pan: 0.1 },
  dulcimer: { preset: 'dulcimer', pan: -0.6 },
  lute: { preset: 'lute', pan: -0.4 },
  strum: { preset: 'lute', pan: 0.6, gain: 0.7 },
  bass: { preset: 'bass', pan: 0.1 },
  gurdy: { preset: 'gurdy', pan: 0.65, gain: 0.45 },
  frame: { preset: 'frame', pan: 0.25 },
  slap: { preset: 'frame', kind: 'frameSlap', pan: -0.3, gain: 0.5 },
  tamb: { preset: 'tamb', pan: 0.75 },
};

// A jig: dotted quarter ≈ 107 in town, ≈ 123 in the tavern (bpm counts quarters; a 6/8 bar = 3 quarters).
export default { id: 'town', bpm: 160, barQ: 3, loop: true, gain: 1.06, key: 7, room: 'street', wet: 0.4, rest: { after: [200, 280], length: [30, 60] }, instruments, build: (p, rng) => build(p, rng, { tavern: false }) };
export const tavern = { id: 'tavern', bpm: 184, barQ: 3, loop: true, gain: 0.94, key: 7, room: 'tavern', wet: 0.55, instruments, build: (p, rng) => build(p, rng, { tavern: true }) };
