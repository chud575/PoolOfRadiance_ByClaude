import { describe, it, expect } from 'vitest';
import { kitFor } from '../../src/scenes/create/createData.js';
import { createCharacter, deriveStats, equipProblem, armorAllowsThieving } from '../../src/rules/character.js';
import { RACES } from '../../src/rules/races.js';
import { Rng } from '../../src/rules/dice.js';

const SPECS = new Map();
for (const [rid, r] of Object.entries(RACES)) for (const c of r.classes ?? []) if (!SPECS.has(c)) SPECS.set(c, rid);

describe('starting kits (create)', () => {
  for (const [spec, race] of SPECS) {
    it(`${spec}: every kit item is usable, thieves can thieve, mages can cast`, () => {
      const kit = kitFor(spec, race);
      const ch = createCharacter({ rng: new Rng(3), name: 'T', race, classSpec: spec, abilities: { str: 16, strPct: 0, int: 16, wis: 16, dex: 16, con: 16, cha: 12 }, ignoreLimits: true, items: kit });
      for (const id of kit) if (id !== 'holySymbol') expect(equipProblem(ch, id), `${spec} ${id}`).toBeNull();
      const s = deriveStats(ch);
      if (spec.includes('thief')) expect(armorAllowsThieving(ch)).toBe(true);
      if (spec.includes('magicUser')) expect(s.canCastArcane).toBe(true);
      expect(s.weapon).toBeTruthy();
    });
  }
  it('elven fighter/magic-users start in elfin chain and can still cast', () => {
    for (const race of ['elf', 'halfElf']) {
      const kit = kitFor('fighter/magicUser', race);
      expect(kit).toContain('elfinChain');
      const ch = createCharacter({ rng: new Rng(3), name: 'T', race, classSpec: 'fighter/magicUser', abilities: { str: 16, strPct: 0, int: 16, wis: 16, dex: 16, con: 16, cha: 12 }, items: kit });
      expect(deriveStats(ch).canCastArcane).toBe(true);
    }
  });
});
