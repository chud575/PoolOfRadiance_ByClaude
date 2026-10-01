import { makeDesk, makeParchment, grainTile } from './ink.js';

/**
 * Screen-space viewer for a parchment sheet lying on the cartographer's desk:
 * fit-to-view, zoom about a point, eased pan/zoom, pixel-ratio aware.
 * Sheet coordinates are "units" (the sheet's own drawing space, excluding its
 * shadow margin).
 */
export class SheetView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.dpr = 1;
    this.rect = { x: 0, y: 0, w: 100, h: 100 };
    this.sheet = null;
    this.zoom = 1;
    this.tZoom = 1;
    this.cx = 0;
    this.cy = 0;
    this.tcx = 0;
    this.tcy = 0;
    this.minZoom = 1;
    this.maxZoom = 4.5;
    this.desk = null;
    this.under = null;
    this.dirty = true;
  }

  /**
   * @param {{canvas:HTMLCanvasElement, k:number}} sheet
   * @param {{W:number,H:number,M:number}} dims
   */
  setSheet(sheet, dims, { keepView = false } = {}) {
    this.sheet = sheet;
    this.dims = dims;
    if (!keepView) {
      this.cx = this.tcx = dims.W / 2;
      this.cy = this.tcy = dims.H / 2;
      this.zoom = this.tZoom = 1;
    }
    this.dirty = true;
  }

  /** Viewport (CSS px) inside the canvas where the sheet is framed. */
  layout(cssW, cssH, rect, dpr = 1) {
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.rect = rect;
    const lx = (rect.x + rect.w / 2) / cssW;
    const ly = (rect.y + rect.h / 2) / cssH;
    this.desk = makeDesk(Math.round(cssW * dpr), Math.round(cssH * dpr), { cx: lx, cy: ly });
    if (!this.under) this.under = makeParchment(650, 500, { seed: 77, tone: [226, 206, 162], age: 1.4 });
    this.dirty = true;
  }

  get fit() {
    const { W, H } = this.dims ?? { W: 1, H: 1 };
    return Math.min(this.rect.w / W, this.rect.h / H) * 0.97;
  }

  /** CSS px per sheet unit for the given zoom. */
  scaleAt(z = this.zoom) {
    return this.fit * z;
  }

  origin(z = this.zoom, cx = this.cx, cy = this.cy) {
    const s = this.scaleAt(z);
    return [this.rect.x + this.rect.w / 2 - cx * s, this.rect.y + this.rect.h / 2 - cy * s];
  }

  screenToUnits(sx, sy) {
    const s = this.scaleAt();
    const [ox, oy] = this.origin();
    return [(sx - ox) / s, (sy - oy) / s];
  }

  unitsToScreen(ux, uy) {
    const s = this.scaleAt();
    const [ox, oy] = this.origin();
    return [ox + ux * s, oy + uy * s];
  }

  _clampCenter(z, cx, cy) {
    const { W, H } = this.dims;
    const s = this.scaleAt(z);
    const halfW = this.rect.w / 2 / s;
    const halfH = this.rect.h / 2 / s;
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    return [clamp(cx, halfW - W * 0.08, W * 1.08 - halfW), clamp(cy, halfH - H * 0.08, H * 1.08 - halfH)];
  }

  /** Zoom by factor keeping the screen point (sx, sy) fixed. */
  zoomAt(factor, sx, sy) {
    const z = Math.max(this.minZoom, Math.min(this.maxZoom, this.tZoom * factor));
    const sOld = this.scaleAt(this.tZoom);
    const [ox, oy] = this.origin(this.tZoom, this.tcx, this.tcy);
    const ux = (sx - ox) / sOld;
    const uy = (sy - oy) / sOld;
    const sNew = this.scaleAt(z);
    let cx = ux - (sx - this.rect.x - this.rect.w / 2) / sNew;
    let cy = uy - (sy - this.rect.y - this.rect.h / 2) / sNew;
    [cx, cy] = this._clampCenter(z, cx, cy);
    this.tZoom = z;
    this.tcx = cx;
    this.tcy = cy;
  }

  zoomCenter(factor) {
    this.zoomAt(factor, this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2);
  }

  /** Pan by a screen-space delta (CSS px). */
  panBy(dx, dy, immediate = false) {
    const s = this.scaleAt(this.tZoom);
    [this.tcx, this.tcy] = this._clampCenter(this.tZoom, this.tcx - dx / s, this.tcy - dy / s);
    if (immediate) {
      this.cx = this.tcx;
      this.cy = this.tcy;
      this.dirty = true;
    }
  }

  /** Centre the view on a unit point, optionally at a zoom. */
  focus(ux, uy, zoom = this.tZoom, immediate = false) {
    this.tZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    [this.tcx, this.tcy] = this._clampCenter(this.tZoom, ux, uy);
    if (immediate) this.snap();
  }

  snap() {
    this.zoom = this.tZoom;
    this.cx = this.tcx;
    this.cy = this.tcy;
    this.dirty = true;
  }

  /** Ease towards targets. dt === 0 → snap (frozen clock renders the settled state). */
  update(dt) {
    if (dt === 0) {
      if (this.zoom !== this.tZoom || this.cx !== this.tcx || this.cy !== this.tcy) this.snap();
      return;
    }
    const a = 1 - Math.exp(-dt * 12);
    const dz = this.tZoom - this.zoom;
    const dx = this.tcx - this.cx;
    const dy = this.tcy - this.cy;
    if (Math.abs(dz) < 1e-4 && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      if (dz || dx || dy) this.snap();
      return;
    }
    // zoom in log space for a perceptually even ease
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.tZoom) - Math.log(this.zoom)) * a);
    this.cx += dx * a;
    this.cy += dy * a;
    this.dirty = true;
  }

  /**
   * Draw desk, underlying sheet, the sheet and the overlay.
   * overlay(g, s) is called with the context transformed into sheet units (s = css px per unit).
   */
  draw(overlay) {
    const g = this.g;
    const d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (this.desk) g.drawImage(this.desk, 0, 0);
    if (!this.sheet) return;
    const { W, H, M } = this.dims;
    const s = this.scaleAt();
    const [ox, oy] = this.origin();
    // an older survey sheet peeking out beneath
    if (this.under) {
      g.save();
      g.setTransform(d * s, 0, 0, d * s, d * ox, d * oy);
      g.translate(W * 0.5, H * 0.5);
      g.rotate(-0.045);
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 30 * d;
      g.shadowOffsetY = 8 * d;
      g.drawImage(this.under, -W * 0.5 - 22, -H * 0.5 + 16, W * 1.01, H * 1.0);
      g.restore();
    }
    g.setTransform(d * s, 0, 0, d * s, d * ox, d * oy);
    const k = this.sheet.k;
    g.drawImage(this.sheet.canvas, 0, 0, this.sheet.canvas.width, this.sheet.canvas.height, -M, -M, this.sheet.canvas.width / k, this.sheet.canvas.height / k);
    // candle light falling across the sheet: warm centre, deepening toward the far corners
    {
      const lx = W * 0.42;
      const ly = H * 0.42;
      const R = Math.hypot(W, H) * 0.75;
      const gr = g.createRadialGradient(lx, ly, R * 0.15, lx, ly, R);
      gr.addColorStop(0, 'rgba(255,214,150,0.07)');
      gr.addColorStop(0.55, 'rgba(60,30,8,0.0)');
      gr.addColorStop(1, 'rgba(40,18,4,0.32)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // paper tooth: fibre grain that only resolves once you lean in
    const tooth = Math.max(0, Math.min(1, (this.zoom - 1.2) / 1.2));
    if (tooth > 0) {
      g.save();
      if (!this._grainPat) {
        this._grainPat = g.createPattern(grainTile(), 'repeat');
      }
      this._grainPat.setTransform(new DOMMatrix().scaleSelf(0.22));
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 0.32 * tooth;
      g.fillStyle = this._grainPat;
      g.fillRect(0, 0, W, H);
      g.restore();
    }
    if (overlay) {
      g.save();
      overlay(g, s);
      g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // when the sheet overfills the frame, shade the frame's edges so the map
    // reads as passing beneath the side panel rather than being cut off
    const over = Math.max(0, Math.min(1, (this.zoom - 1.05) / 0.5));
    if (over > 0) {
      const r = this.rect;
      const e = 70 * d;
      const x1 = (r.x + r.w) * d;
      const right = g.createLinearGradient(x1 - e, 0, x1 + 24 * d, 0);
      right.addColorStop(0, 'rgba(10,6,3,0)');
      right.addColorStop(1, `rgba(10,6,3,${(0.6 * over).toFixed(3)})`);
      g.fillStyle = right;
      g.fillRect(x1 - e, 0, e + this.canvas.width - x1, this.canvas.height);
      const yb = (r.y + r.h) * d;
      const bottom = g.createLinearGradient(0, yb - e * 0.7, 0, this.canvas.height);
      bottom.addColorStop(0, 'rgba(10,6,3,0)');
      bottom.addColorStop(1, `rgba(10,6,3,${(0.55 * over).toFixed(3)})`);
      g.fillStyle = bottom;
      g.fillRect(0, yb - e * 0.7, this.canvas.width, this.canvas.height);
      for (const [x0, xx] of [[0, r.x * d + e * 0.6]]) {
        const left = g.createLinearGradient(x0, 0, xx, 0);
        left.addColorStop(0, `rgba(10,6,3,${(0.45 * over).toFixed(3)})`);
        left.addColorStop(1, 'rgba(10,6,3,0)');
        g.fillStyle = left;
        g.fillRect(x0, 0, xx, this.canvas.height);
      }
      const top = g.createLinearGradient(0, 0, 0, r.y * d + e * 0.6);
      top.addColorStop(0, `rgba(10,6,3,${(0.45 * over).toFixed(3)})`);
      top.addColorStop(1, 'rgba(10,6,3,0)');
      g.fillStyle = top;
      g.fillRect(0, 0, this.canvas.width, r.y * d + e * 0.6);
    }
    this.dirty = false;
  }
}
