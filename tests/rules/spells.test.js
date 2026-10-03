import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, deriveStats, applyDamage } from '../../src/rules/character.js';
import { combatantFromMonster, combatantFromCharacter } from '../../src/rules/combat.js';
import {
  SPELL_RULES, SPELL_IDS, castSpell, getSpell, spellsForClass, spellLevel, spellTargeting, castProblem, casterLevel,
  consumeMemorized, isMemorized,
} from '../../src/rules/spells.js';
import { hasEffect, getEffect, addEffect, effectMods } from '../../src/rules/conditions.js';
import { SPELLS as DATA_SPELLS } from '../../src/data/spells.js';
import { CONDITIONS } from '../../src/rules/conditions.js';

/**
 * Scripted cast for spell-mechanics tests: memory is not checked (unless the
 * test consumes a memorized slot) and the cleric WIS failure roll is off.
 */
const cast = (rng, id, c, t = [], o = {}) => castSpell(rng, id, c, t, { ignoreMemory: !o.consume, noFailure: true, ...o });

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });
const mage = (level = 1, o = {}) => createCharacter({ rng: new Rng(1), name: 'Meralda', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 18 }), level, ...o });
const priest = (level = 1, o = {}) => createCharacter({ rng: new Rng(2), name: 'Aldric', race: 'human', classSpec: 'cleric', abilities: abil({ wis: 17 }), level, ...o });
const fighter = (o = {}) => createCharacter({ rng: new Rng(3), name: 'Taran', race: 'human', classSpec: 'fighter', abilities: abil({ str: 17 }), ...o });
const mons = (rng, id, n) => Array.from({ length: n }, (_, i) => combatantFromMonster(rng, id, i + 1));

const POR_CLERIC = {
  1: ['bless', 'curse', 'cureLightWounds', 'causeLightWounds', 'detectMagic', 'protectionFromEvil', 'protectionFromGood', 'resistCold'],
  2: ['findTraps', 'holdPerson', 'resistFire', 'silence15', 'slowPoison', 'snakeCharm', 'spiritualHammer', 'chant'],
  3: ['cureBlindness', 'causeBlindness', 'cureDisease', 'causeDisease', 'dispelMagic', 'prayer', 'removeCurse', 'bestowCurse'],
};
const POR_MU = {
  1: ['burningHands', 'charmPerson', 'detectMagic', 'enlarge', 'reduce', 'friends', 'magicMissile', 'protectionFromEvil', 'protectionFromGood', 'readMagic', 'shield', 'shockingGrasp', 'sleep'],
  2: ['detectInvisibility', 'invisibility', 'knock', 'mirrorImage', 'rayOfEnfeeblement', 'stinkingCloud', 'strength'],
  3: ['blink', 'dispelMagic', 'fireball', 'haste', 'holdPerson', 'invisibility10', 'lightningBolt', 'protEvil10', 'protGood10', 'protNormalMissiles', 'slow'],
};

describe('spell list', () => {
  it('covers every Pool of Radiance spell at the right level', () => {
    for (const [lvl, ids] of Object.entries(POR_CLERIC)) expect(spellsForClass('cleric', Number(lvl)).sort()).toEqual([...ids].sort());
    for (const [lvl, ids] of Object.entries(POR_MU)) expect(spellsForClass('magicUser', Number(lvl)).sort()).toEqual([...ids].sort());
  });
  it('shared spells have per-class levels', () => {
    expect(spellLevel('holdPerson', 'cleric')).toBe(2);
    expect(spellLevel('holdPerson', 'magicUser')).toBe(3);
    expect(spellLevel('dispelMagic', 'magicUser')).toBe(3);
  });
  it('every spell is well formed', () => {
    for (const id of SPELL_IDS) {
      const s = SPELL_RULES[id];
      expect(s.name, id).toBeTruthy();
      expect(s.desc, id).toBeTruthy();
      expect(s.tip, id).toBeTruthy();
      expect(['combat', 'camp', 'both']).toContain(s.usable);
      expect(s.ops.length, id).toBeGreaterThan(0);
      for (const op of s.ops) if (op.op === 'condition') expect(CONDITIONS[op.id], `${id} → ${op.id}`).toBeTruthy();
      if (s.reverse) expect(SPELL_RULES[s.reverse], id).toBeTruthy();
      const t = spellTargeting(id, 5);
      expect(t.range).toBeGreaterThanOrEqual(0);
    }
  });
  it('every spell in the data table has a rules implementation', () => {
    for (const id of Object.keys(DATA_SPELLS)) expect(SPELL_RULES[id], id).toBeTruthy();
  });
  it('getSpell merges display data', () => {
    const s = getSpell('fireball');
    expect(s.name).toBe('Fireball');
    expect(s.tip).toMatch(/1d6 per level/);
    expect(getSpell('nope')).toBeNull();
  });
  it('targeting scales with level', () => {
    expect(spellTargeting('magicMissile', 1).range).toBe(7);
    expect(spellTargeting('haste', 5).maxTargets).toBe(5);
    expect(spellTargeting('fireball', 5)).toMatchObject({ shape: 'radius', size: 2, hostile: true });
    expect(spellTargeting('holdPerson', 5, 'magicUser').maxTargets).toBe(4);
  });
});

describe('casting prerequisites', () => {
  it('memorization, armour and silence', () => {
    const m = mage(1);
    expect(castProblem(m, 'sleep')).toBe('not memorized');
    m.spells.memorized.magicUser = ['sleep'];
    expect(castProblem(m, 'sleep')).toBeNull();
    expect(isMemorized(m, 'sleep')).toBe(true);
    addEffect(m, 'silenced', { rounds: 2 });
    expect(castProblem(m, 'sleep')).toBe('cannot cast now');
    const e = createCharacter({ rng: new Rng(1), name: 'E', race: 'elf', classSpec: 'fighter/magicUser', abilities: abil({ int: 16 }), items: ['chainMail'] });
    expect(castProblem(e, 'sleep', { ignoreMemory: true })).toBe('armor prevents arcane casting');
    expect(castProblem(priest(), 'sleep', { ignoreMemory: true })).toBe('not a spell of this class');
    expect(castProblem(priest(), 'detectMagic', { ignoreMemory: true, context: 'combat' })).toBe('not in combat');
  });
  it('consumes a memorized instance when cast', () => {
    const m = mage(1);
    m.spells.memorized.magicUser = ['magicMissile'];
    const r = cast(new Rng(1), 'magicMissile', m, mons(new Rng(1), 'kobold', 1), { consume: true });
    expect(r.ok).toBe(true);
    expect(m.spells.memorized.magicUser).toEqual([]);
    expect(consumeMemorized(m, 'magicMissile')).toBe(false);
    expect(cast(new Rng(1), 'magicMissile', m, [], { consume: true }).reason).toBe('not memorized');
  });
  it('caster levels', () => {
    expect(casterLevel(mage(5), 'fireball')).toBe(5);
    const multi = createCharacter({ rng: new Rng(1), name: 'H', race: 'halfElf', classSpec: 'cleric/magicUser', abilities: abil({ wis: 12, int: 12 }), level: 3 });
    expect(casterLevel(multi, 'holdPerson')).toBe(3);
  });
});

describe('damage spells', () => {
  it('magic missile: 1d4+1 per missile, never misses, blocked by shield', () => {
    const rng = new Rng(4);
    for (let i = 0; i < 30; i++) {
      const [orc] = mons(rng, 'orc', 1);
      orc.hp = { cur: 100, max: 100 };
      const r = cast(rng, 'magicMissile', mage(1), [orc]);
      expect(r.results[0].damage).toBeGreaterThanOrEqual(2);
      expect(r.results[0].damage).toBeLessThanOrEqual(5);
      const r5 = cast(rng, 'magicMissile', mage(5), [orc]);
      expect(r5.results[0].damage).toBeGreaterThanOrEqual(6);
      expect(r5.results[0].damage).toBeLessThanOrEqual(15);
    }
    const [o] = mons(rng, 'orc', 1);
    addEffect(o, 'shielded', { rounds: 5 });
    const hp = o.hp.cur;
    const r = cast(rng, 'magicMissile', mage(1), [o]);
    expect(r.results[0].immune).toBe(true);
    expect(o.hp.cur).toBe(hp);
  });
  it('burning hands does 1 hp per level to every target', () => {
    const rng = new Rng(5);
    const ks = mons(rng, 'orc', 3);
    ks.forEach((k) => { k.hp = { cur: 20, max: 20 }; });
    cast(rng, 'burningHands', mage(4), ks);
    expect(ks.map((k) => k.hp.cur)).toEqual([16, 16, 16]);
  });
  it('fireball: 1d6/level, save for half, resist fire halves, dex helps saves', () => {
    const rng = new Rng(6);
    let full = 0;
    let half = 0;
    for (let i = 0; i < 200; i++) {
      const [o] = mons(rng, 'ogre', 1);
      o.hp = { cur: 1000, max: 1000 };
      const r = cast(rng, 'fireball', mage(5), [o]).results[0];
      expect(r.damage).toBeLessThanOrEqual(30);
      if (r.saved) { half++; expect(r.damage).toBeLessThanOrEqual(15); } else full++;
    }
    expect(half).toBeGreaterThan(20);
    expect(full).toBeGreaterThan(20);
    const f = fighter();
    f.hp = { cur: 500, max: 500 };
    addEffect(f, 'resistFire', { rounds: 10 });
    const r = cast(new Rng(1), 'fireball', mage(6), [f]).results[0];
    expect(r.damage).toBeLessThanOrEqual(18);
    expect(r.save.bonus).toBe(3);
  });
  it('lightning bolt and shocking grasp', () => {
    const rng = new Rng(7);
    const [o] = mons(rng, 'troll', 1);
    o.hp = { cur: 200, max: 200 };
    const r = cast(rng, 'lightningBolt', mage(6), [o]).results[0];
    expect(r.damage).toBeGreaterThan(0);
    let hits = 0;
    for (let i = 0; i < 50; i++) {
      const [k] = mons(rng, 'kobold', 1);
      k.hp = { cur: 100, max: 100 };
      const g = cast(rng, 'shockingGrasp', mage(3), [k]).results[0];
      if (!g.missed) { hits++; expect(g.damage).toBeGreaterThanOrEqual(4); expect(g.damage).toBeLessThanOrEqual(11); }
    }
    expect(hits).toBeGreaterThan(8); // THAC0 21 vs AC 7: 35%
  });
  it('lethal damage kills monsters and downs characters', () => {
    const rng = new Rng(8);
    const [k] = mons(rng, 'kobold', 1);
    const r = cast(rng, 'fireball', mage(6), [k]);
    expect(k.status).toBe('dead');
    expect(r.results[0].down).toBe(true);
    expect(r.log.join(' ')).toMatch(/slain/);
  });
});

describe('sleep', () => {
  it('sleeps low-HD creatures, weakest first, no save', () => {
    const rng = new Rng(9);
    const ks = mons(rng, 'kobold', 4);
    const r = cast(rng, 'sleep', mage(1), ks);
    expect(r.results.filter((x) => x.affected).length).toBe(4); // 4d4 ≥ 4
    expect(ks.every((k) => hasEffect(k, 'asleep'))).toBe(true);
    expect(getEffect(ks[0], 'asleep').rounds).toBe(5);
  });
  it('does not affect undead or 5+ HD', () => {
    const rng = new Rng(10);
    const [s] = mons(rng, 'skeleton', 1);
    const [t] = mons(rng, 'troll', 1);
    const r = cast(rng, 'sleep', mage(1), [s, t]);
    expect(r.results.every((x) => !x.affected)).toBe(true);
  });
  it('4 HD creatures only rarely', () => {
    const rng = new Rng(11);
    let slept = 0;
    for (let i = 0; i < 100; i++) {
      const og = mons(rng, 'ogre', 1);
      slept += cast(rng, 'sleep', mage(1), og).results.filter((x) => x.affected).length;
    }
    expect(slept).toBeGreaterThan(25);
    expect(slept).toBeLessThan(75);
  });
  it('elves usually resist', () => {
    const rng = new Rng(12);
    let resisted = 0;
    for (let i = 0; i < 100; i++) {
      const e = createCharacter({ rng, name: 'E', race: 'elf', classSpec: 'fighter', abilities: abil({ str: 12 }) });
      if (cast(rng, 'sleep', mage(1), [e]).results[0].resisted) resisted++;
    }
    expect(resisted).toBeGreaterThan(75);
  });
  it('damage wakes the sleeper', () => {
    const rng = new Rng(13);
    const ks = mons(rng, 'orc', 1);
    cast(rng, 'sleep', mage(1), ks);
    ks[0].hp.cur = 50;
    cast(rng, 'magicMissile', mage(1), ks);
    expect(hasEffect(ks[0], 'asleep')).toBe(false);
  });
});

describe('enchantments', () => {
  it('hold person affects persons only, harsher save alone', () => {
    const rng = new Rng(14);
    const [sk] = mons(rng, 'skeleton', 1);
    const r = cast(rng, 'holdPerson', priest(3), [sk]);
    expect(r.results[0].immune).toBe(true);
    let held = 0;
    for (let i = 0; i < 100; i++) {
      const [o] = mons(rng, 'orc', 1);
      const res = cast(rng, 'holdPerson', priest(3), [o]).results[0];
      expect(res.save.bonus).toBe(-2);
      if (res.affected) { held++; expect(hasEffect(o, 'held')).toBe(true); expect(getEffect(o, 'held').rounds).toBe(7); }
    }
    expect(held).toBeGreaterThan(40);
    const many = mons(rng, 'orc', 6);
    expect(cast(rng, 'holdPerson', priest(3), many).results.length).toBe(3);
    expect(cast(rng, 'holdPerson', mage(5), mons(rng, 'orc', 6)).results.length).toBe(4);
  });
  it('charm person marks the victim for the caster\'s side', () => {
    const rng = new Rng(15);
    let charmed = 0;
    for (let i = 0; i < 40; i++) {
      const [b] = mons(rng, 'buccaneer', 1);
      const r = cast(rng, 'charmPerson', mage(1), [b]).results[0];
      if (r.charmed) { charmed++; expect(getEffect(b, 'charmed').data.side).toBe('party'); }
    }
    expect(charmed).toBeGreaterThan(10);
  });
  it('WIS adjusts saves vs mind magic for characters', () => {
    const wise = createCharacter({ rng: new Rng(1), name: 'W', race: 'human', classSpec: 'fighter', abilities: abil({ wis: 18 }) });
    const orcCaster = mons(new Rng(1), 'orc', 1)[0];
    const r = cast(new Rng(2), 'holdPerson', orcCaster, [wise], { check: false }).results[0];
    expect(r.save.bonus).toBe(-2 + 4);
  });
  it('stinking cloud nauseates the living', () => {
    const rng = new Rng(16);
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const ks = mons(rng, 'kobold', 1);
      const r = cast(rng, 'stinkingCloud', mage(3), ks).results[0];
      if (r.affected) {
        n++;
        const rounds = getEffect(ks[0], 'nauseous').rounds;
        expect(rounds).toBeGreaterThanOrEqual(2);
        expect(rounds).toBeLessThanOrEqual(5);
      }
    }
    expect(n).toBeGreaterThan(10);
    const sk = mons(rng, 'skeleton', 1);
    expect(cast(rng, 'stinkingCloud', mage(3), sk).results[0].immune).toBe(true);
  });
  it('slow and haste', () => {
    const rng = new Rng(17);
    const party = [fighter(), fighter(), fighter()];
    const age = party[0].age;
    cast(rng, 'haste', mage(5), party);
    expect(party.every((p) => hasEffect(p, 'hasted'))).toBe(true);
    expect(party[0].age).toBe(age + 1);
    expect(deriveStats(party[0]).attacks).toBe(2);
    expect(cast(rng, 'haste', mage(2), [fighter(), fighter(), fighter()]).results.length).toBe(2);
    const foes = mons(rng, 'orc', 3);
    const r = cast(rng, 'slow', mage(5), foes);
    for (const x of r.results) if (x.affected) expect(effectMods(x.target).attackMult).toBe(0.5);
  });
});

describe('cleric blessings and curses', () => {
  it('bless helps allies only; curse hurts enemies only', () => {
    const rng = new Rng(18);
    const c = priest(1);
    const f = fighter();
    const [o] = mons(rng, 'orc', 1);
    cast(rng, 'bless', c, [c, f, o]);
    expect(hasEffect(f, 'blessed')).toBe(true);
    expect(hasEffect(o, 'blessed')).toBe(false);
    cast(rng, 'curse', c, [f, o]);
    expect(hasEffect(o, 'cursed')).toBe(true);
    expect(hasEffect(f, 'cursed')).toBe(false);
  });
  it('prayer: allies +1, foes -1', () => {
    const rng = new Rng(19);
    const c = priest(5);
    const f = fighter();
    const [o] = mons(rng, 'orc', 1);
    cast(rng, 'prayer', c, [c, f, o]);
    expect(effectMods(f)).toMatchObject({ hit: 1, dmg: 1, save: 1 });
    expect(effectMods(o)).toMatchObject({ hit: -1, dmg: -1, save: -1 });
    expect(getEffect(f, 'prayer').rounds).toBe(5);
  });
  it('cure light wounds heals 1d8 and revives the dying', () => {
    const rng = new Rng(20);
    const f = fighter();
    applyDamage(f, f.hp.cur + 2);
    expect(f.status).toBe('dying');
    let r;
    do { r = cast(rng, 'cureLightWounds', priest(), [f]); } while (f.hp.cur <= 0);
    expect(f.status).toBe('ok');
    expect(r.results[0].healed).toBeGreaterThan(0);
    const [sk] = mons(rng, 'skeleton', 1);
    expect(cast(rng, 'cureLightWounds', priest(), [sk]).results[0].affected).toBe(false);
  });
  it('protection from evil: -2 AC and +2 saves vs evil only', () => {
    const f = fighter();
    cast(new Rng(1), 'protectionFromEvil', priest(2), [f]);
    expect(getEffect(f, 'protEvil').rounds).toBe(6);
    expect(effectMods(f).vsEvil).toEqual({ ac: -2, save: 2 });
    const pm = cast(new Rng(1), 'protectionFromEvil', mage(2), [f]);
    expect(pm.ok).toBe(true);
  });
  it('spiritual hammer: a war hammer\'s 2-5, no magical plusses (PHB)', () => {
    const rng = new Rng(21);
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      const [k] = mons(rng, 'orc', 1);
      k.hp = { cur: 50, max: 50 };
      const r = cast(rng, 'spiritualHammer', priest(3), [k]).results[0];
      if (!r.missed) { hits++; expect(r.damage).toBeGreaterThanOrEqual(2); expect(r.damage).toBeLessThanOrEqual(5); }
    }
    expect(hits).toBeGreaterThan(10);
  });
  it('dispel magic removes effects by level difference', () => {
    const rng = new Rng(22);
    let removed = 0;
    for (let i = 0; i < 100; i++) {
      const [o] = mons(rng, 'orc', 1);
      addEffect(o, 'blessed', { rounds: 5, level: 5 });
      addEffect(o, 'poisoned'); // not magical: never dispelled
      cast(rng, 'dispelMagic', priest(5), [o]);
      if (!hasEffect(o, 'blessed')) removed++;
      expect(hasEffect(o, 'poisoned')).toBe(true);
    }
    expect(removed).toBeGreaterThan(30);
    expect(removed).toBeLessThan(70);
  });
  it('remove curse lifts curses and uncurses items; bestow curse', () => {
    const rng = new Rng(23);
    const f = fighter();
    f.inventory.push({ id: 'longSword', qty: 1, equipped: true, identified: true, cursed: true, magic: -1 });
    addEffect(f, 'bestowCurse', { rounds: 10 });
    const r = cast(rng, 'removeCurse', priest(5), [f]);
    expect(hasEffect(f, 'bestowCurse')).toBe(false);
    expect(f.inventory.at(-1).cursed).toBe(false);
    expect(r.flags.uncursedItems).toBe(1);
  });
  it('cure/cause blindness and disease', () => {
    const rng = new Rng(24);
    const f = fighter();
    addEffect(f, 'blinded');
    addEffect(f, 'diseased');
    cast(rng, 'cureBlindness', priest(5), [f]);
    cast(rng, 'cureDisease', priest(5), [f]);
    expect(hasEffect(f, 'blinded')).toBe(false);
    expect(hasEffect(f, 'diseased')).toBe(false);
  });
});

describe('utility and personal spells', () => {
  it('camp spells raise flags', () => {
    const rng = new Rng(25);
    expect(cast(rng, 'detectMagic', mage(1)).flags.detectMagic).toBe(true);
    expect(cast(rng, 'knock', mage(3)).flags.unlock).toBe(true);
    expect(cast(rng, 'readMagic', mage(1)).flags.readMagic).toBe(true);
    expect(cast(rng, 'findTraps', priest(3)).flags.findTraps).toBe(true);
  });
  it('shield, mirror image, invisibility, blink, enlarge, strength', () => {
    const rng = new Rng(26);
    const m = mage(3);
    cast(rng, 'shield', m);
    expect(getEffect(m, 'shielded').rounds).toBe(15);
    cast(rng, 'mirrorImage', m);
    const imgs = getEffect(m, 'mirrorImage').data.images;
    expect(imgs).toBeGreaterThanOrEqual(1);
    expect(imgs).toBeLessThanOrEqual(4);
    const f = fighter({ abilities: abil({ str: 12 }) });
    cast(rng, 'invisibility', m, [f]);
    expect(effectMods(f).attackerHit).toBe(-4);
    cast(rng, 'enlarge', mage(6), [f]);
    expect(deriveStats(f).abilities).toMatchObject({ str: 18, strPct: 100 });
    const g = fighter({ abilities: abil({ str: 12 }) });
    cast(rng, 'strength', m, [g]);
    const bonus = getEffect(g, 'strength').data.bonus;
    expect(deriveStats(g).abilities.str).toBe(Math.min(18, 12 + bonus));
  });
  it('ray of enfeeblement weakens', () => {
    const rng = new Rng(27);
    const f = fighter({ abilities: abil({ str: 16 }) });
    let r;
    do { f.effects = []; f.conditions = []; r = cast(rng, 'rayOfEnfeeblement', mage(5), [f], { check: false }).results[0]; } while (!r.affected);
    expect(deriveStats(f).abilities.str).toBe(Math.floor(16 * 0.71));
  });
  it('invisible creatures cannot be singled out by hostile spells', () => {
    const rng = new Rng(28);
    const [o] = mons(rng, 'orc', 1);
    addEffect(o, 'invisible');
    expect(cast(rng, 'magicMissile', mage(1), [o]).results[0].immune).toBe(true);
  });
  it('works on party combatants and shares effects with the character', () => {
    const rng = new Rng(29);
    const f = fighter();
    const c = combatantFromCharacter(f);
    cast(rng, 'bless', priest(), [c]);
    expect(hasEffect(f, 'blessed')).toBe(true);
    expect(c.conditions).toContain('blessed');
  });
});
