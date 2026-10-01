import * as THREE from 'three';
import { EDGE, CELL } from '../../data/maps/MapGrid.js';
import { SHEET, collectEdges, mergeRuns } from './BlockSheet.js';
import { makeCanvas, makeDesk, grainTile, hatchRect, prng } from './ink.js';
import { PIN_KINDS } from './glyphs.js';
import { hash2 } from '../../render/textures/noise.js';

/**
 * Tabletop diorama of the explored block: the parchment survey laid on the
 * cartographer's desk (corners gently curling) with every explored wall raised
 * as a miniature, doors and arches modelled, bedrock as hatched blocks, a gilt
 * party marker hovering over its square and wax-headed pins for notes.
 * Lit by a candle (warm key + flicker) and a cool window fill.
 * World units: one cell = 1; x east, z south.
 */
export class Diorama {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 300);
    this.own = [];
    this.az = -0.28;
    this.el = 0.95;
    this.dist = 26;
    this.target = new THREE.Vector3(8, 0, 8);
    this.cur = { az: this.az, el: this.el, dist: this.dist, target: this.target.clone() };
    this.t = 0;
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
  }

  /**
   * @param {import('../../data/maps/MapGrid.js').MapGrid} map
   * @param {ReturnType<import('./BlockSheet.js').buildBlockSheet>} sheet
   */
  build(map, sheet, { seen, secrets, party, notes, zoom = 1 }) {
    this._disposeScene();
    const T = this._track.bind(this);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070504);
    scene.fog = new THREE.Fog(0x070504, 45, 110);
    this.scene = scene;
    this.party = party;
    this.map = map;
    const maxAniso = this.ctx.render?.maxAnisotropy ?? 4;
    const { W, H, M, MX, MY } = SHEET;
    const cs = sheet.cs;
    const info = sheet.info;
    const seenCell = (x, y) => map.inBounds(x, y) && !info.isRock(x, y) && seen(x, y);

    // ---------- desk ----------
    const deskTex = T(new THREE.CanvasTexture(makeDesk(1024, 1024, { lit: false, seed: 9 })));
    deskTex.colorSpace = THREE.SRGBColorSpace;
    deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping;
    deskTex.repeat.set(2, 2);
    deskTex.anisotropy = maxAniso;
    const desk = new THREE.Mesh(T(new THREE.PlaneGeometry(140, 140)), T(new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.48, metalness: 0.0, color: 0xb89a84 })));
    desk.rotation.x = -Math.PI / 2;
    desk.position.set(10, -0.02, 8);
    desk.receiveShadow = true;
    scene.add(desk);

    // ---------- the parchment sheet ----------
    const tex = T(new THREE.CanvasTexture(sheet.canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    const pw = (W + 2 * M) / cs;
    const ph = (H + 2 * M) / cs;
    const geo = T(new THREE.PlaneGeometry(pw, ph, 64, 48));
    // curl the corners and add a faint fold ridge
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / pw + 0.5;
      const v = 0.5 - pos.getY(i) / ph;
      const du = Math.min(u, 1 - u);
      const dv = Math.min(v, 1 - v);
      const corner = Math.max(0, 0.16 - Math.hypot(du * 1.2, dv * 1.4)) / 0.16;
      const edge = Math.max(0, 0.05 - Math.min(du, dv)) / 0.05;
      const fold = Math.exp(-(((u - 0.5) * 60) ** 2)) * 0.05 + Math.exp(-(((v - 0.5) * 60) ** 2)) * 0.04;
      pos.setZ(i, corner * corner * 0.9 + edge * 0.08 + fold);
    }
    geo.computeVertexNormals();
    const grain = T(new THREE.CanvasTexture(grainTile()));
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(10, 8);
    const paper = new THREE.Mesh(geo, T(new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.02, roughness: 0.9, metalness: 0, bumpMap: grain, bumpScale: 0.6, side: THREE.DoubleSide,
    })));
    paper.rotation.x = -Math.PI / 2;
    paper.position.set(pw / 2 - (M + MX) / cs, 0, ph / 2 - (M + MY) / cs);
    paper.receiveShadow = true;
    paper.castShadow = true;
    scene.add(paper);

    // ---------- materials ----------
    const noiseTex = (seed, tint) => {
      const c = makeCanvas(128);
      const g = c.getContext('2d');
      const img = g.createImageData(128, 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const n = hash2(x >> 1, y >> 1, seed) * 0.5 + hash2(x >> 3, y >> 3, seed + 1) * 0.5;
        const i = (y * 128 + x) * 4;
        img.data[i] = tint[0] * (0.82 + n * 0.3);
        img.data[i + 1] = tint[1] * (0.82 + n * 0.3);
        img.data[i + 2] = tint[2] * (0.82 + n * 0.3);
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const t = T(new THREE.CanvasTexture(c));
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };
    const wallMat = T(new THREE.MeshStandardMaterial({ map: noiseTex(3, [236, 222, 192]), roughness: 0.82, metalness: 0 }));
    const capMat = T(new THREE.MeshStandardMaterial({ color: 0x2b1a0d, roughness: 0.55 }));
    const woodMat = T(new THREE.MeshStandardMaterial({ map: noiseTex(8, [170, 112, 58]), roughness: 0.6 }));
    const lockMat = T(new THREE.MeshStandardMaterial({ map: noiseTex(9, [150, 55, 38]), roughness: 0.55 }));
    const goldMat = T(new THREE.MeshStandardMaterial({ color: 0xd8b25a, roughness: 0.28, metalness: 1 }));
    const secretMat = T(new THREE.MeshStandardMaterial({ map: noiseTex(4, [220, 150, 130]), roughness: 0.8 }));
    const hatch = makeCanvas(256);
    {
      const g = hatch.getContext('2d');
      g.fillStyle = '#8f7e67';
      g.fillRect(0, 0, 256, 256);
      hatchRect(g, 0, 0, 256, 256, { seed: 12, size: 64, width: 3.2, color: '#2c1c0e', alpha: 0.85 });
    }
    const hatchTex = T(new THREE.CanvasTexture(hatch));
    hatchTex.colorSpace = THREE.SRGBColorSpace;
    const rockSide = T(new THREE.MeshStandardMaterial({ map: noiseTex(5, [150, 132, 110]), roughness: 0.9 }));
    const rockTop = T(new THREE.MeshStandardMaterial({ map: hatchTex, roughness: 0.9 }));

    const unit = T(new THREE.BoxGeometry(1, 1, 1));
    /** @type {Record<string, {mat:any, list:number[][]}>} */
    const batches = {};
    const add = (key, mat, cx, cy, cz, sx, sy, sz, ry = 0) => {
      (batches[key] ??= { mat, list: [] }).list.push([cx, cy, cz, sx, sy, sz, ry]);
    };
    const dungeon = map.tileset === 'dungeon' || map.kind === 'dungeon';
    const wallH = dungeon ? 0.62 : 0.48;
    const th = 0.1;
    const piece = (x0, z0, x1, z1, h, mat = wallMat, key = 'wall', cap = true) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) return;
      const horiz = Math.abs(z1 - z0) < 1e-6;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      add(key, mat, cx, h / 2, cz, horiz ? len + th : th, h, horiz ? th : len + th);
      if (cap) add('cap', capMat, cx, h + 0.008, cz, horiz ? len + th + 0.01 : th + 0.012, 0.016, horiz ? th + 0.012 : len + th + 0.01);
    };
    const { segs, effective } = collectEdges(map, info, seenCell, secrets);
    const ruin = (q) => q.style === 2 && !dungeon;
    for (const r of mergeRuns(segs.filter((q) => effective(q) === EDGE.WALL && !ruin(q)))) piece(r.x0, r.y0, r.x1, r.y1, wallH);
    const rr = prng(31);
    for (const q of segs) {
      const t = effective(q);
      const lerp = (a) => [q.x0 + (q.x1 - q.x0) * a, q.y0 + (q.y1 - q.y0) * a];
      if (t === EDGE.WALL && ruin(q)) {
        for (let i = 0; i < 3; i++) {
          const a = i / 3 + 0.03 + rr() * 0.04;
          const b = (i + 1) / 3 - 0.05 - rr() * 0.06;
          piece(...lerp(a), ...lerp(b), wallH * (0.25 + rr() * 0.45));
        }
        for (let i = 0; i < 4; i++) {
          const [px, pz] = lerp(rr());
          const s = 0.05 + rr() * 0.06;
          add('rubble', wallMat, px + (rr() - 0.5) * 0.35, s / 2, pz + (rr() - 0.5) * 0.35, s, s, s * 1.3, rr() * 3);
        }
        continue;
      }
      if (t === EDGE.WALL) continue;
      if (t === EDGE.SECRET) {
        piece(q.x0, q.y0, q.x1, q.y1, wallH, secretMat, 'secret');
        continue;
      }
      const gap = 0.26;
      piece(...lerp(0), ...lerp(0.5 - gap), wallH);
      piece(...lerp(0.5 + gap), ...lerp(1), wallH);
      const [mx, mz] = lerp(0.5);
      if (t === EDGE.ARCH) {
        for (const s of [-1, 1]) {
          const [px, pz] = lerp(0.5 + s * gap);
          add('post', wallMat, px, wallH * 0.6, pz, 0.14, wallH * 1.2, 0.14);
        }
        if (q.horiz) add('lintel', wallMat, mx, wallH * 1.12, mz, gap * 2 + 0.14, 0.1, 0.16);
        else add('lintel', wallMat, mx, wallH * 1.12, mz, 0.16, 0.1, gap * 2 + 0.14);
      } else {
        const mat = t === EDGE.LOCKED ? lockMat : woodMat;
        // leaf ajar (doors) or shut (locked), hinged at the first jamb
        const open = t === EDGE.DOOR ? 0.6 : 0;
        const hinge = lerp(0.5 - gap);
        const L = gap * 2;
        const ang = (q.horiz ? 0 : -Math.PI / 2) + open;
        add(t === EDGE.LOCKED ? 'lock' : 'door', mat, hinge[0] + Math.cos(ang) * L / 2, wallH * 0.36, hinge[1] - Math.sin(ang) * L / 2, L, wallH * 0.72, 0.05, ang);
        if (t === EDGE.LOCKED) add('knob', goldMat, mx, wallH * 0.38, mz, 0.09, 0.09, 0.09);
      }
    }
    // bedrock blocks next to explored ground
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!info.isRock(x, y)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (seenCell(x + dx, y + dy)) { near = true; break; }
      if (!near) continue;
      add('rock', [rockSide, rockSide, rockTop, rockSide, rockSide, rockSide], x + 0.5, wallH / 2, y + 0.5, 1.0, wallH, 1.0);
    }
    // water cells: a glassy sheet slightly above the paper
    const waterMat = T(new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55 }));
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.getCell(x, y) === CELL.WATER && seenCell(x, y)) add('water', waterMat, x + 0.5, 0.03, y + 0.5, 1, 0.02, 1);
    }
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (const [key, b] of Object.entries(batches)) {
      const mesh = new THREE.InstancedMesh(unit, b.mat, b.list.length);
      b.list.forEach(([x, y, z, sx, sy, sz, ry], i) => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (key === 'wall' || key === 'rock') {
          col.setScalar(0.88 + hash2(i, key.length, 3) * 0.12);
          mesh.setColorAt(i, col);
        }
      });
      mesh.castShadow = key !== 'water';
      mesh.receiveShadow = true;
      this.own.push({ dispose: () => mesh.dispose() });
      scene.add(mesh);
    }

    // ---------- party marker ----------
    this.marker = null;
    if (party) {
      const grp = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.42);
      shape.lineTo(0.26, -0.3);
      shape.lineTo(0, -0.16);
      shape.lineTo(-0.26, -0.3);
      shape.closePath();
      const ag = T(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2 }));
      ag.rotateX(-Math.PI / 2);
      const arrow = new THREE.Mesh(ag, T(new THREE.MeshStandardMaterial({ color: 0xc23a26, roughness: 0.3, metalness: 0.35, emissive: 0x3a0a04 })));
      arrow.castShadow = true;
      const rim = new THREE.Mesh(T(new THREE.TorusGeometry(0.36, 0.022, 8, 40)), goldMat);
      rim.rotation.x = Math.PI / 2;
      rim.castShadow = true;
      const glowTex = T(new THREE.CanvasTexture((() => {
        const c = makeCanvas(128);
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, 'rgba(255,220,150,0.9)');
        gr.addColorStop(0.4, 'rgba(255,170,80,0.35)');
        gr.addColorStop(1, 'rgba(255,150,60,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 128, 128);
        return c;
      })()));
      const glow = new THREE.Mesh(T(new THREE.PlaneGeometry(1.6, 1.6)), T(new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 })));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.02;
      const hover = new THREE.Group();
      hover.add(arrow, rim);
      grp.add(hover, glow);
      grp.position.set(party.x + 0.5, 0, party.y + 0.5);
      hover.rotation.y = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[party.dir] ?? 0;
      const pl = new THREE.PointLight(0xffb060, 1.4, 3.5, 2);
      pl.position.set(0, 0.8, 0);
      grp.add(pl);
      scene.add(grp);
      this.marker = { grp, hover, glow };
    }

    // ---------- pins ----------
    const needleMat = T(new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 1 }));
    const needleGeo = T(new THREE.CylinderGeometry(0.012, 0.004, 0.42, 6));
    const headGeo = T(new THREE.SphereGeometry(0.11, 20, 14));
    for (const n of notes ?? []) {
      const mat = T(new THREE.MeshStandardMaterial({ color: new THREE.Color(PIN_KINDS[n.kind]?.color ?? '#a8323a'), roughness: 0.35, metalness: 0.05 }));
      const px = n.x + 0.74;
      const pz = n.y + 0.3;
      const needle = new THREE.Mesh(needleGeo, needleMat);
      needle.position.set(px, 0.2, pz);
      needle.rotation.z = 0.12;
      needle.castShadow = true;
      const head = new THREE.Mesh(headGeo, mat);
      head.position.set(px - 0.05, 0.42, pz);
      head.castShadow = true;
      scene.add(needle, head);
    }

    // ---------- props: candle, inkwell & quill ----------
    const candle = new THREE.Group();
    const wax = T(new THREE.MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.6 }));
    const brass = goldMat;
    const dish = new THREE.Mesh(T(new THREE.CylinderGeometry(0.9, 1.0, 0.12, 32)), brass);
    dish.position.y = 0.06;
    const stick = new THREE.Mesh(T(new THREE.CylinderGeometry(0.32, 0.34, 2.4, 24)), wax);
    stick.position.y = 1.32;
    const drip = new THREE.Mesh(T(new THREE.TorusGeometry(0.33, 0.06, 8, 24)), wax);
    drip.rotation.x = Math.PI / 2;
    drip.position.y = 2.5;
    const flameMat = T(new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    flameMat.color.multiplyScalar(4);
    const flame = new THREE.Mesh(T(new THREE.SphereGeometry(0.1, 16, 12)), flameMat);
    flame.scale.set(1, 2.4, 1);
    flame.position.y = 2.82;
    for (const m of [dish, stick, drip]) { m.castShadow = true; m.receiveShadow = true; }
    candle.add(dish, stick, drip, flame);
    candle.position.set(-3.0, 0, 6.8);
    scene.add(candle);
    this.flame = flame;
    const candleLight = new THREE.PointLight(0xff9448, 26, 42, 1.6);
    candleLight.position.set(-3.0, 3.1, 6.8);
    scene.add(candleLight);
    this.candleLight = candleLight;
    const halo = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: this.marker?.glow.material.map ?? null, color: 0xffb070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 })));
    halo.scale.set(2.2, 2.2, 1);
    halo.position.set(-3.0, 2.85, 6.8);
    scene.add(halo);

    const glass = T(new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.08, metalness: 0.3 }));
    const well = new THREE.Mesh(T(new THREE.CylinderGeometry(0.55, 0.7, 0.8, 28)), glass);
    well.position.set(-3.4, 0.4, 10.6);
    well.castShadow = true;
    const neck = new THREE.Mesh(T(new THREE.CylinderGeometry(0.28, 0.32, 0.22, 20)), brass);
    neck.position.set(-3.4, 0.9, 10.6);
    scene.add(well, neck);
    const quill = new THREE.Group();
    const shaft = new THREE.Mesh(T(new THREE.CylinderGeometry(0.018, 0.03, 4.2, 8)), T(new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.5 })));
    shaft.position.y = 2.1;
    const vane = new THREE.Mesh(T(new THREE.SphereGeometry(1, 24, 12)), T(new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.75, side: THREE.DoubleSide })));
    vane.scale.set(0.32, 1.5, 0.03);
    vane.position.set(0.12, 2.7, 0);
    shaft.castShadow = vane.castShadow = true;
    quill.add(shaft, vane);
    quill.position.set(-3.4, 0.5, 10.6);
    quill.rotation.set(0.3, 0.4, -0.55);
    scene.add(quill);

    // ---------- lights ----------
    scene.add(new THREE.HemisphereLight(0xc8c0b0, 0x5a3a1c, 0.75));
    const key = new THREE.DirectionalLight(0xffd6a8, 2.4);
    key.position.set(-10, 20, 24);
    key.target.position.set(8, 0, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 70;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0x9aa8c8, 0.5);
    fill.position.set(-10, 14, 22);
    scene.add(fill);

    // ---------- camera ----------
    const tx = party ? party.x + 0.5 : map.w / 2;
    const tz = party ? party.y + 0.5 : map.h / 2;
    this.target.set(tx * 0.35 + map.w / 2 * 0.65 - 0.4, 0, tz * 0.35 + map.h / 2 * 0.65);
    this.dist = 34 / Math.max(0.5, zoom);
    this.cur = { az: this.az, el: this.el, dist: this.dist, target: this.target.clone() };
    this._applyCamera();
  }

  resize(w, h, rect) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    if (rect) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    }
    this.camera.updateProjectionMatrix();
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
    this.dist = Math.max(6, Math.min(48, this.dist * f));
  }

  focusParty() {
    if (!this.party) return;
    this.target.set(this.party.x + 0.5, 0, this.party.y + 0.5);
    this.dist = Math.min(this.dist, 14);
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
    if (this.marker) {
      this.marker.hover.position.y = 0.32 + Math.sin(t * 2.2) * 0.05;
      this.marker.glow.material.opacity = 0.55 + Math.sin(t * 3.2) * 0.2;
    }
    if (this.candleLight) {
      const f = 0.86 + 0.1 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * (hash2(Math.floor(t * 18), 3, 1) - 0.5);
      this.candleLight.intensity = 26 * f;
      this.flame.scale.set(1, 2.4 * (0.92 + f * 0.1), 1);
    }
  }
}
