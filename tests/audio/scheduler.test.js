import { describe, it, expect } from 'vitest';
import { TrackPlayer, LOOKAHEAD, LATE_DROP } from '../../src/audio/music/Sequencer.js';
import { SONGS } from '../../src/audio/music/songs.js';

/**
 * Scheduler robustness: the music must survive main-thread stalls (map loads,
 * shader compiles) without a gap or a burst of bunched notes, and late notes
 * are dropped rather than played on top of each other.
 */
function param(v = 0) {
  const p = { value: v };
  for (const k of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[k] = () => p;
  return p;
}
function node() {
  return { gain: param(1), frequency: param(), Q: param(), connect: (n) => n, disconnect() {} };
}
function mockContext() {
  return { currentTime: 0, sampleRate: 44100, createGain: node, createBiquadFilter: node };
}

/** A player whose instruments record onset times instead of making sound. */
let current = null;
class RecordingPlayer extends TrackPlayer {
  _instrument() {
    return current.ins;
  }
  _queueWarm() {}
  warmSome() {}
}
function recorder(song, ac, intensity = 0.8) {
  const onsets = [];
  current = {
    ins: {
      play: (t) => onsets.push(t),
      roll: (t) => onsets.push(t),
      phrase: (notes) => notes.forEach((n) => onsets.push(n.t)),
    },
  };
  const p = new RecordingPlayer(ac, song, { dest: node(), send: node(), at: 0.05, intensity, rawGain: true });
  const rec = current;
  p._instrument = () => rec.ins;
  return { p, onsets };
}

/** Drive the player like the engine clock: a tick every 50 ms, except while `stalled(t)`. */
function run(p, ac, seconds, stalled = () => false) {
  for (let t = 0; t <= seconds; t = Math.round((t + 0.05) * 1000) / 1000) {
    ac.currentTime = t;
    if (!stalled(t)) p.tick(t + LOOKAHEAD);
  }
}

/** Largest number of onsets inside any 30 ms window that starts at or after `from`. */
function worstBurst(onsets, from, to) {
  const s = onsets.filter((t) => t >= from && t <= to).sort((a, b) => a - b);
  let worst = 0;
  for (let i = 0, j = 0; i < s.length; i++) {
    while (s[i] - s[j] > 0.03) j++;
    worst = Math.max(worst, i - j + 1);
  }
  return worst;
}

describe('music scheduler', () => {
  it('looks ahead far enough to ride out long main-thread stalls', () => {
    expect(LOOKAHEAD).toBeGreaterThanOrEqual(1.5);
    expect(LATE_DROP).toBeLessThanOrEqual(0.05);
  });

  it('a 1 s main-thread block mid-cue leaves no gap and no onset burst', () => {
    const song = SONGS.combat;
    const a = mockContext();
    const ref = recorder(song, a);
    run(ref.p, a, 20);
    const b = mockContext();
    const stall = recorder(song, b);
    run(stall.p, b, 20, (t) => t > 8 && t < 9);
    // Identical note stream (nothing lost, nothing bunched), and no note was dropped.
    expect(stall.p.dropped).toBe(0);
    expect(stall.onsets.length).toBe(ref.onsets.length);
    expect(worstBurst(stall.onsets, 8, 11)).toBeLessThanOrEqual(worstBurst(ref.onsets, 8, 11));
  });

  it('a stall longer than the lookahead drops the late notes instead of bunching them', () => {
    const song = SONGS.combat;
    const a = mockContext();
    const ref = recorder(song, a);
    run(ref.p, a, 20);
    const b = mockContext();
    const stall = recorder(song, b);
    run(stall.p, b, 20, (t) => t > 6 && t < 9.5);
    expect(stall.p.dropped).toBeGreaterThan(0);
    // Whatever is played after the stall never sits more than LATE_DROP before its scheduled time.
    const ref30 = worstBurst(ref.onsets, 9.4, 12);
    expect(worstBurst(stall.onsets, 9.4, 12)).toBeLessThanOrEqual(ref30 + 1);
  });

  it('notes of a silent layer inside the lookahead still play when the intensity rises', () => {
    const song = SONGS.combat;
    const ac = mockContext();
    const low = recorder(song, ac, 0.05);
    run(low.p, ac, 4);
    const before = low.onsets.length;
    low.p.setIntensity(1, 0.5);
    // The layer-1/2 notes already "scheduled" (skipped) inside the window are rescued.
    expect(low.onsets.length).toBeGreaterThan(before);
  });

  it('rest windows fall silent for a while, then the music returns', () => {
    const song = SONGS.wilds;
    expect(song.rest).toBeTruthy();
    const ac = mockContext();
    const r = recorder(song, ac, 1);
    r.p.restAfter = 50;
    r.p.restAnchor = 0;
    run(r.p, ac, 240);
    const s = r.onsets.slice().sort((x, y) => x - y);
    let gap = 0;
    for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i] - s[i - 1]);
    expect(gap).toBeGreaterThanOrEqual(song.rest.length[0] - 1);
    expect(s[s.length - 1]).toBeGreaterThan(200);
  });
});
