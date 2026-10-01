import {
  CONDITIONS, addEffect, removeEffect, getEffect, conditionIds, isIncapacitated, conditionsAllowCasting,
  clearCombatEffects,
} from './conditions.js';
import {
  castSpell, conditionLine, hammerStrike, SPELL_RULES, castProblem, spellTargeting, castingClass, casterLevel,
  spellsForClass,
} from './spells.js';
import { effectHost, nameOf, isDownCreature, characterOf, monsterOf, sideOf, isUndead } from './creature.js';
import {
  attacksFor, endOfRound, onHitSpecials, sweepAttacks, isDown, tagValue, savingThrow,
} from './combat.js';
import { spellSlots } from './classes.js';
import { useItem, canUseScroll, itemCasterLevel } from './magicItems.js';
import { ITEMS } from '../data/items.js';

/**
 * Bridge between the rules engine and the tactical (grid) combat engine in
 * src/scenes/combat/logic/engine.js. The tactical engine owns squares,
 * movement and presentation events; everything that is a *rule* — spells,
 * timed conditions, attack counts, bleeding, poison, monster specials — goes
 * through here so camp, tests and battle share one implementation.
 *
 *  fxView(c)          the combatant's `fx` bag as a live view over its rules
 *                     effects (c.fx.blessed → the 'blessed' effect's rounds)
 *  castInBattle(...)  rules castSpell → tactical "hits" for the scene
 *  roundUpkeep(c)     end-of-round: bleeding, poison onset, effect expiry
 *  attacksThisTurn    attacksFor + the fighter sweep vs < 1 HD foes
 *  hammerTurn(...)    a Spiritual Hammer's blow on a later round
 */

/** Tactical-engine fx keys that differ from the rules condition ids. */
export const FX_ALIASES = Object.freeze({ prot: 'protEvil', mirror: 'mirrorImage' });
const FX_REVERSE = Object.fromEntries(Object.entries(FX_ALIASES).map(([k, v]) => [v, k]));

const conditionFor = (k) => (typeof k === 'string' ? FX_ALIASES[k] ?? k : null);

/**
 * A Proxy that makes `c.fx` a view over the creature's rules effects (on the
 * Character for party members, so effects outlive the battle object).
 *  - read  `fx.blessed`      → remaining rounds (Infinity for open-ended), undefined if absent
 *  - read  `fx.mirror`       → mirror images left
 *  - write `fx.asleep = 5`   → addEffect('asleep', 5 rounds) (or set its rounds)
 *  - write `fx.held = 0` / `delete fx.held` → removeEffect
 * Keys that are not conditions (aooUsed...) are stored on a plain scratch object.
 */
export function fxView(c, scratch = {}) {
  const host = () => effectHost(c);
  const read = (t, k) => {
    const id = conditionFor(k);
    if (!id || !CONDITIONS[id]) return t[k];
    const h = host();
    const e = getEffect(h, id);
    if (id === 'mirrorImage') return e ? e.data?.images ?? 0 : undefined;
    if (e) return e.rounds;
    return h.conditions?.includes(id) ? true : undefined;
  };
  return new Proxy(scratch, {
    get: read,
    set(t, k, v) {
      const id = conditionFor(k);
      if (!id || !CONDITIONS[id]) {
        t[k] = v;
        return true;
      }
      const h = host();
      if (!v) {
        removeEffect(h, id);
        return true;
      }
      if (id === 'mirrorImage') {
        const e = addEffect(h, id, { rounds: getEffect(h, id)?.rounds ?? 10, data: { images: v } });
        e.data.images = v;
        return true;
      }
      const e = getEffect(h, id);
      if (e && typeof v === 'number') e.rounds = v;
      else addEffect(h, id, { rounds: typeof v === 'number' ? v : Infinity });
      return true;
    },
    deleteProperty(t, k) {
      const id = conditionFor(k);
      if (id && CONDITIONS[id]) removeEffect(host(), id);
      else delete t[k];
      return true;
    },
    has(t, k) {
      return read(t, k) !== undefined;
    },
    ownKeys(t) {
      const keys = new Set(Object.keys(t));
      for (const id of conditionIds(host())) keys.add(FX_REVERSE[id] ?? id);
      return [...keys];
    },
    getOwnPropertyDescriptor(t, k) {
      const v = read(t, k);
      if (v === undefined) return undefined;
      return { value: v, writable: true, enumerable: true, configurable: true };
    },
  });
}

/** Can this creature act (not asleep, held, paralyzed, nauseous...)? */
export function ableToAct(c) {
  return !isIncapacitated(effectHost(c)) && !isIncapacitated(c);
}

/** Can this creature cast right now (not silenced, held...)? */
export function ableToCast(c) {
  return conditionsAllowCasting(effectHost(c));
}

/**
 * Attacks a combatant gets against `target` this round: attacksFor (3/2
 * fighters, haste, slow) and, in melee against creatures of less than one
 * full HD, the fighter's sweep (one per level).
 * @param {{ranged?:boolean, weapon?:object}} [o]
 */
export function attacksThisTurn(c, round, target = null, o = {}) {
  const n = attacksFor(c, round, o.weapon ? { weapon: o.weapon } : {});
  if (!o.ranged && target && c.ref?.classSpec) return Math.max(n, sweepAttacks(c.ref, target));
  return n;
}

const EFFECT_FLOAT = { asleep: 'asleep', held: 'held', nauseous: 'nauseous', charmed: 'charmed', paralyzed: 'held' };

/**
 * Cast a spell in battle. The tactical engine picks `targets` from its
 * template (nearest first); the rules decide who is affected, saves, damage
 * and effects. Returns the rules CastResult plus scene-ready `hits`:
 *   {id, dmg?, heal?, saved?, killed?, effect?, bolts?, text}
 * `effect` is 'asleep' | 'held' | 'nauseous' | 'charmed' | 'resist' for the
 * scene's floating text. Spell failure (low-WIS clerics) gives ok:false,
 * failed:true and a single text hit.
 * @param {{level?:number, fromItem?:boolean, school?:string}} [o]
 */
export function castInBattle(rng, spellId, caster, targets, o = {}) {
  // Conditions (silence, held...) and armour for arcane magic are always
  // checked; memory is the engine's business (it spends the slot itself).
  const res = castSpell(rng, spellId, caster, targets, {
    ignoreMemory: true, context: 'combat', level: o.level, fromItem: !!o.fromItem, school: o.school,
  });
  const hits = [];
  if (!res.ok) {
    hits.push({ text: res.log[res.log.length - 1] ?? 'The spell fails.' });
    return { ...res, hits };
  }
  const s = SPELL_RULES[spellId];
  for (const tr of res.results) {
    const t = tr.target;
    const name = tr.name ?? nameOf(t);
    const h = { id: t.id };
    if (tr.missed) h.text = `${nameOf(caster)} misses ${name}.`;
    else if (tr.immune) { h.effect = 'resist'; h.text = `${name} is unaffected.`; }
    else if (tr.resisted) { h.effect = 'resist'; h.text = `${name} resists the magic!`; }
    else if (tr.saved && s.save?.type === 'neg') { h.effect = 'resist'; h.saved = true; h.text = `${name} saves!`; }
    else if (tr.damage !== undefined) {
      h.dmg = tr.damage;
      h.saved = !!tr.saved;
      h.killed = !!tr.down;
      h.text = `${name} ${tr.saved ? 'dodges partly and ' : ''}takes ${tr.damage}.`;
      if (spellId === 'magicMissile') {
        const n = s.missiles(res.level);
        h.bolts = Array.from({ length: n }, () => 0);
        h.text = `${n} missile${n > 1 ? 's' : ''} strike${n > 1 ? '' : 's'} ${name} for ${tr.damage}.`;
      }
    } else if (tr.healed !== undefined) {
      h.heal = tr.healed;
      h.text = tr.healed ? `${name} is healed for ${tr.healed}.` : `${name} is already whole.`;
    } else if (tr.applied.length) {
      const id = tr.applied[0];
      if (EFFECT_FLOAT[id]) h.effect = EFFECT_FLOAT[id];
      if (id === 'mirrorImage') {
        const n = getEffect(effectHost(t), 'mirrorImage')?.data?.images ?? 1;
        h.text = `${n} image${n > 1 ? 's' : ''} of ${name} appear${n > 1 ? '' : 's'}.`;
      } else h.text = conditionLine(name, id);
    } else if (tr.removed.length) h.text = `The magic about ${name} unravels.`;
    else if (!tr.affected) continue;
    if (tr.charmed) h.effect = 'charmed';
    hits.push(h);
  }
  if (!hits.length) hits.push({ text: s.hostile ? 'Nobody succumbs to the spell.' : 'Nothing happens.' });
  return { ...res, hits };
}

/**
 * End-of-round upkeep for one combatant, as tactical events: bleeding for
 * the dying (bandaged allies don't bleed), poison onset, and timed effects
 * running out (sleepers wake, the held move again).
 * @returns {object[]} events: bleed / down / wake / effectEnd / poison
 */
export function roundUpkeep(c) {
  const ev = [];
  const name = c.name ?? nameOf(c);
  const r = endOfRound(c);
  if (r.bled) {
    const dead = isDownCreature(c) && (c.ref?.status ?? c.status) === 'dead';
    ev.push({ type: 'bleed', id: c.id, text: dead ? `${name} has bled to death.` : `${name} is bleeding (${c.hp.cur}).` });
    if (dead) ev.push({ type: 'down', id: c.id, status: 'dead', silent: true });
  }
  if (r.poisonDeath) {
    ev.push({ type: 'down', id: c.id, status: 'dead', text: `${name} succumbs to the poison.` });
  }
  for (const id of r.expired) {
    if (id === 'asleep') ev.push({ type: 'wake', id: c.id, text: `${name} wakes up.` });
    else if (id === 'held' || id === 'paralyzed') ev.push({ type: 'wake', id: c.id, text: `${name} can move again.` });
    else if (id === 'nauseous') ev.push({ type: 'wake', id: c.id, text: `${name} stops retching.` });
    else ev.push({ type: 'effectEnd', id: c.id, effect: id, silent: true });
  }
  return ev;
}

/**
 * A Spiritual Hammer the caster still holds strikes again (start of the
 * cleric's turn). `pick(range)` returns the target to strike (or null) when
 * the original one is gone. Returns an attack event or null.
 */
export function hammerTurn(rng, caster, byId, pick) {
  const e = getEffect(effectHost(caster), 'spiritualHammer');
  if (!e || !(e.rounds > 0)) return null;
  let t = e.data?.targetId ? byId(e.data.targetId) : null;
  if (!t || isDown(t)) t = pick(3);
  if (!t) return null;
  e.data = { ...(e.data ?? {}), targetId: t.id };
  const h = hammerStrike(rng, caster, t, e.data?.magic ?? 1);
  return { type: 'attack', id: caster.id, target: t.id, hit: h.hit, dmg: h.damage, roll: h.roll, needed: h.needed, killed: h.down, ranged: true, hammer: true, text: h.text };
}

/** Monster on-hit specials (paralysis, poison, disease) as tactical events. */
export function specialsOnHit(rng, attacker, defender) {
  const label = { paralyze: 'Paralyzed', poison: 'Poisoned', disease: 'Diseased', drainLevel: 'Drained', drainStr: 'Weakened' };
  // `kind` doubles as the scene's floating label; `special` is the rule id.
  return onHitSpecials(rng, attacker, defender).map((r) => ({
    type: 'effect', id: defender.id, kind: r.saved ? 'Resists' : label[r.kind] ?? r.kind, special: r.kind, saved: r.saved, text: r.text,
    ...(r.died ? { died: true } : {}),
  }));
}

// ------------------------------------------------------------ spell targeting

/**
 * Single source of truth for how a spell is aimed in battle, derived from
 * SPELL_RULES via spellTargeting() at the caster's real level and casting
 * class (cleric Hold Person range 6, magic-user 12; Magic Missile 6+L;
 * Fireball 10+L; Bless a 5x5 square; Haste radius 2, max L targets...).
 * Returned in the tactical engine's vocabulary:
 *   target: 'enemy' | 'ally' | 'self' | 'square' | 'direction'
 *   shape:  'single' | 'radius' | 'square' | 'cone' | 'line' | 'all'
 * plus range, size, maxTargets, hostile, affects, level, school. Scene-only
 * hints (VFX, how the template picks victims) are layered on by the engine.
 * @param {{level?:number, school?:string}} [o]
 */
export function battleTargeting(id, caster = {}, o = {}) {
  const s = SPELL_RULES[id];
  if (!s) return null;
  const school = o.school ?? castingClass(caster, id);
  const level = o.level ?? casterLevel(caster, id);
  const t = spellTargeting(id, level, school);
  let target;
  let shape = t.shape;
  switch (s.target) {
    case 'self': target = 'self'; shape = 'single'; break;
    case 'ally': case 'creature': target = 'ally'; shape = 'single'; break;
    case 'enemy': target = 'enemy'; shape = 'single'; break;
    case 'direction': target = 'direction'; break;
    case 'area': target = 'square'; break;
    case 'party': target = shape === 'all' ? 'self' : 'square'; break;
    default: target = 'self'; shape = 'single';
  }
  return {
    target, shape, range: t.range, size: t.size, maxTargets: t.maxTargets, hostile: t.hostile, affects: t.affects,
    level, school,
  };
}

/**
 * Why a combatant cannot cast this spell in battle right now (conditions,
 * armour for arcane magic, camp-only spells), or null. Memory is not checked.
 */
export function battleCastProblem(c, id) {
  if (!SPELL_RULES[id]) return 'unknown spell';
  return castProblem(characterOf(c) ?? c, id, { context: 'combat', ignoreMemory: true });
}

/** Filter a memorized-spell list ({id, cls}[]) to what can be cast in battle now. */
export function castableInBattle(c, spells) {
  return spells.filter((s) => !battleCastProblem(c, s.id));
}

// ------------------------------------------------------- monster spellcasting

/**
 * Default load-outs for monster priests (evil clerics of Bane favour the
 * reversed forms). Monsters may declare `spellList: string[]` instead.
 */
export const MONSTER_PRIEST_SPELLS = Object.freeze({
  cleric: [
    ['causeLightWounds', 'curse', 'causeLightWounds', 'protectionFromGood', 'causeLightWounds'],
    ['holdPerson', 'silence15', 'holdPerson', 'spiritualHammer', 'holdPerson'],
    ['prayer', 'dispelMagic', 'causeBlindness', 'bestowCurse'],
  ],
  magicUser: [
    ['magicMissile', 'sleep', 'shockingGrasp', 'magicMissile'],
    ['stinkingCloud', 'mirrorImage', 'rayOfEnfeeblement'],
    ['fireball', 'lightningBolt', 'holdPerson', 'slow'],
  ],
});

/** A monster's spellcasting class and level from its `spells:clericN` / `spells:magicUserN` tag. */
export function monsterCasting(c) {
  const m = monsterOf(c);
  const tag = (m?.special ?? []).find?.((t) => String(t).startsWith('spells:'));
  if (!tag) return null;
  const mm = /^spells:(cleric|magicUser|mu)(\d+)$/.exec(String(tag));
  if (!mm) return null;
  return { cls: mm[1] === 'mu' ? 'magicUser' : mm[1], level: Number(mm[2]) };
}

/**
 * Spells a monster caster still holds this battle, as {id, cls}[] — the same
 * shape as a character's memorized list. The tag `spells:clericN` makes it an
 * Nth-level cleric (1e slots for that level, no WIS bonus); the slot list is
 * filled once per battle on the combatant (`c.monsterSpells`) and spent by
 * consumeMonsterSpell. Exposed for the AI.
 */
export function monsterSpells(c) {
  const cast = monsterCasting(c);
  if (!cast) return [];
  if (!c.monsterSpells) {
    const m = monsterOf(c);
    const slots = spellSlots(cast.cls, cast.level);
    const list = [];
    slots.forEach((n, i) => {
      const pool = (m.spellList ?? []).filter((id) => SPELL_RULES[id]?.schools[cast.cls] === i + 1);
      const src = pool.length ? pool : (MONSTER_PRIEST_SPELLS[cast.cls][i] ?? spellsForClass(cast.cls, i + 1));
      for (let k = 0; k < n; k++) if (src.length) list.push(src[k % src.length]);
    });
    c.monsterSpells = list;
    c.casterLevel = cast.level;
  }
  return c.monsterSpells.filter((id) => SPELL_RULES[id]?.usable !== 'camp').map((id) => ({ id, cls: cast.cls }));
}

/** Spend one of a monster's spells (returns false if it had none left). */
export function consumeMonsterSpell(c, id) {
  monsterSpells(c);
  const i = c.monsterSpells?.indexOf(id) ?? -1;
  if (i < 0) return false;
  c.monsterSpells.splice(i, 1);
  return true;
}

// ----------------------------------------------------------- monster auras

/**
 * Ghast stench (MM): anyone within 10' (an adjacent square, `near(a, b)`) of a
 * creature tagged `stench` saves vs poison once per battle or fights at -2 to
 * hit while the battle lasts. Undead are immune. Returns effect events.
 */
export function stenchAuras(rng, all, near) {
  const ev = [];
  const sources = all.filter((c) => !isDown(c) && !c.fled && tagValue(c, 'stench') !== null);
  if (!sources.length) return ev;
  for (const v of all) {
    if (isDown(v) || v.fled || v.stenchChecked || isUndead(v)) continue;
    if (!sources.some((src) => sideOf(src) !== sideOf(v) && near(src, v))) continue;
    v.stenchChecked = true;
    const sv = savingThrow(rng, v, 'ppdm');
    const name = v.name ?? nameOf(v);
    if (sv.saved) ev.push({ type: 'effect', id: v.id, kind: 'Resists', special: 'stench', saved: true, text: `${name} masters the charnel stench.` });
    else {
      addEffect(effectHost(v), 'stench', { rounds: Infinity, source: 'stench' });
      ev.push({ type: 'effect', id: v.id, kind: 'Retching', special: 'stench', saved: false, text: `${name} retches at the charnel stench!` });
    }
  }
  return ev;
}

// --------------------------------------------------------------- items

/**
 * Which battle use an inventory item has: 'potion' (drink now), 'spell'
 * (scroll/wand: a spell the engine aims and casts at `level`), or a reason
 * it cannot be used. Scrolls follow canUseScroll (magic-user scrolls need a
 * magic-user, cleric scrolls a cleric); caster levels come from
 * itemCasterLevel (ITEM_CASTER_LEVEL rules).
 * @returns {{kind:'potion'|'spell', spellId?:string, level?:number, reason?:string}}
 */
export function battleItemUse(ch, index) {
  const e = ch.inventory[index];
  const def = e && ITEMS[e.id];
  if (!def) return { kind: null, reason: 'Nothing to use.' };
  if (def.type === 'potion') return { kind: 'potion' };
  if (def.type === 'wand' || def.type === 'staff' || def.type === 'rod') {
    if (!(e.charges > 0)) return { kind: null, reason: 'The wand is spent.' };
    return { kind: 'spell', spellId: def.effect, level: itemCasterLevel(def, def.effect) };
  }
  if (def.type === 'scroll') {
    const spellId = e.spells?.[0] ?? def.effect;
    if (!spellId) return { kind: null, reason: 'The scroll is blank.' };
    if (!canUseScroll(ch, spellId)) {
      const s = SPELL_RULES[spellId];
      return { kind: null, reason: s?.schools.cleric !== undefined && s?.schools.magicUser === undefined ? 'Only a cleric can read that scroll.' : 'Only a magic-user can read that scroll.' };
    }
    if (SPELL_RULES[spellId]?.usable === 'camp') return { kind: null, reason: 'That cannot be used in combat.' };
    return { kind: 'spell', spellId, level: itemCasterLevel(def, spellId) };
  }
  return { kind: null, reason: 'That cannot be used in combat.' };
}

/**
 * Drink a potion in battle through the rules useItem (heal, giant strength,
 * speed, invisibility, heroism, neutralize...). Returns tactical events:
 * a `use` event, then `heal` when hit points came back, else an `effect`.
 */
export function quaffInBattle(rng, c, index) {
  const ch = characterOf(c);
  const def = ITEMS[ch.inventory[index]?.id];
  const before = ch.hp.cur;
  const conds = new Set(ch.effects.map((e) => e.id));
  const r = useItem(rng, ch, index, [c], { context: 'combat' });
  const name = c.name ?? ch.name;
  const ev = [{ type: 'use', id: c.id, item: def?.id, text: `${name} drinks a ${def?.name ?? 'potion'}.` }];
  if (!r.ok) return [{ type: 'log', text: r.reason ?? 'Nothing happens.', kind: 'warn' }];
  const healed = ch.hp.cur - before;
  const added = ch.effects.map((e) => e.id).filter((id) => !conds.has(id));
  if (healed > 0) ev.push({ type: 'heal', id: c.id, amount: healed, text: `${name} regains ${healed} hit points.` });
  else ev.push({ type: 'effect', id: c.id, kind: added[0] ? (CONDITIONS[added[0]]?.name ?? added[0]) : 'Potion', effect: added[0], text: r.log[1] ?? 'Nothing seems to happen.' });
  return ev;
}

/**
 * End of battle for the party (call from the scene's finish, whatever the
 * outcome): strips combat-only effects (held, asleep, charmed, hasted,
 * nauseous, stench...) from every party Character and clears per-battle
 * scratch on the combatants. Poison, disease, curses, blindness and long
 * buffs (strength, resist fire...) persist.
 * @param {object[]} combatants party combatants or Characters
 * @returns {Record<string,string[]>} removed effect ids by character id
 */
export function endBattle(combatants) {
  const out = {};
  for (const c of combatants) {
    const host = effectHost(c);
    const removed = clearCombatEffects(host);
    for (const k of ['asleep', 'held', 'paralyzed', 'nauseous', 'charmed', 'stench']) {
      const i = host.conditions?.indexOf(k) ?? -1;
      if (i >= 0) host.conditions.splice(i, 1);
    }
    if (removed.length) out[host.id ?? nameOf(host)] = removed;
    delete c.stenchChecked;
  }
  return out;
}
