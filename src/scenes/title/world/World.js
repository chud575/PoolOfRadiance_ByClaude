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
export function createWorld() {
  const scene = new THREE.Scene();
  const U = createWorldUniforms(SUN_DIR);
  scene.fog = new THREE.FogExp2(0x3a2038, 0.0042);
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
  const fill = new THREE.DirectionalLight(0x5a6ac0, 0.35);
  fill.position.set(8, 12, 30);
  scene.add(fill);
  // warm spill from City Hall's open doors (lights the portico in the prologue)
  const hall = new THREE.PointLight(0xffa860, 30, 22, 1.6);
  hall.position.set(-20, -11.2, -50.5);
  scene.add(hall);

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
      sky.geometry.dispose();
      sky.material.dispose();
      sea.geometry.dispose();
      sea.material.dispose();
    },
  };
}
