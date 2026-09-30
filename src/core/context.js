/**
 * @typedef {Object} GameContext  The single object handed to every scene.
 * @property {import('./EventBus.js').EventBus} bus
 * @property {import('./Clock.js').Clock} clock
 * @property {import('./InputManager.js').InputManager} input
 * @property {import('./Settings.js').Settings} settings
 * @property {import('./SaveManager.js').SaveManager} saves
 * @property {import('./GameState.js').GameState} game
 * @property {import('./SceneManager.js').SceneManager} scenes
 * @property {import('../render/RenderContext.js').RenderContext} render
 * @property {import('../ui/UI.js').UI} ui
 * @property {import('../audio/AudioEngine.js').AudioEngine} audio
 * @property {import('../rules/dice.js').Rng} rng   Seeded RNG (from ?seed=).
 * @property {import('./debug.js').DebugParams} debug
 */
export {};
