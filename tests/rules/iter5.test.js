/**
 * Iteration-5 rules review regressions: Mirror Image duration, Raise Dead
 * with temporary hit points, one racial level-limit model, one THAC0 model,
 * the multiclass armour-casting ruling, Hold Person's target count and the
 * size of Small player characters.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as R from '../../src/rules/index.js';

const { Rng } = R;
const BASE = { str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12 };
const mk = (race, classSpec, o = {}) => R.createCharacter({
  rng: new Rng(o.seed ?? 7), name: o.name ?? 'T', race, classSpec, level: o.level, items: o.items,
  abilities: { ...BASE, ...(o.a ?? {}) }, ignoreLimits: o.ignoreLimits,
});
const mon = (id, seed = 1) => R.combatantFromMonster(new Rng(seed), id);
const caster = (o = {}) => ({ id: 'cx', name: 'Caster', side: 'party', hp: { cur: 20, max: 20 }, casterLevel: 5, ...o });

afterEach(() => R.resetRulesOptions());

describe('Mirror Image (1e PHB magic-user: 2 rounds/level)', () => {
  it('a 5th-level caster gets 10 rounds, a 1st-level one 2', () => {
    const mu = mk('human', 'magicUser', { a: { int: 17 }, level: 5 });
    const r = R.castSpell(new Rng(3), 'mirrorImage', mu, [], { check: false });
    expect(r.ok).toBe(true);
    expect(R.getEffect(mu, 'mirrorImage').rounds).toBe(10);
    const lo = mk('human', 'magicUser', { a: { int: 17 }, level: 1 });
    R.castSpell(new Rng(3), 'mirrorImage', lo, [], { check: false });
    expect(R.getEffect(lo, 'mirrorImage').rounds).toBe(2);
    expect(R.SPELL_RULES.mirrorImage.tip).toMatch(/2 rounds\/level/);
  });
});

describe('Raise Dead clears effects before recomputing max hp', () => {
  it('Heroism temporary hp active at death do not inflate the raised max', () => {
    const f = mk('human', 'fighter', { a: { con: 16 }, level: 4, seed: 11 });
    R.addItem(f, 'potionHeroism');
    R.useItem(new Rng(11), f, f.inventory.findIndex((e) => e.id === 'potionHeroism'), [f]);
    const e = R.getEffect(f, 'heroism');
    expect(e.data.tempHp).toBeGreaterThan(0);
    f.hp.cur = -10;
    f.status = 'dead';
    // find a seed whose resurrection roll succeeds
    let res;
    for (let s = 1; s < 50; s++) {
      const g = structuredClone(f);
      res = R.raiseDead(new Rng(s), g);
      if (res.ok) {
        expect(g.effects).toEqual([]);
        expect(g.abilities.con).toBe(15);
        expect(R.tempHpOf(g)).toBe(0);
        expect(g.hp.max).toBe(R.computeMaxHp(g));
        const bare = structuredClone(g);
        bare.effects = [];
        expect(g.hp.max).toBe(R.computeMaxHp(bare));
        expect(g.hp.cur).toBe(1);
        break;
      }
    }
    expect(res.ok).toBe(true);
  });
});

describe('racial level limits: one PHB ability-dependent model', () => {
  it('a STR 9 halfling and a STR 9 gnome both stop at fighter 4; the best halfling reaches 5', () => {
    expect(R.racialLevelLimit('halfling', 'fighter', { str: 9 })).toBe(4);
    expect(R.racialLevelLimit('gnome', 'fighter', { str: 9 })).toBe(4);
    expect(R.racialLevelLimit('halfling', 'fighter', { str: 17 })).toBe(5);
    expect(R.racialLevelLimit('halfling', 'fighter')).toBe(5);
    const h = mk('halfling', 'fighter', { a: { str: 9, dex: 12, con: 12 }, level: 6 });
    expect(h.levels.fighter).toBe(4);
    expect(R.maxLevel(h, 'fighter')).toBe(4);
    const strong = mk('halfling', 'fighter', { a: { str: 17, dex: 12, con: 12 }, level: 6 });
    expect(strong.levels.fighter).toBe(5);
  });
  it('every race with a capped class names its limit through the same table shape', () => {
    for (const race of Object.values(R.RACES)) {
      for (const [cls, by] of Object.entries(race.limitBy)) {
        const [, rows] = by;
        // the flat limit is what the race's best reachable score gives, and limits never rise as the score falls
        expect([race.id, cls, R.racialLevelLimit(race.id, cls, { [by[0]]: race.max[by[0]] })]).toEqual([race.id, cls, race.levelLimits[cls]]);
        for (let i = 1; i < rows.length; i++) expect(rows[i][1]).toBeLessThanOrEqual(rows[i - 1][1]);
      }
    }
  });
});

describe('multiclass arcane casting in armour (RULES_OPTIONS.multiclassArmorCasting)', () => {
  it('Gold Box default: F/MU, F/MU/T and MU/T cast in the armour their other class allows', () => {
    expect(R.RULES_OPTIONS.multiclassArmorCasting).toBe('goldBox');
    const fm = mk('elf', 'fighter/magicUser', { a: { int: 15 }, items: ['plateMail', 'shield'] });
    expect(R.castProblem(fm, 'sleep', { ignoreMemory: true })).toBeNull();
    const fmt = mk('halfElf', 'fighter/magicUser/thief', { a: { int: 15, dex: 15 }, items: ['chainMail'] });
    expect(R.armorAllowsArcane(fmt)).toBe(true);
    const mt = mk('elf', 'magicUser/thief', { a: { int: 15, dex: 15 }, items: ['leather'] });
    expect(R.armorAllowsArcane(mt)).toBe(true);
  });
  it('strict: only elfin chain on an elf or half-elf', () => {
    R.setRulesOptions({ multiclassArmorCasting: 'strict' });
    const fm = mk('elf', 'fighter/magicUser', { a: { int: 15 }, items: ['chainMail'] });
    expect(R.castProblem(fm, 'sleep', { ignoreMemory: true })).toBe('armor prevents arcane casting');
  });
  it('a single-class magic-user never casts in armour under either ruling', () => {
    const mu = mk('human', 'magicUser', { a: { int: 15 } });
    mu.inventory.push(R.makeEntry('leather'));
    mu.inventory.at(-1).equipped = true;
    expect(R.armorAllowsArcane(mu)).toBe(false);
    expect(R.armorAllowsArcane(mu, { multiclassArmorCasting: 'strict' })).toBe(false);
  });
});

describe('Hold Person counts the creatures it was cast at', () => {
  it('an orc beside two bugbears (immune) saves without the lone-target penalty (MU version)', () => {
    const orc = mon('orc');
    const r = R.castSpell(new Rng(5), 'holdPerson', caster(), [orc, mon('bugbear', 2), mon('bugbear', 3)], { check: false, cls: 'magicUser' });
    const tr = r.results.find((x) => x.target === orc);
    expect(r.results.filter((x) => x.immune).length).toBe(2);
    expect(tr.save.bonus).toBe(0);
  });
  it('one orc alone saves at -3 vs a magic-user, -2 vs a cleric; two orcs at -1', () => {
    const a = mon('orc');
    const r1 = R.castSpell(new Rng(5), 'holdPerson', caster(), [a], { check: false, cls: 'magicUser' });
    expect(r1.results[0].save.bonus).toBe(-3);
    const r2 = R.castSpell(new Rng(5), 'holdPerson', caster(), [mon('orc')], { check: false, cls: 'cleric' });
    expect(r2.results[0].save.bonus).toBe(-2);
    const r3 = R.castSpell(new Rng(5), 'holdPerson', caster(), [mon('orc', 1), mon('orc', 2)], { check: false, cls: 'magicUser' });
    expect(r3.results.map((x) => x.save.bonus)).toEqual([-1, -1]);
  });
  it('more targets than the spell can hold count only up to maxTargets', () => {
    const orcs = [1, 2, 3, 4, 5, 6].map((s) => mon('orc', s));
    const r = R.castSpell(new Rng(5), 'holdPerson', caster(), orcs, { check: false, cls: 'cleric' });
    expect(r.results.length).toBe(3);
    expect(r.results.every((x) => x.save.bonus === 0)).toBe(true);
  });
});

describe('player combatants carry their racial size', () => {
  it('halflings and gnomes are Small, humans and dwarves Medium', () => {
    expect(R.combatantFromCharacter(mk('halfling', 'thief', { a: { dex: 14 } })).size).toBe('S');
    expect(R.combatantFromCharacter(mk('gnome', 'fighter', { a: { con: 12 } })).size).toBe('S');
    expect(R.combatantFromCharacter(mk('human', 'fighter')).size).toBe('M');
    expect(R.combatantFromCharacter(mk('dwarf', 'fighter', { a: { con: 14 } })).size).toBe('M');
  });
});

describe('Gold Box THAC0 drives every class on the character sheet', () => {
  it('1st-level characters of every class show THAC0 20; the DMG option restores MU/thief 21', () => {
    for (const cls of ['fighter', 'cleric', 'magicUser', 'thief']) {
      expect([cls, R.deriveStats(mk('human', cls, { a: { str: 12, wis: 12, int: 12, dex: 12 } })).thac0]).toEqual([cls, 20]);
    }
    R.setRulesOptions({ thac0Table: 'dmg' });
    expect(R.deriveStats(mk('human', 'magicUser')).thac0).toBe(21);
    expect(R.deriveStats(mk('human', 'thief')).thac0).toBe(21);
  });
  it('a multiclass character uses the best of its classes', () => {
    const ft = mk('halfling', 'fighter/thief', { a: { str: 14, dex: 14 }, level: 3 });
    expect(R.deriveStats(ft).thac0).toBe(Math.min(R.thac0For('fighter', ft.levels.fighter), R.thac0For('thief', ft.levels.thief)));
  });
});
