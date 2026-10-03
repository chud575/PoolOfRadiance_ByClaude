import { MapGrid, EDGE, CELL } from './MapGrid.js';
import { applyTravel, sign, hiddenRoom } from './helpers.js';

/**
 * New Phlan — the civilized quarter behind the palisade: City Hall, the
 * temples of Tyr, Sune and Tempus, the training hall, shops, two taverns and
 * the docks where the Grey Gull rows out to Sokol Keep.
 * Edge styles: 0 = dressed stone, 1 = timber & plaster, 2 = ruin.
 */
export function buildPhlanCivilized() {
  const m = new MapGrid({ id: 'phlan_civilized', name: 'New Phlan', kind: 'city', wallSet: 'phlan_stone', outdoors: true, start: { x: 4, y: 14, dir: 'N' } });
  m.tileset = 'city';
  m.border(EDGE.WALL, 0);
  m.fill(0, 0, 16, 16, CELL.STREET);

  // The harbour: the south row is the Moonsea, with one pier.
  m.fill(0, 15, 10, 1, CELL.WATER);
  m.setCell(4, 15, CELL.STREET);
  m.setEdge(4, 15, 'W', EDGE.WALL, 1).setEdge(4, 15, 'E', EDGE.WALL, 1);

  // Civic heart.
  m.fill(9, 5, 6, 1, CELL.COURTYARD);
  m.fill(5, 5, 4, 4, CELL.COURTYARD);
  m.building(9, 1, 6, 4, { style: 0, doors: [{ x: 11, y: 4, dir: 'S' }] }); // City Hall
  m.building(1, 1, 4, 3, { style: 0, doors: [{ x: 2, y: 3, dir: 'S' }] }); // Temple of Tyr
  m.building(6, 1, 2, 2, { style: 1, doors: [{ x: 6, y: 2, dir: 'S' }] }); // Roland's
  m.building(1, 6, 3, 3, { style: 1, doors: [{ x: 3, y: 7, dir: 'E' }] }); // Temple of Sune
  m.building(12, 6, 3, 3, { style: 0, doors: [{ x: 12, y: 7, dir: 'W' }] }); // Hall of Tempus
  m.building(12, 10, 3, 2, { style: 1, doors: [{ x: 12, y: 11, dir: 'W' }] }); // Training hall
  m.building(6, 10, 4, 3, { style: 1, doors: [{ x: 6, y: 11, dir: 'W' }] }); // Gilded Tankard
  m.building(1, 10, 3, 2, { style: 1, doors: [{ x: 3, y: 10, dir: 'E' }] }); // Tuck's
  m.building(1, 12, 2, 2, { style: 1, doors: [{ x: 2, y: 13, dir: 'S' }] }); // Silver Quill
  m.building(13, 12, 2, 2, { style: 1, doors: [{ x: 13, y: 13, dir: 'W' }] }); // Broken Oar
  // Palisade stubs by the slum gate.
  m.setEdge(14, 13, 'S', EDGE.WALL, 1).setEdge(15, 13, 'S', EDGE.WALL, 1);

  m.zone('City Hall', 9, 1, 6, 4);
  m.zone('Temple of Tyr', 1, 1, 4, 3);
  m.zone('Temple of Sune', 1, 6, 3, 3);
  m.zone('Temple of Tempus', 12, 6, 3, 3);
  m.zone('Hall of Training', 12, 10, 3, 2);
  m.zone('The Gilded Tankard', 6, 10, 4, 3);
  m.zone("Roland's Arms & Armour", 6, 1, 2, 2);
  m.zone("Tuck's Provisions", 1, 10, 3, 2);
  m.zone('The Silver Quill', 1, 12, 2, 2);
  m.zone('The Broken Oar', 13, 12, 2, 2);
  m.zone('Council Square', 5, 5, 10, 4);
  m.zone('The Docks', 0, 14, 10, 2);
  m.zone('Slum Gate', 14, 13, 2, 3);

  sign(m, 'civ_sign_hall', 11, 5, 'Carved over the great doors: "THE COUNCIL OF PHLAN"');
  sign(m, 'civ_sign_tyr', 2, 4, 'Letters of gilt above the temple doors: "TYR SEES ALL"');
  sign(m, 'civ_sign_sune', 4, 7, 'Roses are carved around the doors: "BEAUTY ENDURES"');
  sign(m, 'civ_sign_tempus', 11, 7, 'A notched iron plaque: "TEMPUS FOEHAMMER"');

  m.event({ id: 'civ_hall', x: 11, y: 4, type: 'shop', ref: 'city_hall' });
  m.event({ id: 'civ_tyr', x: 2, y: 3, type: 'shop', ref: 'temple_tyr' });
  m.event({ id: 'civ_sune', x: 3, y: 7, type: 'shop', ref: 'temple_sune' });
  m.event({ id: 'civ_tempus', x: 12, y: 7, type: 'shop', ref: 'temple_tempus' });
  m.event({ id: 'civ_training', x: 12, y: 11, type: 'shop', ref: 'training_hall' });
  m.event({ id: 'civ_armory', x: 6, y: 2, type: 'shop', ref: 'phlan_armory' });
  m.event({ id: 'civ_tankard', x: 6, y: 11, type: 'shop', ref: 'tavern_tankard' });
  m.event({ id: 'civ_tuck', x: 3, y: 10, type: 'shop', ref: 'provisioner' });
  m.event({ id: 'civ_quill', x: 2, y: 13, type: 'shop', ref: 'curio' });
  m.event({ id: 'civ_oar', x: 13, y: 13, type: 'shop', ref: 'tavern_oar' });
  m.event({ id: 'civ_crier', x: 7, y: 8, type: 'encounter', ref: 'ev_crier', once: true });
  m.event({ id: 'civ_captain', x: 14, y: 14, type: 'encounter', ref: 'ev_gate_captain', once: true });
  m.event({ id: 'civ_silk', x: 11, y: 9, type: 'encounter', ref: 'ev_silk', once: true });
  m.event({ id: 'civ_docks', x: 5, y: 14, type: 'text', text: 'Gulls wheel over the pier. Out on the grey water, the black walls of Sokol Keep sit on their island like a crouching animal.' });
  // behind the Tankard's cellar wall: the smugglers' back room the Watch pretends not to know about
  hiddenRoom(m, { id: 'civ_tankard_backroom', room: [8, 13, 2, 1], door: [8, 12, 'S'], style: 1, cell: CELL.INTERIOR, at: [9, 13],
    text: 'A smugglers\' back room: kegs without excise marks, a ledger in cipher, and a forgotten stake from last night\'s dice.', gold: 45 });
  applyTravel(m);
  return m;
}
