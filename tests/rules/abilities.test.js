import { describe, it, expect } from 'vitest';
import {
  strengthMods, strengthTable, dexterityMods, conHpBonus, constitutionTable, wisdomBonusSpells, wisdomSaveAdj,
  wisdomSpellFailure, intelligenceTable, charismaTable, formatStr, addStrength, compareStr, abilitySummary,
} from '../../src/rules/abilities.js';

describe('strength (PHB table)', () => {
  it('to-hit and damage across the range', () => {
    expect(strengthMods(3)).toEqual({ hit: -3, dmg: -1 });
    expect(strengthMods(5)).toEqual({ hit: -2, dmg: -1 });
    expect(strengthMods(7)).toEqual({ hit: -1, dmg: 0 });
    expect(strengthMods(12)).toEqual({ hit: 0, dmg: 0 });
    expect(strengthMods(16)).toEqual({ hit: 0, dmg: 1 });
    expect(strengthMods(17)).toEqual({ hit: 1, dmg: 1 });
    expect(strengthMods(18)).toEqual({ hit: 1, dmg: 2 });
  });
  it('exceptional strength bands 18/01 .. 18/00', () => {
    expect(strengthMods(18, 1)).toEqual({ hit: 1, dmg: 3 });
    expect(strengthMods(18, 50)).toEqual({ hit: 1, dmg: 3 });
    expect(strengthMods(18, 51)).toEqual({ hit: 2, dmg: 3 });
    expect(strengthMods(18, 76)).toEqual({ hit: 2, dmg: 4 });
    expect(strengthMods(18, 91)).toEqual({ hit: 2, dmg: 5 });
    expect(strengthMods(18, 100)).toEqual({ hit: 3, dmg: 6 });
  });
  it('giant strength 19-25 and weight allowance', () => {
    expect(strengthMods(19)).toEqual({ hit: 3, dmg: 7 });
    expect(strengthMods(25)).toEqual({ hit: 7, dmg: 14 });
    expect(strengthTable(18, 100).weight).toBe(3000);
    expect(strengthTable(10).weight).toBe(0);
    expect(strengthTable(3).weight).toBe(-350);
    expect(strengthTable(18, 100).doors).toBe(5);
    expect(strengthTable(18, 100).bars).toBe(40);
  });
  it('formats and raises strength', () => {
    expect(formatStr(18, 76)).toBe('18(76)');
    expect(formatStr(18, 100)).toBe('18(00)');
    expect(formatStr(18, 5)).toBe('18(05)');
    expect(formatStr(17, 0)).toBe('17');
    expect(addStrength(16, 0, 1)).toEqual({ str: 17, strPct: 0 });
    expect(addStrength(17, 0, 3, true)).toEqual({ str: 18, strPct: 20 }); // PHB: tenths of a point above 18
    expect(addStrength(18, 95, 3, true)).toEqual({ str: 18, strPct: 100 });
    expect(addStrength(17, 0, 3, false)).toEqual({ str: 18, strPct: 0 });
    expect(addStrength(18, 100, 4, true)).toEqual({ str: 18, strPct: 100 });
    expect(compareStr(18, 50, 18, 0)).toBeGreaterThan(0);
    expect(compareStr(17, 0, 18, 1)).toBeLessThan(0);
  });
});

describe('dexterity / constitution', () => {
  it('dex AC and missile adjustments', () => {
    expect(dexterityMods(3)).toEqual({ ac: 4, missile: -3, reaction: -3 });
    expect(dexterityMods(10).ac).toBe(0);
    expect(dexterityMods(14).ac).toBe(0);
    expect(dexterityMods(15).ac).toBe(-1);
    expect(dexterityMods(15).missile).toBe(0);
    expect(dexterityMods(16)).toEqual({ ac: -2, missile: 1, reaction: 1 });
    expect(dexterityMods(18)).toEqual({ ac: -4, missile: 3, reaction: 3 });
    expect(dexterityMods(19).ac).toBe(-4);
  });
  it('con hp bonus (fighters exceed +2)', () => {
    expect(conHpBonus(3, false)).toBe(-2);
    expect(conHpBonus(6, false)).toBe(-1);
    expect(conHpBonus(14, true)).toBe(0);
    expect(conHpBonus(15, false)).toBe(1);
    expect(conHpBonus(16, false)).toBe(2);
    expect(conHpBonus(17, true)).toBe(3);
    expect(conHpBonus(17, false)).toBe(2);
    expect(conHpBonus(18, true)).toBe(4);
    expect(conHpBonus(18, false)).toBe(2);
    expect(conHpBonus(19, true)).toBe(5);
  });
  it('system shock and resurrection survival', () => {
    expect(constitutionTable(3)).toMatchObject({ systemShock: 35, resurrection: 40 });
    expect(constitutionTable(10)).toMatchObject({ systemShock: 70, resurrection: 75 });
    expect(constitutionTable(18)).toMatchObject({ systemShock: 99, resurrection: 100 });
  });
});

describe('wisdom / intelligence / charisma', () => {
  it('cleric bonus spells by wisdom', () => {
    expect(wisdomBonusSpells(12)).toEqual([0, 0, 0, 0]);
    expect(wisdomBonusSpells(13)).toEqual([1, 0, 0, 0]);
    expect(wisdomBonusSpells(14)).toEqual([2, 0, 0, 0]);
    expect(wisdomBonusSpells(15)).toEqual([2, 1, 0, 0]);
    expect(wisdomBonusSpells(16)).toEqual([2, 2, 0, 0]);
    expect(wisdomBonusSpells(17)).toEqual([2, 2, 1, 0]);
    expect(wisdomBonusSpells(18)).toEqual([2, 2, 1, 1]);
  });
  it('wisdom magical attack adjustment and spell failure', () => {
    expect(wisdomSaveAdj(3)).toBe(-3);
    expect(wisdomSaveAdj(10)).toBe(0);
    expect(wisdomSaveAdj(15)).toBe(1);
    expect(wisdomSaveAdj(18)).toBe(4);
    expect(wisdomSpellFailure(9)).toBe(20);
    expect(wisdomSpellFailure(12)).toBe(5);
    expect(wisdomSpellFailure(13)).toBe(0);
  });
  it('intelligence spell-learning table', () => {
    expect(intelligenceTable(8).maxSpellLevel).toBe(0);
    expect(intelligenceTable(9)).toMatchObject({ maxSpellLevel: 4, knowChance: 35, minSpells: 4, maxSpells: 6 });
    expect(intelligenceTable(12)).toMatchObject({ maxSpellLevel: 5, knowChance: 45 });
    expect(intelligenceTable(16)).toMatchObject({ maxSpellLevel: 7, knowChance: 65 });
    expect(intelligenceTable(17)).toMatchObject({ maxSpellLevel: 8, knowChance: 75, maxSpells: 14 });
    expect(intelligenceTable(18)).toMatchObject({ maxSpellLevel: 9, knowChance: 85, maxSpells: 18 });
  });
  it('charisma henchmen/loyalty/reaction', () => {
    expect(charismaTable(3)).toEqual({ henchmen: 1, loyalty: -30, reaction: -25 });
    expect(charismaTable(10)).toEqual({ henchmen: 4, loyalty: 0, reaction: 0 });
    expect(charismaTable(18)).toEqual({ henchmen: 15, loyalty: 40, reaction: 35 });
  });
  it('summary aggregates everything', () => {
    const s = abilitySummary({ str: 18, strPct: 76, int: 17, wis: 16, dex: 15, con: 17, cha: 12 });
    expect(s.str.dmg).toBe(4);
    expect(s.int.maxSpellLevel).toBe(8);
    expect(s.wis.bonusSpells).toEqual([2, 2, 0, 0]);
    expect(s.dex.ac).toBe(-1);
    expect(s.con.hpFighter).toBe(3);
    expect(s.cha.henchmen).toBe(5);
  });
});
