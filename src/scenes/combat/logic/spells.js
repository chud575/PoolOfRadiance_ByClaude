import { getSpell, SPELL_RULES } from '../../../rules/spells.js';
import { battleTargeting } from '../../../rules/battle.js';
import { splitClasses } from '../../../rules/classes.js';
import { deriveStats } from '../../../rules/character.js';

/**
 * Scene-only hints for combat spells: the VFX family and how the battlefield
 * template picks its victims (`pick: 'foes'` = chosen enemies only, hold
 * person / slow; `notCaster` = the caster is never caught by its own blast).
 * Everything that is a rule — target kind, range, shape, size, max targets —
 * comes from the rules (battleTargeting over SPELL_RULES), so the cleric's
 * Hold Person really is range 6 and Fireball 10 + level.
 */
export const SPELL_HINTS = {
  magicMissile: { vfx: 'missile' }, sleep: { vfx: 'sleep' }, burningHands: { vfx: 'cone' },
  shockingGrasp: { vfx: 'shock' }, charmPerson: { vfx: 'charm' }, enlarge: { vfx: 'buff' }, shield: { vfx: 'ward' },
  invisibility: { vfx: 'buff' }, mirrorImage: { vfx: 'ward' }, stinkingCloud: { vfx: 'cloud' },
  fireball: { vfx: 'fireball', notCaster: true }, lightningBolt: { vfx: 'lightning', notCaster: true },
  haste: { vfx: 'buff' }, bless: { vfx: 'bless' }, curse: { vfx: 'curse' }, cureLightWounds: { vfx: 'heal' },
  causeLightWounds: { vfx: 'cause' }, protectionFromEvil: { vfx: 'ward' }, resistCold: { vfx: 'buff' },
  holdPerson: { vfx: 'hold', pick: 'foes' }, silence15: { vfx: 'curse' }, dispelMagic: { vfx: 'bless' },
  prayer: { vfx: 'bless' }, chant: { vfx: 'bless' }, spiritualHammer: { vfx: 'missile' }, resistFire: { vfx: 'buff' },
  slowPoison: { vfx: 'heal' }, snakeCharm: { vfx: 'charm' }, cureBlindness: { vfx: 'heal' }, cureDisease: { vfx: 'heal' },
  removeCurse: { vfx: 'bless' }, causeBlindness: { vfx: 'cause' }, causeDisease: { vfx: 'cause' },
  bestowCurse: { vfx: 'curse' }, protectionFromGood: { vfx: 'ward' }, reduce: { vfx: 'curse' },
  detectInvisibility: { vfx: 'buff' }, rayOfEnfeeblement: { vfx: 'curse' }, strength: { vfx: 'buff' },
  blink: { vfx: 'ward' }, invisibility10: { vfx: 'buff' }, protEvil10: { vfx: 'ward' }, protGood10: { vfx: 'ward' },
  protNormalMissiles: { vfx: 'ward' }, slow: { vfx: 'hold', pick: 'foes' },
  cureSeriousWounds: { vfx: 'heal' }, cureCriticalWounds: { vfx: 'heal' }, neutralizePoison: { vfx: 'heal' },
};

/**
 * Tactical definition of a spell for a caster (rules targeting at the
 * caster's level and class + scene hints):
 *   target: 'enemy' | 'ally' | 'self' | 'square' | 'direction'
 *   shape:  'single' | 'radius' | 'square' | 'cone' | 'line' | 'all'
 *   range, size, maxTargets, hostile, affects, level, school, vfx, pick?, notCaster?
 * @param {{level?:number}} [o] item casts override the level
 */
export function spellTactics(id, caster = null, o = {}) {
  const r = battleTargeting(id, caster ?? {}, o);
  if (!r) return undefined;
  return { ...r, vfx: 'buff', ...(SPELL_HINTS[id] ?? {}) };
}

/**
 * Back-compat view: SPELL_TACTICS[id] is spellTactics(id) for a 1st-level
 * caster of the spell's first class. Prefer engine.tactics(c, id), which
 * knows the caster's real level and class.
 */
export const SPELL_TACTICS = new Proxy({}, {
  get: (_, id) => (typeof id === 'string' && SPELL_RULES[id] ? spellTactics(id) : undefined),
  has: (_, id) => typeof id === 'string' && !!SPELL_RULES[id],
  ownKeys: () => Object.keys(SPELL_RULES),
  getOwnPropertyDescriptor: (_, id) => (SPELL_RULES[id] ? { value: spellTactics(id), enumerable: true, configurable: true } : undefined),
});

/** Default spells a caster has "prepared at dawn" when the camp screen never set any. */
const DEFAULT_PREP = {
  magicUser: [['magicMissile', 'sleep', 'shockingGrasp'], ['stinkingCloud', 'mirrorImage'], ['fireball', 'lightningBolt']],
  cleric: [['cureLightWounds', 'bless', 'cureLightWounds', 'protectionFromEvil'], ['holdPerson', 'silence15'], ['prayer', 'dispelMagic']],
};

/**
 * Memorized combat spells of a character as a flat list of {id, cls}. Accepts the
 * {classId: [ids]} layout (and tolerates {level: [ids]}). When a caster has never
 * memorized anything, fills a sensible default load-out (QoL) and stores it.
 */
export function memorizedSpells(ch) {
  const classes = splitClasses(ch.classSpec).filter((c) => c === 'magicUser' || c === 'cleric');
  if (!classes.length) return [];
  ch.spells ??= { memorized: {}, book: [] };
  ch.spells.memorized ??= {};
  const mem = ch.spells.memorized;
  const empty = !Object.values(mem).some((v) => Array.isArray(v) && v.length) && !ch.spells._prepared;
  if (empty) {
    const slots = deriveStats(ch).spellSlots;
    for (const c of classes) {
      const list = [];
      (slots[c] ?? []).forEach((n, lvl) => {
        const pool = DEFAULT_PREP[c][lvl] ?? [];
        const known = c === 'magicUser' && ch.spells.book?.length ? pool.filter((id) => lvl > 0 || ch.spells.book.includes(id)) : pool;
        const src = known.length ? known : pool;
        for (let i = 0; i < n; i++) if (src.length) list.push(src[i % src.length]);
      });
      mem[c] = list;
    }
    ch.spells._prepared = true;
  }
  const out = [];
  for (const [k, ids] of Object.entries(mem)) {
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const s = getSpell(id);
      if (!s || !SPELL_TACTICS[id]) continue;
      if (s.usable === 'camp') continue;
      out.push({ id, cls: classes.includes(k) ? k : s.school });
    }
  }
  return out;
}

/** Remove one memorized instance of a spell (it is forgotten when cast). */
export function consumeSpell(ch, id) {
  for (const ids of Object.values(ch.spells?.memorized ?? {})) {
    if (!Array.isArray(ids)) continue;
    const i = ids.indexOf(id);
    if (i >= 0) {
      ids.splice(i, 1);
      return true;
    }
  }
  return false;
}

/** Caster level for a spell's school. */
export function casterLevel(ch, spellId) {
  const school = getSpell(spellId)?.school;
  return ch.levels?.[school] ?? Math.max(1, ...Object.values(ch.levels ?? { x: 1 }));
}
