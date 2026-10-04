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
import { buildCamp, prefetchCamp } from './CampBackdrop.js';
import { precompilePortrait } from '../../ui/components/portraitGL.js';
import { useRenderer } from '../../ui/components/Miniature.js';
import { UINav } from '../../ui/components/uiNav.js';
import { setPortraitSync, portraitsPending } from '../../ui/components/lazyPortrait.js';
import { prepaintParty, portraitURL } from '../../ui/components/portraitPainter.js';
import { restAmbush } from '../../data/wandering.js';

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
    void prefetchCamp().catch(() => {});
    // The portrait painter's shaders build in the driver while the set is made.
    precompilePortrait(render.renderer);
    if (!this.ctx.debug?.frozen) prepaintParty(game.party);
    this.params = params;
    // Casters with no chosen spells get a sensible load-out (they can change it in MAGIC).
    for (const ch of game.party) if (castingClassesOf(ch).length && !Object.values(ch.spells?.prepared ?? {}).some((l) => l.length)) autoPrepare(ch);

    await this._build3d();
    if (this.ctx.debug?.frozen && !params.panel) {
      // Screenshots: paint the roster's faces now, then let the driver build the set's shaders.
      for (const ch of game.party) try { portraitURL(ch, 0.28); } catch { /* placeholder */ }
    }
    const fullPanel = ['view', 'items', 'magic'].includes(params.panel) && !params.sleep;
    if (!(this.ctx.debug?.frozen && fullPanel)) {
      try { render.renderer.compile(this.scene3d, this.camera); } catch { /* compiled on first draw */ }
    }
    this.post = { bloomStrength: 0.7, bloomThreshold: 0.9, vignette: 0.62, exposure: 1.0 };
    this._buildUI();
    this.listen('input:action', ({ action }) => { this._settled = 0; this._onAction(action); });
    this.listen('time:changed', () => { this._settled = 0; this._refreshStatus(); });
    this.listen('party:changed', () => { this._settled = 0; this._refreshStatus(); });
    const wake = () => { this._settled = 0; };
    window.addEventListener('pointerdown', wake, true);
    this.own(() => window.removeEventListener('pointerdown', wake, true));
    this.ctx.audio?.playMusic?.('camp');
    if (!params.sleep) this.ctx.ui.message('The party makes camp among the ruins. Sentries are posted.', 'lore');
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
    // A still of a full-screen panel (gallery/debug) never shows the campfire behind it: the set is
    // built only when the panel closes, so the shot spends nothing on it.
    if (this.ctx.debug?.frozen && fullPanel) { this._campPending = true; return; }
    this.camp = await buildCamp(s, { party: game.party, hour: this.hour, renderer: render.renderer, resting: !!this.params.sleep, deferParty: fullPanel });
  }

  /** Build the deferred campfire set (after a frozen full-panel still's panel closes). */
  async _ensureCamp() {
    if (!this._campPending) return;
    this._campPending = false;
    this.params = { ...this.params, panel: null };
    const { render, game } = this.ctx;
    this.camp = await buildCamp(this.scene3d, { party: game.party, hour: this.hour, renderer: render.renderer, resting: false });
    this._settled = 0;
  }

  _buildUI() {
    const { game } = this.ctx;
    // Title.
    this.topSub = h('div.s');
    this.topTitle = h('div.t.por-gilt-text', ['Encamped']);
    this.ctx.ui.mount(h('div.camp-top', [this.topTitle, this.topSub]));

    // Left: camp status.
    this.statusBody = h('div');
    const sf = Frame({ title: 'Camp', variant: 'blue', className: 'pc-iron', children: [this.statusBody] });
    sf.el.classList.add('camp-menu');
    this.ctx.ui.mount(sf.el);

    // Right: party.
    this.roster = new PartyRoster(this.ctx, { portraits: true, onOpen: (i) => this.openView('sheet', i) });
    const rf = Frame({ title: 'Party', className: 'pc-iron', children: [this.roster.el] });
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
        ...row('Memorize', this._memoText(memo), 'Rest the casters need to memorize their chosen spells (1e: sleep, then 15 minutes per spell level).'),
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
    if (this._alarm) return;
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
      onClose: () => { this.view = null; this.camp?.ensureParty?.(); void this._ensureCamp(); this._refreshStatus(); },
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
      if (debug?.nosave && mode === 'save') body.append(h('p.pc-rest-note', ['Saving is off in debug/screenshot mode: the slots below are shown but not written.']));
      body.append(h('div.camp-slots', SAVE_SLOTS.filter((s) => mode === 'load' || s !== 'auto').map((slot) => {
        const r = list.get(slot);
        return h(`button.camp-slot${r ? '' : '.empty'}`, {
          disabled: mode === 'load' && !r,
          onclick: async () => {
            if (mode === 'save') {
              // the note above says saving is off in debug/screenshot runs; the slots agree
              if (debug?.nosave) { ui.toast(`Not saved: saving is off in debug/screenshot mode (slot ${slot} untouched)`); return; }
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
      // wandering monsters may find the camp (world content: data/wandering.js), rolled once at bedtime
      ambush: o.demo == null ? restAmbush(this.ctx.rng, game.location?.map, minutes) : null,
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
    let ambush = null;
    if (b.ambush && b.demo == null && p * b.total >= b.ambush.at) { p = b.ambush.at / b.total; ambush = b.ambush; b.ambush = null; }
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
    if (ambush) {
      b.interrupted = true;
      this._ambushed(ambush, b);
    }
  }

  /** The MEMORIZE row: while resting it counts down with the rest (also in the frozen gallery state). */
  _memoText(memo = partyMemorizationTime(this.ctx.game.party)) {
    const b = this.busy;
    // A live rest applies study as it goes (memo already shrinks); the demo state only shows it.
    const left = b && b.demo != null ? Math.max(0, memo - b.applied) : memo;
    if (!b) return memo ? fmtMinutes(memo) : 'done';
    const total = b.demo != null ? memo : left + b.applied;
    const pct = total ? Math.round((1 - left / total) * 100) : 100;
    return left ? `${fmtMinutes(left)} left · ${pct}%` : 'done';
  }

  /** Header + TIME and MEMORIZE rows only (cheap; called every rest frame). */
  _refreshClock() {
    const b = this.busy;
    const mins = b ? b.from + b.applied : this.ctx.game.minutes;
    const hh = String(Math.floor((mins % MINUTES_PER_DAY) / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const loc = this.ctx.game.location?.map;
    const where = loc && hasMap(loc) ? getMap(loc).name ?? loc : 'Phlan';
    if (this.topSub) this.topSub.textContent = `${where} · Day ${Math.floor(mins / MINUTES_PER_DAY) + 1}, ${hh}:${mm}`;
    const vals = this.statusBody?.querySelectorAll('.pc-kv > .v');
    if (vals?.[0]) vals[0].textContent = `${hh}:${mm}`;
    if (vals?.[2] && b) vals[2].textContent = this._memoText();
  }

  /**
   * Wandering monsters find the camp: the rest card goes at once, the Gold Box alarm is posted
   * across the screen, the camera draws back to the whole camp (never a snap to the bedrolls), and
   * only then does the encounter begin.
   */
  _ambushed(ambush, b) {
    b.panel.remove();
    this._finishRest({ quiet: true });
    this._alarm = true;
    // A hard cut to the whole camp (the alarm is a jolt), never a slow pan across the waking party.
    this._camK = 0;
    this.topTitle && (this.topTitle.textContent = 'Alarm!');
    this.bar?.el.classList.add('dim');
    if (this.bar) this.bar.el.style.pointerEvents = 'none';
    // the camp panel's REST / MAGIC / FIX are dead too: there is no resting now
    for (const b of this.statusBody?.querySelectorAll('button') ?? []) b.disabled = true;
    const banner = h('div.camp-alarm', [
      h('div.t.por-gilt-text', ['Your rest is interrupted!']),
      h('div.s', [`${this._sentry()?.name ?? 'The watch'} cries out after ${fmtMinutes(b.applied) || 'a moment'} — something is in the camp.`]),
    ]);
    this.ctx.ui.mount(banner);
    this.ctx.ui.message(`Your rest is interrupted after ${fmtMinutes(b.applied) || 'a moment'}! The watch cries out.`, 'warn');
    this.ctx.audio?.stinger?.('danger');
    const go = () => {
      if (this._gone) return;
      banner.remove();
      this.ctx.scenes.goto('dialogue', { encounter: ambush.ref });
    };
    // (long enough to read; &alarmhold=1 holds it for inspection)
    setTimeout(go, this.ctx.debug?.raw?.alarmhold ? 6e5 : this.ctx.debug?.frozen ? 0 : 2400);
  }

  interruptRest() {
    if (!this.busy || this.busy.demo != null || this._alarm) return;
    this.busy.interrupted = true;
    this._finishRest();
  }

  _finishRest({ quiet = false } = {}) {
    const b = this.busy;
    if (!b) return;
    this.busy = null;
    this._restEndedAt = this.ctx.clock.time;
    const { game, ui } = this.ctx;
    const names = Object.fromEntries(game.party.map((c) => [c.id, c.name]));
    if (!quiet) ui.message(b.interrupted ? `Rest interrupted after ${fmtMinutes(b.applied) || 'a moment'}.` : `The party rests for ${fmtMinutes(b.applied)}.`, b.interrupted ? 'warn' : 'info');
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

  /**
   * Behind a full-screen VIEW the campfire is only glimpsed: redraw it twice a second, not every
   * frame. The same while a dialog is up or portraits are still being painted, and whenever a
   * frame has proved expensive (software GL), so the 3D pass gives the panels the frame budget.
   */
  render() {
    const t = this.ctx.clock.time;
    // Frozen clock (screenshots): once settled the frame cannot change, so present it only now and
    // then (a canvas that never presents can come back blank from a headless capture). On a
    // software GPU one camp frame costs seconds; redrawing it every tick starves the capture.
    if (this.ctx.debug?.frozen) {
      const sm = this.ctx.render.renderer.shadowMap;
      if ((this._settled ?? 0) >= 1) sm.autoUpdate = false;
      else if (!sm.autoUpdate) sm.needsUpdate = true;
      if ((this._settled ?? 0) >= 1 && !this._dirty) {
        this._idleFrames = (this._idleFrames ?? 0) + 1;
        if (this._idleFrames % 240 !== 0) return;
      }
      this._dirty = false;
      // A full-screen VIEW hides the campfire entirely: draw only the night behind its margins.
      if (this.view?.full) {
        const r = this.ctx.render.renderer;
        r.setRenderTarget(null);
        r.setClearColor(0x05070d, 1);
        r.clear();
        this._settled = (this._settled ?? 0) + 1;
        return;
      }
      super.render();
      this._settled = (this._settled ?? 0) + 1;
      return;
    }
    if (this.view && this._lastRender != null && Math.abs(t - this._lastRender) < 0.5) return;
    if (!this.ctx.debug?.frozen && this._lastWall != null) {
      const now = performance.now();
      const modal = this.ctx.ui.layers.modal.children.length > 0;
      const gap = this._slow && portraitsPending() ? 6000 : modal || portraitsPending() ? 500 : this._slow ? 120 : 0;
      if (gap && now - this._lastWall < gap) return;
    }
    this._lastRender = t;
    const now = performance.now();
    // Three drawn frames in a row more than ~110 ms apart mark a slow GPU (software GL): cap the
    // campfire at ~8 fps from then on, so the DOM panels and dialogs stay responsive.
    if (this._lastWall != null) this._slowRun = now - this._lastWall > 110 ? (this._slowRun ?? 0) + 1 : 0;
    this._slow = this._slow || (this._slowRun ?? 0) >= 3;
    // A software GPU redraws the shadow maps only every fourth frame (the hall barely moves).
    const sm = this.ctx.render.renderer.shadowMap;
    if (this._slow && !this.ctx.debug?.frozen) {
      sm.autoUpdate = false;
      this._shadowTick = ((this._shadowTick ?? 0) + 1) % 4;
      if (this._shadowTick === 1) sm.needsUpdate = true;
    }
    super.render();
    this._lastWall = now;
  }

  update(dt) {
    const t = this.ctx.clock.time;
    this.camp?.update(t, this.camera);
    // Resting: the camera leans in over the bedrolls (eased; settled at once under a frozen clock).
    if (!this.ctx.debug?.raw?.campcam) {
      const want = this.busy ? 1 : 0;
      // (an alarm draws the camera back to the whole camp briskly, before the encounter)
      this._camK = this._camK == null || dt === 0 ? want : this._camK + (want - this._camK) * Math.min(1, dt * (this._alarm ? 4 : 2.5));
      const k = this._camK * this._camK * (3 - 2 * this._camK);
      // Resting: down at sleeping height beside the embers, so the sleepers lie in profile across the
      // view (head on the rolled cloak, shoulder, hip and knee under the wool) and the sentry stands
      // against the night beyond them.
      // (from the fire's side, across the bedrolls: the nearest sleeper's head on its pillow in the
      // foreground, the others beyond the embers, the sentry against the night)
      // (framed so the fire, the sentry and the sleepers make a triangle above the resting card:
      // high enough that the near bedroll is a corner of the picture, not a third of it)
      this.camera.position.set(-1.35 * k, 1.75 - 0.42 * k, 5.2 - 2.45 * k);
      this.camera.lookAt(-0.2 * k, 0.95 - 0.8 * k, -0.6 - 0.9 * k);
      // the camera low over the embers: bloom eased off so the fire keeps its flame shape
      if (this.post) { this.post.bloomStrength = 0.7 - 0.38 * k; this.post.bloomThreshold = 0.9 + 0.12 * k; }
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
    this._gone = true;
    this.ctx.render.renderer.shadowMap.autoUpdate = true;
    this.view?.close();
    this.busy?.panel?.remove();
    this.camp?.dispose();
    super.exit();
  }
}
