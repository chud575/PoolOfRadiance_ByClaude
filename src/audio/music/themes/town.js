import { chart, mel, pad, arp, riff, drums, soften } from '../compose.js';

/**
 * "New Phlan" — civilized town. G mixolydian jig in 6/8 (bar = 3 quarters):
 * recorder over fingerpicked lute, hurdy-gurdy drone, bodhrán and tambourine.
 * The tavern variant is the same tune, faster and rowdier (fiddle lead,
 * dulcimer countermelody, heavier drum).
 */
const TA = 'G4:q B4:e D5:q B4:e | C5:q A4:e F4:q A4:e | G4:q B4:e D5:e. C5:s B4:e | A4:q. r:q D4:e | G4:q B4:e D5:q G5:e | F5:q D5:e C5:q A4:e | B4:e C5:e D5:e A4:q F#4:e | G4:q. r:q.';
const TB = 'E5:q D5:e C5:q B4:e | A4:q B4:e C5:q. | D5:q C5:e B4:q A4:e | G4:q A4:e B4:q. | C5:q B4:e A4:q G4:e | F4:q G4:e A4:q. | B4:e A4:e G4:e F#4:q A4:e | G4:q. r:q.';
// Countermelody (thirds/sixths below, simplified) for later passes.
const TA2 = 'B3:q. D4:q. | A3:q. C4:q. | B3:q. G4:q. | F#4:q. r:q. | B3:q. D4:q. | A3:q. F4:q. | G4:q. D4:q. | B3:q. r:q.';
const TB2 = 'G4:q. E4:q. | E4:q. E4:q. | B4:q. G4:q. | E4:q. G4:q. | E4:q. C4:q. | A3:q. C4:q. | D4:q. C4:q. | B3:q. r:q.';

function build(pass, { tavern }) {
  const ev = [];
  const ca = chart('G | F | G | D | G | F | G,D | G', 3);
  const cb = chart('C | Am | G | Em | C | F | D | G', 3, 24);
  const all = [...ca, ...cb];
  const lead = tavern ? (pass % 2 ? 'recorder' : 'fiddle') : ['recorder', 'fiddle', 'shawm'][pass % 3];
  ev.push(...mel(lead, TA, { vel: 0.68 }));
  ev.push(...mel(lead, TB, { at: 24, vel: 0.66 }));
  if (pass > 0 || tavern) {
    const cm = tavern ? 'dulcimer' : pass % 2 ? 'dulcimer' : 'recorder2';
    ev.push(...soften(mel(cm, TA2, { at: 0, transpose: cm === 'dulcimer' ? 12 : 0 }), 0.75));
    ev.push(...soften(mel(cm, TB2, { at: 24, transpose: cm === 'dulcimer' ? 12 : 0 }), 0.75));
  }
  // Lute fingerpicking: bass on 1 and 4, chord tones between.
  ev.push(...arp('lute', all, { low: 'G3', pattern: [0, 2, 1, 3, 2, 1], step: 0.5, vel: 0.5, accent: 0.12, ring: 1.5 }));
  ev.push(...riff('bass', all, 'R..5..', { low: 'D2', step: 0.5, vel: 0.62 }));
  // Hurdy-gurdy drone on G/D for the A strain, C/G for B.
  ev.push({ inst: 'gurdy', t: 0, midi: [43, 50], dur: 24, vel: 0.4, opts: { fifth: 0 } });
  ev.push({ inst: 'gurdy', t: 24, midi: [43, 48], dur: 24, vel: 0.4, opts: { fifth: 0 } });
  // Percussion.
  const fp = tavern ? 'X.xX.x|X.xXxx' : 'X..x.x|X..x.o';
  ev.push(...drums('frame', fp, { bars: 16, barQ: 3, step: 0.5, vel: tavern ? 0.7 : 0.6 }));
  ev.push(...drums('tamb', tavern ? '..x..x' : '...x..', { bars: 16, barQ: 3, step: 0.5, vel: 0.55, skipBars: tavern ? [] : [0, 1, 2, 3] }));
  if (tavern) ev.push(...drums('slap', '.x..x.', { bars: 16, barQ: 3, step: 0.5, vel: 0.4 }));
  return { lengthQ: 48, events: ev, tailQ: 2 };
}

const instruments = {
  recorder: { preset: 'recorder', pan: 0.15 },
  recorder2: { preset: 'recorder', pan: -0.3, gain: 0.45 },
  fiddle: { preset: 'fiddle', pan: 0.1 },
  shawm: { preset: 'shawm', pan: 0.1 },
  dulcimer: { preset: 'dulcimer', pan: -0.35 },
  lute: { preset: 'lute', pan: -0.2 },
  bass: { preset: 'bass', pan: 0.05 },
  gurdy: { preset: 'gurdy', pan: 0.3, gain: 0.4 },
  frame: { preset: 'frame', pan: 0.1 },
  slap: { preset: 'frame', kind: 'frameSlap', pan: -0.15, gain: 0.5 },
  tamb: { preset: 'tamb', pan: 0.45 },
};

export default { id: 'town', bpm: 104, barQ: 3, loop: true, gain: 0.85, instruments, build: (p) => build(p, { tavern: false }) };
export const tavern = { id: 'tavern', bpm: 122, barQ: 3, loop: true, gain: 0.75, instruments, build: (p) => build(p, { tavern: true }) };
