/**
 * Harmonic amplitude spectra of the orchestral sources, shared by the live
 * oscillators (PeriodicWave in instruments/sustained.js) and the pre-rendered
 * note buffers (dsp/notesynth.js), so a cached spiccato or brass stab has
 * exactly the timbre of the same instrument played live.
 * @param {string} name
 * @param {number} n harmonic number (1 = fundamental)
 * @returns {number} sine amplitude of harmonic n
 */
export function harmonic(name, n) {
  switch (name) {
    case 'bowed': // saw-like with a body formant bump and a rolled-off top
      return (1 / Math.pow(n, 1.05)) * (1 + 0.8 * Math.exp(-((n - 4) ** 2) / 6)) * (n > 24 ? 0.6 : 1);
    case 'bowed2': // another player / instrument: bump higher, a weaker 2nd, slightly darker top
      return (1 / Math.pow(n, 1.12)) * (1 + 0.9 * Math.exp(-((n - 6) ** 2) / 8)) * (n === 2 ? 0.7 : 1) * (n > 20 ? 0.65 : 1);
    case 'bowed3': // a brighter, thinner fiddle: lower bump, a notch near the 9th (bow position)
      return (1 / Math.pow(n, 0.98)) * (1 + 0.6 * Math.exp(-((n - 3) ** 2) / 4)) * (1 - 0.7 * Math.exp(-((n - 9) ** 2) / 2)) * (n > 28 ? 0.55 : 1);
    case 'oboe': // double reed: weak fundamental, strong 2nd–5th, formants ~1.1 k and ~3 k (applied as EQ)
      return (n === 1 ? 0.45 : n <= 5 ? 1 / Math.pow(n, 0.35) : 1.2 / Math.pow(n, 1.1)) * (n > 30 ? 0.5 : 1);
    case 'clarinet': // cylindrical bore: odd harmonics dominate low, evens fill in high up
      return (n % 2 ? 1 / Math.pow(n, 0.9) : (n < 6 ? 0.06 : 0.35) / Math.pow(n, 1.0)) * (n > 26 ? 0.5 : 1);
    case 'horn': // brass: strong 2-5th harmonics
      return (1 / Math.pow(n, 1.35)) * (n >= 2 && n <= 6 ? 1.6 : 1);
    case 'reed': // odd-heavy (shawm / bassoon flavour)
      return (n % 2 ? 1 : 0.35) / Math.pow(n, 0.95);
    case 'flute':
      return n === 1 ? 1 : n === 2 ? 0.22 : n === 3 ? 0.08 : n === 4 ? 0.03 : 0;
    case 'organ':
      return [0, 1, 0.5, 0.25, 0.3, 0.1, 0.12, 0, 0.08][n] ?? 0;
    case 'voice':
      return 1 / Math.pow(n, 1.2);
    default:
      return 1 / n;
  }
}

/** Partials in a PeriodicWave (a low C at 65 Hz still reaches ~10 kHz). */
export const WAVE_PARTIALS = 160;
