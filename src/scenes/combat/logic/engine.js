import { roll, diceStats } from '../../../rules/dice.js';
import {
  rollInitiative, isDown, resolveAttack, hitChance, dealDamage, savingThrow, moraleCheck, turnUndead,
} from '../../../rules/combat.js';
import { heal } from '../../../rules/character.js';
import { dexterityMods } from '../../../rules/abilities.js';
import { backstabMultiplier } from '../../../rules/classes.js';
import { ITEMS } from '../../../data/items.js';
import { SPELLS } from '../../../data/spells.js';
import { Battlefield, DIR8 } from './battlefield.js';
import { SPELL_TACTICS, consumeSpell, casterLevel, memorizedSpells } from './spells.js';

/**
 * Tactical combat engine: turn order, movement points, attacks of opportunity,
 * guard, delay, bandage, spells, turn undead, fleeing and morale. Pure logic —
 * every action returns a list of events that the scene plays back visually.
 *
 * Event types: round, turn, step, attack, down, cast, spellHit, effect, heal,
 * turnUndead, flee, guard, delay, bandage, bleed, wake, log, use, fleeFail.
 */
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
      c.fx ??= {};
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
    return !this.out(c) && !c.fx.asleep && !c.fx.held && !c.fx.nauseous;
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

  /** Situational to-hit / damage modifiers. */
  attackMods(att, def, ranged = false) {
    let mods = 0;
    let dmgMod = 0;
    const notes = [];
    if (att.fx.blessed) { mods += 1; notes.push('bless'); }
    if (att.fx.cursed) { mods -= 1; notes.push('curse'); }
    if (att.fx.prayer) { mods += 1; }
    if (def.fx?.prayerFoe) mods += 1;
    if (att.fx.enlarged) dmgMod += 2;
    if (def.fx?.prot && att.ref?.alignment?.includes?.('E')) { mods -= 2; notes.push('protected'); }
    if (def.fx?.invisible) { mods -= 4; notes.push('invisible'); }
    if (def.fx?.shielded) mods -= ranged ? 3 : 1;
    if (def.fx?.asleep || def.fx?.held || def.fx?.nauseous) { mods += 10; notes.push('helpless'); }
    const rear = !ranged && this.isRear(att, def);
    let backstab = false;
    if (rear) { mods += 2; notes.push('rear'); }
    if (rear && att.side === 'party' && att.ref.levels?.thief && !att.ref.inventory.some((e) => e.equipped && ITEMS[e.id]?.type === 'armor' && !['leather', 'padded'].includes(ITEMS[e.id].armorGroup))) {
      backstab = true;
      mods += 2;
      notes.push('backstab');
    }
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
    return { ...att, attacks: [rp.damage], attacksLarge: rp.damageLarge, hitBonus: rp.hitBonus, dmgBonus: 0 };
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
    const p = hitChance(a, def, m.mods);
    const dice = def.size === 'L' && a.attacksLarge ? a.attacksLarge : a.attacks[0];
    const st = diceStats(dice);
    const mult = m.backstab ? backstabMultiplier(att.ref.levels.thief) : 1;
    const lo = Math.max(1, (st.min + a.dmgBonus + m.dmgMod)) * mult;
    const hi = Math.max(1, (st.max + a.dmgBonus + m.dmgMod)) * mult;
    return { chance: p, dmg: lo === hi ? `${lo}` : `${lo}-${hi}`, notes: m.notes, ranged: isRanged, ok: can.ok, reason: can.reason, attacks: att.attacks.length };
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
    const ready = this.all.filter((c) => !this.out(c));
    // Sleepers/held still hold a place in the order so the timeline stays readable.
    const actors = rollInitiative(this.rng, ready.filter((c) => !c.fx.asleep && !c.fx.held));
    const sleepers = ready.filter((c) => c.fx.asleep || c.fx.held);
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
      if (c.side === 'party' && c.ref.status === 'dying' && !c.fx.bandaged) {
        dealDamage(c, 1);
        ev.push({ type: 'bleed', id: c.id, text: c.ref.status === 'dead' ? `${c.name} has bled to death.` : `${c.name} is bleeding (${c.hp.cur}).` });
        if (c.ref.status === 'dead') ev.push({ type: 'down', id: c.id, status: 'dead', silent: true });
      }
      const regen = (c.ref?.special ?? []).find?.((s) => String(s).startsWith('regenerate'));
      if (regen && c.side === 'monster' && c.status === 'ok' && c.hp.cur < c.hp.max) {
        const n = Number(regen.split(':')[1] ?? 1);
        c.hp.cur = Math.min(c.hp.max, c.hp.cur + n);
        ev.push({ type: 'heal', id: c.id, amount: n, text: `${c.name} regenerates.` });
      }
      for (const k of ['asleep', 'held', 'nauseous', 'blessed', 'cursed', 'prot', 'shielded', 'enlarged', 'invisible', 'hasted', 'prayer', 'prayerFoe', 'silenced']) {
        if (typeof c.fx[k] === 'number') {
          c.fx[k]--;
          if (c.fx[k] <= 0) {
            delete c.fx[k];
            if (k === 'asleep' || k === 'held') {
              this._setCondition(c, k, false);
              ev.push({ type: 'wake', id: c.id, text: k === 'asleep' ? `${c.name} wakes up.` : `${c.name} can move again.` });
            }
          }
        }
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
      if (c.fx.asleep || c.fx.held || c.fx.nauseous) {
        c._actedRound = this.round;
        continue;
      }
      if (c.side === 'party' && c.ref.status !== 'ok') continue;
      c.mp = c.move * (c.fx.hasted ? 2 : 1);
      c.attacksLeft = c.attacks.length * (c.fx.hasted ? 2 : 1);
      c.guarding = false;
      c.moved = 0;
      c.acted = false;
      c.startX = c.x;
      c.startY = c.y;
      ev.push({ type: 'turn', id: c.id, round: this.round });
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

  /** One attack roll with all the trimmings. */
  _strike(att, def, { ranged = false, aoo = false, guard = false, attackIndex = 0 } = {}) {
    const a = this.attackerFor(att, ranged);
    const m = this.attackMods(att, def, ranged);
    const mult = m.backstab ? backstabMultiplier(att.ref.levels.thief) : 2;
    // Mirror images soak attacks.
    if (def.fx.mirror > 0 && this.rng.int(1, def.fx.mirror + 1) > 1) {
      def.fx.mirror--;
      return { type: 'attack', id: att.id, target: def.id, hit: false, image: true, dmg: 0, ranged, aoo, guard, text: `${att.name} strikes an image of ${def.name}; it vanishes!` };
    }
    const r = resolveAttack(this.rng, a, def, { mods: m.mods, dmgMod: m.dmgMod, backstab: m.backstab, backstabMult: mult, attackIndex });
    if (ranged && a !== att && att.side === 'party') this._useAmmo(att);
    let text;
    const verb = ranged ? 'shoots' : att.side === 'monster' ? (att.monsterId === 'giantRat' ? 'bites' : 'hits') : 'hits';
    if (r.hit) {
      text = `${att.name} ${m.backstab ? 'backstabs' : verb} ${def.name} for ${r.damage}${r.crit ? ' (critical!)' : ''}.`;
      if (def.fx.asleep) {
        delete def.fx.asleep;
        this._setCondition(def, 'asleep', false);
      }
    } else text = `${att.name} ${ranged ? 'shoots at' : 'swings at'} ${def.name} and misses.`;
    if (aoo) text = `${att.name} strikes as ${def.name} breaks away: ${r.hit ? `${r.damage} damage` : 'miss'}.`;
    if (guard) text = `${att.name}, on guard, strikes ${def.name}: ${r.hit ? `${r.damage} damage` : 'miss'}.`;
    const ev = { type: 'attack', id: att.id, target: def.id, hit: r.hit, dmg: r.damage, roll: r.roll, needed: r.needed, crit: r.crit, killed: r.killed, ranged, aoo, guard, backstab: m.backstab, text };
    return ev;
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
      const cost = dx && dy ? 1.5 : 1;
      if (cost > c.mp + 1e-6) break;
      const leaving = !this.field.inBounds(step.x, step.y);
      if (!leaving && (!this.field.canStep(c.x, c.y, step.x, step.y) || this.occupantAt(step.x, step.y))) break;
      // Attacks of opportunity: enemies adjacent now that won't be adjacent after the step.
      const before = this.adjacentEnemies(c).filter((e) => this.awake(e) && e.fx.aooUsed !== this.round);
      for (const e of before) {
        if (!leaving && this.adjacent(c, e, step.x, step.y)) continue;
        e.fx.aooUsed = this.round;
        const a = this._strike(e, c, { aoo: true });
        this._face(e, c.x, c.y);
        ev.push(a, ...this._downEvents(c));
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
        ev.push(this._strike(g, c, { guard: true }), ...this._downEvents(c));
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
    if (!can.ok) return [{ type: 'log', text: can.reason, kind: 'warn' }];
    const ev = [];
    this._face(c, def.x, def.y);
    const n = can.ranged ? Math.min(c.attacksLeft, c.side === 'party' ? 2 : c.attacksLeft) : c.attacksLeft;
    for (let i = 0; i < n; i++) {
      if (this.out(def)) break;
      ev.push(this._strike(c, def, { ranged: can.ranged, attackIndex: Math.min(i, c.attacks.length - 1) }));
      ev.push(...this._downEvents(def));
      c.attacksLeft--;
      if (can.ranged) break;
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
    t.fx.bandaged = true;
    t.ref.status = 'unconscious';
    c.acted = true;
    return [{ type: 'bandage', id: c.id, target: t.id, text: `${c.name} binds ${t.name}'s wounds. The bleeding stops.` }];
  }

  dyingAlliesNear(c) {
    return this.party.filter((t) => t !== c && t.ref?.status === 'dying' && !t.fled && this.adjacent(c, t));
  }

  // ----------------------------------------------------------------- spells
  spellsOf(c) {
    if (c.side !== 'party') return [];
    if (c.fx.silenced) return [];
    return memorizedSpells(c.ref);
  }

  /** Targets/area for a spell aimed at square `at`. */
  spellArea(c, spellId, at) {
    const t = SPELL_TACTICS[spellId];
    if (!t) return [];
    const f = this.field;
    if (t.shape === 'allies') return this.all.filter((o) => !this.hostileTo(c, o) && !this.out(o)).map((o) => ({ x: o.x, y: o.y }));
    if (t.shape === 'all') return this.all.filter((o) => !this.out(o)).map((o) => ({ x: o.x, y: o.y }));
    if (t.target === 'self') return [{ x: c.x, y: c.y }];
    return f.template(t.shape, { x: c.x, y: c.y }, at, t.size ?? 1);
  }

  /** Is `at` a legal target square for the spell? */
  canCast(c, spellId, at) {
    const t = SPELL_TACTICS[spellId];
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
    const t = SPELL_TACTICS[spellId];
    const def = SPELLS[spellId];
    const can = this.canCast(c, spellId, at);
    if (!can.ok) return [{ type: 'log', text: can.reason, kind: 'warn' }];
    if (!free && !consumeSpell(c.ref, spellId)) return [{ type: 'log', text: 'That spell is not memorized.', kind: 'warn' }];
    const lvl = level ?? (c.side === 'party' ? casterLevel(c.ref, spellId) : 1);
    if (t.target !== 'self') this._face(c, at.x, at.y);
    const squares = this.spellArea(c, spellId, at);
    const set = new Set(squares.map((s) => `${s.x},${s.y}`));
    const inArea = this.all.filter((o) => !this.out(o) && set.has(`${o.x},${o.y}`));
    const hits = [];
    const ev = [{ type: 'cast', id: c.id, spell: spellId, at, squares, vfx: t.vfx, source, text: `${c.name} ${source ? `uses ${source}` : `casts ${def.name}`}!` }];
    const foesIn = inArea.filter((o) => this.hostileTo(c, o));
    const occ = this.occupantAt(at.x, at.y, { includeDown: true });
    const save = (o, key, bonus = 0) => savingThrow(this.rng, o, key, bonus).saved;
    const damage = (o, dmg) => {
      const killed = dealDamage(o, dmg);
      if (o.fx.asleep) { delete o.fx.asleep; this._setCondition(o, 'asleep', false); }
      return killed;
    };
    switch (spellId) {
      case 'magicMissile': {
        const n = 1 + Math.floor((lvl - 1) / 2);
        let total = 0;
        const bolts = [];
        for (let i = 0; i < n; i++) {
          const d = roll(this.rng, '1d4+1');
          bolts.push(d);
          total += d;
        }
        if (occ.fx.shielded) {
          hits.push({ id: occ.id, dmg: 0, text: `The missiles splash harmlessly against ${occ.name}'s shield.` });
        } else {
          const killed = damage(occ, total);
          hits.push({ id: occ.id, dmg: total, bolts, killed, text: `${n} missile${n > 1 ? 's' : ''} strike${n > 1 ? '' : 's'} ${occ.name} for ${total}.` });
        }
        break;
      }
      case 'sleep': {
        let budget = roll(this.rng, '4d4');
        const cands = foesIn.filter((o) => !o.ref?.special?.includes?.('undead') && !o.fx.asleep).sort((a, b) => (a.ref?.hd ?? 1) - (b.ref?.hd ?? 1));
        for (const o of cands) {
          const hd = o.side === 'party' ? Math.max(...Object.values(o.ref.levels)) : Math.max(1, Math.ceil(o.ref.hd ?? 1));
          if (hd > 4 || hd > budget) continue;
          budget -= hd;
          o.fx.asleep = 5 * lvl;
          this._setCondition(o, 'asleep', true);
          hits.push({ id: o.id, effect: 'asleep', text: `${o.name} falls asleep.` });
        }
        if (!hits.length) hits.push({ text: 'Nobody succumbs to the spell.' });
        break;
      }
      case 'burningHands': {
        for (const o of inArea) {
          const killed = damage(o, lvl);
          hits.push({ id: o.id, dmg: lvl, killed, text: `${o.name} is burned for ${lvl}.` });
        }
        if (!inArea.length) hits.push({ text: 'The flames lick at empty air.' });
        break;
      }
      case 'shockingGrasp':
      case 'causeLightWounds': {
        const d = roll(this.rng, spellId === 'shockingGrasp' ? '1d8' : '1d8') + (spellId === 'shockingGrasp' ? lvl : 0);
        const hit = spellId === 'causeLightWounds' ? resolveAttack(this.rng, c, occ, { mods: 0 }).hit : true;
        if (hit) {
          const killed = damage(occ, d);
          hits.push({ id: occ.id, dmg: d, killed, text: `${occ.name} takes ${d} damage.` });
        } else hits.push({ id: occ.id, dmg: 0, text: `${c.name}'s touch misses.` });
        break;
      }
      case 'charmPerson': {
        const ok = !occ.ref?.special?.includes?.('undead') && (occ.size !== 'L') && !save(occ, 'sp');
        if (ok) {
          occ.side = c.side;
          occ.charmed = true;
          occ.fleeing = false;
          hits.push({ id: occ.id, effect: 'charmed', text: `${occ.name} is charmed and now fights for you!` });
        } else hits.push({ id: occ.id, effect: 'resist', text: `${occ.name} resists the charm.` });
        break;
      }
      case 'stinkingCloud': {
        this.areas.push({ kind: 'cloud', squares: set, rounds: lvl, casterId: c.id, center: at });
        for (const o of inArea) {
          if (o.ref?.special?.includes?.('undead')) continue;
          if (!save(o, 'ppdm')) {
            o.fx.nauseous = 2;
            hits.push({ id: o.id, effect: 'nauseous', text: `${o.name} is overcome by the stench.` });
          } else hits.push({ id: o.id, effect: 'resist', text: `${o.name} holds its breath.` });
        }
        break;
      }
      case 'fireball':
      case 'lightningBolt': {
        const dice = `${Math.min(10, lvl)}d6`;
        const base = roll(this.rng, dice);
        for (const o of inArea) {
          if (o === c) continue;
          const saved = save(o, 'sp');
          const d = saved ? Math.floor(base / 2) : base;
          const killed = damage(o, Math.max(1, d));
          hits.push({ id: o.id, dmg: Math.max(1, d), saved, killed, text: `${o.name} ${saved ? 'dodges partly and ' : ''}takes ${Math.max(1, d)}.` });
        }
        if (!hits.length) hits.push({ text: 'The blast hits nothing.' });
        break;
      }
      case 'holdPerson': {
        const cands = foesIn.filter((o) => !o.ref?.special?.includes?.('undead') && o.monsterId !== 'giantRat' && o.size !== 'L').slice(0, t.max ?? 3);
        for (const o of cands) {
          if (!save(o, 'sp', -1)) {
            o.fx.held = 4 + lvl;
            this._setCondition(o, 'held', true);
            hits.push({ id: o.id, effect: 'held', text: `${o.name} is held fast!` });
          } else hits.push({ id: o.id, effect: 'resist', text: `${o.name} shrugs off the spell.` });
        }
        if (!cands.length) hits.push({ text: 'No one there can be held.' });
        break;
      }
      case 'silence15': {
        for (const o of inArea) {
          o.fx.silenced = 2 * lvl;
          hits.push({ id: o.id, effect: 'silenced', text: `${o.name} is wrapped in silence.` });
        }
        break;
      }
      case 'curse': {
        for (const o of foesIn) {
          o.fx.cursed = 6;
          hits.push({ id: o.id, effect: 'cursed', text: `${o.name} is cursed.` });
        }
        if (!foesIn.length) hits.push({ text: 'The curse finds no one.' });
        break;
      }
      case 'bless':
      case 'haste': {
        for (const o of this.alliesOf(c).concat([c])) {
          o.fx[spellId === 'bless' ? 'blessed' : 'hasted'] = spellId === 'bless' ? 6 : 3 + lvl;
          hits.push({ id: o.id, effect: spellId === 'bless' ? 'blessed' : 'hasted' });
        }
        hits.push({ text: spellId === 'bless' ? 'The party is blessed.' : 'The party moves with unnatural speed!' });
        break;
      }
      case 'prayer': {
        for (const o of this.all) {
          if (this.out(o)) continue;
          if (this.hostileTo(c, o)) o.fx.prayerFoe = lvl;
          else o.fx.prayer = lvl;
        }
        hits.push({ text: 'A prayer strengthens allies and weakens foes.' });
        break;
      }
      case 'cureLightWounds': {
        const d = roll(this.rng, '1d8');
        const amt = occ.side === 'party' ? heal(occ.ref, d) : Math.min(d, occ.hp.max - occ.hp.cur);
        if (occ.side !== 'party') occ.hp.cur += amt;
        if (occ.fx.bandaged && occ.ref?.status === 'ok') delete occ.fx.bandaged;
        hits.push({ id: occ.id, heal: amt, text: `${occ.name} is healed for ${amt}.` });
        break;
      }
      case 'protectionFromEvil':
      case 'shield':
      case 'enlarge':
      case 'invisibility':
      case 'resistCold': {
        const target = t.target === 'self' ? c : occ;
        const k = { protectionFromEvil: 'prot', shield: 'shielded', enlarge: 'enlarged', invisibility: 'invisible', resistCold: 'resistCold' }[spellId];
        target.fx[k] = 3 * lvl + 2;
        hits.push({ id: target.id, effect: k, text: `${target.name} is ${{ prot: 'warded against evil', shielded: 'shielded', enlarged: 'enlarged', invisible: 'turned invisible', resistCold: 'protected from cold' }[k]}.` });
        break;
      }
      case 'mirrorImage': {
        c.fx.mirror = roll(this.rng, '1d4');
        hits.push({ id: c.id, effect: 'mirror', text: `${c.fx.mirror} image${c.fx.mirror > 1 ? 's' : ''} of ${c.name} appear${c.fx.mirror > 1 ? '' : 's'}.` });
        break;
      }
      case 'dispelMagic': {
        for (const o of inArea) {
          for (const k of ['asleep', 'held', 'blessed', 'cursed', 'prot', 'shielded', 'enlarged', 'invisible', 'hasted', 'mirror', 'silenced']) delete o.fx[k];
          this._setCondition(o, 'asleep', false);
          this._setCondition(o, 'held', false);
        }
        this.areas = this.areas.filter((a) => ![...a.squares].some((s) => set.has(s)));
        hits.push({ text: 'Magic unravels.' });
        break;
      }
      default:
        hits.push({ text: 'Nothing happens.' });
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

  /** Quaff a potion / zap a wand / read a scroll. Wands & scrolls become a free spell cast. */
  use(c, invIndex, at = null) {
    const e = c.ref.inventory[invIndex];
    const def = e && ITEMS[e.id];
    if (!def) return [{ type: 'log', text: 'Nothing to use.', kind: 'warn' }];
    if (def.type === 'potion') {
      const dice = String(def.effect).split(':')[1] ?? '1d8';
      const amt = heal(c.ref, roll(this.rng, dice));
      c.ref.inventory.splice(invIndex, 1);
      c.acted = true;
      c.mp = 0;
      c.attacksLeft = 0;
      return [{ type: 'use', id: c.id, item: def.id, text: `${c.name} drinks a ${def.name}.` }, { type: 'heal', id: c.id, amount: amt, text: `${c.name} regains ${amt} hit points.` }];
    }
    if (def.type === 'wand' || def.type === 'scroll') {
      const spell = def.effect;
      if (def.type === 'scroll' && SPELLS[spell]?.school === 'magicUser' && !c.ref.levels.magicUser) return [{ type: 'log', text: 'Only a magic-user can read that scroll.', kind: 'warn' }];
      const ev = this.cast(c, spell, at ?? { x: c.x, y: c.y }, { free: true, level: def.type === 'wand' ? 6 : undefined, source: def.name });
      if (ev[0]?.type === 'cast') {
        if (def.type === 'wand') e.charges--;
        else c.ref.inventory.splice(invIndex, 1);
      }
      return ev;
    }
    return [{ type: 'log', text: 'That cannot be used in combat.', kind: 'warn' }];
  }
}
