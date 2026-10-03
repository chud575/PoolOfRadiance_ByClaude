import { portraitURL, portraitURLAsync, portraitKey, hasPortrait, portraitQuickURL } from './portraitPainter.js';
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
const rough = [];
let pumping = false;
/** True while portraits are still being painted (scenes ease off their own GPU work meanwhile). */
export function portraitsPending() {
  return pumping || queue.length > 0 || rough.length > 0;
}
function pump() {
  if (pumping) return;
  pumping = true;
  const step = async () => {
    // First a rough pass for every waiting tile (a few ms each), then the oil paintings one by one.
    const r = rough.shift();
    if (r) {
      if (r.img.isConnected && r.img.classList.contains('pc-pending')) {
        try {
          const u = portraitQuickURL(r.snap, r.crop);
          if (u && r.img.classList.contains('pc-pending')) { r.img.src = u; r.img.classList.add('pc-rough'); }
        } catch { /* keep the placeholder */ }
      }
      setTimeout(step, 0);
      return;
    }
    // Skip jobs whose <img> has left the page (the panel re-rendered).
    let job = queue.shift();
    while (job && !job.img.isConnected && job.age++ < 2) { queue.push(job); job = queue.shift(); }
    if (job && job.img.isConnected) {
      try { await job.run(); } catch { /* leave the placeholder */ }
    }
    if (queue.length || rough.length) setTimeout(step, 30);
    else pumping = false;
  };
  setTimeout(step, 0);
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

const sketches = new Map();
/**
 * An instant painted sketch of the sitter (Canvas 2D, a few ms): a dark studio wall warmed behind
 * the head, the shoulders in the character's cloth, the head and neck in its skin lit from the
 * left, the hair, beard, hood or helm blocked in as masses — a painting at its first lay-in.
 * Replaced by the rough render and then the finished oil.
 * @returns {string|null}
 */
export function sketchURL(ch, crop = 'head') {
  let app = null;
  try { app = resolveAppearance(ch); } catch { return null; }
  const key = `${portraitKey(ch, 's', crop)}`;
  if (sketches.has(key)) return sketches.get(key);
  const W = 60, H = 75;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(W * 0.62, H * 0.38, 2, W * 0.5, H * 0.5, W * 0.8);
  bg.addColorStop(0, '#5a4630'); bg.addColorStop(0.55, '#2a2018'); bg.addColorStop(1, '#0e0b09');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const torso = crop === 'torso';
  const k = torso ? 0.62 : 1;
  const cx = W * 0.5, hy = torso ? H * 0.3 : H * 0.4, hr = W * 0.17 * k;
  const lit = (x0, y0, r, hex, dark = 0.45) => {
    const gr = g.createRadialGradient(x0 - r * 0.45, y0 - r * 0.35, r * 0.1, x0, y0, r * 1.25);
    gr.addColorStop(0, hex); gr.addColorStop(1, shade(hex, dark));
    return gr;
  };
  // shoulders and chest
  const cloth = app.body === 'robe' || app.body === 'vestments' ? app.robeHex : app.clothHex;
  g.fillStyle = lit(cx, H * (torso ? 0.75 : 0.98), W * 0.42, cloth, 0.35);
  g.beginPath();
  g.ellipse(cx, H * (torso ? 0.78 : 1.02), W * (torso ? 0.34 : 0.46), H * 0.3, 0, Math.PI, 0);
  g.fill();
  // neck
  g.fillStyle = shade(app.skinHex, 0.62);
  g.fillRect(cx - hr * 0.42, hy + hr * 0.6, hr * 0.84, hr * 1.1);
  // hair behind the head (long styles)
  const long = ['long', 'wavy', 'braid'].includes(app.hair);
  if (long && !app.helm && !app.hood) {
    g.fillStyle = lit(cx, hy + hr * 0.5, hr * 1.4, app.hairHex, 0.4);
    g.beginPath(); g.ellipse(cx, hy + hr * 0.55, hr * 1.18, hr * 1.7, 0, 0, Math.PI * 2); g.fill();
  }
  if (app.hood) {
    g.fillStyle = lit(cx, hy, hr * 1.6, cloth, 0.3);
    g.beginPath(); g.ellipse(cx, hy + hr * 0.15, hr * 1.42, hr * 1.62, 0, 0, Math.PI * 2); g.fill();
  }
  // the head
  g.fillStyle = lit(cx, hy, hr, app.skinHex, 0.5);
  g.beginPath(); g.ellipse(cx, hy, hr * 0.86, hr * 1.12, 0, 0, Math.PI * 2); g.fill();
  // shadow side and the eye line
  g.fillStyle = 'rgba(40,20,20,0.18)';
  g.beginPath(); g.ellipse(cx + hr * 0.38, hy + hr * 0.1, hr * 0.42, hr * 1.0, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(30,18,14,0.45)';
  g.fillRect(cx - hr * 0.55, hy - hr * 0.12, hr * 0.38, hr * 0.12);
  g.fillRect(cx + hr * 0.15, hy - hr * 0.12, hr * 0.38, hr * 0.12);
  // hair cap, beard, helm
  if (!app.hood && !app.helm && app.hair !== 'bald') {
    g.fillStyle = lit(cx, hy - hr * 0.6, hr, app.hairHex, 0.45);
    g.beginPath(); g.ellipse(cx, hy - hr * 0.48, hr * 0.95, hr * 0.72, 0, Math.PI * 1.02, Math.PI * 1.98); g.fill();
    g.fillRect(cx - hr * 0.9, hy - hr * 0.55, hr * 1.8, hr * 0.22);
  }
  if (app.beard && app.beard !== 'none' && app.beard !== 'stubble') {
    const len = app.beard === 'long' || app.race === 'dwarf' ? 1.3 : app.beard === 'moustache' ? 0.25 : 0.75;
    g.fillStyle = lit(cx, hy + hr * 0.7, hr, app.hairHex, 0.5);
    g.beginPath(); g.ellipse(cx, hy + hr * (0.55 + len * 0.3), hr * 0.72, hr * (0.25 + len * 0.45), 0, 0, Math.PI * 2); g.fill();
  }
  if (app.helm) {
    g.fillStyle = lit(cx, hy - hr * 0.5, hr * 1.1, '#8a8e96', 0.35);
    g.beginPath(); g.ellipse(cx, hy - hr * 0.35, hr * 1.0, hr * 0.85, 0, Math.PI, 0); g.fill();
  }
  const u = c.toDataURL('image/png');
  if (sketches.size > 96) sketches.delete(sketches.keys().next().value);
  sketches.set(key, u);
  return u;
}
function shade(hex, k) {
  const v = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k));
  return `rgb(${v[0]},${v[1]},${v[2]})`;
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
  try {
    const sk = sketchURL(ch, crop);
    if (sk) img.src = sk;
    else img.style.background = placeholderStyle(ch);
  } catch { /* plain pending tile */ }
  const snap = { ...ch, look: ch.look ? { ...ch.look } : ch.look };
  void portraitKey;
  const job = { img, age: 0, retries: 0, run: async () => {
    // Painted in bands across ticks: no single long stall even on a software GPU. A failed
    // painting (null) keeps the sketch or rough tier showing and is queued again a little later.
    const u = await portraitURLAsync(snap, scale, { crop });
    if (!u) {
      if (job.retries++ < 3 && img.isConnected) setTimeout(() => { queue.push(job); pump(); }, 1500);
      return;
    }
    img.src = u;
    img.style.background = '';
    img.classList.remove('pc-pending', 'pc-rough');
  } };
  if (o.priority) { queue.unshift(job); rough.unshift({ img, snap, crop }); } else { queue.push(job); rough.push({ img, snap, crop }); }
  pump();
  return img;
}
