import { strengthTable } from './abilities.js';
import { deriveStats, equipped, isConscious, effectiveAbilities } from './character.js';
import { hasEffect } from './conditions.js';

/**
 * Exploration rules: locked and barred doors, traps, secret doors, racial
 * senses and surprise. Pure and deterministic (all chance through `rng`);
 * the explore scene decides *when* to call these and spends the returned
 * `minutes` with game.advanceTime().
 *
 * A door/obstacle is a plain object (the scene can keep one per LOCKED edge):
 *   { locked?, barred?, stuck?, wizardLocked?, bars?, lockMod?, knocked?, failedBy? }
 *  - locked: a lock — a thief's Open Locks, Knock, or a STR "locked door" roll
 *  - barred: barred from the far side — Knock or the STR locked-door roll only
 *  - stuck: merely stuck — the ordinary STR open-doors roll
 *  - wizardLocked: Knock (or Dispel Magic) only
 *  - bars: a portcullis/grate/bars — Bend Bars/Lift Gates %, or Knock
 *  - lockMod: % added to Open Locks (a fine lock: -20)
 *  - failedBy: {charId: thiefLevel} — PHB: a thief who fails a lock cannot
 *    try that lock again until gaining a level (written by tryOpenLock)
 */

/**
 * PHB/DMG Strength open-doors chance as {n, die}: n in die. `locked` uses the
 * parenthetical figure (locked, barred or magically held doors), which only
 * 18/91+ and giant strength have.
 * @returns {{n:number, die:number}}
 */
export function openDoorsChance(str, pct = 0, { locked = false } = {}) {
  if (str >= 19) {
    const G = {
      19: [7, 8, 3, 6], 20: [7, 8, 3, 6], 21: [9, 10, 4, 6], 22: [11, 12, 4, 6],
      23: [11, 12, 5, 6], 24: [19, 20, 7, 8], 25: [23, 24, 9, 10],
    }[Math.min(25, str)];
    return locked ? { n: G[2], die: G[3] } : { n: G[0], die: G[1] };
  }
  if (locked) {
    if (str === 18 && pct >= 100) return { n: 2, die: 6 };
    if (str === 18 && pct >= 91) return { n: 1, die: 6 };
    return { n: 0, die: 6 };
  }
  return { n: strengthTable(str, pct).doors, die: 6 };
}

/** Bend Bars / Lift Gates % for a STR score. */
export function bendBarsChance(str, pct = 0) {
  return strengthTable(str, pct).bars;
}

const able = (ch) => ch && isConscious(ch) && !hasEffect(ch, 'asleep') && !hasEffect(ch, 'held') && !hasEffect(ch, 'paralyzed');

/** Party members able to act (conscious, not held/asleep). */
export function ableMembers(party) {
  return (party ?? []).filter(able);
}

/** Open Locks % of a character right now (0 for non-thieves or in heavy armour). */
export function openLocksChance(ch, door = {}) {
  const t = deriveStats(ch).thief;
  if (!t || !t.ol) return 0;
  return Math.max(0, Math.min(99, t.ol + (door.lockMod ?? 0)));
}

/**
 * Try to get through a locked/barred/stuck door, the way a Gold Box party
 * would: Knock first (o.knock — a Knock just cast, or door.knocked), then the
 * best thief's Open Locks (once per thief level per lock), then the
 * strongest member forcing it (STR open doors; the locked-door figure for a
 * lock, bar or hold; Bend Bars for a grate). Wizard locks yield only to Knock.
 * Each attempt costs a minute or so; the total is in `minutes`.
 * @param {import('./dice.js').Rng} rng
 * @param {object[]} party Characters
 * @param {object} door see the module doc
 * @param {{knock?:boolean, force?:boolean, pick?:boolean, retry?:boolean}} [o] force/pick false skip that method;
 *   retry ignores the once-per-level limit on picking a lock
 * @returns {{opened:boolean, method:'open'|'knock'|'pick'|'force'|'bars'|null, who:object|null, chance:number,
 *   roll:number|null, minutes:number, attempts:object[], text:string}}
 */
export function tryOpenLock(rng, party, door = {}, o = {}) {
  const attempts = [];
  const res = (opened, method, who, chance, roll, text) => ({
    opened, method, who, chance, roll, minutes: Math.max(1, attempts.length), attempts, text,
  });
  if (o.knock || door.knocked) {
    door.locked = door.barred = door.stuck = door.wizardLocked = false;
    door.bars = false;
    attempts.push({ method: 'knock', ok: true });
    return res(true, 'knock', null, 100, null, 'The Knock spell springs the lock with a hollow clack.');
  }
  if (door.wizardLocked) {
    return res(false, null, null, 0, null, 'The door is held fast by magic. Only a Knock will open it.');
  }
  if (!door.locked && !door.barred && !door.stuck && !door.bars) {
    return res(true, 'open', null, 100, null, 'The door opens.');
  }
  const members = ableMembers(party);
  // 1. A thief picks the lock (bars and barred doors cannot be picked).
  if (door.locked && !door.barred && !door.bars && o.pick !== false) {
    const thieves = members
      .map((ch) => ({ ch, chance: openLocksChance(ch, door) }))
      .filter((x) => x.chance > 0 && (o.retry || (door.failedBy?.[x.ch.id] ?? -1) < (x.ch.levels?.thief ?? 0)))
      .sort((a, b) => b.chance - a.chance);
    const t = thieves[0];
    if (t) {
      const r = rng.int(1, 100);
      const ok = r <= t.chance;
      attempts.push({ method: 'pick', who: t.ch.id, chance: t.chance, roll: r, ok });
      if (ok) {
        door.locked = false;
        return res(true, 'pick', t.ch, t.chance, r, `${t.ch.name} picks the lock.`);
      }
      door.failedBy = { ...(door.failedBy ?? {}), [t.ch.id]: t.ch.levels?.thief ?? 0 };
    }
  }
  if (o.force === false) {
    const last = attempts[attempts.length - 1];
    return res(false, null, null, last?.chance ?? 0, last?.roll ?? null, last ? 'The lock resists the picks.' : 'Nobody here can pick this lock.');
  }
  // 2. Brute force by the strongest member.
  const strength = (ch) => effectiveAbilities(ch);
  if (door.bars) {
    const best = members.map((ch) => ({ ch, chance: bendBarsChance(strength(ch).str, strength(ch).strPct) })).sort((a, b) => b.chance - a.chance)[0];
    if (!best || best.chance <= 0) return res(false, null, null, 0, null, 'Nobody is strong enough to bend these bars.');
    const r = rng.int(1, 100);
    const ok = r <= best.chance;
    attempts.push({ method: 'bars', who: best.ch.id, chance: best.chance, roll: r, ok });
    if (ok) door.bars = false;
    return res(ok, ok ? 'bars' : null, best.ch, best.chance, r, ok ? `${best.ch.name} wrenches the bars apart.` : `${best.ch.name} strains at the bars in vain.`);
  }
  const locked = !!(door.locked || door.barred);
  const best = members
    .map((ch) => {
      const a = strength(ch);
      const c = openDoorsChance(a.str, a.strPct, { locked });
      return { ch, ...c, chance: Math.round((100 * c.n) / c.die) };
    })
    .sort((a, b) => b.chance - a.chance)[0];
  if (!best || best.n <= 0) {
    const last = attempts[attempts.length - 1];
    return res(false, null, null, 0, last?.roll ?? null, last ? `${members.find((m) => m.id === last.who)?.name ?? 'The thief'} fails to pick the lock, and nobody can force it.` : locked ? 'The door is locked fast. Only a thief, a Knock or a giant\'s strength will open it.' : 'Nobody can budge the door.');
  }
  const r = rng.int(1, best.die);
  const ok = r <= best.n;
  attempts.push({ method: 'force', who: best.ch.id, chance: best.chance, roll: r, die: best.die, ok });
  if (ok) door.locked = door.barred = door.stuck = false;
  return res(ok, ok ? 'force' : null, best.ch, best.chance, r, ok ? `${best.ch.name} forces the door with a splintering crash.` : `${best.ch.name} throws a shoulder at the door; it holds.`);
}

/**
 * Detect a trap before it is sprung: a Find Traps spell on anyone finds it
 * outright; otherwise the best thief's Find/Remove Traps roll, and dwarves
 * (and gnomes) sense traps built into stonework (`trap.stonework`: 50%).
 * @param {{mod?:number, stonework?:boolean}} [trap]
 * @returns {{found:boolean, by:object|null, method:'spell'|'thief'|'stonework'|null, rolls:object[]}}
 */
export function detectTrap(rng, party, trap = {}) {
  const members = ableMembers(party);
  const rolls = [];
  const caster = members.find((ch) => hasEffect(ch, 'findTraps'));
  if (caster) return { found: true, by: caster, method: 'spell', rolls };
  const t = members
    .map((ch) => ({ ch, chance: Math.max(0, Math.min(99, (deriveStats(ch).thief?.ft ?? 0) + (trap.mod ?? 0))) }))
    .filter((x) => x.chance > 0)
    .sort((a, b) => b.chance - a.chance)[0];
  if (t) {
    const r = rng.int(1, 100);
    rolls.push({ method: 'thief', who: t.ch.id, chance: t.chance, roll: r });
    if (r <= t.chance) return { found: true, by: t.ch, method: 'thief', rolls };
  }
  if (trap.stonework) {
    for (const ch of members.filter((m) => m.race === 'dwarf' || m.race === 'gnome')) {
      const r = rng.int(1, 100);
      const chance = stoneSenseChance(ch.race, 'trap');
      rolls.push({ method: 'stonework', who: ch.id, chance, roll: r });
      if (r <= chance) return { found: true, by: ch, method: 'stonework', rolls };
    }
  }
  return { found: false, by: null, method: null, rolls };
}

/**
 * A thief's Find/Remove Traps roll to disarm a found trap (PHB: one roll;
 * failure by 20+ springs it unless `o.safe`). Non-thieves cannot try.
 * @param {{mod?:number}} [trap]
 * @param {{safe?:boolean}} [o]
 * @returns {{removed:boolean, sprung:boolean, chance:number, roll:number|null, text:string}}
 */
export function findRemoveTraps(rng, ch, trap = {}, o = {}) {
  const chance = able(ch) ? Math.max(0, Math.min(99, (deriveStats(ch).thief?.ft ?? 0) + (trap.mod ?? 0))) : 0;
  if (!chance) return { removed: false, sprung: false, chance: 0, roll: null, text: `${ch?.name ?? 'Nobody'} has no skill with traps.` };
  const r = rng.int(1, 100);
  const removed = r <= chance;
  const sprung = !removed && !o.safe && r > chance + 20;
  return {
    removed, sprung, chance, roll: r,
    text: removed ? `${ch.name} disarms the trap.` : sprung ? `${ch.name} fumbles and springs the trap!` : `${ch.name} cannot disarm the trap.`,
  };
}

/**
 * Chance in 6 to find a secret or concealed door (PHB): elves and half-elves
 * notice one 1 in 6 just passing by, and find it 2 in 6 when searching (3 in
 * 6 if merely concealed); everyone else 1 in 6, and only when searching.
 * @param {string} race
 * @param {{passive?:boolean, concealed?:boolean}} [o]
 */
export function secretDoorChance(race, o = {}) {
  const elvish = race === 'elf' || race === 'halfElf';
  if (o.passive) return elvish ? 1 : 0;
  if (elvish) return o.concealed ? 3 : 2;
  return 1;
}

/**
 * Look for a secret door at one wall: every able member rolls their own
 * chance (secretDoorChance); found if anyone succeeds. A dwarf searching a
 * sliding wall (`door.sliding`) uses the stonework sense instead when better.
 * Searching takes a turn (10 minutes); a passive check (walking past) none.
 * @param {{passive?:boolean, concealed?:boolean, sliding?:boolean}} [o]
 * @returns {{found:boolean, by:object|null, rolls:object[], minutes:number}}
 */
export function searchSecret(rng, party, o = {}) {
  const rolls = [];
  for (const ch of ableMembers(party)) {
    const n = secretDoorChance(ch.race, o);
    let found = false;
    if (n > 0) {
      const r = rng.die(6);
      rolls.push({ who: ch.id, chance: n, die: 6, roll: r });
      found = r <= n;
    }
    if (!found && !o.passive && o.sliding && (ch.race === 'dwarf' || ch.race === 'gnome')) {
      const chance = stoneSenseChance(ch.race, 'sliding');
      if (chance) {
        const r = rng.int(1, 100);
        rolls.push({ who: ch.id, chance, roll: r, stonework: true });
        found = r <= chance;
      }
    }
    if (found) return { found: true, by: ch, rolls, minutes: o.passive ? 0 : 10 };
  }
  return { found: false, by: null, rolls, minutes: o.passive ? 0 : 10 };
}

/**
 * PHB dwarf / gnome underground senses (% within 10'): dwarves — slope 75,
 * new construction 75, sliding walls 66, stonework traps 50, depth 50;
 * gnomes — slope 80, unsafe walls/ceilings 70, depth 60, direction 50.
 * @param {'slope'|'newConstruction'|'sliding'|'trap'|'depth'|'unsafe'|'direction'} kind
 */
export function stoneSenseChance(race, kind) {
  const T = {
    dwarf: { slope: 75, newConstruction: 75, sliding: 66, trap: 50, depth: 50 },
    gnome: { slope: 80, unsafe: 70, depth: 60, direction: 50 },
  };
  return T[race]?.[kind] ?? 0;
}

/** Roll a dwarf/gnome stone sense. @returns {{sensed:boolean, chance:number, roll:number|null}} */
export function stoneSense(rng, ch, kind) {
  const chance = able(ch) ? stoneSenseChance(ch.race, kind) : 0;
  if (!chance) return { sensed: false, chance: 0, roll: null };
  const roll = rng.int(1, 100);
  return { sensed: roll <= chance, chance, roll };
}

const NON_METAL = new Set(['leather', 'padded']);

/** Is the character in non-metal armour (or none)? */
export function inNonMetalArmor(ch) {
  const body = equipped(ch).find(([, d]) => d.type === 'armor')?.[1];
  return !body || NON_METAL.has(body.armorGroup);
}

/**
 * Racial surprise (PHB): elves and halflings in non-metal armour surprise
 * others 4 in 6 instead of 2 in 6 — when alone or scouting ahead (o.scout),
 * or when the whole moving group qualifies. Returns the modifier for
 * rollSurprise's monster roll (−2: monsters surprised on 1-4).
 * @param {object[]} party
 * @param {{scout?:object}} [o] a character scouting ahead of the party
 * @returns {{monsterMod:number, partyMod:number, reason:string|null}}
 */
export function surpriseMods(party, o = {}) {
  const stealthy = (ch) => (ch.race === 'elf' || ch.race === 'halfling') && inNonMetalArmor(ch);
  const group = o.scout ? [o.scout] : ableMembers(party);
  if (group.length && group.every(stealthy)) {
    return { monsterMod: -2, partyMod: 0, reason: o.scout ? `${o.scout.name} moves unseen ahead of the party.` : 'The party moves with elven stealth.' };
  }
  return { monsterMod: 0, partyMod: 0, reason: null };
}
