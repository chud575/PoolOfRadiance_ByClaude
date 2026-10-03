import * as THREE from 'three';
import { makeCanvas, prng } from './ink.js';

/**
 * The Company's standard-bearer as a painted 28mm lead figure: a helmed,
 * cloaked warrior with a heater shield on the left arm, a sheathed sword at the
 * hip and the Company's banner raised in the right hand, on a slotta-style base
 * finished with sand and static flock and a gilt facing notch at the front.
 * Painted the way a figure painter would: a dark wash in the recesses of every
 * fold, drybrushed highlights on the ridges, matte paint everywhere (the only
 * sheen is a little on the painted mail and the gilt).
 *
 * Local frame: +y up, the figure faces -z. Units ≈ the old token (base r 0.3).
 * @param {(o:any)=>any} T tracker for disposables
 * @param {{pennant:THREE.Texture}} o
 */
export function buildPartyMiniature(T, { pennant }) {
  const root = new THREE.Group();
  const V = (pts) => pts.map(([x, y]) => new THREE.Vector2(x, y));
  const paint = (color, roughness = 0.82, o = {}) => T(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 0.3, ...o }));
  const vpaint = (color, roughness = 0.82, o = {}) => paint(color, roughness, { vertexColors: true, ...o });
  const r = prng(4242);

  /** wash + drybrush baked into vertex colours from a per-vertex "relief" value (-1 recess .. 1 ridge) */
  const shadeBy = (geo, relief, { lo = 0.62, hi = 1.18, aoY = null } = {}) => {
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const rv = relief(p.getX(i), p.getY(i), p.getZ(i));
      let v = rv < 0 ? 1 + rv * (1 - lo) : 1 + rv * (hi - 1);
      if (aoY) v *= Math.min(1, aoY[0] + (p.getY(i) - aoY[1]) * aoY[2]);
      col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };

  // ---------- base: a bevelled, painted earth-brown disc with sand, flock and a pebble or two ----------
  const baseGeo = T(new THREE.LatheGeometry(V([[0, 0], [0.3, 0], [0.312, 0.006], [0.316, 0.034], [0.306, 0.046], [0.288, 0.05], [0.2, 0.052], [0, 0.054]]), 56));
  shadeBy(baseGeo, (x, y) => (y < 0.04 ? -0.2 : 0.3));
  const base = new THREE.Mesh(baseGeo, vpaint(0x3a2f22, 0.9));
  root.add(base);
  // the rim painted in a neat band (the painter's finishing line) with a gilt notch at the front
  const band = new THREE.Mesh(T(new THREE.CylinderGeometry(0.3155, 0.3155, 0.024, 56, 1, true)), paint(0x23241c, 0.75));
  band.position.y = 0.022;
  root.add(band);
  const notchShape = new THREE.Shape();
  notchShape.moveTo(0, -0.05);
  notchShape.lineTo(0.034, 0.012);
  notchShape.lineTo(0, 0.0);
  notchShape.lineTo(-0.034, 0.012);
  notchShape.closePath();
  const notchGeo = T(new THREE.ExtrudeGeometry(notchShape, { depth: 0.006, bevelEnabled: false }));
  notchGeo.rotateX(-Math.PI / 2);
  const gilt = paint(0xb48a3c, 0.42, { metalness: 0.6, envMapIntensity: 0.7 });
  const notch = new THREE.Mesh(notchGeo, gilt);
  notch.position.set(0, 0.052, -0.245);
  root.add(notch);
  // a V cut into the rim's front, the facing notch itself
  const vcut = new THREE.Mesh(T(new THREE.BoxGeometry(0.03, 0.03, 0.03)), paint(0x120d08, 0.9));
  vcut.rotation.set(0, Math.PI / 4, 0);
  vcut.position.set(0, 0.03, -0.306);
  root.add(vcut);
  // sand texture and static-grass flock: instanced little clumps
  {
    const sandGeo = T(new THREE.IcosahedronGeometry(0.006, 0));
    const flockGeo = T(new THREE.ConeGeometry(0.014, 0.03, 5));
    const stoneGeo = T(new THREE.DodecahedronGeometry(0.018, 0));
    const sand = new THREE.InstancedMesh(sandGeo, paint(0x8a7656, 0.95), 260);
    const flock = new THREE.InstancedMesh(flockGeo, paint(0xffffff, 0.95), 120);
    const stones = new THREE.InstancedMesh(stoneGeo, paint(0x8c8578, 0.85), 4);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    const spot = (rmax) => {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * rmax;
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    };
    for (let i = 0; i < 260; i++) {
      const [x, z] = spot(0.28);
      d.position.set(x, 0.054, z);
      d.rotation.set(r() * 3, r() * 3, r() * 3);
      d.scale.setScalar(0.6 + r() * 0.9);
      d.updateMatrix();
      sand.setMatrixAt(i, d.matrix);
    }
    let n = 0;
    for (let i = 0; i < 400 && n < 120; i++) {
      const [x, z] = spot(0.285);
      // tufts cluster in patches, and never under the figure's feet
      if (Math.hypot(x, z + 0.02) < 0.1) continue;
      const patch = Math.sin(x * 23 + 1.3) * Math.cos(z * 19 - 0.4);
      if (patch < 0.05) continue;
      d.position.set(x, 0.058, z);
      d.rotation.set((r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6);
      d.scale.set(0.7 + r() * 0.6, 0.6 + r() * 0.9, 0.7 + r() * 0.6);
      d.updateMatrix();
      flock.setMatrixAt(n, d.matrix);
      c.setRGB(0.32 + r() * 0.16, 0.36 + r() * 0.12, 0.14 + r() * 0.06);
      flock.setColorAt(n, c);
      n++;
    }
    flock.count = n;
    for (let i = 0; i < 4; i++) {
      const [x, z] = spot(0.25);
      d.position.set(x, 0.058, z);
      d.rotation.set(r() * 3, r() * 3, r() * 3);
      d.scale.set(1 + r(), 0.6 + r() * 0.4, 1 + r() * 0.6);
      d.updateMatrix();
      stones.setMatrixAt(i, d.matrix);
    }
    root.add(sand, flock, stones);
  }

  /** One painted figure of the Company (local frame: feet at the origin, facing -z). */
  const figure = (v) => {
    // ---------- the figure ----------
    const fig = new THREE.Group();

    // boots: stout, planted apart, toes showing beneath the cloak
    const bootMat = paint(0x3a2414, 0.7);
    for (const s of [-1, 1]) {
      const boot = new THREE.Mesh(T(new THREE.CapsuleGeometry(0.019, 0.03, 4, 10)), bootMat);
      boot.rotation.x = Math.PI / 2;
      boot.position.set(s * 0.032, 0.016, -0.028);
      fig.add(boot);
    }

    // the body under the cloak: a mail hauberk (painted gunmetal) with a red surcoat panel
    const torsoGeo = T(new THREE.LatheGeometry(V([[0, 0.02], [0.06, 0.02], [0.068, 0.07], [0.062, 0.14], [0.056, 0.2], [0.064, 0.24], [0.06, 0.265], [0.03, 0.285], [0, 0.29]]), 32));
    shadeBy(torsoGeo, (x, y, z) => Math.sin(y * 260) * 0.35 - 0.1, { aoY: [0.55, 0.02, 3] });
    const mail = new THREE.Mesh(torsoGeo, vpaint(0x7d8086, 0.55, { metalness: 0.45, envMapIntensity: 0.5 }));
    fig.add(mail);
    const coatGeo = T(new THREE.LatheGeometry(V([[0.058, 0.04], [0.071, 0.06], [0.066, 0.14], [0.06, 0.2], [0.067, 0.245], [0.05, 0.27]]), 24, Math.PI - 0.55, 1.1));
    shadeBy(coatGeo, (x, y) => (Math.sin(x * 120) * 0.4) - (y < 0.07 ? 0.3 : 0), { aoY: [0.6, 0.04, 3] });
    const coat = new THREE.Mesh(coatGeo, vpaint(v.coat, 0.85, { side: THREE.DoubleSide }));
    fig.add(coat);
    // belt, buckle and a pouch
    const belt = new THREE.Mesh(T(new THREE.TorusGeometry(0.066, 0.007, 6, 28)), paint(0x4a2c16, 0.6));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.15;
    fig.add(belt);
    const buckle = new THREE.Mesh(T(new THREE.BoxGeometry(0.018, 0.016, 0.006)), gilt);
    buckle.position.set(0, 0.15, -0.071);
    fig.add(buckle);
    const pouch = new THREE.Mesh(T(new THREE.BoxGeometry(0.026, 0.03, 0.016)), paint(0x5a3a1e, 0.75));
    pouch.position.set(0.05, 0.132, -0.045);
    pouch.rotation.y = 0.6;
    fig.add(pouch);

    // the cloak: heavy wool falling from the shoulders in deep folds, open at the front
    {
      const prof = V([[0.03, 0.31], [0.07, 0.298], [0.092, 0.272], [0.094, 0.24], [0.092, 0.18], [0.1, 0.11], [0.112, 0.05], [0.12, 0.012], [0.118, 0.004]]);
      const geo = T(new THREE.LatheGeometry(prof, 64, Math.PI + 0.9, Math.PI * 2 - 1.8));
      const p = geo.attributes.position;
      const relief = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const a = Math.atan2(x, z);
        const rr = Math.hypot(x, z);
        // folds deepen toward the hem; a slight billow out behind
        const low = Math.max(0, Math.min(1, (0.27 - y) / 0.25));
        const fold = Math.sin(a * 9 + Math.sin(a * 3) * 0.8) * 0.6 + Math.sin(a * 17 + 1.7) * 0.25;
        const k = 1 + fold * 0.16 * low + (z > 0 ? (z / rr) * 0.08 * low : 0);
        p.setX(i, x * k);
        p.setZ(i, z * k + (z > 0 ? low * low * 0.02 : 0));
        relief[i] = fold * low * 0.9 + (y > 0.27 ? 0.25 : 0);
      }
      geo.computeVertexNormals();
      let j = 0;
      shadeBy(geo, () => relief[j++], { lo: 0.4, hi: 1.3, aoY: [0.55, 0.0, 4] });
      const cloak = new THREE.Mesh(geo, vpaint(v.cloak, 0.88, { side: THREE.DoubleSide }));
      fig.add(cloak);
      // a gilt-edged hem line down each front edge
      for (const s of [-1, 1]) {
        const a = Math.PI + s * 0.9;
        const pts = prof.map((q) => new THREE.Vector3(Math.sin(a) * q.x * 1.0, q.y, Math.cos(a) * q.x * 1.0));
        const trim = new THREE.Mesh(T(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0035, 5)), gilt);
        fig.add(trim);
      }
    }

    // the head: a barrel helm of bright steel with a dark eye-slit, breaths, a gilt
    // cross on the face and a tall red crest, so the figure reads at a glance
    const steel = paint(0xb8bcc4, 0.32, { metalness: 0.85, envMapIntensity: 1.1 });
    if (!v.helm) {
      // a hooded head: the cowl in the cloak's wool, a shadowed face, a pale nose and chin
      const hood = new THREE.Mesh(T(new THREE.SphereGeometry(0.05, 20, 14)), vpaint(v.cloak, 0.9));
      hood.scale.set(1, 1.15, 1.05);
      hood.position.set(0, 0.335, 0.004);
      shadeBy(hood.geometry, (x, y) => (y > 0.02 ? 0.35 : -0.1));
      fig.add(hood);
      const peak = new THREE.Mesh(T(new THREE.ConeGeometry(0.03, 0.06, 12)), vpaint(v.cloak, 0.9));
      peak.position.set(0, 0.385, 0.026);
      peak.rotation.x = 0.7;
      fig.add(peak);
      const face = new THREE.Mesh(T(new THREE.SphereGeometry(0.03, 14, 10)), paint(0x1a120c, 0.9));
      face.scale.set(1, 1.1, 0.6);
      face.position.set(0, 0.33, -0.036);
      fig.add(face);
      const skin = new THREE.Mesh(T(new THREE.SphereGeometry(0.014, 10, 8)), paint(0xd8a882, 0.7));
      skin.position.set(0, 0.322, -0.05);
      fig.add(skin);
      if (v.beard) {
        const bd = new THREE.Mesh(T(new THREE.ConeGeometry(0.026, 0.07, 10)), paint(v.beard, 0.85));
        bd.rotation.x = Math.PI;
        bd.position.set(0, 0.29, -0.046);
        fig.add(bd);
      }
    } else {
      const helmGeo = T(new THREE.LatheGeometry(V([[0, 0.0], [0.046, 0.0], [0.05, 0.006], [0.05, 0.05], [0.048, 0.066], [0.038, 0.08], [0.02, 0.088], [0, 0.09]]), 28));
      shadeBy(helmGeo, (x, y) => (y < 0.008 ? -0.4 : y > 0.06 ? 0.4 : 0.05));
      const helm = new THREE.Mesh(helmGeo, vpaint(0xc4c8d0, 0.3, { metalness: 0.85, envMapIntensity: 1.1 }));
      helm.position.set(0, 0.29, 0);
      fig.add(helm);
      const slit = new THREE.Mesh(T(new THREE.BoxGeometry(0.07, 0.009, 0.02)), paint(0x08080a, 0.9));
      slit.position.set(0, 0.345, -0.042);
      fig.add(slit);
      const cross = new THREE.Mesh(T(new THREE.BoxGeometry(0.008, 0.05, 0.012)), gilt);
      cross.position.set(0, 0.325, -0.047);
      fig.add(cross);
      const brow = new THREE.Mesh(T(new THREE.BoxGeometry(0.07, 0.007, 0.012)), gilt);
      brow.position.set(0, 0.352, -0.046);
      fig.add(brow);
      for (let k = 0; k < 3; k++) {
        const br = new THREE.Mesh(T(new THREE.BoxGeometry(0.005, 0.005, 0.01)), paint(0x08080a, 0.9));
        br.position.set(0.018, 0.318 - k * 0.009, -0.047);
        fig.add(br);
      }
      // the crest: a swept horsehair plume, broad at the crown, trailing behind
      const curve = new THREE.CatmullRomCurve3([[0, 0.375, -0.02], [0, 0.41, 0.0], [0, 0.415, 0.035], [0, 0.39, 0.075], [0, 0.35, 0.1]].map((q) => new THREE.Vector3(...q)));
      const plumeGeo = T(new THREE.TubeGeometry(curve, 16, 1, 8));
      {
        const pp = plumeGeo.attributes.position;
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const c = curve.getPointAt(t);
          const rr = 0.016 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 0.004;
          for (let j = 0; j <= 8; j++) {
            const k = i * 9 + j;
            const ddx = pp.getX(k) - c.x;
            const ddy = pp.getY(k) - c.y;
            const ddz = pp.getZ(k) - c.z;
            // flattened sideways like a crest, ragged at the hair's ends
            pp.setXYZ(k, c.x + ddx * rr * 0.55, c.y + ddy * rr * (1.3 + Math.sin(j * 2.3 + i) * 0.15), c.z + ddz * rr);
          }
        }
        plumeGeo.computeVertexNormals();
        shadeBy(plumeGeo, (x, y) => Math.sin(y * 900 + x * 400) * 0.4);
      }
      fig.add(new THREE.Mesh(plumeGeo, vpaint(v.crest, 0.9)));
      const neck = new THREE.Mesh(T(new THREE.CylinderGeometry(0.034, 0.05, 0.03, 18)), vpaint(0x7d8086, 0.55, { metalness: 0.45 }));
      neck.position.set(0, 0.285, 0);
      fig.add(neck);
    }

    // arms: sleeves as tapering tubes, gauntleted hands
    const sleeveMat = vpaint(v.cloak, 0.88);
    const glove = paint(0x3e2816, 0.65);
    const limb = (pts, r0, r1) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const geo = T(new THREE.TubeGeometry(curve, 12, 1, 10));
      const p = geo.attributes.position;
      // taper along the tube: rebuild each ring at its own radius
      const seg = 12;
      const rad = 10;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const c = curve.getPointAt(t);
        const rr = r0 + (r1 - r0) * t;
        for (let j = 0; j <= rad; j++) {
          const k = i * (rad + 1) + j;
          const dx = p.getX(k) - c.x;
          const dy = p.getY(k) - c.y;
          const dz = p.getZ(k) - c.z;
          const wr = rr * (1 + Math.sin(j * 1.9 + i) * 0.08);
          p.setXYZ(k, c.x + dx * wr, c.y + dy * wr, c.z + dz * wr);
        }
      }
      geo.computeVertexNormals();
      shadeBy(geo, (x, y, z) => Math.sin(y * 300 + x * 200) * 0.4);
      return new THREE.Mesh(geo, sleeveMat);
    };
    // right arm raised high, gripping the standard
    const handR = [0.108, 0.43, -0.03];
    fig.add(limb([[0.078, 0.275, 0], [0.104, 0.32, -0.012], [0.112, 0.38, -0.024], [handR[0], handR[1] - 0.02, handR[2]]], 0.022, 0.015));
    const fistR = new THREE.Mesh(T(new THREE.SphereGeometry(0.016, 12, 10)), glove);
    fistR.scale.set(1, 1.2, 1);
    fistR.position.set(...handR);
    fig.add(fistR);
    // left arm bent forward, bearing the shield
    fig.add(limb([[-0.078, 0.275, 0], [-0.1, 0.23, -0.02], [-0.094, 0.19, -0.05]], 0.022, 0.016));
    const fistL = new THREE.Mesh(T(new THREE.SphereGeometry(0.015, 10, 8)), glove);
    fistL.position.set(-0.088, 0.186, -0.064);
    fig.add(fistL);
    // spaulders: broad rounded steel plates over each shoulder, two lames below,
    // so the figure's shoulders square off against the paving
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const rr = 0.044 - k * 0.006;
        const pd = new THREE.Mesh(T(new THREE.SphereGeometry(rr, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), steel);
        pd.position.set(sgn * (0.078 + k * 0.006), 0.285 - k * 0.022, 0.002);
        pd.rotation.z = -sgn * (0.55 + k * 0.12);
        pd.scale.set(1, 0.62, 1.05);
        fig.add(pd);
      }
      const rim = new THREE.Mesh(T(new THREE.TorusGeometry(0.043, 0.0035, 5, 22, Math.PI)), gilt);
      rim.position.set(sgn * 0.08, 0.283, 0.002);
      rim.rotation.set(0, Math.PI / 2, -sgn * 0.55);
      fig.add(rim);
    }

    // the heater shield: a curved, bevelled board, painted with the Company's chevron, rim worn bright
    if (v.shield) {
      const sh = new THREE.Shape();
      sh.moveTo(-0.06, 0.05);
      sh.lineTo(0.06, 0.05);
      sh.lineTo(0.06, 0.0);
      sh.quadraticCurveTo(0.055, -0.055, 0, -0.085);
      sh.quadraticCurveTo(-0.055, -0.055, -0.06, 0.0);
      sh.closePath();
      const geo = T(new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 12 }));
      // curve the board round the arm
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - (p.getX(i) ** 2) * 6);
      geo.computeVertexNormals();
      // planar UVs over the face for the painted device
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + 0.065) / 0.13, (p.getY(i) + 0.09) / 0.145);
      const c = makeCanvas(128, 144);
      const g = c.getContext('2d');
      g.fillStyle = v.field ?? '#23407a';
      g.fillRect(0, 0, 128, 144);
      g.fillStyle = '#d6b060';
      g.beginPath(); g.moveTo(10, 104); g.lineTo(64, 44); g.lineTo(118, 104); g.lineTo(118, 80); g.lineTo(64, 20); g.lineTo(10, 80); g.closePath(); g.fill();
      // wear: chips of bare metal and a dark wash at the rim
      g.strokeStyle = 'rgba(20,14,10,0.55)';
      g.lineWidth = 10;
      g.strokeRect(0, 0, 128, 144);
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(${150 + r() * 40 | 0},${140 + r() * 30 | 0},${120 + r() * 20 | 0},0.7)`;
        g.fillRect(r() * 128, r() < 0.5 ? r() * 10 : 134 + r() * 10, 2 + r() * 3, 1 + r() * 2);
      }
      const tex = T(new THREE.CanvasTexture(c));
      tex.colorSpace = THREE.SRGBColorSpace;
      const shield = new THREE.Mesh(geo, paint(0xffffff, 0.7, { map: tex }));
      shield.position.set(-0.112, 0.2, -0.074);
      shield.rotation.set(0.12, -Math.PI + 0.75, 0.08);
      shield.scale.setScalar(1.35);
      fig.add(shield);
    }

    // the sword sheathed at the left hip: scabbard, crossguard, wire grip, pommel
    {
      const sw = new THREE.Group();
      const scab = new THREE.Mesh(T(new THREE.BoxGeometry(0.014, 0.15, 0.006)), paint(0x2a1a10, 0.6));
      scab.position.y = -0.075;
      const chape = new THREE.Mesh(T(new THREE.BoxGeometry(0.016, 0.016, 0.008)), gilt);
      chape.position.y = -0.15;
      const guard = new THREE.Mesh(T(new THREE.BoxGeometry(0.05, 0.007, 0.008)), gilt);
      guard.position.y = 0.004;
      const grip = new THREE.Mesh(T(new THREE.CylinderGeometry(0.0045, 0.005, 0.034, 6)), paint(0x3a2414, 0.6));
      grip.position.y = 0.024;
      const pommel = new THREE.Mesh(T(new THREE.SphereGeometry(0.008, 8, 6)), gilt);
      pommel.position.y = 0.045;
      sw.add(scab, chape, guard, grip, pommel);
      sw.position.set(-0.07, 0.155, 0.03);
      sw.rotation.set(-0.55, 0.3, 0.35);
      fig.add(sw);
    }

    // the standard: an ash pole through the raised fist, gilt finial, the Company's banner
    let flag = null;
    let flagGeo = null;
    if (v.pole === 'staff') {
      // a gnarled staff with a pale crystal set in its crook
      const staff = new THREE.Mesh(T(new THREE.CylinderGeometry(0.006, 0.008, 0.62, 7)), paint(0x4a3018, 0.8));
      staff.position.set(handR[0], 0.32, handR[2]);
      fig.add(staff);
      const gem = new THREE.Mesh(T(new THREE.OctahedronGeometry(0.018, 0)), paint(0x9fd4ff, 0.2, { emissive: 0x2a6aa8, emissiveIntensity: 0.6 }));
      gem.position.set(handR[0], 0.645, handR[2]);
      fig.add(gem);
    } else if (v.pole === 'spear') {
      const sp = new THREE.Mesh(T(new THREE.CylinderGeometry(0.005, 0.006, 0.7, 7)), paint(0x6a4524, 0.65));
      sp.position.set(handR[0], 0.36, handR[2]);
      fig.add(sp);
      const tip = new THREE.Mesh(T(new THREE.ConeGeometry(0.011, 0.06, 4)), steel);
      tip.position.set(handR[0], 0.74, handR[2]);
      fig.add(tip);
    }
    if (v.pole !== 'banner') return { fig, flag, flagGeo };
    const pole = new THREE.Mesh(T(new THREE.CylinderGeometry(0.0055, 0.0065, 0.78, 8)), paint(0x6a4524, 0.65));
    pole.position.set(handR[0], 0.39, handR[2]);
    fig.add(pole);
    // a leaf-bladed spear head of bright steel on a gilt socket
    const socket = new THREE.Mesh(T(new THREE.CylinderGeometry(0.008, 0.009, 0.03, 8)), gilt);
    socket.position.set(handR[0], 0.79, handR[2]);
    fig.add(socket);
    const blade = new THREE.Mesh(T(new THREE.LatheGeometry(V([[0, 0], [0.014, 0.025], [0.016, 0.045], [0.008, 0.08], [0, 0.1]]), 4)), steel);
    blade.scale.set(1, 1, 0.3);
    blade.position.set(handR[0], 0.805, handR[2]);
    fig.add(blade);
    flagGeo = T(new THREE.PlaneGeometry(0.24, 0.15, 14, 3));
    const fp = flagGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const u = fp.getX(i) / 0.24 + 0.5;
      fp.setZ(i, Math.sin(u * Math.PI * 1.6) * 0.02 * u + Math.sin(fp.getY(i) * 30) * 0.003);
      if (u > 0.82) fp.setY(i, fp.getY(i) * (1 - (u - 0.82) * 1.8));
    }
    flagGeo.computeVertexNormals();
    flagGeo.translate(0.12, 0, 0);
    flag = new THREE.Mesh(flagGeo, paint(0xffffff, 0.85, { map: pennant, side: THREE.DoubleSide }));
    flag.position.set(handR[0] + 0.004, 0.7, handR[2]);
    fig.add(flag);
    return { fig, flag, flagGeo };

  };

  // ---------- the Company: six figures on the shared base, the standard-bearer in front ----------
  const KIT = [
    { cloak: 0x2c4466, coat: 0x8a2418, crest: 0xb02a1a, helm: true, shield: true, pole: 'banner' },
    { cloak: 0x7a2418, coat: 0x2c3e68, crest: 0xe8d6aa, helm: true, shield: true, pole: 'spear', field: '#8a2418' },
    { cloak: 0xd6ccb4, coat: 0xb48a3c, crest: 0xd6ccb4, helm: true, shield: true, pole: 'none', field: '#e8dcc0' },
    { cloak: 0x4a2a6a, coat: 0x2a1a3a, crest: 0x000000, helm: false, shield: false, pole: 'staff' },
    { cloak: 0x2e4a2a, coat: 0x3a2a1a, crest: 0x000000, helm: false, shield: false, pole: 'none' },
    { cloak: 0x6a4a2a, coat: 0x5a6a2a, crest: 0x000000, helm: false, shield: true, pole: 'spear', beard: 0xb86a2a, field: '#2e4a2a' },
  ];
  const SPOTS = [[0, -0.135], [-0.17, -0.05], [0.17, -0.05], [-0.105, 0.135], [0.105, 0.135], [0, 0.03]];
  let flag = null;
  let flagGeo = null;
  KIT.forEach((v, i) => {
    const f = figure(v);
    const [x, z] = SPOTS[i];
    f.fig.position.set(x, 0.054, z);
    f.fig.scale.setScalar(i === 0 ? 0.92 : 0.84 * (i === 5 ? 0.86 : 1));
    f.fig.rotation.y = (i === 0 ? 0 : (r() - 0.5) * 0.5);
    root.add(f.fig);
    if (f.flag) { flag = f.flag; flagGeo = f.flagGeo; }
  });

  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return { group: root, flag, flagGeo };
}
