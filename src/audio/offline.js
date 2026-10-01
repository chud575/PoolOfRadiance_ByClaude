import { createGraph } from './graph.js';
import { TrackPlayer } from './music/Sequencer.js';
import { SONGS, STINGERS } from './music/songs.js';
import { SFX } from './sfx/library.js';
import { Fx } from './sfx/toolkit.js';
import { Ambience, BEDS } from './sfx/ambience.js';
import { AudioRng } from './core/rng.js';
import { PRESETS, createInstrument } from './instruments/index.js';

/**
 * Offline rendering of every cue (OfflineAudioContext) — used by
 * tools/audiorender.mjs to write WAVs for review, and handy in devtools:
 *   const m = await import('/src/audio/offline.js'); m.listCues();
 */
const SURFACES = ['stone', 'cobble', 'gravel', 'dirt', 'grass', 'wood', 'water'];
const LONG_SFX = /^(spell_|door|vox_dragon|vox_ogre|vox_ghost|vox_zombie|vox_wolf|chest|trap|potion)/;

export function listCues() {
  const cues = [];
  for (const id of Object.keys(SONGS)) cues.push(`music_${id}`);
  for (const id of Object.keys(STINGERS)) cues.push(`sting_${id}`);
  for (const id of Object.keys(BEDS)) if (id !== 'silence') {
    cues.push(`amb_${id}`);
    if (BEDS[id].night) cues.push(`amb_${id}_night`);
  }
  for (const s of SURFACES) cues.push(`sfx_step_${s}`);
  for (const id of Object.keys(SFX)) if (id !== 'step') cues.push(`sfx_${id}`);
  for (const id of Object.keys(PRESETS)) cues.push(`inst_${id}`);
  cues.push('demo_combat_adaptive', 'demo_crossfade');
  return cues;
}

function cueSpec(name) {
  if (name.startsWith('music_')) {
    const song = SONGS[name.slice(6)];
    if (!song) throw new Error(`no song ${name}`);
    const r = song.build(0, new AudioRng(1));
    const secs = Math.min(100, (r.lengthQ + (r.tailQ ?? 0)) * (60 / song.bpm) + (song.loop ? 1.5 : 3));
    return {
      seconds: secs,
      room: 'street',
      setup(ac, g) {
        const p = new TrackPlayer(ac, song, { dest: g.musicIn, send: g.musicSend, at: 0.05, intensity: song.id === 'combat' ? 0.8 : undefined });
        p.tick(secs);
        if (song.loop) {
          // Fade the last 1.5 s so the file ends cleanly.
          g.musicIn.gain.setValueAtTime(1, secs - 1.6);
          g.musicIn.gain.linearRampToValueAtTime(0, secs - 0.1);
        }
      },
    };
  }
  if (name.startsWith('sting_')) {
    const song = STINGERS[name.slice(6)];
    const r = song.build(0, new AudioRng(1));
    const secs = (r.lengthQ + (r.tailQ ?? 0)) * (60 / song.bpm) + 2.5;
    return { seconds: secs, room: 'street', setup(ac, g) { new TrackPlayer(ac, song, { dest: g.musicBus, send: g.musicSend, at: 0.05 }).tick(secs); } };
  }
  if (name.startsWith('amb_')) {
    const night = name.endsWith('_night');
    const bed = name.slice(4).replace(/_night$/, '');
    const room = bed === 'dungeon' || bed === 'combat_in' ? 'dungeon' : bed === 'interior' ? 'room' : 'open';
    return {
      seconds: 24,
      room,
      setup(ac, g) {
        const a = new Ambience(ac, g.ambBus, g.envSend, bed, { night, at: 0, fade: 1.5, seed: 99 });
        a.tick(24);
        g.ambBus.gain.setValueAtTime(1, 22);
        g.ambBus.gain.linearRampToValueAtTime(0, 23.9);
      },
    };
  }
  if (name.startsWith('sfx_step_')) {
    const surface = name.slice(9);
    return {
      seconds: 4.2,
      room: surface === 'wood' ? 'room' : surface === 'stone' ? 'dungeon' : 'street',
      setup(ac, g) {
        const rng = new AudioRng(5);
        for (let i = 0; i < 6; i++) SFX.step(new Fx(ac, g.sfxIn, rng, { send: g.envSend, sendLevel: 0.3 }), 0.1 + i * 0.62, { surface });
      },
    };
  }
  if (name.startsWith('sfx_')) {
    const id = name.slice(4);
    const fn = SFX[id];
    if (!fn) throw new Error(`no sfx ${id}`);
    const long = LONG_SFX.test(id);
    return {
      seconds: long ? 4 : 2,
      room: 'dungeon',
      setup(ac, g) {
        const fx = new Fx(ac, /^(click|hover|confirm|cancel|error|page|open|close|map|save)$/.test(id) ? g.uiBus : g.sfxIn, new AudioRng(7), { send: g.envSend, sendLevel: 0.25 });
        fn(fx, 0.08, { surface: 'stone' });
      },
    };
  }
  if (name.startsWith('inst_')) {
    const id = name.slice(5);
    const low = /bass|celli|lowbrass|taiko|timpani|boom|bassoon|drone|gurdy|organ/.test(id) ? 36 : /choir/.test(id) ? 48 : /glock|celesta|harmonics|recorder|flute|violins/.test(id) ? 72 : 60;
    return {
      seconds: 7,
      room: 'street',
      setup(ac, g) {
        const ins = createInstrument(ac, id, g.musicIn, g.musicSend, 9);
        const notes = [0, 4, 7, 12];
        notes.forEach((n, i) => ins.play(0.1 + i * 0.6, low + n, 0.5, 0.45 + i * 0.12, {}));
        [0, 4, 7].forEach((n) => ins.play(2.7, low + n, 2.2, 0.7, {}));
      },
    };
  }
  if (name === 'demo_combat_adaptive') {
    return {
      seconds: 56,
      room: 'street',
      setup(ac, g) {
        const p = new TrackPlayer(ac, SONGS.combat, { dest: g.musicIn, send: g.musicSend, at: 0.05, intensity: 0 });
        // Intensity automation: 0 → 0.5 at 14 s → 1 at 28 s → back to 0.4 at 46 s.
        const marks = [[14, 0.5], [28, 1], [46, 0.4]];
        p.tick(56);
        for (const L of p.layers.keys()) {
          const lg = p.layers[L];
          for (const [tt, x] of marks) {
            const v = Math.max(0.0001, p._layerGain(L, x));
            lg.g.gain.setTargetAtTime(v, tt, 0.6);
            lg.s.gain.setTargetAtTime(v, tt, 0.6);
          }
        }
        g.musicIn.gain.setValueAtTime(1, 54);
        g.musicIn.gain.linearRampToValueAtTime(0, 55.9);
      },
    };
  }
  if (name === 'demo_crossfade') {
    return {
      seconds: 40,
      room: 'street',
      setup(ac, g) {
        const a = new TrackPlayer(ac, SONGS.town, { dest: g.musicIn, send: g.musicSend, at: 0.05 });
        a.tick(18);
        a.out.gain.setValueAtTime(a.out.gain.value, 16);
        a.out.gain.exponentialRampToValueAtTime(0.0001, 19);
        const b = new TrackPlayer(ac, SONGS.ruins, { dest: g.musicIn, send: g.musicSend, at: 16, fadeIn: 2.5 });
        b.tick(40);
        new Ambience(ac, g.ambBus, g.envSend, 'town', { at: 0, fade: 1, seed: 3 }).tick(16);
        const r = new Ambience(ac, g.ambBus, g.envSend, 'ruins', { at: 16, fade: 2.5, seed: 4 });
        r.tick(40);
      },
    };
  }
  throw new Error(`unknown cue ${name}`);
}

/**
 * @param {string} name
 * @param {{sampleRate?: number}} [o]
 * @returns {Promise<AudioBuffer>}
 */
export async function renderCue(name, { sampleRate = 44100 } = {}) {
  const spec = cueSpec(name);
  const ac = new OfflineAudioContext(2, Math.ceil(spec.seconds * sampleRate), sampleRate);
  const g = createGraph(ac);
  g.master.gain.value = 0.9;
  g.musicBus.gain.value = 0.85;
  g.sfxBus.gain.value = 0.9;
  g.ambBus.gain.value = 0.9;
  g.uiBus.gain.value = 0.9;
  g.setRoom(spec.room, 0);
  spec.setup(ac, g);
  return ac.startRendering();
}

/** Peak / RMS / clipping stats. */
export function stats(buf) {
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
  return { peak, rms, clip, nan, seconds: buf.duration };
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
