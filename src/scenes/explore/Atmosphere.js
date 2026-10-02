import * as THREE from 'three';
import { hash } from './GeoBuilder.js';
import { CELL_SIZE } from './BlockBuilder.js';
import { CELL } from '../../data/maps/MapGrid.js';

const S = CELL_SIZE;

/**
 * Crepuscular rays: soft additive light ribbons along the sun direction,
 * placed on the boundaries between sunlit and shadowed ground (found by
 * marching the block's occluder height field toward the sun), so beams appear
 * to stream past eaves, gables and broken walls. Camera-facing around their
 * axis; brighter when looking toward the sun (forward scattering).
 * Static geometry; animation (slow drifting motes) uses uTime only.
 * @param {any} map @param {any} block buildBlock() result (needs heightAt)
 * @param {{sunDir: THREE.Vector3, color: number|THREE.Color, strength: number, time: {value: number}}} o
 */
export function buildSunShafts(map, block, o) {
  const sun = o.sunDir.clone().normalize();
  if (sun.y < 0.05 || !block.heightAt) return null;
  const flat = new THREE.Vector2(sun.x, sun.z);
  const fl = flat.length();
  if (fl < 1e-3) return null;
  flat.divideScalar(fl);
  const tanE = sun.y / fl;
  const perp = new THREE.Vector2(-flat.y, flat.x);
  const maxH = 14;
  const lit = (x, z) => {
    for (let t = 0.3; t < 60; t += 0.25) {
      const y = t * tanE;
      if (y > maxH) return true;
      if (block.heightAt(x + flat.x * t, z + flat.y * t) > y) return false;
    }
    return true;
  };
  const cands = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const cell = map.getCell(x, y);
      if (cell === CELL.INTERIOR || cell === CELL.WATER) continue;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const px = x * S + (i + 0.5) * (S / 4);
          const pz = y * S + (j + 0.5) * (S / 4);
          if (!lit(px, pz)) continue;
          const a = lit(px + perp.x * 0.6, pz + perp.y * 0.6);
          const b = lit(px - perp.x * 0.6, pz - perp.y * 0.6);
          if (a && b) continue;
          // the beam lies on the lit side of the boundary
          const side = a ? 1 : -1;
          cands.push({ x: px, z: pz, side, k: hash(map.id, x, y, i, j, 'shaft') });
        }
      }
    }
  }
  cands.sort((p, q) => p.k - q.k);
  const chosen = [];
  for (const c of cands) {
    if (chosen.length >= 40) break;
    if (chosen.some((d) => Math.hypot(d.x - c.x, d.z - c.z) < 1.6)) continue;
    chosen.push(c);
  }
  if (!chosen.length) return null;
  const pos = [];
  const axis = [];
  const side = [];
  const uv = [];
  const seed = [];
  // height of the occluder whose edge forms the gap: the shaft is only visible below it (above
  // the eaves the whole air is sunlit and there is no light/shadow contrast to read as a beam)
  const edgeTop = (x, z) => {
    let top = 0;
    for (let t = 0.3; t < 40; t += 0.3) {
      const y = t * tanE;
      if (y > maxH) break;
      top = Math.max(top, Math.min(block.heightAt(x + flat.x * t, z + flat.y * t), y + 0.01) > y ? y : 0);
    }
    return top;
  };
  for (const c of chosen) {
    const sh = edgeTop(c.x - c.side * perp.x * 0.6, c.z - c.side * perp.y * 0.6);
    const hTop = THREE.MathUtils.clamp(sh || 6, 2.5, maxH);
    const len = hTop / sun.y;
    // a sheaf of broken strands (light leaking through ragged roof edges), not one solid wedge
    const n = 3 + Math.floor(c.k * 3);
    for (let s2 = 0; s2 < n; s2++) {
      const r1 = hash(c.x, c.z, s2, 'sw');
      const r2 = hash(c.x, c.z, s2, 'so');
      const w = 0.18 + r1 * 0.55;
      const off = c.side * (0.2 + r2 * 2.6);
      const p0 = new THREE.Vector3(c.x + perp.x * off, 0.02, c.z + perp.y * off);
      const p1 = p0.clone().addScaledVector(sun, len);
      const quad = [[p0, -1, 0], [p0, 1, 0], [p1, 1, 1], [p0, -1, 0], [p1, 1, 1], [p1, -1, 1]];
      for (const [p, sd, v] of quad) {
        pos.push(p.x, p.y, p.z);
        axis.push(sun.x, sun.y, sun.z);
        side.push(sd * w * 0.5);
        uv.push(sd * 0.5 + 0.5, v);
        seed.push(c.k * 97.0 + s2 * 13.7 + r1 * 5.0);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aAxis', new THREE.Float32BufferAttribute(axis, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(o.color) }, uStrength: { value: o.strength }, uSun: { value: sun }, uTime: o.time },
    vertexShader: /* glsl */ `
      attribute vec3 aAxis; attribute float aSide; attribute float aSeed;
      varying vec2 vUv; varying float vSeed; varying vec3 vW;
      void main(){
        vUv = uv; vSeed = aSeed;
        vec3 toCam = normalize(cameraPosition - position);
        vec3 sideV = normalize(cross(aAxis, toCam));
        vec3 wp = position + sideV * aSide;
        vW = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; uniform vec3 uSun; uniform float uTime;
      varying vec2 vUv; varying float vSeed; varying vec3 vW;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      float n1(float x){ float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
      void main(){
        float xc = (clamp(vUv.x, 0.0, 1.0) - 0.5) * 2.0;
        float across = exp(-xc * xc * 3.0) * (1.0 - xc * xc);
        // born at the gap (soft start just below the eave), dissolving into the haze toward the ground
        float along = smoothstep(1.0, 0.86, vUv.y) * (0.25 + 0.75 * smoothstep(0.0, 0.55, vUv.y));
        // broken along its length: occluding tiles, laundry, a chimney — gaps and flares
        float brk = smoothstep(0.25, 0.7, n1(vUv.y * 9.0 + vSeed * 3.1)) * 0.75 + 0.25;
        float dens = 0.6 + 0.4 * n1(vUv.y * 23.0 - uTime * 0.04 + vSeed);
        vec3 V = normalize(vW - cameraPosition);
        float phase = 0.3 + 0.8 * pow(max(dot(V, uSun), 0.0), 6.0);
        float d = length(vW - cameraPosition);
        float nearFade = smoothstep(2.5, 9.0, d) * (1.0 - smoothstep(30.0, 55.0, d));
        float a = across * along * brk * dens * phase * nearFade * uStrength * (0.45 + 0.55 * h1(vSeed));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  return mesh;
}
