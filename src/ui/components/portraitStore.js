/**
 * Finished portraits persist across scenes and sessions: an in-memory map backed by IndexedDB,
 * keyed by the full appearance key (look, seed, readied kit), scale and crop. Camp, the roster
 * and the inventory strip never repaint a face that has been painted before — on a software GPU
 * a portrait costs seconds. Bump PORTRAIT_ART_VERSION whenever the painting itself changes.
 * Every IndexedDB call is guarded: private windows and blocked storage simply fall back to memory.
 */

export const PORTRAIT_ART_VERSION = 'v17';
const DB = 'por-portraits';
const STORE = 'p';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* exists */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

const k = (key) => `${PORTRAIT_ART_VERSION}|${key}`;

/** @returns {Promise<string|null>} a stored data URL, or null */
export async function storedPortrait(key) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(k(key));
      r.onsuccess = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store a finished portrait (fire and forget). */
export async function storePortrait(key, url) {
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(url, k(key));
  } catch { /* quota or blocked: memory cache only */ }
}
