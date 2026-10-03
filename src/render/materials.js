import * as THREE from 'three';
import { getTextureSet, preloadTextureSets, getWindowTexture, TEXTURE_DEFS } from './textures/index.js';
import { fbm, valueNoise } from './textures/noise.js';

/**
 * Material library. getMaterial(key) returns a shared (cached) material —
 * never mutate the returned instance; clone() it if you need a variant.
 *
 * Keys prefixed `arch_` / `prop_` are the explore-renderer's world-scaled
 * PBR materials: their textures tile every `texScale` metres (geometry must
 * provide UVs in metres / texScale — see materialTexScale()) and they carry
 * the SurfaceFX shader patch (world-space macro variation, ground grime,
 * moss on upward faces, height fog with sun in-scattering).
 */
const DEFS = {
  // ---- foundation v0.1 keys (shared by combat/camp/title/create) ----
  wall_stone: { tex: 'wall_stone', roughness: 1, color: 0xffffff },
  wall_timber: { tex: 'wall_timber', roughness: 1, color: 0xffffff },
  wall_ruin: { tex: 'wall_ruin', roughness: 1, color: 0xffffff },
  floor_cobble: { tex: 'floor_cobble', roughness: 1, color: 0xffffff },
  floor_flag: { tex: 'floor_flag', roughness: 1, color: 0xffffff },
  floor_wood: { tex: 'floor_wood', roughness: 1, color: 0xffffff },
  floor_rubble: { tex: 'floor_rubble', roughness: 1, color: 0xffffff },
  door_wood: { tex: 'door_wood', roughness: 1, color: 0xffffff },
  ceiling_wood: { tex: 'ceiling_wood', roughness: 1, color: 0xbbbbbb },
  iron: { color: 0x3a3a40, roughness: 0.45, metalness: 0.9 },
  gilt: { color: 0xd8b25a, roughness: 0.3, metalness: 1 },
  water_dark: { color: 0x0a1a24, roughness: 0.05, metalness: 0.2 },

  // ---- explore architecture (vertex AO colours required) ----
  arch_stone: { tex: 'hd2_ashlar', texScale: 3, vc: true, fx: { macro: 0.32, grime: 0.55, moss: 0.35, streak: 0.55, vary: 1, patch: 1 } },
  arch_stone_cold: { tex: 'hd2_ashlar_cold', texScale: 3, vc: true, fx: { macro: 0.3, grime: 0.6, moss: 0.5, vary: 1, patch: 1 } },
  arch_trim: { tex: 'hd2_quoin', texScale: 1.5, vc: true, color: 0xd8d0c4, fx: { macro: 0.2, grime: 0.4, moss: 0.5 } },
  arch_dressed: { tex: 'hd2_dressed', texScale: 1.5, vc: true, color: 0xe6ded2, fx: { macro: 0.2, grime: 0.45, moss: 0.4 } },
  arch_ruin: { tex: 'hd2_ruin', texScale: 3, vc: true, fx: { macro: 0.35, grime: 0.7, moss: 0.9, vary: 0.8, patch: 1 } },
  arch_plaster: { tex: 'hd2_plaster', texScale: 3.7, vc: true, fx: { macro: 0.5, grime: 0.85, moss: 0.15, streak: 0.3, patch: 1.1 } },
  arch_plaster_int: { tex: 'hd2_plaster_int', texScale: 3, vc: true, fx: { macro: 0.32, grime: 0.6, streak: 0.25, soot: 1, patch: 0.9 } },
  arch_beam: { tex: 'hd_beam', texScale: 1.2, vc: true, fx: { macro: 0.18, grime: 0.2, moss: 0.2 } },
  arch_beam_dark: { tex: 'hd_beam_dark', texScale: 1.2, vc: true, fx: { macro: 0.12 } },
  arch_roof_slate: { tex: 'hd_roof_slate', texScale: 2, vc: true, fx: { macro: 0.3, moss: 0.25 } },
  arch_roof_clay: { tex: 'hd_roof_clay', texScale: 2, vc: true, fx: { macro: 0.3, moss: 0.2 } },
  arch_roof_shake: { tex: 'hd_roof_shake', texScale: 2, vc: true, fx: { macro: 0.3, moss: 0.3 } },
  arch_cobble: { tex: 'hd4_setts', texScale: 2, vc: true, fx: { macro: 0.4, floor: 1 } },
  arch_flags: { tex: 'hd3_flags', texScale: 2.8, vc: true, fx: { macro: 0.36, floor: 1 } },
  arch_mud: { tex: 'hd_mud', texScale: 3, vc: true, fx: { macro: 0.3, floor: 1 } },
  arch_boards: { tex: 'hd_boards', texScale: 2, vc: true, fx: { macro: 0.15, floor: 1 } },
  arch_ceiling: { tex: 'hd2_ceiling', texScale: 3, vc: true, color: 0xffffff, fx: { macro: 0.1 } },
  arch_dungeon: { tex: 'hd2_dungeon', texScale: 3, vc: true, fx: { macro: 0.34, grime: 0.6, moss: 0.4, streak: 1, vary: 1, patch: 1 } },
  arch_dungeon_floor: { tex: 'hd3_dungeon_floor', texScale: 3, vc: true, fx: { macro: 0.3, floor: 1 } },
  arch_hewn: { tex: 'hd2_hewn', texScale: 3, vc: true, fx: { macro: 0.2, grime: 0.5, moss: 0.5, rock: 1 } },
  arch_hewn_ceil: { tex: 'hd2_hewn_ceil', texScale: 3, vc: true, roughness: 1, fx: { macro: 0.2, rock: 1 } },
  arch_cave_floor: { tex: 'hd2_cave_floor', texScale: 3, vc: true, fx: { macro: 0.35, floor: 1 } },
  arch_basalt: { tex: 'hd2_basalt', texScale: 2.2, vc: true, fx: { macro: 0.22, grime: 0.3, streak: 0.8, patch: 0.6 } },
  // vault webs/ribs: one even, matte, smoke-dark albedo (no per-stone gloss → no checkerboard of lit tiles)
  arch_basalt_vault: { tex: 'hd2_basalt', texScale: 2.2, vc: true, rough: false, roughness: 0.95, color: 0xb8b8bc, fx: { macro: 0.28, patch: 0.5 } },
  arch_basalt_floor: { tex: 'hd2_basalt_floor', texScale: 3, vc: true, fx: { macro: 0.2, floor: 1 } },
  arch_relief: { tex: 'hd2_relief', texScale: 0, vc: true, fx: { macro: 0.1 } },
  arch_brick: { tex: 'hd_brick', texScale: 1, vc: true, fx: { macro: 0.3, grime: 0.5 } },
  arch_wainscot: { tex: 'hd_wainscot', texScale: 1.5, vc: true, fx: { macro: 0.1 } },
  arch_iron: { tex: 'hd2_iron', texScale: 0.5, vc: true, metalness: 0.7, fx: {} },
  arch_door: { tex: 'hd_door', texScale: 0, vc: false, fx: { macro: 0.1 } },
  arch_water: { color: 0x10202a, roughness: 0.04, metalness: 0.0, vc: true, fx: {} },

  // ---- props (instanced; no vertex colours) ----
  prop_staves: { tex: 'hd_staves', fx: { macro: 0.2 } },
  prop_crate: { tex: 'hd_crate', fx: { macro: 0.2 } },
  prop_iron: { tex: 'hd2_iron', metalness: 0.7, fx: {} },
  prop_burlap: { tex: 'hd_burlap', fx: { macro: 0.2 } },
  prop_rubble: { tex: 'hd_rock', fx: { macro: 0.35, moss: 0.5, dust: 0.45 } },
  prop_rock: { tex: 'hd_rock', vc: true, fx: { macro: 0.35, moss: 0.4, dust: 0.45 } },
  prop_wood: { tex: 'hd_beam', fx: { macro: 0.2 } },
  prop_stone: { tex: 'hd2_ashlar', fx: { macro: 0.25, moss: 0.5 } },
  prop_skin: { color: 0xc48a68, roughness: 0.62, vc: true, fx: {} },
  prop_cloth: { tex: 'hd_burlap', color: 0xffffff, vc: true, fx: { macro: 0.15 } },
  prop_bone: { tex: 'hd_limestone', color: 0xc2b292, fx: { dust: 0.5, grime: 0.5 } },
  prop_limestone: { tex: 'hd_limestone', texScale: 1.5, vc: true, fx: { macro: 0.3, grime: 0.8, moss: 0.8, dust: 0.6 } },
};

/** Texture sets each tileset needs (for preloading). */
export const MATERIAL_TEXTURES = Object.fromEntries(Object.entries(DEFS).filter(([, d]) => d.tex).map(([k, d]) => [k, d.tex]));

// ------------------------------------------------------------------ SurfaceFX
/** Uniforms shared by every FX material (updated by the lighting rig). */
export const SURFACE_UNIFORMS = {
  uFxSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2).normalize() },
  uFxSunColor: { value: new THREE.Color(0xffe0b0) },
  uFxScatter: { value: 0.0 },
  uFxHeightFog: { value: 0.0 }, // density of ground-hugging fog
  uFxHeightFalloff: { value: 0.35 },
  uFxGrimeTint: { value: new THREE.Color(0x2a2418) },
  uFxMossTint: { value: new THREE.Color(0x3c4a22) },
  uFxWet: { value: 0.0 },
  uFxSlick: { value: 0.0 }, // rain-slick paving (night): lower roughness on floors
  uFxNoiseTex: { value: null },
  // puddle reflections: sky gradient + the street walls that line it (set per scene)
  uFxReflZenith: { value: new THREE.Color(0x000000) },
  uFxReflHorizon: { value: new THREE.Color(0x000000) },
  uFxReflWall: { value: new THREE.Color(0x000000) },
};

const FX_NOISE = /* glsl */ `
  uniform sampler2D uFxNoiseTex;
  // one lookup, four noise octaves (R 6 m, A 3 m, G 1.5 m, B 0.4 m features); planar by normal
  vec4 fxN(vec3 wp, vec3 n){
    vec2 p = abs(n.y) > 0.6 ? wp.xz : vec2(wp.x + wp.z * 0.93, wp.y);
    return texture2D(uFxNoiseTex, p * (1.0 / 24.0));
  }
`;

let noiseTex = null;
/** 256² tileable RGBA noise used by the SurfaceFX patch. */
export function getFxNoiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const i = (y * N + x) * 4;
      d[i] = fbm(u * 4, v * 4, { octaves: 4, period: 4, seed: 301 }) * 255;
      d[i + 1] = fbm(u * 16, v * 16, { octaves: 3, period: 16, seed: 302 }) * 255;
      d[i + 2] = valueNoise(u * 64, v * 64, 64, 303) * 255;
      d[i + 3] = fbm(u * 8, v * 8, { octaves: 3, period: 8, seed: 304 }) * 255;
    }
  }
  noiseTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

function applySurfaceFX(mat, fx) {
  const macro = (fx.macro ?? 0).toFixed(3);
  const grime = (fx.grime ?? 0).toFixed(3);
  const moss = (fx.moss ?? 0).toFixed(3);
  const floor = (fx.floor ?? 0).toFixed(3);
  const dust = (fx.dust ?? 0).toFixed(3);
  const grain = (fx.grain ?? 0).toFixed(3);
  const streak = (fx.streak ?? 0).toFixed(3);
  const fogCap = (fx.fogCap ?? 1).toFixed(3);
  const soot = (fx.soot ?? 0).toFixed(3);
  const vary = (fx.vary ?? 0).toFixed(3);
  const patch = (fx.patch ?? 0).toFixed(3);
  const rock = (fx.rock ?? 0).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    if (!SURFACE_UNIFORMS.uFxNoiseTex.value) SURFACE_UNIFORMS.uFxNoiseTex.value = getFxNoiseTexture();
    Object.assign(shader.uniforms, SURFACE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFxWorldPos;\nvarying vec3 vFxWorldNormal;')
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        {
          vec4 fxWp = vec4(transformed, 1.0);
          vec3 fxN = objectNormal;
          #ifdef USE_INSTANCING
            fxWp = instanceMatrix * fxWp;
            fxN = mat3(instanceMatrix) * fxN;
          #endif
          fxWp = modelMatrix * fxWp;
          vFxWorldPos = fxWp.xyz;
          vFxWorldNormal = normalize(mat3(modelMatrix) * fxN);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFxWorldPos;
        varying vec3 vFxWorldNormal;
        uniform vec3 uFxSunDir; uniform vec3 uFxSunColor; uniform float uFxScatter;
        uniform float uFxHeightFog; uniform float uFxHeightFalloff;
        uniform vec3 uFxGrimeTint; uniform vec3 uFxMossTint; uniform float uFxWet; uniform float uFxSlick;
        uniform vec3 uFxReflZenith; uniform vec3 uFxReflHorizon; uniform vec3 uFxReflWall;
        float vFxWet = 0.0;
        float vFxFloor = 0.0;
        float vFxCav = 0.0;
        float vFxCrown = 0.0;
        vec3 vFxPlate = vec3(0.5);
        float vFxCrack = 0.0;
        float vFxSeep = 0.0;
        vec3 fxHash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
        float vFxPud = 0.0;
        ${FX_NOISE}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 wp = vFxWorldPos;
          float up = vFxWorldNormal.y;
          vec4 nz = fxN(wp, vFxWorldNormal);
          float mN = nz.r;
          diffuseColor.rgb *= 1.0 + (mN - 0.5) * ${macro} * 1.7 + (nz.b - 0.5) * ${macro} * 0.4;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 1.0, 0.88), (nz.a - 0.4) * ${macro} * 1.2);
          // ground grime + rising damp on vertical surfaces
          float vert = 1.0 - abs(up);
          float g = (1.0 - smoothstep(0.0, 1.1 + mN * 0.9, wp.y)) * vert * ${grime};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uFxGrimeTint * 2.2, g * 0.75);
          // contact dirt: a tight, darker band where anything meets the ground (splashed mud, wet
          // grit, a line of moss in the damp) — props and walls sit in the street, not on it
          float foot = (1.0 - smoothstep(0.02, 0.16 + nz.b * 0.16, wp.y)) * (0.4 + 0.6 * vert) * ${grime};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uFxGrimeTint * 1.7, foot * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFxMossTint * 0.8, foot * smoothstep(0.5, 0.62, nz.g) * 0.45 * ${moss});
          float dampMoss = (1.0 - smoothstep(0.0, 0.5 + mN * 0.7, wp.y)) * smoothstep(0.42, 0.62, nz.g) * vert;
          float topMoss = smoothstep(0.55, 0.9, up) * smoothstep(0.4, 0.62, nz.g) * step(0.3, wp.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFxMossTint * (0.7 + nz.b * 0.6), clamp((dampMoss * 0.8 + topMoss) * ${moss}, 0.0, 0.85));
          // dust settled on upward-facing surfaces of props
          float dustAmt = smoothstep(0.35, 0.85, up) * (0.55 + 0.45 * nz.g) * ${dust};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.46, 0.42, 0.36) * (0.85 + nz.b * 0.3), dustAmt * 0.6);
          #if ${streak === '0.000' ? 0 : 1}
          {
            // seepage streaks running down the masonry + a damp, darker base (world-space, never tiles)
            float sw = wp.x + wp.z;
            float sk = texture2D(uFxNoiseTex, vec2(sw * 0.31, wp.y * 0.018 + 0.37)).g * 0.65 + texture2D(uFxNoiseTex, vec2(sw * 0.9, wp.y * 0.05)).b * 0.35;
            float streaks = smoothstep(0.56, 0.78, sk) * vert * (0.6 + 0.4 * nz.a);
            float damp = (1.0 - smoothstep(0.0, 0.9 + mN * 0.8, wp.y)) * vert;
            diffuseColor.rgb *= 1.0 - (streaks * 0.32 + damp * 0.28) * ${streak};
            vFxWet = max(vFxWet, damp * 0.6 * ${streak});
          }
          #endif
          #if ${soot === '0.000' ? 0 : 1}
          {
            // lived-in plaster: smoke-browned toward the ceiling (patchy), a greasy band of wear at
            // shoulder height where backs and hands rub, and the odd hairline crack
            float sootK = smoothstep(1.9, 3.25, wp.y) * (0.55 + 0.45 * nz.a) * vert;
            diffuseColor.rgb *= 1.0 - sootK * 0.5 * ${soot};
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.8, 0.7), sootK * 0.6 * ${soot});
            float band = smoothstep(1.05, 1.3, wp.y) * (1.0 - smoothstep(1.5, 1.75, wp.y)) * smoothstep(0.35, 0.65, nz.g) * vert;
            diffuseColor.rgb *= 1.0 - band * 0.16 * ${soot};
            float cr = abs(texture2D(uFxNoiseTex, vec2((wp.x + wp.z) * 0.21, wp.y * 0.13)).g - 0.5);
            float crack = (1.0 - smoothstep(0.0, 0.012, cr)) * smoothstep(0.55, 0.7, nz.r) * vert;
            diffuseColor.rgb *= 1.0 - crack * 0.4 * ${soot};
          }
          #endif
          #if ${vary === '0.000' ? 0 : 1}
          #ifdef USE_ROUGHNESSMAP
          {
            // per-stone variation that never tiles: the texture carries a stone id (B), a decal
            // mask for its cracks/spalls (R) and height (A). Tone and decal visibility come from
            // world-space noise looked up at an id-dependent offset — the same stone repeated
            // 3 m along the wall gets a different tone and keeps or loses its scar.
            vec4 fxS = texture2D(roughnessMap, vRoughnessMapUv);
            float onStone = smoothstep(0.26, 0.36, fxS.a);
            vec2 sp2 = (abs(up) > 0.6 ? wp.xz : vec2(wp.x + wp.z * 0.93, wp.y)) * (1.0 / 24.0);
            float tA = texture2D(uFxNoiseTex, sp2 + fxS.b * vec2(7.31, 3.17)).a;
            float tB = texture2D(uFxNoiseTex, sp2 * 1.7 + fxS.b * vec2(2.71, 5.93)).g;
            float dF = (1.0 - smoothstep(16.0, 38.0, length(vViewPosition))) * onStone * ${vary};
            diffuseColor.rgb *= 1.0 + ((tA - 0.5) * 0.9 + (tB - 0.5) * 0.35) * dF;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), clamp((tB - 0.5) * 2.5, -1.0, 1.0) * dF);
            float gate = smoothstep(0.5, 0.58, texture2D(uFxNoiseTex, sp2 * 1.3 + fxS.b * vec2(4.13, 8.71)).a);
            diffuseColor.rgb *= 1.0 - fxS.r * gate * 1.3;
          }
          #endif
          #endif
          #if ${patch === '0.000' ? 0 : 1}
          {
            // large-scale value macro: soot/grime blooms and pale lime-leached areas a few metres
            // across, so a long wall reads as one aged surface rather than a tiled sheet
            float pA = smoothstep(0.52, 0.7, mN + (nz.g - 0.5) * 0.5);
            float pB = smoothstep(0.56, 0.7, nz.a + (nz.b - 0.5) * 0.25) * (1.0 - pA);
            diffuseColor.rgb *= 1.0 - pA * 0.3 * ${patch} * vert;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.13, 1.06) + vec3(0.015), pB * 0.55 * ${patch} * vert);
            // soot drifting down from the wall head
            float hiS = smoothstep(2.6, 5.5, wp.y) * smoothstep(0.45, 0.65, nz.a);
            diffuseColor.rgb *= 1.0 - hiS * 0.22 * ${patch} * vert;
          }
          #endif
          #if ${rock === '0.000' ? 0 : 1}
          {
            // fractured rock in world space (no UVs → no stretched bands): 3D Voronoi plates
            // elongated within tilted bedding planes, hairline cracks and wider seams between them,
            // thin strata partings, each plate its own tone and (below) its own facet tilt
            vec3 rp = wp * 0.72 + vec3(nz.b * 0.25, nz.r * 0.6, 0.0);
            vec3 bed = normalize(vec3(0.3, 1.0, 0.16));
            vec3 ip = floor(rp);
            vec3 fp = fract(rp);
            float f1 = 8.0;
            float f2 = 8.0;
            vec3 cid = vec3(0.0);
            for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec3 o = vec3(float(i), float(j), float(k));
              vec3 d = o + fxHash3(ip + o) - fp;
              d += bed * dot(d, bed) * 0.9; // plates flattened across the bedding
              float dd = dot(d, d);
              if (dd < f1) { f2 = f1; f1 = dd; cid = ip + o; } else if (dd < f2) f2 = dd;
            }
            float edge = sqrt(f2) - sqrt(f1);
            vec3 hc = fxHash3(cid + 17.0);
            // only some plate boundaries are open fractures; the rest are tight, barely-read joints
            float open = smoothstep(0.35, 0.6, hc.z + (nz.g - 0.5) * 0.6);
            float crack = (1.0 - smoothstep(0.0, 0.035 + 0.02 * open, edge)) * (0.25 + 0.75 * open);
            float seam = (1.0 - smoothstep(0.02, 0.28, edge)) * (0.4 + 0.6 * open);
            #ifdef USE_MAP
              // keep only the texture's fine grain: its broad cloudy banding is replaced by the plates
              vec3 tLow = texture2D(map, vMapUv, 5.0).rgb;
              vec3 tAvg = texture2D(map, vMapUv, 11.0).rgb;
              diffuseColor.rgb *= mix(vec3(1.0), tAvg / max(tLow, vec3(0.02)), ${rock});
            #endif
            diffuseColor.rgb *= 0.74 + hc.x * 0.5;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(1.08, 1.0, 0.86), (hc.y - 0.5) * 1.2);
            float sb = dot(wp, bed);
            float st = fract(sb * 2.6 + nz.g * 0.8);
            float parting = (1.0 - smoothstep(0.0, 0.05, st)) * smoothstep(0.42, 0.58, nz.a);
            diffuseColor.rgb *= 1.0 - crack * 0.5 - seam * 0.22 - parting * 0.28;
            // seeps: water running down from the partings, darkening and glossing the stone
            float sk = texture2D(uFxNoiseTex, vec2((wp.x + wp.z) * 0.42, wp.y * 0.035 + 0.2)).g;
            vFxSeep = smoothstep(0.58, 0.7, sk) * (1.0 - abs(up)) * smoothstep(0.3, 0.55, nz.r);
            diffuseColor.rgb *= 1.0 - vFxSeep * 0.35;
            vFxPlate = hc;
            vFxCrack = max(crack, seam * 0.5);
          }
          #endif
          float fl = ${floor};
          diffuseColor.rgb *= mix(1.0, 0.8 + nz.a * 0.4, fl);
          #ifdef USE_ROUGHNESSMAP
          if (fl > 0.0) {
            // cavity from the height channel vs. its blurred neighbourhood (a coarse mip): joints
            // and low spots hold the water, stone crowns stand dry
            float hC = texture2D(roughnessMap, vRoughnessMapUv).a;
            float hA = texture2D(roughnessMap, vRoughnessMapUv, 3.5).a;
            vFxCav = smoothstep(0.0, 0.07, hA - hC);
            vFxCrown = smoothstep(0.0, 0.05, hC - hA);
            float wj = vFxCav * clamp(uFxWet * 2.0, 0.0, 1.0) * (0.35 + 0.65 * uFxSlick);
            diffuseColor.rgb *= 1.0 - wj * 0.35;
          }
          #endif
          // standing water: broad, soft-edged pools in the low spots (metre-scale noise only — no
          // per-pixel speckle), a darker damp halo around each, the joints wet a little beyond
          float pudF = nz.r * 0.7 + nz.a * 0.3 + (nz.g - 0.5) * 0.08 + uFxSlick * 0.05;
          float wetAmt = clamp(uFxWet * 2.0, 0.0, 1.0) * fl;
          vFxPud = smoothstep(0.665, 0.705, pudF) * wetAmt;
          float halo = smoothstep(0.63, 0.67, pudF) * wetAmt;
          diffuseColor.rgb *= 1.0 - halo * 0.28 - vFxPud * 0.42;
          vFxFloor = fl;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (vFxPud > 0.0) {
          // the water surface is flat: it fills the joints and hides the stones' relief
          vec3 fxUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(mix(normal, fxUpV, smoothstep(0.4, 0.9, vFxPud)));
        }
        #if ${rock === '0.000' ? 0 : 1}
        {
          // each plate a facet at its own angle; the cracks fall back into shadow
          vec3 tilt = (vFxPlate - 0.5) * 1.4;
          vec3 nW = normalize(normalize(vFxWorldNormal) + tilt);
          vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          normal = normalize(mix(normal, nV, 0.8 * (1.0 - vFxCrack) * ${rock}));
        }
        #endif
        #if ${grain === '0.000' ? 0 : 1}
        {
          // close-up micro relief (≈1 cm grit) as a derivative bump in world space
          vec3 gp = vFxWorldPos * 0.9;
          vec2 gq = abs(vFxWorldNormal.y) > 0.6 ? gp.xz : vec2(gp.x + gp.z * 0.93, gp.y);
          float gh = texture2D(uFxNoiseTex, gq).b * 0.6 + texture2D(uFxNoiseTex, gq * 2.7 + 0.37).b * 0.4;
          // only up close: fade out before the grit drops below a few pixels (no shimmer at range)
          float gFade = (1.0 - smoothstep(1.2, 3.5, length(vViewPosition))) * smoothstep(0.25, 0.6, abs(dot(normal, normalize(vViewPosition))));
          vec2 dH = vec2(dFdx(gh), dFdy(gh)) * ${grain} * 0.35 * gFade;
          vec3 vSigmaX = dFdx(-vViewPosition);
          vec3 vSigmaY = dFdy(-vViewPosition);
          vec3 vN = normal;
          vec3 R1 = cross(vSigmaY, vN);
          vec3 R2 = cross(vN, vSigmaX);
          float fDet = dot(vSigmaX, R1);
          vec3 vGrad = sign(fDet) * (dH.x * R1 + dH.y * R2);
          normal = normalize(abs(fDet) * vN - vGrad);
        }
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          // paving: tops stay matte, water lies in the joints and in shallow puddles only
          // (never glossy where the normal map is busy: a low roughness on bumpy stone glitters)
          float wetK = clamp(uFxWet * 2.0, 0.0, 1.0);
          roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.5), vFxWet * wetK);
          // after rain the water sits in the joints and hollows (soft sheen), the crowns stay dry
          // and matte: no glossy high-frequency speckle on the stone faces
          roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.68), vFxFloor);
          roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.82), vFxCrown * vFxFloor);
          roughnessFactor = mix(roughnessFactor, 0.36, vFxCav * vFxFloor * wetK * (0.4 + 0.6 * uFxSlick));
          roughnessFactor = mix(roughnessFactor, 0.22, vFxSeep);
          // puddles: a near-flat sheet with a slightly soft (rippled, dirty) mirror
          roughnessFactor = mix(roughnessFactor, 0.28, smoothstep(0.4, 0.9, vFxPud));
        }`,
      )
      .replace(
        '#include <fog_fragment>',
        `if (vFxPud > 0.0) {
          // mirror of the sky and the street walls, Fresnel-weighted (grazing views reflect most)
          vec3 fxI = normalize(vFxWorldPos - cameraPosition);
          float cosT = clamp(-fxI.y, 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec3 fxR = reflect(fxI, vec3(0.0, 1.0, 0.0));
          // a ragged roofline (walls up to ~25-40 degrees) between the street and the sky
          float az = atan(fxR.z, fxR.x);
          // (smooth in azimuth: any step here prints hard screen-vertical edges into the pools)
          float roof = 0.24 + 0.18 * texture2D(uFxNoiseTex, vec2(az * 0.6, 0.31)).r;
          // the water is never a perfect mirror: ripples and silt blur the roofline
          float skyK = smoothstep(roof - 0.1, roof + 0.1, fxR.y);
          vec3 skyC = mix(uFxReflHorizon, uFxReflZenith, smoothstep(roof, 0.9, fxR.y));
          vec3 rc = mix(uFxReflWall * (0.75 + 0.5 * texture2D(uFxNoiseTex, vec2(az * 2.0, fxR.y)).g), skyC, skyK);
          gl_FragColor.rgb += rc * fres * smoothstep(0.4, 0.9, vFxPud);
        }
        #ifdef USE_FOG
        {
          vec3 fxV = vFxWorldPos - cameraPosition;
          float fxD = length(fxV);
          #ifdef FOG_EXP2
            float fxF = 1.0 - exp(-fogDensity * fogDensity * fxD * fxD);
          #else
            float fxF = smoothstep(fogNear, fogFar, fxD);
          #endif
          float hf = uFxHeightFog * (1.0 - exp(-fxD * 0.08)) * exp(-max(vFxWorldPos.y, 0.0) * uFxHeightFalloff);
          fxF = clamp(fxF + hf * (1.0 - fxF), 0.0, ${fogCap});
          float sunAmt = pow(max(dot(fxV / max(fxD, 1e-4), uFxSunDir), 0.0), 6.0) * uFxScatter;
          vec3 fxFogCol = fogColor + uFxSunColor * sunAmt;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fxFogCol, fxF);
        }
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `fx:${macro}:${grime}:${moss}:${floor}:${dust}:${grain}:${streak}:${fogCap}:${soot}:${vary}:${patch}:${rock}`;
}

const cache = new Map();

/** @param {string} key @returns {THREE.MeshStandardMaterial} */
export function getMaterial(key) {
  if (cache.has(key)) return cache.get(key);
  const d = DEFS[key];
  if (!d) throw new Error(`Unknown material "${key}"`);
  const params = { color: d.color ?? 0xffffff, roughness: d.roughness ?? 1, metalness: d.metalness ?? 0 };
  if (d.tex) {
    const t = getTextureSet(d.tex);
    Object.assign(params, { map: t.map, normalMap: t.normalMap });
    if (d.rough !== false) params.roughnessMap = t.roughnessMap;
  }
  if (d.vc) params.vertexColors = true;
  const m = new THREE.MeshStandardMaterial(params);
  m.name = key;
  if (d.fx) applySurfaceFX(m, d.fx);
  cache.set(key, m);
  return m;
}

const lambertCache = new Map();
/**
 * Cheaper Lambert variant of an FX material (albedo map + vertex AO + SurfaceFX
 * fog/grime), for distant backdrop geometry that never needs specular detail.
 * @param {string} key
 */
export function getLambertMaterial(key) {
  if (lambertCache.has(key)) return lambertCache.get(key);
  const d = DEFS[key];
  if (!d) throw new Error(`Unknown material "${key}"`);
  const m = new THREE.MeshLambertMaterial({ color: d.color ?? 0xffffff, vertexColors: !!d.vc });
  if (d.tex) m.map = getTextureSet(d.tex).map;
  m.name = `${key}_lambert`;
  // backdrop: fog never quite swallows a silhouette (distant towers stay readable shapes, not ghosts)
  applySurfaceFX(m, { ...(d.fx ?? {}), fogCap: 0.8 });
  const base = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `L${base()}`;
  lambertCache.set(key, m);
  return m;
}

/** Metres covered by one texture tile for a material key (0 = geometry UVs used as-is). */
export function materialTexScale(key) {
  return DEFS[key]?.texScale ?? 0;
}

/**
 * Generate (in parallel workers) every texture the given material keys use.
 * @param {string[]} keys
 */
export function preloadMaterials(keys) {
  const tex = keys.map((k) => DEFS[k]?.tex).filter((t) => t && TEXTURE_DEFS[t]);
  return preloadTextureSets(tex);
}

// ------------------------------------------------------------ special materials
const special = new Map();

/**
 * Window glass: 'lit' warm emissive (night/interiors) or glazing that mostly
 * reflects the sky by day. Intensity follows setWindowGlow().
 * @param {'ext'|'int'} side
 */
export function getWindowMaterial(side = 'ext') {
  const key = `window_${side}`;
  if (special.has(key)) return special.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: 0x223040,
    roughness: 0.12,
    metalness: 0.0,
    map: getWindowTexture('dark'),
    emissive: new THREE.Color(0xffa24a),
    emissiveMap: getWindowTexture('lit'),
    emissiveIntensity: 0.3,
    envMapIntensity: 1.4,
  });
  m.name = key;
  if (side === 'ext') {
    // interior mapping: a lamplit room behind the glazing (back wall, side walls, beamed ceiling,
    // floor) traced per pixel from the view ray, so lit windows have depth and parallax instead of
    // a flat orange card; curtains hang at the sides and the frame casts a soft inner shadow
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWinWP;\nvarying vec3 vWinN;')
        .replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
          vWinWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWinN = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWinWP;\nvarying vec3 vWinN;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 Nw = normalize(vWinN);
            vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw));
            vec3 V = normalize(vWinWP - cameraPosition);
            vec3 rd = vec3(dot(V, Tw), V.y, -dot(V, Nw));
            vec2 uv0 = vMapUv;
            vec3 ro = vec3(uv0.x, uv0.y, 0.0);
            float D = 1.1;
            vec3 tt = vec3((rd.x > 0.0 ? (1.6 - ro.x) : (-0.6 - ro.x)) / rd.x, (rd.y > 0.0 ? (1.25 - ro.y) : (-0.35 - ro.y)) / rd.y, D / max(rd.z, 1e-3));
            float t = min(min(tt.x, tt.y), tt.z);
            vec3 hp = ro + rd * t;
            float room;
            if (t == tt.z) {
              // back wall: warm plaster, a lamp glow in the middle, a dark dresser low down
              float glow = exp(-dot(hp.xy - vec2(0.55, 0.62), hp.xy - vec2(0.55, 0.62)) * 3.0);
              room = 0.32 + 1.1 * glow;
              float dresser = step(abs(hp.x - 0.25), 0.28) * step(hp.y, 0.22);
              room *= 1.0 - dresser * 0.7;
              // a shelf of crockery and a framed hanging catch the lamplight
              room *= 1.0 - 0.35 * step(abs(hp.y - 0.78), 0.012) * step(abs(hp.x - 0.8), 0.3);
              room *= 1.0 - 0.3 * step(abs(hp.x - 0.15), 0.1) * step(abs(hp.y - 0.62), 0.12);
            } else if (t == tt.y) {
              room = rd.y > 0.0 ? 0.36 * (0.5 + 0.5 * step(0.25, fract(hp.x * 2.5))) : 0.4 + 0.1 * step(0.5, fract(hp.z * 4.0));
            } else {
              // side walls catch the lamp too: a window seen edge-on still glows warm, never a black slot
              room = 0.45 + 0.45 * (hp.z / D);
            }
            // curtains drawn to either side, folds catching the lamp
            float cx = min(uv0.x, 1.0 - uv0.x);
            float curtain = 1.0 - smoothstep(0.12, 0.2, cx + 0.03 * sin(uv0.y * 9.0));
            float folds = 0.6 + 0.4 * sin(uv0.x * 90.0);
            room = mix(room, 0.5 * folds, curtain);
            // the frame's inner shadow on the glazing edges
            float edge = smoothstep(0.0, 0.06, min(cx, min(uv0.y, 1.0 - uv0.y)));
            room *= 0.45 + 0.55 * edge;
            totalEmissiveRadiance *= room * vec3(1.0, 0.92, 0.82) * 1.25;
          }`,
        );
    };
    m.customProgramCacheKey = () => 'win_ext_im';
  }
  special.set(key, m);
  return m;
}

/** Lantern/lamp glass (always emissive, flicker driven by scene). */
export function getLampGlassMaterial() {
  if (special.has('lamp')) return special.get('lamp');
  const m = new THREE.MeshStandardMaterial({ color: 0x302010, emissive: new THREE.Color(0xffb060), emissiveIntensity: 3, roughness: 0.3 });
  m.name = 'lamp_glass';
  special.set('lamp', m);
  return m;
}

/**
 * Set window/lamp emissive strength for the time of day (0 = day, 1 = deep night).
 * @param {number} night 0..1
 * @param {number} [flicker] multiplier from a flicker function
 */
export function setWindowGlow(night, flicker = 1) {
  const ext = getWindowMaterial('ext');
  const int = getWindowMaterial('int');
  ext.emissiveIntensity = (0.015 + night * 1.55) * flicker;
  ext.color.setHex(night > 0.5 ? 0x101418 : 0x8c96a2);
  // from inside by day, windows glow with daylight
  // from inside by day the glazing glows with the cool, bright sky beyond — well above the hearth
  if (int.emissiveMap !== getWindowTexture('sky')) {
    int.emissiveMap = getWindowTexture('sky');
    int.map = null;
    int.color.setHex(0x0a0c10);
    int.needsUpdate = true;
  }
  int.emissive.setHex(night > 0.5 ? 0x1a2648 : 0xffffff);
  int.emissiveIntensity = night > 0.5 ? 0.35 : 0.62; // bright, but held below the clip so the glazing keeps its leads
  const lamp = getLampGlassMaterial();
  lamp.emissiveIntensity = (0.2 + night * 4) * flicker;
}

export const MATERIAL_KEYS = Object.keys(DEFS);

/** Wall material per MapGrid edge style index (foundation v0.1). */
export const WALL_STYLE_MATERIALS = ['wall_stone', 'wall_timber', 'wall_ruin'];
/** Floor material per MapGrid CELL type (foundation v0.1). */
export const FLOOR_MATERIALS = ['floor_cobble', 'floor_wood', 'floor_rubble', 'water_dark', 'floor_flag'];
