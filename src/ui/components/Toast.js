import { h } from '../dom.js';

/** Transient notification (autosave, level up, etc.). */
export function toast(ui, text, { ms = 2400, kind = 'info' } = {}) {
  const el = h(`div.por-toast.por-toast--${kind}`, [text]);
  ui.layers.toast.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
  return el;
}
