import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter, rollLegalAbilities, deriveStats, validateConcept } from '../../src/rules/character.js';
import { RACES } from '../../src/rules/races.js';
import { allowedAlignments, turnNeeded, monsterThac0 } from '../../src/rules/classes.js';
import { SPELL_IDS, SPELL_RULES, castSpell } from '../../src/rules/spells.js';
import { combatantFromCharacter, combatantFromMonster, attacksFor, resolveAttack, hitChance } from '../../src/rules/combat.js';
import { generateTreasure, treasureValue, TREASURE_TYPES } from '../../src/rules/treasure.js';
import { MONSTERS } from '../../src/data/monsters.js';

/**
 * Whole-space invariants: every race x legal class x gender x level builds a
 * legal character with finite derived numbers; every spell, cast by every
 * class that has it at several levels against a spread of real monsters,
 * resolves without throwing and never produces NaN or negative damage; every
 * monster can attack and be attacked; every treasure type rolls finite value.
 * These guard the data-driven tables against a typo anywhere.
 */

function finiteDeep(o, path, out, depth = 0) {
  if (!o || depth > 3) return;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && !Number.isFinite(v)) out.push(`${path}.${k}=${v}`);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'ref' && k !== 'weapon') finiteDeep(v, `${path}.${k}`, out, depth + 1);
  }
}

describe('every legal character concept', () => {
  it('builds with finite stats, legal saves and positive hp at levels 1-9', () => {
    const bad = [];
    let n = 0;
    for (const race of Object.keys(RACES)) for (const spec of RACES[race].classes) for (const gender of ['male', 'female']) {
      for (let level = 1; level <= 9; level++) {
        const rng = new Rng(1000 + n++);
        const abilities = rollLegalAbilities(rng, race, spec, '4d6', gender);
        const alignment = allowedAlignments(spec)[0];
        const problems = validateConcept({ race, classSpec: spec, alignment, abilities, gender });
        if (problems.length) bad.push(`${race} ${spec} ${gender}: ${problems.join(', ')}`);
        const ch = createCharacter({ rng, name: 'x', race, classSpec: spec, gender, abilities, level, alignment });
        const d = deriveStats(ch);
        finiteDeep(d, `${race}/${spec}/L${level}`, bad);
        if (!(ch.hp.max > 0)) bad.push(`${race} ${spec} L${level} hp ${ch.hp.max}`);
        for (const [k, v] of Object.entries(d.saves)) if (v < 2 || v > 20) bad.push(`${race} ${spec} save ${k}=${v}`);
        if (d.thac0 < 1 || d.thac0 > 21) bad.push(`${race} ${spec} thac0 ${d.thac0}`);
      }
    }
    expect(n).toBeGreaterThan(400);
    expect(bad).toEqual([]);
  });
});

describe('every spell', () => {
  const ids = Object.keys(MONSTERS);
  const abil = { str: 12, strPct: 0, int: 17, wis: 17, dex: 12, con: 12, cha: 12 };
  it('resolves for every school at levels 1/3/6/9 against real monsters without NaN', () => {
    const bad = [];
    for (const id of SPELL_IDS) {
      const r = SPELL_RULES[id];
      for (const school of Object.keys(r.schools)) for (const L of [1, 3, 6, 9]) {
        const rng = new Rng(L * 7 + id.length);
        const caster = combatantFromCharacter(createCharacter({ rng, name: 'c', race: 'human', classSpec: school, level: L, abilities: abil }));
        const ally = combatantFromCharacter(createCharacter({ rng, name: 'a', race: 'elf', classSpec: 'fighter', level: 2, abilities: abil }));
        ally.ref.hp.cur = 1;
        const foes = [0, 1, 2, 3].map((i) => combatantFromMonster(rng, ids[(L * 5 + i * 11 + id.length) % ids.length], i + 1));
        const friendly = r.affects === 'allies' || ['ally', 'party', 'self'].includes(r.target);
        try {
          const res = castSpell(rng, id, caster, friendly ? [ally, caster] : foes, {
            ignoreMemory: true, level: L, school, context: r.usable === 'camp' ? 'camp' : 'combat', noFailure: true,
          });
          if (!res.ok) bad.push(`${id}/${school}/L${L}: ${res.reason}`);
          for (const t of res.results ?? []) {
            for (const k of ['damage', 'healed']) if (t[k] !== undefined && (!Number.isFinite(t[k]) || t[k] < 0)) bad.push(`${id} ${k}=${t[k]}`);
            const hp = t.target.hp?.cur ?? t.target.ref?.hp?.cur;
            if (!Number.isFinite(hp)) bad.push(`${id} hp=${hp}`);
          }
          if (!res.log.every((l) => typeof l === 'string' && l.length && !/undefined|NaN/.test(l))) bad.push(`${id} log ${res.log.join(' | ')}`);
        } catch (e) {
          bad.push(`${id}/${school}/L${L} threw ${e.message}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('every monster', () => {
  it('attacks and is attacked with finite numbers', () => {
    const bad = [];
    const f = combatantFromCharacter(createCharacter({
      rng: new Rng(1), name: 'f', race: 'human', classSpec: 'fighter', level: 5,
      abilities: { str: 18, strPct: 50, int: 9, wis: 9, dex: 14, con: 16, cha: 9 }, items: ['longSword', 'chainMail', 'shield'],
    }));
    for (const id of Object.keys(MONSTERS)) {
      const rng = new Rng(id.length);
      const m = combatantFromMonster(rng, id, 1);
      if (!(m.hp.max > 0)) bad.push(`${id} hp ${m.hp.max}`);
      for (let round = 1; round <= 4; round++) {
        const a = attacksFor(m, round);
        if (!Number.isInteger(a) || a < 0) bad.push(`${id} attacks ${a}`);
        const r1 = resolveAttack(rng, m, f);
        const r2 = resolveAttack(rng, f, m);
        for (const r of [r1, r2]) if (!Number.isFinite(r.damage ?? 0) || (r.damage ?? 0) < 0) bad.push(`${id} dmg ${r.damage}`);
      }
      for (const p of [hitChance(m, f), hitChance(f, m)]) if (!(p >= 0 && p <= 1)) bad.push(`${id} p ${p}`);
      f.ref.hp.cur = f.ref.hp.max;
      f.ref.status = 'ok';
    }
    expect(bad).toEqual([]);
  });
});

describe('every treasure type', () => {
  it('rolls a finite, non-negative value', () => {
    for (const t of Object.keys(TREASURE_TYPES)) {
      const rng = new Rng(t.charCodeAt(0));
      for (let i = 0; i < 25; i++) {
        const v = treasureValue(generateTreasure(rng, [t]));
        expect(Number.isFinite(v) && v >= 0, `type ${t}`).toBe(true);
      }
    }
    expect(Object.keys(TREASURE_TYPES).sort().join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });
});

describe('DMG matrices, cell by cell', () => {
  it('turn undead, types 1-9 at cleric levels 1-8 (DMG p.75)', () => {
    const want = {
      skeleton: [10, 7, 4, 'T', 'T', 'D', 'D', 'D*'],
      zombie: [13, 10, 7, 'T', 'T', 'D', 'D', 'D*'], // re-verified: D* from 8th, like skeletons
      ghoul: [16, 13, 10, 4, 'T', 'T', 'D', 'D'],
      shadow: [19, 16, 13, 7, 4, 'T', 'T', 'D'],
      wight: [20, 19, 16, 10, 7, 4, 'T', 'T'],
      ghast: ['-', 20, 19, 13, 10, 7, 4, 'T'],
      wraith: ['-', '-', 20, 16, 13, 10, 7, 4],
      mummy: ['-', '-', '-', 20, 16, 13, 10, 7],
      spectre: ['-', '-', '-', '-', 20, 16, 13, 10],
    };
    for (const [type, row] of Object.entries(want)) {
      row.forEach((v, i) => expect(turnNeeded(i + 1, type), `${type} L${i + 1}`).toBe(v));
    }
    // 9th-13th and 14th+ columns of the first rows: ghouls are D* from 9th, shadows only at 14th.
    expect([9, 13, 14].map((l) => turnNeeded(l, 'ghoul'))).toEqual(['D*', 'D*', 'D*']);
    expect([9, 14].map((l) => turnNeeded(l, 'shadow'))).toEqual(['D', 'D*']);
    expect([9, 14].map((l) => turnNeeded(l, 'wight'))).toEqual(['D', 'D']);
  });
  it('monster THAC0 by hit dice (DMG monster attack matrix)', () => {
    const want = [[0.5, 0, 20], [1, -1, 20], [1, 0, 19], [1, 2, 18], [2, 0, 16], [3, 3, 16], [4, 1, 15], [5, 0, 15],
      [6, 6, 13], [7, 0, 13], [8, 2, 12], [9, 0, 12], [10, 0, 10], [12, 0, 9], [14, 0, 8], [16, 0, 7]];
    for (const [hd, b, t] of want) expect(monsterThac0(hd, b), `${hd}${b >= 0 ? '+' : ''}${b}`).toBe(t);
  });
});
