import { describe, it, expect } from 'vitest';
import { ITEMS } from '../../src/data/items.js';
import { MONSTERS } from '../../src/data/monsters.js';
import { SPELLS } from '../../src/data/spells.js';
import { ENCOUNTERS } from '../../src/data/encounters.js';
import { SHOPS } from '../../src/data/shops.js';
import { validateTable } from '../../src/data/schema.js';
import { getMap, MAP_IDS } from '../../src/data/maps/index.js';
import { EDGE, DIRS, DIR_VEC, OPPOSITE } from '../../src/data/maps/MapGrid.js';

describe('data tables', () => {
  it('validate', () => {
    expect(validateTable(ITEMS, ['name', 'type', 'cost', 'weight'])).toEqual([]);
    expect(validateTable(MONSTERS, ['name', 'hd', 'ac', 'thac0', 'attacks', 'xp'])).toEqual([]);
    expect(validateTable(SPELLS, ['name', 'school', 'level'])).toEqual([]);
    expect(validateTable(ENCOUNTERS, ['name', 'groups'])).toEqual([]);
  });
  it('encounters reference real monsters', () => {
    for (const e of Object.values(ENCOUNTERS)) for (const g of e.groups) expect(MONSTERS[g.monster], g.monster).toBeTruthy();
  });
  it('shops reference real items', () => {
    for (const s of Object.values(SHOPS)) for (const id of s.stock ?? []) expect(ITEMS[id], id).toBeTruthy();
  });
});

describe('maps', () => {
  for (const id of MAP_IDS) {
    it(`${id} edges are symmetric and events valid`, () => {
      const m = getMap(id);
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) for (const d of DIRS) {
        const [dx, dy] = DIR_VEC[d];
        if (!m.inBounds(x + dx, y + dy)) continue;
        expect(m.getEdge(x, y, d)).toBe(m.getEdge(x + dx, y + dy, OPPOSITE[d]));
      }
      for (const e of m.events) {
        expect(m.inBounds(e.x, e.y)).toBe(true);
        if (e.type === 'encounter') expect(ENCOUNTERS[e.ref], e.ref).toBeTruthy();
      }
      expect(m.toAscii().split('\n').length).toBe(m.h * 2 + 1);
    });
  }
  it('phlan_slums movement rules', () => {
    const m = getMap('phlan_slums');
    expect(m.tryMove(1, 14, 'E').ok).toBe(true);
    expect(m.tryMove(0, 0, 'N').ok).toBe(false);
    expect(m.tryMove(7, 9, 'N').ok).toBe(true); // arch into temple
    expect(m.getEdge(12, 8, 'W')).toBe(EDGE.LOCKED);
    expect(m.tryMove(11, 8, 'E').reason).toBe('locked');
    expect(m.tryMove(10, 13, 'E').ok).toBe(false); // secret, not found
    expect(m.tryMove(10, 13, 'E', { foundSecrets: new Set(['10,13,E']) }).ok).toBe(true);
  });
});
