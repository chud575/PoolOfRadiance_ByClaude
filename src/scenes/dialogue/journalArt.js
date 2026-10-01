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
  5: { setting: 'slums', monsters: [{ id: 'kobold', count: 3 }] }, 6: { setting: 'keep', light: 'night' }, 7: { setting: 'chapel', actor: 'ferran', light: 'ghost' },
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
  const actor = npc ? (npc.kind === 'ghost' ? ghostActor() : npcActor(npc)) : null;
  const { canvas } = paintPanel({ setting: spec.setting, light: spec.light, monsters: spec.monsters, actor, w: W, h: H, seed: n * 17 + 3 });
  const url = engrave(canvas, n).toDataURL('image/png');
  plateCache.set(n, url);
  return url;
}

/** Re-draw a painting as a copper engraving: hatching by tone + ink contours, on a plate mark. */
function engrave(src, seed) {
  const W = src.width;
  const H = src.height;
  const sg = src.getContext('2d');
  const d = sg.getImageData(0, 0, W, H).data;
  // luminance, lightly blurred, with a gentle S-curve so the plate keeps its darks
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  const B = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += L[(y + j) * W + x + i];
    B[y * W + x] = s / 9;
  }
  // normalise contrast across the plate
  const sample = [];
  for (let i = 0; i < B.length; i += 11) sample.push(B[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.04)];
  const hi = sample[Math.floor(sample.length * 0.97)];
  const R = rngOf(seed * 31 + 7);
  const ph = [R() * 6, R() * 6, R() * 6, R() * 6];
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const og = out.getContext('2d');
  const img = og.createImageData(W, H);
  const o = img.data;
  const ink = [38, 24, 14];
  const line = (x, y, ang, sp, width, phase) => {
    const u = (x * Math.cos(ang) + y * Math.sin(ang)) / sp + phase + Math.sin((x * Math.sin(ang) - y * Math.cos(ang)) * 0.045 + phase) * 0.12;
    const f = Math.abs(u - Math.round(u)) * sp; // distance to the nearest line in px
    return Math.max(0, Math.min(1, width / 2 + 0.6 - f));
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let t = 1 - Math.max(0, Math.min(1, (B[i] - lo) / Math.max(0.05, hi - lo)));
      t = Math.pow(t, 1.6);
      // vignetted plate: the engraving fades out in a ragged oval, leaving paper at the margins
      const vx = (x - W / 2) / (W * 0.53);
      const vy = (y - H * 0.52) / (H * 0.6);
      const v = vx * vx + vy * vy + Math.sin(x * 0.09 + ph[0]) * Math.cos(y * 0.11 + ph[1]) * 0.05;
      const fade = Math.max(0, Math.min(1, (1.08 - v) * 2.4));
      t *= fade;
      let a = 0;
      // burin layers: each darker tone adds a crossing direction, lines swell with tone
      if (t > 0.3) a = Math.max(a, line(x, y, 0.78, 8.5, 0.6 + (t - 0.3) * 3.2, ph[0]));
      if (t > 0.56) a = Math.max(a, line(x, y, -0.62, 9, 0.5 + (t - 0.56) * 3.4, ph[1]));
      if (t > 0.76) a = Math.max(a, line(x, y, 0.05, 8, 0.5 + (t - 0.76) * 3.6, ph[2]));
      if (t > 0.9) a = Math.max(a, line(x, y, 1.45, 7, 0.9 + (t - 0.9) * 7, ph[3]));
      // ink contours from the luminance gradient (only real edges, not texture)
      if (fade > 0.3 && x > 1 && y > 1 && x < W - 2 && y < H - 2) {
        const gx = B[i + 2] - B[i - 2];
        const gy = B[i + 2 * W] - B[i - 2 * W];
        const e = Math.hypot(gx, gy) * fade;
        if (e > 0.11) a = Math.max(a, Math.min(1, (e - 0.11) * 9));
      }
      o[i * 4] = ink[0];
      o[i * 4 + 1] = ink[1];
      o[i * 4 + 2] = ink[2];
      o[i * 4 + 3] = Math.round(a * 235);
    }
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
