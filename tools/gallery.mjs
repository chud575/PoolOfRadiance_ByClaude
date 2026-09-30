/**
 * The standard screenshot gallery. Each entry exists in BOTH the homage
 * (shots/<name>.png via shotall.mjs) and the 1988 reference
 * (reference/<name>.png via refshot.mjs) for blind side-by-side comparison.
 * Keep query strings deterministic (seed + freeze).
 */
export const GALLERY = [
  { name: 'title', query: 'scene=title&t=6&seed=1' },
  { name: 'mainmenu', query: 'scene=title&view=menu&t=6&seed=1' },
  { name: 'settings', query: 'scene=title&view=settings&tab=graphics&t=6&seed=1' },
  { name: 'intro', query: 'scene=title&view=intro&t=13.5&seed=1' },
  { name: 'create', query: 'scene=create&step=stats&t=2&seed=1' },
  { name: 'create_portrait', query: 'scene=create&step=portrait&t=2&seed=1' },
  { name: 'explore', query: 'scene=explore&map=phlan_slums&x=7&y=11&dir=N&hour=10&t=2&seed=1' },
  { name: 'explore_door', query: 'scene=explore&map=phlan_slums&x=8&y=11&dir=S&hour=10&t=2&seed=1' },
  { name: 'explore_night', query: 'scene=explore&map=phlan_slums&x=1&y=14&dir=E&hour=22&t=2&seed=1' },
  { name: 'explore_dusk', query: 'scene=explore&map=phlan_slums&x=4&y=5&dir=E&hour=18.2&t=2&seed=1' },
  { name: 'explore_ruins', query: 'scene=explore&map=phlan_slums&x=7&y=11&dir=N&hour=16.5&tileset=ruins&t=2&seed=1' },
  { name: 'explore_dungeon', query: 'scene=explore&map=demo_dungeon&x=3&y=7&dir=E&t=2&seed=1' },
  { name: 'explore_interior', query: 'scene=explore&map=demo_interior&x=2&y=1&dir=W&hour=11&t=2&seed=1' },
  { name: 'combat', query: 'scene=combat&encounter=kobolds_1&t=2&seed=1' },
  { name: 'combat_spell', query: 'scene=combat&encounter=orcs_1&party=veterans&demo=fireball&map=phlan_slums&x=4&y=4&t=0.75&seed=1' },
  { name: 'combat_melee', query: 'scene=combat&encounter=orcs_1&demo=melee&t=0.46&seed=1' },
  { name: 'combat_night', query: 'scene=combat&encounter=skeletons_1&hour=22&t=2&seed=1' },
  { name: 'automap', query: 'scene=automap&map=phlan_slums&x=7&y=11&dir=N&t=1&seed=1' },
  { name: 'camp', query: 'scene=camp&hour=21.5&t=2&seed=1' },
  { name: 'charsheet', query: 'scene=camp&panel=view&member=0&hour=21.5&t=2&seed=1' },
  { name: 'inventory', query: 'scene=camp&panel=items&member=0&hour=21.5&t=2&seed=1' },
  { name: 'memorize', query: 'scene=camp&panel=magic&member=1&hour=21.5&t=2&seed=1' },
  { name: 'dialogue', query: 'scene=dialogue&encounter=kobolds_1&t=1&seed=1' },
  { name: 'shop', query: 'scene=shop&shop=phlan_armory&t=1&seed=1' },
];
