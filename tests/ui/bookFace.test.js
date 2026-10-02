/**
 * The procedural UI typeface (title/UI workstream): the generated TrueType
 * files must be structurally sound (table directory, head magic, glyph count,
 * cmap coverage) for every face, and deterministic.
 */
import { describe, it, expect } from 'vitest';
import { buildBookTTF } from '../../src/ui/styles/bookFace.js';

function tables(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint16(4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.slice(o, o + 4));
    out[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  return { dv, out };
}

describe('PoR Book face', () => {
  const faces = [{}, { italic: true }, { bold: true }, { bold: true, italic: true }, { lining: true }];
  for (const f of faces) {
    it(`builds a valid font ${JSON.stringify(f)}`, () => {
      const b = buildBookTTF({ family: 'PoR Book', sub: 'Regular', ...f });
      const { dv, out } = tables(b);
      expect(dv.getUint32(0)).toBe(0x00010000);
      for (const t of ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']) expect(out[t], t).toBeTruthy();
      expect(dv.getUint32(out.head.off + 12)).toBe(0x5f0f3cf5);
      const numGlyphs = dv.getUint16(out.maxp.off + 4);
      expect(numGlyphs).toBeGreaterThan(f.lining ? 20 : 100);
      for (const t of Object.values(out)) expect(t.off + t.len).toBeLessThanOrEqual(b.length);
    });
  }
  it('is deterministic', () => {
    const a = buildBookTTF({ family: 'PoR Book', sub: 'Italic', italic: true });
    const b = buildBookTTF({ family: 'PoR Book', sub: 'Italic', italic: true });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
