import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, effectiveAbilities, deriveStats, heal, applyDamage, bleed, drainLevel } from '../../src/rules/character.js';
import {
  combatantFromCharacter, combatantFromMonster, hitChance, resolveAttack, weaponImmunity, rollInitiative,
  canAct, situationalHit, onHitSpecials,
} from '../../src/rules/combat.js';
import { addEffect, hasEffect, conditionIds } from '../../src/rules/conditions.js';
import {
  endBattle, battleTargeting, monsterSpells, consumeMonsterSpell, stenchAuras, battleItemUse,
} from '../../src/rules/battle.js';
import {
  castProblem, castSpell, spellTargeting, SPELL_RULES, magicResistanceOf, castingClass,
} from '../../src/rules/spells.js';
import { itemCasterLevel } from '../../src/rules/magicItems.js';
import { victorySpoils } from '../../src/rules/treasure.js';
import { trainingSpellChoices, learnSpell } from '../../src/rules/camp.js';
import { serviceProblem } from '../../src/rules/temple.js';
import { neededToHit } from '../../src/rules/tohit.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';
import { decide } from '../../src/scenes/combat/logic/ai.js';

/**
 * Iteration 3 integration fixes: every rule the critic found the tactical
 * CombatEngine ignoring is asserted through the real engine here.
 */

const abil = (o = {}) => ({ str: 17, strPct: 0, int: 16, wis: 14, dex: 10, con: 15, cha: 10, ...o });
const mkChar = (race, classSpec, o = {}) => createCharacter({
  rng: new Rng(o.seed ?? 5), name: o.name ?? `${race} ${classSpec}`, race, classSpec, level: o.level ?? 1,
  abilities: abil(o.abilities), items: o.items ?? [],
});
const pc = (race, classSpec, o = {}) => combatantFromCharacter(mkChar(race, classSpec, o));

function battle(party, monsterIds, seed = 3) {
  const rng = new Rng(seed);
  const field = new Battlefield(null, { x: 0, y: 0 });
  const mons = monsterIds.map((id, i) => combatantFromMonster(rng, id, i + 1));
  party.forEach((c, i) => Object.assign(c, { x: 5, y: 3 + i }));
  mons.forEach((c, i) => Object.assign(c, { x: 6, y: 3 + i }));
  const engine = new CombatEngine({ rng, field, party, monsters: mons });
  return { engine, mons, rng };
}

function activate(engine, c) {
  engine.order = [c, ...engine.all.filter((o) => o !== c)];
  engine.turnIdx = 0;
  engine.round = Math.max(1, engine.round);
  c.mp = 12;
  c.attacksLeft = 1;
  c.acted = false;
}

const tough = (m) => { m.hp.cur = m.hp.max = 999; return m; };

describe('effects end with the battle', () => {
  it('a held, hasted, charmed cleric is free after endBattle (camp casting, next battle)', () => {
    const cleric = pc('human', 'cleric', { level: 3 });
    const { engine } = battle([cleric], ['orc']);
    cleric.fx.held = 5;
    addEffect(cleric.ref, 'hasted', { rounds: 5 });
    addEffect(cleric.ref, 'charmed', { rounds: Infinity });
    addEffect(cleric.ref, 'nauseous', { rounds: 2 });
    addEffect(cleric.ref, 'stench', { rounds: Infinity });
    addEffect(cleric.ref, 'poisoned', { rounds: Infinity });
    cleric.ref.spells.memorized.cleric = ['cureLightWounds'];
    expect(engine.awake(cleric)).toBe(false);
    endBattle(engine.party);
    for (const id of ['held', 'hasted', 'charmed', 'nauseous', 'stench']) expect(hasEffect(cleric.ref, id)).toBe(false);
    expect(hasEffect(cleric.ref, 'poisoned')).toBe(true); // poison outlasts the fight
    expect(castProblem(cleric.ref, 'cureLightWounds', { context: 'camp' })).toBeNull();
    const next = combatantFromCharacter(cleric.ref);
    expect(canAct(next)).toBe(true);
    expect(conditionIds(cleric.ref)).not.toContain('held');
  });
});

describe('backstab and rear attacks', () => {
  it('backstab is +4 (not +8) and the preview equals the real chance', () => {
    const thief = pc('human', 'thief', { items: ['shortSword', 'leather'] });
    const { engine, mons } = battle([thief], ['ogre']);
    const ogre = tough(mons[0]);
    Object.assign(ogre, { x: 6, y: 3, facing: 2 }); // faces east, away from the thief at (5,3)
    activate(engine, thief);
    const m = engine.attackMods(thief, ogre);
    expect(m.backstab).toBe(true);
    expect(m.mods).toBe(0);
    expect(situationalHit(m)).toBe(4);
    const need = neededToHit(thief.thac0, ogre.ac, (thief.hitBonus ?? 0) + 4);
    const p = engine.preview(thief, ogre);
    expect(p.chance).toBeCloseTo(hitChance(thief, ogre, 0, { backstab: true }), 6);
    expect(p.chance).toBeCloseTo(Math.max(0.05, Math.min(0.95, (21 - need) / 20)), 6);
    const ev = engine.attack(thief, ogre).find((e) => e.type === 'attack');
    expect(ev.needed).toBe(need);
    expect(ev.backstab).toBe(true);
  });

  it('a plain rear attack is +2; studded leather still allows the backstab (armorAllowsThieving)', () => {
    const fighter = pc('human', 'fighter', { items: ['longSword'] });
    const thief = pc('human', 'thief', { items: ['shortSword', 'studdedLeather'] });
    const { engine, mons } = battle([fighter, thief], ['ogre']);
    const ogre = tough(mons[0]);
    Object.assign(ogre, { x: 6, y: 3, facing: 2 });
    Object.assign(thief, { x: 5, y: 3 });
    Object.assign(fighter, { x: 5, y: 4 });
    const mf = engine.attackMods(fighter, ogre);
    expect(mf.rear).toBe(true);
    expect(mf.backstab).toBe(false);
    expect(situationalHit(mf)).toBe(2);
    expect(engine.attackMods(thief, ogre).backstab).toBe(true);
  });
});

describe('armour and arcane casting in battle', () => {
  it('an elf F/MU in plate is offered no magic-user spells and cannot cast them', () => {
    const ch = mkChar('elf', 'fighter/magicUser', { items: ['longSword', 'plateMail'] });
    ch.spells.memorized.magicUser = ['sleep', 'magicMissile'];
    ch.spells._prepared = true;
    const c = combatantFromCharacter(ch);
    const { engine } = battle([c], ['orc']);
    activate(engine, c);
    expect(castProblem(ch, 'sleep', { context: 'combat', ignoreMemory: true })).toBe('armor prevents arcane casting');
    expect(engine.spellsOf(c)).toEqual([]);
    const ev = engine.cast(c, 'magicMissile', { x: 6, y: 3 });
    expect(ev[0].type).toBe('log');
    expect(ch.spells.memorized.magicUser).toContain('magicMissile'); // the slot is not spent
  });

  it('an elf F/MU in elfin chain may cast', () => {
    const ch = mkChar('elf', 'fighter/magicUser', { items: ['longSword', 'elfinChain'] });
    ch.spells.memorized.magicUser = ['magicMissile'];
    ch.spells._prepared = true;
    const c = combatantFromCharacter(ch);
    const { engine } = battle([c], ['orc']);
    expect(engine.spellsOf(c).map((s) => s.id)).toEqual(['magicMissile']);
  });
});

describe('items in battle go through the rules', () => {
  const quaff = (itemId, o = {}) => {
    const c = pc('human', 'fighter', { items: ['longSword'], ...o });
    c.ref.inventory.push({ id: itemId, qty: 1, identified: true });
    const { engine } = battle([c], ['orc']);
    activate(engine, c);
    const idx = c.ref.inventory.length - 1;
    c.ref.hp.cur = Math.max(1, c.ref.hp.max - 5);
    const hp = c.ref.hp.cur;
    const ev = engine.use(c, idx);
    return { c, ev, hp };
  };

  it('Giant Strength sets STR 21 and heals nothing', () => {
    const { c, ev, hp } = quaff('potionGiantStrength');
    expect(c.ref.hp.cur).toBe(hp);
    expect(effectiveAbilities(c.ref).str).toBe(21);
    expect(ev.some((e) => e.type === 'heal')).toBe(false);
    expect(c.ref.inventory.some((e) => e.id === 'potionGiantStrength')).toBe(false);
  });

  it('Speed hastes (and ages a year); Invisibility, Heroism and Neutralize do their effects', () => {
    const s = quaff('potionSpeed');
    const age = s.c.ref.age;
    expect(hasEffect(s.c.ref, 'hasted')).toBe(true);
    expect(s.c.ref.hp.cur).toBe(s.hp);
    expect(age).toBeGreaterThan(0);
    const inv = quaff('potionInvisibility');
    expect(hasEffect(inv.c.ref, 'invisible')).toBe(true);
    const her = quaff('potionHeroism');
    expect(hasEffect(her.c.ref, 'heroism')).toBe(true);
    expect(deriveStats(her.c.ref).mods.hit).toBeGreaterThanOrEqual(2);
    const c = pc('human', 'fighter');
    addEffect(c.ref, 'poisoned', { rounds: Infinity, data: { onset: 5 } });
    c.ref.inventory.push({ id: 'potionNeutralizePoison', qty: 1, identified: true });
    const { engine } = battle([c], ['orc']);
    activate(engine, c);
    engine.use(c, c.ref.inventory.length - 1);
    expect(hasEffect(c.ref, 'poisoned')).toBe(false);
  });

  it('Healing potions heal', () => {
    const { c, ev, hp } = quaff('potionHealing');
    expect(c.ref.hp.cur).toBeGreaterThan(hp);
    expect(ev.find((e) => e.type === 'heal').amount).toBe(c.ref.hp.cur - hp);
  });

  it('cleric scrolls are cleric-only; magic-user scrolls magic-user-only', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    f.ref.inventory.push({ id: 'scrollCureLight', qty: 1, identified: true });
    f.ref.inventory.push({ id: 'scrollSleep', qty: 1, identified: true });
    const { engine } = battle([f], ['orc']);
    activate(engine, f);
    const n = f.ref.inventory.length;
    expect(engine.use(f, n - 2)[0].text).toBe('Only a cleric can read that scroll.');
    expect(engine.use(f, n - 1)[0].text).toBe('Only a magic-user can read that scroll.');
    expect(f.ref.inventory.length).toBe(n);
    const cl = pc('human', 'cleric');
    cl.ref.inventory.push({ id: 'scrollCureLight', qty: 1, identified: true });
    expect(battleItemUse(cl.ref, cl.ref.inventory.length - 1)).toMatchObject({ kind: 'spell', spellId: 'cureLightWounds', level: 6 });
  });

  it('scroll and wand caster levels come from itemCasterLevel', () => {
    const mage = pc('human', 'magicUser');
    mage.ref.inventory.push({ id: 'scrollFireball', qty: 1, identified: true });
    mage.ref.inventory.push({ id: 'wandFire', qty: 1, identified: true, charges: 5 });
    const n = mage.ref.inventory.length;
    expect(battleItemUse(mage.ref, n - 2).level).toBe(itemCasterLevel({ type: 'scroll' }, 'fireball'));
    expect(battleItemUse(mage.ref, n - 2).level).toBe(6);
    expect(battleItemUse(mage.ref, n - 1).level).toBe(6);
    const { engine, mons } = battle([mage], ['orc', 'orc']);
    mons.forEach((m, i) => Object.assign(m, { x: 12, y: 3 + i }));
    activate(engine, mage);
    const ev = engine.use(mage, n - 1, { x: 12, y: 3 });
    expect(ev[0].type).toBe('cast');
    expect(mage.ref.inventory[n - 1].charges).toBe(4);
  });
});

describe('spell targeting has one source of truth (the rules)', () => {
  it('engine range/shape/size/maxTargets equal the rules for every combat spell', () => {
    const casters = {
      cleric: pc('human', 'cleric', { level: 5 }),
      magicUser: pc('human', 'magicUser', { level: 5 }),
    };
    const { engine } = battle([casters.cleric, casters.magicUser], ['orc']);
    for (const [id, s] of Object.entries(SPELL_RULES)) {
      if (s.usable === 'camp') continue;
      for (const school of Object.keys(s.schools)) {
        const c = casters[school];
        const t = engine.tactics(c, id);
        const r = spellTargeting(id, 5, castingClass(c, id));
        expect([id, school, t.range]).toEqual([id, school, r.range]);
        expect([id, t.size, t.maxTargets]).toEqual([id, r.size, r.maxTargets]);
      }
    }
  });

  it('cleric hold person 6, MU 12; missiles 6+L; fireball 10+L; silence r1; bless 5x5; haste r2 max L; protGood10', () => {
    const cleric = pc('human', 'cleric', { level: 5 });
    const mage = pc('human', 'magicUser', { level: 5 });
    const { engine } = battle([cleric, mage], ['orc']);
    expect(engine.tactics(cleric, 'holdPerson').range).toBe(6);
    expect(engine.tactics(mage, 'holdPerson').range).toBe(12);
    expect(engine.tactics(mage, 'magicMissile').range).toBe(11);
    expect(engine.tactics(mage, 'fireball').range).toBe(15);
    expect(engine.tactics(cleric, 'silence15')).toMatchObject({ shape: 'radius', size: 1 });
    expect(engine.tactics(cleric, 'bless')).toMatchObject({ target: 'square', shape: 'square', size: 5, range: 6 });
    expect(engine.tactics(mage, 'haste')).toMatchObject({ shape: 'radius', size: 2, maxTargets: 5 });
    expect(engine.tactics(mage, 'protGood10')).toBeTruthy();
    expect(battleTargeting('rayOfEnfeeblement', mage).range).toBe(2); // 1" + 1/4" per level
  });

  it('bless covers a 5x5 square of allies, not the whole field', () => {
    const cleric = pc('human', 'cleric', { level: 3 });
    const f = pc('human', 'fighter');
    const far = pc('human', 'fighter', { name: 'Far' });
    const { engine } = battle([cleric, f, far], ['orc']);
    Object.assign(far, { x: 15, y: 9 });
    activate(engine, cleric);
    engine.cast(cleric, 'bless', { x: cleric.x, y: cleric.y }, { free: true });
    expect(hasEffect(f.ref, 'blessed')).toBe(true);
    expect(hasEffect(far.ref, 'blessed')).toBe(false);
  });
});

describe('monster special tags', () => {
  const swing = (attacker, defender, n = 40, opts = {}) => {
    const rng = new Rng(4);
    let dmg = 0;
    let immune = 0;
    for (let i = 0; i < n; i++) {
      defender.hp.cur = defender.hp.max = 999;
      defender.status = 'ok';
      const r = resolveAttack(rng, attacker, defender, { strict1e: false, ...opts });
      dmg += r.damage;
      if (r.weaponImmune) immune++;
    }
    return { dmg, immune };
  };

  it('shadows and spectres need +1 weapons; wights silver or magic', () => {
    const rng = new Rng(1);
    const shadow = combatantFromMonster(rng, 'shadow');
    const wight = combatantFromMonster(rng, 'wight');
    const mundane = pc('human', 'fighter', { items: ['longSword'] });
    const magic = pc('human', 'fighter', { items: ['longSwordPlus1'] });
    const silver = pc('human', 'fighter', { items: ['silverDagger'] });
    expect(weaponImmunity(mundane, shadow)).toBe('needs a +1 weapon');
    expect(weaponImmunity(magic, shadow)).toBeNull();
    expect(weaponImmunity(silver, shadow)).toBe('needs a +1 weapon');
    expect(weaponImmunity(mundane, wight)).toBe('needs a silver or magic weapon');
    expect(weaponImmunity(silver, wight)).toBeNull();
    expect(weaponImmunity(magic, wight)).toBeNull();
    const m = swing(mundane, wight);
    expect(m.dmg).toBe(0);
    expect(m.immune).toBeGreaterThan(0);
    expect(swing(silver, wight).dmg).toBeGreaterThan(0);
    // A troll (6+6 HD) strikes as a +2 weapon.
    expect(weaponImmunity(combatantFromMonster(rng, 'troll'), shadow)).toBeNull();
    expect(weaponImmunity(combatantFromMonster(rng, 'orc'), shadow)).not.toBeNull();
  });

  it('the engine log says the weapon passes through, and the preview warns', () => {
    const f = pc('human', 'fighter', { items: ['longSword'] });
    const { engine, mons } = battle([f], ['wight']);
    tough(mons[0]);
    activate(engine, f);
    const p = engine.preview(f, mons[0]);
    expect(p.immune).toBe(true);
    expect(p.dmg).toBe('0');
    let saw = false;
    for (let i = 0; i < 20 && !saw; i++) {
      activate(engine, f);
      saw = engine.attack(f, mons[0]).some((e) => e.type === 'attack' && /passes harmlessly/.test(e.text));
    }
    expect(saw).toBe(true);
  });

  it('skeletons take half damage from edged weapons, full from blunt', () => {
    const rng = new Rng(2);
    const skel = combatantFromMonster(rng, 'skeleton');
    const sword = pc('human', 'fighter', { items: ['longSword'] });
    const mace = pc('human', 'cleric', { items: ['mace'] });
    const rs = new Rng(9);
    skel.hp.cur = skel.hp.max = 999;
    let halved = 0;
    for (let i = 0; i < 30; i++) { const r = resolveAttack(rs, sword, skel); if (r.hit) { expect(r.halved).toBe(true); halved++; } }
    expect(halved).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) { const r = resolveAttack(rs, mace, skel); expect(r.halved).toBeUndefined(); }
  });

  it("ghast stench: save vs poison or -2 to hit, once per battle", () => {
    const party = [0, 1, 2, 3, 4, 5].map((i) => pc('human', 'fighter', { name: `F${i}`, seed: i + 1 }));
    const { engine, mons, rng } = battle(party, ['ghast']);
    Object.assign(mons[0], { x: 6, y: 5 });
    const near = (a, b) => Battlefield.dist(a.x, a.y, b.x, b.y) <= 1.5;
    const ev = stenchAuras(rng, engine.all, near);
    const checked = party.filter((c) => near(c, mons[0]));
    expect(ev.length).toBe(checked.length);
    for (const e of ev) if (!e.saved) expect(hasEffect(engine.byId(e.id).ref, 'stench')).toBe(true);
    expect(stenchAuras(rng, engine.all, near)).toEqual([]);
    const sick = ev.find((e) => !e.saved);
    if (sick) expect(deriveStats(engine.byId(sick.id).ref).mods.hit).toBe(-2);
  });

  it('zombies always act last', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 20; i++) {
      const z = combatantFromMonster(rng, 'zombie');
      const others = [pc('human', 'fighter'), combatantFromMonster(rng, 'orc'), combatantFromMonster(rng, 'kobold')];
      const order = rollInitiative(rng, [z, ...others]);
      expect(order[order.length - 1]).toBe(z);
    }
  });

  it("Tyranthraxus's magic resistance is read from the tag (20% vs 11th level, +5%/level below)", () => {
    const t = combatantFromMonster(new Rng(1), 'tyranthraxus');
    expect(magicResistanceOf(t, 11)).toBe(20);
    expect(magicResistanceOf(t, 6)).toBe(45);
    expect(magicResistanceOf(combatantFromMonster(new Rng(1), 'orc'), 6)).toBe(0);
    const rng = new Rng(7);
    let resisted = 0;
    const mage = mkChar('human', 'magicUser', { level: 6 });
    for (let i = 0; i < 200; i++) {
      const boss = combatantFromMonster(rng, 'tyranthraxus');
      const r = castSpell(rng, 'magicMissile', mage, [boss], { ignoreMemory: true });
      if (r.results[0].resisted) resisted++;
    }
    expect(resisted).toBeGreaterThan(60);
    expect(resisted).toBeLessThan(120);
  });

  it('wights drain a level (hp recomputed, XP to the midpoint); spectres two; level 1 dies', () => {
    const ch = mkChar('human', 'fighter', { level: 5, seed: 11 });
    const maxBefore = ch.hp.max;
    const r = drainLevel(ch, 1);
    expect(r.drained).toEqual([{ cls: 'fighter', level: 4 }]);
    expect(ch.levels.fighter).toBe(4);
    expect(ch.hp.max).toBeLessThan(maxBefore);
    expect(ch.xp.fighter).toBe(Math.floor((8001 + 18001) / 2)); // DMG fighter table: 4th 8,001, 5th 18,001
    const rng = new Rng(3);
    const victim = pc('human', 'cleric', { level: 4 });
    victim.ref.spells.memorized.cleric = ['bless', 'bless', 'bless', 'holdPerson', 'holdPerson'];
    const spectre = combatantFromMonster(rng, 'spectre');
    const out = onHitSpecials(rng, spectre, victim);
    expect(out.find((o) => o.kind === 'drainLevel').levels).toBe(2);
    expect(victim.ref.levels.cleric).toBe(2);
    // A 2nd-level cleric (2 + WIS 14's two bonus first-level slots) keeps the blesses, loses hold person.
    expect(victim.ref.spells.memorized.cleric).toEqual(['bless', 'bless', 'bless']);
    const novice = pc('human', 'fighter');
    onHitSpecials(rng, combatantFromMonster(rng, 'wight'), novice);
    expect(novice.ref.status).toBe('dead');
  });

  it('shadows drain 1 STR per hit; at 0 STR the victim dies', () => {
    const rng = new Rng(3);
    const v = pc('human', 'magicUser', { abilities: { str: 3 } });
    const shadow = combatantFromMonster(rng, 'shadow');
    onHitSpecials(rng, shadow, v);
    expect(effectiveAbilities(v.ref).str).toBe(2);
    onHitSpecials(rng, shadow, v);
    onHitSpecials(rng, shadow, v);
    expect(v.ref.status).toBe('dead');
    const w = pc('human', 'fighter', { abilities: { str: 16 } });
    onHitSpecials(rng, shadow, w);
    endBattle([w]);
    expect(effectiveAbilities(w.ref).str).toBe(15); // the drain outlasts the fight (2d4 turns)
  });
});

describe('monster spellcasting', () => {
  it("'spells:clericN' gives an Nth-level cleric's slots, spent per battle", () => {
    const rng = new Rng(1);
    const acolyte = combatantFromMonster(rng, 'acolyte');
    expect(monsterSpells(acolyte)).toEqual([{ id: 'causeLightWounds', cls: 'cleric' }]);
    const priest = combatantFromMonster(rng, 'banePriest');
    const ids = monsterSpells(priest).map((s) => s.id);
    expect(ids.filter((id) => SPELL_RULES[id].schools.cleric === 1).length).toBe(2);
    expect(ids).toContain('holdPerson');
    expect(consumeMonsterSpell(priest, 'holdPerson')).toBe(true);
    expect(monsterSpells(priest).map((s) => s.id)).not.toContain('holdPerson');
  });

  it('a priest of Bane casts Hold Person at the party through the engine and the AI', () => {
    const party = [0, 1, 2].map((i) => pc('human', 'fighter', { name: `F${i}`, seed: i + 3 }));
    const { engine, mons } = battle(party, ['banePriest']);
    const priest = mons[0];
    Object.assign(priest, { x: 9, y: 4 });
    activate(engine, priest);
    const plan = decide(engine, priest);
    expect(plan.kind).toBe('cast');
    expect(plan.spell).toBe('holdPerson');
    const ev = engine.cast(priest, plan.spell, plan.at);
    expect(ev[0].type).toBe('cast');
    expect(engine.spellsOf(priest).map((s) => s.id)).not.toContain('holdPerson');
    expect(priest.casterLevel).toBe(3);
  });

  it('a silenced priest cannot cast', () => {
    const { engine, mons } = battle([pc('human', 'fighter')], ['acolyte']);
    addEffect(mons[0], 'silenced', { rounds: 5 });
    expect(engine.spellsOf(mons[0])).toEqual([]);
  });
});

describe('spell fixes', () => {
  it('Spiritual Hammer: +1 at levels 1-6, +2 at 7-12', () => {
    const rng = new Rng(2);
    for (const [lvl, magic] of [[3, 1], [6, 1], [7, 2], [12, 2]]) {
      const cl = mkChar('human', 'cleric', { level: 3 });
      const orc = combatantFromMonster(rng, 'orc');
      orc.hp.cur = orc.hp.max = 999;
      castSpell(rng, 'spiritualHammer', cl, [orc], { ignoreMemory: true, level: lvl });
      expect(cl.effects.find((e) => e.id === 'spiritualHammer').data.magic).toBe(magic);
    }
  });

  it('one Sleep never exceeds its 4d4 budget across HD bands', () => {
    const rng = new Rng(8);
    const mage = mkChar('human', 'magicUser');
    for (let i = 0; i < 30; i++) {
      const crowd = [
        ...Array.from({ length: 10 }, (_, k) => combatantFromMonster(rng, 'kobold', k + 1)),
        ...Array.from({ length: 8 }, (_, k) => combatantFromMonster(rng, 'gnoll', k + 1)),
        ...Array.from({ length: 4 }, (_, k) => combatantFromMonster(rng, 'bugbear', k + 1)),
      ];
      const r = castSpell(rng, 'sleep', mage, crowd, { ignoreMemory: true });
      const cost = r.results.filter((x) => x.affected || x.resisted).reduce((t, x) => t + ({ kobold: 1, gnoll: 2, bugbear: 8 }[x.target.monsterId]), 0);
      expect(cost).toBeLessThanOrEqual(r.sleepBudget);
      expect(r.results.filter((x) => x.affected).length).toBeLessThanOrEqual(16);
      // Weakest first: no gnoll sleeps while a kobold stays awake.
      const koboldsAwake = r.results.some((x) => x.target.monsterId === 'kobold' && !x.affected && !x.resisted);
      if (koboldsAwake) expect(r.results.some((x) => x.target.monsterId === 'gnoll' && x.affected)).toBe(false);
    }
  });

  it('haste on a slowed creature cancels to normal speed; slow on a hasted one too', () => {
    const rng = new Rng(3);
    const mage = mkChar('human', 'magicUser', { level: 5 });
    const f = mkChar('human', 'fighter');
    addEffect(f, 'slowed', { rounds: 5 });
    castSpell(rng, 'haste', mage, [f], { ignoreMemory: true });
    expect(hasEffect(f, 'slowed')).toBe(false);
    expect(hasEffect(f, 'hasted')).toBe(false);
    castSpell(rng, 'haste', mage, [f], { ignoreMemory: true });
    expect(hasEffect(f, 'hasted')).toBe(true);
  });
});

describe('dead APIs now wired', () => {
  it('victorySpoils: encounter gold + items + MM treasure of the slain', () => {
    const rng = new Rng(4);
    const slain = [combatantFromMonster(rng, 'banditLeader').ref, combatantFromMonster(rng, 'bandit').ref];
    const s = victorySpoils(rng, { gold: '2d10', items: ['potionHealing'] }, slain);
    expect(s.gold).toBeGreaterThanOrEqual(2 + 2); // 2d10 + the captain's type M 2d4 gp
    expect(s.items.map((e) => e.id)).toContain('potionHealing');
    expect(s.text).toMatch(/gold pieces/);
  });

  it('training offers a magic-user new spells (learnSpell accepts the pick)', () => {
    const ch = mkChar('human', 'magicUser', { level: 3 });
    const choices = trainingSpellChoices(ch);
    expect(choices).toContain('mirrorImage');
    expect(choices).not.toContain('magicMissile'); // already in the book
    expect(choices).not.toContain('fireball'); // 3rd-level spells need a 5th-level mage
    expect(learnSpell(ch, 'mirrorImage').ok).toBe(true);
    expect(trainingSpellChoices(mkChar('human', 'fighter'))).toEqual([]);
  });

  it('serviceProblem explains why a dead elf cannot be raised', () => {
    const elf = mkChar('elf', 'fighter');
    elf.status = 'dead';
    expect(serviceProblem('raiseDead', elf)).toMatch(/Elves cannot be raised/);
  });

  it('any healing stops a dying character bleeding (DMG ruling)', () => {
    const ch = mkChar('human', 'fighter');
    applyDamage(ch, ch.hp.cur + 5);
    expect(ch.status).toBe('dying');
    heal(ch, 3);
    expect(ch.hp.cur).toBe(-2);
    expect(ch.status).toBe('unconscious');
    expect(bleed(ch)).toBe(false);
    heal(ch, 5);
    expect(ch.status).toBe('ok');
  });
});
