import { glyph, GLYPH_W, GLYPH_H } from '../../render/bitmapFont5x7.js';

/**
 * Classic 1988 mode's title card, authored as EGA art rather than filtered
 * from the 3D scene: a 320x180 canvas (one EGA pixel per texel, scaled up with
 * hard edges) in the sixteen-colour palette — starfield, the red AD&D line,
 * the chunky bold bitmap logo with its red drop shadow, cyan FORGOTTEN REALMS,
 * a crisp stepped skyline of New Phlan with lamp-lit windows, the dithered
 * horizon band, and the Pool as concentric blue / cyan / white ellipses. It
 * lives the way 1988 lived: the Pool's rings colour-cycle, stars twinkle,
 * brazier flames flicker through three palette entries, and every so often
 * a dragon crosses the sky in two frames of wing beat. Pure function of t.
 */
const W = 320;
const H = 180;
const EGA = {
  black: '#000000', blue: '#0000aa', green: '#00aa00', cyan: '#00aaaa', red: '#aa0000', magenta: '#aa00aa', brown: '#aa5500',
  lgrey: '#aaaaaa', dgrey: '#555555', lblue: '#5555ff', lgreen: '#55ff55', lcyan: '#55ffff', lred: '#ff5555', lmagenta: '#ff55ff',
  yellow: '#ffff55', white: '#ffffff',
};

/** Deterministic hash in [0,1). */
const hash = (i, j = 0) => {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export class ClassicCard {
  constructor() {
    this.el = document.createElement('canvas');
    this.el.width = W;
    this.el.height = H;
    this.el.className = 'por-title-ega';
    this.g = this.el.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this._skyline = this._buildSkyline();
    this._stars = Array.from({ length: 70 }, (_, i) => ({ x: Math.floor(hash(i, 1) * W), y: Math.floor(hash(i, 2) * 96), tw: hash(i, 3) }));
    this._last = '';
  }

  /** Stepped rooftops: gables built of 1-pixel stairs, towers with spires, flat parapets. */
  _buildSkyline() {
    const out = [];
    let x = -4;
    let i = 0;
    while (x < W + 4) {
      const w = 14 + Math.floor(hash(i, 7) * 26);
      const top = 92 + Math.floor(hash(i, 8) * 26);
      const kind = hash(i, 9);
      out.push({ x, w, top, kind, i });
      x += w - Math.floor(hash(i, 10) * 4);
      i++;
    }
    // the castle keep and its towers on the right, the temple dome on the left
    out.push({ x: 222, w: 30, top: 74, kind: 2, i: 90 }, { x: 214, w: 8, top: 66, kind: 3, i: 91 }, { x: 252, w: 8, top: 70, kind: 3, i: 92 });
    out.push({ x: 50, w: 26, top: 88, kind: 4, i: 93 });
    out.push({ x: 132, w: 10, top: 70, kind: 3, i: 94 }); // the belfry
    return out;
  }

  _px(x, y, c, w = 1, h = 1) {
    this.g.fillStyle = c;
    this.g.fillRect(Math.round(x), Math.round(y), w, h);
  }

  /** 5x7 text; `bold` doubles each column (the 1988 title's chunky face). */
  _text(str, cx, y, color, { sx = 1, sy = 1, bold = false, shadow = null } = {}) {
    const adv = (GLYPH_W + 1 + (bold ? 1 : 0)) * sx;
    const width = str.length * adv - sx;
    const x0 = Math.round(cx - width / 2);
    const draw = (ox, oy, c) => {
      this.g.fillStyle = c;
      let px = x0 + ox;
      for (const ch of str) {
        const cols = glyph(ch);
        for (let gx = 0; gx < GLYPH_W; gx++) {
          for (let gy = 0; gy < GLYPH_H; gy++) {
            if (!((cols[gx] >> gy) & 1)) continue;
            this.g.fillRect(px + gx * sx, y + oy + gy * sy, sx * (bold ? 2 : 1), sy);
          }
        }
        px += adv;
      }
    };
    if (shadow) draw(sx, sy, shadow);
    draw(0, 0, color);
  }

  _skylineDraw(t) {
    const g = this.g;
    const base = 128;
    g.fillStyle = EGA.blue;
    for (const b of this._skyline) {
      const { x, w, top, kind } = b;
      g.fillRect(x, top, w, base - top);
      if (kind < 0.45) {
        // a gable: stairs of one pixel up to the ridge
        const half = Math.floor(w / 2);
        for (let k = 0; k < half; k++) g.fillRect(x + k, top - k - 1, w - k * 2, 1);
      } else if (kind < 0.6) {
        // stepped (crow-stepped) gable
        for (let k = 0; k < 3; k++) g.fillRect(x + 3 + k * 3, top - (k + 1) * 3, w - 6 - k * 6, 3);
      } else if (kind === 2) {
        // the keep: crenellated parapet
        for (let k = 0; k < w; k += 4) g.fillRect(x + k, top - 3, 2, 3);
      } else if (kind === 3) {
        // a tower with a needle spire
        const cx = x + Math.floor(w / 2);
        for (let k = 0; k < 10; k++) g.fillRect(cx - Math.max(0, 3 - Math.floor(k / 3)), top - k - 1, Math.max(1, 7 - Math.floor(k / 3) * 2), 1);
      } else if (kind === 4) {
        // the dome of Tyr: a stepped semicircle with a lantern
        const r = Math.floor(w / 2);
        for (let k = 0; k < r; k++) {
          const hw = Math.round(Math.sqrt(r * r - k * k));
          g.fillRect(x + r - hw, top - k - 1, hw * 2, 1);
        }
        g.fillRect(x + r - 1, top - r - 4, 3, 4);
      } else if (kind > 0.85) {
        // a chimney with a pot
        g.fillRect(x + w - 6, top - 5, 3, 5);
      }
    }
    // lit windows: single and paired yellow pixels, a few blinking out and in
    for (const b of this._skyline) {
      const n = Math.floor(b.w / 7);
      for (let k = 0; k < n; k++) {
        const hv = hash(b.i, 20 + k);
        if (hv > 0.55) continue;
        const wx = b.x + 3 + Math.floor(hash(b.i, 40 + k) * (b.w - 6));
        const wy = b.top + 4 + Math.floor(hash(b.i, 60 + k) * Math.max(1, base - b.top - 10));
        const blink = Math.floor(t * 0.7 + hv * 37) % 11 === 0 && hv < 0.12;
        if (!blink) this._px(wx, wy, EGA.yellow, 1, hv < 0.2 ? 2 : 1);
      }
    }
  }

  _pool(t) {
    // concentric ellipses, colour-cycled outward like a 1988 palette rotation
    const cx = 160, cy = 146;
    const rings = [[62, 11.5, EGA.blue], [49, 9, EGA.cyan], [35, 6.4, EGA.lcyan], [17, 3.1, EGA.white]];
    const g = this.g;
    rings.forEach(([rx0, ry0, c], i) => {
      // the inner rings breathe a pixel in and out, a step behind each other
      const d = i ? Math.round(Math.sin(t * 1.4 - i * 1.1) * 1.2) : 0;
      const rx = rx0 + d * 2, ry = ry0 + d * 0.4;
      g.fillStyle = c;
      for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) {
        const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
        g.fillRect(cx - hw, cy + y, hw * 2, 1);
      }
    });
    // glints riding the water: a few white pixels drifting round the rings
    for (let k = 0; k < 6; k++) {
      const a = t * 0.6 + k * 1.05;
      const rx = 30 + (k % 3) * 9, ry = rx * 0.2;
      this._px(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, EGA.white);
    }
  }

  _brazier(x, t, seed) {
    // iron stand: tripod legs and a bowl, black against the grey flags
    const g = this.g;
    g.fillStyle = EGA.black;
    g.fillRect(x - 1, 138, 2, 16);
    for (let k = 0; k < 4; k++) { g.fillRect(x - 2 - k, 150 + k, 1, 1); g.fillRect(x + 1 + k, 150 + k, 1, 1); }
    g.fillRect(x - 6, 154, 2, 1);
    g.fillRect(x + 4, 154, 2, 1);
    g.fillRect(x - 6, 136, 12, 2);
    g.fillRect(x - 5, 138, 10, 1);
    g.fillStyle = EGA.lgrey;
    g.fillRect(x - 6, 136, 12, 1);
    // three-colour flame, flickering in whole pixels
    const f = Math.floor(t * 8 + seed * 5);
    const h0 = 6 + (f % 3);
    for (let k = 0; k < h0; k++) {
      const w = Math.max(1, 8 - k - ((f + k) % 2));
      const c = k < 2 ? EGA.red : k < 4 ? EGA.lred : EGA.yellow;
      g.fillStyle = c;
      g.fillRect(x - Math.floor(w / 2) + ((f + k * 3) % 3 === 0 ? 1 : 0), 135 - k, w, 1);
    }
    if (f % 4 === 0) this._px(x + ((f >> 2) % 3) - 1, 135 - h0 - 2, EGA.yellow);
  }

  _dragon(t) {
    // every 20 s it crosses the sky right to left, below the title lines
    const P = 20;
    const k = (((t + 19.4) % P) + P) % P / 12;
    if (k > 1) return;
    const x = 340 - k * 380;
    const y = 76 - k * 8 + Math.sin(t * 2) * 1.5;
    const up = Math.floor(t * 4) % 2 === 0;
    const g = this.g;
    g.fillStyle = EGA.dgrey;
    // body and neck/tail (nose to the left)
    g.fillRect(x - 6, y, 14, 2);
    g.fillRect(x - 10, y - 1, 5, 2);
    g.fillRect(x - 12, y - 2, 3, 2);
    g.fillRect(x + 8, y + 1, 8, 1);
    g.fillRect(x + 16, y + 2, 4, 1);
    // wings: two frames
    if (up) {
      for (let i = 0; i < 7; i++) g.fillRect(x - 2 + i, y - 1 - i, 6 - Math.floor(i / 2), 1);
    } else {
      for (let i = 0; i < 5; i++) g.fillRect(x - 3 + i, y + 2 + i, 7 - i, 1);
      for (let i = 0; i < 3; i++) g.fillRect(x - 1 + i, y - 1 - i, 4, 1);
    }
    this._px(x - 12, y - 2, EGA.lred);
  }

  update(t) {
    const g = this.g;
    g.fillStyle = EGA.black;
    g.fillRect(0, 0, W, H);
    for (const s of this._stars) {
      const on = Math.floor(t * 1.3 + s.tw * 17) % 9 !== 0;
      if (on) this._px(s.x, s.y, s.tw > 0.8 ? EGA.white : s.tw > 0.35 ? EGA.lgrey : EGA.dgrey);
    }
    this._text('ADVANCED DUNGEONS & DRAGONS', 160, 12, EGA.lred);
    this._text('POOL OF RADIANCE', 160, 26, EGA.yellow, { sx: 2, sy: 2, bold: true, shadow: EGA.red });
    this._text('FORGOTTEN REALMS', 160, 47, EGA.lcyan);
    this._dragon(t);
    this._skylineDraw(t);
    // the dithered horizon band, then the grey plaza
    for (let y = 128; y < 131; y++) for (let x = (y % 2); x < W; x += 2) this._px(x, y, EGA.dgrey);
    g.fillStyle = EGA.dgrey;
    g.fillRect(0, 131, W, H - 131);
    // flagstone joints: a few black pixel courses in perspective
    g.fillStyle = EGA.black;
    for (const [y, step] of [[136, 26], [143, 30], [152, 36], [163, 44]]) {
      for (let x = (y * 7) % step; x < W; x += step) g.fillRect(x, y, 1, 1);
    }
    this._pool(t);
    this._brazier(92, t, 0);
    this._brazier(228, t, 1);
  }
}
