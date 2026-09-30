import { h } from '../dom.js';

/**
 * Transient notification (autosave, level up, etc.) — a gilt cartouche that
 * drops in at the top centre. kind: 'info' | 'warn'.
 */
export function toast(ui, text, { ms = 2400, kind = 'info' } = {}) {
  const el = h(`div.por-toast.por-toast--${kind}`, { role: 'status' }, [text]);
  ui.layers.toast.append(el);
  while (ui.layers.toast.children.length > 3) ui.layers.toast.firstChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
  return el;
}
