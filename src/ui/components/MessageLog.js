import { h } from '../dom.js';

/**
 * Scrolling message log. Listens to bus 'message' events: {text, kind?}
 * kind: 'info' | 'combat' | 'loot' | 'warn' | 'lore' | 'system'.
 */
export class MessageLog {
  constructor(bus, { max = 60, lines = 4 } = {}) {
    this.el = h('div.por-log', { style: { '--lines': lines } });
    this.max = max;
    this.off = bus.on('message', (m) => this.push(typeof m === 'string' ? { text: m } : m));
  }

  push({ text, kind = 'info' }) {
    const line = h(`div.por-log-line.por-log--${kind}`, [text]);
    this.el.append(line);
    while (this.el.children.length > this.max) this.el.firstChild.remove();
    this.el.scrollTop = this.el.scrollHeight;
  }

  dispose() {
    this.off();
    this.el.remove();
  }
}
