/**
 * The roster (Gold Box "saved characters") as pure operations, so the party screen and its tests
 * agree on the rules: every member of the party is also on the roster; DROP removes a character
 * from the party but keeps (and refreshes) their roster entry; ADD brings back a roster character
 * not already in the party.
 */

const clone = (c) => (typeof structuredClone === 'function' ? structuredClone(c) : JSON.parse(JSON.stringify(c)));

/** Insert or refresh `ch` on the roster (by id), newest last. Returns a new array. */
export function upsertRoster(roster, ch) {
  if (!ch) return roster;
  return [...roster.filter((r) => r.id !== ch.id), clone(ch)];
}

/** Make sure every party member is on the roster (a loaded or prebuilt party included). */
export function seedRoster(roster, party) {
  let out = roster;
  for (const c of party ?? []) if (c && !out.some((r) => r.id === c.id)) out = upsertRoster(out, c);
  return out;
}

/** DROP: remove party[index]; the character stays on the roster. */
export function dropMember(party, roster, index) {
  const ch = party[index];
  if (!ch) return { party, roster, dropped: null, sel: index };
  const p = party.filter((_, i) => i !== index);
  return { party: p, roster: upsertRoster(roster, ch), dropped: ch, sel: Math.max(0, Math.min(index, p.length - 1)) };
}

/** Roster characters who may be ADDed (not already in the party). */
export function addable(party, roster) {
  const inParty = new Set(party.map((c) => c.id));
  return roster.filter((c) => !inParty.has(c.id));
}

/** ADD: bring roster character `id` into the party (max six). */
export function addMember(party, roster, id) {
  if (party.length >= 6) return { party, added: null };
  const ch = addable(party, roster).find((c) => c.id === id);
  if (!ch) return { party, added: null };
  const copy = clone(ch);
  return { party: [...party, copy], added: copy };
}
