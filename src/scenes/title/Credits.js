import { h } from '../../ui/UI.js';

/** Credits text (plain data; the crawl renders it). */
const CREDITS = [
  [
    ['s', 'A modern homage'],
    ['gap'],
    ['r', 'In memory of the original', 'Pool of Radiance (1988)\nStrategic Simulations, Inc. · TSR, Inc.'],
    ['r', 'The Gold Box engine', 'Designed and programmed by the SSI Special Projects Group'],
    ['r', 'The Forgotten Realms', 'Created by Ed Greenwood'],
  ],
  [
    ['h2', 'This homage'],
    ['r', 'Direction, design, code & art', 'Claude'],
    ['r', 'Rules engine', 'AD&D 1st Edition, implemented from the books'],
    ['r', 'Graphics', 'Three.js — every texture, model and glyph generated procedurally'],
    ['r', 'Sound', 'WebAudio synthesis — no recorded samples'],
    ['r', 'Typography', 'A broad-nib book hand, written in code and gilded in a shader'],
  ],
  [
    ['h2', 'With thanks'],
    ['p', 'To everyone who mapped the Slums on graph paper, argued over who carries the wand, and saved before opening every door.'],
    ['gap'],
    ['p', 'This is a non-commercial fan tribute. Advanced Dungeons & Dragons, Forgotten Realms and Pool of Radiance are trademarks of their respective owners; no affiliation is claimed.'],
    ['gap'],
    ['s', 'The Council of Phlan thanks you for your service.'],
  ],
];
/** Seconds each leaf of the credits holds, and its cross-fade. */
const PAGE = 8;
const FADE = 1.1;

/**
 * Credits on an illuminated vellum leaf over the dusk (the scene stays visible
 * around it): three pages, each set as a block centred on the leaf, that
 * cross-fade with a slow drift upward — a settled still always shows one
 * whole, balanced page, never a line half lost against the torn edge. Pure
 * function of clock time (deterministic under a frozen clock).
 */
export class Credits {
  constructor(ctx, { onClose, t0 = 0 }) {
    this.ctx = ctx;
    this.onClose = onClose;
    this.t0 = t0;
    const line = ([k, a, b]) => {
      if (k === 'h') return h('h1.por-credits-h', [a]);
      if (k === 'h2') return h('h2.por-credits-h2', [h('span', [a])]);
      if (k === 's') return h('div.por-credits-s', [a]);
      if (k === 'p') return h('p.por-credits-p', [a]);
      if (k === 'gap') return h('div.por-credits-gap', [h('i')]);
      return h('div.por-credits-role', [h('div.role', [a]), h('div.name', String(b).split('\n').map((l) => h('div', [l])))]);
    };
    this.pages = CREDITS.map((pg) => h('div.por-credits-page', pg.map(line)));
    this.crawl = h('div.por-credits-crawl', this.pages);
    this.dots = CREDITS.map(() => h('i'));
    // Back lives in the footer legend (Esc / B / click anywhere), docked to the grid.
    this.window = h('div.por-credits-window', [this.crawl, h('div.por-credits-dots', this.dots)]);
    // a deckled vellum leaf laid in a gilt-framed leather folio: its torn edge
    // (fibres and all) is a mask generated at the leaf's real pixel size, and
    // it casts a soft shadow onto the leather (the shadow lives on a wrapper:
    // a filter on the masked element itself would be clipped by its mask)
    this.sheet = h('div.por-credits-sheet', [h('div.por-credits-sheet-tone'), this.window]);
    this.el = h('div.por-credits', { onclick: () => this.onClose() }, [
      h('div.por-credits-plate.por-frame', [
        h('i.por-corner.tl'), h('i.por-corner.tr'), h('i.por-corner.bl'), h('i.por-corner.br'),
        h('div.por-frame-title', ['Credits']),
        h('div.por-credits-shadow', [this.sheet]),
      ]),
    ]);
    this._maskKey = '';
  }

  /** Deckle mask: an opaque leaf with a ragged torn outline and loose fibres standing out of it. */
  _deckle(w, hgt) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const g = c.getContext('2d');
    let seed = 1988;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n1 = (x, f, ph) => Math.sin(x * f + ph) * 0.5 + Math.sin(x * f * 2.3 + ph * 1.7) * 0.3 + Math.sin(x * f * 5.1 + ph * 0.3) * 0.2;
    const amp = { t: 9, b: 11, l: 4, r: 4 };
    const inset = 14;
    const edge = (len, a, ph) => Array.from({ length: Math.ceil(len / 3) + 1 }, (_, i) => {
      const x = i * 3;
      return inset - a * 0.5 + n1(x, 0.021, ph) * a * 0.6 + n1(x, 0.11, ph + 2) * a * 0.3 + (rnd() - 0.5) * a * 0.25;
    });
    const top = edge(w, amp.t, 0.3), bot = edge(w, amp.b, 4.1), lef = edge(hgt, amp.l, 1.7), rig = edge(hgt, amp.r, 7.3);
    g.fillStyle = '#fff';
    g.beginPath();
    top.forEach((d, i) => (i ? g.lineTo(i * 3, d) : g.moveTo(0, d)));
    rig.forEach((d, i) => g.lineTo(w - d, i * 3));
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(i * 3, hgt - bot[i]);
    for (let i = lef.length - 1; i >= 0; i--) g.lineTo(lef[i], i * 3);
    g.closePath();
    g.fill();
    // loose fibres: fine hairs standing out of the torn edge, thicker on the torn ends
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    const fibre = (x, y, nx, ny, n) => {
      for (let k = 0; k < n; k++) {
        const len = 2 + rnd() * 9;
        const ang = Math.atan2(ny, nx) + (rnd() - 0.5) * 1.6;
        g.globalAlpha = 0.25 + rnd() * 0.55;
        g.lineWidth = 0.4 + rnd() * 0.8;
        g.beginPath();
        const sx = x + (rnd() - 0.5) * 3, sy = y + (rnd() - 0.5) * 3;
        g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + Math.cos(ang) * len * 0.5 + (rnd() - 0.5) * 3, sy + Math.sin(ang) * len * 0.5 + (rnd() - 0.5) * 3, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
        g.stroke();
      }
    };
    top.forEach((d, i) => fibre(i * 3, d + 1, 0, -1, rnd() < 0.6 ? 2 : 0));
    bot.forEach((d, i) => fibre(i * 3, hgt - d - 1, 0, 1, rnd() < 0.6 ? 2 : 0));
    lef.forEach((d, i) => fibre(d + 1, i * 3, -1, 0, rnd() < 0.35 ? 1 : 0));
    rig.forEach((d, i) => fibre(w - d - 1, i * 3, 1, 0, rnd() < 0.35 ? 1 : 0));
    g.globalAlpha = 1;
    return c.toDataURL('image/png');
  }

  update(t) {
    const w = Math.round(this.sheet.offsetWidth), hh = Math.round(this.sheet.offsetHeight);
    const key = `${w}x${hh}`;
    if (w > 40 && hh > 40 && key !== this._maskKey) {
      this._maskKey = key;
      const url = `url(${this._deckle(w, hh)})`;
      this.sheet.style.webkitMaskImage = url;
      this.sheet.style.maskImage = url;
    }
    const n = this.pages.length;
    const e = Math.max(0, t - this.t0);
    const cur = Math.floor(e / PAGE) % n;
    const ph = e % PAGE;
    const reduce = document.documentElement.dataset.motion === 'reduce';
    this.pages.forEach((p, i) => {
      let a = 0;
      let dy = 0;
      if (i === cur) {
        a = ph < FADE && e >= PAGE ? ph / FADE : ph > PAGE - FADE ? (PAGE - ph) / FADE : 1;
        dy = (ph / PAGE - 0.5) * -14;
      }
      p.style.opacity = a.toFixed(3);
      p.style.transform = reduce ? '' : `translateY(${dy.toFixed(1)}px)`;
      p.style.visibility = a > 0.001 ? '' : 'hidden';
    });
    this.dots.forEach((d, i) => d.classList.toggle('on', i === cur));
  }

  dispose() {
    this.el.remove();
  }
}
