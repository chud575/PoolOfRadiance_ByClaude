import { h } from './dom.js';
import { Frame } from './components/Frame.js';
import { PartyRoster } from './components/PartyRoster.js';
import { MessageLog } from './components/MessageLog.js';
import { CommandBar } from './components/CommandBar.js';

/**
 * The standard exploration HUD: location header (top-left), compass,
 * party roster (right), message log + command bar (bottom).
 * A modern reading of the Gold Box screen layout.
 *
 * @param {import('../core/context.js').GameContext} ctx
 * @param {{commands: Array, logLines?: number, title?: string}} o
 */
export function createStandardHud(ctx, o) {
  const root = h('div.por-hud');
  const locName = h('div.name.por-gilt-text', ['']);
  const locSub = h('div.sub', ['']);
  const compass = createCompass();
  const top = h('div.por-hud-top', [h('div.por-location', [locName, locSub]), h('div', { style: { marginRight: '19em' } }, [compass.el])]);
  const roster = new PartyRoster(ctx);
  const rosterFrame = Frame({ title: 'Party', variant: 'blue', className: 'por-hud-right', children: [roster.el] });
  const log = new MessageLog(ctx.bus, { lines: o.logLines ?? 4 });
  const bar = new CommandBar(o.commands ?? [], { title: o.title ?? '' });
  const bottom = h('div.por-hud-bottom', [h('div.por-log-wrap', [log.el]), bar.el]);
  root.append(top, rosterFrame.el, bottom);
  ctx.ui.mount(root);
  return {
    root,
    roster,
    log,
    bar,
    compass,
    setLocation(name, sub) {
      locName.textContent = name;
      locSub.textContent = sub;
    },
    dispose() {
      roster.dispose();
      log.dispose();
      bar.dispose();
      root.remove();
    },
  };
}

/** SVG compass rose; set(dirOrYaw) rotates it. */
export function createCompass() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.classList.add('por-compass');
  svg.innerHTML = `
    <defs>
      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe7a8"/><stop offset="0.5" stop-color="#d8b25a"/><stop offset="1" stop-color="#8a6a2a"/></linearGradient>
      <radialGradient id="cb"><stop offset="0" stop-color="#1f3a7a"/><stop offset="1" stop-color="#0b1026"/></radialGradient>
    </defs>
    <circle r="46" fill="url(#cb)" stroke="url(#cg)" stroke-width="3"/>
    <circle r="40" fill="none" stroke="#8a6a2a" stroke-width="0.8" stroke-dasharray="2 3"/>
    <g class="rose">
      <path d="M0,-36 L7,0 L0,6 L-7,0 Z" fill="url(#cg)" stroke="#000" stroke-width="0.8"/>
      <path d="M0,36 L7,0 L0,-6 L-7,0 Z" fill="#2b3a66" stroke="#000" stroke-width="0.8"/>
      <text y="-24" text-anchor="middle" font-size="11" font-family="Georgia,serif" fill="#1b1206" font-weight="bold">N</text>
    </g>
    <path d="M0,-49 L4,-42 L-4,-42 Z" fill="#ffc861"/>`;
  const rose = svg.querySelector('.rose');
  return {
    el: svg,
    /** @param {number} yaw radians (three.js yaw: 0 = facing north) */
    set(yaw) {
      rose.setAttribute('transform', `rotate(${(yaw * 180) / Math.PI})`);
    },
  };
}
