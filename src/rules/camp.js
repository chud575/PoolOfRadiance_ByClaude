import { deriveStats, activeClasses, isAlive, heal, bandage } from './character.js';
import { intelligenceTable } from './abilities.js';
import { spellsForClass, SPELL_RULES, spellLevel } from './spells.js';
import { tickEffects, tickPoison, CONDITIONS, conditionIds } from './conditions.js';
import { maxSpellLevel } from './classes.js';

/**
 * Encamp: memorization, resting, natural healing and time passing.
 *
 * Spell memory model (per casting class):
 *   ch.spells.prepared[cls]  – the chosen load-out (what the caster re-learns on each rest)
 *   ch.spells.memorized[cls] – what is still in memory right now (cast = removed)
 *   ch.spells.book           – magic-user spell book (clerics know every spell of their levels)
 *   ch.spells.study          – minutes of rest/study banked toward what is still missing
 *
 * 1e timing: before memorizing, a caster must rest 4 hours (1st-2nd level
 * spells), 6 hours (3rd-4th) or 8 hours (5th+), then spend 15 minutes per
 * spell level being memorized. Spells come back one at a time, in load-out
 * order, so an interrupted rest still restores the spells already studied.
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

/** Minutes of rest a character still needs to memorize everything missing from their load-out (net of banked study). */
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
  return Math.max(0, restBeforeMemorizing(highest) + 15 * levels - (ch.spells?.study ?? 0));
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
    // Poison works on while the party rests, exactly as in combat and on the
    // road (conditions.tickPoison): onset counts down except under Slow Poison.
    if (tickPoison(ch, minutes).lethal) {
      ch.status = 'dead';
      ch.hp.cur = Math.min(ch.hp.cur, -10);
      report.died.push(ch.id);
      continue;
    }
    // Effects run their course (rounds = minutes).
    const exp = tickEffects(ch, minutes);
    if (exp.length) report.expired[ch.id] = exp;
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
    const learned = study(ch, minutes);
    if (learned.length) report.memorized[ch.id] = learned;
  }
  markTime(party, minutes);
  return report;
}

/**
 * Exploration / travel / dialogue time: `minutes` pass without rest. Timed
 * effects run down (Bless, Strength 1 h/level, Detect Magic, Find Traps,
 * Prot. from Evil... expire while walking — rounds = minutes) and poison
 * onset counts down exactly as in combat and rest (Slow Poison holds it).
 * Out of combat the party binds its dying (as rest() does — forgiving QoL:
 * nobody bleeds out on the walk home). No natural healing, no memorization
 * (that is rest()).
 * @param {import('./character.js').Character[]} party
 * @param {number} minutes
 * @returns {{minutes:number, expired:Record<string,string[]>, died:string[], bandaged:string[]}}
 */
export function passTime(party, minutes) {
  const report = { minutes, expired: {}, died: [], bandaged: [] };
  if (!(minutes > 0)) return report;
  for (const ch of party) {
    if (!isAlive(ch)) continue;
    if (tickPoison(ch, minutes).lethal) {
      ch.status = 'dead';
      ch.hp.cur = Math.min(ch.hp.cur, -10);
      report.died.push(ch.id);
      continue;
    }
    if (ch.status === 'dying' && bandage(ch)) report.bandaged.push(ch.id);
    const exp = tickEffects(ch, minutes);
    if (exp.length) report.expired[ch.id] = exp;
  }
  markTime(party, minutes);
  return report;
}

/** Advance each member's `timeMark` (game minute their effects are current to) after rest/passTime. */
function markTime(party, minutes) {
  for (const ch of party) if (typeof ch.timeMark === 'number') ch.timeMark += minutes;
}

/**
 * Idempotent clock sync — the one call a scene needs: bring every party
 * member's effects up to the game clock (`game.minutes`). Each Character
 * remembers `timeMark`, the minute it was last brought current; the gap is
 * passed with passTime(). rest() and passTime() advance the marks
 * themselves, so a camp that rests 8 h and then advances the game clock by
 * 8 h does not tick twice. The first call only sets the mark.
 * Consumers: call `syncPartyTime(game.party, game.minutes)` after every
 * GameState.advanceTime (explore steps, searching, dialogue, shops, travel).
 * @returns {ReturnType<typeof passTime>|null}
 */
export function syncPartyTime(party, now) {
  const gaps = party.filter((ch) => typeof ch.timeMark === 'number').map((ch) => now - ch.timeMark);
  for (const ch of party) if (typeof ch.timeMark !== 'number') ch.timeMark = now;
  const gap = gaps.length ? Math.max(...gaps) : 0;
  if (gap <= 0) {
    for (const ch of party) ch.timeMark = Math.max(ch.timeMark, now);
    return null;
  }
  // Members may lag by different amounts (joined later): tick each by its own gap.
  const report = { minutes: gap, expired: {}, died: [], bandaged: [] };
  for (const ch of party) {
    const d = now - ch.timeMark;
    if (d <= 0) continue;
    const r = passTime([ch], d);
    Object.assign(report.expired, r.expired);
    report.died.push(...r.died);
    report.bandaged.push(...r.bandaged);
    ch.timeMark = now;
  }
  return report;
}

/**
 * Wire the game clock to the party's timed effects — the one line main.js
 * needs: `attachTimeSync(bus, game)`. Every 'time:changed' (each explore
 * step, search, dialogue, shop visit, travel, rest) calls
 * syncPartyTime(game.party, game.minutes), so Bless and Strength run out
 * while walking and poison kills on the road, not only at the next rest.
 * When anything changed it emits 'party:time' with the passTime report
 * ({minutes, expired, died, bandaged}) and 'party:changed' so the roster
 * refreshes. Returns an unsubscribe function.
 * @param {{on:Function, emit:Function, off?:Function}} bus
 * @param {{party:object[], minutes:number}} game
 */
export function attachTimeSync(bus, game) {
  const handler = () => {
    const r = syncPartyTime(game.party ?? [], game.minutes);
    if (r && (r.died.length || r.bandaged.length || Object.keys(r.expired).length)) {
      bus.emit('party:time', r);
      bus.emit('party:changed', { party: game.party });
    }
  };
  // Prime the marks so the first step after a load does not tick from 0.
  syncPartyTime(game.party ?? [], game.minutes);
  const off = bus.on('time:changed', handler);
  return typeof off === 'function' ? off : () => bus.off?.('time:changed', handler);
}

/**
 * Advance one caster's memorization by `minutes` of rest. After the 1e rest
 * period (set by the highest missing spell level), each spell takes 15
 * minutes per spell level and is memorized as soon as its own study is done.
 * Leftover study is banked in ch.spells.study. Returns the ids learned.
 */
export function study(ch, minutes) {
  const need = spellsToMemorize(ch);
  const queue = [];
  for (const [cls, ids] of Object.entries(need)) for (const id of ids) queue.push({ cls, id, lvl: spellLevel(id, cls) });
  if (!queue.length) {
    if (ch.spells) ch.spells.study = 0;
    return [];
  }
  const restFirst = restBeforeMemorizing(Math.max(...queue.map((q) => q.lvl)));
  let banked = (ch.spells.study ?? 0) + minutes;
  if (banked < restFirst) {
    ch.spells.study = banked;
    return [];
  }
  let progress = banked - restFirst;
  const learned = [];
  for (const q of queue) {
    const cost = 15 * q.lvl;
    if (progress < cost) break;
    progress -= cost;
    ch.spells.memorized[q.cls] = [...(ch.spells.memorized[q.cls] ?? []), q.id];
    learned.push(q.id);
  }
  banked = learned.length === queue.length ? 0 : restFirst + progress;
  ch.spells.study = banked;
  return learned;
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
  // PHB: INT caps how many spells of each level a spell book may hold.
  const sameLevel = ch.spells.book.filter((b) => SPELL_RULES[b]?.schools.magicUser === sl).length;
  if (sameLevel >= int.maxSpells) return { ok: false, reason: `no room for more level ${sl} spells (INT ${ch.abilities.int}: ${int.maxSpells} max)` };
  if (chanceToKnow && rng) {
    const r = rng.int(1, 100);
    if (r > int.knowChance) return { ok: false, reason: 'failed to understand', roll: r };
  }
  ch.spells.book.push(id);
  return { ok: true };
}

/**
 * After a level is lost (energy drain): forget memorized spells beyond the
 * slots the character still has (highest spell levels go first). Also trims
 * the prepared load-out. Returns the ids forgotten.
 */
export function trimMemorized(ch) {
  const lost = [];
  for (const key of ['memorized', 'prepared']) {
    for (const [cls, ids] of Object.entries(ch.spells?.[key] ?? {})) {
      if (!Array.isArray(ids)) continue;
      const slots = slotsFor(ch, cls);
      const used = [];
      const keep = [];
      // Keep low-level spells first.
      const order = ids.map((id, i) => ({ id, i, l: spellLevel(id, cls) })).sort((a, b) => a.l - b.l || a.i - b.i);
      for (const o of order) {
        if ((used[o.l - 1] ?? 0) < (slots[o.l - 1] ?? 0)) { used[o.l - 1] = (used[o.l - 1] ?? 0) + 1; keep.push(o); } else if (key === 'memorized') lost.push(o.id);
      }
      ch.spells[key][cls] = keep.sort((a, b) => a.i - b.i).map((o) => o.id);
    }
  }
  return lost;
}

/**
 * Pool of Radiance training rule: each time a magic-user trains a level the
 * hall lets them add one new spell to the book. Returns the spell ids they may
 * choose (every magic-user spell of a level they can now cast that learnSpell
 * would accept — INT max level and max spells per level honoured), lowest
 * level first. Call after trainLevels() raised 'magicUser', then learnSpell()
 * the pick.
 */
export function trainingSpellChoices(ch) {
  const lvl = ch.levels?.magicUser ?? 0;
  if (!lvl || !ch.spells) return [];
  const int = intelligenceTable(ch.abilities.int);
  const out = [];
  for (let l = 1; l <= Math.min(maxSpellLevel('magicUser', lvl), int.maxSpellLevel); l++) {
    const inBook = ch.spells.book.filter((b) => SPELL_RULES[b]?.schools.magicUser === l).length;
    if (inBook >= int.maxSpells) continue;
    for (const id of spellsForClass('magicUser', l)) if (!ch.spells.book.includes(id)) out.push(id);
  }
  return out;
}
