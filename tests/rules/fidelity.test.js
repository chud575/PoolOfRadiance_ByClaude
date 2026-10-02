import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { charismaTable, intelligenceTable } from '../../src/rules/abilities.js';
import { RACES } from '../../src/rules/races.js';
import { ARMOR_MOVE, armorMoveLimit } from '../../src/rules/items.js';
import { ITEMS } from '../../src/data/items.js';
import { MONSTERS } from '../../src/data/monsters.js';
import {
  createCharacter, deriveStats, canEquip, equipProblem, armorAllowsArcane, raiseDead, addItem,
} from '../../src/rules/character.js';
import { turnNeeded, attacksThisRound, allowedAlignments } from '../../src/rules/classes.js';
import {
  combatantFromCharacter, combatantFromMonster, attacksFor, sweepAttacks, resolveAttack, hitChance, liveMods,
  autoResolve, poison,
} from '../../src/rules/combat.js';
import { addEffect, hasEffect, getEffect } from '../../src/rules/conditions.js';
import { racialCombatMods, familyOf, belowOneHd, hitDiceOf } from '../../src/rules/creature.js';
import { castSpell, SLEEP_BANDS, dispelChance, spellTargeting } from '../../src/rules/spells.js';
import { rest, prepareSpells, study, memorizationTime, learnSpell } from '../../src/rules/camp.js';
import { serviceApplies, serviceProblem, performService } from '../../src/rules/temple.js';
import { generateTreasure, TREASURE_TYPES } from '../../src/rules/treasure.js';

/**
 * Fidelity checks against the 1e PHB/DMG/MM for the details an independent
 * review found wrong or missing: CHA/INT columns, racial thief and combat
 * adjustments, armour movement, attack rates under haste/slow, sweeps,
 * helpless targets, poison during rest, spell save penalties and bands,
 * dispel odds, cleric spell failure, raising elves, cleric weapons,
 * memorization, spell-book caps and treasure type W.
 */

const abil = (o = {}) => ({ str: 16, strPct: 0, int: 12, wis: 12, dex: 10, con: 14, cha: 10, ...o });
const make = (race, classSpec, o = {}) => createCharacter({ rng: new Rng(o.seed ?? 1), name: o.name ?? race, race, classSpec, level: o.level ?? 1, abilities: abil(o.abilities), items: o.items });

describe('ability tables (PHB columns)', () => {
  it('charisma reaction: 8-12 neutral, then +5/+10/+15/+25/+30/+35', () => {
    const want = { 3: -25, 4: -20, 5: -15, 6: -10, 7: -5, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 5, 14: 10, 15: 15, 16: 25, 17: 30, 18: 35 };
    for (const [cha, r] of Object.entries(want)) expect(charismaTable(Number(cha)).reaction, `CHA ${cha}`).toBe(r);
  });
  it('charisma loyalty column is unchanged (9-13 neutral)', () => {
    expect(charismaTable(8).loyalty).toBe(-5);
    expect(charismaTable(13).loyalty).toBe(0);
    expect(charismaTable(14).loyalty).toBe(5);
    expect(charismaTable(18).loyalty).toBe(40);
  });
  it('intelligence additional languages follow the PHB column', () => {
    const want = { 7: 0, 8: 1, 9: 1, 10: 2, 11: 2, 12: 3, 13: 3, 14: 4, 15: 4, 16: 5, 17: 6, 18: 7 };
    for (const [int, n] of Object.entries(want)) expect(intelligenceTable(Number(int)).languages, `INT ${int}`).toBe(n);
  });
  it('INT 19 chance to know is 95%', () => {
    expect(intelligenceTable(19).knowChance).toBe(95);
    expect(intelligenceTable(18).knowChance).toBe(85);
  });
});

describe('racial data', () => {
  it('thief adjustments: dwarf OL +10, gnome OL +5', () => {
    expect(RACES.dwarf.thiefAdj).toEqual({ ol: 10, ft: 15, cw: -10, rl: -5 });
    expect(RACES.gnome.thiefAdj).toEqual({ ol: 5, ft: 10, ms: 5, hs: 5, hn: 10, cw: -15 });
    expect(RACES.halfling.thiefAdj.ol).toBe(5);
    expect(RACES.elf.thiefAdj.ol).toBe(-5);
  });
  it('dwarf and gnome to-hit and -4 AC lists', () => {
    expect(RACES.dwarf.bonusVs).toEqual(['orc', 'halfOrc', 'goblin', 'hobgoblin']);
    expect(RACES.gnome.bonusVs).toEqual(['kobold', 'goblin']);
    expect(RACES.dwarf.acVs).toEqual(expect.arrayContaining(['giant', 'ogre', 'troll', 'titan']));
    expect(RACES.gnome.acVs).toEqual(expect.arrayContaining(['giant', 'ogre', 'troll', 'titan', 'gnoll', 'bugbear']));
    expect(RACES.dwarf.acVs).not.toContain('gnoll');
  });
  it('creature families group leaders and giants with their kin', () => {
    expect(familyOf(MONSTERS.orcLeader)).toBe('orc');
    expect(familyOf(MONSTERS.hobgoblinChief)).toBe('hobgoblin');
    expect(familyOf(MONSTERS.hobgoblin)).toBe('hobgoblin');
    expect(familyOf(MONSTERS.goblin)).toBe('goblin');
    expect(familyOf(MONSTERS.koboldChief)).toBe('kobold');
    expect(familyOf(MONSTERS.hillGiant)).toBe('giant');
    expect(familyOf(MONSTERS.giantRat)).toBe('giantRat');
    expect(familyOf(MONSTERS.giantSpider)).toBe('giantSpider');
  });
});

describe('armour movement (PHB)', () => {
  it('per armour group', () => {
    expect(ARMOR_MOVE).toEqual({ leather: 12, padded: 9, studded: 9, ring: 9, scale: 6, chain: 9, elfin: 12, banded: 9, splint: 6, plate: 6 });
    expect(armorMoveLimit(ITEMS.ringMail)).toBe(9);
  });
});

describe('racial combat modifiers reach combat', () => {
  const gnome = combatantFromCharacter(make('gnome', 'fighter'));
  const dwarf = combatantFromCharacter(make('dwarf', 'fighter', { abilities: { con: 16, cha: 8 } }));
  const human = combatantFromCharacter(make('human', 'fighter'));
  const rng = new Rng(7);
  const m = (id) => combatantFromMonster(rng, id, 1);
  it('-4 AC for dwarves and gnomes against giant-kin', () => {
    for (const id of ['ogre', 'troll', 'hillGiant']) {
      expect(racialCombatMods(m(id), gnome).ac, id).toBe(-4);
      expect(racialCombatMods(m(id), dwarf).ac, id).toBe(-4);
      expect(racialCombatMods(m(id), human).ac, id).toBe(0);
    }
    for (const id of ['gnoll', 'bugbear']) {
      expect(racialCombatMods(m(id), gnome).ac, id).toBe(-4);
      expect(racialCombatMods(m(id), dwarf).ac, id).toBe(0);
    }
  });
  it('+1 to hit: dwarves vs orcs/goblins/hobgoblins, gnomes vs kobolds/goblins', () => {
    for (const id of ['orc', 'orcLeader', 'goblin', 'hobgoblin', 'hobgoblinChief']) expect(racialCombatMods(dwarf, m(id)).hit, id).toBe(1);
    for (const id of ['kobold', 'koboldChief', 'goblin']) expect(racialCombatMods(gnome, m(id)).hit, id).toBe(1);
    expect(racialCombatMods(gnome, m('orc')).hit).toBe(0);
    expect(racialCombatMods(human, m('orc')).hit).toBe(0);
    expect(liveMods(dwarf, m('orc')).hit).toBe(1);
  });
  it('a gnoll hits a gnome 20% less often than an equally armoured human', () => {
    const g = m('gnoll');
    expect(gnome.ac).toBe(human.ac);
    expect(hitChance(g, gnome)).toBeCloseTo(hitChance(g, human) - 0.2);
  });
});

describe('attack rates are live (haste, slow, 3/2)', () => {
  it('attacksThisRound spreads rational rates evenly', () => {
    expect([1, 2, 3, 4].map((r) => attacksThisRound(1.5, r))).toEqual([1, 2, 1, 2]);
    expect([1, 2, 3, 4].map((r) => attacksThisRound(0.5, r))).toEqual([0, 1, 0, 1]);
    expect([1, 2, 3, 4].map((r) => attacksThisRound(0.75, r))).toEqual([0, 1, 1, 1]);
    expect([1, 2].map((r) => attacksThisRound(3, r))).toEqual([3, 3]);
  });
  it('a 7th-level fighter attacks 3 times in 2 rounds', () => {
    const f = combatantFromCharacter(make('human', 'fighter', { level: 7, items: ['longSword'] }));
    expect(f.attacks).toHaveLength(1);
    expect(attacksFor(f, 1) + attacksFor(f, 2)).toBe(3);
  });
  it('haste cast after the combatant exists doubles attacks; slow halves; both cancel', () => {
    const ch = make('human', 'fighter', { level: 7, items: ['longSword'] });
    const f = combatantFromCharacter(ch);
    addEffect(ch, 'hasted', { rounds: 5 });
    expect(attacksFor(f, 1)).toBe(3);
    expect(attacksFor(f, 2)).toBe(3);
    addEffect(ch, 'slowed', { rounds: 5 });
    expect(attacksFor(f, 1) + attacksFor(f, 2)).toBe(3);
  });
  it('monsters obey haste and slow too (a slowed orc swings every other round)', () => {
    const rng = new Rng(2);
    const orc = combatantFromMonster(rng, 'orc', 1);
    expect(attacksFor(orc, 1)).toBe(1);
    addEffect(orc, 'slowed', { rounds: 5 });
    expect([1, 2, 3, 4].map((r) => attacksFor(orc, r))).toEqual([0, 1, 0, 1]);
    const ghoul = combatantFromMonster(rng, 'ghoul', 1);
    addEffect(ghoul, 'hasted', { rounds: 5 });
    expect(attacksFor(ghoul, 1)).toBe(6);
  });
  it('a missile weapon can override the rate (bow from the pack: 2 per round)', () => {
    const f = combatantFromCharacter(make('human', 'fighter', { items: ['longSword'] }));
    expect(attacksFor(f, 1, { weapon: ITEMS.shortBow })).toBe(2);
  });
});

describe('sweep attacks vs creatures under one hit die', () => {
  const rng = new Rng(3);
  const f5 = make('human', 'fighter', { level: 5 });
  it('1-1 HD goblins, kobolds and giant rats are below one HD; orcs and hobgoblins are not', () => {
    expect(belowOneHd(combatantFromMonster(rng, 'goblin'))).toBe(true);
    expect(belowOneHd(combatantFromMonster(rng, 'kobold'))).toBe(true);
    expect(belowOneHd(combatantFromMonster(rng, 'giantRat'))).toBe(true);
    expect(belowOneHd(combatantFromMonster(rng, 'orc'))).toBe(false);
    expect(belowOneHd(combatantFromMonster(rng, 'hobgoblin'))).toBe(false);
  });
  it('a 5th-level fighter sweeps 5 goblins a round', () => {
    expect(sweepAttacks(f5, combatantFromMonster(rng, 'goblin'))).toBe(5);
    expect(sweepAttacks(f5, combatantFromMonster(rng, 'orc'))).toBe(0);
    expect(sweepAttacks(f5, 0.5)).toBe(5);
    expect(sweepAttacks(make('human', 'cleric', { level: 5 }), combatantFromMonster(rng, 'goblin'))).toBe(0);
  });
  it('autoResolve applies the sweep to goblins', () => {
    const party = [combatantFromCharacter(make('human', 'fighter', { level: 6, items: ['longSword'] }))];
    const gobs = Array.from({ length: 6 }, (_, i) => combatantFromMonster(new Rng(10 + i), 'goblin', i + 1));
    const r = autoResolve(new Rng(5), party, gobs, 1);
    const swings = r.log.filter((l) => l.startsWith(party[0].name)).length;
    expect(swings).toBeGreaterThan(1);
  });
});

describe('turn undead', () => {
  it('unknown undead types are never turned as zombies', () => {
    expect(turnNeeded(1, 'bogus')).toBe('-');
    expect(turnNeeded(1, 'zombie')).toBe(13);
  });
});

describe('helpless targets (DMG)', () => {
  const rng = new Rng(11);
  const f = combatantFromCharacter(make('human', 'fighter', { items: ['longSword'] }));
  it("'auto' makes melee hit a sleeper every time; missiles only get +4", () => {
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      const o = combatantFromMonster(rng, 'ogre', 1);
      o.hp.cur = o.hp.max = 500;
      addEffect(o, 'held', { rounds: 10 });
      if (resolveAttack(rng, f, o, { helpless: 'auto' }).hit) hits++;
    }
    expect(hits).toBe(60);
    const o = combatantFromMonster(rng, 'ogre', 1);
    addEffect(o, 'held', { rounds: 10 });
    expect(hitChance(f, o, 0, { helpless: 'auto' })).toBe(1);
    expect(hitChance(f, o, 0, { helpless: 'auto', ranged: true })).toBeLessThan(1);
    expect(hitChance(f, o, 0)).toBeLessThan(1);
  });
  it("'slay' is a coup de grace", () => {
    const o = combatantFromMonster(rng, 'ogre', 1);
    addEffect(o, 'asleep', { rounds: 10 });
    const r = resolveAttack(rng, f, o, { helpless: 'slay' });
    expect(r.coupDeGrace).toBe(true);
    expect(o.status).toBe('dead');
  });
  it('an awake target is not affected by the rule', () => {
    const o = combatantFromMonster(rng, 'ogre', 1);
    expect(hitChance(f, o, 0, { helpless: 'slay' })).toBe(hitChance(f, o, 0));
  });
});

describe('poison during rest', () => {
  it('counts the onset down by the minutes rested instead of killing at once', () => {
    const p = make('human', 'fighter');
    addEffect(p, 'poisoned', { data: { onset: 10 } });
    rest([p], 1);
    expect(p.status).toBe('ok');
    expect(getEffect(p, 'poisoned').data.onset).toBe(9);
    rest([p], 9);
    expect(p.status).toBe('dead');
  });
  it('slow poison holds the onset while it lasts', () => {
    const p = make('human', 'fighter');
    addEffect(p, 'poisoned', { data: { onset: 10 } });
    addEffect(p, 'slowPoison', { rounds: 60 });
    rest([p], 30);
    expect(p.status).toBe('ok');
    expect(getEffect(p, 'poisoned').data.onset).toBe(10);
    rest([p], 35); // 30 more under slow poison, then 5 unprotected
    expect(p.status).toBe('ok');
    expect(getEffect(p, 'poisoned').data.onset).toBe(5);
    rest([p], 5);
    expect(p.status).toBe('dead');
  });
  it('poison() stores the onset that rest and endOfRound count down', () => {
    const t = combatantFromMonster(new Rng(1), 'orc', 1);
    t.saves = { ...t.saves, ppdm: 30 };
    poison(new Rng(1), t, { onset: 4 });
    expect(getEffect(t, 'poisoned').data.onset).toBe(4);
  });
});

describe('spell fidelity', () => {
  const mage = (L) => make('human', 'magicUser', { level: L, abilities: { int: 18, str: 10 } });
  const priest = (L) => make('human', 'cleric', { level: L, abilities: { wis: 16 } });
  const orcs = (n, rng = new Rng(4)) => Array.from({ length: n }, (_, i) => combatantFromMonster(rng, 'orc', i + 1));
  const opts = { ignoreMemory: true, noFailure: true };
  it('hold person: magic-user lone target -3, two -1; cleric lone target -2', () => {
    expect(castSpell(new Rng(1), 'holdPerson', mage(5), orcs(1), opts).results[0].save.bonus).toBe(-3);
    expect(castSpell(new Rng(1), 'holdPerson', mage(5), orcs(2), opts).results.every((r) => !r.save || r.save.bonus === -1)).toBe(true);
    expect(castSpell(new Rng(1), 'holdPerson', priest(3), orcs(1), opts).results[0].save.bonus).toBe(-2);
    expect(castSpell(new Rng(1), 'holdPerson', priest(3), orcs(3), opts).results[0].save.bonus).toBe(0);
  });
  it('hold person range: cleric 6, magic-user 12', () => {
    expect(spellTargeting('holdPerson', 3, 'cleric').range).toBe(6);
    expect(spellTargeting('holdPerson', 5, 'magicUser').range).toBe(12);
  });
  it('sleep bands: up to 1 HD 4d4, 1+1-2 2d4, 2+1-3 1d4, 3+1-4 1-2, 4+1-4+4 0-1', () => {
    expect(SLEEP_BANDS.map((b) => [b.max, b.dice])).toEqual([[1, '4d4'], [2, '2d4'], [3, '1d4'], [4, '1d2'], [4.5, '1d2-1']]);
    const rng = new Rng(9);
    for (let i = 0; i < 20; i++) {
      const lizards = Array.from({ length: 8 }, (_, k) => combatantFromMonster(rng, 'lizardMan', k + 1)); // 2+1 HD
      expect(hitDiceOf(lizards[0])).toBe(2.5);
      const slept = castSpell(rng, 'sleep', mage(1), lizards, opts).results.filter((r) => r.affected).length;
      expect(slept).toBeLessThanOrEqual(4);
      const bugbears = Array.from({ length: 4 }, (_, k) => combatantFromMonster(rng, 'bugbear', k + 1)); // 3+1 HD
      const nb = castSpell(rng, 'sleep', mage(1), bugbears, opts).results.filter((r) => r.affected).length;
      expect(nb).toBeGreaterThanOrEqual(1);
      expect(nb).toBeLessThanOrEqual(2);
    }
  });
  it('dispel magic: +5% per level above, -2% per level below', () => {
    expect(dispelChance(5, 5)).toBe(50);
    expect(dispelChance(7, 5)).toBe(60);
    expect(dispelChance(3, 5)).toBe(46);
    expect(dispelChance(1, 20)).toBe(12);
    expect(dispelChance(30, 1)).toBe(99);
  });
  it('memory is checked unless the caller opts out explicitly', () => {
    const m = mage(1);
    expect(castSpell(new Rng(1), 'magicMissile', m, orcs(1)).reason).toBe('not memorized');
    expect(castSpell(new Rng(1), 'magicMissile', m, orcs(1), { ignoreMemory: true }).ok).toBe(true);
  });
});

describe('cleric spell failure (low wisdom)', () => {
  const cl = (wis, seed = 1) => make('human', 'cleric', { abilities: { wis }, seed });
  it('a WIS 9 cleric fails about 20% of the time; WIS 13 never', () => {
    let fail = 0;
    for (let s = 1; s <= 400; s++) {
      const c = cl(9, s);
      const r = castSpell(new Rng(s), 'bless', c, [c], { ignoreMemory: true });
      if (r.failed) fail++;
    }
    expect(fail).toBeGreaterThan(50);
    expect(fail).toBeLessThan(115);
    let none = 0;
    for (let s = 1; s <= 100; s++) { const c = cl(13, s); if (castSpell(new Rng(s), 'bless', c, [c], { ignoreMemory: true }).failed) none++; }
    expect(none).toBe(0);
  });
  it('a failed spell is still lost from memory; items never fail', () => {
    let seen = false;
    for (let s = 1; s <= 60 && !seen; s++) {
      const c = cl(9, s);
      c.spells.memorized.cleric = ['bless'];
      const r = castSpell(new Rng(s), 'bless', c, [c], { consume: true });
      if (r.failed) {
        seen = true;
        expect(c.spells.memorized.cleric).toEqual([]);
        expect(r.ok).toBe(false);
      }
    }
    expect(seen).toBe(true);
    for (let s = 1; s <= 50; s++) { const c = cl(3, s); expect(castSpell(new Rng(s), 'bless', c, [c], { fromItem: true }).failed).toBeFalsy(); }
  });
});

describe('temple: elves cannot be raised (PHB)', () => {
  it('raise dead is refused for elves, with a reason', () => {
    const e = make('elf', 'fighter', { abilities: { str: 17, dex: 15, con: 16 } });
    e.status = 'dead';
    expect(serviceApplies('raiseDead', e)).toBe(false);
    expect(serviceProblem('raiseDead', e)).toMatch(/Elves/);
    expect(performService(new Rng(1), 'raiseDead', e).ok).toBe(false);
    expect(raiseDead(new Rng(1), e).reason).toBe('elf');
    expect(e.status).toBe('dead');
  });
  it('half-elves and humans can be', () => {
    const h = make('halfElf', 'fighter');
    h.status = 'dead';
    expect(serviceApplies('raiseDead', h)).toBe(true);
    expect(serviceProblem('raiseDead', h)).toBeNull();
  });
});

describe('equipment restrictions', () => {
  it('multiclassed clerics keep the blunt-weapon rule', () => {
    const cf = make('halfElf', 'cleric/fighter');
    expect(canEquip(cf, 'longSword')).toBe(false);
    expect(equipProblem(cf, 'longSword')).toMatch(/clerics/);
    expect(canEquip(cf, 'mace')).toBe(true);
    expect(canEquip(cf, 'sling')).toBe(true);
    const fm = make('halfElf', 'fighter/magicUser');
    expect(canEquip(fm, 'longSword')).toBe(true);
  });
  it('only elves and half-elves can cast in elfin chain', () => {
    const elfChain = Object.keys(ITEMS).find((k) => ITEMS[k].armorGroup === 'elfin');
    if (!elfChain) return;
    const efm = make('elf', 'fighter/magicUser', { abilities: { str: 17, dex: 15, con: 16, int: 17 } });
    addItem(efm, elfChain, { equip: true });
    expect(armorAllowsArcane(efm)).toBe(true);
    const human = make('human', 'magicUser', { abilities: { int: 17 } });
    human.inventory.push({ id: elfChain, equipped: true });
    expect(armorAllowsArcane(human)).toBe(false);
  });
  it('thieves: any alignment but lawful good (PoR)', () => {
    expect(allowedAlignments('thief')).not.toContain('LG');
    expect(allowedAlignments('thief')).toHaveLength(8);
  });
});

describe('memorization is per spell', () => {
  it('spells return one at a time after the rest period; an interrupted rest keeps what was studied', () => {
    const m = make('human', 'magicUser', { level: 3, abilities: { int: 17 } });
    m.spells.book.push('magicMissile', 'sleep', 'shield', 'mirrorImage', 'invisibility');
    prepareSpells(m, 'magicUser', ['magicMissile', 'sleep', 'mirrorImage']);
    expect(memorizationTime(m)).toBe(240 + 15 + 15 + 30);
    let r = rest([m], 240);
    expect(r.memorized[m.id]).toBeUndefined();
    r = rest([m], 15);
    expect(r.memorized[m.id]).toEqual(['magicMissile']);
    expect(memorizationTime(m)).toBe(45);
    r = rest([m], 20);
    expect(r.memorized[m.id]).toEqual(['sleep']);
    r = rest([m], 25);
    expect(r.memorized[m.id]).toEqual(['mirrorImage']);
    expect(m.spells.memorized.magicUser).toEqual(['magicMissile', 'sleep', 'mirrorImage']);
    expect(m.spells.study).toBe(0);
    expect(study(m, 100)).toEqual([]);
  });
});

describe('spell book capacity (INT)', () => {
  it('an INT 9 magic-user can hold at most 6 first-level spells', () => {
    const m = make('human', 'magicUser', { level: 1, abilities: { int: 9 } });
    m.spells.book = ['magicMissile', 'sleep', 'shield', 'readMagic', 'burningHands', 'charmPerson'];
    const r = learnSpell(m, 'enlarge');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no room/);
    m.spells.book.pop();
    expect(learnSpell(m, 'enlarge').ok).toBe(true);
  });
});

describe('treasure type W', () => {
  it('exists with the MM columns and can yield maps', () => {
    expect(TREASURE_TYPES.W).toEqual({ gp: [60, '5d6x1000'], pp: [15, '1d8x100'], gems: [60, '10d8'], jewelry: [50, '5d8'], maps: [55, 1] });
    const rng = new Rng(3);
    let maps = 0;
    let gp = 0;
    for (let i = 0; i < 100; i++) {
      const t = generateTreasure(rng, 'W', { scale: 1 });
      maps += t.maps ?? 0;
      gp += t.coins.gp;
    }
    expect(maps).toBeGreaterThan(35);
    expect(maps).toBeLessThan(75);
    expect(gp).toBeGreaterThan(0);
  });
  it('A through Z are all defined', () => {
    for (const k of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(TREASURE_TYPES[k], k).toBeTruthy();
  });
});

describe('derived stats sanity', () => {
  it('a gnome fighter sheet and combatant agree on AC', () => {
    const g = make('gnome', 'fighter');
    expect(combatantFromCharacter(g).ac).toBe(deriveStats(g).ac);
    expect(hasEffect(g, 'blessed')).toBe(false);
  });
});
