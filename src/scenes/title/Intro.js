import * as THREE from 'three';
import { h } from '../../ui/UI.js';
import { padGlyph } from '../../ui/SettingsPanel.js';
import { DRAGON } from './world/lanes.js';

/**
 * The prologue: five camera shots over Phlan at dusk with a text crawl in the
 * Gold Box voice, the Council's proclamation, and a crane down onto the Pool
 * as the logo returns. Everything is a pure function of intro-local time, so
 * `?scene=title&view=intro&t=14` is a deterministic still. Skippable.
 */
export const INTRO_LENGTH = 49;

/** Chamber set origin (see world/Chamber.js). */
const CO = { x: 0, y: -240, z: 0 };
const C = (x, y, z) => new THREE.Vector3(x + CO.x, y + CO.y, z + CO.z);

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Shots: [start, end, keys:[{p,l}...], caption, sub, text] */
const SHOTS = [
  {
    t: [0, 8.2],
    keys: [{ p: V(-70, -11.5, -430), l: V(-25, -8, -150) }, { p: V(-48, -9.5, -318), l: V(-12, -6, -140) }],
    look: 0.35,
    caption: 'The Moonsea',
    sub: 'Year of the Worm',
    text: 'Your ship noses through the evening swell toward Phlan — or what the dragons and the goblin hordes have left of it.',
  },
  {
    t: [8.2, 16.4],
    keys: [{ p: V(18, 9.5, -40), l: V(78, -7.5, -122) }, { p: V(34, 7.5, -56), l: V(66, -6.5, -128) }],
    look: 1,
    caption: 'The Old City',
    sub: 'Fallen these fifty years',
    text: 'Once the jewel of the northern shore, Phlan was lost half a century ago. Its ruins belong to monsters now, and to whatever commands them.',
  },
  {
    t: [16.4, 24.4],
    keys: [{ p: V(-104, 9, -84), l: V(-30, -9, -58) }, { p: V(-70, 2, -66), l: V(-20, -9, -58) }],
    look: 1,
    caption: 'New Phlan',
    sub: 'Behind the patchwork wall',
    text: 'Merchants of the Moonsea have taken back one corner of the city. New Phlan huddles behind its patchwork wall — and it needs swords.',
  },
  {
    t: [24.4, 32.4],
    keys: [{ p: V(-32, -10.3, -32), l: V(-19, -9.9, -58) }, { p: V(-25.5, -10.6, -38.5), l: V(-19.5, -9.5, -58) }],
    look: 0.7,
    moon: 2.4,
    caption: 'City Hall',
    sub: 'The Council of Phlan',
    text: 'The City Council pays in gold for every block of the old city made safe again. Its clerk keeps a ledger of the brave, and of the dead.',
  },
  {
    t: [32.4, 40.4],
    keys: [{ p: C(0.45, 1.62, 6.6), l: C(-0.05, 1.3, -6) }, { p: C(0.2, 1.66, 5.4), l: C(0, 1.34, -7.5) }],
    look: 0,
    interior: true,
    caption: 'The Council Chamber',
    sub: 'By candlelight',
    text: 'The councillors look you over by candlelight. The clerk wets his quill. “Names, classes, and the gods you swear by.”',
  },
  {
    t: [40.4, INTRO_LENGTH],
    keys: [{ p: V(0, 34, 46), l: V(0, 0, -6) }, { p: V(0, 3.6, 12.5), l: V(0, 1.08, -27.5) }],
    look: [0.9, 0],
    caption: '',
    sub: '',
    text: '“Welcome to Phlan, adventurers. Sign here — and may your blades stay sharp.”',
  },
];

const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class IntroCinematic {
  /**
   * @param {import('../../core/context.js').GameContext} ctx
   * @param {object} world  title world (unused directly; camera drives the look)
   * @param {{t0:number, onDone:() => void}} o
   */
  constructor(ctx, world, { t0 = 0, onDone }) {
    this.ctx = ctx;
    this.world = world;
    this.t0 = t0;
    this.onDone = onDone;
    this.done = false;
    this.logoAlpha = 0;
    this.caption = h('div.por-intro-caption', [h('div.por-intro-cap-main'), h('div.por-intro-cap-sub')]);
    this.textEl = h('div.por-intro-text');
    this.progress = h('i');
    this.proclamation = h('div.por-intro-procl.por-frame.por-frame--parchment', [
      h('i.por-corner.tl'), h('i.por-corner.tr'), h('i.por-corner.bl'), h('i.por-corner.br'),
      h('div.por-procl-head', ['By Order of the Council']),
      h('div.por-procl-city', ['of New Phlan']),
      h('div.por-rule'),
      h('p', ['Stout adventurers are sought to clear the Slums, Sokal Keep and the ruined districts of the old city of the creatures that infest them.']),
      h('p', ['Bounties paid in gold at City Hall for every block restored to civilised hands. Inquire of the Clerk.']),
      h('div.por-procl-sign', [h('span', ['— Sealed this day in council']), h('span.por-procl-seal', ['✶'])]),
    ]);
    this.fade = h('div.por-intro-fade');
    this.el = h('div.por-intro', [
      h('div.por-intro-bar.top', [
        this.caption,
        h('button.por-intro-skip', { type: 'button', onclick: () => this.skip() }, [h('span', ['Skip']), h('span.por-keycap', ['Esc']), padGlyph('B')]),
      ]),
      this.proclamation,
      h('div.por-intro-bar.bottom', [this.textEl, h('div.por-intro-progress', [this.progress])]),
      this.fade,
    ]);
    this._lastShot = -1;
  }

  /** Current shot index for intro-local time. */
  shotAt(lt) {
    for (let i = 0; i < SHOTS.length; i++) if (lt < SHOTS[i].t[1]) return i;
    return SHOTS.length - 1;
  }

  update(time, camera, snap) {
    const lt = Math.max(0, time - this.t0);
    const i = this.shotAt(lt);
    const s = SHOTS[i];
    const k = Math.min(1, (lt - s.t[0]) / (s.t[1] - s.t[0]));
    const e = i === SHOTS.length - 1 ? easeInOut(Math.min(1, k * 1.12)) : k;
    const [a, b] = s.keys;
    camera.position.lerpVectors(a.p, b.p, e);
    // gentle handheld drift
    camera.position.y += Math.sin(lt * 0.7) * 0.08;
    const look = new THREE.Vector3().lerpVectors(a.l, b.l, e);
    camera.lookAt(look);
    const L = Array.isArray(s.look) ? s.look[0] + (s.look[1] - s.look[0]) * e : s.look;
    this.world?.setInterior?.(!!s.interior);
    this.world?.setMoon?.(s.moon ?? 0);
    // the dragon only wheels over the open sea and the final crane; in the close
    // city shots it would cross the lens at an awkward, cropped scale
    // over the sea it crosses the frame in profile, high in the sky; on the final
    // crane it returns to the title card's lane once the camera has settled
    this.world?.setDragonLane?.(i === 0
      ? { x: [1.25, -0.5], y: [0.4, 0.52], d: [95, 120], period: 10, duty: 0.82, time: lt + 0.2, scale: 1.2, bank: 0.55 }
      : i === SHOTS.length - 1 && lt > 45.5 ? { ...DRAGON.card, time: lt - 45.5 - DRAGON.card.phase } : null);
    this.world?.setLook?.(L);

    // crossfades between shots (and out at the very end)
    let f = 1 - smooth(s.t[0], s.t[0] + 0.7, lt);
    if (i < SHOTS.length - 1) f = Math.max(f, smooth(s.t[1] - 0.55, s.t[1], lt));
    this.fade.style.opacity = String(f);

    // captions + typed text
    if (i !== this._lastShot) {
      this._lastShot = i;
      this.caption.children[0].textContent = s.caption;
      this.caption.children[1].textContent = s.sub;
    }
    const capA = smooth(s.t[0] + 0.5, s.t[0] + 1.4, lt) * (1 - smooth(s.t[1] - 1.2, s.t[1] - 0.5, lt));
    this.caption.style.opacity = String(s.caption ? capA : 0);
    this.caption.style.transform = `translateY(${(1 - capA) * 6}px)`;
    const speed = this.ctx.settings.get('textSpeed') ?? 1;
    const start = s.t[0] + 1.0;
    const n = speed === 0 ? s.text.length : Math.floor(Math.max(0, lt - start) * 42 * speed);
    const shown = s.text.slice(0, n);
    if (this.textEl.dataset.shown !== shown) {
      this.textEl.dataset.shown = shown;
      this.textEl.replaceChildren(h('span.typed', [shown]), h('span.ghost', [s.text.slice(n)]));
    }
    this.textEl.style.opacity = String(1 - smooth(s.t[1] - 0.6, s.t[1] - 0.2, lt) * (i < SHOTS.length - 1 ? 1 : 0));
    this.progress.style.width = `${Math.min(100, (lt / INTRO_LENGTH) * 100)}%`;

    // the proclamation during the City Hall shot
    const pa = smooth(25.6, 26.6, lt) * (1 - smooth(31.4, 32.2, lt));
    this.proclamation.style.opacity = String(pa);
    this.proclamation.style.transform = `translateY(-50%) rotate(-1.2deg) scale(${0.96 + 0.04 * pa})`;
    this.proclamation.style.visibility = pa > 0.001 ? 'visible' : 'hidden';

    // logo returns as the camera settles on the Pool
    this.logoAlpha = smooth(45.2, 48.2, lt);
    this.el.classList.toggle('final', lt > 44.5);

    if (!snap && !this.done && lt >= INTRO_LENGTH + 1.2) this.skip();
  }

  skip() {
    if (this.done) return;
    this.done = true;
    this.onDone?.();
  }

  dispose() {
    this.world?.setInterior?.(false);
    this.world?.setMoon?.(0);
    this.world?.setDragonLane?.(null);
    this.world?.setLook?.(0);
    this.el.remove();
  }
}
