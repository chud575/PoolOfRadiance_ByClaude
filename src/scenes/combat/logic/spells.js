import { getSpell } from '../../../rules/spells.js';
import { splitClasses } from '../../../rules/classes.js';
import { deriveStats } from '../../../rules/character.js';

/**
 * Tactical definitions for combat spells: how they are targeted and what area
 * they cover. Resolution lives in the engine; visuals in view/vfx.js.
 *   target: 'enemy' | 'ally' | 'self' | 'square' | 'direction'
 *   shape:  'single' | 'radius' | 'square' | 'cone' | 'line' | 'allies' | 'all'
 */
export const SPELL_TACTICS = {
  magicMissile: { target: 'enemy', range: 6, shape: 'single', vfx: 'missile', hostile: true },
  sleep: { target: 'square', range: 6, shape: 'square', size: 3, vfx: 'sleep', hostile: true },
  burningHands: { target: 'direction', range: 1, shape: 'cone', size: 3, vfx: 'cone', hostile: true },
  shockingGrasp: { target: 'enemy', range: 1, shape: 'single', vfx: 'shock', hostile: true },
  charmPerson: { target: 'enemy', range: 12, shape: 'single', vfx: 'charm', hostile: true },
  enlarge: { target: 'ally', range: 1, shape: 'single', vfx: 'buff' },
  shield: { target: 'self', range: 0, shape: 'single', vfx: 'ward' },
  invisibility: { target: 'ally', range: 1, shape: 'single', vfx: 'buff' },
  mirrorImage: { target: 'self', range: 0, shape: 'single', vfx: 'ward' },
  stinkingCloud: { target: 'square', range: 3, shape: 'square', size: 2, vfx: 'cloud', hostile: true },
  fireball: { target: 'square', range: 10, shape: 'radius', size: 2, vfx: 'fireball', hostile: true, notCaster: true },
  lightningBolt: { target: 'square', range: 8, shape: 'line', size: 8, vfx: 'lightning', hostile: true, notCaster: true },
  haste: { target: 'self', range: 0, shape: 'allies', vfx: 'buff' },
  bless: { target: 'self', range: 0, shape: 'allies', vfx: 'bless' },
  curse: { target: 'square', range: 6, shape: 'square', size: 5, vfx: 'curse', hostile: true },
  cureLightWounds: { target: 'ally', range: 1, shape: 'single', vfx: 'heal' },
  causeLightWounds: { target: 'enemy', range: 1, shape: 'single', vfx: 'cause', hostile: true },
  protectionFromEvil: { target: 'ally', range: 1, shape: 'single', vfx: 'ward' },
  resistCold: { target: 'ally', range: 1, shape: 'single', vfx: 'buff' },
  holdPerson: { target: 'square', range: 12, shape: 'radius', size: 1, max: 3, vfx: 'hold', hostile: true, pick: 'foes' },
  silence15: { target: 'square', range: 12, shape: 'radius', size: 2, vfx: 'curse', hostile: true },
  dispelMagic: { target: 'square', range: 6, shape: 'radius', size: 1, vfx: 'bless' },
  prayer: { target: 'self', range: 0, shape: 'all', vfx: 'bless' },
  // The rest of the Pool of Radiance list (resolved by the rules castSpell).
  chant: { target: 'self', range: 0, shape: 'all', vfx: 'bless' },
  spiritualHammer: { target: 'enemy', range: 3, shape: 'single', vfx: 'missile', hostile: true },
  resistFire: { target: 'ally', range: 1, shape: 'single', vfx: 'buff' },
  slowPoison: { target: 'ally', range: 1, shape: 'single', vfx: 'heal' },
  snakeCharm: { target: 'square', range: 3, shape: 'radius', size: 1, vfx: 'charm', hostile: true },
  cureBlindness: { target: 'ally', range: 1, shape: 'single', vfx: 'heal' },
  cureDisease: { target: 'ally', range: 1, shape: 'single', vfx: 'heal' },
  removeCurse: { target: 'ally', range: 1, shape: 'single', vfx: 'bless' },
  causeBlindness: { target: 'enemy', range: 1, shape: 'single', vfx: 'cause', hostile: true },
  causeDisease: { target: 'enemy', range: 1, shape: 'single', vfx: 'cause', hostile: true },
  bestowCurse: { target: 'enemy', range: 1, shape: 'single', vfx: 'curse', hostile: true },
  protectionFromGood: { target: 'ally', range: 1, shape: 'single', vfx: 'ward' },
  reduce: { target: 'enemy', range: 1, shape: 'single', vfx: 'curse', hostile: true },
  detectInvisibility: { target: 'self', range: 0, shape: 'single', vfx: 'buff' },
  rayOfEnfeeblement: { target: 'enemy', range: 4, shape: 'single', vfx: 'curse', hostile: true },
  strength: { target: 'ally', range: 1, shape: 'single', vfx: 'buff' },
  blink: { target: 'self', range: 0, shape: 'single', vfx: 'ward' },
  invisibility10: { target: 'square', range: 0, shape: 'radius', size: 1, vfx: 'buff' },
  protEvil10: { target: 'square', range: 0, shape: 'radius', size: 1, vfx: 'ward' },
  protNormalMissiles: { target: 'ally', range: 1, shape: 'single', vfx: 'ward' },
  slow: { target: 'square', range: 10, shape: 'radius', size: 2, vfx: 'hold', hostile: true, pick: 'foes' },
};

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
