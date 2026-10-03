import * as THREE from 'three';
import { createSkyDome } from '../../render/lighting.js';
import { getMaterial, preloadMaterials } from '../../render/materials.js';
import { getGlowTexture, getGrassTexture } from '../../render/textures/index.js';
import { CLOTH_COLORS, defaultLook } from '../../ui/components/lookData.js';
import { buildMiniature, miniatureEnvironment } from '../../ui/components/Miniature.js';
import { isAlive } from '../../rules/character.js';
import { buildBedroll } from './bedroll.js';
import { buildRuins } from './ruins.js';
import { groundTextures, barkTextures, emberTexture, coalTextures, smokeTexture, blobTexture, stoneTextures } from './campTextures.js';

/**
 * The encampment diorama: the party around a campfire on a broken flagstone
 * court among Phlan's ruins, under the night sky — a broken arch, a fallen
 * tower and the city's skyline in the fog beyond; moonlight from behind as a
 * cool fill against the fire's warm key. The fire is a teepee of split,
 * bark-covered logs with glowing char cracks over an ember bed, layered noise
 * flames that stay orange-gold, a smoke column, sparks and a heat shimmer,
 * inside a ring of sooty fieldstones. Resting, the fire burns down to embers,
 * the light cools and the sleepers lie under blankets while one keeps watch.
 *
 * buildCamp(scene, {party, hour, renderer, deferParty}) → {update(t), setResting(on), ensureParty(), dispose()}
 */

const hrand = (i, s = 0) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ------------------------------------------------------------------ fire shaders

const FLAME_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLAME_FRAG = /* glsl */`
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uHeight;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main() {
  vec2 uv = vUv;
  float t = uTime * 1.6 + uSeed * 10.0;
  float y = uv.y / uHeight;
  float n = fbm(vec2(uv.x * 3.2 + uSeed * 3.0, uv.y * 2.6 - t));
  float n2v = fbm(vec2(uv.x * 6.0 - uSeed, uv.y * 5.0 - t * 1.7));
  float sway = (n - 0.5) * 0.28 * y + sin(t * 0.7 + uSeed * 6.0) * 0.03 * y;
  float dx = abs(uv.x - 0.5 + sway);
  float w = 0.3 * pow(sin(3.14159 * clamp(y * 0.9 + 0.12, 0.0, 1.0)), 0.8) * (1.0 - y * 0.55) + 0.02;
  float body = smoothstep(w, w * 0.25, dx);
  float top = smoothstep(1.0, 0.45, y + (n2v - 0.5) * 0.5);
  float base = smoothstep(0.0, 0.14, uv.y);
  float f = clamp(body * top * base, 0.0, 1.0);
  // Tongues break off near the tip.
  f *= smoothstep(0.15, 0.55, n2v + (1.0 - y) * 0.6);
  float core = f * f * smoothstep(0.75, 0.05, y);
  vec3 col = mix(vec3(0.75, 0.13, 0.02), vec3(1.0, 0.42, 0.06), smoothstep(0.0, 0.6, f));
  col = mix(col, vec3(1.0, 0.7, 0.26), core);
  gl_FragColor = vec4(col * f * uIntensity, 1.0);
}`;

/**
 * Volumetric flame: the view ray is marched through a box around the fire; density is a set of
 * licking tongues (a tapering column per tongue, torn by rising 3D noise), emission follows a
 * blackbody ramp from deep red at the edges to gold at the core. Additive, so it reads as light.
 */
const VOLFLAME_VERT = /* glsl */`
varying vec3 vLocal;
varying vec3 vCamLocal;
void main() {
  vLocal = position;
  vCamLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VOLFLAME_FRAG = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uHeight;
uniform vec3 uHalf;
varying vec3 vLocal;
varying vec3 vCamLocal;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm(vec3 p) { return n3(p) * 0.55 + n3(p * 2.1 + 3.1) * 0.3 + n3(p * 4.3 + 7.7) * 0.15; }
float density(vec3 p) {
  float t = uTime;
  float y = p.y / uHeight;                         // 0 at the embers, 1 at the tips
  if (y < 0.0 || y > 1.0) return 0.0;
  vec3 q = p + vec3(0.0, -t * 0.9, 0.0);
  float n = fbm(q * vec3(5.0, 3.2, 5.0));
  float n2 = fbm(q * vec3(11.0, 7.0, 11.0) + 5.0);
  // Sway grows with height.
  vec2 sway = vec2(sin(t * 1.3 + p.y * 4.0), cos(t * 1.1 + p.y * 3.3)) * 0.035 * y + (vec2(n, n2) - 0.5) * 0.12 * y;
  vec2 xz = p.xz - sway;
  // Three tongues round a core; each tapers to a point.
  float d = 0.0;
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    float a = fk * 2.39996 + 0.6;
    vec2 c = k == 6 ? vec2(0.0) : vec2(cos(a), sin(a)) * (0.07 + 0.025 * mod(fk, 2.0));
    float hk = k == 6 ? 1.0 : 0.55 + 0.07 * fk;
    // each tongue flickers in height on its own beat
    hk *= 0.85 + 0.15 * sin(t * (2.3 + fk * 0.7) + fk * 1.7);
    float yk = y / hk;
    if (yk > 1.0) continue;
    float r = (k == 6 ? 0.21 : 0.13) * pow(1.0 - yk, 0.75) * smoothstep(0.0, 0.12, yk + 0.04);
    d = max(d, smoothstep(r, r * 0.2, length(xz - c)) * (1.0 - smoothstep(0.5, 1.0, yk + (n2 - 0.5) * 0.6)));
  }
  // Torn by the noise, more so toward the tips (licks break off and vanish).
  d *= smoothstep(0.25 + 0.5 * y, 0.7, n + (1.0 - y) * 0.32);
  return d;
}
void main() {
  vec3 ro = vCamLocal;
  vec3 rd = normalize(vLocal - vCamLocal);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-uHalf - ro) * inv, t1 = (uHalf - ro) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  float ta = max(max(max(lo.x, lo.y), lo.z), 0.0), tb = min(min(hi.x, hi.y), hi.z);
  if (tb <= ta) discard;
  const int N = 28;
  float dt = (tb - ta) / float(N);
  float t = ta + dt * h31(vec3(gl_FragCoord.xy, 3.0));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * t + vec3(0.0, uHalf.y, 0.0);
    float d = density(p);
    if (d > 0.001) {
      float y = p.y / uHeight;
      float temp = d * (1.15 - y * 0.75);
      vec3 c = mix(vec3(0.42, 0.04, 0.01), vec3(1.0, 0.3, 0.04), smoothstep(0.12, 0.55, temp));
      c = mix(c, vec3(1.0, 0.58, 0.2), smoothstep(0.62, 1.0, temp));
      acc += c * d * dt * 10.0;
    }
    t += dt;
  }
  gl_FragColor = vec4(acc * uIntensity, 1.0);
}`;

/** Heat shimmer: distorts the sky/ruins seen through the column above the fire. */
const HAZE_FRAG = /* glsl */`
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float m = smoothstep(0.5, 0.1, abs(vUv.x - 0.5)) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
  float n = n2(vec2(vUv.x * 9.0, vUv.y * 6.0 - uTime * 2.2)) - 0.5;
  // A faint warm, rippling veil (additive) — reads as hot air over the flames.
  gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * (0.5 + n) * m * uStrength, 1.0);
}`;

// ------------------------------------------------------------------ geometry helpers

/** A round log: a bark cylinder with ridged bark, a slight crook and knots; charred toward the burning end. */
function splitLogGeometry(len, r, seed) {
  const g = new THREE.CylinderGeometry(r * 0.9, r, len, 16, 10, false);
  const p = g.attributes.position;
  const col = [];
  const crook = (hrand(seed, 2) - 0.5) * 0.06;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i);
    const y = p.getY(i);
    const rr = Math.hypot(x, z) || 1;
    const a = Math.atan2(z, x);
    // bark: long fissured ridges, knots, a gentle crook along the length
    const ridge = 0.06 * Math.abs(Math.sin(a * 7 + Math.sin(y * 6 + seed) * 0.8)) + 0.03 * Math.sin(a * 17 + y * 3);
    const knot = 0.18 * Math.exp(-(((a - seed) % 6.28) ** 2) * 4 - ((y - len * (hrand(seed, 3) - 0.5)) ** 2) * 60);
    const burn = Math.max(0, Math.min(1, (-y / len + 0.5) * 1.9 + 0.12 * Math.sin(y * 23 + seed * 3 + a * 2)));
    // charred wood shrinks and cracks
    const k = 1 + ridge - 0.08 - burn * 0.08 + knot * (1 - burn);
    x = (x / rr) * rr * k + crook * Math.sin((y / len + 0.5) * Math.PI) * len;
    z = (z / rr) * rr * k;
    p.setXYZ(i, x, y, z);
    const base = [0.74, 0.68, 0.62];
    const kk = (1 - burn * 0.92) * (0.85 + 0.15 * Math.sin(a * 7));
    col.push(base[0] * kk, base[1] * kk, base[2] * kk);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A rounded fieldstone: a lumpy sphere, sooty on the side facing the fire. */
function fieldstoneGeometry(seed, sooty) {
  const g = new THREE.SphereGeometry(1, 20, 14);
  const p = g.attributes.position;
  const col = [];
  const tone = 0.3 + hrand(seed, 3) * 0.14;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.14 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed * 2) + 0.07 * Math.sin(y * 5 + x * 4 + seed) + 0.035 * Math.sin(x * 11 + z * 9 + y * 7 + seed);
    const flat = y < -0.2 ? 0.75 : 1;
    p.setXYZ(i, x * n, y * n * flat, z * n);
    const soot = sooty ? Math.max(0, Math.min(1, (y + 0.2) * 0.9 + Math.max(0, -z) * 0.7)) : 0;
    const k = tone * (1 - soot * 0.78) * (0.92 + 0.08 * Math.sin(x * 9 + z * 7));
    col.push(k * 1.02, k * 0.97, k * 0.9);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A wall run with a broken, jagged top; world-scaled UVs and AO colours for the arch_ shader. */
function jaggedWall(w, h, depth, seed) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w, 0);
  const steps = Math.max(4, Math.round(w * 1.6));
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * w;
    const edge = i === 0 || i === steps ? 0.55 : 1;
    const top = h * (0.35 + 0.65 * hrand(i, seed)) * edge;
    s.lineTo(x + (hrand(i, seed + 3) - 0.5) * 0.25, Math.max(0.3, top));
  }
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1 });
  return archUV(g, (v) => 0.45 + 0.55 * Math.min(1, v.y / 1.6));
}
function archUV(g, aoFn) {
  g.computeVertexNormals();
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(p.count * 2), 2);
  const c = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
    if (ay > 0.7) uv.setXY(i, v.x / 3, v.z / 3);
    else if (ax > 0.7) uv.setXY(i, v.z / 3, v.y / 3);
    else uv.setXY(i, v.x / 3, v.y / 3);
    const ao = aoFn ? aoFn(v) : 1;
    c.push(ao, ao, ao);
  }
  g.setAttribute('uv', uv);
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

// ------------------------------------------------------------------ the camp

/**
 * @param {THREE.Scene} scene
 * @param {{party: object[], hour: number, renderer?: THREE.WebGLRenderer, resting?: boolean}} o
 */
export async function buildCamp(scene, { party, hour, renderer, resting = false, deferParty = false }) {
  await preloadMaterials(['arch_stone', 'arch_ruin', 'arch_mud', 'prop_wood', 'prop_burlap']);
  const geos = [];
  const mats = [];
  const texs = [];
  const G = (g) => (geos.push(g), g);
  const Mt = (m) => (mats.push(m), m);
  const night = hour < 6 || hour >= 19 ? 1 : hour < 7 || hour >= 18 ? 0.5 : 0;
  const root = new THREE.Group();
  scene.add(root);

  let env = null;
  if (renderer) {
    env = miniatureEnvironment(renderer, { warm: 0x9a6a4a, cool: 0x4a62a0 });
    scene.environment = env;
    scene.environmentIntensity = night ? 0.3 : 0.8;
  }
  const sky = createSkyDome({ hour, cloud: 0.3 });
  scene.add(sky);
  const fogCol = night ? 0x0a1022 : 0x5a6a80;
  scene.fog = new THREE.FogExp2(fogCol, night ? 0.034 : 0.018);

  // ---- light: fire key, moon rim/fill, sky
  const hemi = new THREE.HemisphereLight(night ? 0x4458a0 : 0x9ab0d0, 0x0e0a08, night ? 0.62 : 0.9);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(night ? 0x9ab4ff : 0xfff0d8, night ? 1.15 : 1.6);
  moon.position.set(-5, 9, -9);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  moon.shadow.bias = -0.0008;
  moon.shadow.normalBias = 0.02;
  scene.add(moon, moon.target);
  const fireLight = new THREE.PointLight(0xffa25a, 0, 16, 1.6);
  fireLight.position.set(0, 1.0, 0.05);
  fireLight.castShadow = true;
  fireLight.shadow.mapSize.set(512, 512);
  fireLight.shadow.bias = -0.004;
  fireLight.shadow.normalBias = 0.03;
  fireLight.shadow.camera.near = 0.15;
  scene.add(fireLight);
  // Moon rim on the sentry (resting only): from behind and above, so he stands out against the ruins.
  const sentryRim = new THREE.SpotLight(0x9ab8ff, 0, 9, 0.38, 0.6, 1.2);
  sentryRim.position.set(-2.8, 4.4, -7.8);
  scene.add(sentryRim, sentryRim.target);
  // The embers' glow catching the sentry from below and in front (warm), against the moon rim behind (cold).
  const sentryFire = new THREE.SpotLight(0xff8a40, 0, 8, 0.32, 0.7, 1.4);
  sentryFire.position.set(0.1, 0.45, 0.2);
  scene.add(sentryFire, sentryFire.target);
  // The moon low behind the ruins: rims the arch, the wall tops and the party's backs in cold silver.
  const backMoon = new THREE.DirectionalLight(0x86a2ff, night ? 1.6 : 0.6);
  backMoon.position.set(2.5, 18, -9);
  scene.add(backMoon, backMoon.target);
  const emberLight = new THREE.PointLight(0xff5a1a, 0, 2.2, 2);
  emberLight.position.set(0, 0.15, 0);
  scene.add(emberLight);

  // ---- ground: the flagstone court (non-repeating) over earth that runs into the dark
  const gt = groundTextures();
  const courtGeo = G(new THREE.PlaneGeometry(gt.size, gt.size, 64, 64));
  {
    // Gentle unevenness.
    const p = courtGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const r = Math.hypot(x, y);
      p.setZ(i, 0.03 * Math.sin(x * 1.3 + y * 0.7) * Math.min(1, r / 3) + 0.02 * Math.sin(x * 3.7 - y * 2.1));
    }
    courtGeo.computeVertexNormals();
  }
  const court = new THREE.Mesh(courtGeo, Mt(new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normalMap, roughnessMap: gt.roughnessMap, normalScale: new THREE.Vector2(1.2, 1.2) })));
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  root.add(court);
  const farGeo = G(new THREE.RingGeometry(gt.size * 0.49, 60, 64, 4));
  archUV(farGeo, null);
  const far = new THREE.Mesh(farGeo, getMaterial('arch_mud'));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.01;
  far.receiveShadow = true;
  root.add(far);

  // Rubble, tilted broken slabs and weeds.
  const stoneMat = getMaterial('arch_stone');
  const rubGeo = G(archUV(new THREE.DodecahedronGeometry(0.12, 0), null));
  const rubble = new THREE.InstancedMesh(rubGeo, stoneMat, 70);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < 70; i++) {
    const a = hrand(i, 11) * Math.PI * 2;
    const r = 2.6 + hrand(i, 12) ** 0.7 * 6;
    const s = 0.4 + hrand(i, 13) * 1.3;
    q.setFromEuler(e.set(hrand(i, 14) * 3, hrand(i, 15) * 3, hrand(i, 16) * 3));
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0.04 * s, Math.sin(a) * r - 0.8), q, new THREE.Vector3(s, s * 0.7, s));
    rubble.setMatrixAt(i, m4);
  }
  rubble.castShadow = true;
  rubble.receiveShadow = true;
  root.add(rubble);
  const slabGeo = G(archUV(new THREE.BoxGeometry(0.7, 0.07, 0.5), null));
  for (let i = 0; i < 6; i++) {
    const a = 0.6 + i * 1.05 + hrand(i, 21) * 0.5;
    const r = 3.4 + hrand(i, 22) * 2.4;
    const sl = new THREE.Mesh(slabGeo, stoneMat);
    sl.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r - 0.6);
    sl.rotation.set((hrand(i, 23) - 0.5) * 0.5, hrand(i, 24) * 3, (hrand(i, 25) - 0.5) * 0.35);
    sl.castShadow = true;
    sl.receiveShadow = true;
    root.add(sl);
  }
  const grassMat = Mt(new THREE.MeshStandardMaterial({ map: getGrassTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0x8a9a70 }));
  const tuftGeo = G(new THREE.PlaneGeometry(0.42, 0.32));
  tuftGeo.translate(0, 0.16, 0);
  const N_TUFT = 90;
  const tufts = new THREE.InstancedMesh(tuftGeo, grassMat, N_TUFT * 2);
  for (let i = 0; i < N_TUFT; i++) {
    const a = hrand(i, 31) * Math.PI * 2;
    const r = 1.9 + hrand(i, 32) ** 0.6 * 6.5;
    const s = 0.5 + hrand(i, 33) * 0.9;
    for (let k = 0; k < 2; k++) {
      q.setFromEuler(e.set(0, hrand(i, 34) * 3 + k * 1.57, 0));
      m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r - 0.5), q, new THREE.Vector3(s, s, s));
      tufts.setMatrixAt(i * 2 + k, m4);
    }
  }
  tufts.receiveShadow = true;
  root.add(tufts);

  // ---- ruins: varied silhouettes against the sky
  const ruinMat = getMaterial('arch_ruin');
  buildRuins(root, { G, Mt, night, stoneMat, beamMat: getMaterial('prop_wood') });
  // A broken arch: two piers and the surviving voussoirs.
  {
    const arch = new THREE.Group();
    const pierGeo = G(archUV(new THREE.BoxGeometry(0.7, 3.1, 0.75), (v) => 0.5 + 0.5 * Math.min(1, (v.y + 1.55) / 1.5)));
    for (const x of [-1.5, 1.5]) {
      const pier = new THREE.Mesh(pierGeo, stoneMat);
      pier.position.set(x, 1.55, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      arch.add(pier);
    }
    const vGeo = G(archUV(new THREE.BoxGeometry(0.62, 0.36, 0.72), null));
    const nV = 11;
    for (let i = 0; i < nV; i++) {
      if (i >= 6 && i <= 8) continue; // fallen
      const a = Math.PI - (i + 0.5) / nV * Math.PI;
      const v = new THREE.Mesh(vGeo, stoneMat);
      v.position.set(Math.cos(a) * 1.5, 3.1 + Math.sin(a) * 1.5, 0);
      v.rotation.z = a - Math.PI / 2;
      v.castShadow = true;
      arch.add(v);
    }
    arch.position.set(1.2, 0, -8.6);
    arch.rotation.y = 0.1;
    root.add(arch);
    // Fallen voussoirs on the ground below.
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(vGeo, stoneMat);
      v.position.set(2.3 + i * 0.5, 0.18, -8.0 + i * 0.25);
      v.rotation.set(hrand(i, 41) * 0.6, hrand(i, 42) * 3, hrand(i, 43) * 0.5);
      v.castShadow = true;
      root.add(v);
    }
  }
  // A collapsed tower: a drum of stone with a ragged top and a dark window.
  {
    const tg = G(new THREE.CylinderGeometry(1.7, 1.9, 7, 24, 8, true));
    const p = tg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > 1.5) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const cut = 1.5 + 2.0 * (0.5 + 0.5 * Math.sin(a * 2 + 1)) + 1.0 * hrand(Math.round(a * 10), 7);
        if (y > cut) p.setY(i, cut);
      }
    }
    archUV(tg, (v) => 0.5 + 0.5 * Math.min(1, (v.y + 3.5) / 2));
    const tower = new THREE.Mesh(tg, Mt(stoneMat.clone()));
    tower.material.side = THREE.DoubleSide;
    tower.position.set(-7.4, 3.5, -9.2);
    tower.castShadow = true;
    tower.receiveShadow = true;
    root.add(tower);
    const win = new THREE.Mesh(G(new THREE.PlaneGeometry(0.35, 0.9)), Mt(new THREE.MeshBasicMaterial({ color: 0x050608 })));
    win.position.set(-6.4, 4.2, -7.75);
    win.rotation.y = 0.55;
    root.add(win);
  }
  // Column stumps.
  const colGeo = G(archUV(new THREE.CylinderGeometry(0.3, 0.34, 1, 16), null));
  for (const [x, z, hh] of [[4.2, -7.8, 2.6], [6.6, -7.2, 1.2], [-4.2, -8.6, 1.7]]) {
    const c = new THREE.Mesh(colGeo, stoneMat);
    c.scale.set(1, hh, 1);
    c.position.set(x, hh / 2, z);
    c.castShadow = true;
    root.add(c);
  }
  // ---- depth: ground mist lying between the court and the ruins (soft, layered, moonlit)
  {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 256; x++) {
        const v = y / 63; // 0 = top
        const wisp = 0.6 + 0.4 * Math.sin(x * 0.07 + Math.sin(x * 0.021) * 3 + y * 0.12) * Math.sin(x * 0.033 + 1.7);
        const a = Math.pow(Math.sin(Math.PI * Math.pow(v, 1.4)), 2) * wisp * Math.min(1, x / 60, (255 - x) / 60);
        const i = (y * 256 + x) * 4;
        img.data[i] = 150; img.data[i + 1] = 170; img.data[i + 2] = 215; img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
    g.putImageData(img, 0, 0);
    const mt = new THREE.CanvasTexture(c);
    mt.colorSpace = THREE.SRGBColorSpace;
    texs.push(mt);
    const MIST = [[-7.5, 22, 2.6, 0.07], [-10.5, 28, 3.4, 0.1], [-14, 36, 4.4, 0.13], [-19, 48, 5.6, 0.16], [-24, 64, 8, 0.2], [-33, 90, 10, 0.24]];
    for (const [z, w, hgt, op] of MIST) {
      const mm = Mt(new THREE.MeshBasicMaterial({ map: mt, transparent: true, depthWrite: false, opacity: op * (night ? 1 : 0.6), color: night ? 0x8090c0 : 0xc0c8d8, fog: false }));
      const m = new THREE.Mesh(G(new THREE.PlaneGeometry(w, hgt)), mm);
      m.position.set(0, hgt * 0.42, z);
      m.renderOrder = 2;
      root.add(m);
    }
  }

  // ---- foreground: dark masonry and a dead shrub framing the lower corners (silhouettes against the firelit court)
  {
    const fg = new THREE.Group();
    const drum = new THREE.Mesh(G(archUV(new THREE.CylinderGeometry(0.42, 0.45, 1.3, 14, 3), (v) => 0.4 + 0.3 * Math.min(1, (v.y + 0.65) / 1.3))), ruinMat);
    drum.rotation.set(0.05, 0.4, Math.PI / 2 - 0.12);
    drum.position.set(-1.75, 0.3, 3.25);
    fg.add(drum);
    const stump = new THREE.Mesh(G(jaggedWall(0.9, 1.5, 0.7, 77)), ruinMat);
    stump.position.set(-2.9, 0, 1.9);
    stump.rotation.y = 0.5;
    fg.add(stump);
    const block = new THREE.Mesh(G(archUV(new THREE.BoxGeometry(0.8, 0.45, 0.55), null)), ruinMat);
    block.position.set(1.85, 0.2, 3.3);
    block.rotation.set(0.08, -0.5, 0.14);
    fg.add(block);
    const block2 = new THREE.Mesh(G(archUV(new THREE.BoxGeometry(0.55, 0.38, 0.5), null)), ruinMat);
    block2.position.set(2.15, 0.5, 3.05);
    block2.rotation.set(-0.3, 0.3, 0.4);
    fg.add(block2);
    // A dead thorn shrub: forked twigs.
    const twigMat = Mt(new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }));
    const twigGeo = G(new THREE.CylinderGeometry(0.006, 0.014, 1, 5));
    twigGeo.translate(0, 0.5, 0);
    const shrub = new THREE.Group();
    const grow = (parent, len, depth, seed) => {
      const t = new THREE.Mesh(twigGeo, twigMat);
      t.scale.set(1 + depth * 0.6, len, 1 + depth * 0.6);
      parent.add(t);
      if (depth <= 0) return;
      for (let k = 0; k < 3; k++) {
        const ch = new THREE.Group();
        ch.position.y = len * (0.45 + 0.4 * hrand(seed, k));
        ch.rotation.set((hrand(seed, k + 3) - 0.5) * 1.6, hrand(seed, k + 6) * 6.28, (hrand(seed, k + 9) - 0.5) * 1.6);
        parent.add(ch);
        grow(ch, len * 0.62, depth - 1, seed * 3 + k + 1);
      }
    };
    grow(shrub, 0.75, 3, 5);
    shrub.position.set(1.45, 0, 3.55);
    fg.add(shrub);
    fg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(fg);
  }

  // ---- the hearth: fieldstones, ember bed, split-log teepee, flames, smoke, sparks
  const hearth = new THREE.Group();
  root.add(hearth);
  const stn = stoneTextures();
  const stoneVcMat = Mt(new THREE.MeshStandardMaterial({ vertexColors: true, map: stn.map, normalMap: stn.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: stn.roughnessMap, roughness: 1, color: 0xd0ccc6 }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + hrand(i, 71) * 0.2;
    const s = 0.085 + hrand(i, 72) * 0.05;
    const st = new THREE.Mesh(G(fieldstoneGeometry(i * 13 + 5, true)), stoneVcMat);
    st.scale.set(s * (1.2 + hrand(i, 73) * 0.4), s * (0.75 + hrand(i, 74) * 0.3), s);
    st.position.set(Math.cos(a) * 0.6, s * 0.5, Math.sin(a) * 0.6);
    st.rotation.y = -a + Math.PI / 2;
    st.castShadow = true;
    st.receiveShadow = true;
    hearth.add(st);
  }
  const coal = coalTextures();
  const bark = barkTextures();
  const coalMat = Mt(new THREE.MeshStandardMaterial({ map: coal.map, emissiveMap: coal.emissive, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 1, transparent: true, depthWrite: false }));
  const bed = new THREE.Mesh(G(new THREE.CircleGeometry(0.5, 40)), coalMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.012;
  hearth.add(bed);
  const coalChunkMat = Mt(new THREE.MeshStandardMaterial({ color: 0x1a120e, map: bark.map, emissive: 0xff5a18, emissiveMap: coal.emissive, emissiveIntensity: 0.9, roughness: 0.95 }));
  const chunkGeo = G(new THREE.IcosahedronGeometry(0.03, 2));
  {
    // Lumpy, split charcoal (no flat facets catching the light as hexagons).
    const p = chunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.28 * Math.sin(x * 140 + z * 90) * Math.cos(y * 120) + 0.12 * Math.sin(z * 260 + x * 30);
      p.setXYZ(i, x * k * 1.4, y * k * 0.6, z * k);
    }
    chunkGeo.computeVertexNormals();
  }
  const chunks = new THREE.InstancedMesh(chunkGeo, coalChunkMat, 44);
  for (let i = 0; i < 44; i++) {
    const a = hrand(i, 81) * Math.PI * 2;
    const r = hrand(i, 82) ** 0.6 * 0.38;
    q.setFromEuler(e.set(hrand(i, 83) * 3, hrand(i, 84) * 3, 0));
    const s = 0.6 + hrand(i, 85) * 1.0;
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.7, s));
    chunks.setMatrixAt(i, m4);
  }
  hearth.add(chunks);
  const embers = emberTexture();
  const logMat = Mt(new THREE.MeshStandardMaterial({ vertexColors: true, map: bark.map, normalMap: bark.normalMap, normalScale: new THREE.Vector2(2.2, 2.2), roughness: 0.92, emissive: 0xffffff, emissiveMap: embers, emissiveIntensity: 0.8 }));
  const barkMat = Mt(new THREE.MeshStandardMaterial({ color: 0xb09078, map: bark.map, normalMap: bark.normalMap, roughness: 0.9 }));
  const logs = new THREE.Group();
  const teepee = [];
  const nLogs = 6;
  for (let i = 0; i < nLogs; i++) {
    const a = (i / nLogs) * Math.PI * 2 + 0.25;
    const len = 0.78 + hrand(i, 91) * 0.16;
    const lg = G(splitLogGeometry(len, 0.052 + hrand(i, 92) * 0.018, i * 7 + 3));
    // UVs: bark runs along the log; the ember map's hot end (u = 0) at the bottom.
    const uv = lg.attributes.uv;
    // CylinderGeometry's uv.y is 0 at the bottom: the ember map's hot end (u = 0) sits in the fire.
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k) * 2);
    const log = new THREE.Mesh(lg, logMat);
    const foot = new THREE.Vector3(Math.cos(a) * 0.4, 0.04, Math.sin(a) * 0.4);
    const tip = new THREE.Vector3(Math.cos(a + 0.4) * 0.05, 0.56 + hrand(i, 93) * 0.08, Math.sin(a + 0.4) * 0.05);
    const dir = tip.clone().sub(foot);
    log.position.copy(foot.clone().add(tip).multiplyScalar(0.5));
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    log.scale.y = foot.distanceTo(tip) / len;
    log.castShadow = true;
    log.receiveShadow = true;
    logs.add(log);
    teepee.push(log);
  }
  // Two burnt-down logs lying in the embers.
  for (let i = 0; i < 2; i++) {
    const lg = G(splitLogGeometry(0.6, 0.05, 40 + i));
    const uv = lg.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, Math.abs(uv.getY(k) - 0.5) * 0.9, uv.getX(k) * 2);
    const log = new THREE.Mesh(lg, logMat);
    log.rotation.set(0, i * 1.9 + 0.4, Math.PI / 2);
    log.position.set(0.05 - i * 0.1, 0.05, i * 0.06);
    log.castShadow = true;
    logs.add(log);
  }
  // Burned-down logs fallen inward (seen while the party sleeps): radial, their charred ends in the coals.
  const collapsed = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.7;
    const lg = G(splitLogGeometry(0.5 + hrand(i, 95) * 0.12, 0.045 + hrand(i, 96) * 0.012, 60 + i));
    const uv = lg.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k) * 2);
    const log = new THREE.Mesh(lg, logMat);
    const foot = new THREE.Vector3(Math.cos(a) * 0.44, 0.06, Math.sin(a) * 0.44);
    const tip = new THREE.Vector3(Math.cos(a + 0.25) * 0.06, 0.035 + hrand(i, 97) * 0.03, Math.sin(a + 0.25) * 0.06);
    const dir = tip.clone().sub(foot);
    log.position.copy(foot.clone().add(tip).multiplyScalar(0.5));
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    log.castShadow = true;
    log.visible = false;
    logs.add(log);
    collapsed.push(log);
  }
  hearth.add(logs);
  // The flame: one ray-marched volume of licking tongues (no crossed cards).
  const FH = 1.2;
  const volMat = Mt(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uHeight: { value: FH }, uHalf: { value: new THREE.Vector3(0.4, FH / 2, 0.4) } },
    vertexShader: VOLFLAME_VERT, fragmentShader: VOLFLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: true,
  }));
  const vol = new THREE.Mesh(G(new THREE.BoxGeometry(0.8, FH, 0.8)), volMat);
  vol.position.set(0, 0.06 + FH / 2, 0);
  vol.renderOrder = 5;
  vol.frustumCulled = false;
  hearth.add(vol);
  // Heat shimmer column above the flames.
  const hazeMat = Mt(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.05 } },
    vertexShader: FLAME_VERT, fragmentShader: HAZE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const haze = new THREE.Mesh(G(new THREE.PlaneGeometry(0.9, 1.6)), hazeMat);
  haze.position.y = 1.55;
  hearth.add(haze);
  // Smoke column.
  const smokeTex = smokeTexture();
  const smoke = [];
  for (let i = 0; i < 18; i++) {
    const m = Mt(new THREE.SpriteMaterial({ map: smokeTex, color: night ? 0x56545e : 0x9a9aa0, transparent: true, depthWrite: false, opacity: 0.2, rotation: hrand(i, 111) * 6 }));
    const s = new THREE.Sprite(m);
    hearth.add(s);
    smoke.push(s);
  }
  // Sparks.
  const NS = 56;
  const sparkGeo = G(new THREE.BufferGeometry());
  const sparkPos = new Float32Array(NS * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkCol = new Float32Array(NS * 3);
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = Mt(new THREE.PointsMaterial({ map: getGlowTexture(), color: 0xffb060, vertexColors: true, size: 0.045, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  hearth.add(sparks);

  // ---- props: firewood stack, a lean-to, a cooking pot
  const woodMat = getMaterial('prop_wood');
  const stackLog = G(new THREE.CylinderGeometry(0.075, 0.075, 0.85, 10));
  for (let k = 0; k < 7; k++) {
    const l = new THREE.Mesh(stackLog, barkMat);
    const row = k < 4 ? 0 : k < 6 ? 1 : 2;
    const col = row === 0 ? k : row === 1 ? k - 4 : 0;
    l.rotation.x = Math.PI / 2;
    l.position.set(2.5 + col * 0.155 + row * 0.078, 0.075 + row * 0.135, -2.55);
    l.castShadow = true;
    l.receiveShadow = true;
    root.add(l);
  }
  {
    const tent = new THREE.Group();
    const canvasMat = Mt(new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1, side: THREE.DoubleSide, map: getMaterial('prop_burlap')?.map ?? null }));
    for (const sgn of [-1, 1]) {
      const g = G(new THREE.PlaneGeometry(2.0, 1.55, 10, 6));
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setZ(k, 0.05 * Math.sin(p.getX(k) * 5) * (0.5 - p.getY(k) / 1.55));
      g.computeVertexNormals();
      const pl = new THREE.Mesh(g, canvasMat);
      pl.position.set(0, 0.62, sgn * 0.55);
      pl.rotation.set(sgn * -0.78, 0, 0);
      pl.castShadow = true;
      pl.receiveShadow = true;
      tent.add(pl);
    }
    const pole = new THREE.Mesh(G(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 8)), woodMat);
    pole.rotation.z = Math.PI / 2;
    pole.position.y = 1.18;
    tent.add(pole);
    tent.position.set(3.7, 0, -3.6);
    tent.rotation.y = -0.5;
    root.add(tent);
  }

  // ---- camp life: an ash ring round the hearth, a pot on a tripod at its edge, weapons propped up.
  {
    // Ash and soot: a dark, uneven ring on the flags (radial-gradient canvas decal).
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.32, 'rgba(18,14,12,0.9)');
    grd.addColorStop(0.55, 'rgba(40,34,30,0.75)');
    grd.addColorStop(0.8, 'rgba(60,54,50,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    // Ash flecks.
    for (let i = 0; i < 900; i++) {
      const a = hrand(i, 141) * Math.PI * 2;
      const r = 40 + hrand(i, 142) ** 0.7 * 80;
      g.fillStyle = `rgba(${150 + hrand(i, 143) * 60},${145 + hrand(i, 143) * 55},${140 + hrand(i, 143) * 50},${0.08 + hrand(i, 144) * 0.2})`;
      g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 1 + hrand(i, 145) * 2, 1 + hrand(i, 146) * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    texs.push(tex);
    const ash = new THREE.Mesh(G(new THREE.PlaneGeometry(2.3, 2.3)), Mt(new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1 })));
    ash.rotation.x = -Math.PI / 2;
    ash.position.y = 0.008;
    ash.renderOrder = 1;
    ash.receiveShadow = true;
    root.add(ash);

    // Tripod of green sticks with an iron pot hanging over the edge of the embers.
    const tri = new THREE.Group();
    const stickGeo = G(new THREE.CylinderGeometry(0.012, 0.016, 1.05, 6));
    const stickMat = Mt(new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.9, map: bark.map }));
    const apex = new THREE.Vector3(0, 0.98, 0);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + 0.3;
      const foot = new THREE.Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
      const st = new THREE.Mesh(stickGeo, stickMat);
      st.position.copy(foot).lerp(apex, 0.5);
      st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apex.clone().sub(foot).normalize());
      st.scale.y = foot.distanceTo(apex) / 1.05;
      st.castShadow = true;
      tri.add(st);
    }
    const chain = new THREE.Mesh(G(new THREE.CylinderGeometry(0.004, 0.004, 0.42, 4)), Mt(new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.8, roughness: 0.5 })));
    chain.position.set(0, 0.77, 0);
    tri.add(chain);
    const potGeo = G(new THREE.LatheGeometry([[0.001, 0], [0.07, 0.005], [0.12, 0.04], [0.135, 0.1], [0.125, 0.16], [0.11, 0.18], [0.12, 0.19], [0.112, 0.195]].map(([x, y]) => new THREE.Vector2(x, y)), 20));
    const potMat = Mt(new THREE.MeshStandardMaterial({ color: 0x1c1b1c, metalness: 0.7, roughness: 0.62 }));
    const pot = new THREE.Mesh(potGeo, potMat);
    pot.position.set(0, 0.36, 0);
    pot.castShadow = true;
    tri.add(pot);
    const stew = new THREE.Mesh(G(new THREE.CircleGeometry(0.108, 16)), Mt(new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.75 })));
    stew.rotation.x = -Math.PI / 2;
    stew.position.set(0, 0.36 + 0.17, 0);
    tri.add(stew);
    const handle = new THREE.Mesh(G(new THREE.TorusGeometry(0.12, 0.005, 4, 16, Math.PI)), potMat);
    handle.position.set(0, 0.36 + 0.19, 0);
    tri.add(handle);
    tri.position.set(1.05, 0, 0.95);
    root.add(tri);

    // A spear and a sheathed sword propped against the firewood stack; a shield leaning beside.
    const metal = Mt(new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.35 }));
    const shaftMat = Mt(new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.8 }));
    const spear = new THREE.Group();
    const shaft = new THREE.Mesh(G(new THREE.CylinderGeometry(0.014, 0.016, 2.0, 6)), shaftMat);
    shaft.position.y = 1.0;
    spear.add(shaft);
    const head = new THREE.Mesh(G(new THREE.ConeGeometry(0.03, 0.2, 4)), metal);
    head.position.y = 2.1;
    spear.add(head);
    spear.position.set(2.3, 0, -2.35);
    spear.rotation.set(-0.12, 0, -0.32);
    spear.traverse((o) => { o.castShadow = true; });
    root.add(spear);
    const sword = new THREE.Group();
    const scab = new THREE.Mesh(G(new THREE.BoxGeometry(0.06, 0.82, 0.025)), Mt(new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.6 })));
    scab.position.y = 0.41;
    sword.add(scab);
    const guard = new THREE.Mesh(G(new THREE.BoxGeometry(0.2, 0.025, 0.035)), metal);
    guard.position.y = 0.84;
    sword.add(guard);
    const grip = new THREE.Mesh(G(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 6)), shaftMat);
    grip.position.y = 0.93;
    sword.add(grip);
    const pommel = new THREE.Mesh(G(new THREE.SphereGeometry(0.025, 8, 6)), metal);
    pommel.position.y = 1.02;
    sword.add(pommel);
    sword.position.set(2.75, 0, -2.42);
    sword.rotation.set(-0.2, 0.3, 0.25);
    sword.traverse((o) => { o.castShadow = true; });
    root.add(sword);
  }

  // ---- the party
  const blob = blobTexture();
  const blobMat = Mt(new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.85 }));
  const blobGeo = G(new THREE.PlaneGeometry(1, 1));
  const shadowBlob = (parent, x, z, sx, sz, ry = 0) => {
    const b = new THREE.Mesh(blobGeo, blobMat);
    b.rotation.set(-Math.PI / 2, 0, ry);
    b.position.set(x, 0.006, z);
    b.scale.set(sx, sz, 1);
    b.renderOrder = 1;
    parent.add(b);
    return b;
  };
  const living = party.filter((ch) => isAlive(ch));
  const sentryIdx = living.findIndex((ch) => String(ch.classSpec).includes('fighter'));
  const seats = [204, 238, 302, 338, 160, 24].map((d) => (d * Math.PI) / 180);
  const minis = [];
  const partyGroup = new THREE.Group();
  root.add(partyGroup);
  const sitLogGeo = G(new THREE.CylinderGeometry(1, 1.05, 1, 14));
  const rolledGeo = G(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 14));
  const matGeo = G(new THREE.BoxGeometry(0.78, 0.035, 1.95, 4, 1, 8));
  const packGeo = G(new THREE.LatheGeometry([[0.001, 0], [0.14, 0.01], [0.18, 0.11], [0.15, 0.24], [0.06, 0.3], [0.045, 0.34], [0.001, 0.34]].map(([x, y]) => new THREE.Vector2(x, y)), 12));
  const packMat = Mt(new THREE.MeshStandardMaterial({ color: 0x5e4a34, roughness: 1, map: getMaterial('prop_burlap')?.map ?? null }));
  const bootGeo = G(new THREE.CapsuleGeometry(0.045, 0.1, 4, 8));
  const bootMat = Mt(new THREE.MeshStandardMaterial({ color: 0x2e2018, roughness: 0.6 }));
  const bedMats = living.map((ch) => {
    const look = defaultLook(ch);
    return Mt(new THREE.MeshStandardMaterial({ color: new THREE.Color(CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1]).multiplyScalar(0.75), roughness: 1, map: getMaterial('prop_burlap')?.map ?? null }));
  });
  const blanketHex = (ch) => {
    const look = defaultLook(ch);
    return `#${new THREE.Color(CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1]).lerp(new THREE.Color(0x9a7a58), 0.45).multiplyScalar(1.45).getHexString()}`;
  };

  /** (Re)place the party: on logs around the fire, or asleep under blankets with one on watch. */
  const placeParty = (sleeping) => {
    for (const m of minis) m.userData.dispose();
    minis.length = 0;
    partyGroup.clear();
    let seat = 0;
    living.forEach((ch, i) => {
      const sentry = i === sentryIdx && living.length > 2 && sleeping;
      if (sentry) {
        // The watch: on the edge of the firelight, turned three-quarters to us, rim-lit by the moon.
        const m = buildMiniature(ch, { pose: 'guard', base: false, rayHead: true, headGain: 0.85, noWeapon: true });
        m.position.set(-1.35, 0, -3.75);
        m.rotation.y = 0.3;
        partyGroup.add(m);
        // His spear grounded at his side, both hands on the shaft, the head catching the fire.
        {
          const hR = m.userData.frames?.hands?.R;
          const hand = hR ? new THREE.Vector3(...hR.c) : new THREE.Vector3(-0.2, 1.0, 0.25);
          const foot = new THREE.Vector3(hand.x - 0.04, 0, hand.z + 0.08);
          const dir = hand.clone().sub(foot).normalize();
          const len = 2.05;
          const spear = new THREE.Group();
          const shaft = new THREE.Mesh(G(new THREE.CylinderGeometry(0.014, 0.017, len, 8)), woodMat);
          shaft.position.y = len / 2;
          spear.add(shaft);
          const tipMat = Mt(new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 1, roughness: 0.42 }));
          const tip = new THREE.Mesh(G(new THREE.ConeGeometry(0.03, 0.24, 4)), tipMat);
          tip.position.y = len + 0.1;
          tip.scale.z = 0.35;
          spear.add(tip);
          const socket = new THREE.Mesh(G(new THREE.CylinderGeometry(0.02, 0.018, 0.08, 8)), tipMat);
          socket.position.y = len - 0.02;
          spear.add(socket);
          spear.position.copy(foot);
          spear.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          spear.traverse((o) => { o.castShadow = true; });
          m.add(spear);
        }
        shadowBlob(partyGroup, -1.35, -3.75, 0.75, 0.75);
        sentryRim.target.position.set(-1.35, 1.1, -3.75);
        sentryFire.target.position.set(-1.35, 1.25, -3.75);
        minis.push(m);
        return;
      }
      // Sleepers lie in a fan behind and beside the fire, feet to the warmth.
      const SLEEP = [[-1.75, -1.35, 0.92], [1.8, -1.3, -0.95], [-0.95, -2.45, 0.37], [1.05, -2.5, -0.4], [0.05, -3.25, 0.02]];
      const a = seats[seat % seats.length];
      const r = 1.5;
      const x = sleeping ? SLEEP[seat % SLEEP.length][0] : Math.cos(a) * r;
      const z = sleeping ? SLEEP[seat % SLEEP.length][1] : Math.sin(a) * r;
      seat++;
      const ry = sleeping ? SLEEP[(seat - 1) % SLEEP.length][2] : Math.atan2(-x, -z);
      const spot = new THREE.Group();
      spot.position.set(x, 0, z);
      spot.rotation.y = ry;
      partyGroup.add(spot);
      if (!sleeping) {
        // A log to sit on (as high as the sitter's seat), the bedroll rolled up behind, a pack.
        const m = buildMiniature(ch, { pose: 'sit', base: false, gear: true, rayHead: true, headGain: 0.6, mod: ['warm', 'talkL', 'listen', 'talkR', 'warm', 'listen'][(seat - 1) % 6] });
        const fr = m.userData.frames;
        const seatTop = fr.joints.pelvis[1] - 0.085 * fr.scale;
        const lr = seatTop / 2;
        const seatLog = new THREE.Mesh(sitLogGeo, barkMat);
        seatLog.rotation.z = Math.PI / 2;
        seatLog.scale.set(lr, 0.62 + 0.1 * fr.scale, lr);
        seatLog.position.set(0, lr, fr.joints.pelvis[2] - 0.02);
        seatLog.castShadow = true;
        seatLog.receiveShadow = true;
        spot.add(seatLog);
        const rolled = new THREE.Mesh(rolledGeo, bedMats[i]);
        rolled.rotation.z = Math.PI / 2;
        rolled.position.set(0.05, 0.11, -0.62);
        rolled.castShadow = true;
        spot.add(rolled);
        const pack = new THREE.Mesh(packGeo, packMat);
        pack.position.set(0.55, 0, -0.45);
        pack.rotation.set(0.15, 0.6, 0.2);
        pack.castShadow = true;
        spot.add(pack);
        shadowBlob(spot, 0, 0.12, 1.0, 1.2);
        shadowBlob(spot, 0.3, -0.55, 0.9, 0.5);
        spot.add(m);
        minis.push(m);
      } else {
        // A bedroll: wool mat, rolled-cloak pillow, a blanket draped over the sleeper, the head on the pillow.
        const poses = ['side', 'side', 'curled', 'back', 'side'];
        const m = buildBedroll(ch, { pose: poses[i % poses.length], blanket: blanketHex(ch), mat: `#${bedMats[i].color.getHexString()}`, seed: i * 7 + 3 });
        m.position.set(0, 0, 0);
        spot.add(m);
        const pack = new THREE.Mesh(packGeo, packMat);
        pack.position.set(0.5, 0, -1.15);
        pack.rotation.set(0, 0.4, 1.3);
        pack.castShadow = true;
        spot.add(pack);
        // Boots set by the foot of the bed.
        for (const sg of [-1, 1]) {
          const boot = new THREE.Mesh(bootGeo, bootMat);
          boot.position.set(-0.5 + sg * 0.06, 0.05, 1.0 + sg * 0.03);
          boot.rotation.y = 0.2 * sg;
          boot.castShadow = true;
          spot.add(boot);
        }
        shadowBlob(spot, 0, 0, 1.05, 2.3);
        shadowBlob(spot, 0, -0.1, 0.8, 1.9);
        minis.push(m);
      }
    });
  };

  let restingNow = !!resting;
  // Opening straight into a full-screen panel (VIEW/ITEMS/MAGIC) hides the
  // diorama: the party is sculpted only when it is first seen.
  let placed = !deferParty;
  if (placed) placeParty(restingNow);

  const update = (time) => {
    // Fire: lively in the evening, burned down to embers while the party sleeps.
    const fl = 0.84 + 0.1 * Math.sin(time * 9.1) + 0.06 * Math.sin(time * 23.7 + 1.3) + 0.05 * Math.sin(time * 4.3);
    const burn = restingNow ? 0.5 : 1;
    fireLight.intensity = (night ? 14 : 9) * burn * fl;
    fireLight.color.setHex(restingNow ? 0xff7a34 : 0xffa25a);
    emberLight.intensity = (restingNow ? 1.1 : 0.6) * (0.9 + 0.1 * Math.sin(time * 3.1));
    moon.intensity = night ? (restingNow ? 1.9 : 1.15) : 1.6;
    backMoon.intensity = night ? (restingNow ? 1.5 : 1.1) : 0.5;
    hemi.intensity = night ? (restingNow ? 0.9 : 0.62) : 0.9;
    sentryRim.intensity = restingNow ? 60 : 0;
    sentryFire.intensity = restingNow ? 26 * fl : 0;
    coalMat.emissiveIntensity = (restingNow ? 1.6 : 1.1) * (0.9 + 0.1 * Math.sin(time * 2.3));
    logMat.emissiveIntensity = (restingNow ? 1.1 : 0.8) * (0.85 + 0.15 * Math.sin(time * 5.7 + 0.4));
    coalChunkMat.emissiveIntensity = (restingNow ? 0.75 : 0.55) * (0.85 + 0.15 * Math.sin(time * 6.1));
    // Burned down for the night: the teepee has collapsed into the embers, a low flame licks the coals.
    for (const lg of teepee) lg.visible = !restingNow;
    for (const lg of collapsed) lg.visible = restingNow;
    volMat.uniforms.uTime.value = time;
    // Resting: the fire burns down to a low flicker over the embers.
    volMat.uniforms.uIntensity.value = (restingNow ? 0.45 : 0.85) * (0.92 + 0.08 * Math.sin(time * 7.3));
    volMat.uniforms.uHeight.value = FH * (restingNow ? 0.42 : 1) * (0.95 + 0.05 * Math.sin(time * 5.3));
    hazeMat.uniforms.uTime.value = time;
    hazeMat.uniforms.uStrength.value = restingNow ? 0.02 : 0.045;
    sky.userData.update?.(time);
    for (const m of minis) m.userData.update(time);
    for (let i = 0; i < NS; i++) {
      // a plume: sparks leave the flame tips, rise fast, drift downwind and wink out; few climb high
      const sp = 0.35 + hrand(i, 1) * 0.45;
      const ph = (time * sp + hrand(i, 2)) % 1;
      const ang = hrand(i, 3) * Math.PI * 2 + ph * (2 + hrand(i, 4) * 3);
      const rad = 0.06 + ph * ph * (0.12 + hrand(i, 5) * 0.22);
      const hMax = restingNow ? 0.6 + hrand(i, 6) * 0.5 : 0.9 + hrand(i, 6) ** 2.2 * 2.6;
      const y = 0.45 + (1 - (1 - ph) * (1 - ph)) * hMax;
      sparkPos[i * 3] = Math.cos(ang) * rad + ph * ph * 0.45 + Math.sin(time * 1.3 + i) * 0.04 * ph;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = Math.sin(ang) * rad - ph * 0.12;
      const f = Math.max(0, 1 - ph * 1.15) * (0.6 + 0.4 * Math.sin(time * 23 + i * 7));
      sparkCol[i * 3] = f; sparkCol[i * 3 + 1] = f * (0.55 + 0.3 * (1 - ph)); sparkCol[i * 3 + 2] = f * 0.25;
    }
    sparkGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = restingNow ? 0.45 : 0.9;
    smoke.forEach((s, i) => {
      // a soft column leaning downwind, widening and thinning as it climbs, lit warm from below
      const ph = (time * 0.06 + i / smoke.length) % 1;
      s.position.set(Math.sin(time * 0.25 + i * 1.7) * 0.08 * (1 + ph * 3) + ph * ph * 1.1, 1.0 + ph * 4.6, -ph * 0.5);
      s.scale.setScalar(0.35 + ph * 2.2);
      s.material.opacity = (restingNow ? 0.32 : 0.26) * Math.sin(Math.min(1, ph * 1.4) * Math.PI) ** 0.8 * (night ? 1 : 0.6);
      s.material.color.setRGB(0.36 + 0.2 * (1 - ph), 0.33 + 0.1 * (1 - ph), 0.36 - 0.02 * (1 - ph));
      s.material.rotation = hrand(i, 111) * 6 + time * 0.05;
    });
  };
  update(0);
  return {
    sky,
    update,
    setResting(on) {
      if (!!on === restingNow && placed) return;
      restingNow = !!on;
      placed = true;
      placeParty(restingNow);
    },
    ensureParty() {
      if (placed) return;
      placed = true;
      placeParty(restingNow);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      env?.dispose();
      for (const m of minis) m.userData.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
    },
  };
}
