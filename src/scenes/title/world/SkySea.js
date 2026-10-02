import * as THREE from 'three';
import { DUSK_SKY } from './glsl.js';

/** Shared world uniforms (time + sun) for the title world shaders. */
export function createWorldUniforms(sunDir) {
  return {
    uTime: { value: 0 },
    uSunDir: { value: sunDir.clone().normalize() },
    uClassic: { value: 0 },
  };
}

/**
 * Dusk sky dome: set sun on the Moonsea, lit cloud streaks, first stars,
 * crepuscular rays. Follows the camera (call update(camera)).
 */
export function createSky(U, { radius = 900, cloud = 1 } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { ...U, uCloud: { value: cloud } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCloud, uClassic; uniform vec3 uSunDir; varying vec3 vDir;
      ${DUSK_SKY}
      void main() {
        vec3 d = normalize(vDir);
        if (uClassic > 0.5) {
          // 1988: a black night sky with a field of white stars and one band of
          // EGA blue on the horizon (a narrow ramp, so the post dithers only there)
          vec3 k = mix(vec3(0.0, 0.0, 0.42), vec3(0.0), smoothstep(0.03, 0.06, d.y));
          float st = step(0.9972, hash13(floor(d * 380.0))) * step(0.07, d.y);
          k = mix(k, vec3(1.4), st);
          if (d.y < 0.0) k = vec3(0.0);
          gl_FragColor = vec4(k, 1.0);
          return;
        }
        vec3 c = duskSky(d, uSunDir, uTime, uCloud);
        // crepuscular rays fanning up from the set sun
        vec3 sd = uSunDir;
        vec3 rel = d - sd * dot(d, sd);
        float ang = atan(rel.y, dot(rel, normalize(cross(sd, vec3(0.0, 1.0, 0.0)))));
        float dist = acos(clamp(dot(d, sd), -1.0, 1.0));
        float rays = vnoise(vec2(ang * 22.0, uTime * 0.05)) * vnoise(vec2(ang * 57.0 + 3.0, uTime * 0.03));
        float fan = smoothstep(0.1, 0.9, rays) * exp(-dist * 2.4) * step(0.0, d.y) * smoothstep(0.0, 0.06, d.y);
        c += vec3(1.0, 0.5, 0.26) * fan * 0.28;
        // below the horizon (hidden by the sea, but keep it coherent)
        if (d.y < 0.0) c = mix(c, vec3(0.05, 0.03, 0.06), smoothstep(0.0, -0.05, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.userData.update = (camera) => mesh.position.copy(camera.position);
  return mesh;
}

/**
 * The Moonsea: reflects the dusk sky with a sun glitter path; wind ripples.
 * A large plane at `level`, starting at `nearZ` and running to the horizon.
 */
export function createSea(U, { level = -15, nearZ = -150, width = 6000, depth = 5000 } = {}) {
  const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, level, nearZ - depth / 2);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { ...U },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uClassic; uniform vec3 uSunDir; varying vec3 vWorld;
      ${DUSK_SKY}
      // long readable swells rolling in from the open Moonsea, a chop on top, and a
      // fine ripple that fades out with distance (so far water never turns to speckle)
      float uLod;
      vec2 gWarp; float gPatch; // computed once per pixel (not per wave sample)
      float waves(vec2 p) {
        float t = uTime;
        // domain-warped swells whose height wanders in broad patches (wind
        // slicks and calmer lanes), so the pattern never repeats across the bay
        vec2 wp = p + gWarp;
        float patchA = gPatch;
        float swell = (sin(wp.x * 0.045 + wp.y * 0.11 + t * 0.55) * 0.55 + sin(wp.x * -0.028 + wp.y * 0.075 - t * 0.4) * 0.4) * patchA;
        float chop = fbm3(p * vec2(0.08, 0.22) + vec2(t * 0.05, t * 0.02));
        float fine = vnoise(p * vec2(0.35, 0.9) - vec2(t * 0.12, 0.0));
        return swell * 0.55 + chop * 0.45 + fine * 0.3 * uLod;
      }
      void main() {
        vec3 v = normalize(vWorld - cameraPosition);
        float dist = length(vWorld.xz - cameraPosition.xz);
        vec2 p = vWorld.xz;
        uLod = 1.0 - smoothstep(50.0, 240.0, dist);
        gWarp = vec2(vnoise(p * 0.006 + 3.0), vnoise(p * 0.006 + 9.0)) * 70.0;
        gPatch = 0.45 + 0.8 * vnoise(p * 0.0045 + vec2(uTime * 0.004, 0.0));
        float e = 0.6 + dist * 0.004;
        float h0 = waves(p);
        float hx = waves(p + vec2(e, 0.0));
        float hz = waves(p + vec2(0.0, e));
        float amp = 0.55 / (1.0 + dist * 0.006);
        vec3 n = normalize(vec3((h0 - hx) * amp * 3.0, 1.0, (h0 - hz) * amp * 3.0));
        vec3 r = reflect(v, n);
        r.y = abs(r.y) + 0.004;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
        vec3 sky = duskSky(normalize(r), uSunDir, uTime, 0.6);
        vec3 deep = vec3(0.012, 0.02, 0.045);
        vec3 c = mix(deep, sky, clamp(fres * 1.15, 0.0, 1.0));
        // sun glitter path
        float g = pow(max(dot(normalize(r), uSunDir), 0.0), 900.0);
        float spark = step(0.55, vnoise(p * vec2(1.4, 3.5) + uTime * vec2(0.6, 0.2)));
        c += vec3(9.0, 5.0, 2.2) * g * (0.35 + spark * 1.4);
        c += vec3(1.2, 0.55, 0.25) * pow(max(dot(normalize(r), uSunDir), 0.0), 60.0) * 0.35;
        // haze toward the horizon
        vec3 hor = duskSky(normalize(vec3(v.x, 0.001, v.z)), uSunDir, uTime, 0.0);
        c = mix(c, hor, smoothstep(300.0, 2400.0, dist) * 0.9);
        // aerial perspective over the water: a mauve haze that thickens toward
        // the horizon (sun side warmer), so the sea never meets the sky as a hard line
        float hzK = smoothstep(90.0, 900.0, dist);
        vec3 hazeC = mix(vec3(0.16, 0.1, 0.2), vec3(0.42, 0.2, 0.18), pow(max(dot(normalize(v.xz), normalize(uSunDir.xz)), 0.0), 3.0));
        c = mix(c, mix(hor, hazeC, 0.45), hzK * 0.45 * (1.0 - uClassic));
        if (uClassic > 0.5) {
          // flat EGA water: dark blue with light-blue swell streaks
          float sw = step(0.78, vnoise(p * vec2(0.05, 0.35) + vec2(uTime * 0.05, 0.0))) * (1.0 - smoothstep(150.0, 700.0, dist));
          c = mix(vec3(0.0, 0.0, 0.4), vec3(0.45, 0.45, 1.4), sw);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return mesh;
}
