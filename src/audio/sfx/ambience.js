import { kbq } from '../instruments/base.js';
import { noiseBuffer, noiseOffset, sample } from '../dsp/bank.js';
import { glottal } from '../dsp/synth.js';
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
  town: { layers: ['wind:0.3', 'walla:0.7', 'murmur:0.3', 'surf:0.2'], events: { gull: 9, dog: 22, hammer: 9, cart: 14, callFar: 11, hoof: 19, coinsFar: 13, laughFar: 17 }, night: { layers: ['wind:0.35', 'surf:0.25'], events: { owl: 20, dog: 40, cricket: 3 } } },
  ruins: { layers: ['wind:0.8', 'gusts:0.5'], events: { crow: 14, rubble: 22, creakFar: 16 }, night: { layers: ['wind:0.8', 'gusts:0.5'], events: { owl: 18, rubble: 30, cricket: 4, wolfFar: 60 } } },
  dungeon: { layers: ['rumble:0.3', 'cave:0.5', 'seep:0.6'], events: { drip: 2.6, chain: 35, moanFar: 55, rubble: 40 }, corr: 0.25 },
  crypt: { layers: ['wind:0.55', 'cave:0.2'], events: { crow: 18, bellFar: 45, moanFar: 40 }, night: { layers: ['wind:0.6'], events: { owl: 12, moanFar: 30, cricket: 4 } } },
  wilds: { layers: ['wind:0.55', 'leaves:0.5'], events: { bird: 3.5, crow: 30 }, night: { layers: ['wind:0.45', 'leaves:0.3'], events: { cricket: 1.5, owl: 15, wolfFar: 45 } } },
  // The campfire is mostly flicker and hiss (the air above it), a little body — not a low hum.
  camp: { layers: ['fire:0.8', 'air:0.5', 'wind:0.3'], events: { crackle: 0.5, pop: 3, bird: 6 }, night: { layers: ['fire:0.8', 'air:0.45', 'wind:0.25'], events: { crackle: 0.5, pop: 3, cricket: 1.6, owl: 25 } } },
  // Resting underground: the fire, the drip of the deep, a far rumble — no crickets, no owls.
  camp_in: { layers: ['fire:0.75', 'air:0.4', 'cave:0.35', 'rumble:0.08', 'seep:0.35'], events: { crackle: 0.5, pop: 3, drip: 3.5, rubble: 45 }, corr: 0.3 },
  interior: { layers: ['room:0.06', 'roomtone:1.3', 'air:0.3', 'fire:0.18'], events: { creakFar: 12, footFar: 16, clink: 9, crackle: 2.5 }, corr: 0.3 },
  combat_out: { layers: ['wind:0.45', 'gusts:0.35', 'leaves:0.25'], events: { crow: 20, rubble: 30 } },
  combat_in: { layers: ['rumble:0.25', 'cave:0.35', 'seep:0.5'], events: { drip: 6 }, corr: 0.25 },
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
    this._fadeIn = [t, t + (o.fade ?? 2.5)];
    // 24 dB/oct high-pass at 38 Hz (4th-order Butterworth): no bed carries
    // infrasound or sub rumble that a laptop can't play and a limiter would pump on.
    const hpA = this._filter('highpass', 38, 0.54);
    const hpB = this._filter('highpass', 38, 1.31);
    this.out.connect(hpA).connect(hpB).connect(dest);
    this.send = ac.createGain();
    this.send.gain.value = 0.6;
    hpB.connect(this.send).connect(send);
    // Indoor beds keep a centre: the two ears share part of the sound (L/R correlation ≈ corr).
    this.corr = s.corr ?? spec.corr ?? 0;
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
    // Brown noise piles its energy below 40 Hz (and drifts like DC): rumble you
    // can't hear on a laptop and that eats the bed's headroom. Keep the
    // audible weight (45–200 Hz) and drop the sub.
    if (kind === 'brown') return n.connect(this._filter('highpass', 42, 0.6)).connect(this._filter('highpass', 42, 0.6));
    return n;
  }

  _filter(type, f, q = 0.7) {
    const b = kbq(this.ac);
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /**
   * A decorrelated stereo pair: `chain(jitter)` builds one mono branch
   * (independent noise read head, filter frequencies jittered by `jitter`)
   * for each ear, merged hard L/R — beds that surround the listener instead
   * of sitting in the middle as one mono wash.
   */
  _stereo(dest, chain) {
    const m = this.ac.createChannelMerger(2);
    const rho = this.corr ?? 0;
    if (rho > 0) {
      // L = √ρ·C + √(1−ρ)·Nₗ, R = √ρ·C + √(1−ρ)·Nᵣ  →  correlation ρ, same level.
      const c = this.ac.createGain();
      c.gain.value = Math.sqrt(rho);
      chain(1).connect(c);
      for (let ch = 0; ch < 2; ch++) {
        const g = this.ac.createGain();
        g.gain.value = Math.sqrt(1 - rho);
        chain(1 + this.rng.range(-0.09, 0.09)).connect(g).connect(m, 0, ch);
        c.connect(m, 0, ch);
      }
    } else for (let ch = 0; ch < 2; ch++) chain(1 + this.rng.range(-0.09, 0.09)).connect(m, 0, ch);
    m.connect(dest);
    return m;
  }

  _layer(name, lvl, t) {
    const ac = this.ac;
    const g = ac.createGain();
    g.connect(this.out);
    const pan = ac.createStereoPanner();
    switch (name) {
      case 'wind': {
        // Two decorrelated bands, each wandering slowly in pitch and level.
        for (const [side, f, r] of [[-0.9, 420, 0.07], [0.9, 650, 0.053]]) {
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
        g.gain.value = 0;
        this._lfo(t, 0.043, 0.07 * lvl, g.gain);
        this._stereo(g, (j) => {
          const n = this._noise(t, 'white');
          const bp = this._filter('bandpass', 1200 * j, 3);
          this._lfo(t, 0.031 * j, 700 * j, bp.frequency);
          return n.connect(bp);
        });
        return;
      }
      case 'surf': {
        // Moonsea waves lapping the harbour: lowpassed noise swelling every ~7 s, each ear its own stretch of shore.
        g.gain.value = 0.18 * lvl;
        this._lfo(t, 0.14, 0.15 * lvl, g.gain);
        this._stereo(g, (j) => {
          const lp = this._filter('lowpass', 700 * j, 0.5);
          this._lfo(t, 0.09 * j, 380, lp.frequency);
          return this._noise(t, 'pink').connect(lp);
        });
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
      case 'walla': {
        // The market: a babble of a dozen distant voices (pre-rendered stereo loop, see wallaData).
        const n = ac.createBufferSource();
        n.buffer = sample(ac, 'walla:1', (sr) => wallaData(sr, 1));
        n.loop = true;
        n.start(t, this.rng.range(0, 10));
        this.nodes.push(n);
        g.gain.value = 0.5 * lvl;
        this._lfo(t, 0.045, 0.12 * lvl, g.gain);
        n.connect(g);
        return;
      }
      case 'rumble': {
        g.gain.value = 0.09 * lvl;
        this._lfo(t, 0.05, 0.035 * lvl, g.gain);
        this._stereo(g, (j) => this._noise(t, 'brown').connect(this._filter('lowpass', 110 * j, 0.8)));
        return;
      }
      case 'seep': {
        // Water finding its way through the stone somewhere off in the dark: a
        // thin trickle whose babble is noise-modulated noise, a different seam in each ear.
        g.gain.value = 0.09 * lvl;
        this._stereo(g, (j) => {
          const am = ac.createGain();
          am.gain.value = 0.35;
          const mod = ac.createGain();
          mod.gain.value = 9;
          this._noise(t, 'white').connect(this._filter('lowpass', 18 * j, 0.7)).connect(mod).connect(am.gain);
          return this._noise(t, 'white').connect(this._filter('bandpass', 2300 * j, 1.4)).connect(this._filter('lowpass', 5200 * j, 0.6)).connect(am);
        });
        return;
      }
      case 'cave': {
        // Air moving through tunnels: hollow resonant whistles, a different pipe in each ear.
        g.gain.value = 0.5 * lvl;
        this._lfo(t, 0.037, 0.3 * lvl, g.gain);
        this._stereo(g, (j) => {
          const n = this._noise(t, 'pink');
          const bp = this._filter('bandpass', 260 * j, 12);
          const bp2 = this._filter('bandpass', 610 * (2 - j), 14);
          this._lfo(t, 0.021 * j, 30, bp.frequency);
          const sum = ac.createGain();
          n.connect(bp).connect(sum);
          n.connect(bp2).connect(sum);
          return sum;
        });
        return;
      }
      case 'leaves': {
        g.gain.value = 0.02 * lvl;
        this._lfo(t, 0.11, 0.018 * lvl, g.gain);
        this._stereo(g, (j) => {
          const lg = ac.createGain();
          this._lfo(t, 0.17 * j, 0.5, lg.gain, 0.6);
          return this._noise(t, 'white').connect(this._filter('highpass', 3000 * j)).connect(this._filter('lowpass', 9000)).connect(lg);
        });
        return;
      }
      case 'fire': {
        // Body (a soft low roar, kept small), the flicker of the flames (mids,
        // breathing fast) and the hiss of sap and embers (highs).
        g.gain.value = 1;
        this._stereo(g, (j) => {
          const sum = ac.createGain();
          const g1 = ac.createGain();
          g1.gain.value = 0.03 * lvl;
          this._lfo(t, 0.6 * j, 0.012 * lvl, g1.gain);
          this._noise(t, 'brown').connect(this._filter('bandpass', 190 * j, 0.7)).connect(g1).connect(sum);
          const g2 = ac.createGain();
          g2.gain.value = 0.055 * lvl;
          this._lfo(t, 1.7 * j, 0.035 * lvl, g2.gain);
          this._noise(t, 'pink').connect(this._filter('bandpass', 1000 * j, 0.7)).connect(g2).connect(sum);
          const g3 = ac.createGain();
          g3.gain.value = 0.012 * lvl;
          this._lfo(t, 2.9 * j, 0.009 * lvl, g3.gain);
          this._noise(t, 'white').connect(this._filter('bandpass', 3400 * j, 0.9)).connect(g3).connect(sum);
          return sum;
        });
        return;
      }
      case 'air': {
        // The air of the place itself: a soft 300 Hz–4 kHz hush, slowly breathing.
        g.gain.value = 0.035 * lvl;
        this._lfo(t, 0.05, 0.01 * lvl, g.gain);
        this._stereo(g, (j) => {
          const hs = this._filter('highshelf', 4500, 0.7);
          hs.gain.value = -9;
          return this._noise(t, 'pink').connect(this._filter('highpass', 300 * j, 0.6)).connect(hs);
        });
        return;
      }
      case 'roomtone': {
        // The air of a lived-in room: a soft broadband hush with a gentle presence.
        g.gain.value = 0.03 * lvl;
        this._lfo(t, 0.07, 0.008 * lvl, g.gain);
        this._stereo(g, (j) => {
          const hs = this._filter('highshelf', 6000, 0.7);
          hs.gain.value = -6;
          return this._noise(t, 'pink').connect(this._filter('bandpass', 2200 * j, 0.5)).connect(hs);
        });
        return;
      }
      case 'room': {
        g.gain.value = 0.16 * lvl;
        this._stereo(g, (j) => this._noise(t, 'brown').connect(this._filter('lowpass', 180 * j)));
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
      case 'callFar': {
        // A vendor crying his wares across the square: a sung two-note call, far off.
        const fv = new Fx(this.ac, this.out, this.rng, { vol: 0.5, pan: r.range(-0.9, 0.9) });
        const f0 = r.range(150, 230) * (r.chance(0.3) ? 1.6 : 1);
        const up = r.pick([1.12, 1.19, 1.33]);
        fv.voice(t, { dur: 0.45, a: 0.05, contour: [[0, f0], [0.15, f0 * up], [0.7, f0 * up], [1, f0 * 0.95]], vowels: ['a', 'o'], breath: 0.15, rough: 0.1, peak: 0.06 });
        fv.voice(t + 0.55, { dur: 0.6, a: 0.05, contour: [[0, f0 * up], [0.3, f0], [1, f0 * 0.85]], vowels: ['e', 'a', 'o'], breath: 0.15, rough: 0.1, peak: 0.05 });
        break;
      }
      case 'laughFar': {
        const fv = new Fx(this.ac, this.out, this.rng, { vol: 0.4, pan: r.range(-0.9, 0.9) });
        const f0 = r.range(140, 260);
        for (let i = 0; i < r.int(3, 6); i++) fv.voice(t + i * 0.13, { dur: 0.08, a: 0.01, release: 0.05, contour: [[0, f0 * (1.1 - i * 0.03)], [1, f0 * (0.95 - i * 0.03)]], vowels: ['a'], breath: 0.4, peak: 0.05 });
        break;
      }
      case 'hoof': {
        // A horse led across the cobbles: four-beat walk, a jingle of tack.
        const n = r.int(6, 12);
        const pan = r.range(-0.9, 0.9);
        for (let i = 0; i < n; i++) {
          const tt = t + i * 0.27 + (i % 2 ? 0.05 : 0) + r.range(0, 0.02);
          fx.modes(tt, { f: r.range(900, 1300), ratios: [1, 2.2], decays: [0.03, 0.015], peak: 0.02, pan: pan + i * 0.03 });
          fx.burst(tt, { dur: 0.03, peak: 0.02, filters: [{ type: 'bandpass', f: 600, q: 1.5 }], pan: pan + i * 0.03 });
        }
        fx.grains(t + 0.2, { count: 6, spread: n * 0.25, fLo: 5000, fHi: 8000, q: 8, peak: 0.01 });
        break;
      }
      case 'coinsFar': {
        for (let i = 0; i < r.int(3, 7); i++) fx.modes(t + i * r.range(0.03, 0.08), { f: r.range(3000, 5200), ratios: [1, 2.7], decays: [0.12, 0.05], peak: 0.012 });
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
    // Anchor at the level the fade-in has reached (never trust a stale event).
    const [a, b] = this._fadeIn;
    const v = t >= b ? this.level : t <= a ? 0.0001 : 0.0001 + ((this.level - 0.0001) * (t - a)) / (b - a);
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, v), t);
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

/** One-pole-free RBJ bandpass applied in place (constant-skirt), for offline rendering. */
function bandpassInPlace(x, sr, f, q, from, to, st) {
  const w0 = (2 * Math.PI * f) / sr;
  const al = Math.sin(w0) / (2 * q);
  const a0 = 1 + al;
  const b0 = al / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - al) / a0;
  for (let i = from; i < to; i++) {
    const v = b0 * x[i] - b0 * st.x2 - a1 * st.y1 - a2 * st.y2;
    st.x2 = st.x1;
    st.x1 = x[i];
    st.y2 = st.y1;
    st.y1 = v;
    x[i] = v;
  }
}

/**
 * Market walla, rendered once per sample rate: twelve speakers at different
 * distances and seats, each talking in phrases of syllables (glottal source,
 * jitter and drifting intonation, two formants that jump syllable to syllable,
 * pauses for breath), muffled by distance. A 12 s seamless stereo loop.
 */
export function wallaData(sr, seed = 1) {
  const rng = new AudioRng(seed * 7919);
  const secs = 12;
  const N = Math.ceil(sr * secs);
  const xf = Math.floor(sr * 0.5);
  const L = new Float32Array(N + xf);
  const R = new Float32Array(N + xf);
  const VOW = [[730, 1090], [530, 1840], [290, 2250], [570, 840], [440, 1020], [660, 1700], [400, 1900]];
  for (let s = 0; s < 12; s++) {
    const fem = rng.chance(0.45);
    const f0 = (fem ? 205 : 118) * rng.range(0.85, 1.2);
    const dist = rng.range(0.3, 1);
    const pan = rng.range(-1, 1);
    // A wandering intonation contour across the whole loop.
    const pts = [];
    for (let k = 0; k <= 40; k++) pts.push([k / 40, f0 * (1 + rng.gauss(0.08))]);
    const src = glottal(sr, { dur: secs + 0.5, contour: pts, jitter: 0.02, shimmer: 0.1, walk: 0.01, breath: 0.25, seed: rng.int(1, 1e9) });
    const env = new Float32Array(src.length);
    const sts = [{ x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }];
    const a = new Float32Array(src.length);
    const b = new Float32Array(src.length);
    a.set(src);
    b.set(src);
    let i = Math.floor(rng.range(0, 1.2) * sr);
    while (i < src.length) {
      // A phrase of 3–9 syllables, then a pause.
      const n = rng.int(3, 9);
      for (let k = 0; k < n && i < src.length; k++) {
        const len = Math.floor(rng.range(0.1, 0.26) * sr);
        const v = rng.pick(VOW);
        const to = Math.min(src.length, i + len);
        bandpassInPlace(a, sr, v[0] * (fem ? 1.15 : 1), 5, i, to, sts[0]);
        bandpassInPlace(b, sr, v[1] * (fem ? 1.15 : 1), 7, i, to, sts[1]);
        const pk = rng.range(0.5, 1) * (k === 0 ? 1.15 : 1) * (1 - (k / n) * 0.3);
        for (let j = i; j < to; j++) {
          const u = (j - i) / len;
          env[j] = pk * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
        }
        i = to + Math.floor(rng.range(0, 0.05) * sr);
      }
      i += Math.floor(rng.range(0.25, 1.4) * sr);
    }
    // Distance: quieter and duller further away (one-pole lowpass).
    const lpk = Math.exp((-2 * Math.PI * (1200 + 2600 * (1 - dist))) / sr);
    const gain = 0.12 * (1.2 - dist);
    const gl = gain * Math.sqrt(0.5 * (1 - pan));
    const gr = gain * Math.sqrt(0.5 * (1 + pan));
    let y = 0;
    for (let j = 0; j < Math.min(src.length, N + xf); j++) {
      y = (1 - lpk) * (a[j] + b[j] * 0.6) * env[j] + lpk * y;
      L[j] += y * gl;
      R[j] += y * gr;
    }
  }
  // Seamless loop: crossfade the tail into the head.
  for (let j = 0; j < xf; j++) {
    const u = j / xf;
    L[j] = L[j] * u + L[N + j] * (1 - u);
    R[j] = R[j] * u + R[N + j] * (1 - u);
  }
  return [L.subarray(0, N), R.subarray(0, N)];
}
