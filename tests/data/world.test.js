import { describe, it, expect } from 'vitest';
import { ITEMS } from '../../src/data/items.js';
import { ENCOUNTERS } from '../../src/data/encounters.js';
import { SHOPS } from '../../src/data/shops.js';
import { NPCS } from '../../src/data/npcs.js';
import { DIALOGUES } from '../../src/data/dialogue.js';
import { JOURNAL } from '../../src/data/journal.js';
import { QUESTS } from '../../src/data/quests.js';
import { TRAVEL } from '../../src/data/travel.js';
import { TEMPLE_SERVICES } from '../../src/rules/temple.js';
import { getMap, MAP_IDS } from '../../src/data/maps/index.js';
import { CELL, DIRS, EDGE } from '../../src/data/maps/MapGrid.js';

/** World-content integrity (owned by the world-content workstream). */

function reachable(m, sx, sy) {
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const d of DIRS) {
      const e = m.getEdge(x, y, d);
      if (e === EDGE.WALL || e === EDGE.LOCKED) continue;
      const r = m.tryMove(x, y, d, { foundSecrets: { has: () => true } });
      if (!r.ok || r.leaves) continue;
      const k = `${r.nx},${r.ny}`;
      if (!seen.has(k)) { seen.add(k); q.push([r.nx, r.ny]); }
    }
  }
  return seen;
}

const journalNums = new Set(JOURNAL.map((j) => j.n));

function checkEffects(list, where) {
  for (const ef of list ?? []) {
    if (ef.item) expect(ITEMS[ef.item], `${where} item ${ef.item}`).toBeTruthy();
    if (ef.take) expect(ITEMS[ef.take], `${where} take ${ef.take}`).toBeTruthy();
    if (ef.journal) expect(journalNums.has(ef.journal), `${where} journal ${ef.journal}`).toBe(true);
    if (ef.quest) expect(QUESTS[ef.quest], `${where} quest ${ef.quest}`).toBeTruthy();
  }
}

describe('world maps', () => {
  for (const id of MAP_IDS) {
    it(`${id}: every event reachable, travel targets valid`, () => {
      const m = getMap(id);
      expect(['city', 'ruins', 'dungeon', 'interior', 'graveyard', 'wilderness']).toContain(m.tileset);
      const seen = reachable(m, m.start.x, m.start.y);
      for (const e of m.events) {
        expect(seen.has(`${e.x},${e.y}`), `${id} event ${e.id} at ${e.x},${e.y} unreachable`).toBe(true);
        expect(m.getCell(e.x, e.y), `${id} event ${e.id} on water`).not.toBe(CELL.WATER);
        if (e.type === 'shop') expect(SHOPS[e.ref], e.ref).toBeTruthy();
      }
      const ids = m.events.map((e) => e.id);
      expect(new Set(ids).size, `${id} duplicate event ids`).toBe(ids.length);
    });
  }
  it('travel links land on walkable cells of real maps', () => {
    for (const t of TRAVEL) {
      const to = getMap(t.to.map);
      expect(to.getCell(t.to.x, t.to.y), t.id).not.toBe(CELL.WATER);
      const seen = reachable(to, to.start.x, to.start.y);
      expect(seen.has(`${t.to.x},${t.to.y}`), `${t.id} lands unreachable`).toBe(true);
      expect(getMap(t.from).eventsAt(t.at.x, t.at.y).some((e) => e.ref === `go_${t.id}`), t.id).toBe(true);
    }
  });
});

describe('dialogue scripts', () => {
  for (const [id, d] of Object.entries(DIALOGUES)) {
    it(`${id} is well-formed`, () => {
      expect(d.nodes[d.start], `${id} start`).toBeTruthy();
      for (const [nid, n] of Object.entries(d.nodes)) {
        const where = `${id}.${nid}`;
        if (n.speaker) expect(NPCS[n.speaker], `${where} speaker`).toBeTruthy();
        if (n.journal) expect(journalNums.has(n.journal), `${where} journal`).toBe(true);
        for (const b of n.branch ?? []) expect(d.nodes[b.goto], `${where} branch ${b.goto}`).toBeTruthy();
        if (n.next) expect(d.nodes[n.next], `${where} next`).toBeTruthy();
        checkEffects(n.do, where);
        for (const c of n.choices ?? []) {
          if (c.goto) expect(d.nodes[c.goto], `${where} goto ${c.goto}`).toBeTruthy();
          if (c.combat) expect(ENCOUNTERS[c.combat]?.groups.length, `${where} combat ${c.combat}`).toBeGreaterThan(0);
          if (c.check) for (const k of ['pass', 'fail']) expect(d.nodes[c.check[k]], `${where} check ${k}`).toBeTruthy();
          if (c.travel) expect(MAP_IDS).toContain(c.travel.map);
          if (c.shop) expect(SHOPS[c.shop]).toBeTruthy();
          checkEffects(c.do, where);
          checkEffects(c.win, where);
        }
        expect(n.choices?.length || n.next || n.end || n.branch?.length, `${where} dead end`).toBeTruthy();
      }
      if (d.art?.npc) expect(NPCS[d.art.npc], `${id} art npc`).toBeTruthy();
    });
  }
  it('scripted encounters point at scripts; parley reactions are valid', () => {
    for (const e of Object.values(ENCOUNTERS)) {
      if (e.dialogue) expect(DIALOGUES[e.dialogue], e.id).toBeTruthy();
      for (const r of Object.values(e.parley ?? {})) {
        expect(/^(fight|leave|flee|bribe:\d+|talk:\w+)$/.test(r), `${e.id} parley ${r}`).toBe(true);
        if (r.startsWith('talk:')) expect(DIALOGUES[r.slice(5)], `${e.id} ${r}`).toBeTruthy();
      }
      checkEffects(e.onWin, e.id);
    }
  });
});

describe('shops, quests, journal', () => {
  it('shops are consistent', () => {
    for (const s of Object.values(SHOPS)) {
      if (s.npc) expect(NPCS[s.npc], s.id).toBeTruthy();
      for (const k of Object.keys(s.services ?? {})) expect(TEMPLE_SERVICES[k], `${s.id} ${k}`).toBeTruthy();
      if (s.kind === 'hall') expect(DIALOGUES[s.script]).toBeTruthy();
      for (const r of s.rumors ?? []) if (r.journal) expect(journalNums.has(r.journal)).toBe(true);
    }
  });
  it('quests reference real blocks and journal entries', () => {
    for (const q of Object.values(QUESTS)) {
      expect(MAP_IDS).toContain(q.block);
      expect(journalNums.has(q.journal)).toBe(true);
      expect(NPCS[q.giver]).toBeTruthy();
      if (q.requires) expect(Object.values(QUESTS).some((o) => o.doneFlag === q.requires)).toBe(true);
    }
  });
  it('journal entries are numbered uniquely', () => {
    expect(journalNums.size).toBe(JOURNAL.length);
  });
});

describe('secret doors and wandering monsters', async () => {
  const { WANDERING, WANDER_ENCOUNTERS, rollWandering, restAmbush } = await import('../../src/data/wandering.js');
  const { MONSTERS } = await import('../../src/data/monsters.js');
  const { Rng } = await import('../../src/rules/dice.js');
  it('every block hides at least one secret door, and what lies behind it is reachable only through one', () => {
    for (const id of MAP_IDS) {
      const m = getMap(id);
      const secrets = [];
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) for (const d of DIRS) if (m.getEdge(x, y, d) === EDGE.SECRET) secrets.push([x, y, d]);
      expect(secrets.length, `${id} has no secret door`).toBeGreaterThan(0);
      // the cell behind a recorded hidden room is unreachable when secrets stay shut
      const shut = new Set([`${m.start.x},${m.start.y}`]);
      const q = [[m.start.x, m.start.y]];
      while (q.length) {
        const [x, y] = q.shift();
        for (const d of DIRS) {
          const r = m.tryMove(x, y, d, { foundSecrets: { has: () => false } });
          if (!r.ok || r.leaves) continue;
          const k = `${r.nx},${r.ny}`;
          if (!shut.has(k)) { shut.add(k); q.push([r.nx, r.ny]); }
        }
      }
      const hidden = new Set((m.secrets ?? []).map((h) => `${h.id}_cache`));
      for (const e of m.events.filter((ev) => hidden.has(ev.id))) expect(shut.has(`${e.x},${e.y}`), `${id} ${e.id} reachable without the secret door`).toBe(false);
    }
  });
  it('every occupied block keeps a wandering table of real, staged encounters; New Phlan keeps none', () => {
    expect(WANDERING.phlan_civilized).toBeNull();
    for (const id of MAP_IDS) {
      if (id === 'phlan_civilized') continue;
      const w = WANDERING[id];
      expect(w, `${id} has no wandering table`).toBeTruthy();
      expect(w.step).toBeGreaterThan(0);
      expect(w.rest).toBeGreaterThan(0);
      for (const [ref, n] of w.table) {
        expect(n).toBeGreaterThan(0);
        const e = ENCOUNTERS[ref];
        expect(e, `${id} ${ref}`).toBeTruthy();
        expect(e.art?.setting, `${ref} art`).toBeTruthy();
        for (const g of e.groups) expect(MONSTERS[g.monster], `${ref} ${g.monster}`).toBeTruthy();
      }
    }
    for (const e of Object.values(WANDER_ENCOUNTERS)) for (const r of Object.values(e.parley ?? {})) expect(/^(fight|leave|flee|bribe:\d+)$/.test(r), `${e.id} ${r}`).toBe(true);
  });
  it('wandering checks honour the grace after a fight, skip event squares, and are deterministic', () => {
    const roll = (seed, o) => { const rng = new Rng(seed); let n = 0; for (let i = 0; i < 2000; i++) if (rollWandering(rng, 'phlan_slums', o)) n++; return n; };
    expect(roll(3, { steps: 0 })).toBe(0);
    expect(roll(3, { steps: 20, hasEvent: true })).toBe(0);
    const a = roll(3, { steps: 20 });
    expect(a).toBeGreaterThan(10);
    expect(a).toBeLessThan(120);
    expect(roll(3, { steps: 20 })).toBe(a);
    expect(rollWandering(new Rng(1), 'phlan_civilized', { steps: 99 })).toBeNull();
    let ambushes = 0;
    for (let s = 1; s <= 200; s++) { const r = restAmbush(new Rng(s), 'valhingen_graveyard', 8 * 60); if (r) { ambushes++; expect(r.at).toBeLessThan(8 * 60); expect(ENCOUNTERS[r.ref]).toBeTruthy(); } }
    expect(ambushes).toBeGreaterThan(100);
    expect(restAmbush(new Rng(1), 'phlan_civilized', 600)).toBeNull();
  });
});
