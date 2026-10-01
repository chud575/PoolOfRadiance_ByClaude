import { diceStats } from '../../../rules/dice.js';
import {
  rollInitiative, isDown, resolveAttack, hitChance, dealDamage, savingThrow, moraleCheck, turnUndead, weaponImmunity,
  isSilverWeapon, isEdgedWeapon,
} from '../../../rules/combat.js';
import { bandage as bandageCharacter, armorAllowsThieving } from '../../../rules/character.js';
import { effectMods, hasEffect } from '../../../rules/conditions.js';
import { effectHost } from '../../../rules/creature.js';
import {
  fxView, ableToAct, attacksThisTurn, castInBattle, roundUpkeep, hammerTurn, specialsOnHit,
  castableInBattle, battleCastProblem, monsterSpells, consumeMonsterSpell, stenchAuras, battleItemUse, quaffInBattle,
} from '../../../rules/battle.js';
import { dexterityMods } from '../../../rules/abilities.js';
import { backstabMultiplier } from '../../../rules/classes.js';
import { ITEMS } from '../../../data/items.js';
import { SPELLS } from '../../../data/spells.js';
import { SPELL_RULES } from '../../../rules/spells.js';
import { Battlefield, DIR8 } from './battlefield.js';
import { spellTactics, consumeSpell, memorizedSpells } from './spells.js';

/**
 * Tactical combat engine: turn order, movement points, attacks of opportunity,
 * guard, delay, bandage, spells, turn undead, fleeing and morale. Pure logic —
 * every action returns a list of events that the scene plays back visually.
 *
 * Event types: round, turn, step, attack, down, cast, spellHit, effect, heal,
 * turnUndead, flee, guard, delay, bandage, bleed, wake, log, use, fleeFail, effectEnd.
 *
 * Rules integration (src/rules/battle.js): `c.fx` is a live view over the
 * creature's rules effects; spells resolve through the rules castSpell;
 * attack counts come from attacksFor (3/2 fighters, haste, slow, sweeps);
 * end-of-round bleeding/poison/expiry from the rules endOfRound.
 */

/**
 * How melee treats helpless (asleep, held, paralyzed, nauseous) targets:
 * the Gold Box/DMG coup de grace — an automatic hit that slays outright.
 * See rules HelplessRule ('bonus' | 'auto' | 'slay').
 */
export const HELPLESS_RULE = 'slay';
export class CombatEngine {
  /**
   * @param {{rng: import('../../../rules/dice.js').Rng, field: Battlefield,
   *   party: object[], monsters: object[]}} o
   */
  constructor({ rng, field, party, monsters }) {
    this.rng = rng;
    this.field = field;
    this.party = party;
    this.monsters = monsters;
    this.all = [...party, ...monsters];
    this.round = 0;
    this.order = [];
    this.turnIdx = -1;
    /** persistent area effects: {kind, squares:Set<string>, rounds, casterId} */
    this.areas = [];
    for (const c of this.all) {
      if (!c._fxView) {
        const old = c.fx ?? {};
        c.fx = fxView(c);
        for (const [k, v] of Object.entries(old)) c.fx[k] = v;
        c._fxView = true;
      }
      c.facing ??= c.side === 'party' ? 2 : 6;
      c.mp = 0;
      c.attacksLeft = 0;
    }
  }

  // ---------------------------------------------------------------- queries
  out(c) {
    return isDown(c) || c.fled;
  }

  active() {
    return this.order[this.turnIdx] ?? null;
  }

  hostileTo(a, b) {
    return a.side !== b.side;
  }

  enemiesOf(c) {
    return this.all.filter((o) => o !== c && this.hostileTo(c, o) && !this.out(o));
  }

  alliesOf(c) {
    return this.all.filter((o) => o !== c && !this.hostileTo(c, o) && !this.out(o));
  }

  byId(id) {
    return this.all.find((c) => c.id === id);
  }

  /** Living (or downed, still lying there) occupant of a square. */
  occupantAt(x, y, { includeDown = false } = {}) {
    return this.all.find((c) => c.x === x && c.y === y && !c.fled && (includeDown || !isDown(c))) ?? null;
  }

  /** Is a creature able to take actions / make free attacks? */
  awake(c) {
    return !this.out(c) && ableToAct(c);
  }

  adjacent(a, b, ax = a.x, ay = a.y) {
    const dx = Math.abs(ax - b.x);
    const dy = Math.abs(ay - b.y);
    if (Math.max(dx, dy) !== 1) return false;
    // A wall between them prevents melee.
    if (dx + dy === 1) return !this.field.wallBetween(ax, ay, b.x, b.y);
    return this.field.canStep(ax, ay, b.x, b.y) || this.field.canStep(b.x, b.y, ax, ay) || this.field.los(ax, ay, b.x, b.y);
  }

  adjacentEnemies(c, x = c.x, y = c.y) {
    return this.enemiesOf(c).filter((e) => this.adjacent(c, e, x, y));
  }

  /** Squares blocked for c's movement: any other standing creature. Downed bodies can be stepped over. */
  blockerFn(c) {
    const occ = new Set(this.all.filter((o) => o !== c && !this.out(o)).map((o) => `${o.x},${o.y}`));
    return (x, y) => occ.has(`${x},${y}`);
  }

  /** Flood fill of where c can walk this turn. */
  reach(c, maxCost = c.mp) {
    return this.field.flood(c.x, c.y, this.blockerFn(c), maxCost);
  }

  /** Ranged weapon profile of a character (equipped bow, or one carried in the pack). */
  rangedProfile(c) {
    if (c.side !== 'party') return c.ranged ? { damage: c.attacks[0], range: c.range, hitBonus: 0, name: 'missile' } : null;
    const ch = c.ref;
    const entry = ch.inventory.find((e) => ITEMS[e.id]?.ranged && ITEMS[e.id].type === 'weapon');
    if (!entry) return null;
    const def = ITEMS[entry.id];
    if (def.ammo && !ch.inventory.some((e) => e.id === def.ammo && (e.qty ?? 1) > 0)) return null;
    return { damage: def.damage, damageLarge: def.damageLarge, range: def.range ?? 8, hitBonus: dexterityMods(ch.abilities.dex).missile + (def.magic ?? 0), name: def.name, id: def.id, ammo: def.ammo };
  }

  /** Name of the weapon in hand (for UI + model). */
  weaponName(c) {
    if (c.side !== 'party') return c.ref?.weapon ?? 'natural';
    const w = c.ref.inventory.find((e) => e.equipped && ITEMS[e.id]?.type === 'weapon');
    return w ? ITEMS[w.id].name : 'Fists';
  }

  /** Is the attacker standing behind the defender (rear arc of its facing)? */
  isRear(att, def) {
    const [fx, fy] = DIR8[def.facing ?? 0];
    const vx = att.x - def.x;
    const vy = att.y - def.y;
    return vx * fx + vy * fy < -0.5;
  }

  /**
   * Situational to-hit / damage modifiers that depend on the battlefield.
   * `mods` holds only long range; rear (+2) and backstab (+4 instead) are
   * returned as flags and passed to the rules as `{rear, backstab}` so the
   * preview (hitChance) and the roll (resolveAttack) use one modifier set.
   * Spell and condition modifiers (bless, prayer, shield, invisibility, prot.
   * from evil, helpless targets, racial bonuses) are applied by the rules;
   * here they only add tooltip notes.
   */
  attackMods(att, def, ranged = false) {
    let mods = 0;
    const dmgMod = 0;
    const notes = [];
    const ah = effectHost(att);
    const dh = effectHost(def);
    if (hasEffect(ah, 'blessed')) notes.push('bless');
    if (hasEffect(ah, 'cursed')) notes.push('curse');
    if (hasEffect(ah, 'prayer') || hasEffect(ah, 'chant')) notes.push('prayer');
    if (hasEffect(dh, 'protEvil') && att.ref?.alignment?.includes?.('E')) notes.push('protected');
    if (hasEffect(dh, 'invisible')) notes.push('invisible');
    if (hasEffect(dh, 'shielded')) notes.push('shield');
    if (!ableToAct(def)) notes.push(ranged ? 'helpless' : 'helpless: slain outright');
    const rear = !ranged && this.isRear(att, def);
    let backstab = false;
    if (rear && att.side === 'party' && att.ref.levels?.thief && armorAllowsThieving(att.ref)) {
      backstab = true;
      notes.push('backstab +4');
    } else if (rear) notes.push('rear +2');
    if (ranged) {
      const d = Battlefield.dist(att.x, att.y, def.x, def.y);
      const rp = this.rangedProfile(att);
      if (rp && d > rp.range / 2) { mods -= 2; notes.push('long range'); }
    }
    return { mods, dmgMod, rear, backstab, notes };
  }

  /** Build the attack stat block used by resolveAttack (swaps in a bow for ranged). */
  attackerFor(att, ranged) {
    if (!ranged || att.side !== 'party') return att;
    const rp = this.rangedProfile(att);
    if (!rp) return att;
    const def = ITEMS[rp.id];
    return {
      ...att, attacks: [rp.damage], attacksLarge: rp.damageLarge, hitBonus: rp.hitBonus, dmgBonus: 0,
      weaponMagic: def?.magic ?? 0, magicWeapon: (def?.magic ?? 0) > 0, weaponSilver: isSilverWeapon(def), weaponEdged: isEdgedWeapon(def),
    };
  }

  /**
   * Can att strike def right now?  Melee needs adjacency; ranged needs a missile
   * weapon, line of sight, range, and no enemy adjacent (Gold Box rule).
   */
  canAttack(att, def) {
    if (!def || this.out(def) || !this.hostileTo(att, def)) return { ok: false, reason: 'No target' };
    if (att.attacksLeft <= 0) return { ok: false, reason: 'No attacks left' };
    if (this.adjacent(att, def)) return { ok: true, ranged: false };
    const rp = this.rangedProfile(att);
    if (!rp) return { ok: false, reason: 'Out of reach' };
    if (this.adjacentEnemies(att).length) return { ok: false, reason: 'Enemy too close to fire' };
    const d = Battlefield.dist(att.x, att.y, def.x, def.y);
    if (d > rp.range) return { ok: false, reason: 'Out of range' };
    if (!this.field.los(att.x, att.y, def.x, def.y)) return { ok: false, reason: 'No line of sight' };
    return { ok: true, ranged: true };
  }

  /** UI preview: hit %, damage range, notes. */
  preview(att, def, ranged = null) {
    const can = this.canAttack(att, def);
    const isRanged = ranged ?? (can.ok ? can.ranged : !this.adjacent(att, def) && !!this.rangedProfile(att));
    const a = this.attackerFor(att, isRanged);
    const m = this.attackMods(att, def, isRanged);
    const p = hitChance(a, def, m.mods, { ranged: isRanged, helpless: HELPLESS_RULE, rear: m.rear, backstab: m.backstab });
    const immune = weaponImmunity(a, def);
    if (immune) m.notes.push(`immune: ${immune}`);
    const dice = def.size === 'L' && a.attacksLarge ? a.attacksLarge : a.attacks[0];
    const st = diceStats(dice);
    const mult = m.backstab ? backstabMultiplier(att.ref.levels.thief) : 1;
    const lo = Math.max(1, (st.min + a.dmgBonus + m.dmgMod)) * mult;
    const hi = Math.max(1, (st.max + a.dmgBonus + m.dmgMod)) * mult;
    return { chance: p, dmg: immune ? '0' : lo === hi ? `${lo}` : `${lo}-${hi}`, immune: !!immune, notes: m.notes, ranged: isRanged, ok: can.ok, reason: can.reason, attacks: this.attackCount(att, def, isRanged) };
  }

  /** Attacks `att` gets against `def` this round (rules: 3/2, haste/slow, sweeps, rate of fire). */
  attackCount(att, def, ranged = false) {
    const rp = ranged && att.side === 'party' ? this.rangedProfile(att) : null;
    return attacksThisTurn(att, Math.max(1, this.round), def, { ranged, weapon: rp?.id ? ITEMS[rp.id] : undefined });
  }

  // ------------------------------------------------------------ round flow
  /** Roll initiative for a new round. */
  startRound() {
    const ev = [];
    this.round++;
    // Area effects linger: stinking cloud nauseates those standing in it.
    for (const a of this.areas) {
      if (a.kind !== 'cloud') continue;
      for (const c of this.all) {
        if (this.out(c) || !a.squares.has(`${c.x},${c.y}`) || c.fx.nauseous) continue;
        if (c.ref?.special?.includes?.('undead')) continue;
        const sv = savingThrow(this.rng, c, 'ppdm');
        if (!sv.saved) {
          c.fx.nauseous = 2;
          ev.push({ type: 'effect', id: c.id, kind: 'nauseous', text: `${c.name} retches in the cloud!` });
        }
      }
    }
    // Ghast stench: those within 10' save vs poison once or fight at -2.
    ev.push(...stenchAuras(this.rng, this.all.filter((c) => !this.out(c)), (a, b) => Battlefield.dist(a.x, a.y, b.x, b.y) <= 1.5));
    const ready = this.all.filter((c) => !this.out(c));
    // Sleepers/held still hold a place in the order so the timeline stays readable.
    const actors = rollInitiative(this.rng, ready.filter((c) => ableToAct(c)));
    const sleepers = ready.filter((c) => !ableToAct(c));
    this.order = [...actors, ...sleepers];
    for (const c of this.all) c.delayed = false;
    this.turnIdx = -1;
    ev.push({ type: 'round', round: this.round });
    return ev;
  }

  /** End-of-round upkeep: bleeding, durations, regeneration, clouds dissipating. */
  endRound() {
    const ev = [];
    for (const c of this.all) {
      if (c.fled) continue;
      // Rules upkeep: bleeding (bandaged allies don't), poison onset, effects expiring.
      if (!(c.side === 'monster' && isDown(c))) ev.push(...roundUpkeep(c));
      const regen = (c.ref?.special ?? []).find?.((s) => String(s).startsWith('regenerate'));
      if (regen && c.side === 'monster' && c.status === 'ok' && c.hp.cur < c.hp.max) {
        const n = Number(regen.split(':')[1] ?? 1);
        c.hp.cur = Math.min(c.hp.max, c.hp.cur + n);
        ev.push({ type: 'heal', id: c.id, amount: n, text: `${c.name} regenerates.` });
      }
    }
    for (const a of this.areas) a.rounds--;
    const gone = this.areas.filter((a) => a.rounds <= 0);
    this.areas = this.areas.filter((a) => a.rounds > 0);
    for (const a of gone) ev.push({ type: 'areaEnd', area: a });
    return ev;
  }

  /**
   * Advance to the next combatant able to act, starting new rounds as needed.
   * @returns {object[]} events (round / turn); engine.active() is the new actor.
   */
  nextTurn() {
    const ev = [];
    for (let guard = 0; guard < 400; guard++) {
      if (this.outcome()) return ev;
      this.turnIdx++;
      if (this.turnIdx >= this.order.length) {
        if (this.round > 0) ev.push(...this.endRound());
        if (this.outcome()) return ev;
        ev.push(...this.startRound());
        continue;
      }
      const c = this.order[this.turnIdx];
      if (!c || this.out(c) || c._actedRound === this.round) continue;
      if (!ableToAct(c)) {
        c._actedRound = this.round;
        continue;
      }
      if (c.side === 'party' && c.ref.status !== 'ok') continue;
      // Rules: haste doubles / slow halves movement; attacksFor gives 3/2
      // fighters their alternate-round second blow and halves a slowed orc.
      c.mp = Math.max(0, Math.round(c.move * effectMods(effectHost(c)).moveMult));
      c.attacksLeft = attacksThisTurn(c, this.round);
      c.guarding = false;
      c.moved = 0;
      c.acted = false;
      c.startX = c.x;
      c.startY = c.y;
      ev.push({ type: 'turn', id: c.id, round: this.round });
      // A Spiritual Hammer the cleric still commands strikes again.
      const hammer = hammerTurn(this.rng, c, (id) => this.byId(id), (range) => this.enemiesOf(c)
        .filter((e) => Battlefield.dist(c.x, c.y, e.x, e.y) <= range)
        .sort((a, b) => Battlefield.dist(c.x, c.y, a.x, a.y) - Battlefield.dist(c.x, c.y, b.x, b.y))[0] ?? null);
      if (hammer) {
        const t = this.byId(hammer.target);
        ev.push(hammer, ...this._downEvents(t), ...this._afterKill(t));
      }
      return ev;
    }
    return ev;
  }

  /** Finish the active combatant's turn. */
  endTurn(c) {
    c._actedRound = this.round;
    c.mp = 0;
    c.attacksLeft = 0;
    return [];
  }

  /** @returns {'party'|'monster'|'fled'|null} */
  outcome() {
    const partyStanding = this.party.filter((c) => !this.out(c));
    const partyFled = this.party.some((c) => c.fled);
    const foes = this.all.filter((c) => c.side === 'monster' && !this.out(c));
    if (!foes.length) return partyStanding.length || this.party.some((c) => c.fled && !isDown(c)) ? 'party' : 'monster';
    if (!partyStanding.length) return partyFled && this.party.some((c) => c.fled) ? 'fled' : 'monster';
    return null;
  }

  // ---------------------------------------------------------------- actions
  _setCondition(c, k, on) {
    const arr = c.conditions;
    if (!arr) return;
    const i = arr.indexOf(k);
    if (on && i < 0) arr.push(k);
    if (!on && i >= 0) arr.splice(i, 1);
  }

  _face(c, tx, ty) {
    const dx = Math.sign(tx - c.x);
    const dy = Math.sign(ty - c.y);
    const d = DIR8.findIndex(([x, y]) => x === dx && y === dy);
    if (d >= 0) c.facing = d;
  }

  /**
   * One attack roll with all the trimmings, through the rules resolveAttack
   * (mirror images, blink, shield, bless... and the helpless coup de grace).
   * Returns the attack event followed by any monster on-hit specials
   * (paralysis, poison, disease).
   */
  _strike(att, def, { ranged = false, aoo = false, guard = false, attackIndex = 0 } = {}) {
    const a = this.attackerFor(att, ranged);
    const m = this.attackMods(att, def, ranged);
    const mult = m.backstab ? backstabMultiplier(att.ref.levels.thief) : 2;
    const r = resolveAttack(this.rng, a, def, { mods: m.mods, dmgMod: m.dmgMod, rear: m.rear, backstab: m.backstab, backstabMult: mult, attackIndex, ranged, helpless: HELPLESS_RULE });
    if (ranged && a !== att && att.side === 'party') this._useAmmo(att);
    let text;
    const verb = ranged ? 'shoots' : att.side === 'monster' ? (att.monsterId === 'giantRat' ? 'bites' : 'hits') : 'hits';
    if (r.image) text = `${att.name} strikes an image of ${def.name}; it vanishes!`;
    else if (r.blinked) text = `${def.name} blinks out of the way!`;
    else if (r.coupDeGrace) text = `${att.name} slays the helpless ${def.name}!`;
    else if (r.weaponImmune) text = `${att.name}'s weapon passes harmlessly through ${def.name} (${r.weaponImmune}).`;
    else if (r.immune) text = `${att.name}'s missile turns aside from ${def.name}.`;
    else if (r.hit) text = `${att.name} ${m.backstab ? 'backstabs' : verb} ${def.name} for ${r.damage}${r.crit ? ' (critical!)' : ''}${r.halved ? ' (the blade glances off bone)' : ''}.`;
    else text = `${att.name} ${ranged ? 'shoots at' : 'swings at'} ${def.name} and misses.`;
    if (aoo && !r.image && !r.blinked) text = `${att.name} strikes as ${def.name} breaks away: ${r.hit ? `${r.damage} damage` : 'miss'}.`;
    if (guard && !r.image && !r.blinked) text = `${att.name}, on guard, strikes ${def.name}: ${r.hit ? `${r.damage} damage` : 'miss'}.`;
    const ev = { type: 'attack', id: att.id, target: def.id, hit: r.hit && !r.immune, immune: !!r.immune, dmg: r.damage, roll: r.roll, needed: r.needed, crit: r.crit, killed: r.killed, ranged, aoo, guard, backstab: m.backstab, image: !!r.image, text };
    const out = [ev];
    if (r.hit && r.damage > 0 && att.side === 'monster' && !r.killed) {
      const sp = specialsOnHit(this.rng, att, def);
      out.push(...sp);
      // Energy/strength drain can slay outright.
      if (sp.some((x) => x.died)) out.push(...this._downEvents(def));
    }
    return out;
  }

  _useAmmo(att) {
    const rp = this.rangedProfile(att);
    if (!rp?.ammo) return;
    const e = att.ref.inventory.find((x) => x.id === rp.ammo && (x.qty ?? 1) > 0);
    if (e) e.qty = (e.qty ?? 1) - 1;
  }

  _downEvents(def) {
    if (!isDown(def)) return [];
    const status = def.side === 'party' ? def.ref.status : 'dead';
    const text = def.side === 'party'
      ? status === 'dead' ? `${def.name} is killed!` : status === 'dying' ? `${def.name} falls, bleeding to death!` : `${def.name} is knocked unconscious.`
      : `${def.name} is slain.`;
    return [{ type: 'down', id: def.id, status, text }];
  }

  /**
   * Move along a path (list of {x,y}). Stops early if out of MP, blocked, or the
   * mover goes down to an attack of opportunity. A final step off a rim square flees.
   */
  move(c, path) {
    const ev = [];
    for (const step of path) {
      if (this.out(c) || !this.awake(c)) break;
      const dx = step.x - c.x;
      const dy = step.y - c.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) break;
      const leaving = !this.field.inBounds(step.x, step.y);
      const cost = leaving ? (dx && dy ? 1.5 : 1) : this.field.stepCost(c.x, c.y, step.x, step.y);
      if (cost > c.mp + 1e-6) break;
      if (!leaving && (!this.field.canStep(c.x, c.y, step.x, step.y) || this.occupantAt(step.x, step.y))) break;
      // Attacks of opportunity: enemies adjacent now that won't be adjacent after the step.
      const before = this.adjacentEnemies(c).filter((e) => this.awake(e) && e.fx.aooUsed !== this.round);
      for (const e of before) {
        if (!leaving && this.adjacent(c, e, step.x, step.y)) continue;
        e.fx.aooUsed = this.round;
        const a = this._strike(e, c, { aoo: true });
        this._face(e, c.x, c.y);
        ev.push(...a, ...this._downEvents(c));
        if (this.out(c)) return ev;
      }
      if (leaving) {
        c.fled = true;
        c.mp = 0;
        ev.push({ type: 'flee', id: c.id, dx, dy, text: `${c.name} flees the battle!` });
        return ev;
      }
      const from = { x: c.x, y: c.y };
      this._face(c, step.x, step.y);
      c.x = step.x;
      c.y = step.y;
      c.mp -= cost;
      c.moved += cost;
      ev.push({ type: 'step', id: c.id, from, x: c.x, y: c.y, facing: c.facing });
      // Guards strike at anything stepping next to them.
      for (const g of this.enemiesOf(c)) {
        if (!g.guarding || !this.awake(g) || !this.adjacent(c, g)) continue;
        g.guarding = false;
        this._face(g, c.x, c.y);
        ev.push(...this._strike(g, c, { guard: true }), ...this._downEvents(c));
        if (this.out(c)) return ev;
      }
    }
    return ev;
  }

  /** Step off the battlefield from a rim square. */
  flee(c) {
    const d = this.field.exitDir(c.x, c.y);
    if (!d) return [{ type: 'fleeFail', id: c.id, text: 'You must stand at the edge of the battlefield to flee.' }];
    if (c.mp < 1) return [{ type: 'fleeFail', id: c.id, text: 'No movement left to flee.' }];
    return this.move(c, [{ x: c.x + d[0], y: c.y + d[1] }]);
  }

  /** Melee or missile attack(s) against a target. Ends the turn when attacks run out. */
  attack(c, def) {
    const can = this.canAttack(c, def);
    if (!can.ok) {
      // Slow halves attacks: on its off round a slowed creature cannot strike.
      if (c.attacksLeft <= 0 && !c.acted && effectMods(effectHost(c)).attackMult < 1) {
        c.acted = true;
        return [{ type: 'log', text: `${c.name} is too slow to strike this round.`, kind: 'combat' }];
      }
      return [{ type: 'log', text: can.reason, kind: 'warn' }];
    }
    const ev = [];
    this._face(c, def.x, def.y);
    // Rules attack count: melee uses this turn's attacksLeft (3/2, haste,
    // slow) plus the fighter sweep vs < 1 HD foes; missiles use the weapon's
    // rate of fire (bows 2, darts 3) under haste/slow.
    const n = can.ranged ? this.attackCount(c, def, true) : Math.max(c.attacksLeft, this.attackCount(c, def, false));
    for (let i = 0; i < n; i++) {
      if (this.out(def)) break;
      ev.push(...this._strike(c, def, { ranged: can.ranged, attackIndex: i % Math.max(1, c.attacks.length) }));
      ev.push(...this._downEvents(def));
      c.attacksLeft--;
    }
    c.attacksLeft = 0;
    c.acted = true;
    ev.push(...this._afterKill(def));
    return ev;
  }

  /** Morale: monsters check when their side has lost half its number. */
  _afterKill(def) {
    const ev = [];
    if (def.side !== 'monster' || !isDown(def)) return ev;
    const side = this.all.filter((m) => m.side === 'monster' && !m.charmed);
    const down = side.filter((m) => this.out(m)).length;
    if (down * 2 < side.length) return ev;
    for (const m of side) {
      if (this.out(m) || m.fleeing || m.moraleChecked) continue;
      m.moraleChecked = true;
      if (!moraleCheck(this.rng, m, 10)) {
        m.fleeing = true;
        ev.push({ type: 'effect', id: m.id, kind: 'fear', text: `${m.name} panics and tries to flee!` });
      }
    }
    return ev;
  }

  guard(c) {
    c.guarding = true;
    c.acted = true;
    return [{ type: 'guard', id: c.id, text: `${c.name} stands on guard.` }];
  }

  /** Delay: act again at the end of this round (once per round). */
  delay(c) {
    if (c.delayed) return [{ type: 'log', text: `${c.name} has already delayed.`, kind: 'warn' }];
    c.delayed = true;
    const i = this.order.indexOf(c);
    this.order.splice(i, 1);
    this.order.push(c);
    this.turnIdx--;
    return [{ type: 'delay', id: c.id, text: `${c.name} waits for an opening.` }];
  }

  /** Bind the wounds of an adjacent dying ally. */
  bandage(c, t) {
    if (!t || t.side !== c.side || t.ref?.status !== 'dying' || !this.adjacent(c, t)) return [{ type: 'log', text: 'No dying ally within reach.', kind: 'warn' }];
    bandageCharacter(t.ref);
    c.acted = true;
    return [{ type: 'bandage', id: c.id, target: t.id, text: `${c.name} binds ${t.name}'s wounds. The bleeding stops.` }];
  }

  dyingAlliesNear(c) {
    return this.party.filter((t) => t !== c && t.ref?.status === 'dying' && !t.fled && this.adjacent(c, t));
  }

  // ----------------------------------------------------------------- spells
  /**
   * Spells c can cast right now: a character's memorized combat spells, or a
   * monster priest's per-battle slots (rules monsterSpells) — filtered by the
   * rules (silence, held, armour for arcane magic).
   */
  spellsOf(c) {
    if (this.out(c)) return [];
    if (c.side === 'party' && c.ref?.classSpec) return castableInBattle(c, memorizedSpells(c.ref));
    return castableInBattle(c, monsterSpells(c));
  }

  /** Rules targeting for c's cast of a spell (range/shape/size/maxTargets at its level) + scene hints. */
  tactics(c, spellId, level = null) {
    return spellTactics(spellId, c, level ? { level } : {});
  }

  /** Targets/area for a spell aimed at square `at`. */
  spellArea(c, spellId, at, level = null) {
    const t = this.tactics(c, spellId, level);
    if (!t) return [];
    const f = this.field;
    if (t.shape === 'allies') return this.all.filter((o) => !this.hostileTo(c, o) && !this.out(o)).map((o) => ({ x: o.x, y: o.y }));
    if (t.shape === 'all') return this.all.filter((o) => !this.out(o)).map((o) => ({ x: o.x, y: o.y }));
    if (t.target === 'self') return [{ x: c.x, y: c.y }];
    return f.template(t.shape, { x: c.x, y: c.y }, at, t.size ?? 1);
  }

  /** Is `at` a legal target square for the spell? */
  canCast(c, spellId, at, level = null) {
    const t = this.tactics(c, spellId, level);
    if (!t) return { ok: false, reason: 'Unknown spell' };
    if (t.target === 'self') return { ok: true };
    const d = Battlefield.dist(c.x, c.y, at.x, at.y);
    if (t.target === 'direction') return d >= 1 ? { ok: true } : { ok: false, reason: 'Choose a direction' };
    if (d > t.range) return { ok: false, reason: 'Out of range' };
    if (!this.field.los(c.x, c.y, at.x, at.y)) return { ok: false, reason: 'No line of sight' };
    const occ = this.occupantAt(at.x, at.y, { includeDown: t.target === 'ally' });
    if (t.target === 'enemy' && (!occ || !this.hostileTo(c, occ))) return { ok: false, reason: 'Target an enemy' };
    if (t.target === 'ally' && (!occ || this.hostileTo(c, occ))) return { ok: false, reason: 'Target an ally' };
    if (t.range === 1 && d > 1) return { ok: false, reason: 'Must touch the target' };
    return { ok: true };
  }

  /** Cast a memorized spell at a square. */
  cast(c, spellId, at, { free = false, level = null, source = null } = {}) {
    const t = this.tactics(c, spellId, level);
    const def = SPELLS[spellId];
    const can = this.canCast(c, spellId, at, level);
    if (!can.ok) return [{ type: 'log', text: can.reason, kind: 'warn' }];
    // Rules gate (silence, held, armour for arcane magic) before the slot is spent; items need no casting.
    const problem = source ? null : battleCastProblem(c, spellId);
    if (problem) return [{ type: 'log', text: `${c.name}: ${problem}.`, kind: 'warn' }];
    if (!free) {
      const spent = c.side === 'party' && c.ref?.classSpec ? consumeSpell(c.ref, spellId) : consumeMonsterSpell(c, spellId);
      if (!spent) return [{ type: 'log', text: 'That spell is not memorized.', kind: 'warn' }];
    }
    const lvl = t.level;
    if (t.target !== 'self') this._face(c, at.x, at.y);
    const squares = this.spellArea(c, spellId, at, level);
    const set = new Set(squares.map((s) => `${s.x},${s.y}`));
    const inArea = this.all.filter((o) => !this.out(o) && set.has(`${o.x},${o.y}`));
    const hits = [];
    const ev = [{ type: 'cast', id: c.id, spell: spellId, at, squares, vfx: t.vfx, source, text: `${c.name} ${source ? `uses ${source}` : `casts ${def?.name ?? SPELL_RULES[spellId]?.name ?? spellId}`}!` }];
    const foesIn = inArea.filter((o) => this.hostileTo(c, o));
    const occ = this.occupantAt(at.x, at.y, { includeDown: true });
    // The battlefield picks who the template covers (nearest the aim point
    // first); the rules decide who is affected, saves, damage and effects.
    const near = (list) => [...list].sort((a, b) => Battlefield.dist(at.x, at.y, a.x, a.y) - Battlefield.dist(at.x, at.y, b.x, b.y));
    let targets;
    if (t.target === 'self' && t.shape === 'single') targets = [c];
    else if (t.shape === 'allies') targets = [c, ...near(this.alliesOf(c))];
    else if (t.shape === 'all') targets = this.all.filter((o) => !this.out(o));
    else if (t.shape === 'single') targets = occ ? [occ] : [];
    else if (t.pick === 'foes') targets = near(foesIn); // chosen targets (hold person, slow)
    else targets = near(inArea.filter((o) => !(t.notCaster && o === c)));
    const r = castInBattle(this.rng, spellId, c, targets, { level: lvl, school: t.school, fromItem: !!source });
    hits.push(...r.hits);
    if (r.failed) ev[0].failed = true;
    if (r.ok) {
      for (const tr of r.results) {
        // Charm: the creature changes sides on the battlefield.
        if (tr.charmed) {
          tr.target.side = c.side;
          tr.target.charmed = true;
          tr.target.fleeing = false;
        }
      }
      // Lingering clouds keep nauseating whoever stands in them.
      if (spellId === 'stinkingCloud') this.areas.push({ kind: 'cloud', squares: set, rounds: lvl, casterId: c.id, center: at });
      // Dispel magic also blows clouds away.
      if (spellId === 'dispelMagic') this.areas = this.areas.filter((a) => ![...a.squares].some((q) => set.has(q)));
    }
    ev[0].hits = hits;
    for (const hh of hits) {
      if (hh.id) {
        const o = this.byId(hh.id);
        ev.push(...this._downEvents(o).filter(() => hh.killed || isDown(o)));
      }
    }
    c.acted = true;
    c.attacksLeft = 0;
    c.mp = 0;
    const downed = hits.map((hh) => hh.id && this.byId(hh.id)).filter((o) => o && isDown(o));
    if (downed.length) ev.push(...this._afterKill(downed[0]));
    return ev;
  }

  // ------------------------------------------------------------ turn undead
  canTurn(c) {
    return c.side === 'party' && !!c.ref.levels?.cleric && !c.turnedThisCombat && this.enemiesOf(c).some((e) => e.ref?.special?.includes?.('undead'));
  }

  turn(c) {
    const undead = this.enemiesOf(c).filter((e) => e.ref?.special?.includes?.('undead'));
    if (!undead.length) return [{ type: 'log', text: 'There are no undead to turn.', kind: 'warn' }];
    c.turnedThisCombat = true;
    const type = undead[0].ref.turnAs ?? undead[0].monsterId;
    const r = turnUndead(this.rng, c.ref.levels.cleric, type);
    const affected = undead.filter((u) => (u.ref.turnAs ?? u.monsterId) === type)
      .sort((a, b) => Battlefield.dist(c.x, c.y, a.x, a.y) - Battlefield.dist(c.x, c.y, b.x, b.y))
      .slice(0, r.count);
    const ev = [{ type: 'turnUndead', id: c.id, result: r.result, targets: affected.map((u) => u.id), text: `${c.name} presents the holy symbol of Tyr!` }];
    if (r.result === 'destroyed') {
      for (const u of affected) {
        dealDamage(u, u.hp.cur + 10);
        ev.push({ type: 'down', id: u.id, status: 'dead', text: `${u.name} crumbles to dust!`, holy: true });
      }
    } else if (r.result === 'turned') {
      for (const u of affected) u.fleeing = true;
      ev.push({ type: 'log', text: `${affected.length} ${undead[0].ref.plural ?? 'undead'} recoil from the light and flee!`, kind: 'combat' });
    } else ev.push({ type: 'log', text: 'The undead are not impressed.', kind: 'warn' });
    c.acted = true;
    c.mp = 0;
    c.attacksLeft = 0;
    return ev;
  }

  // ------------------------------------------------------------------ items
  usableItems(c) {
    if (c.side !== 'party') return [];
    return c.ref.inventory.map((e, i) => ({ e, i, def: ITEMS[e.id] })).filter(({ def, e }) => def && (def.type === 'potion' || (def.type === 'wand' && (e.charges ?? 0) > 0) || def.type === 'scroll'));
  }

  /**
   * Quaff a potion / zap a wand / read a scroll, through the rules: potions
   * via useItem (healing, giant strength, speed, invisibility, heroism,
   * neutralize...), scrolls gated by canUseScroll (cleric scrolls for
   * clerics, magic-user scrolls for magic-users), wands and scrolls cast at
   * the rules' item caster level.
   */
  use(c, invIndex, at = null) {
    const e = c.ref.inventory[invIndex];
    const def = e && ITEMS[e.id];
    const u = battleItemUse(c.ref, invIndex);
    if (!u.kind) return [{ type: 'log', text: u.reason, kind: 'warn' }];
    if (u.kind === 'potion') {
      const ev = quaffInBattle(this.rng, c, invIndex);
      c.acted = true;
      c.mp = 0;
      c.attacksLeft = 0;
      return ev;
    }
    const ev = this.cast(c, u.spellId, at ?? { x: c.x, y: c.y }, { free: true, level: u.level, source: def.name });
    if (ev[0]?.type === 'cast') {
      if (def.type === 'scroll') {
        if (e.spells?.length > 1) e.spells.splice(e.spells.indexOf(u.spellId), 1);
        else c.ref.inventory.splice(invIndex, 1);
      } else e.charges--;
    }
    return ev;
  }
}
