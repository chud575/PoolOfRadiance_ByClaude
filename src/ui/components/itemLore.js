/**
 * One terse flavour line per kind of item (weapon group, armour group, or item id), so no bow ever
 * claims to be "honest steel". Unidentified magic reads as its mundane kind.
 */
import { ITEMS } from '../../data/items.js';

const BY_KEY = {
  // weapons (weaponGroup)
  dagger: 'A hand-span of keen iron. Every adventurer carries one; most forget it until the last.',
  shortSword: 'A stabbing blade for close alleys and crowded tunnels.',
  longSword: 'Honest steel from a Phlan smithy, oiled against the sea air.',
  broadSword: 'A heavy, wide blade with a basket hilt, favoured by the Moonsea sellswords.',
  twoHandedSword: 'Taller than a halfling and twice as heavy. Clears a corridor.',
  battleAxe: 'A bearded head on an ash haft. The dwarves of the Earthspur swear by them.',
  handAxe: 'A woodsman\'s hatchet, balanced for the throw or the chop.',
  mace: 'Flanged iron on a stout haft — the priest\'s answer to mail and bone alike.',
  flail: 'A spiked ball on a chain. Shields are no comfort against it.',
  hammer: 'A war hammer with a back spike, made to dent helms.',
  morningStar: 'A spiked head on a long haft. Crude, cheap and brutal.',
  club: 'Seasoned oak, iron-banded. No smith required.',
  staff: 'A shod quarterstaff of black ash, worn smooth by a mage\'s grip.',
  spear: 'A leaf blade on a long shaft. Keep the kobolds at arm\'s length.',
  halberd: 'Axe, spike and hook on a pole — the City Watch\'s weapon of choice.',
  shortBow: 'A self bow of yew, short enough to loose from behind a wall.',
  longBow: 'Six feet of yew. It wants a strong back and open ground.',
  lightCrossbow: 'Crank, aim, loose. A child could use it, and in Phlan some do.',
  heavyCrossbow: 'A windlass crossbow that punches through plate — slowly.',
  sling: 'A leather cradle and two cords. In halfling hands, deadly.',
  dart: 'Weighted and fletched, thrown three at a time.',
  scimitar: 'A curved blade from the southern caravans, made to slash from the saddle.',
  trident: 'A fisherman\'s spear from the Phlan docks, three tines barbed.',
  glaive: 'A long cleaver on a pole. It wants room to swing.',
  compositeBow: null,
  // armour (armorGroup)
  padded: 'Quilted layers of wool and linen. It stinks in summer.',
  leather: 'Boiled leather, supple enough for a thief to climb in.',
  studded: 'Leather riveted with iron studs — a compromise between stealth and steel.',
  ring: 'Iron rings sewn to leather. Cheaper than mail, and it looks it.',
  scale: 'Overlapping scales like a fish\'s back. Loud, heavy and reassuring.',
  chain: 'Worn by a dozen owners before you; every mended link is a story.',
  banded: 'Strips of steel over mail. Heavy, but the bands turn a blade.',
  splint: 'Vertical splints over leather and mail — a soldier\'s armour.',
  plate: 'Fitted steel from gorget to greaves. You will be heard coming.',
  elfin: null,
  // others (by id)
  arrows: 'Goose-fletched, iron-tipped. Retrieve what you can after the fight.',
  quarrels: 'Stubby bolts with square heads. They do not fly far, but they fly true.',
  shield: 'Painted wood and iron, scarred by kobold spears.',
  helm: 'An iron cap with a nasal bar. Ugly, and better than a cracked skull.',
  holySymbol: 'A cast-silver token of the god, warm to the touch in a believer\'s hand.',
  gem: 'A cut stone that catches the lamplight. Worth more to a moneychanger than to you.',
  jewelry: 'A brooch of gold and garnets, pried from some long-dead noble.',
};

const BY_TYPE = {
  ring: 'A plain band. Rings in Phlan are seldom only rings.',
  potion: 'A stoppered vial. Shake well; drink quickly.',
  scroll: 'Crackling vellum, the ink still faintly warm.',
  wand: 'A tapered rod of dark wood, banded in silver. It hums when held.',
  cloak: 'A travelling cloak, rain-dark and moth-nibbled.',
  bracers: 'Leather bracers chased with faint, looping sigils.',
  gauntlets: 'Heavy leather gauntlets, the knuckles backed with iron.',
  amulet: 'A pendant on a fine chain. Something inside it rattles.',
  treasure: 'Worth more to a moneychanger than to you.',
  gear: 'The kit every adventurer forgets until it is needed.',
  ammo: 'Fletched by hand. Retrieve what you can after the fight.',
};

/** Flavour line for an inventory entry (or item id). */
export function itemLore(entryOrId) {
  const e = typeof entryOrId === 'string' ? { id: entryOrId } : entryOrId;
  const def = ITEMS[e.id];
  if (!def) return '';
  const unid = e.identified === false;
  if (def.desc && !unid) return def.desc;
  const key = def.type === 'weapon' ? def.weaponGroup : def.type === 'armor' ? def.armorGroup : e.id;
  if (!unid || def.type === 'weapon' || def.type === 'armor' || def.type === 'shield') {
    const line = BY_KEY[key] ?? BY_KEY[e.id];
    if (line) return line;
  }
  if (def.desc) return def.desc;
  return BY_TYPE[def.type] ?? 'Plain, serviceable gear of the Moonsea towns.';
}
