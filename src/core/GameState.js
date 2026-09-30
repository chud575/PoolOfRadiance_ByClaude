import { DIRS } from '../data/maps/MapGrid.js';

/**
 * The mutable world/party state that is saved and loaded. Plain-data only
 * (characters are plain objects produced by rules/character.js) so that
 * toJSON/fromJSON are trivial.
 */
export class GameState {
  /** @param {import('./EventBus.js').EventBus} [bus] */
  constructor(bus) {
    this.bus = bus;
    /** @type {import('../rules/character.js').Character[]} */
    this.party = [];
    /** Index of the selected party member (roster highlight). */
    this.activeIndex = 0;
    this.location = { map: 'phlan_slums', x: 1, y: 14, dir: 'N' };
    /** Minutes since game start. Game starts at 08:00 day 1. */
    this.minutes = 8 * 60;
    /** Generic story/quest flags. */
    this.flags = {};
    /** Per-map visited cells for the automap: {mapId: string(base64 bitset)} */
    this.explored = {};
    /** Encounter ids that are spent (once-only events). */
    this.spentEvents = {};
    /** Party purse shared pool (copper/silver/electrum/gold/platinum, in gp). */
    this.pooledGold = 0;
  }

  get activeCharacter() {
    return this.party[this.activeIndex] ?? null;
  }

  setLocation(loc) {
    Object.assign(this.location, loc);
    this.bus?.emit('location:changed', { ...this.location });
  }

  advanceTime(minutes) {
    this.minutes += minutes;
    this.bus?.emit('time:changed', { minutes: this.minutes });
  }

  /** @returns {{day:number,hour:number,minute:number}} */
  get clock() {
    const day = Math.floor(this.minutes / 1440) + 1;
    const hour = Math.floor((this.minutes % 1440) / 60);
    return { day, hour, minute: this.minutes % 60 };
  }

  /** 0..1, 0 = midnight, 0.5 = noon */
  get dayFraction() {
    return (this.minutes % 1440) / 1440;
  }

  markExplored(mapId, x, y, w = 16) {
    const key = mapId;
    const arr = (this.explored[key] ??= []);
    const i = y * w + x;
    arr[i >> 5] = (arr[i >> 5] ?? 0) | (1 << (i & 31));
  }

  isExplored(mapId, x, y, w = 16) {
    const arr = this.explored[mapId];
    if (!arr) return false;
    const i = y * w + x;
    return ((arr[i >> 5] ?? 0) & (1 << (i & 31))) !== 0;
  }

  setParty(party) {
    this.party = party;
    this.activeIndex = 0;
    this.bus?.emit('party:changed', { party });
  }

  notifyPartyChanged() {
    this.bus?.emit('party:changed', { party: this.party });
  }

  summary() {
    const lead = this.party[0]?.name ?? 'No party';
    const { day, hour, minute } = this.clock;
    return `${lead} & co. — ${this.location.map} (${this.location.x},${this.location.y}) — Day ${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  toJSON() {
    return {
      party: this.party,
      activeIndex: this.activeIndex,
      location: this.location,
      minutes: this.minutes,
      flags: this.flags,
      explored: this.explored,
      spentEvents: this.spentEvents,
      pooledGold: this.pooledGold,
    };
  }

  /** @param {object} data */
  loadJSON(data) {
    const d = structuredClone(data);
    this.party = d.party ?? [];
    this.activeIndex = d.activeIndex ?? 0;
    this.location = d.location ?? this.location;
    if (!DIRS.includes(this.location.dir)) this.location.dir = 'N';
    this.minutes = d.minutes ?? this.minutes;
    this.flags = d.flags ?? {};
    this.explored = d.explored ?? {};
    this.spentEvents = d.spentEvents ?? {};
    this.pooledGold = d.pooledGold ?? 0;
    this.bus?.emit('party:changed', { party: this.party });
    return this;
  }
}
