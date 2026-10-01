/**
 * Adversarial probes from the iteration-3 rules review, kept as regression
 * tests: person tagging, multiclass casting class, dual-class hit points,
 * fighter-only potions, item save categories, protection-item stacking,
 * treasure tables, class-NPC saves, exploration time, monster specials.
 */
import { describe, it, expect } from 'vitest';
import * as R from '../../src/rules/index.js';
import { MONSTERS } from '../../src/data/monsters.js';
import { ITEMS } from '../../src/data/items.js';

const { Rng } = R;
const BASE = { str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12 };
const mk = (race, classSpec, o = {}) => R.createCharacter({
  rng: new Rng(o.seed ?? 7), name: o.name ?? 'T', race, classSpec, level: o.level, items: o.items,
  abilities: { ...BASE, ...(o.a ?? {}) }, ignoreLimits: o.ignoreLimits,
});
const mon = (id, seed = 1) => R.combatantFromMonster(new Rng(seed), id);
const caster = (o = {}) => ({ id: 'cx', name: 'Caster', side: 'party', hp: { cur: 20, max: 20 }, casterLevel: 5, ...o });

// --------------------------------------------------------------- persons
describe('PHB persons are derived, not whitelisted', () => {
  const PERSONS = ['kobold', 'goblin', 'orc', 'hobgoblin', 'gnoll', 'lizardMan', 'buccaneer', 'thug', 'koboldChief',
    'orcLeader', 'hobgoblinChief', 'bandit', 'banditLeader', 'acolyte', 'banePriest'];
  const NOT = ['giantRat', 'skeleton', 'zombie', 'ghoul', 'bugbear', 'ogre', 'troll', 'giantSpider', 'shadow', 'wight',
    'ghast', 'spectre', 'hillGiant', 'wolf', 'giantFrog', 'giantCentipede', 'tyranthraxus'];

  it('every human and humanoid MONSTERS entry is a person; giants, beasts and undead are not', () => {
    for (const id of PERSONS.filter((x) => MONSTERS[x])) expect([id, R.isPerson(MONSTERS[id])]).toEqual([id, true]);
    for (const id of NOT.filter((x) => MONSTERS[x])) expect([id, R.isPerson(MONSTERS[id])]).toEqual([id, false]);
  });

  it('sweep: every monster of a PHB person family, every class-based NPC and every human sprite is a person', () => {
    for (const m of Object.values(MONSTERS)) {
      const fam = R.familyOf(m);
      const expected = R.PERSON_FAMILIES.has(fam) || !!R.classAsOf(m) || (m.sprite === 'human' && !(m.special ?? []).includes('undead'));
      if (expected) expect([m.id, R.isPerson(m)]).toEqual([m.id, true]);
      if (!R.isPerson(m)) expect([m.id, R.PERSON_FAMILIES.has(fam)]).toEqual([m.id, false]);
    }
  });

  it('an explicit person flag wins either way', () => {
    expect(R.monsterIsPerson({ id: 'ogreMage', hd: 5, person: true })).toBe(true);
    expect(R.monsterIsPerson({ id: 'orcZombie', hd: 2, person: false })).toBe(false);
    expect(R.monsterIsPerson({ id: 'nomadRider', hd: 1, family: 'human' })).toBe(true);
  });

  it('Hold Person and Charm Person work on the Priest of Bane, Bandit Captain and Hobgoblin Chief', () => {
    for (const id of ['banePriest', 'banditLeader', 'hobgoblinChief']) {
      let held = false;
      let charmed = false;
      for (let s = 1; s < 40 && !(held && charmed); s++) {
        const a = mon(id, s);
        const r = R.castSpell(new Rng(s), 'holdPerson', caster(), [a], { check: false, cls: 'cleric' });
        expect(r.results[0].immune ?? false, id).toBe(false);
        held ||= R.hasEffect(a, 'held');
        const b = mon(id, s);
        R.castSpell(new Rng(s + 100), 'charmPerson', caster(), [b], { check: false });
        charmed ||= R.hasEffect(b, 'charmed');
      }
      expect([id, held, charmed]).toEqual([id, true, true]);
    }
  });

  it('Hold Person still ignores bugbears, ogres and the undead', () => {
    for (const id of ['bugbear', 'ogre', 'skeleton']) {
      const r = R.castSpell(new Rng(1), 'holdPerson', caster(), [mon(id)], { check: false, cls: 'cleric' });
      expect(r.results[0].immune, id).toBe(true);
    }
  });
});

// ------------------------------------------------------- multiclass school
describe('multiclass casters cast from the memorized slot\'s class', () => {
  const cm = () => {
    const ch = mk('halfElf', 'cleric/magicUser', { level: 5, a: { int: 17, wis: 16 } });
    expect(ch.levels).toEqual({ cleric: 5, magicUser: 5 });
    return ch;
  };

  it('Hold Person memorized only as a magic-user resolves as the MU version and spends the MU slot', () => {
    const ch = cm();
    ch.spells.memorized = { cleric: ['bless'], magicUser: ['holdPerson'] };
    expect(R.castingClass(ch, 'holdPerson')).toBe('magicUser');
    const t = R.battleTargeting('holdPerson', ch);
    expect(t).toMatchObject({ school: 'magicUser', range: 12, maxTargets: 4 });
    expect(R.spellTargeting('holdPerson', 5, 'magicUser')).toMatchObject({ duration: 10, castTime: 3 });
    const orc = mon('orc');
    const r = R.castSpell(new Rng(3), 'holdPerson', ch, [orc], { consume: true, context: 'combat' });
    expect(r.ok).toBe(true);
    expect(r.school).toBe('magicUser');
    expect(r.results[0].save.bonus).toBe(-3); // a lone target vs a magic-user
    expect(ch.spells.memorized).toEqual({ cleric: ['bless'], magicUser: [] });
  });

  it('memorized only as a cleric: the cleric version (range 6, 3 persons, -2 alone, 4+L rounds)', () => {
    const ch = cm();
    ch.spells.memorized = { cleric: ['holdPerson'], magicUser: [] };
    expect(R.castingClass(ch, 'holdPerson')).toBe('cleric');
    expect(R.battleTargeting('holdPerson', ch)).toMatchObject({ school: 'cleric', range: 6, maxTargets: 3 });
    const r = R.castSpell(new Rng(3), 'holdPerson', ch, [mon('orc')], { consume: true, context: 'combat', noFailure: true });
    expect(r.results[0].save.bonus).toBe(-2);
    expect(ch.spells.memorized.cleric).toEqual([]);
    expect(R.spellTargeting('holdPerson', 5, 'cleric')).toMatchObject({ duration: 9, castTime: 5 });
  });

  it('an explicit cls picks the slot; consumeMemorized(ch, id, cls) only touches that class', () => {
    const ch = cm();
    ch.spells.memorized = { cleric: ['holdPerson', 'dispelMagic'], magicUser: ['holdPerson', 'dispelMagic'] };
    expect(R.castingClass(ch, 'dispelMagic', 'magicUser')).toBe('magicUser');
    expect(R.consumeMemorized(ch, 'dispelMagic', 'magicUser')).toBe(true);
    expect(ch.spells.memorized).toEqual({ cleric: ['holdPerson', 'dispelMagic'], magicUser: ['holdPerson'] });
    expect(R.consumeMemorized(ch, 'dispelMagic', 'magicUser')).toBe(false);
    expect(R.isMemorized(ch, 'dispelMagic', 'magicUser')).toBe(false);
    expect(R.isMemorized(ch, 'dispelMagic', 'cleric')).toBe(true);
    const r = R.castSpell(new Rng(1), 'holdPerson', ch, [mon('orc')], { consume: true, cls: 'magicUser', context: 'combat' });
    expect(r.school).toBe('magicUser');
    expect(ch.spells.memorized.cleric).toEqual(['holdPerson', 'dispelMagic']);
  });

  it('casting times differ by class (PHB): MU Hold Person / Dispel 3 segments, cleric 5 / 6', () => {
    expect(R.spellTargeting('dispelMagic', 5, 'magicUser').castTime).toBe(3);
    expect(R.spellTargeting('dispelMagic', 5, 'cleric').castTime).toBe(6);
    expect(R.spellTargeting('protectionFromEvil', 1, 'magicUser').castTime).toBe(1);
    expect(R.spellTargeting('protectionFromEvil', 1, 'cleric').castTime).toBe(4);
  });
});

// ------------------------------------------------------- hit points
describe('hit points: CON bonus per class, dual-classing, level limits', () => {
  it('a magic-user (CON 17) dual-classing to fighter keeps exactly the MU hit points', () => {
    const h = mk('human', 'magicUser', { level: 4, a: { str: 17, int: 15, con: 17 }, seed: 3 });
    const before = R.computeMaxHp(h);
    expect(h.hp.max).toBe(before);
    R.dualClass(h, 'fighter');
    expect(R.computeMaxHp(h)).toBe(before);
    expect(h.hp.max).toBe(before);
    // Fighter levels 2-4 add nothing; the 5th adds a fighter die + the fighter's +3.
    const rng = new Rng(9);
    for (let l = 2; l <= 4; l++) R.advanceClassLevel(h, 'fighter', rng);
    expect(R.computeMaxHp(h)).toBe(before);
    R.advanceClassLevel(h, 'fighter', rng);
    const die = h.hpRolls.fighter[4];
    expect(R.computeMaxHp(h)).toBe(before + Math.max(1, die + 3));
  });

  it('a fighter turned magic-user keeps the fighter CON bonus on the fighter dice only', () => {
    const h = mk('human', 'fighter', { level: 3, a: { str: 17, int: 17, con: 18 }, seed: 4 });
    const before = R.computeMaxHp(h);
    R.dualClass(h, 'magicUser');
    expect(R.computeMaxHp(h)).toBe(before);
    const rng = new Rng(2);
    for (let l = 2; l <= 4; l++) R.advanceClassLevel(h, 'magicUser', rng);
    expect(R.computeMaxHp(h)).toBe(before + Math.max(1, h.hpRolls.magicUser[3] + 2)); // non-fighter CON 18: +2
  });

  it('dualClassChoices lists the other classes with reasons (Training Hall)', () => {
    const h = mk('human', 'fighter', { a: { str: 16, wis: 17 } });
    const c = R.dualClassChoices(h);
    expect(c.map((x) => x.cls).sort()).toEqual(['cleric', 'magicUser', 'thief']);
    expect(c.find((x) => x.cls === 'cleric').ok).toBe(true);
    expect(c.find((x) => x.cls === 'magicUser').reason).toMatch(/17/);
    const elf = mk('elf', 'fighter', { a: { str: 16 } });
    expect(R.dualClassChoices(elf).every((x) => !x.ok && /human/.test(x.reason))).toBe(true);
  });

  it('createCharacter honours racial level limits unless told otherwise', () => {
    const he = mk('halfElf', 'cleric', { level: 6, a: { wis: 18 } });
    expect(he.levels.cleric).toBe(5);
    expect(mk('halfElf', 'cleric', { level: 6, a: { wis: 18 }, ignoreLimits: true }).levels.cleric).toBe(6);
  });
});

// --------------------------------------------------------- potions
describe('fighter-only potions and heroism (DMG)', () => {
  const drink = (ch, id, seed = 4) => {
    R.addItem(ch, id);
    return R.useItem(new Rng(seed), ch, ch.inventory.findIndex((e) => e.id === id), [ch]);
  };

  it('Giant Strength and Heroism do nothing for a magic-user', () => {
    const mu = mk('human', 'magicUser', { a: { int: 16 } });
    const r1 = drink(mu, 'potionGiantStrength');
    expect(r1.ok).toBe(true);
    expect(R.effectiveAbilities(mu).str).toBe(12);
    drink(mu, 'potionHeroism');
    expect(R.hasEffect(mu, 'heroism')).toBe(false);
    expect(R.deriveStats(mu).thac0).toBe(21);
  });

  it('a fighter gets them; a multiclass fighter counts', () => {
    const f = mk('human', 'fighter');
    drink(f, 'potionGiantStrength');
    expect(R.effectiveAbilities(f).str).toBe(21);
    const ft = mk('halfling', 'fighter/thief', { a: { str: 14, dex: 14 } });
    drink(ft, 'potionHeroism');
    expect(R.hasEffect(ft, 'heroism')).toBe(true);
  });

  it('heroism table +4/+3/+2/+1/0 levels at 0 / 1-3 / 4-6 / 7-9 / 10+', () => {
    expect([0, 1, 3, 4, 6, 7, 9, 10].map(R.heroismLevels)).toEqual([4, 3, 3, 2, 2, 1, 1, 0]);
  });

  it('heroism: higher-level THAC0, saves and hit dice; the temporary hp go first and leave with the potion', () => {
    const f = mk('human', 'fighter', { a: { con: 12 } });
    const max = f.hp.max;
    drink(f, 'potionHeroism', 11);
    const e = R.getEffect(f, 'heroism');
    expect(e.data.levels).toBe(3);
    expect(R.deriveStats(f).thac0).toBe(R.thac0For('fighter', 4));
    expect(R.deriveStats(f).saves.ppdm).toBe(R.savesFor('fighter', 4).ppdm);
    expect(f.hp.max).toBe(max + e.data.tempHp);
    expect(R.computeMaxHp(f)).toBe(f.hp.max);
    R.applyDamage(f, e.data.tempHp - 1); // all absorbed by the temporary points
    R.removeEffect(f, 'heroism');
    expect(f.hp.max).toBe(max);
    expect(f.hp.cur).toBe(max);
  });
});

// ------------------------------------------------------ item magic
describe('item-released magic', () => {
  it('a Wand of Fire saves vs Rod/Staff/Wand; a scroll of the same spell vs Spell', () => {
    const w = mk('human', 'magicUser', { a: { int: 16 }, items: ['wandFire'] });
    const t = mk('human', 'fighter');
    const u = R.useItem(new Rng(4), w, w.inventory.findIndex((e) => e.id === 'wandFire'), [t]);
    expect(u.cast.results[0].save.target).toBe(R.savesFor('fighter', 1).rsw);
    const t2 = mk('human', 'fighter');
    const r = R.castSpell(new Rng(4), 'fireball', w, [t2], { fromItem: true, level: 6, check: false });
    expect(r.results[0].save.target).toBe(R.savesFor('fighter', 1).sp);
    expect(R.itemSaveKey(ITEMS.wandFire)).toBe('rsw');
    expect(R.itemSaveKey(ITEMS.potionHealing)).toBeUndefined();
  });

  it('in battle: battleItemUse hands the wand\'s save key to the following castInBattle', () => {
    const w = mk('human', 'magicUser', { a: { int: 16 }, items: ['wandLightning'] });
    const c = R.combatantFromCharacter(w);
    const u = R.battleItemUse(w, w.inventory.findIndex((e) => e.id === 'wandLightning'));
    expect(u).toMatchObject({ kind: 'spell', spellId: 'lightningBolt', saveKey: 'rsw' });
    const t = mon('bugbear');
    const r = R.castInBattle(new Rng(2), u.spellId, c, [t], { level: u.level, fromItem: true });
    expect(r.results[0].save.target).toBe(t.saves.rsw);
  });

  it('the Wand of Paralyzation is a cone that paralyzes any creature, save vs wand, no WIS, no count penalty', () => {
    expect(R.itemRulesOf('wandParalyzation').effect).toBe('wandParalyzation');
    const tg = R.spellTargeting('wandParalyzation', 6);
    expect(tg).toMatchObject({ shape: 'cone', size: 6, target: 'direction' });
    expect(R.spellsForClass('magicUser', 3)).not.toContain('wandParalyzation');
    let paralyzed = 0;
    for (let s = 1; s <= 30; s++) {
      const w = mk('human', 'magicUser', { a: { int: 16 }, items: ['wandParalyzation'] });
      const bug = mon('bugbear', s);
      const u = R.useItem(new Rng(s), w, w.inventory.findIndex((e) => e.id === 'wandParalyzation'), [bug]);
      expect(u.cast.results[0].immune ?? false).toBe(false);
      expect(u.cast.results[0].save.bonus).toBe(0);
      if (R.hasEffect(bug, 'paralyzed')) paralyzed++;
    }
    expect(paralyzed).toBeGreaterThan(10);
    // A wise target gets no WIS bonus against the wand.
    const sage = mk('human', 'cleric', { a: { wis: 18 } });
    const w = mk('human', 'magicUser', { a: { int: 16 }, items: ['wandParalyzation'] });
    const u = R.useItem(new Rng(3), w, 0, [sage]);
    expect(u.cast.results[0].save).toMatchObject({ bonus: 0, target: R.savesFor('cleric', 1).rsw });
  });

  it('the Necklace of Missiles throws its 5, 3 and 3 HD fireballs, then is bare', () => {
    const ch = mk('human', 'fighter', { items: ['necklaceMissiles'] });
    const i = ch.inventory.findIndex((e) => e.id === 'necklaceMissiles');
    expect(ch.inventory[i].charges).toBe(3);
    expect(R.battleItemUse(ch, i)).toMatchObject({ kind: 'spell', spellId: 'fireball', level: 5 });
    expect(R.usableInBattle(ch, i)).toBe(true);
    const levels = [];
    for (let k = 0; k < 3; k++) {
      const r = R.useItem(new Rng(k), ch, i, [mon('orc', k)]);
      expect(r.ok).toBe(true);
      levels.push(r.cast.level);
    }
    expect(levels).toEqual([5, 3, 3]);
    expect(R.useItem(new Rng(1), ch, i, [mon('orc')]).ok).toBe(false);
    expect(R.battleItemUse(ch, i).kind).toBeNull();
  });

  it('Gauntlets of Ogre Power: clerics, fighters and thieves only', () => {
    const mu = mk('human', 'magicUser', { a: { int: 16 }, items: ['gauntletsOgrePower'] });
    expect(R.equipProblem(mu, 'gauntletsOgrePower')).toBe('class cannot use');
    mu.inventory[0].equipped = true; // even forced on, they do nothing
    expect(R.effectiveAbilities(mu).str).toBe(12);
    const t = mk('human', 'thief', { a: { dex: 12 }, items: ['gauntletsOgrePower'] });
    expect(R.effectiveAbilities(t)).toMatchObject({ str: 18, strPct: 100 });
  });
});

// ------------------------------------------------- protection stacking
describe('DMG protection-item stacking', () => {
  it('plate +1, shield +1, ring +3 and cloak +2 give AC 0, not -5', () => {
    const f = mk('human', 'fighter', { items: ['plateMailPlus1', 'shieldPlus1', 'ringProtection3', 'cloakProtection2'] });
    const s = R.deriveStats(f);
    expect(s.ac).toBe(0);
    // The ring's save bonus still counts; the cloak gives nothing over plate.
    expect(s.saves.sp).toBe(R.savesFor('fighter', 1).sp - 3);
  });

  it('over leather (non-magic) the ring and the cloak both work; two rings do not stack', () => {
    const t = mk('human', 'thief', { items: ['leather', 'ringProtection2', 'ringProtection1', 'cloakProtection1'] });
    const s = R.deriveStats(t);
    expect(s.ac).toBe(8 - 2 - 1);
    expect(s.saves.sp).toBe(R.savesFor('thief', 1).sp - 2 - 1);
  });

  it('magic leather blocks the cloak and the ring\'s AC', () => {
    const t = mk('human', 'thief', { items: ['leatherPlus1', 'ringProtection2', 'cloakProtection1'] });
    expect(R.deriveStats(t).ac).toBe(7);
  });

  it('bracers of defense already include a shield', () => {
    const c = mk('human', 'cleric', { items: ['bracersAC4', 'shield'] });
    expect(R.deriveStats(c).ac).toBe(4);
    const c2 = mk('human', 'cleric', { items: ['bracersAC4', 'shieldPlus1'] });
    expect(R.deriveStats(c2).ac).toBe(3);
    const c3 = mk('human', 'cleric', { items: ['bracersAC4', 'ringProtection2'] });
    expect(R.deriveStats(c3).ac).toBe(2);
  });
});

// ------------------------------------------------------- treasure/data
describe('treasure and item data', () => {
  it('MM treasure type R: 10d6 x 100 pp', () => {
    expect(R.TREASURE_TYPES.R.pp).toEqual([50, '10d6x100']);
  });
  it('every magic table id exists in the item data', () => {
    for (const [cat, rows] of Object.entries(R.MAGIC_TABLE)) {
      if (!Array.isArray(rows)) continue;
      for (const [id] of rows) expect([cat, id, !!ITEMS[id]]).toEqual([cat, id, true]);
    }
  });
  it('light crossbow quarrels: 1d4+1 / 1d6+1 (PHB)', () => {
    expect([ITEMS.lightCrossbow.damage, ITEMS.lightCrossbow.damageLarge]).toEqual(['1d4+1', '1d6+1']);
  });
  it('every ITEM_RULES entry names a real item', () => {
    for (const id of Object.keys(R.ITEM_RULES)) expect(ITEMS[id], id).toBeTruthy();
  });
});

// ---------------------------------------------------- class-based NPCs
describe('class-based NPCs fight, cast and save as their class', () => {
  it('the Priest of Bane (HD 5, spells:cleric3) is a 5th-level cleric', () => {
    expect(R.classAsOf(MONSTERS.banePriest)).toEqual({ cls: 'cleric', level: 5 });
    const bp = mon('banePriest');
    expect(bp.saves).toEqual(R.savesFor('cleric', 5));
    expect(bp.saves).toMatchObject({ ppdm: 9, bw: 15 });
    expect(R.savesOf(MONSTERS.banePriest)).toEqual(R.savesFor('cleric', 5));
    expect(bp.thac0).toBe(R.thac0For('cleric', 5));
  });
  it('acolytes save as 1st-level clerics; ordinary monsters as fighters of their HD', () => {
    expect(mon('acolyte').saves).toEqual(R.savesFor('cleric', 1));
    expect(mon('orc').saves).toEqual(R.monsterSaves(1));
    expect(mon('ogre').saves).toEqual(R.monsterSaves(4, 1));
  });
  it('classAs / saveAs overrides', () => {
    expect(R.classAsOf({ id: 'x', hd: 3, classAs: 'magicUser6' })).toEqual({ cls: 'magicUser', level: 6 });
    expect(R.monsterBaseSaves({ id: 'x', hd: 3, saveAs: { cls: 'thief', level: 4 } })).toEqual(R.savesFor('thief', 4));
    expect(R.monsterBaseThac0({ id: 'x', hd: 3, classAs: 'magicUser6' })).toBe(R.thac0For('magicUser', 6));
  });
});

// ------------------------------------------------------- time & poison
describe('exploration time (passTime / syncPartyTime) and one poison model', () => {
  it('buffs expire while walking; no healing or memorization', () => {
    const mu = mk('human', 'magicUser', { a: { int: 16 }, level: 3 });
    const f = mk('human', 'fighter');
    R.castSpell(new Rng(1), 'strength', mu, [f], { ignoreMemory: true, check: false });
    expect(R.hasEffect(f, 'strength')).toBe(true);
    f.hp.cur = 3;
    R.prepareSpells(mu, 'magicUser', ['sleep']);
    const r1 = R.passTime([mu, f], 179);
    expect(R.hasEffect(f, 'strength')).toBe(true);
    const r2 = R.passTime([mu, f], 1);
    expect(R.hasEffect(f, 'strength')).toBe(false);
    expect(r2.expired[f.id]).toContain('strength');
    expect(r1.expired[f.id]).toBeUndefined();
    expect(f.hp.cur).toBe(3);
    expect(mu.spells.memorized.magicUser).toEqual([]);
  });

  it('poison onset counts down on the road, in rest and in combat alike; Slow Poison holds it', () => {
    const p = mk('human', 'fighter');
    R.addEffect(p, 'poisoned', { data: { onset: 10 } });
    R.passTime([p], 4);
    expect(R.getEffect(p, 'poisoned').data.onset).toBe(6);
    R.rest([p], 3);
    expect(R.getEffect(p, 'poisoned').data.onset).toBe(3);
    R.addEffect(p, 'slowPoison', { rounds: 60 });
    R.passTime([p], 50);
    expect(R.getEffect(p, 'poisoned').data.onset).toBe(3);
    R.passTime([p], 12); // 10 minutes of Slow Poison left, then 2 count
    expect(R.getEffect(p, 'poisoned').data.onset).toBe(1);
    expect(p.status).toBe('ok');
    const c = R.combatantFromCharacter(p);
    expect(R.endOfRound(c).poisonDeath).toBe(true);
    expect(p.status).toBe('dead');
    const q = mk('human', 'fighter');
    R.addEffect(q, 'poisoned', { data: { onset: 10 } });
    expect(R.passTime([q], 10).died).toEqual([q.id]);
  });

  it('the dying are bound on the road, not bled', () => {
    const d = mk('human', 'fighter');
    d.hp.cur = 2;
    R.applyDamage(d, 5);
    const r = R.passTime([d], 30);
    expect(r.bandaged).toEqual([d.id]);
    expect(d.status).toBe('unconscious');
    expect(d.hp.cur).toBe(-3);
  });

  it('syncPartyTime is idempotent and never double-ticks a rest', () => {
    const f = mk('human', 'fighter');
    R.addEffect(f, 'blessed', { rounds: 100 });
    expect(R.syncPartyTime([f], 1000)).toBeNull(); // first call only marks
    R.syncPartyTime([f], 1030);
    expect(R.getEffect(f, 'blessed').rounds).toBe(70);
    R.syncPartyTime([f], 1030);
    expect(R.getEffect(f, 'blessed').rounds).toBe(70);
    R.rest([f], 20); // the camp rests 20 minutes, then the game clock moves 20
    expect(R.getEffect(f, 'blessed').rounds).toBe(50);
    expect(R.syncPartyTime([f], 1050)).toBeNull();
    expect(R.getEffect(f, 'blessed').rounds).toBe(50);
  });
});

// ------------------------------------------------------ monster specials
describe('monster special actions', () => {
  it('every special tag in the monster data has a registered rule', () => {
    for (const m of Object.values(MONSTERS)) expect([m.id, R.unhandledSpecials(m)]).toEqual([m.id, []]);
  });

  it("Tyranthraxus's lightning breath: current hp in damage, save vs breath for half, 3 a day", () => {
    const ty = mon('tyranthraxus');
    expect(R.breathOf(ty)).toMatchObject({ element: 'electricity', shape: 'line', size: 10 });
    expect(R.monsterSpecialActions(ty).map((a) => a.id)).toContain('breath');
    const hp = ty.hp.cur;
    const party = [0, 1, 2].map((i) => R.combatantFromCharacter(mk('human', 'fighter', { name: `F${i}`, seed: i + 1, level: 8 })));
    for (const p of party) { p.ref.hp.max = 500; p.ref.hp.cur = 500; }
    const r = R.breathWeapon(new Rng(5), ty, party);
    expect(r.damage).toBe(hp);
    for (const x of r.results) {
      expect(x.save.target).toBe(R.savesFor('fighter', 8).bw);
      expect(x.damage).toBe(x.saved ? Math.floor(hp / 2) : hp);
    }
    R.breathWeapon(new Rng(6), ty, []);
    R.breathWeapon(new Rng(7), ty, []);
    expect(R.breathsLeft(ty)).toBe(0);
    expect(R.breathWeapon(new Rng(8), ty, party).ok).toBe(false);
    expect(R.monsterSpecialActions(ty).map((a) => a.id)).not.toContain('breath');
  });

  it('breath respects element resistance and element save bonuses', () => {
    const r = R.breathWeapon(new Rng(1), { id: 'd', name: 'Red Dragon', hp: { cur: 40, max: 40 }, special: ['breath:fire'] },
      [(() => { const c = R.combatantFromCharacter(mk('human', 'fighter')); c.ref.hp.cur = c.ref.hp.max = 200; R.addEffect(c.ref, 'resistFire', { rounds: 10 }); return c; })()]);
    const x = r.results[0];
    expect(x.save.target).toBe(R.savesFor('fighter', 1).bw);
    expect(x.damage).toBe(Math.floor((x.saved ? 20 : 40) * 0.5));
  });

  it("hill giants hurl rocks for 2d8 out to 20 squares; dwarves are harder to hit", () => {
    const g = mon('hillGiant');
    expect(R.monsterSpecialActions(g).find((a) => a.id === 'rocks')).toMatchObject({ range: 20 });
    expect(R.throwRocks(new Rng(1), g, mon('orc'), { distance: 25 }).ok).toBe(false);
    expect(R.throwRocks(new Rng(1), g, mon('orc'), { distance: 1 }).ok).toBe(false);
    let hits = 0;
    for (let s = 1; s <= 200; s++) {
      const t = mon('orc', s);
      t.hp.cur = t.hp.max = 99;
      const r = R.throwRocks(new Rng(s), g, t, { distance: 8 });
      if (r.hit) { hits++; expect(r.damage).toBeGreaterThanOrEqual(2); expect(r.damage).toBeLessThanOrEqual(16); }
    }
    expect(hits).toBeGreaterThan(100);
    const dwarf = R.combatantFromCharacter(mk('dwarf', 'fighter', { a: { con: 14 } }));
    const human = R.combatantFromCharacter(mk('human', 'fighter'));
    expect(R.throwRocks(new Rng(3), g, dwarf).needed).toBe(R.throwRocks(new Rng(3), g, human).needed + 4);
    const ev = R.rockInBattle(new Rng(4), g, mon('orc'), 5).events[0];
    expect(ev).toMatchObject({ type: 'attack', ranged: true, rock: true });
  });

  it('fear aura: low-level foes save vs paralyzation or flee; veterans and the undead stand', () => {
    const ty = mon('tyranthraxus');
    const low = [1, 2, 3, 4, 5, 6].map((i) => R.combatantFromCharacter(mk('human', 'fighter', { name: `L${i}`, seed: i })));
    const vet = R.combatantFromCharacter(mk('human', 'fighter', { level: 5 }));
    const res = R.fearAura(new Rng(2), ty, [...low, vet, mon('skeleton')]);
    expect(res.find((x) => x.target === vet).immune).toBe(true);
    expect(res.filter((x) => x.afraid).length).toBeGreaterThan(0);
    for (const x of res.filter((y) => y.afraid)) expect(R.isAfraid(x.target)).toBe(true);
    expect(R.fearAura(new Rng(3), ty, low)).toEqual([]); // once per battle
    const ev = R.fearInBattle(new Rng(4), [mon('tyranthraxus'), R.combatantFromCharacter(mk('human', 'thief', { a: { dex: 12 } }))]);
    expect(ev.length).toBe(1);
    expect(ev[0]).toMatchObject({ type: 'effect', special: 'fear' });
  });

  it('troll regeneration starts the third round after it is hurt', () => {
    const t = mon('troll');
    t.hp.cur -= 10;
    expect([R.regenerationOf(t), R.regenerationOf(t), R.regenerationOf(t)]).toEqual([0, 0, 3]);
  });
});
