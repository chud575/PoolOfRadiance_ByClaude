/** Seed monster table (1e Monster Manual stats, PoR flavour). See schema.js MonsterDef. */
const M = (id, name, o) => ({ id, name, plural: o.plural ?? `${name}s`, size: 'M', morale: 50, alignment: 'CE', special: [], sprite: id, ...o });

export const MONSTERS = {
  kobold: M('kobold', 'Kobold', { hd: 0.5, ac: 7, thac0: 20, move: 6, attacks: ['1d4'], xp: 7, size: 'S', morale: 40, alignment: 'LE', desc: 'Small, cowardly, dog-faced reptilian humanoids.' }),
  goblin: M('goblin', 'Goblin', { hd: 1, hpBonus: -1, ac: 6, thac0: 20, move: 6, attacks: ['1d6'], xp: 10, size: 'S', morale: 45, alignment: 'LE' }),
  orc: M('orc', 'Orc', { hd: 1, ac: 6, thac0: 19, move: 9, attacks: ['1d8'], xp: 15, morale: 50, alignment: 'LE' }),
  hobgoblin: M('hobgoblin', 'Hobgoblin', { hd: 1, hpBonus: 1, ac: 5, thac0: 18, move: 9, attacks: ['1d8'], xp: 20, morale: 60, alignment: 'LE' }),
  gnoll: M('gnoll', 'Gnoll', { hd: 2, ac: 5, thac0: 16, move: 9, attacks: ['2d4'], xp: 28, size: 'L', morale: 55 }),
  giantRat: M('giantRat', 'Giant Rat', { hd: 0.5, ac: 7, thac0: 20, move: 12, attacks: ['1d3'], xp: 7, size: 'S', morale: 30, alignment: 'N', special: ['disease'] }),
  skeleton: M('skeleton', 'Skeleton', { hd: 1, ac: 7, thac0: 19, move: 12, attacks: ['1d6'], xp: 14, morale: 100, alignment: 'N', special: ['undead', 'mindless', 'halfEdged'], turnAs: 'skeleton' }),
  zombie: M('zombie', 'Zombie', { hd: 2, ac: 8, thac0: 16, move: 6, attacks: ['1d8'], xp: 28, morale: 100, alignment: 'N', special: ['undead', 'mindless', 'slow'], turnAs: 'zombie' }),
  ghoul: M('ghoul', 'Ghoul', { hd: 2, ac: 6, thac0: 16, move: 9, attacks: ['1d3', '1d3', '1d6'], xp: 65, morale: 100, special: ['undead', 'paralyze'], turnAs: 'ghoul' }),
  bugbear: M('bugbear', 'Bugbear', { hd: 3, hpBonus: 1, ac: 5, thac0: 16, move: 9, attacks: ['2d4'], xp: 60, size: 'L', morale: 65 }),
  lizardMan: M('lizardMan', 'Lizard Man', { hd: 2, hpBonus: 1, ac: 5, thac0: 16, move: 6, attacks: ['1d2', '1d2', '1d8'], xp: 35, plural: 'Lizard Men', alignment: 'N' }),
  ogre: M('ogre', 'Ogre', { hd: 4, hpBonus: 1, ac: 5, thac0: 15, move: 9, attacks: ['1d10'], xp: 90, size: 'L', morale: 70 }),
  troll: M('troll', 'Troll', { hd: 6, hpBonus: 6, ac: 4, thac0: 13, move: 12, attacks: ['1d4+4', '1d4+4', '2d6'], xp: 525, size: 'L', morale: 90, special: ['regenerate:3'] }),
  buccaneer: M('buccaneer', 'Buccaneer', { hd: 1, ac: 7, thac0: 20, move: 12, attacks: ['1d6'], xp: 10, morale: 50, alignment: 'CN' }),
  thug: M('thug', 'Thug', { hd: 1, ac: 8, thac0: 20, move: 12, attacks: ['1d4'], xp: 10, morale: 40, alignment: 'NE' }),
  giantSpider: M('giantSpider', 'Giant Spider', { hd: 4, hpBonus: 4, ac: 4, thac0: 15, move: 12, attacks: ['2d4'], xp: 185, size: 'L', morale: 70, alignment: 'CE', special: ['poison'] }),
};

/** @param {string} id */
export function getMonster(id) {
  const m = MONSTERS[id];
  if (!m) throw new Error(`Unknown monster "${id}"`);
  return m;
}
