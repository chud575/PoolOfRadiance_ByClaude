import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createFlameBatch } from '../../../render/lighting.js';
import { prng, ni, worldUV, tint, box, merge } from './geom.js';
import { column } from './arch.js';
import { buildMiniature } from '../../../ui/components/Miniature.js';
import { armsTexture, bannerTexture, ledgerTexture, paperTexture, featherTexture, marbleFloorTexture } from './heraldry.js';

export const CHAMBER_TEXTURES = ['hd2_ashlar', 'hd_limestone', 'hd_beam_dark', 'hd2_plaster_int'];

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
  const armsGeo = [], bannerGeo = [], ledgerGeo = [], paperGeo = [], quillGeo = [];
  const W = 14, D = 26, H = 9.5; // room x: -7..7, z: -13..13 (council at -z end)

  // ---- shell -------------------------------------------------------------------
  floor.push(tint(worldUV(ni(new THREE.BoxGeometry(W, 0.2, D).translate(0, -0.1, 0)), 2.2), 0xb8ab98));
  // a runner carpet down the middle
  cloth.push(tint(worldUV(ni(new THREE.BoxGeometry(2.4, 0.03, D - 4).translate(0, 0.015, 1)), 1), 0x5a1410));
  for (const sx of [-1, 1]) {
    const wall = box(0.6, H, D, { x: sx * (W / 2 + 0.3) });
    stone.push(tint(worldUV(wall, 2.3), 0x9a8e7e, { aoBottom: 0, aoTop: 3 }));
  }
  stone.push(tint(worldUV(box(W + 1.2, H, 0.6, { z: -D / 2 - 0.3 }), 2.3), 0x9a8e7e, { aoBottom: 0, aoTop: 3 }));
  stone.push(tint(worldUV(box(W + 1.2, H, 0.6, { z: D / 2 + 0.3 }), 2.3), 0x8a7e6e, { aoBottom: 0, aoTop: 3 }));
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
    // the arms of New Phlan, carved and painted: a heater shield (tower over the
    // Moonsea waves, a bordure of gold) on a gilt cartouche
    const sh = new THREE.Shape();
    sh.moveTo(-1, 1.1); sh.lineTo(1, 1.1); sh.lineTo(1, 0.1); sh.quadraticCurveTo(0.9, -0.9, 0, -1.4); sh.quadraticCurveTo(-0.9, -0.9, -1, 0.1); sh.closePath();
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2, curveSegments: 12 });
    sg.translate(0, 6.2, z + 0.06);
    gold.push(tint(ni(sg), 0xd8a848));
    const face = new THREE.ShapeGeometry(sh, 16);
    const fp = face.attributes.position, fuv = face.attributes.uv;
    for (let i = 0; i < fp.count; i++) fuv.setXY(i, (fp.getX(i) + 1) / 2, (fp.getY(i) + 1.4) / 2.5);
    face.scale(0.9, 0.9, 1);
    face.translate(0, 6.25, z + 0.205);
    armsGeo.push(ni(face));
    // mantling scrolls either side of the shield
    for (const sx of [-1, 1]) {
      const sc = new THREE.TorusGeometry(0.34, 0.06, 6, 18, Math.PI * 1.4);
      sc.rotateZ(sx > 0 ? -0.6 : Math.PI + 0.6);
      sc.translate(sx * 1.25, 6.75, z + 0.12);
      gold.push(tint(ni(sc), 0xc89838));
      const sc2 = new THREE.TorusGeometry(0.22, 0.05, 6, 16, Math.PI * 1.5);
      sc2.rotateZ(sx > 0 ? 0.9 : Math.PI - 0.9);
      sc2.translate(sx * 1.15, 5.65, z + 0.12);
      gold.push(tint(ni(sc2), 0xc89838));
    }
    // a mural crown over the shield
    gold.push(tint(ni(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 20, 1, true, -Math.PI / 2, Math.PI).rotateY(Math.PI).translate(0, 7.48, z + 0.05)), 0xd8a848));
    for (let k = 0; k < 5; k++) gold.push(tint(ni(new THREE.BoxGeometry(0.16, 0.16, 0.1).translate(-0.5 + k * 0.25, 7.66, z + 0.62 * Math.sin(Math.acos((-0.5 + k * 0.25) / 0.62)) + 0.03)), 0xd8a848));
    // banners with the city's device, a gilt pole and a bullion fringe
    for (const bx of [-4.4, 4.4]) {
      const b = new THREE.PlaneGeometry(1.6, 5.0, 6, 16);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        // swallowtail hem + soft vertical folds
        const tail = y < -2.0 ? Math.max(0, 0.55 - Math.abs(x) * 0.7) * ((-2.0 - y) / 0.5) : 0;
        p.setY(i, y + tail * 0.9);
        p.setZ(i, Math.sin(x * 4.2 + bx) * 0.07 + Math.sin(y * 0.9) * 0.02);
      }
      b.computeVertexNormals();
      b.translate(bx, 5.4, z + 0.16);
      bannerGeo.push(b);
      gold.push(tint(ni(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 8).rotateZ(Math.PI / 2).translate(bx, 7.95, z + 0.2)), 0xc89838));
      for (const ex of [-1.05, 1.05]) gold.push(tint(ni(new THREE.SphereGeometry(0.09, 10, 8).translate(bx + ex, 7.95, z + 0.2)), 0xe0b050));
      // fringe: a row of short gilt tassels along the swallowtail hem
      for (let k = 0; k <= 16; k++) {
        const x = -0.8 + k * 0.1;
        const yy = 2.9 - Math.max(0, 0.55 - Math.abs(x) * 0.7) * 0.9;
        gold.push(tint(ni(new THREE.CylinderGeometry(0.012, 0.02, 0.16, 4).translate(bx + x, yy - 0.08, z + 0.17 + Math.sin(x * 4.2 + bx) * 0.07)), 0xd0a040));
      }
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
  // the Council's business: a great open ledger at the near end, loose petitions
  // and a city plan, inkwell and quill, goblets
  {
    const book = (x, y, z, ry, w = 0.62, d = 0.44) => {
      // two page blocks with a raised gutter, on a leather board
      wood.push(tint(worldUV(box(w + 0.06, 0.03, d + 0.05, { x, y, z, ry }), 1), 0x3a1a10));
      for (const s2 of [-1, 1]) {
        const pg = new THREE.PlaneGeometry(w / 2, d, 8, 1);
        const pp = pg.attributes.position;
        for (let i = 0; i < pp.count; i++) {
          const u = (pp.getX(i) + w / 4) / (w / 2); // 0..1 across the half page
          const lift = Math.sin(Math.min(1, s2 > 0 ? 1 - u : u) * Math.PI * 0.5) * 0.035;
          pp.setZ(i, lift);
        }
        const uv = pg.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (s2 > 0 ? 0.5 : 0));
        pg.rotateX(-Math.PI / 2);
        pg.translate(s2 * w / 4, 0.045, 0);
        pg.rotateY(ry);
        pg.translate(x, y, z);
        ledgerGeo.push(pg);
      }
    };
    book(0.15, 1.05, tz + tl / 2 - 0.55, 0.12);
    // loose petitions and a city plan
    for (let i = 0; i < 7; i++) {
      const px = R.range(-0.75, 0.75), pz = tz + R.range(-tl / 2 + 0.6, tl / 2 - 1.3);
      const pg = new THREE.PlaneGeometry(R.range(0.26, 0.36), R.range(0.34, 0.44));
      pg.rotateX(-Math.PI / 2);
      pg.rotateY(R.range(-0.5, 0.5));
      pg.translate(px, 1.062 + i * 0.0015, pz);
      paperGeo.push(pg);
    }
    // inkwell + quill (feather card standing in the well, crossing the light)
    gold.push(tint(ni(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 12).translate(-0.42, 1.095, tz + tl / 2 - 0.45)), 0x2a2a30));
    const q = new THREE.PlaneGeometry(0.07, 0.34);
    q.translate(0, 0.17, 0);
    q.rotateZ(-0.35);
    q.rotateY(0.6);
    q.translate(-0.42, 1.12, tz + tl / 2 - 0.45);
    quillGeo.push(q);
  }
  // goblets (turned: foot, knopped stem, bowl) at each councillor's place, a
  // pewter ewer, scroll rolls tied with ribbon, a wax seal and a dish of fruit
  const goblet = new THREE.LatheGeometry([[0, 0], [0.045, 0], [0.045, 0.008], [0.012, 0.02], [0.01, 0.06], [0.02, 0.07], [0.01, 0.08], [0.012, 0.1], [0.04, 0.12], [0.052, 0.17], [0.05, 0.19], [0.046, 0.19], [0.046, 0.175], [0, 0.13]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  for (const dz of [-3.2, -1.1, 1.1, 3.2]) for (const sx of [-1, 1]) {
    gold.push(tint(ni(goblet.clone().translate(sx * 0.62 + R.range(-0.05, 0.05), 1.06, tz + dz + R.range(-0.25, 0.1))), R.chance(0.5) ? 0xc89838 : 0xa8a8b0));
  }
  goblet.dispose();
  const ewer = new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.08, 0.04], [0.1, 0.12], [0.09, 0.2], [0.05, 0.27], [0.045, 0.31], [0.06, 0.34], [0.055, 0.345], [0, 0.3]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  ewer.translate(-0.3, 1.06, tz - 1.9);
  gold.push(tint(ni(ewer), 0x9a9aa4));
  const handle = new THREE.TorusGeometry(0.07, 0.012, 5, 12, Math.PI * 1.2);
  handle.rotateZ(-Math.PI * 0.35);
  handle.translate(-0.3 - 0.1, 1.06 + 0.2, tz - 1.9);
  gold.push(tint(ni(handle), 0x9a9aa4));
  for (const [sx2, sz, ry, len] of [[0.45, tz + 1.9, 0.4, 0.42], [-0.55, tz - 0.4, -0.25, 0.36], [0.3, tz - 3.6, 1.2, 0.4], [-0.35, tz + 3.0, 0.9, 0.34]]) {
    const roll = new THREE.CylinderGeometry(0.035, 0.035, len, 12);
    roll.rotateZ(Math.PI / 2);
    roll.rotateY(ry);
    roll.translate(sx2, 1.095, sz);
    floor.push(tint(ni(roll), 0xe8d8b0));
    const rib = new THREE.TorusGeometry(0.037, 0.008, 4, 12);
    rib.rotateY(Math.PI / 2);
    rib.rotateY(ry);
    rib.translate(sx2, 1.095, sz);
    cloth.push(tint(ni(rib), 0x8a1a12));
  }
  for (const [fx, fz] of [[0.42, tz - 0.9], [0.5, tz - 0.8], [0.44, tz - 0.75], [0.36, tz - 0.86]]) cloth.push(tint(ni(new THREE.SphereGeometry(0.04, 8, 6).translate(fx, 1.1, fz)), R.chance(0.5) ? 0x8a2a14 : 0x9a7a20));
  gold.push(tint(ni(new THREE.CylinderGeometry(0.16, 0.1, 0.035, 18).translate(0.43, 1.07, tz - 0.83)), 0xa8a8b0));

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
  // Sculpted figures from the party-miniature rig (faces, hands, robes and armour),
  // in councillors' robes and vestments; lit only by the candles.
  const figures = [];
  const person = (ch, x, z, ry, q = 0.018, o = {}) => {
    const f = buildMiniature({ race: 'human', ...ch }, { pose: o.pose ?? 'stand', base: false, gear: false, quality: q, faceSize: 128, noWeapon: o.noWeapon ?? true, noShield: o.noShield ?? true });
    f.position.set(x, 0, z);
    f.rotation.y = ry;
    f.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    group.add(f);
    figures.push(f);
    return f;
  };
  // councillors along both sides of the table and the First Councillor at its head
  const council = [
    { gender: 'male', classSpec: 'magicUser', look: { seed: 11, head: 7, body: 4, cloth: 0, hair: 9 } },
    { gender: 'female', classSpec: 'cleric', look: { seed: 12, head: 2, body: 7, cloth: 1, hair: 1 } },
    { gender: 'male', classSpec: 'cleric', look: { seed: 13, head: 2, body: 7, cloth: 3, hair: 0 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 14, head: 1, body: 4, cloth: 5, hair: 2 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 21, head: 3, body: 4, cloth: 6, hair: 8 } },
    { gender: 'female', classSpec: 'magicUser', look: { seed: 22, head: 4, body: 4, cloth: 3, hair: 3 } },
    { gender: 'male', classSpec: 'cleric', look: { seed: 23, head: 7, body: 7, cloth: 4, hair: 7 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 24, head: 6, body: 4, cloth: 2, hair: 1 } },
  ];
  // high-backed council chairs (carved oak, red leather back, gilt finials);
  // seated councillors turned toward the adventurers at the foot of the table
  const SEAT = 0.2; // the dais under the chairs lifts the seated figures
  const chair = (x, z, ry, tall = 1.55, w = 0.6) => {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
    const put = (g, list, c) => list.push(tint(worldUV(g.applyMatrix4(m), 1), c));
    put(box(w + 0.1, 0.2, 0.75, { z: -0.08 }), wood, 0x3a2818); // footboard / dais
    put(box(w, 0.08, 0.52, { y: SEAT + 0.4, z: -0.02 }), wood, 0x5a3a22);
    put(box(w - 0.08, 0.05, 0.46, { y: SEAT + 0.48, z: -0.02 }), cloth, 0x6a1410);
    for (const sx of [-1, 1]) {
      put(box(0.07, SEAT + 0.42, 0.07, { x: sx * (w / 2 - 0.04), y: 0, z: 0.2 }), wood, 0x3a2618);
      put(box(0.08, SEAT + 0.42 + tall, 0.08, { x: sx * (w / 2 - 0.04), y: 0, z: -0.27 }), wood, 0x3a2618);
      put(box(0.06, 0.06, 0.48, { x: sx * (w / 2 - 0.02), y: SEAT + 0.72, z: -0.03 }), wood, 0x4a3020); // arm rest
      put(box(0.05, 0.28, 0.05, { x: sx * (w / 2 - 0.02), y: SEAT + 0.44, z: 0.19 }), wood, 0x3a2618);
      const fin = new THREE.ConeGeometry(0.045, 0.14, 8).translate(sx * (w / 2 - 0.04), SEAT + 0.49 + tall, -0.27);
      wood.push(tint(worldUV(fin.applyMatrix4(m), 1), 0x5a3a22));
    }
    put(box(w - 0.08, tall - 0.12, 0.05, { y: SEAT + 0.48, z: -0.27 }), cloth, 0x5a1210);
    put(box(w + 0.04, 0.16, 0.1, { y: SEAT + 0.42 + tall - 0.1, z: -0.27 }), wood, 0x4a3020); // carved crest rail
    const crest = new THREE.CircleGeometry(0.1, 16).translate(0, SEAT + 0.42 + tall + 0.08, -0.215);
    wood.push(tint(worldUV(crest.applyMatrix4(m), 1), 0x6a4a28));
  };
  const seated = (ch, x, z, ry, q = 0.016) => {
    chair(x, z, ry);
    const f = person(ch, x, z, ry, q, { pose: 'sit' });
    f.position.y = SEAT;
    return f;
  };
  [-3.2, -1.1, 1.1, 3.2].forEach((dz, i) => {
    // the nearer the councillor sits to the foot, the further they turn to look
    const turn = 0.5 + 0.12 * (dz + 3.2) / 6.4;
    seated(council[i], -1.78, tz + dz, Math.PI / 2 - turn);
    seated(council[i + 4], 1.78, tz + dz, -Math.PI / 2 + turn);
  });
  // the First Councillor in the great chair at the head of the table
  chair(0, tz - tl / 2 - 0.85, 0, 2.1, 0.78);
  person({ gender: 'male', classSpec: 'cleric', look: { seed: 31, head: 2, body: 7, cloth: 0, hair: 7 } }, 0, tz - tl / 2 - 0.85, 0, 0.016, { pose: 'sit' }).position.y = SEAT;
  // the clerk at his lectern beside the foot of the table, turned to the
  // adventurers, quill raised over the open ledger as he takes their names
  const lx = 2.15, lz = tz + tl / 2 + 0.75;
  const lry = -0.55; // lectern + clerk face the foot of the hall (toward camera)
  const lm = new THREE.Matrix4().makeRotationY(lry).setPosition(lx, 0, lz);
  const lput = (g, list, c) => list.push(tint(worldUV(g.applyMatrix4(lm), 1), c));
  lput(box(0.42, 0.98, 0.36, { z: 0 }), wood, 0x4a3220);
  lput(box(0.6, 0.06, 0.5, { y: 0, z: 0 }), wood, 0x3a2618);
  const desk = new THREE.BoxGeometry(0.78, 0.06, 0.56);
  desk.rotateX(0.32);
  desk.translate(0, 1.04, 0.02);
  lput(desk, wood, 0x5a3e28);
  {
    // the open ledger on the sloped desk (tilted toward the clerk, who stands behind it)
    for (const s2 of [-1, 1]) {
      const pg = new THREE.PlaneGeometry(0.34, 0.46);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (s2 > 0 ? 0.5 : 0));
      pg.rotateX(-Math.PI / 2);
      pg.rotateZ(s2 * 0.06);
      pg.translate(s2 * 0.17, 0.04, 0);
      pg.rotateX(0.32);
      pg.translate(0, 1.05, 0.02);
      pg.applyMatrix4(lm);
      ledgerGeo.push(pg);
    }
  }
  candle(lx + Math.cos(lry) * 0.36 - 0.1, 1.0, lz - Math.sin(lry) * 0.36 - 0.25, 0.18);
  const clerk = person({ gender: 'male', classSpec: 'magicUser', look: { seed: 41, head: 6, body: 4, cloth: 5, hair: 1 } }, lx - Math.sin(lry) * 0.62, lz - Math.cos(lry) * 0.62, lry, 0.014);
  {
    // his quill, raised mid-stroke in his right hand (the rig's right hand rests
    // forward of the hip in the standing pose): a feather card plus a dark nib
    const qg = new THREE.PlaneGeometry(0.085, 0.44);
    qg.translate(0, 0.22, 0);
    qg.rotateZ(0.5);
    qg.rotateX(-0.5);
    const quill = new THREE.Mesh(qg, new THREE.MeshStandardMaterial({ map: featherTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }));
    quill.position.set(-0.2, 1.02, 0.34);
    clerk.add(quill);
    disposables.push(qg, quill.material, quill.material.map);
  }
  // three adventurers seen from behind at the foot of the table: fighter in plate,
  // cleric in mail and tabard, mage in robes with a staff
  person({ gender: 'male', classSpec: 'fighter', look: { seed: 61, head: 0, body: 0, cloth: 1, hair: 2 } }, -2.45, 2.2, Math.PI + 0.35, 0.013, { noWeapon: false, noShield: false });
  person({ gender: 'female', classSpec: 'cleric', look: { seed: 62, head: 5, body: 5, cloth: 0, hair: 4 } }, 1.95, 2.5, Math.PI - 0.35, 0.013, { noWeapon: false, noShield: false });

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
  add(stone, texMat('hd2_ashlar'));
  add(fine, texMat('hd_limestone'));
  add(wood, texMat('hd_beam_dark'));
  const plain = (r, m = 0) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: m });
    disposables.push(mat);
    return mat;
  };
  add(cloth, plain(0.9));
  add(skin, plain(0.7));
  add(gold, plain(0.35, 0.85));
  // floor + candles/scrolls: the marble chequer (its own texture, never the terrace's crazy paving)
  {
    const mt = marbleFloorTexture();
    const mm = new THREE.MeshStandardMaterial({ map: mt.map, roughnessMap: mt.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
    disposables.push(mm, mt.map, mt.roughnessMap);
    add(floor.slice(0, 1), mm);
    add(floor.slice(1), plain(0.8));
  }
  const texd = (list, tex, o = {}) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide, ...o });
    disposables.push(mat, tex);
    const g = merge(list.map((x) => (x.index ? x.toNonIndexed() : x)));
    group.add(new THREE.Mesh(g, mat));
    disposables.push(g);
  };
  texd(armsGeo, armsTexture(), { roughness: 0.55, metalness: 0.25 });
  texd(bannerGeo, bannerTexture(), { roughness: 0.95 });
  texd(ledgerGeo, ledgerTexture(), { roughness: 0.9 });
  texd(paperGeo, paperTexture(), { roughness: 0.92 });
  texd(quillGeo, featherTexture(), { roughness: 0.8, alphaTest: 0.4 });
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
  for (const [x, y, z, I, d] of [[0, 2.2, tz - 2.5, 26, 11], [0, 2.2, tz + 2.6, 26, 11], [lx + 0.5, 2.4, lz - 0.6, 3, 4], [0, 5.2, tz, 18, 12]]) {
    const L = new THREE.PointLight(0xffa458, I, d, 1.7);
    L.position.set(x, y, z);
    L.userData.base = I;
    group.add(L);
    lights.push(L);
  }
  // candle spill between the adventurers and the table (rims their shoulders and helms)
  // and a cool moonlit fill from the doors behind them, so plate and mail read from the back
  const advRim = new THREE.PointLight(0xffa458, 7, 6, 1.6);
  advRim.position.set(0, 1.9, 0.6);
  group.add(advRim);
  const advFill = new THREE.PointLight(0x8090e0, 13, 9, 1.4);
  advFill.position.set(0.2, 2.8, 5.4);
  group.add(advFill);
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
      for (const f of figures) f.userData.dispose?.();
      flameMesh.geometry.dispose();
    },
  };
}
