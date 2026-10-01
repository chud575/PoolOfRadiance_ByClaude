import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { Director } from '../../src/audio/director.js';
import { AudioRng } from '../../src/audio/core/rng.js';
import { keyRatio, SFX } from '../../src/audio/sfx/library.js';
import { BEDS } from '../../src/audio/sfx/ambience.js';
import { SONGS } from '../../src/audio/music/songs.js';

function setup() {
  const bus = new EventBus();
  const calls = [];
  const engine = {
    ctx: { currentTime: 10 },
    rng: new AudioRng(1),
    lastUiSfx: null,
    sfx: (n, o = {}) => {
      calls.push(['sfx', n, o]);
      if (o.bus === 'ui') engine.lastUiSfx = { name: n, at: engine.ctx.currentTime, scene: !o.global };
    },
    stinger: (n) => calls.push(['sting', n]),
    music: (n) => calls.push(['music', n]),
    ambience: (n, o) => calls.push(['amb', n, o?.night]),
    setEnvironment: () => {},
    setIntensity: () => {},
  };
  return { bus, calls, engine, d: new Director(engine, bus) };
}

describe('audio QoL wiring', () => {
  it('menus: confirm / cancel / page from keyboard and gamepad actions; save chime on save:written', () => {
    vi.useFakeTimers();
    const { bus, calls } = setup();
    bus.emit('scene:enter', { name: 'title', params: {} });
    bus.emit('input:action', { action: 'confirm', code: 'Enter' });
    bus.emit('input:action', { action: 'cancel', code: 'pad:b' });
    bus.emit('input:action', { action: 'nextMember', code: 'pad:rb' });
    bus.emit('save:written', { slot: 1 });
    vi.runAllTimers();
    expect(calls.filter((c) => c[0] === 'sfx').map((c) => c[1])).toEqual(['confirm', 'cancel', 'page', 'save']);
    vi.useRealTimers();
  });

  it("the generic UI cue yields to the scene's own pitched click for the same press", () => {
    vi.useFakeTimers();
    const { bus, calls, engine } = setup();
    bus.emit('scene:enter', { name: 'title', params: {} });
    bus.emit('input:action', { action: 'confirm', code: 'Enter' });
    engine.sfx('click', { bus: 'ui', pitch: 1.4 }); // the scene's own click, same event dispatch
    vi.runAllTimers();
    const sfx = calls.filter((c) => c[0] === 'sfx');
    expect(sfx.map((c) => c[1])).toEqual(['click']);
    expect(sfx[0][2].pitch).toBe(1.4);
    vi.useRealTimers();
  });

  it('camp ambience follows game time, and resting underground has its own bed', () => {
    const { bus, calls } = setup();
    bus.emit('location:changed', { map: 'wilderness', x: 0, y: 0 });
    bus.emit('time:changed', { minutes: 12 * 60 });
    bus.emit('scene:enter', { name: 'explore', params: {} });
    bus.emit('scene:enter', { name: 'camp', params: {}, overlay: true });
    expect(calls.filter((c) => c[0] === 'amb').pop()).toEqual(['amb', 'camp', false]);
    bus.emit('time:changed', { minutes: 23 * 60 });
    expect(calls.filter((c) => c[0] === 'amb').pop()).toEqual(['amb', 'camp', true]);
    const u = setup();
    u.bus.emit('location:changed', { map: 'kutos_warrens', x: 0, y: 0 });
    u.bus.emit('scene:enter', { name: 'explore', params: {} });
    u.bus.emit('scene:enter', { name: 'camp', params: {}, overlay: true });
    expect(u.calls.filter((c) => c[0] === 'amb').pop()[1]).toBe('camp_in');
    expect(BEDS.camp_in.events.cricket).toBeUndefined();
    expect(BEDS.camp.night.events.cricket).toBeTruthy();
  });

  it('spell chords follow the key of the score', () => {
    expect(keyRatio(2, 2)).toBe(1);
    expect(keyRatio(7, 2)).toBeCloseTo(Math.pow(2, 5 / 12));
    expect(keyRatio(0, 2)).toBeCloseTo(Math.pow(2, -2 / 12));
    for (const id of ['title', 'town', 'ruins', 'dungeon', 'crypt', 'wilds', 'combat']) expect(SONGS[id].key, id).toBeTypeOf('number');
  });

  it('every cue has its own room, and the long cues rest', () => {
    expect(SONGS.tavern.room).toBe('tavern');
    expect(SONGS.town.room).toBe('street');
    expect(SONGS.crypt.room).toBe('cathedral');
    expect(SONGS.title.room).toBe('hall');
    expect(SONGS.combat.room).toBe('hall');
    for (const id of ['ruins', 'dungeon', 'crypt', 'wilds']) expect(SONGS[id].rest, id).toBeTruthy();
  });

  it('extends the town: a 64-bar jig set and a slow air (> 60 s each)', () => {
    const spq = 60 / SONGS.town.bpm;
    const set = SONGS.town.build(0, new AudioRng(1));
    const air = SONGS.town.build(1, new AudioRng(2));
    expect(set.lengthQ / SONGS.town.barQ).toBe(64);
    expect(set.lengthQ * spq).toBeGreaterThan(60);
    expect(air.section).toBe('air');
    expect(air.lengthQ * spq).toBeGreaterThan(60);
    expect(SONGS.tavern.build(1, new AudioRng(2)).section).toBe('air');
  });

  it('exploration cues have four genuinely different passes', () => {
    for (const id of ['ruins', 'dungeon', 'crypt', 'wilds']) {
      const state = {};
      const seen = new Set([0, 1, 2, 3].map((p) => SONGS[id].build(p, new AudioRng(p + 1), state).section));
      expect(seen.size, id).toBe(4);
    }
  });

  it('has the new voices: party by race and sex, troll and giant, the incorporeal pass', () => {
    for (const n of ['vox_party', 'vox_party_die', 'vox_troll', 'vox_giant_die', 'pass_through', 'focus']) expect(SFX[n], n).toBeTypeOf('function');
    // Death cries are their own sounds, not the attack call replayed.
    for (const f of ['ogre', 'dragon', 'rat', 'frog']) expect(SFX[`vox_${f}_die`]).not.toBe(SFX[`vox_${f}`]);
  });
});
