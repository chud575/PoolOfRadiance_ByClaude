/**
 * Pitch helpers and the tiny melody notation used by the composed themes.
 *
 * Notation: whitespace-separated tokens `<pitch>:<dur>[!|_]`.
 *   pitch  `C4` `F#3` `Bb5`, `r` for a rest, or a chord `[D3,A3,F4]`
 *   dur    w h q e s (whole … sixteenth, in quarter notes), `t` = triplet
 *          eighth, `.` dotted, `~` ties several: `h~e`. Numbers allowed: `1.5`.
 *   `!` accent (louder)   `_` soft
 *   `|` bar lines are ignored (they're for the reader).
 */
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3, x: 1 / 6 };

/** @param {string} name e.g. "F#3" → MIDI number */
export function midi(name) {
  const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note "${name}"`);
  let n = NOTE[m[1].toUpperCase()];
  for (const c of m[2]) n += c === '#' ? 1 : -1;
  return n + (Number(m[3]) + 1) * 12;
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function parseDur(s) {
  return s.split('~').reduce((acc, p) => {
    if (/^[\d.]+$/.test(p)) return acc + Number(p);
    let v = DUR[p[0]];
    if (v === undefined) throw new Error(`bad duration "${s}"`);
    let add = v / 2;
    for (const c of p.slice(1)) {
      if (c === '.') {
        v += add;
        add /= 2;
      }
    }
    return acc + v;
  }, 0);
}

/**
 * Parse a melody line into note events (times in quarter notes).
 * @param {string} line
 * @param {{at?:number, vel?:number, transpose?:number, legato?:number}} [o]
 * @returns {{t:number, midi:number[], dur:number, vel:number}[]}
 */
export function line(src, { at = 0, vel = 0.7, transpose = 0, legato = 1 } = {}) {
  const out = [];
  let t = at;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const m = /^(\[[^\]]+\]|[^:]+):([^!_]+)([!_]?)$/.exec(tok);
    if (!m) throw new Error(`bad token "${tok}"`);
    const dur = parseDur(m[2]);
    if (m[1] !== 'r') {
      const names = m[1].startsWith('[') ? m[1].slice(1, -1).split(',') : [m[1]];
      const v = m[3] === '!' ? Math.min(1, vel * 1.25) : m[3] === '_' ? vel * 0.7 : vel;
      out.push({ t, midi: names.map((n) => midi(n) + transpose), dur: dur * legato, vel: v });
    }
    t += dur;
  }
  return out;
}

/** Total length (quarters) of a melody line. */
export function lineLength(src) {
  let t = 0;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    t += parseDur(tok.split(':')[1].replace(/[!_]$/, ''));
  }
  return t;
}

const QUAL = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  5: [0, 7],
  mb2: [0, 1, 3, 7],
};

/**
 * Chord symbol → {root (pitch class 0-11), tones:[semitones]}.
 * "Dm", "Bb", "F#dim", "C/E" (slash bass), "A7".
 */
export function chord(sym) {
  const [main, bass] = sym.split('/');
  const m = /^([A-G])([#b]?)(.*)$/.exec(main);
  if (!m) throw new Error(`bad chord "${sym}"`);
  let root = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  root = (root + 12) % 12;
  const tones = QUAL[m[3]];
  if (!tones) throw new Error(`bad chord quality "${sym}"`);
  let bassPc = root;
  if (bass) {
    const b = /^([A-G])([#b]?)$/.exec(bass);
    bassPc = (NOTE[b[1]] + (b[2] === '#' ? 1 : b[2] === 'b' ? -1 : 0) + 12) % 12;
  }
  return { root, tones, bass: bassPc, sym };
}

/** MIDI note of chord root nearest above `low`. */
export function rootIn(ch, low, pc = ch.root) {
  let n = low - ((low % 12) + 12) % 12 + pc;
  if (n < low) n += 12;
  return n;
}

/**
 * Voice a chord close above `low`, `count` notes (cycling tones upward).
 * @returns {number[]}
 */
export function voicing(ch, low, count = ch.tones.length) {
  const r = rootIn(ch, low);
  const out = [];
  for (let i = 0; i < count; i++) {
    const oct = Math.floor(i / ch.tones.length);
    out.push(r + ch.tones[i % ch.tones.length] + 12 * oct);
  }
  return out;
}

/** "Dm Dm | Bb C" → array of chord objects (one per bar, or split by commas within a bar). */
export function progression(src) {
  return src
    .split('|')
    .flatMap((s) => s.trim().split(/\s+/))
    .filter(Boolean)
    .map(chord);
}
