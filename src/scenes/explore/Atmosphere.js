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
    if (chosen.length >= 26) break;
    if (chosen.some((d) => Math.hypot(d.x - c.x, d.z - c.z) < 2.6)) continue;
    chosen.push(c);
  }
  if (!chosen.length) return null;
  const pos = [];
  const axis = [];
  const side = [];
  const uv = [];
  const seed = [];
  for (const c of chosen) {
    // broad, soft shafts (a thin ribbon reads as a lens streak, not as light in air)
    const w = 1.6 + c.k * 2.6;
    const len = (maxH * 0.7) / sun.y;
    const off = c.side * w * 0.5;
    const p0 = new THREE.Vector3(c.x + perp.x * off, 0.05, c.z + perp.y * off);
    const p1 = p0.clone().addScaledVector(sun, len);
    const quad = [[p0, -1, 0], [p0, 1, 0], [p1, 1, 1], [p0, -1, 0], [p1, 1, 1], [p1, -1, 1]];
    for (const [p, sd, v] of quad) {
      pos.push(p.x, p.y, p.z);
      axis.push(sun.x, sun.y, sun.z);
      side.push(sd * w * 0.5);
      uv.push(sd * 0.5 + 0.5, v);
      seed.push(c.k * 97.0);
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
      void main(){
        float xc = (clamp(vUv.x, 0.0, 1.0) - 0.5) * 2.0;
        float across = exp(-xc * xc * 3.2) * (1.0 - xc * xc);
        float along = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
        float streak = 0.8 + 0.2 * sin(vUv.x * 7.0 + vSeed) * sin(vUv.x * 13.0 + vSeed * 1.7);
        // density modulation along the shaft (drifting dust and mist)
        float dens = 0.55 + 0.45 * sin(vUv.y * 11.0 + vSeed * 2.3 + uTime * 0.05) * sin(vUv.y * 4.3 + vSeed);
        float motes = 0.85 + 0.15 * sin(vW.x * 3.0 + vW.y * 2.0 + uTime * 0.3 + vSeed);
        vec3 V = normalize(vW - cameraPosition);
        float phase = 0.3 + 1.6 * pow(max(dot(V, uSun), 0.0), 4.0);
        float d = length(vW - cameraPosition);
        float nearFade = smoothstep(3.0, 11.0, d);
        float a = across * along * streak * dens * motes * phase * nearFade * uStrength;
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
