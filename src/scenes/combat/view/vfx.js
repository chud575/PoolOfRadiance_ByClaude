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
 * Volumetric-looking flame / smoke shell: a noise-displaced sphere whose
 * fragment shader turns view-facing thickness + fBm into a temperature, ramps
 * it through smoke → deep red → orange → yellow → white-hot, and erodes the
 * alpha edge as it cools (uErode). Emission is capped so ACES never clips it
 * to a flat white blob. uSmoke=1 renders the dark, fire-lit smoke cap instead.
 */
function fireShell({ smoke = false } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: { uT: { value: 0 }, uHeat: { value: 1 }, uErode: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uGlow: { value: 1 }, uDisp: { value: 0.3 } },
    vertexShader: `${NOISE_GLSL}
      uniform float uT, uSeed, uDisp; varying vec3 vN; varying vec3 vP; varying vec3 vView; varying vec3 vWN; varying float vDisp;
      // Billowing (cauliflower) displacement: sums of |noise| puff outward.
      float billow(vec3 p){ float s = 0.0, a = 0.55; for (int i = 0; i < 3; i++) { s += a * abs(noise3(p)); p *= 2.1; a *= 0.5; } return s; }
      void main(){
        vec3 n0 = normalize(position);
        float d = billow(n0 * 2.8 + vec3(0.0, -uT * 1.2, uSeed));
        vDisp = d;
        vec3 p = position + normal * (d - 0.25) * uDisp * 2.0;
        vN = normalize(normalMatrix * normal);
        vWN = n0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uT, uHeat, uErode, uAlpha, uSeed, uGlow; varying vec3 vN; varying vec3 vP; varying vec3 vView; varying vec3 vWN; varying float vDisp;
      void main(){
        float facing = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
        vec3 q = vP * 3.4 + vec3(0.0, -uT * 2.2, uSeed);
        float n = fbm3(q) * 0.5 + 0.5;
        float n2 = fbm3(q * 2.7 + 5.0) * 0.5 + 0.5;
        // Puffs (high displacement) burn hot, creases between them are sooty and cool.
        float puff = smoothstep(0.12, 0.55, vDisp);
        ${smoke ? `
        float dens = facing * 0.6 + puff * 0.5 + (n - 0.5) * 0.9 - uErode;
        float a = smoothstep(0.05, 0.4, dens) * uAlpha;
        vec3 c = mix(vec3(0.035, 0.03, 0.028), vec3(0.15, 0.13, 0.115), puff * 0.6 + n2 * 0.4);
        float under = clamp(-vWN.y * 0.9 + 0.25, 0.0, 1.0);
        c += vec3(1.0, 0.36, 0.07) * under * uGlow * (0.25 + puff * 0.9) * 0.9;
        gl_FragColor = vec4(c, a);` : `
        float heat = uHeat * (0.3 + facing * 0.35 + puff * 0.45) + (n - 0.5) * 0.7 + (n2 - 0.5) * 0.35;
        float edge = facing * 0.7 + puff * 0.45 + (n2 - 0.5) * 0.8 - uErode;
        float a = smoothstep(0.05, 0.3, edge) * uAlpha;
        vec3 c = vec3(0.07, 0.02, 0.01);
        c = mix(c, vec3(0.55, 0.08, 0.015), smoothstep(0.12, 0.35, heat));
        c = mix(c, vec3(1.0, 0.33, 0.04), smoothstep(0.35, 0.62, heat));
        c = mix(c, vec3(1.0, 0.62, 0.16), smoothstep(0.62, 0.88, heat));
        c = mix(c, vec3(1.0, 0.86, 0.55), smoothstep(0.88, 1.2, heat));
        // Highlight roll-off: hot cores glow, but stay ~2.5x so ACES keeps the hue.
        float emit = 0.45 + 1.7 * smoothstep(0.45, 1.15, heat);
        gl_FragColor = vec4(c * emit, a);`}
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), mat);
  mesh.renderOrder = smoke ? 8 : 9;
  mesh.frustumCulled = false;
  return mesh;
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
    for (const fx of this.effects) {
      const age = t - fx.start;
      if (age < 0) {
        for (const p of fx.objs) (p.obj ?? p).visible = false;
        continue;
      }
      for (const p of fx.objs) (p.obj ?? p).visible = true;
      for (const p of fx.objs) p.update?.(age, this.ctx);
      const r = fx.animate?.(age, fx.parts, this.ctx);
      if (r?.light && r.light.i > lightI) {
        lightI = r.light.i;
        lightC = r.light.color;
        lightP = r.light.pos;
      }
      if (!fx.persistent && age > fx.life) fx.dead = true;
    }
    this.light.intensity = lightI;
    if (lightC) this.light.color.set(lightC);
    if (lightP) this.light.position.copy(lightP);
    for (const fx of this.effects.filter((f) => f.dead)) this._remove(fx);
    this.effects = this.effects.filter((f) => !f.dead);
  }

  kill(id) {
    for (const fx of this.effects) if (fx.id === id) fx.dead = true;
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
        particleBurst({ at, count: crit ? 24 : 16, speed: crit ? 7 : 5.5, life: 0.32, size: 0.03, drag: 2.5, gravity: 9, colors: [0xffffff, 0xffc060, 0xff5010], intensity: 2.2, seed, floor: 0.02, spread: 0.12 }),
        ...(blood && !bone ? [particleBurst({ at, count: crit ? 26 : 14, speed: 2.2, life: 0.7, size: 0.07, drag: 1.5, gravity: 9.8, colors: [0x7a0a06, 0x4a0504, 0x2a0303], additive: false, intensity: 1, soft: 0.3, seed: seed + 7, floor: 0.02 })] : []),
        ...(bone ? [particleBurst({ at, count: 16, speed: 2.5, life: 0.8, size: 0.06, drag: 1.2, gravity: 9.8, colors: [0xe8e0c8, 0xc8b898, 0x8a7a60], additive: false, intensity: 1, soft: 0.2, seed: seed + 9, floor: 0.02 })] : []),
        glowSprite(0xffc070, crit ? 0.9 : 0.6, 0.7),
      ],
    }), (age, parts) => {
      const sp = parts.list[parts.list.length - 1];
      sp.position.copy(at);
      sp.material.opacity = Math.max(0, 1 - age / 0.08) * 0.5;
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

  dust(t, at, { seed = 1, big = false } = {}) {
    this.add(t, 1.8, () => ({
      list: [particleBurst({ at: { x: at.x, y: 0.1, z: at.z }, count: big ? 30 : 18, spread: 0.4, hemi: true, flatY: true, speed: big ? 2.2 : 1.4, up: 0.35, life: 1.6, size: big ? 0.55 : 0.4, grow: 2.2, drag: 3, colors: [0x8a7a64, 0x6a5e50, 0x4a4238], additive: false, intensity: 1, soft: 0.9, seed, fadeIn: 0.1 })],
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
   * arcs to the target and detonates in layers — a white-hot core flash, two
   * turbulent noise-eroded flame shells, velocity-streaked ember sparks, a dark
   * fire-lit smoke cap rolling upward, a heat-shimmer shock shell and ground
   * ring, debris, dust and a scorch — with a strong orange light washing the
   * scene. Emission is capped so ACES keeps the hue at the peak.
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
      at: from, count: 70, life: 0.5, size: 0.06, speed: 1.2, drag: 2.5, gravity: 2, stagger: flight, turb: 0.6,
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
    const flash = fireShell();
    const shellA = fireShell();
    const shellB = fireShell();
    const smokes = [fireShell({ smoke: true }), fireShell({ smoke: true }), fireShell({ smoke: true })];
    shellA.material.uniforms.uSeed.value = seed * 3.1;
    shellB.material.uniforms.uSeed.value = seed * 7.7 + 11;
    shellB.rotation.set(1.1, 0.7, 0.3);
    flash.material.uniforms.uSeed.value = seed;
    smokes.forEach((m, k) => {
      m.material.uniforms.uSeed.value = seed * 5 + k * 13;
      m.material.uniforms.uDisp.value = 0.45;
    });
    // Heat shimmer: a thin, fast-expanding fresnel shell.
    const shock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform float uA; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.0); gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * 1.4, f * uA); }',
    }));
    shock.renderOrder = 11;
    shock.frustumCulled = false;
    const ring = groundRing(0xffa050, 0.3);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8 }));
    scorch.renderOrder = 1;
    const sparks = sparkStreaks({ at: to, count: 80, speed: 10, life: 1.3, gravity: 8, drag: 1.4, hemi: true, width: 2.4, streak: 0.045, intensity: 2.2, seed: seed + 3, r0: R * 0.15 });
    const lateSparks = sparkStreaks({ at: { x: to.x, y: to.y + 0.4, z: to.z }, count: 40, speed: 4, up: 1.4, life: 1.6, gravity: 3, drag: 1.6, hemi: true, width: 1.6, streak: 0.12, intensity: 2.2, seed: seed + 9, delay: 0.15, stagger: 0.5, r0: R * 0.4 });
    const debris = particleBurst({ at: { x: to.x, y: 0.2, z: to.z }, count: 36, speed: 6.5, life: 1.2, size: 0.09, drag: 1, gravity: 12, hemi: true, colors: [0x5a4a3a, 0x3a3028, 0x2a2420], additive: false, intensity: 1, soft: 0.2, seed: seed + 5, floor: 0.03 });
    const dust = particleBurst({ at: { x: to.x, y: 0.15, z: to.z }, count: 30, spread: 0.3, flatY: true, hemi: true, speed: 7.5, up: 0.12, life: 1.8, size: 1.0, grow: 2.5, drag: 3.2, colors: [0x7a6a58, 0x5a4e42, 0x3a342e], additive: false, intensity: 1, soft: 0.95, seed: seed + 13, fadeIn: 0.05 });
    const groundFire = particleBurst({ at: { x: to.x, y: 0.12, z: to.z }, count: 40, spread: R * 0.75, flatY: true, speed: 0.2, gravity: -1.2, life: 0.9, stagger: 1.2, delay: 0.25, size: 0.35, grow: 1.2, drag: 1, turb: 0.3, colors: [0xffd080, 0xff5a10, 0x301008], intensity: 1.8, seed: seed + 21, fadeIn: 0.15 });
    this.add(T, 4.5, () => ({ list: [scorch, ring, dust, groundFire, ...smokes, shellA, shellB, flash, shock, sparks, lateSparks, debris] }), (age) => {
      const ease = 1 - Math.exp(-age * 8);
      // White-hot core flash: tiny, intense, gone in a blink.
      flash.position.set(to.x, to.y, to.z);
      flash.scale.setScalar(R * (0.12 + 0.2 * (1 - Math.exp(-age * 30))));
      flash.material.uniforms.uT.value = age;
      flash.material.uniforms.uHeat.value = 1.45;
      flash.material.uniforms.uAlpha.value = clamp01(1 - age / 0.22);
      flash.visible = age < 0.22;
      // Turbulent flame shells: billow out fast, rise, cool and erode at the edges.
      const rise = age * 0.7 + age * age * 0.25;
      shellA.position.set(to.x, to.y + rise, to.z);
      shellA.scale.set(R * (0.22 + 0.42 * ease), R * (0.2 + 0.32 * ease) * (1 + age * 0.25), R * (0.22 + 0.42 * ease));
      shellA.material.uniforms.uT.value = age * 1.3;
      shellA.material.uniforms.uHeat.value = Math.max(0.15, 1.25 - age * 1.05);
      shellA.material.uniforms.uErode.value = Math.max(0, age - 0.3) * 0.75;
      shellA.material.uniforms.uAlpha.value = clamp01(1.6 - age);
      shellA.visible = age < 1.6;
      shellB.position.set(to.x, to.y + rise * 1.15 + 0.1, to.z);
      shellB.scale.set(R * (0.16 + 0.3 * ease), R * (0.16 + 0.27 * ease), R * (0.16 + 0.3 * ease));
      shellB.material.uniforms.uT.value = age * 1.6 + 3;
      shellB.material.uniforms.uHeat.value = Math.max(0.2, 1.4 - age * 1.3);
      shellB.material.uniforms.uErode.value = Math.max(0, age - 0.2) * 0.9;
      shellB.material.uniforms.uAlpha.value = clamp01(1.3 - age);
      shellB.visible = age < 1.3;
      // Rolling smoke cap: rises from the fireball's crown, lit from below while it burns.
      smokes.forEach((m, k) => {
        const a2 = age - 0.12 - k * 0.08;
        m.visible = a2 > 0 && age < 4.4;
        if (!m.visible) return;
        const ang = k * 2.1 + seed;
        m.position.set(to.x + Math.cos(ang) * R * 0.18, to.y + R * 0.3 + a2 * 1.3 + k * 0.22, to.z + Math.sin(ang) * R * 0.18);
        m.scale.set(R * (0.28 + a2 * 0.26), R * (0.2 + a2 * 0.18), R * (0.28 + a2 * 0.26));
        m.material.uniforms.uT.value = a2 * 0.6 + k;
        m.material.uniforms.uGlow.value = Math.max(0, 1 - a2 * 0.9);
        m.material.uniforms.uErode.value = Math.max(0, 0.4 - a2 * 1.2) + Math.max(0, a2 - 2.2) * 0.45;
        m.material.uniforms.uAlpha.value = clamp01(a2 * 4) * 0.92;
      });
      shock.position.set(to.x, to.y, to.z);
      shock.scale.setScalar(R * (0.3 + 0.7 * (1 - Math.exp(-age * 9))));
      shock.material.uniforms.uA.value = clamp01(1 - age / 0.25) ** 2 * 0.12;
      shock.visible = age < 0.3;
      ring.scale.setScalar((R * 0.4 + (1 - Math.exp(-age * 5)) * R * 1.4) * 2);
      ring.position.set(to.x, 0.07, to.z);
      ring.material.uniforms.uR.value = 0.85;
      ring.material.uniforms.uW.value = 0.05;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 0.7) * 0.5;
      ring.visible = age < 0.8;
      scorch.position.set(to.x, 0.03, to.z);
      scorch.scale.setScalar(R * 0.95);
      scorch.material.opacity = clamp01(age * 5) * 0.75;
      // A big warm key light: white-orange flash settling to a deep orange glow.
      const li = age < 0.05 ? 48 * (age / 0.05) : 48 * Math.exp(-(age - 0.05) * 1.8) + 10 * Math.max(0, 1 - age / 2);
      return { light: { i: li, color: age < 0.15 ? 0xffb060 : 0xff7a28, pos: new THREE.Vector3(to.x, to.y + 2.4 + rise * 0.5, to.z) } };
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

  /** Sleep: lilac motes settle over the area and dust the sleepers. */
  sleepCloud(t, centre, size, seed = 1) {
    const r = size * 0.75;
    this.add(t, 2.6, () => ({
      list: [
        particleBurst({ at: { x: centre.x, y: 2.8, z: centre.z }, count: 120, spread: r, speed: 0.3, gravity: 0.25, life: 2.4, stagger: 0.8, size: 0.09, drag: 0.8, turb: 0.4, colors: [0xffffff, 0xc8b0ff, 0x6a50c0], intensity: 2.2, seed, floor: 0.1, fadeIn: 0.2 }),
      ],
    }));
    const ring = groundRing(0xa080ff, 0.15);
    this.add(t, 1.5, () => ({ list: [ring] }), (age) => {
      ring.position.set(centre.x, 0.06, centre.z);
      ring.scale.setScalar(r * 2.6);
      ring.material.uniforms.uR.value = 0.3 + age * 0.4;
      ring.material.uniforms.uA.value = Math.sin(clamp01(age / 1.5) * Math.PI) * 0.6;
      return { light: { i: 4 * Math.sin(clamp01(age / 1.5) * Math.PI), color: 0x9a80ff, pos: new THREE.Vector3(centre.x, 2, centre.z) } };
    });
  }

  /** Stinking cloud: persistent, churning volumetric fog (layered noise billboards). */
  stinkingCloud(t, centre, size, id, seed = 1) {
    const puffs = [];
    for (let k = 0; k < 14; k++) puffs.push(puff(k % 3 ? 0x8a9a3a : 0xa8b050, seed + k));
    this.add(t, 999, () => ({ list: puffs }), (age) => {
      const fade = clamp01(age / 0.8);
      puffs.forEach((p, k) => {
        const a = hashf(seed + k) * Math.PI * 2 + age * 0.15 * (k % 2 ? 1 : -1);
        const rr = size * 0.45 * Math.sqrt(hashf(seed + k * 7));
        p.position.set(centre.x + Math.cos(a) * rr, 0.5 + hashf(seed + k * 3) * 1.1 + Math.sin(age * 0.6 + k) * 0.1, centre.z + Math.sin(a) * rr);
        const sc = (1.6 + hashf(seed + k * 11) * 1.4) * (0.6 + fade * 0.4) * size * 0.35;
        p.scale.set(sc * 1.4, sc, 1);
        p.material.uniforms.uT.value = age + k;
        p.material.uniforms.uA.value = 0.42 * fade;
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

  /** Turn undead: a pillar of golden light from the holy symbol. */
  holyLight(t, at, seed = 1) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 8, 24, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uA; void main(){ float a = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.5, vUv.y); gl_FragColor = vec4(vec3(1.0, 0.85, 0.5) * 2.0, a * uA * 0.5); }`,
    }));
    pillar.renderOrder = 8;
    const ring = groundRing(0xffd070, 0.3);
    this.add(t, 2, () => ({ list: [pillar, ring, particleBurst({ at, count: 70, speed: 3, life: 1.2, size: 0.07, drag: 1.5, hemi: true, colors: [0xffffff, 0xffe090, 0xa07020], intensity: 2.5, seed })] }), (age) => {
      pillar.position.set(at.x, 4, at.z);
      pillar.material.uniforms.uA.value = Math.sin(clamp01(age / 2) * Math.PI);
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(2 + age * 9);
      ring.material.uniforms.uR.value = 0.85;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.2);
      return { light: { i: 18 * Math.sin(clamp01(age / 2) * Math.PI), color: 0xffd080, pos: new THREE.Vector3(at.x, 2.5, at.z) } };
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
