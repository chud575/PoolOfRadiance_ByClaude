import * as THREE from 'three';
import { createSkyDome } from '../../render/lighting.js';
import { getMaterial, preloadMaterials } from '../../render/materials.js';
import { getGlowTexture, getGrassTexture } from '../../render/textures/index.js';
import { CLOTH_COLORS, defaultLook } from '../../ui/components/lookData.js';
import { buildMiniature, miniatureEnvironment } from '../../ui/components/Miniature.js';
import { isAlive } from '../../rules/character.js';
import { groundTextures, barkTextures, emberTexture, coalTextures, smokeTexture, blobTexture } from './campTextures.js';

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

/** A split log: a bark cylinder with one flat, pale split face. */
function splitLogGeometry(len, r, seed) {
  const g = new THREE.CylinderGeometry(r * 0.92, r, len, 12, 6, false);
  const p = g.attributes.position;
  const col = [];
  const splitA = hrand(seed, 1) * Math.PI * 2;
  const sx = Math.cos(splitA), sz = Math.sin(splitA);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i);
    const y = p.getY(i);
    const rr = Math.hypot(x, z) || 1;
    const along = x * sx + z * sz;
    let split = 0;
    if (along > r * 0.35) {
      // Flatten onto the split plane.
      const over = along - r * 0.35;
      x -= sx * over;
      z -= sz * over;
      split = 1;
    }
    const knot = 0.012 * Math.sin(y * 9 + seed) * (1 - split);
    x += (x / rr) * knot;
    z += (z / rr) * knot;
    p.setXYZ(i, x, y, z);
    // Charred toward the burning end (−y), pale split wood, bark elsewhere.
    const burn = Math.max(0, Math.min(1, (-y / len + 0.5) * 1.6 - 0.15));
    const base = split ? [0.62, 0.48, 0.32] : [1, 1, 1];
    const k = 1 - burn * 0.82;
    col.push(base[0] * k, base[1] * k, base[2] * k);
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
  const walls = [
    [-6.2, -4.6, 0.45, 4.4, 3.4], [-1.8, -7.6, 0.06, 4.2, 2.6], [5.4, -5.6, -0.55, 3.6, 2.4], [8.2, -1.6, -1.25, 3.0, 1.8], [-8.6, -0.4, 1.3, 3.2, 2.2],
  ];
  walls.forEach(([x, z, ry, w, hgt], i) => {
    const m = new THREE.Mesh(G(jaggedWall(w, hgt, 0.55, i * 5 + 1)), ruinMat);
    m.position.set(x - Math.cos(ry) * w / 2, 0, z + Math.sin(ry) * w / 2);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  });
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
  // Phlan's skyline beyond, fading into the fog: roofs, towers and a few lit windows.
  {
    const sil = new THREE.Shape();
    sil.moveTo(-60, 0);
    let x = -60;
    let k = 0;
    const spans = [];
    while (x < 60) {
      const w = 2 + hrand(k, 51) * 4;
      const hh = 3 + hrand(k, 52) * 5 + (hrand(k, 53) > 0.88 ? 6 + hrand(k, 54) * 6 : 0);
      spans.push([x, w, hh]);
      sil.lineTo(x, hh);
      if (hrand(k, 55) > 0.5) sil.lineTo(x + w / 2, hh + 1.6 + hrand(k, 56) * 1.5);
      sil.lineTo(x + w, hh);
      x += w;
      k++;
    }
    sil.lineTo(60, 0);
    const sg = G(new THREE.ShapeGeometry(sil));
    const skyline = new THREE.Mesh(sg, Mt(new THREE.MeshBasicMaterial({ color: night ? 0x111a30 : 0x6a7890, fog: true })));
    skyline.position.set(0, 0, -34);
    root.add(skyline);
    if (night) {
      const winMat = Mt(new THREE.MeshBasicMaterial({ color: 0xffb060, fog: true }));
      const wg = G(new THREE.PlaneGeometry(0.35, 0.5));
      for (let i = 0; i < 18; i++) {
        const [bx, bw, bh] = spans[Math.floor(hrand(i, 61) * spans.length)];
        if (bh < 3.5) continue;
        const w = new THREE.Mesh(wg, winMat);
        w.position.set(bx + bw * (0.25 + hrand(i, 63) * 0.5), 1.2 + hrand(i, 62) * (bh - 2.4), -33.8);
        root.add(w);
      }
    }
  }

  // ---- the hearth: fieldstones, ember bed, split-log teepee, flames, smoke, sparks
  const hearth = new THREE.Group();
  root.add(hearth);
  const stoneVcMat = Mt(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0x8a8580 }));
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
  const coalMat = Mt(new THREE.MeshStandardMaterial({ map: coal.map, emissiveMap: coal.emissive, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 1, transparent: true, depthWrite: false }));
  const bed = new THREE.Mesh(G(new THREE.CircleGeometry(0.5, 40)), coalMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.012;
  hearth.add(bed);
  const coalChunkMat = Mt(new THREE.MeshStandardMaterial({ color: 0x1a0d08, emissive: 0xff4a10, emissiveIntensity: 0.9, roughness: 0.9 }));
  const chunkGeo = G(new THREE.DodecahedronGeometry(0.035, 0));
  const chunks = new THREE.InstancedMesh(chunkGeo, coalChunkMat, 26);
  for (let i = 0; i < 26; i++) {
    const a = hrand(i, 81) * Math.PI * 2;
    const r = hrand(i, 82) ** 0.6 * 0.38;
    q.setFromEuler(e.set(hrand(i, 83) * 3, hrand(i, 84) * 3, 0));
    const s = 0.6 + hrand(i, 85) * 1.0;
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.7, s));
    chunks.setMatrixAt(i, m4);
  }
  hearth.add(chunks);
  const bark = barkTextures();
  const embers = emberTexture();
  const logMat = Mt(new THREE.MeshStandardMaterial({ vertexColors: true, map: bark.map, normalMap: bark.normalMap, roughness: 0.92, emissive: 0xffffff, emissiveMap: embers, emissiveIntensity: 0.8 }));
  const barkMat = Mt(new THREE.MeshStandardMaterial({ color: 0xb09078, map: bark.map, normalMap: bark.normalMap, roughness: 0.9 }));
  const logs = new THREE.Group();
  const nLogs = 6;
  for (let i = 0; i < nLogs; i++) {
    const a = (i / nLogs) * Math.PI * 2 + 0.25;
    const len = 0.78 + hrand(i, 91) * 0.16;
    const lg = G(splitLogGeometry(len, 0.052 + hrand(i, 92) * 0.018, i * 7 + 3));
    // UVs: bark runs along the log; the ember map's hot end (u = 0) at the bottom.
    const uv = lg.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, 1 - uv.getY(k), uv.getX(k) * 2);
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
  hearth.add(logs);
  // Flame cards: crossed planes of noise flame (additive, HDR-limited so the core stays gold).
  const flames = [];
  const flameGeo = G(new THREE.PlaneGeometry(0.5, 0.9, 1, 1));
  flameGeo.translate(0, 0.45, 0);
  const FL = [
    // [x, z, rotY, width scale, height scale, intensity]
    [0.0, 0.02, 0.2, 1.15, 1.45, 0.72], [0.03, -0.03, 1.75, 1.05, 1.3, 0.62],
    [0.13, 0.07, 0.9, 0.62, 0.95, 0.55], [-0.13, -0.05, 2.6, 0.6, 0.9, 0.55], [-0.05, 0.14, 0.4, 0.55, 0.8, 0.5],
  ];
  FL.forEach(([x, z, ry, ws, hs2, inten], i) => {
    const m = Mt(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: i * 0.37 + 0.1 }, uIntensity: { value: inten }, uHeight: { value: 1 } },
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true,
    }));
    const f = new THREE.Mesh(flameGeo, m);
    f.rotation.y = ry;
    f.scale.set(ws, hs2, ws);
    f.position.set(x, 0.12, z);
    f.renderOrder = 5;
    f.userData.base = [ws, hs2, inten];
    hearth.add(f);
    flames.push(f);
  });
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
  for (let i = 0; i < 12; i++) {
    const m = Mt(new THREE.SpriteMaterial({ map: smokeTex, color: night ? 0x484650 : 0x9a9aa0, transparent: true, depthWrite: false, opacity: 0.2, rotation: hrand(i, 111) * 6 }));
    const s = new THREE.Sprite(m);
    hearth.add(s);
    smoke.push(s);
  }
  // Sparks.
  const NS = 70;
  const sparkGeo = G(new THREE.BufferGeometry());
  const sparkPos = new Float32Array(NS * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = Mt(new THREE.PointsMaterial({ map: getGlowTexture(), color: 0xffa050, size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
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
  const bedMats = living.map((ch) => {
    const look = defaultLook(ch);
    return Mt(new THREE.MeshStandardMaterial({ color: new THREE.Color(CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1]).multiplyScalar(0.75), roughness: 1, map: getMaterial('prop_burlap')?.map ?? null }));
  });
  const blanketHex = (ch) => {
    const look = defaultLook(ch);
    return `#${new THREE.Color(CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1]).multiplyScalar(0.8).getHexString()}`;
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
        const m = buildMiniature(ch, { pose: 'guard', base: false });
        m.position.set(2.6, 0, -1.9);
        m.rotation.y = 2.3;
        partyGroup.add(m);
        shadowBlob(partyGroup, 2.6, -1.9, 0.75, 0.75);
        minis.push(m);
        return;
      }
      const a = seats[seat++ % seats.length];
      const r = sleeping ? 1.85 : 1.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const ry = Math.atan2(-x, -z);
      const spot = new THREE.Group();
      spot.position.set(x, 0, z);
      spot.rotation.y = ry;
      partyGroup.add(spot);
      if (!sleeping) {
        // A log to sit on (as high as the sitter's seat), the bedroll rolled up behind, a pack.
        const m = buildMiniature(ch, { pose: 'sit', base: false, gear: true });
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
        // A bedroll mat with the sleeper on it under a blanket, head on a pillow, pack by the head.
        const mat = new THREE.Mesh(matGeo, bedMats[i]);
        mat.position.set(0, 0.018, -0.75);
        mat.receiveShadow = true;
        mat.castShadow = true;
        spot.add(mat);
        const m = buildMiniature(ch, { pose: 'sleep', base: false, blanket: blanketHex(ch) });
        // The sleeper's feet toward the fire.
        m.position.set(0, 0.035, 0.12);
        spot.add(m);
        const pack = new THREE.Mesh(packGeo, packMat);
        pack.position.set(0.5, 0, -1.75);
        pack.rotation.set(0, 0.4, 1.3);
        pack.castShadow = true;
        spot.add(pack);
        shadowBlob(spot, 0, -0.75, 1.0, 2.2);
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
    const burn = restingNow ? 0.32 : 1;
    fireLight.intensity = (night ? 14 : 9) * burn * fl;
    fireLight.color.setHex(restingNow ? 0xff7a34 : 0xffa25a);
    emberLight.intensity = (restingNow ? 1.1 : 0.6) * (0.9 + 0.1 * Math.sin(time * 3.1));
    moon.intensity = night ? (restingNow ? 1.9 : 1.15) : 1.6;
    hemi.intensity = night ? (restingNow ? 0.66 : 0.62) : 0.9;
    coalMat.emissiveIntensity = (restingNow ? 1.6 : 1.1) * (0.9 + 0.1 * Math.sin(time * 2.3));
    logMat.emissiveIntensity = (restingNow ? 1.1 : 0.8) * (0.85 + 0.15 * Math.sin(time * 5.7 + 0.4));
    coalChunkMat.emissiveIntensity = (restingNow ? 1.4 : 0.9) * (0.85 + 0.15 * Math.sin(time * 6.1));
    flames.forEach((f, i) => {
      f.material.uniforms.uTime.value = time;
      const [ws, hs2, inten] = f.userData.base;
      f.material.uniforms.uIntensity.value = inten * (restingNow ? 0.8 : 1) * (0.9 + 0.1 * Math.sin(time * 7 + i));
      f.visible = !restingNow || i >= 2;
      f.scale.set(ws, hs2 * (restingNow ? 0.45 : 1) * (0.94 + 0.06 * Math.sin(time * 5.3 + i * 1.7)), ws);
    });
    hazeMat.uniforms.uTime.value = time;
    hazeMat.uniforms.uStrength.value = restingNow ? 0.02 : 0.045;
    sky.userData.update?.(time);
    for (const m of minis) m.userData.update(time);
    for (let i = 0; i < NS; i++) {
      const sp = 0.22 + hrand(i, 1) * 0.35;
      const ph = (time * sp + hrand(i, 2)) % 1;
      const ang = hrand(i, 3) * Math.PI * 2 + time * (0.6 + hrand(i, 4));
      const rad = 0.05 + ph * (0.25 + hrand(i, 5) * 0.4);
      const hMax = restingNow ? 0.8 : 1.8 + hrand(i, 6) * 1.6;
      sparkPos[i * 3] = Math.cos(ang) * rad + ph * 0.25;
      sparkPos[i * 3 + 1] = 0.3 + ph * hMax;
      sparkPos[i * 3 + 2] = Math.sin(ang) * rad;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = restingNow ? 0.45 : 0.9;
    smoke.forEach((s, i) => {
      const ph = (time * 0.07 + i / smoke.length) % 1;
      s.position.set(Math.sin(time * 0.25 + i) * 0.12 + ph * 0.7, 0.9 + ph * 4.2, -ph * 0.4);
      s.scale.setScalar(0.4 + ph * 2.4);
      s.material.opacity = (restingNow ? 0.3 : 0.2) * Math.sin(ph * Math.PI) * (night ? 1 : 0.6);
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
