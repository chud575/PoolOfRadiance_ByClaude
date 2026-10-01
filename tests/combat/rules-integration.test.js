import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter } from '../../src/rules/character.js';
import { buildParty } from '../../src/rules/party.js';
import { combatantFromCharacter, combatantFromMonster } from '../../src/rules/combat.js';
import { addEffect, hasEffect, getEffect } from '../../src/rules/conditions.js';
import { fxView, castInBattle } from '../../src/rules/battle.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';

/**
 * The rules engine and the tactical CombatEngine must agree: attack counts
 * (3/2 fighters, haste, slow, sweeps), spells cast through the rules,
 * timed conditions (c.fx is a view over rules effects), racial AC, the
 * helpless coup de grace, bleeding and expiry.
 */

const abil = (o = {}) => ({ str: 17, strPct: 0, int: 12, wis: 14, dex: 10, con: 15, cha: 10, ...o });
const pc = (race, classSpec, o = {}) => combatantFromCharacter(createCharacter({
  rng: new Rng(o.seed ?? 5), name: o.name ?? `${race} ${classSpec}`, race, classSpec, level: o.level ?? 1, abilities: abil(o.abilities), items: o.items ?? [],
}));

function battle(party, monsterIds, seed = 3) {
  const rng = new Rng(seed);
  const field = new Battlefield(null, { x: 0, y: 0 });
  const mons = monsterIds.map((id, i) => combatantFromMonster(rng, id, i + 1));
  party.forEach((c, i) => Object.assign(c, { x: 5, y: 3 + i }));
  mons.forEach((c, i) => Object.assign(c, { x: 6, y: 3 + i }));
  const engine = new CombatEngine({ rng, field, party, monsters: mons });
  return { engine, mons, rng };
}

/** Start c's turn in `round` the way nextTurn does. */
function turnOf(engine, c, round) {
  engine.round = round;
  engine.order = [c, ...engine.all.filter((o) => o !== c)];
  engine.turnIdx = -1;
  c._actedRound = 0;
  for (const o of engine.all) if (o !== c) o._actedRound = round;
  return engine.nextTurn();
}

const tough = (m) => { m.hp.cur = m.hp.max = 999; return m; };

describe('attack counts in the tactical engine', () => {
  it('a 7th-level fighter attacks 3 times over 2 rounds', () => {
    const f = pc('human', 'fighter', { level: 7, items: ['longSword'] });
    const { engine, mons } = battle([f], ['ogre']);
    tough(mons[0]);
    let swings = 0;
    for (const round of [1, 2]) {
      turnOf(engine, f, round);
      expect(engine.active()).toBe(f);
      swings += engine.attack(f, mons[0]).filter((e) => e.type === 'attack').length;
    }
    expect(swings).toBe(3);
  });

  it('haste cast through the engine doubles the fighter on the next turn', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    const mage = pc('human', 'magicUser', { level: 5, abilities: { int: 18, str: 9 } });
    const { engine } = battle([f, mage], ['ogre']);
    turnOf(engine, f, 1);
    expect(f.attacksLeft).toBe(1);
    const mvBefore = f.mp;
    turnOf(engine, mage, 1);
    const ev = engine.cast(mage, 'haste', { x: mage.x, y: mage.y }, { free: true });
    expect(ev[0].type).toBe('cast');
    expect(hasEffect(f.ref, 'hasted')).toBe(true);
    expect(f.fx.hasted).toBeGreaterThan(0);
    turnOf(engine, f, 2);
    expect(f.attacksLeft).toBe(2);
    expect(f.mp).toBe(mvBefore * 2);
  });

  it('a slowed orc attacks only every other round and moves half as far', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    const { engine, mons } = battle([f], ['orc']);
    const orc = mons[0];
    turnOf(engine, orc, 1);
    const fullMove = orc.mp;
    addEffect(orc, 'slowed', { rounds: 10 });
    turnOf(engine, orc, 1);
    expect(orc.attacksLeft).toBe(0);
    expect(orc.mp).toBe(Math.round(fullMove / 2));
    turnOf(engine, orc, 2);
    expect(orc.attacksLeft).toBe(1);
  });

  it('a fighter sweeps 1-1 HD goblins', () => {
    const f = pc('human', 'fighter', { level: 4, items: ['longSword'] });
    const { engine, mons } = battle([f], ['goblin']);
    tough(mons[0]);
    turnOf(engine, f, 1);
    expect(engine.preview(f, mons[0]).attacks).toBe(4);
    const swings = engine.attack(f, mons[0]).filter((e) => e.type === 'attack').length;
    expect(swings).toBe(4);
  });
});

describe('spells through the rules castSpell', () => {
  it('bless cast in battle raises the previewed hit chance by 5%', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    const cleric = pc('human', 'cleric', { abilities: { wis: 16 } });
    const { engine, mons } = battle([f, cleric], ['orc']);
    const before = engine.preview(f, mons[0]).chance;
    turnOf(engine, cleric, 1);
    const ev = engine.cast(cleric, 'bless', { x: cleric.x, y: cleric.y }, { free: true });
    expect(ev[0].hits.some((h) => h.id === f.id)).toBe(true);
    expect(f.fx.blessed).toBe(6);
    expect(engine.preview(f, mons[0]).chance).toBeCloseTo(before + 0.05);
    expect(engine.preview(f, mons[0]).notes).toContain('bless');
  });

  it('sleep puts kobolds down and a melee blow slays a sleeper outright', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    const mage = pc('human', 'magicUser', { abilities: { int: 17, str: 9 } });
    const { engine, mons } = battle([f, mage], ['kobold', 'kobold', 'kobold']);
    mons.forEach((m, i) => Object.assign(m, { x: 9, y: 3 + i }));
    turnOf(engine, mage, 1);
    const ev = engine.cast(mage, 'sleep', { x: 9, y: 4 }, { free: true });
    const slept = ev[0].hits.filter((h) => h.effect === 'asleep').map((h) => engine.byId(h.id));
    expect(slept.length).toBeGreaterThan(0);
    const k = slept[0];
    expect(k.fx.asleep).toBeGreaterThan(0);
    expect(engine.awake(k)).toBe(false);
    tough(k);
    Object.assign(k, { x: 6, y: 3 });
    turnOf(engine, f, 1);
    expect(engine.preview(f, k).chance).toBe(1);
    const strike = engine.attack(f, k).find((e) => e.type === 'attack');
    expect(strike.hit).toBe(true);
    expect(k.status).toBe('dead');
  });

  it('stinking cloud nauseates through the rules and lingers as an area', () => {
    const mage = pc('human', 'magicUser', { level: 3, abilities: { int: 17, str: 9 } });
    const { engine, mons } = battle([mage], ['orc', 'orc']);
    mons.forEach((m, i) => Object.assign(m, { x: 8, y: 3 + i }));
    turnOf(engine, mage, 1);
    const ev = engine.cast(mage, 'stinkingCloud', { x: 8, y: 3 }, { free: true });
    expect(ev[0].type).toBe('cast');
    expect(engine.areas.length).toBe(1);
    for (const h of ev[0].hits.filter((x) => x.effect === 'nauseous')) expect(hasEffect(engine.byId(h.id), 'nauseous')).toBe(true);
  });

  it('a low-wisdom cleric can fail in battle; the spell is spent', () => {
    let failed = false;
    for (let seed = 1; seed < 80 && !failed; seed++) {
      const cleric = pc('human', 'cleric', { abilities: { wis: 9 }, seed });
      cleric.ref.spells.memorized.cleric = ['bless'];
      const { engine } = battle([cleric], ['orc'], seed);
      turnOf(engine, cleric, 1);
      const ev = engine.cast(cleric, 'bless', { x: cleric.x, y: cleric.y });
      expect(cleric.ref.spells.memorized.cleric).toEqual([]);
      if (ev[0].failed) {
        failed = true;
        expect(hasEffect(cleric.ref, 'blessed')).toBe(false);
      }
    }
    expect(failed).toBe(true);
  });

  it('charm person turns a foe to the caster\'s side', () => {
    let charmed = false;
    for (let seed = 1; seed < 30 && !charmed; seed++) {
      const mage = pc('human', 'magicUser', { abilities: { int: 17, str: 9 }, seed });
      const { engine, mons } = battle([mage], ['orc', 'orc'], seed);
      turnOf(engine, mage, 1);
      const ev = engine.cast(mage, 'charmPerson', { x: mons[0].x, y: mons[0].y }, { free: true });
      if (ev[0].hits[0].effect === 'charmed') {
        charmed = true;
        expect(mons[0].side).toBe('party');
        expect(hasEffect(mons[0], 'charmed')).toBe(true);
      }
    }
    expect(charmed).toBe(true);
  });

  it('castInBattle maps rules results to scene hits', () => {
    const mage = pc('human', 'magicUser', { level: 3, abilities: { int: 17, str: 9 } });
    const orc = combatantFromMonster(new Rng(1), 'orc', 1);
    orc.hp.cur = orc.hp.max = 50;
    const r = castInBattle(new Rng(2), 'magicMissile', mage, [orc]);
    expect(r.ok).toBe(true);
    expect(r.hits[0].id).toBe(orc.id);
    expect(r.hits[0].bolts).toHaveLength(2);
    expect(r.hits[0].dmg).toBe(50 - orc.hp.cur);
  });
});

describe('conditions are shared state', () => {
  it('c.fx is a live view over rules effects (both directions)', () => {
    const orc = combatantFromMonster(new Rng(1), 'orc', 1);
    const fx = fxView(orc);
    addEffect(orc, 'blessed', { rounds: 4 });
    expect(fx.blessed).toBe(4);
    expect(Object.keys(fx)).toContain('blessed');
    fx.held = 3;
    expect(getEffect(orc, 'held').rounds).toBe(3);
    expect(orc.conditions).toContain('held');
    delete fx.held;
    expect(hasEffect(orc, 'held')).toBe(false);
    fx.prot = 5;
    expect(hasEffect(orc, 'protEvil')).toBe(true);
    expect(Object.keys(fx)).toContain('prot');
    fx.aooUsed = 2;
    expect(fx.aooUsed).toBe(2);
    expect(hasEffect(orc, 'aooUsed')).toBe(false);
  });

  it('effects tick down at the end of the round and sleepers wake', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    const { engine, mons } = battle([f], ['orc']);
    mons[0].fx.asleep = 2;
    engine.round = 1;
    expect(engine.endRound().some((e) => e.type === 'wake')).toBe(false);
    const ev = engine.endRound();
    expect(ev.some((e) => e.type === 'wake' && e.id === mons[0].id)).toBe(true);
    expect(engine.awake(mons[0])).toBe(true);
  });

  it('party effects live on the Character and survive into camp', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    battle([f], ['orc']);
    f.fx.blessed = 3;
    expect(hasEffect(f.ref, 'blessed')).toBe(true);
  });

  it('a gnome is harder for a hill giant to hit than an equally armoured human', () => {
    const g = pc('gnome', 'fighter', { abilities: { str: 16 } });
    const h = pc('human', 'fighter', { abilities: { str: 16 } });
    const { engine, mons } = battle([g, h], ['hillGiant']);
    expect(g.ac).toBe(h.ac);
    const giant = mons[0];
    Object.assign(giant, { x: 6, y: 3 });
    const vsG = engine.preview(giant, g).chance;
    const vsH = engine.preview(giant, h).chance;
    expect(vsG).toBeCloseTo(vsH - 0.2);
  });

  it('a ghoul\'s touch can paralyze; elves are immune', () => {
    let paralyzed = false;
    for (let seed = 1; seed < 40 && !paralyzed; seed++) {
      const h = pc('human', 'thief', { seed, abilities: { dex: 12 } });
      const { engine, mons } = battle([h], ['ghoul'], seed);
      turnOf(engine, mons[0], 1);
      const ev = engine.attack(mons[0], h);
      if (ev.some((e) => e.type === 'effect' && e.special === 'paralyze' && !e.saved)) {
        paralyzed = true;
        expect(engine.awake(h)).toBe(false);
      }
    }
    expect(paralyzed).toBe(true);
    const party = buildParty('default', 1).map(combatantFromCharacter);
    const elf = party.find((c) => c.ref.race === 'elf');
    const { engine, mons } = battle([elf], ['ghoul'], 9);
    for (let r = 1; r <= 6; r++) {
      turnOf(engine, mons[0], r);
      engine.attack(mons[0], elf);
    }
    expect(hasEffect(elf.ref, 'paralyzed')).toBe(false);
  });
});
