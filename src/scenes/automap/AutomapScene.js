import { Scene } from '../../core/Scene.js';
import { h, Frame, CommandBar } from '../../ui/UI.js';
import { getMap } from '../../data/maps/index.js';
import { EDGE, CELL, DIRS } from '../../data/maps/MapGrid.js';
import { fbm } from '../../render/textures/noise.js';

/**
 * AREA view: parchment overhead map of the current block, drawn with Canvas2D.
 * Shows explored cells only (or all with &reveal=1 / in debug shots).
 * params: {map?, overlay?: boolean, reveal?: '1'|'0'}
 * Owned by the automap/area-map workstream.
 */
export default class AutomapScene extends Scene {
  async enter(params = {}) {
    const { game, debug } = this.ctx;
    this.transparent = !!params.overlay;
    this.map = getMap(params.map ?? game.location.map);
    if (Number.isFinite(params.x)) game.location.x = params.x;
    if (Number.isFinite(params.y)) game.location.y = params.y;
    if (params.dir && DIRS.includes(params.dir)) game.location.dir = params.dir;
    this.reveal = params.reveal ? params.reveal === '1' : debug.active;
    this.post = { vignette: 0.6 };

    const size = Math.min(window.innerHeight * 0.72, window.innerWidth * 0.55);
    this.canvas = h('canvas', { width: Math.round(size * 2), height: Math.round(size * 2), style: { width: `${size}px`, height: `${size}px`, display: 'block' } });
    const frame = Frame({ title: this.map.name, variant: 'parchment', children: [this.canvas] });
    frame.el.style.padding = '1.2em';
    const bar = new CommandBar([{ id: 'exit', label: 'Exit', key: 'X', onSelect: () => this.close() }], { title: 'Area' });
    this.own(() => bar.dispose());
    const legend = h('div', { style: { marginTop: '0.8em', fontSize: '0.85em', color: 'var(--por-text-dim)', textAlign: 'center' } }, ['Walls · Doors · Arches · Party ▲   —   press M or Esc to return']);
    const root = h('div.por-center', { style: { background: this.transparent ? 'rgba(3,5,12,0.72)' : 'radial-gradient(ellipse at center, #1a2244, #05070f)' } }, [
      h('div', [frame.el, legend]),
    ]);
    this.ctx.ui.mount(root);
    const bottom = h('div.por-hud-bottom', [bar.el]);
    this.ctx.ui.mount(bottom);
    this.own(() => { root.remove(); bottom.remove(); });
    this.listen('input:action', ({ action }) => {
      if (this.ctx.scenes.current === this && (action === 'area' || action === 'cancel')) this.close();
    });
    this.draw();
  }

  close() {
    if (this.transparent) this.ctx.scenes.pop();
    else this.ctx.scenes.goto('explore', {});
  }

  draw() {
    const c = this.canvas;
    const g = c.getContext('2d');
    const W = c.width;
    const m = this.map;
    const pad = W * 0.05;
    const cs = (W - pad * 2) / m.w;
    // parchment background (procedural, low-res then upscaled)
    const bg = document.createElement('canvas');
    bg.width = bg.height = 128;
    const bgc = bg.getContext('2d');
    const img = bgc.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const n = fbm(x / 32, y / 32, { period: 4, octaves: 5, seed: 3 });
      const i = (y * 128 + x) * 4;
      img.data[i] = 226 * (0.85 + n * 0.25);
      img.data[i + 1] = 206 * (0.85 + n * 0.25);
      img.data[i + 2] = 160 * (0.8 + n * 0.25);
      img.data[i + 3] = 255;
    }
    bgc.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(bg, 0, 0, W, W);
    const { game } = this.ctx;
    const seen = (x, y) => this.reveal || game.isExplored(m.id, x, y, m.w);
    const tint = { [CELL.INTERIOR]: 'rgba(120,80,40,0.18)', [CELL.RUBBLE]: 'rgba(90,70,50,0.22)', [CELL.COURTYARD]: 'rgba(60,70,90,0.12)', [CELL.WATER]: 'rgba(40,80,120,0.4)' };
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const X = pad + x * cs;
      const Y = pad + y * cs;
      if (!seen(x, y)) {
        g.fillStyle = 'rgba(70,50,30,0.35)';
        g.fillRect(X, Y, cs, cs);
        continue;
      }
      const t = tint[m.getCell(x, y)];
      if (t) {
        g.fillStyle = t;
        g.fillRect(X, Y, cs, cs);
      }
      g.strokeStyle = 'rgba(60,40,20,0.12)';
      g.lineWidth = 1;
      g.strokeRect(X, Y, cs, cs);
    }
    g.lineCap = 'round';
    const edgeLine = (x, y, dir) => {
      const e = m.getEdge(x, y, dir);
      if (e === EDGE.OPEN || !(seen(x, y))) return;
      const X = pad + x * cs;
      const Y = pad + y * cs;
      const [x0, y0, x1, y1] = { N: [X, Y, X + cs, Y], S: [X, Y + cs, X + cs, Y + cs], W: [X, Y, X, Y + cs], E: [X + cs, Y, X + cs, Y + cs] }[dir];
      g.strokeStyle = '#2a1a0c';
      g.lineWidth = cs * 0.09;
      if (e === EDGE.WALL || e === EDGE.SECRET) {
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      } else {
        // door/arch: wall with a gap + marker
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const gx = (x1 - x0) * 0.3;
        const gy = (y1 - y0) * 0.3;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(mx - gx, my - gy); g.moveTo(mx + gx, my + gy); g.lineTo(x1, y1); g.stroke();
        if (e !== EDGE.ARCH) {
          g.fillStyle = e === EDGE.LOCKED ? '#8a1f18' : '#7a4a1a';
          const horiz = y0 === y1;
          g.fillRect(mx - (horiz ? gx : cs * 0.07), my - (horiz ? cs * 0.07 : gy), horiz ? gx * 2 : cs * 0.14, horiz ? cs * 0.14 : gy * 2);
        }
      }
    };
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) for (const d of DIRS) edgeLine(x, y, d);
    // party marker
    const { x, y, dir } = game.location;
    const px = pad + x * cs + cs / 2;
    const py = pad + y * cs + cs / 2;
    const ang = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 }[dir];
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.fillStyle = '#b8322b';
    g.strokeStyle = '#2a0a06';
    g.lineWidth = cs * 0.05;
    g.beginPath();
    g.moveTo(0, -cs * 0.36); g.lineTo(cs * 0.26, cs * 0.28); g.lineTo(0, cs * 0.14); g.lineTo(-cs * 0.26, cs * 0.28); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    // title cartouche
    g.fillStyle = '#3a2410';
    g.font = `italic ${Math.round(cs * 0.55)}px Georgia, serif`;
    g.textAlign = 'right';
    g.fillText(`${m.name} — ${x},${y}`, W - pad, W - pad * 0.3);
  }
}
