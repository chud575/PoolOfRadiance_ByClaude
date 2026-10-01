import * as THREE from 'three';
import { h, clear, hotkeyLabel, Frame, MessageLog, Menu } from '../../../ui/UI.js';
import { deriveStats } from '../../../rules/character.js';
import { ITEMS } from '../../../data/items.js';
import { SAVE_NAMES } from '../../../rules/classes.js';
import './combat.css';

const FX_LABEL = {
  asleep: ['Asleep', 'bad'], held: ['Held', 'bad'], nauseous: ['Nauseous', 'bad'], blessed: ['Blessed', 'good'], cursed: ['Cursed', 'bad'],
  prot: ['Prot. Evil', 'good'], shielded: ['Shield', 'good'], enlarged: ['Enlarged', 'good'], invisible: ['Invisible', 'good'],
  hasted: ['Hasted', 'good'], prayer: ['Prayer', 'good'], prayerFoe: ['Prayer', 'bad'], silenced: ['Silenced', 'bad'], mirror: ['Images', 'good'],
  bandaged: ['Bandaged', 'good'],
};

/**
 * Combat HUD: initiative timeline with 3D-rendered portraits, the active
 * combatant card (Gold Box right panel), roster, log, the classic command line,
 * hover inspect card, floating combat text and banners.
 */
export class CombatHud {
  constructor(ctx, o = {}) {
    this.ctx = ctx;
    this.root = h('div.cb-hud');
    this.floatLayer = h('div.cb-float-layer');
    this.timeline = h('div.cb-timeline');
    this.card = Frame({ title: 'Combat', variant: 'blue', className: 'cb-card' });
    this.cardBody = this.card.body;
    this.log = new MessageLog(ctx.bus, { lines: 3, max: 80 });
    this.logBox = h('div.cb-logbox', { dataset: { tip: 'Combat log — hover to expand' } }, [this.log.el]);
    this.cmds = h('div.por-commandbar.cb-cmds');
    this.prompt = h('div.cb-prompt');
    this.inspect = h('div.cb-inspect');
    this.banner = h('div.cb-banner');
    this.help = h('div.cb-help', { html: '<kbd>RMB</kbd> orbit &nbsp;<kbd>MMB</kbd> pan &nbsp;<kbd>Wheel</kbd> zoom<br><kbd>,</kbd> <kbd>.</kbd> rotate &nbsp;<kbd>Tab</kbd> target &nbsp;<kbd>Esc</kbd> back' });
    this.speedEl = h('div.cb-speed');
    this.loc = h('div.cb-loc', [h('div.name.por-gilt-text', [o.location ?? 'Phlan']), h('div.sub', [o.sub ?? ''])]);
    this.rosterFrame = Frame({ title: 'Party', variant: 'blue', className: 'cb-roster' });
    this.roster = h('div.por-roster');
    this.rosterFrame.body.append(this.roster);
    const bottom = h('div.cb-bottom', [this.cmds]);
    this.root.append(this.floatLayer, this.speedEl, this.loc, this.timeline, this.card.el, this.rosterFrame.el, this.logBox, this.prompt, bottom, this.help, this.banner, this.inspect);
    ctx.ui.mount(this.root);
    this.floats = [];
    this.banners = [];
    this.portraits = new Map();
    this.menu = null;
    this.sheet = null;
    this._v = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- timeline
  setTimeline(engine, activeId, { onHover, onClick } = {}) {
    const order = engine.order;
    const nodes = [h('div.cb-round', ['Round', h('b', [String(Math.max(1, engine.round))])])];
    let lastSide = null;
    order.forEach((c) => {
      const down = this.shownOut(c, engine);
      const hpNow = this.shownHp(c);
      const done = c._actedRound === engine.round && c.id !== activeId;
      if (lastSide && lastSide !== c.side && false) nodes.push(h('div.cb-sep'));
      lastSide = c.side;
      const pct = Math.max(0, hpNow) / Math.max(1, c.hp.max);
      const fx = Object.keys(c.fx ?? {}).filter((k) => FX_LABEL[k] && c.fx[k]).map((k) => ({ asleep: 'z', held: '⛓', nauseous: '~', blessed: '✦', hasted: '»', cursed: '✖', mirror: '◈', invisible: '◌', shielded: '⛨', prot: '☼' }[k] ?? '')).join('');
      const tok = h(`div.cb-token.${c.side}`, {
        class: `${c.id === activeId ? 'current' : ''} ${down ? 'down' : ''} ${done ? 'done' : ''}`,
        dataset: { tip: `${c.name} — ${c.side === 'party' ? `HP ${hpNow}/${c.hp.max}` : describeHealth({ hp: { cur: hpNow, max: c.hp.max } })} · AC ${c.ac}${c.initiative ? ` · Init ${c.initiative}` : ''}` },
        onmouseenter: () => onHover?.(c.id),
        onmouseleave: () => onHover?.(null),
        onclick: () => onClick?.(c.id),
      }, [
        this.portraits.get(c.id) ? h('img', { src: this.portraits.get(c.id), alt: '' }) : h('div', { style: { width: '100%', height: '100%', background: c.side === 'party' ? '#1f3a7a' : '#6e1814' } }),
        c.side === 'party' ? h('div.nm', [shortName(c.name)]) : h('div.no', [monsterNo(c.name)]),
        fx ? h('div.fx', [fx]) : null,
        h('div.hpb', [h('i', { style: { width: `${pct * 100}%` } })]),
      ]);
      nodes.push(tok);
    });
    this.timeline.replaceChildren(...nodes);
  }

  /**
   * What the HUD shows may lag the rules engine: results are revealed when their
   * hit / impact plays, not when they were rolled. `view` (set by the scene)
   * holds the displayed values for combatants whose outcome hasn't landed yet.
   */
  shownHp(c) {
    return this.view?.has(c) ? this.view.hp(c) : c.hp.cur;
  }

  shownOut(c, engine) {
    return this.view?.has(c) ? this.view.out(c) : engine.out(c);
  }

  // ---------------------------------------------------------------- card
  setCard(c, engine) {
    const body = this.cardBody;
    clear(body);
    if (!c) return;
    const isParty = c.side === 'party';
    this.card.el.classList.toggle('monster', !isParty);
    if (this.card.title) this.card.title.textContent = isParty ? (c.quick ? 'Quick' : 'Your Turn') : 'Enemy';
    const hpNow = this.shownHp(c);
    const pct = Math.max(0, hpNow) / Math.max(1, c.hp.max);
    const s = isParty ? deriveStats(c.ref) : null;
    const chips = Object.keys(c.fx ?? {}).filter((k) => FX_LABEL[k] && c.fx[k]).map((k) => h(`span.cb-chip.${FX_LABEL[k][1]}`, [FX_LABEL[k][0]]));
    if (c.guarding) chips.push(h('span.cb-chip.good', ['Guarding']));
    if (c.fleeing) chips.push(h('span.cb-chip.bad', ['Fleeing']));
    const mpMax = c.move * (c.fx?.hasted ? 2 : 1);
    const pips = [];
    for (let i = 0; i < Math.ceil(mpMax); i++) {
      const left = c.mp - i;
      pips.push(h('i', { class: left >= 1 ? '' : left > 0 ? 'half' : 'used' }));
    }
    body.append(...[
      h('div.nm', [c.name]),
      h('div.cls', [isParty ? `${s.className} · Level ${s.levels}` : `${c.ref?.name ?? 'Monster'} · ${hdText(c)}`]),
      h('div.row', ['Hit Points', h('b', [isParty ? `${hpNow} / ${c.hp.max}` : describeHealth({ hp: { cur: hpNow, max: c.hp.max } })])]),
      h('div.hp', [h('i', { style: { width: `${pct * 100}%` } })]),
      h('div.row', ['Armor Class', h('b', [String(c.ac)])]),
      h('div.row', ['THAC0', h('b', [String(c.thac0)])]),
      h('div.row', ['Weapon', h('b', [engine.weaponName(c)])]),
      h('div.row', ['Damage', h('b', [c.attacks.join(' / ')])]),
      h('div.mv', [h('span.lbl', ['Moves Left']), h('span.big', [fmtMp(c.mp)])]),
      h('div.cb-pips', pips),
      chips.length ? h('div.cb-chips', chips) : null,
      isParty && c.quick ? h('div.auto', ['Under computer control']) : null,
    ].filter(Boolean));
  }

  setRoster(engine, activeId, onClick) {
    const rows = [h('div.por-roster-head', [h('span.n', ['Name']), h('span.ac', ['AC']), h('span.hp', ['HP'])])];
    for (const c of engine.party) {
      const hpNow = this.shownHp(c);
      const pct = Math.max(0, hpNow) / c.hp.max;
      const st = c.fled ? 'dead' : this.view?.has(c) ? (pct < 0.34 ? 'low' : 'ok') : c.ref.status !== 'ok' ? c.ref.status : pct < 0.34 ? 'low' : 'ok';
      rows.push(h(`div.por-roster-row.st-${st}`, {
        class: `${c.id === activeId ? 'active' : ''} ${c.quick ? 'auto' : ''}`,
        dataset: { tip: `${c.name}${c.fled ? ' (fled)' : ''} — click to toggle QUICK (computer control)` },
        onclick: () => onClick?.(c),
      }, [h('span.n', [c.name]), h('span.ac', [String(c.ac)]), h('span.hp', [c.fled ? '—' : String(hpNow)]), h('span.bar', [h('i', { style: { width: `${pct * 100}%` } })])]));
    }
    this.roster.replaceChildren(...rows);
    // Keep the roster below the card.
    const r = this.card.el.getBoundingClientRect();
    const rootR = this.root.getBoundingClientRect();
    this.rosterFrame.el.style.top = `${r.bottom - rootR.top + 22}px`;
  }

  // ---------------------------------------------------------------- commands
  setCommands(list, activeId = null) {
    this.cmds.replaceChildren(...list.map((c) => {
      const b = h('button.por-cmd', {
        type: 'button',
        disabled: !!c.disabled,
        class: c.id === activeId ? 'active' : '',
        dataset: { tip: c.tip ?? '', cmd: c.id },
        onclick: () => !c.disabled && c.onSelect?.(),
      }, [hotkeyLabel(c.label, c.key)]);
      return b;
    }));
  }

  setPrompt(text) {
    this.prompt.textContent = text ?? '';
    this.prompt.classList.toggle('show', !!text);
  }

  setSpeed(label) {
    this.speedEl.replaceChildren('Speed ', h('b', [label]));
  }

  // ---------------------------------------------------------------- inspect
  showInspect(content, x, y, world = null) {
    if (!content) {
      this.inspect.classList.remove('show');
      this._inspectWorld = null;
      return;
    }
    this.inspect.replaceChildren(...[].concat(content));
    this.inspect.classList.add('show');
    this._inspectWorld = world ? world.clone() : null;
    this._placeInspect(x, y);
  }

  _placeInspect(x, y) {
    const w = this.inspect.offsetWidth;
    const hh = this.inspect.offsetHeight;
    // Anchor beside the target, inside the play area: never over the command
    // line / prompt (bottom), the initiative bar (top) or the right-hand panels.
    const W = window.innerWidth;
    const cmdTop = this.cmds.getBoundingClientRect().top || window.innerHeight - 60;
    const promptH = this.prompt.classList.contains('show') ? this.prompt.offsetHeight + 6 : 0;
    const maxY = cmdTop - promptH - hh - 8;
    const minY = (this.timeline.getBoundingClientRect().bottom || 80) + 8;
    const cardL = this.card.el.getBoundingClientRect().left || W;
    const maxX = Math.min(W - w - 10, cardL - w - 12);
    // Up and to the right of the anchor (clear of the figure standing on it).
    let px = x + 34;
    if (px > maxX) px = x - w - 34;
    px = Math.max(10, Math.min(maxX, px));
    let py = y - hh - 26;
    py = Math.max(minY, Math.min(maxY, py));
    this.inspect.style.transform = `translate(${px}px, ${py}px)`;
  }

  // ---------------------------------------------------------------- menus
  openMenu(title, items, onSelect, onCancel) {
    this.closeMenu();
    const menu = new Menu(items, { onSelect: (it) => onSelect(it) });
    const f = Frame({ title, variant: 'blue', className: 'cb-menu', children: [menu.el] });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.closeMenu();
        onCancel?.();
      }
    };
    f.el.addEventListener('keydown', onKey);
    this.root.append(f.el);
    this.menu = { f, menu };
  }

  closeMenu() {
    if (!this.menu) return;
    this.menu.f.el.remove();
    this.menu = null;
  }

  // ---------------------------------------------------------------- sheet
  showSheet(c) {
    this.hideSheet();
    if (!c) return;
    let body;
    if (c.side === 'party') {
      const ch = c.ref;
      const s = deriveStats(ch);
      const a = ch.abilities;
      body = [
        h('h3', [ch.name]),
        h('div', [`${s.className}, level ${s.levels} — ${ch.race} ${ch.gender ?? ''}, ${ch.alignment ?? ''}`]),
        h('div.grid', ['str', 'int', 'wis', 'dex', 'con', 'cha'].map((k) => h('div', [k.toUpperCase(), h('b', [k === 'str' && a.str === 18 && a.strPct ? `18/${String(a.strPct).padStart(2, '0')}` : String(a[k])])]))),
        h('div.grid', [h('div', ['HP', h('b', [`${ch.hp.cur}/${ch.hp.max}`])]), h('div', ['AC', h('b', [String(s.ac)])]), h('div', ['THAC0', h('b', [String(s.thac0)])])]),
        h('div', { style: { fontSize: '0.85em', margin: '0.4em 0' } }, Object.entries(s.saves).map(([k, v]) => h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [SAVE_NAMES[k], h('b', [String(v)])]))),
        h('div.inv', ch.inventory.map((e) => h('div', { class: e.equipped ? 'eq' : '' }, [`${e.equipped ? '▸ ' : '  '}${ITEMS[e.id]?.name ?? e.id}${e.qty > 1 ? ` (${e.qty})` : ''}${e.charges ? ` [${e.charges}]` : ''}`]))),
      ];
    } else {
      const m = c.ref;
      body = [h('h3', [c.name]), h('p', [m.desc ?? `A hostile ${m.name.toLowerCase()}.`]), h('div.grid', [h('div', ['AC', h('b', [String(c.ac)])]), h('div', ['HD', h('b', [String(m.hd)])]), h('div', ['MV', h('b', [String(m.move)])])]), h('div', [`Condition: ${describeHealth(c)}`]), h('div', [`Attacks: ${c.attacks.join(', ')}`])];
    }
    const f = Frame({ title: 'View', variant: 'parchment', className: 'cb-sheet', children: body });
    this.root.append(f.el);
    this.sheet = f;
  }

  hideSheet() {
    this.sheet?.el.remove();
    this.sheet = null;
  }

  // ---------------------------------------------------------------- floating text & banners
  float(text, kind, pos, t, o = {}) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    // Several kills landing together (a fireball) consolidate into one callout
    // over the group instead of a pile of overlapping SLAIN labels.
    if (kind === 'kill' && !o.solo) {
      const prev = this.floats.find((f) => f.kind === 'kill' && !f.solo && Math.abs(f.t0 - t) < 0.45);
      if (prev) {
        prev.n += 1;
        prev.sum.add(pos);
        prev.pos.copy(prev.sum).multiplyScalar(1 / prev.n);
        prev.el.textContent = `${prev.n} ${prev.plural ?? 'slain'}`;
        prev.el.classList.add('multi');
        return;
      }
    }
    const el = h(`div.cb-float.${kind}`, { class: o.cls ?? '', style: { opacity: '0' } }, [text]);
    this.floatLayer.append(el);
    this.floats.push({ el, kind, solo: !!o.solo, n: 1, sum: pos.clone(), plural: o.plural, pos: pos.clone(), t0: t, life: o.life ?? 1.3, dx: o.dx ?? 0, rise: o.rise ?? 1 });
  }

  showBanner(text, sub, t, life = 1.6) {
    this.banner.replaceChildren(text, sub ? h('small', [sub]) : '');
    this.banner.classList.toggle('big', life >= 2);
    this.bannerT = { t0: t, life };
  }

  hideBanner() {
    this.bannerT = null;
    this.banner.style.opacity = '0';
  }

  update(t, camera, w, hgt) {
    if (this._inspectWorld) {
      const v = this._v.copy(this._inspectWorld).project(camera);
      if (Number.isFinite(v.x) && v.z < 1) this._placeInspect((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * hgt);
    }
    for (const f of this.floats) {
      const age = t - f.t0;
      if (age < 0) {
        f.el.style.opacity = '0';
        continue;
      }
      const u = age / f.life;
      this._v.copy(f.pos);
      this._v.y += f.rise * (0.25 + 1.1 * (1 - Math.exp(-age * 3)));
      this._v.project(camera);
      // Behind the camera / degenerate projection: never draw at the screen origin.
      if (!Number.isFinite(this._v.x) || !Number.isFinite(this._v.y) || this._v.z > 1 || this._v.z < -1) {
        f.el.style.opacity = '0';
        if (u >= 1) f.dead = true;
        continue;
      }
      const x = Math.max(24, Math.min(w - 24, (this._v.x * 0.5 + 0.5) * w + f.dx * age * 30));
      const y = Math.max(24, Math.min(hgt - 24, (-this._v.y * 0.5 + 0.5) * hgt));
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.6 : 1.2 - Math.min(0.2, (age - 0.12) * 1.5);
      f.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${pop})`;
      f.el.style.opacity = String(u < 0.75 ? 1 : Math.max(0, 1 - (u - 0.75) / 0.25));
      if (u >= 1) f.dead = true;
    }
    for (const f of this.floats.filter((x) => x.dead)) f.el.remove();
    this.floats = this.floats.filter((x) => !x.dead);
    if (this.bannerT) {
      const u = (t - this.bannerT.t0) / this.bannerT.life;
      const a = u < 0 ? 0 : u < 0.15 ? u / 0.15 : u > 0.75 ? Math.max(0, 1 - (u - 0.75) / 0.25) : 1;
      this.banner.style.opacity = String(a);
      this.banner.style.transform = `translate(-50%, 0) scale(${0.96 + Math.min(1, u * 4) * 0.04})`;
      if (u > 1) this.bannerT = null;
    }
  }

  dispose() {
    this.log.dispose();
    this.closeMenu();
    this.root.remove();
  }
}

export function describeHealth(c) {
  if (c.hp.cur <= 0) return 'Down';
  const p = c.hp.cur / c.hp.max;
  return p >= 1 ? 'Unhurt' : p > 0.66 ? 'Scratched' : p > 0.33 ? 'Wounded' : 'Near death';
}

function hdText(c) {
  const hd = c.ref?.hd;
  return hd === undefined ? '' : hd < 1 ? 'HD ½' : `HD ${hd}${c.ref.hpBonus ? (c.ref.hpBonus > 0 ? `+${c.ref.hpBonus}` : c.ref.hpBonus) : ''}`;
}

/** Monsters show their number as a badge (the full name is in the tooltip). */
function monsterNo(n) {
  const m = /(\d+)$/.exec(n);
  return m ? m[1] : '';
}

function shortName(n) {
  const parts = n.split(' ');
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) return `${parts[0].slice(0, 6)} ${parts[parts.length - 1]}`;
  return parts[0] === 'Brother' ? parts[1] : parts[0];
}

export function fmtMp(v) {
  const r = Math.round(v * 2) / 2;
  return Number.isInteger(r) ? String(r) : `${Math.floor(r)}½`;
}
