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
  DEX 6, thief DEX 9), not the full PHB rows (fighter WIS 6, cleric STR/INT/CON/CHA 6...). Fighter THAC0 follows the 1e
  DMG matrix (2 points per 2 levels: 20 at 1-2, 18 at 3-4...), not the Gold Box's later 21−level shortcut.
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
`ITEM_RULES` / `itemRulesOf(id)` layer DMG facts over the data (Wand of Paralyzation → its own cone, any creature, save vs
wand; Gauntlets of Ogre Power C/F/T; Giant Strength and Heroism fighter-only; Necklace of Missiles beads 5/3/3 HD).
Heroism (`heroismLevels`: +4/+3/+2/+1 levels at 0/1-3/4-6/7-9) grants fighter levels for THAC0, saves and attack rate plus
that many d10 temporary hp. **Protection stacking (DMG)**: a ring of protection's AC does not add to magic armour (its save
bonus does) and rings don't stack; a cloak of protection gives nothing over magic armour or non-leather armour; bracers
are armour + shield (a shield adds only its enchantment) — plate +1, shield +1, ring +3, cloak +2 is AC 0.

**Experience & training**: `awardXp(ch, xp)` (splits multiclass, +10% prime requisite, banks at most one point short
of the level after next — Gold Box training rule), `trainableClasses(ch)`, `trainingCost(ch)` (PoR: 1,000 gp),
`trainLevels(ch, rng)` (one level per visit, capped by race and PoR caps), `maxLevel(ch, cls)`,
`dualClassProblem(ch, cls)` / `dualClass(ch, cls)` / `dualClassChoices(ch)` → `[{cls, ok, reason}]` (humans; PoR lets them
change class at the Training Hall — **shop owner**: list `dualClassChoices` there, charge the training fee, call `dualClass`). **Consumer obligation**: when `trainLevels` raised
`'magicUser'`, offer `trainingSpellChoices(ch)` (camp.js; PoR: one new spell per level trained) and `learnSpell` the
pick — ShopScene does. `drainLevel(ch, n)` (energy drain: highest class loses a level, its hit die, XP to the new
level's midpoint; drained below 1st = dead) + `trimMemorized(ch)` (camp.js). Multiclass CON bonus: the fighter's
+3/+4 applies to every class's die before dividing while fighter is one of the classes (Gold Box ruling); a dual-classed
human's dice each use their own class's bonus (an MU turned fighter gains nothing retroactively). `tempHpOf(ch)` —
temporary hit points (heroism) are part of `hp.max` while they last and leave with the effect.

**Health**: `applyDamage` (0 unconscious, −1…−9 dying, ≤ −10 dead; wakes sleepers), `bleed(ch)` (1 hp/round),
`bandage(ch)`, `heal` (DMG ruling: any healing stops a dying character's bleeding, even if still below 0), `raiseDead(rng, ch)` (resurrection survival, −1 CON; refuses elves per the PHB), `stoneToFlesh`,
`isConscious`, `isAlive`.

**Conditions**: `addEffect(target, id, {rounds, source, level, mods, data})`, `removeEffect`, `hasEffect`, `getEffect`,
`effectMods(target)`, `tickEffects(target, rounds)`, `tickPoison(target, minutes)` (the one poison model: onset in
rounds = minutes counts down in combat, exploration and rest alike, except the minutes Slow Poison covers),
`isIncapacitated`, `isHelpless`, `conditionsAllowCasting`, `clearCombatEffects`. Conditions include `afraid` (fear aura:
flees, −2 to hit if cornered) and the `fighterLevels` mod (heroism). Effects live in `target.effects`; `target.conditions` mirrors their ids as strings.
Party combatants share `hp`, `conditions` and `effects` with their Character.

**Time** (camp.js): `passTime(party, minutes)` — exploration/travel/dialogue time: timed effects run down (Strength 1 h/level,
Bless, Detect Magic, Find Traps, Prot. from Evil... expire while walking), poison onset counts down, the dying are bound;
no healing or memorization (that is `rest`). `syncPartyTime(party, game.minutes)` — idempotent: brings every member up to
the game clock via a per-character `timeMark`; `rest`/`passTime` advance the marks so a camp that rests and then calls
`game.advanceTime` never ticks twice. **Consumer obligation**: after every `GameState.advanceTime` (ExploreScene steps and
searches, dialogue, shops, travel) call `syncPartyTime(game.party, game.minutes)` — e.g. once from a `time:changed` bus
listener in main.js.

**Spells** (`SPELL_RULES`, 54 PoR spells incl. temple-only cures/raise dead, plus item-only `wandParalyzation`)
* `spellsForClass(cls, level)`, `getSpell(id)` (rules + data display merged: `name, desc, tip, schools, usable, ...`),
  `spellLevel(id, cls)`, `spellTargeting(id, casterLevel, cls)` → `{target, range, shape, size, maxTargets, hostile, duration}`.
* `castingClass(caster, id, cls?)` — multiclass casters keep separate memories: the class comes from the memorized slot
  (`cls`, else the first class in `spells.memorized` order holding the spell, else the first active class). A half-elf C/MU
  with Hold Person memorized only as MU casts the MU version (range 12, 4 persons, −3 alone, 2 rounds/level, 3 segments).
  `consumeMemorized(ch, id, cls?)` / `isMemorized(ch, id, cls?)` act on that class. `castTime` is per class where the PHB
  differs (MU Hold Person / Dispel Magic 3 segments, cleric 5 / 6). MU Hold Person lasts 2 rounds/level (PHB p. 79; OSRIC
  agrees).
* `castProblem(caster, id, {context, ignoreMemory, cls})` → reason or null (memorized, silence/held, armour for arcane — elfin
  chain only for elves/half-elves — camp/combat usability).
* `castSpell(rng, id, caster, targets, {consume, ignoreMemory, check, context, level, cls, fromItem, saveKey, noFailure})` → `{ok, reason,
  failed, level, results:[{target, affected, saved, save, resisted, immune, missed, damage, healed, applied, removed, down,
  charmed}], flags, log}`. `saveKey` overrides the save category (wands/staves/rods pass `'rsw'`, DMG). Memory is always checked unless `ignoreMemory: true` (or `check: false`) is passed explicitly.
  Clerics roll the PHB low-WIS spell failure (WIS 9: 20%…12: 5%; the slot is spent; items never fail; `noFailure` for
  scripted casts). The caller picks targets from the template (primary/nearest first); the engine filters by `affects`,
  applies `maxTargets`, saves (WIS vs mind magic, DEX vs fireball/lightning, hold person: cleric −2 alone / MU −3 alone,
  −1 for two; range cleric 6 / MU 12), Sleep as one 4d4 budget spent weakest-first (`SLEEP_BANDS`, `SLEEP_COST`
1/2/4/8 per band, the 3+1–4+4 band capped at its own 0–1 roll), magic resistance (`magicResistanceOf(t, casterLevel)`:
`magicResistance` field or `magicResist:N` tag, DMG ±5%/level from 11th), haste/slow cancelling each other, `dispelChance` (DMG +5%/level above,
  −2%/level below), elf/half-elf sleep-charm resistance, undead immunity, shield vs magic missile, and returns terse Gold
  Box log lines. Utility spells report `flags` (`detectMagic`, `findTraps`, `unlock`, `readMagic`, `raiseDead`,
  `poisonCured`...). `hammerStrike(rng, cleric, target, magic)` is one Spiritual Hammer blow.
* Verified values: Spiritual Hammer +1 per 6 levels or fraction (`ceil(L/6)`); Ray of Enfeeblement range 1 + L/4;
  Mirror Image 1d4 images, 3 rounds/level (1e PHB); Strength above 18 adds tenths (10% exceptional per point, PHB).
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
`xpForVictory`, `autoResolve`. Rear/backstab: pass `{rear, backstab}` flags (never fold them into `mods`);
`situationalHit` gives rear +2, backstab +4 *instead*, and `hitChance` takes the same flags so the preview equals the roll.
Persons (Charm/Hold Person): `monsterIsPerson(m)` — an explicit `person: true|false` wins; class-based NPCs are persons;
otherwise `familyOf(m)` must be in `PERSON_FAMILIES` (human, the demi-humans, kobold, goblin, hobgoblin, orc, gnoll, lizard
man, troglodyte and the PHB's sprites; human bands like `bandit*`, `buccaneer*`, `*Priest` are family `human`). No id list.
Class-based NPCs: `classAsOf(m)` (`classAs`/`saveAs` 'cleric5' or `{cls, level}`, else a `spells:clericN` tag → cleric of
level max(N, HD)); `monsterBaseSaves(m)` / `monsterBaseThac0(m)` use that class table (Priest of Bane = cleric 5: ppdm 9,
bw 15), else fighter-by-HD saves / the DMG monster matrix. Backstab multiplies the whole blow (weapon die + STR + magic) —
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
`attacksThisTurn(c, round, target, {ranged, weapon})`, `castInBattle(rng, id, caster, targets, {level, fromItem})` →
CastResult + scene `hits` `{id, dmg, heal, saved, killed, effect, bolts, text}`, `roundUpkeep(c)` → bleed/down/wake
events, `hammerTurn` (Spiritual Hammer's later blows), `specialsOnHit`. The engine resolves every spell, attack count,
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
  start). **Combat owner**: the engine/AI must offer these (they replace the old ad-hoc morale 'fear' for Tyranthraxus) and
  may swap its own regeneration for `regenerationOf`.
* `battleItemUse(ch, i)` → `{kind, spellId, level, saveKey}` (potion / spell at `itemCasterLevel`, scrolls gated by
  `canUseScroll`, wands save vs `rsw` — remembered for the following `castInBattle`, but pass `saveKey` through when you can;
  the Necklace of Missiles throws fireball beads — `usableInBattle(ch, i)` says which entries qualify) and
  `quaffInBattle(rng, c, i)` (rules `useItem`: giant strength sets STR, speed hastes and ages, heroism, invisibility,
  neutralize…).
* `endBattle(partyCombatants)` — **consumer obligation** at the end of every battle (CombatScene.finish): strips held,
  asleep, charmed, hasted, nauseous, stench… from the Characters (poison, disease, curses, strength drain persist).

**Items, treasure, temple**: `useItem(rng, ch, index, targets, {spellId})`, `scribeScroll`, `identifyItem`, `detectMagicIn`;
`generateTreasure(rng, types, {scale, count})` → `{coins, gems, jewelry, items, maps?}` (MM types A–Z incl. W),
`victorySpoils(rng, encounter.treasure, slainMonsterDefs)` → `{gold, items, gems, jewelry, text}` (what CombatScene awards:
encounter gold/items/`types` + each slain monster's `treasure` type, individual J–N per creature),
`rollMagicItem`, `treasureValue`, `shareCoins`; `TEMPLE_SERVICES`, `serviceApplies(id, ch)`, `serviceProblem(id, ch)`
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
`time:changed`, `settings:changed {key, value}`, `save:written {slot}`, `audio:music {trackId}`, `app:ready`.
Structured events the audio director listens for — the **primary** integration path (it falls back to parsing
`message` text and `party:changed` when they are absent, so emitting them is optional but makes contextual audio survive
any rewording of the log):
* `combat:event {ev, engine}` — **emitted by CombatScene for every engine event as it is played** (`_playEvents`):
  `ev` is the engine's own record (`attack {id, target, hit, crit, ranged, killed, immune, backstab, image}`,
  `down {id, status}`, `cast {id, spell}`, `turnUndead`, `flee`, `heal`, `round` …) and `engine` the CombatEngine for
  `byId()` lookups (side, monsterId, the character's race/gender). Once it is live the director ignores the log text
  for attacks/casts/falls. `tests/audio/contract.test.js` runs the real engine and rules templates against the director.
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
mode: attack|hurt}` — the party's own voices). Spell chords are transposed to the key of the score that is playing
(`song.key`). Blades have six round-robin takes per material; footsteps are heel/roll/toe contact noise per surface.
Generic requests are made specific by the director (structured events first, the combat log as fallback): `step` uses the
map's surface and a party of feet; in combat `miss` with pitch > 1.2 is the attack wind-up — a bow twang or sword swing plus
the attacker's voice when a `combat:attack` event announced it, otherwise a neutral `ready` rustle followed by the specific
swing / incoming arrow the moment the attack's own log line lands (never a sound inferred from an older attack); `hit`
becomes armour/bone/flesh + pain voices; a melee `miss` becomes a parry, shield block or dodge; `spell` becomes the cast
spell's family. World log lines (omens, secret doors, journal entries) sound once even when several scenes log them.
Buttons get hover/click ticks globally (the generic click yields to a scene's own pitched click for the same press);
keyboard/gamepad navigation ticks (`focus`) when DOM focus or a menu highlight (`aria-selected`) moves. The AudioContext starts on the first gesture; in debug/screenshot mode
(`?scene=`) audio is muted unless `&audio=1` is added (then the context starts at once and `window.__AUDIO.debugState()`
reports the music state / ambience — `node tools/audiorender.mjs --wiring` checks title/explore/town/combat/camp this way).
Settings read: `masterVolume musicVolume sfxVolume ambienceVolume uiVolume` (+ optional `muteAll muteInBackground`).

**Scheduler**: a Worker clock ticks every 50 ms (not throttled in background tabs) and hands notes to the audio thread
`LOOKAHEAD` = 1.8 s ahead, so main-thread stalls up to that long are inaudible; a note that still arrives > 40 ms late is
dropped (long held notes join mid-way), never bunched (`tests/audio/scheduler.test.js` blocks the clock for 1 s mid-cue).
Each song may declare `key` (pitch class), `room`/`wet` (its own reverb: `street` town band, `tavern` taproom, `cathedral`
crypt, `vault` dungeon, `hall` title/combat — crossfaded per cue, IRs cached), `eq` (per-cue EQ), `lift` (dB the whole
cue swells by at full intensity) and `rest {after:[s,s], length:[s,s]}` (exploration cues drop to ambience only for a
while every few minutes).

**Orchestra** (`instruments/sustained.js`): strings are 4–8 players per section (own intonation, drift, vibrato, onset,
seat; divisi chords split the section) whose spectrum follows a bow-pressure envelope (two-pole brightness filter, bridge
hill, rosin noise); brass are 3–4 players with a breath-pressure envelope that opens the filter and crossfades a clean
path into a saturated one (dynamic spectral tilt) plus `art: 'rip' | 'fall' | 'flutter'`; the choir is two half-sections
with jittered formant banks, vowels that change syllable by syllable (and drift in long notes) and consonant onsets.

**Music** (`music/`): songs are data — `build(pass, rng, state)` returns note events in quarters (`compose.js`: `chart`,
`mel` (slurred + phrase-shaped dynamics), `pad` (voice-led: nearest inversion, common tones held, sus4→3 / V7 colour at
cadences, slash-chord basses), `counter` (inner-voice counterlines), `arp`, `riff`, `drums`), plus optional `rit`
(ritardandi) and `coda()`. `TrackPlayer` schedules with lookahead, joins slurred notes into legato phrases
(`Instrument.phrase`: one envelope, 40–80 ms glides, tongued re-articulation, brass scoop on phrase starts only), keeps
skipped long notes of silent layers so they join mid-note when intensity rises. Town/tavern alternate a 64-bar AABB jig set (two tunes, ornamented repeats) with a 32-bar slow air. Ruins, dungeon,
crypt and wilds each have four genuinely different passes (seeded bag, never the same twice running). Combat has five 16-bar sections (theme,
re-orchestrated theme, relative-major theme, percussion breakdown, G-minor development with the title motif in
augmentation) chosen per pass, never repeating; encounter rotates three variants. The title's D–A–A + octave-leap motif
recurs in combat, victory (major), camp and defeat.

**Loudness** (`loudness.js`, `loudness.data.js`): every cue is measured offline (BS.1770 K-weighted LUFS) and calibrated
to a target — exploration −18, town −17, combat −16.5 (at intensity 0.8), stingers −16, ambience beds −27 integrated;
SFX by momentary max per family (UI/footsteps −26…−30, blows −17.5, fireball −14.5). `tests/audio/loudness.test.js` fails
when a cue is off target or its calibration is stale. After changing a theme or any synthesis code, re-run
`node tools/audiorender.mjs --calibrate [--match music_]`.

Review renders: `node tools/audiorender.mjs [--match music_|--only sfx_door,...] [--passes N] [--spectro] [--bands] [--port N]`
→ `audio_out/<cue>.wav` (+ spectrogram PNGs); prints peak, RMS, integrated and momentary LUFS and stereo width (side/mid dB).
`--passes N` renders N passes of each loop so later passes and loop seams can be reviewed. `--help` lists the flags
(unknown flags are an error); stats include L/R correlation and the momentary-loudness spread (p10–p90). SFX windows are trimmed to each
cue's real tail. Cues: `music_*`, `sting_*`, `amb_*`, `sfx_*`, `sfx_step_<surface>`, `inst_<preset>` (incl. a legato run),
`demo_combat_adaptive`, `demo_victory` (quantised win → coda → fanfare), `demo_crossfade` (town → ruins through the
live `AudioEngine.music()` path, ticked from OfflineAudioContext.suspend points), `demo_stall` (1.2 s frozen main thread
mid-battle), `demo_rest` (a rest window). Fails on NaN, silence or clipping.

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
