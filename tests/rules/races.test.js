import { describe, it, expect } from 'vitest';
import {
  RACES, RACE_IDS, raceAllowsClass, racialLevelLimit, racialSaveBonus, racialPoisonBonus, raceAbilityCaps, checkRaceAbilities,
} from '../../src/rules/races.js';
import { applyRace } from '../../src/rules/character.js';

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });

describe('races', () => {
  it('has the six PoR races', () => {
    expect(RACE_IDS.sort()).toEqual(['dwarf', 'elf', 'gnome', 'halfElf', 'halfling', 'human']);
  });
  it('ability adjustments', () => {
    expect(RACES.dwarf.adjust).toEqual({ con: 1, cha: -1 });
    expect(RACES.elf.adjust).toEqual({ dex: 1, con: -1 });
    expect(RACES.halfling.adjust).toEqual({ str: -1, dex: 1 });
    expect(RACES.gnome.adjust).toEqual({});
    expect(RACES.halfElf.adjust).toEqual({});
  });
  it('class restrictions', () => {
    expect(raceAllowsClass('dwarf', 'fighter/thief')).toBe(true);
    expect(raceAllowsClass('dwarf', 'magicUser')).toBe(false);
    expect(raceAllowsClass('human', 'fighter/thief')).toBe(false);
    expect(raceAllowsClass('halfElf', 'cleric/fighter/magicUser')).toBe(true);
    expect(raceAllowsClass('elf', 'cleric')).toBe(false);
    expect(raceAllowsClass('elf', 'fighter/magicUser/thief')).toBe(true);
    expect(raceAllowsClass('gnome', 'fighter/thief')).toBe(true);
    expect(raceAllowsClass('halfling', 'cleric')).toBe(false);
  });
  it('adjusts and clamps to race min/max', () => {
    const a = applyRace(abil({ dex: 18, con: 12 }), 'elf');
    expect(a.dex).toBe(19);
    expect(a.con).toBe(11);
    expect(applyRace(abil({ con: 18 }), 'dwarf').con).toBe(19);
    expect(applyRace(abil({ con: 5 }), 'dwarf').con).toBe(12); // dwarf minimum
    expect(applyRace(abil({ str: 18 }), 'halfling').str).toBe(17);
    expect(applyRace(abil({ cha: 18 }), 'dwarf').cha).toBe(16);
    expect(applyRace(abil({ str: 18 }), 'human', 'female').str).toBe(18);
    expect(applyRace(abil({ str: 18 }), 'elf', 'female').str).toBe(16);
  });
  it('level limits depend on prime ability', () => {
    expect(racialLevelLimit('elf', 'fighter')).toBe(7);
    expect(racialLevelLimit('elf', 'fighter', { str: 18 })).toBe(7);
    expect(racialLevelLimit('elf', 'fighter', { str: 17 })).toBe(6);
    expect(racialLevelLimit('elf', 'fighter', { str: 12 })).toBe(5);
    expect(racialLevelLimit('elf', 'magicUser', { int: 18 })).toBe(11);
    expect(racialLevelLimit('elf', 'magicUser', { int: 16 })).toBe(9);
    expect(racialLevelLimit('dwarf', 'fighter', { str: 17 })).toBe(8);
    expect(racialLevelLimit('halfElf', 'cleric', { wis: 18 })).toBe(5);
    // PoR: halfling fighters reach 6th flat (the PHB's STR 18 row is unreachable).
    expect(racialLevelLimit('halfling', 'fighter', { str: 17 })).toBe(6);
    expect(racialLevelLimit('halfling', 'fighter', { str: 12 })).toBe(6);
    expect(racialLevelLimit('gnome', 'fighter', { str: 18 })).toBe(6);
    expect(racialLevelLimit('gnome', 'fighter', { str: 17 })).toBe(5);
    expect(racialLevelLimit('gnome', 'thief', { str: 3 })).toBe(Infinity);
    expect(racialLevelLimit('human', 'magicUser')).toBe(Infinity);
    expect(racialLevelLimit('dwarf', 'cleric')).toBe(0);
  });
  it('racial save bonuses by CON', () => {
    expect(racialSaveBonus('dwarf', 18)).toBe(5);
    expect(racialSaveBonus('dwarf', 14)).toBe(4);
    expect(racialSaveBonus('halfling', 10)).toBe(2);
    expect(racialSaveBonus('human', 18)).toBe(0);
    expect(racialPoisonBonus('gnome', 18)).toBe(0);
    expect(racialPoisonBonus('dwarf', 18)).toBe(5);
  });
  it('exceptional strength caps by race and gender', () => {
    expect(raceAbilityCaps('human').maxStrPct).toBe(100);
    expect(raceAbilityCaps('human', 'female').maxStrPct).toBe(50);
    expect(raceAbilityCaps('dwarf').maxStrPct).toBe(99);
    expect(raceAbilityCaps('elf').maxStrPct).toBe(75);
    expect(raceAbilityCaps('halfling').maxStrPct).toBe(0);
    expect(raceAbilityCaps('elf', 'female').max.str).toBe(16);
    expect(checkRaceAbilities('human', abil({ str: 18, strPct: 80 }), 'female')).toContain('exceptional strength above 18/50');
    expect(checkRaceAbilities('dwarf', abil({ con: 12 }))).toEqual([]);
    expect(checkRaceAbilities('dwarf', abil({ con: 11 })).length).toBe(1);
  });
  it('movement, infravision and thief adjustments', () => {
    expect(RACES.human.move).toBe(12);
    expect(RACES.dwarf.move).toBe(6);
    expect(RACES.halfling.move).toBe(9);
    expect(RACES.human.infravision).toBe(0);
    expect(RACES.elf.infravision).toBe(60);
    expect(RACES.gnome.thiefAdj.ol).toBe(5);
    expect(RACES.halfling.thiefAdj.hs).toBe(15);
  });
});
