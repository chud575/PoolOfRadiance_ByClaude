import { h } from './dom.js';
import { Frame } from './components/Frame.js';
import { PartyRoster } from './components/PartyRoster.js';
import { MessageLog } from './components/MessageLog.js';
import { CommandBar } from './components/CommandBar.js';
import { bindSkin } from './styles/skin.js';

/**
 * The standard exploration HUD: location header (top-left), compass,
 * party roster (right), message log + command bar (bottom).
 * A modern reading of the Gold Box screen layout.
 *
 * @param {import('../core/context.js').GameContext} ctx
 * @param {{commands: Array, logLines?: number, title?: string}} o
 */
export function createStandardHud(ctx, o) {
  bindSkin(ctx);
  const root = h('div.por-hud');
  const locName = h('div.name.por-gilt-text', ['']);
  const locSub = h('div.sub', ['']);
  // the Gold Box status line ("7,11 N 10:00 SEARCH OFF") on a gilt plate
  const st = { xy: h('span.v'), dir: h('span.v'), time: h('span.v'), day: h('span.v'), search: h('span.v') };
  const seg = (label, v) => h('span.por-status-seg', [label ? h('span.k', [label]) : null, v]);
  const status = h('div.por-hud-status', { dataset: { tip: 'Position · facing · day and hour · search mode' } }, [
    seg('', st.xy), h('i.sep'), seg('', st.dir), h('i.sep'), seg('Day', st.day), seg('', st.time), h('i.sep'), seg('Search', st.search),
  ]);
  const compass = createCompass();
  const top = h('div.por-hud-top', [h('div.por-location', [locName, status, locSub]), h('div', { style: { marginRight: '19em' } }, [compass.el])]);
  let lastSub = '';
  const renderStatus = () => {
    const g = ctx.game;
    const m = /^(\d+),(\d+) · facing (\w+) · Day (\d+), (\d\d:\d\d)/.exec(lastSub);
    const c = g?.clock ?? { day: 1, hour: 0, minute: 0 };
    const x = m ? m[1] : g?.location?.x ?? 0;
    const y = m ? m[2] : g?.location?.y ?? 0;
    const dir = m ? m[3][0] : g?.location?.dir ?? 'N';
    st.xy.textContent = `${x},${y}`;
    st.dir.textContent = dir;
    st.day.textContent = m ? m[4] : String(c.day);
    st.time.textContent = m ? m[5] : `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
    const on = !!(g?.searchMode ?? g?.flags?.searchMode);
    st.search.textContent = on ? 'On' : 'Off';
    st.search.classList.toggle('on', on);
    locSub.textContent = m ? '' : lastSub;
    locSub.hidden = !!m || !lastSub;
  };
  const offs = ['location:changed', 'time:changed', 'search:changed'].map((e) => ctx.bus.on(e, () => renderStatus()));
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
    status,
    setLocation(name, sub) {
      locName.textContent = name;
      lastSub = sub ?? '';
      renderStatus();
    },
    dispose() {
      offs.forEach((off) => off?.());
      roster.dispose();
      log.dispose();
      bar.dispose();
      root.remove();
    },
  };
}

/**
 * SVG compass: gilt bezel with degree ticks, fixed lubber mark at the top,
 * and a rotating card (N/E/S/W, star rose). set(yaw) rotates the card so the
 * direction the party faces is always under the lubber mark.
 */
export function createCompass() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.classList.add('por-compass');
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const major = i % 18 === 0;
    const mid = i % 9 === 0;
    const r0 = major ? 33 : mid ? 35.5 : 37.5;
    ticks += `<line x1="${(Math.sin(a) * r0).toFixed(2)}" y1="${(-Math.cos(a) * r0).toFixed(2)}" x2="${(Math.sin(a) * 40).toFixed(2)}" y2="${(-Math.cos(a) * 40).toFixed(2)}" stroke="${major ? '#f5d98b' : '#b89548'}" stroke-width="${major ? 1.4 : 0.7}"/>`;
  }
  const letter = (t, a, big) => {
    const x = Math.sin(a) * 25, y = -Math.cos(a) * 25;
    return `<text x="${x.toFixed(2)}" y="${(y + (big ? 4.2 : 3.2)).toFixed(2)}" text-anchor="middle" font-size="${big ? 12 : 9}" font-family="Cinzel,'Palatino Linotype',Palatino,FreeSerif,Georgia,serif" font-weight="700" fill="${big ? '#ffe7a8' : '#d8c08a'}" stroke="#0b0a14" stroke-width="0.5" paint-order="stroke">${t}</text>`;
  };
  svg.innerHTML = `
    <defs>
      <linearGradient id="cg" x1="0" y1="-50" x2="0" y2="50" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff0c2"/><stop offset="0.35" stop-color="#e2bb62"/><stop offset="0.62" stop-color="#8a6a2a"/><stop offset="1" stop-color="#e9ca7c"/></linearGradient>
      <radialGradient id="cb" cx="0" cy="-8" r="48" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#27438a"/><stop offset="0.7" stop-color="#111c42"/><stop offset="1" stop-color="#070b1c"/></radialGradient>
    </defs>
    <circle r="47" fill="#05060d"/>
    <circle r="45.5" fill="none" stroke="url(#cg)" stroke-width="4"/>
    <circle r="42.6" fill="url(#cb)" stroke="#000" stroke-width="0.8"/>
    <g class="rose">
      ${ticks}
      <path d="M0,-30 L4.2,-4.2 L30,0 L4.2,4.2 L0,30 L-4.2,4.2 L-30,0 L-4.2,-4.2 Z" fill="rgba(216,178,90,0.16)" stroke="#8a6a2a" stroke-width="0.6"/>
      <path d="M0,-19 L5,0 L0,4 L-5,0 Z" fill="url(#cg)" stroke="#1b1206" stroke-width="0.7"/>
      <path d="M0,19 L5,0 L0,-4 L-5,0 Z" fill="#2b3a66" stroke="#0b0a14" stroke-width="0.7"/>
      <circle r="2.2" fill="#8ff0ff" stroke="#1b1206" stroke-width="0.6"/>
      ${letter('N', 0, true)}${letter('E', Math.PI / 2)}${letter('S', Math.PI)}${letter('W', -Math.PI / 2)}
    </g>
    <path d="M0,-41 L4.2,-49 L-4.2,-49 Z" fill="#ffc861" stroke="#1b1206" stroke-width="0.8"/>`;
  const rose = svg.querySelector('.rose');
  return {
    el: svg,
    /** @param {number} yaw radians (three.js yaw: 0 = facing north) */
    set(yaw) {
      rose.setAttribute('transform', `rotate(${(yaw * 180) / Math.PI})`);
    },
  };
}
