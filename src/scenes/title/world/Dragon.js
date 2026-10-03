import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The red dragon over the Moonsea: a real 3D silhouette (lofted body with a
 * readable head, horned skull, neck, chest, haunches and a whip tail ending in
 * a spade), and two articulated bat wings whose membranes glow with sunset
 * light where they're thin, crossed by dark arm and finger bones. A custom
 * shader adds a warm rim from the low sun and a cool sky fill on the back.
 *
 * Flight is screen-anchored: each camera pose hands in a "lane" (NDC start/end
 * + depth start/end) inside the sky region it keeps free of UI, and the dragon
 * glides along it, receding toward the horizon, then fades into the haze —
 * so it can never cross the logo or a panel. update(t, camera, lane).
 *
 * Local frame: nose toward -X, up +Y, right wing toward +Z.
 */

// ---------------------------------------------------------------- shading
const VERT = /* glsl */ `
  attribute vec2 aMem;
  uniform float uWing, uSide, uBend, uSweep;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vMem;
  const float WRIST = 7.2;
  void main() {
    vec3 p = position;
    vec3 n = normal;
    if (uWing > 0.5) {
      float z = p.z * uSide;
      float d = max(0.0, z - WRIST);
      if (d > 0.0) {
        // the hand bends about the wrist as a smooth arc (curls on the up/down stroke)
        float k = uBend / 7.0;
        float ang = k * d;
        float s = sin(ang), c = cos(ang);
        float zz = WRIST + (abs(k) > 1e-4 ? s / k : d);
        float yy = p.y + (abs(k) > 1e-4 ? (1.0 - c) / k : 0.0);
        p.z = zz * uSide;
        p.y = yy;
        p.x += uSweep * d * 0.28;
        float nz = n.z * uSide;
        n = vec3(n.x, n.y * c - nz * s, (n.y * s + nz * c) * uSide);
      }
    }
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * n);
    vMem = aMem;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uRim;
  uniform vec3 uSky;
  uniform float uOpacity;
  uniform float uClassic;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vMem;
  void main() {
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vW);
    float ndv = dot(N, V);
    float back = max(0.0, dot(-V, uSun));          // looking toward the sun: backlit
    float sunN = max(0.0, dot(N, uSun));
    vec3 col = vec3(0.030, 0.018, 0.026);           // dark red-black hide
    col += uSky * (0.25 + 0.75 * max(N.y, 0.0)) * 0.035;  // cool sky on the back and upper wing
    // rim on the silhouette edge that faces the sun (projected into the view
    // plane), strongest when the dragon is backlit; a front-lit dragon only
    // gets a thin warm edge so thin limbs don't glow all over
    vec3 sp = uSun - V * dot(uSun, V);
    float spl = length(sp);
    float edgeSun = max(0.0, dot(N, sp / max(spl, 1e-4))) * spl;
    float backK = 0.5 + 0.5 * dot(-V, uSun);
    float rim = pow(1.0 - abs(ndv), 4.0);
    // sunset rim: a hot edge on every silhouette line that faces the low sun
    // (membranes seen edge-on would take the rim over their whole area and
    // read as pale sails: they keep only a thin share of it)
    float memK = (vMem.x > 0.5 && vMem.x < 1.5) ? 0.22 + 0.5 * pow(1.0 - vMem.y, 3.0) : 1.0;
    col += uRim * rim * (edgeSun * 1.6 + back * back * 0.9 + 0.22) * backK * memK;
    col += uRim * pow(sunN, 2.0) * 0.06;
    if (vMem.x > 0.5 && vMem.x < 1.5) {
      // membrane: the low sun shines through where it's thin, orange-red,
      // with darker veins branching off the finger bones; bones and the
      // scalloped trailing edge stay dark so the structure reads
      float thin = vMem.y;
      float trans = (0.22 + 1.1 * pow(back, 1.6)) * thin;
      float veinA = 1.0 - smoothstep(0.0, 0.06, abs(fract(thin * 4.0 + sin(vW.x * 0.9 + vW.z * 0.7) * 0.18) - 0.5));
      float veinB = 1.0 - smoothstep(0.0, 0.05, abs(fract((vW.x * 0.55 - vW.z * 0.35) * 0.6) - 0.5));
      float vein = max(veinA * 0.7, veinB * 0.45) * smoothstep(0.15, 0.5, thin);
      vec3 glow = mix(vec3(0.7, 0.12, 0.03), vec3(1.0, 0.34, 0.07), thin * thin) * trans;
      col = col * (1.0 - 0.35 * thin) + glow * 0.3 * (1.0 - vein * 0.8);
    }
    if (vMem.x > 1.5) col = vec3(1.6, 0.62, 0.16);  // ember eyes
    if (uClassic > 0.5) col = vec3(0.0);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

// ---------------------------------------------------------------- geometry helpers
/** Indexed geometry from arrays, with aMem attribute and computed normals. */
function geo(pos, idx, mem) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aMem', new THREE.Float32BufferAttribute(mem, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Strip a primitive down to position+normal and tag it with aMem. */
function tag(g, kind = 0, thin = 0) {
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const m = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { m[i * 2] = kind; m[i * 2 + 1] = thin; }
  g.setAttribute('aMem', new THREE.BufferAttribute(m, 2));
  return g;
}

/** Tapered tube between two points. */
function bone(a, b, r0, r1, seg = 6) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return tag(g, 0, 0);
}

/** Cone (horn, spine, claw) from base point a toward tip b. */
function spike(a, b, r, seg = 5) {
  const len = a.distanceTo(b);
  const g = new THREE.ConeGeometry(r, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return tag(g, 0, 0);
}

const lerpKeys = (k, s) => {
  for (let i = 1; i < k.length; i++) {
    if (s <= k[i][0]) {
      const f = (s - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      const e = f * f * (3 - 2 * f);
      return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * e;
    }
  }
  return k[k.length - 1][1];
};

// ---------------------------------------------------------------- body
function buildBody() {
  // spine from snout (s=0) to tail tip (s=1); neck arches up, tail droops and flicks
  const spine = new THREE.CatmullRomCurve3(
    [[-10.6, 1.9], [-9.2, 2.0], [-7.9, 1.75], [-6.4, 1.05], [-4.6, 0.35], [-2.2, 0.05], [0.8, -0.1], [3.4, 0.1], [6.2, 0.4], [9.0, 0.15], [11.8, -0.45], [14.6, -0.2]]
      .map(([x, y]) => new THREE.Vector3(x, y, 0)),
  );
  // half-height and half-width profiles: long snout, skull, slim neck, deep chest, haunch, whip tail
  const H = [[0, 0.1], [0.02, 0.26], [0.055, 0.42], [0.075, 0.36], [0.1, 0.3], [0.2, 0.38], [0.3, 0.66], [0.38, 0.74], [0.48, 0.6], [0.56, 0.5], [0.66, 0.3], [0.82, 0.13], [1, 0.03]];
  const W = [[0, 0.08], [0.02, 0.2], [0.055, 0.36], [0.075, 0.3], [0.1, 0.26], [0.2, 0.32], [0.3, 0.6], [0.38, 0.66], [0.48, 0.54], [0.56, 0.5], [0.66, 0.26], [0.82, 0.11], [1, 0.03]];
  const NS = 72;
  const NR = 10;
  const pos = [];
  const idx = [];
  const mem = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    const p = spine.getPointAt(s);
    const t = spine.getTangentAt(s);
    const nUp = up.clone().sub(t.clone().multiplyScalar(up.dot(t))).normalize();
    const side = new THREE.Vector3().crossVectors(t, nUp).normalize();
    const hh = lerpKeys(H, s);
    const ww = lerpKeys(W, s);
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // flatter belly, ridged back
      const yk = sa > 0 ? 1 + 0.12 * Math.pow(sa, 8) : 0.85;
      const v = p.clone().addScaledVector(nUp, sa * hh * yk).addScaledVector(side, ca * ww);
      pos.push(v.x, v.y, v.z);
      mem.push(0, 0);
    }
  }
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * NR + j;
      const b = i * NR + ((j + 1) % NR);
      const c = (i + 1) * NR + j;
      const d = (i + 1) * NR + ((j + 1) % NR);
      idx.push(a, c, b, b, c, d);
    }
  }
  const parts = [geo(pos, idx, mem)];
  const at = (s, upK = 0, sideK = 0) => {
    const p = spine.getPointAt(s);
    return new THREE.Vector3(p.x, p.y + lerpKeys(H, s) * upK, lerpKeys(W, s) * sideK);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // swept-back horns and cheek frills
  for (const z of [-1, 1]) {
    const base = at(0.06, 0.7, 0.55 * z);
    parts.push(spike(base, base.clone().add(V(2.1, 0.95, 0.35 * z)), 0.14));
    const b2 = at(0.07, 0.1, 0.8 * z);
    parts.push(spike(b2, b2.clone().add(V(1.2, -0.2, 0.45 * z)), 0.1));
  }
  // lower jaw, slightly agape
  const jaw0 = at(0.075, -0.6);
  parts.push(bone(jaw0, jaw0.clone().add(V(-2.1, -0.38, 0)), 0.17, 0.06));
  // dorsal spines from the skull to the tail
  for (let i = 0; i < 16; i++) {
    const s = 0.11 + i * 0.05;
    const base = at(s, 0.9);
    const hgt = (0.42 - i * 0.018) * (s > 0.28 && s < 0.6 ? 1.15 : 0.8);
    parts.push(spike(base, base.clone().add(V(0.28, hgt, 0)), 0.1, 4));
  }
  // tail spade (flattened diamond)
  const tip = spine.getPointAt(1);
  const spade = new THREE.OctahedronGeometry(1, 0);
  spade.scale(1.2, 0.14, 0.75);
  spade.translate(tip.x + 0.4, tip.y, 0);
  parts.push(tag(spade));
  // legs tucked under for flight: forelegs folded up, hind legs trailing
  for (const z of [-1, 1]) {
    const sh = at(0.33, -0.55, 0.55 * z);
    const el = sh.clone().add(V(0.5, -1.0, 0.15 * z));
    const wr = el.clone().add(V(-0.9, -0.35, 0.05 * z));
    parts.push(bone(sh, el, 0.24, 0.16), bone(el, wr, 0.15, 0.1));
    for (let c = -1; c <= 1; c++) parts.push(spike(wr, wr.clone().add(V(-0.45, -0.18, c * 0.12)), 0.05, 3));
    const hip = at(0.55, -0.4, 0.6 * z);
    const kn = hip.clone().add(V(0.9, -1.1, 0.25 * z));
    const an = kn.clone().add(V(1.6, -0.15, 0.05 * z));
    parts.push(bone(hip, kn, 0.36, 0.22), bone(kn, an, 0.2, 0.12));
    for (let c = -1; c <= 1; c++) parts.push(spike(an, an.clone().add(V(0.6, -0.15, c * 0.15)), 0.06, 3));
    // ember eyes
    const eye = new THREE.SphereGeometry(0.075, 6, 4);
    const e = at(0.045, 0.35, 0.78 * z);
    eye.translate(e.x, e.y, e.z);
    parts.push(tag(eye, 2, 0));
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p : p)), false);
  parts.forEach((p) => p.dispose());
  return { geometry: g, shoulder: at(0.335, 0.55, 0.5) };
}

// ---------------------------------------------------------------- wing
/**
 * Wing in local space: chord along +X (aft), span along +Z (outward), y up.
 * Arm S→E→W, four fingers fanning from the wrist; scalloped membrane panels
 * between them carry a "thinness" (0 at a bone, 1 mid-panel) for the shader.
 */
function buildWing() {
  const P = (c, s, y = 0) => new THREE.Vector3(c, y, s);
  const S = P(-0.5, 0);
  const E = P(-1.7, 3.5, 0.25);
  const W = P(-0.9, 7.2, 0.35);
  const F = [P(0.9, 14.6, 0.1), P(3.9, 12.8, -0.15), P(6.0, 9.4, -0.25), P(6.2, 5.4, -0.2)];
  const T = P(5.2, 0.2, -0.1);
  const pos = [];
  const idx = [];
  const mem = [];
  const push = (v, thin) => {
    pos.push(v.x, v.y, v.z);
    mem.push(1, thin);
    return pos.length / 3 - 1;
  };
  // a curved membrane sheet: billow downward (camber) between its bones
  const sheet = (rows, cols, at) => {
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const { v, thin } = at(r / rows, c / cols);
      push(v, thin);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  };
  const tri = (x) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)));
  // finger panels: fan from the wrist between consecutive fingers
  for (let f = 0; f < 3; f++) {
    const A = F[f];
    const B = F[f + 1];
    sheet(8, 8, (r, a) => {
      const edge = A.clone().lerp(B, a);
      // scallop: the trailing edge pulls in toward the wrist between fingertips
      edge.lerp(W, 0.3 * tri(a));
      const v = W.clone().lerp(edge, r);
      const bd = Math.min(a, 1 - a) * 2;
      v.y -= 0.35 * tri(a) * tri(r) * 1.2; // billow
      const thin = Math.min(1, bd * 1.6) * Math.min(1, r * 3) * (1 - 0.35 * Math.pow(r, 6));
      return { v, thin };
    });
  }
  // arm panel: leading arm S→E→W, trailing edge T→(scallop)→F4
  const arm = (u) => (u < 0.5 ? S.clone().lerp(E, u * 2) : E.clone().lerp(W, (u - 0.5) * 2));
  const trail = (u) => {
    const v = T.clone().lerp(F[3], u);
    const l = arm(u);
    return v.lerp(l, 0.22 * tri(u));
  };
  sheet(10, 8, (u, w) => {
    const v = arm(u).lerp(trail(u), w);
    v.y -= 0.45 * tri(w) * tri(u);
    const thin = Math.min(1, w * 3.2) * Math.min(1, (1 - u) * 6 + 0.15) * (1 - 0.3 * Math.pow(w, 6));
    return { v, thin };
  });
  const membrane = geo(pos, idx, mem);
  // bones: humerus, forearm, fingers (taper to the tips), wrist claw
  const parts = [membrane, bone(S, E, 0.34, 0.22), bone(E, W, 0.22, 0.15)];
  for (const f of F) parts.push(bone(W, f, 0.12, 0.03, 5));
  parts.push(spike(W, W.clone().add(new THREE.Vector3(-0.8, 0.25, 0.35)), 0.09, 4));
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** Mirror a wing across z for the left side (flip winding to keep normals out). */
function mirrorZ(g) {
  const m = g.clone();
  const p = m.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i));
  const ix = m.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const t = ix[i + 1];
    ix[i + 1] = ix[i + 2];
    ix[i + 2] = t;
  }
  m.computeVertexNormals();
  return m;
}

// ---------------------------------------------------------------- dragon
export function createDragon({ sunDir = new THREE.Vector3(-0.45, 0.014, -1).normalize() } = {}) {
  const group = new THREE.Group();
  group.name = 'dragon';
  const shared = {
    uSun: { value: sunDir.clone().normalize() },
    uRim: { value: new THREE.Color(1.0, 0.52, 0.24) },
    uSky: { value: new THREE.Color(0.45, 0.42, 0.75) },
    uOpacity: { value: 1 },
    uClassic: { value: 0 },
  };
  const makeMat = (wing, side) => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: {
      ...shared,
      uWing: { value: wing ? 1 : 0 },
      uSide: { value: side },
      uBend: { value: 0 },
      uSweep: { value: 0 },
    },
  });
  const bodyMat = makeMat(false, 1);
  const { geometry: bodyGeo, shoulder } = buildBody();
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  group.add(body);

  const wingGeoR = buildWing();
  const wingGeoL = mirrorZ(wingGeoR);
  const wings = [];
  const mats = [bodyMat];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(shoulder.x, shoulder.y, shoulder.z * side);
    const mat = makeMat(true, side);
    mats.push(mat);
    const w = new THREE.Mesh(side > 0 ? wingGeoR : wingGeoL, mat);
    w.frustumCulled = false;
    pivot.add(w);
    pivot.userData = { side, mat };
    group.add(pivot);
    wings.push(pivot);
  }

  /**
   * Wing pose for time t: long soaring glides (slight dihedral, hands
   * breathing on the air), broken by bursts of deep beats where the hand
   * lags the arm and curls on the upstroke.
   */
  const pose = (t) => {
    const cyc = ((t % 11) + 11) % 11;
    const beatW = THREE.MathUtils.smoothstep(cyc, 7.4, 7.9) * (1 - THREE.MathUtils.smoothstep(cyc, 10.2, 10.8));
    const ph = (cyc - 7.4) * 2.4 * Math.PI / 1.1;
    const glideArm = 0.16 + 0.04 * Math.sin(t * 0.9);
    const glideHand = -0.12 + 0.05 * Math.sin(t * 0.9 - 0.6);
    const arm = glideArm * (1 - beatW) + beatW * (0.15 + 0.7 * Math.cos(ph));
    const hand = glideHand * (1 - beatW) + beatW * (-0.55 * Math.cos(ph - 1.1));
    const sweep = beatW * 0.3 * Math.max(0, Math.sin(ph));
    return { arm, hand, sweep, beat: beatW * Math.cos(ph) };
  };

  const tmp = new THREE.Vector3();
  const rayAt = (camera, x, y, d, out) => {
    tmp.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
    return out.copy(camera.position).addScaledVector(tmp, d);
  };
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const upW = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  const xa = new THREE.Vector3();
  const ya = new THREE.Vector3();
  const za = new THREE.Vector3();
  const qBank = new THREE.Quaternion();
  const ax = new THREE.Vector3(1, 0, 0);

  return {
    group,
    uniforms: shared,
    /** Classic 1988 mode: a pure black cut-out (EGA art had no rim light). */
    setClassic(on) {
      shared.uClassic.value = on ? 1 : 0;
    },
    /**
     * @param {number} t
     * @param {THREE.Camera} camera
     * @param {null|{x:[number,number], y:[number,number], d:[number,number], period:number, phase?:number, duty?:number, scale?:number, bank?:number, time?:number}} lane
     */
    update(t, camera, lane) {
      if (!lane || !camera) {
        group.visible = false;
        return;
      }
      const lt = lane.time ?? t;
      const P = lane.period ?? 30;
      const duty = lane.duty ?? 0.82;
      const k = ((((lt + (lane.phase ?? 0)) % P) + P) % P) / P;
      if (k > duty) {
        group.visible = false;
        return;
      }
      const kk = k / duty;
      const fade = THREE.MathUtils.smoothstep(kk, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(kk, 0.86, 1));
      if (fade <= 0.002) {
        group.visible = false;
        return;
      }
      group.visible = true;
      for (const m of mats) m.uniforms.uOpacity.value = fade;
      const ps = pose(lt);
      const at = (q, out) => {
        // screen travel decelerates while depth accelerates: the dragon glides
        // across in profile, then banks away toward the horizon
        const e = 1 - Math.pow(1 - q, lane.xe ?? 1);
        const x = lane.x[0] + (lane.x[1] - lane.x[0]) * e;
        const y = lane.y[0] + (lane.y[1] - lane.y[0]) * e + Math.sin(lt * 0.5) * 0.012;
        const d = lane.d[0] + (lane.d[1] - lane.d[0]) * Math.pow(q, lane.de ?? 1.25);
        return rayAt(camera, x, y, d, out);
      };
      const qa = Math.min(kk, 0.99);
      at(qa, p0);
      at(qa + 0.01, p1);
      fwd.subVectors(p1, p0);
      at(kk, p0);
      fwd.y *= 0.4;
      fwd.normalize();
      // local -X is the nose
      xa.copy(fwd).negate();
      ya.copy(upW).addScaledVector(fwd, -upW.dot(fwd)).normalize();
      za.crossVectors(xa, ya);
      basis.makeBasis(xa, ya, za);
      group.quaternion.setFromRotationMatrix(basis);
      // bank into the turn; pitch up a touch on the downstroke
      qBank.setFromAxisAngle(ax, (lane.bank ?? 0.18) + Math.sin(lt * 0.37) * 0.05);
      group.quaternion.multiply(qBank);
      group.rotateZ(-0.06 + ps.beat * 0.04);
      group.position.copy(p0);
      group.position.y += -ps.beat * 0.35 * (lane.scale ?? 1);
      group.scale.setScalar(lane.scale ?? 1);
      // wings: rotation.x lifts +Z up for negative angles
      for (const w of wings) {
        const s = w.userData.side;
        w.rotation.x = -ps.arm * s;
        w.rotation.y = ps.sweep * 0.4 * s;
        w.userData.mat.uniforms.uBend.value = ps.hand;
        w.userData.mat.uniforms.uSweep.value = ps.sweep;
      }
    },
    dispose() {
      bodyGeo.dispose();
      wingGeoR.dispose();
      wingGeoL.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
