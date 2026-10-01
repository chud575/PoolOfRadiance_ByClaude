import { ITEMS } from '../../data/items.js';

/**
 * The single source of truth for how a character looks: palettes, the eight
 * head and eight body templates of the Gold Box "head + body" portrait picker,
 * and resolveAppearance(), which turns a character (draft or with readied
 * gear) into the one appearance that both the painted portrait and the 3D
 * miniature are built from — so hair, beard, helm/hood and armour always
 * match between the two.
 *
 * look = {seed, head, body, skin, hair, eyes, cloth}  (indices)
 */

// ------------------------------------------------------------------ palettes

export const SKIN_TONES = {
  pale: '#f2d6c0', fair: '#ecc3a2', light: '#dfae88', golden: '#d9a77a', ruddy: '#d99478',
  tan: '#c58c62', olive: '#b0865c', brown: '#8a5a3c', dark: '#5f3b28',
};
export const RACE_SKINS = {
  human: ['fair', 'light', 'tan', 'olive', 'brown', 'dark'],
  elf: ['pale', 'fair', 'golden', 'light'],
  halfElf: ['fair', 'light', 'golden', 'tan', 'olive'],
  dwarf: ['ruddy', 'light', 'tan', 'brown'],
  gnome: ['tan', 'ruddy', 'light', 'brown'],
  halfling: ['fair', 'ruddy', 'light', 'tan'],
};
export const HAIR_COLORS = [
  ['Raven', '#17110e'], ['Umber', '#3a2416'], ['Chestnut', '#62351b'], ['Auburn', '#8a3a1a'],
  ['Copper', '#b3602a'], ['Honey', '#b8904c'], ['Flaxen', '#dcc285'], ['Silver', '#b9b5ae'],
  ['Ash', '#6f6a64'], ['Snow', '#e4e0d8'],
];
export const EYE_COLORS = ['#3f6788', '#4f7336', '#5e3f24', '#7d6034', '#4a4d58', '#6fa0b8', '#94762c'];
export const CLOTH_COLORS = [
  ['Crimson', '#7c1e1c'], ['Royal', '#1f3a7c'], ['Forest', '#2c5634'], ['Violet', '#523672'],
  ['Umber', '#6a5234'], ['Sable', '#2a2a31'], ['Ochre', '#8f6a1c'], ['Teal', '#1c5a5e'],
];

/**
 * Head templates per gender (8 each). `face` sculpts the skull and features:
 *   w face width · jaw jaw width · chin chin size · cheek cheekbones · nose length ·
 *   bridge nose bridge width · tip nose tip size · eye eye size · sp eye spacing ·
 *   brow brow mass · lips lip fullness · mouth mouth width · long face length · lid lid droop
 * `expr`: neutral | scowl | smirk | weary | stern | kind | proud.  `age` 0..1 lines and greying.
 */
export const HEADS = {
  male: [
    { name: 'Soldier', hair: 'short', beard: 'stubble', expr: 'stern', face: { jaw: 1.16, chin: 1.2, cheek: 0.95, nose: 1.0, bridge: 1.1, brow: 1.15, lips: 0.85, sp: 1.0 } },
    { name: 'Wanderer', hair: 'swept', beard: 'full', expr: 'weary', age: 0.25, face: { w: 0.96, nose: 1.15, bridge: 0.9, eye: 0.95, lid: 0.55, cheek: 1.08, sp: 1.04 } },
    { name: 'Noble', hair: 'long', beard: 'goatee', expr: 'proud', face: { w: 0.9, jaw: 0.84, chin: 0.9, nose: 1.18, bridge: 0.8, cheek: 1.25, long: 1.08, lips: 0.85, sp: 0.96 } },
    { name: 'Veteran', hair: 'bald', beard: 'full', scar: true, age: 0.7, expr: 'scowl', face: { w: 1.08, jaw: 1.22, brow: 1.55, nose: 1.22, bridge: 1.35, tip: 1.25, eye: 0.88, lips: 0.8, sp: 1.02 } },
    { name: 'Guardsman', hair: 'short', beard: 'moustache', helm: true, expr: 'stern', face: { jaw: 1.18, chin: 1.12, mouth: 1.08, nose: 1.05, brow: 1.2, sp: 1.0 } },
    { name: 'Rogue', hair: 'topknot', beard: 'stubble', expr: 'smirk', face: { w: 0.92, jaw: 0.86, chin: 0.78, eye: 0.92, long: 1.05, cheek: 1.18, nose: 0.92, lid: 0.25, sp: 0.95 } },
    { name: 'Hooded', hair: 'hood', beard: 'stubble', expr: 'neutral', face: { w: 0.95, nose: 1.12, cheek: 1.1, sp: 0.97, lid: 0.3 } },
    { name: 'Sage', hair: 'long', beard: 'long', age: 1, expr: 'kind', face: { w: 0.94, nose: 1.28, tip: 1.2, long: 1.06, eye: 0.9, lid: 0.45, brow: 1.2, cheek: 0.9 } },
  ],
  female: [
    { name: 'Maiden', hair: 'long', beard: 'none', expr: 'kind', face: { w: 0.97, cheek: 1.12, nose: 0.88, eye: 1.08, lips: 1.15, chin: 0.85 } },
    { name: 'Ranger', hair: 'braid', beard: 'none', expr: 'stern', face: { w: 0.96, jaw: 0.98, nose: 1.05, bridge: 1.05, cheek: 1.15, brow: 0.95, sp: 1.02 } },
    { name: 'Priestess', hair: 'bun', beard: 'none', expr: 'neutral', face: { w: 1.03, chin: 0.85, eye: 1.08, lid: 0.35, cheek: 1.0, lips: 1.05 } },
    { name: 'Duelist', hair: 'bob', beard: 'none', expr: 'smirk', face: { w: 0.93, jaw: 0.86, nose: 1.08, eye: 0.94, mouth: 0.92, cheek: 1.22, sp: 0.96 } },
    { name: 'Sorceress', hair: 'wavy', beard: 'none', expr: 'proud', face: { w: 0.92, long: 1.07, eye: 1.12, chin: 0.82, cheek: 1.3, nose: 0.95, lips: 1.2, lid: 0.3 } },
    { name: 'Shieldmaiden', hair: 'long', beard: 'none', helm: true, expr: 'stern', face: { jaw: 1.08, chin: 1.08, brow: 1.1, nose: 1.02 } },
    { name: 'Hooded', hair: 'hood', beard: 'none', expr: 'weary', face: { w: 0.95, lid: 0.5, cheek: 1.05, nose: 0.95 } },
    { name: 'Mercenary', hair: 'crop', beard: 'none', scar: true, expr: 'scowl', age: 0.2, face: { jaw: 1.12, brow: 1.35, w: 1.02, eye: 0.9, nose: 1.1, bridge: 1.2, lips: 0.85 } },
  ],
};
/** Bodies (8), usable by anyone; defaults follow the class. */
export const BODIES = [
  { id: 'plate', name: 'Plate' },
  { id: 'chain', name: 'Mail' },
  { id: 'scale', name: 'Scale' },
  { id: 'leather', name: 'Leathers' },
  { id: 'robe', name: 'Robes' },
  { id: 'tabard', name: 'Tabard' },
  { id: 'fur', name: 'Furs' },
  { id: 'vestments', name: 'Vestments' },
];
const CLASS_BODY = { fighter: 0, cleric: 5, magicUser: 4, thief: 3 };
const CLASS_HEAD = { male: { fighter: 0, cleric: 1, magicUser: 7, thief: 5 }, female: { fighter: 5, cleric: 2, magicUser: 4, thief: 3 } };

// ------------------------------------------------------------------ utilities

export function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashNum(...xs) {
  let h = 2166136261;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/**
 * Complete a (possibly partial) look for a character. Deterministic from look.seed.
 * @param {{race:string, gender?:string, classSpec?:string, look?:object, name?:string}} ch
 */
export function defaultLook(ch) {
  const look = { ...(ch.look ?? {}) };
  const seed = look.seed ?? hashNum(ch.name ?? '', ch.race, ch.classSpec);
  const R = rngFrom(seed * 31 + 7);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const cls = String(ch.classSpec ?? 'fighter').split('/')[0];
  const skins = RACE_SKINS[ch.race] ?? RACE_SKINS.human;
  look.seed = seed;
  look.head ??= CLASS_HEAD[gender][cls] ?? Math.floor(R() * 8);
  look.body ??= CLASS_BODY[cls] ?? 0;
  look.skin ??= Math.floor(R() * skins.length);
  const hairPool = ch.race === 'elf' ? [0, 5, 6, 7, 9, 2] : ch.race === 'dwarf' ? [3, 4, 2, 1, 0, 8] : ch.race === 'gnome' ? [8, 9, 1, 4, 2] : [0, 1, 2, 3, 4, 5, 6];
  look.hair ??= hairPool[Math.floor(R() * hairPool.length)];
  look.eyes ??= Math.floor(R() * EYE_COLORS.length);
  look.cloth ??= Math.floor(R() * CLOTH_COLORS.length);
  return look;
}

// ------------------------------------------------------------------ appearance

const ARMOR_BODY = { plate: 'plate', banded: 'plate', splint: 'plate', chain: 'chain', ring: 'chain', elfin: 'chain', scale: 'scale', leather: 'leather', padded: 'leather', studded: 'leather' };
/** Body templates that are a dressed-up variant of a readied armour type. */
const VARIANT = { chain: ['tabard'], leather: ['fur'], none: ['robe', 'vestments'] };
const WEAPON_KIND = { sword: 'sword', dagger: 'dagger', mace: 'mace', axe: 'axe', staff: 'staff', spear: 'spear', bow: 'bow', sling: 'sling' };

/**
 * What a character actually has readied. Null for a creation draft (no inventory).
 * @returns {{body:string|null, weapon:string|null, weaponId:string|null, shield:boolean, helm:boolean, cloak:boolean}|null}
 */
export function readiedGear(ch) {
  if (!Array.isArray(ch.inventory)) return null;
  const eq = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]).map((e) => ITEMS[e.id]);
  const armor = eq.find((d) => d.type === 'armor');
  const wpn = eq.find((d) => d.type === 'weapon');
  return {
    body: armor ? ARMOR_BODY[armor.armorGroup] ?? 'chain' : null,
    weapon: wpn ? WEAPON_KIND[wpn.icon] ?? 'sword' : null,
    weaponId: wpn?.id ?? null,
    twoHanded: !!wpn?.twoHanded,
    shield: eq.some((d) => d.type === 'shield'),
    helm: eq.some((d) => d.type === 'helm'),
    cloak: eq.some((d) => d.type === 'cloak'),
  };
}

const hexToLin = (c) => {
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return v.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
};

/**
 * The resolved appearance shared by the portrait and the miniature.
 * @param {{race:string, gender?:string, classSpec?:string, look?:object, name?:string, inventory?:object[]}} ch
 * @param {{gear?: boolean}} [o]  gear:false ignores readied equipment (template only)
 */
export function resolveAppearance(ch, o = {}) {
  const look = defaultLook(ch);
  const gender = ch.gender === 'female' ? 'female' : 'male';
  const fem = gender === 'female';
  const race = ch.race in RACE_SKINS ? ch.race : 'human';
  const head = HEADS[gender][look.head % 8];
  const gear = o.gear === false ? null : readiedGear(ch);
  const tmplBody = BODIES[look.body % BODIES.length].id;
  let body = tmplBody;
  if (gear) {
    const g = gear.body ?? 'none';
    if (g === 'none') body = VARIANT.none.includes(tmplBody) ? tmplBody : 'tunic';
    else body = g === tmplBody || VARIANT[g]?.includes(tmplBody) ? tmplBody : g;
  }
  const cls = String(ch.classSpec ?? 'fighter').split('/');
  const has = (c) => cls.includes(c);
  const mu = has('magicUser') && !has('fighter');
  const cl = has('cleric') && !has('fighter');
  const thiefOnly = has('thief') && !has('fighter');
  const weapon = gear ? gear.weapon : mu ? 'staff' : cl ? 'mace' : thiefOnly ? 'dagger' : 'sword';
  const shield = gear ? gear.shield && !gear.twoHanded : (has('fighter') || has('cleric')) && !mu;
  // Beards: dwarves always, elves never (half-elves rarely long), halflings never; women never.
  let beard = head.beard;
  if (fem) beard = 'none';
  else if (race === 'dwarf') beard = ['none', 'stubble', 'moustache'].includes(beard) ? 'full' : beard === 'goatee' ? 'full' : 'long';
  else if (race === 'elf') beard = 'none';
  else if (race === 'halfElf') beard = beard === 'long' || beard === 'full' ? 'stubble' : beard;
  else if (race === 'halfling') beard = beard === 'stubble' ? 'stubble' : 'none';
  else if (race === 'gnome') beard = beard === 'none' || beard === 'stubble' ? 'goatee' : beard === 'moustache' ? 'moustache' : 'full';
  const hairStyle = head.hair;
  const helm = !!(head.helm || gear?.helm);
  const skins = RACE_SKINS[race];
  const skinHex = SKIN_TONES[skins[look.skin % skins.length]];
  const hairHex = HAIR_COLORS[look.hair % HAIR_COLORS.length][1];
  const age = head.age ?? 0;
  return {
    look, race, gender, fem, head, body, tmplBody, gear,
    hair: hairStyle === 'hood' && helm ? 'short' : hairStyle,
    hood: hairStyle === 'hood' && !helm,
    helm,
    beard,
    expr: head.expr ?? 'neutral',
    age,
    scar: !!head.scar,
    face: head.face ?? {},
    skinHex,
    hairHex: age >= 0.9 && look.hair < 7 ? '#b8b2a8' : hairHex,
    eyeHex: EYE_COLORS[look.eyes % EYE_COLORS.length],
    clothHex: CLOTH_COLORS[look.cloth % CLOTH_COLORS.length][1],
    trimHex: CLOTH_COLORS[(look.cloth + 3) % CLOTH_COLORS.length][1],
    lin: hexToLin,
    weapon,
    shield: shield ? (cl || (has('cleric') && !has('fighter')) ? 'round' : 'heater') : null,
    cloak: gear ? gear.cloak || !['robe', 'vestments'].includes(body) : !['robe', 'vestments'].includes(body),
    classes: cls,
    mu, cl, thiefOnly,
    caster: has('magicUser'),
    cleric: has('cleric'),
    thief: has('thief'),
    seed: look.seed,
  };
}

/** Stable key of everything that changes the rendered appearance. */
export function appearanceKey(ch, o = {}) {
  const a = resolveAppearance(ch, o);
  const l = a.look;
  return [a.race, a.gender, l.seed, l.head, l.body, l.skin, l.hair, l.eyes, l.cloth, a.body, a.helm ? 1 : 0, a.weapon, a.shield, a.cloak ? 1 : 0].join('|');
}
