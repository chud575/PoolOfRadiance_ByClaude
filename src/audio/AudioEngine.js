/**
 * WebAudio engine stub. Buses: master → {music, sfx, ui}.
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 * Audio workstream: implement procedural music in src/audio/music/ and richer
 * synthesis in src/audio/sfx/, keeping this public API stable:
 *   audio.sfx(name, opts)   audio.playMusic(trackId)   audio.stopMusic()
 *   audio.setVolume(bus, v)
 */
export class AudioEngine {
  /** @param {import('../core/Settings.js').Settings} settings @param {import('../core/EventBus.js').EventBus} bus */
  constructor(settings, bus, { muted = false } = {}) {
    this.settings = settings;
    this.bus = bus;
    this.muted = muted;
    this.ctx = null;
    this.buses = {};
    this.currentTrack = null;
    this._unlock = () => this.unlock();
    if (typeof window !== 'undefined' && !muted) {
      window.addEventListener('pointerdown', this._unlock, { once: true });
      window.addEventListener('keydown', this._unlock, { once: true });
    }
    bus?.on('settings:changed', ({ key }) => {
      if (key.endsWith('Volume')) this._applyVolumes();
    });
  }

  unlock() {
    if (this.ctx || this.muted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const master = this.ctx.createGain();
    master.connect(this.ctx.destination);
    this.buses = { master, music: this.ctx.createGain(), sfx: this.ctx.createGain(), ui: this.ctx.createGain() };
    for (const k of ['music', 'sfx', 'ui']) this.buses[k].connect(master);
    this._applyVolumes();
    if (this.currentTrack) this.playMusic(this.currentTrack);
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.buses.master.gain.value = s?.get('masterVolume') ?? 0.8;
    this.buses.music.gain.value = s?.get('musicVolume') ?? 0.6;
    this.buses.sfx.gain.value = s?.get('sfxVolume') ?? 0.8;
    this.buses.ui.gain.value = s?.get('sfxVolume') ?? 0.8;
  }

  setVolume(bus, v) {
    this.settings?.set(`${bus}Volume`, v);
  }

  /** Procedural one-shot sound effects. */
  sfx(name, { bus = 'sfx', pitch = 1 } = {}) {
    const ac = this.ctx;
    if (!ac) return;
    const t = ac.currentTime;
    const out = this.buses[bus];
    const env = (g, a, d, peak = 0.4) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    };
    const tone = (type, f0, f1, dur, peak) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * pitch), t + dur);
      env(g, 0.005, dur, peak);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const noise = (dur, peak, freq = 800) => {
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq * pitch;
      const g = ac.createGain();
      env(g, 0.003, dur, peak);
      src.connect(f).connect(g).connect(out);
      src.start(t);
    };
    switch (name) {
      case 'click': tone('triangle', 900, 600, 0.05, 0.15); break;
      case 'step': noise(0.12, 0.25, 500); break;
      case 'bump': tone('sine', 120, 60, 0.15, 0.4); noise(0.08, 0.2, 300); break;
      case 'door': tone('sawtooth', 90, 70, 0.4, 0.12); noise(0.3, 0.2, 900); break;
      case 'hit': noise(0.15, 0.5, 2000); tone('square', 200, 80, 0.12, 0.15); break;
      case 'miss': noise(0.2, 0.15, 4000); break;
      case 'spell': tone('sine', 400, 1600, 0.6, 0.2); tone('triangle', 600, 2400, 0.5, 0.1); break;
      case 'coins': for (let i = 0; i < 3; i++) tone('square', 2000 + i * 400, 1800, 0.06, 0.05); break;
      default: tone('sine', 440, 440, 0.1, 0.1);
    }
  }

  /** Start a music track (stub: records intent; audio workstream implements). */
  playMusic(trackId) {
    this.currentTrack = trackId;
    this.bus?.emit('audio:music', { trackId });
  }

  stopMusic() {
    this.currentTrack = null;
  }
}
