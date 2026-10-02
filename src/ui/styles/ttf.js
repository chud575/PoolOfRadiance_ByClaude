/**
 * Minimal TrueType writer: glyphs made of straight-edged contours (overlaps
 * allowed — TrueType fills with the non-zero rule), cmap format 4, a legacy
 * 'kern' table (HarfBuzz applies it when there is no GPOS). Pure binary
 * assembly, no assets. Used by the procedural book face (bookFace.js).
 */

class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); }
  u16(v) { this.b.push((v >> 8) & 255, v & 255); }
  i16(v) { this.u16(v & 0xffff); }
  u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  tag(s) { for (const ch of s) this.u8(ch.charCodeAt(0)); }
  bytes(a) { for (let i = 0; i < a.length; i++) this.b.push(a[i] & 255); }
  pad4() { while (this.b.length % 4) this.u8(0); }
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + (((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * @param {object} o
 * @param {string} o.family
 * @param {string} [o.sub] subfamily: Regular | Italic | Bold | Bold Italic
 * @param {number} o.em units per em
 * @param {number} o.ascent hhea/typo ascender (positive)
 * @param {number} o.descent hhea/typo descender (negative)
 * @param {number} [o.weight] OS/2 weight class
 * @param {boolean} [o.italic]
 * @param {number} [o.xHeight]
 * @param {number} [o.capHeight]
 * @param {{cp:number, adv:number, contours:number[][][]}[]} o.glyphs contours: [[x,y],...] closed, integer units
 * @param {[number, number, number][]} [o.kern] [leftCp, rightCp, value]
 * @returns {Uint8Array}
 */
export function buildTTF(o) {
  const { family, em, ascent, descent } = o;
  const sub = o.sub ?? 'Regular';
  const chars = [...o.glyphs].sort((a, b) => a.cp - b.cp);
  const notdef = { cp: -1, adv: Math.round(em * 0.5), contours: [] };
  const glyphs = [notdef, ...chars];
  const n = glyphs.length;
  const gidOf = new Map(chars.map((g, i) => [g.cp, i + 1]));

  const glyf = new W();
  const loca = [];
  let maxPts = 0, maxCont = 0;
  let gxMin = 0, gyMin = 0, gxMax = 0, gyMax = 0, advMax = 0, minLsb = 0, minRsb = 0, maxExt = 0;
  const lsbs = [];
  for (const g of glyphs) {
    loca.push(glyf.b.length);
    advMax = Math.max(advMax, g.adv);
    const cs = g.contours.filter((c) => c.length >= 3);
    if (!cs.length) { lsbs.push(0); continue; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, np = 0;
    for (const c of cs) for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); np++; }
    lsbs.push(x0);
    gxMin = Math.min(gxMin, x0); gyMin = Math.min(gyMin, y0); gxMax = Math.max(gxMax, x1); gyMax = Math.max(gyMax, y1);
    minLsb = Math.min(minLsb, x0); minRsb = Math.min(minRsb, g.adv - x1); maxExt = Math.max(maxExt, x1);
    maxPts = Math.max(maxPts, np);
    maxCont = Math.max(maxCont, cs.length);
    glyf.i16(cs.length);
    glyf.i16(x0); glyf.i16(y0); glyf.i16(x1); glyf.i16(y1);
    let end = -1;
    for (const c of cs) { end += c.length; glyf.u16(end); }
    glyf.u16(0);
    // flags: on-curve, x/y as 16-bit deltas (no short-vector packing: simple and robust)
    for (let i = 0; i < np; i++) glyf.u8(1);
    let px = 0, py = 0;
    for (const c of cs) for (const [x] of c) { glyf.i16(x - px); px = x; }
    for (const c of cs) for (const [, y] of c) { glyf.i16(y - py); py = y; }
    glyf.pad4();
  }
  loca.push(glyf.b.length);
  const locaW = new W();
  for (const off of loca) locaW.u32(off);

  const bold = /Bold/.test(sub), italic = !!o.italic;
  const head = new W();
  head.u32(0x00010000); head.u32(0x00010000); head.u32(0); head.u32(0x5f0f3cf5);
  head.u16(0x000b); head.u16(em);
  head.u32(0); head.u32(0); head.u32(0); head.u32(0);
  head.i16(gxMin); head.i16(gyMin); head.i16(gxMax); head.i16(gyMax);
  head.u16((bold ? 1 : 0) | (italic ? 2 : 0)); head.u16(9); head.i16(2); head.i16(1); head.i16(0);

  const hhea = new W();
  hhea.u32(0x00010000); hhea.i16(ascent); hhea.i16(descent); hhea.i16(0);
  hhea.u16(advMax); hhea.i16(minLsb); hhea.i16(minRsb); hhea.i16(maxExt);
  hhea.i16(italic ? 5 : 1); hhea.i16(italic ? 1 : 0); hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0); hhea.u16(n);

  const maxp = new W();
  maxp.u32(0x00010000); maxp.u16(n); maxp.u16(maxPts); maxp.u16(maxCont);
  maxp.u16(0); maxp.u16(0); maxp.u16(2);
  for (let i = 0; i < 7; i++) maxp.u16(0);
  maxp.u16(0); maxp.u16(0);

  const avg = Math.round(chars.reduce((s, g) => s + g.adv, 0) / Math.max(1, chars.length));
  const os2 = new W();
  os2.u16(4); os2.i16(avg); os2.u16(o.weight ?? (bold ? 700 : 400)); os2.u16(5); os2.u16(0);
  os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(75); os2.i16(650); os2.i16(600); os2.i16(0); os2.i16(350);
  os2.i16(Math.round(em * 0.05)); os2.i16(Math.round(em * 0.26));
  os2.i16(0);
  os2.bytes([2, 2, bold ? 8 : 5, 3, 5, 4, 5, italic ? 9 : 2, 3, 3]); // panose: serif text
  os2.u32(1); os2.u32(0); os2.u32(0); os2.u32(0);
  os2.tag('PoRB');
  os2.u16((italic ? 1 : 0) | (bold ? 32 : 0) | (!italic && !bold ? 64 : 0) | 128); // USE_TYPO_METRICS
  os2.u16(Math.max(32, chars[0].cp)); os2.u16(Math.min(0xffff, chars[chars.length - 1].cp));
  os2.i16(ascent); os2.i16(descent); os2.i16(0);
  os2.u16(Math.max(ascent, gyMax)); os2.u16(Math.max(-descent, -gyMin));
  os2.u32(1); os2.u32(0);
  os2.i16(o.xHeight ?? Math.round(em * 0.48)); os2.i16(o.capHeight ?? Math.round(em * 0.68)); os2.u16(0); os2.u16(32); os2.u16(1);

  const ps = `${family}-${sub}`.replace(/\s+/g, '');
  const strs = [[1, family], [2, sub], [3, `${family} ${sub}`], [4, `${family} ${sub}`], [5, 'Version 1.0'], [6, ps]];
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

  const segs = [];
  chars.forEach((g, i) => {
    const gid = i + 1, c = g.cp;
    if (c > 0xfffe) return;
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
  post.u32(0x00030000); post.u32(italic ? (-12 << 16) >>> 0 : 0); post.i16(-Math.round(em * 0.1)); post.i16(Math.round(em * 0.05)); post.u32(0);
  post.u32(0); post.u32(0); post.u32(0); post.u32(0);

  const hmtx = new W();
  glyphs.forEach((g, i) => { hmtx.u16(g.adv); hmtx.i16(lsbs[i]); });

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca: locaW, maxp, name, post };

  const pairs = (o.kern ?? [])
    .map(([l, r, v]) => [gidOf.get(l), gidOf.get(r), v])
    .filter(([l, r, v]) => l && r && v)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pairs.length) {
    const kern = new W();
    const np = pairs.length;
    let ps2 = 1, sel = 0;
    while (ps2 * 2 <= np) { ps2 *= 2; sel++; }
    kern.u16(0); kern.u16(1);
    kern.u16(0); kern.u16(14 + np * 6); kern.u16(0x0001);
    kern.u16(np); kern.u16(ps2 * 6); kern.u16(sel); kern.u16((np - ps2) * 6);
    for (const [l, r, v] of pairs) { kern.u16(l); kern.u16(r); kern.i16(v); }
    tables.kern = kern;
  }

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
