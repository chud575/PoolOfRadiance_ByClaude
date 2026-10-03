import * as THREE from 'three';
import { getGlowTexture } from '../../render/textures/index.js';
import { barkTextures, emberTexture, coalTextures, smokeTexture, stoneTextures, charTextures } from './campTextures.js';

/**
 * The campfire: a ring of soot-blackened fieldstones round an ash bed of glowing coals; a small
 * teepee of split logs whose lower halves are burnt to alligator-cracked charcoal glowing along the
 * cracks, their cut ends showing the rings; licking flame tongues (camera-facing cards, each a
 * tapering tongue torn by rising noise, white-gold at the root through orange to a deep red that
 * dies into smoke at the tip); sparks riding the updraft, a smoke column, heat shimmer, and a warm
 * pool of light on the flags that breathes with the flames. While the party sleeps the teepee has
 * collapsed into the coals and only low flames lick the embers.
 *
 * buildCampfire({G, Mt, night}) → {group, update(time, resting, camera), heat()}
 */

const hrand = (i, s = 0) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const CARD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** One flame tongue: a tapering column torn by rising noise, coloured by temperature. */
const TONGUE_FRAG = /* glsl */`
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uLean;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.07 + 5.3; a *= 0.5; } return s; }
void main() {
  float t = uTime * 1.35 + uSeed * 17.0;
  float y = vUv.y;
  // rising, swirling noise: the tongue is pushed sideways more the higher it licks
  vec2 q = vec2(vUv.x * 2.4 + uSeed * 9.0, y * 2.2 - t * 1.7);
  float wn = fbm(q);
  float wn2 = fbm(q * 2.3 + vec2(4.0, -t * 1.1));
  float x = vUv.x - 0.5 - (wn - 0.5) * 0.42 * y - uLean * y * y - sin(t * 1.9 + y * 4.5) * 0.035 * y;
  // the tongue: broad and rounded at the root, a tapering lick to a point
  float w = 0.4 * pow(1.0 - y, 0.9) * smoothstep(0.0, 0.16, y + 0.05) + 0.015;
  float body = 1.0 - smoothstep(w * 0.35, w, abs(x));
  // ragged, flickering top; licks break off near the tip and burn out
  float top = 1.0 - smoothstep(0.42, 0.98, y + (wn2 - 0.5) * 0.62);
  float d = body * top;
  d *= smoothstep(0.18, 0.6, wn2 + (1.0 - y) * 0.75);
  d *= smoothstep(0.0, 0.05, y);
  if (d < 0.003) discard;
  // inner licks: brighter streaks rising through the body, darker veils between them
  float lick = fbm(vec2(vUv.x * 7.0 + uSeed * 3.0 + (wn - 0.5) * 2.0, y * 3.2 - t * 2.4));
  d *= 0.55 + 0.75 * smoothstep(0.25, 0.75, lick);
  // temperature: hottest just above the root and along the core of the tongue
  float core = 1.0 - abs(x) / max(w, 0.02);
  float temp = d * (1.2 - y * 0.95) * (0.7 + 0.45 * core) * smoothstep(0.0, 0.12, y + 0.02);
  vec3 c = mix(vec3(0.35, 0.03, 0.005), vec3(0.95, 0.24, 0.03), smoothstep(0.05, 0.45, temp));
  c = mix(c, vec3(1.0, 0.5, 0.1), smoothstep(0.45, 0.9, temp));
  c = mix(c, vec3(1.0, 0.8, 0.45), smoothstep(0.95, 1.3, temp));
  gl_FragColor = vec4(c * d * uIntensity, 1.0);
}`;

/** Heat shimmer: a faint warm veil rippling up over the flames (additive). */
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
  gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * (0.5 + n) * m * uStrength, 1.0);
}`;

/** The warm pool of firelight on the flags: an additive radial glow that breathes with the flames. */
const POOL_FRAG = /* glsl */`
uniform float uK;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(vec3(1.0, 0.42, 0.12) * a * uK, 1.0);
}`;

/** A split log: bark round the outside, a crook, knots; the burning end shrunk and cracked. */
function logGeometry(len, r, seed, burnEnd = -1) {
  const g = new THREE.CylinderGeometry(r * 0.92, r, len, 14, 12, false);
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const col = [];
  const crook = (hrand(seed, 2) - 0.5) * 0.05;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i);
    const y = p.getY(i);
    const cap = Math.abs(nrm.getY(i)) > 0.9;
    const rr = Math.hypot(x, z) || 1;
    const a = Math.atan2(z, x);
    const along = 0.5 - (y / len) * burnEnd; // 0 at the burning end, 1 at the far end
    const burn = Math.max(0, Math.min(1, (0.78 - along) * 2.6 + 0.15 * Math.sin(a * 3 + y * 25 + seed)));
    if (!cap) {
      const ridge = 0.05 * Math.abs(Math.sin(a * 6 + Math.sin(y * 7 + seed) * 0.9)) + 0.025 * Math.sin(a * 15 + y * 4);
      const knot = 0.16 * Math.exp(-(((a - seed) % 6.28) ** 2) * 5 - ((y - len * (hrand(seed, 3) - 0.5)) ** 2) * 80);
      // charcoal shrinks into blocky checks
      const check = burn * 0.06 * Math.sign(Math.sin(a * 9 + seed)) * Math.sign(Math.sin(y * 60 + seed * 2));
      const k = 1 + ridge * (1 - burn * 0.6) - 0.04 - burn * 0.12 + check + knot * (1 - burn);
      x = (x / rr) * rr * k;
      z = (z / rr) * rr * k;
    } else if (burn > 0.5) {
      // the burnt end tapers to a ragged stub
      x *= 0.72; z *= 0.72;
    }
    x += crook * Math.sin((y / len + 0.5) * Math.PI) * len;
    p.setXYZ(i, x, y, z);
    const base = cap && burn < 0.5 ? [0.95, 0.82, 0.64] : [0.72, 0.64, 0.56];
    const kk = (1 - burn * 0.93) * (0.86 + 0.14 * Math.sin(a * 6));
    col.push(base[0] * kk, base[1] * kk, base[2] * kk);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // UVs: bark runs along the log; the ember map's hot end (u = 0) at the burning end.
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    const v = uv.getY(k);
    uv.setXY(k, burnEnd < 0 ? v : 1 - v, uv.getX(k) * 2);
  }
  g.computeVertexNormals();
  return g;
}

/** An angular fieldstone: a faceted, flattened lump, sooted on the side and top facing the fire. */
function stoneGeometry(seed, sootDir) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const col = [];
  const tone = 0.34 + hrand(seed, 3) * 0.16;
  // a few cleavage planes give the lump flat, broken faces
  const planes = [];
  // (eight cuts, deep: an angular, split fieldstone, not a pebble)
  for (let k = 0; k < 8; k++) {
    const a = hrand(seed, 10 + k) * 6.28, b = (hrand(seed, 20 + k) - 0.3) * 2.2;
    planes.push([Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b), 0.5 + hrand(seed, 30 + k) * 0.22]);
  }
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.08 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed * 2) + 0.04 * Math.sin(y * 5 + x * 4 + seed) + 0.03 * Math.sign(Math.sin(x * 13 + z * 11 + y * 9 + seed)) * Math.abs(Math.sin(x * 7 + seed));
    x *= n; y *= n; z *= n;
    for (const [nx, ny, nz, d] of planes) {
      const s = x * nx + y * ny + z * nz;
      if (s > d) { const k = s - d; x -= nx * k; y -= ny * k; z -= nz * k; }
    }
    if (y < -0.25) y = -0.25 + (y + 0.25) * 0.3;
    p.setXYZ(i, x, y, z);
    // soot: the face toward the fire and the top, streaked upward
    const toward = Math.max(0, x * sootDir[0] + z * sootDir[1]);
    const soot = Math.max(0, Math.min(1, toward * 1.1 + Math.max(0, y) * 0.5 - 0.15 + 0.2 * Math.sin(x * 9 + y * 14 + seed)));
    const lichen = Math.max(0, Math.sin(x * 4 + seed) * Math.cos(z * 5 + seed) - 0.55) * (1 - soot);
    const k = tone * (1 - soot * 0.9) * (0.88 + 0.12 * Math.sin(x * 9 + z * 7));
    col.push(k * 1.02 - lichen * 0.05, k * 0.98 + lichen * 0.06, k * 0.9 - lichen * 0.08);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * @param {{G: Function, Mt: Function, night: number}} o
 */
export function buildCampfire({ G, Mt, night }) {
  const group = new THREE.Group();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const m4 = new THREE.Matrix4();

  // ---- the ring of fieldstones
  const stn = stoneTextures();
  const stoneMat = Mt(new THREE.MeshStandardMaterial({ vertexColors: true, map: stn.map, normalMap: stn.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: stn.roughnessMap, roughness: 1, color: 0xd8d2ca }));
  const NR = 12;
  for (let i = 0; i < NR; i++) {
    const a = (i / NR) * Math.PI * 2 + hrand(i, 71) * 0.18;
    const s = 0.075 + hrand(i, 72) * 0.05;
    const rr = 0.58 + (hrand(i, 76) - 0.5) * 0.06;
    const st = new THREE.Mesh(G(stoneGeometry(i * 13 + 5, [-Math.cos(a), -Math.sin(a)])), stoneMat);
    st.scale.set(s * (1.25 + hrand(i, 73) * 0.5), s * (0.8 + hrand(i, 74) * 0.35), s * (1 + hrand(i, 75) * 0.2));
    st.position.set(Math.cos(a) * rr, s * 0.42, Math.sin(a) * rr);
    st.rotation.set((hrand(i, 77) - 0.5) * 0.3, -a + Math.PI / 2 + (hrand(i, 78) - 0.5) * 0.4, (hrand(i, 79) - 0.5) * 0.25);
    st.castShadow = true;
    st.receiveShadow = true;
    group.add(st);
  }

  // ---- the ash bed and its coals
  const coal = coalTextures();
  const coalMat = Mt(new THREE.MeshStandardMaterial({ map: coal.map, emissiveMap: coal.emissive, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 1, transparent: true, depthWrite: false }));
  const bed = new THREE.Mesh(G(new THREE.CircleGeometry(0.52, 40)), coalMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.012;
  bed.renderOrder = 1;
  group.add(bed);
  const char = charTextures();
  const chunkMat = Mt(new THREE.MeshStandardMaterial({ color: 0x8a7a70, map: char.map, emissive: 0xffffff, emissiveMap: char.emissive, emissiveIntensity: 0.7, roughness: 0.95 }));
  const chunkGeo = G(new THREE.IcosahedronGeometry(0.03, 1));
  {
    // split, blocky charcoal
    const p = chunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.3 * Math.sin(x * 140 + z * 90) * Math.cos(y * 120) + 0.14 * Math.sin(z * 260 + x * 30);
      p.setXYZ(i, x * k * 1.5, y * k * 0.7, z * k);
    }
    chunkGeo.computeVertexNormals();
  }
  const NC = 56;
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, NC);
  for (let i = 0; i < NC; i++) {
    const a = hrand(i, 81) * Math.PI * 2;
    const r = hrand(i, 82) ** 0.55 * 0.42;
    q.setFromEuler(e.set(hrand(i, 83) * 3, hrand(i, 84) * 3, 0));
    const s = 0.5 + hrand(i, 85) * 1.1;
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 0.018, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.7, s));
    chunks.setMatrixAt(i, m4);
  }
  chunks.receiveShadow = true;
  group.add(chunks);

  // ---- the logs
  const bark = barkTextures();
  const embers = emberTexture();
  const logMat = Mt(new THREE.MeshStandardMaterial({ vertexColors: true, map: bark.map, normalMap: bark.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.95, emissive: 0xffffff, emissiveMap: embers, emissiveIntensity: 0.9 }));
  const logs = new THREE.Group();
  const teepee = [];
  const place = (geo, foot, tip) => {
    const log = new THREE.Mesh(geo, logMat);
    const dir = tip.clone().sub(foot);
    const len = geo.parameters?.height ?? dir.length();
    log.position.copy(foot.clone().add(tip).multiplyScalar(0.5));
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    log.scale.y = dir.length() / len;
    log.castShadow = true;
    log.receiveShadow = true;
    logs.add(log);
    return log;
  };
  // A loose teepee of eight split logs and branches leaning into one another, one fallen half out of it.
  const nT = 8;
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * Math.PI * 2 + 0.35 + (hrand(i, 90) - 0.5) * 0.4;
    const len = (i >= 5 ? 0.48 : 0.62) + hrand(i, 91) * 0.12;
    const r = (i >= 5 ? 0.024 : 0.036) + hrand(i, 92) * 0.014;
    const lg = G(logGeometry(len, r, i * 7 + 3, 1));
    // the burning end (top, u = 0) is where the logs cross in the flames
    const foot = new THREE.Vector3(Math.cos(a) * (0.36 + hrand(i, 94) * 0.06), 0.03, Math.sin(a) * (0.36 + hrand(i, 94) * 0.06));
    const fallen = i === 3;
    const tip = fallen
      ? new THREE.Vector3(Math.cos(a + 0.9) * 0.12, 0.2, Math.sin(a + 0.9) * 0.12)
      : new THREE.Vector3(Math.cos(a + 0.5) * 0.05, 0.42 + hrand(i, 93) * 0.07, Math.sin(a + 0.5) * 0.05);
    teepee.push(place(lg, foot, tip));
  }
  // Two logs laid across the coals under the teepee, burnt through the middle.
  for (let i = 0; i < 2; i++) {
    const lg = G(logGeometry(0.58, 0.042, 40 + i, 1));
    const uv = lg.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, Math.abs(uv.getX(k) - 0.5) * 0.8);
    const a = i * 1.7 + 0.5;
    const foot = new THREE.Vector3(Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3);
    const tip = new THREE.Vector3(-Math.cos(a) * 0.3, 0.05, -Math.sin(a) * 0.3);
    teepee.push(place(lg, foot, tip));
  }
  // Kindling: twigs and split sticks crossed in the coals at the heart of the fire.
  for (let i = 0; i < 7; i++) {
    const a = hrand(i, 140) * Math.PI * 2;
    const lg = G(logGeometry(0.22 + hrand(i, 141) * 0.12, 0.01 + hrand(i, 142) * 0.008, 80 + i, 1));
    const foot = new THREE.Vector3(Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2);
    const tip = new THREE.Vector3(Math.cos(a + 2.4) * 0.06, 0.08 + hrand(i, 143) * 0.12, Math.sin(a + 2.4) * 0.06);
    teepee.push(place(lg, foot, tip));
  }
  // Burned-down logs fallen inward (seen while the party sleeps): their charred ends in the coals.
  const collapsed = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.7;
    const lg = G(logGeometry(0.46 + hrand(i, 95) * 0.1, 0.04 + hrand(i, 96) * 0.01, 60 + i, 1));
    const foot = new THREE.Vector3(Math.cos(a) * 0.46, 0.05, Math.sin(a) * 0.46);
    const tip = new THREE.Vector3(Math.cos(a + 0.25) * 0.06, 0.035 + hrand(i, 97) * 0.03, Math.sin(a + 0.25) * 0.06);
    const log = place(lg, foot, tip);
    log.visible = false;
    collapsed.push(log);
  }
  group.add(logs);

  // ---- the flames: tongues on camera-facing cards, a tall core and lesser licks round it
  const tongues = [];
  const FL = [
    // [x, z, width, height, seed, lean]
    [0.0, 0.0, 0.5, 1.0, 0.11, 0.0],
    [-0.09, 0.05, 0.34, 0.74, 0.37, -0.06],
    [0.1, -0.04, 0.36, 0.8, 0.59, 0.07],
    [0.03, 0.11, 0.28, 0.56, 0.83, 0.03],
    [-0.05, -0.1, 0.3, 0.62, 0.21, -0.04],
    [0.2, 0.08, 0.18, 0.34, 0.71, 0.1],
    [-0.21, -0.02, 0.18, 0.3, 0.47, -0.1],
    [0.06, 0.24, 0.14, 0.22, 0.93, 0.05],
  ];
  for (const [x, z, w, hgt, seed, lean] of FL) {
    const mat = Mt(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uIntensity: { value: 1 }, uLean: { value: lean } },
      vertexShader: CARD_VERT, fragmentShader: TONGUE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const geo = G(new THREE.PlaneGeometry(w, hgt));
    geo.translate(0, hgt / 2, 0);
    const card = new THREE.Mesh(geo, mat);
    card.position.set(x, 0.04, z);
    card.renderOrder = 5;
    card.userData.h = hgt;
    group.add(card);
    tongues.push(card);
  }
  // A soft glow at the heart of the fire (bloom does the rest).
  const glowMat = Mt(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xff8a3a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(1.3, 1.1, 1);
  glow.position.set(0, 0.3, 0);
  glow.renderOrder = 4;
  group.add(glow);

  // ---- the warm pool of light on the ground
  const poolMat = Mt(new THREE.ShaderMaterial({ uniforms: { uK: { value: 0.3 } }, vertexShader: CARD_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const pool = new THREE.Mesh(G(new THREE.PlaneGeometry(4.2, 4.2)), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  pool.renderOrder = 2;
  group.add(pool);

  // ---- heat shimmer, smoke, sparks
  const hazeMat = Mt(new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uStrength: { value: 0.04 } }, vertexShader: CARD_VERT, fragmentShader: HAZE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const haze = new THREE.Mesh(G(new THREE.PlaneGeometry(0.9, 1.6)), hazeMat);
  haze.position.y = 1.55;
  group.add(haze);
  const smokeTex = smokeTexture();
  const smoke = [];
  for (let i = 0; i < 18; i++) {
    const m = Mt(new THREE.SpriteMaterial({ map: smokeTex, color: night ? 0x56545e : 0x9a9aa0, transparent: true, depthWrite: false, opacity: 0.2, rotation: hrand(i, 111) * 6 }));
    const s = new THREE.Sprite(m);
    group.add(s);
    smoke.push(s);
  }
  const NS = 64;
  const sparkGeo = G(new THREE.BufferGeometry());
  const sparkPos = new Float32Array(NS * 3);
  const sparkCol = new Float32Array(NS * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = Mt(new THREE.PointsMaterial({ map: getGlowTexture(), color: 0xffb060, vertexColors: true, size: 0.04, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  group.add(sparks);

  const _v = new THREE.Vector3();
  let flick = 1;
  const update = (time, resting, camera) => {
    flick = 0.84 + 0.1 * Math.sin(time * 9.1) + 0.06 * Math.sin(time * 23.7 + 1.3) + 0.05 * Math.sin(time * 4.3);
    for (const lg of teepee) lg.visible = !resting;
    for (const lg of collapsed) lg.visible = resting;
    logMat.emissiveIntensity = (resting ? 0.62 : 0.9) * (0.85 + 0.15 * Math.sin(time * 5.7 + 0.4));
    coalMat.emissiveIntensity = (resting ? 0.8 : 1.0) * (0.9 + 0.1 * Math.sin(time * 2.3));
    chunkMat.emissiveIntensity = (resting ? 0.6 : 0.85) * (0.85 + 0.15 * Math.sin(time * 6.1));
    // the tongues face the camera (turning about the vertical only) and dance on their own beats
    if (camera) camera.getWorldPosition(_v);
    tongues.forEach((c, i) => {
      if (camera) {
        const wp = c.getWorldPosition(new THREE.Vector3());
        c.rotation.y = Math.atan2(_v.x - wp.x, _v.z - wp.z);
      }
      const k = resting ? (i < 5 ? 0.5 : 0) : 1;
      c.visible = k > 0;
      c.scale.y = k * (0.9 + 0.1 * Math.sin(time * (3.1 + i * 0.7) + i * 1.9));
      c.scale.x = resting ? 0.8 : 1;
      c.material.uniforms.uTime.value = time;
      c.material.uniforms.uIntensity.value = (resting ? 0.4 : i === 0 ? 0.62 : 0.5) * (0.9 + 0.1 * Math.sin(time * 7.3 + i));
    });
    glowMat.opacity = (resting ? 0.06 : 0.18) * flick;
    poolMat.uniforms.uK.value = (resting ? 0.16 : 0.26) * flick * (night ? 1 : 0.4);
    hazeMat.uniforms.uTime.value = time;
    hazeMat.uniforms.uStrength.value = resting ? 0.02 : 0.04;
    for (let i = 0; i < NS; i++) {
      // a plume: sparks leave the flame tips, rise fast, drift downwind and wink out; few climb high
      const sp = 0.35 + hrand(i, 1) * 0.45;
      const ph = (time * sp + hrand(i, 2)) % 1;
      const ang = hrand(i, 3) * Math.PI * 2 + ph * (2 + hrand(i, 4) * 3);
      const rad = 0.05 + ph * ph * (0.12 + hrand(i, 5) * 0.22);
      const hMax = resting ? 0.5 + hrand(i, 6) * 0.4 : 0.8 + hrand(i, 6) ** 2.2 * 2.4;
      const y = 0.35 + (1 - (1 - ph) * (1 - ph)) * hMax;
      sparkPos[i * 3] = Math.cos(ang) * rad + ph * ph * 0.45 + Math.sin(time * 1.3 + i) * 0.04 * ph;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = Math.sin(ang) * rad - ph * 0.12;
      const f = Math.max(0, 1 - ph * 1.15) * (0.6 + 0.4 * Math.sin(time * 23 + i * 7));
      sparkCol[i * 3] = f; sparkCol[i * 3 + 1] = f * (0.5 + 0.3 * (1 - ph)); sparkCol[i * 3 + 2] = f * 0.2;
    }
    sparkGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = resting ? 0.45 : 0.9;
    smoke.forEach((s, i) => {
      // a soft column leaning downwind, widening and thinning as it climbs, lit warm from below
      const ph = (time * 0.06 + i / smoke.length) % 1;
      s.position.set(Math.sin(time * 0.25 + i * 1.7) * 0.08 * (1 + ph * 3) + ph * ph * 1.1, 0.9 + ph * 4.6, -ph * 0.5);
      s.scale.setScalar(0.35 + ph * 2.2);
      s.material.opacity = (resting ? 0.3 : 0.24) * Math.sin(Math.min(1, ph * 1.4) * Math.PI) ** 0.8 * (night ? 1 : 0.6);
      s.material.color.setRGB(0.36 + 0.22 * (1 - ph) ** 3, 0.33 + 0.1 * (1 - ph) ** 3, 0.36 - 0.04 * (1 - ph) ** 3);
      s.material.rotation = hrand(i, 111) * 6 + time * 0.05;
    });
  };
  return { group, update, flicker: () => flick, logMat, barkMat: null };
}
