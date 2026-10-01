import { Plucked } from './plucked.js';
import { Drums } from './drums.js';
import { Strings, Choir, Wind, Drone, Bell } from './sustained.js';

/**
 * Named instrument presets used by the composed themes.
 * Each entry: [Class, options]. Options merge with per-song overrides.
 */
export const PRESETS = {
  lute: [Plucked, { preset: 'lute', gain: 0.9, reverb: 0.22 }],
  harp: [Plucked, { preset: 'harp', gain: 0.8, reverb: 0.4 }],
  dulcimer: [Plucked, { preset: 'dulcimer', gain: 0.55, reverb: 0.3 }],
  pizz: [Plucked, { preset: 'pizz', gain: 0.9, reverb: 0.3 }],
  bass: [Plucked, { preset: 'bass', gain: 1, reverb: 0.12 }],
  harmonics: [Plucked, { preset: 'harmonic', gain: 0.5, reverb: 0.7 }],
  strings: [Strings, { voices: 6, bright: 0.5, spread: 0.35, gain: 0.9, reverb: 0.35 }],
  violins: [Strings, { voices: 7, bright: 0.62, spread: 0.3, gain: 0.75, reverb: 0.38 }],
  celli: [Strings, { voices: 5, bright: 0.38, spread: 0.22, gain: 0.85, reverb: 0.3 }],
  basses: [Strings, { voices: 4, bright: 0.28, spread: 0.15, gain: 0.8, reverb: 0.22 }],
  fiddle: [Strings, { voices: 1, bright: 0.75, gain: 0.8, reverb: 0.2 }],
  choir: [Choir, { vowel: 'ah', voices: 8, gain: 0.9, reverb: 0.55 }],
  choirOo: [Choir, { vowel: 'oo', voices: 6, gain: 0.85, reverb: 0.6 }],
  choirOh: [Choir, { vowel: 'oh', voices: 6, gain: 1, reverb: 0.55 }],
  choirMm: [Choir, { vowel: 'mm', voices: 4, gain: 0.7, reverb: 0.5, breath: 0.02 }],
  flute: [Wind, { preset: 'flute', gain: 0.7, reverb: 0.4 }],
  recorder: [Wind, { preset: 'recorder', gain: 0.6, reverb: 0.28 }],
  horn: [Wind, { preset: 'horn', gain: 0.75, reverb: 0.45 }],
  brass: [Wind, { preset: 'brass', gain: 0.7, reverb: 0.4 }],
  lowbrass: [Wind, { preset: 'lowbrass', gain: 0.7, reverb: 0.35 }],
  bassoon: [Wind, { preset: 'bassoon', gain: 0.6, reverb: 0.3 }],
  shawm: [Wind, { preset: 'shawm', gain: 0.45, reverb: 0.25 }],
  gurdy: [Drone, { wave: 'reed', gain: 0.55, reverb: 0.2 }],
  organ: [Drone, { wave: 'organ', chorus: 1, gain: 0.6, reverb: 0.6 }],
  drone: [Drone, { wave: 'bowed', gain: 0.6, reverb: 0.5 }],
  taiko: [Drums, { kind: 'taiko', gain: 0.6, reverb: 0.3 }],
  timpani: [Drums, { kind: 'timpani', gain: 0.55, reverb: 0.35 }],
  tom: [Drums, { kind: 'tom', gain: 0.55, reverb: 0.25 }],
  frame: [Drums, { kind: 'frame', gain: 0.7, reverb: 0.18 }],
  snare: [Drums, { kind: 'snare', gain: 0.6, reverb: 0.25 }],
  tamb: [Drums, { kind: 'tamb', gain: 0.4, reverb: 0.2 }],
  crash: [Drums, { kind: 'crash', gain: 0.35, reverb: 0.4 }],
  sus: [Drums, { kind: 'sus', gain: 0.35, reverb: 0.5 }],
  hat: [Drums, { kind: 'hat', gain: 0.15, reverb: 0.15 }],
  chime: [Drums, { kind: 'chime', gain: 0.2, reverb: 0.6 }],
  boom: [Drums, { kind: 'bigboom', gain: 0.6, reverb: 0.5 }],
  rim: [Drums, { kind: 'rim', gain: 0.25, reverb: 0.2 }],
  churchBell: [Bell, { preset: 'church', gain: 0.4, reverb: 0.7 }],
  handbell: [Bell, { preset: 'hand', gain: 0.55, reverb: 0.5 }],
  glock: [Bell, { preset: 'glock', gain: 0.45, reverb: 0.5 }],
  celesta: [Bell, { preset: 'celesta', gain: 0.5, reverb: 0.5 }],
};

/**
 * @param {BaseAudioContext} ac
 * @param {string|{preset:string}} spec preset name, or {preset, ...overrides}
 * @param {AudioNode} dest
 * @param {AudioNode} [send]
 */
export function createInstrument(ac, spec, dest, send, seed = 1) {
  const s = typeof spec === 'string' ? { preset: spec } : spec;
  const entry = PRESETS[s.preset];
  if (!entry) throw new Error(`unknown instrument "${s.preset}"`);
  const [Cls, base] = entry;
  const { preset, ...over } = s;
  void preset;
  return new Cls(ac, { ...base, ...over, dest, send, seed });
}
