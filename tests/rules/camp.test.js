import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, applyDamage } from '../../src/rules/character.js';
import {
  knownSpells, slotsFor, checkLoadout, prepareSpells, spellsToMemorize, memorizationTime, restBeforeMemorizing, rest,
  autoPrepare, learnSpell, freeSlots, partyMemorizationTime, restUntilHealedMinutes, restInterrupted, MINUTES_PER_DAY,
} from '../../src/rules/camp.js';
import { castSpell } from '../../src/rules/spells.js';
import { addEffect, hasEffect } from '../../src/rules/conditions.js';
import { buildParty } from '../../src/rules/party.js';

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });
const cleric = (level, wis = 15) => createCharacter({ rng: new Rng(1), name: 'C', race: 'human', classSpec: 'cleric', abilities: abil({ wis }), level });
const mage = (level) => createCharacter({ rng: new Rng(1), name: 'M', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 17 }), level });

describe('known spells and slots', () => {
  it('clerics know every spell of their levels; mages only their book', () => {
    expect(knownSpells(cleric(1), 'cleric').length).toBe(8);
    expect(knownSpells(cleric(3), 'cleric').length).toBe(16);
    expect(knownSpells(mage(1), 'magicUser').sort()).toEqual(['magicMissile', 'readMagic', 'shield', 'sleep']);
    expect(knownSpells(mage(1), 'cleric')).toEqual([]);
  });
  it('wisdom bonus spells only for levels the cleric can cast', () => {
    expect(slotsFor(cleric(1, 18), 'cleric')).toEqual([3]);
    expect(slotsFor(cleric(3, 16), 'cleric')).toEqual([4, 3]);
    expect(slotsFor(cleric(5, 17), 'cleric')).toEqual([5, 5, 2]);
  });
});

describe('load-outs', () => {
  it('validates counts and knowledge', () => {
    const c = cleric(1, 13);
    expect(checkLoadout(c, 'cleric', ['bless', 'cureLightWounds'])).toEqual([]);
    expect(checkLoadout(c, 'cleric', ['bless', 'bless', 'bless'])[0]).toMatch(/too many level 1/);
    expect(checkLoadout(c, 'cleric', ['holdPerson'])[0]).toMatch(/not known/);
    expect(() => prepareSpells(c, 'cleric', ['holdPerson'])).toThrow();
    const m = mage(1);
    expect(checkLoadout(m, 'magicUser', ['burningHands'])[0]).toMatch(/not known/);
    prepareSpells(m, 'magicUser', ['sleep']);
    expect(freeSlots(m, 'magicUser')).toEqual([0]);
  });
  it('autoPrepare fills sensible defaults', () => {
    const c = cleric(3, 15);
    autoPrepare(c);
    expect(c.spells.prepared.cleric.length).toBe(4 + 2); // 2+1 slots, +2/+1 for WIS 15
    expect(c.spells.prepared.cleric).toContain('cureLightWounds');
    expect(checkLoadout(c, 'cleric', c.spells.prepared.cleric)).toEqual([]);
    const m = mage(5);
    m.spells.book.push('fireball', 'stinkingCloud', 'mirrorImage');
    autoPrepare(m);
    expect(m.spells.prepared.magicUser).toContain('fireball');
  });
});

describe('memorization and rest', () => {
  it('1e rest-before-memorizing and 15 minutes per spell level', () => {
    expect(restBeforeMemorizing(1)).toBe(240);
    expect(restBeforeMemorizing(3)).toBe(360);
    const c = cleric(5, 12);
    prepareSpells(c, 'cleric', ['bless', 'bless', 'bless', 'holdPerson', 'holdPerson', 'holdPerson', 'prayer']);
    expect(spellsToMemorize(c).cleric.length).toBe(7);
    expect(memorizationTime(c)).toBe(360 + 15 * (3 + 6 + 3));
  });
  it('resting long enough memorizes; casting forgets; resting restores', () => {
    const m = mage(1);
    prepareSpells(m, 'magicUser', ['sleep']);
    const need = memorizationTime(m);
    expect(need).toBe(255);
    const r1 = rest([m], 60);
    expect(r1.memorized).toEqual({});
    rest([m], need - 60);
    expect(m.spells.memorized.magicUser).toEqual(['sleep']);
    expect(memorizationTime(m)).toBe(0);
    castSpell(new Rng(1), 'sleep', m, [], { consume: true });
    expect(m.spells.memorized.magicUser).toEqual([]);
    expect(spellsToMemorize(m)).toEqual({ magicUser: ['sleep'] });
    const rep = rest([m], 8 * 60);
    expect(rep.memorized[m.id]).toEqual(['sleep']);
  });
  it('natural healing: 1 hp per full day, dying members bandaged', () => {
    const party = buildParty('default', 1);
    const f = party[0];
    f.hp.cur = f.hp.max - 5;
    const d = party[3];
    applyDamage(d, d.hp.cur + 3);
    expect(d.status).toBe('dying');
    rest(party, 8 * 60);
    expect(f.hp.cur).toBe(f.hp.max - 5);
    expect(d.status).toBe('unconscious');
    rest(party, 16 * 60);
    expect(f.hp.cur).toBe(f.hp.max - 4);
    const r = rest(party, 3 * MINUTES_PER_DAY, { healPerDay: 2 });
    expect(r.healed[f.id]).toBe(4);
    expect(d.hp.cur).toBe(4);
    expect(d.status).toBe('ok');
  });
  it('effects expire during rest; untreated poison kills; disease blocks healing', () => {
    const party = buildParty('default', 1);
    addEffect(party[0], 'blessed', { rounds: 6 });
    addEffect(party[1], 'poisoned');
    addEffect(party[2], 'diseased');
    party[2].hp.cur = 1;
    addEffect(party[3], 'poisoned');
    addEffect(party[3], 'slowPoison', { rounds: 10000 });
    const r = rest(party, MINUTES_PER_DAY);
    expect(r.expired[party[0].id]).toEqual(['blessed']);
    expect(r.died).toEqual([party[1].id]);
    expect(party[1].status).toBe('dead');
    expect(party[2].hp.cur).toBe(1);
    expect(party[3].status).toBe('ok');
    expect(hasEffect(party[3], 'poisoned')).toBe(true);
  });
  it('party helpers', () => {
    const party = [cleric(1), mage(1)];
    autoPrepare(party[0]);
    autoPrepare(party[1]);
    expect(partyMemorizationTime(party)).toBe(240 + 3 * 15); // WIS 15 cleric: 3 first-level spells
    party[0].hp.cur = party[0].hp.max - 3;
    expect(restUntilHealedMinutes(party)).toBe(3 * MINUTES_PER_DAY);
    const rng = new Rng(3);
    const h = restInterrupted(rng, 8, 100);
    expect(h).toBe(0);
    expect(restInterrupted(rng, 8, 0)).toBe(-1);
  });
});

describe('learning spells', () => {
  it('PoR: any spell of a castable level; 1e chance-to-know optional', () => {
    const m = mage(1);
    expect(learnSpell(m, 'burningHands').ok).toBe(true);
    expect(learnSpell(m, 'burningHands').reason).toBe('already known');
    expect(learnSpell(m, 'fireball').reason).toBe('too high level');
    expect(learnSpell(m, 'bless').reason).toBe('not a magic-user spell');
    expect(learnSpell(cleric(3), 'sleep').reason).toBe('not a magic-user');
    const rng = new Rng(4);
    let fails = 0;
    for (let i = 0; i < 100; i++) {
      const x = mage(1);
      if (!learnSpell(x, 'charmPerson', { rng, chanceToKnow: true }).ok) fails++;
    }
    expect(fails).toBeGreaterThan(10);
    expect(fails).toBeLessThan(45);
  });
});
