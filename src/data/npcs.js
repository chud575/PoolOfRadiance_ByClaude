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
    figure: { age: 0.6, build: 0.86, hairStyle: 'short', beard: 'none', hair: '#8a7c6a', skin: '#d8ae92', jaw: 0.85, nose: 1.15, pose: 'clerk', outfit: { shirt: '#ece4d0', top: '#283450', topKind: 'robe', sleeves: 'bell', sash: '#18203a', collar: '#18203a', cuff: '#8a8274', spectacles: true } },
    paint: { sex: 'm', age: 0.62, skin: '#e2b898', yaw: -0.3, beard: { style: 'none' }, gaze: [0.12, 0.02], face: { w: 0.96, jaw: 1.08, chin: 0.94, cheek: 1.1, hollow: 0.4, brow: 1.1, neck: 1.1 }, nose: { len: 1.08, w: 0.92, hook: 0.5 }, eyes: { c: '#5a6a72', size: 0.9, lid: 0.6 }, mouth: { w: 0.88, full: 0.7 }, brows: { c: '#8a7a6a', w: 0.85, arch: 0.6 }, hair: { style: 'short', c: '#9a8e80' }, spectacles: true, quill: true, costume: { kind: 'robe', a: '#283450', b: '#ece4d0', collar: '#18203a', ink: true }, bg: ['#4e3e2a', '#0c0806'] },
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
    figure: { age: 0.55, hairStyle: 'bald', beard: 'long', hair: '#e2ded6', skin: '#d4a488', pose: 'judge', outfit: { shirt: '#e0d8c8', top: '#e6e0d2', topKind: 'robe', sleeves: 'bell', stole: '#1d3574', symbol: 'scales', sash: '#1d3574', mantle: '#22346a', mitre: '#8898b8' } },
    paint: { sex: 'm', age: 0.66, skin: '#d8a888', yaw: 0.24, gaze: [-0.1, 0], face: { w: 1.0, jaw: 1.02, cheek: 1.05, brow: 1.2 }, nose: { len: 1.05, w: 1.05 }, eyes: { c: '#4a6a8a', lid: 0.5 }, brows: { c: '#e4e0d8', w: 1.3, arch: 0.2 }, hair: { style: 'none', c: '#d8d4cc' }, beard: { style: 'long', c: '#e6e2da' }, head: { kind: 'mitre', c: '#56647c', mitre: '#8898b8', trim: '#d8b050' }, costume: { kind: 'priest', a: '#e6e0d2', b: '#d8d0c0', collar: '#c8c0b0', stole: '#1d3574', symbol: 'scales', trim: '#d8b050' }, bg: ['#3a4660', '#06080e'] },
  },
  priestess_sune: {
    id: 'priestess_sune', name: 'Mother Ilsabet', title: 'Priestess of Sune', race: 'halfElf', gender: 'female',
    look: { seed: 5203, head: 4, body: 7, hair: 3, cloth: 0, skin: 1, eyes: 5 }, aura: '#ff9aa8',
    figure: { hairStyle: 'wavy', hair: '#9a3418', skin: '#eab896', portraitZoom: 3.5, portraitYaw: 0.2, smile: 0.8, lipC: '#c0404c', jaw: 0.72, nose: 0.85, pose: 'welcome', outfit: { shirt: '#f0d8c8', top: '#9a1e2e', topKind: 'bodice', sleeves: 'long', cuff: '#e8b050', skirt: '#b4243a', sash: '#e8b050', symbol: 'sune', mantle: '#6a0e1a' } },
    paint: { sex: 'f', age: 0.14, skin: '#e6b496', yaw: 0.24, pitch: 0.03, roll: -0.05, gaze: [-0.12, 0.0], face: { w: 0.92, jaw: 0.98, chin: 0.92, cheek: 1.06, hollow: 0.15, neck: 1.08 }, nose: { len: 0.92, w: 0.82, tip: 0.9 }, eyes: { c: '#3a7a5a', size: 0.94, tilt: 0.5, lid: 0.45 }, mouth: { w: 0.96, full: 1.02, smile: 0.25, c: '#b8404a' }, brows: { c: '#7a2a14', w: 0.75, arch: 0.8 }, hair: { style: 'wavy', c: '#9a3418' }, key: [-0.72, -0.45, 0.52], costume: { kind: 'gown', a: '#9a1e2e', b: '#f6ece2', trim: '#e8b050' }, bg: ['#6e3440', '#120608'] },
  },
  priest_tempus: {
    id: 'priest_tempus', name: 'Warpriest Harkon', title: 'Voice of Tempus', race: 'human', gender: 'male',
    look: { seed: 5305, head: 3, body: 0, hair: 8, cloth: 0, skin: 4, eyes: 3 }, aura: '#ffb070',
    figure: { hairStyle: 'short', beard: 'full', build: 1.12, outfit: { shirt: '#5a4a3a', top: '#6a1a14', topKind: 'tabard', symbol: 'tempus', sleeves: 'long', trousers: '#2a241c', boots: '#1e1610', mantle: '#3a0e0a' } },
    paint: { sex: 'm', age: 0.45, skin: '#b88060', yaw: -0.22, gaze: [0.08, 0], face: { w: 1.05, jaw: 1.2, brow: 1.4, neck: 1.3 }, nose: { len: 1.05, w: 1.1, hook: 0.6 }, eyes: { c: '#6a4a2a', lid: 0.4 }, brows: { c: '#2a1a14', w: 1.3, arch: -0.2 }, hair: { style: 'short', c: '#2e2018' }, beard: { style: 'full', c: '#2e2018' }, scar: [[-0.5, -0.4, 0.66], [-0.42, -0.1, 0.74], [-0.36, 0.3, 0.72]], costume: { kind: 'tabard', a: '#6a1a14' }, bg: ['#5a2a1a', '#0c0404'], build: 1.12 },
  },
  smith: {
    id: 'smith', name: 'Roland', title: 'Master Armourer', race: 'human', gender: 'male',
    look: { seed: 6101, head: 1, body: 3, hair: 2, cloth: 4, skin: 4, eyes: 2 }, aura: '#ff9a50',
    figure: { hairStyle: 'short', beard: 'full', build: 1.15, pose: 'smith', outfit: { shirt: '#4e5a6a', sleeves: 'rolled', apron: '#4a2e1a', trousers: '#3a3024', boots: '#24180e' } },
    paint: { sex: 'm', age: 0.42, skin: '#c88a64', yaw: 0.3, gaze: [-0.12, 0.02], face: { w: 1.1, jaw: 1.18, cheek: 1.05, brow: 1.3, neck: 1.35 }, nose: { len: 1.0, w: 1.2 }, eyes: { c: '#4a3a2a', size: 0.92 }, brows: { c: '#3a2414', w: 1.3 }, hair: { style: 'short', c: '#4a2c18' }, beard: { style: 'full', c: '#5a3420' }, costume: { kind: 'smith', a: '#4e5a6a', b: '#d8ccb0', apron: '#4a2e1a' }, bg: ['#6a3a1a', '#0e0604'], build: 1.15 },
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
    figure: { age: 0.35, hairStyle: 'bun', hair: '#8a3a1e', skin: '#d29a72', lipC: '#b04a4c', smile: 0.6, build: 1.12, belly: true, pose: 'barkeep', outfit: { shirt: '#e6dcc4', top: '#3a2420', topKind: 'bodice', sleeves: 'rolled', skirt: '#6a2a20', apron: '#e2d8c0' } },
    paint: { sex: 'f', age: 0.48, skin: '#d8a07c', yaw: -0.24, gaze: [0.1, 0], face: { w: 1.1, jaw: 1.08, cheek: 1.0, neck: 1.1 }, nose: { len: 1.0, w: 1.15, tip: 1.15 }, eyes: { c: '#5a3a24' }, mouth: { w: 1.02, full: 0.82, smile: 0.7, c: '#b04a4c' }, brows: { c: '#6a2a14', w: 1.0 }, hair: { style: 'bun', c: '#8a3a1e' }, costume: { kind: 'bodice', a: '#3a2420', b: '#e6dcc4', kerchief: '#c8b89a' }, bg: ['#5a3a1e', '#0e0804'] },
  },
  bosun: {
    id: 'bosun', name: 'Kell Saltbeard', title: 'Bosun of the Grey Gull', race: 'dwarf', gender: 'male',
    look: { seed: 7203, head: 1, body: 3, hair: 4, cloth: 1, skin: 0, eyes: 0 }, aura: '#9ac0e0',
    figure: { hairStyle: 'short', beard: 'long', outfit: { shirt: '#d0c8b0', top: '#2a3a5a', topKind: 'jerkin', sleeves: 'rolled', trousers: '#3a3a40', boots: '#1e1810', sash: '#8a1a1a' } },
  },
  trainer: {
    id: 'trainer', name: 'Garrick Ironhand', title: 'Weaponsmaster', race: 'human', gender: 'male',
    look: { seed: 8101, head: 3, body: 1, hair: 8, cloth: 0, skin: 3, eyes: 3 }, aura: '#ffb070',
    figure: { age: 0.45, hairStyle: 'short', beard: 'braided', hair: '#8a8278', jaw: 1.25, nose: 1.2, build: 1.24, pose: 'trainer', outfit: { shirt: '#6a2a1e', top: '#8a8c94', topKind: 'chain', skirtMail: true, skirtLen: 'knee', sleeves: 'long', trousers: '#2e261c', boots: '#2a1c10', belt: '#3a2616', mantle: '#5a1e16' } },
    paint: { sex: 'm', age: 0.52, skin: '#c48e6c', yaw: -0.36, gaze: [0.14, -0.02], face: { w: 1.14, jaw: 1.32, chin: 1.05, cheek: 1.12, hollow: 0.3, brow: 1.6, neck: 1.3 }, nose: { len: 0.96, w: 1.3, broken: 1 }, eyes: { c: '#5a4a3a', size: 0.84, lid: 0.75 }, brows: { c: '#7a7068', w: 1.45, arch: -0.3 }, hair: { style: 'short', c: '#8a8278' }, beard: { style: 'braided', c: '#a8a096' }, scar: true, costume: { kind: 'mail', b: '#5a3a22', cloak: '#6a1e16', clasp: true }, bg: ['#4a3a2a', '#0a0806'], build: 1.22 },
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
