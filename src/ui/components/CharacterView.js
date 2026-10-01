import './partyui.css';
import { h, clear } from '../dom.js';
import { Frame } from './Frame.js';
import { RACES } from '../../rules/races.js';
import { classSpecName } from '../../rules/classes.js';
import { renderSheet, miniPortrait, useRenderer } from './CharacterSheet.js';
import { InventoryPanel } from './Inventory.js';
import { SpellPanel } from './SpellPanel.js';
import { STAT_TIPS } from './rulesText.js';
import { deriveStats } from '../../rules/character.js';
import { UINav } from './uiNav.js';

const TABS = [['sheet', 'Sheet', 'V'], ['items', 'Items', 'I'], ['spells', 'Magic', 'M']];

/**
 * Full-screen character view (Gold Box VIEW): sheet, inventory, spells, with a
 * portrait strip to switch members and a parchment "rules lore" strip that
 * explains whatever is hovered. Mounted on the modal layer, so any scene can
 * open it (explore VIEW, camp, combat...).
 *
 * @param {import('../../core/context.js').GameContext} ctx
 * @param {{index?: number, tab?: 'sheet'|'items'|'spells', onClose?: () => void, onRest?: () => void, focus?: string}} [o]
 * @returns {{close: () => void, el: HTMLElement, setTab: (t:string) => void}}
 */
export function openCharacterView(ctx, o = {}) {
  useRenderer(ctx.render?.renderer);
  let index = Math.max(0, Math.min(ctx.game.party.length - 1, o.index ?? ctx.game.activeIndex ?? 0));
  let tab = o.tab ?? 'sheet';
  let panel = null;
  const frame = Frame({ variant: 'blue', className: 'pc-view' });
  const back = h('div.pc-view-back', [frame.el]);
  const head = h('div.pc-view-head');
  const body = h('div.pc-view-body');
  const loreBox = h('div.pc-lore');
  frame.body.append(head, body, loreBox);

  const setLore = (title, text) => {
    clear(loreBox);
    loreBox.append(h('b', [title]), text);
  };
  const defaultLore = () => {
    const ch = ctx.game.party[index];
    if (!ch) return;
    if (tab === 'sheet') {
      const t = STAT_TIPS.thac0(deriveStats(ch));
      setLore(t.title, t.text);
      body.querySelector('.pc-big:nth-child(3)')?.classList.add('lore-hl');
    } else {
      const hl = body.querySelector('.pc-item.sel, .pc-spell.sel, .pc-spell:not(.dis)');
      const d = hl?.dataset.lore ?? hl?.closest('[data-lore]')?.dataset.lore;
      if (d) {
        const [t, x] = d.split('|');
        setLore(t, x);
        if (hl.classList.contains('pc-spell')) hl.classList.add('lore-hl');
      } else setLore(tab === 'items' ? 'Items' : 'Magic', tab === 'items' ? 'Select an item. READY equips it; TRADE hands it to a companion; DROP leaves it behind.' : 'Clerics pray for spells; magic-users study their books. Choose the load-out, then rest to memorize.');
    }
  };
  body.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-lore]');
    if (!t) return;
    body.querySelectorAll('.lore-hl').forEach((x) => x.classList.remove('lore-hl'));
    t.classList.add('lore-hl');
    const [title, text] = t.dataset.lore.split('|');
    setLore(title, text);
  });
  body.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-lore]');
    if (!t) return;
    body.querySelectorAll('.lore-hl').forEach((x) => x.classList.remove('lore-hl'));
    const [title, text] = t.dataset.lore.split('|');
    setLore(title, text);
  });

  const renderHead = () => {
    clear(head);
    const ch = ctx.game.party[index];
    head.append(
      h('div.pc-tabs', TABS.map(([id, label, key]) => h(`button.pc-tab${id === tab ? '.sel' : ''}`, { onclick: () => setTab(id) }, [label, h('span.por-hk-badge', [key])]))),
      h('div.pc-view-title', [ch ? `${ch.name} — ${RACES[ch.race].name} ${classSpecName(ch.classSpec)}` : '']),
      h('div.pc-strip', ctx.game.party.map((c, i) => { const m = miniPortrait(c, { selected: i === index, onclick: () => setMember(i), tip: c.name }); m.tabIndex = 0; m.dataset.nav = '1'; return m; })),
      h('button.pc-close', { onclick: () => close() }, ['Close ', h('span.por-hk-badge', ['Esc'])]),
    );
  };

  const renderBody = () => {
    clear(body);
    const ch = ctx.game.party[index];
    if (!ch) return;
    if (tab === 'sheet') {
      panel = null;
      body.append(renderSheet(ch));
    } else if (tab === 'items') {
      panel = new InventoryPanel(ctx, () => ctx.game.party[index], { onChange: () => renderHead() });
      body.append(panel.el);
    } else {
      panel = new SpellPanel(ctx, { index, lockMember: true, onSelectMember: (i) => { index = i; renderHead(); }, onRest: o.onRest, onChange: () => renderHead() });
      body.append(panel.el);
    }
    defaultLore();
  };

  function setTab(t) {
    tab = t;
    renderHead();
    renderBody();
  }
  function setMember(i) {
    index = i;
    ctx.game.activeIndex = i;
    renderHead();
    renderBody();
  }
  const onKey = (e) => {
    if (e.target?.tagName === 'INPUT') return;
    if (ctx.ui.layers.modal.lastElementChild !== back) return; // a dialog above us has the keys
    const n = ctx.game.party.length;
    const k = e.key;
    let used = true;
    const focused = frame.el.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null;
    if (k === 'Escape') close();
    else if (k === ']' || k === 'Tab' || k === 'PageDown') setMember((index + 1) % n);
    else if (k === '[' || k === 'PageUp') setMember((index + n - 1) % n);
    else if (k.startsWith('Arrow')) {
      // Arrows walk a focus ring over the screen's controls (lists, slots, sockets, tabs).
      nav.move(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0);
    } else if ((k === 'Enter' || k === ' ') && focused && !(k === 'Enter' && focused.tagName === 'BUTTON')) focused.click();
    else if (k === 'v' || k === 'V' || k === '1') setTab('sheet');
    else if (k === 'i' || k === 'I' || k === '2') setTab('items');
    else if (k === 'm' || k === 'M' || k === '3') setTab('spells');
    else if (tab === 'items' && panel && (k === 'r' || k === 'R' || (k === 'Enter' && !focused))) panel.ready();
    else if (tab === 'items' && panel && (k === 'u' || k === 'U')) panel.use();
    else if (tab === 'items' && panel && (k === 't' || k === 'T')) panel.trade();
    else if (tab === 'items' && panel && (k === 'd' || k === 'D' || k === 'Delete')) panel.drop();
    else used = false;
    if (used) e.preventDefault();
    // The view is modal: nothing underneath (explore movement, camp hotkeys) sees the keys.
    if (used || !/^F\d+$/.test(k)) e.stopPropagation();
  };
  // Keys go to open dialogs first (they listen in the capture phase on window too).
  const keyHost = document;
  keyHost.addEventListener('keydown', onKey, true);
  const offParty = ctx.bus.on('party:changed', () => {
    if (!ctx.game.party[index]) index = 0;
  });
  // Gamepad actions (keyboard never reaches the InputManager while the view is open).
  const offPad = ctx.bus.on('input:action', ({ action }) => {
    if (closed || ctx.ui.layers.modal.lastElementChild !== back) return;
    const n = ctx.game.party.length;
    if (action === 'cancel') close();
    else if (action === 'nextMember' || action === 'strafeRight') setMember((index + 1) % n);
    else if (action === 'prevMember' || action === 'strafeLeft') setMember((index + n - 1) % n);
    else if (action === 'area') setTab(TABS[(TABS.findIndex((t) => t[0] === tab) + 1) % TABS.length][0]);
  });
  // D-pad / A on a gamepad: the same focus ring (keyboard arrows are handled in onKey).
  const nav = new UINav(ctx, { roots: () => (closed || ctx.ui.layers.modal.lastElementChild !== back ? [] : [frame.el]), modal: true });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    nav.dispose();
    keyHost.removeEventListener('keydown', onKey, true);
    offParty();
    offPad();
    back.remove();
    o.onClose?.();
  }
  renderHead();
  renderBody();
  ctx.ui.layers.modal.append(back);
  return { close, el: back, setTab, get index() { return index; } };
}
