import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, clear, Frame, CommandBar, KeyLegend, PartyRoster, MessageLog } from '../../ui/UI.js';
import { openCharacterView } from '../../ui/components/CharacterView.js';
import { castingClassesOf, fmtMinutes } from '../../ui/components/SpellPanel.js';
import { miniPortrait } from '../../ui/components/CharacterSheet.js';
import { deriveStats, isAlive } from '../../rules/character.js';
import { rest, partyMemorizationTime, restUntilHealedMinutes, autoPrepare, MINUTES_PER_DAY } from '../../rules/camp.js';
import { castSpell, isMemorized } from '../../rules/spells.js';
import { hasMap, getMap } from '../../data/maps/index.js';
import { SAVE_SLOTS } from '../../core/SaveManager.js';
import { buildCamp } from './CampBackdrop.js';
import { useRenderer } from '../../ui/components/Miniature.js';
import { UINav } from '../../ui/components/uiNav.js';
import { setPortraitSync } from '../../ui/components/lazyPortrait.js';

const CURES = ['cureSeriousWounds', 'cureLightWounds'];

/**
 * ENCAMP: SAVE VIEW MAGIC REST ALTER FIX EXIT over a campfire among Phlan's ruins.
 * params: {panel?: 'view'|'items'|'magic'|'save'|'rest'|'alter', member?: number}
 * Owned by the char-creation + party-UI workstream.
 */
export default class CampScene extends Scene {
  async enter(params = {}) {
    const { render, game } = this.ctx;
    useRenderer(render.renderer);
    setPortraitSync(!!this.ctx.debug?.frozen);
    this.params = params;
    // Casters with no chosen spells get a sensible load-out (they can change it in MAGIC).
    for (const ch of game.party) if (castingClassesOf(ch).length && !Object.values(ch.spells?.prepared ?? {}).some((l) => l.length)) autoPrepare(ch);

    await this._build3d();
    this.post = { bloomStrength: 0.7, bloomThreshold: 0.9, vignette: 0.62, exposure: 1.0 };
    this._buildUI();
    this.listen('input:action', ({ action }) => this._onAction(action));
    this.listen('time:changed', () => this._refreshStatus());
    this.listen('party:changed', () => this._refreshStatus());
    this.ctx.audio?.playMusic?.('camp');
    this.ctx.ui.message('The party makes camp among the ruins. Sentries are posted.', 'lore');
    // Arrow keys / D-pad walk the camp panel and the command line.
    this.nav = new UINav(this.ctx, { roots: () => (this.view || this.busy ? [] : [this.statusBody, this.bar?.el]) });
    this.own(() => this.nav.dispose());
    if (params.sleep) {
      // Gallery/debug: the party asleep part-way through a rest (deterministic under a frozen clock).
      this.doRest(partyMemorizationTime(game.party) || 480, { demo: 0.46 });
    }
    const p = params.panel;
    if (p === 'view' || p === 'items' || p === 'magic') this.openView(p === 'view' ? 'sheet' : p === 'items' ? 'items' : 'spells', params.member != null ? Number(params.member) : undefined);
    else if (p === 'save') this.openSave();
    else if (p === 'rest') this.openRest();
    else if (p === 'alter') this.openAlter();
  }

  async _build3d() {
    const { render, game } = this.ctx;
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(46, render.aspect, 0.1, 600);
    this.camera.position.set(0, 1.75, 5.2);
    this.camera.lookAt(0, 0.95, -0.6);
    if (this.ctx.debug?.raw?.campcam === 'close') {
      this.camera.position.set(0.4, 1.3, 1.6);
      this.camera.lookAt(-0.6, 0.75, -1.2);
    } else if (this.ctx.debug?.raw?.campcam === 'sleep') {
      this.camera.position.set(-0.6, 1.2, 0.6);
      this.camera.lookAt(-2.0, 0.1, -0.9);
    }
    this.hour = game.clock.hour + game.clock.minute / 60;
    const fullPanel = ['view', 'items', 'magic'].includes(this.params.panel) && !this.params.sleep;
    this.camp = await buildCamp(s, { party: game.party, hour: this.hour, renderer: render.renderer, resting: !!this.params.sleep, deferParty: fullPanel });
  }

  _buildUI() {
    const { game } = this.ctx;
    // Title.
    this.topSub = h('div.s');
    this.topTitle = h('div.t.por-gilt-text', ['Encamped']);
    this.ctx.ui.mount(h('div.camp-top', [this.topTitle, this.topSub]));

    // Left: camp status.
    this.statusBody = h('div');
    const sf = Frame({ title: 'Camp', variant: 'blue', children: [this.statusBody] });
    sf.el.classList.add('camp-menu');
    this.ctx.ui.mount(sf.el);

    // Right: party.
    this.roster = new PartyRoster(this.ctx, { portraits: true, onOpen: (i) => this.openView('sheet', i) });
    const rf = Frame({ title: 'Party', children: [this.roster.el] });
    rf.el.classList.add('camp-party');
    this.ctx.ui.mount(rf.el);

    // Bottom: the Gold Box command line + log.
    const log = new MessageLog(this.ctx.bus, { lines: 2 });
    this.ctx.ui.mount(h('div.camp-log', [log.el]));
    this.bar = new CommandBar([
      { id: 'save', label: 'Save', key: 'S', tip: 'Save or load the game', onSelect: () => this.openSave() },
      { id: 'view', label: 'View', key: 'V', tip: 'Character sheet and items', onSelect: () => this.openView('sheet') },
      { id: 'magic', label: 'Magic', key: 'M', tip: 'Memorize, cast and scribe spells', onSelect: () => this.openView('spells') },
      { id: 'rest', label: 'Rest', key: 'R', tip: 'Rest to heal and memorize spells', onSelect: () => this.openRest() },
      { id: 'alter', label: 'Alter', key: 'A', tip: 'Party order, drop a member, game speed', onSelect: () => this.openAlter() },
      { id: 'fix', label: 'Fix', key: 'F', tip: 'Clerics heal the party with their spells, resting between prayers', onSelect: () => this.fix() },
      { id: 'exit', label: 'Exit', key: 'E', tip: 'Break camp', onSelect: () => this.exitCamp() },
    ].map((c) => ({ ...c, onSelect: () => { if (!this.busy && !this.ctx.ui.layers.modal.children.length) c.onSelect(); } })), { title: 'Encamp:' });
    this.ctx.ui.mount(h('div.pc-cmdline', [this.bar.el]));
    this.own(() => { this.roster.dispose(); log.dispose(); this.bar.dispose(); });
    this.cmdIndex = 0;
    this._refreshStatus();
    void game;
  }

  _refreshStatus() {
    if (!this.statusBody) return;
    const { game } = this.ctx;
    // While resting, the header and TIME follow the rest clock.
    const mins = this.busy ? this.busy.from + this.busy.applied : game.minutes;
    const day = Math.floor(mins / MINUTES_PER_DAY) + 1;
    const hour = Math.floor((mins % MINUTES_PER_DAY) / 60);
    const minute = mins % 60;
    const loc = game.location?.map;
    const where = loc && hasMap(loc) ? getMap(loc).name ?? loc : 'Phlan';
    this.topSub.textContent = `${where} · Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const party = game.party;
    const memo = partyMemorizationTime(party);
    const wounded = party.filter((c) => isAlive(c) && c.hp.cur < c.hp.max);
    const heal = restUntilHealedMinutes(party);
    const gold = party.reduce((t, c) => t + (c.gold ?? 0), 0);
    const clerics = party.filter((c) => CURES.some((id) => isMemorized(c, id)));
    clear(this.statusBody);
    const row = (k, v, tip) => [h('span.k', { dataset: tip ? { tip } : {} }, [k]), h('span.v', { dataset: tip ? { tip } : {} }, [v])];
    this.statusBody.append(
      h('div.pc-kv', [
        ...row('Time', `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, 'Resting advances the clock. Spells are memorized after sleep.'),
        ...row('Day', String(day)),
        ...row('Memorize', memo ? fmtMinutes(memo) : 'done', 'Rest the casters need to memorize their chosen spells (1e: sleep, then 15 minutes per spell level).'),
        ...row('Wounded', wounded.length ? `${wounded.length} of ${party.length}` : 'none', 'Natural rest heals 1 hp per day; FIX lets clerics heal the party.'),
        ...row('Full health', heal > memo ? `${Math.ceil(heal / MINUTES_PER_DAY)} day${Math.ceil(heal / MINUTES_PER_DAY) === 1 ? '' : 's'}` : 'now'),
        ...row('Cures', clerics.length ? `${clerics.reduce((t, c) => t + CURES.reduce((u, id) => u + (c.spells?.memorized?.cleric ?? []).filter((x) => x === id).length, 0), 0)} memorized` : 'none memorized', 'Cure spells memorized by the party\'s clerics, ready for FIX. Choose cures in MAGIC and rest to memorize them.'),
        ...row('Party gold', `${gold.toLocaleString('en-US')} gp`),
      ]),
      h('div.camp-status', [
        h('button.por-btn.primary', { style: { gridColumn: 'span 2' }, disabled: !!this.busy, onclick: () => (memo ? this.doRest(memo) : this.openRest()) }, [this.busy ? 'Resting…' : memo ? `Rest ${fmtMinutes(memo)}` : 'Rest…']),
        h('button.por-btn', { disabled: !!this.busy, onclick: () => this.openView('spells') }, ['Magic']),
        h('button.por-btn', { disabled: !!this.busy, onclick: () => this.fix() }, ['Fix']),
      ]),
      KeyLegend([['A–Z', 'Command'], [['[', ']'], 'Member'], ['Esc', 'Break camp']], { className: 'por-legend--rule' }),
    );
  }

  _onAction(action) {
    if (this.busy) {
      if (action === 'cancel') this.interruptRest();
      return;
    }
    // The Esc that was meant to interrupt a rest that had just ended must not also break camp.
    if (action === 'cancel' && this._restEndedAt != null && this.ctx.clock.time - this._restEndedAt < 0.9) return;
    if (this.ctx.ui.layers.modal.children.length) return;
    const n = this.ctx.game.party.length;
    const g = this.ctx.game;
    const cmds = this.bar.commands;
    if (action === 'cancel') this.exitCamp();
    else if (action === 'view') this.openView('sheet');
    else if (action === 'nextMember' && n) { g.activeIndex = (g.activeIndex + 1) % n; g.notifyPartyChanged(); }
    else if (action === 'prevMember' && n) { g.activeIndex = (g.activeIndex + n - 1) % n; g.notifyPartyChanged(); }
    void cmds;
  }

  // ------------------------------------------------------------------ panels

  openView(tab = 'sheet', index) {
    if (this.view) this.view.close();
    let i = index;
    if (tab === 'spells' && i == null) {
      const active = this.ctx.game.activeIndex;
      const party = this.ctx.game.party;
      i = castingClassesOf(party[active] ?? {}).length ? active : party.findIndex((c) => castingClassesOf(c).length);
      if (i < 0) i = active;
    }
    this.view = openCharacterView(this.ctx, {
      index: i,
      tab,
      onClose: () => { this.view = null; this.camp?.ensureParty?.(); this._refreshStatus(); },
      onRest: () => { this.view?.close(); this.doRest(partyMemorizationTime(this.ctx.game.party)); },
    });
  }

  _modal(title, content, { width = '34em' } = {}) {
    const f = Frame({ title, variant: 'blue', className: 'por-dialog' });
    f.el.style.maxWidth = width;
    f.el.style.width = width;
    let nav = null;
    const close = () => { back.remove(); window.removeEventListener('keydown', onKey, true); nav?.dispose(); this._refreshStatus(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    };
    f.body.append(content, h('div.por-dialog-buttons', { style: { marginTop: '1em' } }, [h('button.por-btn', { onclick: close }, ['Close'])]));
    const back = h('div.por-modal-backdrop', [f.el]);
    window.addEventListener('keydown', onKey, true);
    this.ctx.ui.layers.modal.append(back);
    // Arrows / D-pad move between the options, Enter / A picks, Esc / B closes; the first option starts focused.
    nav = new UINav(this.ctx, { roots: () => [f.el], modal: true, autofocus: true, onBack: close });
    return { close, body: f.body, nav };
  }

  openSave() {
    const { saves, game, ui, debug } = this.ctx;
    const list = new Map(saves.list().map((r) => [r.slot, r]));
    let mode = 'save';
    const body = h('div');
    const draw = () => {
      clear(body);
      body.append(h('div.pc-subtabs', [
        h(`button.pc-tab${mode === 'save' ? '.sel' : ''}`, { onclick: () => { mode = 'save'; draw(); } }, ['Save']),
        h(`button.pc-tab${mode === 'load' ? '.sel' : ''}`, { onclick: () => { mode = 'load'; draw(); } }, ['Load']),
      ]));
      if (debug?.nosave) body.append(h('p.pc-rest-note', ['Saving is disabled in debug/screenshot mode.']));
      body.append(h('div.camp-slots', SAVE_SLOTS.filter((s) => mode === 'load' || s !== 'auto').map((slot) => {
        const r = list.get(slot);
        return h(`button.camp-slot${r ? '' : '.empty'}`, {
          disabled: mode === 'load' && !r,
          onclick: async () => {
            if (mode === 'save') {
              if (r && this.ctx.settings.get('confirmDangerous') !== false) {
                const ok = await ui.dialog({ title: 'Overwrite?', variant: 'blue', body: `Replace the game in slot ${slot}?`, buttons: [{ id: 'y', label: 'Overwrite', primary: true }, { id: null, label: 'Cancel' }] });
                if (ok !== 'y') return;
              }
              const done = saves.save(slot, game);
              ui.toast(done ? `Saved to slot ${slot}` : 'Save unavailable');
              m.close();
            } else if (r) {
              const st = saves.load(slot);
              if (st) {
                game.loadJSON(st);
                m.close();
                this.ctx.scenes.goto('explore', {});
              }
            }
          },
        }, [
          h('span.id', [slot === 'auto' ? '⟳' : slot]),
          h('span', [h('div.sm', [r ? r.summary : 'Empty slot']), r ? h('div.dt', [new Date(r.savedAt).toLocaleString()]) : null]),
          h('span.dt', [mode === 'save' ? (r ? 'overwrite' : 'save') : r ? 'load' : '']),
        ]);
      })));
    };
    const m = this._modal('Save / Load', body, { width: '36em' });
    draw();
  }

  openRest() {
    const party = this.ctx.game.party;
    const memo = partyMemorizationTime(party);
    const heal = restUntilHealedMinutes(party);
    const opts = [
      memo ? ['Until spells are memorized', memo, 'Casters study after sleep; every chosen spell returns.'] : null,
      heal > memo ? ['Until everyone is healed', heal, 'Natural rest heals 1 hit point per full day.'] : null,
      ['Sleep the night', 480, 'Eight hours under the stars.'],
      ['Short rest', 60, 'An hour to catch your breath.'],
      ['Rest one full day', MINUTES_PER_DAY, 'Heals each wounded companion 1 hp.'],
    ].filter(Boolean);
    const watch = this._sentry();
    const body = h('div', [
      h('p.pc-rest-note', [`Rest heals and lets casters memorize their chosen spells. ${watch ? `${watch.name} takes first watch;` : 'Sentries keep watch;'} you may interrupt at any time.`]),
      h('div.camp-slots', opts.map(([label, min, note]) => h('button.camp-slot', { onclick: () => { m.close(); this.doRest(min); } }, [
        h('span.id', ['☾']), h('span', [h('div', [label]), h('div.sm', [note])]), h('span.dt', [fmtMinutes(min) || '—']),
      ]))),
    ]);
    const m = this._modal('Rest', body);
  }

  _sentry() {
    const party = this.ctx.game.party.filter((c) => isAlive(c) && c.status === 'ok');
    return party.find((c) => String(c.classSpec).includes('fighter')) ?? party[0] ?? null;
  }

  /**
   * Rest `minutes` as a time-lapse the player can interrupt: the fire burns
   * down, the party sleeps, the clock and a progress bar run, and the rest is
   * applied in increments so an interrupted rest keeps what it earned.
   * @param {number} minutes
   * @param {{demo?: number}} [o]  demo: hold at this progress (gallery shots)
   */
  doRest(minutes, o = {}) {
    if (!minutes || this.busy) return;
    const { game, ui } = this.ctx;
    const watch = this._sentry();
    const casters = game.party.filter((c) => isAlive(c) && castingClassesOf(c).length);
    ui.message(`The party beds down for ${fmtMinutes(minutes)}; ${watch ? `${watch.name} takes first watch.` : 'no one keeps watch.'}`, 'lore');
    // The resting overlay: moon, time rested of total, a progress bar and Interrupt.
    const bar = h('i');
    const label = h('span.v');
    const clock = h('span.c');
    const note = h('div.n', [casters.length ? `${casters.map((c) => c.name).join(', ')} ${casters.length === 1 ? 'studies' : 'study'} after sleep.` : 'The fire crackles low; the ruins are quiet.']);
    const interrupt = h('button.por-btn', { onclick: () => this.interruptRest() }, ['Interrupt ', h('span.por-hk-badge', ['Esc'])]);
    const panel = h('div.camp-resting', [
      h('div.moon'),
      h('div.body', [
        h('div.hd', [h('span.t.por-gilt-text', ['Resting']), label, clock]),
        h('div.camp-rest-bar', [bar, ...[0.25, 0.5, 0.75].map((x) => h('b', { style: { left: `${x * 100}%` } }))]),
        note,
      ]),
      interrupt,
    ]);
    this.ctx.ui.mount(panel);
    this.topTitle && (this.topTitle.textContent = 'Resting');
    this.camp?.setResting(true);
    this.bar?.el.classList.add('dim');
    const busy = (this.busy = {
      panel, bar, label, clock, from: game.minutes, total: minutes, applied: 0, report: { healed: {}, memorized: {}, died: [] },
      start: this.ctx.clock.time - (o.demo ? o.demo * Math.min(6, 2.2 + minutes / 110) : 0), dur: Math.min(6, 2.2 + minutes / 110), demo: o.demo ?? null,
    });
    this._advanceRest(o.demo ?? 0);
    void busy;
    game.notifyPartyChanged();
    this._refreshStatus();
  }

  /** Apply rest up to fraction p of the total and update the overlay. */
  _advanceRest(p) {
    const b = this.busy;
    if (!b) return;
    const { game } = this.ctx;
    const target = Math.round(b.total * Math.max(0, Math.min(1, p)));
    const delta = target - b.applied;
    if (delta > 0 && b.demo == null) {
      const r = rest(game.party, delta, { rng: this.ctx.rng });
      for (const [id, n] of Object.entries(r.healed)) b.report.healed[id] = (b.report.healed[id] ?? 0) + n;
      for (const [id, ids] of Object.entries(r.memorized)) b.report.memorized[id] = [...(b.report.memorized[id] ?? []), ...ids];
      b.report.died.push(...r.died);
      game.advanceTime(delta);
    }
    b.applied = target;
    b.bar.style.width = `${(target / b.total) * 100}%`;
    b.label.textContent = `${fmtMinutes(target) === 'no rest' ? '0m' : fmtMinutes(target)} of ${fmtMinutes(b.total)}`;
    const m = b.from + target;
    b.clock.textContent = `Day ${Math.floor(m / MINUTES_PER_DAY) + 1} · ${String(Math.floor((m % MINUTES_PER_DAY) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (delta !== 0 || b.demo != null) this._refreshClock();
  }

  /** Header + TIME row only (cheap; called every rest frame). */
  _refreshClock() {
    const b = this.busy;
    const mins = b ? b.from + b.applied : this.ctx.game.minutes;
    const hh = String(Math.floor((mins % MINUTES_PER_DAY) / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const loc = this.ctx.game.location?.map;
    const where = loc && hasMap(loc) ? getMap(loc).name ?? loc : 'Phlan';
    if (this.topSub) this.topSub.textContent = `${where} · Day ${Math.floor(mins / MINUTES_PER_DAY) + 1}, ${hh}:${mm}`;
    const t = this.statusBody?.querySelector('.pc-kv > .v');
    if (t) t.textContent = `${hh}:${mm}`;
  }

  interruptRest() {
    if (!this.busy || this.busy.demo != null) return;
    this.busy.interrupted = true;
    this._finishRest();
  }

  _finishRest() {
    const b = this.busy;
    if (!b) return;
    this.busy = null;
    this._restEndedAt = this.ctx.clock.time;
    const { game, ui } = this.ctx;
    const names = Object.fromEntries(game.party.map((c) => [c.id, c.name]));
    ui.message(b.interrupted ? `Rest interrupted after ${fmtMinutes(b.applied) || 'a moment'}.` : `The party rests for ${fmtMinutes(b.applied)}.`, b.interrupted ? 'warn' : 'info');
    for (const [id, n] of Object.entries(b.report.healed)) ui.message(`${names[id]} heals ${n} hp.`, 'system');
    for (const [id, ids] of Object.entries(b.report.memorized)) ui.message(`${names[id]} memorizes ${ids.length} spell${ids.length === 1 ? '' : 's'}.`, 'system');
    for (const id of b.report.died) ui.message(`${names[id]} succumbs to poison.`, 'warn');
    b.panel.classList.add('out');
    setTimeout(() => b.panel.remove(), 400);
    this.camp?.setResting(false);
    this.bar?.el.classList.remove('dim');
    this.topTitle && (this.topTitle.textContent = 'Encamped');
    // New hour → rebuild the sky/light if day and night have turned.
    const hour = game.clock.hour + game.clock.minute / 60;
    const night = (x) => x < 6 || x >= 19;
    if (night(hour) !== night(this.hour)) this._rebuild3d();
    game.notifyPartyChanged();
    this._refreshStatus();
  }

  async _rebuild3d() {
    const old = this.camp;
    const oldScene = this.scene3d;
    await this._build3d();
    old?.dispose();
    oldScene?.clear();
  }

  openAlter() {
    const { game, settings } = this.ctx;
    const body = h('div');
    const draw = () => {
      clear(body);
      body.append(h('div.pc-sect-h', [h('span', ['Marching order'])]));
      body.append(h('div.pc-order', game.party.map((c, i) => h('div.pc-order-row', [
        h('span.i', [String(i + 1)]),
        miniPortrait(c),
        h('span', [c.name, h('div', { style: { fontSize: '0.75em', color: 'var(--por-text-dim)' } }, [`${deriveStats(c).className} ${deriveStats(c).levels}`])]),
        h('span.b', [
          h('button', { disabled: i === 0, onclick: () => { game.party.splice(i - 1, 0, game.party.splice(i, 1)[0]); game.notifyPartyChanged(); draw(); } }, ['▲']),
          h('button', { disabled: i === game.party.length - 1, onclick: () => { game.party.splice(i + 1, 0, game.party.splice(i, 1)[0]); game.notifyPartyChanged(); draw(); } }, ['▼']),
          h('button', {
            disabled: game.party.length < 2,
            onclick: async () => {
              const ok = await this.ctx.ui.dialog({ title: 'Drop', variant: 'blue', body: `${c.name} leaves the party for good?`, buttons: [{ id: 'y', label: 'Drop', primary: true }, { id: null, label: 'Cancel' }] });
              if (ok !== 'y') return;
              game.party.splice(game.party.indexOf(c), 1);
              game.activeIndex = Math.min(game.activeIndex, game.party.length - 1);
              game.notifyPartyChanged();
              this.ctx.ui.message(`${c.name} leaves the party.`, 'warn');
              draw();
            },
          }, ['Drop']),
        ]),
      ]))));
      const speed = (key, label, vals) => {
        const cur = settings.get(key) ?? 1;
        return h('div.cc-row', [h('span.k', [label]), h('div.pc-subtabs', { style: { margin: 0 } }, vals.map(([v, l]) => h(`button.pc-tab${cur === v ? '.sel' : ''}`, { onclick: () => { settings.set(key, v); draw(); } }, [l])))]);
      };
      body.append(h('div.pc-sect-h', { style: { marginTop: '1em' } }, [h('span', ['Speed'])]));
      body.append(speed('moveSpeed', 'Walking', [[0.75, 'Slow'], [1, 'Normal'], [1.5, 'Fast'], [2.5, 'Swift']]));
      body.append(speed('combatSpeed', 'Combat', [[0.5, 'Slow'], [1, 'Normal'], [2, 'Fast'], [4, 'Swift']]));
      body.append(speed('textSpeed', 'Text', [[0.5, 'Slow'], [1, 'Normal'], [0, 'Instant']]));
    };
    draw();
    this._modal('Alter', body, { width: '38em' });
  }

  /** FIX: clerics cast their cures on the wounded, resting to re-pray, until healed or out of time. */
  fix() {
    if (this.busy) return;
    const { game, ui, rng } = this.ctx;
    const party = game.party;
    const wounded = () => party.filter((c) => isAlive(c) && c.status !== 'dead' && c.hp.cur < c.hp.max).sort((a, b) => a.hp.cur / a.hp.max - b.hp.cur / b.hp.max);
    if (!wounded().length) return ui.message('No one needs healing.', 'system');
    const healers = party.filter((c) => c.status === 'ok' && castingClassesOf(c).includes('cleric'));
    if (!healers.length) return ui.message('There is no cleric to tend the wounded.', 'warn');
    let total = 0;
    let casts = 0;
    let rested = 0;
    for (let round = 0; round < 12 && wounded().length; round++) {
      let any = false;
      for (const c of healers) {
        for (const id of CURES) {
          while (isMemorized(c, id) && wounded().length) {
            const t = wounded()[0];
            const before = t.hp.cur;
            const r = castSpell(rng, id, c, [t], { consume: true, context: 'camp' });
            if (!r.ok) break;
            total += t.hp.cur - before;
            casts++;
            any = true;
          }
        }
      }
      if (!wounded().length) break;
      // Re-pray: rest long enough to memorize the load-out again.
      const need = partyMemorizationTime(party);
      const hasCures = healers.some((c) => (c.spells?.prepared?.cleric ?? []).some((id) => CURES.includes(id)));
      if (!need || !hasCures || (!any && round > 0)) break;
      rest(party, need, { rng });
      game.advanceTime(need);
      rested += need;
    }
    game.notifyPartyChanged();
    ui.message(casts ? `The clerics cast ${casts} healing spell${casts === 1 ? '' : 's'}, restoring ${total} hp${rested ? `, resting ${fmtMinutes(rested)} between prayers` : ''}.` : 'No healing spells are memorized.', casts ? 'info' : 'warn');
    this._refreshStatus();
  }

  async exitCamp() {
    if (this.busy || this._exiting) return;
    // Breaking camp is one keypress away (Esc): ask first.
    this._exiting = true;
    const ok = await this.ctx.ui.dialog({ title: 'Break Camp', variant: 'blue', body: 'Pack up and move on?', buttons: [{ id: 'y', label: 'Break camp', primary: true }, { id: null, label: 'Stay' }] });
    this._exiting = false;
    if (ok === 'y') this.ctx.scenes.goto('explore', {});
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Behind a full-screen VIEW the campfire is only glimpsed: redraw it twice a second, not every frame. */
  render() {
    const t = this.ctx.clock.time;
    if (this.view && this._lastRender != null && Math.abs(t - this._lastRender) < 0.5) return;
    this._lastRender = t;
    super.render();
  }

  update(dt) {
    const t = this.ctx.clock.time;
    this.camp?.update(t);
    // Resting: the camera leans in over the bedrolls (eased; settled at once under a frozen clock).
    if (!this.ctx.debug?.raw?.campcam) {
      const want = this.busy ? 1 : 0;
      this._camK = this._camK == null || dt === 0 ? want : this._camK + (want - this._camK) * Math.min(1, dt * 2.5);
      const k = this._camK * this._camK * (3 - 2 * this._camK);
      this.camera.position.set(0, 1.75 + 0.75 * k, 5.2 - 1.2 * k);
      this.camera.lookAt(0, 0.95 - 0.5 * k, -0.6 - 0.9 * k);
    }
    const b = this.busy;
    if (b) {
      if (b.demo != null) this._advanceRest(b.demo);
      else {
        const p = dt === 0 ? 1 : Math.min(1, (t - b.start) / b.dur);
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        this._advanceRest(e);
        if (p >= 1) this._finishRest();
      }
    }
  }

  exit() {
    this.view?.close();
    this.busy?.panel?.remove();
    this.camp?.dispose();
    super.exit();
  }
}
