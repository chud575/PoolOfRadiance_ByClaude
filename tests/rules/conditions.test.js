import { describe, it, expect } from 'vitest';
import {
  addEffect, removeEffect, hasEffect, getEffect, effectMods, tickEffects, onDamaged, onAttacked, isIncapacitated, isHelpless,
  conditionsAllowCasting, clearCombatEffects, describeEffects, conditionIds, CONDITIONS,
} from '../../src/rules/conditions.js';

describe('effects store', () => {
  it('adds, refreshes and removes, mirroring condition strings', () => {
    const t = {};
    addEffect(t, 'blessed', { rounds: 3, source: 'bless' });
    expect(t.conditions).toEqual(['blessed']);
    expect(hasEffect(t, 'blessed')).toBe(true);
    addEffect(t, 'blessed', { rounds: 6 });
    expect(t.effects.length).toBe(1);
    expect(getEffect(t, 'blessed').rounds).toBe(6);
    addEffect(t, 'blessed', { rounds: 2 });
    expect(getEffect(t, 'blessed').rounds).toBe(6);
    expect(removeEffect(t, 'blessed')).toBe(true);
    expect(t.conditions).toEqual([]);
    expect(removeEffect(t, 'blessed')).toBe(false);
  });
  it('plain condition strings count too', () => {
    const t = { conditions: ['asleep'] };
    expect(hasEffect(t, 'asleep')).toBe(true);
    expect(isIncapacitated(t)).toBe(true);
    expect(isHelpless(t)).toBe(true);
    expect(conditionIds(t)).toEqual(['asleep']);
  });
  it('ticks and expires', () => {
    const t = {};
    addEffect(t, 'blessed', { rounds: 2 });
    addEffect(t, 'poisoned');
    expect(tickEffects(t)).toEqual([]);
    expect(tickEffects(t)).toEqual(['blessed']);
    expect(hasEffect(t, 'poisoned')).toBe(true);
    expect(tickEffects(t, 1000)).toEqual([]);
  });
});

describe('modifiers', () => {
  it('aggregates hit/dmg/save and caps', () => {
    const t = {};
    addEffect(t, 'blessed');
    addEffect(t, 'prayer');
    addEffect(t, 'shielded');
    addEffect(t, 'resistFire');
    const m = effectMods(t);
    expect(m.hit).toBe(2);
    expect(m.dmg).toBe(1);
    expect(m.save).toBe(2); // prayer +1, shield +1 (PHB)
    expect(m.acVsMissile).toBe(3);
    expect(m.acVsHurled).toBe(2);
    expect(m.acVsMelee).toBe(4);
    expect(m.immune.has('magicMissile')).toBe(true);
    expect(m.resist.fire).toBe(0.5);
    expect(m.saveVsElement.fire).toBe(3);
  });
  it('per-instance mods override defaults', () => {
    const t = {};
    addEffect(t, 'enlarged', { mods: { dmg: 0, strSet: { str: 18, strPct: 50 } } });
    const m = effectMods(t);
    expect(m.dmg).toBe(0);
    expect(m.strSet).toEqual({ str: 18, strPct: 50 });
  });
  it('haste and slow cancel', () => {
    const t = {};
    addEffect(t, 'hasted');
    expect(effectMods(t).attackMult).toBe(2);
    addEffect(t, 'slowed');
    expect(effectMods(t).attackMult).toBe(1);
    expect(effectMods(t).moveMult).toBe(1);
  });
  it('mirror images are counted from data', () => {
    const t = {};
    addEffect(t, 'mirrorImage', { data: { images: 3 } });
    expect(effectMods(t).images).toBe(3);
  });
});

describe('triggers', () => {
  it('damage wakes sleepers but not the held', () => {
    const t = {};
    addEffect(t, 'asleep');
    addEffect(t, 'held');
    expect(onDamaged(t)).toEqual(['asleep']);
    expect(hasEffect(t, 'held')).toBe(true);
  });
  it('attacking breaks invisibility', () => {
    const t = {};
    addEffect(t, 'invisible');
    expect(onAttacked(t)).toEqual(['invisible']);
  });
  it('casting is blocked by silence and incapacitation', () => {
    const t = {};
    expect(conditionsAllowCasting(t)).toBe(true);
    addEffect(t, 'silenced');
    expect(conditionsAllowCasting(t)).toBe(false);
  });
  it('clears combat-only effects after battle', () => {
    const t = {};
    for (const id of ['blessed', 'held', 'charmed', 'poisoned', 'diseased', 'mirrorImage']) addEffect(t, id);
    clearCombatEffects(t);
    expect(conditionIds(t).sort()).toEqual(['diseased', 'poisoned']);
  });
  it('describes effects for tooltips', () => {
    const t = {};
    addEffect(t, 'blessed', { rounds: 4 });
    expect(describeEffects(t)).toEqual([{ id: 'blessed', name: 'Blessed', desc: CONDITIONS.blessed.desc, kind: 'buff', rounds: 4 }]);
  });
});
