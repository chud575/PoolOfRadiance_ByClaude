/** Seed monster table (1e Monster Manual stats, PoR flavour). See schema.js MonsterDef. */
const M = (id, name, o) => ({ id, name, plural: o.plural ?? `${name}s`, size: 'M', morale: 50, alignment: 'CE', special: [], sprite: id, ...o });

export const MONSTERS = {
  kobold: M('kobold', 'Kobold', { hd: 0.5, ac: 7, thac0: 20, move: 6, attacks: ['1d4'], xp: 7, size: 'S', morale: 40, alignment: 'LE', desc: 'Small, cowardly, dog-faced reptilian humanoids.' }),
  goblin: M('goblin', 'Goblin', { desc: 'Sallow, flat-faced raiders who hate the sun and anything taller than they are.', hd: 1, hpBonus: -1, ac: 6, thac0: 20, move: 6, attacks: ['1d6'], xp: 10, size: 'S', morale: 45, alignment: 'LE' }),
  orc: M('orc', 'Orc', { desc: 'Pig-snouted brutes of the Moonsea hills, loud, greedy and quick to the axe.', hd: 1, ac: 6, thac0: 19, move: 9, attacks: ['1d8'], xp: 15, morale: 50, alignment: 'LE' }),
  hobgoblin: M('hobgoblin', 'Hobgoblin', { desc: 'Disciplined, rust-skinned soldiers who march in step and kill by drill.', hd: 1, hpBonus: 1, ac: 5, thac0: 18, move: 9, attacks: ['1d8'], xp: 20, morale: 60, alignment: 'LE' }),
  gnoll: M('gnoll', 'Gnoll', { desc: 'Hyena-headed giants that laugh as they hunt and eat what they kill.', hd: 2, ac: 5, thac0: 16, move: 9, attacks: ['2d4'], xp: 28, size: 'L', morale: 55 }),
  giantRat: M('giantRat', 'Giant Rat', { desc: 'Dog-sized rats from the sewers, bold in packs, carriers of the wasting fever.', hd: 0.5, ac: 7, thac0: 20, move: 12, attacks: ['1d3'], xp: 7, size: 'S', morale: 30, alignment: 'N', special: ['disease'] }),
  skeleton: M('skeleton', 'Skeleton', { desc: 'Bones stripped clean and bound by a will not their own. They do not tire or flee.', hd: 1, ac: 7, thac0: 19, move: 12, attacks: ['1d6'], xp: 14, morale: 100, alignment: 'N', special: ['undead', 'mindless', 'halfEdged'], turnAs: 'skeleton' }),
  zombie: M('zombie', 'Zombie', { desc: 'Slow, rotting dead that shamble on long after reason has left them.', hd: 2, ac: 8, thac0: 16, move: 6, attacks: ['1d8'], xp: 28, morale: 100, alignment: 'N', special: ['undead', 'mindless', 'slow'], turnAs: 'zombie' }),
  ghoul: M('ghoul', 'Ghoul', { desc: 'Grave-eaters whose claws bring a numbing paralysis. Elves alone shrug it off.', hd: 2, ac: 6, thac0: 16, move: 9, attacks: ['1d3', '1d3', '1d6'], xp: 65, morale: 100, special: ['undead', 'paralyze'], turnAs: 'ghoul' }),
  bugbear: M('bugbear', 'Bugbear', { desc: 'Hairy, hulking goblin-kin that move with uncanny quiet for their size.', hd: 3, hpBonus: 1, ac: 5, thac0: 16, move: 9, attacks: ['2d4'], xp: 60, size: 'L', morale: 65 }),
  lizardMan: M('lizardMan', 'Lizard Man', { desc: 'Scaled marsh-dwellers with club, claw and bite, cold of blood and temper.', hd: 2, hpBonus: 1, ac: 5, thac0: 16, move: 6, attacks: ['1d2', '1d2', '1d8'], xp: 35, plural: 'Lizard Men', alignment: 'N' }),
  ogre: M('ogre', 'Ogre', { desc: 'Ten feet of hunger and spite, swinging a club the size of a man.', hd: 4, hpBonus: 1, ac: 5, thac0: 15, move: 9, attacks: ['1d10'], xp: 90, size: 'L', morale: 70 }),
  troll: M('troll', 'Troll', { desc: 'Rubbery, green and ravenous. Its wounds close as you watch; only fire ends it.', hd: 6, hpBonus: 6, ac: 4, thac0: 13, move: 12, attacks: ['1d4+4', '1d4+4', '2d6'], xp: 525, size: 'L', morale: 90, special: ['regenerate:3'] }),
  buccaneer: M('buccaneer', 'Buccaneer', { desc: 'Moonsea river-pirates, cutlass in hand, who sell anything that floats.', hd: 1, ac: 7, thac0: 20, move: 12, attacks: ['1d6'], xp: 10, morale: 50, alignment: 'CN' }),
  thug: M('thug', 'Thug', { desc: 'Hired knives of the Slums, cheap, mean and loyal to the last coin.', hd: 1, ac: 8, thac0: 20, move: 12, attacks: ['1d4'], xp: 10, morale: 40, alignment: 'NE' }),
  giantSpider: M('giantSpider', 'Giant Spider', { desc: 'A bloated hunter of the dark places whose bite carries a deadly venom.', hd: 4, hpBonus: 4, ac: 4, thac0: 15, move: 12, attacks: ['2d4'], xp: 185, size: 'L', morale: 70, alignment: 'CE', special: ['poison'] }),
  // --- Pool of Radiance roster (world content) ---------------------------------
  // `sprite` names the closest existing combat species for renderers that key on it.
  koboldChief: M('koboldChief', 'Kobold Chieftain', { hd: 1, hpBonus: 3, ac: 5, thac0: 19, move: 6, attacks: ['1d8'], xp: 35, size: 'S', morale: 60, alignment: 'LE', sprite: 'kobold', desc: 'Grey-scaled and toothless, and far more cunning than his kin.' }),
  orcLeader: M('orcLeader', 'Orc Leader', { desc: 'A scarred orc chieftain who rules his band by strength alone.', hd: 2, hpBonus: 2, ac: 4, thac0: 16, move: 9, attacks: ['1d10'], xp: 45, morale: 65, alignment: 'LE', sprite: 'orc', treasure: 'L' }),
  hobgoblinChief: M('hobgoblinChief', 'Hobgoblin Chief', { desc: 'A hobgoblin warlord in blackened plate, iron-voiced and merciless.', hd: 3, hpBonus: 3, ac: 3, thac0: 16, move: 9, attacks: ['1d10'], xp: 85, morale: 75, alignment: 'LE', sprite: 'hobgoblin', treasure: 'M' }),
  bandit: M('bandit', 'Bandit', { desc: 'Desperate men of the ruins who prey on the weak and flee the strong.', hd: 1, ac: 7, thac0: 20, move: 12, attacks: ['1d6'], xp: 12, morale: 45, alignment: 'NE', sprite: 'thug' }),
  banditLeader: M('banditLeader', 'Bandit Captain', { desc: 'A cunning outlaw captain who knows every alley and every price.', hd: 3, ac: 5, thac0: 18, move: 12, attacks: ['1d8+1'], xp: 60, morale: 60, alignment: 'NE', sprite: 'buccaneer', treasure: 'M' }),
  acolyte: M('acolyte', 'Acolyte of Bane', { hd: 1, ac: 6, thac0: 20, move: 9, attacks: ['1d6+1'], xp: 20, morale: 60, alignment: 'LE', sprite: 'thug', special: ['spells:cleric1'], desc: 'Novices of the Black Lord in soot-black robes.' }),
  banePriest: M('banePriest', 'Priest of Bane', { desc: 'A black-robed servant of the Black Lord, cruel of word and dark of spell.', hd: 5, ac: 3, thac0: 18, move: 9, attacks: ['1d6+1'], xp: 300, morale: 80, alignment: 'LE', sprite: 'human', special: ['spells:cleric3'], treasure: 'M' }),
  shadow: M('shadow', 'Shadow', { desc: 'A living darkness that drinks the strength from those it touches.', hd: 3, hpBonus: 3, ac: 7, thac0: 16, move: 12, attacks: ['1d4+1'], xp: 175, morale: 100, alignment: 'CE', special: ['undead', 'drainStr', 'magicToHit:1'], turnAs: 'shadow', sprite: 'zombie' }),
  wight: M('wight', 'Wight', { desc: 'A barrow-dead whose cold touch drains the very life from the living.', hd: 4, hpBonus: 3, ac: 5, thac0: 15, move: 12, attacks: ['1d4'], xp: 540, morale: 100, alignment: 'LE', special: ['undead', 'drainLevel', 'silverToHit'], turnAs: 'wight', sprite: 'ghoul' }),
  ghast: M('ghast', 'Ghast', { desc: "A ghoul's elder kin, wreathed in a stench of the charnel house.", hd: 4, ac: 4, thac0: 15, move: 15, attacks: ['1d4', '1d4', '1d8'], xp: 190, morale: 100, alignment: 'CE', special: ['undead', 'paralyze', 'stench'], turnAs: 'ghast', sprite: 'ghoul' }),
  spectre: M('spectre', 'Spectre', { desc: 'A lordly phantom of terrible hunger, its touch draining two lifetimes at once.', hd: 7, hpBonus: 3, ac: 2, thac0: 13, move: 15, attacks: ['1d8'], xp: 1500, morale: 100, alignment: 'LE', special: ['undead', 'drainLevel', 'magicToHit:1'], turnAs: 'spectre', sprite: 'zombie' }),
  hillGiant: M('hillGiant', 'Hill Giant', { desc: 'A dull, savage giant who hurls boulders and crushes whatever it grasps.', hd: 8, hpBonus: 2, ac: 4, thac0: 12, move: 12, attacks: ['2d8'], xp: 1400, size: 'L', morale: 80, alignment: 'CE', sprite: 'ogre', special: ['throwRocks'], treasure: 'D' }),
  wolf: M('wolf', 'Wolf', { desc: 'Grey hunters of the wilds, running in packs and circling the weakest.', hd: 2, hpBonus: 2, ac: 7, thac0: 16, move: 18, attacks: ['2d4'], xp: 35, morale: 50, alignment: 'N', sprite: 'giantRat' }),
  giantFrog: M('giantFrog', 'Giant Frog', { hd: 2, ac: 7, thac0: 16, move: 9, attacks: ['1d6'], xp: 40, morale: 40, alignment: 'N', sprite: 'giantRat', desc: 'Pale, bloated and patient, it lives at the bottom of Kuto\'s Well.' }),
  giantCentipede: M('giantCentipede', 'Giant Centipede', { desc: 'A yard of chitin and legs, its weak venom saps the limbs.', hd: 0.5, ac: 9, thac0: 20, move: 15, attacks: ['1d2'], xp: 30, size: 'S', morale: 30, alignment: 'N', special: ['poison'], sprite: 'giantSpider' }),
  tyranthraxus: M('tyranthraxus', 'Tyranthraxus', { hd: 12, hpBonus: 20, ac: 0, thac0: 9, move: 9, attacks: ['1d8', '1d8', '4d6'], xp: 8000, size: 'L', morale: 100, alignment: 'CE', special: ['breath:lightning', 'fear', 'magicResist:20'], sprite: 'troll', treasure: 'H', desc: 'The Flamed One, wearing the body of a great bronze dragon.' }),
};

/** @param {string} id */
export function getMonster(id) {
  const m = MONSTERS[id];
  if (!m) throw new Error(`Unknown monster "${id}"`);
  return m;
}
