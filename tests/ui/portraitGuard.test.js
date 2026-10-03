/**
 * Party UI workstream: a portrait that comes back black (render target lost or overwritten
 * mid-paint) must be rejected so the roster keeps its previous tier and repaints.
 */
import { describe, it, expect } from 'vitest';
import { isBlankRGBA, portraitStatsRGBA } from '../../src/ui/components/portraitGuard.js';

function buf(w, h, fn) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y);
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
  return px;
}

describe('portrait guard', () => {
  it('rejects a solid black portrait (the camp roster bug: mean RGB ~3/765)', () => {
    const px = buf(84, 105, () => [1, 1, 1]);
    expect(portraitStatsRGBA(px, 84, 105).mean).toBeLessThan(5);
    expect(isBlankRGBA(px, 84, 105)).toBe(true);
  });
  it('rejects a flat fill and a truncated buffer', () => {
    expect(isBlankRGBA(buf(60, 75, () => [90, 70, 50]), 60, 75)).toBe(true);
    expect(isBlankRGBA(new Uint8ClampedArray(10), 60, 75)).toBe(true);
  });
  it('accepts a dark but painted bust (dark wall, lit face)', () => {
    const px = buf(84, 105, (x, y) => {
      const d = Math.hypot(x - 42, y - 45);
      return d < 22 ? [190 - d * 2, 140 - d * 2, 110 - d * 2] : [28 + (x % 7), 22, 18];
    });
    expect(isBlankRGBA(px, 84, 105)).toBe(false);
  });
});
