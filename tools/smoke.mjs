#!/usr/bin/env node
/**
 * End-to-end vertical-slice smoke test (headless):
 * title → Quick Start → walk east into the kobold ambush → dialogue → COMBAT →
 * QUICK auto-resolve → victory → back to explore. Fails on any page error.
 *   node tools/smoke.mjs [--shots] [--port N]   (--shots saves shots/smoke_*.png at each step)
 */
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';

const saveShots = process.argv.includes('--shots');
const portArg = process.argv.indexOf('--port');
const srv = await ensureServer(portArg > 0 ? { port: Number(process.argv[portArg + 1]) } : {});
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const sceneName = () => page.evaluate(() => window.__GAME?.scenes.currentName);
const waitScene = (name, timeout = 60000) =>
  page.waitForFunction((n) => window.__GAME?.scenes.currentName === n && !window.__GAME.scenes.transitioning, name, { timeout, polling: 100 });
const shot = async (n) => saveShots && page.screenshot({ path: `shots/smoke_${n}.png` });
let ok = false;
try {
  await page.goto(`${srv.base}?seed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 60000 });
  await shot('1_title');
  await page.keyboard.press('q'); // Quick Start
  await waitScene('explore');
  await page.waitForTimeout(500);
  await shot('2_explore');
  // Start (1,14) facing E; kobolds wait at (5,14): four steps east.
  for (let i = 0; i < 4 && (await sceneName()) === 'explore'; i++) {
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => !window.__GAME.scenes.current?.tween, null, { timeout: 90000 });
    await page.waitForTimeout(100);
  }
  await waitScene('dialogue');
  await shot('3_dialogue');
  await page.keyboard.press('c'); // COMBAT
  await waitScene('combat');
  await page.waitForTimeout(300);
  await shot('4_combat');
  await page.keyboard.press('q'); // QUICK
  await page.waitForSelector('.por-dialog', { timeout: 90000 });
  await shot('5_victory');
  await page.keyboard.press('Enter');
  await waitScene('explore');
  const loc = await page.evaluate(() => window.__GAME.game.location);
  const xp = await page.evaluate(() => window.__GAME.game.party[0].xp);
  console.log('back in explore at', loc, 'lead xp', xp);
  ok = errors.length === 0;
} catch (err) {
  console.error('[smoke] step failed:', err.message, 'scene =', await sceneName().catch(() => '?'));
} finally {
  for (const e of errors) console.error('[error]', e);
  await browser.close();
  await srv.close();
}
console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
