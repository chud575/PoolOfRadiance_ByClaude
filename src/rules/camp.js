import { deriveStats, activeClasses, isAlive, heal, bandage } from './character.js';
import { intelligenceTable } from './abilities.js';
import { spellsForClass, SPELL_RULES, spellLevel } from './spells.js';
import { tickEffects, hasEffect, CONDITIONS, conditionIds } from './conditions.js';
import { maxSpellLevel } from './classes.js';

/**
 * Encamp: memorization, resting, natural healing and time passing.
 *
 * Spell memory model (per casting class):
 *   ch.spells.prepared[cls]  – the chosen load-out (what the caster re-learns on each rest)
 *   ch.spells.memorized[cls] – what is still in memory right now (cast = removed)
 *   ch.spells.book           – magic-user spell book (clerics know every spell of their levels)
 *   ch.spells.study          – minutes of memorization already done toward the current load-out
 *
 * 1e timing: before memorizing, a caster must rest 4 hours (1st-2nd level
 * spells), 6 hours (3rd-4th) or 8 hours (5th+), then spend 15 minutes per
 * spell level being memorized.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Spells a character can choose to memorize for a class. */
export function knownSpells(ch, cls) {
  const lvl = ch.levels?.[cls] ?? 0;
  if (!lvl) return [];
  const max = maxSpellLevel(cls, lvl);
  const out = [];
  for (let l = 1; l <= max; l++) {
    const pool = spellsForClass(cls, l);
    out.push(...(cls === 'magicUser' ? pool.filter((id) => ch.spells?.book?.includes(id)) : pool));
  }
  return out;
}

/** Slots per spell level for a class including wisdom bonus: number[] (index = level-1). */
export function slotsFor(ch, cls) {
  return deriveStats(ch).spellSlots[cls] ?? [];
}

/**
 * Validate a proposed load-out for a class.
 * @returns {string[]} problems (empty = OK)
 */
export function checkLoadout(ch, cls, ids) {
  const slots = slotsFor(ch, cls);
  const known = new Set(knownSpells(ch, cls));
  const used = [];
  const out = [];
  for (const id of ids) {
    if (!SPELL_RULES[id]) { out.push(`unknown spell ${id}`); continue; }
    if (!known.has(id)) { out.push(`${SPELL_RULES[id].name} is not known`); continue; }
    const l = spellLevel(id, cls);
    used[l - 1] = (used[l - 1] ?? 0) + 1;
  }
  used.forEach((n, i) => { if (n > (slots[i] ?? 0)) out.push(`too many level ${i + 1} spells (${n}/${slots[i] ?? 0})`); });
  return out;
}

/** Remaining free slots per level for a load-out. */
export function freeSlots(ch, cls, ids = ch.spells?.prepared?.[cls] ?? []) {
  const slots = [...slotsFor(ch, cls)];
  for (const id of ids) {
    const l = spellLevel(id, cls);
    if (slots[l - 1] !== undefined) slots[l - 1]--;
  }
  return slots;
}

/**
 * Choose the spells to memorize (the load-out). Invalid entries throw.
 * Memorization happens when the party rests long enough (see rest()).
 */
export function prepareSpells(ch, cls, ids) {
  const p = checkLoadout(ch, cls, ids);
  if (p.length) throw new Error(p.join('; '));
  ch.spells ??= { memorized: {}, book: [] };
  ch.spells.prepared ??= {};
  ch.spells.prepared[cls] = [...ids];
  ch.spells.memorized ??= {};
  ch.spells.memorized[cls] ??= [];
  ch.spells.study = 0;
  return ch.spells.prepared[cls];
}

/** Spells in the load-out that are not currently in memory (what a rest will restore). */
export function spellsToMemorize(ch) {
  const out = {};
  for (const [cls, prepared] of Object.entries(ch.spells?.prepared ?? {})) {
    const have = [...(ch.spells.memorized?.[cls] ?? [])];
    const need = [];
    for (const id of prepared) {
      const i = have.indexOf(id);
      if (i >= 0) have.splice(i, 1);
      else need.push(id);
    }
    if (need.length) out[cls] = need;
  }
  return out;
}

/** 1e rest before memorizing (minutes) for a highest spell level. */
export function restBeforeMemorizing(highestLevel) {
  if (highestLevel <= 0) return 0;
  if (highestLevel <= 2) return 240;
  if (highestLevel <= 4) return 360;
  if (highestLevel <= 6) return 480;
  return 600;
}

/** Minutes of rest a character needs to memorize everything missing from their load-out. */
export function memorizationTime(ch) {
  const need = spellsToMemorize(ch);
  let highest = 0;
  let levels = 0;
  for (const [cls, ids] of Object.entries(need)) {
    for (const id of ids) {
      const l = spellLevel(id, cls);
      highest = Math.max(highest, l);
      levels += l;
    }
  }
  if (!levels) return 0;
  return restBeforeMemorizing(highest) + 15 * levels;
}

/** Longest memorization time in the party (the rest the party must take). */
export function partyMemorizationTime(party) {
  return Math.max(0, ...party.filter((c) => c.status === 'ok').map(memorizationTime));
}

/**
 * Fill empty load-outs with sensible defaults (QoL for quick-start parties):
 * clerics favour healing and bless, magic-users their best attack spells.
 */
export function autoPrepare(ch) {
  const PREF = {
    cleric: ['cureLightWounds', 'bless', 'protectionFromEvil', 'cureLightWounds', 'holdPerson', 'silence15', 'spiritualHammer', 'resistFire', 'prayer', 'dispelMagic', 'removeCurse'],
    magicUser: ['sleep', 'magicMissile', 'shield', 'charmPerson', 'burningHands', 'shockingGrasp', 'stinkingCloud', 'mirrorImage', 'invisibility', 'rayOfEnfeeblement', 'fireball', 'lightningBolt', 'haste', 'holdPerson', 'slow'],
  };
  for (const cls of activeClasses(ch).filter((c) => c === 'cleric' || c === 'magicUser')) {
    if (ch.spells?.prepared?.[cls]?.length) continue;
    const known = knownSpells(ch, cls);
    const slots = slotsFor(ch, cls);
    const pick = [];
    slots.forEach((n, i) => {
      const pool = PREF[cls].filter((id) => known.includes(id) && spellLevel(id, cls) === i + 1);
      const any = known.filter((id) => spellLevel(id, cls) === i + 1 && SPELL_RULES[id].usable !== 'camp');
      const src = pool.length ? pool : any;
      for (let k = 0; k < n && src.length; k++) pick.push(src[k % src.length]);
    });
    prepareSpells(ch, cls, pick);
  }
  return ch.spells?.prepared ?? {};
}

/**
 * Rest the party for `minutes` (uninterrupted). Advances timed effects,
 * natural healing (1e: 1 hp per full day of rest; `healPerDay` option) and
 * memorization. Dying members are bandaged first (the party tends them).
 *
 * @param {import('./character.js').Character[]} party
 * @param {number} minutes
 * @param {{healPerDay?:number, rng?:import('./dice.js').Rng}} [o]
 * @returns {{minutes:number, healed:Record<string,number>, memorized:Record<string,string[]>, expired:Record<string,string[]>, died:string[]}}
 */
export function rest(party, minutes, o = {}) {
  const healPerDay = o.healPerDay ?? 1;
  const report = { minutes, healed: {}, memorized: {}, expired: {}, died: [] };
  for (const ch of party) {
    if (!isAlive(ch)) continue;
    if (ch.status === 'dying') bandage(ch);
    // Effects run their course (rounds = minutes).
    const exp = tickEffects(ch, minutes);
    if (exp.length) report.expired[ch.id] = exp;
    // Poison: fatal unless slowed (1e); the camp surfaces this as a death.
    if (hasEffect(ch, 'poisoned') && !hasEffect(ch, 'slowPoison')) {
      ch.status = 'dead';
      report.died.push(ch.id);
      continue;
    }
    // Natural healing, per complete day rested.
    ch.restMinutes = (ch.restMinutes ?? 0) + minutes;
    const days = Math.floor(ch.restMinutes / MINUTES_PER_DAY);
    if (days > 0) {
      ch.restMinutes -= days * MINUTES_PER_DAY;
      const noHeal = conditionIds(ch).some((id) => CONDITIONS[id]?.noNaturalHealing);
      if (!noHeal) {
        const n = heal(ch, days * healPerDay);
        if (n) report.healed[ch.id] = n;
      }
    }
    // Memorization (only conscious casters study).
    if (ch.status !== 'ok') continue;
    const need = memorizationTime(ch);
    if (!need) continue;
    ch.spells.study = (ch.spells.study ?? 0) + minutes;
    if (ch.spells.study >= need) {
      const learned = spellsToMemorize(ch);
      for (const [cls, ids] of Object.entries(learned)) {
        ch.spells.memorized[cls] = [...(ch.spells.memorized[cls] ?? []), ...ids];
      }
      ch.spells.study = 0;
      report.memorized[ch.id] = Object.values(learned).flat();
    }
  }
  return report;
}

/**
 * Rest "until healed" helper: minutes needed for the whole party to reach full
 * hp at the natural rate (capped at 30 days), and at least the memorization time.
 */
export function restUntilHealedMinutes(party, { healPerDay = 1, maxDays = 30 } = {}) {
  let days = 0;
  for (const ch of party) {
    if (!isAlive(ch)) continue;
    days = Math.max(days, Math.ceil(Math.max(0, ch.hp.max - ch.hp.cur) / healPerDay));
  }
  return Math.max(partyMemorizationTime(party), Math.min(maxDays, days) * MINUTES_PER_DAY);
}

/** Chance per hour of a wandering encounter interrupting rest (scene rolls). */
export function restInterrupted(rng, hours, pctPerHour = 5) {
  for (let h = 0; h < hours; h++) if (rng.chance(pctPerHour)) return h;
  return -1;
}

/**
 * Magic-user learning a spell (scroll scribing / level training). PoR rule: a
 * magic-user can scribe any spell of a level they can cast; the optional 1e
 * rule (`chanceToKnow: true`) rolls INT "chance to know".
 * @returns {{ok:boolean, reason?:string, roll?:number}}
 */
export function learnSpell(ch, id, { rng, chanceToKnow = false } = {}) {
  const lvl = ch.levels?.magicUser ?? 0;
  const s = SPELL_RULES[id];
  if (!lvl) return { ok: false, reason: 'not a magic-user' };
  if (!s || s.schools.magicUser === undefined) return { ok: false, reason: 'not a magic-user spell' };
  if (ch.spells.book.includes(id)) return { ok: false, reason: 'already known' };
  const sl = s.schools.magicUser;
  if (sl > maxSpellLevel('magicUser', lvl)) return { ok: false, reason: 'too high level' };
  const int = intelligenceTable(ch.abilities.int);
  if (sl > int.maxSpellLevel) return { ok: false, reason: 'intelligence too low' };
  if (chanceToKnow && rng) {
    const r = rng.int(1, 100);
    if (r > int.knowChance) return { ok: false, reason: 'failed to understand', roll: r };
  }
  ch.spells.book.push(id);
  return { ok: true };
}
