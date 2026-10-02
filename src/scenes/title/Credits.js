import { h } from '../../ui/UI.js';

/** Credits text (plain data; the crawl renders it). */
const CREDITS = [
  ['s', 'A modern homage'],
  ['gap'],
  ['r', 'In memory of the original', 'Pool of Radiance (1988)\nStrategic Simulations, Inc. · TSR, Inc.'],
  ['r', 'The Gold Box engine', 'Designed and programmed by the SSI Special Projects Group'],
  ['r', 'The Forgotten Realms', 'Created by Ed Greenwood'],
  ['gap'],
  ['h2', 'This homage'],
  ['r', 'Direction, design, code & art', 'Claude'],
  ['r', 'Rules engine', 'AD&D 1st Edition, implemented from the books'],
  ['r', 'Graphics', 'Three.js — every texture, model and glyph generated procedurally'],
  ['r', 'Sound', 'WebAudio synthesis — no recorded samples'],
  ['r', 'Typography', 'Your system’s finest serif, gilded in a shader'],
  ['gap'],
  ['h2', 'With thanks'],
  ['p', 'To everyone who mapped the Slums on graph paper, argued over who carries the wand, and saved before opening every door.'],
  ['gap'],
  ['p', 'This is a non-commercial fan tribute. Advanced Dungeons & Dragons, Forgotten Realms and Pool of Radiance are trademarks of their respective owners; no affiliation is claimed.'],
  ['gap'],
  ['s', 'The Council of Phlan thanks you for your service.'],
];

/**
 * Slow credits crawl on an illuminated parchment plate over the dusk (the
 * scene stays visible around it). Scroll position is a pure function of clock
 * time (deterministic under a frozen clock); the plate's mask fades lines in
 * and out inside the parchment, never into the void.
 */
export class Credits {
  constructor(ctx, { onClose, t0 = 0 }) {
    this.ctx = ctx;
    this.onClose = onClose;
    this.t0 = t0;
    this.crawl = h('div.por-credits-crawl', CREDITS.map(([k, a, b]) => {
      if (k === 'h') return h('h1.por-credits-h', [a]);
      if (k === 'h2') return h('h2.por-credits-h2', [h('span', [a])]);
      if (k === 's') return h('div.por-credits-s', [a]);
      if (k === 'p') return h('p.por-credits-p', [a]);
      if (k === 'gap') return h('div.por-credits-gap', [h('i')]);
      return h('div.por-credits-role', [h('div.role', [a]), h('div.name', String(b).split('\n').map((l) => h('div', [l])))]);
    }));
    // Back lives in the footer legend (Esc / B / click anywhere), docked to the grid.
    this.window = h('div.por-credits-window', [this.crawl]);
    this.el = h('div.por-credits', { onclick: () => this.onClose() }, [
      h('div.por-credits-plate.por-frame.por-frame--parchment', [
        h('i.por-corner.tl'), h('i.por-corner.tr'), h('i.por-corner.bl'), h('i.por-corner.br'),
        h('div.por-frame-title', ['Credits']),
        this.window,
      ]),
    ]);
  }

  update(t) {
    // open with the first block already risen clear of the top fade, fully
    // legible, then crawl; the loop wraps back to the same opening frame
    const win = this.window.offsetHeight || 500;
    const pad = parseFloat(getComputedStyle(this.crawl).paddingTop) || 0;
    const start = Math.max(0, pad - win * 0.2);
    const H = this.crawl.offsetHeight + win;
    const y = start + Math.max(0, t - this.t0 - 1.5) * 34;
    this.crawl.style.transform = `translateY(${-(y % H)}px)`;
  }

  dispose() {
    this.el.remove();
  }
}
