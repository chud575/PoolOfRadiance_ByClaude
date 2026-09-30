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
  lightCrossbow: W('lightCrossbow', 'Light Crossbow', '1d4+1', '1d4+1', 12, 50, { ranged: true, range: 12, ammo: 'quarrels', twoHanded: true, icon: 'bow' }),
  sling: W('sling', 'Sling', '1d4+1', '1d6+1', 1, 5, { ranged: true, range: 8, icon: 'sling' }),
  dart: W('dart', 'Dart', '1d3', '1d2', 1, 5, { ranged: true, range: 6, icon: 'dagger' }),
  arrows: { id: 'arrows', name: 'Arrows', type: 'ammo', cost: 1, weight: 1, qty: 20, icon: 'arrow' },
  quarrels: { id: 'quarrels', name: 'Quarrels', type: 'ammo', cost: 1, weight: 1, qty: 20, icon: 'arrow' },
  longSwordPlus1: W('longSwordPlus1', 'Long Sword +1', '1d8', '1d12', 2000, 60, { weaponGroup: 'longSword', magic: 1, unidName: 'Long Sword' }),

  // Armor (base AC)
  padded: A('padded', 'Padded Armor', 8, 4, 100),
  leather: A('leather', 'Leather Armor', 8, 5, 150),
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
