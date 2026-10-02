import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h } from '../../ui/UI.js';
import { createOutdoorRig, createSkyDome, timeOfDayKeys } from '../../render/lighting.js';
import * as TexLib from '../../render/textures/index.js';
import { getGlowTexture } from '../../render/textures/index.js';
import { getEncounter, ENCOUNTERS } from '../../data/encounters.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { SPELLS } from '../../data/spells.js';
import { ITEMS } from '../../data/items.js';
import { roll } from '../../rules/dice.js';
import { combatantFromCharacter, combatantFromMonster, xpForVictory, isDown } from '../../rules/combat.js';
import { awardXp } from '../../rules/character.js';
import { endBattle, battleItemUse } from '../../rules/battle.js';
import { victorySpoils } from '../../rules/treasure.js';
import { Battlefield, DIR8 } from './logic/battlefield.js';
import { CombatEngine } from './logic/engine.js';
import { decide } from './logic/ai.js';
import { buildDiorama, TILE } from './view/terrain.js';
import { makeFigureModel } from './view/models.js';
import { Figure, RIM } from './view/animator.js';
import { Overlay } from './view/overlay.js';
import { VFX } from './view/vfx.js';
import { CombatHud, describeHealth, fmtMp } from './ui/hud.js';
import { DEMOS } from './demos.js';

/** Portrait cache (data URLs) shared by every fight this session. */
const PORTRAITS = new Map();
const SPEEDS = [[0.6, 'Slow'], [1, 'Normal'], [1.6, 'Fast'], [2.4, 'Faster'], [4, 'Fastest']];
const sq2w = (x, y) => new THREE.Vector3(x * TILE + TILE / 2, 0, y * TILE + TILE / 2);
const yawTo = (a, b) => Math.atan2(b.x - a.x, b.y - a.y);

/**
 * Tactical combat: a 3D diorama of the location the party was standing in,
 * Gold Box turn-based rules (MOVE / VIEW / AIM / USE / CAST / TURN / GUARD /
 * QUICK / DELAY / BANDAGE / SPEED / END, attacks of opportunity, fleeing off
 * the map edge) with modern QoL (range & path preview, hit chances, timeline,
 * hover inspect, mouse + keyboard + gamepad, speed control).
 *
 * params: {encounter, map?, x?, y?, hour?, demo?, hover?}
 */
export default class CombatScene extends Scene {
  async enter(params = {}) {
    const { render, rng, game, clock, settings } = this.ctx;
    this.params = params;
    this.time = clock.time;
    this.frozen = clock.frozen;
    this.encounter = getEncounter(params.encounter ?? 'kobolds_1');
    this.speedIdx = Math.max(0, SPEEDS.findIndex(([v]) => v === (settings.get('combatSpeed') ?? 1)));
    if (this.speedIdx < 0) this.speedIdx = 1;
    this.demo = params.demo ? DEMOS[params.demo] : null;

    performance.mark?.('combat:enter');
    // Shared procedural textures generate in parallel workers while we build.
    const texReady = Promise.resolve(TexLib.preloadTextureSets?.(['hd_cobble', 'floor_rubble', 'hd_flags', 'wall_stone', 'wall_timber', 'wall_ruin', 'door_wood'])).catch(() => {});

    // ------------------------------------------------ where are we?
    const loc = this._location(params);
    this.mapObj = loc.map;
    this.field = new Battlefield(loc.map, loc.at, { seed: 11 });
    const hour = Number.isFinite(params.hour) ? params.hour : game.clock.hour;
    this.hour = hour;
    this.night = hour < 6 || hour > 19.5;

    // ------------------------------------------------ scene & lighting
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(34, render.aspect, 0.3, 400);
    this._applyViewOffset();
    const W = this.field.w * TILE;
    const H = this.field.h * TILE;
    this.center = new THREE.Vector3(W / 2, 0, H / 2);
    this.rig = createOutdoorRig(s, { hour, target: this.center, extent: Math.max(W, H) * 0.62, shadowSize: 2048 });
    this.rig.sun.shadow.radius = 3.5;
    this.rig.sun.shadow.bias = -0.0006;
    this.rig.sun.shadow.normalBias = 0.04;
    this.rig.sun.shadow.camera.updateProjectionMatrix();
    const keys = timeOfDayKeys(hour);
    if (this.night) {
      this.rig.sun.intensity = 1.5;
      this.rig.sun.color.set(0x8aa8ff);
      this.rig.hemi.intensity = 0.7;
      this.rig.hemi.color.set(0x4a5a9a);
      s.fog = new THREE.FogExp2(0x0a1124, 0.016);
    } else {
      this.rig.sun.intensity *= 1.1;
      this.rig.hemi.intensity *= 1.6; // lift the shadow side: no pitch-black building shadows
      s.fog = new THREE.FogExp2(keys.fog, 0.0085);
    }
    s.add(createSkyDome({ hour }));
    this._envMap(hour);

    // ------------------------------------------------ combatants
    const partyChars = game.party.length ? game.party : [];
    this.party = partyChars.map((ch) => combatantFromCharacter(ch));
    this.monsters = [];
    if (params.monsters) {
      // Debug: ?monsters=kobold,orc,... overrides the encounter's line-up.
      String(params.monsters).split(',').forEach((id, i) => this.monsters.push(combatantFromMonster(rng, id, i + 1)));
    } else {
      for (const g of this.encounter.groups) {
        const n = typeof g.count === 'number' ? g.count : roll(rng, g.count);
        for (let i = 0; i < n; i++) this.monsters.push(combatantFromMonster(rng, g.monster, i + 1));
      }
    }
    // The full light rig exists before anything is built: a constant light set
    // (3 flame lights + the spell light, sun/fill/rim, hemi) means every shader
    // program can be compiled early and is never recompiled when flames appear.
    this.torchLights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff9a48, 0, 10, 1.8);
      l.userData.base = 0;
      l.userData.seed = i * 2.3;
      s.add(l);
      this.torchLights.push(l);
    }
    // Soft camera-side fill so figures read against the ground (a classic tactics-cam trick).
    this.fill = new THREE.DirectionalLight(this.night ? 0x6a80c0 : 0xfff2e0, this.night ? 0.35 : 0.55);
    s.add(this.fill, this.fill.target);
    // Rim light from behind the fight: separates figures from the ground.
    this.rim = new THREE.DirectionalLight(this.night ? 0x8fb0ff : 0xffe8c8, this.night ? 0.9 : 0.8);
    s.add(this.rim, this.rim.target);
    this.vfx = new VFX(s);

    // Build the figure models while the shared textures generate in workers.
    const models = new Map();
    [...this.party, ...this.monsters].forEach((c, i) => models.set(c.id, makeFigureModel(c, c.side === 'party' ? this.party.indexOf(c) : i)));
    this.figures = new Map();
    [...this.party, ...this.monsters].forEach((c, i) => {
      const fig = new Figure(models.get(c.id), { seed: i * 13.7 + 1 });
      s.add(fig.root);
      this.figures.set(c.id, fig);
    });
    // Hand the figure shaders to the GPU process now: it compiles them while
    // this thread waits for the texture workers (SwiftShader compiles are the
    // single largest first-frame cost).
    this._precompile();

    // ------------------------------------------------ diorama
    performance.mark?.('combat:models');
    await texReady;
    performance.mark?.('combat:textures');
    this.diorama = buildDiorama(this.field, { hour, seed: 11 });
    s.add(this.diorama.group);
    this._precompile();
    // Real lights for the three most central flames (a brazier first).
    const flames = [...this.diorama.torches].sort((a, b) => (b.brazier ? 1 : 0) - (a.brazier ? 1 : 0) || Math.hypot(a.x - this.center.x, a.z - this.center.z) - Math.hypot(b.x - this.center.x, b.z - this.center.z)).slice(0, 3);
    flames.forEach((f, i) => {
      const l = this.torchLights[i];
      if (f.altar) {
        l.color.set(0xffb468); // candle pool on the altar
        l.intensity = this.night ? 16 : 5;
        l.distance = 9;
      } else {
        // Capped per light, with a gentler falloff: flames pool warm light on
        // the masonry instead of blowing a hot disc onto the nearest wall.
        l.intensity = (this.night ? 13 : 4) * (f.brazier ? 1.25 : 1);
        l.distance = f.brazier ? 13 : 11;
        l.decay = 1.5;
      }
      l.position.set(f.x, f.y, f.z);
      // Wall torches: the light sits out from the wall, not in the bracket.
      if (f.yaw !== undefined) l.position.add(new THREE.Vector3(Math.sin(f.yaw) * 0.5, 0.1, Math.cos(f.yaw) * 0.5));
      l.userData.home = l.position.clone();
      l.userData.base = l.intensity;
      f.light = l;
    });
    // Figure rim light: cool moonlit edge at night, warm sky edge by day.
    RIM.uRimColor.value.set(this.night ? 0x5a78c0 : 0x8a7a64).multiplyScalar(this.night ? 1.25 : 0.55);

    this._placeCombatants();
    this.engine = new CombatEngine({ rng, field: this.field, party: this.party, monsters: this.monsters });
    this.engine.startRound();
    this.engine.turnIdx = -1;

    // ------------------------------------------------ figures
    this.overlay = new Overlay(this.field);
    this.overlay.uniforms.uNight.value = this.night ? 1 : 0;
    s.add(this.overlay.group);
    this.proxies = [];
    const all = [...this.party, ...this.monsters];
    all.forEach((c, i) => {
      const model = models.get(c.id);
      const fig = this.figures.get(c.id);
      const p = sq2w(c.x, c.y);
      fig.place(p.x, p.z, facingYaw(c.facing));
      if (isDown(c)) fig.lieDead(this.time);
      // Glowing eyes read across the dark (undead, kobolds, rats...).
      if (model.eyesColor != null && fig.b.head && c.side === 'monster' && (this.night || model.eyesBurn)) {
        const glow = new THREE.Sprite(this._eyeMat?.[model.eyesColor] ?? ((this._eyeMat ??= {})[model.eyesColor] = new THREE.SpriteMaterial({ map: getGlowTexture(), color: model.eyesColor, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: this.night ? 0.95 : 0.3 })));
        glow.scale.setScalar((this.night ? 0.24 : 0.14) * (model.scale ?? 1));
        if (model.eyeAt) glow.position.set(0, model.eyeAt[1], model.eyeAt[2] + 0.01);
        else glow.position.set(0, model.rig === 'biped' ? 0.11 * (model.scale ?? 1) : 0.04, model.rig === 'biped' ? 0.12 * (model.scale ?? 1) : 0.12);
        fig.b.head.add(glow);
        fig.eyeGlow = glow;
      }
      // Blob contact shadow.
      const blob = new THREE.Mesh(this._blobGeo ??= new THREE.CircleGeometry(0.55, 24).rotateX(-Math.PI / 2), this._blobMat ??= new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.6, color: 0x000000 }));
      blob.renderOrder = 1;
      blob.scale.setScalar(Math.max(0.8, model.radius * 2.4));
      // Tight contact core right under the feet (ambient occlusion), so figures sit on the paving.
      const core = new THREE.Mesh(this._blobGeo, this._blobCoreMat ??= new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7, color: 0x000000 }));
      core.scale.setScalar(0.5);
      core.position.y = 0.002;
      core.renderOrder = 1;
      blob.add(core);
      s.add(blob);
      fig.blob = blob;
      // Invisible pick proxy.
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, Math.max(0.8, model.height), 8).translate(0, Math.max(0.8, model.height) / 2, 0), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.id = c.id;
      s.add(proxy);
      fig.proxy = proxy;
      this.proxies.push(proxy);
    });

    performance.mark?.('combat:figures');
    // ------------------------------------------------ HUD
    const zone = loc.map?.zoneAt?.(loc.at.x, loc.at.y) ?? 'Phlan';
    this.hud = new CombatHud(this.ctx, { location: zone, sub: `${this.encounter.name} · ${String(Math.floor(hour)).padStart(2, '0')}:00` });
    this.own(() => this.hud.dispose());
    // Results are shown when they land (see _veil), not when the dice are rolled.
    this.veil = new Map();
    this.hud.view = {
      has: (c) => this.veil.has(c.id),
      hp: (c) => this.veil.get(c.id).hp,
      out: (c) => this.veil.get(c.id).out,
    };
    this.hud.setSpeed(SPEEDS[this.speedIdx][1]);
    this._frames = 0;

    // ------------------------------------------------ camera
    this.cam = { yaw: 0.32, pitch: 0.74, dist: Math.max(W * 0.95, H * 1.35) + 4, target: this.center.clone(), goalTarget: this.center.clone(), goalYaw: 0.32, goalDist: 0, goalPitch: 0.74 };
    this.cam.maxDist = this.cam.dist * 1.2;
    this.cam.minDist = 8;
    this._frameCombatants(true, null, false, true);
    if (!this.demo) {
      this._chooseYaw();
      // Debug/screenshot overrides: &yaw= &pitch= (radians), &dist= (metres).
      const num = (k) => (params[k] !== undefined && Number.isFinite(+params[k]) ? +params[k] : null);
      if (num('yaw') !== null) this.cam.yaw = this.cam.goalYaw = num('yaw');
      if (num('pitch') !== null) this.cam.pitch = this.cam.goalPitch = num('pitch');
      this._frameCombatants(true, null, false, true);
      if (num('dist') !== null) this.cam.dist = this.cam.goalDist = num('dist');
    }
    // Bloom only on true emitters: a high threshold and a capped strength so lit
    // windows, the fireball core and holy light never flood to white.
    this.post = { bloomStrength: this.night ? 0.55 : 0.38, bloomThreshold: this.night ? 0.84 : 0.9, bloomRadius: 0.55, vignette: this.night ? 0.5 : 0.36, exposure: this.night ? 1.12 : 1.0, contrast: 1.06, saturation: this.night ? 0.98 : 1.06 };
    this._updateCamera(0, true);

    // ------------------------------------------------ input
    this._bindInput();
    this.mode = 'idle';
    this.busy = true;
    this.quickAll = false;
    this.done = false;
    this._waits = [];
    this.hitStop = 0;
    this._snapTurns = 0;

    this.ctx.audio.playMusic('combat');
    const count = this.encounter.groups.map((g) => {
      const n = this.monsters.filter((m) => m.monsterId === g.monster).length;
      const ref = this.monsters.find((m) => m.monsterId === g.monster)?.ref;
      return `${n} ${n === 1 ? ref?.name ?? g.monster : ref?.plural ?? `${ref?.name ?? g.monster}s`}`;
    }).join(' and ');
    this.ctx.ui.message(`${count.toUpperCase()} ATTACK!`, 'combat');

    // Initial HUD.
    this._refresh(null);

    if (this.demo) {
      await this.demo.stage(this);
      this._refresh(this.demoActive ?? null);
      this.diorama.update(this.time);
      this._updateFigures();
      return;
    }
    performance.mark?.('combat:built');
    this.director = this._run();
    this.director.catch((e) => console.error('[combat] director failed', e));
    if (this.frozen) await this._idle;
  }

  // =================================================================== setup helpers
  _location(params) {
    const { game } = this.ctx;
    let mapId = params.map ?? game.location?.map ?? 'phlan_slums';
    if (!hasMap(mapId)) mapId = 'phlan_slums';
    const map = getMap(mapId);
    let at = { x: game.location?.x ?? map.start.x, y: game.location?.y ?? map.start.y };
    if (Number.isFinite(params.x) && Number.isFinite(params.y)) at = { x: params.x, y: params.y };
    else if (this.ctx.debug.active) {
      // Debug shots: stand where this encounter lives on its map.
      const ev = map.events.find((e) => e.type === 'encounter' && e.ref === this.encounter.id);
      if (ev) at = { x: ev.x, y: ev.y };
    }
    return { map, at, mapId };
  }

  _placeCombatants() {
    const f = this.field;
    const pc = { x: (f.partyCell.x - f.cx0) * 3 + 1, y: (f.partyCell.y - f.cy0) * 3 + 1 };
    // Nearest free square to the party cell centre.
    const free = (x, y, taken) => f.isFree(x, y) && !taken.has(`${x},${y}`);
    const taken = new Set();
    const bfs = (sx, sy, n, ok = () => true) => {
      const out = [];
      const seen = new Set([`${sx},${sy}`]);
      const q = [[sx, sy]];
      while (q.length && out.length < n) {
        const [x, y] = q.shift();
        if (free(x, y, taken) && ok(x, y)) out.push([x, y]);
        for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const k = `${nx},${ny}`;
          if (seen.has(k) || !f.inBounds(nx, ny) || f.block[f.idx(nx, ny)] === 1) continue;
          if (!f.canStep(x, y, nx, ny) && f.block[f.idx(nx, ny)] !== 2) continue;
          seen.add(k);
          q.push([nx, ny]);
        }
      }
      return out;
    };
    let start = [pc.x, pc.y];
    if (!f.isFree(...start)) start = bfs(pc.x, pc.y, 1)[0] ?? [1, 1];
    const notRim = (x, y) => !f.exitMask[f.idx(x, y)];
    // Start the party on the most open square near its cell (not wedged
    // against a column or wall), so the formation shares one open floor.
    {
      const open = (x, y) => {
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (f.inBounds(x + dx, y + dy) && f.isFree(x + dx, y + dy)) n++;
        return n;
      };
      let best = { sq: start, n: open(...start) - 0 };
      for (const sq of bfs(start[0], start[1], 12, notRim)) {
        const n = open(sq[0], sq[1]) - Math.hypot(sq[0] - start[0], sq[1] - start[1]) * 0.8;
        if (n > best.n + 0.5) best = { sq, n };
      }
      start = best.sq;
    }
    const partySq = bfs(start[0], start[1], this.party.length, notRim);
    this.party.forEach((c, i) => {
      [c.x, c.y] = partySq[i] ?? [0, 0];
      taken.add(`${c.x},${c.y}`);
    });
    // Monsters: an anchor at walking distance ~6-7 from the party (a tense opening, both
    // sides in one readable frame), then a compact cluster.
    const fl = f.flood(start[0], start[1], () => false, 99);
    const cands = [];
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const c = fl.cost[f.idx(x, y)];
        if (!Number.isFinite(c) || !f.isFree(x, y) || !notRim(x, y)) continue;
        let openN = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && f.isFree(x + dx, y + dy)) openN++;
        const straight = Math.max(Math.abs(x - start[0]), Math.abs(y - start[1]));
        // A readable standoff: ~5 squares of open ground between the sides, in
        // plain sight of each other (never round a corner or behind a wall).
        const sight = f.los(x, y, start[0], start[1]) ? 0 : 6;
        cands.push({ x, y, score: -Math.abs(c - 4.5) * 1.2 - Math.max(0, straight - 5) * 1.5 - Math.max(0, c - straight - 1.5) * 1.5 - sight + openN * 0.35 + ((x * 7 + y * 13) % 5) * 0.05 });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const anchor = cands[0] ?? { x: f.w - 2, y: 1 };
    const monSq = bfs(anchor.x, anchor.y, this.monsters.length, notRim);
    this.monsters.forEach((c, i) => {
      [c.x, c.y] = monSq[i] ?? [f.w - 1, f.h - 1];
      taken.add(`${c.x},${c.y}`);
    });
    const face = (c, tx, ty) => {
      const a = Math.atan2(tx - c.x, -(ty - c.y));
      c.facing = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    };
    for (const c of this.party) face(c, anchor.x, anchor.y);
    for (const c of this.monsters) face(c, start[0], start[1]);
  }

  /**
   * Queue shader compilation for everything in the scene against the
   * composer's (linear, half-float) target so the programs match the ones the
   * frame will use. Non-blocking: the GPU process links them in parallel.
   */
  _precompile() {
    const r = this.ctx.render.renderer;
    try {
      this._preRT ??= new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
      const prev = r.getRenderTarget();
      r.setRenderTarget(this._preRT);
      r.compile(this.scene3d, this.camera);
      r.setRenderTarget(prev);
    } catch (e) {
      console.warn('[combat] precompile skipped', e);
    }
  }

  _envMap(hour) {
    const r = this.ctx.render.renderer;
    const pm = new THREE.PMREMGenerator(r);
    const k = timeOfDayKeys(hour);
    const es = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uTop: { value: new THREE.Color(k.skyTop) }, uHor: { value: new THREE.Color(k.skyHorizon) }, uGround: { value: new THREE.Color(this.night ? 0x05060a : 0x2a2620) }, uWarm: { value: this.night ? 0.6 : 0.15 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uTop, uHor, uGround; uniform float uWarm;
        void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(uHor, uTop, pow(y, 0.5)) : mix(uHor * 0.5, uGround, clamp(-y * 4.0, 0.0, 1.0));
        c += vec3(1.0, 0.55, 0.2) * uWarm * smoothstep(0.2, -0.05, abs(y)) * 0.6;
        gl_FragColor = vec4(c * 1.2, 1.0); }`,
    });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    const env = pm.fromScene(es, 0.02, 0.1, 100, { size: 64 }).texture;
    this.scene3d.environment = env;
    this.scene3d.environmentIntensity = this.night ? 0.5 : 0.9;
    pm.dispose();
    mat.dispose();
    this.own(() => env.dispose());
  }

  /**
   * Render a small 3D portrait of every combatant for the initiative timeline.
   * Runs after the first frame, in the live scene (same lights → no extra shader
   * compiles), with everything but the subject hidden.
   */
  _renderPortraits() {
    const r = this.ctx.render.renderer;
    const W = 96;
    const Hh = 116;
    // Same target format as the composer (linear, half float) so every shader program is reused.
    const rt = new THREE.WebGLRenderTarget(W, Hh, { samples: 0, type: THREE.HalfFloatType });
    const s = this.scene3d;
    const hidden = [];
    s.traverse((o) => {
      if (o === s || o.isLight || !o.visible) return;
      if (o.parent === s && !o.isLight && !o.isBone) {
        hidden.push(o);
      }
    });
    for (const o of hidden) o.visible = false;
    // Spell flashes must not wash out the portraits.
    const vfxLight = this.vfx.light.intensity;
    this.vfx.light.intensity = 0;
    const prevBg = s.background;
    const prevFog = s.fog;
    s.background = new THREE.Color(this.night ? 0x10162c : 0x1a2240);
    const cam = new THREE.PerspectiveCamera(24, W / Hh, 0.05, 30);
    const buf = new Uint16Array(W * Hh * 4);
    const exposure = this.night ? 1.9 : 1.15;
    const tone = (h16) => {
      const x = THREE.DataUtils.fromHalfFloat(h16) * exposure;
      const t = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
      return Math.round(Math.pow(Math.max(0, Math.min(1, t)), 1 / 2.2) * 255);
    };
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = Hh;
    const g = canvas.getContext('2d');
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.shadowMap.autoUpdate;
    const prevExposure = r.toneMappingExposure;
    r.shadowMap.autoUpdate = false;
    const key = new THREE.Vector3();
    const keyOf = (c) => {
      const fig = this.figures.get(c.id);
      return c.side === 'party'
        ? `p|${c.ref.id}|${c.ref.race}|${c.ref.inventory.filter((e) => e.equipped).map((e) => e.id).join(',')}|${this.night ? 1 : 0}`
        : `m|${c.monsterId}|${c.id}|${fig.model.kit?.helm ?? ''}|${this.night ? 1 : 0}`;
    };
    for (const c of [...this.party, ...this.monsters]) {
      // Same species + kit (or the same hero) → reuse the portrait (also across fights).
      const pk = keyOf(c);
      if (PORTRAITS.has(pk)) {
        this.hud.portraits.set(c.id, PORTRAITS.get(pk));
        continue;
      }
      const fig = this.figures.get(c.id);
      fig.root.visible = true;
      if (fig.eyeGlow) fig.eyeGlow.visible = false;
      const wasDead = fig.death;
      fig.death = null;
      fig.update(1.3);
      fig.root.updateMatrixWorld(true);
      const head = fig.bonePos('head', new THREE.Vector3());
      const sc = fig.s;
      if (fig.rig === 'biped') head.y += 0.07 * sc;
      const d = fig.rig === 'biped' ? 1.0 * sc : 1.2 * Math.max(0.6, fig.model.height);
      // Three-quarter view from the figure's weapon side (the shield would hide the face).
      // Each foe gets its own framing (head turn, tilt, distance) so a pack of
      // identical skeletons doesn't read as one portrait copied down the bar.
      const hv = c.side === 'party' ? 0.5 : ((String(c.id).split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 1000) / 1000);
      const yaw = fig.yaw - 0.3 + (c.side === 'party' ? 0 : (hv - 0.5) * 0.9);
      key.set(Math.sin(yaw), 0, Math.cos(yaw));
      const dd = d * (c.side === 'party' ? 1 : 0.9 + hv * 0.25);
      cam.position.set(head.x + key.x * dd, head.y + dd * (0.12 + (c.side === 'party' ? 0 : (hv - 0.5) * 0.25)), head.z + key.z * dd);
      cam.lookAt(head.x, head.y - 0.04 * sc, head.z);
      r.setRenderTarget(rt);
      r.clear();
      r.render(s, cam);
      performance.mark?.(`portrait:${pk}`);
      r.readRenderTargetPixels(rt, 0, 0, W, Hh, buf);
      const img = g.createImageData(W, Hh);
      for (let y = 0; y < Hh; y++) {
        for (let x = 0; x < W; x++) {
          const si = ((Hh - 1 - y) * W + x) * 4;
          const di = (y * W + x) * 4;
          img.data[di] = tone(buf[si]);
          img.data[di + 1] = tone(buf[si + 1]);
          img.data[di + 2] = tone(buf[si + 2]);
          img.data[di + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      const grd = g.createLinearGradient(0, Hh * 0.5, 0, Hh);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, Hh);
      // A canvas (not a data-URL <img>): drawing it is synchronous, so the
      // strip never shows a not-yet-decoded portrait (deterministic captures).
      const pc = document.createElement('canvas');
      pc.width = W;
      pc.height = Hh;
      pc.getContext('2d').drawImage(canvas, 0, 0);
      this.hud.portraits.set(c.id, pc);
      PORTRAITS.set(pk, pc);
      fig.death = wasDead;
      fig.root.visible = false;
      if (fig.eyeGlow) fig.eyeGlow.visible = !wasDead;
    }
    for (const o of hidden) o.visible = true;
    this.vfx.light.intensity = vfxLight;
    s.background = prevBg;
    s.fog = prevFog;
    r.shadowMap.autoUpdate = prevAuto;
    r.toneMappingExposure = prevExposure;
    r.setRenderTarget(prevTarget);
    rt.dispose();
    this._refresh(this.engine.active() ?? this.demoActive);
  }

  // =================================================================== time
  /**
   * Run `fn` once combat time reaches `t` (staged demos: log lines and HUD
   * changes land with their VFX). Deterministic under a frozen clock.
   */
  at(t, fn) {
    (this._timed ??= []).push({ t, fn });
    this._timed.sort((a, b) => a.t - b.t);
  }

  _runTimed() {
    if (!this._timed?.length) return;
    let fired = false;
    while (this._timed.length && this._timed[0].t <= this.time) {
      this._timed.shift().fn();
      fired = true;
    }
    if (fired) this._refresh(this.demoActive ?? this.engine.active());
  }

  /** Promise that resolves after `sec` of (scaled) combat time; instant when frozen. */
  wait(sec) {
    if (this.snap || sec <= 0) return Promise.resolve();
    return new Promise((res) => this._waits.push({ t: this.time + sec, res }));
  }

  /** Resolve on the next rendered frame (keeps the page responsive in instant mode). */
  nextFrame() {
    return new Promise((res) => (this._frameWaiters ??= []).push(res));
  }

  /**
   * Instant playback: the frozen debug clock, or QUICK on hardware too slow to
   * animate (software GL) — results resolve immediately instead of dragging on.
   */
  get snap() {
    // Frozen clock; QUICK on hardware too slow to animate; and monster turns on
    // hardware that manages only a couple of frames a second (software GL).
    const slow = (this._slowFrames ?? 0) >= 3;
    return this.frozen || (this.quickAll && slow) || (this._aiActing && slow && (this._frameMs ?? 0) > 450);
  }

  get speed() {
    // On hardware that can't hold a frame rate (software GL) playback runs faster
    // so monster turns stay snappy in wall-clock time; monsters always move
    // briskly (the player watches, not plays, their turns).
    const slow = (this._slowFrames ?? 0) >= 3 ? 2.2 : 1;
    return SPEEDS[this.speedIdx][0] * (this.quickAll ? 1.8 : 1) * (this._aiActing ? 1.6 : 1) * slow;
  }

  // =================================================================== director
  async _run() {
    let idleRes;
    this._idle = new Promise((res) => (idleRes = res));
    this._signalIdle = () => idleRes?.();
    await this.wait(0.6);
    this.hud.showBanner('Combat', this.encounter.name, this.time, 2.0);
    while (!this.done) {
      const evs = this.engine.nextTurn();
      await this.play(evs);
      const out = this.engine.outcome();
      if (out) {
        await this.finish(out);
        return;
      }
      const c = this.engine.active();
      if (!c) {
        await this.wait(0.1);
        continue;
      }
      await this._turn(c);
      if (this.done) return;
      if (this.snap && !this.frozen && ++this._snapTurns % 6 === 0) await this.nextFrame();
      const endOut = this.engine.outcome();
      if (endOut) {
        await this.finish(endOut);
        return;
      }
    }
  }

  async _turn(c) {
    const fig = this.figures.get(c.id);
    fig.guard = false;
    this._refresh(c);
    this._focus(c);
    const auto = c.side === 'monster' || c.quick || this.quickAll || c.charmed;
    if (!auto && !this.snap) this.hud.showBanner(`${c.name}`, 'Your move', this.time, 0.8);
    if (auto) {
      this._aiActing = true;
      try {
        await this.wait(0.12 / this.speed);
        await this._aiTurn(c);
      } finally {
        this._aiActing = false;
      }
    } else {
      await this._playerTurn(c);
    }
    if (!c.delayed || c._actedRound === this.engine.round || c.acted || c.moved) {
      if (this.engine.order[this.engine.turnIdx] === c) this.engine.endTurn(c);
    }
    this._clearTargeting();
  }

  async _aiTurn(c) {
    const plan = decide(this.engine, c);
    if (plan.path?.length) await this.play(this.engine.move(c, plan.path));
    if (this.engine.out(c)) return;
    if (plan.kind === 'attack') await this.play(this.engine.attack(c, plan.target));
    else if (plan.kind === 'cast') await this.play(this.engine.cast(c, plan.spell, plan.at));
    else if (plan.kind === 'turn') await this.play(this.engine.turn(c));
    else if (plan.kind === 'bandage') await this.play(this.engine.bandage(c, plan.target));
    else if (plan.kind === 'guard') await this.play(this.engine.guard(c));
    else if (plan.kind === 'flee') {
      if (this.field.exitDir(c.x, c.y) && c.mp >= 1) await this.play(this.engine.flee(c));
    } else if (plan.kind === 'move' && c.attacksLeft > 0) {
      // Moved but nothing in reach: end.
    }
    await this.wait(0.08 / this.speed);
  }

  // =================================================================== player turn
  _playerTurn(c) {
    return new Promise((resolve) => {
      this.turnDone = () => {
        this.turnDone = null;
        this.mode = 'idle';
        this.busy = true;
        resolve();
      };
      this.busy = false;
      this.cur = c;
      this._enterMode('move');
      this._signalIdle?.();
      // Demo/debug: preview a path to a hovered square.
      if (this.params.hover === 'auto') {
        // Gallery: preview the advance toward the nearest foe (path + card).
        const foes = this.engine.enemiesOf(c).filter((o) => !this.engine.out(o));
        let best = null;
        for (let i = 0; i < this.field.w * this.field.h; i++) {
          const cost = this.flood?.cost[i];
          if (!Number.isFinite(cost) || cost <= 0 || cost > c.mp + 1e-6) continue;
          const x = i % this.field.w;
          const y = (i / this.field.w) | 0;
          if (this.engine.occupantAt(x, y)) continue;
          const d = Math.min(...foes.map((o) => Battlefield.dist(x, y, o.x, o.y)));
          if (d < 2) continue;
          const sc = -d * 3 + Math.min(cost, 3);
          if (!best || sc > best.sc) best = { x, y, sc };
        }
        if (best) this._hoverSquare({ x: best.x, y: best.y });
      } else if (this.params.hover) {
        const [hx, hy] = String(this.params.hover).split(',').map(Number);
        this._hoverSquare({ x: hx, y: hy });
      }
      // Debug: &aim=1 / &cast=<spell> open targeting with Tab on the nearest valid target.
      if (this.params.aim) {
        this._enterMode('aim');
        this._cycleTarget(0);
      } else if (this.params.cast) {
        const spell = String(this.params.cast);
        this._enterMode('target', { spell, label: SPELLS[spell]?.name ?? spell });
        this._cycleTarget(0);
      }
    });
  }

  /** Check whether the active character can still do anything this turn. */
  async _afterAction(c) {
    this._refresh(c);
    if (!this.turnDone) return;
    if (this.engine.outcome() || this.engine.out(c) || c.acted || (c.mp <= 0.001 && c.attacksLeft <= 0) || c.fled) {
      await this.wait(0.2 / this.speed);
      this.turnDone?.();
      return;
    }
    if (c.quick || this.quickAll) {
      this.turnDone?.();
      return;
    }
    this.busy = false;
    this._enterMode('move');
  }

  _enterMode(mode, data = {}) {
    const c = this.cur;
    this.mode = mode;
    this.modeData = data;
    this.hud.closeMenu();
    this.overlay.setTemplate([]);
    this.overlay.setPath(null, null);
    this.overlay.setRay(null, null);
    this.overlay.targetRing.visible = false;
    this.overlay.setReticle(null);
    if (!c) return;
    if (mode === 'move') {
      this.flood = this.engine.reach(c, c.mp);
      const threatened = new Set();
      const foes = this.engine.enemiesOf(c).filter((e) => this.engine.awake(e));
      for (let i = 0; i < this.field.w * this.field.h; i++) {
        const x = i % this.field.w;
        const y = (i / this.field.w) | 0;
        if (foes.some((e) => this.engine.adjacent(c, e, x, y))) threatened.add(i);
      }
      this.threatened = threatened;
      this.overlay.setRange(this.flood, c.mp, threatened);
      // Mark enemies that can be attacked right now.
      const targets = this.engine.enemiesOf(c).filter((e) => this.engine.canAttack(c, e).ok);
      this.overlay.setTemplate([], targets.map((e) => ({ x: e.x, y: e.y })));
      this.hud.setPrompt(c.attacksLeft > 0 ? 'Move, or click a foe to attack' : 'Move or end your turn');
    } else if (mode === 'aim') {
      this.hud.hideBanner();
      this.overlay.setRange(null, 0);
      const targets = this.engine.enemiesOf(c).filter((e) => this.engine.canAttack(c, e).ok);
      this.overlay.setTemplate([], targets.map((e) => ({ x: e.x, y: e.y })));
      const valid = targets.length ? targets : this.engine.enemiesOf(c);
      this.aimList = valid.slice().sort((a, b) => Battlefield.dist(c.x, c.y, a.x, a.y) - Battlefield.dist(c.x, c.y, b.x, b.y));
      this.aimIdx = 0;
      this.cursor = this.aimList[0] ? { x: this.aimList[0].x, y: this.aimList[0].y } : { x: c.x, y: c.y };
      this.hud.setPrompt('Aim: choose a target — Enter to attack, Tab to cycle');
      this._hoverSquare(this.cursor);
    } else if (mode === 'target') {
      this.hud.hideBanner();
      this.overlay.setRange(null, 0);
      this.cursor = data.start ?? { x: c.x, y: c.y };
      const t = this.engine.tactics(c, data.spell);
      this.hud.setPrompt(`${data.label}: ${t.target === 'direction' ? 'choose a direction' : 'choose a target'} — Enter to cast, Esc to cancel`);
      this._hoverSquare(this.cursor);
    }
    this._commands();
  }

  _clearTargeting() {
    this.overlay.setRay(null, null);
    this.overlay.setRange(null, 0);
    this.overlay.setTemplate([]);
    this.overlay.setHover(null);
    this.overlay.setPath(null, null);
    this.overlay.targetRing.visible = false;
    this.overlay.setReticle(null);
    this.hud.setPrompt('');
    this.hud.showInspect(null);
  }

  _commands() {
    const c = this.cur;
    const e = this.engine;
    const my = c && !this.done && !this.busy && this.turnDone && c.side === 'party';
    const spells = my ? e.spellsOf(c) : [];
    const items = my ? e.usableItems(c) : [];
    const list = [
      { id: 'move', label: 'Move', key: 'M', tip: 'Move (arrow keys / numpad, or click a square). Leaving an enemy\'s reach provokes a free attack.', disabled: !my || c.mp <= 0, onSelect: () => this._enterMode('move') },
      { id: 'view', label: 'View', key: 'V', tip: 'View a character\'s sheet', disabled: !c, onSelect: () => this._cmdView() },
      { id: 'aim', label: 'Aim', key: 'A', tip: 'Aim at a target and attack (melee or missile)', disabled: !my || c.attacksLeft <= 0, onSelect: () => this._enterMode('aim') },
      { id: 'use', label: 'Use', key: 'U', tip: 'Use an item: potion, wand or scroll', disabled: !my || !items.length, onSelect: () => this._cmdUse() },
      { id: 'cast', label: 'Cast', key: 'C', tip: spells.length ? 'Cast a memorized spell' : 'No spells memorized', disabled: !my || !spells.length, onSelect: () => this._cmdCast() },
      { id: 'turn', label: 'Turn', key: 'T', tip: 'Turn undead (clerics)', disabled: !my || !e.canTurn(c), onSelect: () => this._act(() => e.turn(c)) },
      { id: 'guard', label: 'Guard', key: 'G', tip: 'Stand guard: strike the first enemy that comes adjacent', disabled: !my, onSelect: () => this._act(() => e.guard(c)) },
      { id: 'quick', label: 'Quick', key: 'Q', tip: this.quickAll ? 'Take back control of the party' : 'Let the computer fight for the whole party (Shift+Q: only this character)', disabled: false, onSelect: () => this._cmdQuick(false) },
      { id: 'delay', label: 'Delay', key: 'D', tip: 'Act at the end of the round', disabled: !my || c.delayed || c.moved > 0, onSelect: () => this._cmdDelay() },
      { id: 'bandage', label: 'Bandage', key: 'B', tip: 'Bind the wounds of an adjacent dying ally', disabled: !my || !e.dyingAlliesNear(c).length, onSelect: () => this._act(() => e.bandage(c, e.dyingAlliesNear(c)[0])) },
      { id: 'speed', label: 'Speed', key: 'S', tip: `Combat speed: ${SPEEDS[this.speedIdx][1]}`, onSelect: () => this._cmdSpeed() },
      { id: 'end', label: 'End', key: 'E', tip: 'End this character\'s turn', disabled: !my, onSelect: () => this._act(() => []) },
    ];
    if (this.done) for (const it of list) it.disabled = true;
    this.hud.setCommands(list, this.mode === 'aim' ? 'aim' : this.mode === 'target' ? 'cast' : this.mode === 'move' && my ? 'move' : null);
    this._cmdList = list;
  }

  /** Run an engine action for the active player character and play it. */
  async _act(fn, { endsTurn = true } = {}) {
    const c = this.cur;
    if (!c || this.busy || !this.turnDone) return;
    this.busy = true;
    this._clearTargeting();
    this._commands();
    const evs = fn();
    await this.play(evs);
    if (endsTurn && evs.every((e) => e.type !== 'log' && e.type !== 'fleeFail')) c.acted = true;
    await this._afterAction(c);
  }

  _cmdView() {
    const target = this.hoverId ? this.engine.byId(this.hoverId) : this.cur;
    if (this.hud.sheet) this.hud.hideSheet();
    else this.hud.showSheet(target);
  }

  _cmdCast() {
    const c = this.cur;
    const spells = this.engine.spellsOf(c);
    const counts = new Map();
    for (const s of spells) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
    const items = [...counts.entries()].map(([id, n], i) => { const tt = this.engine.tactics(c, id); return { id, label: `${i + 1}  ${SPELLS[id].name}${n > 1 ? ` (${n})` : ''}`, key: String(i + 1), hint: `L${SPELLS[id].level} ${SPELLS[id].school === 'cleric' ? 'Cleric' : 'Mage'} · ${tt.range ? `range ${tt.range}` : 'self'}` }; });
    this.hud.openMenu('Cast', items, (it) => {
      this.hud.closeMenu();
      this._beginSpell(it.id, SPELLS[it.id].name);
    }, () => this._enterMode('move'));
  }

  _beginSpell(spell, label, source = null) {
    const c = this.cur;
    const t = this.engine.tactics(c, spell, source?.level);
    if (t.target === 'self') {
      this._act(() => (source ? this.engine.use(c, source.index, { x: c.x, y: c.y }) : this.engine.cast(c, spell, { x: c.x, y: c.y })));
      return;
    }
    const foes = this.engine.enemiesOf(c).sort((a, b) => Battlefield.dist(c.x, c.y, a.x, a.y) - Battlefield.dist(c.x, c.y, b.x, b.y));
    // Healing may target fallen (not dead) friends too; the most hurt comes first.
    const allies = this.engine.all.filter((o) => !this.engine.hostileTo(c, o) && !o.fled && (!isDown(o) || (o.side === 'party' && o.ref.status !== 'dead')))
      .sort((a, b) => a.hp.cur / a.hp.max - b.hp.cur / b.hp.max);
    const pool = t.target === 'ally' || t.affects === 'allies' ? allies : foes;
    const valid = pool.filter((o) => this.engine.canCast(c, spell, { x: o.x, y: o.y }, source?.level).ok);
    // Area spells: aim at the foe that catches the most enemies and no friends.
    let first = valid[0] ?? pool[0];
    if (t.shape !== 'single' && t.target === 'square' && valid.length) {
      let best = -1;
      for (const o of valid) {
        const area = new Set(this.engine.spellArea(c, spell, { x: o.x, y: o.y }, source?.level).map((q) => `${q.x},${q.y}`));
        const inside = this.engine.all.filter((a) => !this.engine.out(a) && area.has(`${a.x},${a.y}`));
        const score = inside.filter((a) => this.engine.hostileTo(c, a)).length * 2 - inside.filter((a) => !this.engine.hostileTo(c, a)).length * 3;
        if (score > best) {
          best = score;
          first = o;
        }
      }
    }
    if (!valid.length && t.target !== 'direction') this.ctx.ui.message('No valid target in range or sight — move the cursor, or Esc to cancel.', 'warn');
    this._enterMode('target', { spell, label, source, start: first ? { x: first.x, y: first.y } : { x: c.x, y: c.y } });
  }

  _cmdUse() {
    const c = this.cur;
    const items = this.engine.usableItems(c).map(({ e, i, def }, k) => ({ id: String(i), label: `${k + 1}  ${e.identified === false ? def.unidName ?? def.name : def.name}${e.charges ? ` (${e.charges})` : ''}`, key: String(k + 1), def, index: i }));
    this.hud.openMenu('Use', items, (it) => {
      this.hud.closeMenu();
      if (it.def.type === 'potion') this._act(() => this.engine.use(c, it.index));
      else {
        const u = battleItemUse(c.ref, it.index);
        if (!u.kind) { this.ctx.ui.message(u.reason, 'warn'); return; }
        this._beginSpell(u.spellId, it.def.name, { index: it.index, level: u.level });
      }
    }, () => this._enterMode('move'));
  }

  _cmdQuick(single) {
    const c = this.cur;
    if (single && c && c.side === 'party') {
      c.quick = !c.quick;
      this.ctx.ui.message(`${c.name} is ${c.quick ? 'now under computer control' : 'back under your control'}.`, 'system');
      this._refresh(c);
      if (c.quick && this.turnDone && !this.busy) this._handOverToAi(c);
      return;
    }
    this.quickAll = !this.quickAll;
    if (this.snap) {
      for (const w of this._waits) w.res();
      this._waits = [];
    }
    this.ctx.ui.message(this.quickAll ? 'QUICK: the party fights on its own. (Q to take control.)' : 'You take command of the party.', 'system');
    this._refresh(c);
    if (this.quickAll && c && this.turnDone && !this.busy) this._handOverToAi(c);
  }

  async _handOverToAi(c) {
    this.busy = true;
    this._clearTargeting();
    await this._aiTurn(c);
    c.acted = true;
    this.turnDone?.();
  }

  _cmdDelay() {
    const c = this.cur;
    if (!c || this.busy) return;
    const evs = this.engine.delay(c);
    this.play(evs);
    if (c.delayed) {
      this._clearTargeting();
      this.turnDone?.();
    }
  }

  _cmdSpeed() {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    this.ctx.settings.set('combatSpeed', SPEEDS[this.speedIdx][0]);
    this.hud.setSpeed(SPEEDS[this.speedIdx][1]);
    this.ctx.ui.toast(`Combat speed: ${SPEEDS[this.speedIdx][1]}`);
    this._commands();
  }

  // =================================================================== input
  _bindInput() {
    const canvas = this.ctx.render.renderer.domElement;
    const uiRoot = this.ctx.ui.root;
    this.mouse = new THREE.Vector2();
    this.ray = new THREE.Raycaster();
    let drag = null;
    const onMove = (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.mouseClient = { x: e.clientX, y: e.clientY };
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.button === 2) {
          this.cam.goalYaw -= dx * 0.006;
          this.cam.goalPitch = Math.max(0.5, Math.min(1.35, this.cam.goalPitch + dy * 0.004));
        } else if (drag.button === 1) {
          const k = this.cam.dist * 0.0016;
          const fwd = new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
          const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
          this.cam.goalTarget.addScaledVector(right, dx * k).addScaledVector(fwd, dy * k);
          this.cam.userPanned = true;
        }
        return;
      }
      if (e.target !== canvas && !e.target.classList?.contains('por-layer-scene') && e.target !== uiRoot && !e.target.classList?.contains('cb-hud') && !e.target.classList?.contains('cb-float-layer')) {
        this._pointerOverUi = true;
        this.hud.showInspect(null);
        return;
      }
      this._pointerOverUi = false;
      this._pick();
    };
    const onDown = (e) => {
      if (e.button === 2 || e.button === 1) {
        drag = { x: e.clientX, y: e.clientY, button: e.button, moved: 0 };
        e.preventDefault();
      }
    };
    const onUp = (e) => {
      if (drag && (e.button === 2 || e.button === 1)) {
        drag = null;
        return;
      }
      if (e.button !== 0 || this._pointerOverUi) return;
      if (!this._isWorldTarget(e.target, canvas)) return;
      this._click();
    };
    const onWheel = (e) => {
      if (!this._isWorldTarget(e.target, canvas)) return;
      this.cam.goalDist = Math.max(this.cam.minDist, Math.min(this.cam.maxDist, this.cam.goalDist * (1 + Math.sign(e.deltaY) * 0.1)));
    };
    const onCtx = (e) => e.preventDefault();
    const onKey = (e) => this._key(e);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKey);
    this.own(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKey);
    });
    // Gamepad: d-pad moves / aims, A confirms, B cancels, shoulders cycle targets.
    this.listen('input:action', ({ action, code }) => {
      if (!String(code).startsWith('pad:')) return;
      // A popup menu (commands, spells, items) takes the pad while open.
      const menu = this.hud.menu?.menu;
      if (menu) {
        if (action === 'forward') menu.highlight(menu._step(menu.index, -1));
        else if (action === 'back') menu.highlight(menu._step(menu.index, 1));
        else if (action === 'confirm') menu.select(menu.index);
        else if (action === 'cancel') {
          this.hud.closeMenu();
          if (this.turnDone && !this.busy) this._enterMode('move');
        }
        return;
      }
      if (action === 'encamp' || action === 'area') {
        // Start / Select: the classic command line as a pad-friendly menu.
        const items = (this._cmdList ?? []).filter((c) => !c.disabled).map((c) => ({ id: c.id, label: c.label, key: c.key, hint: c.tip?.slice(0, 40) }));
        this.hud.openMenu('Commands', items, (it) => {
          this.hud.closeMenu();
          this._cmdList.find((c) => c.id === it.id)?.onSelect();
        }, () => {});
        return;
      }
      const dirs = { forward: [0, -1], back: [0, 1], turnLeft: [-1, 0], turnRight: [1, 0] };
      if (dirs[action]) this._dirInput(...dirs[action]);
      else if (action === 'confirm') this._confirm();
      else if (action === 'cancel') this._cancel();
      else if (action === 'strafeLeft' || action === 'strafeRight') this._cycleTarget(action === 'strafeRight' ? 1 : -1);
      else if (action === 'look') this._cmdQuick(false);
    });
  }

  _isWorldTarget(t, canvas) {
    return t === canvas || t === this.ctx.ui.root || t?.classList?.contains('por-layer-scene') || t?.classList?.contains('cb-hud') || t?.classList?.contains('cb-float-layer');
  }

  _key(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.por-modal-backdrop')) return;
    const k = e.key;
    const code = e.code;
    // Camera keys always work.
    if (k === ',' || k === '<') { this.cam.goalYaw += Math.PI / 8; return; }
    if (k === '.' || k === '>') { this.cam.goalYaw -= Math.PI / 8; return; }
    if (k === '+' || k === '=') { this.cam.goalDist = Math.max(this.cam.minDist, this.cam.goalDist * 0.88); return; }
    if (k === '-' || k === '_') { this.cam.goalDist = Math.min(this.cam.maxDist, this.cam.goalDist * 1.12); return; }
    if (k === 'Home' && !code.startsWith('Numpad')) { this.cam.userPanned = false; this._focus(this.engine.active()); return; }
    if (this.hud.menu) {
      if (k === 'Escape') {
        this.hud.closeMenu();
        this._enterMode('move');
        e.preventDefault();
      }
      return;
    }
    const upper = k.length === 1 ? k.toUpperCase() : '';
    if (upper === 'Q') {
      e.preventDefault();
      this._cmdQuick(e.shiftKey);
      return;
    }
    if (upper === 'S') { this._cmdSpeed(); return; }
    if (upper === 'V') { this._cmdView(); return; }
    // Numpad / arrows.
    const numpad = { Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1] };
    const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1] };
    const d = numpad[code] ?? arrows[k];
    if (d) {
      e.preventDefault();
      this._dirInput(...this._screenDir(d));
      return;
    }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); this._confirm(); return; }
    if (k === 'Escape' || k === 'Backspace') { this._cancel(); return; }
    if (k === 'Tab') { e.preventDefault(); this._cycleTarget(e.shiftKey ? -1 : 1); return; }
    if (!upper || this.busy || !this.turnDone) return;
    const cmd = this._cmdList?.find((c) => c.key === upper && !c.disabled);
    if (cmd) {
      e.preventDefault();
      cmd.onSelect();
    }
  }

  /** Rotate a keyboard direction by the camera yaw so "up" is always away from the viewer. */
  _screenDir([dx, dy]) {
    const oct = Math.round(-this.cam.yaw / (Math.PI / 4));
    let idx = DIR8.findIndex(([x, y]) => x === dx && y === dy);
    idx = (((idx + oct) % 8) + 8) % 8;
    return DIR8[idx];
  }

  _dirInput(dx, dy) {
    if (this.busy || !this.turnDone) return;
    const c = this.cur;
    if (this.mode === 'move') {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!this.field.inBounds(nx, ny)) {
        if (this.field.exitDir(c.x, c.y)) this._act(() => this.engine.flee(c), { endsTurn: false });
        return;
      }
      const occ = this.engine.occupantAt(nx, ny);
      if (occ && this.engine.hostileTo(c, occ)) {
        if (this.engine.canAttack(c, occ).ok) this._act(() => this.engine.attack(c, occ));
        return;
      }
      if (occ) return;
      this._moveTo({ x: nx, y: ny }, [{ x: nx, y: ny, cost: dx && dy ? 1.5 : 1 }]);
    } else if (this.mode === 'aim' || this.mode === 'target') {
      this.cursor = { x: Math.max(0, Math.min(this.field.w - 1, this.cursor.x + dx)), y: Math.max(0, Math.min(this.field.h - 1, this.cursor.y + dy)) };
      this._hoverSquare(this.cursor);
    }
  }

  _cycleTarget(d) {
    if (this.mode !== 'aim' && this.mode !== 'target') return;
    const c = this.cur;
    // Only targets that can actually be hit / reached by the spell.
    let list = this._validTargets();
    if (!list.length) {
      this.ctx.ui.message('No valid target in range or sight.', 'warn');
      return;
    }
    list = list.sort((a, b) => Battlefield.dist(c.x, c.y, a.x, a.y) - Battlefield.dist(c.x, c.y, b.x, b.y));
    this.aimIdx = (((this.aimIdx ?? 0) + d) % list.length + list.length) % list.length;
    this.cursor = { x: list[this.aimIdx].x, y: list[this.aimIdx].y };
    this._hoverSquare(this.cursor);
  }

  _confirm() {
    if (this.busy || !this.turnDone) return;
    if (this.mode === 'aim' || this.mode === 'target') this._activateSquare(this.cursor);
    else if (this.mode === 'move' && this.hoverSq) this._activateSquare(this.hoverSq);
  }

  _cancel() {
    if (this.hud.sheet) {
      this.hud.hideSheet();
      return;
    }
    if (this.quickAll) {
      this._cmdQuick(false);
      return;
    }
    if (this.mode !== 'move' && this.turnDone && !this.busy) this._enterMode('move');
  }

  _pick() {
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.proxies, false);
    let sq = null;
    this.hoverId = null;
    for (const hh of hits) {
      const c = this.engine.byId(hh.object.userData.id);
      if (c && !c.fled) {
        sq = { x: c.x, y: c.y };
        this.hoverId = c.id;
        break;
      }
    }
    if (!sq) {
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) {
        const x = Math.floor(p.x / TILE);
        const y = Math.floor(p.z / TILE);
        if (this.field.inBounds(x, y)) sq = { x, y };
      }
    }
    this._hoverSquare(sq, true);
  }

  /** Update hover square: path preview, templates, inspect card. */
  _hoverSquare(sq, fromMouse = false) {
    this.hoverSq = sq;
    const c = this.cur;
    const e = this.engine;
    this.overlay.targetRing.visible = false;
    this.overlay.setReticle(null);
    if (!sq) {
      this.overlay.setHover(null);
      this.overlay.setPath(null, null);
      this.hud.showInspect(null);
      return;
    }
    const occ = e.occupantAt(sq.x, sq.y) ?? e.occupantAt(sq.x, sq.y, { includeDown: true });
    const pos = this.mouseClient ?? this._screenOf(sq);
    const myTurn = c && this.turnDone && !this.busy;
    const content = [];
    let bad = false;
    if (occ) {
      const foe = c ? e.hostileTo(c, occ) : occ.side === 'monster';
      content.push(h(`div.t.${foe ? 'foe' : 'ally'}`, [occ.name]));
      content.push(h('div.s', [`${occ.side === 'party' ? `${occ.hp.cur}/${occ.hp.max} HP` : describeHealth(occ)} · AC ${occ.ac}${occ.fx?.asleep ? ' · asleep' : ''}${occ.fx?.held ? ' · held' : ''}${occ.guarding ? ' · guarding' : ''}`]));
      if (foe && myTurn && c.attacksLeft > 0 && !isDown(occ) && this.mode !== 'target') {
        const pv = e.preview(c, occ);
        let reachNote = '';
        if (!pv.ok && this.mode === 'move') {
          const p = this._pathAdjacent(c, occ);
          if (p && p.length && p[p.length - 1].cost <= c.mp) reachNote = `Move ${fmtMp(p[p.length - 1].cost)} and attack`;
          else bad = true;
        }
        content.push(h('div.pct', [h('b', [`${Math.round(pv.chance * 100)}%`]), h('span', [`to hit · ${pv.dmg} dmg${pv.attacks > 1 ? ` ×${pv.attacks}` : ''}`])]));
        if (c.side === 'party') content.push(h('div.wpn', [`${pv.ranged ? 'Missile' : 'Melee'} · ${pv.weapon}${pv.dice ? ` (${pv.dice})` : ''}`]));
        content.push(h('div.bar', [h('i', { style: { width: `${pv.chance * 100}%` } })]));
        if (pv.notes.length) content.push(h('div.note', [pv.notes.join(' · ')]));
        if (!pv.ok) content.push(h('div', { class: reachNote ? 'note' : 'warn' }, [reachNote || pv.reason]));
        this.overlay.targetRing.visible = true;
        this.overlay.targetRing.position.set(occ.x * TILE + TILE / 2, 0.04, occ.y * TILE + TILE / 2);
        if (this.mode === 'move' && reachNote) {
          const p = this._pathAdjacent(c, occ);
          this.overlay.setPath({ x: c.x, y: c.y }, p);
        } else this.overlay.setPath(null, null);
      } else this.overlay.setPath(null, null);
    }
    if (myTurn && this.mode === 'move' && !occ) {
      const i = this.field.idx(sq.x, sq.y);
      const cost = this.flood?.cost[i];
      if (Number.isFinite(cost) && cost <= c.mp + 1e-6 && cost > 0) {
        const path = this.field.pathTo(this.flood, sq.x, sq.y);
        this.overlay.setPath({ x: c.x, y: c.y }, path);
        content.push(h('div.t', [`Move ${fmtMp(cost)}`]), h('div.s', [`${fmtMp(c.mp - cost)} moves left after`]));
        const provoke = this._provokers(c, path);
        if (provoke.length) content.push(h('div.warn', [`Provokes attacks from ${provoke.map((p) => p.name).join(', ')}`]));
        if (this.field.exitMask[i]) content.push(h('div.note', ['Edge of the battle — step off to flee']));
      } else {
        this.overlay.setPath(null, null);
        if (this.field.block[i]) {
          // Walls / props: no card (a lingering label over buildings is noise).
        } else if (sq.x !== c.x || sq.y !== c.y) { content.push(h('div.s', ['Out of reach this turn'])); bad = true; }
        if (sq.x === c.x && sq.y === c.y && this.field.exitMask[i]) content.push(h('div.note', ['Press an arrow toward the edge to flee']));
      }
    }
    if (this.mode === 'target' && myTurn) {
      // Spell targeting: spell facts only (no melee odds), area victims, and a sight line.
      const spell = this.modeData.spell;
      const lv = this.modeData.source?.level;
      const tact = e.tactics(c, spell, lv);
      const can = e.canCast(c, spell, sq, lv);
      const area = e.spellArea(c, spell, sq, lv);
      this.overlay.setTemplate(can.ok ? area : [], this._validTargets().map((o) => ({ x: o.x, y: o.y })));
      const affected = e.all.filter((o) => !e.out(o) && area.some((a) => a.x === o.x && a.y === o.y));
      const info = this._spellInfo(c, spell);
      content.length = 0;
      content.push(h('div.t', [this.modeData.label]));
      if (occ) content.push(h('div.s', [`${occ.name} · ${occ.side === 'party' ? `${occ.hp.cur}/${occ.hp.max} HP` : describeHealth(occ)}`]));
      content.push(h('div.pct', [h('b', [info.big]), h('span', [info.unit])]));
      for (const line of info.lines) content.push(h('div.s', [line]));
      if (can.ok && tact.shape !== 'single') {
        const foes = affected.filter((o) => e.hostileTo(c, o));
        content.push(h('div.note', [`Catches ${foes.length} foe${foes.length === 1 ? '' : 's'}${foes.length ? `: ${foes.map((o) => o.name).slice(0, 4).join(', ')}${foes.length > 4 ? '…' : ''}` : ''}`]));
      }
      if (!can.ok) { content.push(h('div.warn', [can.reason])); bad = true; }
      if (can.ok && affected.some((o) => !e.hostileTo(c, o)) && tact.hostile && tact.shape !== 'single') content.push(h('div.warn', ['Allies are in the area!']));
      if (tact.target !== 'self' && tact.target !== 'direction') this.overlay.setRay({ x: c.x, y: c.y }, sq, this.field.losBlock(c.x, c.y, sq.x, sq.y), { arc: tact.vfx === 'fireball' || tact.vfx === 'missile' ? 0.7 : 0.25 });
      else this.overlay.setRay(null, null);
      if (can.ok && tact.target !== 'self') this.overlay.setReticle(sq, tact.hostile === false || tact.target === 'ally' ? 0x7cf0a0 : 0xff7a40);
    } else if (this.mode === 'aim' && myTurn) {
      this.overlay.setRay({ x: c.x, y: c.y }, sq, this.field.losBlock(c.x, c.y, sq.x, sq.y), { arc: 0.6 });
      if (occ && e.hostileTo(c, occ) && !isDown(occ)) {
        this.overlay.setReticle(sq, e.canAttack(c, occ).ok ? 0xff5a3c : 0x8a8a8a);
        this.overlay.targetRing.visible = false;
      }
    } else this.overlay.setRay(null, null);
    if (this.mode === 'aim' && myTurn && !occ) content.push(h('div.s', ['No target here']));
    this.overlay.setHover(sq, bad);
    // Keyboard / scripted cursor: anchor the card to the square in the world.
    this.hud.showInspect(content.length ? content : null, pos.x, pos.y, this.mouseClient ? null : sq2w(sq.x, sq.y).setY(occ ? 1.2 : 0.3));
  }

  /** What the active spell does, for the targeting card: a headline number + terse lines. */
  _spellInfo(c, spell) {
    const t = this.engine.tactics(c, spell);
    const lvl = t.level;
    const rng = t.range ? `Range ${t.range}` : 'Self';
    switch (spell) {
      case 'magicMissile': {
        const n = 1 + Math.floor((lvl - 1) / 2);
        return { big: `${n}×`, unit: `missile${n > 1 ? 's' : ''} · 2-5 dmg each`, lines: [`Never misses · no save · ${rng}`] };
      }
      case 'sleep': return { big: '4d4', unit: 'HD fall asleep', lines: ['Weakest first, up to 4+4 HD · no save', `3×3 area · ${rng}`] };
      case 'burningHands': return { big: String(lvl), unit: 'fire damage each', lines: ['Cone of 3 squares · no save'] };
      case 'shockingGrasp': return { big: `1d8+${lvl}`, unit: 'damage', lines: ['Touch · no save'] };
      case 'causeLightWounds': return { big: '1d8', unit: 'damage', lines: ['Touch · no save'] };
      case 'cureLightWounds': return { big: '1d8', unit: 'hit points healed', lines: ['Touch · revives the fallen'] };
      case 'fireball': return { big: `${Math.min(10, lvl)}d6`, unit: 'fire damage', lines: ['Save vs. spell for half', `Radius 2 · ${rng}`] };
      case 'lightningBolt': return { big: `${Math.min(10, lvl)}d6`, unit: 'damage along the line', lines: ['Save vs. spell for half', `Line of 8 · ${rng}`] };
      case 'stinkingCloud': return { big: '2×2', unit: 'nauseating cloud', lines: ['Save vs. poison or retch helplessly', rng] };
      case 'holdPerson': return { big: '≤3', unit: 'humanoids held', lines: ['Save vs. spell (−2 for a lone target)', rng] };
      case 'charmPerson': return { big: '1', unit: 'humanoid charmed', lines: ['Save vs. spell negates', rng] };
      default: return { big: '', unit: SPELLS[spell]?.name ?? '', lines: [SPELLS[spell]?.desc ?? '', rng].filter(Boolean) };
    }
  }

  /** Squares Tab can cycle through: valid targets for the current aim / spell. */
  _validTargets() {
    const c = this.cur;
    const e = this.engine;
    if (!c) return [];
    if (this.mode === 'target') {
      const spell = this.modeData.spell;
      const lv = this.modeData.source?.level;
      const t = e.tactics(c, spell, lv);
      const pool = t.target === 'ally' || t.affects === 'allies' ? e.all.filter((o) => !e.hostileTo(c, o) && !o.fled) : e.enemiesOf(c);
      return pool.filter((o) => e.canCast(c, spell, { x: o.x, y: o.y }, lv).ok);
    }
    return e.enemiesOf(c).filter((o) => e.canAttack(c, o).ok);
  }

  _screenOf(sq) {
    const v = sq2w(sq.x, sq.y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  _pathAdjacent(c, t) {
    const fl = this.engine.reach(c, 60);
    let best = null;
    for (const [dx, dy] of DIR8) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (!this.field.inBounds(x, y)) continue;
      const cost = fl.cost[this.field.idx(x, y)];
      if (!Number.isFinite(cost) || !this.engine.adjacent(c, t, x, y)) continue;
      if (!best || cost < best.cost) best = { x, y, cost };
    }
    return best ? this.field.pathTo(fl, best.x, best.y) : null;
  }

  _provokers(c, path) {
    const out = new Set();
    let px = c.x;
    let py = c.y;
    for (const s of path) {
      for (const e of this.engine.adjacentEnemies(c, px, py)) if (this.engine.awake(e) && !this.engine.adjacent(c, e, s.x, s.y)) out.add(e);
      px = s.x;
      py = s.y;
    }
    return [...out];
  }

  _click() {
    if (this.busy || !this.turnDone || !this.hoverSq) return;
    this._activateSquare(this.hoverSq);
  }

  _activateSquare(sq) {
    const c = this.cur;
    const e = this.engine;
    const occ = e.occupantAt(sq.x, sq.y);
    if (this.mode === 'target') {
      const spell = this.modeData.spell;
      const can = e.canCast(c, spell, sq, this.modeData.source?.level);
      if (!can.ok) {
        this.ctx.ui.message(`${this.modeData.label}: ${can.reason}.`, 'warn');
        this.ctx.audio.sfx('bump');
        return;
      }
      const src = this.modeData.source;
      this._act(() => (src ? e.use(c, src.index, sq) : e.cast(c, spell, sq)));
      return;
    }
    if (occ && e.hostileTo(c, occ)) {
      if (e.canAttack(c, occ).ok) {
        this._act(() => e.attack(c, occ));
        return;
      }
      if (this.mode === 'move' && c.attacksLeft > 0) {
        const p = this._pathAdjacent(c, occ);
        if (p && p.length && p[p.length - 1].cost <= c.mp) {
          this._act(() => {
            const evs = e.move(c, p);
            if (!e.out(c) && e.canAttack(c, occ).ok) evs.push(...e.attack(c, occ));
            return evs;
          }, { endsTurn: false });
        }
      }
      return;
    }
    if (this.mode === 'move' && !occ) {
      const i = this.field.idx(sq.x, sq.y);
      const cost = this.flood?.cost[i];
      if (Number.isFinite(cost) && cost <= c.mp + 1e-6 && cost > 0) this._moveTo(sq, this.field.pathTo(this.flood, sq.x, sq.y));
    }
    if (this.mode === 'aim' && occ && !e.hostileTo(c, occ)) this.hud.showSheet(occ);
  }

  _moveTo(sq, path) {
    this._act(() => this.engine.move(this.cur, path), { endsTurn: false });
  }

  // =================================================================== playback
  /** Play engine events with animation, VFX, floating text and log lines. */
  async play(evs) {
    const e = this.engine;
    // The player has acted: the "your move" banner never lingers over the result.
    if (this.cur?.side === 'party' && this.turnDone && !this._aiActing) this.hud.hideBanner();
    this._veil(evs);
    try {
      await this._playEvents(evs);
    } finally {
      this.veil.clear();
      if (!this.done) this._refresh(this.cur && this.turnDone ? this.cur : e.active());
    }
  }

  /**
   * Roll the displayed state of everyone this batch touches back to before the
   * batch (the engine has already applied it); _reveal() steps it forward as each
   * hit / heal / death actually plays on screen.
   */
  _veil(evs) {
    const e = this.engine;
    const delta = new Map();
    const downs = new Set();
    const add = (id, v) => id && delta.set(id, (delta.get(id) ?? 0) + v);
    for (const ev of evs) {
      if (ev.type === 'attack' && ev.hit) add(ev.target, ev.dmg ?? 0);
      else if (ev.type === 'cast') for (const hh of ev.hits ?? []) add(hh.id, (hh.dmg ?? 0) - (hh.heal ?? 0));
      else if (ev.type === 'heal') add(ev.id, -(ev.amount ?? 0));
      else if (ev.type === 'bleed') add(ev.id, 1);
      else if (ev.type === 'down') downs.add(ev.id);
    }
    for (const id of new Set([...delta.keys(), ...downs])) {
      const c = e.byId(id);
      if (!c) continue;
      const hp = c.hp.cur + (delta.get(id) ?? 0);
      this.veil.set(id, { hp: Math.min(c.hp.max, hp), out: downs.has(id) ? false : e.out(c) });
    }
  }

  /** A result lands: move the displayed hp of `id` by `dhp` (or reveal it fully). */
  _reveal(id, dhp = null) {
    const v = this.veil.get(id);
    if (!v) return;
    if (dhp === null) this.veil.delete(id);
    else v.hp = Math.min(this.engine.byId(id)?.hp.max ?? v.hp, v.hp + dhp);
  }

  async _playEvents(evs) {
    const e = this.engine;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (this.done && ev.type !== 'log') break;
      const fig = ev.id ? this.figures.get(ev.id) : null;
      const actor = ev.id ? e.byId(ev.id) : null;
      this.ctx.bus.emit('combat:event', { ev, engine: e }); // structured feed for the audio director
      switch (ev.type) {
        case 'round':
          this._refresh(e.active());
          if (ev.round > 1) {
            this.hud.showBanner(`Round ${ev.round}`, null, this.time, 0.8);
            this.ctx.ui.message(`— Round ${ev.round} —`, 'system');
          }
          break;
        case 'turn':
          break;
        case 'step': {
          // Gather consecutive steps of this actor into one smooth walk.
          const steps = [ev];
          while (evs[i + 1]?.type === 'step' && evs[i + 1].id === ev.id) steps.push(evs[++i]);
          const pts = steps.map((s) => {
            const p = sq2w(s.x, s.y);
            return { x: p.x, z: p.z };
          });
          if (this.snap) {
            const last = pts[pts.length - 1];
            fig.place(last.x, last.z, facingYaw(actor.facing));
          } else {
            const dur = fig.walkPath(pts, this.time, 0.34 / this.speed);
            this.ctx.audio.sfx('step');
            await this.wait(dur);
          }
          this._refresh(actor);
          if (this.cur === actor && this.turnDone) this._focus(actor, true);
          break;
        }
        case 'attack':
          await this._playAttack(ev, evs, i);
          break;
        case 'down':
          this._reveal(ev.id);
          if (!ev.silent) this._log(ev.text, ev.id && e.byId(ev.id)?.side === 'party' ? 'warn' : 'combat');
          this._down(ev);
          break;
        case 'cast':
          await this._playCast(ev);
          break;
        case 'effect':
          this._log(ev.text, 'combat');
          if (fig) this._say(fig, ev.kind === 'fear' ? 'Panics!' : ev.kind, 'status', this.time);
          if (ev.kind === 'nauseous' && fig) fig.play('hit', this.time, 0.6, { power: 0.5 });
          break;
        case 'heal':
          this._reveal(ev.id, ev.amount ?? 0);
          if (ev.text) this._log(ev.text, 'combat');
          this._maybeRevive(ev.id);
          if (fig) {
            this._say(fig, `+${ev.amount}`, 'heal', this.time);
            this.vfx.heal(this.time, fig.root.position.clone(), this._seed());
          }
          break;
        case 'turnUndead': {
          this._log(ev.text, 'combat');
          fig.play('turn', this.time, 1.6 / this.speed);
          this.vfx.holyLight(this.time + 0.3 / this.speed, fig.root.position.clone(), this._seed());
          this.ctx.audio.sfx('spell');
          await this.wait(1.0 / this.speed);
          for (const id of ev.targets) {
            const f2 = this.figures.get(id);
            if (ev.result === 'turned') this._say(f2, 'Turned!', 'status', this.time);
          }
          break;
        }
        case 'flee': {
          this._log(ev.text, 'warn');
          const p = sq2w(actor.x + ev.dx * 3, actor.y + ev.dy * 3);
          if (!this.snap) await this.wait(fig.walkPath([{ x: p.x, z: p.z }], this.time, 0.3 / this.speed));
          fig.root.visible = false;
          fig.blob.visible = false;
          this.overlay.teamRing(actor.id, actor.side).visible = false;
          break;
        }
        case 'guard':
          this._log(ev.text, 'combat');
          fig.guard = true;
          this._say(fig, 'Guard', 'status', this.time);
          await this.wait(0.3 / this.speed);
          break;
        case 'delay':
          this._log(ev.text, 'combat');
          this._say(fig, 'Delay', 'status', this.time);
          break;
        case 'bandage': {
          this._log(ev.text, 'combat');
          const t = e.byId(ev.target);
          fig.faceTo(yawTo(actor, t), this.time);
          fig.play('kneel', this.time, 1.2 / this.speed);
          this.vfx.heal(this.time + 0.3, this.figures.get(ev.target).root.position.clone(), this._seed());
          await this.wait(1.0 / this.speed);
          this._say(this.figures.get(ev.target), 'Bandaged', 'status', this.time);
          break;
        }
        case 'bleed':
          this._reveal(ev.id, -1);
          this._log(ev.text, 'warn');
          if (fig) this._say(fig, '-1', 'dmg', this.time, { cls: 'party' });
          break;
        case 'wake':
          this._log(ev.text, 'combat');
          fig?.setState('idle');
          break;
        case 'areaEnd':
          this.vfx.kill(`area-${ev.area.center.x},${ev.area.center.y}`);
          this._log('The cloud dissipates.', 'combat');
          break;
        case 'use':
          this._log(ev.text, 'combat');
          fig?.play('cast', this.time, 0.8 / this.speed);
          await this.wait(0.5 / this.speed);
          break;
        case 'fleeFail':
        case 'log':
          this._log(ev.text, ev.kind ?? 'warn');
          break;
        default:
          if (ev.text) this._log(ev.text, 'combat');
      }
      this._refreshLight();
    }
  }

  _log(text, kind = 'combat') {
    if (text) this.ctx.ui.message(text, kind);
  }

  _seed() {
    this._s = (this._s ?? 0) + 1;
    return this._s * 7.13;
  }

  /** Where a death floater sits: just above the victim's body, not the sky. */
  _killPos(fig, from = null) {
    // Where the body comes to rest: half a body-length away from the killer.
    const p = fig.root.position.clone();
    if (from) {
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        p.x += (dx / l) * fig.model.height * 0.45;
        p.z += (dz / l) * fig.model.height * 0.45;
      }
    }
    p.y = 0.35;
    return p;
  }

  /** Floating text pinned to a figure's head (follows hit reacts and falls), stacked per unit. */
  _say(fig, text, kind, t, o = {}) {
    if (!fig) return;
    this.hud.float(text, kind, null, t, { follow: () => this._headPos(fig), unit: fig, ...o });
  }

  /** Just above the head bone (or the model top for rigs without one). */
  _headPos(fig) {
    const p = fig.b?.head ? fig.bonePos('head', new THREE.Vector3()) : fig.root.position.clone().setY(fig.root.position.y + fig.model.height * 0.85);
    p.y += fig.model.height * 0.24;
    return p;
  }

  _head(fig) {
    const p = fig.root.position.clone();
    p.y += fig.model.height * 1.02;
    return p;
  }

  async _playAttack(ev) {
    const e = this.engine;
    const att = e.byId(ev.id);
    const def = e.byId(ev.target);
    const fa = this.figures.get(att.id);
    const fd = this.figures.get(def.id);
    fa.faceTo(yawTo(att, def), this.time);
    if (!ev.aoo && !ev.guard) fd.faceTo(yawTo(def, att), this.time);
    const sp = this.speed;
    const dur = (ev.ranged ? 1.0 : att.monsterId === 'giantRat' ? 0.6 : 0.8) / sp;
    const clip = ev.ranged ? 'shoot' : 'attack';
    const reach = ev.ranged ? 0 : Math.min(0.5, Math.max(0.15, (Battlefield.dist(att.x, att.y, def.x, def.y) * TILE - 1.1) * 0.5 + 0.3));
    if (ev.aoo || ev.guard) this._say(fa, ev.aoo ? 'Free attack!' : 'Guard!', 'status', this.time);
    if (this.snap) {
      this._impact(ev, att, def, fa, fd);
      return;
    }
    fa.play(clip, this.time, dur, { reach });
    this.ctx.audio.sfx('miss', { pitch: 1.4 });
    const tImpact = dur * Figure.impactFrac(clip);
    await this.wait(tImpact);
    if (ev.ranged) {
      const from = fa.bonePos('handR').clone();
      const to = this._head(fd).add(new THREE.Vector3(0, -fd.model.height * 0.45, 0));
      const fl = this.vfx.missile(this.time, from, to, { seed: this._seed() });
      await this.wait(fl);
    } else {
      const at = fd.root.position.clone();
      at.y = fd.model.height * 0.6;
      this.vfx.swipe(this.time - 0.05, fa.root.position.clone().setY(fa.model.height * 0.55), fa.yaw);
    }
    this._impact(ev, att, def, fa, fd);
    await this.wait(dur * (1 - Figure.impactFrac(clip)) * 0.7);
  }

  _impact(ev, att, def, fa, fd) {
    // The blow lands: now the log line, the number and the hp bar.
    this._log(ev.text, 'combat');
    if (ev.hit) this._reveal(def.id, -(ev.dmg ?? 0));
    const at = fd.root.position.clone();
    at.y = fd.model.height * 0.62;
    const t = this.time;
    if (this.snap) {
      // Instant resolution: no frozen sparks or numbers littering the screen.
      this._refresh(this.engine.active());
      return;
    }
    if (ev.hit) {
      fd.play('hit', t, 0.62 / Math.sqrt(this.speed), { power: ev.crit ? 1.6 : ev.dmg > 5 ? 1.25 : 0.95 });
      const bone = def.monsterId === 'skeleton';
      this.vfx.hitSparks(t, at, { crit: ev.crit, seed: this._seed(), bone, blood: !bone });
      this._say(fd, String(ev.dmg), ev.crit ? 'crit' : 'dmg', t, { cls: def.side === 'party' ? 'party' : '', dx: (Math.sin(t * 13) * 0.5) });
      this.ctx.audio.sfx('hit');
      // Every connecting blow gets a beat of hit-stop; heavy ones shake the camera.
      this.hitStop = ev.crit || ev.killed ? 0.09 : ev.ranged ? 0.03 : 0.045;
      if (ev.crit || ev.killed || ev.dmg >= 6) this.vfx.addShake(t, ev.crit ? 0.18 : 0.1, 0.3);
    } else {
      fd.play('hit', t, 0.35 / this.speed, { power: 0.25 });
      this._say(fd, ev.image ? 'Image!' : 'Miss', 'miss', t);
      this.ctx.audio.sfx('miss');
    }
    this._refresh(this.engine.active());
  }

  /** Persistent ground decal (blood pool, bone dust, scorch). */
  _decal(pos, kind, size = 1) {
    const tex = decalTexture(kind);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.6, size * 1.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: kind === 'blood' ? 0.25 : 1, color: kind === 'blood' ? 0x5a0806 : kind === 'scorch' ? 0x080604 : 0xb8b0a0, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.position.set(pos.x + (Math.sin(pos.x * 7) * 0.2), 0.02 + (this._decals?.length ?? 0) * 0.0005, pos.z + (Math.cos(pos.z * 5) * 0.2));
    m.rotation.y = pos.x * 3.1;
    m.renderOrder = 1;
    m.receiveShadow = true;
    this.scene3d.add(m);
    (this._decals ??= []).push(m);
  }

  _maybeRevive(id) {
    const c = this.engine.byId(id);
    const f = this.figures.get(id);
    if (!c || !f || !f.death || isDown(c)) return;
    f.revive(this.time);
    f.blob.visible = true;
    this._say(f, 'Revived', 'status', this.time + 0.2);
  }

  _down(ev) {
    const c = this.engine.byId(ev.id);
    const fig = this.figures.get(ev.id);
    if (!fig || fig.death) return;
    // Topple away from the nearest enemy.
    const foe = this.engine.all.filter((o) => o.side !== c.side && !o.fled).sort((a, b) => Battlefield.dist(a.x, a.y, c.x, c.y) - Battlefield.dist(b.x, b.y, c.x, c.y))[0];
    const from = foe ? sq2w(foe.x, foe.y) : fig.root.position.clone().add(new THREE.Vector3(0, 0, -1));
    this._decal(fig.root.position, c.monsterId === 'skeleton' || c.monsterId === 'zombie' ? 'dust' : 'blood', c.size === 'L' ? 1.6 : c.size === 'S' ? 0.9 : 1.2);
    if (this.snap) {
      fig.die(this.time - 10, from.x, from.z, { holy: ev.holy });
    } else {
      fig.die(this.time, from.x, from.z, { holy: ev.holy });
      this.vfx.dust(this.time + 0.45, this._killPos(fig, from).setY(0), { seed: this._seed(), big: c.size === 'L', night: this.night });
      this.hud.float(c.side === 'party' ? (c.ref.status === 'dead' ? 'Killed' : 'Down') : 'Slain', 'kill', this._killPos(fig, from), this.time + 0.15, { rise: 0.25, solo: c.side === 'party' });
    }
    this.overlay.teamRing(c.id, c.side).visible = false;
    fig.blob.visible = false;
    if (fig.eyeGlow) fig.eyeGlow.visible = false;
    this._refresh(this.engine.active());
  }

  async _playCast(ev) {
    const e = this.engine;
    const c = e.byId(ev.id);
    const fig = this.figures.get(c.id);
    const tact = e.tactics(c, ev.spell);
    this._log(ev.text, 'combat');
    const sp = this.speed;
    const target = sq2w(ev.at.x, ev.at.y);
    if (tact.target !== 'self') fig.faceTo(Math.atan2(target.x - fig.pos.x, target.z - fig.pos.z), this.time);
    const castDur = 1.1 / sp;
    if (!this.snap) {
      fig.play('cast', this.time, castDur);
      const color = { fireball: 0xff8030, cone: 0xff7020, lightning: 0x9ad0ff, sleep: 0xb090ff, cloud: 0xa8c040, missile: 0xa080ff, heal: 0x80ff90, bless: 0xffd070, curse: 0xa03040, hold: 0xc060ff, charm: 0xff80c0, ward: 0x80c0ff, buff: 0xffe080, shock: 0x9ad0ff, cause: 0x802020 }[tact.vfx] ?? 0xffffff;
      this.vfx.castGlow(this.time, () => fig.bonePos(fig.b.handR ? 'handR' : 'head').clone(), color, castDur * 0.75);
      this.ctx.audio.sfx('spell');
      await this.wait(castDur * 0.55);
    }
    const hand = fig.b.handR ? fig.bonePos('handR').clone() : this._head(fig);
    let delay = 0;
    const sq = ev.squares ?? [];
    const cx = sq.length ? sq.reduce((a, s) => a + s.x, 0) / sq.length : ev.at.x;
    const cy = sq.length ? sq.reduce((a, s) => a + s.y, 0) / sq.length : ev.at.y;
    const centre = new THREE.Vector3(cx * TILE + TILE / 2, 0, cy * TILE + TILE / 2);
    const tgtFig = (() => {
      const o = e.occupantAt(ev.at.x, ev.at.y, { includeDown: true });
      return o ? this.figures.get(o.id) : null;
    })();
    const tgtPos = tgtFig ? tgtFig.root.position.clone().setY(tgtFig.model.height * 0.6) : target.clone().setY(1);
    const T = this.time;
    switch (tact.vfx) {
      case 'missile': delay = this.vfx.magicMissile(T, hand, tgtPos, ev.hits?.[0]?.bolts?.length ?? 1, this._seed()); break;
      case 'fireball':
        delay = this.vfx.fireball(T, hand, centre.clone().setY(0.9), (tact.size + 0.5) * TILE, this._seed()).detonate;
        this._decal(centre, 'scorch', (tact.size + 0.5) * TILE * 0.85);
        break;
      case 'cone': delay = this.vfx.coneFire(T, hand, fig.yaw, (tact.size + 0.5) * TILE, this._seed()); break;
      case 'lightning': {
        const last = sq[sq.length - 1] ?? ev.at;
        const end = sq2w(last.x, last.y).setY(1.1);
        delay = this.vfx.lightning(T, hand, end, this._seed());
        break;
      }
      case 'sleep': this.vfx.sleepCloud(T, centre, (tact.size ?? 3) * TILE, this._seed()); delay = 0.9; break;
      case 'cloud': this.vfx.stinkingCloud(T, centre, (tact.size ?? 2) * TILE, `area-${ev.at.x},${ev.at.y}`, this._seed(), { night: this.night }); delay = 0.6; break;
      case 'heal': this.vfx.heal(T, tgtFig ? tgtFig.root.position.clone() : target, this._seed()); delay = 0.4; break;
      case 'bless': for (const s of sq) this.vfx.aura(T, sq2w(s.x, s.y), 0xffd070, this._seed()); delay = 0.5; break;
      case 'curse': for (const s of sq) this.vfx.aura(T, sq2w(s.x, s.y), 0xa03050, this._seed(), { down: true }); delay = 0.5; break;
      case 'hold': for (const s of sq) this.vfx.aura(T, sq2w(s.x, s.y), 0xc060ff, this._seed(), { down: true }); delay = 0.5; break;
      case 'charm': this.vfx.aura(T, target, 0xff80c0, this._seed()); delay = 0.5; break;
      case 'shock': this.vfx.lightning(T, hand, tgtPos, this._seed()); delay = 0.1; break;
      case 'cause': this.vfx.aura(T, target, 0x802020, this._seed(), { down: true }); delay = 0.3; break;
      default: this.vfx.aura(T, tgtFig ? tgtFig.root.position.clone() : fig.root.position.clone(), 0x80c0ff, this._seed()); delay = 0.4;
    }
    await this.wait(delay);
    // The fireball's money frame: time all but stops for a beat as it blooms.
    if (tact.vfx === 'fireball' && !this.snap) {
      this.hitStop = 0.32;
      this.hitStopScale = 0.18;
    }
    // Apply results.
    for (const hh of ev.hits ?? []) {
      if (hh.text) this._log(hh.text, 'combat');
      if (!hh.id) continue;
      this._reveal(hh.id, (hh.heal ?? 0) - (hh.dmg ?? 0));
      const f2 = this.figures.get(hh.id);
      if (!f2) continue;
      if (hh.dmg) {
        f2.play('hit', this.time, 0.6 / Math.sqrt(sp), { power: 1.3 });
        if (tact.vfx === 'fireball' || tact.vfx === 'cone') {
          f2.burn(this.time);
          if (!this.snap) this.vfx.bodyFire(this.time, () => f2.root.position, f2.model.height, this._seed(), 1.8);
        }
        if (tact.vfx === 'fireball') f2.knock(this.time, f2.pos.x - centre.x, f2.pos.z - centre.z, 0.45);
        // Every number rides its own victim's head, coloured by the damage type,
        // with a name plate + hp tick for area spells (who took what).
        const area = tact.shape !== 'single';
        const k = (ev.hits ?? []).indexOf(hh);
        const vic = e.byId(hh.id);
        const dtype = { fireball: 'fire', cone: 'fire', missile: 'magic', lightning: 'shock', shock: 'shock' }[tact.vfx] ?? '';
        const shownHp = this.veil.has(hh.id) ? this.veil.get(hh.id).hp : vic.hp.cur;
        this._say(f2, String(hh.dmg), 'dmg', this.time + (hh.saved ? 0.05 : 0) + (area ? 0.08 + k * 0.05 : 0), {
          cls: `${vic.side === 'party' ? 'party' : ''} ${dtype}`,
          tag: area ? { name: vic.name, hp: Math.max(0, shownHp) / vic.hp.max, lost: hh.dmg / vic.hp.max } : null,
        });
        if (tact.vfx === 'missile') this.vfx.hitSparks(this.time, this._head(f2).add(new THREE.Vector3(0, -0.5, 0)), { blood: false, seed: this._seed() });
      }
      if (hh.heal) {
        this._say(f2, `+${hh.heal}`, 'heal', this.time);
        this._maybeRevive(hh.id);
      }
      if (hh.effect === 'asleep') {
        f2.setState('asleep');
        (this._zzz ??= new Set()).add(hh.id);
        this.vfx.sleepZ(this.time + 0.3, () => this._headPos(f2), `z-${hh.id}`, this._seed());
        this._say(f2, 'Asleep', 'status', this.time + 0.2);
      }
      if (hh.effect === 'held') this._say(f2, 'Held', 'status', this.time);
      if (hh.effect === 'nauseous') this._say(f2, 'Nauseous', 'status', this.time);
      if (hh.effect === 'charmed') {
        this._say(f2, 'Charmed', 'status', this.time);
        this.overlay.teamRing(hh.id, 'party');
      }
      if (hh.effect === 'resist') this._say(f2, 'Resists', 'miss', this.time);
    }
    if (tact.vfx === 'lightning') this.hitStop = 0.06;
    await this.wait(0.35 / sp);
  }

  // =================================================================== camera
  _focus(c, soft = false) {
    if (!c || this.cam.userPanned) return;
    this._frameCombatants(false, c, soft);
  }

  /**
   * Frame the fight around the acting unit: it, its likely targets (the nearest
   * foes) and the allies at its side, plus ~2 squares of margin — close enough
   * that faces, weapons and silhouettes read (≈90-140 px figures at 1600x900).
   * When the fight is spread out the frame favours the actor over the far foes.
   */
  _frameCombatants(snap = false, focus = null, soft = false, all = false) {
    const e = this.engine;
    const live = e.all.filter((c) => !e.out(c));
    if (!live.length) return;
    const act = focus ?? e.active() ?? this.demoActive ?? live.find((c) => c.side === 'party') ?? live[0];
    const d = (a, b) => Battlefield.dist(a.x, a.y, b.x, b.y);
    const foes = live.filter((o) => o.side !== act.side && !o.charmed).sort((a, b) => d(a, act) - d(b, act));
    const near = foes.filter((f) => d(f, act) <= 7).slice(0, 3);
    if (!near.length && foes[0]) near.push(foes[0]);
    const allies = live.filter((o) => o !== act && o.side === act.side && d(o, act) <= 2.5);
    const MIN = 10.5;
    // Keep the whole fight in view when it fits (a stable tactical camera);
    // otherwise frame the actor, its likely targets and its neighbours.
    const MAX = all ? 21.5 : 18.5;
    let fit = this._fitBox(live);
    if (fit.need > MAX) fit = this._fitBox([act, ...near, ...allies]);
    // Too spread out: keep the actor and its nearest foe (and its neighbours) only.
    if (fit.need > MAX && near.length > 1) fit = this._fitBox([act, near[0], ...allies.filter((o) => d(o, act) <= 1.5)]);
    let { cx, cz, need } = fit;
    const ap = sq2w(act.x, act.y);
    if (need > MAX) {
      const k = Math.min(0.3, 1 - MAX / need);
      cx += (ap.x - cx) * k;
      cz += (ap.z - cz) * k;
    }
    const dist = Math.max(MIN, Math.min(MAX, need));
    this.fightCenter = new THREE.Vector3(cx, 0, cz);
    if (soft) {
      // Small corrections while walking: drift, don't lurch.
      this.cam.goalTarget.lerp(this.fightCenter, 0.5);
    } else this.cam.goalTarget.set(cx, 0, cz);
    this.cam.goalDist = dist;
    if (snap) {
      this.cam.target.copy(this.cam.goalTarget);
      this.cam.dist = dist;
    }
  }

  /** Camera distance needed to fit a set of combatants (+ margin), and the box centre. */
  _fitBox(set) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const c of set) {
      const p = sq2w(c.x, c.y);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const m = 2.4;
    z0 -= 1.0;
    const hw = (x1 - x0) / 2 + m;
    const hd = (z1 - z0) / 2 + m;
    const sa = this._safeArea();
    const fov = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * sa.h);
    const hf = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect * sa.w);
    const pitch = this.cam.goalPitch;
    const cy = Math.abs(Math.cos(this.cam.goalYaw));
    const syw = Math.abs(Math.sin(this.cam.goalYaw));
    const ex = hw * cy + hd * syw;
    const ez = hw * syw + hd * cy;
    const dW = ex / Math.tan(hf / 2) + ez * Math.cos(pitch) * 0.5;
    const dD = (ez * Math.sin(pitch)) / Math.tan(fov / 2) + ez * Math.cos(pitch);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 + 0.5, need: Math.max(dW, dD) };
  }

  /** Pick the opening camera bearing that hides the fewest buildings (least cut-away). */
  _chooseYaw({ around = null } = {}) {
    const pts = [];
    for (const c of around ?? this.engine.all) {
      if (this.engine.out(c)) continue;
      const p = sq2w(c.x, c.y);
      pts.push(new THREE.Vector3(p.x, 0.2, p.z), new THREE.Vector3(p.x, 1.6, p.z));
    }
    let best = null;
    const live = this.engine.all.filter((c) => !this.engine.out(c));
    const mean = (side) => {
      const l = live.filter((c) => c.side === side);
      return l.length ? l.reduce((a, c) => a.add(sq2w(c.x, c.y)), new THREE.Vector3()).multiplyScalar(1 / l.length) : null;
    };
    const pm = mean('party');
    const mm = mean('monster');
    let sep = pm && mm && pm.distanceTo(mm) > 0.1 ? mm.sub(pm).setY(0).normalize() : null;
    if (around?.length >= 2) sep = sq2w(around[1].x, around[1].y).sub(sq2w(around[0].x, around[0].y)).setY(0).normalize();
    const marks = (this.field.features?.props ?? []).filter((p) => p.type === 'statue' || p.type === 'altar').map((p) => Object.assign(new THREE.Vector3(p.x * TILE + TILE / 2, p.type === 'statue' ? 2.2 : 1.0, p.y * TILE + TILE / 2), { w: p.type === 'statue' ? 8 : 4 }));
    const probe = this.camera.clone();
        const yaws = around ? Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2 - Math.PI) : [0.32, -0.32, 0, 0.62, -0.62, 0.95, -0.95, Math.PI / 2, -Math.PI / 2];
    for (const yaw of yaws) {
      const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.cam.pitch), Math.sin(this.cam.pitch), Math.cos(yaw) * Math.cos(this.cam.pitch)).multiplyScalar(this.cam.goalDist);
      const pos = this.cam.goalTarget.clone().add(off);
      // Prefer a bearing that lays the two sides out across the (wide) screen.
      const along = sep ? Math.abs(sep.x * Math.sin(yaw) + sep.z * Math.cos(yaw)) : 0;
      let crowd = 0;
      if (around) {
        // Close-ups: don't shoot over the shoulders of bystanders (they'd fill the foreground).
        const mid = sq2w((around[0].x + around[1].x) / 2, (around[0].y + around[1].y) / 2);
        const toCam = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        for (const c of live) {
          if (around.includes(c)) continue;
          const d = sq2w(c.x, c.y).sub(mid);
          const ahead = d.dot(toCam);
          const lateral = Math.abs(d.x * toCam.z - d.z * toCam.x);
          if (ahead > 0.5 && ahead < 9 && lateral < 4) crowd += 1.5;
        }
      }
      // Landmarks (Tyr's statue, the altar) composed into the visible frame read
      // as a place, not a board: reward bearings that keep them clear of the HUD.
      let land = 0;
      if (!around && marks.length) {
        probe.position.copy(pos);
        probe.lookAt(this.cam.goalTarget.x, 0.6, this.cam.goalTarget.z);
        probe.updateMatrixWorld(true);
        for (const m of marks) {
          const v = m.clone().project(probe);
          if (v.z < 1 && v.x > -0.7 && v.x < 0.35 && v.y > -0.6 && v.y < 0.6) land += m.w;
        }
      }
      const n = this.diorama.occluders(pos, pts) * (around ? 3 : 1) + (around ? 0 : Math.abs(yaw - 0.32) * 2) + along * 14 + crowd - land;
      if (this.params.camlog) console.warn('YAW', yaw.toFixed(2), 'occ', this.diorama.occluders(pos, pts), 'along', along.toFixed(2), 'land', land, 'n', n.toFixed(2));
      if (!best || n < best.n) best = { n, yaw };
    }
    this.cam.yaw = this.cam.goalYaw = best.yaw;
  }

  /** Fraction of the screen not covered by HUD chrome, and its centre offset. */
  _safeArea() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const em = Math.max(12, Math.min(25.6, 16 * (H / 900)));
    const right = 19.5 * em;
    const top = 6.6 * em;
    const bottom = 4.6 * em;
    return { w: (W - right) / W, h: (H - top - bottom) / H, ox: right / 2, oy: (bottom - top) / 2, W, H };
  }

  _applyViewOffset() {
    const sa = this._safeArea();
    this.camera.setViewOffset(sa.W, sa.H, sa.ox, sa.oy, sa.W, sa.H);
  }

  _updateCamera(dt, snap = false) {
    const cam = this.cam;
    const a = snap || this.frozen ? 1 : 1 - Math.exp(-dt * 4);
    cam.yaw += (cam.goalYaw - cam.yaw) * a;
    cam.pitch += (cam.goalPitch - cam.pitch) * a;
    cam.dist += (cam.goalDist - cam.dist) * a;
    cam.target.lerp(cam.goalTarget, a);
    const t = cam.target;
    const off = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)).multiplyScalar(cam.dist);
    this.camera.position.copy(t).add(off);
    const sh = this.vfx.shakeOffset(this.time);
    this.camera.position.add(sh);
    this.camera.lookAt(t.x + sh.x * 0.5, t.y + 0.6, t.z + sh.z * 0.5);
    this._occlusion();
  }

  /** Points that must stay visible: every standing combatant (feet, chest, head) and the cursor. */
  _occlusion() {
    const pts = this._occPts ?? (this._occPts = []);
    let n = 0;
    const push = (x, y, z) => {
      if (!pts[n]) pts[n] = new THREE.Vector3();
      pts[n++].set(x, y, z);
    };
    for (const c of this.engine.all) {
      const f = this.figures.get(c.id);
      if (!f || !f.root.visible || c.fled) continue;
      const p = f.root.position;
      const hgt = this.engine.out(c) ? 0.3 : f.model.height;
      push(p.x, 0.15, p.z);
      push(p.x, hgt * 0.55, p.z);
      push(p.x, hgt, p.z);
    }
    if (this.hoverSq) push(this.hoverSq.x * TILE + TILE / 2, 0.1, this.hoverSq.y * TILE + TILE / 2);
    pts.length = n;
    this.diorama.setView(this.camera.position, pts, this.camera);
    // Fade hole: centred on the view target, wide enough for the visible actors.
    const r = this.ctx.render.renderer;
    const buf = r.getDrawingBufferSize(this._buf ??= new THREE.Vector2());
    const v = this._hv ??= new THREE.Vector3();
    v.copy(this.cam.target).setY(0.8).project(this.camera);
    const cx = (v.x * 0.5 + 0.5) * buf.x;
    const cy = (v.y * 0.5 + 0.5) * buf.y;
    let rad = buf.y * 0.2;
    for (let i = 0; i < n; i += 3) {
      v.copy(pts[i + 1] ?? pts[i]).project(this.camera);
      if (Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      rad = Math.max(rad, Math.hypot((v.x * 0.5 + 0.5) * buf.x - cx, (v.y * 0.5 + 0.5) * buf.y - cy) + buf.y * 0.1);
    }
    this.diorama.setHole(cx, cy, Math.min(buf.y * 0.48, rad));
  }

  // =================================================================== HUD refresh
  _refresh(activeC) {
    const e = this.engine;
    const act = activeC ?? e.active();
    this.hud.setTimeline(e, act?.id, {
      onHover: (id) => {
        this.hoverTimeline = id;
      },
      onClick: (id) => {
        const c = e.byId(id);
        if (c) this.hud.showSheet(c);
      },
    });
    if (!this.done) this.hud.setCard(act, e);
    this.hud.setRoster(e, act?.id, (c) => {
      c.quick = !c.quick;
      this.ctx.ui.message(`${c.name}: ${c.quick ? 'QUICK (computer control)' : 'manual control'}.`, 'system');
      this._refresh(this.engine.active());
      if (c.quick && this.cur === c && this.turnDone && !this.busy) this._handOverToAi(c);
    });
    this._commands();
  }

  _refreshLight() {}

  _updateFigures() {
    const t = this.time;
    // Sleepers' "Z"s end when they wake (or fall).
    if (this._zzz?.size) {
      for (const id of [...this._zzz]) {
        const c = this.engine.byId(id);
        if (!c || !c.fx?.asleep || this.engine.out(c)) {
          this.vfx.kill(`z-${id}`);
          this._zzz.delete(id);
        }
      }
    }
    for (const c of this.engine.all) {
      const fig = this.figures.get(c.id);
      if (!fig) continue;
      fig.update(t);
      const p = fig.root.position;
      fig.blob.position.set(p.x, 0.018, p.z);
      fig.proxy.position.set(p.x, 0, p.z);
      const ring = this.overlay.teamRing(c.id, c.charmed ? 'party' : c.side);
      ring.position.set(p.x, 0.03, p.z);
      ring.visible = !this.done && !this.engine.out(c) && fig.root.visible;
      const hl = this.hoverTimeline === c.id;
      ring.scale.setScalar(hl ? 1.25 : 1);
    }
    const act = this.engine.active() ?? this.demoActive;
    const af = act && this.figures.get(act.id);
    if (af && !this.engine.out(act) && !this.done) {
      this.overlay.activeRing.visible = true;
      this.overlay.activeRing.position.set(af.root.position.x, 0.035, af.root.position.z);
      // A gilt marker bobbing over the active figure's head: findable in a crowd.
      this.overlay.activeMarker.visible = act.side === 'party' && !this.busy;
      this.overlay.activeMarker.position.set(af.root.position.x, af.model.height * 1.05 + 0.42 + Math.sin(this.time * 3) * 0.05, af.root.position.z);
      this.overlay.setFocus(undefined, { x: act.x, y: act.y });
    } else {
      this.overlay.activeRing.visible = false;
      this.overlay.activeMarker.visible = false;
      this.overlay.setFocus(undefined, null);
    }
  }

  // =================================================================== frame
  update(dt) {
    this._frames = (this._frames ?? 0) + 1;
    if (!this.frozen) {
      const wasSnap = this.snap;
      this._slowFrames = dt >= 0.099 ? Math.min(10, (this._slowFrames ?? 0) + 1) : Math.max(0, (this._slowFrames ?? 0) - 1);
      if (this.snap && !wasSnap) {
        for (const w of this._waits) w.res();
        this._waits = [];
      }
    }
    if (this._frameWaiters?.length) {
      const fw = this._frameWaiters;
      this._frameWaiters = [];
      for (const r of fw) r();
    }
    if (this._frames === 2) {
      this._updateFigures();
      performance.mark?.('combat:frame1');
      this._renderPortraits();
      performance.mark?.('combat:portraits');
    }
    // Hit-stop briefly slows combat time for punch.
    let scale = this.speed >= 2.4 ? 1 : 1;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      scale = this.hitStopScale ?? 0.12;
      if (this.hitStop <= 0) this.hitStopScale = null;
    }
    // Low frame rates (e.g. software GL) clamp dt to 0.1 s; pace combat by the
    // real frame time instead (capped), so playback keeps wall-clock speed.
    // (performance.now() only measures hardware pacing here, never drives a pose.)
    const nowMs = performance.now();
    this._frameMs = this._lastMs ? nowMs - this._lastMs : 16;
    this._lastMs = nowMs;
    const realDt = dt >= 0.099 ? Math.min(0.6, this._frameMs / 1000) : dt;
    if (!this.frozen) this.time += realDt * scale;
    else this.time = this.ctx.clock.time;
    const t = this.time;
    this._runTimed();
    // Resolve waits.
    if (this._waits.length) {
      const due = this._waits.filter((w) => w.t <= t);
      this._waits = this._waits.filter((w) => w.t > t);
      for (const w of due) w.res();
    }
    this._updateFigures();
    const rr = this.ctx.render;
    const pixNow = (rr.height * rr.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.diorama.update(t, pixNow);
    this.fill.position.copy(this.camera.position);
    this.fill.target.position.copy(this.cam.target);
    this.rim.position.set(this.cam.target.x * 2 - this.camera.position.x, this.camera.position.y * 0.6, this.cam.target.z * 2 - this.camera.position.z);
    this.rim.target.position.copy(this.cam.target);
    for (const l of this.torchLights) {
      const s = l.userData.seed;
      l.intensity = l.userData.hidden ? 0 : l.userData.base * (0.86 + 0.09 * Math.sin(t * 11 + s) + 0.05 * Math.sin(t * 23.7 + s * 3));
      // The flame gutters: its light pool sways a little across the stones.
      if (l.userData.home) l.position.set(l.userData.home.x + Math.sin(t * 7.3 + s) * 0.05, l.userData.home.y + Math.sin(t * 9.1 + s * 2) * 0.04, l.userData.home.z + Math.sin(t * 6.1 + s * 3) * 0.05);
    }
    this.overlay.update(t);
    this._updateCamera(dt);
    const r = this.ctx.render;
    const pix = (r.height * r.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.vfx.update(t, this.camera, pix, (this._res ??= new THREE.Vector2()).set(r.width ?? window.innerWidth, r.height ?? window.innerHeight));
    // Spell flashes kick the exposure for a few frames (white-hot fireball glare).
    r.renderer.toneMappingExposure = (this.post?.exposure ?? 1) * (1 + (this.vfx.exposure ?? 0));
    this.hud.update(t, this.camera, window.innerWidth, window.innerHeight);
  }

  /**
   * Frozen clock (screenshots): the 3D frame is identical from the first frame
   * on, so after two settled renders the canvas simply keeps its last image —
   * a software-GL frame costs seconds and the HUD lives in the DOM anyway.
   */
  render() {
    if (this.frozen && (this._renders ?? 0) >= 3 && this._frames > 3) return;
    this._renders = (this._renders ?? 0) + 1;
    super.render();
  }

  onResize() {
    this._renders = 0;
    this.camera.aspect = this.ctx.render.aspect;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // =================================================================== end of battle
  async finish(winner) {
    if (this.done) return;
    this.done = true;
    this._signalIdle?.();
    this.busy = true;
    this._clearTargeting();
    const { game, ui, scenes, rng } = this.ctx;
    // Rules: combat-only effects (held, asleep, charmed, hasted, nauseous...) end with the battle.
    endBattle(this.party);
    this.ctx.bus.emit('combat:end', { winner }); // audio: victory coda / defeat
    if (winner === 'party') {
      // Let the last death and its VFX settle before the fanfare.
      if (!this.snap) await this.wait(Math.max(0.9, this.vfx.busyUntil?.(this.time) ?? 0));
      this._clearBattlefield();
      for (const c of this.party) if (!this.engine.out(c)) this.figures.get(c.id).play('cheer', this.time, 1.4);
      this.hud.showBanner('Victory', this.encounter.name, this.time, 1.5);
      this.hud.setSummary(this._summary('party'));
      await this.wait(1.4);
      // The dialog carries its own VICTORY header: no second title above it.
      this.hud.hideBanner();
      const xp = xpForVictory(this.monsters);
      const living = game.party.filter((c) => c.status === 'ok');
      const share = Math.floor(xp / Math.max(1, living.length));
      for (const c of living) awardXp(c, share);
      // Rules spoils: the encounter's own gold/items plus MM treasure types of the slain.
      const spoils = victorySpoils(rng, this.encounter.treasure, this.monsters.filter((m) => isDown(m)).map((m) => m.ref));
      const gold = spoils.gold;
      if (gold && living[0]) living[0].gold += gold;
      for (const it of spoils.items) living[0]?.inventory.push(it);
      game.notifyPartyChanged();
      await ui.dialog({ title: 'Victory', body: `The party is victorious! Each survivor receives ${share} experience points.${spoils.text ? ` ${spoils.text}` : ''}` });
      scenes.goto('explore', {});
    } else if (winner === 'monster') {
      this._clearBattlefield();
      this.hud.showBanner('Defeat', null, this.time, 1.5);
      this.hud.setSummary(this._summary('monster'));
      await this.wait(1.4);
      this.hud.hideBanner();
      await ui.dialog({ title: 'Defeat', body: 'The party has fallen. Phlan will not be reclaimed today...' });
      scenes.goto('title');
    } else {
      game.notifyPartyChanged();
      ui.message('The party escapes into the ruins.', 'warn');
      scenes.goto('explore', {});
    }
  }

  /** Battle over: strip every tactical overlay, callout, aura and lingering cloud. */
  _clearBattlefield() {
    this.hud.clearFloats();
    this.overlay.setRange(null, 0);
    this.overlay.setTemplate([]);
    this.overlay.setHover(null);
    this.overlay.setPath(null, null);
    this.overlay.setRay(null, null);
    this.overlay.targetRing.visible = false;
    this.overlay.setReticle(null);
    this.overlay.activeRing.visible = false;
    this.overlay.activeMarker.visible = false;
    for (const r of this.overlay.teamRings.values()) r.visible = false;
    this.vfx.clearLingering?.();
    this.cur = null;
    this.hud.setCommands((this._cmdList ?? []).map((c) => ({ ...c, disabled: true })), null);
  }

  /** Rows for the aftermath card (replaces the stale turn card). */
  _summary(winner) {
    const e = this.engine;
    const slain = this.monsters.filter((m) => e.out(m) && !m.fled).length;
    const fled = this.monsters.filter((m) => m.fled).length;
    const standing = this.party.filter((c) => !e.out(c) && !c.fled).length;
    const fallen = this.party.filter((c) => e.out(c)).length;
    const xp = winner === 'party' ? xpForVictory(this.monsters) : 0;
    const living = this.party.filter((c) => c.ref.status === 'ok').length;
    return {
      title: winner === 'party' ? 'Aftermath' : 'Fallen',
      name: this.encounter.name,
      rows: [
        ['Rounds fought', String(Math.max(1, e.round))],
        ['Foes slain', `${slain}${fled ? ` (+${fled} fled)` : ''}`],
        ['Party standing', `${standing} / ${this.party.length}`],
        fallen ? ['Fallen', String(fallen)] : null,
        winner === 'party' ? ['Experience each', String(Math.floor(xp / Math.max(1, living)))] : null,
      ].filter(Boolean),
    };
  }

  exit() {
    for (const w of this._waits ?? []) w.res();
    this._waits = [];
    this.done = true;
    super.exit();
    for (const f of this.figures?.values() ?? []) {
      f.dispose();
      f.proxy.geometry.dispose();
    }
    this.vfx?.dispose();
    this.overlay?.dispose();
    this.diorama?.dispose();
    this._blobGeo?.dispose();
    this._blobMat?.dispose();
    this._blobCoreMat?.dispose();
    this._preRT?.dispose();
    for (const m of Object.values(this._eyeMat ?? {})) m.dispose();
    for (const d of this._decals ?? []) {
      d.geometry.dispose();
      d.material.dispose();
    }
  }
}

function facingYaw(f) {
  const [dx, dy] = DIR8[f ?? 0];
  return Math.atan2(dx, dy);
}

const _decalTex = {};
function decalTexture(kind) {
  if (_decalTex[kind]) return _decalTex[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rnd = (i) => {
    const x = Math.sin(i * 127.1 + kind.length * 31.7) * 43758.5453;
    return x - Math.floor(x);
  };
  g.fillStyle = '#fff';
  const blobs = kind === 'scorch' ? 26 : 14;
  for (let i = 0; i < blobs; i++) {
    const a = rnd(i) * Math.PI * 2;
    const r = (kind === 'scorch' ? 12 : 6) + rnd(i + 50) * 30;
    const x = 64 + Math.cos(a) * r * (i ? 1 : 0);
    const y = 64 + Math.sin(a) * r * (i ? 1 : 0);
    const rad = (i ? 6 + rnd(i + 99) * 14 : 26) * (kind === 'scorch' ? 1.4 : 1);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(255,255,255,${kind === 'scorch' ? 0.55 : 0.9})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // Splatter droplets.
  for (let i = 0; i < 40; i++) {
    const a = rnd(i + 300) * Math.PI * 2;
    const r = 30 + rnd(i + 400) * 30;
    g.fillStyle = `rgba(255,255,255,${0.4 + rnd(i + 500) * 0.5})`;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1 + rnd(i + 600) * 2.5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  _decalTex[kind] = t;
  return t;
}

let _blob = null;
function blobTexture() {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _blob = new THREE.CanvasTexture(c);
  return _blob;
}

export { ENCOUNTERS, ITEMS };
