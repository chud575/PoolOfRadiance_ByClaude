import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createFlameBatch } from '../../../render/lighting.js';
import { prng, ni, worldUV, tint, box, merge } from './geom.js';
import { column, contactShadow, matteFigure, addRimLight } from './arch.js';
import { buildMiniature } from '../../../ui/components/Miniature.js';
import { armsTexture, bannerTexture, ledgerTexture, paperTexture, featherTexture, marbleFloorTexture, tapestryTexture } from './heraldry.js';

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
  const stone = [], fine = [], wood = [], polished = [], floor = [], cloth = [], skin = [], glass = [], gold = [];
  const armsGeo = [], bannerGeo = [], ledgerGeo = [], paperGeo = [], quillGeo = [], tapGeo = [];
  const W = 14, D = 26, H = 9.5; // room x: -7..7, z: -13..13 (council at -z end)

  // ---- shell -------------------------------------------------------------------
  floor.push(tint(worldUV(ni(new THREE.BoxGeometry(W, 0.2, D).translate(0, -0.1, 0)), 2.2), 0xb8ab98));
  // the runner carpet down the middle is its own mesh (pile, wear, gilt binding): see below
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
    // its iron hanging bracket and the soft shadow it throws on the ashlar
    gold.push(tint(ni(new THREE.BoxGeometry(0.12, 0.5, 0.22).translate(0, 7.3, z + 0.1)), 0x2a2420));
    {
      const sg2 = new THREE.ShapeGeometry(sh, 12);
      sg2.scale(1.12, 1.08, 1);
      sg2.translate(0.12, 6.05, z + 0.012);
      const shMesh = new THREE.Mesh(sg2, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
      group.add(shMesh);
      disposables.push(sg2, shMesh.material);
    }
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

  // ---- oak wainscot along the side walls, tapestries, the hearth's hood ---------------
  // breaks the ashlar up: panelled oak to dado height (stiles, rails, fielded
  // panels with a moulded cap), hangings between the windows, a stone hood
  {
    const WH = 1.75;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.04);
      wood.push(tint(worldUV(box(0.08, WH, D - 0.4, { x }), 1.2), 0x3a2618));
      wood.push(tint(worldUV(box(0.16, 0.1, D - 0.4, { x: x - sx * 0.04, y: WH }), 1), 0x5a3c24)); // capping rail
      wood.push(tint(worldUV(box(0.13, 0.2, D - 0.4, { x: x - sx * 0.03, y: 0 }), 1), 0x2a1a10)); // skirting
      for (let z = -D / 2 + 0.5; z < D / 2 - 0.6; z += 0.9) {
        const tone = 0.85 + 0.3 * R.next();
        // a fielded panel: raised centre, thin bolection frame
        wood.push(tint(worldUV(box(0.05, WH - 0.55, 0.62, { x: x - sx * 0.05, y: 0.3, z: z + 0.45 }), 1), new THREE.Color(0x4a3020).multiplyScalar(tone)));
        wood.push(tint(worldUV(box(0.07, WH - 0.35, 0.06, { x: x - sx * 0.05, y: 0.2, z }), 1), 0x2e1e12)); // stile
      }
      wood.push(tint(worldUV(box(0.07, 0.07, D - 0.4, { x: x - sx * 0.06, y: 0.24 }), 1), 0x2e1e12)); // bottom rail
      wood.push(tint(worldUV(box(0.07, 0.07, D - 0.4, { x: x - sx * 0.06, y: WH - 0.12 }), 1), 0x2e1e12)); // top rail
    }
    // tapestries: hunting and harbour scenes woven in faded madder and woad,
    // hung on rods between the windows (each its own weave and fold)
    for (const [sx, z] of [[-1, -11], [1, -11], [-1, 11], [1, 11], [-1, -1], [1, 3]]) {
      const tg = new THREE.PlaneGeometry(1.9, 3.4, 10, 1);
      const tp = tg.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, Math.sin(tp.getX(i) * 5.5 + z) * 0.04);
      tg.computeVertexNormals();
      tg.rotateY(-sx * Math.PI / 2);
      tg.translate(sx * (W / 2 - 0.1), 2.2 + 1.7 + 0.15, z);
      tapGeo.push(tg);
      gold.push(tint(ni(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6).rotateX(Math.PI / 2).translate(sx * (W / 2 - 0.12), 5.65, z)), 0x6a5020));
    }
    // hearth hood: a tapered stone chimney-breast rising from the mantel shelf
    const zz = -D / 2 + 0.05;
    const hood = new THREE.CylinderGeometry(1.4, 2.4, 1.6, 4, 1);
    hood.rotateY(Math.PI / 4);
    hood.scale(1, 1, 0.42);
    hood.translate(0, 3.8 + 0.8, zz + 0.62);
    fine.push(tint(worldUV(ni(hood), 1.5), 0xa89c88));
    fine.push(tint(worldUV(box(2.1, 0.25, 0.75, { y: 5.4, z: zz + 0.4 }), 1.5), 0xb8ac98));
    // soot licking up the hood's face
    stone.push(tint(worldUV(box(1.6, 1.0, 0.05, { y: 3.85, z: zz + 1.02 }), 1), 0x2a2420));
  }

  // ---- the council table -----------------------------------------------------------
  const tz = -5.5, tl = 9.0;
  // a joined oak table: a thick top with a moulded, bevelled edge (polished),
  // a deep apron with a bead along its foot, six turned baluster legs on
  // square blocks, and a low stretcher frame near the floor
  {
    const top = new THREE.Shape();
    const hw = 1.1, hl = tl / 2;
    top.moveTo(-hw, -hl); top.lineTo(hw, -hl); top.lineTo(hw, hl); top.lineTo(-hw, hl); top.closePath();
    const tg = new THREE.ExtrudeGeometry(top, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.04, bevelSegments: 3, curveSegments: 4 });
    tg.rotateX(-Math.PI / 2);
    tg.translate(0, 0.965, tz);
    polished.push(tint(worldUV(ni(tg), 1.2), 0x6e4a2c));
    // under-top moulding (a cavetto step) and the apron
    wood.push(tint(worldUV(box(2.1, 0.04, tl - 0.08, { y: 0.9, z: tz }), 1.2), 0x4e3420));
    for (const sx of [-1, 1]) {
      wood.push(tint(worldUV(box(0.05, 0.2, tl - 0.5, { x: sx * 0.93, y: 0.7, z: tz }), 1.2), 0x4a3020, { aoBottom: 0.7, aoTop: 0.9, aoStrength: 0.4 }));
      wood.push(tint(worldUV(ni(new THREE.CylinderGeometry(0.018, 0.018, tl - 0.5, 6).rotateX(Math.PI / 2).translate(sx * 0.955, 0.7, tz)), 1), 0x6a4628));
    }
    for (const sz of [-1, 1]) wood.push(tint(worldUV(box(1.82, 0.2, 0.05, { y: 0.7, z: tz + sz * (tl / 2 - 0.28) }), 1.2), 0x4a3020));
    // turned legs: block, vase, ring, column, foot
    const legProf = [[0.0, 0.0], [0.075, 0.0], [0.085, 0.03], [0.07, 0.06], [0.06, 0.1], [0.085, 0.16], [0.11, 0.26], [0.1, 0.34], [0.065, 0.4], [0.085, 0.43], [0.06, 0.46], [0.05, 0.52], [0.055, 0.58], [0.07, 0.6], [0.0, 0.6]].map(([r, y]) => new THREE.Vector2(r, y));
    for (const [lx2, lz2] of [[-0.82, -tl / 2 + 0.38], [0.82, -tl / 2 + 0.38], [-0.82, tl / 2 - 0.38], [0.82, tl / 2 - 0.38], [-0.82, 0], [0.82, 0]]) {
      const lg = new THREE.LatheGeometry(legProf, 12);
      lg.translate(lx2, 0.0, tz + lz2);
      wood.push(tint(worldUV(lg, 1), 0x3e2818, { aoBottom: 0, aoTop: 0.6, aoStrength: 0.35 }));
      wood.push(tint(worldUV(box(0.15, 0.2, 0.15, { x: lx2, y: 0.6, z: tz + lz2 }), 1), 0x3e2818));
    }
    for (const sx of [-0.82, 0.82]) wood.push(tint(worldUV(box(0.06, 0.06, tl - 0.76, { x: sx, y: 0.08, z: tz }), 1), 0x352214));
    wood.push(tint(worldUV(box(1.64, 0.06, 0.06, { y: 0.08, z: tz }), 1), 0x352214));
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
    floor.push(tint(ni(new THREE.CylinderGeometry(0.035, 0.04, hgt, 8).translate(x, y + hgt / 2, z)), 0xa89878, { aoBottom: y, aoTop: y + hgt, aoStrength: 0.3 }));
    flames.push({ pos: new THREE.Vector3(x, y + hgt, z).add(CHAMBER_ORIGIN), scale: 0.11 });
  };
  // a log fire in the great hearth at the end of the hall: the focal axis of
  // the room ends on it, and it backlights the First Councillor's chair
  {
    const hz = -D / 2 + 1.32;
    for (const [lx2, ly, lr, rz2] of [[-0.6, 0.12, 0.11, 0.35], [0.6, 0.12, 0.1, -0.3], [0, 0.27, 0.09, 0.08], [-0.2, 0.1, 0.1, -0.15]]) {
      const lg = new THREE.CylinderGeometry(lr, lr * 1.1, 1.5, 8).rotateZ(Math.PI / 2).rotateY(rz2).translate(lx2, ly + 0.62, hz);
      stone.push(tint(ni(lg), 0x1a120c));
    }
    // fire-dogs either side of the logs
    // a raised hearth-stone carrying the fire (so it shows over the board from the foot of the hall)
    fine.push(tint(worldUV(box(3.2, 0.62, 1.1, { y: 0, z: hz - 0.05 }), 1), 0x6a5e50, { aoBottom: 0, aoTop: 0.62, aoStrength: 0.5 }));
    for (const sx of [-1, 1]) gold.push(tint(ni(new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(sx * 1.25, 0.84, hz + 0.25)), 0x1a1614));
    for (const [fx, fy, fs] of [[-0.95, 0.2, 0.55], [-0.62, 0.26, 0.75], [-0.3, 0.3, 0.65], [0.05, 0.32, 0.8], [0.38, 0.28, 0.7], [0.7, 0.25, 0.75], [0.98, 0.2, 0.5]]) {
      flames.push({ pos: new THREE.Vector3(fx, fy + 0.62, hz + 0.05).add(CHAMBER_ORIGIN), scale: fs * 1.15, hearth: true });
    }
  }
  // turned brass candelabra: a domed foot, knopped baluster stem, and five
  // S-curved arms ending in drip-pans and sockets round a taller centre light
  const candProf = [[0, 0], [0.16, 0], [0.17, 0.02], [0.13, 0.05], [0.07, 0.09], [0.04, 0.12], [0.06, 0.15], [0.035, 0.19], [0.03, 0.3], [0.055, 0.34], [0.03, 0.38], [0.028, 0.5], [0.05, 0.53], [0.06, 0.56], [0.0, 0.57]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const cz of [tz - 3, tz, tz + 3]) {
    const lg = new THREE.LatheGeometry(candProf, 14);
    lg.translate(0, 1.04, cz);
    gold.push(tint(lg, 0xb88a38));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.5, cz), new THREE.Vector3(ca * 0.12, 1.47, cz + sa * 0.12), new THREE.Vector3(ca * 0.24, 1.52, cz + sa * 0.24),
        new THREE.Vector3(ca * 0.3, 1.6, cz + sa * 0.3),
      ]);
      gold.push(tint(ni(new THREE.TubeGeometry(curve, 8, 0.012, 5, false)), 0xa87a30));
      const pan = new THREE.CylinderGeometry(0.05, 0.03, 0.02, 10).translate(ca * 0.3, 1.61, cz + sa * 0.3);
      gold.push(tint(ni(pan), 0xc89a48));
      candle(ca * 0.3, 1.62, cz + sa * 0.3, 0.22);
    }
    candle(0, 1.61, cz, 0.3);
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
  // finer sculpt cells and the ray-marched heads (brow, nose, hair mass, ears)
  // the party portraits use, so the council read as people, not mannequins
  const person = (ch, x, z, ry, q = 0.018, o = {}) => {
    const f = buildMiniature({ race: 'human', ...ch }, { pose: o.pose ?? 'stand', mod: o.mod, base: false, gear: o.gear ?? false, quality: Math.min(q, 0.0108), faceSize: 256, noWeapon: o.noWeapon ?? true, noShield: o.noShield ?? true, rayHead: true, headGain: 0.75 });
    matteFigure(f, { dim: o.dim ?? 1, rim: o.rim ?? null, folds: o.folds ?? 1 });
    f.position.set(x, 0, z);
    f.rotation.y = ry;
    if (o.lean) f.rotation.z = o.lean;
    f.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    group.add(f);
    figures.push(f);
    if (o.pose !== 'sit') {
      const sh = contactShadow(0.42, 0.34);
      sh.position.set(x, 0.035, z);
      group.add(sh);
    }
    return f;
  };
  // councillors along both sides of the table and the First Councillor at its head
  const council = [
    { gender: 'male', classSpec: 'magicUser', look: { seed: 11, head: 7, body: 4, cloth: 5, hair: 9 } },
    { gender: 'female', classSpec: 'cleric', look: { seed: 12, head: 2, body: 7, cloth: 2, hair: 1 } },
    { gender: 'male', classSpec: 'cleric', look: { seed: 13, head: 2, body: 4, cloth: 4, hair: 0 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 14, head: 1, body: 4, cloth: 7, hair: 2 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 21, head: 3, body: 4, cloth: 6, hair: 8 } },
    { gender: 'female', classSpec: 'magicUser', look: { seed: 22, head: 4, body: 4, cloth: 5, hair: 3 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 23, head: 7, body: 4, cloth: 5, hair: 7 } },
    { gender: 'male', classSpec: 'magicUser', look: { seed: 24, head: 6, body: 4, cloth: 2, hair: 1 } },
  ];
  // high-backed council chairs (carved oak, red leather back, gilt finials);
  // seated councillors turned toward the adventurers at the foot of the table
  const SEAT = 0.2; // the dais under the chairs lifts the seated figures
  let chairNo = 0;
  const chair = (x, z, ry, tall = 1.55, w = 0.6) => {
    const csh = contactShadow(w * 0.95, 0.6, 0.9);
    csh.position.set(x, 0.035, z);
    csh.rotation.y = ry;
    group.add(csh);
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
    const put = (g, list, c) => list.push(tint(worldUV(g.applyMatrix4(m), 1), c));
    put(box(w + 0.1, 0.2, 0.75, { z: -0.08 }), wood, 0x3a2818); // footboard / dais
    put(box(w, 0.08, 0.52, { y: SEAT + 0.4, z: -0.02 }), wood, 0x5a3a22);
    put(box(w - 0.08, 0.05, 0.46, { y: SEAT + 0.48, z: -0.02 }), cloth, 0x4a100e);
    for (const sx of [-1, 1]) {
      put(box(0.07, SEAT + 0.42, 0.07, { x: sx * (w / 2 - 0.04), y: 0, z: 0.2 }), wood, 0x3a2618);
      put(box(0.08, SEAT + 0.42 + tall, 0.08, { x: sx * (w / 2 - 0.04), y: 0, z: -0.27 }), wood, 0x3a2618);
      put(box(0.06, 0.06, 0.48, { x: sx * (w / 2 - 0.02), y: SEAT + 0.72, z: -0.03 }), wood, 0x4a3020); // arm rest
      put(box(0.05, 0.28, 0.05, { x: sx * (w / 2 - 0.02), y: SEAT + 0.44, z: 0.19 }), wood, 0x3a2618);
      const fin = new THREE.ConeGeometry(0.045, 0.14, 8).translate(sx * (w / 2 - 0.04), SEAT + 0.49 + tall, -0.27);
      wood.push(tint(worldUV(fin.applyMatrix4(m), 1), 0x5a3a22));
    }
    // each chair its own: leather in oxblood, bottle green or dark tan, and a
    // carved crest (arched, gabled or a triple-finial cresting)
    const v = chairNo++;
    const leather = [0x3a0d0b, 0x10241a, 0x2e1a0e, 0x3a0d0b, 0x1a1428][v % 5];
    // buttoned (tufted) leather back: a pillowed panel whose diamonds swell
    // between deep-set buttons, so the candlelight models every cushion
    {
      const bw = w - 0.12, bh = tall - 0.16;
      const pg = new THREE.PlaneGeometry(bw, bh, 18, Math.round(18 * bh / bw));
      const pp = pg.attributes.position;
      const nx = 3, ny = Math.max(4, Math.round(bh / (bw / 3) * 1.15));
      for (let i = 0; i < pp.count; i++) {
        const u = pp.getX(i) / bw + 0.5, vv = pp.getY(i) / bh + 0.5;
        const a = Math.abs(((u * nx + vv * ny) % 1 + 1) % 1 - 0.5), b2 = Math.abs(((u * nx - vv * ny) % 1 + 1) % 1 - 0.5);
        const pill = Math.min(a, b2) * 2; // 0 at the creases, 1 mid-cushion
        const edge = Math.min(u, 1 - u, vv, 1 - vv);
        pp.setZ(i, 0.022 * Math.sqrt(pill) * Math.min(1, edge * 14));
      }
      pg.computeVertexNormals();
      pg.translate(0, SEAT + 0.56 + bh / 2, -0.238);
      put(pg, cloth, leather);
      for (let iy = 0; iy <= ny; iy++) for (let ix = 0; ix <= nx; ix++) {
        if ((ix + iy) % 2) continue;
        const bx2 = -bw / 2 + (ix / nx) * bw, by2 = SEAT + 0.56 + (iy / ny) * bh;
        if (ix === 0 || ix === nx || iy === 0 || iy === ny) continue;
        const st = new THREE.SphereGeometry(0.012, 6, 4).translate(bx2, by2, -0.236);
        gold.push(tint(ni(st.applyMatrix4(m)), 0x8a6a34));
      }
      put(box(w - 0.08, tall - 0.12, 0.03, { y: SEAT + 0.48, z: -0.275 }), wood, 0x2e1e12);
    }
    // carved oak frame round the back panel, brass nail heads along it
    put(box(w - 0.06, 0.06, 0.07, { y: SEAT + 0.48, z: -0.255 }), wood, 0x4a3020);
    for (const sx of [-1, 1]) put(box(0.05, tall - 0.12, 0.07, { x: sx * (w / 2 - 0.07), y: SEAT + 0.48, z: -0.255 }), wood, 0x4a3020);
    for (let k = 0; k < 9; k++) for (const sx of [-1, 1]) {
      const st = new THREE.SphereGeometry(0.01, 5, 3).translate(sx * (w / 2 - 0.115), SEAT + 0.6 + k * (tall - 0.3) / 8, -0.225);
      gold.push(tint(ni(st.applyMatrix4(m)), 0xc8a050));
    }
    // the crest rail: a carved, moulded cresting cut to one of three profiles
    {
      const cw = w + 0.04, ch = 0.2 + (v % 3) * 0.06;
      const sh = new THREE.Shape();
      sh.moveTo(-cw / 2, 0);
      sh.lineTo(cw / 2, 0);
      if (v % 3 === 0) { // arched with scrolled shoulders
        sh.lineTo(cw / 2, ch * 0.45);
        sh.quadraticCurveTo(cw * 0.36, ch * 0.5, cw * 0.3, ch * 0.62);
        sh.quadraticCurveTo(0, ch * 1.35, -cw * 0.3, ch * 0.62);
        sh.quadraticCurveTo(-cw * 0.36, ch * 0.5, -cw / 2, ch * 0.45);
      } else if (v % 3 === 1) { // gabled, with a stepped apex
        sh.lineTo(cw / 2, ch * 0.4);
        sh.lineTo(cw * 0.08, ch * 1.05); sh.lineTo(cw * 0.04, ch * 1.2); sh.lineTo(-cw * 0.04, ch * 1.2); sh.lineTo(-cw * 0.08, ch * 1.05);
        sh.lineTo(-cw / 2, ch * 0.4);
      } else { // a scalloped triple cresting
        sh.lineTo(cw / 2, ch * 0.5);
        for (let k = 2; k >= -2; k--) {
          const x0 = (k / 5) * cw, x1 = ((k - 1) / 5) * cw;
          sh.quadraticCurveTo((x0 + x1) / 2, ch * (k % 2 === 0 ? 1.25 : 0.95), x1 + (k === -2 ? 0 : 0), ch * 0.55);
        }
        sh.lineTo(-cw / 2, ch * 0.5);
      }
      sh.closePath();
      const cg = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 });
      cg.translate(0, SEAT + 0.42 + tall - 0.16, -0.305);
      put(cg, wood, 0x4e3420);
      // a carved boss (a rosette) on its face
      const ros = new THREE.CylinderGeometry(0.05, 0.06, 0.03, 10).rotateX(Math.PI / 2).translate(0, SEAT + 0.42 + tall - 0.16 + ch * 0.55, -0.22);
      wood.push(tint(worldUV(ros.applyMatrix4(m), 1), 0x6a4a28));
    }
  };
  const seated = (ch, x, z, ry, q = 0.016, o = {}) => {
    chair(x, z, ry);
    const f = person(ch, x, z, ry, q, { pose: 'sit', ...o });
    f.position.y = SEAT;
    return f;
  };
  [-3.2, -1.1, 1.1, 3.2].forEach((dz, i) => {
    // the nearer the councillor sits to the foot, the further they turn to look
    const turn = 0.5 + 0.12 * (dz + 3.2) / 6.4;
    // no two alike: one leans in to talk with a gesture, one rests both hands
    // on the board, one sits back listening with a hand on the knee, heads turned
    const L = ['warm', 'talkR', 'listen', 'warm'][i];
    const Rm = ['listen', 'warm', 'talkL', 'talkR'][i];
    if (i === 3) {
      // the two chairs nearest the foot stand empty, pushed back and turned
      // toward the newcomers: they frame the board without a figure filling
      // the lens
      chair(-1.86, tz + dz + 0.1, Math.PI / 2 - turn - 0.25);
      chair(1.86, tz + dz + 0.1, -Math.PI / 2 + turn + 0.25);
      return;
    }
    seated(council[i], -1.78, tz + dz, Math.PI / 2 - turn + (i % 2 ? 0.12 : -0.05), 0.016, { mod: L, lean: i % 2 ? 0.04 : -0.025, dim: 0.3, rim: 0x6a3212, folds: 1.3 });
    seated(council[i + 4], 1.78, tz + dz, -Math.PI / 2 + turn - (i % 2 ? 0.08 : -0.1), 0.016, { mod: Rm, lean: i % 2 ? -0.035 : 0.03, dim: 0.3, rim: 0x6a3212, folds: 1.3 });
  });
  // the First Councillor in the great chair at the head of the table
  chair(0, tz - tl / 2 - 0.85, 0, 2.1, 0.78);
  person({ gender: 'male', classSpec: 'cleric', look: { seed: 31, head: 2, body: 7, cloth: 0, hair: 7 } }, 0, tz - tl / 2 - 0.85, 0, 0.016, { pose: 'sit', dim: 0.32, rim: 0x7a3a14, folds: 1.3 }).position.y = SEAT;
  // the clerk at his lectern beside the foot of the table, turned to the
  // adventurers, quill raised over the open ledger as he takes their names
  // (at the head of the board beside the First Councillor's great chair, so
  // the foreground stays clear and the hall reads in one-point perspective)
  const lx = 1.55, lz = tz - tl / 2 - 0.35;
  const lry = -0.35; // lectern + clerk face the foot of the hall (toward camera)
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
  candle(lx + Math.cos(lry) * 0.42 + 0.05, 1.0, lz - Math.sin(lry) * 0.42 + 0.12, 0.14);
  const clerk = person({ gender: 'male', classSpec: 'magicUser', look: { seed: 41, head: 6, body: 4, cloth: 5, hair: 1 } }, lx - Math.sin(lry) * 0.62, lz - Math.cos(lry) * 0.62, lry, 0.014, { dim: 0.34, rim: 0x7a3c12 });
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
  // the adventurers stand just outside the lens at the foot of the table (the
  // camera is their point of view): kept for the shot's opening frames only
  // turned three-quarters toward the table so their faces and helms read in
  // profile against the candlelight (not featureless backs of heads)
  person({ gender: 'male', classSpec: 'fighter', look: { seed: 61, head: 0, body: 0, cloth: 1, hair: 2 } }, -3.35, 3.7, Math.PI - 1.0, 0.013, { noWeapon: false, noShield: true, mod: 'talkL', dim: 0.2, rim: 0x7a3c12 });
  person({ gender: 'female', classSpec: 'cleric', look: { seed: 62, head: 5, body: 5, cloth: 0, hair: 4 } }, 3.05, 3.9, Math.PI + 0.95, 0.013, { noWeapon: true, noShield: true, mod: 'talkR', dim: 0.2, rim: 0x7a3c12 });

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
  // the ashlar gets world-space weathering (patches of re-faced stone, damp
  // at the foot, candle-smoke streaks) so it never reads as one brick tiling
  add(stone, addRimLight(texMat('hd2_ashlar'), { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uRimColor: { value: new THREE.Color(0, 0, 0) } }, 0, { weather: 0.9, ground: -240, soot: 0.5 }));
  add(fine, texMat('hd_limestone'));
  add(wood, texMat('hd_beam_dark'));
  // the table top: waxed oak with a soft sheen that catches the candles
  add(polished, texMat('hd_beam_dark', { roughness: 0.55, roughnessMap: null, normalScale: new THREE.Vector2(0.12, 0.12) }));
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
    const mm = new THREE.MeshStandardMaterial({ map: mt.map, roughnessMap: mt.roughnessMap, vertexColors: true, roughness: 0.42, metalness: 0 });
    // world-space wear over the chequer: each slab its own tone, broad grime
    // and candle-smoke near the walls, polished lanes where feet go (they
    // mirror the candles), dull scuffed patches elsewhere
    mm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vFW;
          float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
          float ffbm(vec2 p) { return fn(p) * 0.5 + fn(p * 2.1) * 0.3 + fn(p * 4.3) * 0.2; }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 w = vFW.xz;
            float slab = fh(floor(w / 1.1) + 7.0);
            diffuseColor.rgb *= 0.82 + 0.3 * slab;
            float grime = smoothstep(0.45, 0.8, ffbm(w * 0.35)) * 0.4 + smoothstep(4.2, 6.8, abs(w.x)) * 0.35;
            diffuseColor.rgb *= 1.0 - grime;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.72, 0.62), smoothstep(0.5, 0.9, ffbm(w * 1.3 + 4.0)) * 0.5);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          {
            vec2 w = vFW.xz;
            float lane = 1.0 - smoothstep(1.4, 3.6, abs(w.x));
            float polish = smoothstep(0.35, 0.75, ffbm(w * 0.6 + 2.0));
            roughnessFactor = clamp(mix(roughnessFactor + 0.18, roughnessFactor * 0.45, max(lane * 0.6, polish * 0.7)), 0.12, 1.0);
          }`);
    };
    mm.customProgramCacheKey = () => 'chamber-floor-v2';
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
  texd(tapGeo, tapestryTexture(), { roughness: 1.0 });
  // the runner: deep red pile with a worn, flattened lane down its centre, a
  // woven border and a gilt-thread binding along both edges, lying 2 cm proud
  {
    const cg = new THREE.PlaneGeometry(2.4, D - 4, 1, 1);
    cg.rotateX(-Math.PI / 2);
    cg.translate(0, 0.022, 1);
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    cm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCW;
          float ch(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float cn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(ch(i), ch(i + vec2(1, 0)), f.x), mix(ch(i + vec2(0, 1)), ch(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 m = vec2(vCW.x + 1.2, vCW.z + ${((D - 4) / 2 - 1).toFixed(1)});
            float ex = min(m.x, 2.4 - m.x);
            // pile: fine tufts + a woven field of small lozenges
            float pile = 0.8 + 0.2 * cn(m * 140.0) + 0.08 * cn(m * 31.0);
            vec2 lz = abs(fract(vec2(m.x * 3.0 + m.y * 3.0, m.x * 3.0 - m.y * 3.0) * 0.5) - 0.5);
            float loz = smoothstep(0.42, 0.46, max(lz.x, lz.y));
            vec3 c = vec3(0.036, 0.009, 0.010) * pile;
            c = mix(c, vec3(0.028, 0.007, 0.008), loz * 0.5);
            // border band of indigo with a gold meander, then the gilt binding
            float border = step(ex, 0.26);
            float meander = step(0.5, fract(m.y * 4.0 + step(0.145, ex) * 0.5)) * step(0.09, ex) * step(ex, 0.2);
            c = mix(c, mix(vec3(0.02, 0.02, 0.05), vec3(0.2, 0.14, 0.05), meander), border * 0.9);
            c = mix(c, vec3(0.3, 0.21, 0.07) * (0.8 + 0.4 * cn(m * 60.0)), step(ex, 0.05));
            // the worn lane: flattened, faded, greyed pile where feet go
            float lane = (1.0 - smoothstep(0.25, 0.6, abs(m.x - 1.2))) * (0.6 + 0.4 * cn(m * vec2(2.0, 0.4)));
            c = mix(c, vec3(0.036, 0.018, 0.017) * (0.9 + 0.2 * cn(m * 90.0)), lane * 0.55);
            diffuseColor.rgb = c;
          }`);
    };
    cm.customProgramCacheKey = () => 'chamber-carpet-v1';
    disposables.push(cg, cm);
    group.add(new THREE.Mesh(cg, cm));
    for (const sx of [-1, 1]) cloth.push(tint(worldUV(ni(new THREE.BoxGeometry(0.04, 0.022, D - 4).translate(sx * 1.2, 0.011, 1)), 1), 0x6a4a18));
  }
  texd(bannerGeo, bannerTexture(), { roughness: 0.95 });
  texd(ledgerGeo, ledgerTexture(), { roughness: 0.9 });
  texd(paperGeo, paperTexture(), { roughness: 0.92 });
  texd(quillGeo, featherTexture(), { roughness: 0.8, alphaTest: 0.4 });
  const glassMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `varying vec3 vW;
      void main(){
        float y = clamp((vW.y + 240.0 - 2.4) / 5.2, 0.0, 1.0);
        vec3 c = mix(vec3(0.2, 0.26, 0.55), vec3(0.08, 0.12, 0.34), y);
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
  // the firebox: an ember bed and the glow thrown up the sooted back and
  // cheeks of the hearth (additive, breathing with the fire)
  const fireGlowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uT: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uT; varying vec2 vUv;
      void main(){
        vec2 d = (vUv - vec2(0.5, 0.05)) * vec2(1.6, 1.0);
        float k = exp(-dot(d, d) * 3.5);
        float fl = 0.85 + 0.15 * sin(uT * 7.0 + vUv.x * 5.0) * sin(uT * 3.1);
        gl_FragColor = vec4(vec3(1.0, 0.42, 0.12) * k * 0.9 * fl, 1.0);
      }`,
  });
  disposables.push(fireGlowMat);
  {
    const hz = -D / 2 + 1.03;
    const bg = new THREE.PlaneGeometry(2.9, 1.5);
    bg.translate(0, 1.37, hz);
    disposables.push(bg);
    const bm = new THREE.Mesh(bg, fireGlowMat);
    bm.renderOrder = 2;
    group.add(bm);
    const eg = new THREE.PlaneGeometry(1.6, 0.7);
    eg.rotateX(-Math.PI / 2);
    eg.translate(0, 0.64, hz + 0.3);
    disposables.push(eg);
    const em = new THREE.Mesh(eg, fireGlowMat);
    em.renderOrder = 2;
    group.add(em);
  }
  // candle halos: only a tight warm bead round each flame (the flame card itself
  // carries the shape), never a bloom ball
  const haloMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.3 });
  disposables.push(haloMat);
  const halos = [];
  flames.forEach((f, i) => {
    // the candelabra candles stand in a row down the lens: their beads would
    // stack into one glowing ball, so only the sconces and chandelier get one
    if (f.pos.y - CHAMBER_ORIGIN.y < 2.2) return;
    const s = new THREE.Sprite(haloMat);
    s.position.copy(f.pos).sub(CHAMBER_ORIGIN);
    s.position.y += 0.06;
    s.scale.setScalar(0.17);
    s.userData.seed = i * 1.37;
    group.add(s);
    halos.push(s);
  });
  // light falloff: each sconce washes its column and the wall behind it in a
  // warm pool that fades with distance, and the candelabra pool on the table
  const washMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2,
    uniforms: { uK: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uK; varying vec2 vUv;
      void main(){
        vec2 d = (vUv - vec2(0.5, 0.42)) * vec2(2.0, 1.6);
        float r2 = dot(d, d);
        float k = exp(-r2 * 3.2) * 0.75 + exp(-r2 * 14.0) * 0.5;
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.22) * k * 0.3 * uK, 1.0);
      }`,
  });
  disposables.push(washMat);
  const wash = (x, y, z, w, hh, ry, rx = 0) => {
    const g = new THREE.PlaneGeometry(w, hh);
    if (rx) g.rotateX(rx);
    g.rotateY(ry);
    g.translate(x, y, z);
    disposables.push(g);
    const m = new THREE.Mesh(g, washMat);
    m.renderOrder = 2;
    group.add(m);
  };
  for (const f of flames) {
    const p = f.pos.clone().sub(CHAMBER_ORIGIN);
    if (Math.abs(p.x) > W / 2 - 2.2 && p.y > 3) wash(Math.sign(p.x) * (W / 2 - 1.36), p.y + 0.1, p.z, 1.9, 2.6, -Math.sign(p.x) * Math.PI / 2);
  }
  for (const cz of [tz - 3, tz, tz + 3]) wash(0, 1.066, cz, 2.2, 2.8, 0, -Math.PI / 2);
  // warm candle pools + cool window fill
  const lights = [];
  for (const [x, y, z, I, d] of [[0, 3.1, tz - 2.5, 26, 12], [0, 3.3, tz + 2.6, 22, 12], [lx + 0.4, 2.6, lz + 0.9, 2.2, 4], [0, 5.2, tz, 24, 13]]) {
    const L = new THREE.PointLight(0xffa458, I * 1.25, d, 2.1);
    L.position.set(x, y, z);
    L.userData.base = I;
    group.add(L);
    lights.push(L);
  }
  // candle spill between the adventurers and the table (rims their shoulders and helms)
  // and a cool moonlit fill from the doors behind them, so plate and mail read from the back
  const advRim = new THREE.PointLight(0xffa458, 7, 7, 1.6);
  advRim.position.set(0, 1.9, 0.6);
  group.add(advRim);
  const advFill = new THREE.PointLight(0x8090e0, 6, 9, 1.4);
  advFill.position.set(0.2, 2.8, 5.4);
  group.add(advFill);
  const winFill = new THREE.PointLight(0x5a6ad0, 4, 18, 1.4);
  winFill.position.set(-5.5, 5, 4);
  group.add(winFill);
  // moonlight through the tall windows on both walls: cool shafts raking down
  // across the floor and the councillors' backs, against the warm candle core
  for (const sx of [-1, 1]) {
    const moon = new THREE.SpotLight(0x8a9ae0, 30, 20, 0.6, 1.0, 1.2);
    moon.position.set(sx * (W / 2 + 1.5), 6.2, tz + 1.5);
    moon.target.position.set(-sx * 1.2, 0.6, tz - 0.5);
    group.add(moon, moon.target);
  }
  // the moonlight made visible: a raking shaft from each tall window and the
  // window's light-cookie (arched panes, mullion and transom) laid on the floor
  {
    const cookieMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -3,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec2 vUv;
        void main(){
          vec2 u = vUv;
          // a soft pool of moonlight on the stone: the window's shape only as a
          // faint, blurred hint inside a broad falloff (never a hard bright quad)
          vec2 c = (u - vec2(0.5, 0.45)) * vec2(2.0, 1.5);
          float pool = exp(-dot(c, c) * 2.2);
          float mull = 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.06, abs(u.x - 0.5)));
          float tran = 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.05, abs(u.y - 0.55)));
          float k = pool * mull * tran;
          gl_FragColor = vec4(vec3(0.36, 0.46, 0.92) * k * 0.09, 1.0);
        }`,
    });
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec2 vUv;
        void main(){
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float fall = mix(0.35, 1.0, vUv.y) * smoothstep(0.0, 0.25, vUv.y);
          float mote = 0.85 + 0.15 * sin(vUv.y * 40.0 + vUv.x * 13.0);
          gl_FragColor = vec4(vec3(0.38, 0.46, 0.9) * edge * fall * mote * 0.07, 1.0);
        }`,
    });
    disposables.push(cookieMat, shaftMat);
    for (const sx of [-1, 1]) {
      for (const wz of [tz - 2.5, tz + 1.5, tz + 5.5]) {
        // the window sits high in the side wall; the moon is high on that side
        const ck = new THREE.PlaneGeometry(2.2, 3.6);
        ck.rotateX(-Math.PI / 2);
        ck.rotateY(sx * 0.18);
        ck.translate(sx * (W / 2 - 3.3), 0.02, wz + 0.3);
        disposables.push(ck);
        const cm = new THREE.Mesh(ck, cookieMat);
        cm.renderOrder = 2;
        group.add(cm);
        // shaft: a quad from the window opening down to the cookie
        const sg = new THREE.BufferGeometry();
        const x0 = sx * (W / 2 - 0.05), x1 = sx * (W / 2 - 3.3);
        const y0 = 6.4, y1 = 0.02;
        const v = new Float32Array([x0, y0, wz - 0.55, x0, y0, wz + 0.55, x1, y1, wz - 0.4, x1, y1, wz + 1.0]);
        sg.setAttribute('position', new THREE.BufferAttribute(v, 3));
        sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
        sg.setIndex([0, 2, 1, 1, 2, 3]);
        disposables.push(sg);
        const sm = new THREE.Mesh(sg, shaftMat);
        sm.renderOrder = 3;
        group.add(sm);
      }
    }
  }
  const hearth = new THREE.PointLight(0xff7a30, 10, 11, 1.5);
  hearth.position.set(0, 1.4, -D / 2 + 1.6);
  group.add(hearth);

  return {
    group,
    lights,
    /** World-space table centre (for camera keys). */
    table: new THREE.Vector3(0, 1, tz).add(CHAMBER_ORIGIN),
    update(t) {
      for (const s of halos) s.scale.setScalar(0.5 * (0.9 + 0.1 * Math.sin(t * 9 + s.userData.seed)));
      lights.forEach((L, i) => { L.intensity = L.userData.base * (0.92 + 0.08 * Math.sin(t * 7.3 + i * 2.1)); });
      hearth.intensity = 26 * (0.85 + 0.15 * Math.sin(t * 5.1) * Math.sin(t * 2.3));
      fireGlowMat.uniforms.uT.value = t;
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      for (const f of figures) f.userData.dispose?.();
      flameMesh.geometry.dispose();
    },
  };
}
