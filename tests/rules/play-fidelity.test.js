import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import {
  createCharacter, deriveStats, dualClass, dualClassChoices, dualClassWarning, rollExceptionalStr, classLabels,
} from '../../src/rules/character.js';
import {
  combatantFromCharacter, combatantFromMonster, hitChance, resolveAttack, defenderAc, savingThrow, poison,
  onHitSpecials, dealDamage, rollSurprise,
} from '../../src/rules/combat.js';
import { addEffect, hasEffect, getEffect, clearCombatEffects } from '../../src/rules/conditions.js';
import { castSpell, spellTargeting, SLEEP_BANDS, castingDelay } from '../../src/rules/spells.js';
import { rollSave, saveChance } from '../../src/rules/saves.js';
import { monsterSaves, savesFor } from '../../src/rules/classes.js';
import { belowOneHd } from '../../src/rules/creature.js';
import { attachTimeSync, syncPartyTime } from '../../src/rules/camp.js';
import { beginCasting, finishCasting, castingOf, cloudExposure } from '../../src/rules/battle.js';
import { generateTreasure, EACH_MAGIC_KIND } from '../../src/rules/treasure.js';
import { ITEMS } from '../../src/data/items.js';
import {
  tryOpenLock, openDoorsChance, findRemoveTraps, detectTrap, searchSecret, secretDoorChance, surpriseMods,
  stoneSenseChance,
} from '../../src/rules/explore.js';
import { EventBus } from '../../src/core/EventBus.js';
import { GameState } from '../../src/core/GameState.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';

/**
 * Where the tables meet play: rear and missile AC, the poison-only racial
 * save, the five-band Sleep table, casting time and spell disruption, the
 * clock driving timed effects, exploration rules, dual-class traps.
 * Each case is a PHB/DMG expectation, not an "it doesn't throw" check.
 */

const abil = (o = {}) => ({ str: 16, strPct: 0, int: 12, wis: 12, dex: 10, con: 14, cha: 10, ...o });
const mk = (race, classSpec, o = {}) => createCharacter({
  rng: new Rng(o.seed ?? 1), name: o.name ?? `${race} ${classSpec}`, race, classSpec, level: o.level ?? 1,
  abilities: abil(o.abilities), items: o.items ?? [], gender: o.gender,
});

describe('armour class by direction (DMG)', () => {
  const fighter = () => mk('human', 'fighter', { abilities: { dex: 18 }, items: ['chainMail', 'shield'] });

  it('AC 0 fighter (chain + shield + DEX 18) has rear AC 5', () => {
    const s = deriveStats(fighter());
    expect(s.ac).toBe(0);
    expect(s.acRear).toBe(5);
  });

  it('an orc from behind uses the rear AC: 0.45, not 0.20', () => {
    const f = combatantFromCharacter(fighter());
    const orc = combatantFromMonster(new Rng(1), 'orc');
    expect(hitChance(orc, f)).toBeCloseTo(0.10, 5); // 19 - 0 = 19 → 2/20
    expect(hitChance(orc, f, 0, { rear: true })).toBeCloseTo(0.45, 5); // 19 - 5 - 2 = 12 → 9/20
    expect(defenderAc(orc, f, { rear: true })).toBe(5);
    // resolveAttack agrees with the preview.
    const r = resolveAttack(new Rng(4), orc, f, { rear: true });
    expect(r.needed).toBe(12);
  });

  it('a backstab also strikes the rear AC, with +4 instead of +2', () => {
    const f = combatantFromCharacter(fighter());
    const t = combatantFromCharacter(mk('human', 'thief', { abilities: { dex: 16 } }));
    // thief THAC0 21 at 1st (DMG: 21 for 1-4), rear AC 5, +4 → needs 12
    expect(resolveAttack(new Rng(2), t, f, { backstab: true, backstabMult: 2 }).needed).toBe(21 - 5 - 4);
  });

  it('rear attacks ignore a monster\'s declared shield', () => {
    const orc = combatantFromMonster(new Rng(1), 'orc');
    orc.ref = { ...orc.ref, shield: true };
    const f = combatantFromCharacter(mk('human', 'fighter'));
    expect(defenderAc(f, orc, { rear: true })).toBe(orc.ac + 1);
    expect(defenderAc(f, orc)).toBe(orc.ac);
  });

  it('Shield cast before the combatant is built still turns arrows (AC 2, not 4)', () => {
    const mu = mk('human', 'magicUser', { level: 3 });
    castSpell(new Rng(1), 'shield', mu, [mu], { ignoreMemory: true });
    const c = combatantFromCharacter(mu);
    const archer = combatantFromMonster(new Rng(1), 'orc');
    archer.ranged = true;
    expect(defenderAc(archer, c, { ranged: true })).toBe(2);
    expect(defenderAc(archer, c, { ranged: false })).toBe(4);
    // orc THAC0 19: melee vs 4 needs 15 (0.30), arrows vs 2 need 17 (0.20).
    expect(hitChance(archer, c, 0, { ranged: true })).toBeCloseTo(0.20, 5);
    expect(hitChance(archer, c, 0, { ranged: false })).toBeCloseTo(0.30, 5);
  });

  it('Shield cast mid-battle also applies by direction', () => {
    const mu = mk('human', 'magicUser', { level: 3 });
    const c = combatantFromCharacter(mu);
    castSpell(new Rng(1), 'shield', mu, [mu], { ignoreMemory: true });
    const orc = combatantFromMonster(new Rng(1), 'orc');
    expect(defenderAc(orc, c, { ranged: true })).toBe(2);
    expect(defenderAc(orc, c)).toBe(4);
    expect(defenderAc(orc, c, { rear: true })).toBe(10); // the shield spell guards the front only
  });
});

describe('racial poison bonus: poison only (PHB)', () => {
  const dwarf = () => mk('dwarf', 'fighter', { abilities: { con: 18, str: 16 } });

  it('CON 18 dwarf F1: ghoul paralysis on 14, poison on 9', () => {
    const d = dwarf();
    expect(deriveStats(d).saves.ppdm).toBe(14);
    expect(deriveStats(d).savePoison).toBe(9);
    expect(saveChance(d, 'ppdm')).toBeCloseTo(7 / 20, 5);
    expect(saveChance(d, 'ppdm', { poison: true })).toBeCloseTo(12 / 20, 5);
    // A roll of 10 saves against poison but not against paralysis.
    const ten = { die: () => 10, int: () => 10 };
    expect(rollSave(ten, d, 'ppdm').saved).toBe(false);
    expect(rollSave(ten, d, 'ppdm', { poison: true }).saved).toBe(true);
  });

  it('combat.poison applies the bonus, ghoul paralysis does not (statistically)', () => {
    let poisoned = 0;
    let paralyzed = 0;
    const N = 2000;
    const rng = new Rng(11);
    for (let i = 0; i < N; i++) {
      const c = combatantFromCharacter(dwarf());
      if (!poison(rng, c).saved) poisoned++;
      const ghoul = combatantFromMonster(rng, 'ghoul');
      const c2 = combatantFromCharacter(dwarf());
      if (onHitSpecials(rng, ghoul, c2).some((o) => o.kind === 'paralyze' && !o.saved)) paralyzed++;
    }
    expect(poisoned / N).toBeGreaterThan(0.32); // fails on 1-8: 40%
    expect(poisoned / N).toBeLessThan(0.48);
    expect(paralyzed / N).toBeGreaterThan(0.57); // fails on 1-13: 65%
    expect(paralyzed / N).toBeLessThan(0.73);
  });

  it('the stinking cloud save counts as poison', () => {
    const d = dwarf();
    const ten = { die: () => 10, int: () => 10, chance: () => false };
    const c = combatantFromCharacter(d);
    const area = { kind: 'cloud', squares: new Set(['0,0']) };
    expect(cloudExposure(ten, c, area, 1)[0].saved).toBe(true);
    expect(savingThrow(ten, c, 'ppdm').saved).toBe(false);
  });
});

describe('Sleep: five PHB bands', () => {
  it('3+1 to 4 HD is its own 1-2 band; 4+1 to 4+4 is 0-1', () => {
    expect(SLEEP_BANDS.map((b) => b.dice)).toEqual(['4d4', '2d4', '1d4', '1d2', '1d2-1']);
  });

  it('two bugbears (3+1 HD): about 1.5 asleep on average, both sometimes', () => {
    const mu = mk('human', 'magicUser', { abilities: { int: 16 } });
    let total = 0;
    let both = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const rng = new Rng(100 + i);
      const bugs = [combatantFromMonster(rng, 'bugbear', 1), combatantFromMonster(rng, 'bugbear', 2)];
      const n = castSpell(rng, 'sleep', mu, bugs, { ignoreMemory: true }).results.filter((x) => x.affected).length;
      total += n;
      if (n === 2) both++;
    }
    expect(total / N).toBeGreaterThan(1.35);
    expect(total / N).toBeLessThan(1.65);
    expect(both).toBeGreaterThan(N * 0.35);
  });

  it('a 4+3 HD wight is undead and immune; a 4+1 HD living creature sleeps at most alone', () => {
    const mu = mk('human', 'magicUser');
    const w = combatantFromMonster(new Rng(1), 'wight');
    expect(castSpell(new Rng(1), 'sleep', mu, [w], { ignoreMemory: true }).results[0].immune).toBe(true);
    let max = 0;
    for (let i = 0; i < 100; i++) {
      const rng = new Rng(i);
      const big = [0, 1, 2].map((k) => { const c = combatantFromMonster(rng, 'bugbear', k); c.ref = { ...c.ref, hd: 4, hpBonus: 2 }; return c; });
      max = Math.max(max, castSpell(rng, 'sleep', mu, big, { ignoreMemory: true }).results.filter((x) => x.affected).length);
    }
    expect(max).toBe(1);
  });
});

describe('casting time and spell disruption', () => {
  it('castingDelay reads the PHB casting time in segments', () => {
    expect(castingDelay('magicMissile', 'magicUser', 1)).toBe(1);
    expect(castingDelay('fireball', 'magicUser', 5)).toBe(3);
    expect(castingDelay('cureLightWounds', 'cleric', 1)).toBe(5);
    expect(castingDelay('bless', 'cleric', 1)).toBe(10);
    expect(castingDelay('holdPerson', 'cleric', 3)).toBe(5);
    expect(castingDelay('holdPerson', 'magicUser', 5)).toBe(3);
    expect(castingDelay('fireball', 'magicUser', 5, { fromItem: true })).toBe(0);
  });

  it('a caster struck before the spell goes off loses it (rules API)', () => {
    const mu = combatantFromCharacter(mk('human', 'magicUser', { level: 5 }));
    mu.initiative = 7;
    const { resolveAt, segments } = beginCasting(mu, 'fireball', { at: { x: 3, y: 3 } });
    expect(segments).toBe(3);
    expect(resolveAt).toBe(4);
    expect(castingOf(mu).spellId).toBe('fireball');
    mu.hp.cur = 20;
    dealDamage(mu, 2);
    const r = finishCasting(mu);
    expect(r.lost).toBe(true);
    expect(r.reason).toBe('struck');
    expect(castingOf(mu)).toBe(null);
  });

  it('an unhurt caster completes the spell; asleep or silenced it is lost', () => {
    const mu = combatantFromCharacter(mk('human', 'magicUser', { level: 5 }));
    beginCasting(mu, 'fireball', {});
    expect(finishCasting(mu).ok).toBe(true);
    beginCasting(mu, 'fireball', {});
    addEffect(mu.ref, 'silenced', { rounds: 3 });
    expect(finishCasting(mu).reason).toBe('incapacitated');
  });

  function duel(hitCaster) {
    const rng = new Rng(3);
    const field = new Battlefield(null, { x: 0, y: 0 });
    const ch = mk('human', 'magicUser', { level: 1, abilities: { int: 16 } });
    ch.spells.memorized.magicUser = ['sleep'];
    const mu = combatantFromCharacter(ch);
    ch.hp.cur = ch.hp.max = 20;
    const orc = combatantFromMonster(rng, 'orc');
    orc.hp.cur = orc.hp.max = 8;
    Object.assign(mu, { x: 3, y: 3 });
    Object.assign(orc, { x: 7, y: 3 });
    const engine = new CombatEngine({ rng, field, party: [mu], monsters: [orc] });
    engine.round = 1;
    mu.initiative = 9;
    orc.initiative = 9; // same pip: the orc acts before segment 8 when Sleep goes off
    engine.order = [mu, orc];
    engine.turnIdx = 0;
    mu._actedRound = 0;
    orc._actedRound = 0;
    const ev = engine.cast(mu, 'sleep', { x: orc.x, y: orc.y });
    expect(ev[0].casting).toBe(true);
    expect(ch.spells.memorized.magicUser).toEqual([]); // the slot is spent when casting begins
    engine.endTurn(mu);
    engine.nextTurn();
    expect(engine.active()).toBe(orc);
    expect(hasEffect(orc, 'asleep')).toBe(false); // not yet
    if (hitCaster) dealDamage(mu, 3);
    engine.endTurn(orc);
    const ev2 = engine.nextTurn();
    return { ev2, orc, ch };
  }

  it('in the tactical engine: hit before segment 8, the Sleep is lost and the slot spent', () => {
    const { ev2, orc, ch } = duel(true);
    expect(ev2.some((e) => e.spellLost)).toBe(true);
    expect(hasEffect(orc, 'asleep')).toBe(false);
    expect(ch.spells.memorized.magicUser).toEqual([]);
  });

  it('in the tactical engine: left alone, the Sleep goes off at the end of the round', () => {
    const { ev2, orc } = duel(false);
    const cast = ev2.find((e) => e.type === 'cast' && e.spell === 'sleep');
    expect(cast).toBeTruthy();
    expect(cast.hits.some((h) => h.id === orc.id && h.effect === 'asleep')).toBe(true);
  });
});

describe('the game clock drives timed effects (attachTimeSync)', () => {
  function world() {
    const bus = new EventBus();
    const game = new GameState(bus);
    const cl = mk('human', 'cleric', { level: 3, abilities: { wis: 15 } });
    const f = mk('human', 'fighter', { name: 'Walker' });
    game.setParty([cl, f]);
    const events = [];
    bus.on('party:time', (r) => events.push(r));
    attachTimeSync(bus, game);
    return { bus, game, cl, f, events };
  }

  it('Bless cast in camp expires after 30 minutes of walking', () => {
    const { game, cl, f, events } = world();
    castSpell(new Rng(1), 'bless', cl, [cl, f], { ignoreMemory: true });
    expect(hasEffect(f, 'blessed')).toBe(true);
    for (let i = 0; i < 30; i++) game.advanceTime(1);
    expect(hasEffect(f, 'blessed')).toBe(false);
    expect(events.some((e) => e.expired[f.id]?.includes('blessed'))).toBe(true);
  });

  it('poison onset kills while walking, not only at the next rest', () => {
    const { game, f, events } = world();
    addEffect(f, 'poisoned', { data: { onset: 10 } });
    game.advanceTime(5);
    expect(f.status).toBe('ok');
    game.advanceTime(6);
    expect(f.status).toBe('dead');
    expect(events.some((e) => e.died.includes(f.id))).toBe(true);
  });

  it('a long rest that already ticked effects is not ticked twice', () => {
    const { game, f } = world();
    addEffect(f, 'strength', { rounds: 600, persist: true });
    game.advanceTime(1);
    syncPartyTime(game.party, game.minutes);
    expect(getEffect(f, 'strength').rounds).toBe(599);
  });
});

describe('rest and clock together', () => {
  it('camp.rest followed by game.advanceTime ticks effects once', async () => {
    const { rest } = await import('../../src/rules/camp.js');
    const bus = new EventBus();
    const game = new GameState(bus);
    const f = mk('human', 'fighter');
    game.setParty([f]);
    attachTimeSync(bus, game);
    addEffect(f, 'strength', { rounds: 600, persist: true });
    rest(game.party, 60);
    game.advanceTime(60);
    expect(getEffect(f, 'strength').rounds).toBe(540);
  });
});

describe('long buffs survive the battle (clearCombatEffects)', () => {
  it('Enlarge, Prot. Normal Missiles and Strength cast in camp outlive a fight; Bless and Haste do not', () => {
    const mu = mk('human', 'magicUser', { level: 5 });
    const f = mk('human', 'fighter');
    const rng = new Rng(2);
    castSpell(rng, 'enlarge', mu, [f], { ignoreMemory: true });
    castSpell(rng, 'protNormalMissiles', mu, [f], { ignoreMemory: true });
    castSpell(rng, 'strength', mu, [f], { ignoreMemory: true });
    castSpell(rng, 'haste', mu, [f], { ignoreMemory: true });
    castSpell(rng, 'bless', mk('human', 'cleric'), [f], { ignoreMemory: true });
    clearCombatEffects(f);
    for (const id of ['enlarged', 'protNormalMissiles', 'strength']) expect(hasEffect(f, id)).toBe(true);
    for (const id of ['hasted', 'blessed']) expect(hasEffect(f, id)).toBe(false);
  });
});

describe('exploration rules', () => {
  it('Knock opens anything, even a wizard lock', () => {
    const r = tryOpenLock(new Rng(1), [mk('human', 'fighter')], { wizardLocked: true }, { knock: true });
    expect(r.opened).toBe(true);
    expect(r.method).toBe('knock');
    expect(tryOpenLock(new Rng(1), [mk('human', 'fighter', { abilities: { str: 18, strPct: 100 } })], { wizardLocked: true }).opened).toBe(false);
  });

  it('the thief picks a lock at their Open Locks %, once per level', () => {
    const t = mk('halfling', 'thief', { abilities: { dex: 18, str: 12, con: 12 } });
    const ol = deriveStats(t).thief.ol;
    expect(ol).toBe(25 + 5 + 15); // base + halfling + DEX 18
    let picks = 0;
    for (let i = 0; i < 1000; i++) if (tryOpenLock(new Rng(i), [t], { locked: true }, { force: false }).opened) picks++;
    expect(picks / 1000).toBeGreaterThan(ol / 100 - 0.05);
    expect(picks / 1000).toBeLessThan(ol / 100 + 0.05);
    // Once failed, not again until the next level.
    const door = { locked: true };
    let rng = 0;
    let r;
    do r = tryOpenLock(new Rng(rng++), [t], door, { force: false }); while (r.opened && rng < 100);
    expect(door.failedBy[t.id]).toBe(1);
    expect(tryOpenLock(new Rng(5), [t], door, { force: false }).attempts.length).toBe(0);
  });

  it('a thief in plate cannot pick locks', () => {
    const t = mk('human', 'thief', { abilities: { dex: 16 }, items: ['plateMail'] });
    t.inventory[0].equipped = true; // forced on (a thief may not normally wear it)
    expect(tryOpenLock(new Rng(1), [t], { locked: true }, { force: false }).attempts.length).toBe(0);
  });

  it('STR opens stuck doors x in 6; locked doors only at 18/91+', () => {
    expect(openDoorsChance(16)).toEqual({ n: 3, die: 6 });
    expect(openDoorsChance(18, 50)).toEqual({ n: 3, die: 6 });
    expect(openDoorsChance(18, 95, { locked: true })).toEqual({ n: 1, die: 6 });
    expect(openDoorsChance(18, 100, { locked: true })).toEqual({ n: 2, die: 6 });
    expect(openDoorsChance(17, 0, { locked: true }).n).toBe(0);
    expect(openDoorsChance(19)).toEqual({ n: 7, die: 8 });
    const weak = mk('human', 'fighter', { abilities: { str: 16 } });
    expect(tryOpenLock(new Rng(1), [weak], { locked: true }).opened).toBe(false);
    let opened = 0;
    for (let i = 0; i < 600; i++) if (tryOpenLock(new Rng(i), [weak], { stuck: true }).opened) opened++;
    expect(opened / 600).toBeGreaterThan(0.43);
    expect(opened / 600).toBeLessThan(0.57);
  });

  it('bars yield to Bend Bars %', () => {
    const f = mk('human', 'fighter', { abilities: { str: 18, strPct: 100 } });
    let bent = 0;
    for (let i = 0; i < 1000; i++) if (tryOpenLock(new Rng(i), [f], { bars: true }).opened) bent++;
    expect(bent / 1000).toBeGreaterThan(0.35);
    expect(bent / 1000).toBeLessThan(0.45);
  });

  it('find/remove traps uses the thief\'s FRT; Find Traps spell finds outright', () => {
    const t = mk('human', 'thief', { abilities: { dex: 16 } });
    const r = findRemoveTraps(new Rng(1), t);
    expect(r.chance).toBe(deriveStats(t).thief.ft);
    expect(findRemoveTraps(new Rng(1), mk('human', 'fighter')).chance).toBe(0);
    const cl = mk('human', 'cleric', { level: 3 });
    addEffect(cl, 'findTraps', { rounds: 30 });
    expect(detectTrap(new Rng(1), [mk('human', 'fighter'), cl]).method).toBe('spell');
  });

  it('secret doors: elves 1 in 6 passing, 2 in 6 searching; others 1 in 6 searching only', () => {
    expect(secretDoorChance('elf', { passive: true })).toBe(1);
    expect(secretDoorChance('halfElf', {})).toBe(2);
    expect(secretDoorChance('elf', { concealed: true })).toBe(3);
    expect(secretDoorChance('human', { passive: true })).toBe(0);
    expect(secretDoorChance('dwarf', {})).toBe(1);
    const humans = [mk('human', 'fighter')];
    const elves = [mk('elf', 'fighter', { abilities: { dex: 12, con: 12 } })];
    let h = 0;
    let e = 0;
    let passive = 0;
    for (let i = 0; i < 1200; i++) {
      if (searchSecret(new Rng(i), humans).found) h++;
      if (searchSecret(new Rng(i), elves).found) e++;
      if (searchSecret(new Rng(i), humans, { passive: true }).found) passive++;
    }
    expect(h / 1200).toBeCloseTo(1 / 6, 1);
    expect(e / 1200).toBeCloseTo(2 / 6, 1);
    expect(passive).toBe(0);
    expect(searchSecret(new Rng(1), humans).minutes).toBe(10);
  });

  it('dwarves sense stonework', () => {
    expect(stoneSenseChance('dwarf', 'sliding')).toBe(66);
    expect(stoneSenseChance('gnome', 'unsafe')).toBe(70);
    expect(stoneSenseChance('human', 'sliding')).toBe(0);
  });

  it('elves and halflings in non-metal armour surprise others 4 in 6', () => {
    const elf = mk('elf', 'thief', { abilities: { dex: 16, con: 12 }, items: ['leather'] });
    const hob = mk('halfling', 'thief', { abilities: { dex: 16, str: 12, con: 12 } });
    const tank = mk('human', 'fighter', { items: ['chainMail'] });
    expect(surpriseMods([elf, hob]).monsterMod).toBe(-2);
    expect(surpriseMods([elf, hob, tank]).monsterMod).toBe(0);
    expect(surpriseMods([elf, hob, tank], { scout: elf }).monsterMod).toBe(-2);
    let surprised = 0;
    for (let i = 0; i < 1200; i++) {
      const r = rollSurprise(new Rng(i), { party: [elf, hob] });
      if (r.monsters) surprised++;
    }
    // monsters surprised 4/6 and the party not (4/6): 4/6 * 4/6 ≈ 0.44
    expect(surprised / 1200).toBeGreaterThan(0.38);
    expect(surprised / 1200).toBeLessThan(0.5);
  });
});

describe('dual-class traps and labels', () => {
  it('warns when the new class can never surpass the old level (MU cap 6 < F8)', () => {
    const h = mk('human', 'fighter', { level: 8, abilities: { str: 17, int: 17, dex: 12 } });
    const w = dualClassWarning(h, 'magicUser');
    expect(w).toMatch(/never regain Fighter/);
    expect(w).toMatch(/6/);
    const ch = dualClassChoices(h).find((c) => c.cls === 'magicUser');
    expect(ch.warning).toBe(w);
    const low = mk('human', 'fighter', { level: 4, abilities: { str: 17, int: 17, dex: 12 } });
    expect(dualClassWarning(low, 'magicUser')).toBe(null);
  });

  it('a dual-classed human shows both careers on the sheet', () => {
    const h = mk('human', 'fighter', { level: 8, abilities: { str: 17, int: 17, dex: 12 } });
    dualClass(h, 'magicUser');
    h.levels.magicUser = 3;
    const s = deriveStats(h);
    expect(s.levels).toBe('8/3');
    expect(s.classLevels).toBe('F8 / MU3');
    expect(s.dual).toBe(true);
    expect(s.dualActive).toBe(false);
    expect(classLabels(mk('halfElf', 'fighter/magicUser', { abilities: { str: 17, int: 17, dex: 12 } })).classLevels).toBe('F1 / MU1');
  });
});

describe('spell ranges, clouds and treasure', () => {
  it('Spiritual Hammer reaches 1" (one square) per caster level', () => {
    expect(spellTargeting('spiritualHammer', 3, 'cleric').range).toBe(3);
    expect(spellTargeting('spiritualHammer', 6, 'cleric').range).toBe(6);
  });

  it('a lingering cloud checks each creature at most once per round', () => {
    const orc = combatantFromMonster(new Rng(1), 'orc');
    const area = { kind: 'cloud', squares: new Set(['1,1']) };
    const always = { die: () => 20, int: () => 1 };
    expect(cloudExposure(always, orc, area, 2).length).toBe(1);
    expect(cloudExposure(always, orc, area, 2).length).toBe(0);
    expect(cloudExposure(always, orc, area, 3).length).toBe(1);
    const fail = { die: () => 1, int: () => 1 };
    const orc2 = combatantFromMonster(new Rng(2), 'orc');
    cloudExposure(fail, orc2, area, 1);
    expect(hasEffect(orc2, 'nauseous')).toBe(true);
  });

  it('treasure types U and V give one / two of each magic kind, no potions or scrolls', () => {
    for (let i = 0; i < 40; i++) {
      for (const [type, per] of [['U', 1], ['V', 2]]) {
        const t = generateTreasure(new Rng(i), type);
        for (const e of t.items) expect(['potion', 'scroll']).not.toContain(ITEMS[e.id]?.type);
        expect(t.items.length).toBeLessThanOrEqual(per * EACH_MAGIC_KIND.length);
        if (t.items.length) expect(t.items.length).toBeGreaterThanOrEqual(per * 3); // armour, swords, weapons always exist
      }
    }
  });
});

describe('ability and monster save rulings', () => {
  it('exceptional strength is uniform up to the cap (no pile-up at the cap)', () => {
    const counts = new Map();
    for (let i = 0; i < 2000; i++) {
      const v = rollExceptionalStr(new Rng(i), { str: 18 }, 'gnome', 'fighter');
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect(Math.max(...counts.keys())).toBe(50);
    expect(counts.get(50)).toBeLessThan(120); // ~40 expected, not ~1000
  });

  it('1-1 HD goblins save as 0-level, consistent with the fighter sweep', () => {
    const g = combatantFromMonster(new Rng(1), 'goblin');
    expect(belowOneHd(g)).toBe(true);
    expect(g.saves).toEqual(savesFor('fighter', 0));
    expect(monsterSaves(1, -1)).toEqual(savesFor('fighter', 0));
    expect(monsterSaves(1, 0)).toEqual(savesFor('fighter', 1));
  });
});
