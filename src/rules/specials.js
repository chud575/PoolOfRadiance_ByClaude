import { roll } from './dice.js';
import { addEffect, effectMods, hasEffect } from './conditions.js';
import {
  characterOf, monsterOf, nameOf, effectHost, acOf, attackOf, levelOf, hitDiceOf, damageCreature,
  isDownCreature, isAliveCreature, racialCombatMods, isUndead, hasTag,
} from './creature.js';
import { rollSave } from './saves.js';
import { neededToHit } from './tohit.js';

/**
 * Monster special abilities that are *actions* rather than on-hit riders:
 * dragon breath, giant rock throwing, a dragon's fear aura and troll
 * regeneration — plus SPECIAL_HANDLERS, the registry that names the rule
 * behind every `special` tag a MonsterDef may carry (tests assert every tag
 * in data/monsters.js has one).
 *
 * All functions are pure rules over creatures (Character, Combatant or a bare
 * monster record); geometry (which squares a breath covers) stays with the
 * caller, which passes the creatures caught in the template.
 */

/**
 * Breath weapons by element (MM dragons). Shapes in battle squares (1 square
 * = 10'): a bronze dragon's lightning is a 10" x ½" stroke → a 10-square line.
 * `uses` per day (MM: three times a day).
 */
export const BREATH_WEAPONS = Object.freeze({
  lightning: { element: 'electricity', shape: 'line', size: 10, uses: 3, verb: 'A stroke of lightning' },
  fire: { element: 'fire', shape: 'cone', size: 9, uses: 3, verb: 'A gout of flame' },
  cold: { element: 'cold', shape: 'cone', size: 7, uses: 3, verb: 'A blast of frost' },
  acid: { element: 'acid', shape: 'line', size: 6, uses: 3, verb: 'A spray of acid' },
  gas: { element: 'poison', shape: 'cloud', size: 3, uses: 3, verb: 'A cloud of choking gas' },
});

/** Element of a creature's breath from its `breath:<element>` tag, or null. */
export function breathOf(c) {
  const tag = (monsterOf(c)?.special ?? []).map(String).find((t) => t.startsWith('breath:'));
  if (!tag) return null;
  const element = tag.slice(7);
  return { kind: element, ...(BREATH_WEAPONS[element] ?? { element, shape: 'line', size: 6, uses: 3, verb: 'A breath' }) };
}

/** Breaths left today (combatants track `breathUsed`). */
export function breathsLeft(c) {
  const b = breathOf(c);
  return b ? Math.max(0, b.uses - (c.breathUsed ?? 0)) : 0;
}

function elementMult(t, element) {
  if (!element) return 1;
  const host = effectHost(t);
  const fx = effectMods(host).resist[element] ?? 1;
  const res = monsterOf(t)?.resist?.[element] ?? 1;
  return fx * res;
}

/**
 * DMG dragon breath: damage equals the dragon's *current* hit points (or
 * `damage` — a number or dice), each victim saves vs Breath Weapon ('bw')
 * for half; element resistance (Resist Fire/Cold, monster `resist`) then
 * applies, and element save bonuses (+3 vs fire under Resist Fire) count.
 * Spends one use (`attacker.breathUsed`). The breather is not harmed.
 * @param {import('./dice.js').Rng} rng
 * @param {object} attacker
 * @param {object[]} targets  creatures in the template (caller's geometry)
 * @param {{element?:string, damage?:number|string}} [o]
 * @returns {{ok:boolean, reason?:string, damage:number, element:string|null,
 *   results:{target:object, name:string, saved:boolean, save:{roll:number,target:number}, damage:number, down:boolean}[], log:string[]}}
 */
export function breathWeapon(rng, attacker, targets, o = {}) {
  const b = breathOf(attacker);
  const element = o.element ?? b?.element ?? null;
  const out = { ok: true, damage: 0, element, results: [], log: [] };
  if (!isAliveCreature(attacker) || isDownCreature(attacker)) return { ...out, ok: false, reason: 'cannot breathe' };
  if (b && o.damage === undefined && breathsLeft(attacker) <= 0) return { ...out, ok: false, reason: 'no breath left' };
  const hp = attacker.hp?.cur ?? characterOf(attacker)?.hp.cur ?? 1;
  const full = o.damage === undefined ? Math.max(1, hp) : typeof o.damage === 'number' ? o.damage : roll(rng, o.damage);
  out.damage = full;
  if (b) attacker.breathUsed = (attacker.breathUsed ?? 0) + 1;
  out.log.push(`${b?.verb ?? 'A blast'} roars from ${nameOf(attacker)}!`);
  for (const t of targets) {
    if (!t || t === attacker || !isAliveCreature(t)) continue;
    const sv = rollSave(rng, t, 'bw', { element, source: attacker });
    let dmg = sv.saved ? Math.floor(full / 2) : full;
    dmg = Math.max(0, Math.floor(dmg * elementMult(t, element)));
    const wasDown = isDownCreature(t);
    const down = damageCreature(t, dmg) && !wasDown;
    const name = nameOf(t);
    out.results.push({ target: t, name, saved: sv.saved, save: { roll: sv.roll, target: sv.target }, damage: dmg, down });
    out.log.push(`${name} ${sv.saved ? 'dodges partly and ' : ''}takes ${dmg}.${down ? ` ${name} ${characterOf(t) ? 'is down' : 'is slain'}!` : ''}`);
  }
  return out;
}

/** MM hill giant: hurls rocks for 2d8 out to 20" (20 squares), not at point-blank (adjacent foes are clubbed). */
export const ROCK_THROW = Object.freeze({ damage: '2d8', range: 20, minRange: 2 });

/** Can this creature throw rocks (`throwRocks` tag)? */
export function throwsRocks(c) {
  return (monsterOf(c)?.special ?? []).includes('throwRocks');
}

/**
 * A giant's thrown boulder (MM): a missile attack with the giant's THAC0
 * against the target's missile AC — Shield's AC 2 vs missiles, invisibility
 * and blink count; dwarves and gnomes are -4 to hit for giants (PHB) — for
 * 2d8 damage. Protection from Normal Missiles does *not* stop boulders (PHB).
 * Natural 20 hits, natural 1 misses.
 * @param {{distance?:number, damage?:string}} [o] distance in squares (refused outside 2..20)
 * @returns {{ok:boolean, reason?:string, hit:boolean, roll:number, needed:number, damage:number, down:boolean, text:string}}
 */
export function throwRocks(rng, attacker, target, o = {}) {
  const name = nameOf(target);
  const base = { ok: true, hit: false, roll: 0, needed: 0, damage: 0, down: false, text: '' };
  if (o.distance !== undefined && (o.distance > ROCK_THROW.range || o.distance < ROCK_THROW.minRange)) {
    return { ...base, ok: false, reason: o.distance > ROCK_THROW.range ? 'out of range' : 'too close to throw', text: '' };
  }
  const { thac0, hitBonus } = attackOf(attacker);
  const dfx = effectMods(effectHost(target));
  const rac = racialCombatMods(attacker, target);
  const ac = acOf(target, { missile: true }) + rac.ac;
  const needed = neededToHit(thac0, ac, hitBonus + rac.hit + dfx.attackerHit);
  const r = rng.die(20);
  const blinked = dfx.missChance > 0 && rng.int(1, 100) <= dfx.missChance;
  if (r === 1 || blinked || (r !== 20 && r < needed)) {
    return { ...base, roll: r, needed, text: `${nameOf(attacker)} hurls a boulder at ${name} and misses.` };
  }
  const damage = Math.max(1, roll(rng, o.damage ?? ROCK_THROW.damage));
  const wasDown = isDownCreature(target);
  const down = damageCreature(target, damage) && !wasDown;
  return { ...base, hit: true, roll: r, needed, damage, down, text: `A boulder from ${nameOf(attacker)} smashes ${name} for ${damage}.${down ? ` ${name} ${characterOf(target) ? 'is down' : 'is slain'}!` : ''}` };
}

/**
 * Fear aura (`fear` tag — Tyranthraxus in his bronze dragon's body). MM
 * dragon awe: creatures of fewer than 1 HD flee in panic with no save; up to
 * 3 HD/levels save vs paralyzation or flee; stronger foes are unshaken. The
 * check is made once per battle per creature (`fearChecked`); the panic
 * lasts 4d6 rounds (`afraid`: flees; -2 to hit if cornered). Undead and the
 * mindless are immune.
 * @returns {{target:object, name:string, afraid:boolean, saved?:boolean, immune?:boolean, text:string}[]}
 */
export function fearAura(rng, source, targets) {
  const out = [];
  for (const t of targets) {
    if (!t || t === source || t.fearChecked || !isAliveCreature(t) || isDownCreature(t)) continue;
    t.fearChecked = true;
    const name = nameOf(t);
    const hd = characterOf(t) ? levelOf(t) : hitDiceOf(t);
    if (isUndead(t) || hasTag(t, 'mindless') || hd > 3) {
      out.push({ target: t, name, afraid: false, immune: true, text: `${name} stands firm before ${nameOf(source)}.` });
      continue;
    }
    let saved = false;
    if (hd >= 1) saved = rollSave(rng, t, 'ppdm', { source }).saved;
    if (saved) {
      out.push({ target: t, name, afraid: false, saved: true, text: `${name} masters the terror.` });
      continue;
    }
    addEffect(effectHost(t), 'afraid', { rounds: roll(rng, '4d6'), source: monsterOf(source)?.id ?? 'fear' });
    out.push({ target: t, name, afraid: true, saved: false, text: `${name} flees in terror from ${nameOf(source)}!` });
  }
  return out;
}

/**
 * Regeneration (`regenerate:N`, trolls 3): N hit points at the end of every
 * round, starting the 3rd round after the creature was first damaged (MM);
 * fire and acid damage is not regenerated (callers track `burnt` hp). Dead
 * trolls rise again unless burnt — the scene decides that. Returns hp to restore now.
 * `c.regenClock` counts rounds since first damage (call once per round).
 */
export function regenerationOf(c) {
  const t = (monsterOf(c)?.special ?? []).map(String).find((s) => s.startsWith('regenerate'));
  if (!t || !c.hp || c.hp.cur >= c.hp.max || c.status === 'dead') return 0;
  c.regenClock = (c.regenClock ?? 0) + 1;
  if (c.regenClock < 3) return 0;
  const n = Number(t.split(':')[1] ?? 1) || 1;
  return Math.min(n, c.hp.max - c.hp.cur - (c.burnt ?? 0));
}

/**
 * Registry: the rule behind every monster `special` tag (the part before
 * ':'). `fn` names the exported function (or module) that implements it;
 * `when` says where it runs. A test asserts every tag in data/monsters.js
 * is registered, so a new tag cannot ship as dead data.
 */
export const SPECIAL_HANDLERS = Object.freeze({
  undead: { when: 'always', fn: 'creature.isUndead — immune to sleep/charm/hold, turnable (combat.turnUndead)' },
  mindless: { when: 'always', fn: 'spells mindImmune — immune to mind magic' },
  halfEdged: { when: 'on hit', fn: 'combat.resolveAttack — half damage from edged/piercing weapons' },
  slow: { when: 'initiative', fn: 'combat.rollInitiative — acts last' },
  paralyze: { when: 'on hit', fn: 'combat.onHitSpecials — save vs paralyzation or 3d4 rounds, elves immune' },
  poison: { when: 'on hit', fn: 'combat.onHitSpecials / combat.poison — save vs poison or poisoned (onset)' },
  disease: { when: 'on hit', fn: 'combat.onHitSpecials — 5%, save vs poison or diseased' },
  drainLevel: { when: 'on hit', fn: 'combat.onHitSpecials / character.drainLevel — energy drain' },
  drainStr: { when: 'on hit', fn: 'combat.onHitSpecials — 1 STR per hit for 2d4 turns' },
  magicToHit: { when: 'defence', fn: 'combat.weaponImmunity — needs a +N weapon' },
  silverToHit: { when: 'defence', fn: 'combat.weaponImmunity — needs silver or magic' },
  magicResist: { when: 'spells', fn: 'spells.magicResistanceOf — DMG magic resistance' },
  stench: { when: 'round start', fn: 'battle.stenchAuras — save vs poison or -2 to hit' },
  spells: { when: 'action', fn: 'battle.monsterSpells / creature.classAsOf — casts and saves as a cleric/MU' },
  regenerate: { when: 'round end', fn: 'specials.regenerationOf' },
  throwRocks: { when: 'action', fn: 'specials.throwRocks / battle.rockInBattle' },
  breath: { when: 'action', fn: 'specials.breathWeapon / battle.breathInBattle' },
  fear: { when: 'battle start', fn: 'specials.fearAura / battle.fearInBattle' },
});

/** Tag key ('breath:lightning' → 'breath'). */
export const specialKey = (tag) => String(tag).split(':')[0];

/** Tags of a MonsterDef that have no registered rule (should be empty). */
export function unhandledSpecials(m) {
  return (m?.special ?? []).filter((t) => !SPECIAL_HANDLERS[specialKey(t)]);
}

/** Is the creature panicked by a fear aura (should flee)? */
export function isAfraid(c) {
  return hasEffect(effectHost(c), 'afraid');
}
