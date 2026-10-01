import { portraitURL, portraitKey, hasPortrait } from './portraitPainter.js';

/**
 * Portrait <img>s that never block the UI: a cached portrait shows at once;
 * an unpainted one shows a placeholder and is painted on a later tick, one
 * at a time (a panel full of thumbnails stays responsive on slow GPUs).
 * Screenshot/debug runs paint synchronously so shots stay deterministic.
 */

let sync = false;
/** Scenes call this on enter: true under the debug/screenshot URL API. */
export function setPortraitSync(v) {
  sync = !!v;
}

const queue = [];
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const job = queue.shift();
    if (job) job();
    if (queue.length) setTimeout(step, 0);
    else pumping = false;
  };
  setTimeout(step, 16);
}

/**
 * @param {object} ch
 * @param {number} scale
 * @param {{crop?: 'head'|'torso', alt?: string}} [o]
 * @returns {HTMLImageElement}
 */
export function portraitImg(ch, scale = 1, o = {}) {
  const img = document.createElement('img');
  img.alt = o.alt ?? '';
  img.draggable = false;
  const crop = o.crop ?? 'head';
  if (sync || hasPortrait(ch, scale, crop)) {
    img.src = portraitURL(ch, scale, { crop });
    return img;
  }
  img.classList.add('pc-pending');
  const snap = { ...ch, look: ch.look ? { ...ch.look } : ch.look };
  const key = portraitKey(snap, scale, crop);
  queue.push(() => {
    if (!img.isConnected) return;
    img.src = portraitURL(snap, scale, { crop });
    img.classList.remove('pc-pending');
    void key;
  });
  pump();
  return img;
}
