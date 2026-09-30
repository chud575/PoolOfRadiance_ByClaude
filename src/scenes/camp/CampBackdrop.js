import * as THREE from 'three';
import { createSkyDome, createTorch, createFlame, flicker } from '../../render/lighting.js';
import { getMaterial, preloadMaterials } from '../../render/materials.js';
import { getGlowTexture } from '../../render/textures/index.js';
import { CLOTH_COLORS, defaultLook } from '../../ui/components/portraitPainter.js';
import { buildMiniature, miniatureEnvironment } from '../../ui/components/Miniature.js';
import { clothSet } from '../../ui/components/miniatureTextures.js';
import { isAlive } from '../../rules/character.js';

/** Deterministic hash → [0,1). */
const hrand = (i, s = 0) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function jaggedWall(w, h, seed) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w, 0);
  const steps = 7;
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * w;
    const top = h * (0.45 + 0.55 * hrand(i, seed)) * (i === 0 || i === steps ? 0.7 : 1);
    s.lineTo(x + (hrand(i, seed + 3) - 0.5) * 0.3, top);
  }
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: false });
  const uv = g.attributes.uv;
  const p = g.attributes.position;
  const c = [];
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    const ao = 0.45 + 0.55 * Math.min(1, p.getY(i) / 1.4);
    c.push(ao, ao, ao);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

/**
 * Build the encampment diorama: a fire among Phlan's ruins, bedrolls for the
 * party, a tent, embers and smoke, under the sky for the current hour.
 * @param {THREE.Scene} scene
 * @param {{party: object[], hour: number}} o
 */
export async function buildCamp(scene, { party, hour, renderer }) {
  await preloadMaterials(['arch_flags', 'arch_mud', 'arch_ruin', 'prop_wood', 'prop_stone', 'prop_burlap', 'arch_stone', 'prop_rubble']);
  const geos = [];
  const mats = [];
  const track = (g) => (geos.push(g), g);
  const trackM = (m) => (mats.push(m), m);
  const night = hour < 6 || hour >= 19 ? 1 : hour < 7 || hour >= 18 ? 0.5 : 0;

  let env = null;
  if (renderer) {
    env = miniatureEnvironment(renderer, { warm: 0xff8a40, cool: 0x3a5aa0 });
    scene.environment = env;
    scene.environmentIntensity = night ? 0.35 : 0.8;
  }
  const sky = createSkyDome({ hour, cloud: 0.35 });
  scene.add(sky);
  scene.fog = new THREE.FogExp2(night ? 0x070a16 : 0x5a6a80, night ? 0.045 : 0.02);
  scene.add(new THREE.HemisphereLight(night ? 0x2a3a70 : 0x9ab0d0, 0x0a0806, night ? 0.22 : 0.9));
  const moon = new THREE.DirectionalLight(night ? 0x8aa6ff : 0xfff0d8, night ? 0.35 : 1.6);
  moon.position.set(-8, 12, -6);
  scene.add(moon);

  // Ground: trodden mud with a scuffed clearing (world-scaled UVs + white AO colours for the arch_ shader).
  const groundGeo = track(new THREE.CircleGeometry(40, 64));
  {
    const p = groundGeo.attributes.position;
    const uv = groundGeo.attributes.uv;
    const c = [];
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, p.getX(i) / 3, p.getY(i) / 3);
      c.push(1, 1, 1);
    }
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  const ground = new THREE.Mesh(groundGeo, getMaterial('arch_flags'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const ash = new THREE.Mesh(track(new THREE.CircleGeometry(1.25, 32)), trackM(new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1, transparent: true, opacity: 0.85 })));
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.005;
  scene.add(ash);

  // Ruined walls ringing the camp.
  const wallMat = getMaterial('arch_ruin');
  const walls = [
    [-5.5, -4.5, 0.5, 5, 3.4], [-1.2, -7, 0.05, 6, 4.2], [4.8, -5.2, -0.6, 4.5, 3.0], [7.6, -1.2, -1.3, 3.2, 2.2], [-8.2, -0.8, 1.2, 3.6, 2.4],
  ];
  walls.forEach(([x, z, ry, w, hgt], i) => {
    const m = new THREE.Mesh(track(jaggedWall(w, hgt, i * 5 + 1)), wallMat);
    m.position.set(x - Math.cos(ry) * w / 2, 0, z + Math.sin(ry) * w / 2);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  });
  // A broken column pair on the skyline.
  const colGeo = track(new THREE.CylinderGeometry(0.32, 0.38, 1, 16));
  colGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(colGeo.attributes.position.count * 3).fill(0.85), 3));
  for (const [x, z, hh] of [[2.2, -9.5, 4.6], [-4.2, -10.5, 2.4], [9.5, -7.5, 3.4]]) {
    const c = new THREE.Mesh(colGeo, getMaterial('arch_stone'));
    c.scale.set(1, hh, 1);
    c.position.set(x, hh / 2, z);
    c.castShadow = true;
    scene.add(c);
  }

  // Fire pit: stones, logs, glowing coals.
  const stoneGeo = track(new THREE.DodecahedronGeometry(0.17, 0));
  const stoneMat = getMaterial('prop_stone');
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2;
    const st = new THREE.Mesh(stoneGeo, stoneMat);
    const sc = 0.8 + hrand(i, 2) * 0.6;
    st.scale.set(sc * 1.2, sc * 0.8, sc);
    st.rotation.set(hrand(i, 3) * 3, hrand(i, 4) * 3, 0);
    st.position.set(Math.cos(a) * 0.78, 0.08, Math.sin(a) * 0.78);
    st.castShadow = true;
    scene.add(st);
  }
  const logGeo = track(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 8));
  const wood = getMaterial('prop_wood');
  const logMat = trackM(new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1, map: wood.map, normalMap: wood.normalMap, emissive: 0xff4a10, emissiveIntensity: 0.25, emissiveMap: wood.map }));
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(logGeo, logMat);
    const a = (i / 6) * Math.PI * 2 + 0.3;
    l.position.set(Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2);
    l.rotation.set(Math.sin(a) * 0.62, 0, -Math.cos(a) * 0.62);
    l.castShadow = true;
    scene.add(l);
  }
  const coalMat = trackM(new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff5a18, emissiveIntensity: 1.6, roughness: 1 }));
  const coals = new THREE.Mesh(track(new THREE.CircleGeometry(0.42, 24)), coalMat);
  coals.rotation.x = -Math.PI / 2;
  coals.position.y = 0.03;
  scene.add(coals);

  const fire = createTorch({ intensity: night ? 30 : 16, distance: 20, color: 0xff8a3a, seed: 5, flame: true, flameScale: 0.8 });
  fire.position.y = 0.12;
  fire.userData.sprite.scale.setScalar(1.9);
  fire.userData.sprite.position.y = 0.6;
  fire.userData.light.position.y = 0.7;
  fire.userData.light.castShadow = true;
  fire.userData.light.shadow.mapSize.set(1024, 1024);
  fire.userData.light.shadow.bias = -0.002;
  scene.add(fire);
  const extraFlames = [];
  for (let i = 0; i < 3; i++) {
    const f = createFlame(0.42 + i * 0.08);
    const a = (i / 3) * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.14);
    scene.add(f);
    extraFlames.push(f);
  }

  // Embers: additive points spiralling up from the fire.
  const N = 90;
  const emberGeo = track(new THREE.BufferGeometry());
  const pos = new Float32Array(N * 3);
  emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const emberMat = trackM(new THREE.PointsMaterial({ map: getGlowTexture(), color: 0xffa050, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  scene.add(embers);

  // Smoke: soft sprites drifting up.
  const smokeTex = getGlowTexture();
  const smoke = [];
  for (let i = 0; i < 7; i++) {
    const m = trackM(new THREE.SpriteMaterial({ map: smokeTex, color: night ? 0x3a3a44 : 0x9a9aa0, transparent: true, depthWrite: false, opacity: 0.2 }));
    const s = new THREE.Sprite(m);
    scene.add(s);
    smoke.push(s);
  }

  // The party itself, as miniatures: most sit around the fire on their
  // bedrolls; the first able fighter stands watch at the edge of the light.
  const minis = [];
  const living = party.filter((ch) => isAlive(ch));
  const sentryIdx = living.findIndex((ch) => String(ch.classSpec).includes('fighter'));
  const seats = [200, 238, 302, 338, 160, 22].map((d) => (d * Math.PI) / 180);
  const clothTex = clothSet();
  const burlap = getMaterial('prop_burlap');
  const packMat = trackM(new THREE.MeshStandardMaterial({ color: 0x6a5a44, roughness: 1, map: burlap.map, normalMap: burlap.normalMap }));
  let seat = 0;
  living.forEach((ch, i) => {
    const sentry = i === sentryIdx && living.length > 2;
    const m = buildMiniature(ch, { pose: sentry ? 'guard' : 'sit', base: false, merge: true });
    if (sentry) {
      m.position.set(2.35, 0, -2.2);
      m.rotation.y = 2.5;
    } else {
      const a = seats[seat++ % seats.length];
      const r = 2.15;
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      m.rotation.y = Math.atan2(-m.position.x, -m.position.z);
      // Bedroll beneath and behind the sitter, a pack at its head.
      const look = defaultLook(ch);
      const color = new THREE.Color(CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1]).multiplyScalar(0.8);
      const bm = trackM(new THREE.MeshStandardMaterial({ color, roughness: 1, map: clothTex.map, normalMap: clothTex.normalMap }));
      const roll = new THREE.Group();
      const blanket = new THREE.Mesh(track(new THREE.BoxGeometry(0.72, 0.07, 1.7, 4, 1, 8)), bm);
      {
        const p = blanket.geometry.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k);
          const z = p.getZ(k);
          p.setY(k, p.getY(k) + 0.025 * Math.sin(z * 9 + x * 4 + i) + (Math.abs(x) > 0.3 ? -0.03 : 0));
        }
        blanket.geometry.computeVertexNormals();
      }
      blanket.position.set(0, 0.04, -0.55);
      blanket.receiveShadow = true;
      blanket.castShadow = true;
      roll.add(blanket);
      const rolled = new THREE.Mesh(track(new THREE.CylinderGeometry(0.13, 0.13, 0.74, 14)), bm);
      rolled.rotation.z = Math.PI / 2;
      rolled.position.set(0, 0.13, -1.4);
      rolled.castShadow = true;
      roll.add(rolled);
      const pack = new THREE.Mesh(track(new THREE.LatheGeometry([[0.001, 0], [0.16, 0.01], [0.2, 0.12], [0.17, 0.26], [0.07, 0.33], [0.05, 0.38], [0.001, 0.38]].map(([x, y]) => new THREE.Vector2(x, y)), 12)), packMat);
      pack.rotation.z = 1.2;
      pack.position.y = 0.05;
      pack.position.set(0.45, 0.16, -1.2);
      pack.castShadow = true;
      roll.add(pack);
      roll.position.copy(m.position);
      roll.rotation.y = m.rotation.y;
      scene.add(roll);
    }
    scene.add(m);
    minis.push(m);
  });

  // A lean-to tent behind the circle: two canvas planes on a ridge pole.
  const canvasMat = trackM(new THREE.MeshStandardMaterial({ color: 0x9a8a68, roughness: 1, side: THREE.DoubleSide, map: getMaterial('prop_burlap').map, normalMap: getMaterial('prop_burlap').normalMap }));
  const tent = new THREE.Group();
  for (const s of [-1, 1]) {
    const g = track(new THREE.PlaneGeometry(2.0, 1.55, 8, 6));
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, 0.05 * Math.sin(p.getX(k) * 5) * (0.5 - p.getY(k) / 1.55));
    g.computeVertexNormals();
    const pl = new THREE.Mesh(g, canvasMat);
    pl.position.set(0, 0.62, s * 0.55);
    pl.rotation.set(s * -0.78, 0, 0);
    pl.castShadow = true;
    pl.receiveShadow = true;
    tent.add(pl);
  }
  const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 8)), getMaterial('prop_wood'));
  pole.rotation.z = Math.PI / 2;
  pole.position.y = 1.18;
  tent.add(pole);
  for (const x of [-1.05, 1.05]) {
    const up = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.035, 1.2, 8)), getMaterial('prop_wood'));
    up.position.set(x, 0.6, 0);
    up.castShadow = true;
    tent.add(up);
  }
  tent.position.set(3.4, 0, -3.3);
  tent.rotation.y = -0.5;
  scene.add(tent);

  // Firewood stacked by the tent and a lantern hung on the ruined wall.
  const logGeo2 = track(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8));
  for (let k = 0; k < 7; k++) {
    const l = new THREE.Mesh(logGeo2, getMaterial('prop_wood'));
    const row = k < 4 ? 0 : k < 6 ? 1 : 2;
    const col = row === 0 ? k : row === 1 ? k - 4 : 0;
    l.rotation.x = Math.PI / 2;
    l.position.set(2.2 + col * 0.17 + row * 0.085, 0.08 + row * 0.15, -3.0);
    l.castShadow = true;
    scene.add(l);
  }

  const update = (time) => {
    fire.userData.update(time);
    for (const m of minis) m.userData.update(time);
    const f = flicker(time, 5);
    coalMat.emissiveIntensity = 1.2 + 0.6 * f;
    sky.userData.update?.(time);
    extraFlames.forEach((fl, i) => {
      fl.scale.y = (0.42 + i * 0.08) * (0.9 + 0.15 * Math.sin(time * (7 + i * 2.3) + i));
    });
    for (let i = 0; i < N; i++) {
      const sp = 0.25 + hrand(i, 1) * 0.35;
      const ph = (time * sp + hrand(i, 2)) % 1;
      const ang = hrand(i, 3) * Math.PI * 2 + time * (0.6 + hrand(i, 4));
      const rad = 0.1 + ph * (0.35 + hrand(i, 5) * 0.5);
      pos[i * 3] = Math.cos(ang) * rad + ph * 0.3;
      pos[i * 3 + 1] = 0.25 + ph * (2.2 + hrand(i, 6) * 1.6);
      pos[i * 3 + 2] = Math.sin(ang) * rad;
    }
    emberGeo.attributes.position.needsUpdate = true;
    emberMat.opacity = 0.85;
    smoke.forEach((s, i) => {
      const ph = (time * 0.08 + i / smoke.length) % 1;
      s.position.set(0.1 + ph * 0.8 + Math.sin(time * 0.3 + i) * 0.2, 1.4 + ph * 4.5, -0.1 - ph * 0.5);
      s.scale.setScalar(0.8 + ph * 3.2);
      s.material.opacity = 0.16 * Math.sin(ph * Math.PI);
    });
  };
  update(0);
  return {
    fire,
    sky,
    update,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      env?.dispose();
      for (const m of minis) m.userData.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
    },
  };
}
