import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { buildParty } from '../../src/rules/party.js';
import { combatantFromCharacter, combatantFromMonster, rollInitiative, resolveAttack, toHitNeeded, autoResolve, xpForVictory } from '../../src/rules/combat.js';

describe('combat', () => {
  it('to-hit math', () => {
    expect(toHitNeeded({ thac0: 20, hitBonus: 0 }, { ac: 7 })).toBe(13);
    expect(toHitNeeded({ thac0: 18, hitBonus: 2 }, { ac: 3 })).toBe(13);
  });
  it('initiative orders all living combatants', () => {
    const rng = new Rng(9);
    const party = buildParty('default', 1).map(combatantFromCharacter);
    const mons = [0, 1, 2].map((i) => combatantFromMonster(rng, 'kobold', i + 1));
    const order = rollInitiative(rng, [...party, ...mons]);
    expect(order.length).toBe(9);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].initiative).toBeGreaterThanOrEqual(order[i].initiative);
  });
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
});
