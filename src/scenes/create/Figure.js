import * as THREE from 'three';
import { SKIN_TONES, RACE_SKINS, HAIR_COLORS, CLOTH_COLORS, BODIES, HEADS, defaultLook } from '../../ui/components/portraitPainter.js';

/**
 * The combat icon as a painted tabletop miniature: a small figure on a
 * gilt-rimmed base, dressed after the character's portrait choices (armour
 * type, cloth colour, hair, helm) and armed by class.
 *
 * @param {{race:string, gender?:string, classSpec:string, look?:object}} ch
 * @returns {THREE.Group & {userData:{dispose:()=>void}}}
 */
export function buildFigure(ch) {
  const look = defaultLook(ch);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const head = HEADS[gender][look.head % 8];
  const body = BODIES[look.body % BODIES.length].id;
  const cls = String(ch.classSpec).split('/');
  const small = ['dwarf', 'gnome', 'halfling'].includes(ch.race);
  const wide = ch.race === 'dwarf' ? 1.25 : ch.race === 'elf' ? 0.9 : 1;
  const geos = [];
  const mats = [];
  const G = (g) => (geos.push(g), g);
  const M = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    mats.push(m);
    return m;
  };
  const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
  const skin = M({ color: SKIN_TONES[skins[look.skin % skins.length]], roughness: 0.6 });
  const hair = M({ color: HAIR_COLORS[look.hair % HAIR_COLORS.length][1], roughness: 0.75 });
  const clothC = new THREE.Color(CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1]);
  const cloth = M({ color: clothC, roughness: 0.85 });
  const clothDark = M({ color: clothC.clone().multiplyScalar(0.55), roughness: 0.9 });
  const steel = M({ color: 0x8a9099, metalness: 0.9, roughness: 0.46 });
  const mail = M({ color: 0x8a9098, metalness: 0.85, roughness: 0.55 });
  const leather = M({ color: 0x5a3a1e, roughness: 0.75 });
  const gilt = M({ color: 0xd8b25a, metalness: 1, roughness: 0.3 });
  const wood = M({ color: 0x6e4520, roughness: 0.8 });
  const torsoMat = body === 'plate' ? steel : body === 'chain' || body === 'tabard' ? mail : body === 'scale' ? M({ color: 0xa08a50, metalness: 0.8, roughness: 0.45 }) : body === 'leather' || body === 'fur' ? leather : body === 'vestments' ? M({ color: 0xe0d6c0, roughness: 0.85 }) : cloth;
  const robe = body === 'robe' || body === 'vestments';

  const root = new THREE.Group();
  const fig = new THREE.Group();
  root.add(fig);
  const add = (geo, mat, x, y, z, parent = fig) => {
    const m = new THREE.Mesh(G(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Base: dark painted earth with a gilt rim.
  add(new THREE.CylinderGeometry(0.52, 0.56, 0.1, 40), M({ color: 0x2a3020, roughness: 0.9 }), 0, 0.05, 0, root);
  add(new THREE.TorusGeometry(0.54, 0.018, 8, 48), gilt, 0, 0.1, 0, root).rotation.x = Math.PI / 2;

  const s = small ? 0.74 : 1;
  fig.scale.set(s * wide, s, s * wide);
  const hip = 0.78;
  // Legs & boots.
  for (const x of [-0.09, 0.09]) {
    add(new THREE.CapsuleGeometry(0.068, 0.46, 4, 10), robe ? clothDark : body === 'plate' ? steel : clothDark, x, hip - 0.32, 0);
    add(new THREE.CylinderGeometry(0.075, 0.085, 0.18, 12), leather, x, 0.2, 0.01);
  }
  if (robe) {
    add(new THREE.CylinderGeometry(0.2, 0.34, 0.72, 20, 1, true), torsoMat, 0, 0.46, 0).material.side = THREE.DoubleSide;
  }
  // Torso (tapered), belt, tabard.
  // Lathed torso: chest swell, narrow waist.
  const prof = [[0.001, 0], [0.155, 0], [0.165, 0.08], [0.2, 0.28], [0.215, 0.4], [0.19, 0.48], [0.1, 0.54], [0.001, 0.545]].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = add(new THREE.LatheGeometry(prof, 24), torsoMat, 0, hip, 0);
  torso.scale.set(1, 1, 0.78);
  if (!robe) {
    // Skirt of tassets / tunic below the belt.
    add(new THREE.CylinderGeometry(0.17, 0.22, 0.2, 18, 1, true), body === 'plate' || body === 'scale' ? torsoMat : clothDark, 0, hip - 0.1, 0).material.side = THREE.DoubleSide;
  }
  add(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 18), leather, 0, hip + 0.02, 0);
  add(new THREE.BoxGeometry(0.05, 0.035, 0.02), gilt, 0, hip + 0.02, 0.165);
  if (body === 'tabard') add(new THREE.BoxGeometry(0.2, 0.62, 0.02), cloth, 0, hip + 0.16, 0.19);
  if (body === 'plate' || body === 'scale') {
    for (const x of [-1, 1]) add(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, x * 0.23, hip + 0.45, 0).scale.set(1.15, 0.85, 1.1);
  }
  if (body === 'fur') add(new THREE.TorusGeometry(0.17, 0.06, 8, 20), M({ color: 0x7a6450, roughness: 1 }), 0, hip + 0.5, 0).rotation.x = Math.PI / 2;
  // Cloak.
  const cloak = add(new THREE.CylinderGeometry(0.24, 0.36, 0.95, 20, 1, true, Math.PI * 0.62, Math.PI * 0.76), cloth, 0, hip + 0.02, -0.02);
  cloak.material = cloth;
  cloak.geometry.computeVertexNormals();
  mats.push(cloth);
  cloth.side = THREE.DoubleSide;

  // Head.
  const neckY = hip + 0.52;
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), skin, 0, neckY, 0);
  const headY = neckY + 0.14;
  add(new THREE.SphereGeometry(0.125, 24, 18), skin, 0, headY + 0.01, 0).scale.set(0.95, 1.1, 1);
  const eyeM = M({ color: 0x120a06, roughness: 0.4 });
  for (const x of [-1, 1]) add(new THREE.SphereGeometry(0.014, 8, 6), eyeM, x * 0.042, headY + 0.02, 0.112);
  if (ch.race === 'elf' || ch.race === 'halfElf') for (const x of [-1, 1]) add(new THREE.ConeGeometry(0.02, 0.1, 6), skin, x * 0.105, headY + 0.03, -0.01).rotation.z = -x * 1.1;
  if (head.helm) {
    add(new THREE.SphereGeometry(0.142, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), steel, 0, headY + 0.01, 0);
    add(new THREE.BoxGeometry(0.02, 0.09, 0.02), steel, 0, headY - 0.02, 0.115);
  } else if (head.hair === 'hood') {
    add(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth, 0, headY + 0.01, -0.01).rotation.x = -0.25;
  } else if (head.hair !== 'bald') {
    add(new THREE.SphereGeometry(0.133, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, headY + 0.02, -0.005).rotation.x = -0.35;
    if (['long', 'wavy', 'braid'].includes(head.hair)) add(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8), hair, 0, headY - 0.08, -0.02).rotation.y = Math.PI;
    if (head.hair === 'bun' || head.hair === 'topknot') add(new THREE.SphereGeometry(0.05, 12, 10), hair, 0, headY + 0.12, -0.05);
  }
  const bearded = (ch.race === 'dwarf' && gender === 'male') || ['full', 'long', 'goatee'].includes(head.beard) && ch.race !== 'elf' && ch.race !== 'halfling';
  if (bearded) add(new THREE.ConeGeometry(0.08, ch.race === 'dwarf' || head.beard === 'long' ? 0.24 : 0.12, 12), hair, 0, headY - (ch.race === 'dwarf' ? 0.15 : 0.1), 0.06).rotation.x = Math.PI + 0.25;

  // Arms.
  const shY = hip + 0.44;
  const armR = new THREE.Group();
  armR.position.set(-0.25, shY, 0);
  armR.rotation.set(-0.5, 0, -0.12);
  fig.add(armR);
  add(new THREE.CapsuleGeometry(0.052, 0.36, 4, 8), robe ? cloth : torsoMat, 0, -0.2, 0, armR);
  add(new THREE.SphereGeometry(0.05, 10, 8), skin, 0, -0.43, 0, armR);
  const armL = new THREE.Group();
  armL.position.set(0.25, shY, 0);
  armL.rotation.set(-0.3, 0, 0.18);
  fig.add(armL);
  add(new THREE.CapsuleGeometry(0.052, 0.36, 4, 8), robe ? cloth : torsoMat, 0, -0.2, 0, armL);
  add(new THREE.SphereGeometry(0.05, 10, 8), skin, 0, -0.43, 0, armL);

  // Weapon by class (right hand), shield (left arm) for fighters and clerics.
  const hand = new THREE.Group();
  hand.position.set(0, -0.43, 0.02);
  armR.add(hand);
  if (cls.includes('magicUser') && !cls.includes('fighter')) {
    add(new THREE.CylinderGeometry(0.018, 0.022, 1.3, 8), wood, 0, 0.25, 0, hand).rotation.x = 0.5;
    const orb = add(new THREE.SphereGeometry(0.045, 12, 10), M({ color: 0x7fd0ff, emissive: 0x4aa8ff, emissiveIntensity: 2.2, roughness: 0.2 }), 0, 0.82, 0.37, hand);
    orb.castShadow = false;
  } else if (cls.includes('cleric') && !cls.includes('fighter')) {
    const shaft = add(new THREE.CylinderGeometry(0.018, 0.02, 0.5, 8), wood, 0, 0.12, 0.1, hand);
    shaft.rotation.x = 1.1;
    add(new THREE.SphereGeometry(0.06, 10, 8), steel, 0, 0.24, 0.35, hand);
  } else {
    const len = cls.includes('fighter') ? 0.62 : 0.42;
    const blade = add(new THREE.BoxGeometry(0.035, len, 0.008), steel, 0, 0.06 + len / 2, 0.02, hand);
    blade.parent.rotation.x = 1.25;
    add(new THREE.BoxGeometry(0.14, 0.02, 0.03), gilt, 0, 0.06, 0.02, hand);
  }
  if (cls.includes('fighter') || cls.includes('cleric')) {
    if (!(cls.includes('magicUser') && !cls.includes('fighter'))) {
      const sh = add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 24), M({ color: clothC, roughness: 0.55, metalness: 0.15 }), 0.05, -0.28, 0.06, armL);
      sh.rotation.set(Math.PI / 2, 0, 0.1);
      const rim = add(new THREE.TorusGeometry(0.2, 0.014, 6, 32), gilt, 0.05, -0.28, 0.078, armL);
      rim.rotation.z = 0.1;
      add(new THREE.SphereGeometry(0.04, 10, 8), gilt, 0.05, -0.28, 0.09, armL);
    }
  }

  root.userData.dispose = () => {
    for (const g of geos) g.dispose();
    for (const m of new Set(mats)) m.dispose();
  };
  return root;
}
