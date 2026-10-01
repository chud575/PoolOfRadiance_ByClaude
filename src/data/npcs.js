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
    look: { seed: 4101, head: 3, body: 4, hair: 8, cloth: 6, skin: 1, eyes: 4 }, aura: '#ffcf8a',
    desc: 'A stooped, ink-stained man with spectacles on a ribbon and a ledger never far from his hand.',
    figure: { age: 0.6, hairStyle: 'bald', beard: 'full', hair: '#b8b0a4', pose: 'clerk', outfit: { shirt: '#d8ccb0', top: '#3a4a6a', topKind: 'robe', sleeves: 'bell', sash: '#7a1e1e', collar: '#1e1e28', cuff: '#d8ccb0' } },
  },
  councilman: {
    id: 'councilman', name: 'Porphyrys Cadorna', title: 'First Councilman', race: 'human', gender: 'male',
    look: { seed: 4203, head: 2, body: 5, hair: 1, cloth: 3, skin: 3, eyes: 2 }, aura: '#e8b060',
    desc: 'Silk and rings and a smile that never reaches the eyes.',
    figure: { hairStyle: 'short', beard: 'goatee', belly: true, outfit: { shirt: '#e8dcc0', top: '#5a1a3a', topKind: 'doublet', sleeves: 'puffed', trousers: '#2a1a24', boots: '#1a1410', mantle: '#2a0e1e', collar: '#d8b050' } },
  },
  bishop: {
    id: 'bishop', name: 'Bishop Braccio', title: 'Council of Phlan', race: 'human', gender: 'male',
    look: { seed: 4305, head: 3, body: 7, hair: 8, cloth: 1, skin: 2, eyes: 0 }, aura: '#bcd4ff',
    figure: { age: 0.5, hairStyle: 'bald', outfit: { shirt: '#e8e0d0', top: '#e0dccf', topKind: 'robe', stole: '#1d3574', symbol: 'scales', belt: false } },
  },
  priest_tyr: {
    id: 'priest_tyr', name: 'Brother Ohlo', title: 'High Priest of Tyr', race: 'human', gender: 'male',
    look: { seed: 5101, head: 7, body: 7, hair: 9, cloth: 1, skin: 1, eyes: 0 }, aura: '#bcd4ff',
    figure: { age: 0.55, hairStyle: 'bald', beard: 'long', hair: '#c8c0b4', pose: 'bless', outfit: { shirt: '#e0d8c8', top: '#e6e0d2', topKind: 'robe', sleeves: 'bell', stole: '#1d3574', symbol: 'scales', sash: '#1d3574', mantle: '#22346a' } },
  },
  priestess_sune: {
    id: 'priestess_sune', name: 'Mother Ilsabet', title: 'Priestess of Sune', race: 'halfElf', gender: 'female',
    look: { seed: 5203, head: 4, body: 7, hair: 3, cloth: 0, skin: 1, eyes: 5 }, aura: '#ff9aa8',
    figure: { hairStyle: 'wavy', hair: '#b8321e', pose: 'welcome', outfit: { shirt: '#f0d8c8', top: '#9a1e2e', topKind: 'bodice', sleeves: 'bell', skirt: '#b4243a', sash: '#e8b050', symbol: 'sune', mantle: '#6a0e1a' } },
  },
  priest_tempus: {
    id: 'priest_tempus', name: 'Warpriest Harkon', title: 'Voice of Tempus', race: 'human', gender: 'male',
    look: { seed: 5305, head: 3, body: 0, hair: 8, cloth: 0, skin: 4, eyes: 3 }, aura: '#ffb070',
    figure: { hairStyle: 'short', beard: 'full', build: 1.12, outfit: { shirt: '#5a4a3a', top: '#6a1a14', topKind: 'tabard', symbol: 'tempus', sleeves: 'long', trousers: '#2a241c', boots: '#1e1610', mantle: '#3a0e0a' } },
  },
  smith: {
    id: 'smith', name: 'Roland', title: 'Master Armourer', race: 'human', gender: 'male',
    look: { seed: 6101, head: 1, body: 3, hair: 2, cloth: 4, skin: 4, eyes: 2 }, aura: '#ff9a50',
    figure: { hairStyle: 'short', beard: 'full', build: 1.15, pose: 'smith', outfit: { shirt: '#8a7a5e', sleeves: 'rolled', apron: '#4a2e1a', trousers: '#3a3024', boots: '#24180e' } },
  },
  provisioner: {
    id: 'provisioner', name: 'Wilhelmina Tuck', title: 'Provisioner', race: 'halfling', gender: 'female',
    look: { seed: 6203, head: 1, body: 3, hair: 5, cloth: 2, skin: 1, eyes: 1 }, aura: '#ffc27a',
    figure: { hairStyle: 'bun', pose: 'welcome', belly: true, outfit: { shirt: '#e8dcc0', top: '#3a6a3a', topKind: 'bodice', sleeves: 'rolled', skirt: '#7a5a2a', apron: '#e0d6bc' } },
  },
  curio: {
    id: 'curio', name: 'Old Nesmith', title: 'Scribe & Curio Dealer', race: 'gnome', gender: 'male',
    look: { seed: 6305, head: 2, body: 4, hair: 8, cloth: 3, skin: 0, eyes: 5 }, aura: '#a8c8ff',
    figure: { age: 0.7, hairStyle: 'bald', beard: 'long', hair: '#d0ccc4', outfit: { shirt: '#7a6a8a', top: '#3a2a5a', topKind: 'robe', sleeves: 'bell', sash: '#c8a040' } },
  },
  barkeep: {
    id: 'barkeep', name: 'Mother Gedda', title: 'Keeper of the Gilded Tankard', race: 'human', gender: 'female',
    look: { seed: 7101, head: 2, body: 5, hair: 4, cloth: 6, skin: 4, eyes: 2 }, aura: '#ffb060',
    figure: { age: 0.35, hairStyle: 'bun', hair: '#8a3a1e', build: 1.12, belly: true, pose: 'barkeep', outfit: { shirt: '#e6dcc4', top: '#3a2420', topKind: 'bodice', sleeves: 'rolled', skirt: '#6a2a20', apron: '#e2d8c0' } },
  },
  bosun: {
    id: 'bosun', name: 'Kell Saltbeard', title: 'Bosun of the Grey Gull', race: 'dwarf', gender: 'male',
    look: { seed: 7203, head: 1, body: 3, hair: 4, cloth: 1, skin: 0, eyes: 0 }, aura: '#9ac0e0',
    figure: { hairStyle: 'short', beard: 'long', outfit: { shirt: '#d0c8b0', top: '#2a3a5a', topKind: 'jerkin', sleeves: 'rolled', trousers: '#3a3a40', boots: '#1e1810', sash: '#8a1a1a' } },
  },
  trainer: {
    id: 'trainer', name: 'Garrick Ironhand', title: 'Weaponsmaster', race: 'human', gender: 'male',
    look: { seed: 8101, head: 3, body: 1, hair: 8, cloth: 0, skin: 3, eyes: 3 }, aura: '#ffb070',
    figure: { hairStyle: 'short', beard: 'stubble', build: 1.15, pose: 'trainer', outfit: { shirt: '#6a2a1e', top: '#8a8c94', topKind: 'chain', sleeves: 'long', trousers: '#3a3024', boots: '#2a1c10', belt: '#3a2616' } },
  },
  sage: {
    id: 'sage', name: 'Ione the Grey', title: 'Mage of the Library', race: 'elf', gender: 'female',
    look: { seed: 8203, head: 4, body: 4, hair: 7, cloth: 3, skin: 0, eyes: 5 }, aura: '#a8c8ff',
    figure: { hairStyle: 'long', hair: '#d8d4cc', outfit: { shirt: '#c8c8d8', top: '#3a4a7a', topKind: 'robe', sleeves: 'bell', sash: '#c8b070' } },
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
    figure: { hairStyle: 'short', outfit: { shirt: '#141414', top: '#0e0e0e', topKind: 'robe', sleeves: 'bell', hood: '#121212', stole: '#1a4a1a', symbol: 'bane', sash: '#1a3a1a' } },
  },
  thief_guild: {
    id: 'thief_guild', name: 'Silk', title: 'A Voice in the Shadows', race: 'halfElf', gender: 'female', kind: 'hooded',
    look: { seed: 9405, head: 6, body: 3, hair: 0, cloth: 5, skin: 2, eyes: 1 }, aura: '#c8b0ff',
    figure: { hairStyle: 'long', hair: '#1a1210', outfit: { shirt: '#2a2a34', top: '#1e1e26', topKind: 'jerkin', sleeves: 'long', trousers: '#18181e', boots: '#121010', hood: '#1a1a22', mantle: '#16161c' } },
  },
  merchant_podol: {
    id: 'merchant_podol', name: 'Tobiah Hoss', title: 'Last Merchant of Podol', race: 'human', gender: 'male',
    look: { seed: 9507, head: 5, body: 5, hair: 2, cloth: 6, skin: 5, eyes: 2 }, aura: '#ffc27a',
    figure: { hairStyle: 'short', beard: 'moustache', belly: true, outfit: { shirt: '#d8ccb0', top: '#7a5a1e', topKind: 'doublet', sleeves: 'puffed', trousers: '#3a2a1a', boots: '#24180e' } },
  },
  gate_captain: {
    id: 'gate_captain', name: 'Captain Oswin', title: 'Watch of New Phlan', race: 'human', gender: 'male',
    look: { seed: 9609, head: 4, body: 1, hair: 1, cloth: 1, skin: 2, eyes: 0 }, aura: '#ffc27a',
    figure: { hairStyle: 'short', beard: 'moustache', outfit: { shirt: '#4a4a5a', top: '#1d3574', topKind: 'tabard', symbol: 'tower', sleeves: 'long', trousers: '#2a2a30', boots: '#1a1410' } },
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
