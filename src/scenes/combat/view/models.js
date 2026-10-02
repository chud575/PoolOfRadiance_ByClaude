import * as THREE from 'three';
import { RigBuilder, limb, lathe, sphere, box, cyl, cone, torus, rbox, blade } from './rig.js';
import { pbr, heraldry } from './textures.js';
import { ITEMS } from '../../../data/items.js';
import { splitClasses } from '../../../rules/classes.js';
import { sculptedFlesh, sculptMaterial, LOOKS } from './sculpted.js';

/**
 * Procedural 3D figures for tactical combat: the six party archetypes (kit read
 * from the character's equipped items) and the Phlan bestiary. Every figure is a
 * rigid-skinned skeleton (see rig.js) so animations are true bone animations.
 *
 * makeFigureModel(combatant) → {root, bones, rig:'biped'|'quad'|'spider', height, radius, meshes, parts}
 */

const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

// Party colours echo the 1988 icon colours (blue, red, green, magenta, yellow, cyan), deepened.
const PARTY_COLORS = [0x2c4f9e, 0x9a2a24, 0x2f6b3a, 0x6d3a7e, 0xb08a2a, 0x2a7a82];
const SKIN = { human: 0xd29a7c, elf: 0xe6bea0, halfElf: 0xdcae8e, dwarf: 0xc48a68, halfling: 0xd8a282, gnome: 0xcf9a78, halfOrc: 0x9aa070 };
const HAIR = [0x2a1a10, 0x5a3418, 0x8a5a2a, 0xb88a4a, 0xd8c08a, 0x7a2a14, 0x1a1a1a, 0x9a9a9a];

// ------------------------------------------------------------------ species
const SPECIES = {
  human: { height: 1.0, bulk: 1.0, head: 'human' },
  kobold: { height: 0.74, bulk: 0.86, limbK: 1.08, head: 'kobold', headScale: 1.62, skin: ['reptile', 0xb0602a], shieldChance: 0.45, tail: 'long', legs: 'digitigrade', hunch: 0.5, thickNeck: true, cloth: 0x4a3a28, armor: 'harness', weapon: 'spear', weapons: ['spear', 'club', 'sling', 'spear', 'shortSword', 'club', 'sling'], helms: [null, 'kCap', 'kSkull', 'kBand'], stature: 0.26, shields: ['round', 'hide'], eyes: 0xffc040 },
  goblin: { height: 0.66, bulk: 0.95, limbK: 1.2, head: 'goblin', skin: ['skin', 0x8a9a3a], hunch: 0.15, cloth: 0x4a3020, weapon: 'shortSword', eyes: 0xffe060 },
  orc: { height: 1.04, bulk: 1.28, head: 'orc', skin: ['skin', 0x74864c], hunch: 0.42, cloth: 0x2e2418, armor: 'orcish', weapon: 'battleAxe', weapons: ['battleAxe', 'battleAxe', 'spear', 'morningStar', 'club'], helmChance: 0.55, eyes: 0xff4020 },
  hobgoblin: { height: 1.08, bulk: 1.12, head: 'hobgoblin', skin: ['skin', 0x9a4a22], cloth: 0x2a2a22, armor: 'scale', weapon: 'glaive', weapons: ['glaive', 'glaive', 'glaive', 'longSword'], shield: null, shieldWith: { longSword: 'round' }, helms: ['hobHelm'], eyes: 0xffa020 },
  gnoll: { height: 1.2, bulk: 1.15, limbK: 1.1, head: 'gnoll', skin: ['fur', 0x9a7a4a], hunch: 0.3, legs: 'digitigrade', cloth: 0x3a2e22, armor: 'scraps', weapon: 'flail', eyes: 0xffd040 },
  giantRat: { rig: 'quad', skin: ['fur', 0x4a3a30], height: 0.55, eyes: 0xff3020 },
  skeleton: { undead: true, height: 1.0, bulk: 0.95, headScale: 1.22, head: 'skull', body: 'bones', skin: ['bone', 0xeadbb4], weapon: 'shortSword', shield: 'round', eyes: 0x60d0ff },
  zombie: { undead: true, height: 1.0, bulk: 1.0, head: 'zombie', skin: ['skin', 0x7a8a6a], cloth: 0x3a3a30, tattered: true, hunch: 0.25, weapon: null, eyes: 0xc0ff60, armsForward: true },
  ghoul: { undead: true, height: 0.98, bulk: 0.9, head: 'zombie', skin: ['skin', 0x9a9a8a], cloth: 0x2a2a28, tattered: true, hunch: 0.35, weapon: null, eyes: 0xff4040 },
  bugbear: { height: 1.3, bulk: 1.3, head: 'gnoll', skin: ['fur', 0x7a5a30], hunch: 0.2, cloth: 0x3a2a1a, armor: 'scraps', weapon: 'morningStar', eyes: 0xffc040 },
  lizardMan: { height: 1.08, bulk: 1.05, head: 'kobold', skin: ['scales', 0x4a6a3a], tail: true, cloth: 0x4a3a20, weapon: 'spear', shield: 'round', eyes: 0xffe040 },
  ogre: { height: 1.55, bulk: 1.55, head: 'ogre', skin: ['skin', 0xa08a5a], belly: true, cloth: 0x4a3a28, weapon: 'club', eyes: 0xffa060 },
  troll: { height: 1.55, bulk: 1.05, head: 'troll', skin: ['skin', 0x4a6a3a], hunch: 0.4, armLen: 1.35, weapon: null, claws: true, eyes: 0xffe020 },
  buccaneer: { height: 1.0, bulk: 1.0, head: 'human', human: { hair: 0x2a1a10, bandana: 0x8a1a1a, beard: 'stubble' }, cloth: 0xc8b8a0, stripes: true, armor: 'vest', weapon: 'longSword', skinTone: 0xb07a5a },
  thug: { height: 1.0, bulk: 1.05, head: 'human', human: { hood: 0x3a3228, beard: 'stubble' }, cloth: 0x4a3a2a, armor: 'vest', weapon: 'club', skinTone: 0xc08a6a },
  giantSpider: { rig: 'spider', skin: ['fur', 0x2a2420], height: 0.7, eyes: 0xff2020 },
};

// ------------------------------------------------------------------ kit
function partyKit(ch, index) {
  const eq = ch.inventory.filter((e) => e.equipped).map((e) => ITEMS[e.id]).filter(Boolean);
  const weaponDef = eq.find((d) => d.type === 'weapon');
  const armorDef = eq.find((d) => d.type === 'armor');
  const classes = splitClasses(ch.classSpec);
  const hasBow = ch.inventory.some((e) => ITEMS[e.id]?.icon === 'bow');
  const weaponMap = { sword: weaponDef?.id === 'shortSword' ? 'shortSword' : weaponDef?.id === 'twoHandedSword' ? 'greatSword' : 'longSword', axe: weaponDef?.id === 'handAxe' ? 'handAxe' : 'battleAxe', mace: weaponDef?.id === 'club' ? 'club' : weaponDef?.id === 'flail' || weaponDef?.id === 'morningStar' ? 'morningStar' : 'mace', staff: 'staff', spear: 'spear', bow: 'bow', dagger: 'dagger', sling: 'dagger' };
  const weapon = weaponDef ? weaponMap[weaponDef.icon] ?? 'longSword' : classes.includes('magicUser') ? 'staff' : 'fists';
  const armor = armorDef ? ({ plate: 'plate', banded: 'plate', splint: 'plate', chain: 'chain', ring: 'chain', scale: 'scale', studded: 'leather', leather: 'leather', padded: 'leather' }[armorDef.armorGroup] ?? 'leather') : classes.includes('magicUser') && !classes.includes('fighter') ? 'robe' : 'tunic';
  const r = hashStr(ch.id + ch.name);
  return {
    color: PARTY_COLORS[index % PARTY_COLORS.length],
    weapon,
    ranged: hasBow ? 'bow' : null,
    armor,
    shield: eq.some((d) => d.type === 'shield') ? (classes.includes('cleric') ? 'heater' : ch.race === 'dwarf' ? 'round' : 'kite') : null,
    helm: eq.some((d) => d.type === 'helm') || ch.race === 'dwarf' ? (ch.race === 'dwarf' ? 'horned' : 'nasal') : null,
    cleric: classes.includes('cleric'),
    mage: classes.includes('magicUser'),
    thief: classes.includes('thief'),
    female: ch.gender === 'female',
    race: ch.race,
    hair: HAIR[Math.floor(r * HAIR.length)],
    cape: classes.includes('fighter') && !classes.includes('thief') && ch.race !== 'dwarf',
    device: classes.includes('cleric') ? 'scales' : ['chevron', 'star', 'cross', 'hammer'][Math.floor(r * 4)],
    magic: eq.some((d) => d.magic),
  };
}

const RACE_BODY = {
  human: { height: 1.0, bulk: 1.0 },
  elf: { height: 0.97, bulk: 0.88 },
  halfElf: { height: 0.98, bulk: 0.94 },
  dwarf: { height: 0.74, bulk: 1.32, legRatio: 0.8 },
  halfling: { height: 0.6, bulk: 0.95, legRatio: 0.92, headScale: 1.15 },
  gnome: { height: 0.62, bulk: 0.95, headScale: 1.15 },
};

/** Build the model for a combatant. */
export function makeFigureModel(c, index = 0) {
  if (c.side === 'party') {
    const ch = c.ref;
    const kit = partyKit(ch, index);
    const body = RACE_BODY[ch.race] ?? RACE_BODY.human;
    return buildBiped({
      height: body.height * (kit.female ? 0.95 : 1),
      bulk: body.bulk * (kit.female ? 0.9 : 1),
      legRatio: body.legRatio ?? 1,
      headScale: body.headScale ?? 1,
      head: 'human',
      skin: ['skin', SKIN[ch.race] ?? SKIN.human],
      kit,
      eyes: null,
      seed: hashStr(ch.id),
    });
  }
  const sp = SPECIES[c.monsterId] ?? SPECIES.orc;
  const seed = hashStr(c.id);
  if (sp.rig === 'quad') return buildRat(sp, seed);
  if (sp.rig === 'spider') return buildSpider(sp, seed);
  // Per-individual variation: gear, helm, stature.
  const pick = (arr, k) => arr[Math.floor(hashStr(`${c.id}:${k}`) * arr.length)];
  // Individuals are numbered from 1: the n-th of a species cycles the weapon list
  // so a warband always shows a mix (spears, clubs, slings) rather than clones.
  const nth = Math.max(0, (parseInt(/(\d+)$/.exec(c.name ?? '')?.[1] ?? '1', 10) || 1) - 1);
  const weapon = sp.weapons ? sp.weapons[(nth + Math.floor(hashStr(`${c.monsterId}:w0`) * sp.weapons.length)) % sp.weapons.length] : sp.weapon === undefined ? 'club' : sp.weapon;
  const shield = sp.shieldWith ? sp.shieldWith[weapon] ?? null
    : weapon === 'sling' ? null
    : sp.shield !== undefined && sp.shield !== null ? sp.shield
    : sp.shieldChance && hashStr(`${c.id}:s`) < sp.shieldChance ? (sp.shields ? pick(sp.shields, 'st') : 'round') : null;
  const kit = {
    color: sp.cloth ?? 0x3a3024,
    weapon,
    variant: hashStr(`${c.id}:v`),
    armor: sp.armor ?? (sp.body === 'bones' ? 'none' : 'loincloth'),
    shield,
    helm: sp.helms ? sp.helms[(nth * 3 + 1) % sp.helms.length] : sp.helmChance && hashStr(`${c.id}:h`) < sp.helmChance ? 'orcHelm' : null,
    human: sp.human,
    stripes: sp.stripes,
    tattered: sp.tattered,
    race: 'monster',
    hair: 0x1a120a,
  };
  // Sculpted species mesh once at their canonical build; individuals vary by scale.
  const sculpt = LOOKS[c.monsterId] && !sp.human ? c.monsterId : null;
  const indiv = sp.stature ? 1 - sp.stature / 2 + hashStr(`${c.id}:tall`) * sp.stature : 0.94 + seed * 0.12;
  const model = buildBiped({
    sculpt,
    height: sp.height * (sculpt ? 1 : indiv),
    bulk: sp.bulk * (sculpt ? 1 : 0.95 + hashStr(`${c.id}:b`) * 0.1),
    legRatio: sp.legRatio ?? 1,
    headScale: sp.headScale ?? 1,
    head: sp.head,
    body: sp.body,
    skin: sp.skinTone ? ['skin', sp.skinTone] : sp.skin,
    kit,
    hunch: sp.hunch ?? 0,
    tail: sp.tail,
    belly: sp.belly,
    armLen: sp.armLen ?? 1,
    claws: sp.claws,
    eyes: sp.eyes,
    undead: !!sp.undead,
    armsForward: sp.armsForward,
    digitigrade: sp.legs === 'digitigrade',
    thickNeck: sp.thickNeck,
    limbK: sp.limbK,
    seed,
  });
  if (sculpt) {
    // Individuals differ in stature and girth (a heavier brute, a wiry runt).
    const girth = 0.93 + hashStr(`${c.id}:b`) * 0.16;
    model.root.scale.set(indiv * girth, indiv, indiv * girth);
    model.height *= indiv;
    model.radius *= indiv;
    model.scale *= indiv;
    if (model.eyeAt) model.eyeAt = model.eyeAt.map((v) => v * indiv);
  }
  return model;
}

// ------------------------------------------------------------------ biped
function buildBiped(o) {
  o = { armLen: 1, hunch: 0, legRatio: 1, headScale: 1, ...o };
  const R = new RigBuilder();
  const u = 1.8 * o.height;
  const w = o.bulk;
  const s = u / 1.8; // uniform scale relative to a 1.8m human
  const legR = o.legRatio;
  const thighL = 0.44 * s * legR;
  const shinL = 0.43 * s * legR;
  const hipY = thighL + shinL + 0.07 * s;
  const kit = o.kit;
  const skinMat = pbr(o.skin[0], o.skin[1]);
  const clothMat = pbr('cloth', kit.color);
  const darkCloth = pbr('cloth', new THREE.Color(kit.color).multiplyScalar(0.45).getHex());
  const leather = pbr('leather', 0x6a4428);
  const darkLeather = pbr('leather', 0x3a2618);
  const metal = pbr('metal', 0xb8bcc4);
  const darkMetal = pbr('metal', 0x5a5c62);
  const gold = pbr('gold', 0xd8b25a);
  const rust = pbr('metal', 0x5e4434);
  const wood = pbr('wood', 0x7a5230);
  const bones = o.body === 'bones';
  const boneMat = bones ? skinMat : null;

  // Skeleton ----------------------------------------------------------
  R.bone('hips', null, 0, hipY, 0);
  R.bone('spine', 'hips', 0, 0.12 * s, 0);
  R.bone('chest', 'spine', 0, 0.2 * s, 0);
  R.bone('neck', 'chest', 0, 0.22 * s, 0.01 * s);
  R.bone('head', 'neck', 0, 0.075 * s, 0.01 * s);
  const shX = 0.2 * s * w;
  const armU = 0.29 * s * o.armLen;
  const armF = 0.26 * s * o.armLen;
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    R.bone(`upperArm${side}`, 'chest', sx * shX, 0.17 * s, 0);
    R.bone(`foreArm${side}`, `upperArm${side}`, 0, -armU, 0);
    R.bone(`hand${side}`, `foreArm${side}`, 0, -armF, 0);
    R.bone(`thigh${side}`, 'hips', sx * 0.1 * s * w, -0.03 * s, 0);
    R.bone(`shin${side}`, `thigh${side}`, 0, -thighL, 0);
    R.bone(`foot${side}`, `shin${side}`, 0, -shinL, 0);
  }
  if (o.tail) {
    const tl = o.tail === 'long' ? 1.3 : 1;
    R.bone('tail1', 'hips', 0, -0.02 * s, -0.12 * s);
    R.bone('tail2', 'tail1', 0, 0, -0.22 * s * tl);
    R.bone('tail3', 'tail2', 0, 0, -0.2 * s * tl);
  }
  if (kit.cape) {
    R.bone('capeA', 'chest', 0, 0.2 * s, -0.12 * s * w);
    R.bone('capeB', 'capeA', 0, -0.38 * s, 0);
    R.bone('capeC', 'capeB', 0, -0.36 * s, 0);
  }

  // Sculpted flesh: one smooth, auto-skinned body mesh (see sculpted.js).
  const sculpt = o.sculpt;
  let sculptEyes = null;
  if (sculpt) {
    // Bind pose with the arms (and a touch of the legs) held away from the
    // body so limbs and torso sculpt as separate volumes; reset after build().
    R.bones.upperArmL.rotation.z = 0.3;
    R.bones.upperArmR.rotation.z = -0.3;
    R.bones.thighL.rotation.z = 0.05;
    R.bones.thighR.rotation.z = -0.05;
    R.root.updateMatrixWorld(true);
    const J = {};
    const v = new THREE.Vector3();
    for (const b of R.boneList) J[b.name] = b.getWorldPosition(v).toArray();
    const key = [sculpt, o.height, o.bulk, kit.armor, kit.tattered ? 1 : 0, o.tail ?? '', kit.cape ? 1 : 0].join('|');
    const flesh = sculptedFlesh(key, {
      species: sculpt, J, s, w, hs: s * (o.headScale ?? 1), bw: Math.sqrt(w) * (o.limbK ?? 1), legW: (w > 1.15 ? w * 1.05 : Math.sqrt(w)) * (o.limbK ?? 1),
      belly: o.belly, tail: o.tail, digitigrade: o.digitigrade, thickNeck: o.thickNeck, claws: o.claws, kit,
    });
    R.skin(flesh.geometry, sculptMaterial(), flesh.names);
    sculptEyes = flesh;
    o.sculptEyesOut = flesh;
  }

  // Body --------------------------------------------------------------
  const torsoMat = bones ? boneMat : kit.armor === 'robe' ? clothMat : kit.armor === 'loincloth' || kit.armor === 'none' || kit.armor === 'scraps' || kit.armor === 'orcish' || kit.armor === 'harness' ? skinMat : clothMat;
  if (bones && !sculpt) {
    // Spine column, ribcage hoops, pelvis.
    for (let i = 0; i < 5; i++) R.part('spine', sphere(0.028 * s, 8, 6), boneMat, { p: [0, i * 0.045 * s, -0.04 * s] });
    for (let i = 0; i < 5; i++) {
      const rr = (0.13 - Math.abs(i - 1.6) * 0.012) * s * w;
      R.part('chest', torus(rr, 0.012 * s, 6, 18, Math.PI * 1.55), boneMat, { p: [0, 0.02 * s + i * 0.042 * s, 0], r: [Math.PI / 2, 0, Math.PI * 0.5 + Math.PI * 0.225], s: [1, 0.72, 1] });
    }
    R.part('chest', box(0.03 * s, 0.2 * s, 0.02 * s), boneMat, { p: [0, 0.11 * s, 0.1 * s] });
    R.part('chest', cyl(0.025 * s, 0.025 * s, 0.34 * s * w, 8), boneMat, { p: [0, 0.2 * s, -0.02 * s], r: [0, 0, Math.PI / 2] });
    R.part('hips', lathe([[0.02, -0.08], [0.12, -0.04], [0.14, 0.02], [0.1, 0.06]].map(([r, y]) => [r * s * w, y * s]), 10, { zs: 0.55 }), boneMat);
    R.part('neck', cyl(0.022 * s, 0.022 * s, 0.09 * s, 8), boneMat, { p: [0, 0.04 * s, 0] });
  } else if (!sculpt) {
    const bellyK = o.belly ? 1.35 : 1;
    R.part('hips', lathe([[0.06, -0.1], [0.14, -0.07], [0.16, 0.0], [0.15, 0.09]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.72 }), kit.armor === 'robe' ? clothMat : kit.armor === 'loincloth' || kit.armor === 'none' ? darkCloth : darkCloth);
    R.part('spine', lathe([[0.15, -0.02], [0.15 * bellyK, 0.08], [0.155, 0.2], [0.15, 0.24]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.7 * (o.belly ? 1.25 : 1) }), torsoMat);
    R.part('chest', lathe([[0.15, -0.03], [0.175, 0.07], [0.19, 0.15], [0.17, 0.2], [0.1, 0.235], [0.05, 0.245]].map(([r, y]) => [r * s, y * s]), 16, { xs: w * 1.08, zs: 0.66 }), torsoMat);
    R.part('neck', cyl(0.05 * s, 0.056 * s, 0.1 * s, 10), skinMat, { p: [0, 0.03 * s, 0] });
    // Trapezius slope from neck to shoulders.
    R.part('chest', lathe([[0.17, 0.17], [0.13, 0.215], [0.07, 0.25], [0.05, 0.27]].map(([r, y]) => [r * s, y * s]), 14, { xs: w * 1.1, zs: 0.62 }), torsoMat);
  }

  // Arms & legs.
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    if (bones) {
      if (sculpt) continue;
      R.part(`upperArm${side}`, limb(0.02 * s, 0.017 * s, armU, { bulge: 0.9, seg: 6 }), boneMat);
      R.part(`upperArm${side}`, sphere(0.032 * s, 8, 6), boneMat);
      R.part(`foreArm${side}`, limb(0.016 * s, 0.013 * s, armF, { bulge: 0.9, seg: 6 }), boneMat);
      R.part(`hand${side}`, box(0.05 * s, 0.07 * s, 0.03 * s), boneMat, { p: [0, -0.04 * s, 0] });
      R.part(`thigh${side}`, limb(0.026 * s, 0.02 * s, thighL, { bulge: 0.9, seg: 6 }), boneMat);
      R.part(`shin${side}`, limb(0.02 * s, 0.016 * s, shinL, { bulge: 0.9, seg: 6 }), boneMat);
      R.part(`shin${side}`, sphere(0.03 * s, 8, 6), boneMat);
      R.part(`foot${side}`, box(0.06 * s, 0.03 * s, 0.16 * s), boneMat, { p: [0, -0.02 * s, 0.04 * s] });
      continue;
    }
    const armMat = kit.armor === 'chain' || kit.armor === 'plate' ? pbr('chain', 0x9a9ea6) : kit.armor === 'robe' || kit.armor === 'tunic' ? clothMat : skinMat;
    const bw = Math.sqrt(w);
    if (!sculpt) {
    // Deltoid: rounds the shoulder into the arm.
    R.part(`upperArm${side}`, sphere(0.066 * s * bw, 12, 10), armMat, { p: [sx * 0.008 * s, -0.012 * s, 0], s: [1, 1.1, 1] });
    R.part(`upperArm${side}`, limb(0.055 * s * bw, 0.045 * s * bw, armU), armMat);
    R.part(`foreArm${side}`, limb(0.046 * s * bw, 0.036 * s * bw, armF), kit.armor === 'robe' ? clothMat : o.claws || kit.armor === 'loincloth' || kit.armor === 'scraps' || kit.armor === 'orcish' || kit.armor === 'harness' || kit.armor === 'none' ? skinMat : kit.armor === 'chain' || kit.armor === 'plate' ? armMat : skinMat);
    // Hand: palm + thumb; claws for beasts.
    R.part(`hand${side}`, rbox(0.075 * s * bw, 0.095 * s, 0.05 * s, 0.018 * s), skinMat, { p: [0, -0.05 * s, 0.005 * s] });
    R.part(`hand${side}`, limb(0.014 * s, 0.012 * s, 0.045 * s, { seg: 6 }), skinMat, { p: [sx * -0.03 * s, -0.03 * s, 0.025 * s], r: [0.6, 0, sx * 0.4] });
    if (o.claws) for (let k = 0; k < 3; k++) R.part(`hand${side}`, cone(0.01 * s, 0.08 * s, 5), pbr('bone', 0x3a3024), { p: [(k - 1) * 0.022 * s, -0.12 * s, 0.01 * s], r: [Math.PI, 0, 0] });
    const legMat = kit.armor === 'robe' ? darkCloth : kit.armor === 'plate' ? pbr('chain', 0x9a9ea6) : kit.armor === 'orcish' ? pbr('cloth', 0x2a221a) : o.skin[0] === 'fur' || o.skin[0] === 'scales' || o.skin[0] === 'reptile' ? skinMat : kit.armor === 'loincloth' || kit.armor === 'none' ? skinMat : darkCloth;
    // Brutes (orcs, ogres) get heavy legs; everyone else the classic proportions.
    const lw = w > 1.15 ? w * 1.05 : bw;
    R.part(`thigh${side}`, limb(0.08 * s * lw, 0.058 * s * lw, thighL), legMat);
    R.part(`shin${side}`, limb(0.06 * s * lw, 0.045 * s * lw, shinL), o.digitigrade ? skinMat : kit.race === 'monster' ? legMat : darkLeather);
    // Boots / feet.
    if (o.digitigrade) {
      R.part(`foot${side}`, rbox(0.08 * s, 0.05 * s, 0.2 * s, 0.02 * s), skinMat, { p: [0, -0.03 * s, 0.06 * s] });
      for (let k = 0; k < 3; k++) R.part(`foot${side}`, cone(0.012 * s, 0.05 * s, 5), pbr('bone', 0x2a2018), { p: [(k - 1) * 0.025 * s, -0.04 * s, 0.17 * s], r: [Math.PI / 2, 0, 0] });
    } else {
      R.part(`foot${side}`, rbox(0.1 * s * bw, 0.08 * s, 0.24 * s, 0.03 * s), kit.race === 'monster' && kit.armor !== 'vest' ? skinMat : darkLeather, { p: [0, -0.035 * s, 0.05 * s] });
      if (kit.race !== 'monster' || kit.armor === 'vest') R.part(`shin${side}`, cyl(0.06 * s, 0.055 * s, 0.14 * s, 12), darkLeather, { p: [0, -shinL + 0.08 * s, 0] });
    }
    } // !sculpt
    if (kit.armor === 'plate') {
      R.part(`upperArm${side}`, sphere(0.1 * s, 14, 10, { thetaLength: Math.PI * 0.55 }), metal, { p: [sx * 0.02 * s, 0.02 * s, 0], s: [1.05, 0.95, 1.1] });
      R.part(`upperArm${side}`, sphere(0.085 * s, 14, 8, { thetaLength: Math.PI * 0.5 }), metal, { p: [sx * 0.03 * s, -0.05 * s, 0], s: [1, 0.8, 1.05] });
      R.part(`foreArm${side}`, cyl(0.056 * s, 0.046 * s, 0.17 * s, 12), metal, { p: [0, -armF + 0.1 * s, 0] });
      R.part(`shin${side}`, cyl(0.062 * s, 0.05 * s, 0.3 * s, 12), metal, { p: [0, -shinL * 0.5, 0.008 * s] });
      R.part(`thigh${side}`, sphere(0.06 * s, 12, 8), metal, { p: [0, -thighL, 0.02 * s] });
    }
    if (kit.armor === 'chain' || kit.armor === 'scale') {
      if (!sculpt) R.part(`upperArm${side}`, sphere(0.085 * s * bw, 12, 8, { thetaLength: Math.PI * 0.55 }), kit.armor === 'scale' ? pbr('scales', 0x8a8070) : leather, { p: [sx * 0.015 * s, 0.01 * s, 0], s: [1, 0.85, 1.05] });
      R.part(`foreArm${side}`, cyl(0.052 * s, 0.044 * s, 0.13 * s, 10), leather, { p: [0, -armF + 0.08 * s, 0] });
    }
    if (kit.armor === 'orcish') {
      // Crude, mismatched gear: a rusty pauldron on one or both shoulders, leather bracers, wrapped shins.
      const both = (kit.variant ?? 0) > 0.5;
      if (sculpt) {
        // (sculpted pauldrons)
      } else if (side === 'R' || both) {
        R.part(`upperArm${side}`, sphere(0.1 * s * bw, 10, 8, { thetaLength: Math.PI * 0.5 }), rust, { p: [sx * 0.02 * s, 0.025 * s, 0], s: [1.15, 0.85, 1.15], r: [0, 0, sx * -0.25] });
        R.part(`upperArm${side}`, sphere(0.09 * s * bw, 10, 6, { thetaLength: Math.PI * 0.45 }), rust, { p: [sx * 0.03 * s, -0.035 * s, 0], s: [1.1, 0.7, 1.1], r: [0, 0, sx * -0.35] });
        for (let k = 0; k < 3; k++) R.part(`upperArm${side}`, sphere(0.012 * s, 5, 4), darkMetal, { p: [sx * (0.03 + k * 0.03) * s, 0.09 * s - k * 0.02 * s, 0.05 * s] });
      } else {
        R.part(`upperArm${side}`, sphere(0.085 * s * bw, 10, 6, { thetaLength: Math.PI * 0.5 }), darkLeather, { p: [sx * 0.01 * s, 0.01 * s, 0], s: [1.1, 0.8, 1.1] });
      }
      R.part(`foreArm${side}`, cyl(0.054 * s * bw, 0.046 * s * bw, 0.14 * s, 9), darkLeather, { p: [0, -armF + 0.09 * s, 0] });
      for (let k = 0; k < 2; k++) R.part(`foreArm${side}`, torus(0.053 * s * bw, 0.006 * s, 4, 12), leather, { p: [0, -armF + (0.05 + k * 0.08) * s, 0], r: [Math.PI / 2, 0, 0] });
      R.part(`shin${side}`, cyl(0.06 * s, 0.05 * s, 0.24 * s, 9), darkLeather, { p: [0, -shinL * 0.55, 0] });
      for (let k = 0; k < 3; k++) R.part(`shin${side}`, torus(0.058 * s, 0.006 * s, 4, 12), leather, { p: [0, -shinL * 0.35 - k * 0.07 * s, 0], r: [Math.PI / 2 + 0.15, 0, 0] });
    }
    if (kit.armor === 'leather') {
      R.part(`upperArm${side}`, sphere(0.078 * s, 12, 8, { thetaLength: Math.PI * 0.5 }), leather, { p: [sx * 0.01 * s, 0, 0], s: [1, 0.8, 1] });
      R.part(`foreArm${side}`, cyl(0.05 * s, 0.043 * s, 0.14 * s, 10), leather, { p: [0, -armF + 0.08 * s, 0] });
    }
  }

  // Armour on the torso ------------------------------------------------
  const torsoShell = (mat, grow = 1.08, lowY = -0.1) => {
    R.part('spine', lathe([[0.155 * grow, lowY], [0.16 * grow, 0.08], [0.165 * grow, 0.22]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.72 }), mat);
    R.part('chest', lathe([[0.16 * grow, -0.03], [0.185 * grow, 0.07], [0.2 * grow, 0.15], [0.18 * grow, 0.2], [0.11 * grow, 0.235], [0.06, 0.25]].map(([r, y]) => [r * s, y * s]), 16, { xs: w * 1.08, zs: 0.68 }), mat);
  };
  if (!bones) {
    if (kit.armor === 'chain') {
      torsoShell(pbr('chain', 0x9aa0a8));
      // Hauberk skirt.
      R.part('hips', lathe([[0.25, -0.34], [0.2, -0.12], [0.17, 0.02]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.72 }), pbr('chain', 0x9aa0a8));
      // Surcoat / tabard with heraldry.
      const tab = new THREE.MeshStandardMaterial({ map: heraldry(kit.color, kit.device), roughness: 0.9 });
      R.part('chest', box(0.22 * s * w, 0.3 * s, 0.012 * s), tab, { p: [0, 0.08 * s, 0.135 * s] });
      R.part('hips', box(0.2 * s * w, 0.4 * s, 0.012 * s), clothMat, { p: [0, -0.15 * s, 0.15 * s], r: [0.08, 0, 0] });
      R.part('hips', box(0.2 * s * w, 0.36 * s, 0.012 * s), clothMat, { p: [0, -0.15 * s, -0.14 * s], r: [-0.08, 0, 0] });
    } else if (kit.armor === 'plate') {
      torsoShell(metal, 1.12);
      R.part('chest', box(0.012 * s, 0.26 * s, 0.03 * s), metal, { p: [0, 0.08 * s, 0.14 * s] });
      R.part('hips', lathe([[0.24, -0.26], [0.19, -0.08], [0.17, 0.02]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.74 }), darkMetal);
    } else if (kit.armor === 'scale') {
      if (!sculpt) torsoShell(pbr('scales', 0x8a8070), 1.1);
      R.part('hips', lathe([[0.24, -0.26], [0.19, -0.08], [0.17, 0.02]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.74 }), pbr('scales', 0x6a6050));
    } else if (kit.armor === 'leather') {
      torsoShell(leather, 1.06);
      for (let k = 0; k < 4; k++) R.part('chest', box(0.18 * s * w, 0.012 * s, 0.01 * s), darkLeather, { p: [0, 0.01 * s + k * 0.05 * s, 0.13 * s] });
      R.part('hips', lathe([[0.22, -0.2], [0.18, -0.06], [0.16, 0.02]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.72 }), clothMat);
    } else if (kit.armor === 'robe') {
      R.part('hips', lathe([[0.3, -0.92 * legR], [0.26, -0.6 * legR], [0.2, -0.25], [0.165, 0.02]].map(([r, y]) => [r * s, y * s]), 20, { xs: w, zs: 0.78 }), clothMat);
      R.part('hips', lathe([[0.305, -0.93 * legR], [0.3, -0.9 * legR], [0.265, -0.6 * legR]].map(([r, y]) => [r * s, y * s]), 20, { xs: w, zs: 0.78 }), gold);
      R.part('chest', lathe([[0.1, 0.18], [0.14, 0.2], [0.11, 0.25]].map(([r, y]) => [r * s, y * s]), 16, { zs: 0.8 }), darkCloth);
      // Wide sleeves.
      for (const side of ['L', 'R']) R.part(`foreArm${side}`, lathe([[0.085, -0.22], [0.06, -0.08], [0.05, 0]].map(([r, y]) => [r * s, y * s]), 12), clothMat);
    } else if (kit.armor === 'tunic') {
      R.part('hips', lathe([[0.22, -0.26], [0.18, -0.1], [0.16, 0.02]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.74 }), clothMat);
      torsoShell(clothMat, 1.03);
      R.part('chest', box(0.16 * s * w, 0.02 * s, 0.01 * s), gold, { p: [0, 0.2 * s, 0.12 * s] });
    } else if (kit.armor === 'vest') {
      torsoShell(kit.stripes ? pbr('cloth', 0xd8d0c0) : clothMat, 1.03);
      R.part('chest', lathe([[0.18, -0.02], [0.2, 0.12], [0.16, 0.22]].map(([r, y]) => [r * s, y * s]), 14, { xs: w * 1.1, zs: 0.7 }), darkLeather);
      R.part('hips', lathe([[0.2, -0.18], [0.17, -0.06], [0.16, 0.02]].map(([r, y]) => [r * s, y * s]), 16, { xs: w, zs: 0.74 }), darkCloth);
      if (kit.stripes) for (let k = 0; k < 4; k++) R.part('spine', torus(0.158 * s * w, 0.006 * s, 4, 20), pbr('cloth', 0x8a1a1a), { p: [0, k * 0.05 * s, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.72, 1] });
    } else if (kit.armor === 'orcish') {
      // Layered crude armour: a hide jerkin, a rusty breastplate (dented, strapped on),
      // cross straps, a skull-buckled belt and hanging leather tassets.
      if (!sculpt) torsoShell(darkLeather, 1.07, -0.12);
      const v = kit.variant ?? 0;
      if (v < 0.75 && !sculpt) {
        R.part('chest', lathe([[0.15, -0.02], [0.18, 0.06], [0.19, 0.14], [0.15, 0.2]].map(([r, y]) => [r * s, y * s]), 12, { xs: w * 1.1, zs: 0.74 }), rust, { p: [0, 0, 0.012 * s], s: [1, 1, 1], r: [0.04, 0, 0] });
        for (const sx of [1, -1]) for (const y of [0.02, 0.16]) R.part('chest', sphere(0.012 * s, 5, 4), darkMetal, { p: [sx * 0.11 * s * w, y * s, 0.13 * s] });
      }
      for (const sx of [1, -1]) R.part('chest', box(0.03 * s, 0.38 * s, 0.012 * s), leather, { p: [0, 0.08 * s, 0.145 * s], r: [0, 0, sx * 0.55] });
      R.part('chest', box(0.03 * s, 0.38 * s, 0.012 * s), leather, { p: [0, 0.08 * s, -0.135 * s], r: [0, 0, 0.55] });
      R.part('hips', torus(0.168 * s * w, 0.024 * s, 6, 22), darkLeather, { p: [0, 0.04 * s, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.76, 1] });
      R.part('hips', sphere(0.034 * s, 8, 6), pbr('bone', 0xd8ccb0), { p: [0, 0.04 * s, 0.135 * s], s: [1, 1.1, 0.7] });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        R.part('hips', box(0.075 * s, (0.2 + (k % 2) * 0.05) * s, 0.012 * s), k % 3 ? darkLeather : rust, { p: [Math.sin(a) * 0.17 * s * w, -0.1 * s, Math.cos(a) * 0.125 * s], r: [Math.cos(a) * 0.15, a, 0] });
      }
      if (!sculpt) R.part('hips', lathe([[0.2, -0.16], [0.17, -0.06], [0.16, 0.02]].map(([r, y]) => [r * s, y * s]), 12, { xs: w, zs: 0.74 }), pbr('cloth', 0x2a221a));
      // A trophy: bone fetish on a cord.
      if (v > 0.4) R.part('chest', cone(0.012 * s, 0.06 * s, 5), pbr('bone', 0xe0d4b8), { p: [0.04 * s, 0.1 * s, 0.16 * s], r: [Math.PI, 0, 0.3] });
    } else if (kit.armor === 'harness') {
      // Kobold: a scrap of loincloth and a leather harness with a pouch.
      R.part('hips', box(0.12 * s * w, 0.22 * s, 0.012 * s), darkCloth, { p: [0, -0.13 * s, 0.13 * s], r: [0.1, 0, 0] });
      R.part('hips', torus(0.152 * s * w, 0.016 * s, 5, 16), darkLeather, { p: [0, 0.02 * s, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.74, 1] });
      R.part('chest', box(0.026 * s, 0.34 * s, 0.01 * s), darkLeather, { p: [0, 0.08 * s, 0.13 * s], r: [0, 0, 0.6] });
      R.part('hips', rbox(0.06 * s, 0.07 * s, 0.04 * s, 0.012 * s), leather, { p: [0.12 * s * w, -0.03 * s, 0.07 * s], r: [0, 0.6, 0] });
      // Pale belly scales, a darker banded back and a ridge of dorsal spines from
      // the skull down into the tail: the reptile silhouette reads at any zoom.
      if (!sculpt) R.part('spine', lathe([[0.1, -0.02], [0.125, 0.1], [0.11, 0.22]].map(([r, y]) => [r * s, y * s]), 10, { xs: w * 0.8, zs: 0.55 }), pbr('reptile', 0xc89a62), { p: [0, 0, 0.05 * s] });
      const back = pbr('reptile', 0x5a2a14);
      if (!sculpt) for (let k = 0; k < 4; k++) R.part('chest', cone(0.03 * s, 0.11 * s, 4), back, { p: [0, 0.24 * s - k * 0.06 * s, -0.12 * s * w], r: [-0.95, 0, 0], s: [0.6, 1, 1] });
      if (!sculpt) for (let k = 0; k < 3; k++) R.part('spine', cone(0.026 * s, 0.09 * s, 4), back, { p: [0, 0.2 * s - k * 0.07 * s, -0.115 * s * w], r: [-1.05, 0, 0], s: [0.6, 1, 1] });
    } else if (kit.armor === 'scraps') {
      R.part('chest', box(0.2 * s * w, 0.14 * s, 0.05 * s), darkLeather, { p: [0.03 * s, 0.12 * s, 0.1 * s], r: [0, 0, 0.3] });
      R.part('upperArmR', sphere(0.08 * s * w, 10, 6, { thetaLength: Math.PI * 0.5 }), darkMetal, { p: [0, 0.01 * s, 0], s: [1.1, 0.9, 1.1] });
      R.part('hips', lathe([[0.22, -0.24], [0.18, -0.08], [0.16, 0.02]].map(([r, y]) => [r * s, y * s]), 12, { xs: w, zs: 0.74 }), darkCloth);
      R.part('chest', torus(0.14 * s * w, 0.015 * s, 5, 16), darkLeather, { p: [0, 0.1 * s, 0], r: [Math.PI / 2, 0.5, 0], s: [1, 0.7, 1] });
    } else if (kit.armor === 'loincloth') {
      R.part('hips', box(0.14 * s * w, 0.28 * s, 0.01 * s), darkCloth, { p: [0, -0.16 * s, 0.13 * s] });
      R.part('hips', torus(0.155 * s * w, 0.018 * s, 5, 16), darkLeather, { p: [0, 0.02 * s, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.74, 1] });
    }
    if (kit.tattered) {
      if (!sculpt) R.part('chest', torsoShellGeo(s, w, 1.04), pbr('cloth', 0x4a4438));
      for (let k = 0; k < 5; k++) R.part('hips', box(0.06 * s, (0.2 + (k % 3) * 0.08) * s, 0.01 * s), pbr('cloth', 0x3a3428), { p: [(k - 2) * 0.06 * s, -0.12 * s, 0.13 * s], r: [0.1, 0, (k - 2) * 0.08] });
    }
    if (o.belly && !sculpt) R.part('spine', sphere(0.2 * s, 16, 12), skinMat, { p: [0, 0.08 * s, 0.07 * s], s: [w * 0.95, 0.9, 1] });
    // Belt with buckle + pouch.
    if (kit.race !== 'monster' || kit.armor === 'vest') {
      R.part('hips', torus(0.165 * s * w, 0.02 * s, 6, 24), darkLeather, { p: [0, 0.04 * s, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.76, 1] });
      R.part('hips', rbox(0.05 * s, 0.045 * s, 0.02 * s, 0.006 * s), gold, { p: [0, 0.04 * s, 0.13 * s] });
      R.part('hips', rbox(0.07 * s, 0.08 * s, 0.05 * s, 0.015 * s), leather, { p: [0.14 * s * w, -0.02 * s, 0.06 * s], r: [0, 0.6, 0] });
    }
  }

  // Head -----------------------------------------------------------------
  if (!sculpt) buildHead(R, o, s, skinMat);
  else {
    // Eyes (glowing for monsters) set into the sculpted sockets; helmets as kit.
    const hs = s * (o.headScale ?? 1);
    // Undead eyes burn; the living get a beady, wet glint that only glows by night (sprite).
    const eyeMat = o.eyes != null ? (o.undead ? pbr('glow', 0x000000, { emissive: o.eyes, emissiveIntensity: 2.4 }) : pbr('glow', 0x140604, { emissive: o.eyes, emissiveIntensity: 1.2 })) : pbr('eye', 0x1a120c);
    for (const e of sculptEyes.eyes ?? []) R.part('head', sphere(sculptEyes.eyeR * hs, 8, 6), eyeMat, { p: [e[0] * hs, e[1] * hs, e[2] * hs] });
    if (o.head === 'orc') {
      // Yellowed tusks jutting up from the underbite (two-part, slightly hooked).
      const tusk = pbr('bone', 0x9a8a68);
      for (const sx of [1, -1]) {
        R.part('head', cone(0.0115 * hs, 0.05 * hs, 7), tusk, { p: [sx * 0.046 * hs, 0.066 * hs, 0.108 * hs], r: [0.25, 0, sx * -0.24] });
        R.part('head', cone(0.0065 * hs, 0.026 * hs, 6), tusk, { p: [sx * 0.054 * hs, 0.1 * hs, 0.112 * hs], r: [-0.15, 0, sx * -0.5] });
      }
    }
    if (kit.helm === 'hobHelm') {
      // Hobgoblin legion helm: a dark-iron conical spangenhelm with brass bands,
      // a nasal, hinged cheek guards and a short red horsehair crest.
      const iron = pbr('metal', 0x3e3a36);
      const brass = pbr('gold', 0x9a7a3a);
      R.part('head', lathe([[0.104, 0], [0.1, 0.05], [0.08, 0.1], [0.045, 0.14], [0.008, 0.16]].map(([r, y]) => [r * hs, y * hs]), 14, { zs: 1.08 }), iron, { p: [0, 0.1 * hs, -0.018 * hs] });
      R.part('head', torus(0.104 * hs, 0.01 * hs, 5, 22), brass, { p: [0, 0.104 * hs, -0.018 * hs], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] });
      for (let k = 0; k < 4; k++) R.part('head', box(0.012 * hs, 0.15 * hs, 0.01 * hs), brass, { p: [Math.sin(k * Math.PI / 2) * 0.07 * hs, 0.17 * hs, -0.018 * hs + Math.cos(k * Math.PI / 2) * 0.075 * hs], r: [Math.cos(k * Math.PI / 2) * -0.55, 0, Math.sin(k * Math.PI / 2) * 0.55] });
      R.part('head', box(0.018 * hs, 0.07 * hs, 0.012 * hs), iron, { p: [0, 0.085 * hs, 0.1 * hs], r: [0.1, 0, 0] });
      for (const sx of [1, -1]) R.part('head', rbox(0.012 * hs, 0.08 * hs, 0.06 * hs, 0.004 * hs), iron, { p: [sx * 0.092 * hs, 0.065 * hs, 0.03 * hs], r: [0.15, 0, sx * 0.12] });
      R.part('head', box(0.022 * hs, 0.05 * hs, 0.16 * hs), pbr('fur', 0x8a1a10), { p: [0, 0.27 * hs, -0.03 * hs], r: [-0.15, 0, 0] });
    }
    if (kit.helm === 'kCap') {
      // A boiled-leather skullcap laced under the horns.
      R.part('head', sphere(0.094 * hs, 12, 8, { thetaLength: Math.PI * 0.42 }), pbr('leather', 0x4a3220), { p: [0, 0.112 * hs, -0.02 * hs], s: [1, 0.9, 1.08] });
      R.part('head', torus(0.088 * hs, 0.008 * hs, 4, 16), pbr('leather', 0x2a1a10), { p: [0, 0.145 * hs, -0.02 * hs], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] });
    }
    if (kit.helm === 'kSkull') {
      // The bleached skull of a dog worn as a helm, its muzzle over the brow.
      const boneM = pbr('bone', 0xd6c8a6);
      R.part('head', sphere(0.08 * hs, 10, 8, { thetaLength: Math.PI * 0.55 }), boneM, { p: [0, 0.135 * hs, -0.03 * hs], s: [1, 0.85, 1.15] });
      R.part('head', cone(0.035 * hs, 0.11 * hs, 6), boneM, { p: [0, 0.165 * hs, 0.06 * hs], r: [Math.PI / 2 - 0.3, 0, 0], s: [1, 1, 0.6] });
      for (const sx of [1, -1]) R.part('head', sphere(0.014 * hs, 6, 4), pbr('eye', 0x0a0806), { p: [sx * 0.03 * hs, 0.17 * hs, 0.04 * hs] });
    }
    if (kit.helm === 'kBand') {
      // A rag headband knotted behind the horns, with a crow feather.
      R.part('head', torus(0.09 * hs, 0.012 * hs, 4, 18), pbr('cloth', 0x8a2a1a), { p: [0, 0.13 * hs, -0.02 * hs], r: [Math.PI / 2 - 0.15, 0, 0], s: [1, 1.12, 1] });
      R.part('head', box(0.012 * hs, 0.11 * hs, 0.03 * hs), pbr('cloth', 0x1a1a1e), { p: [0.05 * hs, 0.2 * hs, -0.07 * hs], r: [-0.4, 0, -0.35] });
    }
    if (kit.helm === 'orcHelm') {
      const hy = 0.1 * hs;
      const rustM = pbr('metal', 0x5e4434);
      // Dented skullcap hugging the sculpted cranium, a riveted brow band, nasal and horns.
      R.part('head', sphere(0.104 * hs, 16, 10, { thetaLength: Math.PI * 0.5 }), rustM, { p: [0, 0.104 * hs, -0.024 * hs], s: [1.02, 0.96, 1.08] });
      R.part('head', torus(0.104 * hs, 0.009 * hs, 5, 20), pbr('metal', 0x3a3430), { p: [0, 0.108 * hs, -0.024 * hs], r: [Math.PI / 2 - 0.12, 0, 0], s: [1.02, 1.08, 1] });
      R.part('head', box(0.016 * hs, 0.06 * hs, 0.014 * hs), rustM, { p: [0, 0.098 * hs, 0.105 * hs], r: [0.12, 0, 0] });
      for (const sx of [1, -1]) R.part('head', cone(0.018 * hs, 0.09 * hs, 6), pbr('bone', 0x9a8c70), { p: [sx * 0.085 * hs, 0.19 * hs, -0.03 * hs], r: [0.25, 0, sx * -0.75] });
    }
  }
  if (o.thickNeck && !sculpt) {
    // Reptiles: a thick, forward-slung neck bridging the big head to the shoulders.
    R.part('neck', limb(0.065 * s, 0.075 * s, 0.12 * s, { seg: 10 }), skinMat, { p: [0, 0.1 * s, 0.01 * s], r: [0.35, 0, 0] });
    R.part('head', sphere(0.07 * s, 10, 8), skinMat, { p: [0, 0.02 * s, -0.04 * s] });
  }

  // Tail.
  if (o.tail && !sculpt) {
    const tk = o.tail === 'long' ? 1.35 : 1;
    R.part('tail1', limb(0.062 * s * tk, 0.045 * s * tk, 0.24 * s * tk, { seg: 8 }), skinMat, { r: [Math.PI / 2, 0, 0] });
    R.part('tail2', limb(0.045 * s * tk, 0.028 * s * tk, 0.22 * s * tk, { seg: 8 }), skinMat, { r: [Math.PI / 2, 0, 0] });
    R.part('tail3', limb(0.028 * s * tk, 0.006 * s, 0.22 * s * tk, { seg: 6 }), skinMat, { r: [Math.PI / 2, 0, 0] });
    // Dorsal ridge along the tail.
    for (let k = 0; k < 3; k++) R.part(`tail${k + 1}`, cone(0.012 * s * tk, 0.045 * s * tk, 4), skinMat, { p: [0, 0.035 * s * tk * (1 - k * 0.3), -0.1 * s * tk], r: [-0.6, 0, 0] });
  }

  // Cape: three cloth panels hanging from the shoulders.
  if (kit.cape) {
    const capeMat = pbr('cloth', kit.color);
    const capeW = 0.42 * s * w;
    // Cape panels with vertical folds that deepen toward the hem.
    let hem = 0;
    const panel = (len, wTop, wBot) => {
      const g = new THREE.CylinderGeometry(wTop, wBot, len, 22, 3, true, Math.PI * 0.6, Math.PI * 0.8);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const th = Math.atan2(x, z);
        const depth = hem + (0.5 - y / len) * 0.35;
        const k = 1 + Math.sin(th * 9) * 0.045 * (0.4 + depth);
        pos.setXYZ(i, x * k, y, z * k);
      }
      hem += 0.35;
      g.computeVertexNormals();
      g.scale(1, 1, 0.35);
      g.translate(0, -len / 2, 0.02 * s);
      return g;
    };
    R.part('capeA', panel(0.38 * s, capeW * 0.5, capeW * 0.58), capeMat);
    R.part('capeB', panel(0.36 * s, capeW * 0.58, capeW * 0.64), capeMat);
    R.part('capeC', panel(0.3 * s, capeW * 0.64, capeW * 0.7), capeMat);
    R.part('chest', torus(0.12 * s * w, 0.03 * s, 6, 16, Math.PI), capeMat, { p: [0, 0.21 * s, -0.02 * s], r: [Math.PI / 2 + 0.3, 0, 0], s: [1.1, 0.6, 1] });
    R.part('chest', sphere(0.025 * s, 8, 6), gold, { p: [shX * 0.55, 0.2 * s, 0.1 * s] });
  }

  // Weapons & shield ------------------------------------------------------
  const weaponMeshKind = kit.weapon;
  if (weaponMeshKind && weaponMeshKind !== 'fists') addWeapon(R, 'handR', weaponMeshKind, s, { metal, darkMetal, wood, leather: darkLeather, gold, magic: kit.magic, mage: kit.mage });
  if (kit.shield) addShield(R, 'handL', kit.shield, s, kit, { metal, wood, darkMetal, gold });
  // Quiver/bow on the back for archers.
  if (kit.ranged === 'bow') {
    R.part('chest', cyl(0.045 * s, 0.04 * s, 0.4 * s, 10), leather, { p: [-0.08 * s, 0.12 * s, -0.13 * s], r: [0.15, 0, 0.4] });
    for (let k = 0; k < 5; k++) R.part('chest', cyl(0.004 * s, 0.004 * s, 0.12 * s, 4), wood, { p: [-0.08 * s - 0.08 * s + (k % 3) * 0.012 * s, 0.34 * s + (k % 2) * 0.01 * s, -0.1 * s - 0.05 * s + (k % 2) * 0.01 * s], r: [0.15, 0, 0.4] });
    // Fletching.
    R.part('chest', box(0.06 * s, 0.05 * s, 0.03 * s), pbr('cloth', 0xe8e0d0), { p: [-0.17 * s, 0.38 * s, -0.16 * s], r: [0.15, 0, 0.4] });
    // The bow itself, slung.
    R.part('chest', torus(0.36 * s, 0.012 * s, 5, 20, Math.PI * 0.8), wood, { p: [0.02 * s, 0.08 * s, -0.16 * s], r: [0, 0, -Math.PI * 0.9 + 0.5] });
  }
  if (kit.cleric) R.part('chest', torus(0.03 * s, 0.006 * s, 5, 12), gold, { p: [0, 0.14 * s, 0.14 * s] });
  // Adventurer's kit: bedroll and pack for the road-worn, a scabbard at the hip.
  if (kit.race && kit.race !== 'monster') {
    if (!kit.cape && !kit.mage) {
      R.part('chest', rbox(0.26 * s * w, 0.3 * s, 0.14 * s, 0.04 * s), leather, { p: [0, 0.1 * s, -0.17 * s] });
      R.part('chest', cyl(0.06 * s, 0.06 * s, 0.34 * s * w, 12), pbr('cloth', 0x6a5a40), { p: [0, 0.3 * s, -0.17 * s], r: [0, 0, Math.PI / 2] });
      for (const sx of [1, -1]) R.part('chest', box(0.025 * s, 0.34 * s, 0.012 * s), darkLeather, { p: [sx * 0.09 * s * w, 0.1 * s, 0.13 * s], r: [0.15, 0, 0] });
    }
    if (kit.weapon === 'longSword' || kit.weapon === 'shortSword' || kit.weapon === 'greatSword') {
      R.part('hips', cyl(0.022 * s, 0.016 * s, 0.62 * s, 8), darkLeather, { p: [0.19 * s * w, -0.26 * s, -0.04 * s], r: [0.35, 0, 0.12] });
      R.part('hips', cyl(0.024 * s, 0.024 * s, 0.03 * s, 8), gold, { p: [0.19 * s * w, 0.03 * s, 0.06 * s], r: [0.35, 0, 0.12] });
    }
    if (kit.thief) R.part('hips', cyl(0.016 * s, 0.012 * s, 0.28 * s, 6), darkLeather, { p: [-0.18 * s * w, -0.12 * s, 0.05 * s], r: [-0.3, 0, -0.2] });
    // Coif of mail for armoured fighters without a helm.
    if (!kit.helm && kit.armor === 'chain' && !kit.cleric) R.part('neck', lathe([[0.1, -0.02], [0.085, 0.06], [0.07, 0.1]].map(([r, y]) => [r * s, y * s]), 14, { zs: 0.9 }), pbr('chain', 0x9aa0a8));
  }
  if (kit.mage) {
    // Scroll case + belt book.
    R.part('hips', rbox(0.1 * s, 0.13 * s, 0.04 * s, 0.01 * s), pbr('leather', 0x4a2a3a), { p: [-0.15 * s * w, -0.03 * s, 0.03 * s], r: [0, -0.5, 0] });
  }

  const built = R.build();
  if (o.sculpt) for (const nm of ['upperArmL', 'upperArmR', 'thighL', 'thighR']) R.bones[nm].rotation.z = 0;
  return {
    ...built,
    rig: 'biped',
    eyeAt: o.sculpt && o.sculptEyesOut?.eyes?.[0] ? o.sculptEyesOut.eyes[0].map((v) => v * s * (o.headScale ?? 1)) : null,
    height: u,
    radius: 0.3 * s * Math.max(1, w),
    scale: s,
    hipY,
    kit,
    armsForward: !!o.armsForward,
    hunch: o.hunch ?? 0,
    hasTail: !!o.tail,
    digitigrade: !!o.digitigrade,
    longTail: o.tail === 'long',
    hasCape: !!kit.cape,
    weapon: weaponMeshKind,
    eyesColor: o.eyes,
    eyesBurn: !!o.undead,
  };
}

function torsoShellGeo(s, w, grow) {
  return lathe([[0.16 * grow, -0.03], [0.185 * grow, 0.07], [0.2 * grow, 0.15], [0.16 * grow, 0.2]].map(([r, y]) => [r * s, y * s]), 12, { xs: w * 1.08, zs: 0.68 });
}

// ------------------------------------------------------------------ heads
function buildHead(R, o, s, skinMat) {
  const hs = s * (o.headScale ?? 1);
  const kit = o.kit;
  const hy = 0.1 * hs;
  const eyeMat = o.eyes != null ? pbr('glow', 0x000000, { emissive: o.eyes, emissiveIntensity: 3.2 }) : pbr('eye', 0x1a120c);
  const white = pbr('eye', 0xe8e0d0);
  const hairMat = pbr('hair', kit.hair ?? 0x2a1a10);
  const metal = pbr('metal', 0xb0b4bc);
  switch (o.head) {
    case 'human': {
      const female = kit.female;
      // Skull: a lathed head (cranium, cheekbones, tapering jaw), deeper front-to-back.
      R.part('head', lathe([[0.001, -0.118], [0.035, -0.112], [0.062, -0.088], [0.08, -0.048], [0.092, -0.005], [0.098, 0.035], [0.094, 0.07], [0.075, 0.1], [0.04, 0.12], [0.001, 0.126]].map(([r, y]) => [r * hs, y * hs]), 20, { xs: female ? 0.84 : 0.88, zs: 0.96 }), skinMat, { p: [0, hy, -0.004 * hs] });
      // Cheekbones, brow ridge and chin give the face planes that read in light.
      for (const sx of [1, -1]) R.part('head', sphere(0.028 * hs, 10, 8), skinMat, { p: [sx * 0.048 * hs, hy - 0.016 * hs, 0.058 * hs], s: [1, 0.8, 0.75] });
      R.part('head', sphere(0.024 * hs, 10, 8), skinMat, { p: [0, hy - 0.094 * hs, 0.046 * hs], s: [1.25, 0.8, 0.9] });
      R.part('head', box(0.096 * hs, 0.02 * hs, 0.026 * hs), skinMat, { p: [0, hy + 0.027 * hs, 0.076 * hs], r: [0.25, 0, 0] });
      // Nose (bridge + tip), eyes set into the brow shadow, brows, ears.
      R.part('head', blade([[-0.012, 0], [0.012, 0], [0.004, 0.052], [-0.004, 0.052]].map(([x, y]) => [x * hs, y * hs]), 0.024 * hs, 0.006 * hs), skinMat, { p: [0, hy + 0.02 * hs, 0.086 * hs], r: [Math.PI + 0.35, 0, 0] });
      R.part('head', sphere(0.013 * hs, 8, 6), skinMat, { p: [0, hy - 0.026 * hs, 0.1 * hs] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.016 * hs, 10, 8), white, { p: [sx * 0.034 * hs, hy + 0.008 * hs, 0.074 * hs] });
        R.part('head', sphere(0.0085 * hs, 8, 6), eyeMat, { p: [sx * 0.034 * hs, hy + 0.008 * hs, 0.087 * hs] });
        R.part('head', box(0.036 * hs, 0.009 * hs, 0.014 * hs), hairMat, { p: [sx * 0.035 * hs, hy + 0.03 * hs, 0.085 * hs], r: [0.2, sx * -0.2, sx * -0.14] });
        const elfEar = kit.race === 'elf' || kit.race === 'halfElf';
        R.part('head', elfEar ? cone(0.018 * hs, 0.09 * hs, 5) : sphere(0.022 * hs, 8, 6), skinMat, elfEar
          ? { p: [sx * 0.1 * hs, hy + 0.03 * hs, -0.01 * hs], r: [-0.4, 0, sx * -1.1] }
          : { p: [sx * 0.093 * hs, hy, -0.005 * hs], s: [0.5, 1, 0.8] });
      }
      R.part('head', box(0.04 * hs, 0.008 * hs, 0.01 * hs), pbr('skin', 0x8a4a3a), { p: [0, hy - 0.05 * hs, 0.092 * hs] });
      const h = kit.human ?? {};
      if (kit.helm === 'horned') {
        R.part('head', sphere(0.118 * hs, 18, 10, { thetaLength: Math.PI * 0.55 }), metal, { p: [0, hy + 0.01 * hs, -0.005 * hs] });
        R.part('head', torus(0.11 * hs, 0.012 * hs, 6, 24), pbr('gold', 0xb8923a), { p: [0, hy + 0.02 * hs, 0], r: [Math.PI / 2, 0, 0] });
        R.part('head', box(0.02 * hs, 0.08 * hs, 0.02 * hs), metal, { p: [0, hy - 0.01 * hs, 0.115 * hs] });
        for (const sx of [1, -1]) R.part('head', cone(0.028 * hs, 0.16 * hs, 8), pbr('bone', 0xe0d4b8), { p: [sx * 0.14 * hs, hy + 0.08 * hs, 0], r: [0, 0, sx * -1.0] });
      } else if (kit.helm === 'nasal') {
        R.part('head', sphere(0.116 * hs, 18, 10, { thetaLength: Math.PI * 0.55 }), metal, { p: [0, hy + 0.01 * hs, 0], s: [1, 1.1, 1] });
        R.part('head', box(0.018 * hs, 0.08 * hs, 0.02 * hs), metal, { p: [0, hy - 0.005 * hs, 0.112 * hs] });
      } else if (kit.mage) {
        // Wide-brimmed pointed hat.
        // Felt hat: a thin brim with a rolled, drooping edge, a crown that
        // slumps and a tip that flops back (no rigid traffic cone).
        const felt = pbr('cloth', new THREE.Color(kit.color).multiplyScalar(0.6).getHex());
        R.part('head', cyl(0.2 * hs, 0.19 * hs, 0.01 * hs, 24), felt, { p: [0, hy + 0.07 * hs, 0], r: [0.08, 0, 0.05] });
        R.part('head', torus(0.198 * hs, 0.011 * hs, 5, 28), felt, { p: [0, hy + 0.062 * hs, 0], r: [Math.PI / 2 + 0.08, 0, 0.05], s: [1, 1, 0.8] });
        R.part('head', lathe([[0.118, 0], [0.108, 0.05], [0.09, 0.11], [0.072, 0.16]].map(([r, y]) => [r * hs, y * hs]), 16), felt, { p: [0, hy + 0.07 * hs, -0.01 * hs], r: [-0.25, 0, 0.1] });
        R.part('head', lathe([[0.074, 0], [0.058, 0.05], [0.036, 0.1], [0.016, 0.15], [0.003, 0.18]].map(([r, y]) => [r * hs, y * hs]), 14), felt, { p: [-0.016 * hs, hy + 0.222 * hs, -0.05 * hs], r: [-1.0, 0, 0.3] });
        R.part('head', torus(0.11 * hs, 0.01 * hs, 5, 20), pbr('gold', 0xd8b25a), { p: [0, hy + 0.08 * hs, 0], r: [Math.PI / 2, 0, 0] });
        R.part('head', sphere(0.104 * hs, 16, 12, { thetaLength: Math.PI * 0.6 }), hairMat, { p: [0, hy + 0.006 * hs, -0.014 * hs], r: [-0.55, 0, 0], s: [0.98, 1.05, 1.06] });
        R.part('head', limb(0.08 * hs, 0.05 * hs, 0.3 * hs, { seg: 10, zs: 0.5 }), hairMat, { p: [0, hy - 0.02 * hs, -0.07 * hs] });
      } else if (h.hood) {
        R.part('head', sphere(0.125 * hs, 16, 12, { thetaLength: Math.PI * 0.62 }), pbr('cloth', h.hood), { p: [0, hy + 0.01 * hs, -0.015 * hs], r: [-0.3, 0, 0], s: [1, 1.08, 1.1] });
        R.part('neck', lathe([[0.16, -0.02], [0.12, 0.05], [0.08, 0.1]].map(([r, y]) => [r * s, y * s]), 14, { zs: 0.8 }), pbr('cloth', h.hood));
      } else if (kit.thief) {
        // Halfling hood over curls.
        R.part('head', sphere(0.12 * hs, 16, 12, { thetaLength: Math.PI * 0.6 }), pbr('cloth', 0x5a4a2a), { p: [0, hy + 0.01 * hs, -0.02 * hs], r: [-0.35, 0, 0], s: [1, 1.1, 1.12] });
        R.part('neck', lathe([[0.15, -0.02], [0.11, 0.05], [0.07, 0.1]].map(([r, y]) => [r * s, y * s]), 14, { zs: 0.8 }), pbr('cloth', 0x5a4a2a));
        for (let k = 0; k < 4; k++) R.part('head', sphere(0.025 * hs, 6, 5), hairMat, { p: [(k - 1.5) * 0.04 * hs, hy + 0.06 * hs, 0.085 * hs] });
      } else if (kit.cleric) {
        // Tonsure: fringe of hair.
        R.part('head', torus(0.095 * hs, 0.022 * hs, 6, 20), hairMat, { p: [0, hy + 0.035 * hs, -0.008 * hs], r: [Math.PI / 2 + 0.15, 0, 0] });
      } else {
        const long = female || kit.race === 'elf';
        R.part('head', sphere(0.104 * hs, 16, 12, { thetaLength: Math.PI * 0.58 }), hairMat, { p: [0, hy + 0.01 * hs, -0.012 * hs], r: [-0.5, 0, 0], s: [0.96, 1.06, 1.06] });
        // Clumped locks for volume.
        for (let k = 0; k < 7; k++) {
          const a = (k / 6 - 0.5) * 2.4;
          R.part('head', sphere(0.04 * hs, 8, 6), hairMat, { p: [Math.sin(a) * 0.075 * hs, hy + 0.085 * hs - Math.abs(a) * 0.025 * hs, Math.cos(a) * 0.03 * hs - 0.025 * hs], s: [1, 0.8, 1.1] });
        }
        if (long) {
          R.part('head', limb(0.09 * hs, 0.045 * hs, 0.36 * hs, { seg: 12, zs: 0.45 }), hairMat, { p: [0, hy - 0.0 * hs, -0.07 * hs], r: [-0.12, 0, 0] });
          for (const sx of [1, -1]) R.part('head', limb(0.03 * hs, 0.02 * hs, 0.2 * hs, { seg: 8 }), hairMat, { p: [sx * 0.085 * hs, hy - 0.01 * hs, 0.0], r: [0, 0, sx * 0.08] });
        }
        if (h.bandana) R.part('head', sphere(0.114 * hs, 16, 10, { thetaLength: Math.PI * 0.45 }), pbr('cloth', h.bandana), { p: [0, hy + 0.01 * hs, -0.01 * hs], r: [-0.2, 0, 0] });
      }
      // Beards.
      if (kit.race === 'dwarf') {
        R.part('head', lathe([[0.005, -0.3], [0.06, -0.22], [0.09, -0.1], [0.09, 0]].map(([r, y]) => [r * hs, y * hs]), 12, { zs: 0.6 }), hairMat, { p: [0, hy - 0.03 * hs, 0.06 * hs], r: [0.25, 0, 0] });
        R.part('head', box(0.1 * hs, 0.02 * hs, 0.03 * hs), hairMat, { p: [0, hy - 0.025 * hs, 0.1 * hs] });
        for (const sx of [1, -1]) R.part('head', torus(0.012 * hs, 0.005 * hs, 4, 10), pbr('gold', 0xd8b25a), { p: [sx * 0.03 * hs, hy - 0.22 * hs, 0.12 * hs], r: [Math.PI / 2, 0, 0] });
      } else if (kit.cleric || h.beard === 'full') {
        R.part('head', sphere(0.075 * hs, 12, 8, { thetaStart: Math.PI * 0.45 }), hairMat, { p: [0, hy - 0.03 * hs, 0.035 * hs], s: [1.05, 1.1, 1] });
      } else if (h.beard === 'stubble') {
        R.part('head', sphere(0.083 * hs, 12, 8, { thetaStart: Math.PI * 0.5 }), pbr('hair', 0x2a2018), { p: [0, hy - 0.04 * hs, 0.028 * hs], s: [0.97, 0.78, 0.97] });
      }
      break;
    }
    case 'hobgoblin': {
      R.part('head', sphere(0.11 * hs, 18, 14), skinMat, { p: [0, hy, 0], s: [0.95, 1, 1] });
      R.part('head', sphere(0.085 * hs, 12, 10), skinMat, { p: [0, hy - 0.05 * hs, 0.035 * hs], s: [1.05, 0.75, 0.95] });
      R.part('head', cone(0.026 * hs, 0.06 * hs, 6), skinMat, { p: [0, hy - 0.01 * hs, 0.11 * hs], r: [Math.PI / 2 - 0.2, 0, 0] });
      R.part('head', box(0.16 * hs, 0.025 * hs, 0.04 * hs), skinMat, { p: [0, hy + 0.035 * hs, 0.085 * hs] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.012 * hs, 8, 6), eyeMat, { p: [sx * 0.038 * hs, hy + 0.015 * hs, 0.098 * hs] });
        R.part('head', cone(0.03 * hs, 0.09 * hs, 5), skinMat, { p: [sx * 0.11 * hs, hy + 0.03 * hs, -0.01 * hs], r: [0, 0, sx * -1.3] });
      }
      R.part('head', sphere(0.12 * hs, 14, 10, { thetaLength: Math.PI * 0.5 }), pbr('metal', 0x6a6260), { p: [0, hy + 0.012 * hs, 0] });
      R.part('head', cone(0.012 * hs, 0.08 * hs, 5), pbr('metal', 0x6a6260), { p: [0, hy + 0.14 * hs, 0] });
      break;
    }
    case 'orc': {
      // Heavy, brutish: low sloped cranium, jutting underbite jaw with tusks,
      // a thick brow shelf over deep-set eyes, a flat broad nose, swept ears.
      const dark = pbr('skin', 0x3a4232);
      R.part('head', sphere(0.105 * hs, 18, 14), skinMat, { p: [0, hy + 0.005 * hs, -0.02 * hs], s: [1.05, 0.88, 1.05] });
      R.part('head', rbox(0.17 * hs, 0.08 * hs, 0.13 * hs, 0.035 * hs), skinMat, { p: [0, hy - 0.07 * hs, 0.045 * hs], r: [-0.12, 0, 0] });
      R.part('head', box(0.19 * hs, 0.042 * hs, 0.06 * hs), dark, { p: [0, hy + 0.03 * hs, 0.085 * hs], r: [0.35, 0, 0] });
      for (const sx of [1, -1]) R.part('head', sphere(0.035 * hs, 8, 6), dark, { p: [sx * 0.05 * hs, hy + 0.035 * hs, 0.095 * hs], s: [1.3, 0.6, 0.8] });
      R.part('head', sphere(0.034 * hs, 10, 8), dark, { p: [0, hy - 0.012 * hs, 0.118 * hs], s: [1.35, 0.75, 0.9] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.009 * hs, 6, 5), pbr('eye', 0x080404), { p: [sx * 0.016 * hs, hy - 0.022 * hs, 0.142 * hs] });
        R.part('head', sphere(0.022 * hs, 8, 6), pbr('eye', 0x0a0606), { p: [sx * 0.045 * hs, hy + 0.012 * hs, 0.09 * hs] });
        R.part('head', sphere(0.012 * hs, 8, 6), eyeMat, { p: [sx * 0.045 * hs, hy + 0.012 * hs, 0.103 * hs] });
        // Tusks from the lower jaw, curving up past the lip.
        R.part('head', cone(0.017 * hs, 0.085 * hs, 7), pbr('bone', 0xe6dac0), { p: [sx * 0.055 * hs, hy - 0.05 * hs, 0.11 * hs], r: [-0.35, 0, sx * -0.28] });
        R.part('head', cone(0.035 * hs, 0.11 * hs, 5), skinMat, { p: [sx * 0.115 * hs, hy + 0.0 * hs, -0.03 * hs], r: [0.5, 0, sx * -1.25], s: [1, 1, 0.45] });
      }
      R.part('head', box(0.11 * hs, 0.012 * hs, 0.012 * hs), dark, { p: [0, hy - 0.072 * hs, 0.112 * hs] });
      if (kit.helm === 'hobHelm') {
      // Hobgoblin legion helm: a dark-iron conical spangenhelm with brass bands,
      // a nasal, hinged cheek guards and a short red horsehair crest.
      const iron = pbr('metal', 0x3e3a36);
      const brass = pbr('gold', 0x9a7a3a);
      R.part('head', lathe([[0.104, 0], [0.1, 0.05], [0.08, 0.1], [0.045, 0.14], [0.008, 0.16]].map(([r, y]) => [r * hs, y * hs]), 14, { zs: 1.08 }), iron, { p: [0, 0.1 * hs, -0.018 * hs] });
      R.part('head', torus(0.104 * hs, 0.01 * hs, 5, 22), brass, { p: [0, 0.104 * hs, -0.018 * hs], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] });
      for (let k = 0; k < 4; k++) R.part('head', box(0.012 * hs, 0.15 * hs, 0.01 * hs), brass, { p: [Math.sin(k * Math.PI / 2) * 0.07 * hs, 0.17 * hs, -0.018 * hs + Math.cos(k * Math.PI / 2) * 0.075 * hs], r: [Math.cos(k * Math.PI / 2) * -0.55, 0, Math.sin(k * Math.PI / 2) * 0.55] });
      R.part('head', box(0.018 * hs, 0.07 * hs, 0.012 * hs), iron, { p: [0, 0.085 * hs, 0.1 * hs], r: [0.1, 0, 0] });
      for (const sx of [1, -1]) R.part('head', rbox(0.012 * hs, 0.08 * hs, 0.06 * hs, 0.004 * hs), iron, { p: [sx * 0.092 * hs, 0.065 * hs, 0.03 * hs], r: [0.15, 0, sx * 0.12] });
      R.part('head', box(0.022 * hs, 0.05 * hs, 0.16 * hs), pbr('fur', 0x8a1a10), { p: [0, 0.27 * hs, -0.03 * hs], r: [-0.15, 0, 0] });
    }
    if (kit.helm === 'kCap') {
      // A boiled-leather skullcap laced under the horns.
      R.part('head', sphere(0.094 * hs, 12, 8, { thetaLength: Math.PI * 0.42 }), pbr('leather', 0x4a3220), { p: [0, 0.112 * hs, -0.02 * hs], s: [1, 0.9, 1.08] });
      R.part('head', torus(0.088 * hs, 0.008 * hs, 4, 16), pbr('leather', 0x2a1a10), { p: [0, 0.145 * hs, -0.02 * hs], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] });
    }
    if (kit.helm === 'kSkull') {
      // The bleached skull of a dog worn as a helm, its muzzle over the brow.
      const boneM = pbr('bone', 0xd6c8a6);
      R.part('head', sphere(0.08 * hs, 10, 8, { thetaLength: Math.PI * 0.55 }), boneM, { p: [0, 0.135 * hs, -0.03 * hs], s: [1, 0.85, 1.15] });
      R.part('head', cone(0.035 * hs, 0.11 * hs, 6), boneM, { p: [0, 0.165 * hs, 0.06 * hs], r: [Math.PI / 2 - 0.3, 0, 0], s: [1, 1, 0.6] });
      for (const sx of [1, -1]) R.part('head', sphere(0.014 * hs, 6, 4), pbr('eye', 0x0a0806), { p: [sx * 0.03 * hs, 0.17 * hs, 0.04 * hs] });
    }
    if (kit.helm === 'kBand') {
      // A rag headband knotted behind the horns, with a crow feather.
      R.part('head', torus(0.09 * hs, 0.012 * hs, 4, 18), pbr('cloth', 0x8a2a1a), { p: [0, 0.13 * hs, -0.02 * hs], r: [Math.PI / 2 - 0.15, 0, 0], s: [1, 1.12, 1] });
      R.part('head', box(0.012 * hs, 0.11 * hs, 0.03 * hs), pbr('cloth', 0x1a1a1e), { p: [0.05 * hs, 0.2 * hs, -0.07 * hs], r: [-0.4, 0, -0.35] });
    }
    if (kit.helm === 'orcHelm') {
        const rustM = pbr('metal', 0x5e4434);
        R.part('head', sphere(0.118 * hs, 14, 10, { thetaLength: Math.PI * 0.5 }), rustM, { p: [0, hy + 0.012 * hs, -0.015 * hs], s: [1.05, 0.9, 1.08] });
        R.part('head', box(0.02 * hs, 0.08 * hs, 0.02 * hs), rustM, { p: [0, hy + 0.0 * hs, 0.112 * hs], r: [0.3, 0, 0] });
        for (const sx of [1, -1]) R.part('head', cone(0.022 * hs, 0.1 * hs, 6), pbr('bone', 0xd0c4a8), { p: [sx * 0.1 * hs, hy + 0.09 * hs, -0.01 * hs], r: [0.2, 0, sx * -0.7] });
      } else {
        // Greasy black topknot / crest.
        for (let k = 0; k < 4; k++) R.part('head', limb(0.028 * hs, 0.01 * hs, 0.12 * hs, { seg: 6 }), pbr('hair', 0x141010), { p: [0, hy + 0.085 * hs, 0.02 * hs - k * 0.04 * hs], r: [-0.6 - k * 0.35, 0, 0] });
      }
      break;
    }
    case 'goblin': {
      R.part('head', sphere(0.115 * hs, 18, 14), skinMat, { p: [0, hy, 0], s: [1.08, 0.92, 1] });
      R.part('head', cone(0.03 * hs, 0.09 * hs, 6), skinMat, { p: [0, hy - 0.01 * hs, 0.125 * hs], r: [Math.PI / 2 + 0.25, 0, 0] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.02 * hs, 8, 6), eyeMat, { p: [sx * 0.045 * hs, hy + 0.02 * hs, 0.09 * hs] });
        R.part('head', cone(0.045 * hs, 0.18 * hs, 5), skinMat, { p: [sx * 0.17 * hs, hy + 0.03 * hs, -0.02 * hs], r: [0.2, 0, sx * -1.35], s: [1, 1, 0.35] });
      }
      R.part('head', box(0.09 * hs, 0.012 * hs, 0.01 * hs), pbr('skin', 0x2a1a10), { p: [0, hy - 0.06 * hs, 0.1 * hs] });
      break;
    }
    case 'kobold': {
      // Reptilian dog-lizard: a wedge snout with nostril bumps and a row of teeth,
      // swept-back horns, frilled ears and a crest — readable at tactics zoom.
      const hornMat = pbr('bone', 0xd8c8a0);
      const lightScale = pbr('reptile', 0xc89a62);
      R.part('head', sphere(0.095 * hs, 16, 12), skinMat, { p: [0, hy + 0.01 * hs, -0.01 * hs], s: [0.95, 0.9, 1.05] });
      R.part('head', rbox(0.08 * hs, 0.058 * hs, 0.25 * hs, 0.026 * hs), skinMat, { p: [0, hy - 0.012 * hs, 0.16 * hs], r: [0.16, 0, 0] });
      R.part('head', rbox(0.07 * hs, 0.028 * hs, 0.21 * hs, 0.012 * hs), lightScale, { p: [0, hy - 0.062 * hs, 0.14 * hs], r: [-0.16, 0, 0] });
      for (const sx of [1, -1]) R.part('head', sphere(0.01 * hs, 6, 5), pbr('eye', 0x100604), { p: [sx * 0.02 * hs, hy + 0.0 * hs, 0.28 * hs] });
      for (let k = 0; k < 4; k++) for (const sx of [1, -1]) R.part('head', cone(0.006 * hs, 0.022 * hs, 4), pbr('bone', 0xf0e8d0), { p: [sx * 0.03 * hs, hy - 0.05 * hs, 0.2 * hs + k * 0.03 * hs - 0.05 * hs], r: [Math.PI, 0, 0] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.02 * hs, 8, 6), eyeMat, { p: [sx * 0.05 * hs, hy + 0.03 * hs, 0.075 * hs] });
        R.part('head', box(0.04 * hs, 0.012 * hs, 0.03 * hs), skinMat, { p: [sx * 0.048 * hs, hy + 0.05 * hs, 0.08 * hs], r: [0.3, 0, sx * -0.3] });
        R.part('head', cone(0.022 * hs, 0.14 * hs, 6), hornMat, { p: [sx * 0.05 * hs, hy + 0.08 * hs, -0.07 * hs], r: [-1.15, 0, sx * -0.35] });
        R.part('head', cone(0.04 * hs, 0.08 * hs, 4), skinMat, { p: [sx * 0.09 * hs, hy + 0.02 * hs, -0.04 * hs], r: [0, 0, sx * -1.25], s: [1, 1, 0.3] });
      }
      for (let k = 0; k < 4; k++) R.part('head', cone(0.014 * hs, 0.05 * hs, 4), skinMat, { p: [0, hy + 0.09 * hs - k * 0.022 * hs, -0.03 * hs - k * 0.038 * hs], r: [-0.5 - k * 0.3, 0, 0] });
      break;
    }
    case 'gnoll': {
      R.part('head', sphere(0.11 * hs, 16, 12), skinMat, { p: [0, hy, -0.01 * hs] });
      R.part('head', lathe([[0.03, 0], [0.055, 0.08], [0.075, 0.18]].map(([r, y]) => [r * hs, y * hs]), 12, { xs: 1, zs: 0.9 }), skinMat, { p: [0, hy - 0.02 * hs, 0.26 * hs], r: [-Math.PI / 2 - 0.12, 0, 0] });
      R.part('head', sphere(0.022 * hs, 8, 6), pbr('eye', 0x100a08), { p: [0, hy - 0.01 * hs, 0.27 * hs] });
      R.part('head', rbox(0.08 * hs, 0.025 * hs, 0.16 * hs, 0.01 * hs), pbr('skin', 0x3a2a1a), { p: [0, hy - 0.07 * hs, 0.16 * hs], r: [-0.15, 0, 0] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.016 * hs, 8, 6), eyeMat, { p: [sx * 0.05 * hs, hy + 0.035 * hs, 0.08 * hs] });
        R.part('head', sphere(0.05 * hs, 10, 8), skinMat, { p: [sx * 0.08 * hs, hy + 0.1 * hs, -0.03 * hs], s: [0.6, 1, 0.3] });
      }
      // Mane.
      for (let k = 0; k < 6; k++) R.part('neck', cone(0.035 * s, 0.14 * s, 5), pbr('fur', 0x2a1a10), { p: [0, 0.12 * s - k * 0.04 * s, -0.08 * s - k * 0.015 * s], r: [-1.9 + k * 0.1, 0, 0] });
      break;
    }
    case 'skull': {
      R.part('head', sphere(0.1 * hs, 16, 12), skinMat, { p: [0, hy + 0.01 * hs, 0], s: [0.9, 1, 1.02] });
      R.part('head', rbox(0.1 * hs, 0.045 * hs, 0.08 * hs, 0.015 * hs), skinMat, { p: [0, hy - 0.07 * hs, 0.04 * hs] });
      for (let k = 0; k < 6; k++) R.part('head', box(0.01 * hs, 0.016 * hs, 0.01 * hs), pbr('bone', 0xf0e8d0), { p: [(k - 2.5) * 0.013 * hs, hy - 0.045 * hs, 0.085 * hs] });
      const socket = pbr('eye', 0x050403);
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.028 * hs, 10, 8), socket, { p: [sx * 0.036 * hs, hy + 0.012 * hs, 0.074 * hs] });
        R.part('head', sphere(0.01 * hs, 8, 6), eyeMat, { p: [sx * 0.036 * hs, hy + 0.012 * hs, 0.093 * hs] });
      }
      R.part('head', cone(0.014 * hs, 0.03 * hs, 3), socket, { p: [0, hy - 0.02 * hs, 0.093 * hs], r: [Math.PI / 2, 0, Math.PI] });
      break;
    }
    case 'zombie': {
      R.part('head', sphere(0.105 * hs, 16, 12), skinMat, { p: [0, hy, 0], s: [0.9, 1.08, 1] });
      R.part('head', sphere(0.075 * hs, 12, 8), skinMat, { p: [0, hy - 0.07 * hs, 0.03 * hs], s: [0.9, 0.7, 0.9] });
      R.part('head', box(0.05 * hs, 0.02 * hs, 0.02 * hs), pbr('eye', 0x1a0a08), { p: [0, hy - 0.075 * hs, 0.085 * hs] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.02 * hs, 8, 6), pbr('eye', 0x1a100a), { p: [sx * 0.036 * hs, hy + 0.012 * hs, 0.082 * hs] });
        R.part('head', sphere(0.008 * hs, 6, 5), eyeMat, { p: [sx * 0.036 * hs, hy + 0.012 * hs, 0.098 * hs] });
      }
      R.part('head', sphere(0.108 * hs, 12, 8, { thetaLength: Math.PI * 0.4 }), pbr('hair', 0x3a3428), { p: [0.01 * hs, hy + 0.01 * hs, -0.02 * hs], r: [-0.4, 0.3, 0.2] });
      break;
    }
    case 'ogre': {
      R.part('head', sphere(0.1 * hs, 16, 12), skinMat, { p: [0, hy - 0.01 * hs, 0.02 * hs], s: [1.15, 0.95, 1] });
      R.part('head', sphere(0.09 * hs, 12, 10), skinMat, { p: [0, hy - 0.06 * hs, 0.05 * hs], s: [1.3, 0.8, 1] });
      R.part('head', sphere(0.035 * hs, 10, 8), skinMat, { p: [0, hy - 0.01 * hs, 0.11 * hs] });
      R.part('head', box(0.16 * hs, 0.03 * hs, 0.04 * hs), skinMat, { p: [0, hy + 0.035 * hs, 0.09 * hs] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.012 * hs, 8, 6), eyeMat, { p: [sx * 0.04 * hs, hy + 0.012 * hs, 0.105 * hs] });
        R.part('head', cone(0.014 * hs, 0.05 * hs, 6), pbr('bone', 0xd8c8a0), { p: [sx * 0.05 * hs, hy - 0.07 * hs, 0.12 * hs], r: [-0.2, 0, 0] });
      }
      break;
    }
    case 'troll': {
      R.part('head', sphere(0.1 * hs, 16, 12), skinMat, { p: [0, hy, 0], s: [0.9, 1.1, 1.1] });
      R.part('head', cone(0.03 * hs, 0.16 * hs, 8), skinMat, { p: [0, hy - 0.01 * hs, 0.15 * hs], r: [Math.PI / 2 + 0.5, 0, 0] });
      R.part('head', rbox(0.1 * hs, 0.04 * hs, 0.1 * hs, 0.015 * hs), skinMat, { p: [0, hy - 0.08 * hs, 0.06 * hs] });
      for (const sx of [1, -1]) {
        R.part('head', sphere(0.014 * hs, 8, 6), eyeMat, { p: [sx * 0.04 * hs, hy + 0.03 * hs, 0.09 * hs] });
        R.part('head', cone(0.03 * hs, 0.12 * hs, 5), skinMat, { p: [sx * 0.11 * hs, hy + 0.02 * hs, -0.02 * hs], r: [0.2, 0, sx * -1.2], s: [1, 1, 0.4] });
      }
      for (let k = 0; k < 7; k++) R.part('head', limb(0.012 * hs, 0.004 * hs, 0.2 * hs, { seg: 5 }), pbr('hair', 0x2a3a1a), { p: [(k - 3) * 0.025 * hs, hy + 0.09 * hs, -0.03 * hs], r: [-2.2 + k * 0.05, 0, (k - 3) * 0.12] });
      break;
    }
    default:
      R.part('head', sphere(0.105 * hs, 16, 12), skinMat, { p: [0, hy, 0] });
  }
}

// ------------------------------------------------------------------ weapons
/** Weapons are modelled in hand space: grip at the origin, blade along +Z. */
export function addWeapon(R, bone, kind, s, m) {
  const gz = (z) => z * s;
  const grip = (len, r = 0.017) => R.part(bone, cyl(r * s, r * s, len * s, 8), m.leather, { p: [0, -0.05 * s, 0], r: [Math.PI / 2, 0, 0] });
  const handleY = -0.05 * s;
  const bladeMat = m.magic ? pbr('metal', 0xd0e0ff, { emissive: 0x3060ff, emissiveIntensity: 0.6 }) : m.metal;
  switch (kind) {
    case 'longSword':
    case 'shortSword':
    case 'greatSword': {
      const L = kind === 'shortSword' ? 0.5 : kind === 'greatSword' ? 1.05 : 0.78;
      const W = kind === 'greatSword' ? 0.028 : 0.024;
      grip(kind === 'greatSword' ? 0.3 : 0.17);
      R.part(bone, sphere(0.026 * s, 10, 8), m.gold, { p: [0, handleY, gz(-0.1)] });
      R.part(bone, rbox(0.2 * s, 0.03 * s, 0.03 * s, 0.01 * s), m.darkMetal, { p: [0, handleY, gz(0.1)] });
      R.part(bone, blade([[-W, 0], [W, 0], [W * 0.9, L * 0.85], [0, L], [-W * 0.9, L * 0.85]].map(([x, y]) => [x * s, y * s]), 0.008 * s, 0.003 * s), bladeMat, { p: [0, handleY, gz(0.11)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, box(0.006 * s, 0.004 * s, L * 0.7 * s), m.darkMetal, { p: [0, handleY + 0.006 * s, gz(0.11 + L * 0.38)] });
      break;
    }
    case 'dagger': {
      grip(0.1);
      R.part(bone, rbox(0.08 * s, 0.02 * s, 0.02 * s, 0.006 * s), m.darkMetal, { p: [0, handleY, gz(0.06)] });
      R.part(bone, blade([[-0.018, 0], [0.018, 0], [0, 0.22]].map(([x, y]) => [x * s, y * s]), 0.006 * s), m.metal, { p: [0, handleY, gz(0.07)], r: [Math.PI / 2, 0, 0] });
      break;
    }
    case 'battleAxe':
    case 'handAxe': {
      const L = kind === 'battleAxe' ? 0.75 : 0.5;
      R.part(bone, cyl(0.02 * s, 0.022 * s, L * s, 8), m.wood, { p: [0, handleY, gz(L * 0.35)], r: [Math.PI / 2, 0, 0] });
      const head = blade([[0, -0.04], [0.06, -0.06], [0.16, -0.12], [0.19, 0], [0.16, 0.12], [0.06, 0.06], [0, 0.04]].map(([x, y]) => [x * s, y * s]), 0.018 * s, 0.006 * s);
      R.part(bone, head, m.metal, { p: [0, handleY, gz(L * 0.78)], r: [0, Math.PI / 2, Math.PI / 2] });
      R.part(bone, rbox(0.05 * s, 0.05 * s, 0.08 * s, 0.01 * s), m.darkMetal, { p: [0, handleY, gz(L * 0.78)] });
      if (kind === 'battleAxe') R.part(bone, blade([[0, -0.03], [0.1, -0.06], [0.12, 0], [0.1, 0.06], [0, 0.03]].map(([x, y]) => [x * s, y * s]), 0.016 * s), m.metal, { p: [0, handleY, gz(L * 0.78)], r: [0, -Math.PI / 2, Math.PI / 2] });
      break;
    }
    case 'mace':
    case 'morningStar':
    case 'flail': {
      R.part(bone, cyl(0.02 * s, 0.024 * s, 0.55 * s, 8), m.wood, { p: [0, handleY, gz(0.18)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, sphere(0.06 * s, 12, 10), m.darkMetal, { p: [0, handleY, gz(0.48)] });
      if (kind === 'mace') for (let k = 0; k < 6; k++) R.part(bone, box(0.012 * s, 0.13 * s, 0.1 * s), m.metal, { p: [0, handleY, gz(0.48)], r: [0, 0, (k / 6) * Math.PI] });
      else for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        R.part(bone, cone(0.015 * s, 0.07 * s, 5), m.metal, { p: [Math.cos(a) * 0.06 * s, handleY + Math.sin(a) * 0.06 * s, gz(0.48 + (k % 2 ? 0.02 : -0.02))], r: [0, 0, a - Math.PI / 2] });
      }
      break;
    }
    case 'club': {
      R.part(bone, lathe([[0.02, -0.12], [0.025, 0.1], [0.05, 0.4], [0.055, 0.5], [0.001, 0.54]].map(([r, y]) => [r * s, y * s]), 8), m.wood, { p: [0, handleY, 0], r: [Math.PI / 2, 0, 0] });
      for (let k = 0; k < 4; k++) R.part(bone, cone(0.012 * s, 0.04 * s, 4), m.darkMetal, { p: [(k % 2 ? 1 : -1) * 0.045 * s, handleY + (k < 2 ? 0.02 : -0.02) * s, gz(0.38 + k * 0.03)], r: [0, 0, k % 2 ? -Math.PI / 2 : Math.PI / 2] });
      break;
    }
    case 'staff': {
      R.part(bone, lathe([[0.022, -0.8], [0.024, 0], [0.026, 0.7], [0.034, 0.8]].map(([r, y]) => [r * s, y * s]), 8), m.wood, { p: [0, handleY, 0], r: [Math.PI / 2, 0, 0] });
      // Claw holding a glowing crystal.
      for (let k = 0; k < 3; k++) R.part(bone, cone(0.012 * s, 0.1 * s, 4), m.darkMetal, { p: [Math.cos(k * 2.1) * 0.03 * s, handleY + Math.sin(k * 2.1) * 0.03 * s, gz(0.85)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, new THREE.OctahedronGeometry(0.045 * s, 0), pbr('glow', 0x88ccff, { emissive: m.mage ? 0x4fb0ff : 0x60a0d0, emissiveIntensity: m.mage ? 4 : 1.5 }), { p: [0, handleY, gz(0.9)], s: [0.8, 0.8, 1.4] });
      break;
    }
    case 'spear': {
      R.part(bone, cyl(0.016 * s, 0.018 * s, 1.5 * s, 8), m.wood, { p: [0, handleY, gz(0.35)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, blade([[-0.03, 0], [0.03, 0], [0.02, 0.12], [0, 0.2], [-0.02, 0.12]].map(([x, y]) => [x * s, y * s]), 0.01 * s), m.metal, { p: [0, handleY, gz(1.08)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, cyl(0.02 * s, 0.02 * s, 0.05 * s, 8), m.darkMetal, { p: [0, handleY, gz(1.08)], r: [Math.PI / 2, 0, 0] });
      break;
    }
    case 'glaive': {
      // Hobgoblin polearm: a long ash haft, a curved single-edged blade with a
      // back hook, an iron langet and a red tassel.
      R.part(bone, cyl(0.017 * s, 0.019 * s, 1.75 * s, 8), m.wood, { p: [0, handleY, gz(0.42)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, blade([[-0.02, 0], [0.035, 0], [0.06, 0.12], [0.055, 0.26], [0.0, 0.36], [-0.015, 0.22], [-0.03, 0.06]].map(([x, y]) => [x * s, y * s]), 0.012 * s, 0.003 * s), m.metal, { p: [0, handleY, gz(1.26)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, blade([[0, 0], [-0.09, 0.03], [-0.02, 0.06]].map(([x, y]) => [x * s, y * s]), 0.01 * s), m.darkMetal, { p: [0, handleY, gz(1.3)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, cyl(0.024 * s, 0.022 * s, 0.12 * s, 8), m.darkMetal, { p: [0, handleY, gz(1.22)], r: [Math.PI / 2, 0, 0] });
      R.part(bone, cone(0.03 * s, 0.1 * s, 6), pbr('fur', 0x8a1a10), { p: [0, handleY, gz(1.14)], r: [-Math.PI / 2, 0, 0] });
      R.part(bone, cone(0.018 * s, 0.06 * s, 6), m.darkMetal, { p: [0, handleY, gz(-0.48)], r: [-Math.PI / 2, 0, 0] });
      break;
    }
    case 'sling': {
      // A leather sling dangling from the fist with a stone in its cradle.
      R.part(bone, cyl(0.004 * s, 0.004 * s, 0.32 * s, 4), m.leather, { p: [0, handleY - 0.16 * s, gz(0.02)] });
      R.part(bone, rbox(0.05 * s, 0.03 * s, 0.035 * s, 0.01 * s), m.leather, { p: [0, handleY - 0.33 * s, gz(0.02)] });
      R.part(bone, sphere(0.022 * s, 7, 5), pbr('bone', 0x7a746a), { p: [0, handleY - 0.32 * s, gz(0.02)] });
      break;
    }
    case 'bow': {
      R.part(bone, torus(0.42 * s, 0.014 * s, 6, 24, Math.PI * 0.75), m.wood, { p: [0, 0.3 * s, 0], r: [0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.125] });
      R.part(bone, cyl(0.002 * s, 0.002 * s, 0.78 * s, 3), pbr('cloth', 0xe8e0d0), { p: [0, -0.05 * s, 0], r: [Math.PI / 2, 0, 0] });
      break;
    }
    default:
      break;
  }
}

function addShield(R, bone, kind, s, kit, m) {
  // Heroes carry painted heraldry; monsters carry battered planks.
  const face = kit.race === 'monster' ? (kind === 'hide' ? pbr('leather', 0x7a5a3a) : pbr('plank', 0x8a6a4a)) : new THREE.MeshStandardMaterial({ map: heraldry(kit.color, kit.device ?? 'chevron'), roughness: 0.75, metalness: 0.05 });
  // In the guard pose the hand's -Y axis points forward; the shield faces that way.
  const place = { p: [0.03 * s, -0.1 * s, 0.02 * s], r: [0, 0, 0] };
  if (kind === 'hide') {
    // Stretched hide on a wicker hoop: smaller, lashed, no boss.
    const g = cyl(0.2 * s, 0.2 * s, 0.02 * s, 18);
    R.part(bone, g, face, place);
    R.part(bone, torus(0.2 * s, 0.014 * s, 5, 18), pbr('wood', 0x5a4028), { p: place.p, r: [Math.PI / 2, 0, 0] });
    for (let k = 0; k < 2; k++) R.part(bone, box(0.4 * s, 0.012 * s, 0.03 * s), pbr('wood', 0x4a3420), { p: [place.p[0], place.p[1] - 0.02 * s, place.p[2]], r: [0, k * Math.PI / 2 + 0.4, 0] });
    return;
  }
  if (kind === 'round') {
    const g = cyl(0.26 * s, 0.26 * s, 0.03 * s, 28);
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (0.56 * s) + 0.5, pos.getZ(i) / (0.56 * s) + 0.5);
    R.part(bone, g, face, place);
    R.part(bone, torus(0.26 * s, 0.018 * s, 6, 28), m.darkMetal, { p: place.p, r: [Math.PI / 2, 0, 0] });
    R.part(bone, sphere(0.06 * s, 12, 8, { thetaLength: Math.PI / 2 }), m.metal, { p: [0.03 * s, -0.12 * s, 0.02 * s], r: [Math.PI, 0, 0] });
    return;
  }
  // Kite / heater shield outline.
  const pts = kind === 'heater'
    ? [[-0.22, 0.24], [0.22, 0.24], [0.22, 0.02], [0.14, -0.2], [0, -0.3], [-0.14, -0.2], [-0.22, 0.02]]
    : [[-0.21, 0.3], [0.21, 0.3], [0.22, 0.1], [0.12, -0.25], [0, -0.44], [-0.12, -0.25], [-0.22, 0.1]];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * s, y * s)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02 * s, bevelEnabled: true, bevelThickness: 0.012 * s, bevelSize: 0.012 * s, bevelSegments: 2 });
  // Planar UVs for the heraldry.
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (0.48 * s) + 0.5, pos.getY(i) / (0.78 * s) + 0.55);
  g.translate(0, 0, -0.01 * s);
  // Shape lies in XY; face +Z. Rotate so the face looks along -Y of the hand and "up" is +Z.
  R.part(bone, g, face, { p: [0.03 * s, -0.12 * s, 0.05 * s], r: [Math.PI / 2, 0, 0] });
  R.part(bone, g.clone().scale(1.04, 1.04, 0.5), m.darkMetal, { p: [0.03 * s, -0.105 * s, 0.05 * s], r: [Math.PI / 2, 0, 0] });
  R.part(bone, sphere(0.04 * s, 10, 6, { thetaLength: Math.PI / 2 }), m.gold, { p: [0.03 * s, -0.14 * s, 0.07 * s], r: [Math.PI, 0, 0] });
}

// ------------------------------------------------------------------ quadrupeds
function buildRat(sp, seed) {
  const R = new RigBuilder();
  const s = 1.1 + seed * 0.2;
  const fur = pbr('fur', sp.skin[1]);
  const pink = pbr('skin', 0xc08878);
  const eye = pbr('glow', 0, { emissive: sp.eyes, emissiveIntensity: 3 });
  R.bone('body', null, 0, 0.26 * s, 0);
  R.bone('chest', 'body', 0, 0.02 * s, 0.2 * s);
  R.bone('head', 'chest', 0, 0.04 * s, 0.16 * s);
  R.bone('tail1', 'body', 0, -0.02 * s, -0.24 * s);
  R.bone('tail2', 'tail1', 0, 0, -0.25 * s);
  R.bone('tail3', 'tail2', 0, 0, -0.25 * s);
  const legs = [['FL', 'chest', 0.09, 0.02], ['FR', 'chest', -0.09, 0.02], ['BL', 'body', 0.1, -0.1], ['BR', 'body', -0.1, -0.1]];
  for (const [n, p, x, z] of legs) {
    R.bone(`leg${n}`, p, x * s, -0.04 * s, z * s);
    R.bone(`knee${n}`, `leg${n}`, 0, -0.11 * s, 0);
  }
  R.part('body', sphere(0.17 * s, 16, 12), fur, { p: [0, 0, -0.04 * s], s: [0.95, 0.85, 1.45] });
  R.part('chest', sphere(0.13 * s, 14, 10), fur, { s: [0.95, 0.9, 1.2] });
  R.part('head', lathe([[0.001, 0.2], [0.03, 0.17], [0.07, 0.07], [0.085, -0.02], [0.001, -0.07]].map(([r, y]) => [r * s, y * s]), 12), fur, { r: [Math.PI / 2, 0, 0] });
  R.part('head', sphere(0.018 * s, 8, 6), pink, { p: [0, 0, 0.2 * s] });
  for (const sx of [1, -1]) {
    R.part('head', sphere(0.016 * s, 8, 6), eye, { p: [sx * 0.045 * s, 0.035 * s, 0.07 * s] });
    R.part('head', sphere(0.04 * s, 10, 8), pink, { p: [sx * 0.06 * s, 0.07 * s, -0.01 * s], s: [0.9, 1, 0.3] });
    for (let k = 0; k < 3; k++) R.part('head', cyl(0.0015 * s, 0.001 * s, 0.12 * s, 3), pbr('hair', 0x1a1410), { p: [sx * 0.06 * s, -0.005 * s, 0.15 * s], r: [0, 0, sx * (1.3 + k * 0.15)] });
  }
  for (const k of [1, -1]) R.part('head', box(0.012 * s, 0.022 * s, 0.01 * s), pbr('bone', 0xe8d8a0), { p: [k * 0.008 * s, -0.035 * s, 0.17 * s] });
  for (const [n] of legs) {
    R.part(`leg${n}`, limb(0.04 * s, 0.025 * s, 0.11 * s, { seg: 8 }), fur);
    R.part(`knee${n}`, limb(0.022 * s, 0.014 * s, 0.1 * s, { seg: 6 }), pink);
    R.part(`knee${n}`, rbox(0.035 * s, 0.015 * s, 0.06 * s, 0.006 * s), pink, { p: [0, -0.11 * s, 0.02 * s] });
  }
  R.part('tail1', limb(0.028 * s, 0.02 * s, 0.25 * s, { seg: 6 }), pink, { r: [Math.PI / 2, 0, 0] });
  R.part('tail2', limb(0.02 * s, 0.012 * s, 0.25 * s, { seg: 6 }), pink, { r: [Math.PI / 2, 0, 0] });
  R.part('tail3', limb(0.012 * s, 0.004 * s, 0.25 * s, { seg: 5 }), pink, { r: [Math.PI / 2, 0, 0] });
  const built = R.build();
  return { ...built, rig: 'quad', height: 0.5 * s, radius: 0.3 * s, scale: s, hasTail: true, eyesColor: sp.eyes };
}

function buildSpider(sp, seed) {
  const R = new RigBuilder();
  const s = 1.3 + seed * 0.2;
  const fur = pbr('fur', sp.skin[1]);
  const eye = pbr('glow', 0, { emissive: sp.eyes, emissiveIntensity: 3 });
  R.bone('body', null, 0, 0.35 * s, 0);
  R.bone('head', 'body', 0, 0, 0.18 * s);
  R.part('body', sphere(0.24 * s, 16, 12), fur, { p: [0, 0.05 * s, -0.25 * s], s: [1, 0.85, 1.2] });
  R.part('body', sphere(0.14 * s, 14, 10), fur);
  R.part('head', sphere(0.09 * s, 12, 10), fur);
  for (let k = 0; k < 6; k++) R.part('head', sphere(0.014 * s, 6, 5), eye, { p: [(k % 3 - 1) * 0.03 * s, 0.03 * s + Math.floor(k / 3) * 0.025 * s, 0.08 * s] });
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? 1 : -1;
    const n = `leg${i}`;
    const z = (1.5 - (i % 4)) * 0.07 * s;
    R.bone(n, 'body', side * 0.1 * s, 0, z);
    R.bone(`knee${i}`, n, side * 0.28 * s, 0.18 * s, 0);
    R.part(n, limb(0.025 * s, 0.018 * s, 0.34 * s, { seg: 6 }), fur, { r: [0, 0, side * (Math.PI / 2 + 0.55)] });
    R.part(`knee${i}`, limb(0.018 * s, 0.006 * s, 0.45 * s, { seg: 6 }), fur, { r: [0, 0, side * 0.35] });
  }
  const built = R.build();
  return { ...built, rig: 'spider', height: 0.6 * s, radius: 0.5 * s, scale: s, eyesColor: sp.eyes };
}
