/**
 * One coat of arms per character (party UI workstream): the VIEW sheet crest, the miniature's
 * shield face (board, camp sitter, plinth) and the readied-shield item icon must all paint the
 * same device (field tincture, metal tincture, ordinary, charge) from resolveAppearance().heraldry.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const painted = [];
vi.mock('../../src/ui/components/heraldry.js', async (orig) => {
  const m = await orig();
  return { ...m, paintDevice: (g, her, o) => { painted.push(her.key); } };
});

/** A canvas whose 2D context accepts every call (records nothing; paintDevice is spied above). */
function fakeCanvas() {
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      if (/^create.*Gradient$|^createPattern$/.test(k)) return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 1 });
      return () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { width: 64, height: 64, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,' };
}

let resolveAppearance, armsOf, crestSVG, ORDINARY_PATHS, CHARGE_PATHS, shieldFaceTexture, itemIconURL, PARTIES;
beforeAll(async () => {
  globalThis.document = { createElement: () => fakeCanvas() };
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  ({ resolveAppearance, armsOf } = await import('../../src/ui/components/lookData.js'));
  ({ crestSVG, ORDINARY_PATHS, CHARGE_PATHS } = await import('../../src/ui/components/heraldry.js'));
  ({ shieldFaceTexture } = await import('../../src/ui/components/miniatureTextures.js'));
  ({ itemIconURL } = await import('../../src/ui/components/itemIcons.js'));
  ({ PARTIES } = await import('../../src/data/parties.js'));
});

describe('heraldry continuity', () => {
  it('every consumer of a character paints the same device', () => {
    const seen = new Set();
    for (const m of PARTIES.default.members) {
      const app = resolveAppearance(m);
      const her = app.heraldry;
      expect(her.field).toBe(app.clothHex);
      expect(armsOf(m).key).toBe(her.key);
      // Sheet crest: the SVG carries this ordinary, this charge and this field.
      const svg = crestSVG(her);
      expect(svg).toContain(ORDINARY_PATHS[her.ordinary]);
      expect(svg).toContain(CHARGE_PATHS[her.charge]);
      expect(svg).toContain(her.field);
      // Miniature shield face (heater and round) and the shield item icon.
      painted.length = 0;
      const t1 = shieldFaceTexture(her, 'heater');
      const t2 = shieldFaceTexture(her, 'round');
      expect(t1.userData.device).toBe(her.key);
      expect(t2.userData.device).toBe(her.key);
      itemIconURL('shield', { heraldry: her });
      expect(painted).toEqual([her.key, her.key, her.key]);
      seen.add(her.key);
    }
    // The six heroes do not all share one coat.
    expect(seen.size).toBeGreaterThan(3);
  });

  it('the device keys are tinctures, ordinary and charge', () => {
    const her = resolveAppearance(PARTIES.default.members[0]).heraldry;
    expect(her.key).toBe(`${her.field}|${her.metalKey}|${her.ordinary}|${her.charge}`);
    expect(Object.keys(ORDINARY_PATHS)).toContain(her.ordinary);
    expect(Object.keys(CHARGE_PATHS)).toContain(her.charge);
    // A magic-user bears a star (the old sheet fell back to the fighter's rook).
    expect(resolveAppearance(PARTIES.default.members[5]).heraldry.charge).toBe('magicUser');
  });
});
