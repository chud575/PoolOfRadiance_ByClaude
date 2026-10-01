import { makeImpulse } from './dsp/impulse.js';

/**
 * The mixer graph, shared by the live engine and the offline renderer.
 *
 *   music players ─► musicIn ─► musicDuck ─► musicBus(vol) ─┐
 *                └► musicSend ─► hall convolver ─► musicBus  │
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
  // Gentle mastering EQ on the score: rumble filter, de-mud the low mids,
  // a touch of air. Keeps a dense orchestra from turning to porridge.
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 32;
  hp.Q.value = 0.6;
  const mud = ac.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 220;
  mud.Q.value = 0.9;
  mud.gain.value = -3;
  const air = ac.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 9000;
  air.gain.value = 1.5;
  musicIn.connect(hp).connect(mud).connect(air);
  // Stereo shuffler on the score: lifts the side signal above ~300 Hz by
  // ~3.5 dB (bass stays mono). Per-voice section panning does the real work;
  // this restores the width summing to the buses takes away.
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
  widen(air, musicDuck);
  musicDuck.connect(musicBus).connect(master);
  const hall = ac.createConvolver();
  hall.buffer = makeImpulse(ac, 'hall', 3);
  const hallRet = g(0.5);
  musicSend.connect(hall).connect(hallRet).connect(musicDuck);

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
    rooms[next].buffer = makeImpulse(ac, name, 17 + name.length);
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
  return { master, musicBus, musicDuck, musicIn, musicSend, sfxBus, sfxIn, envSend, ambBus, uiBus, setRoom, glue, limiter };
}
