import { CELL } from '../../data/maps/MapGrid.js';

/**
 * Explore tilesets. A map picks one with its `tileset` field
 * ('city' | 'ruins' | 'dungeon' | 'interior'); otherwise it is inferred from
 * kind/wallSet/outdoors. The debug URL may override with &tileset=.
 *
 * walls[styleIndex] → wall recipe id (see BlockBuilder recipes):
 *   stone | timber | ruin | ruin_timber | dungeon | dungeon_brick | cave | int_plaster | int_panel | int_stone
 * floors[CELL] → material key; interiorFace → recipe used on the inside of roofed cells.
 */
export const TILESETS = {
  city: {
    id: 'city',
    outdoors: true,
    walls: ['stone', 'timber', 'ruin'],
    interiorFace: 'int_plaster',
    floors: { [CELL.STREET]: 'arch_cobble', [CELL.INTERIOR]: 'arch_boards', [CELL.RUBBLE]: 'arch_mud', [CELL.WATER]: 'arch_water', [CELL.COURTYARD]: 'arch_flags' },
    ceiling: 'arch_ceiling',
    ceilH: 3.3,
    roofs: true,
    skyline: 'city',
    props: 'city',
    streetWallH: 3.4,
    buildingH: [5.4, 6.2, 4.6],
    particles: ['dust', 'fog', 'fireflies', 'embers', 'smoke'],
    grime: 0x2a2418,
    moss: 0x3c4a22,
  },
  ruins: {
    id: 'ruins',
    outdoors: true,
    walls: ['ruin', 'ruin_timber', 'ruin'],
    interiorFace: 'int_stone',
    floors: { [CELL.STREET]: 'arch_mud', [CELL.INTERIOR]: 'arch_flags', [CELL.RUBBLE]: 'arch_mud', [CELL.WATER]: 'arch_water', [CELL.COURTYARD]: 'arch_flags' },
    ceiling: null,
    ceilH: 3.3,
    roofs: false,
    skyline: 'ruins',
    props: 'ruins',
    streetWallH: 3.0,
    buildingH: [4.8, 5.6, 4.0],
    particles: ['dust', 'fog', 'fireflies', 'embers'],
    grime: 0x242018,
    moss: 0x34461e,
  },
  dungeon: {
    id: 'dungeon',
    outdoors: false,
    walls: ['dungeon', 'dungeon_brick', 'cave'],
    interiorFace: 'dungeon',
    floors: { [CELL.STREET]: 'arch_dungeon_floor', [CELL.INTERIOR]: 'arch_dungeon_floor', [CELL.RUBBLE]: 'arch_mud', [CELL.WATER]: 'arch_water', [CELL.COURTYARD]: 'arch_dungeon_floor' },
    ceiling: 'arch_dungeon',
    ceilH: 3.6,
    roofs: false,
    skyline: null,
    props: 'dungeon',
    streetWallH: 3.6,
    buildingH: [3.6],
    particles: ['dust', 'embers', 'fog'],
    grime: 0x1a1c16,
    moss: 0x2a3a1e,
  },
  interior: {
    id: 'interior',
    outdoors: false,
    walls: ['int_plaster', 'int_panel', 'int_stone'],
    interiorFace: 'int_plaster',
    floors: { [CELL.STREET]: 'arch_boards', [CELL.INTERIOR]: 'arch_boards', [CELL.RUBBLE]: 'arch_flags', [CELL.WATER]: 'arch_water', [CELL.COURTYARD]: 'arch_flags' },
    ceiling: 'arch_ceiling',
    ceilH: 3.3,
    roofs: false,
    skyline: null,
    props: 'interior',
    streetWallH: 3.3,
    buildingH: [3.3],
    particles: ['dust', 'embers'],
    grime: 0x2a2018,
    moss: 0x3a3a24,
  },
};

/** Material keys each wall recipe uses (for texture preloading). */
export const RECIPE_MATERIALS = {
  stone: ['arch_stone', 'arch_trim', 'arch_beam_dark'],
  timber: ['arch_plaster', 'arch_beam', 'arch_stone', 'arch_trim'],
  ruin: ['arch_ruin', 'arch_beam_dark'],
  ruin_timber: ['arch_plaster', 'arch_beam_dark', 'arch_ruin'],
  dungeon: ['arch_dungeon', 'arch_trim'],
  dungeon_brick: ['arch_brick', 'arch_dungeon'],
  cave: ['arch_ruin'],
  int_plaster: ['arch_plaster_int', 'arch_wainscot', 'arch_beam_dark'],
  int_panel: ['arch_wainscot', 'arch_beam_dark', 'arch_plaster_int'],
  int_stone: ['arch_stone_cold', 'arch_trim'],
};

/**
 * Pick the tileset for a map.
 * @param {any} map MapGrid
 * @param {string} [override]
 */
export function tilesetFor(map, override) {
  if (override && TILESETS[override]) return TILESETS[override];
  if (map.tileset && TILESETS[map.tileset]) return TILESETS[map.tileset];
  if (map.kind === 'dungeon') return TILESETS.dungeon;
  if (map.wallSet === 'ruin' || map.wallSet === 'ruins') return TILESETS.ruins;
  if (map.outdoors === false) return TILESETS.interior;
  return TILESETS.city;
}

/** Every material key a tileset may need. */
export function tilesetMaterials(ts) {
  const keys = new Set(['arch_door', 'arch_iron', 'arch_beam', 'arch_beam_dark', 'arch_trim', 'arch_stone', 'arch_brick',
    'prop_staves', 'prop_crate', 'prop_iron', 'prop_burlap', 'prop_rubble', 'prop_rock', 'prop_wood', 'prop_stone', 'prop_limestone']);
  for (const w of ts.walls) for (const k of RECIPE_MATERIALS[w] ?? []) keys.add(k);
  for (const k of RECIPE_MATERIALS[ts.interiorFace] ?? []) keys.add(k);
  for (const k of Object.values(ts.floors)) keys.add(k);
  if (ts.ceiling) keys.add(ts.ceiling);
  if (ts.roofs) ['arch_roof_slate', 'arch_roof_clay', 'arch_roof_shake', 'arch_plaster'].forEach((k) => keys.add(k));
  if (ts.skyline) ['arch_plaster', 'arch_stone', 'arch_ruin', 'arch_roof_slate', 'arch_roof_clay', 'arch_stone_cold'].forEach((k) => keys.add(k));
  if (ts.id === 'interior') ['arch_plaster_int', 'arch_wainscot', 'arch_boards'].forEach((k) => keys.add(k));
  return [...keys];
}
