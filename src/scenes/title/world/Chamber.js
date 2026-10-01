import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createFlameBatch } from '../../../render/lighting.js';
import { prng, ni, worldUV, tint, box, merge } from './geom.js';
import { column, robedFigure } from './arch.js';

export const CHAMBER_TEXTURES = ['hd_ashlar', 'hd_limestone', 'hd_beam_dark', 'hd_crazy'];

/** Where the chamber set lives (far below the city, sealed from the sky). */
export const CHAMBER_ORIGIN = new THREE.Vector3(0, -240, 0);

/**
 * The Council Chamber of New Phlan, for the prologue: a long hall with a
 * colonnade, tall dusk-blue windows, ceiling beams and the city's banners; the
 * council's long table lit by candles, robed councillors behind it, the clerk
 * at his lectern with the ledger, and three adventurers in silhouette before
 * them. Lit only by its own candles + window light (the world switches its
 * outdoor rig off while the camera is in here).
 */
export function createChamber({ seed = 1337 } = {}) {
  const R = prng(seed);
  const group = new THREE.Group();
  group.name = 'chamber';
  group.position.copy(CHAMBER_ORIGIN);
  const disposables = [];
  const stone = [], fine = [], wood = [], floor = [], cloth = [], skin = [], glass = [], gold = [];
  const W = 14, D = 26, H = 9.5; // room x: -7..7, z: -13..13 (council at -z end)

  // ---- shell -------------------------------------------------------------------
  floor.push(tint(worldUV(ni(new THREE.BoxGeometry(W, 0.2, D).translate(0, -0.1, 0)), 2.2), 0xb8ab98));
  // a runner carpet down the middle
  cloth.push(tint(worldUV(ni(new THREE.BoxGeometry(2.4, 0.03, D - 4).translate(0, 0.015, 1)), 1), 0x5a1410));
  for (const sx of [-1, 1]) {
    const wall = box(0.6, H, D, { x: sx * (W / 2 + 0.3) });
    stone.push(tint(worldUV(wall, 3), 0x9a8e7e, { aoBottom: 0, aoTop: 3 }));
  }
  stone.push(tint(worldUV(box(W + 1.2, H, 0.6, { z: -D / 2 - 0.3 }), 3), 0x9a8e7e, { aoBottom: 0, aoTop: 3 }));
  stone.push(tint(worldUV(box(W + 1.2, H, 0.6, { z: D / 2 + 0.3 }), 3), 0x8a7e6e, { aoBottom: 0, aoTop: 3 }));
  wood.push(tint(worldUV(box(W + 1.2, 0.4, D + 1.2, { y: H }), 2), 0x3a2a1e));
  // ceiling beams + corbels
  for (let z = -D / 2 + 1.5; z < D / 2; z += 3) {
    wood.push(tint(worldUV(box(W, 0.55, 0.45, { y: H - 0.55, z }), 1.5), 0x4a3424));
    for (const sx of [-1, 1]) wood.push(tint(worldUV(box(0.5, 0.9, 0.4, { x: sx * (W / 2 - 0.25), y: H - 1.45, z }), 1), 0x3a281a));
  }
  // colonnade along both walls, windows between
  for (const sx of [-1, 1]) {
    for (let z = -D / 2 + 3; z <= D / 2 - 3; z += 4) {
      const m = new THREE.Matrix4().makeTranslation(sx * (W / 2 - 1.1), 0, z);
      for (const g of column({ h: H - 1.0, r: 0.34, flutes: 16, seed: Math.round(z * 3 + sx * 7 + 50), color: 0xcfc4b0 })) fine.push(g.applyMatrix4(m));
    }
    for (let z = -D / 2 + 5; z <= D / 2 - 5; z += 4) {
      // tall round-headed window: blue dusk glass + stone reveal
      const win = new THREE.PlaneGeometry(1.5, 4.2);
      win.rotateY(-sx * Math.PI / 2);
      win.translate(sx * (W / 2 - 0.02), 4.6, z);
      glass.push(tint(ni(win), 0xffffff));
      const head = new THREE.CircleGeometry(0.75, 16, 0, Math.PI);
      head.rotateY(-sx * Math.PI / 2);
      head.translate(sx * (W / 2 - 0.02), 6.7, z);
      glass.push(tint(ni(head), 0xffffff));
      for (const dz of [-0.85, 0.85]) fine.push(tint(worldUV(box(0.3, 4.4, 0.2, { x: sx * (W / 2 - 0.12), y: 2.4, z: z + dz }), 1), 0xbfb4a0));
      fine.push(tint(worldUV(box(0.36, 0.2, 1.9, { x: sx * (W / 2 - 0.15), y: 2.35, z }), 1), 0xbfb4a0));
    }
  }
  // the far wall: a great hearth flanked by banners, the city's arms above
  {
    const z = -D / 2 + 0.05;
    fine.push(tint(worldUV(box(4.6, 3.6, 0.9, { y: 0, z: z + 0.45 }), 1.5), 0xb5a994));
    stone.push(tint(worldUV(box(3.0, 2.2, 0.5, { y: 0, z: z + 0.7 }), 1), 0x2a2420));
    fine.push(tint(worldUV(box(5.2, 0.4, 1.2, { y: 3.6, z: z + 0.6 }), 1.5), 0xc8bca8));
    // the arms of Phlan: a heater shield, gilt border on red, three gold roundels
    const sh = new THREE.Shape();
    sh.moveTo(-1, 1.1); sh.lineTo(1, 1.1); sh.lineTo(1, 0.1); sh.quadraticCurveTo(0.9, -0.9, 0, -1.4); sh.quadraticCurveTo(-0.9, -0.9, -1, 0.1); sh.closePath();
    const sg = new THREE.ShapeGeometry(sh, 8);
    sg.translate(0, 6.2, z + 0.1);
    gold.push(tint(ni(sg), 0xd8a848));
    const inner = new THREE.ShapeGeometry(sh, 8);
    inner.scale(0.84, 0.86, 1);
    inner.translate(0, 6.22, z + 0.12);
    cloth.push(tint(ni(inner), 0x8a1a14));
    for (const [rx, ry] of [[-0.42, 0.5], [0.42, 0.5], [0, -0.25]]) gold.push(tint(ni(new THREE.CircleGeometry(0.2, 16).translate(rx, 6.2 + ry, z + 0.14)), 0xe0b050));
    for (const bx of [-4.4, 4.4]) {
      const b = new THREE.PlaneGeometry(1.6, 5.0, 1, 8);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setZ(i, Math.sin(p.getX(i) * 3.5) * 0.06);
        if (y < -2.3) p.setY(i, y - (Math.abs(p.getX(i)) < 0.1 ? 0.5 : 0));
      }
      b.computeVertexNormals();
      b.translate(bx, 5.4, z + 0.12);
      cloth.push(tint(ni(b), 0x8a1a14));
      gold.push(tint(ni(new THREE.BoxGeometry(1.9, 0.12, 0.12).translate(bx, 7.95, z + 0.15)), 0xc89838));
    }
  }

  // ---- the council table -----------------------------------------------------------
  const tz = -5.5, tl = 9.0;
  wood.push(tint(worldUV(box(2.2, 0.14, tl, { y: 0.9, z: tz }), 1.2), 0x6a4a30));
  wood.push(tint(worldUV(box(2.0, 0.12, tl - 0.2, { y: 0.78, z: tz }), 1.2), 0x4a3220));
  for (const [lx, lz] of [[-0.85, -tl / 2 + 0.4], [0.85, -tl / 2 + 0.4], [-0.85, tl / 2 - 0.4], [0.85, tl / 2 - 0.4], [-0.85, tz - tz], [0.85, 0]]) {
    wood.push(tint(worldUV(box(0.18, 0.8, 0.18, { x: lx, y: 0, z: tz + lz }), 1), 0x3a2618));
  }
  cloth.push(tint(ni(new THREE.BoxGeometry(0.9, 0.02, tl - 0.4).translate(0, 1.05, tz)), 0x7a1a12));
  // documents, a map, goblets
  for (let i = 0; i < 9; i++) {
    const px = R.range(-0.8, 0.8), pz = tz + R.range(-tl / 2 + 0.6, tl / 2 - 0.6);
    const pg = new THREE.BoxGeometry(R.range(0.25, 0.4), 0.01, R.range(0.3, 0.45));
    pg.rotateY(R.range(-0.4, 0.4));
    pg.translate(px, 1.06, pz);
    floor.push(tint(worldUV(ni(pg), 1), 0xf0e2c0));
  }
  for (let i = 0; i < 6; i++) gold.push(tint(ni(new THREE.CylinderGeometry(0.05, 0.035, 0.18, 8).translate(R.range(-0.7, 0.7), 1.13, tz + R.range(-3.8, 3.8))), 0xc89838));

  // ---- candles: tall candelabra on the table, sconces on the columns ---------------------
  const flames = [];
  const candle = (x, y, z, hgt = 0.3) => {
    floor.push(tint(ni(new THREE.CylinderGeometry(0.035, 0.04, hgt, 8).translate(x, y + hgt / 2, z)), 0xf2ead2));
    flames.push({ pos: new THREE.Vector3(x, y + hgt, z).add(CHAMBER_ORIGIN), scale: 0.16 });
  };
  for (const cz of [tz - 3, tz, tz + 3]) {
    gold.push(tint(ni(new THREE.CylinderGeometry(0.05, 0.14, 0.55, 10).translate(0, 1.33, cz)), 0xb88a38));
    gold.push(tint(ni(new THREE.TorusGeometry(0.28, 0.025, 5, 16).rotateX(Math.PI / 2).translate(0, 1.6, cz)), 0xb88a38));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      candle(Math.cos(a) * 0.28, 1.6, cz + Math.sin(a) * 0.28, 0.24);
    }
    candle(0, 1.6, cz, 0.36);
  }
  for (const sx of [-1, 1]) for (let z = -D / 2 + 3; z <= D / 2 - 3; z += 4) {
    gold.push(tint(ni(new THREE.BoxGeometry(0.3, 0.06, 0.18).translate(sx * (W / 2 - 1.55), 3.4, z)), 0x8a6a2a));
    candle(sx * (W / 2 - 1.62), 3.43, z, 0.22);
  }
  // chandelier over the table
  gold.push(tint(ni(new THREE.TorusGeometry(1.2, 0.05, 6, 32).rotateX(Math.PI / 2).translate(0, 5.6, tz)), 0x6a5020));
  gold.push(tint(ni(new THREE.CylinderGeometry(0.02, 0.02, H - 5.6, 4).translate(0, 5.6 + (H - 5.6) / 2, tz)), 0x3a2a10));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    candle(Math.cos(a) * 1.2, 5.62, tz + Math.sin(a) * 1.2, 0.2);
  }

  // ---- the council, the clerk, the adventurers --------------------------------------------
  const person = (f, x, z, ry, level = 0) => {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, level, z);
    for (const g of f.cloth) cloth.push(g.applyMatrix4(m));
    for (const g of f.skin) skin.push(g.applyMatrix4(m));
  };
  // councillors along both sides of the table and the First Councillor at its head
  const robes = [0x5a1a14, 0x1e2a50, 0x3a2a48, 0x2a3a2a, 0x5a3a1a, 0x4a1a30, 0x24304a];
  [-3.2, -1.1, 1.1, 3.2].forEach((dz, i) => {
    person(robedFigure({ robe: robes[i], hood: false, seed: 10 + i, height: 1.7 + (i % 2) * 0.06 }), -1.65, tz + dz, Math.PI / 2 - 0.15);
    person(robedFigure({ robe: robes[(i + 3) % robes.length], hood: i % 2 === 1, seed: 20 + i, height: 1.68 + ((i + 1) % 2) * 0.07 }), 1.65, tz + dz, -Math.PI / 2 + 0.15);
  });
  person(robedFigure({ robe: 0x6a1410, hood: false, seed: 31, height: 1.82 }), 0, tz - tl / 2 - 0.8, 0);
  // the clerk at his lectern, quill over the ledger
  const lx = 2.6, lz = tz + tl / 2 + 1.2;
  wood.push(tint(worldUV(box(0.5, 1.05, 0.5, { x: lx, y: 0, z: lz }), 1), 0x4a3220));
  const desk = new THREE.BoxGeometry(0.9, 0.08, 0.7);
  desk.rotateX(-0.35);
  desk.translate(lx, 1.12, lz);
  wood.push(tint(worldUV(ni(desk), 1), 0x5a3e28));
  for (const s of [-1, 1]) {
    const page = new THREE.BoxGeometry(0.38, 0.03, 0.55);
    page.rotateZ(s * 0.08);
    page.rotateX(-0.35);
    page.translate(lx + s * 0.2, 1.18, lz);
    floor.push(tint(worldUV(ni(page), 1), 0xf2e6c6));
  }
  candle(lx + 0.38, 1.16, lz - 0.2, 0.18);
  person(robedFigure({ robe: 0x2a2620, hood: true, stoop: 0.5, seed: 41, height: 1.6, arms: 'forward' }), lx, lz + 0.75, Math.PI);
  // three adventurers in silhouette at the foot of the table: fighter, cleric, mage
  const adv = [[-2.5, 5.3, 0x3a3a40, 0.25], [2.4, 4.9, 0x6a5a40, -0.3], [-1.2, 6.6, 0x2a1e3a, 0.1]];
  adv.forEach(([ax, az, c, ry], i) => {
    person(robedFigure({ robe: c, hood: i === 2, seed: 60 + i, height: 1.78 - i * 0.04 }), ax, az, Math.PI + ry);
  });
  // a spear, a shield, a staff
  wood.push(tint(ni(new THREE.CylinderGeometry(0.025, 0.03, 2.4, 6).translate(-2.85, 1.2, 5.35)), 0x3a2a1a));
  gold.push(tint(ni(new THREE.ConeGeometry(0.05, 0.25, 6).translate(-2.85, 2.5, 5.35)), 0x9aa0a8));
  gold.push(tint(ni(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 16).rotateX(Math.PI / 2).translate(-2.2, 1.05, 5.0)), 0x6a6a72));
  wood.push(tint(ni(new THREE.CylinderGeometry(0.03, 0.035, 2.1, 6).translate(2.75, 1.05, 4.95)), 0x4a3424));

  // ---- meshes ------------------------------------------------------------------------------
  const texMat = (name, extra = {}) => {
    const t = getTextureSet(name);
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, vertexColors: true, roughness: 1, ...extra });
    disposables.push(m);
    return m;
  };
  const add = (list, mat) => {
    if (!list.length) return;
    const g = merge(list);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = false;
    group.add(mesh);
    disposables.push(g);
  };
  add(stone, texMat('hd_ashlar'));
  add(fine, texMat('hd_limestone'));
  add(wood, texMat('hd_beam_dark'));
  add(floor, texMat('hd_crazy'));
  const plain = (r, m = 0) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: m });
    disposables.push(mat);
    return mat;
  };
  add(cloth, plain(0.9));
  add(skin, plain(0.7));
  add(gold, plain(0.35, 0.85));
  const glassMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `varying vec3 vW;
      void main(){
        float y = clamp((vW.y + 240.0 - 2.4) / 5.2, 0.0, 1.0);
        vec3 c = mix(vec3(0.16, 0.12, 0.32), vec3(0.05, 0.08, 0.22), y);
        // leaded diamond quarries
        vec2 q = vec2(vW.z + vW.x, vW.y) * 2.6;
        vec2 d = abs(fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5);
        float lead = smoothstep(0.42, 0.47, max(d.x, d.y));
        gl_FragColor = vec4(c * (1.0 - lead * 0.85), 1.0);
      }`,
  });
  disposables.push(glassMat);
  add(glass, glassMat);
  const flameMesh = createFlameBatch(flames.map((f) => ({ pos: f.pos.clone().sub(CHAMBER_ORIGIN), scale: f.scale })));
  group.add(flameMesh);
  // candle halos
  const haloMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.55 });
  disposables.push(haloMat);
  const halos = [];
  flames.forEach((f, i) => {
    const s = new THREE.Sprite(haloMat);
    s.position.copy(f.pos).sub(CHAMBER_ORIGIN);
    s.position.y += 0.1;
    s.scale.setScalar(0.5);
    s.userData.seed = i * 1.37;
    group.add(s);
    halos.push(s);
  });
  // warm candle pools + cool window fill
  const lights = [];
  for (const [x, y, z, I, d] of [[0, 2.2, tz - 2.5, 26, 11], [0, 2.2, tz + 2.6, 26, 11], [lx, 1.8, lz, 8, 5], [0, 5.2, tz, 18, 12]]) {
    const L = new THREE.PointLight(0xffa458, I, d, 1.7);
    L.position.set(x, y, z);
    L.userData.base = I;
    group.add(L);
    lights.push(L);
  }
  const winFill = new THREE.PointLight(0x5a6ad0, 10, 18, 1.4);
  winFill.position.set(-5.5, 5, 4);
  group.add(winFill);
  const hearth = new THREE.PointLight(0xff7a30, 10, 9, 1.6);
  hearth.position.set(0, 0.8, -D / 2 + 1.4);
  group.add(hearth);

  return {
    group,
    lights,
    /** World-space table centre (for camera keys). */
    table: new THREE.Vector3(0, 1, tz).add(CHAMBER_ORIGIN),
    update(t) {
      for (const s of halos) s.scale.setScalar(0.5 * (0.9 + 0.1 * Math.sin(t * 9 + s.userData.seed)));
      lights.forEach((L, i) => { L.intensity = L.userData.base * (0.92 + 0.08 * Math.sin(t * 7.3 + i * 2.1)); });
      hearth.intensity = 10 * (0.85 + 0.15 * Math.sin(t * 5.1) * Math.sin(t * 2.3));
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      flameMesh.geometry.dispose();
    },
  };
}
