/**
 * Prebuilt test parties (used by ?party= and quick start). Abilities are fixed
 * so screenshots are deterministic. `look.seed` pins each hero's portrait, so the
 * same character looks the same in every fixture party (shop, temple, roster). Member fields feed rules/character.createCharacter.
 */
export const PARTIES = {
  default: {
    name: 'Heroes of Phlan',
    members: [
      { name: 'Taran', look: { seed: 786746451 }, race: 'human', classSpec: 'fighter', gender: 'male', alignment: 'LG', abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 } },
      { name: 'Brother Aldric', look: { seed: 880897263 }, race: 'human', classSpec: 'cleric', gender: 'male', alignment: 'LG', abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 } },
      { name: 'Ilyra', look: { seed: 330305840 }, race: 'elf', classSpec: 'fighter/magicUser', gender: 'female', alignment: 'CG', abilities: { str: 15, strPct: 0, int: 17, wis: 10, dex: 17, con: 13, cha: 14 }, items: ['longSword', 'dagger'] },
      { name: 'Durgin', look: { seed: 701400183 }, race: 'dwarf', classSpec: 'fighter', gender: 'male', alignment: 'LN', abilities: { str: 17, strPct: 0, int: 9, wis: 12, dex: 12, con: 18, cha: 7 }, items: ['battleAxe', 'shield', 'chainMail'] },
      { name: 'Pip', look: { seed: 682816697 }, race: 'halfling', classSpec: 'fighter/thief', gender: 'male', alignment: 'NG', abilities: { str: 14, strPct: 0, int: 12, wis: 9, dex: 18, con: 14, cha: 12 }, items: ['shortSword', 'leather', 'sling'] },
      { name: 'Meralda', look: { seed: 564284888 }, race: 'halfElf', classSpec: 'magicUser', gender: 'female', alignment: 'NG', abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
    ],
  },
  wounded: {
    name: 'Battered Party',
    members: [
      { name: 'Taran', look: { seed: 786746451 }, race: 'human', classSpec: 'fighter', gender: 'male', alignment: 'LG', abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 }, hpCur: 3 },
      { name: 'Brother Aldric', look: { seed: 880897263 }, race: 'human', classSpec: 'cleric', gender: 'male', alignment: 'LG', abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 }, hpCur: 0, status: 'unconscious' },
      { name: 'Meralda', look: { seed: 564284888 }, race: 'halfElf', classSpec: 'magicUser', gender: 'female', alignment: 'NG', abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
    ],
  },
  // the full company of six after a hard fight (temple screens show every member's state)
  battered: {
    name: 'Battered Company',
    members: [
      { name: 'Taran', look: { seed: 786746451 }, race: 'human', classSpec: 'fighter', gender: 'male', alignment: 'LG', abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 }, hpCur: 3 },
      { name: 'Brother Aldric', look: { seed: 880897263 }, race: 'human', classSpec: 'cleric', gender: 'male', alignment: 'LG', abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 }, hpCur: 0, status: 'unconscious' },
      { name: 'Ilyra', look: { seed: 330305840 }, race: 'elf', classSpec: 'fighter/magicUser', gender: 'female', alignment: 'CG', abilities: { str: 15, strPct: 0, int: 17, wis: 10, dex: 17, con: 13, cha: 14 }, items: ['longSword', 'dagger'], hpCur: 4 },
      { name: 'Durgin', look: { seed: 701400183 }, race: 'dwarf', classSpec: 'fighter', gender: 'male', alignment: 'LN', abilities: { str: 17, strPct: 0, int: 9, wis: 12, dex: 12, con: 18, cha: 7 }, items: ['battleAxe', 'shield', 'chainMail'], hpCur: 6 },
      { name: 'Pip', look: { seed: 682816697 }, race: 'halfling', classSpec: 'fighter/thief', gender: 'male', alignment: 'NG', abilities: { str: 14, strPct: 0, int: 12, wis: 9, dex: 18, con: 14, cha: 12 }, items: ['shortSword', 'leather', 'sling'] },
      { name: 'Meralda', look: { seed: 564284888 }, race: 'halfElf', classSpec: 'magicUser', gender: 'female', alignment: 'NG', abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
    ],
  },
  veterans: {
    name: 'Veterans (level 5)',
    members: [
      { name: 'Taran', look: { seed: 786746451 }, race: 'human', classSpec: 'fighter', gender: 'male', alignment: 'LG', level: 5, abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 }, items: ['longSwordPlus1', 'shield', 'plateMail'] },
      { name: 'Brother Aldric', look: { seed: 880897263 }, race: 'human', classSpec: 'cleric', gender: 'male', alignment: 'LG', level: 5, abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 } },
      { name: 'Meralda', look: { seed: 564284888 }, race: 'halfElf', classSpec: 'magicUser', gender: 'female', alignment: 'NG', level: 5, abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
      { name: 'Pip', look: { seed: 682816697 }, race: 'halfling', classSpec: 'fighter/thief', gender: 'male', alignment: 'NG', level: 4, abilities: { str: 14, strPct: 0, int: 12, wis: 9, dex: 18, con: 14, cha: 12 }, items: ['shortSword', 'leather', 'sling'] },
    ],
  },
};
