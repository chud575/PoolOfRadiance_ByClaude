import { Battlefield, DIR8 } from './battlefield.js';
import { SPELLS } from '../../../data/spells.js';
import { isAfraid } from '../../../rules/specials.js';

/**
 * Combat AI for monsters and QUICK (computer-controlled) party members.
 * decide() returns a plan the scene executes step by step (so every move and
 * swing is animated):
 *   {kind:'attack', target, path}  walk `path` (may be empty) then attack
 *   {kind:'cast', spell, at, path?}
 *   {kind:'move', path}            reposition only
 *   {kind:'flee', path}            run for the nearest rim square, then step off
 *   {kind:'special', id:'breath'|'rocks', at, path:[]}  monster breath / boulder (engine.special)
 *   {kind:'turn'} {kind:'bandage', target, path} {kind:'guard'} {kind:'end'}
 */
export function decide(engine, c) {
  const f = engine.field;
  const foes = engine.enemiesOf(c);
  if (!foes.length) return { kind: 'end' };

  // Routed by morale or gripped by a fear aura (rules isAfraid): run for the edge.
  if (c.fleeing || isAfraid(c)) return planFlee(engine, c) ?? planMelee(engine, c, foes) ?? { kind: 'end' };

  if (c.side === 'party') {
    // Bind the dying first.
    const dying = engine.party.filter((t) => t !== c && t.ref.status === 'dying' && !t.fx.bandaged && !t.fled);
    for (const t of dying) {
      const p = pathAdjacent(engine, c, t);
      if (p && pathCost(p) <= c.mp) return { kind: 'bandage', target: t, path: p };
    }
    if (engine.canTurn(c)) return { kind: 'turn' };
    const spell = pickSpell(engine, c, foes);
    if (spell) return spell;
  } else {
    // Dragon breath and giants' boulders (rules monsterSpecialActions).
    const special = pickMonsterSpecial(engine, c, foes);
    if (special) return special;
    // Priests of Bane and other monster casters (rules monsterSpells).
    const spell = pickMonsterSpell(engine, c, foes);
    if (spell) return spell;
  }

  // Missile fire if possible and not engaged.
  const rp = engine.rangedProfile(c);
  const adj = engine.adjacentEnemies(c);
  if (rp && !adj.length) {
    const shootable = foes.filter((e) => engine.canAttack(c, e).ok).sort((a, b) => score(engine, c, b) - score(engine, c, a));
    const isCaster = c.side === 'party' && !c.ref.levels.fighter && !c.ref.levels.cleric;
    if (shootable.length && (isCaster || c.side === 'monster' || !pathMeleeCheap(engine, c, foes))) return { kind: 'attack', target: shootable[0], path: [] };
  }

  // Frail magic-users stay back when nothing better to do.
  if (c.side === 'party' && c.ref.levels.magicUser && !c.ref.levels.fighter && !adj.length) {
    return { kind: 'guard' };
  }
  return planMelee(engine, c, foes) ?? { kind: 'guard' };
}

function pathCost(p) {
  return p.length ? p[p.length - 1].cost : 0;
}

/** How attractive a target is: wounded, weak, close. */
function score(engine, c, e) {
  const d = Battlefield.dist(c.x, c.y, e.x, e.y);
  const hpFrac = e.hp.cur / Math.max(1, e.hp.max);
  const helpless = e.fx.asleep || e.fx.held || e.fx.nauseous ? 3 : 0;
  const caster = e.side === 'party' && e.ref.levels?.magicUser ? 1.5 : 0;
  return 10 - d - hpFrac * 3 + helpless + caster + (e.side === 'party' && e.ac > 6 ? 1 : 0);
}

/** Cheapest path to a square adjacent to target (empty path if already adjacent). */
export function pathAdjacent(engine, c, t, fl = null) {
  if (engine.adjacent(c, t)) return [];
  const f = engine.field;
  const flood = fl ?? engine.reach(c, 60);
  let best = null;
  for (const [dx, dy] of DIR8) {
    const x = t.x + dx;
    const y = t.y + dy;
    if (!f.inBounds(x, y)) continue;
    const cost = flood.cost[f.idx(x, y)];
    if (!Number.isFinite(cost)) continue;
    if (!engine.adjacent(c, t, x, y)) continue;
    if (!best || cost < best.cost) best = { x, y, cost };
  }
  return best ? f.pathTo(flood, best.x, best.y) : null;
}

function pathMeleeCheap(engine, c, foes) {
  const fl = engine.reach(c, c.mp);
  return foes.some((e) => {
    const p = pathAdjacent(engine, c, e, fl);
    return p && pathCost(p) <= c.mp;
  });
}

/** Trim a path to what this turn's movement allows. */
function trim(path, mp) {
  const out = [];
  for (const s of path) {
    if (s.cost > mp + 1e-6) break;
    out.push(s);
  }
  return out;
}

function planMelee(engine, c, foes) {
  const fl = engine.reach(c, 60);
  const ranked = foes
    .map((e) => ({ e, p: pathAdjacent(engine, c, e, fl) }))
    .filter((o) => o.p)
    .sort((a, b) => (pathCost(a.p) - score(engine, c, a.e) * 0.6) - (pathCost(b.p) - score(engine, c, b.e) * 0.6));
  if (!ranked.length) {
    // Blocked in by friends: shuffle toward the nearest foe ignoring occupants.
    const e = foes.slice().sort((a, b) => Battlefield.dist(c.x, c.y, a.x, a.y) - Battlefield.dist(c.x, c.y, b.x, b.y))[0];
    const free = engine.field.flood(c.x, c.y, () => false, 60);
    const p = pathAdjacent(engine, { ...c }, e, free);
    if (!p) return null;
    const occ = engine.blockerFn(c);
    const walk = [];
    for (const s of trim(p, c.mp)) {
      if (occ(s.x, s.y)) break;
      walk.push(s);
    }
    return walk.length ? { kind: 'move', path: walk } : null;
  }
  const { e, p } = ranked[0];
  const reachable = pathCost(p) <= c.mp + 1e-6;
  if (reachable) return { kind: 'attack', target: e, path: p };
  return { kind: 'move', path: trim(p, c.mp) };
}

function planFlee(engine, c) {
  const f = engine.field;
  const fl = engine.reach(c, 60);
  let best = null;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (!f.exitMask[f.idx(x, y)]) continue;
      const cost = fl.cost[f.idx(x, y)];
      if (Number.isFinite(cost) && (!best || cost < best.cost)) best = { x, y, cost };
    }
  }
  if (!best) return null;
  const p = best.cost === 0 ? [] : f.pathTo(fl, best.x, best.y);
  return { kind: 'flee', path: trim(p, c.mp), exit: best };
}

/** Quick-mode spell choice for party casters. */
function pickSpell(engine, c, foes) {
  const known = engine.spellsOf(c);
  if (!known.length) return null;
  const has = (id) => known.some((s) => s.id === id);
  const f = engine.field;
  // Heal a badly wounded ally in reach.
  if (has('cureLightWounds')) {
    const hurt = engine.party.filter((a) => !a.fled && a.ref.status !== 'dead' && a.hp.cur / a.hp.max < 0.45).sort((a, b) => a.hp.cur - b.hp.cur)[0];
    if (hurt) {
      if (hurt === c || engine.adjacent(c, hurt)) return { kind: 'cast', spell: 'cureLightWounds', at: { x: hurt.x, y: hurt.y }, path: [] };
      const p = pathAdjacent(engine, c, hurt);
      if (p && pathCost(p) <= c.mp) return { kind: 'cast', spell: 'cureLightWounds', at: { x: hurt.x, y: hurt.y }, path: p };
    }
  }
  // Area spells: best cluster of foes without allies.
  const areaSpells = ['fireball', 'sleep', 'stinkingCloud', 'lightningBolt', 'holdPerson'].filter(has);
  let bestArea = null;
  for (const id of areaSpells) {
    for (const e of foes) {
      const at = { x: e.x, y: e.y };
      if (!engine.canCast(c, id, at).ok) continue;
      const sq = new Set(engine.spellArea(c, id, at).map((s) => `${s.x},${s.y}`));
      const inside = engine.all.filter((o) => !engine.out(o) && sq.has(`${o.x},${o.y}`));
      const bad = inside.filter((o) => !engine.hostileTo(c, o)).length;
      const good = inside.filter((o) => engine.hostileTo(c, o) && !o.fx.asleep).length;
      if (bad || good < (id === 'fireball' || id === 'lightningBolt' ? 2 : 2)) continue;
      const val = good * (SPELLS[id].level + 1);
      if (!bestArea || val > bestArea.val) bestArea = { val, spell: id, at };
    }
  }
  if (bestArea) return { kind: 'cast', spell: bestArea.spell, at: bestArea.at, path: [] };
  if (has('bless') && engine.round <= 2 && !c.fx.blessed) return { kind: 'cast', spell: 'bless', at: { x: c.x, y: c.y }, path: [] };
  if (has('magicMissile')) {
    const t = foes.filter((e) => engine.canCast(c, 'magicMissile', { x: e.x, y: e.y }).ok).sort((a, b) => a.hp.cur - b.hp.cur)[0];
    if (t) return { kind: 'cast', spell: 'magicMissile', at: { x: t.x, y: t.y }, path: [] };
  }
  return null;
}

/** Awake foes caught in the template of `id` aimed at `at`, and whether any ally of c is. */
function areaCatch(engine, c, id, at) {
  const sq = new Set(engine.spellArea(c, id, at).map((q) => `${q.x},${q.y}`));
  const inside = engine.all.filter((o) => !engine.out(o) && sq.has(`${o.x},${o.y}`));
  return {
    foes: inside.filter((o) => engine.hostileTo(c, o) && !o.fx.asleep && !o.fx.held && !o.fx.paralyzed),
    allies: inside.filter((o) => !engine.hostileTo(c, o)),
  };
}

/** Best aim point for an area spell: most foes, optionally no allies. */
function bestAim(engine, c, id, foes, { spareAllies = true, min = 1, persons = false } = {}) {
  let best = null;
  for (const e of foes) {
    const at = { x: e.x, y: e.y };
    if (!engine.canCast(c, id, at).ok) continue;
    const got = areaCatch(engine, c, id, at);
    if (spareAllies && got.allies.length) continue;
    const n = persons ? got.foes.filter((o) => o.side === 'party' || o.ref?.person).length : got.foes.length;
    if (n >= min && (!best || n > best.n)) best = { n, at };
  }
  return best;
}

/**
 * Monster spellcasting (acolytes and priests of Bane: `spells:clericN`).
 * Gold Box priority: Hold Person on the densest knot of awake persons,
 * Silence on an enemy caster, Prayer/Curse early, Spiritual Hammer at range,
 * Cause Light Wounds on an adjacent foe; arcane monsters use the area spells.
 */
function pickMonsterSpell(engine, c, foes) {
  const known = engine.spellsOf(c);
  if (!known.length) return null;
  const has = (id) => known.some((s) => s.id === id);
  const self = { x: c.x, y: c.y };
  const cast = (spell, at) => ({ kind: 'cast', spell, at, path: [] });
  if (has('prayer') && engine.round <= 2 && engine.alliesOf(c).length >= 2) return cast('prayer', self);
  if (has('holdPerson')) {
    const aim = bestAim(engine, c, 'holdPerson', foes, { spareAllies: false, persons: true });
    if (aim) return cast('holdPerson', aim.at);
  }
  if (has('silence15')) {
    const casters = foes.filter((e) => e.side === 'party' && (e.ref.levels?.cleric || e.ref.levels?.magicUser) && !e.fx.silenced);
    const aim = bestAim(engine, c, 'silence15', casters);
    if (aim) return cast('silence15', aim.at);
  }
  for (const id of ['fireball', 'lightningBolt', 'stinkingCloud', 'sleep']) {
    if (!has(id)) continue;
    const aim = bestAim(engine, c, id, foes, { min: 2 });
    if (aim) return cast(id, aim.at);
  }
  if (has('curse') && engine.round <= 3) {
    const aim = bestAim(engine, c, 'curse', foes, { spareAllies: false, min: 2 });
    if (aim) return cast('curse', aim.at);
  }
  if (has('spiritualHammer') && !c.fx.spiritualHammer) {
    const t = foes.find((e) => engine.canCast(c, 'spiritualHammer', { x: e.x, y: e.y }).ok);
    if (t) return cast('spiritualHammer', { x: t.x, y: t.y });
  }
  for (const id of ['causeLightWounds', 'causeBlindness', 'bestowCurse', 'shockingGrasp']) {
    if (!has(id)) continue;
    const t = engine.adjacentEnemies(c).find((e) => engine.canCast(c, id, { x: e.x, y: e.y }).ok);
    if (t) return cast(id, { x: t.x, y: t.y });
  }
  if (has('magicMissile')) {
    const t = foes.filter((e) => engine.canCast(c, 'magicMissile', { x: e.x, y: e.y }).ok).sort((a, b) => a.hp.cur - b.hp.cur)[0];
    if (t) return cast('magicMissile', { x: t.x, y: t.y });
  }
  return null;
}

/**
 * Monster special actions (rules monsterSpecialActions). Breath: aim the
 * template where it catches the most foes — at least two (or the last foe
 * standing), allies spared unless the dragon fights alone. Boulders: a giant
 * not yet engaged hurls a rock at the most attractive foe 2-20 squares away
 * in sight rather than lumbering forward.
 */
function pickMonsterSpecial(engine, c, foes) {
  const acts = engine.specialActions?.(c) ?? [];
  if (!acts.length) return null;
  const adj = engine.adjacentEnemies(c);
  for (const a of acts) {
    if (a.id === 'breath') {
      let best = null;
      for (const e of foes) {
        const at = { x: e.x, y: e.y };
        if (Battlefield.dist(c.x, c.y, e.x, e.y) > Math.max(a.size, 1.5) + 0.5) continue;
        const sq = new Set(engine.specialArea(c, 'breath', at).map((q) => `${q.x},${q.y}`));
        const inside = engine.all.filter((o) => o !== c && !engine.out(o) && sq.has(`${o.x},${o.y}`));
        const n = inside.filter((o) => engine.hostileTo(c, o)).length;
        const friends = inside.filter((o) => !engine.hostileTo(c, o)).length;
        if (friends || !n) continue;
        if (!best || n > best.n) best = { n, at };
      }
      if (best && (best.n >= 2 || foes.length === 1)) return { kind: 'special', id: 'breath', at: best.at, path: [] };
    }
    if (a.id === 'rocks' && !adj.length) {
      const t = foes
        .filter((e) => {
          const d = Battlefield.dist(c.x, c.y, e.x, e.y);
          return d >= a.minRange && d <= a.range && engine.field.los(c.x, c.y, e.x, e.y);
        })
        .sort((x, y) => score(engine, c, y) - score(engine, c, x))[0];
      if (t) return { kind: 'special', id: 'rocks', at: { x: t.x, y: t.y }, path: [] };
    }
  }
  return null;
}
