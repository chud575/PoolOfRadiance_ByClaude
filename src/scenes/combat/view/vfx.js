import * as THREE from 'three';
import { getGlowTexture } from '../../../render/textures/index.js';

/**
 * Spell & combat VFX. Every effect is a pure function of its age (t - start),
 * so frozen-clock screenshots (e.g. fireball mid-explosion at a fixed t) are
 * deterministic. Particles are analytic GPU points (no CPU simulation).
 */
const hashf = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------ particles
const PARTICLE_VS = `
  attribute vec3 aV; attribute vec4 aD;
  uniform float uAge, uDrag, uGrav, uGrow, uPix, uTurb, uFloor;
  varying float vLife; varying float vSeed;
  void main(){
    float t = uAge - aD.x;
    float life = t / aD.y;
    vLife = life; vSeed = aD.w;
    vec3 p = position;
    if (t > 0.0) {
      float k = uDrag > 0.0 ? (1.0 - exp(-uDrag * t)) / uDrag : t;
      p += aV * k;
      p.y -= 0.5 * uGrav * t * t;
      p.x += sin(t * 2.3 + aD.w * 40.0) * uTurb * t;
      p.z += cos(t * 1.9 + aD.w * 23.0) * uTurb * t;
      p.y = max(p.y, uFloor);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float sz = aD.z * (1.0 + uGrow * clamp(life, 0.0, 1.0));
    gl_PointSize = (t < 0.0 || life > 1.0) ? 0.0 : sz * uPix / max(0.1, -mv.z);
  }`;
const PARTICLE_FS = `
  uniform vec3 uC0, uC1, uC2; uniform float uIntensity, uSoft, uFadeIn;
  varying float vLife; varying float vSeed;
  void main(){
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float disc = 1.0 - smoothstep(1.0 - uSoft, 1.0, r);
    if (disc <= 0.0) discard;
    float l = clamp(vLife, 0.0, 1.0);
    vec3 c = l < 0.5 ? mix(uC0, uC1, l * 2.0) : mix(uC1, uC2, (l - 0.5) * 2.0);
    float a = disc * smoothstep(0.0, uFadeIn, l) * (1.0 - smoothstep(0.6, 1.0, l));
    gl_FragColor = vec4(c * uIntensity, a);
  }`;

/**
 * Burst of analytic particles.
 * @param {object} o
 */
export function particleBurst(o) {
  const n = o.count ?? 40;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const dat = new Float32Array(n * 4);
  const seed = o.seed ?? 1;
  for (let i = 0; i < n; i++) {
    const r = (k) => hashf(seed * 91.7 + i * 13.3 + k * 7.1);
    const sp = o.spread ?? 0.1;
    let px = o.at.x + (r(1) - 0.5) * sp * 2;
    let py = o.at.y + (r(2) - 0.5) * sp * (o.flatY ? 0.3 : 2);
    let pz = o.at.z + (r(3) - 0.5) * sp * 2;
    if (o.emit) [px, py, pz] = o.emit(i, r);
    pos.set([px, py, pz], i * 3);
    let v;
    if (o.velocity) v = o.velocity(i, r);
    else {
      const th = r(4) * Math.PI * 2;
      const ph = Math.acos(1 - 2 * r(5)) * (o.hemi ? 0.5 : 1);
      const s = (o.speed ?? 2) * (0.4 + r(6) * 0.6);
      v = [Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s * (o.up ?? 1), Math.sin(ph) * Math.sin(th) * s];
      if (o.dir) v = [v[0] * 0.4 + o.dir.x * s, v[1] * 0.4 + o.dir.y * s, v[2] * 0.4 + o.dir.z * s];
    }
    vel.set(v, i * 3);
    dat.set([(o.delay ?? 0) + r(7) * (o.stagger ?? 0), (o.life ?? 1) * (0.6 + r(8) * 0.4), (o.size ?? 0.1) * (0.6 + r(9) * 0.8), r(10)], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dat, 4));
  const cols = (o.colors ?? [0xffffff, 0xffc060, 0x802000]).map((c) => new THREE.Color(c));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: {
      uAge: { value: 0 }, uDrag: { value: o.drag ?? 1.5 }, uGrav: { value: o.gravity ?? 0 }, uGrow: { value: o.grow ?? 0 },
      uPix: { value: 600 }, uTurb: { value: o.turb ?? 0 }, uFloor: { value: o.floor ?? -99 },
      uC0: { value: cols[0] }, uC1: { value: cols[1] ?? cols[0] }, uC2: { value: cols[2] ?? cols[1] ?? cols[0] },
      uIntensity: { value: o.intensity ?? 1.5 }, uSoft: { value: o.soft ?? 0.6 }, uFadeIn: { value: o.fadeIn ?? 0.05 },
    },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  const life = (o.delay ?? 0) + (o.stagger ?? 0) + (o.life ?? 1) + 0.05;
  return {
    obj: pts,
    life,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      mat.uniforms.uPix.value = ctx.pix;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ primitives
function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  s.renderOrder = 7;
  return s;
}

const NOISE_GLSL = `
  vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
  float noise3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                   mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                   mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
  float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }
`;

/**
 * Ray-marched volumetric fire/smoke ball. A unit sphere (scaled/positioned by
 * the caller) bounds a domain-warped fBm density field; each pixel marches it
 * front to back, turning density + distance from the core into temperature:
 * white-hot heart → yellow → orange flame tongues → dull red → absorbing soot
 * that is lit from inside by the fire and from above by the sky. Ground clips
 * the march (uFloor, object space) so the blast hugs the cobbles. Output is
 * premultiplied; hot emission is rolled off so ACES keeps the hue.
 * Uniforms animated by the caller: uGrow (fireball radius in sphere units),
 * uHeat, uErode (tears holes as it burns out), uSmoke (cools edges to soot),
 * uFade, uAge, uCam (camera in object space), uFloor.
 */
function volumeFire({ steps = 24, smoke = false, gas = false } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uCam: { value: new THREE.Vector3(0, 0, 5) }, uAge: { value: 0 }, uSeed: { value: 0 }, uGrow: { value: 0.5 }, uHeat: { value: 1 },
      uErode: { value: 0 }, uSmoke: { value: 0 }, uFade: { value: 1 }, uFloor: { value: -10 }, uFreq: { value: 3.3 }, uSky: { value: new THREE.Color(0x3a4048) }, uDrift: { value: new THREE.Vector3(0, -1.3, 0) },
    },
    vertexShader: 'varying vec3 vO; void main(){ vO = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uCam, uSky, uDrift; uniform float uAge, uSeed, uGrow, uHeat, uErode, uSmoke, uFade, uFloor, uFreq;
      varying vec3 vO;
      float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + vec3(1.7, 9.2, 3.3); a *= 0.5; } return s / 0.9375; }
      // Returns density (>0 inside); n = turbulence, core = 1 at the heart.
      // Large billowing lobes (low-frequency, domain-warped) with finer curl on
      // the rim: reads as a rolling fireball, not a flat noise texture.
      float field(vec3 p, out float n, out float core){
        float r = length(p);
        vec3 q = p * uFreq + uDrift * uAge + uSeed;
        float w = vn(q * 0.55 + 4.3);
        float b1 = vn(q * 0.9 + w * 1.6);
        float b2 = vn(q * 2.1 + w * 2.2 + 7.1);
        float b3 = vn(q * 4.6 + 3.3 - vec3(0.0, uAge * 2.0, 0.0));
        float lob = 1.0 - abs(b1 * 2.0 - 1.0);
        n = clamp(lob * 0.55 + b2 * 0.3 + b3 * 0.15, 0.0, 1.0);
        float g = max(uGrow, 0.02);
        float rad = g * (0.58 + 0.62 * n);
        core = clamp(1.0 - r / (g * 0.95), 0.0, 1.0);
        float d = (rad - r) / g;
        d -= uErode * (1.05 - n) * 1.6;
        return d;
      }
      void main(){
        vec3 ro = uCam;
        vec3 rd = normalize(vO - uCam);
        float b = dot(ro, rd); float c = dot(ro, ro) - 1.0; float h = b * b - c;
        if (h <= 0.0) discard;
        h = sqrt(h);
        float t0 = max(-b - h, 0.0); float t1 = -b + h;
        if (rd.y < -0.0001) t1 = min(t1, (uFloor - ro.y) / rd.y);
        if (t1 <= t0) discard;
        const int N = ${steps};
        float dt = (t1 - t0) / float(N);
        float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 col = vec3(0.0); float T = 1.0;
        for (int i = 0; i < N; i++) {
          vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
          float n, core;
          float d = field(p, n, core);
          if (d > 0.0) {
            float dens = clamp(d * 5.0, 0.0, 1.0);
            ${gas ? `
            // Stinking cloud: dense, low, sickly yellow-green vapour — paler on
            // the curling tops (sky-lit), dark olive in the folds beneath.
            float a = 1.0 - exp(-dens * mix(1.2, 5.0, n * n) * dt);
            // One self-shadow tap toward the sky: billow tops lit, undersides dark.
            float nU, cU;
            float dUp = field(p + vec3(0.05, 0.22, 0.03), nU, cU);
            float lit = exp(-max(dUp, 0.0) * 5.0);
            float shade = clamp(lit * 0.35 + smoothstep(0.3, 0.8, n) * 0.85 - 0.15, 0.0, 1.0);
            vec3 sc = mix(vec3(0.01, 0.013, 0.003), vec3(0.13, 0.14, 0.03), shade);
            sc = mix(sc, sc * vec3(1.15, 1.0, 0.55), smoothstep(0.55, 0.9, n));
            sc *= 0.55 + 0.6 * clamp(p.y * 0.9 + 0.55, 0.0, 1.0);
            sc += vec3(0.06, 0.07, 0.012) * pow(n, 4.0) * lit;
            sc *= uHeat;
            col += T * a * sc;` : smoke ? `
            float a = 1.0 - exp(-dens * 5.5 * dt);
            vec3 sc = mix(vec3(0.02, 0.018, 0.017), vec3(0.17, 0.16, 0.15), n * n);
            sc += uSky * clamp(p.y * 1.2 + 0.25, 0.0, 1.0) * (0.25 + n * 0.8);
            sc += vec3(1.0, 0.32, 0.06) * uHeat * clamp(0.5 - p.y, 0.0, 1.0) * core * 1.4;
            col += T * a * sc;` : `
            float temp = uHeat * (0.24 + core * 0.9 + (n - 0.5) * 1.25) - uSmoke * (1.0 - core) * 1.05;
            float a = 1.0 - exp(-dens * mix(7.0, 12.0, clamp(temp, 0.0, 1.0)) * dt);
            vec3 soot = mix(vec3(0.02, 0.017, 0.015), vec3(0.15, 0.12, 0.1), n * n);
            soot += uSky * clamp(p.y * 1.2 + 0.2, 0.0, 1.0) * 0.7 * n;
            vec3 e = vec3(0.4, 0.045, 0.008) * smoothstep(0.08, 0.3, temp);
            e = mix(e, vec3(1.0, 0.3, 0.035) * 0.95, smoothstep(0.28, 0.52, temp));
            e = mix(e, vec3(1.0, 0.56, 0.14) * 1.3, smoothstep(0.52, 0.8, temp));
            e = mix(e, vec3(1.0, 0.82, 0.5) * 1.75, smoothstep(0.88, 1.35, temp));
            // Soot near the cool edge picks up the fire's own glow from within.
            soot += vec3(0.9, 0.25, 0.04) * clamp(uHeat, 0.0, 1.0) * 0.35 * smoothstep(-0.1, 0.25, temp);
            vec3 sc = mix(soot, e, smoothstep(0.08, 0.3, temp));
            col += T * a * sc;`}
            T *= 1.0 - a;
            if (T < 0.015) break;
          }
        }
        float A = (1.0 - T) * uFade;
        gl_FragColor = vec4(col * uFade, A);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
  mesh.renderOrder = smoke || gas ? 8 : 9;
  mesh.frustumCulled = false;
  const inv = new THREE.Matrix4();
  return {
    obj: mesh,
    u: mat.uniforms,
    /** Call after positioning/scaling: camera into object space, ground height. */
    sync(camera, groundY = 0) {
      mesh.updateMatrixWorld(true);
      inv.copy(mesh.matrixWorld).invert();
      if (camera) mat.uniforms.uCam.value.copy(camera.position).applyMatrix4(inv);
      mat.uniforms.uFloor.value = (groundY - mesh.position.y) / mesh.scale.y;
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

/**
 * Ember sparks rendered as velocity-stretched screen-space streaks (a quad from
 * the spark's position a moment ago to now), analytic so they freeze cleanly.
 */
function sparkStreaks(o) {
  const n = o.count ?? 60;
  const seed = o.seed ?? 1;
  const pos = new Float32Array(n * 4 * 3);
  const vel = new Float32Array(n * 4 * 3);
  const dat = new Float32Array(n * 4 * 4);
  const corner = new Float32Array(n * 4 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const r = (k) => hashf(seed * 53.1 + i * 17.7 + k * 3.3);
    const th = r(1) * Math.PI * 2;
    const up = o.hemi ? 0.15 + r(2) * 0.85 : r(2) * 2 - 1;
    const hor = Math.sqrt(Math.max(0, 1 - up * up));
    const s = (o.speed ?? 8) * (0.35 + r(3) * 0.65);
    const v = [Math.cos(th) * hor * s, up * s * (o.up ?? 1), Math.sin(th) * hor * s];
    const start = [o.at.x + Math.cos(th) * hor * (o.r0 ?? 0.2), o.at.y + up * (o.r0 ?? 0.2), o.at.z + Math.sin(th) * hor * (o.r0 ?? 0.2)];
    const d = [(o.delay ?? 0) + r(4) * (o.stagger ?? 0), (o.life ?? 1) * (0.5 + r(5) * 0.5), (o.width ?? 2.5) * (0.6 + r(6) * 0.8), r(7)];
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      pos.set(start, j * 3);
      vel.set(v, j * 3);
      dat.set(d, j * 4);
      corner.set([k < 2 ? 0 : 1, k % 2 ? 1 : -1], j * 2);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dat, 4));
  g.setAttribute('aC', new THREE.BufferAttribute(corner, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uAge: { value: 0 }, uDrag: { value: o.drag ?? 1.4 }, uGrav: { value: o.gravity ?? 7 }, uRes: { value: new THREE.Vector2(1600, 900) }, uStreak: { value: o.streak ?? 0.06 }, uFloor: { value: o.floor ?? 0.03 }, uI: { value: o.intensity ?? 2.5 } },
    vertexShader: `
      attribute vec3 aV; attribute vec4 aD; attribute vec2 aC;
      uniform float uAge, uDrag, uGrav, uStreak, uFloor; uniform vec2 uRes;
      varying float vLife; varying float vAcross; varying float vAlong;
      vec3 P(float t){ float k = (1.0 - exp(-uDrag * t)) / uDrag; vec3 p = position + aV * k; p.y -= 0.5 * uGrav * t * t; p.y = max(p.y, uFloor); return p; }
      void main(){
        float t = uAge - aD.x;
        float life = t / aD.y;
        vLife = life; vAcross = aC.y; vAlong = aC.x;
        if (t <= 0.0 || life >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec4 h = projectionMatrix * modelViewMatrix * vec4(P(t), 1.0);
        vec4 tl = projectionMatrix * modelViewMatrix * vec4(P(max(0.0, t - uStreak)), 1.0);
        vec2 hs = h.xy / h.w; vec2 ts = tl.xy / tl.w;
        vec2 dir = hs - ts; float L = length(dir * uRes);
        dir = L > 0.5 ? normalize(dir * uRes) : vec2(1.0, 0.0);
        vec2 nrm = vec2(-dir.y, dir.x);
        vec4 c = aC.x > 0.5 ? h : tl;
        float w = aD.z * (1.0 - life * 0.6);
        c.xy += nrm * aC.y * w / uRes * c.w;
        if (aC.x > 0.5) c.xy += dir * w * 0.5 / uRes * c.w;
        gl_Position = c;
      }`,
    fragmentShader: `
      uniform float uI; varying float vLife; varying float vAcross; varying float vAlong;
      void main(){
        float a = (1.0 - abs(vAcross)) * mix(0.15, 1.0, vAlong) * (1.0 - smoothstep(0.5, 1.0, vLife));
        vec3 c = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.3, 0.04), smoothstep(0.0, 0.5, vLife));
        gl_FragColor = vec4(c * uI, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  const life = (o.delay ?? 0) + (o.stagger ?? 0) + (o.life ?? 1) + 0.05;
  return {
    obj: mesh,
    life,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      if (ctx.res) mat.uniforms.uRes.value.copy(ctx.res);
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/** Camera-facing tapered trail through a list of points (comet tails). */
function taperTrail(n, colorHead, colorTail, width) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uHead: { value: new THREE.Color(colorHead) }, uTail: { value: new THREE.Color(colorTail) }, uA: { value: 1 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform vec3 uHead, uTail; uniform float uA, uT;
      void main(){
        float u = vUv.x; // 0 = head, 1 = tail end
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float flick = fbm3(vec3(u * 6.0 - uT * 9.0, vUv.y * 3.0, uT)) * 0.5 + 0.5;
        float core = smoothstep(0.5, 1.0, across) * (1.0 - u);
        vec3 c = mix(uHead, uTail, smoothstep(0.0, 0.7, u)) * (1.0 + core * 1.5);
        float a = smoothstep(0.0, 0.7, across) * pow(1.0 - u, 1.4) * (0.55 + flick * 0.6) * uA;
        gl_FragColor = vec4(c * 1.6, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  const _d = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  return {
    obj: mesh,
    /** pts[0] = head. */
    set(pts, camPos) {
      for (let i = 0; i < n; i++) {
        const p = pts[Math.min(i, pts.length - 1)];
        const q = pts[Math.min(i + 1, pts.length - 1)];
        const o = pts[Math.max(i - 1, 0)];
        _d.subVectors(o, q).normalize();
        _v.subVectors(camPos, p).normalize();
        _s.crossVectors(_d, _v).normalize().multiplyScalar(width * (1 - (i / (n - 1)) * 0.85));
        pos.set([p.x - _s.x, p.y - _s.y, p.z - _s.z, p.x + _s.x, p.y + _s.y, p.z + _s.z], i * 6);
      }
      g.attributes.position.needsUpdate = true;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/**
 * Tall billboarded flame tongues (cylindrical billboards, rotate about Y only):
 * noise-licked teardrops with a white-yellow root, orange body and red-black
 * tips, each a pure function of age. Gives a blast vertical mass from a 3/4 view.
 */
function flameTongues(n, seed) {
  const pos = [];
  const uv = [];
  const off = [];
  const dat = [];
  const idx = [];
  for (let i = 0; i < n; i++) {
    const r = (k) => hashf(seed * 31.7 + i * 7.3 + k * 1.9);
    const a = r(1) * Math.PI * 2;
    const rr = Math.sqrt(r(2));
    for (let k = 0; k < 4; k++) {
      pos.push(0, 0, 0);
      uv.push(k % 2, k < 2 ? 0 : 1);
      off.push(Math.cos(a) * rr, Math.sin(a) * rr);
      dat.push(r(3), 0.3 + r(4) * r(4) * 1.4, r(5) * 0.3, 0.5 + r(6) * 0.7);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2));
  g.setAttribute('aD', new THREE.Float32BufferAttribute(dat, 4));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Premultiplied "over": overlapping tongues occlude rather than stacking to white.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    uniforms: { uAge: { value: 0 }, uR: { value: 3 }, uH: { value: 2.5 }, uLife: { value: 1.4 }, uA: { value: 1 }, uCam: { value: new THREE.Vector3() } },
    vertexShader: `
      attribute vec2 aOff; attribute vec4 aD;
      uniform float uAge, uR, uH, uLife; uniform vec3 uCam;
      varying vec2 vUv; varying vec4 vD; varying float vK;
      void main(){
        vUv = uv; vD = aD;
        float t = uAge - aD.z;
        float u = clamp(t / (uLife * aD.w), 0.0, 1.0);
        // Tongues shoot up fast with the blast, lick outward, then shrink and fade.
        float grow = t <= 0.0 ? 0.0 : (1.0 - exp(-t * 11.0)) * (1.0 - smoothstep(0.45, 1.0, u));
        vK = t <= 0.0 || u >= 1.0 ? 0.0 : 1.0 - smoothstep(0.55, 1.0, u);
        float spread = uR * (0.35 + 0.65 * (1.0 - exp(-t * 6.0)));
        vec3 base = (modelMatrix * vec4(aOff.x * spread, 0.0, aOff.y * spread, 1.0)).xyz;
        float h = uH * aD.y * grow * (1.0 - length(aOff) * 0.45);
        float w = h * 0.5 + 0.15 * grow;
        vec3 toCam = uCam - base; toCam.y = 0.0; toCam = normalize(toCam);
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        vec3 p = base + right * (uv.x - 0.5) * w + vec3(0.0, uv.y * h, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uAge, uA; varying vec2 vUv; varying vec4 vD; varying float vK;
      void main(){
        if (vK <= 0.0) discard;
        // Classic licking flame: a teardrop (wide belly, tapering tip) warped by
        // rising noise, with soft edges and a temperature ramp root → tip.
        vec2 q = vec2((vUv.x - 0.5) * 2.0, vUv.y);
        float n = fbm3(vec3(q.x * 1.4 + vD.x * 13.0, q.y * 1.8 - uAge * 3.4, vD.x * 7.0)) * 0.5 + 0.5;
        float n2 = fbm3(vec3(q.x * 3.2, q.y * 3.6 - uAge * 5.5, vD.x * 3.0 + 4.0)) * 0.5 + 0.5;
        q.x += (n - 0.5) * 1.3 * q.y + sin(q.y * 5.0 + vD.x * 20.0 - uAge * 6.0) * 0.12 * q.y;
        float wid = mix(0.95, 0.32, pow(q.y, 0.6)) * (0.75 + 0.5 * n);
        float d = length(vec2(q.x / wid, (q.y - 0.3) * 1.3)) + (n2 - 0.5) * 0.5;
        float fire = (1.0 - smoothstep(0.1, 1.0, d)) * (0.25 + n2 * 0.95) - q.y * 0.45;
        fire = clamp(fire * 1.1, 0.0, 1.0) * vK;
        float alpha = smoothstep(0.08, 0.6, fire);
        vec3 c = mix(vec3(0.35, 0.04, 0.01), vec3(0.95, 0.3, 0.05), smoothstep(0.1, 0.45, fire));
        c = mix(c, vec3(1.0, 0.6, 0.18), smoothstep(0.5, 0.85, fire));
        float A = alpha * uA * 0.8;
        gl_FragColor = vec4(c * 0.9 * A, A * 0.7);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return {
    obj: mesh,
    u: mat.uniforms,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      if (ctx.camera) mat.uniforms.uCam.value.copy(ctx.camera.position);
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/** Expanding ground ring (shockwave / pulses). */
function groundRing(color, soft = 0.2) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uR: { value: 0.5 }, uW: { value: 0.15 }, uA: { value: 1 }, uColor: { value: new THREE.Color(color) }, uSoft: { value: soft } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uR, uW, uA, uSoft; uniform vec3 uColor;
      void main(){ float r = length(vUv * 2.0 - 1.0); float k = 1.0 - smoothstep(0.0, uW, abs(r - uR));
        float inner = smoothstep(uR, 0.0, r) * uSoft;
        gl_FragColor = vec4(uColor * 2.0, (k + inner) * uA); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 5;
  return m;
}

/** Soft, noise-distorted ground shockwave band (radius 0.8 of the plane). */
function shockRing(color) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uA: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform float uT, uA; uniform vec3 uColor;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float n = noise3(vec3(cos(a) * 2.5, sin(a) * 2.5, uT * 3.0)) * 0.06 + noise3(vec3(cos(a) * 7.0, sin(a) * 7.0, uT * 5.0)) * 0.025;
        float d = r - (0.8 + n);
        float band = exp(-d * d / 0.004) * (0.65 + 0.35 * noise3(vec3(p * 6.0, uT)));
        float wake = smoothstep(0.82, 0.2, r) * smoothstep(0.0, 0.5, r) * 0.04;
        float edge = 1.0 - smoothstep(0.92, 1.0, r);
        gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.85, 0.6), 0.3) * 1.6, (band + wake) * edge * uA); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 5;
  return m;
}

/** Soft billboard puff with churning noise (clouds, smoke). */
function puff(color, seed) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uA: { value: 0.5 }, uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      mv.xy += position.xy * sc; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform float uT, uA, uSeed; uniform vec3 uColor;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float n = fbm3(vec3(p * 1.8, uT * 0.25 + uSeed)) * 0.5 + 0.5;
        float n2 = fbm3(vec3(p * 4.0 + 3.0, uT * 0.4 + uSeed * 2.0)) * 0.5 + 0.5;
        float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.8) * (0.55 + n2 * 0.6);
        vec3 c = uColor * (0.7 + n * 0.6);
        gl_FragColor = vec4(c, a * uA); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 9;
  m.frustumCulled = false;
  return m;
}

/** Glowing ribbon through points (lightning, trails). Cross-shaped so it reads from any angle. */
function ribbon(points, width, color) {
  const pos = [];
  const uv = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const planeAxis of [0, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[Math.min(points.length - 1, i + 1)];
      const o = points[Math.max(0, i - 1)];
      const dir = new THREE.Vector3().subVectors(q, o).normalize();
      const side = planeAxis === 0 ? new THREE.Vector3().crossVectors(dir, up).normalize() : up.clone();
      side.multiplyScalar(width);
      pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
      uv.push(i / (points.length - 1), 0, i / (points.length - 1), 1);
      if (i < points.length - 1) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uA;
      void main(){ float a = 1.0 - abs(vUv.y - 0.5) * 2.0; float core = smoothstep(0.6, 1.0, a);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), core) * (1.5 + core * 3.0), smoothstep(0.0, 1.0, a) * uA); }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 8;
  m.frustumCulled = false;
  return m;
}

function jaggedBolt(a, b, seed, rough = 0.5) {
  const pts = [a.clone()];
  const n = Math.max(6, Math.round(a.distanceTo(b) * 3));
  const dir = new THREE.Vector3().subVectors(b, a);
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  for (let i = 1; i < n; i++) {
    const u = i / n;
    const p = a.clone().lerp(b, u);
    const k = Math.sin(u * Math.PI);
    p.addScaledVector(side, (hashf(seed + i * 3.1) - 0.5) * rough * k * 1.6);
    p.y += (hashf(seed + i * 7.7) - 0.5) * rough * k;
    pts.push(p);
  }
  pts.push(b.clone());
  return pts;
}

// ------------------------------------------------------------------ manager
export class VFX {
  constructor(scene, { light } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.effects = [];
    // One pooled point light for spell flashes (constant light count → no shader recompiles).
    this.light = light ?? new THREE.PointLight(0xffa040, 0, 26, 2);
    scene.add(this.light);
    this.lightOwner = null;
    this.ctx = { pix: 600, camera: null };
    this.shake = [];
  }

  /** Register an effect composed of parts; `fn(age, parts)` animates; returns handle. */
  add(start, life, build, animate, o = {}) {
    const parts = build();
    const objs = [];
    for (const p of parts.list ?? []) {
      const obj = p.obj ?? p;
      this.group.add(obj);
      objs.push(p);
    }
    const fx = { start, life, parts, objs, animate, persistent: !!o.persistent, id: o.id, dead: false };
    this.effects.push(fx);
    return fx;
  }

  /** Camera shake impulse at time t. */
  addShake(t, amp = 0.2, dur = 0.4) {
    this.shake.push({ t, amp, dur });
  }

  shakeOffset(t) {
    const o = new THREE.Vector3();
    for (const s of this.shake) {
      const age = t - s.t;
      if (age < 0 || age > s.dur) continue;
      const k = s.amp * (1 - age / s.dur) ** 2;
      o.x += Math.sin(age * 71 + s.t * 13) * k;
      o.y += Math.sin(age * 57 + 1.3 + s.t) * k * 0.6;
      o.z += Math.sin(age * 63 + 2.1) * k;
    }
    this.shake = this.shake.filter((s) => t - s.t < s.dur + 0.05 || t < s.t);
    return o;
  }

  update(t, camera, pix, res = null) {
    this.ctx.pix = pix;
    if (res) this.ctx.res = res;
    this.ctx.camera = camera;
    let lightI = 0;
    let lightC = null;
    let lightP = null;
    let expo = 0;
    for (const fx of this.effects) {
      const age = t - fx.start;
      if (age < 0) {
        for (const p of fx.objs) (p.obj ?? p).visible = false;
        continue;
      }
      for (const p of fx.objs) (p.obj ?? p).visible = true;
      for (const p of fx.objs) p.update?.(age, this.ctx);
      const r = fx.animate?.(age, fx.parts, this.ctx);
      if (r?.exposure > expo) expo = r.exposure;
      if (r?.light && r.light.i > lightI) {
        lightI = r.light.i;
        lightC = r.light.color;
        lightP = r.light.pos;
      }
      if (!fx.persistent && age > fx.life) fx.dead = true;
    }
    /** Exposure bump requested by flashes (the scene scales tone-mapping exposure). */
    this.exposure = expo;
    this.light.intensity = lightI;
    if (lightC) this.light.color.set(lightC);
    if (lightP) this.light.position.copy(lightP);
    for (const fx of this.effects.filter((f) => f.dead)) this._remove(fx);
    this.effects = this.effects.filter((f) => !f.dead);
  }

  /** End of battle: every aura, cloud and ring goes (decals stay in the world). */
  clearLingering() {
    for (const fx of this.effects) fx.dead = true;
  }

  kill(id) {
    for (const fx of this.effects) if (fx.id === id) fx.dead = true;
  }

  /** Seconds until every transient effect (not lingering clouds) has played out. */
  busyUntil(t) {
    let m = 0;
    for (const fx of this.effects) if (!fx.persistent) m = Math.max(m, fx.start + Math.min(fx.life, 2.2) - t);
    return m;
  }

  _remove(fx) {
    for (const p of fx.objs) {
      const obj = p.obj ?? p;
      this.group.remove(obj);
      if (p.dispose) p.dispose();
      else {
        obj.traverse?.((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
      }
    }
  }

  dispose() {
    for (const fx of this.effects) this._remove(fx);
    this.effects = [];
    this.scene.remove(this.group);
    this.scene.remove(this.light);
  }

  // ---------------------------------------------------------------- recipes
  /** Metal-on-metal sparks + a little blood for flesh hits. */
  hitSparks(t, at, { blood = true, crit = false, seed = 1, bone = false } = {}) {
    this.add(t, 0.9, () => ({
      list: [
        // Velocity-streaked steel sparks spraying off the blow (not round specks).
        sparkStreaks({ at, count: crit ? 18 : 11, speed: crit ? 6.5 : 5, life: 0.3, gravity: 9, drag: 2.2, width: 1.6, streak: 0.035, intensity: 2.0, seed, r0: 0.05 }),
        ...(blood && !bone ? [particleBurst({ at, count: crit ? 26 : 14, speed: 2.2, life: 0.7, size: 0.07, drag: 1.5, gravity: 9.8, colors: [0x7a0a06, 0x4a0504, 0x2a0303], additive: false, intensity: 1, soft: 0.3, seed: seed + 7, floor: 0.02 })] : []),
        ...(bone ? [particleBurst({ at, count: 16, speed: 2.5, life: 0.8, size: 0.06, drag: 1.2, gravity: 9.8, colors: [0xe8e0c8, 0xc8b898, 0x8a7a60], additive: false, intensity: 1, soft: 0.2, seed: seed + 9, floor: 0.02 })] : []),
        glowSprite(0xffc070, crit ? 0.9 : 0.6, 0.7),
      ],
    }), (age, parts) => {
      const sp = parts.list[parts.list.length - 1];
      sp.position.copy(at);
      sp.material.opacity = Math.max(0, 1 - age / 0.07) * 0.35;
      sp.scale.setScalar((crit ? 0.9 : 0.6) * (1 + age * 3));
    });
  }

  /** A swipe arc trail for melee swings. */
  swipe(t, at, yaw, { color = 0xfff0d0, seed = 1 } = {}) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = -1.1 + (i / 12) * 2.2;
      pts.push(new THREE.Vector3(at.x + Math.sin(yaw + a) * 0.9, at.y + 0.5 - (i / 12) * 0.9, at.z + Math.cos(yaw + a) * 0.9));
    }
    this.add(t, 0.3, () => ({ list: [ribbon(pts, 0.05, color)] }), (age, parts) => {
      parts.list[0].material.uniforms.uA.value = Math.max(0, 1 - age / 0.22) * 0.8;
    });
    void seed;
  }

  /**
   * Body-fall dust: a low ring of many small soft grains kicked out along the
   * ground (sun-warm tops, shadowed tones) plus heavier grit that drops back —
   * settles in well under a second, no big blurry billboards.
   */
  dust(t, at, { seed = 1, big = false, night = false } = {}) {
    const k = big ? 1.5 : 1;
    const tone = night ? [0x4a4a56, 0x32323c, 0x202026] : [0x8a7c66, 0x665a4c, 0x443c34];
    this.add(t, 1.2, () => ({
      list: [
        particleBurst({ at: { x: at.x, y: 0.06, z: at.z }, count: Math.round(46 * k), spread: 0.35 * k, flatY: true,
          velocity: (i, r) => { const a = r(4) * Math.PI * 2; const sp = (1.2 + r(5) * 1.6) * k; return [Math.cos(a) * sp, 0.25 + r(6) * 0.6, Math.sin(a) * sp]; },
          life: 0.85, size: 0.13 * k, grow: 1.6, drag: 4.5, gravity: 0.6, colors: tone, additive: false, intensity: night ? 0.7 : 1.05, soft: 0.85, seed, fadeIn: 0.04, floor: 0.02 }),
        particleBurst({ at: { x: at.x, y: 0.08, z: at.z }, count: Math.round(22 * k), spread: 0.25, hemi: true, speed: 2.4, up: 0.9, life: 0.55, size: 0.025, drag: 1.5, gravity: 9, colors: [0x6a5e50, 0x4a4238, 0x2a2420], additive: false, intensity: 1, soft: 0.25, seed: seed + 3, floor: 0.015 }),
      ],
    }));
  }

  /** Arrow / sling stone flight on an arc; returns flight time. */
  missile(t, from, to, { kind = 'arrow', seed = 1 } = {}) {
    const dist = from.distanceTo(to);
    const dur = Math.max(0.18, dist / 22);
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.4), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.14).rotateY(Math.PI / 2).translate(0, 0, -0.32), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, side: THREE.DoubleSide }));
    arrow.add(shaft, tip, fl);
    const arc = Math.min(1.2, dist * 0.08);
    const P = (u) => new THREE.Vector3().lerpVectors(from, to, u).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * arc, 0));
    this.add(t, dur, () => ({ list: [arrow] }), (age) => {
      const u = clamp01(age / dur);
      const p = P(u);
      arrow.position.copy(p);
      arrow.lookAt(P(Math.min(1, u + 0.02)).add(new THREE.Vector3().subVectors(to, from).multiplyScalar(0.001)));
      arrow.visible = u < 1;
    });
    void kind;
    void seed;
    return dur;
  }

  /** Magic missiles: n homing orbs with trails. Returns flight time. */
  magicMissile(t, from, to, n = 1, seed = 1) {
    const dur = 0.55 + from.distanceTo(to) * 0.02;
    for (let k = 0; k < n; k++) {
      const off = new THREE.Vector3((hashf(seed + k) - 0.5) * 3, 1 + hashf(seed + k * 3) * 1.5, (hashf(seed + k * 5) - 0.5) * 3);
      const c1 = new THREE.Vector3().lerpVectors(from, to, 0.3).add(off);
      const c2 = new THREE.Vector3().lerpVectors(from, to, 0.75).add(off.clone().multiplyScalar(0.4));
      const curve = new THREE.CubicBezierCurve3(from.clone(), c1, c2, to.clone());
      const delay = k * 0.12;
      const TRAIL = 22;
      const tg = new THREE.BufferGeometry();
      const tp = new Float32Array(TRAIL * 3);
      const ta = new Float32Array(TRAIL);
      tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1));
      const tmat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uPix: { value: 600 } },
        vertexShader: `attribute float aA; uniform float uPix; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (0.08 + aA * 0.3) * uPix / -mv.z; }`,
        fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float d = 1.0 - smoothstep(0.2, 1.0, r); gl_FragColor = vec4(mix(vec3(0.5,0.3,1.0), vec3(0.9,0.85,1.0), vA) * 2.5, d * vA); }`,
      });
      const trail = new THREE.Points(tg, tmat);
      trail.frustumCulled = false;
      trail.renderOrder = 8;
      const head = glowSprite(0xb8a0ff, 0.9);
      const core = glowSprite(0xffffff, 0.35);
      this.add(t + delay, dur + 0.1, () => ({ list: [trail, head, core] }), (age, parts, ctx) => {
        const u = clamp01(age / dur);
        const e = u * u * (3 - 2 * u) * 0.3 + u * 0.7;
        const p = curve.getPoint(e);
        head.position.copy(p);
        core.position.copy(p);
        head.visible = core.visible = u < 1;
        for (let i = 0; i < TRAIL; i++) {
          const uu = Math.max(0, e - i * 0.018);
          const q = curve.getPoint(uu);
          tp.set([q.x, q.y, q.z], i * 3);
          ta[i] = u < 1 ? (1 - i / TRAIL) * (uu > 0 ? 1 : 0) : Math.max(0, 1 - (age - dur) * 10) * (1 - i / TRAIL);
        }
        tg.attributes.position.needsUpdate = true;
        tg.attributes.aA.needsUpdate = true;
        tmat.uniforms.uPix.value = ctx.pix;
        return { light: { i: u < 1 ? 6 : 0, color: 0x9a80ff, pos: p } };
      });
      this.add(t + delay + dur, 0.5, () => ({ list: [particleBurst({ at: to, count: 24, speed: 3, life: 0.4, size: 0.08, drag: 4, colors: [0xffffff, 0xb090ff, 0x4020a0], intensity: 3, seed: seed + k })] }));
    }
    return dur + (n - 1) * 0.12;
  }

  /**
   * Fireball: a comet (white-hot head, tapered flickering tail, shed embers)
   * arcs to the target and detonates in layers — a ray-marched fire volume
   * (white-hot heart, orange flame tongues, a sooty rim that cools to smoke),
   * an offset secondary burst, velocity-streaked ember sparks, a dark rolling
   * smoke cap and stem, a heat-shimmer shell and ground shockwave, debris,
   * dust and a scorch — with a strong orange light washing walls and figures.
   * Emission is rolled off so ACES keeps the hue at the peak.
   * Returns {flight, detonate} (seconds from t).
   */
  fireball(t, from, to, radius = 2.5 * 1.5, seed = 1) {
    const flight = Math.max(0.35, from.distanceTo(to) / 16);
    const arc = Math.min(1.4, from.distanceTo(to) * 0.12);
    const P = (u, out = new THREE.Vector3()) => out.lerpVectors(from, to, u).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * arc, 0));
    const head = glowSprite(0xffa040, 1.1, 0.9);
    const core = glowSprite(0xfff4dc, 0.34);
    const tail = taperTrail(28, 0xfff0c8, 0xff3008, 0.2);
    const shed = particleBurst({
      at: from, count: 70, life: 0.32, size: 0.035, speed: 1.6, drag: 2.5, gravity: 2, stagger: flight, turb: 0.9,
      colors: [0xfff0c0, 0xff7018, 0x501008], intensity: 2.4, seed,
      emit: (i) => {
        const q = P(i / 70);
        return [q.x, q.y, q.z];
      },
    });
    const sd = shed.obj.geometry.attributes.aD;
    for (let i = 0; i < 70; i++) sd.setX(i, (i / 70) * flight);
    const pts = [];
    for (let i = 0; i < 28; i++) pts.push(new THREE.Vector3());
    this.add(t, flight + 0.6, () => ({ list: [tail, shed, head, core] }), (age, parts, ctx) => {
      const u = clamp01(age / flight);
      const p = P(u);
      head.position.copy(p);
      core.position.copy(p);
      head.visible = core.visible = u < 1;
      head.scale.setScalar(1.0 + Math.sin(age * 47) * 0.08);
      for (let i = 0; i < 28; i++) P(Math.max(0, u - i * 0.011), pts[i]);
      if (ctx.camera) tail.set(pts, ctx.camera.position);
      tail.obj.material.uniforms.uT.value = age;
      tail.obj.material.uniforms.uA.value = u < 1 ? Math.min(1, age * 8) : 0;
      return { light: { i: u < 1 ? 14 : 0, color: 0xff9040, pos: p } };
    });

    const T = t + flight;
    const R = radius;
    // One ray-marched fire volume (core → flame tongues → soot) plus a smaller
    // offset one for an asymmetric silhouette, and two smoke volumes that roll
    // up out of the crown into a dark cap as the fire burns out.
    const ball = volumeFire({ steps: 32 });
    const ball2 = volumeFire({ steps: 18 });
    const cap = volumeFire({ steps: 18, smoke: true });
    const stem = volumeFire({ steps: 14, smoke: true });
    ball.u.uSeed.value = seed * 3.1;
    ball.u.uFreq.value = 2.1;
    ball2.u.uFreq.value = 2.4;
    ball2.u.uSeed.value = seed * 7.7 + 11;
    cap.u.uSeed.value = seed * 5.3 + 2;
    stem.u.uSeed.value = seed * 2.9 + 7;
    cap.u.uFreq.value = 2.0;
    stem.u.uFreq.value = 2.6;
    const o2 = new THREE.Vector3(hashf(seed + 1) - 0.5, 0.25, hashf(seed + 2) - 0.5).normalize();
    // Heat shimmer: a thin, fast-expanding fresnel shell.
    const shock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform float uA; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.0); gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * 1.4, f * uA); }',
    }));
    shock.renderOrder = 11;
    shock.frustumCulled = false;
    const ring = shockRing(0xffa050);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8 }));
    scorch.renderOrder = 1;
    const sparks = sparkStreaks({ at: to, count: 80, speed: 10, life: 1.3, gravity: 8, drag: 1.4, hemi: true, width: 2.4, streak: 0.045, intensity: 2.2, seed: seed + 3, r0: R * 0.15 });
    const lateSparks = sparkStreaks({ at: { x: to.x, y: to.y + 0.4, z: to.z }, count: 40, speed: 4, up: 1.4, life: 1.6, gravity: 3, drag: 1.6, hemi: true, width: 1.6, streak: 0.12, intensity: 2.2, seed: seed + 9, delay: 0.15, stagger: 0.5, r0: R * 0.4 });
    const debris = particleBurst({ at: { x: to.x, y: 0.2, z: to.z }, count: 36, speed: 6.5, life: 1.2, size: 0.09, drag: 1, gravity: 12, hemi: true, colors: [0x5a4a3a, 0x3a3028, 0x2a2420], additive: false, intensity: 1, soft: 0.2, seed: seed + 5, floor: 0.03 });
    const dust = particleBurst({ at: { x: to.x, y: 0.15, z: to.z }, count: 30, spread: 0.3, flatY: true, hemi: true, speed: 7.5, up: 0.12, life: 1.8, size: 1.0, grow: 2.5, drag: 3.2, colors: [0x7a6a58, 0x5a4e42, 0x3a342e], additive: false, intensity: 1, soft: 0.95, seed: seed + 13, fadeIn: 0.05 });
    // Vertical mass: a crown of tall flame tongues licking up around the blast,
    // and a white-hot flash core for the first frames.
    const tongues = flameTongues(11, seed + 31);
    tongues.u.uR.value = R * 0.6;
    tongues.u.uH.value = R * 0.5;
    tongues.u.uLife.value = 0.95;
    const tonguesIn = flameTongues(4, seed + 37);
    tonguesIn.u.uR.value = R * 0.25;
    tonguesIn.u.uH.value = R * 0.7;
    tonguesIn.u.uLife.value = 0.8;
    const flash = glowSprite(0xfff2d8, R * 3.2, 0);
    const flashCore = glowSprite(0xffffff, R * 1.2, 0);
    const heatRing = groundRing(0xffb070, 0.0);
    const groundFire = particleBurst({ at: { x: to.x, y: 0.12, z: to.z }, count: 70, spread: R * 0.7, flatY: true, speed: 0.2, gravity: -1.4, life: 0.8, stagger: 1.4, delay: 0.3, size: 0.16, grow: 1.0, drag: 1, turb: 0.4, colors: [0xffb050, 0xff4a08, 0x200804], intensity: 1.1, seed: seed + 21, fadeIn: 0.15 });
    this.add(T, 4.5, () => ({ list: [scorch, ring, heatRing, dust, groundFire, stem, cap, ball2, ball, tongues, tonguesIn, shock, sparks, lateSparks, debris, flash, flashCore] }), (age, parts, ctx) => {
      tongues.obj.position.set(to.x, 0.02, to.z);
      tonguesIn.obj.position.set(to.x, 0.02, to.z);
      // White-hot flash: 2-3 frames of glare, then gone.
      const fl = age < 0.03 ? age / 0.03 : Math.exp(-(age - 0.03) * 14);
      flash.position.set(to.x, to.y + 0.3, to.z);
      flash.material.opacity = fl * 0.85;
      flashCore.position.set(to.x, to.y + 0.2, to.z);
      flashCore.material.opacity = Math.min(1, fl * 1.4);
      // Heat shimmer band riding just behind the shockwave front.
      const hr = R * (0.3 + 0.95 * (1 - Math.exp(-age * 6)));
      heatRing.position.set(to.x, 0.05, to.z);
      heatRing.scale.setScalar(hr * 2.2);
      heatRing.material.uniforms.uR.value = 0.8;
      heatRing.material.uniforms.uW.value = 0.22;
      heatRing.material.uniforms.uA.value = clamp01(1 - age / 0.7) * 0.35;
      heatRing.visible = age < 0.75;
      const ease = 1 - Math.exp(-age * 8);
      const cam = ctx?.camera;
      const rise = age * 0.55 + age * age * 0.3;
      // Main fireball: snaps out in ~0.25 s, hot heart cooling through orange to
      // soot at the rim, then tears open and fades while it rises.
      const Rb = R * 0.78;
      ball.obj.position.set(to.x, to.y + rise, to.z);
      ball.obj.scale.set(Rb, Rb * 0.92, Rb);
      ball.u.uAge.value = age;
      ball.u.uGrow.value = 0.18 + 0.62 * (1 - Math.exp(-age * 9)) + age * 0.06;
      ball.u.uHeat.value = age < 0.06 ? 1.7 : 0.35 + 1.3 * Math.exp(-(age - 0.06) * 2.2);
      ball.u.uSmoke.value = clamp01(0.12 + age * 1.25);
      ball.u.uErode.value = Math.max(0, age - 0.5) * 0.75;
      ball.u.uFade.value = clamp01((2.6 - age) / 0.8);
      ball.obj.visible = age < 2.6;
      ball.sync(cam, 0.02);
      const R2 = R * 0.46;
      const e2 = 1 - Math.exp(-(age - 0.03) * 8);
      ball2.obj.position.set(to.x + o2.x * R * 0.42 * e2, to.y + rise * 1.2 + o2.y * R * 0.3, to.z + o2.z * R * 0.42 * e2);
      ball2.obj.scale.setScalar(R2);
      ball2.u.uAge.value = age + 2;
      ball2.u.uGrow.value = 0.2 + 0.6 * Math.max(0, e2);
      ball2.u.uHeat.value = 0.3 + 1.1 * Math.exp(-age * 2.6);
      ball2.u.uSmoke.value = clamp01(age * 1.1);
      ball2.u.uErode.value = Math.max(0, age - 0.4) * 0.9;
      ball2.u.uFade.value = clamp01((2.0 - age) / 0.7);
      ball2.obj.visible = age > 0.03 && age < 2.0;
      ball2.sync(cam, 0.02);
      // Smoke: a cap rolls up out of the crown, a stem trails beneath it.
      const ac = age - 0.12;
      cap.obj.visible = ac > 0 && age < 4.4;
      if (cap.obj.visible) {
        const g = R * (0.42 + ac * 0.22);
        cap.obj.position.set(to.x, to.y + R * 0.35 + ac * 1.3 + rise * 0.4, to.z);
        cap.obj.scale.set(g, g * 0.7, g);
        cap.u.uAge.value = ac * 0.7;
        cap.u.uGrow.value = 0.25 + 0.55 * (1 - Math.exp(-ac * 3));
        cap.u.uHeat.value = Math.max(0, 1 - ac * 0.8);
        cap.u.uErode.value = Math.max(0, ac - 2.0) * 0.4;
        cap.u.uFade.value = clamp01(ac * 3) * clamp01((4.4 - age) / 1.4) * 0.72;
        cap.sync(cam, 0.02);
      }
      const as = age - 0.35;
      stem.obj.visible = as > 0 && age < 4.0;
      if (stem.obj.visible) {
        const g = R * (0.22 + as * 0.08);
        stem.obj.position.set(to.x, to.y + g * 0.9 + as * 0.4, to.z);
        stem.obj.scale.set(g, g * 1.6, g);
        stem.u.uAge.value = as;
        stem.u.uGrow.value = 0.3 + 0.4 * (1 - Math.exp(-as * 3));
        stem.u.uHeat.value = Math.max(0, 0.7 - as * 0.6);
        stem.u.uErode.value = Math.max(0, as - 1.6) * 0.5;
        stem.u.uFade.value = clamp01(as * 3) * clamp01((4.0 - age) / 1.2) * 0.6;
        stem.sync(cam, 0.02);
      }
      shock.position.set(to.x, to.y, to.z);
      shock.scale.setScalar(R * (0.3 + 0.7 * (1 - Math.exp(-age * 9))));
      shock.material.uniforms.uA.value = clamp01(1 - age / 0.25) ** 2 * 0.12;
      shock.visible = age < 0.3;
      // Ground shockwave: a soft, noise-distorted band racing out to ~1.2x the blast.
      const rr = R * (0.35 + 0.85 * (1 - Math.exp(-age * 7)));
      ring.scale.setScalar(rr * 2 / 0.8);
      ring.position.set(to.x, 0.06, to.z);
      ring.material.uniforms.uT.value = age;
      ring.material.uniforms.uA.value = clamp01(1 - age / 0.6) ** 1.3 * 0.75;
      ring.visible = age < 0.66;
      scorch.position.set(to.x, 0.03, to.z);
      scorch.scale.setScalar(R * 0.95);
      scorch.material.opacity = clamp01(age * 5) * 0.75;
      // A big warm key light: white-orange flash settling to a deep orange glow.
      // A big warm flare that washes walls, windows and figures, settling to a burn.
      const li = age < 0.03 ? 1400 * (age / 0.03) : 1300 * Math.exp(-(age - 0.03) * 18) + 55 * Math.exp(-age * 1.2) + 22 * Math.max(0, 1 - age / 2.6);
      // Exposure kick on the flash, easing back as the fire settles.
      const expo = age < 0.03 ? 0.8 * (age / 0.03) : 0.8 * Math.exp(-(age - 0.03) * 16) + 0.05 * Math.exp(-age * 3);
      return { exposure: expo, light: { i: li, color: age < 0.12 ? 0xffd6a0 : 0xff8434, pos: new THREE.Vector3(to.x, to.y + 1.3 + rise * 0.6, to.z) } };
    });
    this.addShake(T, 0.35, 0.6);
    return { flight, detonate: flight };
  }

  /** Burning hands: a roaring cone of fire from the caster toward `dir`. */
  coneFire(t, from, dirYaw, length = 4.5, seed = 1) {
    const n = 160;
    const burst = particleBurst({
      at: from, count: n, life: 0.55, size: 0.35, grow: 2.2, drag: 1.2, turb: 0.8, stagger: 0.55,
      colors: [0xfff0c0, 0xff7010, 0x301008], intensity: 2.6, seed,
      velocity: (i, r) => {
        const a = dirYaw + (r(1) - 0.5) * 0.9;
        const s = length * (1.4 + r(2) * 0.8);
        return [Math.sin(a) * s, (r(3) - 0.3) * 1.5, Math.cos(a) * s];
      },
    });
    this.add(t, 1.3, () => ({ list: [burst] }), (age) => ({
      light: { i: age < 0.6 ? 25 : Math.max(0, 25 - (age - 0.6) * 60), color: 0xff7020, pos: new THREE.Vector3(from.x + Math.sin(dirYaw) * 1.5, from.y, from.z + Math.cos(dirYaw) * 1.5) },
    }));
    return 0.35;
  }

  /** Lightning bolt: flickering jagged beam with branches and sparks along the line. */
  lightning(t, from, to, seed = 1) {
    const dur = 0.6;
    const bolts = [];
    for (let k = 0; k < 3; k++) bolts.push(ribbon(jaggedBolt(from, to, seed + k * 17, 0.6 + k * 0.2), k === 0 ? 0.09 : 0.05, 0x9ad0ff));
    const branch = [];
    for (let k = 0; k < 4; k++) {
      const a = from.clone().lerp(to, 0.2 + hashf(seed + k) * 0.6);
      const b = a.clone().add(new THREE.Vector3((hashf(seed + k * 3) - 0.5) * 3, -a.y + 0.05, (hashf(seed + k * 5) - 0.5) * 3));
      branch.push(ribbon(jaggedBolt(a, b, seed + k * 31, 0.4), 0.03, 0x80c0ff));
    }
    const glowA = glowSprite(0xa0d8ff, 2.2);
    const glowB = glowSprite(0xa0d8ff, 3.0);
    this.add(t, dur, () => ({ list: [...bolts, ...branch, glowA, glowB] }), (age) => {
      const f = age < dur ? (Math.sin(age * 90) > -0.3 ? 1 : 0.2) * (1 - age / dur) : 0;
      bolts.forEach((b, i) => {
        b.material.uniforms.uA.value = f * (i === Math.floor(age * 20) % 3 ? 1 : 0.35);
      });
      branch.forEach((b, i) => { b.material.uniforms.uA.value = f * (Math.sin(age * 60 + i) > 0 ? 0.8 : 0.1); });
      glowA.position.copy(from);
      glowB.position.copy(to);
      glowA.material.opacity = glowB.material.opacity = f;
      return { light: { i: 40 * f, color: 0x9ac8ff, pos: from.clone().lerp(to, 0.5).setY(2) } };
    });
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const p = from.clone().lerp(to, k / steps);
      this.add(t + 0.02 * k, 0.6, () => ({ list: [particleBurst({ at: p, count: 10, speed: 4, life: 0.3, size: 0.05, drag: 3, gravity: 8, colors: [0xffffff, 0xa0d0ff, 0x2040a0], intensity: 3, seed: seed + k, floor: 0.02 })] }));
    }
    this.addShake(t, 0.18, 0.4);
    return 0.12;
  }

  /** Sleep: big, soft blue-violet motes drift down in lazy arcs and settle over the area. */
  sleepCloud(t, centre, size, seed = 1) {
    const r = size * 0.62;
    const motes = particleBurst({
      at: { x: centre.x, y: 3.4, z: centre.z }, count: 60, spread: r, speed: 0.22, gravity: 0.18, life: 2.6, stagger: 0.9, size: 0.26, drag: 0.6, turb: 0.55,
      colors: [0xcfc0ff, 0x9a84ff, 0x4a3ac0], intensity: 1.2, seed, floor: -2, fadeIn: 0.25, soft: 1.0,
    });
    const dust = particleBurst({
      at: { x: centre.x, y: 2.6, z: centre.z }, count: 60, spread: r * 1.05, speed: 0.15, gravity: 0.22, life: 2.8, stagger: 1.0, size: 0.05, drag: 0.5, turb: 0.4,
      colors: [0xe8e0ff, 0xb8a8ff, 0x6a58d0], intensity: 1.6, seed: seed + 5, floor: -2, fadeIn: 0.2,
    });
    const veil = glowSprite(0x8a78ff, size * 1.6, 0);
    this.add(t, 3.0, () => ({ list: [motes, dust, veil] }), (age) => {
      veil.position.set(centre.x, 1.0, centre.z);
      veil.material.opacity = Math.sin(clamp01(age / 2.6) * Math.PI) * 0.06;
      return { light: { i: 2.2 * Math.sin(clamp01(age / 2.6) * Math.PI), color: 0x9a86ff, pos: new THREE.Vector3(centre.x, 2.4, centre.z) } };
    });
  }

  /** A sleeper: soft violet glow pulse and lazy "Z"s rising from the head (persistent until woken). */
  sleepZ(t, getPos, id, seed = 1) {
    const zs = [0, 1, 2].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTexture(), color: 0xd8ccff, transparent: true, depthWrite: false, opacity: 0 }));
      sp.renderOrder = 12;
      return sp;
    });
    const glow = glowSprite(0x9a88ff, 0.9, 0);
    this.add(t, 999, () => ({ list: [glow, ...zs] }), (age) => {
      const p = getPos();
      glow.position.copy(p).setY(p.y - 0.15);
      glow.material.opacity = 0.18 + 0.12 * Math.sin(age * 2.2 + seed);
      zs.forEach((z, k) => {
        const ph = (age * 0.45 + k / 3 + seed * 0.13) % 1;
        z.position.set(p.x + Math.sin(ph * 5 + k) * 0.12 + ph * 0.25, p.y + ph * 0.75, p.z);
        z.scale.setScalar(0.14 + ph * 0.16);
        z.material.opacity = Math.sin(ph * Math.PI) * 0.85 * clamp01(age * 2);
      });
    }, { persistent: true, id });
  }

  /**
   * Stinking cloud: persistent, ray-marched yellow-green vapour hugging the
   * ground — three overlapping squashed volumes with slow curling billows and
   * edges that drift and breathe.
   */
  stinkingCloud(t, centre, size, id, seed = 1, { night = false } = {}) {
    const vols = [0, 1, 2].map((k) => {
      const v = volumeFire({ steps: 20, gas: true });
      v.u.uSeed.value = seed * 3.7 + k * 11.3;
      v.u.uFreq.value = 2.2;
      v.u.uDrift.value.set(0.35 * (k % 2 ? 1 : -1), 0.12, 0.25);
      v.u.uHeat.value = night ? 0.4 : 1.0;
      return v;
    });
    this.add(t, 999, () => ({ list: vols }), (age, parts, ctx) => {
      const fade = clamp01(age / 0.9);
      vols.forEach((v, k) => {
        const a = hashf(seed + k) * Math.PI * 2 + age * 0.05 * (k % 2 ? 1 : -1);
        const off = k === 0 ? 0 : size * 0.22;
        const g = size * (0.62 - k * 0.08) * (0.85 + 0.15 * fade) * (1 + 0.04 * Math.sin(age * 0.7 + k));
        v.obj.position.set(centre.x + Math.cos(a) * off, g * 0.32, centre.z + Math.sin(a) * off);
        v.obj.scale.set(g, g * 0.42, g * 0.95);
        v.u.uAge.value = age * 0.3 + k * 3;
        v.u.uGrow.value = 0.55 + 0.25 * fade;
        v.u.uErode.value = 0.05;
        v.u.uFade.value = fade * 0.92;
        v.sync(ctx.camera, 0.01);
      });
    }, { persistent: true, id });
  }

  /** Healing: rising green-gold sparkles and a pulse ring. */
  heal(t, at, seed = 1) {
    const ring = groundRing(0x80ff90, 0.3);
    this.add(t, 1.6, () => ({
      list: [ring, particleBurst({ at: { x: at.x, y: 0.1, z: at.z }, count: 50, spread: 0.45, flatY: true, speed: 0.2, gravity: -2.2, life: 1.4, stagger: 0.4, size: 0.08, drag: 0.5, turb: 0.2, colors: [0xffffff, 0xa0ffb0, 0x40c060], intensity: 2.4, seed })],
    }), (age) => {
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(1.8 + age * 0.8);
      ring.material.uniforms.uR.value = 0.6;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.2);
      return { light: { i: 5 * Math.max(0, 1 - age), color: 0x80ff90, pos: new THREE.Vector3(at.x, 1.2, at.z) } };
    });
  }

  /** Generic aura (bless/ward/buff/curse/charm/hold). */
  aura(t, at, color, seed = 1, { down = false } = {}) {
    const ring = groundRing(color, 0.2);
    this.add(t, 1.4, () => ({
      list: [ring, particleBurst({ at: { x: at.x, y: down ? 2.2 : 0.1, z: at.z }, count: 34, spread: 0.5, flatY: true, speed: 0.2, gravity: down ? 1.5 : -1.6, life: 1.1, stagger: 0.3, size: 0.07, drag: 0.5, colors: [0xffffff, color, color], intensity: 2.2, seed })],
    }), (age) => {
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(1.2 + age * 1.5);
      ring.material.uniforms.uR.value = 0.7;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.1);
    });
  }

  /**
   * Turn undead: the holy symbol flares — a radiant sigil burns into the ground
   * (ring, twelve rays, the Scales), shafts of light fan outward, a narrow
   * column rises and motes drift up. Intensities are capped so it reads as a
   * shaped burst, never a white flood.
   */
  holyLight(t, at, seed = 1) {
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: holySigilTexture(), color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    sigil.renderOrder = 5;
    const rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uA, uT; void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float rays = pow(abs(cos(a * 6.0 + uT * 0.6)), 18.0) + 0.5 * pow(abs(cos(a * 6.0 + 0.26)), 30.0);
        float k = rays * smoothstep(1.0, 0.25, r) * smoothstep(0.05, 0.3, r);
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * 1.2, k * uA * 0.55); }`,
    }));
    rays.renderOrder = 5;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 5, 24, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float uA; void main(){ float a = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y) * (0.6 + 0.4 * sin(vUv.x * 62.83)); gl_FragColor = vec4(vec3(1.0, 0.85, 0.55), a * uA * 0.2); }',
    }));
    column.renderOrder = 8;
    const ring = groundRing(0xffd070, 0.0);
    const motes = particleBurst({ at: { x: at.x, y: 0.2, z: at.z }, count: 60, spread: 0.9, flatY: true, speed: 0.4, gravity: -1.6, life: 1.6, stagger: 0.5, size: 0.05, drag: 0.6, turb: 0.25, colors: [0xffffff, 0xffe090, 0xa07020], intensity: 1.6, seed, fadeIn: 0.15 });
    this.add(t, 2.2, () => ({ list: [sigil, rays, column, ring, motes] }), (age) => {
      const k = clamp01(age / 0.18) * (1 - clamp01((age - 1.3) / 0.8));
      sigil.position.set(at.x, 0.05, at.z);
      sigil.scale.setScalar(2.2 + Math.min(1, age * 3) * 1.0);
      sigil.rotation.y = age * 0.4;
      sigil.material.opacity = k * 0.65;
      rays.position.set(at.x, 0.055, at.z);
      rays.scale.setScalar(4 + age * 5);
      rays.material.uniforms.uA.value = k;
      rays.material.uniforms.uT.value = age;
      column.position.set(at.x, 2.5, at.z);
      column.material.uniforms.uA.value = k;
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(2 + age * 10);
      ring.material.uniforms.uR.value = 0.85;
      ring.material.uniforms.uW.value = 0.04;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.0) * 0.6;
      return { light: { i: 9 * k, color: 0xffd080, pos: new THREE.Vector3(at.x, 1.6, at.z) } };
    });
  }

  /** Hands glow while a spell is being woven. */
  castGlow(t, getPos, color, dur = 0.8) {
    const g = glowSprite(color, 0.7);
    const g2 = glowSprite(0xffffff, 0.25);
    this.add(t, dur, () => ({ list: [g, g2] }), (age) => {
      const p = getPos();
      g.position.copy(p);
      g2.position.copy(p);
      const k = Math.sin(clamp01(age / dur) * Math.PI);
      g.material.opacity = k;
      g2.material.opacity = k;
      g.scale.setScalar(0.5 + k * 0.7 + Math.sin(age * 30) * 0.05);
      return { light: { i: 5 * k, color, pos: p } };
    });
  }
}

let _zTex = null;
function zTexture() {
  if (_zTex) return _zTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = 'italic bold 52px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(120, 100, 255, 0.9)';
  g.shadowBlur = 10;
  g.fillStyle = '#fff';
  g.fillText('z', 32, 34);
  _zTex = new THREE.CanvasTexture(c);
  _zTex.colorSpace = THREE.SRGBColorSpace;
  return _zTex;
}

let _sigil = null;
/** A radiant holy sigil: double ring, twelve rays and Tyr's balance (additive mask). */
function holySigilTexture() {
  if (_sigil) return _sigil;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  const glow = g.createRadialGradient(0, 0, 10, 0, 0, 128);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(-128, -128, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, 108, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 12; i++) {
    g.save();
    g.rotate((i / 12) * Math.PI * 2);
    g.beginPath(); g.moveTo(-5, -58); g.lineTo(0, -92); g.lineTo(5, -58); g.closePath(); g.fill();
    g.restore();
  }
  // Tyr's balance.
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, -44); g.lineTo(0, 40); g.moveTo(-34, -30); g.lineTo(34, -30); g.moveTo(-18, 40); g.lineTo(18, 40); g.stroke();
  g.lineWidth = 3;
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(sx * 34, -30); g.lineTo(sx * 22, 0); g.moveTo(sx * 34, -30); g.lineTo(sx * 46, 0); g.stroke();
    g.beginPath(); g.arc(sx * 34, 0, 13, 0, Math.PI); g.stroke();
  }
  _sigil = new THREE.CanvasTexture(c);
  return _sigil;
}

let _scorch = null;
function scorchTexture() {
  if (_scorch) return _scorch;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) {
    const a = hashf(i) * Math.PI * 2;
    const r = 20 + hashf(i + 9) * 44;
    g.fillStyle = `rgba(255,255,255,${hashf(i + 3) * 0.4})`;
    g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + hashf(i + 5) * 5, 2);
  }
  _scorch = new THREE.CanvasTexture(c);
  // The texture is used as an alpha mask (black colour).
  return _scorch;
}
