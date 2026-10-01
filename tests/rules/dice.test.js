import { describe, it, expect } from 'vitest';
import { Rng, roll, parseDice, diceStats, rollDetailed } from '../../src/rules/dice.js';

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

describe('Rng', () => {
  it('int/die stay in range and hit every face', () => {
    const r = new Rng(11);
    const seen = new Set();
    for (let i = 0; i < 3000; i++) {
      const v = r.die(20);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      seen.add(v);
      const w = r.int(-3, 3);
      expect(w).toBeGreaterThanOrEqual(-3);
      expect(w).toBeLessThanOrEqual(3);
    }
    expect(seen.size).toBe(20);
  });
  it("is roughly uniform (d6 over 60k rolls within 1 point of 1/6)", () => {
    const r = new Rng(5);
    const n = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) n[r.die(6) - 1]++;
    for (const c of n) expect(Math.abs(c / 60000 - 1 / 6)).toBeLessThan(0.01);
  });
  it('chance() honours its percentage; pick() covers the array', () => {
    const r = new Rng(8);
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (r.chance(25)) hits++;
    expect(hits / 20000).toBeGreaterThan(0.23);
    expect(hits / 20000).toBeLessThan(0.27);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(100)).toBe(true);
    const got = new Set(Array.from({ length: 200 }, () => r.pick(['a', 'b', 'c'])));
    expect([...got].sort()).toEqual(['a', 'b', 'c']);
  });
  it('state can be saved and restored; fork does not perturb determinism', () => {
    const a = new Rng(99);
    a.die(6);
    const s = a.getState();
    const x = [a.die(100), a.die(100), a.die(100)];
    a.setState(s);
    expect([a.die(100), a.die(100), a.die(100)]).toEqual(x);
    const b = new Rng(99), c = new Rng(99);
    const fb = b.fork(1), fc = c.fork(1);
    expect(fb.die(1000)).toBe(fc.die(1000));
    expect(b.die(1000)).toBe(c.die(1000));
    expect(new Rng(0).seed).toBe(1); // zero seed is remapped, never stuck
  });
});

describe('dice expressions', () => {
  it('multiplied treasure dice and plain numbers', () => {
    const r = new Rng(2);
    for (let i = 0; i < 500; i++) {
      const v = roll(r, '10d6x100');
      expect(v % 100).toBe(0);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(6000);
    }
    expect(roll(r, 7)).toBe(7);
    expect(roll(r, '-2')).toBe(-2);
    expect(diceStats('1d6x100')).toEqual({ min: 100, max: 600, avg: 350 });
    expect(diceStats('1d2-1')).toEqual({ min: 0, max: 1, avg: 0.5 });
  });
  it('rollDetailed reports the dice and totals consistently', () => {
    const r = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const d = rollDetailed(r, '3d6+2');
      expect(d.dice.length).toBe(3);
      expect(d.total).toBe(d.dice.reduce((a, b) => a + b, 0) + 2);
      d.dice.forEach((x) => { expect(x).toBeGreaterThanOrEqual(1); expect(x).toBeLessThanOrEqual(6); });
    }
    const t = rollDetailed(r, '2d4x10');
    expect(t.total).toBe((t.dice[0] + t.dice[1]) * 10);
  });
  it('averages converge (4d6 drop-free mean ~14)', () => {
    const r = new Rng(17);
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum += roll(r, '4d6');
    expect(Math.abs(sum / 20000 - 14)).toBeLessThan(0.1);
  });
  it('tolerates whitespace and case; rejects junk', () => {
    expect(parseDice(' 2D8 + 1 ')).toEqual({ count: 2, sides: 8, mod: 1, mult: 1 });
    expect(parseDice('1d6 x 10').mult).toBe(10);
    for (const bad of ['d', '2d', 'xd6', '1d6++1', '']) expect(() => parseDice(bad), bad).toThrow();
  });
});
