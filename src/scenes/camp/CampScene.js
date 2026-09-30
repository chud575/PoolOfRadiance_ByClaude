import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, clear, Frame, CommandBar, PartyRoster, MessageLog } from '../../ui/UI.js';
import { openCharacterView } from '../../ui/components/CharacterView.js';
import { castingClassesOf, fmtMinutes } from '../../ui/components/SpellPanel.js';
import { miniPortrait } from '../../ui/components/CharacterSheet.js';
import { deriveStats, isAlive } from '../../rules/character.js';
import { rest, partyMemorizationTime, restUntilHealedMinutes, autoPrepare, MINUTES_PER_DAY } from '../../rules/camp.js';
import { castSpell, isMemorized } from '../../rules/spells.js';
import { hasMap, getMap } from '../../data/maps/index.js';
import { SAVE_SLOTS } from '../../core/SaveManager.js';
import { buildCamp } from './CampBackdrop.js';

const CURES = ['cureSeriousWounds', 'cureLightWounds'];

/**
 * ENCAMP: SAVE VIEW MAGIC REST ALTER FIX EXIT over a campfire among Phlan's ruins.
 * params: {panel?: 'view'|'items'|'magic'|'save'|'rest'|'alter', member?: number}
 * Owned by the char-creation + party-UI workstream.
 */
export default class CampScene extends Scene {
  async enter(params = {}) {
    const { render, game } = this.ctx;
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
    this.hour = game.clock.hour + game.clock.minute / 60;
    this.camp = await buildCamp(s, { party: game.party, hour: this.hour, renderer: render.renderer });
  }

  _buildUI() {
    const { game } = this.ctx;
    // Title.
    this.topSub = h('div.s');
    this.ctx.ui.mount(h('div.camp-top', [h('div.t.por-gilt-text', ['Encamped']), this.topSub]));

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
    const { day, hour, minute } = game.clock;
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
        ...row('Healers', clerics.length ? `${clerics.length} ready` : 'none', 'Clerics with cure spells memorized.'),
        ...row('Party gold', `${gold.toLocaleString('en-US')} gp`),
      ]),
      h('div.camp-status', [
        h('button.por-btn.primary', { style: { gridColumn: 'span 2' }, onclick: () => (memo ? this.doRest(memo) : this.openRest()) }, [memo ? `Rest ${fmtMinutes(memo)}` : 'Rest…']),
        h('button.por-btn', { onclick: () => this.openView('spells') }, ['Magic']),
        h('button.por-btn', { onclick: () => this.fix() }, ['Fix']),
      ]),
      h('div.pc-rest-note', { style: { marginTop: '0.8em', fontSize: '0.78em' } }, ['Hotkeys: letters on the command line · ', h('span.por-hk-badge', ['[']), ' ', h('span.por-hk-badge', [']']), ' select member · ', h('span.por-hk-badge', ['Esc']), ' break camp']),
    );
  }

  _onAction(action) {
    if (this.busy || this.ctx.ui.layers.modal.children.length) return;
    const n = this.ctx.game.party.length;
    const g = this.ctx.game;
    const cmds = this.bar.commands;
    if (action === 'cancel') this.exitCamp();
    else if (action === 'view') this.openView('sheet');
    else if (action === 'nextMember' && n) { g.activeIndex = (g.activeIndex + 1) % n; g.notifyPartyChanged(); }
    else if (action === 'prevMember' && n) { g.activeIndex = (g.activeIndex + n - 1) % n; g.notifyPartyChanged(); }
    else if (action === 'turnRight' || action === 'turnLeft') {
      // Gamepad / arrows walk the command line.
      this.cmdIndex = (this.cmdIndex + (action === 'turnRight' ? 1 : cmds.length - 1)) % cmds.length;
      this.bar.el.querySelectorAll('.por-cmd')[this.cmdIndex]?.focus();
    }
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
      onClose: () => { this.view = null; this._refreshStatus(); },
      onRest: () => { this.view?.close(); this.doRest(partyMemorizationTime(this.ctx.game.party)); },
    });
  }

  _modal(title, content, { width = '34em' } = {}) {
    const f = Frame({ title, variant: 'blue', className: 'por-dialog' });
    f.el.style.maxWidth = width;
    f.el.style.width = width;
    const close = () => { back.remove(); window.removeEventListener('keydown', onKey, true); this._refreshStatus(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    };
    f.body.append(content, h('div.por-dialog-buttons', { style: { marginTop: '1em' } }, [h('button.por-btn', { onclick: close }, ['Close'])]));
    const back = h('div.por-modal-backdrop', [f.el]);
    window.addEventListener('keydown', onKey, true);
    this.ctx.ui.layers.modal.append(back);
    return { close, body: f.body };
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
      memo ? ['Until spells are memorized', memo] : null,
      heal > memo ? ['Until everyone is healed', heal] : null,
      ['Sleep the night (8 hours)', 480],
      ['Short rest (1 hour)', 60],
      ['Rest one full day', MINUTES_PER_DAY],
    ].filter(Boolean);
    const body = h('div', [
      h('p.pc-rest-note', ['Rest heals 1 hit point per full day and lets casters memorize their chosen spells. Sentries keep watch; the ruins are quiet tonight.']),
      h('div.camp-slots', opts.map(([label, min]) => h('button.camp-slot', { onclick: () => { m.close(); this.doRest(min); } }, [
        h('span.id', ['☾']), h('span', [h('div', [label])]), h('span.dt', [fmtMinutes(min) || '—']),
      ]))),
    ]);
    const m = this._modal('Rest', body);
  }

  /** Rest `minutes` with a short time-lapse (fade, clock spin), then report. */
  doRest(minutes) {
    if (!minutes || this.busy) return;
    const { game, ui } = this.ctx;
    const party = game.party;
    const report = rest(party, minutes, { rng: this.ctx.rng });
    const from = game.minutes;
    game.advanceTime(minutes);
    const names = Object.fromEntries(party.map((c) => [c.id, c.name]));
    const lines = [];
    for (const [id, n] of Object.entries(report.healed)) lines.push(`${names[id]} heals ${n} hp.`);
    for (const [id, ids] of Object.entries(report.memorized)) lines.push(`${names[id]} memorizes ${ids.length} spell${ids.length === 1 ? '' : 's'}.`);
    for (const id of report.died) lines.push(`${names[id]} succumbs to poison.`);
    ui.message(`The party rests for ${fmtMinutes(minutes)}.`, 'info');
    for (const l of lines) ui.message(l, 'system');
    // Time-lapse overlay.
    const clock = h('div', { style: { fontFamily: 'var(--font-num)', fontSize: '2.6em', color: '#fff', letterSpacing: '0.08em', textShadow: '0 0 20px rgba(245,217,139,0.4)' } });
    const veil = h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at center, rgba(2,3,10,0.72), rgba(0,0,0,0.94))', opacity: '0', transition: 'opacity 0.35s ease', pointerEvents: 'none' } }, [
      h('div', { style: { textAlign: 'center' } }, [h('div.por-gilt-text', { style: { fontSize: '1.6em', letterSpacing: '0.35em', textTransform: 'uppercase' } }, ['Resting']), clock]),
    ]);
    this.ctx.ui.layers.toast.append(veil);
    requestAnimationFrame(() => { veil.style.opacity = '1'; });
    const busy = (this.busy = { veil, clock, from, to: from + minutes, start: this.ctx.clock.time, dur: Math.min(2.2, 0.8 + minutes / 600) });
    // Wall-clock fallback: never leave the party stuck resting if frames stall (hidden tab).
    setTimeout(() => { if (this.busy === busy) this._finishRest(); }, busy.dur * 1000 + 600);
    game.notifyPartyChanged();
  }

  _finishRest() {
    const b = this.busy;
    if (!b) return;
    this.busy = null;
    b.veil.style.opacity = '0';
    setTimeout(() => b.veil.remove(), 400);
    // New hour → rebuild the sky/light if day and night have turned.
    const g = this.ctx.game;
    const hour = g.clock.hour + g.clock.minute / 60;
    const night = (x) => x < 6 || x >= 19;
    if (night(hour) !== night(this.hour)) this._rebuild3d();
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

  exitCamp() {
    if (this.busy) return;
    this.ctx.scenes.goto('explore', {});
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    const t = this.ctx.clock.time;
    this.camp?.update(t);
    if (this.busy) {
      const b = this.busy;
      const p = dt === 0 ? 1 : Math.min(1, (t - b.start) / b.dur);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const m = Math.round(b.from + (b.to - b.from) * e);
      const day = Math.floor(m / MINUTES_PER_DAY) + 1;
      b.clock.textContent = `Day ${day} · ${String(Math.floor((m % MINUTES_PER_DAY) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      if (p >= 1) this._finishRest();
    }
  }

  exit() {
    this.view?.close();
    this.busy?.veil?.remove();
    this.camp?.dispose();
    super.exit();
  }
}
