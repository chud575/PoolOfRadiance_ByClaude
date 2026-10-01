import { makeImpulse } from './dsp/impulse.js';

/** Generated impulse responses are cached per context: a room change never regenerates one. */
const irCache = new WeakMap();
export function cachedImpulse(ac, name, seed) {
  let m = irCache.get(ac);
  if (!m) irCache.set(ac, (m = new Map()));
  const k = `${name}|${seed}`;
  let b = m.get(k);
  if (!b) m.set(k, (b = makeImpulse(ac, name, seed)));
  return b;
}

/** Music reverb per cue: the room each score is heard in (see setMusicRoom). */
export const MUSIC_ROOM_SEED = 3;

/**
 * The mixer graph, shared by the live engine and the offline renderer.
 *
 *   music players ─► musicIn ─► EQ ─► widen ─► musicDuck ─► musicBus(vol) ─┐
 *                │          └► early reflections (decorrelated L/R) ─┘     │
 *                └► musicSend ─► music room A/B (crossfaded per cue) ─► musicDuck
 *   sfx ─► sfxIn ─► sfxBus(vol) ─────────────────────────────┤
 *       └► envSend ─► room convolver A/B (crossfaded) ─► sfxBus
 *   ambience ─► ambBus(vol) ─────────────────────────────────┤
 *   ui ─► uiBus(vol) ────────────────────────────────────────┤
 *                                       master(vol) ─► glue comp ─► limiter ─► out
 */
export function createGraph(ac, dest = ac.destination) {
  const g = (v = 1) => {
    const n = ac.createGain();
    n.gain.value = v;
    return n;
  };
  const master = g(0.8);
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 12;
  glue.ratio.value = 1.8;
  glue.attack.value = 0.02;
  glue.release.value = 0.25;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  const makeup = g(1.15);
  master.connect(glue).connect(makeup).connect(limiter).connect(dest);

  const musicBus = g(0.6);
  const musicDuck = g(1);
  const musicIn = g(1);
  const musicSend = g(1);
  // Mastering EQ on the score: rumble filter, a sub-bass shelf cut (taiko,
  // timpani, basses and the big drum otherwise pile up below 60 Hz), de-mud the
  // low mids, presence for bite and a touch of air.
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 34;
  hp.Q.value = 0.7;
  const sub = ac.createBiquadFilter();
  sub.type = 'lowshelf';
  sub.frequency.value = 72;
  sub.gain.value = -6;
  const mud = ac.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 230;
  mud.Q.value = 0.9;
  mud.gain.value = -2.5;
  const pres = ac.createBiquadFilter();
  pres.type = 'peaking';
  pres.frequency.value = 3600;
  pres.Q.value = 0.6;
  pres.gain.value = 2.5;
  const air = ac.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 9000;
  air.gain.value = 2;
  musicIn.connect(hp).connect(sub).connect(mud).connect(pres).connect(air);
  const widen = (src, dst, w = 0.5) => {
    const split = ac.createChannelSplitter(2);
    const merge = ac.createChannelMerger(2);
    const mk = (v) => {
      const n = ac.createGain();
      n.gain.value = v;
      n.channelCount = 1;
      n.channelCountMode = 'explicit';
      return n;
    };
    const side = mk(1);
    const sl = mk(0.5);
    const sr = mk(-0.5);
    const shp = ac.createBiquadFilter();
    shp.type = 'highpass';
    shp.frequency.value = 300;
    shp.channelCount = 1;
    shp.channelCountMode = 'explicit';
    const sp = mk(w);
    const sn = mk(-w);
    const l = mk(1);
    const r = mk(1);
    src.connect(split);
    split.connect(l, 0);
    split.connect(r, 1);
    split.connect(sl, 0);
    split.connect(sr, 1);
    sl.connect(side);
    sr.connect(side);
    side.connect(shp);
    shp.connect(sp);
    shp.connect(sn);
    sp.connect(l);
    sn.connect(r);
    l.connect(merge, 0, 0);
    r.connect(merge, 0, 1);
    merge.connect(dst);
  };
  widen(air, musicDuck, 0.75);
  // Early reflections of the stage: different tap times per ear (and cross-fed
  // taps), so the dry orchestra is decorrelated between L and R like players
  // heard in a real room, not a pan-potted mono mix.
  {
    const split = ac.createChannelSplitter(2);
    const merge = ac.createChannelMerger(2);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    const erHp = ac.createBiquadFilter();
    erHp.type = 'highpass';
    erHp.frequency.value = 180;
    air.connect(erHp).connect(lp).connect(split);
    const taps = [
      // [from channel, to channel, delay s, gain]
      [0, 0, 0.0113, 0.2], [0, 1, 0.0171, 0.16], [0, 0, 0.0237, 0.12], [0, 1, 0.0313, 0.1],
      [1, 1, 0.0127, 0.2], [1, 0, 0.0193, 0.16], [1, 1, 0.0269, 0.12], [1, 0, 0.0347, 0.1],
    ];
    for (const [from, to, d, gain] of taps) {
      const dl = ac.createDelay(0.1);
      dl.delayTime.value = d;
      dl.channelCount = 1;
      dl.channelCountMode = 'explicit';
      const tg = g(gain * (to === from ? 1 : -1));
      tg.channelCount = 1;
      tg.channelCountMode = 'explicit';
      split.connect(dl, from);
      dl.connect(tg).connect(merge, 0, to);
    }
    merge.connect(musicDuck);
  }
  musicDuck.connect(musicBus).connect(master);
  // Music reverb: two convolvers crossfaded when the cue (and its room) changes.
  const mrooms = [ac.createConvolver(), ac.createConvolver()];
  const mGain = [g(0.0001), g(0.0001)];
  mrooms.forEach((c, i) => {
    musicSend.connect(c);
    c.connect(mGain[i]).connect(musicDuck);
  });
  let mActive = 0;
  let mCurrent = null;
  let mWet = 0.5;
  /**
   * Crossfade the score's reverb to `name` (an impulse.js ROOMS preset) at
   * return level `wet` over `fade` seconds.
   */
  const setMusicRoom = (name, t = ac.currentTime, wet = 0.5, fade = 2) => {
    if (name === mCurrent && Math.abs(wet - mWet) < 1e-3) return;
    const first = mCurrent === null;
    if (name === mCurrent) {
      mGain[mActive].gain.cancelScheduledValues(t);
      mGain[mActive].gain.setValueAtTime(mGain[mActive].gain.value, t);
      mGain[mActive].gain.linearRampToValueAtTime(wet, t + fade);
      mWet = wet;
      return;
    }
    mCurrent = name;
    mWet = wet;
    const next = first ? 0 : 1 - mActive;
    mrooms[next].buffer = cachedImpulse(ac, name, MUSIC_ROOM_SEED);
    if (first) {
      mGain[0].gain.setValueAtTime(wet, t);
      return;
    }
    mGain[next].gain.cancelScheduledValues(t);
    mGain[next].gain.setValueAtTime(0.0001, t);
    mGain[next].gain.linearRampToValueAtTime(wet, t + fade);
    mGain[mActive].gain.cancelScheduledValues(t);
    mGain[mActive].gain.setValueAtTime(Math.max(0.0001, mGain[mActive].gain.value), t);
    mGain[mActive].gain.linearRampToValueAtTime(0.0001, t + fade);
    mActive = next;
  };
  setMusicRoom('hall', 0, 0.5);

  const sfxBus = g(0.8);
  const sfxIn = g(1);
  sfxIn.connect(sfxBus).connect(master);
  const envSend = g(1);
  const rooms = [ac.createConvolver(), ac.createConvolver()];
  const roomGain = [g(0.5), g(0.0001)];
  rooms.forEach((c, i) => {
    envSend.connect(c);
    c.connect(roomGain[i]).connect(sfxBus);
  });
  let active = 0;
  let current = null;
  /** Crossfade the environmental reverb to another room preset. */
  const setRoom = (name, t = ac.currentTime, wet = 0.5) => {
    if (name === current) return;
    const first = current === null;
    current = name;
    const next = first ? 0 : 1 - active;
    rooms[next].buffer = cachedImpulse(ac, name, 17 + name.length);
    if (first) {
      roomGain[0].gain.setValueAtTime(wet, t);
      return;
    }
    roomGain[next].gain.cancelScheduledValues(t);
    roomGain[next].gain.setValueAtTime(0.0001, t);
    roomGain[next].gain.linearRampToValueAtTime(wet, t + 0.8);
    roomGain[active].gain.cancelScheduledValues(t);
    roomGain[active].gain.setValueAtTime(roomGain[active].gain.value, t);
    roomGain[active].gain.linearRampToValueAtTime(0.0001, t + 0.8);
    active = next;
  };

  const ambBus = g(0.6);
  ambBus.connect(master);
  const uiBus = g(0.7);
  uiBus.connect(master);
  return { master, musicBus, musicDuck, musicIn, musicSend, sfxBus, sfxIn, envSend, ambBus, uiBus, setRoom, setMusicRoom, glue, limiter };
}
