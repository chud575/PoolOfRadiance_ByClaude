import * as THREE from 'three';
import { preloadTextureSets } from '../../../render/textures/index.js';
import { createWorldUniforms, createSky, createSea } from './SkySea.js';
import { createCity, CITY_TEXTURES } from './City.js';
import { createTerrace, TERRACE_TEXTURES } from './Terrace.js';
import { createDragon } from './Dragon.js';
import { createParticles } from './Particles.js';
import { createChamber, CHAMBER_TEXTURES } from './Chamber.js';

/** Direction of the set sun (just below the sea horizon, WSW). */
export const SUN_DIR = new THREE.Vector3(-0.45, 0.014, -1).normalize();

/** Generate every texture the title world needs (in workers). */
export function preloadWorld() {
  return preloadTextureSets([...new Set([...CITY_TEXTURES, ...TERRACE_TEXTURES, ...CHAMBER_TEXTURES])]);
}

/**
 * Ruined Phlan at dusk, assembled: sky, Moonsea, city, temple terrace with
 * the Pool of Radiance, a dragon over the sea, embers and motes.
 */
const LOOK_FOG = new THREE.Color(0x3a3a68);
const LOOK_FILL = new THREE.Color(0x9a92b8);

export function createWorld() {
  const scene = new THREE.Scene();
  const U = createWorldUniforms(SUN_DIR);
  scene.fog = new THREE.FogExp2(0x3a2240, 0.0034);
  scene.background = new THREE.Color(0x0a0714);

  const sky = createSky(U);
  const sea = createSea(U);
  const city = createCity();
  const terrace = createTerrace();
  const dragon = createDragon({ sunDir: SUN_DIR });
  // the council chamber (and its dozen sculpted figures) is only built once the
  // prologue needs it: the title card and menus never pay for it
  let chamber = null;
  const ensureChamber = () => {
    if (!chamber) {
      chamber = createChamber();
      chamber.group.visible = false;
      scene.add(chamber.group);
      api.chamber = chamber;
    }
    return chamber;
  };
  const outdoor = [sky, sea, city.group, terrace.group, dragon.group];
  scene.add(...outdoor);

  // ---- lighting: sunset rim from the sea, cool dusk fill, pool + braziers are the keys
  const hemi = new THREE.HemisphereLight(0x8a6aaa, 0x241618, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff8a4a, 2.2);
  sun.position.copy(SUN_DIR).multiplyScalar(60).add(new THREE.Vector3(0, 14, 0));
  sun.target.position.set(0, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 20; sc.bottom = -14; sc.near = 10; sc.far = 110;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x6a78d0, 0.8);
  fill.position.set(8, 12, 30);
  scene.add(fill);
  // cool moon/sky key from the east, used by the aerial + City Hall shots so roofs
  // and domes get a sky-lit side against the warm sunset rim
  const moon = new THREE.DirectionalLight(0x8090e0, 0);
  moon.position.set(60, 70, 50);
  scene.add(moon);
  // a narrow key on Valjevo Castle from the moonrise side: the keep and its towers
  // get a lit plane the dusk town around them doesn't, so the castle reads as the
  // focal mass of the old city (aerial shots and the title skyline)
  const castleKey = new THREE.SpotLight(0xc4c0ff, 0, 0, 0.26, 0.6, 0);
  castleKey.position.set(150, 70, -40);
  castleKey.target.position.set(55, -2, -128);
  scene.add(castleKey, castleKey.target);
  // The Old City aerial's own rig: a low warm key raking in from the west (frame
  // left, the sunset side) with long shadows across the ruins and the castle
  // mound, and a cool moonrise rim from the east that edges every tower.
  const cityKey = new THREE.DirectionalLight(0xffa070, 0);
  cityKey.position.set(55 - 100, -10 + 34, -120 + 22);
  cityKey.target.position.set(55, -10, -120);
  cityKey.shadow.mapSize.set(2048, 2048);
  {
    const c = cityKey.shadow.camera;
    c.left = -70; c.right = 70; c.top = 55; c.bottom = -45; c.near = 20; c.far = 260;
  }
  cityKey.shadow.bias = -0.0006;
  cityKey.shadow.normalBias = 0.08;
  cityKey.visible = false;
  const cityRim = new THREE.DirectionalLight(0x8fa4ff, 0);
  cityRim.position.set(55 + 110, -10 + 30, -120 - 6);
  cityRim.target.position.set(55, -10, -120);
  cityRim.visible = false;
  scene.add(cityKey, cityKey.target, cityRim, cityRim.target);
  // warm spill from City Hall's open doors (lights the portico in the prologue)
  const hall = new THREE.PointLight(0xffa860, 30, 22, 1.6);
  hall.position.set(-20, -11.2, -50.5);
  hall.visible = false;
  scene.add(hall);
  outdoor.push(hemi, sun, fill, moon, castleKey);

  // ---- low sun raking through the ruined colonnade: soft volumetric shafts ----------
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
      float h(float x){ return fract(sin(x * 91.7) * 43758.5); }
      void main(){
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float along = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.6);
        float flick = 0.8 + 0.2 * sin(uTime * 0.4 + vUv.y * 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.25) * edge * along * flick * 0.075, 1.0);
      }`,
  });
  const shafts = new THREE.Group();
  const toCam = new THREE.Vector3(-SUN_DIR.x, 0.0, -SUN_DIR.z).normalize();
  for (const [x, z, w] of [[-11.1, -7.2, 2.4], [-15, -4.5, 1.6], [14.5, -5.2, 1.8]]) {
    const len = 26;
    const g = new THREE.PlaneGeometry(w, len);
    g.translate(0, len / 2, 0);
    const m = new THREE.Mesh(g, shaftMat);
    // lie the plane along the (slightly descending) sun direction, then stand it up
    const dir = new THREE.Vector3(toCam.x, -0.28, toCam.z).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.rotateY(Math.PI / 2);
    m.position.set(x, 9.5, z);
    m.renderOrder = 3;
    shafts.add(m);
  }
  scene.add(shafts);

  // ---- particles ------------------------------------------------------------------
  const motes = createParticles({
    count: 160, seed: 3, disc: true, origin: new THREE.Vector3(0, 0.3, 0), spread: new THREE.Vector3(2.8, 0, 2.8),
    height: 16, speed: [0.03, 0.08], size: 0.55, colorA: 0xe8ffff, colorB: 0x3fc8ff, sway: 1.4, intensity: 2.4,
  });
  const embersL = createParticles({
    count: 120, seed: 5, origin: new THREE.Vector3(-6.2, 1.8, -1.2), spread: new THREE.Vector3(0.7, 0.2, 0.7),
    height: 10, speed: [0.1, 0.28], size: 0.32, wind: new THREE.Vector3(-0.6, 0, 0.1), sway: 0.9, intensity: 3.4, streak: true,
  });
  const embersR = createParticles({
    count: 120, seed: 6, origin: new THREE.Vector3(6.2, 1.8, -1.2), spread: new THREE.Vector3(0.7, 0.2, 0.7),
    height: 10, speed: [0.1, 0.28], size: 0.32, wind: new THREE.Vector3(-0.6, 0, 0.1), sway: 0.9, intensity: 3.4, streak: true,
  });
  // embers carried up from the burning old city on the sea wind
  const drift = createParticles({
    count: 260, seed: 9, origin: new THREE.Vector3(18, -10, -40), spread: new THREE.Vector3(90, 6, 70),
    height: 26, speed: [0.015, 0.04], size: 0.55, wind: new THREE.Vector3(-1.1, 0, 0.35), sway: 2.5, intensity: 2.2,
    colorA: 0xffc070, colorB: 0xff3a0a, streak: true,
  });
  const systems = [motes, embersL, embersR, drift];
  for (const s of systems) scene.add(s.points);
  outdoor.push(shafts, ...systems.map((s) => s.points));

  // the dragon glides along a screen-space lane the current camera pose keeps
  // clear of the logo and panels (see TitleScene DRAGON / Intro shots)
  let dragonLane = null;
  let dragonOn = true;

  const api = {
    scene,
    uniforms: U,
    city,
    terrace,
    dragon,
    sun,
    sky,
    chamber: null,
    ensureChamber,
    ensureCrowd: () => city.ensureCrowd(),
    hemi,
    fill,
    /**
     * Blend the atmosphere for cinematic shots: k=0 is the title look, k=1 the
     * aerial "city" look (denser mauve aerial perspective, brighter sky fill,
     * a cool rim from the east so roofs read against the haze).
     */
    setLook(k) {
      k = Math.max(0, Math.min(1, k));
      this._look = k;
      if (this._interior) return;
      // aerial grade: blue-violet aerial perspective in the shadows, warm sun on the lit planes
      scene.fog.density = 0.0034 + k * 0.0054;
      scene.fog.color.setHex(0x3a2240).lerp(LOOK_FOG, k);
      hemi.intensity = 0.95 - k * 0.15;
      hemi.color.setHex(0x8a6aaa).lerp(new THREE.Color(0x6a7ac8), k);
      fill.intensity = 0.8 - k * 0.35;
      fill.color.setHex(0x6a78d0).lerp(LOOK_FILL, k);
      fill.position.set(8 + k * 60, 12 + k * 20, 30 + k * 10);
      sun.intensity = 2.2 + k * 3.8;
      sun.color.setHex(0xff8a4a).lerp(new THREE.Color(0xffa060), k);
      moon.intensity = k * 0.55 + (this._moon ?? 0);
      castleKey.intensity = 4.5 * (0.4 + 0.6 * k);
      if (this._stage?.cityKey && !this._classic) {
        // the Old City aerial is lit by its own raking key: drop the soft fills so
        // the shadow side falls to a cool violet and the lit planes carry the frame
        hemi.intensity *= 0.5;
        fill.intensity *= 0.35;
        sun.intensity *= 0.55;
        castleKey.intensity = 0;
        scene.fog.color.setHex(0x584c88);
        scene.fog.density = 0.0068;
      }
      if (this._classic) {
        // 1988: no sunset grade — neutral light so stone lands on EGA greys and
        // the scene quantises to flat fills instead of orange/pink dither
        scene.fog.color.setHex(0x000010);
        scene.fog.density = 0.0022;
        sun.color.setHex(0xffffff);
        sun.intensity = 1.3;
        hemi.color.setHex(0x9090b0);
        hemi.intensity = 1.0;
        fill.color.setHex(0x8080ff);
        fill.intensity = 0.5;
        castleKey.intensity = 0;
      }
    },
    /** Classic 1988 mode (F2): flat EGA sky/sea, no volumetric shafts or sea-wind embers. */
    setClassic(on) {
      on = !!on;
      if (on === !!this._classic) return;
      this._classic = on;
      U.uClassic.value = on ? 1 : 0;
      this._applyStage();
      dragon.setClassic(on);
      terrace.setClassic?.(on);
      city.setClassic?.(on);
      // 1988 had single-pixel stars, not soft sprites: motes shrink to one EGA pixel
      motes.material.uniforms.uMaxPx.value = on ? 4 : 64;
      if (!this._interior) this.setLook(this._look ?? 0);
    },
    /**
     * Which outdoor sets a shot needs (the intro's city shots never see the
     * terrace, only City Hall needs its door light): lights and meshes that are
     * off-screen cost nothing, which keeps software GL captures quick.
     */
    setStage({ terrace: tv = true, hall: hv = false, drift: dv = true, cityKey: ck = false } = {}) {
      const was = this._stage?.cityKey;
      this._stage = { terrace: tv, hall: hv, drift: dv, cityKey: ck };
      if (hv) city.ensureCrowd();
      if (was !== ck) city.setShadows(ck);
      this._applyStage();
    },
    _applyStage() {
      const st = this._stage ?? { terrace: true, hall: false, drift: true };
      const inside = !!this._interior;
      for (const o of outdoor) o.visible = !inside;
      terrace.group.visible = !inside && st.terrace;
      for (const s of [motes, embersL, embersR]) s.points.visible = !inside && st.terrace && !(this._classic && s !== motes);
      drift.points.visible = !inside && st.drift && !this._classic;
      shafts.visible = !inside && st.terrace && !this._classic;
      hall.visible = !inside && st.hall;
      const ck = !inside && !!st.cityKey && !this._classic;
      cityKey.visible = ck;
      cityRim.visible = ck;
      cityKey.castShadow = ck;
      sun.castShadow = !ck;
      cityKey.intensity = ck ? 10 : 0;
      cityRim.intensity = ck ? 3.6 : 0;
      if (chamber) chamber.group.visible = inside;
    },
    /** Show or hide the dragon (the intro keeps it out of the close city shots). */
    setDragon(on) {
      dragonOn = !!on;
    },
    /** Flight lane for the dragon (null hides it); see Dragon.update. */
    setDragonLane(lane) {
      dragonLane = lane;
    },
    /** Extra cool sky key for a shot (City Hall: gives roofs and the dome a sky-lit side). */
    setMoon(m) {
      if ((this._moon ?? 0) === m) return;
      this._moon = m;
      this.setLook(this._look ?? 0);
    },
    /** Move the lighting rig indoors (council chamber shot): k = 0 outdoors, 1 inside. */
    setInterior(on) {
      on = !!on;
      if (on === !!this._interior) return;
      this._interior = on;
      if (on) ensureChamber();
      this._applyStage();
      if (on) {
        sun.intensity = 0; hemi.intensity = 0.06; fill.intensity = 0; moon.intensity = 0; castleKey.intensity = 0;
        scene.fog.density = 0.012;
        scene.fog.color.setHex(0x0c0810);
      } else {
        this.setLook(this._look ?? 0);
      }
    },
    update(t, camera, px = 1) {
      U.uTime.value = t;
      sky.userData.update(camera);
      camera.updateMatrixWorld();
      city.update(t, camera, SUN_DIR);
      terrace.update(t, camera, SUN_DIR);
      dragon.update(t, camera, dragonOn ? dragonLane : null);
      if (chamber && this._interior) chamber.update(t);
      for (const s of systems) s.update(t, px);
    },
    dispose() {
      city.dispose();
      terrace.dispose();
      dragon.dispose();
      chamber?.dispose();
      for (const s of systems) s.dispose();
      shaftMat.dispose();
      shafts.children.forEach((m) => m.geometry.dispose());
      sky.geometry.dispose();
      sky.material.dispose();
      sea.geometry.dispose();
      sea.material.dispose();
    },
  };
  api.setLook(0);
  return api;
}
