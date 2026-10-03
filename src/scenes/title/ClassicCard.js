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

/**
 * Dragon sprite, nose left, rasterised once into palette letters on a 40x22
 * grid: dark grey hide with a light grey belly, a yellow eye and horn, a whip
 * tail ending in a spade, and one bat wing (light red finger bones, red
 * membrane, scalloped trailing edge) in two frames of wing beat (up / down).
 */
const DRAGON_INK = { d: EGA.dgrey, l: EGA.lgrey, r: EGA.red, R: EGA.lred, y: EGA.yellow };
function dragonFrame(up) {
  const W2 = 40, H2 = 22, oy = 11;
  const g = Array.from({ length: H2 }, () => Array(W2).fill('.'));
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W2 && y >= 0 && y < H2) g[y][x] = c; };
  const line = (x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  };
  // wing first (the body overlaps its root)
  const A = [10, oy - 1], B = [29, oy - 1], T = up ? [25, 0] : [21, H2 - 1];
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const P = [x + 0.5, y + 0.5];
    const c1 = cross(A, T, P), c2 = cross(T, B, P), c3 = cross(B, A, P);
    if (!((c1 >= 0 && c2 >= 0 && c3 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0))) continue;
    // scallops: bite arcs out of the trailing edge between the fingers
    const tx = T[0] - B[0], ty = T[1] - B[1];
    const L = Math.hypot(tx, ty);
    const along = ((P[0] - B[0]) * tx + (P[1] - B[1]) * ty) / (L * L);
    const dist = Math.abs(cross(B, T, P)) / L;
    if (dist < 1.5 * Math.abs(Math.sin(along * Math.PI * 3)) && along > 0.05 && along < 0.95) continue;
    put(x, y, 'r');
  }
  line(A[0], A[1], T[0], T[1], 'R'); // leading-edge arm bone
  const Wr = [A[0] + (T[0] - A[0]) * 0.55, A[1] + (T[1] - A[1]) * 0.55];
  for (const f of [0.34, 0.67]) line(Wr[0], Wr[1], B[0] + (T[0] - B[0]) * f, B[1] + (T[1] - B[1]) * f, 'R');
  // body, belly, legs
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const ex = (x + 0.5 - 17.5) / 8.5, ey = (y + 0.5 - (oy + 0.5)) / 2.2;
    if (ex * ex + ey * ey <= 1) put(x, y, y > oy && Math.abs(x - 17) < 6 ? 'l' : 'd');
  }
  line(14, oy + 2, 13, oy + 4, 'd');
  line(21, oy + 2, 22, oy + 4, 'd');
  // neck and head (nose left), eye and horn
  line(10, oy, 5, oy - 2, 'd');
  line(10, oy + 1, 5, oy - 1, 'd');
  for (let x = 0; x <= 5; x++) put(x, oy - 2, 'd');
  for (let x = 1; x <= 5; x++) put(x, oy - 3, 'd');
  put(3, oy - 3, 'y');
  put(5, oy - 4, 'l');
  // tail: a lazy S out behind, ending in a spade
  for (let x = 26; x <= 37; x++) put(x, oy + 1 + Math.round(Math.sin((x - 26) * 0.35) * 1.4 + (x - 26) * 0.12), 'd');
  put(38, oy + 3, 'd'); put(39, oy + 2, 'd'); put(39, oy + 3, 'd'); put(39, oy + 4, 'd');
  return g.map((r) => r.join(''));
}
const DRAGON_FRAMES = [dragonFrame(true), dragonFrame(false)];

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
    // bold thickens each stroke by one EGA pixel (the 1988 title's weight),
    // never by a whole scaled column
    const adv = (GLYPH_W + 1) * sx + (bold ? 1 : 0);
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
            this.g.fillRect(px + gx * sx, y + oy + gy * sy, sx + (bold ? 1 : 0), sy);
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
    // every 20 s it crosses the sky right to left between the titles and the
    // rooftops: a hand-placed EGA sprite (dark grey hide, light grey belly,
    // red membranes on light red wing bones, a yellow eye), whole pixels only
    const P = 20;
    const k = (((t + 19.4) % P) + P) % P / 12;
    if (k > 1) return;
    const x = Math.round(340 - k * 384);
    const y = Math.round(74 - k * 6 + Math.sin(t * 2) * 1.5);
    const frame = DRAGON_FRAMES[Math.floor(t * 4) % 2];
    const g = this.g;
    for (let r = 0; r < frame.length; r++) {
      const row = frame[r];
      for (let c = 0; c < row.length; c++) {
        const col = DRAGON_INK[row[c]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x + c - 20, y + r - 11, 1, 1);
      }
    }
  }

  /**
   * @param {number} t
   * @param {{logo?: boolean}} [o] logo:false while a panel (settings, load,
   *   credits) is open — the title lines would peek out around its frame
   */
  update(t, { logo = true } = {}) {
    const g = this.g;
    g.fillStyle = EGA.black;
    g.fillRect(0, 0, W, H);
    for (const s of this._stars) {
      const on = Math.floor(t * 1.3 + s.tw * 17) % 9 !== 0;
      if (on) this._px(s.x, s.y, s.tw > 0.8 ? EGA.white : s.tw > 0.35 ? EGA.lgrey : EGA.dgrey);
    }
    if (logo) {
      this._text('ADVANCED DUNGEONS & DRAGONS', 160, 12, EGA.lred);
      this._text('POOL OF RADIANCE', 160, 26, EGA.yellow, { sx: 2, sy: 2, bold: true, shadow: EGA.red });
      this._text('FORGOTTEN REALMS', 160, 47, EGA.lcyan);
      this._dragon(t);
    }
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
    // the publisher's line of the 1988 card, in the same slot and lettering
    if (logo) this._text('A FAN HOMAGE', 160, 162, EGA.white, { bold: true });
  }
}
