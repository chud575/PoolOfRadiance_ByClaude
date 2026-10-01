import { envFor, spellFamily } from './environments.js';
import { VOICE_OF } from './sfx/library.js';
import { MONSTERS } from '../data/monsters.js';

/**
 * The audio director listens to the event bus and steers the engine:
 * location → mood/surface/room/ambience, time of day → night beds, combat
 * log text → contextual SFX (bow vs sword, bone vs armour, spell families,
 * monster voices, deaths), party changes → level-up / victory stingers.
 * Scenes never need to know about any of this; they keep calling the small
 * public API (playMusic / sfx) and emitting the events they already emit.
 *
 * Events consumed: scene:enter, scene:resume, location:changed, time:changed,
 * party:changed, message, input:action, and (optional, preferred when
 * emitted) combat:start {encounter, monsters}, combat:end {winner},
 * audio:stinger {name}, audio:sfx {name, opts}.
 */
const BOSS = /chief|leader|captain|priest|troll|ogre|giant|tyranthraxus|spectre|wight|dragon/i;

const MONSTER_BY_NAME = (() => {
  const m = new Map();
  for (const def of Object.values(MONSTERS)) {
    m.set(def.name.toLowerCase(), def.id);
    m.set((def.plural ?? `${def.name}s`).toLowerCase(), def.id);
  }
  return m;
})();

/** "Kobold 3" → 'kobold'; party/unknown names → null. */
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

function monsterIdOf(name) {
  if (!name) return null;
  const base = name.replace(/\s+\d+$/, '').trim().toLowerCase();
  return MONSTER_BY_NAME.get(base) ?? null;
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
    this.lastVox = -10;
    this.downs = 0;
    if (!bus) return;
    bus.on('scene:enter', (p) => this._sceneEnter(p));
    bus.on('scene:resume', (p) => this._sceneResume(p));
    bus.on('location:changed', (loc) => this._location(loc));
    bus.on('time:changed', ({ minutes }) => this._time(minutes));
    bus.on('party:changed', ({ party }) => this._party(party));
    bus.on('message', (m) => this._message(m));
    bus.on('input:action', ({ action }) => this._action(action));
    bus.on('combat:start', (p) => this._combatStart(p));
    bus.on('combat:end', ({ winner }) => this._combatEnd(winner));
    bus.on('audio:stinger', ({ name }) => this.e.stinger(name));
    bus.on('audio:sfx', ({ name, opts }) => this.e.sfx(name, opts));
    this._installUiSounds();
  }

  attach(ctx) {
    this.game = ctx.game;
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
  }

  /** Map the scene's requested track to a music state. */
  resolveTrack(id) {
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
      else if (name === 'camp') this.e.ambience('camp', { night: true });
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
        this.e.ambience('camp', { night: true });
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
    if (top === 'camp' && this.scene === 'explore') this.e.ambience(this._envNow().bed, { night: this.night });
  }

  _action(action) {
    if (this.scene !== 'explore' || this.overlays.length) return;
    if (action === 'turnLeft' || action === 'turnRight' || action === 'turnAround') this.e.sfx('turn', { vol: 0.8 });
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
    const p = this.party;
    return p?.length > 0 && p.every((c) => hpOf(c).cur <= 0 || (c.status && c.status !== 'ok'));
  }

  // ------------------------------------------------------------------ combat
  _combatStart(p) {
    if (this.inCombat && !p.encounter) return;
    this.inCombat = true;
    this.combatOver = false;
    this.downs = 0;
    this.e.intensity = 0.5;
    this.e.player?.setIntensity(0.5, 0.5);
    this.xp = partyXp(this.party);
  }

  _combatEnd(winner) {
    if (this.combatOver) return;
    this.combatOver = true;
    if (winner === 'party') this.e.stinger('victory', { stopMusic: true });
    else if (winner === 'monster') this.e.music('defeat', { fade: 0.3 });
  }

  _setDanger(x) {
    if (x > (this.e.intensity ?? 0)) this.e.setIntensity(Math.min(1, x), 1.5);
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
      // "4 KOBOLDS AND 1 KOBOLD CHIEFTAINS" → loudest voice = the first group.
      const groups = m[1].toLowerCase().split(/\s+and\s+/).map((g) => g.replace(/^\d+\s+/, '').trim());
      const ids = groups.map((w) => MONSTER_BY_NAME.get(w) ?? MONSTER_BY_NAME.get(w.replace(/s$/, '')) ?? null).filter(Boolean);
      const id = ids.find((x) => BOSS.test(x)) ?? ids[0] ?? null;
      this.e.stinger('danger', { duck: 0.5 });
      if (id) this.e.sfx(`vox_${VOICE_OF[id] ?? 'human'}`, { delay: 0.5, vol: 0.9 });
      if (BOSS.test(m[1]) || /\b(\d{2,}|many|horde)\b/i.test(m[1])) this._setDanger(0.8);
      return;
    }
    if ((m = /^(.+?) (?:casts|uses) (.+?)!$/.exec(text))) {
      const missiles = /magic missile/i.test(m[2]) ? 3 : undefined;
      this.spellHint = { at: now, family: spellFamily(m[2]), n: missiles };
      return;
    }
    if (/presents the holy symbol/.test(text)) {
      this.spellHint = { at: now, family: 'spell_turn' };
      return;
    }
    if (/ drinks a /.test(text)) {
      this.e.sfx('potion');
      return;
    }
    if ((m = /^(.+?) (backstabs|hits|bites|shoots|strikes) (.+?)(?: for (\d+)| as |, |:|\.)/.exec(text)) || (m = /^(.+?) (swings at|shoots at) (.+?) and misses/.exec(text))) {
      const [, att, verb, tgt] = m;
      const attId = monsterIdOf(att);
      const tgtId = monsterIdOf(tgt);
      const tgtParty = this.partyNames.has(tgt);
      let material = 'flesh';
      if (tgtId && /skeleton/i.test(tgtId)) material = 'bone';
      else if (tgtParty || /chief|leader|captain|hobgoblin|bugbear/i.test(tgtId ?? '')) material = this.e.rng.chance(0.55) ? 'armor' : 'flesh';
      this.hint = { at: now, ranged: verb.startsWith('shoots'), bite: verb === 'bites', crit: /critical|backstab/.test(text), attId, tgtId, material };
      return;
    }
    if ((m = /^(.+?) is slain\.$/.exec(text)) || (m = /^(.+?) crumbles to dust!$/.exec(text))) {
      // QUICK combat resolves in a blink: don't stack a scream per corpse.
      const id = monsterIdOf(m[1]);
      const fresh = now - (this.lastDeath ?? -10) > 0.6;
      this.lastDeath = now;
      if (id && fresh) this.e.sfx(`vox_${VOICE_OF[id] ?? 'human'}_die`, { vol: 0.85 });
      this.e.sfx('death', { delay: 0.25, vol: fresh ? 1 : 0.5 });
      return;
    }
    if ((m = /^(.+?) (is killed!|falls, bleeding|is knocked unconscious)/.exec(text))) {
      this.e.sfx('vox_human_die', { vol: 0.7, pitch: 1.1 });
      this.e.sfx('death', { delay: 0.25 });
      this.downs++;
      if (/killed/.test(m[2])) this.e.stinger('fallen', { duck: 0.6 });
      this._setDanger(0.55 + this.downs * 0.18);
      if (this._partyAllDown()) this._combatEnd('monster');
      return;
    }
    if (kind === 'warn' && /escapes/.test(text)) this.combatOver = true;
    // Low party health → raise the stakes.
    if (this.party?.length) {
      const hp = this.party.reduce((a, c) => a + Math.max(0, hpOf(c).cur), 0);
      const max = this.party.reduce((a, c) => a + Math.max(1, hpOf(c).max), 0);
      if (max > 0 && hp / max < 0.35) this._setDanger(0.9);
    }
  }

  /** Exploration / dialogue log lines that deserve a sound. */
  _worldMessage(text) {
    if (/stirs in the shadows/i.test(text)) this.e.sfx('omen');
    else if (/hidden door|secret door/i.test(text)) {
      this.e.sfx('door_secret');
      this.e.stinger('discovery', { duck: 0.5 });
    } else if (/^Journal entry .* recorded/.test(text)) this.e.stinger('quest', { duck: 0.5 });
    else if (/The door is locked/.test(text)) this.e.sfx('door_locked', { delay: 0.05 });
    else if (/wounds are healed/.test(text)) this.e.sfx('spell_heal');
    else if (/deathly cold/i.test(text)) this.e.sfx('spell_curse');
    else if (/ takes the |Among the spoils/.test(text)) {
      this.e.sfx('equip');
      this.e.sfx('sparkle', { delay: 0.1, vol: 0.6 });
    }
  }

  // ------------------------------------------------------------------ sfx remapping
  /**
   * Turn a scene's generic SFX request into the specific sound(s) for the
   * current context. Returns [[name, opts], ...] or null.
   */
  remapSfx(name, opts) {
    const now = this.now;
    const hint = this.hint && now - this.hint.at < 2.5 ? this.hint : null;
    switch (name) {
      case 'step':
        if (this.scene === 'combat') return [['walk', { surface: this._envNow().surface, ...opts, vol: (opts.vol ?? 1) * 0.8 }]];
        return [['step', opts]];
      case 'miss':
        if (this.scene === 'combat' && hint) {
          if ((opts.pitch ?? 1) > 1.2) {
            // Attack wind-up (played before the impact).
            const out = [[hint.ranged ? 'bow' : 'swing', { heavy: hint.attId && /ogre|troll|giant|bugbear/i.test(hint.attId) }]];
            if (hint.attId && now - this.lastVox > 1.4 && this.e.rng.chance(0.45)) {
              this.lastVox = now;
              out.push([`vox_${VOICE_OF[hint.attId] ?? 'human'}`, { vol: 0.75 }]);
            }
            return out;
          }
          if (hint.ranged) return [['swing', { pitch: 1.7, vol: 0.6 }]];
        }
        return [['miss', opts]];
      case 'hit': {
        if (this.scene !== 'combat' || !hint) return [['hit', opts]];
        const out = [];
        if (hint.ranged) out.push(['arrow_hit', {}]);
        if (hint.bite) out.push(['bite', {}]);
        out.push(['hit', { material: hint.ranged && hint.material === 'armor' ? 'flesh' : hint.material, crit: hint.crit, ...opts }]);
        if (hint.tgtId && now - this.lastVox > 0.8 && this.e.rng.chance(0.35)) {
          this.lastVox = now;
          out.push([`vox_${VOICE_OF[hint.tgtId] ?? 'human'}`, { mode: 'hurt', vol: 0.7, delay: 0.08 }]);
        }
        return out;
      }
      case 'spell': {
        const sh = this.spellHint && now - this.spellHint.at < 2 ? this.spellHint : null;
        if (!sh) return [['spell', opts]];
        this.spellHint = null;
        if (sh.family === 'spell') return [['spell', opts]];
        return [['spell', { ...opts, vol: 0.55 }], [sh.family, { ...opts, n: sh.n, delay: 0.45 }]];
      }
      default:
        return [[name, opts]];
    }
  }

  // ------------------------------------------------------------------ ui
  _installUiSounds() {
    if (typeof document === 'undefined') return;
    let lastEl = null;
    document.addEventListener(
      'pointerover',
      (ev) => {
        const el = ev.target?.closest?.('button:not([disabled]), [role="button"], .por-menu-item, .por-cmd');
        if (!el || el === lastEl) return;
        lastEl = el;
        this.e.sfx('hover', { bus: 'ui', vol: 0.8 });
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
    document.addEventListener(
      'click',
      (ev) => {
        const el = ev.target?.closest?.('button:not([disabled]), [role="button"], .por-menu-item, .por-cmd');
        if (el) this.e.sfx('click', { bus: 'ui' });
      },
      { passive: true, capture: true },
    );
  }
}
