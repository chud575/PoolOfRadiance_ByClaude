import { describe, it, expect } from 'vitest';
import { LoadGuard, StarveGuard } from '../../src/audio/loadguard.js';
import { voiceBudget, setVoiceCap, voiceCap, VOICE_CAP } from '../../src/audio/instruments/base.js';

describe('audio load guard', () => {
  it('thins the orchestra when the audio clock falls behind, and recovers slowly', () => {
    const g = new LoadGuard();
    let wall = 0;
    let audio = 0;
    const step = (secs, ratio) => {
      for (let i = 0; i < secs * 20; i++) {
        wall += 0.05;
        audio += 0.05 * ratio;
        g.update(wall, audio, true);
      }
    };
    step(4, 1);
    expect(g.cap).toBe(VOICE_CAP);
    step(5, 0.9); // rendering at 90 % of real time (the second lagging window confirms it)
    expect(g.cap).toBeLessThan(VOICE_CAP * 0.75);
    const low = g.cap;
    step(6, 0.9);
    expect(g.cap).toBe(g.min); // never below the floor
    expect(g.degrade).toBeLessThanOrEqual(1); // thinning first, structure only once the cap is spent
    step(60, 0.9);
    // At the floor and still behind: the score degrades structurally (L2, L1, then a stem).
    expect(g.degrade).toBe(3);
    expect(g.events).toBeGreaterThan(5);
    expect(g.lag).toBeGreaterThan(1);
    step(10, 1);
    expect(g.degrade).toBe(3); // healthy for a while before it recovers
    step(60, 1);
    expect(g.degrade).toBe(0); // structure first, one level per healthy stretch
    expect(g.cap).toBe(g.min);
    step(25, 1);
    expect(g.cap).toBeGreaterThan(g.min);
    step(200, 1);
    expect(g.cap).toBe(VOICE_CAP);
    expect(low).toBeLessThan(VOICE_CAP);
  });

  it('ignores suspended contexts and long gaps (a frozen tab is not overload)', () => {
    const g = new LoadGuard();
    g.update(0, 0, true);
    g.update(30, 1, true); // 30 s gap: laptop asleep
    expect(g.cap).toBe(VOICE_CAP);
    g.update(31, 1, false);
    g.update(40, 1, false);
    expect(g.cap).toBe(VOICE_CAP);
  });

  it('caps section players per context', () => {
    const ac = { currentTime: 0 };
    expect(voiceCap(ac)).toBe(VOICE_CAP);
    setVoiceCap(ac, 10);
    const got = [0, 1, 2, 3].map(() => voiceBudget(ac, 0, 2, 6, 2));
    expect(got[0]).toBe(6);
    expect(got[1]).toBe(4);
    expect(got[2]).toBe(2); // never below the minimum: every line keeps sounding
    expect(got[3]).toBe(2);
  });
});

describe('audio load guard transients', () => {
  it('a one-off stall the clock catches up from is a glitch, not overload; a big loss acts at once', () => {
    const g = new LoadGuard();
    g.update(0, 0, true);
    g.update(2, 1.85, true); // one window 0.15 s behind
    g.update(4, 4.0, true); // caught up
    expect(g.cap).toBe(VOICE_CAP);
    expect(g.glitches).toBe(1);
    g.update(6, 5.5, true); // 0.5 s lost in one window
    expect(g.cap).toBeLessThan(VOICE_CAP);
  });

  it('stretches the scheduling window on main-thread stalls, falls back to stems if notes still drop, then recovers', () => {
    const g = new StarveGuard({ base: 1.8, max: 4 });
    let wall = 0;
    let dropped = 0;
    const run = (secs, dt = 0.05, perTick = 0) => {
      for (let i = 0; i < secs / dt; i++) {
        wall += dt;
        dropped += perTick;
        g.update(wall, dropped);
      }
    };
    run(5);
    expect(g.lookahead).toBe(1.8);
    expect(g.degrade).toBe(0);
    // One 2 s freeze of the main thread: the next tick comes 2 s late.
    wall += 2;
    g.update(wall, dropped);
    expect(g.stalls).toBe(1);
    expect(g.lookahead).toBe(4);
    expect(g.degrade).toBe(0);
    // Notes keep dropping even with the long window: play stems.
    run(1, 0.05, 1);
    expect(g.degrade).toBe(3);
    // A calm stretch steps back one level at a time.
    run(21);
    expect(g.degrade).toBe(0);
    expect(g.lookahead).toBe(4);
    run(21);
    expect(g.lookahead).toBe(1.8);
    // A suspended context (a minute without ticks) is not a stall.
    wall += 60;
    g.update(wall, dropped);
    expect(g.lookahead).toBe(1.8);
  });
});
