import { paintPanel, npcActor, ghostActor } from '../../ui/art/index.js';
import { NPCS } from '../../data/npcs.js';
import { rngOf } from '../../ui/art/paint.js';

/**
 * The Adventurer's Journal as a physical book: page textures with curvature,
 * a gutter shadow, deckled edges and a stack of page edges; and a bespoke
 * copper-plate engraving for each entry — the scene is composed (setting,
 * figures), then re-drawn as cross-hatched burin lines and ink contours.
 */

// subject of each entry's plate
const PLATES = {
  1: { setting: 'docks', light: 'dusk' }, 2: { setting: 'docks', light: 'day' }, 3: { setting: 'cityhall', actor: 'clerk' }, 4: { setting: 'cityhall', actor: 'clerk' },
  5: { setting: 'slums', monsters: [{ id: 'kobold', count: 3 }] }, 6: { setting: 'keep', light: 'night' }, 7: { setting: 'chapel', actor: 'ferran', light: 'ghost', pose: 'stand' },
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
  const W = 720;
  const H = 290;
  const npc = spec.actor ? NPCS[spec.actor] : null;
  const actor = npc ? (npc.kind === 'ghost' ? ghostActor(spec.pose) : npcActor(npc)) : null;
  const { canvas, composer } = paintPanel({ setting: spec.setting, light: spec.light, monsters: spec.monsters, actor, w: W, h: H, seed: n * 17 + 3 });
  // the subject's silhouette: every figure sprite drawn as a flat mask
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const mg = mask.getContext('2d');
  for (const a of composer.actors) composer._sprite(mg, { ...a, ghost: false, r: { ...a.r, emit: [] } }, 0);
  for (const o of composer.ops) if (o.kind === 'sprite') composer._sprite(mg, { ...o, ghost: false, r: { ...o.r, emit: [] } }, 0);
  const url = engrave(canvas, mask, n).toDataURL('image/png');
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
function engrave(src, maskC, seed) {
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
  const B = blur(L, 1);
  const Mb = blur(M, 1);
  // tone: normalised darkness, the background flattened a little so the subject carries the plate
  const sample = [];
  for (let i = 0; i < N; i += 11) sample.push(B[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.04)];
  const hi = sample[Math.floor(sample.length * 0.97)];
  const R = rngOf(seed * 31 + 7);
  const tone = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let t = 1 - Math.max(0, Math.min(1, (B[i] - lo) / Math.max(0.05, hi - lo)));
    t = Math.pow(t, 1.35);
    const subj = Mb[i];
    t = subj > 0.5 ? t * 0.92 : 0.12 + t * 0.78; // background compressed toward a mid tone
    // oval vignette wholly inside the plate mark
    const vx = (x - W / 2) / (W * 0.47);
    const vy = (y - H / 2) / (H * 0.43);
    const v = vx * vx + vy * vy + Math.sin(x * 0.07 + seed) * Math.cos(y * 0.09) * 0.04;
    tone[i] = t * Math.max(0, Math.min(1, (1 - v) * 3.2));
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
    const coh = Math.min(1, Math.sqrt((Jxx[i] - Jyy[i]) ** 2 + 4 * Jxy[i] ** 2) * 40);
    // blend toward the default by coherence (on the double-angle circle)
    const c = Math.cos(2 * th) * coh + Math.cos(2 * base) * (1 - coh);
    const s2 = Math.sin(2 * th) * coh + Math.sin(2 * base) * (1 - coh);
    ang[i] = 0.5 * Math.atan2(s2, c);
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
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
        // trace both ways along the direction field
        const pts = [[x0, y0]];
        for (const dir of [1, -1]) {
          let x = x0; let y = y0;
          for (let k = 0; k < len; k++) {
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
    if (t < 0.8 || R() > (t - 0.8) * 4) continue;
    og.fillStyle = ink(0.8);
    og.fillRect(x, y, 1.1, 1.1);
  }
  // contours: strong picture edges thin, the subject's silhouette heavy and clean
  const img = og.getImageData(0, 0, W, H);
  const o = img.data;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x;
    const vx = (x - W / 2) / (W * 0.47);
    const vy = (y - H / 2) / (H * 0.43);
    const fade = Math.max(0, Math.min(1, (1 - (vx * vx + vy * vy)) * 3));
    if (fade <= 0) continue;
    const e = Math.hypot(gx[i], gy[i]) * 0.25 * fade;
    const me = Math.abs(Mb[i + 1] - Mb[i - 1]) + Math.abs(Mb[i + W] - Mb[i - W]);
    let a = 0;
    if (e > 0.14) a = Math.min(0.75, (e - 0.14) * 5);
    if (me > 0.25) a = Math.max(a, Math.min(1, me * 1.4) * fade);
    if (a <= 0) continue;
    const k = i * 4;
    const prev = o[k + 3] / 255;
    const na = 1 - (1 - prev) * (1 - a);
    o[k] = 38; o[k + 1] = 24; o[k + 2] = 14; o[k + 3] = Math.round(na * 240);
  }
  og.putImageData(img, 0, 0);
  // plate mark: a double ruled border pressed into the paper
  og.strokeStyle = 'rgba(38,24,14,0.55)';
  og.lineWidth = 1.5;
  og.strokeRect(4, 4, W - 8, H - 8);
  og.lineWidth = 0.8;
  og.strokeRect(9, 9, W - 18, H - 18);
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
