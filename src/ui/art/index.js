import { makeCanvas, gpuCopy, vignette, grade, grain, rgba, glow, glowEllipse, flame, rngOf, hashStr, fog as fogBand, clamp01, contactShadow, softwareGL } from './paint.js';
import { paintSetting } from './settings.js';
import './interiors.js';
import { placeCreature, creatureScale, paintCreature, dragonHead, hasCreature, isSculpted, renderCreature, flattenSprite } from './creatures.js';
import { paintPortrait, defaultLook, SKIN_TONES, RACE_SKINS, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS, HEADS, BODIES } from '../components/portraitPainter.js';
import { buildPerson, buildCreature } from './bodies.js';
import { buildNpc } from './people.js';
import { renderFigure, mul3, rotX, rotY, ap3 } from './sculpt.js';
import { paintPortraitDesign, paintFaceDecal, paintGhostKnight } from './facePaint.js';
import { paintPortraitGL } from './portraitGL.js';

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
  // a temple's high window: near-white daylight from above, candles only as a warm rim — vestments
  // keep the colours they have in the priest's portrait (white stays white, blue stays blue)
  sanctum: { key: '#fff1de', rim: '#ffd8a0', rimA: 0.5 },
};

const DEFAULT_LIGHT = {
  slums: 'dusk', alley: 'night', street_day: 'day', plaza: 'day', gate: 'dusk', keep: 'night', graveyard: 'night', wilds: 'dusk', docks: 'dusk',
  well_head: 'dusk', ruined_temple: 'day', tenement: 'dim', tavern: 'torch', temple: 'sanctum', chapel: 'ghost', cityhall: 'sanctum', smithy: 'fire',
  shop: 'torch', curio: 'torch', training: 'day', library: 'dim', textile: 'dim', crypt: 'torch', castle: 'torch', temple_bane: 'green', well: 'dim', pool: 'gold',
};

/** Key/rim light layout per light preset (world dirs toward the light). */
const RIGS = {
  day: { key: [-0.5, 0.8, 0.45], keyI: 1.25, amb: 0.75, sky: '#8aa0c0', ground: '#5a5040' },
  dusk: { key: [-0.75, 0.3, 0.55], keyI: 1.3, amb: 0.5, sky: '#5a4a7a', ground: '#2a1e1e' },
  night: { key: [-0.45, 0.35, 0.8], keyI: 1.15, amb: 0.32, sky: '#22305a', ground: '#140e0c' },
  torch: { key: [-0.5, 0.4, 0.75], keyI: 1.3, amb: 0.38, sky: '#3a3040', ground: '#1e140c' },
  fire: { key: [-0.5, 0.35, 0.75], keyI: 1.35, amb: 0.36, sky: '#40281c', ground: '#1e100a' },
  dim: { key: [-0.55, 0.5, 0.65], keyI: 1.1, amb: 0.45, sky: '#3a3c50', ground: '#1e1812' },
  green: { key: [-0.4, 0.5, 0.75], keyI: 1.1, amb: 0.35, sky: '#1a3a22', ground: '#0a120a' },
  gold: { key: [0.2, 0.3, 0.9], keyI: 1.3, amb: 0.5, sky: '#6a4a20', ground: '#2a1a08' },
  ghost: { key: [0.1, 0.8, 0.5], keyI: 1.1, amb: 0.45, sky: '#2a4a5a', ground: '#0e1418' },
  ward: { key: [-0.4, 0.6, 0.7], keyI: 1.1, amb: 0.45, sky: '#2a3a6a', ground: '#101420' },
  sanctum: { key: [-0.35, 0.75, 0.55], keyI: 1.18, amb: 0.5, sky: '#565a6e', ground: '#2a2018' },
};

/** Light rig for a figure standing at (x, y) of the panel. */
export function rigAt(light, info, x, y, W) {
  const L = LIGHTS[light] ?? LIGHTS.dusk;
  const R = RIGS[light] ?? RIGS.dusk;
  // the nearest scene light rims the figure from behind on its side
  let rimDir = [-R.key[0] * 1.2 || 0.8, 0.4, -0.65];
  let rimC = L.rim;
  let best = Infinity;
  for (const l of info.lights ?? []) {
    if (l.kind !== 'flame' && l.kind !== 'candle' && l.kind !== 'glow') continue;
    const d = Math.abs(l.x - x) + Math.abs(l.y - y) * 0.5;
    if (d < best) { best = d; rimDir = [Math.sign(l.x - x || 1) * 0.85, 0.35 + Math.max(0, (y - l.y) / W) * 0.6, -0.6]; rimC = l.color ?? L.rim; }
  }
  if ((light === 'dusk' || light === 'night') && best < Infinity) {
    // in the streets after dark the lamps are the key: warm light from the nearest torch's side and
    // in front, a cool moon rim from behind on the other side, a low cold ambient between
    const side = Math.sign(rimDir[0]) || 1;
    return {
      key: { dir: [side * 0.62, 0.42, 0.66], color: rimC, i: R.keyI * 1.2 },
      rim: { dir: [-side * 0.78, 0.45, -0.6], color: '#9ab8ff', i: 1.55 },
      fill: { dir: [-side * 0.5, 0.8, 0.3], color: '#6a78b0', i: 0.22 },
      sky: '#2e3050', ground: R.ground, amb: R.amb * 0.62,
    };
  }
  return {
    key: { dir: R.key, color: L.key, i: R.keyI * 1.12 },
    rim: { dir: rimDir, color: rimC, i: (0.6 + (L.rimA ?? 0.5) * 1.3) * 1.3 },
    sky: R.sky, ground: R.ground, amb: R.amb,
  };
}

/**
 * @param {{setting:string, light?:string, deity?:object, monsters?:{id:string,count:number}[], actor?:object, seed?:number, w?:number, h?:number}} spec
 * @returns {{canvas:HTMLCanvasElement, info:object, composer:PanelComposer}}
 */
/** ?perf=1 logs where a panel's bake spends its time (dev aid; never affects the image). */
const PERF = typeof location !== 'undefined' && /[?&]perf=1/.test(location.search);
const perfNow = () => (PERF ? performance.now() : 0);
const perfLog = (label, t0) => { if (PERF) console.info(`[perf] ${label} ${Math.round(performance.now() - t0)} ms`); };
export { perfNow, perfLog };

export function paintPanel(spec) {
  const T0 = perfNow();
  const W = spec.w ?? 1280;
  const H = spec.h ?? 640;
  const bg = makeCanvas(W, H);
  const g = bg.getContext('2d');
  const fg = makeCanvas(W, H);
  const light = spec.light ?? DEFAULT_LIGHT[spec.setting] ?? 'dusk';
  const seed = spec.seed ?? hashStr(spec.setting);
  const info = paintSetting(g, W, H, spec.setting, { light, deity: spec.deity, seed, fg: fg.getContext('2d'), actor: !!spec.actor, cast: spec.cast, pose: spec.pose });
  info.light = light;
  perfLog(`panel ${spec.setting}: setting`, T0);
  const composer = new PanelComposer(W, H, bg, info, light, seed);
  if (info.fgUsed) composer.fg = fg;
  const T1 = perfNow();
  if (spec.actor) composer.addActor(spec.actor, info.actorSlot ?? { x: W * 0.5, y: H * 0.95, h: H * 0.74, pose: 'stand', yaw: 0.15 });
  perfLog(`panel ${spec.setting}: actor`, T1);
  const T2 = perfNow();
  if (spec.monsters?.length) placeGroup(composer, g, W, H, spec.monsters, info, light, seed, spec.mood);
  perfLog(`panel ${spec.setting}: monsters`, T2);
  // painting is done on CPU canvases (fast pixel access); the layers composited every frame move to
  // the GPU, as does the canvas that is shown
  composer.bg = gpuCopy(bg);
  if (composer.fg) composer.fg = gpuCopy(fg);
  const canvas = makeCanvas(W, H, { gpu: true });
  composer.draw(canvas.getContext('2d'), 0);
  return { canvas, info, composer };
}

/**
 * Draws a panel: the painted setting, then animated figure sprites (idle
 * breathing, weapon sway, tail flicks), the foreground props in front of an
 * actor (desk, anvil, bar), depth fog between ranks, and the unifying grade.
 * Deterministic for a time t.
 */
export class PanelComposer {
  constructor(W, H, bg, info, light, seed) {
    this.W = W;
    this.H = H;
    this.bg = bg;
    this.info = info;
    this.light = light;
    this.seed = seed;
    this.actors = [];
    this.ops = []; // monsters & fog bands, far to near
    this.fg = null;
    const tone = {
      day: ['#2a3450', '#ffe0b0'], dusk: ['#1a1840', '#ffb080'], night: ['#0a1030', '#ffb070'], torch: ['#1a1020', '#ffb060'], fire: ['#1a0a10', '#ff9a40'],
      dim: ['#141828', '#e0c090'], green: ['#051a0a', '#9aff9a'], gold: ['#2a1a05', '#ffe090'], ghost: ['#0a1a2a', '#c0f0ff'], ward: ['#0a1030', '#c0d8ff'], sanctum: ['#141826', '#fff0d8'],
    }[light] ?? ['#1a2440', '#ffcc88'];
    this.tone = tone;
  }

  /** An NPC standing in the setting's actor slot (behind its desk/anvil/altar). */
  addActor(actor, slot) {
    const r0 = actor.render(slot, rigAt(this.light, this.info, slot.x, slot.y, this.W));
    if (!r0) return;
    const r = r0;
    if (r.dx) slot = { ...slot, x: slot.x + r.dx };
    const g = this.bg.getContext('2d');
    contactShadow(g, slot.x, slot.y, slot.h * 0.16, slot.h * 0.03, 0.5);
    this.actors.push({ r, x: slot.x, y: slot.y, ph: 1.3, amp: 0.7, ghost: !!actor.ghost && !r.spectral, hover: !!actor.ghost, sway: 0.4 });
    if (actor.ghost) {
      // the ghost is a cold point light: it spills onto the floor and the altar around him
      glowEllipse(g, slot.x, slot.y - slot.h * 0.02, slot.h * 0.75, slot.h * 0.12, '#7ae8ff', 0.42, 'screen');
      glowEllipse(g, slot.x, slot.y - slot.h * 0.02, slot.h * 0.3, slot.h * 0.05, '#c8fbff', 0.35, 'screen');
      glow(g, slot.x, slot.y - slot.h * 0.55, slot.h * 1.1, '#5ad8f0', 0.2, 'screen');
      // his light falls on the altar he kneels to: the near face of the stone goes cold
      if (slot.altar) {
        const [ax, ay] = slot.altar;
        glowEllipse(g, ax - slot.h * 0.12, ay - slot.h * 0.2, slot.h * 0.32, slot.h * 0.26, '#7ae8ff', 0.3, 'screen');
        glowEllipse(g, (ax + slot.x) / 2, ay + slot.h * 0.02, slot.h * 0.55, slot.h * 0.08, '#8ff0ff', 0.25, 'screen');
      }
      // and on the pews in front of him (lit only where the wood is)
      if (this.fg) {
        const fgc = this.fg.getContext('2d');
        fgc.save();
        fgc.globalCompositeOperation = 'source-atop';
        const gr = fgc.createRadialGradient(slot.x, slot.y - slot.h * 0.3, 0, slot.x, slot.y - slot.h * 0.3, slot.h * 0.95);
        gr.addColorStop(0, 'rgba(110,225,255,0.4)');
        gr.addColorStop(0.5, 'rgba(80,190,230,0.14)');
        gr.addColorStop(1, 'rgba(80,190,230,0)');
        fgc.fillStyle = gr;
        fgc.fillRect(0, 0, this.W, this.H);
        fgc.restore();
      }
      this.info.lights.push({ x: slot.x, y: slot.y - slot.h * 0.6, s: slot.h * 0.18, kind: 'ghost', color: '#8ff0ff' });
    }
  }

  addSprite(rec) { this.ops.push({ kind: 'sprite', ...rec }); }
  addFog(y, h, color, a, seed) { this.ops.push({ kind: 'fog', y, h, color, a, seed }); }

  _sprite(g, s, t) {
    const r = s.r;
    const amp = s.amp ?? 1;
    const br = Math.sin(t * (2 * Math.PI / (s.period ?? 3.4)) + s.ph);
    // idle life: a slow weight-shift sway that bends from the feet (the head travels most),
    // breathing that lifts the shoulders and swells the chest, and a ghost's hover
    const bend = (Math.sin(t * 0.83 + s.ph * 1.7) * 0.016 + Math.sin(t * 2.1 + s.ph) * 0.0035) * (s.sway ?? 1);
    const hover = s.ghost || s.hover ? Math.sin(t * 0.9 + s.ph) * 0.01 : 0;
    g.save();
    g.translate(s.x, s.y);
    if (s.flip) g.scale(-1, 1);
    if (r.tail) {
      g.save();
      const ty = -r.pelvisY;
      g.translate(0, ty);
      g.rotate(Math.sin(t * 1.9 + s.ph * 2.3) * 0.07 + Math.sin(t * 5.3 + s.ph) * 0.015);
      g.translate(0, -ty);
      g.drawImage(r.tail.canvas, -r.tail.ox, -r.tail.oy);
      g.restore();
    }
    const strips = (alpha) => {
      const c = r.canvas;
      const H = c.height;
      const hp = Math.max(1, r.oy);
      const n = Math.max(6, Math.min(28, Math.round(H / 14)));
      for (let i = 0; i < n; i++) {
        const y0 = Math.floor((i * H) / n);
        const y1 = Math.floor(((i + 1) * H) / n);
        const u = Math.max(0, Math.min(1.2, (r.oy - (y0 + y1) / 2) / hp)); // 0 feet .. 1 head
        const dx = bend * hp * Math.pow(u, 1.5);
        const chest = Math.max(0, 1 - Math.abs(u - 0.68) / 0.16);
        const lift = (br * 0.0065 * amp * Math.min(1, Math.max(0, (u - 0.45) / 0.25)) + hover) * hp;
        const wx = 1 + br * 0.014 * amp * chest;
        const w = c.width * wx;
        g.globalAlpha = alpha;
        g.drawImage(c, 0, y0, c.width, y1 - y0 + 1, -r.ox * wx + dx, y0 - r.oy - lift, w, y1 - y0 + 1);
      }
    };
    if (s.ghost) {
      g.globalCompositeOperation = 'lighter';
      g.filter = 'blur(10px)';
      strips(0.55);
      g.filter = 'none';
      strips(0.9 + Math.sin(t * 1.3 + s.ph) * 0.08);
    } else strips(1);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    for (const e of r.emit ?? []) {
      const p = 0.8 + Math.sin(t * 3.1 + e.x) * 0.12;
      const u = Math.max(0, Math.min(1.2, (r.oy - e.y) / Math.max(1, r.oy)));
      glow(g, e.x - r.ox + bend * r.oy * Math.pow(u, 1.5), e.y - r.oy - (br * 0.0065 * amp + hover) * r.oy, e.r * (s.ghost ? 2.5 : 1), e.color, e.a * p * (1 - (s.haze ?? 0) * 0.6));
    }
    g.restore();
  }

  /** Erase an overlay canvas where figures stand (scene flames behind them stay hidden). */
  maskFigures(g, t = 0) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (const a of this.actors) this._sprite(g, { ...a, ghost: false, r: { ...a.r, emit: [] } }, t);
    for (const o of this.ops) if (o.kind === 'sprite' && !o.ghost) this._sprite(g, { ...o, r: { ...o.r, emit: [] } }, t);
    g.restore();
  }

  /** Composite the panel at time t into g. */
  draw(g, t = 0) {
    const { W, H } = this;
    let TT = perfNow();
    const sync = (l) => { if (PERF) { g.getImageData(0, 0, 1, 1); perfLog(`draw ${l}`, TT); TT = perfNow(); } };
    sync('pre');
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);
    sync('bg');
    for (const a of this.actors) this._sprite(g, a, t);
    if (this.fg) g.drawImage(this.fg, 0, 0);
    sync('actors');
    for (const o of this.ops) {
      if (o.kind === 'fog') {
        // the band is static: paint it once on its own canvas (its noise erodes only the fog, never
        // the picture beneath) and keep a GPU copy, instead of uploading a noise pattern every frame
        if (!o.cv) {
          const hh = Math.ceil(o.h) + 2;
          const c = makeCanvas(W, hh);
          fogBand(c.getContext('2d'), W, hh / 2, o.h, o.color, o.a, o.seed);
          o.cv = gpuCopy(c);
        }
        g.drawImage(o.cv, 0, Math.round(o.y - (Math.ceil(o.h) + 2) / 2));
      } else this._sprite(g, o, t);
    }
    sync('ops');
    grade(g, W, H, { shadow: this.tone[0], highlight: this.tone[1], amount: 0.4 });
    sync('grade');
    vignette(g, W, H, 0.62);
    sync('vignette');
    grain(g, W, H, 0.07, this.seed % 97);
    sync('grain');
  }
}

/** Soft ground shadow cast by a sprite away from the key light, plus contact AO. */
function castShadow(g, r, x, y, h, keyDir, flip) {
  const sh = makeCanvas(r.canvas.width, r.canvas.height);
  const sg = sh.getContext('2d');
  sg.drawImage(r.canvas, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, sh.width, sh.height);
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  // project: flatten onto the ground and lean away from the light
  const lean = -(keyDir[0] / Math.max(0.25, keyDir[1])) * 0.35 * (flip ? -1 : 1);
  g.transform(1, 0, lean, -0.26, 0, 0);
  g.filter = `blur(${Math.max(2, h * 0.012).toFixed(1)}px)`;
  g.globalAlpha = 0.55;
  g.drawImage(sh, -r.ox, -r.oy);
  g.restore();
  // ambient occlusion where the figure meets the ground: a broad soft pool and a tight dark core
  contactShadow(g, x, y + h * 0.005, h * 0.22, h * 0.04, 0.65);
  contactShadow(g, x, y + h * 0.004, h * 0.1, h * 0.018, 0.85);
}

/**
 * Arrange up to 7 figures as a loose war-band: the leader forward and centre,
 * flankers a step back, a staggered second rank fading into the haze. Each is
 * an individual: its own pose, weapon, gear, tint, scale and facing.
 */
function placeGroup(comp, g, W, H, groups, info, light, seed, mood = null) {
  const hostile = mood === 'hostile';
  const calm = mood === 'calm';
  const flee = mood === 'flee';
  const list = [];
  for (const gr of groups) {
    const n = Math.max(1, Math.min(8, gr.count ?? 1));
    for (let i = 0; i < n; i++) list.push(gr.id);
  }
  const R = rngOf(seed + 5);
  // scattered: the street empties but for two stragglers running for the rubble
  const shown = list.slice(0, flee ? 2 : 7);
  const floor = info.floorY ?? H * 0.64;
  const L = LIGHTS[light] ?? LIGHTS.dusk;
  const hazeColor = info.sky?.fog ?? (light === 'green' ? '#0a2010' : '#1a1410');
  const biggest = Math.max(...shown.map((id) => creatureScale(id)));
  const human = Math.min(H * 0.6, (H * 0.7) / Math.max(1, biggest));
  const depth = (t) => floor + (H - floor) * t;
  const front = [[0.5, 0.95, 1.0, 0], [0.29, 0.8, 0.9, 0.05], [0.71, 0.82, 0.9, 0.05]];
  // the second rank stands in the gaps of the first, so no spear runs into a neighbour's snout
  const back = [[0.365, 0.42, 0.66, 0.3], [0.645, 0.45, 0.66, 0.3], [0.15, 0.5, 0.7, 0.26], [0.85, 0.5, 0.7, 0.26]];
  const n = shown.length;
  // a band of four or more is staged in depth like a painting: the leader centre-mid with a rim of
  // light, two brutes close in the foreground (cropped by the frame), a rank in the middle of the
  // street, one perched on a rubble heap against the sky, a straggler far back
  const staged = [[0.5, 0.56, 0.92, 0.04], [0.17, 1.13, 1.28, 0], [0.84, 1.09, 1.22, 0], [0.33, 0.44, 0.76, 0.14], [0.67, 0.4, 0.74, 0.16], [0.9, 0.1, 0.6, 0.28, 'perch'], [0.43, 0.16, 0.58, 0.34]];
  const slots = flee ? [[0.8, 0.16, 0.5, 0.45], [0.16, 0.24, 0.56, 0.38]] : n === 1 && shown[0] === 'tyranthraxus' ? [[0.5, 0.25, 0.6, 0]] : n === 1 && shown[0] === 'ghostKnight' ? [[0.5, 0.3, 0.82, 0]] : n === 1 ? [[0.5, 0.92, 1.05, 0]] : n === 2 ? [[0.4, 0.9, 1, 0], [0.62, 0.84, 0.95, 0.03]] : n >= 4 ? staged.slice(0, n) : [...front, ...back].slice(0, n);
  const items = shown.map((id, i) => ({ id, slot: slots[i], i }));
  items.sort((a, b) => a.slot[1] - b.slot[1]);
  let fogged = false;
  for (const it of items) {
    let [sx, t, sc, haze] = it.slot;
    if (calm) {
      // weapons lowered, they hang back a pace
      t = Math.max(0, t - 0.05);
      sc *= 0.96;
    }
    if (hostile) {
      // the band advances on the party: a step closer, drawing in toward the centre
      t = Math.min(1.02, t + 0.06 + (1 - t) * 0.12);
      sc *= 1.08;
      sx = 0.5 + (sx - 0.5) * 0.9;
      haze *= 0.6;
    }
    if (!fogged && t > 0.6 && items.some((o) => o.slot[1] < 0.6)) {
      comp.addFog(depth(0.5), H * 0.14, hazeColor, 0.3, seed % 13);
      fogged = true;
    }
    const x = W * (sx + (R() - 0.5) * 0.04);
    let y = depth(t) + (R() - 0.5) * H * 0.015;
    let hpx = human * sc * creatureScale(it.id) * (0.92 + R() * 0.16);
    hpx = Math.min(hpx, H * 0.95);
    const perch = it.slot[4] === 'perch' && !hostile;
    if (perch) {
      // a heap of fallen masonry: the lookout stands on it, dark against the sky
      const hh = H * 0.11;
      rubbleHeap(g, x, y, hpx * 1.5, hh, R, light);
      y -= hh * 0.82;
    }
    const fseed = seed + it.i * 13 + (it.id.length << 3);
    if (isSculpted(it.id)) {
      const rig = rigAt(light, info, x, y - hpx * 0.6, W);
      if (perch) {
        // silhouette: the key falls away, the sky rims him
        rig.key = { ...rig.key, i: rig.key.i * 0.35 };
        rig.rim = { ...rig.rim, i: rig.rim.i * 1.7, color: '#b8a8ff' };
        rig.amb = (rig.amb ?? 0.5) * 0.55;
      } else if (it.i === 0 && n >= 4) {
        // the leader: a rim of torchlight carves him out of the street
        rig.rim = { ...rig.rim, i: rig.rim.i * 1.6, color: '#ffb070' };
      }
      // turn toward the party: figures on the flanks face the centre, 3/4 on
      const toward = (0.5 - sx) * 1.6;
      const lead = it.i === 0 && n > 2;
      const jit = (R() - 0.5) * 0.5;
      let yaw = lead ? (jit < 0 ? -0.22 : 0.22) : Math.max(-0.95, Math.min(0.95, toward + jit + (Math.abs(toward) < 0.2 ? (R() < 0.5 ? -0.45 : 0.45) : 0)));
      // fleeing: backs to us, bent into the run, heads turned to look back over a shoulder
      if (flee) yaw = Math.PI + (sx > 0.5 ? -0.55 : 0.55);
      // an ambush, staged: the leader yaps an order with its jaw open, the two in front crouch
      // with weapons thrust at the party, one in the second rank flinches back from the light,
      // the rest come on low; the lookout on the rubble crouches to watch
      const ambush = !mood && n >= 4 && /^kobold|^goblin/.test(it.id) ? AMBUSH[it.i] : null;
      const amb = ambush ? { mood: ambush.hostile ? 'hostile' : null, poseOverride: { ...ambush.pose, ...(ambush.mirror ? { headYaw: (sx > 0.5 ? 1 : -1) * ambush.pose.headYaw } : {}) } } : null;
      const extra = flee ? { poseOverride: { weaponPose: 'low', offPose: 'fist', lean: 0.34, crouch: 0.18, twist: 0, headYaw: sx > 0.5 ? 0.7 : -0.7, headPitch: 0, headTilt: 0, stance: 0.12, footZ: [0.12, -0.14], sway: 0, hipTilt: 0 } } : calm ? { pose: 'low' } : amb ?? {};
      // the back ranks are small on screen: less supersampling there (most of a war-band's trace time)
      const r = renderCreature(it.id, hpx, rig, fseed, { yaw, haze, hazeColor, leader: lead && !calm, mood: calm || flee ? null : mood, ss: softwareGL() ? (hpx < 280 ? 1.25 : 1.5) : (hpx < 280 ? 1.5 : 2), ...extra });
      if (r && !r.sp.ghost) contactShadow(g, x, y + 2, hpx * 0.2, hpx * 0.035, 0.55);
      if (!r) continue;
      if (!r.sp.ghost) castShadow(g, r, x, y, hpx, rig.key.dir, false);
      comp.addSprite({ r, x, y, ph: R() * 6.28, period: 2.8 + R() * 1.4, amp: 0.8 + R() * 0.5, haze, ghost: !!r.sp.ghost, sway: r.sp.tail ? 1.2 : 1 });
      if (r.sp.ghost) glow(g, x, y - hpx * 0.5, hpx * 0.7, '#8ff0ff', 0.28, 'screen');
    } else {
      placeCreature(g, it.id, x, y, hpx, L, { haze, hazeColor, seed: fseed, flip: sx > 0.55 && R() < 0.6 });
    }
  }
  if (flee) droppedGear(g, W, H, floor, R);
  comp.addFog(H * 0.97, H * 0.12, hazeColor, 0.22, (seed + 3) % 13);
}

/** Per-slot ambush staging for a war-band of four or more (index = staged slot). */
const AMBUSH = [
  { pose: { snarl: 1, headPitch: -0.24, crouch: 0.3, lean: 0.14, stance: 0.11, footZ: [0.1, -0.1] } },
  { hostile: true, pose: { crouch: 0.48, lean: 0.3, stance: 0.13, footZ: [0.14, -0.12], snarl: 0.85, headPitch: -0.12 } },
  { hostile: true, pose: { crouch: 0.44, lean: 0.26, stance: 0.12, footZ: [-0.12, 0.13], snarl: 0.8, headPitch: -0.1 } },
  { mirror: true, pose: { weaponPose: 'guard', offPose: 'claw', crouch: 0.34, lean: -0.16, twist: 0.32, headYaw: 0.85, headPitch: 0.22, headTilt: 0.18, stance: 0.1, footZ: [-0.12, 0.06], snarl: 0.55 } },
  { hostile: true, pose: { crouch: 0.4, lean: 0.22, stance: 0.12, footZ: [0.1, -0.1], snarl: 0.6 } },
  { pose: { crouch: 0.36, lean: 0.2, headPitch: 0.06, stance: 0.1, footZ: [0.06, -0.06] } },
  null,
];

/** A heap of fallen masonry for a lookout to stand on (painted into the backdrop). */
function rubbleHeap(g, x, y, w, h, R, light) {
  const pts = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const bump = Math.sin(u * Math.PI);
    pts.push([x - w / 2 + u * w + (R() - 0.5) * w * 0.04, y - h * Math.pow(bump, 0.75) * (0.75 + R() * 0.4)]);
  }
  g.save();
  contactShadow(g, x, y + 2, w * 0.62, h * 0.18, 0.6);
  g.beginPath();
  g.moveTo(x - w / 2 - w * 0.08, y + h * 0.05);
  for (const [px, py] of pts) g.lineTo(px, py);
  g.lineTo(x + w / 2 + w * 0.08, y + h * 0.05);
  g.closePath();
  const gr = g.createLinearGradient(0, y - h, 0, y);
  const night = light === 'night' || light === 'dusk';
  gr.addColorStop(0, night ? '#3a3448' : '#5a5048');
  gr.addColorStop(1, night ? '#16121c' : '#2a2420');
  g.fillStyle = gr;
  g.fill();
  g.clip();
  // broken blocks and a snapped beam, lit along their tops
  for (let i = 0; i < 16; i++) {
    const bx = x - w / 2 + R() * w;
    const by = y - R() * h * 0.9;
    const bw = w * (0.06 + R() * 0.1);
    const bh = bw * (0.4 + R() * 0.3);
    g.save();
    g.translate(bx, by);
    g.rotate((R() - 0.5) * 0.6);
    g.fillStyle = night ? `rgba(${70 + R() * 30},${62 + R() * 20},${80 + R() * 30},0.9)` : `rgba(${110 + R() * 40},${96 + R() * 30},${80 + R() * 20},0.9)`;
    g.fillRect(-bw / 2, -bh / 2, bw, bh);
    g.fillStyle = night ? 'rgba(170,160,220,0.25)' : 'rgba(255,230,190,0.25)';
    g.fillRect(-bw / 2, -bh / 2, bw, bh * 0.22);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-bw / 2, bh * 0.3, bw, bh * 0.2);
    g.restore();
  }
  g.strokeStyle = '#2a1c12';
  g.lineWidth = Math.max(2, w * 0.03);
  g.beginPath();
  g.moveTo(x - w * 0.42, y - h * 0.2);
  g.lineTo(x + w * 0.1, y - h * 0.95);
  g.stroke();
  g.restore();
}

/** What a scattered war-band leaves behind: a dropped spear, a kicked-over pot, scuffed dust. */
function droppedGear(g, W, H, floor, R) {
  const y = floor + (H - floor) * 0.72;
  const x = W * 0.47;
  g.save();
  contactShadow(g, x, y + 4, W * 0.11, 6, 0.5);
  // the spear lies at a slant across the street
  g.translate(x, y);
  g.rotate(-0.12);
  const sg = g.createLinearGradient(0, -4, 0, 4);
  sg.addColorStop(0, '#9a7448'); sg.addColorStop(0.5, '#6a4a2a'); sg.addColorStop(1, '#2a1a0e');
  g.fillStyle = sg;
  g.fillRect(-W * 0.12, -3, W * 0.22, 6);
  g.fillStyle = '#3a2a1a';
  for (let i = 0; i < 3; i++) g.fillRect(W * 0.07 + i * 5, -4, 2, 8); // binding
  g.beginPath(); g.moveTo(W * 0.1, -6); g.lineTo(W * 0.15, 0); g.lineTo(W * 0.1, 6); g.closePath();
  const ig = g.createLinearGradient(W * 0.1, -6, W * 0.1, 6);
  ig.addColorStop(0, '#c8ccd0'); ig.addColorStop(1, '#4a4c54');
  g.fillStyle = ig; g.fill();
  g.restore();
  // scuffed dust where they broke and ran
  for (let i = 0; i < 26; i++) {
    const dx = W * (0.25 + R() * 0.5); const dy = floor + (H - floor) * (0.2 + R() * 0.6);
    glowEllipse(g, dx, dy, 18 + R() * 30, 5 + R() * 6, '#b8a080', 0.06, 'screen');
  }
}

// ------------------------------------------------------------------ NPC actors

const HAIR_STYLE = { short: 'short', swept: 'short', crop: 'short', topknot: 'short', long: 'long', wavy: 'long', braid: 'braid', bun: 'bun', bob: 'fringe', bald: 'bald', hood: 'short' };

/**
 * An NPC drawn standing in a setting's actor slot, dressed from the same look
 * as their portrait (skin, hair, beard, clothing colour and body).
 * @returns {{render:(slot:object, rig:object)=>object}|null}
 */
/** The buildNpc() spec of a named NPC: one rig, outfit and palette for both the scene figure and the portrait. */
export function npcFigureSpec(npc, pose) {
  const ch = { race: npc.race ?? 'human', gender: npc.gender ?? 'male', look: npc.look ?? {}, name: npc.name };
  const look = defaultLook(ch);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const tpl = HEADS[gender][look.head] ?? HEADS[gender][0];
  const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
  const F = npc.figure ?? {};
  return {
    seed: look.seed, race: ch.race, gender, age: F.age ?? (tpl.age ? 0.5 * tpl.age : 0), build: F.build ?? 1, belly: F.belly,
    skin: F.skin ?? SKIN_TONES[skins[look.skin % skins.length]],
    hair: F.hair ?? HAIR_COLORS[look.hair % HAIR_COLORS.length][1],
    eyeC: EYE_COLORS[look.eyes % EYE_COLORS.length],
    hairStyle: F.hairStyle ?? HAIR_STYLE[tpl.hair] ?? 'short',
    beard: F.beard ?? tpl.beard ?? 'none',
    pose: pose ?? F.pose ?? 'idle', outfit: F.outfit, headYaw: F.headYaw, nose: F.nose, jaw: F.jaw, smile: F.smile, lipC: F.lipC,
  };
}

const PAINT_HAIR = { bald: 'none', short: 'short', fringe: 'short', long: 'wavy', braid: 'wavy', bun: 'bun', tonsure: 'tonsure', topknot: 'topknot' };
const PAINT_COSTUME = { robe: 'robe', bodice: 'bodice', doublet: 'tunic', jerkin: 'tunic', tabard: 'tabard', chain: 'mail' };

/**
 * The painted-portrait design of an NPC: its own `paint` block if it has one (a designed
 * character), otherwise derived from the figure spec so every townsperson gets a painted bust
 * in the same hand, dressed like their figure in the scene.
 */
export function portraitDesign(npc) {
  const sp = npcFigureSpec(npc);
  const F = npc.figure ?? {};
  const O = F.outfit ?? {};
  const R = rngOf(hashStr(npc.id, 'face'));
  const small = ['dwarf', 'halfling', 'gnome'].includes(sp.race);
  const fem = sp.gender === 'female';
  const base = {
    seed: hashStr(npc.id) % 100000,
    sex: fem ? 'f' : 'm',
    age: Math.min(0.85, (sp.age ?? 0) * 1.1 + (fem ? 0.1 : 0.25)),
    skin: sp.skin,
    yaw: (R() < 0.5 ? -1 : 1) * (0.18 + R() * 0.14),
    gaze: [(R() - 0.5) * 0.2, 0],
    face: { w: small ? 1.1 : 0.95 + R() * 0.12, jaw: fem ? 0.9 : 0.95 + R() * 0.3, cheek: 0.9 + R() * 0.3, brow: fem ? 0.8 : 1 + R() * 0.4, neck: small ? 1.2 : 1 },
    nose: { len: small ? 1.1 : 0.9 + R() * 0.25, w: small ? 1.25 : 0.9 + R() * 0.3, tip: small ? 1.25 : 1, hook: R() < 0.2 ? 0.6 : 0 },
    eyes: { c: sp.eyeC, size: 0.95 + R() * 0.1, lid: R() * 0.5 },
    mouth: { w: 0.95 + R() * 0.1, full: fem ? 1.1 : 0.8, smile: sp.smile ?? 0.1, c: sp.lipC },
    brows: { c: sp.hair, w: fem ? 0.8 : 1.1 },
    hair: { style: PAINT_HAIR[sp.hairStyle] ?? 'short', c: sp.hair },
    beard: { style: sp.beard ?? 'none', c: sp.hair },
    head: O.hood ? { kind: 'hood', c: O.hood } : null,
    costume: { kind: O.stole ? 'priest' : PAINT_COSTUME[O.topKind] ?? 'tunic', a: O.top ?? O.shirt ?? '#4a4038', b: O.shirt ?? '#d8ccb0', collar: O.collar, stole: O.stole, symbol: O.symbol, cloak: O.mantle, apron: O.apron },
    spectacles: !!O.spectacles,
    aura: npc.aura,
    bg: ['#4e3e2a', '#0c0806'],
    dark: npc.kind === 'hooded' ? 0.45 : 0,
  };
  if (!npc.paint) return base;
  // a designed portrait keeps its face, but its palette comes from the one costume record the scene
  // figure is dressed from: hair, beard, skin, robe, collar, stole and mitre can never disagree
  const D = { ...base, seed: base.seed, ...npc.paint };
  if (npc.figure) {
    const hairC = F.hair ?? D.hair?.c;
    if (F.skin) D.skin = F.skin;
    if (D.hair && hairC) D.hair = { ...D.hair, c: hairC };
    if (D.beard && D.beard.style !== 'none' && hairC) D.beard = { ...D.beard, c: F.beardC ?? hairC, style: F.beard ?? D.beard.style };
    if (D.costume) {
      D.costume = { ...D.costume };
      if (O.top && D.costume.kind !== 'mail' && D.costume.kind !== 'smith') D.costume.a = O.top;
      if (O.shirt && D.costume.b) D.costume.b = O.shirt;
      if (O.collar && D.costume.collar) D.costume.collar = O.collar;
      if (O.stole && D.costume.stole) D.costume.stole = O.stole;
      if (O.mantle && D.costume.cloak) D.costume.cloak = O.mantle;
      if (O.apron && D.costume.apron) D.costume.apron = O.apron;
    }
    if (D.head?.kind === 'mitre' && O.mitre) D.head = { ...D.head, mitre: O.mitre };
  }
  return D;
}

/**
 * Head-and-shoulders portrait rendered from the very figure that stands in the scene
 * (same sculpted head, hair, beard, spectacles, outfit and palette), lit like a
 * painting: a warm key from the upper left, the NPC's aura as a rim, a brushed backdrop.
 */
function figureBust(npc, W, H) {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const aura = npc.aura ?? '#ffcf8a';
  const R = rngOf(hashStr(npc.id));
  // backdrop: dark umber field, a warm pool of light behind the head, loose brush strokes
  const bg = g.createRadialGradient(W * 0.42, H * 0.34, 8, W * 0.5, H * 0.5, H * 0.85);
  bg.addColorStop(0, '#5a4430');
  bg.addColorStop(0.45, '#2a1e16');
  bg.addColorStop(1, '#0a0705');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.07;
  for (let i = 0; i < 140; i++) {
    const x = R() * W; const y = R() * H; const a = -0.9 + R() * 0.5; const l = 20 + R() * 60;
    g.strokeStyle = R() < 0.5 ? '#c89a6a' : '#140c08';
    g.lineWidth = 3 + R() * 7;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.restore();
  glow(g, W * 0.5, H * 0.32, H * 0.42, aura, 0.18);
  const F = npc.figure ?? {};
  const bn = buildNpc(npcFigureSpec(npc, F.portraitPose ?? F.pose ?? 'idle'));
  const headY = bn.top - 0.1; // head centre, figure units
  const ppu = H * (F.portraitZoom ?? 3.1);
  const rig = { key: { dir: [-0.6, 0.5, 0.7], color: '#ffe2bc', i: 1.5 }, rim: { dir: [0.75, 0.35, -0.55], color: aura, i: 1.2 }, sky: '#5a5060', ground: '#2a1c12', amb: 0.44 };
  const span = (W * 0.62) / ppu;
  const r = renderFigure(bn.fig, { ppu, ss: 1.25, yaw: F.portraitYaw ?? 0.28, rig, pitch: 0.04, ink: 0.55, minY: headY - (H * 0.62) / ppu, minX: -span, maxX: span });
  if (r) {
    const x = W * 0.5 - r.ox;
    const y = H * 0.4 - (r.oy - headY * ppu);
    // soft cast shadow on the backdrop, then the figure
    g.save();
    g.filter = 'blur(14px)';
    g.globalAlpha = 0.45;
    g.globalCompositeOperation = 'multiply';
    g.drawImage(r.canvas, x + W * 0.05, y + H * 0.02);
    g.restore();
    g.drawImage(r.canvas, x, y);
  }
  // painterly finish: warm glaze, a breath of grain, and a vignette that holds the face
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.35;
  g.fillStyle = '#c08040';
  g.fillRect(0, 0, W, H);
  g.restore();
  vignette(g, W, H, 0.55);
  return c;
}

/** Paint the NPC's portrait features (eyes, brows, nostrils, lips) onto its rendered scene figure. */
function faceDecal(npc, r, head, cam) {
  const D = portraitDesign(npc);
  const V = mul3(rotX(cam.pitch), rotY(cam.yaw));
  const Fl = [1, 0, 0, 0, -1, 0, 0, 0, 1];
  const toFig = (p) => {
    // portrait head units (y down, eyes at the equator) → sculpted head units (y up) → figure space
    const a = [p[0] * 0.88, -p[1] * 0.63 + 0.03, p[2] * 0.92];
    const w = ap3(head.R, a);
    return [head.c[0] + w[0] * head.r, head.c[1] + w[1] * head.r, head.c[2] + w[2] * head.r];
  };
  const P = (p) => { const v = ap3(V, toFig(p)); return [r.ox + v[0] * r.ppu, r.oy - v[1] * r.ppu, v[2]]; };
  const HR = mul3(Fl, mul3(V, mul3(head.R, Fl)));
  // the face must point at us at least partly for the features to read
  if (HR[8] < 0.35) return;
  paintFaceDecal(r.canvas.getContext('2d'), D, { P, U: 0.88 * head.r * r.ppu, HR });
}

export function npcActor(npc, o = {}) {
  if (!npc || (npc.kind && npc.kind !== 'portrait' && npc.kind !== 'hooded')) return null;
  return {
    render(slot, rig) {
      const ch = { race: npc.race ?? 'human', gender: npc.gender ?? 'male', look: npc.look ?? {}, name: npc.name };
      const look = defaultLook(ch);
      const gender = ch.gender === 'female' ? 'female' : 'male';
      const tpl = HEADS[gender][look.head] ?? HEADS[gender][0];
      const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
      if (npc.figure) {
        const F = npc.figure;
        // the NPC's own signature pose wins over a setting's generic slot pose ('stand', 'priest')
        const generic = { stand: 'idle', priest: 'bless' }[slot.pose ?? o.pose];
        const pose = generic ? F.pose ?? generic : slot.pose ?? o.pose ?? F.pose ?? 'idle';
        const bn = buildNpc(npcFigureSpec(npc, o.poseOverride ?? pose));
        // cropped at the floor: a floor-length hem's rounded cap never shows below the feet
        const r = renderFigure(bn.fig, { ppu: slot.h / bn.top * (ch.race === 'dwarf' || ch.race === 'halfling' || ch.race === 'gnome' ? 0.8 : 1), yaw: slot.yaw ?? 0, rig, pitch: slot.pitch ?? 0.1, ink: 0.7, minY: -0.03, ...(slot.ss ? { ss: slot.ss } : {}) });
        if (r && bn.head && npc.kind !== 'hooded' && !o.noDecal) faceDecal(npc, r, bn.head, { yaw: slot.yaw ?? 0, pitch: slot.pitch ?? 0.1 });
        return r;
      }
      const b = buildPerson({
        seed: look.seed, race: ch.race, gender,
        skin: SKIN_TONES[skins[look.skin % skins.length]],
        hair: HAIR_COLORS[look.hair % HAIR_COLORS.length][1],
        eyeC: EYE_COLORS[look.eyes % EYE_COLORS.length],
        cloth: CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1],
        body: BODIES[look.body % BODIES.length].id,
        hairStyle: npc.kind === 'hooded' || tpl.hair === 'hood' ? 'short' : HAIR_STYLE[tpl.hair] ?? 'short',
        hood: npc.kind === 'hooded' || tpl.hair === 'hood' ? CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1] : null,
        beard: tpl.beard ?? 'none',
        pose: slot.pose ?? o.pose ?? 'stand',
        apron: slot.apron ?? false,
        vestments: slot.vestments ?? null,
        build: slot.build ?? 1,
        hunch: tpl.age ? 0.08 * tpl.age : 0,
      });
      const r = renderFigure(b.fig, { ppu: slot.h / b.fig.top * (b.sp.legs < 0.45 ? 0.8 : 1), yaw: slot.yaw ?? 0, rig, pitch: slot.pitch ?? 0.1, ink: 0.8 });
      return r;
    },
  };
}

const GHOST_POSES = {
  // kneeling in vigil before the altar, both hands on the pommel of the reversed sword
  // (the head turns a little out of the body's line, so the hounskull's beak shows in profile)
  vigil: { kneel: 1, weaponPose: 'vigil', offPose: null, crouch: 0.42, lean: 0.1, twist: 0, headYaw: -0.62, headPitch: 0.3, headTilt: 0.04, stance: 0.07, sway: 0, hipTilt: 0 },
  // risen and turned to face the living, the sword still reversed before him
  stand: { weaponPose: 'rest', offPose: null, crouch: 0, lean: -0.02, twist: -0.12, headYaw: -0.42, headPitch: -0.04, headTilt: 0, stance: 0.09, sway: 0, hipTilt: 0.02 },
  // roused to anger: the blade comes up
  wrath: { weaponPose: 'raised', offPose: 'point', crouch: 0.08, lean: 0.08, twist: -0.3, headYaw: 0.1, headPitch: -0.08, headTilt: 0, stance: 0.1, sway: 0, hipTilt: 0 },
};

/**
 * Ferran Martinez: a knight in antique plate — a ghost. Rendered solid, then
 * made spectral in 2D: a cold fog body that veils what lies behind him (so the
 * altar never draws through), the knight's own shading gradient-mapped into
 * moonlit cyan, a Fresnel rim from the silhouette's edge, drifting internal mist
 * and legs that dissolve into vapour.
 * @param {'vigil'|'stand'|'wrath'} [pose]
 */
export function ghostActor(pose = 'vigil') {
  return {
    ghost: true,
    render(slot, rig) {
      const P = GHOST_POSES[pose] ?? GHOST_POSES.vigil;
      // at vigil he kneels with his back three-quarters to us, facing the altar; risen, he stands
      // aside from the east window, turned three-quarters toward the living
      const yaw = pose === 'vigil' ? slot.vigilYaw ?? 2.55 : -0.55;
      const h = pose === 'vigil' ? slot.h : slot.h * 1.42;
      // (the spectral wash softens everything: 1.4x supersampling is plenty, and halves the trace)
      const r = renderCreature('ghostKnight', h, { ...rig, key: { dir: [-0.3, 0.8, 0.5], color: '#e8fbff', i: 1.25 }, rim: { dir: [0.7, 0.4, -0.6], color: '#e0ffff', i: 1.4 }, sky: '#6aa8c0', ground: '#0a1a20', amb: 0.62 }, 7, { yaw, poseOverride: P, solid: true, ink: 0.9, ss: 1.4 });
      if (!r) return null;
      // emit points are relative to the figure render; carry them onto the flattened sprite
      const fl = flattenSprite(r);
      const sp = spectral(fl, (r.emit ?? []).map((e) => ({ ...e, x: e.x + fl.ox - r.ox, y: e.y + fl.oy - r.oy })));
      // risen, he stands before the altar, framed by its candle-glow and the east window
      if (pose !== 'vigil') sp.dx = slot.altar ? (slot.altar[0] - slot.x) * 0.8 : slot.h * 0.42;
      return sp;
    },
  };
}

/** Turn a solid figure sprite into a ghost (see ghostActor). */
function spectral(f, emit = []) {
  const { canvas: src, ox, oy } = f;
  const pad = 40;
  const W = src.width + pad * 2;
  const H = src.height + pad * 2;
  const mask = (blur = 0, color = '#fff') => {
    const m = makeCanvas(W, H);
    const mg = m.getContext('2d');
    if (blur) mg.filter = `blur(${blur}px)`;
    mg.drawImage(src, pad, pad);
    mg.filter = 'none';
    mg.globalCompositeOperation = 'source-in';
    mg.fillStyle = color;
    mg.fillRect(0, 0, W, H);
    return m;
  };
  const out = makeCanvas(W, H);
  const g = out.getContext('2d');
  const R = rngOf(77);
  // 1. the veil: a deep teal body of fog that hides what lies behind him, soft at its edges
  g.globalAlpha = 0.45;
  g.drawImage(mask(8, '#0a2a34'), 0, 0);
  g.globalAlpha = 1;
  // 2. the knight's own light and shade mapped into cold cyan: lit plates hold, shadowed ones go
  //    glassy; everything thins toward the floor
  // the core map: the silhouette blurred wide (1 deep inside the torso, falling off to the limbs)
  const coreC = mask(Math.max(6, Math.round(src.height * 0.06)));
  const coreD = coreC.getContext('2d').getImageData(0, 0, W, H).data;
  const coreA = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) coreA[i] = Math.min(255, coreD[i * 4 + 3] * 1.35);
  const body = makeCanvas(W, H);
  const bg = body.getContext('2d');
  bg.filter = 'blur(0.6px)';
  bg.drawImage(src, pad, pad);
  bg.filter = 'none';
  const img = bg.getImageData(0, 0, W, H);
  const d = img.data;
  const stops = [[0, [4, 20, 32]], [0.3, [18, 74, 96]], [0.58, [80, 176, 204]], [0.82, [176, 240, 252]], [1, [240, 255, 255]]];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const a = d[i + 3] / 255;
    let l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255 / Math.max(0.01, a);
    l = Math.min(1, Math.pow(l, 0.9) * 1.1);
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < l) k++;
    const [t0, c0] = stops[k - 1];
    const [t1, c1] = stops[k];
    const u = Math.max(0, Math.min(1, (l - t0) / (t1 - t0)));
    const y = Math.floor(i / 4 / W);
    const x = (i / 4) % W;
    const fy = (y - pad) / Math.max(1, oy);
    // the hem dissolves: a noisy threshold eats the lowest fifth of him
    const nz = Math.sin(x * 0.21 + y * 0.07) * 0.5 + Math.sin(x * 0.053 - y * 0.19) * 0.5;
    const fade = Math.min(1, Math.max(0.03, (1 - fy) * 3.4 + 0.05 + nz * 0.18));
    // dense at the core, glassy at the extremities
    const core = coreA[y * W + x] / 255;
    d[i] = (c0[0] + (c1[0] - c0[0]) * u) * a;
    d[i + 1] = (c0[1] + (c1[1] - c0[1]) * u) * a;
    d[i + 2] = (c0[2] + (c1[2] - c0[2]) * u) * a;
    d[i + 3] = 255 * a * (0.12 + l * l * 0.56) * fade * (0.42 + 0.58 * core * core);
  }
  bg.putImageData(img, 0, 0);
  g.drawImage(body, 0, 0);
  // 3. internal fog: slow billows of light drifting inside the body, denser low down
  const mist = makeCanvas(W, H);
  const mg = mist.getContext('2d');
  mg.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++) {
    const x = R() * W;
    const y = pad + Math.pow(R(), 0.7) * (H - pad);
    const rr = W * (0.04 + R() * 0.1);
    const gr = mg.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(160,236,255,0.13)');
    gr.addColorStop(1, 'rgba(160,236,255,0)');
    mg.fillStyle = gr;
    mg.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  mg.globalCompositeOperation = 'destination-in';
  mg.drawImage(mask(4), 0, 0);
  g.globalCompositeOperation = 'lighter';
  g.drawImage(mist, 0, 0);
  // 4. Fresnel rim: the silhouette's edge glows softly (mask minus its blurred self), no hard lines
  const rim = mask(0, '#bff8ff');
  const rg = rim.getContext('2d');
  rg.globalCompositeOperation = 'destination-out';
  rg.filter = 'blur(5px)';
  rg.drawImage(mask(0), 0, 0);
  rg.filter = 'none';
  g.globalAlpha = 0.85;
  g.drawImage(rim, 0, 0);
  g.filter = 'blur(10px)';
  g.globalAlpha = 0.45;
  g.drawImage(rim, 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  // 5. wisps: ectoplasm streaming off the lower edges (hem, cape, the dissolving legs), curling as it rises
  const sw = src.width; const sh = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const wisp = makeCanvas(W, H);
  const wg = wisp.getContext('2d');
  wg.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const x = Math.floor(R() * sw);
    // the lowest solid pixel in this column (from the hem up to the waist)
    let yb = -1;
    for (let y = sh - 1; y > sh * 0.35; y--) if (sd[(y * sw + x) * 4 + 3] > 80) { yb = y; break; }
    if (yb < 0) continue;
    const x0 = x + pad; const y0 = yb + pad;
    const len = sh * (0.08 + R() * 0.2);
    const dir = (x - sw / 2) / sw;
    const c1 = [x0 + dir * len * 0.8 + (R() - 0.5) * len * 0.5, y0 - len * 0.35];
    const c2 = [x0 + dir * len * 1.4 + (R() - 0.5) * len * 0.6, y0 - len * 0.85];
    const e = [x0 + dir * len * 1.6 + (R() - 0.5) * len * 0.8, y0 - len * (1.1 + R() * 0.4)];
    const gr = wg.createLinearGradient(x0, y0, e[0], e[1]);
    gr.addColorStop(0, 'rgba(170,240,255,0.35)');
    gr.addColorStop(1, 'rgba(170,240,255,0)');
    wg.strokeStyle = gr;
    wg.lineWidth = 2 + R() * sw * 0.025;
    wg.beginPath(); wg.moveTo(x0, y0); wg.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]); wg.stroke();
  }
  // a trail of ectoplasm lying along the floor behind him, thinning as it drifts away
  for (let k = 0; k < 26; k++) {
    const t = k / 25;
    const mx = W / 2 + (t - 0.35) * sw * 0.95 + Math.sin(k * 2.3) * sw * 0.05;
    const my = oy + pad - sh * 0.015 - Math.sin(k * 1.7) * sh * 0.012;
    const rr = sw * (0.16 - t * 0.08) * (0.8 + ((k * 37) % 10) / 25);
    const gr = wg.createRadialGradient(mx, my, 0, mx, my, rr);
    gr.addColorStop(0, `rgba(160,236,255,${(0.22 * (1 - t * 0.7)).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(160,236,255,0)');
    wg.fillStyle = gr;
    wg.save(); wg.translate(mx, my); wg.scale(1, 0.32); wg.translate(-mx, -my);
    wg.fillRect(mx - rr, my - rr, rr * 2, rr * 2);
    wg.restore();
  }
  // a pooled mist where he meets the floor
  const fl = wg.createRadialGradient(W / 2, oy + pad, 0, W / 2, oy + pad, sw * 0.6);
  fl.addColorStop(0, 'rgba(150,230,255,0.28)');
  fl.addColorStop(1, 'rgba(150,230,255,0)');
  wg.fillStyle = fl;
  wg.save(); wg.translate(0, oy + pad); wg.scale(1, 0.25); wg.translate(0, -(oy + pad)); wg.fillRect(0, 0, W, H * 2); wg.restore();
  g.filter = 'blur(3px)';
  g.drawImage(wisp, 0, 0);
  g.filter = 'none';
  // 6. an aura of cold light around him
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = 0.32;
  g.filter = 'blur(22px)';
  g.drawImage(mask(0, '#5ad8f0'), 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return { canvas: out, ox: ox + pad, oy: oy + pad, emit: emit.map((e) => ({ ...e, x: e.x + pad, y: e.y + pad })), spectral: true };
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
  const T0 = perfNow();
  const c = paintNpcPortraitIn(npc, scale);
  perfLog(`portrait ${npc.id}`, T0);
  portraitCache.set(key, c);
  return c;
}

function paintNpcPortraitIn(npc, scale) {
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
  } else if (npc.kind === 'monster' && isSculpted(npc.id === 'kobold_chief' ? 'koboldChief' : npc.monster)) {
    c = sculptBust(npc.id === 'kobold_chief' ? 'koboldChief' : npc.monster, W, H, { bg: ['#4a2a18', '#0a0604'], light: '#ffb070', seed: 11, yaw: 0.35, zoom: 1.75, pitch: -0.05, pose: { weaponPose: 'low', headYaw: 0.15, headPitch: -0.15, twist: 0.05, lean: 0, headTilt: 0.08 } });
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
    const fh = H * 3.2;
    const fig = paintCreature(id, fh, LIGHTS.torch, 3);
    // crop to head & shoulders (small humanoids carry their head at ~0.8 of their height)
    g.drawImage(fig.canvas, W / 2 - fig.ox, H * 0.46 + fh * 0.79 - fig.oy);
    vignette(g, W, H, 0.55);
  } else if (npc.paint || (npc.figure && (!npc.kind || npc.kind === 'portrait' || npc.kind === 'hooded'))) {
    // a raymarched bust (hair, beard and headgear are volumes in the same field), painted over;
    // the 2D oil sketch remains the fallback without WebGL2
    c = paintPortraitGL(portraitDesign(npc), W, H, { race: npc.race, aura: npc.aura });
    if (!c) {
      const big = paintPortraitDesign(portraitDesign(npc), W * 2, H * 2);
      c = makeCanvas(W, H);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(big, 0, 0, W, H);
    }
  } else {
    const ch = { race: npc.race ?? 'human', gender: npc.gender ?? 'male', look: npc.look ?? {}, name: npc.name };
    if (npc.kind === 'hooded') ch.look = { ...ch.look, head: 6 };
    if (npc.kind === 'ghost') {
      // raymarched armet and plate (the same field as the living portraits), then washed spectral
      // the very knight of the chapel (hounskull, plate and all) at bust scale, washed spectral;
      // the raymarched armet remains the fallback
      const fb = ferranBust(W, H);
      const gl = fb ? null : paintPortraitGL(FERRAN_DESIGN, W, H, { race: 'human', aura: '#8ff0ff' });
      c = fb ?? (gl ? spectralPortrait(gl) : null) ?? (npc.paintGhost !== false ? (() => { const big = paintGhostKnight(W * 2, H * 2); const cc = makeCanvas(W, H); cc.getContext('2d').drawImage(big, 0, 0, W, H); return cc; })() : ghostBust(W, H));
    } else c = paintPortrait(ch, { scale });
    if (npc.kind === 'ghost') {
      // the same spectral knight that kneels in the chapel, helm and all
    } else if (npc.kind === 'hooded') {
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 0, c.width, c.height);
      if (npc.aura) glow(g, c.width / 2, c.height * 0.44, c.height * 0.25, npc.aura, 0.12);
    }
  }
  return c;
}

/**
 * Ferran's portrait from his scene figure: head and shoulders turned three-quarters so the
 * hounskull's beak stands in profile, rim-lit hard from behind so every plate edge burns, then
 * gradient-mapped night -> cyan -> white (the eye slit and the visor's point are the brightest
 * things in the frame), bloomed, and dissolving into mist below the gorget.
 */
function ferranBust(W0, H0) {
  let W = W0; let H = H0;
  const b = buildCreature('ghostKnight', 7, { poseOverride: { ...GHOST_POSES.stand, headYaw: -0.4, headPitch: 0.1, twist: 0.05, weaponPose: 'rest' } });
  if (!b) return null;
  // traced at 3/4 of the frame and enlarged (the wash and bloom hide the upscale; the knight's
  // dense plate costs seconds per megapixel under a software GPU)
  const k = 0.72;
  const hpx = H * 2.45 * k;
  const ppu = hpx / b.fig.top;
  W *= k; H *= k;
  const rig = { key: { dir: [-0.45, 0.65, 0.55], color: '#d8f6ff', i: 1.05 }, rim: { dir: [0.85, 0.3, -0.45], color: '#ffffff', i: 2.2 }, fill: { dir: [-0.8, -0.2, -0.3], color: '#7ad8f0', i: 0.5 }, sky: '#3a7488', ground: '#06121a', amb: 0.36 };
  // traced only inside the frame (the portrait shows at ~130 css px: no supersampling needed)
  const r = renderFigure(b.fig, { ppu, yaw: -0.7, rig, pitch: 0.05, ink: 0.4, ss: 1, minY: b.fig.top - (H * 1.02) / ppu, minX: -(W * 0.56) / ppu, maxX: (W * 0.48) / ppu });
  if (!r) return null;
  W /= k; H /= k;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(W * 0.48, H * 0.34, 6, W * 0.5, H * 0.5, H * 0.8);
  bg.addColorStop(0, '#1e3c46');
  bg.addColorStop(0.55, '#08161c');
  bg.addColorStop(1, '#010305');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const x = W * 0.54 - r.ox / k;
  const y = H * 0.11 - (r.oy - b.fig.top * ppu) / k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(r.canvas, x, y, r.canvas.width / k, r.canvas.height / k);
  const out = ghostly(c);
  const og = out.getContext('2d');
  // the eyes and the wound burn over the wash
  for (const e of r.emit ?? []) glow(og, x + e.x / k, y + e.y / k, (e.r / k) * 1.4, e.color, Math.min(1, e.a * 1.1));
  // the lower edge dissolves: a cold mist over the breastplate's foot
  const mist = og.createLinearGradient(0, H * 0.7, 0, H);
  mist.addColorStop(0, 'rgba(6,20,26,0)');
  mist.addColorStop(1, 'rgba(6,20,26,0.75)');
  og.fillStyle = mist;
  og.fillRect(0, 0, W, H);
  vignette(og, W, H, 0.45);
  return out;
}

/** Ferran in his armet: a bust design for the raymarched portrait painter. */
const FERRAN_DESIGN = {
  seed: 9101, sex: 'm', age: 0.45, skin: '#c8a088', yaw: -0.3, gaze: [0, 0],
  face: { w: 1, jaw: 1.1, cheek: 1, brow: 1.2, neck: 1.1 }, eyes: { c: '#9ae8ff', size: 1, lid: 0.35 },
  hair: { style: 'none' }, beard: { style: 'none' },
  head: { kind: 'helm' }, costume: { kind: 'plate' }, ghost: true,
  aura: '#8ff0ff', bg: ['#10303a', '#010305'],
};

/**
 * The spectral wash for Ferran's rendered bust: luminance mapped from night through cyan to
 * white (so the lit plate edges burn and the shadows are glass), a bloom on the bright planes,
 * a cold mist welling up from below and drifting tendrils.
 */
function spectralPortrait(src) {
  const W = src.width;
  const H = src.height;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  // bloom: the burning edges, eyes and wound spill light
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(5px)';
  g.globalAlpha = 0.45;
  g.drawImage(src, 0, 0);
  g.filter = 'blur(16px)';
  g.globalAlpha = 0.3;
  g.drawImage(src, 0, 0);
  g.restore();
  // the lower body dissolves into mist: fade toward the background colour with noise
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const fy = y / H;
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.045 + y * 0.013) * 0.5 + Math.sin(x * 0.11 - y * 0.05 + 1.7) * 0.3 + Math.sin((x + y) * 0.021) * 0.2;
      const k = Math.max(0, Math.min(1, (fy - 0.62 + n * 0.08) / 0.38));
      const i = (y * W + x) * 4;
      d[i] = d[i] * (1 - k * 0.75) + 10 * k;
      d[i + 1] = d[i + 1] * (1 - k * 0.7) + 40 * k;
      d[i + 2] = d[i + 2] * (1 - k * 0.68) + 52 * k;
    }
  }
  g.putImageData(img, 0, 0);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(150,240,255,0.10)';
  for (let i = 0; i < 9; i++) {
    g.lineWidth = 2 + (i % 3) * 2;
    g.beginPath();
    const x0 = W * (0.1 + i * 0.1);
    g.moveTo(x0, H);
    g.bezierCurveTo(x0 + Math.sin(i * 2.1) * W * 0.12, H * 0.82, x0 - Math.cos(i * 1.3) * W * 0.1, H * 0.7, x0 + Math.sin(i) * W * 0.06, H * (0.55 + (i % 4) * 0.04));
    g.stroke();
  }
  g.restore();
  return c;
}

/** Ferran's portrait: the chapel's spectral knight, risen, head and shoulders. */
function ghostBust(W, H) {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(W * 0.5, H * 0.38, 6, W * 0.5, H * 0.5, H * 0.8);
  bg.addColorStop(0, '#1e4450');
  bg.addColorStop(0.5, '#0a1c24');
  bg.addColorStop(1, '#02070a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  glow(g, W * 0.5, H * 0.36, H * 0.4, '#8ff0ff', 0.2);
  // rendered at a modest size and enlarged: the spectral blur hides the upscale, and a full
  // figure at bust scale would cost seconds
  const zoom = 3.3;
  const up = 3;
  const r = ghostActor('stand').render({ h: H * zoom / 1.42 / up }, {});
  if (r) {
    const top = r.oy - (H * zoom * 0.97) / up; // helm crest, sprite px
    const x = W * 0.5 - r.ox * up + W * 0.02;
    const y = H * 0.07 - top * up;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.9;
    g.drawImage(r.canvas, x, y, r.canvas.width * up, r.canvas.height * up);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  const mist = g.createLinearGradient(0, H * 0.6, 0, H);
  mist.addColorStop(0, 'rgba(160,240,255,0)');
  mist.addColorStop(1, 'rgba(160,240,255,0.25)');
  g.fillStyle = mist;
  g.fillRect(0, 0, W, H);
  vignette(g, W, H, 0.5);
  return c;
}

/**
 * Spectral treatment for a painted portrait: a gradient map from deep night
 * through cyan to white keeps every brushstroke of the face, then the lit
 * edges glow and a faint chill mist rises from below.
 */
function ghostly(src) {
  const W = src.width;
  const H = src.height;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const stops = [[0, [4, 10, 22]], [0.35, [18, 70, 96]], [0.65, [96, 200, 222]], [0.85, [190, 246, 255]], [1, [250, 255, 255]]];
  for (let i = 0; i < d.length; i += 4) {
    let l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    l = Math.min(1, Math.pow(l, 0.9) * 1.12);
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < l) k++;
    const [t0, c0] = stops[k - 1];
    const [t1, c1] = stops[k];
    const u = Math.max(0, Math.min(1, (l - t0) / (t1 - t0)));
    d[i] = c0[0] + (c1[0] - c0[0]) * u;
    d[i + 1] = c0[1] + (c1[1] - c0[1]) * u;
    d[i + 2] = c0[2] + (c1[2] - c0[2]) * u;
  }
  g.putImageData(img, 0, 0);
  // bloom of the lit planes
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(6px)';
  g.globalAlpha = 0.35;
  g.drawImage(c, 0, 0);
  g.restore();
  // mist from below and a cold halo behind the head
  const mist = g.createLinearGradient(0, H * 0.55, 0, H);
  mist.addColorStop(0, 'rgba(160,240,255,0)');
  mist.addColorStop(1, 'rgba(160,240,255,0.35)');
  g.fillStyle = mist;
  g.fillRect(0, 0, W, H);
  glow(g, W / 2, H * 0.36, H * 0.42, '#8ff0ff', 0.18);
  return c;
}

/** Head-and-shoulders portrait of a sculpted creature (matches its figure in the scene). */
function sculptBust(id, W, H, o) {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.5, H * 0.8);
  bg.addColorStop(0, o.bg[0]);
  bg.addColorStop(1, o.bg[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  glow(g, W * 0.25, H * 0.25, H * 0.6, o.light, 0.22);
  const rig = { key: { dir: [-0.55, 0.55, 0.65], color: o.light, i: 1.35 }, rim: { dir: [0.8, 0.4, -0.5], color: o.ghost ? '#e0ffff' : '#9ab8ff', i: 1.3 }, sky: o.ghost ? '#4a8aa0' : '#4a3a40', ground: '#140c08', amb: 0.5 };
  const hpx = H * o.zoom;
  const r = renderCreature(id, hpx, rig, o.seed, { yaw: o.yaw, pitch: o.pitch, poseOverride: o.pose, ghostColor: '#a8f6ff' });
  if (!r) return c;
  const f = flattenSprite(r);
  const x = W / 2 - f.ox + W * 0.04;
  const y = H * 0.06 - (f.oy - hpx);
  if (o.ghost) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(12px)';
    g.globalAlpha = 0.6;
    g.drawImage(f.canvas, x, y);
    g.restore();
    g.globalCompositeOperation = 'lighter';
  }
  g.drawImage(f.canvas, x, y);
  g.globalCompositeOperation = 'source-over';
  vignette(g, W, H, 0.5);
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
  const c = makeCanvas(W, H);
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
  constructor(canvas, info, seed = 1, composer = null) {
    this.composer = composer;
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.info = info;
    const R = rngOf(seed * 7 + 3);
    const m = info.motes ?? { color: '#ffe0b0', count: 30, rise: 0.05 };
    this.motes = Array.from({ length: m.count }, () => ({ x: R(), y: R(), s: 0.6 + R() * 1.8, ph: R() * 10, sp: 0.2 + R() * 0.8 }));
    this.moteColor = m.color;
    this.rise = m.rise ?? 0.05;
  }

  _lights(g, t, list) {
    for (const [i, L] of list) {
      const ph = t + i * 1.7;
      const fl = 0.82 + Math.sin(ph * 7.3) * 0.08 + Math.sin(ph * 17.1 + 1) * 0.06 + Math.sin(ph * 3.1) * 0.04;
      if (L.kind === 'flame') {
        glow(g, L.x, L.y - L.s * 0.6, L.s * 9 * fl, L.color, 0.16 * fl);
        flame(g, L.x, L.y, L.s, ph, L.color);
      } else if (L.kind === 'candle') {
        glow(g, L.x, L.y, L.s * 12 * fl, L.color, 0.13 * fl);
        glow(g, L.x, L.y - L.s * 0.6, L.s * 3.2, '#fff0c0', 0.3 * fl);
        flame(g, L.x, L.y + L.s * 0.5, L.s * 1.45, ph * 1.3, L.color);
      } else if (L.kind === 'glow' || L.kind === 'ghost' || L.kind === 'ward') {
        const p = 0.75 + Math.sin(ph * 1.6) * 0.25;
        glow(g, L.x, L.y, L.s * (L.kind === 'ward' ? 3 : 4), L.color, 0.18 * p);
      } else if (L.kind === 'pool') {
        const p = 0.8 + Math.sin(t * 0.9) * 0.2;
        glow(g, L.x, L.y, L.s * 1.2, L.color, 0.18 * p);
      }
    }
  }

  draw(t) {
    const { g, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    const lights = (this.info.lights ?? []).map((L, i) => [i, L]);
    this._lights(g, t, lights.filter(([, L]) => !L.front));
    this.composer?.maskFigures(g, t);
    this._lights(g, t, lights.filter(([, L]) => L.front));
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
