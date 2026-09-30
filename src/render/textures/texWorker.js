import { TEXTURE_DEFS } from './defs.js';
import { materialData } from './canvas.js';

/** Texture generation worker: {name} → {name, size, color, normal, rough} (transferred). */
self.onmessage = (e) => {
  const { name } = e.data;
  try {
    const def = TEXTURE_DEFS[name];
    const d = materialData(def.size, def.gen(), { normalStrength: def.normalStrength, cavity: def.cavity ?? 0.35 });
    self.postMessage({ name, size: d.size, color: d.color, normal: d.normal, rough: d.rough }, [d.color.buffer, d.normal.buffer, d.rough.buffer]);
  } catch (err) {
    self.postMessage({ name, error: String(err && err.message ? err.message : err) });
  }
};
