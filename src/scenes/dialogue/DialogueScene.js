import './dialogue.css';
import { Scene } from '../../core/Scene.js';
import { h, clear, Frame, CommandBar, PartyRoster, MessageLog } from '../../ui/UI.js';
import { ENCOUNTERS, getEncounter } from '../../data/encounters.js';
import { MONSTERS } from '../../data/monsters.js';
import { DIALOGUES } from '../../data/dialogue.js';
import { NPCS } from '../../data/npcs.js';
import { DEITIES } from '../../data/shops.js';
import { JOURNAL, getJournalEntry } from '../../data/journal.js';
import { QUEST_LIST, QUESTS, PROCLAMATIONS, questStatus } from '../../data/quests.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { ITEMS } from '../../data/items.js';
import { addItem } from '../../rules/character.js';
import { paintPanel, paintNpcPortrait, framedPortraitURL, PanelOverlay, LIGHTS, npcActor, ghostActor } from '../../ui/art/index.js';
import { paintCreature, CREATURE_IDS, renderCreature, lightRig, flattenSprite } from '../../ui/art/creatures.js';
import { SETTING_IDS } from '../../ui/art/settings.js';
import { engravedPlate, pageTexture } from './journalArt.js';
import { apply, test, check, payRewards, spendGold, partyGold, living, addJournal, journalList } from './effects.js';

/**
 * Encounter / dialogue / journal screen.
 *
 * params:
 *   encounter  encounter id (monster encounter, or a scripted event via `dialogue`)
 *   script     dialogue script id (data/dialogue.js); `node` overrides the start node
 *   view       'journal' — the Adventurer's Journal (`entry` = selected entry, `tab` = 'quests')
 *   parley=1   (debug) open straight onto the PARLAY attitudes
 *   flags      (debug) comma list of game flags to set;  quests=id:status,...;  journal=1,2,3|all
 *
 * The painted panel shows the setting (and the monsters, for encounters); a
 * parchment box reveals the terse Gold Box prose with a typewriter; choices sit
 * on the classic command line with hotkeys. Combat victories started from here
 * are resolved by a small hook (see installVictoryHook) when the party returns.
 */
export default class DialogueScene extends Scene {
  async enter(params = {}) {
    const { ctx } = this;
    installVictoryHook(ctx);
    this.post = {};
    this._applyDebug(params);
    this.t0 = ctx.clock.time;
    this.reveal = { el: null, text: '', shown: 0, total: 0 };
    this.artKey = '';
    this.fade = null;
    this._buildDom();
    this.listen('input:action', ({ action }) => this._onAction(action));

    if (params.view === 'npcs') {
      clear(this.root);
      const grid = h('div', { style: { position: 'absolute', inset: '0', display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '6px', padding: '6px', background: '#222' } });
      for (const n of Object.values(NPCS)) grid.append(h('div', { style: { color: '#fff', font: '11px sans-serif' } }, [h('img', { src: framedPortraitURL(n), style: { width: '100%' } }), n.id]));
      this.root.append(grid);
      return;
    }
    if (params.view === 'portraits') {
      // debug: raw portrait canvases at 2x, side by side
      clear(this.root);
      const ids = (params.ids ?? 'clerk,priest_tyr,smith').split(',');
      const grid = h('div', { style: { position: 'absolute', inset: '0', display: 'flex', gap: '8px', padding: '8px', background: '#222', alignItems: 'flex-start' } });
      for (const id of ids) {
        if (!NPCS[id]) continue;
        const t0 = performance.now();
        const c = paintNpcPortrait(NPCS[id], Number(params.scale ?? 2));
        c.style.width = `${Math.floor(1580 / ids.length) - 8}px`;
        grid.append(h('div', { style: { color: '#fff', font: '12px sans-serif' } }, [c, h('div', {}, `${id} ${Math.round(performance.now() - t0)} ms`)]));
      }
      this.root.append(grid);
      return;
    }
    if (['bestiary', 'settings', 'figure', 'panel', 'cast'].includes(params.view)) {
      this._debugSheet(params.view, params);
      return;
    }
    if (params.view === 'journal') {
      this.returnTo = params.returnTo ?? null;
      await this._showArt({ setting: 'library', light: 'dim' }, 'The Adventurer\'s Journal');
      this.openJournal({ entry: Number(params.entry) || null, tab: params.tab, standalone: true });
      this.ctx.audio.playMusic?.('town');
      await this._decoded();
      return;
    }
    const encId = params.encounter ?? (params.script ? null : 'kobolds_1');
    this.encounter = encId ? getEncounter(encId) : null;
    this.eventId = this._findEventId(encId);
    const scriptId = params.script ?? this.encounter?.dialogue;
    if (scriptId) {
      this.script = DIALOGUES[scriptId];
      if (!this.script) throw new Error(`Unknown dialogue "${scriptId}"`);
      await this.gotoNode(params.node ?? this.script.start, { initial: true });
      ctx.audio.playMusic?.(this.script.id.startsWith('go_') ? 'explore' : 'town');
    } else {
      await this.encounterIntro({ parley: params.parley === '1' || params.parley === 1 });
      if (params.beat) await this._beat(params.beat); // (debug) a story beat: hostile | calm | flee
      ctx.audio.playMusic?.('encounter');
    }
    await this._decoded();
  }

  /** Wait for every image in the screen to decode (deterministic first frame). */
  _decoded() {
    return Promise.all([...this.root.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {})));
  }

  // ------------------------------------------------------------------ debug
  /** Debug contact sheets: every creature, or every setting (view=bestiary|settings). */
  _debugSheet(view, p) {
    clear(this.root);
    const grid = h('div', { style: { position: 'absolute', inset: '0', display: 'grid', gridTemplateColumns: view === 'bestiary' ? 'repeat(8, 1fr)' : 'repeat(6, 1fr)', gap: '4px', padding: '4px', background: '#222', overflow: 'hidden' } });
    if (view === 'panel') {
      // one panel full-size (debug): setting, light, monsters=id:n,..., actor=npcId
      const monsters = p.monsters ? String(p.monsters).split(',').map((m) => { const [id, n] = m.split(':'); return { id, count: Number(n ?? 1) }; }) : null;
      const npc = p.actor ? NPCS[p.actor] : null;
      const actor = npc ? (npc.kind === 'ghost' ? ghostActor() : npcActor(npc)) : null;
      const { canvas } = paintPanel({ setting: p.setting ?? 'slums', light: p.light, monsters, actor, deity: p.deity ? DEITIES[p.deity] : undefined, w: 1600, h: 750, seed: Number(p.pseed ?? 0) || undefined });
      canvas.style.width = '100%';
      grid.style.gridTemplateColumns = '1fr';
      grid.append(canvas);
    } else if (view === 'cast') {
      // continuity strip (debug): each named NPC's scene figure beside its conversation portrait,
      // both dressed from the one record in data/npcs.js, under the light of the NPC's own setting
      const ids = String(p.ids ?? 'priest_tyr,trainer,clerk,priestess_sune').split(',');
      grid.style.gridTemplateColumns = `repeat(${ids.length}, 1fr)`;
      grid.style.background = 'radial-gradient(ellipse at 50% 30%, #2a2430, #0c0a0e)';
      const lightOf = { priest_tyr: 'sanctum', priestess_sune: 'sanctum', clerk: 'sanctum', smith: 'fire', trainer: 'day', barkeep: 'torch' };
      for (const id of ids) {
        const npc = NPCS[id];
        if (!npc) continue;
        const FH = Number(p.h ?? 420);
        const c = h('canvas', { width: Math.round(FH * 0.6), height: Math.round(FH * 1.16), style: { width: '100%', display: 'block' } });
        const g = c.getContext('2d');
        const cx = c.width / 2; const fy = FH * 1.11;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath(); g.ellipse(cx, fy + 2, FH * 0.17, FH * 0.02, 0, 0, Math.PI * 2); g.fill();
        const r = npcActor(npc).render({ h: FH, yaw: 0.2, ss: 1.25 }, lightRig(LIGHTS[lightOf[id] ?? 'torch']));
        if (r) g.drawImage(r.canvas, cx - r.ox, fy - r.oy);
        c.style.width = '56%';
        grid.append(h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', color: '#e8dcc0', font: '600 15px serif', letterSpacing: '0.12em', textTransform: 'uppercase' } }, [
          h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '4px', width: '100%' } }, [c, h('img', { src: framedPortraitURL(npc), alt: '', style: { width: '42%', display: 'block' } })]), npc.name,
        ]));
      }
    } else if (view === 'figure') {
      // one or more large figures (debug): ids, seeds, h, yaw
      const ids = String(p.ids ?? 'kobold').split(',');
      const H = Number(p.h ?? 800);
      grid.style.gridTemplateColumns = `repeat(${ids.length}, 1fr)`;
      ids.forEach((id, i) => {
        const c = h('canvas', { width: 900, height: 880, style: { width: '100%', background: 'linear-gradient(#3a3a46,#15151c)' } });
        const g = c.getContext('2d');
        const rg = lightRig(LIGHTS[p.light ?? 'torch']);
        const f = NPCS[id] ? (() => { const a = NPCS[id].kind === 'ghost' ? ghostActor() : npcActor(NPCS[id]); const r = a.render({ h: H, pose: p.pose ?? 'stand', yaw: Number(p.yaw ?? 0.2) }, rg); return { canvas: r.canvas, ox: r.ox, oy: r.oy }; })()
          : flattenSprite(renderCreature(id, H, rg, Number(p.seed ?? 1) + i, { ...(p.yaw != null ? { yaw: Number(p.yaw) } : {}), ...(p.pitch != null ? { pitch: Number(p.pitch) } : {}), ...(p.override ? { poseOverride: JSON.parse(p.override) } : {}) }));
        g.drawImage(f.canvas, 450 - f.ox, 860 - f.oy + H * Number(p.crop ?? 0));
        grid.append(c);
      });
    } else if (view === 'bestiary') {
      const ids = (p.ids ? String(p.ids).split(',') : CREATURE_IDS);
      for (const id of ids) {
        const c = h('canvas', { width: 200, height: 290, style: { width: '100%', background: 'linear-gradient(#3a3a46,#15151c)' } });
        const g = c.getContext('2d');
        const f = paintCreature(id, id === 'tyranthraxus' ? 110 : 230, LIGHTS[p.light ?? 'dusk'], 3);
        g.drawImage(f.canvas, 100 - f.ox, 280 - f.oy);
        g.fillStyle = '#fff';
        g.font = '14px sans-serif';
        g.fillText(id, 6, 16);
        grid.append(c);
      }
    } else {
      for (const id of (p.ids ? String(p.ids).split(',') : SETTING_IDS)) {
        const { canvas } = paintPanel({ setting: id, w: 640, h: 300 });
        canvas.style.width = '100%';
        grid.append(h('div', { style: { color: '#fff', font: '12px sans-serif' } }, [canvas, id]));
      }
    }
    this.root.append(grid);
  }

  _applyDebug(p) {
    const { game } = this.ctx;
    if (p.flags) for (const f of String(p.flags).split(',').filter(Boolean)) game.flags[f] = true;
    if (p.quests) {
      const q = (game.flags.quests ??= {});
      for (const kv of String(p.quests).split(',')) {
        const [id, st] = kv.split(':');
        if (QUESTS[id]) q[id] = st ?? 'active';
      }
    }
    if (p.journal) {
      const nums = p.journal === 'all' ? JOURNAL.filter((j) => !j.false).map((j) => j.n) : String(p.journal).split(',').map(Number);
      for (const n of nums) addJournal(game, n);
      game.flags.journalUnread = nums.slice(-2);
    }
  }

  _findEventId(encId) {
    if (!encId) return null;
    const loc = this.ctx.game.location;
    if (!hasMap(loc.map)) return null;
    const m = getMap(loc.map);
    return m.eventsAt(loc.x, loc.y).find((e) => e.ref === encId)?.id ?? null;
  }

  // ------------------------------------------------------------------ DOM
  _buildDom() {
    const { ui } = this.ctx;
    this.bgCanvas = h('canvas', { width: 320, height: 150 });
    this.root = h('div.dlg-root');
    const bg = h('div.dlg-bg', [this.bgCanvas]);
    // painted panel
    this.artView = h('div.dlg-art-view');
    this.artSub = h('div.dlg-art-sub');
    this.artFrame = Frame({ title: ' ', variant: 'dark', className: 'dlg-art', children: [this.artView, this.artSub] });
    // parchment text
    this.portrait = h('div.dlg-portrait');
    this.speaker = h('div.dlg-speaker');
    this.prose = h('div.dlg-prose');
    this.chipRow = h('div');
    this.body = h('div.dlg-body', [this.speaker, this.prose, this.chipRow]);
    this.textFrame = Frame({ variant: 'parchment', className: 'dlg-text', children: [this.portrait, this.body] });
    this.main = h('div.dlg-main', [this.artFrame.el, this.textFrame.el]);
    // side
    this.roster = new PartyRoster(this.ctx);
    this.sideInfo = h('div');
    this.infoFrame = Frame({ title: 'Encounter', children: [this.sideInfo] });
    this.log = new MessageLog(this.ctx.bus, { lines: 6 });
    this.logFrame = Frame({ title: 'Chronicle', className: 'dlg-logframe', children: [this.log.el] });
    this.hints = h('div.dlg-hints', [
      h('span', [h('span.por-keycap', ['J']), 'Journal']),
      h('span', [h('span.por-keycap', ['Enter']), 'Skip text']),
    ]);
    this.questEl = h('div.dlg-quests');
    this.questFrame = Frame({ title: 'Journal', className: 'dlg-questframe', children: [this.questEl] });
    this.side = h('div.dlg-side', [Frame({ title: 'Party', children: [this.roster.el] }).el, this.infoFrame.el, this.questFrame.el, this.logFrame.el, this.hints]);
    this.listen('message', () => queueMicrotask(() => { this._renderQuests(); if (this.script) this._renderStatus(this.script); }));
    this.bar = new CommandBar([]);
    this.barWrap = h('div.por-hud-bottom.dlg-bar', [this.bar.el]);
    this.root.append(bg, this.main, this.side, this.barWrap);
    ui.mount(this.root);
    const { day, hour, minute } = this.ctx.game.clock;
    const loc = this.ctx.game.location;
    const where = hasMap(loc.map) ? getMap(loc.map).zoneAt(loc.x, loc.y) : 'Phlan';
    void where;
    this.log.push({ text: `Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`, kind: 'system' });
    this.own(() => {
      this.roster.dispose();
      this.log.dispose();
      this.bar.dispose();
      this.docEl?.remove();
    });
    this.textFrame.el.addEventListener('click', () => this.skipReveal());
    this._onKeyJ = (e) => {
      if (e.key === 'j' || e.key === 'J') {
        if (this.journalEl) this.closeJournal();
        else if (!this.bar.commands.some((c) => c.key?.toUpperCase() === 'J')) this.openJournal({});
      }
    };
    window.addEventListener('keydown', this._onKeyJ);
    this.own(() => window.removeEventListener('keydown', this._onKeyJ));
  }

  /** Paint (or reuse) the panel art and cross-fade it in. */
  async _showArt(spec, title, sub = '') {
    this.artFrame.title.textContent = title ?? ' ';
    this.artSub.textContent = sub;
    const key = JSON.stringify(spec);
    if (key === this.artKey) return;
    this.artKey = key;
    const npc = spec.actorId ? NPCS[spec.actorId] : null;
    // story beats re-pose the figures: spec.pose for the person spoken to, spec.mood for a war-band
    const actor = npc ? (npc.kind === 'ghost' ? ghostActor(spec.pose) : npcActor(npc, spec.pose ? { poseOverride: spec.pose } : {})) : null;
    // bake the speaker's portrait before the panel: its GL work is quick on an idle GPU
    // The painter leans on WebGL2 and Canvas 2D features that vary by browser; if it
    // fails, fall back to a plain backdrop so the encounter's text and choices still show.
    let painted;
    try {
      if (npc) framedPortraitURL(npc);
      painted = paintPanel({ ...spec, actor, w: 1280, h: 600 });
    } catch (e) {
      console.error('[dialogue] scene art failed; using a plain backdrop', e);
      painted = fallbackPanel(1280, 600, e);
    }
    const { canvas, info, composer } = painted;
    this.composer = composer;
    canvas.className = 'dlg-art-cur';
    const prev = this.artView.querySelector('.dlg-art-cur');
    for (const old of this.artView.querySelectorAll('.dlg-art-prev, .dlg-art-fx')) old.remove();
    if (prev) prev.className = 'dlg-art-prev';
    const fx = h('canvas.dlg-art-fx', { width: 1280, height: 600 });
    this.artView.append(canvas, fx);
    try {
      this.overlay = new PanelOverlay(fx, info, 3, composer);
    } catch (e) {
      console.error('[dialogue] scene art overlay failed', e);
      this.overlay = null;
      this.composer = null;
    }
    this.artCanvas = canvas;
    this.fade = { t0: this.ctx.clock.time, el: canvas, prev };
    // ambient background
    const bg = this.bgCanvas.getContext('2d');
    bg.drawImage(canvas, 0, 0, this.bgCanvas.width, this.bgCanvas.height);
    this._settleArt();
  }

  /** Draw the animated art layers; a browser that cannot run them keeps the still image. */
  _drawArt(t) {
    try {
      this.composer?.draw(this.artCanvas.getContext('2d'), t);
      this.overlay?.draw(t);
    } catch (e) {
      console.error('[dialogue] scene art animation failed; keeping the still image', e);
      this.composer = null;
      this.overlay = null;
    }
  }

  _settleArt() {
    this._renderQuests();
    if (this.ctx.clock.frozen && this.fade) {
      this.fade.el.style.opacity = '1';
      this.fade.prev?.remove();
      this.fade = null;
    }
    this._drawArt(this.ctx.clock.time);
  }

  _setSpeaker(npcId) {
    this.speakerId = npcId;
    clear(this.portrait);
    clear(this.speaker);
    const npc = npcId ? NPCS[npcId] : null;
    this.textFrame.el.classList.toggle('has-portrait', !!npc);
    this.portrait.style.display = npc ? '' : 'none';
    this.portrait.classList.toggle('ghost', npc?.kind === 'ghost');
    if (npc) {
      // an <img> (not a live canvas) keeps the text box on one raster layer
      try {
        this.portrait.append(h('img', { src: framedPortraitURL(npc), alt: npc.name, }));
      } catch (e) {
        console.error('[dialogue] speaker portrait failed', e);
      }
      this.speaker.append(npc.name, npc.title ? h('small', [npc.title]) : null);
    }
    this.speaker.style.display = npc ? '' : 'none';
  }

  /** Show prose with a typewriter reveal. paragraphs: string[]; extra: trailing nodes. */
  _setText(paragraphs, { journal = null, see = null } = {}) {
    const leader = this.ctx.game.activeCharacter?.name ?? 'the party';
    const text = paragraphs.map((p) => smartQuotes(p.replace(/\{leader\}/g, leader).replace(/\{gold\}/g, String(partyGold(this.ctx.game)))));
    clear(this.chipRow);
    if (journal) {
      const e = getJournalEntry(journal);
      const chip = h('div.dlg-journal-chip', { onclick: (ev) => { ev.stopPropagation(); this.openJournal({ entry: journal }); }, dataset: { tip: 'Read it in the Journal (J)' } }, [`Journal Entry ${journal}${e ? ` · ${e.title}` : ''}`]);
      this.chipRow.append(chip);
    }
    this.see = see;
    // pages are laid out once the choices (and their notes) have taken their room: see _paginate()
    this.pages = [text];
    this.pageIdx = 0;
    this._paginated = false;
    this._showPage(0);
  }

  /** Page long speeches the way the old game did: as many paragraphs as fit, then ▼ MORE. */
  _paginate() {
    this._paginated = true;
    const text = this.pages[0];
    if (this.pages.length !== 1 || text.length < 2 || !this._overflows()) return false;
    const pages = [];
    let cur = [];
    for (const t of text) {
      this._fillProse([...cur, t], null, pages.length > 0);
      this.prose.append(h('p.dlg-more', ['▼ more']));
      if (cur.length && this._overflows()) {
        pages.push(cur);
        cur = [t];
      } else cur.push(t);
    }
    if (cur.length) pages.push(cur);
    this.pages = pages;
    return pages.length > 1;
  }

  _overflows() {
    return this.prose.scrollHeight > this.prose.clientHeight + 2;
  }

  /** Lay out paragraphs in the prose box (first paragraph of a speech gets the drop cap). */
  _fillProse(text, see, cont = false) {
    clear(this.prose);
    const ps = text.map((t, i) => {
      const { lead, body } = i === 0 && !cont ? dropCap(t) : { lead: [], body: t };
      const shown = h('span');
      const hidden = h('span.dlg-hidden', [body]);
      this.prose.append(h(`p${lead.length ? '.dlg-capped' : ''}`, [...lead, shown, hidden]));
      return { shown, hidden, text: body };
    });
    if (see) this.prose.append(h('p.dlg-see', [see]));
    return ps;
  }

  _showPage(i) {
    this.pageIdx = i;
    const last = i >= this.pages.length - 1;
    const ps = this._fillProse(this.pages[i], last ? this.see : null, i > 0);
    if (!last) this.prose.append(h('p.dlg-more', [`▼ more · ${i + 1}/${this.pages.length}`]));
    this.reveal = { ps, shown: 0, total: ps.reduce((t, p) => t + p.text.length, 0) };
    this.prose.scrollTop = 0;
    if (this.ctx.clock.frozen) this.skipReveal();
    else this._renderReveal();
    if (i > 0) this._setChoices(this._pendingChoices ?? [], true);
  }

  _renderReveal() {
    let left = Math.floor(this.reveal.shown);
    for (const p of this.reveal.ps) {
      const n = Math.max(0, Math.min(p.text.length, left));
      p.shown.textContent = p.text.slice(0, n);
      p.hidden.textContent = p.text.slice(n);
      left -= p.text.length;
    }
  }

  skipReveal() {
    this.reveal.shown = this.reveal.total;
    this._renderReveal();
  }

  _setChoices(choices, paging = false) {
    if (!paging) this._pendingChoices = choices;
    this._buildChoices(choices);
    // a speech too long for the parchment is paged; while pages remain the only command is MORE
    if (!this._paginated && this._paginate()) this._showPage(0);
    if (this.pages && this.pageIdx < this.pages.length - 1) {
      this._buildChoices([{ label: 'More', key: 'M', quiet: true, run: () => this._showPage(this.pageIdx + 1) }]);
    }
  }

  _buildChoices(choices) {
    const used = new Set();
    const cmds = choices.map((c, i) => {
      let key = c.key;
      // a fixed key must be a letter the label shows (the command bar gilds it); otherwise take the
      // first free letter of the label, so the obvious key always works and is always drawn
      if (key && /[A-Z]/i.test(c.label) && !c.label.toUpperCase().includes(key.toUpperCase())) key = null;
      if (!key || used.has(key.toUpperCase())) key = [...c.label.toUpperCase()].find((ch) => /[A-Z]/.test(ch) && !used.has(ch)) ?? String(i + 1);
      used.add(key.toUpperCase());
      return { id: `c${i}`, label: c.label, key, disabled: !!c.disabled, tip: c.tip, onSelect: () => this._choose(c) };
    });
    this.bar.set(cmds);
    this.choices = choices;
    this.tipsEl?.remove();
    this.tipsEl = null;
    const tipped = cmds.filter((c) => c.tip);
    // a strip of tiles (the odds, the manners) already weighs every command: no hint line under it
    for (const t of this.chipRow?.querySelectorAll('.dlg-odd[data-choice]') ?? []) {
      t.onclick = () => { const c = choices.find((x) => x.label === t.dataset.choice); if (c && !c.disabled) this._choose(c); };
    }
    if (tipped.length >= 2 && !this.chipRow?.querySelector('.dlg-odds')) {
      // the choices live on the command bar alone; the parchment carries one quiet line that
      // names the manner of the command under the pointer (or keyboard focus)
      const idle = () => [h('span.dlg-hint-k', ['Your manner']), h('span', [`${tipped.map((c) => c.label).join(' · ')} — point at a command to weigh it.`])];
      this.tipsEl = h('div.dlg-hint', idle());
      const show = (c) => { clear(this.tipsEl); this.tipsEl.append(...(c ? [h('span.dlg-hint-k', [c.label]), h('span', [c.tip])] : idle())); };
      for (const b of this.bar.el.querySelectorAll('.por-cmd')) {
        const c = cmds.find((x) => x.id === b.dataset.cmd);
        if (!c?.tip) continue;
        b.addEventListener('mouseenter', () => show(c));
        b.addEventListener('focus', () => show(c));
        b.addEventListener('mouseleave', () => show(null));
        b.addEventListener('blur', () => show(null));
      }
      this.body.append(this.tipsEl);
    }
  }

  _choose(c) {
    if (this.busy) return;
    this.skipReveal();
    this.ctx.audio.sfx?.('click');
    if (c.label && !/^(Continue|Back|Leave)$/.test(c.label) && !c.quiet) this.ctx.ui.message(`» ${c.label}`, 'system');
    c.run?.();
  }

  _onAction(action) {
    if (this.journalEl) {
      if (action === 'cancel') this.closeJournal();
      return;
    }
    if (action === 'confirm') {
      if (this.reveal.shown < this.reveal.total) this.skipReveal();
      else if (this.choices?.length === 1) this._choose(this.choices[0]);
    } else if (action === 'cancel') {
      const leave = this.choices?.find((c) => c.isLeave);
      if (leave) this._choose(leave);
    }
  }

  // ------------------------------------------------------------------ side info
  /** Active commissions and the latest journal entries (click to open the Journal). */
  _renderQuests() {
    const { game } = this.ctx;
    if (!this.questEl) return;
    clear(this.questEl);
    const active = QUEST_LIST.filter((q) => ['active', 'done'].includes(questStatus(game.flags, q.id)));
    for (const q of active.slice(0, 2)) {
      const st = questStatus(game.flags, q.id);
      this.questEl.append(h('div.dlg-q', { dataset: { tip: q.summary } }, [h('i.dlg-q-mark' + (st === 'done' ? '.done' : '')), h('span', [q.title]), h('em', [st === 'done' ? 'report' : 'active'])]));
    }
    const recent = journalList(game).slice(-2).reverse();
    const unread = new Set(game.flags.journalUnread ?? []);
    for (const n of recent) {
      const e = getJournalEntry(n);
      if (!e) continue;
      this.questEl.append(h('div.dlg-j' + (unread.has(n) ? '.unread' : ''), { onclick: () => this.openJournal({ entry: n }), dataset: { tip: 'Open the Journal (J)' } }, [h('b', [String(n)]), h('span', [e.title])]));
    }
    if (!this.questEl.children.length) this.questEl.append(h('div.dlg-q.empty', ['No commissions yet — the Clerk at City Hall has work.']));
  }

  _sidePlace(title, text) {
    this.infoFrame.title.textContent = 'Location';
    clear(this.sideInfo);
    const loc = this.ctx.game.location;
    let zone = title;
    if (hasMap(loc.map) && (this.eventId || text === undefined)) {
      const m = getMap(loc.map);
      zone = m.zoneAt(loc.x, loc.y);
      text ??= m.name;
    }
    const head = zone ?? title;
    if (text && head && text.toLowerCase() === String(head).toLowerCase()) text = SETTING_WHERE[this.script?.art?.setting] ?? (hasMap(loc.map) ? getMap(loc.map).name : '');
    if (text && head && text.toLowerCase() === String(head).toLowerCase()) text = '';
    this.sideInfo.append(h('div.dlg-place', [h('b', [head]), text ?? '']));
    // a line on the person before you, from the sage's notes
    const npc = this.speakerId ? NPCS[this.speakerId] : null;
    if (npc?.desc) this.sideInfo.append(h('div.dlg-lore', [h('em', [npc.name]), npc.desc]));
  }

  _sideEncounter(enc) {
    this.infoFrame.title.textContent = 'Encounter';
    clear(this.sideInfo);
    const list = h('div.dlg-enc-list');
    let hd = 0;
    for (const g of enc.groups) {
      const m = MONSTERS[g.monster];
      const n = typeof g.count === 'number' ? g.count : 4;
      hd += Math.max(0.5, m.hd + (m.hpBonus ?? 0) / 4) * n;
      const icon = h('div.dlg-enc-icon');
      const c = h('canvas', { width: 96, height: 96 });
      try {
        const fig = paintCreature(g.monster, 200, LIGHTS.torch, 7, { ss: 1 }); // a 96 px icon: no supersampling needed
        const cg = c.getContext('2d');
        const big = ['giantRat', 'wolf', 'giantSpider', 'giantFrog', 'giantCentipede'].includes(g.monster);
        const s = big ? 0.42 : 0.9;
        cg.drawImage(fig.canvas, 48 - fig.ox * s, (big ? 88 : 140) - fig.oy * s, fig.canvas.width * s, fig.canvas.height * s);
      } catch (e) {
        console.error('[dialogue] creature icon failed', e);
      }
      icon.append(c);
      list.append(h('div.dlg-enc-row', { dataset: { tip: m.desc ?? m.name } }, [icon, h('div.dlg-enc-name', [n === 1 ? m.name : m.plural, h('small', [sizeWord(m)])]), h('div.dlg-enc-count', [String(n)])]));
    }
    const lv = living(this.ctx.game).reduce((t, c) => t + Math.max(...Object.values(c.levels)), 0) || 1;
    const ratio = hd / lv;
    const tier = ratio < 0.45 ? 0 : ratio < 0.9 ? 1 : ratio < 1.6 ? 2 : 3;
    const names = ['Easy', 'Fair', 'Hard', 'Deadly'];
    const cols = [['#3fae55', '#9df0a0'], ['#c8a030', '#ffe08a'], ['#d0702a', '#ffb070'], ['#b02020', '#ff6a5a']][tier];
    const pips = h('div.pips', Array.from({ length: 4 }, (_, i) => h(`i${i <= tier ? '.on' : ''}`)));
    const threat = h('div.dlg-threat', { style: { '--c1': cols[0], '--c2': cols[1] }, dataset: { tip: 'Estimated from the monsters\' hit dice against your party\'s levels.' } }, [h('span.lbl', ['Threat']), pips, h('span.val', { style: { color: cols[1] } }, [names[tier]])]);
    threat.style.setProperty('--c1', cols[0]);
    threat.style.setProperty('--c2', cols[1]);
    this.sideInfo.append(list, threat);
    // the sage's notes on the foe: a line of lore and the Gold Box stat line
    const lead = MONSTERS[enc.groups[0]?.monster];
    if (lead) {
      const hdTxt = lead.hd < 1 ? '½' : `${lead.hd}${lead.hpBonus ? (lead.hpBonus > 0 ? `+${lead.hpBonus}` : lead.hpBonus) : ''}`;
      const stats = [`AC ${lead.ac}`, `HD ${hdTxt}`, `Dmg ${(lead.attacks ?? []).join('/') || '—'}`, `MV ${lead.move}`];
      this.sideInfo.append(h('div.dlg-lore', [lead.desc ? lead.desc : `${lead.plural ?? lead.name} of the ruins.`, h('div.dlg-stats', stats.map((t) => h('span', [t])))]));
    }
  }

  // ------------------------------------------------------------------ scripts
  async gotoNode(id, { initial = false } = {}) {
    const s = this.script;
    let node = s.nodes[id];
    for (let guard = 0; node?.branch && guard < 8; guard++) {
      const b = node.branch.find((x) => test(this.ctx.game, x.if));
      if (!b) break;
      id = b.goto;
      node = s.nodes[id];
    }
    if (!node) return this.leave();
    this.nodeId = id;
    const art = { ...(s.art ?? {}), ...(node.art ?? {}) };
    const kind = art.npc ? NPCS[art.npc]?.kind : null;
    const figure = art.monster ?? (kind === 'dragon' ? 'tyranthraxus' : kind === 'monster' ? (art.npc === 'kobold_chief' ? 'koboldChief' : NPCS[art.npc].monster) : null);
    const monsters = figure ? [{ id: figure, count: art.monster ? art.count ?? 1 : 1 }] : null;
    if (kind === 'monster' && !art.monster) monsters.push({ id: NPCS[art.npc].monster, count: 2 });
    // the person you are speaking with stands in the picture
    const actorId = !art.monster && art.npc && (!kind || kind === 'portrait' || kind === 'hooded' || kind === 'ghost') ? art.npc : null;
    const spec = { setting: art.setting ?? 'slums', light: art.light, monsters, deity: art.deity, actorId, ...(art.pose ? { pose: art.pose } : {}), ...(art.mood ? { mood: art.mood } : {}) };
    await this._showArt(spec, s.title, s.subtitle ?? '');
    this._setSpeaker(node.speaker ?? null);
    if (initial && node.speaker && NPCS[node.speaker]) {
      const npc = NPCS[node.speaker];
      this.ctx.ui.message(`${s.title}: ${npc.name}${npc.title ? `, ${npc.title}` : ''}.`, 'lore');
    }
    if (node.journal && addJournal(this.ctx.game, node.journal)) this.ctx.ui.message(`Journal entry ${node.journal} recorded.`, 'lore');
    if (node.do) apply(this.ctx, node.do);
    const paras = [].concat(node.text ?? []);
    this._setText(paras, { journal: node.journal ?? node.do?.find((e) => e.journal)?.journal ?? null });
    this._sidePlace(s.title, this.eventId ? undefined : s.subtitle ?? s.title);
    this._renderStatus(s);
    this.docEl?.remove();
    this.docEl = null;
    if (node.panel) this._showPanel(node.panel);
    // choices
    const ch = [];
    for (const c of node.choices ?? []) {
      if (c.if && !test(this.ctx.game, c.if)) continue;
      // scripted parley stances carry the same notes as an encounter parley
      const stance = STANCE_TIPS[String(c.label).toLowerCase()];
      const parleyNode = (node.choices ?? []).some((o) => ['haughty', 'sly', 'nice', 'meek', 'abusive'].includes(String(o.label).toLowerCase()));
      ch.push({ label: c.label, key: c.key, tip: c.tip ?? (parleyNode ? stance : undefined), isLeave: !!c.end, run: () => this._runChoice(c) });
    }
    if (ch.length >= 3 && ch.filter((c) => STANCE_TIPS[String(c.label).toLowerCase()]).length >= 3) this.chipRow.append(this._stanceStrip(ch));
    if (node.next) ch.push({ label: 'Continue', key: 'C', run: () => this.gotoNode(node.next) });
    if (node.end) ch.push({ label: 'Leave', key: 'L', isLeave: true, run: () => this.leave() });
    if (!ch.length) ch.push({ label: 'Leave', key: 'L', isLeave: true, run: () => this.leave() });
    this._setChoices(ch);
    void initial;
  }

  /** A ledger line under the speech: the party's standing with the Council and the commission tally. */
  _renderStatus(s) {
    this.statusEl?.remove();
    this.statusEl = null;
    if (s.status !== 'council') return;
    const f = this.ctx.game.flags;
    const st = QUEST_LIST.map((q) => questStatus(f, q.id));
    const n = (k) => st.filter((x) => x === k).length;
    const proven = n('rewarded') + n('done');
    const standing = proven >= 7 ? 'Heroes of the Council' : proven >= 4 ? 'Champions of Phlan' : proven >= 2 ? 'Trusted by the Council' : proven >= 1 ? 'Known to the Clerk' : 'Newcomers to Phlan';
    const owed = QUEST_LIST.filter((q) => questStatus(f, q.id) === 'done').reduce((t, q) => t + q.reward.gold, 0);
    this.statusEl = h('div.dlg-status', [
      h('span.lbl', ['Standing']), h('span.v', [standing]),
      h('span.lbl', ['Commissions']), h('span.v', [`${n('rewarded')} paid · ${n('done')} to report · ${n('active')} in hand · ${n('offered')} open · ${n('locked')} sealed`]),
      owed ? h('span.v.owed', [`${owed.toLocaleString('en-US')} gp awaiting your REPORT`]) : null,
    ]);
    this.body.insertBefore(this.statusEl, this.tipsEl?.parentNode === this.body ? this.tipsEl : null);
  }

  _runChoice(c) {
    if (c.do) apply(this.ctx, c.do);
    if (c.check) {
      const r = check(this.ctx, c.check.stat, c.check.dc ?? 0);
      if (r.who) this.ctx.ui.message(`${r.who.name} tries${r.ok ? ' — and succeeds.' : ' — and fails.'}`, r.ok ? 'info' : 'warn');
      return this.gotoNode(r.ok ? c.check.pass : c.check.fail);
    }
    if (c.combat) return this.startCombat(c.combat, c.win, c.surprise);
    if (c.travel) return this.travel(c.travel);
    if (c.shop) return this.ctx.scenes.goto('shop', { shop: c.shop });
    if (c.goto) return this.gotoNode(c.goto);
    return this.leave();
  }

  // ------------------------------------------------------------------ encounters
  async encounterIntro({ parley = false } = {}) {
    const enc = this.encounter;
    if (!this._announced) {
      this._announced = true;
      this.ctx.ui.message(enc.options?.includes('parley') ? 'Something stirs in the shadows...' : 'Danger! The party is set upon.', 'warn');
      this.ctx.ui.message(`${enc.name}: ${enc.groups.map((gr) => `${gr.count} ${MONSTERS[gr.monster][gr.count === 1 ? 'name' : 'plural']}`).join(', ')}.`, 'combat');
    }
    const art = enc.art ?? {};
    this.encSpec = { setting: art.setting ?? 'slums', light: art.light, monsters: enc.groups.map((g) => ({ id: g.monster, count: typeof g.count === 'number' ? g.count : 4 })) };
    await this._showArt(this.encSpec, enc.name, this._zoneName());
    this._setSpeaker(null);
    this._sideEncounter(enc);
    if (parley) return this.parleyMenu();
    this._setText([enc.intro ?? `You encounter ${enc.name}.`], { see: youSee(enc) });
    this.chipRow.append(this._oddsStrip(enc));
    const labels = { combat: ['Combat', 'C'], wait: ['Wait', 'W'], flee: ['Flee', 'F'], parley: ['Parlay', 'P'] };
    const notes = {
      combat: 'Draw steel. The fight moves to the battle map.',
      wait: 'Hold your ground and see what they do.',
      flee: 'Fall back. The fleetest party gets away.',
      parley: 'Speak first. Choose your manner with care.',
    };
    this._setChoices((enc.options ?? ['combat', 'flee']).map((o) => ({ label: labels[o][0], key: labels[o][1], tip: notes[o], isLeave: false, run: () => this.encounterChoice(o) })));
  }

  /** The odds as a veteran would weigh them: one tile per command the encounter offers. */
  _oddsStrip(enc) {
    const opts = enc.options ?? ['combat', 'flee'];
    const theirs = enc.groups.reduce((t, g) => t + (typeof g.count === 'number' ? g.count : 4), 0);
    const ours = living(this.ctx.game).length;
    const morale = Math.min(...enc.groups.map((g) => MONSTERS[g.monster].morale ?? 50));
    const waitPct = Math.max(10, 70 - morale);
    const manners = ['haughty', 'sly', 'nice', 'meek', 'abusive'];
    const spare = manners.filter((a) => (enc.parley?.[a] ?? 'fight').split(':')[0] !== 'fight').length;
    const mood = morale < 40 ? 'skittish' : morale < 60 ? 'wary' : morale < 75 ? 'bold' : 'fearless';
    const tile = (k, big, small, tip, tone = '') => h(`div.dlg-odd${tone ? `.${tone}` : ''}`, { dataset: { tip, choice: k } }, [h('span.k', [k]), h('b', [big]), h('small', [small])]);
    const T = {
      combat: tile('Combat', `${theirs} to ${ours}`, `${mood} foes`, `${theirs} foes against your ${ours} standing. Their morale reads ${mood}.`, theirs > ours * 1.5 ? 'bad' : ''),
      wait: tile('Wait', `${waitPct}%`, 'they lose interest', `Hold your ground: about ${waitPct} in 100 that they slink away; otherwise they attack.`),
      flee: tile('Flee', '60%', 'you slip away', 'About 60 in 100 that the party gets clear; otherwise they run you down.'),
      parley: tile('Parlay', spare ? `${spare} of 5` : 'none', spare ? 'manners may spare blood' : 'they want blood', spare ? `Of the five manners (HAUGHTY, SLY, NICE, MEEK, ABUSIVE), ${spare} might end this without a fight. Which is for you to judge.` : 'No words will turn this band aside.', spare ? 'good' : 'bad'),
    };
    const tiles = opts.map((o) => T[o]).filter(Boolean);
    const el = h('div.dlg-odds', [h('span.dlg-odds-h', ['Weighing the odds']), ...tiles]);
    el.style.setProperty('--n', String(tiles.length));
    return el;
  }

  _zoneName() {
    const loc = this.ctx.game.location;
    return this.eventId && hasMap(loc.map) ? getMap(loc.map).zoneAt(loc.x, loc.y) : '';
  }

  encounterChoice(o) {
    const { rng } = this.ctx;
    const enc = this.encounter;
    if (o === 'combat') return this.startCombat(enc.id);
    if (o === 'flee') {
      if (rng.chance(60)) {
        this._unspend();
        this.ctx.ui.message('You escape into the ruins.', 'info');
        return this.ctx.scenes.goto('explore', {});
      }
      this._hostile();
      this._setText(['You turn to run — but they are faster. There is no escape!']);
      return this._setChoices([{ label: 'Combat', key: 'C', run: () => this.startCombat(enc.id) }]);
    }
    if (o === 'wait') {
      const morale = Math.min(...enc.groups.map((g) => MONSTERS[g.monster].morale ?? 50));
      if (rng.chance(Math.max(10, 70 - morale))) {
        this._beat('flee');
        this._setText(['Both sides regard each other warily. At last, muttering, they lose interest and slink away into the ruins.']);
        return this._setChoices([{ label: 'Continue', key: 'C', isLeave: true, run: () => this.leave() }]);
      }
      this._hostile();
      this._setText(['Both sides regard each other warily... then, with a howl, they attack!']);
      return this._setChoices([{ label: 'Combat', key: 'C', run: () => this.startCombat(enc.id) }]);
    }
    if (o === 'parley') return this.parleyMenu();
    return null;
  }

  /** Story beat: the war-band snarls and advances (re-posed figures cross-fade in). */
  _hostile() {
    return this._beat('hostile');
  }

  /**
   * Story beats re-stage the war-band: 'hostile' (weapons levelled, the band advances), 'calm'
   * (weapons lowered, they stand off), 'flee' (they scatter into the rubble: the street empties
   * but for a straggler running and a dropped spear).
   */
  _beat(mood) {
    if (!this.encSpec) return null;
    return this._showArt({ ...this.encSpec, mood }, this.encounter.name, this._zoneName());
  }

  parleyMenu() {
    const enc = this.encounter;
    this._setText([`How will ${this.ctx.game.activeCharacter?.name ?? 'the party'} address them?`], { see: youSee(enc) });
    this.chipRow.append(this._mannerStrip(enc));
    const tips = STANCE_TIPS;
    const att = ['haughty', 'sly', 'nice', 'meek', 'abusive'];
    this._setChoices([
      ...att.map((a) => ({ label: a[0].toUpperCase() + a.slice(1), key: a[0].toUpperCase(), tip: tips[a], quiet: true, run: () => this.parley(a) })),
      { label: 'Back', key: 'B', run: () => this.encounterIntro() },
    ]);
  }

  /**
   * The five manners as a veteran reads this band: what each is likely to buy (the outcome is
   * the encounter's own, phrased as a judgement, never a promise of the dice).
   */
  _mannerStrip(enc) {
    const READ = {
      fight: ['they attack', 'Words will only anger them.', 'bad'],
      flee: ['likely flee', 'They look ready to bolt.', 'good'],
      leave: ['may let you pass', 'They have no wish to bleed tonight.', 'good'],
      bribe: ['a toll', 'They will want paying.', ''],
      talk: ['will talk', 'Someone among them wants to be heard.', 'good'],
    };
    const tiles = ['haughty', 'sly', 'nice', 'meek', 'abusive'].map((a) => {
      const [kind, arg] = (enc.parley?.[a] ?? 'fight').split(':');
      const [big, small, tone] = READ[kind] ?? READ.fight;
      const label = a[0].toUpperCase() + a.slice(1);
      return h(`div.dlg-odd.manner${tone ? `.${tone}` : ''}`, { dataset: { choice: label, tip: `${STANCE_TIPS[a]} ${small}${kind === 'bribe' ? ` (${arg} gp)` : ''}` } }, [h('span.k', [label]), h('b', [kind === 'bribe' ? `${arg} gp toll` : big]), h('small', [STANCE_TIPS[a].split('.')[0]])]);
    });
    const el = h('div.dlg-odds', [h('span.dlg-odds-h', ['Reading the band — what each manner is likely to buy']), ...tiles]);
    el.style.setProperty('--n', '5');
    return el;
  }

  /** Scripted stances (a ghost, a priest): each manner and what it signals, as tiles. */
  _stanceStrip(choices) {
    const tiles = choices.map((c) => {
      const k = String(c.label).toLowerCase();
      const tip = c.tip ?? STANCE_TIPS[k] ?? '';
      // a tile carries a terse head and note (whole on one line each); the tooltip has the full sentence
      const [head, note] = c.tip ? [c.tip.split('. ')[0].replace(/\.$/, ''), c.tip.split('. ').slice(1).join('. ')] : STANCE_TILE[k] ?? [tip, ''];
      return h('div.dlg-odd.manner', { dataset: { choice: c.label, tip } }, [h('span.k', [c.label]), h('b', [head]), h('small', [note || ' '])]);
    });
    const el = h('div.dlg-odds.stances', [h('span.dlg-odds-h', ['Your manner — point or press its letter']), ...tiles]);
    el.style.setProperty('--n', String(tiles.length));
    return el;
  }

  parley(att) {
    const enc = this.encounter;
    const r = enc.parley?.[att] ?? 'fight';
    const [kind, arg] = r.split(':');
    const speaker = this.ctx.game.activeCharacter?.name ?? 'The party';
    this.ctx.ui.message(`${speaker} parleys: ${att.toUpperCase()}.`, 'system');
    const outcome = { fight: ['The parley fails — they attack!', 'warn'], leave: ['They let you pass.', 'info'], flee: ['They break and flee.', 'info'], bribe: [`They demand a toll of ${arg} gold.`, 'warn'], talk: ['They will talk.', 'lore'] }[kind];
    if (outcome) this.ctx.ui.message(outcome[0], outcome[1]);
    const who = enc.groups.length ? (enc.groups[0].count === 1 ? MONSTERS[enc.groups[0].monster].name : `The ${MONSTERS[enc.groups[0].monster].plural.toLowerCase()}`) : 'They';
    const line = enc.parleyText?.[kind] ?? enc.parleyText?.[att];
    if (kind === 'fight') {
      this._hostile();
      this._setText([line ?? `${who} snarl${who.startsWith('The') ? '' : 's'} with contempt. Your words have only made them angry.`]);
      return this._setChoices([{ label: 'Combat', key: 'C', run: () => this.startCombat(enc.id) }]);
    }
    if (kind === 'leave') {
      this._beat('calm');
      this._setText([line ?? `${who} exchange${who.startsWith('The') ? '' : 's'} glances, shrug, and let you pass. There will be other prey tonight.`]);
      return this._setChoices([{ label: 'Continue', key: 'C', isLeave: true, run: () => this.leave() }]);
    }
    if (kind === 'flee') {
      this._beat('flee');
      this._setText([line ?? `${who} decide${who.startsWith('The') ? '' : 's'} that you are more trouble than you are worth, and flee.`]);
      return this._setChoices([{ label: 'Continue', key: 'C', isLeave: true, run: () => this.leave() }]);
    }
    if (kind === 'bribe') {
      const gp = Number(arg);
      this._beat('calm');
      this._setText([line ?? `${who} consider${who.startsWith('The') ? '' : 's'} your words. "Pay the toll," the leader growls, "${gp} gold, and walk away."`]);
      return this._setChoices([
        { label: `Pay ${gp} gp`, key: 'P', disabled: partyGold(this.ctx.game) < gp, run: () => { spendGold(this.ctx.game, gp); this.ctx.game.notifyPartyChanged(); this.ctx.ui.message(`The party pays ${gp} gold pieces.`, 'warn'); this.leave(); } },
        { label: 'Refuse', key: 'R', run: () => this.startCombat(enc.id) },
      ]);
    }
    if (kind === 'talk') {
      this.script = DIALOGUES[arg];
      return this.gotoNode(this.script.start);
    }
    return null;
  }

  // ------------------------------------------------------------------ transitions
  startCombat(encId, win = null, surprise = null) {
    const { game } = this.ctx;
    const enc = ENCOUNTERS[encId];
    game.flags._pendingFight = {
      encounter: encId,
      eventId: this.eventId,
      xp: game.party.reduce((t, c) => t + Object.values(c.xp).reduce((a, b) => a + b, 0), 0),
      win: [...(win ?? []), ...(enc?.onWin ?? [])],
      items: enc?.treasure?.items ?? [],
    };
    this.busy = true;
    this.ctx.scenes.goto('combat', { encounter: encId, ...(surprise ? { surprise } : {}) });
  }

  travel(t) {
    const { game } = this.ctx;
    if (t.minutes) game.advanceTime(t.minutes);
    this.busy = true;
    game.setLocation({ map: t.map, x: t.x, y: t.y, dir: t.dir });
    this.ctx.scenes.goto('explore', { map: t.map, x: t.x, y: t.y, dir: t.dir });
  }

  _unspend() {
    if (this.eventId) delete this.ctx.game.spentEvents[this.eventId];
  }

  leave() {
    if (this.busy) return;
    this.busy = true;
    if (this.returnTo === 'pop') this.ctx.scenes.pop();
    else this.ctx.scenes.goto('explore', {});
  }

  // ------------------------------------------------------------------ City Hall boards
  _showPanel(kind) {
    const { game } = this.ctx;
    const view = this.artView.parentElement;
    const scrim = h('div.dlg-doc-scrim');
    const doc = h('div.dlg-doc');
    const wrap = h('div', { style: { position: 'absolute', inset: '0', zIndex: '5' } }, [scrim, doc]);
    if (kind === 'proclamations') {
      const board = h('div.dlg-board');
      PROCLAMATIONS.forEach((p, i) => board.append(h('div.dlg-notice', { style: { '--rot': `${[-2.2, 1.4, -0.8, 2, -1.6, 0.9][i % 6]}deg` } }, [h('h4', [p.title]), p.text, i % 2 === 0 ? h('i.seal') : null])));
      for (const n of board.querySelectorAll('.dlg-notice')) n.style.setProperty('--rot', n.style.getPropertyValue('--rot'));
      doc.append(board);
    } else if (kind === 'commissions' || kind === 'report') {
      const paid = kind === 'report' ? payRewards(this.ctx) : [];
      const led = h('div.dlg-ledger');
      led.append(h('h3', [kind === 'report' ? 'Report to the Council' : 'Commissions of the Council']), h('div.sub', [kind === 'report' ? (paid.length ? 'The Clerk counts out your reward in good Phlan gold.' : 'The Clerk finds nothing in your report that the Council owes you for. Yet.') : 'Signed and sealed; payable at this desk upon proof.']));
      const rows = h('div.rows');
      const sealed = QUEST_LIST.filter((q) => questStatus(game.flags, q.id) === 'locked').length;
      let shown = 0; // numbered as listed, so a hidden commission never leaves a gap (I, II, IV)
      QUEST_LIST.forEach((q) => {
        const st = questStatus(game.flags, q.id);
        if (st === 'locked') return;
        if (kind === 'report' && st !== 'rewarded' && st !== 'done' && st !== 'active') return;
        const stampText = { locked: 'Sealed', offered: '', active: 'Accepted', done: 'Complete', rewarded: 'Paid' }[st];
        const accept = st === 'offered'
          ? h('button.por-btn', { onclick: () => { (game.flags.quests ??= {})[q.id] = 'active'; addJournal(game, q.journal); this.ctx.ui.message(`Commission accepted: ${q.title}. Journal entry ${q.journal} recorded.`, 'lore'); this._showPanel(kind); this._renderStatus(this.script); this._renderQuests(); } }, ['Accept'])
          : h(`span.dlg-stamp.${st === 'offered' ? 'active' : st}`, [stampText]);
        rows.append(h(`div.dlg-lrow${st === 'locked' ? '.locked' : ''}`, [
          h('span.n', [romanize(++shown)]),
          h('div.t', [st === 'locked' ? 'Under seal' : q.title, h('small', [st === 'locked' ? 'The Council will open this commission when you have proven yourselves.' : q.summary])]),
          h('div.r', [`${q.reward.gold.toLocaleString('en-US')} gp`, h('em', [`${q.reward.xp} xp each`])]),
          accept,
        ]));
      });
      if (sealed && kind !== 'report') {
        rows.append(h('div.dlg-lrow.locked', [
          h('span.n', ['⁂']),
          h('div.t', [`${sealed} further commissions remain under seal`, h('small', ['The Council will open them when you have proven yourselves.'])]),
          h('div.r', ['']),
          h('span.dlg-stamp.locked', ['Sealed']),
        ]));
      }
      if (kind === 'report' && paid.length) {
        const total = paid.reduce((t, p) => t + p.gold, 0);
        rows.append(h('div', { style: { textAlign: 'center', marginTop: '0.8em', fontFamily: 'var(--font-display)', letterSpacing: '0.12em', color: '#5a1a0e' } }, [`Paid: ${total.toLocaleString('en-US')} gold pieces`]));
      }
      led.append(rows);
      led.append(h('div.dlg-sign', [h('span', ['By order of the Council of New Phlan']), h('em', ['— A. Vellum, Clerk']), h('i.dlg-wax')]));
      doc.append(led);
    } else if (kind === 'heroes') {
      const led = h('div.dlg-ledger');
      const roll = h('div.dlg-roll');
      const heroes = QUEST_LIST.filter((q) => questStatus(game.flags, q.id) === 'rewarded').map((q) => `${game.party[0]?.name ?? 'Unknown'}'s company — ${q.title}`);
      const fallen = ['Sir Aldous Venn, of Hillsfar', 'The Brothers Mott', 'Kestrel, a ranger', 'Maud of the Three Rivers', 'Oskar Dunmere and company', 'An elf who would not give her name', 'Havel the Bold', 'Tobin Greaves', 'The Company of the Red Lantern'];
      roll.append(h('div', { style: { fontFamily: 'var(--font-display)', letterSpacing: '0.2em', color: '#2a4a2a', marginBottom: '0.4em' } }, ['The Victorious']));
      if (!heroes.length) roll.append(h('div', { style: { fontStyle: 'italic', color: '#6a4a28' } }, ['(no names yet)']));
      for (const n of heroes) roll.append(h('div', [n]));
      roll.append(h('div', { style: { fontFamily: 'var(--font-display)', letterSpacing: '0.2em', color: '#7a1e12', margin: '0.8em 0 0.4em' } }, ['Those Who Tried']));
      for (const n of fallen) roll.append(h('div.dead', [n]));
      led.append(h('h3', ['The Hall of Heroes']), h('div.sub', ['Written in the Clerk\'s own hand']), roll);
      doc.append(led);
    }
    this.docEl?.remove();
    this.docEl = wrap;
    view.append(wrap);
  }

  // ------------------------------------------------------------------ Journal
  openJournal({ entry = null, tab = 'journal', standalone = false } = {}) {
    const { game } = this.ctx;
    this.closeJournal();
    const found = journalList(game).slice().sort((a, b) => a - b);
    const unread = new Set(game.flags.journalUnread ?? []);
    let sel = entry ?? found[found.length - 1] ?? null;
    const root = h('div.jr-root', { style: { position: 'absolute', inset: '0', zIndex: '20', background: standalone ? 'rgba(2,3,8,0.35)' : 'rgba(2,3,8,0.72)' } });
    const left = h('div.jr-page.left', { style: { backgroundImage: `url(${pageTexture('left')})` } });
    const right = h('div.jr-page.right', { style: { backgroundImage: `url(${pageTexture('right')})` } });
    const tabs = h('div.jr-tabs');
    const book = h('div.jr-book', [tabs, h('i.jr-ribbon'), left, right]);
    const close = h('button.por-btn.jr-close', { onclick: () => (standalone ? this.leave() : this.closeJournal()) }, ['Close  ', h('span.por-keycap', ['Esc'])]);
    book.append(close);
    root.append(book);
    const render = () => {
      clear(left);
      clear(right);
      clear(tabs);
      for (const [id, label] of [['journal', 'Journal'], ['quests', 'Commissions']]) tabs.append(h(`button.jr-tab${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; render(); } }, [label]));
      if (tab === 'quests') {
        left.append(h('div.jr-title', ['Commissions']), h('div.jr-subtitle', ['of the Council of New Phlan']), h('div.jr-rule'));
        const list = h('div.jr-list');
        for (const q of QUEST_LIST) {
          const st = questStatus(game.flags, q.id);
          if (st === 'locked' || st === 'offered') continue;
          list.append(h('div.jr-quest', [h('div.qt', [q.title]), h('div.qs', [q.summary]), h(`span.dlg-stamp.${st}`, [{ active: 'Accepted', done: 'Complete', rewarded: 'Paid' }[st]])]));
        }
        if (!list.children.length) list.append(h('div.jr-empty', ['No commissions accepted. Visit the Clerk at City Hall.']));
        left.append(list);
        const known = QUEST_LIST.filter((q) => questStatus(game.flags, q.id) === 'offered');
        right.append(h('div.jr-title', ['Offered']), h('div.jr-subtitle', ['Awaiting your signature at City Hall']), h('div.jr-rule'));
        const l2 = h('div.jr-list');
        for (const q of known) l2.append(h('div.jr-quest', [h('div.qt', [q.title]), h('div.qs', [`${q.summary} Reward: ${q.reward.gold.toLocaleString('en-US')} gp.`])]));
        if (!known.length) l2.append(h('div.jr-empty', ['Nothing further is offered at present.']));
        right.append(l2);
        return;
      }
      left.append(h('div.jr-title', ['The Journal']), h('div.jr-subtitle', ['of the Adventurer in Phlan']), h('div.jr-rule'));
      const list = h('div.jr-list');
      for (const n of found) {
        const e = getJournalEntry(n);
        list.append(h(`div.jr-item${n === sel ? '.on' : ''}${unread.has(n) ? '.unread' : ''}`, { onclick: () => { sel = n; unread.delete(n); render(); } }, [h('span.num', [String(n)]), h('span.tt', [e.title, e.where ? h('small', [e.where]) : null])]));
      }
      if (!found.length) list.append(h('div.jr-empty', ['The pages are blank. Your story in Phlan has yet to begin.']));
      // a short journal leaves the rest of its leaves ruled and waiting: the next unwritten entries
      if (found.length && found.length < 8) {
        const all = (Array.isArray(JOURNAL) ? JOURNAL.map((e) => e.n) : Object.keys(JOURNAL).map(Number)).filter((n) => Number.isFinite(n) && !found.includes(n)).sort((a, b) => a - b);
        for (const n of all.slice(0, 8 - found.length)) list.append(h('div.jr-item.blank', [h('span.num', [String(n)]), h('span.tt', ['· · ·', h('small', ['not yet written'])])]));
      }
      // the foot of the page: where the party stands, and the commissions in hand
      const inHand = QUEST_LIST.filter((q) => ['active', 'done'].includes(questStatus(game.flags, q.id)));
      const loc = game.location;
      const place = hasMap(loc.map) ? getMap(loc.map).name : 'New Phlan';
      const aside = h('div.jr-aside', [
        h('div.jr-aside-h', ['Memoranda']),
        h('div.jr-aside-row', [h('b', ['Day ']), String(game.clock.day), ' · ', place]),
        ...(inHand.length ? inHand.slice(0, 3).map((q) => h('div.jr-aside-row', [h('i', [questStatus(game.flags, q.id) === 'done' ? '✓' : '◆']), ` ${q.title}`, h('small', [questStatus(game.flags, q.id) === 'done' ? ' — report to the Clerk' : ' — in hand'])])) : [h('div.jr-aside-row', [h('i', ['◇']), ' No commission in hand. The Clerk at City Hall has work.'])]),
      ]);
      left.append(list, aside, h('div.jr-folio', [`${found.length} of ${JOURNAL.length} entries`]));
      const e = sel ? getJournalEntry(sel) : null;
      if (e) {
        right.append(h('div.jr-entry-head', [h('span.jr-entry-num', [String(e.n)]), h('span.jr-entry-title', [e.title])]));
        if (e.where) right.append(h('div.jr-entry-where', [e.where]));
        right.append(h('div.jr-rule'));
        right.append(h('div.jr-entry-text', [...e.text.map(smartQuotes).map((p, i) => { if (i) return h('p', [p]); const d = dropCap(p); return h(`p${d.lead.length ? '.dlg-capped' : ''}`, [...d.lead, d.body]); }), journalPlate(e.n)]));
        right.append(h('div.jr-folio', [`— ${romanize(e.n)} —`]));
      } else right.append(h('div.jr-empty', ['Select an entry.']));
      game.flags.journalUnread = [...unread];
    };
    render();
    this.journalEl = root;
    this.root.classList.toggle('dlg-journal-only', standalone);
    this.root.append(root);
  }

  closeJournal() {
    this.journalEl?.remove();
    this.journalEl = null;
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const { clock } = this.ctx;
    const t = clock.time;
    if (this.reveal.shown < this.reveal.total) {
      if (clock.frozen) this.skipReveal();
      else {
        const speed = 55 * (this.ctx.settings.get('textSpeed') ?? 1);
        this.reveal.shown = Math.min(this.reveal.total, this.reveal.shown + dt * speed);
        this._renderReveal();
      }
    }
    if (this.fade) {
      const k = clock.frozen ? 1 : Math.min(1, (t - this.fade.t0) / 0.6);
      const e = k * k * (3 - 2 * k);
      this.fade.el.style.opacity = String(e);
      if (k >= 1) {
        this.fade.prev?.remove();
        this.fade = null;
      }
    }
    // slow push-in on the painting (idle life)
    if (this.artCanvas) {
      const s = 1.015 + Math.sin(t * 0.07) * 0.012;
      const tx = Math.sin(t * 0.05) * 0.6;
      this.artCanvas.style.transform = `scale(${s.toFixed(4)}) translateX(${tx.toFixed(2)}%)`;
    }
    if (this.overlay && (dt > 0 || !this._drawnFrozen)) {
      this._drawArt(t);
      this._drawnFrozen = dt === 0;
    }
  }
}

// ------------------------------------------------------------------ helpers

/** Where a scripted scene takes place, by its painted setting. */
const SETTING_WHERE = {
  chapel: 'The chapel of Sokol Keep', keep: 'Sokol Keep', cityhall: 'City Hall, New Phlan', well: "Kuto's Well", well_head: "Kuto's Well", library: "Mendor's Library",
  temple_bane: 'The Temple of Bane', graveyard: 'Valhingen Graveyard', castle: 'Valjevo Castle', gate: 'Stojanow Gate', textile: 'Cadorna Textile House', plaza: 'Podol Plaza',
  tavern: 'New Phlan', docks: 'The docks of New Phlan', pool: 'The Pool of Radiance', wilds: 'The wilderness', slums: 'The Slums', alley: 'The Slums', tenement: 'The Slums',
};

/** The engraved plate illustrating a journal entry. */
function journalPlate(n) {
  const url = engravedPlate(n);
  return url ? h('figure.jr-plate', [h('img', { src: url, alt: '' }), h('figcaption', [`Plate ${romanize(n)}`])]) : null;
}

/**
 * Split a paragraph's opening into a drop-cap letter and a hanging quotation
 * mark (so “"The Council…" reads as one word, with the quote in the margin).
 */
/** Typographic quotes: straight " and ' become curly, so a hanging open quote matches its close. */
export function smartQuotes(t) {
  return t
    .replace(/(^|[\s(\[{\u2014-])"/g, '$1\u201c')
    .replace(/"/g, '\u201d')
    .replace(/(^|[\s(\[{\u2014-])'/g, '$1\u2018')
    .replace(/'/g, '\u2019');
}

export function dropCap(t) {
  const m = t.match(/^([“"'‘(«]*)([\p{L}\p{N}])/u);
  if (!m) return { lead: [], body: t };
  // the opening quote hangs in the margin beside the cap, at the cap's own scale
  const q = m[1].replace(/"/g, '\u201c').replace(/'/g, '\u2018');
  const lead = [h('span.dlg-cap', q ? { dataset: { q } } : {}, [m[2]])];
  return { lead, body: t.slice(m[0].length) };
}

function youSee(enc) {
  const parts = enc.groups.map((g) => {
    const m = MONSTERS[g.monster];
    const n = typeof g.count === 'number' ? g.count : 'several';
    return `${n} ${n === 1 ? m.name : m.plural}`;
  });
  return h('span', ['You see ', h('b', [parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]]), '.']);
}

/** What each Gold Box parley stance tends to do (shown under the choices). */
const STANCE_TIPS = {
  haughty: 'Proud and commanding. Cows the weak; angers the strong.',
  sly: 'Cunning and flattering. Works on the greedy.',
  nice: 'Friendly and open. Works on the reasonable.',
  meek: 'Humble and yielding. Invites demands.',
  abusive: 'Threats and insults. Rarely wise.',
  flee: 'Back away while you still can.',
};
/** The same, cut to a tile: [head, note]. */
const STANCE_TILE = {
  haughty: ['Proud, commanding', 'Cows the weak, riles the strong'],
  sly: ['Cunning, flattering', 'Works on the greedy'],
  nice: ['Friendly and open', 'Works on the reasonable'],
  meek: ['Humble, yielding', 'Invites demands'],
  abusive: ['Threats and insults', 'Rarely wise'],
  flee: ['Back away', 'While you still can'],
};

function sizeWord(m) {
  const s = { S: 'small', M: 'man-sized', L: 'large' }[m.size] ?? '';
  const u = m.special?.includes('undead') ? ' · undead' : '';
  return `${s}${u}`;
}

function romanize(n) {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of [[50, 'L'], [40, 'XL'], ...map]) while (n >= v) { out += s; n -= v; }
  return out;
}

// ------------------------------------------------------------------ victory hook

let hookInstalled = false;
/**
 * Combat does not report its outcome, so fights started from an encounter or
 * script leave a note in game.flags._pendingFight. When the party next enters
 * any other scene we compare experience: a gain means victory (apply the
 * script's `win` effects, the encounter's `onWin`, and its treasure items);
 * otherwise the party fled, and the once-only map event is re-armed.
 */
function installVictoryHook(ctx) {
  if (hookInstalled) return;
  hookInstalled = true;
  ctx.bus.on('scene:enter', ({ name }) => {
    const p = ctx.game.flags._pendingFight;
    if (!p || name === 'combat' || name === 'dialogue') return;
    delete ctx.game.flags._pendingFight;
    if (name === 'title') return;
    const xp = ctx.game.party.reduce((t, c) => t + Object.values(c.xp).reduce((a, b) => a + b, 0), 0);
    if (xp > p.xp) {
      if (p.win?.length) apply(ctx, p.win);
      const who = living(ctx.game)[0];
      for (const id of p.items ?? []) {
        if (!who || !ITEMS[id]) continue;
        addItem(who, id);
        ctx.ui.message(`Among the spoils: ${ITEMS[id].name}.`, 'loot');
      }
      ctx.game.notifyPartyChanged();
    } else if (p.eventId) delete ctx.game.spentEvents[p.eventId];
  });
}

/** A plain dusk backdrop for browsers where the scene painter fails. */
function fallbackPanel(w, h, err) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1a1f33');
  sky.addColorStop(0.62, '#3a2e2a');
  sky.addColorStop(1, '#120e0c');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w * 0.5, h * 0.7, 10, w * 0.5, h * 0.7, w * 0.55);
  glow.addColorStop(0, 'rgba(255,170,90,0.28)');
  glow.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  if (err) {
    // A small diagnostic line, so a screenshot from an affected browser says what failed.
    const line = String(err?.stack ?? err).split('\n').slice(0, 2).join(' @ ').replace(/https?:\/\/[^\s)]*\//g, '');
    g.font = '15px monospace';
    g.fillStyle = 'rgba(255,230,200,0.55)';
    g.fillText(`Scene art unavailable: ${line}`.slice(0, 150), 18, h - 18);
  }
  return { canvas, info: {}, composer: null };
}
