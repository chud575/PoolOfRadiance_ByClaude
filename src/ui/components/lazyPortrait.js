import { portraitURL, portraitURLAsync, portraitKey, hasPortrait, anyPortrait } from './portraitPainter.js';
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
    // First a rough pass for every waiting tile (a few ms each), then the oil paintings one by one.
    // (The rough low-resolution tier is gone: the candle-lit silhouette holds until the oil is done.)
    // Skip jobs whose <img> has left the page (the panel re-rendered).
    let job = queue.shift();
    // Drop jobs whose <img> has left the page (the panel re-rendered); a just-built panel may not be
    // attached yet, so a job gets two more turns before it is dropped.
    let guard = queue.length + 1;
    while (job && !job.img.isConnected && guard-- > 0) { if (job.age++ < 2) queue.push(job); job = queue.shift(); }
    if (job && job.img.isConnected) {
      try { await job.run(); } catch { /* leave the placeholder */ }
    }
    if (queue.length) setTimeout(step, 30);
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
 * The stand-in while a portrait is painted (Canvas 2D, a few ms): an empty frame in a dark studio,
 * a candle burning low at the edge, and the sitter only as a warm-rimmed silhouette — head, hair,
 * helm or hood and shoulders as one shadow mass, no features. Never a blank mannequin face.
 * @returns {string|null}
 */
export function sketchURL(ch, crop = 'head') {
  let app = null;
  try { app = resolveAppearance(ch); } catch { return null; }
  const key = `${portraitKey(ch, 's', crop)}`;
  if (sketches.has(key)) return sketches.get(key);
  const W = 120, H = 150;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // the wall, warmed by the candle at lower left
  const bg = g.createRadialGradient(W * 0.2, H * 0.78, 2, W * 0.35, H * 0.6, W * 1.1);
  bg.addColorStop(0, '#7a5328'); bg.addColorStop(0.28, '#3a2614'); bg.addColorStop(0.7, '#160e09'); bg.addColorStop(1, '#070504');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // canvas weave
  g.globalAlpha = 0.07;
  for (let y = 0; y < H; y += 2) { g.fillStyle = y % 4 ? '#000' : '#b08050'; g.fillRect(0, y, W, 1); }
  g.globalAlpha = 1;
  const torso = crop === 'torso';
  const k = torso ? 0.62 : 1;
  const cx = W * 0.54, hy = torso ? H * 0.3 : H * 0.4, hr = W * 0.17 * k;
  const sil = '#0a0706';
  g.fillStyle = sil;
  // shoulders
  g.beginPath();
  g.ellipse(cx, H * (torso ? 0.8 : 1.04), W * (torso ? 0.36 : 0.48), H * 0.3, 0, Math.PI, 0);
  g.fill();
  g.fillRect(cx - hr * 0.45, hy + hr * 0.5, hr * 0.9, hr * 1.4);
  // head mass with its hair, helm or hood
  g.beginPath();
  if (app.hood) g.ellipse(cx, hy + hr * 0.1, hr * 1.35, hr * 1.55, 0, 0, Math.PI * 2);
  else if (app.helm) g.ellipse(cx, hy - hr * 0.08, hr * 1.06, hr * 1.22, 0, 0, Math.PI * 2);
  else g.ellipse(cx, hy, hr * 0.9, hr * 1.14, 0, 0, Math.PI * 2);
  g.fill();
  if (!app.hood && !app.helm && ['long', 'wavy', 'braid'].includes(app.hair)) {
    g.beginPath(); g.ellipse(cx, hy + hr * 0.6, hr * 1.1, hr * 1.5, 0, 0, Math.PI * 2); g.fill();
  }
  if (app.beard && !['none', 'stubble', 'moustache'].includes(app.beard)) {
    g.beginPath(); g.ellipse(cx, hy + hr * 1.05, hr * 0.62, hr * (app.race === 'dwarf' || app.beard === 'long' ? 0.95 : 0.5), 0, 0, Math.PI * 2); g.fill();
  }
  // candle rim along the lit (left) edge of the silhouette
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const rim = g.createLinearGradient(cx - hr * 1.5, 0, cx - hr * 0.6, 0);
  rim.addColorStop(0, 'rgba(255,170,80,0.55)'); rim.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = rim;
  g.fillRect(0, 0, cx, H);
  g.restore();
  // the candle
  const fx = W * 0.12, fy = H * 0.78;
  g.fillStyle = '#d8c8a0'; g.fillRect(fx - 3, fy, 6, H - fy);
  const glow = g.createRadialGradient(fx, fy - 5, 0, fx, fy - 5, 26);
  glow.addColorStop(0, 'rgba(255,220,140,0.85)'); glow.addColorStop(0.25, 'rgba(255,160,60,0.35)'); glow.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(fx, fy - 5, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff3c8'; g.beginPath(); g.ellipse(fx, fy - 6, 2.2, 5.5, 0, 0, Math.PI * 2); g.fill();
  // vignette
  const v = g.createRadialGradient(W * 0.5, H * 0.5, W * 0.3, W * 0.5, H * 0.5, W * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
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
 * The last finished painting shown in each portrait slot (a slot is a sitter, or a named picker
 * tile): while a new face is painted the slot keeps showing its last good image, never a
 * placeholder. Creation's head picker passes its own slot per tile; everything else is keyed by
 * the sitter, so switching members in VIEW or opening REST shows the face at once (a smaller
 * copy, scaled) until the full-size painting lands.
 */
const lastGood = new Map();
function slotOf(ch, crop, o) {
  if (o.slot) return `${o.slot}|${crop}`;
  return `${ch.id || ch.name || 'draft'}|${crop}`;
}
function keep(slot, url) {
  if (!url || url === BLANK) return;
  if (lastGood.size > 120) lastGood.delete(lastGood.keys().next().value);
  lastGood.delete(slot);
  lastGood.set(slot, url);
}

/**
 * @param {object} ch
 * @param {number} scale
 * @param {{crop?: 'head'|'torso', alt?: string, priority?: boolean, slot?: string}} [o]
 * @returns {HTMLImageElement}
 */
export function portraitImg(ch, scale = 1, o = {}) {
  const img = document.createElement('img');
  img.alt = o.alt ?? '';
  img.draggable = false;
  const crop = o.crop ?? 'head';
  const slot = slotOf(ch, crop, o);
  if (sync || hasPortrait(ch, scale, crop)) {
    img.src = portraitURL(ch, scale, { crop });
    keep(slot, img.src);
    return img;
  }
  // The same face already painted at another size: show it at once (the browser scales it), and
  // repaint at this size only when the cached one is smaller than wanted.
  const near = anyPortrait(ch, crop);
  if (near && near.scale >= scale) {
    img.src = near.url;
    keep(slot, near.url);
    return img;
  }
  img.classList.add('pc-pending');
  img.src = BLANK;
  try {
    // Prefer the same face at a smaller size, then this slot's last finished painting (the previous
    // head in a picker, the sitter's thumbnail), and only then the candle-lit sketch.
    const prev = lastGood.get(slot);
    const sk = near ? near.url : prev ?? sketchURL(ch, crop);
    if (sk) img.src = sk;
    else img.style.background = placeholderStyle(ch);
    if (near || prev) img.classList.add('pc-stale');
  } catch { /* plain pending tile */ }
  const snap = { ...ch, look: ch.look ? { ...ch.look } : ch.look };
  const job = { img, age: 0, retries: 0, run: async () => {
    // Painted in bands across ticks: no single long stall even on a software GPU. A failed
    // painting (null) keeps what is showing and is queued again a little later.
    const u = await portraitURLAsync(snap, scale, { crop });
    if (!u) {
      if (job.retries++ < 3 && img.isConnected) setTimeout(() => { queue.push(job); pump(); }, 1500);
      return;
    }
    img.src = u;
    keep(slot, u);
    img.style.background = '';
    img.classList.remove('pc-pending', 'pc-rough', 'pc-stale');
    img.classList.add('pc-reveal');
  } };
  if (o.priority) {
    // The hero portrait goes ahead of every waiting thumbnail (and of jobs whose tile has gone).
    queue.unshift(job);
  } else queue.push(job);
  pump();
  return img;
}
