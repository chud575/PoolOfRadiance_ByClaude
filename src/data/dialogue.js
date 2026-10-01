import { TRAVEL } from './travel.js';

/**
 * Scripted events and conversations, played by the dialogue scene.
 *
 * Script  {id, title, art, start, nodes}
 * Node    {text, speaker?, art?, journal?, do?, choices?, next?, end?, branch?, panel?}
 *   text     string | string[] (paragraphs). `{leader}` → active character's name,
 *            `{party}` → party size, `{gold}` → pooled party gold.
 *   speaker  npc id (data/npcs.js) — shows their painted portrait and name plate
 *   art      {setting, npc?, monster?, count?, light?} overrides the script art
 *   journal  journal entry number — added to the party journal and announced
 *   do       effects applied when the node is shown
 *   branch   [{if, goto}] — evaluated on entry; first match redirects
 *   panel    'proclamations' | 'commissions' | 'heroes' — City Hall boards
 *   next     node id: a single CONTINUE choice
 *   end      true: a single LEAVE choice
 * Choice  {label, key?, goto?, end?, if?, do?, combat?, travel?, shop?, check?}
 *   check    {stat:'str'|'int'|'wis'|'dex'|'con'|'cha'|'thief', dc, pass, fail}
 *            best party member rolls d20 ≤ stat (or thief skill %) — Gold Box style
 * Effect  {flag} {unflag} {gold:n} {xp:n (each living member)} {item} {take}
 *         {quest, set} {heal:true} {damage:'1d6'} {time:minutes} {journal:n}
 * Cond    {flag} {notFlag} {item} {noItem} {quest, is} {gold:n} {class} {any:[..]} {all:[..]}
 */

/** City Hall's hub menu, repeated on each board so the party can move between them. */
const HALL = [
  { label: 'Proclamations', key: 'P', goto: 'procl' },
  { label: 'Commissions', key: 'C', goto: 'commissions' },
  { label: 'Report', key: 'R', goto: 'report' },
  { label: 'Hall of heroes', key: 'H', goto: 'heroes' },
  { label: 'Leave', key: 'L', end: true },
];

/** @type {Record<string, any>} */
export const DIALOGUES = {
  // ============================================================ NEW PHLAN
  city_hall: {
    id: 'city_hall', title: 'City Hall', subtitle: 'The Council of New Phlan',
    art: { setting: 'cityhall', npc: 'clerk' },
    status: 'council', // the parchment shows the party's standing and commission tally
    start: 'enter',
    nodes: {
      enter: {
        branch: [{ if: { notFlag: 'met_clerk' }, goto: 'first' }],
        speaker: 'clerk',
        text: 'The Clerk dips his pen, blots it, and looks up at you over his spectacles. "Back again, and all your limbs attached. The Council is impressed. What will it be?"',
        choices: HALL,
      },
      first: {
        speaker: 'clerk', journal: 3, do: [{ flag: 'met_clerk' }, { journal: 4 }],
        text: [
          'The hall is cold and far too large for the handful of clerks who work in it. Faded banners of the old city hang over the dais.',
          'A stooped man with ink-stained fingers looks up from his ledger. "New names. Good. The Council has more work than it has living hands. Read the proclamations, take a commission, and come back with proof."',
        ],
        next: 'enter',
      },
      procl: { speaker: 'clerk', panel: 'proclamations', text: '"The board. Most of it is bounties. The rest is bounties with better handwriting."', choices: HALL },
      commissions: { speaker: 'clerk', panel: 'commissions', art: { pose: 'ledger' }, text: '"The Council\'s commissions. Take any that suit you — but take them before you go and do the work. The Council does not pay for favours it did not ask for."', choices: HALL },
      heroes: { speaker: 'clerk', panel: 'heroes', journal: 26, art: { pose: 'ledger' }, text: '"The roll of the victorious, and beneath it the roll of those who tried. I add to both with the same pen."', choices: HALL },
      report: {
        speaker: 'clerk', panel: 'report', art: { pose: 'ledger' },
        text: '"Let me see your proofs." The Clerk turns the ledger around so you can watch him write.',
        choices: HALL,
      },
    },
  },

  crier: {
    id: 'crier', title: 'The Town Crier', art: { setting: 'street_day' },
    start: 'a',
    nodes: {
      a: {
        text: [
          'A crier in a patched tabard rings his handbell at the empty square. "Hear ye! The Council of New Phlan offers gold for the reclaiming of the old city! Apply at City Hall! Hear ye!"',
          'He sees you watching and lowers the bell. "You\'re the first who\'s listened all week," he says. "City Hall is north, the big one with the banners. You can\'t miss it. Most do anyway."',
        ],
        journal: 2,
        end: true,
      },
    },
  },

  gate_captain: {
    id: 'gate_captain', title: 'The Slum Wall', art: { setting: 'gate', npc: 'gate_captain' },
    start: 'a',
    nodes: {
      a: {
        speaker: 'gate_captain',
        text: '"Going out?" The captain of the watch looks you over as if measuring you for coffins. "Gate closes at dusk. Anyone outside at dusk stays outside. We\'ve had people knock all night, and in the morning there\'s nobody there. Just the knocking."',
        choices: [
          { label: 'Ask about the Slums', key: 'A', goto: 'slums' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      slums: {
        speaker: 'gate_captain',
        text: '"Kobolds, mostly. Rats. Some orcs have moved into the old counting-house on the south row and they\'ve got a big one bossing them. Kill the big one and the rest will scatter. Kobolds always do."',
        do: [{ flag: 'heard_slumlord' }],
        end: true,
      },
    },
  },

  silk: {
    id: 'silk', title: 'A Voice in the Alley', art: { setting: 'alley', npc: 'thief_guild', light: 'night' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { item: 'cadornaStrongbox' }, goto: 'box' }],
        speaker: 'thief_guild',
        text: '"Psst. No — don\'t turn around." The voice comes from a doorway too dark to see into. "You\'re the new company. A word of advice, free: when a councilman asks you to fetch something unopened, open it."',
        journal: 29,
        end: true,
      },
      box: {
        speaker: 'thief_guild',
        text: '"You have it. I can hear it breathing from here." A pause. "Open it before you hand it over. Or don\'t, and find out what Cadorna does with people who know too much. Either way, I\'ll be watching."',
        journal: 29,
        end: true,
      },
    },
  },

  // ============================================================ THE SLUMS
  slums_survivor: {
    id: 'slums_survivor', title: 'A Survivor', art: { setting: 'tenement', npc: 'provisioner', light: 'dim' },
    start: 'a',
    nodes: {
      a: {
        text: 'Behind a barricade of broken furniture crouches a halfling woman with a kitchen knife and a very determined expression. "Stay back! I\'ve killed three kobolds with this and I\'m not particular."',
        choices: [
          { label: 'Nice', key: 'N', goto: 'nice' },
          { label: 'Haughty', key: 'H', goto: 'haughty' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      nice: {
        text: '"Adventurers? From the new city?" She lowers the knife. "Then the Council hasn\'t forgotten us. I\'m Wilhelmina Tuck, and I had a shop here once. If you clear these streets I\'ll open one inside the wall — and you\'ll pay cost, I swear it." She presses a small purse on you. "For luck."',
        do: [{ flag: 'saved_tuck' }, { gold: 25 }, { xp: 25 }],
        end: true,
      },
      haughty: {
        text: '"Oh, the Council\'s heroes, is it?" She sniffs. "Well, heroes, the kobolds are that way, and the door is that way. I\'ll wait here till someone polite comes along."',
        end: true,
      },
    },
  },

  slums_overheard: {
    id: 'slums_overheard', title: 'Voices', art: { setting: 'slums', monster: 'hobgoblin', count: 2, light: 'dusk' },
    start: 'a',
    nodes: {
      a: {
        text: 'Voices echo from behind a collapsed wall — hobgoblins, by the sound, and drunk. You press close to the stones and listen.',
        journal: 13,
        choices: [
          { label: 'Attack', key: 'A', combat: 'orcs_1' },
          { label: 'Slip away', key: 'S', end: true },
        ],
      },
    },
  },

  slums_shrine: {
    id: 'slums_shrine', title: 'The Fallen Shrine', art: { setting: 'ruined_temple', light: 'day' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'slums_shrine_prayed' }, goto: 'again' }],
        text: 'The shrine of Tyr is roofless, the altar split in two. But the stone basin before it still holds a little clear rainwater, and in it lies the reflection of a sky that has not been dirtied by smoke.',
        choices: [
          { label: 'Pray', key: 'P', goto: 'pray' },
          { label: 'Search', key: 'S', goto: 'search' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      pray: {
        text: 'You kneel. For a moment the ruins are very quiet, and your wounds ache a little less. When you rise, the water in the basin is gone.',
        do: [{ heal: true }, { flag: 'slums_shrine_prayed' }],
        end: true,
      },
      search: {
        text: 'You find nothing but pigeon-droppings and a split offering-box, long since emptied. Whoever robbed it left a boot print in the dust — clawed, three-toed.',
        choices: [{ label: 'Pray', key: 'P', goto: 'pray' }, { label: 'Leave', key: 'L', end: true }],
      },
      again: { text: 'The basin is dry. The shrine is only stone.', end: true },
    },
  },

  slums_boss_door: {
    id: 'slums_boss_door', title: 'The Counting-House', art: { setting: 'tenement', monster: 'orcLeader', count: 1, light: 'torch' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'slums_boss_dead' }, goto: 'dead' }],
        text: 'Torchlight spills from the doorway of the old counting-house, and with it the smell of roasting meat and unwashed orc. A voice like gravel in a bucket is laughing inside.',
        choices: [
          { label: 'Burst in', key: 'B', combat: 'slums_orc_boss', win: [{ flag: 'slums_boss_dead' }, { flag: 'slums_cleared' }] },
          { label: 'Sneak in', key: 'S', check: { stat: 'thief', dc: 0, pass: 'sneak', fail: 'caught' } },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      sneak: {
        text: 'You slip through the shadows along the wall. The orcs are gathered around their fire, backs to you, weapons stacked by the door.',
        choices: [{ label: 'Attack', key: 'A', combat: 'slums_orc_boss', surprise: 'party', win: [{ flag: 'slums_boss_dead' }, { flag: 'slums_cleared' }] }],
      },
      caught: {
        text: 'A loose board groans underfoot. Every head in the room turns.',
        choices: [{ label: 'Fight', key: 'F', combat: 'slums_orc_boss', win: [{ flag: 'slums_boss_dead' }, { flag: 'slums_cleared' }] }],
      },
      dead: { text: 'The counting-house is empty now, the fire cold, the stolen cushions scattered. The Slums are quieter for it.', end: true },
    },
  },

  // ============================================================ SOKOL KEEP
  sokol_landing: {
    id: 'sokol_landing', title: 'Sokol Keep', art: { setting: 'keep', light: 'night' },
    start: 'a',
    nodes: {
      a: {
        text: 'The boat grinds against the landing stair. Above you the walls of Sokol Keep are black against the sky, and there is a light moving on them — pale, and too steady for a torch.',
        journal: 6,
        end: true,
      },
    },
  },

  ferran: {
    id: 'ferran', title: 'The Castellan', art: { setting: 'chapel', npc: 'ferran', light: 'ghost' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'sokol_beacon' }, goto: 'rest' }, { if: { flag: 'met_ferran' }, goto: 'again' }],
        speaker: 'ferran',
        text: 'A knight in antique plate kneels before the broken altar, sword reversed, as knights keep vigil. When he rises and turns, the candlelight shines through him.',
        choices: [
          { label: 'Nice', key: 'N', goto: 'speak' },
          { label: 'Meek', key: 'M', goto: 'speak' },
          { label: 'Haughty', key: 'H', goto: 'haughty' },
          { label: 'Abusive', key: 'A', goto: 'abusive' },
          { label: 'Flee', key: 'F', end: true },
        ],
      },
      speak: {
        speaker: 'ferran', journal: 7, art: { pose: 'stand' }, do: [{ flag: 'met_ferran' }, { item: 'bronzeKey' }],
        text: '"Living men. It has been long." His voice is the wind in an empty helm. "I am Ferran Martinez, castellan of this keep. Take this key — it opens the beacon tower. Light the beacon, and my men may lay down their watch."',
        next: 'more',
      },
      more: {
        speaker: 'ferran', art: { pose: 'stand' },
        text: '"And hear me. Something beneath the old city calls to the dead, and we rise and turn our faces toward it like flowers to the sun. Find what calls. End it. Then, perhaps, we may all rest."',
        end: true,
      },
      haughty: {
        speaker: 'ferran', art: { pose: 'stand' },
        text: '"You speak to me as to a servant." The ghost\'s eyes kindle. "I was knighted by the last true lord of Phlan. Mind your tongue in my chapel — and then, if you are worthy, I will speak."',
        choices: [{ label: 'Apologise', key: 'A', goto: 'speak' }, { label: 'Leave', key: 'L', end: true }],
      },
      abusive: {
        speaker: 'ferran', art: { pose: 'wrath' },
        text: 'The candles gutter and die. The ghost\'s sword comes up, and the cold of it goes through you like a winter sea. "Begone."',
        do: [{ damage: '1d6' }],
        end: true,
      },
      again: { speaker: 'ferran', art: { pose: 'stand' }, text: '"The beacon, friends. Light the beacon."', end: true },
      rest: { speaker: 'ferran', text: 'The chapel is empty. On the altar, where the knight knelt, lies a sword that shines like new, and a single white rose.', do: [{ item: 'longSwordPlus2', once: 'ferran_sword' }], end: true },
    },
  },

  sokol_beacon: {
    id: 'sokol_beacon', title: 'The Beacon Tower', art: { setting: 'keep', light: 'fire' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'sokol_beacon' }, goto: 'lit' }, { if: { item: 'bronzeKey' }, goto: 'door' }],
        text: 'The beacon tower door is bronze, sealed, and cold as ice. There is a keyhole shaped like the sigil of Sokol Keep.',
        end: true,
      },
      door: {
        text: 'The bronze key turns with a sound like a sigh. At the top of the stair the great iron basket waits, piled with dry pitch-wood, as if the garrison had meant to light it only a moment ago.',
        choices: [{ label: 'Light the beacon', key: 'L', goto: 'light' }, { label: 'Leave', key: 'E', end: true }],
      },
      light: {
        journal: 25, do: [{ flag: 'sokol_beacon' }, { xp: 300 }],
        text: 'The beacon catches with a roar, and for a moment the whole harbour turns gold. Across the water the bells of New Phlan begin to ring. On the walls, the pale shapes of the garrison lower their spears, one by one, and fade.',
        end: true,
      },
      lit: { text: 'The beacon burns steadily, and the harbour below is gold with it.', end: true },
    },
  },

  // ============================================================ KUTO'S WELL
  well_head: {
    id: 'well_head', title: 'Kuto\'s Well', art: { setting: 'well_head', light: 'dusk' },
    start: 'a',
    nodes: {
      a: {
        text: 'The well-head is a ring of carved stone as wide as a room. Kuto\'s name is cut into the lip, worn smooth by a century of buckets. A rope ladder — new, knotted by small hands — hangs down into the dark.',
        journal: 8,
        choices: [
          { label: 'Climb down', key: 'C', travel: { map: 'kutos_warrens', x: 7, y: 13, dir: 'N' } },
          { label: 'Drop a stone', key: 'D', goto: 'stone' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      stone: {
        text: 'You count to four before the splash. Then, much fainter, something far below begins to yap.',
        choices: [{ label: 'Climb down', key: 'C', travel: { map: 'kutos_warrens', x: 7, y: 13, dir: 'N' } }, { label: 'Leave', key: 'L', end: true }],
      },
    },
  },

  well_chief: {
    id: 'well_chief', title: 'The Kobold Throne', art: { setting: 'well', npc: 'kobold_chief', light: 'torch' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'well_pact' }, goto: 'pact' }, { if: { flag: 'well_chief_dead' }, goto: 'dead' }],
        speaker: 'kobold_chief', journal: 21,
        text: 'The chieftain watches you from a throne made of stolen doors. He is old, grey-scaled, and missing half his teeth. His guards raise their spears and wait for his word.',
        choices: [
          { label: 'Bargain', key: 'B', goto: 'bargain' },
          { label: 'Threaten', key: 'T', check: { stat: 'cha', dc: 0, pass: 'cowed', fail: 'angry' } },
          { label: 'Attack', key: 'A', combat: 'well_kobolds', win: [{ flag: 'well_chief_dead' }, { flag: 'well_cleared' }] },
        ],
      },
      bargain: {
        speaker: 'kobold_chief',
        text: '"Yarash has no quarrel with tall-folk. Yarash has quarrel with the Black Hand, who takes our young for his Pool. You swear to kill the Black Hand? Then Yarash takes his people out of the well, and tall-folk have their water back."',
        choices: [{ label: 'Swear', key: 'S', goto: 'sworn' }, { label: 'Refuse', key: 'R', goto: 'angry' }],
      },
      sworn: {
        speaker: 'kobold_chief', do: [{ flag: 'well_pact' }, { flag: 'well_cleared' }, { xp: 150 }],
        text: '"Good. Good." He bares his few teeth in what might be a smile. "Yarash remembers. Kobolds remember everything. Especially lies."',
        end: true,
      },
      cowed: {
        speaker: 'kobold_chief', do: [{ flag: 'well_pact' }, { flag: 'well_cleared' }, { xp: 100 }],
        text: 'The chieftain shrinks back into his throne. "Yes, yes, tall-folk very fierce. Yarash goes. Yarash goes tonight." His guards are already backing away.',
        end: true,
      },
      angry: {
        speaker: 'kobold_chief',
        text: '"Then tall-folk die in the dark!" He shrieks, and the warrens answer.',
        choices: [{ label: 'Fight', key: 'F', combat: 'well_kobolds', win: [{ flag: 'well_chief_dead' }, { flag: 'well_cleared' }] }],
      },
      pact: { speaker: 'kobold_chief', text: 'The throne of doors is empty. Chalked on the wall in a crabbed hand: "YARASH REMEMBERS."', end: true },
      dead: { text: 'The throne of doors lies overturned. Nothing moves in the warrens.', end: true },
    },
  },

  // ============================================================ PODOL PLAZA
  podol_hoss: {
    id: 'podol_hoss', title: 'The Counting-House', art: { setting: 'shop', npc: 'merchant_podol', light: 'dim' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'podol_cleared' }, goto: 'saved' }],
        speaker: 'merchant_podol', journal: 22,
        text: 'A slot in the barricaded door slides open, and a bloodshot eye regards you. "If you\'re bandits, I\'ve nothing left. If you\'re orcs, I\'ve even less. If you\'re from the Council — about time."',
        choices: [
          { label: 'Ask about the bandits', key: 'A', goto: 'bandits' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      bandits: {
        speaker: 'merchant_podol',
        text: '"Their captain sits on the auction block in the middle of the plaza, keeping his precious lists. Take him and the rest will run. Take his book, too — I\'d like to know what\'s in it. I\'d like to know very much."',
        do: [{ flag: 'heard_captain' }],
        end: true,
      },
      saved: {
        speaker: 'merchant_podol', do: [{ gold: 150, once: 'hoss_reward' }],
        text: 'The barricade is down, and Tobiah Hoss is sweeping his step as though nothing had happened. "Heroes! A small token — the rest when the caravans come back. And they will come back, now."',
        end: true,
      },
    },
  },

  podol_statue: {
    id: 'podol_statue', title: 'The Statue of the Founder', art: { setting: 'plaza', light: 'day' },
    start: 'a',
    nodes: {
      a: {
        text: 'A bronze statue of Phlan\'s founder stands in the plaza, his outstretched hand pointing at nothing. Someone has hung a noose from it. Someone else has cut the noose down.',
        choices: [
          { label: 'Search the plinth', key: 'S', check: { stat: 'int', dc: 0, pass: 'found', fail: 'nothing' } },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      found: {
        text: 'One of the bronze plaques on the plinth is loose. Behind it, wrapped in oilcloth, is a merchant\'s emergency purse.',
        do: [{ gold: 120, once: 'statue_purse' }, { item: 'potionHealing', once: 'statue_potion' }],
        end: true,
      },
      nothing: { text: 'The plinth is solid bronze and granite. If it holds a secret, it is keeping it.', end: true },
    },
  },

  // ============================================================ MENDOR'S LIBRARY
  library_page: {
    id: 'library_page', title: 'A Torn Page', art: { setting: 'library', light: 'dim' },
    start: 'a',
    nodes: { a: { text: 'Among the scattered pages on the floor, one is written in a shaking hand.', journal: 11, end: true } },
  },

  library_ione: {
    id: 'library_ione', title: 'The Reading Room', art: { setting: 'library', npc: 'sage', light: 'ward' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'met_ione' }, goto: 'again' }],
        speaker: 'sage',
        text: 'Inside a ring of faintly glowing runes sits an elf woman in grey, reading by the light of the ward itself. She marks her place before she looks up. "You are not a ghoul," she observes. "How refreshing."',
        choices: [
          { label: 'Ask about the history', key: 'A', goto: 'history' },
          { label: 'Offer to escort her out', key: 'O', goto: 'escort' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      history: {
        speaker: 'sage', do: [{ flag: 'met_ione' }],
        text: '"Mendor\'s history? Behind his portrait in the east gallery. He trusted no shelf with it. Tell the Council, when you give it to them, that some of the families it names are still alive. And that some of them should not be."',
        end: true,
      },
      escort: {
        speaker: 'sage', do: [{ flag: 'met_ione' }, { xp: 100 }, { item: 'scrollStinkingCloud' }],
        text: '"Out? And leave the books?" She laughs, not unkindly. "The ward will hold another season. Take this — you will have more use for it than I. And bring me news of the world, when there is any worth bringing."',
        end: true,
      },
      again: { speaker: 'sage', text: '"Still alive? Excellent. Do try to stay that way; I have so few visitors."', end: true },
    },
  },

  library_portrait: {
    id: 'library_portrait', title: 'Portrait of Mendor', art: { setting: 'library', light: 'dim' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'has_mendor_history' }, goto: 'empty' }],
        text: 'A full-length portrait of the sage Mendor hangs in the east gallery, his painted eyes following you with mild disapproval. The frame is heavier on one side than the other.',
        choices: [
          { label: 'Search the frame', key: 'S', goto: 'found' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      found: {
        do: [{ item: 'mendorHistory' }, { flag: 'has_mendor_history' }, { xp: 200 }],
        text: 'The portrait swings outward on hidden hinges. In the niche behind it lies a heavy folio bound in green leather, its clasp shaped like an open eye: Mendor\'s History of Phlan.',
        end: true,
      },
      empty: { text: 'The niche behind the portrait is empty.', end: true },
    },
  },

  // ============================================================ CADORNA TEXTILE HOUSE
  textile_box: {
    id: 'textile_box', title: 'The Strongbox', art: { setting: 'textile', light: 'dim' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'has_strongbox' }, goto: 'gone' }],
        journal: 23,
        text: 'The Cadorna strongbox sits in the counting-room, sealed with a spindle and a crown. It is heavy and cold, and something inside it shifts when you lift it, as if settling in to be carried.',
        choices: [
          { label: 'Take it', key: 'T', goto: 'take' },
          { label: 'Open it', key: 'O', check: { stat: 'thief', dc: 0, pass: 'open', fail: 'locked' } },
          { label: 'Leave it', key: 'L', end: true },
        ],
      },
      take: { do: [{ item: 'cadornaStrongbox' }, { flag: 'has_strongbox' }], text: 'You heave the strongbox onto your shoulders. It is heavier than it looks.', end: true },
      open: {
        journal: 30, do: [{ item: 'cadornaStrongbox' }, { flag: 'has_strongbox' }, { flag: 'box_opened' }, { gold: 300 }],
        text: 'The lock yields with a click. Beneath a bolt of cloth-of-gold lie a purse of old Phlan crowns and a bundle of letters sealed with a black hand.',
        end: true,
      },
      locked: { text: 'The lock is a master\'s work. It does not yield.', choices: [{ label: 'Take it', key: 'T', goto: 'take' }, { label: 'Leave it', key: 'L', end: true }] },
      gone: { text: 'Only a clean square in the dust shows where the strongbox stood.', end: true },
    },
  },

  // ============================================================ VALHINGEN GRAVEYARD
  grave_angel: {
    id: 'grave_angel', title: 'The Weeping Angel', art: { setting: 'graveyard', light: 'night' },
    start: 'a',
    nodes: {
      a: {
        journal: 14,
        text: 'A marble angel weeps over the grave of a child. Its cheeks are wet, though it has not rained. At its feet, fresh flowers — in a graveyard where nothing living has walked for years.',
        choices: [
          { label: 'Leave an offering', key: 'O', if: { gold: 10 }, do: [{ gold: -10 }, { heal: true }], goto: 'blessed' },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      blessed: { text: 'As the coins touch the stone, a warmth passes through you like the first day of spring.', end: true },
    },
  },

  grave_mausoleum: {
    id: 'grave_mausoleum', title: 'The Mausoleum', art: { setting: 'graveyard', light: 'green' },
    start: 'a',
    nodes: {
      a: {
        journal: 24,
        text: 'The great mausoleum of the Valhingen family has been forced open — from the inside. The dust within is scored with tracks, all leading one way: down.',
        end: true,
      },
    },
  },

  // ============================================================ TEMPLE OF BANE
  bane_altar: {
    id: 'bane_altar', title: 'The Altar of Bane', art: { setting: 'temple_bane', light: 'green' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'bane_defeated' }, goto: 'broken' }],
        text: 'A black altar crouches beneath a great iron hand, fingers spread to grasp the ceiling. Green fire burns in its palm without fuel or smoke. On the altar lies a scroll, weighted with a skull.',
        journal: 17,
        choices: [
          { label: 'Confront the priest', key: 'C', combat: 'bane_priest', win: [{ flag: 'bane_defeated' }, { flag: 'valhingen_cleansed' }] },
          { label: 'Withdraw', key: 'W', end: true },
        ],
      },
      broken: { text: 'The iron hand has fallen, and the green fire is out. The altar is only stone.', end: true },
    },
  },

  // ============================================================ VALJEVO CASTLE
  valjevo_prisoner: {
    id: 'valjevo_prisoner', title: 'A Prisoner', art: { setting: 'crypt', light: 'dim' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'freed_prisoner' }, goto: 'gone' }],
        journal: 15,
        text: 'A man hangs in chains from the dungeon wall, thin as a rake. "Water," he whispers. "And a key, if you have one. The keys are on the giant\'s belt. Everything is on the giant\'s belt."',
        choices: [
          { label: 'Free him', key: 'F', check: { stat: 'str', dc: 0, pass: 'freed', fail: 'stuck' } },
          { label: 'Leave', key: 'L', end: true },
        ],
      },
      freed: { do: [{ flag: 'freed_prisoner' }, { xp: 150 }], text: 'The old staple tears out of the wall. The prisoner falls into your arms, weeping, and then he is gone into the dark, towards the river.', end: true },
      stuck: { text: 'The chains hold. "Come back," he whispers. "Come back with the keys."', end: true },
      gone: { text: 'Empty chains hang from the wall.', end: true },
    },
  },

  valjevo_throne: {
    id: 'valjevo_throne', title: 'The Throne Room', art: { setting: 'castle', monster: 'hillGiant', count: 1, light: 'torch' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'valjevo_taken' }, goto: 'empty' }],
        text: 'The throne of the old lords of Phlan stands at the end of the hall. It is empty. Beside it looms a hill giant, and on its belt hangs a great ring of keys.',
        choices: [
          { label: 'Attack', key: 'A', combat: 'valjevo_giant', win: [{ flag: 'valjevo_taken' }] },
          { label: 'Withdraw', key: 'W', end: true },
        ],
      },
      empty: { text: 'The throne stands empty. Behind it, a stair you had not noticed before descends into golden light.', end: true },
    },
  },

  // ============================================================ STOJANOW GATE
  gate_road: {
    id: 'gate_road', title: 'The Gatehouse', art: { setting: 'gate', light: 'dusk' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'stojanow_taken' }, goto: 'taken' }],
        journal: 16,
        text: 'The gatehouse of the Stojanow Gate squats over the river road like a toad on a stone. A banner no one recognises hangs from its towers: a black hand on a field of flame.',
        choices: [
          { label: 'Storm the gatehouse', key: 'S', combat: 'gate_chief', win: [{ flag: 'stojanow_taken' }] },
          { label: 'Withdraw', key: 'W', end: true },
        ],
      },
      taken: { text: 'The strange banner is down, and the watch of New Phlan holds the gate. Beyond it, the river road winds away into the wilds.', journal: 19, end: true },
    },
  },

  // ============================================================ THE POOL
  the_pool: {
    id: 'the_pool', title: 'The Pool of Radiance', art: { setting: 'pool', npc: 'tyranthraxus', light: 'gold' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'tyranthraxus_defeated' }, goto: 'after' }],
        speaker: 'tyranthraxus', journal: 18,
        text: '"Little mortals," says Tyranthraxus, and the voice is a forge. "You have cleared my city of its vermin. How very kind. Kneel, and serve me in the ages to come. Refuse, and I shall wear one of you next."',
        choices: [
          { label: 'Kneel', key: 'K', goto: 'kneel' },
          { label: 'Defy him', key: 'D', combat: 'pool_tyranthraxus', win: [{ flag: 'tyranthraxus_defeated' }] },
        ],
      },
      kneel: {
        speaker: 'tyranthraxus',
        text: 'You bend the knee. The dragon laughs, long and low, and the Pool laughs with it. "No," it says. "I have changed my mind. I prefer you frightened."',
        choices: [{ label: 'Fight', key: 'F', combat: 'pool_tyranthraxus', win: [{ flag: 'tyranthraxus_defeated' }] }],
      },
      after: { text: 'The Pool is still, and its light is only light. Somewhere far above, the bells of Phlan are ringing.', end: true },
    },
  },

  // ============================================================ WILDERNESS
  wild_camp: {
    id: 'wild_camp', title: 'Abandoned Camp', art: { setting: 'wilds', light: 'dusk' },
    start: 'a',
    nodes: {
      a: {
        branch: [{ if: { flag: 'wild_camp_searched' }, goto: 'done' }],
        text: 'A trader\'s camp beside the road, the fire long cold, the wagon overturned. The oxen are gone. So are the traders.',
        choices: [{ label: 'Search', key: 'S', goto: 'search' }, { label: 'Leave', key: 'L', end: true }],
      },
      search: { do: [{ flag: 'wild_camp_searched' }, { gold: 80 }, { item: 'potionExtraHealing' }], text: 'Under the wagon bed you find a strongbox the raiders missed, and a flask of something that smells of mint and blood.', end: true },
      done: { text: 'The camp is as you left it.', end: true },
    },
  },
  wild_return: {
    id: 'wild_return', title: 'The Wilds', art: { setting: 'wilds', light: 'day' },
    start: 'a',
    nodes: { a: { journal: 19, text: 'The river road runs on into the west, between burnt farms and the black pines. This is as far as a company of your strength should go — for now.', end: true } },
  },
};

// Travel scripts, generated from data/travel.js.
for (const t of TRAVEL) {
  DIALOGUES[`go_${t.id}`] = {
    id: `go_${t.id}`, title: t.title, art: { setting: t.art ?? 'street_day' }, start: 'a',
    nodes: {
      a: {
        branch: t.requires ? [{ if: { notFlag: t.requires }, goto: 'barred' }] : undefined,
        text: t.text,
        choices: [
          { label: t.go ?? 'Go', key: 'Y', travel: { ...t.to, minutes: t.minutes ?? 10 } },
          { label: 'Stay', key: 'N', end: true },
        ],
      },
      barred: { text: t.barred ?? 'The way is barred.', end: true },
    },
  };
}

/** @param {string} id */
export function getDialogue(id) {
  const d = DIALOGUES[id];
  if (!d) throw new Error(`Unknown dialogue "${id}"`);
  return d;
}
