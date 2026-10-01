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
src/rules/                 AD&D 1e engine — pure, deterministic, unit-tested, no DOM/three (see "Rules engine API")
  dice.js                  seeded Rng (mulberry32), roll('3d6+1'), parseDice
  abilities.js             full PHB ability tables (STR 18/xx + giant, INT, WIS, DEX, CON, CHA)
  races.js                 6 races: adjustments, min/max (by gender), classes, ability-dependent level limits, thief adj, ages
  classes.js               XP, THAC0 (DMG matrices), saves, slots, thief skills, turn undead, alignments, PoR level caps
  tohit.js                 neededToHit() with the 1e repeating-20 rule
  conditions.js            condition registry + timed effects (bless, held, asleep, poisoned...) and their modifiers
  items.js                 +N enchantments, item names/values/weights, rate of fire, armour move, encumbrance
  character.js             create/derive/equip/xp/train/dual-class/damage/heal/bleed/raise (plain JSON characters)
  creature.js              uniform view over Character / Combatant / monster (tags, saves, AC, damage, heal)
  saves.js                 rollSave() with WIS/DEX/element/prot-from-evil situational bonuses
  spells.js                ALL PoR spells (cleric 1-3, MU 1-3, temple 4-5) as data + castSpell() resolver
  camp.js                  memorization load-outs, 1e rest/memorize timing, natural healing, learning spells
  magicItems.js            useItem (potions/scrolls/wands), scribeScroll, identify, detect magic
  treasure.js              MM treasure types A-Z, gems, jewelry, magic items, coin sharing
  temple.js                temple services (cures, raise dead, stone to flesh, identify)
  combat.js                combatants, initiative, attacks (with live effects), saves, poison, turning, upkeep, autoResolve
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
src/audio/                 procedural WebAudio (see "Audio" below)
  AudioEngine.js           public API: sfx(), playMusic()/music(), stinger(), setIntensity(), ambience(), setEnvironment()
  director.js              event-bus listener: location→mood/surface/reverb/ambience, combat-log→contextual sfx, stingers
  graph.js                 mixer: music/sfx/ambience/ui buses, generated-IR convolution reverbs, glue comp + limiter
  environments.js          map id → {mood, surface, room, bed}; spell name → sfx family
  instruments/             Karplus–Strong plucks (lute/harp/dulcimer), bowed strings, formant choir, winds/brass, drones, modal drums, bells
  music/                   Sequencer (TrackPlayer: lookahead scheduling, adaptive layers), compose helpers, themes/*.js, songs.js
  sfx/                     toolkit (noise/tone/modes/grains/formant voice), library (all named sfx), ambience beds
  dsp/                     pure-JS synthesis (KS strings, modal drums, noise), impulse responses, sample cache
  offline.js               OfflineAudioContext renders of every cue (used by tools/audiorender.mjs)
src/scenes/<name>/         one directory per scene (see ownership)
  registry.js              name → lazy import (only file that knows all scenes)
tools/                     node tooling (never imported by the game)
  shot.mjs shotall.mjs refshot.mjs smoke.mjs gallery.mjs audiorender.mjs lib/{server,browser}.mjs
  reference/               1988 EGA reference renderer (index.html, ref.js, ega.js, screens.js)
tests/                     vitest specs (rules/, data/)
```

Dependency direction (enforced by convention): `scenes → ui/render/audio/rules/data/core`,
`ui → rules/data`, `rules → data`, `data → (nothing)`, `core → data (MapGrid consts), scenes/registry`.
**Scenes never import other scenes.** `tools/reference` may import `src/data`, `src/rules`,
`src/render/palette.js` and `src/render/bitmapFont5x7.js` only.

## Rules engine API

`import * as R from './rules/index.js'` (or the individual modules). Everything is pure and takes an `Rng`
for randomness; characters are plain JSON and derived numbers always come from `deriveStats(ch)`.
Durations are combat rounds (1 round = 1 minute; 1 turn = 10 rounds). Ranges/areas are battle squares.

**Creation & sheet**
* `rollLegalAbilities(rng, race, classSpec, method?, gender?)`, `applyRace`, `validateConcept({race, classSpec, alignment, abilities, gender})`
* `createCharacter({rng, name, race, classSpec, abilities?, gender?, alignment?, items?, level?, spellbook?})`
* `deriveStats(ch)` → `{thac0, ac, acRear, acMissile, saves, hitBonus, dmgBonus, weapon, weaponMagic, ranged, damage, attacks,
  move, baseMove, weight, encumbrance, spellSlots, canCastArcane, thief, backstab, abilities (effective), mods (effects), ...}`
* Tables for tooltips: `abilitySummary(abilities)`, `strengthTable`, `intelligenceTable`, `constitutionTable`, `charismaTable`,
  `THIEF_SKILL_NAMES`, `SAVE_NAMES`, `CONDITIONS[id].{name,desc}`, `describeEffects(ch)`, `statusLabel(ch)`.
* Races/classes: `RACES`, `CLASSES`, `racialLevelLimit(race, cls, abilities)`, `allowedAlignments(spec)`, `PR_LEVEL_CAPS`
  (fighter 8, cleric 6, magic-user 6, thief 9), `thac0For`, `savesFor`, `spellSlots`, `thiefSkills`, `turnNeeded`.

**Equipment**: `addItem(ch, id, {equip, magic, spells, cursed})`, `equipItem`, `unequipItem`, `removeItem`, `canEquip`,
`equipProblem` (reason string for the UI), `itemName(entry)` (honours identification and `entry.magic` overrides),
`itemValue`, `itemWeight`, `carriedWeight`, `encumbranceCategory`. Inventory entries may carry `magic` (+N) so treasure
can make "Long Sword +2" from `longSword`. Optional ItemDef fields the rules understand: `magic`, `magicVs`, `acBase`
(bracers), `acBonus`, `saveBonus`, `setStr` (gauntlets of ogre power), `rateOfFire`, `cursed`, `classes`, `slot`,
`casterLevel`; potion `effect` strings `heal:<dice>`, `giantStrength:<str>`, `speed`, `neutralize`, or a spell id.

**Experience & training**: `awardXp(ch, xp)` (splits multiclass, +10% prime requisite, banks at most one point short
of the level after next — Gold Box training rule), `trainableClasses(ch)`, `trainingCost(ch)` (PoR: 1,000 gp),
`trainLevels(ch, rng)` (one level per visit, capped by race and PoR caps), `maxLevel(ch, cls)`,
`dualClassProblem(ch, cls)` / `dualClass(ch, cls)` (humans).

**Health**: `applyDamage` (0 unconscious, −1…−9 dying, ≤ −10 dead; wakes sleepers), `bleed(ch)` (1 hp/round),
`bandage(ch)`, `heal`, `raiseDead(rng, ch)` (resurrection survival, −1 CON; refuses elves per the PHB), `stoneToFlesh`,
`isConscious`, `isAlive`.

**Conditions**: `addEffect(target, id, {rounds, source, level, mods, data})`, `removeEffect`, `hasEffect`, `getEffect`,
`effectMods(target)`, `tickEffects(target, rounds)`, `isIncapacitated`, `isHelpless`, `conditionsAllowCasting`,
`clearCombatEffects`. Effects live in `target.effects`; `target.conditions` mirrors their ids as strings.
Party combatants share `hp`, `conditions` and `effects` with their Character.

**Spells** (`SPELL_RULES`, 54 spells incl. temple-only cures/raise dead)
* `spellsForClass(cls, level)`, `getSpell(id)` (rules + data display merged: `name, desc, tip, schools, usable, ...`),
  `spellLevel(id, cls)`, `spellTargeting(id, casterLevel, cls)` → `{target, range, shape, size, maxTargets, hostile, duration}`.
* `castProblem(caster, id, {context, ignoreMemory})` → reason or null (memorized, silence/held, armour for arcane — elfin
  chain only for elves/half-elves — camp/combat usability).
* `castSpell(rng, id, caster, targets, {consume, ignoreMemory, check, context, level, fromItem, noFailure})` → `{ok, reason,
  failed, level, results:[{target, affected, saved, save, resisted, immune, missed, damage, healed, applied, removed, down,
  charmed}], flags, log}`. Memory is always checked unless `ignoreMemory: true` (or `check: false`) is passed explicitly.
  Clerics roll the PHB low-WIS spell failure (WIS 9: 20%…12: 5%; the slot is spent; items never fail; `noFailure` for
  scripted casts). The caller picks targets from the template (primary/nearest first); the engine filters by `affects`,
  applies `maxTargets`, saves (WIS vs mind magic, DEX vs fireball/lightning, hold person: cleric −2 alone / MU −3 alone,
  −1 for two; range cleric 6 / MU 12), sleep's PHB HD bands (`SLEEP_BANDS`), `dispelChance` (DMG +5%/level above,
  −2%/level below), elf/half-elf sleep-charm resistance, undead immunity, shield vs magic missile, and returns terse Gold
  Box log lines. Utility spells report `flags` (`detectMagic`, `findTraps`, `unlock`, `readMagic`, `raiseDead`,
  `poisonCured`...). `hammerStrike(rng, cleric, target, magic)` is one Spiritual Hammer blow.
* Deliberate simplifications: Shield is AC 2 vs missiles / AC 4 vs melee (1e: AC 2 hurled, AC 3 small missiles, +1 saves
  vs frontal attacks); thieves may be any alignment but LG (PoR creation rule); clerics may use slings (Gold Box);
  halfling fighters reach 6th flat (PoR); magic armour moves at the PHB base rate (its benefit is half weight).
* Memorization (camp.js): `knownSpells(ch, cls)`, `slotsFor`, `checkLoadout`, `prepareSpells(ch, cls, ids)`, `autoPrepare(ch)`,
  `spellsToMemorize`, `memorizationTime(ch)` (1e: 4/6/8 h rest + 15 min per spell level, net of banked study),
  `study(ch, minutes)` (spells return one at a time once their own 15 min/level is done — an interrupted rest keeps them),
  `rest(party, minutes)` → `{healed, memorized, expired, died}` (1 hp/day natural healing, `healPerDay` option; poison
  onset counts down by the minutes rested unless Slow Poison holds it), `learnSpell` (INT max spell level, max spells per
  level, optional chance to know). Model: `ch.spells.prepared[cls]` = chosen load-out, `ch.spells.memorized[cls]` = still
  in memory (casting removes), `ch.spells.study` = banked minutes.

**Combat** (combat.js, co-owned): `combatantFromCharacter`, `combatantFromMonster`, `rollInitiative`, `canAct`, `resolveAttack(rng,
a, d, {mods, dmgMod, backstab, rear, ranged, helpless})` (applies live effects: bless/prayer, shield, invisibility, blink,
mirror image, prot. from evil/missiles; racial adjustments via `racialCombatMods` — dwarves +1 vs orcs/half-orcs/goblins/
hobgoblins, gnomes +1 vs kobolds/goblins, giants/ogres/trolls/titans (+ gnolls/bugbears vs gnomes) −4 to hit dwarves and
gnomes; helpless targets per `HelplessRule`: `'bonus'` +4 (default), `'auto'` melee auto-hit, `'slay'` coup de grace),
`hitChance(a, d, mods, {ranged, helpless})`, `attackRateOf(c, {weapon})` / `attacksFor(c, round, {weapon})` — the single
source of truth for attack counts, computed live (3/2 fighters alternate 1,2; haste ×2, slow ×½ for characters *and*
monsters, whose count is routines × attacks in the routine), `sweepAttacks(ch, target)` (fighters vs < 1 full HD incl.
1-1 HD goblins, `belowOneHd`), `onHitSpecials` (ghoul paralysis — elves immune — poison, rat disease), `savingThrow`,
`poison(rng, target, {mode:'deadly'|'damage', onset})`, `turnUndead(rng, level, type)` (unknown types: no effect),
`endOfRound(c)` (bleeding, poison onset, effect expiry), `endCombat(party)`, `rollSurprise`, `moraleCheck`,
`xpForVictory`, `autoResolve`.

**Battle bridge** (battle.js — what the tactical CombatEngine calls): `fxView(c)` makes `c.fx` a live Proxy over the
creature's rules effects (`fx.blessed` → rounds left, `fx.asleep = 5` adds the effect, `delete fx.held` removes it;
`prot`/`mirror` alias `protEvil`/`mirrorImage`; other keys are scratch), `ableToAct`, `ableToCast`,
`attacksThisTurn(c, round, target, {ranged, weapon})`, `castInBattle(rng, id, caster, targets, {level, fromItem})` →
CastResult + scene `hits` `{id, dmg, heal, saved, killed, effect, bolts, text}`, `roundUpkeep(c)` → bleed/down/wake
events, `hammerTurn` (Spiritual Hammer's later blows), `specialsOnHit`. The engine resolves every spell, attack count,
condition and end-of-round tick through these; it uses the `'slay'` helpless rule (Gold Box sleep/hold).

**Items, treasure, temple**: `useItem(rng, ch, index, targets, {spellId})`, `scribeScroll`, `identifyItem`, `detectMagicIn`;
`generateTreasure(rng, types, {scale, count})` → `{coins, gems, jewelry, items, maps?}` (MM types A–Z incl. W),
`rollMagicItem`, `treasureValue`, `shareCoins`; `TEMPLE_SERVICES`, `serviceApplies(id, ch)`, `serviceProblem(id, ch)`
(tooltip reason, e.g. elves cannot be raised), `raiseAllowed(ch)`, `performService(rng, id, ch)`.

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
Optional events the audio director listens for (emit them when convenient; it already infers most of this from
`message` text and `party:changed`): `combat:start {encounter}`, `combat:end {winner: 'party'|'monster'|'fled'}`,
`audio:stinger {name}` (victory/defeat/levelup/discovery/danger/quest/fallen), `audio:sfx {name, opts}`.

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

## Audio

Everything is synthesized at run time — no samples. `ctx.audio` (src/audio/AudioEngine.js):

| call | what |
|---|---|
| `sfx(name, {bus:'sfx'\|'ui', pitch, vol, pan, delay, surface, material, crit, n, mode})` | one-shot effect (library in `sfx/library.js`) |
| `playMusic(id)` / `music(state, {fade, intensity})` | crossfade the score. States: `title intro town tavern ruins dungeon crypt wilds camp combat encounter victory defeat silence`; aliases `explore`/`phlan_streets`/`city`/`dungeon` resolve to the current map's mood (`environments.js`) |
| `stinger(name)` | one-shot musical sting over the ducked score: `victory defeat levelup discovery danger quest fallen` |
| `setIntensity(0..1)` | adaptive layers (combat: base 0.5, raised automatically as the party falls) |
| `ambience(bed, {night})` | `title town ruins dungeon crypt wilds camp interior combat_out combat_in` |

SFX names scenes may use: `step footstep walk bump turn door door_close door_locked door_secret chest trap splash swing miss hit
hit_armor hit_bone crit bite claw block bow arrow_hit death spell spell_fire spell_cone spell_lightning spell_shock spell_missile
spell_sleep spell_mind spell_cloud spell_heal heal spell_holy spell_curse spell_ward spell_turn spell_fizzle potion click hover
confirm cancel error page open close map coins save equip sparkle levelup vox_<family> vox_<family>_die` (families: kobold goblin
orc gnoll ogre skeleton zombie ghost rat wolf spider frog lizard human dragon; `VOICE_OF` maps monster ids).
Generic requests are made specific by the director: `step` uses the map's surface (cobble/gravel/dirt/grass/wood/stone) and a
party of feet; in combat `miss` with pitch > 1.2 becomes a sword swing or bow twang, `hit` becomes armour/bone/flesh + monster
pain voices, and `spell` becomes the cast spell's family — all inferred from the combat log line that precedes it.
Buttons get hover/click ticks globally. The AudioContext starts on the first gesture; in debug/screenshot mode
(`?scene=`) audio is muted. Settings read: `masterVolume musicVolume sfxVolume` (+ optional `ambienceVolume uiVolume muteAll
muteInBackground`).

Review renders: `node tools/audiorender.mjs [--match music_|--only sfx_door,...] [--spectro] [--port N]` → `audio_out/<cue>.wav`
(+ spectrogram PNGs). Cues: `music_*`, `sting_*`, `amb_*`, `sfx_*`, `sfx_step_<surface>`, `inst_<preset>`, `demo_combat_adaptive`,
`demo_crossfade`. Fails on NaN, silence or clipping.

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
* Spells: full rules engine (castSpell, memorization, rest), used by camp and by tactical combat (via rules/battle.js).
* Shops: buy only; temple/training services not implemented.
* UI: no inventory/character sheet screens; settings/options UI minimal; no rebinding UI (API exists).
* Reference renderer is from memory of the EGA original — close in layout/palette, not pixel-exact.
