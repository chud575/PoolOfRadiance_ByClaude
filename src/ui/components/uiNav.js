/**
 * Keyboard and gamepad navigation for the party screens: arrow keys / the
 * D-pad move a visible focus ring between the options of the active panel
 * (spatially — the nearest control in that direction, so grids, lists and
 * command lines all work), Enter / Space / A activates it, Esc / B goes
 * back. Only arrow, numpad and pad codes navigate, so WASD and the Gold Box
 * letter hotkeys keep their meaning. Mouse users never see the ring.
 *
 *   const nav = new UINav(ctx, { roots: () => [panelEl, barEl], onBack, autofocus: true })
 *   nav.focusFirst(); nav.dispose();
 */

const FOCUSABLE = 'button:not([disabled]), [data-nav]:not([disabled]), input:not([disabled]), select:not([disabled])';
const NAV_CODE = /^(Arrow|Numpad[2468]|pad:)/;
const DIRS = { forward: [0, -1], back: [0, 1], turnLeft: [-1, 0], turnRight: [1, 0] };

function visible(el) {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && st.pointerEvents !== 'none';
}

export class UINav {
  /**
   * @param {import('../../core/context.js').GameContext} ctx
   * @param {{roots: () => (HTMLElement|null)[], onBack?: () => void, autofocus?: boolean, modal?: boolean}} o
   *   modal: the roots live in the modal layer (otherwise navigation pauses while a modal is open)
   */
  constructor(ctx, o) {
    this.ctx = ctx;
    this.o = o;
    this.off = ctx.bus.on('input:action', (e) => this._onAction(e));
    this._mouse = () => this._clearRing();
    window.addEventListener('mousedown', this._mouse, true);
    if (o.autofocus) queueMicrotask(() => this.focusFirst(true));
  }

  _active() {
    const modal = this.ctx.ui?.layers?.modal;
    const roots = (this.o.roots() ?? []).filter(Boolean);
    if (!roots.length) return null;
    if (!this.o.modal && modal && modal.children.length && !roots.some((r) => modal.contains(r))) return null;
    return roots;
  }

  items() {
    const roots = this._active();
    if (!roots) return [];
    return roots.flatMap((r) => [...r.querySelectorAll(FOCUSABLE)]).filter(visible);
  }

  _clearRing() {
    for (const el of document.querySelectorAll('.kb-focus')) el.classList.remove('kb-focus');
  }

  focus(el, ring = true) {
    if (!el) return;
    this._clearRing();
    if (ring) el.classList.add('kb-focus');
    el.focus({ preventScroll: true });
    if (ring) {
      const r = el.getBoundingClientRect();
      this._last = { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent };
    }
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** Focus the selected option of the panel (or its first control). */
  focusFirst(ring = true) {
    const items = this.items();
    if (!items.length) return;
    const sel = items.find((el) => el.classList.contains('sel') || el.classList.contains('primary')) ?? items[0];
    this.focus(sel, ring);
  }

  /**
   * After a panel re-renders (choosing an option rebuilds it), put the ring
   * back on the same option — or the control now nearest where it was.
   */
  _restore() {
    const L = this._last;
    if (!L) return false;
    const items = this.items();
    if (!items.length) return false;
    let best = null;
    let bestD = Infinity;
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - L.x, r.top + r.height / 2 - L.y) - (el.textContent === L.text ? 60 : 0);
      if (d < bestD) { bestD = d; best = el; }
    }
    if (!best) return false;
    this.focus(best, true);
    return true;
  }

  _current(items) {
    const a = document.activeElement;
    return items.includes(a) ? a : null;
  }

  move(dx, dy) {
    const items = this.items();
    if (!items.length) return false;
    const cur = this._current(items);
    if (!cur) {
      if (!this._restore()) this.focusFirst(true);
      return true;
    }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      const vx = ex - cx, vy = ey - cy;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const across = Math.abs(vx * dy - vy * dx);
      // Prefer controls overlapping the current one's row/column.
      const overlap = dx ? (r.bottom > r0.top && r.top < r0.bottom ? 0 : 1) : (r.right > r0.left && r.left < r0.right ? 0 : 1);
      const score = along + across * 2.2 + overlap * 400;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best, true);
    return !!best;
  }

  _onAction({ action, code, event }) {
    if (!this._active()) return;
    if (event?.target && /INPUT|TEXTAREA/.test(event.target.tagName) && !/^pad:/.test(code ?? '')) return;
    const d = DIRS[action];
    if (d && NAV_CODE.test(code ?? '')) {
      this.move(d[0], d[1]);
      return;
    }
    if (action === 'confirm') {
      const items = this.items();
      const cur = this._current(items);
      // Enter on a focused button already clicks it natively.
      if (cur && !(code === 'Enter' && cur.tagName === 'BUTTON')) cur.click();
      else if (!cur && /^pad:/.test(code ?? '')) this.focusFirst(true);
      // Keep the ring through the re-render the choice may cause.
      if (cur) setTimeout(() => { if (!this._current(this.items()) && this._active()) this._restore(); }, 80);
      return;
    }
    if (action === 'cancel' && this.o.onBack) this.o.onBack();
  }

  dispose() {
    this.off?.();
    window.removeEventListener('mousedown', this._mouse, true);
  }
}
