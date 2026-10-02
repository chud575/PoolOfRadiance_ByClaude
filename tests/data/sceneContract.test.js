import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Guard against content scenes shadowing the Scene base class's lifecycle helpers
// (a tavern `listen(p)` once silently broke every shop's party:changed / input subscriptions).
const RESERVED = ['listen', 'own', 'exit'];
const FILES = ['src/scenes/shop/ShopScene.js', 'src/scenes/dialogue/DialogueScene.js'];

describe('content scenes keep the Scene contract', () => {
  for (const f of FILES) {
    it(`${f} does not override ${RESERVED.join('/')}`, () => {
      const src = readFileSync(f, 'utf8');
      for (const name of RESERVED) expect(src, `${f} defines ${name}()`).not.toMatch(new RegExp(`^  ${name}\\s*\\(`, 'm'));
    });
    it(`${f} subscribes through Scene.listen`, () => {
      expect(readFileSync(f, 'utf8')).toMatch(/this\.listen\('input:action'/);
    });
  }
  it('the shop refreshes on party:changed', () => {
    expect(readFileSync(FILES[0], 'utf8')).toMatch(/this\.listen\('party:changed',\s*\(\)\s*=>\s*this\.refresh\(\)\)/);
  });
});
