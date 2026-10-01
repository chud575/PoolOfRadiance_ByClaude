import { createCharacter } from './character.js';
import { Rng } from './dice.js';
import { PARTIES } from '../data/parties.js';
import { STARTING_KITS } from '../data/items.js';
import { splitClasses } from './classes.js';

/**
 * Build a prebuilt party by id from data/parties.js. Deterministic for a seed.
 * @param {string} id
 * @param {number} [seed]
 * @returns {import('./character.js').Character[]}
 */
export function buildParty(id = 'default', seed = 1) {
  const def = PARTIES[id];
  if (!def) throw new Error(`Unknown party "${id}"`);
  const rng = new Rng(seed * 7919 + 13);
  return def.members.map((m) => {
    const primary = splitClasses(m.classSpec)[0];
    const kit = m.items ?? STARTING_KITS[primary];
    const ch = createCharacter({ ...m, rng, items: kit });
    if (m.look) ch.look = { ...ch.look, ...m.look };
    if (m.hpCur !== undefined) ch.hp.cur = m.hpCur;
    if (m.status) ch.status = m.status;
    return ch;
  });
}

/** Living (conscious) members. */
export function activeMembers(party) {
  return party.filter((c) => c.status === 'ok' && c.hp.cur > 0);
}

/** Total party gold. */
export function partyGold(party) {
  return party.reduce((t, c) => t + c.gold, 0);
}
