import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { masonryGeometry, masonryMaterial, wallBlocks } from './masonry.js';

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
 * A distant silhouette layer: its own colour above, sinking into the valley haze below; a faint
 * moonlit edge along the skyline and a soft stone/forest texture so it is not a flat cut-out.
 */
function layerMaterial(topHex, hazeHex, hazeH, alpha = 1, mountain = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(topHex) }, uHaze: { value: new THREE.Color(hazeHex) }, uH: { value: hazeH }, uA: { value: alpha }, uM: { value: mountain ? 1 : 0 } },
    vertexShader: `attribute float aTop; varying vec3 vW; varying vec2 vL; varying float vTop; void main() { vL = position.xy; vTop = aTop; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHaze; uniform float uH; uniform float uA; uniform float uM; varying vec3 vW; varying vec2 vL; varying float vTop;
      float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float hz = 1.0 - smoothstep(0.0, uH, vL.y);
        // gullies and scree on the mountains, coursing on the buildings
        float tex = uM > 0.5 ? n2(vec2(vL.x * 0.35 + vL.y * 0.2, vL.y * 0.9)) * 0.6 + n2(vL * 1.7) * 0.4 : n2(vL * vec2(1.2, 3.0));
        vec3 c = uTop * (0.82 + 0.3 * tex);
        c = mix(c, uHaze, hz * 0.85);
        // the moon catches the ridge line; gullies run down from it
        if (uM > 0.5) {
          float below = vTop - vL.y;
          c += uTop * 0.9 * exp(-below * 2.2) * (0.6 + 0.4 * n2(vec2(vL.x * 0.8, 0.0)));
          c *= 0.85 + 0.25 * smoothstep(0.3, 0.7, n2(vec2(vL.x * 0.6 + below * 0.15, below * 0.05)));
        }
        gl_FragColor = vec4(c, uA);
        #include <colorspace_fragment>
      }`,
    transparent: alpha < 1,
    depthWrite: true,
  });
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
    const { blocks, prof, courseH } = wallBlocks(w, hgt, d, wi * 5 + 1, { soot: wi % 2 ? 0.7 : 0.25, moss: 0.4 + (wi % 3) * 0.25 });
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
        col: [0.62 + hr(k, 2) * 0.3, 0.6 + hr(k, 2) * 0.28, 0.56 + hr(k, 2) * 0.26],
        dmg: 1,
        moss: 0.8,
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
  // ---- blocks: one merged mesh of chipped, individually toned stones over their mortar beds
  const masonry = new THREE.Mesh(G(masonryGeometry([...all, ...rubble])), masonryMaterial(night));
  masonry.castShadow = true;
  masonry.receiveShadow = true;
  group.add(masonry);
  const col = new THREE.Color();
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
    // the burnt city: blocky gutted houses and towers with crisp verticals, empty window holes the
    // night shows through, broken gables and crenels, alleys of mist between them
    const geos = [];
    let x = -72;
    let k = 0;
    while (x < 72) {
      const w = (2.2 + hr(k, seed) * 3.4) * Math.max(0.8, scaleH);
      const kind = hr(k, seed + 2);
      const tower = kind > 0.82;
      const bw = tower ? Math.min(w, 2.4) : w;
      const hh = (tower ? 7 + hr(k, seed + 3) * 5 : 3 + hr(k, seed + 1) * 4) * scaleH;
      const sh = new THREE.Shape();
      sh.moveTo(x, -1);
      sh.lineTo(x + bw, -1);
      if (tower) {
        // crenellated top, one corner fallen
        const nM = 4;
        sh.lineTo(x + bw, hh - (hr(k, seed + 4) < 0.5 ? 1.6 * scaleH : 0));
        for (let m = nM - 1; m >= 0; m--) {
          const x0 = x + (m / nM) * bw, x1 = x + ((m + 0.55) / nM) * bw;
          sh.lineTo(x1 + bw * 0.45 / nM, hh - 0.5 * scaleH);
          sh.lineTo(x1, hh - 0.5 * scaleH);
          sh.lineTo(x1, hh);
          sh.lineTo(x0, hh);
        }
      } else if (kind < 0.4) {
        // a gable end with its roof burnt away: one rake survives, bitten off near the ridge
        sh.lineTo(x + bw, hh);
        sh.lineTo(x + bw * 0.62, hh + bw * 0.32);
        sh.lineTo(x + bw * 0.55, hh + bw * 0.22);
        sh.lineTo(x + bw * 0.42, hh + bw * 0.3);
        sh.lineTo(x, hh);
      } else {
        // a roofless shell: the wall top broken in steps
        const n = 3 + Math.floor(hr(k, seed + 4) * 3);
        sh.lineTo(x + bw, hh * (0.7 + 0.3 * hr(k, seed + 6)));
        for (let m = n; m >= 0; m--) {
          const xx = x + (m / n) * bw;
          const yy = hh * (0.62 + 0.38 * hr(m + k * 9, seed + 5));
          sh.lineTo(xx, yy);
          if (m > 0) sh.lineTo(xx, hh * (0.62 + 0.38 * hr(m - 1 + k * 9, seed + 5)));
        }
      }
      sh.lineTo(x, -1);
      // window holes, two or three storeys of them, some blown out wider
      const rows = Math.max(1, Math.floor((hh - 1.5 * scaleH) / (2.2 * scaleH)));
      const cols = Math.max(1, Math.floor(bw / 1.3));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (hr(k * 31 + r * 7 + c, seed + 8) < 0.35) continue;
          const wx = x + (c + 0.5) * (bw / cols), wy = 1.4 * scaleH + r * 2.2 * scaleH;
          const ww = 0.42 * scaleH * (hr(k + c, seed + 9) < 0.2 ? 1.8 : 1), wh = 0.95 * scaleH;
          if (wy + wh > hh * 0.6) continue;
          const hole = new THREE.Path();
          hole.moveTo(wx - ww / 2, wy);
          hole.lineTo(wx + ww / 2, wy);
          hole.lineTo(wx + ww / 2, wy + wh * 0.8);
          hole.quadraticCurveTo(wx, wy + wh * 1.1, wx - ww / 2, wy + wh * 0.8);
          hole.lineTo(wx - ww / 2, wy);
          sh.holes.push(hole);
        }
      }
      geos.push(new THREE.ShapeGeometry(sh));
      x += bw + (hr(k, seed + 7) < 0.35 ? 0.6 + hr(k, seed + 10) * 2 : 0);
      k++;
    }
    const m = new THREE.Mesh(G(mergeGeometries(geos)), Mt(layerMaterial(colHex, haze, 3.2 * scaleH, alpha)));
    for (const gg of geos) gg.dispose();
    m.position.set(0, 0, z);
    m.renderOrder = -1;
    group.add(m);
  };
  const haze = night ? 0x24304e : 0x8a98b0;
  // mountains beyond the city: three ridges stepping back into the haze, each paler than the last
  const ridge = (z, hgt, seed, top, k) => {
    // a strip: ridge line above, valley below; each vertex knows the ridge height over it (aTop)
    const pos = [], topA = [], idx = [];
    const NX = 200;
    for (let i = 0; i <= NX; i++) {
      const x = -170 + (i / NX) * 340;
      const u = x / 40;
      const hh = Math.max(0.5, hgt * (0.45 + 0.55 * Math.abs(Math.sin(u * 0.9 + seed)) * (0.6 + 0.4 * Math.sin(u * 2.3 + seed * 2)))
        + hgt * 0.18 * Math.sin(u * 5.1 + seed * 3) * Math.sin(u * 1.7) + hgt * 0.06 * Math.sin(u * 13 + seed) + hgt * 0.025 * Math.sin(u * 31 + seed * 5));
      pos.push(x, hh, 0, x, -2, 0);
      topA.push(hh, hh);
      if (i < NX) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aTop', new THREE.Float32BufferAttribute(topA, 1));
    geo.setIndex(idx);
    const m = new THREE.Mesh(G(geo), Mt(layerMaterial(top, haze, hgt * k, 1, true)));
    m.position.set(0, -1, z);
    m.renderOrder = -2;
    group.add(m);
  };
  ridge(-150, 62, 1.3, night ? 0x1c2546 : 0x8090a8, 0.75);
  ridge(-105, 38, 4.1, night ? 0x151c38 : 0x6c7c94, 0.7);
  ridge(-72, 21, 2.2, night ? 0x10162c : 0x5a687e, 0.65);
  cityLayer(-40, night ? 0x0d1428 : 0x6a7890, 61, 1.25, 1);
  cityLayer(-27, night ? 0x0a0f1e : 0x5a6474, 71, 0.85, 1);
  return group;
}
