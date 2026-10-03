import { roll } from './dice.js';
import { deriveStats, applyDamage, isConscious, bleed, drainLevel, effectiveAbilities, activeClasses, missileProfile } from './character.js';
import { trimMemorized } from './camp.js';
import { dexterityMods, strengthTable } from './abilities.js';
import { turnNeeded, fighterAttacksPerRound, attacksThisRound } from './classes.js';
import { MONSTERS } from '../data/monsters.js';
import {
  effectMods, isIncapacitated, isHelpless, onDamaged, onAttacked, breakConcentration, addEffect, hasEffect, getEffect,
  clearCombatEffects, tickPoison, tickEffects,
} from './conditions.js';
import { neededToHit } from './tohit.js';
import {
  isEvil, isGood, effectHost, characterOf, racialCombatMods, belowOneHd, monsterOf, monsterBaseSaves, monsterBaseThac0,
  magicVsBonus, sizeOf,
} from './creature.js';
import { rateOfFire } from './items.js';
import { rollSave } from './saves.js';
import { surpriseMods } from './explore.js';

export { neededToHit };

/**
 * Combat rules core, renderer-agnostic. The Combat scene owns positions,
 * movement, AI and presentation; it calls into these for resolution.
 * (Co-owned by the rules and combat workstreams.)
 *
 * @typedef {Object} Combatant
 * @property {string} id
 * @property {'party'|'monster'} side
 * @property {string} name
 * @property {number} thac0
 * @property {number} ac
 * @property {number} hitBonus
 * @property {number} dmgBonus
 * @property {string[]} attacks        damage dice: a monster's attack routine (claw/claw/bite), or a
 *                                     character's weapon damage (one entry; see attacksFor for how many)
 * @property {'S'|'M'|'L'} size
 * @property {{cur:number,max:number}} hp
 * @property {number} move             squares per round
 * @property {number} initMod          added to initiative roll
 * @property {Record<string,number>} saves
 * @property {string} status
 * @property {string[]} conditions
 * @property {object[]} effects        timed effects (shared with the Character for party members)
 * @property {number} xp               xp value when defeated (monsters)
 * @property {object} ref              the underlying Character or monster def
 * @property {string} [monsterId]
 * @property {number} [attackRate]     base attacks per round at creation (1.5 = 3 per 2 rounds); informational —
 *                                     attacksFor() recomputes it live (haste/slow cast mid-fight count)
 * @property {object} [snap]  derived numbers at creation, so later effects apply as deltas (rules internal)
 * @property {number} [x]  @property {number} [y]  @property {number} [facing]   owned by combat scene
 */

/** Build a combatant from a party Character (shares hp/conditions/effects → damage persists). */
export function combatantFromCharacter(ch) {
  const s = deriveStats(ch);
  ch.effects ??= [];
  ch.conditions ??= [];
  return {
    id: ch.id,
    side: 'party',
    name: ch.name,
    thac0: s.thac0,
    ac: s.ac,
    acMissile: s.acMissile,
    acHurled: s.acHurled,
    acRear: s.acRear,
    hitBonus: s.hitBonus,
    dmgBonus: s.dmgBonus,
    attacks: [s.damage],
    attackRate: s.attacks,
    attacksLarge: s.damageLarge,
    ranged: !!s.weapon?.ranged,
    range: s.range ?? 1, // rules missileRange (short bow 15), not the raw data value
    magicWeapon: s.weaponMagic > 0,
    weaponMagic: s.weaponMagic ?? 0,
    magicVs: s.weaponMagicVs ?? null,
    weaponSilver: isSilverWeapon(s.weapon),
    weaponEdged: isEdgedWeapon(s.weapon),
    size: sizeOf(ch), // halflings and gnomes are Small
    hp: ch.hp,
    move: Math.round(s.move / 2) + 1,
    initMod: dexterityMods(s.abilities.dex).reaction,
    saves: s.saves,
    get status() { return ch.status; },
    set status(v) { ch.status = v; },
    conditions: ch.conditions,
    effects: ch.effects,
    xp: 0,
    ref: ch,
    snap: {
      ac: s.ac, acMissile: s.acMissile, acHurled: s.acHurled, acRear: s.acRear, fxHit: s.mods.hit, fxDmg: s.mods.dmg, thac0: s.thac0,
      strHit: strengthTable(s.abilities.str, s.abilities.strPct).hit, strDmg: strengthTable(s.abilities.str, s.abilities.strPct).dmg,
    },
  };
}

/**
 * Monster combatant ids are scoped to the battle's Rng (a per-Rng sequence:
 * m1_kobold, m2_kobold...), so they do not depend on how many monsters were
 * built earlier in the session. `o.id` picks one explicitly.
 */
const MONSTER_SEQ = new WeakMap();
function nextMonsterSeq(rng) {
  const n = (MONSTER_SEQ.get(rng) ?? 0) + 1;
  MONSTER_SEQ.set(rng, n);
  return n;
}
/**
 * Build a combatant for a monster id, rolling its HP.
 * @param {{id?:string}} [o]
 */
export function combatantFromMonster(rng, monsterId, index = 0, o = {}) {
  const m = MONSTERS[monsterId];
  if (!m) throw new Error(`Unknown monster ${monsterId}`);
  const hp = m.hd < 1 ? rng.int(1, 4) : roll(rng, `${m.hd}d8`) + (m.hpBonus ?? 0);
  return {
    id: o.id ?? `m${nextMonsterSeq(rng)}_${monsterId}`,
    side: 'monster',
    name: index ? `${m.name} ${index}` : m.name,
    thac0: monsterBaseThac0(m),
    ac: m.ac,
    hitBonus: 0,
    dmgBonus: 0,
    attacks: [...m.attacks],
    ranged: !!m.ranged,
    range: m.range ?? 1,
    size: m.size,
    hp: { cur: Math.max(1, hp), max: Math.max(1, hp) },
    move: Math.round(m.move / 2) + 1,
    initMod: 0,
    saves: monsterBaseSaves(m),
    status: 'ok',
    conditions: [],
    effects: [],
    xp: m.xp,
    ref: m,
    monsterId,
  };
}

/**
 * Roll initiative for all living combatants: d10 + initMod, higher acts first;
 * ties broken by initMod then by side (party first) for readability.
 * Hasted creatures get +2, slowed -2.
 * @returns {Combatant[]} new array in acting order
 */
export function rollInitiative(rng, combatants) {
  const rolled = combatants
    .filter((c) => canAct(c))
    .map((c) => {
      const fx = effectMods(effectHost(c));
      const speed = fx.attackMult > 1 ? 2 : fx.attackMult < 1 ? -2 : 0;
      return { c, init: rng.die(10) + c.initMod + speed };
    });
  // MM: zombies (tag 'slow') always strike last in the round.
  const last = (c) => (monsterOf(c)?.special?.includes?.('slow') ? 1 : 0);
  rolled.sort((a, b) => last(a.c) - last(b.c) || b.init - a.init || b.c.initMod - a.c.initMod || (a.c.side === 'party' ? -1 : 1));
  for (const r of rolled) r.c.initiative = r.init;
  return rolled.map((r) => r.c);
}

/** Can the combatant take actions this round? */
export function canAct(c) {
  const host = effectHost(c);
  if (isIncapacitated(host) || isIncapacitated(c)) return false;
  if (c.side === 'party') return isConscious(c.ref);
  return c.status === 'ok' && c.hp.cur > 0;
}

export function isDown(c) {
  return c.hp.cur <= 0 || ['dead', 'dying', 'unconscious', 'fled', 'stoned', 'gone'].includes(c.status);
}

/** Number needed on d20 to hit (THAC0 - AC - bonuses, with the 1e repeating-20 rule). */
export function toHitNeeded(attacker, defender, mods = 0) {
  return neededToHit(attacker.thac0, defender.ac, (attacker.hitBonus ?? 0) + mods);
}

/**
 * Live situational numbers from timed effects that were applied after the
 * combatants were built (bless, prayer, shield, invisibility, prot. from evil...).
 * @returns {{hit:number, dmg:number, ac:number, missChance:number, images:number, immune:Set<string>}}
 */
export function liveMods(attacker, defender, { ranged = false, rear = false, hurled = null, defenderOnly = false } = {}) {
  const thrown = ranged && (hurled ?? isHurledAttack(attacker));
  const aHost = effectHost(attacker);
  const dHost = effectHost(defender);
  const out = { hit: 0, dmg: 0, ac: 0, missChance: 0, images: 0, immune: new Set() };
  // Attacker's own to-hit/damage adjustments (skipped for spell attacks,
  // which compute the caster's side themselves — see spellAttack).
  if (defenderOnly) { /* defender side only */ } else if (characterOf(attacker) && attacker.snap) {
    // Only the part that came from effects since the combatant was built.
    const s = deriveStats(characterOf(attacker));
    const st = strengthTable(s.abilities.str, s.abilities.strPct);
    out.hit += s.mods.hit - attacker.snap.fxHit + (ranged ? 0 : st.hit - attacker.snap.strHit);
    // Temporary fighter levels (heroism) improve THAC0 after the snapshot.
    if (attacker.snap.thac0 !== undefined) out.hit += attacker.snap.thac0 - s.thac0;
    out.dmg += s.mods.dmg - attacker.snap.fxDmg + (ranged ? 0 : st.dmg - attacker.snap.strDmg);
  } else if (!characterOf(attacker)) {
    const fx = effectMods(aHost);
    out.hit += fx.hit;
    out.dmg += fx.dmg;
    if (fx.strLossPct) out.dmgMult = 1 - fx.strLossPct / 100;
  }
  // Racial adjustments (dwarf/gnome vs giants, orcs, goblins...).
  const rac = racialCombatMods(attacker, defender);
  if (!defenderOnly) out.hit += rac.hit;
  out.ac += rac.ac;
  // Defender.
  const dfx = effectMods(dHost);
  if (characterOf(defender) && defender.snap) {
    // The combatant's `ac` is the melee AC at creation (plus anything the
    // scene adjusted since). The base for this attack is the matching live
    // AC: rear (no shield, no DEX bonus, no frontal Shield spell), missile
    // (Shield spell AC 2, Prot. from Normal Missiles...) or melee.
    const s = deriveStats(characterOf(defender));
    const live = rear ? s.acRear : ranged ? (thrown ? s.acHurled : s.acMissile) : s.ac;
    out.ac += live - defender.snap.ac;
  } else if (characterOf(defender)) {
    // A bare Character used as a defender (camp tests, scripted events).
    const s = deriveStats(characterOf(defender));
    out.ac += (rear ? s.acRear : ranged ? (thrown ? s.acHurled : s.acMissile) : s.ac) - (defender.ac ?? s.ac);
  } else {
    let ac = defender.ac + dfx.ac;
    if (rear) ac += monsterShieldAc(defender); // a shield guards the front only
    else {
      const cap = ranged ? (thrown ? dfx.acVsHurled ?? dfx.acVsMissile : dfx.acVsMissile) : dfx.acVsMelee;
      if (cap != null) ac = Math.min(ac, cap);
    }
    out.ac += ac - defender.ac;
  }
  out.hit += dfx.attackerHit;
  if (isEvil(attacker)) out.ac += dfx.vsEvil.ac;
  if (isGood(attacker)) out.ac += dfx.vsGood.ac;
  out.missChance = dfx.missChance;
  out.images = dfx.images;
  out.immune = dfx.immune;
  return out;
}

const HURLED_NAMES = /javelin|spear|axe|dagger|dart|rock|boulder|stone/i;

/**
 * Is this missile attack hand-hurled (thrown) rather than device-propelled?
 * It matters against the Shield spell: AC 2 vs hurled, AC 3 vs arrows,
 * bolts and sling stones (PHB). Taken from `attacker.hurled` when set, else
 * the character's missile weapon (missileProfile), else the monster's
 * `hurled` flag or weapon name (javelins, spears, rocks).
 */
export function isHurledAttack(attacker) {
  if (!attacker) return false;
  if (attacker.hurled != null) return !!attacker.hurled;
  if (attacker.rock) return true;
  const ch = characterOf(attacker);
  if (ch) return !!missileProfile(ch)?.thrown;
  const m = monsterOf(attacker);
  if (m?.hurled != null) return !!m.hurled;
  return HURLED_NAMES.test(m?.weapon ?? '');
}

/**
 * AC points a monster's shield gives (MonsterDef `shieldAc`, or `shield: true`
 * = 1). Attacks from behind ignore it (DMG); characters use deriveStats().acRear.
 */
export function monsterShieldAc(c) {
  const m = monsterOf(c);
  return m?.shieldAc ?? (m?.shield ? 1 : 0);
}

/**
 * The defender's armour class against one attack, before the attacker's
 * bonuses — the number neededToHit() reads. Rear and backstab attacks use the
 * rear AC (no shield, no DEX bonus); missiles the missile AC; else melee AC.
 * Timed effects, racial AC adjustments and protection from evil are included.
 * @param {{ranged?:boolean, rear?:boolean, backstab?:boolean}} [o]
 */
export function defenderAc(attacker, defender, o = {}) {
  const ranged = o.ranged ?? !!attacker?.ranged;
  const lm = liveMods(attacker ?? {}, defender, { ranged, rear: !!(o.rear || o.backstab) });
  return defender.ac + lm.ac;
}

/** Is the defender helpless (asleep, held, paralyzed, nauseous, unconscious)? */
export function isHelplessTarget(defender) {
  return isHelpless(effectHost(defender)) || isHelpless(defender);
}

/**
 * Helpless-target rules (DMG): 'bonus' = +4 to hit (default, conservative);
 * 'auto' = melee attacks hit automatically (missiles still get +4);
 * 'slay' = melee hits automatically and kills outright (coup de grace) —
 * the Gold Box treatment of sleeping and held foes.
 * @typedef {'bonus'|'auto'|'slay'} HelplessRule
 */
export const HELPLESS_RULES = ['bonus', 'auto', 'slay'];

/**
 * Situational to-hit bonus for attacking from behind (DMG/PHB): a rear attack
 * is +2; a thief's backstab is +4 *instead* (not cumulative). The one place
 * both resolveAttack and hitChance take it from, so the preview matches the roll.
 * @param {{rear?:boolean, backstab?:boolean}} [o]
 */
export function situationalHit(o = {}) {
  return o.backstab ? 4 : o.rear ? 2 : 0;
}

/** Blunt weapon groups (skeletons take full damage from these; half from edged/piercing). */
export const BLUNT_GROUPS = new Set(['mace', 'flail', 'hammer', 'morningStar', 'club', 'staff', 'sling']);

/** Is an ItemDef a silver(ed) weapon? (`silver: true`, or a silver id). */
export function isSilverWeapon(def) {
  return !!def && (def.silver === true || /silver/i.test(def.id ?? ''));
}

/** Is an ItemDef an edged or piercing weapon (not blunt)? Natural attacks count as not edged. */
export function isEdgedWeapon(def) {
  return !!def && def.type === 'weapon' && !BLUNT_GROUPS.has(def.weaponGroup ?? def.id);
}

/** Numeric argument of a monster tag ('magicToHit:1' → 1), or null when absent. */
export function tagValue(c, name) {
  const t = (monsterOf(c)?.special ?? []).find?.((x) => x === name || String(x).startsWith(`${name}:`));
  if (t === undefined) return null;
  const n = Number(String(t).split(':')[1]);
  return Number.isFinite(n) ? n : true;
}

/**
 * DMG: monsters strike creatures that need magic weapons as if armed with
 * +1 at 4+1 HD, +2 at 6+2, +3 at 8+3, +4 at 10+4.
 */
export function monsterHitPower(m) {
  const v = (m?.hd ?? 1) + (m?.hpBonus ?? 0) * 0.01;
  return v >= 10.04 ? 4 : v >= 8.03 ? 3 : v >= 6.02 ? 2 : v >= 4.01 ? 1 : 0;
}

/**
 * Weapon immunity of the defender against this attacker (MM): `magicToHit:N`
 * needs a +N weapon (shadows, spectres: +1); `silverToHit` needs silver or
 * any magic weapon (wights). Returns a log-ready reason, or null if the blow
 * can harm. `o.weaponMagic` / `o.weaponSilver` override the attacker's
 * (a bow from the pack).
 * @param {{weaponMagic?:number, weaponSilver?:boolean}} [o]
 */
export function weaponImmunity(attacker, defender, o = {}) {
  const needMagic = tagValue(defender, 'magicToHit');
  const needSilver = tagValue(defender, 'silverToHit');
  if (needMagic === null && needSilver === null) return null;
  const am = monsterOf(attacker);
  const magic = o.weaponMagic ?? attacker.weaponMagic ?? (am ? monsterHitPower(am) : 0);
  const silver = o.weaponSilver ?? attacker.weaponSilver ?? false;
  if (needMagic !== null && magic < (needMagic === true ? 1 : needMagic)) return `needs a +${needMagic === true ? 1 : needMagic} weapon`;
  if (needSilver !== null && !silver && magic < 1) return 'needs a silver or magic weapon';
  return null;
}

/**
 * Extra to-hit and damage from the attacker's weapon `magicVs` against this
 * defender (Sword +1, +3 vs undead → +2 more against a skeleton). Read from
 * `o.magicVs`, else the combatant's `magicVs` (combatantFromCharacter), else
 * a bare Character's equipped weapon. 0 for monsters and plain weapons.
 */
export function magicVsFor(attacker, defender, o = {}) {
  if (!attacker) return 0;
  let table = o.magicVs ?? attacker.magicVs;
  if (table === undefined && characterOf(attacker) === attacker) table = deriveStats(attacker).weaponMagicVs;
  return magicVsBonus(table, defender);
}

/**
 * A spell's attack roll — touch spells (Shocking Grasp, Cause Wounds, Cause
 * Blindness/Disease, Bestow Curse) and each blow of a Spiritual Hammer —
 * through the same defender pipeline as resolveAttack: the defender's live
 * AC (Shield, Prot. from Evil -2 vs an evil caster, racial AC vs giants),
 * Invisibility's and Blink's attacker penalties, Blink's 50% miss, Mirror
 * Image (a hit strikes and dispels an image instead, 1 chance in images+1 of
 * finding the real one), +4 against a helpless target, and the nat-20/nat-1
 * QoL rule (`o.strict1e` disables it).
 *
 * The caster's side is its own THAC0 plus effect bonuses (bless, prayer,
 * chant...); `o.str` adds the STR to-hit adjustment (a touch is a melee
 * blow; the hammer is not wielded, so it gets none). Weapon enchantment is
 * never added: PHB Spiritual Hammer "has no magical plusses whatsoever to
 * hit"; its `o.weaponMagic` counts only for weapon immunity (+1 at L1-6,
 * +2 at L7-12 strikes creatures hit only by such weapons) when
 * `o.weaponImmunity` is set.
 * @param {{str?:boolean, ranged?:boolean, weaponMagic?:number, weaponImmunity?:boolean, strict1e?:boolean, mods?:number}} [o]
 * @returns {{hit:boolean, roll:number, needed:number, image?:boolean, blinked?:boolean, immune?:boolean,
 *   weaponImmune?:string, crit?:boolean}}
 */
export function spellAttack(rng, caster, target, o = {}) {
  const ch = characterOf(caster);
  let thac0;
  let hit = o.mods ?? 0;
  if (ch) {
    const s = deriveStats(ch);
    thac0 = s.thac0;
    hit += s.mods.hit;
    if (o.str) hit += strengthTable(s.abilities.str, s.abilities.strPct).hit;
  } else {
    thac0 = caster.thac0 ?? monsterBaseThac0(monsterOf(caster));
    hit += (caster.hitBonus ?? 0) + effectMods(effectHost(caster)).hit;
  }
  const lm = liveMods(caster, target, { ranged: !!o.ranged, defenderOnly: true });
  const tch = characterOf(target);
  const baseAc = target.ac ?? (tch ? deriveStats(tch).ac : monsterOf(target)?.ac ?? 10);
  const helpless = isHelplessTarget(target);
  const needed = neededToHit(thac0, baseAc + lm.ac, hit + lm.hit + (helpless ? 4 : 0));
  if (lm.missChance && rng.int(1, 100) <= lm.missChance) return { hit: false, roll: 0, needed, blinked: true };
  const r = rng.die(20);
  let ok = r >= needed;
  if (!o.strict1e) {
    if (r === 20) ok = true;
    if (r === 1) ok = false;
  }
  if (!ok) return { hit: false, roll: r, needed };
  if (lm.images > 0) {
    const e = getEffect(effectHost(target), 'mirrorImage');
    if (e && rng.int(1, e.data.images + 1) > 1) {
      e.data.images--;
      if (e.data.images <= 0) e.rounds = 0;
      return { hit: false, roll: r, needed, image: true };
    }
  }
  if (o.weaponImmunity) {
    const wi = weaponImmunity(caster, target, { weaponMagic: o.weaponMagic ?? 0, weaponSilver: false });
    if (wi) return { hit: true, roll: r, needed, immune: true, weaponImmune: wi };
  }
  return { hit: true, roll: r, needed, crit: r === 20 };
}

/**
 * Resolve one attack. Natural 20 always hits, natural 1 always misses (modern QoL
 * house rule; set opts.strict1e to disable). Applies timed effects: bless/prayer,
 * shield, invisibility, blink (50% miss), mirror image (hits strike images),
 * protection from normal missiles, racial adjustments, and helpless targets
 * (see HelplessRule; opts.helpless picks it). Rear (+2) and backstab (+4,
 * instead of the rear bonus) come from situationalHit(opts) — pass them as
 * flags, never folded into opts.mods. Monster specials: weapon immunity
 * (magicToHit/silverToHit → `immune`, `weaponImmune` reason) and skeletons'
 * half damage from edged weapons (halfEdged).
 * @param {{mods?:number, dmgMod?:number, backstab?:boolean, backstabMult?:number, rear?:boolean,
 *   attackIndex?:number, ranged?:boolean, magicWeapon?:boolean, weaponMagic?:number, weaponSilver?:boolean,
 *   weaponEdged?:boolean, strict1e?:boolean, helpless?:HelplessRule, magicVs?:Record<string,number>}} [opts]
 *   `magicVs` overrides the attacker's weapon `magicVs` (a bow from the pack); see magicVsFor.
 * @returns {{roll:number, needed:number, hit:boolean, damage:number, killed:boolean, crit:boolean,
 *   image?:boolean, blinked?:boolean, immune?:boolean, weaponImmune?:string, auto?:boolean, coupDeGrace?:boolean,
 *   halved?:boolean}}
 */
export function resolveAttack(rng, attacker, defender, opts = {}) {
  // PHB concentration: a cleric who swings a weapon stops directing the
  // Spiritual Hammer / stops chanting (before the roll: no chant bonus on it).
  const broke = breakConcentration(effectHost(attacker));
  const r = attackRoll(rng, attacker, defender, opts);
  if (broke.length) r.concentrationBroken = broke;
  return r;
}

function attackRoll(rng, attacker, defender, opts) {
  const ranged = opts.ranged ?? !!attacker.ranged;
  const lm = liveMods(attacker, defender, { ranged, rear: !!(opts.rear || opts.backstab) });
  const helpless = isHelplessTarget(defender);
  const rule = opts.helpless ?? 'bonus';
  const autoHit = helpless && !ranged && (rule === 'auto' || rule === 'slay');
  const mv = magicVsFor(attacker, defender, opts);
  if (mv) {
    lm.dmg += mv;
    // The situational plus also counts against weapon immunity (a Mace +1,
    // +3 vs undead strikes a +3-only horror). Monsters keep their HD power.
    if (characterOf(attacker) || opts.weaponMagic != null || attacker.weaponMagic != null) {
      opts = { ...opts, weaponMagic: (opts.weaponMagic ?? attacker.weaponMagic ?? 0) + mv };
    }
  }
  const mods = situationalHit(opts) + (helpless ? 4 : 0) + (opts.mods ?? 0) + lm.hit + mv;
  const needed = autoHit ? 1 : neededToHit(attacker.thac0, defender.ac + lm.ac, (attacker.hitBonus ?? 0) + mods);
  onAttacked(effectHost(attacker));
  if (lm.missChance && rng.int(1, 100) <= lm.missChance) {
    return { roll: 0, needed, hit: false, damage: 0, killed: false, crit: false, blinked: true };
  }
  const r = rng.die(20);
  let hit = autoHit || r >= needed;
  if (!opts.strict1e && !autoHit) {
    if (r === 20) hit = true;
    if (r === 1) hit = false;
  }
  let damage = 0;
  let killed = false;
  if (hit && lm.images > 0) {
    const e = getEffect(effectHost(defender), 'mirrorImage');
    if (e && rng.int(1, e.data.images + 1) > 1) {
      e.data.images--;
      if (e.data.images <= 0) e.rounds = 0;
      return { roll: r, needed, hit: false, damage: 0, killed: false, crit: false, image: true };
    }
  }
  if (hit && ranged && lm.immune.has('normalMissiles') && !(opts.magicWeapon ?? attacker.magicWeapon)) {
    return { roll: r, needed, hit: true, damage: 0, killed: false, crit: r === 20, immune: true };
  }
  const wi = hit ? weaponImmunity(attacker, defender, opts) : null;
  if (wi) return { roll: r, needed, hit: true, damage: 0, killed: false, crit: false, immune: true, weaponImmune: wi };
  if (hit && autoHit && rule === 'slay') {
    // Coup de grace: a helpless foe is slain outright (party members to -10).
    damage = Math.max(1, defender.hp.cur + (characterOf(defender) ? 10 : 0));
    killed = dealDamage(defender, damage);
    return { roll: r, needed, hit: true, damage, killed, crit: false, auto: true, coupDeGrace: true };
  }
  let halved = false;
  if (hit) {
    const dice = defender.size === 'L' && attacker.attacksLarge ? attacker.attacksLarge : attacker.attacks[opts.attackIndex ?? 0] ?? attacker.attacks[0];
    damage = roll(rng, dice) + (attacker.dmgBonus ?? 0) + (opts.dmgMod ?? 0) + lm.dmg;
    if (lm.dmgMult) damage = Math.floor(damage * lm.dmgMult);
    damage = Math.max(1, damage);
    if (opts.backstab) damage *= opts.backstabMult ?? 2;
    // MM skeletons: edged and piercing weapons do half damage.
    if (tagValue(defender, 'halfEdged') !== null && (opts.weaponEdged ?? attacker.weaponEdged)) {
      damage = Math.max(1, Math.floor(damage / 2));
      halved = true;
    }
    killed = dealDamage(defender, damage);
  }
  return { roll: r, needed, hit, damage, killed, crit: r === 20 && !autoHit, ...(autoHit ? { auto: true } : {}), ...(halved ? { halved } : {}) };
}

/**
 * Probability (0..1) that one attack hits, with the nat-20/nat-1 house rule.
 * Uses the same modifier set as resolveAttack: pass `opts.rear` /
 * `opts.backstab` exactly as you pass them to resolveAttack.
 * @param {number} [mods] situational to-hit modifiers (long range, cover...) — not rear/backstab
 * @param {{ranged?:boolean, helpless?:HelplessRule, rear?:boolean, backstab?:boolean, strict1e?:boolean}} [opts]
 */
export function hitChance(attacker, defender, mods = 0, opts = {}) {
  const ranged = opts.ranged ?? !!attacker.ranged;
  const lm = liveMods(attacker, defender, { ranged, rear: !!(opts.rear || opts.backstab) });
  const helpless = isHelplessTarget(defender);
  const rule = opts.helpless ?? 'bonus';
  let p;
  if (helpless && !ranged && (rule === 'auto' || rule === 'slay')) p = 1;
  else {
    const mv = magicVsFor(attacker, defender, opts);
    const needed = neededToHit(attacker.thac0, defender.ac + lm.ac, (attacker.hitBonus ?? 0) + mods + situationalHit(opts) + (helpless ? 4 : 0) + lm.hit + mv);
    p = (21 - needed) / 20;
    p = opts.strict1e ? Math.max(0, Math.min(1, p)) : Math.max(0.05, Math.min(0.95, p));
  }
  if (lm.missChance) p *= 1 - lm.missChance / 100;
  if (lm.images) p *= 1 / (lm.images + 1);
  return p;
}


/**
 * Live attack rate (attacks per round, may be fractional) of a combatant,
 * computed now — so Haste or Slow cast mid-battle count at once.
 *  - characters: fighter 1 / 3/2 / 2 by level (deriveStats), or the missile
 *    rate of fire of `o.weapon` (a bow from the pack), × haste/slow;
 *  - monsters: attack routines per round (1 × haste/slow); see attacksFor.
 * @param {{weapon?:object}} [o]
 */
export function attackRateOf(c, o = {}) {
  const ch = characterOf(c);
  const mult = effectMods(effectHost(c)).attackMult;
  if (ch) {
    if (o.weapon) {
      const fl = activeFighterLevel(ch);
      const base = o.weapon.ranged ? rateOfFire(o.weapon) : fl ? fighterAttacksPerRound(fl) : 1;
      return base * mult;
    }
    return deriveStats(ch).attacks; // already × attackMult
  }
  return mult;
}

/** Fighter level whose abilities are usable now (a dormant dual-class fighter counts 0). */
function activeFighterLevel(ch) {
  return activeClasses(ch).includes('fighter') ? ch.levels?.fighter ?? 0 : 0;
}

/**
 * The single source of truth for how many attacks a combatant makes this
 * round. Fighters at 3/2 alternate 1 and 2 (round parity); hasted creatures
 * double, slowed ones halve (a slowed orc swings every other round). A
 * monster's count is routines × the attacks in its routine (claw/claw/bite).
 * @param {number} [round] 1-based combat round
 * @param {{weapon?:object}} [o]
 */
export function attacksFor(c, round = 1, o = {}) {
  const rate = attackRateOf(c, o);
  if (characterOf(c)) return attacksThisRound(rate, round);
  return attacksThisRound(rate, round) * Math.max(1, c.attacks?.length ?? 1);
}

/**
 * Fighters attack creatures of less than one full HD (kobolds, giant rats,
 * 1-1 HD goblins) once per fighter level each round (1e/Gold Box "sweep").
 * `target` is a creature, or a number of hit dice (back-compat).
 * Returns the number of attacks vs such a target (0 = no sweep).
 */
export function sweepAttacks(ch, target) {
  const lvl = activeFighterLevel(ch);
  const small = typeof target === 'number' ? target < 1 : belowOneHd(target);
  if (!lvl || !small) return 0;
  return Math.max(fighterAttacksPerRound(lvl), lvl);
}

/** MM energy drain per hit when the tag gives no number. */
export const DRAIN_LEVELS = Object.freeze({ wight: 1, spectre: 2, wraith: 1, vampire: 2 });

/**
 * Monster special attacks that ride on a successful hit (MM): ghoul/ghast
 * paralysis (save vs paralysis, 3d4 rounds; elves are immune to the ghoul's
 * touch but not the ghast's), poison (save vs
 * poison; giant centipedes' weak venom at +4), giant rat disease (5%, save vs
 * poison), energy drain (`drainLevel`, see DRAIN_LEVELS), shadow strength
 * drain (`drainStr`). Returns log-ready outcomes; effects are applied to the defender.
 * @returns {{kind:string, saved:boolean, text:string}[]}
 */
export function onHitSpecials(rng, attacker, defender) {
  const m = monsterOf(attacker);
  const out = [];
  if (!m || isDown(defender)) return out;
  const special = m.special ?? [];
  const host = effectHost(defender);
  const dname = defender.name ?? characterOf(defender)?.name ?? 'the victim';
  if (special.includes('paralyze') && !hasEffect(host, 'paralyzed')) {
    // MM: elves are immune to the ghoul's touch only — a ghast paralyzes even elves.
    const ghoulish = special.includes('paralyzeNoElf') || (m.turnAs ?? m.id) === 'ghoul';
    const elf = ghoulish && characterOf(defender)?.race === 'elf';
    if (elf) out.push({ kind: 'paralyze', saved: true, text: `${dname} shrugs off the ghoulish touch.` });
    else {
      const sv = savingThrow(rng, defender, 'ppdm');
      if (!sv.saved) {
        addEffect(host, 'paralyzed', { rounds: roll(rng, '3d4'), source: m.id });
        out.push({ kind: 'paralyze', saved: false, text: `${dname} is paralyzed!` });
      } else out.push({ kind: 'paralyze', saved: true, text: `${dname} resists the paralysis.` });
    }
  }
  if (special.includes('poison') && !hasEffect(host, 'poisoned')) {
    const r = poison(rng, defender, { saveMod: m.poisonSave ?? (m.id === 'giantCentipede' ? 4 : 0), onset: m.poisonOnset ?? 10 });
    out.push({ kind: 'poison', saved: r.saved, text: r.saved ? `${dname} resists the venom.` : `${dname} is poisoned!` });
  }
  // Energy drain (wight 1 level, spectre 2; 'drainLevel:N' overrides). No save in 1e.
  const drain = tagValue(attacker, 'drainLevel');
  const dch = characterOf(defender);
  if (drain !== null && dch) {
    const n = drain === true ? (DRAIN_LEVELS[m.id] ?? 1) : drain;
    const r = drainLevel(dch, n);
    trimMemorized(dch);
    out.push({ kind: 'drainLevel', saved: false, levels: r.drained.length, died: r.died,
      text: r.died ? `${dname}'s life is drained away!` : `${dname} loses ${r.drained.length > 1 ? `${r.drained.length} levels` : 'a level'} to the chill touch!` });
  }
  // Shadow: each hit drains 1 STR for 2d4 turns; at 0 STR the victim dies (MM).
  if (tagValue(attacker, 'drainStr') !== null && dch) {
    const e = getEffect(host, 'strDrain');
    const pts = (e?.data?.points ?? 0) + 1;
    const rounds = roll(rng, '2d4') * 10;
    const fx = addEffect(host, 'strDrain', { rounds, source: m.id, data: { points: pts } });
    fx.mods = { strDrain: pts };
    fx.data.points = pts;
    const str = effectiveAbilities(dch).str;
    if (str <= 0) {
      dch.status = 'dead';
      dch.hp.cur = Math.min(dch.hp.cur, -10);
      out.push({ kind: 'drainStr', saved: false, died: true, text: `${dname} withers into a shadow!` });
    } else out.push({ kind: 'drainStr', saved: false, text: `${dname} feels strength ebb away (STR ${str}).` });
  }
  if (special.includes('disease') && !hasEffect(host, 'diseased') && rng.int(1, 100) <= 5) {
    const sv = savingThrow(rng, defender, 'ppdm', 0, { poison: true });
    if (!sv.saved) {
      addEffect(host, 'diseased', { rounds: Infinity, source: m.id });
      out.push({ kind: 'disease', saved: false, text: `${dname} is infected by the filthy bite.` });
    }
  }
  return out;
}

/**
 * AD&D 1e Turn Undead matrix, re-exported from classes.js for compatibility.
 * See classes.js TURN_UNDEAD / turnNeeded for the table.
 */
export { TURN_UNDEAD } from './classes.js';

/**
 * Attempt to turn one class of undead. Returns what happened; the caller picks
 * which creatures are affected (2d6 of them, nearest first; d6+6 on 'D*').
 * @returns {{result:'none'|'fail'|'turned'|'destroyed', roll:number|null, needed:number|string, count:number}}
 */
export function turnUndead(rng, clericLevel, undeadType) {
  const v = turnNeeded(clericLevel, undeadType);
  if (v === '-') return { result: 'none', roll: null, needed: v, count: 0 };
  if (v === 'T') return { result: 'turned', roll: null, needed: v, count: roll(rng, '2d6') };
  if (v === 'D') return { result: 'destroyed', roll: null, needed: v, count: roll(rng, '2d6') };
  if (v === 'D*') return { result: 'destroyed', roll: null, needed: v, count: roll(rng, '1d6+6') };
  const r = rng.die(20);
  const count = roll(rng, '2d6');
  return { result: r >= v ? 'turned' : 'fail', roll: r, needed: v, count: r >= v ? count : 0 };
}

/** Apply damage to a combatant; returns true if it went down. */
export function dealDamage(c, dmg) {
  if (c.side === 'party' && c.ref?.classSpec) {
    applyDamage(c.ref, dmg);
  } else {
    c.hp.cur -= dmg;
    if (dmg > 0) onDamaged(c);
    if (c.hp.cur <= 0) c.status = 'dead';
  }
  return isDown(c);
}

/**
 * Saving throw: d20 + bonus >= target (lower target = better). Includes live
 * effects (prayer, bless of the dwarves...), and optional situational options
 * (see saves.js rollSave: mental, dodge, poison, element, source). Pass
 * `{poison:true}` only for poison (venom, stinking cloud, stench, disease):
 * the dwarf/halfling CON bonus applies to poison, not to paralysis.
 */
export function savingThrow(rng, combatant, saveKey, bonus = 0, o = {}) {
  // One path for everyone: savesOf folds in the creature's own save mods
  // (bless, prayer, chant...), saveBonus the situational ones (element vs
  // Resist Fire/Cold, source vs Protection from Evil/Good, WIS/DEX/racial).
  return rollSave(rng, combatant, saveKey, { ...o, bonus });
}

/**
 * Poison (1e): save vs poison or suffer. Default mode 'deadly' marks the
 * victim poisoned — fatal after `onset` rounds unless slow/neutralize poison.
 * 'damage' mode (QoL option) deals `damage` dice instead.
 * @returns {{saved:boolean, roll:number, target:number, damage?:number}}
 */
export function poison(rng, target, { saveMod = 0, mode = 'deadly', onset = 10, damage = '2d6' } = {}) {
  const sv = savingThrow(rng, target, 'ppdm', saveMod, { poison: true });
  if (sv.saved) return { saved: true, roll: sv.roll, target: sv.target };
  if (mode === 'damage') {
    const d = roll(rng, damage);
    dealDamage(target, d);
    return { saved: false, roll: sv.roll, target: sv.target, damage: d };
  }
  addEffect(effectHost(target), 'poisoned', { rounds: Infinity, source: 'poison', data: { onset } });
  return { saved: false, roll: sv.roll, target: sv.target };
}

/**
 * End-of-round upkeep for one combatant: bleeding (dying party members lose
 * 1 hp), poison countdown, and timed effects. Returns what happened.
 * @returns {{bled:boolean, died:boolean, expired:string[], poisonDeath:boolean}}
 */
export function endOfRound(c) {
  const host = effectHost(c);
  const out = { bled: false, died: false, expired: [], poisonDeath: false };
  const ch = characterOf(c);
  if (ch) {
    out.bled = bleed(ch);
    if (out.bled && ch.status === 'dead') out.died = true;
  }
  const p = tickPoison(host, 1);
  if (p.lethal) {
    if (ch) { ch.status = 'dead'; ch.hp.cur = Math.min(ch.hp.cur, -10); } else { c.hp.cur = 0; c.status = 'dead'; }
    out.died = out.poisonDeath = true;
  }
  out.expired.push(...tickEffects(host, 1));
  return out;
}

/** After battle: strip combat-only effects from every party Character. */
export function endCombat(party) {
  for (const c of party) clearCombatEffects(effectHost(c));
}

/**
 * Surprise (1e): each side is surprised on 1-2 on d6 (modifiers lower/raise:
 * monsterMod −2 = monsters surprised on 1-4). Pass `party` (Characters) to
 * add the racial modifiers of explore.surpriseMods (elves and halflings in
 * non-metal armour surprise others 4 in 6), and `scout` for one scouting ahead.
 * @param {{partyMod?:number, monsterMod?:number, party?:object[], scout?:object}} [o]
 * @returns {{party:boolean, monsters:boolean, rounds:number}}
 */
export function rollSurprise(rng, { partyMod = 0, monsterMod = 0, party = null, scout = null } = {}) {
  if (party || scout) {
    const r = surpriseMods(party ?? [], scout ? { scout } : {});
    partyMod += r.partyMod;
    monsterMod += r.monsterMod;
  }
  const p = rng.die(6) + partyMod <= 2;
  const m = rng.die(6) + monsterMod <= 2;
  return { party: p && !m, monsters: m && !p, rounds: p !== m ? 1 : 0 };
}

/** Sum XP of defeated monsters. */
export function xpForVictory(monsters) {
  return monsters.filter((m) => isDown(m)).reduce((t, m) => t + m.xp, 0);
}

/** Simple morale check (1e-ish): d100 > morale → flees. Returns true if it holds. */
export function moraleCheck(rng, monster, penalty = 0) {
  return rng.int(1, 100) <= (monster.ref.morale ?? 50) - penalty;
}

/**
 * Headless auto-battle used by the QUICK command, tests and the combat placeholder.
 * Everyone melee-attacks the first living enemy. Returns a log and the outcome.
 * @returns {{winner:'party'|'monster'|'draw', rounds:number, log:string[]}}
 */
export function autoResolve(rng, party, monsters, maxRounds = 30) {
  const log = [];
  const all = [...party, ...monsters];
  let round = 0;
  const alive = (side) => all.filter((c) => c.side === side && !isDown(c));
  while (round < maxRounds && alive('party').length && alive('monster').length) {
    round++;
    for (const actor of rollInitiative(rng, all)) {
      if (!canAct(actor)) continue;
      const foes = alive(actor.side === 'party' ? 'monster' : 'party');
      if (!foes.length) break;
      const target = foes[0];
      const n = actor.ref?.classSpec ? Math.max(attacksFor(actor, round), sweepAttacks(actor.ref, target)) : attacksFor(actor, round);
      for (let i = 0; i < n; i++) {
        const tgt = isDown(target) ? alive(actor.side === 'party' ? 'monster' : 'party')[0] : target;
        if (!tgt) break;
        const r = resolveAttack(rng, actor, tgt, { attackIndex: i % actor.attacks.length });
        log.push(r.hit ? `${actor.name} hits ${tgt.name} for ${r.damage}.${r.killed ? ` ${tgt.name} is down!` : ''}` : `${actor.name} misses ${tgt.name}.`);
      }
    }
    for (const c of all) if (!isDown(c) || c.status === 'dying') endOfRound(c);
  }
  const winner = alive('party').length && !alive('monster').length ? 'party' : !alive('party').length ? 'monster' : 'draw';
  return { winner, rounds: round, log };
}
