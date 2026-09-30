import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { ITEMS } from '../../src/data/items.js';
import { MONSTERS } from '../../src/data/monsters.js';
import { ENCOUNTERS } from '../../src/data/encounters.js';
import { PARTIES } from '../../src/data/parties.js';
import { SPELL_RULES } from '../../src/rules/spells.js';
import { TREASURE_TYPES } from '../../src/rules/treasure.js';
import { createCharacter, addItem, deriveStats, canEquip, equipItem } from '../../src/rules/character.js';
import { validateConcept } from '../../src/rules/character.js';
import { UNDEAD_TYPES } from '../../src/rules/classes.js';
import { useItem } from '../../src/rules/magicItems.js';
import { combatantFromMonster } from '../../src/rules/combat.js';
import { buildParty } from '../../src/rules/party.js';

/** Content tables (world-content workstream) must stay consumable by the rules engine. */
describe('data ↔ rules integration', () => {
  it('every item can be carried, equipped when legal, and derived', () => {
    const rng = new Rng(1);
    for (const id of Object.keys(ITEMS)) {
      const ch = createCharacter({ rng, name: 'T', race: 'human', classSpec: 'fighter', abilities: { str: 16, strPct: 0, int: 10, wis: 10, dex: 12, con: 12, cha: 10 } });
      addItem(ch, id);
      if (canEquip(ch, id)) equipItem(ch, ch.inventory.length - 1);
      const s = deriveStats(ch);
      expect(Number.isFinite(s.ac), id).toBe(true);
      expect(Number.isFinite(s.weight), id).toBe(true);
    }
  });
  it('item effects are understood by the rules', () => {
    for (const d of Object.values(ITEMS)) {
      if (d.type === 'wand' || d.type === 'scroll') expect(SPELL_RULES[d.effect], `${d.id}: ${d.effect}`).toBeTruthy();
      if (d.type === 'potion') {
        const kind = String(d.effect).split(':')[0];
        expect(['heal', 'giantStrength', 'speed', 'neutralize', 'fullHeal'].includes(kind) || !!SPELL_RULES[kind], `${d.id}: ${d.effect}`).toBe(true);
      }
      if (d.type === 'weapon') expect(d.damage && d.damageLarge, d.id).toBeTruthy();
      if (d.type === 'armor') expect(d.ac, d.id).toBeGreaterThan(0);
    }
  });
  it('potions can be drunk', () => {
    const rng = new Rng(2);
    for (const d of Object.values(ITEMS).filter((x) => x.type === 'potion')) {
      const [ch] = buildParty('default', 1);
      addItem(ch, d.id);
      const r = useItem(rng, ch, ch.inventory.length - 1);
      expect(r.ok, d.id).toBe(true);
    }
  });
  it('monsters have rules-consistent stats', () => {
    const rng = new Rng(3);
    for (const m of Object.values(MONSTERS)) {
      expect(['S', 'M', 'L']).toContain(m.size);
      for (const a of m.attacks) expect(() => combatantFromMonster(rng, m.id)).not.toThrow(a);
      if (m.special?.includes('undead')) expect(UNDEAD_TYPES, `${m.id} turnAs`).toContain(m.turnAs ?? m.id);
      if (m.treasure) for (const t of [].concat(m.treasure)) expect(TREASURE_TYPES[t], `${m.id} treasure ${t}`).toBeTruthy();
    }
  });
  it('encounter treasure types are valid', () => {
    for (const e of Object.values(ENCOUNTERS)) {
      const types = e.treasure?.types ?? e.treasure?.type;
      if (types) for (const t of [].concat(types)) expect(TREASURE_TYPES[t], `${e.id} treasure ${t}`).toBeTruthy();
      for (const id of e.treasure?.items ?? []) expect(ITEMS[id], `${e.id} item ${id}`).toBeTruthy();
    }
  });
  it('prebuilt parties are rules-legal', () => {
    for (const [pid, p] of Object.entries(PARTIES)) {
      for (const m of p.members) {
        expect(validateConcept({ race: m.race, classSpec: m.classSpec, alignment: m.alignment, abilities: m.abilities, gender: m.gender }), `${pid}/${m.name}`).toEqual([]);
      }
    }
  });
});
