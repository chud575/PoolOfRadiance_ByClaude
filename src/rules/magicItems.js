import { roll } from './dice.js';
import { ITEMS } from '../data/items.js';
import { splitClasses } from './classes.js';
import { castSpell, SPELL_RULES } from './spells.js';
import { learnSpell } from './camp.js';
import { heal, removeItem } from './character.js';
import { addEffect, removeEffect } from './conditions.js';
import { characterOf, nameOf, healCreature, effectHost } from './creature.js';
import { itemName, isMagical } from './items.js';

/**
 * Using magic items: potions, scrolls, wands, and identification.
 *
 * Effect strings (ItemDef.effect):
 *   'heal:<dice>'               restore hit points
 *   '<spellId>'                 cast that spell (wands, scrolls, many potions)
 *   'giantStrength:<str>'       set STR to a giant's (19-25) for 1 turn×... (potions)
 *   'speed'                     haste (potion of speed)
 *   'neutralize'                cure poison
 * Scroll entries may carry `spells: string[]` (generated treasure); the def's
 * `effect` is used otherwise.
 */

/** Default caster level for item-released spells (1e: wands 6th, scrolls 6th or min). */
export const ITEM_CASTER_LEVEL = 6;

/**
 * Who can read a scroll: magic-user scrolls need a magic-user (and read magic
 * to be scribed), cleric scrolls a cleric; thieves of 10th level may try MU scrolls.
 */
export function canUseScroll(ch, spellId) {
  const s = SPELL_RULES[spellId];
  if (!s) return false;
  const cls = splitClasses(ch.classSpec);
  if (s.schools.magicUser !== undefined && (cls.includes('magicUser') || (ch.levels.thief ?? 0) >= 10)) return true;
  if (s.schools.cleric !== undefined && cls.includes('cleric')) return true;
  return false;
}

/**
 * Use inventory[index] of `ch` on `targets` (defaults to the user).
 * Consumes potions/scroll spells, spends wand charges.
 * @param {import('./dice.js').Rng} rng
 * @param {import('./character.js').Character} ch
 * @param {number} index
 * @param {object[]} [targets]
 * @param {{spellId?:string, context?:'combat'|'camp'}} [o] which scroll spell to read
 * @returns {{ok:boolean, reason?:string, log:string[], cast?:import('./spells.js').CastResult, consumed:boolean}}
 */
export function useItem(rng, ch, index, targets, o = {}) {
  const entry = ch.inventory[index];
  const def = entry && ITEMS[entry.id];
  const out = { ok: false, log: [], consumed: false };
  if (!def) return { ...out, reason: 'no such item' };
  const tgts = targets?.length ? targets : [ch];
  const name = itemName(entry);

  if (def.type === 'wand' || def.type === 'staff' || def.type === 'rod') {
    if (!(entry.charges > 0)) return { ...out, reason: 'no charges' };
    if (def.classes && !splitClasses(ch.classSpec).some((c) => def.classes.includes(c))) return { ...out, reason: 'class cannot use' };
    const cast = castSpell(rng, def.effect, ch, tgts, { fromItem: true, level: def.casterLevel ?? ITEM_CASTER_LEVEL, check: false });
    entry.charges--;
    entry.identified = true;
    return { ok: cast.ok, log: [`${ch.name} uses the ${name}.`, ...cast.log.slice(1)], cast, consumed: false };
  }

  if (def.type === 'scroll') {
    const spells = entry.spells ?? (def.effect ? [def.effect] : []);
    const spellId = o.spellId ?? spells[0];
    if (!spellId || !spells.includes(spellId)) return { ...out, reason: 'scroll is blank' };
    if (!canUseScroll(ch, spellId)) return { ...out, reason: 'cannot read this scroll' };
    const cast = castSpell(rng, spellId, ch, tgts, { fromItem: true, level: Math.max(ITEM_CASTER_LEVEL, SPELL_RULES[spellId].level * 2 - 1), check: false });
    consumeScrollSpell(ch, index, spellId);
    return { ok: cast.ok, log: [`${ch.name} reads the ${name}.`, ...cast.log.slice(1)], cast, consumed: true };
  }

  if (def.type === 'potion') {
    const t = tgts[0];
    const log = [`${nameOf(t)} quaffs the ${name}.`];
    applyPotion(rng, def.effect ?? '', t, log);
    removeItem(ch, index, 1);
    return { ok: true, log, consumed: true };
  }
  return { ...out, reason: 'cannot be used' };
}

function applyPotion(rng, effect, t, log) {
  const [kind, arg] = effect.split(':');
  const host = effectHost(t);
  if (kind === 'heal') {
    const n = healCreature(t, roll(rng, arg));
    log.push(`${nameOf(t)} is healed ${n} hit points.`);
  } else if (kind === 'giantStrength') {
    const str = Number(arg) || 21;
    addEffect(host, 'giantStrength', { rounds: 60, source: 'potion', mods: { strSet: { str, strPct: 0 } } });
    log.push(`${nameOf(t)} feels the might of giants.`);
  } else if (kind === 'speed') {
    addEffect(host, 'hasted', { rounds: 50, source: 'potion' });
    log.push(`${nameOf(t)} blurs with speed.`);
  } else if (kind === 'neutralize') {
    removeEffect(host, 'poisoned');
    log.push(`The poison in ${nameOf(t)}'s blood is neutralized.`);
  } else if (SPELL_RULES[kind]) {
    const r = castSpell(rng, kind, t, [t], { fromItem: true, level: ITEM_CASTER_LEVEL, check: false });
    log.push(...r.log.slice(1));
  } else if (kind === 'fullHeal') {
    const ch = characterOf(t);
    if (ch) heal(ch, ch.hp.max);
    log.push(`${nameOf(t)} is restored.`);
  } else {
    log.push('Nothing seems to happen.');
  }
}

function consumeScrollSpell(ch, index, spellId) {
  const entry = ch.inventory[index];
  if (entry.spells && entry.spells.length > 1) {
    entry.spells.splice(entry.spells.indexOf(spellId), 1);
  } else {
    removeItem(ch, index, 1);
  }
}

/**
 * Scribe a magic-user scroll spell into the spell book (PoR: requires the
 * scroll to be read with Read Magic first — pass `readMagic: true` when the
 * caster has it active or memorized). The scroll spell is used up.
 * @returns {{ok:boolean, reason?:string}}
 */
export function scribeScroll(ch, index, spellId, { readMagic = true, rng, chanceToKnow = false } = {}) {
  const entry = ch.inventory[index];
  const def = entry && ITEMS[entry.id];
  if (!def || def.type !== 'scroll') return { ok: false, reason: 'not a scroll' };
  const spells = entry.spells ?? (def.effect ? [def.effect] : []);
  if (!spells.includes(spellId)) return { ok: false, reason: 'not on this scroll' };
  if (!readMagic) return { ok: false, reason: 'needs read magic' };
  const r = learnSpell(ch, spellId, { rng, chanceToKnow });
  if (!r.ok) return r;
  consumeScrollSpell(ch, index, spellId);
  return { ok: true };
}

/** Identify an item (temple/shop service, or detect magic reveals magic only). */
export function identifyItem(entry) {
  entry.identified = true;
  return itemName(entry);
}

/** Which inventory indices glow under detect magic. */
export function detectMagicIn(ch) {
  return ch.inventory.map((e, i) => (isMagical(e) ? i : -1)).filter((i) => i >= 0);
}
