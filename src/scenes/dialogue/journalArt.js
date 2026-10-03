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
 * Plate VII, drawn rather than traced: the ghost of Ferran Martinez kneeling in vigil before the
 * broken altar of Sokol's chapel. Built as an engraver works: each mass is a path, hatched in its
 * own direction (wall courses ruled level, the cloak cut along its folds, the helm in arcs round its
 * dome), in three keyed values (open paper, one ruled tint, crosshatch), then contoured. The ghost
 * is left as clean paper in a halo of open lines, cut out of a crosshatched night.
 */
function drawnVigilPlate(W = 720, H = 340) {
  const S = 2;
  const c = makeCanvas(W * S, H * S);
  const g = c.getContext('2d');
  g.scale(S, S);
  const R = rngOf(707);
  const INK = (a) => `rgba(38,24,14,${a})`;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const poly = (pts) => { const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; };
  // parallel burin lines across a clip path; wobble keeps them hand-cut, swell with weight
  const hatch = (path, ang, sp, w, a = 0.85, bbox = [0, 0, W, H]) => {
    g.save();
    g.clip(path);
    g.strokeStyle = INK(a);
    const [x0, y0, x1, y1] = bbox;
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const L = Math.hypot(x1 - x0, y1 - y0) / 2 + 4;
    const dx = Math.cos(ang); const dy = Math.sin(ang);
    for (let o = -L; o <= L; o += sp) {
      g.lineWidth = w * (0.8 + R() * 0.4);
      g.beginPath();
      const px = cx - dy * o; const py = cy + dx * o;
      const n = 8;
      for (let k = 0; k <= n; k++) {
        const t = -L + (2 * L * k) / n;
        const wob = (R() - 0.5) * 0.5;
        const x = px + dx * t - dy * wob; const y = py + dy * t + dx * wob;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  };
  // arcs round a centre (domes, the halo)
  const arcs = (path, cx, cy, r0, r1, sp, w, a0 = 0, a1 = Math.PI * 2, al = 0.85) => {
    g.save();
    g.clip(path);
    g.strokeStyle = INK(al);
    for (let r = r0; r <= r1; r += sp) { g.lineWidth = w; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke(); }
    g.restore();
  };
  // curved strokes from a list of guide curves: each guide is [[x,y]...]; strokes are spaced along a normal
  const folds = (path, guides, count, spread, w, al = 0.85) => {
    g.save();
    g.clip(path);
    g.strokeStyle = INK(al);
    for (const gd of guides) {
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * spread;
        g.lineWidth = w * (0.7 + 0.6 * (1 - Math.abs(off) / (spread * count)));
        g.beginPath();
        gd.forEach(([x, y], i) => { const xx = x + off; if (i) g.lineTo(xx, y + Math.abs(off) * 0.15); else g.moveTo(xx, y); });
        g.stroke();
      }
    }
    g.restore();
  };
  const line = (pts, w, a = 0.92) => { g.strokeStyle = INK(a); g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  const contour = (path, w, a = 0.95) => { g.strokeStyle = INK(a); g.lineWidth = w; g.stroke(path); };

  // paper
  g.fillStyle = '#f3e7c6';
  g.fillRect(0, 0, W, H);
  const all = poly([[15, 15], [W - 15, 15], [W - 15, H - 15], [15, H - 15]]);
  const floorY = 268;

  // ---- the wall: ashlar courses ruled level (one tint), the joints cut short
  const wall = poly([[15, 15], [W - 15, 15], [W - 15, floorY], [15, floorY]]);
  hatch(wall, 0, 3.1, 0.55, 0.7);
  g.strokeStyle = INK(0.75);
  for (let y = 15, row = 0; y < floorY; y += 21, row++) {
    line([[15, y], [W - 15, y]], 1.0, 0.7);
    for (let x = 15 + (row % 2) * 26 + R() * 6; x < W - 15; x += 46 + R() * 10) line([[x, y], [x, Math.min(floorY, y + 21)]], 0.9, 0.7);
  }
  // ---- the vault in shadow: crosshatch along the top and in the far corners
  const gloomL = poly([[15, 15], [175, 15], [120, floorY], [15, floorY]]);
  const gloomR = poly([[W - 15, 15], [W - 170, 15], [W - 110, floorY], [W - 15, floorY]]);
  const gloomT = poly([[15, 15], [W - 15, 15], [W - 15, 52], [15, 60]]);
  for (const p of [gloomL, gloomR, gloomT]) { hatch(p, 0.8, 3.2, 0.65, 0.82); hatch(p, -0.75, 3.8, 0.6, 0.78); }
  const deepL = poly([[15, 15], [90, 15], [55, floorY], [15, floorY]]);
  const deepR = poly([[W - 15, 15], [W - 85, 15], [W - 50, floorY], [W - 15, floorY]]);
  for (const p of [deepL, deepR]) hatch(p, Math.PI / 2, 3, 0.6, 0.8);

  // ---- the lancet window behind the altar: open paper, its leading drawn fine; light falls from it
  const wx = 452; const wtop = 44; const wbot = 172; const ww = 40;
  const lancet = new Path2D();
  lancet.moveTo(wx - ww, wbot); lancet.lineTo(wx - ww, wtop + 48);
  lancet.quadraticCurveTo(wx - ww, wtop, wx, wtop - 6); lancet.quadraticCurveTo(wx + ww, wtop, wx + ww, wtop + 48);
  lancet.lineTo(wx + ww, wbot); lancet.closePath();
  // the splay of the window: a deep reveal, cross-hatched
  const reveal = new Path2D();
  reveal.moveTo(wx - ww - 14, wbot + 8); reveal.lineTo(wx - ww - 14, wtop + 46);
  reveal.quadraticCurveTo(wx - ww - 14, wtop - 14, wx, wtop - 22); reveal.quadraticCurveTo(wx + ww + 14, wtop - 14, wx + ww + 14, wtop + 46);
  reveal.lineTo(wx + ww + 14, wbot + 8); reveal.closePath();
  g.save(); g.fillStyle = '#f3e7c6'; g.fill(reveal); g.restore();
  hatch(reveal, Math.PI / 2, 3, 0.6, 0.8); hatch(reveal, 0.4, 4, 0.5, 0.7);
  g.save(); g.fillStyle = '#f6ecd0'; g.fill(lancet); g.restore();
  contour(reveal, 1.4);
  contour(lancet, 1.6);
  // tracery: mullion, transom, a quatrefoil in the head, quarries
  line([[wx, wtop + 30], [wx, wbot]], 1.4);
  line([[wx - ww, 118], [wx + ww, 118]], 1.0);
  g.save(); g.clip(lancet);
  g.strokeStyle = INK(0.35); g.lineWidth = 0.6;
  for (let k = -12; k < 12; k++) { g.beginPath(); g.moveTo(wx + k * 9, wtop); g.lineTo(wx + k * 9 + 80, wbot); g.stroke(); g.beginPath(); g.moveTo(wx + k * 9, wtop); g.lineTo(wx + k * 9 - 80, wbot); g.stroke(); }
  g.restore();
  g.strokeStyle = INK(0.9); g.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.beginPath(); g.arc(wx + Math.cos(a) * 7, wtop + 22 + Math.sin(a) * 7, 7, 0, Math.PI * 2); g.stroke(); }
  // the beam of light falling to the floor: the wall's tint is scraped away in a wedge
  const beam = new Path2D(); beam.ellipse(wx - 90, floorY + 26, 150, 22, 0, 0, Math.PI * 2);

  // ---- the floor: flagstones in perspective, a light tint
  const floor = poly([[15, floorY], [W - 15, floorY], [W - 15, H - 15], [15, H - 15]]);
  hatch(floor, 0.06, 4.2, 0.5, 0.55);
  const vp = [wx - 20, 120];
  for (let k = -9; k <= 11; k++) { const fx = vp[0] + k * 70; line([[vp[0] + (fx - vp[0]) * ((floorY - vp[1]) / (H - vp[1])), floorY], [fx, H - 15]], 0.8, 0.55); }
  for (const fy of [282, 300, 322]) line([[15, fy], [W - 15, fy]], 0.8, 0.55);
  g.save(); g.globalAlpha = 0.7; g.fillStyle = '#f6ecd0'; g.fill(beam); g.restore();

  // ---- the altar: a slab on a block, the front in a vertical tint, the shadowed end crosshatched
  const ax0 = 372; const ax1 = 540; const aTop = 196;
  const slab = poly([[ax0 - 8, aTop], [ax1 + 10, aTop], [ax1 + 4, aTop - 9], [ax0 - 2, aTop - 9]]);
  const front = poly([[ax0, aTop], [ax1, aTop], [ax1, floorY + 4], [ax0, floorY + 4]]);
  const side = poly([[ax0, aTop], [ax0 - 16, aTop - 6], [ax0 - 16, floorY - 2], [ax0, floorY + 4]]);
  hatch(front, Math.PI / 2, 3.2, 0.7, 0.8);
  hatch(side, Math.PI / 2, 2.6, 0.8, 0.85); hatch(side, 0.6, 3, 0.7, 0.85);
  hatch(slab, 0.1, 3.5, 0.5, 0.5);
  // the altar cloth, its edge scalloped; the broken corner of the slab
  const cloth = poly([[ax0 + 44, aTop], [ax1 - 44, aTop], [ax1 - 44, aTop + 44], [ax0 + 44, aTop + 44]]);
  g.save(); g.fillStyle = '#f3e7c6'; g.fill(cloth); g.restore();
  hatch(cloth, Math.PI / 2, 5, 0.5, 0.55);
  contour(cloth, 1.2);
  // Tyr's scales on the cloth
  const sx = (ax0 + ax1) / 2; const sy = aTop + 20;
  line([[sx, sy - 12], [sx, sy + 12]], 1.2); line([[sx - 14, sy - 8], [sx + 14, sy - 8]], 1.2);
  for (const d of [-1, 1]) { line([[sx + d * 14, sy - 8], [sx + d * 10, sy + 2]], 0.7); line([[sx + d * 14, sy - 8], [sx + d * 18, sy + 2]], 0.7); line([[sx + d * 8, sy + 2], [sx + d * 20, sy + 2]], 1.0); }
  contour(front, 1.5); contour(side, 1.5); contour(slab, 1.4);
  line([[ax1 - 18, aTop - 9], [ax1 - 6, aTop - 2], [ax1 + 10, aTop]], 1.2); // a crack where the slab broke
  line([[ax1 - 30, aTop + 2], [ax1 - 34, aTop + 30], [ax1 - 28, aTop + 52]], 0.9);
  // candles with flames: tapered sticks, drips, haloes of open paper
  for (const cxp of [ax0 + 16, ax0 + 30, ax1 - 30, ax1 - 14]) {
    const hgt = 22 + ((cxp * 7) % 9);
    const top = aTop - 9 - hgt;
    const stick = poly([[cxp - 3.2, aTop - 9], [cxp + 3.2, aTop - 9], [cxp + 2.4, top], [cxp - 2.4, top]]);
    g.save(); g.fillStyle = '#f6ecd0'; g.fill(stick); g.restore();
    hatch(stick, Math.PI / 2, 1.8, 0.5, 0.6, [cxp - 1, top, cxp + 4, aTop]);
    contour(stick, 0.9);
    line([[cxp - 2.4, top + 3], [cxp - 3, top + 9]], 0.8);
    const fl = new Path2D(); fl.moveTo(cxp, top - 13); fl.quadraticCurveTo(cxp + 4.5, top - 4, cxp, top - 1); fl.quadraticCurveTo(cxp - 4.5, top - 4, cxp, top - 13);
    g.save(); g.fillStyle = '#fbf4dc'; g.beginPath(); g.arc(cxp, top - 6, 11, 0, Math.PI * 2); g.fill(); g.restore();
    contour(fl, 0.9);
    line([[cxp, top], [cxp, top - 4]], 1.0);
  }

  // ---- pews in the foreground: near-black, crosshatched to the plate's darkest
  const pewL = poly([[15, 236], [118, 230], [124, H - 15], [15, H - 15]]);
  const pewR = poly([[W - 15, 226], [W - 120, 232], [W - 128, H - 15], [W - 15, H - 15]]);
  for (const p of [pewL, pewR]) { hatch(p, 0.7, 2.6, 0.8, 0.9); hatch(p, -0.8, 2.8, 0.75, 0.9); hatch(p, Math.PI / 2, 3.4, 0.6, 0.85); contour(p, 1.6); }
  line([[15, 250], [120, 244]], 1.6); line([[W - 15, 240], [W - 122, 246]], 1.6);
  for (const x of [40, 80]) line([[x, 236 - (x - 15) * 0.06], [x + 2, H - 15]], 1.2);

  // ---- the knight: the halo first — the wall's tint lifted round him (open, sparse lines)
  const kx = 256;
  const halo = new Path2D(); halo.ellipse(kx + 8, 200, 92, 110, 0, 0, Math.PI * 2);
  g.save(); g.clip(halo);
  const hg = g.createRadialGradient(kx + 8, 200, 20, kx + 8, 200, 110);
  hg.addColorStop(0, 'rgba(246,236,208,1)'); hg.addColorStop(0.6, 'rgba(246,236,208,0.85)'); hg.addColorStop(1, 'rgba(246,236,208,0)');
  g.fillStyle = hg; g.fillRect(0, 0, W, H);
  g.restore();
  arcs(halo, kx + 8, 200, 70, 110, 5, 0.5, 0, Math.PI * 2, 0.35);

  // the figure, kneeling in profile toward the altar, sword reversed before him
  const cloak = poly([[244, 120], [228, 132], [208, 186], [182, 238], [160, floorY + 2], [252, floorY + 2], [246, 232], [238, 186]]);
  const backLeg = poly([[232, 206], [250, 208], [232, 260], [214, floorY], [176, floorY + 1], [176, floorY - 9], [214, 254]]);
  const thigh = poly([[244, 202], [298, 206], [306, 220], [252, 226]]);
  const shin = poly([[292, 210], [308, 216], [310, floorY - 6], [318, floorY], [290, floorY + 1], [294, floorY - 6]]);
  const torso = poly([[232, 214], [228, 170], [236, 136], [268, 132], [282, 150], [280, 186], [264, 214]]);
  const pauld = new Path2D(); pauld.ellipse(262, 146, 15, 12, -0.3, 0, Math.PI * 2);
  const arm = poly([[258, 152], [272, 150], [284, 184], [312, 176], [316, 188], [282, 198], [270, 196]]);
  const helm = new Path2D();
  helm.moveTo(242, 120); helm.bezierCurveTo(238, 90, 262, 80, 276, 92); helm.quadraticCurveTo(286, 104, 296, 118);
  helm.lineTo(282, 128); helm.quadraticCurveTo(268, 136, 250, 132); helm.closePath();
  const gorget = poly([[246, 128], [278, 126], [282, 138], [244, 140]]);
  const sword = poly([[318.5, 186], [322.5, 186], [323, floorY - 2], [320.5, floorY + 3], [318, floorY - 2]]);
  const guard = poly([[304, 184], [338, 182], [338, 187], [304, 189]]);
  const grip = poly([[318, 168], [323, 168], [323, 183], [318, 183]]);
  const knight = [cloak, backLeg, thigh, shin, torso, arm, pauld, helm, gorget];
  // ghost: open paper; form only in the turning planes, cut along the form
  for (const p of knight) { g.save(); g.fillStyle = '#f8efd4'; g.fill(p); g.restore(); }
  // the wall seen faintly through the cloak's hem
  g.save(); g.clip(cloak); for (let y = 15; y < floorY; y += 21) line([[150, y], [260, y]], 0.5, 0.25); g.restore();
  folds(cloak, [[[236, 132], [222, 180], [200, 232], [184, floorY]], [[240, 150], [232, 200], [222, 240], [214, floorY]]], 4, 3.2, 0.6, 0.6);
  hatch(backLeg, 1.2, 3, 0.55, 0.6);
  arcs(helm, 270, 112, 4, 30, 3.4, 0.55, Math.PI * 0.55, Math.PI * 1.25, 0.65);
  folds(torso, [[[236, 140], [232, 176], [238, 212]]], 3, 3, 0.55, 0.55);
  hatch(shin, 1.62, 3, 0.5, 0.5);
  hatch(thigh, 0.1, 3.4, 0.45, 0.45, [244, 202, 306, 226]);
  arcs(pauld, 262, 150, 4, 16, 3.5, 0.5, Math.PI * 0.2, Math.PI * 0.9, 0.6);
  // lames on the pauldron and the tasset, a breath-grid and the sight on the helm
  for (let k = 0; k < 3; k++) line([[252, 150 + k * 5], [274, 146 + k * 5]], 0.7, 0.75);
  line([[262, 108], [294, 116]], 1.6); // the sight
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { g.fillStyle = INK(0.85); g.beginPath(); g.arc(276 + i * 5, 121 + j * 4.5, 0.9, 0, Math.PI * 2); g.fill(); }
  line([[242, 100], [270, 84]], 0.8, 0.7); // the comb
  for (const p of knight) contour(p, 1.5, 0.92);
  // the sword (steel, drawn firmer), crossguard and pommel under the hands
  g.save(); g.fillStyle = '#f8efd4'; g.fill(sword); g.fill(guard); g.restore();
  hatch(sword, Math.PI / 2, 2, 0.4, 0.5, [317, 186, 324, floorY]);
  contour(sword, 1.2); contour(guard, 1.2); contour(grip, 1.1);
  g.fillStyle = '#f8efd4'; g.beginPath(); g.arc(320.5, 165, 4.5, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK(0.9); g.lineWidth = 1.2; g.stroke();
  // the hands closed on the pommel
  const hands = new Path2D(); hands.ellipse(318, 176, 7, 6, 0.3, 0, Math.PI * 2);
  g.save(); g.fillStyle = '#f8efd4'; g.fill(hands); g.restore(); contour(hands, 1.2);
  // the wound at the throat: a short, firm cut with rays of open lines
  line([[262, 136], [276, 134]], 1.6);
  for (let k = 0; k < 5; k++) { const a = -2.6 + k * 0.5; line([[269 + Math.cos(a) * 6, 135 + Math.sin(a) * 6], [269 + Math.cos(a) * 12, 135 + Math.sin(a) * 12]], 0.5, 0.6); }
  // mist curling from the hem along the floor
  for (let k = 0; k < 5; k++) {
    const y = floorY - 4 + k * 4;
    g.strokeStyle = INK(0.5); g.lineWidth = 0.7; g.beginPath();
    g.moveTo(150 - k * 10, y); g.bezierCurveTo(180, y - 6, 210, y + 4, 250 + k * 8, y - 2); g.stroke();
  }
  // a cast shadow of the kneeling figure on the flags (thin ruled tint)
  const cast = poly([[170, floorY + 2], [318, floorY + 2], [300, floorY + 12], [160, floorY + 10]]);
  hatch(cast, 0.05, 2.2, 0.55, 0.7);

  // ---- the plate mark
  g.strokeStyle = INK(0.92); g.lineWidth = 2.2; g.strokeRect(6, 6, W - 12, H - 12);
  g.lineWidth = 1; g.strokeRect(14.5, 14.5, W - 29, H - 29);
  void all;
  return c;
}
