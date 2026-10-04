import { paintPanel, npcActor, ghostActor } from '../../ui/art/index.js';
import { NPCS } from '../../data/npcs.js';
import { rngOf, makeCanvas } from '../../ui/art/paint.js';

/**
 * The Adventurer's Journal as a physical book: page textures with curvature,
 * a gutter shadow, deckled edges and a stack of page edges; and a bespoke
 * copper-plate engraving for each entry — the scene is composed (setting,
 * figures), then re-drawn as cross-hatched burin lines and ink contours.
 */

// subject of each entry's plate
const PLATES = {
  1: { setting: 'docks', light: 'dusk' }, 2: { setting: 'docks', light: 'day' }, 3: { setting: 'cityhall', actor: 'clerk' }, 4: { setting: 'cityhall', actor: 'clerk' },
  5: { setting: 'slums', monsters: [{ id: 'kobold', count: 3 }] }, 6: { setting: 'keep', light: 'night' }, 7: { setting: 'chapel', actor: 'ferran', light: 'ghost', pose: 'vigil', bgDark: true },
  8: { setting: 'well_head' }, 9: { setting: 'plaza', light: 'day' }, 10: { setting: 'library', actor: 'sage' }, 11: { setting: 'library' }, 12: { setting: 'textile' },
  13: { setting: 'temple_bane', actor: 'bane_priest' }, 14: { setting: 'graveyard', monsters: [{ id: 'skeleton', count: 3 }] }, 15: { setting: 'castle', monsters: [{ id: 'hillGiant', count: 1 }] },
  16: { setting: 'gate', monsters: [{ id: 'orc', count: 3 }] }, 17: { setting: 'temple_bane' }, 18: { setting: 'pool', monsters: [{ id: 'tyranthraxus', count: 1 }] }, 19: { setting: 'wilds' },
  20: { setting: 'tavern', actor: 'barkeep' }, 21: { setting: 'well', monsters: [{ id: 'koboldChief', count: 1 }, { id: 'kobold', count: 2 }] }, 22: { setting: 'plaza', monsters: [{ id: 'bandit', count: 3 }] },
  23: { setting: 'textile' }, 24: { setting: 'graveyard', monsters: [{ id: 'wight', count: 1 }] }, 25: { setting: 'keep', monsters: [{ id: 'zombie', count: 3 }] }, 26: { setting: 'cityhall', actor: 'clerk' },
  27: { setting: 'temple', actor: 'priest_tyr' }, 28: { setting: 'temple', actor: 'priest_tyr' }, 29: { setting: 'alley', actor: 'thief_guild', light: 'night' }, 30: { setting: 'textile' },
};

const plateCache = new Map();

/** Data URL of the engraved plate for journal entry n (or null). */
export function engravedPlate(n) {
  const spec = PLATES[n];
  if (!spec) return null;
  if (plateCache.has(n)) return plateCache.get(n);
  if (n === 7) {
    const url = drawnVigilPlate().toDataURL('image/png');
    plateCache.set(n, url);
    return url;
  }
  const W = 720;
  const H = 340;
  // paint wider than the plate, then frame the subject in the centre third
  const PW = 1000;
  const npc = spec.actor ? NPCS[spec.actor] : null;
  const actor = npc ? (npc.kind === 'ghost' ? ghostActor(spec.pose) : npcActor(npc)) : null;
  const { canvas: wide, composer } = paintPanel({ setting: spec.setting, light: spec.light, monsters: spec.monsters, actor, w: PW, h: H, seed: n * 17 + 3 });
  // the subject's silhouette: every figure sprite drawn as a flat mask
  const wmask = makeCanvas(PW, H);
  const mg = wmask.getContext('2d');
  for (const a of composer.actors) composer._sprite(mg, { ...a, ghost: false, r: { ...a.r, emit: [] } }, 0);
  for (const o of composer.ops) if (o.kind === 'sprite') composer._sprite(mg, { ...o, ghost: false, r: { ...o.r, emit: [] } }, 0);
  const md = mg.getImageData(0, 0, PW, H).data;
  let sx = 0; let sn = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < PW; x += 2) { const a = md[(y * PW + x) * 4 + 3]; if (a > 128) { sx += x; sn++; } }
  const cx = sn ? sx / sn : PW / 2;
  const x0 = Math.round(Math.max(0, Math.min(PW - W, cx - W / 2)));
  const crop = (src) => { const c = makeCanvas(W, H); c.getContext('2d').drawImage(src, -x0, 0); return c; };
  const url = engrave(crop(wide), crop(wmask), n, spec).toDataURL('image/png');
  plateCache.set(n, url);
  return url;
}

/**
 * Re-draw a painting as a line engraving. Tone comes from the painting's
 * luminance; direction from its structure tensor, so the burin strokes run
 * along the forms (isophotes) rather than in one fixed diagonal; each darker
 * tone adds a crossing layer and the lines swell with the tone they cross.
 * The figures (the subject) are drawn from a flat-lit silhouette pass: a
 * clean, weighted ink contour around them and gentler hatching inside, so
 * they read against a quieter background. An oval vignette keeps the work
 * inside the plate mark.
 */
function engrave(src, maskC, seed, opts = {}) {
  const W = src.width;
  const H = src.height;
  const d = src.getContext('2d').getImageData(0, 0, W, H).data;
  const md = maskC.getContext('2d').getImageData(0, 0, W, H).data;
  const N = W * H;
  const L = new Float32Array(N);
  const M = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255; M[i] = md[i * 4 + 3] / 255; }
  const blur = (A, r) => {
    const T = new Float32Array(N); const O = new Float32Array(N);
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += A[y * W + Math.max(0, Math.min(W - 1, x))]; for (let x = 0; x < W; x++) { T[y * W + x] = s / (2 * r + 1); s += A[y * W + Math.min(W - 1, x + r + 1)] - A[y * W + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += T[Math.max(0, Math.min(H - 1, y)) * W + x]; for (let y = 0; y < H; y++) { O[y * W + x] = s / (2 * r + 1); s += T[Math.min(H - 1, y + r + 1) * W + x] - T[Math.max(0, y - r) * W + x]; } }
    return O;
  };
  // the subject keeps its detail; the background is softened first so its masonry never turns to scribble
  const B1 = blur(L, 1);
  const B3 = blur(L, 3);
  const Mb = blur(M, 1);
  const B = new Float32Array(N);
  // local contrast: the setting's big shapes (altar, windows, pews) are lifted out of a dark room, as
  // an engraver would key them, before the tone is mapped
  const Bw = blur(L, 24);
  for (let i = 0; i < N; i++) {
    const b = B1[i] * Mb[i] + B3[i] * (1 - Mb[i]);
    B[i] = Math.max(0, Math.min(1, b + (b - Bw[i]) * 1.3 * (1 - Mb[i])));
  }
  // tone: normalised darkness, the background flattened a little so the subject carries the plate
  const sample = [];
  for (let i = 0; i < N; i += 11) sample.push(B[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.04)];
  const hi = sample[Math.floor(sample.length * 0.97)];
  const ss = [];
  for (let i = 0; i < N; i += 3) if (M[i] > 0.5) ss.push(B[i]);
  ss.sort((a, b) => a - b);
  const slo = ss.length ? ss[Math.floor(ss.length * 0.03)] : lo;
  const shi = ss.length ? ss[Math.floor(ss.length * 0.97)] : hi;
  const R = rngOf(seed * 31 + 7);
  const tone = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const subj = Mb[i];
    let t;
    if (subj > 0.5) {
      // the subject is shaded on its own range (a pale ghost still gets form-following hatching):
      // light planes stay open paper, the turning planes take one and two layers, the core shadow three
      t = 1 - Math.max(0, Math.min(1, (B[i] - slo) / Math.max(0.05, shi - slo)));
      t = opts.bgDark ? 0.04 + Math.pow(t, 1.25) * 0.8 : 0.08 + Math.pow(t, 1.1) * 0.88;
    } else {
      t = 1 - Math.max(0, Math.min(1, (B[i] - lo) / Math.max(0.05, hi - lo)));
      // background kept light and quiet (open paper, ruled tints) — or, behind a pale subject such
      // as a ghost, dark: the figure then reads as clean paper cut out of a cross-hatched night
      t = opts.bgDark ? 0.2 + Math.pow(t, 0.8) * 0.78 : 0.08 + Math.pow(t, 1.4) * 0.74;
    }
    // three value groups, as an engraver keys a plate: open paper, one ruled tint, crosshatch
    const sst = (a, b, v) => { const q = Math.max(0, Math.min(1, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
    t = 0.04 + 0.38 * sst(0.26, 0.32, t) + 0.46 * sst(0.6, 0.66, t);
    // the work stops crisply at the inner rule of the plate mark
    const m = 15;
    tone[i] = x < m || y < m || x >= W - m || y >= H - m ? 0 : t;
  }
  // structure tensor → stroke direction along the forms
  const gx = new Float32Array(N); const gy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    gx[i] = (B[i - W + 1] + 2 * B[i + 1] + B[i + W + 1]) - (B[i - W - 1] + 2 * B[i - 1] + B[i + W - 1]);
    gy[i] = (B[i + W - 1] + 2 * B[i + W] + B[i + W + 1]) - (B[i - W - 1] + 2 * B[i - W] + B[i - W + 1]);
  }
  const jxx = new Float32Array(N); const jxy = new Float32Array(N); const jyy = new Float32Array(N);
  for (let i = 0; i < N; i++) { jxx[i] = gx[i] * gx[i]; jxy[i] = gx[i] * gy[i]; jyy[i] = gy[i] * gy[i]; }
  const Jxx = blur(jxx, 5); const Jxy = blur(jxy, 5); const Jyy = blur(jyy, 5);
  const ang = new Float32Array(N);
  const base = 0.62; // the engraver's default diagonal where the picture has no form
  for (let i = 0; i < N; i++) {
    const th = 0.5 * Math.atan2(2 * Jxy[i], Jxx[i] - Jyy[i]) + Math.PI / 2; // isophote direction
    // the background's masonry noise must not steer the burin (that reads as scribble): there the
    // engraver keeps to long ruled diagonals and only bends with strong structure
    const coh = Math.min(1, Math.sqrt((Jxx[i] - Jyy[i]) ** 2 + 4 * Jxy[i] ** 2) * 40) * (Mb[i] > 0.3 ? 1 : 0.55);
    // blend toward the default by coherence (on the double-angle circle)
    const c = Math.cos(2 * th) * coh + Math.cos(2 * base) * (1 - coh);
    const s2 = Math.sin(2 * th) * coh + Math.sin(2 * base) * (1 - coh);
    ang[i] = 0.5 * Math.atan2(s2, c);
  }
  const out = makeCanvas(W, H);
  const og = out.getContext('2d');
  og.lineCap = 'round';
  og.lineJoin = 'round';
  const ink = (a) => `rgba(38,24,14,${a.toFixed(3)})`;
  const at = (A, x, y) => A[Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))];
  // burin layers: [tone threshold, spacing px, angle offset, stroke half-length]
  const layers = [[0.2, 4.2, 0, 22], [0.5, 4.8, 0.9, 16], [0.74, 5.4, Math.PI / 2, 10], [0.9, 4, -0.45, 6]];
  for (const [thr, sp, off, len] of layers) {
    // evenly spaced streamlines: a stroke stops where it would crowd a neighbour of its own layer
    const occ = new Uint8Array(N);
    const sep = sp * 0.42;
    const free = (x, y) => occ[Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))] === 0;
    const mark = (x, y) => {
      const r = Math.ceil(sep);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (i * i + j * j > sep * sep) continue;
        const xx = Math.round(x) + i; const yy = Math.round(y) + j;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) occ[yy * W + xx] = 1;
      }
    };
    for (let gy0 = sp / 2; gy0 < H; gy0 += sp) {
      for (let gx0 = (gy0 / sp) % 2 ? sp / 2 : 0; gx0 < W; gx0 += sp) {
        const x0 = gx0 + (R() - 0.5) * sp * 0.25;
        const y0 = gy0 + (R() - 0.5) * sp * 0.25;
        const t0 = at(tone, x0, y0);
        if (t0 < thr || !free(x0, y0)) continue;
        // trace both ways along the direction field (background tints run long, like ruled lines)
        const pts = [[x0, y0]];
        const reach = at(Mb, x0, y0) > 0.5 ? len : len * 2;
        for (const dir of [1, -1]) {
          let x = x0; let y = y0;
          for (let k = 0; k < reach; k++) {
            const a = at(ang, x, y) + off;
            x += Math.cos(a) * dir * 1.4;
            y += Math.sin(a) * dir * 1.4;
            if (x < 0 || y < 0 || x >= W || y >= H || at(tone, x, y) < thr - 0.06 || !free(x, y)) break;
            if (dir > 0) pts.push([x, y]); else pts.unshift([x, y]);
          }
        }
        if (pts.length < 3) continue;
        for (const [px, py] of pts) mark(px, py);
        const subj = at(Mb, x0, y0) > 0.5;
        og.strokeStyle = ink(subj ? 0.85 : 0.72);
        og.lineWidth = Math.min(2.2, 0.3 + (t0 - thr) * (subj ? 2.4 : 1.9));
        og.beginPath();
        og.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) og.lineTo(pts[k][0], pts[k][1]);
        og.stroke();
      }
    }
  }
  // stipple the deepest shadows
  for (let i = 0; i < 9000; i++) {
    const x = R() * W; const y = R() * H;
    const t = at(tone, x, y);
    if (t < 0.9 || R() > (t - 0.9) * 4) continue;
    og.fillStyle = ink(0.8);
    og.fillRect(x, y, 1.1, 1.1);
  }
  // contours: strong picture edges thin, the subject's silhouette heavy and clean
  const img = og.getImageData(0, 0, W, H);
  const o = img.data;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x;
    const fade = x < 15 || y < 15 || x >= W - 15 || y >= H - 15 ? 0 : 1;
    if (fade <= 0) continue;
    const e = Math.hypot(gx[i], gy[i]) * 0.25 * fade;
    // silhouette: the mask's edge sampled two pixels out, so the line is 2-3 px, the heaviest on the plate
    const me = Math.abs(Mb[i + 2] - Mb[i - 2]) + Math.abs(Mb[i + 2 * W] - Mb[i - 2 * W]);
    const inSubj = Mb[i] > 0.5;
    let a = 0;
    // creases inside the subject read firmer than the background's edges, which stay hairlines
    if (inSubj && e > 0.1) a = Math.min(0.85, (e - 0.1) * 6);
    else if (!inSubj && e > 0.2) a = Math.min(0.5, (e - 0.2) * 3);
    if (me > 0.35) a = Math.max(a, Math.min(1, me * 1.1) * fade);
    if (a <= 0) continue;
    const k = i * 4;
    const prev = o[k + 3] / 255;
    const na = 1 - (1 - prev) * (1 - a);
    o[k] = 38; o[k + 1] = 24; o[k + 2] = 14; o[k + 3] = Math.round(na * 240);
  }
  og.putImageData(img, 0, 0);
  // plate mark: a double ruled border pressed into the paper
  og.strokeStyle = 'rgba(38,24,14,0.92)';
  og.lineWidth = 2.2;
  og.strokeRect(6, 6, W - 12, H - 12);
  og.lineWidth = 1;
  og.strokeRect(14.5, 14.5, W - 29, H - 29);
  return out;
}

const pageCache = new Map();

/**
 * Page background for one side of the open book: aged paper with fibre and
 * foxing, the page curving down into the gutter, deckled outer edge, and the
 * stacked edges of the pages beneath.
 * @param {'left'|'right'} side
 */
export function pageTexture(side) {
  if (pageCache.has(side)) return pageCache.get(side);
  const W = 760;
  const H = 1000;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const R = rngOf(side === 'left' ? 11 : 23);
  const out = side === 'left' ? 0 : W; // outer edge x
  const gut = side === 'left' ? W : 0; // gutter x
  const dir = side === 'left' ? 1 : -1;
  // stacked page edges beneath (outer edge and bottom)
  for (let i = 6; i >= 1; i--) {
    g.fillStyle = i % 2 ? '#d6c49a' : '#c8b486';
    const inset = i * 3;
    g.fillRect(side === 'left' ? 0 : inset, inset * 0.6, W - inset, H - inset * 0.6 + i * 1.5);
  }
  // the page, deckled at its outer edge
  const page = new Path2D();
  const edgeX = side === 'left' ? 22 : W - 22;
  page.moveTo(gut, 6);
  let x = edgeX;
  page.lineTo(x, 10);
  for (let y = 10; y < H - 14; y += 6) page.lineTo(edgeX + dir * -0 + (R() - 0.5) * 4 * dir + (side === 'left' ? 0 : 0), y);
  page.lineTo(edgeX, H - 14);
  for (let xx = edgeX; side === 'left' ? xx < W : xx > 0; xx += dir * 6) page.lineTo(xx, H - 14 + (R() - 0.5) * 3);
  page.lineTo(gut, H - 12);
  page.closePath();
  g.save();
  g.clip(page);
  // paper base with warm vignette
  const base = g.createLinearGradient(out, 0, gut, 0);
  base.addColorStop(0, '#e6d4a8');
  base.addColorStop(0.5, '#f2e4bf');
  base.addColorStop(0.86, '#ead8ae');
  base.addColorStop(1, '#b89a68');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // fibres
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = `rgba(${R() < 0.5 ? '120,90,50' : '255,250,235'},${0.05 + R() * 0.06})`;
    g.lineWidth = 0.6;
    const fx = R() * W;
    const fy = R() * H;
    const a = R() * Math.PI;
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(fx + Math.cos(a) * (4 + R() * 10), fy + Math.sin(a) * (4 + R() * 10));
    g.stroke();
  }
  // foxing spots and a faint tide mark
  for (let i = 0; i < 26; i++) {
    const fx = R() * W;
    const fy = R() * H;
    const r = 3 + R() * 16;
    const gr = g.createRadialGradient(fx, fy, 0, fx, fy, r);
    gr.addColorStop(0, `rgba(140,90,40,${0.05 + R() * 0.1})`);
    gr.addColorStop(1, 'rgba(140,90,40,0)');
    g.fillStyle = gr;
    g.fillRect(fx - r, fy - r, r * 2, r * 2);
  }
  // curvature: the page rises from the gutter, catches the light, then flattens
  const curve = g.createLinearGradient(gut, 0, gut - dir * W * 0.55, 0);
  curve.addColorStop(0, 'rgba(50,25,8,0.6)');
  curve.addColorStop(0.08, 'rgba(60,32,10,0.32)');
  curve.addColorStop(0.2, 'rgba(255,245,220,0.18)');
  curve.addColorStop(0.32, 'rgba(255,245,220,0.05)');
  curve.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = curve;
  g.fillRect(0, 0, W, H);
  // outer edge darkening and top/bottom falloff
  const edge = g.createLinearGradient(out, 0, out + dir * 90, 0);
  edge.addColorStop(0, 'rgba(110,70,30,0.32)');
  edge.addColorStop(1, 'rgba(110,70,30,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  const tb = g.createLinearGradient(0, 0, 0, H);
  tb.addColorStop(0, 'rgba(110,70,30,0.18)');
  tb.addColorStop(0.08, 'rgba(110,70,30,0)');
  tb.addColorStop(0.92, 'rgba(110,70,30,0)');
  tb.addColorStop(1, 'rgba(110,70,30,0.22)');
  g.fillStyle = tb;
  g.fillRect(0, 0, W, H);
  g.restore();
  // a hairline where the deckle meets the stack
  g.strokeStyle = 'rgba(90,60,25,0.35)';
  g.lineWidth = 1;
  g.stroke(page);
  const url = c.toDataURL('image/jpeg', 0.9);
  pageCache.set(side, url);
  return url;
}

// ------------------------------------------------------------------ hand-composed plates

/**
 * Plate VII, cut as a line engraving in the manner of a Doré or Dürer plate rather than ruled as
 * a technical drawing: every line is a burin stroke that swells in shadow and tapers to nothing
 * in the light (so tone is made by line weight, and the brightest planes are open paper); the
 * hatching follows each form — courses along the ashlar, arcs round the vault, orthogonals
 * running to the vanishing point across a foreshortened floor of flags, bracelet strokes round
 * the knight's limbs and curves laid along each plate of his harness; his ghost-light opens the
 * wall's tint round him with no ruled rings.
 */
function drawnVigilPlate(W = 720, H = 340) {
  const S = 2;
  const c = makeCanvas(W * S, H * S);
  const g = c.getContext('2d');
  g.scale(S, S);
  const R = rngOf(707);
  const INK = (a = 1) => `rgba(36,22,12,${a})`;
  const PAPER = '#f3e7c6';
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const dist = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);
  // Catmull-Rom resample of a guide polyline
  const smooth = (pts, step = 2.5) => {
    if (pts.length < 2) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(dist(p1[0], p1[1], p2[0], p2[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n; const t2 = t * t; const t3 = t2 * t;
        const f = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  // a burin stroke: a ribbon whose width follows the tone under it, swelling mid-stroke and
  // tapering at both ends; where the tone falls to light the line breaks off into the paper
  const burin = (pts, w, tone = () => 1, a = 0.94) => {
    const P = smooth(pts);
    const n = P.length;
    if (n < 2) return;
    const ws = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const taper = Math.min(1, t / 0.18, (1 - t) / 0.18);
      ws[i] = w * Math.pow(Math.max(0, taper), 0.7) * (0.8 + 0.3 * Math.sin(Math.PI * t)) * clamp(tone(P[i][0], P[i][1]), 0, 1.6);
    }
    g.fillStyle = INK(a);
    let i = 0;
    while (i < n) {
      while (i < n && ws[i] < 0.09) i++;
      const s0 = i;
      while (i < n && ws[i] >= 0.09) i++;
      if (i - s0 < 2) continue;
      const L = []; const Rr = [];
      for (let k = s0; k < i; k++) {
        const pa = P[Math.max(s0, k - 1)]; const pb = P[Math.min(i - 1, k + 1)];
        let nx = -(pb[1] - pa[1]); let ny = pb[0] - pa[0];
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const hw = ws[k] / 2;
        L.push([P[k][0] + nx * hw, P[k][1] + ny * hw]);
        Rr.push([P[k][0] - nx * hw, P[k][1] - ny * hw]);
      }
      g.beginPath();
      g.moveTo(L[0][0], L[0][1]);
      for (const q of L) g.lineTo(q[0], q[1]);
      for (let k = Rr.length - 1; k >= 0; k--) g.lineTo(Rr[k][0], Rr[k][1]);
      g.closePath();
      g.fill();
    }
  };
  const clipped = (path, fn) => { g.save(); g.clip(path); fn(); g.restore(); };
  const fillPaper = (path, col = PAPER) => { g.save(); g.fillStyle = col; g.fill(path); g.restore(); };
  const P2 = (pts, close = true) => { const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); if (close) p.closePath(); return p; };
  // straight hatching with a hand's wobble, at angle, every sp px, inside bbox
  const lines = (bbox, ang, sp, w, tone, a = 0.9) => {
    const [x0, y0, x1, y1] = bbox;
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const Lh = Math.hypot(x1 - x0, y1 - y0) / 2 + 6;
    const dx = Math.cos(ang); const dy = Math.sin(ang);
    for (let o = -Lh; o <= Lh; o += sp * (0.85 + R() * 0.3)) {
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const t = -Lh + (2 * Lh * k) / 10; const wob = (R() - 0.5) * 0.6;
        pts.push([cx - dy * o + dx * t - dy * wob, cy + dx * o + dy * t + dx * wob]);
      }
      burin(pts, w, tone, a);
    }
  };
  // hatching that follows a guide curve: offset copies spaced along its normal
  const along = (guide, count, sp, w, tone, a = 0.9, lift = 0) => {
    const G = smooth(guide, 6);
    for (let k = 0; k < count; k++) {
      const off = (k - (count - 1) / 2) * sp;
      const pts = G.map((q, i) => {
        const pa = G[Math.max(0, i - 1)]; const pb = G[Math.min(G.length - 1, i + 1)];
        let nx = -(pb[1] - pa[1]); let ny = pb[0] - pa[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        return [q[0] + nx * off, q[1] + ny * off + Math.abs(off) * lift];
      });
      burin(pts, w, tone, a);
    }
  };
  // bracelet strokes round a limb from a to b (arcs across it, bowed toward the viewer)
  const bracelets = (a, b, ra, rb, count, w, tone, bow = 0.35, alpha = 0.9) => {
    const ax = b[0] - a[0]; const ay = b[1] - a[1]; const Lr = Math.hypot(ax, ay) || 1;
    const ux = ax / Lr; const uy = ay / Lr; const nx = -uy; const ny = ux;
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count; const r = ra + (rb - ra) * t;
      const cx = a[0] + ax * t; const cy = a[1] + ay * t;
      const pts = [];
      for (let j = 0; j <= 8; j++) { const s2 = -1 + j / 4; pts.push([cx + nx * r * s2 + ux * r * bow * (1 - s2 * s2), cy + ny * r * s2 + uy * r * bow * (1 - s2 * s2)]); }
      burin(pts, w, tone, alpha);
    }
  };

  // paper
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  const floorY = 266;
  const wx = 452; const wtop = 44; const wbot = 172; const ww = 40;
  const kx = 258; const ky = 196; // the ghost's light centre
  const glowAt = (x, y) => sstep(0.1, 1, dist(x, y, kx, ky - 20) / 175); // 0 at the ghost .. 1 away
  const winAt = (x, y) => sstep(0.15, 1, dist(x, y, wx, 110) / 190);

  // ---- the wall: ashlar courses ruled along each block (the burin follows the stone), each
  // block its own tone, the joints cut short and firm; the tint opens round the ghost and the window
  const wallP = P2([[15, 15], [W - 15, 15], [W - 15, floorY], [15, floorY]]);
  // keyed in three values like a real plate: open paper round the ghost and the window, a light
  // tint across the wall, heavy line under the vault and into the far corners
  const wallTone = (x, y) => {
    const vault = sstep(110, 15, y) * 0.9;
    const corner = sstep(230, 15, Math.min(x - 15, W - 15 - x)) * 1.0;
    const g0 = glowAt(x, y); const w0 = winAt(x, y);
    return clamp((0.2 + vault + corner) * (g0 * g0 * g0) * (0.05 + 0.95 * w0 * w0), 0, 1.5);
  };
  clipped(wallP, () => {
    for (let y = 15, row = 0; y < floorY; row++) {
      const ch = 19 + R() * 5;
      let x = 15 - (row % 2) * 22 - R() * 12;
      while (x < W - 15) {
        const bw = 34 + R() * 26;
        const k = 0.75 + R() * 0.5; // the block's own value
        for (let j = 1; j <= 3; j++) {
          const yy = y + (ch * j) / 4 + (R() - 0.5) * 0.8;
          burin([[x + 2, yy], [x + bw * 0.5, yy + (R() - 0.5) * 0.8], [x + bw - 2, yy]], 0.95, (px, py) => wallTone(px, py) * k * (j === 3 ? 1.25 : 0.9), 0.85);
        }
        // the joint and the bed under the block: short firm cuts, dark under the arris
        burin([[x + bw, y + 1], [x + bw, y + ch - 1]], 1.2, (px, py) => 0.12 + wallTone(px, py) * 0.9, 0.9);
        x += bw;
      }
      burin([[15, y + ch], [W * 0.5, y + ch + (R() - 0.5)], [W - 15, y + ch]], 1.1, (px, py) => 0.1 + wallTone(px, py) * 0.85, 0.9);
      y += ch;
    }
  });
  // the vault overhead: arcs swinging from pier to pier, laid closer and heavier into the crown's shadow
  const vaultP = P2([[15, 15], [W - 15, 15], [W - 15, 70], [W * 0.5, 40], [15, 70]]);
  clipped(vaultP, () => {
    for (let k = 0; k < 16; k++) {
      const y0 = 14 + k * 4.2;
      burin([[10, y0 + 46], [W * 0.25, y0 + 12], [W * 0.5, y0], [W * 0.75, y0 + 12], [W - 10, y0 + 46]], 1.6, (x) => 1.05 - k * 0.04 + sstep(W * 0.5, 15, Math.min(x, W - x)) * 0.4, 0.92);
    }
  });

  // ---- the lancet: open paper with its leading; the splayed reveal hatched along its own arch
  const lancet = new Path2D();
  lancet.moveTo(wx - ww, wbot); lancet.lineTo(wx - ww, wtop + 48);
  lancet.quadraticCurveTo(wx - ww, wtop, wx, wtop - 6); lancet.quadraticCurveTo(wx + ww, wtop, wx + ww, wtop + 48);
  lancet.lineTo(wx + ww, wbot); lancet.closePath();
  const reveal = new Path2D();
  reveal.moveTo(wx - ww - 15, wbot + 8); reveal.lineTo(wx - ww - 15, wtop + 46);
  reveal.quadraticCurveTo(wx - ww - 15, wtop - 15, wx, wtop - 24); reveal.quadraticCurveTo(wx + ww + 15, wtop - 15, wx + ww + 15, wtop + 46);
  reveal.lineTo(wx + ww + 15, wbot + 8); reveal.closePath();
  fillPaper(reveal);
  clipped(reveal, () => {
    const archG = (o) => [[wx - ww - o, wbot + 10], [wx - ww - o, wtop + 46], [wx - ww * 0.7 - o, wtop + 8 - o * 0.3], [wx, wtop - 6 - o], [wx + ww * 0.7 + o, wtop + 8 - o * 0.3], [wx + ww + o, wtop + 46], [wx + ww + o, wbot + 10]];
    for (let o = 1; o < 16; o += 2.6) burin(archG(o), 1.3, (x) => (x < wx ? 1.1 : 0.55), 0.9);
  });
  fillPaper(lancet, '#f8efd6');
  burin([[wx - ww - 15, wbot + 8], [wx - ww - 15, wtop + 46]], 1.6, () => 1);
  g.strokeStyle = INK(0.92); g.lineWidth = 1.5; g.stroke(lancet);
  burin([[wx, wtop + 30], [wx, wbot]], 1.6, () => 1);
  burin([[wx - ww, 118], [wx + ww, 118]], 1.2, () => 1);
  clipped(lancet, () => {
    for (let k = -12; k < 12; k++) {
      burin([[wx + k * 9, wtop], [wx + k * 9 + 80, wbot]], 0.6, () => 0.8, 0.5);
      burin([[wx + k * 9, wtop], [wx + k * 9 - 80, wbot]], 0.6, () => 0.8, 0.5);
    }
  });
  g.strokeStyle = INK(0.9); g.lineWidth = 1.1;
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.beginPath(); g.arc(wx + Math.cos(a) * 7, wtop + 22 + Math.sin(a) * 7, 7, 0, Math.PI * 2); g.stroke(); }

  // ---- the floor: flags foreshortened to a vanishing point under the window, the orthogonals
  // cut toward it, the transversals closing up with distance; the window's light lies in a wedge
  const vp = [wx - 30, 112];
  const floorP = P2([[15, floorY], [W - 15, floorY], [W - 15, H - 15], [15, H - 15]]);
  const yAt = (z) => vp[1] + (floorY - vp[1]) / z; // z = 1 at the back wall
  const beamAt = (x, y) => { const dx = (x - (wx - 70)) / 170; const dy = (y - (floorY + 30)) / 34; return clamp(1 - Math.sqrt(dx * dx + dy * dy)); };
  const floorTone = (x, y) => clamp((0.55 + sstep(floorY, H - 15, y) * 0.5 + sstep(220, 15, Math.min(x - 15, W - 15 - x)) * 0.45) * (1 - beamAt(x, y) * 0.85) * (0.3 + 0.7 * glowAt(x, y + 40)), 0, 1.4);
  clipped(floorP, () => {
    // fine orthogonal hatching inside each flag (the tint), then the joints
    for (let k = -60; k <= 60; k++) {
      const fx = vp[0] + k * 9;
      const top = [vp[0] + (fx - vp[0]) * ((floorY - vp[1]) / (H + 40 - vp[1])), floorY];
      burin([top, [fx, H + 40]], 0.7, floorTone, 0.75);
    }
    for (let k = -9; k <= 11; k++) {
      const fx = vp[0] + k * 74;
      burin([[vp[0] + (fx - vp[0]) * ((floorY - vp[1]) / (H + 40 - vp[1])), floorY], [fx, H + 40]], 1.3, (x, y) => 0.6 + floorTone(x, y) * 0.5, 0.9);
    }
    for (let z = 0.94; z > 0.15; z *= 0.84) {
      const y = yAt(1 / z) ;
      if (y > H - 14) break;
      burin([[15, y], [W * 0.5, y + (R() - 0.5)], [W - 15, y]], 0.8 + (y - floorY) * 0.02, (x, yy) => 0.55 + floorTone(x, yy) * 0.5, 0.88);
    }
  });

  // ---- the altar: a slab on a block, the lit front cut in long verticals that thin toward the
  // light, the shadowed end crosshatched along its planes; a cloth with folds; candles
  const ax0 = 372; const ax1 = 540; const aTop = 196;
  const slab = P2([[ax0 - 8, aTop], [ax1 + 10, aTop], [ax1 + 4, aTop - 9], [ax0 - 2, aTop - 9]]);
  const front = P2([[ax0, aTop], [ax1, aTop], [ax1, floorY + 4], [ax0, floorY + 4]]);
  const side = P2([[ax0, aTop], [ax0 - 16, aTop - 6], [ax0 - 16, floorY - 2], [ax0, floorY + 4]]);
  for (const p of [slab, front, side]) fillPaper(p);
  clipped(front, () => { for (let x = ax0 + 2; x < ax1; x += 3.1) burin([[x, aTop + 2], [x + (R() - 0.5), floorY + 4]], 1.05, (px, py) => 0.35 + (1 - (px - ax0) / (ax1 - ax0)) * 0.5 + sstep(aTop, floorY, py) * 0.4, 0.88); });
  clipped(side, () => {
    for (let y = aTop - 10; y < floorY + 6; y += 2.8) burin([[ax0 - 17, y - 3], [ax0 + 1, y + 2]], 1.2, () => 1.1);
    for (let x = ax0 - 16; x < ax0; x += 3) burin([[x, aTop - 8], [x, floorY + 4]], 0.9, () => 1);
  });
  clipped(slab, () => { for (let y = aTop - 8; y < aTop; y += 2.4) burin([[ax0 - 8, y], [ax1 + 10, y]], 0.8, (x) => 0.3 + (1 - (x - ax0) / (ax1 - ax0)) * 0.5, 0.8); });
  const cloth = P2([[ax0 + 44, aTop], [ax1 - 44, aTop], [ax1 - 42, aTop + 46], [ax0 + 46, aTop + 46]]);
  fillPaper(cloth);
  clipped(cloth, () => {
    for (let k = 0; k < 9; k++) {
      const x = ax0 + 50 + k * 8.5;
      burin([[x, aTop], [x + Math.sin(k) * 2, aTop + 24], [x + Math.cos(k) * 2.5, aTop + 48]], k % 3 === 0 ? 1.4 : 0.8, () => 0.9);
    }
  });
  g.strokeStyle = INK(0.92); g.lineWidth = 1.2; g.stroke(cloth);
  const sx = (ax0 + ax1) / 2; const sy = aTop + 20;
  burin([[sx, sy - 12], [sx, sy + 12]], 1.4, () => 1); burin([[sx - 14, sy - 8], [sx + 14, sy - 8]], 1.4, () => 1);
  for (const d of [-1, 1]) { burin([[sx + d * 14, sy - 8], [sx + d * 10, sy + 2]], 0.8, () => 1); burin([[sx + d * 14, sy - 8], [sx + d * 18, sy + 2]], 0.8, () => 1); burin([[sx + d * 7, sy + 2], [sx + d * 14, sy + 5], [sx + d * 21, sy + 2]], 1.1, () => 1); }
  for (const p of [front, side, slab]) { g.strokeStyle = INK(0.95); g.lineWidth = 1.4; g.stroke(p); }
  burin([[ax1 - 18, aTop - 9], [ax1 - 6, aTop - 2], [ax1 + 10, aTop]], 1.4, () => 1);
  burin([[ax1 - 30, aTop + 2], [ax1 - 34, aTop + 30], [ax1 - 28, aTop + 52]], 1.1, () => 1);
  for (const cxp of [ax0 + 16, ax0 + 30, ax1 - 30, ax1 - 14]) {
    const hgt = 22 + ((cxp * 7) % 9);
    const top = aTop - 9 - hgt;
    const stick = P2([[cxp - 3.2, aTop - 9], [cxp + 3.2, aTop - 9], [cxp + 2.4, top], [cxp - 2.4, top]]);
    g.save(); g.fillStyle = '#fbf4dc'; g.beginPath(); g.arc(cxp, top - 6, 13, 0, Math.PI * 2); g.fill(); g.restore();
    fillPaper(stick, '#f8efd6');
    clipped(stick, () => { for (let x = cxp + 0.5; x < cxp + 3.5; x += 1.4) burin([[x, top], [x, aTop - 9]], 0.6, () => 0.9); });
    g.strokeStyle = INK(0.9); g.lineWidth = 0.9; g.stroke(stick);
    burin([[cxp - 2.4, top + 3], [cxp - 3.2, top + 10]], 1.0, () => 1);
    burin([[cxp, top - 14], [cxp + 3.5, top - 6], [cxp, top - 1]], 1.0, () => 1, 0.9);
    burin([[cxp, top - 14], [cxp - 3.5, top - 6], [cxp, top - 1]], 1.0, () => 1, 0.9);
    burin([[cxp, top], [cxp, top - 4]], 1.2, () => 1);
  }

  // ---- foreground pews, almost black: planks cut toward the vanishing point, crossed, grained
  const pewEnd = (sgn) => {
    const X = (x) => (sgn > 0 ? x : W - x);
    const p = new Path2D();
    p.moveTo(X(15), H - 15); p.lineTo(X(15), 236);
    p.bezierCurveTo(X(40), 214, X(70), 212, X(96), 222); // the scrolled top of the end board
    p.quadraticCurveTo(X(112), 226, X(120), 218);
    p.quadraticCurveTo(X(132), 214, X(128), 232);
    p.lineTo(X(132), H - 15); p.closePath();
    return p;
  };
  const pewL = pewEnd(1);
  const pewR = pewEnd(-1);
  for (const [p, sgn] of [[pewL, 1], [pewR, -1]]) {
    fillPaper(p);
    clipped(p, () => {
      for (let y = 220; y < H; y += 2.6) burin([[sgn > 0 ? 10 : W - 10, y], [sgn > 0 ? 140 : W - 140, y - 7 + (R() - 0.5) * 1.5]], 1.25, () => 1.15);
      for (let x = 0; x < 150; x += 3.2) { const X = sgn > 0 ? 15 + x : W - 15 - x; burin([[X, 215], [X + sgn * 2, H]], 0.9, () => 0.9); }
      for (let k = 0; k < 5; k++) { const y = 246 + k * 16; burin([[sgn > 0 ? 18 : W - 18, y], [sgn > 0 ? 70 : W - 70, y - 5 + Math.sin(k) * 3], [sgn > 0 ? 124 : W - 124, y - 8]], 0.7, () => 0.6, 0.6); }
    });
    g.strokeStyle = INK(0.96); g.lineWidth = 1.6; g.stroke(p);
    burin([[sgn > 0 ? 22 : W - 22, 246], [sgn > 0 ? 70 : W - 70, 232], [sgn > 0 ? 118 : W - 118, 236]], 2.0, () => 1); // the carved panel's moulding
    burin([[sgn > 0 ? 24 : W - 24, 250], [sgn > 0 ? 26 : W - 26, H - 22]], 1.4, () => 1);
    burin([[sgn > 0 ? 116 : W - 116, 240], [sgn > 0 ? 120 : W - 120, H - 22]], 1.4, () => 1);
  }

  // ---- the knight, kneeling in profile toward the altar: a hounskull with its beak and eye
  // slit, a cuirass and back-plate, overlapping lames at the shoulder and hip, cuisse, poleyn,
  // greave and sabaton on the kneeling leg; the cloak falls behind. Ghost-light: he is mostly
  // open paper, cut only on his shadowed side and along his plates' edges
  const B = (pts) => {
    const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]);
    let i = 1;
    for (; i + 2 < pts.length; i += 3) p.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1]);
    for (; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath(); return p;
  };
  const shadeL = (x, y) => clamp(0.15 + sstep(290, 228, x) * 1.15 + sstep(150, 250, y) * 0.25, 0, 1.4); // light from the window, right
  const cloak = B([[246, 128], [226, 150], [214, 200], [196, 236], [186, 252], [172, 262], [158, floorY + 2], [190, floorY + 4], [232, floorY + 4], [252, floorY + 2], [246, 220], [244, 180], [246, 128]]);
  const back = B([[234, 140], [226, 160], [226, 190], [234, 214], [250, 222], [272, 220], [280, 206], [286, 180], [284, 152], [270, 132], [250, 132], [234, 140]]);
  const helm = B([[244, 124], [236, 104], [246, 82], [270, 84], [282, 88], [290, 100], [292, 108], [304, 112], [314, 118], [318, 121], [304, 124], [290, 126], [280, 132], [266, 136], [252, 134], [244, 124]]);
  const pauld = B([[248, 140], [252, 128], [282, 126], [290, 146], [292, 156], [280, 166], [264, 164], [252, 160], [246, 152], [248, 140]]);
  const arm = B([[270, 160], [282, 170], [290, 182], [300, 178], [310, 176], [318, 184], [316, 192], [300, 196], [286, 198], [272, 192], [264, 176], [270, 160]]);
  const thigh = B([[250, 210], [270, 206], [296, 206], [306, 214], [310, 224], [290, 228], [270, 228], [254, 226], [248, 218], [250, 210]]);
  const shin = B([[294, 214], [306, 214], [310, 230], [310, 246], [312, floorY - 8], [320, floorY - 4], [322, floorY], [304, floorY + 2], [292, floorY], [296, floorY - 8], [294, 240], [294, 214]]);
  const backLeg = B([[232, 208], [246, 214], [242, 236], [228, 254], [216, floorY - 2], [200, floorY], [178, floorY + 1], [178, floorY - 8], [198, floorY - 10], [214, 248], [222, 230], [232, 208]]);
  const parts = [cloak, backLeg, back, thigh, shin, arm, pauld, helm];
  for (const p of parts) fillPaper(p, '#f8efd6');
  // the cloak: long tapered folds, heavier in the hollows away from the light
  clipped(cloak, () => {
    for (let k = 0; k < 9; k++) {
      const x0 = 242 - k * 3.2; const bend = k * 4.2;
      burin([[x0, 134 + k * 2], [x0 - 10 - bend * 0.4, 190], [x0 - 22 - bend, 236], [x0 - 34 - bend * 1.2, floorY + 4]], k % 3 === 1 ? 1.6 : 0.9, (x, y) => shadeL(x, y) * (0.6 + sstep(150, 250, y) * 0.5), 0.9);
    }
  });
  // the back-plate: curves laid along its swell, closing into the shadow at the spine
  clipped(back, () => { along([[236, 142], [228, 176], [236, 212]], 9, 3.2, 1.0, (x, y) => shadeL(x, y) * 1.1, 0.9); });
  // the helm: strokes following the skull's curve back from the brow, the beak cut along its keel
  clipped(helm, () => {
    for (let k = 0; k < 8; k++) burin([[242 + k * 1.5, 126 - k * 2], [240 + k * 2, 100 - k], [258 + k * 2, 86 + k * 2.2], [282 - k, 92 + k * 2.8]], 1.0, (x, y) => shadeL(x, y) * 1.15, 0.9);
    for (let k = 0; k < 5; k++) burin([[290, 113 + k * 2.4], [304, 117 + k * 1.6], [316, 121]], 0.8, () => 0.7, 0.85);
  });
  // the shoulder: three lames, each a curved plate with its own lit edge and a shade under it
  clipped(pauld, () => {
    for (let k = 0; k < 4; k++) {
      const y0 = 136 + k * 7.5;
      burin([[248, y0 + 6], [262, y0 - 2], [282, y0 - 1], [292, y0 + 6]], 1.6, (x) => 0.6 + sstep(290, 250, x) * 0.6, 0.95);
      along([[250, y0 + 9], [264, y0 + 2], [282, y0 + 3], [290, y0 + 9]], 2, 1.6, 0.8, (x) => shadeL(x, 150), 0.8);
    }
  });
  // the arm and the gauntlets on the pommel; the limbs carry bracelet strokes round their forms
  clipped(arm, () => { bracelets([270, 166], [292, 192], 9, 9, 7, 0.9, (x) => shadeL(x, 180) * 1.05, 0.5); bracelets([290, 190], [314, 184], 7, 6, 6, 0.8, (x) => shadeL(x, 180), -0.4); });
  clipped(thigh, () => { bracelets([252, 216], [306, 218], 10, 9, 12, 1.0, (x, y) => shadeL(x, y) * 1.1, 0.4); });
  clipped(shin, () => { bracelets([302, 216], [308, floorY - 6], 8, 6, 12, 0.9, (x, y) => shadeL(x - 20, y) * 1.1, 0.35); });
  clipped(backLeg, () => { lines([170, 200, 250, floorY + 2], 1.15, 3, 1.0, (x, y) => 0.9 + sstep(200, 260, y) * 0.3); });
  // plate edges: firm contour, heavier on the shadow side, with lame lines across the limbs
  for (const p of parts) { g.strokeStyle = INK(0.95); g.lineWidth = 1.4; g.stroke(p); }
  burin([[262, 108], [282, 110], [298, 116]], 2.2, () => 1); // the eye slit
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { g.fillStyle = INK(0.9); g.beginPath(); g.arc(292 + i * 4.5, 120 + j * 3.5 - i * 0.6, 0.9, 0, Math.PI * 2); g.fill(); }
  burin([[246, 90], [262, 80], [278, 84]], 1.6, () => 1); // the comb
  burin([[248, 132], [264, 136], [280, 133]], 1.8, () => 1); // the gorget's edge
  for (const t of [0.33, 0.66]) burin([[250 + t * 4, 210 + t * 4], [302 + t * 4, 210 + t * 6]], 1.0, () => 1);
  burin([[292, 230], [304, 226], [312, 232]], 1.6, () => 1); // the poleyn
  g.save(); g.fillStyle = '#f8efd6'; g.beginPath(); g.ellipse(304, 228, 7, 6, 0.2, 0, Math.PI * 2); g.fill(); g.restore();
  g.strokeStyle = INK(0.95); g.lineWidth = 1.3; g.beginPath(); g.ellipse(304, 228, 7, 6, 0.2, 0, Math.PI * 2); g.stroke();
  for (const t of [0.35, 0.6, 0.85]) burin([[296 + t * 4, floorY - 2 - t * 6], [316 + t * 2, floorY - t * 4]], 1.1, () => 1); // sabaton lames
  // the reversed sword before him, its pommel under the hands
  const sword = P2([[319, 186], [323, 186], [323.5, floorY - 2], [321, floorY + 4], [318.5, floorY - 2]]);
  const guard = P2([[304, 184], [338, 182], [338, 187], [304, 189]]);
  fillPaper(sword, '#f8efd6'); fillPaper(guard, '#f8efd6');
  burin([[321, 188], [321, floorY]], 0.7, () => 0.8);
  g.strokeStyle = INK(0.95); g.lineWidth = 1.2; g.stroke(sword); g.stroke(guard);
  g.save(); g.fillStyle = '#f8efd6'; g.beginPath(); g.arc(321, 166, 4.5, 0, Math.PI * 2); g.fill(); g.restore();
  g.lineWidth = 1.2; g.beginPath(); g.arc(321, 166, 4.5, 0, Math.PI * 2); g.stroke();
  g.save(); g.fillStyle = '#f8efd6'; g.beginPath(); g.ellipse(318, 177, 7.5, 6, 0.3, 0, Math.PI * 2); g.fill(); g.restore();
  g.beginPath(); g.ellipse(318, 177, 7.5, 6, 0.3, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 3; k++) burin([[312 + k * 3.5, 173], [313 + k * 3.5, 181]], 0.8, () => 1);
  // the wound at the throat: a short firm cut, and his light raying from it in fine tapered strokes
  burin([[264, 137], [278, 135]], 2, () => 1);
  for (let k = 0; k < 7; k++) { const a = -2.9 + k * 0.42; burin([[271 + Math.cos(a) * 6, 136 + Math.sin(a) * 6], [271 + Math.cos(a) * 15, 136 + Math.sin(a) * 15]], 0.6, () => 0.9, 0.7); }
  // mist curling from the hem along the flags
  for (let k = 0; k < 6; k++) {
    const y = floorY - 6 + k * 4;
    burin([[140 - k * 12, y], [180, y - 6], [215, y + 4], [256 + k * 9, y - 2]], 1.0, (x) => 0.4 + 0.5 * Math.sin((x - 130) / 140 * Math.PI), 0.7);
  }
  // his shadow on the flags, cut in the floor's own orthogonals
  const cast = P2([[172, floorY + 3], [320, floorY + 3], [304, floorY + 13], [162, floorY + 11]]);
  clipped(cast, () => { for (let x = 150; x < 330; x += 2.2) burin([[x, floorY + 2], [x - 6, floorY + 14]], 1.0, () => 1); });

  // ---- the plate mark
  g.strokeStyle = INK(0.92); g.lineWidth = 2.2; g.strokeRect(6, 6, W - 12, H - 12);
  g.lineWidth = 1; g.strokeRect(14.5, 14.5, W - 29, H - 29);
  return c;
}
