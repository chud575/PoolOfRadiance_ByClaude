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
  // --- Pool of Radiance roster (world content) ---------------------------------
  // `sprite` names the closest existing combat species for renderers that key on it.
  koboldChief: M('koboldChief', 'Kobold Chieftain', { hd: 1, hpBonus: 3, ac: 5, thac0: 19, move: 6, attacks: ['1d8'], xp: 35, size: 'S', morale: 60, alignment: 'LE', sprite: 'kobold', desc: 'Grey-scaled and toothless, and far more cunning than his kin.' }),
  orcLeader: M('orcLeader', 'Orc Leader', { hd: 2, hpBonus: 2, ac: 4, thac0: 16, move: 9, attacks: ['1d10'], xp: 45, morale: 65, alignment: 'LE', sprite: 'orc', treasure: 'L' }),
  hobgoblinChief: M('hobgoblinChief', 'Hobgoblin Chief', { hd: 3, hpBonus: 3, ac: 3, thac0: 16, move: 9, attacks: ['1d10'], xp: 85, morale: 75, alignment: 'LE', sprite: 'hobgoblin', treasure: 'M' }),
  bandit: M('bandit', 'Bandit', { hd: 1, ac: 7, thac0: 20, move: 12, attacks: ['1d6'], xp: 12, morale: 45, alignment: 'NE', sprite: 'thug' }),
  banditLeader: M('banditLeader', 'Bandit Captain', { hd: 3, ac: 5, thac0: 18, move: 12, attacks: ['1d8+1'], xp: 60, morale: 60, alignment: 'NE', sprite: 'buccaneer', treasure: 'M' }),
  acolyte: M('acolyte', 'Acolyte of Bane', { hd: 1, ac: 6, thac0: 20, move: 9, attacks: ['1d6+1'], xp: 20, morale: 60, alignment: 'LE', sprite: 'thug', special: ['spells:cleric1'], desc: 'Novices of the Black Lord in soot-black robes.' }),
  banePriest: M('banePriest', 'Priest of Bane', { hd: 5, ac: 3, thac0: 18, move: 9, attacks: ['1d6+1'], xp: 300, morale: 80, alignment: 'LE', sprite: 'human', special: ['spells:cleric3'], treasure: 'M' }),
  shadow: M('shadow', 'Shadow', { hd: 3, hpBonus: 3, ac: 7, thac0: 16, move: 12, attacks: ['1d4+1'], xp: 175, morale: 100, alignment: 'CE', special: ['undead', 'drainStr', 'magicToHit:1'], turnAs: 'shadow', sprite: 'zombie' }),
  wight: M('wight', 'Wight', { hd: 4, hpBonus: 3, ac: 5, thac0: 15, move: 12, attacks: ['1d4'], xp: 540, morale: 100, alignment: 'LE', special: ['undead', 'drainLevel', 'silverToHit'], turnAs: 'wight', sprite: 'ghoul' }),
  ghast: M('ghast', 'Ghast', { hd: 4, ac: 4, thac0: 15, move: 15, attacks: ['1d4', '1d4', '1d8'], xp: 190, morale: 100, alignment: 'CE', special: ['undead', 'paralyze', 'stench'], turnAs: 'ghast', sprite: 'ghoul' }),
  spectre: M('spectre', 'Spectre', { hd: 7, hpBonus: 3, ac: 2, thac0: 13, move: 15, attacks: ['1d8'], xp: 1500, morale: 100, alignment: 'LE', special: ['undead', 'drainLevel', 'magicToHit:1'], turnAs: 'spectre', sprite: 'zombie' }),
  hillGiant: M('hillGiant', 'Hill Giant', { hd: 8, hpBonus: 2, ac: 4, thac0: 12, move: 12, attacks: ['2d8'], xp: 1400, size: 'L', morale: 80, alignment: 'CE', sprite: 'ogre', special: ['throwRocks'], treasure: 'D' }),
  wolf: M('wolf', 'Wolf', { hd: 2, hpBonus: 2, ac: 7, thac0: 16, move: 18, attacks: ['2d4'], xp: 35, morale: 50, alignment: 'N', sprite: 'giantRat' }),
  giantFrog: M('giantFrog', 'Giant Frog', { hd: 2, ac: 7, thac0: 16, move: 9, attacks: ['1d6'], xp: 40, morale: 40, alignment: 'N', sprite: 'giantRat', desc: 'Pale, bloated and patient, it lives at the bottom of Kuto\'s Well.' }),
  giantCentipede: M('giantCentipede', 'Giant Centipede', { hd: 0.5, ac: 9, thac0: 20, move: 15, attacks: ['1d2'], xp: 30, size: 'S', morale: 30, alignment: 'N', special: ['poison'], sprite: 'giantSpider' }),
  tyranthraxus: M('tyranthraxus', 'Tyranthraxus', { hd: 12, hpBonus: 20, ac: 0, thac0: 9, move: 9, attacks: ['1d8', '1d8', '4d6'], xp: 8000, size: 'L', morale: 100, alignment: 'CE', special: ['breath:lightning', 'fear', 'magicResist:20'], sprite: 'troll', treasure: 'H', desc: 'The Flamed One, wearing the body of a great bronze dragon.' }),
};

/** @param {string} id */
export function getMonster(id) {
  const m = MONSTERS[id];
  if (!m) throw new Error(`Unknown monster "${id}"`);
  return m;
}
