import { h } from '../dom.js';
import { Frame } from './Frame.js';

/**
 * Modal dialog. Returns a promise resolving to the chosen button id
 * (or null on Escape). buttons: [{id, label, primary?}]
 */
export function showDialog(ui, { title = '', body = '', buttons = [{ id: 'ok', label: 'OK', primary: true }], variant = 'parchment' } = {}) {
  return new Promise((resolve) => {
    const frame = Frame({ title, variant, className: 'por-dialog' });
    const content = typeof body === 'string' ? h('p', [body]) : body;
    const row = h('div.por-dialog-buttons');
    const close = (id) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(id);
    };
    for (const b of buttons) row.append(h(`button.por-btn${b.primary ? '.primary' : ''}`, { type: 'button', onclick: () => close(b.id) }, [b.label]));
    frame.body.append(content, row);
    const backdrop = h('div.por-modal-backdrop', [frame.el]);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        close((buttons.find((b) => b.primary) ?? buttons[0]).id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    ui.layers.modal.append(backdrop);
  });
}
