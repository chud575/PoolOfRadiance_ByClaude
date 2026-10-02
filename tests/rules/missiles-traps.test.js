import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, deriveStats, missileProfile, racialWeaponHit, addItem } from '../../src/rules/character.js';
import { combatantFromCharacter, combatantFromMonster, defenderAc, isHurledAttack } from '../../src/rules/combat.js';
import { isThrownWeapon, missileRangeBands, rangeModifier, MISSILE_RANGES } from '../../src/rules/items.js';
import { addEffect, hasEffect, getEffect } from '../../src/rules/conditions.js';
import { TRAPS, trapSpec, springTrap, resolveTrap } from '../../src/rules/explore.js';
import { ITEMS } from '../../src/data/items.js';

/**
 * Missile fire and traps where the PHB/DMG tables meet play: the Shield
 * spell's three armour classes, thrown weapons and STR, racial missile
 * bonuses, PHB range bands, and the trap pipeline (detect, disarm, spring).
 */

const abil = (o = {}) => ({ str: 16, strPct: 0, int: 12, wis: 12, dex: 10, con: 14, cha: 10, ...o });
const mk = (race, classSpec, o = {}) => createCharacter({
  rng: new Rng(o.seed ?? 1), name: o.name ?? `${race} ${classSpec}`, race, classSpec, level: o.level ?? 1,
  abilities: abil(o.abilities), items: o.items ?? [], gender: o.gender,
});

describe('missile weapons (PHB/DMG)', () => {
  it('thrown weapons are the hand-hurled ones', () => {
    for (const id of ['dart', 'dagger', 'handAxe', 'spear']) expect(isThrownWeapon(ITEMS[id])).toBe(true);
    for (const id of ['shortBow', 'longBow', 'lightCrossbow', 'heavyCrossbow', 'sling']) expect(isThrownWeapon(ITEMS[id])).toBe(false);
  });

  it('darts add STR to hit and damage as well as DEX; arrows add DEX only', () => {
    const strong = { str: 18, strPct: 100, dex: 17 }; // 18/00: +3 hit, +6 dmg; DEX 17: +2 missile
    const dart = mk('human', 'fighter', { abilities: strong, items: ['dart'] });
    const d = missileProfile(dart);
    expect(d.thrown).toBe(true);
    expect(d.hitBonus).toBe(2 + 3);
    expect(d.dmgBonus).toBe(6);
    expect(deriveStats(dart).hitBonus).toBe(5); // equipped dart: the sheet agrees
    expect(deriveStats(dart).dmgBonus).toBe(6);
    const bow = mk('human', 'fighter', { abilities: strong, items: ['longBow', 'arrows'] });
    const b = missileProfile(bow);
    expect(b.thrown).toBe(false);
    expect(b.hitBonus).toBe(2);
    expect(b.dmgBonus).toBe(0);
  });

  it('halflings get +3 with slings and bows, elves +1 with bows, not with crossbows', () => {
    expect(racialWeaponHit('halfling', ITEMS.sling)).toBe(3);
    expect(racialWeaponHit('halfling', ITEMS.shortBow)).toBe(3);
    expect(racialWeaponHit('halfling', ITEMS.lightCrossbow)).toBe(0);
    expect(racialWeaponHit('elf', ITEMS.longBow)).toBe(1);
    expect(racialWeaponHit('elf', ITEMS.longSword)).toBe(1);
    expect(racialWeaponHit('dwarf', ITEMS.longBow)).toBe(0);
    const h = mk('halfling', 'fighter', { abilities: { dex: 10, str: 14 }, items: ['longSword'] });
    addItem(h, 'sling');
    // The sling is in the pack while the sword is in hand: battle draws it with the +3.
    expect(missileProfile(h).hitBonus).toBe(3);
  });

  it('a bow with no arrows is no missile weapon', () => {
    const f = mk('human', 'fighter', { items: ['longBow'] });
    expect(missileProfile(f)).toBe(null);
  });

  it('PHB range bands keep the short/medium/long proportions; -2 medium, -5 long', () => {
    expect(MISSILE_RANGES.longBow).toEqual([7, 14, 21]);
    const b = missileRangeBands({ ...ITEMS.shortBow, range: 15 });
    expect(b).toEqual({ short: 5, medium: 10, long: 15 });
    expect(rangeModifier({ ...ITEMS.shortBow, range: 15 }, 5)).toEqual({ band: 'short', mod: 0, inRange: true });
    expect(rangeModifier({ ...ITEMS.shortBow, range: 15 }, 6).mod).toBe(-2);
    expect(rangeModifier({ ...ITEMS.shortBow, range: 15 }, 11).mod).toBe(-5);
    expect(rangeModifier({ ...ITEMS.shortBow, range: 15 }, 16).inRange).toBe(false);
    // Sling 5/10/20: half of its reach is still medium.
    expect(rangeModifier({ ...ITEMS.sling, range: 20 }, 10).band).toBe('medium');
  });
});

describe('Shield spell by kind of attack (PHB)', () => {
  it('a monster throwing javelins is hurled; an archer is not', () => {
    const orc = combatantFromMonster(new Rng(1), 'orc');
    expect(isHurledAttack(orc)).toBe(false);
    expect(isHurledAttack({ ...orc, hurled: true })).toBe(true);
    expect(isHurledAttack({ ...orc, rock: true })).toBe(true);
  });

  it('a shielded fighter with plate keeps his better AC against everything', () => {
    const f = mk('human', 'fighter', { items: ['plateMail', 'shield'] });
    addEffect(f, 'shielded', { rounds: 5 });
    const s = deriveStats(f);
    expect(s.ac).toBe(2);
    expect(s.acMissile).toBe(2);
    expect(s.acHurled).toBe(2);
    const c = combatantFromCharacter(f);
    expect(defenderAc(combatantFromMonster(new Rng(1), 'orc'), c, { ranged: true })).toBe(2);
  });
});

describe('traps', () => {
  const party = () => [
    mk('human', 'fighter', { name: 'Garrick', abilities: { con: 16 }, level: 3, items: ['chainMail'] }),
    mk('dwarf', 'fighter', { name: 'Thorin', abilities: { con: 18 } }),
    mk('halfling', 'thief', { name: 'Pip', abilities: { dex: 18 }, level: 4, items: ['leather'] }),
    mk('human', 'magicUser', { name: 'Ilyra' }),
  ];

  it('every catalogue trap resolves without leaving NaN hit points', () => {
    for (const id of Object.keys(TRAPS)) {
      for (let seed = 0; seed < 40; seed++) {
        const p = party();
        const r = springTrap(new Rng(seed), p, id);
        for (const ch of p) expect(Number.isFinite(ch.hp.cur)).toBe(true);
        expect(r.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('a poisoned needle strikes the lead; the dwarf\'s CON bonus counts, as poison', () => {
    let dwarfSaves = 0;
    let humanSaves = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const [g, d] = party();
      if (springTrap(new Rng(seed), [d], 'poisonNeedle').victims[0].saved) dwarfSaves++;
      if (springTrap(new Rng(seed), [g], 'poisonNeedle').victims[0].saved) humanSaves++;
    }
    // F1 dwarf CON 18: ppdm 14, +5 vs poison → 9 (60%). F3 human: 13 (40%).
    expect(dwarfSaves / 2000).toBeGreaterThan(0.55);
    expect(dwarfSaves / 2000).toBeLessThan(0.65);
    expect(humanSaves / 2000).toBeGreaterThan(0.35);
    expect(humanSaves / 2000).toBeLessThan(0.45);
  });

  it('a failed save against the needle poisons with an onset, it does not kill at once', () => {
    let seen = false;
    for (let seed = 0; seed < 50 && !seen; seed++) {
      const p = party();
      const r = springTrap(new Rng(seed), p, 'poisonNeedle');
      if (r.victims[0].saved) continue;
      seen = true;
      expect(hasEffect(p[0], 'poisoned')).toBe(true);
      expect(getEffect(p[0], 'poisoned').data.onset).toBe(10);
      expect(p[0].status).toBe('ok');
    }
    expect(seen).toBe(true);
  });

  it('a falling block: save for half, damage through the 1e hit point rules', () => {
    const mu = mk('human', 'magicUser', { name: 'Ilyra' });
    mu.hp.cur = 2;
    let dying = 0;
    for (let seed = 0; seed < 200; seed++) {
      const m = mk('human', 'magicUser', { name: 'Ilyra' });
      m.hp.cur = 2;
      const r = springTrap(new Rng(seed), [m], 'fallingBlock');
      const v = r.victims[0];
      if (v.damage > 2) { expect(['dying', 'dead', 'unconscious']).toContain(m.status); dying++; }
      if (v.saved) expect(v.damage).toBeLessThanOrEqual(6);
    }
    expect(dying).toBeGreaterThan(0);
  });

  it('dart traps roll to hit against armour class', () => {
    const hits = (items) => {
      let n = 0;
      let tries = 0;
      for (let seed = 0; seed < 1500; seed++) {
        const v = springTrap(new Rng(seed), [mk('human', 'fighter', { items })], { trap: 'dartVolley', count: 1 }).victims[0];
        tries++;
        if (v.hit) n++;
      }
      return n / tries;
    };
    const naked = hits([]);
    const plate = hits(['plateMail', 'shield']);
    // THAC0 16: vs AC 10 needs 6 (75%), vs AC 2 needs 14 (35%).
    expect(naked).toBeGreaterThan(0.7);
    expect(plate).toBeLessThan(0.4);
  });

  it('Find Traps reveals; a thief disarms; a disarmed trap stays disarmed', () => {
    const p = party();
    const [, , thief] = p;
    const trap = { trap: 'scythingBlade' };
    let r;
    let seed = 0;
    do r = resolveTrap(new Rng(seed++), p, { ...trap }); while (!r.removed && seed < 200);
    expect(r.removed).toBe(true);
    expect(r.by).toBe(thief);
    const state = { trap: 'pit' };
    addEffect(p[3], 'findTraps', { rounds: 30 });
    const first = resolveTrap(new Rng(3), p, state);
    expect(first.detected).toBe(true);
    expect(state.found).toBe(true);
    if (first.removed) {
      const again = resolveTrap(new Rng(4), p, state);
      expect(again.sprung).toBe(false);
      expect(again.detected).toBe(false);
    }
  });

  it('an unseen trap springs once; a one-shot trap does nothing the second time', () => {
    const p = [mk('human', 'fighter', { name: 'Garrick' })]; // no thief, no dwarf, no spell
    const state = { trap: 'fallingBlock' };
    const r = resolveTrap(new Rng(1), p, state);
    expect(r.sprung).toBe(true);
    expect(state.sprung).toBe(true);
    expect(resolveTrap(new Rng(2), p, state).sprung).toBe(false);
  });

  it('a dwarf senses traps in stonework about half the time', () => {
    let sensed = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const r = resolveTrap(new Rng(seed), [mk('dwarf', 'fighter', { name: 'Thorin' })], { trap: 'pit' }, { avoidable: true });
      if (r.detected) sensed++;
    }
    expect(sensed / 2000).toBeGreaterThan(0.45);
    expect(sensed / 2000).toBeLessThan(0.55);
  });

  it('trapSpec merges an event\'s overrides over the catalogue', () => {
    const t = trapSpec({ trap: 'fireGlyph', dice: '4d4' });
    expect(t.dice).toBe('4d4');
    expect(t.save.type).toBe('half');
    expect(trapSpec('alarm').alarm).toBe(true);
  });
});
