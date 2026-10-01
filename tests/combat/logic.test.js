import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { buildParty } from '../../src/rules/party.js';
import { combatantFromCharacter, combatantFromMonster } from '../../src/rules/combat.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';
import { decide } from '../../src/scenes/combat/logic/ai.js';

/**
 * Tactical combat logic (src/scenes/combat/logic): attacks of opportunity, fleeing
 * off the edge, line of sight, spell templates, bandaging, delay ordering and
 * turning undead. Everything runs on an open 21x15 field with a seeded Rng.
 */
function setup({ monsters = ['orc'], seed = 3, partyId = 'default' } = {}) {
  const rng = new Rng(seed);
  const field = new Battlefield(null, { x: 0, y: 0 });
  const party = buildParty(partyId, 1).map(combatantFromCharacter);
  const mons = monsters.map((id, i) => combatantFromMonster(rng, id, i + 1));
  party.forEach((c, i) => Object.assign(c, { x: 2 + i, y: 7 }));
  mons.forEach((c, i) => Object.assign(c, { x: 12 + i, y: 7 }));
  const engine = new CombatEngine({ rng, field, party, monsters: mons });
  return { rng, field, party, mons, engine };
}

/** Make a combatant the active one with fresh movement/attacks. */
function activate(engine, c) {
  engine.order = [c, ...engine.all.filter((o) => o !== c)];
  engine.turnIdx = 0;
  engine.round = Math.max(1, engine.round);
  c.mp = c.move;
  c.attacksLeft = c.attacks.length;
  c.moved = 0;
}

describe('battlefield geometry', () => {
  it('open field has exits on every rim square and none inside', () => {
    const f = new Battlefield(null, { x: 0, y: 0 });
    expect(f.w).toBe(21);
    expect(f.h).toBe(15);
    expect(f.exitDir(0, 7)).toEqual([-1, 0]);
    expect(f.exitDir(20, 7)).toEqual([1, 0]);
    expect(f.exitDir(10, 0)).toEqual([0, -1]);
    expect(f.exitDir(10, 7)).toBeNull();
  });

  it('line of sight is blocked by solid squares and walls, and losBlock reports where', () => {
    const f = new Battlefield(null, { x: 0, y: 0 });
    expect(f.los(2, 7, 12, 7)).toBe(true);
    expect(f.losBlock(2, 7, 12, 7)).toBe(1);
    f.block[f.idx(7, 7)] = 1;
    expect(f.los(2, 7, 12, 7)).toBe(false);
    const t = f.losBlock(2, 7, 12, 7);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.6);
    // Props (block 2) don't block sight.
    f.block[f.idx(7, 7)] = 2;
    expect(f.los(2, 7, 12, 7)).toBe(true);
    // A wall on a square edge blocks.
    f.wallE[f.idx(5, 7)] = 1;
    expect(f.los(2, 7, 12, 7)).toBe(false);
  });

  it('diagonal sight past a corner is only blocked when both orthogonal routes are', () => {
    const f = new Battlefield(null, { x: 0, y: 0 });
    f.block[f.idx(6, 5)] = 1; // one corner solid: the diagonal still squeezes past
    expect(f.los(5, 5, 6, 6)).toBe(true);
    f.block[f.idx(5, 6)] = 1; // both corners solid: blocked
    expect(f.los(5, 5, 6, 6)).toBe(false);
  });

  it('area templates have the right shapes', () => {
    const f = new Battlefield(null, { x: 0, y: 0 });
    const key = (a) => new Set(a.map((s) => `${s.x},${s.y}`));
    // Fireball radius 2 (+0.5): a filled disc around the target.
    const disc = key(f.template('radius', { x: 2, y: 7 }, { x: 10, y: 7 }, 2));
    expect(disc.has('10,7')).toBe(true);
    expect(disc.has('12,7')).toBe(true);
    expect(disc.has('12,9')).toBe(false);
    expect(disc.size).toBe(21);
    // Sleep: a 3x3 block centred on the target.
    expect(f.template('square', { x: 2, y: 7 }, { x: 10, y: 7 }, 3)).toHaveLength(9);
    // Burning hands: a cone pointing away from the caster, never behind.
    const cone = key(f.template('cone', { x: 10, y: 7 }, { x: 11, y: 7 }, 3));
    expect(cone.has('11,7')).toBe(true);
    expect(cone.has('13,7')).toBe(true);
    expect(cone.has('9,7')).toBe(false);
    expect(cone.has('10,7')).toBe(false);
    // Lightning bolt: a straight line that stops at a solid square.
    f.block[f.idx(8, 7)] = 1;
    const line = f.template('line', { x: 2, y: 7 }, { x: 12, y: 7 }, 8);
    expect(line.map((s) => s.x)).toEqual([3, 4, 5, 6, 7]);
  });

  it('flood fill prices diagonals at 1.5 and pathTo walks back to the start', () => {
    const f = new Battlefield(null, { x: 0, y: 0 });
    const fl = f.flood(5, 5, () => false, 10);
    expect(fl.cost[f.idx(6, 5)]).toBe(1);
    expect(fl.cost[f.idx(6, 6)]).toBe(1.5);
    const path = f.pathTo(fl, 8, 5);
    expect(path.map((p) => p.x)).toEqual([6, 7, 8]);
  });
});

describe('combat engine', () => {
  it('leaving an enemy\'s reach provokes a free attack; moving along it does not', () => {
    const { engine, party, mons } = setup({ monsters: ['orc'] });
    const hero = party[0];
    const orc = mons[0];
    Object.assign(hero, { x: 10, y: 7 });
    Object.assign(orc, { x: 11, y: 7 });
    activate(engine, hero);
    hero.hp.cur = hero.hp.max = 200; // survive the free attack
    // Sliding to another square adjacent to the orc: no attack of opportunity.
    let evs = engine.move(hero, [{ x: 10, y: 8 }]);
    expect(evs.filter((e) => e.type === 'attack')).toHaveLength(0);
    expect(hero.y).toBe(8);
    // Stepping away: the orc gets exactly one free attack, then it is spent this round.
    evs = engine.move(hero, [{ x: 9, y: 8 }]);
    const aoo = evs.filter((e) => e.type === 'attack');
    expect(aoo).toHaveLength(1);
    expect(aoo[0].aoo).toBe(true);
    expect(aoo[0].id).toBe(orc.id);
    expect(hero.x).toBe(9);
    Object.assign(hero, { x: 10, y: 7 });
    hero.mp = 6;
    evs = engine.move(hero, [{ x: 9, y: 7 }]);
    expect(evs.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('sleeping enemies get no attack of opportunity', () => {
    const { engine, party, mons } = setup({ monsters: ['orc'] });
    const hero = party[0];
    Object.assign(hero, { x: 10, y: 7 });
    Object.assign(mons[0], { x: 11, y: 7 });
    mons[0].fx.asleep = 3;
    activate(engine, hero);
    const evs = engine.move(hero, [{ x: 9, y: 7 }]);
    expect(evs.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('fleeing works only from the map edge and with movement left', () => {
    const { engine, party } = setup();
    const hero = party[0];
    activate(engine, hero);
    Object.assign(hero, { x: 10, y: 7 });
    expect(engine.flee(hero)[0].type).toBe('fleeFail');
    Object.assign(hero, { x: 0, y: 7 });
    hero.mp = 0;
    expect(engine.flee(hero)[0].type).toBe('fleeFail');
    hero.mp = 3;
    const evs = engine.flee(hero);
    expect(evs.some((e) => e.type === 'flee')).toBe(true);
    expect(hero.fled).toBe(true);
    expect(engine.out(hero)).toBe(true);
  });

  it('the party wins by fleeing if all who remain standing have fled', () => {
    const { engine, party } = setup();
    for (const c of party) {
      Object.assign(c, { x: 0, y: c.y });
      c.fled = true;
    }
    expect(engine.outcome()).toBe('fled');
  });

  it('delay moves the actor to the end of the round, once', () => {
    const { engine, party } = setup({ monsters: ['kobold', 'kobold'] });
    engine.startRound();
    engine.nextTurn();
    const first = engine.active();
    const n = engine.order.length;
    const evs = engine.delay(first);
    expect(evs[0].type).toBe('delay');
    expect(engine.order[n - 1]).toBe(first);
    expect(engine.order).toHaveLength(n);
    // The next turn goes to whoever was second.
    engine.nextTurn();
    expect(engine.active()).not.toBe(first);
    expect(engine.delay(first)[0].type).toBe('log');
    void party;
  });

  it('bandage stops a dying ally from bleeding', () => {
    const { engine, party } = setup();
    const [a, b] = party;
    Object.assign(a, { x: 5, y: 7 });
    Object.assign(b, { x: 6, y: 7 });
    b.hp.cur = -3;
    b.ref.status = 'dying';
    activate(engine, a);
    expect(engine.dyingAlliesNear(a)).toContain(b);
    const evs = engine.bandage(a, b);
    expect(evs[0].type).toBe('bandage');
    expect(b.ref.status).toBe('unconscious');
    const before = b.hp.cur;
    engine.endRound();
    expect(b.hp.cur).toBe(before);
    // Not adjacent: refused.
    Object.assign(a, { x: 1, y: 1 });
    b.ref.status = 'dying';
    expect(engine.bandage(a, b)[0].type).toBe('log');
  });

  it('unbandaged dying characters bleed 1 hp per round', () => {
    const { engine, party } = setup();
    const b = party[1];
    b.hp.cur = -2;
    b.ref.status = 'dying';
    const evs = engine.endRound();
    expect(evs.some((e) => e.type === 'bleed' && e.id === b.id)).toBe(true);
    expect(b.hp.cur).toBe(-3);
  });

  it('turn undead affects skeletons and is once per combat', () => {
    const { engine, party } = setup({ monsters: ['skeleton', 'skeleton', 'skeleton'], partyId: 'veterans' });
    const cleric = party.find((c) => c.ref.levels?.cleric);
    expect(cleric).toBeTruthy();
    activate(engine, cleric);
    expect(engine.canTurn(cleric)).toBe(true);
    const evs = engine.turn(cleric);
    expect(evs[0].type).toBe('turnUndead');
    expect(['turned', 'destroyed', 'failed', 'none']).toContain(evs[0].result);
    if (evs[0].result === 'turned') expect(engine.monsters.some((m) => m.fleeing)).toBe(true);
    if (evs[0].result === 'destroyed') expect(evs.some((e) => e.type === 'down' && e.holy)).toBe(true);
    expect(engine.canTurn(cleric)).toBe(false);
  });

  it('turn undead is refused with no undead present', () => {
    const { engine, party } = setup({ monsters: ['orc'], partyId: 'veterans' });
    const cleric = party.find((c) => c.ref.levels?.cleric);
    expect(engine.canTurn(cleric)).toBe(false);
    expect(engine.turn(cleric)[0].type).toBe('log');
  });

  it('spell targeting checks range and line of sight; fireball hits everyone in the disc', () => {
    const { engine, party, mons, field } = setup({ monsters: ['orc', 'orc', 'orc'], partyId: 'veterans' });
    const mage = party.find((c) => c.ref.levels?.magicUser);
    Object.assign(mage, { x: 4, y: 7 });
    mons.forEach((m, i) => Object.assign(m, { x: 11, y: 6 + i }));
    activate(engine, mage);
    expect(engine.canCast(mage, 'fireball', { x: 11, y: 7 }).ok).toBe(true);
    expect(engine.canCast(mage, 'magicMissile', { x: 11, y: 7 }).reason).toBe('Out of range');
    field.block[field.idx(8, 7)] = 1;
    expect(engine.canCast(mage, 'fireball', { x: 11, y: 7 }).reason).toBe('No line of sight');
    field.block[field.idx(8, 7)] = 0;
    const area = engine.spellArea(mage, 'fireball', { x: 11, y: 7 });
    const inArea = new Set(area.map((s) => `${s.x},${s.y}`));
    for (const m of mons) expect(inArea.has(`${m.x},${m.y}`)).toBe(true);
  });

  it('a guard strikes the first enemy stepping next to it', () => {
    const { engine, party, mons } = setup({ monsters: ['orc'] });
    const hero = party[0];
    const orc = mons[0];
    Object.assign(hero, { x: 10, y: 7 });
    Object.assign(orc, { x: 13, y: 7 });
    activate(engine, hero);
    engine.guard(hero);
    activate(engine, orc);
    orc.hp.cur = orc.hp.max = 200;
    const evs = engine.move(orc, [{ x: 12, y: 7 }, { x: 11, y: 7 }]);
    const g = evs.filter((e) => e.type === 'attack' && e.guard);
    expect(g).toHaveLength(1);
    expect(hero.guarding).toBe(false);
  });

  it('the AI closes in and attacks a reachable foe', () => {
    const { engine, mons } = setup({ monsters: ['orc'] });
    const orc = mons[0];
    Object.assign(orc, { x: 9, y: 7 });
    activate(engine, orc);
    const plan = decide(engine, orc);
    expect(['attack', 'move']).toContain(plan.kind);
    if (plan.kind === 'attack') expect(plan.target.side).toBe('party');
  });
});
