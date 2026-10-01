/**
 * The Adventurer's Journal. In the 1988 original, long passages were printed
 * in a booklet and the game simply said "See Journal Entry 12". Here the
 * journal lives in-game: when an event references an entry, it is added to
 * the party's journal (game.flags.journal) and can be read at any time.
 *
 * All prose is original to this homage. As in the booklet, a few entries are
 * false leads, never referenced by any event (`false: true`) — they appear in
 * the complete journal only, to reward (and mislead) the curious.
 *
 * @typedef {Object} JournalEntry
 * @property {number} n
 * @property {string} title
 * @property {string} [where]    where the entry is found (shown under the title)
 * @property {string[]} text     paragraphs
 * @property {boolean} [false]
 */

/** @type {JournalEntry[]} */
export const JOURNAL = [
  {
    n: 1, title: 'The Voyage to Phlan', where: 'Aboard the Grey Gull',
    text: [
      'For three days the ship has beaten north across the Moonsea against a wind that smells of snow. The other passengers are sellswords and speculators, and every one of them has the same notice folded in a pocket: the Council of New Phlan pays in gold for the brave.',
      'At dawn the city rises out of the mist — a crescent of wharves and new timber walls, and behind them, grey and broken, the drowned bones of the old city. Smoke rises from only one of them.',
    ],
  },
  {
    n: 2, title: 'Arrival', where: 'The Docks of New Phlan',
    text: [
      'A guard with a tired face checks your names against a slate. "Adventurers," he says, not asking. "City Hall is up the hill. Get your commission before you get yourselves killed; the Council doesn\'t pay for corpses it didn\'t hire."',
      'Behind him a crier reads the day\'s proclamations to nobody. Past the palisade a bell tolls — once for every patrol that failed to return.',
    ],
  },
  {
    n: 3, title: 'The Council Chamber', where: 'City Hall',
    text: [
      'The hall is cold and too large for the handful of clerks who work in it. Faded banners of the old city hang above the dais, and beneath them a board of proclamations is crowded with nailed notices, most of them bounties.',
      'The Clerk looks up from his ledger. "New names. Good. The Council has more work than it has living hands. Read the proclamations, take a commission, and come back with proof. The Council keeps its word — it is the only thing in Phlan still standing that was built to last."',
    ],
  },
  {
    n: 4, title: 'Proclamation of the Council', where: 'City Hall',
    text: [
      'BE IT KNOWN that the Council of New Phlan, sitting in lawful session, offers reward to any company of good repute that shall reclaim a block of the old city from the monsters that hold it.',
      'Such reward shall be paid at City Hall upon proof of the deed. The Council takes no responsibility for the dead, the missing, or the cursed. Looting of the ruins is permitted; looting of the living is hanged.',
    ],
  },
  {
    n: 5, title: 'The Slums', where: 'Commission of the Council',
    text: [
      'The Slums were the first district to fall and are the nearest to the new walls. Kobolds and worse nest in the collapsed tenements, and something has been dragging the watch\'s dead away at night.',
      'Clear the block. Burn what cannot be cleaned. Report any survivors — the Council would dearly like to know how anyone survives out there.',
    ],
  },
  {
    n: 6, title: 'Sokol Keep', where: 'Commission of the Council',
    text: [
      'The island fortress of Sokol Keep once guarded the harbour. Its garrison was lost in a single night, and now lights move on its walls when there is no moon. No ship will anchor in its shadow.',
      'The Council wishes the Keep scoured and its beacon relit. Boats may be hired at the docks. Take holy water. Take more than you think you need.',
    ],
  },
  {
    n: 7, title: 'The Ghost of the Castellan', where: 'Sokol Keep chapel',
    text: [
      'He stands before the broken altar with his sword reversed, as knights keep vigil. When he turns, you see the lamplight through him.',
      '"I am Ferran Martinez, castellan of this keep. I held the gate until dawn, and at dawn I learned that the gate had never been the danger. Something beneath the old city calls to the dead, and they rise and walk towards it. Find what calls. End it. Then, perhaps, my men and I may rest."',
    ],
  },
  {
    n: 8, title: 'Kuto\'s Well', where: 'Rumour, the Gilded Tankard',
    text: [
      'Kuto was a well-digger who struck water so pure the priests of Tyr blessed it. The plaza grew up around his well, and the well grew deeper every year, as though it were looking for something.',
      'Since the fall, the kobolds of the Slums come and go from the well-head as if it were their front door. Whatever lies at the bottom, it is not water any more.',
    ],
  },
  {
    n: 9, title: 'Podol Plaza', where: 'Commission of the Council',
    text: [
      'Podol Plaza was the great market of old Phlan, where caravans from Zhentil Keep met the grain barges of the Stojanow. Now a gang of bandits and their hired orcs tax anyone foolish enough to trade there.',
      'The Council would see the market reopened. A merchant named Tobiah Hoss is said to be holding out in his counting-house. If he lives, he may be of use.',
    ],
  },
  {
    n: 10, title: 'Mendor\'s Library', where: 'Commission of the Council',
    text: [
      'Mendor the Sage gathered the finest library north of the Moonsea. When the city fell, the scholars barricaded themselves inside with the books. They were never heard from again.',
      'Among the collection was a history of Phlan written in Mendor\'s own hand, which the Council believes names the families who held title to each block. Retrieve it. The Council does not say why the matter is urgent.',
    ],
  },
  {
    n: 11, title: 'A Scholar\'s Last Page', where: 'Mendor\'s Library',
    text: [
      'The page is torn from a daybook, the ink blotted by a shaking hand. "The fire took the east wing. The things outside cannot enter the reading room — Mendor\'s wards still hold — but the food is gone. Ione says the ward-stone is failing. We have drawn lots. I am to go for water tonight."',
      '"If you read this, look for the history behind the portrait of Mendor. He trusted no shelf with it."',
    ],
  },
  {
    n: 12, title: 'The Cadorna Textile House', where: 'Commission of Porphyrys Cadorna',
    text: [
      'Councilman Cadorna takes you aside, away from the other clerks. "My family\'s textile house stands in the old city. When we fled, my grandfather could not carry our strongbox. It is sealed with the family mark and it is mine by law."',
      '"Bring it to me unopened and you will be well paid. Opened, it will be worth considerably less to you." He smiles as he says it.',
    ],
  },
  {
    n: 13, title: 'The Temple of Bane', where: 'Overheard in the Slums',
    text: [
      'Two hobgoblins argue over a skin of wine. "The Black Hand says we march when the Boss says. The Boss says we march when the Pool is ready." "And when is the Pool ready?" "When the Black Hand has enough bodies for it."',
      'They laugh. You do not.',
    ],
  },
  {
    n: 14, title: 'Valhingen Graveyard', where: 'Commission of the Council',
    text: [
      'The old families of Phlan were buried in Valhingen, beneath marble angels and iron gates. Since the fall the dead have not stayed buried. At night the watch on the north wall can hear them scratching at their own tomb doors.',
      'The priests of Tyr believe an evil priest has made his lair among the mausoleums. Put an end to him and the dead will rest.',
    ],
  },
  {
    n: 15, title: 'Valjevo Castle', where: 'Rumour, the Broken Oar',
    text: [
      'Valjevo was the seat of the old lords of Phlan, and now it is the seat of whoever rules the monsters. A drunk swears he was taken there as a slave and escaped: "There\'s a man in the throne room who wears a mask and never speaks, and a giant who speaks for him. And the orcs are afraid of both."',
    ],
  },
  {
    n: 16, title: 'Stojanow Gate', where: 'Commission of the Council',
    text: [
      'The Stojanow Gate opens onto the river road and the wilderness beyond. Whoever holds it holds the only land route into Phlan. At present, that is a war-band of hobgoblins flying a banner no one recognises.',
      'Take the gate, and the Council can send for grain before the winter. Fail, and there will be no need for grain.',
    ],
  },
  {
    n: 17, title: 'The Pool of Radiance', where: 'Found in the Temple of Bane',
    text: [
      'The scroll is written in a cramped, devout hand. "He came to us out of the Pool as a flame, and wore the high priest like a cloak until the man was ash. He named himself Tyranthraxus, the Flamed One, and promised us a city."',
      '"He cannot keep a body long. He needs a greater one. Soon we shall bring him one, and then Phlan — and after Phlan, the Moonsea — will kneel."',
    ],
  },
  {
    n: 18, title: 'The Flamed One', where: 'The Pool of Radiance',
    text: [
      'The light from the Pool is golden and cold, and it moves like something breathing. Coiled about it lies a great bronze dragon, and in its eyes burns a fire that is not a dragon\'s.',
      '"Little mortals," says Tyranthraxus, in a voice like a forge. "You have cleared my city of its vermin. How kind. Kneel, and serve me in the ages to come. Refuse, and I shall wear one of you next."',
    ],
  },
  {
    n: 19, title: 'Beyond the Walls', where: 'The Stojanow Gate',
    text: [
      'The river road winds west between burnt farms and the black pines of the Quivering Forest. There are ruins out there older than Phlan, and lairs, and things that never learned to fear a sword.',
      'For now the wilds are no place for a small company. When you are stronger, the road will still be here.',
    ],
  },
  {
    n: 20, title: 'The Tavern Tale', where: 'The Gilded Tankard',
    text: [
      '"You want a story?" The old sailor sets down his mug. "When I was a boy there was a pool in the heart of the city that shone like a coin at the bottom of a fountain. The priests said it was holy. The wizards said it was power. They fought over it for a hundred years, and while they fought, the city died."',
      '"So that\'s my story. Whatever you find down there, lads — leave it where it lies."',
    ],
  },
  {
    n: 21, title: 'The Kobold Chieftain', where: 'Kuto\'s Warrens',
    text: [
      'The chieftain is old, grey-scaled and missing half his teeth, and he watches you from a throne made of stolen doors. "Yarash has no quarrel with tall-folk," he wheezes. "Yarash has quarrel with the Black Hand, who takes our young for his Pool. You want Yarash out of the well? Kill the Black Hand. Then Yarash goes."',
    ],
  },
  {
    n: 22, title: 'Tobiah Hoss', where: 'Podol Plaza',
    text: [
      'The merchant has barricaded himself in his counting-house for a month, living on pickled fish and spite. "Bandits I could bear," he says. "Bandits you can bribe. But the orcs don\'t want gold. They want names — who lives where, who has children, who has kin in New Phlan. I think they\'re making lists."',
    ],
  },
  {
    n: 23, title: 'The Strongbox', where: 'The Cadorna Textile House',
    text: [
      'The strongbox is heavy, cold, and sealed with the mark of a spindle and a crown. Something inside it shifts when you lift it, as if it were settling in to be carried.',
    ],
  },
  {
    n: 24, title: 'The Mausoleum of the Black Hand', where: 'Valhingen Graveyard',
    text: [
      'The mausoleum door has been forced from the inside. The dust within is scored with the tracks of many feet, all walking one way — down, into a stair that was not built by the masons of Phlan.',
    ],
  },
  {
    n: 25, title: 'The Beacon of Sokol', where: 'Sokol Keep',
    text: [
      'The beacon catches with a roar, and for a moment the whole harbour is gold. Across the water, the bells of New Phlan begin to ring. On the walls around you, the pale shapes of the garrison lower their weapons one by one, and fade.',
    ],
  },
  {
    n: 26, title: 'The Hall of Heroes', where: 'City Hall',
    text: [
      'On the wall behind the Clerk\'s desk hangs a roll of names in a good clerical hand: those who have reclaimed a block of the city. There are very few. Beneath them hangs a second roll, much longer, of those who tried.',
      '"I add to both," the Clerk says, "with the same pen."',
    ],
  },
  {
    n: 27, title: 'Sune\'s Blessing', where: 'Temple of Sune',
    text: [
      'The temple smells of roses and beeswax. Mother Ilsabet takes your hands in hers. "Beauty is not a luxury, whatever the soldiers say. It is the reason for the walls. Go and make something worth defending."',
    ],
  },
  {
    n: 28, title: 'The Iron Oath', where: 'Temple of Tempus',
    text: [
      'Warpriest Harkon strikes a shield with the flat of his sword, and the sound rolls around the bare stone hall. "The Foehammer asks for nothing but courage," he says. "He takes the rest anyway."',
    ],
  },
  {
    n: 29, title: 'Silk', where: 'An alley in New Phlan',
    text: [
      'She is only a voice and a pair of eyes in a hood. "Cadorna will tell you the box is family silver. Cadorna lies as easily as he breathes. Open it, and you will see why a councilman wants the old city emptied — and who he has been writing letters to."',
    ],
  },
  {
    n: 30, title: 'The Letters', where: 'The Cadorna strongbox',
    text: [
      'Beneath a bolt of cloth-of-gold lie a dozen letters, sealed with a black hand. Each thanks Councilman Cadorna for his "generous information regarding the patrols." The last promises him the lordship of Phlan "when the Flamed One takes his new form."',
    ],
  },
  // --- False entries (never referenced by an event) ---------------------------
  {
    n: 31, title: 'The Golden Barge', false: true,
    text: [
      'The barge lies on the river bottom below the Stojanow Gate, and its hold is full of Tethyrian gold. The trolls who guard it are asleep, and will stay asleep so long as no one sings.',
    ],
  },
  {
    n: 32, title: 'The Friendly Beholder', false: true,
    text: [
      '"Please," the beholder says, "I only want to help." Its central eye closes, and it smiles with all of its teeth. It asks you to lay down your weapons so that it can show you the way out.',
    ],
  },
  {
    n: 33, title: 'The Council\'s Secret', false: true,
    text: [
      'The Clerk leans close. "The Pool is a fable for children. There is no Flamed One. The Council invented the monsters to sell land in the new city. Go home."',
    ],
  },
  {
    n: 34, title: 'Mendor\'s Wish', false: true,
    text: [
      'The ring on the dead sage\'s finger holds three wishes. The first one grants itself as you touch it: you are suddenly, wonderfully, somewhere else.',
    ],
  },
  {
    n: 35, title: 'The Dragon\'s Bargain', false: true,
    text: [
      'The dragon bows its great head. "Serve me, and I shall give you the city to rule." It seems to mean it. It is lying.',
    ],
  },
];

/** @param {number} n */
export function getJournalEntry(n) {
  return JOURNAL.find((e) => e.n === n) ?? null;
}
