/**
 * Conditions & timed effects. Works on any creature-like object — a party
 * Character, a combat Combatant, or a bare monster record — that has (or will
 * be given) `effects: Effect[]` and `conditions: string[]`.
 *
 * `effects` holds the timed records; `conditions` mirrors their ids as plain
 * strings so the UI and older code can do `conditions.includes('asleep')`.
 * Durations are in combat rounds (1 round = 1 minute, 1 turn = 10 rounds).
 *
 * @typedef {Object} Effect
 * @property {string} id           CONDITIONS key
 * @property {number} rounds       remaining rounds (Infinity = until removed)
 * @property {string} [source]     spell/item id that caused it
 * @property {string} [casterId]
 * @property {number} [level]      caster level (for dispel magic)
 * @property {Object} [mods]       per-instance overrides of CONDITIONS[id].mods
 * @property {Object} [data]       free-form (images left, str bonus rolled, poison timer...)
 */

export const ROUNDS_PER_TURN = 10;
export const ROUNDS_PER_HOUR = 60;

/**
 * Condition registry. Flags:
 *  incapacitated – cannot act; helpless – attacks vs it get +4 and melee kills
 *  outright (1e) at the scene's discretion; breaksOnDamage – removed when hurt;
 *  noCast – cannot cast spells; magical – can be dispelled; hostile – harmful.
 * `mods` (all optional): hit, dmg, ac (negative = better), save (all saves),
 *  saveVs {key:n}, acVsMissile (device-propelled) / acVsHurled (thrown) / acVsMelee (AC cap, e.g. shield spell),
 *  strSet {str,strPct}, strBonus, strLossPct, moveMult, attackMult,
 *  attackerHit (to-hit mod for creatures attacking this one), images,
 *  immune [..], resist {element: damage multiplier}, saveVsElement {element:n},
 *  vsEvil / vsGood {ac, save}, cha, missChance (% attacks miss outright), strDrain (STR points lost),
 *  fighterLevels (temporary fighter levels: heroism — THAC0, saves and attacks as a higher-level fighter).
 */
export const CONDITIONS = {
  // ---------------------------------------------------------------- statuses
  unconscious: { name: 'Unconscious', kind: 'status', incapacitated: true, helpless: true, desc: 'Knocked senseless at 0 hit points.' },
  dying: { name: 'Dying', kind: 'status', incapacitated: true, helpless: true, desc: 'Bleeding 1 hp per round. Bandage or heal to save.' },
  dead: { name: 'Dead', kind: 'status', incapacitated: true, desc: 'Beyond mortal aid; a temple may raise the dead.' },
  stoned: { name: 'Stoned', kind: 'status', incapacitated: true, desc: 'Turned to stone.' },
  poisoned: { name: 'Poisoned', kind: 'status', hostile: true, desc: 'Venom in the blood. Fatal without slow or neutralize poison.' },
  diseased: { name: 'Diseased', kind: 'debuff', hostile: true, mods: { hit: -2 }, noNaturalHealing: true, desc: 'Weakened by sickness; no natural healing.' },
  blinded: { name: 'Blind', kind: 'debuff', hostile: true, mods: { hit: -4, ac: 4 }, desc: '-4 to hit, +4 AC (worse).' },
  fleeing: { name: 'Fleeing', kind: 'debuff', desc: 'Running from the battle.' },
  turned: { name: 'Turned', kind: 'debuff', hostile: true, magical: false, desc: 'Driven off by holy power.' },
  bandaged: { name: 'Bandaged', kind: 'status', desc: 'Bleeding stopped.' },

  // ------------------------------------------------------------- spell debuffs
  asleep: { name: 'Asleep', kind: 'debuff', hostile: true, incapacitated: true, helpless: true, breaksOnDamage: true, magical: true, desc: 'Magically asleep. Wakes if struck.' },
  held: { name: 'Held', kind: 'debuff', hostile: true, incapacitated: true, helpless: true, magical: true, desc: 'Paralyzed and helpless.' },
  paralyzed: { name: 'Paralyzed', kind: 'debuff', hostile: true, incapacitated: true, helpless: true, desc: 'Paralyzed (ghoul touch, wand).' },
  nauseous: { name: 'Nauseous', kind: 'debuff', hostile: true, incapacitated: true, helpless: true, magical: true, desc: 'Retching helplessly in the stinking cloud.' },
  charmed: { name: 'Charmed', kind: 'debuff', hostile: true, magical: true, switchesSide: true, desc: 'Fights for the one who charmed it.' },
  cursed: { name: 'Cursed', kind: 'debuff', hostile: true, magical: true, mods: { hit: -1 }, desc: '-1 to hit and morale.' },
  bestowCurse: { name: 'Accursed', kind: 'debuff', hostile: true, magical: true, mods: { hit: -4, save: -4 }, desc: '-4 to hit and saving throws.' },
  prayerFoe: { name: 'Prayer (foe)', kind: 'debuff', hostile: true, magical: true, mods: { hit: -1, dmg: -1, save: -1 }, desc: '-1 to hit, damage and saves.' },
  chantFoe: { name: 'Chant (foe)', kind: 'debuff', hostile: true, magical: true, mods: { hit: -1, dmg: -1, save: -1 }, desc: '-1 to hit, damage and saves.' },
  silenced: { name: 'Silenced', kind: 'debuff', hostile: true, magical: true, noCast: true, desc: 'No sound: spells cannot be cast.' },
  slowed: { name: 'Slowed', kind: 'debuff', hostile: true, magical: true, mods: { moveMult: 0.5, attackMult: 0.5 }, desc: 'Half movement and attacks.' },
  enfeebled: { name: 'Enfeebled', kind: 'debuff', hostile: true, magical: true, mods: { strLossPct: 25 }, desc: 'Strength sapped by the ray.' },
  reduced: { name: 'Reduced', kind: 'debuff', hostile: true, magical: true, mods: { dmg: -2 }, desc: 'Shrunk: weaker blows.' },
  strDrain: { name: 'Strength Drained', kind: 'debuff', hostile: true, desc: 'A shadow\'s chill touch has drained strength (returns in 2d4 turns).' },
  stench: { name: 'Retching', kind: 'debuff', hostile: true, mods: { hit: -2 }, desc: 'Sickened by a ghast\'s charnel stench: -2 to hit.' },
  charmedSnake: { name: 'Entranced', kind: 'debuff', hostile: true, magical: true, incapacitated: true, desc: 'Swaying, snake-charmed.' },

  // --------------------------------------------------------------- spell buffs
  blessed: { name: 'Blessed', kind: 'buff', magical: true, mods: { hit: 1 }, desc: '+1 to hit and morale.' },
  prayer: { name: 'Prayer', kind: 'buff', magical: true, mods: { hit: 1, dmg: 1, save: 1 }, desc: '+1 to hit, damage and saves.' },
  chant: { name: 'Chant', kind: 'buff', magical: true, mods: { hit: 1, dmg: 1, save: 1 }, desc: '+1 to hit, damage and saves.' },
  protEvil: { name: 'Prot. from Evil', kind: 'buff', magical: true, mods: { vsEvil: { ac: -2, save: 2 } }, desc: '-2 AC and +2 saves against evil creatures.' },
  protGood: { name: 'Prot. from Good', kind: 'buff', magical: true, mods: { vsGood: { ac: -2, save: 2 } }, desc: '-2 AC and +2 saves against good creatures.' },
  shielded: { name: 'Shield', kind: 'buff', magical: true, mods: { acVsHurled: 2, acVsMissile: 3, acVsMelee: 4, immune: ['magicMissile'] }, desc: 'AC 2 vs hurled missiles, AC 3 vs arrows, bolts and sling stones, AC 4 vs all else; immune to magic missile.' },
  enlarged: { name: 'Enlarged', kind: 'buff', magical: true, mods: { dmg: 2 }, desc: 'Grown huge: heavier blows.' },
  strength: { name: 'Strength', kind: 'buff', magical: true, desc: 'Magically increased strength.' },
  giantStrength: { name: 'Giant Strength', kind: 'buff', magical: true, desc: 'Strength of a giant.' },
  heroism: { name: 'Heroism', kind: 'buff', magical: true, mods: { fighterLevels: 2 }, desc: 'Fights as a more seasoned warrior: extra fighter levels and hit dice.' },
  afraid: { name: 'Afraid', kind: 'debuff', hostile: true, magical: true, mods: { hit: -2 }, flees: true, desc: 'Gripped by supernatural terror: flees, -2 to hit if cornered.' },
  invisible: { name: 'Invisible', kind: 'buff', magical: true, mods: { attackerHit: -4 }, breaksOnAttack: true, desc: 'Unseen: foes -4 to hit; ends on attacking.' },
  mirrorImage: { name: 'Mirror Image', kind: 'buff', magical: true, desc: 'Illusory doubles absorb attacks.' },
  blinking: { name: 'Blink', kind: 'buff', magical: true, mods: { attackerHit: -2, missChance: 50 }, desc: 'Flickers between planes; half of all attacks miss.' },
  hasted: { name: 'Hasted', kind: 'buff', magical: true, mods: { moveMult: 2, attackMult: 2 }, desc: 'Double movement and attacks.' },
  resistCold: { name: 'Resist Cold', kind: 'buff', magical: true, mods: { resist: { cold: 0.5 }, saveVsElement: { cold: 3 } }, desc: 'Half damage from cold; +3 to saves.' },
  resistFire: { name: 'Resist Fire', kind: 'buff', magical: true, mods: { resist: { fire: 0.5 }, saveVsElement: { fire: 3 } }, desc: 'Half damage from fire; +3 to saves.' },
  protNormalMissiles: { name: 'Prot. Missiles', kind: 'buff', magical: true, mods: { immune: ['normalMissiles'] }, desc: 'Immune to non-magical missiles.' },
  slowPoison: { name: 'Slow Poison', kind: 'buff', magical: true, desc: 'Poison held at bay.' },
  friends: { name: 'Friends', kind: 'buff', magical: true, mods: { cha: 4 }, desc: 'Charisma raised.' },
  detectMagic: { name: 'Detect Magic', kind: 'buff', magical: true, desc: 'Magical auras glow.' },
  detectInvisibility: { name: 'Detect Invis.', kind: 'buff', magical: true, desc: 'Sees invisible creatures.' },
  findTraps: { name: 'Find Traps', kind: 'buff', magical: true, desc: 'Traps are revealed.' },
  spiritualHammer: { name: 'Spiritual Hammer', kind: 'buff', magical: true, desc: 'A hammer of force fights at the cleric\'s command.' },
  guarding: { name: 'Guarding', kind: 'buff', desc: 'Ready to strike the first foe that approaches.' },
  casting: { name: 'Casting', kind: 'status', lostOnDamage: true, desc: 'Weaving a spell. Struck before it goes off, the spell is lost.' },
};

/** Ensure the storage arrays exist. */
function store(target) {
  target.effects ??= [];
  target.conditions ??= [];
  return target.effects;
}

function syncCondition(target, id, present) {
  const arr = target.conditions;
  const i = arr.indexOf(id);
  if (present && i < 0) arr.push(id);
  if (!present && i >= 0) arr.splice(i, 1);
}

/**
 * Add (or refresh) an effect. Re-applying the same id keeps the longer
 * duration and merges data (effects of the same spell never stack in 1e).
 * @param {object} target
 * @param {string} id
 * @param {{rounds?:number, source?:string, casterId?:string, level?:number, mods?:object, data?:object}} [o]
 * @returns {Effect}
 */
export function addEffect(target, id, o = {}) {
  const list = store(target);
  const rounds = o.rounds ?? Infinity;
  let e = list.find((x) => x.id === id);
  if (e) {
    e.rounds = Math.max(e.rounds, rounds);
    if (o.mods) e.mods = { ...e.mods, ...o.mods };
    if (o.data) e.data = { ...e.data, ...o.data };
    if (o.level !== undefined) e.level = Math.max(e.level ?? 0, o.level);
    if (o.persist) e.persist = true;
  } else {
    e = { id, rounds };
    for (const k of ['source', 'casterId', 'level', 'mods', 'data', 'persist']) if (o[k] !== undefined) e[k] = o[k];
    list.push(e);
  }
  syncCondition(target, id, true);
  return e;
}

/**
 * Remove an effect (and its condition string). Returns true if present.
 * Temporary hit points the effect granted (`data.tempHp`, Potion of Heroism)
 * leave with it: max hp drops back and current hp is capped, so damage taken
 * meanwhile came off the temporary points first (DMG).
 */
export function removeEffect(target, id) {
  const list = store(target);
  const i = list.findIndex((x) => x.id === id);
  syncCondition(target, id, false);
  if (i < 0) return false;
  const [e] = list.splice(i, 1);
  const temp = e.data?.tempHp ?? 0;
  if (temp && target.hp) {
    target.hp.max = Math.max(1, target.hp.max - temp);
    target.hp.cur = Math.min(target.hp.cur, target.hp.max);
  }
  return true;
}

/** Does the creature have this condition (timed effect or plain string)? */
export function hasEffect(target, id) {
  return !!(target.effects?.some((e) => e.id === id) || target.conditions?.includes(id));
}

/** @returns {Effect|undefined} */
export function getEffect(target, id) {
  return target.effects?.find((e) => e.id === id);
}

/** All condition ids currently on a creature (union of effects and plain conditions). */
export function conditionIds(target) {
  const s = new Set(target.conditions ?? []);
  for (const e of target.effects ?? []) s.add(e.id);
  return [...s];
}

/** True if any condition prevents taking actions. */
export function isIncapacitated(target) {
  return conditionIds(target).some((id) => CONDITIONS[id]?.incapacitated);
}

/** True if helpless (sleeping/held/paralyzed): +4 to hit, auto-hit in some tables. */
export function isHelpless(target) {
  return conditionIds(target).some((id) => CONDITIONS[id]?.helpless);
}

/** Can this creature cast spells right now (conditions only; armour etc. elsewhere)? */
export function conditionsAllowCasting(target) {
  return !conditionIds(target).some((id) => CONDITIONS[id]?.incapacitated || CONDITIONS[id]?.noCast);
}

/**
 * Aggregate numeric modifiers from every active effect.
 * @returns {{hit:number, dmg:number, ac:number, save:number, saveVs:Record<string,number>,
 *   acVsMissile:number|null, acVsHurled:number|null, acVsMelee:number|null, moveMult:number, attackMult:number,
 *   attackerHit:number, missChance:number, strBonus:number, strSet:{str:number,strPct:number}|null,
 *   strLossPct:number, strDrain:number, immune:Set<string>, resist:Record<string,number>, saveVsElement:Record<string,number>,
 *   vsEvil:{ac:number,save:number}, vsGood:{ac:number,save:number}, cha:number, images:number, fighterLevels:number}}
 */
export function effectMods(target) {
  const out = {
    hit: 0, dmg: 0, ac: 0, save: 0, saveVs: {}, acVsMissile: null, acVsHurled: null, acVsMelee: null, moveMult: 1, attackMult: 1,
    attackerHit: 0, missChance: 0, strBonus: 0, strSet: null, strLossPct: 0, strDrain: 0, immune: new Set(), resist: {},
    saveVsElement: {}, vsEvil: { ac: 0, save: 0 }, vsGood: { ac: 0, save: 0 }, cha: 0, images: 0, fighterLevels: 0,
  };
  const ids = new Set();
  const records = [...(target.effects ?? [])];
  for (const c of target.conditions ?? []) if (!records.some((e) => e.id === c)) records.push({ id: c });
  for (const e of records) {
    if (ids.has(e.id)) continue;
    ids.add(e.id);
    const m = { ...(CONDITIONS[e.id]?.mods ?? {}), ...(e.mods ?? {}) };
    out.hit += m.hit ?? 0;
    out.dmg += m.dmg ?? 0;
    out.ac += m.ac ?? 0;
    out.save += m.save ?? 0;
    for (const [k, v] of Object.entries(m.saveVs ?? {})) out.saveVs[k] = (out.saveVs[k] ?? 0) + v;
    if (m.acVsMissile != null) out.acVsMissile = Math.min(out.acVsMissile ?? 99, m.acVsMissile);
    if (m.acVsHurled != null) out.acVsHurled = Math.min(out.acVsHurled ?? 99, m.acVsHurled);
    if (m.acVsMelee != null) out.acVsMelee = Math.min(out.acVsMelee ?? 99, m.acVsMelee);
    if (m.moveMult) out.moveMult *= m.moveMult;
    if (m.attackMult) out.attackMult *= m.attackMult;
    out.attackerHit += m.attackerHit ?? 0;
    out.missChance = Math.max(out.missChance, m.missChance ?? 0);
    out.strBonus += m.strBonus ?? 0;
    if (m.strSet && (!out.strSet || m.strSet.str * 1000 + (m.strSet.strPct ?? 0) > out.strSet.str * 1000 + (out.strSet.strPct ?? 0))) out.strSet = { strPct: 0, ...m.strSet };
    out.strLossPct = Math.max(out.strLossPct, m.strLossPct ?? 0);
    out.strDrain += m.strDrain ?? 0;
    for (const i of m.immune ?? []) out.immune.add(i);
    for (const [k, v] of Object.entries(m.resist ?? {})) out.resist[k] = Math.min(out.resist[k] ?? 1, v);
    for (const [k, v] of Object.entries(m.saveVsElement ?? {})) out.saveVsElement[k] = Math.max(out.saveVsElement[k] ?? 0, v);
    if (m.vsEvil) { out.vsEvil.ac = Math.min(out.vsEvil.ac, m.vsEvil.ac ?? 0); out.vsEvil.save = Math.max(out.vsEvil.save, m.vsEvil.save ?? 0); }
    if (m.vsGood) { out.vsGood.ac = Math.min(out.vsGood.ac, m.vsGood.ac ?? 0); out.vsGood.save = Math.max(out.vsGood.save, m.vsGood.save ?? 0); }
    out.cha += m.cha ?? 0;
    out.fighterLevels = Math.max(out.fighterLevels, m.fighterLevels ?? 0);
    if (e.id === 'mirrorImage') out.images += e.data?.images ?? 0;
  }
  // Haste and slow cancel each other (1e).
  if (ids.has('hasted') && ids.has('slowed')) { out.moveMult = 1; out.attackMult = 1; }
  return out;
}

/**
 * Advance timed effects by `rounds`. Returns the ids that expired this tick.
 * Plain `conditions` strings without an effect record never expire here.
 */
export function tickEffects(target, rounds = 1) {
  const list = store(target);
  const expired = [];
  for (const e of [...list]) {
    if (e.rounds === Infinity) continue;
    e.rounds -= rounds;
    if (e.rounds <= 0) {
      removeEffect(target, e.id);
      expired.push(e.id);
    }
  }
  return expired;
}

/**
 * Poison onset (1e "deadly" poison): the `poisoned` effect carries
 * `data.onset` in rounds (= minutes) left before the venom kills. Every mode
 * counts it down the same way — combat (endOfRound, 1 per round), exploration
 * (camp.passTime) and rest (camp.rest) — except while Slow Poison holds it
 * (only the minutes Slow Poison does not cover count). Does not kill: returns
 * {poisoned, onset, lethal} and the caller applies death to its creature kind.
 * @returns {{poisoned:boolean, onset:number, lethal:boolean}}
 */
export function tickPoison(target, minutes = 1) {
  const venom = getEffect(target, 'poisoned') ?? (target.conditions?.includes('poisoned') ? addEffect(target, 'poisoned', { data: { onset: 10 } }) : null);
  if (!venom) return { poisoned: false, onset: Infinity, lethal: false };
  const slow = getEffect(target, 'slowPoison');
  const held = slow ? Math.min(minutes, slow.rounds) : target.conditions?.includes('slowPoison') ? minutes : 0;
  const onset = (venom.data?.onset ?? 10) - Math.max(0, minutes - held);
  venom.data = { ...(venom.data ?? {}), onset };
  return { poisoned: true, onset, lethal: onset <= 0 };
}

/**
 * Called when a creature takes damage: wakes sleepers and ends invisibility-type
 * effects flagged breaksOnDamage. Returns removed ids.
 */
export function onDamaged(target) {
  const removed = [];
  // 1e spell disruption: a caster struck before the spell goes off loses it
  // (the slot is already spent). The effect stays, marked lost, so the
  // resolution can report "the spell is lost".
  for (const e of target.effects ?? []) {
    if (CONDITIONS[e.id]?.lostOnDamage && !e.data?.lost) e.data = { ...(e.data ?? {}), lost: true, lostReason: 'struck' };
  }
  for (const id of conditionIds(target)) {
    if (CONDITIONS[id]?.breaksOnDamage) {
      removeEffect(target, id);
      removed.push(id);
    }
  }
  return removed;
}

/** Called when a creature attacks: invisibility ends. Returns removed ids. */
export function onAttacked(target) {
  const removed = [];
  for (const id of conditionIds(target)) {
    if (CONDITIONS[id]?.breaksOnAttack) {
      removeEffect(target, id);
      removed.push(id);
    }
  }
  return removed;
}

/** Remove every effect matching a predicate over (effect, def). Returns removed ids. */
export function clearEffects(target, pred = () => true) {
  const removed = [];
  for (const e of [...store(target)]) {
    if (pred(e, CONDITIONS[e.id] ?? {})) {
      removeEffect(target, e.id);
      removed.push(e.id);
    }
  }
  return removed;
}

/**
 * Strip combat-only effects after a battle. Kept: poison, disease, curses,
 * blindness, bandages, drained strength, and every effect flagged `persist`
 * (cast from a spell whose duration runs in turns or hours — Enlarge, Prot.
 * from Normal Missiles, Strength, Resist Fire... see spells
 * LONG_DURATION_SPELLS) or from a potion; those run out with passTime.
 * Effects of round-measured spells end with the battle, as the PHB durations
 * (a few rounds) would have run out by then: Bless, Haste, Mirror Image,
 * Protection from Evil/Good (2-3 rounds per level), Friends (1 round per level).
 */
export function clearCombatEffects(target) {
  const keep = new Set(['poisoned', 'diseased', 'blinded', 'bestowCurse', 'slowPoison', 'bandaged', 'detectMagic', 'findTraps', 'detectInvisibility', 'resistCold', 'resistFire', 'strength', 'giantStrength', 'invisible', 'strDrain', 'heroism']);
  return clearEffects(target, (e) => !keep.has(e.id) && !e.persist);
}

/** Tooltip-ready list: [{id, name, desc, rounds, kind}] */
export function describeEffects(target) {
  const seen = new Set();
  const out = [];
  for (const id of conditionIds(target)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = CONDITIONS[id] ?? { name: id, kind: 'status', desc: '' };
    const e = getEffect(target, id);
    out.push({ id, name: def.name, desc: def.desc, kind: def.kind, rounds: e?.rounds ?? Infinity });
  }
  return out;
}
