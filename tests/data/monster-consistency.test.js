/**
 * Monster data against the rules tables: a MonsterDef's stated `thac0` must
 * be what the rules would derive without it (monsterBaseThac0: class table
 * for class-based NPCs, ZERO_LEVEL_THAC0 for 0-level men, else the DMG
 * monster matrix by HD), and saves follow the same ruling.
 *
 * KNOWN_DATA_MISMATCHES are open fixes for the world-data owner
 * (src/data/monsters.js). The test fails on any NEW mismatch and also when a
 * listed one is fixed, so the list stays honest.
 */
import { describe, it, expect } from 'vitest';
import { MONSTERS } from '../../src/data/monsters.js';
import * as R from '../../src/rules/index.js';

export const KNOWN_DATA_MISMATCHES = Object.freeze({
  // 1+3 HD is the matrix's "1+" row (18); data says 19. Fix: thac0 18 (or drop it).
  koboldChief: 'thac0 19, DMG matrix 1+3 HD = 18',
  // 3 HD on the matrix is 16; data's 18 is a 3rd-level fighter (Gold Box 21 − 3).
  // Fix: classAs: 'fighter3' (then thac0 18 and F3 saves are derived), or thac0 16.
  banditLeader: 'thac0 18 = fighter 3 without classAs; DMG matrix 3 HD = 16',
});

const derivedThac0 = (m) => {
  const { thac0, ...rest } = m; // eslint-disable-line no-unused-vars
  return R.monsterBaseThac0(rest);
};

describe('monster data agrees with the rules tables', () => {
  it('every stated thac0 equals the derived one (except the listed data fixes)', () => {
    const mismatches = Object.values(MONSTERS)
      .filter((m) => typeof m.thac0 === 'number' && m.thac0 !== derivedThac0(m))
      .map((m) => m.id)
      .sort();
    expect(mismatches).toEqual(Object.keys(KNOWN_DATA_MISMATCHES).filter((id) => MONSTERS[id]).sort());
  });

  it('0-level human bands use one ruling: THAC0 20 and level-0 saves', () => {
    const bands = Object.values(MONSTERS).filter((m) => R.isZeroLevelMan(m));
    expect(bands.length).toBeGreaterThan(0);
    for (const m of bands) {
      expect([m.id, R.monsterBaseThac0(m)]).toEqual([m.id, R.ZERO_LEVEL_THAC0]);
      expect([m.id, R.monsterBaseSaves(m)]).toEqual([m.id, R.savesFor('fighter', 0)]);
    }
  });

  it('class-based NPCs fight and save as their class', () => {
    for (const m of Object.values(MONSTERS)) {
      const ca = R.classAsOf(m);
      if (!ca) continue;
      expect([m.id, derivedThac0(m)]).toEqual([m.id, R.thac0For(ca.cls, ca.level)]);
      if (!m.saves) expect([m.id, R.monsterBaseSaves(m)]).toEqual([m.id, R.savesFor(ca.cls, ca.level)]);
    }
  });

  it('other monsters save as fighters of their effective HD', () => {
    for (const m of Object.values(MONSTERS)) {
      if (R.classAsOf(m) || R.isZeroLevelMan(m) || m.saves) continue;
      expect([m.id, R.monsterBaseSaves(m)]).toEqual([m.id, R.savesFor('fighter', R.effectiveHd(m.hd ?? 1, m.hpBonus ?? 0))]);
    }
  });
});
