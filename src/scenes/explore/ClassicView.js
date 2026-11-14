import './classicView.css';
import { h } from '../../ui/UI.js';

/**
 * Classic 1988 mode exploration view: no 3D, one flat EGA picture per square and facing,
 * swapped instantly on every step or turn, as the original did.
 *
 * Pictures live in src/assets/classic/views/ and are found by file name:
 *   <map>_<x>_<y>_<dir>.<png|gif|jpg|webp>     e.g. phlan_slums_7_11_n.png
 * (lower case; dir is n, e, s or w). A square with no picture yet keeps the last picture on
 * screen with "NO IMAGE" stamped over it, so walking still works while the set is filled in.
 */
const FILES = import.meta.glob('../../assets/classic/views/**/*.{png,gif,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' });
const VIEWS = new Map(Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase(), url]));

/** File-name key for a view. */
export const viewKey = (map, x, y, dir) => `${map}_${x}_${y}_${dir}`.toLowerCase();

/** URL of the picture for a square and facing, or null when there is none yet. */
export const viewUrl = (map, x, y, dir) => VIEWS.get(viewKey(map, x, y, dir)) ?? null;

export class ClassicView {
  /** @param {HTMLElement} [parent] the window to fill (the 1988 screen's picture window); else the UI scene layer */
  constructor(ctx, parent) {
    this.img = h('img.por-cv-img', { alt: '', draggable: false });
    this.img.style.visibility = 'hidden';
    this.stamp = h('div.por-cv-stamp', ['NO IMAGE']);
    this.label = h('div.por-cv-key');
    this.el = h('div.por-cv', [h('div.por-cv-frame', [this.img, this.stamp, this.label])]);
    if (parent) parent.append(this.el);
    else ctx.ui.mount(this.el);
    this.key = null;
  }

  /** Show the view for a square and facing (instant: no transition). */
  show(map, x, y, dir) {
    const key = viewKey(map, x, y, dir);
    if (key === this.key) return;
    this.key = key;
    const url = VIEWS.get(key);
    if (url) {
      this.img.src = url;
      this.img.style.visibility = '';
    }
    // a missing picture: the previous one stays, stamped
    this.stamp.style.display = url ? 'none' : '';
    this.label.textContent = url ? '' : key;
    this.label.style.display = url ? 'none' : '';
  }

  dispose() {
    this.el.remove();
  }
}
