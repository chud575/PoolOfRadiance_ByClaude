import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The red dragon over the Moonsea. A modelled silhouette rather than an eel:
 * a deep keeled chest and shoulder mass, an S-necked taper into a wedge skull
 * with brow ridges, an open lower jaw, teeth and swept horns, a dorsal row of
 * spines from crown to spade, tucked clawed forelegs and heavy hind legs with
 * muscular thighs and four-toed taloned feet, and two bat wings with a thick
 * arm, knuckled finger bones and a thumb claw.
 *
 * Shading (custom shader): crimson hide broken into Voronoi scales with dark
 * crevices, ochre ventral plates on the belly, ivory horn/claw; a warm sun key,
 * cool lilac sky fill and a cool sky rim on the upper silhouette so the
 * dragon separates from the warm sky and town; membranes are deep red and
 * glow orange-red where thin when the low sun shines through them (SSS).
 *
 * Flight is screen-anchored: each camera pose hands in a "lane" (NDC start/end
 * + depth start/end) inside the sky region it keeps free of UI, and the dragon
 * glides along it, receding toward the horizon, then fades into the haze —
 * so it can never cross the logo or a panel. update(t, camera, lane).
 * After update, `mask` holds its NDC footprint (cx, cy, rx, ry) so ember
 * emitters can keep out of its silhouette.
 *
 * Local frame: nose toward -X, up +Y, right wing toward +Z.
 * aMem.x kinds: 0 hide, 1 membrane, 2 eye, 3 horn/claw/tooth, 4 wing bone.
 */

// ---------------------------------------------------------------- shading
const VERT = /* glsl */ `
  attribute vec2 aMem;
  uniform float uWing, uSide, uBend, uSweep;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vL;
  varying vec3 vNL;
  varying vec2 vMem;
  const float WRIST = 7.2;
  void main() {
    vec3 p = position;
    vec3 n = normal;
    vL = position;
    vNL = normal;
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
  uniform float uWing;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vL;
  varying vec3 vNL;
  varying vec2 vMem;
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  // F1/F2 cellular distance: the scale cells and their crevices
  vec2 cells(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    float f1 = 8.0, f2 = 8.0;
    for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
      vec3 g = vec3(float(a), float(b), float(c));
      vec3 r = g + hash3(i + g) * 0.85 - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return vec2(sqrt(f1), sqrt(f2));
  }
  void main() {
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vW);
    float ndv = dot(N, V);
    float kind = vMem.x;
    float thin = vMem.y;
    vec3 albedo;
    float cav = 1.0;
    float gloss = 0.25;
    if (kind < 0.5) {
      // hide: Voronoi scales, larger over the back, fine on the neck/limbs
      vec2 c = cells(vL * vec3(3.4, 4.4, 4.4));
      float edge = smoothstep(0.02, 0.16, c.y - c.x);
      cav = mix(0.55, 1.0, edge) * (0.85 + 0.15 * (1.0 - c.x));
      float back = smoothstep(0.1, 0.85, vNL.y);
      vec3 hide = mix(vec3(0.3, 0.04, 0.028), vec3(0.11, 0.02, 0.022), back);
      // ventral plates: transverse ochre bands on the belly and throat
      float belly = smoothstep(-0.3, -0.72, vNL.y) * (uWing > 0.5 ? 0.0 : 1.0);
      float plate = smoothstep(0.0, 0.14, abs(fract(vL.x * 1.7) - 0.5) * 2.0);
      vec3 bellyC = vec3(0.46, 0.25, 0.1) * mix(0.45, 1.0, plate);
      albedo = mix(hide * cav, bellyC, belly);
      gloss = mix(0.35, 0.15, belly) * cav;
    } else if (kind < 1.5) {
      albedo = vec3(0.15, 0.018, 0.016);
      gloss = 0.12;
    } else if (kind < 2.5) {
      albedo = vec3(0.0);
    } else if (kind < 3.5) {
      // horn / claw / tooth: dark root to ivory tip (thin = tip fraction)
      albedo = mix(vec3(0.07, 0.05, 0.04), vec3(0.62, 0.55, 0.42), thin);
      gloss = 0.6;
    } else {
      albedo = vec3(0.13, 0.03, 0.026);
      gloss = 0.3;
    }
    // lighting: warm low-sun key (wrapped), cool sky dome, warm bounce from
    // the burning city below, a faint camera-side fill so the red still reads
    float ndl = dot(N, uSun);
    float wrap = max(0.0, (ndl + 0.25) / 1.25);
    vec3 sunC = uRim * 1.35;
    vec3 lit = sunC * wrap
      + uSky * (0.35 + 0.65 * max(N.y, 0.0)) * 0.5
      + vec3(0.55, 0.22, 0.1) * max(0.0, -N.y) * 0.55
      + vec3(0.42, 0.24, 0.2) * max(0.0, ndv) * 0.18;
    vec3 col = albedo * lit;
    vec3 H = normalize(uSun + V);
    col += sunC * pow(max(dot(N, H), 0.0), 36.0) * gloss * 0.9 * step(0.0, ndl);
    float fres = pow(1.0 - abs(ndv), 4.0);
    if (kind > 0.5 && kind < 1.5) {
      // membrane subsurface: the sun through thin skin, darker veins off the bones
      float back = max(0.0, dot(-V, uSun));
      float veinA = 1.0 - smoothstep(0.0, 0.07, abs(fract(thin * 4.0 + sin(vL.x * 0.9 + vL.z * 0.7) * 0.18) - 0.5));
      float veinB = 1.0 - smoothstep(0.0, 0.05, abs(fract((vL.x * 0.55 - vL.z * 0.35) * 0.6) - 0.5));
      float vein = max(veinA * 0.7, veinB * 0.4) * smoothstep(0.15, 0.5, thin);
      float trans = thin * (0.18 + 1.5 * pow(back, 2.2));
      vec3 glow = mix(vec3(0.42, 0.03, 0.015), vec3(0.95, 0.2, 0.04), thin * thin * back);
      col += glow * trans * 0.42 * (1.0 - vein * 0.75);
      fres *= 0.35;
    }
    // separation from the warm sky: a cool lilac rim on the upper silhouette,
    // a thin hot edge only on lines that face the sun
    vec3 sp = uSun - V * dot(uSun, V);
    float spl = length(sp);
    float edgeSun = max(0.0, dot(N, sp / max(spl, 1e-4))) * spl;
    col += uSky * fres * (0.1 + 1.1 * smoothstep(-0.1, 0.8, N.y)) * 1.25;
    col += uRim * fres * edgeSun * 0.9;
    if (kind > 1.5 && kind < 2.5) col = vec3(1.9, 0.75, 0.18);  // ember eyes
    if (uClassic > 0.5) col = vec3(0.0);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

// ---------------------------------------------------------------- geometry helpers
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

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

/**
 * Loft a cross-section along a curve. prof(s) → {h, w}; shape(sa, ca, s) →
 * [yk, xk] multipliers (keel, flat belly, wedge). Ends are closed with a fan.
 * kindFn(s) → [kind, thin] per ring (horns fade root→tip).
 */
function loft(points, prof, { NS = 24, NR = 12, shape = null, ref = V3(0, 1, 0), kind = 0, kindFn = null, closeEnds = true } = {}) {
  const curve = Array.isArray(points) ? new THREE.CatmullRomCurve3(points) : points;
  const pos = [];
  const idx = [];
  const mem = [];
  let nUp = null;
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    const p = curve.getPointAt(s);
    const t = curve.getTangentAt(s);
    // parallel-transport-ish frame seeded from ref
    if (!nUp) {
      nUp = ref.clone().sub(t.clone().multiplyScalar(ref.dot(t)));
      if (nUp.lengthSq() < 1e-4) nUp = V3(1, 0, 0).sub(t.clone().multiplyScalar(t.x));
      nUp.normalize();
    } else {
      nUp.sub(t.clone().multiplyScalar(nUp.dot(t))).normalize();
    }
    const side = new THREE.Vector3().crossVectors(t, nUp).normalize();
    const { h, w } = prof(s);
    const [kd, th] = kindFn ? kindFn(s) : [kind, 0];
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const [yk, xk] = shape ? shape(sa, ca, s) : [1, 1];
      const v = p.clone().addScaledVector(nUp, sa * h * yk).addScaledVector(side, ca * w * xk);
      pos.push(v.x, v.y, v.z);
      mem.push(kd, th);
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
  if (closeEnds) {
    for (const [ring, flip] of [[0, true], [NS, false]]) {
      const p = curve.getPointAt(ring / NS);
      const [kd, th] = kindFn ? kindFn(ring / NS) : [kind, 0];
      pos.push(p.x, p.y, p.z);
      mem.push(kd, th);
      const c = pos.length / 3 - 1;
      for (let j = 0; j < NR; j++) {
        const a = ring * NR + j;
        const b = ring * NR + ((j + 1) % NR);
        if (flip) idx.push(c, a, b); else idx.push(c, b, a);
      }
    }
  }
  return geo(pos, idx, mem);
}

/** Tapered round tube through points (bones, toes, horns). */
function tube(points, r0, r1, { NS = 8, NR = 7, kind = 0, tip = false, bulge = 0 } = {}) {
  return loft(points, (s) => {
    const r = (r0 + (r1 - r0) * s) * (1 + bulge * Math.sin(Math.PI * Math.min(1, s * 1.4)));
    return { h: r, w: r };
  }, { NS, NR, kind, kindFn: tip ? (s) => [3, Math.pow(s, 1.5)] : null });
}

/** Curved claw/horn: a tube tapering to a point, ivory at the tip. */
function talon(a, dir, len, r, curl = V3(0, -1, 0), seg = 5) {
  const d = dir.clone().normalize();
  const p1 = a.clone().addScaledVector(d, len * 0.5).addScaledVector(curl, len * 0.08);
  const p2 = a.clone().addScaledVector(d, len * 0.9).addScaledVector(curl, len * 0.35);
  return tube([a, p1, p2], r, r * 0.05, { NS: 5, NR: seg, tip: true });
}

function ellipsoid(c, sx, sy, sz, kind = 0, rot = null) {
  const g = new THREE.SphereGeometry(1, 10, 7);
  g.scale(sx, sy, sz);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
  g.translate(c.x, c.y, c.z);
  return tag(g, kind, 0);
}

/** Flattened triangular dorsal spine plate. */
function plate(base, hgt, len, lean = 0.45) {
  const g = new THREE.ConeGeometry(len * 0.5, hgt, 4, 1);
  g.scale(1, 1, 0.28);
  g.translate(0, hgt / 2, 0);
  g.rotateZ(-lean);
  g.translate(base.x, base.y, base.z);
  return tag(g, 3, 0.25);
}

// ---------------------------------------------------------------- body
function buildBody() {
  const parts = [];
  // neck + trunk + tail: an S-neck from the back of the skull, deep chest,
  // waist, haunch, long tapering tail with a lift at the end
  const spine = new THREE.CatmullRomCurve3(
    [[-9.0, 2.25], [-7.9, 2.35], [-6.7, 1.95], [-5.3, 1.15], [-3.7, 0.45], [-1.8, 0.1], [0.5, 0.0], [2.6, 0.05], [4.5, 0.12],
      [6.9, 0.25], [9.6, 0.08], [12.5, -0.32], [15.2, -0.15], [17.6, 0.25]].map(([x, y]) => V3(x, y, 0)),
  );
  const H = [[0, 0.44], [0.06, 0.46], [0.13, 0.55], [0.2, 0.86], [0.27, 1.22], [0.33, 1.3], [0.4, 1.08], [0.46, 0.86], [0.52, 0.94], [0.58, 0.72], [0.68, 0.42], [0.8, 0.22], [0.92, 0.1], [1, 0.03]];
  const W = [[0, 0.4], [0.06, 0.4], [0.13, 0.48], [0.2, 0.76], [0.27, 1.02], [0.33, 1.05], [0.4, 0.9], [0.46, 0.74], [0.52, 0.86], [0.58, 0.64], [0.68, 0.38], [0.8, 0.2], [0.92, 0.09], [1, 0.03]];
  parts.push(loft(spine, (s) => ({ h: lerpKeys(H, s), w: lerpKeys(W, s) }), {
    NS: 110,
    NR: 18,
    shape: (sa, ca, s) => {
      // keeled chest and flat-ish belly, a ridged spine, slab-sided neck
      const chest = Math.exp(-Math.pow((s - 0.31) / 0.08, 2));
      const yk = sa > 0 ? 0.9 + 0.16 * Math.pow(sa, 12) : 0.88 + 0.22 * chest * Math.pow(-sa, 3);
      const xk = 1 - 0.08 * Math.pow(Math.abs(sa), 2) * (1 - chest);
      return [yk, xk];
    },
  }));
  const at = (s, upK = 0, sideK = 0) => {
    const p = spine.getPointAt(s);
    const t = spine.getTangentAt(s);
    const n = V3(-t.y, t.x, 0).normalize();
    return p.clone().addScaledVector(n, lerpKeys(H, s) * upK).add(V3(0, 0, lerpKeys(W, s) * sideK));
  };
  // shoulder/pectoral mass where the wings root, and haunch muscle
  for (const z of [-1, 1]) {
    parts.push(ellipsoid(at(0.3, 0.35, 0.62 * z), 1.35, 0.9, 0.55, 0, new THREE.Euler(0, 0, -0.35)));
    parts.push(ellipsoid(at(0.53, -0.05, 0.6 * z), 0.95, 0.72, 0.42, 0, new THREE.Euler(0, 0, 0.25)));
  }

  // ---- head: wedge skull (flat crown, cheeks), snout, brow ridges, open jaw
  const skull = new THREE.CatmullRomCurve3([V3(-8.6, 2.3, 0), V3(-9.4, 2.32, 0), V3(-10.5, 2.15, 0), V3(-11.6, 1.95, 0), V3(-12.5, 1.78, 0)]);
  const SH = [[0, 0.5], [0.18, 0.56], [0.4, 0.4], [0.7, 0.3], [0.92, 0.24], [1, 0.1]];
  const SW = [[0, 0.46], [0.18, 0.52], [0.4, 0.38], [0.7, 0.28], [0.92, 0.25], [1, 0.12]];
  parts.push(loft(skull, (s) => ({ h: lerpKeys(SH, s), w: lerpKeys(SW, s) }), {
    NS: 26,
    NR: 16,
    shape: (sa, ca) => {
      // superellipse: squared-off wedge with a flat crown and flat jaw line
      const yk = sa > 0 ? Math.pow(Math.abs(sa), -0.55) * 0.85 : Math.pow(Math.abs(sa), -0.35) * 0.55;
      const xk = Math.pow(Math.abs(ca), -0.45);
      return [Math.min(yk, 2.2), Math.min(xk, 2.2)];
    },
  }));
  // lower jaw, agape ~14°
  const jaw = new THREE.CatmullRomCurve3([V3(-8.9, 1.88, 0), V3(-9.8, 1.7, 0), V3(-11.0, 1.42, 0), V3(-12.0, 1.2, 0)]);
  parts.push(loft(jaw, (s) => ({ h: 0.2 * (1 - 0.55 * s), w: 0.42 * (1 - 0.6 * s) + 0.04 }), {
    NS: 12,
    NR: 10,
    shape: (sa) => [sa > 0 ? 0.6 : 1, 1],
  }));
  // teeth on both jaws
  for (const z of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const f = i / 3;
      const top = V3(-10.0 - f * 2.2, 2.05 - f * 0.33, z * (0.3 - f * 0.14));
      parts.push(talon(top, V3(0, -1, 0), 0.24 - f * 0.08, 0.045, V3(0.3, 0, 0), 4));
      const bot = V3(-9.9 - f * 2.0, 1.72 - f * 0.48, z * (0.32 - f * 0.18));
      parts.push(talon(bot, V3(0, 1, 0), 0.16, 0.035, V3(0.2, 0, 0), 4));
    }
    // brow ridge over the eye, cheek spur, nostril
    parts.push(ellipsoid(V3(-9.75, 2.62, z * 0.4), 0.62, 0.16, 0.2, 0, new THREE.Euler(z * 0.25, 0, -0.12)));
    parts.push(ellipsoid(V3(-12.15, 2.05, z * 0.2), 0.22, 0.1, 0.1));
    parts.push(talon(V3(-9.0, 1.95, z * 0.45), V3(1, -0.15, z * 0.5), 0.9, 0.09));
    // horns: a big swept pair from the crown and a smaller pair below
    parts.push(tube([V3(-9.1, 2.6, z * 0.3), V3(-8.2, 3.05, z * 0.42), V3(-7.1, 3.25, z * 0.55), V3(-6.2, 3.05, z * 0.6)], 0.2, 0.015, { NS: 10, NR: 7, tip: true }));
    parts.push(tube([V3(-8.9, 2.25, z * 0.42), V3(-8.2, 2.35, z * 0.62), V3(-7.5, 2.55, z * 0.72)], 0.12, 0.01, { NS: 6, NR: 6, tip: true }));
    // eye
    const eye = new THREE.SphereGeometry(0.09, 8, 6);
    eye.translate(-9.85, 2.48, z * 0.44);
    parts.push(tag(eye, 2, 0));
  }
  // nose horn
  parts.push(talon(V3(-11.9, 2.15, 0), V3(-0.3, 1, 0), 0.45, 0.08, V3(1, 0, 0)));

  // ---- dorsal spine row: crown to tail, tallest over the shoulders
  for (let s = 0.02; s < 0.95; s += 0.022) {
    const base = at(s, 0.95);
    const hk = s < 0.2 ? 0.32 : s < 0.5 ? 0.5 + 0.2 * Math.exp(-Math.pow((s - 0.32) / 0.08, 2)) : 0.45 * (1 - (s - 0.5) * 1.6);
    const hgt = Math.max(0.12, hk * (s < 0.2 ? 1 : lerpKeys(H, s) * 0.85 + 0.3));
    parts.push(plate(base, hgt, Math.max(0.16, hgt * 0.7), 0.5));
  }
  // tail spade: a flattened arrowhead
  const tip = spine.getPointAt(1);
  const spade = new THREE.ConeGeometry(0.8, 1.9, 4, 1);
  spade.scale(1, 1, 0.18);
  spade.rotateZ(-Math.PI / 2);
  spade.rotateX(Math.PI / 2);
  spade.translate(tip.x + 0.7, tip.y, 0);
  parts.push(tag(spade, 0, 0));

  // ---- forelegs tucked under the chest: upper arm, forearm, clawed hand
  for (const z of [-1, 1]) {
    const sh = at(0.3, -0.45, 0.7 * z);
    const el = sh.clone().add(V3(0.75, -1.1, 0.22 * z));
    const wr = el.clone().add(V3(-1.05, -0.45, 0.04 * z));
    parts.push(tube([sh, sh.clone().lerp(el, 0.5).add(V3(0.1, 0, 0)), el], 0.42, 0.22, { bulge: 0.2 }));
    parts.push(tube([el, wr], 0.22, 0.15));
    for (let c = -1; c <= 1; c++) {
      const k = wr.clone().add(V3(-0.32, -0.1, c * 0.13));
      parts.push(tube([wr, k], 0.09, 0.07, { NS: 2, NR: 5 }));
      parts.push(talon(k, V3(-0.6, -0.5, c * 0.15), 0.42, 0.065));
    }
    // ---- hind legs trailing: muscular thigh, shank, metatarsus, 4-toed taloned foot
    const hip = at(0.53, -0.25, 0.72 * z);
    const kn = hip.clone().add(V3(1.0, -1.25, 0.28 * z));
    const an = kn.clone().add(V3(1.75, -0.3, -0.04 * z));
    const ft = an.clone().add(V3(0.85, -0.15, 0));
    parts.push(tube([hip, hip.clone().lerp(kn, 0.45).add(V3(0.18, 0.05, 0.1 * z)), kn], 0.6, 0.27, { NS: 10, NR: 10, bulge: 0.15 }));
    parts.push(tube([kn, kn.clone().lerp(an, 0.4).add(V3(0, 0.12, 0)), an], 0.32, 0.17, { bulge: 0.2 }));
    parts.push(tube([an, ft], 0.17, 0.14));
    parts.push(ellipsoid(kn, 0.28, 0.25, 0.27));
    for (let c = 0; c < 4; c++) {
      const spread = (c - 1.5) * 0.17;
      const dir = c === 3 ? V3(-0.6, 0.1, z * 0.6) : V3(1, -0.18, spread * z * 2);
      const k1 = ft.clone().addScaledVector(dir.normalize(), c === 3 ? 0.3 : 0.48);
      parts.push(tube([ft, k1], 0.1, 0.075, { NS: 2, NR: 5 }));
      parts.push(talon(k1, c === 3 ? dir : V3(0.8, -0.55, spread * z), 0.55, 0.075));
    }
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return { geometry: g, shoulder: at(0.305, 0.62, 0.55) };
}

// ---------------------------------------------------------------- wing
/**
 * Wing in local space: chord along +X (aft), span along +Z (outward), y up.
 * Arm S→E→W, four fingers fanning from the wrist; scalloped membrane panels
 * between them carry a "thinness" (0 at a bone, 1 mid-panel) for the shader.
 */
function buildWing() {
  const P = (c, s, y = 0) => V3(c, y, s);
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
  for (let f = 0; f < 3; f++) {
    const A = F[f];
    const B = F[f + 1];
    sheet(10, 10, (r, a) => {
      const edge = A.clone().lerp(B, a);
      edge.lerp(W, 0.3 * tri(a));
      const v = W.clone().lerp(edge, r);
      const bd = Math.min(a, 1 - a) * 2;
      v.y -= 0.42 * tri(a) * tri(r);
      const thin = Math.min(1, bd * 1.6) * Math.min(1, r * 3) * (1 - 0.35 * Math.pow(r, 6));
      return { v, thin };
    });
  }
  const arm = (u) => (u < 0.5 ? S.clone().lerp(E, u * 2) : E.clone().lerp(W, (u - 0.5) * 2));
  const trail = (u) => {
    const v = T.clone().lerp(F[3], u);
    const l = arm(u);
    return v.lerp(l, 0.22 * tri(u));
  };
  sheet(12, 10, (u, w) => {
    const v = arm(u).lerp(trail(u), w);
    v.y -= 0.5 * tri(w) * tri(u);
    const thin = Math.min(1, w * 3.2) * Math.min(1, (1 - u) * 6 + 0.15) * (1 - 0.3 * Math.pow(w, 6));
    return { v, thin };
  });
  const membrane = geo(pos, idx, mem);
  // bones: a thick muscled humerus and forearm, wrist knuckle, finger bones
  // with knuckle joints that taper to the tips, and a hooked thumb claw
  const B = (pts, r0, r1, o = {}) => {
    const g = tube(pts, r0, r1, o);
    const m = g.attributes.aMem;
    for (let i = 0; i < m.count; i++) m.setX(i, 4);
    return g;
  };
  const parts = [membrane, B([S, S.clone().lerp(E, 0.5).add(V3(0, 0.12, 0)), E], 0.5, 0.26, { NS: 8, NR: 9, bulge: 0.25 }), B([E, W], 0.26, 0.17, { NR: 8 })];
  parts.push(ellipsoid(W, 0.3, 0.26, 0.3, 4));
  parts.push(ellipsoid(E, 0.3, 0.28, 0.3, 4));
  for (const f of F) {
    const k = W.clone().lerp(f, 0.42);
    parts.push(B([W, k], 0.14, 0.1, { NS: 4, NR: 6 }), B([k, f], 0.1, 0.025, { NS: 6, NR: 6 }));
    parts.push(ellipsoid(k, 0.13, 0.12, 0.13, 4));
  }
  parts.push(talon(W.clone().add(V3(-0.1, 0.1, 0.1)), V3(-0.9, 0.3, 0.4), 0.85, 0.1, V3(0, -1, 0)));
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
    uRim: { value: new THREE.Color(1.0, 0.52, 0.26) },
    uSky: { value: new THREE.Color(0.42, 0.44, 0.78) },
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
  // footprint probes (local): nose, tail, belly, crown, wingtips, mid-wing
  const probes = [V3(-12.5, 2, 0), V3(18, 0, 0), V3(5, -2.2, 0), V3(-6, 3.4, 0), V3(-0.5, 2.5, 15), V3(-0.5, 2.5, -15), V3(4, 1.6, 9), V3(4, 1.6, -9)];
  const mask = new THREE.Vector4(0, 0, 0, 0);
  const pr = new THREE.Vector3();

  return {
    group,
    uniforms: shared,
    /** NDC footprint of the dragon (cx, cy, rx, ry); rx = 0 when hidden. */
    mask,
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
      mask.set(0, 0, 0, 0);
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
      xa.copy(fwd).negate();
      ya.copy(upW).addScaledVector(fwd, -upW.dot(fwd)).normalize();
      za.crossVectors(xa, ya);
      basis.makeBasis(xa, ya, za);
      group.quaternion.setFromRotationMatrix(basis);
      qBank.setFromAxisAngle(ax, (lane.bank ?? 0.18) + Math.sin(lt * 0.37) * 0.05);
      group.quaternion.multiply(qBank);
      group.rotateZ(-0.06 + ps.beat * 0.04);
      group.position.copy(p0);
      group.position.y += -ps.beat * 0.35 * (lane.scale ?? 1);
      group.scale.setScalar(lane.scale ?? 1);
      for (const w of wings) {
        const s = w.userData.side;
        w.rotation.x = -ps.arm * s;
        w.rotation.y = ps.sweep * 0.4 * s;
        w.userData.mat.uniforms.uBend.value = ps.hand;
        w.userData.mat.uniforms.uSweep.value = ps.sweep;
      }
      // screen footprint for the ember mask
      group.updateMatrixWorld(true);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const q of probes) {
        pr.copy(q).applyMatrix4(group.matrixWorld).project(camera);
        x0 = Math.min(x0, pr.x); x1 = Math.max(x1, pr.x);
        y0 = Math.min(y0, pr.y); y1 = Math.max(y1, pr.y);
      }
      if (fade > 0.05) mask.set((x0 + x1) / 2, (y0 + y1) / 2, Math.max(0.01, (x1 - x0) / 2), Math.max(0.01, (y1 - y0) / 2));
    },
    dispose() {
      bodyGeo.dispose();
      wingGeoR.dispose();
      wingGeoL.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
