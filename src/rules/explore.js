import { strengthTable } from './abilities.js';
import { deriveStats, equipped, isConscious, effectiveAbilities, applyDamage } from './character.js';
import { hasEffect, addEffect, ROUNDS_PER_TURN } from './conditions.js';
import { roll } from './dice.js';
import { rollSave } from './saves.js';
import { neededToHit } from './tohit.js';

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
 * QoL RULE (Gold Box), not 1e: when the party merely steps onto (or opens)
 * a trapped thing without searching, the best thief still gets a free
 * Find/Remove Traps roll and dwarves/gnomes their stone sense. The PHB needs
 * an active search (a turn spent) for both. Pass `{passive:false}` to
 * detectTrap / resolveTrap / triggerMapTrap (or `strict1e: true`) to play it
 * by the book: an unsearched trap is found only by a Find Traps spell.
 */
export const PASSIVE_TRAP_DETECTION = true;

/**
 * Detect a trap before it is sprung: a Find Traps spell on anyone finds it
 * outright; otherwise the best thief's Find/Remove Traps roll, and dwarves
 * (and gnomes) sense traps built into stonework (`trap.stonework`: 50%).
 * Without `o.search`, the thief and stone-sense rolls happen only under the
 * PASSIVE_TRAP_DETECTION QoL rule (`o.passive`, default on; off with
 * `o.strict1e`).
 * @param {{mod?:number, stonework?:boolean}} [trap]
 * @param {{search?:boolean, passive?:boolean, strict1e?:boolean}} [o]
 * @returns {{found:boolean, by:object|null, method:'spell'|'thief'|'stonework'|null, rolls:object[]}}
 */
export function detectTrap(rng, party, trap = {}, o = {}) {
  const members = ableMembers(party);
  const rolls = [];
  const caster = members.find((ch) => hasEffect(ch, 'findTraps'));
  if (caster) return { found: true, by: caster, method: 'spell', rolls };
  const passive = o.passive ?? (o.strict1e ? false : PASSIVE_TRAP_DETECTION);
  if (!o.search && !passive) return { found: false, by: null, method: null, rolls };
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
 * A thief's Find/Remove Traps roll to disarm a found trap (PHB: one roll per
 * trap). HOUSE RULE, not PHB: a roll that fails by more than 20 springs the
 * trap (the PHB leaves a failed attempt's consequences to the DM); pass
 * `o.safe` to play it strictly by the book. Non-thieves cannot try.
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

// ------------------------------------------------------- scene-facing helpers

/**
 * Canonical key of a wall edge seen from either side, so a door picked from
 * the street is open from inside too: `${mapId}:${x},${y},${dir}` of the
 * lexically smaller of the two faces.
 */
export function edgeKey(mapId, x, y, dir) {
  const V = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const O = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const [dx, dy] = V[dir] ?? [0, 0];
  const a = `${x},${y},${dir}`;
  const b = `${x + dx},${y + dy},${O[dir] ?? dir}`;
  return `${mapId}:${a < b ? a : b}`;
}

/**
 * The persistent rules state of a LOCKED edge (game.flags.doors[key]),
 * created on first touch from `def` (default: an ordinary lock). Saved with
 * the game like every other flag.
 */
export function lockedDoorState(game, key, def = { locked: true }) {
  const doors = (game.flags ??= {}).doors ??= {};
  return (doors[key] ??= { ...def });
}

/** Has this LOCKED edge been opened (picked, forced or knocked)? */
export function isDoorOpened(game, key) {
  return !!game.flags?.doors?.[key]?.opened;
}

/** A conscious member with Knock memorized, as {ch, cls}, or null. */
export function knockCaster(party) {
  for (const ch of ableMembers(party)) {
    for (const [cls, ids] of Object.entries(ch.spells?.memorized ?? {})) if (ids?.includes('knock')) return { ch, cls };
  }
  return null;
}

/**
 * The whole locked-door interaction for the explore scene, Gold Box style:
 * the party walks into a LOCKED edge → the best thief tries the lock (once per
 * thief level per lock), then the strongest member tries to force it; if both
 * fail and someone has Knock memorized, they cast it (the slot is spent).
 * The door's state persists under `key` (see edgeKey); once opened it stays
 * open. The caller spends `minutes` with game.advanceTime and prints `text`.
 * @param {import('./dice.js').Rng} rng
 * @param {{party:object[], flags:object}} game
 * @param {string} key edgeKey(...)
 * @param {{useKnock?:boolean, door?:object}} [o] useKnock false: never spend a Knock; door: initial state
 * @returns {{opened:boolean, method:string|null, who:object|null, minutes:number, text:string, knocked?:boolean}}
 */
export function openLockedDoor(rng, game, key, o = {}) {
  const door = lockedDoorState(game, key, o.door);
  if (door.opened) return { opened: true, method: 'open', who: null, minutes: 0, text: 'The door stands open.' };
  const party = game.party ?? [];
  let r = tryOpenLock(rng, party, door);
  let minutes = r.minutes;
  if (!r.opened && o.useKnock !== false) {
    const k = knockCaster(party);
    if (k) {
      const ids = k.ch.spells.memorized[k.cls];
      ids.splice(ids.indexOf('knock'), 1);
      r = tryOpenLock(rng, party, door, { knock: true });
      minutes += 1;
      r = { ...r, who: k.ch, text: `${k.ch.name} speaks the word of opening. ${r.text}`, knocked: true };
    }
  }
  if (r.opened) door.opened = true;
  return { opened: r.opened, method: r.method, who: r.who, minutes, text: r.text, knocked: !!r.knocked };
}

/**
 * The SEARCH command at one square: each hidden door among `walls` (edges
 * not yet found) is rolled for separately with searchSecret — elves and
 * half-elves find one 2 in 6, everyone else 1 in 6, a dwarf may sense a
 * sliding wall. One search takes a turn (10 minutes) whatever is found.
 * Also the passive elven notice when merely walking past (`o.passive`: no
 * time spent, only elves/half-elves roll, 1 in 6).
 * @param {{dir:string}[]} walls hidden doors at this square
 * @returns {{found:{dir:string, by:object}[], minutes:number}}
 */
export function searchSquare(rng, party, walls, o = {}) {
  const found = [];
  for (const w of walls ?? []) {
    const r = searchSecret(rng, party, { passive: !!o.passive, sliding: !!w.sliding });
    if (r.found) found.push({ dir: w.dir, by: r.by });
  }
  return { found, minutes: o.passive ? 0 : 10 };
}

// ------------------------------------------------------------------- traps

/**
 * Trap catalogue in the 1e manner. A map event of type 'trap' names one by
 * `trap: 'poisonNeedle'` and may override any field. Fields:
 *  - who: 'lead' (the first able member: the one opening, stepping),
 *    'random' (`count` dice of random members), 'all' (the whole party)
 *  - attack: the trap rolls to hit with this THAC0 against each victim's AC
 *  - dice: damage dice; save {key, type:'half'|'neg', poison?, dodge?}
 *  - effect: a condition to add on a failed save (poisoned, paralyzed,
 *    asleep), lasting `rounds` (poison takes `onset` rounds to kill)
 *  - mod: % added to Find/Remove Traps (a cunning trap: -10)
 *  - stonework: built into stone, so dwarves and gnomes can sense it
 *  - alarm: springing it brings the guards (the scene rolls an encounter)
 */
export const TRAPS = Object.freeze({
  poisonNeedle: {
    name: 'poisoned needle', who: 'lead', dice: '1', save: { key: 'ppdm', type: 'neg', poison: true },
    effect: 'poisoned', onset: 10, text: 'A needle flicks out of the lock.',
  },
  dartVolley: {
    name: 'dart trap', who: 'random', count: '1d3', attack: 16, dice: '1d3', mod: 0, stonework: true,
    text: 'Darts hiss from holes in the wall.',
  },
  pit: {
    name: 'concealed pit', who: 'lead', dice: '1d6', save: { key: 'ppdm', type: 'neg', dodge: true }, stonework: true,
    text: 'The floor gives way beneath your feet.',
  },
  fallingBlock: {
    name: 'falling block', who: 'lead', dice: '2d6', save: { key: 'ppdm', type: 'half', dodge: true }, stonework: true,
    text: 'A block of stone drops from the ceiling.',
  },
  scythingBlade: {
    name: 'scything blade', who: 'lead', attack: 13, dice: '1d10', stonework: true,
    text: 'A blade sweeps out of a slot in the wall.',
  },
  sleepGas: {
    name: 'gas trap', who: 'all', save: { key: 'ppdm', type: 'neg' }, effect: 'asleep', rounds: '1d4x10',
    text: 'A sweet-smelling vapour fills the passage.',
  },
  fireGlyph: {
    name: 'glyph of warding', who: 'all', dice: '2d4+6', save: { key: 'sp', type: 'half' }, element: 'fire', mod: -10,
    text: 'A rune flares and the air bursts into flame.',
  },
  alarm: {
    name: 'alarm', who: 'none', alarm: true, text: 'A bell clangs somewhere in the dark.',
  },
});

/** The full trap spec: a catalogue entry merged with the event's overrides. */
export function trapSpec(trap = {}) {
  const base = typeof trap === 'string' ? TRAPS[trap] : TRAPS[trap.trap ?? trap.kind ?? trap.id] ?? {};
  return typeof trap === 'string' ? { ...base, id: trap } : { ...base, ...trap, id: trap.trap ?? trap.kind ?? trap.id };
}

const rollExpr = (rng, e) => roll(rng, e);

/**
 * Spring a trap on the party: who it reaches, attack rolls against AC, saves
 * (the stout races' CON bonus only against poison; DEX helps dodge pits and
 * falling blocks), damage through applyDamage (so 0 hp is unconscious and
 * below that the victim is dying), and conditions on a failed save.
 * `o.victim` is who set a 'lead' trap off (the thief who fumbled the
 * disarm); `o.strict1e` drops the nat-20/nat-1 rule from the trap's attack.
 * @param {{victim?:object, strict1e?:boolean}} [o]
 * @returns {{victims:{ch:object, hit:boolean, saved:boolean|null, damage:number, effect:string|null, status:string}[],
 *   alarm:boolean, text:string[]}}
 */
export function springTrap(rng, party, trap, o = {}) {
  const t = trapSpec(trap);
  const members = ableMembers(party);
  const text = [t.text ?? `The ${t.name ?? 'trap'} is sprung!`];
  let targets = [];
  if (t.who === 'all') targets = (party ?? []).filter((ch) => ch && isConscious(ch));
  else if (t.who === 'random') {
    const pool = [...members];
    for (let n = Math.max(1, rollExpr(rng, t.count ?? 1)); n > 0 && pool.length; n--) targets.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  } else if (t.who !== 'none') {
    // 'lead': whoever set it off — the thief whose fumble sprang it
    // (o.victim), else the first able member (the one stepping or opening).
    const lead = o.victim && able(o.victim) ? o.victim : members[0];
    if (lead) targets = [lead];
  }
  const victims = [];
  for (const ch of targets) {
    const v = { ch, hit: true, saved: null, damage: 0, effect: null, status: ch.status };
    if (t.attack != null) {
      // Same attack-roll rules as weapons: nat 20 hits, nat 1 misses (QoL;
      // o.strict1e drops it).
      const need = neededToHit(t.attack, deriveStats(ch).ac, 0);
      const r = rng.die(20);
      v.hit = r >= need;
      if (!o.strict1e) {
        if (r === 20) v.hit = true;
        if (r === 1) v.hit = false;
      }
      v.roll = r;
    }
    if (v.hit && t.save) {
      v.saved = rollSave(rng, ch, t.save.key, { poison: !!t.save.poison, dodge: !!t.save.dodge, element: t.element }).saved;
    }
    const negated = v.saved && t.save?.type === 'neg';
    if (v.hit && !negated && t.dice) {
      let d = rollExpr(rng, t.dice);
      if (v.saved && t.save?.type === 'half') d = Math.floor(d / 2);
      if (t.element) d = Math.floor(d * (deriveStats(ch).resist?.[t.element] ?? 1));
      v.damage = Math.max(0, d);
      if (v.damage) applyDamage(ch, v.damage);
    }
    if (v.hit && !v.saved && t.effect && isConscious(ch)) {
      if (t.effect === 'poisoned') addEffect(ch, 'poisoned', { rounds: Infinity, source: 'trap', data: { onset: t.onset ?? 10 } });
      else addEffect(ch, t.effect, { rounds: t.rounds != null ? rollExpr(rng, t.rounds) : ROUNDS_PER_TURN, source: 'trap' });
      v.effect = t.effect;
    }
    v.status = ch.status;
    const what = !v.hit ? 'is missed' : negated ? 'avoids it' : v.damage ? `takes ${v.damage}${v.effect ? ` and is ${v.effect}` : ''}` : v.effect ? `is ${v.effect}` : 'is unharmed';
    text.push(`${ch.name} ${what}.`);
    victims.push(v);
  }
  if (t.alarm) text.push('The alarm is raised.');
  return { victims, alarm: !!t.alarm, text };
}

/**
 * The whole trap interaction, Gold Box style. The party walks onto a trapped
 * square or opens a trapped chest or door: a Find Traps spell, the best
 * thief's Find/Remove Traps roll or a dwarf's stone sense may spot it
 * (detectTrap). A found trap is then disarmed by the best thief
 * (findRemoveTraps; house rule: failing by more than 20 springs it); a party with no
 * thief, or one that fails, steps around it if `o.avoidable` (a pit in a
 * corridor) or springs it. An unseen trap springs. The trap's state (found,
 * removed, sprung) is written back onto `trap` so a scene can keep it in
 * game.flags; a removed or sprung one-shot trap (no `resets`) does nothing again.
 * @param {import('./dice.js').Rng} rng
 * @param {object[]} party
 * @param {object|string} trap a TRAPS id or an event object `{trap:'pit', ...overrides}`
 * @param {{avoidable?:boolean, search?:boolean, passive?:boolean, strict1e?:boolean}} [o] search: the party is
 *   searching (a turn spent: always try to detect); passive / strict1e: see PASSIVE_TRAP_DETECTION
 * @returns {{detected:boolean, removed:boolean, sprung:boolean, avoided:boolean, by:object|null,
 *   victims:object[], alarm:boolean, minutes:number, text:string[]}}
 */
export function resolveTrap(rng, party, trap, o = {}) {
  const state = typeof trap === 'object' ? trap : {};
  const t = trapSpec(trap);
  const out = { detected: false, removed: false, sprung: false, avoided: false, by: null, victims: [], alarm: false, minutes: 0, text: [] };
  if (state.removed || (state.sprung && !t.resets)) return out;
  const det = state.found ? { found: true, by: null, method: 'known' } : detectTrap(rng, party, t, o);
  let fumbler = null;
  if (o.search) out.minutes += 10;
  if (det.found) {
    out.detected = state.found = true;
    out.by = det.by;
    if (det.by) out.text.push(det.method === 'spell' ? `${det.by.name}'s spell reveals a ${t.name}.` : det.method === 'stonework' ? `${det.by.name} spots odd stonework: a ${t.name}!` : `${det.by.name} finds a ${t.name}.`);
    const thief = ableMembers(party)
      .map((ch) => ({ ch, chance: Math.max(0, Math.min(99, (deriveStats(ch).thief?.ft ?? 0) + (t.mod ?? 0))) }))
      .filter((x) => x.chance > 0)
      .sort((a, b) => b.chance - a.chance)[0];
    if (thief) {
      const r = findRemoveTraps(rng, thief.ch, t);
      out.minutes += 1;
      out.text.push(r.text);
      if (r.removed) {
        out.removed = state.removed = true;
        out.by = thief.ch;
        return out;
      }
      if (!r.sprung && o.avoidable) {
        out.avoided = true;
        out.text.push('The party edges around it.');
        return out;
      }
      if (!r.sprung) return out; // known and still armed: try again, or leave it be
      fumbler = thief.ch; // the fumble springs it on the thief at work
    } else {
      // Known but nobody can disarm it: step around it, or leave the chest or
      // door alone (the scene may still choose to springTrap deliberately).
      out.avoided = true;
      out.text.push(o.avoidable ? 'The party edges around it.' : 'Nobody here can disarm it; the party leaves it be.');
      return out;
    }
  }
  const sp = springTrap(rng, party, t, { victim: fumbler, strict1e: o.strict1e });
  out.sprung = state.sprung = true;
  out.victims = sp.victims;
  out.alarm = sp.alarm;
  out.text.push(...sp.text);
  return out;
}

/**
 * The persistent rules state of a map trap (game.flags.traps[id]): found,
 * removed, sprung. Created on first use.
 */
export function mapTrapState(game, id) {
  const traps = (game.flags ??= {}).traps ??= {};
  return (traps[id] ??= {});
}

/**
 * A map event of type 'trap' met in exploration: the scene calls this when the
 * party steps onto the square (or, with `o.search`, searches it). The trap's
 * found/removed/sprung state lives in game.flags.traps[ev.id], so it survives
 * saves and a disarmed or sprung one-shot trap stays quiet. Text lines carry a
 * tone for the message log ('warn' when the trap goes off, 'loot' when it is
 * disarmed, 'system' otherwise).
 * @param {import('./dice.js').Rng} rng
 * @param {{party:object[], flags?:object}} game
 * @param {{id:string, trap:string, avoidable?:boolean}} ev the map event (TRAPS id + overrides)
 * @param {{search?:boolean, passive?:boolean, strict1e?:boolean}} [o]
 * @returns {ReturnType<typeof resolveTrap> & {state:object, lines:{text:string, tone:string}[], quiet:boolean}}
 */
export function triggerMapTrap(rng, game, ev, o = {}) {
  const state = mapTrapState(game, ev.id);
  const { id, type, x, y, once, chance, facing, ...overrides } = ev; // eslint-disable-line no-unused-vars
  const spec = { ...overrides, trap: ev.trap, ...state };
  const r = resolveTrap(rng, game.party ?? [], spec, { avoidable: !!ev.avoidable, search: !!o.search, passive: o.passive, strict1e: o.strict1e });
  for (const k of ['found', 'removed', 'sprung']) if (spec[k]) state[k] = true;
  const quiet = !r.text.length;
  const tone = r.sprung ? 'warn' : r.removed ? 'loot' : 'system';
  const lines = r.text.map((t) => ({ text: t, tone }));
  if (r.sprung) for (const v of r.victims) if (v.ch?.status === 'dead') lines.push({ text: `${v.ch.name} is killed!`, tone: 'warn' });
  return { ...r, state, lines, quiet };
}
