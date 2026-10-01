import { makeCanvas, vignette, grade, grain, rgba, glow, flame, rngOf, hashStr, fog as fogBand, clamp01 } from './paint.js';
import { paintSetting } from './settings.js';
import { placeCreature, creatureScale, paintCreature, dragonHead, hasCreature } from './creatures.js';
import { paintPortrait } from '../components/portraitPainter.js';

/**
 * Illustrated panels for the dialogue / encounter / shop screens — the big
 * picture of the Gold Box encounter window, painted procedurally.
 *
 *   paintPanel({setting, light, deity, monsters, seed, w, h}) → {canvas, info}
 *   paintNpcPortrait(npc, scale) → canvas
 *   new PanelOverlay(canvas, info).draw(t)   animated flames, motes, fog
 */

export const LIGHTS = {
  day: { key: '#fff0d0', rim: '#c8d8ff', rimA: 0.45 },
  dusk: { key: '#ffb070', rim: '#b490ff', rimA: 0.55 },
  night: { key: '#ff9a50', rim: '#8aa8ff', rimA: 0.6 },
  torch: { key: '#ff9a40', rim: '#ffc080', rimA: 0.45 },
  fire: { key: '#ff8a30', rim: '#ffb060', rimA: 0.5 },
  dim: { key: '#d8b090', rim: '#7a98d0', rimA: 0.5 },
  green: { key: '#70ff90', rim: '#40ff70', rimA: 0.6 },
  gold: { key: '#ffd060', rim: '#fff0a0', rimA: 0.6 },
  ghost: { key: '#9ff4ff', rim: '#c8fbff', rimA: 0.6 },
  ward: { key: '#a8c8ff', rim: '#c8d8ff', rimA: 0.55 },
};

const DEFAULT_LIGHT = {
  slums: 'dusk', alley: 'night', street_day: 'day', plaza: 'day', gate: 'dusk', keep: 'night', graveyard: 'night', wilds: 'dusk', docks: 'dusk',
  well_head: 'dusk', ruined_temple: 'day', tenement: 'dim', tavern: 'torch', temple: 'torch', chapel: 'ghost', cityhall: 'torch', smithy: 'fire',
  shop: 'torch', curio: 'torch', training: 'day', library: 'dim', textile: 'dim', crypt: 'torch', castle: 'torch', temple_bane: 'green', well: 'dim', pool: 'gold',
};

/**
 * @param {{setting:string, light?:string, deity?:object, monsters?:{id:string,count:number}[], seed?:number, w?:number, h?:number}} spec
 */
export function paintPanel(spec) {
  const W = spec.w ?? 1280;
  const H = spec.h ?? 640;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const light = spec.light ?? DEFAULT_LIGHT[spec.setting] ?? 'dusk';
  const seed = spec.seed ?? hashStr(spec.setting);
  const info = paintSetting(g, W, H, spec.setting, { light, deity: spec.deity, seed });
  info.light = light;
  if (spec.monsters?.length) placeGroup(g, W, H, spec.monsters, info, light, seed);
  // unify: grade, vignette, grain
  const tone = {
    day: ['#2a3450', '#ffe0b0'], dusk: ['#1a1840', '#ffb080'], night: ['#0a1030', '#ffb070'], torch: ['#1a1020', '#ffb060'], fire: ['#1a0a10', '#ff9a40'],
    dim: ['#141828', '#e0c090'], green: ['#051a0a', '#9aff9a'], gold: ['#2a1a05', '#ffe090'], ghost: ['#0a1a2a', '#c0f0ff'], ward: ['#0a1030', '#c0d8ff'],
  }[light] ?? ['#1a2440', '#ffcc88'];
  grade(g, W, H, { shadow: tone[0], highlight: tone[1], amount: 0.4 });
  vignette(g, W, H, 0.62);
  grain(g, W, H, 0.07, seed % 97);
  return { canvas: c, info };
}

/**
 * Arrange up to 7 figures as a loose war-band: the leader forward and centre,
 * flankers a step back, a staggered second rank fading into the haze.
 */
function placeGroup(g, W, H, groups, info, light, seed) {
  const list = [];
  for (const gr of groups) {
    const n = Math.max(1, Math.min(8, gr.count ?? 1));
    for (let i = 0; i < n; i++) list.push(gr.id);
  }
  const R = rngOf(seed + 5);
  const shown = list.slice(0, 7);
  const floor = info.floorY ?? H * 0.64;
  const L = LIGHTS[light] ?? LIGHTS.dusk;
  const hazeColor = info.sky?.fog ?? (light === 'green' ? '#0a2010' : '#1a1410');
  const biggest = Math.max(...shown.map((id) => creatureScale(id)));
  const human = Math.min(H * 0.52, (H * 0.64) / Math.max(1, biggest));
  const depth = (t) => floor + (H - floor) * t;
  // slots: [x (0..1), depth t, scale, haze]
  const front = [[0.5, 0.95, 1.0, 0], [0.3, 0.8, 0.9, 0.04], [0.7, 0.82, 0.9, 0.04]];
  const back = [[0.4, 0.42, 0.66, 0.3], [0.6, 0.45, 0.66, 0.3], [0.19, 0.5, 0.68, 0.28], [0.81, 0.5, 0.68, 0.28]];
  const n = shown.length;
  const slots = n === 1 && shown[0] === 'tyranthraxus' ? [[0.5, 0.25, 0.6, 0]] : n === 1 && shown[0] === 'ghostKnight' ? [[0.5, 0.3, 0.82, 0]] : n === 1 ? [[0.5, 0.92, 1.05, 0]] : n === 2 ? [[0.4, 0.9, 1, 0], [0.62, 0.84, 0.95, 0.03]] : [...front, ...back].slice(0, n);
  const items = shown.map((id, i) => ({ id, slot: slots[i], i }));
  // paint far to near
  items.sort((a, b) => a.slot[1] - b.slot[1]);
  let fogged = false;
  for (const it of items) {
    const [sx, t, sc, haze] = it.slot;
    if (!fogged && t > 0.6 && items.some((o) => o.slot[1] < 0.6)) {
      fogBand(g, W, depth(0.5), H * 0.14, hazeColor, 0.3, seed % 13);
      fogged = true;
    }
    const x = W * (sx + (R() - 0.5) * 0.04);
    const y = depth(t) + (R() - 0.5) * H * 0.015;
    let hpx = human * sc * creatureScale(it.id) * (0.95 + R() * 0.1);
    hpx = Math.min(hpx, H * 0.95);
    placeCreature(g, it.id, x, y, hpx, L, { haze, hazeColor, seed: seed + it.i * 13 + (it.id.length << 3), flip: sx > 0.55 && R() < 0.6 });
  }
  // low ground mist around their feet ties the figures into the scene
  fogBand(g, W, H * 0.97, H * 0.12, hazeColor, 0.22, (seed + 3) % 13);
}

// ------------------------------------------------------------------ NPC portraits

const portraitCache = new Map();

/**
 * Painted portrait canvas for an NPC (data/npcs.js). Human NPCs use the party
 * portrait painter; ghosts are washed spectral; monsters/dragons get close-ups.
 */
export function paintNpcPortrait(npc, scale = 1) {
  const key = `${npc.id}|${scale}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  let c;
  const W = Math.round(300 * scale);
  const H = Math.round(375 * scale);
  if (npc.kind === 'dragon') {
    c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(W / 2, H * 0.6, 10, W / 2, H * 0.5, H * 0.8);
    bg.addColorStop(0, '#6a4410');
    bg.addColorStop(1, '#0a0602');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    glow(g, W / 2, H, H * 0.8, '#ffd060', 0.5);
    // neck rising out of frame
    const ng = g.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
    ng.addColorStop(0, '#8a5a24');
    ng.addColorStop(0.5, '#5a3612');
    ng.addColorStop(1, '#1e1006');
    g.fillStyle = ng;
    g.beginPath();
    g.moveTo(W * 0.3, H);
    g.quadraticCurveTo(W * 0.34, H * 0.62, W * 0.42, H * 0.5);
    g.lineTo(W * 0.6, H * 0.5);
    g.quadraticCurveTo(W * 0.68, H * 0.66, W * 0.72, H);
    g.closePath();
    g.fill();
    dragonHead(g, W / 2, H * 0.34, W * 0.27, '#b07a3a', '#ffe080', LIGHTS.gold);
    vignette(g, W, H, 0.55);
  } else if (npc.kind === 'monster') {
    c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.5, H * 0.8);
    bg.addColorStop(0, '#4a2a18');
    bg.addColorStop(1, '#0a0604');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    glow(g, W * 0.2, H * 0.3, H * 0.6, '#ff8a30', 0.3);
    const id = hasCreature(npc.monster) ? (npc.id === 'kobold_chief' ? 'koboldChief' : npc.monster) : 'orc';
    const fig = paintCreature(id, H * 2.5, LIGHTS.torch, 3);
    // crop to head & shoulders
    g.drawImage(fig.canvas, W / 2 - fig.ox, H * 1.02 - fig.oy + H * 1.25);
    vignette(g, W, H, 0.55);
  } else {
    const ch = { race: npc.race ?? 'human', gender: npc.gender ?? 'male', look: npc.look ?? {}, name: npc.name };
    if (npc.kind === 'hooded') ch.look = { ...ch.look, head: 6 };
    c = paintPortrait(ch, { scale });
    if (npc.kind === 'ghost') {
      const g = c.getContext('2d');
      g.save();
      g.globalCompositeOperation = 'luminosity';
      g.fillStyle = 'rgba(128,128,128,0.35)';
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'color';
      g.fillStyle = 'rgba(90,220,255,0.85)';
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'screen';
      const gr = g.createLinearGradient(0, 0, 0, c.height);
      gr.addColorStop(0, 'rgba(120,220,255,0.15)');
      gr.addColorStop(1, 'rgba(160,240,255,0.55)');
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
      g.restore();
      glow(g, c.width / 2, c.height * 0.4, c.height * 0.5, '#8ff0ff', 0.25);
      // scanline shimmer
      g.fillStyle = 'rgba(200,250,255,0.08)';
      for (let y = 0; y < c.height; y += 3) g.fillRect(0, y, c.width, 1);
    } else if (npc.kind === 'hooded') {
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 0, c.width, c.height);
      if (npc.aura) glow(g, c.width / 2, c.height * 0.44, c.height * 0.25, npc.aura, 0.12);
    }
  }
  portraitCache.set(key, c);
  return c;
}

const portraitURLs = new Map();
/**
 * The NPC portrait framed in a gilt arch, baked into one PNG (a plain <img>
 * with no CSS clipping/shadows keeps the parchment box on a single raster layer).
 */
export function framedPortraitURL(npc) {
  if (portraitURLs.has(npc.id)) return portraitURLs.get(npc.id);
  const src = paintNpcPortrait(npc, 1);
  const W = 344;
  const H = 424;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const arch = (x, y, w, hh) => {
    const r = w / 2;
    g.beginPath();
    g.moveTo(x, y + hh);
    g.lineTo(x, y + r);
    g.arc(x + r, y + r, r, Math.PI, 0);
    g.lineTo(x + w, y + hh);
    g.closePath();
  };
  const ghost = npc.kind === 'ghost';
  // drop shadow + outer glow
  g.save();
  g.shadowColor = ghost ? 'rgba(143,240,255,0.55)' : 'rgba(0,0,0,0.75)';
  g.shadowBlur = 22;
  g.shadowOffsetY = ghost ? 0 : 8;
  arch(22, 14, W - 44, H - 36);
  g.fillStyle = '#1b1206';
  g.fill();
  g.restore();
  // gilt ring
  const gilt = g.createLinearGradient(0, 14, 0, H - 22);
  const stops = ghost ? ['#e0ffff', '#8ff0ff', '#2a8aa0', '#8ff0ff', '#d0ffff'] : ['#fff0c2', '#e4bf66', '#9c7430', '#d9b460', '#f3dc98'];
  stops.forEach((col, i) => gilt.addColorStop(i / 4, col));
  arch(26, 18, W - 52, H - 44);
  g.fillStyle = gilt;
  g.fill();
  arch(33, 25, W - 66, H - 58);
  g.fillStyle = '#2a1a08';
  g.fill();
  // the painting
  g.save();
  arch(36, 28, W - 72, H - 64);
  g.clip();
  g.drawImage(src, 36, 28, W - 72, H - 64);
  const v = g.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H * 0.5, H * 0.6);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  g.restore();
  // inner highlight hairline
  arch(36.5, 28.5, W - 73, H - 65);
  g.strokeStyle = 'rgba(255,230,170,0.35)';
  g.lineWidth = 1;
  g.stroke();
  const url = c.toDataURL('image/png');
  portraitURLs.set(npc.id, url);
  return url;
}


// ------------------------------------------------------------------ animated overlay

/**
 * Draws the living parts of a panel on a transparent canvas laid over it:
 * flickering flames and candles, pulsing glows, drifting motes and fog.
 * Deterministic for a time t (frozen clock ⇒ settled frame at t).
 */
export class PanelOverlay {
  constructor(canvas, info, seed = 1) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.info = info;
    const R = rngOf(seed * 7 + 3);
    const m = info.motes ?? { color: '#ffe0b0', count: 30, rise: 0.05 };
    this.motes = Array.from({ length: m.count }, () => ({ x: R(), y: R(), s: 0.6 + R() * 1.8, ph: R() * 10, sp: 0.2 + R() * 0.8 }));
    this.moteColor = m.color;
    this.rise = m.rise ?? 0.05;
  }

  draw(t) {
    const { g, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    for (const [i, L] of (this.info.lights ?? []).entries()) {
      const ph = t + i * 1.7;
      const fl = 0.82 + Math.sin(ph * 7.3) * 0.08 + Math.sin(ph * 17.1 + 1) * 0.06 + Math.sin(ph * 3.1) * 0.04;
      if (L.kind === 'flame') {
        glow(g, L.x, L.y - L.s * 0.6, L.s * 9 * fl, L.color, 0.16 * fl);
        flame(g, L.x, L.y, L.s, ph, L.color);
      } else if (L.kind === 'candle') {
        glow(g, L.x, L.y, L.s * 10 * fl, L.color, 0.12 * fl);
        flame(g, L.x, L.y + L.s * 0.6, L.s * 0.9, ph * 1.3, L.color);
      } else if (L.kind === 'glow' || L.kind === 'ghost' || L.kind === 'ward') {
        const p = 0.75 + Math.sin(ph * 1.6) * 0.25;
        glow(g, L.x, L.y, L.s * (L.kind === 'ward' ? 3 : 4), L.color, 0.18 * p);
      } else if (L.kind === 'pool') {
        const p = 0.8 + Math.sin(t * 0.9) * 0.2;
        glow(g, L.x, L.y, L.s * 1.2, L.color, 0.18 * p);
      }
    }
    // motes: dust/embers/spores drifting
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const x = ((m.x + Math.sin(t * 0.13 * m.sp + m.ph) * 0.03 + t * 0.004 * m.sp) % 1 + 1) % 1;
      const y = ((m.y - t * this.rise * 0.05 * m.sp) % 1 + 1) % 1;
      const a = clamp01(0.25 + Math.sin(t * 1.3 * m.sp + m.ph) * 0.35);
      g.fillStyle = rgba(this.moteColor, a);
      g.beginPath();
      g.arc(x * W, y * H, m.s, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}
