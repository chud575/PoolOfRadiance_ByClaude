import { createGraph } from './graph.js';
import { TrackPlayer } from './music/Sequencer.js';
import { SONGS, STINGERS } from './music/songs.js';
import { SFX, LIMITED, WIDE } from './sfx/library.js';
import { Fx } from './sfx/toolkit.js';
import { Ambience, BEDS } from './sfx/ambience.js';
import { AudioRng } from './core/rng.js';
import { PRESETS, createInstrument } from './instruments/index.js';
import { ritSeconds } from './music/Sequencer.js';
import { sfxGain } from './loudness.js';
import { AudioEngine } from './AudioEngine.js';

/**
 * Offline rendering of every cue (OfflineAudioContext) — used by
 * tools/audiorender.mjs to write WAVs for review, and handy in devtools:
 *   const m = await import('/src/audio/offline.js'); m.listCues();
 */
const SURFACES = ['stone', 'cobble', 'gravel', 'dirt', 'grass', 'wood', 'water'];
const UI_SFX = /^(click|hover|focus|confirm|cancel|error|page|open|close|map|save)$/;

/** Default bus levels of the live engine (AudioEngine._applyVolumes with default settings). */
export const LIVE_BUS = { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.6, ui: 0.68 };

export function listCues() {
  const cues = [];
  for (const id of Object.keys(SONGS)) cues.push(`music_${id}`);
  for (const id of Object.keys(STINGERS)) if (!SONGS[id]) cues.push(`sting_${id}`);
  for (const id of Object.keys(BEDS)) if (id !== 'silence') {
    cues.push(`amb_${id}`);
    if (BEDS[id].night) cues.push(`amb_${id}_night`);
  }
  for (const s of SURFACES) cues.push(`sfx_step_${s}`);
  for (const id of Object.keys(SFX)) if (id !== 'step') cues.push(`sfx_${id}`);
  for (const id of Object.keys(PRESETS)) cues.push(`inst_${id}`);
  cues.push('demo_combat_adaptive', 'demo_crossfade', 'demo_victory', 'demo_stall', 'demo_rest');
  return cues;
}

/**
 * The distinct sections (variants) a looping song plays, discovered by
 * building its passes (rest windows excluded).
 */
export function songSections(id) {
  const song = SONGS[id];
  if (!song?.loop) return [];
  const st = {};
  const seen = new Set();
  for (let p = 0; p < 24; p++) {
    const r = song.build(p, new AudioRng(p + 1), st);
    if (r.section) seen.add(r.section);
  }
  return [...seen];
}

/** A copy of `song` whose every pass is section `sec` (replays the pass sequence until it comes up). */
function forceSection(song, sec) {
  let found = null;
  const st = {};
  for (let p = 0; p < 64 && !found; p++) {
    const r = song.build(p, new AudioRng(p + 1), st);
    if (r.section === sec) found = { p };
  }
  if (!found) throw new Error(`${song.id}: no section ${sec}`);
  return {
    ...song,
    build() {
      const st2 = {};
      let r;
      for (let p = 0; p <= found.p; p++) r = song.build(p, new AudioRng(p + 1), st2);
      return r;
    },
  };
}

/** Seconds of `n` passes of a song (honours ritardandi; sections are equal-length per song). */
function passesSeconds(song, n) {
  const spq = 60 / song.bpm;
  const state = {};
  let secs = 0;
  let last = null;
  for (let p = 0; p < n; p++) {
    const r = song.build(p, new AudioRng(p + 1), state);
    secs += ritSeconds(r.lengthQ, r.rit ?? [], spq);
    last = r;
  }
  return { secs, tail: (last?.tailQ ?? 0) * spq };
}

/**
 * @param {string} name
 * @param {{passes?: number, raw?: boolean, gain?: number}} [o] raw: ignore the
 *   calibration table (render at `gain`, default 1) — used by the calibrator.
 */
function cueSpec(name, o = {}) {
  const gainOpt = o.raw ? { rawGain: true, gainOverride: o.gain ?? 1 } : {};
  if (o.cal) gainOpt.cal = o.cal;
  if (o.noComp) gainOpt.noComp = true;
  const isSong = name.startsWith('music_') || name.startsWith('sting_');
  if (isSong) {
    const id = name.replace(/^(music|sting)_/, '');
    let song = SONGS[id] ?? STINGERS[id];
    if (!song) throw new Error(`no song ${name}`);
    if (o.section) song = forceSection(song, o.section);
    const passes = song.loop ? Math.max(1, o.passes ?? 1) : 1;
    const { secs: body, tail } = passesSeconds(song, passes);
    const cap = o.maxSeconds ?? (o.passes ? 600 : 100);
    const secs = Math.min(cap, body + (song.loop ? 1.5 : tail + 2.5));
    return {
      seconds: secs,
      room: 'street',
      setup(ac, g) {
        g.setMusicRoom(song.room ?? 'hall', 0, song.wet ?? 0.5);
        const p = new TrackPlayer(ac, song, { dest: g.musicIn, send: g.musicSend, at: 0.05, intensity: o.intensity ?? song.calIntensity, ...gainOpt });
        for (let x = 1; x <= Math.ceil(secs); x++) p.tick(Math.min(secs, x));
        if (song.loop) {
          // Fade the last 1.5 s so the file ends cleanly.
          g.musicIn.gain.setValueAtTime(1, secs - 1.6);
          g.musicIn.gain.linearRampToValueAtTime(0, secs - 0.1);
        }
      },
    };
  }
  if (name.startsWith('amb_')) {
    const night = name.endsWith('_night');
    const bed = name.slice(4).replace(/_night$/, '');
    const room = bed === 'dungeon' || bed === 'combat_in' ? 'dungeon' : bed === 'interior' ? 'room' : 'open';
    return {
      seconds: 30,
      room,
      setup(ac, g) {
        const a = new Ambience(ac, g.ambBus, g.envSend, bed, { night, at: 0, fade: 1.5, seed: 99, ...(o.raw ? { gain: o.gain ?? 1 } : {}) });
        a.tick(30);
        g.ambBus.gain.setValueAtTime(LIVE_BUS.ambience, 28);
        g.ambBus.gain.linearRampToValueAtTime(0, 29.9);
      },
    };
  }
  if (name.startsWith('sfx_step_')) {
    const surface = name.slice(9);
    const vol = o.raw ? o.gain ?? 1 : sfxGain(`step_${surface}`);
    return {
      seconds: 4.4,
      room: surface === 'wood' ? 'room' : surface === 'stone' ? 'dungeon' : 'street',
      setup(ac, g) {
        const rng = new AudioRng(5);
        for (let i = 0; i < 6; i++) SFX.step(new Fx(ac, g.sfxIn, rng, { send: g.envSend, sendLevel: 0.3, vol }), 0.1 + i * 0.62, { surface });
      },
    };
  }
  if (name.startsWith('sfx_')) {
    const id = name.slice(4);
    const fn = SFX[id];
    if (!fn) throw new Error(`no sfx ${id}`);
    const vol = o.raw ? o.gain ?? 1 : sfxGain(id);
    return {
      // Rendered long, then trimmed to the cue's real tail (-80 dBFS).
      seconds: /^(spell_|door|vox_dragon|vox_ogre|vox_troll|vox_giant|vox_ghost|vox_zombie|vox_wolf|vox_frog|omen|levelup|chest|trap|potion)/.test(id) ? 7 : 4,
      trim: true,
      room: 'dungeon',
      setup(ac, g) {
        const fx = new Fx(ac, UI_SFX.test(id) ? g.uiBus : g.sfxIn, new AudioRng(7), { send: g.envSend, sendLevel: 0.25, vol, limit: LIMITED.test(id), wide: WIDE.test(id) ? 1 : 0 });
        fn(fx, 0.08, { surface: 'stone' });
      },
    };
  }
  if (name.startsWith('inst_')) {
    const id = name.slice(5);
    const low = /bass|celli|lowbrass|taiko|timpani|boom|bassoon|drone|gurdy|organ/.test(id) ? 36 : /choir/.test(id) ? 48 : /glock|celesta|harmonics|recorder|flute|violins/.test(id) ? 72 : 60;
    return {
      seconds: 15,
      room: 'street',
      setup(ac, g) {
        const ins = createInstrument(ac, id, g.musicIn, g.musicSend, 9);
        // A long messa di voce (p < f > p) on one note: the spectrum should bloom and darken with it.
        const swell = [0.3, 0.55, 0.85, 1, 0.8, 0.5, 0.3].map((v, i) => ({ t: 9.8 + i * 0.55, midi: low + 7, dur: 0.55, vel: v }));
        if (!/taiko|timpani|tom|frame|snare|tamb|crash|sus|hat|chime|boom|rim|Bell|bell|glock|celesta/.test(id)) ins.phrase(swell, { dip: 0 });
        // Brass articulations: a rip up into a note and a fall off it.
        if (/horn|brass/.test(id)) {
          ins.play(13.9, low + 12, 0.45, 0.9, { art: 'rip' });
          ins.play(14.45, low + 12, 0.3, 0.85, { art: 'fall' });
        }
        const notes = [0, 4, 7, 12];
        notes.forEach((n, i) => ins.play(0.1 + i * 0.6, low + n, 0.5, 0.45 + i * 0.12, {}));
        [0, 4, 7].forEach((n) => ins.play(2.7, low + n, 2.2, 0.7, {}));
        // A slurred scale run (legato phrase: glides, one envelope).
        const run = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0].map((n, i) => ({ t: 5.3 + i * 0.22, midi: low + n, dur: 0.22, vel: 0.6 + 0.2 * Math.sin((i / 14) * Math.PI) }));
        ins.phrase(run, {});
        if (/lute|gurdy/.test(id)) ins.play(8.9, low, 0.8, 0.7, { buzz: 2, strum: 0.02 });
      },
    };
  }
  if (name === 'demo_combat_adaptive') {
    return {
      seconds: 60,
      room: 'street',
      setup(ac, g) {
        const p = new TrackPlayer(ac, SONGS.combat, { dest: g.musicIn, send: g.musicSend, at: 0.05, intensity: 0.05 });
        // Intensity automation: calm → fight (14 s) → desperate (28 s) → winning (44 s).
        // Scheduled segment by segment, exactly as the live lookahead would.
        const marks = [[0, 0.05], [14, 0.5], [28, 1], [44, 0.35], [60, 0.35]];
        for (let i = 0; i < marks.length - 1; i++) {
          const [tt, x] = marks[i];
          p.intensity = x;
          p._applyIntensity(tt, i ? 0.6 : 0);
          for (let k = tt + 1; k <= marks[i + 1][0]; k++) p.tick(k);
        }
        g.musicIn.gain.setValueAtTime(1, 58);
        g.musicIn.gain.linearRampToValueAtTime(0, 59.9);
      },
    };
  }
  if (name === 'demo_victory') {
    // The fight is won 9.3 s in: combat plays on to the next downbeat, ends on its coda, the fanfare lands there.
    return {
      seconds: 22,
      room: 'street',
      setup(ac, g) {
        const p = new TrackPlayer(ac, SONGS.combat, { dest: g.musicIn, send: g.musicSend, at: 0.05, intensity: 0.6 });
        for (let k = 1; k <= 9; k++) p.tick(k);
        const won = 9.3;
        const bar = 4 * p.spq;
        const at = 0.05 + Math.ceil((won - 0.05 + 0.12) / bar) * bar;
        p.tick(at);
        const coda = p.endWithCoda(at);
        coda?.tick(at + 6);
        new TrackPlayer(ac, STINGERS.victory, { dest: g.musicBus, send: g.musicSend, at: at + 0.03 }).tick(22);
      },
    };
  }
  if (name === 'demo_crossfade') {
    // Through the live engine: AudioEngine.music()/ambience() drive the real
    // bar-quantised crossfade and per-cue room change; the scheduler ticks at
    // 50 ms from suspend points, exactly as the Worker clock does live.
    return {
      seconds: 44,
      room: 'street',
      setup(ac, g) {
        const e = AudioEngine.offline(ac, g);
        e.music('town', { fade: 1 });
        e.ambience('town', { fade: 1 });
        liveTicks(ac, e, 44, (t) => {
          if (t === 16) {
            e.music('ruins');
            e.ambience('ruins');
          }
        });
      },
    };
  }
  if (name === 'demo_stall') {
    // The main thread freezes for 1.2 s at 8 s (a map load): no ticks at all.
    // With the 1.8 s lookahead the music plays straight through — no gap, no burst.
    return {
      seconds: 20,
      room: 'street',
      setup(ac, g) {
        const e = AudioEngine.offline(ac, g);
        e.music('combat', { intensity: 0.7 });
        liveTicks(ac, e, 20, null, (t) => t > 8 && t < 9.2);
      },
    };
  }
  if (name === 'demo_rest') {
    // An exploration cue's rest window: music → ambience only → music again (rest forced early for review).
    return {
      seconds: 120,
      room: 'street',
      setup(ac, g) {
        const e = AudioEngine.offline(ac, g);
        e.music('wilds');
        e.player.restAfter = 50;
        e.player.restAnchor = 0;
        e.ambience('wilds');
        liveTicks(ac, e, 120);
      },
    };
  }
  throw new Error(`unknown cue ${name}`);
}

/**
 * Drive an offline AudioEngine like the live Worker clock: a tick every 50 ms
 * at render time (OfflineAudioContext.suspend), `at(t)` hooks on whole
 * seconds, and `stalled(t)` to simulate a frozen main thread.
 */
function liveTicks(ac, e, seconds, at = null, stalled = null) {
  const dt = 0.05;
  for (let i = 1; i * dt < seconds - 0.1; i++) {
    const t = Math.round(i * dt * 1000) / 1000;
    ac.suspend(t).then(() => {
      if (at && Math.abs(t - Math.round(t)) < 1e-6) at(Math.round(t));
      if (!stalled?.(t)) e._tick();
      ac.resume();
    });
  }
}

/** Copy of `buf` cut after its last sample above -80 dBFS (+ 0.25 s), at least 0.5 s long. */
function trimTail(ac, buf) {
  const thr = 1e-4;
  let last = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > thr) {
      last = i;
      break;
    }
  }
  const n = Math.min(buf.length, Math.max(Math.ceil(buf.sampleRate * 0.5), last + Math.ceil(buf.sampleRate * 0.25)));
  if (n >= buf.length) return buf;
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: n, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, n), c);
  return out;
}

/**
 * @param {string} name
 * @param {{sampleRate?: number, passes?: number, raw?: boolean, gain?: number}} [o]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderCue(name, { sampleRate = 44100, ...o } = {}) {
  const spec = cueSpec(name, o);
  const ac = new OfflineAudioContext(2, Math.ceil(spec.seconds * sampleRate), sampleRate);
  const g = createGraph(ac);
  g.master.gain.value = LIVE_BUS.master;
  g.musicBus.gain.value = LIVE_BUS.music;
  g.sfxBus.gain.value = LIVE_BUS.sfx;
  g.ambBus.gain.value = LIVE_BUS.ambience;
  g.uiBus.gain.value = LIVE_BUS.ui;
  g.setRoom(spec.room, 0);
  spec.setup(ac, g);
  const buf = await ac.startRendering();
  return spec.trim ? trimTail(ac, buf) : buf;
}

// ------------------------------------------------------------------ analysis
/** RBJ biquad coefficients (normalised) for the BS.1770 K-weighting stages. */
function kWeightCoefs(fs) {
  const shelf = (() => {
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const fc = 1681.974450955533;
    const A = 10 ** (G / 40);
    const w0 = (2 * Math.PI * fc) / fs;
    const al = Math.sin(w0) / (2 * Q);
    const cw = Math.cos(w0);
    const sA = Math.sqrt(A);
    const a0 = A + 1 - (A - 1) * cw + 2 * sA * al;
    return {
      b: [A * (A + 1 + (A - 1) * cw + 2 * sA * al) / a0, (-2 * A * (A - 1 + (A + 1) * cw)) / a0, (A * (A + 1 + (A - 1) * cw - 2 * sA * al)) / a0],
      a: [(2 * (A - 1 - (A + 1) * cw)) / a0, (A + 1 - (A - 1) * cw - 2 * sA * al) / a0],
    };
  })();
  const hp = (() => {
    const Q = 0.5003270373238773;
    const fc = 38.13547087602444;
    const w0 = (2 * Math.PI * fc) / fs;
    const al = Math.sin(w0) / (2 * Q);
    const cw = Math.cos(w0);
    const a0 = 1 + al;
    return { b: [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0], a: [(-2 * cw) / a0, (1 - al) / a0] };
  })();
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * ITU-R BS.1770-4 loudness: integrated (gated: -70 LUFS absolute, -10 LU
 * relative, 400 ms blocks with 75 % overlap) and momentary maximum.
 * @returns {{integrated: number, momentaryMax: number}}
 */
export function loudness(buf) {
  const fs = buf.sampleRate;
  const [s1, s2] = kWeightCoefs(fs);
  const chans = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(biquad(biquad(buf.getChannelData(c), s1), s2));
  const blk = Math.round(fs * 0.4);
  const hop = Math.round(fs * 0.1);
  const z = [];
  for (let st = 0; st + blk <= chans[0].length; st += hop) {
    let e = 0;
    for (const ch of chans) {
      let sum = 0;
      for (let i = st; i < st + blk; i++) sum += ch[i] * ch[i];
      e += sum / blk;
    }
    z.push(e);
  }
  if (!z.length) {
    let e = 0;
    for (const ch of chans) e += ch.reduce((a, v) => a + v * v, 0) / Math.max(1, ch.length);
    z.push(e);
  }
  const L = (e) => -0.691 + 10 * Math.log10(e + 1e-20);
  const momentaryMax = Math.max(...z.map(L));
  const abs = z.filter((e) => L(e) > -70);
  if (!abs.length) return { integrated: -Infinity, momentaryMax, spread: 0 };
  // Phrase-level dynamics: p10–p90 of the momentary loudness above the gate.
  const ms = abs.map(L).sort((x, y) => x - y);
  const spread = ms[Math.floor(ms.length * 0.9)] - ms[Math.floor(ms.length * 0.1)];
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const rel = L(mean(abs)) - 10;
  const gated = abs.filter((e) => L(e) > rel);
  return { integrated: L(mean(gated.length ? gated : abs)), momentaryMax, spread };
}

/** Pearson correlation of L and R (1 = mono, 0 = uncorrelated). */
export function correlation(buf) {
  if (buf.numberOfChannels < 2) return 1;
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < l.length; i++) {
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  return lr / Math.sqrt(ll * rr + 1e-30);
}

/** Side/mid energy ratio in dB (stereo width; an orchestral image sits around -6 to -9). */
export function stereoWidth(buf) {
  if (buf.numberOfChannels < 2) return -Infinity;
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  let m = 0;
  let s = 0;
  for (let i = 0; i < l.length; i++) {
    const a = (l[i] + r[i]) * 0.5;
    const b = (l[i] - r[i]) * 0.5;
    m += a * a;
    s += b * b;
  }
  return 10 * Math.log10((s + 1e-20) / (m + 1e-20));
}

/** Average spectrum energy per band (dB relative to the loudest band). */
export function bands(buf) {
  const N = 4096;
  const d = buf.getChannelData(0);
  const d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d;
  const sr = buf.sampleRate;
  const edges = { sub: [20, 60], bass: [60, 250], lowMid: [250, 500], mid: [500, 2000], upperMid: [2000, 4000], presence: [4000, 6000], brilliance: [6000, 10000], air: [10000, 16000] };
  const acc = Object.fromEntries(Object.keys(edges).map((k) => [k, 0]));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const frames = Math.min(200, Math.max(1, Math.floor(d.length / N)));
  const stride = Math.max(N, Math.floor(d.length / frames));
  for (let f = 0; f < frames; f++) {
    const st = f * stride;
    if (st + N > d.length) break;
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = (d[st + i] + d2[st + i]) * 0.5 * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const fr = (k * sr) / N;
      const p = re[k] * re[k] + im[k] * im[k];
      for (const [name, [a, b]] of Object.entries(edges)) if (fr >= a && fr < b) acc[name] += p;
    }
  }
  const max = Math.max(...Object.values(acc), 1e-20);
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(10 * Math.log10((v + 1e-20) / max) * 10) / 10]));
}

/** Peak / RMS / clipping stats, loudness (LUFS), stereo width. */
export function stats(buf, { full = false } = {}) {
  let peak = 0;
  let sum = 0;
  let clip = 0;
  let nan = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (Number.isNaN(v)) nan++;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
      sum += v * v;
    }
  }
  const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
  const out = { peak, rms, clip, nan, seconds: buf.duration };
  if (!nan) {
    const l = loudness(buf);
    out.lufs = l.integrated;
    out.lufsM = l.momentaryMax;
    out.spread = l.spread;
    out.width = stereoWidth(buf);
    out.corr = correlation(buf);
    if (full) out.bands = bands(buf);
  }
  return out;
}

/** 16-bit PCM WAV bytes (interleaved stereo), base64. */
export function wavBase64(buf) {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const dv = new DataView(bytes.buffer);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i]));
    dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    o += 2;
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Spectrogram + waveform PNG (data URL) for eyeballing a render.
 * Log-frequency axis 40 Hz – 16 kHz, dB colour map.
 */
export function spectrogramPng(buf, { width = 1200, height = 360 } = {}) {
  const d = buf.getChannelData(0);
  const d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d;
  const N = 2048;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height + 80;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b0d14';
  g.fillRect(0, 0, cv.width, cv.height);
  const img = g.createImageData(width, height);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const sr = buf.sampleRate;
  const fLo = 40;
  const fHi = 16000;
  for (let x = 0; x < width; x++) {
    const start = Math.floor((x / width) * Math.max(1, d.length - N));
    for (let i = 0; i < N; i++) {
      re[i] = ((d[start + i] ?? 0) + (d2[start + i] ?? 0)) * 0.5 * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < height; y++) {
      const f = fLo * Math.pow(fHi / fLo, 1 - y / height);
      const k = Math.min(N / 2 - 1, Math.round((f / sr) * N));
      const mag = Math.hypot(re[k], im[k]) / (N / 4);
      const db = 20 * Math.log10(mag + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 90) / 80));
      const p = (y * width + x) * 4;
      // inferno-ish
      img.data[p] = 255 * Math.min(1, v * 1.6);
      img.data[p + 1] = 255 * Math.max(0, Math.min(1, (v - 0.35) * 1.7));
      img.data[p + 2] = 255 * Math.max(0, Math.min(1, v < 0.4 ? v * 1.5 : (v - 0.75) * 3));
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Waveform (peak per column).
  g.fillStyle = '#7fb0ff';
  const mid = height + 40;
  for (let x = 0; x < width; x++) {
    const a = Math.floor((x / width) * d.length);
    const b = Math.floor(((x + 1) / width) * d.length);
    let mx = 0;
    for (let i = a; i < b; i++) mx = Math.max(mx, Math.abs(d[i]));
    g.fillRect(x, mid - mx * 38, 1, Math.max(1, mx * 76));
  }
  g.fillStyle = '#c9a85a';
  g.font = '12px monospace';
  for (const f of [100, 1000, 10000]) {
    const y = height * (1 - Math.log(f / fLo) / Math.log(fHi / fLo));
    g.fillRect(0, y, 8, 1);
    g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 10, y + 4);
  }
  for (let s = 0; s < buf.duration; s += buf.duration > 20 ? 10 : 1) {
    const x = (s / buf.duration) * width;
    g.fillRect(x, height, 1, 6);
    g.fillText(`${s}s`, x + 2, height + 14);
  }
  return cv.toDataURL('image/png');
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j];
        const ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
