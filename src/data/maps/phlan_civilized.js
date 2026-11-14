import { MapGrid, EDGE, CELL, DIR_VEC } from './MapGrid.js';
import { applyTravel, sign, hiddenRoom } from './helpers.js';

/**
 * New Phlan — the civilized quarter, laid out on the 1988 street plan (16 columns by 15 rows,
 * north up; row 15 is open water south of the quay). The classic-mode pictures in
 * src/assets/classic/views/ were drawn square by square against this plan, so a wall moved here
 * is a picture that no longer matches.
 *
 * One character per square: '.' street, '~' water, anything else a building (squares sharing a
 * letter are one building, open inside). Every edge between a building and anything that is not
 * the same building is a wall; doors are listed below.
 */
const PLAN = [
  '.....TTTTT...~~~', //  0  T training hall
  '.SSS..TTTT.BB...', //  1  S temple of Sune, B boatkeeper's, then the north quay
  '.S....TTTT...~~~', //  2
  '.S.........Y....', //  3  Y temple of Tyr
  '....H...YYYY.~~~', //  4  H city hall; the Slum Gate is in the west wall of this row
  'PPP.HHH...Y.....', //  5  P the walled park
  'xP..HHH.YYY..~~~', //  6  x solid masonry
  'PPP.HHH.........', //  7
  'xP..HHH.VVVV.a.b', //  8  V the Gilded Tankard
  'PPP.HHH.RR......', //  9  R Roland's
  '.P..HHH.KK.cc.dd', // 10  K Tuck's
  '........QQ.c....', // 11  Q the Silver Quill
  'M.M.O.e....c.~.f', // 12  M temple of Tempus, O the Broken Oar
  'MMM.O.e.ggg..~.f', // 13
  'MMM..........~.f', // 14  the south quay
  '~~~~~~~~~~~~~~~~', // 15
];

/** Wall style per building: 0 = dressed stone, 1 = timber & plaster. Unlisted buildings are timber. */
const STONE = new Set(['T', 'Y', 'H', 'M', 'P', 'x']);

const DOORS = [
  [1, 1, 'N'], // Temple of Sune
  [6, 1, 'W'], // Training hall
  [4, 4, 'N'], // City Hall
  [11, 3, 'N'], // Temple of Tyr
  [2, 12, 'N'], // Temple of Tempus
  [10, 8, 'N'], // Gilded Tankard
  [8, 9, 'W'], // Roland's
  [9, 10, 'E'], // Tuck's
  [9, 11, 'S'], // Silver Quill
  [4, 12, 'N'], // Broken Oar
  [11, 1, 'S'], // the boatkeeper's: the only way through to the north quay
  [12, 1, 'E'],
];

export function buildPhlanCivilized() {
  const m = new MapGrid({ id: 'phlan_civilized', name: 'New Phlan', kind: 'city', wallSet: 'phlan_stone', outdoors: true, start: { x: 0, y: 0, dir: 'E' } });
  m.tileset = 'city';
  m.border(EDGE.WALL, 0);

  const at = (x, y) => PLAN[y]?.[x] ?? '~';
  const open = (c) => c === '.' || c === '~';
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const c = at(x, y);
      m.setCell(x, y, c === '.' ? CELL.STREET : c === '~' ? CELL.WATER : c === 'P' ? CELL.COURTYARD : CELL.INTERIOR);
      for (const d of ['E', 'S']) {
        const n = at(x + DIR_VEC[d][0], y + DIR_VEC[d][1]);
        if (n === c || (open(c) && open(n))) continue;
        const b = open(c) ? n : c;
        m.setEdge(x, y, d, EDGE.WALL, STONE.has(b) ? 0 : 1);
      }
    }
  }
  for (const [x, y, dir] of DOORS) m.setEdge(x, y, dir, EDGE.DOOR, m.getEdgeStyle(x, y, dir));

  // one rectangle per name (the automap letters each zone once): the main body of each building
  m.zone('Temple of Sune', 1, 1, 3, 1);
  m.zone('Hall of Training', 6, 1, 4, 2);
  m.zone('Temple of Tyr', 8, 4, 4, 1);
  m.zone('City Hall', 4, 5, 3, 6);
  m.zone('Temple of Tempus', 0, 12, 3, 3);
  m.zone('The Gilded Tankard', 8, 8, 4, 1);
  m.zone("Roland's Arms & Armour", 8, 9, 2, 1);
  m.zone("Tuck's Provisions", 8, 10, 2, 1);
  m.zone('The Silver Quill', 8, 11, 2, 1);
  m.zone('The Broken Oar', 4, 12, 1, 2);
  m.zone("The Boatkeeper's", 11, 1, 2, 1);
  m.zone('Slum Gate', 0, 3, 3, 2);
  m.zone('The Park', 0, 5, 3, 6);
  m.zone('The Docks', 13, 0, 3, 8);
  m.zone('South Quay', 3, 14, 13, 1);

  sign(m, 'civ_sign_hall', 4, 3, 'Carved over the great doors: "THE COUNCIL OF PHLAN"');
  sign(m, 'civ_sign_tyr', 11, 2, 'Letters of gilt above the temple doors: "TYR SEES ALL"');
  sign(m, 'civ_sign_sune', 1, 0, 'Roses are carved around the doors: "BEAUTY ENDURES"');
  sign(m, 'civ_sign_tempus', 2, 11, 'A notched iron plaque: "TEMPUS FOEHAMMER"');

  m.event({ id: 'civ_hall', x: 4, y: 4, type: 'shop', ref: 'city_hall' });
  m.event({ id: 'civ_tyr', x: 11, y: 3, type: 'shop', ref: 'temple_tyr' });
  m.event({ id: 'civ_sune', x: 1, y: 1, type: 'shop', ref: 'temple_sune' });
  m.event({ id: 'civ_tempus', x: 2, y: 12, type: 'shop', ref: 'temple_tempus' });
  m.event({ id: 'civ_training', x: 6, y: 1, type: 'shop', ref: 'training_hall' });
  m.event({ id: 'civ_armory', x: 8, y: 9, type: 'shop', ref: 'phlan_armory' });
  m.event({ id: 'civ_tankard', x: 10, y: 8, type: 'shop', ref: 'tavern_tankard' });
  m.event({ id: 'civ_tuck', x: 9, y: 10, type: 'shop', ref: 'provisioner' });
  m.event({ id: 'civ_quill', x: 9, y: 11, type: 'shop', ref: 'curio' });
  m.event({ id: 'civ_oar', x: 4, y: 12, type: 'shop', ref: 'tavern_oar' });
  m.event({ id: 'civ_crier', x: 7, y: 8, type: 'encounter', ref: 'ev_crier', once: true });
  m.event({ id: 'civ_captain', x: 1, y: 4, type: 'encounter', ref: 'ev_gate_captain', once: true });
  m.event({ id: 'civ_silk', x: 11, y: 9, type: 'encounter', ref: 'ev_silk', once: true });
  m.event({ id: 'civ_docks', x: 14, y: 1, type: 'text', text: 'Gulls wheel over the quay. Out on the grey water, the black walls of Sokol Keep sit on their island like a crouching animal.' });
  // behind the Tankard's west wall: the smugglers' back room the Watch pretends not to know about
  hiddenRoom(m, { id: 'civ_tankard_backroom', room: [8, 8, 1, 1], door: [9, 8, 'W'], style: 1, cell: CELL.INTERIOR, at: [8, 8],
    text: 'A smugglers\' back room: kegs without excise marks, a ledger in cipher, and a forgotten stake from last night\'s dice.', gold: 45 });
  applyTravel(m);
  return m;
}
