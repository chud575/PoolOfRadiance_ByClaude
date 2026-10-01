/**
 * Where are we? Map id → music mood, footstep surface, reverb room and
 * ambience bed. Unknown maps fall back by `kind` (city/dungeon/wilderness).
 */
export const MAP_ENV = {
  phlan_civilized: { mood: 'town', surface: 'cobble', room: 'street', bed: 'town' },
  phlan_slums: { mood: 'ruins', surface: 'cobble', room: 'street', bed: 'ruins' },
  podol_plaza: { mood: 'ruins', surface: 'cobble', room: 'street', bed: 'ruins' },
  kutos_well: { mood: 'ruins', surface: 'gravel', room: 'street', bed: 'ruins' },
  sokol_keep: { mood: 'crypt', surface: 'gravel', room: 'street', bed: 'crypt' },
  stojanow_gate: { mood: 'ruins', surface: 'gravel', room: 'street', bed: 'ruins' },
  valhingen_graveyard: { mood: 'crypt', surface: 'dirt', room: 'open', bed: 'crypt' },
  wilderness: { mood: 'wilds', surface: 'grass', room: 'open', bed: 'wilds' },
  mendors_library: { mood: 'crypt', surface: 'wood', room: 'room', bed: 'interior' },
  cadorna_textile: { mood: 'dungeon', surface: 'wood', room: 'room', bed: 'interior' },
  kutos_warrens: { mood: 'dungeon', surface: 'stone', room: 'dungeon', bed: 'dungeon' },
  temple_bane: { mood: 'dungeon', surface: 'stone', room: 'dungeon', bed: 'dungeon' },
  valjevo_castle: { mood: 'dungeon', surface: 'stone', room: 'dungeon', bed: 'dungeon' },
  pool_pyramid: { mood: 'dungeon', surface: 'stone', room: 'cathedral', bed: 'dungeon' },
};

const BY_KIND = {
  city: { mood: 'ruins', surface: 'cobble', room: 'street', bed: 'ruins' },
  dungeon: { mood: 'dungeon', surface: 'stone', room: 'dungeon', bed: 'dungeon' },
  wilderness: { mood: 'wilds', surface: 'grass', room: 'open', bed: 'wilds' },
};

/** @param {string} [mapId] @param {string} [kind] */
export function envFor(mapId, kind) {
  return MAP_ENV[mapId] ?? BY_KIND[kind] ?? BY_KIND.city;
}

/** Spell id/name → SFX family. */
export const SPELL_FAMILY = [
  [/fireball/i, 'spell_fire'],
  [/burning hands|flame|fire/i, 'spell_cone'],
  [/lightning|breath/i, 'spell_lightning'],
  [/shocking/i, 'spell_shock'],
  [/magic missile/i, 'spell_missile'],
  [/sleep/i, 'spell_sleep'],
  [/charm|hold|fear|scare|silence/i, 'spell_mind'],
  [/stinking cloud|cloud/i, 'spell_cloud'],
  [/cure|heal|potion of healing|regain/i, 'spell_heal'],
  [/bless|prayer|dispel|holy|protection from evil/i, 'spell_holy'],
  [/curse|cause|drain/i, 'spell_curse'],
  [/shield|mirror|invisib|enlarge|haste|resist|protection|detect|light|knock|strength|wand|scroll/i, 'spell_ward'],
];

export function spellFamily(text) {
  for (const [re, fam] of SPELL_FAMILY) if (re.test(text)) return fam;
  return 'spell';
}
