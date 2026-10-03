import * as G from './generators.js';
import * as HD from './generatorsHD.js';
import * as HD2 from './generatorsHD2.js';

/**
 * Texture set definitions (pure JS: importable from Web Workers).
 * size: power of two; gen: () => (u,v) => {c,h,r}; normalStrength; cavity (albedo AO from height).
 * `hd: true` sets use materialData() orientation (DataTexture, bottom-up rows).
 * Never change the meaning of an existing key; add new keys instead.
 */
export const TEXTURE_DEFS = {
  // ---- foundation v0.1 sets (used by combat/camp/title/create) ----
  wall_stone: { size: 512, gen: () => HD.ashlar({ seed: 11, rows: 7, palette: 'warm' }), normalStrength: 5 },
  wall_timber: { size: 512, gen: () => G.timberPlaster({ seed: 12 }), normalStrength: 2 },
  wall_ruin: { size: 512, gen: () => G.ruinStone({ seed: 13 }), normalStrength: 3 },
  floor_cobble: { size: 512, gen: () => HD.cobbleSetts({ seed: 14, scale: 9 }), normalStrength: 6 },
  floor_flag: { size: 512, gen: () => HD.crazyFlags({ seed: 15, scale: 4 }), normalStrength: 5 },
  floor_wood: { size: 256, gen: () => G.planks({ seed: 16 }), normalStrength: 2 },
  floor_rubble: { size: 256, gen: () => G.rubbleGround({ seed: 17 }), normalStrength: 3 },
  door_wood: { size: 256, gen: () => G.planks({ seed: 18, count: 4, vertical: true, base: [0.32, 0.19, 0.1], studs: true }), normalStrength: 3 },
  ceiling_wood: { size: 256, gen: () => G.planks({ seed: 19, count: 6, base: [0.22, 0.14, 0.08] }), normalStrength: 2 },

  // ---- explore HD sets (world-scaled; see materials.js texScale) ----
  hd_ashlar: { size: 512, gen: () => HD.ashlar({ seed: 21, rows: 10, minW: 0.12, maxW: 0.26, palette: 'warm' }), normalStrength: 4, cavity: 0.18 },
  hd_ashlar_cold: { size: 512, gen: () => HD.ashlar({ seed: 22, rows: 9, minW: 0.13, maxW: 0.28, palette: 'cold', moss: 0.6 }), normalStrength: 4, cavity: 0.18 },
  hd_ruin: { size: 512, gen: () => HD.ashlar({ seed: 23, rows: 8, minW: 0.14, maxW: 0.3, palette: 'cold', erosion: 2.2, moss: 1, mortarW: 0.008 }), normalStrength: 5, cavity: 0.2 },
  hd_plaster: { size: 512, gen: () => HD.plaster({ seed: 31 }), normalStrength: 3, cavity: 0.2 },
  hd_plaster_int: { size: 512, gen: () => HD.plaster({ seed: 32, base: [0.74, 0.66, 0.52], decay: 0.45, interior: true }), normalStrength: 3 },
  hd_beam: { size: 256, gen: () => HD.oakBeam({ seed: 41 }), normalStrength: 4 },
  hd_beam_dark: { size: 256, gen: () => HD.oakBeam({ seed: 42, base: [0.16, 0.11, 0.08], grey: 0.15 }), normalStrength: 4 },
  hd_roof_slate: { size: 512, gen: () => HD.roofTiles({ seed: 51, kind: 'slate' }), normalStrength: 5 },
  hd_roof_clay: { size: 512, gen: () => HD.roofTiles({ seed: 52, kind: 'clay', courses: 12, perCourse: 10 }), normalStrength: 7 },
  hd_roof_shake: { size: 512, gen: () => HD.roofTiles({ seed: 53, kind: 'shake', courses: 12, perCourse: 11, moss: 0.8 }), normalStrength: 6 },
  hd_cobble: { size: 512, gen: () => HD.cobbleSetts({ seed: 61 }), normalStrength: 6, cavity: 0.25 },
  hd_flags: { size: 512, gen: () => HD.flagstones({ seed: 71 }), normalStrength: 5, cavity: 0.22 },
  hd_crazy: { size: 512, gen: () => HD.crazyFlags({ seed: 72, scale: 8 }), normalStrength: 4, cavity: 0.2 },
  hd_dungeon: { size: 512, gen: () => HD.dungeonStone({ seed: 81 }), normalStrength: 3, cavity: 0.12 },
  hd_dungeon_floor: { size: 512, gen: () => HD.dungeonFloor({ seed: 91 }), normalStrength: 4, cavity: 0.2 },
  hd_brick: { size: 256, gen: () => HD.bricks({ seed: 101 }), normalStrength: 4 },
  hd_wainscot: { size: 256, gen: () => HD.wainscot({ seed: 111 }), normalStrength: 4 },
  hd_boards: { size: 512, gen: () => HD.floorBoards({ seed: 121 }), normalStrength: 2.5, cavity: 0.2 },
  hd_ceiling: { size: 256, gen: () => HD.ceilingBoards({ seed: 191 }), normalStrength: 1.5, cavity: 0.15 },
  hd_staves: { size: 256, gen: () => HD.staves({ seed: 131 }), normalStrength: 3 },
  hd_crate: { size: 256, gen: () => HD.crateBoards({ seed: 141 }), normalStrength: 4 },
  hd_iron: { size: 128, gen: () => HD.rustyIron({ seed: 151 }), normalStrength: 2 },
  hd_burlap: { size: 256, gen: () => HD.burlap({ seed: 161 }), normalStrength: 2 },
  hd_rubble: { size: 256, gen: () => HD.rubbleStones({ seed: 171 }), normalStrength: 5 },
  hd_mud: { size: 1024, gen: () => HD.mudGround({ seed: 181 }), normalStrength: 4.5, cavity: 0.2 },
  hd_limestone: { size: 256, gen: () => HD.limestone({ seed: 211 }), normalStrength: 2.5 },
  hd_door: { size: 512, gen: () => HD.doorPlanks({ seed: 221 }), normalStrength: 3, cavity: 0.25 },
  hd_rock: { size: 256, gen: () => HD.rockFace({ seed: 231 }), normalStrength: 4, cavity: 0.2 },
  hd_water: { size: 256, gen: () => HD.waterWaves({ seed: 201 }), normalStrength: 3 },
  // ---- explore v3: crisp 1024² masonry (baked-noise generators) ----
  hd2_ashlar: { size: 1024, gen: () => HD2.ashlar2({ seed: 21, rows: 11, minW: 0.07, maxW: 0.33, palette: 'warm', chamfer: 0.0065, chips: 1.4, erosion: 1.25, cracks: 0.5, courseVar: 0.85, toneVar: 0.45, relief: 0.07, wash: 1 }), normalStrength: 3.2, cavity: 0.16 },
  hd2_quoin: { size: 512, gen: () => HD2.ashlar2({ seed: 27, rows: 4, minW: 0.42, maxW: 0.62, palette: 'warm', mortarW: 0.006, chamfer: 0.008, moss: 0.2 }), normalStrength: 3, cavity: 0.16 },
  hd2_ashlar_cold: { size: 1024, gen: () => HD2.ashlar2({ seed: 22, rows: 11, minW: 0.07, maxW: 0.3, palette: 'cold', moss: 0.55, cracks: 0.4, courseVar: 0.85, wash: 0.8 }), normalStrength: 3.2, cavity: 0.16 },
  hd2_ruin: { size: 1024, gen: () => HD2.ashlar2({ seed: 23, rows: 11, minW: 0.08, maxW: 0.26, chamfer: 0.006, palette: 'cold', erosion: 2.2, chips: 1.6, moss: 1, mortarW: 0.005, soot: 0.45, courseVar: 0.45, toneVar: 0.55, relief: 0.09, wash: 1 }), normalStrength: 3.6, cavity: 0.2 },
  hd2_dungeon: { size: 1024, gen: () => HD2.ashlar2({ seed: 81, rows: 12, minW: 0.07, maxW: 0.26, palette: 'dungeon', mortarW: 0.004, chamfer: 0.008, erosion: 1.1, chips: 0.55, moss: 0.25, cracks: 0.6, spalls: 0.3, courseVar: 0.9, wash: 0.8 }), normalStrength: 2.8, cavity: 0.14 },
  hd2_basalt: { size: 1024, gen: () => HD2.ashlar2({ seed: 87, rows: 8, minW: 0.15, maxW: 0.3, palette: 'basalt', mortarW: 0.0025, chamfer: 0.003, erosion: 0.6, chips: 0.5, moss: 0.05, sheen: 0.9, cracks: 0.3, spalls: 0.3 }), normalStrength: 2.6, cavity: 0.1 },
  hd2_hewn: { size: 1024, gen: () => HD2.hewnRock({ seed: 241, base: [0.38, 0.38, 0.35] }), normalStrength: 4.5, cavity: 0.25 },
  hd2_hewn_ceil: { size: 512, gen: () => HD2.hewnRock({ seed: 243, base: [0.34, 0.34, 0.32], ceiling: true }), normalStrength: 2.2, cavity: 0.25 },
  hd2_relief: { size: 512, gen: () => HD2.baneRelief({ seed: 251 }), normalStrength: 5, cavity: 0.3 },
  hd2_iron: { size: 256, gen: () => HD2.forgedIron({ seed: 157 }), normalStrength: 2.5, cavity: 0.2 },
  hd2_dressed: { size: 1024, gen: () => HD2.ashlar2({ seed: 29, palette: 'warm', joints: false, moss: 0.25 }), normalStrength: 4, cavity: 0.22 },
  hd2_basalt_floor: { size: 1024, gen: () => HD2.ashlar2({ seed: 89, rows: 6, minW: 0.18, maxW: 0.34, palette: 'basalt', mortarW: 0.003, chamfer: 0.004, erosion: 1.0, chips: 1.0, moss: 0, sheen: 0.45, cracks: 0.6 }), normalStrength: 2.6, cavity: 0.14 },
  hd2_cave_floor: { size: 1024, gen: () => HD2.hewnRock({ seed: 247, base: [0.33, 0.32, 0.29], floor: true }), normalStrength: 3.5, cavity: 0.25 },
  hd2_plaster: { size: 1024, gen: () => HD.plaster({ seed: 31, base: [0.7, 0.64, 0.53], decay: 1.45, lumps: 1.6, flake: 0.8 }), normalStrength: 8, cavity: 0.34 },
  hd2_plaster_int: { size: 1024, gen: () => HD.plaster({ seed: 33, base: [0.82, 0.77, 0.66], decay: 0.8, interior: true }), normalStrength: 3.2, cavity: 0.22 },
  hd2_ceiling: { size: 512, gen: () => HD.floorBoards({ seed: 193, count: 12, base: [0.33, 0.23, 0.15] }), normalStrength: 2.5, cavity: 0.25 },
  hd3_dungeon_floor: { size: 1024, gen: () => HD2.settsV({ seed: 95, rows: 7, minW: 0.09, maxW: 0.24, moss: 0.12, sand: 0.35, flags: true }), normalStrength: 3.2, cavity: 0.3 },
  hd3_flags: { size: 1024, gen: () => HD2.settsV({ seed: 73, rows: 9, minW: 0.07, maxW: 0.2, moss: 0.4, sand: 0.5, flags: true }), normalStrength: 3.2, cavity: 0.3 },
  hd4_setts: { size: 1024, gen: () => HD2.settsV({ seed: 64 }), normalStrength: 3.6, cavity: 0.34 },
  hd3_setts: { size: 1024, gen: () => HD2.setts({ seed: 63 }), normalStrength: 3.4, cavity: 0.34 },
  hd2_cobble: { size: 512, gen: () => HD.cobbleSetts({ seed: 61 }), normalStrength: 3.0, cavity: 0.32 },
  hd2_dungeon_floor: { size: 1024, gen: () => HD.flagstones({ seed: 93, rows: 9, minW: 0.08, maxW: 0.26, base: [0.3, 0.29, 0.27], weeds: 0.15, bevelK: 0.45, tiltK: 0.6, jointK: 0.9, dirt: 0.5, roughVar: 0.4, lichen: 0 }), normalStrength: 3.8, cavity: 0.24 },
  hd2_flags: { size: 1024, gen: () => HD.flagstones({ seed: 71, rows: 13, minW: 0.055, maxW: 0.19, bevelK: 0.35, tiltK: 0.45, jointK: 0.75, dirt: 0.7, roughVar: 0.35, lichen: 0.5 }), normalStrength: 3.6, cavity: 0.2 },
};

for (const k of Object.keys(TEXTURE_DEFS)) TEXTURE_DEFS[k].hd = true;
