/**
 * The procedural SFX library. Each entry is `(fx, t, opts) => void` where `fx`
 * is a toolkit bound to the destination bus (see toolkit.js) and `t` an
 * absolute AudioContext time. Names are what scenes pass to `audio.sfx()`.
 */

// ------------------------------------------------------------------ footsteps
function foot(fx, t, surface, v = 1, pan = 0) {
  const r = fx.rng;
  const p = { pan };
  switch (surface) {
    case 'gravel':
    case 'rubble':
      fx.grains(t, { count: 26, spread: 0.13, curve: 1.7, fLo: 1400, fHi: 6500, peak: 0.2 * v, ...p });
      fx.burst(t, { dur: 0.08, peak: 0.22 * v, filters: [{ type: 'lowpass', f: 650 }], ...p });
      fx.tone(t, { f: 85, f1: 55, dur: 0.06, peak: 0.18 * v, ...p });
      break;
    case 'dirt':
      fx.tone(t, { f: 80, f1: 52, dur: 0.07, peak: 0.32 * v, ...p });
      fx.burst(t, { dur: 0.08, peak: 0.22 * v, filters: [{ type: 'lowpass', f: 900 }], ...p });
      fx.grains(t + 0.01, { count: 6, spread: 0.06, fLo: 700, fHi: 2500, peak: 0.08 * v, ...p });
      break;
    case 'grass':
      fx.burst(t, { a: 0.03, dur: 0.16, peak: 0.1 * v, filters: [{ type: 'bandpass', f: 3800 * r.range(0.8, 1.2), q: 0.7 }], ...p });
      fx.grains(t, { count: 10, spread: 0.12, fLo: 2500, fHi: 8000, peak: 0.045 * v, ...p });
      fx.tone(t, { f: 75, f1: 50, dur: 0.06, peak: 0.16 * v, ...p });
      break;
    case 'wood':
      fx.tone(t, { f: 125, f1: 92, dur: 0.08, peak: 0.32 * v, ...p });
      fx.burst(t, { dur: 0.12, peak: 0.35 * v, filters: [{ type: 'bandpass', f: 190, q: 6 }], ...p });
      fx.burst(t, { dur: 0.06, peak: 0.16 * v, filters: [{ type: 'bandpass', f: 430, q: 5 }], ...p });
      fx.burst(t, { dur: 0.02, peak: 0.12 * v, filters: [{ type: 'bandpass', f: 2200, q: 1 }], ...p });
      if (r.chance(0.18)) creak(fx, t + 0.03, { rate: [35, 55], dur: 0.25, f: 900, peak: 0.05 * v, pan });
      break;
    case 'water':
      fx.burst(t, { dur: 0.22, peak: 0.3 * v, filters: [{ type: 'bandpass', f: 1300, f1: 600, q: 1.2 }], ...p });
      for (let i = 0; i < 4; i++) fx.tone(t + r.range(0.02, 0.18), { f: r.range(400, 1200), f1: r.range(1300, 2000), dur: 0.04, peak: 0.05 * v, ...p });
      break;
    case 'cobble':
    case 'stone':
    default: {
      fx.burst(t, { dur: 0.03, peak: 0.3 * v, filters: [{ type: 'bandpass', f: 1700 * r.range(0.85, 1.15), q: 1.4 }], ...p });
      fx.tone(t, { f: 95, f1: 60, dur: 0.06, peak: 0.28 * v, ...p });
      fx.burst(t + 0.035, { a: 0.012, dur: 0.06, peak: 0.05 * v, filters: [{ type: 'highpass', f: 3000 }], ...p });
      if (surface === 'cobble') fx.grains(t + 0.005, { count: 3, spread: 0.03, fLo: 2000, fHi: 4500, peak: 0.1 * v, ...p });
    }
  }
}

/** Stick–slip creak: a train of resonant micro-clicks at a gliding rate. */
function creak(fx, t, { rate = [40, 90], dur = 0.5, f = 1000, q = 14, peak = 0.12, pan } = {}) {
  let tt = t;
  while (tt < t + dur) {
    const k = (tt - t) / dur;
    const rr = rate[0] + (rate[1] - rate[0]) * Math.sin(k * Math.PI);
    fx.burst(tt, { dur: 0.012, peak: peak * 4 * (0.6 + 0.4 * Math.sin(k * Math.PI)) * fx.rng.range(0.6, 1), filters: [{ type: 'bandpass', f: f * (1 + 0.15 * Math.sin(k * 5)), q }], pan });
    tt += 1 / rr * fx.rng.range(0.85, 1.15);
  }
}

/** Party marching: several feet, slightly out of step, plus kit jingle. */
function partyStep(fx, t, o) {
  const s = o.surface ?? 'stone';
  const r = fx.rng;
  foot(fx, t, s, 1, -0.05);
  foot(fx, t + 0.07 + r.range(0, 0.04), s, 0.6, 0.25);
  foot(fx, t + 0.15 + r.range(0, 0.05), s, 0.45, -0.3);
  fx.grains(t + 0.02, { count: 5, spread: 0.16, fLo: 5000, fHi: 9500, peak: 0.025, q: 6 });
}

// ------------------------------------------------------------------ metal & wood helpers
const clink = (fx, t, f, peak = 0.1, decay = 1, pan) => fx.modes(t, { f, ratios: [1, 2.31, 3.94, 5.1], decays: [0.14, 0.08, 0.05, 0.03], amps: [1, 0.6, 0.35, 0.2], peak, decay, pan, jitter: 0.01 });
const knock = (fx, t, f = 300, peak = 0.3, pan) => {
  fx.modes(t, { f, ratios: [1, 2.3, 3.7], decays: [0.08, 0.04, 0.02], amps: [1, 0.5, 0.2], peak, pan });
  fx.burst(t, { dur: 0.02, peak: peak * 0.6, filters: [{ type: 'bandpass', f: f * 4, q: 1 }], pan });
};
const thud = (fx, t, peak = 0.5, f = 85) => {
  fx.tone(t, { f, f1: f * 0.55, dur: 0.22, peak });
  fx.burst(t, { dur: 0.12, peak: peak * 0.6, filters: [{ type: 'lowpass', f: 380 }] });
};

function whoosh(fx, t, { f0 = 500, f1 = 2000, dur = 0.22, peak = 0.3, q = 1.4, pan } = {}) {
  fx.burst(t, { kind: 'pink', a: dur * 0.45, dur: dur * 0.6, peak: peak * 4, curve: 'lin', filters: [{ type: 'bandpass', f: f0, f1, q, dt: dur * 0.6 }], pan });
}

function metalClang(fx, t, peak = 0.25, f = 820) {
  fx.modes(t, { f, ratios: [1, 2.08, 2.79, 3.9, 5.43, 6.1, 7.3], decays: [0.6, 0.4, 0.32, 0.22, 0.16, 0.11, 0.08], amps: [1, 0.7, 0.6, 0.4, 0.3, 0.2, 0.1], peak, jitter: 0.03 });
  fx.burst(t, { dur: 0.04, peak: peak * 1.4, filters: [{ type: 'highpass', f: 2500 }] });
}

// ------------------------------------------------------------------ spells
function shimmer(fx, t, { notes = [880, 1108, 1318, 1760, 2217, 2637], step = 0.05, dur = 0.6, peak = 0.06 } = {}) {
  notes.forEach((f, i) => fx.tone(t + i * step, { f, dur, peak, vib: [6, 0.003], pan: (i / notes.length - 0.5) * 0.8 }));
}

function bell(fx, t, f, peak = 0.2, decay = 1) {
  fx.modes(t, { f, ratios: [0.5, 1, 1.19, 1.5, 2, 2.5, 2.66, 3.01], decays: [3, 2.4, 2, 1.6, 1.3, 1, 0.9, 0.7], amps: [0.5, 1, 0.6, 0.4, 0.5, 0.25, 0.2, 0.15], peak, decay });
}

function chord(fx, t, freqs, { dur = 1.2, peak = 0.08, vowel = 'a', a = 0.3 } = {}) {
  for (const f of freqs) fx.voice(t, { dur, a, release: 0.6, peak, contour: [[0, f], [1, f]], vowels: [vowel], voices: 2, vib: [5, 0.006], breath: 0.03 });
}

function explosion(fx, t, size = 1) {
  fx.tone(t, { f: 70, f1: 28, dur: 0.9 * size, peak: 0.75 });
  fx.burst(t, { kind: 'brown', dur: 1.3 * size, peak: 0.7, filters: [{ type: 'lowpass', f: 700, f1: 140, dt: 1 }] });
  fx.burst(t, { kind: 'pink', dur: 0.5, peak: 0.35, filters: [{ type: 'lowpass', f: 3000, f1: 400 }] });
  fx.grains(t + 0.05, { count: Math.round(40 * size), spread: 1.6 * size, curve: 1.6, fLo: 1200, fHi: 6000, peak: 0.12, dHi: 0.012 });
}

function thunder(fx, t, peak = 0.6) {
  fx.burst(t, { kind: 'brown', a: 0.04, dur: 2.2, peak, filters: [{ type: 'lowpass', f: 500, f1: 70, dt: 2 }] });
  fx.tone(t, { f: 48, f1: 35, dur: 1.6, peak: peak * 0.6 });
  fx.burst(t + 0.4, { kind: 'brown', a: 0.3, dur: 1.4, peak: peak * 0.5, filters: [{ type: 'lowpass', f: 250 }] });
}

function zap(fx, t, dur = 0.3, peak = 0.4) {
  fx.grains(t, { count: Math.round(dur * 140), spread: dur, curve: 1.4, fLo: 1800, fHi: 9500, peak, dLo: 0.002, dHi: 0.007, q: 1.5 });
  fx.tone(t, { type: 'sawtooth', f: 62, hold: dur * 0.7, dur: dur * 0.4, peak: peak * 0.3, filters: [{ type: 'highpass', f: 700 }] });
  fx.tone(t, { type: 'square', f: 1240, f1: 300, dur: dur, peak: peak * 0.06 });
}

// ------------------------------------------------------------------ monsters
const VOX = {
  kobold: (fx, t, m) => {
    const up = m === 'die' ? 0.8 : m === 'hurt' ? 1.25 : 1;
    for (let i = 0; i < (m === 'die' ? 1 : 2); i++) fx.voice(t + i * 0.17, { dur: m === 'die' ? 0.5 : 0.13, contour: m === 'die' ? [[0, 640], [0.3, 700], [1, 320]] : [[0, 520 * up], [0.4, 720 * up], [1, 470 * up]], vowels: ['i', 'a'], formant: 1.35, rough: 0.2, peak: 0.28, breath: 0.05 });
  },
  goblin: (fx, t, m) => {
    const n = m === 'die' ? 1 : 4;
    for (let i = 0; i < n; i++) fx.voice(t + i * 0.11, { dur: m === 'die' ? 0.6 : 0.08, contour: m === 'die' ? [[0, 400], [1, 180]] : [[0, 340 - i * 12], [1, 290 - i * 12]], vowels: ['e', 'a'], formant: 1.2, rough: 0.25, peak: 0.26 });
  },
  orc: (fx, t, m) => {
    const d = m === 'die' ? 0.9 : m === 'hurt' ? 0.3 : 0.7;
    fx.voice(t, { dur: d, contour: m === 'die' ? [[0, 150], [0.2, 160], [1, 70]] : m === 'hurt' ? [[0, 170], [1, 130]] : [[0, 105], [0.25, 140], [1, 92]], vowels: ['a', 'o'], rough: 0.5, drive: 0.5, voices: 2, breath: 0.12, peak: 0.42 });
  },
  gnoll: (fx, t, m) => {
    for (let i = 0; i < (m === 'die' ? 1 : 3); i++) fx.voice(t + i * 0.16, { dur: m === 'die' ? 0.7 : 0.12, contour: m === 'die' ? [[0, 420], [1, 160]] : [[0, 300], [0.5, 520], [1, 380]], vowels: ['i', 'a'], rough: 0.3, peak: 0.3, formant: 1.1 });
  },
  ogre: (fx, t, m) => {
    const d = m === 'hurt' ? 0.45 : 1.1;
    fx.voice(t, { dur: d, contour: m === 'die' ? [[0, 90], [1, 40]] : [[0, 68], [0.3, 88], [1, 55]], vowels: ['o', 'u'], rough: 0.7, drive: 0.7, voices: 3, formant: 0.72, breath: 0.1, peak: 0.45 });
    fx.tone(t, { f: 55, f1: 42, hold: d * 0.6, dur: 0.4, peak: 0.25 });
  },
  skeleton: (fx, t, m) => {
    const n = m === 'die' ? 22 : 12;
    let tt = t;
    for (let i = 0; i < n; i++) {
      knock(fx, tt, fx.rng.range(500, 1500), 0.14, fx.rng.range(-0.4, 0.4));
      tt += fx.rng.range(0.015, m === 'die' ? 0.06 : 0.04);
    }
    if (m !== 'die') knock(fx, tt + 0.05, 900, 0.25); // jaw clack
  },
  zombie: (fx, t, m) => {
    fx.voice(t, { dur: m === 'hurt' ? 0.5 : 1.3, contour: m === 'die' ? [[0, 110], [1, 55]] : [[0, 98], [0.5, 125], [1, 84]], vowels: ['o', 'u', 'o'], rough: 0.35, breath: 0.25, vib: [3, 0.03], peak: 0.34 });
  },
  ghost: (fx, t, m) => {
    fx.voice(t, { whisper: true, dur: 1.4, vowels: ['u', 'i', 'u'], peak: 0.25, qScale: 2 });
    fx.tone(t, { f: 700, f1: m === 'die' ? 200 : 1100, dur: 1.2, a: 0.4, peak: 0.05, vib: [6, 0.02] });
    fx.tone(t + 0.1, { f: 1050, f1: m === 'die' ? 300 : 1500, dur: 1.1, a: 0.5, peak: 0.03, vib: [5, 0.02] });
  },
  rat: (fx, t, m) => {
    for (let i = 0; i < (m === 'die' ? 1 : 3); i++) fx.tone(t + i * 0.09, { f: 3200, f1: m === 'die' ? 1800 : 4300, dur: m === 'die' ? 0.3 : 0.07, peak: 0.12, vib: [38, 0.05] });
  },
  wolf: (fx, t, m) => {
    if (m === 'attack') fx.voice(t, { dur: 0.5, contour: [[0, 140], [1, 120]], vowels: ['r'], rough: 0.6, drive: 0.4, peak: 0.35 });
    else fx.voice(t, { type: 'triangle', dur: m === 'die' ? 0.7 : 1.6, contour: m === 'die' ? [[0, 700], [1, 300]] : [[0, 380], [0.2, 560], [0.8, 540], [1, 420]], vowels: ['u', 'o', 'u'], vib: [5, 0.01], breath: 0.03, peak: 0.3 });
  },
  spider: (fx, t) => {
    fx.burst(t, { a: 0.05, hold: 0.3, dur: 0.2, peak: 0.14, filters: [{ type: 'highpass', f: 3000 }] });
    fx.grains(t, { count: 9, spread: 0.35, fLo: 1800, fHi: 3200, q: 9, peak: 0.25 });
  },
  frog: (fx, t) => {
    for (let c = 0; c < 2; c++) for (let i = 0; i < 7; i++) fx.tone(t + c * 0.42 + i * 0.035, { type: 'square', f: 95, dur: 0.03, peak: 0.4, filters: [{ type: 'bandpass', f: 650, q: 4 }] });
  },
  lizard: (fx, t) => {
    fx.burst(t, { a: 0.04, hold: 0.25, dur: 0.2, peak: 0.12, filters: [{ type: 'bandpass', f: 2600, q: 2 }] });
    fx.voice(t + 0.15, { dur: 0.35, contour: [[0, 150], [1, 115]], vowels: ['r'], rough: 0.6, peak: 0.3 });
  },
  human: (fx, t, m) => {
    fx.voice(t, { dur: m === 'die' ? 0.6 : 0.28, contour: m === 'die' ? [[0, 220], [0.2, 240], [1, 110]] : m === 'hurt' ? [[0, 240], [1, 190]] : [[0, 165], [0.2, 205], [1, 140]], vowels: m === 'die' ? ['a', 'o', 'u'] : ['a', 'a', 'o'], breath: 0.15, rough: 0.15, peak: 0.38 });
  },
  dragon: (fx, t, m) => {
    fx.voice(t, { dur: 2, contour: [[0, 62], [0.3, 92], [1, 48]], vowels: ['a', 'o', 'u'], rough: 0.9, drive: 0.8, voices: 3, formant: 0.6, breath: 0.2, peak: 0.55 });
    fx.burst(t + 0.1, { kind: 'pink', a: 0.2, hold: 1.2, dur: 0.6, peak: 0.25, filters: [{ type: 'lowpass', f: 1200 }] });
    fx.tone(t, { f: 40, hold: 1.4, dur: 0.6, peak: 0.35 });
    if (m === 'die') thunder(fx, t + 1.2, 0.5);
  },
};

/** Monster id → voice family. */
export const VOICE_OF = {
  kobold: 'kobold', koboldChief: 'kobold', goblin: 'goblin', orc: 'orc', orcLeader: 'orc', hobgoblin: 'orc', hobgoblinChief: 'orc', bugbear: 'orc',
  gnoll: 'gnoll', giantRat: 'rat', skeleton: 'skeleton', zombie: 'zombie', ghoul: 'zombie', ghast: 'zombie', shadow: 'ghost', wight: 'ghost', spectre: 'ghost',
  lizardMan: 'lizard', ogre: 'ogre', troll: 'ogre', hillGiant: 'ogre', buccaneer: 'human', thug: 'human', bandit: 'human', banditLeader: 'human', acolyte: 'human', banePriest: 'human',
  giantSpider: 'spider', giantCentipede: 'spider', wolf: 'wolf', giantFrog: 'frog', tyranthraxus: 'dragon',
};

// ------------------------------------------------------------------ the library
export const SFX = {
  // --- movement
  step: (fx, t, o) => partyStep(fx, t, o),
  footstep: (fx, t, o) => foot(fx, t, o.surface ?? 'stone', 1, o.pan ?? 0),
  walk: (fx, t, o) => {
    for (let i = 0; i < (o.n ?? 3); i++) foot(fx, t + i * 0.19, o.surface ?? 'stone', i % 2 ? 0.75 : 0.9, i % 2 ? 0.1 : -0.1);
  },
  bump: (fx, t) => {
    thud(fx, t, 0.45, 90);
    fx.grains(t + 0.01, { count: 6, spread: 0.12, fLo: 4000, fHi: 8000, peak: 0.05 });
    fx.grains(t + 0.03, { count: 5, spread: 0.3, fLo: 900, fHi: 3000, peak: 0.05 }); // dust and grit
  },
  turn: (fx, t, o) => {
    fx.burst(t, { a: 0.03, dur: 0.1, peak: 0.035, filters: [{ type: 'bandpass', f: 2500, q: 0.8 }] });
    foot(fx, t + 0.02, o.surface ?? 'stone', 0.25, 0.2);
  },

  // --- doors & world
  door: (fx, t) => {
    clink(fx, t, 2300, 0.14);
    clink(fx, t + 0.05, 1700, 0.1);
    creak(fx, t + 0.12, { rate: [38, 85], dur: 0.6, f: 950, peak: 0.1 });
    creak(fx, t + 0.18, { rate: [60, 110], dur: 0.4, f: 1550, q: 18, peak: 0.04 });
    whoosh(fx, t + 0.25, { f0: 300, f1: 900, dur: 0.5, peak: 0.07, q: 0.8 });
    thud(fx, t + 0.78, 0.32, 75);
    knock(fx, t + 0.78, 170, 0.25);
  },
  door_close: (fx, t) => {
    whoosh(fx, t, { f0: 900, f1: 300, dur: 0.35, peak: 0.07, q: 0.8 });
    thud(fx, t + 0.3, 0.5, 70);
    knock(fx, t + 0.3, 160, 0.3);
    clink(fx, t + 0.38, 2100, 0.12);
  },
  door_locked: (fx, t) => {
    for (let i = 0; i < 4; i++) clink(fx, t + i * 0.07 + fx.rng.range(0, 0.02), fx.rng.range(1600, 2600), 0.12, 0.6);
    knock(fx, t + 0.05, 210, 0.3);
    knock(fx, t + 0.2, 200, 0.25);
  },
  door_secret: (fx, t) => {
    fx.burst(t, { kind: 'brown', a: 0.2, hold: 1.0, dur: 0.4, peak: 0.45, filters: [{ type: 'lowpass', f: 380 }] });
    fx.burst(t, { a: 0.2, hold: 1.0, dur: 0.4, peak: 0.08, filters: [{ type: 'bandpass', f: 700, q: 2 }] });
    fx.grains(t + 0.1, { count: 30, spread: 1.2, fLo: 600, fHi: 2500, peak: 0.08 });
    thud(fx, t + 1.35, 0.55, 60);
  },
  chest: (fx, t) => {
    clink(fx, t, 2000, 0.12);
    creak(fx, t + 0.08, { rate: [30, 70], dur: 0.5, f: 750, peak: 0.1 });
    for (let i = 0; i < 6; i++) clink(fx, t + 0.4 + i * fx.rng.range(0.02, 0.06), fx.rng.range(2600, 4200), 0.05);
  },
  trap: (fx, t) => {
    clink(fx, t, 3000, 0.2, 0.5);
    whoosh(fx, t + 0.05, { f0: 2000, f1: 5000, dur: 0.15, peak: 0.25 });
    metalClang(fx, t + 0.18, 0.2, 640);
  },
  splash: (fx, t) => foot(fx, t, 'water', 1.4),

  // --- weapons
  swing: (fx, t, o) => whoosh(fx, t, { f0: 450 * (o.heavy ? 0.7 : 1), f1: 1900, dur: 0.24, peak: 0.28 }),
  miss: (fx, t) => {
    whoosh(fx, t, { f0: fx.rng.range(450, 650), f1: fx.rng.range(1800, 2600), dur: 0.22, peak: 0.26 });
    whoosh(fx, t + 0.08, { f0: 2400, f1: 900, dur: 0.18, peak: 0.08 });
  },
  hit: (fx, t, o) => {
    if (o.material === 'armor') return SFX.hit_armor(fx, t, o);
    if (o.material === 'bone') return SFX.hit_bone(fx, t, o);
    fx.tone(t, { f: 110, f1: 52, dur: 0.13, peak: 0.5 });
    fx.burst(t, { dur: 0.05, peak: 0.42, filters: [{ type: 'bandpass', f: 1400, q: 1.2 }] });
    fx.burst(t, { dur: 0.1, peak: 0.32, filters: [{ type: 'lowpass', f: 700 }] });
    fx.burst(t + 0.01, { dur: 0.08, peak: 0.13, filters: [{ type: 'bandpass', f: 950, f1: 380, q: 4 }] });
    fx.modes(t, { f: 3100, ratios: [1, 2.4], decays: [0.07, 0.03], peak: 0.05 });
    if (o.crit) SFX.crit(fx, t, o);
  },
  hit_armor: (fx, t, o) => {
    metalClang(fx, t, 0.22, fx.rng.range(700, 950));
    fx.tone(t, { f: 140, f1: 80, dur: 0.1, peak: 0.3 });
    if (o.crit) SFX.crit(fx, t, o);
  },
  hit_bone: (fx, t) => {
    fx.modes(t, { f: 720, ratios: [1, 1.6, 2.4], decays: [0.06, 0.04, 0.03], peak: 0.28 });
    fx.grains(t, { count: 7, spread: 0.06, fLo: 1500, fHi: 4200, peak: 0.28 });
    fx.burst(t, { dur: 0.03, peak: 0.3, filters: [{ type: 'bandpass', f: 2600, q: 2 }] });
  },
  crit: (fx, t) => {
    fx.tone(t, { f: 62, f1: 32, dur: 0.45, peak: 0.6 });
    fx.burst(t, { kind: 'brown', dur: 0.35, peak: 0.4, filters: [{ type: 'lowpass', f: 260 }] });
  },
  bite: (fx, t) => {
    fx.modes(t, { f: 1250, ratios: [1, 1.5], decays: [0.025, 0.015], peak: 0.3 });
    fx.burst(t, { dur: 0.1, peak: 0.25, filters: [{ type: 'bandpass', f: 1000, f1: 450, q: 3 }] });
    fx.tone(t, { f: 100, f1: 60, dur: 0.08, peak: 0.25 });
  },
  claw: (fx, t) => {
    whoosh(fx, t, { f0: 1200, f1: 3500, dur: 0.15, peak: 0.2 });
    fx.burst(t + 0.1, { dur: 0.08, peak: 0.3, filters: [{ type: 'bandpass', f: 2200, f1: 900, q: 2 }] });
  },
  block: (fx, t) => {
    metalClang(fx, t, 0.16, 1100);
    knock(fx, t, 260, 0.25);
  },
  bow: (fx, t) => {
    fx.tone(t, { type: 'triangle', f: 215, f1: 200, dur: 0.28, peak: 0.22 });
    fx.tone(t, { type: 'sawtooth', f: 108, dur: 0.12, peak: 0.07, filters: [{ type: 'lowpass', f: 1200 }] });
    fx.burst(t, { dur: 0.03, peak: 0.2, filters: [{ type: 'bandpass', f: 2600, q: 1 }] });
    fx.burst(t + 0.04, { a: 0.04, dur: 0.35, peak: 0.1, filters: [{ type: 'bandpass', f: 3200, f1: 1400, q: 2 }], pan: 0.3 });
  },
  arrow_hit: (fx, t) => {
    knock(fx, t, 290, 0.32);
    fx.tone(t + 0.01, { type: 'triangle', f: 160, dur: 0.25, peak: 0.05, vib: [28, 0.12] }); // shaft quiver
  },
  death: (fx, t) => {
    thud(fx, t, 0.55, 80);
    fx.grains(t + 0.02, { count: 10, spread: 0.25, fLo: 3000, fHi: 8000, peak: 0.07, q: 5 });
    thud(fx, t + 0.18, 0.28, 70);
  },

  // --- spells (by family)
  spell: (fx, t) => {
    shimmer(fx, t);
    fx.burst(t, { a: 0.3, dur: 0.5, peak: 0.05, filters: [{ type: 'highpass', f: 4000 }] });
    fx.tone(t, { f: 220, f1: 440, a: 0.3, dur: 0.5, peak: 0.09 });
  },
  spell_fire: (fx, t) => {
    whoosh(fx, t, { f0: 300, f1: 2200, dur: 0.45, peak: 0.3, q: 0.8 });
    explosion(fx, t + 0.38, 1);
    fx.burst(t + 0.4, { kind: 'pink', a: 0.1, hold: 0.4, dur: 1, peak: 0.22, filters: [{ type: 'lowpass', f: 900 }] });
  },
  spell_cone: (fx, t) => {
    fx.burst(t, { kind: 'pink', a: 0.06, hold: 0.5, dur: 0.5, peak: 0.35, filters: [{ type: 'bandpass', f: 600, f1: 1500, q: 0.8, dt: 0.6 }] });
    fx.grains(t + 0.05, { count: 30, spread: 1, fLo: 1500, fHi: 6000, peak: 0.1 });
    fx.tone(t, { f: 80, hold: 0.4, dur: 0.4, peak: 0.2 });
  },
  spell_lightning: (fx, t) => {
    fx.tone(t, { type: 'sawtooth', f: 90, f1: 400, a: 0.25, dur: 0.1, peak: 0.06, filters: [{ type: 'highpass', f: 600 }] });
    zap(fx, t + 0.25, 0.32, 0.45);
    thunder(fx, t + 0.4, 0.65);
  },
  spell_shock: (fx, t) => zap(fx, t, 0.18, 0.7),
  spell_missile: (fx, t, o) => {
    const n = o.n ?? 3;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.09;
      fx.tone(tt, { f: 1900, f1: 520, dur: 0.26, peak: 0.13, pan: (i - (n - 1) / 2) * 0.3 });
      fx.tone(tt, { type: 'triangle', f: 2800, f1: 700, dur: 0.22, peak: 0.05 });
      fx.grains(tt, { count: 4, spread: 0.2, fLo: 6000, fHi: 10000, peak: 0.04 });
    }
  },
  spell_sleep: (fx, t) => {
    [1568, 1318, 1175, 988, 784].forEach((f, i) => fx.tone(t + i * 0.13, { f, dur: 1.2, peak: 0.07, a: 0.04, vib: [5, 0.004], pan: 0.4 - i * 0.2 }));
    fx.burst(t, { a: 0.4, dur: 1, peak: 0.05, filters: [{ type: 'bandpass', f: 2000, q: 0.8 }] });
    fx.tone(t, { f: 196, a: 0.3, dur: 1, peak: 0.05 });
  },
  spell_mind: (fx, t) => {
    fx.tone(t, { f: 600, a: 0.2, dur: 1, peak: 0.1, vib: [7, 0.08] });
    fx.tone(t, { f: 906, a: 0.3, dur: 0.9, peak: 0.07, vib: [5.3, 0.1] });
    fx.burst(t, { a: 0.7, curve: 'lin', dur: 0.1, peak: 0.12, filters: [{ type: 'bandpass', f: 1500, q: 2 }] });
  },
  spell_cloud: (fx, t) => {
    for (let i = 0; i < 26; i++) {
      const f = fx.rng.range(140, 460);
      fx.tone(t + fx.rng.range(0, 1.5), { f, f1: f * 1.9, dur: 0.06, peak: 0.08, pan: fx.rng.range(-0.6, 0.6) });
    }
    fx.burst(t, { a: 0.3, hold: 0.6, dur: 0.6, peak: 0.08, filters: [{ type: 'lowpass', f: 1500 }] });
    fx.burst(t, { kind: 'brown', a: 0.4, hold: 0.5, dur: 0.6, peak: 0.25, filters: [{ type: 'lowpass', f: 200 }] });
  },
  spell_heal: (fx, t) => {
    [523, 659, 784, 1047].forEach((f, i) => fx.modes(t + i * 0.1, { f, ratios: [1, 2.76, 5.4], decays: [1.2, 0.5, 0.25], peak: 0.09 }));
    chord(fx, t, [262, 330, 392], { dur: 0.9, peak: 0.05 });
    fx.grains(t + 0.2, { count: 12, spread: 0.8, fLo: 6000, fHi: 11000, peak: 0.03, q: 8 });
  },
  heal: (fx, t, o) => SFX.spell_heal(fx, t, o),
  spell_holy: (fx, t) => {
    bell(fx, t, 523, 0.14);
    chord(fx, t, [294, 370, 440, 587], { dur: 1.4, peak: 0.05 });
    shimmer(fx, t + 0.1, { notes: [1175, 1480, 1760, 2349], step: 0.07, dur: 0.9, peak: 0.04 });
  },
  spell_curse: (fx, t) => {
    fx.tone(t, { type: 'sawtooth', f: 73, a: 0.4, dur: 0.8, peak: 0.12, filters: [{ type: 'lowpass', f: 600 }] });
    fx.tone(t, { type: 'sawtooth', f: 77.8, a: 0.4, dur: 0.8, peak: 0.1, filters: [{ type: 'lowpass', f: 600 }] });
    fx.burst(t, { a: 0.6, curve: 'lin', dur: 0.1, peak: 0.15, filters: [{ type: 'lowpass', f: 900 }] });
    fx.voice(t + 0.1, { whisper: true, dur: 0.9, vowels: ['a', 'u'], peak: 0.15, qScale: 1.5 });
  },
  spell_ward: (fx, t) => {
    fx.tone(t, { f: 400, f1: 1600, dur: 0.5, peak: 0.1 });
    fx.tone(t, { type: 'triangle', f: 800, f1: 3200, dur: 0.45, peak: 0.04 });
    fx.modes(t + 0.3, { f: 1320, ratios: [1, 2.32, 4.25], decays: [0.8, 0.5, 0.3], peak: 0.1 });
    fx.burst(t, { a: 0.2, dur: 0.4, peak: 0.04, filters: [{ type: 'highpass', f: 5000 }] });
  },
  spell_turn: (fx, t) => {
    bell(fx, t, 294, 0.22, 1.4);
    chord(fx, t + 0.05, [294, 370, 440], { dur: 1.6, peak: 0.07 });
    shimmer(fx, t + 0.2, { notes: [1175, 1480, 1760, 2349, 2960], step: 0.06, dur: 1, peak: 0.04 });
  },
  spell_fizzle: (fx, t) => {
    fx.burst(t, { dur: 0.3, peak: 0.12, filters: [{ type: 'bandpass', f: 3000, f1: 600, q: 2 }] });
    fx.tone(t, { f: 600, f1: 200, dur: 0.3, peak: 0.05 });
  },
  potion: (fx, t) => {
    clink(fx, t, 2800, 0.06, 0.5);
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.15 + i * 0.16;
      fx.tone(tt, { f: 260 + i * 25, f1: 480 + i * 30, dur: 0.07, peak: 0.12 });
      fx.burst(tt, { dur: 0.06, peak: 0.08, filters: [{ type: 'lowpass', f: 900 }] });
    }
  },

  // --- ui
  click: (fx, t) => {
    fx.modes(t, { f: 1850, ratios: [1, 2.6], decays: [0.025, 0.012], peak: 0.16 });
    fx.burst(t, { dur: 0.01, peak: 0.05, filters: [{ type: 'highpass', f: 4000 }] });
  },
  hover: (fx, t) => {
    fx.tone(t, { f: 2400, dur: 0.035, peak: 0.025 });
    fx.burst(t, { dur: 0.006, peak: 0.012, filters: [{ type: 'highpass', f: 6000 }] });
  },
  confirm: (fx, t) => {
    fx.modes(t, { f: 988, ratios: [1, 2.76, 5.4], decays: [0.3, 0.1, 0.05], peak: 0.11 });
    fx.modes(t + 0.075, { f: 1319, ratios: [1, 2.76, 5.4], decays: [0.45, 0.12, 0.06], peak: 0.12 });
  },
  cancel: (fx, t) => {
    fx.modes(t, { f: 1175, ratios: [1, 2.76], decays: [0.18, 0.06], peak: 0.08 });
    fx.modes(t + 0.07, { f: 880, ratios: [1, 2.76], decays: [0.25, 0.07], peak: 0.08 });
  },
  error: (fx, t) => {
    fx.tone(t, { type: 'square', f: 150, dur: 0.1, peak: 0.07, filters: [{ type: 'lowpass', f: 900 }] });
    fx.tone(t + 0.12, { type: 'square', f: 125, dur: 0.14, peak: 0.07, filters: [{ type: 'lowpass', f: 800 }] });
  },
  page: (fx, t) => {
    fx.burst(t, { a: 0.02, dur: 0.12, peak: 0.07, filters: [{ type: 'bandpass', f: 3500, q: 0.6 }] });
    fx.grains(t, { count: 8, spread: 0.15, fLo: 3000, fHi: 7500, peak: 0.035 });
  },
  open: (fx, t) => {
    fx.burst(t, { a: 0.06, dur: 0.18, peak: 0.06, filters: [{ type: 'lowpass', f: 1200, f1: 3500 }] });
    SFX.page(fx, t + 0.05);
  },
  close: (fx, t) => {
    fx.burst(t, { a: 0.04, dur: 0.15, peak: 0.05, filters: [{ type: 'lowpass', f: 3000, f1: 900 }] });
    knock(fx, t + 0.1, 420, 0.06);
  },
  map: (fx, t) => {
    fx.burst(t, { a: 0.15, dur: 0.4, peak: 0.06, filters: [{ type: 'bandpass', f: 2500, q: 0.7 }] });
    fx.grains(t + 0.05, { count: 16, spread: 0.45, fLo: 2500, fHi: 7000, peak: 0.035 });
  },
  coins: (fx, t, o) => {
    let tt = t;
    const n = o.n ?? fx.rng.int(6, 9);
    for (let i = 0; i < n; i++) {
      clink(fx, tt, fx.rng.range(2600, 4300), 0.09 * (1 - i / (n * 1.4)), 1, fx.rng.range(-0.3, 0.3));
      tt += fx.rng.range(0.02, 0.09) * (1 - i / (n * 1.5));
    }
    fx.burst(t, { dur: 0.08, peak: 0.12, filters: [{ type: 'lowpass', f: 500 }] });
  },
  save: (fx, t) => {
    fx.modes(t, { f: 1760, ratios: [1, 2.76], decays: [0.6, 0.2], peak: 0.08 });
    fx.modes(t + 0.12, { f: 2637, ratios: [1, 2.76], decays: [0.8, 0.25], peak: 0.07 });
  },
  equip: (fx, t) => {
    fx.burst(t, { a: 0.02, dur: 0.12, peak: 0.08, filters: [{ type: 'bandpass', f: 1800, q: 0.8 }] });
    clink(fx, t + 0.06, 1900, 0.08, 0.7);
    clink(fx, t + 0.1, 2700, 0.05, 0.5);
  },
  sparkle: (fx, t) => shimmer(fx, t, { notes: [2093, 2637, 3136, 4186], step: 0.05, dur: 0.6, peak: 0.04 }),
  levelup: (fx, t) => SFX.sparkle(fx, t),
};

/** Monster vocalisation: kind = voice family or monster id; mode = attack|hurt|die. */
export function monsterVox(fx, t, kind, mode = 'attack') {
  const fam = VOX[kind] ? kind : VOICE_OF[kind] ?? 'human';
  VOX[fam](fx, t, mode);
}

for (const fam of Object.keys(VOX)) {
  SFX[`vox_${fam}`] = (fx, t, o) => VOX[fam](fx, t, o.mode ?? 'attack');
  SFX[`vox_${fam}_die`] = (fx, t) => VOX[fam](fx, t, 'die');
}

export { foot, creak };
