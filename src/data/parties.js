/**
 * Prebuilt test parties (used by ?party= and quick start). Abilities are fixed
 * so screenshots are deterministic. Member fields feed rules/character.createCharacter.
 */
export const PARTIES = {
  default: {
    name: 'Heroes of Phlan',
    members: [
      { name: 'Taran', race: 'human', classSpec: 'fighter', gender: 'male', alignment: 'LG', abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 } },
      { name: 'Brother Aldric', race: 'human', classSpec: 'cleric', gender: 'male', alignment: 'LG', abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 } },
      { name: 'Ilyra', race: 'elf', classSpec: 'fighter/magicUser', gender: 'female', alignment: 'CG', abilities: { str: 15, strPct: 0, int: 17, wis: 10, dex: 17, con: 13, cha: 14 }, items: ['longSword', 'dagger'] },
      { name: 'Durgin', race: 'dwarf', classSpec: 'fighter', gender: 'male', alignment: 'LN', abilities: { str: 17, strPct: 0, int: 9, wis: 12, dex: 12, con: 18, cha: 7 }, items: ['battleAxe', 'shield', 'chainMail'] },
      { name: 'Pip', race: 'halfling', classSpec: 'fighter/thief', gender: 'male', alignment: 'NG', abilities: { str: 14, strPct: 0, int: 12, wis: 9, dex: 18, con: 14, cha: 12 }, items: ['shortSword', 'leather', 'sling'] },
      { name: 'Meralda', race: 'halfElf', classSpec: 'magicUser', gender: 'female', alignment: 'NG', abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
    ],
  },
  wounded: {
    name: 'Battered Party',
    members: [
      { name: 'Taran', race: 'human', classSpec: 'fighter', abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 }, hpCur: 3 },
      { name: 'Brother Aldric', race: 'human', classSpec: 'cleric', abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 }, hpCur: 0, status: 'unconscious' },
      { name: 'Meralda', race: 'halfElf', classSpec: 'magicUser', abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
    ],
  },
  veterans: {
    name: 'Veterans (level 5)',
    members: [
      { name: 'Taran', race: 'human', classSpec: 'fighter', level: 5, abilities: { str: 18, strPct: 76, int: 10, wis: 11, dex: 15, con: 17, cha: 12 }, items: ['longSwordPlus1', 'shield', 'plateMail'] },
      { name: 'Brother Aldric', race: 'human', classSpec: 'cleric', level: 5, abilities: { str: 14, strPct: 0, int: 11, wis: 17, dex: 10, con: 15, cha: 13 } },
      { name: 'Meralda', race: 'halfElf', classSpec: 'magicUser', level: 5, abilities: { str: 8, strPct: 0, int: 18, wis: 13, dex: 16, con: 12, cha: 15 } },
      { name: 'Pip', race: 'halfling', classSpec: 'fighter/thief', level: 4, abilities: { str: 14, strPct: 0, int: 12, wis: 9, dex: 18, con: 14, cha: 12 }, items: ['shortSword', 'leather', 'sling'] },
    ],
  },
};
