import * as THREE from 'three';
import { getGlowTexture } from './textures/index.js';

/**
 * Lighting rig helpers shared by explore/combat/title scenes.
 * All animated lights take `time` from ctx.clock.time (freeze-safe).
 */

/**
 * Sun/moon + sky-fill for an outdoor scene at an in-game hour.
 * @param {THREE.Scene} scene
 * @param {{hour?: number, shadows?: boolean, shadowSize?: number, target?: THREE.Vector3, extent?: number}} [o]
 */
export function createOutdoorRig(scene, o = {}) {
  const hour = o.hour ?? 10;
  const k = timeOfDayKeys(hour);
  const hemi = new THREE.HemisphereLight(k.sky, k.ground, k.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(k.sun, k.sunI);
  const ang = ((hour - 6) / 12) * Math.PI; // 6h east → 18h west
  const el = Math.max(0.25, Math.sin(ang));
  const target = o.target ?? new THREE.Vector3();
  const ext = o.extent ?? 30;
  sun.position.set(target.x + Math.cos(ang) * 40, target.y + el * 50, target.z + 20);
  sun.target.position.copy(target);
  scene.add(sun, sun.target);
  if (o.shadows !== false) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(o.shadowSize ?? 2048, o.shadowSize ?? 2048);
    const cam = sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 150;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  scene.fog = new THREE.FogExp2(k.fog, k.fogDensity);
  return { hemi, sun, keys: k };
}

/** Colour/intensity keys by hour (0-24). */
export function timeOfDayKeys(hour) {
  const night = hour < 5.5 || hour > 19.5;
  const dusk = !night && (hour < 7.5 || hour > 17.5);
  if (night) return { sky: 0x2a3a6a, ground: 0x0a0a12, hemi: 0.35, sun: 0x8fa8ff, sunI: 0.5, fog: 0x0a1020, fogDensity: 0.03, skyTop: 0x02040c, skyHorizon: 0x14203c };
  if (dusk) return { sky: 0xffb07a, ground: 0x2a1a14, hemi: 0.7, sun: 0xffa060, sunI: 2.2, fog: 0x6a4a50, fogDensity: 0.018, skyTop: 0x1c2450, skyHorizon: 0xf09060 };
  return { sky: 0xbcd4ff, ground: 0x3a3228, hemi: 1.0, sun: 0xfff1d6, sunI: 3.2, fog: 0x9fb0c8, fogDensity: 0.012, skyTop: 0x2f5fa8, skyHorizon: 0xcfdcea };
}

/**
 * Gradient sky dome with optional stars.
 * @param {{hour?: number, radius?: number}} [o]
 */
export function createSkyDome(o = {}) {
  const k = timeOfDayKeys(o.hour ?? 10);
  const night = (o.hour ?? 10) < 5.5 || (o.hour ?? 10) > 19.5;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(k.skyTop) },
      uHorizon: { value: new THREE.Color(k.skyHorizon) },
      uStars: { value: night ? 1 : 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon; uniform float uStars; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){
        float t = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uTop, pow(t, 0.6));
        vec3 cell = floor(vDir * 300.0);
        float s = step(0.9975, h(cell)) * smoothstep(0.05, 0.3, t) * uStars;
        c += vec3(s) * (0.6 + 0.4 * h(cell + 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius ?? 400, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Flickering torch/fire light with a glow sprite. Call .update(time).
 * @param {{color?: number, intensity?: number, distance?: number, glow?: boolean, seed?: number}} [o]
 */
export function createTorch(o = {}) {
  const group = new THREE.Group();
  const light = new THREE.PointLight(o.color ?? 0xffa050, o.intensity ?? 12, o.distance ?? 14, 1.6);
  group.add(light);
  let sprite = null;
  if (o.glow !== false) {
    sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: o.color ?? 0xffa050, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.scale.setScalar(0.8);
    group.add(sprite);
  }
  const base = o.intensity ?? 12;
  const seed = o.seed ?? 0;
  group.userData.update = (time) => {
    const f = 0.85 + 0.1 * Math.sin(time * 13 + seed) + 0.05 * Math.sin(time * 29.7 + seed * 3) + 0.04 * Math.sin(time * 7.3);
    light.intensity = base * f;
    if (sprite) sprite.material.opacity = 0.7 + 0.3 * f;
  };
  group.userData.light = light;
  return group;
}
