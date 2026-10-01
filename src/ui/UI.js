import { h, clear } from './dom.js';
import { Tooltip } from './components/Tooltip.js';
import { showDialog } from './components/Dialog.js';
import { toast } from './components/Toast.js';

export { h, clear, hotkeyLabel } from './dom.js';
export { Frame } from './components/Frame.js';
export { CommandBar, KeyLegend } from './components/CommandBar.js';
export { MessageLog } from './components/MessageLog.js';
export { PartyRoster } from './components/PartyRoster.js';
export { Menu } from './components/Menu.js';

/**
 * HTML overlay UI root. Layers (bottom→top):
 *   scene   – owned by the active scene; cleared automatically on scene change
 *   hud     – persistent chrome (rarely used; scenes prefer `scene`)
 *   modal   – dialogs
 *   toast   – notifications
 *   tooltip – hover tips
 */
export class UI {
  /** @param {HTMLElement} root @param {import('../core/EventBus.js').EventBus} bus */
  constructor(root, bus, { visible = true } = {}) {
    this.root = root;
    this.bus = bus;
    root.classList.add('por-ui');
    if (!visible) root.style.display = 'none';
    this.layers = {
      scene: h('div.por-layer.por-layer-scene'),
      hud: h('div.por-layer.por-layer-hud'),
      modal: h('div.por-layer.por-layer-modal'),
      toast: h('div.por-layer.por-layer-toast'),
      tooltip: h('div.por-layer.por-layer-tooltip'),
    };
    root.append(...Object.values(this.layers));
    this.tooltip = new Tooltip(this.layers.tooltip);
  }

  /** Remove everything scene-owned (called by SceneManager.goto). */
  resetScene() {
    clear(this.layers.scene);
    clear(this.layers.modal);
  }

  /** Append an element to the scene layer; returns it. */
  mount(el) {
    this.layers.scene.append(el);
    return el;
  }

  dialog(opts) {
    return showDialog(this, opts);
  }

  toast(text, opts) {
    return toast(this, text, opts);
  }

  /** Convenience: post a message to the log (MessageLog listens on the bus). */
  message(text, kind = 'info') {
    this.bus.emit('message', { text, kind });
  }
}
