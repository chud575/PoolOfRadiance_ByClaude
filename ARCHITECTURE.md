# Pool of Radiance — Modern Homage: Architecture

A Three.js homage to SSI/TSR's 1988 Gold Box CRPG *Pool of Radiance* (AD&D 1e,
Phlan on the Moonsea). Plain modern JavaScript (ES modules + JSDoc types),
Vite build, Vitest for the rules engine, Playwright (headless Chromium +
SwiftShader) for screenshots. **All art is procedural** — no external assets
at build or run time.

## Quick start

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # production build → dist/ (game + reference renderer)
npm test             # vitest: rules engine + data validation
npm run shot -- --url "scene=explore&x=7&y=11&dir=N&t=2" --out shots/x.png
node tools/shotall.mjs      # homage gallery      → shots/<name>.png
node tools/refshot.mjs      # 1988 EGA reference  → reference/<name>.png
node tools/smoke.mjs        # end-to-end vertical slice (title→explore→combat→explore)
node tools/determinism.mjs  # shoots every gallery URL twice, pixel-compares (must be identical)
```

## Module map

```
index.html                 game page (canvas#gl + div#ui-root)
src/main.js                boot: builds GameContext, parses debug URL, starts loop, sets window.__READY
src/core/                  engine plumbing (no game rules, no visuals)
  EventBus.js              pub/sub (see event catalogue below)
  Clock.js                 game time; freeze support for deterministic shots
  GameLoop.js              rAF loop, afterFrames(n)
  Scene.js                 base class + scene contract
  SceneManager.js          goto/push/pop, lazy scene loading, overlay rendering
  InputManager.js          keyboard/mouse/gamepad → named actions, rebindable
  Settings.js              persisted settings (localStorage 'por.settings')
  SaveManager.js           save slots 'auto','A'..'J' (localStorage 'por.save.<slot>')
  GameState.js             party, location, time, flags, explored cells (serialisable)
  debug.js                 URL debug/shot API parser
  context.js               GameContext typedef
src/rules/                 AD&D 1e engine — pure, deterministic, unit-tested, no DOM/three
  dice.js                  seeded Rng (mulberry32), roll('3d6+1'), parseDice
  abilities.js             STR/DEX/CON/WIS tables, 18/xx strength
  races.js                 6 races: adjustments, class options, level limits, thief adj
  classes.js               fighter/cleric/magicUser/thief: XP, THAC0, saves, slots, thief skills
  character.js             create/derive/equip/xp/train/damage/heal (plain JSON characters)
  combat.js                combatants, initiative, attack/damage, saves, autoResolve
  party.js                 prebuilt parties
  index.js                 public re-exports
src/data/                  content tables (plain JS objects; see schema.js typedefs)
  schema.js                ItemDef / MonsterDef / SpellDef / EncounterDef / MapDef / MapEvent
  items.js monsters.js spells.js encounters.js shops.js parties.js
  maps/MapGrid.js          16x16 grid, per-edge wall types (wall/door/locked/secret/arch), ASCII dump
  maps/phlan_slums.js      seed block (builder DSL)
  maps/index.js            map registry getMap(id)
src/render/                shared rendering
  RenderContext.js         WebGLRenderer (ACES, sRGB, shadows) + EffectComposer pipeline
  post/GradeShader.js      vignette, grade, grain
  post/ClassicShader.js    "1988 mode": 320x200 pixelation + EGA palette dither + scanlines (F2 / ?classic=1)
  textures/                procedural texture library (noise, canvas → map/normal/roughness)
  materials.js             getMaterial(key) cache; wall/floor material tables
  lighting.js              outdoor rig by hour, sky dome, flickering torches
  palette.js               EGA16 + homage palette
  bitmapFont5x7.js         classic bitmap font (reference renderer / classic UI)
src/ui/                    HTML/CSS overlay
  UI.js                    layers (scene/hud/modal/toast/tooltip), dialog(), toast(), message()
  dom.js                   h() hyperscript helper
  components/              Frame, CommandBar, MessageLog, PartyRoster, Menu, Dialog, Tooltip, Toast
  StandardHud.js           explore HUD (location, compass, roster, log, command line)
  styles/ui.css            the skin (CSS variables — gilt / deep blue / parchment)
src/audio/AudioEngine.js   WebAudio buses (master/music/sfx/ui), procedural sfx, music stub
src/scenes/<name>/         one directory per scene (see ownership)
  registry.js              name → lazy import (only file that knows all scenes)
tools/                     node tooling (never imported by the game)
  shot.mjs shotall.mjs refshot.mjs smoke.mjs gallery.mjs lib/{server,browser}.mjs
  reference/               1988 EGA reference renderer (index.html, ref.js, ega.js, screens.js)
tests/                     vitest specs (rules/, data/)
```

Dependency direction (enforced by convention): `scenes → ui/render/audio/rules/data/core`,
`ui → rules/data`, `rules → data`, `data → (nothing)`, `core → data (MapGrid consts), scenes/registry`.
**Scenes never import other scenes.** `tools/reference` may import `src/data`, `src/rules`,
`src/render/palette.js` and `src/render/bitmapFont5x7.js` only.

## Scene contract

Every scene: `src/scenes/<name>/<Name>Scene.js`, `export default class extends Scene`.

| method | contract |
|---|---|
| `constructor(ctx)` | cheap; store nothing heavy |
| `async enter(params)` | build `this.scene3d` + `this.camera` + DOM (`ctx.ui.mount`). Resolve only when the first frame will look final (textures generated). Set `this.post = {...}` for post overrides. |
| `update(dt)` | per frame. `dt === 0` while frozen: snap tweens to their end state. Read time from `ctx.clock.time` only. |
| `render()` | default renders `scene3d` via `ctx.render.render()`. |
| `exit()` | call `super.exit()`; dispose geometry you created. Use `this.own(fn)` / `this.listen(evt, fn)` for automatic cleanup. |
| `onResize(w,h)` | update camera aspect. |
| `resume(result)` / `suspend()` | optional, for push/pop overlays. `this.transparent = true` keeps the scene below rendering. |

Navigation: `ctx.scenes.goto(name, params)` (replace), `push`/`pop` (overlay).
The scene layer of the UI is cleared automatically on `goto`.

GameContext (`ctx`): `bus, clock, input, settings, saves, game, scenes, render, ui, audio, rng, debug`.

### Event catalogue (ctx.bus)
`scene:enter {name, params, overlay?}`, `scene:resume {name, result}`, `input:action {action, code}`,
`message {text, kind}` (kinds: info/combat/loot/warn/lore/system), `party:changed`, `location:changed`,
`time:changed`, `settings:changed {key, value}`, `save:written {slot}`, `audio:music {trackId}`, `app:ready`.

### Input actions
forward, back, turnLeft, turnRight, strafeLeft, strafeRight, turnAround, confirm, cancel, area, cast,
view, encamp, search, look, prevMember, nextMember, quicksave (F5), quickload (F9), toggleClassic (F2), debug.
Command bars additionally bind their highlighted hotkey letters, except for commands that declare
`action` (e.g. explore's AREA/ENCAMP/SEARCH): those are fired by the InputManager binding only, and the bar
just displays the bound key (underlined, or as a badge such as `AREA [M]`). This keeps WASD/QE movement
from colliding with the classic A/E/S letters and prevents double-firing.
Explore defaults: move W/S/arrows, turn A/D, strafe Q/E, about-face X, Area M/Tab, Cast C, View V,
Encamp K, Search F, Look L.

## Debug / screenshot URL API

All params are optional; `?scene=` activates debug mode (seed defaults to 1, saves disabled, audio muted,
default party loaded for in-game scenes).

| param | meaning |
|---|---|
| `scene` | `title` `create` `explore` `combat` `automap` `camp` `dialogue` `shop` |
| `map`, `x`, `y`, `dir` | explore/automap start (`dir` = N/E/S/W) |
| `encounter` | combat/dialogue encounter id (`kobolds_1`, `orcs_1`, `skeletons_1`, `rats_1`, `thugs_1`) |
| `shop` | `phlan_armory`, `temple_tyr` |
| `party` | `default`, `wounded`, `veterans`, `none` |
| `seed` | RNG seed |
| `freeze=1` / `t=<sec>` | freeze the clock (at 0 or at t) — use for screenshots |
| `hour` | in-game hour (lighting / sky) |
| `classic=1` | force 1988 post effect |
| `ui=0` | hide the HTML overlay |
| `step` | scene sub-state (`create`: `race` `class` `stats`) |
| `reveal=0/1` | automap fog of war override |

`window.__READY === true` once the first frame after `enter()` has rendered (3 frames).
`window.__ERRORS` collects runtime errors. `window.__GAME` exposes ctx for scripts only.

## Screenshot tools

* `node tools/shot.mjs --url "<query>" --out f.png [--w 1600 --h 900] [--wait ms] [--ref] [--preview] [--port N]`
  starts (or reuses) a Vite dev server (5173; `--preview` serves dist/ on 4173), waits for `__READY`,
  prints console errors, exits 1 on page errors. `--ref` targets the reference renderer.
* `node tools/shotall.mjs [--only a,b] [--out dir]` → `shots/<name>.png` for every entry in `tools/gallery.mjs`.
* `node tools/refshot.mjs [--only a,b]` → `reference/<name>.png` (same names, same params; the reference
  honours `map/x/y/dir/hour/encounter/shop`).
* `node tools/determinism.mjs [--only a,b] [--port N]` captures each gallery URL twice and diffs the pixels;
  exits 1 on any drift. All 10 gallery shots are currently byte-identical run to run.
* Gallery names: `title create explore explore_door explore_night combat automap camp dialogue shop`.
  Add new entries to `tools/gallery.mjs`; `refshot` maps `explore_foo` → reference screen `explore`.
* Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with SwiftShader args (see `tools/lib/browser.mjs`).
  Never run `playwright install`. Parallel agents: use a distinct `--port` if you start your own server.

## Blind comparison protocol (critics)

1. `node tools/shotall.mjs --only <name>` and `node tools/refshot.mjs --only <name>`.
2. Present the two PNGs as "A" and "B" in random order to a critic that is not told which is which.
3. The critic judges: which is more beautiful, more atmospheric, more readable, more faithful in spirit?
   The homage must win decisively *and* still read unmistakably as Pool of Radiance
   (grid movement, gilt/blue frames, command line, party roster, the Moonsea's ruined Phlan).

## Ownership (parallel workstreams)

Each workstream owns its paths; touch others' paths only via small, announced API additions.

| workstream | owns |
|---|---|
| **explore-renderer** | `src/scenes/explore/`, `src/render/textures/`, `src/render/materials.js`, `src/render/lighting.js` |
| **combat** | `src/scenes/combat/`, `src/rules/combat.js` (with rules owner), combat sprites/models |
| **char-creation + party UI** | `src/scenes/create/`, `src/scenes/camp/`, `src/ui/components/PartyRoster.js`, inventory/character-sheet components (new files in `src/ui/components/`) |
| **automap / area map** | `src/scenes/automap/` |
| **title / intro / menus / UI skin** | `src/scenes/title/`, `src/ui/styles/`, `src/ui/components/{Frame,Menu,Dialog,Tooltip,Toast,CommandBar}.js`, `src/ui/StandardHud.js`, `index.html` |
| **world content** | `src/data/` (maps, encounters, dialogue text, shops, items, monsters, spells), `src/scenes/dialogue/`, `src/scenes/shop/` |
| **audio** | `src/audio/` |
| **rules engine** | `src/rules/`, `tests/` |
| **foundation / infra** (architect) | `src/core/`, `src/main.js`, `src/render/RenderContext.js`, `src/render/post/`, `src/scenes/registry.js`, `tools/`, `vite.config.js`, `package.json`, docs |
| **reference (1988) renderer** | `tools/reference/` — faithful to the original; do not beautify |

Shared-file etiquette: adding a scene = one line in `registry.js`; adding a gallery shot = one line in
`tools/gallery.mjs`; adding a material/texture = new keys (never change existing keys' meaning).

## Coding conventions

* ES modules, 2-space indent, single quotes, semicolons, JSDoc on exported APIs.
* No `Math.random()` in game logic — use `ctx.rng` / a forked `Rng`. (Pure visual noise may use seeded hashes.)
* No `performance.now()` for animation — use `ctx.clock.time`.
* Dispose GPU resources you create in `exit()`. Shared materials/textures from the libraries are cached — don't dispose those.
* Characters are plain JSON; derive stats with `deriveStats(ch)`; never store derived values.
* Game text in data files, not in scene code, where practical.
* Keep new dependencies at zero unless essential (three + vite only at runtime/build).

## Performance budget

* 60 fps on mid-range hardware (GTX 1060 / M1) at 1080p; ≤ 150 draw calls in explore, ≤ 4 real-time point
  lights + 1 shadowed directional, texture generation ≤ 1.5 s total at boot.
* SwiftShader screenshots: every gallery scene must reach `__READY` in ≤ 20 s at 1600x900
  (currently 1–11 s).
* JS main chunk: keep three + core; scenes are lazily split.

## The AAA visual bar

A shot passes only if a harsh critic, comparing blind against the 1988 reference, says it looks like a
premium modern release, i.e.:
1. **Lighting**: motivated, layered lighting (key/fill/rim, torch flicker, time of day), soft shadows,
   bloom only on true emitters, no flat ambient-only surfaces.
2. **Materials**: every surface has albedo + normal + roughness detail at the viewing distance; no visible
   tiling repetition or stretched UVs; wear, grime and variation.
3. **Composition**: deliberate camera framing, depth cues (fog, silhouettes), a clear focal point.
4. **UI**: crisp typography, consistent gilt/blue/parchment skin, aligned grids, readable at 1080p,
   hotkeys visible, no overlap with important 3D content.
5. **Motion**: eased tweens, no pops; idle life (flames, motes, cloth, water).
6. **Fidelity to the original**: Gold Box structure (grid, command line, roster, encounters) is instantly
   recognisable.
7. **Zero errors** in console; deterministic under `seed` + `t`.

## Known gaps (foundation v0.1)

* Combat: only QUICK/FLEE work; MOVE/AIM/CAST etc. are disabled placeholders; figures are primitives.
* Explore: one block (`phlan_slums`), exits to unbuilt maps, no roofs/skyline beyond block walls, no props.
* Spells: data only, no casting engine; no memorization UI.
* Shops: buy only; temple/training services not implemented.
* Audio: procedural sfx only; music is a stub.
* UI: no inventory/character sheet screens; settings/options UI minimal; no rebinding UI (API exists).
* Reference renderer is from memory of the EGA original — close in layout/palette, not pixel-exact.
