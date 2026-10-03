/**
 * Sanity checks on a finished portrait before it is shown or cached. A portrait is a lit bust on a
 * painted wall: it is never (near) uniformly black. A black result means the render target was lost
 * or overwritten mid-paint, so callers reject it, keep what they showed before and paint again.
 */

/**
 * Mean brightness (0..765, the sum of R+G+B) and spread of an RGBA buffer, sampled on a grid.
 * @param {Uint8ClampedArray|Uint8Array} px
 * @param {number} w
 * @param {number} h
 */
export function portraitStatsRGBA(px, w, h) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
  let n = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const v = px[i] + px[i + 1] + px[i + 2];
      sum += v;
      sum2 += v * v;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  const sd = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
  return { mean, sd };
}

/** True when an RGBA buffer looks like a failed render (near-black or flat). */
export function isBlankRGBA(px, w, h) {
  if (!px || !w || !h || px.length < w * h * 4) return true;
  const { mean, sd } = portraitStatsRGBA(px, w, h);
  return mean < 36 || sd < 4;
}

/** The same check on a canvas (2D or offscreen). Unreadable canvases pass. */
export function isBlankCanvas(c) {
  if (!c) return true;
  try {
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return false;
    const d = g.getImageData(0, 0, c.width, c.height);
    return isBlankRGBA(d.data, c.width, c.height);
  } catch {
    return false;
  }
}
