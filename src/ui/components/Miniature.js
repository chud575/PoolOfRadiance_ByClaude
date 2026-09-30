import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SKIN_TONES, RACE_SKINS, HAIR_COLORS, EYE_COLORS, CLOTH_COLORS, BODIES, HEADS, defaultLook } from './portraitPainter.js';
import * as TX from './miniatureTextures.js';
import { ITEMS } from '../../data/items.js';

/**
 * Articulated, textured 3D miniatures of player characters — the "combat
 * icon" of the Gold Box games reimagined as a painted tabletop figure. Dressed
 * after the character's portrait choices (armour, cloth colour, hair, helm,
 * beard), proportioned by race and gender, and armed by class.
 *
 * Shared by character creation (standing on a gilt base) and the camp (sitting
 * around the fire). Pure three.js: no scene imports, no randomness beyond the
 * character's look seed.
 *
 * @typedef {'stand'|'sit'|'guard'|'sleep'} Pose
 */

const RACE_BUILD = {
  //        height  width  head  limb
  human: { h: 1, w: 1, head: 1, limb: 1 },
  elf: { h: 0.97, w: 0.88, head: 0.97, limb: 1.04 },
  halfElf: { h: 0.99, w: 0.94, head: 1, limb: 1.02 },
  dwarf: { h: 0.72, w: 1.3, head: 1.2, limb: 0.85 },
  gnome: { h: 0.62, w: 1.02, head: 1.28, limb: 0.86 },
  halfling: { h: 0.62, w: 1.02, head: 1.25, limb: 0.9 },
};

/** Pose table: joint rotations [x, y, z] (figure faces +z; −x swings a limb forward). */
const POSES = {
  stand: {
    pelvis: 0.95, spine: [0.03, -0.1, 0], neck: [0, 0.15, 0], head: [-0.06, 0.12, 0.02],
    thighL: [0.12, 0, 0.08], kneeL: [0.12, 0, 0], thighR: [-0.22, 0, -0.07], kneeR: [0.22, 0, 0],
    shoulderR: [-0.35, 0, -0.18], elbowR: [-1.05, 0, 0], shoulderL: [-0.55, 0, 0.32], elbowL: [-1.1, 0.4, 0],
    footL: [-0.1, 0, 0], footR: [0.0, 0, 0],
  },
  guard: {
    pelvis: 0.95, spine: [0.0, 0.2, 0], neck: [0, -0.3, 0], head: [0.05, -0.25, 0],
    thighL: [0.05, 0, 0.06], kneeL: [0.05, 0, 0], thighR: [-0.05, 0, -0.06], kneeR: [0.05, 0, 0],
    shoulderR: [-0.15, 0, -0.1], elbowR: [-0.5, 0, 0], shoulderL: [-0.2, 0, 0.18], elbowL: [-0.7, 0.3, 0],
    footL: [0, 0, 0], footR: [0, 0, 0],
  },
  sleep: {
    pelvis: 0.95, spine: [0, 0, 0], neck: [0.1, 0, 0], head: [0.1, 0.5, 0.2],
    thighL: [-0.25, 0, 0.04], kneeL: [0.5, 0, 0], thighR: [-0.05, 0, -0.04], kneeR: [0.15, 0, 0],
    shoulderR: [-0.1, 0, -0.05], elbowR: [-0.5, 0, 0], shoulderL: [-0.35, 0, 0.1], elbowL: [-1.4, 0, 0],
    footL: [0.3, 0, 0], footR: [0.4, 0, 0],
  },
  sit: {
    pelvis: 0.2, spine: [0.3, 0, 0], neck: [0.05, 0, 0], head: [0.12, 0, 0],
    thighL: [-1.75, 0.12, 0.24], kneeL: [2.0, 0, 0], thighR: [-1.6, -0.15, -0.26], kneeR: [1.95, 0, 0],
    shoulderR: [-0.95, 0, -0.1], elbowR: [-0.85, 0, 0], shoulderL: [-0.9, 0, 0.12], elbowL: [-0.85, 0, 0],
    footL: [-0.45, 0, 0], footR: [-0.4, 0, 0],
  },
};

const hexNum = (c) => parseInt(c.slice(1), 16);

function lathe(profile, segs = 20) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), segs);
}

/** A tapered limb hanging along −y from its joint: [radius at 0..1] samples. */
function limbGeo(len, radii, segs = 14) {
  const n = radii.length;
  const prof = [[0.0005, 0.02 * len]];
  prof.push([radii[0] * 0.75, 0.012 * len]);
  for (let i = 0; i < n; i++) prof.push([radii[i], -(i / (n - 1)) * len]);
  prof.push([radii[n - 1] * 0.7, -len - 0.012 * len]);
  prof.push([0.0005, -len - 0.02 * len]);
  // Lathe profiles run bottom→top for outward normals.
  return lathe(prof.reverse(), segs);
}

/**
 * Sculpt a head from a sphere: brow ridge, eye sockets, nose, cheekbones,
 * tapered jaw and chin. The UVs stay spherical so faceTexture() lines up.
 */
function sculpt(v, o, shell = 0) {
  const G = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
  const { x, y, z } = v;
  const front = Math.max(0, z);
  let r = 1 + shell;
  if (!shell) {
    r += 0.07 * G(x, y, 0, 0.2, 0.45, 0.07) * front; // brow ridge
    r -= 0.075 * (G(x, y, 0.35, 0.05, 0.14, 0.09) + G(x, y, -0.35, 0.05, 0.14, 0.09)) * front; // sockets
    r += o.nose * 0.24 * G(x, y, 0, -0.14, 0.07, 0.15) * front ** 3; // nose ridge
    r += o.nose * 0.05 * G(x, y, 0, -0.26, 0.08, 0.05) * front; // nose tip / wings
    r += 0.05 * (G(x, y, 0.5, -0.14, 0.14, 0.1) + G(x, y, -0.5, -0.14, 0.14, 0.1)) * front; // cheekbones
    r += 0.04 * G(x, y, 0, -0.46, 0.2, 0.06) * front; // lips
  }
  r += 0.06 * o.chin * G(x, y, 0, -0.74, 0.18, 0.1) * front; // chin
  v.multiplyScalar(r);
  // Lower face: bring the jaw forward (faces are flatter than spheres) and narrow it.
  if (v.y < -0.1) {
    const t = Math.min(1, (-v.y - 0.1) / 0.9);
    v.x *= 1 - t * t * (1 - o.jaw) * 1.4;
    if (v.z > 0) v.z += 0.1 * t * front;
    else v.z *= 1 - t * 0.35;
  }
  // Skull: fuller at the back, slight flattening of the sides.
  if (v.z < 0) v.z *= 1.08;
  v.x *= 0.84;
  v.y *= 1.1;
  return v;
}

/**
 * Sculpt a head from a sphere: brow ridge, eye sockets, nose, cheekbones,
 * tapered jaw and chin. The UVs stay spherical so faceTexture() lines up.
 */
function headGeo(o) {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    sculpt(v.fromBufferAttribute(p, i), o);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A beard as a shell over the jaw (sideburns → chin), with the mouth left
 * clear; `length` draws it down into a point (dwarves, sages).
 */
function beardGeo(o, length) {
  const g = new THREE.SphereGeometry(1, 40, 28, -Math.PI * 0.12, Math.PI * 1.24, Math.PI * 0.53, Math.PI * 0.45);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const front = Math.max(0, v.z);
    // Mouth opening: tuck the shell inside the face around the lips.
    const mouth = Math.exp(-((v.x / 0.2) ** 2) - (((v.y + 0.45) / 0.09) ** 2)) * front
      + (Math.abs(v.x) < 0.42 && v.y > -0.4 ? front : 0);
    const back = v.z < -0.2 ? 1 : 0;
    sculpt(v, o, 0.07 - mouth * 0.16 - back * 0.1 + 0.03 * Math.sin(v.x * 30 + v.y * 11));
    if (v.y < -0.55) {
      const t = -v.y - 0.55;
      v.y -= t * length * 2.2;
      v.z += t * length * 0.9 * front;
      v.x *= 1 - Math.min(0.7, t * length * 1.6);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A hair cap: the upper skull shell, tipped back so the hairline clears the brow. */
function hairGeo(style) {
  const long = style === 'long' || style === 'wavy' || style === 'braid' || style === 'bob';
  const short = style === 'short' || style === 'crop';
  const g = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * (long ? 0.64 : 0.52));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const tip = new THREE.Euler(long ? -0.8 : style === 'swept' ? -0.7 : -0.6, 0, 0);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const az = Math.atan2(v.x, v.z);
    let r = (short ? 1.035 : 1.06) + 0.012 * Math.sin(az * 23 + v.y * 9);
    if (style === 'wavy') r += 0.035 * Math.sin(az * 9) * Math.max(0, 0.6 - v.y);
    if (style === 'swept') r += 0.07 * Math.max(0, v.z) * Math.max(0, v.y);
    // Side-part volume and a widow's peak dip at the front.
    r += 0.03 * Math.max(0, v.y - 0.5);
    v.multiplyScalar(r).applyEuler(tip);
    v.x *= 0.86;
    v.y *= 1.1;
    if (v.z < 0) v.z *= 1.08;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A draped cloak: an arc behind the shoulders falling in folds. */
function cloakGeo(len, width, flare, sit) {
  const W = 18;
  const Hh = 14;
  const g = new THREE.PlaneGeometry(1, 1, W, Hh);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const v = 0.5 - p.getY(i);
    const a = (u - 0.5) * Math.PI * 1.15;
    const r = width + flare * v;
    const fold = 0.028 * Math.sin(u * Math.PI * 9) * Math.min(1, v * 2.2);
    let x = Math.sin(a) * r;
    let z = -Math.cos(a) * r * 0.62 - 0.03 - fold - (sit ? v * v * 0.45 : v * 0.08);
    let y = -v * len;
    x += Math.sin(a) * fold * 0.5;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

const ARMOR_BODY = { plate: 'plate', banded: 'plate', splint: 'plate', chain: 'chain', ring: 'chain', scale: 'scale', leather: 'leather', padded: 'leather', studded: 'leather' };

/**
 * What a character actually has readied, in miniature terms. Null when the
 * character has no inventory (a creation draft): then the look and class decide.
 * @returns {{body:string|null, weapon:string|null, shield:boolean, helm:boolean}|null}
 */
export function miniatureGear(ch) {
  if (!Array.isArray(ch.inventory)) return null;
  const eq = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]).map((e) => ITEMS[e.id]);
  const armor = eq.find((d) => d.type === 'armor');
  const wpn = eq.find((d) => d.type === 'weapon');
  return {
    body: armor ? ARMOR_BODY[armor.armorGroup] ?? 'chain' : null,
    weapon: wpn ? ({ sword: 'sword', dagger: 'dagger', mace: 'mace', axe: 'axe', staff: 'staff', spear: 'spear', bow: 'bow', sling: null }[wpn.icon] ?? 'sword') : null,
    shield: eq.some((d) => d.type === 'shield'),
    helm: eq.some((d) => d.type === 'helm'),
  };
}

/**
 * Build a miniature.
 * @param {{race:string, gender?:string, classSpec:string, look?:object, name?:string}} ch
 * @param {{pose?: Pose, base?: boolean, merge?: boolean, gear?: boolean}} [opt]  gear: dress from readied equipment (default when the character has an inventory)
 * @returns {THREE.Group & {userData:{dispose:()=>void, update:(t:number)=>void, height:number}}}
 */
export function buildMiniature(ch, opt = {}) {
  const poseName = opt.pose ?? 'stand';
  const pose = POSES[poseName] ?? POSES.stand;
  const look = defaultLook(ch);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const fem = gender === 'female';
  const head = HEADS[gender][look.head % 8];
  const gear = opt.gear === false ? null : miniatureGear(ch);
  const lookBody = BODIES[look.body % BODIES.length].id;
  const body = !gear ? lookBody : gear.body ?? (['robe', 'vestments'].includes(lookBody) ? lookBody : 'robe');
  const cls = String(ch.classSpec).split('/');
  const has = (c) => cls.includes(c);
  const build = RACE_BUILD[ch.race] ?? RACE_BUILD.human;
  const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
  const skinHex = SKIN_TONES[skins[look.skin % skins.length]];
  const hairHex = HAIR_COLORS[look.hair % HAIR_COLORS.length][1];
  const clothHex = CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1];
  const eyeHex = EYE_COLORS[look.eyes % EYE_COLORS.length];

  const geos = [];
  const mats = [];
  const G = (g) => (geos.push(g), g);
  const M = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    mats.push(m);
    return m;
  };
  const tex = (s, rx, ry) => {
    // Per-material repeat without cloning the cached canvases' images.
    const out = {};
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      const t = s[k].clone();
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
      out[k] = t;
      texs.push(t);
    }
    return out;
  };
  const texs = [];

  // ---------------------------------------------------------------- materials
  const clothC = new THREE.Color(clothHex);
  const skin = M({ color: skinHex, roughness: 0.58 });
  const face = M({
    map: TX.faceTexture({
      skin: skinHex, eyes: eyeHex, hair: hairHex, fem,
      stubble: fem || ch.race === 'elf' ? 0 : head.beard === 'stubble' ? 0.8 : head.beard === 'none' ? 0.15 : head.beard === 'moustache' ? 0.3 : 0.6,
      age: head.age ?? 0, brow: ch.race === 'dwarf' ? 1.5 : 1,
    }),
    roughness: 0.55,
  });
  const hair = M({ color: hairHex, roughness: 1, ...tex(TX.hairSet(), 3, 2) });
  const cloth = M({ color: clothC, roughness: 1, side: THREE.DoubleSide, ...tex(TX.clothSet(), 3, 3) });
  const clothDark = M({ color: clothC.clone().multiplyScalar(0.5), roughness: 1, ...tex(TX.clothSet(), 2, 4) });
  const trousers = M({ color: new THREE.Color(0x3a3228), roughness: 1, ...tex(TX.clothSet(), 2, 4) });
  const steel = M({ color: 0xa8adb6, metalness: 0.9, roughness: 0.36 });
  const darkSteel = M({ color: 0x6a6d74, metalness: 0.85, roughness: 0.48 });
  const mail = M({ color: 0x9aa0a8, metalness: 0.85, roughness: 1, ...tex(TX.mailSet(), 4, 3) });
  const scaleM = M({ color: 0xc8a060, metalness: 0.85, roughness: 1, ...tex(TX.scaleSet(), 3, 2) });
  const leather = M({ color: 0x8a5a34, roughness: 1, ...tex(TX.leatherSet(), 2, 2) });
  const darkLeather = M({ color: 0x4a3020, roughness: 1, ...tex(TX.leatherSet(), 1, 2) });
  const gilt = M({ color: 0xc9a050, metalness: 1, roughness: 0.34 });
  const wood = M({ color: 0xa07048, roughness: 1, ...tex(TX.woodSet(), 1, 3) });
  const fur = M({ color: 0x8a7258, roughness: 1, ...tex(TX.furSet(), 3, 1) });
  const linen = M({ color: 0xe8e0cc, roughness: 1, side: THREE.DoubleSide, ...tex(TX.clothSet(), 3, 3) });

  steel.side = THREE.DoubleSide;
  scaleM.side = THREE.DoubleSide;
  const torsoMat = {
    plate: steel, chain: mail, scale: scaleM, leather, robe: cloth, tabard: mail, fur: leather, vestments: linen,
  }[body] ?? cloth;
  const robe = body === 'robe' || body === 'vestments';
  const armored = body === 'plate' || body === 'chain' || body === 'scale' || body === 'tabard';

  // ---------------------------------------------------------------- skeleton
  const root = new THREE.Group();
  const fig = new THREE.Group();
  root.add(fig);
  const meshes = [];
  const add = (geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(G(geo), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    meshes.push(m);
    return m;
  };
  const joint = (parent, x, y, z, rot) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    if (rot) j.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(j);
    return j;
  };

  if (opt.base !== false) {
    const bs = TX.baseSet();
    const top = M({ roughness: 0.95, map: bs.map, normalMap: bs.normalMap, roughnessMap: bs.roughnessMap });
    const rim = M({ color: 0x1a1612, roughness: 0.55, metalness: 0.2 });
    add(new THREE.CylinderGeometry(0.5, 0.56, 0.1, 48), [rim, top, rim], root, 0, 0.05, 0);
    const ring = add(new THREE.TorusGeometry(0.5, 0.012, 8, 64), gilt, root, 0, 0.1, 0, Math.PI / 2);
    ring.castShadow = false;
    // A few pebbles and tufts on the base.
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39 + look.seed % 7;
      const r = 0.3 + ((i * 37) % 13) / 70;
      add(new THREE.DodecahedronGeometry(0.02 + (i % 3) * 0.008, 0), darkSteel, root, Math.cos(a) * r, 0.105, Math.sin(a) * r, i, i * 2, 0, 1, 0.6, 1).material = M({ color: 0x6a655c, roughness: 0.9 });
    }
  }

  const fs = build.h;
  const figY = opt.base !== false ? 0.1 : 0;
  fig.position.y = figY;
  fig.scale.set(fs * build.w, fs, fs * build.w);
  const headScale = build.head / build.w; // undo the width stretch on the head

  const hipW = fem ? 0.105 : 0.095;
  const shW = (fem ? 0.18 : 0.21);
  const pelvis = joint(fig, 0, pose.pelvis, 0);
  const spine = joint(pelvis, 0, 0.02, 0, pose.spine);

  // Torso: chest swell, narrow waist; female: fuller hips and bust.
  const tp = fem
    ? [[0.001, -0.02], [0.15, -0.02], [0.155, 0.06], [0.125, 0.2], [0.155, 0.33], [0.165, 0.4], [0.15, 0.47], [0.085, 0.53], [0.001, 0.535]]
    : [[0.001, -0.02], [0.145, -0.02], [0.15, 0.06], [0.155, 0.2], [0.19, 0.34], [0.2, 0.42], [0.18, 0.48], [0.09, 0.535], [0.001, 0.54]];
  const torso = add(lathe(tp, 28), torsoMat, spine, 0, 0, 0, 0, 0, 0, 1, 1, 0.72);
  // Pectoral / breastplate ridge on plate.
  if (body === 'plate') {
    add(lathe([[0.001, 0.08], [0.16, 0.1], [0.19, 0.3], [0.19, 0.42], [0.1, 0.5], [0.001, 0.5]], 28), steel, spine, 0, 0, 0.012, 0, 0, 0, 1.03, 1, 0.8);
    // Faulds (hooped plates over the belly/hips).
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.155 + i * 0.012, 0.165 + i * 0.012, 0.05, 28, 1, true), steel, pelvis, 0, -0.03 - i * 0.045, 0, 0, 0, 0, 1, 1, 0.78);
  }
  // Gorget / collar.
  if (armored) add(new THREE.TorusGeometry(0.075, 0.03, 10, 24), body === 'plate' ? steel : body === 'scale' ? scaleM : mail, spine, 0, 0.52, 0, Math.PI / 2, 0, 0, 1, 0.85, 1);
  if (body === 'fur' || (body === 'leather' && !has('thief'))) add(new THREE.TorusGeometry(0.13, 0.07, 10, 24), fur, spine, 0, 0.5, -0.01, Math.PI / 2, 0, 0, 1.1, 0.9, 0.85);
  // Tabard panels front and back.
  if (body === 'tabard') {
    for (const s of [1, -1]) add(new THREE.PlaneGeometry(0.2, 0.78, 1, 6), cloth, spine, 0, 0.12, s * 0.118, 0, s < 0 ? Math.PI : 0, 0, 1, 1, 1).rotation.x = s * 0.06;
    add(new THREE.CircleGeometry(0.05, 16), gilt, spine, 0, 0.33, 0.121);
  }
  if (body === 'vestments') {
    // Stole in the cloth colour over the white robe.
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.045, 0.62, 0.012), cloth, spine, s * 0.06, 0.2, 0.13, 0.05, 0, s * -0.08);
  }
  // Belt with buckle and pouch.
  const beltY = 0.05;
  add(new THREE.CylinderGeometry(0.152, 0.152, 0.045, 28), darkLeather, pelvis, 0, beltY, 0, 0, 0, 0, 1.02, 1, 0.76);
  add(new THREE.BoxGeometry(0.045, 0.04, 0.02), gilt, pelvis, 0, beltY, 0.118);
  add(new THREE.BoxGeometry(0.06, 0.07, 0.035), leather, pelvis, -0.12, beltY - 0.04, 0.07, 0, 0.6, 0);

  // Skirt below the belt: hauberk hem, tunic or long robe.
  if (robe) {
    const len = poseName === 'sit' ? 0.3 : 0.86;
    const sk = add(lathe([[0.17, 0], [0.19, -len * 0.3], [0.24, -len * 0.75], [0.29, -len]].reverse(), 28), torsoMat, pelvis, 0, beltY, 0, 0, 0, 0, 1, 1, 0.82);
    sk.material.side = THREE.DoubleSide;
    if (poseName === 'sit') sk.rotation.x = -0.9;
    if (body === 'vestments') add(new THREE.CylinderGeometry(0.29, 0.29, 0.03, 28, 1, true), gilt, pelvis, 0, beltY - len + 0.015, 0, 0, 0, 0, 1, 1, 0.82).visible = poseName !== 'sit';
  } else if (body === 'chain' || body === 'tabard' || body === 'scale') {
    const sk = add(lathe([[0.155, 0.02], [0.175, -0.12], [0.2, -0.26]].reverse(), 28, true), torsoMat, pelvis, 0, beltY, 0, 0, 0, 0, 1, 1, 0.8);
    sk.material.side = THREE.DoubleSide;
    if (poseName === 'sit') sk.scale.y = 0.4;
  } else {
    const sk = add(lathe([[0.152, 0.02], [0.165, -0.08], [0.175, -0.15]].reverse(), 28), body === 'leather' ? darkLeather : clothDark, pelvis, 0, beltY, 0, 0, 0, 0, 1, 1, 0.8);
    sk.material.side = THREE.DoubleSide;
  }

  // ---------------------------------------------------------------- legs
  const L = build.limb;
  const legMat = body === 'plate' ? steel : robe ? clothDark : trousers;
  const legs = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'R' : 'L';
    const thigh = joint(pelvis, s * hipW, -0.02, 0, pose[`thigh${side}`]);
    add(limbGeo(0.44 * L, [0.078, 0.082, 0.072, 0.058, 0.05]), legMat, thigh);
    const knee = joint(thigh, 0, -0.44 * L, 0, pose[`knee${side}`]);
    if (body === 'plate') add(new THREE.SphereGeometry(0.058, 14, 10), steel, knee, 0, 0, 0.02, 0, 0, 0, 1, 1, 1.1);
    add(limbGeo(0.42 * L, [0.052, 0.058, 0.05, 0.04, 0.038]), body === 'plate' ? steel : legMat, knee);
    // Boots: shaft + foot.
    const bootMat = body === 'plate' ? darkSteel : darkLeather;
    add(new THREE.CylinderGeometry(0.052, 0.046, 0.2, 14), bootMat, knee, 0, -0.33 * L, 0.002);
    const foot = joint(knee, 0, -0.42 * L, 0, pose[`foot${side}`]);
    add(new THREE.SphereGeometry(0.05, 14, 10), bootMat, foot, 0, -0.02, 0.05, 0, 0, 0, 0.9, 0.62, 1.9);
    legs[side] = { thigh, knee };
  }

  // ---------------------------------------------------------------- arms
  const sleeve = robe ? cloth : body === 'plate' ? steel : body === 'chain' || body === 'tabard' ? mail : body === 'scale' ? scaleM : body === 'leather' || body === 'fur' ? leather : cloth;
  const arms = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'R' : 'L';
    const sh = joint(spine, s * shW, 0.455, 0, pose[`shoulder${side}`]);
    add(new THREE.SphereGeometry(0.066, 14, 10), sleeve, sh);
    add(limbGeo(0.29 * L, [0.062, 0.058, 0.052, 0.045]), sleeve, sh);
    if (body === 'plate' || body === 'scale') {
      // Layered pauldrons.
      const pm = body === 'plate' ? steel : scaleM;
      add(new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), pm, sh, s * 0.012, 0.02, 0, 0, 0, s * 0.22, 1.12, 0.8, 1.05);
      add(new THREE.SphereGeometry(0.098, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), pm, sh, s * 0.03, -0.035, 0, 0, 0, s * 0.42, 1.05, 0.7, 1.0);
    }
    const el = joint(sh, 0, -0.29 * L, 0, pose[`elbow${side}`]);
    const fore = robe ? cloth : body === 'plate' ? steel : leather;
    add(limbGeo(0.26 * L, [0.045, 0.05, 0.042, 0.034]), armored && body !== 'plate' ? sleeve : fore, el);
    if (robe) add(lathe([[0.04, 0], [0.06, -0.12], [0.085, -0.22]].reverse(), 16), cloth, el, 0, -0.02, 0).material.side = THREE.DoubleSide;
    else add(new THREE.CylinderGeometry(0.044, 0.05, 0.12, 14), body === 'plate' ? steel : darkLeather, el, 0, -0.19 * L, 0); // bracer / vambrace
    const hand = joint(el, 0, -0.26 * L - 0.03, 0);
    add(new THREE.SphereGeometry(0.038, 12, 10), body === 'plate' ? darkSteel : skin, hand, 0, 0, 0.005, 0, 0, 0, 0.85, 1.15, 1.05);
    arms[side] = { sh, el, hand };
  }

  // ---------------------------------------------------------------- head
  const neck = joint(spine, 0, 0.515, 0, pose.neck);
  add(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 14), skin, neck, 0, 0.02, 0.005);
  const headJ = joint(neck, 0, 0.03, 0.014, pose.head);
  headJ.scale.set(headScale, build.head, headScale);
  const HR = 0.1; // head radius
  const hg = headJ; // head group
  const skull = new THREE.Group();
  skull.position.y = HR * 1.05;
  skull.scale.setScalar(HR);
  hg.add(skull);
  const fc = head.face ?? {};
  const shape = {
    nose: (ch.race === 'gnome' ? 1.8 : ch.race === 'dwarf' ? 1.35 : ch.race === 'elf' ? 0.8 : fem ? 0.85 : 1) * (fc.nose ?? 1),
    jaw: Math.min(0.98, (fem ? 0.72 : ch.race === 'dwarf' ? 0.92 : ch.race === 'elf' ? 0.7 : 0.82) * (fc.jaw ?? 1)),
    chin: (fem ? 0.6 : 1) * (fc.chin ?? 1),
  };
  add(headGeo(shape), face, skull);
  // Ears.
  const elfEar = ch.race === 'elf' || ch.race === 'halfElf';
  for (const s of [-1, 1]) {
    if (elfEar) add(new THREE.ConeGeometry(0.11, ch.race === 'elf' ? 0.55 : 0.36, 8), skin, skull, s * 0.8, 0.12, -0.08, -0.35, 0, -s * 1.15, 1, 1, 0.35);
    else add(new THREE.SphereGeometry(0.16, 10, 8), skin, skull, s * 0.83, -0.02, -0.05, 0, 0, 0, 0.4, 1, 0.7);
  }
  // Hair, helm or hood.
  const style = head.hair;
  if (head.helm || gear?.helm) {
    add(new THREE.SphereGeometry(1.14, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), steel, skull, 0, 0.02, -0.02, 0, 0, 0, 0.9, 1.1, 1.05);
    add(new THREE.TorusGeometry(1.03, 0.07, 8, 32), steel, skull, 0, 0.02, -0.02, Math.PI / 2, 0, 0, 0.9, 1.05, 1);
    add(new THREE.BoxGeometry(0.12, 0.62, 0.08), steel, skull, 0, -0.18, 1.02, -0.12);
    add(new THREE.BoxGeometry(0.09, 0.5, 0.06), gilt, skull, 0, 0.5, 0.95, 0.5); // crest ridge
    if (fem) add(new THREE.CylinderGeometry(0.2, 0.08, 1.2, 10), hair, skull, 0, -0.6, -0.9, 0.3);
  } else if (style === 'hood') {
    const hood = add(new THREE.SphereGeometry(1.22, 28, 18, Math.PI * 0.12, Math.PI * 1.76, 0, Math.PI * 0.68), cloth, skull, 0, 0.05, -0.06, 0, Math.PI, 0, 0.95, 1.1, 1.1);
    hood.rotation.y = -Math.PI / 2 - Math.PI * 0.12 + Math.PI;
    // Mantle down over the shoulders.
    add(lathe([[0.001, 0.56], [0.07, 0.56], [0.16, 0.52], [0.26, 0.4], [0.28, 0.33]].reverse(), 24), cloth, spine, 0, 0, 0, 0, 0, 0, 1, 1, 0.8).material.side = THREE.DoubleSide;
  } else if (style !== 'bald') {
    add(hairGeo(style), hair, skull, 0, 0.02, -0.01);
    if (style === 'long' || style === 'wavy') add(lathe([[0.72, 0], [0.78, -0.6], [0.72, -1.3], [0.55, fem ? -2.1 : -1.7]].reverse(), 24), hair, skull, 0, 0.1, -0.2, 0.15, 0, 0, 1, 1, 0.7).material.side = THREE.DoubleSide;
    if (style === 'bob') add(lathe([[0.95, 0.2], [1.0, -0.3], [0.9, -0.7]].reverse(), 24), hair, skull, 0, 0, -0.08, 0, 0, 0, 0.9, 1, 1).material.side = THREE.DoubleSide;
    if (style === 'braid') for (let i = 0; i < 6; i++) add(new THREE.SphereGeometry(0.22 - i * 0.015, 10, 8), hair, skull, 0, -0.4 - i * 0.32, -0.95 - i * 0.05);
    if (style === 'bun') add(new THREE.SphereGeometry(0.38, 16, 12), hair, skull, 0, 0.55, -0.85);
    if (style === 'topknot') {
      add(new THREE.SphereGeometry(0.26, 14, 10), hair, skull, 0, 1.05, -0.35);
      add(new THREE.ConeGeometry(0.2, 0.8, 10), hair, skull, 0, 0.6, -1.0, -2.2);
    }
  }
  // Beards: dwarves always, elves and halflings never.
  const beardStyle = ch.race === 'dwarf' && !fem ? (head.beard === 'none' || head.beard === 'stubble' || head.beard === 'moustache' ? 'full' : head.beard) : fem || ch.race === 'elf' || ch.race === 'halfling' ? 'none' : head.beard;
  if (beardStyle === 'full' || beardStyle === 'long') {
    const len = beardStyle === 'long' || ch.race === 'dwarf' ? 0.9 : 0.25;
    add(beardGeo(shape, len), hair, skull).material.side = THREE.DoubleSide;
    add(new THREE.TorusGeometry(0.2, 0.06, 8, 16, Math.PI), hair, skull, 0, -0.34, 0.95, 0, 0, Math.PI, 1, 0.7, 1);
  } else if (beardStyle === 'goatee') {
    add(new THREE.ConeGeometry(0.16, 0.5, 12), hair, skull, 0, -0.98, 0.62, Math.PI + 0.35);
    add(new THREE.TorusGeometry(0.2, 0.05, 8, 16, Math.PI), hair, skull, 0, -0.34, 0.95, 0, 0, Math.PI, 1, 0.7, 1);
  } else if (beardStyle === 'moustache') {
    add(new THREE.TorusGeometry(0.22, 0.06, 8, 16, Math.PI), hair, skull, 0, -0.36, 0.95, 0, 0, Math.PI, 1.1, 0.8, 1);
  }

  // ---------------------------------------------------------------- cloak
  const wantsCloak = !robe || body === 'robe';
  if (wantsCloak && style !== 'hood') {
    const len = poseName === 'sit' ? 0.62 : 0.98;
    const cl = add(cloakGeo(len, 0.17, 0.2, poseName === 'sit'), cloth, spine, 0, 0.5, -0.01);
    cl.userData.cloak = true;
    // Clasp.
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.018, 8, 6), gilt, spine, s * 0.1, 0.49, 0.07);
  }

  // ---------------------------------------------------------------- arms & armaments
  fig.updateMatrixWorld(true);
  const figInv = new THREE.Matrix4().copy(fig.matrixWorld).invert();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Quaternion();
  /** Attach obj to parent but orient it in figure space by euler e. */
  const attachOriented = (obj, parent, e) => {
    parent.add(obj);
    parent.updateMatrixWorld(true);
    const pm = new THREE.Matrix4().multiplyMatrices(figInv, parent.matrixWorld);
    pm.decompose(new THREE.Vector3(), _p, new THREE.Vector3());
    _q.setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
    obj.quaternion.copy(_p.invert().multiply(_q));
    // Undo the parent's non-uniform (race) scale so weapons keep their shape.
    const ws = new THREE.Vector3();
    parent.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    const fsv = new THREE.Vector3();
    fig.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), fsv);
    obj.scale.set(fsv.y / ws.x, fsv.y / ws.y, fsv.y / ws.z);
  };

  const sitting = poseName === 'sit';
  const asleep = poseName === 'sleep';
  const mu = has('magicUser') && !has('fighter');
  const cl = has('cleric') && !has('fighter');
  const thiefOnly = has('thief') && !has('fighter');
  const weapon = gear ? gear.weapon : mu ? 'staff' : cl ? 'mace' : thiefOnly ? 'dagger' : 'sword';
  const wantShield = gear ? gear.shield : (has('fighter') || has('cleric')) && !mu;
  const roundShield = cl || has('cleric') && !has('fighter');
  const wpn = new THREE.Group();
  if (asleep || !weapon) {
    // Arms stowed beside the bedroll (or bare hands).
  } else if (weapon === 'staff') {
    // Gnarled staff with a glowing crystal.
    const prof = [];
    for (let i = 0; i <= 16; i++) {
      const y = i / 16;
      prof.push([0.017 + 0.004 * Math.sin(i * 2.7) + (y > 0.9 ? 0.012 : 0), y * 1.35]);
    }
    add(lathe(prof, 10), wood, wpn, 0, -0.45, 0);
    const claw = [0, 1, 2, 3].map((i) => add(new THREE.ConeGeometry(0.012, 0.12, 5), wood, wpn, Math.cos(i * 1.57) * 0.03, 1.04, Math.sin(i * 1.57) * 0.03, Math.sin(i * 1.57) * 0.5, 0, -Math.cos(i * 1.57) * 0.5));
    void claw;
    const crystal = add(new THREE.OctahedronGeometry(0.045, 0), M({ color: 0x9fdcff, emissive: 0x58b8ff, emissiveIntensity: 2.4, roughness: 0.15, metalness: 0.1 }), wpn, 0, 0.98, 0, 0, 0.4, 0, 1, 1.6, 1);
    crystal.castShadow = false;
    wpn.userData.crystal = crystal;
    attachOriented(wpn, arms.R.hand, sitting ? [0.15, 0, -0.25] : [0.08, 0, -0.08]);
    if (sitting) wpn.position.y = 0.25;
  } else if (weapon === 'mace' || weapon === 'axe') {
    // Flanged mace, or a bearded axe.
    add(new THREE.CylinderGeometry(0.014, 0.016, 0.46, 10), wood, wpn, 0, 0.16, 0);
    add(new THREE.CylinderGeometry(0.019, 0.019, 0.1, 10), darkLeather, wpn, 0, -0.02, 0);
    if (weapon === 'mace') {
      add(new THREE.SphereGeometry(0.04, 14, 10), steel, wpn, 0, 0.38, 0, 0, 0, 0, 1, 1.2, 1);
      for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.012, 0.1, 0.05), steel, wpn, Math.cos(i * 1.047) * 0.035, 0.38, Math.sin(i * 1.047) * 0.035, 0, -i * 1.047, 0);
    } else {
      const ax = new THREE.Shape();
      ax.moveTo(0, 0.05);
      ax.quadraticCurveTo(0.08, 0.07, 0.13, 0.12);
      ax.quadraticCurveTo(0.1, 0, 0.13, -0.1);
      ax.quadraticCurveTo(0.07, -0.04, 0, -0.03);
      add(new THREE.ExtrudeGeometry(ax, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), steel, wpn, 0.01, 0.34, -0.005);
    }
    attachOriented(wpn, arms.R.hand, sitting ? [-1.5, 0.3, 0] : [0.15, 0, -0.2]);
  } else if (weapon === 'spear') {
    add(new THREE.CylinderGeometry(0.013, 0.015, 1.5, 8), wood, wpn, 0, 0.3, 0);
    add(new THREE.ConeGeometry(0.03, 0.16, 4), steel, wpn, 0, 1.12, 0, 0, Math.PI / 4, 0, 1, 1, 0.35);
    attachOriented(wpn, arms.R.hand, sitting ? [-1.2, 0, 0.25] : [0.08, 0, -0.06]);
  } else if (weapon === 'bow') {
    add(new THREE.TorusGeometry(0.42, 0.011, 6, 28, Math.PI * 0.85), wood, wpn, -0.13, 0, 0, 0, 0, Math.PI * 0.575);
    add(new THREE.CylinderGeometry(0.002, 0.002, 0.82, 4), linen, wpn, 0.25, 0, 0);
    attachOriented(wpn, arms.R.hand, sitting ? [-1.4, 0, 1.4] : [0, 0.3, 0]);
  } else {
    // Sword: diamond-section blade, crossguard, wrapped grip, pommel.
    const bl = weapon === 'dagger' ? 0.3 : thiefOnly ? 0.42 : 0.66;
    const bs = new THREE.Shape();
    bs.moveTo(-0.022, 0);
    bs.lineTo(-0.019, bl * 0.82);
    bs.lineTo(0, bl);
    bs.lineTo(0.019, bl * 0.82);
    bs.lineTo(0.022, 0);
    bs.closePath();
    const bg = new THREE.ExtrudeGeometry(bs, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
    bg.translate(0, 0.05, -0.001);
    add(bg, steel, wpn);
    add(new THREE.BoxGeometry(0.004, bl * 0.7, 0.014), darkSteel, wpn, 0, 0.05 + bl * 0.36, 0); // fuller
    add(new THREE.BoxGeometry(0.15, 0.022, 0.028), gilt, wpn, 0, 0.045, 0);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.016, 8, 6), gilt, wpn, s * 0.077, 0.045, 0);
    add(new THREE.CylinderGeometry(0.015, 0.016, 0.12, 10), darkLeather, wpn, 0, -0.02, 0);
    add(new THREE.SphereGeometry(0.024, 12, 10), gilt, wpn, 0, -0.09, 0);
    attachOriented(wpn, arms.R.hand, sitting ? [-1.45, 0, 0.1] : poseName === 'guard' ? [0.05, 0, 0] : [-0.25, 0, -0.18]);
    wpn.position.y = -0.005;
    // Sheathed dagger on thieves.
    if (has('thief')) add(new THREE.CylinderGeometry(0.014, 0.008, 0.2, 8), darkLeather, pelvis, 0.13, beltY - 0.1, 0.06, 0.3, 0, 0.3);
  }
  // Spellbook at the hip for arcane casters.
  if (has('magicUser')) add(new THREE.BoxGeometry(0.1, 0.13, 0.04), M({ color: 0x5a1e1a, roughness: 1, ...tex(TX.leatherSet(), 1, 1) }), pelvis, 0.15, beltY - 0.05, 0.02, 0, -1.2, 0.1);
  // Shields: fighters and clerics by default, or whatever is readied.
  if (wantShield && !asleep) {
    const shG = new THREE.Group();
    const kind = roundShield ? 'cleric' : 'fighter';
    const faceTex = TX.shieldFaceTexture(clothHex, kind);
    const faceMat = M({ map: faceTex, roughness: 0.5, metalness: 0.1 });
    if (roundShield) {
      // Round shield.
      const d = add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 36), [darkLeather, faceMat, darkLeather], shG, 0, 0, 0, Math.PI / 2, 0, 0);
      d.geometry.rotateY(-Math.PI / 2);
      add(new THREE.TorusGeometry(0.2, 0.014, 8, 40), gilt, shG, 0, 0, 0.012);
      add(new THREE.SphereGeometry(0.035, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), gilt, shG, 0, 0, 0.012, Math.PI / 2);
    } else {
      // Heater shield, slightly curved, painted face + gilt rim.
      const s = new THREE.Shape();
      s.moveTo(-0.17, 0.2);
      s.lineTo(0.17, 0.2);
      s.bezierCurveTo(0.17, -0.02, 0.12, -0.16, 0, -0.26);
      s.bezierCurveTo(-0.12, -0.16, -0.17, -0.02, -0.17, 0.2);
      const eg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 2, curveSegments: 16 });
      // Planar UVs across the face from x,y.
      const pa = eg.attributes.position;
      const uv = eg.attributes.uv;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        const y = pa.getY(i);
        uv.setXY(i, (x + 0.19) / 0.38, (y + 0.28) / 0.5);
        pa.setZ(i, pa.getZ(i) - x * x * 1.1); // curve
      }
      eg.computeVertexNormals();
      add(eg, [faceMat, darkLeather], shG, 0, 0, -0.01);
      const rimPts = [];
      const sp = s.getSpacedPoints(60);
      for (const pt of sp) rimPts.push(new THREE.Vector3(pt.x * 1.04, pt.y * 1.03, 0.022 - pt.x * pt.x * 1.1));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 80, 0.01, 6, true), gilt, shG);
    }
    attachOriented(shG, arms.L.el, sitting ? [0.3, -0.9, 0.2] : poseName === 'guard' ? [0, 0.5, 0] : [0.05, 0.25, 0]);
    shG.position.set(0.05, -0.16, 0.05);
    if (sitting) {
      // Resting on the ground beside the sitter instead.
      arms.L.el.remove(shG);
      shG.scale.setScalar(1);
      shG.position.set(0.38, 0.2, 0.05);
      shG.rotation.set(-0.35, 1.2, 0);
      fig.add(shG);
    }
  }
  // Thieves: a short bow slung on the back; clerics: holy symbol pendant.
  if (has('thief') && !sitting && !asleep) {
    const bow = add(new THREE.TorusGeometry(0.34, 0.01, 6, 24, Math.PI * 0.9), wood, spine, 0.02, 0.28, -0.16, 0, 0, Math.PI * 0.55 + 0.4);
    void bow;
  }
  if (has('cleric')) add(new THREE.TorusGeometry(0.025, 0.007, 6, 16), gilt, spine, 0, 0.4, 0.14);

  // Sleep: lie the (standing) figure on its side on the ground.
  if (poseName === 'sleep') {
    fig.rotation.set(0, 0, Math.PI / 2);
    fig.position.set(0.95 * fs, figY + 0.12 * fs * build.w, 0);
  }

  // ---------------------------------------------------------------- optional merge
  const cloakMeshes = meshes.filter((m) => m.userData.cloak);
  if (opt.merge) {
    root.updateMatrixWorld(true);
    const byMat = new Map();
    const skip = new Set([...cloakMeshes]);
    for (const m of meshes) {
      if (skip.has(m) || Array.isArray(m.material) || !m.visible) continue;
      let isHead = false;
      for (let o = m.parent; o; o = o.parent) if (o === headJ) isHead = true;
      if (isHead) continue;
      const k = m.material;
      if (!byMat.has(k)) byMat.set(k, []);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      byMat.get(k).push(g);
      m.removeFromParent();
    }
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.applyMatrix4(inv);
      const mm = new THREE.Mesh(G(merged), mat);
      mm.castShadow = true;
      mm.receiveShadow = true;
      root.add(mm);
    }
  }

  // ---------------------------------------------------------------- idle life
  const seedPh = (look.seed % 1000) / 159;
  const base = {
    spine: spine.rotation.clone(), head: headJ.rotation.clone(), shR: arms.R.sh.rotation.clone(), shL: arms.L.sh.rotation.clone(),
  };
  root.userData.update = (t) => {
    const b = Math.sin(t * 1.7 + seedPh);
    if (!opt.merge) {
      spine.rotation.x = base.spine.x + b * 0.012;
      spine.scale.set(1 + b * 0.008, 1, 1 + b * 0.012);
      arms.R.sh.rotation.x = base.shR.x + b * 0.015;
      arms.L.sh.rotation.x = base.shL.x - b * 0.012;
    }
    headJ.rotation.y = base.head.y + Math.sin(t * 0.43 + seedPh) * (sitting ? 0.18 : 0.1);
    headJ.rotation.x = base.head.x + Math.sin(t * 0.61 + seedPh * 2) * 0.04;
    for (const c of cloakMeshes) c.rotation.x = -0.03 - 0.03 * Math.sin(t * 1.1 + seedPh) - 0.02 * Math.sin(t * 2.3);
    const cr = wpn.userData.crystal;
    if (cr) cr.material.emissiveIntensity = 2.2 + 0.5 * Math.sin(t * 3.1 + seedPh);
  };
  root.userData.update(0);
  root.userData.height = (pose.pelvis + 0.8) * fs + figY;
  root.userData.dispose = () => {
    for (const g of geos) g.dispose();
    for (const m of new Set(mats)) m.dispose();
    for (const t of texs) t.dispose();
  };
  void hexNum;
  return root;
}

/**
 * A soft studio environment for miniature reflections: warm key from the
 * front-left, cool rim from behind, dark floor — no hard light boxes, so
 * curved steel reads as polished rather than glittering.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{warm?: number, cool?: number}} [o]
 * @returns {THREE.Texture} dispose() when done
 */
export function miniatureEnvironment(renderer, o = {}) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const p = geo.attributes.position;
  const warm = new THREE.Color(o.warm ?? 0xffb070);
  const cool = new THREE.Color(o.cool ?? 0x6a86c8);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 10;
    const y = p.getY(i) / 10;
    const z = p.getZ(i) / 10;
    const key = Math.max(0, x * -0.5 + y * 0.5 + z * 0.7);
    const rim = Math.max(0, -z * 0.8 + y * 0.3);
    c.setRGB(0.03, 0.03, 0.04);
    c.lerp(new THREE.Color(0.18, 0.16, 0.14), Math.max(0, y) * 0.6);
    c.add(warm.clone().multiplyScalar(key ** 3 * 1.4));
    c.add(cool.clone().multiplyScalar(rim ** 2 * 0.8));
    if (y < -0.1) c.multiplyScalar(0.4);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  geo.dispose();
  mat.dispose();
  return tex;
}

// ------------------------------------------------------------------ snapshots

let snap = null;
const snapCache = new Map();

/**
 * Render a character's miniature (dressed in its readied gear) to an image
 * URL, for 2D UI such as the ITEMS paperdoll. Uses one small private WebGL
 * context, cached per look + gear. Returns null if WebGL is unavailable.
 * @param {object} ch
 * @param {{w?: number, h?: number}} [o]
 * @returns {string|null}
 */
export function miniatureSnapshot(ch, o = {}) {
  const w = o.w ?? 300;
  const h = o.h ?? 520;
  const key = JSON.stringify([ch.race, ch.gender, ch.classSpec, defaultLook(ch), miniatureGear(ch), w, h]);
  if (snapCache.has(key)) return snapCache.get(key);
  try {
    if (!snap) {
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      scene.environment = miniatureEnvironment(renderer);
      scene.environmentIntensity = 0.9;
      scene.add(new THREE.HemisphereLight(0x5a6aa0, 0x100c08, 0.5));
      const key2 = new THREE.SpotLight(0xfff0dc, 42, 12, 0.5, 0.6, 1.5);
      key2.position.set(1.6, 3.6, 2.8);
      key2.target.position.set(0, 0.9, 0);
      key2.castShadow = true;
      key2.shadow.mapSize.set(1024, 1024);
      key2.shadow.bias = -0.0015;
      scene.add(key2, key2.target);
      const rim = new THREE.DirectionalLight(0x7f9fff, 1.6);
      rim.position.set(-2.5, 2.5, -3);
      scene.add(rim);
      const warm = new THREE.PointLight(0xffa050, 1.4, 6, 1.6);
      warm.position.set(-1.6, 0.8, 1.4);
      scene.add(warm);
      const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
      snap = { renderer, scene, camera };
    }
    const { renderer, scene, camera } = snap;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 1.2, 4.1);
    camera.lookAt(0, 0.97, 0);
    camera.updateProjectionMatrix();
    const m = buildMiniature(ch, { pose: 'stand', base: true });
    m.rotation.y = -0.32;
    scene.add(m);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(m);
    m.userData.dispose();
    if (snapCache.size > 24) snapCache.delete(snapCache.keys().next().value);
    snapCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
