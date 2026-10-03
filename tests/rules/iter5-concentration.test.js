import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, deriveStats } from '../../src/rules/character.js';
import { combatantFromCharacter, combatantFromMonster, resolveAttack, savingThrow, dealDamage } from '../../src/rules/combat.js';
import { addEffect, getEffect, removeEffect, isConcentrating, breakConcentration } from '../../src/rules/conditions.js';
import { saveBonus } from '../../src/rules/saves.js';
import { castSpell, castingDelay, castingTime, SPELL_RULES, spellSummary } from '../../src/rules/spells.js';
import {
  castInBattle, hammerTurn, roundUpkeep, battleCastProblem, battleItemUse, directingHammer,
} from '../../src/rules/battle.js';
import { breathWeapon } from '../../src/rules/specials.js';
import { THIEF_ARMOR_ADJ } from '../../src/rules/classes.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';

/**
 * Iteration 5 critic fixes: concentration (Spiritual Hammer, Chant), the
 * targeted Silence save through the battle path, DEX penalties on dodge
 * saves, combatant missile range, the monster save path, thief armour and
 * the DMG wand of magic missiles.
 */

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 16, dex: 12, con: 12, cha: 12, ...o });
const mk = (race, classSpec, o = {}) => createCharacter({
  rng: new Rng(o.seed ?? 7), name: o.name ?? classSpec, race, classSpec, level: o.level ?? 1,
  abilities: abil(o.abilities), items: o.items ?? [],
});
/** A fake Rng whose d20 always shows `n` (other dice: minimum). */
const fixed = (n) => ({ die: (s) => (s === 20 ? n : 1), int: (a) => a, pick: (a) => a[0], next: () => 0 });

function battle(party, monsterIds, seed = 3) {
  const rng = new Rng(seed);
  const field = new Battlefield(null, { x: 0, y: 0 });
  const mons = monsterIds.map((id, i) => combatantFromMonster(rng, id, i + 1));
  party.forEach((c, i) => Object.assign(c, { x: 5, y: 3 + i }));
  mons.forEach((c, i) => Object.assign(c, { x: 7, y: 3 + i }));
  const engine = new CombatEngine({ rng, field, party, monsters: mons });
  return { engine, mons, rng };
}
const tough = (m) => { m.hp.cur = m.hp.max = 999; return m; };

// ------------------------------------------------------------- Spiritual Hammer
describe('Spiritual Hammer lasts only while the cleric concentrates (PHB)', () => {
  it('is a concentration effect; casting anything else ends it', () => {
    const rng = new Rng(3);
    const c = mk('human', 'cleric', { level: 3 });
    c.spells.memorized.cleric = ['spiritualHammer', 'bless'];
    const orc = tough(combatantFromMonster(rng, 'orc', 1));
    castSpell(rng, 'spiritualHammer', c, [orc], { context: 'combat', consume: true, noFailure: true });
    expect(getEffect(c, 'spiritualHammer')).toBeTruthy();
    expect(isConcentrating(c)).toBe('spiritualHammer');
    const r = castSpell(rng, 'bless', c, [c], { context: 'combat', consume: true, noFailure: true });
    expect(r.ok).toBe(true);
    expect(r.flags.concentrationBroken).toEqual(['spiritualHammer']);
    expect(r.log.some((l) => /hammer fades/.test(l))).toBe(true);
    expect(getEffect(c, 'spiritualHammer')).toBeUndefined();
    expect(isConcentrating(c)).toBeNull();
  });

  it('a weapon attack by the cleric ends it', () => {
    const rng = new Rng(4);
    const ch = mk('human', 'cleric', { level: 3, items: ['mace'] });
    const cl = combatantFromCharacter(ch);
    const orc = tough(combatantFromMonster(rng, 'orc', 1));
    castSpell(rng, 'spiritualHammer', cl, [orc], { context: 'combat', ignoreMemory: true, noFailure: true });
    expect(getEffect(ch, 'spiritualHammer')).toBeTruthy();
    const a = resolveAttack(rng, cl, orc);
    expect(a.concentrationBroken).toEqual(['spiritualHammer']);
    expect(getEffect(ch, 'spiritualHammer')).toBeUndefined();
    expect(hammerTurn(rng, cl, () => orc, () => orc)).toBeNull();
  });

  it('hammerTurn is the cleric\'s action: no weapon blow, spell or item in the same round', () => {
    const ch = mk('human', 'cleric', { level: 3, items: ['mace', 'potionHealing'] });
    ch.spells.memorized.cleric = ['bless', 'cureLightWounds'];
    const cl = combatantFromCharacter(ch);
    const { engine, mons } = battle([cl], ['orc']);
    const orc = tough(mons[0]);
    Object.assign(orc, { x: 6, y: 3 });
    engine.cast(cl, 'spiritualHammer', { x: orc.x, y: orc.y }, { free: true });
    expect(getEffect(ch, 'spiritualHammer')).toBeTruthy();
    // Next round: the engine's turn start lets the hammer strike...
    engine.endRound();
    engine.round = 2;
    engine.order = [cl, orc];
    engine.turnIdx = -1;
    cl._actedRound = 1;
    orc._actedRound = 1;
    const ev = engine.nextTurn();
    const strike = ev.find((e) => e.type === 'attack' && e.hammer);
    expect(strike).toBeTruthy();
    expect(directingHammer(cl)).toBe(true);
    // ...and that was the cleric's action: no weapon blow,
    expect(cl.attacksLeft).toBe(0);
    const att = engine.attack(cl, orc);
    expect(att.some((e) => e.type === 'attack')).toBe(false);
    // no spell (the menu offers none, the engine refuses one),
    expect(engine.spellsOf(cl)).toEqual([]);
    expect(battleCastProblem(cl, 'bless')).toMatch(/Spiritual Hammer/);
    const cast = engine.cast(cl, 'bless', { x: cl.x, y: cl.y }, { free: true });
    expect(cast.some((e) => e.type === 'cast')).toBe(false);
    // and no item.
    expect(battleItemUse(ch, ch.inventory.findIndex((e) => e.id === 'potionHealing')).kind).toBeNull();
    // The hammer survives into the next round, when it may strike again.
    expect(getEffect(ch, 'spiritualHammer')).toBeTruthy();
    roundUpkeep(cl);
    expect(directingHammer(cl)).toBe(false);
    expect(battleCastProblem(cl, 'bless')).toBeNull();
  });

  it('with nobody in reach the hammer waits and the cleric may act (which ends it)', () => {
    const rng = new Rng(5);
    const ch = mk('human', 'cleric', { level: 3 });
    const cl = combatantFromCharacter(ch);
    const orc = tough(combatantFromMonster(rng, 'orc', 1));
    castSpell(rng, 'spiritualHammer', cl, [orc], { context: 'combat', ignoreMemory: true, noFailure: true });
    orc.hp.cur = -1; // the first target is gone; nobody else within 3 squares
    cl.attacksLeft = 1;
    expect(hammerTurn(rng, cl, () => orc, () => null)).toBeNull();
    expect(cl.attacksLeft).toBe(1);
    expect(battleCastProblem(cl, 'bless')).toBeNull();
  });

  it('a held or sleeping cleric loses the hammer at the end of the round', () => {
    const rng = new Rng(6);
    const ch = mk('human', 'cleric', { level: 3 });
    const cl = combatantFromCharacter(ch);
    const orc = tough(combatantFromMonster(rng, 'orc', 1));
    castSpell(rng, 'spiritualHammer', cl, [orc], { context: 'combat', ignoreMemory: true, noFailure: true });
    addEffect(ch, 'held', { rounds: 5 });
    const ev = roundUpkeep(cl);
    expect(ev.some((e) => e.effect === 'spiritualHammer')).toBe(true);
    expect(getEffect(ch, 'spiritualHammer')).toBeUndefined();
  });
});

// -------------------------------------------------------------------- Chant
describe('Chant: 1-turn casting, lasts while the cleric chants (PHB)', () => {
  const setup = () => {
    const rng = new Rng(8);
    const ch = mk('human', 'cleric', { level: 3, items: ['mace'] });
    const cl = Object.assign(combatantFromCharacter(ch), { x: 4, y: 4 });
    const ally = Object.assign(combatantFromCharacter(mk('human', 'fighter', { name: 'F' })), { x: 5, y: 4 });
    const orc = Object.assign(tough(combatantFromMonster(rng, 'orc', 1)), { x: 6, y: 4 });
    const r = castInBattle(rng, 'chant', cl, [cl, ally, orc], {});
    return { rng, ch, cl, ally, orc, r };
  };
  const chantOn = ({ ch, ally, orc }) => [!!getEffect(ch, 'chant'), !!getEffect(ally.ref, 'chant'), !!getEffect(orc, 'chantFoe'), !!getEffect(ch, 'chanting')];

  it('casting time is the PHB turn, clamped to the full round in battle', () => {
    expect(castingTime('chant', 'cleric', 3)).toBe(100);
    expect(castingDelay('chant', 'cleric', 3)).toBe(10);
    expect(spellSummary('chant', 'cleric', 3).duration).toBe('while chanting');
  });

  it('allies +1, foes -1 and the caster is chanting; it holds round after round while the cleric stands and chants', () => {
    const s = setup();
    expect(s.r.ok).toBe(true);
    expect(chantOn(s)).toEqual([true, true, true, true]);
    for (let i = 0; i < 12; i++) for (const c of [s.cl, s.ally, s.orc]) roundUpkeep(c);
    expect(chantOn(s)).toEqual([true, true, true, true]);
    expect(saveBonus(s.ally, {})).toBe(0); // chant's +1 is in savesOf, not the situational bonus
    expect(deriveStats(s.ally.ref).saves.sp).toBe(deriveStats(mk('human', 'fighter')).saves.sp - 1);
  });

  it('damage to the cleric breaks the chant everywhere', () => {
    const s = setup();
    dealDamage(s.cl, 1);
    expect(chantOn(s)).toEqual([false, false, false, false]);
  });

  it('moving off the square breaks it at the end of the round', () => {
    const s = setup();
    s.cl.x += 1;
    const ev = roundUpkeep(s.cl);
    expect(ev.some((e) => e.effect === 'chanting')).toBe(true);
    expect(chantOn(s)).toEqual([false, false, false, false]);
  });

  it('attacking or casting breaks it', () => {
    const a = setup();
    resolveAttack(a.rng, a.cl, a.orc);
    expect(chantOn(a)).toEqual([false, false, false, false]);
    const b = setup();
    const r = castInBattle(b.rng, 'cureLightWounds', b.cl, [b.ally], {});
    expect(r.flags.concentrationBroken).toEqual(['chanting']);
    expect(chantOn(b)).toEqual([false, false, false, false]);
  });

  it('silence breaks it', () => {
    const s = setup();
    addEffect(s.ch, 'silenced', { rounds: 4 });
    roundUpkeep(s.cl);
    expect(chantOn(s)).toEqual([false, false, false, false]);
  });

  it('breakConcentration is the public way to stop chanting', () => {
    const s = setup();
    expect(breakConcentration(s.ch)).toEqual(['chanting']);
    expect(chantOn(s)).toEqual([false, false, false, false]);
  });
});

// ------------------------------------------------------------------- Silence
describe('Silence 15\' Radius: the creature it is cast upon saves, bystanders do not', () => {
  it('castInBattle: the first (aimed) target saves, the others never', () => {
    const rng = new Rng(9);
    const c = mk('human', 'cleric', { level: 3 });
    let aimed = 0;
    let bystander = 0;
    for (let i = 0; i < 60; i++) {
      const a = combatantFromMonster(rng, 'acolyte', 1);
      const b = combatantFromMonster(rng, 'acolyte', 2);
      const r = castInBattle(rng, 'silence15', c, [a, b], {});
      if (r.results.find((x) => x.target === a)?.save) aimed++;
      if (r.results.find((x) => x.target === b)?.save) bystander++;
    }
    expect(aimed).toBe(60);
    expect(bystander).toBe(0);
  });

  it('o.at on an empty square: nobody saves', () => {
    const rng = new Rng(10);
    const c = mk('human', 'cleric', { level: 3 });
    const a = Object.assign(combatantFromMonster(rng, 'acolyte', 1), { x: 3, y: 3 });
    const r = castInBattle(rng, 'silence15', c, [a], { at: { x: 4, y: 3 } });
    expect(r.results[0].save).toBeUndefined();
    expect(getEffect(a, 'silenced')).toBeTruthy();
  });

  it('through the real CombatEngine.cast: the acolyte aimed at saves, its neighbour does not', () => {
    const ch = mk('human', 'cleric', { level: 3 });
    const cl = combatantFromCharacter(ch);
    const { engine, mons } = battle([cl], ['acolyte', 'acolyte'], 11);
    const [a, b] = mons;
    Object.assign(a, { x: 8, y: 4 });
    Object.assign(b, { x: 9, y: 4 });
    let aimedSaves = 0;
    let aimedSilenced = 0;
    for (let i = 0; i < 40; i++) {
      removeEffect(a, 'silenced');
      removeEffect(b, 'silenced');
      engine.cast(cl, 'silence15', { x: a.x, y: a.y }, { free: true });
      if (getEffect(a, 'silenced')) aimedSilenced++;
      else aimedSaves++;
      expect(getEffect(b, 'silenced')).toBeTruthy(); // no save for those merely inside
    }
    expect(aimedSaves).toBeGreaterThan(0);
    expect(aimedSilenced).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------- DEX on saves
describe('DEX defensive adjustment works both ways on dodge saves (PHB)', () => {
  it('DEX 3 is -4, DEX 6 -1, DEX 12 0, DEX 18 +4 vs fireball', () => {
    for (const [dex, b] of [[3, -4], [4, -3], [5, -2], [6, -1], [12, 0], [15, 1], [18, 4]]) {
      expect(saveBonus(mk('human', 'fighter', { abilities: { dex } }), { dodge: true }), `DEX ${dex}`).toBe(b);
    }
    // ...and never on non-dodgeable magic.
    expect(saveBonus(mk('human', 'fighter', { abilities: { dex: 3 } }), {})).toBe(0);
  });

  it('applies to breath weapons: a d20 of 13 vs a 17 breath save', () => {
    const rng = new Rng(12);
    const wyrm = combatantFromMonster(rng, 'tyranthraxus', 1);
    const quick = combatantFromCharacter(mk('human', 'fighter', { name: 'Quick', abilities: { dex: 18 } }));
    const clumsy = combatantFromCharacter(mk('human', 'fighter', { name: 'Clumsy', abilities: { dex: 3 } }));
    const plain = combatantFromCharacter(mk('human', 'fighter', { name: 'Plain', abilities: { dex: 12 } }));
    for (const c of [quick, clumsy, plain]) c.ref.hp.cur = c.ref.hp.max = c.hp.cur = c.hp.max = 200;
    const target = deriveStats(quick.ref).saves.bw;
    const r = breathWeapon(fixed(target - 4), wyrm, [quick, clumsy, plain], { damage: 40, element: 'electricity' });
    const by = (c) => r.results.find((x) => x.target === c);
    expect(by(quick).saved).toBe(true);
    expect(by(plain).saved).toBe(false);
    const r2 = breathWeapon(fixed(target + 1), wyrm, [clumsy, plain], { damage: 40, element: 'electricity' });
    expect(r2.results.find((x) => x.target === plain).saved).toBe(true);
    expect(r2.results.find((x) => x.target === clumsy).saved).toBe(false); // 18 - 4 = 14 < 17
  });
});

// ------------------------------------------------------- combatant range
describe('combatantFromCharacter range is the rules missile range', () => {
  for (const items of [['shortBow', 'arrows'], ['longBow', 'arrows'], ['lightCrossbow', 'quarrels'], ['sling'], ['dart'], ['dagger'], ['longSword']]) {
    it(items[0], () => {
      const ch = mk('human', 'fighter', { items, abilities: { str: 16 } });
      expect(combatantFromCharacter(ch).range).toBe(deriveStats(ch).range);
    });
  }
  it('a short bow reaches 15 squares (PHB long range), not the raw data value', () => {
    const ch = mk('elf', 'fighter', { items: ['shortBow', 'arrows'], abilities: { str: 16 } });
    expect(combatantFromCharacter(ch).range).toBe(15);
  });
});

// ------------------------------------------------------- monster save path
describe('monster saves go through rollSave (element, source, mental)', () => {
  it('an acolyte under Prot. from Good saves +2 against a good source', () => {
    const rng = new Rng(13);
    const m = combatantFromMonster(rng, 'acolyte', 1);
    addEffect(m, 'protGood', { rounds: 10 });
    const good = mk('human', 'cleric');
    good.alignment = 'LG';
    expect(savingThrow(rng, m, 'sp', 0, { source: good }).bonus).toBe(2);
    expect(savingThrow(rng, m, 'sp', 0, {}).bonus).toBe(0);
  });
  it('Resist Fire gives a monster +3 vs fire through savingThrow', () => {
    const rng = new Rng(14);
    const m = combatantFromMonster(rng, 'orc', 1);
    addEffect(m, 'resistFire', { rounds: 10 });
    expect(savingThrow(rng, m, 'sp', 1, { element: 'fire' }).bonus).toBe(4);
  });
  it('bless / chant style save mods still count (in the target number)', () => {
    const rng = new Rng(15);
    const m = combatantFromMonster(rng, 'orc', 1);
    const base = savingThrow(rng, m, 'sp').target;
    addEffect(m, 'chantFoe', { rounds: 3 });
    expect(savingThrow(rng, m, 'sp').target).toBe(base + 1);
  });
});

// --------------------------------------------------------------- thief armour
describe('thief skills in armour (UA adjustments)', () => {
  it('padded and studded leather: PP -30, OL -10, F/RT -10, MS -20, HS -20, HN -10, CW -30', () => {
    const lea = deriveStats(mk('human', 'thief', { level: 5, abilities: { dex: 16 }, items: ['leather'] })).thief;
    for (const armour of ['studdedLeather', 'padded']) {
      const t = deriveStats(mk('human', 'thief', { level: 5, abilities: { dex: 16 }, items: [armour] })).thief;
      for (const [k, v] of Object.entries(THIEF_ARMOR_ADJ.studded)) expect(t[k], `${armour} ${k}`).toBe(Math.max(0, lea[k] + v));
      expect(t.rl).toBe(lea.rl);
    }
  });
  it('an elf fighter/thief in elfin chain loses PP 20, OL 5, MS 10, HS 10 — not full skills', () => {
    const lea = deriveStats(mk('elf', 'fighter/thief', { level: 4, abilities: { dex: 17, str: 16 }, items: ['leather'] })).thief;
    const elf = deriveStats(mk('elf', 'fighter/thief', { level: 4, abilities: { dex: 17, str: 16 }, items: ['elfinChain'] })).thief;
    expect(elf.pp).toBe(Math.max(0, lea.pp - 20));
    expect(elf.ol).toBe(Math.max(0, lea.ol - 5));
    expect(elf.ms).toBe(Math.max(0, lea.ms - 10));
    expect(elf.hs).toBe(Math.max(0, lea.hs - 10));
    expect(elf.cw).toBe(Math.max(0, lea.cw - 20));
  });
  it('chain mail still forbids the skills outright', () => {
    const t = deriveStats(mk('halfElf', 'fighter/thief', { level: 3, abilities: { dex: 16, str: 16 }, items: ['chainMail'] })).thief;
    expect(t.pp).toBe(0);
    expect(t.ms).toBe(0);
  });
});

// --------------------------------------------------------- wand of MM
describe('Wand of Magic Missiles (DMG): one 2-5 missile per charge', () => {
  it('battle use casts at 1st level: one missile, one charge', () => {
    const rng = new Rng(16);
    const ch = mk('human', 'magicUser', { items: ['wandMagicMissile'] });
    const i = ch.inventory.findIndex((e) => e.id === 'wandMagicMissile');
    const use = battleItemUse(ch, i);
    expect(use.kind).toBe('spell');
    expect(use.level).toBe(1);
    expect(SPELL_RULES.magicMissile.missiles(use.level)).toBe(1);
    const ogre = tough(combatantFromMonster(rng, 'ogre', 1));
    for (let k = 0; k < 30; k++) {
      const r = castSpell(rng, 'magicMissile', ch, [ogre], { fromItem: true, level: use.level, check: false });
      expect(r.results[0].damage).toBeGreaterThanOrEqual(2);
      expect(r.results[0].damage).toBeLessThanOrEqual(5);
    }
  });
});

describe('Shield (PHB): +1 to saves', () => {
  it('a shielded magic-user saves one better', () => {
    const mu = mk('human', 'magicUser');
    const base = deriveStats(mu).saves.sp;
    addEffect(mu, 'shielded', { rounds: 5 });
    expect(deriveStats(mu).saves.sp).toBe(base - 1);
  });
});
