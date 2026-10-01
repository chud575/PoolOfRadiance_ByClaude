import * as THREE from 'three';
import { getGlowTexture } from './textures/index.js';
import { SURFACE_UNIFORMS } from './materials.js';

/**
 * Lighting rig helpers shared by explore/combat/title scenes.
 * All animated lights take `time` from ctx.clock.time (freeze-safe).
 */

// ------------------------------------------------------------ time of day
const C = (h) => new THREE.Color(h);
/** Keyframes by hour. Colours are interpolated in linear RGB. */
const KEYS = [
  { h: 0, top: 0x02040b, hor: 0x121c33, sky: 0x2a3a6a, ground: 0x0a0a12, hemi: 0.3, sun: 0x8fa8ff, sunI: 0.55, fog: 0x0b1222, fogD: 0.028, cloudLit: 0x1a2130, cloudShade: 0x07090f, scatter: 0.05, sunCol: 0x8fa8ff },
  { h: 4.6, top: 0x02040b, hor: 0x121c33, sky: 0x2a3a6a, ground: 0x0a0a12, hemi: 0.3, sun: 0x8fa8ff, sunI: 0.55, fog: 0x0b1222, fogD: 0.028, cloudLit: 0x1a2130, cloudShade: 0x07090f, scatter: 0.05, sunCol: 0x8fa8ff },
  { h: 5.6, top: 0x141c40, hor: 0x9a6a70, sky: 0x6a6a90, ground: 0x1a1414, hemi: 0.45, sun: 0xff9a60, sunI: 0.8, fog: 0x4a4050, fogD: 0.022, cloudLit: 0xe0907a, cloudShade: 0x3a3048, scatter: 0.9, sunCol: 0xff8a50 },
  { h: 6.8, top: 0x2a4a88, hor: 0xf0b088, sky: 0xc0b8c8, ground: 0x2a221c, hemi: 0.7, sun: 0xffb070, sunI: 2.0, fog: 0x9a8a88, fogD: 0.016, cloudLit: 0xffd0a8, cloudShade: 0x6a6878, scatter: 0.9, sunCol: 0xffa060 },
  { h: 8.5, top: 0x3264aa, hor: 0xd6dde6, sky: 0xbcd0f0, ground: 0x3a3228, hemi: 0.9, sun: 0xffe6c4, sunI: 2.9, fog: 0xa8b4c4, fogD: 0.011, cloudLit: 0xfff8f0, cloudShade: 0x8a94a8, scatter: 0.6, sunCol: 0xffe0b0 },
  { h: 12, top: 0x2c5ca6, hor: 0xcdd9e6, sky: 0xbcd4ff, ground: 0x3a3228, hemi: 1.0, sun: 0xfff4e2, sunI: 3.2, fog: 0xa6b6c8, fogD: 0.010, cloudLit: 0xffffff, cloudShade: 0x8c98ac, scatter: 0.45, sunCol: 0xfff0d8 },
  { h: 15.5, top: 0x3060a4, hor: 0xdcd8cc, sky: 0xc4d0ec, ground: 0x3a3026, hemi: 0.95, sun: 0xffe4bc, sunI: 3.0, fog: 0xb0b4b8, fogD: 0.011, cloudLit: 0xfff4e4, cloudShade: 0x8a90a0, scatter: 0.6, sunCol: 0xffe0b0 },
  { h: 17.6, top: 0x283a78, hor: 0xf09a60, sky: 0xffb07a, ground: 0x2a1a14, hemi: 0.7, sun: 0xff9a50, sunI: 2.2, fog: 0x8a6a64, fogD: 0.016, cloudLit: 0xffa070, cloudShade: 0x5a4458, scatter: 1.0, sunCol: 0xff8a40 },
  { h: 18.8, top: 0x141a44, hor: 0x9a5058, sky: 0x7a5a78, ground: 0x1a1214, hemi: 0.45, sun: 0xff7040, sunI: 0.7, fog: 0x3a2c3a, fogD: 0.022, cloudLit: 0xa05a60, cloudShade: 0x2a2034, scatter: 0.8, sunCol: 0xff6a3a },
  { h: 20, top: 0x03060f, hor: 0x162038, sky: 0x2a3a6a, ground: 0x0a0a12, hemi: 0.32, sun: 0x8fa8ff, sunI: 0.55, fog: 0x0b1222, fogD: 0.027, cloudLit: 0x1a2130, cloudShade: 0x07090f, scatter: 0.05, sunCol: 0x8fa8ff },
  { h: 24, top: 0x02040b, hor: 0x121c33, sky: 0x2a3a6a, ground: 0x0a0a12, hemi: 0.3, sun: 0x8fa8ff, sunI: 0.55, fog: 0x0b1222, fogD: 0.028, cloudLit: 0x1a2130, cloudShade: 0x07090f, scatter: 0.05, sunCol: 0x8fa8ff },
];
const COLOR_FIELDS = ['top', 'hor', 'sky', 'ground', 'sun', 'fog', 'cloudLit', 'cloudShade', 'sunCol'];

/** 0 = full day … 1 = full night. */
export function nightFactor(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 17.5) return 0;
  if (h > 17.5 && h < 20) return THREE.MathUtils.smoothstep(h, 17.5, 20);
  if (h > 4.6 && h < 7) return 1 - THREE.MathUtils.smoothstep(h, 4.6, 7);
  return 1;
}

/** Normalised direction to the sun (y up, -Z north). Rises east at 6h, sets west at 18h, culminates in the south. */
export function sunDirection(hour, out = new THREE.Vector3()) {
  const a = ((hour - 6) / 12) * Math.PI;
  const el = Math.sin(a) * 0.95;
  return out.set(Math.cos(a), el, 0.55 + 0.2 * Math.sin(a)).normalize();
}

/** Direction to the moon (opposite-ish arc, high in the south-west at midnight). */
export function moonDirection(hour, out = new THREE.Vector3()) {
  // rises in the east at dusk, arcs low through the southern sky, sets west at dawn
  const a = (((hour + 24 - 18) % 24) / 12) * Math.PI;
  return out.set(Math.cos(a), 0.05 + Math.sin(a) * 0.3, 0.16).normalize();
}

/** Colour/intensity keys by hour (0-24), smoothly interpolated. */
export function timeOfDayKeys(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((h - a.h) / (b.h - a.h), 0, 1);
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === 'h') continue;
    if (COLOR_FIELDS.includes(k)) out[k] = C(a[k]).lerp(C(b[k]), t).getHex();
    else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  const night = nightFactor(h);
  return {
    ...out,
    night,
    fogDensity: out.fogD,
    skyTop: out.top,
    skyHorizon: out.hor,
    sunDir: night > 0.5 ? moonDirection(h) : sunDirection(h),
    trueSunDir: sunDirection(h),
    moonDir: moonDirection(h),
  };
}

/**
 * Sun/moon + sky-fill for an outdoor scene at an in-game hour.
 * @param {THREE.Scene} scene
 * @param {{hour?: number, shadows?: boolean, shadowSize?: number, target?: THREE.Vector3, extent?: number}} [o]
 */
export function createOutdoorRig(scene, o = {}) {
  const hour = o.hour ?? 10;
  const k = timeOfDayKeys(hour);
  const hemi = new THREE.HemisphereLight(k.sky, k.ground, k.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(k.sun, k.sunI);
  const target = o.target ?? new THREE.Vector3();
  const ext = o.extent ?? 30;
  const dir = k.sunDir.clone();
  if (dir.y < 0.22) dir.y = 0.22;
  dir.normalize();
  sun.position.copy(target).addScaledVector(dir, 60);
  sun.target.position.copy(target);
  scene.add(sun, sun.target);
  if (o.shadows !== false) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(o.shadowSize ?? 2048, o.shadowSize ?? 2048);
    const cam = sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
  }
  scene.fog = new THREE.FogExp2(k.fog, k.fogDensity);
  return { hemi, sun, keys: k };
}

// ------------------------------------------------------------------- sky
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // at far plane
  }`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop, uHorizon, uGround, uSunColor, uSunDir, uMoonDir, uCloudLit, uCloudShade;
  uniform float uNight, uCloud, uTime, uSunUp;
  varying vec3 vDir;
  float h13(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float n2(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vDir);
    float y = d.y;
    float t = pow(clamp(y, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uTop, t);
    col += uHorizon * 0.18 * exp(-max(y, 0.0) * 14.0);
    float mu = dot(d, uSunDir);
    float sunVis = smoothstep(-0.12, 0.04, uSunDir.y) * uSunUp;
    col += uSunColor * (pow(max(mu, 0.0), 5.0) * 0.22 + pow(max(mu, 0.0), 48.0) * 0.55) * sunVis;
    // stars + milky way
    if (uNight > 0.01 && y > -0.02) {
      vec3 sd = d * 190.0;
      vec3 cell = floor(sd);
      float hs = h13(cell);
      vec3 cp = cell + 0.5 + (vec3(h13(cell + 1.3), h13(cell + 2.7), h13(cell + 4.1)) - 0.5) * 0.7;
      float dist = length(sd - cp);
      float mag = step(0.978, hs) * (0.35 + 0.65 * h13(cell + 9.1));
      float tw = 0.75 + 0.25 * sin(uTime * (1.5 + hs * 4.0) + hs * 60.0);
      float star = smoothstep(0.2, 0.0, dist) * mag * tw;
      vec3 sc = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), h13(cell + 5.5));
      float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.55, -0.75))) * 3.2, 2.0));
      float mw = band * fbm(d.xz * 9.0 / (abs(y) + 0.4) + 3.0);
      col += (sc * star * 2.2 + vec3(0.32, 0.36, 0.5) * mw * 0.09) * uNight * smoothstep(-0.02, 0.18, y);
      // moon
      float mm = dot(d, uMoonDir);
      // a small disc (~1.1 deg) with maria, ray-crater speckle and limb darkening; held below the
      // bloom clip so it reads as a moon, not a streetlamp
      float disk = smoothstep(0.99979, 0.99983, mm);
      vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mu2 = cross(mr, uMoonDir);
      vec2 q = vec2(dot(d, mr), dot(d, mu2)) / 0.0185;
      float rq = length(q);
      float maria = smoothstep(0.48, 0.62, fbm(q * 1.6 + vec2(3.1, 7.7)));
      float crater = fbm(q * 7.0 + 5.0);
      float limb = sqrt(max(0.0, 1.0 - rq * rq));
      vec3 moonCol = vec3(0.98, 0.96, 0.9) * (0.62 + 0.38 * crater) * (1.0 - maria * 0.38) * (0.55 + 0.45 * limb) * 0.95;
      col = mix(col, moonCol, disk * uNight);
      col += vec3(0.5, 0.6, 0.85) * (pow(max(mm, 0.0), 9000.0) * 0.12 + pow(max(mm, 0.0), 600.0) * 0.05 + pow(max(mm, 0.0), 14.0) * 0.05) * uNight;
      // faint warm glow of Phlan's fires on the horizon
      col += vec3(0.16, 0.08, 0.04) * exp(-max(y, 0.0) * 22.0) * uNight;
    }
    // clouds
    if (y > 0.0) {
      vec2 p = d.xz / (y + 0.09) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
      float n = fbm(p);
      float cov = uCloud;
      float c = smoothstep(1.0 - cov, 1.0 - cov + 0.22, n) * smoothstep(0.0, 0.12, y);
      float n2s = fbm(p + uSunDir.xz * 0.12);
      float lit = clamp(0.55 + (n - n2s) * 4.0, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      cc += uSunColor * pow(max(mu, 0.0), 10.0) * 0.8 * sunVis * (1.0 - c * 0.5);
      // silver lining near the sun
      cc += uSunColor * pow(max(mu, 0.0), 30.0) * (1.0 - smoothstep(0.0, 0.5, c)) * 1.5 * sunVis;
      col = mix(col, cc, c * 0.94);
    }
    // sun disk (in front of thin clouds only)
    col += uSunColor * smoothstep(0.99955, 0.9998, mu) * 30.0 * sunVis;
    // below the horizon fade to the ground/fog colour
    col = mix(col, uGround, smoothstep(0.0, -0.06, y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/**
 * Physically-inspired sky dome: time-of-day gradient, sun disk + Mie glow,
 * drifting fbm clouds lit from the sun, stars, milky way and moon at night.
 * Returns a Mesh; call mesh.userData.update(time) for drifting clouds/twinkle.
 * @param {{hour?: number, radius?: number, cloud?: number}} [o]
 */
export function createSkyDome(o = {}) {
  const hour = o.hour ?? 10;
  const k = timeOfDayKeys(hour);
  const sunUp = k.trueSunDir.y > -0.1 ? 1 : 0;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uTop: { value: C(k.skyTop) },
      uHorizon: { value: C(k.skyHorizon) },
      uGround: { value: C(k.fog) },
      uSunColor: { value: C(k.sunCol) },
      uSunDir: { value: k.trueSunDir.clone() },
      uMoonDir: { value: k.moonDir.clone() },
      uCloudLit: { value: C(k.cloudLit) },
      uCloudShade: { value: C(k.cloudShade) },
      uNight: { value: k.night },
      uCloud: { value: o.cloud ?? 0.42 },
      uTime: { value: 0 },
      uSunUp: { value: sunUp },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius ?? 400, 48, 24), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.userData.update = (time) => {
    mat.uniforms.uTime.value = time;
  };
  mesh.userData.keys = k;
  return mesh;
}

// ------------------------------------------------------------------ flames
/** Shared uniforms for all flame billboards. */
export const FLAME_UNIFORMS = { uTime: { value: 0 } };
let flameMat = null;
/**
 * Layered shader flame (additive, Y-axis billboard): a noise-scrolled body made of three licking
 * tongues that sway and flicker independently, a black-body colour ramp (deep orange rim → amber →
 * yellow → near-white core, kept below the bloom clip), a faint blue root, and a dim smoke wisp
 * curling off the tip. Brightness and height follow the same deterministic flicker() as the
 * flame's point light (per-instance aSeed), so the light on the walls breathes with the fire.
 */
export function getFlameMaterial() {
  if (flameMat) return flameMat;
  flameMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: FLAME_UNIFORMS,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSeed;
      varying vec2 vUv; varying float vSeed; varying vec3 vTint; varying float vFlick; varying float vPx;
      void main(){
        vUv = uv;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        mat4 mm = modelMatrix;
        #ifdef USE_INSTANCING
          mm = modelMatrix * instanceMatrix;
        #endif
        vec4 c = mm * vec4(0.0, 0.0, 0.0, 1.0);
        vSeed = fract(sin(dot(c.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float s = aSeed;
        // == flicker(time, seed) in lighting.js
        vFlick = 0.86 + 0.08 * sin(uTime * 13.0 + s) + 0.05 * sin(uTime * 29.7 + s * 3.0) + 0.04 * sin(uTime * 7.3 + s * 1.7) - 0.03 * max(0.0, sin(uTime * 3.1 + s * 5.0));
        vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(0.0, 1.0, 0.0);
        float sx = length(mm[0].xyz);
        float sy = length(mm[1].xyz) * (0.88 + 0.14 * vFlick);
        vec3 wp = c.xyz + camR * position.x * sx + up * position.y * sy;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        // approx. on-screen size in pixels (tiny distant flames get simpler, softer shapes)
        vPx = sx * projectionMatrix[1][1] * 450.0 / max(-mv.z, 0.05);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying float vSeed; varying vec3 vTint; varying float vFlick; varying float vPx;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ s += a * n(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      vec3 ramp(float k){
        vec3 c = mix(vec3(0.42, 0.05, 0.008), vec3(0.95, 0.27, 0.03), smoothstep(0.0, 0.32, k));
        c = mix(c, vec3(1.0, 0.56, 0.12), smoothstep(0.28, 0.6, k));
        c = mix(c, vec3(1.0, 0.82, 0.42), smoothstep(0.58, 0.85, k));
        c = mix(c, vec3(1.0, 0.93, 0.74), smoothstep(0.85, 1.0, k));
        return c;
      }
      // one tongue: rounded root, tapering licking tip; returns soft coverage
      float tongue(float x, float y, float xo, float ht, float wd){
        float yy = y / ht;
        float w = wd * pow(clamp(1.0 - yy, 0.0, 1.0), 0.6) * (0.55 + 0.45 * smoothstep(-0.12, 0.22, yy));
        return (1.0 - smoothstep(w * 0.12, w * 1.1 + 0.03, abs(x - xo))) * step(0.0, 1.0 - yy);
      }
      void main(){
        vec2 uv = vUv;
        float t = uTime + vSeed * 17.0;
        float x = (uv.x - 0.5) * 2.0;
        float y = uv.y / 0.74;          // body fills the lower ~3/4; smoke above
        float detail = smoothstep(6.0, 30.0, vPx);
        // rising turbulence, stronger towards the tip
        float d1 = fbm(vec2(x * 1.7, y * 2.3 - t * 3.6));
        float d2 = fbm(vec2(x * 3.9 + 3.1, y * 4.4 - t * 6.1));
        float sway = sin(t * 2.1 + vSeed * 6.0) * 0.07 * y + (n(vec2(t * 1.3, vSeed * 9.0)) - 0.5) * 0.16 * y;
        float xd = x + ((d1 - 0.5) * 0.75 + (d2 - 0.5) * 0.3 * detail) * y + sway;
        // three tongues: a tall centre and two shorter flankers that part as they rise
        float h0 = 0.86 + 0.14 * n(vec2(t * 4.3, 1.0 + vSeed * 5.0));
        float h1 = 0.52 + 0.22 * n(vec2(t * 5.1, 7.0 + vSeed * 3.0));
        float h2 = 0.48 + 0.24 * n(vec2(t * 4.7, 13.0 + vSeed * 7.0));
        float body = tongue(xd, y, 0.0, h0 * vFlick, 0.5);
        body = max(body, tongue(xd, y, -0.16 - 0.2 * y, h1, 0.4) * detail);
        body = max(body, tongue(xd, y, 0.15 + 0.22 * y, h2, 0.38) * detail);
        body = max(body, tongue(xd, y, 0.0, h0 * 0.8, 0.62) * (1.0 - detail));
        // licks break away near the tip
        body *= smoothstep(0.12, 0.55, d2 + (1.0 - y) * 0.8);
        // temperature: hottest low in the middle, cooling outward and upward
        float core = (1.0 - smoothstep(0.0, 0.26, abs(xd))) * (1.0 - smoothstep(0.05, 0.62, y)) * smoothstep(0.0, 0.08, y);
        float k = clamp(body * (0.5 - y * 0.32) + core * 0.6 + (d1 - 0.5) * 0.15, 0.0, 1.0);
        vec3 col = ramp(k);
        // a dim blue root where the fuel is
        float root = (1.0 - smoothstep(0.0, 0.11, y)) * (1.0 - smoothstep(0.0, 0.3, abs(xd))) * body;
        col = mix(col, vec3(0.25, 0.32, 0.9), root * 0.35);
        // tinted (unholy / magical) fire: the tint drives the ramp instead of black-body colours
        float tintAmt = step(vTint.r + vTint.g + vTint.b, 2.99);
        vec3 tc = mix(vTint * 0.28, vTint * 0.8, smoothstep(0.0, 0.55, k));
        tc = mix(tc, mix(vTint, vec3(1.0), 0.5), smoothstep(0.7, 1.0, k));
        col = mix(col, tc * 0.75, tintAmt);
        float I = body * (0.55 + 0.85 * k) * (0.85 + 0.15 * vFlick);
        // smoke wisp: a faint curl of lit haze rising off the tip
        float sy = (uv.y - 0.5) / 0.5;
        float sx = x + (fbm(vec2(x * 2.0, uv.y * 3.0 - t * 1.2)) - 0.5) * 1.2 * sy + sin(uv.y * 7.0 - t * 1.7) * 0.12 * sy;
        float wisp = (1.0 - smoothstep(0.04, 0.14 + 0.2 * sy, abs(sx))) * smoothstep(0.0, 0.3, sy) * (1.0 - smoothstep(0.5, 1.0, sy));
        wisp *= smoothstep(0.35, 0.7, fbm(vec2(x * 3.0, uv.y * 5.0 - t * 2.0))) * detail * (1.0 - tintAmt * 0.6);
        vec3 outc = col * I * 1.35 + vec3(0.11, 0.095, 0.085) * wisp * 0.35;
        float a = clamp(body + wisp * 0.1, 0.0, 1.0);
        gl_FragColor = vec4(outc, a);
      }`,
  });
  return flameMat;
}

function flameGeometry(count, seeds) {
  const g = new THREE.PlaneGeometry(1, 1.6);
  g.translate(0, 0.8, 0);
  if (count === 0) {
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(seeds ?? 0), 1));
  }
  return g;
}

/**
 * Many flames in one draw call. items: [{pos: Vector3, scale: number, color?: hex (tinted fire), seed?: number (= the light's flicker seed)}]
 * @returns {THREE.InstancedMesh}
 */
export function createFlameBatch(items) {
  const g = flameGeometry(1);
  const n = Math.max(1, items.length);
  const seeds = new Float32Array(n);
  items.forEach((it, i) => (seeds[i] = it.seed ?? (it.pos.x * 7.13 + it.pos.z * 3.71) % 50));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const mesh = new THREE.InstancedMesh(g, getFlameMaterial(), n);
  const m = new THREE.Matrix4();
  items.forEach((it, i) => mesh.setMatrixAt(i, m.compose(it.pos, new THREE.Quaternion(), new THREE.Vector3(it.scale, it.scale, it.scale))));
  if (items.some((it) => it.color !== undefined)) {
    const c = new THREE.Color();
    items.forEach((it, i) => mesh.setColorAt(i, it.color !== undefined ? c.set(it.color) : c.setRGB(1, 1, 1)));
  }
  mesh.count = items.length;
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Many flickering additive glows in one draw call (points).
 * items: [{pos, size (world m), color, seed, opacity}]
 */
export function createGlowBatch(items) {
  const n = items.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const extra = new Float32Array(n * 3);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    pos.set([it.pos.x, it.pos.y, it.pos.z], i * 3);
    c.set(it.color ?? 0xffa050);
    col.set([c.r, c.g, c.b], i * 3);
    extra.set([it.size ?? 0.8, it.seed ?? 0, it.opacity ?? 1], i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aExtra', new THREE.Float32BufferAttribute(extra, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: FLAME_UNIFORMS.uTime, uScale: { value: 450 }, uMap: { value: getGlowTexture() } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScale; attribute vec3 aExtra; attribute vec3 color;
      varying vec3 vColor; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = aExtra.y;
        float f = 0.86 + 0.08 * sin(uTime * 13.0 + s) + 0.05 * sin(uTime * 29.7 + s * 3.0) + 0.04 * sin(uTime * 7.3 + s * 1.7);
        vA = (0.7 + 0.3 * f) * aExtra.z;
        vColor = color;
        gl_PointSize = clamp(aExtra.x * uScale / max(-mv.z, 0.05), 0.0, 900.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying vec3 vColor; varying float vA;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb * vA, t.a * vA);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  pts.userData.setScale = (v) => (mat.uniforms.uScale.value = v);
  pts.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  return pts;
}

/** A camera-facing flame quad (origin at flame base). */
export function createFlame(scale = 0.28, seed = 0) {
  const g = flameGeometry(0, seed);
  const m = new THREE.Mesh(g, getFlameMaterial());
  m.scale.set(scale, scale, scale);
  m.renderOrder = 5;
  m.frustumCulled = false;
  return m;
}

/**
 * Flickering torch/fire light with a glow sprite. Call .update(time).
 * @param {{color?: number, intensity?: number, distance?: number, glow?: boolean, seed?: number, flame?: boolean, flameScale?: number, light?: boolean}} [o]
 */
export function createTorch(o = {}) {
  const group = new THREE.Group();
  let light = null;
  if (o.light !== false) {
    light = new THREE.PointLight(o.color ?? 0xffa050, o.intensity ?? 12, o.distance ?? 14, 1.6);
    group.add(light);
  }
  let sprite = null;
  if (o.glow !== false) {
    sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: o.color ?? 0xffa050, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sprite.scale.setScalar(0.8);
    group.add(sprite);
  }
  let flame = null;
  if (o.flame) {
    flame = createFlame(o.flameScale ?? 0.28, o.seed ?? 0);
    group.add(flame);
  }
  const base = o.intensity ?? 12;
  const seed = o.seed ?? 0;
  group.userData.base = base;
  group.userData.update = (time) => {
    const f = flicker(time, seed);
    if (light) light.intensity = group.userData.base * f;
    if (sprite) sprite.material.opacity = (0.7 + 0.3 * f) * (group.userData.glowScale ?? 1);
    if (flame) FLAME_UNIFORMS.uTime.value = time;
  };
  group.userData.light = light;
  group.userData.sprite = sprite;
  group.userData.flame = flame;
  return group;
}

/** Deterministic fire flicker multiplier (~0.75..1.05). */
export function flicker(time, seed = 0) {
  return 0.86 + 0.08 * Math.sin(time * 13 + seed) + 0.05 * Math.sin(time * 29.7 + seed * 3) + 0.04 * Math.sin(time * 7.3 + seed * 1.7) - 0.03 * Math.max(0, Math.sin(time * 3.1 + seed * 5));
}

/** Push sun/scatter info into the SurfaceFX uniforms (height fog, sun in-scatter). */
export function setSurfaceAtmosphere({ sunDir, sunColor, scatter = 0, heightFog = 0, heightFalloff = 0.35, grimeTint, mossTint, wet = 0 } = {}) {
  const U = SURFACE_UNIFORMS;
  if (sunDir) U.uFxSunDir.value.copy(sunDir).normalize();
  if (sunColor !== undefined) U.uFxSunColor.value.set(sunColor);
  U.uFxScatter.value = scatter;
  U.uFxHeightFog.value = heightFog;
  U.uFxHeightFalloff.value = heightFalloff;
  if (grimeTint !== undefined) U.uFxGrimeTint.value.set(grimeTint);
  if (mossTint !== undefined) U.uFxMossTint.value.set(mossTint);
  U.uFxWet.value = wet;
}
