/**
 * Commissions of the Council (and a few private ones). The City Hall screen
 * lists offered commissions; accepting one sets `game.flags.quests[id] =
 * 'active'`, completing its objective flag makes it 'done', and returning to
 * City Hall pays the reward ('rewarded').
 *
 * @typedef {Object} QuestDef
 * @property {string} id
 * @property {string} title
 * @property {string} giver          npc id
 * @property {string} block          map id of the block concerned
 * @property {string} summary        one line for the ledger
 * @property {number} journal        journal entry with the full text
 * @property {string} doneFlag       game flag set when the objective is met
 * @property {{gold:number, xp:number, items?:string[]}} reward   (xp per living member)
 * @property {string} [requires]     flag needed before the Clerk offers it
 * @property {number} order
 */

/** @type {Record<string, QuestDef>} */
export const QUESTS = {
  clear_slums: {
    id: 'clear_slums', order: 1, title: 'Clear the Slums', giver: 'clerk', block: 'phlan_slums', journal: 5,
    summary: 'Drive the monsters from the Slums nearest the wall.',
    doneFlag: 'slums_cleared', reward: { gold: 400, xp: 200 },
  },
  sokol_keep: {
    id: 'sokol_keep', order: 2, title: 'Relight the Beacon of Sokol', giver: 'clerk', block: 'sokol_keep', journal: 6,
    summary: 'Scour Sokol Keep of the dead and relight its harbour beacon.',
    doneFlag: 'sokol_beacon', reward: { gold: 1200, xp: 600 },
  },
  podol_plaza: {
    id: 'podol_plaza', order: 3, title: 'Reopen Podol Plaza', giver: 'clerk', block: 'podol_plaza', journal: 9,
    summary: 'Break the bandits\' hold on the old market.',
    doneFlag: 'podol_cleared', reward: { gold: 1000, xp: 500 }, requires: 'slums_cleared',
  },
  mendor_history: {
    id: 'mendor_history', order: 4, title: 'Mendor\'s History', giver: 'clerk', block: 'mendors_library', journal: 10,
    summary: 'Recover the sage Mendor\'s history of Phlan from his library.',
    doneFlag: 'has_mendor_history', reward: { gold: 1500, xp: 800 },
  },
  cadorna_box: {
    id: 'cadorna_box', order: 5, title: 'The Cadorna Strongbox', giver: 'councilman', block: 'cadorna_textile', journal: 12,
    summary: 'Recover the Cadorna family strongbox — unopened.',
    doneFlag: 'has_strongbox', reward: { gold: 2000, xp: 600 }, requires: 'podol_cleared',
  },
  valhingen: {
    id: 'valhingen', order: 6, title: 'Lay the Dead to Rest', giver: 'clerk', block: 'valhingen_graveyard', journal: 14,
    summary: 'End the evil that raises the dead of Valhingen Graveyard.',
    doneFlag: 'valhingen_cleansed', reward: { gold: 2500, xp: 1200 }, requires: 'sokol_beacon',
  },
  stojanow: {
    id: 'stojanow', order: 7, title: 'Take the Stojanow Gate', giver: 'clerk', block: 'stojanow_gate', journal: 16,
    summary: 'Seize the river gate from the hobgoblin war-band.',
    doneFlag: 'stojanow_taken', reward: { gold: 3000, xp: 1500 }, requires: 'podol_cleared',
  },
  temple_bane: {
    id: 'temple_bane', order: 8, title: 'The Black Hand', giver: 'clerk', block: 'temple_bane', journal: 13,
    summary: 'Destroy the Temple of Bane and its priest, the Black Hand.',
    doneFlag: 'bane_defeated', reward: { gold: 4000, xp: 2000 }, requires: 'valhingen_cleansed',
  },
  valjevo: {
    id: 'valjevo', order: 9, title: 'Storm Valjevo Castle', giver: 'clerk', block: 'valjevo_castle', journal: 15,
    summary: 'Break the masked lord\'s power in Valjevo Castle.',
    doneFlag: 'valjevo_taken', reward: { gold: 5000, xp: 2500 }, requires: 'bane_defeated',
  },
  the_pool: {
    id: 'the_pool', order: 10, title: 'The Pool of Radiance', giver: 'clerk', block: 'pool_pyramid', journal: 17,
    summary: 'Descend to the Pool and face the Flamed One.',
    doneFlag: 'tyranthraxus_defeated', reward: { gold: 10000, xp: 5000 }, requires: 'valjevo_taken',
  },
};

export const QUEST_LIST = Object.values(QUESTS).sort((a, b) => a.order - b.order);

/**
 * Status of a quest for a game-state flags object.
 * @returns {'locked'|'offered'|'active'|'done'|'rewarded'}
 */
export function questStatus(flags, id) {
  const q = QUESTS[id];
  const st = flags.quests?.[id];
  if (st === 'rewarded') return 'rewarded';
  if (st === 'active' || st === 'done') return flags[q.doneFlag] ? 'done' : 'active';
  if (q.requires && !flags[q.requires]) return 'locked';
  return 'offered';
}

/**
 * Proclamations nailed to the City Hall board (flavour; some are dated jokes
 * in the spirit of the original's notices).
 */
export const PROCLAMATIONS = [
  { title: 'Bounty', text: 'Ten gold pieces for every pair of kobold ears presented at the Watch-house. Ears must match.' },
  { title: 'Curfew', text: 'The Stojanow Gate and the Slum Wall close at dusk. Those outside at dusk remain outside.' },
  { title: 'Notice', text: 'The Temple of Tyr will raise the worthy dead at the customary tithe. The unworthy dead are asked to remain so.' },
  { title: 'By Order', text: 'Looting of the old city is permitted to licensed companies. Unlicensed looters will be fined, or eaten, whichever comes first.' },
  { title: 'Wanted', text: 'Information on the man calling himself the Black Hand. Reward considerable. Discretion assured.' },
  { title: 'Lost', text: 'A grey cat answering to Pennywhistle. Last seen near Kuto\'s Well. Please do not go looking.' },
];
