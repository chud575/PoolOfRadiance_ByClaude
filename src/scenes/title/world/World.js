import * as THREE from 'three';
import { preloadTextureSets } from '../../../render/textures/index.js';
import { createWorldUniforms, createSky, createSea } from './SkySea.js';
import { createCity, CITY_TEXTURES } from './City.js';
import { createTerrace, TERRACE_TEXTURES } from './Terrace.js';
import { createDragon } from './Dragon.js';
import { createParticles } from './Particles.js';

/** Direction of the set sun (just below the sea horizon, WSW). */
export const SUN_DIR = new THREE.Vector3(-0.45, 0.014, -1).normalize();

/** Generate every texture the title world needs (in workers). */
export function preloadWorld() {
  return preloadTextureSets([...CITY_TEXTURES, ...TERRACE_TEXTURES]);
}

/**
 * Ruined Phlan at dusk, assembled: sky, Moonsea, city, temple terrace with
 * the Pool of Radiance, a dragon over the sea, embers and motes.
 */
const LOOK_FOG = new THREE.Color(0x5a3552);
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
  const dragon = createDragon();
  scene.add(sky, sea, city.group, terrace.group, dragon.group);

  // ---- lighting: sunset rim from the sea, cool dusk fill, pool + braziers are the keys
  const hemi = new THREE.HemisphereLight(0x7a5a9a, 0x1a1016, 0.75);
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
  const fill = new THREE.DirectionalLight(0x6070c8, 0.6);
  fill.position.set(8, 12, 30);
  scene.add(fill);
  // warm spill from City Hall's open doors (lights the portico in the prologue)
  const hall = new THREE.PointLight(0xffa860, 30, 22, 1.6);
  hall.position.set(-20, -11.2, -50.5);
  scene.add(hall);

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
    count: 70, seed: 5, origin: new THREE.Vector3(-6.2, 1.8, -1.2), spread: new THREE.Vector3(0.9, 0.2, 0.9),
    height: 7, speed: [0.12, 0.3], size: 0.3, wind: new THREE.Vector3(-0.25, 0, 0.05), sway: 0.7, intensity: 3,
  });
  const embersR = createParticles({
    count: 70, seed: 6, origin: new THREE.Vector3(6.2, 1.8, -1.2), spread: new THREE.Vector3(0.9, 0.2, 0.9),
    height: 7, speed: [0.12, 0.3], size: 0.3, wind: new THREE.Vector3(-0.25, 0, 0.05), sway: 0.7, intensity: 3,
  });
  // embers carried up from the burning old city on the sea wind
  const drift = createParticles({
    count: 260, seed: 9, origin: new THREE.Vector3(18, -10, -40), spread: new THREE.Vector3(90, 6, 70),
    height: 26, speed: [0.015, 0.04], size: 0.55, wind: new THREE.Vector3(-1.1, 0, 0.35), sway: 2.5, intensity: 2.2,
    colorA: 0xffc070, colorB: 0xff3a0a,
  });
  const systems = [motes, embersL, embersR, drift];
  for (const s of systems) scene.add(s.points);

  const dragonPath = { x: 150, y: 26, z: -230, dx: 4.2, span: 380 };
  dragon.group.scale.setScalar(1.45);

  return {
    scene,
    uniforms: U,
    city,
    terrace,
    dragon,
    sun,
    sky,
    dragonPath,
    hemi,
    fill,
    /**
     * Blend the atmosphere for cinematic shots: k=0 is the title look, k=1 the
     * aerial "city" look (denser mauve aerial perspective, brighter sky fill,
     * a cool rim from the east so roofs read against the haze).
     */
    setLook(k) {
      k = Math.max(0, Math.min(1, k));
      scene.fog.density = 0.0034 + k * 0.0042;
      scene.fog.color.setHex(0x3a2240).lerp(LOOK_FOG, k);
      hemi.intensity = 0.75 + k * 0.85;
      fill.intensity = 0.6 + k * 0.9;
      fill.color.setHex(0x6070c8).lerp(LOOK_FILL, k);
      fill.position.set(8 + k * 60, 12 + k * 20, 30 + k * 10);
      sun.intensity = 2.2 + k * 1.2;
    },
    update(t, camera, px = 1) {
      U.uTime.value = t;
      sky.userData.update(camera);
      city.update(t);
      terrace.update(t);
      dragon.update(t, dragonPath);
      for (const s of systems) s.update(t, px);
    },
    dispose() {
      city.dispose();
      terrace.dispose();
      dragon.dispose();
      for (const s of systems) s.dispose();
      shaftMat.dispose();
      shafts.children.forEach((m) => m.geometry.dispose());
      sky.geometry.dispose();
      sky.material.dispose();
      sea.geometry.dispose();
      sea.material.dispose();
    },
  };
}
