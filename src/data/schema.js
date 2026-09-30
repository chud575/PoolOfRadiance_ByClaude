/**
 * Data schemas (JSDoc typedefs) + lightweight validators used by tests.
 * All game content lives in src/data as plain JS objects keyed by id.
 * Ids are camelCase for items/spells/monsters, snake_case for maps/encounters/shops.
 *
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name            Identified name ("Long Sword +1")
 * @property {string} [unidName]      Name shown before identification ("Long Sword")
 * @property {'weapon'|'armor'|'shield'|'helm'|'potion'|'scroll'|'wand'|'ring'|'gear'|'ammo'|'treasure'} type
 * @property {number} cost            gp
 * @property {number} weight          coins (10 coins = 1 lb)
 * @property {string} [damage]        weapon damage vs S/M ("1d8")
 * @property {string} [damageLarge]   weapon damage vs L ("1d12")
 * @property {boolean} [twoHanded]
 * @property {boolean} [ranged]
 * @property {number} [range]         squares
 * @property {string} [ammo]          ammo item id required
 * @property {string} [weaponGroup]   used by class weapon restrictions (e.g. 'longSword')
 * @property {number} [ac]            armor: base AC it grants (e.g. 5 for chain)
 * @property {number} [acBonus]       shield/helm/ring: AC improvement (positive number)
 * @property {string} [armorGroup]    'leather'|'padded'|'studded'|'ring'|'scale'|'chain'|'banded'|'splint'|'plate'
 * @property {number} [magic]         +N enchantment (to-hit & damage or AC)
 * @property {string} [effect]        potion/scroll/wand effect id (spell id or 'heal')
 * @property {number} [charges]
 * @property {string} [icon]          procedural icon key for UI
 * @property {string} [desc]
 *
 * @typedef {Object} MonsterDef
 * @property {string} id
 * @property {string} name
 * @property {string} [plural]
 * @property {number} hd              hit dice (0.5 for 1-4 hp creatures)
 * @property {number} [hpBonus]       +N to HD roll (e.g. 1+1 HD → hd 1, hpBonus 1)
 * @property {number} ac
 * @property {number} thac0
 * @property {number} move            1e inches (squares per round in combat /1? see combat module)
 * @property {string[]} attacks       damage dice per attack per round
 * @property {number} xp              xp award (flat, per 1e DMG)
 * @property {'S'|'M'|'L'} size
 * @property {number} morale          0..100 base
 * @property {string} alignment
 * @property {string[]} [special]     ability ids ('undead','turnable','regenerate','paralyze','poison','breath:fire', ...)
 * @property {string} [turnAs]        undead turn class ('skeleton','zombie','ghoul',...)
 * @property {string} [sprite]        procedural sprite/model key for renderers
 * @property {string} [desc]
 *
 * @typedef {Object} SpellDef
 * @property {string} id
 * @property {string} name
 * @property {'cleric'|'magicUser'} school
 * @property {number} level
 * @property {'combat'|'camp'|'both'} usable
 * @property {string} range           'touch'|'self'|'<n> squares'
 * @property {string} [area]
 * @property {string} duration
 * @property {string} [save]          'none' | 'neg' | 'half' + save key
 * @property {string} [effect]        engine effect id
 * @property {string} desc
 *
 * @typedef {Object} EncounterDef
 * @property {string} id
 * @property {string} name
 * @property {{monster:string, count:string|number}[]} groups
 * @property {string} [intro]          text shown in the Dialogue/Encounter screen
 * @property {('combat'|'wait'|'flee'|'parley')[]} [options]
 * @property {string} [terrain]        battlefield preset id for the combat renderer
 * @property {string} [music]
 * @property {{gold?:string, items?:string[]}} [treasure]
 *
 * @typedef {Object} MapDef   Built via MapGrid (see maps/MapGrid.js)
 * @property {string} id
 * @property {string} name
 * @property {number} w
 * @property {number} h
 * @property {'city'|'dungeon'|'wilderness'} kind
 * @property {string} wallSet        material set id for renderer ('phlan_stone', 'ruin', ...)
 * @property {boolean} outdoors       open sky
 * @property {{x:number,y:number,dir:string}} start
 * @property {MapEvent[]} events
 *
 * @typedef {Object} MapEvent
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {'encounter'|'text'|'shop'|'temple'|'training'|'exit'|'treasure'|'trap'|'sign'} type
 * @property {string} [ref]          encounter/shop id or destination map id
 * @property {string} [text]
 * @property {boolean} [once]
 * @property {string} [facing]       only triggers when facing this dir
 * @property {number} [chance]       percent chance to trigger
 */

/** @param {Record<string, any>} table @param {string[]} required */
export function validateTable(table, required) {
  const errors = [];
  for (const [key, def] of Object.entries(table)) {
    if (def.id !== key) errors.push(`${key}: id mismatch (${def.id})`);
    for (const f of required) if (def[f] === undefined) errors.push(`${key}: missing ${f}`);
  }
  return errors;
}
