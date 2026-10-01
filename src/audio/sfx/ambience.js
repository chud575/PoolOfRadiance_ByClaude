import { noiseBuffer, noiseOffset } from '../dsp/bank.js';
import { Fx } from './toolkit.js';
import { creak, monsterVox } from './library.js';
import { AudioRng } from '../core/rng.js';
import { bedGain } from '../loudness.js';

/**
 * Ambience beds: continuous noise layers shaped by slow LFOs (wind, surf,
 * rumble, fire) plus randomly timed one-shot "life" events (gulls, crows,
 * drips, owls, crickets, distant hammering) scheduled from a seeded RNG.
 *
 * Environments: title, town, ruins, dungeon, crypt, wilds, camp, interior,
 * combat_out, combat_in, silence. `night` swaps birds for crickets/owls.
 */
export const BEDS = {
  title: { layers: ['wind:0.5', 'surf:0.6'], events: { gull: 9, bellFar: 40 } },
  town: { layers: ['wind:0.3', 'murmur:0.5', 'surf:0.2'], events: { gull: 12, dog: 30, hammer: 18, cart: 25 }, night: { layers: ['wind:0.35', 'surf:0.25'], events: { owl: 20, dog: 40, cricket: 3 } } },
  ruins: { layers: ['wind:0.8', 'gusts:0.5'], events: { crow: 14, rubble: 22, creakFar: 16 }, night: { layers: ['wind:0.8', 'gusts:0.5'], events: { owl: 18, rubble: 30, cricket: 4, wolfFar: 60 } } },
  dungeon: { layers: ['rumble:0.7', 'cave:0.35'], events: { drip: 2.6, chain: 35, moanFar: 55, rubble: 40 } },
  crypt: { layers: ['wind:0.55', 'cave:0.2'], events: { crow: 18, bellFar: 45, moanFar: 40 }, night: { layers: ['wind:0.6'], events: { owl: 12, moanFar: 30, cricket: 4 } } },
  wilds: { layers: ['wind:0.55', 'leaves:0.5'], events: { bird: 3.5, crow: 30 }, night: { layers: ['wind:0.45', 'leaves:0.3'], events: { cricket: 1.5, owl: 15, wolfFar: 45 } } },
  camp: { layers: ['fire:0.8', 'wind:0.25'], events: { crackle: 0.5, pop: 3, bird: 6 }, night: { layers: ['fire:0.8', 'wind:0.2'], events: { crackle: 0.5, pop: 3, cricket: 1.6, owl: 25 } } },
  // Resting underground: the fire, the drip of the deep, a far rumble — no crickets, no owls.
  camp_in: { layers: ['fire:0.75', 'cave:0.3', 'rumble:0.35'], events: { crackle: 0.5, pop: 3, drip: 3.5, rubble: 45 } },
  interior: { layers: ['room:0.5', 'roomtone:0.6', 'fire:0.18'], events: { creakFar: 12, footFar: 16, clink: 9, crackle: 2.5 } },
  combat_out: { layers: ['wind:0.45', 'gusts:0.35', 'leaves:0.25'], events: { crow: 20, rubble: 30 } },
  combat_in: { layers: ['rumble:0.5', 'cave:0.2'], events: { drip: 6 } },
  silence: { layers: [], events: {} },
};

export class Ambience {
  /**
   * @param {BaseAudioContext} ac
   * @param {AudioNode} dest
   * @param {AudioNode} send  reverb send (environmental)
   * @param {string} env
   * @param {{night?:boolean, fade?:number, at?:number, seed?:number}} [o]
   */
  constructor(ac, dest, send, env, o = {}) {
    this.ac = ac;
    this.env = env;
    const spec = BEDS[env] ?? BEDS.silence;
    const s = (o.night && spec.night) || spec;
    this.events = s.events;
    this.rng = new AudioRng(o.seed ?? 4242);
    this.out = ac.createGain();
    const t = o.at ?? ac.currentTime;
    this.out.gain.setValueAtTime(0.0001, t);
    this.level = o.gain ?? bedGain(env, !!(o.night && spec.night));
    this.out.gain.linearRampToValueAtTime(this.level, t + (o.fade ?? 2.5));
    this.out.connect(dest);
    this.send = ac.createGain();
    this.send.gain.value = 0.6;
    this.out.connect(this.send).connect(send);
    this.nodes = [];
    for (const l of s.layers) {
      const [name, lvl] = l.split(':');
      this._layer(name, Number(lvl), t);
    }
    this.next = {};
    for (const k of Object.keys(this.events)) this.next[k] = t + this.rng.range(0.5, this.events[k] * 1.2);
    this.fx = () => new Fx(ac, this.out, this.rng, {});
  }

  _lfo(t, rate, depth, target, offset = 0) {
    const o = this.ac.createOscillator();
    o.frequency.value = rate;
    const g = this.ac.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    if (offset) target.value = offset;
    o.start(t);
    this.nodes.push(o);
  }

  _noise(t, kind) {
    const n = this.ac.createBufferSource();
    n.buffer = noiseBuffer(this.ac, kind);
    n.loop = true;
    // Independent read heads (and a hair of rate drift) per layer: no two
    // layers ever share the same stretch of the 24 s noise take.
    n.playbackRate.value = this.rng.range(0.94, 1.06);
    n.start(t, noiseOffset(this.rng, 3));
    this.nodes.push(n);
    return n;
  }

  _filter(type, f, q = 0.7) {
    const b = this.ac.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  _layer(name, lvl, t) {
    const ac = this.ac;
    const g = ac.createGain();
    g.connect(this.out);
    const pan = ac.createStereoPanner();
    switch (name) {
      case 'wind': {
        // Two decorrelated bands, each wandering slowly in pitch and level.
        for (const [side, f, r] of [[-0.6, 420, 0.07], [0.6, 650, 0.053]]) {
          const n = this._noise(t, 'pink');
          const bp = this._filter('bandpass', f, 1.6);
          const lg = ac.createGain();
          lg.gain.value = 0.22 * lvl;
          this._lfo(t, r, f * 0.45, bp.frequency);
          this._lfo(t, r * 0.8 + 0.01, 0.14 * lvl, lg.gain);
          const p = ac.createStereoPanner();
          p.pan.value = side;
          n.connect(bp).connect(lg).connect(p).connect(g);
        }
        g.gain.value = 1;
        return;
      }
      case 'gusts': {
        const n = this._noise(t, 'white');
        const bp = this._filter('bandpass', 1200, 3);
        this._lfo(t, 0.031, 700, bp.frequency);
        g.gain.value = 0;
        this._lfo(t, 0.043, 0.07 * lvl, g.gain);
        n.connect(bp).connect(g);
        return;
      }
      case 'surf': {
        // Moonsea waves lapping the harbour: lowpassed noise swelling every ~7 s.
        const n = this._noise(t, 'pink');
        const lp = this._filter('lowpass', 700, 0.5);
        this._lfo(t, 0.09, 380, lp.frequency);
        g.gain.value = 0.18 * lvl;
        this._lfo(t, 0.14, 0.15 * lvl, g.gain);
        n.connect(lp).connect(pan).connect(g);
        pan.pan.value = 0.4;
        return;
      }
      case 'murmur': {
        // Distant crowd: pink noise through wandering vowel-ish formants.
        for (let i = 0; i < 3; i++) {
          const n = this._noise(t, 'pink');
          const f1 = this._filter('bandpass', 500 + i * 120, 4);
          const f2 = this._filter('bandpass', 1300 + i * 200, 5);
          this._lfo(t, 3.1 + i * 1.3, 180, f1.frequency);
          this._lfo(t, 2.3 + i * 0.9, 400, f2.frequency);
          const lg = ac.createGain();
          lg.gain.value = 0.05 * lvl;
          this._lfo(t, 0.7 + i * 0.37, 0.035 * lvl, lg.gain);
          const p = ac.createStereoPanner();
          p.pan.value = (i - 1) * 0.6;
          n.connect(f1).connect(lg);
          n.connect(f2).connect(lg);
          lg.connect(p).connect(g);
        }
        const lp = this._filter('lowpass', 2200);
        g.disconnect();
        g.connect(lp).connect(this.out);
        g.gain.value = 1;
        return;
      }
      case 'rumble': {
        const n = this._noise(t, 'brown');
        const lp = this._filter('lowpass', 110, 0.8);
        g.gain.value = 0.09 * lvl;
        this._lfo(t, 0.05, 0.035 * lvl, g.gain);
        n.connect(lp).connect(g);
        return;
      }
      case 'cave': {
        // Air moving through tunnels: a hollow resonant whistle.
        const n = this._noise(t, 'pink');
        const bp = this._filter('bandpass', 260, 12);
        const bp2 = this._filter('bandpass', 610, 14);
        this._lfo(t, 0.021, 30, bp.frequency);
        g.gain.value = 0.5 * lvl;
        this._lfo(t, 0.037, 0.3 * lvl, g.gain);
        n.connect(bp).connect(g);
        n.connect(bp2).connect(g);
        return;
      }
      case 'leaves': {
        const n = this._noise(t, 'white');
        const hp = this._filter('highpass', 3000);
        const lp = this._filter('lowpass', 9000);
        g.gain.value = 0.02 * lvl;
        this._lfo(t, 0.11, 0.018 * lvl, g.gain);
        n.connect(hp).connect(lp).connect(g);
        return;
      }
      case 'fire': {
        const n = this._noise(t, 'brown');
        const lp = this._filter('lowpass', 260, 0.6);
        g.gain.value = 0.08 * lvl;
        this._lfo(t, 0.6, 0.03 * lvl, g.gain);
        n.connect(lp).connect(g);
        const n2 = this._noise(t, 'pink');
        const bp = this._filter('bandpass', 900, 0.8);
        const g2 = ac.createGain();
        g2.gain.value = 0.04 * lvl;
        this._lfo(t, 1.7, 0.03 * lvl, g2.gain);
        n2.connect(bp).connect(g2).connect(g);
        return;
      }
      case 'roomtone': {
        // The air of a lived-in room: a soft broadband hush with a gentle presence.
        const n = this._noise(t, 'pink');
        const bp = this._filter('bandpass', 2200, 0.5);
        const hs = this._filter('highshelf', 6000, 0.7);
        hs.gain.value = -6;
        g.gain.value = 0.03 * lvl;
        this._lfo(t, 0.07, 0.008 * lvl, g.gain);
        n.connect(bp).connect(hs).connect(g);
        return;
      }
      case 'room': {
        const n = this._noise(t, 'brown');
        const lp = this._filter('lowpass', 180);
        g.gain.value = 0.16 * lvl;
        n.connect(lp).connect(g);
        return;
      }
      default:
    }
  }

  _event(kind, t) {
    const fx = new Fx(this.ac, this.out, this.rng, { pan: this.rng.range(-0.8, 0.8) });
    const r = this.rng;
    switch (kind) {
      case 'gull': {
        const n = r.int(1, 3);
        for (let i = 0; i < n; i++) {
          const tt = t + i * r.range(0.25, 0.4);
          fx.voice(tt, { type: 'triangle', dur: 0.32, contour: [[0, 1500], [0.25, 1900], [1, 1150]], vowels: ['e', 'a'], formant: 1.6, peak: 0.05, vib: [9, 0.02], breath: 0.05 });
        }
        break;
      }
      case 'crow': {
        const n = r.int(2, 3);
        for (let i = 0; i < n; i++) fx.voice(t + i * 0.36, { dur: 0.24, contour: [[0, 900], [1, 650]], vowels: ['a', 'o'], rough: 0.5, formant: 1.5, peak: 0.07, breath: 0.08 });
        break;
      }
      case 'bird': {
        const n = r.int(3, 7);
        const base = r.range(2400, 4200);
        for (let i = 0; i < n; i++) fx.tone(t + i * r.range(0.07, 0.13), { f: base * r.range(0.9, 1.3), f1: base * r.range(0.6, 1.5), dur: 0.06, peak: 0.035 });
        break;
      }
      case 'owl': {
        const f = r.range(330, 400);
        [0, 0.5, 0.75].forEach((dt, i) => fx.tone(t + dt * 1.2, { f, f1: f * 0.92, a: 0.05, dur: i ? 0.25 : 0.5, peak: 0.07, filters: [{ type: 'lowpass', f: 800 }] }));
        break;
      }
      case 'cricket': {
        const f = r.range(4200, 4900);
        for (let c = 0; c < r.int(2, 4); c++) for (let i = 0; i < 4; i++) fx.tone(t + c * 0.35 + i * 0.03, { f, dur: 0.015, peak: 0.012 });
        break;
      }
      case 'dog': {
        for (let i = 0; i < r.int(1, 3); i++) fx.voice(t + i * 0.28, { dur: 0.11, contour: [[0, 420], [1, 300]], vowels: ['a', 'o'], rough: 0.3, peak: 0.05, formant: 1.1 });
        break;
      }
      case 'hammer': {
        for (let i = 0; i < r.int(2, 4); i++) fx.modes(t + i * 0.55, { f: 1500 * r.range(0.95, 1.05), ratios: [1, 2.2, 3.4], decays: [0.25, 0.12, 0.06], peak: 0.03 });
        break;
      }
      case 'cart': {
        for (let i = 0; i < 10; i++) fx.burst(t + i * 0.12 + r.range(0, 0.03), { dur: 0.05, peak: 0.025, filters: [{ type: 'bandpass', f: 500, q: 2 }] });
        creak(fx, t + 0.1, { rate: [20, 40], dur: 1, f: 700, peak: 0.02 });
        break;
      }
      case 'bellFar': {
        fx.modes(t, { f: 220, ratios: [0.5, 1, 1.19, 1.5, 2, 2.5], decays: [3, 2.4, 2, 1.6, 1.3, 1], peak: 0.03 });
        break;
      }
      case 'rubble': {
        fx.grains(t, { count: r.int(8, 20), spread: r.range(0.4, 1), curve: 1.5, fLo: 500, fHi: 2500, peak: 0.05 });
        break;
      }
      case 'creakFar': {
        creak(fx, t, { rate: [25, 55], dur: r.range(0.5, 1.1), f: r.range(500, 900), peak: 0.03 });
        break;
      }
      case 'drip': {
        const f = r.range(1100, 2600);
        fx.tone(t, { f, f1: f * 0.55, dur: 0.05, peak: 0.06 });
        fx.tone(t + 0.02, { f: f * 1.6, f1: f, dur: 0.03, peak: 0.02 });
        break;
      }
      case 'chain': {
        for (let i = 0; i < 5; i++) fx.modes(t + i * r.range(0.05, 0.12), { f: r.range(1800, 3200), ratios: [1, 2.3, 3.9], decays: [0.1, 0.06, 0.04], peak: 0.025 });
        break;
      }
      case 'moanFar': {
        const g = new Fx(this.ac, this.out, this.rng, { vol: 0.25, pan: r.range(-0.8, 0.8) });
        monsterVox(g, t, 'zombie');
        break;
      }
      case 'wolfFar': {
        const g = new Fx(this.ac, this.out, this.rng, { vol: 0.2, pan: r.range(-0.8, 0.8) });
        monsterVox(g, t, 'wolf', 'howl');
        break;
      }
      case 'clink': {
        // Cups, a ladle, a dropped spoon somewhere in the room.
        for (let i = 0; i < r.int(1, 3); i++) fx.modes(t + i * r.range(0.08, 0.3), { f: r.range(2400, 4200), ratios: [1, 2.32, 4.1], decays: [0.18, 0.08, 0.04], peak: 0.02 });
        break;
      }
      case 'footFar': {
        // Someone crossing the floor above or in the next room.
        for (let i = 0; i < r.int(3, 6); i++) {
          const tt = t + i * r.range(0.45, 0.6);
          fx.burst(tt, { kind: 'pink', dur: 0.06, peak: 0.05, filters: [{ type: 'lowpass', f: 380 }, { type: 'highpass', f: 70 }] });
          fx.modes(tt, { f: r.range(160, 210), ratios: [1, 2.3], decays: [0.06, 0.03], peak: 0.02 });
        }
        break;
      }
      case 'crackle': {
        fx.grains(t, { count: r.int(2, 6), spread: 0.3, fLo: 1500, fHi: 5000, peak: 0.06 });
        break;
      }
      case 'pop': {
        fx.burst(t, { dur: 0.015, peak: 0.12, filters: [{ type: 'bandpass', f: r.range(800, 2000), q: 1.5 }] });
        fx.grains(t + 0.01, { count: 6, spread: 0.2, fLo: 2500, fHi: 7000, peak: 0.03 });
        break;
      }
      default:
    }
  }

  /** Schedule one-shot events up to `horizon`. */
  tick(horizon) {
    if (this.stopped) return;
    for (const [k, mean] of Object.entries(this.events)) {
      while (this.next[k] < horizon) {
        this._event(k, this.next[k]);
        // Exponential-ish spacing with a floor so events never machine-gun.
        this.next[k] += mean * (0.35 + -Math.log(1 - this.rng.next() * 0.95) * 0.75);
      }
    }
  }

  fadeOut(seconds = 2) {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ac.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(0.0001, t + seconds);
    for (const n of this.nodes) n.stop(t + seconds + 0.1);
    this._disposeAt = t + seconds + 0.5;
  }

  dispose() {
    try {
      this.out.disconnect();
    } catch {
      /* ignore */
    }
  }
}
