import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { buildParty } from '../../src/rules/party.js';
import { applyDamage } from '../../src/rules/character.js';
import { addEffect, hasEffect } from '../../src/rules/conditions.js';
import { TEMPLE_SERVICES, serviceApplies, performService } from '../../src/rules/temple.js';

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
