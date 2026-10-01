import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { Director, parseAttack } from '../../src/audio/director.js';
import { AudioRng } from '../../src/audio/core/rng.js';

function setup() {
  const bus = new EventBus();
  const calls = [];
  const engine = {
    ctx: { currentTime: 10 },
    rng: new AudioRng(1),
    state: null,
    intensity: null,
    player: null,
    sfx: (n, o) => calls.push(['sfx', n, o]),
    stinger: (n) => calls.push(['sting', n]),
    endCombatWith: (n) => calls.push(['end', n]),
    music: (n) => calls.push(['music', n]),
    ambience: (n, o) => calls.push(['amb', n, o?.night]),
    setEnvironment: (e) => calls.push(['env', e]),
    setIntensity: (x) => {
      engine.intensity = x;
      calls.push(['intensity', x]);
    },
  };
  const d = new Director(engine, bus);
  return { bus, d, calls, engine };
}

const party = () => [
  { name: 'Taran', xp: { fighter: 0 }, levels: { fighter: 1 }, hp: { cur: 10, max: 10 }, status: 'ok' },
  { name: 'Ilyra', xp: { magicUser: 0 }, levels: { magicUser: 1 }, hp: { cur: 5, max: 5 }, status: 'ok' },
];

describe('audio director', () => {
  it('resolves explore tracks by map mood', () => {
    const { bus, d } = setup();
    bus.emit('location:changed', { map: 'kutos_warrens', x: 1, y: 1 });
    expect(d.resolveTrack('phlan_streets')).toBe('dungeon');
    bus.emit('location:changed', { map: 'phlan_civilized', x: 1, y: 1 });
    expect(d.resolveTrack('phlan_streets')).toBe('town');
    bus.emit('location:changed', { map: 'valhingen_graveyard', x: 1, y: 1 });
    expect(d.resolveTrack('explore')).toBe('crypt');
    expect(d.resolveTrack('combat')).toBe('combat');
  });

  it('turns combat log lines into specific sounds', () => {
    const { bus, d } = setup();
    bus.emit('party:changed', { party: party() });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    bus.emit('message', { text: 'Kobold 2 shoots Taran for 3.', kind: 'combat' });
    const hit = d.remapSfx('hit', {});
    expect(hit[0][0]).toBe('arrow_hit');
    bus.emit('message', { text: 'Taran hits Skeleton 1 for 6 (critical!).', kind: 'combat' });
    const h2 = d.remapSfx('hit', {}).find(([n]) => n === 'hit');
    expect(h2[1].material).toBe('bone');
    expect(h2[1].crit).toBe(true);
    bus.emit('message', { text: 'Ilyra casts Fireball!', kind: 'combat' });
    expect(d.remapSfx('spell', {}).map(([n]) => n)).toEqual(['spell', 'spell_fire']);
    expect(d.remapSfx('step', {})[0][0]).toBe('walk');
  });

  it('never builds a wind-up from an older attack (log fallback)', () => {
    const { bus, d, calls, engine } = setup();
    bus.emit('party:changed', { party: party() });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    // An archer shoots: the wind-up comes first and knows nothing yet.
    expect(d.remapSfx('miss', { pitch: 1.4 })).toEqual([['ready', {}]]);
    bus.emit('message', { text: 'Bandit 1 shoots Taran for 3.', kind: 'combat' });
    expect(calls.some((c) => c[0] === 'sfx' && c[1] === 'arrow_in')).toBe(true);
    expect(d.remapSfx('hit', {}).map(([n]) => n)).toContain('arrow_hit');
    // Then a kobold swings: its wind-up must not reuse the archer's bow.
    engine.ctx.currentTime += 3;
    calls.length = 0;
    const w = d.remapSfx('miss', { pitch: 1.4 });
    expect(w.map(([n]) => n)).not.toContain('bow');
    bus.emit('message', { text: 'Kobold 1 hits Taran for 2.', kind: 'combat' });
    const played = calls.filter((c) => c[0] === 'sfx').map((c) => c[1]);
    expect(played).toContain('swing');
    expect(played).toContain('vox_kobold');
    expect(played).not.toContain('bow');
    // The impact is nudged so the deferred whoosh leads it.
    const h = d.remapSfx('hit', {}).find(([n]) => n === 'hit');
    expect(h[1].delay).toBeGreaterThan(0);
  });

  it('uses structured combat:attack events for the wind-up (archer, then kobold melee)', () => {
    const { bus, d, engine } = setup();
    bus.emit('party:changed', { party: party() });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    bus.emit('combat:attack', { attacker: 'Bandit 1', monsterId: 'bandit', target: 'Taran', targetSide: 'party', ranged: true, hit: true, dmg: 3 });
    expect(d.remapSfx('miss', { pitch: 1.4 })[0][0]).toBe('bow');
    engine.ctx.currentTime += 2;
    bus.emit('combat:attack', { attacker: 'Kobold 1', monsterId: 'kobold', target: 'Taran', targetSide: 'party', ranged: false, hit: false });
    const w = d.remapSfx('miss', { pitch: 1.4 });
    expect(w[0][0]).toBe('swing');
    expect(w.map(([n]) => n)).toContain('vox_kobold');
    // A second wind-up with no new event does not reuse it.
    engine.ctx.currentTime += 2;
    expect(d.remapSfx('miss', { pitch: 1.4 })[0][0]).toBe('ready');
    bus.emit('combat:cast', { spellId: 'magicMissile' });
    expect(d.remapSfx('spell', {}).map(([n]) => n)).toEqual(['spell', 'spell_missile']);
  });

  it('parses attacks of opportunity, guard strikes and misses', () => {
    expect(parseAttack('Kobold 1 strikes as Taran breaks away: 3 damage.')).toMatchObject({ att: 'Kobold 1', tgt: 'Taran', hit: true, dmg: 3 });
    expect(parseAttack('Taran strikes as Kobold 2 breaks away: miss.')).toMatchObject({ att: 'Taran', tgt: 'Kobold 2', hit: false });
    expect(parseAttack('Taran, on guard, strikes Orc 1: 5 damage.')).toMatchObject({ att: 'Taran', tgt: 'Orc 1', hit: true });
    expect(parseAttack('Orc 1 swings at Ilyra and misses.')).toMatchObject({ att: 'Orc 1', tgt: 'Ilyra', hit: false, ranged: false });
    expect(parseAttack('Taran hits Skeleton 1 for 6 (critical!).')).toMatchObject({ crit: true, hit: true });
  });

  it('varies melee misses: parry, shield or dodge (beasts only dodge)', () => {
    const { bus, d } = setup();
    bus.emit('party:changed', { party: party() });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      bus.emit('message', { text: 'Orc 1 swings at Taran and misses.', kind: 'combat' });
      for (const [n] of d.remapSfx('miss', {})) seen.add(n);
    }
    expect([...seen].filter((n) => ['parry', 'shield', 'dodge'].includes(n)).length).toBeGreaterThanOrEqual(2);
    bus.emit('message', { text: 'Taran swings at Giant Rat 1 and misses.', kind: 'combat' });
    expect(d.remapSfx('miss', {}).map(([n]) => n)).toEqual(['dodge']);
  });

  it('dedupes repeated world messages and throttles death thuds', () => {
    const { bus, calls, engine } = setup();
    bus.emit('scene:enter', { name: 'explore', params: {} });
    bus.emit('message', { text: 'Something stirs in the shadows...', kind: 'warn' });
    engine.ctx.currentTime += 0.23;
    bus.emit('message', { text: 'Something stirs in the shadows!', kind: 'lore' });
    expect(calls.filter((c) => c[0] === 'sfx' && c[1] === 'omen')).toHaveLength(1);
    bus.emit('scene:enter', { name: 'combat', params: {} });
    calls.length = 0;
    for (let i = 0; i < 3; i++) {
      bus.emit('message', { text: `Kobold ${i + 1} is slain.`, kind: 'combat' });
      engine.ctx.currentTime += 0.05;
    }
    expect(calls.filter((c) => c[0] === 'sfx' && c[1] === 'death')).toHaveLength(1);
  });

  it('sets intensity from encounter strength and lets it fall as foes go down', () => {
    const weak = setup();
    weak.bus.emit('party:changed', { party: party() });
    weak.bus.emit('scene:enter', { name: 'combat', params: {} });
    weak.bus.emit('message', { text: '2 KOBOLDS ATTACK!', kind: 'combat' });
    const lo = weak.engine.intensity;
    const strong = setup();
    strong.bus.emit('party:changed', { party: party() });
    strong.bus.emit('scene:enter', { name: 'combat', params: {} });
    strong.bus.emit('message', { text: '1 OGRE ATTACK!', kind: 'combat' });
    expect(strong.engine.intensity).toBeGreaterThan(0.75);
    expect(lo).toBeLessThan(strong.engine.intensity - 0.2);
    // A big kobold pack: most of them fall, the party is healthy → the score winds down.
    const s = setup();
    s.bus.emit('party:changed', { party: party() });
    s.bus.emit('scene:enter', { name: 'combat', params: {} });
    s.bus.emit('message', { text: '8 KOBOLDS ATTACK!', kind: 'combat' });
    const start = s.engine.intensity;
    for (let i = 1; i <= 7; i++) {
      s.bus.emit('message', { text: `Kobold ${i} is slain.`, kind: 'combat' });
      s.engine.ctx.currentTime += 1;
    }
    expect(s.engine.intensity).toBeLessThan(start - 0.1);
  });

  it('plays the danger sting and the monster voice when combat opens', () => {
    const { bus, calls } = setup();
    bus.emit('scene:enter', { name: 'combat', params: {} });
    bus.emit('message', { text: '4 ORCS AND 1 ORC LEADERS ATTACK!', kind: 'combat' });
    expect(calls).toContainEqual(['sting', 'danger']);
    expect(calls.some((c) => c[0] === 'sfx' && c[1] === 'vox_orc')).toBe(true);
  });

  it('detects victory from experience, defeat from a fallen party, and level-ups', () => {
    const { bus, calls } = setup();
    const p = party();
    bus.emit('party:changed', { party: p });
    bus.emit('scene:enter', { name: 'combat', params: {} });
    p[0].xp.fighter = 50;
    bus.emit('party:changed', { party: p });
    expect(calls).toContainEqual(['end', 'victory']);

    const s2 = setup();
    const q = party();
    s2.bus.emit('party:changed', { party: q });
    s2.bus.emit('scene:enter', { name: 'combat', params: {} });
    for (const c of q) {
      c.hp.cur = 0;
      c.status = 'dying';
    }
    s2.bus.emit('message', { text: 'Ilyra falls, bleeding to death!', kind: 'warn' });
    expect(s2.calls).toContainEqual(['music', 'defeat']);

    const s3 = setup();
    const r = party();
    s3.bus.emit('party:changed', { party: r });
    r[0].levels.fighter = 2;
    s3.bus.emit('party:changed', { party: r });
    expect(s3.calls).toContainEqual(['sting', 'levelup']);
  });

  it('follows day and night in the ambience', () => {
    const { bus, calls } = setup();
    bus.emit('location:changed', { map: 'wilderness', x: 0, y: 0 });
    bus.emit('scene:enter', { name: 'explore', params: {} });
    bus.emit('time:changed', { minutes: 22 * 60 });
    expect(calls).toContainEqual(['amb', 'wilds', true]);
  });
});
