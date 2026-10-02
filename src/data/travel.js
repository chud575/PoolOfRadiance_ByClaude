/**
 * Links between blocks. Each entry becomes (a) a map event at `at` on the
 * `from` map (type 'encounter', ref `go_<id>`, only when facing `at.facing`),
 * (b) a MapGrid exit for renderers that support edge exits, and (c) a short
 * travel script in the dialogue scene ("Pass through the gate? YES / NO").
 *
 * @typedef {Object} TravelDef
 * @property {string} id
 * @property {string} from        map id
 * @property {{x:number,y:number,facing:string}} at
 * @property {{map:string,x:number,y:number,dir:string}} to
 * @property {string} title
 * @property {string} text
 * @property {string} [go]        label of the accept choice
 * @property {string} [art]       backdrop setting
 * @property {number} [minutes]   travel time
 * @property {boolean} [edge]     true when `at` is a map-edge exit (arch in the border)
 * @property {string} [requires]  game flag needed to pass
 * @property {string} [barred]    text shown while `requires` is unmet
 */

/** @type {TravelDef[]} */
export const TRAVEL = [
  { id: 'civ_slums', from: 'phlan_civilized', at: { x: 15, y: 14, facing: 'E' }, to: { map: 'phlan_slums', x: 0, y: 14, dir: 'E' }, edge: true,
    title: 'The Slum Gate', art: 'gate', text: 'Beyond the palisade gate lie the Slums, the nearest of the lost blocks. The watch will open it for you — and close it behind you.', go: 'Pass the gate' },
  { id: 'slums_civ', from: 'phlan_slums', at: { x: 0, y: 14, facing: 'W' }, to: { map: 'phlan_civilized', x: 15, y: 14, dir: 'W' }, edge: true,
    title: 'The Slum Gate', art: 'gate', text: 'The palisade gate of New Phlan. A watchman peers down from the walk, counts you, and shouts for the bar to be lifted.', go: 'Enter New Phlan' },
  { id: 'civ_sokol', from: 'phlan_civilized', at: { x: 4, y: 15, facing: 'S' }, to: { map: 'sokol_keep', x: 7, y: 15, dir: 'N' }, minutes: 90,
    title: 'The Grey Gull', art: 'docks', npc: 'bosun', text: 'Kell Saltbeard\'s boat bobs at the end of the pier. "Sokol Keep? I\'ll row you across and wait off the landing till dusk. Not a moment after."', go: 'Row to Sokol Keep' },
  { id: 'sokol_civ', from: 'sokol_keep', at: { x: 7, y: 15, facing: 'S' }, to: { map: 'phlan_civilized', x: 4, y: 14, dir: 'N' }, minutes: 90,
    title: 'The Landing', art: 'keep', text: 'The Grey Gull waits off the landing, the dwarf hunched over his oars, watching the walls and not you.', go: 'Row back to Phlan' },
  { id: 'slums_well', from: 'phlan_slums', at: { x: 13, y: 0, facing: 'N' }, to: { map: 'kutos_well', x: 13, y: 15, dir: 'N' }, edge: true,
    title: 'North Arch', art: 'slums', text: 'A leaning arch opens north toward the plaza of Kuto\'s Well. Kobold tracks run through it in both directions.', go: 'Go north' },
  { id: 'well_slums', from: 'kutos_well', at: { x: 13, y: 15, facing: 'S' }, to: { map: 'phlan_slums', x: 13, y: 0, dir: 'S' }, edge: true,
    title: 'South Arch', art: 'slums', text: 'The arch leads south, back into the Slums.', go: 'Go south' },
  { id: 'slums_podol', from: 'phlan_slums', at: { x: 15, y: 9, facing: 'E' }, to: { map: 'podol_plaza', x: 0, y: 9, dir: 'E' }, edge: true,
    title: 'Market Lane', art: 'plaza', text: 'Market Lane runs east to Podol Plaza. Someone has painted a crude toll-sign on the wall: a hand with a coin in it.', go: 'Go east' },
  { id: 'podol_slums', from: 'podol_plaza', at: { x: 0, y: 9, facing: 'W' }, to: { map: 'phlan_slums', x: 15, y: 9, dir: 'W' }, edge: true,
    title: 'Market Lane', art: 'slums', text: 'Market Lane leads west, back to the Slums.', go: 'Go west' },
  { id: 'podol_library', from: 'podol_plaza', at: { x: 7, y: 1, facing: 'N' }, to: { map: 'mendors_library', x: 7, y: 15, dir: 'N' },
    title: 'Mendor\'s Library', art: 'library', text: 'Great bronze doors, green with age, stand ajar. Above them an open eye is carved in the lintel, and beneath it: KNOWLEDGE IS A LAMP.', go: 'Enter the library' },
  { id: 'library_podol', from: 'mendors_library', at: { x: 7, y: 15, facing: 'S' }, to: { map: 'podol_plaza', x: 7, y: 1, dir: 'S' },
    title: 'The Bronze Doors', art: 'plaza', text: 'Daylight shows grey through the bronze doors.', go: 'Leave the library' },
  { id: 'podol_textile', from: 'podol_plaza', at: { x: 15, y: 7, facing: 'E' }, to: { map: 'cadorna_textile', x: 0, y: 7, dir: 'E' }, edge: true,
    title: 'Cadorna Textile House', art: 'textile', text: 'A long warehouse with a spindle-and-crown painted over the loading doors. The doors have been chained — from the inside.', go: 'Force the doors' },
  { id: 'textile_podol', from: 'cadorna_textile', at: { x: 0, y: 7, facing: 'W' }, to: { map: 'podol_plaza', x: 15, y: 7, dir: 'W' }, edge: true,
    title: 'Loading Doors', art: 'plaza', text: 'The loading doors open onto Podol Plaza.', go: 'Leave' },
  { id: 'well_grave', from: 'kutos_well', at: { x: 7, y: 0, facing: 'N' }, to: { map: 'valhingen_graveyard', x: 7, y: 15, dir: 'N' }, edge: true,
    title: 'Valhingen Gate', art: 'graveyard', text: 'Iron gates wrought with weeping angels. Beyond them, the marble city of the dead.', go: 'Enter the graveyard' },
  { id: 'grave_well', from: 'valhingen_graveyard', at: { x: 7, y: 15, facing: 'S' }, to: { map: 'kutos_well', x: 7, y: 0, dir: 'S' }, edge: true,
    title: 'Valhingen Gate', art: 'well', text: 'The iron gates lead back to Kuto\'s Well.', go: 'Leave the graveyard' },
  { id: 'well_gate', from: 'kutos_well', at: { x: 15, y: 8, facing: 'E' }, to: { map: 'stojanow_gate', x: 0, y: 8, dir: 'E' }, edge: true,
    title: 'River Street', art: 'gate', text: 'River Street runs east toward the Stojanow Gate. Smoke rises from the gatehouse towers.', go: 'Go east' },
  { id: 'gate_well', from: 'stojanow_gate', at: { x: 0, y: 8, facing: 'W' }, to: { map: 'kutos_well', x: 15, y: 8, dir: 'W' }, edge: true,
    title: 'River Street', art: 'well', text: 'River Street runs west, back to Kuto\'s Well.', go: 'Go west' },
  { id: 'gate_valjevo', from: 'stojanow_gate', at: { x: 7, y: 0, facing: 'N' }, to: { map: 'valjevo_castle', x: 7, y: 15, dir: 'N' }, edge: true,
    title: 'Castle Road', art: 'castle', text: 'The castle road climbs north to Valjevo. Heads on spikes line the last hundred yards. Some are fresh.', go: 'Climb to the castle' },
  { id: 'valjevo_gate', from: 'valjevo_castle', at: { x: 7, y: 15, facing: 'S' }, to: { map: 'stojanow_gate', x: 7, y: 0, dir: 'S' }, edge: true,
    title: 'Castle Gate', art: 'gate', text: 'The castle road leads down to the Stojanow Gate.', go: 'Descend' },
  { id: 'gate_wilds', from: 'stojanow_gate', at: { x: 15, y: 7, facing: 'E' }, to: { map: 'wilderness', x: 0, y: 7, dir: 'E' }, edge: true, minutes: 240,
    requires: 'stojanow_taken', barred: 'The great gate is barred and chained, and hobgoblin archers line the towers above it. No one leaves Phlan by this road while the war-band holds the gate.',
    title: 'The Stojanow Gate', art: 'wilds', text: 'The great gate opens on the river road and the wild lands of the Moonsea. There is no wall out there, and no watch.', go: 'Take the river road' },
  { id: 'wilds_gate', from: 'wilderness', at: { x: 0, y: 7, facing: 'W' }, to: { map: 'stojanow_gate', x: 15, y: 7, dir: 'W' }, edge: true, minutes: 240,
    title: 'The River Road', art: 'gate', text: 'The road leads back to the Stojanow Gate and the walls of Phlan.', go: 'Return to Phlan' },
  { id: 'grave_bane', from: 'valhingen_graveyard', at: { x: 7, y: 2, facing: 'N' }, to: { map: 'temple_bane', x: 7, y: 15, dir: 'N' },
    title: 'The Stair Below', art: 'temple_bane', text: 'Behind the mausoleum\'s forced door a stair winds down into green-lit darkness. The steps are worn in the middle by many feet.', go: 'Descend the stair' },
  { id: 'bane_grave', from: 'temple_bane', at: { x: 7, y: 15, facing: 'S' }, to: { map: 'valhingen_graveyard', x: 7, y: 2, dir: 'S' },
    title: 'The Stair Above', art: 'graveyard', text: 'The stair climbs to the mausoleum and the graveyard beyond.', go: 'Climb out' },
  { id: 'valjevo_pool', from: 'valjevo_castle', at: { x: 7, y: 1, facing: 'N' }, to: { map: 'pool_pyramid', x: 7, y: 15, dir: 'N' },
    requires: 'valjevo_taken', barred: 'The wall behind the throne is cold, carved stone. From somewhere beneath your feet comes a faint, slow sound, like breathing.',
    title: 'The Hidden Stair', art: 'pool', text: 'Behind the empty throne a stair descends, and from far below comes a light like sunrise through water.', go: 'Descend to the Pool' },
  { id: 'pool_valjevo', from: 'pool_pyramid', at: { x: 7, y: 15, facing: 'S' }, to: { map: 'valjevo_castle', x: 7, y: 1, dir: 'S' },
    title: 'The Stair', art: 'castle', text: 'The long stair climbs back to the throne room of Valjevo.', go: 'Climb' },
  { id: 'warrens_well', from: 'kutos_warrens', at: { x: 7, y: 14, facing: 'S' }, to: { map: 'kutos_well', x: 7, y: 9, dir: 'S' },
    title: 'The Rope Ladder', art: 'well_head', text: 'The knotted ladder climbs toward a coin of grey daylight far above.', go: 'Climb out' },
];

export const TRAVEL_BY_ID = Object.fromEntries(TRAVEL.map((t) => [t.id, t]));
