#!/usr/bin/env node
/**
 * Full vertical slice, played through the real UI (headless, slow under SwiftShader: ~10 min):
 * title → main menu → Quick Start → walk to the Slum Gate → New Phlan → City Hall (talk to the Clerk) →
 * back through the gate → path-find to the first combat encounter → dialogue → tactical combat by hand
 * (MOVE, AIM, CAST; QUICK finishes) → victory → camp: REST (memorize) → automap → pause menu: SAVE → LOAD.
 * Fails on any page error or a stuck step.
 *   node tools/playthrough.mjs [--port N] [--shots]   (--shots: shots/play_<step>.png)
 */
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';

const saveShots = process.argv.includes('--shots');
const skipTown = process.argv.includes('--skip-town'); // straight from Quick Start to the first fight (faster re-runs)
const portArg = process.argv.indexOf('--port');
const srv = await ensureServer(portArg > 0 ? { port: Number(process.argv[portArg + 1]) } : {});
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sceneName = () => page.evaluate(() => window.__GAME?.scenes.currentName);
const waitScene = (name, timeout = 90000) =>
  page.waitForFunction((n) => window.__GAME?.scenes.currentName === n && !window.__GAME.scenes.transitioning, name, { timeout, polling: 100 });
let shotN = 0;
const shot = async (n) => saveShots && page.screenshot({ path: `shots/play_${String(++shotN).padStart(2, '0')}_${n}.png` });
const loc = () => page.evaluate(() => ({ ...window.__GAME.game.location }));
const used = new Set();

/** BFS route (compass dirs) on the live explore map to a goal cell, never crossing other event cells. */
const route = (goal) => page.evaluate((goal) => {
  const g = window.__GAME;
  const sc = g.scenes.current;
  const map = sc.map;
  const spent = g.game.spentEvents ?? {};
  const live = (e) => !(e.once && spent[e.id]) && e.type !== 'text' && e.type !== 'sign';
  const match = (x, y) => (goal.x != null ? x === goal.x && y === goal.y
    : map.eventsAt(x, y).some((e) => live(e) && e.type === 'encounter' && e.once && !e.chance && !String(e.ref).startsWith('ev_')));
  const found = sc._foundSecrets?.();
  const key = (x, y) => `${x},${y}`;
  const start = key(sc.pos.x, sc.pos.y);
  const prev = new Map([[start, null]]);
  const q = [[sc.pos.x, sc.pos.y]];
  while (q.length) {
    const [x, y] = q.shift();
    if (key(x, y) !== start && match(x, y)) {
      const dirs = [];
      for (let k = key(x, y); prev.get(k); k = prev.get(k).from) dirs.unshift(prev.get(k).dir);
      return { x, y, dirs };
    }
    if (key(x, y) !== start && map.eventsAt(x, y).some(live)) continue;
    for (const dir of ['N', 'E', 'S', 'W']) {
      const r = map.tryMove(x, y, dir, { foundSecrets: found });
      if (!r.ok || r.leaves || prev.has(key(r.nx, r.ny))) continue;
      prev.set(key(r.nx, r.ny), { from: key(x, y), dir });
      q.push([r.nx, r.ny]);
    }
  }
  return null;
}, goal);

const ORDER = ['N', 'E', 'S', 'W'];
const idle = () => page.waitForFunction(() => {
  const s = window.__GAME.scenes;
  return s.currentName !== 'explore' || (!s.current?.tween && !s.transitioning);
}, null, { timeout: 90000, polling: 100 });
const facing = () => page.evaluate(() => window.__GAME.scenes.current.pos?.dir);
async function face(dir) {
  for (let f = await facing(); f && f !== dir && (await sceneName()) === 'explore'; f = await facing()) {
    const cw = (ORDER.indexOf(dir) - ORDER.indexOf(f) + 4) % 4;
    await page.keyboard.press(cw === 3 ? 'ArrowLeft' : 'ArrowRight');
    await idle();
  }
}
/** Walk to a goal ({x,y} or {encounter:true}); optionally finish facing `endDir` (which can fire an edge event). */
async function walk(goal, endDir) {
  const r = await route(goal);
  if (!r) throw new Error(`no route to ${JSON.stringify(goal)} from ${JSON.stringify(await loc())}`);
  log('walk', JSON.stringify(goal), '→', r.dirs.join('') || '(here)');
  for (const dir of r.dirs) {
    if ((await sceneName()) !== 'explore') return;
    await face(dir);
    if ((await sceneName()) !== 'explore') return;
    await page.keyboard.press('ArrowUp');
    await idle();
    await page.waitForTimeout(60);
  }
  if (endDir && (await sceneName()) === 'explore') {
    await face(endDir);
    if ((await sceneName()) === 'explore') {
      await page.keyboard.press('ArrowUp'); // step into the edge: travel prompts fire on the facing event / exit
      await idle();
    }
  }
}

/** Dialogue: choose the command whose label matches `re` (clicks it, as a player would). */
async function choose(re, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const labels = await page.$$eval('.por-cmd:not([disabled])', (els) => els.map((e) => e.textContent.trim()));
    const i = labels.findIndex((l) => re.test(l));
    if (i >= 0) {
      log('choose', JSON.stringify(labels[i]), 'of', labels.join(' | '));
      await page.locator('.por-cmd:not([disabled])').nth(i).click();
      await page.waitForTimeout(400);
      return labels[i];
    }
    if (labels.some((l) => /^M?\s*More/i.test(l))) {
      await page.locator('.por-cmd:not([disabled])', { hasText: 'More' }).first().click();
      await page.waitForTimeout(250);
      continue;
    }
    await page.waitForTimeout(300);
  }
  const labels = await page.$$eval('.por-cmd', (els) => els.map((e) => e.textContent.trim()));
  throw new Error(`no command matching ${re} (have: ${labels.join(' | ')})`);
}

/** Combat: wait until it is a party member's turn and input is open, or the fight is over. */
const combatState = () => page.evaluate(() => {
  const s = window.__GAME.scenes;
  const sc = s.current;
  if (s.currentName !== 'combat') return { over: true, scene: s.currentName };
  if (document.querySelector('.por-dialog')) return { over: true, dialog: true };
  const c = sc.cur;
  const ready = !!c && c.side === 'party' && !sc.busy && sc.turnDone && !sc.quickAll;
  if (!ready) return { ready: false };
  const e = sc.engine;
  const foes = e.enemiesOf(c).filter((o) => !e.out(o));
  const near = foes.map((o) => ({ o, d: Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) })).sort((a, b) => a.d - b.d)[0];
  const cmds = Object.fromEntries((sc._cmdList ?? []).map((k) => [k.id, !k.disabled]));
  return { ready: true, name: c.name, mode: sc.mode, x: c.x, y: c.y, mp: c.mp, attacks: c.attacksLeft, spells: e.spellsOf(c).length, cmds, foe: near && { x: near.o.x, y: near.o.y, d: near.d }, valid: sc._validTargets ? null : null };
});

async function combatTurn(st) {
  // CAST once (the first caster with a spell), then AIM whenever a target is valid, else MOVE toward the foe.
  if (st.cmds.cast && !used.has('cast')) {
    await page.keyboard.press('c');
    await page.waitForTimeout(400);
    await page.keyboard.press('1'); // first memorized spell
    await page.waitForTimeout(400);
    const mode = await page.evaluate(() => window.__GAME.scenes.current.mode);
    if (mode === 'target') await page.keyboard.press('Enter');
    used.add('cast');
    log(`  ${st.name}: CAST`);
    return;
  }
  if (st.cmds.aim) {
    await page.keyboard.press('a');
    await page.waitForTimeout(300);
    const n = await page.evaluate(() => window.__GAME.scenes.current._validTargets?.().length ?? 0);
    if (n > 0) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      used.add('aim');
      log(`  ${st.name}: AIM (${n} targets)`);
      return;
    }
    await page.keyboard.press('Escape'); // back to move mode
    await page.waitForTimeout(200);
  }
  if (st.cmds.move && st.foe && st.foe.d > 1) {
    const mode = await page.evaluate(() => window.__GAME.scenes.current.mode);
    if (mode !== 'move') await page.keyboard.press('m');
    // step one square toward the nearest foe, by board direction (bypasses the camera-relative key mapping)
    const ok = await page.evaluate(({ foe, x, y }) => {
      const sc = window.__GAME.scenes.current;
      const dx = Math.sign(foe.x - x);
      const dy = Math.sign(foe.y - y);
      for (const [ax, ay] of [[dx, dy], [dx, 0], [0, dy]]) {
        if (!ax && !ay) continue;
        if (!sc.field.inBounds(x + ax, y + ay) || sc.engine.occupantAt(x + ax, y + ay)) continue;
        sc._dirInput(ax, ay);
        return true;
      }
      return false;
    }, st);
    if (ok) {
      used.add('move');
      log(`  ${st.name}: MOVE`);
      return;
    }
  }
  await page.keyboard.press('e'); // END
  log(`  ${st.name}: END`);
}

let ok = false;
try {
  // ------------------------------------------------------------ title → Quick Start
  await page.goto(`${srv.base}?seed=7`, { waitUntil: 'load' });
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('por.save.')) localStorage.removeItem(k); });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 90000 });
  await shot('title');
  await page.keyboard.press('Enter'); // title card → main menu
  await page.waitForTimeout(800);
  await shot('menu');
  await page.keyboard.press('q');
  await waitScene('explore');
  log('quick start at', JSON.stringify(await loc()));
  await shot('slums');

  // ------------------------------------------------------------ Slums → New Phlan → City Hall
  if (!skipTown) {
  await walk({ x: 0, y: 14 }, 'W');
  await waitScene('dialogue');
  await shot('gate');
  await choose(/Enter New Phlan/i);
  await waitScene('explore');
  log('in', JSON.stringify(await loc()));
  await walk({ x: 11, y: 4 });
  await page.waitForFunction(() => ['shop', 'dialogue'].includes(window.__GAME.scenes.currentName) && !window.__GAME.scenes.transitioning, null, { timeout: 90000 });
  await waitScene('dialogue');
  await page.waitForTimeout(800);
  await shot('cityhall');
  await choose(/Continue/i).catch(() => null);
  await choose(/Commissions/i);
  await page.waitForTimeout(600);
  await shot('commissions');
  await choose(/Leave/i);
  await waitScene('explore');
  log('left City Hall at', JSON.stringify(await loc()));

  // ------------------------------------------------------------ back to the Slums → first encounter
  await walk({ x: 15, y: 14 }, 'E');
  await waitScene('dialogue');
  await choose(/Pass the gate/i);
  await waitScene('explore');
  log('in', JSON.stringify(await loc()));
  }
  await walk({ encounter: true });
  await waitScene('dialogue');
  await page.waitForTimeout(600);
  await shot('encounter');
  await choose(/Combat|Fight|Refuse/i);
  await waitScene('combat');
  await shot('combat');

  // ------------------------------------------------------------ tactical combat by hand
  let turns = 0;
  for (let guard = 0; guard < 400; guard++) {
    const st = await combatState();
    if (st.over) break;
    if (!st.ready) { await page.waitForTimeout(250); continue; }
    if (turns === 6) await shot('combat_mid');
    if (turns >= 14 || (used.has('move') && used.has('aim') && used.has('cast') && turns >= 8)) {
      log('  handing the rest to QUICK');
      await page.keyboard.press('q');
      await page.waitForTimeout(500);
      continue;
    }
    await combatTurn(st);
    turns++;
    await page.waitForTimeout(400);
  }
  for (const k of ['move', 'aim', 'cast']) if (!used.has(k)) throw new Error(`combat never used ${k.toUpperCase()}`);
  await page.waitForSelector('.por-dialog', { timeout: 180000 });
  await shot('victory');
  await page.keyboard.press('Enter');
  await waitScene('explore');
  log('victory; back at', JSON.stringify(await loc()), 'party hp', await page.evaluate(() => window.__GAME.game.party.map((c) => JSON.stringify(c.hp)).join(' ')));

  // ------------------------------------------------------------ camp: rest and memorize
  await page.keyboard.press('k');
  await waitScene('camp');
  await page.waitForTimeout(800);
  await shot('camp');
  await page.keyboard.press('r');
  await page.waitForSelector('.camp-slot', { timeout: 30000 });
  await shot('rest_dialog');
  const restOpts = await page.$$eval('.camp-slot', (els) => els.map((e) => e.querySelector('div')?.textContent.trim()));
  log('rest options:', restOpts.join(' | '));
  const day0 = await page.evaluate(() => window.__GAME.game.time ?? window.__GAME.game.minutes ?? null);
  await page.click('.camp-slot'); // the first option: until spells are memorized (or sleep the night)
  await page.waitForFunction(() => !window.__GAME.scenes.current.busy, null, { timeout: 240000, polling: 250 });
  await page.waitForTimeout(800);
  await shot('rested');
  const logText = await page.evaluate(() => document.querySelector('#ui-root')?.innerText ?? '');
  const memo = (logText.match(/[^\n]*memorizes[^\n]*/g) ?? []).slice(-3);
  log('rested:', memo.join(' / ') || '(no memorize lines)');
  if (restOpts[0]?.startsWith('Until spells') && !memo.length) throw new Error('resting did not memorize spells');
  void day0;
  await page.keyboard.press('e');
  await page.locator('.por-dialog button', { hasText: 'Break camp' }).click({ timeout: 30000 });
  await waitScene('explore');

  // ------------------------------------------------------------ automap
  await page.keyboard.press('m');
  await page.waitForFunction(() => window.__GAME.scenes.currentName === 'automap' || window.__GAME.scenes.stack?.some?.((s) => s.name === 'automap'), null, { timeout: 90000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await shot('automap');
  log('automap open:', await sceneName());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  await waitScene('explore');

  // ------------------------------------------------------------ pause menu: save, then load
  await page.keyboard.press('F10');
  await page.waitForSelector('.por-pause-item[data-id="save"]', { timeout: 30000 });
  await shot('pause');
  await page.click('.por-pause-item[data-id="save"]');
  await page.click('.por-load-row[data-id="A"]');
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => window.__GAME.saves.list().map((s) => s.slot));
  log('saved slots:', saved.join(','));
  if (!saved.includes('A')) throw new Error('slot A was not written');
  const before = await loc();
  if ((await page.$('.por-pause-item')) === null) await page.keyboard.press('F10');
  // walk away so the load is observable
  if (await page.$('.por-pause-item')) await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown');
  await idle();
  await page.keyboard.press('F10');
  await page.waitForSelector('.por-pause-item[data-id="load"]', { timeout: 30000 });
  await page.click('.por-pause-item[data-id="load"]');
  await page.click('.por-load-row[data-id="A"]');
  await page.click('.por-pause-confirm button[data-id="yes"]');
  await page.waitForTimeout(500);
  await waitScene('explore');
  const after = await loc();
  log('loaded: was', JSON.stringify(before), 'now', JSON.stringify(after));
  if (before.x !== after.x || before.y !== after.y || before.map !== after.map) throw new Error('load did not restore the saved position');
  await shot('loaded');
  ok = errors.length === 0;
} catch (err) {
  console.error('[play] step failed:', err.message, 'scene =', await sceneName().catch(() => '?'));
  await page.screenshot({ path: 'shots/play_fail.png' }).catch(() => null);
} finally {
  for (const e of errors) console.error('[error]', e);
  await browser.close();
  await srv.close();
}
console.log(ok ? 'PLAYTHROUGH OK' : 'PLAYTHROUGH FAIL');
process.exit(ok ? 0 : 1);
