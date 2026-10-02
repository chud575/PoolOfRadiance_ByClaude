import { describe, it, expect } from 'vitest';
import { TrackPlayer, LOOKAHEAD } from '../../src/audio/music/Sequencer.js';
import { SONGS } from '../../src/audio/music/songs.js';

/**
 * Music transitions must never hard-cut: the outgoing cue holds its level
 * until the transition point, then fades. This models AudioParam automation
 * as the Web Audio spec defines it (including cancelAndHoldAtTime's quirk of
 * inserting no hold after a completed ramp), so a fade that starts from a
 * stale event shows up as a sudden drop.
 */
class SimParam {
  constructor(v) {
    this.v0 = v;
    this.ev = [];
  }
  get value() {
    return this.at(this.ctx?.currentTime ?? 0);
  }
  set value(v) {
    this.v0 = v;
  }
  _add(e) {
    this.ev.push(e);
    this.ev.sort((a, b) => a.t - b.t || a.seq - b.seq);
    return this;
  }
  setValueAtTime(v, t) {
    return this._add({ type: 'set', v, t, seq: this.ev.length });
  }
  linearRampToValueAtTime(v, t) {
    return this._add({ type: 'lin', v, t, seq: this.ev.length });
  }
  exponentialRampToValueAtTime(v, t) {
    return this._add({ type: 'lin', v, t, seq: this.ev.length });
  }
  setTargetAtTime(v, t, tc) {
    return this._add({ type: 'target', v, t, tc, seq: this.ev.length });
  }
  cancelScheduledValues(t) {
    this.ev = this.ev.filter((e) => e.t < t);
    return this;
  }
  cancelAndHoldAtTime(t) {
    // Spec: a ramp ending after t is truncated at t with its value there; if
    // the last event before t is a set / completed ramp, nothing is inserted.
    const after = this.ev.find((e) => e.t >= t);
    const val = this.at(t);
    this.ev = this.ev.filter((e) => e.t < t);
    if (after && after.type === 'lin') this.ev.push({ type: 'lin', v: val, t, seq: 1e9 });
    return this;
  }
  at(t) {
    let v = this.v0;
    let pt = 0;
    let target = null;
    for (const e of this.ev) {
      if (target && e.t > target.t) {
        v = target.v + (v - target.v) * Math.exp(-(Math.min(t, e.t) - target.t) / target.tc);
        if (t < e.t) return v;
        target = null;
      }
      if (e.t > t) {
        if (e.type === 'lin') return v + ((e.v - v) * (t - pt)) / Math.max(1e-9, e.t - pt);
        return v;
      }
      if (e.type === 'target') {
        target = e;
        pt = e.t;
        continue;
      }
      v = e.v;
      pt = e.t;
    }
    if (target) return target.v + (v - target.v) * Math.exp(-(t - target.t) / target.tc);
    return v;
  }
}

function mockContext() {
  const ac = { currentTime: 0, sampleRate: 44100 };
  const node = () => {
    const g = new SimParam(1);
    g.ctx = ac;
    return { gain: g, frequency: new SimParam(0), Q: new SimParam(0), connect: (n) => n, disconnect() {} };
  };
  ac.createGain = node;
  ac.createBiquadFilter = node;
  return ac;
}

class SilentPlayer extends TrackPlayer {
  _instrument() {
    return { play() {}, roll() {}, phrase() {} };
  }
  _queueWarm() {}
  warmSome() {}
}

function playFor(song, seconds, o = {}) {
  const ac = mockContext();
  const p = new SilentPlayer(ac, song, { dest: ac.createGain(), send: ac.createGain(), at: 0.05, fadeIn: o.fadeIn, rawGain: true, gainOverride: 0.8 });
  for (let t = 0; t <= seconds; t = Math.round((t + 0.05) * 1000) / 1000) {
    ac.currentTime = t;
    p.tick(t + LOOKAHEAD);
  }
  return { ac, p, g: p.out.gain };
}

const dB = (a, b) => 20 * Math.log10(a / b);

describe('music fades', () => {
  for (const [label, fadeIn] of [['after a fade-in', 1.5], ['without a fade-in', 0]]) {
    it(`a calm transition holds full level to the bar line, then fades (${label})`, () => {
      const { ac, p, g } = playFor(SONGS.town, 180, { fadeIn });
      const before = g.at(ac.currentTime - 0.01);
      const wait = p.untilNextBar();
      p.fadeOut(3, ac.currentTime + wait);
      // No drop within 50 ms of the call, nor anywhere before the bar line.
      expect(Math.abs(dB(g.at(ac.currentTime + 0.05), before))).toBeLessThan(1);
      expect(Math.abs(dB(g.at(ac.currentTime + wait - 0.01), before))).toBeLessThan(0.1);
      // Then a real fade: half-way down after 1.5 s, silent after 3 s.
      expect(g.at(ac.currentTime + wait + 1.5)).toBeLessThan(before * 0.6);
      expect(g.at(ac.currentTime + wait + 1.5)).toBeGreaterThan(before * 0.35);
      expect(g.at(ac.currentTime + wait + 3.05)).toBeLessThan(0.001);
    });
  }

  it('an urgent transition fades from the current level, not from a stale event', () => {
    const { ac, g, p } = playFor(SONGS.ruins, 60, { fadeIn: 1.5 });
    const before = g.at(ac.currentTime);
    p.fadeOut(0.6);
    expect(Math.abs(dB(g.at(ac.currentTime + 0.05), before))).toBeLessThan(1);
    expect(g.at(ac.currentTime + 0.3)).toBeGreaterThan(before * 0.4);
  });

  it('a fade requested during the fade-in continues from the ramp value', () => {
    const { ac, g, p } = playFor(SONGS.town, 0.8, { fadeIn: 2 });
    const before = g.at(ac.currentTime);
    p.fadeOut(1);
    expect(Math.abs(g.at(ac.currentTime + 0.02) - before)).toBeLessThan(0.05);
  });

  it('the battle cue plays at full level up to its coda (victory)', () => {
    const { ac, g, p } = playFor(SONGS.combat, 9.3);
    const before = g.at(ac.currentTime);
    const at = ac.currentTime + p.untilNextBar(0.12);
    p.endWithCoda(at);
    expect(Math.abs(dB(g.at(at - 0.01), before))).toBeLessThan(0.1);
    expect(g.at(at + 0.2)).toBeLessThan(0.001);
    // Reverb send stays open until the cut too.
    expect(p.sendOut.gain.at(at - 0.01)).toBeCloseTo(1, 3);
  });
});
