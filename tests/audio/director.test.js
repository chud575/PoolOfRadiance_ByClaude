import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { Director } from '../../src/audio/director.js';
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
    expect(d.remapSfx('miss', { pitch: 1.4 })[0][0]).toBe('bow');
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
    expect(calls).toContainEqual(['sting', 'victory']);

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
