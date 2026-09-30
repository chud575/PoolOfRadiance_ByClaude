import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import {
  createCharacter, deriveStats, awardXp, trainLevels, computeMaxHp, applyDamage, heal, rollLegalAbilities, meetsClassMinimums, applyRace,
} from '../../src/rules/character.js';
import { strengthMods, dexterityMods, conHpBonus } from '../../src/rules/abilities.js';
import { thac0For, savesFor, levelForXp, spellSlots, thiefSkills } from '../../src/rules/classes.js';
import { raceAllowsClass, RACES } from '../../src/rules/races.js';
import { buildParty } from '../../src/rules/party.js';

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });

describe('ability tables', () => {
  it('strength', () => {
    expect(strengthMods(16)).toEqual({ hit: 0, dmg: 0 });
    expect(strengthMods(17)).toEqual({ hit: 1, dmg: 1 });
    expect(strengthMods(18, 76)).toEqual({ hit: 2, dmg: 4 });
    expect(strengthMods(18, 100)).toEqual({ hit: 3, dmg: 6 });
    expect(strengthMods(3)).toEqual({ hit: -3, dmg: -1 });
  });
  it('dex & con', () => {
    expect(dexterityMods(18).ac).toBe(-4);
    expect(dexterityMods(10).ac).toBe(0);
    expect(dexterityMods(4).ac).toBe(3);
    expect(conHpBonus(18, true)).toBe(4);
    expect(conHpBonus(18, false)).toBe(2);
  });
});

describe('class tables', () => {
  it('THAC0 progression', () => {
    expect(thac0For('fighter', 1)).toBe(20);
    expect(thac0For('fighter', 3)).toBe(18);
    expect(thac0For('cleric', 4)).toBe(18);
    expect(thac0For('magicUser', 5)).toBe(20);
    expect(thac0For('magicUser', 6)).toBe(18);
    expect(thac0For('thief', 5)).toBe(18);
  });
  it('saves', () => {
    expect(savesFor('fighter', 1)).toEqual({ ppdm: 14, pp: 15, rsw: 16, bw: 17, sp: 17 });
    expect(savesFor('magicUser', 1).rsw).toBe(11);
    expect(savesFor('cleric', 1).ppdm).toBe(10);
  });
  it('xp levels', () => {
    expect(levelForXp('fighter', 0)).toBe(1);
    expect(levelForXp('fighter', 1999)).toBe(1);
    expect(levelForXp('fighter', 2000)).toBe(2);
    expect(levelForXp('thief', 10000)).toBe(5);
  });
  it('spell slots and thief skills', () => {
    expect(spellSlots('magicUser', 1)).toEqual([1]);
    expect(spellSlots('cleric', 5)).toEqual([3, 3, 1]);
    expect(thiefSkills(1).ol).toBe(25);
    expect(thiefSkills(1, RACES.dwarf.thiefAdj).ol).toBe(40);
  });
});

describe('races', () => {
  it('class restrictions', () => {
    expect(raceAllowsClass('dwarf', 'fighter/thief')).toBe(true);
    expect(raceAllowsClass('dwarf', 'magicUser')).toBe(false);
    expect(raceAllowsClass('human', 'fighter/thief')).toBe(false);
    expect(raceAllowsClass('halfElf', 'cleric/fighter/magicUser')).toBe(true);
  });
  it('adjusts and clamps', () => {
    const a = applyRace(abil({ dex: 18, con: 12 }), 'elf');
    expect(a.dex).toBe(19);
    expect(a.con).toBe(11);
  });
});

describe('characters', () => {
  it('rolls legal abilities', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const a = rollLegalAbilities(rng, 'dwarf', 'fighter');
      expect(meetsClassMinimums(a, 'fighter')).toBe(true);
      expect(a.con).toBeGreaterThanOrEqual(12);
    }
  });
  it('creates a fighter with correct derived stats', () => {
    const rng = new Rng(1);
    const ch = createCharacter({ rng, name: 'T', race: 'human', classSpec: 'fighter', abilities: abil({ str: 18, strPct: 76, dex: 15, con: 17 }), items: ['longSword', 'shield', 'chainMail'] });
    expect(ch.hp.max).toBe(13); // 10 + 3 con
    const s = deriveStats(ch);
    expect(s.thac0).toBe(20);
    expect(s.ac).toBe(3); // chain 5, shield -1, dex -1
    expect(s.hitBonus).toBe(2);
    expect(s.dmgBonus).toBe(4);
    expect(s.damage).toBe('1d8');
  });
  it('multiclass hp is averaged and xp split', () => {
    const rng = new Rng(2);
    const ch = createCharacter({ rng, name: 'E', race: 'elf', classSpec: 'fighter/magicUser', abilities: abil({ str: 15, int: 17, dex: 16, con: 12 }) });
    expect(ch.hp.max).toBe(Math.floor((10 + 4) / 2));
    const ready = awardXp(ch, 5000);
    expect(ch.xp.fighter).toBe(2500);
    expect(ch.xp.magicUser).toBe(2500);
    expect(ready.sort()).toEqual(['fighter', 'magicUser']);
    const raised = trainLevels(ch, rng);
    expect(raised.length).toBe(2);
    expect(ch.levels.fighter).toBe(2);
    expect(ch.hp.max).toBe(computeMaxHp(ch));
  });
  it('magic-users cannot wear armor', () => {
    const rng = new Rng(3);
    const ch = createCharacter({ rng, name: 'M', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 17 }), items: ['chainMail', 'staff'] });
    expect(ch.inventory.find((e) => e.id === 'chainMail').equipped).toBe(false);
    expect(ch.inventory.find((e) => e.id === 'staff').equipped).toBe(true);
    expect(deriveStats(ch).spellSlots.magicUser).toEqual([1]);
  });
  it('death door', () => {
    const rng = new Rng(4);
    const ch = createCharacter({ rng, name: 'X', race: 'human', classSpec: 'thief', abilities: abil({ dex: 16 }) });
    applyDamage(ch, ch.hp.cur);
    expect(ch.status).toBe('unconscious');
    applyDamage(ch, 3);
    expect(ch.status).toBe('dying');
    heal(ch, 10);
    expect(ch.status).toBe('ok');
    applyDamage(ch, 100);
    expect(ch.status).toBe('dead');
  });
  it('builds deterministic prebuilt parties', () => {
    const a = buildParty('default', 1);
    const b = buildParty('default', 1);
    expect(a.length).toBe(6);
    expect(a.map((c) => c.hp.max)).toEqual(b.map((c) => c.hp.max));
    expect(a.every((c) => c.hp.cur > 0)).toBe(true);
  });
});

describe('equipment', () => {
  it('does not auto-equip a second weapon over the first', () => {
    const rng = new Rng(8);
    const ch = createCharacter({ rng, name: 'F', race: 'human', classSpec: 'fighter', abilities: abil({ str: 16 }), items: ['longSword', 'shield', 'chainMail', 'shortBow', 'arrows'] });
    expect(deriveStats(ch).weapon.id).toBe('longSword');
    expect(ch.inventory.find((e) => e.id === 'shortBow').equipped).toBe(false);
  });
});
