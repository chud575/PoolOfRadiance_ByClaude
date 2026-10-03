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
  classes.js               XP, THAC0 (Gold Box progressions or DMG matrices by option), saves, slots, thief skills, turn undead, alignments, PoR level caps
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
  AudioEngine.js           public API: sfx(), playMusic()/music(), stinger(), endCombatWith(), setIntensity(), ambience(), setEnvironment()
  director.js              event-bus listener: location→mood/surface/reverb/ambience, combat events/log→contextual sfx + intensity, stingers
  loudness.js              per-cue loudness targets + calibrated gains (loudness.data.js, generated by audiorender --calibrate)
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
* `createCharacter({rng, name, race, classSpec, abilities?, gender?, alignment?, items?, level?, spellbook?, ignoreLimits?})` — `level`
  stops at the racial level limit unless `ignoreLimits`.
* Class ability minimums are the **Gold Box subset** PoR enforces (fighter STR 9 / CON 7, cleric WIS 9, magic-user INT 9 /
  DEX 6, thief DEX 9), not the full PHB rows (fighter WIS 6, cleric STR/INT/CON/CHA 6...). 
* **Rules options** (`RULES_OPTIONS`, defaults `RULES_DEFAULTS`; `setRulesOptions(o)`, `resetRulesOptions()`,
  `attachRulesSettings(settings, bus)` in main.js; tests that change an option must reset it):
  * `thac0Table`: `'goldBox'` (default) — one consistent model, every class THAC0 20 at 1st: fighter 21 − level (the PoR
    sheet: 13 at 8th), cleric −2 per 3 levels, thief −1 per 2 levels, magic-user −1 per 3 levels (`GOLDBOX_THAC0_STEP`; the
    progressions AD&D 2e later printed). `'dmg'` — the 1e DMG attack matrices for all classes (fighter 20,20,18,18...,
    cleric 20×3, MU 21×5, thief 21×4). The settings key `fighterThac0` is accepted as an alias (`RULES_OPTION_ALIASES`);
    **UI owner**: the setting now governs every class — relabel it "THAC0 table" and drop "paladins and rangers" from its help.
    `thac0For(cls, lvl, {thac0Table})`.
  * `multiclassArmorCasting`: `'goldBox'` (default) — a multi-class magic-user (F/MU, MU/T, F/MU/T, C/MU...) casts in any
    armour and shield its other class lets it wear, as in the Gold Box games; `'strict'` — no armour or shield at all, the one
    exception being elfin chain on an elf or half-elf (a table ruling, not a cited PHB rule). Single-class and dual-class
    magic-users always follow the strict rule. `armorAllowsArcane(ch, {multiclassArmorCasting})`.
* `deriveStats(ch)` → `{thac0, ac, acRear, acMissile, acHurled, saves, savePoison, hitBonus, dmgBonus, weapon, weaponMagic, ranged, damage,
  attacks, move, baseMove, weight, encumbrance, spellSlots, canCastArcane, thief, backstab, levels, className, classAbbr,
  classLevels ('F8 / MU3'), dual, dualActive, abilities (effective), mods (effects), ...}`. `acRear` = no shield, no DEX
  bonus (what rear attacks and backstabs hit); the Shield spell (PHB) gives `acHurled` 2 (darts, axes, javelins, spears,
  rocks), `acMissile` 3 (arrows, bolts, sling stones) and `ac` 4. `saves.ppdm` does
  **not** include the dwarf/halfling CON bonus — it applies against poison only (`savePoison` for the sheet, `rollSave(...,
  {poison:true})` in play). A dual-classed human's labels show both careers (`classLabels(ch)`).
* Tables for tooltips: `abilitySummary(abilities)`, `strengthTable`, `intelligenceTable`, `constitutionTable`, `charismaTable`,
  `THIEF_SKILL_NAMES`, `SAVE_NAMES`, `CONDITIONS[id].{name,desc}`, `describeEffects(ch)`, `statusLabel(ch)`.
* Racial level limits follow one model, the PHB's: fighters and magic-users capped by STR / INT where the PHB says so
  (elf F 5/6/7, MU 9/10/11; half-elf F 6/7/8, MU 6/7/8; dwarf F 7/8/9; gnome F 4/5/6; halfling F 4/5/6 at STR <17/17/18 —
  halfling STR caps at 17, so 5th), flat otherwise (half-elf cleric 5; thieves unlimited). PR_LEVEL_CAPS apply on top.
  Raise Dead strips every effect (and its temporary hp) before recomputing max hp.
* Races/classes: `RACES`, `CLASSES`, `racialLevelLimit(race, cls, abilities)`, `allowedAlignments(spec)`, `PR_LEVEL_CAPS`
  (fighter 8, cleric 6, magic-user 6, thief 9), `thac0For`, `savesFor`, `spellSlots`, `thiefSkills`, `turnNeeded`.

**Equipment**: `addItem(ch, id, {equip, magic, spells, cursed})`, `equipItem`, `unequipItem`, `removeItem`, `canEquip`,
`equipProblem` (reason string for the UI), `itemName(entry)` (honours identification and `entry.magic` overrides),
`itemValue`, `itemWeight`, `carriedWeight`, `encumbranceCategory`. Inventory entries may carry `magic` (+N) so treasure
can make "Long Sword +2" from `longSword`. Optional ItemDef fields the rules understand: `magic`, `magicVs` (weapons:
`{undead: 2}` = +2 more to hit *and* damage vs the undead — keys are tags (`undead`, `snake`, `person`…), families
(`orc`, `giant`, `human`…) or `evil`/`good`/`lawful`/`chaotic`; best match counts, also an InventoryEntry field;
`deriveStats().weaponMagicVs` → `combatant.magicVs`, read per target by `magicVsFor(a, d, {magicVs})` in `resolveAttack`/
`hitChance`, and the extra plus counts against `magicToHit` immunity; creature.js `magicVsBonus(table, defender)`), `acBase`
(bracers), `acBonus`, `saveBonus`, `setStr` (gauntlets of ogre power), `rateOfFire`, `cursed`, `classes`, `slot`,
`casterLevel`; potion `effect` strings `heal:<dice>`, `giantStrength:<str>`, `speed`, `neutralize`, or a spell id.
`ITEM_RULES` / `itemRulesOf(id)` layer DMG facts over the data (Wand of Paralyzation → its own cone, any creature, save vs
wand; the offensive wands — Fire, Lightning, Paralyzation, Magic Missiles and PoR's Sleep — are magic-user only (DMG 'M',
`classes: ['magicUser']`, enforced by `useItem` and `battleItemUse`); Gauntlets of Ogre Power C/F/T; Giant Strength and Heroism fighter-only; Necklace of Missiles beads 5/3/3 HD).
Heroism (`heroismLevels`: +4/+3/+2/+1 levels at 0/1-3/4-6/7-9) grants fighter levels for THAC0, saves and attack rate plus
that many d10 temporary hp. **Protection stacking (DMG)**: a ring of protection's AC does not add to magic armour (its save
bonus does) and rings don't stack; a cloak of protection gives nothing over magic armour or non-leather armour; bracers
are armour + shield (a shield adds only its enchantment) — plate +1, shield +1, ring +3, cloak +2 is AC 0.

**Experience & training**: `awardXp(ch, xp)` (splits multiclass, +10% prime requisite, banks at most one point short
of the level after next — Gold Box training rule), `trainableClasses(ch)`, `trainingCost(ch)` (PoR: 1,000 gp),
`trainLevels(ch, rng)` (one level per visit, capped by race and PoR caps), `maxLevel(ch, cls)`,
`dualClassProblem(ch, cls)` / `dualClass(ch, cls)` / `dualClassChoices(ch)` → `[{cls, ok, reason, warning, regainAt, cap}]`
(`dualClassWarning(ch, cls)`: "you will never regain Fighter abilities (MU cap 6 ≤ F8)" when the new class's PR/racial cap
can never exceed the old level — **shop owner**: show it on the chip; humans; PoR lets them
change class at the Training Hall — **shop owner**: list `dualClassChoices` there, charge the training fee, call `dualClass`). **Consumer obligation**: when `trainLevels` raised
`'magicUser'`, offer `trainingSpellChoices(ch)` (camp.js; PoR: one new spell per level trained) and `learnSpell` the
pick — ShopScene does. `drainLevel(ch, n)` (energy drain: the highest of *all* classes with a level — a dual-classed
human's dormant old class too, `dual.level` follows — loses a level, its hit die, XP to the new level's midpoint; death
only when every class is at 1st). A dormant dual class lends nothing: no sweeps, 3/2 attacks or exceptional STR
(`activeClasses`) + `trimMemorized(ch)` (camp.js), and no turning (`turnLevel`). `highestLevel(ch)` deliberately still
counts the dormant class (an F8 → MU1 is an 8th-level creature for Sleep's HD limit and level-keyed fallbacks — Gold Box
ruling). Multiclass CON bonus: the fighter's
+3/+4 applies to every class's die before dividing while fighter is one of the classes (Gold Box ruling); a dual-classed
human's dice each use their own class's bonus (an MU turned fighter gains nothing retroactively). `tempHpOf(ch)` —
temporary hit points (heroism) are part of `hp.max` while they last and leave with the effect.

**Health**: `applyDamage` (0 unconscious, −1…−9 dying, ≤ −10 dead; wakes sleepers), `bleed(ch)` (1 hp/round),
`bandage(ch)`, `heal` (DMG ruling: any healing stops a dying character's bleeding, even if still below 0), `raiseDead(rng, ch)` (resurrection survival, −1 CON; refuses elves per the PHB), `stoneToFlesh`,
`isConscious`, `isAlive`.

**Conditions**: `addEffect(target, id, {rounds, source, level, mods, data})`, `removeEffect`, `hasEffect`, `getEffect`,
`effectMods(target)`, `tickEffects(target, rounds)`, `tickPoison(target, minutes)` (the one poison model: onset in
rounds = minutes counts down in combat, exploration and rest alike, except the minutes Slow Poison covers),
`isIncapacitated`, `isHelpless`, `conditionsAllowCasting`, `clearCombatEffects` (keeps poison, disease, curses and every
effect flagged `persist` — spells whose duration runs in turns/hours, `LONG_DURATION_SPELLS`: Enlarge, Strength, Prot.
from Normal Missiles, Resist Fire/Cold, Invisibility...; round-measured spells — Bless, Haste, Mirror Image, Prot. from
Evil/Good, Friends — end with the battle). Conditions include `afraid` (fear aura:
flees, −2 to hit if cornered) and the `fighterLevels` mod (heroism). Effects live in `target.effects`; `target.conditions` mirrors their ids as strings.
Party combatants share `hp`, `conditions` and `effects` with their Character.

**Time** (camp.js): `passTime(party, minutes)` — exploration/travel/dialogue time: timed effects run down (Strength 1 h/level,
Bless, Detect Magic, Find Traps, Prot. from Evil... expire while walking), poison onset counts down, the dying are bound;
no healing or memorization (that is `rest`). `syncPartyTime(party, game.minutes)` — idempotent: brings every member up to
the game clock via a per-character `timeMark`; `rest`/`passTime` advance the marks so a camp that rests and then calls
`game.advanceTime` never ticks twice. `attachTimeSync(bus, game)` — wired once in main.js — calls `syncPartyTime` on every
`time:changed`, so every `GameState.advanceTime` (explore steps and searches, dialogue, shops, travel, rest) runs effects
and poison down; when something expired, a member died or was bound it emits `party:time` (`{minutes, expired, died,
bandaged}`) and `party:changed`. **Combat rounds** count on the clock: 1 round = 1 minute (`MINUTES_PER_ROUND`);
`endBattleTime(game, rounds)` (CombatScene.finish) moves the time marks with the rounds — which already ticked effects
and poison — and then advances `game.minutes`, so nothing ticks twice. Tested end to end with a real GameState + EventBus (Bless expires after 30 minutes of
walking; poison kills on the road).

**Spells** (`SPELL_RULES`, 54 PoR spells incl. temple-only cures/raise dead, plus item-only `wandParalyzation`)
* `spellsForClass(cls, level)`, `getSpell(id)` (rules + data display merged: `name, desc, tip, schools, usable, ...`),
  `spellLevel(id, cls)`, `spellTargeting(id, casterLevel, cls)` → `{target, range, shape, size, maxTargets, hostile, duration,
  castTime}`. `castingDelay(id, cls, L, {fromItem})` → 1e casting time in segments (Magic Missile 1, Fireball 3, CLW 5,
  Bless 10 = end of round; items 0; clamped to one round) — see **casting time** under the battle bridge.
  `castingTime(id, cls, L)` is the unclamped PHB figure (Strength and Cure Disease 100 = 1 turn: camp only; tested for
  every spell against the PHB). Burning Hands is the PHB 3' fan: a cone of size 1 (adjacent squares only).
* `spellSummary(id, cls, level)` → `{range:'6 squares', area:'3x3 squares, up to 3', duration:'7 rounds', save:'spell
  negates', castTime:'5 segments', usable:'combat only'}` — **the** display strings for spell cards and tooltips,
  computed from SPELL_RULES at the caster's class and level (SpellPanel's card uses it); `durationText(rounds)`,
  `castTimeText(segments)`.
* `castingClass(caster, id, cls?)` — multiclass casters keep separate memories: the class comes from the memorized slot
  (`cls`, else the first class in `spells.memorized` order holding the spell, else the first active class). A half-elf C/MU
  with Hold Person memorized only as MU casts the MU version (range 12, 4 persons, −3 alone, 2 rounds/level, 3 segments).
  `consumeMemorized(ch, id, cls?)` / `isMemorized(ch, id, cls?)` act on that class. `castTime` is per class where the PHB
  differs (MU Hold Person / Dispel Magic 3 segments, cleric 5 / 6). MU Hold Person lasts 2 rounds/level (PHB p. 79; OSRIC
  agrees).
* `castProblem(caster, id, {context, ignoreMemory, cls})` → reason or null (memorized, silence/held, armour for arcane — see
  `multiclassArmorCasting` — camp/combat usability).
* `castSpell(rng, id, caster, targets, {consume, ignoreMemory, check, context, level, cls, fromItem, saveKey, noFailure, centre, strict1e})` → `{ok, reason,
  failed, level, results:[{target, affected, saved, save, resisted, immune, missed, damage, healed, applied, removed, down,
  charmed}], flags, log}`. `saveKey` overrides the save category (wands/staves/rods pass `'rsw'`, DMG). Memory is always checked unless `ignoreMemory: true` (or `check: false`) is passed explicitly.
  Clerics roll the PHB low-WIS spell failure (WIS 9: 20%…12: 5%; the slot is spent; items never fail; `noFailure` for
  scripted casts). A hostile spell (or one released from a wand, scroll or necklace) ends the caster's Invisibility (PHB;
  `flags.revealed`). The caller picks targets from the template (primary/nearest first); the engine filters by `affects`,
  applies `maxTargets`, saves (WIS vs mind magic, DEX vs fireball/lightning, hold person: cleric −2 alone / MU −3 alone,
  −1 for two; range cleric 6 / MU 12), Sleep on the five PHB bands (`SLEEP_BANDS`: ≤1 HD 4d4, 1+1–2 2d4, 2+1–3 1d4,
3+1–4 1–2, 4+1–4+4 0–1), weakest first, each band's number rolled when first reached and each sleeper using 1/N of
the spell — a group of one kind gets exactly the PHB number (two bugbears: 1d2), mixed groups share it — magic resistance (`magicResistanceOf(t, casterLevel)`:
`magicResistance` field or `magicResist:N` tag, DMG ±5%/level from 11th), haste/slow cancelling each other, `dispelChance` (DMG +5%/level above,
  −2%/level below), elf/half-elf sleep-charm resistance, undead immunity, shield vs magic missile, and returns terse Gold
  Box log lines. Utility spells report `flags` (`detectMagic`, `findTraps`, `unlock`, `readMagic`, `raiseDead`,
  `poisonCured`...). `hammerStrike(rng, cleric, target, magic)` is one Spiritual Hammer blow.
* **Spell attack rolls** (touch spells — Shocking Grasp, Cause Wounds/Blindness/Disease, Bestow Curse — and every
  Spiritual Hammer blow) go through combat.js **`spellAttack(rng, caster, target, {str, weaponMagic, weaponImmunity,
  strict1e})`**, the same defender pipeline as `resolveAttack` (`liveMods(..., {defenderOnly:true})`): Mirror Image eats
  hits (and loses an image), Blink's 50% miss and −2, Invisibility's −4 (touch spells and the hammer may swing at an
  invisible foe; ranged single-target spells still cannot single one out), Prot. from Evil's −2 against an evil caster,
  Shield, +4 vs helpless, nat 20/1 (QoL). The caster side is its own THAC0 + effect bonuses (+ STR for a touch); a
  weapon's enchantment never applies. Results carry `missed`, `image`, `blinked`.
* Verified values: Spiritual Hammer (PHB) hits with the cleric's own to-hit and does a war hammer's 1d4+1 (2-5) vs S/M,
  1d4 vs L, **no magical plusses to hit or damage**; it counts as +1 per 6 levels or fraction (`ceil(L/6)`) *only* for
  which creatures it can strike (`weaponImmunity`); range 1"/level (one square per level); Silence 15' Radius gives no save
  to creatures in the area — only the creature it is cast upon saves (`castSpell`/`castInBattle` `centre`);
  Stinking Cloud lingers 1 round/level (battle.js `cloudExposure`: saves vs poison on entering or each round inside); Ray of Enfeeblement range 1 + L/4;
  Mirror Image 1d4 images, 2 rounds/level (PHB magic-user; 3/level is the illusionist spell); Hold Person's save penalty
  counts the creatures it was cast at (capped at its maximum), before non-persons and immunes drop out; Strength above 18 adds tenths (10% exceptional per point, PHB).
* **Concentration** (conditions.js): `isConcentrating(c)` → `'spiritualHammer' | 'chanting' | null`, `concentrationOf(c)`,
  `breakConcentration(c, {only})` → ids removed (with every linked effect on others: Chant's +1/−1), `linkConcentration`.
  Casting any spell or using a wand/scroll/potion (`castSpell` → `flags.concentrationBroken`) and any weapon attack
  (`resolveAttack` → `concentrationBroken`) end it. **Spiritual Hammer**: `hammerTurn` at the cleric's turn start *is* the
  cleric's action — it zeroes `attacksLeft` and `directingHammer(c)` blocks spells (`battleCastProblem`) and items
  (`battleItemUse`) until `roundUpkeep` clears it; with nobody in reach the hammer waits and the cleric may act (ending it);
  held/asleep/down ends it. **Chant**: PHB casting time 1 turn (`castingTime` 100; `castingDelay` clamps to the round, so it
  takes hold at the round's end), lasts while the cleric chants: damage (`onDamaged`), moving off the square, silence or
  incapacity (`roundUpkeep` → `effectEnd` events), attacking or casting end it. **UI/combat owner**: a "Release hammer /
  stop chanting" command calls `breakConcentration(c.ref ?? c)`.
* Saves: the DEX defensive adjustment applies both ways to dodgeable attacks (`dodge`: fireball, lightning bolt, **breath
  weapons**, pits): DEX 3 −4 … DEX 18 +4. Monster saves (`combat.savingThrow`) go through `rollSave`, so element
  (Resist Fire/Cold), source (Prot. from Good/Evil) and mental options apply to monsters too. Shield gives +1 to all saves
  (PHB: vs frontal attacks; the grid has no facing for spells). Silence in battle: `castInBattle` takes `o.at` (the aim
  square's occupant is the `centre`; empty square → nobody saves) or falls back to the first (nearest-the-aim) target.
* Thief skills in armour (`classes.THIEF_ARMOR_ADJ`, UA): leather none; padded/studded PP −30, OL −10, F/RT −10, MS −20,
  HS −20, HN −10, CW −30; elfin chain PP −20, OL −5, F/RT −5, MS −10, HS −10, HN −5, CW −20; anything heavier forbids them.
  Wand of Magic Missiles (DMG): one 2-5 missile per charge (`ITEM_RULES.wandMagicMissile.casterLevel` 1); wands of fire
  and lightning cast at 6th (6-die bolts). Combatant `range` is `deriveStats(ch).range` (rules `missileRange`: short bow 15)
  — **UI owner**: show `missileRange(def)` in Inventory.js rather than the raw data `range`.
* Deliberate simplifications: thieves may be any alignment but LG (PoR creation rule); clerics may use slings (Gold Box);
  magic armour moves at the PHB base rate (its benefit is half weight).
* Memorization (camp.js): `knownSpells(ch, cls)`, `slotsFor`, `checkLoadout`, `prepareSpells(ch, cls, ids)`, `autoPrepare(ch)`,
  `spellsToMemorize`, `memorizationTime(ch)` (1e: 4/6/8 h rest + 15 min per spell level, net of banked study),
  `study(ch, minutes)` (spells return one at a time once their own 15 min/level is done — an interrupted rest keeps them),
  `rest(party, minutes)` → `{healed, memorized, expired, died}` (1 hp/day natural healing, `healPerDay` option; poison
  onset counts down by the minutes rested unless Slow Poison holds it), `learnSpell` (INT max spell level, max spells per
  level, optional chance to know). Model: `ch.spells.prepared[cls]` = chosen load-out, `ch.spells.memorized[cls]` = still
  in memory (casting removes), `ch.spells.study` = banked minutes.

**Combat** (combat.js, co-owned): `combatantFromCharacter` (size from the race: halflings and gnomes are S), `combatantFromMonster(rng, id, index, {id})` (ids are
scoped to the battle's Rng — `m1_kobold`, `m2_kobold`… — never to session history; character ids likewise come from the
creating Rng's own sequence, or `opts.id`), `rollInitiative`, `canAct`, `resolveAttack(rng,
a, d, {mods, dmgMod, backstab, rear, ranged, helpless})` (the base AC is by direction — `defenderAc(a, d, {rear,
ranged})`: rear and backstab strike `acRear` (no shield, no DEX; a monster's declared `shield`/`shieldAc` is ignored),
missiles strike `acMissile`, or `acHurled` when the attack is thrown (`isHurledAttack`: the character's missileProfile,
`attacker.hurled`, a monster's javelins/rocks) — the Shield spell applies even if cast before the combatant was built; else melee AC; applies live effects: bless/prayer, shield, invisibility, blink,
mirror image, prot. from evil/missiles; racial adjustments via `racialCombatMods` — dwarves +1 vs orcs/half-orcs/goblins/
hobgoblins, gnomes +1 vs kobolds/goblins, giants/ogres/trolls/titans (+ gnolls/bugbears vs gnomes) −4 to hit dwarves and
gnomes; helpless targets per `HelplessRule`: `'bonus'` +4 (default), `'auto'` melee auto-hit, `'slay'` coup de grace),
`hitChance(a, d, mods, {ranged, helpless})`, `attackRateOf(c, {weapon})` / `attacksFor(c, round, {weapon})` — the single
source of truth for attack counts, computed live (3/2 fighters alternate 1,2; haste ×2, slow ×½ for characters *and*
monsters, whose count is routines × attacks in the routine), `sweepAttacks(ch, target)` (fighters vs < 1 full HD incl.
1-1 HD goblins, `belowOneHd`; the same creatures save as 0-level men and have THAC0 20 — one ruling), `onHitSpecials` (ghoul paralysis — elves immune; a ghast's touch paralyzes elves too (MM); a `paralyzeNoElf` tag marks
other ghoul-like touches — poison, rat disease), `savingThrow`,
`poison(rng, target, {mode:'deadly'|'damage', onset})`, `turnUndead(rng, level, type)` (unknown types: no effect; take
`level` from character.js **`turnLevel(c)`** — the cleric level only while cleric is in `activeClasses`, so a C4 → F1
dual-class cannot turn; `canTurnUndead(c)`),
`endOfRound(c)` (bleeding, poison onset, effect expiry), `endCombat(party)`, `rollSurprise(rng, {partyMod, monsterMod,
party, scout})` (with `party`, elves/halflings in non-metal armour surprise 4 in 6 — explore.js `surpriseMods`), `moraleCheck`,
`xpForVictory`, `autoResolve`. Rear/backstab: pass `{rear, backstab}` flags (never fold them into `mods`);
`situationalHit` gives rear +2, backstab +4 *instead*, and `hitChance` takes the same flags so the preview equals the roll.
Persons (Charm/Hold Person): `monsterIsPerson(m)` — an explicit `person: true|false` wins; class-based NPCs are persons;
otherwise `familyOf(m)` must be in `PERSON_FAMILIES` (human, the demi-humans, kobold, goblin, hobgoblin, orc, gnoll, lizard
man, troglodyte and the PHB's sprites; human bands like `bandit*`, `buccaneer*`, `*Priest` are family `human`). No id list.
Class-based NPCs: `classAsOf(m)` (`classAs`/`saveAs` 'cleric5' or `{cls, level}`, else a `spells:clericN` tag → cleric of
level max(N, HD)); `monsterBaseSaves(m)` / `monsterBaseThac0(m)` use that class table (Priest of Bane = cleric 5: ppdm 9,
bw 15), else fighter saves at `effectiveHd(hd, hpBonus)` / the DMG monster matrix. Ruling: any `+N` hp bonus
saves as the next HD (bugbear 3+1 = F4), the same reading as the matrix's '+' rows; 1-1 HD and less save as level 0. **0-level men** (`isZeroLevelMan(m)`: human family, no class,
≤ 1 HD with no plus — bandits, buccaneers, thugs; `level0: true|false` overrides) fight at THAC0 20 (`ZERO_LEVEL_THAC0`,
the PoR value) and save as level-0 men (ppdm 16, pp 17, rsw 18, bw 20, sp 19). `tests/data/monster-consistency.test.js`
checks every data `thac0` against `monsterBaseThac0` of the def without it; open data mismatches (world owner) are listed
there and the test fails both on a new mismatch and when a listed one is fixed. Backstab multiplies the whole blow (weapon die + STR + magic) —
a deliberate Gold Box-style reading; the PHB is ambiguous.
Monster tags enforced: `magicToHit:N` / `silverToHit` (`weaponImmunity(att, def)`; combatants carry `weaponMagic`,
`weaponSilver`, `weaponEdged`; monsters strike as +1 at 4+1 HD … +4 at 10+4, `monsterHitPower`), `halfEdged`
(skeletons: half damage from edged/piercing, `BLUNT_GROUPS`), `slow` (zombies act last in `rollInitiative`),
`drainLevel[:N]` (wight 1, spectre 2 — `DRAIN_LEVELS`), `drainStr` (shadow: −1 STR per hit for 2d4 turns, death at 0),
`stench` (battle.js `stenchAuras`), `magicResist:N`, `spells:clericN` (see below). Every tag is registered in
`SPECIAL_HANDLERS` (specials.js; a test fails if a monster carries an unregistered tag).

**Monster special actions** (specials.js): `breathWeapon(rng, attacker, targets, {element?, damage?})` (DMG dragon breath:
damage = current hp, save vs Breath for half, element resistance and element save bonuses apply, 3 uses — `breathOf`,
`breathsLeft`, `BREATH_WEAPONS`: Tyranthraxus's `breath:lightning` is a 10-square line), `throwRocks(rng, giant, target,
{distance})` (hill giant: missile attack, 2d8, 2-20 squares, dwarves/gnomes −4 to be hit, Prot. Normal Missiles does not
stop boulders), `fearAura(rng, src, targets)` (`fear`: < 1 HD flee, ≤ 3 HD/levels save vs paralyzation or `afraid` 4d6
rounds, once per battle), `regenerationOf(c)` (`regenerate:N` from the 3rd round after being hurt).

**Battle bridge** (battle.js — what the tactical CombatEngine calls): `fxView(c)` makes `c.fx` a live Proxy over the
creature's rules effects (`fx.blessed` → rounds left, `fx.asleep = 5` adds the effect, `delete fx.held` removes it;
`prot`/`mirror` alias `protEvil`/`mirrorImage`; other keys are scratch), `ableToAct`, `ableToCast`,
`attacksThisTurn(c, round, target, {ranged, weapon})`, `castInBattle(rng, id, caster, targets, {level, fromItem, at, centre})` →
CastResult + scene `hits` `{id, dmg, heal, saved, killed, effect, bolts, text}`, `roundUpkeep(c)` → bleed/down/wake
events (+ concentration upkeep), `hammerTurn` (Spiritual Hammer's later blows; the cleric's action for the round),
`directingHammer(c)`, `breakConcentration`/`isConcentrating`, `specialsOnHit`. The engine resolves every spell, attack count,
condition and end-of-round tick through these; it uses the `'slay'` helpless rule (Gold Box sleep/hold).
* `battleTargeting(id, caster, {level})` — **the** source of spell targeting (range, shape, size, maxTargets at the
  caster's level and class) in the engine's vocabulary; `logic/spells.js` only adds VFX/pick hints (`engine.tactics`).
* `battleCastProblem(c, id)` / `castableInBattle(c, list)` — conditions + armour (an elf F/MU in plate gets no MU
  spells); `castInBattle` checks them too (memory is the engine's job).
* `monsterSpells(c)` / `consumeMonsterSpell(c, id)` / `monsterCasting(c)` — `spells:clericN` makes an Nth-level cleric
  with that level's slots, filled once per battle (`MONSTER_PRIEST_SPELLS`, or the monster's `spellList`); the AI casts
  them through `engine.cast` like a PC.
* Monster actions for the AI: `monsterSpecialActions(c)` → `[{id:'breath'|'rocks', shape, size, range, element?, uses?}]`,
  `breathInBattle(rng, c, targetsInTemplate)` → one `breath` event with castInBattle-style `hits`, `rockInBattle(rng, c,
  target, distance)` → an `attack` event (`rock: true`), `fearInBattle(rng, all, seen?)` → effect events (call at round
  start). **Wired**: `CombatEngine.specialActions/specialTactics/specialArea/special(c, 'breath'|'rocks', at)`; the AI
  (`pickMonsterSpecial`) breathes when the template catches 2+ foes (or the last one) and no friends, and a giant not in
  melee hurls boulders 2-20 squares; a breath is presented as a `cast` event (`spell:'breath'`, `special:'breath'`,
  `vfx` lightning/cone) and `engine.tactics(c,'breath')` describes it. `fearInBattle` runs in `startRound` (once per
  creature per battle); the afraid flee under AI control (`engine.mustAutoAct`). End-of-round regeneration is
  `regenerationOf` (fire/acid damage accumulates in `c.burnt` and is not regenerated). Morale routs remain separate.
* Surprise: `CombatEngine.rollSurprise({forced, party})` before the first `startRound` — rules `rollSurprise` (1-2 in 6
  per side, elven stealth via `surpriseMods`) on an RNG derived from the engine's state without advancing it; the
  surprised side loses round 1 (`isSurprised`), a `surprise` event (banner) leads the first `nextTurn`. `forced`:
  `'party'` = the party has the drop (an encounter's or dialogue choice's `surprise: 'party'`, e.g. sneaking up on the
  orc boss), `'monsters'` = ambush, `'none'`. CombatScene skips the roll for frozen debug shots and demos unless
  `?surprise=` is given.
* `battleItemUse(ch, i)` → `{kind, spellId, level, saveKey}` (potion / spell at `itemCasterLevel`, scrolls gated by
  `canUseScroll`, wands save vs `rsw` — remembered for the following `castInBattle`, but pass `saveKey` through when you can;
  the Necklace of Missiles throws fireball beads — `usableInBattle(ch, i)` says which entries qualify) and
  `quaffInBattle(rng, c, i)` (rules `useItem`: giant strength sets STR, speed hastes and ages, heroism, invisibility,
  neutralize…).
* **Casting time & disruption (1e)**: `beginCasting(c, id, {at, cls, level})` records a `casting` effect resolving at
  `initiative − castingDelay` segments; the slot is spent when casting begins. Any damage meanwhile marks it lost
  (`conditions.onDamaged`); `finishCasting(c)` → `{ok}` or `{lost, reason:'struck'|'down'|'incapacitated', text}`;
  `castingOf(c)`, `castDueBefore(c, init)`. The CombatEngine casts at once when no faster actor is still to act, else
  holds the spell (`engine.casting`) and resolves it in `nextTurn` before the first slower actor (ties: the spell) or at
  the end of the round — events `effect` `Casting` / `Spell lost`. Items release at once.
* `cloudExposure(rng, c, area, round)` — the lingering Stinking Cloud: save vs poison (CON bonus applies) or nauseous
  1d4+1 rounds; the engine calls it at round start for those inside and on every step into the cloud (once per round).
* `endBattle(partyCombatants)` — **consumer obligation** at the end of every battle (CombatScene.finish): strips held,
  asleep, charmed, hasted, nauseous, stench… from the Characters (poison, disease, curses, strength drain persist).

**Missile fire** (character.js / items.js — wired into the combat engine's `rangedProfile` and range modifier):
`missileProfile(ch)` → `{def, entry, hitBonus, dmgBonus, damage, damageLarge, range, bands, thrown, magic, launcherMagic,
ammoMagic, ammo, ammoEntry, consumes, fxHit, fxDmg, rateOfFire}` | null — the equipped missile weapon, else one in the
pack, else a spare throwable weapon (`throwableDef`/`THROWN_RANGE`: dagger, hand axe, spear 3 squares, javelin 6 — never
the only one in hand). **One map scale**: `SQUARES_PER_INCH = 1` (1 square = 10' = 1 PHB inch at the indoor scale, the
same scale spells use — Fireball 10 + L squares); `missileRange(def)` = PHB long range × that (dart 4, short bow 15,
long/composite bow 21, light crossbow 18, heavy 24, sling 20); data `range` only for weapons outside `MISSILE_RANGES`. Launchers need ammo: the equipped stack, else the best-enchanted one (cursed −1 last). To hit =
DEX missile + launcher magic + ammo magic + racial (`racialWeaponHit`: halfling bow/sling +3, elf bow and short/long sword
+1) + STR to hit for thrown weapons (`isThrownWeapon`) + the timed effects already on the character (`fxHit`: bless,
curse, blindness...). Damage = STR + enchantment for thrown weapons, the ammo's enchantment for arrows/bolts (DMG: a
launcher's magic adds to hit only) + `fxDmg`. `magic` = max(launcher, ammo) counts for `magicToHit`. `consumes` is the
entry one missile uses up — `useMissile(ch, profile)` decrements it (an emptied thrown stack leaves the pack); the
profile is null when nothing is left. The engine's ranged attacker takes the profile's `fxHit/fxDmg` as its snapshot so
`liveMods` adds only later changes. `canBackstab(ch)` / `backstabMultiplierOf(ch)` (active thief class + thieving armour;
0 for a dual-classed human whose thief career is dormant) drive the engine's backstab. `rangeModifier(def, squares)` → `{band, mod, inRange}`: PHB
short/medium/long 0 / −2 / −5, with `missileRangeBands(def)` = the PHB bands (`MISSILE_RANGES`) at `SQUARES_PER_INCH`
(short bow 5 / 10 / 15).

**Exploration** (explore.js — for ExploreScene's LOCKED/SECRET edges, traps and encounters; **explore owner**: call
these and spend the returned `minutes` with `game.advanceTime`):
* `tryOpenLock(rng, party, door, {knock, force, pick, retry})` → `{opened, method:'knock'|'pick'|'force'|'bars'|'open'|null,
  who, chance, roll, minutes, attempts, text}`. Door = `{locked, barred, stuck, wizardLocked, bars, lockMod, knocked}`.
  Order: Knock (the spell's `flags.unlock`, opens even wizard locks) → best thief's Open Locks (DEX, race, armour; PHB:
  once per lock per thief level, `door.failedBy`) → the strongest member forcing it (`openDoorsChance(str, pct,
  {locked})`: x in 6, the locked/barred figure only at 18/91+ and giant STR) or bending bars (`bendBarsChance`).
* `detectTrap(rng, party, trap, {search, passive, strict1e})` (Find Traps spell finds outright; thief F/RT; dwarves/gnomes
  50% for stonework traps). **QoL RULE** `PASSIVE_TRAP_DETECTION`: stepping onto an unsearched trap still gives the thief
  and stone sense their roll (1e needs an active search; `passive:false` / `strict1e` plays it by the book),
  `findRemoveTraps(rng, ch, trap, {safe})` (F/RT %; HOUSE RULE, not PHB: failing by more than 20 springs it; `safe` = by the book).
* `searchSecret(rng, party, {passive, concealed, sliding})` — `secretDoorChance(race, o)`: elves/half-elves 1 in 6
  passing, 2 in 6 searching (3 concealed); others 1 in 6 searching only; dwarves use their 66% for sliding walls;
  searching costs 10 minutes. `stoneSense(rng, ch, kind)` / `stoneSenseChance` (PHB dwarf/gnome senses).
* `surpriseMods(party, {scout})` → `{monsterMod}` (−2 when the moving group / scout is all elves and halflings in non-metal
  armour) — fed into `rollSurprise({party})`.
* Traps: `TRAPS` (poisonNeedle, dartVolley, pit, fallingBlock, scythingBlade, sleepGas, fireGlyph, alarm), `trapSpec(event)`
  (an event `{type:'trap', trap:'pit', ...overrides}`), `springTrap(rng, party, trap, {victim, strict1e})` → `{victims:[{ch, hit, saved, damage,
  effect, status}], alarm, text}` (a 'lead' trap strikes `victim` — the thief whose disarm fumble sprang it — else the
  first able member; the trap's own THAC0 against AC with the same nat-20/nat-1 rule as weapons, saves with DEX dodge and the racial bonus only vs
  poison, damage through `applyDamage`), and **`resolveTrap(rng, party, trapState, {avoidable, search})`** — the whole Gold
  Box flow: detect (spell / thief / stone sense) → the best thief disarms (house rule: failing by more than 20 springs it) →
  else step around it (`avoidable`) or spring it; `found/removed/sprung` are written back on the state object so a one-shot
  trap acts once. **`triggerMapTrap(rng, game, ev, {search})`** is what ExploreScene calls for a map event
  `{type:'trap', trap, avoidable?, text?}`: state in `game.flags.traps[ev.id]` (`mapTrapState`), returns resolveTrap's result
  plus `lines:[{text, tone}]` and `quiet`. Kuto's Warrens has a dart trap (7,8) and a kobold pit (5,9).
* Scene-facing (wired in ExploreScene): `edgeKey(mapId, x, y, dir)` (same key from both faces of a wall),
  `openLockedDoor(rng, game, key, {useKnock, door})` — walking into a LOCKED edge: thief picks, then STR, then a
  memorized Knock (slot spent); state persists in `game.flags.doors[key]` (`lockedDoorState`, `isDoorOpened`) and an
  opened door stays open; `searchSquare(rng, party, [{dir}], {passive})` — the SEARCH command (10 minutes) and the elven
  1-in-6 notice on every arrival; `knockCaster(party)`.

**Items, treasure, temple**: `useItem(rng, ch, index, targets, {spellId})`, `scribeScroll`, `identifyItem`, `detectMagicIn`;
`generateTreasure(rng, types, {scale, count})` → `{coins, gems, jewelry, items, maps?}` (MM types A–Z incl. W; U/V give one
/ two of each magic kind except potions and scrolls, `EACH_MAGIC_KIND`; Z any 3 except potions — kind `'noPotions'`),
`victorySpoils(rng, encounter.treasure, slainMonsterDefs)` → `{gold, items, gems, jewelry, text}` (what CombatScene awards:
encounter gold/items/`types` + each slain monster's `treasure` type, individual J–N per creature),
`rollMagicItem` (DMG Table I bands, `magicTableIBand(d100)`: potions 1-20, scrolls 21-35, rings 36-40, wands 41-45,
misc 46-60, armour 61-75, swords 76-86, misc weapons 87-00), `treasureValue`, `shareCoins`; `TEMPLE_SERVICES`, `serviceApplies(id, ch)`, `serviceProblem(id, ch)`
(tooltip reason, e.g. elves cannot be raised — ShopScene shows it), `raiseAllowed(ch)`, `performService(rng, id, ch)`.

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
`time:changed`, `party:time {minutes, expired, died, bandaged}` (rules attachTimeSync), `settings:changed {key, value}`, `save:written {slot}`, `audio:music {trackId}`, `app:ready`.
Structured events the audio director listens for — the **primary** integration path (it falls back to parsing
`message` text and `party:changed` when they are absent, so emitting them is optional but makes contextual audio survive
any rewording of the log):
* `combat:event {ev, engine}` — **emitted by CombatScene for every engine event as it is played** (`_playEvents`):
  `ev` is the engine's own record (`attack {id, target, hit, crit, ranged, killed, immune, backstab, image}`,
  `down {id, status}`, `cast {id, spell}`, `turnUndead`, `flee`, `heal`, `round` …) and `engine` the CombatEngine for
  `byId()` lookups (side, monsterId, the character's race/gender). Once it is live the director ignores the log text
  for attacks/casts/falls. `tests/audio/contract.test.js` runs the real engine and rules templates against the director.
  Combat sounds are panned to where they happen on screen: the director projects the combatant's grid offset from
  the fight's centre (engine `x, y`) onto the camera's right vector, reading the yaw from the current scene
  (`scene.audioListener?.()` → `{yaw}` if a scene offers it, else its orbit camera's `cam.yaw`; read-only, no import).
  Impacts, parries and the victim's cry sit at the target, wind-ups at the attacker, death cries where the body falls.
* `combat:attack {attackerId, targetId, monsterId, targetMonsterId, attacker, target, targetSide, ranged, hit, crit, dmg}`
  — emit **before** the swing animation / `sfx('miss', {pitch: 1.4})` wind-up (names are display names, `monsterId`s are
  MONSTERS ids; missing fields are fine). Drives bow vs sword wind-ups, the attacker's voice, armour/bone/flesh impacts.
* `combat:cast {spellId, caster}` — before `sfx('spell')`; picks the spell family sound.
* `combat:start {encounter, monsters: [{monsterId, n}]}` — sets the starting music intensity from encounter strength.
* `combat:end {winner: 'party'|'monster'|'fled'}` — emitted by CombatScene.finish(); victory ends the battle cue on its
  next downbeat with a final hit and lands the fanfare there.
* Also used: `save:written` (save chime), `input:action` confirm/cancel/prevMember/nextMember in menus (confirm, cancel,
  page), `scene:enter/resume` overlays (open/close), `time:changed` (day/night beds, also while camping).
* `audio:stinger {name}` (victory/defeat/levelup/discovery/danger/quest/fallen), `audio:sfx {name, opts}`.

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
| `endCombatWith(name)` | end the battle cue on its next downbeat with its coda (final hit) and start the stinger there |
| `setIntensity(0..1)` | adaptive layers (combat: set from encounter strength, rises as the party falls, winds down with hysteresis as foes fall) |
| `ambience(bed, {night})` | `title town ruins dungeon crypt wilds camp camp_in interior combat_out combat_in` (camp follows game time; `camp_in` = resting underground) |

SFX names scenes may use: `step footstep walk bump turn door door_close door_locked door_secret chest trap splash swing miss hit
hit_armor hit_bone crit bite claw block parry shield dodge ready bow arrow_in arrow_hit death spell spell_fire spell_cone
spell_lightning spell_shock spell_missile spell_sleep spell_mind spell_cloud spell_heal heal spell_holy spell_curse spell_ward
spell_turn spell_fizzle pass_through potion click hover focus confirm cancel error page open close map coins save equip
sparkle levelup vox_<family> vox_<family>_die` (families: kobold goblin orc gnoll ogre troll giant skeleton zombie ghost rat
wolf spider frog lizard human dragon party; `VOICE_OF` maps monster ids; `vox_party`/`vox_party_die` take `{race, gender,
mode: attack|hurt}` — the party's own voices; every voice is a glottal pulse source with jitter, shimmer, random-walk
pitch, breath through the formants and subharmonic period doubling for growls; big creatures — orc, ogre, troll, giant,
dragon — also get a cached throat texture under the formants: rasp gated by a spiky random modulator, a jittered
subharmonic growl an octave down, saliva clicks and bubbles; the fireball has a 200 Hz–2 kHz roar that blooms for
~0.6 s after the boom). Unknown names are ignored with a console
warning (never a fallback click). Spell chords are transposed to the key of the score that is playing
(`song.key`). Blades have six round-robin takes per material; footsteps are heel/roll/toe contact noise per surface,
each surface calibrated on its own (`step_<surface>`). Blows, blasts and big voices get their own transient limiter.
Generic requests are made specific by the director (structured events first, the combat log as fallback): `step` uses the
map's surface and a party of feet; in combat `miss` with pitch > 1.2 is the attack wind-up — a bow twang or sword swing plus
the attacker's voice when a `combat:attack` / `combat:event` attack announced it (a structured hint belongs to its attack
until the next attack or round, so slow speeds and slow frames keep arrow hits and parries specific), otherwise a neutral `ready` rustle followed by the specific
swing / incoming arrow the moment the attack's own log line lands (never a sound inferred from an older attack); `hit`
becomes armour/bone/flesh + pain voices; a melee `miss` becomes a parry, shield block or dodge; `spell` becomes the cast
spell's family. When the combat scene resolves attacks without animation (snap / QUICK) and requests no sound, the
director plays each `combat:event` attack as a whole exchange itself, staggered 0.2–0.3 s apart: the wind-up at the
attacker (swing / bow, sometimes a battle cry — always the first time a monster family attacks), then the impact at the
target (armour / bone / flesh, arrow thud, parry / shield / dodge) and, on 45 % of hits (always on crits and heavy
blows, never two within 0.7 s), the victim's pain; when the lane backs up past ~0.9 s the extras give way to impacts.
Spells are cast from the caster's position (the incantation at the caster, the spell's own sound halfway to
centre). Every positioned combat sound carries an explicit `pan` (the combatant's offset from the fight's centre on the camera's
right vector, ~3 tiles = well to one side, clamped ±0.8; 0 when there is no camera). `tests/audio/contract.test.js`
replays a real QUICK fight's feed and asserts wind-ups, battle cries, pain and pans. Simultaneous death cries are
staggered too (~0.3 s apart, at most ~1 s queued). World log lines (omens, secret doors, journal entries) sound once even when several scenes log them.
Buttons get hover/click ticks globally (the generic click yields to a scene's own pitched click for the same press);
keyboard/gamepad navigation ticks (`focus`) when DOM focus or a menu highlight (`aria-selected`) moves. The AudioContext starts on the first gesture; in debug/screenshot mode
(`?scene=`) audio is muted unless `&audio=1` is added (then the context starts at once and `window.__AUDIO.debugState()`
reports the music state / ambience — `node tools/audiorender.mjs --wiring` checks title/explore/town/combat/camp this way).
Settings read: `masterVolume musicVolume sfxVolume ambienceVolume uiVolume` (+ optional `muteAll muteInBackground`).

**Transitions**: `TrackPlayer.fadeOut(seconds, at)` holds the outgoing cue at full level until `at` (the next bar line
for calm changes, the downbeat for `endWithCoda`) and only then ramps — the out-gain curve is tracked analytically and
re-anchored explicitly (never `cancelAndHoldAtTime`, which drops to a stale event). `tests/audio/fade.test.js` models
AudioParam automation per spec and fails on any drop > 1 dB within 50 ms of a `music()` call.

**Scheduler**: a Worker clock ticks every 50 ms (not throttled in background tabs) and hands notes to the audio thread
`LOOKAHEAD` = 1.8 s ahead, so main-thread stalls up to that long are inaudible; a note that still arrives > 40 ms late is
dropped (long held notes join mid-way), never bunched (`tests/audio/scheduler.test.js` blocks the clock for 1 s mid-cue).
Each song may declare `key` (pitch class), `room`/`wet` (its own reverb: `street` town band, `tavern` taproom, `cathedral`
crypt, `vault` dungeon, `hall` title/combat — crossfaded per cue, IRs cached; generated IRs decay in three bands, lows
~1.25× and highs ~0.6× the room's T60), `eq` (per-cue EQ), `lift` (dB the whole
cue swells by at full intensity, measured from `calIntensity`) and `rest {after:[s,s], length:[s,s]}` (exploration cues drop to ambience only for a
while every few minutes).

**Orchestra** (`instruments/sustained.js`): a string line is up to three players (own intonation, drift, ±15–25 cent
vibrato, delayed onset, onset, one of three instrument spectra; stand partners share a vibrato) and a divisi chord two
per tone, made into a full section by a per-instrument **section chorus** (two modulated mono delay taps seated either
side of the section — `chorus`, `chorusPan`, `chorusWidth` in `instruments/base.js`; brass taps sit around the
section's own seat, not the centre); a legato line's spectrum follows a bow-pressure envelope (two-pole brightness
filter, bridge hill, rosin noise); narrow body modes turn vibrato into amplitude/timbre shimmer. **Chords are one
gesture**: `TrackPlayer` hands a chord to `instrument.chord()` (strings, choir, brass) — one envelope, pressure filter
chain and rosin / breath for the chord, players per tone. **Short notes are cached buffers**: spiccato strokes (four
players across the seats) and short brass stabs are rendered once per pitch × velocity layer × three takes × length by
`dsp/notesynth.js` (the same harmonic spectra — `dsp/spectra.js` feeds both the PeriodicWaves and the note renderer —
swept two-pole lowpass, envelope, rosin / breath burst, tanh blare) and played as one buffer source + gain; ostinati no
longer build a dozen nodes per stroke. Brass sustain with two players per tone and a breath-pressure envelope that opens
the filter and crossfades a clean path into a saturated one (dynamic spectral tilt) plus `art: 'rip' | 'fall' |
'flutter'`. **Legato** is a fast change, not portamento: pitch moves in 15–35 ms (brass/woodwinds re-articulate with a
small dip); only string / choir leaps of a fourth or more slide (70–110 ms), at 25 % / 15 % probability or always with
`opts.gliss`. The choir is two half-sections with jittered formant banks (one vocal tract per half, shared by every note
of the instrument; all notes of a chord sing the same syllable, aspiration runs through the formants), one singer per
tone per half (their own detune and vibrato depth) widened by the section chorus, vowels that change syllable by
syllable (and drift in long notes) and consonant onsets. Woodwinds: flute,
recorder, oboe (double-reed spectrum + fixed 1.1 k / 3 k formants), clarinet (odd-harmonic bore, woody body), bassoon,
shawm. Pitch modulation (vibrato, drift, glides) and swept filters run at k-rate (`kosc`, `kbq` in
`instruments/base.js`): per-block updates, inaudible at these rates, a large share of the audio thread saved.

**Load guard** (`loadguard.js`): live only, `_tick` compares the AudioContext clock with the wall clock every 2 s; if
audio rendered measurably slower than real time the section-player cap (`setVoiceCap`, default 110, floor 36) drops by
30 % — strings, choir and brass thin out but every line keeps sounding. A single lagging window is only a
suspicion (a page load or GC pause the audio clock catches up from, counted as a `glitch`); the guard acts on the
second lagging window in a row, or at once when one window loses more than 0.3 s. At the floor, further lag degrades the score
structurally (`TrackPlayer.setDegrade`): 1 drops the desperate layer, 2 the mid layer, 3 replaces the live orchestra
from the next section on with a stem of that section bounced in the background (OfflineAudioContext at 22.05 kHz) —
one buffer source. Healthy stretches (20 s) step back structure first, then the cap (+12). `debugState()` reports
`voiceCap`, `overloads`, `underruns` (playbackStats when the browser has them, else lagging windows), `lag` (s lost),
`glitches`, `degrade`, `stems` and `dropped` (notes the scheduler dropped after a main-thread stall). Stingers and the
battle coda are ticked with the lookahead like the score (`TrackPlayer.plannedEnd()` gives the duck its length) —
a fanfare scheduled whole put all of its notes' nodes in the render graph at once, on top of the fading battle
cue, which was what stalled the audio thread at the end of every won fight. The music reverbs that are faded out are disconnected once their crossfade ends (`graph.reap`).
Budget: the full desperate battle (intensity 1.0, all layers) renders offline at about 0.35–0.4× real time on the
SwiftShader VM and plays live with the cap at 110 (`audiorender --perf`). Big one-shots (`WIDE` in `sfx/library.js`:
blasts, thunder, the dragon) get a stereo early-reflection spread (Fx `wide`). Every ambience bed is high-passed at
38 Hz, 24 dB/oct (no infrasound); camp / interior beds are mostly air and flicker (200 Hz–4 kHz), not low hum; indoor
beds (`corr` in BEDS: interior, camp_in, dungeon, combat_in) share part of the noise between the ears (L/R r ≈ 0.25–0.3)
so they keep a centre. The location bed ducks to half (`duckAmbience`, graph `ambDuck`) under the parley `encounter`
cue instead of stopping; the dialogue scene keeps the location's bed.

**Music** (`music/`): songs are data — `build(pass, rng, state)` returns note events in quarters (`compose.js`: `chart`,
`mel` (slurred + phrase-shaped dynamics), `pad` (voice-led: nearest inversion, common tones held, sus4→3 / V7 colour at
cadences, slash-chord basses), `counter` (inner-voice counterlines), `bassline` (walking bass: root, then a passing note
leading by step into the next root), `diatonic` (harmonise a line in thirds / sixths), `arp` (optionally slurred: one bow
across a rocking figure), `riff`, `drums`), plus optional `rit`
(ritardandi) and `coda()`. `TrackPlayer` schedules with lookahead, joins slurred notes into legato phrases
(`Instrument.phrase`: one envelope, 15–35 ms legato changes with selective slides, tongued re-articulation, brass scoop on phrase starts only), keeps
skipped long notes of silent layers so they join mid-note when intensity rises. Town/tavern alternate a 64-bar AABB jig set (two tunes, ornamented repeats) with a 32-bar slow air. Ruins, dungeon,
crypt and wilds each have four genuinely different passes (seeded bag, never the same twice running). Combat has five 16-bar sections (theme,
re-orchestrated theme, relative-major theme, percussion breakdown, G-minor development with the title motif in
augmentation) chosen per pass, never repeating; encounter rotates three variants. The title's D–A–A + octave-leap motif
recurs in combat, victory (major), camp and defeat. Orchestration is written, not padded: the title's A section has a
walking bass, violas rocking in slurred broken-chord eighths, the second horn answering in thirds; its A section tips
into G minor through D7/F#, and the climax's hook is a Neapolitan (Eb/G) before A7 with the line breaking through to G5,
flute and oboe doubling the trumpets. In combat the low brass walk the bass, violas chug off-beat eighths, the second
horn harmonises the theme's second phrase in thirds, the countermelody sits in the violas (above the horns, no unisons)
and B's strings are rocking figures instead of block chords. Battle mix: taiko and basses kept out of each other's
60–80 Hz (taiko dipped at 72 Hz with more skin and stick, basses high-passed at 57 Hz), a low shelf under 115 Hz and
horn/viola body (650 Hz) and presence (3 kHz) lifted: 2–4 kHz carries about −10 dB of the cue's energy, not −16. The parley cue gets the same treatment (taiko dipped
at 72 Hz, D2 pedal high-passed, low shelf): its 60–80 Hz band went from −4 to −10 dB of the cue's energy. Harbour surf
is the wash of the water (high-passed at ~130 Hz), so the title and town beds carry no sub weight.

**Loudness** (`loudness.js`, `loudness.data.js`): every cue is measured offline (BS.1770 K-weighted LUFS) and calibrated
to a target — exploration −18, town −17, combat −16.5 (at its typical intensity 0.45), defeat −19.5 (a dirge lands
well under the fight it follows), stingers −16, ambience beds −27
integrated; SFX by momentary max per family (UI −27…−30, every footstep surface −26 ±1.5, blows −17.5, fireball −14.5).
Multi-pass cues store a trim per section (`sections`: every variant normalised to the mean, applied at the pass seam).
Adaptive cues (`calIntensity` + `lift`) store their raw loudness curve across intensity (`curve`): the player compensates
so a 0.3 skirmish is as loud as a 0.45 fight and 1.0 adds `lift` dB (combat 5.5 nominal; the master glue compressor
takes back about a third, so a desperate fight lands ~3.5 LU above an ordinary one); `check` records the verified
result at 0.3/0.5/0.8/1. The master output has a ceiling trim after the limiter (sample peak ≤ about −2.5 dBFS). `tests/audio/loudness.test.js` fails
when a cue is off target or its calibration is stale. After changing a theme or any synthesis code, re-run
`node tools/audiorender.mjs --calibrate [--match music_]`.

Review renders: `node tools/audiorender.mjs [--match music_|--only sfx_door,...] [--passes N] [--spectro] [--bands] [--port N]`
→ `audio_out/<cue>.wav` (+ spectrogram PNGs); prints peak, RMS, integrated and momentary LUFS and stereo width (side/mid dB).
`--passes N` renders N passes of each loop so later passes and loop seams can be reviewed. `--help` lists the flags
(unknown flags are an error); stats include L/R correlation and the momentary-loudness spread (p10–p90). SFX windows are trimmed to each
cue's real tail. Cues: `music_*`, `sting_*`, `amb_*`, `sfx_*`, `sfx_step_<surface>`, `inst_<preset>` (incl. a legato run),
`demo_combat_adaptive`, `demo_victory` (quantised win → coda → fanfare, through the live `endCombatWith` path), `demo_crossfade` (town → ruins through the
live `AudioEngine.music()` path, ticked from OfflineAudioContext.suspend points), `demo_stall` (1.2 s frozen main thread
mid-battle), `demo_rest` (a rest window). Music renders are ticked like the live scheduler (every 0.25 s of render time,
`LOOKAHEAD` ahead), never scheduled up front — a cue scheduled whole puts every future note's nodes in the render graph
from the first sample. Fails on NaN, silence or a single clipped sample; each line prints its CPU cost (`xN RT`), and a
selection that includes `music_combat` also renders the full desperate battle (intensity 1.0) and fails above 0.5× real
time (`--intensity X` renders adaptive cues at X). `--perf` plays title, town, a full-intensity battle (with blows and
voices) and a battle won mid-way (coda + fanfare over the fading orchestra) in a realtime AudioContext and fails if the audio clock lags once settled, if the guard had to cut the cap below
70 or degrade the score; it then forces the guard's last level and checks that the next section plays from a stem.

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
