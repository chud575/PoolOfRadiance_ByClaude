/**
 * Grid map model, faithful to the Gold Box format: a W x H grid of cells
 * (16x16 per city block), each cell has an edge type on each of its four sides.
 * Coordinates: x grows EAST, y grows SOUTH, (0,0) is the north-west corner.
 *
 * Edges are stored once per cell side and kept consistent with the neighbour
 * (setting (x,y,E) also sets (x+1,y,W)).
 */
export const DIRS = ['N', 'E', 'S', 'W'];
export const DIR_INDEX = { N: 0, E: 1, S: 2, W: 3 };
export const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const OPPOSITE = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const turnLeft = (d) => DIRS[(DIR_INDEX[d] + 3) % 4];
export const turnRight = (d) => DIRS[(DIR_INDEX[d] + 1) % 4];
/** Yaw in radians for a facing (three.js: -Z is north, rotation about +Y). */
export const DIR_YAW = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };

export const EDGE = Object.freeze({
  OPEN: 0,
  WALL: 1,
  DOOR: 2,
  LOCKED: 3, // locked door: needs thief/bash/key
  SECRET: 4, // looks like a wall until found with SEARCH
  ARCH: 5, // open archway / gate (passable, drawn as a frame)
});
export const EDGE_NAMES = ['open', 'wall', 'door', 'locked', 'secret', 'arch'];

export const CELL = Object.freeze({
  STREET: 0, // open sky, cobbles
  INTERIOR: 1, // roofed, wooden floor
  RUBBLE: 2, // open sky, broken ground
  WATER: 3, // impassable water
  COURTYARD: 4, // open sky, flagstones
});

export class MapGrid {
  /**
   * @param {Object} meta
   * @param {string} meta.id
   * @param {string} meta.name
   * @param {number} [meta.w] @param {number} [meta.h]
   * @param {'city'|'dungeon'|'wilderness'} [meta.kind]
   * @param {string} [meta.wallSet]
   * @param {boolean} [meta.outdoors]
   */
  constructor(meta) {
    this.id = meta.id;
    this.name = meta.name;
    this.w = meta.w ?? 16;
    this.h = meta.h ?? 16;
    this.kind = meta.kind ?? 'city';
    this.wallSet = meta.wallSet ?? 'phlan_stone';
    this.outdoors = meta.outdoors ?? true;
    this.start = meta.start ?? { x: 0, y: 0, dir: 'N' };
    this.edges = new Uint8Array(this.w * this.h * 4);
    /** Style index per edge side (renderer material variant; 0 = default). */
    this.edgeStyle = new Uint8Array(this.w * this.h * 4);
    this.cells = new Uint8Array(this.w * this.h);
    /** @type {import('../schema.js').MapEvent[]} */
    this.events = [];
    /** Named zones for flavour text: [{name, x, y, w, h}] */
    this.zones = [];
    /** Links to other maps: [{x,y,dir,to,tx,ty,tdir}] */
    this.exits = [];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  _i(x, y, dir) {
    return (y * this.w + x) * 4 + DIR_INDEX[dir];
  }

  getEdge(x, y, dir) {
    if (!this.inBounds(x, y)) return EDGE.WALL;
    return this.edges[this._i(x, y, dir)];
  }

  getEdgeStyle(x, y, dir) {
    if (!this.inBounds(x, y)) return 0;
    return this.edgeStyle[this._i(x, y, dir)];
  }

  /** Set an edge on both sides. */
  setEdge(x, y, dir, type, style = 0) {
    if (this.inBounds(x, y)) {
      this.edges[this._i(x, y, dir)] = type;
      this.edgeStyle[this._i(x, y, dir)] = style;
    }
    const [dx, dy] = DIR_VEC[dir];
    const nx = x + dx;
    const ny = y + dy;
    if (this.inBounds(nx, ny)) {
      this.edges[this._i(nx, ny, OPPOSITE[dir])] = type;
      this.edgeStyle[this._i(nx, ny, OPPOSITE[dir])] = style;
    }
    return this;
  }

  getCell(x, y) {
    return this.inBounds(x, y) ? this.cells[y * this.w + x] : CELL.WATER;
  }

  setCell(x, y, type) {
    if (this.inBounds(x, y)) this.cells[y * this.w + x] = type;
    return this;
  }

  /** Fill a rectangle of cells with a cell type. */
  fill(x, y, w, h, type) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.setCell(i, j, type);
    return this;
  }

  /** Walls around the whole map. */
  border(type = EDGE.WALL, style = 0) {
    for (let x = 0; x < this.w; x++) {
      this.setEdge(x, 0, 'N', type, style);
      this.setEdge(x, this.h - 1, 'S', type, style);
    }
    for (let y = 0; y < this.h; y++) {
      this.setEdge(0, y, 'W', type, style);
      this.setEdge(this.w - 1, y, 'E', type, style);
    }
    return this;
  }

  /**
   * A building: walls around the outside of the cell rectangle, interior
   * cells marked INTERIOR. doors: [{x,y,dir,type?}]
   */
  building(x, y, w, h, { doors = [], style = 0, cell = CELL.INTERIOR } = {}) {
    for (let i = x; i < x + w; i++) {
      this.setEdge(i, y, 'N', EDGE.WALL, style);
      this.setEdge(i, y + h - 1, 'S', EDGE.WALL, style);
    }
    for (let j = y; j < y + h; j++) {
      this.setEdge(x, j, 'W', EDGE.WALL, style);
      this.setEdge(x + w - 1, j, 'E', EDGE.WALL, style);
    }
    this.fill(x, y, w, h, cell);
    for (const d of doors) this.setEdge(d.x, d.y, d.dir, d.type ?? EDGE.DOOR, style);
    return this;
  }

  /** Add an event. */
  event(ev) {
    this.events.push({ once: false, ...ev });
    return this;
  }

  zone(name, x, y, w, h) {
    this.zones.push({ name, x, y, w, h });
    return this;
  }

  zoneAt(x, y) {
    return this.zones.find((z) => x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h)?.name ?? this.name;
  }

  eventsAt(x, y) {
    return this.events.filter((e) => e.x === x && e.y === y);
  }

  /**
   * Movement query from (x,y) towards dir.
   * @returns {{ok:boolean, edge:number, nx:number, ny:number, leaves:boolean, reason?:string}}
   */
  tryMove(x, y, dir, { foundSecrets } = {}) {
    const edge = this.getEdge(x, y, dir);
    const [dx, dy] = DIR_VEC[dir];
    const nx = x + dx;
    const ny = y + dy;
    const leaves = !this.inBounds(nx, ny);
    const passable =
      edge === EDGE.OPEN || edge === EDGE.DOOR || edge === EDGE.ARCH ||
      (edge === EDGE.SECRET && foundSecrets?.has?.(`${x},${y},${dir}`));
    if (!passable) {
      return { ok: false, edge, nx, ny, leaves, reason: edge === EDGE.LOCKED ? 'locked' : 'wall' };
    }
    if (leaves) {
      const exit = this.exits.find((e) => e.x === x && e.y === y && e.dir === dir);
      return { ok: !!exit, edge, nx, ny, leaves, exit, reason: exit ? undefined : 'edge' };
    }
    if (this.getCell(nx, ny) === CELL.WATER) return { ok: false, edge, nx, ny, leaves, reason: 'water' };
    return { ok: true, edge, nx, ny, leaves };
  }

  /**
   * ASCII rendering (2W+1 x 2H+1): '+' corners, '-'/'|' walls, 'D' door,
   * 'L' locked, 'S' secret, 'A' arch, cells '.' street ':' interior ',' rubble '~' water.
   */
  toAscii() {
    const ch = { 0: ' ', 1: null, 2: 'D', 3: 'L', 4: 'S', 5: 'A' };
    const cellCh = ['.', ':', ',', '~', '_'];
    const lines = [];
    for (let y = 0; y < this.h; y++) {
      let top = '';
      let mid = '';
      for (let x = 0; x < this.w; x++) {
        const n = this.getEdge(x, y, 'N');
        const w = this.getEdge(x, y, 'W');
        top += '+' + (n === EDGE.WALL ? '-' : ch[n]);
        mid += (w === EDGE.WALL ? '|' : ch[w]) + cellCh[this.getCell(x, y)];
      }
      top += '+';
      const e = this.getEdge(this.w - 1, y, 'E');
      mid += e === EDGE.WALL ? '|' : ch[e];
      lines.push(top, mid);
    }
    let bottom = '';
    for (let x = 0; x < this.w; x++) {
      const s = this.getEdge(x, this.h - 1, 'S');
      bottom += '+' + (s === EDGE.WALL ? '-' : ch[s]);
    }
    lines.push(bottom + '+');
    return lines.join('\n');
  }
}
