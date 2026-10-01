/**
 * Named characters of Phlan. Portraits are painted procedurally by the shared
 * portrait painter (ui/components/portraitPainter.js) from `race/gender/look`;
 * `kind` selects a special painter for non-human subjects (ghost, dragon...).
 *
 * look: {seed, head (0-7), body (0-7: plate chain scale leather robe tabard fur vestments),
 *        skin, hair (0-9), eyes, cloth (0-7: crimson royal forest violet umber sable ochre teal)}
 * aura: optional rim-light colour for the painted panel.
 *
 * @typedef {Object} NpcDef
 * @property {string} id
 * @property {string} name
 * @property {string} [title]
 * @property {string} [race]
 * @property {'male'|'female'} [gender]
 * @property {object} [look]
 * @property {'portrait'|'ghost'|'dragon'|'hooded'} [kind]
 * @property {string} [aura]
 * @property {string} [desc]
 */

/** @type {Record<string, NpcDef>} */
export const NPCS = {
  clerk: {
    id: 'clerk', name: 'Auric Vellum', title: 'Clerk of the Council', race: 'human', gender: 'male',
    look: { seed: 4101, head: 7, body: 4, hair: 7, cloth: 1, skin: 1, eyes: 4 }, aura: '#ffcf8a',
    desc: 'A stooped, ink-stained man with spectacles on a ribbon and a ledger never far from his hand.',
  },
  councilman: {
    id: 'councilman', name: 'Porphyrys Cadorna', title: 'First Councilman', race: 'human', gender: 'male',
    look: { seed: 4203, head: 2, body: 5, hair: 1, cloth: 3, skin: 3, eyes: 2 }, aura: '#e8b060',
    desc: 'Silk and rings and a smile that never reaches the eyes.',
  },
  bishop: {
    id: 'bishop', name: 'Bishop Braccio', title: 'Council of Phlan', race: 'human', gender: 'male',
    look: { seed: 4305, head: 3, body: 7, hair: 8, cloth: 1, skin: 2, eyes: 0 }, aura: '#bcd4ff',
  },
  priest_tyr: {
    id: 'priest_tyr', name: 'Brother Ohlo', title: 'High Priest of Tyr', race: 'human', gender: 'male',
    look: { seed: 5101, head: 7, body: 7, hair: 9, cloth: 1, skin: 1, eyes: 0 }, aura: '#bcd4ff',
  },
  priestess_sune: {
    id: 'priestess_sune', name: 'Mother Ilsabet', title: 'Priestess of Sune', race: 'halfElf', gender: 'female',
    look: { seed: 5203, head: 4, body: 7, hair: 3, cloth: 0, skin: 1, eyes: 5 }, aura: '#ff9aa8',
  },
  priest_tempus: {
    id: 'priest_tempus', name: 'Warpriest Harkon', title: 'Voice of Tempus', race: 'human', gender: 'male',
    look: { seed: 5305, head: 3, body: 0, hair: 8, cloth: 0, skin: 4, eyes: 3 }, aura: '#ffb070',
  },
  smith: {
    id: 'smith', name: 'Roland', title: 'Master Armourer', race: 'human', gender: 'male',
    look: { seed: 6101, head: 1, body: 3, hair: 2, cloth: 4, skin: 4, eyes: 2 }, aura: '#ff9a50',
  },
  provisioner: {
    id: 'provisioner', name: 'Wilhelmina Tuck', title: 'Provisioner', race: 'halfling', gender: 'female',
    look: { seed: 6203, head: 1, body: 3, hair: 5, cloth: 2, skin: 1, eyes: 1 }, aura: '#ffc27a',
  },
  curio: {
    id: 'curio', name: 'Old Nesmith', title: 'Scribe & Curio Dealer', race: 'gnome', gender: 'male',
    look: { seed: 6305, head: 7, body: 4, hair: 9, cloth: 3, skin: 0, eyes: 5 }, aura: '#a8c8ff',
  },
  barkeep: {
    id: 'barkeep', name: 'Mother Gedda', title: 'Keeper of the Gilded Tankard', race: 'human', gender: 'female',
    look: { seed: 7101, head: 2, body: 5, hair: 4, cloth: 6, skin: 4, eyes: 2 }, aura: '#ffb060',
  },
  bosun: {
    id: 'bosun', name: 'Kell Saltbeard', title: 'Bosun of the Grey Gull', race: 'dwarf', gender: 'male',
    look: { seed: 7203, head: 1, body: 3, hair: 4, cloth: 1, skin: 0, eyes: 0 }, aura: '#9ac0e0',
  },
  trainer: {
    id: 'trainer', name: 'Garrick Ironhand', title: 'Weaponsmaster', race: 'human', gender: 'male',
    look: { seed: 8101, head: 3, body: 1, hair: 8, cloth: 0, skin: 3, eyes: 3 }, aura: '#ffb070',
  },
  sage: {
    id: 'sage', name: 'Ione the Grey', title: 'Mage of the Library', race: 'elf', gender: 'female',
    look: { seed: 8203, head: 4, body: 4, hair: 7, cloth: 3, skin: 0, eyes: 5 }, aura: '#a8c8ff',
  },
  ferran: {
    id: 'ferran', name: 'Ferran Martinez', title: 'Castellan of Sokol Keep', race: 'human', gender: 'male', kind: 'ghost',
    look: { seed: 9101, head: 2, body: 0, hair: 1, cloth: 1, skin: 1, eyes: 5 }, aura: '#8ff0ff',
    desc: 'A knight in antique plate, translucent as mist, the wound that killed him still open at his throat.',
  },
  kobold_chief: {
    id: 'kobold_chief', name: 'Yarash the Toothless', title: 'Kobold Chieftain', kind: 'monster', monster: 'kobold', aura: '#ff7040',
  },
  bane_priest: {
    id: 'bane_priest', name: 'Karvas the Black Hand', title: 'Priest of Bane', race: 'human', gender: 'male', kind: 'hooded',
    look: { seed: 9303, head: 6, body: 4, hair: 0, cloth: 5, skin: 2, eyes: 6 }, aura: '#7dff9a',
  },
  thief_guild: {
    id: 'thief_guild', name: 'Silk', title: 'A Voice in the Shadows', race: 'halfElf', gender: 'female', kind: 'hooded',
    look: { seed: 9405, head: 6, body: 3, hair: 0, cloth: 5, skin: 2, eyes: 1 }, aura: '#c8b0ff',
  },
  merchant_podol: {
    id: 'merchant_podol', name: 'Tobiah Hoss', title: 'Last Merchant of Podol', race: 'human', gender: 'male',
    look: { seed: 9507, head: 5, body: 5, hair: 2, cloth: 6, skin: 5, eyes: 2 }, aura: '#ffc27a',
  },
  gate_captain: {
    id: 'gate_captain', name: 'Captain Oswin', title: 'Watch of New Phlan', race: 'human', gender: 'male',
    look: { seed: 9609, head: 4, body: 1, hair: 1, cloth: 1, skin: 2, eyes: 0 }, aura: '#ffc27a',
  },
  tyranthraxus: {
    id: 'tyranthraxus', name: 'Tyranthraxus', title: 'The Flamed One', kind: 'dragon', aura: '#ffd060',
    desc: 'A great bronze dragon, its eyes burning with a fire that is not its own.',
  },
};

/** @param {string} id */
export function getNpc(id) {
  const n = NPCS[id];
  if (!n) throw new Error(`Unknown NPC "${id}"`);
  return n;
}
