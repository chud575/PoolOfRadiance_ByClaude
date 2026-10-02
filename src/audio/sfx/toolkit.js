import { kbq } from '../instruments/base.js';
import { noiseBuffer, noiseOffset } from '../dsp/bank.js';
import { glottal } from '../dsp/synth.js';

/**
 * Tiny synthesis toolkit for one-shot sound effects. Every helper schedules
 * nodes at absolute AudioContext time `t` and lets them free themselves.
 */
export class Fx {
  /**
   * @param {BaseAudioContext} ac
   * @param {AudioNode} out  destination (bus input)
   * @param {import('../core/rng.js').AudioRng} rng
   * @param {{pitch?:number, vol?:number, pan?:number, send?:AudioNode, sendLevel?:number}} [o]
   */
  constructor(ac, out, rng, o = {}) {
    this.ac = ac;
    this.rng = rng;
    this.pitch = o.pitch ?? 1;
    // Per-sound output: volume + pan + reverb send.
    this.out = ac.createGain();
    this.out.gain.value = o.vol ?? 1;
    const p = ac.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    if (o.limit) {
      // Transient safety for blows and blasts: a fast peak limiter on this
      // sound alone, so its 0.5 ms edge click never reaches 0 dBFS and the
      // master limiter is not doing the work (the body is untouched).
      const lim = ac.createDynamicsCompressor();
      // (A high threshold: the node adds automatic make-up gain that grows as the threshold drops.)
      lim.threshold.value = -6;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.0005;
      lim.release.value = 0.08;
      this.out.connect(lim).connect(p).connect(out);
    } else this.out.connect(p).connect(out);
    if (o.send) {
      const s = ac.createGain();
      s.gain.value = o.sendLevel ?? 0.25;
      this.out.connect(s).connect(o.send);
    }
  }

  _dest(o) {
    if (o.pan === undefined) return o.dest ?? this.out;
    const p = this.ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    p.connect(o.dest ?? this.out);
    return p;
  }

  _filters(src, filters = [], t, dur) {
    let n = src;
    for (const f of filters) {
      const b = kbq(this.ac);
      b.type = f.type ?? 'lowpass';
      const f0 = Math.min(20000, f.f * (f.noPitch ? 1 : this.pitch));
      b.frequency.setValueAtTime(f0, t);
      if (f.f1 !== undefined) {
        const f1 = Math.max(20, Math.min(20000, f.f1 * (f.noPitch ? 1 : this.pitch)));
        if (f.lin) b.frequency.linearRampToValueAtTime(f1, t + (f.dt ?? dur));
        else b.frequency.exponentialRampToValueAtTime(f1, t + (f.dt ?? dur));
      }
      if (f.q !== undefined) b.Q.value = f.q;
      if (f.g !== undefined) b.gain.value = f.g;
      n.connect(b);
      n = b;
    }
    return n;
  }

  /** Envelope: attack a, then exponential decay over d (to -60 dB-ish). Optional hold. */
  _env(g, t, { a = 0.003, d = 0.2, peak = 0.5, hold = 0, curve = 'exp' }) {
    g.gain.setValueAtTime(0.00001, t);
    if (curve === 'lin') g.gain.linearRampToValueAtTime(peak, t + a);
    else g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.setTargetAtTime(0, t + a + hold, d / 4);
    return t + a + hold + d * 1.4;
  }

  /** Filtered noise burst. */
  burst(t, o = {}) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, o.kind ?? 'white');
    if (o.rate) src.playbackRate.value = o.rate;
    const g = ac.createGain();
    const end = this._env(g, t, { a: o.a ?? 0.002, d: o.dur ?? 0.15, peak: o.peak ?? 0.4, hold: o.hold ?? 0, curve: o.curve });
    this._filters(src, o.filters, t, o.sweep ?? o.dur ?? 0.15).connect(g).connect(this._dest(o));
    src.start(t, noiseOffset(this.rng, 3));
    src.stop(end + 0.05);
    return g;
  }

  /** Oscillator tone with optional pitch glide (f → f1 over glide seconds). */
  tone(t, o = {}) {
    const ac = this.ac;
    const osc = ac.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type ?? 'sine';
    const f = o.f * this.pitch;
    osc.frequency.setValueAtTime(f, t);
    if (o.f1) {
      const f1 = o.f1 * this.pitch;
      if (o.linGlide) osc.frequency.linearRampToValueAtTime(f1, t + (o.glide ?? o.dur ?? 0.2));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (o.glide ?? o.dur ?? 0.2));
    }
    if (o.vib) {
      const l = ac.createOscillator();
      l.frequency.value = o.vib[0];
      const lg = ac.createGain();
      lg.gain.value = f * o.vib[1];
      l.connect(lg).connect(osc.frequency);
      l.start(t);
      l.stop(t + (o.dur ?? 0.2) * 1.6 + (o.hold ?? 0) + 0.1);
    }
    if (o.detune) osc.detune.value = o.detune;
    const g = ac.createGain();
    const end = this._env(g, t, { a: o.a ?? 0.003, d: o.dur ?? 0.2, peak: o.peak ?? 0.3, hold: o.hold ?? 0, curve: o.curve });
    this._filters(osc, o.filters, t, o.dur ?? 0.2).connect(g).connect(this._dest(o));
    osc.start(t);
    osc.stop(end + 0.05);
    return { osc, g };
  }

  /** Bank of decaying sine partials — bells, metal, glass, wood. */
  modes(t, o) {
    const dest = this._dest(o);
    const f0 = o.f;
    o.ratios.forEach((r, i) => {
      const f = f0 * r * this.pitch * (1 + (o.jitter ?? 0) * (this.rng.next() - 0.5));
      if (f > 18000) return;
      this.tone(t, { f, dur: (o.decays[i] ?? o.decays[0]) * (o.decay ?? 1), peak: (o.amps?.[i] ?? 1 / (i + 1)) * (o.peak ?? 0.3), a: o.a ?? 0.001, dest, f1: o.bend ? f * o.bend : undefined, glide: o.glide });
    });
  }

  /** Many tiny noise grains (gravel, crackle, rattles). */
  grains(t, o) {
    const n = o.count ?? 10;
    for (let i = 0; i < n; i++) {
      const tt = t + (o.curve ? Math.pow(this.rng.next(), o.curve) : this.rng.next()) * (o.spread ?? 0.1);
      const f = this.rng.range(o.fLo ?? 1500, o.fHi ?? 5000);
      this.burst(tt, { dur: this.rng.range(o.dLo ?? 0.004, o.dHi ?? 0.02), peak: (o.peak ?? 0.2) * this.rng.range(0.3, 1), filters: [{ type: 'bandpass', f, q: o.q ?? 3 }], pan: o.pan !== undefined ? o.pan + this.rng.range(-0.2, 0.2) : undefined, dest: o.dest });
    }
  }

  /**
   * Formant voice (monster vocalisations, shouts, sung spell chords). The
   * source is a glottal pulse train (dsp/synth.js glottal) with jitter,
   * shimmer and a random-walk pitch around the written contour; rough voices
   * add subharmonic period doubling (the growl) and noise AM, breathy ones
   * aspiration pulsed with the folds. It runs through a vowel filter bank
   * that morphs between vowels; `drive` saturates (DC-blocked after the
   * shaper). `type` forces a plain oscillator (a pure howl), `whisper` noise.
   * contour: [[timeFrac, f0], ...]  vowels: ['a','o',...] spread over dur.
   */
  voice(t, o) {
    const ac = this.ac;
    const dur = o.dur ?? 0.6;
    const out = ac.createGain();
    const end = this._env(out, t, { a: o.a ?? 0.04, d: o.release ?? 0.15, peak: o.peak ?? 0.4, hold: Math.max(0, dur - (o.a ?? 0.04)), curve: 'lin' });
    let dest = this._dest(o);
    if (o.drive) {
      const ws = ac.createWaveShaper();
      const k = o.drive * 40;
      const N = 1024;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      ws.curve = curve;
      // Distortion adds a lot of energy: compensate so driven roars sit level.
      const post = ac.createGain();
      post.gain.value = 0.5 / (1 + o.drive * 1.6);
      // DC blocker after the shaper.
      const dc = kbq(ac);
      dc.type = 'highpass';
      dc.frequency.value = 30;
      dc.Q.value = 0.6;
      ws.connect(post).connect(dc).connect(dest);
      dest = ws;
    }
    out.connect(dest);
    // Source
    const src = [];
    const mix = ac.createGain();
    let head = mix;
    if (o.whisper) {
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(ac, 'pink');
      n.connect(mix);
      src.push(n);
      n.start(t, noiseOffset(this.rng, 3));
    } else {
      const contour = o.contour ?? [[0, 120], [1, 100]];
      const rough = o.rough ?? 0;
      for (let v = 0; v < (o.voices ?? 1); v++) {
        const det = 1 + (v ? (v % 2 ? 1 : -1) * 0.012 * v : 0);
        if (o.type) {
          const osc = ac.createOscillator();
          osc.type = o.type;
          osc.frequency.setValueAtTime(contour[0][1] * this.pitch * det, t);
          for (const [k, f] of contour.slice(1)) osc.frequency.linearRampToValueAtTime(f * this.pitch * det, t + k * dur);
          if (o.vib) {
            const l = ac.createOscillator();
            l.frequency.value = o.vib[0];
            const lg = ac.createGain();
            lg.gain.value = contour[0][1] * o.vib[1] * this.pitch;
            l.connect(lg).connect(osc.frequency);
            l.start(t);
            src.push(l);
          }
          osc.connect(mix);
          osc.start(t);
          src.push(osc);
          continue;
        }
        // Each voice of a group is its own throat (own seed, own jitter).
        const len = dur + (o.release ?? 0.15) * 1.6 + 0.05;
        const data = glottal(ac.sampleRate, {
          dur: len,
          contour: contour.map(([k, f]) => [(k * dur) / len, f * this.pitch * det]),
          jitter: o.jitter ?? 0.012 + rough * 0.018,
          shimmer: o.shimmer ?? 0.06 + rough * 0.12,
          walk: o.walk ?? 0.004 + rough * 0.006,
          sub: o.sub ?? (rough > 0.45 ? Math.min(0.8, (rough - 0.3) * 1.1) : 0),
          breath: (o.breath ?? 0.04) * 1.2,
          vib: o.vib,
          open: o.open ?? (rough > 0.5 ? 0.5 : 0.62),
          seed: Math.floor(this.rng.next() * 1e9),
        });
        const b = ac.createBuffer(1, data.length, ac.sampleRate);
        b.copyToChannel(data, 0);
        const bs = ac.createBufferSource();
        bs.buffer = b;
        const vg = ac.createGain();
        vg.gain.value = 1.5;
        bs.connect(vg).connect(mix);
        bs.start(t);
        src.push(bs);
      }
      if (rough) {
        // Growl: amplitude modulation by low-passed noise (vocal-fold chaos).
        const n = ac.createBufferSource();
        n.buffer = noiseBuffer(ac, 'white');
        const lp = kbq(ac);
        lp.type = 'lowpass';
        lp.frequency.value = o.roughRate ?? 60;
        const ng = ac.createGain();
        ng.gain.value = rough * 2.2;
        const am = ac.createGain();
        am.gain.value = 1;
        n.connect(lp).connect(ng).connect(am.gain);
        mix.connect(am);
        n.start(t, noiseOffset(this.rng, 3));
        src.push(n);
        head = am;
      }
      if (o.breath && o.type) {
        const n = ac.createBufferSource();
        n.buffer = noiseBuffer(ac, 'white');
        const ng = ac.createGain();
        ng.gain.value = o.breath;
        n.connect(ng).connect(head);
        n.start(t, noiseOffset(this.rng, 3));
        src.push(n);
      }
    }
    if (o.pulse) {
      // Pulsed phonation (croaks, purrs, sobs): amplitude chopped at o.pulse[0] Hz, depth o.pulse[1].
      const am = ac.createGain();
      am.gain.value = 1 - o.pulse[1] * 0.5;
      const l = ac.createOscillator();
      l.type = 'square';
      l.frequency.setValueAtTime(o.pulse[0], t);
      if (o.pulse[2]) l.frequency.linearRampToValueAtTime(o.pulse[2], t + dur);
      const sm = kbq(ac);
      sm.type = 'lowpass';
      sm.frequency.value = o.pulse[0] * 3;
      const lg = ac.createGain();
      lg.gain.value = o.pulse[1] * 0.5;
      l.connect(sm).connect(lg).connect(am.gain);
      l.start(t);
      src.push(l);
      head.connect(am);
      head = am;
    }
    const V = {
      a: [[800, 1, 8], [1200, 0.5, 9], [2500, 0.2, 11]],
      o: [[500, 1, 8], [850, 0.5, 9], [2400, 0.12, 11]],
      u: [[330, 1, 7], [700, 0.3, 9], [2300, 0.06, 11]],
      e: [[480, 1, 8], [1800, 0.4, 10], [2600, 0.2, 11]],
      i: [[300, 1, 8], [2300, 0.35, 11], [3000, 0.2, 12]],
      r: [[420, 1, 5], [1100, 0.6, 5], [1700, 0.3, 6]], // growly, broad
    };
    const vs = (o.vowels ?? ['a']).map((k) => V[k]);
    const scale = o.formant ?? 1;
    for (let fi = 0; fi < 3; fi++) {
      const bp = kbq(ac);
      bp.type = 'bandpass';
      bp.Q.value = vs[0][fi][2] * (o.qScale ?? 1);
      bp.frequency.setValueAtTime(vs[0][fi][0] * scale, t);
      vs.forEach((v, k) => k && bp.frequency.linearRampToValueAtTime(v[fi][0] * scale, t + (k / (vs.length - 1)) * dur));
      const g = ac.createGain();
      g.gain.value = vs[0][fi][1] * 3;
      head.connect(bp).connect(g).connect(out);
    }
    for (const s of src) s.stop(end + 0.1);
    return end;
  }
}
