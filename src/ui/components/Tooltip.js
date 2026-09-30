import { h } from '../dom.js';

/**
 * Global tooltip: any element with data-tip="text" shows a styled tooltip on
 * hover (or keyboard focus). Optional data-tip-title adds a gilt heading.
 * Shows after a short delay; follows the pointer; clamps to the viewport.
 */
export class Tooltip {
  constructor(layer) {
    this.el = h('div.por-tooltip', { role: 'tooltip' });
    layer.append(this.el);
    this._target = null;
    this._timer = 0;
    const show = (t, x, y) => {
      const tip = t?.dataset.tip;
      if (!tip) return this.hide();
      if (t !== this._target) {
        this._target = t;
        this.el.replaceChildren(...(t.dataset.tipTitle ? [h('span.tt-title', [t.dataset.tipTitle])] : []), tip);
        this.el.classList.remove('show');
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.el.classList.add('show'), 260);
      }
      const px = Math.min(x + 14, window.innerWidth - this.el.offsetWidth - 8);
      const py = y + 18 + this.el.offsetHeight > window.innerHeight - 8 ? y - this.el.offsetHeight - 12 : y + 18;
      this.el.style.transform = `translate(${Math.max(8, px)}px, ${Math.max(8, py)}px)`;
    };
    this._move = (e) => show(e.target.closest?.('[data-tip]'), e.clientX, e.clientY);
    this._focus = (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (!t || !t.matches(':focus-visible')) return;
      const r = t.getBoundingClientRect();
      show(t, r.left + r.width / 2, r.bottom);
    };
    this._blur = () => this.hide();
    window.addEventListener('mousemove', this._move);
    window.addEventListener('focusin', this._focus);
    window.addEventListener('focusout', this._blur);
  }

  hide() {
    this._target = null;
    clearTimeout(this._timer);
    this.el.classList.remove('show');
  }

  dispose() {
    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('focusin', this._focus);
    window.removeEventListener('focusout', this._blur);
    this.el.remove();
  }
}
