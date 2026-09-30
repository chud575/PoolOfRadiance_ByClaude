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

/** Turbulent fire/smoke sphere (fireball core). */
function fireSphere() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uHeat: { value: 1 }, uAlpha: { value: 1 }, uSeed: { value: 0 } },
    vertexShader: `${NOISE_GLSL}
      uniform float uT, uSeed; varying vec3 vN; varying vec3 vP; varying float vDisp; varying vec3 vView;
      void main(){
        vec3 p = position;
        float d = fbm3(normalize(position) * 2.2 + vec3(0.0, -uT * 1.5, uSeed));
        p += normal * d * 0.35;
        vDisp = d;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uT, uHeat, uAlpha, uSeed; varying vec3 vN; varying vec3 vP; varying float vDisp; varying vec3 vView;
      void main(){
        float fres = pow(1.0 - abs(dot(vN, vView)), 1.5);
        float n = fbm3(vP * 3.0 + vec3(0.0, -uT * 2.5, uSeed)) * 0.5 + 0.5;
        float heat = clamp(uHeat * (1.1 - fres * 0.8) * (0.55 + n * 0.8) + vDisp * 0.6, 0.0, 1.5);
        vec3 smoke = vec3(0.09, 0.07, 0.06);
        vec3 c = mix(smoke, vec3(0.9, 0.18, 0.02), smoothstep(0.1, 0.45, heat));
        c = mix(c, vec3(1.0, 0.62, 0.15), smoothstep(0.45, 0.8, heat));
        c = mix(c, vec3(1.0, 0.95, 0.75), smoothstep(0.8, 1.2, heat));
        float glow = smoothstep(0.25, 1.2, heat) * 4.0;
        float a = uAlpha * (1.0 - fres * 0.55) * smoothstep(0.0, 0.25, n + 0.2);
        gl_FragColor = vec4(c * (0.6 + glow), a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), mat);
  mesh.renderOrder = 8;
  mesh.frustumCulled = false;
  return mesh;
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

/** Billboard fire/smoke puff: noise-shaped, heat-ramped (white→yellow→orange→red→smoke). */
function firePuff(seed, additive = true) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uT: { value: 0 }, uHeat: { value: 1 }, uA: { value: 1 }, uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      mv.xy += position.xy * sc; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform float uT, uHeat, uA, uSeed;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float n = fbm3(vec3(p * 2.2, uT * 1.3 + uSeed)) * 0.5 + 0.5;
        float body = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.9);
        float h = uHeat * (0.55 + n * 0.8) * (1.15 - r * 0.6);
        vec3 c = mix(vec3(0.25, 0.04, 0.01), vec3(0.95, 0.28, 0.04), smoothstep(0.1, 0.45, h));
        c = mix(c, vec3(1.0, 0.7, 0.2), smoothstep(0.45, 0.85, h));
        c = mix(c, vec3(1.0, 0.95, 0.8), smoothstep(0.85, 1.3, h));
        ${additive ? 'gl_FragColor = vec4(c * (0.5 + h * 2.2), body * uA * 0.8);' : 'gl_FragColor = vec4(vec3(0.07, 0.06, 0.055) * (0.6 + n * 0.8), body * uA * 0.85);'}
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = additive ? 9 : 8;
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
    this.light = light ?? new THREE.PointLight(0xffa040, 0, 16, 1.6);
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

  update(t, camera, pix) {
    this.ctx.pix = pix;
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
        particleBurst({ at, count: crit ? 40 : 22, speed: crit ? 6 : 4.5, life: 0.35, size: 0.05, drag: 3, gravity: 9, colors: [0xffffff, 0xffd070, 0xff6010], intensity: 3, seed, floor: 0.02 }),
        ...(blood && !bone ? [particleBurst({ at, count: crit ? 26 : 14, speed: 2.2, life: 0.7, size: 0.07, drag: 1.5, gravity: 9.8, colors: [0x7a0a06, 0x4a0504, 0x2a0303], additive: false, intensity: 1, soft: 0.3, seed: seed + 7, floor: 0.02 })] : []),
        ...(bone ? [particleBurst({ at, count: 16, speed: 2.5, life: 0.8, size: 0.06, drag: 1.2, gravity: 9.8, colors: [0xe8e0c8, 0xc8b898, 0x8a7a60], additive: false, intensity: 1, soft: 0.2, seed: seed + 9, floor: 0.02 })] : []),
        glowSprite(0xffc070, crit ? 0.9 : 0.6, 0.7),
      ],
    }), (age, parts) => {
      const sp = parts.list[parts.list.length - 1];
      sp.position.copy(at);
      sp.material.opacity = Math.max(0, 1 - age / 0.12) * 0.7;
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
   * Fireball: a bright bead flies to the target, then detonates with a
   * turbulent fire sphere, flash light, ground shockwave, embers and smoke.
   * Returns {flight, detonate} (seconds from t).
   */
  fireball(t, from, to, radius = 2.5 * 1.5, seed = 1) {
    const flight = Math.max(0.35, from.distanceTo(to) / 16);
    const bead = glowSprite(0xffa040, 0.8);
    const beadCore = glowSprite(0xffffff, 0.3);
    const trail = particleBurst({
      at: from, count: 60, life: 0.45, size: 0.22, speed: 0.4, drag: 2, grow: 1.5, stagger: flight, turb: 0.4,
      colors: [0xffe0a0, 0xff6010, 0x401008], intensity: 2.2, seed,
      emit: (i, r) => {
        const u = clamp01((i / 60) * 1.0);
        const p = new THREE.Vector3().lerpVectors(from, to, u);
        p.y += Math.sin(u * Math.PI) * 1.2;
        return [p.x + (r(1) - 0.5) * 0.1, p.y, p.z + (r(2) - 0.5) * 0.1];
      },
    });
    // Trail particles emitted in sequence along the path: delay = u * flight.
    const d = trail.obj.geometry.attributes.aD;
    for (let i = 0; i < 60; i++) d.setX(i, (i / 60) * flight);
    this.add(t, flight + 0.5, () => ({ list: [bead, beadCore, trail] }), (age) => {
      const u = clamp01(age / flight);
      const p = new THREE.Vector3().lerpVectors(from, to, u);
      p.y += Math.sin(u * Math.PI) * 1.2;
      bead.position.copy(p);
      beadCore.position.copy(p);
      bead.visible = beadCore.visible = u < 1;
      bead.scale.setScalar(0.7 + Math.sin(age * 40) * 0.1);
      return { light: { i: u < 1 ? 8 : 0, color: 0xff9040, pos: p } };
    });
    const T = t + flight;
    const R = radius;
    const core = fireSphere();
    const ring = groundRing(0xffa050, 0.25);
    const flash = glowSprite(0xffd8a0, R * 2.6, 1);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8 }));
    scorch.renderOrder = 1;
    const N = 18;
    const fires = [];
    const smokes = [];
    const dirs = [];
    for (let k = 0; k < N; k++) {
      fires.push(firePuff(seed + k * 1.7, true));
      smokes.push(firePuff(seed + k * 2.3 + 40, false));
      const th = hashf(seed + k * 3.1) * Math.PI * 2;
      const up = 0.15 + hashf(seed + k * 5.3) * 0.85;
      dirs.push(new THREE.Vector3(Math.cos(th) * (1 - up * 0.5), up, Math.sin(th) * (1 - up * 0.5)).normalize());
    }
    const embers = particleBurst({ at: to, count: 110, speed: 8, life: 1.5, size: 0.06, drag: 1.3, gravity: 6, hemi: true, colors: [0xffffff, 0xffa030, 0x802000], intensity: 3.5, seed: seed + 3, floor: 0.03 });
    const debris = particleBurst({ at: { x: to.x, y: 0.2, z: to.z }, count: 36, speed: 6.5, life: 1.2, size: 0.09, drag: 1, gravity: 12, hemi: true, colors: [0x5a4a3a, 0x3a3028, 0x2a2420], additive: false, intensity: 1, soft: 0.2, seed: seed + 5, floor: 0.03 });
    const dust = particleBurst({ at: { x: to.x, y: 0.15, z: to.z }, count: 28, spread: 0.3, flatY: true, hemi: true, speed: 7, up: 0.12, life: 1.6, size: 0.9, grow: 2.5, drag: 3.2, colors: [0x7a6a58, 0x5a4e42, 0x3a342e], additive: false, intensity: 1, soft: 0.95, seed: seed + 13, fadeIn: 0.05 });
    this.add(T, 4, () => ({ list: [scorch, ring, dust, ...smokes, core, ...fires, flash, embers, debris] }), (age) => {
      const grow = 1 - Math.exp(-age * 7);
      // Core: a brief white-hot sphere.
      const cr = R * (0.2 + 0.45 * (1 - Math.exp(-age * 14)));
      core.position.set(to.x, to.y + 0.2, to.z);
      core.scale.setScalar(cr);
      core.material.uniforms.uT.value = age;
      core.material.uniforms.uHeat.value = Math.max(0, 1.4 - age * 3.2);
      core.material.uniforms.uAlpha.value = Math.max(0, 0.9 - age * 2.4);
      core.visible = age < 0.45;
      // Billowing fire puffs thrown outward and up.
      for (let k = 0; k < N; k++) {
        const d = dirs[k];
        const reach = R * (0.35 + hashf(seed + k * 9.1) * 0.55) * grow;
        const f = fires[k];
        f.position.set(to.x + d.x * reach, to.y + 0.1 + d.y * reach * 0.8 + age * 0.9, to.z + d.z * reach);
        const sz = R * (0.38 + hashf(seed + k * 4.7) * 0.3) * (0.5 + grow * 0.7);
        f.scale.set(sz, sz, 1);
        f.material.uniforms.uT.value = age + k;
        f.material.uniforms.uHeat.value = Math.max(0, 1.25 - age * 1.35 - hashf(seed + k) * 0.25);
        f.material.uniforms.uA.value = Math.max(0, 1 - Math.max(0, age - 0.5) * 1.3);
        f.visible = age < 1.3;
        const sm = smokes[k];
        sm.position.set(to.x + d.x * reach * 1.1, to.y + 0.4 + d.y * reach + age * 1.3, to.z + d.z * reach * 1.1);
        const ss = sz * (1.1 + age * 0.5);
        sm.scale.set(ss, ss, 1);
        sm.material.uniforms.uT.value = age * 0.5 + k;
        sm.material.uniforms.uA.value = clamp01((age - 0.25) * 2.5) * Math.max(0, 1 - (age - 1.2) * 0.4);
        sm.visible = age > 0.2 && age < 3.8;
      }
      ring.scale.setScalar((R * 0.4 + (1 - Math.exp(-age * 5)) * R * 1.3) * 2);
      ring.position.set(to.x, 0.07, to.z);
      ring.material.uniforms.uR.value = 0.85;
      ring.material.uniforms.uW.value = 0.07;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 0.7);
      ring.visible = age < 0.75;
      flash.position.set(to.x, to.y + 0.5, to.z);
      flash.material.opacity = Math.max(0, 1 - age / 0.2) * 0.9;
      flash.visible = age < 0.25;
      scorch.position.set(to.x, 0.03, to.z);
      scorch.scale.setScalar(R * 0.95);
      scorch.material.opacity = clamp01(age * 5) * 0.75;
      const li = age < 0.06 ? 55 * (age / 0.06) : 55 * Math.exp(-(age - 0.06) * 2.6);
      return { light: { i: li, color: 0xff8a30, pos: new THREE.Vector3(to.x, to.y + 1.8, to.z) } };
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
