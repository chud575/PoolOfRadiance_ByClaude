import * as THREE from 'three';
import { EDGE, CELL } from '../../data/maps/MapGrid.js';
import { SHEET, collectEdges, mergeRuns } from './BlockSheet.js';
import { makeCanvas, makeDesk, grainTile, prng } from './ink.js';
import { PIN_KINDS, drawPin } from './glyphs.js';
import { SERIF } from './ornaments.js';
import { hash2, fbm } from '../../render/textures/noise.js';
import { preloadTextureSets, getTextureSet } from '../../render/textures/index.js';

/** Shared procedural material sets the miniature is built from (cached library sets; never disposed here). */
const SETS = ['hd_ashlar', 'hd_ashlar_cold', 'hd_plaster', 'hd_beam_dark', 'hd_ruin', 'hd_door', 'hd_iron', 'hd_rock', 'hd_water'];

/**
 * Geometry accumulator: boxes with world-scaled UVs (so shared tiling texture
 * sets read as miniature masonry courses without per-mesh repeat) and a baked
 * ambient-occlusion ramp in the vertex colours (dark at the foot of a wall).
 */
class Batch {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.i = [];
  }

  _v(x, y, z, nx, ny, nz, u, v, c) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    this.c.push(c, c, c);
    return this.p.length / 3 - 1;
  }

  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }

  /**
   * Box centred at (cx, cy, cz) with size (sx, sy, sz), yawed by ry.
   * uv: 'world' (scale us per unit) or 'local' (0..1 across each face).
   */
  box(cx, cy, cz, sx, sy, sz, { ry = 0, us = 1.6, uo = 0, vo = 0, uv = 'world', ao = 0.45, aoH = 0.09, tint = 1, top = true, uvFn = null } = {}) {
    const cr = Math.cos(ry);
    const sr = Math.sin(ry);
    const W = (lx, ly, lz) => [cx + lx * cr + lz * sr, cy + ly, cz - lx * sr + lz * cr];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const y0 = cy - hy;
    const shade = (y) => tint * (ao >= 1 ? 1 : Math.min(1, ao + (1 - ao) * Math.min(1, (y - y0) / Math.max(1e-4, Math.min(aoH, sy * 0.6))) ** 0.8));
    // side faces: [local normal, axis along u (local), half extents]
    const sides = [
      [[1, 0, 0], [0, 0, -1], hx, hz],
      [[-1, 0, 0], [0, 0, 1], hx, hz],
      [[0, 0, 1], [1, 0, 0], hz, hx],
      [[0, 0, -1], [-1, 0, 0], hz, hx],
    ];
    const split = Math.min(aoH, sy * 0.6);
    const rows = ao < 1 && sy > split * 1.5 ? [-hy, -hy + split, hy] : [-hy, hy];
    for (const [nl, al, dOff, half] of sides) {
      const n = [nl[0] * cr + nl[2] * sr, 0, -nl[0] * sr + nl[2] * cr];
      const ids = [];
      for (const ly of rows) {
        const row = [];
        for (const s of [-1, 1]) {
          const lx = nl[0] * dOff + al[0] * half * s;
          const lz = nl[2] * dOff + al[2] * half * s;
          const P = W(lx, ly, lz);
          let u;
          let v;
          if (uvFn) {
            [u, v] = uvFn(P[0], P[2]);
          } else if (uv === 'local') {
            u = (s + 1) / 2;
            v = (ly + hy) / sy;
          } else {
            const along = Math.abs(n[0]) > Math.abs(n[2]) ? P[2] * -Math.sign(n[0]) : P[0] * Math.sign(n[2]);
            u = along * us + uo;
            v = P[1] * us + vo;
          }
          row.push(this._v(P[0], P[1], P[2], n[0], n[1], n[2], u, v, shade(P[1])));
        }
        ids.push(row);
      }
      for (let r = 0; r < ids.length - 1; r++) this.quad(ids[r][0], ids[r][1], ids[r + 1][1], ids[r + 1][0]);
    }
    if (top) {
      const q = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => {
        const P = W(lx, hy, lz);
        let u = uv === 'local' ? (lx + hx) / sx : P[0] * us + uo;
        let v = uv === 'local' ? (lz + hz) / sz : P[2] * us + vo;
        if (uvFn) [u, v] = uvFn(P[0], P[2]);
        return this._v(P[0], P[1], P[2], 0, 1, 0, u, v, tint);
      });
      this.quad(q[3], q[2], q[1], q[0]);
    }
  }

  /**
   * A box whose top edges are chamfered (a 45-degree bevel ring round an
   * inset top), so cut stone and planks catch a highlight along their arrises.
   */
  bevelBox(cx, cy, cz, sx, sy, sz, o = {}) {
    const b = Math.max(0.001, Math.min(o.bevel ?? 0.012, sx * 0.3, sz * 0.3, sy * 0.4));
    this.box(cx, cy - b / 2, cz, sx, sy - b, sz, { ...o, top: false });
    const ry = o.ry ?? 0;
    const cr = Math.cos(ry);
    const sr = Math.sin(ry);
    const W = (lx, ly, lz) => [cx + lx * cr + lz * sr, ly, cz - lx * sr + lz * cr];
    const hx = sx / 2;
    const hz = sz / 2;
    const yt = cy + sy / 2 - b;
    const ytop = cy + sy / 2;
    const tint = o.tint ?? 1;
    const us = o.us ?? 1.6;
    const outer = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    const inner = [[-hx + b, -hz + b], [hx - b, -hz + b], [hx - b, hz - b], [-hx + b, hz - b]];
    const nl = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const nx = (nl[i][0] * cr + nl[i][1] * sr) * Math.SQRT1_2;
      const nz = (-nl[i][0] * sr + nl[i][1] * cr) * Math.SQRT1_2;
      const pts = [W(outer[i][0], yt, outer[i][1]), W(outer[j][0], yt, outer[j][1]), W(inner[j][0], ytop, inner[j][1]), W(inner[i][0], ytop, inner[i][1])];
      const ids = pts.map((P) => this._v(P[0], P[1], P[2], nx, Math.SQRT1_2, nz, P[0] * us, P[2] * us, Math.min(1.15, tint * 1.06)));
      this.quad(ids[3], ids[2], ids[1], ids[0]);
    }
    const q = inner.map(([lx, lz]) => {
      const P = W(lx, ytop, lz);
      return this._v(P[0], P[1], P[2], 0, 1, 0, P[0] * us, P[2] * us, tint);
    });
    this.quad(q[3], q[2], q[1], q[0]);
  }

  mesh(material) {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/**
 * Tabletop diorama of the explored block: the parchment survey laid on the
 * cartographer's walnut desk, corners curling, every explored wall raised as a
 * painted miniature — ashlar for stone, plaster and dark timber framing for the
 * timber houses, broken jagged stubs with spilled rubble for ruins, a taller
 * crenellated city wall — plank doors with iron straps, a painted party token
 * with its pennant, flagged pins for notes and floating name scrolls. Lit by
 * the candle, a cool moonlit window fill and a soft study environment.
 * World units: one cell = 1; x east, z south.
 */
export class Diorama {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 300);
    this.own = [];
    this.az = -0.24;
    this.el = 0.86;
    this.dist = 30;
    this.fitDist = 30;
    this.zoomLevel = 1;
    this.target = new THREE.Vector3(8, 0, 8);
    this.cur = { az: this.az, el: this.el, dist: this.dist, target: this.target.clone() };
    this.env = null;
  }

  /** Generate (or fetch the cached) material sets before the first build. */
  async prepare() {
    await preloadTextureSets(SETS);
  }

  _track(o) {
    this.own.push(o);
    return o;
  }

  _disposeScene() {
    for (const o of this.own.splice(0)) o.dispose?.();
    this.hoverMark = null;
    this.scene = null;
  }

  dispose() {
    this._disposeScene();
    this.env?.dispose();
    this.env = null;
  }

  /** A small study environment: warm candle glow to the west, cool window light to the north-east. */
  _environment() {
    if (this.env) return this.env;
    const r = this.ctx.render?.renderer;
    if (!r) return null;
    const pm = new THREE.PMREMGenerator(r);
    const es = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD;
        void main(){
          vec3 c = mix(vec3(0.05,0.035,0.025), vec3(0.09,0.08,0.09), smoothstep(-0.2, 0.8, vD.y));
          c += vec3(1.6,0.85,0.4) * pow(max(0.0, dot(vD, normalize(vec3(-0.8,0.45,0.2)))), 6.0);
          c += vec3(0.35,0.48,0.8) * pow(max(0.0, dot(vD, normalize(vec3(0.7,0.5,-0.6)))), 4.0);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    this.env = pm.fromScene(es, 0.02, 0.1, 100, { size: 64 }).texture;
    pm.dispose();
    mat.dispose();
    es.children[0].geometry.dispose();
    return this.env;
  }

  /**
   * @param {import('../../data/maps/MapGrid.js').MapGrid} map
   * @param {ReturnType<import('./BlockSheet.js').buildBlockSheet>} sheet
   */
  build(map, sheet, { seen, secrets, party, notes, zoom = 1 }) {
    this._disposeScene();
    const T = this._track.bind(this);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0806);
    scene.fog = new THREE.Fog(0x0b0806, 60, 130);
    scene.environment = this._environment();
    scene.environmentIntensity = 0.55;
    this.scene = scene;
    this.party = party;
    this.map = map;
    const maxAniso = Math.min(8, this.ctx.render?.maxAnisotropy ?? 4);
    const { W, H, M, MX, MY } = SHEET;
    const cs = sheet.cs;
    const info = sheet.info;
    const seenCell = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && seen(x, y);
    const dungeon = map.tileset === 'dungeon' || map.kind === 'dungeon';
    const wild = map.tileset === 'wilderness' || map.tileset === 'graveyard';

    // ---------- desk: walnut planks ----------
    const deskCanvas = makeDesk(1024, 1024, { lit: false, seed: 9, tone: [70, 48, 32] });
    const deskTex = T(new THREE.CanvasTexture(deskCanvas));
    deskTex.colorSpace = THREE.SRGBColorSpace;
    deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping;
    deskTex.repeat.set(3.5, 3.5);
    deskTex.anisotropy = maxAniso;
    const deskBump = T(new THREE.CanvasTexture(deskCanvas));
    deskBump.wrapS = deskBump.wrapT = THREE.RepeatWrapping;
    deskBump.repeat.copy(deskTex.repeat);
    const desk = new THREE.Mesh(T(new THREE.PlaneGeometry(150, 150)), T(new THREE.MeshStandardMaterial({ map: deskTex, bumpMap: deskBump, bumpScale: 2.2, roughness: 0.6, metalness: 0, envMapIntensity: 0.22 })));
    desk.rotation.x = -Math.PI / 2;
    desk.position.set(10, -0.03, 8);
    desk.receiveShadow = true;
    scene.add(desk);

    // ---------- the parchment sheet, corners curling ----------
    const tex = T(new THREE.CanvasTexture(this._paperWithContactShadows(map, sheet, seenCell, secrets, party, notes)));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    const pw = (W + 2 * M) / cs;
    const ph = (H + 2 * M) / cs;
    const geo = T(new THREE.PlaneGeometry(pw, ph, 96, 72));
    const pos = geo.attributes.position;
    const lift = (u, v) => {
      const du = Math.min(u, 1 - u);
      const dv = Math.min(v, 1 - v);
      const corner = Math.max(0, 0.2 - Math.hypot(du * 1.1, dv * 1.35)) / 0.2;
      const edge = Math.max(0, 0.045 - Math.min(du, dv)) / 0.045;
      const fold = Math.exp(-(((u - 0.5) * 60) ** 2)) * 0.025 + Math.exp(-(((v - 0.5) * 60) ** 2)) * 0.02;
      // the north-east corner has curled the most (it was rolled that way)
      const ne = u > 0.5 && v < 0.5 ? 1.5 : u < 0.5 && v > 0.5 ? 0.8 : 1.1;
      return corner ** 2.2 * 1.9 * ne + edge * 0.1 + fold;
    };
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / pw + 0.5;
      const v = 0.5 - pos.getY(i) / ph;
      pos.setZ(i, lift(u, v));
    }
    geo.computeVertexNormals();
    const grain = T(new THREE.CanvasTexture(grainTile()));
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(12, 9);
    const paper = new THREE.Mesh(geo, T(new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.02, roughness: 0.88, metalness: 0, bumpMap: grain, bumpScale: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.4,
    })));
    paper.rotation.x = -Math.PI / 2;
    const px0 = -(M + MX) / cs;
    const pz0 = -(M + MY) / cs;
    paper.position.set(px0 + pw / 2, 0, pz0 + ph / 2);
    paper.receiveShadow = true;
    paper.castShadow = true;
    scene.add(paper);
    this.bounds = [];
    this.sheetBox = { x0: px0, z0: pz0, x1: px0 + pw, z1: pz0 + ph };
    this.paperTex = tex;
    for (const [bx, bz] of [[px0, pz0], [px0 + pw, pz0], [px0, pz0 + ph], [px0 + pw, pz0 + ph]]) {
      this.bounds.push(new THREE.Vector3(bx, 0, bz), new THREE.Vector3(bx, 1.4, bz));
    }

    // ---------- materials ----------
    const set = (name) => getTextureSet(name);
    const pbr = (name, o = {}, boost = 1) => {
      const m = T(new THREE.MeshStandardMaterial({ ...set(name), vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.35, ...o }));
      m.color.multiplyScalar(boost);
      return m;
    };
    const M_ = {
      stone: pbr('hd_ashlar', { color: 0xf2e6d2 }, 2.1),
      city: pbr('hd_ashlar_cold', { color: 0xe6e2da }, 2.0),
      plaster: pbr('hd_plaster', { color: 0xfff4e0 }, 1.3),
      beam: pbr('hd_beam_dark', {}, 1.5),
      ruin: pbr('hd_ruin', { color: 0xe8ddc8 }, 2.2),
      rock: pbr('hd_rock', { color: 0xd8ccb8 }, 1.6),
      door: pbr('hd_beam_dark', { color: 0xffe2c4 }, 4.6),
      locked: pbr('hd_beam_dark', { color: 0xff5a3a }, 4.4),
      iron: pbr('hd_iron', { metalness: 0.75, roughness: 0.55, envMapIntensity: 0.9 }),
      secret: pbr('hd_ashlar', { color: 0xf0b898 }, 1.7),
      gold: T(new THREE.MeshStandardMaterial({ color: 0xd8b25a, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 })),
      // building floors: raised plinths carrying the inked floor plan itself
      floor: T(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 })),
    };
    const B = {};
    const batch = (k) => (B[k] ??= new Batch());

    // ---------- walls ----------
    const isBorder = (q) => !dungeon && !wild && ((q.horiz && ((q.cell[1] === 0 && q.cell[2] === 'N') || (q.cell[1] === map.h - 1 && q.cell[2] === 'S'))) || (!q.horiz && ((q.cell[0] === 0 && q.cell[2] === 'W') || (q.cell[0] === map.w - 1 && q.cell[2] === 'E'))));
    const ruin = (q) => q.style === 2 && !dungeon;
    const wallH = dungeon ? 0.62 : 0.5;
    const { segs, effective } = collectEdges(map, info, seenCell, secrets);
    const rr = prng(31);
    const towers = [];
    const span = (x0, z0, x1, z1, th) => {
      const horiz = Math.abs(z1 - z0) < 1e-6;
      return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, sx: horiz ? Math.abs(x1 - x0) : th, sz: horiz ? th : Math.abs(z1 - z0), horiz, len: Math.hypot(x1 - x0, z1 - z0) };
    };
    /**
     * A stone wall run: coursed, chamfered blocks bedded with hairline joints,
     * each course offset, the run's height varying a little, then a coping of
     * overhanging bevelled capstones with the odd one fallen.
     */
    const stoneRun = (x0, z0, x1, z1, { h = wallH, th = 0.12, key = 'stone', ext = th / 2, cap = true, vary = true, courses = 2, broken = 0 } = {}) => {
      const s = span(x0, z0, x1, z1, th);
      const L = s.len + ext * 2;
      const b = batch(key);
      const runH = vary ? h * (0.9 + rr() * 0.18) : h;
      const capH = cap ? 0.04 : 0;
      const ch = (runH - capH) / courses;
      const at = (c) => [s.cx + (s.horiz ? c : 0), s.cz + (s.horiz ? 0 : c)];
      for (let c = 0; c < courses; c++) {
        let a = -L / 2 - (c % 2 ? 0.05 + rr() * 0.1 : rr() * 0.04);
        while (a < L / 2) {
          const lo = Math.max(-L / 2, a);
          const hi = Math.min(L / 2, a + 0.15 + rr() * 0.17);
          a = hi;
          if (hi - lo < 0.025) continue;
          // a broken course: blocks fall away toward the top of a ruin
          if (broken && c > 0 && rr() < broken * (c / courses)) continue;
          const [X, Z] = at((lo + hi) / 2);
          const bl = hi - lo - 0.007;
          const bh = ch - 0.005 + (c === courses - 1 && !cap ? (rr() - 0.5) * 0.04 : 0);
          const tt = th - 0.006 + (rr() - 0.5) * 0.01;
          const jx = s.horiz ? 0 : (rr() - 0.5) * 0.006;
          const jz = s.horiz ? (rr() - 0.5) * 0.006 : 0;
          b.bevelBox(X + jx, c * ch + bh / 2, Z + jz, s.horiz ? bl : tt, bh, s.horiz ? tt : bl, { bevel: 0.009, tint: 0.8 + rr() * 0.24, aoH: 0.08 });
        }
      }
      if (!cap) return;
      const ct = th * 1.3;
      let a = -L / 2 - 0.01;
      while (a < L / 2) {
        const lo = a;
        const hi = Math.min(L / 2 + 0.01, a + 0.2 + rr() * 0.16);
        a = hi;
        if (rr() < 0.07) continue;
        const [X, Z] = at((lo + hi) / 2);
        const bl = hi - lo - 0.006;
        const lift = (rr() - 0.5) * 0.008;
        b.bevelBox(X, runH - capH / 2 + lift, Z, s.horiz ? bl : ct, capH, s.horiz ? ct : bl, { bevel: 0.014, tint: 0.98 + rr() * 0.12, ao: 0.85 });
      }
    };
    /** Timber & plaster: limewashed infill between dark oak posts, sill, rail, wall-plate and braces. */
    const timberRun = (x0, z0, x1, z1) => {
      const th = 0.1;
      const h = wallH * (0.88 + rr() * 0.08);
      const s = span(x0, z0, x1, z1, th);
      const L = s.len + th;
      const P = batch('plaster');
      P.box(s.cx, h / 2, s.cz, s.horiz ? L : th, h, s.horiz ? th : L, { tint: 0.92 + rr() * 0.1 });
      const bm = batch('beam');
      const bt = th + 0.022;
      const at = (c, y, len, hh, o = {}) => bm.bevelBox(s.cx + (s.horiz ? c : 0), y, s.cz + (s.horiz ? 0 : c), s.horiz ? len : bt, hh, s.horiz ? bt : len, { ao: 0.7, us: 3, bevel: 0.006, ...o });
      at(0, 0.035, L, 0.07);
      at(0, h - 0.026, L + 0.02, 0.052, { bevel: 0.012 });
      at(0, h * 0.55, L, 0.032);
      const posts = Math.max(1, Math.round(L / (0.42 + rr() * 0.12)));
      for (let i = 0; i <= posts; i++) at(-L / 2 + 0.035 + (i / posts) * (L - 0.07) + (rr() - 0.5) * 0.03, h / 2, 0.06, h, { tint: 0.85 + rr() * 0.2 });
    };
    /** The city wall: taller, thicker, battered at the foot, crenellated along its outer face. */
    const cityRun = (x0, z0, x1, z1, q) => {
      const th = 0.22;
      const h = 0.74;
      const s = span(x0, z0, x1, z1, th);
      stoneRun(x0, z0, x1, z1, { h, th, key: 'city', ext: th / 2, cap: false, vary: false, courses: 3 });
      const b = batch('city');
      const L = s.len + th;
      b.bevelBox(s.cx, 0.05, s.cz, s.horiz ? L : th + 0.08, 0.1, s.horiz ? th + 0.08 : L, { ao: 0.5, bevel: 0.03 });
      // the wall-walk's paving and the parapet
      b.bevelBox(s.cx, h + 0.008, s.cz, s.horiz ? L : th + 0.02, 0.016, s.horiz ? th + 0.02 : L, { ao: 1, bevel: 0.006, tint: 1.05 });
      const out = q.horiz ? (q.cell[2] === 'N' ? -1 : 1) : (q.cell[2] === 'W' ? -1 : 1);
      const mDepth = th * 0.36;
      const off = (th - mDepth) / 2 * out;
      const n = Math.max(1, Math.floor(L / 0.2));
      for (let i = 0; i < n; i++) {
        const c = -L / 2 + (i + 0.5) * (L / n);
        if (rr() < 0.06) continue;
        const mh = 0.11 + (rr() - 0.5) * 0.02;
        b.bevelBox(s.cx + (s.horiz ? c : off), h + 0.016 + mh / 2, s.cz + (s.horiz ? off : c), s.horiz ? 0.1 : mDepth, mh, s.horiz ? mDepth : 0.1, { ao: 0.9, bevel: 0.012, tint: 0.9 + rr() * 0.15 });
      }
    };
    // merge runs per kind so each reads as one piece of masonry
    const plain = segs.filter((q) => effective(q) === EDGE.WALL && !ruin(q));
    for (const r of mergeRuns(plain.filter((q) => isBorder(q)))) cityRun(r.x0, r.y0, r.x1, r.y1, r);
    for (const r of mergeRuns(plain.filter((q) => !isBorder(q) && q.style === 1 && !dungeon))) timberRun(r.x0, r.y0, r.x1, r.y1);
    for (const r of mergeRuns(plain.filter((q) => !isBorder(q) && (q.style !== 1 || dungeon)))) stoneRun(r.x0, r.y0, r.x1, r.y1, { courses: dungeon ? 3 : 2 });
    // the city wall's round towers, at corners and either side of each gate
    {
      const all = collectEdges(map, info, (x, y) => map.inBounds(x, y) && !info.isRock(x, y), new Set());
      const bRuns = mergeRuns(all.segs.filter((q) => isBorder(q) && all.effective(q) === EDGE.WALL));
      const spots = [];
      const add = (x, z) => { if (!spots.some((p) => Math.hypot(p[0] - x, p[1] - z) < 1.2)) spots.push([x, z]); };
      for (const rn of bRuns) {
        add(rn.x0, rn.y0);
        add(rn.x1, rn.y1);
        const len = Math.hypot(rn.x1 - rn.x0, rn.y1 - rn.y0);
        const n = Math.floor(len / 5.5);
        for (let i = 1; i <= n; i++) add(rn.x0 + ((rn.x1 - rn.x0) * i) / (n + 1), rn.y0 + ((rn.y1 - rn.y0) * i) / (n + 1));
      }
      const tb = batch('city');
      for (const [x, z] of spots) {
        let near = false;
        for (let j = -1; j <= 0 && !near; j++) for (let i = -1; i <= 0; i++) if (seenCell(Math.floor(x) + i, Math.floor(z) + j)) { near = true; break; }
        if (!near) continue;
        towers.push([x, z]);
        // crenellated top: merlons round the drum
        const R = 0.36;
        const H = 0.98;
        for (let i = 0; i < 10; i++) {
          if (i % 2) continue;
          const a = (i / 10) * Math.PI * 2;
          tb.bevelBox(x + Math.cos(a) * (R - 0.04), H + 0.06, z + Math.sin(a) * (R - 0.04), 0.16, 0.12, 0.07, { ry: -a + Math.PI / 2, bevel: 0.012, ao: 0.9 });
        }
      }
    }
    const rubble = (px, pz, n, spread) => {
      const b = batch('ruin');
      for (let i = 0; i < n; i++) {
        const sz = 0.025 + rr() ** 2 * 0.07;
        b.bevelBox(px + (rr() - 0.5) * spread, sz * 0.4, pz + (rr() - 0.5) * spread, sz * (1 + rr()), sz * 0.9, sz * (0.8 + rr() * 0.8), { ry: rr() * 3, ao: 0.6, us: 4, bevel: sz * 0.2 });
      }
    };
    const doorRings = [];
    /** A plank door leaf: boards with hairline gaps, two iron straps, a ring; hinged at (hx,hz). */
    const leaf = (hx, hz, ang, L, dh, { locked = false } = {}) => {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const P = (lx, lz) => [hx + lx * ca + lz * sa, hz - lx * sa + lz * ca];
      const key = locked ? 'locked' : 'door';
      const n = 4;
      let x = 0.004;
      for (let i = 0; i < n; i++) {
        const pw = i === n - 1 ? L - x - 0.004 : (L / n) * (0.86 + rr() * 0.28);
        const [cx, cz] = P(x + pw / 2, 0);
        const ph = dh - (rr() * 0.012);
        batch(key).bevelBox(cx, ph / 2, cz, pw - 0.006, ph, 0.042, { ry: ang, bevel: 0.005, tint: 0.8 + rr() * 0.3, ao: 0.6, us: 5 });
        x += pw;
      }
      for (const yy of [0.24, 0.76]) {
        for (const side of [-1, 1]) {
          const [cx, cz] = P(L * 0.5, side * 0.025);
          batch('iron').box(cx, dh * yy, cz, L * 0.94, 0.026, 0.008, { ry: ang, ao: 1, us: 6 });
        }
      }
      const [rx, rz] = P(L * 0.78, 0.04);
      doorRings.push({ x: rx, z: rz, y: dh * 0.5, ry: ang });
      if (locked) {
        // a heavy iron bar across the leaf and a padlock hanging from its hasp
        const [bx, bz] = P(L * 0.5, 0.034);
        batch('iron').bevelBox(bx, dh * 0.5, bz, L * 1.08, 0.045, 0.022, { ry: ang, bevel: 0.006, ao: 1 });
        const [lx, lz] = P(L * 0.5, 0.06);
        batch('gold').bevelBox(lx, dh * 0.4, lz, 0.075, 0.07, 0.03, { ry: ang, bevel: 0.01, ao: 1 });
      }
    };
    for (const q of segs) {
      const t = effective(q);
      const lerp = (a) => [q.x0 + (q.x1 - q.x0) * a, q.y0 + (q.y1 - q.y0) * a];
      const wallKey = q.style === 1 && !dungeon ? 'plaster' : ruin(q) ? 'ruin' : 'stone';
      if (t === EDGE.WALL && ruin(q)) {
        // broken stubs: coursed masonry falling away toward ragged tops, rubble at their feet
        const n = 2 + Math.floor(rr() * 2);
        for (let i = 0; i < n; i++) {
          const a = i / n + rr() * 0.05;
          const b2 = (i + 1) / n - rr() * 0.14;
          if (b2 - a < 0.12) continue;
          const [ax, az] = lerp(a);
          const [bx, bz] = lerp(b2);
          stoneRun(ax, az, bx, bz, { key: 'ruin', h: wallH * (0.35 + rr() * 0.55), th: 0.11, ext: 0, cap: false, courses: 3, broken: 0.75 });
        }
        const [mx, mz] = lerp(0.5);
        rubble(mx, mz, 11, 0.75);
        continue;
      }
      if (t === EDGE.WALL) continue;
      if (t === EDGE.SECRET) {
        const [ax, az] = lerp(0);
        const [bx, bz] = lerp(1);
        stoneRun(ax, az, bx, bz, { key: 'secret' });
        continue;
      }
      const gap = 0.26;
      const piece = (a, b2) => {
        const [ax, az] = lerp(a);
        const [bx, bz] = lerp(b2);
        if (isBorder(q)) cityRun(ax, az, bx, bz, q);
        else if (wallKey === 'plaster') timberRun(ax, az, bx, bz);
        else stoneRun(ax, az, bx, bz, { key: wallKey === 'ruin' ? 'ruin' : 'stone', ext: 0.06, broken: wallKey === 'ruin' ? 0.5 : 0, courses: wallKey === 'ruin' ? 3 : 2 });
      };
      piece(0, 0.5 - gap);
      piece(0.5 + gap, 1);
      const [mx, mz] = lerp(0.5);
      const dh = wallH * 0.82;
      // jambs and lintel: dressed stone (or oak in a timber wall)
      const jk = wallKey === 'plaster' ? 'beam' : 'stone';
      for (const sg of [-1, 1]) {
        const [px, pz] = lerp(0.5 + sg * (gap + 0.02));
        batch(jk).bevelBox(px, (dh + 0.06) / 2, pz, q.horiz ? 0.05 : 0.15, dh + 0.06, q.horiz ? 0.15 : 0.05, { bevel: 0.008, ao: 0.6 });
      }
      if (t === EDGE.ARCH) {
        const st = batch('stone');
        for (const sg of [-1, 1]) {
          const [px, pz] = lerp(0.5 + sg * gap);
          st.bevelBox(px, wallH * 0.62, pz, 0.15, wallH * 1.24, 0.15, { bevel: 0.016 });
        }
        st.bevelBox(mx, wallH * 1.2, mz, q.horiz ? gap * 2 + 0.2 : 0.17, 0.1, q.horiz ? 0.17 : gap * 2 + 0.2, { ao: 1, bevel: 0.016 });
        st.bevelBox(mx, wallH * 1.29, mz, q.horiz ? 0.08 : 0.12, 0.08, q.horiz ? 0.12 : 0.08, { ao: 1, bevel: 0.012 });
      } else {
        batch(jk).bevelBox(mx, dh + 0.06, mz, q.horiz ? gap * 2 + 0.16 : 0.15, 0.06, q.horiz ? 0.15 : gap * 2 + 0.16, { bevel: 0.01, ao: 0.9 });
        // doors stand ajar into their room; locked doors are shut and barred
        const into = q.horiz ? (q.cell[2] === 'N' ? 1 : -1) : (q.cell[2] === 'W' ? 1 : -1);
        const open = t === EDGE.DOOR ? 1.1 : 0;
        const [hx, hz] = lerp(0.5 - gap);
        const base = q.horiz ? 0 : -Math.PI / 2;
        // rotating by +ry turns local +x toward -z, so swing the sign to open into the room
        const swing = q.horiz ? -into : into;
        leaf(hx, hz, base + swing * open, gap * 2, dh, { locked: t === EDGE.LOCKED });
      }
    }
    // bedrock next to explored ground
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!info.isRock(x, y)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (seenCell(x + dx, y + dy)) { near = true; break; }
      if (!near) continue;
      const hh = wallH * (0.9 + hash2(x, y, 4) * 0.25);
      batch('rock').box(x + 0.5, hh / 2, y + 0.5, 1.0, hh, 1.0, { us: 1.1, tint: 0.85 + hash2(x, y, 6) * 0.15 });
    }
    // ---------- building floors: each explored room raised as a plinth ----------
    {
      const uvFn = (x, z) => [(x - px0) / pw, 1 - (z - pz0) / ph];
      const fl = batch('floor');
      const fh = 0.06;
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (!seenCell(x, y) || map.getCell(x, y) !== CELL.INTERIOR) continue;
        fl.box(x + 0.5, fh / 2, y + 0.5, 1.002, fh, 1.002, { uvFn, ao: 0.35, aoH: fh, tint: 1 });
      }
    }
    for (const [k, b] of Object.entries(B)) {
      const m = b.mesh(M_[k]);
      if (!m) continue;
      this.own.push(m.geometry);
      scene.add(m);
    }
    // tower drums: coursed stone cylinders with a battered foot
    if (towers.length) {
      const R = 0.36;
      const H = 0.98;
      const drum = T(new THREE.CylinderGeometry(R, R * 1.08, H, 28, 1, true));
      const uv = drum.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * R * 1.6, uv.getY(i) * H * 1.6);
      const cap = T(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.05, 28));
      const floorDisc = T(new THREE.CylinderGeometry(R - 0.06, R - 0.06, 0.02, 24));
      const colours = new Float32Array(drum.attributes.position.count * 3);
      for (let i = 0; i < drum.attributes.position.count; i++) {
        const y = drum.attributes.position.getY(i) + H / 2;
        const v = Math.min(1, 0.55 + y * 1.4);
        colours.set([v, v, v], i * 3);
      }
      drum.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      const capCol = new Float32Array(cap.attributes.position.count * 3).fill(1);
      cap.setAttribute('color', new THREE.BufferAttribute(capCol, 3));
      floorDisc.setAttribute('color', new THREE.BufferAttribute(new Float32Array(floorDisc.attributes.position.count * 3).fill(0.75), 3));
      for (const [x, z] of towers) {
        const d = new THREE.Mesh(drum, M_.city);
        d.position.set(x, H / 2, z);
        d.castShadow = d.receiveShadow = true;
        const c = new THREE.Mesh(cap, M_.city);
        c.position.set(x, H - 0.005, z);
        c.castShadow = c.receiveShadow = true;
        const f = new THREE.Mesh(floorDisc, M_.beam);
        f.position.set(x, H + 0.03, z);
        f.receiveShadow = true;
        scene.add(d, c, f);
      }
    }
    if (doorRings.length) {
      const ringGeo = T(new THREE.TorusGeometry(0.035, 0.009, 6, 16));
      const rings = new THREE.InstancedMesh(ringGeo, M_.iron, doorRings.length);
      const d = new THREE.Object3D();
      doorRings.forEach((r, i) => {
        d.position.set(r.x, r.y, r.z);
        d.rotation.set(0, r.ry, 0);
        d.updateMatrix();
        rings.setMatrixAt(i, d.matrix);
      });
      rings.castShadow = true;
      this.own.push({ dispose: () => rings.dispose() });
      scene.add(rings);
    }
    // water: a glassy rippled film
    const water = set('hd_water');
    const waterMat = T(new THREE.MeshStandardMaterial({ color: 0x3a6a92, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.6, normalMap: water.normalMap, envMapIntensity: 1.2 }));
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.getCell(x, y) !== CELL.WATER || !seenCell(x, y)) continue;
      const wm = new THREE.Mesh(T(new THREE.PlaneGeometry(1, 1)), waterMat);
      wm.rotation.x = -Math.PI / 2;
      wm.position.set(x + 0.5, 0.035, y + 0.5);
      scene.add(wm);
    }

    // ---------- fog of war: drifting veils of mist over the unexplored squares ----------
    this.veils = [];
    if (sheet.fog) {
      const mc = makeCanvas(512);
      const mg = mc.getContext('2d');
      mg.fillStyle = '#000';
      mg.fillRect(0, 0, 512, 512);
      mg.drawImage(sheet.fog, MX, MY, sheet.cs * map.w, sheet.cs * map.h, 0, 0, 512, 512);
      const maskTex = T(new THREE.CanvasTexture(mc));
      [[0.1, 0.2, 0x9a9ca2, 1]].forEach(([y, op, col, sd]) => {
        const nTex = T(new THREE.CanvasTexture(this._mistCanvas(sd)));
        nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping;
        nTex.repeat.set(1.6, 1.6);
        const mat = T(new THREE.MeshLambertMaterial({ color: col, map: nTex, alphaMap: maskTex, transparent: true, opacity: op, depthWrite: false }));
        const veil = new THREE.Mesh(T(new THREE.PlaneGeometry(map.w + 0.6, map.h + 0.6)), mat);
        veil.rotation.x = -Math.PI / 2;
        veil.position.set(map.w / 2, y, map.h / 2);
        veil.renderOrder = 2 + sd;
        scene.add(veil);
        this.veils.push({ tex: nTex, speed: 0.004 * sd, phase: sd * 1.7 });
      });
    }

    // ---------- party: a painted lead miniature on a pewter base with an enamel compass arrow ----------
    this.marker = null;
    if (party) {
      const grp = new THREE.Group();
      const pewter = T(new THREE.MeshStandardMaterial({ color: 0x8e9298, roughness: 0.42, metalness: 0.85, envMapIntensity: 1.1 }));
      const paint = (c, r = 0.58) => T(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0, envMapIntensity: 0.5 }));
      const V = (pts) => pts.map(([x, y]) => new THREE.Vector2(x, y));
      const base = new THREE.Mesh(T(new THREE.LatheGeometry(V([[0, 0], [0.3, 0], [0.318, 0.008], [0.322, 0.03], [0.31, 0.046], [0.29, 0.052], [0, 0.052]]), 48)), pewter);
      base.castShadow = base.receiveShadow = true;
      const groove = new THREE.Mesh(T(new THREE.TorusGeometry(0.262, 0.005, 6, 48)), paint(0x2a2620, 0.5));
      groove.rotation.x = Math.PI / 2;
      groove.position.y = 0.052;
      // the compass arrow, enamelled into the base and rimmed in brass
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.275);
      shape.quadraticCurveTo(0.05, 0.08, 0.13, -0.05);
      shape.quadraticCurveTo(0.06, -0.02, 0, -0.01);
      shape.quadraticCurveTo(-0.06, -0.02, -0.13, -0.05);
      shape.quadraticCurveTo(-0.05, 0.08, 0, 0.275);
      const ag = T(new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8 }));
      ag.rotateX(-Math.PI / 2);
      const enamel = T(new THREE.MeshPhysicalMaterial({ color: 0xa82a18, roughness: 0.25, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.9 }));
      const arrow = new THREE.Mesh(ag, enamel);
      arrow.position.y = 0.05;
      const rimG = T(new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.016, bevelSegments: 1, curveSegments: 8 }));
      rimG.rotateX(-Math.PI / 2);
      const rim = new THREE.Mesh(rimG, M_.gold);
      rim.position.y = 0.049;
      // the figure: a cloaked standard-bearer with helm, kite shield and the Company's banner
      const fig = new THREE.Group();
      const cloak = new THREE.Mesh(T(new THREE.LatheGeometry(V([[0, 0.05], [0.1, 0.05], [0.106, 0.066], [0.09, 0.13], [0.074, 0.2], [0.07, 0.24], [0.086, 0.272], [0.08, 0.292], [0.05, 0.31], [0.026, 0.32], [0, 0.322]]), 28)), paint(0x2a4686));
      const cape = new THREE.Mesh(T(new THREE.CylinderGeometry(0.084, 0.118, 0.25, 16, 1, true, -Math.PI * 0.55, Math.PI * 1.1)), T(new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.62, side: THREE.DoubleSide })));
      cape.position.set(0, 0.17, 0.012);
      const pauldL = new THREE.Mesh(T(new THREE.SphereGeometry(0.034, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6)), T(new THREE.MeshStandardMaterial({ color: 0xa8acb2, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.2 })));
      pauldL.position.set(-0.07, 0.272, 0);
      const pauldR = pauldL.clone();
      pauldR.position.x = 0.07;
      const armL = new THREE.Mesh(T(new THREE.CapsuleGeometry(0.018, 0.09, 4, 8)), paint(0x2a4686));
      armL.position.set(-0.084, 0.215, -0.02);
      armL.rotation.set(0.5, 0, 0.3);
      const belt = new THREE.Mesh(T(new THREE.TorusGeometry(0.074, 0.008, 6, 24)), paint(0x5a3a20, 0.5));
      belt.rotation.x = Math.PI / 2;
      belt.position.y = 0.2;
      const head = new THREE.Mesh(T(new THREE.SphereGeometry(0.042, 16, 12)), paint(0xd6a486, 0.6));
      head.position.y = 0.355;
      const helm = new THREE.Mesh(T(new THREE.SphereGeometry(0.047, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), T(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9, envMapIntensity: 1.2 })));
      helm.position.y = 0.36;
      const nasal = new THREE.Mesh(T(new THREE.BoxGeometry(0.008, 0.035, 0.01)), helm.material);
      nasal.position.set(0, 0.35, -0.046);
      const shield = new THREE.Mesh(T(new THREE.CylinderGeometry(0.075, 0.075, 0.014, 20)), paint(0x9a2a1c, 0.45));
      shield.rotation.set(Math.PI / 2, 0, 0.35);
      shield.position.set(-0.085, 0.2, -0.03);
      shield.rotation.y = -0.6;
      const boss = new THREE.Mesh(T(new THREE.SphereGeometry(0.018, 10, 8)), M_.gold);
      boss.position.set(-0.098, 0.2, -0.05);
      const armR = new THREE.Mesh(T(new THREE.CapsuleGeometry(0.018, 0.1, 4, 8)), cloak.material);
      armR.position.set(0.075, 0.25, -0.02);
      armR.rotation.z = -0.5;
      const hand = new THREE.Mesh(T(new THREE.SphereGeometry(0.02, 10, 8)), head.material);
      hand.position.set(0.1, 0.29, -0.02);
      fig.add(cloak, cape, pauldL, pauldR, armL, belt, head, helm, nasal, shield, boss, armR, hand);
      fig.scale.setScalar(0.9);
      fig.position.z = 0.05;
      for (const m of fig.children) { m.castShadow = true; m.receiveShadow = true; }
      const pole = new THREE.Mesh(T(new THREE.CylinderGeometry(0.008, 0.009, 0.72, 8)), M_.beam);
      pole.position.set(0.09, 0.4, 0.03);
      pole.castShadow = true;
      const finial = new THREE.Mesh(T(new THREE.ConeGeometry(0.014, 0.05, 8)), M_.gold);
      finial.position.set(0.09, 0.78, 0.03);
      const flagGeo = T(new THREE.PlaneGeometry(0.26, 0.16, 12, 2));
      const fp = flagGeo.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const u = fp.getX(i) / 0.26 + 0.5;
        fp.setZ(i, Math.sin(u * Math.PI * 1.6) * 0.02 * u);
        if (u > 0.85) fp.setY(i, fp.getY(i) * (1 - (u - 0.85) * 1.6));
      }
      flagGeo.computeVertexNormals();
      const flag = new THREE.Mesh(flagGeo, T(new THREE.MeshStandardMaterial({ map: this._pennantTexture(T), side: THREE.DoubleSide, roughness: 0.75 })));
      flag.geometry.translate(0.13, 0, 0);
      flag.position.set(0.095, 0.68, 0.03);
      flag.castShadow = true;
      const head3 = new THREE.Group();
      head3.add(rim, arrow, fig, pole, finial, flag);
      head3.rotation.y = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[party.dir] ?? 0;
      grp.add(base, groove, head3);
      grp.position.set(party.x + 0.5, 0, party.y + 0.5);
      // a soft candle-gold glow on the paper under the base, so it is found at once
      const glow = new THREE.Mesh(T(new THREE.CircleGeometry(0.5, 48)), T(new THREE.MeshBasicMaterial({ map: this._glowTexture(T), color: 0xffb060, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.008;
      grp.add(glow);
      grp.scale.setScalar(2.25);
      this.partyRing = null;
      this.partyGlow = glow;
      scene.add(grp);
      this.marker = { grp, flag, flagGeo };
    }

    // ---------- note pins with their seals as flags ----------
    const needleMat = T(new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 1 }));
    const needleGeo = T(new THREE.CylinderGeometry(0.014, 0.004, 0.6, 6));
    const headGeo = T(new THREE.SphereGeometry(0.11, 20, 14));
    for (const n of notes ?? []) {
      const kind = PIN_KINDS[n.kind] ?? PIN_KINDS.note;
      const mat = T(new THREE.MeshStandardMaterial({ color: new THREE.Color(kind.color), roughness: 0.3, metalness: 0.05 }));
      const px = n.x + 0.7;
      const pz = n.y + 0.32;
      const needle = new THREE.Mesh(needleGeo, needleMat);
      needle.position.set(px, 0.28, pz);
      needle.rotation.z = 0.1;
      needle.castShadow = true;
      const head = new THREE.Mesh(headGeo, mat);
      head.position.set(px - 0.03, 0.58, pz);
      head.castShadow = true;
      const seal = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: this._pinTexture(n.kind, T), depthWrite: false, sizeAttenuation: false })));
      seal.scale.set(0.028, 0.028, 1);
      seal.position.set(px - 0.03, 0.82, pz);
      scene.add(needle, head, seal);
    }

    // ---------- props: candle, inkwell & quill (kept inside the framing) ----------
    this._props(scene, T, M_);
    this.bounds.push(new THREE.Vector3(-4.5, 0, 1.6), new THREE.Vector3(-3.3, 3.3, 1.6), new THREE.Vector3(-3.9, 0, 15.4), new THREE.Vector3(-3.6, 3.2, 12.4));

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0xa8b0c0, 0x2a2018, 0.34));
    // the key comes from the candle's side of the desk (west-north-west), so every
    // shadow on the board falls east-south-east, the way the baked contact shadows lie
    const key = new THREE.DirectionalLight(0xffe2bc, 2.7);
    key.position.set(-15, 21, 1);
    key.target.position.set(9, 0, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 80;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 2;
    scene.add(key, key.target);
    const moon = new THREE.DirectionalLight(0x9aaed8, 0.3);
    moon.position.set(28, 14, 20);
    moon.target.position.set(8, 0, 8);
    scene.add(moon, moon.target);
    const bounce = new THREE.PointLight(0xffc090, 1.4, 40, 1.2);
    bounce.position.set(8, 6, 26);
    scene.add(bounce);

    // ---------- camera: fit the whole sheet inside the view rect ----------
    this.zoomLevel = Math.max(0.5, zoom);
    this.target.set(px0 + pw / 2, 0, pz0 + ph / 2);
    this._fitted = false;
    this._refit(true);
  }

  /** A tileable cloudy alpha field for the mist veils. */
  _mistCanvas(seed) {
    const S = 256;
    const c = makeCanvas(S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = fbm(x / 32, y / 32, { period: 8, octaves: 4, seed: 300 + seed * 11 });
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.max(0, Math.min(255, (0.5 + (n - 0.5) * 3.2) * 255));
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  _glowTexture(T) {
    const c = makeCanvas(128);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,230,170,1)');
    gr.addColorStop(0.5, 'rgba(255,170,90,0.35)');
    gr.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return T(new THREE.CanvasTexture(c));
  }

  /**
   * The sheet as laid on the desk: a copy of the survey with soft contact
   * shadows inked under every raised wall and plinth (south-east of them,
   * away from the desk light), so the miniature sits on the paper.
   */
  _paperWithContactShadows(map, sheet, seenCell, secrets, party, notes = []) {
    const src = sheet.canvas;
    const k = sheet.k;
    const { M, MX, MY } = SHEET;
    const cs = sheet.cs;
    const out = makeCanvas(src.width, src.height);
    const g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    const q = 4; // shadow layer at quarter resolution
    const sc = makeCanvas(Math.ceil(src.width / q), Math.ceil(src.height / q));
    const sg = sc.getContext('2d');
    const P = (x, y) => [((M + MX + x * cs) * k) / q, ((M + MY + y * cs) * k) / q];
    sg.filter = `blur(${(cs * k / q * 0.09).toFixed(1)}px)`;
    sg.strokeStyle = 'rgba(30,16,6,0.85)';
    sg.lineCap = 'round';
    sg.lineWidth = (cs * k / q) * 0.26;
    const off = 0.08;
    const offZ = 0.035;
    sg.beginPath();
    const { segs, effective } = collectEdges(map, sheet.info, seenCell, secrets);
    for (const sgm of segs) {
      if (effective(sgm) === EDGE.OPEN) continue;
      const [ax, ay] = P(sgm.x0 + off, sgm.y0 + offZ);
      const [bx, by] = P(sgm.x1 + off, sgm.y1 + offZ);
      sg.moveTo(ax, ay);
      sg.lineTo(bx, by);
    }
    sg.stroke();
    // plinth shadows: a thin offset rim on the south and east of each building floor
    sg.fillStyle = 'rgba(30,16,6,0.55)';
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!seenCell(x, y) || map.getCell(x, y) !== CELL.INTERIOR) continue;
      const [ax, ay] = P(x + 0.07, y + 0.03);
      const [bx, by] = P(x + 1.07, y + 1.03);
      sg.fillRect(ax, ay, bx - ax, by - ay);
    }
    sg.filter = 'none';
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.75;
    g.imageSmoothingEnabled = true;
    g.drawImage(sc, 0, 0, out.width, out.height);
    g.restore();
    this._paintLabels(g, map, sheet, seenCell, party, notes);
    return out;
  }

  /**
   * Zone names painted flat on the sheet as small banners, so they lie on the
   * paper under the miniature instead of floating through it: each is placed
   * in its district's largest explored building, clear of every wall, of the
   * band a wall hides from the camera, and of the party's base.
   */
  _paintLabels(g, map, sheet, seenCell, party, notes = []) {
    const { M, MX, MY } = SHEET;
    const k = sheet.k;
    const cs = sheet.cs;
    const walls = sheet.wallRects ?? [];
    const hard = [...walls];
    // a wall standing on the south side of a label hides its lower half from the camera
    for (const w of walls) if (w[2] > w[3] * 2) hard.push([w[0], w[1] - cs * 0.42, w[2], cs * 0.42]);
    if (party) {
      const px = MX + (party.x + 0.5) * cs;
      const py = MY + (party.y + 0.5) * cs;
      hard.push([px - cs * 1.1, py - cs * 1.1, cs * 2.2, cs * 2.2]);
    }
    // note pins stand up off the paper: keep the banners clear of them and of the inked markers
    for (const n of notes ?? []) hard.push([MX + (n.x + 0.42) * cs, MY + (n.y + 0.02) * cs, cs * 0.56, cs * 0.6]);
    const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    const placed = [...(sheet.markerSpots ?? [])];
    g.save();
    g.scale(k, k);
    g.translate(M, M);
    for (const z of sheet.labels ?? []) {
      let best = null;
      for (const rg of sheet.regions?.list ?? []) {
        if (rg.type !== CELL.INTERIOR) continue;
        const cells = rg.cells.filter(([x, y]) => x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h && seenCell(x, y));
        if (cells.length && (!best || cells.length > best.length)) best = cells;
      }
      let fx = z.x + z.w / 2;
      let fy = z.y + z.h / 2;
      if (best) {
        fx = best.reduce((a2, c) => a2 + c[0] + 0.5, 0) / best.length;
        fy = best.reduce((a2, c) => a2 + c[1] + 0.5, 0) / best.length;
      }
      const text = z.name.toUpperCase();
      const words = text.split(/\s+/);
      const splits = [[text]];
      if (words.length > 1) {
        let bestSplit = null;
        for (let i = 1; i < words.length; i++) {
          const a2 = words.slice(0, i).join(' ');
          const b2 = words.slice(i).join(' ');
          const d = Math.abs(a2.length - b2.length);
          if (!bestSplit || d < bestSplit.d) bestSplit = { d, lines: [a2, b2] };
        }
        splits.push(bestSplit.lines);
      }
      let pick = null;
      for (const shrink of [1, 0.85, 0.72]) {
        for (const [li, lines] of splits.entries()) {
          const fs = cs * 0.3 * shrink;
          g.font = `bold ${fs.toFixed(1)}px ${SERIF}`;
          g.letterSpacing = `${(fs * 0.14).toFixed(1)}px`;
          const tw = Math.max(...lines.map((l) => g.measureText(l).width));
          const bw = tw + fs * 1.6;
          const bh = fs * (0.35 + 1.2 * lines.length);
          for (const [ox, oy] of [[0, 0], [0, -0.5], [0, 0.5], [0, -1], [0, 1], [-0.7, 0], [0.7, 0], [0, -1.5], [0, 1.5], [-0.7, -1], [0.7, -1], [-0.7, 1], [0.7, 1], [0, -2], [0, 2]]) {
            const cx = MX + (fx + ox) * cs;
            const cy = MY + (fy + oy) * cs;
            const box = [cx - bw / 2 - fs * 0.5, cy - bh / 2, bw + fs, bh];
            const area = box[2] * box[3];
            let score = Math.hypot(ox, oy) * 0.5 + (1 - shrink) * 5 + li * 0.8;
            for (const o of hard) { const ov = overlap(box, o); if (ov > 0) score += 20 + (ov / area) * 40; }
            for (const o of placed) score += (overlap(box, o) / area) * 30;
            if (!seenCell(Math.floor(fx + ox), Math.floor(fy + oy))) score += 3;
            if (!pick || score < pick.score) pick = { cx, cy, bw, bh, fs, box, score, lines };
          }
        }
        if (pick.score < 20) break;
      }
      placed.push(pick.box);
      this._banner(g, pick.cx, pick.cy, pick.bw, pick.bh, pick.fs, pick.lines);
    }
    g.restore();
  }

  /** A painted ribbon banner lying flat on the sheet: cream slip, folded tails, inked caps. */
  _banner(g, cx, cy, w, h, fs, lines) {
    g.save();
    g.font = `bold ${fs.toFixed(1)}px ${SERIF}`;
    g.letterSpacing = `${(fs * 0.14).toFixed(1)}px`;
    const tail = fs * 1.15;
    const th = fs * 1.55;
    // folded tails tucked behind the slip, in a darker sepia wash
    g.fillStyle = 'rgba(150,96,52,0.95)';
    g.strokeStyle = 'rgba(43,26,13,0.9)';
    g.lineWidth = fs * 0.06;
    for (const s of [-1, 1]) {
      g.beginPath();
      const x0 = cx + s * (w / 2 - th * 0.2);
      g.moveTo(x0, cy - th * 0.3);
      g.lineTo(x0 + s * tail, cy - th * 0.3);
      g.lineTo(x0 + s * tail * 0.72, cy + th * 0.12);
      g.lineTo(x0 + s * tail, cy + th * 0.55);
      g.lineTo(x0, cy + th * 0.55);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // a soft wash shadow, then the slip
    g.fillStyle = 'rgba(60,34,14,0.22)';
    g.fillRect(cx - w / 2 + fs * 0.12, cy - h / 2 + fs * 0.16, w, h);
    const body = g.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
    body.addColorStop(0, 'rgba(246,236,210,0.98)');
    body.addColorStop(1, 'rgba(226,206,164,0.98)');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(cx - w / 2, cy - h / 2);
    g.quadraticCurveTo(cx, cy - h / 2 - fs * 0.12, cx + w / 2, cy - h / 2);
    g.lineTo(cx + w / 2, cy + h / 2);
    g.quadraticCurveTo(cx, cy + h / 2 - fs * 0.12, cx - w / 2, cy + h / 2);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(168,50,32,0.7)';
    g.lineWidth = fs * 0.04;
    g.strokeRect(cx - w / 2 + fs * 0.2, cy - h / 2 + fs * 0.18, w - fs * 0.4, h - fs * 0.36);
    g.fillStyle = '#3a1a0c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, cx + fs * 0.07, cy + fs * 0.06 + (i - (lines.length - 1) / 2) * fs * 1.2));
    g.restore();
  }

  _pennantTexture(T) {
    const c = makeCanvas(256, 160);
    const g = c.getContext('2d');
    g.fillStyle = '#a8301e';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(255,200,150,0.12)';
    for (let i = 0; i < 40; i++) g.fillRect(0, i * 4, 256, 1);
    g.strokeStyle = '#e8c46a';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 244, 148);
    // a gilt chevron (the Company's device)
    g.fillStyle = '#f0cf78';
    g.beginPath(); g.moveTo(40, 120); g.lineTo(128, 40); g.lineTo(216, 120); g.lineTo(186, 120); g.lineTo(128, 70); g.lineTo(70, 120); g.closePath(); g.fill();
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _pinTexture(kind, T) {
    const c = makeCanvas(160);
    drawPin(c.getContext('2d'), 80, 80, 130, kind);
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _props(scene, T, M_) {
    // candle: brass chamberstick, dripping wax, flame
    const candle = new THREE.Group();
    const brass = M_.gold;
    const holder = new THREE.LatheGeometry([
      [0, 0], [1.05, 0], [1.1, 0.05], [1.0, 0.12], [0.5, 0.16], [0.42, 0.3], [0.48, 0.36], [0.36, 0.4], [0, 0.4],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 40);
    const hm = new THREE.Mesh(T(holder), brass);
    const waxMat = T(new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5, envMapIntensity: 0.4 }));
    const waxPts = [];
    for (let i = 0; i <= 24; i++) {
      const y = 0.4 + (i / 24) * 2.2;
      const drip = i > 18 ? 0.04 * Math.sin(i * 2.1) : 0.01 * Math.sin(i * 1.7);
      waxPts.push(new THREE.Vector2(0.3 + drip + (i === 24 ? -0.04 : 0), y));
    }
    waxPts.unshift(new THREE.Vector2(0, 0.4));
    waxPts.push(new THREE.Vector2(0.22, 2.62), new THREE.Vector2(0, 2.6));
    const wax = new THREE.Mesh(T(new THREE.LatheGeometry(waxPts, 32)), waxMat);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + 0.4;
      const len = 0.25 + (i % 3) * 0.2;
      const d = new THREE.Mesh(T(new THREE.CapsuleGeometry(0.04, len, 4, 8)), waxMat);
      d.position.set(Math.cos(a) * 0.3, 2.55 - len / 2, Math.sin(a) * 0.3);
      candle.add(d);
    }
    const wick = new THREE.Mesh(T(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6)), T(new THREE.MeshStandardMaterial({ color: 0x1a120c })));
    wick.position.y = 2.68;
    const flameMat = T(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85 }));
    const flame = new THREE.Mesh(T(new THREE.SphereGeometry(0.09, 16, 12)), flameMat);
    flame.scale.set(1, 2.6, 1);
    flame.position.y = 2.92;
    const core = new THREE.Mesh(T(new THREE.SphereGeometry(0.05, 12, 8)), T(new THREE.MeshBasicMaterial({ color: 0xfff4d8 })));
    core.scale.set(1, 2.2, 1);
    core.position.y = 2.86;
    candle.add(core);
    for (const m of [hm, wax, ...candle.children]) { m.castShadow = true; m.receiveShadow = true; }
    candle.add(hm, wax, wick, flame);
    candle.position.set(-3.3, 0, 1.6);
    scene.add(candle);
    this.flame = flame;
    const glowC = makeCanvas(128);
    {
      const g = glowC.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,220,150,0.9)');
      gr.addColorStop(0.35, 'rgba(255,170,80,0.3)');
      gr.addColorStop(1, 'rgba(255,150,60,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    const halo = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: T(new THREE.CanvasTexture(glowC)), color: 0xffb070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 })));
    halo.scale.set(2.4, 2.4, 1);
    halo.position.set(-3.3, 2.95, 1.6);
    scene.add(halo);
    const candleLight = new THREE.PointLight(0xff9448, 14, 40, 1.35);
    candleLight.position.set(-3.1, 3.4, 1.8);
    scene.add(candleLight);
    this.candleLight = candleLight;

    // inkwell: squat glass bottle with ink inside, brass collar, glinting rim
    const ink = new THREE.Group();
    const prof = [[0, 0], [0.62, 0], [0.7, 0.05], [0.74, 0.3], [0.7, 0.5], [0.52, 0.64], [0.3, 0.7], [0.27, 0.82], [0.31, 0.86], [0.3, 0.9], [0.24, 0.9], [0.22, 0.72]].map(([x, y]) => new THREE.Vector2(x, y));
    const glass = T(new THREE.MeshPhysicalMaterial({ color: 0x324656, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.62, envMapIntensity: 2.2, specularIntensity: 1 }));
    const bottle = new THREE.Mesh(T(new THREE.LatheGeometry(prof, 48)), glass);
    bottle.castShadow = true;
    const inkIn = new THREE.Mesh(T(new THREE.LatheGeometry([[0, 0.03], [0.6, 0.03], [0.66, 0.3], [0.6, 0.46], [0, 0.46]].map(([x, y]) => new THREE.Vector2(x, y)), 40)), T(new THREE.MeshStandardMaterial({ color: 0x06080e, roughness: 0.12, envMapIntensity: 1 })));
    const collar = new THREE.Mesh(T(new THREE.TorusGeometry(0.29, 0.035, 10, 32)), brass);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.74;
    const rim = new THREE.Mesh(T(new THREE.TorusGeometry(0.275, 0.018, 8, 40)), T(new THREE.MeshPhysicalMaterial({ color: 0xbfd4e0, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.7, envMapIntensity: 3 })));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.9;
    ink.add(inkIn, bottle, collar, rim);
    ink.position.set(-2.9, 0, 14.6);
    ink.scale.setScalar(1.15);
    scene.add(ink);

    // quill: tapered shaft and a barbed vane (alpha-tested, curved), dipped in the well
    const quill = new THREE.Group();
    const shaftPts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      shaftPts.push(new THREE.Vector2(0.034 * (1 - t) ** 0.7 + 0.003, t * 4.6));
    }
    shaftPts.unshift(new THREE.Vector2(0, 0));
    const shaft = new THREE.Mesh(T(new THREE.LatheGeometry(shaftPts, 10)), T(new THREE.MeshStandardMaterial({ color: 0xe9dfc6, roughness: 0.35, envMapIntensity: 0.6 })));
    shaft.castShadow = true;
    const vaneGeo = T(new THREE.PlaneGeometry(1.15, 3.6, 8, 40));
    const vp = vaneGeo.attributes.position;
    for (let i = 0; i < vp.count; i++) {
      const x = vp.getX(i);
      const y = vp.getY(i) + 1.8;
      const t = y / 3.6;
      vp.setXYZ(i, x + 0.12 * t * t, y + 0.95, Math.abs(x) * 0.18 - 0.1 * Math.sin(t * Math.PI));
    }
    vaneGeo.computeVertexNormals();
    const vane = new THREE.Mesh(vaneGeo, T(new THREE.MeshStandardMaterial({ map: this._featherTexture(T), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.4 })));
    vane.castShadow = true;
    quill.add(shaft, vane);
    quill.position.set(-2.9, 0.62, 14.6);
    quill.rotation.set(-0.5, 0.2, 0.32);
    quill.scale.setScalar(0.66);
    scene.add(quill);
  }

  _featherTexture(T) {
    const W = 256;
    const H = 1024;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const r = prng(808);
    const cx = W / 2;
    // vane half-widths along the length (y from tip at top to base at bottom)
    const half = (t, side) => {
      const body = Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.6;
      return (side < 0 ? 0.92 : 0.62) * (W / 2 - 6) * body * (t < 0.08 ? t / 0.08 : 1);
    };
    for (let i = 0; i < 520; i++) {
      const t = i / 520;
      const y = 20 + t * (H - 200);
      for (const side of [-1, 1]) {
        if (r() < 0.035) continue; // a split between barbs
        const L = half(1 - t, side) * (0.92 + r() * 0.1);
        // goose-grey mottling in soft bands, paler toward the shaft, darker at the tip
        const band = 0.5 + 0.5 * Math.sin(t * 38 + Math.sin(t * 7) * 2 + side);
        const tone = 206 + r() * 18 - band * 34 - (t < 0.18 ? 60 * (0.18 - t) / 0.18 : 0);
        g.strokeStyle = `rgba(${tone | 0},${(tone * 0.95) | 0},${(tone * 0.86) | 0},${(0.8 + r() * 0.18).toFixed(2)})`;
        g.lineWidth = 1.2 + r() * 0.8;
        g.beginPath();
        g.moveTo(cx, y);
        g.quadraticCurveTo(cx + side * L * 0.6, y - L * 0.25, cx + side * L, y - L * 0.55);
        g.stroke();
      }
    }
    // a soft grey-brown bar toward the tip, like a goose quill
    g.globalCompositeOperation = 'source-atop';
    const band = g.createLinearGradient(0, 0, 0, H);
    band.addColorStop(0, 'rgba(120,96,70,0.35)');
    band.addColorStop(0.2, 'rgba(120,96,70,0)');
    band.addColorStop(0.7, 'rgba(0,0,0,0)');
    band.addColorStop(1, 'rgba(90,70,50,0.25)');
    g.fillStyle = band;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(236,226,200,1)';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, 10); g.lineTo(cx, H - 160); g.stroke();
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /** The board cell under a screen point (raycast onto the sheet), or null. */
  cellAt(sx, sy) {
    if (!this.map || !this.w) return null;
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.03), p)) return null;
    const x = Math.floor(p.x);
    const y = Math.floor(p.z);
    return this.map.inBounds(x, y) ? { x, y } : null;
  }

  /** A gilt square traced on the paper round the hovered cell (null hides it). */
  setHover(c) {
    if (!this.scene) return;
    if (!this.hoverMark) {
      const geo = new THREE.BufferGeometry().setFromPoints([[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
      this.hoverMark = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.95, depthTest: false }));
      this.hoverMark.renderOrder = 10;
      this.own.push(geo, this.hoverMark.material);
    }
    if (this.hoverMark.parent !== this.scene) this.scene.add(this.hoverMark);
    this.hoverMark.visible = !!c;
    if (c) this.hoverMark.position.set(c.x, 0.075, c.y);
  }

  resize(w, h, rect) {
    this.w = w;
    this.h = h;
    this.rect = rect ?? { x: 0, y: 0, w, h };
    this.camera.aspect = w / h;
    const cx = this.rect.x + this.rect.w / 2;
    const cy = this.rect.y + this.rect.h / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    this.camera.updateProjectionMatrix();
    if (this.bounds) this._refit(!this._fitted);
  }

  /** Projected screen bbox of the sheet's corners for a camera at the given orbit. */
  _projectBox(az, el, dist, target) {
    const cam = this.camera;
    cam.position.set(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const b of this.bounds) {
      v.copy(b).project(cam);
      const sx = (v.x + 1) / 2 * this.w;
      const sy = (1 - v.y) / 2 * this.h;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  }

  /** Find the distance (and centring) at which the whole sheet fits the view rect. */
  _refit(snap) {
    if (!this.w || !this.bounds) return;
    const r = this.rect;
    const m = Math.min(r.w, r.h) * 0.015;
    const target = this.target.clone();
    let dist = this.fitDist;
    for (let it = 0; it < 4; it++) {
      let lo = 4;
      let hi = 160;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        const b = this._projectBox(this.az, this.el, mid, target);
        const fits = b.minX >= r.x + m && b.maxX <= r.x + r.w - m && b.minY >= r.y + m && b.maxY <= r.y + r.h - m;
        if (fits) hi = mid; else lo = mid;
      }
      dist = hi;
      const b = this._projectBox(this.az, this.el, dist, target);
      const dx = (b.minX + b.maxX) / 2 - (r.x + r.w / 2);
      const dy = (b.minY + b.maxY) / 2 - (r.y + r.h / 2);
      const upp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.h;
      const right = new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az));
      const fwd = new THREE.Vector3(-Math.sin(this.az), 0, -Math.cos(this.az));
      target.addScaledVector(right, dx * upp);
      target.addScaledVector(fwd, (-dy * upp) / Math.max(0.3, Math.sin(this.el)));
    }
    this.fitDist = dist;
    this._fitted = true;
    this.fitTarget = target;
    this.target.copy(target);
    // leaning in (zoom > 1) drifts the view toward the party
    if (this.party && this.zoomLevel > 1) {
      const k = Math.min(1, (this.zoomLevel - 1) / 1.2);
      this.target.lerp(new THREE.Vector3(this.party.x + 0.5, 0, this.party.y + 0.5), k);
    }
    this.dist = dist / this.zoomLevel;
    if (snap) {
      this.cur = { az: this.az, el: this.el, dist: this.dist, target: this.target.clone() };
    }
    this._applyCamera();
  }

  orbitBy(dx, dy, pan = false) {
    if (pan) {
      this.panBy(-dx * this.dist * 0.0022, -dy * this.dist * 0.0022);
      return;
    }
    // the board never turns its back or tips out of frame
    this.az = Math.max(-0.75, Math.min(0.5, this.az - dx * 0.006));
    this.el = Math.max(0.55, Math.min(1.42, this.el + dy * 0.004));
  }

  /** Pan in the ground plane relative to the view (units). */
  panBy(dx, dz) {
    const s = Math.sin(this.az);
    const c = Math.cos(this.az);
    const b = this.sheetBox ?? { x0: -3, z0: -3, x1: this.map.w + 8, z1: this.map.h + 3 };
    this.target.x = Math.max(b.x0 + 3, Math.min(b.x1 - 3, this.target.x + dx * c + dz * s));
    this.target.z = Math.max(b.z0 + 3, Math.min(b.z1 - 3, this.target.z - dx * s + dz * c));
  }

  dolly(f) {
    this.dist = Math.max(this.fitDist * 0.22, Math.min(this.fitDist * 1.12, this.dist * f));
    this.zoomLevel = this.fitDist / this.dist;
  }

  focusParty() {
    if (!this.party) return;
    this.target.set(this.party.x + 0.5, 0, this.party.y + 0.5);
    this.dist = Math.min(this.dist, this.fitDist * 0.45);
    this.zoomLevel = this.fitDist / this.dist;
  }

  _applyCamera() {
    const { az, el, dist, target } = this.cur;
    this.camera.position.set(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
    this.camera.lookAt(target);
  }

  update(dt, t) {
    const a = dt === 0 ? 1 : 1 - Math.exp(-dt * 10);
    const c = this.cur;
    c.az += (this.az - c.az) * a;
    c.el += (this.el - c.el) * a;
    c.dist += (this.dist - c.dist) * a;
    c.target.lerp(this.target, a);
    this._applyCamera();
    if (this.marker) this.marker.flag.rotation.y = Math.sin(t * 1.7) * 0.12;
    for (const v of this.veils ?? []) v.tex.offset.set(t * v.speed + v.phase, t * v.speed * 0.6);
    if (this.partyGlow) this.partyGlow.material.opacity = 0.45 + 0.15 * Math.sin(t * 2.6);
    if (this.candleLight) {
      const f = 0.86 + 0.1 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * (hash2(Math.floor(t * 18), 3, 1) - 0.5);
      this.candleLight.intensity = 14 * f;
      this.flame.scale.set(1, 2.6 * (0.92 + f * 0.1), 1);
    }
  }
}
