/**
 * Wandering monsters. Every occupied block keeps its own table, checked as the party walks
 * (a chance in 1,000 per step once the party has gone a few steps without a fight) and as it
 * rests (a chance in 100 per hour of rest; the camp scene asks `restAmbush`). New Phlan behind
 * the palisade has no table: the Watch keeps its streets.
 *
 * Each table row is an encounter defined here (spread into data/encounters.js ENCOUNTERS), staged
 * in its own block's art so a band met in the warrens is seen in the warrens.
 *
 *   rollWandering(rng, mapId, {steps, x, y, night}) → encounter id | null
 *   restAmbush(rng, mapId, minutes) → {at: minute, ref} | null
 */

const STD = ['combat', 'wait', 'flee', 'parley'];
const MINDLESS = ['combat', 'flee'];

function w(id, name, groups, intro, o = {}) {
  return { id, name, groups, intro, options: o.options ?? STD, art: o.art, parley: o.parley, parleyText: o.parleyText, treasure: o.treasure, wandering: true };
}

const COWARD = { haughty: 'flee', sly: 'fight', nice: 'fight', meek: 'fight', abusive: 'flee' };
const GREEDY = { haughty: 'fight', sly: 'bribe:40', nice: 'fight', meek: 'bribe:80', abusive: 'fight' };
const BRUTE = { haughty: 'fight', sly: 'fight', nice: 'leave', meek: 'bribe:60', abusive: 'fight' };

/** Encounters met only by wandering. */
export const WANDER_ENCOUNTERS = Object.fromEntries([
  // ---- the Slums
  w('wander_slums_rats', 'Rats in the Rubble', [{ monster: 'giantRat', count: 5 }], 'Something heaves under a drift of broken plaster, and a tide of grey backs pours out after the smell of you.', { options: MINDLESS, art: { setting: 'tenement', light: 'dim' } }),
  w('wander_slums_kobolds', 'Kobold Scavengers', [{ monster: 'kobold', count: 4 }], 'Four kobolds are dragging a door off its hinges for firewood. They drop it with a crash and reach for their spears.', { art: { setting: 'slums', light: 'dusk' }, parley: COWARD, parleyText: { flee: 'The kobolds squeal and bolt, leaving the door where it fell.' } }),
  w('wander_slums_goblins', 'Goblin Footpads', [{ monster: 'goblin', count: 5 }], 'Goblins drop from a sagging balcony, knives out, giggling to each other.', { art: { setting: 'alley', light: 'night' }, parley: GREEDY }),
  w('wander_slums_thugs', 'Cutpurses', [{ monster: 'thug', count: 3 }], '"Long way from the Council\'s walls, friends." Three men push off the wall of a burnt house, cudgels swinging.', { art: { setting: 'alley', light: 'night' }, parley: { haughty: 'fight', sly: 'leave', nice: 'fight', meek: 'bribe:30', abusive: 'fight' } }),
  // ---- Sokol Keep
  w('wander_sokol_skeletons', 'The Watch That Never Ended', [{ monster: 'skeleton', count: 4 }], 'Four skeletons in rusted mail come around the corner in step, still walking the round they were given the night the keep fell.', { options: MINDLESS, art: { setting: 'keep', light: 'night' } }),
  w('wander_sokol_zombies', 'Drowned Sailors', [{ monster: 'zombie', count: 3 }], 'Water runs from their clothes as they come up from the landing, weed in their hair, eyes white as fish-bellies.', { options: MINDLESS, art: { setting: 'keep', light: 'night' } }),
  w('wander_sokol_ghouls', 'Ghouls on the Wall-Walk', [{ monster: 'ghoul', count: 2 }], 'Two hunched shapes look up from something on the wall-walk. Their mouths are dark.', { options: MINDLESS, art: { setting: 'keep', light: 'night' } }),
  // ---- Kuto's Well
  w('wander_well_kobolds', 'Kobold Water-Carriers', [{ monster: 'kobold', count: 5 }], 'A file of kobolds with buckets on yokes freezes in the open square. Then the buckets drop.', { art: { setting: 'well', light: 'dusk' }, parley: COWARD }),
  w('wander_well_rats', 'Well Rats', [{ monster: 'giantRat', count: 6 }], 'Rats boil up out of a drain beside the well, wet and furious.', { options: MINDLESS, art: { setting: 'well', light: 'dusk' } }),
  w('wander_well_goblins', 'Goblin Prowlers', [{ monster: 'goblin', count: 4 }], 'Goblins are prising roof-lead off the well-wrights\' houses. One of them sees you and shrieks.', { art: { setting: 'well', light: 'dusk' }, parley: GREEDY }),
  // ---- Kuto's Warrens
  w('wander_warrens_kobolds', 'Tunnel Patrol', [{ monster: 'kobold', count: 6 }], 'Torchlight, yapping, the slap of bare feet on wet stone: a kobold patrol comes round the bend straight into you.', { art: { setting: 'crypt', light: 'torch' }, parley: COWARD }),
  w('wander_warrens_centipedes', 'Centipedes', [{ monster: 'giantCentipede', count: 3 }], 'The wall moves. Then it is not the wall: three centipedes as long as a man, pouring down toward the light.', { options: MINDLESS, art: { setting: 'crypt', light: 'torch' } }),
  w('wander_warrens_frogs', 'Frogs from the Cistern', [{ monster: 'giantFrog', count: 2 }], 'Something big flops out of the black water behind you. Then something bigger.', { options: MINDLESS, art: { setting: 'crypt', light: 'torch' } }),
  // ---- Podol Plaza
  w('wander_podol_bandits', 'Toll-Takers', [{ monster: 'bandit', count: 4 }], '"Plaza toll. Everyone pays." Four bandits fan out across the square, crossbows cocked.', { art: { setting: 'plaza', light: 'day' }, parley: { haughty: 'fight', sly: 'bribe:50', nice: 'bribe:50', meek: 'bribe:100', abusive: 'fight' } }),
  w('wander_podol_gnolls', 'Gnoll Hunters', [{ monster: 'gnoll', count: 3 }], 'Three gnolls lope across the market, noses down, and come up grinning when they find your scent.', { art: { setting: 'plaza', light: 'day' }, parley: BRUTE }),
  w('wander_podol_orcs', 'Orc Looters', [{ monster: 'orc', count: 4 }], 'Orcs are smashing the shutters of the old spice-stalls. They turn as one when they hear you.', { art: { setting: 'plaza', light: 'day' }, parley: BRUTE }),
  // ---- Mendor's Library
  w('wander_library_gnolls', 'Gnolls in the Aisles', [{ monster: 'gnoll', count: 3 }], 'A gnoll is tearing pages out of a book to start a fire. Its friends look up from the shelves.', { art: { setting: 'library', light: 'dim' }, parley: BRUTE }),
  w('wander_library_ghouls', 'The Readers', [{ monster: 'ghoul', count: 2 }], 'Two grey figures sit at a reading table as if studying. When they turn, their eyes are milk.', { options: MINDLESS, art: { setting: 'library', light: 'dim' } }),
  w('wander_library_spider', 'Spider in the Stacks', [{ monster: 'giantSpider', count: 1 }], 'Webs hang between the shelves like dust-sheets. Something heavy shifts in the dark above you.', { options: MINDLESS, art: { setting: 'library', light: 'dim' } }),
  // ---- Cadorna Textile House
  w('wander_textile_rats', 'Rats in the Wool', [{ monster: 'giantRat', count: 7 }], 'A bale of rotten wool bursts open and rats spill out of it, squealing.', { options: MINDLESS, art: { setting: 'textile', light: 'dim' } }),
  w('wander_textile_lizardmen', 'Lizard Men from the Dye-Vats', [{ monster: 'lizardMan', count: 2 }], 'Two lizard men climb dripping out of a dye-vat, stained blue to the shoulder, clubs in their fists.', { art: { setting: 'textile', light: 'dim' }, parley: BRUTE }),
  w('wander_textile_orcs', 'Orc Bale-Robbers', [{ monster: 'orc', count: 3 }], 'Orcs are hauling bolts of silk toward the loading bay. They drop them to draw steel.', { art: { setting: 'textile', light: 'dim' }, parley: BRUTE }),
  // ---- Valhingen Graveyard
  w('wander_grave_zombies', 'The Restless', [{ monster: 'zombie', count: 4 }], 'The earth of a fresh grave heaves, and heaves again, and a hand comes up through it.', { options: MINDLESS, art: { setting: 'graveyard', light: 'night' } }),
  w('wander_grave_skeletons', 'Bones Among the Stones', [{ monster: 'skeleton', count: 5 }], 'Between the headstones, pale shapes are standing up.', { options: MINDLESS, art: { setting: 'graveyard', light: 'night' } }),
  w('wander_grave_ghouls', 'Grave-Eaters', [{ monster: 'ghoul', count: 3 }], 'Something is digging at the foot of a tomb, with its hands.', { options: MINDLESS, art: { setting: 'graveyard', light: 'night' } }),
  w('wander_grave_wight', 'A Wight Abroad', [{ monster: 'wight', count: 1 }], 'A tall figure in mouldering finery stands at the end of the avenue. The cold reaches you before it does.', { options: MINDLESS, art: { setting: 'graveyard', light: 'night' } }),
  // ---- Temple of Bane
  w('wander_bane_acolytes', 'Acolytes at Their Rounds', [{ monster: 'acolyte', count: 3 }], 'Black-robed acolytes come down the passage with censers, chanting. The chanting stops.', { art: { setting: 'temple_bane', light: 'green' }, parley: { haughty: 'fight', sly: 'leave', nice: 'fight', meek: 'fight', abusive: 'fight' } }),
  w('wander_bane_hobgoblins', 'Temple Guards', [{ monster: 'hobgoblin', count: 4 }], 'Hobgoblins in black tabards with a white hand stitched on the breast. They level their spears.', { art: { setting: 'temple_bane', light: 'green' }, parley: GREEDY }),
  w('wander_bane_zombies', 'The Temple\'s Dead', [{ monster: 'zombie', count: 3 }], 'The Black Hand wastes nothing. Its dead servants still carry water and sweep the floors — and guard them.', { options: MINDLESS, art: { setting: 'temple_bane', light: 'green' } }),
  // ---- Valjevo Castle
  w('wander_valjevo_hobgoblins', 'Castle Watch', [{ monster: 'hobgoblin', count: 5 }], 'A hobgoblin sergeant barks, and his squad closes ranks across the hall.', { art: { setting: 'castle', light: 'torch' }, parley: GREEDY }),
  w('wander_valjevo_bugbears', 'Bugbears off Duty', [{ monster: 'bugbear', count: 2 }], 'Two bugbears are dicing for a dead man\'s boots. They are bad losers.', { art: { setting: 'castle', light: 'torch' }, parley: BRUTE }),
  w('wander_valjevo_orcs', 'Orc Kitchen-Crew', [{ monster: 'orc', count: 4 }], 'Orcs with cleavers and a cauldron between them look up from the castle kitchens. They are still hungry.', { art: { setting: 'castle', light: 'torch' }, parley: BRUTE }),
  // ---- Stojanow Gate
  w('wander_gate_hobgoblins', 'Wall Patrol', [{ monster: 'hobgoblin', count: 4 }], 'A patrol comes along River Street in good order, shields locked. Somebody trained these hobgoblins.', { art: { setting: 'gate', light: 'dusk' }, parley: GREEDY }),
  w('wander_gate_orcs', 'Orc Stragglers', [{ monster: 'orc', count: 4 }], 'Orcs who missed the muster, and are in a foul temper about it.', { art: { setting: 'gate', light: 'dusk' }, parley: BRUTE }),
  w('wander_gate_bugbears', 'Bugbear Scouts', [{ monster: 'bugbear', count: 2 }], 'You never hear them coming. Two bugbears step out of a doorway right beside you.', { art: { setting: 'gate', light: 'dusk' }, parley: BRUTE }),
  // ---- the Pool
  w('wander_pool_shadows', 'Shadows on the Stair', [{ monster: 'shadow', count: 2 }], 'Your torchlight throws your shadows up the stair. Two of them do not belong to you.', { options: MINDLESS, art: { setting: 'pool', light: 'gold' } }),
  w('wander_pool_wight', 'A Drowned Lord', [{ monster: 'wight', count: 1 }], 'A figure in water-black robes rises from the steps where it sat, as if it had been waiting for you a long time.', { options: MINDLESS, art: { setting: 'pool', light: 'gold' } }),
  // ---- the wilds
  w('wander_wild_gnolls', 'Gnoll Raiders', [{ monster: 'gnoll', count: 4 }], 'Gnolls on the river road, driving stolen sheep. They would rather have you.', { art: { setting: 'wilds', light: 'dusk' }, parley: BRUTE }),
  w('wander_wild_orcs', 'Orc War-Party', [{ monster: 'orc', count: 5 }], 'Drums in the hills, and then the orcs themselves, coming down the slope at a run.', { art: { setting: 'wilds', light: 'dusk' }, parley: BRUTE }),
].map((e) => [e.id, e]));

/**
 * Per-block tables. step: chance in 1,000 per step; rest: chance in 100 per hour of rest;
 * table: [encounter id, weight]; grace: steps after a fight (or arrival) before the next check.
 */
export const WANDERING = {
  phlan_civilized: null,
  phlan_slums: { step: 20, rest: 10, table: [['wander_slums_rats', 3], ['wander_slums_kobolds', 4], ['wander_slums_goblins', 2], ['wander_slums_thugs', 2]] },
  sokol_keep: { step: 24, rest: 14, table: [['wander_sokol_skeletons', 4], ['wander_sokol_zombies', 3], ['wander_sokol_ghouls', 1]] },
  kutos_well: { step: 20, rest: 10, table: [['wander_well_kobolds', 4], ['wander_well_rats', 3], ['wander_well_goblins', 2]] },
  kutos_warrens: { step: 28, rest: 18, table: [['wander_warrens_kobolds', 5], ['wander_warrens_centipedes', 2], ['wander_warrens_frogs', 1]] },
  podol_plaza: { step: 22, rest: 12, table: [['wander_podol_bandits', 4], ['wander_podol_gnolls', 2], ['wander_podol_orcs', 2]] },
  mendors_library: { step: 22, rest: 12, table: [['wander_library_gnolls', 3], ['wander_library_ghouls', 2], ['wander_library_spider', 1]] },
  cadorna_textile: { step: 22, rest: 12, table: [['wander_textile_rats', 4], ['wander_textile_lizardmen', 2], ['wander_textile_orcs', 2]] },
  valhingen_graveyard: { step: 28, rest: 20, table: [['wander_grave_zombies', 4], ['wander_grave_skeletons', 3], ['wander_grave_ghouls', 2], ['wander_grave_wight', 1]] },
  temple_bane: { step: 26, rest: 20, table: [['wander_bane_acolytes', 4], ['wander_bane_hobgoblins', 2], ['wander_bane_zombies', 2]] },
  valjevo_castle: { step: 26, rest: 18, table: [['wander_valjevo_hobgoblins', 5], ['wander_valjevo_bugbears', 2], ['wander_valjevo_orcs', 2]] },
  stojanow_gate: { step: 24, rest: 16, table: [['wander_gate_hobgoblins', 4], ['wander_gate_orcs', 3], ['wander_gate_bugbears', 1]] },
  pool_pyramid: { step: 16, rest: 25, table: [['wander_pool_shadows', 2], ['wander_pool_wight', 1]] },
  wilderness: { step: 32, rest: 14, table: [['wild_wolves', 3], ['wander_wild_gnolls', 2], ['wander_wild_orcs', 2]] },
};

const GRACE = 8;

function pick(rng, table) {
  const total = table.reduce((t, [, n]) => t + n, 0);
  let r = rng.int(1, total);
  for (const [id, n] of table) {
    r -= n;
    if (r <= 0) return id;
  }
  return table[table.length - 1][0];
}

/**
 * One step's check. `steps` = steps walked since the last fight or arrival (the caller keeps it);
 * squares with their own event never also roll (no ambush on top of a scripted scene).
 */
export function rollWandering(rng, mapId, o = {}) {
  const w = WANDERING[mapId];
  if (!w || !w.table.length) return null;
  if ((o.steps ?? 0) < (w.grace ?? GRACE)) return null;
  if (o.hasEvent) return null;
  if (rng.int(1, 1000) > w.step) return null;
  return pick(rng, w.table);
}

/** Does a rest of `minutes` get interrupted, and when? (rolled once, hour by hour, at bedtime) */
export function restAmbush(rng, mapId, minutes) {
  const w = WANDERING[mapId];
  if (!w || !w.rest || !w.table.length) return null;
  const hours = Math.floor(minutes / 60);
  for (let h = 0; h < hours; h++) {
    if (rng.int(1, 100) <= w.rest) return { at: h * 60 + rng.int(10, 50), ref: pick(rng, w.table) };
  }
  return null;
}
