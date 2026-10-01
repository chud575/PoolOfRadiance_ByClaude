import { glyph } from '../../render/bitmapFont5x7.js';

/**
 * Builds a real TrueType font from the classic 5x7 bitmap glyphs (one square
 * contour per horizontal pixel run) and registers it as the CSS font family
 * 'PoR 5x7' via the FontFace API. Used by classic 1988 mode so HTML text is
 * drawn in the same chunky EGA-era face as the reference renderer.
 * Pure binary assembly — no network, no assets.
 */

const PX = 128; // font units per pixel
const EM = 1024; // 8 px em: 7 rows of glyph + 1 row of descent
const ADV = 6 * PX; // 5 px glyph + 1 px spacing

function glyphContours(cols) {
  const contours = [];
  for (let r = 0; r < 7; r++) {
    let c = 0;
    while (c < 5) {
      if (!((cols[c] >> r) & 1)) { c++; continue; }
      let e = c;
      while (e < 5 && (cols[e] >> r) & 1) e++;
      const x0 = c * PX, x1 = e * PX;
      const y0 = (6 - r) * PX, y1 = y0 + PX;
      // clockwise (TrueType outer contour, y up)
      contours.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
      c = e;
    }
  }
  return contours;
}

/** Extra glyphs the UI uses (arrows, typographic punctuation). Column bytes, LSB = top row. */
const EXTRA = {
  0x2190: [0x08, 0x1c, 0x2a, 0x08, 0x08], // ←
  0x2191: [0x04, 0x02, 0x7f, 0x02, 0x04], // ↑
  0x2192: [0x08, 0x08, 0x2a, 0x1c, 0x08], // →
  0x2193: [0x10, 0x20, 0x7f, 0x20, 0x10], // ↓
  0x00b7: [0x00, 0x00, 0x08, 0x00, 0x00], // ·
  0x00d7: [0x22, 0x14, 0x08, 0x14, 0x22], // ×
  0x2013: [0x08, 0x08, 0x08, 0x08, 0x00], // –
  0x2014: [0x08, 0x08, 0x08, 0x08, 0x08], // —
  0x2018: [0x00, 0x06, 0x05, 0x00, 0x00], // ‘
  0x2019: [0x00, 0x05, 0x03, 0x00, 0x00], // ’
  0x201c: [0x06, 0x05, 0x00, 0x06, 0x05], // “
  0x201d: [0x05, 0x03, 0x00, 0x05, 0x03], // ”
  0x2026: [0x40, 0x00, 0x40, 0x00, 0x40], // …
  0x2736: [0x2a, 0x1c, 0x7f, 0x1c, 0x2a], // ✶
  0x25c6: [0x08, 0x1c, 0x3e, 0x1c, 0x08], // ◆
};

class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); }
  u16(v) { this.b.push((v >> 8) & 255, v & 255); }
  i16(v) { this.u16(v & 0xffff); }
  u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  tag(s) { for (const ch of s) this.u8(ch.charCodeAt(0)); }
  bytes(a) { for (const x of a) this.u8(x); }
  pad4() { while (this.b.length % 4) this.u8(0); }
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + (((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}

/** @returns {Uint8Array} a complete .ttf */
export function buildBitmapTTF(family = 'PoR 5x7') {
  const chars = [];
  for (let c = 32; c <= 126; c++) chars.push([c, glyph(String.fromCharCode(c))]);
  for (const [c, cols] of Object.entries(EXTRA)) chars.push([Number(c), cols]);
  chars.sort((a, b) => a[0] - b[0]);
  const glyphs = [[], ...chars.map(([, cols]) => glyphContours(cols))];
  const n = glyphs.length;

  // glyf + loca
  const glyf = new W();
  const loca = [];
  let maxPts = 0, maxCont = 0;
  let gxMax = 0;
  for (const cs of glyphs) {
    loca.push(glyf.b.length);
    if (!cs.length) continue;
    const pts = cs.flat();
    maxPts = Math.max(maxPts, pts.length);
    maxCont = Math.max(maxCont, cs.length);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    gxMax = Math.max(gxMax, ...xs);
    glyf.i16(cs.length);
    glyf.i16(Math.min(...xs)); glyf.i16(Math.min(...ys)); glyf.i16(Math.max(...xs)); glyf.i16(Math.max(...ys));
    let end = -1;
    for (const c of cs) { end += c.length; glyf.u16(end); }
    glyf.u16(0); // no instructions
    for (let i = 0; i < pts.length; i++) glyf.u8(1); // on-curve, long coords
    let px = 0, py = 0;
    for (const [x] of pts) { glyf.i16(x - px); px = x; }
    for (const [, y] of pts) { glyf.i16(y - py); py = y; }
    while (glyf.b.length % 4) glyf.u8(0);
  }
  loca.push(glyf.b.length);
  const locaW = new W();
  for (const o of loca) locaW.u32(o);

  const head = new W();
  head.u32(0x00010000); head.u32(0x00010000); head.u32(0); head.u32(0x5f0f3cf5);
  head.u16(0x000b); head.u16(EM);
  head.u32(0); head.u32(0); head.u32(0); head.u32(0); // created / modified
  head.i16(0); head.i16(0); head.i16(gxMax); head.i16(7 * PX);
  head.u16(0); head.u16(8); head.i16(2); head.i16(1); head.i16(0);

  const hhea = new W();
  hhea.u32(0x00010000); hhea.i16(7 * PX); hhea.i16(-PX); hhea.i16(0);
  hhea.u16(ADV); hhea.i16(0); hhea.i16(0); hhea.i16(gxMax);
  hhea.i16(1); hhea.i16(0); hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0); hhea.u16(n);

  const maxp = new W();
  maxp.u32(0x00010000); maxp.u16(n); maxp.u16(maxPts); maxp.u16(maxCont);
  maxp.u16(0); maxp.u16(0); maxp.u16(2);
  for (let i = 0; i < 7; i++) maxp.u16(0);
  maxp.u16(0); maxp.u16(0);

  const os2 = new W();
  os2.u16(4); os2.i16(ADV); os2.u16(400); os2.u16(5); os2.u16(0);
  os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(75); os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(350);
  os2.i16(PX / 2); os2.i16(3 * PX);
  os2.i16(0);
  os2.bytes([2, 0, 6, 9, 0, 0, 0, 0, 0, 0]); // panose: monospaced
  os2.u32(1); os2.u32(0); os2.u32(0); os2.u32(0);
  os2.tag('PoRH');
  os2.u16(0x40); os2.u16(32); os2.u16(Math.min(0xffff, chars[chars.length - 1][0]));
  os2.i16(7 * PX); os2.i16(-PX); os2.i16(0);
  os2.u16(7 * PX); os2.u16(PX);
  os2.u32(1); os2.u32(0);
  os2.i16(5 * PX); os2.i16(7 * PX); os2.u16(0); os2.u16(32); os2.u16(1);

  const strs = [[1, family], [2, 'Regular'], [3, `${family} Regular`], [4, family], [5, 'Version 1.0'], [6, family.replace(/\s+/g, '')]];
  const name = new W();
  name.u16(0); name.u16(strs.length); name.u16(6 + strs.length * 12);
  const data = [];
  for (const [id, s] of strs) {
    const enc = [];
    for (const ch of s) enc.push(0, ch.charCodeAt(0));
    name.u16(3); name.u16(1); name.u16(0x409); name.u16(id); name.u16(enc.length); name.u16(data.length);
    data.push(...enc);
  }
  name.bytes(data);

  // cmap format 4: runs of consecutive code points
  const segs = [];
  chars.forEach(([c], i) => {
    const gid = i + 1;
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && gid - c === last.delta) last.end = c;
    else segs.push({ start: c, end: c, delta: gid - c });
  });
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const sc = segs.length;
  let sr = 1, es2 = 0;
  while (sr * 2 <= sc) { sr *= 2; es2++; }
  const cmap = new W();
  cmap.u16(0); cmap.u16(1); cmap.u16(3); cmap.u16(1); cmap.u32(12);
  cmap.u16(4); cmap.u16(16 + sc * 8); cmap.u16(0);
  cmap.u16(sc * 2); cmap.u16(sr * 2); cmap.u16(es2); cmap.u16(sc * 2 - sr * 2);
  for (const g of segs) cmap.u16(g.end);
  cmap.u16(0);
  for (const g of segs) cmap.u16(g.start);
  for (const g of segs) cmap.i16(g.delta);
  for (let i = 0; i < sc; i++) cmap.u16(0);

  const post = new W();
  post.u32(0x00030000); post.u32(0); post.i16(-PX); post.i16(PX / 2); post.u32(1);
  post.u32(0); post.u32(0); post.u32(0); post.u32(0);

  const hmtx = new W();
  for (let i = 0; i < n; i++) {
    hmtx.u16(ADV);
    const cs = glyphs[i];
    hmtx.i16(cs.length ? Math.min(...cs.flat().map((p) => p[0])) : 0);
  }

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca: locaW, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const out = new W();
  const nt = tags.length;
  let es = 0;
  while (1 << (es + 1) <= nt) es++;
  out.u32(0x00010000); out.u16(nt); out.u16((1 << es) * 16); out.u16(es); out.u16(nt * 16 - (1 << es) * 16);
  let off = 12 + nt * 16;
  const recs = [];
  for (const t of tags) {
    const b = tables[t].b;
    recs.push({ t, b, off, len: b.length });
    off += Math.ceil(b.length / 4) * 4;
  }
  for (const r of recs) { out.tag(r.t); out.u32(checksum(r.b)); out.u32(r.off); out.u32(r.len); }
  let headOff = 0;
  for (const r of recs) {
    if (r.t === 'head') headOff = out.b.length;
    out.bytes(r.b);
    out.pad4();
  }
  const bytes = new Uint8Array(out.b);
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  bytes[headOff + 8] = adj >>> 24; bytes[headOff + 9] = (adj >>> 16) & 255; bytes[headOff + 10] = (adj >>> 8) & 255; bytes[headOff + 11] = adj & 255;
  return bytes;
}

let registered = null;
/** Register 'PoR 5x7' with document.fonts (idempotent). */
export function registerBitmapFont() {
  if (registered || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return registered;
  try {
    const face = new FontFace('PoR 5x7', buildBitmapTTF('PoR 5x7').buffer);
    registered = face.load().then((f) => {
      document.fonts.add(f);
      return f;
    }).catch((e) => console.warn('[skin] bitmap font rejected', e?.message ?? e));
  } catch (e) {
    console.warn('[skin] bitmap font failed', e);
  }
  return registered;
}
