import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { buildParty } from '../../src/rules/party.js';
import { applyDamage } from '../../src/rules/character.js';
import { addEffect, hasEffect } from '../../src/rules/conditions.js';
import { TEMPLE_SERVICES, serviceApplies, performService, serviceProblem, raiseAllowed } from '../../src/rules/temple.js';

describe('temple services', () => {
  it('heals and cures', () => {
    const rng = new Rng(1);
    const [f] = buildParty('default', 1);
    expect(serviceApplies('cureLight', f)).toBe(false);
    f.hp.cur = 1;
    expect(serviceApplies('cureLight', f)).toBe(true);
    expect(performService(rng, 'heal', f).ok).toBe(true);
    expect(f.hp.cur).toBe(f.hp.max);
    addEffect(f, 'poisoned');
    addEffect(f, 'slowPoison');
    expect(performService(rng, 'neutralizePoison', f).ok).toBe(true);
    expect(hasEffect(f, 'poisoned')).toBe(false);
    expect(hasEffect(f, 'slowPoison')).toBe(false);
  });
  it('raises the dead, identifies items, refuses nonsense', () => {
    const rng = new Rng(2);
    const party = buildParty('default', 1);
    const d = party[3]; // CON 18 dwarf: 100% survival
    applyDamage(d, 100);
    expect(serviceApplies('cureLight', d)).toBe(false);
    expect(serviceApplies('raiseDead', d)).toBe(true);
    const r = performService(rng, 'raiseDead', d);
    expect(r.ok).toBe(true);
    expect(d.status).toBe('ok');
    const v = buildParty('veterans', 1)[0];
    v.inventory[0].identified = false;
    expect(performService(rng, 'identify', v).text).toMatch(/Long Sword \+1/);
    expect(performService(rng, 'stoneToFlesh', v).ok).toBe(false);
    for (const s of Object.values(TEMPLE_SERVICES)) expect(s.cost).toBeGreaterThan(0);
  });
});

describe('temple services in detail', () => {
  const party = () => buildParty('default', 3);

  it('every service has a name and a price; healing services carry their dice', () => {
    for (const [id, s] of Object.entries(TEMPLE_SERVICES)) {
      expect(s.name, id).toBeTruthy();
      expect(s.cost, id).toBeGreaterThan(0);
    }
    expect(TEMPLE_SERVICES.cureLight.heal).toBe('1d8');
    expect(TEMPLE_SERVICES.cureSerious.heal).toBe('2d8+1');
    expect(TEMPLE_SERVICES.cureCritical.heal).toBe('3d8+3');
  });

  it('cures never exceed maximum hit points and revive the unconscious', () => {
    const rng = new Rng(4);
    const [f] = party();
    f.hp.cur = f.hp.max - 1;
    performService(rng, 'cureCritical', f);
    expect(f.hp.cur).toBe(f.hp.max);
    applyDamage(f, f.hp.max); // to 0: unconscious
    expect(f.status).toBe('unconscious');
    expect(performService(rng, 'cureLight', f).ok).toBe(true);
    expect(f.status).toBe('ok');
    expect(f.hp.cur).toBeGreaterThan(0);
  });

  it('the dead cannot be cured, only raised; a raise costs a point of CON', () => {
    const rng = new Rng(5);
    const d = party()[3]; // dwarf, CON 18
    const con = d.abilities.con;
    applyDamage(d, 100);
    expect(serviceApplies('cureCritical', d)).toBe(false);
    expect(serviceApplies('heal', d)).toBe(false);
    expect(performService(rng, 'heal', d).ok).toBe(false);
    const r = performService(rng, 'raiseDead', d);
    expect(r.ok).toBe(true);
    expect(d.abilities.con).toBe(con - 1);
    expect(d.hp.cur).toBe(1);
  });

  it('elves cannot be raised: the service says why', () => {
    const elf = party()[2];
    expect(elf.race).toBe('elf');
    applyDamage(elf, 100);
    expect(serviceApplies('raiseDead', elf)).toBe(false);
    expect(serviceProblem('raiseDead', elf)).toMatch(/Elves/);
    expect(raiseAllowed(elf)).toBe(false);
  });

  it('a failed resurrection survival roll loses the character for good', () => {
    let lost = 0;
    for (let s = 1; s <= 60; s++) {
      const ch = party()[0];
      ch.abilities.con = 3; // 40% survival
      applyDamage(ch, 100);
      const r = performService(new Rng(s), 'raiseDead', ch);
      if (!r.ok) { lost++; expect(ch.status).toBe('gone'); expect(serviceApplies('raiseDead', ch)).toBe(false); }
    }
    expect(lost).toBeGreaterThan(15);
  });

  it('cure blindness, cure disease and remove curse (incl. cursed gear)', () => {
    const rng = new Rng(6);
    const [f] = party();
    addEffect(f, 'blinded');
    addEffect(f, 'diseased');
    expect(serviceApplies('removeCurse', f)).toBe(false);
    f.inventory.push({ id: 'longSword', qty: 1, identified: true, equipped: false, cursed: true, magic: -1 });
    addEffect(f, 'cursed', { rounds: 10 });
    expect(serviceApplies('removeCurse', f)).toBe(true);
    expect(performService(rng, 'cureBlindness', f).ok).toBe(true);
    expect(performService(rng, 'cureDisease', f).ok).toBe(true);
    expect(performService(rng, 'removeCurse', f).ok).toBe(true);
    expect(hasEffect(f, 'blinded') || hasEffect(f, 'diseased') || hasEffect(f, 'cursed')).toBe(false);
    expect(f.inventory.some((e) => e.cursed)).toBe(false);
    expect(serviceProblem('cureBlindness', f)).toBe('Not needed.');
  });

  it('stone to flesh needs a system shock roll; identify names the first unknown item', () => {
    const ch = party()[3];
    ch.status = 'stoned';
    expect(serviceApplies('stoneToFlesh', ch)).toBe(true);
    expect(serviceApplies('cureLight', ch)).toBe(false);
    const r = performService(new Rng(1), 'stoneToFlesh', ch);
    expect(['ok', 'dead']).toContain(ch.status);
    expect(r.ok).toBe(ch.status === 'ok');
    const v = buildParty('veterans', 1)[0];
    for (const e of v.inventory) e.identified = true;
    expect(serviceApplies('identify', v)).toBe(false);
    v.inventory[0].identified = false;
    expect(serviceApplies('identify', v)).toBe(true);
    performService(new Rng(1), 'identify', v);
    expect(v.inventory[0].identified).toBe(true);
    expect(serviceProblem('nope', v)).toBe('unknown service');
  });
});
