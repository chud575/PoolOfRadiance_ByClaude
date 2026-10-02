import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/rules/dice.js';
import { createCharacter } from '../../src/rules/character.js';
import { getMap } from '../../src/data/maps/index.js';
import ExploreScene from '../../src/scenes/explore/ExploreScene.js';

/**
 * The party walks onto the kobold pit in Kuto's Warrens: ExploreScene's event
 * handler runs the rules trap pipeline (triggerMapTrap), prints the outcome,
 * spends the time and keeps the trap's state in game.flags.
 */
describe('explore: walking onto a trap', () => {
  const mk = (name, classSpec) => createCharacter({
    rng: new Rng(3), name, race: 'human', classSpec, level: 1,
    abilities: { str: 16, strPct: 0, int: 12, wis: 13, dex: 10, con: 15, cha: 10 }, items: [],
  });

  function walkOnto(x, y, seed) {
    const msgs = [];
    const sfx = [];
    const game = {
      party: [mk('Brand', 'fighter'), mk('Ansel', 'cleric')], flags: {}, spentEvents: {}, minutes: 0,
      advanceTime(m) { this.minutes += m; }, notifyPartyChanged() { this.changed = true; },
    };
    const fake = {
      map: getMap('kutos_warrens'), pos: { x, y, dir: 'N' },
      ctx: { game, rng: new Rng(seed), ui: { message: (t, tone) => msgs.push({ t, tone }) }, audio: { sfx: (n) => sfx.push(n) }, scenes: { goto() {} } },
    };
    ExploreScene.prototype._checkEvents.call(fake);
    return { msgs, sfx, game, fake };
  }

  it('the pit springs on a party with no thief and is remembered', () => {
    let w;
    for (let seed = 1; seed < 40; seed++) {
      w = walkOnto(5, 9, seed);
      if (w.game.flags.traps?.warrens_pit?.sprung) break;
    }
    expect(w.game.flags.traps.warrens_pit.sprung).toBe(true);
    expect(w.msgs.some((m) => m.tone === 'warn' && /kobold pit/.test(m.t))).toBe(true);
    expect(w.sfx.length).toBe(1);
    expect(w.game.changed).toBe(true);
    // Walking back over it: nothing happens.
    const n = w.msgs.length;
    ExploreScene.prototype._checkEvents.call(w.fake);
    expect(w.msgs.length).toBe(n);
  });
});
