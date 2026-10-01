import { roll } from './dice.js';
import { heal, raiseDead, stoneToFlesh, isAlive } from './character.js';
import { removeEffect, hasEffect } from './conditions.js';
import { identifyItem } from './magicItems.js';

/**
 * Temple services (Temple of Tyr / Sune in Phlan). Prices follow the Pool of
 * Radiance temple menu in spirit; shops/data may override `cost`.
 */
export const TEMPLE_SERVICES = {
  cureLight: { name: 'Cure Light Wounds', cost: 100, heal: '1d8' },
  cureSerious: { name: 'Cure Serious Wounds', cost: 350, heal: '2d8+1' },
  cureCritical: { name: 'Cure Critical Wounds', cost: 600, heal: '3d8+3' },
  heal: { name: 'Heal', cost: 5000, heal: 'full' },
  cureBlindness: { name: 'Cure Blindness', cost: 1000, removes: 'blinded' },
  cureDisease: { name: 'Cure Disease', cost: 1000, removes: 'diseased' },
  neutralizePoison: { name: 'Neutralize Poison', cost: 1000, removes: 'poisoned' },
  removeCurse: { name: 'Remove Curse', cost: 3500, removes: 'bestowCurse' },
  raiseDead: { name: 'Raise Dead', cost: 5500, raise: true },
  stoneToFlesh: { name: 'Stone to Flesh', cost: 5000, unstone: true },
  identify: { name: 'Identify', cost: 200, identify: true },
};

/**
 * PHB: "Elves may not be raised" — raise dead does not work on them (only
 * resurrection, which Phlan's temples do not offer). Enforced here and in
 * character.raiseDead; serviceProblem() gives the player the reason.
 */
export function raiseAllowed(ch) {
  return ch.race !== 'elf';
}

/** Why a temple service cannot help this character (tooltip text), or null. */
export function serviceProblem(id, ch) {
  const s = TEMPLE_SERVICES[id];
  if (!s) return 'unknown service';
  if (s.raise && ch.status === 'dead' && !raiseAllowed(ch)) return 'Elves cannot be raised from the dead.';
  return serviceApplies(id, ch) ? null : 'Not needed.';
}

/** Does the service apply to this character (for greying out menu entries)? */
export function serviceApplies(id, ch) {
  const s = TEMPLE_SERVICES[id];
  if (!s) return false;
  if (s.raise) return ch.status === 'dead' && raiseAllowed(ch);
  if (s.unstone) return ch.status === 'stoned';
  if (!isAlive(ch)) return false;
  if (s.heal) return ch.hp.cur < ch.hp.max;
  if (s.removes === 'bestowCurse') return hasEffect(ch, 'bestowCurse') || hasEffect(ch, 'cursed') || ch.inventory.some((e) => e.cursed);
  if (s.removes) return hasEffect(ch, s.removes);
  if (s.identify) return ch.inventory.some((e) => e.identified === false);
  return true;
}

/**
 * Perform a service (gold handled by the caller).
 * @returns {{ok:boolean, text:string}}
 */
export function performService(rng, id, ch) {
  const s = TEMPLE_SERVICES[id];
  if (!s || !serviceApplies(id, ch)) return { ok: false, text: 'The priests shake their heads.' };
  if (s.heal) {
    const n = heal(ch, s.heal === 'full' ? ch.hp.max : roll(rng, s.heal));
    return { ok: true, text: `${ch.name} is healed ${n} hit points.` };
  }
  if (s.removes) {
    removeEffect(ch, s.removes);
    if (s.removes === 'bestowCurse') {
      removeEffect(ch, 'cursed');
      for (const e of ch.inventory) e.cursed = false;
    }
    if (s.removes === 'poisoned') removeEffect(ch, 'slowPoison');
    return { ok: true, text: `${ch.name} is cured.` };
  }
  if (s.raise) {
    const r = raiseDead(rng, ch);
    return { ok: r.ok, text: r.ok ? `${ch.name} gasps and lives again!` : `The gods do not return ${ch.name}. The body crumbles to dust.` };
  }
  if (s.unstone) {
    const r = stoneToFlesh(rng, ch);
    return { ok: r.ok, text: r.ok ? `Stone softens to flesh; ${ch.name} lives!` : `${ch.name} does not survive the shock.` };
  }
  if (s.identify) {
    const e = ch.inventory.find((x) => x.identified === false);
    return { ok: true, text: `It is ${identifyItem(e)}.` };
  }
  return { ok: false, text: '' };
}
