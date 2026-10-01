import { describe, it, expect } from 'vitest';
import { headBobEnabled, puddleChance } from '../../src/scenes/explore/exploreRules.js';
import { CELL } from '../../src/data/maps/MapGrid.js';

const S = (o) => ({ get: (k) => o[k] });

describe('explore head-bob setting', () => {
  it('defaults to on', () => expect(headBobEnabled(S({}))).toBe(true));
  it('follows the settings panel key cameraBob', () => {
    expect(headBobEnabled(S({ cameraBob: false }))).toBe(false);
    expect(headBobEnabled(S({ cameraBob: true }))).toBe(true);
  });
  it('accepts the legacy headBob alias', () => expect(headBobEnabled(S({ headBob: false }))).toBe(false));
  it('cameraBob wins over the alias', () => expect(headBobEnabled(S({ cameraBob: true, headBob: false }))).toBe(true));
  it('reduce motion turns it off', () => expect(headBobEnabled(S({ cameraBob: true, reduceMotion: true }))).toBe(false));
});

describe('explore puddles', () => {
  const city = { id: 'city' };
  it('never on house floors or roofed cells', () => {
    expect(puddleChance(city, { cell: CELL.INTERIOR, covered: true })).toBe(0);
    expect(puddleChance(city, { cell: CELL.COURTYARD, covered: true })).toBe(0);
    expect(puddleChance({ id: 'interior' }, { cell: CELL.STREET })).toBe(0);
  });
  it('on open streets, rubble and dungeon stone', () => {
    expect(puddleChance(city, { cell: CELL.STREET })).toBeGreaterThan(0);
    expect(puddleChance(city, { cell: CELL.RUBBLE })).toBeGreaterThan(0);
    expect(puddleChance({ id: 'dungeon' }, { cell: CELL.STREET })).toBeGreaterThan(0);
  });
});
