/** Party screen roster rules (char-creation workstream): DROP keeps the character for ADD. */
import { describe, it, expect } from 'vitest';
import { seedRoster, dropMember, addMember, addable } from '../../src/scenes/create/rosterOps.js';

const party = [
  { id: 'a', name: 'Taran', hp: { max: 10 } },
  { id: 'b', name: 'Aldric', hp: { max: 8 } },
  { id: 'c', name: 'Pip', hp: { max: 4 } },
];

describe('roster', () => {
  it('seeds the roster from a prebuilt party', () => {
    const r = seedRoster([], party);
    expect(r.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(seedRoster(r, party)).toHaveLength(3);
  });
  it('drop then add brings the same character back', () => {
    const roster = seedRoster([], party);
    const d = dropMember(party, roster, 0);
    expect(d.party.map((c) => c.id)).toEqual(['b', 'c']);
    expect(d.dropped.name).toBe('Taran');
    expect(d.sel).toBe(0);
    expect(addable(d.party, d.roster).map((c) => c.id)).toEqual(['a']);
    const a = addMember(d.party, d.roster, 'a');
    expect(a.added).toEqual(party[0]);
    expect(a.party.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
  it('drop works even when the roster was empty', () => {
    const d = dropMember(party, [], 2);
    expect(d.roster.map((c) => c.id)).toEqual(['c']);
    expect(d.sel).toBe(1);
    expect(addMember(d.party, d.roster, 'c').added.name).toBe('Pip');
  });
  it('refuses a seventh member', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}` }));
    expect(addMember(six, [{ id: 'z' }], 'z').added).toBeNull();
  });
});
