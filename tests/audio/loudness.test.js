import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CAL } from '../../src/audio/loudness.data.js';
import { MUSIC_TARGETS, AMB_TARGET, SOURCES, sourceFingerprint, songFingerprint, sfxTarget } from '../../src/audio/loudness.js';
import { SONGS, STINGERS } from '../../src/audio/music/songs.js';
import { SFX } from '../../src/audio/sfx/library.js';
import { BEDS } from '../../src/audio/sfx/ambience.js';

/**
 * Loudness discipline: every cue was measured (BS.1770 LUFS, offline render)
 * at its calibrated gain and sits within tolerance of its target, and the
 * calibration is not stale. If this fails after changing a theme or the
 * synthesis, re-run: node tools/audiorender.mjs --calibrate
 */
const root = path.resolve(import.meta.dirname, '../../src/audio');
const fp = (fam) => sourceFingerprint(SOURCES[fam].map((p) => fs.readFileSync(path.join(root, p), 'utf8')));
const HINT = 're-run `node tools/audiorender.mjs --calibrate`';

describe('audio loudness calibration', () => {
  it('is fresh for the current synthesis code', () => {
    expect(CAL.fp.music, `music synthesis changed: ${HINT}`).toBe(fp('music'));
    expect(CAL.fp.sfx, `sfx synthesis changed: ${HINT}`).toBe(fp('sfx'));
    expect(CAL.fp.amb, `ambience synthesis changed: ${HINT}`).toBe(fp('amb'));
  });

  for (const [id, song] of Object.entries({ ...SONGS, ...STINGERS })) {
    it(`music ${id} is within 1.5 LU of ${MUSIC_TARGETS[id]} LUFS`, () => {
      const c = CAL.music[id];
      expect(c, `${id} not calibrated: ${HINT}`).toBeTruthy();
      expect(c.fp, `${id} changed since calibration: ${HINT}`).toBe(songFingerprint(song));
      expect(Math.abs(c.lufs - MUSIC_TARGETS[id]), `${id}: ${c.lufs} LUFS`).toBeLessThanOrEqual(1.5);
    });
  }

  it('keeps ambience beds at -26..-28 LUFS', () => {
    for (const id of Object.keys(BEDS)) {
      if (id === 'silence') continue;
      for (const k of BEDS[id].night ? [id, `${id}_night`] : [id]) {
        const c = CAL.amb[k];
        expect(c, `${k} not calibrated: ${HINT}`).toBeTruthy();
        expect(Math.abs(c.lufs - AMB_TARGET), `${k}: ${c.lufs}`).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('keeps the SFX hierarchy (momentary loudness per family)', () => {
    for (const id of Object.keys(SFX)) {
      const c = CAL.sfx[id];
      expect(c, `sfx ${id} not calibrated: ${HINT}`).toBeTruthy();
      expect(Math.abs(c.m - sfxTarget(id)), `${id}: ${c.m} vs ${sfxTarget(id)}`).toBeLessThanOrEqual(2);
    }
    // UI ticks and footsteps sit at -24…-30; nothing in the library is louder than a fireball.
    for (const id of ['hover', 'click', 'page', 'turn', 'map', 'open', 'close', 'step']) expect(CAL.sfx[id].m).toBeGreaterThanOrEqual(-32);
    for (const id of Object.keys(SFX)) expect(CAL.sfx[id].m, id).toBeLessThanOrEqual(CAL.sfx.spell_fire.m + 1.5);
  });
});
