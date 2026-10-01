import { roll } from './dice.js';
import { deriveStats, applyDamage, isConscious, bleed } from './character.js';
import { dexterityMods, strengthTable } from './abilities.js';
import { monsterSaves, turnNeeded, fighterAttacksPerRound, attacksThisRound } from './classes.js';
import { MONSTERS } from '../data/monsters.js';
import {
  effectMods, isIncapacitated, isHelpless, onDamaged, onAttacked, addEffect, hasEffect, getEffect,
  clearCombatEffects,
} from './conditions.js';
import { neededToHit } from './tohit.js';
import { isEvil, isGood, effectHost, characterOf, racialCombatMods, belowOneHd, monsterOf } from './creature.js';
import { rateOfFire } from './items.js';
import { rollSave } from './saves.js';

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
    acRear: s.acRear,
    hitBonus: s.hitBonus,
    dmgBonus: s.dmgBonus,
    attacks: [s.damage],
    attackRate: s.attacks,
    attacksLarge: s.damageLarge,
    ranged: !!s.weapon?.ranged,
    range: s.weapon?.range ?? 1,
    magicWeapon: s.weaponMagic > 0,
    size: 'M',
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
      ac: s.ac, acMissile: s.acMissile, fxHit: s.mods.hit, fxDmg: s.mods.dmg,
      strHit: strengthTable(s.abilities.str, s.abilities.strPct).hit, strDmg: strengthTable(s.abilities.str, s.abilities.strPct).dmg,
    },
  };
}

let _mId = 0;
/** Build a combatant for a monster id, rolling its HP. */
export function combatantFromMonster(rng, monsterId, index = 0) {
  const m = MONSTERS[monsterId];
  if (!m) throw new Error(`Unknown monster ${monsterId}`);
  const hp = m.hd < 1 ? rng.int(1, 4) : roll(rng, `${m.hd}d8`) + (m.hpBonus ?? 0);
  return {
    id: `m${++_mId}_${monsterId}`,
    side: 'monster',
    name: index ? `${m.name} ${index}` : m.name,
    thac0: m.thac0,
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
    saves: monsterSaves(m.hd, m.hpBonus ?? 0),
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
  rolled.sort((a, b) => b.init - a.init || b.c.initMod - a.c.initMod || (a.c.side === 'party' ? -1 : 1));
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
export function liveMods(attacker, defender, { ranged = false } = {}) {
  const aHost = effectHost(attacker);
  const dHost = effectHost(defender);
  const out = { hit: 0, dmg: 0, ac: 0, missChance: 0, images: 0, immune: new Set() };
  // Attacker's own to-hit/damage adjustments.
  if (characterOf(attacker) && attacker.snap) {
    // Only the part that came from effects since the combatant was built.
    const s = deriveStats(characterOf(attacker));
    const st = strengthTable(s.abilities.str, s.abilities.strPct);
    out.hit += s.mods.hit - attacker.snap.fxHit + (ranged ? 0 : st.hit - attacker.snap.strHit);
    out.dmg += s.mods.dmg - attacker.snap.fxDmg + (ranged ? 0 : st.dmg - attacker.snap.strDmg);
  } else if (!characterOf(attacker)) {
    const fx = effectMods(aHost);
    out.hit += fx.hit;
    out.dmg += fx.dmg;
    if (fx.strLossPct) out.dmgMult = 1 - fx.strLossPct / 100;
  }
  // Racial adjustments (dwarf/gnome vs giants, orcs, goblins...).
  const rac = racialCombatMods(attacker, defender);
  out.hit += rac.hit;
  out.ac += rac.ac;
  // Defender.
  const dfx = effectMods(dHost);
  if (characterOf(defender) && defender.snap) {
    const s = deriveStats(characterOf(defender));
    out.ac += (ranged ? s.acMissile - defender.snap.acMissile : s.ac - defender.snap.ac);
  } else if (!characterOf(defender)) {
    let ac = defender.ac + dfx.ac;
    const cap = ranged ? dfx.acVsMissile : dfx.acVsMelee;
    if (cap != null) ac = Math.min(ac, cap);
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
 * Resolve one attack. Natural 20 always hits, natural 1 always misses (modern QoL
 * house rule; set opts.strict1e to disable). Applies timed effects: bless/prayer,
 * shield, invisibility, blink (50% miss), mirror image (hits strike images),
 * protection from normal missiles, racial adjustments, and helpless targets
 * (see HelplessRule; opts.helpless picks it).
 * @param {{mods?:number, dmgMod?:number, backstab?:boolean, backstabMult?:number, rear?:boolean,
 *   attackIndex?:number, ranged?:boolean, magicWeapon?:boolean, strict1e?:boolean, helpless?:HelplessRule}} [opts]
 * @returns {{roll:number, needed:number, hit:boolean, damage:number, killed:boolean, crit:boolean,
 *   image?:boolean, blinked?:boolean, immune?:boolean, auto?:boolean, coupDeGrace?:boolean}}
 */
export function resolveAttack(rng, attacker, defender, opts = {}) {
  const ranged = opts.ranged ?? !!attacker.ranged;
  const lm = liveMods(attacker, defender, { ranged });
  const helpless = isHelplessTarget(defender);
  const rule = opts.helpless ?? 'bonus';
  const autoHit = helpless && !ranged && (rule === 'auto' || rule === 'slay');
  const mods = (opts.backstab ? 4 : 0) + (opts.rear ? 2 : 0) + (helpless ? 4 : 0) + (opts.mods ?? 0) + lm.hit;
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
  if (hit && autoHit && rule === 'slay') {
    // Coup de grace: a helpless foe is slain outright (party members to -10).
    damage = Math.max(1, defender.hp.cur + (characterOf(defender) ? 10 : 0));
    killed = dealDamage(defender, damage);
    return { roll: r, needed, hit: true, damage, killed, crit: false, auto: true, coupDeGrace: true };
  }
  if (hit) {
    const dice = defender.size === 'L' && attacker.attacksLarge ? attacker.attacksLarge : attacker.attacks[opts.attackIndex ?? 0] ?? attacker.attacks[0];
    damage = roll(rng, dice) + (attacker.dmgBonus ?? 0) + (opts.dmgMod ?? 0) + lm.dmg;
    if (lm.dmgMult) damage = Math.floor(damage * lm.dmgMult);
    damage = Math.max(1, damage);
    if (opts.backstab) damage *= opts.backstabMult ?? 2;
    killed = dealDamage(defender, damage);
  }
  return { roll: r, needed, hit, damage, killed, crit: r === 20 && !autoHit, ...(autoHit ? { auto: true } : {}) };
}

/**
 * Probability (0..1) that one attack hits, with the nat-20/nat-1 house rule.
 * @param {number} [mods] situational to-hit modifiers (rear, bless, cover...)
 */
export function hitChance(attacker, defender, mods = 0, opts = {}) {
  const ranged = opts.ranged ?? !!attacker.ranged;
  const lm = liveMods(attacker, defender, { ranged });
  const helpless = isHelplessTarget(defender);
  const rule = opts.helpless ?? 'bonus';
  let p;
  if (helpless && !ranged && (rule === 'auto' || rule === 'slay')) p = 1;
  else {
    const needed = neededToHit(attacker.thac0, defender.ac + lm.ac, (attacker.hitBonus ?? 0) + mods + (helpless ? 4 : 0) + lm.hit);
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

function activeFighterLevel(ch) {
  return ch.classSpec.split('/').includes('fighter') || ch.dual?.from === 'fighter' ? ch.levels?.fighter ?? 0 : 0;
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
  const lvl = ch.levels?.fighter ?? 0;
  const small = typeof target === 'number' ? target < 1 : belowOneHd(target);
  if (!lvl || !small) return 0;
  return Math.max(fighterAttacksPerRound(lvl), lvl);
}

/**
 * Monster special attacks that ride on a successful hit (MM): ghoul/ghast
 * paralysis (save vs paralysis, elves immune, 3d4 rounds), poison (save vs
 * poison; giant centipedes' weak venom at +4), giant rat disease (5%, save vs
 * poison). Returns log-ready outcomes; effects are applied to the defender.
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
    const elf = characterOf(defender)?.race === 'elf';
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
  if (special.includes('disease') && !hasEffect(host, 'diseased') && rng.int(1, 100) <= 5) {
    const sv = savingThrow(rng, defender, 'ppdm');
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
 * (see saves.js rollSave: mental, dodge, element, source).
 */
export function savingThrow(rng, combatant, saveKey, bonus = 0, o = {}) {
  if (combatant.ref?.classSpec || !combatant.saves) return rollSave(rng, combatant, saveKey, { ...o, bonus });
  const fx = effectMods(effectHost(combatant));
  const target = Math.max(2, combatant.saves[saveKey] - fx.save - (fx.saveVs[saveKey] ?? 0));
  const r = rng.die(20);
  return { roll: r, target, saved: r + bonus >= target };
}

/**
 * Poison (1e): save vs poison or suffer. Default mode 'deadly' marks the
 * victim poisoned — fatal after `onset` rounds unless slow/neutralize poison.
 * 'damage' mode (QoL option) deals `damage` dice instead.
 * @returns {{saved:boolean, roll:number, target:number, damage?:number}}
 */
export function poison(rng, target, { saveMod = 0, mode = 'deadly', onset = 10, damage = '2d6' } = {}) {
  const sv = savingThrow(rng, target, 'ppdm', saveMod);
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
  const p = getEffect(host, 'poisoned');
  if (p && !hasEffect(host, 'slowPoison')) {
    p.data = { ...(p.data ?? {}), onset: (p.data?.onset ?? 10) - 1 };
    if (p.data.onset <= 0) {
      if (ch) { ch.status = 'dead'; ch.hp.cur = Math.min(ch.hp.cur, -10); } else { c.hp.cur = 0; c.status = 'dead'; }
      out.died = out.poisonDeath = true;
    }
  }
  for (const e of [...(host.effects ?? [])]) {
    if (e.rounds === Infinity) continue;
    e.rounds -= 1;
    if (e.rounds <= 0) {
      host.effects.splice(host.effects.indexOf(e), 1);
      const i = host.conditions?.indexOf(e.id) ?? -1;
      if (i >= 0) host.conditions.splice(i, 1);
      out.expired.push(e.id);
    }
  }
  return out;
}

/** After battle: strip combat-only effects from every party Character. */
export function endCombat(party) {
  for (const c of party) clearCombatEffects(effectHost(c));
}

/**
 * Surprise (1e): each side is surprised on 1-2 on d6 (modifiers lower/raise).
 * @returns {{party:boolean, monsters:boolean, rounds:number}}
 */
export function rollSurprise(rng, { partyMod = 0, monsterMod = 0 } = {}) {
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
