import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import {
  generateTreasure, treasureValue, rollGem, rollJewelry, rollMagicItem, rollScroll, shareCoins, TREASURE_TYPES, treasureXp,
  treasureCoinWeight,
} from '../../src/rules/treasure.js';
import { ITEMS } from '../../src/data/items.js';
import { SPELL_RULES } from '../../src/rules/spells.js';

describe('treasure', () => {
  it('is deterministic per seed', () => {
    expect(generateTreasure(new Rng(5), 'A')).toEqual(generateTreasure(new Rng(5), 'A'));
  });
  it('individual types give coins per creature', () => {
    const t = generateTreasure(new Rng(1), 'J', { count: 10 });
    expect(t.coins.cp).toBeGreaterThanOrEqual(30);
    expect(t.coins.cp).toBeLessThanOrEqual(240);
    const m = generateTreasure(new Rng(1), 'M', { count: 3 });
    expect(m.coins.gp).toBeGreaterThanOrEqual(6);
  });
  it('every type generates valid output', () => {
    const rng = new Rng(2);
    for (const type of Object.keys(TREASURE_TYPES)) {
      for (let i = 0; i < 10; i++) {
        const t = generateTreasure(rng, type);
        for (const e of t.items) {
          expect(ITEMS[e.id], e.id).toBeTruthy();
          for (const s of e.spells ?? []) expect(SPELL_RULES[s]).toBeTruthy();
        }
        expect(treasureValue(t)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(() => generateTreasure(rng, 'ZZ')).toThrow();
  });
  it('rich hoards contain gems, jewelry and magic over many rolls', () => {
    const rng = new Rng(3);
    let gems = 0;
    let jewels = 0;
    let items = 0;
    for (let i = 0; i < 50; i++) {
      const t = generateTreasure(rng, 'H');
      gems += t.gems.length;
      jewels += t.jewelry.length;
      items += t.items.length;
    }
    expect(gems).toBeGreaterThan(0);
    expect(jewels).toBeGreaterThan(0);
    expect(items).toBeGreaterThan(0);
  });
  it('gem and jewelry values follow the DMG tables', () => {
    const rng = new Rng(4);
    const vals = new Set();
    for (let i = 0; i < 500; i++) {
      const g = rollGem(rng);
      vals.add(g.value);
      expect(g.name).toBeTruthy();
      const j = rollJewelry(rng);
      expect(j.value).toBeGreaterThanOrEqual(100);
      expect(j.value).toBeLessThanOrEqual(12000);
    }
    for (const v of [10, 50, 100, 500, 1000]) expect(vals.has(v)).toBe(true);
  });
  it('magic items: enchanted arms and armour, scrolls', () => {
    const rng = new Rng(6);
    let plus = 0;
    let cursed = 0;
    for (let i = 0; i < 200; i++) {
      const e = rollMagicItem(rng, 'armsArmor');
      expect(e).toBeTruthy();
      expect(e.identified).toBe(false);
      expect([-1, 1, 2, 3]).toContain(e.magic);
      if (e.magic > 0) plus++;
      if (e.cursed) cursed++;
    }
    expect(plus).toBeGreaterThan(170);
    expect(cursed).toBeGreaterThan(0);
    const s = rollScroll(rng);
    expect(s.spells.length).toBeGreaterThanOrEqual(1);
  });
  it('shares coins and totals value/weight', () => {
    const shares = shareCoins({ cp: 10, sp: 0, ep: 0, gp: 7, pp: 1 }, 3);
    expect(shares.map((s) => s.gp)).toEqual([3, 2, 2]);
    expect(shares.reduce((t, s) => t + s.cp, 0)).toBe(10);
    const t = { coins: { cp: 100, sp: 10, ep: 2, gp: 5, pp: 1 }, gems: [{ value: 50 }], jewelry: [{ value: 300 }], items: [] };
    expect(treasureValue(t)).toBe(1 + 1 + 1 + 5 + 5 + 50 + 300);
    expect(treasureXp(t)).toBe(363);
    expect(treasureCoinWeight(t)).toBe(118);
  });
});
