import { h } from '../dom.js';
import { Frame } from './Frame.js';

/**
 * Modal dialog. Returns a promise resolving to the chosen button id
 * (or null on Escape). buttons: [{id, label, primary?}]
 * Keyboard: Enter = primary, Escape = cancel, ←/→ or Tab move between
 * buttons (focus ring). Buttons show a hotkey letter if `key` is given.
 */
export function showDialog(ui, { title = '', body = '', buttons = [{ id: 'ok', label: 'OK', primary: true }], variant = 'parchment', className = '' } = {}) {
  return new Promise((resolve) => {
    const frame = Frame({ title, variant, className: `por-dialog ${className}`.trim() });
    const content = typeof body === 'string' ? h('p', [body]) : body;
    const row = h('div.por-dialog-buttons');
    const prevFocus = document.activeElement;
    const close = (id) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prevFocus && prevFocus.isConnected) prevFocus.focus?.({ preventScroll: true });
      resolve(id);
    };
    const btns = buttons.map((b) =>
      h(`button.por-btn${b.primary ? '.primary' : ''}`, { type: 'button', onclick: () => close(b.id) }, [b.label]),
    );
    row.append(...btns);
    frame.body.append(content, row);
    const backdrop = h('div.por-modal-backdrop', { role: 'dialog', 'aria-modal': 'true' }, [frame.el]);
    const onKey = (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        e.preventDefault();
        close((i >= 0 ? buttons[i] : buttons.find((b) => b.primary) ?? buttons[0]).id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.stopPropagation();
        e.preventDefault();
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        const n = btns.length;
        btns[(((i < 0 ? 0 : i) + d) % n + n) % n].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ui.layers.modal.append(backdrop);
    const primary = btns[buttons.findIndex((b) => b.primary)] ?? btns[0];
    queueMicrotask(() => primary?.focus({ preventScroll: true }));
  });
}
