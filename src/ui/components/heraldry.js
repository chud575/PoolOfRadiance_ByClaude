/**
 * One heraldry for a character, shared by every consumer that paints their shield: the VIEW sheet's
 * enamelled heater, the miniature's shield face (board, camp sitter, plinth, medallion) and the
 * readied-shield item icon. resolveAppearance() exposes it as `app.heraldry`.
 *
 * The device is described by keys (field tincture, metal tincture, ordinary, charge) and drawn from
 * the same SVG path data everywhere: inline SVG on the sheet, Path2D on canvases.
 * Coordinates are in a 100 x 120 heater box (the shield field spans roughly x 16..84, y 15..101).
 */

export const CHARGE_PATHS = {
  // A rook (tower) for fighters.
  fighter: 'M38 50 h24 v6 h-3 v22 h3 v6 h-24 v-6 h3 v-22 h-3 Z M38 50 v-6 h5 v4 h4 v-4 h6 v4 h4 v-4 h5 v6 Z',
  // A sun for clerics.
  cleric: 'M50 51 a9 9 0 1 0 0.01 0 Z M50 38 l3 10 h-6 Z M50 82 l3 -10 h-6 Z M28 60 l10 3 v-6 Z M72 60 l-10 3 v-6 Z M35 45 l9 6 -4 4 Z M65 45 l-9 6 4 4 Z M35 75 l9 -6 -4 -4 Z M65 75 l-9 -6 4 -4 Z',
  // A mullet (star) for magic-users.
  magicUser: 'M50 40 L55 55 L71 55 L58 64 L63 80 L50 70 L37 80 L42 64 L29 55 L45 55 Z',
  // A key for thieves.
  thief: 'M50 36 a9 9 0 1 0 0.01 0 Z M47 52 h6 v28 h6 v5 h-6 v3 h4 v5 h-4 v2 h-6 Z',
  // A hammer for dwarven fighters.
  dwarf: 'M33 44 h34 v13 h-34 Z M47 57 h6 v28 h-6 Z',
  // A leaf for elven multiclasses.
  elf: 'M50 40 C65 49 67 69 50 86 C33 69 35 49 50 40 Z',
};

export const ORDINARY_PATHS = {
  chevron: 'M16 70 L50 44 L84 70 L84 82 L50 56 L16 82 Z',
  chief: 'M14 15 h72 v17 h-72 Z',
  bend: 'M14 22 L26 15 L86 88 L76 98 Z',
  pale: 'M14 15 h36 v90 Q30 92 22 70 L14 15 Z',
  base: 'M14 86 h72 v6 Q76 98 50 106 Q24 98 14 90 Z',
};
const ORDINARY_KEYS = ['chevron', 'chief', 'bend', 'pale', 'base'];

/** Heater outline (outer rim) and the inner field it encloses. */
export const HEATER_OUTER = 'M50 6 L92 14 Q94 52 86 70 Q76 96 50 112 Q24 96 14 70 Q6 52 8 14 Z';
export const HEATER_FIELD = 'M50 15 L84 21 Q86 52 79 67 Q71 88 50 101 Q29 88 21 67 Q14 52 16 21 Z';

const METALS = { or: '#d8b06a', argent: '#d6dade' };

function nameHash(name) {
  let h = 0;
  for (const c of String(name ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * The character's arms.
 * @param {{name?:string, race?:string, classSpec?:string}} ch
 * @param {string} field  the field tincture (the figure's cloth colour)
 * @returns {{field:string, metal:string, metalKey:string, ordinary:string, charge:string, key:string}}
 */
export function heraldryOf(ch, field = '#6a1a14') {
  const classes = String(ch.classSpec ?? 'fighter').split('/');
  const last = classes[classes.length - 1];
  const charge = ch.race === 'dwarf' && classes[0] === 'fighter' ? 'dwarf'
    : ch.race === 'elf' && classes.length > 1 ? 'elf'
    : CHARGE_PATHS[last] ? last : 'fighter';
  const hsh = nameHash(ch.name);
  const ordinary = ORDINARY_KEYS[hsh % ORDINARY_KEYS.length];
  const metalKey = hsh % 3 === 0 ? 'argent' : 'or';
  return { field, metal: METALS[metalKey], metalKey, ordinary, charge, hash: hsh, key: `${field}|${metalKey}|${ordinary}|${charge}` };
}

/**
 * Paint the device (field, ordinary, charge) into the heater box on a 2D canvas context.
 * The caller sets the transform so that the 100 x 120 box lands where it wants; the field is
 * clipped to `clip` (defaults to the heater field; pass null to fill the whole box, e.g. a round shield).
 * @param {CanvasRenderingContext2D} g
 * @param {ReturnType<typeof heraldryOf>} her
 * @param {{clip?: string|null, metalFill?: string|CanvasGradient, stroke?: string}} [o]
 */
export function paintDevice(g, her, o = {}) {
  g.save();
  const clip = o.clip === undefined ? HEATER_FIELD : o.clip;
  if (clip) g.clip(new Path2D(clip));
  g.fillStyle = her.field;
  g.fillRect(-10, -10, 120, 140);
  let metal = o.metalFill;
  if (!metal) {
    const mg = g.createLinearGradient(0, 20, 0, 100);
    mg.addColorStop(0, '#fff4dc');
    mg.addColorStop(0.3, her.metal);
    mg.addColorStop(0.55, '#5a3e1a');
    mg.addColorStop(0.62, her.metal);
    mg.addColorStop(1, '#fff0d0');
    metal = mg;
  }
  g.fillStyle = metal;
  g.strokeStyle = o.stroke ?? '#2a1808';
  g.lineWidth = 0.9;
  const ord = new Path2D(ORDINARY_PATHS[her.ordinary]);
  g.fill(ord);
  g.stroke(ord);
  const ch = new Path2D(CHARGE_PATHS[her.charge]);
  g.fill(ch);
  g.stroke(ch);
  g.restore();
}

/**
 * The sheet crest: a heater of hammered metal, its field enamelled in the bearer's tincture, the
 * ordinary and charge in gilt or silver, gritty enamel, worn edges and a bevelled rim (inline SVG).
 * @param {ReturnType<typeof heraldryOf>} her
 */
export function crestSVG(her) {
  const hsh = her.hash;
  const metal = her.metal;
  const field = her.field;
  const ordSvg = `<path d='${ORDINARY_PATHS[her.ordinary]}' fill='url(#mt)' stroke='#2a1808' stroke-width='.8'/>`;
  const chargeSvg = `<path d='${CHARGE_PATHS[her.charge]}'/>`;
  const SH = HEATER_OUTER;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 120'><defs>
<linearGradient id='rim' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ffe2b0'/><stop offset='.18' stop-color='#b07a40'/><stop offset='.45' stop-color='#5a3a1c'/><stop offset='.7' stop-color='#8a5e30'/><stop offset='1' stop-color='#1e1208'/></linearGradient>
<radialGradient id='lit' cx='.28' cy='.2' r='.95'><stop offset='0' stop-color='#ffd8a0' stop-opacity='.45'/><stop offset='.4' stop-color='#ffb070' stop-opacity='.08'/><stop offset='1' stop-color='#000' stop-opacity='.7'/></radialGradient>
<linearGradient id='mt' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff4dc'/><stop offset='.3' stop-color='${metal}'/><stop offset='.55' stop-color='#4a3214'/><stop offset='.62' stop-color='${metal}'/><stop offset='1' stop-color='#fff0d0'/></linearGradient>
<filter id='grit' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' seed='${hsh % 97}'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.15'/><feComposite in2='SourceGraphic' operator='in'/></filter>
<filter id='dent' x='-5%' y='-5%' width='110%' height='110%'><feTurbulence type='fractalNoise' baseFrequency='.045' numOctaves='2' seed='${hsh % 53}' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='2.2'/></filter>
<filter id='emb'><feGaussianBlur in='SourceAlpha' stdDeviation='.7' result='b'/><feOffset in='b' dx='.9' dy='1.3' result='o'/><feComposite in='SourceGraphic' in2='o' operator='over'/></filter>
<clipPath id='cp'><path d='M50 15 L84 21 Q86 52 79 67 Q71 88 50 101 Q29 88 21 67 Q14 52 16 21 Z'/></clipPath>
</defs>
<path d='${SH}' fill='#000' transform='translate(1.5 2.5)' opacity='.6'/>
<path d='${SH}' fill='url(#rim)'/>
<path d='${SH}' fill='none' stroke='#000' stroke-width='1.2'/>
<path d='M50 10 L88 17 Q90 52 82 69' fill='none' stroke='#fff0d0' stroke-opacity='.55' stroke-width='1'/>
<g clip-path='url(#cp)' filter='url(#dent)'>
<rect x='0' y='0' width='100' height='120' fill='${field}'/>
<rect x='0' y='0' width='100' height='120' fill='#000' opacity='.18' filter='url(#grit)'/>
<g filter='url(#emb)'>${ordSvg}<g fill='url(#mt)' stroke='#2a1808' stroke-width='.8'>${chargeSvg}</g></g>
<rect x='0' y='0' width='100' height='120' fill='url(#lit)'/>
</g>
<path d='M50 15 L84 21 Q86 52 79 67 Q71 88 50 101 Q29 88 21 67 Q14 52 16 21 Z' fill='none' stroke='#000' stroke-opacity='.7' stroke-width='1.6'/>
<circle cx='16' cy='18' r='2.6' fill='url(#rim)' stroke='#000' stroke-width='.5'/><circle cx='84' cy='18' r='2.6' fill='url(#rim)' stroke='#000' stroke-width='.5'/><circle cx='50' cy='106' r='2.6' fill='url(#rim)' stroke='#000' stroke-width='.5'/>
</svg>`;
  return svg;
}

/** Class sigils for the sheet's medallions (100 x 100 box). */
export const CLASS_SIGILS = {
  fighter: 'M48 16 h4 v50 h-4 Z M50 10 l4 8 h-8 Z M36 64 h28 v5 h-28 Z M47 69 h6 v14 h-6 Z M50 82 a5 5 0 1 0 0.01 0 Z',
  cleric: 'M50 40 a10 10 0 1 0 0.01 0 Z M50 12 l5 16 h-10 Z M50 88 l5 -16 h-10 Z M12 50 l16 5 v-10 Z M88 50 l-16 5 v-10 Z M23 23 l14 9 -5 5 Z M77 23 l-14 9 5 5 Z M23 77 l14 -9 -5 -5 Z M77 77 l-14 -9 5 -5 Z',
  magicUser: 'M50 14 L58 40 L86 40 L63 56 L72 84 L50 66 L28 84 L37 56 L14 40 L42 40 Z',
  thief: 'M50 16 a12 12 0 1 0 0.01 0 Z M46 38 h8 v34 h8 v6 h-8 v4 h6 v6 h-6 v4 h-8 Z',
};
/** Race sigils for the sheet's medallions (100 x 100 box). */
export const RACE_SIGILS = {
  human: 'M22 66 L26 34 L38 50 L50 26 L62 50 L74 34 L78 66 Z M22 70 h56 v8 h-56 Z',
  elf: 'M50 14 C74 30 76 62 50 88 C24 62 26 30 50 14 Z',
  halfElf: 'M50 14 C74 30 76 62 50 88 Z M46 20 C30 36 30 62 46 82 Z',
  dwarf: 'M26 24 h48 v20 h-48 Z M46 44 h8 v42 h-8 Z',
  gnome: 'M18 54 Q50 6 82 54 Z M42 54 h16 v30 h-16 Z',
  halfling: 'M50 34 a24 24 0 1 0 0.01 0 Z M26 40 Q50 12 74 40 Z M48 12 h4 v14 h-4 Z',
};

/**
 * A small cast-bronze medallion with a raised sigil (inline SVG), lit from the upper left.
 * @param {string} path  sigil path in a 100 x 100 box
 */
export function medallionSVG(path, seed = 1) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs>
<radialGradient id='mr' cx='.32' cy='.28' r='.9'><stop offset='0' stop-color='#f6d8a6'/><stop offset='.2' stop-color='#a07a48'/><stop offset='.55' stop-color='#3e2e1c'/><stop offset='1' stop-color='#0c0806'/></radialGradient>
<radialGradient id='mf' cx='.4' cy='.36' r='.8'><stop offset='0' stop-color='#2c2a2a'/><stop offset='1' stop-color='#090808'/></radialGradient>
<linearGradient id='ms' x1='0' y1='0' x2='.6' y2='1'><stop offset='0' stop-color='#fff0d4'/><stop offset='.35' stop-color='#d8a868'/><stop offset='.6' stop-color='#6a4420'/><stop offset='1' stop-color='#c08a50'/></linearGradient>
<filter id='me'><feGaussianBlur in='SourceAlpha' stdDeviation='1.2' result='b'/><feOffset in='b' dx='1.6' dy='2.2' result='o'/><feFlood flood-color='#000' flood-opacity='.85'/><feComposite in2='o' operator='in' result='s'/><feMerge><feMergeNode in='s'/><feMergeNode in='SourceGraphic'/></feMerge></filter>
<filter id='gr'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' seed='${seed % 89}'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1'/><feComposite in2='SourceGraphic' operator='in'/></filter>
</defs>
<circle cx='51.5' cy='53' r='47' fill='#000' opacity='.7'/>
<circle cx='50' cy='50' r='47' fill='url(#mr)' stroke='#000' stroke-width='1.4'/>
<circle cx='50' cy='50' r='38' fill='url(#mf)' stroke='#000' stroke-width='1.6'/>
<circle cx='50' cy='50' r='38' fill='#000' opacity='.25' filter='url(#gr)'/>
<path d='M20 34 A38 38 0 0 1 66 14' fill='none' stroke='#ffe8c0' stroke-opacity='.45' stroke-width='1.2'/>
<g transform='translate(50 50) scale(.74) translate(-50 -50)' filter='url(#me)'><path d='${path}' fill='url(#ms)' stroke='#1a0e04' stroke-width='1.6'/></g>
</svg>`;
}
