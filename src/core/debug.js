/**
 * Debug / screenshot URL API. Parsed once at boot from location.search.
 *
 *   ?scene=title|create|explore|combat|automap|camp|dialogue|shop
 *   &map=phlan_slums &x=3 &y=5 &dir=N|E|S|W      (explore / automap start)
 *   &encounter=kobolds_1                          (combat / dialogue)
 *   &shop=phlan_armory                            (shop)
 *   &party=default|none|<id in data/parties.js>   (prebuilt test party)
 *   &seed=1                                       (seeded RNG; default 1 when scene= is given)
 *   &freeze=1                                     (freeze clock at t=0 or &t=)
 *   &t=12.5                                       (freeze clock at 12.5s)
 *   &hour=21                                      (in-game hour of day; default 8)
 *   &classic=1                                    (force classic pixel/CRT mode)
 *   &ui=0                                         (hide HTML UI overlay)
 *   &step=create:stats                            (scene-specific sub-state, free-form)
 *   &nosave=1                                     (don't touch localStorage saves)
 *
 * When the scene's first frame is fully rendered, main.js sets window.__READY = true.
 * Any additional unknown params are passed through to scene.enter(params).
 *
 * @typedef {Object} DebugParams
 * @property {boolean} active   true if ?scene= was given
 * @property {string|null} scene
 * @property {number} seed
 * @property {boolean} frozen
 * @property {number} t
 * @property {string|null} party
 * @property {boolean} classic
 * @property {boolean} ui
 * @property {boolean} nosave
 * @property {Record<string,string>} raw   all params as strings
 */

/** @param {string} search @returns {DebugParams} */
export function parseDebugParams(search) {
  const p = new URLSearchParams(search);
  const raw = Object.fromEntries(p.entries());
  const scene = p.get('scene');
  const hasT = p.has('t');
  return {
    active: !!scene,
    scene,
    seed: p.has('seed') ? Number(p.get('seed')) : scene ? 1 : (Date.now() & 0x7fffffff),
    frozen: p.get('freeze') === '1' || hasT,
    t: hasT ? Number(p.get('t')) : 0,
    party: p.get('party') ?? (scene && scene !== 'title' && scene !== 'create' ? 'default' : null),
    classic: p.get('classic') === '1',
    ui: p.get('ui') !== '0',
    nosave: p.get('nosave') === '1' || !!scene,
    raw,
  };
}

/** Convert a raw param record into typed scene params. */
export function sceneParamsFromRaw(raw) {
  const out = { ...raw };
  for (const k of ['x', 'y', 'hour']) if (k in out) out[k] = Number(out[k]);
  return out;
}
