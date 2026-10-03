import { describe, it, expect } from 'vitest';
import { LoadGuard } from '../../src/audio/loadguard.js';
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
    step(4, 0.9); // rendering at 90 % of real time
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
