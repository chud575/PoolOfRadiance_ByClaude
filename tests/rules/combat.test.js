import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { buildParty } from '../../src/rules/party.js';
import { createCharacter, applyDamage } from '../../src/rules/character.js';
import {
  combatantFromCharacter, combatantFromMonster, rollInitiative, resolveAttack, toHitNeeded, autoResolve, xpForVictory, canAct,
  hitChance, turnUndead, savingThrow, poison, endOfRound, endCombat, rollSurprise, sweepAttacks, attacksFor, dealDamage, isDown,
  moraleCheck, liveMods,
} from '../../src/rules/combat.js';
import { addEffect, hasEffect, getEffect } from '../../src/rules/conditions.js';
import { castSpell } from '../../src/rules/spells.js';
import { MONSTERS } from '../../src/data/monsters.js';

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });

describe('combatants', () => {
  it('to-hit math', () => {
    expect(toHitNeeded({ thac0: 20, hitBonus: 0 }, { ac: 7 })).toBe(13);
    expect(toHitNeeded({ thac0: 18, hitBonus: 2 }, { ac: 3 })).toBe(13);
    expect(toHitNeeded({ thac0: 20, hitBonus: 0 }, { ac: -3 })).toBe(20);
  });
  it('every monster in the data can be built', () => {
    const rng = new Rng(1);
    for (const id of Object.keys(MONSTERS)) {
      const m = combatantFromMonster(rng, id, 1);
      expect(m.hp.cur).toBeGreaterThan(0);
      expect(m.saves.ppdm).toBeGreaterThan(0);
      expect(m.effects).toEqual([]);
    }
  });
  it('party combatants share hp, conditions and effects', () => {
    const ch = buildParty('default', 1)[0];
    const c = combatantFromCharacter(ch);
    dealDamage(c, 2);
    expect(ch.hp.cur).toBe(ch.hp.max - 2);
    addEffect(ch, 'blessed');
    expect(c.conditions).toContain('blessed');
    expect(c.effects).toBe(ch.effects);
  });
  it('initiative orders all living combatants', () => {
    const rng = new Rng(9);
    const party = buildParty('default', 1).map(combatantFromCharacter);
    const mons = [0, 1, 2].map((i) => combatantFromMonster(rng, 'kobold', i + 1));
    const order = rollInitiative(rng, [...party, ...mons]);
    expect(order.length).toBe(9);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].initiative).toBeGreaterThanOrEqual(order[i].initiative);
  });
  it('incapacitated creatures cannot act', () => {
    const rng = new Rng(2);
    const [k] = [combatantFromMonster(rng, 'kobold', 1)];
    expect(canAct(k)).toBe(true);
    addEffect(k, 'held', { rounds: 2 });
    expect(canAct(k)).toBe(false);
    const ch = buildParty('default', 1)[0];
    const c = combatantFromCharacter(ch);
    addEffect(ch, 'nauseous', { rounds: 2 });
    expect(canAct(c)).toBe(false);
  });
});

describe('attacks', () => {
  it('attacks damage targets and party beats kobolds', () => {
    const rng = new Rng(11);
    const party = buildParty('default', 1).map(combatantFromCharacter);
    const mons = Array.from({ length: 6 }, (_, i) => combatantFromMonster(rng, 'kobold', i + 1));
    const r = resolveAttack(rng, party[0], mons[0]);
    expect(r.roll).toBeGreaterThanOrEqual(1);
    const res = autoResolve(rng, party, mons);
    expect(res.winner).toBe('party');
    expect(xpForVictory(mons)).toBe(42);
    expect(res.log.length).toBeGreaterThan(0);
  });
  it('helpless targets are easier to hit', () => {
    const rng = new Rng(3);
    const f = combatantFromCharacter(buildParty('default', 1)[0]);
    const o = combatantFromMonster(rng, 'orc', 1);
    const p0 = hitChance(f, o);
    addEffect(o, 'asleep');
    expect(hitChance(f, o)).toBeCloseTo(Math.min(0.95, p0 + 0.2));
  });
  it('bless cast mid-battle applies to an existing combatant exactly once', () => {
    const rng = new Rng(4);
    const ch = buildParty('default', 1)[0];
    const f = combatantFromCharacter(ch);
    const o = combatantFromMonster(rng, 'orc', 1);
    const before = hitChance(f, o);
    castSpell(rng, 'bless', buildParty('default', 1)[1], [f]);
    expect(liveMods(f, o).hit).toBe(1);
    expect(hitChance(f, o)).toBeCloseTo(before + 0.05);
  });
  it('shield, invisibility, prot. from evil and blink on defenders', () => {
    const rng = new Rng(5);
    const mage = combatantFromCharacter(buildParty('default', 1)[5]);
    const orc = combatantFromMonster(rng, 'orc', 1);
    const base = hitChance(orc, mage);
    addEffect(mage.ref, 'protEvil', { rounds: 5 });
    expect(hitChance(orc, mage)).toBeCloseTo(base - 0.1);
    addEffect(mage.ref, 'shielded', { rounds: 5 });
    expect(liveMods(orc, mage).ac).toBeLessThan(0);
    addEffect(mage.ref, 'blinking', { rounds: 5 });
    let blinked = 0;
    for (let i = 0; i < 200; i++) if (resolveAttack(rng, orc, mage).blinked) blinked++;
    expect(blinked).toBeGreaterThan(70);
  });
  it('mirror images absorb hits', () => {
    const rng = new Rng(6);
    const mage = combatantFromCharacter(buildParty('default', 1)[5]);
    mage.hp.cur = 1000;
    mage.hp.max = 1000;
    const orc = combatantFromMonster(rng, 'orc', 1);
    addEffect(mage.ref, 'mirrorImage', { rounds: 10, data: { images: 3 } });
    let images = 0;
    for (let i = 0; i < 50 && hasEffect(mage.ref, 'mirrorImage') && getEffect(mage.ref, 'mirrorImage').data.images > 0; i++) {
      if (resolveAttack(rng, orc, mage, { mods: 20 }).image) images++;
    }
    expect(images).toBe(3);
  });
  it('protection from normal missiles', () => {
    const rng = new Rng(7);
    const t = combatantFromMonster(rng, 'orc', 1);
    addEffect(t, 'protNormalMissiles');
    const archer = { ...combatantFromMonster(rng, 'orc', 2), ranged: true };
    const r = resolveAttack(rng, archer, t, { mods: 20 });
    expect(r.immune).toBe(true);
    expect(r.damage).toBe(0);
  });
  it('attacking breaks the attacker\'s invisibility', () => {
    const rng = new Rng(8);
    const k = combatantFromMonster(rng, 'kobold', 1);
    const o = combatantFromMonster(rng, 'orc', 1);
    addEffect(k, 'invisible');
    resolveAttack(rng, k, o);
    expect(hasEffect(k, 'invisible')).toBe(false);
  });
  it('fighters sweep low-HD foes; 3/2 attacks alternate', () => {
    const ch = createCharacter({ rng: new Rng(1), name: 'F', race: 'human', classSpec: 'fighter', abilities: abil({ str: 16 }), level: 7 });
    expect(sweepAttacks(ch, 0.5)).toBe(7);
    expect(sweepAttacks(ch, 1)).toBe(0);
    const c = combatantFromCharacter(ch);
    expect([1, 2, 3, 4].map((r) => attacksFor(c, r))).toEqual([1, 2, 1, 2]);
  });
});

describe('saves, poison, turning, upkeep', () => {
  it('monster saves include effects', () => {
    const rng = new Rng(9);
    const o = combatantFromMonster(rng, 'orc', 1);
    addEffect(o, 'prayerFoe');
    const r = savingThrow(rng, o, 'sp');
    expect(r.target).toBe(o.saves.sp + 1);
  });
  it('poison: deadly after onset unless slowed', () => {
    const rng = new Rng(10);
    let poisoned = null;
    for (let i = 0; i < 40 && !poisoned; i++) {
      const ch = buildParty('default', 1)[5];
      const c = combatantFromCharacter(ch);
      const r = poison(rng, c, { onset: 2 });
      if (!r.saved) poisoned = c;
    }
    expect(poisoned).toBeTruthy();
    expect(hasEffect(poisoned.ref, 'poisoned')).toBe(true);
    endOfRound(poisoned);
    expect(poisoned.ref.status).toBe('ok');
    const out = endOfRound(poisoned);
    expect(out.poisonDeath).toBe(true);
    expect(poisoned.ref.status).toBe('dead');
    const o = combatantFromMonster(rng, 'orc', 1);
    const r = poison(rng, o, { mode: 'damage', damage: '1d4', saveMod: -20 });
    expect(r.damage).toBeGreaterThan(0);
  });
  it('end of round: bleeding and effect expiry', () => {
    const ch = buildParty('default', 1)[0];
    const c = combatantFromCharacter(ch);
    applyDamage(ch, ch.hp.cur + 2);
    addEffect(ch, 'blessed', { rounds: 1 });
    const r = endOfRound(c);
    expect(r.bled).toBe(true);
    expect(ch.hp.cur).toBe(-3);
    expect(r.expired).toEqual(['blessed']);
    expect(ch.conditions).not.toContain('blessed');
  });
  it('end of combat clears transient effects', () => {
    const ch = buildParty('default', 1)[0];
    addEffect(ch, 'blessed');
    addEffect(ch, 'diseased');
    endCombat([combatantFromCharacter(ch)]);
    expect(ch.conditions).toEqual(['diseased']);
  });
  it('turn undead', () => {
    const rng = new Rng(12);
    expect(turnUndead(rng, 1, 'ghast').result).toBe('none');
    expect(turnUndead(rng, 4, 'skeleton').result).toBe('turned');
    expect(turnUndead(rng, 6, 'skeleton').result).toBe('destroyed');
    const dstar = turnUndead(rng, 9, 'skeleton');
    expect(dstar.result).toBe('destroyed');
    expect(dstar.count).toBeGreaterThanOrEqual(7);
    let ok = 0;
    for (let i = 0; i < 200; i++) if (turnUndead(rng, 1, 'skeleton').result === 'turned') ok++;
    expect(ok).toBeGreaterThan(90); // needs 10+: 55%
    expect(ok).toBeLessThan(130);
  });
  it('surprise and morale', () => {
    const rng = new Rng(13);
    let p = 0;
    for (let i = 0; i < 300; i++) if (rollSurprise(rng).party) p++;
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(110);
    const k = combatantFromMonster(rng, 'skeleton', 1);
    expect(moraleCheck(rng, k)).toBe(true);
  });
  it('down detection', () => {
    const k = combatantFromMonster(new Rng(1), 'kobold', 1);
    dealDamage(k, 99);
    expect(isDown(k)).toBe(true);
    expect(k.status).toBe('dead');
  });
});
