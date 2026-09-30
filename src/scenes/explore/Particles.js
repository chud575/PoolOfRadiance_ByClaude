import * as THREE from 'three';

/**
 * GPU particle fields. All motion is computed in the vertex shader from
 * uTime (= ctx.clock.time), so a frozen clock renders an identical frame.
 *
 * kinds: 'dust' (sunlit motes around the camera), 'fireflies' (night, near
 * ground), 'embers' (rising from torch origins), 'smoke' (chimneys),
 * 'mist' (large faint wisps drifting through the streets).
 */
const VERT = /* glsl */ `
  uniform float uTime; uniform vec3 uCam; uniform float uScale; uniform float uSize; uniform vec3 uBoxMin; uniform vec3 uBoxSize;
  attribute vec4 aSeed; attribute vec3 aOrigin;
  varying float vAlpha; varying float vHeat; varying vec2 vRot;
  void main(){
    vec3 p; float size = uSize; float a = 1.0; vHeat = 0.0;
    float t = uTime;
    #if defined(KIND_DUST)
      vec3 box = uBoxSize;
      vec3 drift = vec3(0.05, 0.015, 0.03) * (0.4 + aSeed.w);
      vec3 q = fract(aSeed.xyz + drift * t / box + vec3(sin(t * 0.3 + aSeed.w * 20.0), sin(t * 0.23 + aSeed.x * 17.0), cos(t * 0.27 + aSeed.y * 13.0)) * 0.012);
      p = uCam + (q - 0.5) * box;
      p.y = uBoxMin.y + q.y * box.y;
      vec3 e = abs(q - 0.5) * 2.0;
      a = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.z))) * (0.35 + 0.65 * aSeed.w);
      size *= 0.5 + aSeed.z;
    #elif defined(KIND_FIREFLIES)
      vec3 box = uBoxSize;
      vec3 q = fract(aSeed.xyz + vec3(sin(t * 0.21 + aSeed.w * 30.0), 0.0, cos(t * 0.17 + aSeed.x * 20.0)) * 0.02);
      p = uCam + (q - 0.5) * box;
      p.y = uBoxMin.y + q.y * box.y + sin(t * 0.9 + aSeed.z * 40.0) * 0.25;
      float blink = pow(max(sin(t * (1.2 + aSeed.w * 1.5) + aSeed.x * 50.0), 0.0), 6.0);
      vec3 e = abs(q - 0.5) * 2.0;
      a = blink * (1.0 - smoothstep(0.6, 1.0, max(e.x, e.z)));
    #elif defined(KIND_EMBERS)
      float life = fract(t * (0.35 + aSeed.w * 0.3) + aSeed.x);
      p = aOrigin + vec3(sin(t * 3.0 + aSeed.y * 40.0) * 0.08 * life + (aSeed.z - 0.5) * 0.1, life * (0.9 + aSeed.y * 0.9), cos(t * 2.7 + aSeed.z * 30.0) * 0.08 * life);
      a = (1.0 - life) * smoothstep(0.0, 0.08, life);
      vHeat = 1.0 - life;
      size *= 0.6 + aSeed.z * 0.8;
    #elif defined(KIND_SMOKE)
      float life = fract(t * (0.06 + aSeed.w * 0.03) + aSeed.x);
      p = aOrigin + vec3(life * 3.5 + sin(t * 0.4 + aSeed.y * 10.0) * 0.4 * life, life * 7.0, life * 1.2 + (aSeed.z - 0.5) * life * 1.5);
      size = uSize * (0.4 + life * 2.4);
      a = (1.0 - life) * smoothstep(0.0, 0.1, life) * 0.55;
    #else // KIND_MIST
      vec3 q = fract(aSeed.xyz + vec3(t * 0.004 * (0.5 + aSeed.w), 0.0, t * 0.0015));
      p = uBoxMin + q * uBoxSize;
      size *= 0.6 + aSeed.w * 0.8;
      vec3 e = abs(q - 0.5) * 2.0;
      a = 1.0 - smoothstep(0.8, 1.0, max(e.x, e.z));
    #endif
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uScale / max(-mv.z, 0.05), 0.0, 700.0);
    // fade very close points (avoid giant blobs in the face)
    a *= smoothstep(0.25, 1.0, -mv.z);
    vAlpha = a;
    vRot = vec2(cos(aSeed.w * 6.28), sin(aSeed.w * 6.28));
  }`;
const FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uColor2; uniform float uIntensity;
  varying float vAlpha; varying float vHeat; varying vec2 vRot;
  void main(){
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc) * 2.0;
    #if defined(KIND_SMOKE) || defined(KIND_MIST)
      vec2 r = vec2(pc.x * vRot.x - pc.y * vRot.y, pc.x * vRot.y + pc.y * vRot.x);
      float n = sin(r.x * 9.0 + 1.3) * sin(r.y * 7.0 + 0.4) * 0.15;
      float a = smoothstep(1.0, 0.1, d + n) * vAlpha * uIntensity;
      gl_FragColor = vec4(uColor, a);
    #else
      float core = smoothstep(1.0, 0.0, d);
      core *= core;
      vec3 c = mix(uColor2, uColor, vHeat);
      gl_FragColor = vec4(c * core * vAlpha * uIntensity, core * vAlpha);
    #endif
  }`;

/**
 * @param {'dust'|'fireflies'|'embers'|'smoke'|'mist'} kind
 * @param {{count?: number, origins?: THREE.Vector3[], box?: [THREE.Vector3, THREE.Vector3], color?: number, color2?: number,
 *   size?: number, intensity?: number, seed?: number}} o
 */
export function createParticles(kind, o = {}) {
  const origins = o.origins ?? [];
  const perOrigin = kind === 'embers' ? 10 : kind === 'smoke' ? 18 : 0;
  const count = perOrigin ? origins.length * perOrigin : (o.count ?? 300);
  if (!count) return null;
  const seed = new Float32Array(count * 4);
  const org = new Float32Array(count * 3);
  let s = (o.seed ?? 1) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
    if (perOrigin) {
      const p = origins[Math.floor(i / perOrigin)];
      org[i * 3] = p.x;
      org[i * 3 + 1] = p.y;
      org[i * 3 + 2] = p.z;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  geo.setAttribute('aOrigin', new THREE.Float32BufferAttribute(org, 3));
  const box = o.box ?? [new THREE.Vector3(-8, 0.2, -8), new THREE.Vector3(8, 3.5, 8)];
  const additive = kind === 'dust' || kind === 'fireflies' || kind === 'embers';
  const mat = new THREE.ShaderMaterial({
    defines: { [`KIND_${kind.toUpperCase()}`]: 1 },
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uScale: { value: 450 },
      uSize: { value: o.size ?? 0.02 },
      uBoxMin: { value: box[0].clone() },
      uBoxSize: { value: box[1].clone().sub(box[0]) },
      uColor: { value: new THREE.Color(o.color ?? 0xffe6b0) },
      uColor2: { value: new THREE.Color(o.color2 ?? o.color ?? 0xff5a1a) },
      uIntensity: { value: o.intensity ?? 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 6 : 4;
  pts.userData.kind = kind;
  pts.userData.update = (time, camera, viewportH) => {
    mat.uniforms.uTime.value = time;
    mat.uniforms.uCam.value.copy(camera.position);
    mat.uniforms.uScale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  pts.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  return pts;
}
