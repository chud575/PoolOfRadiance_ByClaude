import { h } from '../dom.js';
import { installSkin } from '../styles/skin.js';

// Generate the skin's procedural textures/filigree once, as soon as any UI loads.
installSkin();

/**
 * Gilt-framed panel. variant: 'blue' (default, Gold Box deep blue),
 * 'parchment', 'dark'. Returns {el, body, title}.
 * Corners carry procedural filigree (see styles/skin.js).
 */
export function Frame({ title = '', variant = 'blue', className = '', children = [] } = {}) {
  const body = h('div.por-frame-body', children);
  const titleEl = title ? h('div.por-frame-title', [title]) : null;
  const el = h(`div.por-frame.por-frame--${variant}`, { class: className }, [
    h('i.por-corner.tl'), h('i.por-corner.tr'), h('i.por-corner.bl'), h('i.por-corner.br'),
    titleEl, body,
  ]);
  watchFrameSize(el);
  return { el, body, title: titleEl };
}

/**
 * Tag a frame with data-size = wide | narrow | tiny from its width in ems, so
 * narrow panels shrink their corner filigree and clamp the title cartouche
 * instead of letting the two collide (CSS in styles/ui.css).
 * @param {HTMLElement} el
 */
let ro = null;
export function watchFrameSize(el) {
  if (typeof ResizeObserver === 'undefined' || !el) return;
  ro ??= new ResizeObserver((entries) => {
    for (const e of entries) {
      const t = /** @type {HTMLElement} */ (e.target);
      const fs = parseFloat(getComputedStyle(t).fontSize) || 16;
      const w = e.contentRect.width / fs;
      const size = w < 17 ? 'tiny' : w < 25 ? 'narrow' : 'wide';
      if (t.dataset.size !== size) t.dataset.size = size;
    }
  });
  ro.observe(el);
}
