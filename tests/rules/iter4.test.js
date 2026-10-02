import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import {
  createCharacter, deriveStats, drainLevel, dualClass, activeClasses, effectiveAbilities, computeMaxHp,
} from '../../src/rules/character.js';
import {
  combatantFromCharacter, combatantFromMonster, onHitSpecials, sweepAttacks, attackRateOf, attacksFor,
} from '../../src/rules/combat.js';
import { addEffect, removeEffect, hasEffect } from '../../src/rules/conditions.js';
import { attacksThisTurn } from '../../src/rules/battle.js';
import {
  SPELL_RULES, castingDelay, castingTime, spellTargeting, spellSummary, castProblem, durationText, castTimeText,
} from '../../src/rules/spells.js';
import { generateTreasure, rollMagicItem } from '../../src/rules/treasure.js';
import { endBattleTime, passTime, syncPartyTime } from '../../src/rules/camp.js';
import {
  edgeKey, openLockedDoor, isDoorOpened, lockedDoorState, searchSquare, knockCaster,
} from '../../src/rules/explore.js';
import { ITEMS } from '../../src/data/items.js';
import { SPELLS as SPELL_DATA } from '../../src/data/spells.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';
import { decide } from '../../src/scenes/combat/logic/ai.js';

/**
 * Iteration 4: the adversarial probes of the last review, as regression
 * tests — dual-class energy drain and dormant abilities, ghast vs elf,
 * Burning Hands' reach, PHB casting times, the display formatter, treasure
 * type Z, battle time on the clock — and the integration of the monster
 * specials, surprise and the exploration rules into the real engine.
 */

const abil = (o = {}) => ({ str: 17, strPct: 0, int: 17, wis: 12, dex: 10, con: 15, cha: 10, ...o });
const mk = (race, classSpec, o = {}) => createCharacter({
  rng: new Rng(o.seed ?? 1), name: o.name ?? `${race} ${classSpec}`, race, classSpec, level: o.level ?? 1,
  abilities: abil(o.abilities), items: o.items ?? [], ignoreLimits: o.ignoreLimits,
});
const exFighterMage = (level = 8, abilities = {}) => {
  const f = mk('human', 'fighter', { level, abilities, items: ['staff'] });
  dualClass(f, 'magicUser');
  return f;
};

// ------------------------------------------------------------ energy drain
describe('energy drain counts every class, a dormant dual class included', () => {
  it('a human F8 who just became MU1 survives a wight: F7/MU1', () => {
    const f = exFighterMage(8);
    const hp0 = f.hp.max;
    const r = drainLevel(f, 1);
    expect(r.died).toBe(false);
    expect(r.drained).toEqual([{ cls: 'fighter', level: 7 }]);
    expect(f.levels).toMatchObject({ fighter: 7, magicUser: 1 });
    expect(f.dual.level).toBe(7);
    expect(f.hpRolls.fighter).toHaveLength(7);
    expect(f.hp.max).toBeLessThan(hp0);
    expect(f.hp.max).toBe(computeMaxHp(f));
    expect(f.status).not.toBe('dead');
  });

  it('drains the highest class first and kills only when every class is at 1st', () => {
    const f = exFighterMage(3);
    // F3/MU1 → F2/MU1 → F1/MU1 → dead
    expect(drainLevel(f, 1).drained[0]).toEqual({ cls: 'fighter', level: 2 });
    expect(drainLevel(f, 1).drained[0]).toEqual({ cls: 'fighter', level: 1 });
    expect(f.status).not.toBe('dead');
    const last = drainLevel(f, 1);
    expect(last.died).toBe(true);
    expect(f.status).toBe('dead');
  });

  it('a spectre (2 levels) takes them from the old class while it is higher', () => {
    const f = exFighterMage(6);
    const r = drainLevel(f, 2);
    expect(r.drained.map((d) => `${d.cls}${d.level}`)).toEqual(['fighter5', 'fighter4']);
    expect(f.dual.level).toBe(4);
  });

  it('once the new class is ahead, it is the one drained (and the old one can come back into use)', () => {
    const f = exFighterMage(2);
    f.levels.magicUser = 4;
    f.hpRolls.magicUser = [4, 3, 2, 4];
    f.xp.magicUser = 10000;
    expect(activeClasses(f)).toContain('fighter');
    expect(drainLevel(f, 1).drained[0]).toEqual({ cls: 'magicUser', level: 3 });
  });

  it('multiclass and single-class drains still behave', () => {
    const fm = mk('elf', 'fighter/magicUser', { level: 3 });
    expect(drainLevel(fm, 1).drained[0].level).toBe(2);
    const t = mk('human', 'thief', { level: 1, abilities: { dex: 16 } });
    expect(drainLevel(t, 1).died).toBe(true);
  });
});

// ------------------------------------------------- dormant class abilities
describe('a dormant dual class lends nothing', () => {
  it('ex-F8 MU1: one attack on a kobold, rate 1 with a staff, no 3/2', () => {
    const f = exFighterMage(8);
    const c = combatantFromCharacter(f);
    const kob = combatantFromMonster(new Rng(1), 'kobold');
    expect(sweepAttacks(f, kob)).toBe(0);
    expect(attackRateOf(c, { weapon: ITEMS.staff })).toBe(1);
    expect(deriveStats(f).attacks).toBe(1);
    for (const round of [1, 2, 3]) expect(attacksThisTurn(c, round, kob)).toBe(1);
    expect(deriveStats(f).thac0).toBe(21); // MU1 matrix, not the fighter's
  });

  it('the same ex-fighter sweeps again once the fighter class returns', () => {
    const f = exFighterMage(2);
    f.levels.magicUser = 3;
    const kob = combatantFromMonster(new Rng(1), 'kobold');
    expect(activeClasses(f)).toContain('fighter');
    expect(sweepAttacks(f, kob)).toBe(2);
  });

  it('exceptional strength sleeps with the fighter class (PHB: fighters only)', () => {
    const f = mk('human', 'fighter', { level: 5, abilities: { str: 18, strPct: 80 } });
    expect(deriveStats(f).dmgBonus).toBe(4);
    dualClass(f, 'magicUser');
    expect(effectiveAbilities(f).strPct).toBe(0);
    expect(deriveStats(f).dmgBonus).toBe(2); // plain 18
    f.levels.magicUser = 6;
    expect(effectiveAbilities(f).strPct).toBe(80);
    // Gauntlets of ogre power still give 18/00 to anyone.
    const m = mk('human', 'magicUser', { abilities: { str: 10 } });
    expect(effectiveAbilities(m).strPct).toBe(0);
  });

  it('a multiclass fighter/magic-user keeps sweeps and percentile strength', () => {
    const fm = mk('halfElf', 'fighter/magicUser', { level: 3, abilities: { str: 18, strPct: 50 } });
    expect(sweepAttacks(fm, combatantFromMonster(new Rng(1), 'kobold'))).toBe(3);
    expect(effectiveAbilities(fm).strPct).toBe(50);
  });
});

// -------------------------------------------------------- ghoul vs ghast
describe('elves resist the ghoul only (MM)', () => {
  const trials = (monId, race) => {
    const e = mk(race, 'fighter', { abilities: { con: 12, dex: 12 } });
    const c = combatantFromCharacter(e);
    let n = 0;
    for (let i = 0; i < 200; i++) {
      removeEffect(e, 'paralyzed');
      onHitSpecials(new Rng(i + 1), combatantFromMonster(new Rng(1), monId), c);
      if (hasEffect(e, 'paralyzed')) n++;
    }
    return n;
  };
  it('ghoul never paralyzes an elf; a ghast does when the save fails', () => {
    expect(trials('ghoul', 'elf')).toBe(0);
    const ghast = trials('ghast', 'elf');
    expect(ghast).toBeGreaterThan(80); // F1 saves vs paralyzation on 14: ~65% fail
    expect(ghast).toBeLessThan(170);
  });
  it('humans are paralyzed by both at about the same rate', () => {
    const a = trials('ghoul', 'human');
    const b = trials('ghast', 'human');
    expect(Math.abs(a - b)).toBeLessThan(40);
  });
});

// ----------------------------------------------------------- Burning Hands
describe('Burning Hands is a 3\' fan, not a 30\' cone', () => {
  it('rules area: cone of size 1 from the caster', () => {
    const t = spellTargeting('burningHands', 6, 'magicUser');
    expect(t.shape).toBe('cone');
    expect(t.size).toBe(1);
    expect(t.range).toBe(1);
  });
  it('battlefield template: only squares next to the caster', () => {
    const f = new Battlefield(null, { x: 0, y: 0 });
    for (const to of [{ x: 6, y: 3 }, { x: 9, y: 3 }, { x: 8, y: 6 }]) {
      const sq = f.template('cone', { x: 5, y: 3 }, to, spellTargeting('burningHands', 6, 'magicUser').size);
      expect(sq.length).toBeGreaterThan(0);
      for (const s of sq) expect(Math.max(Math.abs(s.x - 5), Math.abs(s.y - 3))).toBe(1);
    }
  });
});

// -------------------------------------------------------- casting times
/** PHB casting times in segments (1 round = 10, 1 turn = 100). */
const PHB_CAST = {
  bless: 10, curse: 10, cureLightWounds: 5, causeLightWounds: 5, detectMagic: { cleric: 10, magicUser: 1 },
  protectionFromEvil: { cleric: 4, magicUser: 1 }, protectionFromGood: { cleric: 4, magicUser: 1 }, resistCold: 10,
  findTraps: 5, holdPerson: { cleric: 5, magicUser: 3 }, resistFire: 5, silence15: 5, slowPoison: 1, snakeCharm: 5,
  spiritualHammer: 5,
  chant: 10, // PHB 1 turn; Pool of Radiance makes it a battle prayer that goes off at the end of the round
  cureBlindness: 10, causeBlindness: 10, cureDisease: 100, causeDisease: 100, dispelMagic: { cleric: 6, magicUser: 3 },
  prayer: 6, removeCurse: 6, bestowCurse: 6, cureSeriousWounds: 7, neutralizePoison: 7, cureCriticalWounds: 8,
  raiseDead: 10,
  burningHands: 1, charmPerson: 1, enlarge: 1, reduce: 1, friends: 1, magicMissile: 1, readMagic: 10, shield: 1,
  shockingGrasp: 1, sleep: 1, detectInvisibility: 2, invisibility: 2, knock: 1, mirrorImage: 2, rayOfEnfeeblement: 2,
  stinkingCloud: 2, strength: 100, blink: 1, fireball: 3, haste: 3, invisibility10: 3, lightningBolt: 3, protEvil10: 3,
  protGood10: 3, protNormalMissiles: 3, slow: 3, wandParalyzation: 1,
};

describe('casting times match the PHB for every spell', () => {
  it('the table covers every SPELL_RULES entry', () => {
    expect(Object.keys(PHB_CAST).sort()).toEqual(Object.keys(SPELL_RULES).sort());
  });
  for (const [id, want] of Object.entries(PHB_CAST)) {
    it(id, () => {
      for (const cls of Object.keys(SPELL_RULES[id].schools)) {
        const seg = typeof want === 'number' ? want : want[cls];
        expect(castingTime(id, cls, 5), `${id}/${cls}`).toBe(seg);
        expect(castingDelay(id, cls, 5), `${id}/${cls} delay`).toBe(Math.min(10, seg));
      }
    });
  }
  it('spells longer than a round cannot be cast in battle, except the PoR battle forms', () => {
    const long = Object.keys(PHB_CAST).filter((id) => castingTime(id, Object.keys(SPELL_RULES[id].schools)[0]) > 10);
    expect(long.sort()).toEqual(['causeDisease', 'cureDisease', 'strength']);
    expect(SPELL_RULES.strength.usable).toBe('camp');
    expect(SPELL_RULES.cureDisease.usable).toBe('camp');
    const mu = mk('human', 'magicUser', { level: 3 });
    mu.spells.memorized.magicUser = ['strength'];
    expect(castProblem(mu, 'strength', { context: 'combat' })).toBe('not in combat');
    expect(castProblem(mu, 'strength', { context: 'camp' })).toBeNull();
  });
});

// ----------------------------------------------------------- spell display
describe('spellSummary: the card shows what the engine does', () => {
  it('cleric and magic-user Hold Person differ', () => {
    expect(spellSummary('holdPerson', 'cleric', 3)).toMatchObject({ range: '6 squares', save: 'spell negates', castTime: '5 segments', duration: '7 rounds' });
    expect(spellSummary('holdPerson', 'magicUser', 5)).toMatchObject({ range: '12 squares', castTime: '3 segments', duration: '1 turn' });
  });
  it('Sleep scales with level and is not "instant"', () => {
    expect(spellSummary('sleep', 'magicUser', 1)).toMatchObject({ range: '4 squares', duration: '5 rounds', save: 'none', area: '3x3 squares' });
    expect(spellSummary('sleep', 'magicUser', 4).range).toBe('7 squares');
  });
  it('Haste, Shield and Strength have real durations; Burning Hands reaches the adjacent square', () => {
    expect(spellSummary('haste', 'magicUser', 5)).toMatchObject({ duration: '8 rounds', area: '2-square radius, up to 5' });
    expect(spellSummary('shield', 'magicUser', 2).duration).toBe('1 turn');
    expect(spellSummary('shield', 'magicUser', 3).duration).toBe('15 rounds');
    expect(spellSummary('strength', 'magicUser', 3)).toMatchObject({ duration: '3 hours', castTime: '1 turn', usable: 'camp only' });
    expect(spellSummary('burningHands', 'magicUser', 3)).toMatchObject({ area: 'adjacent square', range: 'from caster', duration: 'instant' });
    expect(spellSummary('fireball', 'magicUser', 5)).toMatchObject({ range: '15 squares', area: '2-square radius', save: 'spell half' });
  });
  it('every spell and class yields clean strings', () => {
    for (const [id, s] of Object.entries(SPELL_RULES)) {
      for (const cls of Object.keys(s.schools)) {
        for (const L of [1, 5, 12]) {
          const sum = spellSummary(id, cls, L);
          for (const [k, v] of Object.entries(sum)) {
            expect(typeof v, `${id} ${k}`).toBe('string');
            expect(v, `${id} ${k}`).not.toMatch(/undefined|NaN|null|Infinity/);
            expect(v.length, `${id} ${k}`).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(spellSummary('nope', 'cleric', 1)).toBeNull();
  });
  it('unit formatting', () => {
    expect([0, 1, 7, 10, 30, 60, 120, Infinity].map(durationText)).toEqual(['instant', '1 round', '7 rounds', '1 turn', '3 turns', '1 hour', '2 hours', 'until broken']);
    expect([1, 3, 10, 60, 100].map(castTimeText)).toEqual(['1 segment', '3 segments', '1 round', '6 rounds', '1 turn']);
  });
  it('data display strings no longer contradict the rules', () => {
    expect(SPELL_DATA.holdPerson.range).toBe('6 squares');
    expect(SPELL_DATA.sleep.desc).not.toMatch(/2d4/);
  });
});

// ------------------------------------------------------------- treasure Z
describe('treasure type Z: any 3 magic items except potions', () => {
  it('never a potion from the Z magic roll (500 hoards)', () => {
    let items = 0;
    for (let s = 1; s <= 500; s++) {
      const t = generateTreasure(new Rng(s), 'Z');
      for (const it of t.items) {
        items++;
        expect(ITEMS[it.id]?.type, it.id).not.toBe('potion');
      }
    }
    expect(items).toBeGreaterThan(300);
  });
  it('rollMagicItem("noPotions") never rolls a potion', () => {
    for (let s = 1; s <= 400; s++) {
      const e = rollMagicItem(new Rng(s), 'noPotions');
      if (e) expect(ITEMS[e.id].type).not.toBe('potion');
    }
  });
});

// ---------------------------------------------------------- battle time
describe('combat rounds advance the clock once', () => {
  it('a 10-round fight costs 10 minutes and does not tick effects again', () => {
    const f = mk('human', 'fighter');
    const game = { party: [f], minutes: 600, flags: {} };
    syncPartyTime(game.party, game.minutes);
    addEffect(f, 'blessed', { rounds: 30, persists: true });
    // The battle itself ran the effect down 10 rounds (roundUpkeep).
    getEff(f).rounds -= 10;
    let ticked = null;
    game.advanceTime = (m) => { game.minutes += m; ticked = syncPartyTime(game.party, game.minutes); };
    expect(endBattleTime(game, 10)).toBe(10);
    expect(game.minutes).toBe(610);
    expect(getEff(f).rounds).toBe(20);
    expect(ticked?.minutes ?? 0).toBe(0);
    // Later walking still counts normally.
    game.advanceTime(5);
    expect(getEff(f).rounds).toBe(15);
  });
  it('no rounds, no time', () => {
    const game = { party: [], minutes: 5 };
    expect(endBattleTime(game, 0)).toBe(0);
    expect(game.minutes).toBe(5);
  });
});
const getEff = (ch) => ch.effects.find((e) => e.id === 'blessed');

// ------------------------------------------------- engine integration
function battle(party, monsterIds, seed = 3, place = null) {
  const rng = new Rng(seed);
  const field = new Battlefield(null, { x: 0, y: 0 });
  const mons = monsterIds.map((id, i) => combatantFromMonster(rng, id, i + 1));
  party.forEach((c, i) => Object.assign(c, { x: 5, y: 3 + i }));
  mons.forEach((c, i) => Object.assign(c, { x: 6, y: 3 + i }));
  place?.(party, mons);
  const engine = new CombatEngine({ rng, field, party, monsters: mons });
  return { engine, mons, rng, field };
}
const activate = (engine, c) => {
  engine.order = [c, ...engine.all.filter((o) => o !== c)];
  engine.turnIdx = 0;
  engine.round = Math.max(1, engine.round);
  c.mp = 12;
  c.attacksLeft = 1;
  c.acted = false;
};

describe('Tyranthraxus breathes lightning and projects fear', () => {
  it('the AI breathes down a line of three heroes; the engine resolves it through the rules', () => {
    const party = [0, 1, 2].map((i) => combatantFromCharacter(mk('human', 'fighter', { level: 8, seed: i + 2 })));
    const { engine, mons } = battle(party, ['tyranthraxus'], 4, (p, m) => {
      p.forEach((c, i) => Object.assign(c, { x: 4 + i, y: 3 }));
      Object.assign(m[0], { x: 8, y: 3 });
    });
    const ty = mons[0];
    activate(engine, ty);
    expect(engine.specialActions(ty).map((a) => a.id)).toContain('breath');
    const plan = decide(engine, ty);
    expect(plan.kind).toBe('special');
    expect(plan.id).toBe('breath');
    const hp = party.map((c) => c.hp.cur);
    const ev = engine.special(ty, plan.id, plan.at);
    const cast = ev.find((e) => e.type === 'cast');
    expect(cast.special).toBe('breath');
    expect(cast.vfx).toBe('lightning');
    expect(cast.hits.length).toBe(3);
    party.forEach((c, i) => expect(c.hp.cur).toBeLessThan(hp[i]));
    expect(ty.breathUsed).toBe(1);
    // The scene presents it like a spell: engine.tactics knows the breath.
    expect(engine.tactics(ty, 'breath')).toMatchObject({ shape: 'line', size: 10, vfx: 'lightning' });
  });

  it('fear at the start of a round: low-level heroes flee, the AI runs them', () => {
    const party = [0, 1, 2, 3].map((i) => combatantFromCharacter(mk('human', 'fighter', { level: i < 2 ? 1 : 6, seed: i + 7 })));
    const { engine } = battle(party, ['tyranthraxus'], 9);
    const ev = engine.startRound();
    const fear = ev.filter((e) => e.type === 'effect' && e.special === 'fear');
    expect(fear.length).toBe(2); // the two 6th-level fighters are above 3 HD: unshaken, no event
    for (const c of party.slice(2)) expect(hasEffect(c.ref, 'afraid')).toBe(false);
    const afraid = party.filter((c) => hasEffect(c.ref, 'afraid'));
    for (const c of afraid) {
      expect(engine.mustAutoAct(c)).toBe(true);
      expect(decide(engine, c).kind).toMatch(/flee|attack|move/);
    }
    // Once per battle.
    const again = engine.startRound().filter((e) => e.special === 'fear');
    expect(again.length).toBe(0);
  });

  it('no fear-tagged foe: no extra dice (the battle stream is unchanged)', () => {
    const a = battle([combatantFromCharacter(mk('human', 'fighter'))], ['orc'], 11).engine;
    const b = battle([combatantFromCharacter(mk('human', 'fighter'))], ['orc'], 11).engine;
    a.startRound();
    b.startRound();
    expect(a.rng.getState()).toBe(b.rng.getState());
  });
});

describe('hill giants throw rocks', () => {
  it('a giant with foes at range hurls a boulder instead of walking', () => {
    const hero = combatantFromCharacter(mk('human', 'fighter', { level: 5 }));
    const { engine, mons } = battle([hero], ['hillGiant'], 5, (p, m) => {
      Object.assign(p[0], { x: 2, y: 3 });
      Object.assign(m[0], { x: 12, y: 3 });
    });
    const g = mons[0];
    activate(engine, g);
    const plan = decide(engine, g);
    expect(plan).toMatchObject({ kind: 'special', id: 'rocks' });
    const ev = engine.special(g, 'rocks', plan.at);
    const atk = ev.find((e) => e.type === 'attack');
    expect(atk).toMatchObject({ rock: true, ranged: true, target: hero.id });
  });
  it('adjacent foes are clubbed, not stoned', () => {
    const hero = combatantFromCharacter(mk('human', 'fighter', { level: 5 }));
    const { engine, mons } = battle([hero], ['hillGiant'], 5);
    activate(engine, mons[0]);
    expect(decide(engine, mons[0]).kind).toBe('attack');
  });
});

describe('troll regeneration comes from the rules', () => {
  it('3 hp a round from the third round after wounding; fire damage stays', () => {
    const hero = combatantFromCharacter(mk('human', 'fighter'));
    const { engine, mons } = battle([hero], ['troll'], 6);
    const t = mons[0];
    t.hp.cur = t.hp.max - 20;
    const heals = [];
    for (let r = 0; r < 4; r++) heals.push(engine.endRound().filter((e) => e.type === 'heal' && e.id === t.id).reduce((a, e) => a + e.amount, 0));
    expect(heals).toEqual([0, 0, 3, 3]);
    t.burnt = t.hp.max - t.hp.cur; // all of it was fire
    expect(engine.endRound().some((e) => e.type === 'heal' && e.id === t.id)).toBe(false);
  });
});

describe('surprise', () => {
  it('forced "party" (the party sneaked up): monsters lose round 1', () => {
    const hero = combatantFromCharacter(mk('human', 'fighter'));
    const { engine, mons } = battle([hero], ['orc', 'orc'], 7);
    const ev = engine.rollSurprise({ forced: 'party' });
    expect(ev[0]).toMatchObject({ type: 'surprise', side: 'monster' });
    engine.startRound();
    engine.turnIdx = -1;
    const first = engine.nextTurn();
    expect(first[0].type).toBe('surprise');
    const acted = [];
    for (let i = 0; i < 6 && engine.round === 1; i++) {
      const c = engine.active();
      if (!c) break;
      acted.push(c.side);
      engine.endTurn(c);
      engine.nextTurn();
    }
    expect(acted).not.toContain('monster');
    expect(engine.isSurprised(mons[0])).toBe(false); // round 2: everyone acts
  });
  it('forced "monsters": the party loses round 1; "none" disables it', () => {
    const { engine } = battle([combatantFromCharacter(mk('human', 'fighter'))], ['orc'], 7);
    engine.rollSurprise({ forced: 'monsters' });
    expect(engine.surprised).toBe('party');
    const e2 = battle([combatantFromCharacter(mk('human', 'fighter'))], ['orc'], 7).engine;
    expect(e2.rollSurprise({ forced: 'none' })).toEqual([]);
    expect(e2.surprised).toBeNull();
  });
  it('rolled surprise follows 1-2 in 6 per side and does not advance the battle dice', () => {
    let party = 0;
    let mons = 0;
    for (let s = 1; s <= 600; s++) {
      const { engine } = battle([combatantFromCharacter(mk('human', 'fighter'))], ['orc'], s);
      const before = engine.rng.getState();
      engine.rollSurprise({});
      expect(engine.rng.getState()).toBe(before);
      if (engine.surprised === 'party') party++;
      if (engine.surprised === 'monster') mons++;
    }
    // P(one side only) = 1/3 × 2/3 each ≈ 22%.
    expect(party / 600).toBeGreaterThan(0.15);
    expect(party / 600).toBeLessThan(0.3);
    expect(mons / 600).toBeGreaterThan(0.15);
    expect(mons / 600).toBeLessThan(0.3);
  });
});

// --------------------------------------------------- exploration helpers
describe('locked doors and hidden doors for the explore scene', () => {
  it('edgeKey is the same from both sides', () => {
    expect(edgeKey('ruins', 3, 2, 'E')).toBe(edgeKey('ruins', 4, 2, 'W'));
    expect(edgeKey('ruins', 3, 2, 'S')).toBe(edgeKey('ruins', 3, 3, 'N'));
  });
  it('a thief opens a lock sooner or later; the door stays open', () => {
    const thief = mk('halfling', 'thief', { level: 4, abilities: { dex: 18, str: 12 } });
    let opened = 0;
    for (let s = 1; s <= 100; s++) {
      const game = { party: [thief], flags: {} };
      const r = openLockedDoor(new Rng(s), game, 'm:1,1,E', { useKnock: false });
      expect(r.minutes).toBeGreaterThanOrEqual(1);
      if (r.opened) {
        opened++;
        expect(isDoorOpened(game, 'm:1,1,E')).toBe(true);
        expect(openLockedDoor(new Rng(s), game, 'm:1,1,E').minutes).toBe(0);
      }
    }
    expect(opened).toBeGreaterThan(40);
  });
  it('a failed thief cannot retry the same lock until next level (state persists)', () => {
    const thief = mk('human', 'thief', { level: 1, abilities: { dex: 12, str: 8 } });
    let game;
    let r;
    let seed = 0;
    do {
      game = { party: [thief], flags: {} };
      r = openLockedDoor(new Rng(++seed), game, 'k', { useKnock: false });
    } while (r.opened && seed < 200);
    expect(r.opened).toBe(false);
    expect(lockedDoorState(game, 'k').failedBy[thief.id]).toBe(1);
    const again = openLockedDoor(new Rng(seed + 1), game, 'k', { useKnock: false });
    expect(again.opened).toBe(false);
    expect(again.method).toBeNull();
    thief.levels.thief = 2; // a level later the thief may try again
    let opened = false;
    for (let s = 1; s <= 60 && !opened; s++) {
      delete lockedDoorState(game, 'k').failedBy;
      opened = openLockedDoor(new Rng(s), game, 'k', { useKnock: false }).opened;
    }
    expect(opened).toBe(true);
  });
  it('Knock opens what nobody else can, and spends the memorized spell', () => {
    const mage = mk('human', 'magicUser', { level: 3, abilities: { str: 8 } });
    mage.spells.memorized.magicUser = ['knock', 'magicMissile'];
    expect(knockCaster([mage])?.ch).toBe(mage);
    const game = { party: [mage], flags: {} };
    const r = openLockedDoor(new Rng(1), game, 'w', { door: { wizardLocked: true } });
    expect(r).toMatchObject({ opened: true, method: 'knock', knocked: true });
    expect(mage.spells.memorized.magicUser).toEqual(['magicMissile']);
  });
  it('searching: elves find hidden doors 2 in 6, others 1 in 6; only elves notice in passing', () => {
    const count = (race, o) => {
      let n = 0;
      for (let s = 1; s <= 1200; s++) n += searchSquare(new Rng(s), [mk(race, race === 'elf' ? 'fighter' : 'fighter')], [{ dir: 'N' }], o).found.length;
      return n / 1200;
    };
    expect(count('elf')).toBeCloseTo(2 / 6, 1);
    expect(count('human')).toBeCloseTo(1 / 6, 1);
    expect(count('elf', { passive: true })).toBeCloseTo(1 / 6, 1);
    expect(count('human', { passive: true })).toBe(0);
    expect(searchSquare(new Rng(1), [], [{ dir: 'N' }]).minutes).toBe(10);
  });
});

// ------------------------------------------------ dialogue skill checks
import { check } from '../../src/scenes/dialogue/effects.js';
import { DIALOGUES } from '../../src/data/dialogue.js';

describe('dialogue thief checks use the rules thief table', () => {
  it('open locks and move silently come from deriveStats, the best thief tries', () => {
    const t1 = mk('human', 'thief', { level: 1, abilities: { dex: 12 }, name: 'Novice' });
    const t4 = mk('halfling', 'thief', { level: 4, abilities: { dex: 17, str: 12 }, name: 'Pip' });
    const game = { party: [mk('human', 'fighter'), t1, t4], flags: {} };
    const r = check({ game, rng: new Rng(3) }, 'ol', 0);
    expect(r.who).toBe(t4);
    expect(r.chance).toBe(deriveStats(t4).thief.ol);
    expect(check({ game, rng: new Rng(3) }, 'ms', 0).chance).toBe(deriveStats(t4).thief.ms);
    expect(check({ game: { party: [mk('human', 'fighter')], flags: {} }, rng: new Rng(1) }, 'ol', 0)).toMatchObject({ ok: false, reason: 'no thief' });
  });
  it('every dialogue check names a known stat or thief skill', () => {
    const ok = new Set(['str', 'int', 'wis', 'dex', 'con', 'cha', 'thief', 'pp', 'ol', 'ft', 'ms', 'hs', 'hn', 'cw']);
    const stats = JSON.stringify(DIALOGUES).match(/"stat":"[a-z]+"/g) ?? [];
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) expect(ok.has(s.slice(8, -1)), s).toBe(true);
  });
});
