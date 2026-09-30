import { h } from '../dom.js';

/**
 * Gilt-framed panel. variant: 'blue' (default, Gold Box deep blue),
 * 'parchment', 'dark'. Returns {el, body, title}.
 */
export function Frame({ title = '', variant = 'blue', className = '', children = [] } = {}) {
  const body = h('div.por-frame-body', children);
  const titleEl = title ? h('div.por-frame-title', [title]) : null;
  const el = h(`div.por-frame.por-frame--${variant}`, { class: className }, [
    h('i.por-corner.tl'), h('i.por-corner.tr'), h('i.por-corner.bl'), h('i.por-corner.br'),
    titleEl, body,
  ]);
  return { el, body, title: titleEl };
}
