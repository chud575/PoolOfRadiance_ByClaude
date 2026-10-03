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
 * The clearing: SIZE metres square of flagstones centred on the hearth. Irregular flags of every
 * size (a power diagram: big slabs among small infill stones), their edges worn and chipped, each
 * slab tilted or sunk a little on its own, some cracked across; earth, moss and grass in the joints;
 * whole flags gone to bare earth and weeds toward the dark edges; soot and ash round the hearth.
 * @returns {{map, normalMap, roughnessMap, size:number, missing:{x:number,z:number,w:number,d:number}[]}}
 */
export function groundTextures() {
  if (groundCache) return groundCache;
  const SIZE = 16;
  const W = 1536;
  const px = W / SIZE;
  const R = rng(4242);
  const n = valueNoise(7);
  const n2 = valueNoise(19);
  const color = cv(W);
  const g = ctx2d(color);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  const img = g.createImageData(W, W);
  const d = img.data;
  // Seeds on a jittered grid; each a flag with its own weight (size), tone, tilt and fate.
  const CS = 0.5;
  const GN = Math.ceil(SIZE / CS) + 2;
  const seeds = [];
  for (let gy = 0; gy < GN; gy++) {
    for (let gx = 0; gx < GN; gx++) {
      const sx = (gx - 1 + 0.15 + R() * 0.7) * CS, sy = (gy - 1 + 0.15 + R() * 0.7) * CS;
      const cxm = sx - SIZE / 2, czm = sy - SIZE / 2;
      const distC = Math.hypot(cxm, czm);
      const big = R();
      const gone = distC < 0.8 || (distC > 5 && R() < Math.min(0.7, (distC - 5) * 0.22)) || (distC > 1.6 && R() < 0.05);
      seeds.push({
        x: sx, y: sy,
        w: big > 0.72 ? CS * (0.3 + R() * 0.12) : big < 0.25 ? 0 : CS * R() * 0.18,
        tone: R(), warm: (R() - 0.5) * 22,
        tx: (R() - 0.5) * 0.12, ty: (R() - 0.5) * 0.12,
        sink: R() < 0.14 ? 0.15 + R() * 0.25 : 0,
        crack: R() < 0.3 ? R() * Math.PI : -1,
        gone, hearth: distC < 0.8, distC,
        moss: R(),
      });
    }
  }
  const missing = [];
  for (const sd of seeds) if (sd.gone && !sd.hearth) missing.push({ x: sd.x - SIZE / 2, z: sd.y - SIZE / 2, w: CS, d: CS });
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      // a warped lookup: flag edges wander and chip instead of running ruler-straight
      const warpA = (n(x / 14, y / 14) - 0.5) * 0.06 + (n2(x / 4, y / 4) - 0.5) * 0.012;
      const warpB = (n(x / 14 + 31, y / 14 + 17) - 0.5) * 0.06 + (n2(x / 4 + 9, y / 4) - 0.5) * 0.012;
      const wx = x / px + warpA, wy = y / px + warpB;
      const gx = Math.floor(wx / CS) + 1, gy = Math.floor(wy / CS) + 1;
      let b1 = 1e9, b2 = 1e9, i1 = 0, i2 = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = gy + oy;
        if (yy < 0 || yy >= GN) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = gx + ox;
          if (xx < 0 || xx >= GN) continue;
          const k = yy * GN + xx;
          const sd = seeds[k];
          const pd = (wx - sd.x) ** 2 + (wy - sd.y) ** 2 - sd.w * sd.w;
          if (pd < b1) { b2 = b1; i2 = i1; b1 = pd; i1 = k; } else if (pd < b2) { b2 = pd; i2 = k; }
        }
      }
      const s1 = seeds[i1], s2 = seeds[i2];
      const L = Math.hypot(s2.x - s1.x, s2.y - s1.y) || 1;
      const edge = (b2 - b1) / (2 * L); // metres to the joint
      const i = (y * W + x) * 4;
      const e = fbm(n, x / 18, y / 18, 4);
      const fine = n2(x / 2.5, y / 2.5);
      const jw = 0.016 + 0.014 * n(x / 30 + 5, y / 30);
      const rM = Math.hypot(x / px - SIZE / 2, y / px - SIZE / 2);
      let r, gg, b, h, ro;
      if (s1.gone || edge < jw) {
        // earth, grit and moss in the joints and where flags are gone
        const open = s1.gone ? 1 : 0;
        const moss = Math.max(0, fbm(n2, x / 9, y / 9, 3) - 0.48) * 2.4 * (1 - Math.max(0, 1 - rM / 2.2)) * (0.4 + 0.6 * Math.max(s1.moss, s2.moss));
        const pebble = fine > 0.8 ? 0.25 : 0;
        r = 40 + e * 34 + pebble * 60; gg = 33 + e * 28 + pebble * 56; b = 24 + e * 20 + pebble * 50;
        r = r * (1 - moss * 0.5) + moss * 34; gg = gg * (1 - moss * 0.35) + moss * 52; b = b * (1 - moss * 0.6) + moss * 18;
        h = 0.14 + e * 0.1 + pebble * 0.15 - (1 - open) * 0.04;
        ro = 245;
      } else {
        const sd = s1;
        const lx = wx - sd.x, ly = wy - sd.y;
        const bevel = Math.min(1, (edge - jw) / 0.035);
        // chips bitten out of the arris
        const chip = edge - jw < 0.03 && n2(x / 3.2 + 50, y / 3.2) > 0.72 ? 0.5 : 0;
        const t = fbm(n, x / 7 + sd.tone * 40, y / 7, 4);
        const pit = fine > 0.9 && n(x / 40 + 3, y / 40) > 0.5 ? 1 : 0;
        let k = 0.5 + sd.tone * 0.3 + (t - 0.5) * 0.32 - pit * 0.1;
        k *= 0.72 + 0.28 * Math.sqrt(bevel) - chip * 0.15;
        // grime gathers toward the edges; lichen rosettes on the older flags
        const lich = Math.max(0, n2(x / 11 + sd.tone * 20, y / 11) - 0.7) * 3 * (rM > 2 ? 1 : 0);
        r = 128 * k + sd.warm + 8; gg = 121 * k + sd.warm * 0.6 + 5; b = 110 * k;
        r = r * (1 - lich * 0.3) + lich * 40; gg = gg * (1 - lich * 0.2) + lich * 46; b = b * (1 - lich * 0.4) + lich * 22;
        h = 0.55 + 0.28 * Math.sqrt(bevel) - chip * 0.2 + (t - 0.5) * 0.07 - pit * 0.12 + sd.tx * lx * 4 + sd.ty * ly * 4 - sd.sink * 0.4;
        ro = 196 + t * 40 + pit * 20;
        if (sd.crack >= 0) {
          const ca = Math.cos(sd.crack), sa = Math.sin(sd.crack);
          const along = lx * ca + ly * sa;
          const across = -lx * sa + ly * ca + (n(along * 40 + sd.tone * 9, 3) - 0.5) * 0.05;
          if (Math.abs(across) < 0.0045) { r *= 0.42; gg *= 0.42; b *= 0.42; h -= 0.22; }
        }
      }
      // soot and ash round the hearth
      if (rM < 2.4) {
        const kk = Math.max(0, 1 - rM / 2.4) ** 1.6 * (0.75 + 0.25 * n(x / 7, y / 7));
        const ash = rM < 0.9 ? (1 - rM / 0.9) * 0.6 * n(x / 3, y / 3) : 0;
        r = r * (1 - kk * 0.8) + 90 * ash; gg = gg * (1 - kk * 0.82) + 86 * ash; b = b * (1 - kk * 0.84) + 80 * ash;
      }
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      hd[y * W + x] = h;
      rough[y * W + x] = ro;
    }
  }
  // grass blades in the open earth and the joints, thicker toward the edges of the clearing
  for (let k = 0; k < 140000; k++) {
    const x = Math.floor(R() * W), y = Math.floor(R() * W);
    const i = y * W + x;
    if (hd[i] > 0.36) continue;
    const r = Math.hypot(x / px - SIZE / 2, y / px - SIZE / 2);
    if (r < 1.3 || R() > 0.3 + Math.min(0.6, r * 0.08)) continue;
    const gcol = R() < 0.5 ? [58, 76, 32] : [86, 94, 44];
    const len = 1 + Math.floor(R() * 5);
    const lean = (R() - 0.5) * 0.8;
    for (let j = 0; j < len; j++) {
      const Y = y - j, X = Math.round(x + lean * j);
      if (Y < 0 || X < 0 || X >= W) break;
      const q = (Y * W + X) * 4;
      const f = 0.8 + 0.4 * (j / len);
      d[q] = (gcol[0] + R() * 20) * f; d[q + 1] = (gcol[1] + R() * 20) * f; d[q + 2] = gcol[2] * f;
      hd[Y * W + X] += 0.06;
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
      const heat = Math.max(0, 1 - along / 0.5) ** 1.4;
      // Alligator-skin char cracks.
      const c1 = Math.abs(fbm(n, x / 9, y / 9, 3) - 0.5);
      const c2 = Math.abs(fbm(n, x / 5 + 40, y / 5, 2) - 0.5);
      const crack = Math.max(0, 1 - Math.min(c1, c2) * 8);
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

let charCache = null;
/** Charcoal: black, blocky-checked char with glowing seams between the checks (map + emissive). */
export function charTextures() {
  if (charCache) return charCache;
  const W = 128;
  const n = valueNoise(313);
  const c = cv(W), e = cv(W);
  const gc = ctx2d(c), ge = ctx2d(e);
  const ic = gc.createImageData(W, W), ie = ge.createImageData(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      // alligator checks: a warped grid of blocks, the seams between them glowing
      const wx = x / 11 + (fbm(n, x / 20, y / 20, 2) - 0.5) * 1.6;
      const wy = y / 8 + (fbm(n, x / 20 + 9, y / 20, 2) - 0.5) * 1.6;
      const fx = Math.abs(wx - Math.round(wx)), fy = Math.abs(wy - Math.round(wy));
      const seam = Math.max(0, 1 - Math.min(fx, fy) * 9);
      const hot = Math.max(0, fbm(n, x / 14 + 40, y / 14, 3) - 0.38) * 2.2;
      const glow = Math.min(1, seam * hot * 1.6);
      const k = 0.08 + 0.1 * fbm(n, x / 4, y / 4, 2) + (1 - seam) * 0.05;
      const i = (y * W + x) * 4;
      ic.data[i] = 255 * k + 18 * glow; ic.data[i + 1] = 245 * k; ic.data[i + 2] = 235 * k; ic.data[i + 3] = 255;
      ie.data[i] = 255 * glow; ie.data[i + 1] = 90 * glow * glow + 20 * glow; ie.data[i + 2] = 8 * glow ** 3; ie.data[i + 3] = 255;
    }
  }
  gc.putImageData(ic, 0, 0);
  ge.putImageData(ie, 0, 0);
  charCache = { map: tex(c, true, true), emissive: tex(e, true, true) };
  return charCache;
}

/** Height + colour + roughness arrays → {map, normalMap, roughnessMap} (tiling). */
function pbrSet(W, H, col, hd, rough, strength) {
  const c = cv(W, H);
  const g = ctx2d(c);
  const img = g.createImageData(W, H);
  img.data.set(col);
  g.putImageData(img, 0, 0);
  const rc = cv(W, H);
  const rg = ctx2d(rc);
  const ri = rg.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough[i]; ri.data[i * 4 + 3] = 255; }
  rg.putImageData(ri, 0, 0);
  return { map: tex(c, true, true), normalMap: tex(normalFromHeight(hd, W, H, strength), false, true), roughnessMap: tex(rc, false, true) };
}

let ashlarCache = null;
/**
 * Dressed limestone without joints (each block is its own mesh): diagonal claw-tool striations,
 * pitting, iron and water stains, a weathered crust (tiles; 1 repeat ≈ 1 m).
 */
export function ashlarTextures() {
  if (ashlarCache) return ashlarCache;
  const W = 512;
  const n = valueNoise(523);
  const R = rng(91);
  const col = new Uint8ClampedArray(W * W * 4);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  const wrap = (f) => (x, y) => {
    // seamless: blend four offset samples
    const u = x / W, v = y / W;
    return f(x, y) * (1 - u) * (1 - v) + f(x - W, y) * u * (1 - v) + f(x, y - W) * (1 - u) * v + f(x - W, y - W) * u * v;
  };
  const big = wrap((x, y) => fbm(n, x / 70 + 50, y / 70 + 50, 4));
  const mid = wrap((x, y) => fbm(n, x / 16 + 9, y / 16 + 3, 3));
  const strI = wrap((x, y) => n((x + y) / 2.2, (x - y) / 26));
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const bg = big(x, y), md = mid(x, y);
      const stria = strI(x, y);
      const sp = R();
      const pit = sp > 0.985 ? 1 : 0;
      let k = 0.5 + (bg - 0.5) * 0.5 + (md - 0.5) * 0.22 + (stria - 0.5) * 0.08 - pit * 0.25 + (sp - 0.5) * 0.05;
      const stain = Math.max(0, bg - 0.62) * 2.2;
      const i = (y * W + x) * 4;
      col[i] = Math.min(255, 170 * k + 78 + stain * 18);
      col[i + 1] = Math.min(255, 162 * k + 72 + stain * 6);
      col[i + 2] = Math.min(255, 146 * k + 62 - stain * 12);
      col[i + 3] = 255;
      hd[y * W + x] = bg * 0.4 + md * 0.3 + stria * 0.1 - pit * 0.25;
      rough[y * W + x] = 205 + md * 40;
    }
  }
  ashlarCache = pbrSet(W, W, col, hd, rough, 5);
  return ashlarCache;
}

let earthCache = null;
/** Trodden earth with grit, roots and thin grass (tiles; for the dark ground beyond the flags). */
export function earthTextures() {
  if (earthCache) return earthCache;
  const W = 256;
  const n = valueNoise(611);
  const R = rng(17);
  const col = new Uint8ClampedArray(W * W * 4);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const e = (fbm(n, x / 20, y / 20, 4) + fbm(n, (x - W) / 20, y / 20, 4) * 0) ;
      const grit = R();
      const grass = Math.max(0, fbm(n, x / 9 + 70, y / 9, 3) - 0.55) * 2.5;
      const i = (y * W + x) * 4;
      const k = 0.7 + e * 0.5 + (grit > 0.95 ? 0.3 : 0);
      col[i] = (38 * k) * (1 - grass * 0.4) + grass * 30; col[i + 1] = (31 * k) * (1 - grass * 0.2) + grass * 44; col[i + 2] = (23 * k) * (1 - grass * 0.5) + grass * 16; col[i + 3] = 255;
      hd[y * W + x] = e * 0.6 + (grit > 0.95 ? 0.2 : 0) + grass * 0.1;
      rough[y * W + x] = 240;
    }
  }
  earthCache = pbrSet(W, W, col, hd, rough, 4);
  return earthCache;
}

let clothCache = null;
/** Coarse undyed canvas / burlap weave (tiles). */
export function canvasTextures() {
  if (clothCache) return clothCache;
  const W = 128;
  const n = valueNoise(733);
  const col = new Uint8ClampedArray(W * W * 4);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const wa = Math.sin((x / W) * Math.PI * 2 * 32) * 0.5 + 0.5;
      const we = Math.sin((y / W) * Math.PI * 2 * 32) * 0.5 + 0.5;
      const over = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? wa : we;
      const s = n(x / 6, y / 6);
      const i = (y * W + x) * 4;
      const k = 0.62 + over * 0.3 + (s - 0.5) * 0.25;
      col[i] = 168 * k; col[i + 1] = 148 * k; col[i + 2] = 112 * k; col[i + 3] = 255;
      hd[y * W + x] = over * 0.8 + s * 0.2;
      rough[y * W + x] = 250;
    }
  }
  clothCache = pbrSet(W, W, col, hd, rough, 3);
  return clothCache;
}

let woodCache = null;
/** Weathered timber: grain along u, checks and a grey sun-bleached crust (tiles). */
export function woodTextures() {
  if (woodCache) return woodCache;
  const W = 256;
  const n = valueNoise(811);
  const col = new Uint8ClampedArray(W * W * 4);
  const hd = new Float32Array(W * W);
  const rough = new Uint8ClampedArray(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const gr = Math.sin(y * 0.5 + fbm(n, x / 40, y / 8, 3) * 9) * 0.5 + 0.5;
      const check = Math.max(0, 1 - Math.abs(fbm(n, x / 60 + 5, y / 3, 2) - 0.5) * 30) * (n(x / 30, y / 30) > 0.55 ? 1 : 0);
      const i = (y * W + x) * 4;
      const k = 0.55 + gr * 0.3 - check * 0.35;
      col[i] = 108 * k + 14; col[i + 1] = 86 * k + 10; col[i + 2] = 64 * k + 8; col[i + 3] = 255;
      hd[y * W + x] = gr * 0.5 - check * 0.5;
      rough[y * W + x] = 210 + gr * 30;
    }
  }
  woodCache = pbrSet(W, W, col, hd, rough, 4);
  return woodCache;
}
