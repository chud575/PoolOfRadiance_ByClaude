import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, Menu } from '../../ui/UI.js';
import { SettingsPanel, padGlyph } from '../../ui/SettingsPanel.js';
import { bindSkin } from '../../ui/styles/skin.js';
import { buildParty } from '../../rules/party.js';
import { createWorld, preloadWorld } from './world/World.js';
import { createLogo } from './Logo.js';
import { IntroCinematic } from './Intro.js';
import { LoadPanel } from './LoadPanel.js';
import { Credits } from './Credits.js';

/**
 * Title scene: the Pool of Radiance glowing on the old temple terrace above
 * ruined Phlan at dusk. Modes (URL `view=`):
 *   card      – the title card: big gilded logo, "press any key"
 *   menu      – main menu (Continue / New Game / Load / Quick Start / Settings / Credits)
 *   settings  – the full settings screen (`tab=graphics|gameplay|audio|controls|access`)
 *   load      – save slots
 *   credits   – credits crawl
 *   intro     – the council prologue cinematic (skippable), then character creation
 * Owned by the title/intro/menus/UI-skin workstream.
 */
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Camera poses per mode: position + look target. */
const POSES = {
  card: { p: [0, 3.6, 12.5], l: [0, 1.08, -27.5] },
  menu: { p: [-4.6, 3.3, 12.2], l: [-4.2, 1.2, -27.8] },
  settings: { p: [-1.5, 5.2, 9.5], l: [0.5, 1.5, -30] },
  load: { p: [2.5, 3.0, 10.5], l: [0.6, 1.3, -30] },
  credits: { p: [0, 7.5, 16], l: [0, 2.5, -40] },
};
/** Logo layout per mode (fraction of screen width, centre NDC). */
const LOGO = {
  card: { width: 0.56, cx: 0, cy: 0.5, alpha: 1 },
  menu: { width: 0.44, cx: 0.235, cy: 0.575, alpha: 1 },
  settings: { width: 0.3, cx: 0, cy: 0.9, alpha: 0 },
  load: { width: 0.3, cx: 0.5, cy: 0.9, alpha: 0 },
  credits: { width: 0.34, cx: 0, cy: 0.64, alpha: 1 },
  intro: { width: 0.56, cx: 0, cy: 0.5, alpha: 0 },
};

export default class TitleScene extends Scene {
  async enter(params = {}) {
    const { ctx } = this;
    bindSkin(ctx);
    await preloadWorld();
    this.world = createWorld();
    this.scene3d = this.world.scene;
    this.camera = new THREE.PerspectiveCamera(45, ctx.render.aspect, 0.3, 6000);
    this.logo = createLogo();
    this.camera.add(this.logo.mesh);
    this.scene3d.add(this.camera);
    this.post = { bloomStrength: 0.55, bloomRadius: 0.45, bloomThreshold: 0.92, exposure: 1.0, vignette: 0.5 };

    this.cam = { p: new THREE.Vector3(...POSES.card.p), l: new THREE.Vector3(...POSES.card.l) };
    this.camTween = null;
    this.logoState = { ...LOGO.card };
    this.logoTween = null;
    this.enterTime = ctx.clock.time;
    this.fromBoot = !ctx.debug.active;

    this._buildDom();
    const view = params.view ?? 'card';
    this.setMode(POSES[view] || view === 'intro' ? view : 'card', { instant: true, tab: params.tab });

    const onKey = (e) => this._onKey(e);
    window.addEventListener('keydown', onKey);
    this.own(() => window.removeEventListener('keydown', onKey));
    this.root.addEventListener('pointerdown', () => this.mode === 'card' && this.setMode('menu'));
    this.listen('input:action', ({ action, code }) => this._onAction(action, code));
    ctx.audio.playMusic('title');
  }

  // --------------------------------------------------------------------- DOM
  _buildDom() {
    const { ctx } = this;
    const saves = ctx.saves.list().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    this.latestSave = saves[0] ?? null;
    const items = [
      { id: 'continue', label: 'Continue', key: 'C', locked: !this.latestSave, desc: this.latestSave ? this._saveLine(this.latestSave) : 'Locked — no adventure in progress yet. Begin a New Game; Phlan autosaves as you go.' },
      { id: 'new', label: 'New Game', key: 'N', desc: 'Hear the Council of Phlan, then roll up a party of six.' },
      { id: 'load', label: 'Load Game', key: 'L', locked: !saves.length, desc: saves.length ? `${saves.length} saved game${saves.length > 1 ? 's' : ''} in the chronicle.` : 'Locked — the chronicle is empty. Save from camp (Encamp) or with F5.' },
      { id: 'quick', label: 'Quick Start', key: 'Q', desc: 'Skip ahead with a ready-made party of six adventurers.' },
      { id: 'settings', label: 'Settings', key: 'S', desc: 'Graphics, classic 1988 mode, pace, audio, controls and accessibility.' },
      { id: 'credits', label: 'About & Credits', key: 'A', desc: 'Those who made this homage, and those who made the original.' },
    ];
    this.menuItems = items;
    this.descEl = h('div.por-mm-desc');
    this.menu = new Menu(items, {
      onSelect: (it) => this.select(it.id),
      onHighlight: (it, i, changed) => {
        this.descEl.textContent = it.desc ?? '';
        if (changed) ctx.audio.sfx('click', { bus: 'ui', pitch: 1.4 });
      },
      onCancel: () => this.setMode('card'),
      onLocked: () => ctx.audio.sfx('error', { bus: 'ui' }),
      bus: ctx.bus,
      autofocus: false,
      className: 'por-mm-list',
    });
    this.fadeEl = h('div.por-title-fade');
    this.cardEl = h('section.por-title-card', [
      h('div.por-title-prompt', [
        h('span.por-title-prompt-text', ['Press any key']),
      ]),
    ]);
    this.menuEl = h('section.por-title-menu', [
      h('div.por-mm', [
        h('div.por-mm-kicker', ['Phlan · Year of the Worm']),
        this.menu.el,
        h('div.por-mm-rule'),
        this.descEl,
      ]),
    ]);
    this.panelEl = h('section.por-title-panel');
    this.legendEl = h('div.por-title-legend');
    this.root = h('div.por-title', [
      h('div.por-title-scrim'),
      this.cardEl,
      this.menuEl,
      this.panelEl,
      h('footer.por-title-footer', [
        h('div.por-title-foot-l', ['Phlan, on the northern shore of the Moonsea']),
        this.legendEl,
        h('div.por-title-foot-r', ['A fan homage · v0.2']),
      ]),
      this.fadeEl,
    ]);
    ctx.ui.mount(this.root);
  }

  _saveLine(s) {
    const when = s.savedAt ? new Date(s.savedAt) : null;
    const d = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    return `${s.summary ?? 'Saved game'}${d ? ` · saved ${d}` : ''}`;
  }

  _legend(mode) {
    const back = () => this.setMode('menu');
    const L = {
      card: [['Enter', 'Begin', 'A', () => this.setMode('menu')], ['F2', 'Classic 1988', null, () => this.ctx.bus.emit('input:action', { action: 'toggleClassic', code: 'F2' })]],
      menu: [['↑↓', 'Select', '↑'], ['Enter', 'Choose', 'A'], ['Esc', 'Back', 'B', () => this.setMode('card')], ['F2', 'Classic 1988']],
      load: [['↑↓', 'Select', '↑'], ['Enter', 'Load', 'A'], ['Del', 'Delete', 'X'], ['Esc', 'Back', 'B', back]],
      credits: [['Esc', 'Back', 'B', back]],
    }[mode] ?? [];
    this.legendEl.replaceChildren(...L.map(([k, t, pad, fn]) => h(fn ? 'button.por-title-legend-item.click' : 'span.por-title-legend-item', fn ? { type: 'button', onclick: (e) => { e.stopPropagation(); fn(); } } : {}, [
      h('span.por-keycap', [k]), pad ? padGlyph(pad) : null, h('span', [t]),
    ])));
  }

  // ------------------------------------------------------------------- modes
  setMode(mode, { instant = false, tab } = {}) {
    const prev = this.mode;
    this.mode = mode;
    this.root.dataset.mode = mode;
    this._legend(mode);
    this.menu.active = mode === 'menu';
    if (this.panel && prev !== mode) {
      this.panel.dispose();
      this.panel = null;
    }
    if (this.intro && mode !== 'intro') {
      this.intro.dispose();
      this.intro = null;
    }
    if (mode === 'menu') queueMicrotask(() => this.mode === 'menu' && this.menu.focus());
    if (mode === 'menu' && prev !== 'menu' && this.menuItems[this.menu.index]?.locked) this.menu.highlightId('new');
    if (mode === 'settings') {
      this.panel = new SettingsPanel(this.ctx, { tab, onClose: () => this.setMode('menu') });
      this.panelEl.replaceChildren(this.panel.el);
    } else if (mode === 'load') {
      this.panel = new LoadPanel(this.ctx, { onClose: () => this.setMode('menu'), onLoad: (slot) => this._loadSlot(slot) });
      this.panelEl.replaceChildren(this.panel.el);
    } else if (mode === 'credits') {
      this.panel = new Credits(this.ctx, { onClose: () => this.setMode('menu'), t0: instant ? 0 : this.ctx.clock.time });
      this.panelEl.replaceChildren(this.panel.el);
    } else if (mode === 'intro') {
      this.intro = new IntroCinematic(this.ctx, this.world, {
        t0: instant ? 0 : this.ctx.clock.time,
        onDone: () => this._finishIntro(),
      });
      this.panelEl.replaceChildren(this.intro.el);
      this.ctx.audio.playMusic('intro');
    } else {
      this.panelEl.replaceChildren();
    }
    if (mode !== 'intro') this._tweenCamera(POSES[mode] ?? POSES.card, instant ? 0 : 1.6);
    this._tweenLogo(LOGO[mode] ?? LOGO.card, instant ? 0 : 1.1);
  }

  _tweenCamera(pose, dur) {
    const to = { p: new THREE.Vector3(...pose.p), l: new THREE.Vector3(...pose.l) };
    if (!dur) {
      this.cam.p.copy(to.p);
      this.cam.l.copy(to.l);
      this.camTween = null;
      return;
    }
    this.camTween = { from: { p: this.cam.p.clone(), l: this.cam.l.clone() }, to, t0: this.ctx.clock.time, dur };
  }

  _tweenLogo(to, dur) {
    if (!dur) {
      this.logoState = { ...to };
      this.logoTween = null;
      return;
    }
    this.logoTween = { from: { ...this.logoState }, to: { ...to }, t0: this.ctx.clock.time, dur };
  }

  // ------------------------------------------------------------------- input
  _onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || this.ctx.ui.layers.modal.children.length) return;
    if (this.mode === 'card') {
      if (['F2', 'F5', 'F9', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const it = this.menuItems.find((x) => x.key && x.key.toUpperCase() === e.key.toUpperCase() && !x.disabled && !x.locked);
      e.preventDefault();
      if (it) this.select(it.id);
      else this.setMode('menu');
    } else if (this.mode === 'menu' && document.activeElement !== this.menu.el) {
      // route keys to the menu even if focus wandered (e.g. after a click elsewhere)
      if (['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape'].includes(e.key) || /^[a-z]$/i.test(e.key)) {
        this.menu.focus();
        this.menu._onKey(e);
      }
    } else if (this.mode === 'credits' && (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Backspace')) {
      this.setMode('menu');
    } else if (this.mode === 'intro' && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.intro?.skip();
    }
  }

  _onAction(action, code) {
    if (!String(code).startsWith('pad:')) return;
    if (this.mode === 'card' && (action === 'confirm' || action === 'encamp')) this.setMode('menu');
    else if (this.mode === 'credits' && action === 'cancel') this.setMode('menu');
    else if (this.mode === 'intro' && (action === 'cancel' || action === 'confirm')) this.intro?.skip();
  }

  select(id) {
    const { scenes, game, rng } = this.ctx;
    this.ctx.audio.sfx('click', { bus: 'ui', pitch: 0.9 });
    if (id === 'new') this.setMode('intro');
    else if (id === 'quick') {
      game.setParty(buildParty('default', rng.int(1, 1e6)));
      scenes.goto('explore', { map: 'phlan_slums', x: 1, y: 14, dir: 'E' });
    } else if (id === 'continue' && this.latestSave) this._loadSlot(this.latestSave.slot);
    else if (id === 'load' || id === 'settings' || id === 'credits') this.setMode(id);
  }

  _loadSlot(slot) {
    const st = this.ctx.saves.load(slot);
    if (!st) {
      this.ctx.ui.toast('That save could not be read', { kind: 'warn' });
      return;
    }
    this.ctx.game.loadJSON(st);
    this.ctx.scenes.goto('explore', {});
  }

  _finishIntro() {
    this.ctx.scenes.goto('create', {});
  }

  // ------------------------------------------------------------------ frame
  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    const t = this.ctx.clock.time;
    const snap = dt === 0;
    if (this.camTween) {
      const k = snap ? 1 : Math.min(1, (t - this.camTween.t0) / this.camTween.dur);
      const e = ease(k);
      this.cam.p.lerpVectors(this.camTween.from.p, this.camTween.to.p, e);
      this.cam.l.lerpVectors(this.camTween.from.l, this.camTween.to.l, e);
      if (k >= 1) this.camTween = null;
    }
    if (this.mode === 'intro' && this.intro) {
      this.intro.update(t, this.camera, snap);
    } else {
      const sway = document.documentElement.dataset.motion === 'reduce' ? 0 : 1;
      this.camera.position.set(
        this.cam.p.x + Math.sin(t * 0.071) * 0.35 * sway,
        this.cam.p.y + Math.sin(t * 0.113) * 0.08 * sway,
        this.cam.p.z + Math.sin(t * 0.05) * 0.25 * sway,
      );
      this.camera.lookAt(this.cam.l.x + Math.sin(t * 0.06) * 0.4 * sway, this.cam.l.y, this.cam.l.z);
    }
    if (this.logoTween) {
      const k = snap ? 1 : Math.min(1, (t - this.logoTween.t0) / this.logoTween.dur);
      const e = ease(k);
      for (const key of ['width', 'cx', 'cy', 'alpha']) this.logoState[key] = this.logoTween.from[key] + (this.logoTween.to[key] - this.logoTween.from[key]) * e;
      if (k >= 1) this.logoTween = null;
    }
    const since = t - this.enterTime;
    const reveal = snap || !this.fromBoot ? 1 : THREE.MathUtils.smoothstep(since, 1.2, 3.2);
    const L = this.logoState;
    const introLogo = this.intro?.logoAlpha ?? 0;
    this.logo.layout(this.camera, { width: L.width * (0.96 + 0.04 * reveal), cx: L.cx, cy: L.cy, alpha: Math.max(L.alpha * reveal, introLogo) });
    this.logo.uniforms.uSweep.value = this.fromBoot && since < 5 && !snap ? -0.3 + (since - 1.5) * 0.6 : ((t * 0.16) % 1.8) - 0.4;
    this.logo.uniforms.uTime.value = t;
    const fade = snap || !this.fromBoot ? 0 : 1 - THREE.MathUtils.smoothstep(since, 0.2, 2.2);
    this.fadeEl.style.opacity = String(fade);
    this.root.classList.toggle('booted', snap || !this.fromBoot || since > 2.6);
    this.panel?.update?.(t, snap);
    this.world.update(t, this.camera, this.ctx.render.renderer?.getPixelRatio?.() ?? 1);
  }

  exit() {
    this.panel?.dispose();
    this.intro?.dispose();
    this.menu?.dispose();
    this.logo?.dispose();
    this.world?.dispose();
    super.exit();
  }
}
