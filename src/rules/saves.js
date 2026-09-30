import { dexterityMods, wisdomSaveAdj } from './abilities.js';
import { effectMods } from './conditions.js';
import { characterOf, savesOf, effectHost, isEvil, isGood } from './creature.js';
import { effectiveAbilities } from './character.js';

/**
 * Saving throws for any creature, with the situational bonuses 1e applies:
 *  - Wisdom magical attack adjustment vs mind-affecting magic (`mental`),
 *  - Dexterity defensive adjustment vs dodgeable magic (`dodge`: fireball, lightning),
 *  - element resistance (+3 from resist fire/cold),
 *  - protection from evil/good vs an evil/good source (`source`),
 *  - any flat `bonus` from the caller (hold person's multi-target penalty...).
 *
 * @param {import('./dice.js').Rng} rng
 * @param {object} c creature
 * @param {'ppdm'|'pp'|'rsw'|'bw'|'sp'} key
 * @param {{bonus?:number, mental?:boolean, dodge?:boolean, element?:string, source?:object}} [o]
 * @returns {{roll:number, target:number, bonus:number, saved:boolean}}
 */
export function rollSave(rng, c, key, o = {}) {
  const target = savesOf(c)[key];
  const bonus = saveBonus(c, o);
  const r = rng.die(20);
  return { roll: r, target, bonus, saved: r + bonus >= target };
}

/** Situational save bonus only (see rollSave). */
export function saveBonus(c, o = {}) {
  let bonus = o.bonus ?? 0;
  const ch = characterOf(c);
  const fx = effectMods(effectHost(c));
  if (ch) {
    const a = effectiveAbilities(ch);
    if (o.mental) bonus += wisdomSaveAdj(a.wis);
    if (o.dodge) bonus += Math.max(0, -dexterityMods(a.dex).ac);
  }
  if (o.element) bonus += fx.saveVsElement[o.element] ?? 0;
  if (o.source) {
    if (isEvil(o.source)) bonus += fx.vsEvil.save;
    if (isGood(o.source)) bonus += fx.vsGood.save;
  }
  return bonus;
}

/** Probability (0..1) that a creature saves — for tooltips. */
export function saveChance(c, key, o = {}) {
  const need = savesOf(c)[key] - saveBonus(c, o);
  return Math.max(0, Math.min(1, (21 - need) / 20));
}
