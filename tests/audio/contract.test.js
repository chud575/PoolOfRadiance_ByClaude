import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { Director, parseAttack } from '../../src/audio/director.js';
import { AudioRng } from '../../src/audio/core/rng.js';
import { Rng } from '../../src/rules/dice.js';
import { buildParty } from '../../src/rules/party.js';
import { combatantFromCharacter, combatantFromMonster, autoResolve } from '../../src/rules/combat.js';
import { castSpell } from '../../src/rules/spells.js';
import { Battlefield } from '../../src/scenes/combat/logic/battlefield.js';
import { CombatEngine } from '../../src/scenes/combat/logic/engine.js';

/**
 * Contract between the combat code and the audio director. The texts here are
 * produced by the REAL engine / rules templates (scenes/combat/logic/engine.js,
 * rules/combat.js, rules/spells.js), not typed by hand, so any rewording that
 * would silently break the log fallback fails this test. The structured
 * combat:event feed is checked with the same engine.
 */
function director() {
  const bus = new EventBus();
  const calls = [];
  const engine = {
    ctx: { currentTime: 10 },
    rng: new AudioRng(1),
    intensity: 0.5,
    sfx: (n, o) => calls.push(['sfx', n, o]),
    stinger: (n) => calls.push(['sting', n]),
    endCombatWith: (n) => calls.push(['end', n]),
    music: (n) => calls.push(['music', n]),
    ambience: () => {},
    setEnvironment: () => {},
    setIntensity: (x) => {
      engine.intensity = x;
      calls.push(['intensity', x]);
    },
  };
  const d = new Director(engine, bus);
  return { bus, d, calls, engine };
}

/** Run real engine fights (every attacker swings at the nearest foe) and collect the events. */
function fights(monsterIds, seeds = 12) {
  const evs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = new Rng(seed);
    const field = new Battlefield(null, { x: 0, y: 0 });
    const party = buildParty('default', 1).map(combatantFromCharacter);
    const mons = monsterIds.map((id, i) => combatantFromMonster(rng, id, i + 1));
    party.forEach((c, i) => Object.assign(c, { x: 5 + i, y: 7 }));
    mons.forEach((c, i) => Object.assign(c, { x: 5 + i, y: 8 }));
    const engine = new CombatEngine({ rng, field, party, monsters: mons });
    for (let round = 0; round < 12; round++) {
      for (const c of engine.all) {
        if (engine.out(c)) continue;
        const foe = engine.enemiesOf(c).find((o) => !engine.out(o) && engine.adjacent(c, o));
        if (!foe) continue;
        engine.order = [c, ...engine.all.filter((o) => o !== c)];
        engine.turnIdx = 0;
        engine.round = Math.max(1, engine.round);
        c.mp = c.move;
        c.attacksLeft = c.attacks.length;
        for (const ev of engine.attack(c, foe)) evs.push({ ev, engine });
      }
    }
  }
  return evs;
}

describe('combat log contract (real engine templates)', () => {
  const all = [...fights(['kobold', 'kobold', 'orc', 'skeleton', 'giantRat', 'hobgoblin']), ...fights(['shadow', 'shadow', 'shadow'], 6)];
  const attacks = all.filter((x) => x.ev.type === 'attack');
  const downs = all.filter((x) => x.ev.type === 'down');

  it('produces the cases we care about', () => {
    expect(attacks.some((x) => x.ev.hit)).toBe(true);
    expect(attacks.some((x) => !x.ev.hit)).toBe(true);
    expect(attacks.some((x) => /passes harmlessly/.test(x.ev.text))).toBe(true);
    expect(downs.some((x) => x.engine.byId(x.ev.id).side === 'monster')).toBe(true);
    expect(downs.some((x) => x.engine.byId(x.ev.id).side === 'party')).toBe(true);
  });

  it('every engine attack line is understood by the log parser', () => {
    for (const { ev } of attacks) {
      if (/passes harmlessly|blinks out of the way/.test(ev.text)) continue;
      const a = parseAttack(ev.text);
      expect(a, ev.text).toBeTruthy();
      expect(a.hit, ev.text).toBe(!!ev.hit && !ev.image);
    }
  });

  it('every engine "down" line sounds a death (party by voice, monsters by family)', () => {
    for (const { ev, engine } of downs) {
      const { bus, calls } = director();
      bus.emit('party:changed', { party: buildParty('default', 1) });
      bus.emit('scene:enter', { name: 'combat', params: {} });
      bus.emit('message', { text: ev.text, kind: 'combat' });
      const side = engine.byId(ev.id).side;
      const names = calls.filter((c) => c[0] === 'sfx').map((c) => c[1]);
      if (side === 'party') expect(names, ev.text).toContain('vox_party_die');
      else expect(names.some((n) => /^vox_.*_die$/.test(n)), ev.text).toBe(true);
      expect(names, ev.text).toContain('death');
    }
  });

  it('a weapon passing harmlessly through has its own sound', () => {
    const x = attacks.find((a) => /passes harmlessly/.test(a.ev.text));
    const { bus, d } = director();
    bus.emit('scene:enter', { name: 'combat', params: {} });
    bus.emit('message', { text: x.ev.text, kind: 'combat' });
    expect(d.remapSfx('miss', {}).map(([n]) => n)).toEqual(['pass_through']);
    // …and through the structured feed.
    const s = director();
    s.bus.emit('scene:enter', { name: 'combat', params: {} });
    s.bus.emit('combat:event', x);
    expect(s.d.remapSfx('miss', {}).map(([n]) => n)).toEqual(['pass_through']);
  });

  it('party members downed by a spell ("X is down!") fall, raise the intensity and sound', () => {
    const rng = new Rng(4);
    const party = buildParty('default', 1);
    const victim = party.find((c) => c.name);
    const target = combatantFromCharacter(victim);
    target.hp.cur = 1;
    const caster = combatantFromMonster(rng, 'kobold', 1);
    caster.ref.level = 5;
    let line = null;
    for (let s = 1; s < 40 && !line; s++) {
      target.hp.cur = 1;
      const r = castSpell(new Rng(s), 'burningHands', caster, [target], { force: true, free: true });
      line = (r?.log ?? []).find((l) => / is down!$/.test(l)) ?? null;
    }
    expect(line, 'rules/spells.js should log "<name> is down!"').toBeTruthy();
    const { bus, calls, d } = director();
    bus.emit('party:changed', { party });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    bus.emit('message', { text: line, kind: 'combat' });
    expect(calls.filter((c) => c[0] === 'sfx').map((c) => c[1])).toContain('vox_party_die');
    expect(d.downs).toBe(1);
  });

  it('QUICK auto-resolve lines ("hits X for N. X is down!") are understood', () => {
    const rng = new Rng(9);
    const party = buildParty('default', 1).map(combatantFromCharacter);
    const mons = ['kobold', 'kobold', 'kobold'].map((id, i) => combatantFromMonster(rng, id, i + 1));
    const r = autoResolve(rng, party, mons);
    const down = r.log.find((l) => / is down!$/.test(l));
    expect(down).toBeTruthy();
    const a = parseAttack(down);
    expect(a?.hit, down).toBe(true);
    const { bus, calls } = director();
    bus.emit('party:changed', { party: buildParty('default', 1) });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    bus.emit('message', { text: down, kind: 'combat' });
    const names = calls.filter((c) => c[0] === 'sfx').map((c) => c[1]);
    expect(names.some((n) => /_die$/.test(n)), down).toBe(true);
  });

  it('a QUICK battle (no animation, no scene sounds) still has wind-ups, battle cries and pain, all positioned', () => {
    // QUICK resolves blows without animation: the scene requests no sound, the
    // director voices each combat:event attack itself. Replay one real fight's
    // structured feed exactly that way (a little audio time between events).
    const { bus, d, calls, engine } = director();
    bus.emit('party:changed', { party: buildParty('default', 1) });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    d.attach({ game: null, scenes: { current: { cam: { yaw: 0.4 } } } });
    const fight = fights(['orc', 'orc', 'kobold', 'skeleton'], 2);
    for (const x of fight) {
      bus.emit('combat:event', x);
      engine.ctx.currentTime += x.ev.type === 'attack' ? 0.35 : 0.05;
    }
    bus.emit('combat:event', { ev: { type: 'round' }, engine: fight[0].engine });
    const sfx = calls.filter((c) => c[0] === 'sfx');
    const names = sfx.map((c) => c[1]);
    const blows = fight.filter((x) => x.ev.type === 'attack').length;
    expect(blows).toBeGreaterThan(20);
    expect(names.filter((n) => n === 'swing' || n === 'bow').length, 'wind-ups').toBeGreaterThan(blows * 0.5);
    expect(sfx.some((c) => /^vox_/.test(c[1]) && c[2]?.mode === 'hurt'), 'pain').toBe(true);
    expect(sfx.some((c) => /^vox_(?!party)/.test(c[1]) && !/_die$/.test(c[1]) && c[2]?.mode !== 'hurt'), 'battle cry').toBe(true);
    // Every blow, block, wind-up and voice carries an explicit stereo position, and it is used.
    const placed = sfx.filter((c) => /^(hit|parry|shield|dodge|swing|bow|arrow_hit|arrow_in|bite|vox_)/.test(c[1]));
    for (const c of placed) expect(typeof c[2]?.pan, `${c[1]} has a pan`).toBe('number');
    expect(placed.some((c) => Math.abs(c[2].pan) > 0.2)).toBe(true);
  });

  it('the structured feed drives the same sounds without any log text', () => {
    const { bus, d, calls } = director();
    bus.emit('party:changed', { party: buildParty('default', 1) });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    const hit = attacks.find((x) => x.ev.hit && !x.ev.ranged && x.engine.byId(x.ev.target).monsterId === 'skeleton');
    bus.emit('combat:event', hit);
    const out = d.remapSfx('hit', {}).find(([n]) => n === 'hit');
    expect(out[1].material).toBe('bone');
    const pd = downs.find((x) => x.engine.byId(x.ev.id).side === 'party');
    bus.emit('combat:event', pd);
    expect(calls.filter((c) => c[0] === 'sfx').map((c) => c[1])).toContain('vox_party_die');
    // Log lines are ignored once the structured feed is live (no double deaths).
    const n = calls.length;
    bus.emit('message', { text: pd.ev.text, kind: 'warn' });
    expect(calls.length).toBe(n);
  });
});
