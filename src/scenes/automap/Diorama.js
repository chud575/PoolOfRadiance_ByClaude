import * as THREE from 'three';
import { EDGE, CELL } from '../../data/maps/MapGrid.js';
import { SHEET, collectEdges, mergeRuns, eventMarker, exitBanner } from './BlockSheet.js';
import { makeCanvas, makeDesk, grainTile, prng, INK } from './ink.js';
import { PIN_KINDS, drawPin, drawMarker } from './glyphs.js';
import { SERIF } from './ornaments.js';
import { buildPartyMiniature } from './miniature.js';
import { hash2, fbm } from '../../render/textures/noise.js';
import { preloadTextureSets, getTextureSet } from '../../render/textures/index.js';

/** Fold lines of the blank leaf over unsurveyed ground: [dir x, dir z, offset (fraction), +1 mountain / -1 valley]. */
const LEAF_FOLDS = [[1, 0, 0.5, 1], [0, 1, 0.34, -1], [0, 1, 0.67, 1], [0.7071, 0.7071, 0.52, -0.6]];

/** A white vertex-colour set, for primitives drawn with the AO-baked (vertexColors) materials. */
const whiteCol = (geo) => { geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3)); return geo; };

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
    /** per-run paint tint (a painted miniature: each building mixed a shade apart) */
    this.hue = [1, 1, 1];
    /** drybrush: upward faces and arrises catch a lighter dusting of pigment */
    this.dry = 1.16;
  }

  _v(x, y, z, nx, ny, nz, u, v, c) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    const d = ny > 0.5 ? this.dry : 1;
    const h = this.hue;
    this.c.push(c * h[0] * d, c * h[1] * d, c * h[2] * d);
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

  /**
   * A box between two points p0 -> p1 (its long axis), `w` wide across the long axis
   * within the plane perpendicular to `n`, and `dp` deep along `n` (unit, horizontal).
   */
  beam(p0, p1, w, dp, n, { tint = 1, us = 3 } = {}) {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const L = Math.hypot(ux, uy, uz) || 1;
    const u = [ux / L, uy / L, uz / L];
    // v = n x u
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    const P = (a, b, e) => [c[0] + u[0] * a + v[0] * b + n[0] * e, c[1] + u[1] * a + v[1] * b + n[1] * e, c[2] + u[2] * a + v[2] * b + n[2] * e];
    const ha = L / 2;
    const hb = w / 2;
    const he = dp / 2;
    const faces = [
      [n, [[-ha, -hb, he], [ha, -hb, he], [ha, hb, he], [-ha, hb, he]]],
      [[-n[0], -n[1], -n[2]], [[ha, -hb, -he], [-ha, -hb, -he], [-ha, hb, -he], [ha, hb, -he]]],
      [v, [[-ha, hb, he], [ha, hb, he], [ha, hb, -he], [-ha, hb, -he]]],
      [[-v[0], -v[1], -v[2]], [[ha, -hb, he], [-ha, -hb, he], [-ha, -hb, -he], [ha, -hb, -he]]],
    ];
    for (const [nn, q] of faces) {
      const ids = q.map(([a, b, e], k) => {
        const p = P(a, b, e);
        return this._v(p[0], p[1], p[2], nn[0], nn[1], nn[2], (k === 1 || k === 2 ? L : 0) * us, (k >= 2 ? w : 0) * us, tint);
      });
      // winding: make the face point along nn
      const a = q[0]; const b = q[1]; const cc = q[2];
      const pa = P(...a); const pb = P(...b); const pc = P(...cc);
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] >= 0) this.quad(ids[0], ids[1], ids[2], ids[3]);
      else this.quad(ids[3], ids[2], ids[1], ids[0]);
    }
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
    this.az = -0.16;
    // a lower three-quarter view: the walls stand up as miniatures
    this.el = 0.74;
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
    this.signScene = null;
    this.signs = [];
  }

  dispose() {
    this._disposeScene();
    this.rt?.dispose();
    this.rt = null;
    this.rtS?.dispose();
    this.rtS = null;
    this.dof?.material.dispose();
    this.dof?.geometry.dispose();
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
  build(map, sheet, { seen, secrets, party, notes, zoom = 1, spent = null }) {
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
    // walls follow the sheet: walked squares and those in plain sight down a street
    const seenCell = sheet.seenCell ?? ((x, y) => map.inBounds(x, y) && !info.isRock(x, y) && seen(x, y));
    const walkedCell = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && seen(x, y);
    const dungeon = map.tileset === 'dungeon' || map.kind === 'dungeon';
    const wild = map.tileset === 'wilderness' || map.tileset === 'graveyard';
    // per-building paint: each run of masonry takes the tint of the building it bounds
    const regId = sheet.regions?.id;
    const hueAt = (x, z) => {
      const cx = Math.max(0, Math.min(map.w - 1, Math.floor(x)));
      const cz = Math.max(0, Math.min(map.h - 1, Math.floor(z)));
      const rid = regId ? regId[cz * map.w + cx] : cx * 7 + cz;
      const a = hash2(rid, 3, 17);
      const b = hash2(rid, 5, 23);
      const v = 0.9 + b * 0.16;
      // warm ochre .. cool grey-green, kept subtle
      return [v * (1 + (a - 0.5) * 0.1), v * (1 + (b - 0.5) * 0.05), v * (1 - (a - 0.5) * 0.12)];
    };

    // ---------- desk: walnut planks ----------
    // the desk lies beyond the focal plane of the miniature: its grain softened, as a
    // macro lens would render it
    const deskSharp = makeDesk(1024, 1024, { lit: false, seed: 9, tone: [70, 48, 32] });
    const deskCanvas = makeCanvas(1024);
    {
      const dg = deskCanvas.getContext('2d');
      dg.filter = 'blur(1px)';
      // drawn three times over (tiled) so the blur wraps and the repeat stays seamless
      for (const ox of [-1024, 0, 1024]) for (const oy of [-1024, 0, 1024]) dg.drawImage(deskSharp, ox, oy);
    }
    const deskTex = T(new THREE.CanvasTexture(deskCanvas));
    deskTex.colorSpace = THREE.SRGBColorSpace;
    deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping;
    deskTex.repeat.set(2.4, 2.4);
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
    // relief from the survey itself: the inked joints of every slab and sett sink, each
    // stone's tone lifts or lowers it a hair, and the paper's tooth runs under it all,
    // so the paving reads as a sculpted miniature floor rather than a printed decal
    const relief = (() => {
      const src = sheet.canvas;
      const RW = 2400;
      const RH = Math.round((RW * src.height) / src.width);
      const c = makeCanvas(RW, RH);
      const g2 = c.getContext('2d');
      g2.fillStyle = '#c8c8c8';
      g2.fillRect(0, 0, RW, RH);
      g2.save();
      g2.globalAlpha = 0.5;
      g2.fillStyle = g2.createPattern(grainTile(), 'repeat');
      g2.fillRect(0, 0, RW, RH);
      g2.restore();
      // only the board's paving carries relief (the margin, cartouche and key stay flat)
      const sx = RW / (W + 2 * M);
      g2.save();
      g2.beginPath();
      g2.rect((M + MX) * sx, (M + MY) * sx, cs * map.w * sx, cs * map.h * sx);
      g2.clip();
      g2.filter = 'grayscale(1) contrast(1.9) brightness(1.15) blur(0.6px)';
      g2.globalCompositeOperation = 'multiply';
      g2.drawImage(src, 0, 0, RW, RH);
      g2.restore();
      const t = T(new THREE.CanvasTexture(c));
      t.anisotropy = maxAniso;
      return t;
    })();
    const paper = new THREE.Mesh(geo, T(new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.02, roughness: 0.88, metalness: 0, bumpMap: relief, bumpScale: 3.6, side: THREE.DoubleSide, envMapIntensity: 0.4,
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
    // the opening view frames the ground the company has surveyed (padded, never
    // tighter than a 9-square window), so the explored board fills the frame
    {
      let fx0 = Infinity; let fz0 = Infinity; let fx1 = -Infinity; let fz1 = -Infinity;
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (!seenCell(x, y)) continue;
        fx0 = Math.min(fx0, x); fz0 = Math.min(fz0, y); fx1 = Math.max(fx1, x + 1); fz1 = Math.max(fz1, y + 1);
      }
      if (party) { fx0 = Math.min(fx0, party.x); fz0 = Math.min(fz0, party.y); fx1 = Math.max(fx1, party.x + 1); fz1 = Math.max(fz1, party.y + 1); }
      if (Number.isFinite(fx0)) {
        const grow = (a, b, lo, hi) => {
          const m = 9 - (b - a);
          if (m > 0) { a -= m / 2; b += m / 2; }
          return [Math.max(lo, a - 0.7), Math.min(hi, b + 0.7)];
        };
        [fx0, fx1] = grow(fx0, fx1, -0.9, map.w + 0.9);
        [fz0, fz1] = grow(fz0, fz1, -0.9, map.h + 0.9);
        this.focusBounds = [];
        for (const [bx, bz] of [[fx0, fz0], [fx1, fz0], [fx0, fz1], [fx1, fz1]]) {
          this.focusBounds.push(new THREE.Vector3(bx, 0, bz), new THREE.Vector3(bx, 0.6, bz));
        }
      } else this.focusBounds = null;
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
      // furniture paint: red wool, blue wool and polished brass, so the props read on the floor
      cloth: T(new THREE.MeshStandardMaterial({ color: 0xa02a1c, roughness: 0.92, metalness: 0, vertexColors: true, envMapIntensity: 0.25 })),
      clothB: T(new THREE.MeshStandardMaterial({ color: 0x2c4a8a, roughness: 0.92, metalness: 0, vertexColors: true, envMapIntensity: 0.25 })),
      brass: T(new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.3, metalness: 1, vertexColors: true, envMapIntensity: 1.3 })),
      wood: T(new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.62, metalness: 0, vertexColors: true, envMapIntensity: 0.4 })),
      // building floors: raised plinths carrying the inked floor plan itself
      floor: T(new THREE.MeshStandardMaterial({ map: tex, bumpMap: relief, bumpScale: 3.6, vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 })),
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
      b.hue = key === 'city' ? [1, 1, 1] : hueAt(s.cx + (s.horiz ? 0 : 0.3), s.cz + (s.horiz ? 0.3 : 0));
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
          const grime = key === 'city' ? (rr() < 0.12 ? 0.72 : 1) * (0.84 + 0.16 * Math.min(1, (c + 0.5) / courses)) : 1;
          b.bevelBox(X + jx, c * ch + bh / 2, Z + jz, s.horiz ? bl : tt, bh, s.horiz ? tt : bl, { bevel: 0.009, tint: (0.78 + rr() * 0.28) * grime, aoH: 0.08, uo: rr() * 17, vo: rr() * 13 });
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
    /**
     * Timber & plaster, a storey taller than the stone houses: thick limewashed or
     * ochre infill panels between proud oak posts, sill beam, mid rail and a jettied
     * wall-plate, with diagonal braces in some bays (proper half-timbering).
     */
    const INFILL = [[1.0, 0.97, 0.9], [1.02, 0.9, 0.72], [0.98, 0.86, 0.78], [0.94, 0.94, 0.88]];
    const timberRun = (x0, z0, x1, z1) => {
      const th = 0.15;
      const h = wallH * (1.22 + rr() * 0.1);
      const s = span(x0, z0, x1, z1, th);
      const L = s.len + th;
      const P = batch('plaster');
      const inf = INFILL[Math.floor(rr() * INFILL.length)];
      const hb = hueAt(s.cx + (s.horiz ? 0 : 0.3), s.cz + (s.horiz ? 0.3 : 0));
      P.hue = [hb[0] * inf[0], hb[1] * inf[1], hb[2] * inf[2]];
      P.box(s.cx, h / 2, s.cz, s.horiz ? L : th, h, s.horiz ? th : L, { tint: 0.9 + rr() * 0.1, uo: rr() * 9, vo: rr() * 9 });
      const bm = batch('beam');
      const bt = th + 0.03;
      const at = (c, y, len, hh, o = {}) => bm.bevelBox(s.cx + (s.horiz ? c : 0), y, s.cz + (s.horiz ? 0 : c), s.horiz ? len : bt, hh, s.horiz ? bt : len, { ao: 0.7, us: 3, bevel: 0.006, ...o });
      at(0, 0.04, L + 0.01, 0.08);
      at(0, h * 0.52, L, 0.04);
      // the jettied plate oversails the wall a touch
      at(0, h - 0.03, L + 0.04, 0.06, { bevel: 0.012 });
      const n = Math.max(1, Math.round(L / (0.34 + rr() * 0.1)));
      const posts = [];
      for (let i = 0; i <= n; i++) posts.push(-L / 2 + 0.04 + (i / n) * (L - 0.08) + (i && i < n ? (rr() - 0.5) * 0.03 : 0));
      for (const p of posts) at(p, h / 2, 0.065, h, { tint: 0.8 + rr() * 0.25 });
      // braces: diagonal oak in some bays, lower and upper storeys
      const nrm = s.horiz ? [0, 0, 1] : [1, 0, 0];
      const W3 = (c, y) => (s.horiz ? [s.cx + c, y, s.cz] : [s.cx, y, s.cz + c]);
      for (let i = 0; i < posts.length - 1; i++) {
        const a0 = posts[i] + 0.03;
        const a1 = posts[i + 1] - 0.03;
        if (a1 - a0 < 0.16) continue;
        for (const [y0, y1] of [[0.08, h * 0.5], [h * 0.54, h - 0.06]]) {
          if (rr() > 0.45) continue;
          const flip = rr() < 0.5;
          bm.beam(W3(flip ? a0 : a1, y0), W3(flip ? a1 : a0, y1), 0.032, bt - 0.006, nrm, { tint: 0.82 + rr() * 0.2 });
        }
      }
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
      // floors are laid per building in their own stuff (oak boards, flagstones, packed
      // earth and straw, rubble-strewn dirt in the ruins), painted into one atlas
      const atlas = this._floorAtlas(map, sheet, seenCell);
      const aTex = T(new THREE.CanvasTexture(atlas));
      aTex.colorSpace = THREE.SRGBColorSpace;
      aTex.anisotropy = maxAniso;
      const aBump = T(new THREE.CanvasTexture(atlas));
      aBump.anisotropy = maxAniso;
      M_.floor = T(new THREE.MeshStandardMaterial({ map: aTex, bumpMap: aBump, bumpScale: 2.4, vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.3 }));
      const uvFn = (x, z) => [x / map.w, 1 - z / map.h];
      const fl = batch('floor');
      fl.dry = 1;
      const fh = 0.06;
      // a room the survey has charted (stood in, or seen into through a door or arch)
      // shows its floor plan, exactly as the flat sheet draws it; one never seen into
      // is veiled
      const walkedRoom = new Set();
      for (const rg of sheet.regions?.list ?? []) if (rg.type === CELL.INTERIOR && rg.cells.some(([x, y]) => seenCell(x, y))) for (const [x, y] of rg.cells) walkedRoom.add(`${x},${y}`);
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (map.getCell(x, y) !== CELL.INTERIOR) continue;
        if (dungeon ? !seenCell(x, y) : !walkedRoom.has(`${x},${y}`)) continue;
        fl.box(x + 0.5, fh / 2, y + 0.5, 1.002, fh, 1.002, { uvFn, ao: 0.35, aoH: fh, tint: 1 });
      }
      if (!dungeon) this._veils(scene, T, map, sheet, seenCell, walkedRoom, wallH);
      // the rooms the company charted are furnished as on the plan (roofs lifted off)
      if (!dungeon) this._furnish(scene, T, batch, sheet, walkedRoom, fh, M_);
      if (!dungeon) this._clutter(scene, T, batch, map, sheet, walkedRoom, fh, M_);
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
      const floorDisc = T(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 0.02, 28));
      {
        // the fighting platform: radial flagstones in the UVs so the stone set reads as paving
        const fu = floorDisc.attributes.uv;
        const fpos = floorDisc.attributes.position;
        for (let i = 0; i < fu.count; i++) fu.setXY(i, fpos.getX(i) * 2.2 + 3, fpos.getZ(i) * 2.2 + 1);
      }
      const parapet = T(new THREE.CylinderGeometry(R - 0.01, R - 0.01, 0.07, 28, 1, true));
      const pUv = parapet.attributes.uv;
      for (let i = 0; i < pUv.count; i++) pUv.setXY(i, pUv.getX(i) * Math.PI * 2 * R * 1.6, pUv.getY(i) * 0.12);
      parapet.setAttribute('color', new THREE.BufferAttribute(new Float32Array(parapet.attributes.position.count * 3).fill(0.82), 3));
      const hatch = T(new THREE.BoxGeometry(0.11, 0.018, 0.11));
      hatch.setAttribute('color', new THREE.BufferAttribute(new Float32Array(hatch.attributes.position.count * 3).fill(1), 3));
      const colours = new Float32Array(drum.attributes.position.count * 3);
      for (let i = 0; i < drum.attributes.position.count; i++) {
        const y = drum.attributes.position.getY(i) + H / 2;
        const v = Math.min(1, 0.55 + y * 1.4);
        colours.set([v, v, v], i * 3);
      }
      drum.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      const capCol = new Float32Array(cap.attributes.position.count * 3).fill(1);
      cap.setAttribute('color', new THREE.BufferAttribute(capCol, 3));
      floorDisc.setAttribute('color', new THREE.BufferAttribute(new Float32Array(floorDisc.attributes.position.count * 3).fill(0.95), 3));
      for (const [x, z] of towers) {
        const d = new THREE.Mesh(drum, M_.city);
        d.position.set(x, H / 2, z);
        d.castShadow = d.receiveShadow = true;
        const c = new THREE.Mesh(cap, M_.city);
        c.position.set(x, H - 0.005, z);
        c.castShadow = c.receiveShadow = true;
        const f = new THREE.Mesh(floorDisc, M_.stone);
        f.position.set(x, H + 0.03, z);
        f.receiveShadow = true;
        const pp = new THREE.Mesh(parapet, M_.city);
        pp.position.set(x, H + 0.06, z);
        pp.castShadow = pp.receiveShadow = true;
        const hb = new THREE.Mesh(hatch, M_.door);
        hb.position.set(x + 0.08, H + 0.045, z + 0.06);
        hb.rotation.y = 0.4;
        hb.receiveShadow = true;
        scene.add(d, c, f, pp, hb);
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

    // ---------- fog of war: the unsurveyed ground as a raised, crumpled layer of vellum ----------
    // laid over the sheet like a second, blank leaf not yet cut back by the survey: it lifts
    // and buckles over the unknown, creases catching the candle, and settles flat to the
    // paper exactly where the charted ground begins (so it never covers a known wall)
    this.veils = [];
    if (sheet.fog) {
      const N = 160;
      const mc = makeCanvas(N + 1);
      const mg = mc.getContext('2d');
      mg.drawImage(sheet.fog, MX, MY, sheet.cs * map.w, sheet.cs * map.h, 0, 0, N + 1, N + 1);
      const md = mg.getImageData(0, 0, N + 1, N + 1).data;
      const raw = new Float32Array((N + 1) * (N + 1));
      for (let i = 0; i < raw.length; i++) raw[i] = md[i * 4 + 3] / 255;
      // erode a touch, then soften, so the leaf meets the paper just inside the fog line
      const soft = new Float32Array(raw.length);
      const R = 2;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        let mn = 1;
        let sum = 0;
        let n = 0;
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          const ii = Math.max(0, Math.min(N, i + di));
          const jj = Math.max(0, Math.min(N, j + dj));
          const v = raw[jj * (N + 1) + ii];
          mn = Math.min(mn, v);
          sum += v;
          n++;
        }
        soft[j * (N + 1) + i] = Math.min(sum / n, mn * 0.5 + (sum / n) * 0.5);
      }
      let any = false;
      for (let i = 0; i < soft.length; i++) if (soft[i] > 0.05) { any = true; break; }
      if (any) {
        const geo2 = T(new THREE.PlaneGeometry(map.w, map.h, N, N));
        geo2.rotateX(-Math.PI / 2);
        geo2.translate(map.w / 2, 0, map.h / 2);
        const p2 = geo2.attributes.position;
        const uv2 = geo2.attributes.uv;
        const col = new Float32Array(p2.count * 3);
        for (let i = 0; i < p2.count; i++) {
          const x = p2.getX(i);
          const z = p2.getZ(i);
          const ii = Math.round((x / map.w) * N);
          const jj = Math.round((z / map.h) * N);
          const m = soft[jj * (N + 1) + ii];
          // a blank leaf that has been folded and opened out: a few straight creases
          // (mountain and valley in turn) and one or two broad, slow undulations
          const sw = fbm(x * 0.12, z * 0.12, { period: 64, octaves: 2, seed: 67 });
          let crease = 0;
          for (const [ax, az, ox, sg] of LEAF_FOLDS) {
            const d = Math.abs((x - ox * map.w) * ax + (z - ox * map.h) * az);
            crease += sg * Math.max(0, 1 - d / 0.55) ** 1.6;
          }
          const cr = crease;
          // under a building the leaf lies flat (the linen veil stands there instead)
          const cxi = Math.min(map.w - 1, Math.max(0, Math.floor(x)));
          const czi = Math.min(map.h - 1, Math.max(0, Math.floor(z)));
          const flat = map.getCell(cxi, czi) === CELL.INTERIOR ? 0.1 : 1;
          const hgt = m * m * (0.05 + sw * 0.16 + crease * 0.05) * flat;
          p2.setY(i, 0.012 + hgt);
          // the leaf's UVs sample the sheet itself, so its face shows the graphite unknown
          uv2.setXY(i, (x - px0) / pw, 1 - (z - pz0) / ph);
          const sh = 0.9 + cr * 0.08;
          col.set([sh, sh * 0.985, sh * 0.96], i * 3);
        }
        geo2.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo2.computeVertexNormals();
        // the leaf's alpha: fog mask, so it feathers out where the survey begins
        const am = makeCanvas(N + 1);
        const ag = am.getContext('2d');
        const aimg = ag.createImageData(N + 1, N + 1);
        for (let i = 0; i < soft.length; i++) {
          const v = Math.round(Math.min(1, soft[i] * 1.6) * 255);
          aimg.data[i * 4] = aimg.data[i * 4 + 1] = aimg.data[i * 4 + 2] = v;
          aimg.data[i * 4 + 3] = 255;
        }
        ag.putImageData(aimg, 0, 0);
        const alphaTex = T(new THREE.CanvasTexture(am));
        // alphaMap uses the mesh UVs, so remap: draw it into sheet-UV space
        const fullA = makeCanvas(1536, Math.round(1536 * ph / pw));
        const fa = fullA.getContext('2d', { willReadFrequently: true });
        fa.fillStyle = '#000';
        fa.fillRect(0, 0, fullA.width, fullA.height);
        fa.imageSmoothingEnabled = true;
        fa.drawImage(am, (-px0 / pw) * fullA.width, (-pz0 / ph) * fullA.height, (map.w / pw) * fullA.width, (map.h / ph) * fullA.height);
        {
          // a torn edge, not a smoky fade: threshold the soft mask against a ragged,
          // fibrous noise so the blank leaf ends in a crisp tear with a deckle of fibres
          const im = fa.getImageData(0, 0, fullA.width, fullA.height);
          const d = im.data;
          const FW = fullA.width;
          for (let i = 0; i < d.length; i += 4) {
            const v = d[i] / 255;
            if (v <= 0.02 || v >= 0.98) { d[i] = d[i + 1] = d[i + 2] = v < 0.5 ? 0 : 255; continue; }
            const px = (i / 4) % FW;
            const py = Math.floor(i / 4 / FW);
            const n = fbm(px / 26, py / 26, { period: 256, octaves: 3, seed: 431 }) * 0.7 + hash2(px, py, 5) * 0.3;
            const t = 0.42 + (n - 0.5) * 0.4;
            const a = Math.max(0, Math.min(1, (v - t) / 0.03 + 0.5));
            d[i] = d[i + 1] = d[i + 2] = Math.round(a * 255);
          }
          fa.putImageData(im, 0, 0);
        }
        const alphaSheet = T(new THREE.CanvasTexture(fullA));
        alphaTex.dispose();
        const leaf = new THREE.Mesh(geo2, T(new THREE.MeshStandardMaterial({
          map: tex, alphaMap: alphaSheet, transparent: true, alphaTest: 0.5, vertexColors: true,
          roughness: 0.92, metalness: 0, bumpMap: grain, bumpScale: 0.6, envMapIntensity: 0.35, depthWrite: true,
        })));
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        scene.add(leaf);
      }
    }

    // ---------- party: a painted lead miniature on a pewter base with an enamel compass arrow ----------
    this.marker = null;
    if (party) {
      const grp = new THREE.Group();
      // a painted 28mm figure on a flocked base (see miniature.js), turned to the party's facing
      const mini = buildPartyMiniature(T, { pennant: this._pennantTexture(T) });
      const head3 = mini.group;
      head3.scale.setScalar(1.0);
      head3.rotation.y = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[party.dir] ?? 0;
      grp.add(head3);
      const flag = mini.flag;
      const flagGeo = mini.flagGeo;
      grp.position.set(party.x + 0.5, 0, party.y + 0.5);
      // a soft candle-gold glow on the paper under the base, so it is found at once
      const glow = new THREE.Mesh(T(new THREE.CircleGeometry(0.5, 48)), T(new THREE.MeshBasicMaterial({ map: this._glowTexture(T), color: 0xffb060, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.008;
      grp.add(glow);
      // a soft contact shadow pooled under the base, so the piece sits on the paper
      {
        const c = makeCanvas(128);
        const g2 = c.getContext('2d');
        const gr = g2.createRadialGradient(64, 64, 10, 64, 64, 64);
        gr.addColorStop(0, 'rgba(20,10,4,0.9)');
        gr.addColorStop(0.55, 'rgba(20,10,4,0.55)');
        gr.addColorStop(1, 'rgba(20,10,4,0)');
        g2.fillStyle = gr;
        g2.fillRect(0, 0, 128, 128);
        const cs2 = new THREE.Mesh(T(new THREE.CircleGeometry(0.46, 40)), T(new THREE.MeshBasicMaterial({ map: T(new THREE.CanvasTexture(c)), transparent: true, depthWrite: false })));
        cs2.rotation.x = -Math.PI / 2;
        cs2.position.set(0.03, 0.005, 0.03);
        cs2.renderOrder = 1;
        grp.add(cs2);
      }
      // scaled to sit within its own square, clear of the neighbouring walls
      grp.scale.setScalar(1.75);
      // a cool rim light behind the hero (from the far side of the board) to cut it out
      const rimL = new THREE.PointLight(0xc4d6ff, 9, 5.5, 1.6);
      rimL.position.set(party.x + 1.1, 2.4, party.y - 1.4);
      scene.add(rimL);
      const warmL = new THREE.PointLight(0xffd29a, 3.5, 4, 1.8);
      warmL.position.set(party.x - 0.6, 1.6, party.y + 1.6);
      scene.add(warmL);
      this.partyRing = null;
      this.partyGlow = glow;
      scene.add(grp);
      this.marker = { grp, flag, flagGeo };
    }

    // ---------- markers stand up as little painted flags ----------
    {
      const flags = [];
      for (const ev of map.events) {
        if (!walkedCell(ev.x, ev.y)) continue;
        const k = eventMarker(ev, !!(spent ?? {})[ev.id]);
        if (!k || k === 'text') continue;
        flags.push({ x: ev.x + 0.5, z: ev.y + 0.5, kind: k });
      }
      for (const q of segs) {
        const t = effective(q);
        if (t !== EDGE.SECRET && t !== EDGE.LOCKED) continue;
        const mx = (q.x0 + q.x1) / 2;
        const mz = (q.y0 + q.y1) / 2;
        // stand the flag just inside the square that owns the edge
        const [ox, oz] = q.horiz ? [0, q.cell[2] === 'N' ? 0.28 : -0.28] : [q.cell[2] === 'W' ? 0.28 : -0.28, 0];
        flags.push({ x: mx + ox, z: mz + oz, kind: t === EDGE.SECRET ? 'secret' : 'locked' });
      }
      if (flags.length) {
        const poleGeo = T(whiteCol(new THREE.CylinderGeometry(0.012, 0.014, 0.62, 6)));
        const knob = T(new THREE.SphereGeometry(0.026, 10, 8));
        const baseGeo = T(whiteCol(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 18)));
        const banner = T(new THREE.PlaneGeometry(0.3, 0.22, 8, 1));
        const bp = banner.attributes.position;
        for (let i = 0; i < bp.count; i++) {
          const u = bp.getX(i) / 0.3 + 0.5;
          bp.setZ(i, Math.sin(u * Math.PI * 1.4) * 0.025 * u);
        }
        banner.translate(0.15, 0, 0);
        banner.computeVertexNormals();
        const texCache = new Map();
        const flagTex = (kind) => {
          if (texCache.has(kind)) return texCache.get(kind);
          const c = makeCanvas(128, 96);
          const g2 = c.getContext('2d');
          const field = kind === 'secret' || kind === 'locked' ? '#a8321e' : kind === 'battle' ? '#2c3e68' : '#e8d6aa';
          g2.fillStyle = field;
          g2.fillRect(0, 0, 128, 96);
          g2.strokeStyle = kind === 'secret' || kind === 'locked' || kind === 'battle' ? '#e8c46a' : '#3a2412';
          g2.lineWidth = 5;
          g2.strokeRect(5, 5, 118, 86);
          const ink = kind === 'secret' || kind === 'locked' || kind === 'battle' ? '#f4e6c4' : INK.ink;
          if (kind === 'secret') {
            g2.font = `italic bold 70px ${SERIF}`;
            g2.textAlign = 'center';
            g2.textBaseline = 'middle';
            g2.fillStyle = ink;
            g2.fillText('S', 64, 52);
          } else {
            drawMarker(g2, kind === 'locked' ? 'treasure' : kind, 64, 48, 62, { color: ink, accent: '#e8c46a', seed: 3 });
            if (kind === 'locked') {
              g2.fillStyle = field; g2.fillRect(20, 10, 88, 76);
              g2.strokeStyle = ink; g2.lineWidth = 6;
              g2.beginPath(); g2.arc(64, 40, 14, Math.PI, 0); g2.stroke();
              g2.fillStyle = ink; g2.fillRect(44, 40, 40, 32);
              g2.fillStyle = field; g2.beginPath(); g2.arc(64, 54, 5, 0, Math.PI * 2); g2.fill(); g2.fillRect(62, 54, 4, 10);
            }
          }
          const t2 = T(new THREE.CanvasTexture(c));
          t2.colorSpace = THREE.SRGBColorSpace;
          texCache.set(kind, t2);
          return t2;
        };
        const poleMat = M_.beam;
        flags.forEach((f, i) => {
          const grp2 = new THREE.Group();
          const b = new THREE.Mesh(baseGeo, M_.city);
          b.position.y = 0.015;
          const pl = new THREE.Mesh(poleGeo, poleMat);
          pl.position.y = 0.34;
          const kn = new THREE.Mesh(knob, M_.gold);
          kn.position.y = 0.66;
          const bn = new THREE.Mesh(banner, T(new THREE.MeshStandardMaterial({ map: flagTex(f.kind), side: THREE.DoubleSide, roughness: 0.8 })));
          bn.position.set(0.01, 0.52, 0);
          for (const m of [b, pl, kn, bn]) { m.castShadow = true; m.receiveShadow = true; }
          grp2.add(b, pl, kn, bn);
          grp2.position.set(f.x, 0, f.z);
          // banners turned toward the camera's side of the board, each a little differently
          grp2.rotation.y = -0.35 + hash2(i, 7, 3) * 0.5;
          grp2.scale.setScalar(1.15);
          scene.add(grp2);
        });
      }
    }

    // ---------- note pins with their seals as flags ----------
    const needleMat = T(new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 1 }));
    const needleGeo = T(new THREE.CylinderGeometry(0.014, 0.004, 0.6, 6));
    const headGeo = T(new THREE.SphereGeometry(0.11, 20, 14));
    const pinsAt = new Map();
    for (const n of notes ?? []) {
      const kind = PIN_KINDS[n.kind] ?? PIN_KINDS.note;
      const mat = T(new THREE.MeshStandardMaterial({ color: new THREE.Color(kind.color), roughness: 0.62, metalness: 0, envMapIntensity: 0.4 }));
      // pins sharing a square fan out round it; one on the party's own square stands
      // off to the north-east corner, clear of the miniature and its facing notch
      const key = `${n.x},${n.y}`;
      const nth = pinsAt.get(key) ?? 0;
      pinsAt.set(key, nth + 1);
      const onParty = party && n.x === party.x && n.y === party.y;
      const fanA = (onParty ? -0.75 : -0.35) + nth * 0.9;
      const fanR = onParty ? 0.62 : 0.22 + (nth ? 0.14 : 0);
      const px = n.x + 0.5 + Math.cos(fanA) * fanR;
      const pz = n.y + 0.5 + Math.sin(fanA) * fanR * (onParty ? 1 : 0.8);
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

    // ---------- district names on painted signboards, standing on posts ----------
    this._signboards(scene, T, map, sheet, seenCell, party, M_);

    // ---------- props: candle, inkwell & quill (kept inside the framing) ----------
    this._props(scene, T, M_);

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0xb0b6c4, 0x3a2c20, 0.5));
    // a soft bounce off the desk on the shadow side, so north faces never go black
    const fill = new THREE.DirectionalLight(0xffd8b0, 0.55);
    fill.position.set(18, 9, 24);
    fill.target.position.set(8, 0, 8);
    scene.add(fill, fill.target);
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
    // a cool rim from beyond the board (a window behind the desk): it outlines every
    // wall-top and the miniature against the warm paving
    const rim = new THREE.DirectionalLight(0xc4d2f0, 0.8);
    rim.position.set(10, 7, -22);
    rim.target.position.set(8, 0, 8);
    scene.add(rim, rim.target);
    const moon = new THREE.DirectionalLight(0x9aaed8, 0.3);
    moon.position.set(28, 14, 20);
    moon.target.position.set(8, 0, 8);
    scene.add(moon, moon.target);
    const bounce = new THREE.PointLight(0xffc090, 1.4, 40, 1.2);
    bounce.position.set(8, 6, 26);
    scene.add(bounce);

    // ---------- camera: frame the explored footprint (the whole sheet bounds the dolly) ----------
    {
      let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (!seenCell(x, y)) continue;
        x0 = Math.min(x0, x); z0 = Math.min(z0, y); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, y + 1);
      }
      if (party) { x0 = Math.min(x0, party.x); z0 = Math.min(z0, party.y); x1 = Math.max(x1, party.x + 1); z1 = Math.max(z1, party.y + 1); }
      if (!Number.isFinite(x0)) { x0 = 0; z0 = 0; x1 = map.w; z1 = map.h; }
      // never frame tighter than a few squares round the party
      const minW = 9;
      const minH = 7;
      if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = Math.max(-0.5, c - minW / 2); x1 = x0 + minW; }
      if (z1 - z0 < minH) { const c = (z0 + z1) / 2; z0 = Math.max(-0.5, c - minH / 2); z1 = z0 + minH; }
      // a party at the edge of the block: keep the frame on the board, not the desk
      if (x1 > map.w + 0.5) { x0 -= x1 - map.w - 0.5; x1 = map.w + 0.5; }
      if (z1 > map.h + 0.5) { z0 -= z1 - map.h - 0.5; z1 = map.h + 0.5; }
      this.focusBounds = [];
      for (const [bx, bz] of [[x0 - 0.3, z0 - 0.3], [x1 + 0.3, z0 - 0.3], [x0 - 0.3, z1 + 0.3], [x1 + 0.3, z1 + 0.3]]) {
        this.focusBounds.push(new THREE.Vector3(bx, 0, bz), new THREE.Vector3(bx, 0.9, bz));
      }
    }
    this.zoomLevel = Math.max(0.5, zoom);
    this.target.set(px0 + pw / 2, 0, pz0 + ph / 2);
    this._fitted = false;
    this._refit(true);
  }

  /**
   * Buildings seen from the street but never entered: each is shrouded under a
   * cloth of unbleached linen, as a wargamer covers terrain not yet revealed.
   * The cloth rides the wall-tops, sags into the empty room between them in a
   * few long directional folds, falls down the wall faces in vertical pleats and
   * pools on the paper in a wrinkled, irregular hem. Plain-weave albedo with a
   * little charcoal staining; matte, with a faint cloth sheen.
   */
  _veils(scene, T, map, sheet, seenCell, walkedRoom, wallH) {
    const near = (x, y) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (seenCell(x + i, y + j)) return true; return false; };
    const list = (sheet.regions?.list ?? []).filter((rg) => rg.type === CELL.INTERIOR && rg.cells.length >= 2 && rg.cells.some(([x, y]) => near(x, y)) && !rg.cells.some(([x, y]) => walkedRoom.has(`${x},${y}`)));
    if (!list.length) return;
    // the weave alone tiles (a plain over-under at thread scale, with its own normal map);
    // every stain, water mark and sun-fade is laid in world space on the vertices, so no
    // two veils and no two stretches of one veil carry the same marks
    const linen = this._linenCanvas();
    const tex = T(new THREE.CanvasTexture(linen.color));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, this.ctx.render?.maxAnisotropy ?? 4);
    const nrm = T(new THREE.CanvasTexture(linen.normal));
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    nrm.anisotropy = tex.anisotropy;
    // a cool, unbleached grey-green linen: a different value and hue from the warm paper
    const mat = T(new THREE.MeshPhysicalMaterial({
      map: tex, normalMap: nrm, normalScale: new THREE.Vector2(0.45, 0.45), color: 0xb0a898, roughness: 0.9, metalness: 0, vertexColors: true, envMapIntensity: 0.22, side: THREE.DoubleSide,
      sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xe0dacc), specularIntensity: 0.25,
    }));
    const R = 14;
    for (const rg of list) {
      const has = new Set(rg.cells.map(([x, y]) => `${x},${y}`));
      let x0 = 99; let z0 = 99; let x1 = -1; let z1 = -1;
      for (const [x, y] of rg.cells) { x0 = Math.min(x0, x); z0 = Math.min(z0, y); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, y + 1); }
      const pad = 0.5;
      const W = x1 - x0 + pad * 2;
      const D = z1 - z0 + pad * 2;
      const nx = Math.ceil(W * R);
      const nz = Math.ceil(D * R);
      const geo = new THREE.PlaneGeometry(W, D, nx, nz);
      geo.rotateX(-Math.PI / 2);
      geo.translate(x0 - pad + W / 2, 0, z0 - pad + D / 2);
      const p = geo.attributes.position;
      const uv = geo.attributes.uv;
      const col = new Float32Array(p.count * 3);
      const seedR = rg.index * 13 + 5;
      const rnd = prng(seedR);
      // signed distance (cells) into the building: + inside, - outside
      const sdist = (px, pz) => {
        const cx = Math.floor(px);
        const cz = Math.floor(pz);
        const inside = has.has(`${cx},${cz}`);
        let d = 3;
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          if (has.has(`${cx + i},${cz + j}`) === inside) continue;
          const ex = Math.max(cx + i, Math.min(px, cx + i + 1));
          const ez = Math.max(cz + j, Math.min(pz, cz + j + 1));
          d = Math.min(d, Math.hypot(px - ex, pz - ez));
        }
        return inside ? d : -d;
      };
      const top = wallH * (rg.style === 1 ? 1.5 : 1.2);
      const minDim = Math.min(x1 - x0, z1 - z0);
      const sagMax = Math.min(top * 0.82, 0.22 + minDim * 0.12);
      // the cloth was thrown on from one side: its long folds all run one way
      const th = rnd() * Math.PI;
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      const span = Math.max(x1 - x0, z1 - z0);
      const ph = rnd() * 10;
      // where the slack pools: never the middle, a different spot under every veil
      const ccx = (x0 + x1) / 2;
      const ccz = (z0 + z1) / 2;
      const lowX = ccx + (rnd() - 0.5) * (x1 - x0) * 0.5;
      const lowZ = ccz + (rnd() - 0.5) * (z1 - z0) * 0.5;
      // the cloth catches on two to four points of the wall-tops (a jutting stone, a
      // beam end), each pulling its own tension fold down into the pool of slack
      const anchors = [];
      const nA = 2 + Math.floor(rnd() * 3);
      for (let a = 0; a < nA; a++) {
        const side = Math.floor(rnd() * 4);
        const t = 0.1 + rnd() * 0.8;
        const ax = side === 0 || side === 2 ? x0 + (x1 - x0) * t : side === 1 ? x1 : x0;
        const az = side === 1 || side === 3 ? z0 + (z1 - z0) * t : side === 2 ? z1 : z0;
        anchors.push([ax, az, 0.45 + rnd() * 0.9, 0.05 + rnd() * 0.07, 0.75 + rnd() * 0.5]);
      }
      // where along the walls the cloth spills long down over the lip onto the street
      const spillSeed = seedR + 41;
      const spillAmt = 0.55 + rnd() * 0.6;
      const crest = (t) => { const v = Math.sin(t); return Math.sign(v) * Math.abs(v) ** 0.6; };
      const hide = new Uint8Array(p.count);
      const relief = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const sd = sdist(x, z);
        // outward normal from the distance field's gradient
        const e = 0.03;
        let gx = sdist(x - e, z) - sdist(x + e, z);
        let gz = sdist(x, z - e) - sdist(x, z + e);
        const gl = Math.hypot(gx, gz) || 1;
        gx /= gl; gz /= gl;
        const along = x * -gz + z * gx;
        const n1 = fbm(x * 1.3, z * 1.3, { period: 64, octaves: 2, seed: seedR });
        let y;
        let rel = 0;
        if (sd >= 0) {
          // slack between the wall-tops: sags toward the middle, folds where it is loose
          let k = 1 - Math.exp(-sd / 0.45);
          let ridge = 0;
          for (const [qx, qz, qw, qwid, qreach] of anchors) {
            const vx = lowX - qx;
            const vz = lowZ - qz;
            const L = Math.hypot(vx, vz) || 1;
            const t = Math.max(0, Math.min(1, ((x - qx) * vx + (z - qz) * vz) / (L * L)));
            // the fold wanders a little as it falls, rather than running ruler-straight
            const dl = Math.abs((x - qx) * vz - (z - qz) * vx) / L + (n1 - 0.5) * 0.08;
            const w = qwid + t * 0.12;
            ridge += qw * Math.exp(-((dl / w) ** 2)) * Math.sin(Math.PI * Math.min(1, t / qreach)) * (t < qreach ? 1 : 0.3);
          }
          // one long slack fold across the middle, where the cloth was pulled over
          const tLin = (x * dx + z * dz) / Math.max(0.8, span * 0.5) * Math.PI * 2 + ph;
          const swag = Math.sin(tLin) * (0.3 + 0.35 * n1);
          // a pool of slack: the cloth bellies lowest round its own low point
          const pool = Math.exp(-(((x - lowX) ** 2 + (z - lowZ) ** 2) / (span * 0.38) ** 2));
          const fold = ridge * 0.85 + swag * 0.5 + (n1 - 0.5) * 0.5;
          k *= 0.62 + 0.55 * pool;
          const catenary = Math.cosh(Math.min(3, sd * 1.4)) - 1;
          y = Math.max(top * 0.14, top - sagMax * k * 1.25 + fold * 0.34 * k * (0.5 + sagMax / top) + 0.012 * (1 - k) - catenary * 0.002);
          rel = fold * 0.9 - k * 0.45 + (1 - k) * 0.6;
        } else {
          const o = -sd;
          const face = 0.07;
          const drop = 0.2;
          // the skirt length varies round the building: here it barely clears the wall
          // foot, there a long tongue of cloth has slid off the lip and lies on the street
          const sp = fbm(along * 0.55 + 7, seedR * 0.13, { period: 64, octaves: 2, seed: spillSeed });
          const tongue = Math.max(0, (sp - 0.5) * 2.4) ** 1.5 * spillAmt;
          const hem = 0.24 + 0.06 * fbm(along * 1.6 + 3, seedR * 0.1, { period: 64, octaves: 2, seed: seedR + 9 }) + tongue * 0.42;
          if (o > hem) hide[i] = 1;
          if (o < face) {
            // rounding over the wall's arris
            const q = o / face;
            y = top - (1 - Math.cos(q * Math.PI * 0.5)) * 0.05;
            rel = 0.7;
          } else if (o < drop) {
            // hanging down the wall face in pleats, flaring as it falls
            const q = (o - face) / (drop - face);
            y = (top - 0.05) * (1 - q ** 0.8) + 0.02 * q;
            const pleat = crest(along * Math.PI * 2 / 0.42 + n1 * 2);
            const push = pleat * 0.05 * q;
            p.setX(i, x + gx * push * -1);
            p.setZ(i, z + gz * push * -1);
            rel = pleat * 0.9 * q - q * 0.3;
          } else {
            // the skirt settles on the paper in a short apron, ending in a weighted,
            // rolled hem: a crisp raised bead with a stitched line just inside it
            const q = Math.min(1, (o - drop) / Math.max(0.05, hem - drop));
            const pleat = crest(along * Math.PI * 2 / (0.42 + tongue * 0.3) + n1 * 2 + o * tongue * 6);
            const toHem = hem - o;
            const bead = toHem < 0.05 ? Math.sin(Math.max(0, toHem) / 0.05 * Math.PI) * 0.016 : 0;
            y = 0.014 + (1 - q) * (0.02 + Math.max(0, pleat) * (0.03 + tongue * 0.04)) + Math.max(0, pleat) * tongue * 0.012 + bead;
            rel = pleat * 0.5 * (1 - q) - 0.15 + (bead > 0 ? 0.5 : 0) - (toHem > 0.06 && toHem < 0.075 ? 0.7 : 0);
          }
        }
        p.setY(i, Math.max(0.012, y));
        relief[i] = rel;
        // weave UVs in world units (one repeat per half square), wrapped down the
        // hanging faces along the wall so the threads never stretch
        const U = 2.2;
        if (sd >= 0) uv.setXY(i, p.getX(i) * U, p.getZ(i) * U);
        else if (Math.abs(gz) >= Math.abs(gx)) uv.setXY(i, p.getX(i) * U, (z0 + z1) + (sd < 0 ? Math.sign(gz) : 0) * (top - y) * U + p.getZ(i) * 0.3);
        else uv.setXY(i, p.getZ(i) * U, (x0 + x1) + Math.sign(gx) * (top - y) * U + p.getX(i) * 0.3);
      }
      for (let i = 0; i < p.count; i++) {
        const rv = relief[i];
        const sh = Math.max(0.34, Math.min(1.12, 0.8 + rv * 0.42));
        // world-space staining: broad sun-faded and damp-darkened drifts, a few tide-lined
        // water marks, soot settling in the low folds; never periodic within the block
        const wx = p.getX(i);
        const wz = p.getZ(i);
        const broad = fbm(wx * 0.45 + 11, wz * 0.45 - 4, { period: 256, octaves: 3, seed: 517 });
        const blot = fbm(wx * 1.7 - 2, wz * 1.7 + 9, { period: 256, octaves: 3, seed: 523 + rg.index });
        const tide = Math.abs(blot - 0.62);
        const mark = blot > 0.62 ? 0.16 : tide < 0.014 ? 0.22 : 0;
        const soot = Math.max(0, -rv) * 0.18;
        const fade = (broad - 0.5) * 0.24;
        const d = Math.max(0, Math.min(0.55, mark + soot - fade * 0.6));
        const v = sh * (1 + fade * 0.4);
        col.set([v * (1 - d * 0.75), v * (1 - d * 0.85), v * (1 - d * 1.0)], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      // trim the hem: drop every triangle lying wholly beyond it
      const idx = geo.index.array;
      const keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        if (hide[idx[t]] && hide[idx[t + 1]] && hide[idx[t + 2]]) continue;
        keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      geo.setIndex(keep);
      geo.computeVertexNormals();
      T(geo);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  /** Floor stuff of a building: 0 boards, 1 flags, 2 packed earth, 3 rubble-strewn dirt. */
  _floorKind(rg) {
    if (rg.style === 2) return 3;
    if (rg.style === 1) return hash2(rg.index, 2, 7) < 0.75 ? 0 : 2;
    const h = hash2(rg.index, 3, 11);
    return h < 0.45 ? 1 : h < 0.8 ? 0 : 2;
  }

  /**
   * One canvas over the whole block (PX px a square) carrying each charted building's
   * floor: oak boards running one way per room with staggered butt joints and nail
   * heads, irregular coursed flagstones, packed earth with straw and grit, and in the
   * ruins dirt strewn with broken stone; woven rugs lie in the better rooms. Inked
   * joints keep it of a piece with the survey.
   */
  _floorAtlas(map, sheet, seenCell) {
    const PX = 96;
    const c = makeCanvas(map.w * PX, map.h * PX);
    const g = c.getContext('2d');
    g.fillStyle = '#8a7656';
    g.fillRect(0, 0, c.width, c.height);
    for (const rg of sheet.regions?.list ?? []) {
      if (rg.type !== CELL.INTERIOR || !rg.cells.some(([x, y]) => seenCell(x, y))) continue;
      const r = prng(rg.index * 97 + 13);
      const kind = this._floorKind(rg);
      let x0 = 99; let y0 = 99; let x1 = -1; let y1 = -1;
      for (const [x, y] of rg.cells) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
      const X0 = x0 * PX; const Y0 = y0 * PX; const X1 = x1 * PX; const Y1 = y1 * PX;
      g.save();
      g.beginPath();
      for (const [x, y] of rg.cells) g.rect(x * PX, y * PX, PX, PX);
      g.clip();
      if (kind === 0) {
        // boards
        const vert = r() < 0.5;
        const bw = PX / (5 + Math.floor(r() * 2));
        const base = [[118, 78, 44], [104, 70, 40], [132, 92, 54]][Math.floor(r() * 3)];
        const along = vert ? Y1 - Y0 : X1 - X0;
        const across = vert ? X1 - X0 : Y1 - Y0;
        for (let a = 0; a < across; a += bw) {
          let b = -r() * PX * 1.5;
          while (b < along) {
            const L = PX * (1.1 + r() * 1.6);
            const t = 0.82 + r() * 0.3;
            const col = `rgb(${base[0] * t | 0},${base[1] * t | 0},${base[2] * t | 0})`;
            const [rx, ry, rw, rh] = vert ? [X0 + a, Y0 + b, bw, L] : [X0 + b, Y0 + a, L, bw];
            g.fillStyle = col;
            g.fillRect(rx, ry, rw, rh);
            // grain: fine dark streaks along the board
            g.strokeStyle = 'rgba(40,22,10,0.22)';
            g.lineWidth = 0.8;
            for (let k = 0; k < 4; k++) {
              const o = (0.15 + r() * 0.7) * bw;
              g.beginPath();
              if (vert) { g.moveTo(rx + o, ry); g.bezierCurveTo(rx + o + (r() - 0.5) * 3, ry + rh * 0.3, rx + o + (r() - 0.5) * 3, ry + rh * 0.7, rx + o, ry + rh); } else { g.moveTo(rx, ry + o); g.bezierCurveTo(rx + rw * 0.3, ry + o + (r() - 0.5) * 3, rx + rw * 0.7, ry + o + (r() - 0.5) * 3, rx + rw, ry + o); }
              g.stroke();
            }
            if (r() < 0.25) { g.fillStyle = 'rgba(40,20,8,0.5)'; g.beginPath(); g.ellipse(rx + rw * (0.3 + r() * 0.4), ry + rh * (0.3 + r() * 0.4), 2.2, 1.4, vert ? Math.PI / 2 : 0, 0, Math.PI * 2); g.fill(); }
            // inked joints and nail heads at the butt ends
            g.strokeStyle = 'rgba(30,16,6,0.85)';
            g.lineWidth = 1.4;
            g.strokeRect(rx, ry, rw, rh);
            g.fillStyle = 'rgba(30,20,14,0.8)';
            for (const e of [3, (vert ? rh : rw) - 3]) for (const q of [0.3, 0.7]) {
              const [nx, ny] = vert ? [rx + rw * q, ry + e] : [rx + e, ry + rh * q];
              g.fillRect(nx - 0.9, ny - 0.9, 1.8, 1.8);
            }
            b += L;
          }
        }
      } else if (kind === 1) {
        // flagstones in rough courses of varying height
        const tone = [[150, 140, 122], [138, 132, 120], [158, 144, 118]][Math.floor(r() * 3)];
        let y = Y0 - r() * 20;
        while (y < Y1) {
          const ch = PX * (0.32 + r() * 0.3);
          let x = X0 - r() * 30;
          while (x < X1) {
            const cw = PX * (0.35 + r() * 0.5);
            const t = 0.82 + r() * 0.3;
            const j = () => (r() - 0.5) * 3;
            g.fillStyle = `rgb(${tone[0] * t | 0},${tone[1] * t | 0},${tone[2] * t | 0})`;
            g.beginPath();
            g.moveTo(x + 2 + j(), y + 2 + j());
            g.lineTo(x + cw - 2 + j(), y + 2 + j());
            g.lineTo(x + cw - 2 + j(), y + ch - 2 + j());
            g.lineTo(x + 2 + j(), y + ch - 2 + j());
            g.closePath();
            g.fill();
            g.strokeStyle = 'rgba(34,24,14,0.9)';
            g.lineWidth = 1.6;
            g.stroke();
            // a worn hollow, a crack, lichen in the odd joint
            if (r() < 0.35) { g.fillStyle = 'rgba(255,248,230,0.12)'; g.beginPath(); g.ellipse(x + cw / 2, y + ch / 2, cw * 0.28, ch * 0.24, 0, 0, Math.PI * 2); g.fill(); }
            if (r() < 0.2) { g.strokeStyle = 'rgba(30,20,10,0.6)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x + cw * r(), y + 3); g.lineTo(x + cw * r(), y + ch * 0.5); g.lineTo(x + cw * r(), y + ch - 3); g.stroke(); }
            x += cw;
          }
          y += ch;
        }
      } else {
        // packed earth (and in the ruins, dirt and broken stone)
        const img = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0);
        const d = img.data;
        const W2 = X1 - X0;
        for (let i = 0; i < d.length; i += 4) {
          const px = X0 + (i / 4) % W2;
          const py = Y0 + Math.floor(i / 4 / W2);
          const n = fbm(px / 30, py / 30, { period: 256, octaves: 4, seed: 71 + rg.index });
          const v = 0.78 + (n - 0.5) * 0.5 + (hash2(px, py, 3) - 0.5) * 0.12;
          d[i] = 128 * v; d[i + 1] = 100 * v; d[i + 2] = 70 * v; d[i + 3] = 255;
        }
        g.putImageData(img, X0, Y0);
        // straw wisps, grit, a trodden path
        g.lineCap = 'round';
        for (let k = 0; k < (X1 - X0) * (Y1 - Y0) / 500; k++) {
          const x = X0 + r() * (X1 - X0);
          const y = Y0 + r() * (Y1 - Y0);
          if (kind === 2 && r() < 0.6) {
            const a = r() * Math.PI;
            g.strokeStyle = `rgba(${200 + r() * 30 | 0},${170 + r() * 30 | 0},90,0.7)`;
            g.lineWidth = 1;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); g.stroke();
          } else {
            g.fillStyle = `rgba(${60 + r() * 60 | 0},${50 + r() * 40 | 0},${36 + r() * 30 | 0},0.8)`;
            const s2 = kind === 3 ? 1.5 + r() * 5 : 1 + r() * 2;
            g.beginPath(); g.ellipse(x, y, s2, s2 * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2); g.fill();
            if (kind === 3) { g.strokeStyle = 'rgba(30,20,10,0.7)'; g.lineWidth = 0.8; g.stroke(); }
          }
        }
      }
      // a rug in the better rooms (boards or flags, four squares or more)
      const furnAt = (x, y) => (sheet.furniture ?? []).some((f) => f.x === x && f.y === y);
      if ((kind === 0 || kind === 1) && rg.cells.length >= 4 && r() < 0.85) {
        const has = new Set(rg.cells.map(([x, y]) => `${x},${y}`));
        // the largest 2x1 / 2x2 block of the room
        let spot = null;
        for (const [x, y] of rg.cells) {
          const two = has.has(`${x + 1},${y}`);
          const sc = (two ? 1 : 0) + r() * 0.8 - (furnAt(x, y) || (two && furnAt(x + 1, y)) ? 3 : 0);
          if (!spot || sc > spot.sc) spot = { x, y, sc, w: two ? 2 : 1, h: 1 };
        }
        const pal = [['#6a2a1c', '#b89058', '#2e2a3a'], ['#2e3a52', '#b09060', '#5a2418'], ['#5a4a2a', '#c0a070', '#4a2418']][Math.floor(r() * 3)];
        const m = PX * 0.2;
        const rx = spot.x * PX + m; const ry = spot.y * PX + m; const rw = spot.w * PX - m * 2; const rh = spot.h * PX - m * 2;
        g.fillStyle = 'rgba(20,10,4,0.35)';
        g.fillRect(rx + 3, ry + 4, rw, rh);
        g.fillStyle = pal[0];
        g.fillRect(rx, ry, rw, rh);
        g.strokeStyle = pal[1];
        g.lineWidth = 4;
        g.strokeRect(rx + 7, ry + 7, rw - 14, rh - 14);
        g.strokeStyle = pal[2];
        g.lineWidth = 2;
        g.strokeRect(rx + 13, ry + 13, rw - 26, rh - 26);
        // a central medallion and a lozenge field
        g.fillStyle = pal[1];
        g.beginPath();
        const mx = rx + rw / 2; const my = ry + rh / 2; const mr = Math.min(rw, rh) * 0.2;
        g.moveTo(mx, my - mr); g.lineTo(mx + mr * 1.3, my); g.lineTo(mx, my + mr); g.lineTo(mx - mr * 1.3, my); g.closePath(); g.fill();
        g.fillStyle = pal[2];
        g.beginPath(); g.moveTo(mx, my - mr * 0.5); g.lineTo(mx + mr * 0.65, my); g.lineTo(mx, my + mr * 0.5); g.lineTo(mx - mr * 0.65, my); g.closePath(); g.fill();
        // fringes
        g.strokeStyle = 'rgba(230,214,170,0.9)';
        g.lineWidth = 1;
        for (let fx = rx + 2; fx < rx + rw; fx += 3) for (const fy of [ry, ry + rh]) { g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + (r() - 0.5) * 2, fy + (fy === ry ? -5 : 5)); g.stroke(); }
        // worn: a pale nap streak
        g.fillStyle = 'rgba(255,240,210,0.08)';
        g.fillRect(rx + rw * 0.2, ry, rw * 0.25, rh);
        g.strokeStyle = 'rgba(20,10,4,0.8)';
        g.lineWidth = 1.2;
        g.strokeRect(rx, ry, rw, rh);
      }
      // dirt and soot gathered at the wall foot
      const has = new Set(rg.cells.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of rg.cells) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          if (has.has(`${x + dx},${y + dy}`)) continue;
          const gx = dx === 1 ? (x + 1) * PX : x * PX;
          const gy = dy === 1 ? (y + 1) * PX : y * PX;
          const gr = dx ? g.createLinearGradient(gx, 0, gx - dx * PX * 0.18, 0) : g.createLinearGradient(0, gy, 0, gy - dy * PX * 0.18);
          gr.addColorStop(0, 'rgba(30,18,8,0.55)');
          gr.addColorStop(1, 'rgba(30,18,8,0)');
          g.fillStyle = gr;
          g.fillRect(x * PX, y * PX, PX, PX);
        }
      }
      g.restore();
    }
    return c;
  }

  /**
   * Clutter at the density of the flat sheet's glyphs: barrels, crates and sacks
   * stacked against the walls, broken pots, fallen beams and heaps of rubble in the
   * ruins, a scatter of loose stones, kept off the squares the plan furnishes.
   */
  _clutter(scene, T, batch, map, sheet, walkedRoom, fh, M_) {
    const furn = new Set((sheet.furniture ?? []).map((f) => `${f.x},${f.y}`));
    const white = (geo) => { geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3)); return geo; };
    const cyl = T(white(new THREE.CylinderGeometry(1, 1, 1, 10)));
    const sph = T(white(new THREE.IcosahedronGeometry(1, 1)));
    const put = (geo, mat, x, y, z, sx, sy, sz, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    };
    for (const rg of sheet.regions?.list ?? []) {
      if (rg.type !== CELL.INTERIOR || !rg.cells.some(([x, y]) => walkedRoom.has(`${x},${y}`))) continue;
      const kind = this._floorKind(rg);
      const r = prng(rg.index * 53 + 7);
      const has = new Set(rg.cells.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of rg.cells) {
        if (furn.has(`${x},${y}`)) continue;
        // walls of this square
        const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => !has.has(`${x + dx},${y + dy}`));
        if (kind === 3) {
          // rubble heaps and fallen stones
          if (r() < 0.7) {
            const hx = x + 0.25 + r() * 0.5;
            const hz = y + 0.25 + r() * 0.5;
            const n = 5 + Math.floor(r() * 7);
            for (let k = 0; k < n; k++) {
              const a = r() * Math.PI * 2;
              const d = Math.sqrt(r()) * 0.2;
              const sz = 0.035 + r() * 0.06;
              batch(r() < 0.6 ? 'ruin' : 'stone').bevelBox(hx + Math.cos(a) * d, fh + sz * 0.4 + (d < 0.08 ? sz * 0.5 : 0), hz + Math.sin(a) * d, sz * (1 + r()), sz * 0.8, sz * (0.8 + r()), { ry: r() * 3, bevel: 0.008, tint: 0.75 + r() * 0.3, ao: 0.7 });
            }
          }
          if (r() < 0.25) batch('beam').bevelBox(x + 0.5, fh + 0.025, y + 0.5, 0.7, 0.04, 0.06, { ry: r() * Math.PI, bevel: 0.006, tint: 0.7 });
          continue;
        }
        if (!sides.length || r() > 0.6) {
          // a few loose things in the open floor
          if (r() < 0.3) put(sph, M_.plaster, x + 0.2 + r() * 0.6, fh + 0.02, y + 0.2 + r() * 0.6, 0.05, 0.035, 0.045, r() * 3);
          continue;
        }
        const [dx, dy] = sides[Math.floor(r() * sides.length)];
        // along the wall: a point inset from it
        const t = 0.2 + r() * 0.6;
        const wx = dx ? x + (dx > 0 ? 0.84 : 0.16) : x + t;
        const wz = dy ? y + (dy > 0 ? 0.84 : 0.16) : y + t;
        const pick = r();
        if (pick < 0.3) {
          for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
            const o = (k - 1) * 0.15;
            const bx = wx + (dy ? o : 0);
            const bz = wz + (dx ? o : 0);
            put(cyl, M_.door, bx, fh + 0.1, bz, 0.07, 0.2, 0.07);
            put(cyl, M_.iron, bx, fh + 0.05, bz, 0.073, 0.012, 0.073);
            put(cyl, M_.iron, bx, fh + 0.15, bz, 0.073, 0.012, 0.073);
          }
        } else if (pick < 0.55) {
          const sz = 0.13 + r() * 0.06;
          batch('door').bevelBox(wx, fh + sz / 2, wz, sz, sz, sz, { ry: (r() - 0.5) * 0.4, bevel: 0.01, ao: 0.7 });
          if (r() < 0.5) batch('door').bevelBox(wx + (r() - 0.5) * 0.04, fh + sz + sz * 0.4, wz, sz * 0.8, sz * 0.8, sz * 0.8, { ry: r() * 0.6, bevel: 0.01, ao: 0.8 });
        } else if (pick < 0.75) {
          for (let k = 0; k < 2 + Math.floor(r() * 2); k++) put(sph, M_.plaster, wx + (r() - 0.5) * 0.2, fh + 0.05, wz + (r() - 0.5) * 0.2, 0.07, 0.06, 0.08, r() * 3);
        } else if (pick < 0.9) {
          // pots and jugs
          for (let k = 0; k < 2; k++) put(cyl, M_.ruin, wx + (r() - 0.5) * 0.16, fh + 0.05, wz + (r() - 0.5) * 0.16, 0.04, 0.1, 0.04);
        } else {
          // a broken stool or plank
          batch('wood').bevelBox(wx, fh + 0.015, wz, 0.3, 0.025, 0.06, { ry: r() * 3, bevel: 0.005 });
        }
      }
    }
  }

  /**
   * Furniture in the rooms the company entered, built as little props from the
   * same placements the sheet's plan symbols use (beds, tables and stools,
   * hearths, chests, barrels, crates, shelves, altars, pews, braziers ...).
   */
  _furnish(scene, T, batch, sheet, walkedRoom, fh, M_) {
    const list = (sheet.furniture ?? []).filter((f) => walkedRoom.has(`${f.x},${f.y}`));
    if (!list.length) return;
    const ember = T(new THREE.MeshStandardMaterial({ color: 0x401808, emissive: 0xff6a20, emissiveIntensity: 2.2, roughness: 0.8 }));
    // the shared materials read vertex colours (baked AO): give the primitives a white set
    const white = (geo) => { geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3)); return geo; };
    const cyl = T(white(new THREE.CylinderGeometry(1, 1, 1, 12)));
    const sph = T(white(new THREE.SphereGeometry(1, 10, 8)));
    const ANG = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };
    const y0 = fh;
    for (const f of list) {
      const a = ANG[f.side] ?? 0;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cx = f.x + 0.5;
      const cz = f.y + 0.5;
      const inset = f.wall ? 0.08 : 0;
      // local (u across the wall, v out into the room) → world
      // a size up from the plan symbols, so each piece reads from the default camera
      const S = 1.28;
      const at = (u, v) => {
        const ly = -0.5 + inset + v * S;
        return [cx + u * S * ca - ly * sa, cz + u * S * sa + ly * ca];
      };
      const bx = (key, u, v, w, d, h, yb = 0, o = {}) => {
        const [x, z] = at(u, v);
        w *= S; d *= S; h *= S; yb *= S;
        batch(key).bevelBox(x, y0 + yb + h / 2, z, w, h, d, { ry: -a, bevel: Math.min(0.01, h * 0.3), ao: 0.8, us: 4, ...o });
      };
      const mesh = (geo, mat, u, v, sx, sy, sz, yb = 0) => {
        sx *= S; sy *= S; sz *= S; yb *= S;
        const [x, z] = at(u, v);
        const m = new THREE.Mesh(geo, mat);
        m.scale.set(sx, sy, sz);
        m.position.set(x, y0 + yb + sy / 2, z);
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
        return m;
      };
      const r = prng(f.x * 31 + f.y * 17 + 3);
      switch (f.sym) {
        case 'hearth':
          bx('stone', 0, 0.13, 0.62, 0.26, 0.2);
          bx('iron', 0, 0.1, 0.32, 0.17, 0.12, 0.0, { ao: 1 });
          mesh(sph, ember, 0, 0.14, 0.07, 0.03, 0.06, 0.0);
          break;
        case 'bed':
          bx('wood', 0, 0.33, 0.4, 0.66, 0.06);
          bx('plaster', 0, 0.35, 0.36, 0.6, 0.035, 0.06);
          bx('plaster', 0, 0.1, 0.28, 0.1, 0.03, 0.095, { tint: 1.1 });
          bx(r() < 0.5 ? 'cloth' : 'clothB', 0, 0.45, 0.38, 0.38, 0.025, 0.095);
          break;
        case 'chest':
          bx('wood', 0, 0.13, 0.34, 0.2, 0.12);
          bx('brass', 0, 0.13, 0.36, 0.035, 0.125);
          bx('brass', -0.12, 0.13, 0.03, 0.21, 0.125);
          bx('brass', 0.12, 0.13, 0.03, 0.21, 0.125);
          break;
        case 'table':
          bx('wood', 0, 0.5, 0.5, 0.34, 0.025, 0.12);
          bx('cloth', 0, 0.5, 0.16, 0.36, 0.006, 0.145);
          for (const [u, v] of [[-0.21, 0.36], [0.21, 0.36], [-0.21, 0.64], [0.21, 0.64]]) bx('wood', u, v, 0.03, 0.03, 0.12);
          for (const u of [-0.32, 0.32]) mesh(cyl, M_.wood, u, 0.5 + (r() - 0.5) * 0.1, 0.06, 0.08, 0.06);
          mesh(cyl, M_.brass, 0.1, 0.46, 0.025, 0.04, 0.025, 0.145);
          break;
        case 'barrels':
          for (let i = 0; i < 2 + Math.floor(r() * 2); i++) mesh(cyl, M_.door, -0.2 + i * 0.2, 0.12 + (i % 2) * 0.06, 0.085, 0.17, 0.085);
          break;
        case 'crates':
          for (let i = 0; i < 3; i++) bx('door', -0.18 + i * 0.18, 0.12 + (i % 2) * 0.05, 0.16, 0.16, 0.14 - (i % 2) * 0.03, 0, { ry: -a + (r() - 0.5) * 0.3 });
          bx('door', -0.09, 0.14, 0.14, 0.14, 0.12, 0.14);
          break;
        case 'sacks':
          for (let i = 0; i < 3; i++) mesh(sph, M_.plaster, -0.16 + i * 0.16, 0.12 + r() * 0.06, 0.08, 0.07, 0.09);
          break;
        case 'shelves':
          bx('wood', 0, 0.07, 0.62, 0.12, 0.32);
          for (let k = 0; k < 3; k++) {
            bx('door', 0, 0.1, 0.56, 0.06, 0.02, 0.06 + k * 0.1, { tint: 0.8 });
            for (let q = 0; q < 5; q++) bx(['cloth', 'clothB', 'brass', 'cloth', 'plaster'][(q + k) % 5], -0.22 + q * 0.1 + (r() - 0.5) * 0.02, 0.1, 0.05, 0.05, 0.06, 0.08 + k * 0.1);
          }
          break;
        case 'counter':
          bx('wood', 0, 0.2, 0.84, 0.18, 0.14);
          bx('door', 0, 0.2, 0.88, 0.22, 0.02, 0.14);
          bx('brass', 0.25, 0.2, 0.08, 0.06, 0.03, 0.16);
          break;
        case 'desk':
          bx('wood', 0, 0.16, 0.42, 0.24, 0.12);
          bx('plaster', 0, 0.16, 0.2, 0.12, 0.012, 0.12, { tint: 1.1 });
          mesh(cyl, M_.wood, 0, 0.38, 0.05, 0.07, 0.05);
          break;
        case 'altar':
          bx('stone', 0, 0.15, 0.52, 0.26, 0.17);
          bx('cloth', 0, 0.15, 0.32, 0.28, 0.012, 0.17);
          bx('brass', 0, 0.12, 0.04, 0.04, 0.1, 0.18);
          for (const u of [-0.2, 0.2]) bx('brass', u, 0.12, 0.03, 0.03, 0.08, 0.18);
          break;
        case 'pews':
          for (const v of [0.3, 0.6]) bx('wood', 0, v, 0.62, 0.1, 0.07);
          break;
        case 'brazier':
          mesh(cyl, M_.iron, 0, 0.14, 0.05, 0.12, 0.05);
          mesh(sph, ember, 0, 0.14, 0.06, 0.04, 0.06, 0.11);
          break;
        case 'rack':
          bx('beam', 0, 0.06, 0.5, 0.06, 0.04, 0.1);
          for (let k = 0; k < 4; k++) mesh(cyl, M_.iron, -0.18 + k * 0.12, 0.06, 0.008, 0.3, 0.008);
          break;
        case 'lectern':
          mesh(cyl, M_.beam, 0, 0.5, 0.025, 0.14, 0.025);
          bx('door', 0, 0.5, 0.18, 0.14, 0.02, 0.14, { ry: -a });
          break;
        case 'font':
          mesh(cyl, M_.stone, 0, 0.5, 0.13, 0.12, 0.13);
          break;
        case 'debris':
          for (let k = 0; k < 4; k++) bx('stone', (r() - 0.5) * 0.5, 0.3 + r() * 0.4, 0.06 + r() * 0.08, 0.05 + r() * 0.06, 0.03 + r() * 0.04, 0, { ry: r() * 3 });
          break;
        default:
          break;
      }
    }
  }

  /**
   * Unbleached linen (tileable): a soft, low-contrast cloth with slubbed threads
   * running both ways and a faint grey-green cast, no hard weave cells (which
   * shimmered into checks and diamonds when the camera leaned in).
   */
  _linenCanvas() {
    // a coarse, hand-loomed plain weave at miniature scale (16 threads a tile): only the
    // threads themselves tile, slubs varying thread by thread; a matching normal map
    // carries the over-under relief so the cloth catches the candle as woven stuff
    const S = 256;
    const P = 16;
    const hgt = new Float32Array(S * S);
    const alb = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const cx = Math.floor(x / P);
      const cy = Math.floor(y / P);
      const fx = (x % P) / P;
      const fy = (y % P) / P;
      const warpTop = ((cx + cy) & 1) === 0;
      // per-thread wobble: each yarn a touch thicker or thinner along its length
      const wobX = (hash2(cx, 1, 41) - 0.5) * 0.18;
      const wobY = (hash2(1, cy, 43) - 0.5) * 0.18;
      const warpProf = Math.max(0, Math.sin(Math.min(1, Math.max(0, (fx - wobX * 0.5) / (1 - Math.abs(wobX)))) * Math.PI)) ** 0.6;
      const weftProf = Math.max(0, Math.sin(Math.min(1, Math.max(0, (fy - wobY * 0.5) / (1 - Math.abs(wobY)))) * Math.PI)) ** 0.6;
      const warpDip = Math.sin(fy * Math.PI) ** 0.4;
      const weftDip = Math.sin(fx * Math.PI) ** 0.4;
      const warpH = warpProf * (warpTop ? 0.55 + 0.45 * warpDip : 0.3 * (1 - weftProf));
      const weftH = weftProf * (!warpTop ? 0.55 + 0.45 * weftDip : 0.3 * (1 - warpProf));
      const hh = Math.max(warpH, weftH);
      hgt[y * S + x] = hh;
      // slubs: whole thread runs a little paler or darker; fibre twist along each yarn
      const slub = warpH >= weftH ? hash2(cx, Math.floor(cy / 3), 3) : hash2(Math.floor(cx / 3), cy, 5);
      const twist = warpH >= weftH ? Math.sin((y / P) * Math.PI * 6 + cx * 1.7) : Math.sin((x / P) * Math.PI * 6 + cy * 1.3);
      alb[y * S + x] = (0.84 + 0.16 * hh) * (0.93 + (slub - 0.5) * 0.14 + twist * 0.025) + (hash2(x, y, 9) - 0.5) * 0.035;
    }
    const color = makeCanvas(S);
    const normal = makeCanvas(S);
    const ci = color.getContext('2d').createImageData(S, S);
    const ni = normal.getContext('2d').createImageData(S, S);
    const H = (x, y) => hgt[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = alb[y * S + x];
      ci.data[i] = Math.max(0, Math.min(255, v * 232));
      ci.data[i + 1] = Math.max(0, Math.min(255, v * 226));
      ci.data[i + 2] = Math.max(0, Math.min(255, v * 206));
      ci.data[i + 3] = 255;
      const ddx = (H(x + 1, y) - H(x - 1, y)) * 2.2;
      const ddy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
      const l = Math.hypot(ddx, ddy, 1);
      ni.data[i] = Math.round((-ddx / l * 0.5 + 0.5) * 255);
      ni.data[i + 1] = Math.round((ddy / l * 0.5 + 0.5) * 255);
      ni.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      ni.data[i + 3] = 255;
    }
    color.getContext('2d').putImageData(ci, 0, 0);
    normal.getContext('2d').putImageData(ni, 0, 0);
    return { color, normal };
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
    // ambient occlusion: a tight dark seam on both faces where every wall meets the paper
    sg.filter = `blur(${(cs * k / q * 0.04).toFixed(1)}px)`;
    sg.strokeStyle = 'rgba(24,12,4,0.7)';
    sg.lineWidth = (cs * k / q) * 0.22;
    sg.beginPath();
    for (const sgm of segs) {
      if (effective(sgm) === EDGE.OPEN) continue;
      const [ax, ay] = P(sgm.x0, sgm.y0);
      const [bx, by] = P(sgm.x1, sgm.y1);
      sg.moveTo(ax, ay);
      sg.lineTo(bx, by);
    }
    sg.stroke();
    sg.filter = `blur(${(cs * k / q * 0.09).toFixed(1)}px)`;
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
    return out;
  }

  /**
   * District names as painted ribbon banners on turned oak posts: the post stands in
   * the district's largest charted building (or its charted street), the banner faces
   * the camera at every orbit and is drawn sharp over the depth of field, and each
   * frame the boards are stepped up or down their posts so no two overlap on screen.
   */
  _signboards(scene, T, map, sheet, seenCell, party, M_) {
    this.signs = [];
    this.signScene = new THREE.Scene();
    const postGeo = T(whiteCol(new THREE.CylinderGeometry(0.022, 0.028, 1, 8)));
    postGeo.translate(0, 0.5, 0);
    const footGeo = T(whiteCol(new THREE.CylinderGeometry(0.07, 0.085, 0.04, 12)));
    const furn = new Set((sheet.furniture ?? []).map((f) => `${f.x},${f.y}`));
    const taken = [];
    for (const z of sheet.labels ?? []) {
      // the charted cells of this district: buildings first, then open ground
      let best = null;
      for (const rg of sheet.regions?.list ?? []) {
        if (rg.type !== CELL.INTERIOR) continue;
        const cells = rg.cells.filter(([x, y]) => x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h && seenCell(x, y));
        if (cells.length && (!best || cells.length > best.length)) best = cells;
      }
      if (!best) {
        const open = [];
        for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) if (seenCell(x, y) && map.getCell(x, y) !== CELL.INTERIOR) open.push([x, y]);
        if (!open.length) continue;
        best = open;
      }
      const mx = best.reduce((a, c) => a + c[0] + 0.5, 0) / best.length;
      const my = best.reduce((a, c) => a + c[1] + 0.5, 0) / best.length;
      // the post goes in the charted square nearest the middle that is free of furniture,
      // of the party's square and of another post
      let spot = null;
      for (const [x, y] of best) {
        let d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
        if (furn.has(`${x},${y}`)) d += 1.2;
        if (party && Math.abs(x - party.x) <= 1 && Math.abs(y - party.y) <= 1) d += 3;
        for (const [tx, ty] of taken) if (Math.hypot(tx - x, ty - y) < 2) d += 2;
        if (x <= 0 || y <= 0 || x >= map.w - 1 || y >= map.h - 1) d += 1.5;
        if (!spot || d < spot.d) spot = { x, y, d };
      }
      taken.push([spot.x, spot.y]);
      const px = spot.x + 0.32;
      const pz = spot.y + 0.62;
      const text = z.name.toUpperCase();
      const words = text.split(/\s+/);
      let lines = [text];
      if (text.length > 13 && words.length > 1) {
        let bs = null;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' ');
          const b = words.slice(i).join(' ');
          const d = Math.abs(a.length - b.length);
          if (!bs || d < bs.d) bs = { d, l: [a, b] };
        }
        lines = bs.l;
      }
      const fs = 46;
      const mc = makeCanvas(8).getContext('2d');
      mc.font = `bold ${fs}px ${SERIF}`;
      mc.letterSpacing = `${(fs * 0.14).toFixed(1)}px`;
      const tw = Math.max(...lines.map((l) => mc.measureText(l).width));
      const bw = tw + fs * 1.6;
      const bh = fs * (0.35 + 1.2 * lines.length);
      const tail = fs * 1.15;
      const cw = Math.ceil(bw + tail * 2 + fs * 0.6);
      const chh = Math.ceil(bh + fs * 0.9);
      const c = makeCanvas(cw, chh);
      const g = c.getContext('2d');
      this._banner(g, cw / 2, chh / 2 - fs * 0.08, bw, bh, fs, lines);
      const tex = T(new THREE.CanvasTexture(c));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.ctx.render?.maxAnisotropy ?? 4);
      const spr = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: true })));
      spr.center.set(0.5, 0.08);
      const unit = 0.3 / fs; // world units per canvas px: caps ~0.3 of a square
      spr.userData.base = [cw * unit, chh * unit];
      this.signScene.add(spr);
      const post = new THREE.Mesh(postGeo, M_.beam);
      post.position.set(px, 0, pz);
      post.castShadow = true;
      const foot = new THREE.Mesh(footGeo, M_.stone);
      foot.position.set(px, 0.02, pz);
      foot.castShadow = foot.receiveShadow = true;
      scene.add(post, foot);
      this.signs.push({ spr, post, x: px, z: pz, h: 1.1 });
    }
    // the ways out: vermilion signboards just inside each, naming the next block
    for (const e of sheet.exitLabels ?? []) {
      const fs = 46;
      const k2 = fs / e.fs;
      const cw = Math.ceil((e.bw + e.bh * 0.4) * k2);
      const chh = Math.ceil(e.bh * k2 * 1.3);
      const c = makeCanvas(cw, chh);
      exitBanner(c.getContext('2d'), e.text, cw / 2, chh / 2, e.bw * k2, e.bh * k2, fs);
      const tex = T(new THREE.CanvasTexture(c));
      tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true })));
      spr.center.set(0.5, 0.08);
      const unit = 0.22 / fs;
      spr.userData.base = [cw * unit, chh * unit];
      this.signScene.add(spr);
      const [ix, iz] = { N: [0, 0.35], S: [0, -0.35], E: [-0.35, 0], W: [0.35, 0] }[e.facing] ?? [0, 0];
      const px = e.x + 0.5 + ix;
      const pz = e.y + 0.5 + iz;
      const post = new THREE.Mesh(postGeo, M_.beam);
      post.position.set(px, 0, pz);
      post.castShadow = true;
      const foot = new THREE.Mesh(footGeo, M_.stone);
      foot.position.set(px, 0.02, pz);
      scene.add(post, foot);
      this.signs.push({ spr, post, x: px, z: pz, h: 0.8, low: true });
    }
    this._layoutSigns();
  }

  /** Step each signboard up or down its post so none overlaps another, or the party, on screen. */
  _layoutSigns() {
    if (!this.signs?.length || !this.w) return;
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    const k = Math.max(0.5, Math.min(1.15, (this.cur?.dist ?? this.dist ?? 1) / (this.fitDist || 1)));
    const v = new THREE.Vector3();
    const scr = (x, y, z) => { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * this.w, (1 - v.y) / 2 * this.h, v.z]; };
    const placed = [];
    if (this.party) {
      const [ax, ay] = scr(this.party.x + 0.5, 0, this.party.y + 0.5);
      const [, by] = scr(this.party.x + 0.5, 1.5, this.party.y + 0.5);
      const hw = Math.abs(ay - by) * 0.35;
      placed.push([ax - hw, by, hw * 2, ay - by]);
    }
    const ov = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    // nearest the camera first: those boards keep the lowest, steadiest posts
    const order = [...this.signs].sort((a, b) => b.z - a.z);
    for (const s of order) {
      const [bw, bh] = s.spr.userData.base;
      const sw = bw * k;
      const sh = bh * k;
      s.spr.scale.set(sw, sh, 1);
      let pick = null;
      for (const h of [0.95, 1.35, 1.75, 0.6, 2.15, 2.6]) {
        const [x0, y0] = scr(s.x, h, s.z);
        const [, y1] = scr(s.x, h + sh, s.z);
        const ph = Math.abs(y0 - y1);
        const pw = ph * (sw / sh);
        const r = [x0 - pw / 2, y1 - ph * 0.02, pw, ph * 0.94];
        let score = Math.abs(h - 0.95) * 0.4;
        for (const o of placed) score += ov(r, o) / (r[2] * r[3]) * 10;
        if (r[1] < 0) score += 5;
        if (!pick || score < pick.score) pick = { h, r, score };
      }
      placed.push(pick.r);
      s.h = pick.h;
      s.spr.position.set(s.x, pick.h, s.z);
      s.post.scale.set(1, pick.h + sh * 0.1, 1);
    }
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
    g.fillStyle = '#8a2a1c';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(255,200,150,0.12)';
    for (let i = 0; i < 40; i++) g.fillRect(0, i * 4, 256, 1);
    g.strokeStyle = '#e8c46a';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 244, 148);
    // a gilt chevron (the Company's device)
    g.fillStyle = '#d4b066';
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
    candle.position.set(-1.6, 0, -3.4);
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
    halo.position.set(-1.6, 2.95, -3.4);
    scene.add(halo);
    const candleLight = new THREE.PointLight(0xff9448, 14, 40, 1.35);
    candleLight.position.set(-1.4, 3.4, -3.0);
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
    ink.position.set(4.2, 0, -3.1);
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
    quill.position.set(4.2, 0.62, -3.1);
    quill.rotation.set(-0.5, 0.2, 0.32);
    quill.scale.setScalar(0.66);
    scene.add(quill);

    // a surveyor's brass dividers lying open on the desk below the sheet, a steel point
    // on each leg, the hinge a riveted disc
    {
      const div = new THREE.Group();
      const steelM = T(new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 1, envMapIntensity: 1.2 }));
      const legGeo = T(new THREE.BoxGeometry(0.16, 0.07, 3.0));
      legGeo.translate(0, 0, 1.5);
      const tipGeo = T(new THREE.ConeGeometry(0.05, 0.5, 8));
      tipGeo.rotateX(Math.PI / 2);
      tipGeo.translate(0, 0, 3.24);
      for (const sgn of [-1, 1]) {
        const leg = new THREE.Group();
        const L = new THREE.Mesh(legGeo, brass);
        const P = new THREE.Mesh(tipGeo, steelM);
        L.castShadow = P.castShadow = true;
        leg.add(L, P);
        leg.rotation.y = sgn * 0.26;
        div.add(leg);
      }
      const hinge = new THREE.Mesh(T(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 24)), brass);
      hinge.castShadow = true;
      const rivet = new THREE.Mesh(T(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12)), steelM);
      div.add(hinge, rivet);
      div.position.set(2.2, 0.06, 18.6);
      div.rotation.y = 2.1;
      scene.add(div);
    }
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
  /**
   * Render through a macro lens: the board is drawn into an offscreen target with
   * depth, then composited with a depth-of-field blur (a Vogel-disc gather whose
   * radius grows with distance from the focal plane through the board's centre),
   * so the desk and its props fall softly out of focus in front and behind.
   * The composite goes through the shared post chain (tone map, grade, AA).
   * @param {import('../../render/RenderContext.js').RenderContext} rc
   */
  renderDof(rc) {
    const r = rc.renderer;
    const pr = r.getPixelRatio();
    const w = Math.max(2, Math.floor(rc.width * pr));
    const h = Math.max(2, Math.floor(rc.height * pr));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
    }
    if (!this.dof) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2() },
          uNear: { value: 0.1 }, uFar: { value: 300 }, uFocus: { value: 30 }, uBand: { value: 4 }, uMax: { value: 6 },
          tSigns: { value: null }, uSigns: { value: 0 },
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes;
          uniform sampler2D tSigns; uniform float uSigns;
          uniform float uNear, uFar, uFocus, uBand, uMax; varying vec2 vUv;
          vec3 signs(vec3 c){ if (uSigns < 0.5) return c; vec4 s = texture2D(tSigns, vUv); return c * (1.0 - s.a) + s.rgb; }
          float viewZ(vec2 uv){ float d = texture2D(tDepth, uv).x; return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
          float coc(vec2 uv){ float z = -viewZ(uv); return clamp((abs(z - uFocus) - uBand) / uFocus * 4.0, 0.0, 1.0) * uMax; }
          void main(){
            float c0 = coc(vUv);
            vec4 base = texture2D(tColor, vUv);
            if (c0 < 0.35) { gl_FragColor = vec4(signs(base.rgb), 1.0); return; }
            vec3 acc = base.rgb; float wsum = 1.0;
            for (int i = 0; i < 20; i++) {
              float fi = float(i) + 0.5;
              float rr = sqrt(fi / 20.0) * c0;
              float a = fi * 2.39996;
              vec2 o = vec2(cos(a), sin(a)) * rr / uRes;
              float cs = coc(vUv + o);
              // a sharp sample never bleeds onto a blurred neighbour behind it
              float wgt = smoothstep(0.0, 1.0, cs / max(0.001, rr) );
              acc += texture2D(tColor, vUv + o).rgb * wgt; wsum += wgt;
            }
            gl_FragColor = vec4(signs(acc / wsum), 1.0);
          }`,
        depthTest: false, depthWrite: false,
      });
      this.dof = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      this.dof.frustumCulled = false;
      this.dofScene = new THREE.Scene();
      this.dofScene.add(this.dof);
      this.dofCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.camera);
    // the signboards: their own transparent layer, kept sharp over the blur
    const hasSigns = !!this.signScene?.children.length;
    if (hasSigns) {
      if (!this.rtS || this.rtS.width !== w || this.rtS.height !== h) {
        this.rtS?.dispose();
        this.rtS = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      }
      const cc = r.getClearColor(new THREE.Color());
      const ca = r.getClearAlpha();
      r.setRenderTarget(this.rtS);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.signScene, this.camera);
      r.setClearColor(cc, ca);
    }
    r.setRenderTarget(null);
    const u = this.dof.material.uniforms;
    u.tColor.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.uRes.value.set(w, h);
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    // focus on the board's middle (or on the party when leaning in)
    const f = this.camera.position.distanceTo(this.cur?.target ?? this.target);
    u.uFocus.value = f;
    u.uBand.value = f * 0.2;
    u.uMax.value = 5.5 * pr;
    u.tSigns.value = hasSigns ? this.rtS.texture : null;
    u.uSigns.value = hasSigns ? 1 : 0;
    rc.render(this.dofScene, this.dofCam, { lines: { scene: this.scene, camera: this.camera } });
  }

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

  /** Projected screen bbox of a set of points for a camera at the given orbit. */
  _projectBox(az, el, dist, target, pts = this.bounds) {
    const cam = this.camera;
    cam.position.set(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const b of pts) {
      v.copy(b).project(cam);
      const sx = (v.x + 1) / 2 * this.w;
      const sy = (1 - v.y) / 2 * this.h;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  }

  /** Distance and target at which `pts` fit the rect r (shrunk by `fill`). */
  _fitPoints(pts, fill, start) {
    const r0 = this.rect;
    const r = { x: r0.x + r0.w * (1 - fill) / 2, y: r0.y + r0.h * (1 - fill) / 2, w: r0.w * fill, h: r0.h * fill };
    const target = start.clone();
    let dist = 30;
    for (let it = 0; it < 4; it++) {
      let lo = 2;
      let hi = 160;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        const b = this._projectBox(this.az, this.el, mid, target, pts);
        const fits = b.minX >= r.x && b.maxX <= r.x + r.w && b.minY >= r.y && b.maxY <= r.y + r.h;
        if (fits) hi = mid; else lo = mid;
      }
      dist = hi;
      const b = this._projectBox(this.az, this.el, dist, target, pts);
      const dx = (b.minX + b.maxX) / 2 - (r.x + r.w / 2);
      const dy = (b.minY + b.maxY) / 2 - (r.y + r.h / 2);
      const upp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.h;
      const right = new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az));
      const fwd = new THREE.Vector3(-Math.sin(this.az), 0, -Math.cos(this.az));
      target.addScaledVector(right, dx * upp);
      target.addScaledVector(fwd, (-dy * upp) / Math.max(0.3, Math.sin(this.el)));
    }
    return { dist, target };
  }

  /** Frame the explored footprint at ~70% of the view; the whole sheet sets the dolly's far limit. */
  _refit(snap) {
    if (!this.w || !this.bounds) return;
    const whole = this._fitPoints(this.bounds, 0.97, this.target);
    this.sheetDist = whole.dist;
    // the opening view shows the whole sheet inside the frame (never sliding under the
    // side panel, the key either whole or not at all); leaning in closes on the party
    // the opening view frames what has been explored (the board filling the frame);
    // the whole sheet stays the dolly's far limit
    // (the board with its cartouche, compass and key, all clear of the side panel)
    const foc = this.focusBounds ? this._fitPoints(this.focusBounds, 0.94, this.target) : whole;
    this.fitDist = foc.dist;
    this._fitted = true;
    this.fitTarget = foc.target;
    this.target.copy(foc.target);
    // leaning in (zoom > 1) drifts the view toward the party
    if (this.party && this.zoomLevel > 1) {
      const k = Math.min(1, (this.zoomLevel - 1) / 1.2);
      this.target.lerp(new THREE.Vector3(this.party.x + 0.5, 0, this.party.y + 0.5), k);
    }
    // zoom < 1 backs off toward the whole sheet
    if (this.zoomLevel < 1) this.target.lerp(whole.target, Math.min(1, (1 - this.zoomLevel) / 0.4));
    this.dist = this.fitDist / this.zoomLevel;
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
    this.dist = Math.max(this.fitDist * 0.3, Math.min(Math.max(this.fitDist, this.sheetDist ?? this.fitDist) * 1.1, this.dist * f));
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
    this._layoutSigns();
    if (this.marker) this.marker.flag.rotation.y = Math.sin(t * 1.7) * 0.12;
    for (const v of this.veils ?? []) v.tex.offset.set(t * v.speed + v.phase, t * v.speed * 0.6);
    if (this.partyGlow) this.partyGlow.material.opacity = 0.24 + 0.06 * Math.sin(t * 2.6);
    if (this.candleLight) {
      const f = 0.86 + 0.1 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * (hash2(Math.floor(t * 18), 3, 1) - 0.5);
      this.candleLight.intensity = 14 * f;
      this.flame.scale.set(1, 2.6 * (0.92 + f * 0.1), 1);
    }
  }
}
