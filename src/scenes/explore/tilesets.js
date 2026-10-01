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
  // dungeon variants keep id 'dungeon' (all dungeon behaviour) and add a `variant` for dressing
  warrens: {
    id: 'dungeon',
    variant: 'warrens',
    outdoors: false,
    walls: ['hewn', 'hewn', 'hewn'],
    interiorFace: 'hewn',
    floors: { [CELL.STREET]: 'arch_cave_floor', [CELL.INTERIOR]: 'arch_cave_floor', [CELL.RUBBLE]: 'arch_cave_floor', [CELL.WATER]: 'arch_water', [CELL.COURTYARD]: 'arch_cave_floor' },
    ceiling: 'arch_hewn',
    ceilH: 3.2,
    roofs: false,
    skyline: null,
    props: 'warrens',
    streetWallH: 3.2,
    buildingH: [3.2],
    particles: ['dust', 'embers', 'fog'],
    grime: 0x18160f,
    moss: 0x2c3c1c,
  },
  bane: {
    id: 'dungeon',
    variant: 'bane',
    outdoors: false,
    walls: ['basalt', 'basalt', 'basalt'],
    interiorFace: 'basalt',
    floors: { [CELL.STREET]: 'arch_basalt_floor', [CELL.INTERIOR]: 'arch_basalt_floor', [CELL.RUBBLE]: 'arch_basalt_floor', [CELL.WATER]: 'arch_water', [CELL.COURTYARD]: 'arch_basalt_floor' },
    ceiling: 'arch_basalt',
    ceilH: 4.0,
    roofs: false,
    skyline: null,
    props: 'bane',
    streetWallH: 4.0,
    buildingH: [4.0],
    particles: ['dust', 'embers', 'fog'],
    grime: 0x100c0c,
    moss: 0x1c1c16,
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
  hewn: ['arch_hewn', 'arch_cave_floor', 'prop_bone'],
  basalt: ['arch_basalt', 'arch_basalt_floor', 'arch_relief', 'arch_trim'],
};

/**
 * Pick the tileset for a map.
 * @param {any} map MapGrid
 * @param {string} [override]
 */
export function tilesetFor(map, override) {
  if (override && TILESETS[override]) return TILESETS[override];
  const ts = map.tileset && TILESETS[map.tileset] ? TILESETS[map.tileset] : map.kind === 'dungeon' ? TILESETS.dungeon : null;
  if (ts === TILESETS.dungeon) return TILESETS[dungeonVariant(map)] ?? ts;
  if (ts) return ts;
  if (map.wallSet === 'ruin' || map.wallSet === 'ruins') return TILESETS.ruins;
  if (map.outdoors === false) return TILESETS.interior;
  return TILESETS.city;
}

/**
 * A generic 'dungeon' map gets a themed variant from its identity: kobold
 * warrens / caves / sewers → rough-hewn 'warrens'; temples of Bane (or any
 * black-hand sanctum) → black basalt 'bane'. Otherwise plain cut-stone.
 */
export function dungeonVariant(map) {
  const id = `${map.id ?? ''} ${map.name ?? ''}`.toLowerCase();
  if (/warren|kobold|cave|sewer|burrow|tunnel/.test(id)) return 'warrens';
  if (/bane|black hand|zhent/.test(id)) return 'bane';
  return null;
}

/** Every material key a tileset may need. */
export function tilesetMaterials(ts) {
  const keys = new Set(['arch_door', 'arch_dressed', 'arch_iron', 'arch_beam', 'arch_beam_dark', 'arch_trim', 'arch_stone', 'arch_brick',
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
