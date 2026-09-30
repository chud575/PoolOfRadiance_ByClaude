import './ui/styles/ui.css';
import { EventBus } from './core/EventBus.js';
import { Clock } from './core/Clock.js';
import { GameLoop } from './core/GameLoop.js';
import { SceneManager } from './core/SceneManager.js';
import { InputManager } from './core/InputManager.js';
import { Settings } from './core/Settings.js';
import { SaveManager } from './core/SaveManager.js';
import { GameState } from './core/GameState.js';
import { parseDebugParams, sceneParamsFromRaw } from './core/debug.js';
import { RenderContext } from './render/RenderContext.js';
import { UI } from './ui/UI.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Rng } from './rules/dice.js';
import { buildParty } from './rules/party.js';

window.__READY = false;
window.__ERRORS = [];
window.addEventListener('error', (e) => window.__ERRORS.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => window.__ERRORS.push(String(e.reason?.stack || e.reason)));

async function boot() {
  const debug = parseDebugParams(location.search);
  const bus = new EventBus();
  const clock = new Clock({ frozen: debug.frozen, t: debug.t });
  const settings = new Settings(bus);
  const rng = new Rng(debug.seed);
  const saves = new SaveManager(bus, debug.nosave ? null : undefined);
  const game = new GameState(bus);
  const render = new RenderContext(document.getElementById('gl'), settings, { preserveDrawingBuffer: debug.active, clock });
  const ui = new UI(document.getElementById('ui-root'), bus, { visible: debug.ui });
  const audio = new AudioEngine(settings, bus, { muted: debug.active });
  const input = new InputManager(bus, settings);

  /** @type {import('./core/context.js').GameContext} */
  const ctx = { bus, clock, settings, rng, saves, game, render, ui, audio, input, debug, scenes: null };
  ctx.scenes = new SceneManager(ctx);
  window.__GAME = ctx; // for scripts/devtools only — never read this from game code

  if (debug.classic) render.setClassic(true);
  if (debug.party && debug.party !== 'none') game.setParty(buildParty(debug.party, debug.seed));
  if (debug.raw.hour !== undefined) game.minutes = Number(debug.raw.hour) * 60;

  // Global hotkeys.
  bus.on('input:action', ({ action }) => {
    if (action === 'toggleClassic') {
      settings.set('classicMode', !render.classic);
      render.setClassic(!render.classic);
      ui.toast(render.classic ? 'Classic mode (1988)' : 'Modern mode');
    } else if (action === 'quicksave' && game.party.length) {
      saves.save('A', game);
      ui.toast('Game saved');
    } else if (action === 'quickload') {
      const s = saves.load('A');
      if (s) {
        game.loadJSON(s);
        ctx.scenes.goto('explore', {});
      }
    }
  });
  bus.on('location:changed', () => {
    if (settings.get('autosave') && !debug.nosave) saves.autosave(game);
  });

  const loop = new GameLoop(
    clock,
    (dt) => {
      input.poll();
      ctx.scenes.update(dt);
      input.endFrame();
    },
    () => ctx.scenes.render(),
  );

  window.addEventListener('resize', () => {
    render.setSize(window.innerWidth, window.innerHeight);
    ctx.scenes.resize(window.innerWidth, window.innerHeight);
  });

  loop.start();
  const sceneName = debug.scene ?? 'title';
  await ctx.scenes.goto(sceneName, sceneParamsFromRaw(debug.raw));
  await loop.afterFrames(3);
  window.__READY = true;
  bus.emit('app:ready', { scene: sceneName });
}

boot().catch((err) => {
  console.error('[boot] failed', err);
  window.__ERRORS.push(String(err?.stack || err));
  window.__READY = true; // let shot tools finish and report the error
});
