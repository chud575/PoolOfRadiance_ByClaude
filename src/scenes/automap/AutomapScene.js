import './automap.css';
import { Scene } from '../../core/Scene.js';
import { h, clear, CommandBar } from '../../ui/UI.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { SHEET, buildBlockSheet, eventMarker, MARKER_LABELS } from './BlockSheet.js';
import { WORLD, LAYOUT, buildWorldSheet } from './WorldSheet.js';
import { inPoly } from './worldcity.js';
import { SheetView } from './SheetView.js';
import { drawPartyArrow, partyConeCanvas, drawPin, drawMarker, PIN_KINDS, PIN_ORDER, glyphDataURL } from './glyphs.js';
import { SERIF, wrapText, haloText } from './ornaments.js';
import { INK, makeParchment } from './ink.js';
import { foundSecrets, notesFor, setNote, removeNote, exploredStats, applyDemoExploration } from './state.js';

let locatorPaper = null;
const DIR_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' };
const DIR_ANGLE = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };
const CELL_NAMES = { [CELL.STREET]: 'Street', [CELL.INTERIOR]: 'Indoors', [CELL.RUBBLE]: 'Rubble', [CELL.WATER]: 'Water', [CELL.COURTYARD]: 'Flagstones' };
const EDGE_WORDS = { [EDGE.DOOR]: 'door', [EDGE.LOCKED]: 'locked door', [EDGE.ARCH]: 'archway', [EDGE.SECRET]: 'secret door' };

/**
 * AREA view — the cartographer's automap.
 *  - Block view: ink-on-parchment survey of a 16x16 block with fog of war, walls,
 *    doors, secret doors (once found), markers, zone names, exits, party arrow,
 *    player notes (wax-seal pins), zoom & pan, cartouche, compass rose and key.
 *  - Diorama: the same sheet laid on the desk in 3D with the explored walls raised
 *    as a tabletop miniature (toggle with T).
 *  - World view: an overview of Phlan's blocks (O), each drawn as its own
 *    miniature survey; click a block you have explored to open its map.
 *
 * params: {map?, x?, y?, dir?, overlay?, reveal?: '0'|'1', view?: 'world'|'block',
 *          mode?: 'diorama'|'parchment', zoom?: number, explored?: 'demo'}
 */
export default class AutomapScene extends Scene {
  async enter(params = {}) {
    const { game, debug } = this.ctx;
    this.overlay = !!params.overlay;
    this.transparent = false;
    if (Number.isFinite(params.x)) game.location.x = params.x;
    if (Number.isFinite(params.y)) game.location.y = params.y;
    if (params.dir && DIRS.includes(params.dir)) game.location.dir = params.dir;
    if (params.map && hasMap(params.map) && debug.active) game.location.map = params.map;
    this.homeId = hasMap(params.map ?? '') ? params.map : game.location.map;
    const demo = debug.active && params.explored === 'demo';
    if (demo) applyDemoExploration(game, this.homeId);
    // fog of war: real explored state unless reveal=1 is asked for. A debug automap
    // opened directly (no explored= history) shows everything; one pushed from
    // explore always uses what the party has actually seen (honouring explore's reveal=).
    const rv = params.reveal ?? (this.overlay ? debug.raw?.reveal : undefined);
    this.reveal = rv !== undefined ? rv === '1' : debug.active && !demo && !this.overlay;
    if (hasMap(game.location.map)) {
      const m = getMap(game.location.map);
      if (m.inBounds(game.location.x, game.location.y)) game.markExplored(m.id, game.location.x, game.location.y, m.w);
    }
    this.post = { vignette: 0.3, bloom: false, grain: 0.015 };
    this.view = params.view === 'world' ? 'world' : 'block';
    this.mode = params.mode === 'diorama' ? 'diorama' : 'parchment';
    this.sheets = new Map();
    this.hover = null;
    this.flash = null;
    this.editor = null;

    this._buildDom();
    if (this.overlay) {
      // pushed over explore: hide the scene below's HUD (title, compass, log) so it
      // never bleeds over the map or the diorama; restored on exit
      const hidden = [];
      for (const layer of [this.ctx.ui.layers.scene, this.ctx.ui.layers.hud]) {
        for (const el of layer.children) {
          if (el === this.root || el === this.bottom) continue;
          hidden.push([el, el.style.visibility]);
          el.style.visibility = 'hidden';
        }
      }
      this.own(() => { for (const [el, v] of hidden) el.style.visibility = v; });
    }
    const wantWorld = this.view === 'world';
    this._openBlock(this.homeId, { rebuild: true });
    if (wantWorld) this._openWorld();
    this._layout();
    const z = Number(params.zoom);
    if (Number.isFinite(z) && z > 1) {
      if (this.view === 'block') this._centreOnParty(z, true);
      else this.sv.focus(Number(params.fx) || this.sv.tcx, Number(params.fy) || this.sv.tcy, z, true);
    }
    if (this.mode === 'diorama') await this._enterDiorama(Number.isFinite(z) ? z : 1);
    // squares surveyed since the map was last opened ink themselves in
    this.fresh = this._freshCells();
    this.openedAt = this.ctx.clock.time;
    // the sheet settles onto the desk (skipped when the clock is frozen)
    if (!this.ctx.clock.frozen) {
      this.sv.zoom *= 0.94;
      this.sv.cy += 28;
    }
    this._refreshUi();
    this._draw();

    this.listen('input:action', (e) => this._onAction(e));
    const onResize = () => { this._layout(); this._draw(); };
    window.addEventListener('resize', onResize);
    this.own(() => window.removeEventListener('resize', onResize));
  }

  // ------------------------------------------------------------------ DOM
  _buildDom() {
    const ui = this.ctx.ui;
    this.canvas = h('canvas.am-canvas');
    this.sv = new SheetView(this.canvas);
    this.tip = h('div.por-tooltip.am-tip');
    this.side = h('aside.am-side');
    this.editorEl = h('div.am-editor');
    this.root = h('div.am-root', [this.canvas, this.side, this.tip, this.editorEl]);
    ui.mount(this.root);
    this.bar = new CommandBar([], { title: 'Area' });
    this.bottom = h('div.por-hud-bottom.am-bottom', [this.bar.el]);
    ui.mount(this.bottom);
    this.own(() => { this.bar.dispose(); this.root.remove(); this.bottom.remove(); });

    let drag = null;
    const pos = (e) => {
      const r = this.root.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.canvas && e.target !== this.root && !e.target.classList?.contains('am-hit')) return;
      const [x, y] = pos(e);
      drag = { x, y, sx: x, sy: y, button: e.button, moved: false, id: e.pointerId };
      this.root.setPointerCapture?.(e.pointerId);
      this.root.classList.add('dragging');
    });
    this.root.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (drag) {
        const dx = x - drag.x;
        const dy = y - drag.y;
        if (Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.moved = true;
        drag.x = x;
        drag.y = y;
        if (drag.moved) {
          if (this.mode === 'diorama' && this.dio) this.dio.orbitBy(dx, dy, drag.button === 2 || e.shiftKey);
          else this.sv.panBy(dx, dy, true);
          this._hideTip();
          this._draw();
        }
        return;
      }
      this._hoverAt(x, y);
    });
    const end = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this.root.classList.remove('dragging');
      if (!d.moved) this._clickAt(d.sx, d.sy, d.button);
      e && this.root.releasePointerCapture?.(d.id);
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', () => { drag = null; this.root.classList.remove('dragging'); });
    this.root.addEventListener('pointerleave', () => { if (!drag) { this.hover = null; this._hideTip(); this._draw(); } });
    this.root.addEventListener('wheel', (e) => {
      if (e.target.closest?.('.am-side, .am-editor')) return;
      e.preventDefault();
      const [x, y] = pos(e);
      const f = Math.exp(-e.deltaY * 0.0015);
      if (this.mode === 'diorama' && this.dio) this.dio.dolly(1 / f);
      else this.sv.zoomAt(f, x, y);
    }, { passive: false });
    this.root.addEventListener('dblclick', (e) => {
      if (this.mode === 'diorama' || e.target !== this.canvas) return;
      const [x, y] = pos(e);
      this.sv.zoomAt(1.8, x, y);
    });
  }

  _layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sr = this.side.getBoundingClientRect();
    const barH = this.bottom.getBoundingClientRect().height || 44;
    const pad = Math.max(12, Math.min(W, H) * 0.022);
    const right = sr.width > 0 ? sr.left - pad : W - pad;
    const rect = { x: pad, y: pad, w: Math.max(100, right - pad), h: Math.max(100, H - barH - pad * 2) };
    this.viewRect = rect;
    this.sv.layout(W, H, rect, Math.min(window.devicePixelRatio || 1, 2));
    this.dio?.resize(W, H, rect);
  }

  // ------------------------------------------------------------------ views
  _sheetFor(id, rebuild = false) {
    if (!rebuild && this.sheets.has(id)) return this.sheets.get(id);
    const { game } = this.ctx;
    const map = getMap(id);
    const reveal = this.reveal;
    // k=3: the ink stays crisp at 2.6x and beyond, and the diorama shares this sheet
    const sheet = buildBlockSheet(map, {
      k: 3,
      seen: (x, y) => reveal || game.isExplored(id, x, y, map.w),
      secrets: foundSecrets(game, id),
      spent: game.spentEvents,
      party: id === game.location.map ? { x: game.location.x, y: game.location.y } : null,
    });
    this.sheets.set(id, sheet);
    return sheet;
  }

  _openBlock(id, { rebuild = false } = {}) {
    this.view = 'block';
    this.map = getMap(id);
    this.sheet = this._sheetFor(id, rebuild);
    this.sv.minZoom = 1;
    this.sv.maxZoom = 4.5;
    this.sv.setSheet(this.sheet, SHEET);
    this.hover = null;
    this._closeEditor();
    if (this.dio) this._rebuildDiorama(this.dio.zoomLevel);
  }

  _openWorld() {
    const { game } = this.ctx;
    if (this.mode === 'diorama') this._setMode('parchment');
    this.view = 'world';
    if (!this.world) {
      this.world = buildWorldSheet({
        k: 2,
        // New Phlan, the Company's base, is charted from the start (the council's own plan)
        seenFn: (m) => (m.id === 'phlan_civilized' ? () => true : (x, y) => this.reveal || game.isExplored(m.id, x, y, m.w)),
        secretsFn: (id) => foundSecrets(game, id),
        spent: game.spentEvents,
        known: (id) => this.reveal || id === 'phlan_civilized' || id === game.location.map || exploredStats(game, getMap(id)).seen > 0,
        here: game.location.map,
      });
    }
    this.sv.minZoom = 1;
    this.sv.maxZoom = 3.5;
    this.sv.setSheet(this.world, WORLD);
    this.hover = null;
    this._closeEditor();
  }

  /** Cells explored since the last time this map was viewed (then remember the current state). */
  _freshCells() {
    const { game } = this.ctx;
    const m = getMap(game.location.map);
    const last = ((game.flags.automapViewed ??= {})[m.id] ??= []);
    const out = [];
    const now = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      const seen = game.isExplored(m.id, x, y, m.w);
      if (seen) now[i >> 5] = (now[i >> 5] ?? 0) | (1 << (i & 31));
      const was = ((last[i >> 5] ?? 0) & (1 << (i & 31))) !== 0;
      if (seen && !was) out.push({ x, y, d: Math.hypot(x - game.location.x, y - game.location.y) });
    }
    game.flags.automapViewed[m.id] = now;
    // the very first look at a block shows it as it is
    return last.length && !this.reveal ? out : [];
  }

  get isHome() {
    return this.view === 'block' && this.map.id === this.ctx.game.location.map;
  }

  _cellAtScreen(sx, sy) {
    const [ux, uy] = this.sv.screenToUnits(sx, sy);
    const cs = SHEET.MS / this.map.w;
    const x = Math.floor((ux - SHEET.MX) / cs);
    const y = Math.floor((uy - SHEET.MY) / cs);
    return this.map.inBounds(x, y) ? { x, y } : null;
  }

  _blockAtScreen(sx, sy) {
    const [ux, uy] = this.sv.screenToUnits(sx, sy);
    return this.world.blocks.find((b) => (b.round ? Math.hypot(ux - b.cx, uy - b.cy) <= b.r : b.poly ? inPoly(b.poly, ux, uy) : ux >= b.x && uy >= b.y && ux <= b.x + b.s && uy <= b.y + b.s)) ?? null;
  }

  _centreOnParty(zoom = this.sv.tZoom, immediate = false) {
    if (!this.isHome) {
      this.sv.focus(SHEET.MX + SHEET.MS / 2, SHEET.MY + SHEET.MS / 2, zoom, immediate);
      return;
    }
    const { x, y } = this.ctx.game.location;
    const cs = SHEET.MS / this.map.w;
    this.sv.focus(SHEET.MX + (x + 0.5) * cs, SHEET.MY + (y + 0.5) * cs, zoom, immediate);
  }

  // ------------------------------------------------------------------ diorama
  async _enterDiorama(zoom = 1) {
    if (this.view !== 'block') this._openBlock(this.ctx.game.location.map);
    this.mode = 'diorama';
    if (!this.dio) {
      const { Diorama } = await import('./Diorama.js');
      this.dio = new Diorama(this.ctx);
      this.own(() => this.dio?.dispose());
    }
    await this.dio.prepare();
    this._rebuildDiorama(zoom);
    this.root.classList.add('is-3d');
  }

  _rebuildDiorama(zoom = 1) {
    if (!this.dio) return;
    const { game } = this.ctx;
    const id = this.map.id;
    const reveal = this.reveal;
    // the tabletop view lays the same (k=3) sheet on the desk
    const fine = { sheet: this.sheet };
    this.dio.build(this.map, fine.sheet, {
      seen: (x, y) => reveal || game.isExplored(id, x, y, this.map.w),
      secrets: foundSecrets(game, id),
      party: this.isHome ? { ...game.location } : null,
      notes: notesFor(game, id),
      spent: game.spentEvents,
      zoom,
    });
    this.dio.resize(window.innerWidth, window.innerHeight, this.viewRect);
  }

  _setMode(mode) {
    if (mode === this.mode) return;
    this._resetHover();
    if (mode === 'diorama') {
      this._enterDiorama().then(() => { this._refreshUi(); this._draw(); });
      return;
    }
    this.mode = 'parchment';
    this.root.classList.remove('is-3d');
    this._refreshUi();
    this._draw();
  }

  // ------------------------------------------------------------------ input
  _onAction({ action, code }) {
    if (this.ctx.scenes.current !== this) return;
    if (this.editor) {
      if (action === 'cancel') this._closeEditor();
      return;
    }
    switch (action) {
      case 'area':
      case 'cancel':
        if (this.view === 'world' && action === 'cancel' && hasMap(this.homeId)) this._toBlock(this.ctx.game.location.map);
        else this.close();
        return;
      case 'strafeRight': return this._zoom(1.35);
      case 'strafeLeft': return this._zoom(1 / 1.35);
      case 'confirm': return this.view === 'block' ? this._centreOnParty() : undefined;
      default:
    }
    if (code === 'pad:3') this._setMode(this.mode === 'diorama' ? 'parchment' : 'diorama');
    else if (code === 'pad:2') this.view === 'world' ? this._toBlock(this.ctx.game.location.map) : this._toWorld();
    else if (code === 'pad:9' && this.view === 'block') this._pinAt(this.hover ?? (this.isHome ? { ...this.ctx.game.location } : { x: 7, y: 7 }));
  }

  /** Keyboard / bar zoom: about the hovered square, else the party, else the sheet centre. */
  _zoom(f) {
    if (this.mode === 'diorama' && this.dio) { this.dio.dolly(1 / f); return; }
    if (this.view === 'block') {
      const c = this.hover ?? (this.isHome ? this.ctx.game.location : null);
      if (c) {
        const cs = SHEET.MS / this.map.w;
        const [sx, sy] = this.sv.unitsToScreen(SHEET.MX + (c.x + 0.5) * cs, SHEET.MY + (c.y + 0.5) * cs);
        const r = this.viewRect;
        if (sx >= r.x && sy >= r.y && sx <= r.x + r.w && sy <= r.y + r.h) {
          // pull the anchor gently toward the middle so it stays in view as the sheet grows
          const ax = sx + (r.x + r.w / 2 - sx) * (f > 1 ? 0.35 : 0);
          const ay = sy + (r.y + r.h / 2 - sy) * (f > 1 ? 0.35 : 0);
          this.sv.zoomAt(f, sx, sy);
          if (f > 1) this.sv.panBy(ax - sx, ay - sy);
          return;
        }
      }
    }
    this.sv.zoomCenter(f);
  }

  _resetHover() {
    this.hover = null;
    this.dio?.setHover(null);
    this._hideTip();
    this.root.style.cursor = '';
  }

  _toWorld() {
    this._resetHover();
    this._openWorld();
    this._refreshUi();
    this._draw();
  }

  _toBlock(id) {
    this._resetHover();
    this._openBlock(id);
    this._refreshUi();
    this._draw();
  }

  _clickAt(sx, sy, button) {
    if (this.mode === 'diorama') {
      const c = this.dio?.cellAt(sx, sy);
      if (!c || this.view !== 'block') return;
      const n = notesFor(this.ctx.game, this.map.id).find((q) => q.x === c.x && q.y === c.y);
      if (button === 2 || n) this._pinAt(c, sx, sy);
      return;
    }
    if (this.view === 'world') {
      const b = this._blockAtScreen(sx, sy);
      if (b && b.known) this._toBlock(b.id);
      return;
    }
    const c = this._cellAtScreen(sx, sy);
    if (!c) return;
    if (button === 2) this._pinAt(c, sx, sy);
    else {
      const n = notesFor(this.ctx.game, this.map.id).find((q) => q.x === c.x && q.y === c.y);
      if (n) this._pinAt(c, sx, sy);
    }
  }

  _hoverAt(sx, sy) {
    if (this.mode === 'diorama') {
      const c = this.dio?.cellAt(sx, sy) ?? null;
      if (c?.x !== this.hover?.x || c?.y !== this.hover?.y) {
        this.hover = c;
        this.dio?.setHover(c);
      }
      if (c) this._showTip(sx, sy, this._cellTip(c)); else this._hideTip();
      return;
    }
    if (this.view === 'world') {
      const b = this._blockAtScreen(sx, sy);
      const key = b?.id ?? null;
      if (key !== this.hover?.id) {
        this.hover = b ? { id: b.id } : null;
        this._draw();
      }
      if (b) this._showTip(sx, sy, this._blockTip(b)); else this._hideTip();
      this.root.style.cursor = b?.known ? 'pointer' : '';
      return;
    }
    const c = this._cellAtScreen(sx, sy);
    if (c?.x !== this.hover?.x || c?.y !== this.hover?.y) {
      this.hover = c;
      this._draw();
    }
    if (c) this._showTip(sx, sy, this._cellTip(c)); else this._hideTip();
  }

  _showTip(sx, sy, { title, lines }) {
    const t = this.tip;
    t.replaceChildren(h('span.tt-title', [title]), ...lines.map((l) => h('div', [l])));
    t.classList.add('show');
    const w = t.offsetWidth;
    const hh = t.offsetHeight;
    const r = this.root.getBoundingClientRect();
    const px = Math.min(sx + r.left + 18, window.innerWidth - w - 8);
    // on the overview the block names hang below each district: the tip rises above the cursor
    const above = this.view === 'world' ? sy + r.top - hh - 18 >= 8 : sy + r.top + 22 + hh > window.innerHeight - 50;
    const py = above ? sy + r.top - hh - 18 : sy + r.top + 22;
    t.style.transform = `translate(${Math.max(8, px)}px, ${Math.max(8, py)}px)`;
  }

  _hideTip() {
    this.tip.classList.remove('show');
  }

  _seen(x, y) {
    return this.reveal || this.ctx.game.isExplored(this.map.id, x, y, this.map.w);
  }

  _cellTip({ x, y }) {
    const m = this.map;
    const { game } = this.ctx;
    const lines = [];
    const note = notesFor(game, m.id).find((n) => n.x === x && n.y === y);
    const here = this.isHome && game.location.x === x && game.location.y === y;
    if (!this._seen(x, y)) {
      lines.push('Unexplored.');
      if (note) lines.push(`${PIN_KINDS[note.kind]?.label ?? 'Note'}: ${note.text || '(no text)'}`);
      lines.push('Right-click to pin a note.');
      return { title: `${x}, ${y}`, lines };
    }
    const zone = m.zoneAt(x, y);
    if (here) lines.push(`You are here, facing ${DIR_NAMES[game.location.dir].toLowerCase()}.`);
    lines.push(CELL_NAMES[m.getCell(x, y)] ?? 'Ground');
    const secrets = foundSecrets(game, m.id);
    const exits = [];
    for (const d of DIRS) {
      let e = m.getEdge(x, y, d);
      if (e === EDGE.SECRET && !secrets.has(`${x},${y},${d}`)) {
        const [dx, dy] = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[d];
        const opp = { N: 'S', E: 'W', S: 'N', W: 'E' }[d];
        if (!secrets.has(`${x + dx},${y + dy},${opp}`)) e = EDGE.WALL;
      }
      if (EDGE_WORDS[e]) exits.push(`${EDGE_WORDS[e]} to the ${DIR_NAMES[d].toLowerCase()}`);
    }
    if (exits.length) lines.push(exits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.');
    for (const ev of m.eventsAt(x, y)) {
      const mk = eventMarker(ev, !!game.spentEvents[ev.id]);
      if (mk) lines.push(MARKER_LABELS[mk] + (ev.type === 'sign' && ev.text ? `: ${ev.text.replace(/^[^"]*"?|"[^"]*$/g, '') || ev.text}` : ''));
    }
    for (const t of this.sheet.info.travel) if (t.at.x === x && t.at.y === y) lines.push(`${t.title}: to ${t.destName} (face ${DIR_NAMES[t.at.facing].toLowerCase()}).`);
    if (note) lines.push(`${PIN_KINDS[note.kind]?.label ?? 'Note'}: ${note.text || '(no text)'}`);
    return { title: `${zone} · ${x}, ${y}`, lines };
  }

  _blockTip(b) {
    const { game } = this.ctx;
    if (!b.known) return { title: 'Unexplored', lines: [b.rumour ?? 'You have not set foot here.'] };
    const st = exploredStats(game, getMap(b.id), this.reveal);
    const lines = [`${Math.round(st.frac * 100)}% surveyed.`];
    if (b.id === game.location.map) lines.unshift('The party is here.');
    lines.push('Click to open this map.');
    return { title: getMap(b.id).name, lines };
  }

  // ------------------------------------------------------------------ notes
  _pinAt(c, sx, sy) {
    const { game } = this.ctx;
    const existing = notesFor(game, this.map.id).find((n) => n.x === c.x && n.y === c.y);
    const note = existing ? { ...existing } : { x: c.x, y: c.y, kind: 'note', text: '' };
    if (sx === undefined) {
      const cs = SHEET.MS / this.map.w;
      [sx, sy] = this.sv.unitsToScreen(SHEET.MX + (c.x + 1) * cs, SHEET.MY + c.y * cs);
    }
    this._hideTip();
    const el = this.editorEl;
    clear(el);
    const input = h('input.am-input', { type: 'text', maxLength: 80, placeholder: 'Write a note…', value: note.text });
    const kinds = h('div.am-kinds', PIN_ORDER.map((k) => h('button.am-kind', {
      type: 'button',
      class: k === note.kind ? 'on' : '',
      dataset: { tip: PIN_KINDS[k].label },
      onclick: () => { note.kind = k; for (const b of kinds.children) b.classList.toggle('on', b.dataset.kind === k); input.focus(); },
    }, [h('img', { src: glyphDataURL(`pin-${k}`, (g, x, y, s) => drawPin(g, x, y, s, k)), alt: PIN_KINDS[k].label })])));
    [...kinds.children].forEach((b, i) => { b.dataset.kind = PIN_ORDER[i]; });
    const save = () => {
      note.text = input.value.trim();
      setNote(game, this.map.id, note);
      this.flash = { x: note.x, y: note.y, t: this.ctx.clock.time };
      this._closeEditor();
      this._refreshUi();
      if (this.dio) this._rebuildDiorama(this.dio.zoomLevel);
      this._draw();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); this._closeEditor(); }
      e.stopPropagation();
    });
    el.append(
      h('div.am-editor-title', [`Note at ${c.x}, ${c.y}`]),
      kinds,
      input,
      h('div.am-editor-row', [
        existing ? h('button.por-btn.am-del', { type: 'button', onclick: () => { removeNote(game, this.map.id, c.x, c.y); this._closeEditor(); this._refreshUi(); if (this.dio) this._rebuildDiorama(this.dio.zoomLevel); this._draw(); } }, ['Remove']) : null,
        h('button.por-btn', { type: 'button', onclick: () => this._closeEditor() }, ['Cancel']),
        h('button.por-btn.primary', { type: 'button', onclick: save }, ['Pin']),
      ]),
    );
    el.classList.add('open');
    const r = this.root.getBoundingClientRect();
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(sx + 16, r.width - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(sy - hh / 2, r.height - hh - 60))}px`;
    this.editor = { note };
    this.ctx.input.enabled = false;
    setTimeout(() => input.focus(), 0);
  }

  _closeEditor() {
    if (!this.editor) return;
    this.editor = null;
    this.editorEl.classList.remove('open');
    clear(this.editorEl);
    this.ctx.input.enabled = true;
  }

  // ------------------------------------------------------------------ sidebar / bar
  _refreshUi() {
    const { game } = this.ctx;
    const world = this.view === 'world';
    const dio = this.mode === 'diorama';
    const zoomCmds = [
      { id: 'zout', label: 'Zoom −', key: this.ctx.input.label('strafeLeft'), action: 'strafeLeft', tip: 'Zoom out (mouse wheel)', onSelect: () => this._zoom(1 / 1.35) },
      { id: 'zin', label: 'Zoom +', key: this.ctx.input.label('strafeRight'), action: 'strafeRight', tip: 'Zoom in (mouse wheel)', onSelect: () => this._zoom(1.35) },
    ];
    const cmds = world
      ? [
        { id: 'block', label: 'Block', key: 'B', tip: 'Back to the map of this block', onSelect: () => this._toBlock(game.location.map) },
        ...zoomCmds,
        { id: 'exit', label: 'Exit', key: 'X', tip: 'Return to the game', onSelect: () => this.close() },
      ]
      : [
        { id: 'centre', label: 'Centre', key: 'C', tip: 'Centre on the party (Enter)', onSelect: () => (dio ? this.dio?.focusParty() : this._centreOnParty()) },
        { id: 'pin', label: 'Pin', key: 'P', tip: 'Pin a note on the hovered square (or right-click the map)', onSelect: () => this._pinAt(this.hover ?? (this.isHome ? { ...game.location } : { x: 7, y: 7 })) },
        { id: 'tilt', label: dio ? 'Flat' : 'Tilt', key: dio ? 'F' : 'T', tip: dio ? 'Back to the parchment' : 'Tabletop diorama of the explored block', onSelect: () => this._setMode(dio ? 'parchment' : 'diorama') },
        { id: 'overview', label: 'Overview', key: 'O', tip: 'Overview map of Phlan', onSelect: () => this._toWorld() },
        ...zoomCmds,
        { id: 'exit', label: 'Exit', key: 'X', tip: 'Return to the game (M / Esc)', onSelect: () => this.close() },
      ];
    this.bar.set(cmds);
    clear(this.side);
    if (world) this._sideWorld(); else this._sideBlock();
  }

  _sideBlock() {
    const { game } = this.ctx;
    const m = this.map;
    const st = exploredStats(game, m, this.reveal);
    const secrets = foundSecrets(game, m.id).size;
    const loc = game.location;
    const { day, hour, minute } = game.clock;
    const here = this.isHome;
    const notes = notesFor(game, m.id);
    const pct = Math.round(st.frac * 100);
    this.side.append(
      h('div.am-side-head', [
        h('div.am-kicker', [here ? 'You are in' : 'Surveyed map of']),
        h('div.am-title', [m.name]),
        h('div.am-sub', [here ? (m.zoneAt(loc.x, loc.y) !== m.name ? m.zoneAt(loc.x, loc.y) : 'Phlan, upon the Moonsea') : 'Not your current block']),
      ]),
      h('div.am-stats', [
        here ? h('div.am-stat', [h('span', ['Position']), h('b', [`${loc.x}, ${loc.y} · ${DIR_NAMES[loc.dir]}`])]) : null,
        h('div.am-stat', [h('span', ['Time']), h('b', [`Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`])]),
        h('div.am-stat', [h('span', ['Surveyed']), h('b', [`${pct}%`])]),
        h('div.am-bar', { dataset: { tip: `${st.seen} of ${st.total} squares explored` } }, [h('i', { style: { width: `${pct}%` } })]),
        h('div.am-stat', [h('span', ['Secret doors found']), h('b', [String(secrets)])]),
      ]),
      h('div.am-sec', ['Notes']),
      notes.length
        ? h('ul.am-notes', notes.map((n) => h('li.am-note', {
          onclick: () => { this.flash = { x: n.x, y: n.y, t: this.ctx.clock.time }; const cs = SHEET.MS / m.w; this.sv.focus(SHEET.MX + (n.x + 0.5) * cs, SHEET.MY + (n.y + 0.5) * cs, Math.max(this.sv.tZoom, 2)); },
          dataset: { tip: 'Show on the map · right-click the pin on the map to edit' },
        }, [
          h('img', { src: glyphDataURL(`pinL-${n.kind}`, (g, x, y, s) => drawPin(g, x, y, s * 1.65, n.kind)), alt: '' }),
          h('span.am-note-text', [n.text || PIN_KINDS[n.kind]?.label || 'Note']),
          h('span.am-note-xy', [`${n.x},${n.y}`]),
        ])))
        : h('div.am-empty', ['Right-click any square to pin a note: danger, treasure, a quest lead.']),
      ...this._chartedSection(),
      ...(notes.length ? [] : [h('div.am-sec', ['Pins']), h('div.am-pinkey', PIN_ORDER.map((k) => h('div.am-pinkey-row', { dataset: { tip: 'Right-click a square, then choose the seal' } }, [
        h('img', { src: glyphDataURL(`pinL-${k}`, (g, x, y, sz) => drawPin(g, x, y, sz * 1.65, k)), alt: '' }),
        h('span', [PIN_KINDS[k].label]),
      ])))]),
      h('div.am-hint', ['Drag to pan · wheel to zoom · right-click to pin']),
    );
  }

  /** What the survey has charted on this block: inscriptions, battles, exits, secrets. */
  _chartedSection() {
    const { game } = this.ctx;
    const m = this.map;
    const items = [];
    const seen = (x, y) => this._seen(x, y);
    for (const ev of m.events) {
      if (!seen(ev.x, ev.y)) continue;
      const kind = eventMarker(ev, !!game.spentEvents[ev.id]);
      if (!kind || kind === 'text') continue;
      items.push({ kind, x: ev.x, y: ev.y, text: MARKER_LABELS[kind], where: m.zoneAt(ev.x, ev.y) });
    }
    for (const t of this.sheet.info.travel) {
      if (!seen(t.at.x, t.at.y)) continue;
      items.push({ kind: t.edge ? 'exit' : (t.art === 'docks' || t.art === 'keep' ? 'boat' : 'stairs'), x: t.at.x, y: t.at.y, text: `To ${t.destName}`, where: m.zoneAt(t.at.x, t.at.y), angle: t.edge ? DIR_ANGLE[t.at.facing] : 0 });
    }
    for (const key of foundSecrets(game, m.id)) {
      const [x, y] = key.split(',').map(Number);
      items.push({ kind: 'secret', x, y, text: 'Secret door', where: m.zoneAt(x, y) });
    }
    if (!items.length) return [];
    const shown = items.slice(0, 3);
    const cs = SHEET.MS / m.w;
    const icon = (it) => glyphDataURL(`mk-${it.kind}-${it.angle ?? 0}`, (g, x, y, s) => {
      if (it.kind === 'secret') {
        g.font = `italic bold ${Math.round(s * 0.9)}px ${SERIF}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#e0573c';
        g.fillText('S', x, y);
      } else drawMarker(g, it.kind, x, y, s * 1.1, { color: '#e9d9b4', accent: '#e0573c', angle: it.angle ?? 0, seed: 3 });
    });
    return [
      h('div.am-sec', ['Charted']),
      h('ul.am-notes.am-charted', [
        ...shown.map((it) => h('li.am-note', {
          onclick: () => { this.flash = { x: it.x, y: it.y, t: this.ctx.clock.time }; this.sv.focus(SHEET.MX + (it.x + 0.5) * cs, SHEET.MY + (it.y + 0.5) * cs, Math.max(this.sv.tZoom, 2)); },
          dataset: { tip: 'Show on the map' },
        }, [
          h('img', { src: icon(it), alt: '' }),
          h('span.am-note-text', { title: `${it.text} · ${it.where}` }, [it.text, h('i.am-where', [` · ${it.where}`])]),
          h('span.am-note-xy', [`${it.x},${it.y}`]),
        ])),
        items.length > shown.length ? h('div.am-empty', [`and ${items.length - shown.length} more on the sheet.`]) : null,
      ]),
    ];
  }

  /** A gilt thumbnail of Phlan's blocks: where this block lies; click for the overview. */
  _locator() {
    const { game } = this.ctx;
    const c = h('canvas.am-locator', { dataset: { tip: 'Overview of Phlan (O)' }, onclick: () => this._toWorld() });
    const W = 300;
    const H = 150;
    const dpr = 2;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const sx = (x) => 6 + ((x - 150) / 1080) * (W - 12);
    const sy = (y) => 6 + ((y - 90) / 860) * (H - 12);
    const k = (W - 12) / 1080;
    // the paper: a scrap of the same parchment as the overview
    locatorPaper ??= makeParchment(W * 2, H * 2, { seed: 1341, tone: [236, 220, 180], age: 0.9, ring: null });
    g.drawImage(locatorPaper, 0, 0, W, H);
    // the Moonsea: a blue wash with the engraver's swell lines
    const coast = (x) => sy(800) + Math.sin(x / 23) * 1.6;
    g.save();
    g.beginPath();
    g.moveTo(0, coast(0));
    for (let x = 0; x <= W; x += 6) g.lineTo(x, coast(x));
    g.lineTo(W, H); g.lineTo(0, H); g.closePath();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(96,136,168,0.55)';
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(43,26,13,0.85)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 6) (x ? g.lineTo(x, coast(x)) : g.moveTo(x, coast(x)));
    g.stroke();
    g.strokeStyle = 'rgba(30,60,100,0.45)';
    g.lineWidth = 0.6;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      for (let x = 4 + i * 7; x < W - 4; x += 14) { g.moveTo(x, coast(x) + i * 5); g.quadraticCurveTo(x + 3.5, coast(x) + i * 5 - 1.6, x + 7, coast(x) + i * 5); }
      g.stroke();
    }
    g.restore();
    // the river, meandering down to the sea
    g.save();
    g.strokeStyle = 'rgba(80,124,160,0.75)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    for (let y = 0; y <= sy(800); y += 3) {
      const x = sx(965 + Math.sin(y / 9) * 14);
      if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = 'rgba(43,26,13,0.55)';
    g.lineWidth = 0.6;
    g.stroke();
    g.restore();
    // the old wall: an inked rule with round towers
    g.save();
    g.strokeStyle = 'rgba(74,50,32,0.85)';
    g.lineWidth = 1.4;
    const wx0 = sx(150); const wy0 = sy(52); const wx1 = sx(905); const wy1 = sy(780);
    g.strokeRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    g.fillStyle = '#e2cfa2';
    g.lineWidth = 0.8;
    for (const [tx, ty] of [[wx0, wy0], [wx1, wy0], [wx0, wy1], [wx1, wy1], [(wx0 + wx1) / 2, wy0], [wx0, (wy0 + wy1) / 2], [wx1, (wy0 + wy1) / 2]]) {
      g.beginPath(); g.arc(tx, ty, 2.3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
    for (const [id, [cx, cy, shape]] of Object.entries(LAYOUT)) {
      if (!hasMap(id)) continue;
      const known = this.reveal || id === 'phlan_civilized' || id === game.location.map || exploredStats(game, getMap(id)).seen > 0;
      const here = id === this.map.id;
      const r = (shape === 'round' ? 50 : 66) * k;
      const X = sx(cx);
      const Y = sy(cy);
      g.save();
      g.beginPath();
      if (shape === 'round') g.arc(X, Y, r, 0, Math.PI * 2); else g.rect(X - r, Y - r, r * 2, r * 2);
      if (known || here) {
        g.fillStyle = 'rgba(40,20,6,0.18)';
        g.save(); g.translate(1, 1.4); g.fill(); g.restore();
        g.fillStyle = shape === 'round' ? 'rgba(232,214,170,0.96)' : 'rgba(250,240,214,0.95)';
        g.fill();
        if (shape === 'round') {
          // an inked roundel like the overview's: a gilt band and a dark entrance at its heart
          g.save();
          g.strokeStyle = 'rgba(176,132,52,0.9)';
          g.lineWidth = r * 0.28;
          g.beginPath(); g.arc(X, Y, r * 0.84, 0, Math.PI * 2); g.stroke();
          g.fillStyle = 'rgba(43,26,13,0.8)';
          g.beginPath(); g.arc(X, Y + r * 0.2, r * 0.26, Math.PI, 0); g.lineTo(X + r * 0.26, Y + r * 0.38); g.lineTo(X - r * 0.26, Y + r * 0.38); g.closePath(); g.fill();
          g.restore();
          g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2);
        } else {
          // a few washed roofs, like the overview's little plans
          const rr = (n) => ((Math.sin(n * 91.7 + cx * 0.37 + cy) * 43758.5) % 1 + 1) % 1;
          g.save(); g.clip();
          for (let i = 0; i < 6; i++) {
            g.fillStyle = `rgba(${170 + rr(i) * 40 | 0},${100 + rr(i + 9) * 50 | 0},${70 + rr(i + 3) * 30 | 0},0.55)`;
            g.fillRect(X - r + rr(i + 1) * r * 1.5, Y - r + rr(i + 2) * r * 1.5, r * (0.3 + rr(i + 4) * 0.3), r * (0.25 + rr(i + 5) * 0.3));
          }
          g.restore();
        }
        g.strokeStyle = here ? INK.vermilion : 'rgba(43,26,13,0.9)';
        g.lineWidth = here ? 2 : 1;
        g.stroke();
        if (here) {
          g.strokeStyle = 'rgba(201,160,69,0.95)';
          g.lineWidth = 1;
          g.beginPath();
          if (shape === 'round') g.arc(X, Y, r + 2.5, 0, Math.PI * 2); else g.rect(X - r - 2.5, Y - r - 2.5, r * 2 + 5, r * 2 + 5);
          g.stroke();
        }
      } else {
        g.setLineDash([2, 2]);
        g.strokeStyle = 'rgba(74,50,32,0.55)';
        g.lineWidth = 0.8;
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(150,34,26,0.75)';
        g.beginPath(); g.arc(X, Y, 2.2, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    // the party
    if (this.isHome && LAYOUT[this.map.id]) {
      const [cx, cy] = LAYOUT[this.map.id];
      const S2 = 66 * k;
      const px = sx(cx) - S2 + ((game.location.x + 0.5) / this.map.w) * S2 * 2;
      const py = sy(cy) - S2 + ((game.location.y + 0.5) / this.map.h) * S2 * 2;
      drawPartyArrow(g, px, py, 13, DIR_ANGLE[game.location.dir], { glow: 0.5 });
    }
    // inner frame
    g.strokeStyle = 'rgba(43,26,13,0.7)';
    g.lineWidth = 1;
    g.strokeRect(2.5, 2.5, W - 5, H - 5);
    return c;
  }

  _sideWorld() {
    const { game } = this.ctx;
    const items = this.world.blocks.filter((b) => b.known);
    this.side.append(
      h('div.am-side-head', [
        h('div.am-kicker', ['Overview']),
        h('div.am-title', ['Phlan']),
        h('div.am-sub', ['upon the Moonsea']),
      ]),
      h('div.am-sec', ['Surveyed blocks']),
      h('ul.am-blocks', items.map((b) => {
        const m = getMap(b.id);
        const st = exploredStats(game, m, this.reveal);
        const pct = Math.round(st.frac * 100);
        return h('li.am-block', { class: b.id === game.location.map ? 'here' : '', onclick: () => this._toBlock(b.id), dataset: { tip: 'Open this map' } }, [
          h('span.am-block-name', [m.name]),
          h('span.am-block-pct', [`${pct}%`]),
          h('div.am-bar.thin', [h('i', { style: { width: `${pct}%` } })]),
        ]);
      })),
      h('div.am-empty', [`${this.world.blocks.length - items.length} places still unknown.`]),
      ...(() => {
        const unknown = this.world.blocks.filter((b) => !b.known && b.rumour);
        if (!unknown.length) return [];
        return [
          h('div.am-sec', ['Rumours']),
          h('ul.am-notes.am-rumours', unknown.slice(0, 4).map((b) => h('li.am-note', {
            onclick: () => this.sv.focus(b.cx, b.cy, Math.max(this.sv.tZoom, 2)),
            dataset: { tip: 'Show on the overview' },
          }, [
            h('span.am-seal', [getMap(b.id).name.replace(/^The\s+/i, '')[0]]),
            h('span.am-note-text', [h('b', [getMap(b.id).name]), h('i.am-where', [` · ${b.rumour}`])]),
          ]))),
        ];
      })(),
      h('div.am-sec', ['Controls']),
      h('div.am-help', [helpRow('Click', 'open a block map'), helpRow('Drag / Wheel', 'pan · zoom'), helpRow('B / Esc', 'back to the block')]),
    );
  }

  // ------------------------------------------------------------------ loop
  update(dt) {
    const { input, clock } = this.ctx;
    if (!this.editor && this.ctx.scenes.current === this) {
      const sp = (this.mode === 'diorama' ? 9 : 520) * (dt || 0);
      let dx = 0;
      let dy = 0;
      if (input.down('forward')) dy += 1;
      if (input.down('back')) dy -= 1;
      if (input.down('turnLeft')) dx += 1;
      if (input.down('turnRight')) dx -= 1;
      if (dx || dy) {
        if (this.mode === 'diorama') this.dio?.panBy(-dx * sp, -dy * sp);
        else this.sv.panBy(dx * sp, dy * sp);
      }
    }
    if (this.mode === 'diorama' && this.dio) {
      this.dio.update(dt, clock.time);
      return;
    }
    this.sv.update(dt);
    // redraw when the view moved, or every frame while the clock runs (party pulse);
    // a frozen clock renders the settled state once.
    if (this.sv.dirty || dt > 0 || this._needsDraw) this._draw();
  }

  /**
   * Frozen clock (screenshots): once the diorama's frame has settled (same scene,
   * same camera for three renders) the canvas keeps its last image instead of
   * paying for another software-GL frame.
   */
  render() {
    if (this.mode === 'diorama' && this.dio?.scene) {
      if (this.ctx.clock.frozen) {
        const sig = this.dio.scene.uuid + this.dio.camera.matrixWorld.elements.map((v) => v.toFixed(4)).join(',') + window.innerWidth + 'x' + window.innerHeight;
        if (sig === this._dioSig && this._dioRenders >= 3) return;
        if (sig !== this._dioSig) this._dioRenders = 0;
        this._dioSig = sig;
        this._dioRenders++;
      }
      this.ctx.render.render(this.dio.scene, this.dio.camera);
    } else {
      this._dioSig = null;
      this.ctx.render.clear();
    }
  }

  _draw() {
    if (this.mode === 'diorama') return;
    const t = this.ctx.clock.time;
    this._needsDraw = false;
    if (this.view !== 'world' && this.isHome && this.map) {
      const cs = SHEET.MS / this.map.w;
      const { x, y } = this.ctx.game.location;
      this.sv.light = [SHEET.MX + (x + 0.5) * cs, SHEET.MY + (y + 0.5) * cs];
    } else this.sv.light = null;
    this.sv.draw((g, s) => (this.view === 'world' ? this._overlayWorld(g, s, t) : this._overlayBlock(g, s, t)));
  }

  _overlayBlock(g, s, t) {
    const m = this.map;
    const cs = SHEET.MS / m.w;
    const X = (x) => SHEET.MX + x * cs;
    const Y = (y) => SHEET.MY + y * cs;
    const { game } = this.ctx;
    // hover
    if (this.hover && !this.editor) {
      const { x, y } = this.hover;
      g.save();
      g.fillStyle = 'rgba(255,230,160,0.16)';
      g.fillRect(X(x), Y(y), cs, cs);
      g.strokeStyle = 'rgba(160,110,30,0.95)';
      g.lineWidth = 2.2 / s * 1.4;
      g.strokeRect(X(x) + 1, Y(y) + 1, cs - 2, cs - 2);
      g.restore();
    }
    // newly surveyed squares: paper cover fading out, nearest the party first
    if (this.isHome && this.fresh?.length && !this.ctx.clock.frozen) {
      const age = t - this.openedAt;
      let any = false;
      for (const f of this.fresh) {
        const a = 1 - Math.min(1, Math.max(0, (age - 0.2 - f.d * 0.07) / 0.7));
        if (a <= 0) continue;
        any = true;
        const cx = X(f.x) + cs / 2;
        const cy = Y(f.y) + cs / 2;
        const gr = g.createRadialGradient(cx, cy, cs * 0.2, cx, cy, cs * 0.95);
        gr.addColorStop(0, `rgba(212,192,150,${(a * 0.95).toFixed(3)})`);
        gr.addColorStop(0.6, `rgba(212,192,150,${(a * 0.8).toFixed(3)})`);
        gr.addColorStop(1, 'rgba(212,192,150,0)');
        g.fillStyle = gr;
        g.fillRect(cx - cs, cy - cs, cs * 2, cs * 2);
      }
      if (!any) this.fresh = null;
    }
    // party (view cone + arrow)
    if (this.isHome) {
      const { x, y, dir } = game.location;
      const cx = X(x) + cs / 2;
      const cy = Y(y) + cs / 2;
      const a = DIR_ANGLE[dir];
      const breathe = 0.85 + 0.15 * Math.sin(t * 2.4);
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      g.globalAlpha = breathe;
      g.globalCompositeOperation = 'multiply';
      const R = cs * 2.6;
      g.drawImage(partyConeCanvas(), -R, -R, R * 2, R * 2);
      g.restore();
      const frozen = this.ctx.clock.frozen;
      // the token grows a little when you lean in, but never swamps the plan
      const tk = Math.max(0.6, this.sv.zoom ** -0.6);
      const pulse = frozen ? 0.6 : 0.55 + 0.45 * Math.sin(t * 3.2);
      // the party's roundel: a hard-edged reserve of clean paper with a thin double
      // ink rule, a vermilion ring and the four quarter ticks of a compass card (no glow)
      g.save();
      const ring = cs * tk * 0.66;
      g.fillStyle = 'rgba(242,230,202,0.96)';
      g.beginPath(); g.arc(cx, cy, ring + cs * tk * 0.1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(43,26,13,0.92)';
      g.lineWidth = Math.max(0.9, 1.3 / s);
      g.beginPath(); g.arc(cx, cy, ring + cs * tk * 0.1, 0, Math.PI * 2); g.stroke();
      g.lineWidth = Math.max(0.5, 0.7 / s);
      g.beginPath(); g.arc(cx, cy, ring + cs * tk * 0.055, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = `rgba(168,40,24,${(0.75 + pulse * 0.2).toFixed(3)})`;
      g.lineWidth = Math.max(1.2, 1.8 / s);
      g.beginPath(); g.arc(cx, cy, ring, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(43,26,13,0.92)';
      g.lineWidth = Math.max(0.8, 1.1 / s);
      g.beginPath();
      for (let q = 0; q < 4; q++) {
        const qa = (q * Math.PI) / 2;
        const r0 = ring + cs * tk * 0.1;
        const r1 = r0 + cs * tk * 0.12;
        g.moveTo(cx + Math.cos(qa) * r0, cy + Math.sin(qa) * r0);
        g.lineTo(cx + Math.cos(qa) * r1, cy + Math.sin(qa) * r1);
      }
      g.stroke();
      g.restore();
      drawPartyArrow(g, cx, cy, cs * tk * (1.28 + pulse * 0.05), a, { glow: pulse });
    }
    this._drawZoneLabels(g, s);
    // pins
    const notes = notesFor(game, m.id);
    for (const n of notes) {
      const fl = this.flash && this.flash.x === n.x && this.flash.y === n.y ? Math.max(0, 1 - (t - this.flash.t) / 1.2) : 0;
      const hov = this.hover && this.hover.x === n.x && this.hover.y === n.y;
      const pk = Math.max(0.75, this.sv.zoom ** -0.45);
      // inked onto the sheet (multiplied into the paper), not a sticker laid over it
      g.save();
      g.globalCompositeOperation = 'multiply';
      drawPin(g, X(n.x) + cs * 0.72, Y(n.y) + cs * 0.3, cs * pk * (0.74 + (hov ? 0.08 : 0) + fl * 0.2), n.kind, { lift: hov ? cs * 0.04 : 0 });
      g.restore();
    }
  }

  /**
   * Zone names, lettered live so they stay inside the frame when zoomed, grow
   * gently with zoom (not 1:1), and step aside from pins, markers and the party.
   */
  _drawZoneLabels(g) {
    const labels = this.sheet.labels;
    if (!labels?.length) return;
    const { game } = this.ctx;
    const m = this.map;
    const cs = SHEET.MS / m.w;
    const X = (x) => SHEET.MX + x * cs;
    const Y = (y) => SHEET.MY + y * cs;
    const obs = [...(this.sheet.markerSpots ?? [])];
    const walls = this.sheet.wallRects ?? [];
    for (const n of notesFor(game, m.id)) obs.push([X(n.x) + cs * 0.36, Y(n.y) - cs * 0.06, cs * 0.72, cs * 0.72]);
    // the party token's full ring (it grows a little when zoomed out) is a hard keep-out
    const hard = [...walls];
    if (this.isHome) {
      const hr = cs * Math.max(0.6, this.sv.zoom ** -0.6) * 0.98;
      const px = X(game.location.x) + cs / 2;
      const py = Y(game.location.y) + cs / 2;
      hard.push([px - hr, py - hr, hr * 2, hr * 2]);
    }
    const pad = 12;
    const vr = this.viewRect;
    const [vx0, vy0] = this.sv.screenToUnits(vr.x + pad, vr.y + pad);
    const [vx1, vy1] = this.sv.screenToUnits(vr.x + vr.w - pad, vr.y + vr.h - pad);
    const zoom = this.sv.zoom;
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    const placed = [];
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // keep every name inside the map's inner border as well as the view
    const bx0 = Math.max(vx0, SHEET.MX + 4);
    const by0 = Math.max(vy0, SHEET.MY + 4);
    const bx1 = Math.min(vx1, SHEET.MX + SHEET.MS - 4);
    const by1 = Math.min(vy1, SHEET.MY + SHEET.MS - 4);
    const reg = this.sheet.regions;
    const seen = (x, y) => this.sheet.seenCell(x, y);
    for (const z of labels) {
      let zx0 = X(z.x);
      let zy0 = Y(z.y);
      let zx1 = X(z.x + z.w);
      let zy1 = Y(z.y + z.h);
      if (zx1 < vx0 || zx0 > vx1 || zy1 < vy0 || zy0 > vy1) continue;
      // a district that holds a building is named on the building itself
      const inZone = (x, y) => x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
      let home = null;
      for (const rg of reg?.list ?? []) {
        if (rg.type !== CELL.INTERIOR) continue;
        const cells = rg.cells.filter(([x, y]) => inZone(x, y));
        if (cells.length < 2 || !cells.some(([x, y]) => seen(x, y))) continue;
        if (!home || cells.length > home.length) home = cells;
      }
      const onHome = home ? new Set(home.map(([x, y]) => `${x},${y}`)) : null;
      if (home) {
        zx0 = X(Math.min(...home.map((c) => c[0])));
        zy0 = Y(Math.min(...home.map((c) => c[1])));
        zx1 = X(Math.max(...home.map((c) => c[0])) + 1);
        zy1 = Y(Math.max(...home.map((c) => c[1])) + 1);
      }
      // a name whose district lies mostly off the view is not dragged in to float
      const zcx = (zx0 + zx1) / 2;
      const zcy = (zy0 + zy1) / 2;
      if (zcx < vx0 - cs * 0.3 || zcx > vx1 + cs * 0.3 || zcy < vy0 - cs * 0.3 || zcy > vy1 + cs * 0.3) continue;
      const zw = (zx1 - zx0) / cs;
      const base0 = Math.min(cs * 0.42, Math.max(cs * 0.3, (zw * cs * 0.92) / 7));
      const fs0 = Math.max(base0 * zoom ** -0.42, 17 / this.sv.scaleAt());
      const name = z.name.toUpperCase();
      let best = null;
      // try full size first; shrink only when every placement would touch a wall or the party
      for (const shrink of [1, 0.86, 0.74]) {
        const fs = fs0 * shrink;
        const caps = fs * 0.8;
        g.font = `bold ${caps.toFixed(2)}px ${SERIF}`;
        g.letterSpacing = `${(caps * 0.16).toFixed(2)}px`;
        const lh = caps * 1.3;
        const options = [1, 2].map((n) => balancedLines(g, name, n)).filter((o, i, a) => i === 0 || o.length > a[i - 1].length);
        for (const [wi, lines] of options.entries()) {
          const lw = Math.max(...lines.map((l) => g.measureText(l).width));
          const bh = lines.length * lh;
          const tooWide = Math.max(0, lw - (zx1 - zx0) * 0.94) / cs;
          for (const fx of [0, -0.3, 0.3, -0.6, 0.6]) {
            for (const fy of [0, -0.35, 0.35, -0.7, 0.7, -1.15, 1.15, -1.6, 1.6]) {
              const cx = clamp((zx0 + zx1) / 2 + fx * (zx1 - zx0) * 0.5, bx0 + lw / 2, bx1 - lw / 2);
              const cy = clamp((zy0 + zy1) / 2 + fy * Math.max(zy1 - zy0, cs * 1.2) * 0.5, by0 + bh / 2, by1 - bh / 2);
              const box = [cx - lw / 2 - caps * 0.2, cy - bh / 2 + caps * 0.12, lw + caps * 0.4, bh - caps * 0.24];
              const area = box[2] * box[3];
              let score = Math.abs(fx) * 0.6 + Math.abs(fy) * 0.5 + wi * 0.6 + tooWide * 0.45 + (1 - shrink) * 6;
              for (const o of obs) score += (overlap(box, o) / area) * 12;
              for (const o of placed) score += (overlap(box, o) / area) * 12;
              for (const o of hard) {
                const ov = overlap(box, o);
                if (ov > 0) score += 30 + (ov / area) * 60;
              }
              if (cx < zx0 || cx > zx1 || cy < zy0 || cy > zy1) score += 1.5;
              const ccx = Math.floor((cx - SHEET.MX) / cs);
              const ccy = Math.floor((cy - SHEET.MY) / cs);
              if (onHome && !onHome.has(`${ccx},${ccy}`)) score += 2;
              if (!seen(ccx, ccy)) score += 4;
              if (!best || score < best.score) best = { cx, cy, box, score, lines, bh, lh, caps };
            }
          }
        }
        if (best.score < 30) break;
      }
      const caps = best.caps;
      const lh = best.lh;
      g.font = `bold ${caps.toFixed(2)}px ${SERIF}`;
      g.letterSpacing = `${(caps * 0.16).toFixed(2)}px`;
      const { lines, bh } = best;
      placed.push(best.box);
      // lettered on a knocked-out slip of parchment, so no name ever sits on a busy floor
      {
        const lw = Math.max(...lines.map((l) => g.measureText(l).width));
        const sx = best.cx - lw / 2 - caps * 0.75;
        const sy = best.cy - bh / 2 - caps * 0.28;
        const sw = lw + caps * 1.5;
        const sh = bh + caps * 0.5;
        g.save();
        g.fillStyle = 'rgba(50,28,10,0.28)';
        g.fillRect(sx + caps * 0.12, sy + caps * 0.16, sw, sh);
        const pg = g.createLinearGradient(0, sy, 0, sy + sh);
        pg.addColorStop(0, 'rgba(246,236,208,0.97)');
        pg.addColorStop(1, 'rgba(232,214,174,0.97)');
        g.fillStyle = pg;
        g.beginPath();
        // the slip's ends notched like a swallow-tail ribbon
        const nt = caps * 0.35;
        g.moveTo(sx, sy); g.lineTo(sx + sw, sy); g.lineTo(sx + sw - nt, sy + sh / 2); g.lineTo(sx + sw, sy + sh);
        g.lineTo(sx, sy + sh); g.lineTo(sx + nt, sy + sh / 2); g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(43,26,13,0.85)';
        g.lineWidth = Math.max(0.5, caps * 0.05);
        g.stroke();
        g.strokeStyle = 'rgba(168,50,32,0.65)';
        g.lineWidth = Math.max(0.4, caps * 0.035);
        g.beginPath();
        g.moveTo(sx + nt + caps * 0.2, sy + caps * 0.16); g.lineTo(sx + sw - nt - caps * 0.2, sy + caps * 0.16);
        g.moveTo(sx + nt + caps * 0.2, sy + sh - caps * 0.16); g.lineTo(sx + sw - nt - caps * 0.2, sy + sh - caps * 0.16);
        g.stroke();
        g.fillStyle = '#3a1709';
        lines.forEach((l, i) => g.fillText(l, best.cx + caps * 0.08, best.cy - bh / 2 + lh * (i + 0.5) + caps * 0.04));
        g.restore();
      }
    }
    g.letterSpacing = '0px';
    g.restore();
  }

  _overlayWorld(g, s, t) {
    const { game } = this.ctx;
    const b = this.hover ? this.world.blocks.find((q) => q.id === this.hover.id) : null;
    if (b) {
      g.save();
      g.strokeStyle = b.known ? 'rgba(200,150,40,0.95)' : 'rgba(90,70,50,0.6)';
      g.lineWidth = 3;
      g.shadowColor = 'rgba(255,210,120,0.8)';
      g.shadowBlur = 12 * s;
      if (b.round) { g.beginPath(); g.arc(b.cx, b.cy, b.r + 4, 0, Math.PI * 2); g.stroke(); } else if (b.poly) {
        g.beginPath();
        b.poly.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.closePath();
        g.stroke();
      } else g.strokeRect(b.x - 4, b.y - 4, b.s + 8, b.s + 8);
      g.restore();
    }
    const here = this.world.blocks.find((q) => q.id === game.location.map);
    if (here) {
      const { x, y, dir } = game.location;
      const [px, py] = this.world.cellToUnits(here, x + 0.5, y + 0.5);
      const pulse = this.ctx.clock.frozen ? 0.6 : 0.55 + 0.45 * Math.sin(t * 3.2);
      // you are here: a hard-edged paper roundel with a double ink rule, a vermilion
      // ring and quarter ticks (the same device as on the block sheets), no glow
      g.save();
      g.fillStyle = 'rgba(244,234,208,0.96)';
      g.beginPath(); g.arc(px, py, 32, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(43,26,13,0.92)';
      g.lineWidth = 1.4;
      g.beginPath(); g.arc(px, py, 32, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 0.7;
      g.beginPath(); g.arc(px, py, 29.5, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = `rgba(168,40,24,${(0.75 + pulse * 0.2).toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 26, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(43,26,13,0.92)';
      g.lineWidth = 1.2;
      g.beginPath();
      for (let q = 0; q < 4; q++) {
        const qa = (q * Math.PI) / 2;
        g.moveTo(px + Math.cos(qa) * 32, py + Math.sin(qa) * 32);
        g.lineTo(px + Math.cos(qa) * 38, py + Math.sin(qa) * 38);
      }
      g.stroke();
      g.restore();
      drawPartyArrow(g, px, py, 40, DIR_ANGLE[dir], { glow: pulse });
    }
  }

  close() {
    this._closeEditor();
    if (this.overlay && this.ctx.scenes.stack.length > 1) this.ctx.scenes.pop();
    else this.ctx.scenes.goto('explore', {});
  }

  exit() {
    this._closeEditor();
    super.exit();
  }

  onResize() {
    this._layout();
    this._draw();
  }
}

/** Split a name over n lines at word breaks, as evenly as the words allow (no orphans). */
function balancedLines(g, text, n) {
  const words = text.split(/\s+/);
  if (n <= 1 || words.length < 2) return [text];
  n = Math.min(n, words.length);
  let best = null;
  const rec = (start, left, acc) => {
    if (left === 1) {
      const lines = [...acc, words.slice(start).join(' ')];
      const ws = lines.map((l) => g.measureText(l).width);
      // the widest line decides, and a line of one short word is penalised
      const cost = Math.max(...ws) + lines.reduce((a, l) => a + (l.length <= 3 ? 400 : 0), 0);
      if (!best || cost < best.cost) best = { cost, lines };
      return;
    }
    for (let i = start + 1; i <= words.length - left + 1 - 0; i++) {
      if (words.length - i < left - 1) break;
      rec(i, left - 1, [...acc, words.slice(start, i).join(' ')]);
    }
  };
  rec(0, n, []);
  return best ? best.lines : [text];
}

function helpRow(k, v) {
  return h('div.am-help-row', [h('kbd', [k]), h('span', [v])]);
}
