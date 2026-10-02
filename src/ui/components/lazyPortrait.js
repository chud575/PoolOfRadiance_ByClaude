import { portraitURL, portraitURLAsync, portraitKey, hasPortrait } from './portraitPainter.js';
import { resolveAppearance } from './lookData.js';

/**
 * Portrait <img>s that never block the UI: a cached portrait shows at once;
 * an unpainted one shows a painted placeholder (the studio backdrop with a
 * soft bust in the character's colours) and is painted on a later tick, one
 * at a time — the big hero portrait first, then thumbnails — so a panel full
 * of thumbnails stays responsive on slow GPUs. Screenshot/debug runs paint
 * synchronously so shots stay deterministic.
 */

let sync = false;
/** Scenes call this on enter: true under the debug/screenshot URL API. */
export function setPortraitSync(v) {
  sync = !!v;
}

const queue = [];
let pumping = false;
/** True while portraits are still being painted (scenes ease off their own GPU work meanwhile). */
export function portraitsPending() {
  return pumping || queue.length > 0;
}
function pump() {
  if (pumping) return;
  pumping = true;
  const step = async () => {
    // Skip jobs whose <img> has left the page (the panel re-rendered).
    let job = queue.shift();
    while (job && !job.img.isConnected && job.age++ < 2) { queue.push(job); job = queue.shift(); }
    if (job && job.img.isConnected) {
      try { await job.run(); } catch { /* leave the placeholder */ }
    }
    if (queue.length) setTimeout(step, 30);
    else pumping = false;
  };
  setTimeout(step, 16);
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/**
 * A free painted stand-in (CSS gradients, no canvas readback): a dark studio wall, a soft bust in
 * the character's cloth, a head of skin under hair — a painting not yet resolved.
 */
export function placeholderStyle(ch) {
  let app = null;
  try { app = resolveAppearance(ch); } catch { /* defaults */ }
  const skin = app?.skinHex ?? '#b98a6a', hair = app?.hairHex ?? '#3a2a1a', cloth = app?.clothHex ?? '#3a3a48';
  return [
    `radial-gradient(ellipse 30% 17% at 50% 27%, ${hair}cc 0%, ${hair}66 60%, transparent 100%)`,
    `radial-gradient(ellipse 22% 24% at 50% 44%, ${skin}dd 0%, ${skin}88 55%, transparent 100%)`,
    `radial-gradient(ellipse 60% 30% at 50% 100%, ${cloth}ee 0%, ${cloth}77 60%, transparent 100%)`,
    'radial-gradient(ellipse at 40% 30%, #3a2c22 0%, #17110d 70%, #0b0807 100%)',
  ].join(', ');
}

/**
 * @param {object} ch
 * @param {number} scale
 * @param {{crop?: 'head'|'torso', alt?: string, priority?: boolean}} [o]
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
  img.src = BLANK;
  try { img.style.background = placeholderStyle(ch); } catch { /* plain pending tile */ }
  const snap = { ...ch, look: ch.look ? { ...ch.look } : ch.look };
  void portraitKey;
  const job = { img, age: 0, run: async () => {
    // Painted in bands across ticks: no single long stall even on a software GPU.
    img.src = await portraitURLAsync(snap, scale, { crop });
    img.style.background = '';
    img.classList.remove('pc-pending');
  } };
  if (o.priority) queue.unshift(job);
  else queue.push(job);
  pump();
  return img;
}
