import * as THREE from 'three';

/**
 * Procedural textures for the encampment: a non-repeating flagstone clearing
 * (irregular courses, cracked, sunken and missing stones, earth and weeds in
 * the joints, soot around the hearth), bark and split-wood, ember cracks for
 * the burning logs, a glowing coal bed and soft smoke puffs. All drawn once
 * on CPU canvases (fast to upload), deterministic from fixed seeds.
 */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cv = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

function valueNoise(seed) {
  const R = rng(seed);
  const N = 256;
  const p = new Float32Array(N * N);
  for (let i = 0; i < p.length; i++) p[i] = R();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = p[(yi & 255) * N + (xi & 255)], b = p[(yi & 255) * N + ((xi + 1) & 255)];
    const c = p[((yi + 1) & 255) * N + (xi & 255)], d = p[((yi + 1) & 255) * N + ((xi + 1) & 255)];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(n, x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); a *= 0.5; f *= 2.03; }
  return s;
}

/** Height (0..1, CPU) → tangent-space normal canvas. */
function normalFromHeight(hd, W, H, strength) {
  const out = cv(W, H);
  const g = ctx2d(out);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = hd[y * W + Math.max(0, x - 1)], r = hd[y * W + Math.min(W - 1, x + 1)];
      const u = hd[Math.max(0, y - 1) * W + x], dn = hd[Math.min(H - 1, y + 1) * W + x];
      let nx = (l - r) * strength, ny = (dn - u) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * W + x) * 4;
      d[i] = (nx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

function tex(c, srgb, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let groundCache = null;
/**
 * The clearing: SIZE metres square of flagstones centred on the hearth.
 * @returns {{map, normalMap, roughnessMap, size:number, missing:{x:number,z:number,w:number,d:number}[], slabs:object[]}}
 */
export function groundTextures() {
  if (groundCache) return groundCache;
  const SIZE = 16;
  const W = 1536;
  const px = W / SIZE;
  const R = rng(4242);
  const n = valueNoise(7);
  const color = cv(W);
  const g = ctx2d(color);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  // Earth beneath everything.
  const img = g.createImageData(W, W);
  const d = img.data;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const e = fbm(n, x / 18, y / 18, 5);
      const i = (y * W + x) * 4;
      d[i] = 44 + e * 40; d[i + 1] = 36 + e * 32; d[i + 2] = 26 + e * 22; d[i + 3] = 255;
      hd[y * W + x] = 0.12 + e * 0.1;
      rough[y * W + x] = 240;
    }
  }
  // Flagstone courses: rows of irregular slabs, jittered, some missing or sunken.
  const stones = [];
  const missing = [];
  let yy = 0;
  while (yy < SIZE) {
    const rowH = 0.45 + R() * 0.45;
    let xx = -R() * 0.6;
    while (xx < SIZE) {
      const w = 0.5 + R() * 0.8;
      const sx = xx + 0.03 + R() * 0.03, sy = yy + 0.03 + R() * 0.03;
      const sw = w - 0.06 - R() * 0.03, sh = rowH - 0.06 - R() * 0.03;
      const cxm = sx + sw / 2 - SIZE / 2, czm = sy + sh / 2 - SIZE / 2;
      const distC = Math.hypot(cxm, czm);
      // The far clearing breaks up; a ring right by the fire is bare hearth.
      const gone = (distC > 5.2 && R() < Math.min(0.75, (distC - 5.2) * 0.3)) || (distC > 1.5 && R() < 0.07);
      if (distC < 0.78) { xx += w; continue; }
      if (gone) missing.push({ x: cxm, z: czm, w: sw, d: sh });
      else stones.push({ x: sx, y: sy, w: sw, h: sh, rot: (R() - 0.5) * 0.05, tone: R(), sink: R() < 0.12 ? 0.25 + R() * 0.3 : 0, crack: R() < 0.32 });
      xx += w;
    }
    yy += rowH;
  }
  for (const s of stones) {
    const x0 = Math.floor(s.x * px), y0 = Math.floor(s.y * px), x1 = Math.ceil((s.x + s.w) * px), y1 = Math.ceil((s.y + s.h) * px);
    const cxp = (x0 + x1) / 2, cyp = (y0 + y1) / 2;
    const hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
    const base = 0.55 + s.tone * 0.25;
    const warm = (s.tone - 0.5) * 18;
    const corner = Math.min(hw, hh) * 0.22;
    for (let y = Math.max(0, y0); y < Math.min(W, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        // Rounded, slightly irregular edges.
        const ex = Math.max(0, Math.abs(x - cxp) - (hw - corner)), ey = Math.max(0, Math.abs(y - cyp) - (hh - corner));
        const edgeN = (n(x / 6, y / 6) - 0.5) * corner * 0.9;
        const dd = Math.hypot(ex, ey) - corner + edgeN;
        if (dd > 0) continue;
        const bevel = Math.min(1, -dd / (corner * 0.9 + 1));
        const t = fbm(n, x / 9 + s.tone * 50, y / 9, 4);
        const pit = n(x / 2.2 + 99, y / 2.2) > 0.82 ? -0.15 : 0;
        const i = (y * W + x) * 4;
        const k = (base + (t - 0.5) * 0.35 + pit * 0.6) * (0.75 + 0.25 * bevel);
        d[i] = Math.min(255, 128 * k + warm + 10); d[i + 1] = Math.min(255, 122 * k + warm * 0.6 + 6); d[i + 2] = Math.min(255, 112 * k);
        hd[y * W + x] = 0.55 + 0.3 * bevel ** 0.5 + (t - 0.5) * 0.08 + pit * 0.5 - s.sink * 0.4;
        rough[y * W + x] = 200 + t * 40;
      }
    }
    if (s.crack) {
      // A branching hairline crack across the slab.
      let x = cxp + (R() - 0.5) * hw, y = y0 + 2;
      let a = Math.PI / 2 + (R() - 0.5) * 0.8;
      for (let k = 0; k < (y1 - y0) * 1.4; k++) {
        a += (R() - 0.5) * 0.5;
        x += Math.cos(a) * 1.2;
        y += Math.sin(a) * 1.2;
        if (y > y1 - 2 || x < x0 || x > x1) break;
        for (let o = -1; o <= 1; o++) {
          const X = Math.round(x + o * 0.5), Y = Math.round(y);
          if (X < 0 || Y < 0 || X >= W || Y >= W) continue;
          const i = (Y * W + X) * 4;
          d[i] *= 0.45; d[i + 1] *= 0.45; d[i + 2] *= 0.45;
          hd[Y * W + X] -= 0.25;
        }
      }
    }
  }
  // Grass and weeds in the joints and the broken ground, thicker toward the edges.
  for (let k = 0; k < 160000; k++) {
    const x = Math.floor(R() * W), y = Math.floor(R() * W);
    const i = y * W + x;
    if (hd[i] > 0.4) continue;
    const r = Math.hypot(x / px - SIZE / 2, y / px - SIZE / 2);
    if (r < 1.2 || R() > 0.35 + Math.min(0.6, r * 0.08)) continue;
    const gcol = R() < 0.5 ? [58, 78, 34] : [84, 96, 44];
    const len = 1 + Math.floor(R() * 4);
    for (let j = 0; j < len; j++) {
      const Y = y - j;
      if (Y < 0) break;
      const q = (Y * W + x) * 4;
      d[q] = gcol[0] + R() * 20; d[q + 1] = gcol[1] + R() * 20; d[q + 2] = gcol[2];
      hd[Y * W + x] += 0.08;
    }
  }
  // Soot and ash around the hearth.
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x / px - SIZE / 2, y / px - SIZE / 2);
      if (r > 2.4) continue;
      const k = Math.max(0, 1 - r / 2.4) ** 1.6 * (0.75 + 0.25 * n(x / 7, y / 7));
      const i = (y * W + x) * 4;
      const ash = r < 0.9 ? (1 - r / 0.9) * 0.6 * n(x / 3, y / 3) : 0;
      d[i] = d[i] * (1 - k * 0.8) + 90 * ash; d[i + 1] = d[i + 1] * (1 - k * 0.82) + 86 * ash; d[i + 2] = d[i + 2] * (1 - k * 0.84) + 80 * ash;
    }
  }
  g.putImageData(img, 0, 0);
  const normal = normalFromHeight(hd, W, W, 9);
  const rc = cv(W);
  const rg = ctx2d(rc);
  const ri = rg.createImageData(W, W);
  for (let i = 0; i < W * W; i++) { ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough[i]; ri.data[i * 4 + 3] = 255; }
  rg.putImageData(ri, 0, 0);
  groundCache = { map: tex(color, true), normalMap: tex(normal, false), roughnessMap: tex(rc, false), size: SIZE, missing };
  return groundCache;
}

let barkCache = null;
/** Bark around the log, pale split wood along the flat face (v across, u along). */
export function barkTextures() {
  if (barkCache) return barkCache;
  const W = 256, H = 256;
  const n = valueNoise(31);
  const c = cv(W, H);
  const g = ctx2d(c);
  const img = g.createImageData(W, H);
  const hd = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Bark: deep furrows running along the log (x), plates between.
      const f = Math.abs(Math.sin(y * 0.35 + fbm(n, x / 30, y / 6, 3) * 6));
      const plate = fbm(n, x / 12, y / 4, 3);
      const k = 0.35 + f * 0.4 + plate * 0.3;
      const i = (y * W + x) * 4;
      img.data[i] = 70 * k + 20; img.data[i + 1] = 52 * k + 14; img.data[i + 2] = 38 * k + 10; img.data[i + 3] = 255;
      hd[y * W + x] = f * 0.7 + plate * 0.3;
    }
  }
  g.putImageData(img, 0, 0);
  barkCache = { map: tex(c, true, true), normalMap: tex(normalFromHeight(hd, W, H, 6), false, true) };
  return barkCache;
}

let emberCache = null;
/** Ember cracks: an emissive map that glows hottest at the log's burning end (v = 0). */
export function emberTexture() {
  if (emberCache) return emberCache;
  const W = 256, H = 256;
  const n = valueNoise(57);
  const c = cv(W, H);
  const g = ctx2d(c);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const along = x / W; // 0 = burning end
      const heat = Math.max(0, 1 - along / 0.36) ** 1.6;
      // Alligator-skin char cracks.
      const c1 = Math.abs(fbm(n, x / 9, y / 9, 3) - 0.5);
      const c2 = Math.abs(fbm(n, x / 5 + 40, y / 5, 2) - 0.5);
      const crack = Math.max(0, 1 - Math.min(c1, c2) * 14);
      const glow = Math.min(1, crack * heat * 1.4 + heat * heat * 0.35 * n(x / 4, y / 4));
      const i = (y * W + x) * 4;
      img.data[i] = 255 * glow; img.data[i + 1] = 110 * glow * glow + 30 * glow; img.data[i + 2] = 20 * glow * glow * glow; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  emberCache = tex(c, true, true);
  return emberCache;
}

let coalCache = null;
/** The ember bed: glowing coals in grey ash (emissive), with a colour map for the ash. */
export function coalTextures() {
  if (coalCache) return coalCache;
  const W = 256;
  const n = valueNoise(91);
  const em = cv(W);
  const col = cv(W);
  const ge = ctx2d(em), gc = ctx2d(col);
  const ie = ge.createImageData(W, W), ic = gc.createImageData(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - W / 2, y - W / 2) / (W / 2);
      const cells = fbm(n, x / 7, y / 7, 3);
      const hot = Math.max(0, (cells - 0.42) * 3) * Math.max(0, 1 - r * 1.15);
      const i = (y * W + x) * 4;
      const glow = Math.min(1, hot * hot * 2.2);
      ie.data[i] = 255 * glow; ie.data[i + 1] = 96 * glow * glow + 20 * glow; ie.data[i + 2] = 10 * glow ** 3; ie.data[i + 3] = 255;
      const ash = 0.25 + 0.35 * fbm(n, x / 3, y / 3, 2);
      const k = glow > 0.05 ? 0.1 : ash;
      ic.data[i] = 90 * k + 10; ic.data[i + 1] = 84 * k + 8; ic.data[i + 2] = 80 * k + 8;
      ic.data[i + 3] = r < 1 ? 255 * Math.min(1, (1 - r) * 4) : 0;
    }
  }
  ge.putImageData(ie, 0, 0);
  gc.putImageData(ic, 0, 0);
  coalCache = { emissive: tex(em, true), map: tex(col, true) };
  return coalCache;
}

let smokeCache = null;
/** A soft, lumpy smoke puff (alpha). */
export function smokeTexture() {
  if (smokeCache) return smokeCache;
  const W = 128;
  const n = valueNoise(13);
  const c = cv(W);
  const g = ctx2d(c);
  const img = g.createImageData(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - W / 2, y - W / 2) / (W / 2);
      const a = Math.max(0, 1 - r) ** 1.5 * (0.45 + 0.75 * fbm(n, x / 10, y / 10, 4));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  smokeCache = tex(c, true);
  return smokeCache;
}

let blobCache = null;
/** A soft contact-shadow blob. */
export function blobTexture() {
  if (blobCache) return blobCache;
  const W = 128;
  const c = cv(W);
  const g = ctx2d(c);
  const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, W);
  blobCache = tex(c, true);
  return blobCache;
}

let stoneCache = null;
/** Weathered fieldstone: speckled granite with lichen flecks, pits and a crystalline grain (tiles). */
export function stoneTextures() {
  if (stoneCache) return stoneCache;
  const W = 256;
  const n = valueNoise(211);
  const c = cv(W);
  const g = ctx2d(c);
  const img = g.createImageData(W, W);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  const R = rng(77);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const big = fbm(n, x / 40, y / 40, 4);
      const mid = fbm(n, x / 9 + 50, y / 9, 3);
      const speck = R();
      const pit = Math.max(0, 0.42 - fbm(n, x / 5 + 90, y / 5 + 20, 2)) * 3;
      let k = 0.42 + big * 0.35 + (mid - 0.5) * 0.22 + (speck > 0.93 ? 0.22 : speck < 0.06 ? -0.18 : 0);
      k -= pit * 0.08;
      const lichen = Math.max(0, fbm(n, x / 14 + 7, y / 14 + 3, 3) - 0.62) * 3.5;
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, (118 * k + 18) * (1 - lichen * 0.2) + lichen * 40);
      img.data[i + 1] = Math.min(255, (112 * k + 16) * (1 - lichen * 0.1) + lichen * 46);
      img.data[i + 2] = Math.min(255, (104 * k + 16) * (1 - lichen * 0.35) + lichen * 16);
      img.data[i + 3] = 255;
      hd[y * W + x] = big * 0.6 + mid * 0.25 - pit * 0.08 + (speck > 0.9 ? 0.02 : 0);
      rough[y * W + x] = 200 + Math.min(55, pit * 60) - lichen * 20;
    }
  }
  g.putImageData(img, 0, 0);
  const rc = cv(W);
  const rg = ctx2d(rc);
  const ri = rg.createImageData(W, W);
  for (let i = 0; i < W * W; i++) { ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough[i]; ri.data[i * 4 + 3] = 255; }
  rg.putImageData(ri, 0, 0);
  stoneCache = { map: tex(c, true, true), normalMap: tex(normalFromHeight(hd, W, W, 7), false, true), roughnessMap: tex(rc, false, true) };
  return stoneCache;
}
