import * as THREE from 'three';
import { prng } from './geom.js';

/**
 * GPU-animated particles (embers, motes, sparks). Position is a pure function
 * of time + per-particle seed, so frozen-clock shots are deterministic.
 *
 * @param {{count?:number, origin?:THREE.Vector3, spread?:THREE.Vector3, height?:number, speed?:[number,number],
 *   size?:number, colorA?:THREE.ColorRepresentation, colorB?:THREE.ColorRepresentation, wind?:THREE.Vector3,
 *   sway?:number, disc?:boolean, seed?:number, intensity?:number}} o
 */
export function createParticles(o = {}) {
  const count = o.count ?? 100;
  const R = prng(o.seed ?? 1);
  const seeds = new Float32Array(count * 4);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) seeds.set([R.next(), R.next(), R.next(), R.next()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const sp = o.speed ?? [0.1, 0.25];
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: (o.origin ?? new THREE.Vector3()).clone() },
      uSpread: { value: (o.spread ?? new THREE.Vector3(1, 0, 1)).clone() },
      uHeight: { value: o.height ?? 5 },
      uSpeed: { value: new THREE.Vector2(sp[0], sp[1]) },
      uSize: { value: o.size ?? 1 },
      uColA: { value: new THREE.Color(o.colorA ?? 0xffe0a0) },
      uColB: { value: new THREE.Color(o.colorB ?? 0xff5010) },
      uWind: { value: (o.wind ?? new THREE.Vector3()).clone() },
      uSway: { value: o.sway ?? 0.4 },
      uDisc: { value: o.disc ? 1 : 0 },
      uIntensity: { value: o.intensity ?? 1 },
      uPx: { value: 1 },
      uRes: { value: new THREE.Vector2(1600, 900) },
      uStreak: { value: o.streak ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uHeight, uSize, uSway, uDisc, uPx, uStreak;
      uniform vec3 uOrigin, uSpread, uWind; uniform vec2 uSpeed, uRes;
      varying float vLife; varying float vFlick; varying vec2 vDir; varying float vStretch;
      vec3 at(float t, out float life) {
        float spd = mix(uSpeed.x, uSpeed.y, aSeed.w);
        life = fract(t * spd + aSeed.x);
        vec3 p;
        if (uDisc > 0.5) {
          float a = aSeed.y * 6.2831853; float r = sqrt(aSeed.z);
          p = uOrigin + vec3(cos(a) * r * uSpread.x, 0.0, sin(a) * r * uSpread.z);
        } else {
          p = uOrigin + (vec3(aSeed.y, fract(aSeed.z * 7.13), aSeed.z) - 0.5) * uSpread;
        }
        float ph = aSeed.w * 6.2831853;
        p.y += life * uHeight;
        p += uWind * life * uHeight;
        p.x += sin(t * 1.1 + ph + life * 5.0) * uSway * life;
        p.z += cos(t * 0.9 + ph * 1.7 + life * 4.0) * uSway * life;
        return p;
      }
      void main() {
        float life, life1;
        vec3 p = at(uTime, life);
        vec3 p1 = at(uTime - 0.14, life1);
        vLife = life;
        float ph = aSeed.w * 6.2831853;
        vFlick = 0.6 + 0.4 * sin(uTime * (6.0 + aSeed.y * 9.0) + ph * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p1, 1.0);
        // size variance: a few big lazy sparks among many fine ones
        float s = uSize * mix(0.5 + aSeed.y, mix(0.35, 1.7, aSeed.y * aSeed.y), uStreak) * (1.0 - life * 0.55);
        float ps = clamp(s * uPx * 300.0 / -mv.z, 1.0, 48.0);
        // motion streak: elongate the sprite along its screen-space velocity
        vec2 dpx = (gl_Position.xy / gl_Position.w - c1.xy / c1.w) * 0.5 * uRes;
        float len = (life1 < life) ? length(dpx) * uStreak : 0.0;
        vStretch = clamp(len / max(ps, 1.0), 0.0, 1.0);
        vDir = len > 1e-3 ? normalize(vec2(dpx.x, -dpx.y)) : vec2(1.0, 0.0);
        gl_PointSize = min(64.0, ps * (1.0 + vStretch * 1.2));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColA, uColB; uniform float uIntensity;
      varying float vLife; varying float vFlick; varying vec2 vDir; varying float vStretch;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        vec2 q = vec2(dot(d, vDir), dot(d, vec2(-vDir.y, vDir.x)));
        float across = max(0.28, 1.0 - 0.72 * vStretch);
        float r = length(vec2(q.x, q.y / across)) * 2.0;
        float core = exp(-r * r * 9.0) + exp(-r * r * 2.2) * 0.35;
        float fade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
        vec3 c = mix(uColA, uColB, smoothstep(0.0, 0.8, vLife));
        gl_FragColor = vec4(c * core * fade * vFlick * uIntensity * (1.0 + vStretch * 0.4), 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return {
    points,
    material: mat,
    update(t, px = 1) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uPx.value = px;
      if (typeof window !== 'undefined') mat.uniforms.uRes.value.set(window.innerWidth * px, window.innerHeight * px);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
