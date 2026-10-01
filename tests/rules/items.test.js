import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, addItem, deriveStats, equipItem } from '../../src/rules/character.js';
import {
  itemName, itemMagic, itemValue, itemWeight, rateOfFire, armorMoveLimit, encumbranceCategory, coinsToGp, makeEntry, isMagical,
} from '../../src/rules/items.js';
import { useItem, scribeScroll, canUseScroll, identifyItem, detectMagicIn } from '../../src/rules/magicItems.js';
import { ITEMS } from '../../src/data/items.js';
import { hasEffect } from '../../src/rules/conditions.js';
import { combatantFromMonster } from '../../src/rules/combat.js';

const abil = (o = {}) => ({ str: 12, strPct: 0, int: 12, wis: 12, dex: 12, con: 12, cha: 12, ...o });

describe('item helpers', () => {
  it('names honour identification and enchantment overrides', () => {
    expect(itemName(makeEntry('longSwordPlus1'))).toBe('Long Sword');
    expect(itemName({ ...makeEntry('longSwordPlus1'), identified: true })).toBe('Long Sword +1');
    const e = makeEntry('longSword', { magic: 2 });
    expect(e.identified).toBe(false);
    expect(itemName(e)).toBe('Long Sword');
    e.identified = true;
    expect(itemName(e)).toBe('Long Sword +2');
    expect(itemName({ ...makeEntry('chainMail', { magic: -1 }), identified: true })).toBe('Chain Mail -1');
    expect(itemMagic(e)).toBe(2);
    expect(isMagical(e)).toBe(true);
    expect(isMagical(makeEntry('dagger'))).toBe(false);
  });
  it('value and weight', () => {
    expect(itemValue(makeEntry('longSword'))).toBe(15);
    expect(itemValue(makeEntry('longSword', { magic: 2 }))).toBe(15 + 1500 * 4);
    expect(itemWeight(makeEntry('plateMail'))).toBe(450);
    expect(itemWeight(makeEntry('plateMail', { magic: 1 }))).toBe(225);
    expect(itemWeight(makeEntry('arrows'))).toBe(ITEMS.arrows.weight);
  });
  it('rate of fire and armour movement', () => {
    expect(rateOfFire(ITEMS.shortBow)).toBe(2);
    expect(rateOfFire(ITEMS.dart)).toBe(3);
    expect(rateOfFire(ITEMS.sling)).toBe(1);
    expect(rateOfFire(ITEMS.longSword)).toBe(1);
    expect(armorMoveLimit(ITEMS.plateMail)).toBe(6);
    // Magic armour moves at the PHB base rate; its benefit is half weight.
    expect(armorMoveLimit(ITEMS.plateMail, 1)).toBe(6);
    expect(armorMoveLimit(ITEMS.leather)).toBe(12);
    expect(armorMoveLimit(null)).toBe(12);
  });
  it('encumbrance categories', () => {
    expect(encumbranceCategory(350).category).toBe(0);
    expect(encumbranceCategory(351).move).toBe(9);
    expect(encumbranceCategory(1050).move).toBe(6);
    expect(encumbranceCategory(1500).move).toBe(3);
    expect(encumbranceCategory(1501).move).toBe(0);
    expect(encumbranceCategory(1501, 1000).move).toBe(9);
  });
  it('coins', () => {
    expect(coinsToGp({ cp: 250, sp: 30, ep: 4, gp: 10, pp: 2 })).toBe(2 + 3 + 2 + 10 + 10);
  });
  it('bows fire twice per round', () => {
    const ch = createCharacter({ rng: new Rng(1), name: 'A', race: 'human', classSpec: 'fighter', abilities: abil({ dex: 16 }), items: ['shortBow', 'arrows'] });
    const s = deriveStats(ch);
    expect(s.ranged).toBe(true);
    expect(s.attacks).toBe(2);
    expect(s.hitBonus).toBe(1);
    expect(s.dmgBonus).toBe(0);
  });
});

describe('using magic items', () => {
  it('potions heal and are consumed', () => {
    const rng = new Rng(2);
    const ch = createCharacter({ rng, name: 'A', race: 'human', classSpec: 'fighter', abilities: abil(), items: ['potionHealing'] });
    ch.hp.cur = 1;
    const r = useItem(rng, ch, 0);
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(true);
    expect(ch.hp.cur).toBeGreaterThan(1);
    expect(ch.inventory.length).toBe(0);
  });
  it('wands spend charges and cast at 6th level', () => {
    const rng = new Rng(3);
    const ch = createCharacter({ rng, name: 'M', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 16 }), items: ['wandMagicMissile'] });
    const orc = combatantFromMonster(rng, 'ogre', 1);
    orc.hp = { cur: 100, max: 100 };
    const charges = ch.inventory[0].charges;
    const r = useItem(rng, ch, 0, [orc]);
    expect(r.ok).toBe(true);
    expect(ch.inventory[0].charges).toBe(charges - 1);
    expect(r.cast.level).toBe(6);
    expect(r.cast.results[0].damage).toBeGreaterThanOrEqual(6); // 3 missiles
    ch.inventory[0].charges = 0;
    expect(useItem(rng, ch, 0, [orc]).reason).toBe('no charges');
  });
  it('scrolls: class restrictions, casting and scribing', () => {
    const rng = new Rng(4);
    const m = createCharacter({ rng, name: 'M', race: 'human', classSpec: 'magicUser', abilities: abil({ int: 16 }), items: ['scrollSleep', 'scrollCureLight'] });
    const f = createCharacter({ rng, name: 'F', race: 'human', classSpec: 'fighter', abilities: abil(), items: ['scrollSleep'] });
    expect(canUseScroll(m, 'sleep')).toBe(true);
    expect(canUseScroll(f, 'sleep')).toBe(false);
    expect(useItem(rng, f, 0).reason).toBe('cannot read this scroll');
    expect(useItem(rng, m, 1).reason).toBe('cannot read this scroll');
    const ks = [combatantFromMonster(rng, 'kobold', 1)];
    const r = useItem(rng, m, 0, ks);
    expect(r.ok).toBe(true);
    expect(hasEffect(ks[0], 'asleep')).toBe(true);
    expect(m.inventory.map((e) => e.id)).toEqual(['scrollCureLight']);
    // Scribing a multi-spell generated scroll
    const s = addItem(m, 'scrollSleep', { spells: ['burningHands', 'charmPerson'] });
    const idx = m.inventory.indexOf(s);
    expect(scribeScroll(m, idx, 'burningHands').ok).toBe(true);
    expect(m.spells.book).toContain('burningHands');
    expect(m.inventory[idx].spells).toEqual(['charmPerson']);
    expect(scribeScroll(m, idx, 'charmPerson', { readMagic: false }).reason).toBe('needs read magic');
  });
  it('identify and detect magic', () => {
    const ch = createCharacter({ rng: new Rng(1), name: 'F', race: 'human', classSpec: 'fighter', abilities: abil(), items: ['longSwordPlus1', 'dagger'] });
    expect(detectMagicIn(ch)).toEqual([0]);
    expect(identifyItem(ch.inventory[0])).toBe('Long Sword +1');
  });
  it('equip swaps weapons', () => {
    const ch = createCharacter({ rng: new Rng(1), name: 'F', race: 'human', classSpec: 'fighter', abilities: abil(), items: ['longSword', 'mace'] });
    equipItem(ch, 1);
    expect(deriveStats(ch).weapon.id).toBe('mace');
  });
});
