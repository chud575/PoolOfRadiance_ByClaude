/**
 * Regression tests for the iteration-7 rules review: Spiritual Hammer damage
 * and plusses, spell attack rolls through the defender pipeline (Mirror
 * Image, Blink, Invisibility, Prot. from Evil), wand class restrictions,
 * turning while a cleric class is dormant, Silence 15' saves, `magicVs`,
 * one missile range scale, trap victims and passive detection, and
 * session-independent ids.
 */
import { describe, it, expect } from 'vitest';
import * as R from '../../src/rules/index.js';
import { ITEMS } from '../../src/data/items.js';

const { Rng } = R;
const BASE = { str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12 };
const mk = (race, classSpec, o = {}) => R.createCharacter({
  rng: new Rng(o.seed ?? 7), name: o.name ?? 'T', race, classSpec, level: o.level, items: o.items,
  abilities: { ...BASE, ...(o.a ?? {}) }, ignoreLimits: o.ignoreLimits, alignment: o.alignment,
});
const mon = (id, seed = 1, o = {}) => R.combatantFromMonster(new Rng(seed), id, 0, o);
const tough = (id, seed = 1) => {
  const m = mon(id, seed);
  m.hp = { cur: 500, max: 500 };
  return m;
};
const priest = (level = 3) => mk('human', 'cleric', { level, a: { wis: 16 }, seed: 11 });

// ------------------------------------------------------- spiritual hammer
describe('Spiritual Hammer (PHB): no plusses to hit or damage', () => {
  it('damage is a war hammer\'s 2-5 vs man-sized and 1-4 vs large, at every level', () => {
    for (const L of [3, 9]) {
      const dm = new Set();
      const dl = new Set();
      const rng = new Rng(100 + L);
      for (let i = 0; i < 400; i++) {
        const o = tough('orc', i);
        const h = R.hammerStrike(rng, priest(L), o, Math.ceil(L / 6));
        if (h.hit) dm.add(h.damage);
        const g = tough('ogre', i);
        const hl = R.hammerStrike(rng, priest(L), g, Math.ceil(L / 6));
        if (hl.hit) dl.add(hl.damage);
      }
      expect([...dm].sort()).toEqual([2, 3, 4, 5]);
      expect([...dl].sort()).toEqual([1, 2, 3, 4]);
    }
  });

  it('to-hit is the cleric\'s own THAC0: no +1 per 6 levels', () => {
    const c = priest(3);
    const o = tough('orc');
    const thac0 = R.deriveStats(c).thac0;
    const h = R.hammerStrike(new Rng(5), c, o, 1);
    expect(h.needed).toBe(R.neededToHit(thac0, o.ac, 0));
  });

  it('its magic only lets it strike creatures needing +1 weapons (and +2 from 7th level)', () => {
    const shadow = tough('shadow');
    const rng = new Rng(9);
    let hurt = 0;
    for (let i = 0; i < 60; i++) hurt += R.hammerStrike(rng, priest(3), shadow, 1).damage;
    expect(hurt).toBeGreaterThan(0);
    // A +2-only horror shrugs off a 3rd-level hammer.
    const horror = { ...tough('shadow'), ref: { ...shadow.ref, special: ['undead', 'magicToHit:2'] } };
    let immune = 0;
    for (let i = 0; i < 60; i++) {
      const h = R.hammerStrike(rng, priest(3), horror, 1);
      expect(h.damage).toBe(0);
      if (h.immune) immune++;
    }
    expect(immune).toBeGreaterThan(0);
    let hurt7 = 0;
    for (let i = 0; i < 60; i++) hurt7 += R.hammerStrike(rng, priest(7), horror, 2).damage;
    expect(hurt7).toBeGreaterThan(0);
  });

  it('the spell card says so', () => {
    const tip = R.getSpell('spiritualHammer').tip;
    expect(tip).toMatch(/1d4\+1/);
    expect(tip).not.toMatch(/to hit and damage per 6/);
  });
});

// ------------------------------------------- spell attacks through defences
describe('touch spells and the hammer go through the defender pipeline', () => {
  it('4 mirror images soak hammer blows and are dispelled one by one', () => {
    const rng = new Rng(31);
    const t = mk('human', 'magicUser', { level: 3, a: { int: 16 }, seed: 3 });
    t.hp = { cur: 300, max: 300 };
    R.addEffect(t, 'mirrorImage', { rounds: 50, data: { images: 4 } });
    let images = 0;
    let real = 0;
    for (let i = 0; i < 200 && R.hasEffect(t, 'mirrorImage') && R.getEffect(t, 'mirrorImage').rounds > 0; i++) {
      const h = R.hammerStrike(rng, priest(6), t, 1);
      if (h.image) images++;
      else if (h.hit) real++;
    }
    expect(images).toBe(4);
    const e = R.getEffect(t, 'mirrorImage');
    expect(!e || e.rounds <= 0 || e.data.images === 0).toBe(true);
  });

  it('Shocking Grasp strikes images too, and they vanish', () => {
    const rng = new Rng(32);
    const mage = mk('human', 'magicUser', { level: 5, a: { int: 16 }, seed: 5 });
    const t = tough('orc');
    R.addEffect(t, 'mirrorImage', { rounds: 50, data: { images: 4 } });
    let imageHits = 0;
    for (let i = 0; i < 50; i++) {
      const r = R.castSpell(rng, 'shockingGrasp', mage, [t], { check: false }).results[0];
      if (r.image) imageHits++;
    }
    expect(imageHits).toBe(4);
  });

  it('Blink makes about half of all Shocking Grasps miss outright', () => {
    const rng = new Rng(33);
    const mage = mk('human', 'magicUser', { level: 5, a: { int: 16 }, seed: 5 });
    let blinked = 0;
    let landed = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const t = tough('kobold', i);
      R.addEffect(t, 'blinking', { rounds: 10 });
      const r = R.castSpell(rng, 'shockingGrasp', mage, [t], { check: false }).results[0];
      if (r.blinked) blinked++;
      if (r.damage) landed++;
    }
    expect(blinked / N).toBeGreaterThan(0.42);
    expect(blinked / N).toBeLessThan(0.58);
    expect(landed / N).toBeLessThan(0.5);
  });

  it('Invisibility: a touch may still be tried, at -4', () => {
    const mage = mk('human', 'magicUser', { level: 5, a: { int: 16 }, seed: 5 });
    const seen = tough('orc');
    const unseen = tough('orc');
    R.addEffect(unseen, 'invisible', { rounds: 10 });
    const a = R.spellAttack(new Rng(1), mage, seen, { str: true });
    const b = R.spellAttack(new Rng(1), mage, unseen, { str: true });
    expect(b.needed).toBe(a.needed + 4);
    const r = R.castSpell(new Rng(2), 'shockingGrasp', mage, [unseen], { check: false }).results[0];
    expect(r.immune).toBeFalsy();
  });

  it('Cause Light Wounds by an evil acolyte is at -2 against Prot. from Evil', () => {
    const acolyte = mon('acolyte', 4);
    expect(R.isEvil(acolyte)).toBe(true);
    const f = mk('human', 'fighter', { seed: 8 });
    const base = R.spellAttack(new Rng(1), acolyte, f, { str: true }).needed;
    R.addEffect(f, 'protEvil', { rounds: 10 });
    expect(R.spellAttack(new Rng(1), acolyte, f, { str: true }).needed).toBe(base + 2);
    // ...and the spell itself honours it: fewer touches land.
    const hitsWith = (warded) => {
      const rng = new Rng(77);
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const t = mk('human', 'fighter', { seed: 8 });
        t.hp = { cur: 200, max: 200 };
        if (warded) R.addEffect(t, 'protEvil', { rounds: 10 });
        const r = R.castSpell(rng, 'causeLightWounds', acolyte, [t], { check: false }).results[0];
        if (r.damage !== undefined) n++;
      }
      return n;
    };
    expect(hitsWith(true)).toBeLessThan(hitsWith(false) - 20);
  });

  it('a touch never adds the caster\'s weapon enchantment', () => {
    const plain = mk('human', 'cleric', { level: 3, a: { wis: 16 }, items: ['mace'], seed: 2 });
    const magic = mk('human', 'cleric', { level: 3, a: { wis: 16 }, items: ['mace'], seed: 2 });
    magic.inventory.find((e) => e.id === 'mace').magic = 3;
    const t = tough('orc');
    expect(R.spellAttack(new Rng(1), magic, t, { str: true }).needed).toBe(R.spellAttack(new Rng(1), plain, t, { str: true }).needed);
  });
});

// ------------------------------------------------------------------ wands
describe('wands are magic-user items (DMG M)', () => {
  for (const id of ['wandFire', 'wandLightning', 'wandParalyzation', 'wandMagicMissile']) {
    it(`a fighter cannot discharge a ${ITEMS[id].name}; a magic-user can`, () => {
      const f = mk('human', 'fighter', { items: [id] });
      const i = f.inventory.findIndex((e) => e.id === id);
      const t = tough('orc');
      const u = R.useItem(new Rng(1), f, i, [t]);
      expect(u.ok).toBe(false);
      expect(u.reason).toBe('class cannot use');
      expect(t.hp.cur).toBe(500);
      expect(R.battleItemUse(f, i).kind).toBeNull();
      const m = mk('human', 'magicUser', { a: { int: 16 }, items: [id] });
      expect(R.battleItemUse(m, m.inventory.findIndex((e) => e.id === id)).kind).toBe('spell');
    });
  }
  it('a fighter/magic-user may use one', () => {
    const fm = mk('halfElf', 'fighter/magicUser', { a: { int: 16, str: 14 }, items: ['wandFire'] });
    expect(R.battleItemUse(fm, fm.inventory.findIndex((e) => e.id === 'wandFire')).kind).toBe('spell');
  });
});

// ------------------------------------------------------------ turn undead
describe('turning needs an active cleric class', () => {
  it('a C4 who dual-classed to F1 cannot turn until the fighter level exceeds 4', () => {
    const h = mk('human', 'cleric', { level: 4, a: { wis: 17, str: 17 }, seed: 12 });
    expect(R.turnLevel(h)).toBe(4);
    expect(R.canTurnUndead(h)).toBe(true);
    R.dualClass(h, 'fighter');
    expect(h.levels.cleric).toBe(4);
    expect(R.turnLevel(h)).toBe(0);
    expect(R.canTurnUndead(R.combatantFromCharacter(h))).toBe(false);
    h.levels.fighter = 5;
    expect(R.turnLevel(h)).toBe(4);
  });
  it('fighters, thieves and monsters never turn; combatants work like characters', () => {
    expect(R.turnLevel(mk('human', 'fighter'))).toBe(0);
    expect(R.turnLevel(mon('acolyte'))).toBe(0);
    expect(R.turnLevel(R.combatantFromCharacter(priest(5)))).toBe(5);
  });
});

// ------------------------------------------------------------- silence 15'
describe('Silence 15\' Radius: no save in the area (PHB)', () => {
  it('everyone in the sphere is silenced, whatever their save', () => {
    const rng = new Rng(41);
    for (let i = 0; i < 30; i++) {
      const foes = [mon('banePriest', i), mon('acolyte', i + 100), mon('acolyte', i + 200)];
      const r = R.castSpell(rng, 'silence15', priest(5), foes, { check: false });
      for (const tr of r.results) {
        expect(tr.save).toBeUndefined();
        expect(tr.applied).toContain('silenced');
      }
    }
  });
  it('a creature the spell is cast upon saves to negate', () => {
    const rng = new Rng(42);
    let saved = 0;
    for (let i = 0; i < 60; i++) {
      const target = mon('banePriest', i);
      const other = mon('acolyte', i + 50);
      const r = R.castSpell(rng, 'silence15', priest(5), [target, other], { check: false, centre: target });
      expect(r.results[0].save).toBeDefined();
      expect(r.results[1].save).toBeUndefined();
      if (r.results[0].saved) saved++;
    }
    expect(saved).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------- magicVs
describe('magicVs: situational enchantment', () => {
  const holyMace = () => {
    const c = mk('human', 'fighter', { items: ['mace'], seed: 21 });
    const e = c.inventory.find((x) => x.id === 'mace');
    e.magic = 1;
    e.magicVs = { undead: 2 };
    return c;
  };
  it('deriveStats and the combatant carry it', () => {
    const c = holyMace();
    expect(R.deriveStats(c).weaponMagicVs).toEqual({ undead: 2 });
    expect(R.combatantFromCharacter(c).magicVs).toEqual({ undead: 2 });
  });
  it('adds to hit and damage only against matching foes', () => {
    const a = R.combatantFromCharacter(holyMace());
    const sk = tough('skeleton');
    const orc = tough('orc');
    expect(R.magicVsFor(a, sk)).toBe(2);
    expect(R.magicVsFor(a, orc)).toBe(0);
    const plainA = R.combatantFromCharacter(mk('human', 'fighter', { items: ['mace'], seed: 21 }));
    plainA.ref.inventory.find((x) => x.id === 'mace').magic = 1;
    const pa = R.combatantFromCharacter(plainA.ref);
    expect(R.hitChance(a, sk) - R.hitChance(pa, sk)).toBeCloseTo(0.1, 6);
    expect(R.hitChance(a, orc)).toBeCloseTo(R.hitChance(pa, orc), 6);
    // Damage: mace 1d6+1, +1 magic, +2 vs undead → 5..10 against a skeleton.
    const rng = new Rng(3);
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const r = R.resolveAttack(rng, a, tough('skeleton', i));
      if (r.hit && !r.image) seen.add(r.damage);
    }
    expect(Math.min(...seen)).toBe(5);
    expect(Math.max(...seen)).toBe(10);
  });
  it('alignment and family keys work, best match wins', () => {
    expect(R.magicVsBonus({ evil: 1, undead: 3 }, mon('skeleton'))).toBe(3);
    expect(R.magicVsBonus({ evil: 2 }, mon('acolyte'))).toBe(2);
    expect(R.magicVsBonus({ giant: 3 }, mon('hillGiant'))).toBe(3);
    expect(R.magicVsBonus({ giant: 3 }, mon('ogre'))).toBe(0);
    expect(R.magicVsBonus(null, mon('ogre'))).toBe(0);
  });
  it('the extra plus counts against weapon immunity', () => {
    const c = mk('human', 'fighter', { items: ['mace'], seed: 21 });
    const e = c.inventory.find((x) => x.id === 'mace');
    e.magicVs = { undead: 1 }; // a mundane mace that is +1 vs undead
    const a = R.combatantFromCharacter(c);
    const rng = new Rng(4);
    let dmg = 0;
    for (let i = 0; i < 60; i++) dmg += R.resolveAttack(rng, a, tough('shadow', i)).damage;
    expect(dmg).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------ one missile scale
describe('missile ranges: one documented scale (1 square = 1 PHB inch)', () => {
  it('every PHB missile weapon reaches its long range in squares', () => {
    expect(R.SQUARES_PER_INCH).toBe(1);
    for (const [g, [, , long]] of Object.entries(R.MISSILE_RANGES)) {
      const def = { id: g, type: 'weapon', ranged: true };
      expect([g, R.missileRange(def)]).toEqual([g, Math.floor(long)]);
    }
    for (const [g, r] of Object.entries(R.THROWN_RANGE)) expect([g, r]).toEqual([g, Math.floor(R.MISSILE_RANGES[g][2])]);
  });
  it('the world\'s bows and darts use it, whatever their data range', () => {
    expect(R.missileRange(ITEMS.shortBow)).toBe(15);
    expect(R.missileRange(ITEMS.longBow)).toBe(21);
    expect(R.missileRange(ITEMS.dart)).toBe(4);
    expect(R.missileRangeBands(ITEMS.shortBow)).toEqual({ short: 5, medium: 10, long: 15 });
    const archer = mk('elf', 'fighter', { items: ['longBow', 'arrows'], a: { dex: 16 } });
    expect(R.missileProfile(archer).range).toBe(21);
    expect(R.deriveStats(archer).range).toBe(21);
  });
  it('a dagger and a dart are on the same scale as a bow (no per-weapon compression)', () => {
    const per = (def) => R.missileRange(def) / R.MISSILE_RANGES[def.weaponGroup ?? def.id][2];
    const dagger = R.throwableDef(ITEMS.dagger);
    expect(per(dagger)).toBeCloseTo(per(ITEMS.shortBow), 1);
    expect(per(ITEMS.longBow)).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------- traps
describe('traps: the fumbling thief is the victim; passive detection is a labelled QoL rule', () => {
  const party = () => [
    mk('human', 'fighter', { name: 'Lead', seed: 1, a: { con: 16 } }),
    mk('halfling', 'thief', { name: 'Pip', seed: 2, a: { dex: 17 } }),
  ];
  it('a disarm fumble springs a lead trap on the thief, not on members[0]', () => {
    let checked = 0;
    for (let s = 0; s < 400 && checked < 5; s++) {
      const p = party();
      const state = { trap: 'scythingBlade', found: true };
      const r = R.resolveTrap(new Rng(s), p, state);
      if (!r.sprung) continue;
      checked++;
      expect(r.victims.map((v) => v.ch.name)).toEqual(['Pip']);
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('an unseen trap stepped on strikes the lead', () => {
    const p = party();
    const r = R.springTrap(new Rng(3), p, 'pit');
    expect(r.victims[0].ch.name).toBe('Lead');
  });
  it('passive detection is on by default (QoL) and off by the book', () => {
    expect(R.PASSIVE_TRAP_DETECTION).toBe(true);
    let passive = 0;
    let strict = 0;
    let searched = 0;
    for (let s = 0; s < 200; s++) {
      if (R.detectTrap(new Rng(s), party(), { mod: 0 }).found) passive++;
      if (R.detectTrap(new Rng(s), party(), { mod: 0 }, { strict1e: true }).found) strict++;
      if (R.detectTrap(new Rng(s), party(), { mod: 0 }, { strict1e: true, search: true }).found) searched++;
    }
    expect(passive).toBeGreaterThan(0);
    expect(strict).toBe(0);
    expect(searched).toBe(passive);
  });
  it('trap attacks use the same nat-20 / nat-1 rule as weapons', () => {
    // A THAC0 50 trap needs far more than 20 (past the repeating-20 band): only the QoL natural 20 hits.
    let hits = 0;
    let strictHits = 0;
    for (let s = 0; s < 400; s++) {
      const t = { name: 'feeble', who: 'lead', attack: 50, dice: '1' };
      if (R.springTrap(new Rng(s), party(), t).victims[0].hit) hits++;
      if (R.springTrap(new Rng(s), party(), t, { strict1e: true }).victims[0].hit) strictHits++;
    }
    expect(hits).toBeGreaterThan(5);
    expect(hits).toBeLessThan(40);
    expect(strictHits).toBe(0);
  });
});

// ------------------------------------------------------------------- ids
describe('ids do not depend on session history', () => {
  it('monster ids are scoped to the battle Rng', () => {
    for (let i = 0; i < 25; i++) R.combatantFromMonster(new Rng(99), 'orc');
    const rng = new Rng(5);
    const a = [R.combatantFromMonster(rng, 'kobold', 1), R.combatantFromMonster(rng, 'kobold', 2), R.combatantFromMonster(rng, 'orc', 1)];
    expect(a.map((m) => m.id)).toEqual(['m1_kobold', 'm2_kobold', 'm3_orc']);
    expect(R.combatantFromMonster(new Rng(5), 'kobold', 1, { id: 'boss' }).id).toBe('boss');
  });
  it('character ids repeat for the same seed, however many were made before', () => {
    const make = () => R.createCharacter({ rng: new Rng(17), name: 'A', race: 'human', classSpec: 'fighter', abilities: { ...BASE, str: 15 } });
    const first = make().id;
    for (let i = 0; i < 10; i++) make();
    expect(make().id).toBe(first);
    const rng = new Rng(17);
    const x = R.createCharacter({ rng, name: 'A', race: 'human', classSpec: 'fighter', abilities: { ...BASE, str: 15 } });
    const y = R.createCharacter({ rng, name: 'A', race: 'human', classSpec: 'fighter', abilities: { ...BASE, str: 15 } });
    expect(x.id).not.toBe(y.id);
  });
});

// ----------------------------------------------------------- 0-level men
describe('0-level men: THAC0 20 and level-0 saves, one ruling', () => {
  it('bandits, buccaneers and thugs save as 0-level men', () => {
    for (const id of ['bandit', 'buccaneer', 'thug']) {
      const m = mon(id);
      expect([id, R.isZeroLevelMan(m)]).toEqual([id, true]);
      expect(m.thac0).toBe(20);
      expect(m.saves).toEqual(R.savesFor('fighter', 0));
    }
  });
  it('leaders, class NPCs and humanoids are not 0-level men', () => {
    for (const id of ['banditLeader', 'acolyte', 'orc', 'koboldChief']) expect([id, R.isZeroLevelMan(mon(id))]).toEqual([id, false]);
  });
});
