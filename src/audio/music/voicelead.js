import { chord as parseChord } from '../core/notes.js';

/**
 * Voice leading for pads: choose each chord's voicing (inversion and
 * octave, close or drop-2) nearest the previous one.
 */

/** All candidate voicings of `ch` with `count` notes whose lowest note lies near `lo`. */
function candidates(ch, lo, count) {
  const tones = ch.tones.map((t) => (ch.root + t) % 12);
  const n = tones.length;
  const out = [];
  for (let inv = 0; inv < n; inv++) {
    for (let base = lo - 5; base <= lo + 7; base++) {
      if (((base % 12) + 12) % 12 !== tones[inv]) continue;
      // Close voicing upward from this inversion.
      const v = [base];
      for (let i = 1; i < count; i++) {
        const pc = tones[(inv + i) % n];
        let m = v[i - 1] + 1;
        while (((m % 12) + 12) % 12 !== pc) m++;
        v.push(m);
      }
      out.push(v);
      // Drop-2 (second voice from the top down an octave) for 4-note chords: wider, warmer.
      if (count >= 4) {
        const d = v.slice();
        const k = d.length - 2;
        d[k] -= 12;
        if (d[k] >= lo - 7) out.push(d.sort((a, b) => a - b));
      }
    }
  }
  return out;
}

function cost(prev, cand, center) {
  let c = 0;
  for (let i = 0; i < cand.length; i++) c += Math.abs(cand[i] - prev[Math.min(i, prev.length - 1)]);
  // Parallel perfect fifths / octaves between any two moving voices.
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const a0 = prev[Math.min(i, prev.length - 1)];
      const b0 = prev[Math.min(j, prev.length - 1)];
      const i0 = (((b0 - a0) % 12) + 12) % 12;
      const i1 = (((cand[j] - cand[i]) % 12) + 12) % 12;
      if ((i0 === 7 || i0 === 0) && i0 === i1 && cand[i] !== a0 && Math.sign(cand[i] - a0) === Math.sign(cand[j] - b0)) c += 3;
    }
  }
  const mean = cand.reduce((a, b) => a + b, 0) / cand.length;
  return c + Math.abs(mean - center) * 0.35;
}

/**
 * @param {number[]|null} prev previous voicing (sorted MIDI notes) or null
 * @param {{root:number, tones:number[]}} ch
 * @param {number} lo lowest allowed region
 * @param {number} count number of voices
 * @param {number} center preferred mean pitch
 */
export function voiceLead(prev, ch, lo, count, center = lo + 6) {
  const cands = candidates(ch, lo, count);
  if (!cands.length) return [lo];
  if (!prev) {
    // First chord: root position (if possible) nearest the centre.
    let best = null;
    let bc = Infinity;
    for (const v of cands) {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const c = Math.abs(mean - center) + (((v[0] % 12) + 12) % 12 === ch.root ? 0 : 2.5);
      if (c < bc) {
        bc = c;
        best = v;
      }
    }
    return best;
  }
  let best = cands[0];
  let bc = Infinity;
  for (const v of cands) {
    const c = cost(prev, v, center);
    if (c < bc) {
      bc = c;
      best = v;
    }
  }
  return best;
}

/**
 * Cadential colour for a chart slot: a major chord whose next chord lies a
 * fourth above (V → I), or the last slot of a major-key cadence, becomes
 * sus4 for the first half and resolves to the third (+ minor 7th when 4+
 * voices). Returns one or two {ch, t, len} parts.
 */
export function colourChord(slot, next, count) {
  const c = slot.ch;
  const major = c.tones[1] === 4 && c.tones.length === 3;
  const resolves = next && ((next.ch.root - c.root + 12) % 12 === 5);
  if (!major || !resolves || slot.len < 2) return [{ ch: c, t: slot.t, len: slot.len }];
  const sus = { ...c, tones: [0, 5, 7], sym: `${c.sym}sus4` };
  const dom = count >= 4 ? { ...c, tones: [0, 4, 7, 10], sym: `${c.sym}7` } : c;
  const h = slot.len / 2;
  return [
    { ch: sus, t: slot.t, len: h },
    { ch: dom, t: slot.t + h, len: slot.len - h },
  ];
}

export { parseChord };
