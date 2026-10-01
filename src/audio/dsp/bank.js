import { noiseData } from './synth.js';

/**
 * Sample cache. Float data is cached per sample-rate + key (pure, shareable
 * across contexts); AudioBuffers are cached per context.
 */
const floatCache = new Map();
const bufCache = new WeakMap();

/**
 * @param {BaseAudioContext} ac
 * @param {string} key unique id of the generated sound
 * @param {(sr:number)=>Float32Array|Float32Array[]} gen
 * @returns {AudioBuffer}
 */
export function sample(ac, key, gen) {
  let per = bufCache.get(ac);
  if (!per) bufCache.set(ac, (per = new Map()));
  let b = per.get(key);
  if (b) return b;
  const fk = `${ac.sampleRate}|${key}`;
  let data = floatCache.get(fk);
  if (!data) {
    data = gen(ac.sampleRate);
    floatCache.set(fk, data);
    // Bound memory: drop the oldest entries past ~600 sounds.
    if (floatCache.size > 900) floatCache.delete(floatCache.keys().next().value);
  }
  const chans = Array.isArray(data) ? data : [data];
  b = ac.createBuffer(chans.length, chans[0].length, ac.sampleRate);
  chans.forEach((c, i) => b.copyToChannel(c, i));
  per.set(key, b);
  return b;
}

/** Seconds of each looping noise buffer: long enough that beds never audibly repeat. */
export const NOISE_SECONDS = 24;

/** Long looping noise buffers (white | pink | brown), one independent 24 s take per kind. */
export function noiseBuffer(ac, kind = 'white') {
  return sample(ac, `noise:${kind}`, (sr) => noiseData(sr, NOISE_SECONDS + 0.05, kind, kind.length * 97 + 5));
}

/** A random start offset into a noise buffer (seconds), leaving `need` seconds before the end. */
export function noiseOffset(rng, need = 1) {
  return rng.range(0, Math.max(0.1, NOISE_SECONDS - need - 0.1));
}
