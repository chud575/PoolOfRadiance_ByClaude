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

const urlCache = new Map();
/**
 * The roundel image (data URL) for a spell.
 * @param {string} id spell id
 * @param {{dim?: boolean}} [o]
 */
export function spellGlyphURL(id, o = {}) {
  const fam = SPELL_FAMILY[id] ?? 'force';
  const key = `${fam}|${o.dim ? 1 : 0}`;
  let u = urlCache.get(key);
  if (u) return u;
  const [, light, dark, ink] = FAMILY_STYLE[fam];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
<defs><radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${dark}"/><stop offset="1" stop-color="#05040a"/></radialGradient>
<linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8e2a0"/><stop offset="0.5" stop-color="#a87a2a"/><stop offset="1" stop-color="#5a3a10"/></linearGradient></defs>
<circle cx="16" cy="16" r="15" fill="url(#r)"/><circle cx="16" cy="16" r="13" fill="url(#g)"/>
<circle cx="16" cy="16" r="13" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="0.8"/>
<g transform="translate(4 4)" fill="${light}" stroke="${light}" stroke-linecap="round" stroke-linejoin="round" opacity="0.96" style="filter:drop-shadow(0 0.6px 0.4px ${ink})">${GLYPH[fam]}</g>
${o.dim ? '<circle cx="16" cy="16" r="15" fill="#05060c" fill-opacity="0.55"/>' : ''}
</svg>`;
  u = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  urlCache.set(key, u);
  return u;
}

/** Family name for a spell ("Healing", "Fire"...). */
export function spellFamilyName(id) {
  return FAMILY_STYLE[SPELL_FAMILY[id] ?? 'force'][0];
}
