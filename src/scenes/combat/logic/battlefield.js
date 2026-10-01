import { EDGE, CELL } from '../../../data/maps/MapGrid.js';

/**
 * Tactical battlefield derived from the exploration map around the party, the way
 * the Gold Box games cut the combat map out of the area you were standing in.
 * Every map cell becomes SUB x SUB combat squares; map walls become walls along
 * square edges; buildings the party can't reach become solid blocks (rendered as
 * roofed houses); reachable interiors become roofless cut-away rooms.
 *
 * Pure data + queries (no three.js): pathfinding, line of sight, templates.
 */
export const SUB = 3;

/** 8 directions: index 0 = N, clockwise. dx grows east, dy grows south. */
export const DIR8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Battlefield {
  /**
   * @param {import('../../../data/maps/MapGrid.js').MapGrid|null} map
   * @param {{x:number, y:number, dir?:string}} at  party cell on the map
   * @param {{cellsW?:number, cellsH?:number, seed?:number}} [o]
   */
  constructor(map, at, o = {}) {
    this.map = map;
    this.seed = o.seed ?? 1;
    const cw = Math.min(o.cellsW ?? 7, map?.w ?? 7);
    const ch = Math.min(o.cellsH ?? 5, map?.h ?? 5);
    const ax = map ? Math.max(0, Math.min(map.w - 1, at.x)) : 3;
    const ay = map ? Math.max(0, Math.min(map.h - 1, at.y)) : 2;
    this.cx0 = map ? Math.max(0, Math.min(map.w - cw, ax - Math.floor(cw / 2))) : 0;
    this.cy0 = map ? Math.max(0, Math.min(map.h - ch, ay - Math.floor(ch / 2))) : 0;
    this.cellsW = cw;
    this.cellsH = ch;
    this.partyCell = { x: ax, y: ay };
    this.w = cw * SUB;
    this.h = ch * SUB;
    const n = this.w * this.h;
    /** 0 free, 1 solid building, 2 prop/rubble (blocks move, not sight), 3 water */
    this.block = new Uint8Array(n);
    /** terrain kind per square: CELL.* of its map cell, or 99 for solid */
    this.kind = new Uint8Array(n);
    /** walls on the east / south side of each square (blocks move + sight) */
    this.wallE = new Uint8Array(n);
    this.wallS = new Uint8Array(n);
    /** style of those walls (map edge style: 0 stone, 1 timber, 2 ruin) and type (EDGE.*) */
    this.wallEStyle = new Uint8Array(n);
    this.wallSStyle = new Uint8Array(n);
    /** squares on the window rim that lead out of the fight (flee) — bitmask of N1 E2 S4 W8 */
    this.exitMask = new Uint8Array(n);
    /** Features for the renderer. */
    this.features = { solids: [], rooms: [], edgeWalls: [], doors: [], props: [], torches: [], border: [] };
    if (map) this._derive();
    else this._openField();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  cellOf(x, y) { return { x: this.cx0 + Math.floor(x / SUB), y: this.cy0 + Math.floor(y / SUB) }; }

  _openField() {
    for (let i = 0; i < this.w * this.h; i++) this.kind[i] = CELL.STREET;
    for (let x = 0; x < this.w; x++) { this.exitMask[this.idx(x, 0)] |= 1; this.exitMask[this.idx(x, this.h - 1)] |= 4; }
    for (let y = 0; y < this.h; y++) { this.exitMask[this.idx(0, y)] |= 8; this.exitMask[this.idx(this.w - 1, y)] |= 2; }
  }

  _derive() {
    const m = this.map;
    const cw = this.cellsW;
    const chh = this.cellsH;
    const inWin = (x, y) => x >= this.cx0 && y >= this.cy0 && x < this.cx0 + cw && y < this.cy0 + chh;
    // Flood fill reachable cells (through open/door/arch edges) inside the window.
    const reach = new Set();
    const key = (x, y) => `${x},${y}`;
    const q = [[this.partyCell.x, this.partyCell.y]];
    reach.add(key(...q[0]));
    const passable = (e) => e === EDGE.OPEN || e === EDGE.DOOR || e === EDGE.ARCH;
    // Interiors are only part of the fight when the party stands inside that building:
    // the fight spills out of its doors, but other houses stay shut (solid, roofed).
    const home = new Set();
    if (m.getCell(this.partyCell.x, this.partyCell.y) === CELL.INTERIOR) {
      const hq = [[this.partyCell.x, this.partyCell.y]];
      home.add(key(...hq[0]));
      while (hq.length) {
        const [x, y] = hq.shift();
        for (const [d, dx, dy] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inWin(nx, ny) || home.has(key(nx, ny)) || m.getCell(nx, ny) !== CELL.INTERIOR) continue;
          if (!passable(m.getEdge(x, y, d))) continue;
          home.add(key(nx, ny));
          hq.push([nx, ny]);
        }
      }
    }
    while (q.length) {
      const [x, y] = q.shift();
      for (const [d, dx, dy] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inWin(nx, ny) || reach.has(key(nx, ny))) continue;
        if (!passable(m.getEdge(x, y, d)) || m.getCell(nx, ny) === CELL.WATER) continue;
        if (m.getCell(nx, ny) === CELL.INTERIOR && !home.has(key(nx, ny))) continue;
        reach.add(key(nx, ny));
        q.push([nx, ny]);
      }
    }
    // Rubble-walled ruins that are reachable are passable ground; interiors reachable → rooms.
    this.reachCells = reach;
    const isReach = (x, y) => reach.has(key(x, y));
    for (let cy = 0; cy < chh; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const mx = this.cx0 + cx;
        const my = this.cy0 + cy;
        const cell = m.getCell(mx, my);
        const r = isReach(mx, my);
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const i = this.idx(cx * SUB + sx, cy * SUB + sy);
            this.kind[i] = r ? cell : 99;
            this.block[i] = r ? (cell === CELL.WATER ? 3 : 0) : 1;
          }
        }
        if (!r) this.features.solids.push({ cx, cy, mx, my, cell });
        else if (cell === CELL.INTERIOR) this.features.rooms.push({ cx, cy, mx, my });
      }
    }
    // Group solid cells into building blocks for the renderer (same style runs).
    // Edges: walk every reachable cell's 4 sides.
    for (let cy = 0; cy < chh; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const mx = this.cx0 + cx;
        const my = this.cy0 + cy;
        if (!isReach(mx, my)) continue;
        for (const [d, dx, dy] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
          const e = m.getEdge(mx, my, d);
          const style = m.getEdgeStyle(mx, my, d);
          const nx = mx + dx;
          const ny = my + dy;
          const neighbourReach = isReach(nx, ny);
          const neighbourInWin = inWin(nx, ny);
          const outOfMap = !m.inBounds(nx, ny);
          // Square coordinates of the boundary run.
          const run = [];
          for (let k = 0; k < SUB; k++) {
            if (d === 'N') run.push([cx * SUB + k, cy * SUB, 'N']);
            if (d === 'S') run.push([cx * SUB + k, cy * SUB + SUB - 1, 'S']);
            if (d === 'W') run.push([cx * SUB, cy * SUB + k, 'W']);
            if (d === 'E') run.push([cx * SUB + SUB - 1, cy * SUB + k, 'E']);
          }
          if (neighbourReach) {
            // Only record once per pair (E and S sides).
            if (d === 'N' || d === 'W') continue;
            if (e === EDGE.OPEN) continue;
            run.forEach(([x, y], k) => {
              const gap = (e === EDGE.DOOR || e === EDGE.ARCH) && k === 1;
              if (!gap) this._setWall(x, y, d, style);
            });
            this.features.edgeWalls.push({ cx, cy, dir: d, type: e, style });
            if (e === EDGE.DOOR || e === EDGE.ARCH) this.features.doors.push({ cx, cy, dir: d, type: e, style, open: true });
            continue;
          }
          if (!neighbourInWin) {
            // Window rim: out of the map = city wall; else open street beyond → flee edge.
            if (outOfMap || !passable(e)) {
              this.features.border.push({ cx, cy, dir: d, type: e, style, outOfMap });
              if (outOfMap && e === EDGE.ARCH) {
                // A gate in the city wall is a way out.
                const [x, y] = run[1];
                this.exitMask[this.idx(x, y)] |= { N: 1, E: 2, S: 4, W: 8 }[d];
              }
              continue;
            }
            for (const [x, y] of run) this.exitMask[this.idx(x, y)] |= { N: 1, E: 2, S: 4, W: 8 }[d];
            continue;
          }
          // Neighbour is in the window but solid: the building's face. Doors are drawn shut.
          if (e === EDGE.DOOR || e === EDGE.LOCKED || e === EDGE.SECRET || e === EDGE.ARCH) {
            this.features.doors.push({ cx, cy, dir: d, type: e, style, open: false, face: true });
          }
        }
      }
    }
    this._scatterProps();
  }

  _setWall(x, y, d, style) {
    if (d === 'E' && this.inBounds(x, y)) { this.wallE[this.idx(x, y)] = 1; this.wallEStyle[this.idx(x, y)] = style; }
    if (d === 'S' && this.inBounds(x, y)) { this.wallS[this.idx(x, y)] = 1; this.wallSStyle[this.idx(x, y)] = style; }
    if (d === 'W' && this.inBounds(x - 1, y)) { this.wallE[this.idx(x - 1, y)] = 1; this.wallEStyle[this.idx(x - 1, y)] = style; }
    if (d === 'N' && this.inBounds(x, y - 1)) { this.wallS[this.idx(x, y - 1)] = 1; this.wallSStyle[this.idx(x, y - 1)] = style; }
  }

  /** Deterministic clutter: rubble piles in ruins, barrels/crates against buildings. */
  _scatterProps() {
    const s = this.seed;
    const party = this.partyCell;
    // Large reachable interiors are halls/temples: an aisle of columns, an altar and statue.
    const rooms = this.features.rooms;
    if (rooms.length >= 6) {
      const xs = rooms.map((r) => r.cx);
      const ys = rooms.map((r) => r.cy);
      const rx0 = Math.min(...xs) * SUB;
      const ry0 = Math.min(...ys) * SUB;
      const rw = (Math.max(...xs) + 1) * SUB - rx0;
      const rh = (Math.max(...ys) + 1) * SUB - ry0;
      const cx = rx0 + Math.floor(rw / 2);
      const put = (x, y, type) => {
        if (!this.isFree(x, y)) return;
        this.block[this.idx(x, y)] = 2;
        this.features.props.push({ x, y, type, r: hash(x, y, s) });
      };
      this.features.hall = { x0: rx0, y0: ry0, w: rw, h: rh, cx };
      put(cx, ry0, 'statue');
      put(cx, ry0 + 1, 'altar');
      for (let ly = 2; ly < rh - 1; ly += 3) {
        put(rx0 + 1, ry0 + ly, 'column');
        put(rx0 + rw - 2, ry0 + ly, 'column');
      }
      // The ruin: a toppled column across the side aisle, rubble heaped in the corners.
      put(rx0 + 2, ry0 + Math.min(rh - 3, 6), 'fallen');
      put(rx0 + rw - 1, ry0 + rh - 1, 'rubble');
      put(rx0, ry0 + rh - 1, 'rubble');
      put(rx0 + rw - 1, ry0, 'rubble');
    }
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        if (this.block[i]) continue;
        const cell = this.cellOf(x, y);
        if (cell.x === party.x && cell.y === party.y) continue; // keep the party's cell clear
        const k = this.kind[i];
        const r = hash(x + this.cx0 * SUB, y + this.cy0 * SUB, s + 3);
        const nearSolid = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.inBounds(x + dx, y + dy) && this.block[this.idx(x + dx, y + dy)] === 1);
        const onRim = this.exitMask[i] !== 0;
        if (onRim) continue;
        let type = null;
        if (k === CELL.RUBBLE && r < 0.2) type = 'rubble';
        else if (nearSolid && r < 0.07) type = r < 0.035 ? 'barrel' : 'crate';
        else if (k === CELL.COURTYARD && r > 0.975) type = 'column';
        else if (k === CELL.INTERIOR && r < 0.05) type = 'debris';
        if (type) {
          this.block[i] = 2;
          this.features.props.push({ x, y, type, r });
        }
      }
    }
  }

  isFree(x, y) { return this.inBounds(x, y) && this.block[this.idx(x, y)] === 0; }

  /** Rough ground (loose rubble, broken paving): entering it costs half a move extra. */
  isRough(x, y) { return this.inBounds(x, y) && this.kind[this.idx(x, y)] === CELL.RUBBLE && this.block[this.idx(x, y)] === 0; }

  /** Movement cost of one step (diagonals 1½, +½ into rough ground). */
  stepCost(x0, y0, x1, y1) {
    return (x1 !== x0 && y1 !== y0 ? 1.5 : 1) + (this.isRough(x1, y1) ? 0.5 : 0);
  }

  /** Is there a wall between orthogonally adjacent squares a→b? */
  wallBetween(ax, ay, bx, by) {
    if (bx === ax + 1 && by === ay) return !!this.wallE[this.idx(ax, ay)];
    if (bx === ax - 1 && by === ay) return !!this.wallE[this.idx(bx, by)];
    if (by === ay + 1 && bx === ax) return !!this.wallS[this.idx(ax, ay)];
    if (by === ay - 1 && bx === ax) return !!this.wallS[this.idx(bx, by)];
    return false;
  }

  /** Can one step from a to adjacent b (8-way) be taken, ignoring occupants? No corner cutting. */
  canStep(ax, ay, bx, by) {
    if (!this.isFree(bx, by)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx && dy) {
      // Both orthogonal intermediates must be open (no squeezing past corners).
      if (!this.isFree(ax + dx, ay) || !this.isFree(ax, ay + dy)) return false;
      if (this.wallBetween(ax, ay, ax + dx, ay) || this.wallBetween(ax + dx, ay, bx, by)) return false;
      if (this.wallBetween(ax, ay, ax, ay + dy) || this.wallBetween(ax, ay + dy, bx, by)) return false;
      return true;
    }
    return !this.wallBetween(ax, ay, bx, by);
  }

  /** Squares from which a combatant can step off the battlefield, with the step dir. */
  exitDir(x, y) {
    const m = this.inBounds(x, y) ? this.exitMask[this.idx(x, y)] : 0;
    if (!m) return null;
    return m & 1 ? [0, -1] : m & 2 ? [1, 0] : m & 4 ? [0, 1] : [-1, 0];
  }

  /**
   * Dijkstra over squares from (sx,sy). Orthogonal step 1, diagonal 1.5.
   * @param {(x:number,y:number)=>boolean} occupied squares that cannot be entered
   * @param {number} maxCost
   * @returns {{cost: Float32Array, prev: Int32Array}}
   */
  flood(sx, sy, occupied, maxCost = 99) {
    const n = this.w * this.h;
    const cost = new Float32Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const start = this.idx(sx, sy);
    cost[start] = 0;
    // Small binary heap.
    const heap = [[0, start]];
    const push = (c, i) => {
      heap.push([c, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c, i] = pop();
      if (c > cost[i]) continue;
      const x = i % this.w;
      const y = (i / this.w) | 0;
      for (let d = 0; d < 8; d++) {
        const [dx, dy] = DIR8[d];
        const nx = x + dx;
        const ny = y + dy;
        if (!this.canStep(x, y, nx, ny)) continue;
        if (occupied(nx, ny)) continue;
        const nc = c + this.stepCost(x, y, nx, ny);
        if (nc > maxCost + 1e-6) continue;
        const ni = this.idx(nx, ny);
        if (nc < cost[ni] - 1e-6) {
          cost[ni] = nc;
          prev[ni] = i;
          push(nc, ni);
        }
      }
    }
    return { cost, prev };
  }

  /** Reconstruct a path (excluding start) to (tx,ty) from a flood result. */
  pathTo(fl, tx, ty) {
    let i = this.idx(tx, ty);
    if (!Number.isFinite(fl.cost[i])) return null;
    const out = [];
    while (fl.prev[i] >= 0) {
      out.push({ x: i % this.w, y: (i / this.w) | 0, cost: fl.cost[i] });
      i = fl.prev[i];
    }
    return out.reverse();
  }

  /**
   * Line of sight between square centres: blocked by solid squares and walls
   * (props and creatures don't block sight).
   */
  los(ax, ay, bx, by) {
    return this.losBlock(ax, ay, bx, by) >= 1;
  }

  /**
   * Fraction (0..1) of the way from a to b at which sight is first blocked;
   * 1 when the line is clear. Used to draw the targeting ray red past the block.
   */
  losBlock(ax, ay, bx, by) {
    if (ax === bx && ay === by) return 1;
    const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 4);
    let px = ax;
    let py = ay;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const fx = ax + (bx - ax) * t;
      const fy = ay + (by - ay) * t;
      const x = Math.round(fx);
      const y = Math.round(fy);
      if (x !== px || y !== py) {
        if (this.inBounds(x, y) && this.block[this.idx(x, y)] === 1) return Math.max(0, t - 0.5 / steps);
        if (x !== px && y !== py) {
          // Diagonal transition: blocked only if both orthogonal routes are blocked.
          const r1 = this.wallBetween(px, py, x, py) || this.wallBetween(x, py, x, y) || this.block[this.idx(x, py)] === 1;
          const r2 = this.wallBetween(px, py, px, y) || this.wallBetween(px, y, x, y) || this.block[this.idx(px, y)] === 1;
          if (r1 && r2) return Math.max(0, t - 0.5 / steps);
        } else if (this.wallBetween(px, py, x, y)) return Math.max(0, t - 0.5 / steps);
        px = x;
        py = y;
      }
    }
    return 1;
  }

  /** Chebyshev distance in squares (Gold Box range counting). */
  static dist(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  /** Squares affected by an area template. */
  template(shape, from, to, size = 1) {
    const out = [];
    const add = (x, y) => this.inBounds(x, y) && this.block[this.idx(x, y)] !== 1 && out.push({ x, y });
    if (shape === 'radius') {
      const r = size + 0.5;
      for (let y = Math.floor(to.y - r); y <= to.y + r; y++) {
        for (let x = Math.floor(to.x - r); x <= to.x + r; x++) {
          if ((x - to.x) ** 2 + (y - to.y) ** 2 <= r * r && this.los(to.x, to.y, x, y)) add(x, y);
        }
      }
    } else if (shape === 'square') {
      // size x size block anchored so the target is (roughly) central.
      const o = Math.floor((size - 1) / 2);
      for (let y = to.y - o; y < to.y - o + size; y++) for (let x = to.x - o; x < to.x - o + size; x++) add(x, y);
    } else if (shape === 'cone') {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      for (let y = from.y - size; y <= from.y + size; y++) {
        for (let x = from.x - size; x <= from.x + size; x++) {
          if (x === from.x && y === from.y) continue;
          const vx = x - from.x;
          const vy = y - from.y;
          const d = Math.hypot(vx, vy);
          if (d > size + 0.5) continue;
          const cos = (vx * ux + vy * uy) / d;
          if (cos >= 0.72 && this.los(from.x, from.y, x, y)) add(x, y);
        }
      }
    } else if (shape === 'line') {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const seen = new Set();
      let lx = from.x;
      let ly = from.y;
      for (let s = 1; s <= size * 3; s++) {
        const t = s / 3;
        const x = Math.round(from.x + (dx / len) * t);
        const y = Math.round(from.y + (dy / len) * t);
        if (!this.inBounds(x, y) || this.block[this.idx(x, y)] === 1) break;
        if (x !== lx || y !== ly) {
          if ((x === lx || y === ly) && this.wallBetween(lx, ly, x, y)) break;
          lx = x;
          ly = y;
        }
        const k = `${x},${y}`;
        if (!seen.has(k) && !(x === from.x && y === from.y)) {
          seen.add(k);
          add(x, y);
        }
      }
    } else {
      add(to.x, to.y);
    }
    return out;
  }
}
