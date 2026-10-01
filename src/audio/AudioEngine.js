import { createGraph } from './graph.js';
import { TrackPlayer } from './music/Sequencer.js';
import { SONGS, STINGERS } from './music/songs.js';
import { SFX } from './sfx/library.js';
import { Fx } from './sfx/toolkit.js';
import { Ambience } from './sfx/ambience.js';
import { AudioRng } from './core/rng.js';
import { Director } from './director.js';

/**
 * Procedural WebAudio engine: adaptive composed soundtrack, environmental
 * SFX with convolution reverb, ambience beds, stingers.
 *
 * Public API (stable — scenes call these directly):
 *   audio.sfx(name, {bus, pitch, vol, pan, surface, material, crit, n, mode})
 *   audio.playMusic(trackId)  /  audio.music(state, {fade, intensity})
 *   audio.stopMusic(fade)     audio.stinger(name)   audio.setIntensity(0..1)
 *   audio.ambience(bed, {night})   audio.setEnvironment({surface, room, bed, mood})
 *   audio.setVolume(bus, v)   (bus: master | music | sfx | ambience)
 *
 * Music states: title intro town tavern ruins dungeon crypt wilds camp combat
 * encounter victory defeat silence — plus aliases `explore`, `phlan_streets`,
 * `city` which resolve to the current location's mood.
 * The AudioContext is created lazily on the first user gesture (autoplay
 * policy). Until then (and when muted, e.g. debug/screenshot mode) every call
 * is a cheap no-op that only records intent.
 */
export class AudioEngine {
  /**
   * @param {import('../core/Settings.js').Settings} settings
   * @param {import('../core/EventBus.js').EventBus} bus
   * @param {{muted?: boolean}} [o]
   */
  constructor(settings, bus, { muted = false } = {}) {
    this.settings = settings;
    this.bus = bus;
    this.muted = muted;
    this.ctx = null;
    this.buses = {};
    this.currentTrack = null;
    this.state = null; // resolved music state
    this.player = null;
    this.fading = [];
    this.stingers = [];
    this.amb = null;
    this.ambState = null;
    this.env = { surface: 'cobble', room: 'street', bed: 'town', mood: 'town' };
    this.intensity = null;
    this.rng = new AudioRng(0xa0d10);
    this._lastSfx = new Map();
    this.director = new Director(this, bus);
    this._unlock = () => this.unlock();
    if (typeof window !== 'undefined' && !muted) {
      for (const ev of ['pointerdown', 'keydown', 'touchstart', 'gamepadconnected']) window.addEventListener(ev, this._unlock, { capture: true });
      document.addEventListener?.('visibilitychange', () => this._visibility());
    }
    // Gamepad-only players: try on the first pad action (works where pads count as activation).
    bus?.on('input:action', ({ code }) => {
      if (!this.ctx && String(code ?? '').startsWith('pad')) this.unlock();
    });
    bus?.on('settings:changed', ({ key }) => {
      if (/Volume$|^muteAll$/.test(key)) this._applyVolumes();
    });
  }

  /** Optional: give the director access to game state (location on boot, party). */
  attach(gameCtx) {
    this.director.attach(gameCtx);
  }

  unlock() {
    if (this.muted) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    // The gesture listeners stay installed: later gestures resume a context
    // the browser suspended (or created suspended, e.g. from gamepad input).
    this.graph = createGraph(this.ctx);
    this.buses = { master: this.graph.master, music: this.graph.musicIn, sfx: this.graph.sfxIn, ui: this.graph.uiBus, ambience: this.graph.ambBus };
    this._applyVolumes();
    this.graph.setRoom(this.env.room);
    this._timer = setInterval(() => this._tick(), 50);
    // Replay intent recorded before the gesture.
    if (this.currentTrack) {
      const id = this.currentTrack;
      this.state = null;
      this.playMusic(id, { fade: 2.5 });
    }
    if (this.ambState) {
      const a = this.ambState;
      this.ambState = null;
      this.ambience(a.bed, a);
    }
  }

  _visibility() {
    if (!this.ctx) return;
    const bg = this.settings?.get('muteInBackground') ?? true;
    if (document.hidden && bg) this.ctx.suspend().catch(() => {});
    else if (!document.hidden) this.ctx.resume().catch(() => {});
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    const set = (node, v) => node.gain.setTargetAtTime(Math.max(0, v), t, 0.05);
    const mute = s?.get('muteAll') ? 0 : 1;
    set(this.graph.master, (s?.get('masterVolume') ?? 0.8) * mute);
    set(this.graph.musicBus, s?.get('musicVolume') ?? 0.6);
    const sfx = s?.get('sfxVolume') ?? 0.8;
    set(this.graph.sfxBus, sfx);
    set(this.graph.uiBus, (s?.get('uiVolume') ?? sfx) * 0.85);
    set(this.graph.ambBus, (s?.get('ambienceVolume') ?? sfx * 0.75));
  }

  setVolume(bus, v) {
    this.settings?.set(`${bus}Volume`, v);
  }

  // ------------------------------------------------------------------ SFX
  /**
   * Play a procedural sound effect.
   * @param {string} name see sfx/library.js (step, door, hit, miss, spell_fire, vox_orc, coins, click …)
   * @param {{bus?: 'sfx'|'ui', pitch?: number, vol?: number, pan?: number, delay?: number, [k:string]: any}} [opts]
   */
  sfx(name, opts = {}) {
    const r = this.director.remapSfx(name, opts);
    if (!r) return;
    for (const [n, o] of r) this._sfx(n, o);
  }

  _sfx(name, opts) {
    const ac = this.ctx;
    if (!ac || ac.state === 'closed') return;
    const fn = SFX[name] ?? SFX.click;
    // Anti-machine-gun: identical sounds within 25 ms collapse.
    const now = ac.currentTime;
    const last = this._lastSfx.get(name) ?? -1;
    if (now - last < 0.025 && !opts.force) return;
    this._lastSfx.set(name, now);
    const ui = opts.bus === 'ui';
    const out = ui ? this.graph.uiBus : this.graph.sfxIn;
    const pitch = (opts.pitch ?? 1) * (ui ? 1 : 1 + this.rng.range(-0.03, 0.03));
    const fx = new Fx(ac, out, this.rng, { pitch, vol: opts.vol ?? 1, pan: opts.pan ?? 0, send: ui ? undefined : this.graph.envSend, sendLevel: opts.reverb ?? 0.3 });
    try {
      fn(fx, now + 0.005 + (opts.delay ?? 0), { surface: this.env.surface, ...opts });
    } catch (err) {
      console.warn('[audio] sfx failed', name, err);
    }
  }

  // ------------------------------------------------------------------ music
  /** Gold Box-era name kept for scenes: resolves aliases then calls music(). */
  playMusic(trackId, opts = {}) {
    this.currentTrack = trackId;
    this.bus?.emit('audio:music', { trackId });
    this.music(this.director.resolveTrack(trackId), opts);
  }

  /**
   * Switch the adaptive score to `state` with a crossfade.
   * @param {string} state
   * @param {{fade?: number, intensity?: number, restart?: boolean, delay?: number}} [o]
   */
  music(state, o = {}) {
    if (o.intensity !== undefined) this.intensity = o.intensity;
    if (state === this.state && !o.restart && this.player && !this.player.stopped && !this.player.done) {
      if (o.intensity !== undefined) this.player.setIntensity(o.intensity, 1.5);
      return;
    }
    this.state = state;
    if (!this.ctx) return;
    const ac = this.ctx;
    const urgent = ['combat', 'victory', 'defeat', 'encounter'].includes(state);
    const fade = o.fade ?? (state === 'combat' ? 0.25 : 2.5);
    // Musical transitions: calm changes wait for the current bar line (≤ 2.5 s)
    // so the outgoing cue finishes its phrase; urgent ones cut in at once.
    let wait = o.delay ?? (state === 'combat' ? 0.9 : 0);
    if (!urgent && o.delay === undefined && this.player && !this.player.stopped) {
      const nb = this.player.untilNextBar();
      if (nb < 2.5) wait = nb;
    }
    if (this.player) {
      this.player.fadeOut(urgent ? 0.6 : fade * 1.2, ac.currentTime + (urgent ? 0 : wait));
      this.fading.push(this.player);
      this.player = null;
    }
    const song = SONGS[state];
    if (!song) return; // 'silence'
    this.player = new TrackPlayer(ac, song, {
      dest: this.graph.musicIn,
      send: this.graph.musicSend,
      // Combat waits for the "danger" sting to land before the drums kick in.
      at: ac.currentTime + 0.06 + wait,
      fadeIn: urgent ? fade : Math.max(0.4, fade * 0.6),
      intensity: o.intensity ?? (state === 'combat' ? this.intensity : null) ?? song.intensity ?? 1,
    });
    this.player.tick(ac.currentTime + 0.4);
  }

  stopMusic(fade = 2) {
    this.currentTrack = null;
    this.state = null;
    if (this.player) {
      this.player.fadeOut(fade);
      this.fading.push(this.player);
      this.player = null;
    }
  }

  /** Adaptive intensity 0..1 (combat danger, exploration tension). */
  setIntensity(x, seconds = 2) {
    this.intensity = x;
    this.player?.setIntensity(x, seconds);
  }

  /**
   * One-shot musical sting over the score (score ducks underneath).
   * @param {'victory'|'defeat'|'levelup'|'discovery'|'danger'|'quest'|'fallen'} name
   */
  stinger(name, { duck = 0.35, stopMusic = false } = {}) {
    if (!this.ctx) return;
    const song = STINGERS[name];
    if (!song) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    if (stopMusic) this.stopMusic(0.5);
    const p = new TrackPlayer(ac, song, { dest: this.graph.musicBus, send: this.graph.musicSend, at: t + 0.03 });
    p.tick(t + 60);
    this.stingers.push(p);
    const len = (p.endTime ?? t + 4) - t;
    const d = this.graph.musicDuck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t);
    d.linearRampToValueAtTime(duck, t + 0.15);
    d.setValueAtTime(duck, t + Math.max(0.2, len - 1.2));
    d.linearRampToValueAtTime(1, t + len + 0.8);
  }

  // ------------------------------------------------------------------ environment
  /** Set the ambience bed (see sfx/ambience.js BEDS). */
  ambience(bed, { night = false, fade = 2.5 } = {}) {
    const same = this.ambState && this.ambState.bed === bed && this.ambState.night === night;
    if (same && (this.amb || !this.ctx)) return;
    this.ambState = { bed, night };
    if (!this.ctx) return;
    if (this.amb) {
      this.amb.fadeOut(fade);
      this.fading.push(this.amb);
    }
    this.amb = new Ambience(this.ctx, this.graph.ambBus, this.graph.envSend, bed, { night, fade, seed: this.rng.int(1, 1e9) });
  }

  /** Footstep surface, reverb room, music mood and ambience for a place. */
  setEnvironment(env) {
    Object.assign(this.env, env);
    if (this.ctx && env.room) this.graph.setRoom(env.room);
  }

  // ------------------------------------------------------------------ scheduler
  _tick() {
    const ac = this.ctx;
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    this.player?.tick(now + 0.4);
    for (const p of this.fading) p.tick?.(now + 0.4);
    for (const s of this.stingers) s.tick(now + 1);
    this.amb?.tick(now + 1);
    // Reap finished players.
    this.fading = this.fading.filter((p) => {
      if (p._disposeAt && now > p._disposeAt) {
        p.dispose();
        return false;
      }
      return true;
    });
    this.stingers = this.stingers.filter((p) => {
      if (p.done && now > (p.endTime ?? 0) + 4) {
        p.dispose();
        return false;
      }
      return true;
    });
    if (this.player?.done && now > (this.player.endTime ?? 0) + 4) {
      this.player.dispose();
      this.player = null;
    }
  }

  /** Debug snapshot for tools/devtools. */
  debugState() {
    return { unlocked: !!this.ctx, state: this.state, track: this.currentTrack, intensity: this.intensity, env: { ...this.env }, ambience: this.ambState, ctx: this.ctx?.state };
  }
}
