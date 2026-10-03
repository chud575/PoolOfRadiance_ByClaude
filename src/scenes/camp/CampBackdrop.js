import * as THREE from 'three';
import { createSkyDome } from '../../render/lighting.js';
import { getGrassTexture, getGlowTexture } from '../../render/textures/index.js';
import { CLOTH_COLORS, defaultLook } from '../../ui/components/lookData.js';
import { buildMiniature, miniatureEnvironment } from '../../ui/components/Miniature.js';
import { isAlive } from '../../rules/character.js';
import { buildBedroll } from './bedroll.js';
import { buildRuins } from './ruins.js';
import { groundTextures, barkTextures, blobTexture, earthTextures, woodTextures, canvasTextures } from './campTextures.js';
import { masonryGeometry, masonryMaterial, wallBlocks } from './masonry.js';
import { buildCampfire } from './campfire.js';

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

// ------------------------------------------------------------------ geometry helpers

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
/** The set's textures are all its own (no worker-made library sets to wait for). */
export function prefetchCamp() {
  return Promise.resolve();
}

export async function buildCamp(scene, { party, hour, renderer, resting = false, deferParty = false }) {
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
  // Skylight on the faces of the ruins toward the camp (cool, soft, no shadow): the walls read as
  // stone in the moonlit night instead of black cut-outs.
  const skyFill = new THREE.DirectionalLight(night ? 0x5a70b0 : 0xb0c0dc, night ? 0.55 : 0.4);
  skyFill.position.set(3, 6, 10);
  scene.add(skyFill, skyFill.target);
  const moon = new THREE.DirectionalLight(night ? 0x9ab4ff : 0xfff0d8, night ? 1.15 : 1.6);
  // The moon low on the left: it rakes across the faces of the ruins (every chipped arris and
  // missing block reads) and rims the party's left shoulders.
  moon.position.set(-10, 7.5, -1.5);
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
  sentryRim.position.set(-3.2, 4.6, -5.2);
  scene.add(sentryRim, sentryRim.target);
  // The embers' glow catching the sentry from below and in front (warm), against the moon rim behind (cold).
  const sentryFire = new THREE.SpotLight(0xff8a40, 0, 8, 0.32, 0.7, 1.4);
  sentryFire.position.set(-0.15, 0.5, -0.05);
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
  const et = earthTextures();
  const far = new THREE.Mesh(farGeo, Mt(new THREE.MeshStandardMaterial({ vertexColors: true, map: et.map, normalMap: et.normalMap, roughness: 1 })));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.01;
  far.receiveShadow = true;
  root.add(far);

  // Rubble and tilted broken flags.
  const stoneMat = masonryMaterial(night);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  {
    const loose = [];
    for (let i = 0; i < 70; i++) {
      const a = hrand(i, 11) * Math.PI * 2;
      const r = 2.6 + hrand(i, 12) ** 0.7 * 6;
      const sc = 0.4 + hrand(i, 13) * 1.3;
      loose.push({ p: [Math.cos(a) * r, 0.05 * sc, Math.sin(a) * r - 0.8], s: [0.2 * sc, 0.13 * sc, 0.16 * sc], r: [hrand(i, 14) * 3, hrand(i, 15) * 3, hrand(i, 16) * 3], col: [0.7, 0.68, 0.64].map((c) => c * (0.8 + hrand(i, 17) * 0.3)), dmg: 1, moss: 0.7 });
    }
    for (let i = 0; i < 6; i++) {
      const a = 0.6 + i * 1.05 + hrand(i, 21) * 0.5;
      const r = 3.4 + hrand(i, 22) * 2.4;
      loose.push({ p: [Math.cos(a) * r, 0.05, Math.sin(a) * r - 0.6], s: [0.7, 0.07, 0.5], r: [(hrand(i, 23) - 0.5) * 0.5, hrand(i, 24) * 3, (hrand(i, 25) - 0.5) * 0.35], col: [0.62, 0.6, 0.56], dmg: 0.8, moss: 0.9 });
    }
    const lm = new THREE.Mesh(G(masonryGeometry(loose)), stoneMat);
    lm.castShadow = true;
    lm.receiveShadow = true;
    root.add(lm);
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
  const wt = woodTextures();
  const woodMat = Mt(new THREE.MeshStandardMaterial({ map: wt.map, normalMap: wt.normalMap, roughnessMap: wt.roughnessMap, roughness: 1, color: 0x8a7a6a }));
  buildRuins(root, { G, Mt, night, stoneMat, beamMat: woodMat });
  {
    const set = [];
    // A broken arch: two coursed piers and the surviving voussoirs (three fallen to its foot).
    const archF = new THREE.Matrix4().compose(new THREE.Vector3(1.2, 0, -8.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.1, 0)), new THREE.Vector3(1, 1, 1));
    for (const x of [-1.5, 1.5]) {
      for (let c = 0; c < 9; c++) {
        const t = 0.7 + hrand(c, x + 5) * 0.3;
        set.push({ p: [x + (hrand(c, x + 9) - 0.5) * 0.03, c * 0.345 + 0.17, 0], s: [0.72 - (c % 2) * 0.05, 0.32, 0.76], r: [0, (hrand(c, x + 3) - 0.5) * 0.04, 0], col: [t * 1.02, t, t * 0.93], dmg: c === 8 ? 0.8 : 0.25, moss: 0.6, soot: x < 0 ? 0.5 : 0.1, frame: archF });
        set.push({ p: [x, c * 0.345 + 0.17, 0], s: [0.73, 0.345, 0.66], mortar: true, frame: archF });
      }
    }
    // The ring of voussoirs: wedge-cut stones, each a little narrower than its share of the arc so
    // the joints read as dark lines, deep radially, the extrados stepped (long and short in turn),
    // a proud keystone; three have fallen from the right haunch.
    const nV = 13;
    const step = Math.PI / nV;
    for (let i = 0; i < nV; i++) {
      if (i >= 8 && i <= 10) continue;
      const a = Math.PI - (i + 0.5) * step;
      const key = i === 6;
      const t = 0.72 + hrand(i, 44) * 0.28;
      const depth = key ? 0.68 : i % 2 ? 0.5 : 0.6;
      const rr = 1.5 + depth / 2 - 0.18;
      const tw = 2 * Math.PI * 1.5 / (2 * nV) * 0.86 * (key ? 1.12 : 1);
      set.push({ p: [Math.cos(a) * rr, 3.1 + Math.sin(a) * rr, key ? 0.04 : 0], s: [tw, depth, key ? 0.8 : 0.72], r: [0, 0, a - Math.PI / 2], col: [t * 1.02, t, t * 0.93], dmg: i === 7 || i === 11 ? 0.9 : 0.3, moss: 0.8, soot: 0.25, frame: archF });
      set.push({ p: [Math.cos(a + step / 2) * (1.5 + 0.12), 3.1 + Math.sin(a + step / 2) * (1.5 + 0.12), 0], s: [0.05, 0.52, 0.62], r: [0, 0, a + step / 2 - Math.PI / 2], mortar: true, frame: archF });
    }
    for (let i = 0; i < 3; i++) set.push({ p: [2.3 + i * 0.5, 0.18, -8.0 + i * 0.25], s: [0.6, 0.36, 0.72], r: [hrand(i, 41) * 0.6, hrand(i, 42) * 3, hrand(i, 43) * 0.5], col: [0.72, 0.7, 0.65], dmg: 1, moss: 0.9 });
    // A collapsed tower: coursed rings of blocks with a ragged top and a dark window.
    const tc = new THREE.Vector3(-7.4, 0, -9.2);
    for (let c = 0; c < 20; c++) {
      const r = 1.85 - c * 0.008;
      const nB = 18;
      for (let k = 0; k < nB; k++) {
        const a = ((k + (c % 2) * 0.5) / nB) * Math.PI * 2;
        const cut = 5 + 6 * (0.5 + 0.5 * Math.sin(a * 2 + 1)) + 3 * hrand(k, c * 0 + 7) + 2 * hrand(Math.round(a * 10), 9);
        if (c > cut) continue;
        // a window slot facing the camp
        if (c >= 11 && c <= 13 && Math.abs(((a - 0.65 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.2) continue;
        const t = 0.66 + hrand(k + c * 31, 3) * 0.34;
        set.push({ p: [tc.x + Math.cos(a) * r, c * 0.345 + 0.17, tc.z + Math.sin(a) * r], s: [0.66, 0.32, 0.6], r: [0, -a + Math.PI / 2, 0], col: [t * 1.02, t, t * 0.93], dmg: c >= cut - 1 ? 0.9 : 0.2, soot: 0.6, moss: 0.5 });
        set.push({ p: [tc.x + Math.cos(a) * (r - 0.06), c * 0.345 + 0.17, tc.z + Math.sin(a) * (r - 0.06)], s: [0.66, 0.345, 0.5], r: [0, -a + Math.PI / 2, 0], mortar: true });
      }
    }
    // Column stumps: stacked drums (squared off a little where they broke).
    // (each on a square plinth, the drums seated on one another — slightly shifted by the quake
    // that threw the city down — never floating with gaps between them)
    for (const [x, z, hh] of [[4.2, -7.8, 2.6], [6.6, -7.2, 1.2], [-4.2, -8.6, 1.7]]) {
      set.push({ p: [x, 0.14, z], s: [0.86, 0.28, 0.86], r: [0, hrand(1, z) * 0.3, 0], col: [0.66, 0.64, 0.6], dmg: 0.4, moss: 0.8 });
      const nd = Math.max(1, Math.round(hh / 0.5));
      const dh = (hh - 0.28) / nd;
      for (let k = 0; k < nd; k++) {
        const t = 0.7 + hrand(k, x) * 0.3;
        const off = (hrand(k, x + 2) - 0.5) * 0.04 * k;
        set.push({ p: [x + off, 0.28 + (k + 0.5) * dh, z + off * 0.5], s: [0.6 - k * 0.006, dh + 0.012, 0.6 - k * 0.006], r: [0, hrand(k, z) * 3, 0], col: [t * 1.02, t, t * 0.93], dmg: k === nd - 1 ? 1 : 0.18, moss: 0.7 });
      }
    }
    // Foreground: a fallen drum, a broken stump of wall and two tumbled blocks framing the lower corners.
    set.push({ p: [-1.75, 0.3, 3.25], s: [1.3, 0.62, 0.62], r: [0.05, 0.4, -0.12], col: [0.55, 0.53, 0.5], dmg: 1, moss: 0.9 });
    {
      const fgF = new THREE.Matrix4().compose(new THREE.Vector3(-2.9, 0, 1.9), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0)), new THREE.Vector3(1, 1, 1));
      const { blocks } = wallBlocks(0.95, 1.5, 0.7, 77, { soot: 0.4 });
      for (const bk of blocks) set.push({ ...bk, frame: fgF });
    }
    set.push({ p: [1.85, 0.2, 3.3], s: [0.8, 0.45, 0.55], r: [0.08, -0.5, 0.14], col: [0.6, 0.58, 0.55], dmg: 1, moss: 0.8 });
    set.push({ p: [2.15, 0.5, 3.05], s: [0.55, 0.38, 0.5], r: [-0.3, 0.3, 0.4], col: [0.64, 0.62, 0.58], dmg: 1, moss: 0.8 });
    const mm = new THREE.Mesh(G(masonryGeometry(set)), stoneMat);
    mm.castShadow = true;
    mm.receiveShadow = true;
    root.add(mm);
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

  // ---- the hearth: fieldstones, ember bed, split-log teepee, flame tongues, smoke, sparks
  const fire = buildCampfire({ G, Mt, night });
  root.add(fire.group);
  const bark = barkTextures();
  const barkMat = Mt(new THREE.MeshStandardMaterial({ color: 0xb09078, map: bark.map, normalMap: bark.normalMap, roughness: 0.9 }));

  // ---- props: firewood stack, a lean-to, a cooking pot
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
    const canvasMat = Mt(new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1, side: THREE.DoubleSide, map: canvasTextures().map }));
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

  // ---- the hearth's mark on the court: a scorched ring, drifts of pale ash, scattered kit
  {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    let sd = 71;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    // scorch: a dark burn fading out irregularly, blotched where embers fell
    const rg = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    rg.addColorStop(0, 'rgba(8,6,5,0.9)'); rg.addColorStop(0.45, 'rgba(14,10,8,0.62)'); rg.addColorStop(0.8, 'rgba(20,14,10,0.18)'); rg.addColorStop(1, 'rgba(20,14,10,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 90; k++) {
      const a = rnd() * Math.PI * 2, r = 50 + rnd() * 70, rad = 3 + rnd() * 12;
      g.fillStyle = `rgba(10,8,6,${0.15 + rnd() * 0.3})`;
      g.beginPath(); g.ellipse(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, rad, rad * (0.4 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    // ash: pale grey drifts, heaviest just outside the stones, and a few kicked-out streaks
    for (let k = 0; k < 260; k++) {
      const a = rnd() * Math.PI * 2, r = 60 + Math.abs(rnd() + rnd() - 1) * 70, rad = 1 + rnd() * 5;
      g.fillStyle = `rgba(${150 + rnd() * 40 | 0},${145 + rnd() * 35 | 0},${140 + rnd() * 30 | 0},${0.12 + rnd() * 0.3})`;
      g.beginPath(); g.ellipse(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, rad * 1.6, rad, a, 0, Math.PI * 2); g.fill();
    }
    for (let k = 0; k < 7; k++) {
      const a = rnd() * Math.PI * 2;
      g.strokeStyle = `rgba(160,152,145,${0.12 + rnd() * 0.12})`;
      g.lineWidth = 2 + rnd() * 4;
      g.beginPath(); g.moveTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); g.lineTo(128 + Math.cos(a + 0.2) * (110 + rnd() * 18), 128 + Math.sin(a + 0.2) * (110 + rnd() * 18)); g.stroke();
    }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    texs.push(tx);
    const scorch = new THREE.Mesh(G(new THREE.PlaneGeometry(2.7, 2.7)), Mt(new THREE.MeshStandardMaterial({ map: tx, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 })));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.008;
    scorch.renderOrder = 1;
    scorch.receiveShadow = true;
    root.add(scorch);
    // kit about the hearth: a wooden bowl and spoon, a tin cup on its side, a waterskin, kindling
    const wood = Mt(new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.85 }));
    const tin = Mt(new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.55, metalness: 0.7 }));
    const hide = Mt(new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.8 }));
    const bowl = new THREE.Mesh(G(new THREE.LatheGeometry([[0.001, 0], [0.06, 0.004], [0.085, 0.03], [0.09, 0.05], [0.082, 0.05], [0.055, 0.02], [0.001, 0.016]].map(([x, y]) => new THREE.Vector2(x, y)), 14)), wood);
    bowl.position.set(-0.78, 0.0, 0.55);
    const spoon = new THREE.Mesh(G(new THREE.CapsuleGeometry(0.008, 0.16, 3, 6)), wood);
    spoon.position.set(-0.7, 0.012, 0.66); spoon.rotation.set(Math.PI / 2, 0, 0.9);
    const cup = new THREE.Mesh(G(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 12, 1, true)), tin);
    cup.position.set(0.72, 0.035, 0.7); cup.rotation.set(Math.PI / 2, 0, 0.6);
    const skin = new THREE.Mesh(G(new THREE.SphereGeometry(0.11, 12, 8)), hide);
    skin.scale.set(1.3, 0.55, 0.9); skin.position.set(0.95, 0.055, 0.35); skin.rotation.y = 0.7;
    const neck = new THREE.Mesh(G(new THREE.CylinderGeometry(0.018, 0.024, 0.08, 8)), hide);
    neck.position.set(1.1, 0.07, 0.42); neck.rotation.z = -1.2;
    for (const o of [bowl, spoon, cup, skin, neck]) { o.castShadow = true; o.receiveShadow = true; root.add(o); }
    const stick = G(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 6));
    for (let k = 0; k < 5; k++) {
      const st = new THREE.Mesh(stick, woodMat);
      st.position.set(-0.95 + k * 0.05, 0.02 + (k % 2) * 0.02, -0.25 + k * 0.03);
      st.rotation.set(Math.PI / 2, 0, 0.3 + k * 0.12);
      st.castShadow = true;
      root.add(st);
    }
  }
  // ---- the city beyond keeps a few lights: shuttered windows and the embers of old fires,
  // dimmer and bluer with distance (depth in the skyline, not flat cards)
  if (night) {
    const N = 26;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const z = -16 - hrand(k, 301) * 26;
      pos[k * 3] = (hrand(k, 302) - 0.5) * (30 + (-z - 16) * 1.4);
      pos[k * 3 + 1] = 0.8 + hrand(k, 303) * (k % 3 ? 3.5 : 1.2);
      pos[k * 3 + 2] = z;
      const far = (-z - 16) / 26;
      const ember = k % 4 === 0;
      col[k * 3] = (ember ? 1.0 : 0.95) * (1 - far * 0.55);
      col[k * 3 + 1] = (ember ? 0.42 : 0.66) * (1 - far * 0.5);
      col[k * 3 + 2] = (ember ? 0.12 : 0.3) * (1 - far * 0.2);
    }
    const lg = G(new THREE.BufferGeometry());
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lights = new THREE.Points(lg, Mt(new THREE.PointsMaterial({ map: getGlowTexture(), size: 0.3, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8, sizeAttenuation: true })));
    lights.renderOrder = 3;
    root.add(lights);
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
  const packMat = Mt(new THREE.MeshStandardMaterial({ color: 0x5e4a34, roughness: 1, map: canvasTextures().map }));
  const bedMats = living.map((ch) => {
    const look = defaultLook(ch);
    return Mt(new THREE.MeshStandardMaterial({ color: new THREE.Color(CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1]).multiplyScalar(0.75), roughness: 1, map: canvasTextures().map }));
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
        // At the fire's edge on the left, three-quarters to us and half turned to the flames (his
        // shield arm away from us): the fire lights his face and mail, the moon rims him from behind.
        const SX = -0.95, SZ = -2.05;
        m.position.set(SX, 0, SZ);
        m.rotation.y = 0.68;
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
        shadowBlob(partyGroup, SX, SZ, 0.75, 0.75);
        sentryRim.target.position.set(SX, 1.1, SZ);
        sentryFire.target.position.set(SX, 1.25, SZ);
        minis.push(m);
        return;
      }
      // Sleepers lie in a fan behind and beside the fire, feet to the warmth.
      // Sleepers lie across the view behind the fire (seen in profile from the low resting camera):
      // heads on their rolled cloaks toward the right, faces to the fire, feet to the left.
      const H = -Math.PI / 2;
      const SLEEP = [[1.25, -1.05, H - 0.55], [0.4, -2.2, H - 0.2], [-1.45, -1.0, H + 0.45], [1.55, -2.95, H - 0.35], [-0.3, -3.3, H + 0.2]];
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
        const m = buildMiniature(ch, { pose: 'sit', base: false, gear: true, rayHead: true, headGain: 0.6, mod: ['warm', 'talkL', 'slouch', 'talkR', 'lean', 'listen'][(seat - 1) % 6] });
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

  let camRef = null;
  const update = (time, camera) => {
    if (camera) camRef = camera;
    // Fire: lively in the evening, burned down to embers while the party sleeps.
    fire.update(time, restingNow, camRef);
    const fl = fire.flicker();
    const burn = restingNow ? 0.5 : 1;
    fireLight.intensity = (night ? 14 : 9) * burn * fl;
    fireLight.color.setHex(restingNow ? 0xff7a34 : 0xffa25a);
    emberLight.intensity = (restingNow ? 1.1 : 0.6) * (0.9 + 0.1 * Math.sin(time * 3.1));
    moon.intensity = night ? (restingNow ? 2.2 : 1.9) : 1.6;
    backMoon.intensity = night ? (restingNow ? 1.5 : 1.1) : 0.5;
    hemi.intensity = night ? (restingNow ? 0.9 : 0.62) : 0.9;
    skyFill.intensity = night ? (restingNow ? 0.8 : 0.75) : 0.4;
    sentryRim.intensity = restingNow ? 60 : 0;
    sentryFire.intensity = restingNow ? 26 * fl : 0;
    sky.userData.update?.(time);
    for (const m of minis) m.userData.update(time);
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
