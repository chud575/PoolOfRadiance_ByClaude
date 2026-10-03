/**
 * Spell glyphs and school colours for the MAGIC screen: each spell belongs to
 * a family (healing, warding, blessing, curse, fire, lightning, force, mind,
 * divination, alteration, illusion, holy weapon) drawn as a small engraved
 * glyph in a coloured roundel — inline SVG, no assets.
 */

export const SPELL_FAMILY = {
  cureLightWounds: 'heal', cureSeriousWounds: 'heal', cureBlindness: 'heal', cureDisease: 'heal', slowPoison: 'heal', neutralizePoison: 'heal', raiseDead: 'heal', removeCurse: 'heal',
  protectionFromEvil: 'ward', protectionFromGood: 'ward', resistCold: 'ward', resistFire: 'ward', shield: 'ward', protEvil10: 'ward', protGood10: 'ward', protNormalMissiles: 'ward',
  bless: 'bless', prayer: 'bless', chant: 'bless',
  curse: 'curse', causeLightWounds: 'curse', causeBlindness: 'curse', causeDisease: 'curse', bestowCurse: 'curse', causeSeriousWounds: 'curse',
  burningHands: 'fire', fireball: 'fire',
  shockingGrasp: 'bolt', lightningBolt: 'bolt',
  magicMissile: 'force',
  charmPerson: 'mind', sleep: 'mind', holdPerson: 'mind', friends: 'mind', snakeCharm: 'mind', stinkingCloud: 'mind', silence15: 'mind', rayOfEnfeeblement: 'mind', slow: 'mind',
  detectMagic: 'lore', findTraps: 'lore', readMagic: 'lore', detectInvisibility: 'lore', knock: 'lore',
  enlarge: 'change', reduce: 'change', strength: 'change', haste: 'change', dispelMagic: 'change', blink: 'change',
  invisibility: 'veil', invisibility10: 'veil', mirrorImage: 'veil',
  spiritualHammer: 'hammer',
};

/** [name, roundel colour (light), roundel colour (dark), glyph ink] */
export const FAMILY_STYLE = {
  heal: ['Healing', '#c8f0c0', '#2e6a3a', '#0e2a14'],
  ward: ['Warding', '#cfe0ff', '#2f4f9a', '#0c1838'],
  bless: ['Blessing', '#fff2c8', '#b88a2a', '#3a2606'],
  curse: ['Curse', '#e6c8f0', '#5a2a6a', '#1c0a24'],
  fire: ['Fire', '#ffd8b0', '#b8401a', '#3a0e04'],
  bolt: ['Lightning', '#e0f6ff', '#2a7ab8', '#06223a'],
  force: ['Force', '#f0e0ff', '#6a48c8', '#1a0a40'],
  mind: ['Enchantment', '#f8d0ec', '#9a3478', '#2a0820'],
  lore: ['Divination', '#fff0d0', '#9a7a3a', '#2a1c06'],
  change: ['Alteration', '#d8f4ec', '#2a8a72', '#06261e'],
  veil: ['Illusion', '#dce8f0', '#4a6a7e', '#0c1a24'],
  hammer: ['Holy Weapon', '#fff4d8', '#c89a3a', '#3a2606'],
};

const GLYPH = {
  heal: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
  ward: '<path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6z" fill="none" stroke-width="2.2"/><path d="M12 8v8M8.5 11.5h7" stroke-width="1.6"/>',
  bless: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8" stroke-width="1.8"/>',
  curse: '<path d="M12 4a8 8 0 1 0 6.9 12A6.5 6.5 0 1 1 12 4z"/><path d="M15.5 8.5l3 3m0-3l-3 3" stroke-width="1.6"/>',
  fire: '<path d="M12 2.8c1 3.4 5.6 5.4 5.6 10.2A5.6 5.6 0 0 1 6.4 13c0-2.6 1.4-4 2.4-5.2.2 1.8 1 2.8 2 3.2-.4-3 .2-5.6 1.2-8.2z"/>',
  bolt: '<path d="M13.6 2.5L5.5 13.4h5.2L9.4 21.5l9.1-11.7h-5.4z"/>',
  force: '<path d="M12 3l1.9 5.6H20l-4.9 3.6 1.9 5.8L12 14.4 7 18l1.9-5.8L4 8.6h6.1z"/>',
  mind: '<path d="M12 12.2c0-1 .8-1.6 1.6-1.4 1.3.3 1.6 2.1.6 3-1.6 1.4-4.3.6-4.8-1.5-.7-2.7 1.8-5 4.5-4.7 3.7.4 5.4 4.6 3.6 7.6-2.2 3.7-7.6 4-10.3.8" fill="none" stroke-width="1.9"/>',
  lore: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" fill="none" stroke-width="1.9"/><circle cx="12" cy="12" r="3.1"/>',
  change: '<path d="M18 9.5A6.5 6.5 0 0 0 6.2 8M6 14.5A6.5 6.5 0 0 0 17.8 16" fill="none" stroke-width="2"/><path d="M5 4.5v4.4h4.4M19 19.5v-4.4h-4.4" fill="none" stroke-width="2"/>',
  veil: '<path d="M3.5 9c2.8-2.3 6-3 8.5-3s5.7.7 8.5 3c-.6 4.6-3.6 8.2-8.5 8.2S4.1 13.6 3.5 9z"/><path d="M7.3 10.6c1 .8 2.2.8 3 0M13.7 10.6c1 .8 2.2.8 3 0" stroke-width="1.5" fill="none" stroke="#fff" opacity=".85"/>',
  hammer: '<path d="M5 6.5h9v4.5H5z"/><path d="M14 7.5h3.8v2.5H14z"/><path d="M8.6 11h2.2v9.5H8.6z"/>',
};

/**
 * One glyph per spell (24-unit box), so Bless, Detect Magic and Protection from Evil never share a
 * picture: filled shapes ('f:' prefix) and inked strokes. Unlisted spells fall back to the family.
 */
const F = (d) => `<path d="${d}"/>`;
const S = (d, w = 1.8) => `<path d="${d}" fill="none" stroke-width="${w}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const CS = (cx, cy, r, w = 1.7) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${w}"/>`;
const SPELL_GLYPH = {
  cureLightWounds: F('M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z'),
  cureSeriousWounds: F('M10.3 2.5h3.4v4.2h4v3h-4v1.6h6v3.4h-6v6.8h-3.4v-6.8h-6v-3.4h6V9.7h-4v-3h4z'),
  cureBlindness: S('M2.5 13S6 7 12 7s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z') + C(12, 13, 2.8) + S('M12 2.2v2.6M5.6 4l1.5 2.1M18.4 4l-1.5 2.1', 1.5),
  cureDisease: F('M6.5 3.5h11c0 5-2.4 8.2-4.3 9.1v4.4l3.3 2.2v1.3H7.5V19.2l3.3-2.2v-4.4C8.9 11.7 6.5 8.5 6.5 3.5z'),
  slowPoison: S('M5 18c3.5 0 3.5-4 7-4s3.5 4 7 4M5 12c3.5 0 3.5-4 7-4s3.5 4 7 4') + C(19.5, 6.5, 1.6),
  neutralizePoison: F('M9.5 2.8h5v2h-.9v3.4l4.6 8.6c.9 1.8-.3 3.9-2.3 3.9H8.1c-2 0-3.2-2.1-2.3-3.9l4.6-8.6V4.8h-.9z') + `<path d="M8.6 15.4l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.7" opacity=".9"/>`,
  raiseDead: CS(12, 6.8, 3.4, 2.2) + F('M10.6 10h2.8v11.5h-2.8z') + F('M5.5 11.8h13v2.6h-13z'),
  removeCurse: S('M3.5 13.5l3-3a3 3 0 0 1 4.2 0l.8.8M20.5 10.5l-3 3a3 3 0 0 1-4.2 0l-.8-.8', 2.1) + S('M10.6 5.2l1 2.3M13.4 18.8l-1-2.3M7.5 6.6l1.7 1.6M16.5 17.4l-1.7-1.6', 1.4),
  protectionFromEvil: S('M12 2.8l7 3v5.4c0 5-3.2 8.3-7 9.9-3.8-1.6-7-4.9-7-9.9V5.8z', 2.1) + F('M12 7.4l3.6 6.3H8.4z'),
  protectionFromGood: S('M12 2.8l7 3v5.4c0 5-3.2 8.3-7 9.9-3.8-1.6-7-4.9-7-9.9V5.8z', 2.1) + F('M12 14.8l3.6-6.3H8.4z'),
  protEvil10: CS(12, 12, 10, 1.3) + S('M12 5.2l4.8 2v3.5c0 3.3-2.2 5.6-4.8 6.7-2.6-1.1-4.8-3.4-4.8-6.7V7.2z', 1.8) + F('M12 8.6l2.3 4H9.7z'),
  protGood10: CS(12, 12, 10, 1.3) + S('M12 5.2l4.8 2v3.5c0 3.3-2.2 5.6-4.8 6.7-2.6-1.1-4.8-3.4-4.8-6.7V7.2z', 1.8) + F('M12 13.6l2.3-4H9.7z'),
  resistCold: S('M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6', 1.9) + S('M9.6 4.2L12 6.4l2.4-2.2M9.6 19.8L12 17.6l2.4 2.2', 1.4),
  resistFire: CS(12, 12, 9.2, 1.6) + F('M12 5.4c.8 2.5 4 4 4 7.4A4 4 0 0 1 8 12.8c0-1.8 1-2.8 1.7-3.6.2 1.2.7 1.9 1.4 2.2-.3-2 .1-4 .9-6z') + S('M5.5 18.5L18.5 5.5', 1.6),
  shield: F('M5.5 4h13v6.5c0 5.4-3.4 8.6-6.5 10-3.1-1.4-6.5-4.6-6.5-10z') + `<circle cx="12" cy="10.8" r="2.2" fill="#fff" opacity=".7"/>`,
  protNormalMissiles: S('M12 3l6.5 2.6v5c0 4.6-3 7.6-6.5 9-3.5-1.4-6.5-4.4-6.5-9v-5z', 1.9) + S('M2.5 21.5l5.6-5.6M9.5 14.5l1.8-1.8', 1.7) + F('M11.2 12.8l2.4-.6-.6 2.4z'),
  bless: C(12, 12, 3.6) + S('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8', 1.8),
  prayer: F('M11.2 3.5c-.9 0-1.5.8-1.6 1.7L8.8 13l-2.6 4.4 2.4 1.4 2.9-3.8V4.3c0-.5-.1-.8-.3-.8zM12.8 3.5c.9 0 1.5.8 1.6 1.7l.8 7.8 2.6 4.4-2.4 1.4-2.9-3.8V4.3c0-.5.1-.8.3-.8z'),
  chant: F('M12 3.2c3.3 0 5.4 2.6 5.4 6.2v4.8l2 2.6H4.6l2-2.6V9.4c0-3.6 2.1-6.2 5.4-6.2z') + C(12, 19.4, 1.9),
  curse: F('M12 4a8 8 0 1 0 6.9 12A6.5 6.5 0 1 1 12 4z') + S('M15.5 8.5l3 3m0-3l-3 3', 1.6),
  causeLightWounds: F('M12 2.5l1.7 3.4v8.3h-3.4V5.9z') + F('M7.4 14.2h9.2v1.8H7.4z') + F('M11 16h2v4h-2z') + C(17.8, 19.2, 1.6),
  causeSeriousWounds: F('M8.2 2.5l1.5 3v7.7H6.7V5.5zM15.8 2.5l1.5 3v7.7h-3V5.5z') + F('M4.6 13.2h6.8v1.6H4.6zM12.6 13.2h6.8v1.6h-6.8z') + F('M7.4 14.8h1.6v4.6H7.4zM15 14.8h1.6v4.6H15z'),
  causeBlindness: S('M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z') + C(12, 12, 2.8) + S('M4.5 19.5l15-15', 2.1),
  causeDisease: F('M12 3c-4.2 0-7 2.9-7 6.6 0 2.2 1 3.6 2.4 4.4V17h9.2v-3c1.4-.8 2.4-2.2 2.4-4.4C19 5.9 16.2 3 12 3z') + `<circle cx="9.3" cy="10" r="1.9" fill="#05040a"/><circle cx="14.7" cy="10" r="1.9" fill="#05040a"/>` + F('M9 17.5h1.6v3H9zM11.2 17.5h1.6v3h-1.6zM13.4 17.5H15v3h-1.6z'),
  bestowCurse: F('M6.2 20.5c-.6-4.2.4-7.4 2.2-9.6L7 4.4l2.2-.4 1.8 5.4.8-6.1 2.2.1-.3 6.4 2.3-5.4 2 .8-2.4 6.6c1.8.4 2.7 1.8 2.1 3.4l-1.4 5.3z'),
  burningHands: F('M5 20.5v-6.2l-1.6-3.5 1.6-.7 2 2.8V4.6h1.8v6.6h.7V3.2h1.8v8h.7V4h1.8v7.4h.7V6h1.8v8.6c0 3.2-1.7 5.9-4.6 5.9z') + S('M19.5 4.5c1.4 1.2 1.4 3 .2 4.3M21 2.5c2 2 2 5.4 0 7.6', 1.3),
  fireball: C(12, 13, 6.2) + S('M12 3.5c-2.5 1.4-3.2 3.4-2.4 5.2M17.6 6c-.3 2 .6 3.4 2.2 4M6.4 6c.3 2-.6 3.4-2.2 4', 1.6),
  shockingGrasp: F('M6 20.5v-5.6l-1.5-3.2 1.5-.6 1.9 2.4V7h1.8v5.4h.7V5.8h1.8v6.6h.7V7h1.8v6.4h.7V9.4h1.7v5.6c0 3-1.6 5.5-4.4 5.5z') + F('M17.8 1.8l-3 4.4h2.2l-1.4 3.6 3.9-4.9h-2.3z'),
  lightningBolt: F('M13.6 2.5L5.5 13.4h5.2L9.4 21.5l9.1-11.7h-5.4z'),
  magicMissile: F('M3.5 6.5l9-1.8-1.8 9zM8 14l9-1.8-1.8 9zM12.5 4.5l8.5-2-2 8.5z') + S('M3 21l3.4-3.4', 1.4),
  charmPerson: F('M12 20.3S3.5 14.8 3.5 9.2C3.5 6.3 5.6 4.2 8.2 4.2c1.7 0 3 .9 3.8 2.2.8-1.3 2.1-2.2 3.8-2.2 2.6 0 4.7 2.1 4.7 5 0 5.6-8.5 11.1-8.5 11.1z'),
  sleep: F('M15.5 3.2A8.4 8.4 0 1 0 20.8 16 7 7 0 0 1 15.5 3.2z') + S('M16 7.8h3.2L16 11h3.2', 1.2),
  holdPerson: C(12, 5, 2.6) + F('M8.8 8.6h6.4l-.8 6.4h-1.3l-.4 6.5h-2.4l-.4-6.5H8.6z') + S('M4.5 10.5h15M4.5 15h15', 1.4),
  friends: C(8.2, 6, 2.5) + C(15.8, 6, 2.5) + F('M4.3 20.5c0-5.2 1.7-8.3 3.9-8.3s3.9 3.1 3.9 8.3zM11.9 20.5c0-5.2 1.7-8.3 3.9-8.3s3.9 3.1 3.9 8.3z'),
  snakeCharm: S('M17.5 4.5c-3.5-1.5-8 .3-7.2 3.6.7 2.8 7 2.3 7.2 6.2.2 3.9-6.4 5.7-11 3.6', 2.2) + C(17.8, 4.4, 1.6),
  stinkingCloud: F('M6.5 15.5a3.8 3.8 0 0 1 .4-7.6 5.2 5.2 0 0 1 9.8-.6 3.9 3.9 0 0 1 .8 8.2z') + C(8.5, 19.2, 1.2) + C(12.5, 20.2, 1.2) + C(16.2, 19, 1.2),
  silence15: F('M5 10.5c2.2-2.2 4.6-2.8 7-1.6 2.4-1.2 4.8-.6 7 1.6-2 3.4-4.4 4.8-7 4.8s-5-1.4-7-4.8z') + S('M4.5 4.5l15 15', 2),
  rayOfEnfeeblement: S('M3 4.5l7 7', 2.4) + S('M10.5 12l2.2 2.2', 1.4) + F('M14.2 11.2h4.6v6h2.6L16.5 22l-4.9-4.8h2.6z'),
  slow: F('M7 3.5h10v1.8c0 3-2.3 4.6-3.6 6.7 1.3 2.1 3.6 3.7 3.6 6.7v1.8H7v-1.8c0-3 2.3-4.6 3.6-6.7C9.3 9.9 7 8.3 7 5.3z') + `<path d="M9.4 18.6h5.2c-.4-1.5-1.5-2.5-2.6-3.3-1.1.8-2.2 1.8-2.6 3.3z" fill="#fff" opacity=".7"/>`,
  detectMagic: S('M2.5 13S6 7 12 7s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z', 1.8) + C(12, 13, 2.9) + F('M18.5 1.8l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z'),
  findTraps: S('M3 14.5l3-6 3 4 3-6 3 6 3-4 3 6', 1.8) + F('M2.5 15.5h19v2.4h-19z'),
  readMagic: F('M3 5.5c3-.9 6.2-.6 8.3 1.2V20c-2.1-1.6-5.3-1.9-8.3-1z') + F('M21 5.5c-3-.9-6.2-.6-8.3 1.2V20c2.1-1.6 5.3-1.9 8.3-1z'),
  detectInvisibility: S('M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z', 1.6) + `<circle cx="12" cy="12" r="3.4" fill="none" stroke-width="1.6" stroke-dasharray="1.6 1.4"/>`,
  knock: CS(7.5, 12, 4, 2.2) + F('M11 11h10.5v2.2H11zM17.2 13.2h2v3h-2zM14.4 13.2h1.8v2.2h-1.8z'),
  enlarge: S('M3.5 3.5l5.5 5.5M20.5 3.5L15 9M3.5 20.5L9 15M20.5 20.5L15 15', 2) + F('M3 3h5.2L3 8.2zM21 3h-5.2L21 8.2zM3 21h5.2L3 15.8zM21 21h-5.2l5.2-5.2z'),
  reduce: S('M3.5 3.5l5 5M20.5 3.5l-5 5M3.5 20.5l5-5M20.5 20.5l-5-5', 2) + F('M9.4 9.4H4.6l4.8-4.8zM14.6 9.4h4.8l-4.8-4.8zM9.4 14.6H4.6l4.8 4.8zM14.6 14.6h4.8l-4.8 4.8z'),
  strength: F('M5 13.5c0-2.8 1.4-4.6 3.4-5.1L10.2 4l2.6 1-1.2 3.4c2.6-.2 5 .5 6.4 2 1.6 1.7 1.4 4.5-.4 6.4-1.6 1.7-4.1 2.7-6.8 2.7C7.4 19.5 5 17 5 13.5z'),
  haste: F('M4 4.5l6.5 7.5L4 19.5h3.6l6.5-7.5-6.5-7.5zM11 4.5l6.5 7.5-6.5 7.5h3.6l6.5-7.5-6.5-7.5z'),
  dispelMagic: F('M12 2.5l1.6 6.2 6.2-2.4-3.9 5.4 5.6 3.1-6.4.3.6 6.4-3.7-5.2-3.7 5.2.6-6.4-6.4-.3 5.6-3.1-3.9-5.4 6.2 2.4z') + S('M3.5 20.5l17-17', 1.8),
  blink: CS(6.5, 12, 3.2, 1.7) + C(17.5, 12, 3.2) + `<path d="M10.5 12h3.4" fill="none" stroke-width="1.6" stroke-dasharray="1.4 1.2"/>`,
  invisibility: `<g fill="none" stroke-width="1.7" stroke-dasharray="2 1.6"><circle cx="12" cy="5.5" r="2.8"/><path d="M8.2 21V12.5c0-1.9 1.6-3.4 3.8-3.4s3.8 1.5 3.8 3.4V21"/></g>`,
  invisibility10: CS(12, 12.5, 10, 1.2) + `<g fill="none" stroke-width="1.6" stroke-dasharray="1.8 1.5"><circle cx="12" cy="7.4" r="2.3"/><path d="M9 18.6v-6.4c0-1.6 1.3-2.8 3-2.8s3 1.2 3 2.8v6.4"/></g>`,
  mirrorImage: `<g opacity=".45">${C(6.5, 7, 2.2)}${F('M3.6 20v-7c0-1.6 1.3-2.9 2.9-2.9s2.9 1.3 2.9 2.9v7z')}${C(17.5, 7, 2.2)}${F('M14.6 20v-7c0-1.6 1.3-2.9 2.9-2.9s2.9 1.3 2.9 2.9v7z')}</g>` + C(12, 6.2, 2.6) + F('M8.6 21v-7.6c0-1.9 1.5-3.4 3.4-3.4s3.4 1.5 3.4 3.4V21z'),
  spiritualHammer: F('M5 6.5h9v4.5H5z') + F('M14 7.5h3.8v2.5H14z') + F('M8.6 11h2.2v9.5H8.6z') + S('M18.5 3l1.4 1.4M20.5 6.2h2', 1.3),
};

const urlCache = new Map();
/**
 * The roundel image (data URL) for a spell: a gilt bezel round an enamel field in the school's
 * colour (grainy, brighter where the light strikes it), the spell's own glyph raised in pale
 * enamel with a dark keyline and a highlight along its top edge.
 * @param {string} id spell id
 * @param {{dim?: boolean}} [o]
 */
export function spellGlyphURL(id, o = {}) {
  const fam = SPELL_FAMILY[id] ?? 'force';
  const key = `${id}|${o.dim ? 1 : 0}`;
  let u = urlCache.get(key);
  if (u) return u;
  const [, light, dark, ink] = FAMILY_STYLE[fam];
  const glyph = SPELL_GLYPH[id] ?? GLYPH[fam];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
<defs>
<radialGradient id="g" cx="36%" cy="30%" r="78%"><stop offset="0" stop-color="${light}"/><stop offset="0.5" stop-color="${dark}"/><stop offset="1" stop-color="#05040a"/></radialGradient>
<linearGradient id="r" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#fbe9b0"/><stop offset="0.35" stop-color="#c9973e"/><stop offset="0.7" stop-color="#6a4512"/><stop offset="1" stop-color="#d8ac58"/></linearGradient>
<filter id="grain" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="${(id.length * 7) % 97}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 0.62"/><feComposite in2="SourceGraphic" operator="in"/></filter>
<filter id="emb"><feGaussianBlur in="SourceAlpha" stdDeviation="0.35" result="b"/><feOffset dx="0" dy="0.55" result="o"/><feFlood flood-color="${ink}" flood-opacity="0.95"/><feComposite in2="o" operator="in" result="sh"/><feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="field"><circle cx="16" cy="16" r="12.8"/></clipPath>
</defs>
<circle cx="16" cy="16" r="15.2" fill="#140c04"/>
<circle cx="16" cy="16" r="14.6" fill="url(#r)"/>
<circle cx="16" cy="16" r="14.6" fill="none" stroke="#fff6d0" stroke-opacity=".55" stroke-width=".5" stroke-dasharray="9 40" transform="rotate(200 16 16)"/>
<circle cx="16" cy="16" r="13" fill="#05040a"/>
<circle cx="16" cy="16" r="12.8" fill="url(#g)"/>
<rect x="0" y="0" width="32" height="32" fill="#000" filter="url(#grain)" clip-path="url(#field)" opacity="0.55"/>
<ellipse cx="12.5" cy="10" rx="7" ry="4.2" fill="#fff" opacity="0.13" clip-path="url(#field)"/>
<g transform="translate(4 4)" fill="${light}" stroke="${light}" stroke-linecap="round" stroke-linejoin="round" filter="url(#emb)">${glyph}</g>
<circle cx="16" cy="16" r="12.8" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="0.9"/>
${o.dim ? '<circle cx="16" cy="16" r="15.2" fill="#05060c" fill-opacity="0.58"/>' : ''}
</svg>`;
  u = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  urlCache.set(key, u);
  return u;
}

/** Family name for a spell ("Healing", "Fire"...). */
export function spellFamilyName(id) {
  return FAMILY_STYLE[SPELL_FAMILY[id] ?? 'force'][0];
}
