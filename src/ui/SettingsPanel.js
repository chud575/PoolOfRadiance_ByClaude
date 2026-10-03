import { h, clear } from './dom.js';
import { Frame } from './components/Frame.js';
import { applySkinSettings, bindSkin, SKIN_DEFAULTS } from './styles/skin.js';
import { DEFAULT_BINDINGS } from '../core/InputManager.js';
import { DEFAULT_SETTINGS } from '../core/Settings.js';

/**
 * The full Settings screen (graphics, gameplay, audio, controls with key
 * rebinding, accessibility). Pure DOM, usable from any scene:
 *
 *   const panel = new SettingsPanel(ctx, { tab: 'graphics', onClose });
 *   ctx.ui.mount(panel.el);           // or openSettings(ctx) for a modal
 *
 * Keyboard: ↑/↓ rows · ←/→ change · Enter toggle/rebind · Q/E or Tab tabs · Esc back.
 * Gamepad: d-pad rows/values · LB/RB tabs · A toggle · B back.
 * Every change is applied live and persisted through ctx.settings.
 */

/** Extra setting defaults owned by the UI (merged over core defaults when read). */
export const UI_SETTING_DEFAULTS = {
  ...SKIN_DEFAULTS,
  quality: 'high',
  difficulty: 'veteran',
  uiVolume: 0.7,
  ambienceVolume: 0.6,
  showTooltips: true,
  cameraBob: true,
};

const QUALITY_PRESETS = {
  low: { pixelRatioCap: 1, antialias: 'fxaa', bloom: false },
  medium: { pixelRatioCap: 1, antialias: 'smaa', bloom: true },
  high: { pixelRatioCap: 1.5, antialias: 'smaa', bloom: true },
  ultra: { pixelRatioCap: 2, antialias: 'smaa', bloom: true },
};

/**
 * Choose a quality preset outside the Settings screen (first-run auto-detect):
 * stores it, applies its renderer settings and resizes the canvas.
 * @param {import('../core/context.js').GameContext} ctx
 * @param {'low'|'medium'|'high'|'ultra'} name
 */
export function applyQualityPreset(ctx, name) {
  const p = QUALITY_PRESETS[name];
  if (!p || !ctx.settings) return;
  ctx.settings.set('quality', name);
  for (const [k, v] of Object.entries(p)) ctx.settings.set(k, v);
  const r = ctx.render;
  try {
    r?.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap));
    r?.setSize?.(window.innerWidth, window.innerHeight);
    r?._applyPassEnables?.();
  } catch (e) {
    console.warn('[settings] quality preset failed', e);
  }
}

/** Human-friendly names for input actions (rebinding table), grouped. */
export const ACTION_LABELS = [
  ['Movement', [
    ['forward', 'Step forward'], ['back', 'Step back'], ['turnLeft', 'Turn left'], ['turnRight', 'Turn right'],
    ['strafeLeft', 'Sidestep left'], ['strafeRight', 'Sidestep right'], ['turnAround', 'About face'],
  ]],
  ['Commands', [
    ['area', 'Area map'], ['cast', 'Cast'], ['view', 'View character'], ['encamp', 'Encamp'], ['search', 'Search'], ['look', 'Look'],
    ['prevMember', 'Previous member'], ['nextMember', 'Next member'],
  ]],
  ['Interface', [
    ['confirm', 'Confirm'], ['cancel', 'Cancel / back'], ['quicksave', 'Quick save'], ['quickload', 'Quick load'], ['toggleClassic', 'Classic 1988 mode'],
  ]],
];

const PAD_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'View', 9: 'Menu', 10: 'LS', 11: 'RS', 12: '↑', 13: '↓', 14: '←', 15: '→' };

/**
 * One consistent gamepad glyph set (standard mapping): round face buttons in
 * the usual A/B/X/Y colours, pill-shaped bumpers/triggers/system buttons,
 * round d-pad arrows, and a dashed "unbound" glyph that matches empty key slots.
 * @param {string|null} name  'A','B','X','Y','LB','RB','LT','RT','View','Menu','↑','↓','←','→' (null = unbound)
 */
export function padGlyph(name) {
  if (!name) return h('span.por-pad.unbound', { title: 'Unbound' }, ['—']);
  if ('ABXY'.includes(name) && name.length === 1) return h(`span.por-pad.face.${name.toLowerCase()}`, { title: `${name} button` }, [name]);
  if ('↑↓←→'.includes(name)) return h('span.por-pad.dpad', { title: `D-pad ${name}` }, [dpadSvg(name)]);
  return h('span.por-pad.pill', { title: name }, [name]);
}

/** The arms of New Phlan as a gilt seal: a tower over the Moonsea waves in a roped roundel. */
function phlanSeal() {
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return `<line x1="${(50 + Math.cos(a) * 41).toFixed(1)}" y1="${(50 + Math.sin(a) * 41).toFixed(1)}" x2="${(50 + Math.cos(a) * 44).toFixed(1)}" y2="${(50 + Math.sin(a) * 44).toFixed(1)}"/>`;
  }).join('');
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 100 100');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('por-set-seal-svg');
  s.innerHTML = `<defs><linearGradient id="sealg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".35" stop-color="#d8b25a"/><stop offset=".65" stop-color="#8a6a2a"/><stop offset="1" stop-color="#e2c070"/></linearGradient></defs>
    <circle cx="50" cy="50" r="47" fill="rgba(5,8,22,0.55)" stroke="url(#sealg)" stroke-width="2.2"/>
    <circle cx="50" cy="50" r="38" fill="none" stroke="url(#sealg)" stroke-width="1.2"/>
    <g stroke="url(#sealg)" stroke-width="1.1">${ticks}</g>
    <g fill="url(#sealg)" stroke="#1a1004" stroke-width=".6">
      <path d="M41 66 V40 H38 V33 H42 V36 H46 V33 H54 V36 H58 V33 H62 V40 H59 V66 Z"/>
      <path d="M47 66 V57 a3 3 0 0 1 6 0 V66 Z" fill="#0a1024"/>
      <rect x="48.6" y="44" width="2.8" height="6" rx="1.4" fill="#0a1024"/>
      <path d="M45 33 L50 22 L55 33 Z"/>
    </g>
    <g fill="none" stroke="url(#sealg)" stroke-width="1.6" stroke-linecap="round">
      <path d="M24 70 q4.3 -4 8.6 0 t8.6 0 t8.6 0 t8.6 0 t8.6 0 t8.6 0"/>
      <path d="M28 77 q4.3 -4 8.6 0 t8.6 0 t8.6 0 t8.6 0 t8.6 0"/>
    </g>`;
  return s;
}

const EGA16 = ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA', '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'];
/** A palette-swatch chip: the sixteen EGA inks in a 8x2 tile set into a gilt-rimmed badge. */
function egaChip(label) {
  return h('span.por-set-badge', { title: 'The sixteen-colour EGA palette' }, [
    h('span.por-set-badge-sw', { 'aria-hidden': 'true' }, EGA16.map((c) => h('i', { style: { background: c } }))),
    h('span.por-set-badge-lbl', [label]),
  ]);
}

const ROT = { '↑': 0, '→': 90, '↓': 180, '←': 270 };
const svgEl = (markup, cls) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add(cls);
  s.innerHTML = markup;
  return s;
};
/** Arrow-key glyph drawn as geometry, so it sits dead centre in its keycap. */
export function arrowSvg(dir) {
  return svgEl(`<g transform="rotate(${ROT[dir] ?? 0} 8 8)"><path d="M8 2.6 L12.6 7.6 H9.6 V13.4 H6.4 V7.6 H3.4 Z" fill="currentColor"/></g>`, 'por-arrow');
}
/**
 * D-pad glyph: the same dark-enamel cross a controller has (bevelled, gilt
 * rim), with the pressed arm lit in molten gold and a dark chevron on it.
 */
function dpadSvg(dir) {
  const id = `dp${ROT[dir] ?? 0}`;
  const cross = 'M5.7 1.2 Q5.7 0.7 6.2 0.7 H9.8 Q10.3 0.7 10.3 1.2 V5.7 H14.8 Q15.3 5.7 15.3 6.2 V9.8 Q15.3 10.3 14.8 10.3 H10.3 V14.8 Q10.3 15.3 9.8 15.3 H6.2 Q5.7 15.3 5.7 14.8 V10.3 H1.2 Q0.7 10.3 0.7 9.8 V6.2 Q0.7 5.7 1.2 5.7 H5.7 Z';
  return svgEl(`<defs>`
    + `<radialGradient id="${id}e" cx="0.42" cy="0.3" r="0.8"><stop offset="0" stop-color="#3a4266"/><stop offset="0.72" stop-color="#12162a"/><stop offset="1" stop-color="#080a16"/></radialGradient>`
    + `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe6"/><stop offset="0.4" stop-color="#ffd970"/><stop offset="1" stop-color="#c8902c"/></linearGradient>`
    + `</defs>`
    + `<path d="${cross}" fill="url(#${id}e)" stroke="#c9a85c" stroke-width="0.7" stroke-linejoin="round"/>`
    + `<circle cx="8" cy="8" r="1.25" fill="#070912" opacity="0.85"/>`
    + `<g transform="rotate(${ROT[dir] ?? 0} 8 8)">`
    + `<path d="M5.95 1.05 H10.05 V6.6 L8 8 L5.95 6.6 Z" fill="url(#${id}g)" stroke="#fff4cc" stroke-width="0.3" stroke-linejoin="round"/>`
    + `<path d="M8 2.2 L9.6 4.9 H6.4 Z" fill="#1c1204"/>`
    + `</g>`
    + `<path d="M1.3 6.3 H5.7 M6.3 1.3 H9.7 M10.3 6.3 H14.7" stroke="rgba(255,255,255,0.22)" stroke-width="0.35" fill="none"/>`, 'por-dpad');
}
const keyCap = (code) => {
  const l = keyLabel(code);
  return '↑↓←→'.includes(l) && l.length === 1 ? arrowSvg(l) : l;
};

/** Readable label for a KeyboardEvent.code. */
export function keyLabel(code) {
  if (!code) return '';
  const map = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Escape: 'Esc',
    Backspace: 'Bksp', BracketLeft: '[', BracketRight: ']', Backquote: '`', Tab: 'Tab', ShiftLeft: 'Shift', ShiftRight: 'R Shift',
    ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=',
    PageUp: 'PgUp', PageDown: 'PgDn',
  };
  if (map[code]) return map[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

/** Tiny inline SVG icons for the tabs (drawn, not loaded). */
const ICONS = {
  graphics: '<path d="M2 12 C6 5 18 5 22 12 C18 19 6 19 2 12 Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/>',
  gameplay: '<path d="M5 19 L16 8 M14 6 L18 10 M16 8 L20 4 M4 20 L7 17 M6 15 L9 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M19 19 L8 8 M10 6 L6 10 M8 8 L4 4 M20 20 L17 17 M18 15 L15 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  audio: '<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16 8 C18 10 18 14 16 16 M18.5 5.5 C22 9 22 15 18.5 18.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  controls: '<rect x="2.5" y="7" width="19" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10 V14 M5 12 H9" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="11" r="1.2" fill="currentColor"/><circle cx="18" cy="13.2" r="1.2" fill="currentColor"/>',
  access: '<circle cx="12" cy="4.6" r="2" fill="currentColor"/><path d="M5 8 H19 M12 8 V14 M12 14 L8 21 M12 14 L16 21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};
const icon = (id) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.classList.add('por-set-icon');
  s.innerHTML = ICONS[id] ?? '';
  return s;
};

export class SettingsPanel {
  /**
   * @param {import('../core/context.js').GameContext} ctx
   * @param {{tab?: string, onClose?: () => void, variant?: 'screen'|'modal'}} [o]
   */
  constructor(ctx, { tab = 'graphics', onClose = null, variant = 'screen' } = {}) {
    this.ctx = ctx;
    bindSkin(ctx);
    this.onClose = onClose;
    this.sections = this._sections();
    this.tab = this.sections.some((s) => s.id === tab) ? tab : 'graphics';
    this.focus = 0;
    this.capture = null; // {action, slot} while waiting for a key
    this.el = h(`div.por-settings.por-settings--${variant}`);
    // keyboard focus follows the controller/keyboard cursor into the panel and
    // returns to whatever held it (the title menu, a HUD button) on close
    this._prevFocus = typeof document !== 'undefined' ? document.activeElement : null;
    this._build();
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => this._focusRow());
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey, true);
    this._offBus = ctx.bus.on('input:action', ({ action, code }) => this._onPad(action, code));
    this._offSettings = ctx.bus.on('settings:changed', ({ key }) => {
      if (key === 'classicMode') this._refreshRows();
    });
  }

  get(key) {
    const v = this.ctx.settings.get(key);
    return v === undefined ? (UI_SETTING_DEFAULTS[key] ?? DEFAULT_SETTINGS[key]) : v;
  }

  set(key, value) {
    this.ctx.settings.set(key, value);
    this._apply(key, value);
    this.ctx.audio?.sfx?.('click', { bus: 'ui', pitch: 1.2 });
  }

  _apply(key, value) {
    const { render } = this.ctx;
    if (key === 'quality') {
      const p = QUALITY_PRESETS[value];
      if (p) for (const [k, v] of Object.entries(p)) this.ctx.settings.set(k, v);
      this._applyRenderer();
      this._refreshRows();
    } else if (key === 'classicMode') {
      render?.setClassic?.(value);
    } else if (key === 'bloom' || key === 'antialias' || key === 'pixelRatioCap') {
      this._applyRenderer();
    } else if (key in SKIN_DEFAULTS) {
      applySkinSettings(this.ctx.settings);
    }
  }

  _applyRenderer() {
    const r = this.ctx.render;
    if (!r) return;
    try {
      const cap = this.get('pixelRatioCap');
      r.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
      r.setSize?.(window.innerWidth, window.innerHeight);
      r._applyPassEnables?.();
    } catch (e) {
      console.warn('[settings] renderer update failed', e);
    }
  }

  _sections() {
    const pct = (v) => `${Math.round(v * 100)}%`;
    return [
      {
        id: 'graphics', label: 'Graphics', blurb: 'How Phlan is drawn.',
        rows: [
          { key: 'quality', label: 'Quality preset', desc: 'Resolution, anti-aliasing and bloom in one.', help: 'Balances fidelity and speed: render resolution, anti-aliasing and bloom together. Software renderers start on Low.', type: 'choice', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] },
          { key: 'classicMode', label: 'Classic 1988 mode', desc: 'Sixteen EGA colours at 320×200, as in 1988. Toggle with F2.', help: 'The sixteen-colour EGA palette, 320×200 pixels and the original 5×7 lettering — as Phlan looked on a PC in 1988. Toggle any time with F2.', type: 'toggle', badge: 'EGA' },
          { key: 'bloom', label: 'Bloom', desc: 'Glow around torches, spells and the Pool itself.', type: 'toggle' },
          { key: 'antialias', label: 'Anti-aliasing', desc: 'SMAA is sharper; FXAA is cheaper.', help: 'Smooths jagged edges. SMAA is sharper; FXAA is cheaper.', type: 'choice', options: [['none', 'Off'], ['fxaa', 'FXAA'], ['smaa', 'SMAA']] },
          { key: 'pixelRatioCap', label: 'Render resolution', desc: 'Pixel density on high-DPI screens.', help: 'Pixel density on high-DPI displays. Lower it if the frame rate stutters.', type: 'choice', options: [[1, '100%'], [1.5, '150%'], [2, '200%']] },
          { key: 'cameraBob', label: 'Camera motion', desc: 'Gentle head-bob and sway while walking.', help: 'Gentle head-bob and sway while walking the streets.', type: 'toggle' },
        ],
      },
      {
        id: 'gameplay', label: 'Gameplay', blurb: 'Pace, difficulty and conveniences.',
        rows: [
          { key: 'difficulty', label: 'Difficulty', desc: 'Gold Box levels. Novice and Squire soften monsters; Adept and Champion toughen them and reduce experience less.', type: 'choice', options: [['novice', 'Novice'], ['squire', 'Squire'], ['veteran', 'Veteran'], ['adept', 'Adept'], ['champion', 'Champion']] },
          { key: 'fighterThac0', label: 'Fighter THAC0', desc: 'Pool of Radiance improves a fighter\'s THAC0 every level; the Dungeon Masters Guide matrix improves it by 2 every second level.', type: 'choice', options: [['goldBox', 'Pool of Radiance'], ['dmg', 'DMG matrix']] },
          { key: 'textSpeed', label: 'Text speed', desc: 'How quickly narration and messages are written out.', type: 'choice', options: [[0.5, 'Slow'], [1, 'Normal'], [2, 'Fast'], [0, 'Instant']] },
          { key: 'combatSpeed', label: 'Combat speed', desc: 'The classic "game speed": delay between combat actions and messages.', type: 'choice', options: [[0.5, 'Slow'], [1, 'Normal'], [1.5, 'Fast'], [2.5, 'Swift']] },
          { key: 'moveSpeed', label: 'Movement speed', desc: 'How fast the party steps and turns in the streets and dungeons.', type: 'choice', options: [[0.75, 'Stately'], [1, 'Normal'], [1.5, 'Brisk'], [2.5, 'Swift']] },
          { key: 'autosave', label: 'Autosave', desc: 'Save to the Auto slot whenever the party enters a new area. Manual slots are never overwritten.', type: 'toggle' },
          { key: 'showMinimap', label: 'Mini-map', desc: 'Show the automap corner while exploring.', type: 'toggle' },
          { key: 'confirmDangerous', label: 'Confirm dangerous actions', desc: 'Ask before dropping items, leaving camp unrested or fleeing combat.', type: 'toggle' },
          { key: 'showTooltips', label: 'Tooltips', desc: 'Explain stats, spells and commands when hovering or focusing them.', type: 'toggle' },
        ],
      },
      {
        id: 'audio', label: 'Audio', blurb: 'Volume of the music and effects.',
        rows: [
          { key: 'masterVolume', label: 'Master volume', type: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
          { key: 'musicVolume', label: 'Music', desc: 'The score of the Moonsea.', type: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
          { key: 'sfxVolume', label: 'Effects', desc: 'Steel, spells, doors and footsteps.', type: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
          { key: 'uiVolume', label: 'Interface', desc: 'Menu clicks and confirmations.', type: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
          { key: 'ambienceVolume', label: 'Ambience', desc: 'Wind, surf, the city and the dungeon dark.', type: 'slider', min: 0, max: 1, step: 0.05, fmt: pct },
        ],
      },
      { id: 'controls', label: 'Controls', blurb: 'Rebind keys. Click a key, then press the new one (Esc cancels, Del clears).', custom: 'bindings' },
      {
        id: 'access', label: 'Accessibility', blurb: 'Make the game comfortable to read and play.',
        rows: [
          { key: 'uiScale', label: 'Interface scale', desc: 'Size of every panel, menu and piece of text.', type: 'slider', min: 0.8, max: 1.5, step: 0.05, fmt: pct },
          { key: 'fontSize', label: 'Text size', desc: 'Size of narration, log and descriptions.', type: 'choice', options: [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['huge', 'Huge']] },
          { key: 'colorblind', label: 'Colour-blind palette', desc: 'Replaces the red/green health and status colours with distinguishable ones.', type: 'choice', options: [['off', 'Off'], ['deutan', 'Deuteran.'], ['protan', 'Protan.'], ['tritan', 'Tritan.']] },
          { key: 'highContrast', label: 'High-contrast text', desc: 'Opaque panels and brighter text.', type: 'toggle' },
          { key: 'readableFont', label: 'Readable font', desc: 'Swap the book serif for a clean, highly legible sans-serif.', type: 'toggle' },
          { key: 'reduceMotion', label: 'Reduce motion', desc: 'Turns off UI animation, camera sway and screen shake.', type: 'toggle' },
        ],
      },
    ];
  }

  // ---------------------------------------------------------------- building
  _build() {
    clear(this.el);
    this.tabsEl = h('nav.por-set-tabs', { role: 'tablist' });
    this.tabBtns = this.sections.map((s) =>
      h('button.por-set-tab', { type: 'button', role: 'tab', dataset: { tab: s.id }, onclick: () => this.setTab(s.id) }, [icon(s.id), h('span', [s.label])]),
    );
    this.tabsEl.append(
      h('div.por-set-tabs-head', [
        h('span.por-set-tabs-hint', [h('span.por-keycap', ['Q']), padGlyph('LB')]),
        h('span.por-set-tabs-cap', ['Sections']),
        h('span.por-set-tabs-hint', [padGlyph('RB'), h('span.por-keycap', ['E'])]),
      ]),
      ...this.tabBtns,
    );
    // context help for the focused option, anchored to the foot of the sidebar
    this.helpName = h('div.por-set-help-name');
    this.helpText = h('div.por-set-help-text');
    this.helpEl = h('div.por-set-help', [
      h('div.por-set-help-head', [phlanSeal(), h('span.por-set-help-cap', ['About this option'])]),
      this.helpName,
      this.helpText,
      h('div.por-set-help-foot', ['Changes apply at once and are kept between sessions.']),
    ]);
    this.tabsEl.append(this.helpEl);
    this.headEl = h('div.por-set-head');
    this.bodyEl = h('div.por-set-body');
    const footer = h('div.por-set-footer', [
      h('div.por-set-legend', [
        h('span', [h('span.por-keycap', [arrowSvg('↑')]), h('span.por-keycap', [arrowSvg('↓')]), h('span.por-set-legend-lbl', ['Select'])]),
        h('span', [h('span.por-keycap', [arrowSvg('←')]), h('span.por-keycap', [arrowSvg('→')]), h('span.por-set-legend-lbl', ['Adjust'])]),
        h('span', [h('span.por-keycap', ['Enter']), padGlyph('A'), h('span.por-set-legend-lbl', ['Toggle'])]),
        h('span', [h('span.por-keycap', ['Esc']), padGlyph('B'), h('span.por-set-legend-lbl', ['Back'])]),
      ]),
      h('div.por-set-actions', [
        h('button.por-btn', { type: 'button', onclick: () => this.resetSection() }, ['Restore defaults']),
        h('button.por-btn.primary', { type: 'button', onclick: () => this.close() }, ['Done']),
      ]),
    ]);
    this.moreEl = h('button.por-set-more', { type: 'button', onclick: () => this._pageDown() }, ['More below', h('span.por-set-more-arrow', ['▾'])]);
    this.bodyEl.addEventListener('scroll', () => this._updateScrollCue());
    const main = h('div.por-set-main', [this.headEl, h('div.por-set-bodywrap', [this.bodyEl, this.moreEl])]);
    this.mainEl = main;
    this.frame = Frame({ title: 'Settings', variant: 'blue', className: 'por-set-frame', children: [h('div.por-set-layout', [this.tabsEl, main]), footer] });
    this.el.append(this.frame.el);
    this.setTab(this.tab, { silent: true });
  }

  setTab(id, { silent = false, keepCapture = false, keepFocus = false } = {}) {
    const sameTab = this.tab === id;
    this.tab = id;
    if (!(keepFocus && sameTab)) this.focus = 0;
    if (!keepCapture) this.capture = null;
    this.tabBtns.forEach((b) => b.classList.toggle('sel', b.dataset.tab === id));
    const sec = this.sections.find((s) => s.id === id);
    clear(this.headEl).append(h('h2.por-set-title', [sec.label]), h('div.por-set-blurb', [sec.blurb ?? '']), h('div.por-rule'));
    clear(this.bodyEl);
    this.rowEls = [];
    if (sec.custom === 'bindings') this._buildBindings();
    else for (const row of sec.rows) this.bodyEl.append(this._row(row));
    const note = this._note(sec.id);
    if (note) this.bodyEl.append(note);
    this._markFocus();
    queueMicrotask(() => { this._fitRows(); this._updateScrollCue(); });
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => { this._fitRows(); this._updateScrollCue(); });
    if (!silent) this.ctx.audio?.sfx?.('click', { bus: 'ui', pitch: 0.9 });
  }

  /** A small illustrated note that closes short sections (no dead space). */
  _note(id) {
    if (id === 'graphics') {
      const ega = ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA', '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'];
      return h('div.por-set-note.compact', [
        h('div.por-set-swatches', ega.map((c) => h('i', { style: { background: c } }))),
        h('div.por-set-note-text', [h('b', ['The 1988 palette: ']), 'classic mode paints Phlan in these sixteen colours.']),
      ]);
    }
    if (id === 'audio') {
      return h('div.por-set-note', [
        h('div.por-set-note-glyph', ['♪']),
        h('div.por-set-note-text', [h('b', ['Every sound is synthesised. ']), 'Lutes, choirs, steel and spell-fire are performed live by the audio engine — no recordings — so the score follows the party from tavern to crypt.']),
      ]);
    }
    if (id === 'access') {
      return h('div.por-set-note.por-set-preview', [
        h('div.por-set-note-cap', ['Preview']),
        h('div.por-set-note-text', [h('b.por-gilt-text', ['The Slums. ']), 'The streets are strewn with rubble and debris. ', h('span.por-hk', ['K']), 'obolds lurk in the shadows.']),
      ]);
    }
    return null;
  }

  /**
   * Fit the scrolling body to a whole number of rows, so the last visible row
   * is never cut in half behind the fade or the "More below" pill.
   */
  _fitRows() {
    const b = this.bodyEl;
    const wrap = b?.parentElement;
    if (!b || !wrap || !b.isConnected) return;
    b.style.flex = '';
    b.style.height = '';
    const cs = getComputedStyle(wrap);
    const avail = wrap.clientHeight - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.paddingTop) || 0);
    if (!(avail > 0) || b.scrollHeight <= avail + 1) return;
    const top0 = b.getBoundingClientRect().top - b.scrollTop;
    let fit = 0;
    for (const el of b.querySelectorAll('.por-set-row, .por-bind-row, .por-bind-group, .por-set-note')) {
      const bottom = el.getBoundingClientRect().bottom - top0;
      if (bottom <= avail) fit = Math.max(fit, bottom);
    }
    if (fit > 40) {
      b.style.flex = 'none';
      b.style.height = `${Math.ceil(fit + 3)}px`;
    }
    if (!this._fitObs && typeof ResizeObserver !== 'undefined') {
      this._fitObs = new ResizeObserver(() => {
        if (this._fitting) return;
        this._fitting = true;
        requestAnimationFrame(() => { this._fitting = false; this._fitRows(); this._updateScrollCue(); });
      });
      this._fitObs.observe(this.frame.el);
    }
  }

  /** Scroll down a page, landing on a whole row (the first one cut by the bottom edge goes to the top). */
  _pageDown() {
    const b = this.bodyEl;
    const top0 = b.getBoundingClientRect().top;
    let target = b.scrollTop + b.clientHeight * 0.7;
    for (const el of b.querySelectorAll('.por-set-row, .por-bind-row, .por-bind-group')) {
      const r = el.getBoundingClientRect();
      if (r.bottom - top0 > b.clientHeight + 1) { target = b.scrollTop + (r.top - top0) - 4; break; }
    }
    b.scrollTo({ top: target, behavior: 'smooth' });
  }

  _updateScrollCue() {
    const b = this.bodyEl;
    if (!b) return;
    const more = b.scrollHeight - b.clientHeight - b.scrollTop > 4;
    this.mainEl?.classList.toggle('more-below', more);
    this.mainEl?.classList.toggle('more-above', b.scrollTop > 4);
  }

  _row(row) {
    const ctl = h('div.por-set-control');
    const el = h('div.por-set-row', { dataset: { key: row.key }, role: 'group', 'aria-label': row.label, tabindex: '-1', onmouseenter: () => this._setFocus(this.rowEls.indexOf(el)) }, [
      h('div.por-set-label', [h('span.por-set-name', [row.label, row.badge ? egaChip(row.badge) : null]), row.desc ? h('span.por-set-desc', [row.desc]) : null]),
      ctl,
    ]);
    el._row = row;
    el._ctl = ctl;
    this._fillControl(el);
    this.rowEls.push(el);
    return el;
  }

  _fillControl(el) {
    const row = el._row;
    const ctl = clear(el._ctl);
    const v = this.get(row.key);
    if (row.type === 'toggle') {
      const btn = h(`button.por-toggle${v ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': v ? 'true' : 'false', onclick: () => this._change(el, 0, true) }, [
        h('span.por-toggle-track', [h('span.por-toggle-knob')]),
        h('span.por-toggle-label', [v ? 'On' : 'Off']),
      ]);
      ctl.append(btn);
    } else if (row.type === 'choice') {
      const seg = h('div.por-seg', { role: 'radiogroup' });
      for (const [val, lab] of row.options) {
        seg.append(h(`button.por-seg-opt${val === v ? '.sel' : ''}${/^\d/.test(String(lab)) ? '.num' : ''}`, { type: 'button', role: 'radio', 'aria-checked': val === v ? 'true' : 'false', onclick: () => this._setValue(el, val) }, [lab]));
      }
      ctl.append(seg);
    } else if (row.type === 'slider') {
      const f = (v - row.min) / (row.max - row.min);
      const track = h('div.por-slider', { role: 'slider', 'aria-valuemin': row.min, 'aria-valuemax': row.max, 'aria-valuenow': v }, [
        h('div.por-slider-fill', { style: { width: `${f * 100}%` } }),
        h('div.por-slider-ticks'),
        h('div.por-slider-thumb', { style: { left: `${f * 100}%` } }),
      ]);
      const drag = (e) => {
        const r = track.getBoundingClientRect();
        const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const raw = row.min + k * (row.max - row.min);
        this._setValue(el, Math.round(raw / row.step) * row.step);
      };
      track.addEventListener('pointerdown', (e) => {
        drag(e);
        const mv = (ev) => drag(ev);
        const up = () => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
      ctl.append(track, h('span.por-slider-val', [row.fmt ? row.fmt(v) : String(v)]));
    }
  }

  _setValue(el, value) {
    const row = el._row;
    if (row.type === 'slider') value = Math.min(row.max, Math.max(row.min, Number(value.toFixed(3))));
    if (this.get(row.key) === value) return;
    this.set(row.key, value);
    this._fillControl(el);
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  /** Step a row's value: d = -1/+1 (left/right), toggle = Enter. */
  _change(el, d, toggle = false) {
    const row = el._row;
    if (!row) return el._activate?.();
    const v = this.get(row.key);
    if (row.type === 'toggle') this._setValue(el, !v);
    else if (row.type === 'choice') {
      const i = row.options.findIndex(([o]) => o === v);
      const n = row.options.length;
      const j = toggle ? (i + 1) % n : Math.min(n - 1, Math.max(0, (i < 0 ? 0 : i) + d));
      this._setValue(el, row.options[j][0]);
    } else if (row.type === 'slider') this._setValue(el, v + (toggle ? 0 : d * row.step));
  }

  _refreshRows() {
    for (const el of this.rowEls ?? []) if (el._row) this._fillControl(el);
  }

  _buildBindings() {
    const input = this.ctx.input;
    const bindings = input?.bindings ?? DEFAULT_BINDINGS;
    const table = h('div.por-bind');
    table.append(h('div.por-bind-head', [h('span', ['Action']), h('span', ['Primary']), h('span', ['Secondary']), h('span', ['Gamepad'])]));
    for (const [group, actions] of ACTION_LABELS) {
      table.append(h('div.por-bind-group', [group]));
      for (const [action, label] of actions) {
        const codes = bindings[action] ?? [];
        const keys = codes.filter((c) => !c.startsWith('pad:'));
        const pads = codes.filter((c) => c.startsWith('pad:')).map((c) => PAD_NAMES[c.slice(4)] ?? c.slice(4));
        const slot = (i) => {
          const waiting = this.capture && this.capture.action === action && this.capture.slot === i;
          return h(`button.por-bind-key${waiting ? '.waiting' : ''}${keys[i] ? '' : '.empty'}`, {
            type: 'button',
            onclick: (e) => {
              e.stopPropagation();
              this._beginCapture(action, i);
            },
          title: keys[i] ? undefined : 'Empty — click to bind a key',
          }, [waiting ? 'Press a key…' : keys[i] ? keyCap(keys[i]) : h('span.por-bind-add', [h('i'), 'Bind'])]);
        };
        const row = h('div.por-bind-row', { dataset: { action }, role: 'group', 'aria-label': label, tabindex: '-1' }, [
          h('span.por-bind-label', [label]), slot(0), slot(1),
          h('span.por-bind-pad', pads.length ? pads.map((p) => padGlyph(p)) : [padGlyph(null)]),
        ]);
        row._activate = () => this._beginCapture(action, 0);
        row.addEventListener('mouseenter', () => this._setFocus(this.rowEls.indexOf(row)));
        this.rowEls.push(row);
        table.append(row);
      }
    }
    const reset = h('button.por-btn', { type: 'button', onclick: () => { input?.resetBindings(); this.setTab('controls', { silent: true }); } }, ['Reset all keys']);
    this.bodyEl.append(table, h('div.por-bind-foot', [h('span.por-muted', ['Conflicting keys are highlighted. Gamepad layout follows the standard mapping.']), reset]));
    this._markConflicts();
  }

  _markConflicts() {
    const input = this.ctx.input;
    if (!input) return;
    const seen = new Map();
    for (const [a, codes] of Object.entries(input.bindings)) for (const c of codes) if (!c.startsWith('pad:')) seen.set(c, [...(seen.get(c) ?? []), a]);
    // movement/menu overlaps are by design (arrows drive both)
    const benign = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const names = new Map(ACTION_LABELS.flatMap(([, list]) => list));
    for (const row of this.rowEls) {
      const a = row.dataset.action;
      const codes = (input.bindings[a] ?? []).filter((c) => !c.startsWith('pad:'));
      const others = new Set();
      for (const c of codes) if (!benign.has(c)) for (const b of seen.get(c) ?? []) if (b !== a) others.add(names.get(b) ?? b);
      const bad = others.size > 0;
      row.classList.toggle('conflict', bad);
      row._conflict = bad ? [...others].join(', ') : null;
      row.querySelector('.por-bind-warn')?.remove();
      if (bad) row.querySelector('.por-bind-label')?.append(h('span.por-bind-warn', { title: `Also bound to ${row._conflict}` }, [`⚠ also ${row._conflict}`]));
    }
    this._updateHelp();
  }

  _beginCapture(action, slot) {
    if (!this.ctx.input) return;
    this.capture = { action, slot };
    const scroll = this.bodyEl.scrollTop;
    this.setTab('controls', { silent: true, keepCapture: true });
    this.bodyEl.scrollTop = scroll;
    const i = this.rowEls.findIndex((r) => r.dataset.action === action);
    this._setFocus(i);
    this.ctx.audio?.sfx?.('click', { bus: 'ui', pitch: 1.5 });
  }

  _rebuildBindings() {
    const f = this.focus;
    const scroll = this.bodyEl.scrollTop;
    this.setTab('controls', { silent: true, keepFocus: true });
    this.bodyEl.scrollTop = scroll;
    this._setFocus(f);
  }

  _finishCapture(code) {
    const { action, slot } = this.capture;
    const input = this.ctx.input;
    const codes = [...(input.bindings[action] ?? [])];
    const keys = codes.filter((c) => !c.startsWith('pad:'));
    const pads = codes.filter((c) => c.startsWith('pad:'));
    if (code === null) keys.splice(slot, 1);
    else if (slot < keys.length) keys[slot] = code;
    else keys.push(code);
    input.rebind(action, [...new Set(keys), ...pads]);
    this.capture = null;
    this._rebuildBindings();
  }

  // ---------------------------------------------------------------- focus/input
  _setFocus(i) {
    if (i < 0 || !this.rowEls.length) return;
    this.focus = Math.max(0, Math.min(this.rowEls.length - 1, i));
    this._markFocus();
  }

  /** Fill the sidebar's help box from the focused row. */
  _updateHelp() {
    if (!this.helpEl) return;
    const r = this.rowEls[this.focus];
    if (!r) return;
    if (r._row) {
      this.helpName.textContent = r._row.label;
      this.helpText.textContent = r._row.help ?? r._row.desc ?? 'Adjust with ← and →.';
    } else if (r.dataset.action) {
      const label = r.querySelector('.por-bind-label')?.firstChild?.textContent ?? r.dataset.action;
      const warn = r._conflict;
      this.helpName.textContent = label;
      this.helpText.textContent = warn
        ? `This key is also bound to ${warn}. Pressing it will do both — rebind one of them.`
        : 'Click a key (or press Enter) and then the new key. Esc cancels, Del clears the slot.';
    }
    this.helpEl.classList.toggle('warn', !!r._conflict);
  }

  /** Move DOM focus onto the focused row (screen readers and focus rings follow the cursor). */
  _focusRow() {
    const r = this.rowEls?.[this.focus];
    if (!r || !this.el.isConnected || typeof r.focus !== 'function' || typeof document === 'undefined') return;
    const a = document.activeElement;
    // leave focus alone while the pointer is working a control inside the row
    if (a && a !== document.body && typeof r.contains === 'function' && r.contains(a) && a !== r) return;
    try { r.focus({ preventScroll: true }); } catch { /* old engines */ }
  }

  _markFocus() {
    this.rowEls.forEach((r, j) => {
      r.classList.toggle('focus', j === this.focus);
      r.tabIndex = j === this.focus ? 0 : -1;
    });
    this._focusRow();
    this._updateHelp();
    this._updateScrollCue();
    const r = this.rowEls[this.focus];
    if (r && this.bodyEl.scrollHeight > this.bodyEl.clientHeight) {
      const top = r.offsetTop - this.bodyEl.offsetTop;
      if (top < this.bodyEl.scrollTop) this.bodyEl.scrollTop = top - 8;
      else if (top + r.offsetHeight > this.bodyEl.scrollTop + this.bodyEl.clientHeight) this.bodyEl.scrollTop = top + r.offsetHeight - this.bodyEl.clientHeight + 8;
    }
  }

  _cycleTab(d) {
    const i = this.sections.findIndex((s) => s.id === this.tab);
    const n = this.sections.length;
    this.setTab(this.sections[(i + d + n) % n].id);
  }

  _onKey(e) {
    if (!this.el.isConnected) return;
    if (this.capture) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code) && e.repeat) return;
      if (e.code === 'Escape') {
        this.capture = null;
        this._rebuildBindings();
      } else if (e.code === 'Delete' || e.code === 'Backspace') this._finishCapture(null);
      else this._finishCapture(e.code);
      return;
    }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const row = this.rowEls[this.focus];
    let handled = true;
    switch (e.key) {
      case 'ArrowUp': this._setFocus(this.focus - 1); break;
      case 'ArrowDown': this._setFocus(this.focus + 1); break;
      case 'ArrowLeft': row && this._change(row, -1); break;
      case 'ArrowRight': row && this._change(row, 1); break;
      case 'Enter': case ' ': row && this._change(row, 0, true); break;
      case 'Tab': this._cycleTab(e.shiftKey ? -1 : 1); break;
      case 'q': case 'Q': case 'PageUp': this._cycleTab(-1); break;
      case 'e': case 'E': case 'PageDown': this._cycleTab(1); break;
      case 'Escape': case 'Backspace': this.close(); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  _onPad(action, code) {
    if (!this.el.isConnected || !String(code).startsWith('pad:') || this.capture) return;
    const row = this.rowEls[this.focus];
    if (action === 'forward') this._setFocus(this.focus - 1);
    else if (action === 'back') this._setFocus(this.focus + 1);
    else if (action === 'turnLeft') row && this._change(row, -1);
    else if (action === 'turnRight') row && this._change(row, 1);
    else if (action === 'confirm') row && this._change(row, 0, true);
    else if (action === 'strafeLeft') this._cycleTab(-1);
    else if (action === 'strafeRight') this._cycleTab(1);
    else if (action === 'cancel') this.close();
  }

  resetSection() {
    const sec = this.sections.find((s) => s.id === this.tab);
    if (sec.custom === 'bindings') {
      this.ctx.input?.resetBindings();
    } else {
      for (const row of sec.rows) {
        const def = UI_SETTING_DEFAULTS[row.key] ?? DEFAULT_SETTINGS[row.key];
        if (def !== undefined && this.get(row.key) !== def) {
          this.ctx.settings.set(row.key, def);
          this._apply(row.key, def);
        }
      }
    }
    this.setTab(this.tab);
  }

  close() {
    this.ctx.audio?.sfx?.('click', { bus: 'ui', pitch: 0.8 });
    this.onClose?.();
  }

  dispose() {
    this._fitObs?.disconnect();
    window.removeEventListener('keydown', this._onKey, true);
    this._offBus?.();
    this._offSettings?.();
    const hadFocus = typeof document !== 'undefined' && typeof this.el.contains === 'function' && this.el.contains(document.activeElement);
    this.el.remove();
    if (hadFocus && this._prevFocus?.isConnected) {
      try { this._prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * Open the settings screen as a modal overlay from any scene.
 * Resolves when closed.
 * @param {import('../core/context.js').GameContext} ctx
 */
export function openSettings(ctx, { tab } = {}) {
  return new Promise((resolve) => {
    const backdrop = h('div.por-modal-backdrop.por-settings-backdrop');
    const panel = new SettingsPanel(ctx, {
      tab,
      variant: 'modal',
      onClose: () => {
        panel.dispose();
        backdrop.remove();
        resolve();
      },
    });
    backdrop.append(panel.el);
    ctx.ui.layers.modal.append(backdrop);
  });
}
