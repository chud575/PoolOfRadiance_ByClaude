import { makeCanvas, vignette, grade, grain, rgba, glow, glowEllipse, flame, rngOf, hashStr, fog as fogBand, clamp01, contactShadow } from './paint.js';
import { paintSetting } from './settings.js';
import './interiors.js';
import { placeCreature, creatureScale, paintCreature, dragonHead, hasCreature, isSculpted, renderCreature, flattenSprite } from './creatures.js';
import { paintPortrait, defaultLook, SKIN_TONES, RACE_SKINS, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS, HEADS, BODIES } from '../components/portraitPainter.js';
import { buildPerson } from './bodies.js';
import { buildNpc } from './people.js';
import { renderFigure } from './sculpt.js';

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
export function paintPanel(spec) {
  const W = spec.w ?? 1280;
  const H = spec.h ?? 640;
  const bg = makeCanvas(W, H);
  const g = bg.getContext('2d');
  const fg = makeCanvas(W, H);
  const light = spec.light ?? DEFAULT_LIGHT[spec.setting] ?? 'dusk';
  const seed = spec.seed ?? hashStr(spec.setting);
  const info = paintSetting(g, W, H, spec.setting, { light, deity: spec.deity, seed, fg: fg.getContext('2d'), actor: !!spec.actor, cast: spec.cast, pose: spec.pose });
  info.light = light;
  const composer = new PanelComposer(W, H, bg, info, light, seed);
  if (info.fgUsed) composer.fg = fg;
  if (spec.actor) composer.addActor(spec.actor, info.actorSlot ?? { x: W * 0.5, y: H * 0.95, h: H * 0.74, pose: 'stand', yaw: 0.15 });
  if (spec.monsters?.length) placeGroup(composer, g, W, H, spec.monsters, info, light, seed, spec.mood);
  const canvas = makeCanvas(W, H);
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
      dim: ['#141828', '#e0c090'], green: ['#051a0a', '#9aff9a'], gold: ['#2a1a05', '#ffe090'], ghost: ['#0a1a2a', '#c0f0ff'], ward: ['#0a1030', '#c0d8ff'],
    }[light] ?? ['#1a2440', '#ffcc88'];
    this.tone = tone;
  }

  /** An NPC standing in the setting's actor slot (behind its desk/anvil/altar). */
  addActor(actor, slot) {
    const r = actor.render(slot, rigAt(this.light, this.info, slot.x, slot.y, this.W));
    if (!r) return;
    const g = this.bg.getContext('2d');
    contactShadow(g, slot.x, slot.y, slot.h * 0.16, slot.h * 0.03, 0.5);
    this.actors.push({ r, x: slot.x, y: slot.y, ph: 1.3, amp: 0.7, ghost: !!actor.ghost && !r.spectral, hover: !!actor.ghost, sway: 0.4 });
    if (actor.ghost) {
      // the ghost is a cold point light: it spills onto the floor and the altar around him
      glowEllipse(g, slot.x, slot.y - slot.h * 0.02, slot.h * 0.5, slot.h * 0.09, '#7ae8ff', 0.3, 'screen');
      glow(g, slot.x, slot.y - slot.h * 0.55, slot.h * 0.9, '#5ad8f0', 0.16, 'screen');
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
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);
    for (const a of this.actors) this._sprite(g, a, t);
    if (this.fg) g.drawImage(this.fg, 0, 0);
    for (const o of this.ops) {
      if (o.kind === 'fog') fogBand(g, W, o.y, o.h, o.color, o.a, o.seed);
      else this._sprite(g, o, t);
    }
    grade(g, W, H, { shadow: this.tone[0], highlight: this.tone[1], amount: 0.4 });
    vignette(g, W, H, 0.62);
    grain(g, W, H, 0.07, this.seed % 97);
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
  g.globalAlpha = 0.42;
  g.drawImage(sh, -r.ox, -r.oy);
  g.restore();
  contactShadow(g, x, y + h * 0.005, h * 0.2, h * 0.035, 0.6);
}

/**
 * Arrange up to 7 figures as a loose war-band: the leader forward and centre,
 * flankers a step back, a staggered second rank fading into the haze. Each is
 * an individual: its own pose, weapon, gear, tint, scale and facing.
 */
function placeGroup(comp, g, W, H, groups, info, light, seed, mood = null) {
  const hostile = mood === 'hostile';
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
  const human = Math.min(H * 0.6, (H * 0.7) / Math.max(1, biggest));
  const depth = (t) => floor + (H - floor) * t;
  const front = [[0.5, 0.95, 1.0, 0], [0.29, 0.8, 0.9, 0.05], [0.71, 0.82, 0.9, 0.05]];
  const back = [[0.39, 0.42, 0.66, 0.3], [0.61, 0.45, 0.66, 0.3], [0.17, 0.5, 0.7, 0.26], [0.83, 0.5, 0.7, 0.26]];
  const n = shown.length;
  const slots = n === 1 && shown[0] === 'tyranthraxus' ? [[0.5, 0.25, 0.6, 0]] : n === 1 && shown[0] === 'ghostKnight' ? [[0.5, 0.3, 0.82, 0]] : n === 1 ? [[0.5, 0.92, 1.05, 0]] : n === 2 ? [[0.4, 0.9, 1, 0], [0.62, 0.84, 0.95, 0.03]] : [...front, ...back].slice(0, n);
  const items = shown.map((id, i) => ({ id, slot: slots[i], i }));
  items.sort((a, b) => a.slot[1] - b.slot[1]);
  let fogged = false;
  for (const it of items) {
    let [sx, t, sc, haze] = it.slot;
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
    const y = depth(t) + (R() - 0.5) * H * 0.015;
    let hpx = human * sc * creatureScale(it.id) * (0.92 + R() * 0.16);
    hpx = Math.min(hpx, H * 0.95);
    const fseed = seed + it.i * 13 + (it.id.length << 3);
    if (isSculpted(it.id)) {
      const rig = rigAt(light, info, x, y - hpx * 0.6, W);
      // turn toward the party: figures on the flanks face the centre, 3/4 on
      const toward = (0.5 - sx) * 1.6;
      const lead = it.i === 0 && n > 2;
      const jit = (R() - 0.5) * 0.5;
      const yaw = lead ? (jit < 0 ? -0.22 : 0.22) : Math.max(-0.95, Math.min(0.95, toward + jit + (Math.abs(toward) < 0.2 ? (R() < 0.5 ? -0.45 : 0.45) : 0)));
      const r = renderCreature(it.id, hpx, rig, fseed, { yaw, haze, hazeColor, leader: lead, mood });
      if (!r) continue;
      if (!r.sp.ghost) castShadow(g, r, x, y, hpx, rig.key.dir, false);
      comp.addSprite({ r, x, y, ph: R() * 6.28, period: 2.8 + R() * 1.4, amp: 0.8 + R() * 0.5, haze, ghost: !!r.sp.ghost, sway: r.sp.tail ? 1.2 : 1 });
      if (r.sp.ghost) glow(g, x, y - hpx * 0.5, hpx * 0.7, '#8ff0ff', 0.28, 'screen');
    } else {
      placeCreature(g, it.id, x, y, hpx, L, { haze, hazeColor, seed: fseed, flip: sx > 0.55 && R() < 0.6 });
    }
  }
  comp.addFog(H * 0.97, H * 0.12, hazeColor, 0.22, (seed + 3) % 13);
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
  const rig = { key: { dir: [-0.6, 0.5, 0.7], color: '#ffe2bc', i: 1.35 }, rim: { dir: [0.75, 0.35, -0.55], color: aura, i: 1.15 }, sky: '#5a5060', ground: '#20160e', amb: 0.52 };
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
        return renderFigure(bn.fig, { ppu: slot.h / bn.top * (ch.race === 'dwarf' || ch.race === 'halfling' || ch.race === 'gnome' ? 0.8 : 1), yaw: slot.yaw ?? 0, rig, pitch: slot.pitch ?? 0.1, ink: 0.7 });
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
  vigil: { kneel: 1, weaponPose: 'vigil', offPose: null, crouch: 0.42, lean: 0.12, twist: 0, headYaw: -0.1, headPitch: 0.32, headTilt: 0.05, stance: 0.07, sway: 0, hipTilt: 0 },
  // risen and turned to face the living, the sword still reversed before him
  stand: { weaponPose: 'vigil', offPose: null, crouch: 0, lean: -0.02, twist: -0.25, headYaw: 0.05, headPitch: -0.05, headTilt: 0, stance: 0.07, sway: 0, hipTilt: 0.02 },
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
      const yaw = pose === 'vigil' ? slot.yaw ?? 0.5 : 0.25;
      const h = pose === 'vigil' ? slot.h : slot.h * 1.42;
      const r = renderCreature('ghostKnight', h, { ...rig, key: { dir: [-0.3, 0.8, 0.5], color: '#e8fbff', i: 1.25 }, rim: { dir: [0.7, 0.4, -0.6], color: '#e0ffff', i: 1.4 }, sky: '#6aa8c0', ground: '#0a1a20', amb: 0.62 }, 7, { yaw, poseOverride: P, solid: true, ink: 0.9 });
      if (!r) return null;
      return spectral(flattenSprite(r), r.emit);
    },
  };
}

/** Turn a solid figure sprite into a ghost (see ghostActor). */
function spectral(f, emit = []) {
  const { canvas: src, ox, oy } = f;
  const pad = 26;
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
  // 1. the veil: a deep teal body of fog that hides the altar's edges behind him
  g.globalAlpha = 0.5;
  g.drawImage(mask(6, '#0a2a34'), 0, 0);
  g.globalAlpha = 1;
  // 2. the knight's own light and shade, gradient-mapped into cold cyan (helm, face, plates, cape all read)
  const body = makeCanvas(W, H);
  const bg = body.getContext('2d');
  bg.drawImage(src, pad, pad);
  const img = bg.getImageData(0, 0, W, H);
  const d = img.data;
  const stops = [[0, [6, 26, 40]], [0.3, [24, 92, 116]], [0.55, [90, 190, 214]], [0.8, [190, 246, 255]], [1, [250, 255, 255]]];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const a = d[i + 3] / 255;
    let l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255 / Math.max(0.01, a);
    l = Math.min(1, Math.pow(l, 0.85) * 1.15);
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < l) k++;
    const [t0, c0] = stops[k - 1];
    const [t1, c1] = stops[k];
    const u = Math.max(0, Math.min(1, (l - t0) / (t1 - t0)));
    // legs dissolve into vapour toward the floor
    const y = Math.floor(i / 4 / W);
    const fy = (y - pad) / Math.max(1, oy);
    const fade = Math.min(1, Math.max(0.12, (1 - fy) * 3.2 + 0.1));
    d[i] = (c0[0] + (c1[0] - c0[0]) * u) * a;
    d[i + 1] = (c0[1] + (c1[1] - c0[1]) * u) * a;
    d[i + 2] = (c0[2] + (c1[2] - c0[2]) * u) * a;
    d[i + 3] = 255 * a * (0.4 + l * 0.42) * fade;
  }
  bg.putImageData(img, 0, 0);
  g.drawImage(body, 0, 0);
  // 3. internal mist: soft noise clipped to the body, drifting upward
  const mist = makeCanvas(W, H);
  const mg = mist.getContext('2d');
  const R = rngOf(77);
  mg.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x = R() * W;
    const y = R() * H;
    const rr = 8 + R() * 26;
    const gr = mg.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(170,240,255,0.16)');
    gr.addColorStop(1, 'rgba(170,240,255,0)');
    mg.fillStyle = gr;
    mg.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  mg.globalCompositeOperation = 'destination-in';
  mg.drawImage(mask(3), 0, 0);
  g.globalCompositeOperation = 'lighter';
  g.drawImage(mist, 0, 0);
  // 4. Fresnel rim: the silhouette's edge glows (mask minus its blurred self)
  const rim = mask(0, '#c8fbff');
  const rg = rim.getContext('2d');
  rg.globalCompositeOperation = 'destination-out';
  rg.filter = 'blur(3px)';
  rg.drawImage(mask(0), 0, 0);
  rg.drawImage(mask(0), 0, 0);
  g.drawImage(rim, 0, 0);
  g.filter = 'blur(8px)';
  g.globalAlpha = 0.5;
  g.drawImage(rim, 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  // 5. an aura of cold light around him
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = 0.35;
  g.filter = 'blur(18px)';
  g.drawImage(mask(0, '#5ad8f0'), 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return { canvas: out, ox: ox + pad, oy: oy + pad, emit: emit.map((e) => ({ ...e })), spectral: true };
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
  } else if (npc.figure && (!npc.kind || npc.kind === 'portrait')) {
    c = figureBust(npc, W, H);
  } else {
    const ch = { race: npc.race ?? 'human', gender: npc.gender ?? 'male', look: npc.look ?? {}, name: npc.name };
    if (npc.kind === 'hooded') ch.look = { ...ch.look, head: 6 };
    c = paintPortrait(ch, { scale });
    if (npc.kind === 'ghost') {
      c = ghostly(c);
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
