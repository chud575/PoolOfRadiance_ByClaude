import './shop.css';
import { Scene } from '../../core/Scene.js';
import { h, clear, Frame, CommandBar, MessageLog } from '../../ui/UI.js';
import { SHOPS, DEITIES } from '../../data/shops.js';
import { ITEMS } from '../../data/items.js';
import { NPCS } from '../../data/npcs.js';
import { getJournalEntry } from '../../data/journal.js';
import {
  addItem, canEquip, equipProblem, deriveStats, slotOf, unequipItem, removeItem, isAlive,
  trainableClasses, trainingCost, trainLevels, maxLevel, dualClassChoices, dualClass,
} from '../../rules/character.js';
import { itemName, itemValue, encumbranceCategory } from '../../rules/items.js';
import { TEMPLE_SERVICES, serviceApplies, serviceProblem, performService } from '../../rules/temple.js';
import { trainingSpellChoices, learnSpell } from '../../rules/camp.js';
import { SPELL_RULES } from '../../rules/spells.js';
import { CLASSES, splitClasses, xpForLevel, thac0For, savesFor, spellSlots } from '../../rules/classes.js';
import { itemIconURL, iconFor } from '../../ui/components/itemIcons.js';
import { itemArtURL } from '../../ui/art/itemArt.js';
import { portraitURL } from '../../ui/components/portraitPainter.js';
import { paintPanel, framedPortraitURL, PanelOverlay, npcActor } from '../../ui/art/index.js';

/**
 * Shops, temples, the training hall and taverns of New Phlan.
 * params: {shop: id, tab?: 'buy'|'sell'|'services'|'train'|'tavern', item?: id, member?: n}
 *
 * Gold Box structure (a keeper, a list, BUY / SELL / APPRAISE / POOL / EXIT on
 * the command line) with modern comforts: item cards with icons, a detail card
 * that compares against what the selected character has equipped, who-can-use
 * portraits, per-character purses with POOL / SHARE.
 */
const FILTERS = {
  all: () => true,
  weapons: (d) => d.type === 'weapon' && !d.ranged,
  missile: (d) => (d.type === 'weapon' && d.ranged) || d.type === 'ammo',
  armour: (d) => ['armor', 'shield', 'helm'].includes(d.type),
  magic: (d) => ['potion', 'scroll', 'wand', 'ring', 'cloak', 'bracers', 'gauntlets', 'amulet'].includes(d.type) || !!d.magic,
  other: (d) => ['gear', 'treasure'].includes(d.type),
};
/** A party tab fits about nine letters: "Brother Aldric" → "Aldric". */
export const shortName = (n = '') => (n.length > 9 && n.includes(' ') ? n.split(' ').slice(-1)[0] : n);
/** The hall's fee, shown before anyone is ready (rules.trainingCost is 0 until a class can train; PoR charges 1,000 gp). */
const fee = (m) => trainingCost(m) || 1000;
const FILTER_NAMES = { all: 'All', weapons: 'Melee', missile: 'Missile', armour: 'Armour', magic: 'Magic', other: 'Goods' };
const TYPE_NAMES = { weapon: 'Weapon', armor: 'Body armour', shield: 'Shield', helm: 'Helm', ring: 'Ring', potion: 'Potion', scroll: 'Scroll', wand: 'Wand', ammo: 'Ammunition', gear: 'Gear', treasure: 'Treasure', cloak: 'Cloak', bracers: 'Bracers', gauntlets: 'Gauntlets', amulet: 'Amulet' };

const SERVICE_ICON = { cureLight: ['✚', ''], cureSerious: ['✚', ''], cureCritical: ['✚', ''], heal: ['✦', ''], cureBlindness: ['◉', 'blue'], cureDisease: ['❦', 'blue'], neutralizePoison: ['☤', 'blue'], removeCurse: ['✧', 'blue'], raiseDead: ['☥', 'red'], stoneToFlesh: ['◈', 'red'], identify: ['?', 'blue'] };
const SERVICE_DESC = {
  cureLight: 'Mends minor wounds (1d8).', cureSerious: 'Mends serious wounds (2d8+1).', cureCritical: 'Mends grievous wounds (3d8+3).', heal: 'Restores the body entirely.',
  cureBlindness: 'Restores sight.', cureDisease: 'Purges sickness and rot.', neutralizePoison: 'Draws poison from the blood.', removeCurse: 'Lifts curses and cursed items.',
  raiseDead: 'Calls the soul back to its body. It may refuse.', stoneToFlesh: 'Returns the petrified to life.', identify: 'Names a magical item\'s true nature.',
};

export default class ShopScene extends Scene {
  async enter(params = {}) {
    const { ctx } = this;
    this.shop = SHOPS[params.shop ?? 'phlan_armory'] ?? SHOPS.phlan_armory;
    if (this.shop.kind === 'hall') {
      // City Hall is a conversation, not a counter.
      queueMicrotask(() => ctx.scenes.goto('dialogue', { script: this.shop.script }));
      return;
    }
    this.post = {};
    if (Number.isFinite(Number(params.member))) ctx.game.activeIndex = Number(params.member);
    const kind = this.shop.kind;
    this.tab = params.tab ?? { temple: 'services', training: 'train', tavern: 'tavern' }[kind] ?? 'buy';
    this.filter = 'all';
    this.selId = params.item ?? null;
    this.selIdx = null;
    this.t0 = ctx.clock.time;
    this._build();
    this.listen('party:changed', () => this.refresh());
    this.listen('input:action', ({ action }) => this._onAction(action));
    this._say(this.shop.greeting);
    this.refresh();
    ctx.audio.playMusic?.(kind === 'tavern' ? 'tavern' : 'town');
    // resolve only once every portrait/icon has decoded, so the first frame is final
    await Promise.all([...this.root.querySelectorAll('img')].map((i) => i.decode?.().catch(() => {})));
  }

  // ------------------------------------------------------------------ DOM
  _build() {
    const { ctx } = this;
    const deity = this.shop.deity ? DEITIES[this.shop.deity] : null;
    const { canvas, info, composer } = paintPanel({ setting: this.shop.setting ?? 'shop', cast: this.shop.cast, deity, w: 1280, h: 600, seed: this.shop.id.length * 31, actor: npcActor(NPCS[this.shop.npc]) });
    this.composer = composer;
    const fx = h('canvas.fx', { width: 1280, height: 600 });
    this.overlay = new PanelOverlay(fx, info, 5, composer);
    this.overlay.draw(ctx.clock.time);
    const bgc = h('canvas', { width: 320, height: 150 });
    bgc.getContext('2d').drawImage(canvas, 0, 0, 320, 150);
    const artView = h('div.shp-art-view', [canvas, fx]);
    this.artCanvas = canvas;
    const art = Frame({ title: this.shop.name, variant: 'dark', className: 'shp-art', children: [artView] });
    // keeper
    const npc = NPCS[this.shop.npc];
    this.sayEl = h('div.say');
    const keeper = Frame({ variant: 'parchment', className: 'shp-keeper', children: [
      npc ? h('img.port', { src: framedPortraitURL(npc), alt: npc.name }) : null,
      h('div.who', [npc?.name ?? this.shop.keeper, npc?.title ? h('small', [npc.title]) : null]),
      this.sayEl,
      this.noteEl = h('div.note'),
    ] });
    this.detail = h('div');
    this.detailFrame = Frame({ title: 'Examine', className: 'shp-detail', children: [] });
    this.detailFrame.body.style.display = 'contents';
    this.left = h('div.shp-left', [art.el, keeper.el, this.detailFrame.el]);
    // right
    this.partyEl = h('div.shp-party');
    this.tabsEl = h('div.shp-tabs');
    this.listEl = h('div');
    this.footEl = h('div.shp-foot');
    this.cat = Frame({ title: { shop: 'Wares', temple: 'The Temple', training: 'Training', tavern: 'The Taproom' }[this.shop.kind] ?? 'Wares', className: 'shp-cat', children: [this.tabsEl, this.listEl, this.footEl] });
    this.right = h('div.shp-right', [this.partyEl, this.cat.el]);
    this.bar = new CommandBar([]);
    this.root = h('div.shp-root', [h('div.shp-bg', [bgc]), this.left, this.right, h('div.por-hud-bottom.shp-bar', [this.bar.el])]);
    ctx.ui.mount(this.root);
    this.log = new MessageLog(ctx.bus, { lines: 1 });
    this.own(() => { this.bar.dispose(); this.log.dispose(); });
  }

  /** Keeper speech with a short typewriter. */
  _say(text) {
    this.say = { text, shown: this.ctx.clock.frozen ? text.length + 2 : 0 };
    clear(this.sayEl);
    this.sayShown = h('span');
    this.sayHid = h('span.hid', [`“${text}”`]);
    this.sayEl.append(this.sayShown, this.sayHid);
    this._renderSay();
  }

  _renderSay() {
    const full = `“${this.say.text}”`;
    const n = Math.min(full.length, Math.floor(this.say.shown) + 1);
    this.sayShown.textContent = full.slice(0, n);
    this.sayHid.textContent = full.slice(n);
  }

  get member() {
    return this.ctx.game.activeCharacter;
  }

  // ------------------------------------------------------------------ refresh
  refresh() {
    this.ctx.ui.tooltip?.hide();
    this._renderParty();
    this._renderTabs();
    clear(this.listEl);
    clear(this.footEl);
    this.listEl.className = '';
    if (this.tab === 'buy' || this.tab === 'sell') this._renderItems();
    else if (this.tab === 'services') this._renderServices();
    else if (this.tab === 'train') this._renderTraining();
    else if (this.tab === 'tavern') this._renderTavern();
    this._renderFoot();
    this._renderDetail();
    this._renderNote();
    this._renderBar();
  }

  _renderParty() {
    const { game } = this.ctx;
    clear(this.partyEl);
    game.party.forEach((ch, i) => {
      const pct = Math.max(0, ch.hp.cur) / ch.hp.max;
      const st = !isAlive(ch) || ch.hp.cur <= 0 ? 'down' : pct < 0.34 ? 'low' : '';
      this.partyEl.append(h(`div.shp-member${i === game.activeIndex ? '.sel' : ''}${ch.status === 'dead' ? '.dead' : ''}${st ? `.${st}` : ''}`, {
        onclick: () => { game.activeIndex = i; game.notifyPartyChanged(); },
        dataset: { tip: `${ch.name} — ${ch.hp.cur}/${ch.hp.max} hp, ${ch.gold} gp` },
      }, [h('img', { src: portraitURL(ch, 0.4), alt: '' }), h('span.nm', [shortName(ch.name)]), h('span.gp', [`${ch.gold} gp`]), h('i.hpbar', [h('i', { style: { width: `${pct * 100}%` } })])]));
    });
  }

  _renderTabs() {
    clear(this.tabsEl);
    const tabs = [];
    const k = this.shop.kind;
    if (k === 'temple') tabs.push(['services', 'Healing']);
    if (k === 'training') tabs.push(['train', 'Training']);
    if (k === 'tavern') tabs.push(['tavern', 'Taproom']);
    if (this.shop.stock?.length) tabs.push(['buy', 'Buy']);
    if (this.shop.buys?.length || k === 'shop') tabs.push(['sell', 'Sell']);
    for (const [id, label] of tabs) this.tabsEl.append(h(`button.shp-tab${this.tab === id ? '.on' : ''}`, { onclick: () => this.setTab(id) }, [label]));
    this.tabsEl.append(h('span.sp'));
    if (this.tab === 'buy' || this.tab === 'sell') {
      for (const f of Object.keys(FILTERS)) {
        if (f !== 'all' && !this._pool().some((x) => FILTERS[f](ITEMS[x.id]))) continue;
        this.tabsEl.append(h(`button.shp-chip${this.filter === f ? '.on' : ''}`, { onclick: () => { this.filter = f; this.refresh(); } }, [FILTER_NAMES[f]]));
      }
    }
  }

  setTab(id) {
    this.tab = id;
    this.filter = 'all';
    this.selId = null;
    this.selIdx = null;
    this.refresh();
  }

  _price(id) {
    return Math.max(1, Math.ceil((ITEMS[id].cost ?? 0) * (this.shop.markup ?? 1)));
  }

  _salePrice(entry) {
    const d = ITEMS[entry.id];
    if (!d || d.quest) return 0;
    return Math.floor(itemValue(entry) / 2);
  }

  /** Items shown in the current tab: [{id, idx?, entry?}] */
  _pool() {
    if (this.tab === 'sell') {
      const ch = this.member;
      return (ch?.inventory ?? []).map((e, idx) => ({ id: e.id, idx, entry: e })).filter((x) => ITEMS[x.id] && (!this.shop.buys || this.shop.buys.includes(ITEMS[x.id].type)));
    }
    return (this.shop.stock ?? []).map((id) => ({ id }));
  }

  _renderItems() {
    const ch = this.member;
    this.listEl.className = 'shp-list';
    const items = this._pool().filter((x) => FILTERS[this.filter](ITEMS[x.id]));
    if (this.tab === 'buy' && !this.selId && items.length) this.selId = items[0].id;
    if (this.tab === 'sell' && this.selIdx == null && items.length) this.selIdx = items[0].idx;
    for (const x of items) {
      const d = ITEMS[x.id];
      const sell = this.tab === 'sell';
      const price = sell ? this._salePrice(x.entry) : this._price(x.id);
      const usable = !ch || !['weapon', 'armor', 'shield', 'helm'].includes(d.type) || canEquip(ch, x.id);
      const poor = !sell && ch && ch.gold < price;
      const sel = sell ? this.selIdx === x.idx : this.selId === x.id;
      const name = sell ? itemName(x.entry) : d.name;
      const el = h(`div.shp-item${sel ? '.sel' : ''}${usable ? '' : '.cant'}${poor ? '.poor' : ''}`, {
        onclick: () => { if (sell) this.selIdx = x.idx; else this.selId = x.id; this.refresh(); },
        ondblclick: () => (sell ? this.sell() : this.buy()),
        dataset: { tip: usable ? statLine(d) : `${ch?.name} cannot use this: ${equipProblem(ch, x.id) ?? ''}` },
      }, [
        h('img', { src: itemArtURL(d, { magic: !!d.magic, size: 80 }) ?? itemIconURL(iconFor(d), { magic: !!d.magic || ['potion', 'scroll', 'wand', 'ring'].includes(d.type) }), alt: '' }),
        h('span.n', [name, sell && x.entry.equipped ? h('span.eq', ['READY']) : null, sell && (x.entry.qty ?? 1) > 1 ? ` ×${x.entry.qty}` : '']),
        h('span.s', [statLine(d, x.entry)]),
        h('span.p', [price ? `${price.toLocaleString('en-US')}` : '—', h('small', [price ? 'gp' : 'no sale'])]),
      ]);
      this.listEl.append(el);
    }
    // keep the selection in view without leaving a half-clipped row at the top:
    // scroll by whole rows (the bottom edge fades out under a mask)
    const list = this.listEl;
    const snap = () => {
      const sel = list.querySelector('.shp-item.sel');
      if (!sel || !list.clientHeight) return;
      const tops = [...new Set([...list.querySelectorAll('.shp-item')].map((e) => e.offsetTop))].sort((a, b) => a - b);
      const base = tops[0] ?? 0;
      const bottom = sel.offsetTop + sel.offsetHeight - base;
      const pad = 24;
      let top = 0;
      for (const t of tops) { if (bottom - (t - base) <= list.clientHeight - pad) { top = t - base; break; } }
      list.scrollTop = top;
      list.classList.toggle('scrolled', top > 0);
    };
    snap();
    requestAnimationFrame(snap);
    list.onscroll = () => list.classList.toggle('scrolled', list.scrollTop > 2);
    if (!items.length) this.listEl.append(h('div.shp-empty', [this.tab === 'sell' ? `${ch?.name ?? 'No one'} carries nothing ${this.shop.name} will buy.` : 'Nothing for sale.']));
  }

  _renderFoot() {
    const { game } = this.ctx;
    const ch = this.member;
    const total = game.party.reduce((t, c) => t + c.gold, 0);
    this.footEl.append(
      h('span', [`${ch?.name ?? '—'} carries `, h('b', [`${(ch?.gold ?? 0).toLocaleString('en-US')} gp`])]),
      h('span', ['Party ', h('b', [`${total.toLocaleString('en-US')} gp`])]),
      h('span.sp'),
      h('button.por-btn', { onclick: () => this.pool(), dataset: { tip: 'Gather all the party\'s gold into this character\'s purse' } }, ['Pool']),
      h('button.por-btn', { onclick: () => this.share(), dataset: { tip: 'Divide the party\'s gold evenly' } }, ['Share']),
    );
  }

  _renderDetail() {
    const card = this.detailFrame.el;
    for (const n of [...card.children]) if (!n.classList.contains('por-corner') && !n.classList.contains('por-frame-title')) n.remove();
    const add = (...els) => card.append(...els.filter(Boolean));
    const ch = this.member;
    if (this.tab === 'services') {
      this.detailFrame.title.textContent = 'The Afflicted';
      this._detailParty(add);
      return;
    }
    if (this.tab === 'train') {
      this.detailFrame.title.textContent = 'The Master\'s Book';
      this._detailTraining(add);
      return;
    }
    if (this.tab === 'tavern') {
      this.detailFrame.title.textContent = 'Tonight in the Room';
      this._detailPatrons(add);
      return;
    }
    this.detailFrame.title.textContent = 'Examine';
    let id = this.selId;
    let entry = null;
    if (this.tab === 'sell' && this.selIdx != null) {
      entry = ch?.inventory[this.selIdx];
      id = entry?.id;
    }
    const d = id ? ITEMS[id] : null;
    if (!d) {
      add(h('div.desc', { style: { gridColumn: '1 / -1', color: 'var(--por-text-dim)', fontStyle: 'italic' } }, ['Select an item to examine it.']));
      return;
    }
    add(
      h('div.icon', [h('img', { src: itemArtURL(d, { magic: !!d.magic, size: 160 }) ?? itemIconURL(iconFor(d), { magic: !!d.magic }), alt: '' })]),
      h('div.name', [entry ? itemName(entry) : d.name]),
      h('div.kind', [`${TYPE_NAMES[d.type] ?? d.type}${d.twoHanded ? ' · two-handed' : ''}${d.ranged ? ` · range ${d.range}` : ''} · ${d.weight} cn · `, h('b', { style: { color: 'var(--por-amber)', fontStyle: 'normal' } }, [`${(this.tab === 'sell' ? this._salePrice(entry) : this._price(id)).toLocaleString('en-US')} gp`])]),
    );
    if (d.desc) add(h('div.desc', [d.desc]));
    // stats with comparison against the member's current gear
    const stats = h('div.shp-stats');
    if (ch && ['weapon', 'armor', 'shield', 'helm', 'ring', 'cloak', 'bracers', 'gauntlets'].includes(d.type) && canEquip(ch, id)) {
      const now = deriveStats(ch);
      const then = previewStats(ch, id);
      if (d.type === 'weapon') {
        stats.append(stat('Damage', then.damage, now.damage !== then.damage ? `now ${now.damage}` : '', 0));
        stats.append(stat('To hit (THAC0)', then.thac0, deltaText(now.thac0 - then.thac0), now.thac0 - then.thac0));
        stats.append(stat('Attacks', then.attacks ?? 1, '', 0));
      } else {
        stats.append(stat('Armour class', then.ac, deltaText(now.ac - then.ac), now.ac - then.ac));
        stats.append(burdenBar(now, then));
      }
    } else {
      if (d.type === 'weapon') stats.append(stat('Damage', `${d.damage} / ${d.damageLarge}`, '', 0));
      if (d.type === 'armor') stats.append(stat('Base AC', d.ac - (d.magic ?? 0), '', 0));
      if (d.effect && (d.type === 'potion' || d.type === 'scroll' || d.type === 'wand')) stats.append(stat('Effect', effectName(d.effect), '', 0));
      if (d.charges) stats.append(stat('Charges', entry?.charges ?? d.charges, '', 0));
    }
    if (stats.children.length) add(stats);
    // who can use it
    const users = h('div.shp-users', [h('span.l', ['Usable by'])]);
    for (const m of this.ctx.game.party) {
      const ok = !['weapon', 'armor', 'shield', 'helm'].includes(d.type) || canEquip(m, id);
      users.append(h(`div.shp-user.${ok ? 'yes' : 'no'}`, { dataset: { tip: ok ? `${m.name} can use it` : `${m.name}: ${equipProblem(m, id) ?? 'cannot use'}` } }, [h('img', { src: portraitURL(m, 0.4), alt: '' })]));
    }
    add(users);
  }

  _detailParty(add) {
    const party = this.ctx.game.party;
    const list = h(`div.shp-company${party.length > 3 ? '.two' : ''}`, { style: { gridColumn: '1 / -1' } });
    party.forEach((m, i) => {
      const pct = Math.max(0, m.hp.cur) / m.hp.max;
      const st = m.status !== 'ok' && m.status ? m.status : m.hp.cur <= 0 ? 'unconscious' : pct < 0.5 ? 'wounded' : 'hale';
      const col = st === 'hale' ? 'var(--por-green)' : st === 'dead' ? 'var(--por-blood)' : 'var(--por-amber)';
      list.append(h(`div.shp-mate${i === this.ctx.game.activeIndex ? '.sel' : ''}`, {
        onclick: () => { this.ctx.game.activeIndex = i; this.ctx.game.notifyPartyChanged(); },
        dataset: { tip: `${m.name}: ${m.hp.cur} / ${m.hp.max} hp${m.conditions?.length ? ` · ${m.conditions.join(', ')}` : ''}` },
      }, [
        h('img', { src: portraitURL(m, 0.4), alt: '' }),
        h('span.t', [m.name]),
        h('span.st', { style: { color: col } }, [st]),
        h('span.hp', [`${Math.max(0, m.hp.cur)}/${m.hp.max}`]),
        h(`i.bar.${st === 'hale' ? 'ok' : st === 'wounded' ? 'low' : 'down'}`, [h('i', { style: { width: `${pct * 100}%` } })]),
      ]));
    });
    add(list);
  }

  // ------------------------------------------------------------------ temple
  _renderServices() {
    const ch = this.member;
    this.listEl.className = 'shp-rows';
    for (const [id, cost] of Object.entries(this.shop.services ?? {})) {
      const s = TEMPLE_SERVICES[id];
      if (!s) continue;
      const applies = ch ? serviceApplies(id, ch) : false;
      const needers = this.ctx.game.party.filter((m) => serviceApplies(id, m));
      const [icon, tone] = SERVICE_ICON[id] ?? ['✚', ''];
      const anyone = needers.length > 0;
      if (!anyone) {
        // Rules reason when someone would need it but cannot be helped (elves cannot be raised).
        const why = this.ctx.game.party.map((m) => serviceProblem(id, m)).find((r) => r && r !== 'Not needed.');
        (this._others ??= []).push(h('div.shp-row.mini', { dataset: { tip: `${SERVICE_DESC[id] ?? ''} ${why ?? 'No one in the party needs this now.'}` } }, [h(`span.ic${tone ? `.${tone}` : ''}`, [icon]), h('span.t', [s.name]), h('span.c', [`${cost.toLocaleString('en-US')} gp`])]));
        continue;
      }
      this.listEl.append(h(`div.shp-row${applies ? '' : '.off'}`, [
        h(`span.ic${tone ? `.${tone}` : ''}`, [icon]),
        h('span.t', [s.name, needers.length ? h('span.shp-need', needers.map((m) => h('img', { src: portraitURL(m, 0.4), alt: '', dataset: { tip: `${m.name} needs this` } }))) : null]),
        h('span.d', [SERVICE_DESC[id] ?? '']),
        h('span.c', [`${cost.toLocaleString('en-US')} gp`]),
        h('button.por-btn', { disabled: !applies || (ch?.gold ?? 0) < cost, onclick: () => this.service(id, cost), dataset: { tip: !applies ? (ch && serviceProblem(id, ch) !== 'Not needed.' ? `${ch.name}: ${serviceProblem(id, ch)}` : `${ch?.name ?? 'This character'} does not need this.`) : (ch?.gold ?? 0) < cost ? `${ch.name} needs ${(cost - ch.gold).toLocaleString('en-US')} gp more — POOL the party's gold.` : `Pay ${cost} gp` } }, ['Request']),
      ]));
    }
    if (this._others?.length) {
      this.listEl.append(h('div.shp-subhead', ['Other services of the temple']), h('div.shp-minis', this._others));
    }
    this._others = null;
    // the god's creed fills the foot of the board: a carved tablet over the offering box
    const god = DEITIES[this.shop.deity];
    if (god?.creed) {
      const creed = h('div.shp-creed', { dataset: { deity: this.shop.deity } }, [
        h('div.shp-creed-head', [h('b', [`${god.name}, ${god.title}`]), h('small', [god.domain ?? ''])]),
        h('ol', god.creed.map((c) => h('li', [c]))),
        god.tithe ? h('p', [god.tithe]) : null,
      ]);
      // custom properties must go through setProperty (h()'s style object assigns plain keys only)
      creed.style.setProperty('--god', god.banner ?? '#1d3574');
      creed.style.setProperty('--sign', `'${{ scales: '⚖', heart: '\u2661', sword: '⚔', hand: '✋', fist: '✊' }[god.symbol] ?? '✦'}'`);
      this.listEl.append(creed);
    }
  }

  service(id, cost) {
    const { game, rng, ui } = this.ctx;
    const ch = this.member;
    if (!ch || !serviceApplies(id, ch)) return;
    if (ch.gold < cost) {
      this._say(`The tithe is ${cost} gold. ${ch.name} carries only ${ch.gold}. Perhaps your companions will POOL their coin.`);
      return;
    }
    ch.gold -= cost;
    const r = performService(rng, id, ch);
    ui.message(r.text, r.ok ? 'info' : 'warn');
    this._say(r.ok ? `${r.text} ${DEITIES[this.shop.deity]?.name ?? 'The god'} be praised.` : r.text);
    this.ctx.audio.sfx?.(r.ok ? 'heal' : 'bump');
    game.notifyPartyChanged();
  }

  // ------------------------------------------------------------------ training
  _renderTraining() {
    this.listEl.className = 'shp-rows';
    for (const [i, m] of this.ctx.game.party.entries()) {
      const classes = splitClasses(m.classSpec);
      const ready = trainableClasses(m);
      const cost = fee(m);
      const cls = classes[0];
      const lvl = m.levels[cls];
      const atMax = lvl >= maxLevel(m, cls);
      const cur = xpForLevel(cls, lvl);
      const next = xpForLevel(cls, lvl + 1);
      const pct = atMax ? 1 : Math.max(0, Math.min(1, (m.xp[cls] - cur) / Math.max(1, next - cur)));
      const lbl = atMax ? 'At the limit of what can be taught' : ready.length ? 'Ready to train' : `${(next - m.xp[cls]).toLocaleString('en-US')} xp to go`;
      this.listEl.append(h(`div.shp-row.shp-train${i === this.ctx.game.activeIndex ? '.sel' : ''}${ready.length ? '.ready' : ''}`, { onclick: () => { this.ctx.game.activeIndex = i; this.ctx.game.notifyPartyChanged(); } }, [
        h('img', { src: portraitURL(m, 0.4), alt: '' }),
        h('span.t', [m.name]),
        h('span.d', [classes.map((c) => `${CLASSES[c].name} ${m.levels[c]}${ready.includes(c) ? ` → ${m.levels[c] + 1}` : ''}`).join(' / ')]),
        h('div.shp-xp', [h(`span.lbl${ready.length ? '.ready' : ''}`, [lbl]), h('div.bar', [h('i', { style: { width: `${pct * 100}%` } })])]),
        h('button.por-btn', { disabled: !ready.length || m.gold < cost, dataset: { tip: atMax ? `${m.name} has learned all the hall can teach.` : !ready.length ? `${m.name} needs more experience first. The fee will be ${cost.toLocaleString('en-US')} gp.` : m.gold < cost ? `${m.name} carries ${m.gold} gp — POOL the party's gold.` : `Pay ${cost.toLocaleString('en-US')} gp and train` }, onclick: (e) => { e.stopPropagation(); this.train(m); } }, [atMax ? 'Mastered' : ready.length ? `Train · ${cost.toLocaleString('en-US')} gp` : h('span.lock', ['Not ready'])]),
      ]));
    }
  }

  train(m) {
    const { rng, ui, game } = this.ctx;
    const cost = trainingCost(m);
    if (!trainableClasses(m).length) return;
    if (m.gold < cost) return this._say(`Training costs ${cost} gold. Come back with your purse full.`);
    m.gold -= cost;
    const raised = trainLevels(m, rng);
    const txt = `${m.name} trains hard and rises to ${raised.map((c) => `${CLASSES[c].name} ${m.levels[c]}`).join(' / ')}!`;
    ui.message(txt, 'loot');
    this._say(`${txt} Garrick claps ${m.name} on the shoulder. "Better. Still slow on the left."`);
    // PoR rule: a magic-user who trains a level adds one new spell to the book.
    if (raised.includes('magicUser')) this._learnNewSpell(m);
    game.notifyPartyChanged();
  }

  async _learnNewSpell(m) {
    const { ui, game } = this.ctx;
    const all = trainingSpellChoices(m);
    if (!all.length) return;
    // Highest spell level first (the new power), at most six choices.
    const lvl = (id) => SPELL_RULES[id].schools.magicUser;
    const choices = [...all].sort((a, b) => lvl(b) - lvl(a)).slice(0, 6);
    const pick = await ui.dialog({
      title: 'A New Spell', variant: 'blue',
      body: `The masters of the hall open their books to ${m.name}. Choose one spell to scribe.`,
      buttons: choices.map((id, i) => ({ id, label: `${SPELL_RULES[id].name} (${lvl(id)})`, primary: i === 0 })),
    });
    if (!pick) return;
    const r = learnSpell(m, pick);
    ui.message(r.ok ? `${m.name} scribes ${SPELL_RULES[pick].name} into the spell book.` : `${m.name} cannot learn that: ${r.reason}.`, r.ok ? 'loot' : 'warn');
    game.notifyPartyChanged();
  }

  // ------------------------------------------------------------------ tavern
  _renderTavern() {
    this.listEl.className = 'shp-rows';
    const drink = this.shop.drink ?? 1;
    const opts = [
      ['❦', 'Ale and stew for the company', `${Math.max(1, Math.ceil(drink * 0.5 * this.ctx.game.party.length / 3))} gp`, 'A copper a mug, two for the bowl, and a heel of black bread. Half an hour by the fire.', () => this.supper()],
      ['✦', `Buy a round for the house`, `${drink * 6} gp`, 'The fastest friends in Phlan are the ones you are paying for.', () => this.round()],
      ['❧', 'Ask about rumours', `${drink} gp`, 'Keep your ears open and your cup full.', () => this.rumour()],
      ['☾', 'Rest by the fire', 'free', 'An hour\'s warmth, if you keep your cup in your hand.', () => { this.ctx.game.advanceTime(60); this._say('You sit a while by the fire, and the ache goes out of your bones. For a while.'); }],
    ];
    for (const [ic, t, c, d, fn] of opts) {
      this.listEl.append(h('div.shp-row', [h('span.ic', [ic]), h('span.t', [t]), h('span.d', [d]), h('span.c', [c]), h('button.por-btn', { onclick: fn }, ['Choose'])]));
    }
    this.listEl.append(h('div.shp-rumor', [this.lastRumour ?? this.shop.ambience ?? 'The room is loud with dice and old songs. Someone is always just about to tell a story.']));
    // bills pinned to the post by the hearth
    if (this.shop.notices?.length) {
      this.listEl.append(h('div.shp-subhead', ['Pinned by the hearth']), h('div.shp-notices', this.shop.notices.map((n, i) => h('div.shp-notice', { style: { '--rot': `${[-1.2, 0.8, -0.4, 1.1][i % 4]}deg` } }, [h('b', [n.head]), n.text]))));
    }
  }

  supper() {
    const cost = Math.max(1, Math.ceil((this.shop.drink ?? 1) * 0.5 * this.ctx.game.party.length / 3));
    const ch = this.member;
    if (!ch || ch.gold < cost) return this._say('Coin first, then the bowl.');
    ch.gold -= cost;
    this.ctx.game.advanceTime(30);
    this._say(rngLine(this.ctx.rng, ['Six bowls, six mugs. Eat — you look like the Slums chewed you and spat you out.', 'Stew\'s mutton tonight. Mostly mutton. Don\'t ask after the rest.', 'There. Hot food and a dry bench; that\'s more than the Watch gets.']));
    this.ctx.audio.sfx?.('coins');
    this.ctx.game.notifyPartyChanged();
  }

  /** Who is in the room tonight: the patrons the picture shows, each with something to say. */
  _detailPatrons(add) {
    const list = h('div.shp-patrons', { style: { gridColumn: '1 / -1' } });
    for (const p of this.shop.patrons ?? []) {
      const cost = p.cost ?? 0;
      list.append(h('div.shp-patron', [
        h('span.ic', [p.icon ?? '❧']),
        h('span.t', [p.who, h('small', [p.what])]),
        h('button.por-btn', { onclick: () => this.listenTo(p), dataset: { tip: cost ? `Buy ${p.short ?? 'them'} a drink (${cost} gp) and listen` : 'Listen in' } }, [cost ? `Buy a drink · ${cost} gp` : 'Listen']),
      ]));
    }
    if (!list.children.length) return this._detailParty(add);
    add(list);
  }

  listenTo(p) {
    const { game, ui } = this.ctx;
    const ch = this.member;
    if (p.cost) {
      if (!ch || ch.gold < p.cost) return this._say('No coin, no story.');
      ch.gold -= p.cost;
    }
    this.lastRumour = p.line;
    if (p.journal) {
      const list = (game.flags.journal ??= []);
      if (!list.includes(p.journal)) {
        list.push(p.journal);
        (game.flags.journalUnread ??= []).push(p.journal);
        ui.message(`Journal entry ${p.journal} recorded: ${getJournalEntry(p.journal)?.title ?? ''}.`, 'lore');
        this.lastRumour += ` (See Journal Entry ${p.journal}.)`;
      }
    }
    game.notifyPartyChanged();
  }

  /** The selected member's page in the weaponsmaster's book: class progress, limits, a change of class. */
  _detailTraining(add) {
    const m = this.member;
    if (!m) return;
    const classes = splitClasses(m.classSpec);
    const card = h('div.shp-book', { style: { gridColumn: '1 / -1' } });
    card.append(h('div.shp-book-head', [h('img', { src: portraitURL(m, 0.4), alt: '' }), h('div', [h('b', [m.name]), h('small', [`${m.race === 'halfElf' ? 'Half-elf' : m.race[0].toUpperCase() + m.race.slice(1)} · ${classes.map((c) => CLASSES[c].name).join(' / ')}`])])]));
    for (const c of classes) {
      const lvl = m.levels[c];
      const max = maxLevel(m, c);
      const cur = xpForLevel(c, lvl);
      const next = xpForLevel(c, lvl + 1);
      const at = lvl >= max;
      const pct = at ? 1 : Math.max(0, Math.min(1, (m.xp[c] - cur) / Math.max(1, next - cur)));
      card.append(h('div.shp-book-row', [
        h('span.c', [CLASSES[c].name]),
        h('span.l', [`Level ${lvl}`, h('small', [` of ${max}`])]),
        h('div.bar', [h('i', { style: { width: `${pct * 100}%` } })]),
        h('span.x', [at ? 'Limit' : `${m.xp[c].toLocaleString('en-US')} / ${next.toLocaleString('en-US')}`]),
      ]));
    }
    // the next page of the book: what the coming level brings (THAC0, saves, hit die, spells)
    const c0 = classes.find((c) => m.levels[c] < maxLevel(m, c)) ?? classes[0];
    const l0 = m.levels[c0];
    const l1 = Math.min(l0 + 1, maxLevel(m, c0));
    const cols = [['THAC0', (l) => thac0For(c0, l)], ['Death', (l) => savesFor(c0, l).ppdm], ['Petri.', (l) => savesFor(c0, l).pp], ['Wand', (l) => savesFor(c0, l).rsw], ['Breath', (l) => savesFor(c0, l).bw], ['Spell', (l) => savesFor(c0, l).sp]];
    const tips = ['Number needed to hit armour class 0 (lower is better)', 'Save vs paralysis, poison and death magic', 'Save vs petrification and polymorph', 'Save vs rod, staff and wand', 'Save vs breath weapon', 'Save vs spell'];
    const slots = (l) => spellSlots(c0, l).join(' / ');
    const row = (label, l, cmp) => h(`tr${cmp ? '.next' : ''}`, [h('th', [label]), ...cols.map(([, f]) => h(`td${cmp && f(l) < f(cmp) ? '.up' : ''}`, [String(f(l))]))]);
    const table = h('table.shp-book-next', [
      h('caption', [l1 > l0 ? `What level ${l1} brings` : `${CLASSES[c0].name} · at the limit`]),
      h('thead', [h('tr', [h('th'), ...cols.map(([k], i) => h('th', { dataset: { tip: tips[i] } }, [k]))])]),
      h('tbody', [row(`Level ${l0}`, l0), l1 > l0 ? row(`Level ${l1}`, l1, l0) : null]),
    ]);
    const extra = [l1 > l0 ? `Hit points +1d${CLASSES[c0].hitDie}${CLASSES[c0].hitDie >= 8 ? ' + CON' : ''}` : null, slots(l0) || slots(l1) ? `Spells ${slots(l0) || '—'}${slots(l1) !== slots(l0) ? ` → ${slots(l1)}` : ''}` : null].filter(Boolean);
    if (extra.length) table.append(h('tfoot', [h('tr', [h('td', { colSpan: 7 }, [extra.join('  ·  ')])])]));
    card.append(table);
    // humans may change class here (PHB dual-classing), for the usual fee
    const choices = m.race === 'human' && !m.dual && classes.length === 1 ? dualClassChoices(m) : [];
    if (choices.length) {
      const cost = fee(m);
      const row = h('div.shp-book-dual', [h('span.l', ['Change class'])]);
      for (const ch of choices) {
        row.append(h('button.shp-chip', { disabled: !ch.ok || m.gold < cost, onclick: () => this.changeClass(m, ch.cls, cost), dataset: { tip: ch.ok ? `Begin again as a ${CLASSES[ch.cls].name} (${cost.toLocaleString('en-US')} gp). ${CLASSES[classes[0]].name} skills return at ${CLASSES[ch.cls].name} level ${m.levels[classes[0]] + 1}.` : `${CLASSES[ch.cls].name}: ${ch.reason}` } }, [CLASSES[ch.cls].name]));
      }
      card.append(row);
    } else {
      card.append(h('div.shp-book-note', [m.race === 'human' ? (m.dual ? `Once a ${CLASSES[m.dual.from]?.name ?? 'warrior'}; the old skills wait for the new to surpass them.` : 'Multiclassed: no change of class.') : 'Only humans may abandon one calling for another.']));
    }
    add(card);
  }

  changeClass(m, cls, cost) {
    if (m.gold < cost) return this._say(`A new calling costs ${cost} gold, same as any lesson.`);
    m.gold -= cost;
    dualClass(m, cls);
    this.ctx.ui.message(`${m.name} sets aside the old ways and begins again as a ${CLASSES[cls].name}.`, 'loot');
    this._say(`"A ${CLASSES[cls].name}, is it? Then we start from the beginning. Feet apart."`);
    this.ctx.game.notifyPartyChanged();
  }

  /** A line under the keeper's speech that answers "what does this mean for me?" for the current tab. */
  _renderNote() {
    const el = this.noteEl;
    if (!el) return;
    clear(el);
    const m = this.member;
    const tab = this.tab;
    const bits = [];
    if (tab === 'tavern') {
      const fare = this.shop.fare ?? [['Ale', '1 cp'], ['Stew', '2 cp'], ['Wine', '1 sp'], ['A bed', '5 sp']];
      el.append(h('span.lbl', ['Bill of fare']), ...fare.map(([a, b]) => h('span.it', [a, h('b', [b])])));
      return;
    }
    if (tab === 'services' && m) {
      const pct = Math.max(0, m.hp.cur) / m.hp.max;
      bits.push(`${m.name}: ${Math.max(0, m.hp.cur)} / ${m.hp.max} hp`, m.status === 'dead' ? 'dead — only Raise Dead will serve' : m.hp.cur <= 0 ? 'unconscious' : pct < 1 ? `${m.hp.max - m.hp.cur} hp to mend` : 'needs no healing');
    } else if (tab === 'train' && m) {
      const ready = trainableClasses(m);
      bits.push(ready.length ? `${m.name} is ready: ${ready.map((c) => `${CLASSES[c].name} ${m.levels[c] + 1}`).join(', ')}` : `${m.name} is not yet ready to train`, `Fee ${fee(m).toLocaleString('en-US')} gp`);
    } else if ((tab === 'buy' || tab === 'sell') && m) {
      const st = deriveStats(m);
      bits.push(`${m.name}: AC ${st.ac}`, `Move ${st.move}`, `${st.encumbrance.label.toLowerCase()} (${st.weight.toLocaleString('en-US')} cn)`, `${m.gold.toLocaleString('en-US')} gp`);
    }
    for (const [i, b] of bits.entries()) el.append(h(i ? 'span.it' : 'span.lbl', [b]));
  }

  round() {
    const cost = (this.shop.drink ?? 1) * 6;
    const ch = this.member;
    if (!ch || ch.gold < cost) return this._say('No coin, no round.');
    ch.gold -= cost;
    this._say('A cheer goes up. For a moment, in here, nobody is thinking about the ruins.');
    this.ctx.game.notifyPartyChanged();
    this.rumour(true);
  }

  rumour(free = false) {
    const { rng, game, ui } = this.ctx;
    const ch = this.member;
    const cost = this.shop.drink ?? 1;
    if (!free) {
      if (!ch || ch.gold < cost) return this._say('No coin, no talk.');
      ch.gold -= cost;
    }
    const r = rng.pick(this.shop.rumors ?? [{ text: '"Nothing worth hearing tonight."' }]);
    this.lastRumour = r.text;
    if (r.journal) {
      const list = (game.flags.journal ??= []);
      if (!list.includes(r.journal)) {
        list.push(r.journal);
        (game.flags.journalUnread ??= []).push(r.journal);
        ui.message(`Journal entry ${r.journal} recorded: ${getJournalEntry(r.journal)?.title ?? ''}.`, 'lore');
        this.lastRumour += ` (See Journal Entry ${r.journal}.)`;
      }
    }
    game.notifyPartyChanged();
  }

  // ------------------------------------------------------------------ buying & selling
  buy() {
    const { ui, game } = this.ctx;
    const ch = this.member;
    const id = this.selId;
    if (!ch || !id || this.tab !== 'buy') return;
    const price = this._price(id);
    if (ch.gold < price) {
      this._say(`That's ${price} gold, and ${ch.name} has ${ch.gold}. POOL your coin, friend.`);
      this.ctx.audio.sfx?.('bump');
      return;
    }
    ch.gold -= price;
    addItem(ch, id);
    ui.message(`${ch.name} buys ${ITEMS[id].name} for ${price} gp.`, 'loot');
    this._say(rngLine(this.ctx.rng, [`A fine choice. ${ITEMS[id].name} — look after it and it'll look after you.`, 'Done. Mind the edge.', 'Pleasure doing business. Come back alive; I like repeat custom.']));
    this.ctx.audio.sfx?.('coins');
    game.notifyPartyChanged();
  }

  sell() {
    const { ui, game } = this.ctx;
    const ch = this.member;
    if (!ch || this.selIdx == null || this.tab !== 'sell') return;
    const e = ch.inventory[this.selIdx];
    if (!e) return;
    const price = this._salePrice(e);
    if (!price) return this._say('I can\'t give you anything for that.');
    if (e.equipped && e.cursed) return this._say('It won\'t come off, will it? No sale.');
    if (e.equipped) unequipItem(ch, this.selIdx);
    const name = itemName(e);
    removeItem(ch, this.selIdx);
    ch.gold += price;
    this.selIdx = null;
    ui.message(`${ch.name} sells ${name} for ${price} gp.`, 'loot');
    this._say(`${price} gold for the ${name}. Fair's fair.`);
    this.ctx.audio.sfx?.('coins');
    game.notifyPartyChanged();
  }

  appraise() {
    const ch = this.member;
    const e = this.tab === 'sell' && this.selIdx != null ? ch?.inventory[this.selIdx] : null;
    if (!e) return this._say('Show me what you want appraised — choose SELL and pick an item.');
    const v = this._salePrice(e);
    this._say(v ? `That ${itemName(e)}? I'd give you ${v} gold for it.` : 'Worthless to me, I\'m afraid.');
  }

  pool() {
    const { game } = this.ctx;
    const ch = this.member;
    if (!ch) return;
    let n = 0;
    for (const m of game.party) if (m !== ch) { n += m.gold; ch.gold += m.gold; m.gold = 0; }
    this.ctx.ui.message(`The party pools ${n} gp with ${ch.name}.`, 'info');
    game.notifyPartyChanged();
  }

  share() {
    const { game } = this.ctx;
    const alive = game.party.filter((m) => m.status !== 'dead');
    const total = game.party.reduce((t, m) => t + m.gold, 0);
    const each = Math.floor(total / Math.max(1, alive.length));
    let rem = total - each * alive.length;
    for (const m of game.party) m.gold = 0;
    for (const m of alive) m.gold = each + (rem-- > 0 ? 1 : 0);
    this.ctx.ui.message(`The party shares its gold: ${each} gp each.`, 'info');
    game.notifyPartyChanged();
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.ctx.scenes.goto('explore', {});
  }

  _renderBar() {
    const k = this.shop.kind;
    const cmds = [];
    if (k === 'temple') cmds.push({ id: 'heal', label: 'Heal', key: 'H', onSelect: () => this.setTab('services') });
    if (k === 'training') cmds.push({ id: 'train', label: 'Train', key: 'T', onSelect: () => (this.member ? this.train(this.member) : null) });
    if (k === 'tavern') {
      cmds.push({ id: 'drink', label: 'Drink', key: 'D', onSelect: () => this.round() });
      cmds.push({ id: 'rumour', label: 'Rumours', key: 'R', onSelect: () => this.rumour() });
    }
    if (this.shop.stock?.length) cmds.push({ id: 'buy', label: 'Buy', key: 'B', onSelect: () => (this.tab === 'buy' ? this.buy() : this.setTab('buy')) });
    if (k === 'shop') {
      cmds.push({ id: 'sell', label: 'Sell', key: 'S', onSelect: () => (this.tab === 'sell' ? this.sell() : this.setTab('sell')) });
      cmds.push({ id: 'appraise', label: 'Appraise', key: 'A', onSelect: () => this.appraise() });
    }
    cmds.push({ id: 'pool', label: 'Pool', key: 'P', onSelect: () => this.pool() });
    cmds.push({ id: 'exit', label: 'Exit', key: 'X', onSelect: () => this.leave() });
    this.bar.set(cmds);
  }

  _onAction(action) {
    if (action === 'cancel') this.leave();
    else if (action === 'confirm') {
      if (this.tab === 'buy') this.buy();
      else if (this.tab === 'sell') this.sell();
    } else if (action === 'forward' || action === 'back') {
      const items = this._pool().filter((x) => FILTERS[this.filter](ITEMS[x.id]));
      if (!items.length || (this.tab !== 'buy' && this.tab !== 'sell')) return;
      const cur = items.findIndex((x) => (this.tab === 'sell' ? x.idx === this.selIdx : x.id === this.selId));
      const n = (cur + (action === 'forward' ? -1 : 1) + items.length) % items.length;
      if (this.tab === 'sell') this.selIdx = items[n].idx;
      else this.selId = items[n].id;
      this.refresh();
    } else if (action === 'prevMember' || action === 'nextMember') {
      const { game } = this.ctx;
      game.activeIndex = (game.activeIndex + (action === 'nextMember' ? 1 : -1) + game.party.length) % game.party.length;
      game.notifyPartyChanged();
    }
  }

  update(dt) {
    if (!this.say) return;
    const full = this.say.text.length + 2;
    if (this.say.shown < full) {
      this.say.shown = this.ctx.clock.frozen ? full : Math.min(full, this.say.shown + dt * 60);
      this._renderSay();
    }
    if (this.overlay && (dt > 0 || !this._drawn)) {
      this.composer?.draw(this.artCanvas.getContext('2d'), this.ctx.clock.time);
      this.overlay.draw(this.ctx.clock.time);
      this._drawn = true;
    }
    if (this.artCanvas) {
      const t = this.ctx.clock.time;
      this.artCanvas.style.transform = `scale(${(1.02 + Math.sin(t * 0.07) * 0.015).toFixed(4)})`;
    }
  }
}

// ------------------------------------------------------------------ helpers

function statLine(d, entry) {
  if (d.type === 'weapon') return `${d.damage} / ${d.damageLarge}${d.ranged ? ` · range ${d.range}` : ''}${d.twoHanded ? ' · 2h' : ''}`;
  if (d.type === 'armor') return `AC ${d.ac - (entry?.magic ?? d.magic ?? 0)} · ${d.weight} cn`;
  if (d.type === 'shield') return `AC −${(d.acBonus ?? 1) + (d.magic ?? 0)}`;
  if (d.type === 'helm') return 'Protects the head';
  if (d.type === 'ammo') return `Bundle of ${d.qty ?? 20}`;
  if (d.type === 'potion') return d.effect?.startsWith('heal:') ? `Heals ${d.effect.slice(5)}` : effectName(d.effect);
  if (d.type === 'scroll' || d.type === 'wand') return effectName(d.effect);
  if (d.acBonus) return `AC −${d.acBonus}${d.saveBonus ? `, saves +${d.saveBonus}` : ''}`;
  if (d.acBase) return `Base AC ${d.acBase}`;
  return TYPE_NAMES[d.type] ?? '';
}

function effectName(e) {
  if (!e) return '';
  const [k, a] = String(e).split(':');
  const names = { heal: `Heals ${a}`, giantStrength: 'Giant strength', speed: 'Haste', neutralize: 'Cures poison', fullHeal: 'Full healing' };
  return names[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function stat(label, value, delta, sign) {
  return h('div.shp-stat', [h('span.l', [label]), h('span.v', [String(value), delta ? h(`span.d${sign > 0 ? '.up' : sign < 0 ? '.dn' : ''}`, [delta]) : null])]);
}

/**
 * Encumbrance as a bar: the four PHB weight bands (with this character's
 * strength allowance), today's load and the load after buying, and what it
 * does to the movement rate.
 */
function burdenBar(now, then) {
  const base = [350, 700, 1050, 1500];
  const allow = Number.isFinite(then.encumbrance.next) ? then.encumbrance.next - base[then.encumbrance.category] : now.encumbrance.next - base[now.encumbrance.category] || 0;
  const cuts = base.map((v) => v + (Number.isFinite(allow) ? allow : 0));
  const max = cuts[3] * 1.15;
  const pct = (w) => `${Math.min(100, (w / max) * 100).toFixed(1)}%`;
  const moves = [12, 9, 6, 3, 0];
  const bands = h('div.bands', cuts.map((c, i) => h('i', { style: { left: pct(i ? cuts[i - 1] : 0), width: `calc(${pct(c)} - ${pct(i ? cuts[i - 1] : 0)})` }, dataset: { mv: String(moves[i]) } })));
  const changed = then.move !== now.move;
  const armourCap = then.move < then.encumbrance.move;
  return h('div.shp-burden', { dataset: { tip: `Carried weight in coins (cn): ${now.weight.toLocaleString('en-US')} now, ${then.weight.toLocaleString('en-US')} with this. Move by load: ${cuts.map((c, i) => `${moves[i]} up to ${c.toLocaleString('en-US')}`).join(', ')}; beyond, 0.${armourCap ? ` This armour itself limits move to ${then.move}.` : ''}` } }, [
    h('span.l', ['Move · burden']),
    h('span.v', [String(then.move), changed ? h(`span.d.${then.move < now.move ? 'dn' : 'up'}`, [deltaText(then.move - now.move)]) : null, h('small', [` ${then.weight.toLocaleString('en-US')} cn · ${armourCap ? 'armour-bound' : then.encumbrance.label.toLowerCase()}`])]),
    h('div.track', [bands, h('i.now', { style: { width: pct(now.weight) } }), h('i.then', { style: { left: pct(Math.min(now.weight, then.weight)), width: `calc(${pct(Math.max(now.weight, then.weight))} - ${pct(Math.min(now.weight, then.weight))})` } }), ...cuts.map((c) => h('i.cut', { style: { left: pct(c) } }))]),
  ]);
}

function deltaText(n) {
  if (!n) return '';
  return n > 0 ? `▲${n}` : `▼${-n}`;
}

/** Derived stats if `ch` equipped `id` in place of whatever fills that slot. */
function previewStats(ch, id) {
  const c = structuredClone(ch);
  const def = ITEMS[id];
  const slot = slotOf(def);
  for (let i = c.inventory.length - 1; i >= 0; i--) {
    const e = c.inventory[i];
    const d = ITEMS[e.id];
    if (!e.equipped || !d) continue;
    const s = slotOf(d);
    if ((s === slot && slot !== 'ring') || (def.twoHanded && s === 'offhand') || (def.type === 'shield' && d.twoHanded)) unequipItem(c, i);
  }
  addItem(c, id, { equip: true });
  return deriveStats(c);
}

function rngLine(rng, lines) {
  return lines[rng.int(0, lines.length - 1)];
}
