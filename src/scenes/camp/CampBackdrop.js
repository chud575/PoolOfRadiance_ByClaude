import * as THREE from 'three';
import { createSkyDome, createTorch, createFlame, flicker } from '../../render/lighting.js';
import { getMaterial, preloadMaterials } from '../../render/materials.js';
import { getGlowTexture } from '../../render/textures/index.js';
import { CLOTH_COLORS, defaultLook } from '../../ui/components/portraitPainter.js';

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
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  return g;
}

/**
 * Build the encampment diorama: a fire among Phlan's ruins, bedrolls for the
 * party, a tent, embers and smoke, under the sky for the current hour.
 * @param {THREE.Scene} scene
 * @param {{party: object[], hour: number}} o
 */
export async function buildCamp(scene, { party, hour }) {
  await preloadMaterials(['floor_rubble', 'wall_ruin', 'prop_wood', 'prop_stone', 'prop_burlap', 'wall_stone']);
  const geos = [];
  const mats = [];
  const track = (g) => (geos.push(g), g);
  const trackM = (m) => (mats.push(m), m);
  const night = hour < 6 || hour >= 19 ? 1 : hour < 7 || hour >= 18 ? 0.5 : 0;

  const sky = createSkyDome({ hour, cloud: 0.35 });
  scene.add(sky);
  scene.fog = new THREE.FogExp2(night ? 0x070a16 : 0x5a6a80, night ? 0.045 : 0.02);
  scene.add(new THREE.HemisphereLight(night ? 0x2a3a70 : 0x9ab0d0, 0x0a0806, night ? 0.22 : 0.9));
  const moon = new THREE.DirectionalLight(night ? 0x8aa6ff : 0xfff0d8, night ? 0.35 : 1.6);
  moon.position.set(-8, 12, -6);
  scene.add(moon);

  // Ground with a scuffed clearing.
  const ground = new THREE.Mesh(track(new THREE.CircleGeometry(40, 64)), getMaterial('floor_rubble'));
  ground.rotation.x = -Math.PI / 2;
  const uv = ground.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 14, uv.getY(i) * 14);
  ground.receiveShadow = true;
  scene.add(ground);
  const ash = new THREE.Mesh(track(new THREE.CircleGeometry(1.25, 32)), trackM(new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1, transparent: true, opacity: 0.85 })));
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.005;
  scene.add(ash);

  // Ruined walls ringing the camp.
  const wallMat = getMaterial('wall_ruin');
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
  const colGeo = track(new THREE.CylinderGeometry(0.32, 0.38, 1, 12));
  for (const [x, z, hh] of [[2.2, -9.5, 4.6], [-4.2, -10.5, 2.4], [9.5, -7.5, 3.4]]) {
    const c = new THREE.Mesh(colGeo, getMaterial('wall_stone'));
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
  const logMat = getMaterial('prop_wood');
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

  const fire = createTorch({ intensity: night ? 46 : 20, distance: 20, color: 0xff8a3a, seed: 5, flame: true, flameScale: 0.95 });
  fire.position.y = 0.12;
  fire.userData.sprite.scale.setScalar(2.6);
  fire.userData.sprite.position.y = 0.6;
  fire.userData.light.position.y = 0.7;
  fire.userData.light.castShadow = true;
  fire.userData.light.shadow.mapSize.set(1024, 1024);
  fire.userData.light.shadow.bias = -0.002;
  scene.add(fire);
  const extraFlames = [];
  for (let i = 0; i < 3; i++) {
    const f = createFlame(0.55 + i * 0.1);
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

  // Bedrolls + packs for each party member (not on the camera side).
  const angles = [-2.35, -1.75, -1.15, -0.4, 0.25, 0.85].slice(0, Math.max(1, party.length));
  const rollGeo = track(new THREE.CapsuleGeometry(0.28, 1.25, 4, 10));
  const pillowGeo = track(new THREE.BoxGeometry(0.46, 0.2, 0.3));
  party.forEach((ch, i) => {
    const look = defaultLook(ch);
    const color = new THREE.Color(CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1]);
    const mat = trackM(new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    const a = angles[i % angles.length] - Math.PI / 2;
    const r = 2.35 + hrand(i, 9) * 0.35;
    const g = new THREE.Group();
    const roll = new THREE.Mesh(rollGeo, mat);
    roll.rotation.z = Math.PI / 2;
    roll.scale.set(0.55, 1, 1);
    roll.position.y = 0.14;
    roll.castShadow = true;
    roll.receiveShadow = true;
    g.add(roll);
    const pillow = new THREE.Mesh(pillowGeo, getMaterial('prop_burlap'));
    pillow.position.set(0.95, 0.12, 0);
    pillow.rotation.y = 0.2;
    pillow.castShadow = true;
    g.add(pillow);
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.rotation.y = -a + Math.PI / 2 + (hrand(i, 5) - 0.5) * 0.4;
    scene.add(g);
  });

  // A tent at the back left, a sword planted in the earth, a shield leaning on a stone.
  const tentMat = trackM(new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1, side: THREE.DoubleSide, map: getMaterial('prop_burlap').map }));
  const tent = new THREE.Mesh(track(new THREE.ConeGeometry(1.5, 1.8, 4, 1, true)), tentMat);
  tent.position.set(-3.6, 0.9, -2.4);
  tent.rotation.y = 0.5;
  tent.castShadow = true;
  tent.receiveShadow = true;
  scene.add(tent);
  const steel = trackM(new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.9, roughness: 0.3 }));
  const blade = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.9, 0.015)), steel);
  blade.position.set(1.7, 0.38, 1.2);
  blade.rotation.z = 0.12;
  blade.castShadow = true;
  scene.add(blade);
  const guard = new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.04, 0.05)), trackM(new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.35 })));
  guard.position.set(1.755, 0.84, 1.2);
  guard.rotation.z = 0.12;
  scene.add(guard);
  const shield = new THREE.Mesh(track(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24)), trackM(new THREE.MeshStandardMaterial({ color: 0x1f3a7c, roughness: 0.6, metalness: 0.2 })));
  shield.position.set(-1.75, 0.4, 1.25);
  shield.rotation.set(Math.PI / 2 - 0.35, 0, 0.5);
  shield.castShadow = true;
  scene.add(shield);
  const boss = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 12, 8)), trackM(new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.3 })));
  boss.position.copy(shield.position).add(new THREE.Vector3(0.02, 0.03, 0.03));
  scene.add(boss);

  const update = (time) => {
    fire.userData.update(time);
    const f = flicker(time, 5);
    coalMat.emissiveIntensity = 1.2 + 0.6 * f;
    sky.userData.update?.(time);
    extraFlames.forEach((fl, i) => {
      fl.scale.y = (0.55 + i * 0.1) * (0.9 + 0.15 * Math.sin(time * (7 + i * 2.3) + i));
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
      sky.geometry.dispose();
      sky.material.dispose();
    },
  };
}
