import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import {
  createCharacter, missileProfile, useMissile, canBackstab, backstabMultiplierOf, deriveStats, dualClass,
} from '../../src/rules/character.js';
import { makeEntry, rangeModifier, throwableDef, THROWN_RANGE } from '../../src/rules/items.js';
import { combatantFromCharacter, combatantFromMonster, weaponImmunity, isHurledAttack, hitChance } from '../../src/rules/combat.js';
import { addEffect, hasEffect, clearCombatEffects } from '../../src/rules/conditions.js';
import { castSpell } from '../../src/rules/spells.js';
import { useItem } from '../../src/rules/magicItems.js';
import { magicTableIBand, rollMagicItem } from '../../src/rules/treasure.js';
import { triggerMapTrap, mapTrapState, TRAPS, findRemoveTraps } from '../../src/rules/explore.js';
import { getMap } from '../../src/data/maps/index.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';

/**
 * Iteration 6: the missile path (timed effects already on the archer, magic
 * ammunition, thrown weapons used up), invisibility broken by hostile casting,
 * backstab only for an active thief class, the trap pipeline reached from a
 * map, DMG Table I bands, and round-measured wards ending with the battle.
 */

const abil = (o = {}) => ({ str: 16, strPct: 0, int: 16, wis: 12, dex: 10, con: 14, cha: 10, ...o });
const mk = (race, classSpec, o = {}) => createCharacter({
  rng: new Rng(o.seed ?? 1), name: o.name ?? `${race} ${classSpec}`, race, classSpec, level: o.level ?? 1,
  abilities: abil(o.abilities), items: o.items ?? [],
});
const tough = (m) => { m.hp.cur = m.hp.max = 999; return m; };

/** An engine with the party at x=2 and the foes `dist` squares east. */
function battle(party, monsterIds, dist = 6, seed = 3) {
  const rng = new Rng(seed);
  const field = new Battlefield(null, { x: 0, y: 0 });
  const mons = monsterIds.map((id, i) => tough(combatantFromMonster(rng, id, i + 1)));
  party.forEach((c, i) => Object.assign(c, { x: 2, y: 3 + i }));
  mons.forEach((c, i) => Object.assign(c, { x: 2 + dist, y: 3 + i }));
  const engine = new CombatEngine({ rng, field, party, monsters: mons });
  return { engine, mons, rng };
}
function activate(engine, c) {
  engine.order = [c, ...engine.all.filter((o) => o !== c)];
  engine.turnIdx = 0;
  engine.round = Math.max(1, engine.round);
  c.mp = 12;
  c.attacksLeft = 2;
  c.acted = false;
}

describe('missile attacks keep the timed effects already on the archer', () => {
  const archerWith = (fx) => {
    const ch = mk('human', 'fighter', { items: ['shortBow', 'arrows'] });
    if (fx) addEffect(ch, fx, { rounds: 50 });
    return combatantFromCharacter(ch); // built AFTER the effect
  };
  const chanceAt = (c, dist) => {
    const { engine, mons } = battle([c], ['orc'], dist);
    return engine.preview(c, mons[0], true).chance;
  };

  it('profile includes fx.hit / fx.dmg (Bestow Curse -4, Prayer +1/+1)', () => {
    const plain = missileProfile(mk('human', 'fighter', { items: ['shortBow', 'arrows'] }));
    const cursed = mk('human', 'fighter', { items: ['shortBow', 'arrows'] });
    addEffect(cursed, 'bestowCurse', { rounds: 50 });
    expect(missileProfile(cursed).hitBonus).toBe(plain.hitBonus - 4);
    const prayed = mk('human', 'fighter', { items: ['shortBow', 'arrows'] });
    addEffect(prayed, 'prayer', { rounds: 50 });
    expect(missileProfile(prayed).hitBonus).toBe(plain.hitBonus + 1);
    expect(missileProfile(prayed).dmgBonus).toBe(plain.dmgBonus + 1);
  });

  it('a cursed or blinded archer hits less often at range, a blessed one more', () => {
    const base = chanceAt(archerWith(null), 5);
    expect(chanceAt(archerWith('bestowCurse'), 5)).toBeCloseTo(base - 0.2, 6);
    expect(chanceAt(archerWith('blinded'), 5)).toBeCloseTo(base - 0.2, 6);
    expect(chanceAt(archerWith('diseased'), 5)).toBeCloseTo(base - 0.1, 6);
    expect(chanceAt(archerWith('blessed'), 5)).toBeCloseTo(base + 0.05, 6);
  });

  it('the critic case: a cursed archer at long range is at the 5% floor, not 10%', () => {
    // THAC0 20 vs orc AC 6 → 14; long range -5 → 19 (10%); curse -4 → 23 → 20 on the 1e table (5%).
    expect(chanceAt(archerWith(null), 9)).toBeCloseTo(0.1, 6);
    expect(chanceAt(archerWith('bestowCurse'), 9)).toBeCloseTo(0.05, 6);
  });

  it('an effect added after the combatant was built counts once, not twice', () => {
    const c = archerWith(null);
    const before = chanceAt(c, 5);
    addEffect(c.ref, 'blessed', { rounds: 10 });
    expect(chanceAt(c, 5)).toBeCloseTo(before + 0.05, 6);
    addEffect(c.ref, 'bestowCurse', { rounds: 10 });
    expect(chanceAt(c, 5)).toBeCloseTo(before - 0.15, 6);
  });

  it('melee and missile agree on the curse penalty', () => {
    const c = archerWith('bestowCurse');
    const { engine, mons } = battle([c], ['orc'], 1);
    const melee = engine.preview(c, mons[0], false).chance;
    const clean = archerWith(null);
    const b2 = battle([clean], ['orc'], 1);
    expect(melee).toBeCloseTo(b2.engine.preview(clean, b2.mons[0], false).chance - 0.2, 6);
  });
});

describe('magic ammunition (DMG)', () => {
  const bowWith = (ammo, o = {}) => {
    const ch = mk(o.race ?? 'human', 'fighter', { items: [o.bow ?? 'shortBow'] });
    for (const a of ammo) ch.inventory.push(makeEntry(a.id ?? 'arrows', { magic: a.magic, identified: true, qty: a.qty }));
    for (const [i, a] of ammo.entries()) if (a.equipped) ch.inventory[ch.inventory.length - ammo.length + i].equipped = true;
    return ch;
  };

  it('arrows +2 add +2 to hit and +2 damage and count as +2 magic', () => {
    const plain = missileProfile(bowWith([{ magic: 0 }]));
    const p = missileProfile(bowWith([{ magic: 2 }]));
    expect(p.hitBonus).toBe(plain.hitBonus + 2);
    expect(p.dmgBonus).toBe(plain.dmgBonus + 2);
    expect(p.magic).toBe(2);
    expect(p.ammoMagic).toBe(2);
  });

  it('a +1 bow with +2 arrows: +3 to hit, +2 damage (launcher adds to hit only), magic 2', () => {
    const ch = bowWith([{ magic: 2 }]);
    ch.inventory[0] = makeEntry('longBow', { magic: 1, identified: true });
    ch.inventory[0].equipped = true;
    const p = missileProfile(ch);
    expect(p.hitBonus).toBe(3);
    expect(p.dmgBonus).toBe(2);
    expect(p.magic).toBe(2);
  });

  it('magic arrows can hit a shadow; plain ones cannot', () => {
    for (const [magic, immune] of [[0, true], [2, false]]) {
      const c = combatantFromCharacter(bowWith([{ magic }]));
      const { engine, mons } = battle([c], ['shadow'], 5);
      const a = engine.attackerFor(c, true);
      expect(!!weaponImmunity(a, mons[0])).toBe(immune);
    }
  });

  it('the equipped stack is used first, else the best enchantment; cursed -1 only when nothing else is left', () => {
    expect(missileProfile(bowWith([{ magic: 0, equipped: true }, { magic: 3 }])).ammoMagic).toBe(0);
    expect(missileProfile(bowWith([{ magic: 0 }, { magic: 3 }, { magic: 1 }])).ammoMagic).toBe(3);
    expect(missileProfile(bowWith([{ magic: -1 }, { magic: 0 }])).ammoMagic).toBe(0);
    const cursed = missileProfile(bowWith([{ magic: -1 }]));
    expect(cursed.hitBonus).toBe(-1);
    expect(cursed.dmgBonus).toBe(-1);
  });

  it('the character sheet agrees: an equipped bow with +2 arrows shows +2 to hit and damage', () => {
    const ch = bowWith([{ magic: 2 }]);
    ch.inventory[0].equipped = true;
    const s = deriveStats(ch);
    expect(s.hitBonus).toBe(2);
    expect(s.dmgBonus).toBe(2);
    expect(s.weaponMagic).toBe(2);
  });

  it('quarrels +1 work in a crossbow; arrows do not', () => {
    expect(missileProfile(bowWith([{ id: 'arrows', magic: 1 }], { bow: 'lightCrossbow' }))).toBeNull();
    expect(missileProfile(bowWith([{ id: 'quarrels', magic: 1 }], { bow: 'lightCrossbow' })).dmgBonus).toBe(1);
  });

  it('the engine shoots the magic stack and uses it up', () => {
    const ch = bowWith([{ magic: 0, qty: 5 }, { magic: 2, qty: 2 }]);
    const c = combatantFromCharacter(ch);
    const { engine, mons } = battle([c], ['orc'], 4);
    activate(engine, c);
    engine.attack(c, mons[0]);
    const magic = ch.inventory.find((e) => e.id === 'arrows' && e.magic === 2);
    const plain = ch.inventory.find((e) => e.id === 'arrows' && e.magic === 0);
    expect(magic.qty).toBeLessThan(2);
    expect(plain.qty).toBe(5);
  });
});

describe('thrown weapons are used up', () => {
  it('one dart: thrown once, then there is nothing left to throw', () => {
    const ch = mk('human', 'fighter', { items: ['longSword'] });
    ch.inventory.push(makeEntry('dart', { qty: 1 }));
    const p = missileProfile(ch);
    expect(p.consumes).toBe(ch.inventory[1]);
    useMissile(ch, p);
    expect(missileProfile(ch)).toBeNull();
    expect(ch.inventory.some((e) => e.id === 'dart')).toBe(false);
  });

  it('the engine decrements a dart stack per dart, and stops when it is empty', () => {
    const ch = mk('human', 'fighter', { items: ['longSword'] });
    ch.inventory.push(makeEntry('dart', { qty: 2 }));
    const c = combatantFromCharacter(ch);
    const { engine, mons } = battle([c], ['orc'], 4);
    activate(engine, c);
    c.attacksLeft = 3;
    const before = 2;
    const ev = engine.attack(c, mons[0]).filter((e) => e.type === 'attack' && e.ranged);
    const left = ch.inventory.find((e) => e.id === 'dart')?.qty ?? 0;
    expect(left).toBe(before - ev.length);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.length).toBe(2); // rate of fire 3, but only two darts
    expect(engine.rangedProfile(c)).toBeNull();
    expect(engine.canAttack(c, mons[0]).ok).toBe(false);
  });

  it('daggers, hand axes and spears have thrown ranges; a spare one is hurled, never the only one in hand', () => {
    for (const g of ['dagger', 'handAxe', 'spear', 'javelin']) expect(THROWN_RANGE[g]).toBeGreaterThan(0);
    expect(throwableDef({ id: 'dagger', type: 'weapon', damage: '1d4' }).range).toBe(4);
    const lone = mk('human', 'fighter', { items: ['dagger'] });
    expect(missileProfile(lone)).toBeNull();
    const spare = mk('human', 'fighter', { items: ['longSword', 'dagger'] });
    const p = missileProfile(spare);
    expect(p.thrown).toBe(true);
    expect(p.def.range).toBe(4);
    expect(p.consumes.id).toBe('dagger');
    expect(rangeModifier(p.def, 4).band).toBe('long');
    expect(rangeModifier(p.def, 5).inRange).toBe(false);
    const axes = mk('human', 'fighter', { items: ['handAxe'] });
    axes.inventory[0].qty = 2;
    expect(missileProfile(axes)?.def.id).toBe('handAxe');
  });

  it('a thrown dagger meets the Shield spell at AC 2 (hurled), an arrow at AC 3', () => {
    const thrower = combatantFromCharacter(mk('human', 'fighter', { items: ['longSword', 'dagger'] }));
    expect(isHurledAttack(thrower)).toBe(true);
    const mage = mk('human', 'magicUser', { abilities: { dex: 10 } });
    addEffect(mage, 'shielded', { rounds: 10 });
    const s = deriveStats(mage);
    expect(s.acHurled).toBe(2);
    expect(s.acMissile).toBe(3);
  });
});

describe('hostile spells end invisibility (PHB)', () => {
  it('an invisible magic-user casting Magic Missile becomes visible', () => {
    const mu = mk('human', 'magicUser', { level: 3 });
    const orc = combatantFromMonster(new Rng(2), 'orc');
    addEffect(mu, 'invisible', { rounds: Infinity });
    const r = castSpell(new Rng(4), 'magicMissile', mu, [orc], { check: false });
    expect(r.ok).toBe(true);
    expect(hasEffect(mu, 'invisible')).toBe(false);
    expect(r.log.join(' ')).toMatch(/into view/);
  });

  it('a non-hostile spell (Shield) keeps the caster unseen', () => {
    const mu = mk('human', 'magicUser', { level: 3 });
    addEffect(mu, 'invisible', { rounds: Infinity });
    castSpell(new Rng(4), 'shield', mu, [], { check: false });
    expect(hasEffect(mu, 'invisible')).toBe(true);
  });

  it('releasing a wand of magic missiles also reveals the user', () => {
    const mu = mk('human', 'magicUser', { level: 3 });
    mu.inventory.push(makeEntry('wandMagicMissile', { charges: 5 }));
    addEffect(mu, 'invisible', { rounds: Infinity });
    const orc = combatantFromMonster(new Rng(2), 'orc');
    useItem(new Rng(5), mu, mu.inventory.length - 1, [orc]);
    expect(hasEffect(mu, 'invisible')).toBe(false);
  });
});

describe('backstab follows the active thief class', () => {
  it('a thief 5 backstabs ×3; a fighter never', () => {
    const t = mk('human', 'thief', { level: 5, items: ['shortSword', 'leather'] });
    expect(canBackstab(t)).toBe(true);
    expect(backstabMultiplierOf(t)).toBe(3);
    expect(canBackstab(mk('human', 'fighter'))).toBe(false);
  });

  it('a human who dual-classed away from thief cannot backstab until the new class passes the old level', () => {
    const ch = mk('human', 'thief', { level: 5, abilities: { str: 17, dex: 16 }, items: ['shortSword', 'leather'] });
    dualClass(ch, 'fighter');
    expect(backstabMultiplierOf(ch)).toBe(0);
    expect(canBackstab(ch)).toBe(false);
    expect(deriveStats(ch).backstab).toBe(0);
    // engine: behind an ogre, a plain rear attack (+2), not a backstab
    const c = combatantFromCharacter(ch);
    const { engine, mons } = battle([c], ['ogre'], 1);
    Object.assign(mons[0], { facing: 2 });
    const m = engine.attackMods(c, mons[0]);
    expect(m.rear).toBe(true);
    expect(m.backstab).toBe(false);
    // Once the fighter level exceeds 5, the thief abilities return.
    ch.levels.fighter = 6;
    expect(backstabMultiplierOf(ch)).toBe(3);
    expect(engine.attackMods(Object.assign(combatantFromCharacter(ch), { x: c.x, y: c.y }), mons[0]).backstab).toBe(true);
  });

  it('the preview multiplies backstab damage by the rules multiplier', () => {
    const t = combatantFromCharacter(mk('human', 'thief', { level: 5, items: ['shortSword', 'leather'] }));
    const { engine, mons } = battle([t], ['ogre'], 1);
    Object.assign(mons[0], { facing: 2 });
    const p = engine.preview(t, mons[0]);
    const [lo] = p.dmg.split('-').map(Number);
    expect(lo).toBe(Math.max(1, 1 + t.dmgBonus) * 3);
    expect(p.chance).toBeCloseTo(hitChance(t, mons[0], 0, { backstab: true }), 6);
  });
});

describe('traps reached from the map', () => {
  const party = () => [mk('human', 'fighter', { name: 'Brand', items: ['longSword', 'chainMail'] }), mk('human', 'cleric', { name: 'Ansel' })];

  it("Kuto's Warrens has trap events naming catalogue traps", () => {
    const m = getMap('kutos_warrens');
    const traps = [m.eventsAt(7, 8), m.eventsAt(5, 9)].flat().filter((e) => e.type === 'trap');
    expect(traps.length).toBe(2);
    for (const t of traps) expect(TRAPS[t.trap]).toBeTruthy();
  });

  it('a sprung one-shot trap is stored in game.flags and stays quiet afterwards', () => {
    const ev = getMap('kutos_warrens').eventsAt(5, 9).find((e) => e.type === 'trap');
    const game = { party: party(), flags: {} };
    let r;
    // Nobody here finds traps: the pit springs.
    for (let seed = 1; seed < 40 && !(r?.sprung); seed++) {
      game.flags = {};
      r = triggerMapTrap(new Rng(seed), game, ev);
    }
    expect(r.sprung).toBe(true);
    expect(game.flags.traps[ev.id].sprung).toBe(true);
    expect(r.lines[0].tone).toBe('warn');
    expect(r.lines[0].text).toMatch(/kobold pit/);
    const again = triggerMapTrap(new Rng(1), game, ev);
    expect(again.quiet).toBe(true);
    expect(again.sprung).toBe(false);
  });

  it('a thief can find and disarm it; the flag remembers', () => {
    const ev = { id: 't1', type: 'trap', trap: 'dartVolley', avoidable: true };
    const thief = mk('halfling', 'thief', { level: 9, abilities: { dex: 18 }, items: ['leather'] });
    let r;
    let game;
    for (let seed = 1; seed < 60 && !(r?.removed); seed++) {
      game = { party: [thief], flags: {} };
      r = triggerMapTrap(new Rng(seed), game, ev);
    }
    expect(r.removed).toBe(true);
    expect(mapTrapState(game, 't1')).toMatchObject({ found: true, removed: true });
    expect(triggerMapTrap(new Rng(1), game, ev).quiet).toBe(true);
  });

  it('the fumble rule is a labelled house rule; safe mode never springs', () => {
    const t = mk('human', 'thief', { level: 1, items: ['leather'] });
    for (let s = 1; s < 50; s++) expect(findRemoveTraps(new Rng(s), t, { mod: -50 }, { safe: true }).sprung).toBe(false);
  });
});

describe('DMG Table I bands', () => {
  it('potions 1-20, scrolls 21-35, rings 36-40, wands 41-45, misc 46-60, armour 61-75, swords 76-86, weapons 87-100', () => {
    const want = [[1, 'potions'], [20, 'potions'], [21, 'scrolls'], [35, 'scrolls'], [36, 'rings'], [40, 'rings'], [41, 'wands'], [45, 'wands'],
      [46, 'misc'], [60, 'misc'], [61, 'armor'], [75, 'armor'], [76, 'swords'], [86, 'swords'], [87, 'weapons'], [100, 'weapons']];
    for (const [r, c] of want) expect(magicTableIBand(r)).toBe(c);
  });

  it('"armour or weapon" rolls only arms and armour; magic darts come in a handful', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 200; i++) {
      const e = rollMagicItem(rng, 'armsArmor');
      expect(['weapon', 'armor', 'shield', 'ammo']).toContain(e && (e.id === 'shield' ? 'shield' : ['arrows', 'quarrels'].includes(e.id) ? 'ammo' : e.id && deriveTypeOf(e.id)));
      if (e.id === 'dart') expect(e.qty).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('round-measured wards end with the battle', () => {
  it('Protection from Evil and Friends go, Resist Fire and Strength stay', () => {
    const ch = mk('human', 'fighter');
    for (const id of ['protEvil', 'protGood', 'friends', 'resistFire', 'strength']) addEffect(ch, id, { rounds: 30 });
    clearCombatEffects(ch);
    expect(hasEffect(ch, 'protEvil')).toBe(false);
    expect(hasEffect(ch, 'protGood')).toBe(false);
    expect(hasEffect(ch, 'friends')).toBe(false);
    expect(hasEffect(ch, 'resistFire')).toBe(true);
    expect(hasEffect(ch, 'strength')).toBe(true);
  });
});

import { ITEMS } from '../../src/data/items.js';
function deriveTypeOf(id) { return ITEMS[id]?.type; }
