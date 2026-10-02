/** Seed item table. See schema.js ItemDef. Costs/weights from the 1e PHB. */
const W = (id, name, damage, damageLarge, cost, weight, extra = {}) => ({
  id, name, type: 'weapon', damage, damageLarge, cost, weight, weaponGroup: extra.weaponGroup ?? id, icon: extra.icon ?? 'sword', ...extra,
});
const A = (id, name, ac, cost, weight, extra = {}) => ({ id, name, type: 'armor', ac, cost, weight, armorGroup: extra.armorGroup ?? id, icon: 'armor', ...extra });

export const ITEMS = {
  // Weapons
  dagger: W('dagger', 'Dagger', '1d4', '1d3', 2, 10, { icon: 'dagger', range: 1 }),
  shortSword: W('shortSword', 'Short Sword', '1d6', '1d8', 8, 35),
  longSword: W('longSword', 'Long Sword', '1d8', '1d12', 15, 60),
  broadSword: W('broadSword', 'Broad Sword', '2d4', '1d6+1', 10, 75),
  twoHandedSword: W('twoHandedSword', 'Two-Handed Sword', '1d10', '3d6', 30, 250, { twoHanded: true }),
  battleAxe: W('battleAxe', 'Battle Axe', '1d8', '1d8', 5, 75, { icon: 'axe' }),
  handAxe: W('handAxe', 'Hand Axe', '1d6', '1d4', 1, 50, { icon: 'axe' }),
  mace: W('mace', 'Mace', '1d6+1', '1d6', 8, 90, { icon: 'mace' }),
  flail: W('flail', 'Flail', '1d6+1', '2d4', 3, 150, { icon: 'mace' }),
  hammer: W('hammer', 'Hammer', '1d4+1', '1d4', 1, 50, { icon: 'mace' }),
  morningStar: W('morningStar', 'Morning Star', '2d4', '1d6+1', 5, 125, { icon: 'mace' }),
  club: W('club', 'Club', '1d6', '1d3', 0, 30, { icon: 'mace' }),
  staff: W('staff', 'Quarterstaff', '1d6', '1d6', 0, 50, { twoHanded: true, icon: 'staff' }),
  spear: W('spear', 'Spear', '1d6', '1d8', 1, 50, { icon: 'spear' }),
  halberd: W('halberd', 'Halberd', '1d10', '2d6', 9, 175, { twoHanded: true, icon: 'spear' }),
  shortBow: W('shortBow', 'Short Bow', '1d6', '1d6', 15, 50, { ranged: true, range: 10, ammo: 'arrows', twoHanded: true, icon: 'bow' }),
  longBow: W('longBow', 'Long Bow', '1d6', '1d6', 60, 100, { ranged: true, range: 14, ammo: 'arrows', twoHanded: true, icon: 'bow' }),
  lightCrossbow: W('lightCrossbow', 'Light Crossbow', '1d4+1', '1d6+1', 12, 50, { ranged: true, range: 12, ammo: 'quarrels', twoHanded: true, icon: 'bow' }),
  sling: W('sling', 'Sling', '1d4+1', '1d6+1', 1, 5, { ranged: true, range: 8, icon: 'sling' }),
  dart: W('dart', 'Dart', '1d3', '1d2', 1, 5, { ranged: true, range: 6, icon: 'dagger' }),
  arrows: { id: 'arrows', name: 'Arrows', type: 'ammo', cost: 1, weight: 1, qty: 20, icon: 'arrow' },
  quarrels: { id: 'quarrels', name: 'Quarrels', type: 'ammo', cost: 1, weight: 1, qty: 20, icon: 'arrow' },
  longSwordPlus1: W('longSwordPlus1', 'Long Sword +1', '1d8', '1d12', 2000, 60, { weaponGroup: 'longSword', magic: 1, unidName: 'Long Sword' }),

  // Armor (base AC)
  padded: A('padded', 'Padded Armour', 8, 4, 100),
  leather: A('leather', 'Leather Armour', 8, 5, 150),
  studdedLeather: A('studdedLeather', 'Studded Leather', 7, 15, 200, { armorGroup: 'studded' }),
  ringMail: A('ringMail', 'Ring Mail', 7, 30, 250, { armorGroup: 'ring' }),
  scaleMail: A('scaleMail', 'Scale Mail', 6, 45, 400, { armorGroup: 'scale' }),
  chainMail: A('chainMail', 'Chain Mail', 5, 75, 300, { armorGroup: 'chain' }),
  bandedMail: A('bandedMail', 'Banded Mail', 4, 90, 350, { armorGroup: 'banded' }),
  splintMail: A('splintMail', 'Splint Mail', 4, 80, 400, { armorGroup: 'splint' }),
  plateMail: A('plateMail', 'Plate Mail', 3, 400, 450, { armorGroup: 'plate' }),
  shield: { id: 'shield', name: 'Shield', type: 'shield', acBonus: 1, cost: 10, weight: 100, icon: 'shield' },
  helm: { id: 'helm', name: 'Helm', type: 'helm', acBonus: 0, cost: 10, weight: 45, icon: 'helm' },
  chainMailPlus1: A('chainMailPlus1', 'Chain Mail +1', 5, 3000, 300, { armorGroup: 'chain', magic: 1, unidName: 'Chain Mail' }),
  ringProtection1: { id: 'ringProtection1', name: 'Ring of Protection +1', unidName: 'Ring', type: 'ring', acBonus: 1, saveBonus: 1, cost: 5000, weight: 1, icon: 'ring', magic: 1 },

  // Consumables
  potionHealing: { id: 'potionHealing', name: 'Potion of Healing', unidName: 'Potion', type: 'potion', effect: 'heal:2d4+2', cost: 400, weight: 20, icon: 'potion' },
  potionExtraHealing: { id: 'potionExtraHealing', name: 'Potion of Extra Healing', unidName: 'Potion', type: 'potion', effect: 'heal:6d4', cost: 800, weight: 20, icon: 'potion' },
  scrollSleep: { id: 'scrollSleep', name: 'Scroll of Sleep', unidName: 'Scroll', type: 'scroll', effect: 'sleep', cost: 300, weight: 5, icon: 'scroll' },
  scrollCureLight: { id: 'scrollCureLight', name: 'Scroll of Cure Light Wounds', unidName: 'Scroll', type: 'scroll', effect: 'cureLightWounds', cost: 300, weight: 5, icon: 'scroll' },
  wandMagicMissile: { id: 'wandMagicMissile', name: 'Wand of Magic Missiles', unidName: 'Wand', type: 'wand', effect: 'magicMissile', charges: 20, cost: 5000, weight: 10, icon: 'wand' },
  holySymbol: { id: 'holySymbol', name: 'Holy Symbol', type: 'gear', cost: 25, weight: 1, icon: 'symbol' },
  gem: { id: 'gem', name: 'Gem', type: 'treasure', cost: 50, weight: 1, icon: 'gem' },
  jewelry: { id: 'jewelry', name: 'Jewelry', type: 'treasure', cost: 300, weight: 10, icon: 'gem' },

  // --- Expanded Phlan catalogue (world content) --------------------------------
  compositeBow: W('compositeBow', 'Composite Long Bow', '1d6', '1d6', 100, 80, { ranged: true, range: 16, ammo: 'arrows', twoHanded: true, icon: 'bow', desc: 'Horn and yew, strung with sinew. Hits harder at range than a self bow.' }),
  heavyCrossbow: W('heavyCrossbow', 'Heavy Crossbow', '1d4+2', '1d6+2', 20, 80, { ranged: true, range: 16, ammo: 'quarrels', twoHanded: true, icon: 'bow', rateOfFire: 0.5 }),
  silverDagger: W('silverDagger', 'Silver Dagger', '1d4', '1d3', 30, 10, { icon: 'dagger', weaponGroup: 'dagger', range: 1, desc: 'Silvered steel. Some things fear nothing else.' }),
  scimitar: W('scimitar', 'Scimitar', '1d8', '1d8', 15, 40, { weaponGroup: 'scimitar' }),
  trident: W('trident', 'Trident', '1d6+1', '3d4', 4, 50, { icon: 'spear', weaponGroup: 'trident' }),
  glaive: W('glaive', 'Glaive', '1d6', '1d10', 6, 75, { twoHanded: true, icon: 'spear', weaponGroup: 'glaive' }),
  daggerPlus2: W('daggerPlus2', 'Dagger +2', '1d4', '1d3', 2500, 10, { icon: 'dagger', weaponGroup: 'dagger', magic: 2, unidName: 'Dagger', range: 1 }),
  shortSwordPlus1: W('shortSwordPlus1', 'Short Sword +1', '1d6', '1d8', 1500, 35, { weaponGroup: 'shortSword', magic: 1, unidName: 'Short Sword' }),
  maceplus1: W('maceplus1', 'Mace +1', '1d6+1', '1d6', 1500, 90, { icon: 'mace', weaponGroup: 'mace', magic: 1, unidName: 'Mace' }),
  longSwordPlus2: W('longSwordPlus2', 'Long Sword +2', '1d8', '1d12', 5000, 60, { weaponGroup: 'longSword', magic: 2, unidName: 'Long Sword', desc: 'The blade of Sokol\'s castellan, bright as the day it was forged.' }),
  shieldPlus1: { id: 'shieldPlus1', name: 'Shield +1', unidName: 'Shield', type: 'shield', acBonus: 1, magic: 1, cost: 2500, weight: 50, icon: 'shield' },
  plateMailPlus1: A('plateMailPlus1', 'Plate Mail +1', 3, 5000, 450, { armorGroup: 'plate', magic: 1, unidName: 'Plate Mail' }),
  leatherPlus1: A('leatherPlus1', 'Leather Armour +1', 8, 1500, 150, { armorGroup: 'leather', magic: 1, unidName: 'Leather Armour' }),
  elfinChain: A('elfinChain', 'Elfin Chain Mail', 5, 6000, 150, { armorGroup: 'elfin', magic: 1, desc: 'Fine as silk. A mage may cast in it, the elves say, though they never say which mage.' }),

  ringProtection2: { id: 'ringProtection2', name: 'Ring of Protection +2', unidName: 'Ring', type: 'ring', acBonus: 2, saveBonus: 2, cost: 10000, weight: 1, icon: 'ring', magic: 2 },
  ringProtection3: { id: 'ringProtection3', name: 'Ring of Protection +3', unidName: 'Ring', type: 'ring', acBonus: 3, saveBonus: 3, cost: 15000, weight: 1, icon: 'ring', magic: 3 },
  ringFeatherFall: { id: 'ringFeatherFall', name: 'Ring of Feather Falling', unidName: 'Ring', type: 'ring', cost: 5000, weight: 1, icon: 'ring' },
  ringInvisibility: { id: 'ringInvisibility', name: 'Ring of Invisibility', unidName: 'Ring', type: 'ring', effect: 'invisibility', cost: 7500, weight: 1, icon: 'ring' },
  ringFireResistance: { id: 'ringFireResistance', name: 'Ring of Fire Resistance', unidName: 'Ring', type: 'ring', effect: 'resistFire', cost: 5000, weight: 1, icon: 'ring' },
  bracersAC6: { id: 'bracersAC6', name: 'Bracers of Defense AC 6', unidName: 'Bracers', type: 'bracers', acBase: 6, cost: 6000, weight: 5, icon: 'bracers' },
  bracersAC4: { id: 'bracersAC4', name: 'Bracers of Defense AC 4', unidName: 'Bracers', type: 'bracers', acBase: 4, cost: 9000, weight: 5, icon: 'bracers' },
  cloakProtection1: { id: 'cloakProtection1', name: 'Cloak of Protection +1', unidName: 'Cloak', type: 'cloak', acBonus: 1, saveBonus: 1, cost: 5000, weight: 10, icon: 'cloak' },
  cloakProtection2: { id: 'cloakProtection2', name: 'Cloak of Protection +2', unidName: 'Cloak', type: 'cloak', acBonus: 2, saveBonus: 2, cost: 9000, weight: 10, icon: 'cloak' },
  cloakDisplacement: { id: 'cloakDisplacement', name: 'Cloak of Displacement', unidName: 'Cloak', type: 'cloak', acBonus: 2, saveBonus: 2, cost: 12000, weight: 10, icon: 'cloak' },
  gauntletsOgrePower: { id: 'gauntletsOgrePower', name: 'Gauntlets of Ogre Power', unidName: 'Gauntlets', type: 'gauntlets', setStr: { str: 18, strPct: 100 }, classes: ['cleric', 'fighter', 'thief'], cost: 8000, weight: 15, icon: 'gauntlets' },
  necklaceMissiles: { id: 'necklaceMissiles', name: 'Necklace of Missiles', unidName: 'Necklace', type: 'amulet', cost: 8000, weight: 5, icon: 'amulet' },
  dustDisappearance: { id: 'dustDisappearance', name: 'Dust of Disappearance', unidName: 'Pouch of Dust', type: 'gear', cost: 4000, weight: 1, icon: 'bag' },
  manualBodilyHealth: { id: 'manualBodilyHealth', name: 'Manual of Bodily Health', unidName: 'Book', type: 'gear', cost: 30000, weight: 50, icon: 'scroll' },

  potionGiantStrength: { id: 'potionGiantStrength', name: 'Potion of Giant Strength', unidName: 'Potion', type: 'potion', effect: 'giantStrength:21', cost: 900, weight: 20, icon: 'potion' },
  potionSpeed: { id: 'potionSpeed', name: 'Potion of Speed', unidName: 'Potion', type: 'potion', effect: 'speed', cost: 800, weight: 20, icon: 'potion' },
  potionInvisibility: { id: 'potionInvisibility', name: 'Potion of Invisibility', unidName: 'Potion', type: 'potion', effect: 'invisibility', cost: 500, weight: 20, icon: 'potion' },
  potionFireResistance: { id: 'potionFireResistance', name: 'Potion of Fire Resistance', unidName: 'Potion', type: 'potion', effect: 'resistFire', cost: 400, weight: 20, icon: 'potion' },
  potionNeutralizePoison: { id: 'potionNeutralizePoison', name: 'Elixir of Neutralization', unidName: 'Potion', type: 'potion', effect: 'neutralize', cost: 300, weight: 20, icon: 'potion' },
  potionHeroism: { id: 'potionHeroism', name: 'Potion of Heroism', unidName: 'Potion', type: 'potion', effect: 'bless', cost: 500, weight: 20, icon: 'potion' },
  holyWater: { id: 'holyWater', name: 'Vial of Holy Water', type: 'potion', effect: 'protectionFromEvil', cost: 25, weight: 10, icon: 'potion', desc: 'Blessed at the altar of Tyr. Drink it, or trust it.' },

  scroll: { id: 'scroll', name: 'Magic Scroll', unidName: 'Scroll', type: 'scroll', effect: 'magicMissile', cost: 300, weight: 5, icon: 'scroll' },
  scrollProtEvil: { id: 'scrollProtEvil', name: 'Scroll of Protection from Evil', unidName: 'Scroll', type: 'scroll', effect: 'protectionFromEvil', cost: 300, weight: 5, icon: 'scroll' },
  scrollHoldPerson: { id: 'scrollHoldPerson', name: 'Scroll of Hold Person', unidName: 'Scroll', type: 'scroll', effect: 'holdPerson', cost: 600, weight: 5, icon: 'scroll' },
  scrollStinkingCloud: { id: 'scrollStinkingCloud', name: 'Scroll of Stinking Cloud', unidName: 'Scroll', type: 'scroll', effect: 'stinkingCloud', cost: 600, weight: 5, icon: 'scroll' },
  scrollFireball: { id: 'scrollFireball', name: 'Scroll of Fireball', unidName: 'Scroll', type: 'scroll', effect: 'fireball', cost: 900, weight: 5, icon: 'scroll' },
  scrollCureSerious: { id: 'scrollCureSerious', name: 'Scroll of Cure Serious Wounds', unidName: 'Scroll', type: 'scroll', effect: 'cureSeriousWounds', cost: 900, weight: 5, icon: 'scroll' },
  wandParalyzation: { id: 'wandParalyzation', name: 'Wand of Paralyzation', unidName: 'Wand', type: 'wand', effect: 'holdPerson', charges: 15, cost: 7000, weight: 10, icon: 'wand' },
  wandFire: { id: 'wandFire', name: 'Wand of Fire', unidName: 'Wand', type: 'wand', effect: 'fireball', charges: 12, cost: 9000, weight: 10, icon: 'wand' },
  wandLightning: { id: 'wandLightning', name: 'Wand of Lightning', unidName: 'Wand', type: 'wand', effect: 'lightningBolt', charges: 12, cost: 9000, weight: 10, icon: 'wand' },
  wandSleep: { id: 'wandSleep', name: 'Wand of Sleep', unidName: 'Wand', type: 'wand', effect: 'sleep', charges: 20, cost: 4500, weight: 10, icon: 'wand' },

  // Quest items (no resale value)
  mendorHistory: { id: 'mendorHistory', name: 'Mendor\'s History of Phlan', type: 'gear', cost: 0, weight: 60, icon: 'scroll', quest: true, desc: 'A heavy folio bound in green leather, its clasp shaped like an open eye.' },
  cadornaStrongbox: { id: 'cadornaStrongbox', name: 'Cadorna Strongbox', type: 'gear', cost: 0, weight: 300, icon: 'bag', quest: true, desc: 'Sealed with a spindle and a crown. Something inside shifts when it is moved.' },
  bronzeKey: { id: 'bronzeKey', name: 'Bronze Key', type: 'gear', cost: 0, weight: 1, icon: 'bag', quest: true, desc: 'Green with age, stamped with the sigil of Sokol Keep.' },
  blackHandSigil: { id: 'blackHandSigil', name: 'Sigil of the Black Hand', type: 'gear', cost: 0, weight: 2, icon: 'symbol', quest: true, desc: 'A black iron hand, fingers spread, cold to the touch.' },
};

/** @param {string} id @returns {import('./schema.js').ItemDef} */
export function getItem(id) {
  const it = ITEMS[id];
  if (!it) throw new Error(`Unknown item "${id}"`);
  return it;
}

/** Starting kit by primary class (used by quick-start parties & char creation). */
export const STARTING_KITS = {
  fighter: ['longSword', 'shield', 'chainMail', 'shortBow', 'arrows'],
  cleric: ['mace', 'shield', 'chainMail', 'holySymbol'],
  magicUser: ['staff', 'dagger'],
  thief: ['shortSword', 'leather', 'sling'],
};
