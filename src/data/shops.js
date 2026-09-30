/** Shops, temples and training halls of Civilized Phlan. */
export const SHOPS = {
  phlan_armory: {
    id: 'phlan_armory',
    name: "Roland's Arms & Armour",
    kind: 'shop',
    keeper: 'Roland the Smith',
    greeting: 'Steel for the brave, and leather for the wise. What will it be?',
    stock: ['dagger', 'shortSword', 'longSword', 'broadSword', 'battleAxe', 'mace', 'flail', 'staff', 'spear', 'shortBow', 'longBow', 'arrows', 'sling', 'leather', 'studdedLeather', 'ringMail', 'scaleMail', 'chainMail', 'bandedMail', 'plateMail', 'shield', 'helm'],
    markup: 1,
  },
  temple_tyr: {
    id: 'temple_tyr',
    name: 'Temple of Tyr',
    kind: 'temple',
    keeper: 'High Priest Ohlo',
    greeting: 'Tyr the Even-Handed offers his blessing — for a tithe.',
    services: { cureLight: 100, cureSerious: 350, cureCritical: 600, raiseDead: 5500, removeCurse: 3500 },
    stock: ['potionHealing', 'scrollCureLight', 'holySymbol'],
    markup: 1.2,
  },
  training_hall: {
    id: 'training_hall',
    name: 'Training Hall',
    kind: 'training',
    keeper: 'Weaponsmaster Garrick',
    greeting: 'Prove your worth and I shall teach you what I know.',
    cost: 1000,
  },
};
