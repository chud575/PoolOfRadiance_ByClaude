import { roll } from './dice.js';
import { ITEMS } from '../data/items.js';
import { splitClasses } from './classes.js';
import { castSpell, SPELL_RULES } from './spells.js';
import { learnSpell } from './camp.js';
import { heal, removeItem } from './character.js';
import { addEffect, removeEffect, getEffect } from './conditions.js';
import { characterOf, nameOf, healCreature, effectHost } from './creature.js';
import { itemName, isMagical, itemRulesOf } from './items.js';

/**
 * Using magic items: potions, scrolls, wands, and identification.
 *
 * Effect strings (ItemDef.effect, after ITEM_RULES overrides — itemRulesOf):
 *   'heal:<dice>'               restore hit points
 *   '<spellId>'                 cast that spell (wands, scrolls, many potions)
 *   'giantStrength:<str>'       set STR to a giant's (19-25) for 6 turns — fighters only (DMG 'F')
 *   'heroism'                   temporary fighter levels + hit dice — fighters only (DMG 'F')
 *   'speed'                     haste (potion of speed)
 *   'neutralize'                cure poison
 *   'necklaceMissiles'          throw the largest remaining fireball bead (entry.charges beads left)
 * Wands, staves and rods release their spell with the save vs Rod/Staff/Wand
 * ('rsw', DMG) and never fail; the Wand of Paralyzation is its own cone
 * ('wandParalyzation': any creature, no WIS adjustment, no target-count penalty).
 * Scroll entries may carry `spells: string[]` (generated treasure); the def's
 * `effect` is used otherwise.
 */

/** Default caster level for item-released spells (1e: wands 6th, scrolls 6th or min). */
export const ITEM_CASTER_LEVEL = 6;

/**
 * Caster level of a spell released by an item: wands/staves/rods use their
 * `casterLevel` (default ITEM_CASTER_LEVEL, 6th); scrolls cast at the
 * higher of 6th level and the lowest level able to cast the spell (2L-1).
 * Combat (battleItemUse) and camp (useItem) both read it from here.
 */
export function itemCasterLevel(def, spellId) {
  if (!def) return ITEM_CASTER_LEVEL;
  if (def.type === 'scroll') return Math.max(def.casterLevel ?? ITEM_CASTER_LEVEL, (SPELL_RULES[spellId]?.level ?? 1) * 2 - 1);
  return def.casterLevel ?? ITEM_CASTER_LEVEL;
}

/** Item ids whose world-data effect string is a stand-in for a real 1e potion (see items.ITEM_RULES). */
export const POTION_EFFECTS = Object.freeze({ potionHeroism: 'heroism' });

/** DMG save category for magic released by an item: wands, staves and rods → 'rsw'; others keep the spell's. */
export function itemSaveKey(def) {
  return def && (def.type === 'wand' || def.type === 'staff' || def.type === 'rod') ? 'rsw' : undefined;
}

/**
 * Necklace of Missiles: the bead the wearer throws next (the largest left)
 * as {hd} — a fireball of that many d6 — or null when spent. Beads live in
 * ITEM_RULES (DMG type I: 5, 3, 3 HD); `entry.charges` counts those left.
 */
export function nextBead(entry) {
  const def = itemRulesOf(entry);
  const beads = [...(def?.beads ?? [])].sort((a, b) => b - a);
  const left = entry?.charges ?? beads.length;
  if (!(left > 0) || !beads.length) return null;
  return { hd: beads[Math.max(0, beads.length - left)] };
}

/**
 * DMG Potion of Heroism: temporary levels for a fighter of level 0 +4,
 * 1st-3rd +3, 4th-6th +2, 7th-9th +1, 10th+ none.
 */
export function heroismLevels(fighterLevel) {
  if (fighterLevel <= 0) return 4;
  if (fighterLevel <= 3) return 3;
  if (fighterLevel <= 6) return 2;
  if (fighterLevel <= 9) return 1;
  return 0;
}

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
  const def = entry && itemRulesOf(entry);
  const out = { ok: false, log: [], consumed: false };
  if (!def) return { ...out, reason: 'no such item' };
  const tgts = targets?.length ? targets : [ch];
  const name = itemName(entry);

  if (def.type === 'wand' || def.type === 'staff' || def.type === 'rod') {
    if (!(entry.charges > 0)) return { ...out, reason: 'no charges' };
    if (def.classes && !splitClasses(ch.classSpec).some((c) => def.classes.includes(c))) return { ...out, reason: 'class cannot use' };
    const cast = castSpell(rng, def.effect, ch, tgts, { fromItem: true, level: itemCasterLevel(def, def.effect), check: false, saveKey: itemSaveKey(def) });
    entry.charges--;
    entry.identified = true;
    return { ok: cast.ok, log: [`${ch.name} uses the ${name}.`, ...cast.log.slice(1)], cast, consumed: false };
  }

  if (def.effect === 'necklaceMissiles') {
    const bead = nextBead(entry);
    if (!bead) return { ...out, reason: 'no missiles left' };
    const cast = castSpell(rng, 'fireball', ch, tgts, { fromItem: true, level: bead.hd, check: false });
    entry.charges = (entry.charges ?? 1) - 1;
    entry.identified = true;
    return { ok: cast.ok, log: [`${ch.name} hurls a ${bead.hd}-die missile from the ${name}.`, ...cast.log.slice(1)], cast, consumed: false };
  }

  if (def.type === 'scroll') {
    const spells = entry.spells ?? (def.effect ? [def.effect] : []);
    const spellId = o.spellId ?? spells[0];
    if (!spellId || !spells.includes(spellId)) return { ...out, reason: 'scroll is blank' };
    if (!canUseScroll(ch, spellId)) return { ...out, reason: 'cannot read this scroll' };
    const cast = castSpell(rng, spellId, ch, tgts, { fromItem: true, level: itemCasterLevel(def, spellId), check: false });
    consumeScrollSpell(ch, index, spellId);
    return { ok: cast.ok, log: [`${ch.name} reads the ${name}.`, ...cast.log.slice(1)], cast, consumed: true };
  }

  if (def.type === 'potion') {
    const t = tgts[0];
    const log = [`${nameOf(t)} quaffs the ${name}.`];
    applyPotion(rng, POTION_EFFECTS[def.id] ?? def.effect ?? '', t, log, def);
    removeItem(ch, index, 1);
    return { ok: true, log, consumed: true };
  }
  return { ...out, reason: 'cannot be used' };
}

/** Fighter levels of a potion drinker (0 for non-fighters; monsters count by HD when they fight as fighters). */
function fighterLevelOf(t) {
  const ch = characterOf(t);
  if (ch) return splitClasses(ch.classSpec).includes('fighter') ? ch.levels.fighter ?? 1 : null;
  return null;
}

function applyPotion(rng, effect, t, log, def = {}) {
  const [kind, arg] = effect.split(':');
  const host = effectHost(t);
  // DMG: Giant Strength and Heroism are fighter-only potions — anyone else gains nothing.
  if ((def.fighterOnly || kind === 'giantStrength' || kind === 'heroism') && fighterLevelOf(t) === null) {
    log.push(`${nameOf(t)} feels a warrior's fire flicker and fade. Only a fighter can use it.`);
    return;
  }
  if (kind === 'heal') {
    const n = healCreature(t, roll(rng, arg));
    log.push(`${nameOf(t)} is healed ${n} hit points.`);
  } else if (kind === 'giantStrength') {
    const str = Number(arg) || 21;
    addEffect(host, 'giantStrength', { rounds: 60, source: 'potion', mods: { strSet: { str, strPct: 0 } } });
    log.push(`${nameOf(t)} feels the might of giants.`);
  } else if (kind === 'speed') {
    // DMG: as haste for 5d4 rounds, and the drinker ages a year.
    removeEffect(host, 'slowed');
    addEffect(host, 'hasted', { rounds: roll(rng, '5d4'), source: 'potion' });
    const ch = characterOf(t);
    if (ch) ch.age = (ch.age ?? 20) + 1;
    log.push(`${nameOf(t)} blurs with speed.`);
  } else if (kind === 'heroism') {
    // DMG: the fighter temporarily gains levels (heroismLevels) — THAC0, saves
    // and attack rate as that higher level — and a d10 of temporary hit points
    // per level gained, lost first and gone when the potion wears off.
    const gain = heroismLevels(fighterLevelOf(t));
    if (gain && !getEffect(host, 'heroism')) {
      const tempHp = roll(rng, `${gain}d10`);
      addEffect(host, 'heroism', { rounds: 60, source: 'potion', mods: { fighterLevels: gain }, data: { levels: gain, tempHp } });
      if (t.hp) { t.hp.max += tempHp; t.hp.cur += tempHp; }
      log.push(`${nameOf(t)} is filled with heroic fury (+${gain} levels, +${tempHp} hit points).`);
    } else log.push(`${nameOf(t)} feels no braver than before.`);
  } else if (kind === 'neutralize') {
    removeEffect(host, 'poisoned');
    removeEffect(host, 'slowPoison');
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
