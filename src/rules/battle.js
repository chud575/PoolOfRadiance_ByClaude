import {
  CONDITIONS, addEffect, removeEffect, getEffect, conditionIds, isIncapacitated, conditionsAllowCasting,
} from './conditions.js';
import { castSpell, conditionLine, hammerStrike, SPELL_RULES } from './spells.js';
import { effectHost, nameOf, isDownCreature } from './creature.js';
import { attacksFor, endOfRound, onHitSpecials, sweepAttacks, isDown } from './combat.js';

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
  const res = castSpell(rng, spellId, caster, targets, {
    check: false, ignoreMemory: true, context: 'combat', level: o.level, fromItem: !!o.fromItem, school: o.school,
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
  const label = { paralyze: 'Paralyzed', poison: 'Poisoned', disease: 'Diseased' };
  // `kind` doubles as the scene's floating label; `special` is the rule id.
  return onHitSpecials(rng, attacker, defender).map((r) => ({
    type: 'effect', id: defender.id, kind: r.saved ? 'Resists' : label[r.kind] ?? r.kind, special: r.kind, saved: r.saved, text: r.text,
  }));
}
