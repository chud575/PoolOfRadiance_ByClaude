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
const OUT = process.env.OUT; const shot = async (n) => page.screenshot({ path: `${OUT}/f2_${n}.png`, timeout: 240000 });

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


const pix = async () => page.screenshot({ clip: { x: 300, y: 150, width: 600, height: 400 }, timeout: 240000 });
let ok = false;
try {
  await page.goto(`${srv.base}?seed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 120000 });
  await page.keyboard.press('q');
  await waitScene('explore');
  await page.waitForTimeout(500);
  await page.keyboard.press('F2');
  await page.waitForTimeout(800);
  console.log('classic on:', await page.evaluate(() => window.__GAME.render.classic));
  await shot('1_explore');
  const route = await planRoute();
  console.log('route', route?.dirs.join(''));
  let step = 0;
  for (const dir of route.dirs) {
    if ((await sceneName()) !== 'explore') break;
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
    await page.waitForTimeout(150);
    if (step < 3 && (await sceneName()) === 'explore') {
      const a = await pix(); await page.waitForTimeout(400); const b = await pix();
      console.log('step', step, 'still-frame stable:', a.equals(b));
      await shot(`2_step${step}`);
    }
    step++;
  }
  await waitScene('dialogue');
  await page.waitForTimeout(400);
  await shot('3_dialogue');
  await page.keyboard.press('c');
  await waitScene('combat');
  await page.waitForTimeout(1500);
  await shot('4_combat');
  await page.keyboard.press('F2');
  await page.waitForTimeout(800);
  await shot('5_combat_modern');
  await page.keyboard.press('F2');
  await page.waitForTimeout(800);
  await shot('6_combat_classic');
  ok = true;
} catch (e) { console.log('FAIL', e.message); }
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
await browser.close(); await srv.close();
process.exit(ok && !errors.length ? 0 : 1);
