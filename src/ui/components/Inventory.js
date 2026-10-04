import './partyui.css';
import { miniatureSnapshot } from './Miniature.js';
import { h, clear } from '../dom.js';
import { ITEMS } from '../../data/items.js';
import {
  deriveStats, equipItem, unequipItem, equipProblem, removeItem, slotOf, carriedWeight,
} from '../../rules/character.js';
import { itemName, itemValue, itemWeight, isMagical } from '../../rules/items.js';
import { useItem } from '../../rules/magicItems.js';
import { strengthTable } from '../../rules/abilities.js';
import { itemIconURL, iconFor } from './itemIcons.js';
import { lore, miniPortrait } from './CharacterSheet.js';
import { itemLore } from './itemLore.js';
import './ironSkin.js';

const miniPortraitImg = (c) => miniPortrait(c);

/** Paperdoll slots: [slot, label, icon for the empty ghost, column]. */
const DOLL = [
  ['head', 'Head', 'helm', 'L'], ['neck', 'Neck', 'amulet', 'L'], ['cloak', 'Cloak', 'cloak', 'L'], ['body', 'Armor', 'armor', 'L'],
  ['arms', 'Bracers', 'bracers', 'L'], ['ring', 'Ring', 'ring', 'L'],
  ['hand', 'Weapon', 'sword', 'R'], ['offhand', 'Shield', 'shield', 'R'], ['hands', 'Gloves', 'gauntlets', 'R'], ['waist', 'Belt', 'girdle', 'R'],
  ['feet', 'Boots', 'boots', 'R'], ['ring2', 'Ring', 'ring', 'R'], ['quiver', 'Quiver', 'arrow', 'R'],
];

const TYPE_NAMES = { weapon: 'Weapon', armor: 'Armor', shield: 'Shield', helm: 'Helm', ring: 'Ring', potion: 'Potion', scroll: 'Scroll', wand: 'Wand', ammo: 'Ammunition', gear: 'Gear', treasure: 'Treasure' };

/** Stat line for an item definition. */
export function itemStatLine(def, entry) {
  const bits = [];
  if (def.type === 'weapon') {
    bits.push(`Damage ${def.damage} / ${def.damageLarge} vs large`);
    if (def.ranged) bits.push(`range ${def.range}`);
    if (def.twoHanded) bits.push('two-handed');
  }
  if (def.type === 'armor') bits.push(`Base AC ${def.ac - (entry?.magic ?? def.magic ?? 0)}`);
  if (def.type === 'shield') bits.push(`AC −${(def.acBonus ?? 1) + (entry?.magic ?? def.magic ?? 0)}`);
  if (def.acBonus && def.type === 'ring') bits.push(`AC −${def.acBonus}, saves +${def.saveBonus ?? 0}`);
  if (def.effect && def.type === 'potion') bits.push(def.effect.startsWith('heal:') ? `Heals ${def.effect.slice(5)}` : def.effect);
  if (def.type === 'wand' && entry?.charges != null) bits.push(`${entry.charges} charges`);
  return bits.join(' · ');
}

const avgDice = (d) => {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(d ?? '').trim());
  return m ? (Number(m[1]) * (Number(m[2]) + 1)) / 2 + Number(m[3] ?? 0) : 0;
};
/** Rarity frame for an inventory entry: mundane, magic, unknown (unidentified magic), cursed, treasure. */
export function itemRarity(entry) {
  const def = ITEMS[entry.id];
  if (!def) return 'mundane';
  if (entry.cursed && entry.identified !== false) return 'cursed';
  if (isMagical(entry)) return entry.identified === false ? 'unknown' : 'magic';
  if (def.type === 'treasure') return 'treasure';
  return 'mundane';
}
/**
 * Compare an unreadied weapon/armour/shield with what fills its slot now.
 * @returns {{against: string, bits: {text: string, good: boolean}[]}|null}
 */
export function compareItem(ch, entry) {
  const def = ITEMS[entry.id];
  if (!def || entry.equipped || !['weapon', 'armor', 'shield'].includes(def.type)) return null;
  const cur = ch.inventory.find((e) => e.equipped && ITEMS[e.id] && slotOf(ITEMS[e.id]) === slotOf(def));
  const cdef = cur && ITEMS[cur.id];
  const bits = [];
  const mag = (e, d) => e?.magic ?? d?.magic ?? 0;
  if (def.type === 'weapon') {
    const a = avgDice(def.damage) + mag(entry, def);
    const b = cdef ? avgDice(cdef.damage) + mag(cur, cdef) : 1.5;
    const dd = a - b;
    if (Math.abs(dd) >= 0.05) bits.push({ text: `${dd > 0 ? '+' : ''}${dd.toFixed(1)} avg damage`, good: dd > 0 });
    const hit = mag(entry, def) - mag(cur, cdef);
    if (hit) bits.push({ text: `${hit > 0 ? '+' : ''}${hit} to hit`, good: hit > 0 });
    if (def.ranged && !cdef?.ranged) bits.push({ text: 'ranged', good: true });
    if (def.twoHanded && !cdef?.twoHanded) bits.push({ text: 'two-handed: no shield', good: false });
  } else if (def.type === 'armor') {
    const a = def.ac - mag(entry, def);
    const b = cdef ? cdef.ac - mag(cur, cdef) : 10;
    if (a !== b) bits.push({ text: `AC ${b > a ? '−' : '+'}${Math.abs(b - a)}`, good: a < b });
  } else if (def.type === 'shield') {
    const a = (def.acBonus ?? 1) + mag(entry, def);
    const b = cdef ? (cdef.acBonus ?? 1) + mag(cur, cdef) : 0;
    if (a !== b) bits.push({ text: `AC ${a > b ? '−' : '+'}${Math.abs(a - b)}`, good: a > b });
  }
  // (Readying moves an item from pack to hand; the weight carried is unchanged, so no cn line.)
  return { against: cdef ? itemName(cur) : 'nothing', bits };
}
/** Ammunition readied without a launcher that shoots it. */
export function ammoProblem(ch) {
  const eq = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]);
  const ammo = eq.find((e) => ITEMS[e.id].type === 'ammo');
  if (!ammo) return null;
  const launcher = eq.find((e) => ITEMS[e.id].type === 'weapon' && ITEMS[e.id].ammo === ammo.id);
  if (launcher) return null;
  // A bow carried in the pack is the Gold Box norm (swap to it with READY); only warn when there is none at all.
  if (ch.inventory.some((e) => ITEMS[e.id]?.ammo === ammo.id)) return null;
  return `${itemName(ammo)} readied, but no ${ammo.id === 'quarrels' ? 'crossbow' : 'bow'} to shoot them`;
}

/** Calm note when ammunition is readied and its launcher waits in the pack ("ready the Short Bow to shoot"). */
export function ammoHint(ch) {
  const eq = ch.inventory.filter((e) => e.equipped && ITEMS[e.id]);
  const ammo = eq.find((e) => ITEMS[e.id].type === 'ammo');
  if (!ammo || eq.some((e) => ITEMS[e.id].ammo === ammo.id)) return null;
  const bow = ch.inventory.find((e) => !e.equipped && ITEMS[e.id]?.ammo === ammo.id);
  return bow ? `${itemName(bow)} in the pack — ready it to shoot` : null;
}

/** Paint the paperdoll figure, dressed in what is equipped. */
function paintDoll(canvas, ch) {
  const W = 220, H = 440;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const eq = Object.fromEntries(ch.inventory.filter((e) => e.equipped && ITEMS[e.id]).map((e) => [slotOf(ITEMS[e.id]), ITEMS[e.id]]));
  const cx = 110;
  // Plinth glow.
  const glow = g.createRadialGradient(cx, 400, 10, cx, 400, 110);
  glow.addColorStop(0, 'rgba(245,217,139,0.35)');
  glow.addColorStop(1, 'rgba(245,217,139,0)');
  g.fillStyle = glow;
  g.fillRect(0, 300, W, 140);
  g.beginPath();
  g.ellipse(cx, 410, 70, 14, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fill();
  const path = new Path2D();
  // Head.
  path.ellipse(cx, 62, 22, 27, 0, 0, Math.PI * 2);
  // Torso + legs silhouette.
  const b = new Path2D();
  b.moveTo(cx - 12, 88); b.lineTo(cx + 12, 88);
  b.quadraticCurveTo(cx + 44, 94, cx + 52, 112);
  b.lineTo(cx + 64, 200); b.quadraticCurveTo(cx + 66, 236, cx + 58, 244); b.lineTo(cx + 50, 240); b.lineTo(cx + 44, 204); b.lineTo(cx + 38, 150);
  b.lineTo(cx + 36, 220); b.lineTo(cx + 32, 316); b.lineTo(cx + 34, 396); b.lineTo(cx + 8, 398); b.lineTo(cx + 6, 300); b.lineTo(cx, 238);
  b.lineTo(cx - 6, 300); b.lineTo(cx - 8, 398); b.lineTo(cx - 34, 396); b.lineTo(cx - 32, 316); b.lineTo(cx - 36, 220); b.lineTo(cx - 38, 150);
  b.lineTo(cx - 44, 204); b.lineTo(cx - 50, 240); b.lineTo(cx - 58, 244); b.quadraticCurveTo(cx - 66, 236, cx - 64, 200); b.lineTo(cx - 52, 112);
  b.quadraticCurveTo(cx - 44, 94, cx - 12, 88); b.closePath();
  path.addPath(b);
  const fill = g.createLinearGradient(0, 0, W, H);
  fill.addColorStop(0, '#2a3e7a');
  fill.addColorStop(1, '#0b1026');
  g.fillStyle = fill;
  g.fill(path);
  // Armour on the torso.
  const body = eq.body;
  if (body) {
    const metal = body.armorGroup !== 'leather' && body.armorGroup !== 'padded' && body.armorGroup !== 'studded';
    const tg = g.createLinearGradient(cx - 50, 0, cx + 50, 0);
    if (metal) { tg.addColorStop(0, '#5a606a'); tg.addColorStop(0.3, '#e8ecf0'); tg.addColorStop(0.55, '#8a909a'); tg.addColorStop(1, '#2a2e36'); }
    else { tg.addColorStop(0, '#8a5e36'); tg.addColorStop(0.4, '#6a4424'); tg.addColorStop(1, '#2e1c0c'); }
    g.save();
    g.clip(path);
    g.fillStyle = tg;
    g.fillRect(cx - 60, 90, 120, body.armorGroup === 'plate' ? 230 : 160);
    if (body.armorGroup === 'chain' || body.armorGroup === 'ring') {
      g.strokeStyle = 'rgba(20,20,26,0.35)';
      g.lineWidth = 0.8;
      for (let y = 92; y < 250; y += 4) for (let x = cx - 60 + ((y / 4) % 2) * 2.5; x < cx + 60; x += 5) { g.beginPath(); g.arc(x, y, 2, Math.PI, 0); g.stroke(); }
    }
    g.restore();
  }
  // Helm.
  if (eq.head) {
    const hg = g.createLinearGradient(cx - 24, 0, cx + 24, 0);
    hg.addColorStop(0, '#6a707a'); hg.addColorStop(0.35, '#f0f2f4'); hg.addColorStop(1, '#2a2e36');
    g.fillStyle = hg;
    g.beginPath();
    g.moveTo(cx - 25, 62); g.bezierCurveTo(cx - 26, 22, cx + 26, 22, cx + 25, 62); g.closePath();
    g.fill();
    g.fillRect(cx - 3, 58, 6, 18);
  }
  // Gilt rim + inner light.
  g.save();
  g.shadowColor = 'rgba(245,217,139,0.6)';
  g.shadowBlur = 10;
  g.strokeStyle = '#d8b25a';
  g.lineWidth = 2;
  g.stroke(path);
  g.restore();
  // Weapon in the right hand (viewer's left), shield on the left arm.
  const wpn = eq.hand;
  if (wpn) {
    g.save();
    g.translate(cx - 58, 244);
    g.rotate(-0.25);
    const long = wpn.twoHanded || wpn.weaponGroup === 'staff' || wpn.weaponGroup === 'spear' ? 170 : wpn.weaponGroup === 'dagger' ? 50 : 110;
    if (wpn.ranged && /Bow|bow/.test(wpn.weaponGroup)) {
      g.strokeStyle = '#8a5a2a';
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(-6, -90); g.quadraticCurveTo(26, 0, -6, 90); g.stroke();
      g.strokeStyle = '#e8e0cc';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(-6, -90); g.lineTo(-6, 90); g.stroke();
    } else {
      const bg = g.createLinearGradient(-4, 0, 4, 0);
      const wood = wpn.icon === 'staff' || wpn.icon === 'spear' || wpn.icon === 'mace' || wpn.icon === 'axe';
      bg.addColorStop(0, wood ? '#4a2e14' : '#6a707a'); bg.addColorStop(0.5, wood ? '#a8743e' : '#f4f6f8'); bg.addColorStop(1, wood ? '#2e1c0c' : '#3a3e46');
      g.fillStyle = bg;
      g.fillRect(-3.5, -long, 7, long);
      if (!wood) {
        g.fillStyle = '#d8b25a';
        g.fillRect(-12, -4, 24, 5);
      } else if (wpn.icon === 'mace') {
        g.fillStyle = '#9aa0aa';
        g.beginPath(); g.arc(0, -long, 11, 0, Math.PI * 2); g.fill();
      } else if (wpn.icon === 'axe') {
        g.fillStyle = '#c8ccd4';
        g.beginPath(); g.moveTo(3, -long + 4); g.quadraticCurveTo(30, -long, 28, -long + 34); g.quadraticCurveTo(18, -long + 22, 3, -long + 24); g.fill();
      }
    }
    g.restore();
  }
  if (eq.offhand) {
    g.save();
    g.translate(cx + 60, 200);
    const sg = g.createLinearGradient(-26, -40, 26, 40);
    sg.addColorStop(0, '#3a5aa8'); sg.addColorStop(1, '#101a40');
    g.beginPath();
    g.moveTo(-26, -38); g.lineTo(26, -38); g.lineTo(26, -6); g.quadraticCurveTo(22, 26, 0, 42); g.quadraticCurveTo(-22, 26, -26, -6); g.closePath();
    g.fillStyle = sg;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#d8b25a';
    g.stroke();
    g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2);
    g.fillStyle = '#e8c86a';
    g.fill();
    g.restore();
  }
}

/** A command label with its hotkey letter (the first) picked out, Gold Box style. */
function hkLabel(label) {
  return [h('span.por-hk.pc-hk', [label[0]]), label.slice(1)];
}

/**
 * Inventory panel: paperdoll, item list, detail + actions, encumbrance, coins.
 * Actions: Ready/Remove, Use, Trade (give to another member), Halve/Join stacks, Drop.
 */
export class InventoryPanel {
  /**
   * @param {import('../../core/context.js').GameContext} ctx
   * @param {() => import('../../rules/character.js').Character} getChar
   * @param {{onChange?: () => void}} [o]
   */
  constructor(ctx, getChar, o = {}) {
    this.ctx = ctx;
    this.getChar = getChar;
    this.onChange = o.onChange ?? (() => {});
    this.sel = 0;
    this.el = h('div.pc-inv');
    this.render();
  }

  get ch() {
    return this.getChar();
  }

  render() {
    const ch = this.ch;
    clear(this.el);
    if (!ch) return;
    const inv = ch.inventory;
    this.sel = Math.max(0, Math.min(this.sel, inv.length - 1));
    const s = deriveStats(ch);

    // ---- paperdoll
    const bySlot = {};
    inv.forEach((e, i) => {
      if (!e.equipped) return;
      let slot = slotOf(ITEMS[e.id]);
      if (slot === 'ring' && bySlot.ring) slot = 'ring2';
      bySlot[slot] = i;
    });
    const slotEl = ([slot, label, ghost]) => {
      const i = bySlot[slot];
      const e = inv[i];
      const def = e && ITEMS[e.id];
      const magic = e && isMagical(e) && e.identified !== false;
      return h('div.pc-slotw', [
        h(`div.pc-slot${e ? '.full' : ''}${magic ? '.magic' : ''}${e && i === this.sel ? '.sel' : ''}${e ? `.r-${itemRarity(e)}` : ''}`, {
          tabindex: '0', dataset: { ...lore(e ? { title: itemName(e), text: `${label} slot. ${itemStatLine(def, e)}` } : { title: `${label} slot`, text: 'Nothing readied here. Select an item and choose READY.' }), nav: '1' },
          onclick: () => { if (e) { this.sel = i; this.render(); } },
        }, [h('img', { src: e ? itemIconURL(iconFor(def), { magic }) : itemIconURL(ghost, { ghost: true }), alt: '' })]),
        h('span.lab', [label]),
      ]);
    };
    // The character's own miniature, dressed in what is readied; painted silhouette as a fallback.
    const snapUrl = miniatureSnapshot(ch, { w: 320, h: 640 });
    let fig;
    if (snapUrl) fig = h('img.pc-doll-mini', { src: snapUrl, alt: '', draggable: false });
    else {
      fig = h('canvas');
      paintDoll(fig, ch);
    }
    const doll = h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column' } }, [
      h('div.pc-sect-h', [h('span', ['Equipped'])]),
      h('div.pc-doll', { style: { flex: '1' } }, [
        h('div.pc-doll-col', DOLL.filter((d) => d[3] === 'L').map(slotEl)),
        h('div.pc-doll-fig', [fig]),
        h('div.pc-doll-col', DOLL.filter((d) => d[3] === 'R').map(slotEl)),
      ]),
      ammoHint(ch) ? h('div.pc-note', { dataset: lore({ title: 'Ammunition', text: 'Arrows sit readied in the quiver; READY the bow (it takes both hands, so the shield is slung) when you want to shoot.' }) }, [ammoHint(ch)]) : null,
      ammoProblem(ch) ? h('div.pc-warn', { dataset: lore({ title: 'Ammunition', text: 'Arrows need a bow and quarrels a crossbow readied in the weapon hand; otherwise they cannot be fired.' }) }, ['⚠ ', ammoProblem(ch)]) : null,
      h('div.pc-bigrow', { style: { marginTop: '0.6em', marginBottom: 0 } }, [
        h('div.pc-big', [h('span.n', [String(s.ac)]), h('span.l', ['AC'])]),
        h('div.pc-big', [h('span.n', [`${s.damage}${s.dmgBonus ? (s.dmgBonus > 0 ? `+${s.dmgBonus}` : s.dmgBonus) : ''}`]), h('span.l', ['Damage'])]),
        h('div.pc-big', [h('span.n', [String(s.move)]), h('span.l', ['Move'])]),
      ]),
    ]);

    // ---- the pack: a grid of item tiles in rarity frames, with room to spare
    const tiles = inv.map((e, i) => {
      const def = ITEMS[e.id];
      const prob = equipProblem(ch, e.id);
      const magic = isMagical(e) && e.identified !== false;
      const cmp = compareItem(ch, e);
      const tip = `${itemName(e)}${itemStatLine(def, e) ? ` — ${itemStatLine(def, e)}` : ''}${cmp && cmp.bits.length ? `. Replaces ${cmp.against}: ${cmp.bits.map((b) => b.text).join(', ')}` : ''}`;
      return h(`button.pc-tile.r-${itemRarity(e)}${i === this.sel ? '.sel' : ''}${e.equipped ? '.ready' : ''}${prob && slotOf(def) ? '.bad' : ''}`, {
        draggable: true,
        ondragstart: (ev) => { this.sel = i; ev.dataTransfer?.setData('text/plain', String(i)); },
        onclick: () => { this.sel = i; this.render(); },
        ondblclick: () => { this.sel = i; this.ready(); },
        dataset: { tip },
      }, [
        h('span.ic', [h('img', { src: itemIconURL(iconFor(def), { magic }), alt: '' })]),
        (e.qty ?? 1) > 1 ? h('span.qty', [`×${e.qty}`]) : null,
        e.equipped ? h('span.rd', ['Ready']) : null,
        h('span.nm', [itemName(e)]),
      ]);
    });
    // The pack grid fits its contents (one spare row); the space below holds the selected item's lore.
    const capacity = Math.max(18, Math.ceil((inv.length + 1) / 6) * 6);
    for (let k = inv.length; k < capacity; k++) tiles.push(h('div.pc-tile.empty'));
    const weightNow = carriedWeight(ch);
    const list = h('div.pc-sect.pc-items', [
      h('div.pc-sect-h', [h('span', [`Pack · ${inv.length} item${inv.length === 1 ? '' : 's'} carried (${inv.filter((e) => e.equipped).length} readied) · ${weightNow} cn`])]),
      h('div.pc-pack', tiles),
      this._loreCard(ch, inv[this.sel]),
      h('div.pc-legend', [['mundane', 'Common'], ['magic', 'Magic'], ['unknown', 'Unidentified'], ['cursed', 'Cursed'], ['treasure', 'Treasure']].map(([k, l]) => h(`span.r-${k}`, [h('i'), l]))),
      this._tradeStrip(ch),
    ]);

    // ---- detail + actions
    const e = inv[this.sel];
    const def = e && ITEMS[e.id];
    const detail = [];
    if (e) {
      const prob = equipProblem(ch, e.id);
      const magic = isMagical(e) && e.identified !== false;
      // The parchment card under the pack carries the item's art, lore, weight, value and effect;
      // this box is the order panel: can this member use it, what readying it changes, the commands.
      const slot = slotOf(def);
      const SLOT_NAMES = { hand: 'weapon hand', offhand: 'shield arm', body: 'body', head: 'head', neck: 'neck', cloak: 'shoulders', feet: 'feet', hands: 'hands', arms: 'forearms', waist: 'waist', ring: 'ring finger', ammo: 'quiver' };
      const inSlot = slot ? inv.find((o) => o !== e && o.equipped && slotOf(ITEMS[o.id]) === slot) : null;
      detail.push(h('div.pc-order-h', [
        h('div.t', [itemName(e)]),
        h('div.s', [e.equipped ? `Readied · ${SLOT_NAMES[slot] ?? 'worn'}` : slot ? `In the pack · goes on the ${SLOT_NAMES[slot] ?? slot}` : `In the pack · ${TYPE_NAMES[def.type] ?? def.type}`]),
      ]));
      detail.push(h('div.pc-kv', [
        h('span.k', ['Usable']), h('span.v', { style: { color: prob && slot ? '#ff9a86' : 'var(--por-green)' } }, [slot ? (prob ? prob : 'yes') : def.type === 'potion' || def.type === 'scroll' || def.type === 'wand' ? 'use' : '—']),
        h('span.k', ['Weight']), h('span.v', [`${(def.weight ?? 0) * (e.qty ?? 1)} cn`]),
      ]));
      const cmp = compareItem(ch, e);
      detail.push(h('div.pc-compare', [
        h('div.h', [cmp ? `Replaces: ${cmp.against}` : e.equipped ? 'Readied now' : slot ? `Replaces: ${inSlot ? itemName(inSlot) : 'nothing'}` : 'Carried']),
        cmp && cmp.bits.length ? h('div.b', cmp.bits.map((b) => h(`span.${b.good ? 'up' : 'down'}`, [b.good ? '▲ ' : '▼ ', b.text])))
          : h('div.b', [h('span', [cmp ? 'No difference' : e.equipped ? (itemStatLine(def, e) || 'Worn') : slot ? (itemStatLine(def, e) || 'Fills an empty slot') : 'Weight only'])]),
      ]));
      const usable = ['potion', 'scroll', 'wand'].includes(def.type);
      const qty = e.qty ?? 1;
      const joinable = inv.some((o, j) => j !== this.sel && o.id === e.id && !o.equipped);
      detail.push(h('div.pc-actions', [
        // The Gold Box item line, every command on its letter (R U T D H J), as in the original.
        h('button.por-btn.primary.pc-hkbtn', { disabled: !slotOf(def) || (!!prob && !e.equipped), onclick: () => this.ready(), dataset: { tip: `${e.equipped ? 'Remove' : 'Ready'} (R)` } }, hkLabel(e.equipped ? 'Remove' : 'Ready')),
        h('button.por-btn.pc-hkbtn', { disabled: !usable, onclick: () => this.use(), dataset: { tip: 'Use (U)' } }, hkLabel('Use')),
        h('button.por-btn.pc-hkbtn', { disabled: this.ctx.game.party.length < 2, onclick: () => this.trade(), dataset: { tip: 'Trade (T): give to another member' } }, hkLabel('Trade')),
        h('button.por-btn.pc-hkbtn', { disabled: !!(e.equipped && e.cursed), onclick: () => this.drop(), dataset: { tip: 'Drop (D)' } }, hkLabel('Drop')),
        h('button.por-btn.pc-hkbtn', { disabled: qty < 2, onclick: () => this.halve(), dataset: { tip: 'Halve (H): split the stack in two' } }, hkLabel('Halve')),
        h('button.por-btn.pc-hkbtn', { disabled: !joinable, onclick: () => this.join(), dataset: { tip: 'Join (J): merge with a matching stack' } }, hkLabel('Join')),
      ]));
    }
    const str = strengthTable(s.abilities.str, s.abilities.strPct);
    const limits = [350, 700, 1050, 1500].map((v) => v + str.weight);
    const max = limits[3] * 1.1;
    const weight = carriedWeight(ch);
    const enc = h('div.pc-sect', { dataset: lore({ title: `Encumbrance: ${s.encumbrance.label}`, text: `Carrying ${weight} coins' weight. Movement falls from 12 to 9, 6 and 3 as you pass ${limits.join(', ')} cn (strength ${str.weight >= 0 ? '+' : ''}${str.weight}). Coins weigh 1 cn each.` }) }, [
      h('div.pc-sect-h', [h('span', ['Burden'])]),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', marginBottom: '0.35em' } }, [
        h('span', { style: { color: 'var(--por-cyan)' } }, [s.encumbrance.label]),
        h('span', { style: { color: 'var(--por-text-dim)' } }, [`${weight} / ${limits[0]} cn · move ${s.move}`]),
      ]),
      h('div.pc-bar.enc', [
        h('i', { style: { width: `${Math.min(100, (weight / max) * 100)}%` } }),
        ...limits.map((l) => h('span.tick', { style: { left: `${(l / max) * 100}%` } })),
      ]),
    ]);
    const coins = ch.coins ?? {};
    const purse = h('div.pc-sect', [
      h('div.pc-sect-h', [h('span', ['Purse'])]),
      h('div.pc-coins', [['pp', coins.pp ?? 0], ['gp', ch.gold ?? 0], ['ep', coins.ep ?? 0], ['sp', coins.sp ?? 0], ['cp', coins.cp ?? 0]].map(([k, v]) =>
        h('div.pc-coin', [h('div.n', [String(v)]), h('div.l', [k.toUpperCase()])]))),
    ]);
    const side = h('div.pc-detail', [h('div.pc-sect', { style: { display: 'flex', flexDirection: 'column', gap: '0.7em' } }, [h('div.pc-sect-h', [h('span', ['Orders'])]), ...detail]), enc, purse]);
    this.el.append(doll, list, side);
  }

  /** The selected item, illuminated: a large plate of its art on parchment, its lore and its rules. */
  _loreCard(ch, e) {
    const def = e && ITEMS[e.id];
    if (!def) return h('div.pc-itemlore.empty', [h('p', ['Select an item to read its lore.'])]);
    const magic = isMagical(e) && e.identified !== false;
    const stat = itemStatLine(def, e);
    return h(`div.pc-itemlore.r-${itemRarity(e)}`, [
      h('div.plate', [h('img', { src: itemIconURL(iconFor(def), { magic }), alt: '' })]),
      h('div.txt', [
        h('div.t', [itemName(e)]),
        h('div.s', [`${TYPE_NAMES[def.type] ?? def.type} · ${itemWeight(e)} cn · ${itemValue(e)} gp${e.equipped ? ' · readied' : ''}`]),
        h('p.d', [itemLore(e)]),
        stat ? h('p.r', [stat]) : null,
      ]),
    ]);
  }

  /** Companions as trade targets: click (or drop an item on) a portrait to hand the selected item over. */
  _tradeStrip(ch) {
    const others = this.ctx.game.party.filter((c) => c !== ch && c.status !== 'dead');
    if (!others.length) return null;
    return h('div.pc-trade', [
      h('div.h', ['Hand to a companion — click a portrait, or drag an item onto it']),
      h('div.row', others.map((c) => {
        const s2 = deriveStats(c);
        const w = carriedWeight(c);
        const cap = 1500 + (strengthTable(s2.abilities.str, s2.abilities.strPct).weight ?? 0);
        const give = () => this.giveTo(c);
        return h('button.pc-tradee', {
          onclick: give,
          ondragover: (ev) => ev.preventDefault(),
          ondrop: (ev) => { ev.preventDefault(); const i = Number(ev.dataTransfer?.getData('text/plain')); if (!Number.isNaN(i)) this.sel = i; give(); },
          dataset: { tip: `Give the selected item to ${c.name} (${w} cn carried)` },
        }, [
          miniPortraitImg(c),
          h('span.nm', [c.name.split(' ').slice(-1)[0]]),
          h('span.pc-bar.enc', [h('i', { style: { width: `${Math.min(100, (w / cap) * 100)}%` } })]),
        ]);
      })),
    ]);
  }

  giveTo(to) {
    const ch = this.ch;
    const e = ch.inventory[this.sel];
    if (!e || !to) return;
    if (e.equipped && !unequipItem(ch, this.sel)) return this.ctx.ui.toast('It will not come off — cursed!');
    const moved = removeItem(ch, this.sel);
    if (!moved) return;
    to.inventory.push({ ...moved, equipped: false });
    this._changed(`${ch.name} hands the ${itemName(moved)} to ${to.name}.`);
  }

  _changed(msg, kind = 'info') {
    if (msg) this.ctx.ui.message(msg, kind);
    this.ctx.game.notifyPartyChanged();
    this.onChange();
    this.render();
  }

  ready() {
    const ch = this.ch;
    const e = ch.inventory[this.sel];
    if (!e) return;
    const def = ITEMS[e.id];
    if (e.equipped) {
      if (!unequipItem(ch, this.sel)) return this.ctx.ui.toast('It will not come off — cursed!');
      return this._changed(`${ch.name} puts away the ${itemName(e)}.`);
    }
    const prob = equipProblem(ch, e.id);
    if (prob) return this.ctx.ui.toast(`${ch.name}: ${prob}`);
    if (!equipItem(ch, this.sel)) return this.ctx.ui.toast('Cannot ready that now.');
    this.ctx.audio?.sfx?.('click');
    this._changed(`${ch.name} readies the ${itemName(e)}${def.type === 'armor' ? ' and buckles it on' : ''}.`);
  }

  use() {
    const ch = this.ch;
    const r = useItem(this.ctx.rng, ch, this.sel, [ch], { context: 'camp' });
    if (!r.ok) return this.ctx.ui.toast(r.reason ?? 'Nothing happens.');
    this._changed(r.log.join(' ') || `${ch.name} uses the item.`, 'loot');
  }

  async trade() {
    const ch = this.ch;
    const e = ch.inventory[this.sel];
    const others = this.ctx.game.party.filter((c) => c !== ch && c.status !== 'dead');
    if (!e || !others.length) return;
    const pick = await this.ctx.ui.dialog({
      title: 'Trade',
      variant: 'blue',
      body: h('p.pc-trade-pick', [`Give the ${itemName(e)} to whom?`]),
      buttons: [...others.map((c) => ({ id: c.id, label: c.name })), { id: null, label: 'Cancel' }],
    });
    const to = others.find((c) => c.id === pick);
    if (!to) return;
    if (e.equipped && !unequipItem(ch, this.sel)) return this.ctx.ui.toast('It will not come off — cursed!');
    const moved = removeItem(ch, this.sel);
    if (!moved) return;
    to.inventory.push({ ...moved, equipped: false });
    this._changed(`${ch.name} hands the ${itemName(moved)} to ${to.name}.`);
  }

  async drop() {
    const ch = this.ch;
    const e = ch.inventory[this.sel];
    if (!e) return;
    const ok = this.ctx.settings?.get?.('confirmDangerous') === false
      ? 'drop'
      : await this.ctx.ui.dialog({ title: 'Drop', variant: 'blue', body: h('p', [`Leave the ${itemName(e)} behind for good?`]), buttons: [{ id: 'drop', label: 'Drop', primary: true }, { id: null, label: 'Keep' }] });
    if (ok !== 'drop') return;
    const gone = removeItem(ch, this.sel);
    if (!gone) return this.ctx.ui.toast('It will not come off — cursed!');
    this._changed(`${ch.name} drops the ${itemName(gone)}.`);
  }

  halve() {
    const ch = this.ch;
    const e = ch.inventory[this.sel];
    if (!e || (e.qty ?? 1) < 2) return;
    const half = Math.floor(e.qty / 2);
    e.qty -= half;
    ch.inventory.splice(this.sel + 1, 0, { ...e, qty: half, equipped: false });
    this._changed();
  }

  join() {
    const ch = this.ch;
    const e = ch.inventory[this.sel];
    if (!e) return;
    for (let j = ch.inventory.length - 1; j >= 0; j--) {
      const o = ch.inventory[j];
      if (o !== e && o.id === e.id && !o.equipped && o.magic === e.magic) {
        e.qty = (e.qty ?? 1) + (o.qty ?? 1);
        ch.inventory.splice(j, 1);
      }
    }
    this.sel = ch.inventory.indexOf(e);
    this._changed();
  }
}
