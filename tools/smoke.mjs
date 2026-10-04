#!/usr/bin/env node
/**
 * End-to-end vertical-slice smoke test (headless):
 * title → Quick Start → path-find (BFS over the live map) to the nearest unspent combat encounter →
 * dialogue → COMBAT → QUICK auto-resolve → victory → back to explore → row to Sokol Keep by keyboard.
 * Fails on any page error.
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

/** Shortest path (list of compass dirs) from the party to the nearest unspent fixed combat encounter. */
const planRoute = () => page.evaluate(() => {
  const g = window.__GAME;
  const sc = g.scenes.current;
  const map = sc.map;
  const spent = g.game.spentEvents ?? {};
  const live = (e) => e.type === 'encounter' && !(e.once && spent[e.id]) && !e.chance;
  const isGoal = (e) => live(e) && e.once && !String(e.ref).startsWith('ev_');
  const found = sc._foundSecrets?.();
  const start = `${sc.pos.x},${sc.pos.y}`;
  const prev = new Map([[start, null]]);
  const q = [[sc.pos.x, sc.pos.y]];
  while (q.length) {
    const [x, y] = q.shift();
    const evs = map.eventsAt(x, y);
    if (`${x},${y}` !== start && evs.some(isGoal)) {
      const dirs = [];
      for (let k = `${x},${y}`; prev.get(k); k = prev.get(k).from) dirs.unshift(prev.get(k).dir);
      return { goal: { x, y, ref: evs.find(isGoal).ref }, dirs };
    }
    if (`${x},${y}` !== start && evs.some(live)) continue; // never walk through another scripted encounter
    for (const dir of ['N', 'E', 'S', 'W']) {
      const r = map.tryMove(x, y, dir, { foundSecrets: found });
      if (!r.ok || r.leaves) continue;
      const k = `${r.nx},${r.ny}`;
      if (prev.has(k)) continue;
      prev.set(k, { from: `${x},${y}`, dir });
      q.push([r.nx, r.ny]);
    }
  }
  return null;
});

const ORDER = ['N', 'E', 'S', 'W'];
const idle = () => page.waitForFunction(() => {
  const s = window.__GAME.scenes;
  return s.currentName !== 'explore' || (!s.current?.tween && !s.transitioning);
}, null, { timeout: 90000, polling: 100 });

let ok = false;
try {
  await page.goto(`${srv.base}?seed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 60000 });
  await shot('1_title');
  await page.keyboard.press('q'); // Quick Start
  await waitScene('explore');
  await page.waitForTimeout(500);
  await shot('2_explore');
  const route = await planRoute();
  if (!route) throw new Error('no reachable combat encounter on the start map');
  console.log('walking to', route.goal, 'via', route.dirs.join(''));
  for (const dir of route.dirs) {
    if ((await sceneName()) !== 'explore') break; // a wandering monster got there first: fine
    let facing = await page.evaluate(() => window.__GAME.scenes.current.pos.dir);
    while (facing !== dir) {
      const cw = (ORDER.indexOf(dir) - ORDER.indexOf(facing) + 4) % 4;
      await page.keyboard.press(cw === 3 ? 'ArrowLeft' : 'ArrowRight');
      await idle();
      if ((await sceneName()) !== 'explore') break;
      facing = await page.evaluate(() => window.__GAME.scenes.current.pos.dir);
    }
    if ((await sceneName()) !== 'explore') break;
    await page.keyboard.press('ArrowUp');
    await idle();
    await page.waitForTimeout(80);
  }
  await waitScene('dialogue');
  await page.waitForTimeout(400);
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
  // travel by keyboard: the Grey Gull prompt's command is 'Row to Sokol Keep', so R must row
  await page.goto(`${srv.base}?seed=7&scene=dialogue&script=go_civ_sokol`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 60000 });
  await waitScene('dialogue');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); // finish the typewriter reveal
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__GAME?.scenes.currentName === 'explore' && window.__GAME.game.location?.map === 'sokol_keep', null, { timeout: 60000, polling: 100 });
  console.log('rowed to', await page.evaluate(() => window.__GAME.game.location));
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
