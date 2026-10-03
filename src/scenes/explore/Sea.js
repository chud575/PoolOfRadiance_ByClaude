import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { FLAME_UNIFORMS } from '../../render/lighting.js';

/**
 * The harbour sea: a planar reflector (half-resolution mirror render of the scene: hulls, sails,
 * quays, the sky) shaded as water — the mirror image broken up by two scrolling wave normal
 * fields, a Fresnel blend toward the deep water colour when looking down, a sun glitter path
 * (high-power specular on the wave normal, faded with distance so it never aliases into stripes)
 * and exponential fog. Where the mirror render shows nothing (cleared texels) the analytic sky
 * gradient stands in.
 * @param {{normalMap: THREE.Texture, size: number[], deep: THREE.Color, sunDir: THREE.Vector3,
 *   sunColor: THREE.Color, skyTop: THREE.Color, skyHor: THREE.Color, fogColor: THREE.Color, fogDensity: number, night: number}} o
 */
export function createSea(o) {
  const geo = new THREE.PlaneGeometry(o.size[0], o.size[1]);
  const w = Math.max(256, Math.round((typeof window !== 'undefined' ? window.innerWidth : 1600) * 0.5));
  const h = Math.max(144, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.5));
  const shader = {
    name: 'SeaReflector',
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      tNormal: { value: o.normalMap },
      uTime: FLAME_UNIFORMS.uTime,
      uDeep: { value: o.deep.clone() },
      uSunDir: { value: o.sunDir.clone().normalize() },
      uSunCol: { value: o.sunColor.clone() },
      uSkyTop: { value: o.skyTop.clone() },
      uSkyHor: { value: o.skyHor.clone() },
      uFogColor: { value: o.fogColor.clone() },
      uFogDensity: { value: o.fogDensity },
      uNight: { value: o.night },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUvR;
      varying vec3 vWp;
      void main(){
        vUvR = textureMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform float uTime;
      uniform vec3 uDeep, uSunDir, uSunCol, uSkyTop, uSkyHor, uFogColor; uniform float uFogDensity, uNight;
      varying vec4 vUvR; varying vec3 vWp;
      void main(){
        vec2 p = vWp.xz;
        vec3 n1 = texture2D(tNormal, p * 0.11 + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, p * 0.037 - vec2(uTime * 0.005, -uTime * 0.009)).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(tNormal, p * 0.4 + vec2(-uTime * 0.02, uTime * 0.016)).xyz * 2.0 - 1.0;
        vec2 slope = n1.xy * 0.5 + n2.xy * 0.7 + n3.xy * 0.25;
        float dist = length(vWp - cameraPosition);
        // waves flatten with distance (sub-pixel ripples average out instead of shimmering)
        float fade = 1.0 / (1.0 + dist * 0.012);
        // close to the quay the chop is resolved: steeper, finer ripples break the mirror up
        float near = 1.0 - smoothstep(3.0, 22.0, dist);
        vec3 n4 = texture2D(tNormal, p * 1.3 + vec2(uTime * 0.05, -uTime * 0.035)).xyz * 2.0 - 1.0;
        slope += n4.xy * 0.45 * near;
        vec3 N = normalize(vec3(slope.x * (0.3 * fade + 0.4 * near), 1.0, slope.y * (0.3 * fade + 0.4 * near)));
        vec3 I = normalize(vWp - cameraPosition);
        // mirror image, displaced by the wave slope (more up close, where waves are larger on screen)
        vec4 uvr = vUvR;
        // broken reflections: the swell tears the mirror image into vertical shards (screen-y
        // displacement dominates), and the image softens with distance (micro-facets average out)
        uvr.x += slope.x * (fade * 0.14 + near * 0.08) * uvr.w;
        uvr.y += (slope.y * (fade * 0.3 + near * 0.1) + abs(slope.x) * 0.04 * fade) * uvr.w;
        float blur = (0.002 + min(dist, 150.0) * 0.00008) * uvr.w;
        vec3 refl = texture2DProj(tDiffuse, uvr).rgb * 0.4;
        refl += texture2DProj(tDiffuse, uvr + vec4(blur, blur * 2.5, 0.0, 0.0)).rgb * 0.15;
        refl += texture2DProj(tDiffuse, uvr + vec4(-blur, -blur * 2.5, 0.0, 0.0)).rgb * 0.15;
        refl += texture2DProj(tDiffuse, uvr + vec4(blur * 0.6, -blur * 4.0, 0.0, 0.0)).rgb * 0.15;
        refl += texture2DProj(tDiffuse, uvr + vec4(-blur * 0.6, blur * 4.0, 0.0, 0.0)).rgb * 0.15;
        // analytic sky where the mirror render is empty
        vec3 R = reflect(I, N);
        vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.45));
        float empty = 1.0 - smoothstep(0.004, 0.02, dot(refl, vec3(0.33)));
        refl = mix(refl, sky, empty);
        float cosT = clamp(-I.y, 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        fres = clamp(fres * 0.85 + 0.04, 0.0, 0.8);
        // deep water: darker looking down, a little turbid green near the camera
        // wave faces tilted toward the viewer show the deep water, the backs the bright sky
        vec3 deep = uDeep * (0.75 + 0.25 * slope.x);
        fres = clamp(fres + slope.y * 0.12 * fade, 0.0, 0.85);
        vec3 col = mix(deep, refl, fres);
        // foam-white crests where the waves fold (sparse, near)
        float crest = smoothstep(0.82, 1.0, n1.z * 0.5 + 0.5 - length(slope) * 0.25) * 0.0;
        col += crest;
        // sun glitter path: sharp facets toward a low sun
        float sd = max(dot(R, normalize(uSunDir)), 0.0);
        float glit = pow(sd, 900.0) * 18.0 + pow(sd, 90.0) * 1.2 + pow(sd, 12.0) * 0.08;
        col += uSunCol * glit * (1.0 - uNight) * (0.4 + 0.6 * fade);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, 1.0);
      }`,
  };
  const sea = new Reflector(geo, { textureWidth: w, textureHeight: h, clipBias: 0.003, shader, multisample: 0, color: 0xffffff });
  sea.rotation.x = -Math.PI / 2;
  sea.renderOrder = 6;
  return sea;
}
