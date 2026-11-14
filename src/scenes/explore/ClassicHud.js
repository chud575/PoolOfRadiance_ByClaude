import './classicHud.css';
import { h, clear } from '../../ui/dom.js';
import { MessageLog } from '../../ui/components/MessageLog.js';
import { portraitImg } from '../../ui/components/lazyPortrait.js';
import { deriveStats } from '../../rules/character.js';

/**
 * The 1988-mode exploration screen: one wood-framed 4:3 board holding the picture window and
 * location plate (left), the party list with portraits and the day/time (right), the message
 * box, and a row of six picture buttons. Everything is drawn in CSS and code.
 *
 * Offers what ExploreScene uses of the standard HUD (roster.refresh, compass.set, setLocation,
 * dispose) plus `viewEl`, the window ClassicView mounts its picture in.
 *
 * @param {import('../../core/context.js').GameContext} ctx
 * @param {{commands: Array<{id:string,label:string,tip?:string,onSelect:Function}>, onOpen?: (i:number)=>void}} o
 */
export function createClassicHud(ctx, o) {
  const viewEl = h('div.por-ch-view');
  const locName = h('div.por-ch-locname', ['']);
  const compassLetter = h('span.por-ch-compass-dir', ['N']);
  const compass = h('div.por-ch-compass', [compassLetter, h('i.por-ch-star')]);
  const clockEl = h('div.por-ch-clock', ['']);
  const rosterEl = h('div.por-ch-roster');
  const log = new MessageLog(ctx.bus, { lines: 2 });

  const refresh = () => {
    const { party, activeIndex } = ctx.game;
    clear(rosterEl);
    rosterEl.append(h('div.por-ch-rhead', [h('span'), h('span.n', ['Name']), h('span.ac', ['AC']), h('span.hp', ['HP'])]));
    party.forEach((ch, i) => {
      const s = deriveStats(ch);
      const low = ch.status !== 'ok' || ch.hp.cur / Math.max(1, ch.hp.max) < 0.34;
      rosterEl.append(h(`div.por-ch-row${i === activeIndex ? '.active' : ''}${low ? '.low' : ''}`, {
        dataset: { tip: `${ch.name} — ${s.className} ${s.levels}` },
        onclick: () => { ctx.game.activeIndex = i; ctx.game.notifyPartyChanged(); },
        ondblclick: () => o.onOpen?.(i),
      }, [
        h('span.face', [portraitImg(ch, 0.28, { alt: ch.name })]),
        h('span.n', [ch.name]),
        h('span.ac', [String(s.ac)]),
        h('span.hp', [`${ch.hp.cur}/${ch.hp.max}`]),
      ]));
    });
  };
  const offParty = ctx.bus.on('party:changed', refresh);
  refresh();

  const buttons = h('div.por-ch-buttons', (o.commands ?? []).map((c) => h('button.por-ch-btn', {
    type: 'button', dataset: { tip: c.tip ?? '', cmd: c.id }, onclick: (e) => { e.currentTarget.blur(); c.onSelect?.(c); },
  }, [iconCanvas(c.id), h('span', [c.label])])));

  const stud = () => h('i.por-ch-stud');
  const panel = (cls, kids) => h(`div.por-ch-panel.${cls}`, [...kids, stud(), stud(), stud(), stud()]);
  const root = h('div.por-ch', [h('div.por-ch-screen', [h('div.por-ch-in', [
    h('div.por-ch-title', [h('span', ['Pool of Radiance'])]),
    h('div.por-ch-top', [
      h('div.por-ch-left', [
        panel('por-ch-viewwrap', [viewEl]),
        h('div.por-ch-loc', [locName, compass]),
      ]),
      panel('por-ch-right', [rosterEl, clockEl]),
    ]),
    h('div.por-ch-msg', [log.el]),
    buttons,
    stud(), stud(), stud(), stud(),
  ])])]);
  ctx.ui.mount(root);

  return {
    root,
    viewEl,
    log,
    roster: { refresh },
    compass: {
      /** @param {number} yaw three.js yaw (0 = north, -PI/2 = east) */
      set(yaw) {
        compassLetter.textContent = 'NESW'[((Math.round(-yaw / (Math.PI / 2)) % 4) + 4) % 4];
      },
    },
    setLocation(name, sub) {
      locName.textContent = name;
      const m = /Day (\d+), (\d\d:\d\d)/.exec(sub ?? '');
      if (m) clockEl.textContent = `Day ${m[1]}  ${m[2]}`;
    },
    dispose() {
      offParty?.();
      log.dispose();
      root.remove();
    },
  };
}

// ---------------------------------------------------------------- button pictures
// Each is drawn as vector shapes, then sampled onto a small canvas so it shows as chunky pixels.
const W = 44;
const H = 34;
const ICONS = {
  move: `
    <g stroke="#2a1608" stroke-width="1.6" stroke-linejoin="round">
      <path d="M7 6h9v14l8 5v5H7z" fill="#a8672c"/><path d="M7 6h9v5H7z" fill="#c98a45"/><path d="M7 27h17v3H7z" fill="#4a2a12"/>
      <path d="M22 3h9v14l8 5v5H22z" fill="#b87634"/><path d="M22 3h9v5h-9z" fill="#d79a52"/><path d="M22 24h17v3H22z" fill="#4a2a12"/>
    </g>`,
  look: `
    <path d="M3 17C12 5 32 5 41 17C32 29 12 29 3 17z" fill="#f4ead2" stroke="#b9801f" stroke-width="2.4"/>
    <circle cx="22" cy="17" r="8.5" fill="#2f7fd6" stroke="#123a78" stroke-width="1.6"/><circle cx="22" cy="17" r="3.8" fill="#0a1020"/>
    <circle cx="19" cy="14" r="1.8" fill="#fff"/><path d="M3 17C12 5 32 5 41 17" fill="none" stroke="#6b3d0c" stroke-width="1.6"/>`,
  talk: `
    <g stroke="#5a3a12" stroke-width="1.6" stroke-linejoin="round">
      <path d="M9 4h26v24H9z" fill="#f0d9a0"/><path d="M5 4a4 4 0 0 1 8 0v4H5z" fill="#d9b973"/><path d="M31 28a4 4 0 0 0 8 0v-3h-8z" fill="#d9b973"/>
    </g>
    <path d="M14 11h16M14 16h16M14 21h11" stroke="#3a2408" stroke-width="2"/>`,
  camp: `
    <path d="M22 2c7 8 10 12 8 19-1 5-5 7-8 7s-8-2-9-7c-1-5 3-7 4-12 2 3 3 4 5-7z" fill="#e8441c" stroke="#7a1a08" stroke-width="1.4"/>
    <path d="M22 11c4 5 5 8 4 11-1 3-2 4-4 4s-4-1-5-4c0-3 3-4 5-11z" fill="#ffc21f"/><path d="M22 18c2 3 2 5 0 7-2-2-2-4 0-7z" fill="#fff3b0"/>
    <g fill="#9aa0a8" stroke="#3a3d44" stroke-width="1.4"><ellipse cx="9" cy="29" rx="5" ry="3.4"/><ellipse cx="19" cy="30.5" rx="5" ry="3"/><ellipse cx="29" cy="30.5" rx="5" ry="3"/><ellipse cx="37" cy="29" rx="4.5" ry="3.2"/></g>`,
  magic: `
    <g stroke="#1e0f3a" stroke-width="1.6" stroke-linejoin="round">
      <path d="M6 9l22-5 10 4v19l-22 5-10-4z" fill="#6a3fb0"/><path d="M6 9l10 4v19l-10-4z" fill="#3f2372"/><path d="M16 13l22-5v19l-22 5z" fill="#7d4fc8"/>
    </g>
    <path d="M27 11l1.6 5 5 1-4.4 2.6 1 5.4-3.6-3.6-4.6 2.4 2.2-4.8-3.6-3.6 5.2 0.4z" fill="#ffd54a" stroke="#8a5a08" stroke-width="0.8"/>
    <path d="M7 27l9 3.6" stroke="#f0e6c8" stroke-width="1.6"/>`,
  journal: `
    <path d="M38 2C28 4 20 10 15 22l4 1C27 18 34 12 38 2z" fill="#f6f6f2" stroke="#6a7078" stroke-width="1.4"/>
    <path d="M36 4C28 9 22 15 16 23" stroke="#9aa0a8" stroke-width="1.2" fill="none"/><path d="M17 22l-3 6" stroke="#3a2408" stroke-width="1.8"/>
    <g stroke="#0b2a5a" stroke-width="1.6"><path d="M7 22h14v9H7z" fill="#2f7fd6"/><path d="M9 18h10v4H9z" fill="#1d5aa8"/></g><path d="M9 24h4v5H9z" fill="#7fb8f0"/>`,
};

function iconCanvas(id) {
  const c = h('canvas.por-ch-icon', { width: W, height: H });
  const src = ICONS[id];
  if (!src) return c;
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, W, H);
  };
  img.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">${src}</svg>`)}`;
  return c;
}
