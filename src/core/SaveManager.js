import { safeStorage } from './Settings.js';

export const SAVE_VERSION = 1;
export const SAVE_SLOTS = ['auto', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/**
 * Save/load of GameState snapshots to localStorage.
 * Keys: 'por.save.<slot>'. Each record: {version, slot, savedAt, summary, state}.
 */
export class SaveManager {
  /**
   * @param {import('./EventBus.js').EventBus} bus
   * @param {Storage|null} [storage]
   */
  constructor(bus, storage = safeStorage()) {
    this.bus = bus;
    this.storage = storage;
  }

  key(slot) {
    return `por.save.${slot}`;
  }

  /**
   * @param {string} slot
   * @param {import('./GameState.js').GameState} game
   */
  save(slot, game) {
    const record = {
      version: SAVE_VERSION,
      slot,
      savedAt: new Date().toISOString(),
      summary: game.summary(),
      state: game.toJSON(),
    };
    try {
      this.storage?.setItem(this.key(slot), JSON.stringify(record));
      this.bus?.emit('save:written', { slot });
      return true;
    } catch (err) {
      console.warn('[SaveManager] save failed', err);
      return false;
    }
  }

  /** @returns {object|null} raw state object (pass to GameState.fromJSON) */
  load(slot) {
    try {
      const raw = this.storage?.getItem(this.key(slot));
      if (!raw) return null;
      const rec = JSON.parse(raw);
      if (rec.version !== SAVE_VERSION) console.warn('[SaveManager] version mismatch', rec.version);
      return rec.state;
    } catch (err) {
      console.warn('[SaveManager] load failed', err);
      return null;
    }
  }

  autosave(game) {
    return this.save('auto', game);
  }

  /** @returns {{slot:string, savedAt:string, summary:string}[]} */
  list() {
    const out = [];
    for (const slot of SAVE_SLOTS) {
      try {
        const raw = this.storage?.getItem(this.key(slot));
        if (!raw) continue;
        const rec = JSON.parse(raw);
        out.push({ slot, savedAt: rec.savedAt, summary: rec.summary });
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  remove(slot) {
    this.storage?.removeItem(this.key(slot));
  }
}
