import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Phlan's ruins round the encampment, built as masonry rather than cut-outs:
 * walls laid course by course from individual dressed blocks (two leaves
 * thick, the broken tops stepping down where the courses fell), rubble heaped
 * at their feet, a charred roof beam fallen against one of them, ivy climbing
 * the faces, and beyond them two layers of ruined buildings — broken gables,
 * gutted towers, roofless halls — fading into the night fog.
 *
 * buildRuins(root, {G, Mt, night, stoneMat}) adds everything to root.
 */

const hr = (i, s = 0) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A canvas leaf sprite for the ivy (lobed leaf, darker veins, alpha cut-out). */
function ivyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 34);
  for (let k = 0; k < 3; k++) {
    g.save();
    g.rotate((k - 1) * 0.9);
    g.beginPath();
    g.ellipse(0, -12, 9, 15, 0, 0, Math.PI * 2);
    g.fillStyle = k === 1 ? '#3f5a2a' : '#34502a';
    g.fill();
    g.restore();
  }
  g.strokeStyle = 'rgba(20,30,12,0.6)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.sin((k - 1) * 0.9) * 22, -Math.cos((k - 1) * 0.9) * 22);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Lay a broken wall of blocks along +x from the origin (local frame), w long, up to h high, d thick.
 * Returns block transforms + colours, the top profile (for ivy/rubble), and the rubble it shed.
 */
function layWall(w, h, d, seed) {
  const blocks = [];
  const courseH = 0.34;
  const courses = Math.ceil(h / courseH);
  // Broken top: a profile of surviving course counts along the wall, ragged and stepping down.
  const prof = (x) => {
    const u = x / w;
    const big = 0.62 + 0.38 * Math.sin(u * 2.4 + seed) * Math.sin(u * 1.3 + seed * 0.7 + 1.2);
    const edge = Math.min(1, u * 5, (1 - u) * 3.5);
    return Math.max(1, Math.round(courses * Math.max(0.3, big) * (0.6 + 0.4 * edge) + (hr(Math.floor(x * 2), seed) - 0.5) * 1.6));
  };
  for (let c = 0; c < courses; c++) {
    let x = (c % 2) * 0.28 - 0.1 * hr(c, seed);
    let i = 0;
    while (x < w) {
      const len = 0.42 + hr(c * 31 + i, seed + 1) * 0.42;
      const cx = x + len / 2;
      if (cx > 0 && cx < w && c < prof(cx)) {
        // the top course of a broken stretch loses blocks at random; the rest sit slightly askew
        const top = c === prof(cx) - 1;
        if (!(top && hr(c * 7 + i, seed + 5) < 0.25)) {
          for (let leaf = 0; leaf < 2; leaf++) {
            const dz = (leaf - 0.5) * d * 0.5;
            const tone = 0.62 + hr(c * 13 + i * 3 + leaf, seed + 2) * 0.38;
            const damp = Math.max(0, 1 - c / 3) * 0.25;
            blocks.push({
              p: [cx + (hr(i, c + seed) - 0.5) * 0.03, c * courseH + courseH / 2 + (hr(i + 9, c) - 0.5) * 0.02, dz],
              s: [len - 0.035, courseH - 0.03, d * 0.5 - 0.03],
              r: [(hr(i, c + 3) - 0.5) * (top ? 0.12 : 0.03), (hr(i, c + 4) - 0.5) * (top ? 0.18 : 0.04), (hr(i, c + 5) - 0.5) * (top ? 0.1 : 0.02)],
              col: [tone * (1 - damp) * 1.02, tone * (1 - damp * 0.7), tone * (1 - damp * 0.9) * 0.94],
            });
          }
        }
      }
      x += len;
      i++;
    }
  }
  return { blocks, prof, courseH };
}

/**
 * @param {THREE.Group} root
 * @param {{G: Function, Mt: Function, night: number, stoneMat: THREE.Material, beamMat?: THREE.Material}} o
 */
export function buildRuins(root, { G, Mt, night, stoneMat, beamMat }) {
  const group = new THREE.Group();
  root.add(group);
  const WALLS = [
    // x, z, rotY, length, height
    [-6.4, -4.8, 0.45, 4.6, 3.4], [-1.9, -7.8, 0.06, 4.4, 2.7], [5.4, -5.8, -0.55, 3.8, 2.5], [8.3, -1.8, -1.25, 3.0, 1.9], [-8.8, -0.6, 1.3, 3.2, 2.3],
  ];
  const all = [];
  const rubble = [];
  const ivy = [];
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  WALLS.forEach(([x, z, ry, w, hgt], wi) => {
    const d = 0.62;
    const { blocks, prof, courseH } = layWall(w, hgt, d, wi * 5 + 1);
    const frame = new THREE.Matrix4().compose(
      new THREE.Vector3(x - Math.cos(ry) * w / 2, 0, z + Math.sin(ry) * w / 2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    for (const b of blocks) all.push({ ...b, frame });
    // rubble shed at the foot of the lowest stretches, on both faces
    const nr = Math.round(w * 9);
    for (let k = 0; k < nr; k++) {
      const u = hr(k, wi + 20);
      const lx = u * w;
      const lost = Math.max(0, Math.round(hgt / courseH) - prof(lx));
      if (hr(k, wi + 21) > 0.25 + lost * 0.12) continue;
      const side = hr(k, wi + 22) > 0.4 ? 1 : -1;
      const out = 0.35 + hr(k, wi + 23) ** 1.6 * 1.3;
      const s = 0.12 + hr(k, wi + 24) * 0.22;
      const heap = Math.max(0, 0.35 - out * 0.2) * hr(k, wi + 25);
      rubble.push({
        p: [lx + (hr(k, wi + 26) - 0.5) * 0.4, s * 0.35 + heap, side * out],
        s: [s * (1 + hr(k, wi + 27)), s * 0.8, s * (0.8 + hr(k, wi + 28) * 0.6)],
        r: [hr(k, wi + 29) * 3, hr(k, wi + 30) * 3, hr(k, wi + 31) * 3],
        col: [0.55 + hr(k, 2) * 0.3, 0.53 + hr(k, 2) * 0.28, 0.5 + hr(k, 2) * 0.26],
        frame,
      });
    }
    // ivy: patches climbing from the foot of the wall up its faces
    const patches = 2 + Math.floor(hr(wi, 40) * 3);
    for (let pi = 0; pi < patches; pi++) {
      const px = (0.15 + hr(pi, wi + 41) * 0.7) * w;
      const top = prof(px) * courseH;
      const side = hr(pi, wi + 42) > 0.35 ? 1 : -1;
      const n = 60 + Math.floor(hr(pi, wi + 43) * 60);
      for (let k = 0; k < n; k++) {
        const t = hr(k, pi * 7 + wi) ** 0.7;
        const spread = 0.25 + (1 - t) * 0.5;
        const lx = Math.min(w - 0.1, Math.max(0.1, px + (hr(k, pi + 51) - 0.5) * spread * 2));
        const y = t * Math.min(top, prof(lx) * courseH - 0.08) * (0.6 + 0.4 * hr(k, pi + 50));
        if (y < 0) continue;
        ivy.push({
          p: [lx + Math.sin(y * 3 + pi) * 0.08, y + 0.05, side * (d / 2 + 0.015 + hr(k, pi + 52) * 0.03)],
          rz: hr(k, pi + 53) * 6.28,
          s: 0.1 + hr(k, pi + 54) * 0.09,
          side,
          frame,
        });
      }
    }
  });
  // ---- blocks (instanced, bevelled so the arrises catch the moon)
  const blockGeo = G(new RoundedBoxGeometry(1, 1, 1, 2, 0.06));
  const blockMat = Mt(stoneMat.clone());
  const inst = new THREE.InstancedMesh(blockGeo, blockMat, all.length + rubble.length);
  const col = new THREE.Color();
  [...all, ...rubble].forEach((b, i) => {
    tmpQ.setFromEuler(tmpE.set(b.r[0], b.r[1], b.r[2]));
    tmpM.compose(new THREE.Vector3(...b.p), tmpQ, new THREE.Vector3(...b.s));
    tmpM.premultiply(b.frame);
    inst.setMatrixAt(i, tmpM);
    col.setRGB(b.col[0], b.col[1], b.col[2]);
    inst.setColorAt(i, col);
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  group.add(inst);
  // ---- ivy (instanced leaf cards)
  if (ivy.length) {
    const it = ivyTexture();
    const leafMat = Mt(new THREE.MeshStandardMaterial({ map: it, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: night ? 0x7a8a70 : 0xb0c0a0 }));
    leafMat.userData.tex = it;
    const leaves = new THREE.InstancedMesh(G(new THREE.PlaneGeometry(1, 1)), leafMat, ivy.length);
    ivy.forEach((l, i) => {
      tmpQ.setFromEuler(tmpE.set(0, l.side > 0 ? 0 : Math.PI, l.rz));
      tmpM.compose(new THREE.Vector3(...l.p), tmpQ, new THREE.Vector3(l.s, l.s, l.s));
      tmpM.premultiply(l.frame);
      leaves.setMatrixAt(i, tmpM);
      const k = 0.6 + hr(i, 77) * 0.5;
      leaves.setColorAt(i, col.setRGB(k, k * (0.95 + hr(i, 78) * 0.1), k * 0.85));
    });
    leaves.receiveShadow = true;
    group.add(leaves);
  }
  // ---- a charred roof beam fallen against the near-left wall, its end in the rubble
  {
    const beamGeo = G(new RoundedBoxGeometry(0.24, 0.22, 3.4, 2, 0.04));
    const p = beamGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const zz = p.getZ(i);
      // the burnt end is eaten away and split
      const burnt = Math.max(0, zz - 1.2) / 0.5;
      p.setX(i, p.getX(i) * (1 - 0.35 * Math.min(1, burnt)) + Math.sin(zz * 9) * 0.006);
      p.setY(i, p.getY(i) * (1 - 0.3 * Math.min(1, burnt)));
    }
    beamGeo.computeVertexNormals();
    const bm = beamMat ?? Mt(new THREE.MeshStandardMaterial({ color: 0x2a1e16, roughness: 0.95 }));
    const beam = new THREE.Mesh(beamGeo, bm);
    beam.position.set(-4.6, 1.05, -4.3);
    beam.rotation.set(0.62, 0.95, 0.12);
    beam.castShadow = true;
    beam.receiveShadow = true;
    group.add(beam);
    const beam2 = new THREE.Mesh(beamGeo, bm);
    beam2.position.set(4.1, 0.16, -6.4);
    beam2.rotation.set(Math.PI / 2 - 0.05, 0, 1.2);
    beam2.scale.set(0.9, 0.9, 0.7);
    beam2.castShadow = true;
    group.add(beam2);
  }
  // ---- the ruined city beyond: two layers of broken buildings in the fog
  const cityLayer = (z, colHex, seed, scaleH, alpha) => {
    const shape = new THREE.Shape();
    let x = -70;
    shape.moveTo(x, -1);
    let k = 0;
    while (x < 70) {
      const w = 1.8 + hr(k, seed) * 3.2;
      const hh = (2.5 + hr(k, seed + 1) * 4.5) * scaleH;
      const kind = hr(k, seed + 2);
      shape.lineTo(x, hh * (0.6 + 0.4 * hr(k, seed + 9)));
      if (kind < 0.3) {
        // a broken gable: one rake survives, the other bitten off
        shape.lineTo(x + w * 0.1, hh);
        shape.lineTo(x + w * 0.42, hh + 1.1 * scaleH);
        shape.lineTo(x + w * 0.56, hh + 0.55 * scaleH);
        shape.lineTo(x + w * 0.62, hh + 0.75 * scaleH);
        shape.lineTo(x + w * 0.78, hh * 0.7);
      } else if (kind < 0.5) {
        // a gutted tower with a crenellated, broken top
        const tw = Math.min(w, 2.2);
        const th = hh + (3 + hr(k, seed + 3) * 4) * scaleH;
        shape.lineTo(x + 0.2, th);
        for (let m = 0; m < 3; m++) {
          shape.lineTo(x + 0.2 + (m + 0.4) * tw / 3.4, th);
          shape.lineTo(x + 0.2 + (m + 0.4) * tw / 3.4, th - 0.35 * scaleH);
          shape.lineTo(x + 0.2 + (m + 0.9) * tw / 3.4, th - 0.35 * scaleH - (m === 2 ? 1.2 : 0));
          shape.lineTo(x + 0.2 + (m + 0.9) * tw / 3.4, th - (m === 2 ? 1.2 : 0));
        }
        shape.lineTo(x + tw, hh * 0.8);
      } else {
        // a roofless hall: the wall top ragged, stepping down
        const n = 4 + Math.floor(hr(k, seed + 4) * 4);
        for (let m = 0; m <= n; m++) shape.lineTo(x + (m / n) * w, hh * (0.75 + 0.25 * hr(m + k * 9, seed + 5)) - (m === n ? hh * 0.3 : 0));
      }
      x += w;
      k++;
    }
    shape.lineTo(70, -1);
    const m = new THREE.Mesh(G(new THREE.ShapeGeometry(shape)), Mt(new THREE.MeshBasicMaterial({ color: colHex, fog: true, transparent: alpha < 1, opacity: alpha })));
    m.position.set(0, 0, z);
    group.add(m);
  };
  cityLayer(-40, night ? 0x0d1428 : 0x6a7890, 61, 1.25, 1);
  cityLayer(-27, night ? 0x0a0f1e : 0x5a6474, 71, 0.85, 1);
  return group;
}
