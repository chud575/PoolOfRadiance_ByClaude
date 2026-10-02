import { createGraph } from './graph.js';
import { TrackPlayer, LOOKAHEAD } from './music/Sequencer.js';
import { SONGS, STINGERS } from './music/songs.js';
import { SFX, LIMITED, WIDE } from './sfx/library.js';
import { Fx } from './sfx/toolkit.js';
import { Ambience } from './sfx/ambience.js';
import { AudioRng } from './core/rng.js';
import { Director } from './director.js';
import { sfxGain } from './loudness.js';
import { createInstrument } from './instruments/index.js';
import { setVoiceCap } from './instruments/base.js';
import { LoadGuard } from './loadguard.js';

/**
 * Scheduler clock in a Worker: its timer is neither throttled in background
 * tabs (where main-thread intervals drop to ≥ 1 s) nor delayed by the main
 * thread's own timer queue. Ticks still run on the main thread; the long
 * LOOKAHEAD covers stalls there.
 */
const CLOCK_SRC = 'let id=0;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};';
function startClock(fn, ms) {
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') throw new Error('no worker');
    const url = URL.createObjectURL(new Blob([CLOCK_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    w.postMessage(ms);
    return () => {
      w.postMessage(0);
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

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
 * is a cheap no-op that only records intent. `?audio=1` in the URL unmutes the
 * debug/screenshot mode and creates the context at once (for automated checks
 * of scene → music wiring; launch Chromium with
 * --autoplay-policy=no-user-gesture-required to hear it run).
 */
export class AudioEngine {
  /**
   * @param {import('../core/Settings.js').Settings} settings
   * @param {import('../core/EventBus.js').EventBus} bus
   * @param {{muted?: boolean}} [o]
   */
  constructor(settings, bus, { muted = false } = {}) {
    const forced = typeof location !== 'undefined' && /[?&]audio=1\b/.test(location.search ?? '');
    if (forced) muted = false;
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
    if (forced && typeof window !== 'undefined') {
      this.forced = true;
      window.__AUDIO = this;
      queueMicrotask(() => this.unlock());
    }
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
    this._attach(this.ctx, createGraph(this.ctx));
    this._stopClock = startClock(() => this._tick(), 50);
    this._prewarm();
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

  /** Bind a context + mixer graph (the live one, or an OfflineAudioContext for review renders). */
  _attach(ac, graph) {
    this.ctx = ac;
    this.graph = graph;
    this.buses = { master: graph.master, music: graph.musicIn, sfx: graph.sfxIn, ui: graph.uiBus, ambience: graph.ambBus };
    this._applyVolumes();
    graph.setRoom(this.env.room);
  }

  /**
   * Offline harness (tools/audiorender.mjs): drive this engine inside an
   * OfflineAudioContext, so review renders go through the real music()
   * transition code. Call `tick()` from ac.suspend() points.
   */
  static offline(ac, graph, { settings = null, bus = null } = {}) {
    const e = new AudioEngine(settings, bus, { muted: true });
    e.muted = false;
    e.offlineMode = true;
    e._attach(ac, graph);
    return e;
  }

  /**
   * Queue idle-time rendering of the sample buffers (drums, plucks) the
   * stingers and the battle music open with, so a fight's first beat never
   * stalls the main thread generating them. Worked off ~5 ms per tick.
   */
  _prewarm() {
    const sink = this.ctx.createGain();
    const q = [];
    for (const song of [...Object.values(STINGERS), SONGS.combat, SONGS.encounter]) {
      let r;
      try {
        r = song.build(0, new AudioRng(1), {});
      } catch {
        continue;
      }
      const made = new Map();
      for (const e of r.events) {
        if (e.t > 16) continue;
        const spec = song.instruments[e.inst];
        const preset = typeof spec === 'string' ? spec : spec?.preset;
        if (!preset || !/taiko|timpani|tom|snare|crash|sus|boom|rim|frame|tamb|hat|harp|lute|pizz|dulcimer|bass|harmonics/.test(preset)) continue;
        let ins = made.get(e.inst);
        if (!ins) made.set(e.inst, (ins = createInstrument(this.ctx, spec, sink, null, 1)));
        for (const m of [].concat(e.midi ?? 0)) if (ins.warm) q.push(...ins.warm(m, e.vel ?? 0.7, e.opts ?? {}, !!e.roll));
      }
    }
    this._warmQ = q;
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
    const fn = SFX[name];
    if (!fn) {
      // An unknown name is a bug in the caller: say so once, never fake it with a click.
      this._unknown ??= new Set();
      if (!this._unknown.has(name)) {
        this._unknown.add(name);
        console.warn(`[audio] unknown sfx "${name}"`);
      }
      return;
    }
    this.log?.push(name);
    // Anti-machine-gun: identical sounds (same name and pitch) within 25 ms collapse.
    const now = ac.currentTime;
    const key = `${name}|${opts.pitch ?? 1}`;
    const last = this._lastSfx.get(key) ?? -1;
    if (now - last < 0.025 && !opts.force) return;
    this._lastSfx.set(key, now);
    if (this._lastSfx.size > 256) this._lastSfx.clear();
    if (opts.bus === 'ui') this.lastUiSfx = { name, at: now, scene: !opts.global };
    const ui = opts.bus === 'ui';
    const out = ui ? this.graph.uiBus : this.graph.sfxIn;
    const pitch = (opts.pitch ?? 1) * (ui ? 1 : 1 + this.rng.range(-0.03, 0.03));
    const fx = new Fx(ac, out, this.rng, { pitch, vol: (opts.vol ?? 1) * sfxGain(name === 'step' ? `step_${opts.surface ?? this.env.surface ?? 'cobble'}` : name), pan: opts.pan ?? 0, send: ui ? undefined : this.graph.envSend, sendLevel: opts.reverb ?? 0.3, limit: LIMITED.test(name), wide: WIDE.test(name) && !opts.bus ? 1 : 0 });
    try {
      // Spell chords sound in the key of the score that is playing.
      fn(fx, now + 0.005 + (opts.delay ?? 0), { surface: this.env.surface, key: this.key ?? 2, ...opts });
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
    // Each cue has its own acoustic: the tavern band plays in a dry taproom,
    // the crypt in a cathedral, battle and title on a hall stage.
    this.graph.setMusicRoom(song.room ?? 'hall', ac.currentTime + wait, song.wet ?? 0.5, urgent ? 0.8 : Math.max(1.5, fade));
    this.key = song.key ?? null;
    this.player = new TrackPlayer(ac, song, {
      dest: this.graph.musicIn,
      send: this.graph.musicSend,
      // Combat waits for the "danger" sting to land before the drums kick in.
      at: ac.currentTime + 0.06 + wait,
      fadeIn: urgent ? fade : Math.max(0.4, fade * 0.6),
      intensity: o.intensity ?? (state === 'combat' ? this.intensity : null) ?? song.intensity ?? 1,
    });
    this.player.tick(ac.currentTime + LOOKAHEAD);
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
  stinger(name, { duck = 0.35, stopMusic = false, at } = {}) {
    this.lastStinger = name;
    if (!this.ctx) return;
    const song = STINGERS[name];
    if (!song) return;
    const ac = this.ctx;
    const t = at ?? ac.currentTime;
    if (stopMusic) this.stopMusic(0.5);
    const p = new TrackPlayer(ac, song, { dest: this.graph.musicBus, send: this.graph.musicSend, at: t + 0.03 });
    p.tick(t + 60);
    this.stingers.push(p);
    const len = (p.endTime ?? t + 4) - t;
    const d = this.graph.musicDuck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(at ? 1 : d.value, t);
    d.linearRampToValueAtTime(duck, t + 0.15);
    d.setValueAtTime(duck, t + Math.max(0.2, len - 1.2));
    d.linearRampToValueAtTime(1, t + len + 0.8);
  }

  /**
   * Win: the battle music plays on to its next downbeat, ends there with its
   * coda (a final hit on layer 0), and the stinger's fanfare starts on that
   * same downbeat.
   */
  endCombatWith(name = 'victory') {
    this.lastStinger = name;
    if (!this.ctx || !this.player || this.player.stopped || !this.player.song.coda) {
      this.stinger(name, { stopMusic: true });
      return;
    }
    const ac = this.ctx;
    const at = ac.currentTime + this.player.untilNextBar(0.12);
    const coda = this.player.endWithCoda(at);
    if (coda) this.stingers.push(coda);
    this.fading.push(this.player);
    this.player = null;
    this.currentTrack = null;
    this.state = null;
    this.stinger(name, { at, duck: 1 });
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
    if (!ac || (ac.state !== 'running' && !this.offlineMode)) return;
    const now = ac.currentTime;
    // Audio-thread load guard (live only): thin the orchestra if rendering falls behind real time.
    if (!this.offlineMode) {
      this.loadGuard ??= new LoadGuard();
      const cap = this.loadGuard.update(performance.now() / 1000, now, ac.state === 'running');
      if (cap !== this._cap) setVoiceCap(ac, (this._cap = cap));
    }
    if (this._warmQ?.length) {
      const t0 = performance.now();
      while (this._warmQ.length && performance.now() - t0 < 5) this._warmQ.shift()();
    }
    this.player?.tick(now + LOOKAHEAD);
    for (const p of this.fading) p.tick?.(now + LOOKAHEAD);
    for (const s of this.stingers) s.tick(now + LOOKAHEAD);
    this.amb?.tick(now + LOOKAHEAD);
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
    return { unlocked: !!this.ctx, state: this.state, track: this.currentTrack, intensity: this.intensity, section: this.player?.section ?? null, pass: this.player?.pass ?? null, stinger: this.lastStinger ?? null, env: { ...this.env }, ambience: this.ambState, ctx: this.ctx?.state, voiceCap: this._cap ?? null, overloads: this.loadGuard?.events ?? 0 };
  }
}
