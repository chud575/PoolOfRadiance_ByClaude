import './styles/pause.css';
import { h } from './dom.js';
import { Frame } from './components/Frame.js';
import { SettingsPanel, keyLabel, padGlyph } from './SettingsPanel.js';
import { SAVE_SLOTS } from '../core/SaveManager.js';
import { hasMap, getMap } from '../data/maps/index.js';

/**
 * In-game pause menu: Resume · Save Game · Load Game · Settings · Controls ·
 * Quit to Main Menu. Pure DOM in the modal layer.
 *
 *   installPauseMenu(ctx, params)  – once per in-game scene enter (idempotent):
 *                                    F10 ('pause' action) toggles the menu; the
 *                                    debug param `pause=1|save|load|controls|quit`
 *                                    opens it on that page (gallery shots).
 *   openPauseMenu(ctx, {page})     – open (scenes call this on Esc when they
 *                                    have nothing else to cancel).
 *   isPauseMenuOpen()
 *
 * While open: ctx.scenes.paused (scenes render but are not updated, so combat
 * playback and world animation stand still), ctx.clock.timeScale = 0 (game
 * time frozen), ctx.input.capture routes every action here instead of the bus,
 * and a capture-phase keydown listener keeps raw keys from the scene below.
 * Keyboard: ↑/↓ (or W/S) choose · Enter select · Esc back · F10 resume.
 * Gamepad: d-pad choose · A select · B back · Start resume. Mouse: hover + click.
 */

const IN_GAME = new Set(['explore', 'combat', 'automap', 'camp', 'shop', 'dialogue']);
const installed = new WeakSet();
/** @type {PauseMenu|null} */
let current = null;

/** @param {import('../core/context.js').GameContext} ctx @param {Record<string, any>} [params] */
export function installPauseMenu(ctx, params = {}) {
  if (!installed.has(ctx)) {
    installed.add(ctx);
    ctx.bus.on('input:action', ({ action }) => {
      if (action !== 'pause') return;
      if (current) current.close();
      else openPauseMenu(ctx);
    });
  }
  const p = params?.pause;
  if (p && p !== '0') openPauseMenu(ctx, { page: p === '1' || p === true ? 'root' : String(p), force: true });
}

export function isPauseMenuOpen() {
  return !!current;
}

/**
 * Open the pause menu (no-op when it is already open, outside a game scene,
 * mid-transition, or while another modal owns the screen).
 * @param {import('../core/context.js').GameContext} ctx
 * @param {{page?: string, force?: boolean}} [o]
 */
export function openPauseMenu(ctx, { page = 'root', force = false } = {}) {
  if (current) return current;
  const sm = ctx.scenes;
  if (!force && (sm.transitioning || !IN_GAME.has(sm.currentName))) return null;
  if (!force && ctx.ui.layers.modal.querySelector('.por-modal-backdrop')) return null;
  current = new PauseMenu(ctx, page);
  return current;
}

const fmtWhen = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};

/** Combat key reference (CombatScene's fixed keys; the command letters follow the 1988 game). */
const COMBAT_KEYS = [
  [['↑', '↓', '←', '→'], 'Move, or steer the aim'],
  [['Num 1–9'], 'Move in eight directions'],
  [['Enter'], 'Confirm square / target'],
  [['Tab'], 'Next target (Shift: previous)'],
  [['Esc'], 'Cancel, or pause when idle'],
  [['A'], 'Aim'], [['C'], 'Cast'], [['U'], 'Use item'], [['T'], 'Turn undead'],
  [['G'], 'Guard'], [['D'], 'Delay'], [['B'], 'Bandage'], [['E'], 'End turn'],
  [['Q'], 'Quick: auto-fight (Shift: one)'], [['S'], 'Combat speed'], [['V'], 'View sheet'],
];
const CAMERA_KEYS = [
  [[',', '.'], 'Rotate the camera'],
  [['[', ']'], 'Tilt the camera'],
  [['+', '−'], 'Zoom (or mouse wheel)'],
  [['Shift', '↑↓←→'], 'Pan the camera'],
  [['Home'], 'Recentre on the active figure'],
  [['Right drag'], 'Orbit · middle drag pans'],
];
const PAD_KEYS = [
  [['↑'], 'D-pad: move / choose'], [['A'], 'Confirm'], [['B'], 'Cancel · pause'],
  [['LB', 'RB'], 'Sidestep / cycle targets'], [['Y'], 'Turn about'], [['Menu'], 'Encamp · combat commands'],
];

export class PauseMenu {
  /** @param {import('../core/context.js').GameContext} ctx @param {string} page */
  constructor(ctx, page = 'root') {
    this.ctx = ctx;
    this.sub = null; // Settings panel while open
    this.items = [];
    this.index = 0;
    this.combat = ctx.scenes.currentName === 'combat';
    // freeze: scenes stop updating, game clock stops
    this._prevScale = ctx.clock.timeScale;
    ctx.clock.timeScale = 0;
    // (a frozen debug clock already holds every scene still; they keep settling their first frames)
    this._pausedScenes = !ctx.clock.frozen;
    if (this._pausedScenes) ctx.scenes.paused = true;
    this._prevCapture = ctx.input.capture;
    ctx.input.capture = (e) => this._onAction(e);
    this._prevFocus = document.activeElement;

    this.frame = Frame({ title: 'Paused', variant: 'blue', className: 'por-pause-frame' });
    this.el = h('div.por-pause', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' }, [this.frame.el]);
    this.backdrop = h(`div.por-modal-backdrop.por-pause-backdrop${ctx.clock.frozen ? '.still' : ''}`, [this.el]);
    // pointer input on the menu never reaches the scene's window listeners (camera drag, clicks)
    for (const t of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'wheel', 'contextmenu', 'click']) {
      this.backdrop.addEventListener(t, (e) => {
        e.stopPropagation();
        if (t === 'contextmenu') e.preventDefault();
      }, { passive: t !== 'contextmenu' && t !== 'wheel' ? true : undefined });
    }
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop && this.page === 'root') this.close();
    });
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey, true);
    ctx.ui.layers.modal.append(this.backdrop);
    ctx.audio?.sfx?.('open', { bus: 'ui' });
    this.show(page);
  }

  // ------------------------------------------------------------------ pages
  show(page, focusId) {
    const pages = { root: this._root, save: this._slots, load: this._slots, controls: this._controls, quit: this._quit };
    if (!pages[page]) page = 'root';
    if (page === 'save' && !this._canSave()) page = 'root';
    this.page = page;
    this.el.dataset.page = page;
    this.confirmFor = null;
    this.frame.title.textContent = { root: 'Paused', save: 'Save Game', load: 'Load Game', controls: 'Controls', quit: 'Quit' }[page];
    pages[page].call(this, page);
    const i = focusId ? this.items.findIndex((it) => it.id === focusId) : -1;
    this._focus(i >= 0 ? i : this.items.findIndex((it) => !it.disabled));
  }

  _canSave() {
    return !this.combat && this.ctx.game.party.length > 0;
  }

  _where() {
    const g = this.ctx.game;
    const loc = g.location ?? {};
    let name = '';
    try {
      if (hasMap(loc.map)) name = getMap(loc.map).name ?? '';
    } catch {
      /* unnamed */
    }
    if (!name) name = String(loc.map ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const { day, hour, minute } = g.clock ?? {};
    const time = day ? `Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : '';
    return { name, time, lead: g.party[0]?.name ?? '' };
  }

  _root() {
    const w = this._where();
    const sl = this.ctx.saves.list().filter((s) => s.slot !== 'auto');
    const defs = [
      { id: 'resume', label: 'Resume', hint: h('span.por-keycap', ['Esc']), act: () => this.close() },
      { id: 'save', label: 'Save Game', hint: this.combat ? 'Not in battle' : `${sl.length} of ${SAVE_SLOTS.length - 1} slots used`, disabled: !this._canSave(), act: () => this.show('save') },
      { id: 'load', label: 'Load Game', hint: this.ctx.saves.list().length ? '' : 'No saves yet', act: () => this.show('load') },
      { id: 'settings', label: 'Settings', act: () => this._openSettings() },
      { id: 'controls', label: 'Controls', act: () => this.show('controls') },
      { id: 'quit', label: 'Quit to Main Menu', act: () => this.show('quit') },
    ];
    const list = h('div.por-menu.por-pause-list', { role: 'menu' });
    this.items = defs.map((d, i) => {
      const el = h(`button.por-menu-item.por-pause-item${d.id === 'quit' ? '.danger' : ''}`, {
        type: 'button', role: 'menuitem', disabled: !!d.disabled, dataset: { id: d.id },
        onmouseenter: () => !d.disabled && this._focus(i, false),
        onclick: () => this._activate(i),
      }, [h('span.por-pause-label', [d.label]), d.hint ? h('span.por-menu-hint', [d.hint]) : null]);
      if (d.id === 'quit') list.append(h('div.por-pause-sep'));
      list.append(el);
      return { ...d, el };
    });
    this.frame.body.replaceChildren(
      h('div.por-pause-head', [
        h('div.por-pause-crest', { 'aria-hidden': 'true' }, [hourglass()]),
        h('div.por-pause-where', [
          h('div.por-pause-place', [w.name]),
          h('div.por-pause-time', [[w.time, w.lead && `${w.lead} & company`].filter(Boolean).join(' · ')]),
          h('div.por-pause-state', [this.combat ? 'The battle holds its breath' : 'Time stands still']),
        ]),
      ]),
      h('div.por-rule'),
      list,
      this._legend([[['↑', '↓'], 'Choose'], [['Enter'], 'Select'], [['Esc'], 'Resume']]),
    );
  }

  _slots(mode) {
    const saving = mode === 'save';
    const recs = new Map(this.ctx.saves.list().map((s) => [s.slot, s]));
    const slots = saving ? SAVE_SLOTS.filter((s) => s !== 'auto') : SAVE_SLOTS;
    const list = h('div.por-load-list.por-pause-slots', { role: 'listbox' });
    this.items = slots.map((slot, i) => {
      const rec = recs.get(slot) ?? null;
      const [who, where, time] = String(rec?.summary ?? '').split(' — ');
      const disabled = !saving && !rec;
      const el = h(`button.por-load-row${rec ? '' : '.empty'}`, {
        type: 'button', role: 'option', disabled, dataset: { id: slot },
        onmouseenter: () => !disabled && this._focus(i, false),
        onclick: () => this._activate(i),
      }, [
        h('span.por-load-slot', [slot === 'auto' ? 'Auto' : slot]),
        rec
          ? h('span.por-load-info', [h('span.por-load-who', [who || 'Saved game']), h('span.por-load-where', [[where, time].filter(Boolean).join(' · ')])])
          : h('span.por-load-info', [h('span.por-load-who.muted', [saving ? '— empty: save here —' : '— empty —'])]),
        h('span.por-load-when', [fmtWhen(rec?.savedAt)]),
      ]);
      list.append(el);
      return { id: slot, el, disabled, act: () => (saving ? this._save(slot, !!rec) : this._load(slot)) };
    });
    const back = h('button.por-btn', { type: 'button', onclick: () => this.back() }, ['Back']);
    this.frame.body.replaceChildren(
      h('div.por-set-blurb', [saving
        ? 'Choose a page of the chronicle to write. The Auto slot is kept by the game itself.'
        : 'Choose a chronicle to resume. Progress since your last save will be lost.']),
      h('div.por-rule'),
      list,
      h('div.por-pause-confirm-slot'),
      h('div.por-load-actions', [this._legendInline([[['Enter'], saving ? 'Save' : 'Load'], [['Esc'], 'Back']]), h('span.spacer'), back]),
    );
  }

  _controls() {
    const input = this.ctx.input;
    const kb = (action) => (input.bindings[action] ?? []).filter((c) => !c.startsWith('pad:')).slice(0, 2).map(keyLabel);
    const explore = [
      ['forward', 'Step forward'], ['back', 'Step back'], ['turnLeft', 'Turn left'], ['turnRight', 'Turn right'],
      ['strafeLeft', 'Sidestep left'], ['strafeRight', 'Sidestep right'], ['turnAround', 'About face'],
      ['area', 'Area map'], ['cast', 'Cast'], ['view', 'View character'], ['encamp', 'Encamp'], ['search', 'Search'], ['look', 'Look'],
      ['prevMember', 'Previous member'], ['nextMember', 'Next member'],
    ].map(([a, label]) => [kb(a), label]);
    const iface = [
      [kb('confirm'), 'Confirm'], [['Esc'], 'Back · pause menu'], [kb('pause'), 'Pause menu'],
      [kb('quicksave'), 'Quick save (slot A)'], [kb('quickload'), 'Quick load (slot A)'], [kb('toggleClassic'), 'Classic 1988 mode'],
    ];
    const col = (title, rows, pad) => h('section.por-pause-col', [
      h('h3.por-pause-colhead', [title]),
      h('dl.por-pause-keys', rows.flatMap(([keys, label]) => [
        h('dt', keys.length ? keys.map((k) => (pad ? padGlyph(k) : h('span.por-keycap', [k]))) : [h('span.por-muted', ['—'])]),
        h('dd', [label]),
      ])),
    ]);
    const back = h('button.por-btn.primary', { type: 'button', onclick: () => this.back() }, ['Back']);
    this.items = [{ id: 'back', el: back, act: () => this.back() }];
    this.frame.body.replaceChildren(
      h('div.por-pause-cols', [
        col('Exploration', explore),
        col('Combat', COMBAT_KEYS),
        h('div.por-pause-stack', [col('Combat camera', CAMERA_KEYS), col('Interface', iface)]),
      ]),
      h('div.por-pause-padrow', [col('Gamepad', PAD_KEYS, true)]),
      h('div.por-load-actions', [h('span.por-muted.por-pause-note', ['Keys can be rebound under Settings · Controls.']), h('span.spacer'), back]),
    );
  }

  _quit() {
    this._confirmBody({
      text: 'Return to the main menu? Anything not written to the chronicle since your last save will be lost.',
      yes: 'Quit to Main Menu', no: 'Stay',
      onYes: () => this._quitToTitle(),
      onNo: () => this.show('root', 'quit'),
    });
  }

  /** In-page confirmation (replaces the frame body, or a slot list's confirm strip). */
  _confirmBody({ text, yes, no, onYes, onNo, into = null }) {
    const host = into ?? this.frame.body;
    const yesB = h('button.por-btn.primary', { type: 'button', dataset: { id: 'yes' }, onclick: () => onYes() }, [yes]);
    const noB = h('button.por-btn', { type: 'button', dataset: { id: 'no' }, onclick: () => onNo() }, [no]);
    const box = h('div.por-pause-confirm', [
      h('p.por-pause-ask', [text]),
      h('div.por-dialog-buttons', [noB, yesB]),
    ]);
    if (into) {
      host.replaceChildren(box);
      this.confirmFor = onNo;
    } else host.replaceChildren(box);
    this.items = [
      { id: 'no', el: noB, act: onNo },
      { id: 'yes', el: yesB, act: onYes },
    ];
    this._focus(0);
    yesB.addEventListener('mouseenter', () => this._focus(1, false));
    noB.addEventListener('mouseenter', () => this._focus(0, false));
  }

  _slotConfirm(slot, text, yes, onYes) {
    const strip = this.frame.body.querySelector('.por-pause-confirm-slot');
    for (const r of this.frame.body.querySelectorAll('.por-load-row')) {
      r.classList.toggle('picked', r.dataset.id === slot);
      r.disabled = true;
    }
    this._confirmBody({ text, yes, no: 'Cancel', onYes, onNo: () => this.show(this.page, slot), into: strip });
  }

  // ---------------------------------------------------------------- actions
  _save(slot, occupied) {
    const doSave = () => {
      const ok = this.ctx.saves.save(slot, this.ctx.game);
      this.ctx.ui.toast(ok ? `Saved to slot ${slot}` : 'The save could not be written', ok ? {} : { kind: 'warn' });
      if (!ok) this.ctx.audio?.sfx?.('error', { bus: 'ui' });
      this.show('root', 'resume');
    };
    if (occupied) this._slotConfirm(slot, `Slot ${slot} already holds a chronicle. Write over it?`, 'Overwrite', doSave);
    else doSave();
  }

  _load(slot) {
    this._slotConfirm(slot, `Load slot ${slot === 'auto' ? 'Auto' : slot}? Unsaved progress will be lost.`, 'Load', () => {
      const st = this.ctx.saves.load(slot);
      if (!st) {
        this.ctx.ui.toast('That save could not be read', { kind: 'warn' });
        this.show('load');
        return;
      }
      this.close(true);
      this.ctx.game.loadJSON(st);
      this.ctx.scenes.goto('explore', {});
    });
  }

  _quitToTitle() {
    this.close(true);
    this.ctx.scenes.goto('title', { view: 'menu' });
  }

  _openSettings() {
    const back = h('div.por-modal-backdrop.por-settings-backdrop.por-pause-sub');
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel', 'contextmenu', 'click']) back.addEventListener(t, (e) => e.stopPropagation());
    const panel = new SettingsPanel(this.ctx, {
      variant: 'modal',
      onClose: () => {
        panel.dispose();
        back.remove();
        this.sub = null;
        this.show('root', 'settings');
      },
    });
    back.append(panel.el);
    this.sub = panel;
    this.ctx.ui.layers.modal.append(back);
  }

  // ------------------------------------------------------------- navigation
  _focus(i, ring = true) {
    if (i < 0 || !this.items[i]) return;
    this.index = i;
    this.items.forEach((it, j) => {
      const on = j === i;
      it.el.classList.toggle('hl', on && it.el.classList.contains('por-menu-item'));
      it.el.classList.toggle('focus', on && it.el.classList.contains('por-load-row'));
      it.el.classList.toggle('kb-focus', on && ring && it.el.classList.contains('por-btn'));
    });
    const el = this.items[i].el;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }

  move(d) {
    const n = this.items.length;
    if (!n) return;
    let i = this.index;
    for (let k = 0; k < n; k++) {
      i = (((i + d) % n) + n) % n;
      if (!this.items[i].disabled) break;
    }
    if (i !== this.index) this.ctx.audio?.sfx?.('hover', { bus: 'ui' });
    this._focus(i);
  }

  _activate(i = this.index) {
    const it = this.items[i];
    if (!it) return;
    if (it.disabled) {
      this.ctx.audio?.sfx?.('error', { bus: 'ui' });
      return;
    }
    this.ctx.audio?.sfx?.('confirm', { bus: 'ui' });
    it.act();
  }

  back() {
    this.ctx.audio?.sfx?.('cancel', { bus: 'ui' });
    if (this.confirmFor) return this.confirmFor();
    if (this.page === 'root') return this.close();
    this.show('root', this.page);
  }

  _onKey(e) {
    if (this.sub || !this.backdrop.isConnected) return; // the Settings panel handles its own keys
    e.stopPropagation(); // nothing reaches the scene below
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': case 'Numpad8': case 'ArrowLeft': case 'Numpad4': this.move(-1); break;
      case 'ArrowDown': case 'KeyS': case 'Numpad2': case 'ArrowRight': case 'Numpad6': this.move(1); break;
      case 'Tab': this.move(e.shiftKey ? -1 : 1); break;
      case 'Enter': case 'NumpadEnter': case 'Space': this._activate(); break;
      case 'Escape': case 'Backspace': this.back(); break;
      case 'F10': this.close(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  /** Actions while open (InputManager capture). Keyboard is handled in _onKey; this serves the gamepad. */
  _onAction({ action, code }) {
    const pad = String(code ?? '').startsWith('pad:');
    if (this.sub) {
      if (pad) this.sub._onPad(action, code);
      return;
    }
    if (!pad) return;
    if (action === 'forward' || action === 'turnLeft') this.move(-1);
    else if (action === 'back' || action === 'turnRight') this.move(1);
    else if (action === 'confirm') this._activate();
    else if (action === 'cancel') this.back();
    else if (action === 'encamp' || action === 'pause') this.close();
  }

  _legend(entries) {
    return h('div.por-pause-legend', [this._legendInline(entries)]);
  }

  _legendInline(entries) {
    return h('span.por-pause-legend-in', entries.map(([keys, label]) => h('span.por-pause-legend-item', [...keys.map((k) => h('span.por-keycap', [k])), h('span', [label])])));
  }

  /** @param {boolean} [leaving] true when a scene change follows (no resume sound) */
  close(leaving = false) {
    if (current !== this) return;
    current = null;
    window.removeEventListener('keydown', this._onKey, true);
    if (this.sub) {
      this.sub.dispose?.();
      this.ctx.ui.layers.modal.querySelector('.por-pause-sub')?.remove();
      this.sub = null;
    }
    this.backdrop.remove();
    const { ctx } = this;
    ctx.clock.timeScale = this._prevScale ?? 1;
    if (this._pausedScenes) ctx.scenes.paused = false;
    ctx.input.capture = this._prevCapture ?? null;
    if (!leaving) {
      ctx.audio?.sfx?.('close', { bus: 'ui' });
      if (this._prevFocus?.isConnected) this._prevFocus.focus?.({ preventScroll: true });
      else document.activeElement?.blur?.();
    }
  }
}

/** A gilt hourglass medallion (drawn, not loaded). */
function hourglass() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64');
  s.classList.add('por-pause-hourglass');
  s.innerHTML = `<defs><linearGradient id="pmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c4"/><stop offset=".38" stop-color="#d8b25a"/><stop offset=".7" stop-color="#7d5e22"/><stop offset="1" stop-color="#e2c070"/></linearGradient>
    <radialGradient id="pmb" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#22397a"/><stop offset="1" stop-color="#070b1e"/></radialGradient>
    <linearGradient id="pms" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a6"/><stop offset="1" stop-color="#c8913a"/></linearGradient></defs>
    <circle cx="32" cy="32" r="30" fill="url(#pmb)" stroke="url(#pmg)" stroke-width="2.4"/>
    <circle cx="32" cy="32" r="25.5" fill="none" stroke="url(#pmg)" stroke-width=".9" stroke-dasharray="1.2 2.1"/>
    <g fill="url(#pmg)" stroke="#1a1004" stroke-width=".6">
      <rect x="19" y="13" width="26" height="4" rx="1.2"/><rect x="19" y="47" width="26" height="4" rx="1.2"/>
      <rect x="21" y="17" width="2.4" height="30"/><rect x="40.6" y="17" width="2.4" height="30"/>
    </g>
    <path d="M25 18 H39 C39 26 33.6 29 32.8 32 C33.6 35 39 38 39 46 H25 C25 38 30.4 35 31.2 32 C30.4 29 25 26 25 18 Z" fill="rgba(160,200,255,0.12)" stroke="rgba(230,240,255,0.55)" stroke-width=".8"/>
    <path d="M27.6 22 H36.4 C35.6 26 33 28.4 32 30.6 C31 28.4 28.4 26 27.6 22 Z" fill="url(#pms)"/>
    <path d="M32 31 V43" stroke="url(#pms)" stroke-width=".9"/>
    <path d="M26.4 45.6 C28 41.6 30.4 40.4 32 40.2 C33.6 40.4 36 41.6 37.6 45.6 Z" fill="url(#pms)"/>`;
  return s;
}
