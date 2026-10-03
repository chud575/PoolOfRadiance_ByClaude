import { describe, it, expect } from 'vitest';
import {
  CLASSES, CLASS_IDS, thac0For, savesFor, levelForXp, xpForLevel, spellSlots, thiefSkills, thiefDexAdj, backstabMultiplier,
  fighterAttacksPerRound, attacksThisRound, turnNeeded, turnColumn, TURN_UNDEAD, allowedAlignments, monsterSaves,
  monsterThac0, effectiveHd, PR_LEVEL_CAPS, classSpecName, classSpecAbbr, maxSpellLevel, splitClasses,
  RULES_OPTIONS, setRulesOptions, attachRulesSettings, resetRulesOptions,
} from '../../src/rules/classes.js';
import { neededToHit } from '../../src/rules/tohit.js';

describe('THAC0 (one Gold Box progression by default; the DMG matrices by option)', () => {
  it('DMG option: the 1e attack matrices for every class', () => {
    const dmg = { thac0Table: 'dmg' };
    expect([0, 1, 2, 3, 5, 8, 17].map((l) => thac0For('fighter', l, dmg))).toEqual([21, 20, 20, 18, 16, 14, 4]);
    expect([1, 3, 4, 7, 19].map((l) => thac0For('cleric', l, dmg))).toEqual([20, 20, 18, 16, 9]);
    expect([1, 5, 6, 11].map((l) => thac0For('magicUser', l, dmg))).toEqual([21, 21, 19, 16]);
    expect([1, 4, 5, 9].map((l) => thac0For('thief', l, dmg))).toEqual([21, 21, 19, 16]);
    // the legacy option name still works per call
    expect(thac0For('magicUser', 1, { fighterThac0: 'dmg' })).toBe(21);
  });
  it('Gold Box (default): every class is THAC0 20 at 1st, then its own steady progression', () => {
    expect(RULES_OPTIONS.thac0Table).toBe('goldBox');
    const at = (c, n) => Array.from({ length: n }, (_, i) => thac0For(c, i + 1));
    expect(thac0For('fighter', 0)).toBe(21);
    expect(at('fighter', 8)).toEqual([20, 19, 18, 17, 16, 15, 14, 13]);
    expect(at('cleric', 9)).toEqual([20, 20, 20, 18, 18, 18, 16, 16, 16]);
    expect(at('thief', 9)).toEqual([20, 20, 19, 19, 18, 18, 17, 17, 16]);
    expect(at('magicUser', 9)).toEqual([20, 20, 20, 19, 19, 19, 18, 18, 18]);
    for (const c of CLASS_IDS) expect(thac0For(c, 1)).toBe(20);
    // Fighters agree with the DMG at its band edges (1st, 3rd, 5th...); clerics everywhere.
    for (const l of [1, 3, 5, 7, 17]) expect(thac0For('fighter', l)).toBe(thac0For('fighter', l, { thac0Table: 'dmg' }));
    for (let l = 1; l <= 18; l++) expect(thac0For('cleric', l)).toBe(thac0For('cleric', l, { thac0Table: 'dmg' }));
    // Never worse than the DMG for anyone at PoR levels.
    for (const c of CLASS_IDS) for (let l = 1; l <= 10; l++) expect(thac0For(c, l)).toBeLessThanOrEqual(thac0For(c, l, { thac0Table: 'dmg' }));
  });
  it('setRulesOptions switches the whole table, accepts the legacy key and ignores bad values', () => {
    try {
      setRulesOptions({ thac0Table: 'dmg' });
      expect(thac0For('fighter', 2)).toBe(20);
      expect(thac0For('thief', 1)).toBe(21);
      setRulesOptions({ thac0Table: 'bogus', nonsense: 1 });
      expect(RULES_OPTIONS.thac0Table).toBe('dmg');
      expect('nonsense' in RULES_OPTIONS).toBe(false);
      setRulesOptions({ fighterThac0: 'goldBox' });
      expect(RULES_OPTIONS.thac0Table).toBe('goldBox');
      setRulesOptions({ multiclassArmorCasting: 'strict' });
      expect(RULES_OPTIONS.multiclassArmorCasting).toBe('strict');
    } finally {
      expect(resetRulesOptions()).toEqual({ thac0Table: 'goldBox', multiclassArmorCasting: 'goldBox' });
    }
    expect(thac0For('fighter', 2)).toBe(19);
    expect(thac0For('thief', 1)).toBe(20);
  });
  it('attachRulesSettings follows the settings store (legacy fighterThac0 key) and its change events', () => {
    const handlers = [];
    const bus = { on: (e, f) => { handlers.push([e, f]); return () => handlers.splice(0); } };
    const off = attachRulesSettings({ get: (k) => (k === 'fighterThac0' ? 'dmg' : k === 'multiclassArmorCasting' ? 'strict' : undefined) }, bus);
    try {
      expect(RULES_OPTIONS.thac0Table).toBe('dmg');
      expect(RULES_OPTIONS.multiclassArmorCasting).toBe('strict');
      const fire = handlers.find(([e]) => e === 'settings:changed')[1];
      fire({ key: 'fighterThac0', value: 'goldBox' });
      expect(RULES_OPTIONS.thac0Table).toBe('goldBox');
      fire({ key: 'thac0Table', value: 'dmg' });
      expect(RULES_OPTIONS.thac0Table).toBe('dmg');
      fire({ key: 'musicVolume', value: 0.2 });
      expect(RULES_OPTIONS.thac0Table).toBe('dmg');
    } finally {
      off();
      resetRulesOptions();
    }
  });
  it('repeating-20 rule', () => {
    expect(neededToHit(20, 7)).toBe(13);
    expect(neededToHit(18, 3, 2)).toBe(13);
    expect(neededToHit(21, 0)).toBe(20); // 21 → 20
    expect(neededToHit(20, -5)).toBe(20); // 25 → 20
    expect(neededToHit(20, -6)).toBe(21); // 26 → 21
    expect(neededToHit(20, 10, 12)).toBe(-2);
  });
});

describe('saving throws', () => {
  it('fighter table', () => {
    expect(savesFor('fighter', 0)).toEqual({ ppdm: 16, pp: 17, rsw: 18, bw: 20, sp: 19 });
    expect(savesFor('fighter', 1)).toEqual({ ppdm: 14, pp: 15, rsw: 16, bw: 17, sp: 17 });
    expect(savesFor('fighter', 5)).toEqual({ ppdm: 11, pp: 12, rsw: 13, bw: 13, sp: 14 });
    expect(savesFor('fighter', 17)).toEqual({ ppdm: 3, pp: 4, rsw: 5, bw: 4, sp: 6 });
  });
  it('cleric, magic-user and thief tables', () => {
    expect(savesFor('cleric', 1)).toEqual({ ppdm: 10, pp: 13, rsw: 14, bw: 16, sp: 15 });
    expect(savesFor('cleric', 4)).toEqual({ ppdm: 9, pp: 12, rsw: 13, bw: 15, sp: 14 });
    expect(savesFor('magicUser', 1)).toEqual({ ppdm: 14, pp: 13, rsw: 11, bw: 15, sp: 12 });
    expect(savesFor('magicUser', 6)).toEqual({ ppdm: 13, pp: 11, rsw: 9, bw: 13, sp: 10 });
    expect(savesFor('thief', 1)).toEqual({ ppdm: 13, pp: 12, rsw: 14, bw: 16, sp: 15 });
    expect(savesFor('thief', 5)).toEqual({ ppdm: 12, pp: 11, rsw: 12, bw: 15, sp: 13 });
  });
  it('monsters save as fighters of their effective HD', () => {
    expect(effectiveHd(0.5)).toBe(0);
    expect(effectiveHd(1)).toBe(1);
    expect(effectiveHd(1, 1)).toBe(2);
    expect(monsterSaves(0.5)).toEqual(savesFor('fighter', 0));
    expect(monsterSaves(3, 1)).toEqual(savesFor('fighter', 4));
  });
  it('monster THAC0 by hit dice', () => {
    expect(monsterThac0(0.5)).toBe(20);
    expect(monsterThac0(1, -1)).toBe(20);
    expect(monsterThac0(1)).toBe(19);
    expect(monsterThac0(1, 1)).toBe(18);
    expect(monsterThac0(2)).toBe(16);
    expect(monsterThac0(4, 1)).toBe(15);
    expect(monsterThac0(6, 6)).toBe(13);
    expect(monsterThac0(16)).toBe(7);
  });
});

describe('experience tables (PHB)', () => {
  it('fighter thresholds', () => {
    expect(levelForXp('fighter', 0)).toBe(1);
    expect(levelForXp('fighter', 2000)).toBe(1);
    expect(levelForXp('fighter', 2001)).toBe(2);
    expect(levelForXp('fighter', 125001)).toBe(8);
    expect(levelForXp('fighter', 250001)).toBe(9);
    expect(levelForXp('fighter', 1000001)).toBe(12);
  });
  it('other classes', () => {
    expect(levelForXp('cleric', 1501)).toBe(2);
    expect(levelForXp('cleric', 27501)).toBe(6);
    expect(levelForXp('magicUser', 2500)).toBe(1);
    expect(levelForXp('magicUser', 40001)).toBe(6);
    expect(levelForXp('thief', 10001)).toBe(5);
    expect(levelForXp('thief', 70001)).toBe(8);
  });
  it('xpForLevel is the inverse, including beyond the table', () => {
    for (const c of CLASS_IDS) {
      for (let l = 1; l <= 18; l++) {
        const xp = xpForLevel(c, l);
        expect(levelForXp(c, xp), `${c} ${l}`).toBe(l);
        if (l > 1) expect(levelForXp(c, xp - 1), `${c} ${l}-1`).toBe(l - 1);
      }
    }
  });
  it('Pool of Radiance level caps', () => {
    expect(PR_LEVEL_CAPS).toEqual({ fighter: 8, cleric: 6, magicUser: 6, thief: 9 });
  });
});

describe('spell slots', () => {
  it('magic-user progression', () => {
    expect(spellSlots('magicUser', 1)).toEqual([1]);
    expect(spellSlots('magicUser', 3)).toEqual([2, 1]);
    expect(spellSlots('magicUser', 5)).toEqual([4, 2, 1]);
    expect(spellSlots('magicUser', 6)).toEqual([4, 2, 2]);
    expect(maxSpellLevel('magicUser', 4)).toBe(2);
  });
  it('cleric progression', () => {
    expect(spellSlots('cleric', 1)).toEqual([1]);
    expect(spellSlots('cleric', 3)).toEqual([2, 1]);
    expect(spellSlots('cleric', 5)).toEqual([3, 3, 1]);
    expect(spellSlots('cleric', 6)).toEqual([3, 3, 2]);
  });
  it('non-casters and level 0 get none; slots are copies', () => {
    expect(spellSlots('fighter', 5)).toEqual([]);
    expect(spellSlots('cleric', 0)).toEqual([]);
    const a = spellSlots('cleric', 5);
    a[0] = 99;
    expect(spellSlots('cleric', 5)[0]).toBe(3);
  });
});

describe('thief skills', () => {
  it('base table', () => {
    expect(thiefSkills(1)).toEqual({ pp: 30, ol: 25, ft: 20, ms: 15, hs: 10, hn: 10, cw: 85, rl: 0 });
    expect(thiefSkills(4).rl).toBe(20);
    expect(thiefSkills(9)).toMatchObject({ pp: 70, ol: 62, ms: 70 });
  });
  it('dexterity adjustments', () => {
    expect(thiefDexAdj(9)).toEqual({ pp: -15, ol: -10, ft: -10, ms: -20, hs: -10 });
    expect(thiefDexAdj(14)).toEqual({});
    expect(thiefDexAdj(18)).toEqual({ pp: 10, ol: 15, ft: 5, ms: 10, hs: 10 });
  });
  it('sums racial + dex adjustments and clamps', () => {
    const s = thiefSkills(1, { ol: 15, ft: 15, cw: -10 }, thiefDexAdj(18));
    expect(s.ol).toBe(55);
    expect(s.ft).toBe(40);
    expect(s.cw).toBe(75);
    expect(thiefSkills(1, thiefDexAdj(9)).ms).toBe(0);
    expect(thiefSkills(15, { pp: 20 }).pp).toBe(99);
  });
  it('backstab multiplier', () => {
    expect(backstabMultiplier(1)).toBe(2);
    expect(backstabMultiplier(5)).toBe(3);
    expect(backstabMultiplier(9)).toBe(4);
    expect(backstabMultiplier(13)).toBe(5);
  });
});

describe('attacks per round', () => {
  it('fighter rates', () => {
    expect(fighterAttacksPerRound(6)).toBe(1);
    expect(fighterAttacksPerRound(7)).toBe(1.5);
    expect(fighterAttacksPerRound(13)).toBe(2);
  });
  it('3/2 alternates 1,2', () => {
    expect([1, 2, 3, 4].map((r) => attacksThisRound(1.5, r))).toEqual([1, 2, 1, 2]);
    expect(attacksThisRound(2, 1)).toBe(2);
    expect(attacksThisRound(1, 7)).toBe(1);
  });
});

describe('turn undead matrix (DMG)', () => {
  it('columns', () => {
    expect(turnColumn(1)).toBe(0);
    expect(turnColumn(8)).toBe(7);
    expect(turnColumn(9)).toBe(8);
    expect(turnColumn(13)).toBe(8);
    expect(turnColumn(14)).toBe(9);
  });
  it('entries', () => {
    expect(turnNeeded(1, 'skeleton')).toBe(10);
    expect(turnNeeded(3, 'zombie')).toBe(7);
    expect(turnNeeded(4, 'skeleton')).toBe('T');
    expect(turnNeeded(6, 'skeleton')).toBe('D');
    expect(turnNeeded(8, 'skeleton')).toBe('D*');
    expect(turnNeeded(1, 'ghast')).toBe('-');
    expect(turnNeeded(5, 'ghoul')).toBe('T');
    expect(turnNeeded(14, 'lich')).toBe(10);
    for (const row of Object.values(TURN_UNDEAD)) expect(row.length).toBe(10);
  });
});

describe('alignment and names', () => {
  it('thieves may be any alignment but lawful good (PoR creation rule)', () => {
    const a = allowedAlignments('thief');
    expect(a).not.toContain('LG');
    expect(a).toContain('CG');
    expect(a).toContain('NG');
    expect(a.length).toBe(8);
    expect(allowedAlignments('fighter/thief')).toEqual(a);
    expect(allowedAlignments('fighter').length).toBe(9);
  });
  it('spec names', () => {
    expect(classSpecName('fighter/magicUser/thief')).toBe('Fighter/Magic-User/Thief');
    expect(classSpecAbbr('cleric/fighter')).toBe('C/F');
    expect(splitClasses('fighter')).toEqual(['fighter']);
  });
  it('every class has consistent tables', () => {
    for (const c of Object.values(CLASSES)) {
      expect(c.xp[0]).toBe(0);
      for (let i = 1; i < c.xp.length; i++) expect(c.xp[i]).toBeGreaterThan(c.xp[i - 1]);
      expect(c.thac0[c.thac0.length - 1][0]).toBe(99);
    }
  });
});
