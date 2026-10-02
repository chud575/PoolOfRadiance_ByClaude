import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import {
  createCharacter, deriveStats, awardXp, trainLevels, computeMaxHp, applyDamage, heal, rollLegalAbilities, meetsClassMinimums,
  bleed, bandage, raiseDead, stoneToFlesh, maxLevel, trainableClasses, trainingCost, xpBonusPct, dualClass, dualClassProblem,
  validateConcept, equipItem, unequipItem, removeItem, addItem, canEquip, equipProblem, effectiveAbilities, carriedWeight,
  statusLabel, activeClasses, isAlive, armorAllowsArcane,
} from '../../src/rules/character.js';
import { xpForLevel } from '../../src/rules/classes.js';
import { buildParty, activeMembers, partyGold } from '../../src/rules/party.js';
import { addEffect } from '../../src/rules/conditions.js';

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });
const mk = (o) => createCharacter({ rng: new Rng(o.seed ?? 1), name: 'X', race: 'human', classSpec: 'fighter', abilities: abil(o.a), ...o });

describe('creation', () => {
  it('rolls legal abilities for race/class', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const a = rollLegalAbilities(rng, 'dwarf', 'fighter');
      expect(meetsClassMinimums(a, 'fighter')).toBe(true);
      expect(a.con).toBeGreaterThanOrEqual(12);
      if (a.strPct) expect(a.str).toBe(18);
      expect(a.strPct).toBeLessThanOrEqual(99);
    }
    for (let i = 0; i < 50; i++) expect(rollLegalAbilities(rng, 'elf', 'magicUser').strPct).toBe(0);
  });
  it('creates a fighter with correct derived stats', () => {
    const ch = mk({ a: { str: 18, strPct: 76, dex: 15, con: 17 }, items: ['longSword', 'shield', 'chainMail'] });
    expect(ch.hp.max).toBe(13); // 10 + 3 con
    const s = deriveStats(ch);
    expect(s.thac0).toBe(20);
    expect(s.ac).toBe(3); // chain 5, shield -1, dex -1
    expect(s.hitBonus).toBe(2);
    expect(s.dmgBonus).toBe(4);
    expect(s.damage).toBe('1d8');
    expect(s.move).toBe(9); // chain mail
    expect(s.attacks).toBe(1);
    expect(s.className).toBe('Fighter');
  });
  it('validates concepts', () => {
    expect(validateConcept({ race: 'human', classSpec: 'thief', alignment: 'LG' })).toContain('LG not allowed for thief');
    expect(validateConcept({ race: 'dwarf', classSpec: 'magicUser' }).length).toBe(1);
    expect(validateConcept({ race: 'human', classSpec: 'fighter', alignment: 'LG', abilities: abil({ str: 18, strPct: 50 }) })).toEqual([]);
    expect(validateConcept({ race: 'human', classSpec: 'cleric', abilities: abil({ str: 18, strPct: 50 }) })).toContain('illegal exceptional strength');
    expect(validateConcept({ race: 'human', classSpec: 'magicUser', abilities: abil({ int: 8 }) })).toContain('ability minimums not met');
  });
  it('thieves default to a legal alignment', () => {
    const t = createCharacter({ rng: new Rng(1), name: 'T', race: 'human', classSpec: 'thief', abilities: abil({ dex: 15 }) });
    expect(t.alignment).toBe('TN');
  });
  it('starting ages follow race/class tables', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 20; i++) {
      const e = createCharacter({ rng, name: 'E', race: 'elf', classSpec: 'magicUser', abilities: abil({ int: 15, dex: 10 }) });
      expect(e.age).toBeGreaterThanOrEqual(155);
      expect(e.age).toBeLessThanOrEqual(180);
    }
  });
  it('creates higher-level characters with the right xp', () => {
    const ch = mk({ level: 5 });
    expect(ch.levels.fighter).toBe(5);
    expect(ch.xp.fighter).toBe(xpForLevel('fighter', 5));
    expect(ch.hpRolls.fighter.length).toBe(5);
  });
});

describe('multiclass', () => {
  it('hp is averaged and xp split', () => {
    const rng = new Rng(2);
    const ch = createCharacter({ rng, name: 'E', race: 'elf', classSpec: 'fighter/magicUser', abilities: abil({ str: 15, int: 17, dex: 16, con: 12 }) });
    expect(ch.hp.max).toBe(Math.floor((10 + 4) / 2));
    const ready = awardXp(ch, 5004);
    expect(ch.xp.fighter).toBe(2502);
    expect(ch.xp.magicUser).toBe(2502);
    expect(ready.sort()).toEqual(['fighter', 'magicUser']);
    const raised = trainLevels(ch, rng);
    expect(raised.length).toBe(2);
    expect(ch.levels.fighter).toBe(2);
    expect(ch.hp.max).toBe(computeMaxHp(ch));
  });
  it('uses the best THAC0 and saves of its classes', () => {
    const ch = createCharacter({ rng: new Rng(3), name: 'P', race: 'halfling', classSpec: 'fighter/thief', abilities: abil({ str: 14, dex: 18, con: 14 }), items: ['shortSword', 'leather'] });
    const s = deriveStats(ch);
    expect(s.thac0).toBe(20);
    expect(s.saves.ppdm).toBe(13); // poison bonus is not folded into the whole line
    expect(s.savePoison).toBe(13 - 4); // thief 13, halfling +4 (CON 14) vs poison
    expect(s.thief.hs).toBe(10 + 15 + 10); // base + halfling + dex 18
    expect(s.backstab).toBe(2);
  });
  it('thief skills vanish in heavy armour', () => {
    const ch = createCharacter({ rng: new Rng(3), name: 'P', race: 'halfling', classSpec: 'fighter/thief', abilities: abil({ str: 14, dex: 18, con: 14 }), items: ['shortSword', 'chainMail'] });
    expect(deriveStats(ch).thief.pp).toBe(0);
    expect(deriveStats(ch).thief.hn).toBeGreaterThan(0);
  });
});

describe('experience & training', () => {
  it('prime requisite bonus', () => {
    const ch = mk({ a: { str: 16 } });
    expect(xpBonusPct(ch)).toBe(10);
    awardXp(ch, 1000);
    expect(ch.xp.fighter).toBe(1100);
    const m = createCharacter({ rng: new Rng(1), name: 'E', race: 'elf', classSpec: 'fighter/magicUser', abilities: abil({ str: 17, int: 17, dex: 16 }) });
    expect(xpBonusPct(m)).toBe(0);
  });
  it('caps banked xp one short of the level after next', () => {
    const ch = mk({});
    awardXp(ch, 1e6);
    expect(ch.xp.fighter).toBe(xpForLevel('fighter', 3) - 1);
    expect(trainableClasses(ch)).toEqual(['fighter']);
    trainLevels(ch, new Rng(1));
    expect(ch.levels.fighter).toBe(2);
    expect(trainableClasses(ch)).toEqual([]); // xp capped below level 3
    awardXp(ch, 1e6);
    expect(ch.xp.fighter).toBe(xpForLevel('fighter', 4) - 1);
  });
  it('respects racial limits and the PoR cap', () => {
    const elf = createCharacter({ rng: new Rng(1), name: 'E', race: 'elf', classSpec: 'fighter', abilities: abil({ str: 12, dex: 12 }), level: 5 });
    expect(maxLevel(elf, 'fighter')).toBe(5);
    awardXp(elf, 1e7);
    expect(trainableClasses(elf)).toEqual([]);
    expect(elf.xp.fighter).toBe(xpForLevel('fighter', 6) - 1);
    const hum = mk({ level: 8 });
    expect(maxLevel(hum, 'fighter')).toBe(8);
    expect(maxLevel(hum, 'fighter', { caps: null })).toBe(Infinity);
    const mu = createCharacter({ rng: new Rng(1), name: 'M', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 18 }), level: 6 });
    awardXp(mu, 1e7);
    expect(trainableClasses(mu)).toEqual([]);
  });
  it('training cost', () => {
    const ch = mk({});
    expect(trainingCost(ch)).toBe(0);
    awardXp(ch, 2001);
    expect(trainingCost(ch)).toBe(1000);
    expect(trainingCost(ch, { mode: 'dmg' })).toBe(1500);
  });
  it('the dead gain no xp', () => {
    const ch = mk({});
    ch.status = 'dead';
    expect(awardXp(ch, 5000)).toEqual([]);
    expect(ch.xp.fighter).toBe(0);
  });
});

describe('dual-class (humans)', () => {
  it('checks requirements', () => {
    expect(dualClassProblem(mk({ a: { str: 15, dex: 17 } }), 'thief')).toBeNull();
    expect(dualClassProblem(mk({ a: { str: 14, dex: 17 } }), 'thief')).toMatch(/15/);
    expect(dualClassProblem(mk({ a: { str: 15, dex: 16 } }), 'thief')).toMatch(/17/);
    const elf = createCharacter({ rng: new Rng(1), name: 'E', race: 'elf', classSpec: 'fighter', abilities: abil({ str: 17, dex: 17 }) });
    expect(dualClassProblem(elf, 'thief')).toMatch(/humans/);
  });
  it('old class abilities return once surpassed', () => {
    const ch = mk({ a: { str: 16, int: 17, dex: 12 }, level: 3 });
    const hp = ch.hp.max;
    dualClass(ch, 'magicUser');
    expect(ch.classSpec).toBe('magicUser');
    expect(activeClasses(ch)).toEqual(['magicUser']);
    expect(ch.hp.max).toBe(hp);
    expect(deriveStats(ch).thac0).toBe(21);
    const rng = new Rng(4);
    for (let l = 2; l <= 4; l++) {
      ch.xp.magicUser = xpForLevel('magicUser', l);
      trainLevels(ch, rng);
    }
    expect(ch.levels.magicUser).toBe(4);
    expect(activeClasses(ch)).toEqual(['fighter', 'magicUser']);
    expect(deriveStats(ch).thac0).toBe(18);
    expect(ch.hp.max).toBeGreaterThan(hp);
  });
});

describe('equipment', () => {
  it('does not auto-equip a second weapon over the first', () => {
    const ch = mk({ a: { str: 16 }, items: ['longSword', 'shield', 'chainMail', 'shortBow', 'arrows'] });
    expect(deriveStats(ch).weapon.id).toBe('longSword');
    expect(ch.inventory.find((e) => e.id === 'shortBow').equipped).toBe(false);
  });
  it('magic-users cannot wear armor', () => {
    const ch = createCharacter({ rng: new Rng(3), name: 'M', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 17 }), items: ['chainMail', 'staff'] });
    expect(ch.inventory.find((e) => e.id === 'chainMail').equipped).toBe(false);
    expect(ch.inventory.find((e) => e.id === 'staff').equipped).toBe(true);
    expect(deriveStats(ch).spellSlots.magicUser).toEqual([1]);
    expect(equipProblem(ch, 'chainMail')).toBe('armor not allowed');
    expect(equipProblem(ch, 'longSword')).toBe('weapon not allowed');
  });
  it('clerics use only blunt weapons; F/MU may wear armour but cannot cast in it', () => {
    const c = createCharacter({ rng: new Rng(3), name: 'C', race: 'human', classSpec: 'cleric', abilities: abil({ wis: 15 }) });
    expect(canEquip(c, 'mace')).toBe(true);
    expect(canEquip(c, 'longSword')).toBe(false);
    const e = createCharacter({ rng: new Rng(3), name: 'E', race: 'elf', classSpec: 'fighter/magicUser', abilities: abil({ int: 15 }), items: ['chainMail'] });
    expect(armorAllowsArcane(e)).toBe(false);
    expect(deriveStats(e).canCastArcane).toBe(false);
  });
  it('two-handed weapons and shields exclude each other', () => {
    const ch = mk({ items: ['shield', 'twoHandedSword'] });
    expect(ch.inventory[1].equipped).toBe(false);
    equipItem(ch, 1);
    expect(ch.inventory[1].equipped).toBe(true);
    expect(ch.inventory[0].equipped).toBe(false);
  });
  it('magic items: +N weapons, armour, rings and entry overrides', () => {
    const ch = mk({ a: { str: 12, dex: 12 }, items: ['longSwordPlus1', 'chainMailPlus1', 'ringProtection1'] });
    const s = deriveStats(ch);
    expect(s.hitBonus).toBe(1);
    expect(s.dmgBonus).toBe(1);
    expect(s.ac).toBe(4); // 5 -1 magic; DMG: the ring's AC does not add to magic armour...
    expect(s.saves.sp).toBe(16); // ...but its save bonus does
    const e = addItem(ch, 'longSword', { magic: 3 });
    ch.inventory.forEach((x) => { if (x.id === 'longSwordPlus1') x.equipped = false; });
    equipItem(ch, ch.inventory.indexOf(e));
    expect(deriveStats(ch).hitBonus).toBe(3);
  });
  it('cursed items cannot be removed', () => {
    const ch = mk({});
    const e = addItem(ch, 'longSword', { magic: -1, cursed: true });
    equipItem(ch, 0);
    expect(unequipItem(ch, 0)).toBe(false);
    expect(removeItem(ch, 0)).toBeNull();
    expect(deriveStats(ch).hitBonus).toBe(-1);
    e.cursed = false;
    expect(unequipItem(ch, 0)).toBe(true);
  });
  it('encumbrance slows the overloaded', () => {
    const ch = mk({ a: { str: 10 }, items: [] });
    ch.gold = 0;
    expect(deriveStats(ch).move).toBe(12);
    ch.gold = 500;
    expect(carriedWeight(ch)).toBe(500);
    expect(deriveStats(ch).move).toBe(9);
    ch.gold = 1200;
    expect(deriveStats(ch).move).toBe(3);
    ch.gold = 2000;
    expect(deriveStats(ch).move).toBe(0);
    expect(deriveStats(ch).encumbrance.label).toBe('Overloaded');
  });
  it('racial missile bonuses', () => {
    const h = createCharacter({ rng: new Rng(1), name: 'H', race: 'halfling', classSpec: 'thief', abilities: abil({ dex: 12 }), items: ['sling'] });
    expect(deriveStats(h).hitBonus).toBe(3);
  });
});

describe('effects on derived stats', () => {
  it('strength spell, gauntlet-style setStr, enfeeblement', () => {
    const ch = mk({ a: { str: 16 } });
    addEffect(ch, 'strength', { rounds: 60, mods: { strBonus: 3 } });
    expect(effectiveAbilities(ch).str).toBe(18);
    expect(effectiveAbilities(ch).strPct).toBe(10); // 16 → 17 → 18 → 18/10 (PHB: tenths above 18)
    addEffect(ch, 'giantStrength', { rounds: 10, mods: { strSet: { str: 21 } } });
    expect(effectiveAbilities(ch).str).toBe(21);
    expect(deriveStats(ch).dmgBonus).toBe(9);
    addEffect(ch, 'enfeebled', { rounds: 2, mods: { strLossPct: 50 } });
    expect(effectiveAbilities(ch).str).toBe(10);
  });
  it('bless, shield, haste, blindness', () => {
    const ch = mk({ a: { dex: 16 }, items: ['longSword', 'leather'] });
    const base = deriveStats(ch);
    addEffect(ch, 'blessed', { rounds: 6 });
    expect(deriveStats(ch).hitBonus).toBe(base.hitBonus + 1);
    addEffect(ch, 'shielded', { rounds: 5 });
    expect(deriveStats(ch).ac).toBe(Math.min(base.ac, 4));
    expect(deriveStats(ch).acMissile).toBe(2);
    addEffect(ch, 'hasted', { rounds: 5 });
    expect(deriveStats(ch).attacks).toBe(2);
    expect(deriveStats(ch).move).toBe(24);
    addEffect(ch, 'slowed', { rounds: 5 });
    expect(deriveStats(ch).attacks).toBe(1); // cancel out
    addEffect(ch, 'blinded');
    expect(deriveStats(ch).hitBonus).toBe(base.hitBonus + 1 - 4);
  });
});

describe('death and healing', () => {
  it("death's door", () => {
    const ch = createCharacter({ rng: new Rng(4), name: 'X', race: 'human', classSpec: 'thief', abilities: abil({ dex: 16 }) });
    applyDamage(ch, ch.hp.cur);
    expect(ch.status).toBe('unconscious');
    applyDamage(ch, 3);
    expect(ch.status).toBe('dying');
    heal(ch, 10);
    expect(ch.status).toBe('ok');
    applyDamage(ch, 100);
    expect(ch.status).toBe('dead');
    expect(isAlive(ch)).toBe(false);
    expect(heal(ch, 5)).toBe(0);
  });
  it('bleeding 1 hp/round until bandaged; death at -10', () => {
    const ch = mk({ a: { con: 12 } });
    ch.hp.cur = 1;
    applyDamage(ch, 9); // -8
    expect(ch.status).toBe('dying');
    expect(bleed(ch)).toBe(true);
    expect(ch.hp.cur).toBe(-9);
    expect(bleed(ch)).toBe(true);
    expect(ch.status).toBe('dead');
    const b = mk({});
    b.hp.cur = 0;
    applyDamage(b, 3);
    expect(bandage(b)).toBe(true);
    expect(b.status).toBe('unconscious');
    expect(bleed(b)).toBe(false);
    expect(b.hp.cur).toBe(-3);
    expect(statusLabel(b)).toBe('Unconscious');
  });
  it('damage wakes sleepers', () => {
    const ch = mk({});
    addEffect(ch, 'asleep', { rounds: 10 });
    applyDamage(ch, 1);
    expect(ch.conditions).not.toContain('asleep');
  });
  it('raise dead costs a point of CON; failure is final', () => {
    const rng = new Rng(9);
    const ch = mk({ a: { con: 18 } });
    applyDamage(ch, 100);
    const r = raiseDead(rng, ch);
    expect(r.ok).toBe(true); // 100% survival at CON 18
    expect(ch.status).toBe('ok');
    expect(ch.hp.cur).toBe(1);
    expect(ch.abilities.con).toBe(17);
    const w = mk({ a: { con: 3 } });
    applyDamage(w, 100);
    let tries = 0;
    let res;
    const rng2 = new Rng(1);
    do { w.status = 'dead'; res = raiseDead(rng2, w); tries++; } while (res.ok && tries < 50);
    expect(w.status).toBe('gone');
  });
  it('stone to flesh uses system shock', () => {
    const ch = mk({ a: { con: 18 } });
    ch.status = 'stoned';
    expect(stoneToFlesh(new Rng(1), ch).ok).toBe(true);
    expect(ch.status).toBe('ok');
  });
});

describe('parties', () => {
  it('builds deterministic prebuilt parties', () => {
    const a = buildParty('default', 1);
    const b = buildParty('default', 1);
    expect(a.length).toBe(6);
    expect(a.map((c) => c.hp.max)).toEqual(b.map((c) => c.hp.max));
    expect(a.map((c) => c.abilities)).toEqual(b.map((c) => c.abilities));
    expect(new Set(a.map((c) => c.id)).size).toBe(6);
    expect(a.every((c) => c.hp.cur > 0)).toBe(true);
    expect(activeMembers(buildParty('wounded', 1)).length).toBe(2);
    expect(partyGold(a)).toBeGreaterThan(0);
  });
  it('veterans are level 5 with enchanted gear', () => {
    const v = buildParty('veterans', 1);
    expect(v[0].levels.fighter).toBe(5);
    expect(deriveStats(v[0]).thac0).toBe(16);
    expect(deriveStats(v[0]).weaponMagic).toBe(1);
  });
});
