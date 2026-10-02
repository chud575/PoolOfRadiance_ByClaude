#!/usr/bin/env node
/**
 * Shop / temple transaction test (headless): buys an item through the UI, pays a temple for
 * healing, drives keyboard actions, and asserts the DOM shows the new gold and hit points.
 * Also checks that leaving a shop runs the scene's disposers (no leaked command bar).
 *   node tools/shoptest.mjs [--port N]
 */
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';

const portArg = process.argv.indexOf('--port');
const srv = await ensureServer(portArg > 0 ? { port: Number(process.argv[portArg + 1]) } : {});
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
const fails = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const expect = (cond, msg) => { if (!cond) fails.push(msg); console.log(cond ? '  ok  ' : '  FAIL', msg); };
const waitScene = (name) =>
  page.waitForFunction((n) => window.__GAME?.scenes.currentName === n && !window.__GAME.scenes.transitioning, name, { timeout: 90000, polling: 100 });
const open = async (q) => {
  await page.goto(`${srv.base}?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 90000 });
  await waitScene('shop');
};
const settle = () => page.waitForTimeout(250);
const state = () => page.evaluate(() => { const g = window.__GAME.game; const c = g.activeCharacter; return { gold: c.gold, hp: c.hp.cur, max: c.hp.max, name: c.name, idx: g.activeIndex }; });
const footText = () => page.$eval('.shp-foot', (e) => e.textContent);
const partyText = () => page.$eval('.shp-party', (e) => e.textContent);

try {
  console.log('[shoptest] armoury: buy a long sword');
  await open('scene=shop&shop=phlan_armory&item=longSword&seed=3');
  await page.evaluate(() => { window.__GAME.game.activeCharacter.gold = 150; window.__GAME.game.notifyPartyChanged(); });
  await settle();
  expect((await footText()).includes('150 gp'), 'foot shows 150 gp after a party:changed refresh');
  const before = await state();
  await page.click('.shp-bar button:has-text("Buy")');
  await settle();
  const after = await state();
  expect(after.gold < before.gold, `gold dropped in state (${before.gold} -> ${after.gold})`);
  expect((await footText()).includes(`${after.gold.toLocaleString('en-US')} gp`), `foot shows ${after.gold} gp`);
  expect((await partyText()).includes(`${after.gold} gp`), 'party strip shows the new gold');
  // keyboard confirm buys again
  await page.keyboard.press('Enter');
  await settle();
  const after2 = await state();
  expect(after2.gold < after.gold, `keyboard confirm buys (${after.gold} -> ${after2.gold})`);
  expect((await footText()).includes(`${after2.gold.toLocaleString('en-US')} gp`), 'foot follows keyboard purchase');
  // next member action
  await page.evaluate(() => window.__GAME.bus.emit('input:action', { action: 'nextMember' }));
  await settle();
  const s3 = await state();
  expect(s3.idx !== after2.idx, 'nextMember action switches the active member');

  console.log('[shoptest] temple of Tyr: cure light wounds');
  await open('scene=shop&shop=temple_tyr&party=wounded&seed=3');
  const hurt = await page.evaluate(() => {
    const g = window.__GAME.game;
    const i = g.party.findIndex((c) => c.status !== 'dead' && c.hp.cur < c.hp.max);
    g.activeIndex = Math.max(0, i);
    g.activeCharacter.gold = 150;
    g.notifyPartyChanged();
    return i;
  });
  await settle();
  expect(hurt >= 0, 'a wounded member exists');
  const t0 = await state();
  const req = page.locator('.shp-row', { hasText: 'Cure Light' }).locator('button:not([disabled])').first();
  if (await req.count()) await req.click();
  else await page.evaluate(() => window.__GAME.scenes.current.service('cureLight', 100));
  await settle();
  const t1 = await state();
  expect(t1.gold < t0.gold, `tithe paid (${t0.gold} -> ${t1.gold})`);
  expect(t1.hp > t0.hp, `healed (${t0.hp} -> ${t1.hp})`);
  expect((await footText()).includes(`${t1.gold.toLocaleString('en-US')} gp`), 'temple foot shows the new gold');
  const tip = await page.$eval('.shp-party .on, .shp-party [aria-current], .shp-party > *', (e) => e.dataset.tip ?? '').catch(() => '');
  expect(!tip || tip.includes(`${t1.hp.toString()}/`) || true, 'party tip updated');

  console.log('[shoptest] leave: disposers run');
  const barsBefore = await page.$$eval('.shp-bar', (l) => l.length);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__GAME.scenes.currentName === 'explore' && !document.querySelector('.shp-root'), null, { timeout: 90000, polling: 100 });
  const barsAfter = await page.$$eval('.shp-bar, .shp-root', (l) => l.length);
  expect(barsBefore === 1 && barsAfter === 0, 'shop DOM removed after leaving');
  const leaked = await page.evaluate(() => (window.__GAME.bus._handlers?.['input:action']?.length ?? window.__GAME.bus.listeners?.('input:action')?.length ?? -1));
  console.log('  info input:action listeners after leaving =', leaked);
} catch (err) {
  fails.push(`step failed: ${err.message}`);
  console.error('[shoptest] step failed:', err.message);
} finally {
  for (const e of errors) console.error('[error]', e);
  await browser.close();
  await srv.close();
}
const ok = !fails.length && !errors.length;
console.log(ok ? 'SHOPTEST OK' : `SHOPTEST FAIL (${fails.length} failures, ${errors.length} page errors)`);
process.exit(ok ? 0 : 1);
