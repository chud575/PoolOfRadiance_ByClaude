import { EGA16, hexToRgb } from '../../src/render/palette.js';
import { glyph } from '../../src/render/bitmapFont5x7.js';

export const W = 320;
export const H = 200;
const PAL = EGA16.map(hexToRgb);

/** Indexed-colour 320x200 EGA framebuffer with primitive drawing ops. */
export class Ega {
  constructor() {
    this.buf = new Uint8Array(W * H);
  }

  cls(c = 0) {
    this.buf.fill(c);
  }

  pset(x, y, c) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (this.clip && (x < this.clip[0] || y < this.clip[1] || x >= this.clip[2] || y >= this.clip[3])) return;
    this.buf[y * W + x] = c;
  }

  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.pset(i, j, c);
  }

  /** Checkerboard dither between two colours. */
  dither(x, y, w, h, c1, c2) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.pset(i, j, (i + j) & 1 ? c1 : c2);
  }

  frame(x, y, w, h, c) {
    this.line(x, y, x + w - 1, y, c);
    this.line(x, y + h - 1, x + w - 1, y + h - 1, c);
    this.line(x, y, x, y + h - 1, c);
    this.line(x + w - 1, y, x + w - 1, y + h - 1, c);
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Scanline polygon fill. pts: [[x,y],...]. c may be a function (x,y)→colour. */
  poly(pts, c) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.pset(x, y, typeof c === 'function' ? c(x, y) : c);
      }
    }
  }

  /** Draw text with the chunky (horizontally emboldened) 8x8-cell font. */
  text(x, y, str, c, { scale = 1, bold = true } = {}) {
    let cx = x;
    for (const ch of String(str)) {
      const g = glyph(ch);
      for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 7; row++) {
          if (g[col] & (1 << row)) {
            for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale * (bold ? 2 : 1); sx++) this.pset(cx + (col + (bold ? 0 : 0)) * scale + sx, y + row * scale + sy, c);
          }
        }
      }
      cx += 8 * scale;
    }
    return cx;
  }

  /** Text at character cell coordinates (40x25 grid). */
  textAt(col, row, str, c) {
    return this.text(col * 8, row * 8, str, c);
  }

  /** Blit pixel art: rows of chars, map char→colour index ('.' = transparent). */
  sprite(x, y, rows, map, scale = 1, flip = false) {
    rows.forEach((r, j) => {
      [...r].forEach((ch, i) => {
        const col = map[ch];
        if (col === undefined) return;
        const ix = flip ? r.length - 1 - i : i;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.pset(x + ix * scale + sx, y + j * scale + sy, col);
      });
    });
  }

  /** Write to a canvas at integer scale (nearest neighbour). */
  present(canvas, scale = 4) {
    canvas.width = W * scale;
    canvas.height = H * scale;
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const [r, gg, b] = PAL[this.buf[i]];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, W * scale, H * scale);
  }
}
