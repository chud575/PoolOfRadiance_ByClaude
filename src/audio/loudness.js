import { CAL } from './loudness.data.js';
import { AudioRng, hashStr } from './core/rng.js';

/**
 * Loudness normalisation. Every cue is measured offline (ITU-R BS.1770
 * K-weighted LUFS, see offline.js `loudness()`) by
 * `node tools/audiorender.mjs --calibrate`, which writes loudness.data.js:
 * the gain that brings each cue to its target below. Music and ambience beds
 * are matched on integrated loudness, one-shot SFX on momentary maximum
 * (400 ms) so footsteps, clicks, blows and fireballs keep a deliberate
 * hierarchy instead of whatever level they happened to be synthesised at.
 * Levels are as heard at the default bus volumes (music .6, sfx .8, amb .6).
 * tests/audio/loudness.test.js fails when a cue is off target or its
 * calibration is stale (the composition or synthesis changed since).
 */

/** Integrated LUFS targets for music cues (adaptive cues measured at their `calIntensity`). */
export const MUSIC_TARGETS = {
  title: -17, intro: -18.5, town: -17, tavern: -17, ruins: -18, dungeon: -18.5, crypt: -18, wilds: -18, camp: -18,
  combat: -16.5, encounter: -17.5, victory: -16, defeat: -19.5,
  levelup: -16, discovery: -17, danger: -16, quest: -17, fallen: -18,
};

/** Integrated LUFS target for ambience beds. */
export const AMB_TARGET = -27;

/** Momentary-max LUFS targets for one-shot SFX, first match wins. */
export const SFX_TARGETS = [
  [/^(hover|focus)$/, -30],
  [/^(click|page|open|close|map)$/, -27],
  [/^(confirm|cancel|error|save)$/, -25],
  [/^turn$/, -29],
  [/^(step_|step$|footstep|walk)/, -26],
  [/^(ready)$/, -27],
  [/^(splash|bump)$/, -23],
  [/^(swing|miss|dodge|pass_through)$/, -21],
  [/^(bow|arrow_in)$/, -20],
  [/^(crit)$/, -15],
  [/^(hit|hit_armor|hit_bone|parry)$/, -17.5],
  [/^(bite|claw|block|shield|arrow_hit)$/, -18.5],
  [/^death$/, -20],
  [/^(spell_fire|spell_lightning)$/, -14.5],
  [/^(spell_cone|spell_turn)$/, -16.5],
  [/^(spell_shock|spell_missile|spell_cloud|spell_holy|spell_curse)$/, -18.5],
  [/^(spell|spell_sleep|spell_mind|spell_heal|heal|spell_ward)$/, -20],
  [/^spell_fizzle$/, -23],
  [/^(vox_dragon|vox_dragon_die)$/, -14],
  [/^(vox_ogre|vox_troll|vox_giant)(_die)?$/, -16.5],
  [/^vox_.*_die$/, -18.5],
  [/^(vox_rat|vox_ghost)$/, -21],
  [/^vox_/, -19.5],
  [/^(door|door_close|door_locked|chest|trap)$/, -21],
  [/^(door_secret|omen)$/, -21],
  [/^(potion|coins|equip)$/, -22.5],
  [/^(sparkle)$/, -25],
  [/^(levelup)$/, -19],
];

export function sfxTarget(name) {
  for (const [re, v] of SFX_TARGETS) if (re.test(name)) return v;
  return -21;
}

const clampGain = (g) => Math.max(0.03, Math.min(16, g));

/** Output gain for a song / stinger (calibrated, else its hand-set `gain`). */
export function musicGain(song) {
  const c = CAL.music?.[song.id];
  return c ? clampGain(c.gain) : song.gain ?? 1;
}

/** Calibration record of a song: {gain, sections?: {name: dB}, curve?: [[x, LUFS]]}. */
export function musicCal(song) {
  return CAL.music?.[song.id] ?? {};
}

/** Linear interpolation in a sorted [[x, y]] table (clamped). */
function interp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1];
    const [x1, y1] = tab[i];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return tab[tab.length - 1][1];
}

/**
 * Desired loudness offset (LU, relative to the calibration intensity) of an
 * adaptive cue at intensity x: flat below `calIntensity` (a skirmish is as
 * loud as an ordinary fight — it is thinner, not quieter), then a smooth
 * swell of `lift` LU up to 1.0.
 */
export function intensityLift(song, x) {
  const c = song.calIntensity ?? 0.5;
  const k = Math.max(0, Math.min(1, (x - c) / (1 - c)));
  return (song.lift ?? 0) * k * k * (3 - 2 * k);
}

/**
 * Gain (dB) that brings an adaptive cue rendered at intensity x to its
 * desired loudness, given the measured raw curve [[x, LUFS]] (no compensation).
 */
export function intensityCompDb(song, curve, x) {
  const c = song.calIntensity ?? 0.5;
  const want = interp(curve, c) + intensityLift(song, x);
  return Math.max(-9, Math.min(10, want - interp(curve, x)));
}

/** Gain multiplier for a named SFX. */
export function sfxGain(name) {
  // Footsteps are calibrated per surface (step_stone, step_wood, …).
  if (name === 'step') name = 'step_cobble';
  const c = CAL.sfx?.[name] ?? (name.startsWith('step_') ? CAL.sfx?.step_cobble : null);
  return c ? clampGain(c.gain) : 1;
}

/** Gain multiplier for an ambience bed (day/night variants share one value per name). */
export function bedGain(bed, night = false) {
  const c = CAL.amb?.[night ? `${bed}_night` : bed] ?? CAL.amb?.[bed];
  return c ? clampGain(c.gain) : 1;
}

/** Content fingerprint of a song: changes whenever its notes, tempo or orchestration change. */
export function songFingerprint(song) {
  const passes = [0, 1, 2, 3].map((p) => song.build(p, new AudioRng(p + 1)));
  const coda = song.coda ? song.coda(new AudioRng(99)) : null;
  return hashStr(JSON.stringify({ bpm: song.bpm, barQ: song.barQ, loop: song.loop, instruments: song.instruments, passes, coda })).toString(36);
}

/**
 * Source files whose synthesis affects each cue family (paths relative to
 * src/audio). Their concatenated text is fingerprinted by the calibrator and
 * the loudness test.
 */
export const SOURCES = {
  music: ['instruments/base.js', 'instruments/sustained.js', 'instruments/plucked.js', 'instruments/drums.js', 'instruments/index.js', 'dsp/synth.js', 'dsp/notesynth.js', 'dsp/spectra.js', 'dsp/impulse.js', 'dsp/bank.js', 'music/Sequencer.js', 'music/compose.js', 'graph.js'],
  sfx: ['sfx/library.js', 'sfx/toolkit.js', 'dsp/synth.js', 'dsp/impulse.js', 'dsp/bank.js', 'graph.js'],
  amb: ['sfx/ambience.js', 'sfx/library.js', 'sfx/toolkit.js', 'dsp/bank.js', 'dsp/impulse.js', 'graph.js'],
};

/** @param {string[]} texts file contents in SOURCES order */
export function sourceFingerprint(texts) {
  return hashStr(texts.map((t) => t.replace(/\r\n/g, '\n')).join('\u0000')).toString(36);
}
