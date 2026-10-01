import * as THREE from 'three';
import { EDGE, CELL } from '../../data/maps/MapGrid.js';
import { SHEET, collectEdges, mergeRuns } from './BlockSheet.js';
import { makeCanvas, makeDesk, grainTile, prng } from './ink.js';
import { PIN_KINDS, drawPin } from './glyphs.js';
import { SERIF, wrapText } from './ornaments.js';
import { hash2 } from '../../render/textures/noise.js';
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
  box(cx, cy, cz, sx, sy, sz, { ry = 0, us = 1.6, uo = 0, vo = 0, uv = 'world', ao = 0.45, aoH = 0.09, tint = 1, top = true } = {}) {
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
          if (uv === 'local') {
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
        const u = uv === 'local' ? (lx + hx) / sx : P[0] * us + uo;
        const v = uv === 'local' ? (lz + hz) / sz : P[2] * us + vo;
        return this._v(P[0], P[1], P[2], 0, 1, 0, u, v, tint);
      });
      this.quad(q[3], q[2], q[1], q[0]);
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
    const deskCanvas = makeDesk(1024, 1024, { lit: false, seed: 9, tone: [124, 80, 44] });
    const deskTex = T(new THREE.CanvasTexture(deskCanvas));
    deskTex.colorSpace = THREE.SRGBColorSpace;
    deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping;
    deskTex.repeat.set(2.2, 2.2);
    deskTex.anisotropy = maxAniso;
    const deskBump = T(new THREE.CanvasTexture(deskCanvas));
    deskBump.wrapS = deskBump.wrapT = THREE.RepeatWrapping;
    deskBump.repeat.copy(deskTex.repeat);
    const desk = new THREE.Mesh(T(new THREE.PlaneGeometry(150, 150)), T(new THREE.MeshStandardMaterial({ map: deskTex, bumpMap: deskBump, bumpScale: 1.2, roughness: 0.38, metalness: 0, envMapIntensity: 0.6 })));
    desk.rotation.x = -Math.PI / 2;
    desk.position.set(10, -0.03, 8);
    desk.receiveShadow = true;
    scene.add(desk);

    // ---------- the parchment sheet, corners curling ----------
    const tex = T(new THREE.CanvasTexture(sheet.canvas));
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
      const fold = Math.exp(-(((u - 0.5) * 60) ** 2)) * 0.06 + Math.exp(-(((v - 0.5) * 60) ** 2)) * 0.05;
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
      door: pbr('hd_door', { color: 0xffe0c0 }, 2.4),
      locked: pbr('hd_door', { color: 0xe07860 }, 2.4),
      iron: pbr('hd_iron', { metalness: 0.75, roughness: 0.55, envMapIntensity: 0.9 }),
      secret: pbr('hd_ashlar', { color: 0xf0b898 }, 1.7),
      gold: T(new THREE.MeshStandardMaterial({ color: 0xd8b25a, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 })),
    };
    const B = {};
    const batch = (k) => (B[k] ??= new Batch());

    // ---------- walls ----------
    const isBorder = (q) => !dungeon && !wild && ((q.horiz && ((q.cell[1] === 0 && q.cell[2] === 'N') || (q.cell[1] === map.h - 1 && q.cell[2] === 'S'))) || (!q.horiz && ((q.cell[0] === 0 && q.cell[2] === 'W') || (q.cell[0] === map.w - 1 && q.cell[2] === 'E'))));
    const ruin = (q) => q.style === 2 && !dungeon;
    const wallH = dungeon ? 0.62 : 0.5;
    const { segs, effective } = collectEdges(map, info, seenCell, secrets);
    const rr = prng(31);
    const span = (x0, z0, x1, z1, th) => {
      const horiz = Math.abs(z1 - z0) < 1e-6;
      return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, sx: horiz ? Math.abs(x1 - x0) : th, sz: horiz ? th : Math.abs(z1 - z0), horiz, len: Math.hypot(x1 - x0, z1 - z0) };
    };
    /** A stone wall run with a slightly chipped, uneven top. */
    const stoneRun = (x0, z0, x1, z1, { h = wallH, th = 0.12, key = 'stone', ext = th / 2 } = {}) => {
      const s = span(x0, z0, x1, z1, th);
      const L = s.len + ext * 2;
      const n = Math.max(1, Math.round(L / 0.28));
      const b = batch(key);
      for (let i = 0; i < n; i++) {
        const a = -L / 2 + (i / n) * L;
        const len = L / n;
        const chip = rr() < 0.16;
        const hh = h + (rr() - 0.5) * 0.028 - (chip ? 0.035 + rr() * 0.03 : 0);
        const c = a + len / 2;
        b.box(s.cx + (s.horiz ? c : 0), hh / 2, s.cz + (s.horiz ? 0 : c), s.horiz ? len : th, hh, s.horiz ? th : len, { tint: 0.9 + rr() * 0.12 });
      }
    };
    /** Timber & plaster: limewashed infill between dark oak posts, sill and wall-plate. */
    const timberRun = (x0, z0, x1, z1) => {
      const th = 0.1;
      const h = wallH * 0.92;
      const s = span(x0, z0, x1, z1, th);
      const L = s.len + th;
      const P = batch('plaster');
      P.box(s.cx, h / 2, s.cz, s.horiz ? L : th, h, s.horiz ? th : L);
      const bm = batch('beam');
      const bt = th + 0.018;
      const at = (c, y, len, hh) => bm.box(s.cx + (s.horiz ? c : 0), y, s.cz + (s.horiz ? 0 : c), s.horiz ? len : bt, hh, s.horiz ? bt : len, { ao: 0.7, us: 3 });
      at(0, 0.03, L, 0.06);
      at(0, h - 0.022, L + 0.01, 0.045);
      at(0, h * 0.55, L, 0.03);
      const posts = Math.max(1, Math.round(L / 0.48));
      for (let i = 0; i <= posts; i++) at(-L / 2 + 0.03 + (i / posts) * (L - 0.06), h / 2, 0.055, h);
    };
    /** The city wall: taller, thicker, battered at the foot and crenellated on its outer face. */
    const cityRun = (x0, z0, x1, z1, q) => {
      const th = 0.2;
      const h = 0.74;
      const s = span(x0, z0, x1, z1, th);
      stoneRun(x0, z0, x1, z1, { h, th, key: 'city', ext: th / 2 });
      const b = batch('city');
      const L = s.len + th;
      b.box(s.cx, 0.04, s.cz, s.horiz ? L : th + 0.07, 0.08, s.horiz ? th + 0.07 : L, { ao: 0.5 });
      const out = q.horiz ? (q.cell[2] === 'N' ? -1 : 1) : (q.cell[2] === 'W' ? -1 : 1);
      const mDepth = th * 0.42;
      const off = (th - mDepth) / 2 * out;
      const n = Math.max(1, Math.floor(L / 0.22));
      for (let i = 0; i < n; i++) {
        const c = -L / 2 + (i + 0.5) * (L / n);
        const mh = 0.1 + (rr() - 0.5) * 0.02;
        b.box(s.cx + (s.horiz ? c : off), h + mh / 2 - 0.005, s.cz + (s.horiz ? off : c), s.horiz ? 0.11 : mDepth, mh, s.horiz ? mDepth : 0.11, { ao: 0.85 });
      }
    };
    // merge runs per kind so each reads as one piece of masonry
    const plain = segs.filter((q) => effective(q) === EDGE.WALL && !ruin(q));
    for (const r of mergeRuns(plain.filter((q) => isBorder(q)))) cityRun(r.x0, r.y0, r.x1, r.y1, r);
    for (const r of mergeRuns(plain.filter((q) => !isBorder(q) && q.style === 1 && !dungeon))) timberRun(r.x0, r.y0, r.x1, r.y1);
    for (const r of mergeRuns(plain.filter((q) => !isBorder(q) && (q.style !== 1 || dungeon)))) stoneRun(r.x0, r.y0, r.x1, r.y1);
    const rubble = (px, pz, n, spread) => {
      const b = batch('ruin');
      for (let i = 0; i < n; i++) {
        const s = 0.025 + rr() ** 2 * 0.07;
        b.box(px + (rr() - 0.5) * spread, s * 0.4, pz + (rr() - 0.5) * spread, s * (1 + rr()), s * 0.9, s * (0.8 + rr() * 0.8), { ry: rr() * 3, ao: 0.6, us: 4 });
      }
    };
    const doorRings = [];
    for (const q of segs) {
      const t = effective(q);
      const lerp = (a) => [q.x0 + (q.x1 - q.x0) * a, q.y0 + (q.y1 - q.y0) * a];
      const wallKey = q.style === 1 && !dungeon ? 'plaster' : ruin(q) ? 'ruin' : 'stone';
      if (t === EDGE.WALL && ruin(q)) {
        // broken stubs with stepped, jagged tops and fallen masonry at their feet
        const n = 2 + Math.floor(rr() * 3);
        for (let i = 0; i < n; i++) {
          const a = i / n + rr() * 0.05;
          const b2 = (i + 1) / n - rr() * 0.12;
          if (b2 - a < 0.06) continue;
          const [ax, az] = lerp(a);
          const [bx, bz] = lerp(b2);
          let h = wallH * (0.18 + rr() * 0.5);
          let s0 = 0;
          let s1 = 1;
          for (let k = 0; k < 3 && h > 0.04; k++) {
            const [cx0, cz0] = [ax + (bx - ax) * s0, az + (bz - az) * s0];
            const [cx1, cz1] = [ax + (bx - ax) * s1, az + (bz - az) * s1];
            const sp = span(cx0, cz0, cx1, cz1, 0.11);
            batch('ruin').box(sp.cx, h / 2, sp.cz, Math.max(0.02, sp.sx), h, Math.max(0.02, sp.sz), { tint: 0.85 + rr() * 0.15 });
            const cut = rr() < 0.5;
            s0 = cut ? s0 + (s1 - s0) * (0.25 + rr() * 0.3) : s0;
            s1 = cut ? s1 : s1 - (s1 - s0) * (0.25 + rr() * 0.3);
            h *= 1.25 + rr() * 0.35;
            if (h > wallH * 0.85) break;
          }
        }
        const [mx, mz] = lerp(0.5);
        rubble(mx, mz, 9, 0.7);
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
        if (wallKey === 'plaster') timberRun(ax, az, bx, bz);
        else stoneRun(ax, az, bx, bz, { key: wallKey === 'ruin' ? 'ruin' : 'stone', ext: 0.06 });
      };
      piece(0, 0.5 - gap);
      piece(0.5 + gap, 1);
      const [mx, mz] = lerp(0.5);
      if (t === EDGE.ARCH) {
        const st = batch('stone');
        for (const sg of [-1, 1]) {
          const [px, pz] = lerp(0.5 + sg * gap);
          st.box(px, wallH * 0.62, pz, 0.15, wallH * 1.24, 0.15);
        }
        st.box(mx, wallH * 1.2, mz, q.horiz ? gap * 2 + 0.2 : 0.17, 0.1, q.horiz ? 0.17 : gap * 2 + 0.2, { ao: 1 });
        st.box(mx, wallH * 1.29, mz, q.horiz ? 0.08 : 0.12, 0.08, q.horiz ? 0.12 : 0.08, { ao: 1 });
      } else {
        // plank leaf with two iron straps and a ring; doors stand ajar, locked doors are shut
        const open = t === EDGE.DOOR ? 0.65 : 0;
        const [hx, hz] = lerp(0.5 - gap);
        const L = gap * 2;
        const ang = (q.horiz ? 0 : -Math.PI / 2) + open;
        const dh = wallH * 0.8;
        const cx = hx + Math.cos(ang) * L / 2;
        const cz = hz - Math.sin(ang) * L / 2;
        batch(t === EDGE.LOCKED ? 'locked' : 'door').box(cx, dh / 2, cz, L, dh, 0.045, { ry: ang, uv: 'local', ao: 0.7 });
        for (const yy of [0.22, 0.74]) batch('iron').box(cx, dh * yy, cz, L * 0.92, 0.028, 0.06, { ry: ang, ao: 1, us: 6 });
        doorRings.push({ x: cx + Math.sin(ang) * 0.035, z: cz + Math.cos(ang) * 0.035, y: dh * 0.48, ry: ang });
        if (t === EDGE.LOCKED) batch('gold').box(mx, dh * 0.45, mz, 0.08, 0.1, 0.08, { ao: 1 });
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
    for (const [k, b] of Object.entries(B)) {
      const m = b.mesh(M_[k]);
      if (!m) continue;
      this.own.push(m.geometry);
      scene.add(m);
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

    // ---------- name scrolls floating above the zones ----------
    for (const z of sheet.labels ?? []) {
      const sp = this._labelSprite(z.name);
      const cx = z.x + z.w / 2;
      const cz = z.y + z.h / 2;
      let lz = cz + Math.min(1.2, z.h * 0.3);
      // never float a name over the party's token
      if (party && Math.abs(party.x + 0.5 - cx) < 1.8 && Math.abs(party.y + 0.5 - lz) < 1.3) lz = party.y + 0.5 + (party.y > 2 ? -1.5 : 1.5);
      sp.position.set(cx, z.h <= 1 ? 0.95 : 1.1, lz);
      scene.add(sp);
    }

    // ---------- party token: painted arrow on a brass base, with a pennant ----------
    this.marker = null;
    if (party) {
      const grp = new THREE.Group();
      const base = new THREE.Mesh(T(new THREE.CylinderGeometry(0.34, 0.37, 0.06, 40)), M_.gold);
      base.position.y = 0.03;
      base.castShadow = base.receiveShadow = true;
      const disc = new THREE.Mesh(T(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 40)), T(new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.8 })));
      disc.position.y = 0.066;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.3);
      shape.quadraticCurveTo(0.07, 0.08, 0.2, -0.2);
      shape.quadraticCurveTo(0.1, -0.13, 0, -0.1);
      shape.quadraticCurveTo(-0.1, -0.13, -0.2, -0.2);
      shape.quadraticCurveTo(-0.07, 0.08, 0, 0.3);
      const ag = T(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 }));
      ag.rotateX(-Math.PI / 2);
      const enamel = T(new THREE.MeshPhysicalMaterial({ color: 0xa82a18, roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.8 }));
      const arrow = new THREE.Mesh(ag, enamel);
      arrow.position.y = 0.085;
      arrow.castShadow = true;
      // a gilt rim under the enamel, like a brass compass pointer
      const rimGeo = T(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.03, bevelSegments: 2, curveSegments: 8 }));
      rimGeo.rotateX(-Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, M_.gold);
      rim.position.y = 0.068;
      rim.castShadow = true;
      const head = new THREE.Group();
      head.add(rim, arrow);
      head.rotation.y = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[party.dir] ?? 0;
      const pole = new THREE.Mesh(T(new THREE.CylinderGeometry(0.012, 0.014, 1.1, 8)), M_.beam);
      pole.position.set(-0.2, 0.6, 0.18);
      pole.castShadow = true;
      const finial = new THREE.Mesh(T(new THREE.SphereGeometry(0.03, 12, 8)), M_.gold);
      finial.position.set(-0.2, 1.16, 0.18);
      const flagGeo = T(new THREE.PlaneGeometry(0.42, 0.26, 12, 2));
      const fp = flagGeo.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const u = fp.getX(i) / 0.42 + 0.5;
        fp.setZ(i, Math.sin(u * Math.PI * 1.6) * 0.035 * u);
        if (u > 0.85) fp.setY(i, fp.getY(i) * (1 - (u - 0.85) * 1.6));
      }
      flagGeo.computeVertexNormals();
      const flag = new THREE.Mesh(flagGeo, T(new THREE.MeshStandardMaterial({ map: this._pennantTexture(T), side: THREE.DoubleSide, roughness: 0.75 })));
      flag.position.set(0.01, 1.0, 0.18);
      flag.castShadow = true;
      grp.add(base, disc, head, pole, finial, flag);
      grp.position.set(party.x + 0.5, 0, party.y + 0.5);
      grp.scale.setScalar(1.75);
      scene.add(grp);
      this.marker = { grp, flag, flagGeo };
    }

    // ---------- note pins with their seals as flags ----------
    const needleMat = T(new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 1 }));
    const needleGeo = T(new THREE.CylinderGeometry(0.014, 0.004, 0.6, 6));
    const headGeo = T(new THREE.SphereGeometry(0.15, 20, 14));
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
      head.position.set(px - 0.03, 0.6, pz);
      head.castShadow = true;
      const seal = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: this._pinTexture(n.kind, T), depthWrite: false, sizeAttenuation: false })));
      seal.scale.set(0.055, 0.055, 1);
      seal.position.set(px - 0.03, 1.15, pz);
      scene.add(needle, head, seal);
    }

    // ---------- props: candle, inkwell & quill (kept inside the framing) ----------
    this._props(scene, T, M_);
    this.bounds.push(new THREE.Vector3(-4.5, 0, 1.6), new THREE.Vector3(-3.3, 3.3, 1.6), new THREE.Vector3(-3.9, 0, 15.4), new THREE.Vector3(-3.6, 3.2, 12.4));

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0x8a98b8, 0x4a2c14, 0.4));
    const key = new THREE.DirectionalLight(0xffcf98, 2.2);
    key.position.set(-14, 22, 14);
    key.target.position.set(9, 0, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 80;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    scene.add(key, key.target);
    const moon = new THREE.DirectionalLight(0x9aaed8, 0.65);
    moon.position.set(26, 16, -14);
    moon.target.position.set(8, 0, 8);
    scene.add(moon, moon.target);
    const bounce = new THREE.PointLight(0xffa860, 4, 40, 1.2);
    bounce.position.set(8, 6, 26);
    scene.add(bounce);

    // ---------- camera: fit the whole sheet inside the view rect ----------
    this.zoomLevel = Math.max(0.5, zoom);
    this.target.set(px0 + pw / 2, 0, pz0 + ph / 2);
    this._fitted = false;
    this._refit(true);
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

  /** A little parchment scroll carrying a zone name, as a billboard that always reads. */
  _labelSprite(text) {
    const T = this._track.bind(this);
    const fs = 44;
    const probe = makeCanvas(8).getContext('2d');
    probe.font = `italic ${fs}px ${SERIF}`;
    const lines = wrapText(probe, text, 420);
    const tw = Math.max(...lines.map((l) => probe.measureText(l).width));
    const w = Math.ceil(tw + 110);
    const h = Math.ceil(lines.length * fs * 1.1 + 34);
    const c = makeCanvas(w, h + 10);
    const g = c.getContext('2d');
    // ribbon with forked tails
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 4;
    g.fillStyle = '#b89a68';
    for (const s of [-1, 1]) {
      const x = s < 0 ? 4 : w - 4;
      g.beginPath();
      g.moveTo(w / 2 + s * (w / 2 - 40), 14);
      g.lineTo(x, 14);
      g.lineTo(x - s * 20, h / 2 + 2);
      g.lineTo(x, h - 6);
      g.lineTo(w / 2 + s * (w / 2 - 40), h - 6);
      g.closePath();
      g.fill();
    }
    const body = g.createLinearGradient(0, 4, 0, h);
    body.addColorStop(0, '#f6ead0');
    body.addColorStop(1, '#e2cc9e');
    g.fillStyle = body;
    g.fillRect(26, 4, w - 52, h - 14);
    g.restore();
    g.strokeStyle = 'rgba(43,26,13,0.85)';
    g.lineWidth = 2;
    g.strokeRect(26, 4, w - 52, h - 14);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic ${fs}px ${SERIF}`;
    g.fillStyle = '#2b1a0d';
    lines.forEach((l, i) => g.fillText(l, w / 2, 4 + (h - 14) / 2 + (i - (lines.length - 1) / 2) * fs * 1.1));
    const t = T(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const sp = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false })));
    const sh = 0.017 * (h + 10) / 70;
    sp.scale.set(sh * (w / (h + 10)), sh, 1);
    sp.renderOrder = 10;
    return sp;
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
    quill.rotation.set(-0.62, 0.2, 0.18);
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
    this.az -= dx * 0.006;
    this.el = Math.max(0.32, Math.min(1.45, this.el + dy * 0.004));
  }

  /** Pan in the ground plane relative to the view (units). */
  panBy(dx, dz) {
    const s = Math.sin(this.az);
    const c = Math.cos(this.az);
    this.target.x = Math.max(-3, Math.min(this.map.w + 8, this.target.x + dx * c + dz * s));
    this.target.z = Math.max(-3, Math.min(this.map.h + 3, this.target.z - dx * s + dz * c));
  }

  dolly(f) {
    this.dist = Math.max(this.fitDist * 0.18, Math.min(this.fitDist * 1.5, this.dist * f));
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
    if (this.candleLight) {
      const f = 0.86 + 0.1 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * (hash2(Math.floor(t * 18), 3, 1) - 0.5);
      this.candleLight.intensity = 14 * f;
      this.flame.scale.set(1, 2.6 * (0.92 + f * 0.1), 1);
    }
  }
}
