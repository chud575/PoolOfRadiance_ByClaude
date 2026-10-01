import title, { intro } from './themes/title.js';
import town, { tavern } from './themes/town.js';
import { ruins, dungeon, crypt, wilds, camp } from './themes/explore.js';
import combat, { encounter } from './themes/combat.js';
import { victory, defeat, levelup, discovery, danger, quest, fallen } from './themes/stingers.js';

/** Looping (or one-shot) music states. */
export const SONGS = { title, intro, town, tavern, ruins, dungeon, crypt, wilds, camp, combat, encounter, victory, defeat };

/** Short one-shot stingers played over (ducked) music. */
export const STINGERS = { victory, defeat, levelup, discovery, danger, quest, fallen };
