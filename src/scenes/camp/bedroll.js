import * as THREE from 'three';
import { resolveAppearance } from '../../ui/components/lookData.js';
import { createHead } from '../../ui/components/headShader.js';

/**
 * A sleeper in a bedroll, built to read at camp distance: a padded wool mat,
 * a rolled cloak for a pillow, a blanket draped over a body (shoulders,
 * hips, knees and feet push it up; it falls in folds to the mat), an arm
 * resting on top, and the sleeper's own ray-marched head (eyes closed) on
 * the pillow. Poses: 'back' (on the back), 'side' (on the side, knees drawn
 * up) and 'curled' (tightly curled against the cold).
 *
 * Local frame: the head end toward −z, the feet toward +z (point +z at the
 * fire), the mat on y = 0.
 */

const RACE_HS = { human: 1, elf: 0.957, halfElf: 0.983, dwarf: 1.026, gnome: 0.94, halfling: 0.897 };
const RACE_LEN = { human: 1, elf: 0.95, halfElf: 0.98, dwarf: 0.78, gnome: 0.62, halfling: 0.6 };

const hash = (i, s) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

let grain = null;
function grainCanvas() {
  if (grain) return grain;
  const S = 128;
  grain = document.createElement('canvas');
  grain.width = grain.height = S;
  const g = grain.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = Math.min(255, 255 * ((x + y) % 2 ? 0.86 : 1) * (0.86 + 0.14 * hash(x * 13 + y, 3)));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return grain;
}

let woolCache = new Map();
/** Woven wool with a plaid stripe in the blanket colour (canvas, cached by colour). */
function woolTexture(hex) {
  if (woolCache.has(hex)) return woolCache.get(hex);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const base = new THREE.Color(hex);
  const css = (col, k = 1) => `rgb(${Math.round(Math.min(1, col.r * k) * 255)},${Math.round(Math.min(1, col.g * k) * 255)},${Math.round(Math.min(1, col.b * k) * 255)})`;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);
  // Plaid: broad dark bands, thin light stripes.
  g.globalAlpha = 0.35;
  g.fillStyle = css(base, 0.55);
  g.fillRect(0, 20, S, 22);
  g.fillRect(20, 0, 22, S);
  g.globalAlpha = 0.5;
  g.fillStyle = css(base.clone().lerp(new THREE.Color(0xd8c8a0), 0.6));
  g.fillRect(0, 70, S, 3);
  g.fillRect(70, 0, 3, S);
  // Weave grain: one shared greyscale canvas multiplied over the colour.
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'multiply';
  g.drawImage(grainCanvas(), 0, 0);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  t.anisotropy = 4;
  woolCache.set(hex, t);
  if (woolCache.size > 12) woolCache = new Map([...woolCache].slice(-8));
  return t;
}

/** Body bumps (ellipsoids: x, z, half-width, half-length, height) per pose, in metres for a 1.78 m human. */
function bodyBumps(pose) {
  if (pose === 'side') {
    // On the side, facing +x: a high narrow ridge of shoulder and hip, knees drawn forward.
    return [
      [0.0, -0.5, 0.14, 0.13, 0.27], // shoulder
      [0.02, -0.28, 0.13, 0.2, 0.22], // ribs
      [0.0, 0.0, 0.15, 0.14, 0.29], // hip
      [0.13, 0.2, 0.12, 0.16, 0.2], // thighs forward
      [0.2, 0.36, 0.1, 0.1, 0.17], // knees
      [0.06, 0.55, 0.09, 0.16, 0.13], // shins back
      [0.02, 0.7, 0.08, 0.07, 0.12], // feet
    ];
  }
  if (pose === 'curled') {
    return [
      [0.0, -0.46, 0.15, 0.13, 0.26],
      [0.04, -0.22, 0.16, 0.18, 0.26],
      [0.02, 0.02, 0.16, 0.14, 0.3],
      [0.18, -0.06, 0.13, 0.16, 0.24], // knees up near the chest
      [0.12, 0.22, 0.12, 0.12, 0.16],
      [0.0, 0.3, 0.09, 0.08, 0.12],
    ];
  }
  // On the back: chest, belly, hips, two legs, feet up.
  return [
    [0.0, -0.46, 0.22, 0.14, 0.2], // chest + shoulders
    [0.0, -0.22, 0.19, 0.17, 0.17], // belly
    [0.0, 0.02, 0.2, 0.12, 0.16], // hips
    [-0.1, 0.32, 0.08, 0.28, 0.12], [0.1, 0.32, 0.08, 0.28, 0.12], // legs
    [-0.11, 0.72, 0.06, 0.06, 0.17], [0.11, 0.72, 0.06, 0.06, 0.17], // toes up
  ];
}

/**
 * @param {object} ch  character
 * @param {{pose?: 'back'|'side'|'curled', blanket?: string, mat?: string, seed?: number}} [o]
 * @returns {THREE.Group & {userData: {update:(t:number)=>void, dispose:()=>void}}}
 */
export function buildBedroll(ch, o = {}) {
  const app = resolveAppearance(ch, { gear: true });
  const pose = o.pose ?? 'back';
  const seed = o.seed ?? 1;
  const L = RACE_LEN[app.race] ?? 1;
  const hs = (RACE_HS[app.race] ?? 1) * (app.fem ? 0.97 : 1);
  const root = new THREE.Group();
  const disposables = [];
  const D = (x) => (disposables.push(x), x);

  // ---- the mat: a padded wool roll unrolled, rounded edges, slightly wider at the shoulders.
  const matLen = 1.95 * Math.max(0.72, L);
  const matW = 0.78;
  const matGeo = D(new THREE.BoxGeometry(matW, 0.05, matLen, 10, 2, 24));
  {
    const p = matGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ex = Math.abs(x) / (matW / 2);
      const ez = Math.abs(z) / (matLen / 2);
      const round = Math.max(0, Math.max(ex, ez) - 0.86) / 0.14;
      p.setY(i, y > 0 ? y - round * round * 0.04 + 0.006 * Math.sin(z * 9 + x * 4) : y);
      p.setX(i, x * (1 + 0.05 * Math.cos(z * 1.4)));
    }
    matGeo.computeVertexNormals();
  }
  const matCol = new THREE.Color(o.mat ?? '#4a3a2a');
  const matMat = D(new THREE.MeshStandardMaterial({ color: matCol, roughness: 1, map: woolTexture(`#${matCol.getHexString()}`) }));
  const mat = new THREE.Mesh(matGeo, matMat);
  mat.position.y = 0.025;
  mat.receiveShadow = true;
  mat.castShadow = true;
  root.add(mat);
  const top = 0.05;

  // ---- the pillow: a rolled cloak at the head end.
  const headZ = -matLen / 2 + 0.2;
  const rollGeo = D(new THREE.CylinderGeometry(0.075, 0.08, 0.5, 18, 1));
  const cloakCol = new THREE.Color(app.clothHex).multiplyScalar(0.8);
  const cloakMat = D(new THREE.MeshStandardMaterial({ color: cloakCol, roughness: 0.95, map: woolTexture(`#${cloakCol.getHexString()}`) }));
  const roll = new THREE.Mesh(rollGeo, cloakMat);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, top + 0.07, headZ - 0.04);
  roll.castShadow = true;
  roll.receiveShadow = true;
  root.add(roll);
  // Spiral ends of the roll.
  const endGeo = D(new THREE.TorusGeometry(0.045, 0.02, 6, 16));
  for (const sg of [-1, 1]) {
    const e = new THREE.Mesh(endGeo, cloakMat);
    e.rotation.y = Math.PI / 2;
    e.position.set(sg * 0.25, top + 0.07, headZ - 0.04);
    root.add(e);
  }

  // ---- the blanket: a cloth grid draped over the body bumps.
  const bumps = bodyBumps(pose).map(([x, z, w, l, hgt]) => [x * Math.max(0.8, L), z * L, w * Math.max(0.75, L ** 0.5), l * L, hgt * Math.max(0.7, L ** 0.6)]);
  const bW = 1.02;
  const bL = (pose === 'back' ? 1.55 : 1.4) * L;
  const NX = 34;
  const NZ = 56;
  const z0 = headZ + 0.16 * L; // blanket edge under the chin
  const bodyH = (x, z) => {
    let hgt = 0;
    for (const [bx, bz, w, l, hh] of bumps) {
      const d = ((x - bx) / w) ** 2 + ((z - bz) / l) ** 2;
      if (d < 1) hgt = Math.max(hgt, hh * Math.sqrt(1 - d));
    }
    return hgt;
  };
  const grid = new Float32Array((NX + 1) * (NZ + 1));
  const gx = (i) => -bW / 2 + (i / NX) * bW;
  const gz = (j) => z0 + (j / NZ) * bL;
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) grid[j * (NX + 1) + i] = bodyH(gx(i), gz(j));
  // Drape: cloth spans from each high point down a limited slope (a distance-field dilation).
  const cell = bW / NX;
  const slope = 0.62 * cell;
  for (let pass = 0; pass < 30; pass++) {
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const k = j * (NX + 1) + i;
        let v = grid[k];
        if (i > 0) v = Math.max(v, grid[k - 1] - slope);
        if (i < NX) v = Math.max(v, grid[k + 1] - slope);
        if (j > 0) v = Math.max(v, grid[k - NX - 1] - slope);
        if (j < NZ) v = Math.max(v, grid[k + NX + 1] - slope);
        grid[k] = v;
      }
    }
  }
  const blanketGeo = D(new THREE.PlaneGeometry(bW, bL, NX, NZ));
  blanketGeo.rotateX(-Math.PI / 2);
  {
    const p = blanketGeo.attributes.position;
    // PlaneGeometry rows run from +y (→ −z after rotation) to −y; map to our grid.
    for (let v = 0; v < p.count; v++) {
      const i = v % (NX + 1);
      const jr = Math.floor(v / (NX + 1));
      const j = jr; // row 0 is the head end (−z) after rotateX(−π/2)
      const x = gx(i);
      const z = gz(j);
      let hgt = grid[j * (NX + 1) + i];
      // Folds: run down the slopes, strongest where the cloth hangs.
      const hang = Math.max(0, 1 - hgt / 0.12);
      const fold = 0.012 * Math.sin(x * 26 + z * 7 + seed) * hang + 0.007 * Math.sin(z * 21 - x * 9 + seed * 2) + 0.004 * Math.sin(x * 61 + z * 33);
      hgt = Math.max(0.004, hgt + fold * (0.4 + hang));
      // The hem tucks down to the mat at the sides and the foot; a turned-back edge at the chin.
      const ex = Math.abs(x) / (bW / 2);
      const edge = Math.max(0, ex - 0.82) / 0.18;
      hgt *= 1 - edge * edge * 0.92;
      p.setXYZ(v, x, top + 0.008 + hgt, z);
    }
    blanketGeo.computeVertexNormals();
    const uv = blanketGeo.attributes.uv;
    for (let v = 0; v < uv.count; v++) uv.setXY(v, uv.getX(v), uv.getY(v) * (bL / bW));
  }
  const blCol = new THREE.Color(o.blanket ?? '#5a4a3a');
  const blanketMat = D(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide, map: woolTexture(`#${blCol.getHexString()}`) }));
  const blanket = new THREE.Mesh(blanketGeo, blanketMat);
  blanket.castShadow = true;
  blanket.receiveShadow = true;
  root.add(blanket);
  // Turned-back edge at the chin.
  const cuffGeo = D(new THREE.CapsuleGeometry(0.03, bW * 0.62, 4, 10));
  const cuff = new THREE.Mesh(cuffGeo, blanketMat);
  cuff.rotation.z = Math.PI / 2;
  const chinH = top + 0.008 + grid[Math.round(NX / 2)] ;
  cuff.position.set(0, chinH + 0.01, z0 + 0.03);
  cuff.castShadow = true;
  root.add(cuff);

  // ---- an arm on top of the blanket (sleeve, wrist, hand).
  const sleeveCol = new THREE.Color(app.body === 'robe' || app.body === 'vestments' || app.body === 'tunic' ? app.clothHex : '#3a3028');
  const sleeveMat = D(new THREE.MeshStandardMaterial({ color: sleeveCol, roughness: 0.95 }));
  const skinMat = D(new THREE.MeshStandardMaterial({ color: new THREE.Color(app.skinHex).multiplyScalar(0.85), roughness: 0.6 }));
  const armGeo = D(new THREE.CapsuleGeometry(0.036 * hs, 0.24 * L, 4, 10));
  const handGeo = D(new THREE.SphereGeometry(0.038 * hs, 12, 8));
  const onTop = (x, z) => top + 0.01 + grid[Math.max(0, Math.min(NZ, Math.round(((z - z0) / bL) * NZ))) * (NX + 1) + Math.max(0, Math.min(NX, Math.round(((x + bW / 2) / bW) * NX)))];
  const arm = (ax, az, bx, bz) => {
    const a = new THREE.Vector3(ax, onTop(ax, az) + 0.03, az);
    const b = new THREE.Vector3(bx, onTop(bx, bz) + 0.03, bz);
    const m = new THREE.Mesh(armGeo, sleeveMat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.scale.y = a.distanceTo(b) / (0.24 * L + 0.07 * hs);
    m.castShadow = true;
    root.add(m);
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.copy(b).add(b.clone().sub(a).normalize().multiplyScalar(0.04 * hs));
    hand.scale.set(1.1, 0.6, 1.35);
    hand.lookAt(b.clone().add(b.clone().sub(a)));
    hand.castShadow = true;
    root.add(hand);
  };
  if (pose === 'back') arm(0.21 * L, -0.28 * L, 0.03, -0.42 * L);
  else if (pose === 'side') arm(0.1, -0.36 * L, 0.24, -0.22 * L);
  else arm(0.12, -0.34 * L, 0.22, -0.4 * L);

  // ---- the head on the pillow, eyes closed.
  const head = new THREE.Group();
  let R;
  let hc;
  if (pose === 'back') {
    // Face up, crown toward −z, turned a little toward the camera side.
    const tilt = 0.35 + hash(seed, 5) * 0.25;
    const y = new THREE.Vector3(0, 0.18, -1).normalize();
    const z = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0.18).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y).normalize();
    R = [x, y, z];
    hc = new THREE.Vector3(0.0, top + 0.07 + 0.075 * hs, headZ + 0.09);
  } else {
    // On the side: the cheek on the pillow, face toward +x, crown toward −z.
    const y = new THREE.Vector3(0.05, 0.12, -1).normalize();
    const z = new THREE.Vector3(1, -0.08, 0.15).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y).normalize();
    R = [x, y, z];
    hc = new THREE.Vector3(-0.01, top + 0.1 + 0.07 * hs, headZ + 0.08);
  }
  const hm = createHead(app, { c: [hc.x, hc.y, hc.z], R: [R[0].x, R[0].y, R[0].z, R[1].x, R[1].y, R[1].z, R[2].x, R[2].y, R[2].z], hs }, { asleep: true, ambient: [0.02, 0.025, 0.04], gain: 0.75, fog: true });
  head.add(hm);
  root.add(head);
  disposables.push({ dispose: () => hm.userData.dispose() });
  // A shadow caster for the head.
  const cast = new THREE.Mesh(D(new THREE.SphereGeometry(0.1 * hs, 10, 8)), D(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })));
  cast.position.copy(hc);
  cast.castShadow = true;
  root.add(cast);

  // Breathing: the blanket over the chest rises and falls.
  const ph = hash(seed, 9) * 6.28;
  root.userData.update = (t) => {
    const b = Math.sin(t * 1.1 + ph);
    blanket.scale.y = 1 + b * 0.025;
    cuff.position.y = chinH + 0.01 + b * 0.003;
  };
  root.userData.dispose = () => { for (const d of disposables) d.dispose(); };
  root.userData.head = hm;
  return root;
}
