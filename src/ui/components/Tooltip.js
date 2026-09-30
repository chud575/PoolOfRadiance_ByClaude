import { h } from '../dom.js';

/** Global tooltip: any element with data-tip="text" shows a styled tooltip on hover. */
export class Tooltip {
  constructor(layer) {
    this.el = h('div.por-tooltip');
    layer.append(this.el);
    this._move = (e) => {
      const t = e.target.closest?.('[data-tip]');
      const tip = t?.dataset.tip;
      if (!tip) {
        this.el.classList.remove('show');
        return;
      }
      this.el.textContent = tip;
      this.el.classList.add('show');
      const x = Math.min(e.clientX + 14, window.innerWidth - this.el.offsetWidth - 8);
      const y = Math.min(e.clientY + 18, window.innerHeight - this.el.offsetHeight - 8);
      this.el.style.transform = `translate(${x}px, ${y}px)`;
    };
    window.addEventListener('mousemove', this._move);
  }

  dispose() {
    window.removeEventListener('mousemove', this._move);
    this.el.remove();
  }
}
