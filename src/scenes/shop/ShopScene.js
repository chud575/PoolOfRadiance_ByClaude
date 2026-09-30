import { Scene } from '../../core/Scene.js';
import { h, clear, Frame, CommandBar, PartyRoster } from '../../ui/UI.js';
import { SHOPS } from '../../data/shops.js';
import { ITEMS } from '../../data/items.js';
import { addItem, canEquip } from '../../rules/character.js';

/**
 * Shop / Temple / Training Hall (placeholder shop implementation).
 * params: {shop: string}
 * Owned by the world-content workstream (stock/services) + party-UI (inventory).
 */
export default class ShopScene extends Scene {
  async enter(params = {}) {
    this.shop = SHOPS[params.shop ?? 'phlan_armory'] ?? SHOPS.phlan_armory;
    this.post = {};
    this.list = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.15em 1.5em', maxHeight: '52vh', overflowY: 'auto', paddingRight: '0.5em' } });
    this.gold = h('div.por-muted');
    const frame = Frame({ title: this.shop.name, variant: 'parchment', children: [
      h('p', { style: { fontStyle: 'italic', margin: '0 0 1em' } }, [`${this.shop.keeper}: “${this.shop.greeting}”`]),
      this.list,
      h('div', { style: { marginTop: '0.8em' } }, [this.gold]),
    ] });
    frame.el.style.cssText = 'position:absolute;left:4vw;top:8vh;width:min(46em,60vw);';
    const roster = new PartyRoster(this.ctx);
    const rf = Frame({ title: 'Party', children: [roster.el] });
    rf.el.style.cssText = 'position:absolute;right:4vw;top:8vh;width:17em;';
    const bar = new CommandBar([
      { id: 'buy', label: 'Buy', key: 'B', onSelect: () => this.ctx.ui.message('Click an item to buy it for the selected character.', 'system') },
      { id: 'sell', label: 'Sell', key: 'S', disabled: true },
      { id: 'appraise', label: 'Appraise', key: 'A', disabled: true },
      { id: 'exit', label: 'Exit', key: 'X', onSelect: () => this.ctx.scenes.goto('explore', {}) },
    ], { title: 'Shop' });
    this.ctx.ui.mount(frame.el);
    this.ctx.ui.mount(rf.el);
    this.ctx.ui.mount(h('div.por-hud-bottom', [bar.el]));
    this.own(() => { roster.dispose(); bar.dispose(); });
    this.listen('party:changed', () => this.refresh());
    this.listen('input:action', ({ action }) => action === 'cancel' && this.ctx.scenes.goto('explore', {}));
    this.refresh();
  }

  refresh() {
    const ch = this.ctx.game.activeCharacter;
    clear(this.list);
    this.list.append(h('span.por-stat-label', { style: { color: '#6a4a1a' } }, ['Item']), h('span.por-stat-label', { style: { color: '#6a4a1a' } }, ['Cost']), h('span.por-stat-label', { style: { color: '#6a4a1a' } }, ['']));
    for (const id of this.shop.stock ?? []) {
      const it = ITEMS[id];
      const cost = Math.ceil(it.cost * (this.shop.markup ?? 1));
      const usable = ch ? canEquip(ch, id) || !['weapon', 'armor', 'shield'].includes(it.type) : false;
      this.list.append(
        h('span', { style: { opacity: usable ? 1 : 0.5 } }, [it.name]),
        h('span', { style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, [`${cost} gp`]),
        h('button.por-btn', { style: { padding: '0.15em 0.8em', fontSize: '0.75em' }, disabled: !ch || ch.gold < cost, onclick: () => this.buy(id, cost) }, ['Buy']),
      );
    }
    this.gold.textContent = ch ? `${ch.name} carries ${ch.gold} gold pieces.` : 'No party.';
  }

  buy(id, cost) {
    const ch = this.ctx.game.activeCharacter;
    if (!ch || ch.gold < cost) return;
    ch.gold -= cost;
    addItem(ch, id);
    this.ctx.audio.sfx('coins');
    this.ctx.ui.message(`${ch.name} buys ${ITEMS[id].name}.`, 'loot');
    this.ctx.game.notifyPartyChanged();
  }
}
