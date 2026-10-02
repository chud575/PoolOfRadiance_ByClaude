import { addItem, awardXp, heal, isAlive, removeItem, deriveStats } from '../../rules/character.js';

const THIEF_SKILLS = ['pp', 'ol', 'ft', 'ms', 'hs', 'hn', 'cw'];
import { roll } from '../../rules/dice.js';
import { ITEMS } from '../../data/items.js';
import { QUESTS } from '../../data/quests.js';
import { getJournalEntry } from '../../data/journal.js';

/**
 * Game-state effects and conditions used by scripted events (data/dialogue.js).
 * Pure functions over ctx.game + ctx.rng; messages go to the log via ctx.ui.
 */

export const living = (game) => game.party.filter((c) => isAlive(c) && c.status !== 'gone');
export const partyGold = (game) => game.party.reduce((t, c) => t + (c.gold ?? 0), 0);

/** Take gold from the party, richest first. Returns false (and takes nothing) if short. */
export function spendGold(game, amount) {
  if (partyGold(game) < amount) return false;
  let left = amount;
  for (const c of [...game.party].sort((a, b) => b.gold - a.gold)) {
    const t = Math.min(c.gold, left);
    c.gold -= t;
    left -= t;
    if (!left) break;
  }
  return true;
}

export function journalList(game) {
  return (game.flags.journal ??= []);
}

/** Add a journal entry; returns true if it was new. */
export function addJournal(game, n) {
  const list = journalList(game);
  if (list.includes(n) || !getJournalEntry(n)) return false;
  list.push(n);
  (game.flags.journalUnread ??= []).push(n);
  return true;
}

export function hasItem(game, id) {
  return game.party.some((c) => c.inventory.some((e) => e.id === id));
}

/** Evaluate a condition object (see data/dialogue.js). */
export function test(game, cond) {
  if (!cond) return true;
  if (cond.any) return cond.any.some((c) => test(game, c));
  if (cond.all) return cond.all.every((c) => test(game, c));
  if (cond.flag && !game.flags[cond.flag]) return false;
  if (cond.notFlag && game.flags[cond.notFlag]) return false;
  if (cond.item && !hasItem(game, cond.item)) return false;
  if (cond.noItem && hasItem(game, cond.noItem)) return false;
  if (cond.gold && partyGold(game) < cond.gold) return false;
  if (cond.quest && (game.flags.quests?.[cond.quest] ?? 'none') !== cond.is) return false;
  if (cond.class && !game.party.some((c) => c.classSpec.includes(cond.class))) return false;
  return true;
}

/**
 * Apply a list of effects. Returns log lines (also posted to the message log).
 * @param {import('../../core/context.js').GameContext} ctx
 */
export function apply(ctx, effects) {
  const { game, ui, rng } = ctx;
  const out = [];
  const say = (t, kind = 'info') => {
    out.push(t);
    ui.message(t, kind);
  };
  for (const ef of effects ?? []) {
    if (ef.once) {
      const k = `once_${ef.once}`;
      if (game.flags[k]) continue;
      game.flags[k] = true;
    }
    if (ef.flag) game.flags[ef.flag] = true;
    if (ef.unflag) delete game.flags[ef.unflag];
    if (ef.gold) {
      if (ef.gold > 0) {
        const who = game.activeCharacter && isAlive(game.activeCharacter) ? game.activeCharacter : living(game)[0];
        if (who) {
          who.gold += ef.gold;
          say(`The party gains ${ef.gold} gold pieces.`, 'loot');
          ctx.audio?.sfx?.('coins');
        }
      } else spendGold(game, -ef.gold);
    }
    if (ef.xp) {
      for (const c of living(game)) awardXp(c, ef.xp);
      say(`Each member of the party gains ${ef.xp} experience points.`, 'loot');
    }
    if (ef.item && ITEMS[ef.item]) {
      const who = game.activeCharacter && isAlive(game.activeCharacter) ? game.activeCharacter : living(game)[0];
      if (who) {
        addItem(who, ef.item);
        say(`${who.name} takes the ${ITEMS[ef.item].name}.`, 'loot');
      }
    }
    if (ef.take) {
      for (const c of game.party) {
        const i = c.inventory.findIndex((e) => e.id === ef.take);
        if (i >= 0) {
          removeItem(c, i);
          break;
        }
      }
    }
    if (ef.quest) (game.flags.quests ??= {})[ef.quest] = ef.set ?? 'active';
    if (ef.heal) {
      for (const c of living(game)) heal(c, c.hp.max);
      say('The party\'s wounds are healed.', 'info');
    }
    if (ef.damage) {
      for (const c of living(game)) {
        const n = roll(rng, ef.damage);
        c.hp.cur = Math.max(1, c.hp.cur - n);
      }
      say('A deathly cold washes over the party.', 'warn');
    }
    if (ef.time) game.advanceTime(ef.time);
    if (ef.journal && addJournal(game, ef.journal)) say(`Journal entry ${ef.journal} recorded.`, 'lore');
  }
  if (effects?.length) game.notifyPartyChanged();
  return out;
}

/** Council reports: pay every completed commission. Returns [{quest, gold, xp}]. */
export function payRewards(ctx) {
  const { game } = ctx;
  const paid = [];
  const qs = (game.flags.quests ??= {});
  for (const q of Object.values(QUESTS)) {
    const st = qs[q.id];
    if ((st === 'active' || st === 'done') && game.flags[q.doneFlag]) {
      qs[q.id] = 'rewarded';
      apply(ctx, [{ gold: q.reward.gold }, { xp: q.reward.xp }]);
      if (q.id === 'mendor_history') apply(ctx, [{ take: 'mendorHistory' }]);
      if (q.id === 'cadorna_box') apply(ctx, [{ take: 'cadornaStrongbox' }]);
      paid.push({ quest: q, gold: q.reward.gold, xp: q.reward.xp });
    }
  }
  return paid;
}

/** Best party score for a Gold Box style check: d20 ≤ stat, or d100 ≤ thief skill (open locks / move silently). */
export function check(ctx, stat, bonus = 0) {
  const { game, rng } = ctx;
  const members = living(game);
  if (!members.length) return { ok: false, who: null };
  // Thief skills come from the rules (PHB table by level, race and DEX, armour): 'ol' open locks,
  // 'ms' move silently, 'hs', 'ft', 'pp', 'hn', 'cw'; plain 'thief' means open locks. Best thief tries.
  const skill = stat === 'thief' ? 'ol' : THIEF_SKILLS.includes(stat) ? stat : null;
  if (skill) {
    const thieves = members.map((c) => ({ c, pct: deriveStats(c).thief?.[skill] ?? 0 })).filter((t) => t.pct > 0).sort((x, y) => y.pct - x.pct);
    if (!thieves.length) return { ok: false, who: null, reason: 'no thief' };
    const { c: who, pct } = thieves[0];
    const chance = Math.max(1, Math.min(99, pct + bonus));
    return { ok: rng.int(1, 100) <= chance, who, chance };
  }
  const who = members.reduce((b, c) => ((c.abilities[stat] ?? 0) > (b.abilities[stat] ?? 0) ? c : b), members[0]);
  const score = (who.abilities[stat] ?? 10) + bonus;
  return { ok: rng.int(1, 20) <= score, who };
}
