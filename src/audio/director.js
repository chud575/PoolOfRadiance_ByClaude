import { envFor, spellFamily } from './environments.js';
import { VOICE_OF } from './sfx/library.js';
import { MONSTERS } from '../data/monsters.js';

/**
 * The audio director listens to the event bus and steers the engine:
 * location → mood/surface/room/ambience, time of day → night beds, combat →
 * contextual SFX (bow vs sword, bone vs armour, parry/shield/dodge, spell
 * families, monster voices, deaths) and adaptive intensity, party changes →
 * level-up / victory stingers. Scenes never need to know about any of this;
 * they keep calling the small public API (playMusic / sfx) and emitting the
 * events they already emit.
 *
 * Integration, in order of preference:
 *  1. Structured events (see ARCHITECTURE.md "Audio"): combat:attack
 *     {attackerId, targetId, monsterId, targetMonsterId, attacker, target,
 *     ranged, hit, crit, dmg} emitted *before* the swing, combat:cast
 *     {spellId, caster}, combat:start {encounter, monsters}, combat:end
 *     {winner}, audio:stinger, audio:sfx.
 *  2. Fallback: the combat log (`message` events). Log lines arrive at the
 *     moment of impact, so a wind-up sound requested before its own log line
 *     is never built from an older line: the director plays a neutral
 *     "ready" rustle, then the specific swing / incoming arrow + voice as soon
 *     as the attack's own line lands (the impact is nudged a few ms later so
 *     the whoosh leads it).
 */
const BOSS = /chief|leader|captain|priest|troll|ogre|giant|tyranthraxus|spectre|wight|dragon/i;
const BEASTS = /rat|wolf|spider|frog|lizard|centipede/i;
const ARMOURED = /chief|leader|captain|hobgoblin|bugbear|orc|banditLeader|knight/i;
/** Sounds placed at the attacker (wind-ups) vs at the target (impacts, parries, the victim's cry). */
const ATTACKER_SIDE = /^(swing|bow|ready)$/;
const TARGET_SIDE = /^(hit|hit_armor|hit_bone|crit|arrow_hit|arrow_in|bite|claw|parry|shield|block|dodge|miss|pass_through|spell_ward)$/;

const MONSTER_BY_NAME = (() => {
  const m = new Map();
  for (const def of Object.values(MONSTERS)) {
    m.set(def.name.toLowerCase(), def.id);
    m.set((def.plural ?? `${def.name}s`).toLowerCase(), def.id);
  }
  return m;
})();

/** Total experience of a party (xp may be a number or {class: xp}). */
function partyXp(party) {
  return (party ?? []).reduce((a, c) => a + (typeof c.xp === 'object' && c.xp ? Object.values(c.xp).reduce((x, y) => x + (Number(y) || 0), 0) : Number(c.xp) || 0), 0);
}

/** {cur, max} whether a character stores hp as a number or an object. */
function hpOf(c) {
  const h = c?.hp;
  if (h && typeof h === 'object') return { cur: Number(h.cur ?? h.current ?? 0), max: Number(h.max ?? h.cur ?? 1) };
  return { cur: Number(h ?? 1), max: Number(c?.maxHp ?? c?.hpMax ?? h ?? 1) };
}

/** "Kobold 3" → 'kobold'; party/unknown names → null. */
function monsterIdOf(name) {
  if (!name) return null;
  const base = name.replace(/\s+\d+$/, '').replace(/^the (helpless )?/i, '').trim().toLowerCase();
  return MONSTER_BY_NAME.get(base) ?? null;
}

const voiceOf = (id) => VOICE_OF[id] ?? 'human';

/**
 * Parse one combat log line into an attack description, or null.
 * Handles: hits/backstabs/bites/shoots X for N, swings/shoots at X and misses,
 * attacks of opportunity ("X strikes as Y breaks away: N damage." / ": miss."),
 * guard strikes ("X, on guard, strikes Y: …"), mirror images, coups de grâce,
 * missiles turned aside and the Spiritual Hammer.
 */
export function parseAttack(text) {
  let m;
  if ((m = /^(.+?) strikes as (.+?) breaks away: (?:(\d+) damage|miss)\.?$/.exec(text))) return { att: m[1], tgt: m[2], hit: !!m[3], dmg: Number(m[3] ?? 0), ranged: false, kind: 'aoo' };
  if ((m = /^(.+?), on guard, strikes (.+?): (?:(\d+) damage|miss)\.?$/.exec(text))) return { att: m[1], tgt: m[2], hit: !!m[3], dmg: Number(m[3] ?? 0), ranged: false, kind: 'guard' };
  if ((m = /^(.+?) (backstabs|hits|bites|shoots) (.+?) for (\d+)(.*)$/.exec(text))) return { att: m[1], tgt: m[3], hit: true, dmg: Number(m[4]), ranged: m[2] === 'shoots', bite: m[2] === 'bites', crit: /critical/.test(m[5]) || m[2] === 'backstabs', kind: m[2] };
  if ((m = /^(.+?) (swings at|shoots at) (.+?) and misses/.exec(text))) return { att: m[1], tgt: m[3], hit: false, ranged: m[2] === 'shoots at', kind: 'miss' };
  if ((m = /^(.+?) strikes an image of (.+?);/.exec(text))) return { att: m[1], tgt: m[2], hit: false, ranged: false, image: true, kind: 'image' };
  if ((m = /^(.+?) slays the helpless (.+?)!$/.exec(text))) return { att: m[1], tgt: m[2], hit: true, crit: true, ranged: false, kind: 'slay' };
  if ((m = /^(.+?)'s missile turns aside from (.+?)\.$/.exec(text))) return { att: m[1], tgt: m[2], hit: false, ranged: true, kind: 'turned' };
  if ((m = /^The hammer (strikes|misses) (.+?)(?: for (\d+))?[.!]/.exec(text))) return { att: null, tgt: m[2], hit: m[1] === 'strikes', dmg: Number(m[3] ?? 0), ranged: false, kind: 'hammer' };
  return null;
}

export class Director {
  constructor(engine, bus) {
    this.e = engine;
    this.bus = bus;
    this.scene = null;
    this.overlays = [];
    this.loc = null;
    this.night = false;
    this.inCombat = false;
    this.combatOver = false;
    this.partyNames = new Set();
    this.levels = null;
    this.xp = 0;
    this.hint = null;
    this.spellHint = null;
    this.pendingWind = null;
    this.deferred = null;
    this.lastVox = -10;
    this.lastHurt = -10;
    this.voiced = new Set();
    this.downs = 0;
    this.foes = 0;
    this.foesDown = 0;
    this.baseDanger = 0.5;
    this.lowerVotes = 0;
    this._recentText = new Map();
    this._recentSfx = new Map();
    if (!bus) return;
    bus.on('scene:enter', (p) => this._sceneEnter(p));
    bus.on('scene:resume', (p) => this._sceneResume(p));
    bus.on('location:changed', (loc) => this._location(loc));
    bus.on('time:changed', ({ minutes }) => this._time(minutes));
    bus.on('party:changed', ({ party }) => this._party(party));
    bus.on('message', (m) => this._message(m));
    bus.on('input:action', ({ action }) => this._action(action));
    bus.on('combat:start', (p) => this._combatStart(p ?? {}));
    bus.on('combat:end', ({ winner } = {}) => this._combatEnd(winner));
    bus.on('combat:attack', (p) => this._structuredAttack(p ?? {}));
    bus.on('combat:cast', (p) => this._structuredCast(p ?? {}));
    bus.on('combat:event', (p) => this._combatEvent(p ?? {}));
    bus.on('save:written', () => this._uiAfter('save'));
    bus.on('audio:stinger', ({ name }) => this.e.stinger(name));
    bus.on('audio:sfx', ({ name, opts }) => this.e.sfx(name, opts));
    this._installUiSounds();
  }

  attach(ctx) {
    this.game = ctx.game;
    this.scenes = ctx.scenes ?? null;
    if (this.game?.location) this._location(this.game.location, true);
    if (this.game) this._time(this.game.minutes);
    if (this.game?.party) this._party(this.game.party);
  }

  get now() {
    return this.e.ctx?.currentTime ?? 0;
  }

  // ------------------------------------------------------------------ places
  _envNow() {
    return envFor(this.loc?.map);
  }

  _location(loc, silent = false) {
    if (!loc?.map) return;
    const changed = loc.map !== this.loc?.map;
    this.loc = { ...loc };
    if (!changed) return;
    const env = this._envNow();
    this.e.setEnvironment(env);
    if (silent) return;
    if (this.scene === 'explore' && !this.overlays.length) {
      this.e.ambience(env.bed, { night: this.night });
      // A new block while exploring: follow its mood.
      if (['town', 'ruins', 'dungeon', 'crypt', 'wilds'].includes(this.e.state)) this.e.music(env.mood);
    }
  }

  _time(minutes) {
    if (minutes === undefined) return;
    const h = Math.floor((minutes % 1440) / 60);
    const night = h < 6 || h >= 20;
    if (night === this.night) return;
    this.night = night;
    if (this.scene === 'explore' && !this.overlays.length) this.e.ambience(this._envNow().bed, { night });
    // Resting passes the hours: the camp bed follows day and night too.
    else if (this.overlays[this.overlays.length - 1] === 'camp' || (this.scene === 'camp' && !this.overlays.length)) this._campBed();
  }

  /** Campfire under the open sky (crickets and owls at night, birds by day) or a subterranean camp (fire, drips, the deep). */
  _campBed() {
    const env = this._envNow();
    const under = env.bed === 'dungeon' || env.room === 'dungeon' || env.room === 'cathedral' || env.bed === 'interior';
    this.e.ambience(under ? 'camp_in' : 'camp', { night: this.night });
  }

  /** Map the scene's requested track to a music state. */
  resolveTrack(id) {
    // Scenes may set the location just before asking for music (after scene:enter fired).
    if (this.game?.location && this.game.location.map !== this.loc?.map) {
      this._location(this.game.location, true);
      if (this.scene === 'explore' && !this.overlays.length) this.e.ambience(this._envNow().bed, { night: this.night });
    }
    const mood = this.loc ? this._envNow().mood : null;
    switch (id) {
      case 'explore':
      case 'phlan_streets':
      case 'city':
        return mood ?? 'town';
      case 'dungeon':
        return mood && mood !== 'town' ? mood : 'dungeon';
      case 'town':
        // Friendly talk in the ruins shouldn't summon the market jig.
        return mood && mood !== 'town' && this.scene === 'dialogue' ? mood : 'town';
      default:
        return id;
    }
  }

  _sceneEnter({ name, overlay }) {
    if (overlay) {
      this.overlays.push(name);
      if (name === 'automap') this.e.sfx('map', { bus: 'ui' });
      else if (name === 'camp') this._campBed();
      else this._uiAfter('open');
      return;
    }
    this.overlays = [];
    const prev = this.scene;
    this.scene = name;
    if (prev === 'combat' && name !== 'combat') this.inCombat = false;
    if (this.game?.location) this._location(this.game.location, true);
    const env = this._envNow();
    switch (name) {
      case 'title':
        this.e.setEnvironment({ room: 'open' });
        this.e.ambience('title');
        break;
      case 'explore':
        this.e.setEnvironment(env);
        this.e.ambience(env.bed, { night: this.night });
        break;
      case 'combat':
        this._combatStart({});
        this.e.ambience(env.room === 'dungeon' || env.room === 'room' || env.room === 'cathedral' ? 'combat_in' : 'combat_out');
        break;
      case 'camp':
        this._campBed();
        break;
      case 'dialogue':
        // Talk happens where you stand: the location's bed carries on (ducked under a standoff cue).
        this.e.setEnvironment(env);
        this.e.ambience(env.bed, { night: this.night });
        break;
      case 'shop':
      case 'create':
        this.e.setEnvironment({ room: 'room' });
        this.e.ambience('interior');
        break;
      default:
    }
  }

  _sceneResume() {
    const top = this.overlays.pop();
    if (top === 'automap') this.e.sfx('close', { bus: 'ui' });
    else if (top && top !== 'camp') this._uiAfter('close');
    if (top === 'camp' && this.scene === 'explore') this.e.ambience(this._envNow().bed, { night: this.night });
  }

  _action(action) {
    const menu = this.overlays.length || !['explore', 'combat'].includes(this.scene);
    if (menu) {
      // Menus: Enter / A confirms, Esc / B backs out, shoulder buttons page through the roster.
      if (action === 'confirm') this._uiAfter('confirm');
      else if (action === 'cancel') this._uiAfter('cancel');
      else if (action === 'prevMember' || action === 'nextMember') this._uiAfter('page');
      return;
    }
    if (this.scene !== 'explore') return;
    if (action === 'turnLeft' || action === 'turnRight' || action === 'turnAround') this.e.sfx('turn', { vol: 0.8 });
  }

  /**
   * A global UI sound that yields to the scene's own: played on the next task
   * unless the scene already sounded a UI cue for this input (its pitched
   * click wins over the generic one).
   */
  _uiAfter(name, opts = {}) {
    const fire = () => {
      const l = this.e.lastUiSfx;
      if (l && l.scene && this.now - l.at < 0.06) return;
      this.e.sfx(name, { bus: 'ui', ...opts, global: true });
    };
    if (typeof setTimeout === 'undefined') fire();
    else setTimeout(fire, 0);
  }

  // ------------------------------------------------------------------ party
  _party(party) {
    if (!Array.isArray(party)) return;
    this.party = party;
    const names = party.map((c) => c.name);
    const sameParty = names.length === this.partyNames.size && names.every((n) => this.partyNames.has(n));
    this.partyNames = new Set(names);
    const lv = new Map(party.map((c) => [c.name, Object.values(c.levels ?? {}).reduce((a, b) => a + (b || 0), 0)]));
    const xp = partyXp(party);
    if (sameParty && this.levels) {
      let up = false;
      for (const [n, l] of lv) if (l > (this.levels.get(n) ?? l)) up = true;
      if (up) this.e.stinger('levelup', { duck: 0.5 });
      if (this.inCombat && !this.combatOver && xp > this.xp) this._combatEnd('party');
    }
    this.levels = lv;
    this.xp = xp;
  }

  _partyAllDown() {
    const fighters = this._engineParty();
    if (fighters) return fighters.length > 0 && fighters.every((c) => this.engine.out?.(c) ?? hpOf(c).cur <= 0);
    const p = this.party;
    return p?.length > 0 && p.every((c) => hpOf(c).cur <= 0 || (c.status && c.status !== 'ok'));
  }

  _partyLevels() {
    const p = this.party ?? [];
    const sum = p.reduce((a, c) => a + Math.max(1, Object.values(c.levels ?? {}).reduce((x, y) => Math.max(x, y || 0), 0)), 0);
    return Math.max(1, sum);
  }

  /** The party's combatants in the running battle (structured feed), or null. */
  _engineParty() {
    const all = this.inCombat && this.engine?.all;
    return Array.isArray(all) ? all.filter((c) => c.side === 'party') : null;
  }

  _partyHpFrac() {
    const p = this._engineParty() ?? this.party ?? [];
    if (!p.length) return 1;
    const hp = p.reduce((a, c) => a + Math.max(0, hpOf(c).cur), 0);
    const max = p.reduce((a, c) => a + Math.max(1, hpOf(c).max), 0);
    return max > 0 ? hp / max : 1;
  }

  // ------------------------------------------------------------------ combat
  _combatStart(p) {
    if (this.inCombat && !p.encounter && !p.monsters) return;
    this.inCombat = true;
    this.combatOver = false;
    this.downs = 0;
    this.foesDown = 0;
    this.foes = 0;
    this.voiced = new Set();
    this.lowerVotes = 0;
    this.pendingWind = null;
    this.hint = null;
    this.baseDanger = 0.5;
    this.structured = false;
    this.strengthSet = false;
    this.engine = null;
    if (Array.isArray(p.monsters) && p.monsters.length) this._strength(p.monsters.map((m) => ({ id: m.monsterId ?? m.id ?? m, n: m.n ?? 1 })));
    this.e.intensity = this.baseDanger;
    this.e.player?.setIntensity(this.baseDanger, 0.5);
    this.xp = partyXp(this.party);
  }

  /**
   * Starting intensity from encounter strength: total monster hit dice
   * against the party's levels (a lone kobold pack is a skirmish; an ogre or
   * a horde against a green party is a desperate fight from the first beat).
   */
  _strength(groups) {
    let hd = 0;
    let n = 0;
    let boss = false;
    for (const g of groups) {
      const def = MONSTERS[g.id];
      hd += (def?.hd ?? 1) * g.n;
      n += g.n;
      if (BOSS.test(g.id ?? '')) boss = true;
    }
    this.foes = n;
    this.strengthSet = true;
    const r = hd / this._partyLevels();
    let x = 0.36 + 0.32 * r;
    if (boss) x = Math.max(x, 0.78);
    this.baseDanger = Math.max(0.4, Math.min(0.9, x));
    return this.baseDanger;
  }

  _combatEnd(winner) {
    if (this.combatOver) return;
    this.combatOver = true;
    if (winner === 'party') {
      // The battle cue ends on the next downbeat with a final hit; the fanfare starts there.
      // Blows and cries still queued from a QUICK round are heard first.
      const after = Math.min(2, this.backlog());
      if (this.e.endCombatWith) this.e.endCombatWith('victory', { after });
      else this.e.stinger('victory', { stopMusic: true });
    } else if (winner === 'monster') this.e.music('defeat', { fade: 0.3 });
  }

  /**
   * Re-evaluate the adaptive intensity: rises at once when the party is in
   * trouble, falls (slowly, with hysteresis) once most enemies are down or
   * the party has recovered.
   */
  _reassess() {
    if (!this.inCombat || this.combatOver) return;
    const hp = this._partyHpFrac();
    const downFrac = this.foes ? this.foesDown / this.foes : 0;
    let target = this.baseDanger + this.downs * 0.15;
    if (hp < 0.35) target += 0.35;
    else if (hp < 0.55) target += 0.15;
    else if (hp > 0.8) target -= 0.05;
    if (downFrac >= 0.75) target -= 0.3;
    else if (downFrac >= 0.5) target -= 0.15;
    // While foes remain the battle never drops below a real fight (0.4).
    target = Math.max(0.4, Math.min(1, target));
    const cur = this.e.intensity ?? 0.5;
    if (target > cur + 0.08) {
      this.lowerVotes = 0;
      this.e.setIntensity(target, 1.5);
    } else if (target < cur - 0.12) {
      // Hysteresis: two consecutive readings before winding down, and slowly.
      if (++this.lowerVotes >= 2) {
        this.lowerVotes = 0;
        this.e.setIntensity(target, 6);
      }
    } else this.lowerVotes = 0;
  }

  /**
   * The combat scene's structured feed: every engine event as it is played
   * ({type, id, target, hit, crit, ranged, killed, immune, …} plus the engine
   * for lookups). Primary path — when it is present the log text is ignored.
   */
  _combatEvent({ ev, engine }) {
    if (!ev?.type) return;
    if (!this.inCombat) this._combatStart({});
    if (this.combatOver) return;
    this.structured = true;
    this.engine = engine ?? this.engine;
    // The previous attack never asked for a sound (QUICK on slow hardware
    // resolves blows instantly, silently): voice it now, staggered.
    if (this.blowPending) this._snapBlow();
    const by = (id) => (id !== undefined && engine?.byId ? engine.byId(id) : null);
    const now = this.now;
    if (!this.strengthSet && Array.isArray(engine?.all)) {
      const groups = new Map();
      for (const c of engine.all) if (c.side === 'monster' && c.monsterId) groups.set(c.monsterId, (groups.get(c.monsterId) ?? 0) + 1);
      if (groups.size) this.e.setIntensity(this._strength([...groups].map(([id, n]) => ({ id, n }))), 0.5);
    }
    switch (ev.type) {
      case 'attack': {
        const a = by(ev.id);
        const d = by(ev.target);
        this.hint = this._hintFrom({ attId: a?.monsterId ?? null, tgtId: d?.monsterId ?? null, tgtKey: ev.target, tgtParty: d?.side === 'party', attParty: a?.side === 'party', attRef: a?.ref, tgtRef: d?.ref, ranged: !!ev.ranged, hit: !!ev.hit, crit: !!(ev.crit || ev.backstab), dmg: ev.dmg ?? 0, killed: !!(ev.killed && ev.hit), immune: !!ev.immune, bite: a?.monsterId === 'giantRat', attPan: this._panOf(a), tgtPan: this._panOf(d) }, 'event');
        this.blowPending = this.hint;
        this._reassess();
        break;
      }
      case 'down': {
        const c = by(ev.id);
        const pan = this._panOf(c);
        if (c?.side === 'party') this._partyDown(c.ref ?? c, ev.status === 'dead', pan, ev.id);
        else this._foeDown(c?.monsterId ?? monsterIdOf(c?.name), pan, ev.id);
        break;
      }
      case 'cast':
        this.spellHint = { at: now, family: spellFamily(String(ev.spell ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')), n: /missile/i.test(ev.spell ?? '') ? 3 : undefined, src: 'event', pan: this._panOf(by(ev.id)) };
        break;
      case 'turnUndead':
        this.spellHint = { at: now, family: 'spell_turn', src: 'event', pan: this._panOf(by(ev.id)) };
        break;
      case 'flee':
        if (by(ev.id)?.side === 'monster') this.foesDown++;
        this._reassess();
        break;
      case 'round':
        // A structured hint lives until the next attack or round (not a wall-clock window).
        if (this.hint?.src === 'event') this.hint.live = false;
        this._reassess();
        break;
      case 'heal':
        this._reassess();
        break;
      default:
    }
  }

  /** A party member falls: their own voice (race, sex), the body, the music answers. */
  _partyDown(ref, dead, pan = 0, key) {
    const now = this.now;
    const member = this.party?.find((c) => c.name === ref?.name) ?? ref ?? {};
    // Never before the blow that felled them (QUICK queues blows up to 1.6 s ahead).
    const delay = this._deathSlot(key, 1.0) ?? this._afterImpact(key);
    this._raw('vox_party_die', { vol: 0.75, race: member.race, gender: member.gender, pan, delay });
    if (now - (this.lastThud ?? -10) > 0.3) {
      this.lastThud = now;
      this._raw('death', { delay: delay + 0.3, pan });
    }
    this.downs++;
    if (dead || member.status === 'dead') this.e.stinger('fallen', { duck: 0.6 });
    if (this._partyAllDown()) this._combatEnd('monster');
    else this._reassess();
  }

  /** Play a sound without remapping (the director already made it specific). */
  _raw(name, opts) {
    if (this.e._sfx) this.e._sfx(name, opts);
    else this.e.sfx(name, opts);
  }

  /**
   * Next slot on a stagger lane: simultaneous events (QUICK resolves a
   * whole round in one frame) are spread 60–120 ms apart instead of stacked
   * on one sample; returns the delay, or null when the lane is too backed up.
   */
  _stagger(lane, gap = [0.06, 0.12], max = 1.2) {
    const now = this.now;
    this._lanes ??= {};
    const at = Math.max(now, this._lanes[lane] ?? 0);
    if (at - now > max) return null;
    this._lanes[lane] = at + this.e.rng.range(gap[0], gap[1]);
    return at - now;
  }

  /** Delay (from now) at which a victim's last blow has landed, plus a breath; 0 when none is queued. */
  _afterImpact(key) {
    const t = key !== undefined ? this._impacts?.get(key) : undefined;
    return t === undefined ? 0 : Math.max(0, t + 0.08 - this.now);
  }

  /** Remember when a blow on `key` is heard (absolute audio time). */
  _markImpact(key, delay) {
    if (key === undefined || key === null) return;
    this._impacts ??= new Map();
    this._impacts.set(key, this.now + delay);
    if (this._impacts.size > 64) this._impacts.delete(this._impacts.keys().next().value);
  }

  /**
   * A slot on the death lane no earlier than the victim's killing blow: cries
   * of several falls stay 0.22–0.38 s apart, and the lane's backlog limit
   * counts from the impact, not from now. Null when the lane is too full.
   */
  _deathSlot(key, max = 1.0) {
    const now = this.now;
    const min = this._afterImpact(key);
    this._lanes ??= {};
    const at = Math.max(now + min, this._lanes.death ?? 0);
    if (at - now - min > max) return null;
    this._lanes.death = at + this.e.rng.range(0.22, 0.38);
    return at - now;
  }

  /** Delay until every queued QUICK blow and death cry has sounded. */
  backlog() {
    const now = this.now;
    let t = 0;
    for (const v of Object.values(this._lanes ?? {})) t = Math.max(t, v - now);
    for (const v of this._impacts?.values() ?? []) t = Math.max(t, v - now);
    return Math.max(0, t);
  }

  /**
   * The attack that played without animation (snap/QUICK) as a whole little
   * exchange, staggered so a round resolved in one frame still reads blow by
   * blow: the wind-up at the attacker (sword swing or bow twang, now and then
   * a battle cry), then the impact at the target — armour / bone / flesh, an
   * arrow thud, a parry, shield block or dodge — and, on a hit, sometimes the
   * victim's pain. When the lane is backed up the extras give way to impacts.
   */
  _snapBlow() {
    const h = this.blowPending;
    this.blowPending = null;
    if (!h || h.immune) return;
    const delay = this._stagger('blow', [0.2, 0.3], 1.6);
    if (delay === null) return;
    const busy = delay > 0.9;
    const vol = 0.75;
    const tp = h.tgtPan ?? 0;
    const ap = h.attPan ?? 0;
    const wind = h.ranged ? 0.2 : 0.13;
    if (!busy) {
      this._raw(h.ranged ? 'bow' : 'swing', { delay, vol: 0.8, pan: ap, heavy: !!(h.attId && /ogre|troll|giant|bugbear/i.test(h.attId)) });
      const v = this._voice(h.attId);
      if (v) this._raw(v[0], { ...v[1], delay: delay + 0.02, pan: ap });
    }
    const at = delay + (busy ? 0 : wind);
    if (h.hit) {
      if (h.ranged) this._raw('arrow_hit', { delay: at, vol, pan: tp });
      if (h.bite) this._raw('bite', { delay: at, vol, pan: tp });
      this._raw('hit', { delay: at, vol, pan: tp, material: h.ranged && h.material === 'armor' ? 'flesh' : h.material, crit: h.crit });
      this._markImpact(h.tgtKey, at);
      const hurt = this._hurt(h, at + 0.08);
      if (hurt) this._raw(hurt[0], { ...hurt[1], pan: tp });
    } else if (h.ranged) this._raw('arrow_in', { delay: at, vol: vol * 0.7, pan: tp });
    else {
      const r = this.e.rng.next();
      this._raw(BEASTS.test(h.tgtId ?? '') || r < 0.4 ? 'dodge' : r < 0.7 ? 'parry' : 'shield', { delay: at, vol: vol * 0.85, pan: tp });
    }
  }

  /**
   * The victim's pain on a hit (monster family voice or the party member's
   * own, by race and sex): 45 % of blows, never two within 0.7 s, always on a
   * crit or a heavy blow.
   */
  _hurt(h, delay) {
    const now = this.now;
    // The blow that kills is answered by the death cry, not a yelp after it.
    if (h.killed) return null;
    if (now - this.lastHurt < 0.7) return null;
    if (!(h.crit || (h.dmg ?? 0) >= 6 || this.e.rng.chance(0.45))) return null;
    if (h.tgtId) {
      this.lastHurt = now;
      return [`vox_${voiceOf(h.tgtId)}`, { mode: 'hurt', vol: 0.7, delay }];
    }
    if (h.tgtParty) {
      const who = this._member(h.tgtRef);
      this.lastHurt = now;
      return ['vox_party', { mode: 'hurt', vol: 0.65, delay, race: who?.race, gender: who?.gender }];
    }
    return null;
  }

  /** A foe is slain: its death cry (staggered when several fall at once) and a thud. */
  _foeDown(id, pan = 0, key) {
    const now = this.now;
    const fresh = now - (this.lastDeathVox ?? -10) > 0.6;
    let at = this._afterImpact(key);
    if (id) {
      this.foesDown++;
      // Up to ~1 s of queued cries, each a beat after the last (and never
      // before the killing blow), quieter as they pile up.
      const delay = this._deathSlot(key, 1.0);
      if (delay !== null) {
        this.lastDeathVox = now;
        at = delay;
        this._raw(`vox_${voiceOf(id)}_die`, { vol: 0.85 * (delay - this._afterImpact(key) > 0.3 ? 0.8 : 1), delay: delay + 0.03, pan });
      }
    }
    if (now - (this.lastThud ?? -10) > 0.3) {
      this.lastThud = now;
      this._raw('death', { delay: at + 0.25, vol: fresh ? 1 : 0.6, pan });
    }
    this._reassess();
  }

  _structuredAttack(p) {
    const tgtId = p.targetMonsterId ?? monsterIdOf(p.target);
    const attId = p.monsterId ?? monsterIdOf(p.attacker);
    this.hint = this._hintFrom({ attId, tgtId, tgtParty: p.targetSide === 'party' || this.partyNames.has(p.target), ranged: !!p.ranged, hit: !!p.hit, crit: !!p.crit, bite: attId === 'giantRat' }, 'event');
  }

  _structuredCast(p) {
    const name = p.spellId ?? p.spell ?? '';
    this.spellHint = { at: this.now, family: spellFamily(String(name).replace(/([a-z])([A-Z])/g, '$1 $2')), n: /missile/i.test(name) ? 3 : undefined, src: 'event' };
  }

  _hintFrom(a, src) {
    let material = 'flesh';
    if (a.tgtId && /skeleton/i.test(a.tgtId)) material = 'bone';
    else if (a.tgtParty || ARMOURED.test(a.tgtId ?? '')) material = this.e.rng.chance(0.55) ? 'armor' : 'flesh';
    return { at: this.now, src, used: false, live: true, ...a, material };
  }

  /** Party member (with race/gender) for an engine ref or a name. */
  _member(ref) {
    if (!ref) return null;
    return this.party?.find((c) => c.name === (ref.name ?? ref)) ?? (typeof ref === 'object' ? ref : null);
  }

  _voice(attId, chance = 0.45) {
    if (!attId) {
      // A party member's effort shout, now and then.
      const h = this.hint;
      const now = this.now;
      if (!h?.attParty || now - this.lastVox < 2 || !this.e.rng.chance(0.25)) return null;
      const who = this._member(h.attRef);
      this.lastVox = now;
      return ['vox_party', { mode: 'attack', vol: 0.6, race: who?.race, gender: who?.gender }];
    }
    const fam = voiceOf(attId);
    const now = this.now;
    const first = !this.voiced.has(fam);
    if (!first && (now - this.lastVox < 1.4 || !this.e.rng.chance(chance))) return null;
    this.voiced.add(fam);
    this.lastVox = now;
    return [`vox_${fam}`, { vol: 0.75 }];
  }

  _message({ text, kind }) {
    if (!text) return;
    if (this.scene !== 'combat') {
      this._worldMessage(text, kind);
      return;
    }
    const now = this.now;
    let m;
    if ((m = /^(.+?) ATTACK!$/.exec(text))) {
      // "4 KOBOLDS AND 1 KOBOLD CHIEFTAINS" → loudest voice = the boss, else the first group.
      const groups = m[1].toLowerCase().split(/\s+and\s+/).map((g) => {
        const mm = /^(\d+)\s+(.+)$/.exec(g.trim());
        const name = (mm ? mm[2] : g).trim();
        return { id: MONSTER_BY_NAME.get(name) ?? MONSTER_BY_NAME.get(name.replace(/s$/, '')) ?? null, n: mm ? Number(mm[1]) : 1 };
      });
      const ids = groups.map((g) => g.id).filter(Boolean);
      const id = ids.find((x) => BOSS.test(x)) ?? ids[0] ?? null;
      this.e.stinger('danger', { duck: 0.5 });
      if (id) {
        this.voiced.add(voiceOf(id));
        this.e.sfx(`vox_${voiceOf(id)}`, { delay: 0.5, vol: 0.9 });
      }
      if (ids.length) {
        const x = this._strength(groups.filter((g) => g.id));
        this.e.setIntensity(x, 0.5);
      } else if (BOSS.test(m[1]) || /\b(\d{2,}|many|horde)\b/i.test(m[1])) {
        this.baseDanger = 0.8;
        this.e.setIntensity(0.8, 0.5);
      }
      return;
    }
    if (/ drinks a /.test(text)) {
      this.e.sfx('potion');
      return;
    }
    if (kind === 'warn' && /escapes/.test(text)) this.combatOver = true;
    // The structured feed already described attacks, casts and falls.
    if (this.structured) return;
    if ((m = /^(.+?) (?:casts|uses) (.+?)!$/.exec(text))) {
      if (this.spellHint?.src === 'event' && now - this.spellHint.at < 2) return;
      const missiles = /magic missile/i.test(m[2]) ? 3 : undefined;
      this.spellHint = { at: now, family: spellFamily(m[2]), n: missiles };
      return;
    }
    if (/presents the holy symbol/.test(text)) {
      this.spellHint = { at: now, family: 'spell_turn' };
      return;
    }
    const a = parseAttack(text);
    if (a) {
      const attId = monsterIdOf(a.att);
      const tgtId = monsterIdOf(a.tgt);
      // A structured event already described this attack: keep it (it knows more).
      if (!(this.hint?.src === 'event' && now - this.hint.at < 3)) {
        this.hint = this._hintFrom({ attId, tgtId, tgtParty: this.partyNames.has(a.tgt), ranged: a.ranged, hit: a.hit, crit: !!a.crit, bite: !!a.bite }, 'log');
      }
      this.hint.used = true;
      // The wind-up was heard as a neutral rustle: now that we know the attack, voice it.
      if (this.pendingWind && now - this.pendingWind.at < 4) {
        this.pendingWind = null;
        const h = this.hint;
        const out = [[h.ranged ? 'arrow_in' : 'swing', { heavy: h.attId && /ogre|troll|giant|bugbear/i.test(h.attId) }]];
        const v = this._voice(h.attId);
        if (v) out.push(v);
        for (const [n, o] of out) this.e.sfx(n, o);
        this.deferred = { at: now, ranged: h.ranged };
      }
      this._reassess();
      if (!/ is (slain|down)[.!]?$/.test(text)) return;
    }
    if (/passes harmlessly through/.test(text)) {
      this.immuneAt = now;
      return;
    }
    if ((m = /(?:^|\.\s)([^.]+?) is slain[.!]?$/.exec(text)) || (m = /^(.+?) crumbles to dust!$/.exec(text)) || (m = /^(.+?) succumbs to the poison\.$/.exec(text))) {
      // QUICK combat resolves in a blink: don't stack a scream per corpse, one thud per 300 ms.
      this._foeDown(monsterIdOf(m[1]));
      return;
    }
    // Spell and weapon downs of party members ("Taran takes 6 damage. Taran is down!").
    if ((m = /(?:^|\.\s)([^.]+?) is down!$/.exec(text))) {
      this._partyDown(this.party?.find((c) => c.name === m[1]) ?? { name: m[1] }, false);
      return;
    }
    if ((m = /^(.+?) flees the battle!$/.exec(text))) {
      if (monsterIdOf(m[1])) this.foesDown++;
      this._reassess();
      return;
    }
    if ((m = /^(.+?) (is killed!|falls, bleeding|is knocked unconscious)/.exec(text))) {
      this._partyDown(this.party?.find((c) => c.name === m[1]) ?? { name: m[1] }, /killed/.test(m[2]));
      return;
    }
    if (/regains|healed|bleeding stops/.test(text)) this._reassess();
    else if (this.party?.length && this._partyHpFrac() < 0.35) this._reassess();
  }

  /** Exploration / dialogue log lines that deserve a sound (each heard once even if several scenes log it). */
  _worldMessage(text) {
    const now = this.now;
    const seen = this._recentText.get(text);
    if (seen !== undefined && now - seen < 1) return;
    this._recentText.set(text, now);
    if (this._recentText.size > 40) this._recentText.delete(this._recentText.keys().next().value);
    const play = (name, opts) => {
      const last = this._recentSfx.get(name);
      if (last !== undefined && now - last < 1.2) return false;
      this._recentSfx.set(name, now);
      this.e.sfx(name, opts);
      return true;
    };
    if (/stirs in the shadows/i.test(text)) play('omen');
    else if (/hidden door|secret door/i.test(text)) {
      if (play('door_secret')) this.e.stinger('discovery', { duck: 0.5 });
    } else if (/^Journal entry .* recorded/.test(text)) {
      if (play('_quest')) this.e.stinger('quest', { duck: 0.5 });
    } else if (/The door is locked/.test(text)) play('door_locked', { delay: 0.05 });
    else if (/wounds are healed/.test(text)) play('spell_heal');
    else if (/deathly cold/i.test(text)) play('spell_curse');
    else if (/ takes the |Among the spoils/.test(text)) {
      if (play('equip')) this.e.sfx('sparkle', { delay: 0.1, vol: 0.6 });
    }
  }

  // ------------------------------------------------------------------ sfx remapping
  /**
   * Turn a scene's generic SFX request into the specific sound(s) for the
   * current context. Returns [[name, opts], ...] or null.
   */
  remapSfx(name, opts) {
    const out = this._remap(name, opts);
    // Combat sounds come from where it happens on screen: the blow and the
    // victim's cry at the target, the wind-up and war cry at the attacker.
    // Every combat sound carries a position (centre is a position too).
    const h = this.scene === 'combat' ? this.hint : null;
    if (!out || !h) return out;
    return out.map(([n, o]) => {
      if (o?.pan !== undefined) return [n, o];
      const pan = ATTACKER_SIDE.test(n) || (n.startsWith('vox_') && o?.mode !== 'hurt') ? h.attPan : TARGET_SIDE.test(n) || n.startsWith('vox_') ? h.tgtPan : null;
      return pan === null || pan === undefined ? [n, o] : [n, { ...o, pan }];
    });
  }

  /**
   * Stereo position (-0.8…0.8) of a combatant as seen from the combat camera:
   * its grid offset from the fight's centre projected on the camera's right
   * vector. The camera yaw comes from the current scene (`audioListener()`
   * if it offers one, else its orbit camera's `cam.yaw`); without one, centre.
   */
  _panOf(c) {
    if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return 0;
    const sc = this.scenes?.current;
    let yaw = null;
    try {
      yaw = sc?.audioListener?.()?.yaw ?? sc?.cam?.yaw ?? null;
    } catch {
      yaw = null;
    }
    if (typeof yaw !== 'number' || !Number.isFinite(yaw)) return 0;
    const all = (this.engine?.all ?? []).filter((o) => typeof o.x === 'number' && !o.fled);
    if (!all.length) return 0;
    const cx = all.reduce((a, o) => a + o.x, 0) / all.length;
    const cy = all.reduce((a, o) => a + o.y, 0) / all.length;
    // Grid (x, y) is world (x, z); the camera's right vector is (cos yaw, 0, -sin yaw).
    const side = (c.x - cx) * Math.cos(yaw) - (c.y - cy) * Math.sin(yaw);
    // About three tiles off centre is already well to one side; never hard-panned.
    const p = Math.max(-0.8, Math.min(0.8, side / 3));
    return Math.abs(p) < 0.03 ? 0 : Math.round(p * 100) / 100;
  }

  _remap(name, opts) {
    const now = this.now;
    // A structured (combat:event) hint belongs to its attack until the next
    // attack or round replaces it — at Speed 'Slow' or on slow frames the
    // impact can land seconds after the swing. Log-derived hints are short-lived.
    const h0 = this.hint;
    const hint = h0 && (h0.src === 'event' ? h0.live && now - h0.at < 10 : now - h0.at < 1.2) ? h0 : null;
    if (this.scene === 'combat' && (name === 'hit' || name === 'miss')) this.blowPending = null;
    const late = this.deferred && now - this.deferred.at < 0.15 ? this.deferred : null;
    const nudge = (o) => (late ? { ...o, delay: (o.delay ?? 0) + (late.ranged ? 0.12 : 0.07) } : o);
    switch (name) {
      case '_quest':
        return null;
      case 'step':
        if (this.scene === 'combat') return [['walk', { surface: this._envNow().surface, ...opts, vol: (opts.vol ?? 1) * 0.8 }]];
        return [['step', opts]];
      case 'miss': {
        if (this.scene !== 'combat') return [['miss', opts]];
        if ((opts.pitch ?? 1) > 1.2) {
          // Attack wind-up, requested before the blow lands. Only a structured
          // combat:attack announced for *this* swing may shape it.
          const h = this.hint;
          if (h && h.src === 'event' && !h.used && h.live) {
            h.used = true;
            const out = [[h.ranged ? 'bow' : 'swing', { heavy: h.attId && /ogre|troll|giant|bugbear/i.test(h.attId) }]];
            const v = this._voice(h.attId);
            if (v) out.push(v);
            return out;
          }
          this.pendingWind = { at: now };
          return [['ready', {}]];
        }
        // Undead immune to the weapon: it passes harmlessly through.
        if (hint?.immune && hint.ranged) return [['spell_ward', { vol: 0.5 }]];
        if (hint?.immune || now - (this.immuneAt ?? -10) < 0.25) return [['pass_through', {}]];
        if (!hint) return [['miss', opts]];
        if (hint.ranged) return [['swing', { pitch: 1.7, vol: 0.6 }]];
        // A melee miss: the blade is parried, caught on a shield, or dodged.
        const r = this.e.rng.next();
        const beast = BEASTS.test(hint.tgtId ?? '');
        const pick = beast ? 'dodge' : hint.tgtParty ? (r < 0.4 ? 'parry' : r < 0.75 ? 'shield' : 'dodge') : r < 0.35 ? 'parry' : r < 0.55 ? 'shield' : 'dodge';
        const out = [[pick, nudge({})]];
        if (!late && pick !== 'dodge') out.unshift(['swing', { vol: 0.7 }]);
        return out;
      }
      case 'hit': {
        if (this.scene !== 'combat' || !hint) return [['hit', opts]];
        const out = [];
        if (hint.ranged) out.push(['arrow_hit', nudge({})]);
        if (hint.bite) out.push(['bite', nudge({})]);
        out.push(['hit', nudge({ material: hint.ranged && hint.material === 'armor' ? 'flesh' : hint.material, crit: hint.crit, ...opts })]);
        this._markImpact(hint.tgtKey, (opts?.delay ?? 0) + (late ? (late.ranged ? 0.12 : 0.07) : 0));
        // The victim's pain (the party's own voices by race and sex).
        const hurt = this._hurt(hint, 0.08 + (late ? 0.07 : 0));
        if (hurt) out.push(hurt);
        return out;
      }
      case 'spell': {
        const sh = this.spellHint && now - this.spellHint.at < 2 ? this.spellHint : null;
        if (!sh) return [['spell', opts]];
        this.spellHint = null;
        // The incantation at the caster; the spell's own sound leans from there towards the field.
        const at = opts?.pan ?? sh.pan;
        const cast = at === undefined ? opts : { ...opts, pan: at };
        if (sh.family === 'spell') return [['spell', cast]];
        return [['spell', { ...cast, vol: 0.55 }], [sh.family, { ...opts, n: sh.n, delay: 0.45, ...(at === undefined ? {} : { pan: Math.round(at * 50) / 100 }) }]];
      }
      default:
        return [[name, opts]];
    }
  }

  // ------------------------------------------------------------------ ui
  _installUiSounds() {
    if (typeof document === 'undefined') return;
    const SEL = 'button:not([disabled]), [role="button"], .por-menu-item, .por-cmd';
    // Input modality: pointer hovers tick on their own; keyboard / gamepad
    // navigation ticks when the focus or a menu highlight moves.
    let modality = 'pointer';
    let lastFocusTick = -1;
    this.bus?.on('input:action', ({ code }) => {
      if (String(code ?? '').startsWith('pad')) modality = 'pad';
    });
    document.addEventListener('keydown', () => (modality = 'key'), { capture: true, passive: true });
    document.addEventListener('pointerdown', () => (modality = 'pointer'), { capture: true, passive: true });
    document.addEventListener('pointermove', (ev) => {
      if (ev.movementX || ev.movementY) modality = 'pointer';
    }, { passive: true });
    const focusTick = () => {
      if (modality === 'pointer') return;
      const now = this.now;
      if (now - lastFocusTick < 0.03) return;
      lastFocusTick = now;
      this.e.sfx('focus', { bus: 'ui', vol: 0.9, global: true });
    };
    document.addEventListener('focusin', (ev) => {
      if (ev.target?.closest?.(SEL)) focusTick();
    });
    // Menus move a highlight (aria-selected) rather than DOM focus.
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver((list) => {
        for (const m of list) if (m.target?.getAttribute?.('aria-selected') === 'true' && m.oldValue !== 'true') {
          focusTick();
          return;
        }
      });
      const watch = () => mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'], attributeOldValue: true });
      if (document.body) watch();
      else document.addEventListener('DOMContentLoaded', watch, { once: true });
    }
    let lastEl = null;
    document.addEventListener(
      'pointerover',
      (ev) => {
        const el = ev.target?.closest?.(SEL);
        if (!el || el === lastEl) return;
        lastEl = el;
        this.e.sfx('hover', { bus: 'ui', vol: 0.8, global: true });
      },
      { passive: true },
    );
    document.addEventListener(
      'pointerout',
      (ev) => {
        if (lastEl && !lastEl.contains(ev.relatedTarget)) lastEl = null;
      },
      { passive: true },
    );
    // The generic click yields to a scene's own (pitched) click for the same press.
    document.addEventListener(
      'click',
      (ev) => {
        const el = ev.target?.closest?.(SEL);
        if (el) this._uiAfter('click');
      },
      { passive: true, capture: true },
    );
  }
}
