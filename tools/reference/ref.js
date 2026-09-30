import { Ega, W, H } from './ega.js';
import { SCREENS } from './screens.js';

/**
 * Reference renderer entry. ?scene=<name> renders that 1988-style screen,
 * integer-scaled (largest integer scale that fits the window), centred on black.
 */
window.__READY = false;
window.__ERRORS = [];
window.addEventListener('error', (e) => window.__ERRORS.push(String(e.message)));
try {
  const q = new URLSearchParams(location.search);
  const name = q.get('scene') ?? 'explore';
  const draw = SCREENS[name];
  if (!draw) throw new Error(`Unknown reference scene ${name}`);
  const e = new Ega();
  draw(e, q);
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
  const canvas = document.getElementById('c');
  e.present(canvas, scale);
} catch (err) {
  console.error(err);
  window.__ERRORS.push(String(err.stack || err));
}
window.__READY = true;
