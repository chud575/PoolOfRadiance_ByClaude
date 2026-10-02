/**
 * Persistent user settings (localStorage 'por.settings').
 * Emits 'settings:changed' {key, value} on the bus.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  classicMode: false, // pixel/CRT "1988" post effect
  bloom: true,
  antialias: 'smaa', // 'smaa' | 'fxaa' | 'none'
  pixelRatioCap: 2,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  textSpeed: 1, // 0 = instant
  moveSpeed: 1, // multiplier on step/turn tween speed
  autosave: true,
  showMinimap: true,
  combatSpeed: 1,
  confirmDangerous: true,
  fighterThac0: 'goldBox', // rules: 'goldBox' (PoR sheet, -1 per level) | 'dmg' (DMG matrix)
  bindings: null, // null → InputManager defaults; else {action: [codes]}
});

export class Settings {
  /**
   * @param {import('./EventBus.js').EventBus} bus
   * @param {Storage|null} [storage]
   */
  constructor(bus, storage = safeStorage()) {
    this.bus = bus;
    this.storage = storage;
    this.values = { ...DEFAULT_SETTINGS, ...this._load() };
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    this.save();
    this.bus?.emit('settings:changed', { key, value });
  }

  save() {
    try {
      this.storage?.setItem('por.settings', JSON.stringify(this.values));
    } catch {
      /* storage may be unavailable */
    }
  }

  _load() {
    try {
      const raw = this.storage?.getItem('por.settings');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
}

export function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const k = '__por_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
