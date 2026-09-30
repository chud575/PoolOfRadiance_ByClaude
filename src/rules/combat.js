import { roll } from './dice.js';
import { deriveStats, applyDamage, isConscious } from './character.js';
import { dexterityMods } from './abilities.js';
import { monsterSaves } from './classes.js';
import { MONSTERS } from '../data/monsters.js';

/**
 * Combat rules core, renderer-agnostic. The Combat scene owns positions,
 * movement, AI and presentation; it calls into these for resolution.
 *
 * @typedef {Object} Combatant
 * @property {string} id
 * @property {'party'|'monster'} side
 * @property {string} name
 * @property {number} thac0
 * @property {number} ac
 * @property {number} hitBonus
 * @property {number} dmgBonus
 * @property {string[]} attacks        damage dice per attack
 * @property {'S'|'M'|'L'} size
 * @property {{cur:number,max:number}} hp
 * @property {number} move             squares per round
 * @property {number} initMod          added to initiative roll
 * @property {Record<string,number>} saves
 * @property {string} status
 * @property {string[]} conditions
 * @property {number} xp               xp value when defeated (monsters)
 * @property {object} ref              the underlying Character or monster def
 * @property {string} [monsterId]
 * @property {number} [x]  @property {number} [y]  @property {number} [facing]   owned by combat scene
 */

/** Build a combatant from a party Character (shares hp object → damage persists). */
export function combatantFromCharacter(ch) {
  const s = deriveStats(ch);
  return {
    id: ch.id,
    side: 'party',
    name: ch.name,
    thac0: s.thac0,
    ac: s.ac,
    hitBonus: s.hitBonus,
    dmgBonus: s.dmgBonus,
    attacks: Array(Math.max(1, Math.floor(s.attacks))).fill(s.damage),
    attacksLarge: s.damageLarge,
    ranged: !!s.weapon?.ranged,
    range: s.weapon?.range ?? 1,
    size: 'M',
    hp: ch.hp,
    move: Math.round(s.move / 2) + 1,
    initMod: dexterityMods(ch.abilities.dex).reaction,
    saves: s.saves,
    get status() { return ch.status; },
    set status(v) { ch.status = v; },
    conditions: ch.conditions,
    xp: 0,
    ref: ch,
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
    saves: monsterSaves(m.hd),
    status: 'ok',
    conditions: [],
    xp: m.xp,
    ref: m,
    monsterId,
  };
}

/**
 * Roll initiative for all living combatants: d10 + initMod, higher acts first;
 * ties broken by initMod then by side (party first) for readability.
 * @returns {Combatant[]} new array in acting order
 */
export function rollInitiative(rng, combatants) {
  const rolled = combatants
    .filter((c) => canAct(c))
    .map((c) => ({ c, init: rng.die(10) + c.initMod }));
  rolled.sort((a, b) => b.init - a.init || b.c.initMod - a.c.initMod || (a.c.side === 'party' ? -1 : 1));
  for (const r of rolled) r.c.initiative = r.init;
  return rolled.map((r) => r.c);
}

export function canAct(c) {
  if (c.side === 'party') return isConscious(c.ref) && !c.conditions.includes('asleep') && !c.conditions.includes('held');
  return c.status === 'ok' && c.hp.cur > 0 && !c.conditions.includes('asleep') && !c.conditions.includes('held');
}

export function isDown(c) {
  return c.hp.cur <= 0 || ['dead', 'dying', 'unconscious', 'fled', 'stoned'].includes(c.status);
}

/** Number needed on d20 to hit. */
export function toHitNeeded(attacker, defender, mods = 0) {
  return attacker.thac0 - defender.ac - attacker.hitBonus - mods;
}

/**
 * Resolve one attack. Natural 20 always hits, natural 1 always misses (modern QoL
 * house rule; set opts.strict1e to disable).
 * @returns {{roll:number, needed:number, hit:boolean, damage:number, killed:boolean, crit:boolean}}
 */
export function resolveAttack(rng, attacker, defender, opts = {}) {
  const mods = (opts.backstab ? 4 : 0) + (opts.rear ? 2 : 0) + (defender.conditions?.includes('asleep') || defender.conditions?.includes('held') ? 4 : 0) + (opts.mods ?? 0);
  const needed = toHitNeeded(attacker, defender, mods);
  const r = rng.die(20);
  let hit = r >= needed;
  if (!opts.strict1e) {
    if (r === 20) hit = true;
    if (r === 1) hit = false;
  }
  let damage = 0;
  let killed = false;
  if (hit) {
    const dice = defender.size === 'L' && attacker.attacksLarge ? attacker.attacksLarge : attacker.attacks[opts.attackIndex ?? 0];
    damage = Math.max(1, roll(rng, dice) + attacker.dmgBonus);
    if (opts.backstab) damage *= opts.backstabMult ?? 2;
    killed = dealDamage(defender, damage);
  }
  return { roll: r, needed, hit, damage, killed, crit: r === 20 };
}

/** Apply damage to a combatant; returns true if it went down. */
export function dealDamage(c, dmg) {
  if (c.side === 'party') {
    applyDamage(c.ref, dmg);
  } else {
    c.hp.cur -= dmg;
    if (c.hp.cur <= 0) c.status = 'dead';
  }
  return isDown(c);
}

/** Saving throw: d20 >= target (lower target = better). */
export function savingThrow(rng, combatant, saveKey, bonus = 0) {
  const target = combatant.saves[saveKey];
  const r = rng.die(20);
  return { roll: r, target, saved: r + bonus >= target };
}

/** Sum XP of defeated monsters. */
export function xpForVictory(monsters) {
  return monsters.filter((m) => isDown(m)).reduce((t, m) => t + m.xp, 0);
}

/** Simple morale check (1e-ish): d100 > morale → flees. */
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
      for (let i = 0; i < actor.attacks.length; i++) {
        if (isDown(target)) break;
        const r = resolveAttack(rng, actor, target, { attackIndex: i });
        log.push(r.hit ? `${actor.name} hits ${target.name} for ${r.damage}.${r.killed ? ` ${target.name} is down!` : ''}` : `${actor.name} misses ${target.name}.`);
      }
    }
  }
  const winner = alive('party').length && !alive('monster').length ? 'party' : !alive('party').length ? 'monster' : 'draw';
  return { winner, rounds: round, log };
}
