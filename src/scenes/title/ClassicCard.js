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
 * Dragon sprite, nose left, rasterised once into palette letters on a 48x26
 * grid, drawn to match the 3D red dragon: a red hide lit light red along the
 * back with a brown belly, a deep chest and S-neck into a wedge head (open
 * jaw, yellow eye, light grey horns), a row of dark spines, a tucked foreleg
 * and a heavy hind leg, a whip tail with a spade, and one bat wing (light red
 * finger bones over a brown, sun-shot membrane with a scalloped trailing
 * edge) in two frames of wing beat (up / down).
 */
const DRAGON_INK = { d: EGA.red, r: EGA.red, R: EGA.lred, y: EGA.yellow, b: EGA.brown, m: EGA.brown, B: EGA.yellow, w: EGA.white };
function dragonFrame(up) {
  const W2 = 64, H2 = 34;
  const g = Array.from({ length: H2 }, () => Array(W2).fill('.'));
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W2 && y >= 0 && y < H2) g[y][x] = c; };
  const get = (x, y) => (x >= 0 && x < W2 && y >= 0 && y < H2 ? g[y][x] : '.');
  const line = (x0, y0, x1, y1, c, w = 1) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) * 2 + 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let k = 0; k < w; k++) put(x, y + k - Math.floor((w - 1) / 2), c);
    }
  };
  const inPoly = (P, x, y) => {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const poly = (P, c) => { for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (inPoly(P, x + 0.5, y + 0.5)) put(x, y, typeof c === 'function' ? c(x, y) : c); };
  // a quadratic curve swept with a tapering pen
  const sweep = (a, m, b, w0, w1, c) => {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = 1 - t;
      const x = u * u * a[0] + 2 * u * t * m[0] + t * t * b[0];
      const y = u * u * a[1] + 2 * u * t * m[1] + t * t * b[1];
      const r = (w0 + (w1 - w0) * t) / 2;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy <= r * r + 0.25) put(x + dx, y + dy, typeof c === 'function' ? c(x + dx, y + dy, dy / Math.max(r, 0.5)) : c);
      }
    }
  };
  const hide = (_x, _y, k) => (k < -0.45 ? 'R' : k > 0.5 ? 'b' : 'r');
  // tail: a long whip trailing straight back (gliding), ending in a spade
  sweep([40, 18], [50, 21], [61, 19], 4, 1, hide);
  poly([[59, 17], [63, 19], [59, 21], [60, 19]], 'R');
  // hind leg stretched back along the tail, the foreleg folded to the chest
  sweep([36, 20], [41, 22], [46, 22], 4, 2, 'r');
  put(47, 22, 'R'); put(47, 23, 'R');
  sweep([24, 20], [21, 22], [23, 23], 3, 2, 'r');
  put(24, 23, 'R');
  // body: deep keeled chest tapering to the haunch; lit back, brown belly plates
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const fx = (x + 0.5 - 31) / 11.5;
    const ry = 4.8 - 1.6 * Math.max(0, Math.min(1, fx + 0.3));
    const ey = (y + 0.5 - 18.2) / ry;
    if (fx * fx + ey * ey <= 1) put(x, y, ey < -0.55 ? 'R' : ey > 0.42 ? 'b' : 'r');
  }
  // neck: a strong curve rising from the deep chest to the head
  sweep([25, 16], [18, 16.5], [13, 12.5], 5, 3, hide);
  // head: a long tapering snout under a lit brow, the skull swelling behind
  // the eye, an open lower jaw (a clean black gape between) and two swept horns
  poly([[0, 13], [4, 11.5], [8, 10.5], [10.5, 9.9], [13, 9.9], [15.5, 11.5], [15, 13.6], [9, 13.4], [3, 13.8]], (x, y) => (y < 11 ? 'R' : 'r'));
  poly([[2, 15.2], [7, 14.6], [12, 14.4], [14, 15.4], [9, 16.4], [5, 16.2]], 'r');
  line(14, 14, 15, 14, 'r');
  put(0, 12, 'R'); // nostril
  put(10, 11, 'y'); put(11, 11, 'y');
  // horns: two dark-red blades swept back off the skull (no grey)
  line(13, 9.5, 17, 7.5, 'R'); line(14, 10, 18, 8.5, 'r');
  // dorsal spines from the poll down the neck, back and tail
  for (const [x, y] of [[16, 12], [19, 12], [23, 13], [26, 13], [29, 13], [32, 13], [35, 14], [38, 14], [42, 16], [46, 17], [50, 18]]) {
    // a spine only where it stands on the hide (never a loose pixel in the sky)
    const yy = [y - 1, y, y + 1].find((q) => 'rRb'.includes(get(x, q + 1)) && get(x, q) === '.');
    if (yy !== undefined) put(x, yy, 'd');
  }
  // the near wing: shoulder, elbow, wrist and four finger bones; a brown
  // membrane between them with a scalloped trailing edge, drawn over the back
  const S = [27, 15];
  const E = up ? [22, 7] : [21, 23];
  const Wr = up ? [29, 1] : [26, 31];
  const tips = up ? [[41, 0], [50, 3], [55, 9], [47, 13]] : [[35, 33], [44, 31], [50, 26], [46, 21]];
  const root = up ? [38, 15] : [38, 20];
  const mem = [S, E, Wr, ...tips, root];
  const under = g.map((r) => r.slice());
  poly(mem, 'm');
  // scallops: bite a soft arc out between each pair of fingertips
  const edge = [...tips, root];
  for (let i = 0; i < edge.length - 1; i++) {
    const [ax, ay] = edge[i], [bx, by] = edge[i + 1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const L = Math.hypot(bx - ax, by - ay);
    // push the bite centre outward (away from the wrist)
    let nx = mx - Wr[0], ny = my - Wr[1];
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const cx = mx + nx * L * 0.62, cy = my + ny * L * 0.62;
    const r = L * 0.74;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (get(x, y) === 'm' && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r) g[y][x] = under[y][x];
  }
  // the membrane never melts into the hide: where it meets visible body, a
  // one-pixel black cut separates them
  const cut = [];
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    if (g[y][x] !== 'm') continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = get(x + dx, y + dy);
      if (c === 'r' || c === 'R' || c === 'b' || c === 'd') { cut.push([x, y]); break; }
    }
  }
  for (const [x, y] of cut) g[y][x] = '.';
  // bright bones over the membrane: a thick lit leading edge, yellow knuckles
  line(S[0], S[1], E[0], E[1], 'R', 2);
  line(E[0], E[1], Wr[0], Wr[1], 'R', 2);
  for (const t of tips) line(Wr[0], Wr[1], t[0], t[1], 'R');
  put(E[0], E[1], 'B');
  put(Wr[0], Wr[1], 'B');
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
  _text(str, cx, y, color, { sx = 1, sy = 1, bold = false, shadow = null, shadowOff = null } = {}) {
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
    // the shadow sits one EGA pixel down-right (a dark-red bevel, never a
    // misregistered second print)
    if (shadow) draw(shadowOff ?? sx, shadowOff ?? sy, shadow);
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
    // rooftops: the red dragon sprite above (red hide, brown belly and
    // membranes on light red bones, a yellow eye), whole pixels only
    const P = 20;
    const k = (((t + 19.4) % P) + P) % P / 12;
    if (k > 1) return;
    const x = Math.round(340 - k * 384);
    const y = Math.round(81 - k * 6 + Math.sin(t * 2) * 1.5);
    const frame = DRAGON_FRAMES[Math.floor(t * 4) % 2];
    const g = this.g;
    for (let r = 0; r < frame.length; r++) {
      const row = frame[r];
      for (let c = 0; c < row.length; c++) {
        const col = DRAGON_INK[row[c]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x + c - 32, y + r - 17, 1, 1);
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
      this._text('POOL OF RADIANCE', 160, 26, EGA.yellow, { sx: 2, sy: 2, bold: true, shadow: EGA.red, shadowOff: 1 });
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
