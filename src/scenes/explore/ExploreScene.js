import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { DIRS, DIR_YAW, DIR_VEC, EDGE, EDGE_NAMES, turnLeft, turnRight, OPPOSITE } from '../../data/maps/MapGrid.js';
import { createSkyDome, createFlameBatch, createGlowBatch, timeOfDayKeys, setSurfaceAtmosphere, FLAME_UNIFORMS, flicker } from '../../render/lighting.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { preloadMaterials, setWindowGlow, getLampGlassMaterial, getWindowMaterial, getMaterial } from '../../render/materials.js';
import { preloadTextureSets } from '../../render/textures/index.js';
import { createStandardHud } from '../../ui/StandardHud.js';
import { buildBlock, disposeBlock, cellCenter, EYE_H, CELL_SIZE } from './BlockBuilder.js';
import { buildProps, buildLightShafts, PROP_UNIFORMS } from './Props.js';
import { buildSkyline } from './Skyline.js';
import { createParticles } from './Particles.js';
import { buildSunShafts } from './Atmosphere.js';
import { tilesetFor, tilesetMaterials } from './tilesets.js';
import { hasDemoMap, getDemoMap } from './demoMaps.js';
import { deriveStats } from '../../rules/character.js';
import { SHOPS } from '../../data/shops.js';

const STEP_TIME = 0.34;
const TURN_TIME = 0.24;
const DOOR_STEP = 1.55; // step-time multiplier when passing through a door
const POOL_LIGHTS = 3;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * First-person grid exploration (Gold Box style movement: one cell per step,
 * 90° turns) rendered as a full 3D scene with smooth interpolation.
 *
 * enter params: {map?, x?, y?, dir?, hour?, tileset?}  (defaults: game.location)
 * Owned by the explore-renderer workstream.
 */
export default class ExploreScene extends Scene {
  async enter(params = {}) {
    const { game, render } = this.ctx;
    const loc = { ...game.location };
    if (params.map && (hasMap(params.map) || hasDemoMap(params.map))) loc.map = params.map;
    if (Number.isFinite(params.x)) loc.x = params.x;
    if (Number.isFinite(params.y)) loc.y = params.y;
    if (params.dir && DIRS.includes(params.dir)) loc.dir = params.dir;
    this.demo = !hasMap(loc.map) && hasDemoMap(loc.map);
    this.map = this.demo ? getDemoMap(loc.map) : getMap(loc.map);
    game.location = loc;
    this.pos = { x: loc.x, y: loc.y, dir: loc.dir };
    this.hour = Number.isFinite(params.hour) ? params.hour : game.clock.hour + game.clock.minute / 60;
    this.tileset = tilesetFor(this.map, params.tileset);
    const ts = this.tileset;
    this.keys = timeOfDayKeys(this.hour);
    this.night = ts.outdoors ? this.keys.night : 1; // torch-lit state
    this.skyNight = this.keys.night; // what the windows show

    // textures in parallel workers before building anything
    await Promise.all([preloadMaterials(tilesetMaterials(ts)), ts.outdoors ? preloadTextureSets(['hd_water']) : null]);

    this.scene3d = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, render.aspect, 0.05, 900);
    this.scene3d.add(this.camera);
    this._setupLighting();

    this._buildBlock();
    if (!ts.outdoors && this.sun && this.block.windows.length) {
      const n = new THREE.Vector3();
      for (const w of this.block.windows) n.add(w.N);
      n.normalize();
      this.sunDir.set(n.x, 1.0, n.z).normalize();
    }
    this._buildShafts();
    if (ts.skyline) {
      this.skyline = buildSkyline(this.map, ts, { night: this.night, hour: this.hour });
      this.scene3d.add(this.skyline.group);
    }
    this._setupParticles();
    this._setupEnvironment();

    this.post = this._postFor();

    this.hud = createStandardHud(this.ctx, {
      commands: [
        { id: 'area', label: 'Area', key: this.ctx.input.label('area'), action: 'area', tip: 'Overhead map', onSelect: () => this.cmdArea() },
        { id: 'cast', label: 'Cast', key: this.ctx.input.label('cast'), action: 'cast', tip: 'Cast a spell', onSelect: () => this.cmdCast() },
        { id: 'view', label: 'View', key: this.ctx.input.label('view'), action: 'view', tip: 'View character', onSelect: () => this.cmdView() },
        { id: 'encamp', label: 'Encamp', key: this.ctx.input.label('encamp'), action: 'encamp', tip: 'Make camp: rest, save, memorize', onSelect: () => this.cmdEncamp() },
        { id: 'search', label: 'Search', key: this.ctx.input.label('search'), action: 'search', tip: 'Search for secret doors', onSelect: () => this.cmdSearch() },
        { id: 'look', label: 'Look', key: this.ctx.input.label('look'), action: 'look', tip: 'Examine what lies ahead', onSelect: () => this.cmdLook() },
      ],
    });
    this.own(() => this.hud.dispose());
    this.listen('input:action', (e) => {
      this._unsettle();
      this._onAction(e.action);
    });
    this.listen('settings:changed', () => this._unsettle());

    this.tween = null;
    this._placeCamera(this.pos.x, this.pos.y, DIR_YAW[this.pos.dir], 0, 0);
    this._assignLights(true);
    this._updateHud();
    game.markExplored(this.map.id, this.pos.x, this.pos.y, this.map.w);
    this.ctx.ui.message(`You stand in ${this.map.zoneAt(this.pos.x, this.pos.y)}.`, 'lore');
    this.ctx.audio.playMusic(this.map.kind === 'city' ? 'phlan_streets' : 'dungeon');
    this.ready = true;
  }

  // ---------------------------------------------------------------- lighting
  _setupLighting() {
    const ts = this.tileset;
    const k = this.keys;
    const s = this.scene3d;
    if (ts.outdoors) {
      this.sky = createSkyDome({ hour: this.hour, cloud: 0.55 });
      this.sky.renderOrder = 20; // last opaque: early-z rejects everything already covered
      s.add(this.sky);
      const night = k.night > 0.5;
      // grade: warm key, cool sky fill — a clear sun-to-ambient ratio by day
      const skyFill = night ? new THREE.Color(k.sky) : new THREE.Color(k.sky).lerp(new THREE.Color(0xd6dce6), 0.5);
      // sunlit paving bounces warm light up into the shade
      const bounce = night ? new THREE.Color(k.ground).multiplyScalar(1.2) : new THREE.Color(k.ground).lerp(new THREE.Color(0x9a8064), 0.75).lerp(new THREE.Color(k.sun), 0.15);
      this.hemi = new THREE.HemisphereLight(skyFill, bounce, k.hemi * (night ? 2.3 : 2.0));
      s.add(this.hemi);
      const sunCol = night ? new THREE.Color(0x9db4ff) : new THREE.Color(k.sun).lerp(new THREE.Color(0xffd6a0), 0.3);
      this.sun = new THREE.DirectionalLight(sunCol, night ? 1.15 : k.sunI * 1.85);
      this.sunDir = (night ? k.moonDir : k.trueSunDir).clone();
      if (!night) this.sunDir.y *= 0.75; // lower arc → longer, more legible shadows
      if (this.sunDir.y < 0.2) this.sunDir.y = 0.2;
      this.sunDir.normalize();
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const cam = this.sun.shadow.camera;
      cam.left = -26;
      cam.right = 26;
      cam.top = 26;
      cam.bottom = -26;
      cam.near = 1;
      cam.far = 200;
      this.sun.shadow.bias = -0.00035;
      this.sun.shadow.normalBias = 0.035;
      this.sun.shadow.radius = 2.5;
      s.add(this.sun, this.sun.target);
      // cool sky bounce from the side away from the sun (no shadows)
      this.fill = new THREE.DirectionalLight(night ? 0x5a6a9a : 0x9cb2d8, night ? 0.3 : k.sunI * 0.14);
      this.fill.position.set(-this.sunDir.x * 50, 30, -this.sunDir.z * 50);
      s.add(this.fill);
      s.fog = new THREE.FogExp2(k.fog, k.fogDensity * (this.map.harbour ? 0.38 : 0.72));
      setSurfaceAtmosphere({
        sunDir: k.trueSunDir.y > -0.05 ? k.trueSunDir : k.moonDir,
        sunColor: k.sunCol,
        scatter: k.scatter * 0.55,
        heightFog: 0.12 + k.night * 0.22 + (k.scatter > 0.8 ? 0.15 : 0),
        heightFalloff: 0.45,
        grimeTint: ts.grime,
        mossTint: ts.moss,
        wet: 0.4,
      });
    } else {
      const dungeon = ts.id === 'dungeon';
      // raised ambient floor so silhouettes always read, even far from a torch
      this.hemi = new THREE.HemisphereLight(dungeon ? 0x5a6684 : 0xffd8b0, dungeon ? 0x1c150e : 0x3a2414, dungeon ? 1.05 : 1.5);
      s.add(this.hemi);
      if (!dungeon) {
        // daylight falling through the windows (shadowed so it only enters through openings)
        this.sun = new THREE.DirectionalLight(0xfff0dc, this.hour > 6 && this.hour < 19 ? 9 : 0);
        this.sunDir = new THREE.Vector3(0.25, 1.1, 0.9).normalize();
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        const c = this.sun.shadow.camera;
        c.left = -26;
        c.right = 26;
        c.top = 26;
        c.bottom = -26;
        c.near = 1;
        c.far = 200;
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.03;
        this.sun.shadow.radius = 3;
        s.add(this.sun, this.sun.target);
      }
      s.fog = new THREE.FogExp2(dungeon ? 0x07080b : 0x1a120c, dungeon ? 0.055 : 0.025);
      s.background = new THREE.Color(dungeon ? 0x020203 : 0x0a0604);
      setSurfaceAtmosphere({ sunDir: new THREE.Vector3(0, 1, 0), sunColor: 0x000000, scatter: 0, heightFog: dungeon ? 0.35 : 0.08, heightFalloff: 0.8, grimeTint: ts.grime, mossTint: ts.moss, wet: dungeon ? 0.3 : 0 });
    }
    // pooled torch lights (constant count → no shader recompiles)
    this.poolLights = [];
    // by day in the open the sconces are unlit: skip point lights entirely (cheaper shading)
    const needLights = !ts.outdoors || this.night > 0.12;
    for (let i = 0; i < (needLights ? POOL_LIGHTS : 0); i++) {
      const l = new THREE.PointLight(0xff9a48, 0, 11, 1.7);
      l.userData = { src: null, fade: 1 };
      s.add(l);
      this.poolLights.push(l);
    }
    // party lantern: carried a little ahead and to the right, warm, ~5 m reach
    const lanternI = ts.outdoors ? this.night * 7 : ts.id === 'dungeon' ? 15 : 3;
    this.lantern = new THREE.PointLight(0xffb468, lanternI, ts.outdoors ? 12 : 15, ts.outdoors ? 1.6 : 1.45);
    this.lantern.position.set(0.45, -0.25, -0.15);
    this.lantern.userData.base = lanternI;
    if (needLights) this.camera.add(this.lantern);
    setWindowGlow(this.skyNight, 1);
  }

  _setupEnvironment() {
    const renderer = this.ctx.render.renderer;
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envScene;
    if (this.tileset.outdoors) {
      envScene = new THREE.Scene();
      const dome = createSkyDome({ hour: this.hour, cloud: 0.46, radius: 50 });
      envScene.add(dome);
      // ground bounce
      const ground = new THREE.Mesh(new THREE.CircleGeometry(49, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.keys.ground).multiplyScalar(this.night > 0.5 ? 0.3 : 1.6) }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -2;
      envScene.add(ground);
    } else {
      envScene = new THREE.Scene();
      const room = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 20), new THREE.MeshBasicMaterial({ color: this.tileset.id === 'dungeon' ? 0x07080a : 0x1a100a, side: THREE.BackSide }));
      envScene.add(room);
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.tileset.id === 'dungeon' ? 0x40302a : 0xfff0d8).multiplyScalar(this.tileset.id === 'dungeon' ? 0.6 : 3) }));
        b.position.set(Math.cos(i) * 8, 1.5, Math.sin(i * 1.7) * 8);
        envScene.add(b);
      }
    }
    const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
    // Only glossy surfaces sample the environment (a scene-wide PMREM lookup on
    // every rough stone pixel is expensive and adds little over the hemi fill).
    this.envTex = rt.texture;
    // glass, water and forged iron need reflections to read as such
    this.envMats = [getWindowMaterial('ext'), getWindowMaterial('int'), getLampGlassMaterial(), getMaterial('prop_iron'), getMaterial('arch_iron')];
    if (this.skyline?.water) this.envMats.push(this.skyline.water);
    this.scene3d.traverse((o) => {
      if (o.isMesh && o.material?.roughness !== undefined && o.material.roughness < 0.2 && !this.envMats.includes(o.material)) this.envMats.push(o.material);
    });
    for (const m of this.envMats) {
      m.envMap = rt.texture;
      m.needsUpdate = true;
    }
    this.own(() => {
      for (const m of this.envMats) m.envMap = null;
    });
    envScene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    pmrem.dispose();
    this.own(() => rt.dispose());
  }

  _postFor() {
    const ts = this.tileset;
    if (!ts.outdoors) {
      return ts.id === 'dungeon'
        ? { bloomStrength: 0.65, bloomThreshold: 0.7, bloomRadius: 0.55, exposure: 1.35, vignette: 0.5, saturation: 1.0, contrast: 1.06 }
        : { bloomStrength: 0.55, bloomThreshold: 0.75, bloomRadius: 0.5, exposure: 1.25, vignette: 0.42, saturation: 1.05, contrast: 1.05 };
    }
    if (this.night > 0.5) return { bloomStrength: 0.75, bloomThreshold: 0.62, bloomRadius: 0.55, exposure: 1.3, vignette: 0.45, saturation: 1.05, contrast: 1.05 };
    if (this.keys.scatter > 0.8) return { bloomStrength: 0.5, bloomThreshold: 0.8, bloomRadius: 0.6, exposure: 1.05, vignette: 0.38, saturation: 1.08 };
    return { bloomStrength: 0.32, bloomThreshold: 0.9, bloomRadius: 0.55, exposure: 1.06, vignette: 0.32, saturation: 1.06, contrast: 1.05 };
  }

  _setupParticles() {
    const ts = this.tileset;
    const W = this.map.w * CELL_SIZE;
    const H = this.map.h * CELL_SIZE;
    this.particles = [];
    const add = (p) => {
      if (!p) return;
      this.scene3d.add(p);
      this.particles.push(p);
    };
    const night = this.night > 0.5;
    if (ts.particles.includes('dust')) {
      add(createParticles('dust', {
        count: ts.outdoors ? 420 : 320,
        box: [new THREE.Vector3(-9, 0.15, -9), new THREE.Vector3(9, ts.outdoors ? 3.6 : ts.ceilH - 0.2, 9)],
        color: ts.outdoors ? (night ? 0x8090b0 : 0xfff0d0) : 0xffc890,
        size: 0.018,
        intensity: ts.outdoors ? (night ? 0.25 : 0.7) : 0.55,
        seed: 11,
      }));
    }
    if (ts.particles.includes('fireflies') && night) {
      add(createParticles('fireflies', { count: 70, box: [new THREE.Vector3(-16, 0.3, -16), new THREE.Vector3(16, 2.6, 16)], color: 0xe0ff80, color2: 0xe0ff80, size: 0.05, intensity: 3.5, seed: 12 }));
    }
    this._rebuildEmbers();
    if (ts.particles.includes('smoke')) {
      const origins = [...(this.block?.chimneys ?? []), ...(this.skyline?.smoke ?? [])];
      add(createParticles('smoke', { origins, size: 1.1, color: night ? 0x1c2028 : 0xa8a6a2, intensity: night ? 0.5 : 0.32, seed: 13 }));
    }
    if (ts.particles.includes('fog') && (night || this.keys.scatter > 0.8 || !ts.outdoors)) {
      add(createParticles('mist', {
        count: ts.outdoors ? 60 : 40,
        box: [new THREE.Vector3(-4, 0.9, -4), new THREE.Vector3(W + 4, 2.0, H + 4)],
        size: 4.5,
        color: ts.outdoors ? new THREE.Color(this.keys.fog).multiplyScalar(1.6).getHex() : 0x303640,
        intensity: ts.outdoors ? 0.08 : 0.1,
        seed: 14,
      }));
    }
  }

  _rebuildEmbers() {
    if (this.embers) {
      this.embers.removeFromParent();
      this.embers.userData.dispose();
      this.particles = this.particles.filter((p) => p !== this.embers);
      this.embers = null;
    }
    if (!this.tileset.particles.includes('embers')) return;
    const origins = this.sources.filter((s) => s.lit && (s.kind === 'torch' || s.kind === 'hearth')).flatMap((s) => (s.kind === 'hearth' ? [0, 1, 2] : [0]).map((k) => s.pos.clone().add(new THREE.Vector3(k * 0.1 - 0.1, 0.12, 0))));
    const p = createParticles('embers', { origins, size: 0.022, color: 0xffc060, color2: 0xff3a08, intensity: 2.2, seed: 15 });
    if (p) {
      this.scene3d.add(p);
      this.particles.push(p);
      this.embers = p;
    }
  }

  _foundSecrets() {
    const all = this.ctx.game.flags.secrets ?? [];
    const prefix = `${this.map.id}:`;
    return new Set(all.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length)));
  }

  _buildBlock() {
    this._unsettle();
    this._disposeBlock();
    this.block = buildBlock(this.map, { foundSecrets: this._foundSecrets(), tileset: this.tileset, night: this.night });
    this.scene3d.add(this.block.group);
    this.props = buildProps(this.map, this.block, { night: this.night });
    this.scene3d.add(this.props.group);
    // light sources: sconces + lamps + candles
    this.sources = [...this.block.torches, ...this.props.lamps];
    this.sourceVis = new THREE.Group();
    // all flames / glows / lamp glass batched into three draw calls
    const flames = [];
    const glows = [];
    const glassGeos = [];
    const indoorGlow = this.tileset.outdoors ? 0.85 : 0.5;
    for (const src of this.sources) {
      const candle = src.kind === 'candle';
      if (src.kind === 'lamp') {
        const b = new THREE.BoxGeometry(0.2, 0.3, 0.2);
        b.translate(src.pos.x, src.pos.y, src.pos.z);
        glassGeos.push(b);
      }
      if (!src.lit) continue;
      if (src.kind === 'hearth') {
        for (const [dx, sc] of [[-0.22, 0.42], [0.05, 0.55], [0.26, 0.38]]) flames.push({ pos: src.pos.clone().add(new THREE.Vector3(src.N.z * dx, -0.1, -src.N.x * dx)), scale: sc });
        glows.push({ pos: src.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), size: 1.6, color: 0xff7a30, seed: src.seed, opacity: 0.5 });
        continue;
      }
      if (src.kind !== 'lamp') flames.push({ pos: src.pos.clone().add(new THREE.Vector3(0, candle ? 0 : -0.1, 0)), scale: candle ? 0.07 : 0.24 });
      glows.push({ pos: src.pos, size: candle ? 0.3 : src.kind === 'lamp' ? 0.9 : this.tileset.outdoors ? 0.75 : 0.55, color: candle ? 0xffb868 : src.kind === 'lamp' ? 0xffc070 : 0xff9a48, seed: src.seed, opacity: indoorGlow });
      // night air: a wide, faint halo of light scattered in the damp around each lamp
      if (this.tileset.outdoors && this.night > 0.3 && !candle) glows.push({ pos: src.pos, size: src.kind === 'lamp' ? 3.4 : 2.6, color: 0xff9a50, seed: src.seed + 3, opacity: 0.16 * this.night });
      else if (!this.tileset.outdoors && !candle) glows.push({ pos: src.pos, size: 1.9, color: 0xff8a40, seed: src.seed + 3, opacity: 0.09 });
    }
    if (flames.length) this.sourceVis.add(createFlameBatch(flames));
    if (glows.length) {
      this.glowBatch = createGlowBatch(glows);
      this.sourceVis.add(this.glowBatch);
    }
    if (glassGeos.length) {
      this._lampGeo = mergeGeometries(glassGeos);
      glassGeos.forEach((g) => g.dispose());
      this.sourceVis.add(new THREE.Mesh(this._lampGeo, getLampGlassMaterial()));
    }
    this.scene3d.add(this.sourceVis);
    if (this.particles) this._rebuildEmbers();
  }

  _buildShafts() {
    if (this.shafts) {
      this.shafts.removeFromParent();
      this.shafts.userData.dispose();
      this.shafts = null;
    }
    if (this.sunShafts) {
      this.sunShafts.removeFromParent();
      this.sunShafts.userData.dispose();
      this.sunShafts = null;
    }
    if (this.tileset.outdoors && this.keys.night < 0.5) {
      // crepuscular rays through the gaps between buildings (strongest at low sun)
      const low = this.keys.scatter > 0.8 || this.sunDir.y < 0.4;
      this.sunShafts = buildSunShafts(this.map, this.block, { sunDir: this.sunDir, color: new THREE.Color(this.keys.sunCol).lerp(new THREE.Color(0xfff0d8), 0.3), strength: low ? 0.2 : 0.075, time: PROP_UNIFORMS.uTime });
      if (this.sunShafts) this.scene3d.add(this.sunShafts);
    }
    if (this.tileset.outdoors || !this.sun || !this.sun.intensity) return;
    this.shafts = buildLightShafts(this.block.windows.filter((w) => !w.upper), this.sunDir, { strength: 0.032, length: 3.6 });
    if (this.shafts) this.scene3d.add(this.shafts);
  }

  _disposeBlock() {
    if (this.block) disposeBlock(this.block);
    this.props?.dispose();
    if (this.sourceVis) {
      this.glowBatch?.userData.dispose();
      this.glowBatch = null;
      this.sourceVis.traverse((o) => {
        if (o.isInstancedMesh) o.geometry.dispose();
      });
      this.sourceVis.removeFromParent();
    }
    this._lampGeo?.dispose();
    this.block = null;
    this.props = null;
  }

  /** Point the pooled lights at the nearest lit sources (fading new ones in). */
  _assignLights(snap = false) {
    const here = this.camera.position;
    const fwd = new THREE.Vector3(-Math.sin(this.camera.rotation.y), 0, -Math.cos(this.camera.rotation.y));
    const lit = this.sources.filter((s) => s.lit);
    const score = (s) => {
      const d = s.pos.clone().sub(here);
      const dist = d.length();
      const inFront = d.normalize().dot(fwd);
      return dist - inFront * 2.5 - (s.kind === 'hearth' ? 6 : 0);
    };
    const best = lit.sort((a, b) => score(a) - score(b)).slice(0, POOL_LIGHTS);
    // keep lights that already track a chosen source
    const free = [];
    const taken = new Set();
    for (const l of this.poolLights) {
      if (l.userData.src && best.includes(l.userData.src)) taken.add(l.userData.src);
      else free.push(l);
    }
    for (const src of best) {
      if (taken.has(src)) continue;
      const l = free.shift();
      if (!l) break;
      l.userData.src = src;
      l.userData.fade = snap ? 1 : 0;
      l.position.copy(src.pos).addScaledVector(src.N ?? new THREE.Vector3(), 0.25);
      const candle = src.kind === 'candle';
      const hearth = src.kind === 'hearth';
      l.color.setHex(hearth ? 0xff7a30 : candle ? 0xffb060 : src.kind === 'lamp' ? 0xffb56a : 0xff9040);
      l.userData.base = hearth ? 30 : candle ? 3.5 : src.kind === 'lamp' ? 9 : 11;
      l.distance = hearth ? 14 : candle ? 7 : 12;
    }
    for (const l of free) {
      l.userData.src = null;
      l.intensity = 0;
    }
  }

  /**
   * With a frozen clock (debug/screenshot mode) the frame is static once the
   * scene has settled, so stop re-rendering it (saves power; keeps capture fast).
   */
  render() {
    const frozen = this.ctx.clock.frozen;
    if (frozen && !this.tween && (this._settled ?? 0) >= 3) return;
    super.render();
    this._settled = frozen ? (this._settled ?? 0) + 1 : 0;
  }

  _unsettle() {
    this._settled = 0;
  }

  resume() {
    this._unsettle();
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
    this.hud.roster.refresh();
  }

  onResize() {
    this._unsettle();
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  _placeCamera(x, y, yaw, bob, roll = 0) {
    const c = cellCenter(x, y);
    // stand slightly behind cell centre so the facing wall frames nicely
    this.camera.position.set(c.x + Math.sin(yaw) * 0.55, EYE_H + bob, c.z + Math.cos(yaw) * 0.55);
    // a slight upward tilt frames facades against the sky (and vaults overhead)
    this.camera.rotation.set(this.tileset.outdoors ? 0.065 : 0.03, yaw, roll, 'YXZ');
    this.hud?.compass.set(yaw);
  }

  _onAction(action) {
    if (this.ctx.scenes.current !== this || this.leaving) return;
    const movement = ['forward', 'back', 'strafeLeft', 'strafeRight', 'turnLeft', 'turnRight', 'turnAround'];
    if (this.tween && movement.includes(action)) {
      this.queued = action; // one-deep input buffer keeps held keys responsive
      return;
    }
    switch (action) {
      case 'forward': return this.move(this.pos.dir);
      case 'back': return this.move(OPPOSITE[this.pos.dir], true);
      case 'strafeLeft': return this.move(turnLeft(this.pos.dir), true);
      case 'strafeRight': return this.move(turnRight(this.pos.dir), true);
      case 'turnLeft': return this.turn(turnLeft(this.pos.dir), 1);
      case 'turnRight': return this.turn(turnRight(this.pos.dir), -1);
      case 'turnAround': return this.turn(OPPOSITE[this.pos.dir], 2);
      case 'area': return this.cmdArea();
      case 'encamp': return this.cmdEncamp();
      case 'search': return this.cmdSearch();
      case 'look': return this.cmdLook();
      case 'view': return this.cmdView();
      case 'cast': return this.cmdCast();
      case 'prevMember':
      case 'nextMember': {
        const g = this.ctx.game;
        const n = g.party.length;
        if (!n) return;
        g.activeIndex = (g.activeIndex + (action === 'nextMember' ? 1 : n - 1)) % n;
        g.notifyPartyChanged();
        return;
      }
      default:
    }
  }

  _speed() {
    return this.ctx.settings.get('moveSpeed') || 1;
  }

  turn(newDir, quarterTurns) {
    if (this.tween) return;
    const from = DIR_YAW[this.pos.dir];
    const to = from + (Math.PI / 2) * quarterTurns;
    this.pos.dir = newDir;
    this.ctx.game.setLocation({ dir: newDir });
    this.tween = { kind: 'turn', t: 0, dur: (TURN_TIME * (quarterTurns === 2 ? 1.5 : 1)) / this._speed(), fromYaw: from, toYaw: to, x0: this.pos.x, y0: this.pos.y, x1: this.pos.x, y1: this.pos.y };
    this._updateHud();
  }

  move(dir, keepFacing = false) {
    if (this.tween) return;
    const res = this.map.tryMove(this.pos.x, this.pos.y, dir, { foundSecrets: this._foundSecrets() });
    if (!res.ok) {
      if (res.reason === 'locked') this.ctx.ui.message('The door is locked.', 'warn');
      else if (res.reason === 'edge') this.ctx.ui.message('The way is barred.', 'warn');
      this.ctx.audio.sfx('bump');
      this.tween = { kind: 'bump', t: 0, dur: 0.24, dir, fromYaw: DIR_YAW[this.pos.dir], toYaw: DIR_YAW[this.pos.dir], x0: this.pos.x, y0: this.pos.y, x1: this.pos.x, y1: this.pos.y };
      return;
    }
    if (res.leaves) {
      this.ctx.ui.message(`The path leads to ${res.exit.to.replace(/_/g, ' ')} — not yet built.`, 'system');
      return;
    }
    const door = this.block.doors.get(`${this.pos.x},${this.pos.y},${dir}`) ?? this.block.doors.get(`${res.nx},${res.ny},${OPPOSITE[dir]}`);
    if (door) this.ctx.audio.sfx('door');
    else this.ctx.audio.sfx('step');
    const yaw = DIR_YAW[this.pos.dir];
    let doorSign = 1;
    if (door) {
      const [dx, dy] = DIR_VEC[dir];
      doorSign = dx * door.normal.x + dy * door.normal.z > 0 ? -1 : 1;
      door.anim = null;
    }
    this.tween = { kind: 'move', t: 0, dur: (STEP_TIME * (door ? DOOR_STEP : 1)) / this._speed(), fromYaw: yaw, toYaw: yaw, x0: this.pos.x, y0: this.pos.y, x1: res.nx, y1: res.ny, door, doorSign, doorFrom: door?.open ?? 0 };
    this.pos.x = res.nx;
    this.pos.y = res.ny;
    void keepFacing;
  }

  _arrive() {
    const { game } = this.ctx;
    game.setLocation({ x: this.pos.x, y: this.pos.y, dir: this.pos.dir });
    game.markExplored(this.map.id, this.pos.x, this.pos.y, this.map.w);
    game.advanceTime(1);
    this._assignLights();
    this._updateHud();
    this._checkEvents();
  }

  _checkEvents() {
    const { game, ui } = this.ctx;
    for (const ev of this.map.eventsAt(this.pos.x, this.pos.y)) {
      if (ev.once && game.spentEvents[ev.id]) continue;
      if (ev.facing && ev.facing !== this.pos.dir) continue;
      if (ev.chance && !this.ctx.rng.chance(ev.chance)) continue;
      if (ev.once) game.spentEvents[ev.id] = true;
      switch (ev.type) {
        case 'encounter':
          ui.message('Something stirs in the shadows...', 'warn');
          this.leaving = true;
          this.ctx.scenes.goto('dialogue', { encounter: ev.ref });
          return;
        case 'sign':
        case 'text':
          ui.message(ev.text, 'lore');
          break;
        case 'treasure':
          ui.message(ev.text, 'loot');
          if (ev.gold && game.party[0]) {
            game.party[0].gold += ev.gold;
            ui.message(`The party gains ${ev.gold} gold pieces.`, 'loot');
            this.ctx.audio.sfx('coins');
          }
          break;
        case 'shop':
          this.leaving = true;
          this.ctx.scenes.goto('shop', { shop: ev.ref });
          return;
        case 'exit':
          ui.message(ev.text, 'system');
          break;
        default:
      }
    }
  }

  cmdArea() {
    if (this.demo) {
      this.ctx.ui.message('No map of this place exists.', 'system');
      return;
    }
    this.ctx.scenes.push('automap', { map: this.map.id, overlay: true });
  }

  cmdCast() {
    const ch = this.ctx.game.activeCharacter;
    const slots = ch ? deriveStats(ch).spellSlots : {};
    if (!Object.keys(slots).length) this.ctx.ui.message(`${ch?.name ?? 'No one'} cannot cast spells.`, 'warn');
    else this.ctx.ui.message(`${ch.name} has no spells memorized. Encamp to memorize.`, 'system');
  }

  cmdView() {
    const ch = this.ctx.game.activeCharacter;
    if (!ch) return;
    const s = deriveStats(ch);
    const a = ch.abilities;
    this.ctx.ui.dialog({
      title: ch.name,
      variant: 'blue',
      body: `${s.className} (level ${s.levels}) — AC ${s.ac}, THAC0 ${s.thac0}, HP ${ch.hp.cur}/${ch.hp.max}. STR ${a.str}${a.strPct ? `/${a.strPct}` : ''} INT ${a.int} WIS ${a.wis} DEX ${a.dex} CON ${a.con} CHA ${a.cha}. Weapon: ${s.weapon?.name ?? 'none'} (${s.damage}).`,
    });
  }

  cmdEncamp() {
    this.leaving = true;
    this.ctx.scenes.goto('camp', {});
  }

  cmdSearch() {
    const { game, ui } = this.ctx;
    game.advanceTime(10);
    const { x, y } = this.pos;
    let found = false;
    for (const d of DIRS) {
      if (this.map.getEdge(x, y, d) === EDGE.SECRET) {
        const key = `${this.map.id}:${x},${y},${d}`;
        const list = (game.flags.secrets ??= []);
        if (!list.includes(key)) {
          list.push(key);
          const [dx, dy] = DIR_VEC[d];
          list.push(`${this.map.id}:${x + dx},${y + dy},${OPPOSITE[d]}`);
          found = true;
        }
      }
    }
    if (found) {
      ui.message('You discover a hidden door!', 'loot');
      this._buildBlock();
      this._buildShafts();
      this._assignLights(true);
    } else ui.message('You search carefully but find nothing.', 'info');
  }

  cmdLook() {
    const { x, y, dir } = this.pos;
    const e = this.map.getEdge(x, y, dir);
    const outdoors = this.tileset.outdoors;
    const desc = {
      [EDGE.OPEN]: outdoors ? 'The street continues ahead.' : 'The passage continues ahead.',
      [EDGE.WALL]: outdoors ? 'A weathered wall blocks the way.' : 'Cold stone blocks the way.',
      [EDGE.DOOR]: 'A heavy wooden door stands before you.',
      [EDGE.LOCKED]: 'An iron-bound door. It is locked.',
      [EDGE.SECRET]: outdoors ? 'A weathered wall blocks the way.' : 'Cold stone blocks the way.',
      [EDGE.ARCH]: 'An archway opens ahead.',
    }[e];
    this.ctx.ui.message(desc ?? EDGE_NAMES[e], 'info');
    const shop = this.map.eventsAt(x + DIR_VEC[dir][0], y + DIR_VEC[dir][1]).find((ev) => ev.type === 'shop');
    if (shop) this.ctx.ui.message(`A sign reads: ${SHOPS[shop.ref]?.name ?? 'Shop'}.`, 'lore');
  }

  _updateHud() {
    const { game } = this.ctx;
    const { day, hour, minute } = game.clock;
    const facing = { N: 'North', E: 'East', S: 'South', W: 'West' }[this.pos.dir];
    this.hud?.setLocation(this.map.zoneAt(this.pos.x, this.pos.y), `${this.pos.x},${this.pos.y} · facing ${facing} · Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    if (!this.ready) return;
    const time = this.ctx.clock.time;
    const frozen = this.ctx.clock.frozen;
    this._animateWorld(time, dt, frozen);
    const tw = this.tween;
    if (!tw) return;
    tw.t = frozen ? 1 : Math.min(1, tw.t + dt / tw.dur);
    let fx;
    let fy;
    let bob = 0;
    let roll = 0;
    const bobOn = this.ctx.settings.get('headBob') ?? true;
    if (tw.kind === 'move') {
      let k;
      if (tw.door) {
        // door swings open first, then the party steps through
        const open = easeOut(clamp01(tw.t / 0.42));
        tw.door.setOpen(tw.doorFrom + (1 - tw.doorFrom) * open, tw.doorSign);
        k = ease(clamp01((tw.t - 0.22) / 0.78));
      } else k = ease(tw.t);
      fx = tw.x0 + (tw.x1 - tw.x0) * k;
      fy = tw.y0 + (tw.y1 - tw.y0) * k;
      if (bobOn) {
        const ph = clamp01(tw.door ? (tw.t - 0.22) / 0.78 : tw.t);
        bob = Math.sin(ph * Math.PI) * 0.04 - Math.sin(ph * Math.PI * 2) * 0.008;
        roll = Math.sin(ph * Math.PI) * 0.006 * (this._stepParity ? 1 : -1);
      }
    } else {
      const k = ease(tw.t);
      fx = tw.x0;
      fy = tw.y0;
      if (tw.kind === 'bump') {
        const [dx, dy] = DIR_VEC[tw.dir];
        const push = Math.sin(tw.t * Math.PI) * 0.12;
        fx += dx * push;
        fy += dy * push;
      }
      void k;
    }
    const yaw = tw.fromYaw + (tw.toYaw - tw.fromYaw) * ease(tw.t);
    this._placeCamera(fx, fy, yaw, bob, roll);
    if (tw.t >= 1) {
      this.tween = null;
      this._placeCamera(this.pos.x, this.pos.y, DIR_YAW[this.pos.dir], 0, 0);
      if (tw.kind === 'move') {
        this._stepParity = !this._stepParity;
        if (tw.door) tw.door.anim = { from: tw.door.open, t: frozen ? 1 : -0.35, dur: 0.7, sign: tw.doorSign };
        this._arrive();
      }
      const q = this.queued;
      this.queued = null;
      if (q) this._onAction(q);
      else if (this.ctx.scenes.current === this) {
        // continuous movement while a key is held
        for (const a of ['forward', 'back', 'turnLeft', 'turnRight']) if (this.ctx.input.down(a)) return this._onAction(a);
      }
    }
  }

  _animateWorld(time, dt, frozen) {
    FLAME_UNIFORMS.uTime.value = time;
    PROP_UNIFORMS.uTime.value = time;
    this.sky?.userData.update(time);
    if (this.skyline?.water?.normalMap) this.skyline.water.normalMap.offset.set(time * 0.004, time * 0.0025);
    // light sources
    if (this.glowBatch) this.glowBatch.userData.setScale(this.ctx.render.height * this.ctx.render.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
    for (const l of this.poolLights) {
      const src = l.userData.src;
      if (!src) continue;
      l.userData.fade = frozen ? 1 : Math.min(1, l.userData.fade + dt / 0.35);
      l.intensity = l.userData.base * flicker(time, src.seed) * l.userData.fade;
    }
    this.lantern.intensity = this.lantern.userData.base * (0.94 + 0.06 * flicker(time * 0.7, 99));
    setWindowGlow(this.skyNight, 0.94 + 0.06 * flicker(time * 0.5, 7));
    // shadow camera follows the view, snapped to texels to avoid shimmering
    if (this.sun) {
      const fwd = new THREE.Vector3(-Math.sin(this.camera.rotation.y), 0, -Math.cos(this.camera.rotation.y));
      const target = this.camera.position.clone().addScaledVector(fwd, 9);
      target.y = 0;
      const texel = 52 / 2048;
      target.x = Math.round(target.x / texel) * texel;
      target.z = Math.round(target.z / texel) * texel;
      this.sun.target.position.copy(target);
      this.sun.position.copy(target).addScaledVector(this.sunDir, 90);
    }
    const vh = this.ctx.render.height * this.ctx.render.renderer.getPixelRatio();
    for (const p of this.particles ?? []) p.userData.update(time, this.camera, vh);
    // doors closing behind the party
    for (const door of new Set(this.block.doors.values())) {
      if (!door.anim) continue;
      const a = door.anim;
      a.t = frozen ? a.dur : a.t + dt;
      const k = ease(clamp01(a.t / a.dur));
      door.setOpen(a.from * (1 - k), a.sign);
      if (a.t >= a.dur) door.anim = null;
    }
  }

  exit() {
    this._disposeBlock();
    for (const p of this.particles ?? []) p.userData.dispose();
    this.shafts?.userData.dispose();
    this.sunShafts?.userData.dispose();
    this.skyline?.dispose();
    if (this.sky) {
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
    super.exit();
  }
}
