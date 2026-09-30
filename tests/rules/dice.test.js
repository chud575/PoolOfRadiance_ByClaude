import { describe, it, expect } from 'vitest';
import { Rng, roll, parseDice, diceStats } from '../../src/rules/dice.js';

describe('dice', () => {
  it('parses expressions', () => {
    expect(parseDice('3d6')).toEqual({ count: 3, sides: 6, mod: 0, mult: 1 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, mod: 0, mult: 1 });
    expect(parseDice('1d8+1')).toEqual({ count: 1, sides: 8, mod: 1, mult: 1 });
    expect(parseDice('2d4-1')).toEqual({ count: 2, sides: 4, mod: -1, mult: 1 });
    expect(parseDice('5d4x10')).toEqual({ count: 5, sides: 4, mod: 0, mult: 10 });
    expect(parseDice('1d%').sides).toBe(100);
    expect(parseDice(7).mod).toBe(7);
    expect(() => parseDice('banana')).toThrow();
  });
  it('is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42);
    const ra = Array.from({ length: 20 }, () => roll(a, '3d6'));
    const rb = Array.from({ length: 20 }, () => roll(b, '3d6'));
    expect(ra).toEqual(rb);
  });
  it('stays within bounds', () => {
    const r = new Rng(3);
    for (let i = 0; i < 2000; i++) {
      const v = roll(r, '2d4+1');
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
    expect(diceStats('2d4+1')).toEqual({ min: 3, max: 9, avg: 6 });
  });
});
