import * as THREE from 'three';
import { getFxNoiseTexture } from '../../render/materials.js';

/**
 * Wet-street lamp reflections (night). Each lamp/torch gets a patch of ground (following the
 * street crown) whose shader reflects the view ray off rain-wet setts — the normal jittered by
 * world-space ripple noise — and lights the pixel where that ray points back at the flame. At
 * grazing angles the highlight stretches toward the viewer into the long broken streaks of a
 * wet night street; puddles (same noise as the SurfaceFX puddles) give sharp mirror glints,
 * the damp stone between them a soft smear. Additive, no depth write, one draw call.
 * @param {{pos: THREE.Vector3, lightColor?: number, kind: string}[]} sources lit lamps/torches
 * @param {(x: number, z: number) => number} heightAt ground height (street crown)
 * @param {{night: number, fogColor: THREE.Color, fogDensity: number, isGround?: (x:number,z:number)=>boolean}} o
 */
export function buildWetReflections(sources, heightAt, o) {
  const pos = [];
  const lamp = [];
  const col = [];
  const idx = [];
  const R = 4.2;
  const N = 10;
  for (const s of sources) {
    const c = new THREE.Color(s.lightColor ?? (s.kind === 'lamp' ? 0xffb56a : 0xff9a48));
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = s.pos.x - R + (2 * R * i) / N;
        const z = s.pos.z - R + (2 * R * j) / N;
        const ok = !o.isGround || o.isGround(x, z);
        pos.push(x, (ok ? heightAt(x, z) : -5) + 0.008, z);
        lamp.push(s.pos.x, s.pos.y, s.pos.z);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aLamp', new THREE.Float32BufferAttribute(lamp, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: getFxNoiseTexture() },
      uGain: { value: 1.6 * o.night },
      uFogColor: { value: o.fogColor.clone() },
      uFogDensity: { value: o.fogDensity },
      uR: { value: R },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aLamp; attribute vec3 aCol;
      varying vec3 vWp; varying vec3 vLamp; varying vec3 vCol;
      void main(){
        vWp = position; vLamp = aLamp; vCol = aCol;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise; uniform float uGain; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uR;
      varying vec3 vWp; varying vec3 vLamp; varying vec3 vCol;
      void main(){
        vec2 p = vWp.xz;
        vec4 nz = texture2D(uNoise, p * (1.0 / 24.0));
        // puddles: same field as the SurfaceFX standing water (mirror), damp stone elsewhere (smear)
        float pudF = nz.r * 0.7 + nz.a * 0.3 + (nz.g - 0.5) * 0.08;
        float pud = smoothstep(0.64, 0.7, pudF);
        // the puddles are a calm, slightly dirty sheet (soft mirror with a long grazing streak);
        // the damp stone between them only carries a broad, dim smear — no glittering speckle
        vec2 j2 = texture2D(uNoise, p * 0.9 + 0.31).gb - 0.5;
        vec2 jit = mix(j2 * 0.05, j2 * 0.012, pud);
        vec3 n = normalize(vec3(jit.x, 1.0, jit.y));
        vec3 I = normalize(vWp - cameraPosition);
        vec3 Rr = reflect(I, n);
        vec3 L = normalize(vLamp - vWp);
        float c = max(dot(Rr, L), 0.0);
        float spec = mix(pow(c, 24.0) * 0.22, pow(c, 700.0) * 5.0 + pow(c, 90.0) * 0.9, pud);
        // Fresnel: wet stone reflects most at grazing angles
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(-I.y, 0.0, 1.0), 5.0);
        float edge = 1.0 - smoothstep(uR * 0.6, uR * 0.98, max(abs(vWp.x - vLamp.x), abs(vWp.z - vLamp.z)));
        float wet = 0.25 + 0.75 * pud;
        vec3 col = vCol * spec * fres * wet * edge * uGain;
        float fd = length(vWp - cameraPosition);
        float fog = exp(-uFogDensity * uFogDensity * fd * fd);
        gl_FragColor = vec4(col * fog, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  return mesh;
}
