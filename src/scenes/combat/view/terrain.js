import * as THREE from 'three';
import { getTextureSet } from '../../../render/textures/index.js';
import { getGlowTexture } from '../../../render/textures/index.js';
import { CELL, EDGE } from '../../../data/maps/MapGrid.js';
import { SUB } from '../logic/battlefield.js';
import { Batcher, worldBox, wallQuad } from './batch.js';
import { pbr, settsSet, detailSet } from './textures.js';
import { statueGeometry, statueMaterial } from './sculpted.js';
import { fbm } from '../../../render/textures/noise.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

export const TILE = 1.5;
const CELLM = TILE * SUB;

const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * World-space macro variation (breaks up texture repetition) + grime creeping up
 * from the ground, injected into a standard material.
 */
function addMacro(mat, { scale = 0.18, amount = 0.45, grime = 0.35, key = 'macro' } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tMNoise = { value: noiseTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMWPos;
        uniform sampler2D tMNoise;
        // Pre-baked tileable fBm: one fetch instead of eight sin-hashes per call.
        float mNoise(vec3 p){ return texture2D(tMNoise, (p.xz + p.y * vec2(0.71, 0.53)) * 0.125).r; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float mn = mNoise(vMWPos * ${scale.toFixed(3)}) * 0.6 + mNoise(vMWPos * ${(scale * 2.7).toFixed(3)}) * 0.4;
        diffuseColor.rgb *= ${(1 - amount / 2).toFixed(3)} + ${amount.toFixed(3)} * mn;
        // Per-patch hue drift (warm/cool stone, sun-bleached vs. sooty) and
        // brick-scale blotching so no two wall runs read as the same tile.
        diffuseColor.rgb *= mix(vec3(1.07, 0.99, 0.9), vec3(0.9, 0.96, 1.05), mNoise(vMWPos * 0.37 + 5.0));
        diffuseColor.rgb *= ${key === 'lime' ? '0.95 + 0.1' : '0.86 + 0.28'} * mNoise(vMWPos * 3.3 + 1.7);
        diffuseColor.rgb *= mix(${(1 - grime).toFixed(3)}, 1.0, smoothstep(0.0, 1.4, vMWPos.y));
        ${grime > 0 ? `// Rain streaks running down from sills and copings; moss creeping up the base.
        float stk = smoothstep(0.55, 0.9, mNoise(vec3(vMWPos.x * 2.3, vMWPos.y * 0.16, vMWPos.z * 2.3)));
        diffuseColor.rgb *= 1.0 - stk * 0.3 * smoothstep(0.4, 2.0, vMWPos.y);
        float baseMoss = (1.0 - smoothstep(0.05, 0.75, vMWPos.y)) * smoothstep(0.4, 0.7, mNoise(vMWPos * 1.7));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.19, 0.09), baseMoss * 0.6);` : ''}`)
      .replace('#include <opaque_fragment>', `
        // Torch-lit masonry rolls off softly instead of blowing out to a flat blob.
        float mPk = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
        outgoingLight *= mPk > 0.45 ? (0.45 + (mPk - 0.45) / (1.0 + (mPk - 0.45) / 0.45)) / mPk : 1.0;
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `${key}-${scale}-${amount}-${grime}-v5`;
  return mat;
}

/** Half-timbered lime-render wall (combat's own set: soft render, no crack network). */
let limeCached = null;
function limeMat() {
  if (limeCached) return limeCached;
  const t = detailSet('lime');
  limeCached = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, color: 0x948a7a, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.1, 1.1) });
  addMacro(limeCached, { key: 'lime', amount: 0.45, grime: 0.65, scale: 0.12 });
  return limeCached;
}

/** Textured PBR material from the shared library set, tinted (own instance). */
const libCache = new Map();
function libMat(set, color = 0xffffff, o = {}) {
  const key = `${set}|${color}|${o.rough ?? ''}|${o.ns ?? ''}|${o.grime ?? ''}|${o.amount ?? ''}`;
  if (libCache.has(key)) return libCache.get(key);
  const t = getTextureSet(set);
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, color, roughness: o.rough ?? 1, metalness: 0, normalScale: new THREE.Vector2(o.ns ?? 1.7, o.ns ?? 1.7) });
  addMacro(m, { key: o.grime ? 'libw' : 'lib', amount: o.amount ?? 0.55, grime: o.grime ?? 0.35 });
  libCache.set(key, m);
  return m;
}

/**
 * Build the tactical diorama for a battlefield: splatted cobble/rubble/flagstone
 * ground, houses (with roofs, windows, doors; cut-away when they would hide the
 * fight), ruined walls, arches, props, torches, and the surrounding city.
 *
 * @returns {{group:THREE.Group, torches:object[], flames:object[], update:(t:number)=>void,
 *   setView:(dirX:number, dirZ:number)=>void, bounds:{w:number,h:number}, dispose:()=>void}}
 */
export function buildDiorama(field, o = {}) {
  const group = new THREE.Group();
  const night = o.hour < 6 || o.hour > 19.5;
  const map = field.map;
  const W = field.w * TILE;
  const H = field.h * TILE;
  const RING = 6; // context cells around the window
  const batch = new Batcher();
  const cutBatch = { full: [], cut: [] };
  const houses = [];
  const flames = [];
  const torchSpots = [];
  const disposables = [];
  const ambient = [];
  const colBatches = [];
  const beamBatches = [];

  // ---------------------------------------------------------------- cells
  const cellX0 = field.cx0 - RING;
  const cellY0 = field.cy0 - RING;
  const cellsW = field.cellsW + RING * 2;
  const cellsH = field.cellsH + RING * 2;
  const inWin = (mx, my) => mx >= field.cx0 && my >= field.cy0 && mx < field.cx0 + field.cellsW && my < field.cy0 + field.cellsH;
  const reach = (mx, my) => field.reachCells?.has(`${mx},${my}`) ?? (inWin(mx, my));
  const inMap = (mx, my) => (map ? map.inBounds(mx, my) : true);
  const cellType = (mx, my) => (map ? map.getCell(mx, my) : CELL.STREET);
  // Underground maps are rock with rooms carved out of it: a cell is open
  // floor when any of its edges opens (carved), else it is living rock.
  const dungeon = map?.kind === 'dungeon';
  const carved = (mx, my) => ['N', 'E', 'S', 'W'].some((d) => { const e = map.getEdge(mx, my, d); return e === EDGE.OPEN || e === EDGE.DOOR || e === EDGE.ARCH; });
  /** solid = rendered as a building mass */
  const solid = (mx, my) => {
    if (!inMap(mx, my)) return false;
    if (inWin(mx, my)) return !reach(mx, my) && cellType(mx, my) !== CELL.WATER;
    if (dungeon) return cellType(mx, my) !== CELL.WATER && !carved(mx, my);
    return cellType(mx, my) === CELL.INTERIOR;
  };
  // Cell centre → world.
  const cw = (mx) => (mx - field.cx0) * CELLM;
  const ch = (my) => (my - field.cy0) * CELLM;

  // ---------------------------------------------------------------- ground
  const margin = RING * SUB; // squares
  const SW = field.w + margin * 2;
  const SH = field.h + margin * 2;
  const RES = 4;
  const sp = new Uint8Array(SW * RES * SH * RES * 4);
  // Kind per square in the extended area.
  const kindAt = (sx, sy) => {
    const mx = field.cx0 + Math.floor(sx / SUB);
    const my = field.cy0 + Math.floor(sy / SUB);
    if (!inMap(mx, my)) return 'outside';
    const c = cellType(mx, my);
    if (inWin(mx, my) && reach(mx, my)) return c === CELL.RUBBLE ? 'rubble' : c === CELL.COURTYARD ? 'flag' : c === CELL.INTERIOR ? 'room' : 'street';
    if (dungeon && c !== CELL.WATER && !solid(mx, my)) return 'room';
    if (c === CELL.INTERIOR || solid(mx, my)) return 'house';
    return c === CELL.RUBBLE ? 'rubble' : c === CELL.COURTYARD ? 'flag' : c === CELL.WATER ? 'water' : 'street';
  };
  // Blocking for AO: houses and walls.
  const aoBlock = (sx, sy) => {
    const k = kindAt(sx, sy);
    return k === 'house';
  };
  for (let ty = 0; ty < SH * RES; ty++) {
    for (let tx = 0; tx < SW * RES; tx++) {
      const sx = tx / RES - margin;
      const sy = ty / RES - margin;
      const k = kindAt(Math.floor(sx), Math.floor(sy));
      const i = (ty * SW * RES + tx) * 4;
      // AO: distance to nearest house square (in squares), sampled.
      let ao = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = Math.floor(sx) + dx;
          const qy = Math.floor(sy) + dy;
          if (!aoBlock(qx, qy)) continue;
          const nx = Math.max(qx, Math.min(qx + 1, sx));
          const ny = Math.max(qy, Math.min(qy + 1, sy));
          const d = Math.hypot(sx - nx, sy - ny);
          ao = Math.min(ao, 0.45 + 0.55 * Math.min(1, d / 0.9));
        }
      }
      // Walls inside the field also darken their feet.
      const fx = Math.floor(sx);
      const fy = Math.floor(sy);
      if (field.inBounds(fx, fy)) {
        const lx = sx - fx;
        const ly = sy - fy;
        const idx = field.idx(fx, fy);
        if (field.wallE[idx]) ao = Math.min(ao, 0.55 + 0.45 * Math.min(1, (1 - lx) / 0.4));
        if (field.wallS[idx]) ao = Math.min(ao, 0.55 + 0.45 * Math.min(1, (1 - ly) / 0.4));
        if (fx > 0 && field.wallE[field.idx(fx - 1, fy)]) ao = Math.min(ao, 0.55 + 0.45 * Math.min(1, lx / 0.4));
        if (fy > 0 && field.wallS[field.idx(fx, fy - 1)]) ao = Math.min(ao, 0.55 + 0.45 * Math.min(1, ly / 0.4));
      }
      const n = hash(tx >> 2, ty >> 2, 77);
      const rub = k === 'rubble' ? 1 : k === 'outside' ? 0.4 : k === 'house' ? 0.5 : 0;
      void n;
      const flag = k === 'flag' || k === 'room' ? 1 : 0;
      // Puddles in low spots of the street.
      // Paved (can hold water); the puddles themselves come from smooth noise in the shader.
      const wet = k === 'street' || k === 'flag' ? 255 : 0;
      sp[i] = ao * 255;
      sp[i + 1] = rub * 255;
      sp[i + 2] = flag * 255;
      sp[i + 3] = wet;
    }
  }
  // Kennel: a central drain runs down the middle of every narrow street.
  // Per square: free run to the nearest building on each side along the
  // narrow axis; per texel the signed offset from the street's centre line
  // (smoothly interpolable), so the shader can draw a crisp channel.
  const drainSq = new Float32Array(SW * SH * 4);
  {
    const paved = (x, y) => { const k = kindAt(x, y); return k === 'street' || k === 'flag' || k === 'rubble'; };
    const run = (x, y, dx, dy) => { let n = 0; while (n < 9 && paved(x + dx * (n + 1), y + dy * (n + 1))) n++; const k = kindAt(x + dx * (n + 1), y + dy * (n + 1)); return n < 9 && (k === 'house' || k === 'outside' || k === 'room') ? n : -1; };
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const sx = x - margin;
        const sy = y - margin;
        if (kindAt(sx, sy) !== 'street') continue;
        const l = run(sx, sy, -1, 0), r = run(sx, sy, 1, 0), u = run(sx, sy, 0, -1), d = run(sx, sy, 0, 1);
        const wx = l >= 0 && r >= 0 ? l + r + 1 : 99;
        const wz = u >= 0 && d >= 0 ? u + d + 1 : 99;
        const i = (y * SW + x) * 4;
        if (wx <= wz && wx >= 3 && wx <= 11) drainSq.set([1, l, r, 0], i);
        else if (wz < wx && wz >= 3 && wz <= 11) drainSq.set([2, u, d, 0], i);
      }
    }
  }
  const dr = new Uint8Array(SW * RES * SH * RES * 4);
  for (let ty = 0; ty < SH * RES; ty++) {
    for (let tx = 0; tx < SW * RES; tx++) {
      const x = Math.floor(tx / RES);
      const y = Math.floor(ty / RES);
      const lx = (tx + 0.5) / RES - x;
      const ly = (ty + 0.5) / RES - y;
      const i = (y * SW + x) * 4;
      const o = (ty * SW * RES + tx) * 4;
      const axis = drainSq[i];
      if (!axis) { dr[o] = 128; continue; }
      const off = axis === 1 ? ((drainSq[i + 1] + lx) - (drainSq[i + 2] + 1 - lx)) / 2 : ((drainSq[i + 1] + ly) - (drainSq[i + 2] + 1 - ly)) / 2;
      dr[o] = Math.max(0, Math.min(255, Math.round(128 + off * 30)));
      dr[o + 1] = 255;
      dr[o + 2] = axis === 1 ? 255 : 0;
    }
  }
  const drainTex = new THREE.DataTexture(dr, SW * RES, SH * RES, THREE.RGBAFormat);
  drainTex.magFilter = THREE.LinearFilter;
  drainTex.minFilter = THREE.LinearFilter;
  drainTex.needsUpdate = true;
  disposables.push(drainTex);
  const splat = new THREE.DataTexture(sp, SW * RES, SH * RES, THREE.RGBAFormat);
  splat.magFilter = THREE.LinearFilter;
  splat.minFilter = THREE.LinearFilter;
  splat.needsUpdate = true;
  disposables.push(splat);
  // Street: small granite setts (~11 cm); temple / courtyard: dressed rectangular
  // flagstones; rubble: packed dirt and grit. Each its own albedo/normal/roughness set.
  const cob = settsSet();
  const rub = getTextureSet('floor_rubble');
  const flg = getTextureSet('hd_flags');
  const groundMat = new THREE.MeshStandardMaterial({ map: cob.map, normalMap: cob.normalMap, roughnessMap: cob.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8) });
  const originX = -margin * TILE;
  const originZ = -margin * TILE;
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tSplat: { value: splat },
      tDrain: { value: drainTex },
      tNoise: { value: noiseTexture() },
      uOrigin: { value: new THREE.Vector2(originX, originZ) },
      uSize: { value: new THREE.Vector2(SW * TILE, SH * TILE) },
      map2: { value: rub.map }, normal2: { value: rub.normalMap }, rough2: { value: rub.roughnessMap },
      map3: { value: flg.map }, normal3: { value: flg.normalMap }, rough3: { value: flg.roughnessMap },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform sampler2D tSplat, tDrain, map2, normal2, rough2, map3, normal3, rough3;
        uniform vec2 uOrigin, uSize;
        float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(gHash(i), gHash(i+vec2(1,0)), f.x), mix(gHash(i+vec2(0,1)), gHash(i+vec2(1,1)), f.x), f.y); }
        uniform sampler2D tNoise;
        // Pre-baked tileable fBm (period 8 lattice units) — one texture fetch instead of 16 hashes.
        float gFbm(vec2 p){ return texture2D(tNoise, p * 0.125).r; }
      `)
      .replace('#include <map_fragment>', `
        vec2 gsp = (vWPos.xz - uOrigin) / uSize;
        float gn = gFbm(vWPos.xz * 0.45);
        vec4 gs = texture2D(tSplat, gsp + (vec2(gn, gFbm(vWPos.xz*0.45+7.1)) - 0.5) * 0.01);
        float gAO = gs.r;
        float wR = smoothstep(0.25, 0.75, gs.g + (gn - 0.5) * 0.7);
        // Paving change: a blurred, noise-broken boundary (no hard rectangle)
        // with a band of grit and loose setts where the flagstones give out.
        vec2 gdx = vec2(1.2 / uSize.x, 0.0), gdz = vec2(0.0, 1.2 / uSize.y);
        float bB = (gs.b * 2.0 + texture2D(tSplat, gsp + gdx).b + texture2D(tSplat, gsp - gdx).b + texture2D(tSplat, gsp + gdz).b + texture2D(tSplat, gsp - gdz).b) / 6.0;
        float wF = smoothstep(0.45, 0.55, bB + (gn - 0.5) * 0.75 + (gFbm(vWPos.xz * 1.9 + 3.0) - 0.5) * 0.4 + (gFbm(vWPos.xz * 0.35 + 17.0) - 0.5) * 0.35);
        float fEdge = 1.0 - abs(wF * 2.0 - 1.0);
        // Standing water: broad, organic puddles from low-frequency noise (no
        // square blocks), only on paving; their margins break up at stone scale.
        float pN = gFbm(vWPos.xz * 0.16 + 21.0) * 0.75 + gFbm(vWPos.xz * 0.5 + 4.0) * 0.25;
        float wet = smoothstep(${night ? '0.56, 0.68' : '0.63, 0.75'}, pN) * smoothstep(0.5, 0.9, gs.a);
        // Setts: 1 m tiles of ~11 cm stones; neighbouring patches use the
        // same courses shifted a whole number of rows (seamless), so the
        // repeat never lines up.
        vec2 uv1 = vec2(vWPos.x, -vWPos.z) / 1.0;
        // Patched paving: the street was relaid in irregular patches over the
        // centuries — each patch (Voronoi cell, ~2.6 m) lays the same setts in
        // its own direction and course offset with its own stone tone, and a
        // dark joint of grit runs along every patch seam. Kills the tiling.
        vec2 pvp = vWPos.xz * 0.38;
        vec2 pvi = floor(pvp), pvf = fract(pvp);
        float pmd = 8.0, pmd2 = 8.0; vec2 pmc = vec2(0.0);
        for (int pj = -1; pj <= 1; pj++) for (int pi = -1; pi <= 1; pi++) {
          vec2 pg = vec2(float(pi), float(pj));
          vec2 po = vec2(gHash(pvi + pg), gHash(pvi + pg + 17.3)) * 0.85 + 0.075;
          vec2 pr = pg + po - pvf; float pd = dot(pr, pr);
          if (pd < pmd) { pmd2 = pmd; pmd = pd; pmc = pvi + pg; } else if (pd < pmd2) pmd2 = pd;
        }
        float pSeam = (sqrt(pmd2) - sqrt(pmd)) / 0.38 * 0.5;
        float prk = floor(gHash(pmc + 5.1) * 4.0);
        mat2 pR = prk < 1.0 ? mat2(1.0, 0.0, 0.0, 1.0) : prk < 2.0 ? mat2(0.0, 1.0, -1.0, 0.0) : prk < 3.0 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, -1.0, 1.0, 0.0);
        mat2 pRi = mat2(pR[0][0], pR[1][0], pR[0][1], pR[1][1]);
        // Each relaying used its own stone: setts from fist-sized to big
        // granite blocks (per-patch scale), so the street is never one grid.
        float pScale = mix(0.72, 1.45, gHash(pmc + 6.6));
        uv1 = pR * uv1 * pScale + vec2(gHash(pmc + 9.7), gHash(pmc + 2.3)) * 7.0;
        float pTone = gHash(pmc + 3.3);
        vec2 uv2 = vec2(vWPos.x, -vWPos.z) / 3.2 + 0.37;
        vec2 uv3 = vec2(vWPos.x, -vWPos.z) / 2.7;
        vec4 gc = texture2D(map, uv1);
        // Per-stone contrast held down at tactics distance: pull each sett toward
        // the local mean so the field reads as one surface with big value shapes.
        gc.rgb = mix(texture2D(map, uv1, 4.0).rgb, gc.rgb, 0.5);
        // Each patch its own stone: greyer granite, warmer sandstone, sooty.
        gc.rgb *= mix(vec3(0.94, 0.96, 1.02), vec3(1.07, 1.0, 0.9), pTone) * (0.86 + 0.26 * gHash(pmc + 8.8));
        // Grit-filled seam between patches (setts only).
        float pJoint = 1.0 - smoothstep(0.02, 0.07, pSeam);
        if (wR > 0.001) gc = mix(gc, texture2D(map2, uv2), wR);
        if (wF > 0.001) gc = mix(gc, texture2D(map3, uv3), wF);
        // Worn boundary: grit, dirt and broken setts between the pavings.
        gc = mix(gc, texture2D(map2, uv2 * 1.3) * vec4(0.62, 0.56, 0.48, 1.0), smoothstep(0.25, 0.85, fEdge) * 0.75);
        gc.rgb = mix(gc.rgb, vec3(0.16, 0.14, 0.12) * (0.8 + 0.4 * gn), pJoint * 0.7 * (1.0 - wF) * (1.0 - wR));
        float sH = texture2D(roughnessMap, uv1).r;
        // Ruin: on dressed flagstones, broken / missing slabs open onto grit and
        // rubble, meandering hairline cracks run across slabs, moss fills seams.
        float brkN = gFbm(vWPos.xz * 0.52 + 9.0) + (gn - 0.5) * 0.12;
        float brk = wF * smoothstep(0.585, 0.615, brkN);
        if (brk > 0.001) gc = mix(gc, texture2D(map2, uv2 * 1.6 + 0.2) * vec4(0.72, 0.66, 0.58, 1.0) * (0.8 + 0.4 * gFbm(vWPos.xz * 3.1)), brk * 0.8);
        float crN = gFbm(vWPos.xz * 0.75 + 2.7) - 0.5;
        float crW = fwidth(crN) * 1.6 + 0.006;
        float crack = wF * (1.0 - brk) * (1.0 - smoothstep(crW * 0.5, crW * 1.6, abs(crN))) * smoothstep(0.38, 0.58, gFbm(vWPos.xz * 0.21 + 13.0));
        gc.rgb *= 1.0 - crack * 0.55;
        // A dark sunken rim where a slab is missing.
        float brkRim = wF * smoothstep(0.55, 0.585, brkN) * (1.0 - brk);
        // Ruin grime on the dressed floor: soot and damp blooms, darker toward the walls.
        gc.rgb *= mix(1.0, 0.92, wF * smoothstep(0.42, 0.78, gFbm(vWPos.xz * 0.2 + 50.0)));
        gc.rgb *= 1.0 - brkRim * 0.18;
        float mac = gFbm(vWPos.xz * 0.07);
        gc.rgb *= 0.74 + 0.5 * mac;
        // Packed dirt and grit silting over the low setts in broad drifts (stone
        // crowns poke through at the margins).
        float dirtP = smoothstep(0.5, 0.72, gFbm(vWPos.xz * 0.12 + 31.0) + (gn - 0.5) * 0.35) * (1.0 - wF * 0.6);
        float dCover = smoothstep(sH - 0.12, sH + 0.12, dirtP * 1.15);
        gc.rgb = mix(gc.rgb, texture2D(map2, uv2 * 1.7).rgb * vec3(0.78, 0.68, 0.55), dCover * 0.85);
        // Kerbs: a lighter dressed-stone band with a dark gutter where paving changes.
        float kerb = 1.0 - abs(wF - 0.5) * 2.0;
        gc.rgb = mix(gc.rgb, vec3(0.3, 0.29, 0.27) * (0.85 + 0.3 * gn), smoothstep(0.62, 0.92, kerb) * 0.25);
        gc.rgb *= 1.0 - smoothstep(0.3, 0.5, kerb) * (1.0 - smoothstep(0.5, 0.62, kerb)) * 0.45;
        // Mortar gaps (dark in the albedo) collect moss and grime in patches.
        float lum = dot(gc.rgb, vec3(0.3, 0.55, 0.15));
        // (Only the true joints: dark stones themselves never turn to moss,
        // which read as big dark stains across the flags.)
        float gap = 1.0 - smoothstep(0.04, 0.1, lum);
        float mossN = smoothstep(0.5, 0.78, gFbm(vWPos.xz * 0.33 + 4.0)) * (0.55 + 0.45 * (1.0 - gAO * 0.6));
        gc.rgb = mix(gc.rgb, vec3(0.2, 0.25, 0.11), gap * mossN * 0.5);
        // Moss and weeds creeping into cracks and around broken slabs.
        gc.rgb = mix(gc.rgb, vec3(0.2, 0.24, 0.12), (crack * 0.3 + brkRim * 0.2) * mossN);
        // Worn, polished wheel/foot paths.
        float worn = smoothstep(0.55, 0.78, gFbm(vWPos.xz * 0.09 + 11.0)) * (1.0 - wR);
        gc.rgb *= 1.0 + 0.2 * worn;
        // Dirt drifts heaped against walls, broken up by noise.
        float drift = smoothstep(0.08, 0.5, 1.0 - gAO) * smoothstep(0.3, 0.6, gFbm(vWPos.xz * 0.6 + 2.0) + (1.0 - gAO) * 0.4);
        gc.rgb = mix(gc.rgb, vec3(0.24, 0.2, 0.15) * (0.75 + 0.5 * gn), drift * 0.8);
        // Dead leaves and straw caught in the drifts.
        vec2 lc = floor(vWPos.xz * 11.0);
        float leaf = step(0.8, gHash(lc)) * smoothstep(0.25, 0.6, drift + dirtP * 0.3);
        gc.rgb = mix(gc.rgb, mix(vec3(0.42, 0.24, 0.1), vec3(0.5, 0.42, 0.2), gHash(lc + 3.1)) * 0.8, leaf * 0.7);
        gc.rgb = mix(gc.rgb, gc.rgb * vec3(0.95, 0.9, 0.82), smoothstep(0.55, 0.8, gFbm(vWPos.xz * 0.21 + 3.0)) * 0.6);
        // Gutters: a damp, darker band along wall feet and kerbs (rain runs off the eaves).
        float gutter = smoothstep(0.9, 0.62, gAO) * (1.0 - wR) * smoothstep(0.25, 0.55, gFbm(vWPos.xz * 0.8 + 5.0) + (1.0 - gAO) * 0.5);
        wet = max(wet, gutter * 0.55);
        // The kennel: a channel of long dressed stones down the street's
        // centre, dished, dark with damp, a thread of standing water in it.
        vec4 gD = texture2D(tDrain, gsp);
        float dOff = abs((gD.r - 0.502) * 255.0 / 30.0) * 1.5; // metres from the centre line
        float dOn = smoothstep(0.6, 0.95, gD.g) * (1.0 - wF) * (1.0 - wR);
        float kennel = dOn * (1.0 - smoothstep(0.2, 0.25, dOff));
        float kLip = dOn * (1.0 - smoothstep(0.03, 0.07, abs(dOff - 0.22)));
        vec2 kUV = gD.b > 0.5 ? vec2(vWPos.x * 3.0, vWPos.z * 0.9) : vec2(vWPos.z * 3.0, vWPos.x * 0.9);
        float kJoint = smoothstep(0.0, 0.04, abs(fract(kUV.y) - 0.5) - 0.46);
        vec3 kStone = vec3(0.26, 0.25, 0.235) * (0.8 + 0.35 * gHash(floor(kUV.yy))) * (0.85 + 0.3 * gFbm(vWPos.xz * 2.3));
        gc.rgb = mix(gc.rgb, kStone * (1.0 - kJoint * 0.5) * mix(1.0, 0.7, smoothstep(0.18, 0.0, dOff)), kennel);
        gc.rgb *= 1.0 - kLip * 0.45;
        // Damp (satin), never a sky-mirror stripe.
        wet = max(wet, kennel * smoothstep(0.2, 0.05, dOff) * 0.3);
        gc.rgb *= 1.0 - kennel * smoothstep(0.12, 0.0, dOff) * 0.35;
        // Water settles in the joints first, then floods whole patches:
        // standing puddles (dark, mirror-smooth) inside a damp margin.
        float pLevel = wet * 1.25 - 0.2;
        float sHh = mix(sH, 0.3 + gFbm(vWPos.xz * 1.3 + 6.0) * 0.6, clamp(wF + wR * 0.6, 0.0, 1.0));
        // Puddles cover whole stones (no water-only-in-the-joints lattice that
        // would glint as a waffle under torchlight).
        float puddle = smoothstep(0.62, 0.8, wet) * smoothstep(sHh - 0.25, sHh + 0.05, pLevel);
        // Damp and standing water read as sheen, not as dark stains on the setts.
        gc.rgb *= mix(1.0, 0.86, wet);
        gc.rgb = mix(gc.rgb, gc.rgb * vec3(0.72, 0.75, 0.8), puddle);
        // Grime gradient: soot and dirt darkening toward wall feet and gutters.
        gc.rgb *= mix(0.62, 1.0, smoothstep(0.55, 0.95, gAO));
        gc.rgb *= mix(0.35, 1.0, gAO);
        // Low-key stone: cool, desaturated grey-green setts and flags (warm
        // colour only where the braziers light them, never in the albedo).
        { float gL = dot(gc.rgb, vec3(0.3, 0.59, 0.11));
          gc.rgb = mix(vec3(gL), gc.rgb, ${night ? '0.25' : '0.18'}) * ${night ? 'vec3(0.84, 0.92, 0.92)' : 'vec3(0.82, 0.92, 0.88)'}; }
        diffuseColor *= gc;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float gr = texture2D(roughnessMap, uv1).g;
        if (wR > 0.001) gr = mix(gr, texture2D(rough2, uv2).g, wR);
        if (wF > 0.001) gr = mix(gr, texture2D(rough3, uv3).g, wF);
        gr = mix(gr, 1.0, brk * 0.8);
        // Matte stone (the texture's own per-stone variation, a few polished),
        // satin where damp, mirror-smooth only in the standing water.
        float roughnessFactor = max(0.74, roughness * gr);
        roughnessFactor *= 1.0 - 0.12 * smoothstep(0.55, 0.78, gFbm(vWPos.xz * 0.09 + 11.0));
        roughnessFactor = mix(roughnessFactor, 0.6, wet * 0.7);
        roughnessFactor = mix(roughnessFactor, ${night ? '0.2' : '0.42'}, puddle);
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = texture2D(normalMap, uv1).xyz * 2.0 - 1.0;
        mapN.xy = pRi * mapN.xy;
        if (wR > 0.001) mapN = mix(mapN, texture2D(normal2, uv2).xyz * 2.0 - 1.0, wR);
        if (wF > 0.001) mapN = mix(mapN, texture2D(normal3, uv3).xyz * 2.0 - 1.0, wF);
        if (brk > 0.001) mapN = mix(mapN, texture2D(normal2, uv2 * 1.6 + 0.2).xyz * 2.0 - 1.0, brk);
        mapN = normalize(mapN);
        mapN.xy *= normalScale * (1.0 - wet * 0.35) * (1.0 - puddle);
        normal = normalize( tbn * mapN );
      `)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.5, 1.0, gAO);
        // Standing water mirrors a dim slice of sky, never a white glare.
        reflectedLight.indirectSpecular *= mix(1.0, 0.3, puddle) * mix(0.6, 1.0, gAO);
        reflectedLight.directSpecular *= mix(1.0, 0.45, puddle);
      `)
      .replace('#include <opaque_fragment>', `
        // Puddles mirror the sky (a Fresnel sheen; the lights' own highlights
        // come from the low roughness), with a soft ripple of the far rooftops.
        { float pf = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
          vec3 skyR = ${night ? 'vec3(0.03, 0.04, 0.07)' : 'vec3(0.13, 0.15, 0.17)'} * (0.75 + 0.5 * gFbm(vWPos.xz * 0.6 + 40.0));
          // A bright meniscus where the water meets the stones.
          float pRim = smoothstep(0.2, 0.5, puddle) * (1.0 - smoothstep(0.6, 0.95, puddle));
          outgoingLight = mix(outgoingLight, outgoingLight * 0.55 + skyR * 0.75, puddle * (0.55 + 0.4 * pf));
          outgoingLight += skyR * pRim * 0.12; }
        // Puddle glints and fire-lit paving never blow out into bloom blobs.
        float gPk = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
        outgoingLight *= gPk > 0.5 ? (0.5 + (gPk - 0.5) / (1.0 + (gPk - 0.5) / 0.7)) / gPk : 1.0;
        #include <opaque_fragment>
      `);
  };
  groundMat.customProgramCacheKey = () => `combat-ground-v15-${night ? 1 : 0}`;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SW * TILE, SH * TILE, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(originX + (SW * TILE) / 2, 0, originZ + (SH * TILE) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(ground.geometry, groundMat);

  // Room floors (reachable interiors) — planks.
  const plank = pbr('plank', 0xae9a86);
  const hall = (field.features.rooms ?? []).length >= 6;
  const roomFloor = plank;
  // Halls/temples keep the splatted flagstone ground (with its contact shadows); houses get planks.
  for (const r of hall ? [] : field.features.rooms ?? []) {
    const g = new THREE.PlaneGeometry(CELLM, CELLM);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * 1.6);
    g.rotateX(-Math.PI / 2);
    batch.add(g, roomFloor, { p: [cw(r.mx) + CELLM / 2, 0.012, ch(r.my) + CELLM / 2] }, { cast: false });
  }

  // ---------------------------------------------------------------- materials
  // Grim fortified palette: dark weathered masonry, smoke-stained render and
  // heavy capstones (painted-diorama low key, never a bright toy town).
  // Grim fortified masonry everywhere (the lime-and-timber town is gone):
  // dark ashlar for houses and town walls, darker rubble for the ruins.
  // Grim fortified palette: cold, dark ashlar (kept darker than the playfield).
  const wallMats = [libMat('hd2_ashlar_cold', 0x5e6468), libMat('hd2_ashlar_cold', 0x565c60), libMat('wall_ruin', 0x4c5256)];
  const plinthMat = libMat('hd2_ashlar_cold', 0x464c50);
  const capMat = libMat('hd_flags', 0xc8c4b8, { ns: 0.9 });
  const linenMat = pbr('cloth', 0xd8ccb2);
  const rubbleMat = libMat('wall_ruin', 0x9a9082);
  // Interior rubble: pale broken plaster and masonry (no moss bloom: in a
  // roofless room it read as dark camouflage blotches).
  const heapMat = libMat('wall_ruin', 0xc4b8a6, { grime: 0, amount: 0.3 });
  const coreMat = libMat('floor_rubble', 0x7a6e60);
  const ruinWeedMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a6a2a, roughness: 0.8, metalness: 0, flatShading: true });
  disposables.push(ruinWeedMat, leafMat);
  const CUT_H = 0.78;
  const interiorVeil = new THREE.MeshBasicMaterial({ color: 0x080605, transparent: true, opacity: 0.07, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  disposables.push(interiorVeil);
  const gloomMat = (() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)');
    gr.addColorStop(0.3, 'rgba(0,0,0,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.MeshBasicMaterial({ map: t, color: 0x0a0806, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    disposables.push(m, t);
    return m;
  })();
  /** worldBox whose along-the-wall UVs continue from u0 (no texture restart per column). */
  const runBox = (w, h, d, u0, tex = 2.5) => {
    const g = worldBox(w, h, d, tex);
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) if (Math.abs(nor.getZ(i)) > 0.5 || Math.abs(nor.getY(i)) > 0.5) uv.setX(i, uv.getX(i) + u0 / tex);
    return g;
  };
  /**
   * Broken masonry for cut-aways: brick-width columns whose tops random-walk in
   * whole courses (stepped, jagged, never a level cut), notched where a section
   * has fallen, a few loose bricks left on the break, rubble core showing on top,
   * and (half-timbered houses) snapped posts and a ragged lath edge.
   * `place(g, lx, ly, lz)` maps face-local coords (x along, z outward).
   */
  const brokenWall = (B, place, len, base, salt, mat, { thick = 0.34, timber = false, debris = true } = {}) => {
    const bw = 0.3;
    const course = 0.12;
    const n = Math.max(2, Math.round(len / bw));
    const cwid = len / n;
    let hc = base;
    for (let k = 0; k < n; k++) {
      const r = hash(k, salt, 17);
      hc += (r < 0.32 ? -1 : r > 0.68 ? 1 : 0) * course + (base - hc) * 0.22;
      let hk = Math.max(0.36, Math.round(hc / course) * course);
      if (hash(k, salt, 29) > 0.9) hk = Math.max(0.3, hk - course * (2 + Math.floor(hash(k, salt, 31) * 3)));
      if (k === 0 || k === n - 1) hk = Math.max(hk, base + course * 3);
      B.add(place(runBox(cwid + 0.004, hk, thick, k * cwid), k * cwid + cwid / 2, hk / 2, -thick / 2), mat);
      // Broken rubble core on the top course (rough, darker than the face).
      B.add(place(worldBox(cwid * 0.9, 0.04, thick * 0.7, 0.8), k * cwid + cwid / 2, hk + 0.01, -thick / 2 + (hash(k, salt, 33) - 0.5) * 0.06), coreMat, { cast: false });
      if (hash(k, salt, 41) > 0.8) {
        B.add(place(worldBox(0.22, 0.08, 0.11, 0.6).rotateY((hash(k, salt, 43) - 0.5) * 0.9), k * cwid + cwid / 2, hk + 0.05, -thick / 2 + (hash(k, salt, 47) - 0.5) * 0.14), mat, { cast: false });
      }
      // Fallen brick and rubble at the foot, both sides.
      if (debris && hash(k, salt, 53) > 0.72) {
        const side = hash(k, salt, 59) > 0.5 ? 1 : -1;
        B.add(place(rockGeo(hash(k, salt, 61), 0.1 + hash(k, salt, 67) * 0.12), k * cwid + cwid / 2, 0.03, -thick / 2 + side * (thick / 2 + 0.12 + hash(k, salt, 71) * 0.25)), rubbleMat, { cast: false });
      }
      if (debris && hash(k, salt, 73) > 0.86) {
        B.add(place(worldBox(0.22, 0.07, 0.11, 0.6).rotateY(hash(k, salt, 79) * 3).rotateZ(0.25), k * cwid + cwid / 2, 0.05, 0.22 + hash(k, salt, 83) * 0.3), mat, { cast: false });
      }
    }
    if (timber) {
      // Snapped posts: split, slanted stubs standing above the masonry.
      const posts = Math.max(2, Math.round(len / 1.5) + 1);
      for (let k = 0; k < posts; k++) {
        const endPost = k === 0 || k === posts - 1;
        if (!endPost && hash(k, salt, 87) < 0.45) continue;
        const at = Math.min(len - 0.08, Math.max(0.08, (k / (posts - 1)) * len));
        const ph = base + 0.05 + hash(k, salt, 89) * (endPost ? 0.6 : 0.35);
        B.add(place(worldBox(0.14, ph, 0.16, 1), at, ph / 2, -0.06), darkWood);
        // Splintered top: two thin shards at angles.
        B.add(place(worldBox(0.06, 0.32, 0.12, 1).rotateZ(0.35), at - 0.03, ph + 0.1, -0.06), darkWood, { cast: false });
        B.add(place(worldBox(0.05, 0.22, 0.1, 1).rotateZ(-0.5), at + 0.04, ph + 0.05, -0.06), darkWood, { cast: false });
      }
      // A ragged lath edge where plaster has fallen away: thin strips at the break.
      for (let k = 0; k < Math.floor(len / 0.9); k++) {
        if (hash(k, salt, 97) < 0.45) continue;
        const at = (k + 0.5) * 0.9;
        const lh = base + 0.1 + hash(k, salt, 101) * 0.3;
        for (let j = 0; j < 3; j++) B.add(place(worldBox(0.55 + hash(k, j, salt) * 0.3, 0.025, 0.02, 1).rotateZ((hash(j, k, salt) - 0.5) * 0.2), at, lh + j * 0.07, 0.005), woodMat, { cast: false });
      }
    }
  };
  const roofMat = addMacro(pbr('roof', 0xb09a8c).clone(), { scale: 0.22, amount: 0.6, grime: 0, key: 'roof' });
  const slateMat = addMacro(pbr('roof', 0x5a6470).clone(), { scale: 0.22, amount: 0.5, grime: 0, key: 'slate' });
  disposables.push(slateMat);
  const thatchMat = addMacro(pbr('thatch', 0xd8c8a0).clone(), { scale: 0.25, amount: 0.5, grime: 0, key: 'thatch' });
  disposables.push(roofMat, thatchMat);
  const woodMat = pbr('wood', 0x5a3a22);
  const darkWood = pbr('wood', 0x3a2414);
  const doorMat = libMat('door_wood', 0xd0b8a0);
  const ironMat = pbr('metal', 0x3a3a40);
  const barrelMat = pbr('plank', 0xc8a080);
  const crateMat = pbr('plank', 0xd8b890);
  // Leaded diamond-pane casements (never black holes): sky-grey glass catching
  // the light toward the top, a dim room and a curtain behind the lower panes;
  // lit windows glow through the same lattice.
  const leaded = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 96;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 96);
    gr.addColorStop(0, '#8a98a8');
    gr.addColorStop(0.45, '#4a5462');
    gr.addColorStop(0.55, '#3a3028');
    gr.addColorStop(1, '#241a14');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 96);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${hash(i, 1, 41) > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + hash(i, 2, 41) * 0.08})`;
      g.fillRect(Math.floor(hash(i, 3, 41) * 8) * 8, Math.floor(hash(i, 4, 41) * 8) * 12, 8, 12);
    }
    g.strokeStyle = '#141210';
    g.lineWidth = 2;
    for (let k = -8; k < 16; k++) {
      g.beginPath(); g.moveTo(k * 10, 0); g.lineTo(k * 10 + 64, 96); g.stroke();
      g.beginPath(); g.moveTo(k * 10 + 64, 0); g.lineTo(k * 10, 96); g.stroke();
    }
    g.lineWidth = 4;
    g.strokeRect(0, 0, 64, 96);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const glassLit = new THREE.MeshStandardMaterial({ color: 0x402818, map: leaded, emissive: 0xffa040, emissiveMap: leaded, emissiveIntensity: night ? 2.2 : 0.45, roughness: 0.4 });
  const glassDark = new THREE.MeshStandardMaterial({ color: 0xffffff, map: leaded, roughness: 0.22, metalness: 0.15 });
  const archDark = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.15, metalness: 0.2 });
  disposables.push(leaded, archDark);
  disposables.push(glassLit, glassDark);

  // ---------------------------------------------------------------- room dressing
  // Reachable house interiors (roofless rooms the fight spills into) are
  // dressed like the ransacked homes they are: plaster and brick fallen in
  // heaps in the corners, a roof beam come down with its laths, tipped
  // stools, sacks, baskets, broken crockery and straw along the wall feet,
  // a trodden rug — all low and hugging the walls (never on a square's
  // centre, so nothing hides a figure or blocks a move), plus a soft gloom
  // creeping in from every wall foot.
  const crypt = !!field.features.pool;
  if (!hall || crypt) {
    const roomSet = new Set((field.features.rooms ?? []).map((r) => `${r.mx},${r.my}`));
    const sackMat = pbr('cloth', 0x9a8a6a);
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xb89a58, roughness: 0.95, side: THREE.DoubleSide });
    const potMat = new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 0.7 });
    disposables.push(strawMat, potMat);
    const strawBlade = new THREE.PlaneGeometry(0.34, 0.03).rotateX(-Math.PI / 2);
    const boneMat = pbr('bone', 0xc8bc9e);
    const drumMat = libMat('wall_stone', 0xa49a8a);
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.6, emissive: 0x2a1404, emissiveIntensity: 0.4 });
    disposables.push(waxMat);
    for (const r of field.features.rooms ?? []) {
      const x0 = cw(r.mx);
      const z0 = ch(r.my);
      const H = (k, salt) => hash(r.mx * 7 + k, r.my * 13 + salt, 977);
      // Which sides are walls (the neighbour cell is not part of the room).
      const walls = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => !roomSet.has(`${r.mx + dx},${r.my + dy}`) && cellType(r.mx + dx, r.my + dy) !== CELL.WATER);
      // Gloom gradient at each wall foot.
      for (const [dx, dy] of walls) {
        const rot = dx === -1 ? Math.PI / 2 : dx === 1 ? -Math.PI / 2 : dy === -1 ? 0 : Math.PI;
        const gx = x0 + CELLM / 2 + dx * (CELLM / 2 - 0.55);
        const gz = z0 + CELLM / 2 + dy * (CELLM / 2 - 0.55);
        batch.add(new THREE.PlaneGeometry(CELLM, 1.1).rotateX(-Math.PI / 2), gloomMat, { p: [gx, 0.03, gz], r: [0, rot, 0] }, { cast: false, receive: false });
      }
      // Corner heaps where two walls meet.
      for (const [ax, ay] of walls) {
        for (const [bx, by] of walls) {
          if (ax === 0 || by === 0) continue; // a = x side, b = z side
          const cxp = x0 + (ax > 0 ? CELLM - 0.38 : 0.38);
          const czp = z0 + (by > 0 ? CELLM - 0.38 : 0.38);
          for (let k = 0; k < 9; k++) {
            const rr = 0.07 + H(k, 31 + ax + by * 3) * (k < 3 ? 0.16 : 0.09);
            const px = cxp - ax * H(k, 32) * 0.55;
            const pz = czp - by * H(k, 33) * 0.55;
            batch.add(rockGeo(H(k, 34) * 99, rr), k % 3 ? heapMat : rubbleMat, { p: [px, rr * 0.35, pz] }, { cast: k < 3 });
          }
        }
      }
      // Clutter along each wall foot.
      walls.forEach(([dx, dy], wi) => {
        const n = 2 + Math.floor(H(wi, 40) * 3);
        for (let k = 0; k < n; k++) {
          const u = (k + 0.25 + H(k + wi * 5, 41) * 0.5) / n; // along the wall
          const off = 0.22 + H(k + wi * 5, 42) * 0.18; // from the wall
          const px = dx ? x0 + (dx > 0 ? CELLM - off : off) : x0 + 0.35 + u * (CELLM - 0.7);
          const pz = dy ? z0 + (dy > 0 ? CELLM - off : off) : z0 + 0.35 + u * (CELLM - 0.7);
          const yaw = H(k + wi * 5, 43) * Math.PI * 2;
          const kind = H(k + wi * 5, 44);
          if (crypt) {
            // The Pool's chamber: the bones of those who came before, toppled
            // column drums, cracked urns, guttered candle stubs.
            if (kind < 0.4) {
              batch.add(new THREE.SphereGeometry(0.09, 10, 8).scale(1, 0.9, 1.15), boneMat, { p: [px, 0.08, pz], r: [0.3, yaw, 0.4] });
              for (let l = 0; l < 4; l++) batch.add(new THREE.CylinderGeometry(0.018, 0.022, 0.32 + H(l, 56 + k) * 0.12, 5), boneMat, { p: [px + (H(l, 57 + k) - 0.5) * 0.45, 0.025, pz + (H(l, 58 + k) - 0.5) * 0.45], r: [Math.PI / 2, H(l, 59 + k) * 3, 0] }, { cast: false });
            } else if (kind < 0.62) {
              batch.add(columnGeo(0.42, true, r.mx * 5 + k), drumMat, { p: [px, 0.24, pz], r: [Math.PI / 2, yaw, 0], s: 0.6 });
            } else if (kind < 0.8) {
              batch.add(new THREE.CylinderGeometry(0.12, 0.17, 0.36, 10, 1, true), potMat, { p: [px, 0.18, pz], r: [0, yaw, 0.08] });
              for (let l = 0; l < 4; l++) batch.add(worldBox(0.08, 0.015, 0.06, 1), potMat, { p: [px + (H(l, 45 + k) - 0.5) * 0.5, 0.01, pz + (H(l, 46 + k) - 0.5) * 0.5], r: [0, H(l, 47) * 3, 0] }, { cast: false });
            } else {
              for (let l = 0; l < 3; l++) batch.add(new THREE.CylinderGeometry(0.025, 0.03, 0.05 + H(l, 60 + k) * 0.1, 6), waxMat, { p: [px + (l - 1) * 0.09, 0.05, pz + (H(l, 61) - 0.5) * 0.1] }, { cast: false });
            }
            continue;
          }
          if (kind < 0.2) {
            // Grain sack, slumped.
            batch.add(softSlab(0.42, 0.3, 0.3), sackMat, { p: [px, 0.15, pz], r: [0, yaw, 0.15] });
          } else if (kind < 0.36) {
            // Tipped stool: seat on its edge, legs sticking out.
            batch.add(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), woodMat, { p: [px, 0.17, pz], r: [Math.PI / 2, yaw, 0] });
            for (let l = 0; l < 3; l++) batch.add(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 5), darkWood, { p: [px + Math.cos(yaw) * 0.16, 0.12 + l * 0.05, pz + Math.sin(yaw) * 0.16], r: [0.3 * l, yaw, Math.PI / 2] }, { cast: false });
          } else if (kind < 0.5) {
            // Broken crockery: a jug on its side and shards.
            batch.add(new THREE.SphereGeometry(0.11, 10, 8).scale(1, 1.3, 1), potMat, { p: [px, 0.1, pz], r: [Math.PI / 2 - 0.2, yaw, 0] });
            for (let l = 0; l < 5; l++) batch.add(worldBox(0.07, 0.015, 0.05, 1), potMat, { p: [px + (H(l, 45 + k) - 0.5) * 0.5, 0.01, pz + (H(l, 46 + k) - 0.5) * 0.5], r: [0, H(l, 47) * 3, 0] }, { cast: false });
          } else if (kind < 0.64) {
            // A wicker basket.
            batch.add(new THREE.CylinderGeometry(0.2, 0.15, 0.24, 12, 1, true), strawMat, { p: [px, 0.12, pz] });
            batch.add(new THREE.CircleGeometry(0.15, 12).rotateX(-Math.PI / 2), darkWood, { p: [px, 0.02, pz] }, { cast: false });
          } else if (kind < 0.82) {
            // Loose boards leaning against the wall.
            for (let l = 0; l < 3; l++) batch.add(worldBox(0.16, 0.9 + l * 0.1, 0.03, 1), woodMat, { p: [px + (dy ? (l - 1) * 0.18 : 0), 0.42, pz + (dx ? (l - 1) * 0.18 : 0)], r: [dy ? -dy * 0.3 : 0, dy ? 0 : Math.PI / 2, dx ? dx * 0.3 : 0] });
          } else {
            // Plaster fallen off the wall.
            for (let l = 0; l < 4; l++) batch.add(worldBox(0.14 + H(l, 48) * 0.16, 0.025, 0.1 + H(l, 49) * 0.12, 1), heapMat, { p: [px + (H(l, 50) - 0.5) * 0.4, 0.015, pz + (H(l, 51) - 0.5) * 0.4], r: [0, H(l, 52) * 3, 0] }, { cast: false });
          }
          // A tuft of straw at the wall foot.
          for (let l = 0; l < 6; l++) batch.add(strawBlade, strawMat, { p: [px + (H(l, 53 + k) - 0.5) * 0.5, 0.012 + l * 0.002, pz + (H(l, 54 + k) - 0.5) * 0.5], r: [0, H(l, 55 + k) * 3.14, 0] }, { cast: false });
        }
      });
      if (crypt) {
        // Out on the open floor: small litter only at the corners where four
        // squares meet (never under a figure) — a scatter of bones, a fallen
        // stone, a guttered candle.
        for (let q = 0; q < 4; q++) {
          if (H(q, 120) > 0.5) continue;
          const px = x0 + TILE * (q % 2 ? 1 : 0) + (q % 2 ? 0 : 0.02);
          const pz = z0 + TILE * (q > 1 ? 1 : 0);
          if (q === 0 && (walls.some(([dx]) => dx === -1) || walls.some(([, dy]) => dy === -1))) continue;
          const kind = H(q, 123);
          if (kind < 0.55) {
            for (let l = 0; l < 5; l++) batch.add(new THREE.CylinderGeometry(0.026, 0.032, 0.4 + H(l, 131 + q) * 0.15, 6), boneMat, { p: [px + (H(l, 124 + q) - 0.5) * 0.5, 0.03, pz + (H(l, 125 + q) - 0.5) * 0.5], r: [Math.PI / 2, H(l, 126 + q) * 3, 0] }, { cast: false });
            if (kind < 0.35) batch.add(new THREE.SphereGeometry(0.11, 12, 9).scale(0.9, 0.85, 1.1), boneMat, { p: [px + 0.12, 0.09, pz - 0.08], r: [0.4, H(q, 132) * 6, 0.5] });
          } else {
            for (let l = 0; l < 6; l++) {
              const rr = 0.08 + H(l, 127 + q) * 0.16;
              batch.add(rockGeo(H(l, 128 + q) * 80, rr), l % 2 ? heapMat : drumMat, { p: [px + (H(l, 129 + q) - 0.5) * 0.55, rr * 0.3, pz + (H(l, 130 + q) - 0.5) * 0.55] }, { cast: l < 2 });
            }
          }
        }
        continue;
      }
      // A roof beam come down along one wall, with laths, in some rooms.
      if (walls.length && H(0, 60) < 0.55) {
        const [dx, dy] = walls[Math.floor(H(0, 61) * walls.length)];
        const along = dy !== 0;
        const bx = dx ? x0 + (dx > 0 ? CELLM - 0.3 : 0.3) : x0 + CELLM / 2;
        const bz = dy ? z0 + (dy > 0 ? CELLM - 0.3 : 0.3) : z0 + CELLM / 2;
        const tilt = 0.18 + H(0, 62) * 0.1;
        batch.add(worldBox(along ? CELLM * 0.92 : 0.2, 0.2, along ? 0.2 : CELLM * 0.92, 1), darkWood, { p: [bx, 0.32, bz], r: [along ? 0 : tilt, 0, along ? tilt : 0] });
        for (let l = 0; l < 4; l++) {
          const t = (l + 0.5) / 4 - 0.5;
          batch.add(worldBox(along ? 0.06 : 0.75, 0.03, along ? 0.75 : 0.06, 1), woodMat, { p: [bx + (along ? t * CELLM * 0.85 : -dx * 0.25), 0.1 + l * 0.02, bz + (along ? -dy * 0.25 : t * CELLM * 0.85)], r: [0, (H(l, 63) - 0.5) * 0.5, 0] }, { cast: false });
        }
      }
      // A trodden rug in some rooms.
      if (H(0, 70) < 0.4) {
        const rug = new THREE.PlaneGeometry(1.9, 1.3).rotateX(-Math.PI / 2);
        batch.add(rug, rugMaterial(Math.floor(H(0, 71) * 3)), { p: [x0 + CELLM / 2, 0.02, z0 + CELLM / 2], r: [0, (H(0, 72) - 0.5) * 0.4 + (H(0, 73) > 0.5 ? Math.PI / 2 : 0), 0] }, { cast: false });
      }
    }
  }

  // ---------------------------------------------------------------- houses
  // Connected components of solid cells in the extended region.
  const seen = new Set();
  const comps = [];
  for (let my = cellY0; my < cellY0 + cellsH; my++) {
    for (let mx = cellX0; mx < cellX0 + cellsW; mx++) {
      const k = `${mx},${my}`;
      if (seen.has(k) || !solid(mx, my)) continue;
      const cells = [];
      const q = [[mx, my]];
      seen.add(k);
      while (q.length) {
        const [x, y] = q.pop();
        cells.push([x, y]);
        for (const [dx, dy, d] of [[1, 0, 'E'], [-1, 0, 'W'], [0, 1, 'S'], [0, -1, 'N']]) {
          const nx = x + dx;
          const ny = y + dy;
          const nk = `${nx},${ny}`;
          if (seen.has(nk) || nx < cellX0 || ny < cellY0 || nx >= cellX0 + cellsW || ny >= cellY0 + cellsH) continue;
          if (!solid(nx, ny)) continue;
          // Separate buildings divided by a wall line belong to different houses.
          if (map && map.getEdge(x, y, d) !== EDGE.OPEN && inMap(nx, ny)) continue;
          seen.add(nk);
          q.push([nx, ny]);
        }
      }
      comps.push(cells);
    }
  }
  // Thick fortified parapet run along x (horiz) or z at `off`, from m0 to m1 metres:
  // a dark mortar core, three staggered ashlar courses of uneven blocks, each a
  // little proud, under broad pale overhanging capstone slabs.
  const PAR_H = 1.05;
  const PAR_T = 0.72;
  const parAshlar = libMat('wall_ruin', 0x6a7074, { grime: 0.4, amount: 0.5 });
  const parAshlar2 = libMat('wall_ruin', 0x5a6064, { grime: 0.4, amount: 0.5 });
  const parMortar = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 1, metalness: 0 });
  disposables.push(parMortar);
  // Iteration 4: dressed stone reads from the geometry (chamfered blocks, deep
  // joints); the surface is plain weathered stone (macro blotching, grime, moss
  // at the foot), never a brick texture inside each block.
  const plainStone = (color, key, grime = 0.3) => {
    key = 'ash';
    grime = 0.3;
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
    addMacro(m, { key, amount: 0.6, grime, scale: 0.45 });
    disposables.push(m);
    return m;
  };
  const parBlk = [plainStone(0x5c6264, 'ashA'), plainStone(0x686c6c, 'ashB'), plainStone(0x50585a, 'ashC')];
  const parAshlar3 = parBlk[2];
  const parCope = plainStone(0xb8bab4, 'cope', 0.1);
  const parCopeDark = plainStone(0x6c7070, 'copeD', 0.2);
  function parapet(horiz, off, m0, m1, seed, o = {}) {
    const PH = o.h ?? PAR_H;
    const PT = PAR_T;
    const at = (u, y, w, h, d, mat, cast = true) => {
      batch.add(worldBox(horiz ? w : d, h, horiz ? d : w, 2.2), mat, { p: [horiz ? u : off, y, horiz ? off : u] }, { cast });
    };
    // Iteration 4: heavy dressed ashlar, not toy bricks. Courses of unequal
    // height (a deep plinth course, a tall middle course, a thin levelling
    // course), blocks of very different lengths with chamfered, worn arrises,
    // set slightly proud or sunk, in a few cold grey stones; dark recessed joints.
    const blk = (u, y, w, h, d, mat, sd) => {
      const g = chamferBox(horiz ? w : d, h, horiz ? d : w, 0.045, sd, 0.014);
      batch.add(g, mat, { p: [horiz ? u : off, y, horiz ? off : u] }, { cast: true });
    };
    at((m0 + m1) / 2, PH / 2, m1 - m0 - 0.02, PH, PT - 0.08, parMortar);
    const courseH = [0.42, 0.36, 0.22];
    const sum = courseH.reduce((a, b) => a + b, 0);
    let y0 = 0;
    for (let c = 0; c < courseH.length; c++) {
      const chh = (courseH[c] / sum) * PH;
      let u = m0 - hash(seed, c, 47) * 0.5;
      let k = 0;
      while (u < m1 - 0.05) {
        const hv = hash(Math.round(u * 13) + seed * 101, c * 7 + k, 41);
        const bl = c === 2 ? 0.4 + hv * 0.55 : 0.55 + hv * 0.95;
        const ua = Math.max(m0, u);
        const ub = Math.min(m1, u + bl);
        if (ub - ua > 0.1) {
          const proud = (hash(k, c + seed, 48) - 0.4) * 0.03 + (c === 0 ? 0.05 : 0);
          const tone = hash(k * 3 + c, seed, 49);
          blk((ua + ub) / 2, y0 + chh / 2, ub - ua - 0.03, chh - 0.03, PT - 0.03 + proud * 2, parBlk[Math.min(2, Math.floor(tone * 3))], seed * 17 + c * 5 + k);
        }
        u += bl;
        k++;
      }
      y0 += chh;
    }
    // A continuous, broad pale capstone: long slabs butted tight, overhanging
    // both faces, sat on a thinner drip course (a visible step and shadow line).
    at((m0 + m1) / 2, PH + 0.04, m1 - m0 + 0.06, 0.08, PT + 0.1, parCopeDark, false);
    let u = m0 - 0.12;
    let k = 0;
    while (u < m1 + 0.1) {
      const hv = hash(k, Math.round(off * 10) + seed, 43);
      const bl = 1.2 + hv * 0.7;
      const ub = Math.min(m1 + 0.12, u + bl);
      blk((u + ub) / 2, PH + 0.08 + 0.11, ub - u - 0.012, 0.22, PT + 0.32, parCope, seed * 13 + k + 500);
      u += bl;
      k++;
    }
    for (const [pu, isEnd] of [[m0, o.pierA], [m1, o.pierB]]) {
      if (!isEnd) continue;
      blk(pu, (PH + 0.45) / 2, 0.9, PH + 0.45, PT + 0.2, parBlk[1], seed + 900);
      blk(pu, PH + 0.45 + 0.11, 1.1, 0.22, PT + 0.4, parCope, seed + 901);
    }
  }
  /**
   * A razed building inside the fight window: only its thick, capstoned
   * fortified footing walls still stand (low, so they never hide a figure),
   * enclosing a mound of rubble and dark earth. Still solid for the rules.
   */
  function makeYard(r) {
    const [x0, y0, x1, y1] = r;
    const ax = cw(x0) + PAR_T / 2 + 0.05;
    const bx = cw(x1) + CELLM - PAR_T / 2 - 0.05;
    const az = ch(y0) + PAR_T / 2 + 0.05;
    const bz = ch(y1) + CELLM - PAR_T / 2 - 0.05;
    const sd = x0 * 31 + y0 * 7;
    const hh = PAR_H + 0.15;
    parapet(true, az, ax - PAR_T / 2, bx + PAR_T / 2, sd, { h: hh });
    parapet(true, bz, ax - PAR_T / 2, bx + PAR_T / 2, sd + 1, { h: hh });
    parapet(false, ax, az + PAR_T / 2, bz - PAR_T / 2, sd + 2, { h: hh });
    parapet(false, bx, az + PAR_T / 2, bz - PAR_T / 2, sd + 3, { h: hh });
    // Earth and rubble fill.
    const earth = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 1, metalness: 0 });
    disposables.push(earth);
    batch.add(worldBox(bx - ax - PAR_T + 0.02, 0.6, bz - az - PAR_T + 0.02, 2), earth, { p: [(ax + bx) / 2, 0.3, (az + bz) / 2] }, { cast: false });
    const nR = Math.round(((bx - ax) * (bz - az)) / 1.6);
    for (let k = 0; k < nR; k++) {
      const px = ax + PAR_T / 2 + 0.3 + hash(k, sd, 61) * (bx - ax - PAR_T - 0.6);
      const pz = az + PAR_T / 2 + 0.3 + hash(sd, k, 62) * (bz - az - PAR_T - 0.6);
      // Angular broken ashlar, tumbled and half sunk (no blobby rocks).
      const rr = 0.2 + hash(k, k + sd, 63) * 0.3;
      const g = chamferBox(rr * (1.4 + hash(k, 1, sd) * 1.2), rr * 0.8, rr * (0.9 + hash(k, 2, sd) * 0.6), 0.03, sd * 7 + k, rr * 0.18);
      batch.add(g, parBlk[k % 3], { p: [px, 0.6 + rr * 0.15, pz], r: [(hash(k, 66, sd) - 0.5) * 0.7, hash(k, 65, sd) * 6, (hash(k, 67, sd) - 0.5) * 0.7] }, { cast: k < 4 });
    }
  }
  if (dungeon) buildVaults();
  for (const cells of dungeon ? [] : comps) {
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    const filled = cells.length === (x1 - x0 + 1) * (y1 - y0 + 1);
    const rects = filled ? [[x0, y0, x1, y1]] : cells.map(([x, y]) => [x, y, x, y]);
    for (const r of rects) {
      // Buildings standing (mostly) inside the fight window are razed to their
      // fortified footings: the board reads as a walled ruin, nothing tall
      // hides the fight, and the capstoned walls run across every shot.
      let inside = 0;
      for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) if (inWin(x, y)) inside++;
      if (inside * 2 > (r[2] - r[0] + 1) * (r[3] - r[1] + 1)) makeYard(r);
      else houses.push(makeHouse(r));
    }
  }

  /**
   * Underground sets (dungeon maps): the rock the rooms are cut from. Every
   * solid cell near open floor is a block of dressed ashlar (plinth course,
   * pilasters at the cell corners, a moulded cornice) under a dark rock crown;
   * a lone solid cell inside a room is a massive pier. Each block is its own
   * cut-away group (drops to a capped knee wall when it would hide the fight).
   */
  function buildVaults() {
    const stone = libMat('wall_stone', 0x8e8478, { grime: 0.3, amount: 0.4 });
    const dress = libMat('wall_stone', 0xa49a8c, { grime: 0.15, amount: 0.3 });
    const rock = libMat('wall_ruin', 0x3a342e, { grime: 0, amount: 0.5 });
    const VH = 3.6;
    const near = (mx, my) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inMap(mx + dx, my + dy) && !solid(mx + dx, my + dy)) return true;
      return false;
    };
    const capB = new Batcher();
    for (let my = cellY0; my < cellY0 + cellsH; my++) {
      for (let mx = cellX0; mx < cellX0 + cellsW; mx++) {
        if (!inMap(mx, my) || !solid(mx, my)) continue;
        const x0 = cw(mx);
        const z0 = ch(my);
        const x1 = x0 + CELLM;
        const z1 = z0 + CELLM;
        if (!near(mx, my)) {
          capB.add(new THREE.PlaneGeometry(CELLM, CELLM).rotateX(-Math.PI / 2), rock, { p: [x0 + CELLM / 2, VH, z0 + CELLM / 2] }, { cast: false });
          continue;
        }
        const seed = hash(mx, my, 5);
        const open4 = [[0, 1, 'S'], [0, -1, 'N'], [1, 0, 'E'], [-1, 0, 'W']].map(([dx, dy, d]) => ({ d, open: inMap(mx + dx, my + dy) && !solid(mx + dx, my + dy) }));
        const pier = open4.every((o) => o.open);
        const ins = pier ? 0.85 : 0;
        const hx0 = x0 + ins, hz0 = z0 + ins, hx1 = x1 - ins, hz1 = z1 - ins;
        const house = { r: [mx, my, mx, my], style: 0, ruined: true, vault: true, x0: hx0, z0: hz0, x1: hx1, z1: hz1, height: VH, seed, full: new Batcher(), cut: new Batcher() };
        const faces = [
          { d: 'S', ax: 'x', a: hx0, b: hx1, c: hz1, n: [0, 1] },
          { d: 'N', ax: 'x', a: hx1, b: hx0, c: hz0, n: [0, -1] },
          { d: 'E', ax: 'z', a: hz1, b: hz0, c: hx1, n: [1, 0] },
          { d: 'W', ax: 'z', a: hz0, b: hz1, c: hx0, n: [-1, 0] },
        ];
        for (const f of faces) {
          const len = Math.abs(f.b - f.a);
          const yaw = Math.atan2(f.n[0], f.n[1]);
          const ox = f.ax === 'x' ? f.a : f.c;
          const oz = f.ax === 'x' ? f.c : f.a;
          const place = (g, lx, ly, lz = 0) => {
            const m = new THREE.Matrix4().makeRotationY(yaw);
            m.setPosition(ox + Math.cos(yaw) * lx + Math.sin(yaw) * lz, ly, oz - Math.sin(yaw) * lx + Math.cos(yaw) * lz);
            return g.applyMatrix4(m);
          };
          const isOpen = open4.find((o) => o.d === f.d)?.open;
          for (const variant of ['full', 'cut']) {
            const B = house[variant];
            const hh = variant === 'cut' ? CUT_H : VH;
            B.add(place(runBox(len + 0.004, hh, 0.4, 0, 1.8), len / 2, hh / 2, -0.2), stone);
            if (!isOpen) continue;
            // Plinth course and (full) a moulded cornice under the rock crown.
            B.add(place(worldBox(len + 0.12, 0.42, 0.14, 1.5), len / 2, 0.21, 0.05), dress);
            if (variant === 'cut') {
              B.add(place(worldBox(len + 0.1, 0.09, 0.52, 1), len / 2, hh + 0.045, -0.2), dress);
              continue;
            }
            B.add(place(worldBox(len + 0.16, 0.16, 0.18, 1.5), len / 2, VH - 0.32, 0.06), dress);
            B.add(place(worldBox(len + 0.24, 0.12, 0.26, 1.5), len / 2, VH - 0.16, 0.1), dress, { cast: false });
            // Pilasters at the corners and mid-face: rhythm and contact shadow.
            for (const at of pier ? [0.16, len - 0.16] : [0.2, len / 2, len - 0.2]) {
              B.add(place(worldBox(0.42, VH - 0.5, 0.16, 1.5), at, (VH - 0.5) / 2 + 0.05, 0.07), dress);
            }
            // Wall torches on open faces (the cut-away hides them with the wall).
            if (!pier && hash(mx * 3 + f.d.charCodeAt(0), my, 61) > 0.55) {
              const at = len * (0.25 + hash(mx, my, f.d.charCodeAt(0)) * 0.5);
              torchSpots.push({ x: ox + Math.cos(yaw) * at + Math.sin(yaw) * 0.42, z: oz - Math.sin(yaw) * at + Math.cos(yaw) * 0.42, y: 2.3, yaw, house });
            }
          }
        }
        // The rock crown (full) / a dark cap on the knee wall (cut).
        house.full.add(new THREE.PlaneGeometry(hx1 - hx0, hz1 - hz0).rotateX(-Math.PI / 2), rock, { p: [(hx0 + hx1) / 2, VH, (hz0 + hz1) / 2] }, { cast: false });
        house.cut.add(new THREE.PlaneGeometry(hx1 - hx0 - 0.3, hz1 - hz0 - 0.3).rotateX(-Math.PI / 2), rock, { p: [(hx0 + hx1) / 2, CUT_H + 0.02, (hz0 + hz1) / 2] }, { cast: false });
        if (pier) {
          // A pier wears a stepped base and a capital block.
          house.full.add(worldBox(hx1 - hx0 + 0.36, 0.3, hz1 - hz0 + 0.36, 1.5), dress, { p: [(hx0 + hx1) / 2, 0.15, (hz0 + hz1) / 2] });
          house.full.add(worldBox(hx1 - hx0 + 0.3, 0.26, hz1 - hz0 + 0.3, 1.5), dress, { p: [(hx0 + hx1) / 2, VH - 0.13, (hz0 + hz1) / 2] });
        }
        houses.push(house);
      }
    }
    capB.flush(group);
  }

  function houseStyle(r) {
    if (!map) return 0;
    const [x0, y0, x1, y1] = r;
    for (let x = x0; x <= x1; x++) {
      for (const [y, d] of [[y0, 'N'], [y1, 'S']]) if (map.getEdge(x, y, d) !== EDGE.OPEN) return map.getEdgeStyle(x, y, d);
    }
    for (let y = y0; y <= y1; y++) {
      for (const [x, d] of [[x0, 'W'], [x1, 'E']]) if (map.getEdge(x, y, d) !== EDGE.OPEN) return map.getEdgeStyle(x, y, d);
    }
    return 0;
  }

  function makeHouse(r) {
    const [x0, y0, x1, y1] = r;
    // Half-timbered houses (style 1) are rebuilt in stone for combat.
    const style = houseStyle(r) === 1 ? 0 : houseStyle(r);
    const ruined = style === 2;
    const hx0 = cw(x0) + 0.12;
    const hz0 = ch(y0) + 0.12;
    const hx1 = cw(x1 + 1) - 0.12;
    const hz1 = ch(y1 + 1) - 0.12;
    const seed = hash(x0, y0, 5);
    const height = ruined ? 2.2 + seed * 1.4 : 4.4 + seed * 1.8 + (x1 - x0 + y1 - y0) * 0.2;
    const house = { r, style, ruined, x0: hx0, z0: hz0, x1: hx1, z1: hz1, height, seed, full: new Batcher(), cut: new Batcher() };
    // Faces: [dir, from, to, fixed coord, normal]
    const faces = [
      { d: 'S', ax: 'x', a: hx0, b: hx1, c: hz1, n: [0, 1] },
      { d: 'N', ax: 'x', a: hx1, b: hx0, c: hz0, n: [0, -1] },
      { d: 'E', ax: 'z', a: hz1, b: hz0, c: hx1, n: [1, 0] },
      { d: 'W', ax: 'z', a: hz0, b: hz1, c: hx0, n: [-1, 0] },
    ];
    const wallMat = wallMats[style] ?? wallMats[0];
    for (const f of faces) {
      const len = Math.abs(f.b - f.a);
      // Transform: local X along the face (from a to b), +Z outward.
      const yaw = Math.atan2(f.n[0], f.n[1]);
      const ox = f.ax === 'x' ? f.a : f.c;
      const oz = f.ax === 'x' ? f.c : f.a;
      const place = (g, lx, ly, lz = 0) => {
        const m = new THREE.Matrix4().makeRotationY(yaw);
        m.setPosition(ox + Math.cos(yaw) * lx + Math.sin(yaw) * lz, ly, oz - Math.sin(yaw) * lx + Math.cos(yaw) * lz);
        g.applyMatrix4(m);
        return g;
      };
      // Door positions on this face from the map.
      const doors = [];
      if (map) {
        const cellsAlong = f.ax === 'x' ? [x0, x1] : [y0, y1];
        for (let k = cellsAlong[0]; k <= cellsAlong[1]; k++) {
          const mx = f.ax === 'x' ? k : f.d === 'E' ? x1 : x0;
          const my = f.ax === 'z' ? k : f.d === 'S' ? y1 : y0;
          const e = map.getEdge(mx, my, f.d);
          if (e === EDGE.DOOR || e === EDGE.LOCKED || e === EDGE.ARCH) {
            const centre = f.ax === 'x' ? cw(mx) + CELLM / 2 : ch(my) + CELLM / 2;
            doors.push({ at: Math.abs(centre - f.a), type: e });
          }
        }
      }
      // Two variants: the full house, and a cut-away (a weathered, broken-topped
      // knee-to-hip wall with a coping) shown when a tall facade near the
      // camera would eat the frame or hide the fight (see setView).
      for (const variant of ['full', 'cut']) {
        const B = house[variant];
        const hh = variant === 'cut' ? CUT_H : height;
        if (variant === 'cut') {
          // A short, cleanly capped wall base: the house drops to its footprint
          // (no tall jagged shell, no dollhouse) so the eye stays on the fight.
          // Thick masonry with a broad, overhanging capstone course.
          B.add(place(runBox(len + 0.004, hh, 0.6, 0), len / 2, hh / 2, -0.3), wallMat);
          B.add(place(worldBox(len + 0.04, 0.06, 0.7, 1), len / 2, hh + 0.03, -0.3), plinthMat);
          B.add(place(worldBox(len + 0.16, 0.15, 0.84, 1), len / 2, hh + 0.135, -0.3), capMat);
          if (style === 1) for (const at of [0.07, len - 0.07]) B.add(place(worldBox(0.2, hh + 0.16, 0.22, 1), at, (hh + 0.16) / 2, -0.11), darkWood);
        } else if (ruined) {
          // Jagged broken wall top.
          const segs = Math.max(2, Math.round(len / 1.1));
          for (let k = 0; k < segs; k++) {
            const sh = hh * (0.55 + hash(k, f.d.charCodeAt(0), seed * 100) * 0.45) * (k === 0 || k === segs - 1 ? 1 : 1);
            const sl = len / segs;
            B.add(place(worldBox(sl + 0.02, sh, 0.34, 2.5), k * sl + sl / 2, sh / 2, -0.17), wallMat);
          }
        } else {
          B.add(place(wallQuad(len, hh, 2.6), 0, 0, 0), wallMat);
          // Fortified parapet: a thick crenel-less breastwork round the roof
          // under a broad, overhanging flat capstone course.
          B.add(place(worldBox(len + 0.3, 0.6, 0.5, 2.5), len / 2, hh + 0.3, -0.1), wallMat);
          B.add(place(worldBox(len + 0.46, 0.17, 0.76, 1), len / 2, hh + 0.685, -0.1), capMat);
        }
        // Plinth.
        B.add(place(worldBox(len + 0.1, 0.45, 0.1, 2.5), len / 2, 0.225, 0.03), plinthMat);
        if (variant === 'full') {
          // Fortified footing: a thick battered stone base wall under a broad
          // flat capstone course, broken only at the doors (reads at street
          // level in every fight, like the target's capstoned wall runs).
          const cuts = doors.map((d) => [d.at - 0.85, d.at + 0.85]).sort((a, b) => a[0] - b[0]);
          let a0 = -0.1;
          for (const [c0, c1] of [...cuts, [len + 0.1, len + 0.1]]) {
            const sl = c0 - a0;
            if (sl > 0.3) {
              B.add(place(worldBox(sl, 0.7, 0.42, 2.5), a0 + sl / 2, 0.35, 0.13), wallMat);
              B.add(place(worldBox(sl + 0.04, 0.13, 0.56, 1), a0 + sl / 2, 0.765, 0.15), capMat);
            }
            a0 = Math.max(a0, c1);
          }
        }
        if (variant === 'full' && !ruined) {
          // Corner quoins (alternating dressed blocks) / timber posts.
          if (style === 1) B.add(place(worldBox(0.26, hh, 0.26, 2.5), 0, hh / 2, -0.06), darkWood);
          else {
            for (let qy = 0.45, k = 0; qy < hh - 0.2; qy += 0.36, k++) {
              const qw = k % 2 ? 0.34 : 0.56;
              B.add(place(worldBox(qw, 0.32, 0.08, 1), qw / 2 - 0.02, qy + 0.16, 0.03), plinthMat);
            }
            // Eaves corbels under the roof line.
            for (let cx = 0.6; cx < len - 0.3; cx += 1.1) B.add(place(worldBox(0.14, 0.18, 0.32, 1), cx, hh - 0.12, 0.14), darkWood, { cast: false });
          }
          // Upper-floor string course.
          B.add(place(worldBox(len, 0.16, 0.12, 2.5), len / 2, 2.7, 0.05), style === 1 ? darkWood : plinthMat);
          // Windows along the upper floor, and the ground floor away from doors.
          const nWin = Math.max(1, Math.floor(len / 2.3));
          for (let k = 0; k < nWin; k++) {
            const at = (k + 0.5) * (len / nWin);
            for (const floorY of [3.35, 1.45]) {
              if (floorY > hh - 0.9) continue;
              if (floorY < 2 && doors.some((d) => Math.abs(d.at - at) < 1.3)) continue;
              if (hash(k, floorY * 10, seed * 999 + f.d.charCodeAt(0)) < (floorY < 2 ? 0.45 : 0.2)) continue;
              const lit = hash(k, floorY * 7, seed * 313) > (night ? 0.45 : 0.8);
              B.add(place(worldBox(0.7, 0.95, 0.06, 1), at, floorY, -0.02), lit ? glassLit : glassDark, { cast: false });
              B.add(place(worldBox(0.86, 0.1, 0.16, 1), at, floorY - 0.52, 0.04), darkWood);
              B.add(place(worldBox(0.86, 0.1, 0.1, 1), at, floorY + 0.52, 0.03), darkWood);
              B.add(place(worldBox(0.06, 0.95, 0.06, 1), at, floorY, 0.03), darkWood, { cast: false });
              // Deep reveals: side jambs and a heavy lintel stand proud of the
              // plaster so each window reads as a recess with its own shadow.
              for (const jx of [-0.41, 0.41]) B.add(place(worldBox(0.07, 1.05, 0.2, 1), at + jx, floorY, 0.08), darkWood);
              B.add(place(worldBox(1.0, 0.14, 0.22, 1), at, floorY + 0.58, 0.09), darkWood);
              // Shutters, some hanging askew.
              if (hash(k, 3, seed * 77) > 0.4) {
                const ang = hash(k, 4, seed) * 0.6;
                B.add(place(worldBox(0.36, 0.95, 0.04, 1).rotateY(0.9 + ang), at - 0.62, floorY, 0.2), woodMat);
              }
              if (lit && night && flames.length < 0) void 0;
            }
          }
          // Doors.
          for (const d of doors) {
            B.add(place(worldBox(1.15, 2.05, 0.08, 1.2), d.at, 1.03, 0.01), d.type === EDGE.ARCH ? archDark : doorMat);
            B.add(place(worldBox(1.45, 0.2, 0.2, 1), d.at, 2.15, 0.06), style === 1 ? darkWood : plinthMat);
            for (const sx of [-1, 1]) B.add(place(worldBox(0.16, 2.1, 0.18, 1), d.at + sx * 0.66, 1.05, 0.05), style === 1 ? darkWood : plinthMat);
            B.add(place(worldBox(1.5, 0.12, 0.5, 1), d.at, 0.06, 0.25), plinthMat);
            B.add(place(new THREE.TorusGeometry(0.07, 0.015, 5, 10), d.at + 0.35, 1.05, 0.07), ironMat, { cast: false });
            torchSpots.push({ x: ox + Math.cos(yaw) * (d.at + 1.0) + Math.sin(yaw) * 0.35, z: oz - Math.sin(yaw) * (d.at + 1.0) + Math.cos(yaw) * 0.35, y: 2.35, yaw, house });
          }
          if (!doors.length && len > 3) torchSpots.push({ x: ox + Math.cos(yaw) * (len / 2) + Math.sin(yaw) * 0.35, z: oz - Math.sin(yaw) * (len / 2) + Math.cos(yaw) * 0.35, y: 2.4, yaw, house });
          // Long masonry faces get stepped buttresses (rhythm and shadow on an
          // otherwise flat slab); any face may carry ivy climbing from a corner.
          if (style !== 1 && len > 5) {
            const nb = Math.floor(len / 3.6);
            for (let k = 1; k <= nb; k++) {
              const at = (k / (nb + 1)) * len;
              if (doors.some((d) => Math.abs(d.at - at) < 1.1)) continue;
              const bh = Math.min(hh - 0.6, 2.6 + hash(k, seed * 50, 3) * 0.8);
              B.add(place(worldBox(0.5, bh, 0.42, 2.5), at, bh / 2, 0.21), plinthMat);
              B.add(place(worldBox(0.5, 0.7, 0.32, 2.5).rotateX(-0.6), at, bh + 0.12, 0.12), plinthMat, { cast: false });
            }
          }
          if (hash(f.d.charCodeAt(0), seed * 77, 11) > 0.45) {
            const iw2 = 1.4 + hash(seed * 31, f.d.charCodeAt(0), 2) * 1.6;
            const ih2 = Math.min(hh - 0.4, 2.2 + hash(seed * 29, f.d.charCodeAt(0), 4) * 2.2);
            const left = hash(seed * 13, f.d.charCodeAt(0), 6) > 0.5;
            const g = new THREE.PlaneGeometry(iw2, ih2);
            B.add(place(g, left ? iw2 / 2 + 0.05 : len - iw2 / 2 - 0.05, ih2 / 2, 0.035), ivyMaterial(Math.floor(seed * 3)), { cast: false });
          }
        }
      }
    }
    // Interior floor for cut-aways, and a roof for full houses.
    const iw = hx1 - hx0;
    const id = hz1 - hz0;
    const floor = new THREE.PlaneGeometry(iw - 0.6, id - 0.6);
    floor.rotateX(-Math.PI / 2);
    const fuv = floor.attributes.uv;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * iw / 1.1, fuv.getY(i) * id / 1.1);
    // Cut-away: an interior floor and a furnished dollhouse inside the low walls.
    house.cut.add(floor.clone(), ruined ? libMat('floor_rubble', 0x9a8a78, { grime: 0, amount: 0.22 }) : libMat('hd_flags', 0xb8ab98, { grime: 0, amount: 0.22, ns: 1.2 }), { p: [(hx0 + hx1) / 2, 0.02, (hz0 + hz1) / 2] }, { cast: false });
    // The unplayable interior recedes into shadow: one even dark veil over the
    // whole floor (it reads as the shade inside the walls, not a lit room).
    house.cut.add(new THREE.PlaneGeometry(iw - 0.5, id - 0.5).rotateX(-Math.PI / 2), interiorVeil, { p: [(hx0 + hx1) / 2, 0.04, (hz0 + hz1) / 2] }, { cast: false, receive: false });
    // Interior gloom: a soft dark gradient creeping in from every wall foot
    // (rooms read as roofless shadowed shells, not lit display boxes).
    for (const [cx, cz, w, d, rot] of [[(hx0 + hx1) / 2, hz0 + 0.95, iw - 0.4, 1.5, 0], [(hx0 + hx1) / 2, hz1 - 0.95, iw - 0.4, 1.5, Math.PI], [hx0 + 0.95, (hz0 + hz1) / 2, id - 0.4, 1.5, Math.PI / 2], [hx1 - 0.95, (hz0 + hz1) / 2, id - 0.4, 1.5, -Math.PI / 2]]) {
      house.cut.add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), gloomMat, { p: [cx, 0.035, cz], r: [0, rot, 0] }, { cast: false, receive: false });
    }
    // Debris across the floor: fallen masonry, a snapped beam, broken boards.
    for (let k = 0; k < Math.round(iw * id * 0.16); k++) {
      const px = hx0 + 0.5 + hash(k, 21, seed * 37) * (iw - 1);
      const pz = hz0 + 0.5 + hash(k, 22, seed * 37) * (id - 1);
      const kind = hash(k, 23, seed * 37);
      if (kind < 0.55) house.cut.add(rockGeo(hash(k, 24, seed), 0.08 + hash(k, 25, seed) * 0.14), heapMat, { p: [px, 0.03, pz] }, { cast: false });
      else if (kind < 0.85) house.cut.add(worldBox(0.6 + hash(k, 26, seed) * 0.7, 0.03, 0.14, 1), woodMat, { p: [px, 0.05, pz], r: [0, hash(k, 27, seed) * 3, (hash(k, 28, seed) - 0.5) * 0.15] }, { cast: false });
      else house.cut.add(worldBox(0.2, 0.2, 1.6 + hash(k, 29, seed), 1), darkWood, { p: [px, 0.12, pz], r: [0.1, hash(k, 30, seed) * 3, 0.12] });
    }
    // The fallen roof: rafters slumped from the wall heads onto the floor,
    // heaps of broken tiles and plaster, a tie-beam across the room and the
    // household's wreckage — the gutted shell reads as a ruin, not a void.
    {
      const alongX = iw >= id;
      const nR = Math.max(2, Math.round((alongX ? iw : id) / 1.6));
      for (let k = 0; k < nR; k++) {
        if (hash(k, 41, seed * 13) < 0.3) continue;
        const u = (k + 0.5) / nR;
        const side = hash(k, 42, seed * 13) > 0.5 ? 1 : -1;
        const len2 = Math.min(alongX ? id : iw, 3.2) * (0.7 + hash(k, 43, seed) * 0.3);
        const tilt = 0.35 + hash(k, 44, seed) * 0.3;
        const ax = alongX ? hx0 + 0.4 + u * (iw - 0.8) : (side > 0 ? hx0 + 0.3 : hx1 - 0.3) + side * Math.cos(tilt) * len2 * 0.5;
        const az = alongX ? (side > 0 ? hz0 + 0.3 : hz1 - 0.3) + side * Math.cos(tilt) * len2 * 0.5 : hz0 + 0.4 + u * (id - 0.8);
        const yaw2 = (alongX ? 0 : Math.PI / 2) + (hash(k, 45, seed) - 0.5) * 0.35;
        const g = worldBox(0.16, 0.16, len2, 1);
        g.rotateX(side * tilt * (alongX ? 1 : -1));
        house.cut.add(g, darkWood, { p: [ax, Math.sin(tilt) * len2 * 0.5, az], r: [0, yaw2, 0] });
      }
      // Tile and plaster heaps where the roof came down.
      for (let k = 0; k < Math.round(iw * id * 0.05) + 1; k++) {
        const px = hx0 + 0.7 + hash(k, 51, seed * 41) * (iw - 1.4);
        const pz = hz0 + 0.7 + hash(k, 52, seed * 41) * (id - 1.4);
        const sz = 0.3 + hash(k, 53, seed) * 0.3;
        house.cut.add(rockGeo(hash(k, 54, seed), sz), heapMat, { p: [px, -sz * 0.2, pz], s: [1.4, 0.6, 1.2] }, { cast: false });
        for (let j = 0; j < 3; j++) {
          const a = hash(k * 7 + j, 55, seed) * Math.PI * 2;
          const rr = sz * (0.25 + hash(k * 7 + j, 56, seed) * 0.6);
          house.cut.add(worldBox(0.22, 0.02, 0.15, 1), heapMat, { p: [px + Math.cos(a) * rr, 0.06 + hash(j, k, 57) * sz * 0.35, pz + Math.sin(a) * rr], r: [(hash(j, k, 58) - 0.5) * 0.9, a, (hash(j, k, 59) - 0.5) * 0.9] }, { cast: false });
        }
      }
      // A tie-beam fallen across the room, one end propped on rubble.
      house.cut.add(worldBox(0.26, 0.26, Math.min(alongX ? iw : id, 4.5) * 0.85, 1), darkWood, { p: [(hx0 + hx1) / 2 + (hash(seed, 61, 1) - 0.5) * iw * 0.3, 0.3, (hz0 + hz1) / 2 + (hash(seed, 62, 1) - 0.5) * id * 0.3], r: [0.12, alongX ? Math.PI / 2 + 0.25 : 0.25, 0] });
      // The household's wreckage: an overturned table and a barrel or two.
      const tx = hx0 + 1.1 + hash(seed, 63, 2) * Math.max(0, iw - 2.2);
      const tz = hz0 + 1.1 + hash(seed, 64, 2) * Math.max(0, id - 2.2);
      house.cut.add(worldBox(1.4, 0.07, 0.8, 1), woodMat, { p: [tx, 0.42, tz], r: [Math.PI / 2 - 0.15, hash(seed, 65, 2) * 3, 0] });
      for (const [dx, dz] of [[0.25, 0.5], [-0.3, 0.55]]) house.cut.add(turnedLeg(0.7, 0.05), darkWood, { p: [tx + dx, 0.05, tz + dz], r: [Math.PI / 2, 0, 0.2] }, { cast: false });
      const bx = hx0 + 0.75 + hash(seed, 66, 3) * Math.max(0, iw - 1.5);
      const bz = hz0 + 0.75 + hash(seed, 67, 3) * Math.max(0, id - 1.5);
      house.cut.add(barrelGeo(), barrelMat, { p: [bx, 0, bz], s: 0.85 });
      house.cut.add(barrelHoops(), ironMat, { p: [bx, 0, bz], s: 0.85 });
      house.cut.add(barrelGeo().rotateZ(Math.PI / 2), barrelMat, { p: [bx + 0.7, 0.3, bz + 0.3], r: [0, 0.6, 0], s: 0.8 }, { cast: false });
    }
    // A standing house seen in cut-away is a ransacked home: partitions,
    // hearth, beds, tables, shelves and chests along its walls.
    if (!ruined) furnish(house, iw, id);
    if (ruined) {
      // A gutted ruin has been open to the sky for years: big mounds of fallen
      // masonry against the walls, a stub of the old partition, smashed roof
      // tiles fanned across the boards, and weeds and saplings colonising the
      // corners — a lived-in, overgrown wreck rather than an empty floor.
      const tileMat = pbr('roof', 0xb07a5a);
      for (let k = 0; k < 3 + Math.round(iw * id * 0.03); k++) {
        const side = Math.floor(hash(k, 81, seed * 19) * 4);
        const u = 0.15 + hash(k, 82, seed * 19) * 0.7;
        const px = side === 0 ? hx0 + 0.75 : side === 1 ? hx1 - 0.75 : hx0 + u * iw;
        const pz = side === 2 ? hz0 + 0.75 : side === 3 ? hz1 - 0.75 : hz0 + u * id;
        const sz = 0.5 + hash(k, 83, seed) * 0.45;
        house.cut.add(rockGeo(hash(k, 84, seed) * 50, sz), k % 2 ? heapMat : rubbleMat, { p: [px, -sz * 0.25, pz], s: [1.5, 0.75, 1.3], r: [0, hash(k, 85, seed) * 3, 0] });
        for (let j = 0; j < 7; j++) {
          const a = hash(k * 11 + j, 86, seed) * Math.PI * 2;
          const rr = sz * (0.8 + hash(k * 11 + j, 87, seed) * 0.9);
          const r2 = 0.08 + hash(k * 11 + j, 88, seed) * 0.16;
          house.cut.add(rockGeo(hash(j, k, 89) * 70, r2), j % 3 ? heapMat : rubbleMat, { p: [px + Math.cos(a) * rr, r2 * 0.3, pz + Math.sin(a) * rr] }, { cast: j < 2 });
        }
      }
      // Smashed roof tiles fanned over the floor.
      for (let k = 0; k < Math.round(iw * id * 0.9); k++) {
        const px = hx0 + 0.5 + hash(k, 91, seed * 23) * (iw - 1);
        const pz = hz0 + 0.5 + hash(k, 92, seed * 23) * (id - 1);
        house.cut.add(worldBox(0.2, 0.018, 0.14, 1), tileMat, { p: [px, 0.04, pz], r: [(hash(k, 93, seed) - 0.5) * 0.5, hash(k, 94, seed) * 3, (hash(k, 95, seed) - 0.5) * 0.5] }, { cast: false });
      }
      // Weeds and young elder bushes colonising the corners and wall feet.
      for (let k = 0; k < 6 + Math.round((iw + id) * 0.8); k++) {
        const side = Math.floor(hash(k, 101, seed * 29) * 4);
        const u = hash(k, 102, seed * 29);
        const off = 0.45 + hash(k, 103, seed) * 0.5;
        const px = side === 0 ? hx0 + off : side === 1 ? hx1 - off : hx0 + 0.4 + u * (iw - 0.8);
        const pz = side === 2 ? hz0 + off : side === 3 ? hz1 - off : hz0 + 0.4 + u * (id - 0.8);
        const sc = 0.8 + hash(k, 104, seed) * 0.9;
        house.cut.add(weedGeo(k % 5 === 4 ? 'rosette' : k % 3 ? 'grass' : 'dry', Math.floor(hash(k, 105, seed) * 9) + 1), ruinWeedMat, { p: [px, 0.02, pz], r: [0, hash(k, 106, seed) * 6, 0], s: sc }, { cast: false });
      }
      for (let k = 0; k < 2; k++) {
        // A bushy sapling rooted in a corner (clustered leafy blobs on a crooked stem).
        const cx = k ? hx1 - 0.7 : hx0 + 0.7;
        const cz = hash(k, 111, seed) > 0.5 ? hz1 - 0.7 : hz0 + 0.7;
        house.cut.add(new THREE.CylinderGeometry(0.03, 0.05, 0.9, 5), darkWood, { p: [cx, 0.45, cz], r: [0.15, 0, 0.1] });
        for (let j = 0; j < 6; j++) {
          const a = hash(j, k, 112 + seed) * Math.PI * 2;
          const rr = 0.12 + hash(j, k, 113) * 0.25;
          house.cut.add(rockGeo(j * 7 + k, 0.2 + hash(j, k, 114) * 0.12), leafMat, { p: [cx + Math.cos(a) * rr, 0.75 + hash(j, k, 115) * 0.35, cz + Math.sin(a) * rr], s: [1, 0.8, 1] });
        }
      }
    }
    if (!ruined) {
      const alongX = iw >= id;
      const span = alongX ? id : iw;
      const len = alongX ? iw : id;
      const rise = span * 0.42;
      const over = 0.45;
      const roofM = style === 1 && seed > 0.5 ? thatchMat : seed < 0.4 ? slateMat : roofMat;
      for (const side of [-1, 1]) {
        const slope = Math.hypot(span / 2 + over, rise);
        const g = new THREE.PlaneGeometry(len + over * 2, slope);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len + over * 2) / 3.2, uv.getY(i) * slope / 3.2);
        const ang = Math.atan2(rise, span / 2 + over);
        g.rotateX(-Math.PI / 2);
        g.rotateX(side * ang);
        g.translate(0, rise / 2, side * (span / 2 + over) / 2);
        if (!alongX) g.rotateY(Math.PI / 2);
        house.full.add(g, roofM, { p: [(hx0 + hx1) / 2, height - 0.05, (hz0 + hz1) / 2] });
        // Underside so the eaves aren't see-through.
        const gu = g.clone();
        gu.scale(1, 1, 1);
        const idx = gu.index.array;
        for (let i = 0; i < idx.length; i += 3) [idx[i], idx[i + 2]] = [idx[i + 2], idx[i]];
        gu.computeVertexNormals();
        house.full.add(gu, darkWood, { p: [(hx0 + hx1) / 2, height - 0.07, (hz0 + hz1) / 2] }, { cast: false });
        // Tile courses: shallow lips across the slope give the roof real relief.
        if (roofM !== thatchMat) {
          const rows = Math.floor(slope / 0.42);
          for (let k = 1; k < rows; k++) {
            const u = k / rows;
            const lip = worldBox(len + over * 2, 0.045, 0.07, 3);
            const yy = rise * (1 - u) - 0.0 + 0.03;
            const zz = side * (u * (span / 2 + over));
            const m4 = new THREE.Matrix4().makeRotationX(side * ang);
            lip.applyMatrix4(m4);
            lip.translate(0, yy, zz);
            if (!alongX) lip.rotateY(Math.PI / 2);
            house.full.add(lip, roofM, { p: [(hx0 + hx1) / 2, height - 0.02, (hz0 + hz1) / 2] }, { cast: false });
          }
        }
        // Fascia board along the eave.
        const fas = worldBox(len + over * 2, 0.16, 0.05, 1);
        fas.translate(0, -0.06, side * (span / 2 + over));
        if (!alongX) fas.rotateY(Math.PI / 2);
        house.full.add(fas, darkWood, { p: [(hx0 + hx1) / 2, height - 0.05, (hz0 + hz1) / 2] }, { cast: false });
      }
      // Bargeboards up the gable edges.
      for (const end of [-1, 1]) {
        for (const side of [-1, 1]) {
          const slope = Math.hypot(span / 2 + over, rise);
          const bb = worldBox(0.06, 0.18, slope, 1);
          bb.rotateX(side * Math.atan2(rise, span / 2 + over));
          bb.translate(end * (len / 2 + over), rise / 2, side * (span / 2 + over) / 2);
          if (!alongX) bb.rotateY(Math.PI / 2);
          house.full.add(bb, darkWood, { p: [(hx0 + hx1) / 2, height - 0.02, (hz0 + hz1) / 2] }, { cast: false });
        }
      }
      // Gable ends.
      for (const end of [-1, 1]) {
        const shp = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, rise)]);
        const g = new THREE.ShapeGeometry(shp);
        const uv = g.attributes.uv;
        const pos = g.attributes.position;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2.6, pos.getY(i) / 2.6);
        if (end < 0) g.rotateY(Math.PI);
        g.translate(0, 0, end * len / 2);
        if (!alongX) g.rotateY(Math.PI / 2);
        house.full.add(g, wallMat, { p: [(hx0 + hx1) / 2, height - 0.02, (hz0 + hz1) / 2] });
      }
      // Ridge capped with half-round ridge tiles.
      const ridge = worldBox(alongX ? len + over * 2 : 0.22, 0.22, alongX ? 0.22 : len + over * 2, 1);
      house.full.add(ridge, darkWood, { p: [(hx0 + hx1) / 2, height + rise, (hz0 + hz1) / 2] });
      if (roofM !== thatchMat) {
        const rt = new THREE.CylinderGeometry(0.15, 0.15, len + over * 2, 10, 1, false, 0, Math.PI);
        rt.rotateZ(Math.PI / 2);
        if (!alongX) rt.rotateY(Math.PI / 2);
        house.full.add(rt, roofM, { p: [(hx0 + hx1) / 2, height + rise + 0.06, (hz0 + hz1) / 2] }, { cast: false });
      }
      if (seed > 0.35) {
        const cx = alongX ? hx0 + iw * (0.2 + seed * 0.5) : (hx0 + hx1) / 2 + span * 0.2;
        const cz = alongX ? (hz0 + hz1) / 2 + span * 0.2 : hz0 + id * (0.2 + seed * 0.5);
        house.full.add(worldBox(0.7, rise + 1.4, 0.7, 2), plinthMat, { p: [cx, height + (rise + 1.4) / 2 - 0.2, cz] });
        house.full.add(worldBox(0.84, 0.15, 0.84, 2), capMat, { p: [cx, height + rise + 1.2, cz] });
        house.chimney = { x: cx, y: height + rise + 1.3, z: cz };
      }
    } else {
      // Ruin: rubble heaps inside & a dark floor.
      for (let k = 0; k < 6; k++) {
        const px = hx0 + 0.5 + hash(k, 11, seed * 7) * (iw - 1);
        const pz = hz0 + 0.5 + hash(k, 12, seed * 7) * (id - 1);
        house.full.add(rockGeo(hash(k, 13, seed), 0.4 + hash(k, 14, seed) * 0.5), capMat, { p: [px, 0.1, pz] });
      }
      house.full.add(floor.clone(), libMat('floor_rubble', 0x9a8a7a), { p: [(hx0 + hx1) / 2, 0.02, (hz0 + hz1) / 2] }, { cast: false });
    }
    // The house has content solid under roofs; a dark core block keeps shadow casting honest.
    return house;
  }

  /** Dollhouse interiors for cut-away houses: partitions, beds, tables, hearths, rugs. */
  function furnish(house, iw, id) {
    const B = house.cut;
    const { x0, z0, x1, z1, seed } = house;
    const inset = 0.45;
    const ix0 = x0 + inset;
    const iz0 = z0 + inset;
    const ix1 = x1 - inset;
    const iz1 = z1 - inset;
    const occ = [];
    const free = (ax, az, bx, bz) => ax >= ix0 && az >= iz0 && bx <= ix1 && bz <= iz1 && !occ.some((o) => ax < o[2] && bx > o[0] && az < o[3] && bz > o[1]);
    const take = (ax, az, bx, bz) => occ.push([ax - 0.15, az - 0.15, bx + 0.15, bz + 0.15]);
    const cutH = 1.1 + seed * 0.25;
    // Partition walls along the map-cell lines split big houses into rooms, each with a doorway.
    const partition = (alongX, at, a0, a1, salt) => {
      const span = a1 - a0;
      const door = 0.25 + hash(salt, 2, seed * 91) * 0.5;
      const dw = 1.1 / span;
      for (const [a, b] of [[0, door - dw / 2], [door + dw / 2, 1]]) {
        const len = (b - a) * span;
        if (len < 0.2) continue;
        const mid = a0 + ((a + b) / 2) * span;
        // Partition: broken like the outer walls, placed along x (or z).
        const sx = alongX ? at : mid - len / 2;
        const sz = alongX ? mid - len / 2 : at;
        const yaw = alongX ? -Math.PI / 2 : 0;
        const pl = (g, lx, ly, lz = 0) => {
          const m = new THREE.Matrix4().makeRotationY(yaw);
          m.setPosition(sx + Math.cos(yaw) * lx + Math.sin(yaw) * (lz + 0.1), ly, sz - Math.sin(yaw) * lx + Math.cos(yaw) * (lz + 0.1));
          return g.applyMatrix4(m);
        };
        brokenWall(B, pl, len, cutH * 0.7, salt * 13 + Math.floor(a * 100), wallMats[house.style === 1 ? 1 : 0], { thick: 0.2, debris: false });
      }
      if (alongX) take(at - 0.12, a0, at + 0.12, a0 + span * (door - dw / 2)), take(at - 0.12, a0 + span * (door + dw / 2), at + 0.12, a1);
      else take(a0, at - 0.12, a0 + span * (door - dw / 2), at + 0.12), take(a0 + span * (door + dw / 2), at - 0.12, a1, at + 0.12);
    };
    const [rx0, ry0, rx1, ry1] = house.r;
    for (let mx = rx0 + 1; mx <= rx1; mx++) partition(true, cw(mx), z0, z1, mx * 7);
    for (let my = ry0 + 1; my <= ry1; my++) partition(false, ch(my), x0, x1, my * 13);
    // Hearth against a wall.
    const hearthSide = Math.floor(hash(3, 4, seed * 17) * 4);
    const hx = hearthSide === 0 ? ix0 + 0.5 : hearthSide === 1 ? ix1 - 0.5 : (ix0 + ix1) / 2;
    const hz = hearthSide === 2 ? iz0 + 0.5 : hearthSide === 3 ? iz1 - 0.5 : (iz0 + iz1) / 2;
    if (free(hx - 0.7, hz - 0.7, hx + 0.7, hz + 0.7)) {
      B.add(worldBox(1.3, 0.5, 1.3, 1.5), plinthMat, { p: [hx, 0.25, hz] });
      B.add(worldBox(0.9, 0.08, 0.9, 1.5), pbr('glow', 0x100400, { emissive: 0xff4a10, emissiveIntensity: night ? 2.2 : 0.8 }), { p: [hx, 0.52, hz] }, { cast: false });
      for (let k = 0; k < 3; k++) B.add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6).rotateZ(Math.PI / 2).rotateY(k * 1.1), darkWood, { p: [hx, 0.6, hz] });
      take(hx - 0.7, hz - 0.7, hx + 0.7, hz + 0.7);
      house.hearth = { x: hx, y: 0.7, z: hz };
    }
    // Furniture pieces placed along the walls.
    const blanket = [0x7a2a24, 0x2a4a7a, 0x4a6a2a, 0x6a4a1a][Math.floor(seed * 4)];
    const nRooms = (house.r[2] - house.r[0] + 1) * (house.r[3] - house.r[1] + 1);
    const base = ['bed', 'table', 'barrels', 'chest', 'shelf', 'crates'];
    const pieces = [];
    // One table per house at most (several identical laid tables read as a copy-paste).
    let tables = 0;
    for (let k = 0; k < Math.min(18, 3 + nRooms * 3); k++) {
      let kind = base[Math.floor(hash(k, 5, seed * 333) * base.length)];
      if (kind === 'table' && tables++ >= 1) kind = ['barrels', 'chest', 'crates', 'shelf'][k % 4];
      pieces.push(kind);
    }
    let tries = 0;
    for (const kind of pieces) {
      for (let k = 0; k < 12 && tries < 200; k++, tries++) {
        const r1 = hash(tries, 7, seed * 1000);
        const r2 = hash(tries, 8, seed * 1000);
        const side = Math.floor(r1 * 4);
        const w = kind === 'bed' ? 1.0 : kind === 'table' ? 1.5 : kind === 'shelf' ? 1.2 : 0.9;
        const d = kind === 'bed' ? 2.0 : kind === 'table' ? 1.0 : kind === 'shelf' ? 0.4 : 0.8;
        const vert = side < 2; // along W/E walls: long axis along z
        const ww = vert ? d : w;
        const dd = vert ? w : d;
        const cx = side === 0 ? ix0 + ww / 2 : side === 1 ? ix1 - ww / 2 : ix0 + ww / 2 + r2 * Math.max(0, (ix1 - ix0) - ww);
        const cz = side === 2 ? iz0 + dd / 2 : side === 3 ? iz1 - dd / 2 : iz0 + dd / 2 + r2 * Math.max(0, (iz1 - iz0) - dd);
        if (kind === 'table') {
          // Tables stand free in the room.
          const tx = ix0 + 1 + r1 * Math.max(0, ix1 - ix0 - 2);
          const tz = iz0 + 1 + r2 * Math.max(0, iz1 - iz0 - 2);
          if (!free(tx - 1.1, tz - 0.9, tx + 1.1, tz + 0.9)) continue;
          B.add(worldBox(1.5, 0.08, 0.85, 1), woodMat, { p: [tx, 0.76, tz] });
          for (const [dx, dz] of [[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]]) B.add(turnedLeg(0.72, 0.05), darkWood, { p: [tx + dx, 0, tz + dz] });
          // Apron rails under the top.
          B.add(worldBox(1.3, 0.1, 0.04, 1), darkWood, { p: [tx, 0.67, tz - 0.32] }, { cast: false });
          B.add(worldBox(1.3, 0.1, 0.04, 1), darkWood, { p: [tx, 0.67, tz + 0.32] }, { cast: false });
          for (const [dx, dz] of [[-0.4, -0.75], [0.4, 0.75], [0.0, -0.75]]) {
            B.add(worldBox(0.42, 0.06, 0.42, 1), woodMat, { p: [tx + dx, 0.46, tz + dz] });
            for (const [ex, ez] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) B.add(turnedLeg(0.44, 0.03), darkWood, { p: [tx + dx + ex, 0, tz + dz + ez], r: [ex * 0.5, 0, -ez * 0.5] }, { cast: false });
          }
          // Tankard and candle.
          B.add(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), ironMat, { p: [tx + 0.3, 0.86, tz + 0.1] }, { cast: false });
          B.add(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), pbr('glow', 0xeee0c0, { emissive: 0xffb050, emissiveIntensity: night ? 1.5 : 0.2 }), { p: [tx - 0.2, 0.87, tz - 0.1] }, { cast: false });
          take(tx - 1.1, tz - 0.9, tx + 1.1, tz + 0.9);
          break;
        }
        if (!free(cx - ww / 2, cz - dd / 2, cx + ww / 2, cz + dd / 2)) continue;
        if (kind === 'bed') {
          // Frame with posts, a soft rounded mattress, a pillow and a blanket
          // that drapes over the sides.
          B.add(worldBox(ww, 0.12, dd, 1), darkWood, { p: [cx, 0.26, cz] });
          for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(turnedLeg(0.62, 0.045), darkWood, { p: [cx + px * (ww / 2 - 0.05), 0, cz + pz * (dd / 2 - 0.05)] });
          const head = vert ? [0, -1] : [-1, 0];
          B.add(worldBox(vert ? ww : 0.06, 0.4, vert ? 0.06 : dd, 1), darkWood, { p: [cx + head[0] * (ww / 2 - 0.03), 0.5, cz + head[1] * (dd / 2 - 0.03)] });
          B.add(softSlab(ww - 0.08, 0.16, dd - 0.08), linenMat, { p: [cx, 0.4, cz] });
          const bx = vert ? ww + 0.06 : ww * 0.62;
          const bz = vert ? dd * 0.62 : dd + 0.06;
          B.add(drape(bx, bz, 0.22), pbr('cloth', blanket), { p: [cx - head[0] * ww * 0.18, 0.5, cz - head[1] * dd * 0.18] }, { cast: false });
          B.add(softSlab(vert ? 0.62 : 0.34, 0.12, vert ? 0.34 : 0.62), linenMat, { p: [cx + head[0] * (ww / 2 - 0.26), 0.53, cz + head[1] * (dd / 2 - 0.26)] }, { cast: false });
        } else if (kind === 'barrels') {
          B.add(barrelGeo(), barrelMat, { p: [cx - 0.2, 0, cz], s: 0.9 });
          B.add(barrelHoops(), ironMat, { p: [cx - 0.2, 0, cz], s: 0.9 });
          if (r2 > 0.4) B.add(barrelGeo(), barrelMat, { p: [cx + 0.35, 0, cz + 0.2], s: 0.75 });
        } else if (kind === 'chest') {
          B.add(worldBox(ww * 0.8, 0.42, dd * 0.7, 1), woodMat, { p: [cx, 0.21, cz] });
          // Barrel-vaulted lid and iron straps.
          const lid = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
          lid.scale(vert ? dd * 0.35 : ww * 0.8, 0.14, vert ? ww * 0.8 : dd * 0.35);
          if (vert) lid.rotateY(Math.PI / 2);
          B.add(lid, woodMat, { p: [cx, 0.42, cz] });
          for (const o of [-0.3, 0.3]) B.add(worldBox(vert ? dd * 0.74 : 0.05, 0.6, vert ? 0.05 : dd * 0.74, 1), ironMat, { p: [cx + (vert ? 0 : o * ww * 0.8), 0.27, cz + (vert ? o * ww * 0.8 : 0)] }, { cast: false });
        } else if (kind === 'shelf') {
          B.add(worldBox(ww, 1.9, dd, 1), darkWood, { p: [cx, 0.95, cz] });
          for (let k2 = 0; k2 < 6; k2++) B.add(worldBox(0.12, 0.22, 0.12, 1), k2 % 2 ? barrelMat : pbr('cloth', 0x8a6a4a), { p: [cx + (vert ? 0 : (k2 - 2.5) * 0.18), 0.5 + (k2 % 3) * 0.5, cz + (vert ? (k2 - 2.5) * 0.18 : 0)] }, { cast: false });
        } else if (kind === 'crates') {
          B.add(worldBox(0.7, 0.7, 0.7, 1.2), crateMat, { p: [cx, 0.35, cz], r: [0, r1, 0] });
          B.add(crateFrame(0.7), darkWood, { p: [cx, 0.35, cz], r: [0, r1, 0] });
        }
        take(cx - ww / 2, cz - dd / 2, cx + ww / 2, cz + dd / 2);
        break;
      }
    }
    // Rugs in some rooms.
    for (let mx = rx0; mx <= rx1; mx++) {
      for (let my = ry0; my <= ry1; my++) {
        if (hash(mx, my, seed * 71) > 0.3) continue;
        const rug = new THREE.PlaneGeometry(2.2, 1.5).rotateX(-Math.PI / 2);
        B.add(rug, rugMaterial(Math.floor(hash(mx, my, 3) * 3)), { p: [cw(mx) + CELLM / 2, 0.04, ch(my) + CELLM / 2], r: [0, hash(mx, my, 9) > 0.5 ? Math.PI / 2 : 0, 0] }, { cast: false });
      }
    }
  }

  // ---------------------------------------------------------------- edge walls in the field
  const edgeWalls = [];
  for (const e of field.features.edgeWalls ?? []) {
    const style = e.style;
    const mat = wallMats[style] ?? wallMats[0];
    const ruined = style === 2;
    // Wall runs along the E or S side of cell (cx,cy) (window coords).
    const x0 = e.cx * CELLM;
    const z0 = e.cy * CELLM;
    const horiz = e.dir === 'S';
    const ox = horiz ? x0 : x0 + CELLM;
    const oz = horiz ? z0 + CELLM : z0;
    const gap = e.type === EDGE.DOOR || e.type === EDGE.ARCH;
    const wall = { horiz, full: new Batcher(), cut: new Batcher(), e, low: true };
    for (const variant of ['full', 'cut']) {
      const B = wall[variant];
      const segs = [];
      if (gap) segs.push([0, TILE - 0.05], [TILE * 2 + 0.05, CELLM]);
      else segs.push([0, CELLM]);
      for (const [a, b] of segs) {
        const n = Math.max(1, Math.round((b - a) / 0.75));
        for (let k = 0; k < n; k++) {
          const sa = a + ((b - a) * k) / n;
          const sl = (b - a) / n;
          const base = variant === 'cut' ? 0.95 : ruined ? 1.3 : 2.8;
          const hh = ruined ? base * (0.5 + hash(e.cx * 7 + k, e.cy * 3 + (horiz ? 1 : 0), 17) * 0.8) : base;
          // Thick fortified walls under broad capstones.
          const g = worldBox(horiz ? sl + 0.01 : 0.66, hh, horiz ? 0.66 : sl + 0.01, 2.5);
          B.add(g, mat, { p: [horiz ? ox + sa + sl / 2 : ox, hh / 2, horiz ? oz : oz + sa + sl / 2] });
          if (!ruined || variant === 'cut') {
            B.add(worldBox(horiz ? sl + 0.02 : 0.76, 0.06, horiz ? 0.76 : sl + 0.02, 2.5), plinthMat, { p: [horiz ? ox + sa + sl / 2 : ox, hh + 0.03, horiz ? oz : oz + sa + sl / 2] });
            B.add(worldBox(horiz ? sl - 0.015 : 0.9, 0.16, horiz ? 0.9 : sl - 0.015, 2.5), capMat, { p: [horiz ? ox + sa + sl / 2 : ox, hh + 0.14, horiz ? oz : oz + sa + sl / 2] });
          }
        }
      }
      if (gap && e.type === EDGE.ARCH && variant === 'full') {
        // Stone arch over the gap.
        const ax = horiz ? ox + TILE * 1.5 : ox;
        const az = horiz ? oz : oz + TILE * 1.5;
        const arch = new THREE.TorusGeometry(TILE / 2 + 0.1, 0.22, 6, 14, Math.PI);
        arch.scale(1, 1, 1.8);
        if (!horiz) arch.rotateY(Math.PI / 2);
        B.add(arch, plinthMat, { p: [ax, 2.4, az] });
        B.add(worldBox(horiz ? TILE + 0.6 : 0.5, 0.6, horiz ? 0.5 : TILE + 0.6, 2.5), mat, { p: [ax, 3.35, az] });
      }
      if (gap && e.type === EDGE.DOOR && variant === 'full') {
        // An open door leaf swung inward.
        const ax = horiz ? ox + TILE - 0.05 : ox;
        const az = horiz ? oz : oz + TILE - 0.05;
        const leaf = worldBox(horiz ? 0.08 : 1.3, 2.1, horiz ? 1.3 : 0.08, 1.2);
        leaf.translate(horiz ? 0 : 0.65, 1.05, horiz ? 0.65 : 0);
        B.add(leaf, doorMat, { p: [ax, 0, az], r: [0, horiz ? -0.5 : 0.5, 0] });
      }
      if (ruined && variant === 'full') {
        for (let k = 0; k < 3; k++) {
          const t = hash(e.cx, e.cy * 5 + k, 23) * CELLM;
          const off = (hash(e.cx * 3, e.cy + k, 29) - 0.5) * 1.6;
          B.add(rockGeo(hash(k, e.cx, e.cy), 0.25 + hash(e.cy, k, 31) * 0.3), capMat, { p: [horiz ? ox + t : ox + off, 0.08, horiz ? oz + off : oz + t] });
        }
      }
    }
    edgeWalls.push(wall);
  }

  // ---------------------------------------------------------------- city wall beyond the map border
  if (map) {
    const wallMat = libMat('wall_stone', 0x7a746c);
    const borderCells = [];
    for (let my = cellY0; my < cellY0 + cellsH; my++) {
      for (let mx = cellX0; mx < cellX0 + cellsW; mx++) {
        if (!inMap(mx, my)) continue;
        for (const [d, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
          if (inMap(mx + dx, my + dy)) continue;
          borderCells.push({ mx, my, d, gate: map.getEdge(mx, my, d) === EDGE.ARCH });
        }
      }
    }
    for (const b of borderCells) {
      const horiz = b.d === 'N' || b.d === 'S';
      const x = cw(b.mx) + (b.d === 'E' ? CELLM + 0.9 : b.d === 'W' ? -0.9 : CELLM / 2);
      const z = ch(b.my) + (b.d === 'S' ? CELLM + 0.9 : b.d === 'N' ? -0.9 : CELLM / 2);
      const hh = 6.5;
      const w = CELLM + 0.02;
      const wall = { horiz, city: true, full: new Batcher(), cut: new Batcher(), e: { dir: b.d } };
      for (const variant of ['full', 'cut']) {
        const B = wall[variant];
        const h2 = variant === 'cut' ? 1.3 : hh;
        if (b.gate) {
          for (const sgn of [-1, 1]) B.add(worldBox(horiz ? 1.3 : 1.8, h2, horiz ? 1.8 : 1.3, 2.5), wallMat, { p: [x + (horiz ? sgn * (CELLM / 2 - 0.65) : 0), h2 / 2, z + (horiz ? 0 : sgn * (CELLM / 2 - 0.65))] });
          if (variant === 'full') {
            const arch = new THREE.TorusGeometry(CELLM / 2 - 1.3, 0.5, 6, 16, Math.PI);
            arch.scale(1, 1.2, 3.4);
            if (!horiz) arch.rotateY(Math.PI / 2);
            B.add(arch, plinthMat, { p: [x, 3.6, z] });
            B.add(worldBox(horiz ? w : 1.8, 2.2, horiz ? 1.8 : w, 2.5), wallMat, { p: [x, hh - 1.1, z] });
          }
        } else {
          B.add(worldBox(horiz ? w : 1.8, h2, horiz ? 1.8 : w, 2.5), wallMat, { p: [x, h2 / 2, z] });
        }
        if (variant === 'full') {
          // Crenellations.
          for (let k = 0; k < 4; k++) {
            const t = -CELLM / 2 + (k + 0.5) * (CELLM / 4);
            B.add(worldBox(horiz ? 0.6 : 1.9, 0.7, horiz ? 1.9 : 0.6, 2.5), wallMat, { p: [x + (horiz ? t : 0), hh + 0.35, z + (horiz ? 0 : t)] });
          }
        }
      }
      edgeWalls.push(wall);
    }
  }

  // ---------------------------------------------------------------- fortified parapet
  // The fight is held inside a thick, low fortified parapet: chunky ashlar
  // courses with deep dark mortar under a broad pale capstone, running just
  // outside the board along every open rim (where the street runs on), with a
  // gate gap in each long run. It stands off the board (never on a square), so
  // movement, sight and fleeing are unchanged; low enough not to hide figures.
  if (!dungeon) {
    const runs = [];
    const side = (bit, len, sq) => {
      let a = -1;
      for (let k = 0; k <= len; k++) {
        const on = k < len && (field.exitMask[sq(k)] & bit) && !field.block[sq(k)];
        if (on && a < 0) a = k;
        if (!on && a >= 0) { runs.push({ bit, a, b: k }); a = -1; }
      }
    };
    side(1, field.w, (k) => field.idx(k, 0));
    side(4, field.w, (k) => field.idx(k, field.h - 1));
    side(8, field.h, (k) => field.idx(0, k));
    side(2, field.h, (k) => field.idx(field.w - 1, k));
    for (const r of runs) {
      const horiz = r.bit === 1 || r.bit === 4;
      const off = r.bit === 1 ? -PAR_T / 2 - 0.04 : r.bit === 4 ? field.h * TILE + PAR_T / 2 + 0.04 : r.bit === 8 ? -PAR_T / 2 - 0.04 : field.w * TILE + PAR_T / 2 + 0.04;
      const n = r.b - r.a;
      const segs = n >= 7 ? [[r.a, r.a + Math.floor(n / 2) - 1], [r.a + Math.floor(n / 2) + 2, r.b]] : [[r.a, r.b]];
      for (const [sa, sb] of segs) {
        if (sb - sa < 1) continue;
        parapet(horiz, off, sa * TILE - (sa === r.a ? PAR_T : 0), sb * TILE + (sb === r.b ? PAR_T : 0), r.bit, { pierA: sa !== r.a, pierB: sb !== r.b });
      }
    }
  }

  // ---------------------------------------------------------------- props
  const rockMat = libMat('wall_ruin', 0xa89c8c);
  for (const p of field.features.props ?? []) {
    const x = p.x * TILE + TILE / 2;
    const z = p.y * TILE + TILE / 2;
    const r = p.r;
    if (p.type === 'barrel') {
      batch.add(barrelGeo(), barrelMat, { p: [x + (r - 0.5) * 0.3, 0, z], r: [0, r * 6, 0] });
      batch.add(barrelHoops(), ironMat, { p: [x + (r - 0.5) * 0.3, 0, z] });
      if (r < 0.02) batch.add(barrelGeo(), barrelMat, { p: [x + 0.4, 0, z + 0.3], r: [0, r * 9, 0], s: 0.85 });
    } else if (p.type === 'crate') {
      // Kept inside its square (rotation included) so no one standing next to it clips.
      // Rotated half-diagonal stays clear of a neighbouring house plinth.
      // Nudged away from any building beside it (plinths and jetties overhang
      // the square edge) so it never sinks into a facade.
      const s = 0.62 + Math.min(r, 0.08) * 1.5;
      const ry = ((r * 20) % 0.3) - 0.15;
      let ox = 0;
      let oz = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (field.inBounds(nx, ny) && field.block[field.idx(nx, ny)] === 1) { ox -= dx * 0.16; oz -= dy * 0.16; }
      }
      batch.add(worldBox(s, s, s, 1.2), crateMat, { p: [x + ox, s / 2, z + oz], r: [0, ry, 0] });
      batch.add(crateFrame(s), darkWood, { p: [x + ox, s / 2, z + oz], r: [0, ry, 0] });
      if (r > 0.055) batch.add(worldBox(0.5, 0.5, 0.5, 1.2), crateMat, { p: [x + ox + 0.05, s + 0.25, z + oz], r: [0, r * 40, 0] });
    } else if (p.type === 'rubble') {
      for (let k = 0; k < 5; k++) batch.add(rockGeo(hash(p.x, p.y + k, 3), 0.25 + hash(p.x + k, p.y, 4) * 0.35), rockMat, { p: [x + (hash(k, p.x, 5) - 0.5) * 0.9, 0.05, z + (hash(k, p.y, 6) - 0.5) * 0.9] });
    } else if (p.type === 'column') {
      // Fluted columns: some still carry their capital, others snapped off with
      // drums tumbled at the foot.
      const colMat = libMat('hd2_ashlar_cold', 0xdfe2e0, { ns: 0.6 });
      const hallCol = !!field.features.hall;
      const broken = hallCol ? hash(p.x, p.y, 401) < 0.45 : true;
      const hh = broken ? 1.0 + hash(p.x, p.y, 402) * 1.3 : 3.7;
      // Tall columns get their own group so they can dither out when they hide the fight.
      const CB = broken ? batch : new Batcher();
      if (!broken) colBatches.push({ b: CB, x, z, h: hh + 0.8 });
      CB.add(columnGeo(hh, broken, p.x * 7 + p.y), colMat, { p: [x, 0.42, z] });
      CB.add(worldBox(0.98, 0.26, 0.98, 1), plinthMat, { p: [x, 0.13, z] });
      CB.add(new THREE.CylinderGeometry(0.46, 0.5, 0.16, 20), colMat, { p: [x, 0.34, z] });
      if (!broken) {
        CB.add(new THREE.CylinderGeometry(0.5, 0.36, 0.22, 20), colMat, { p: [x, 0.42 + hh + 0.11, z] });
        CB.add(worldBox(1.05, 0.2, 1.05, 1), plinthMat, { p: [x, 0.42 + hh + 0.32, z] });
      } else {
        for (let k = 0; k < 2; k++) {
          const a = hash(p.x, p.y, 410 + k) * Math.PI * 2;
          CB.add(columnGeo(0.42, true, p.x + k * 13), colMat, { p: [x + Math.cos(a) * 0.55, 0.3, z + Math.sin(a) * 0.55], r: [Math.PI / 2, a, 0] });
        }
        for (let k = 0; k < 4; k++) CB.add(rockGeo(hash(k, p.x, p.y), 0.1 + hash(p.y, k, 3) * 0.12), colMat, { p: [x + (hash(k, 1, p.x) - 0.5) * 1.1, 0.04, z + (hash(k, 2, p.y) - 0.5) * 1.1] }, { cast: false });
      }
    } else if (p.type === 'fallen') {
      // A toppled column lying across the square: drums in a broken row + capital.
      const colMat = libMat('hd2_ashlar_cold', 0xd6dad8, { ns: 0.6 });
      const a = 0.4 + hash(p.x, p.y, 420) * 0.5;
      for (let k = 0; k < 3; k++) {
        const d = (k - 1) * 0.62;
        batch.add(columnGeo(0.58, k === 0, p.x * 3 + k), colMat, { p: [x + Math.cos(a) * d, 0.33, z + Math.sin(a) * d], r: [Math.PI / 2, -a + Math.PI / 2 + (k - 1) * 0.08, 0] });
      }
      batch.add(worldBox(0.9, 0.3, 0.9, 1), plinthMat, { p: [x + Math.cos(a) * 1.15, 0.15, z + Math.sin(a) * 1.15], r: [0.2, a, 0.15] });
      for (let k = 0; k < 6; k++) batch.add(rockGeo(hash(k, p.x, 7), 0.08 + hash(k, p.y, 8) * 0.14), colMat, { p: [x + (hash(k, 3, p.x) - 0.5) * 1.3, 0.03, z + (hash(k, 4, p.y) - 0.5) * 1.3] }, { cast: false });
    } else if (p.type === 'debris') {
      for (let k = 0; k < 4; k++) batch.add(worldBox(1.1, 0.06, 0.16, 1), woodMat, { p: [x + (hash(k, 1, p.x) - 0.5) * 0.7, 0.05 + k * 0.05, z + (hash(k, 2, p.y) - 0.5) * 0.7], r: [0, hash(k, 3, p.x) * 3, 0.1] });
    }
  }
  // Weeds grow in clusters only where feet and cartwheels don't reach: along
  // wall bases, kerbs and in rubble (several species: grass, rosettes, dry stalks).
  const weedMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  disposables.push(weedMat);
  const weedKinds = [weedGeo('grass', 1), weedGeo('grass', 2), weedGeo('rosette', 3), weedGeo('dry', 4), weedGeo('clover', 5)];
  const weeds = weedKinds.map(() => []);
  const wallSide = (x, y) => {
    // Unit offset toward the nearest wall/house edge of this square (or null).
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let w = kindAt(x + dx, y + dy) === 'house';
      if (!w && field.inBounds(x, y) && field.inBounds(x + dx, y + dy)) {
        const i0 = field.idx(x, y);
        if (dx === 1) w = !!field.wallE[i0];
        else if (dx === -1) w = !!field.wallE[field.idx(x - 1, y)];
        else if (dy === 1) w = !!field.wallS[i0];
        else w = !!field.wallS[field.idx(x, y - 1)];
      }
      if (w) out.push([dx, dy]);
    }
    return out;
  };
  for (let y = -margin; y < field.h + margin; y++) {
    for (let x = -margin; x < field.w + margin; x++) {
      const k = kindAt(x, y);
      if (k === 'house' || k === 'water' || k === 'room') continue;
      const walls = wallSide(x, y);
      const r = hash(x + 900, y + 900, 41);
      const rubbly = k === 'rubble' || k === 'outside';
      const pRate = walls.length ? 0.55 : rubbly ? 0.22 : 0;
      if (r < pRate) {
        // A cluster hugging the wall foot (or a random spot in rubble).
        const [dx, dy] = walls.length ? walls[Math.floor(hash(x, y, 42) * walls.length)] : [0, 0];
        const along = hash(x, y, 43) - 0.5;
        const cx = x * TILE + TILE / 2 + (dx ? dx * TILE * 0.42 : along * TILE * 0.8);
        const cz = y * TILE + TILE / 2 + (dy ? dy * TILE * 0.42 : (dx ? along * TILE * 0.8 : (hash(x, y, 49) - 0.5) * TILE * 0.8));
        const n = 3 + Math.floor(hash(x, y, 44) * 5);
        const species = rubbly ? (hash(x, y, 45) < 0.5 ? 3 : Math.floor(hash(x, y, 46) * 3)) : Math.floor(hash(x, y, 46) * 5);
        for (let i = 0; i < n; i++) {
          const kk = i === 0 ? species : hash(x + i, y, 47) < 0.65 ? species : Math.floor(hash(i, x, y) * 5);
          const spread = 0.12 + i * 0.05;
          const ox = (dx ? -dx * hash(i, y, 48) * 0.18 : (hash(i, x, 48) - 0.5) * 2 * spread);
          const oz = (dy ? -dy * hash(i, x, 50) * 0.18 : (hash(i, y, 50) - 0.5) * 2 * spread);
          weeds[kk].push([cx + ox + (dy ? (hash(x, i, 51) - 0.5) * 0.6 : 0), cz + oz + (dx ? (hash(y, i, 52) - 0.5) * 0.6 : 0), (0.55 + hash(x + i, y + i, 46) * 0.7) * (i === 0 ? 1.15 : 1), hash(i, x, y) * 6.28]);
        }
      }
      if (hash(x, y, 47) < (k === 'rubble' ? 0.5 : walls.length ? 0.2 : 0.04)) {
        batch.add(rockGeo(hash(x, y, 48), 0.05 + hash(x, y, 49) * 0.1), rockMat, { p: [x * TILE + hash(x, y, 50) * TILE, 0.0, y * TILE + hash(x, y, 51) * TILE] }, { cast: false });
      }
    }
  }
  weeds.forEach((list, kk) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(weedKinds[kk], weedMat, list.length);
    const m = new THREE.Matrix4();
    list.forEach(([x, z, sc, a], i) => {
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(sc, sc, sc));
      inst.setMatrixAt(i, m);
    });
    inst.receiveShadow = true;
    inst.castShadow = false;
    group.add(inst);
  });
  disposables.push(...weedKinds);

  // ---------------------------------------------------------------- torches & braziers
  // Choose torch spots on faces that look onto the fight, spread apart.
  const inField = (x, z) => x > -2 && z > -2 && x < W + 2 && z < H + 2;
  const cands = torchSpots.filter((t) => inField(t.x, t.z));
  const chosen = [];
  const ranked = cands.map((t) => ({ t, k: hash(Math.round(t.x * 3), Math.round(t.z * 3), 61) })).sort((a, b) => a.k - b.k);
  for (const { t } of ranked) {
    if (chosen.length >= 7) break;
    if (chosen.some((c) => Math.hypot(c.x - t.x, c.z - t.z) < 6)) continue;
    chosen.push(t);
  }
  const torches = [];
  for (const t of chosen) {
    // Bracket.
    const bx = t.x - Math.sin(t.yaw) * 0.2;
    const bz = t.z - Math.cos(t.yaw) * 0.2;
    // Bracket and torch belong to the house, so they vanish with its cut-away.
    const B = t.house?.full ?? batch;
    B.add(worldBox(0.08, 0.5, 0.08, 1), ironMat, { p: [bx, t.y - 0.35, bz] }, { cast: false });
    B.add(new THREE.CylinderGeometry(0.06, 0.035, 0.34, 8), darkWood, { p: [t.x, t.y - 0.05, t.z] }, { cast: false });
    B.add(new THREE.CylinderGeometry(0.075, 0.07, 0.08, 8), ironMat, { p: [t.x, t.y + 0.1, t.z] }, { cast: false });
    const f = makeFlame(0.34, torches.length * 1.7);
    f.position.set(t.x, t.y + 0.3, t.z);
    group.add(f);
    flames.push(f);
    const torch = { x: t.x, y: t.y + 0.35, z: t.z, house: t.house, flame: f, yaw: t.yaw };
    torches.push(torch);
    if (t.house) (t.house.torches ??= []).push(torch);
  }
  // Braziers beside walls near the fight (always lit, great for night).
  if (field.features.props) {
    const pcx = (field.partyCell.x - field.cx0) * SUB + 1;
    const pcy = (field.partyCell.y - field.cy0) * SUB + 1;
    const cands = [];
    for (let y = 0; y < field.h; y++) {
      for (let x = 0; x < field.w; x++) {
        const i = field.idx(x, y);
        if (!field.isFree(x, y) || field.exitMask[i]) continue;
        const cell = field.cellOf(x, y);
        if (cell.x === field.partyCell.x && cell.y === field.partyCell.y) continue;
        const nearBlock = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !field.inBounds(x + dx, y + dy) || field.block[field.idx(x + dx, y + dy)] === 1);
        const nearWall = field.wallE[i] || field.wallS[i] || (x > 0 && field.wallE[field.idx(x - 1, y)]) || (y > 0 && field.wallS[field.idx(x, y - 1)]);
        if (!nearBlock && !nearWall) continue;
        const d = Math.hypot(x - pcx, y - pcy);
        // Close beside the party's square: the engagement fights in its pool.
        cands.push({ x, y, score: -Math.abs(d - 3) + hash(x, y, 71) * 1.2 });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const placed = [];
    for (const c of cands) {
      if (placed.length >= 2) break;
      if (placed.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 5)) continue;
      placed.push(c);
      const { x, y } = c;
      field.block[field.idx(x, y)] = 2;
      field.features.props.push({ x, y, type: 'brazier', r: 0 });
      const px = x * TILE + TILE / 2;
      const pz = y * TILE + TILE / 2;
      batch.add(new THREE.CylinderGeometry(0.42, 0.28, 0.32, 14, 1, true), ironMat, { p: [px, 0.95, pz] });
      batch.add(new THREE.TorusGeometry(0.42, 0.03, 5, 18).rotateX(Math.PI / 2), ironMat, { p: [px, 1.11, pz] });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        batch.add(worldBox(0.06, 0.95, 0.06, 1), ironMat, { p: [px + Math.cos(a) * 0.26, 0.47, pz + Math.sin(a) * 0.26], r: [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2] });
      }
      batch.add(new THREE.CircleGeometry(0.38, 14).rotateX(-Math.PI / 2), pbr('glow', 0x100400, { emissive: 0xff5010, emissiveIntensity: 2.5 }), { p: [px, 1.05, pz] }, { cast: false });
      for (let k = 0; k < 5; k++) batch.add(rockGeo(hash(k, x, y), 0.09), pbr('glow', 0x200800, { emissive: 0xff3a08, emissiveIntensity: 1.6 }), { p: [px + (hash(k, 1, x) - 0.5) * 0.4, 1.08, pz + (hash(k, 2, y) - 0.5) * 0.4] }, { cast: false });
      const f = makeFlame(0.8, 9.1 + placed.length * 3);
      f.position.set(px, 1.35, pz);
      group.add(f);
      flames.push(f);
      torches.unshift({ x: px, y: 1.8, z: pz, brazier: true });
    }
  }

  // Temple furniture: altar with candles and a cracked statue of Tyr (the Maimed God,
  // blindfolded, his right hand lost), banners of the Scales, roof beams that
  // survived the collapse, candle clusters and — at night — moonbeams through the
  // open roof.
  const stoneT = libMat('wall_stone', 0xd8d4cc);
  let statueMat = null;
  let statuePos = null;
  const crackMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 });
  disposables.push(crackMat);
  const candleMat = pbr('glow', 0xf0e8d0, { emissive: 0xffc070, emissiveIntensity: night ? 0.9 : 0.4 });
  const candle = (cx, cz, y, h, seed) => {
    batch.add(new THREE.CylinderGeometry(0.03, 0.035, h, 7), candleMat, { p: [cx, y + h / 2, cz] }, { cast: false });
    const fl = makeFlame(0.09, seed);
    fl.position.set(cx, y + h + 0.06, cz);
    group.add(fl);
    flames.push(fl);
  };
  for (const p of field.features.props ?? []) {
    const x = p.x * TILE + TILE / 2;
    const z = p.y * TILE + TILE / 2;
    if (p.type === 'altar') {
      batch.add(worldBox(1.4, 0.95, 0.85, 1.5), libMat('wall_stone', 0xe8e0d0), { p: [x, 0.475, z] });
      batch.add(worldBox(1.55, 0.1, 1.0, 1.5), plinthMat, { p: [x, 1.0, z] });
      batch.add(worldBox(0.5, 0.02, 1.02, 1), pbr('cloth', 0x8a1a18), { p: [x, 1.06, z] }, { cast: false });
      batch.add(worldBox(0.5, 0.6, 0.012, 1), pbr('cloth', 0x8a1a18), { p: [x, 0.76, z + 0.505] }, { cast: false });
      // A crack through the altar block and a chipped corner.
      batch.add(worldBox(0.03, 0.8, 0.02, 1), crackMat, { p: [x - 0.38, 0.45, z + 0.43], r: [0, 0, 0.3] }, { cast: false });
      batch.add(rockGeo(hash(p.x, p.y, 77), 0.12), libMat('wall_stone', 0xe8e0d0), { p: [x + 0.8, 0.05, z + 0.4] }, { cast: false });
      // Candles: tall pair, a cluster of stubs, melted wax.
      candle(x - 0.58, z, 1.05, 0.26, x);
      candle(x + 0.58, z, 1.05, 0.22, x + 1);
      for (let k = 0; k < 5; k++) candle(x - 0.25 + k * 0.12, z - 0.28 + (k % 2) * 0.1, 1.05, 0.06 + hash(k, p.x, 5) * 0.1, x + k * 3);
      for (let k = 0; k < 6; k++) candle(x - 1.0 + (k % 3) * 0.14, z + 0.55 + Math.floor(k / 3) * 0.14, 0, 0.08 + hash(k, p.y, 9) * 0.16, z + k * 5);
      // The altar's warm light gets one of the real point lights.
      torches.unshift({ x, y: 1.75, z, brazier: true, altar: true });
    } else if (p.type === 'statue') {
      const sx = x;
      const sz = z - 0.1;
      batch.add(worldBox(1.3, 0.9, 1.1, 1.5), plinthMat, { p: [sx, 0.45, sz] });
      batch.add(worldBox(1.45, 0.12, 1.25, 1.5), stoneT, { p: [sx, 0.96, sz] });
      // The god himself: one sculpted stone mesh (robe folds, blindfold, beard,
      // raised hammer, the lost right hand), with occlusion baked in.
      // The hero prop: larger than life and turned three-quarters toward the
      // hall, so its face, blindfold and the scales read from the tactics camera.
      const sg = new THREE.Group();
      sg.position.set(sx, 1.02, sz);
      sg.scale.setScalar(1.4);
      sg.rotation.y = 0.55;
      const statue = new THREE.Mesh(statueGeometry(), statueMat ??= statueMaterial());
      statue.castShadow = true;
      statue.receiveShadow = true;
      sg.add(statue);
      // The scales hang from the stump of the right wrist.
      const gilt = pbr('gold', 0xb8923e);
      const SB = new Batcher();
      SB.add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6).rotateZ(Math.PI / 2), gilt, { p: [0.5, 1.28, 0.42] });
      SB.add(new THREE.SphereGeometry(0.035, 8, 6), gilt, { p: [0.5, 1.28, 0.42] }, { cast: false });
      for (const dx of [-0.29, 0.29]) {
        SB.add(new THREE.SphereGeometry(0.12, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gilt, { p: [0.5 + dx, 1.04, 0.42] });
        for (const cx of [-0.07, 0.07]) SB.add(new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4).rotateZ(cx * 3.4), gilt, { p: [0.5 + dx + cx * 0.5, 1.16, 0.42] }, { cast: false });
      }
      SB.flush(sg);
      group.add(sg);
      statuePos = { x: sx, z: sz };
      // A great crack through the statue and a fallen fragment at its feet.
      batch.add(rockGeo(hash(p.x, 3, 3), 0.3), stoneT, { p: [sx + 0.7, 0.1, sz + 0.75] });
      batch.add(rockGeo(hash(p.x, 4, 3), 0.18), stoneT, { p: [sx + 0.45, 0.05, sz + 0.95] }, { cast: false });
      for (let k = 0; k < 4; k++) candle(sx - 0.5 + k * 0.32, sz + 0.62, 0.96, 0.08 + hash(k, 2, 9) * 0.12, sx + k * 7);
    }
  }
  const hallR = field.features.hall;
  if (hallR) {
    const hx0 = hallR.x0 * TILE;
    const hz0 = hallR.y0 * TILE;
    const hw = hallR.w * TILE;
    const hd = hallR.h * TILE;
    // Banners of the Scales flanking the statue on the back wall, tattered at the hem.
    const banTex = heraldryTex(0x5a1210, 0xd8b25a);
    disposables.push(banTex);
    const banMat = new THREE.MeshStandardMaterial({ map: banTex, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
    disposables.push(banMat);
    for (const dx of [-2.1, 2.1]) {
      const g = new THREE.PlaneGeometry(1.0, 2.4, 6, 8);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const xx = pos.getX(i);
        pos.setZ(i, Math.sin(xx * 5 + y * 2) * 0.03 + (1.2 - y) * 0.02);
      }
      g.computeVertexNormals();
      batch.add(g, banMat, { p: [hallR.cx * TILE + TILE / 2 + dx, 2.5, hz0 + 0.24] }, { cast: false });
      batch.add(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6).rotateZ(Math.PI / 2), darkWood, { p: [hallR.cx * TILE + TILE / 2 + dx, 3.72, hz0 + 0.26] }, { cast: false });
    }
    // Surviving roof beams jutting from the side walls, a fallen one across the rubble.
    for (let k = 0; k < Math.floor(hd / 3.2); k++) {
      const zz = hz0 + 1.6 + k * 3.2;
      const l1 = 0.8 + hash(k, 1, 501) * 1.4;
      const l2 = 0.6 + hash(k, 2, 501) * 1.2;
      // High beams dither out like the walls when they hang between camera and fight.
      const b1 = new Batcher();
      b1.add(worldBox(l1, 0.26, 0.26, 1), darkWood, { p: [hx0 + l1 / 2, 3.55, zz], r: [0, 0, -0.06] });
      beamBatches.push({ b: b1, box: new THREE.Box3(new THREE.Vector3(hx0, 3.3, zz - 0.2), new THREE.Vector3(hx0 + l1, 3.8, zz + 0.2)) });
      const b2 = new Batcher();
      b2.add(worldBox(l2, 0.26, 0.26, 1), darkWood, { p: [hx0 + hw - l2 / 2, 3.55, zz], r: [0, 0, 0.08] });
      beamBatches.push({ b: b2, box: new THREE.Box3(new THREE.Vector3(hx0 + hw - l2, 3.3, zz - 0.2), new THREE.Vector3(hx0 + hw, 3.8, zz + 0.2)) });
    }
    // Fallen beams lie against the back wall (never a dark slab across the
    // foreground), in sun-and-rain greyed timber that reads by moonlight too.
    const greyWood = pbr('wood', 0x8a7a66);
    batch.add(worldBox(4.2, 0.24, 0.24, 1), greyWood, { p: [hx0 + hw - 1.9, 0.5, hz0 + 1.3], r: [0, -0.5, 0.22] });
    batch.add(worldBox(2.6, 0.22, 0.22, 1), greyWood, { p: [hx0 + 1.5, 0.28, hz0 + 1.0], r: [0, 0.35, 0.1] });
    // Broken slab fragments and grit in loose clusters across the floor, and
    // pale pools of old candle wax spilt around the altar end.
    const rubM = libMat('wall_ruin', 0xa89c8c);
    for (let k = 0; k < 9; k++) {
      const cx = hx0 + 1 + hash(k, 21, 513) * (hw - 2);
      const cz = hz0 + 1 + hash(k, 22, 513) * (hd - 2);
      const n = 4 + Math.floor(hash(k, 23, 513) * 6);
      for (let j = 0; j < n; j++) {
        const a = hash(k, j, 514) * Math.PI * 2;
        const r = Math.sqrt(hash(j, k, 515)) * 0.45;
        const sz = 0.03 + hash(j, k, 516) ** 2 * 0.13;
        batch.add(rockGeo(hash(k * 13 + j, 9, 517), sz), j % 3 ? rubM : stoneT, { p: [cx + Math.cos(a) * r, sz * 0.25, cz + Math.sin(a) * r], r: [0, a, 0] }, { cast: sz > 0.09 });
      }
      // A flat broken tile lying askew.
      batch.add(worldBox(0.34 + hash(k, 24, 513) * 0.2, 0.05, 0.26, 1.5), stoneT, { p: [cx + 0.3, 0.03, cz - 0.2], r: [0.06, hash(k, 25, 513) * 3, 0.08] }, { cast: false });
    }
    // The restless dead's leavings: skulls, long bones and a ribcage or two,
    // and tall funerary urns (some toppled, spilling ash) — sized to read as
    // bones and urns from the tactics camera, always at square corners.
    {
      const boneM = pbr('bone', 0xd8ccae);
      const urnM = new THREE.MeshStandardMaterial({ color: 0x9a5c3a, roughness: 0.72, metalness: 0 });
      const ashM = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 1 });
      const sockM = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 });
      disposables.push(urnM, ashM, sockM);
      const urnGeo = new THREE.LatheGeometry([[0.0, 0], [0.12, 0.01], [0.17, 0.12], [0.19, 0.25], [0.15, 0.4], [0.08, 0.48], [0.1, 0.54], [0.09, 0.56]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
      for (let k = 0; k < 7; k++) {
        const cx = hx0 + TILE * (1 + Math.floor(hash(k, 31, 523) * (hw / TILE - 1)));
        const cz = hz0 + TILE * (1 + Math.floor(hash(k, 32, 523) * (hd / TILE - 1)));
        const yaw = hash(k, 33, 523) * Math.PI * 2;
        if (k % 3 !== 2) {
          // Remains: a skull, two or three long bones, a few ribs.
          batch.add(new THREE.SphereGeometry(0.11, 14, 10).scale(0.92, 0.88, 1.12), boneM, { p: [cx, 0.09, cz], r: [0.25, yaw, 0.35] });
          for (const sx of [-1, 1]) batch.add(new THREE.SphereGeometry(0.03, 8, 6), sockM, { p: [cx + Math.cos(yaw) * 0.04 * sx + Math.sin(yaw) * 0.09, 0.11, cz - Math.sin(yaw) * 0.04 * sx + Math.cos(yaw) * 0.09] }, { cast: false });
          for (let l = 0; l < 3; l++) batch.add(new THREE.CylinderGeometry(0.035, 0.04, 0.46, 7), boneM, { p: [cx + Math.cos(yaw + l * 1.3) * 0.3, 0.04, cz + Math.sin(yaw + l * 1.3) * 0.3], r: [Math.PI / 2, yaw + l * 0.9, 0] });
          for (let l = 0; l < 4; l++) batch.add(new THREE.TorusGeometry(0.16, 0.014, 4, 10, Math.PI * 0.9), boneM, { p: [cx - Math.sin(yaw) * 0.25 + Math.cos(yaw) * (l - 1.5) * 0.08, 0.05, cz - Math.cos(yaw) * 0.25 - Math.sin(yaw) * (l - 1.5) * 0.08], r: [-Math.PI / 2 + 0.3, yaw + Math.PI / 2, 0] }, { cast: false });
        } else {
          // A funerary urn: standing, or toppled with its ash spilt.
          const toppled = hash(k, 34, 523) < 0.5;
          if (toppled) {
            batch.add(urnGeo, urnM, { p: [cx, 0.17, cz], r: [Math.PI / 2 - 0.15, yaw, 0] });
            batch.add(new THREE.CircleGeometry(0.32, 12).rotateX(-Math.PI / 2), ashM, { p: [cx + Math.sin(yaw) * 0.6, 0.008, cz + Math.cos(yaw) * 0.6], s: [1, 1, 0.6] }, { cast: false });
          } else {
            batch.add(urnGeo, urnM, { p: [cx, 0, cz], r: [0, yaw, 0] });
            batch.add(urnGeo, urnM, { p: [cx + 0.42, 0, cz + 0.18], r: [0, yaw + 1, 0], s: 0.75 });
          }
        }
      }
    }
    const waxM = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.35, metalness: 0 });
    disposables.push(waxM);
    for (const p of field.features.props ?? []) {
      if (p.type !== 'altar' && p.type !== 'statue') continue;
      for (let k = 0; k < 7; k++) {
        const a = hash(k, p.x, 518) * Math.PI * 2;
        const r = 0.7 + hash(p.y, k, 519) * 0.6;
        const g = new THREE.CircleGeometry(0.05 + hash(k, 3, 520) * 0.09, 10).rotateX(-Math.PI / 2);
        batch.add(g, waxM, { p: [p.x * TILE + TILE / 2 + Math.cos(a) * r, 0.006, p.y * TILE + TILE / 2 + Math.sin(a) * r], s: [1, 1, 0.6 + hash(k, 4, 520) * 0.6] }, { cast: false });
      }
    }
    // Rubble drifts along the foot of the walls.
    for (let k = 0; k < 40; k++) {
      const side = k % 4;
      const t = hash(k, 3, 511);
      const px = side < 2 ? hx0 + 0.35 + side * (hw - 0.7) : hx0 + t * hw;
      const pz = side < 2 ? hz0 + t * hd : hz0 + 0.35 + (side - 2) * (hd - 0.7);
      batch.add(rockGeo(hash(k, 4, 511), 0.08 + hash(k, 5, 511) * 0.18), rubM, { p: [px + (hash(k, 6, 511) - 0.5) * 0.3, 0.03, pz + (hash(k, 7, 511) - 0.5) * 0.3] }, { cast: false });
    }
    if (night) {
      // Moonbeams through the open roof: slanted volumetric shafts (soft,
      // view-dependent edges, dust caught in them) that pool on the floor.
      const beamMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, uK: { value: 1 }, tNoise: { value: noiseTexture() } },
        vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec3 vV;
          void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
            vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec3 vV; uniform float uT, uK; uniform sampler2D tNoise;
          void main(){
            float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
            float n = texture2D(tNoise, vec2(vW.x * 0.11 + vW.z * 0.07 + uT * 0.008, vW.y * 0.06 - uT * 0.015)).r;
            float n2 = texture2D(tNoise, vec2(vW.z * 0.23 - uT * 0.01, vW.y * 0.17 + vW.x * 0.05)).r;
            float h = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            float a = core * h * (0.45 + n * 0.55) * (0.75 + n2 * 0.5);
            gl_FragColor = vec4(vec3(0.55, 0.66, 1.0) * 0.095 * uK * a, 1.0); }`,
      });
      disposables.push(beamMat);
      // Where each shaft lands: a soft, slightly stretched pool of moonlight.
      const poolMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { tNoise: { value: noiseTexture() } },
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform sampler2D tNoise;
          void main(){ float r = length(vUv * 2.0 - 1.0); float k = smoothstep(1.0, 0.25, r);
            float n = texture2D(tNoise, vW.xz * 0.35).r;
            gl_FragColor = vec4(vec3(0.5, 0.6, 0.95) * 0.08 * k * k * (0.7 + 0.6 * n), 1.0); }`,
      });
      disposables.push(poolMat);
      const beams = new THREE.Group();
      const tilt = 0.32;
      // Narrow, dim shafts (they model the scene, they don't wash it out).
      // One shaft through the broken vault plus Tyr's own beam: a motivated key, not stock set dressing.
      for (const [fx, fz, w, yaw] of [[0.4, 0.55, 0.38, 0.5]]) {
        const bx = hx0 + hw * fx + 1.2 - Math.sin(yaw) * 1.3;
        const bz = hz0 + hd * fz - 1.0 - Math.cos(yaw) * 1.3;
        const g = new THREE.CylinderGeometry(w * 0.85, w, 9, 28, 1, true).translate(0, 4.5, 0);
        const m = new THREE.Mesh(g, beamMat);
        m.position.set(bx, 0, bz);
        m.rotation.set(tilt, yaw, 0, 'YXZ');
        m.renderOrder = 5;
        beams.add(m);
        disposables.push(g);
        const pg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const pool = new THREE.Mesh(pg, poolMat);
        pool.position.set(bx, 0.03, bz);
        pool.rotation.y = yaw;
        pool.scale.set(w * 2.6, 1, w * 2.6 / Math.cos(tilt));
        pool.renderOrder = 4;
        beams.add(pool);
        disposables.push(pg);
        // Dust motes drifting inside the shaft.
        const dm = loopingParticles({ count: 44, at: new THREE.Vector3(bx + Math.sin(yaw) * 0.6, 1.8, bz + Math.cos(yaw) * 0.6), spread: w * 0.9, spreadY: 1.6, vel: [0.03, 0.02, 0.02], turb: 0.12, life: 8, size: 0.024, color: 0xd8e2ff, additive: true, alpha: 0.85, seed: 41 + fx * 10 });
        group.add(dm.obj);
        ambient.push(dm);
      }
      if (statuePos) {
        // A moonbeam falls squarely on Tyr: the hall's key light on its hero prop.
        const g = new THREE.CylinderGeometry(0.5, 0.6, 10, 28, 1, true).translate(0, 5, 0);
        const sbm = beamMat.clone();
        sbm.uniforms.uT = beamMat.uniforms.uT;
        sbm.uniforms.uK.value = 0.45;
        disposables.push(sbm);
        const m = new THREE.Mesh(g, sbm);
        m.position.set(statuePos.x + 0.2, 0, statuePos.z + 0.6);
        m.rotation.set(tilt, 0.5, 0, 'YXZ');
        m.renderOrder = 5;
        beams.add(m);
        disposables.push(g);
        const pg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const pool = new THREE.Mesh(pg, poolMat);
        pool.position.set(statuePos.x + 0.2, 0.03, statuePos.z + 0.9);
        pool.scale.set(1.6, 1, 1.9);
        pool.renderOrder = 4;
        beams.add(pool);
        disposables.push(pg);
      }
      group.add(beams);
      ambient.push({ update: (t) => (beamMat.uniforms.uT.value = t), dispose: () => {} });
      const motes = loopingParticles({ count: 40, at: new THREE.Vector3(hx0 + hw * 0.5, 1.8, hz0 + hd * 0.6), spread: hw * 0.35, spreadY: 1.6, vel: [0.04, 0.03, 0.02], turb: 0.15, life: 8, size: 0.025, color: 0xb8c8ff, additive: true, alpha: 0.45, seed: 31 });
      group.add(motes.obj);
      ambient.push(motes);
    }
  }

  // ---------------------------------------------------------------- far city
  // A far ground apron and a skyline of Phlan's rooftops and towers, lost in haze,
  // so the view never runs off into empty sky.
  {
    const far = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ map: rub.map, color: night ? 0x3a3a44 : 0x6a6258, roughness: 1 }));
    far.material.map = rub.map.clone();
    far.material.map.repeat.set(120, 120);
    far.material.map.needsUpdate = true;
    far.rotation.x = -Math.PI / 2;
    far.position.set(W / 2, -0.04, H / 2);
    group.add(far);
    disposables.push(far.geometry, far.material, far.material.map);
    const skyMat = new THREE.MeshStandardMaterial({ color: night ? 0x1a1e2a : 0x6a645c, roughness: 1 });
    const roofDark = new THREE.MeshStandardMaterial({ color: night ? 0x141620 : 0x5a3a30, roughness: 1 });
    disposables.push(skyMat, roofDark);
    const extent = (RING + 1) * CELLM;
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2 + hash(k, 1, 881) * 0.05;
      const d = Math.max(W, H) / 2 + extent + 8 + hash(k, 2, 881) * 55;
      const x = W / 2 + Math.sin(a) * d;
      const z = H / 2 + Math.cos(a) * d;
      const tower = hash(k, 3, 881) > 0.9;
      const hgt = tower ? 16 + hash(k, 4, 881) * 14 : 5 + hash(k, 4, 881) * 7;
      const wdt = tower ? 5 : 6 + hash(k, 5, 881) * 8;
      if (tower) {
        batch.add(new THREE.CylinderGeometry(wdt / 2, wdt / 2 + 0.4, hgt, 10), skyMat, { p: [x, hgt / 2, z] }, { cast: false });
        batch.add(new THREE.ConeGeometry(wdt / 2 + 0.6, wdt * 1.1, 10), roofDark, { p: [x, hgt + wdt * 0.55, z] }, { cast: false });
      } else {
        batch.add(new THREE.BoxGeometry(wdt, hgt, wdt * 0.8), skyMat, { p: [x, hgt / 2, z], r: [0, a, 0] }, { cast: false });
        const roof = new THREE.ConeGeometry(wdt * 0.75, wdt * 0.5, 4);
        roof.rotateY(Math.PI / 4);
        roof.scale(1, 1, 0.75);
        batch.add(roof, roofDark, { p: [x, hgt + wdt * 0.25, z], r: [0, a, 0] }, { cast: false });
      }
    }
  }

  // ---------------------------------------------------------------- the Pool
  // Water cells become a sunken basin of radiant water: a raised coping of
  // dressed stone around it, a surface of slow golden-teal light (caustic
  // ripples, a hot core, Fresnel sheen toward the rim) and caustic light
  // dancing on the flags and coping around it.
  let pool = null;
  {
    const wc = [];
    for (let my = cellY0; my < cellY0 + cellsH; my++) for (let mx = cellX0; mx < cellX0 + cellsW; mx++) if (inMap(mx, my) && cellType(mx, my) === CELL.WATER) wc.push([mx, my]);
    if (wc.length) {
      const isW = (mx, my) => inMap(mx, my) && cellType(mx, my) === CELL.WATER;
      const xs = wc.map((c) => c[0]);
      const ys = wc.map((c) => c[1]);
      const px0 = cw(Math.min(...xs)), pz0 = ch(Math.min(...ys)), px1 = cw(Math.max(...xs) + 1), pz1 = ch(Math.max(...ys) + 1);
      const pcx = (px0 + px1) / 2, pcz = (pz0 + pz1) / 2;
      const rad = Math.hypot(px1 - px0, pz1 - pz0) / 2;
      pool = { x: pcx, z: pcz, w: px1 - px0, d: pz1 - pz0, r: rad };
      const uni = { uT: { value: 0 }, uC: { value: new THREE.Vector2(pcx, pcz) }, uR: { value: rad }, uB: { value: new THREE.Vector4(px0 + 0.3, pz0 + 0.3, px1 - 0.3, pz1 - 0.3) } };
      // The water is a window into a deep stepped basin: each pixel follows the
      // refracted view ray down to the tiers / walls / floor below, which glow
      // from a radiant heart at the bottom; the path through the water absorbs
      // red (deep jade-teal), in-scatter adds the golden radiance, and the
      // surface itself carries ripple glints and a Fresnel mirror of the vault.
      const waterMat = new THREE.ShaderMaterial({
        uniforms: uni,
        transparent: false,
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW; uniform float uT; uniform vec2 uC; uniform float uR; uniform vec4 uB;
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
          float caus(vec2 p, float t){
            vec2 q = p; float c = 0.0;
            for (int i = 0; i < 3; i++) { float fi = float(i);
              q += vec2(sin(q.y * 1.3 + t * (0.6 + fi * 0.2) + fi), cos(q.x * 1.1 - t * (0.5 + fi * 0.15) + fi * 2.0)) * 0.55;
              c += abs(sin(q.x + q.y * 0.7 + fi * 1.7)); }
            return pow(1.0 - clamp(c / 3.0, 0.0, 1.0), 4.0); }
          float hgt(vec2 p){ return n2(p * 1.7 + vec2(uT * 0.3, uT * 0.17)) * 0.6 + n2(p * 4.1 - vec2(uT * 0.4, -uT * 0.2)) * 0.4; }
          void main(){
            vec2 p = vW.xz;
            // Ripple normal from a height field.
            float e = 0.06;
            float h0 = hgt(p);
            vec3 N = normalize(vec3((h0 - hgt(p + vec2(e, 0.0))) * 0.5, 1.0, (h0 - hgt(p + vec2(0.0, e))) * 0.5));
            vec3 V = normalize(cameraPosition - vW);
            vec3 Rr = refract(-V, N, 0.75);
            // Stepped basin: three tiers inward from the coping, then the floor.
            vec2 bc = 0.5 * (uB.xy + uB.zw);
            vec2 bh = 0.5 * (uB.zw - uB.xy);
            float tHit = 99.0; vec3 hit = vW; float surfK = 0.0; float tier = 0.0;
            for (int k = 0; k < 4; k++) {
              float fk = float(k);
              float inset = fk * 0.42;
              float yb = -0.45 - fk * 0.45;
              vec2 hb = max(bh - inset, vec2(0.2));
              // Tread of tier k (a horizontal ring at depth yb, inside the
              // previous wall, outside the next one).
              float tf = (vW.y - yb) / max(-Rr.y, 1e-3);
              vec3 q = vW + Rr * tf;
              vec2 dq = abs(q.xz - bc);
              vec2 hbn = max(bh - inset - 0.42, vec2(0.0));
              bool inside = dq.x < hb.x && dq.y < hb.y;
              bool ring = k == 3 || dq.x > hbn.x || dq.y > hbn.y;
              if (inside && ring && tf < tHit) { tHit = tf; hit = q; surfK = 1.0; tier = fk; }
              // Riser (vertical wall) of tier k.
              vec2 rs = vec2(Rr.x >= 0.0 ? 1.0 : -1.0, Rr.z >= 0.0 ? 1.0 : -1.0);
              vec2 tw = ((bc + rs * hb) - vW.xz) / (rs * max(abs(Rr.xz), vec2(1e-4)));
              float twm = min(tw.x, tw.y);
              vec3 qw = vW + Rr * twm;
              float ytop = k == 0 ? vW.y : -0.45 - (fk - 1.0) * 0.45;
              if (twm > 0.0 && qw.y < ytop && qw.y > yb && twm < tHit) { tHit = twm; hit = qw; surfK = 0.0; tier = fk; }
            }
            float pathL = min(tHit, 6.0);
            float dc = length(hit.xz - uC) / uR;
            // The basin's dressed stone: block joints, darker with each tier.
            vec2 bj = surfK > 0.5 ? hit.xz * 1.6 : vec2((abs(Rr.x) > abs(Rr.z) ? hit.z : hit.x) * 1.6, hit.y * 3.0);
            float joint = smoothstep(0.0, 0.06, min(abs(fract(bj.x) - 0.5), abs(fract(bj.y + floor(bj.x) * 0.5) - 0.5)) - 0.44);
            vec3 stone = vec3(0.3, 0.28, 0.24) * (0.75 + 0.35 * h2(floor(bj))) * (1.0 - joint * 0.5);
            // The radiant heart on the deepest floor: a carved sigil burning gold-white.
            float heart = smoothstep(0.65, 0.0, dc);
            float rings = (1.0 - smoothstep(0.0, 0.04, abs(fract(dc * 5.0 - uT * 0.15) - 0.5) - 0.42)) * smoothstep(0.7, 0.2, dc);
            vec3 floorLight = vec3(1.0, 0.82, 0.45) * (0.25 + heart * 6.5 + rings * 2.0 * (tier > 2.5 ? 1.0 : 0.25));
            vec3 under = stone * floorLight * (0.55 + 0.6 * caus(hit.xz * 1.3, uT * 0.9));
            // Absorption through the water (red goes first → jade/teal) and
            // golden in-scatter brightest over the heart.
            vec3 absorb = exp(-pathL * vec3(1.3, 0.55, 0.62));
            vec3 scatter = (1.0 - exp(-pathL * 0.6)) * mix(vec3(0.0, 0.12, 0.12), vec3(0.95, 0.72, 0.3), smoothstep(0.8, 0.0, length(vW.xz - uC) / uR));
            vec3 col = under * absorb * 1.2 + scatter * 0.4;
            // Surface: a Fresnel mirror of the dark vault, ripple glints, and
            // a fine caustic shimmer riding the surface.
            float fr = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
            col = mix(col, vec3(0.02, 0.035, 0.04), fr * 0.85);
            float glint = pow(max(dot(reflect(-V, N), normalize(vec3(0.0, 1.0, 0.0))), 0.0), 60.0);
            col += vec3(1.0, 0.85, 0.55) * glint * 0.25;
            col += vec3(1.0, 0.86, 0.5) * caus(p * 1.6 + 2.0, uT * 1.2) * 0.12 * smoothstep(1.0, 0.2, length(vW.xz - uC) / uR);
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      disposables.push(waterMat);
      for (const [mx, my] of wc) batch.add(new THREE.PlaneGeometry(CELLM, CELLM).rotateX(-Math.PI / 2), waterMat, { p: [cw(mx) + CELLM / 2, 0.06, ch(my) + CELLM / 2] }, { cast: false, receive: false });
      // Coping: a raised kerb of dressed blocks along every water edge that meets floor.
      const cope = libMat('wall_stone', 0xb0a594, { grime: 0, amount: 0.3 });
      const copeDark = libMat('wall_stone', 0x6a6258, { grime: 0, amount: 0.3 });
      for (const [mx, my] of wc) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (isW(mx + dx, my + dy)) continue;
          const horiz = dy !== 0;
          const cx = cw(mx) + CELLM / 2 + dx * (CELLM / 2 - 0.25);
          const cz = ch(my) + CELLM / 2 + dy * (CELLM / 2 - 0.25);
          const n = 5;
          for (let k = 0; k < n; k++) {
            const along = (k + 0.5) / n - 0.5;
            const bl = CELLM / n - 0.04;
            const bx = horiz ? cx + along * CELLM : cx;
            const bz = horiz ? cz : cz + along * CELLM;
            const hgt = 0.3 + hash(mx * 5 + k, my, 81) * 0.04;
            batch.add(worldBox(horiz ? bl : 0.55, hgt, horiz ? 0.55 : bl, 1), cope, { p: [bx, hgt / 2, bz], r: [0, (hash(k, mx, my) - 0.5) * 0.04, 0] });
          }
          // The inner face drops into the water, darker and wet.
          batch.add(worldBox(horiz ? CELLM : 0.06, 0.5, horiz ? 0.06 : CELLM, 1), copeDark, { p: [cx - dx * 0.28, -0.1, cz - dy * 0.28] }, { cast: false });
        }
      }
      // Caustic light dancing on the floor and coping around the basin.
      const cMat = new THREE.ShaderMaterial({
        uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -4,
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW; uniform float uT; uniform vec2 uC; uniform float uR;
          float caus(vec2 p, float t){ vec2 q = p; float c = 0.0;
            for (int i = 0; i < 3; i++) { float fi = float(i);
              q += vec2(sin(q.y * 1.3 + t * (0.6 + fi * 0.2) + fi), cos(q.x * 1.1 - t * (0.5 + fi * 0.15) + fi * 2.0)) * 0.55;
              c += abs(sin(q.x + q.y * 0.7 + fi * 1.7)); }
            return pow(1.0 - clamp(c / 3.0, 0.0, 1.0), 5.0); }
          void main(){
            float d = length(vW.xz - uC) / uR;
            float fall = smoothstep(1.55, 0.98, d) * smoothstep(0.85, 1.05, d);
            float c = caus(vW.xz * 0.9, uT * 0.7);
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * (c * 0.42 + 0.02) * fall, 1.0);
          }`,
      });
      disposables.push(cMat);
      const cs = rad * 4.8;
      const cMesh = new THREE.Mesh(new THREE.PlaneGeometry(cs, cs).rotateX(-Math.PI / 2), cMat);
      cMesh.position.set(pcx, 0.025, pcz);
      cMesh.renderOrder = 2;
      group.add(cMesh);
      disposables.push(cMesh.geometry);
      // A soft column of light and motes rising off the water.
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.75, rad * 0.95, 7, 24, 1, true), new THREE.ShaderMaterial({
        uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW; uniform float uT;
          void main(){ vec3 V = normalize(cameraPosition - vW); float edge = pow(1.0 - abs(dot(V, vN)), 1.5);
            float a = (1.0 - vUv.y) * (1.0 - vUv.y) * (0.5 + 0.5 * sin(vUv.x * 40.0 + uT * 0.6 + vUv.y * 6.0) * 0.3 + 0.35) * (1.0 - edge * 0.7);
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * a * 0.05, 1.0); }`,
      }));
      shaft.position.set(pcx, 3.5, pcz);
      shaft.renderOrder = 6;
      group.add(shaft);
      disposables.push(shaft.geometry, shaft.material);
      // Radiant mist rising off the water in slow, torn veils.
      const mistMat = new THREE.ShaderMaterial({
        uniforms: { uT: uni.uT, uC: uni.uC, uR: uni.uR, uH: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW; uniform float uT, uR, uH; uniform vec2 uC;
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
          void main(){ float d = length(vW.xz - uC) / uR;
            float m = n2(vW.xz * 0.7 + vec2(uT * 0.08, -uT * 0.05) + uH * 3.0) * 0.6 + n2(vW.xz * 1.9 - vec2(uT * 0.12, uT * 0.07)) * 0.4;
            float a = smoothstep(0.5, 0.9, m) * smoothstep(1.05, 0.4, d) * (0.07 - uH * 0.018);
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, 1.0); }`,
      });
      disposables.push(mistMat);
      for (let k = 0; k < 3; k++) {
        const mm = mistMat.clone();
        mm.uniforms = { uT: uni.uT, uC: uni.uC, uR: uni.uR, uH: { value: k } };
        disposables.push(mm);
        const mist = new THREE.Mesh(new THREE.PlaneGeometry(rad * 2.4, rad * 2.4).rotateX(-Math.PI / 2), mm);
        mist.position.set(pcx, 0.35 + k * 0.45, pcz);
        mist.renderOrder = 7;
        group.add(mist);
        disposables.push(mist.geometry);
      }
      const motes = loopingParticles({ count: 70, at: new THREE.Vector3(pcx, 0.3, pcz), spread: rad * 0.8, spreadY: 0.2, vel: [0, 0.45, 0], turb: 0.3, life: 6, size: 0.06, color: 0xffd890, additive: true, alpha: 0.8, seed: 77 });
      group.add(motes.obj);
      ambient.push(motes);
      ambient.push({ update: (t) => { uni.uT.value = t; }, dispose: () => {} });
    }
  }

  // ---------------------------------------------------------------- flush
  batch.flush(group);
  const houseGroups = [];
  for (const hs of houses) {
    const gFull = new THREE.Group();
    const gCut = new THREE.Group();
    hs.full.flush(gFull);
    hs.cut.flush(gCut);
    group.add(gFull, gCut);
    gCut.visible = false;
    houseGroups.push({ h: hs, full: gFull, cut: gCut });
  }
  const wallGroups = [];
  for (const w of edgeWalls) {
    const gFull = new THREE.Group();
    const gCut = new THREE.Group();
    w.full.flush(gFull);
    w.cut.flush(gCut);
    group.add(gFull, gCut);
    gCut.visible = false;
    wallGroups.push({ w, full: gFull, cut: gCut });
  }

  for (const bb of beamBatches) {
    const gFull = new THREE.Group();
    bb.b.flush(gFull);
    group.add(gFull);
    wallGroups.push({ w: { prop: true, e: {} }, full: gFull, cut: new THREE.Group(), fixedBox: bb.box.expandByScalar(0.3) });
  }
  for (const cb of colBatches) {
    const gFull = new THREE.Group();
    cb.b.flush(gFull);
    group.add(gFull);
    const box = new THREE.Box3(new THREE.Vector3(cb.x - 0.55, 0, cb.z - 0.55), new THREE.Vector3(cb.x + 0.55, cb.h, cb.z + 0.55));
    wallGroups.push({ w: { prop: true, e: {} }, full: gFull, cut: new THREE.Group(), fixedBox: box });
  }
  // Bounding boxes for occlusion tests.
  for (const hg of houseGroups) {
    const hs = hg.h;
    const top = hs.ruined ? hs.height : hs.height + Math.min(hs.x1 - hs.x0, hs.z1 - hs.z0) * 0.45 + (hs.chimney ? 1.2 : 0);
    hg.box = new THREE.Box3(new THREE.Vector3(hs.x0 - 0.5, 0, hs.z0 - 0.5), new THREE.Vector3(hs.x1 + 0.5, top, hs.z1 + 0.5));
  }
  for (const wg of wallGroups) {
    if (wg.fixedBox) {
      wg.box = wg.fixedBox;
      continue;
    }
    wg.box = new THREE.Box3();
    wg.full.updateMatrixWorld(true);
    wg.box.setFromObject(wg.full);
    wg.box.expandByScalar(0.2);
  }
  // Occlusion fade: per-group opacity (screen-door dither) applied only inside a
  // soft screen-space hole around the fight, so roofs and outer walls keep their
  // silhouette while the slice between camera and actors melts away.
  const fadeShared = { uHole: { value: new THREE.Vector2(-9999, -9999) }, uHoleR: { value: 300 } };
  const fadeMats = new Map();
  const fadeMat = (m, g) => {
    const key = `${m.uuid}|${g.full.id}`;
    if (fadeMats.has(key)) return fadeMats.get(key);
    const f = m.clone();
    const base = m.onBeforeCompile;
    const baseKey = m.customProgramCacheKey?.() ?? '';
    f.onBeforeCompile = (sh, r) => {
      base?.call(m, sh, r);
      sh.uniforms.uFade = g.fade;
      sh.uniforms.uHole = fadeShared.uHole;
      sh.uniforms.uHoleR = fadeShared.uHoleR;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uFade, uHoleR; uniform vec2 uHole;
          float bayer4(vec2 p){ int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0)); int i = x + y * 4;
            float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
            return (B[i] + 0.5) / 16.0; }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (uFade < 0.999) {
            float hd = length(gl_FragCoord.xy - uHole) / uHoleR;
            float op = mix(uFade, 1.0, smoothstep(0.75, 1.15, hd));
            if (bayer4(gl_FragCoord.xy) > op) discard;
          }`)
        // Cut-away (foreground) masses never read as unlit black slabs: they
        // lift toward a soft, cool-grey silhouette as they fade.
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          if (uFade < 0.999) {
            float gh = (1.0 - uFade);
            vec3 ghostC = vec3(0.32, 0.34, 0.4) * (0.7 + 0.3 * dot(gl_FragColor.rgb, vec3(0.33)));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, max(gl_FragColor.rgb, ghostC), gh * 0.75);
          }`);
    };
    f.customProgramCacheKey = () => `${baseKey}|fade`;
    fadeMats.set(key, f);
    disposables.push(f);
    return f;
  };
  for (const g of [...houseGroups, ...wallGroups]) {
    if (g.w?.city || g.w?.low) continue;
    g.fade = { value: 1 };
    g.fadeTarget = 1;
    g.full.traverse((o) => {
      if (o.isMesh) o.material = fadeMat(o.material, g);
    });
  }

  const _ray = new THREE.Ray();
  const _pb = new THREE.Box3();
  const _v = new THREE.Vector3();
  /**
   * Cut away houses and walls that would hide any of `points` (combatants,
   * cursor) from the camera — a dollhouse view that keeps the fight readable.
   */
  const _corner = new THREE.Vector3();
  /** Fraction of the screen a box covers (clamped NDC bbox). */
  function screenCover(box, camera) {
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      x0 = Math.min(x0, _corner.x); x1 = Math.max(x1, _corner.x);
      y0 = Math.min(y0, _corner.y); y1 = Math.max(y1, _corner.y);
    }
    const w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0));
    const h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
    return (w * h) / 4;
  }

  function setView(camPos, points, camera = null) {
    const cdx = camPos.x - W / 2;
    const cdz = camPos.z - H / 2;
    const cl = Math.hypot(cdx, cdz) || 1;
    // How far the fight sits from the camera: masses well in front of it are foreground.
    let fightD = 0;
    for (const p of points) fightD += camPos.distanceTo(p) / Math.max(1, points.length);
    const _c = new THREE.Vector3();
    for (const g of [...houseGroups, ...wallGroups]) {
      if (g.w?.city) {
        // City walls on the camera's side are always lowered (dollhouse view).
        const on = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[g.w.e.dir];
        const cut = (on[0] * cdx + on[1] * cdz) / cl > 0.35;
        g.full.visible = !cut;
        g.cut.visible = cut;
        continue;
      }
      let hides = false;
      // Loose props (tall columns, beams) also clear out when they merely loom
      // in the foreground next to a sight line.
      const box = g.w?.prop ? _pb.copy(g.box).expandByScalar(0.9) : g.box;
      for (const p of points) {
        _ray.origin.copy(p);
        _ray.direction.subVectors(camPos, p).normalize();
        if (box.containsPoint(p)) continue;
        const hit = _ray.intersectBox(box, _v);
        if (hit && hit.distanceTo(p) < camPos.distanceTo(p)) {
          hides = true;
          break;
        }
      }
      // Foreground masses (a roof beam or wall face between the lens and the
      // fight, even if no sight line strictly crosses it) never sit as black
      // slabs across the frame: beams clear out, walls ghost to a soft silhouette.
      let fore = false;
      if (!hides && points.length) {
        g.box.getCenter(_c);
        const dc = camPos.distanceTo(_c);
        fore = dc < fightD - (g.w?.prop ? 1.5 : 4.5) && _c.y + 0.5 > 0;
      }
      if (g.h) {
        // Houses: a tall facade that hides the fight, or looms near the lens
        // and eats a big slice of the frame, drops to its cut-away low wall.
        let big = false;
        if (camera && !hides) {
          g.box.getCenter(_c);
          const cov = screenCover(g.box, camera);
          const dc = camPos.distanceTo(_c);
          big = cov > 0.12 && dc < fightD - 1.5;
        }
        const cut = hides || big || fore;
        g.full.visible = !cut;
        g.cut.visible = cut;
        if (g.h.smoke) g.h.smoke.visible = !cut;
        for (const tc of g.h.torches ?? []) {
          tc.flame.visible = !cut;
          if (tc.light) tc.light.userData.hidden = cut;
        }
        g.fadeTarget = 1;
        if (g.fade) g.fade.value = 1;
        continue;
      }
      if (g.w?.low) {
        // Low field walls simply drop to their knee-high cut-away course —
        // also when they merely run across the foreground between the lens
        // and the fight (a flat band of masonry along the frame's bottom).
        let near = false;
        if (!hides && points.length) {
          g.box.getCenter(_c);
          near = camPos.distanceTo(_c) < fightD - 2.0 && g.box.max.y > 1.2;
        }
        g.full.visible = !(hides || near);
        g.cut.visible = hides || near;
        continue;
      }
      // Loose props (high beams, tall columns) dissolve and then drop out
      // entirely (no speckled ghost past the hole's rim); walls keep a ghost.
      // Walls in the way dissolve completely (a half-dithered dark ghost
      // reads as a stain on the paving from the tactics camera).
      g.fadeTarget = hides || fore ? 0 : 1;
      g.full.visible = !((hides || fore) && g.fade && g.fade.value < 0.04);
      // A dissolved wall casts no shadow (the shadow pass ignores the dither,
      // which left dark ghost silhouettes of invisible walls on the paving).
      const cast = !(hides || fore);
      if (g._cast !== cast) {
        g._cast = cast;
        g.full.traverse((o) => {
          if (!o.isMesh) return;
          if (o.userData.cs0 === undefined) o.userData.cs0 = o.castShadow;
          o.castShadow = cast && o.userData.cs0;
        });
      }
      g.cut.visible = false;
    }
  }

  /** Screen-space centre/radius (px) of the fade hole — the fight's focus. */
  function setHole(x, y, r) {
    fadeShared.uHole.value.set(x, y);
    fadeShared.uHoleR.value = r;
  }

  // ---------------------------------------------------------------- ambient life
  // Embers rising from every brazier; sparks from torches.
  for (const tc of torches) {
    if (tc.altar) continue;
    const e = loopingParticles({ count: tc.brazier ? 26 : 8, at: new THREE.Vector3(tc.x, tc.y - (tc.brazier ? 0.35 : 0.1), tc.z), spread: tc.brazier ? 0.35 : 0.08, vel: [0, tc.brazier ? 1.3 : 0.8, 0], turb: 0.35, life: tc.brazier ? 2.2 : 1.4, size: 0.05, color: 0xffa040, additive: true, seed: tc.x * 3 + tc.z });
    group.add(e.obj);
    ambient.push(e);
  }
  // Chimney smoke.
  for (const hs of houses) {
    if (!hs.chimney) continue;
    const sm = loopingParticles({ count: 10, at: new THREE.Vector3(hs.chimney.x, hs.chimney.y, hs.chimney.z), spread: 0.15, vel: [0.25, 0.7, 0.12], turb: 0.3, life: 7, size: 1.1, grow: 2.5, color: night ? 0x2a2c34 : 0x8a8680, additive: false, alpha: night ? 0.22 : 0.14, seed: hs.seed * 50 });
    group.add(sm.obj);
    // A cut-away house has no chimney: its smoke must not hang over the street.
    hs.smoke = sm.obj;
    ambient.push(sm);
  }
  // Dust motes hanging in the air over the fight (day) / drifting ash (night).
  {
    const d = loopingParticles({ count: 90, at: new THREE.Vector3(W / 2, 1.6, H / 2), spread: Math.max(W, H) * 0.5, spreadY: 1.4, vel: [0.08, 0.05, 0.04], turb: 0.25, life: 9, size: 0.035, color: night ? 0x9ab0ff : 0xfff0d0, additive: true, alpha: night ? 0.5 : 0.35, seed: 7 });
    group.add(d.obj);
    ambient.push(d);
  }
  // Low ground mist at night.
  if (night) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(SW * TILE, SH * TILE).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uT: { value: 0 }, tNoise: { value: noiseTexture() } },
      vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vW; uniform float uT; uniform sampler2D tNoise;
        void main(){ float a = texture2D(tNoise, vW.xz * 0.015 + vec2(uT * 0.004, uT * 0.002)).r;
          float b = texture2D(tNoise, vW.xz * 0.04 - vec2(uT * 0.006, 0.0)).r;
          float m = smoothstep(0.35, 0.8, a * 0.7 + b * 0.5);
          gl_FragColor = vec4(vec3(0.3, 0.36, 0.52), m * 0.16); }`,
    }));
    mist.position.set(originX + (SW * TILE) / 2, 0.35, originZ + (SH * TILE) / 2);
    mist.renderOrder = 4;
    group.add(mist);
    disposables.push(mist.material, mist.geometry);
    ambient.push({ update: (t) => (mist.material.uniforms.uT.value = t), dispose: () => {} });
  }

  /** How many houses/walls would have to be cut away to see `points` from camPos. */
  function occluders(camPos, points, { visibleOnly = false } = {}) {
    let n = 0;
    for (const g of [...houseGroups, ...wallGroups]) {
      if (g.w?.city || g.w?.prop) continue;
      // What is drawn right now: cut-away houses and dissolved walls hide nothing.
      if (visibleOnly && (!g.full.visible || (g.fade && g.fade.value < 0.5) || g.w?.low)) continue;
      for (const p of points) {
        _ray.origin.copy(p);
        _ray.direction.subVectors(camPos, p).normalize();
        if (g.box.containsPoint(p)) continue;
        const hit = _ray.intersectBox(g.box, _v);
        if (hit && hit.distanceTo(p) < camPos.distanceTo(p)) {
          n += g.h ? (g.h.x1 - g.h.x0) * (g.h.z1 - g.h.z0) : 4;
          break;
        }
      }
    }
    return n;
  }

  let lastT = null;
  function update(t, pix) {
    const dt = lastT === null ? 0 : t - lastT;
    lastT = t;
    // Ease the occlusion fades (snap when the clock is frozen: settled state).
    const k = dt > 1e-5 ? 1 - Math.exp(-dt * 6) : 1;
    for (const g of [...houseGroups, ...wallGroups]) if (g.fade) g.fade.value += (g.fadeTarget - g.fade.value) * k;
    for (const f of flames) f.userData.update(t);
    for (const a of ambient) a.update(t, pix);
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isMesh || obj.isInstancedMesh) obj.geometry?.dispose();
    });
    for (const d of disposables) d.dispose?.();
    for (const a of ambient) a.dispose();
    for (const f of flames) f.userData.dispose?.();
  }

  return { group, torches, flames, houses, update, setView, setHole, occluders, bounds: { w: W, h: H }, dispose, pool, dungeon: map?.kind === 'dungeon' };
}

// ------------------------------------------------------------------ helpers
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array;
  const pb = b.attributes.position.array;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa);
  pos.set(pb, pa.length);
  const ua = a.attributes.uv.array;
  const ub = b.attributes.uv.array;
  const uv = new Float32Array(ua.length + ub.length);
  uv.set(ua);
  uv.set(ub, ua.length);
  const na = a.attributes.normal.array;
  const nb = b.attributes.normal.array;
  const nor = new Float32Array(na.length + nb.length);
  nor.set(na);
  nor.set(nb, na.length);
  const off = a.attributes.position.count;
  const idx = [...a.index.array, ...b.index.array.map((i) => i + off)];
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Endlessly looping particles (embers, smoke, motes): each particle's age is
 * (t + phase) mod life, evaluated in the shader — cheap and freeze-safe.
 */
function loopingParticles(o) {
  const n = o.count;
  const pos = new Float32Array(n * 3);
  const dat = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = (k) => hash(i * 7 + k, Math.floor(o.seed * 13), 101);
    pos.set([o.at.x + (r(1) - 0.5) * 2 * o.spread, o.at.y + (r(2) - 0.5) * 2 * (o.spreadY ?? o.spread * 0.3), o.at.z + (r(3) - 0.5) * 2 * o.spread], i * 3);
    dat.set([r(4) * o.life, o.size * (0.6 + r(5) * 0.8), r(6), r(7)], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dat, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uT: { value: 0 }, uLife: { value: o.life }, uVel: { value: new THREE.Vector3(...o.vel) }, uTurb: { value: o.turb ?? 0 }, uGrow: { value: o.grow ?? 0 }, uPix: { value: 700 }, uColor: { value: new THREE.Color(o.color) }, uAlpha: { value: o.alpha ?? 1 }, uGlow: { value: o.additive ? 1 : 0 } },
    vertexShader: `attribute vec4 aD; uniform float uT, uLife, uTurb, uGrow, uPix; uniform vec3 uVel; varying float vL; varying float vS;
      void main(){ float age = mod(uT + aD.x, uLife); float l = age / uLife; vL = l; vS = aD.z;
        vec3 p = position + uVel * age;
        p.x += sin(age * 1.7 + aD.z * 30.0) * uTurb * (0.3 + l);
        p.z += cos(age * 1.3 + aD.w * 30.0) * uTurb * (0.3 + l);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aD.y * (1.0 + uGrow * l) * uPix / max(0.1, -mv.z); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha, uGlow; varying float vL; varying float vS;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float d = 1.0 - smoothstep(0.2, 1.0, r); if (d <= 0.0) discard;
        float a = d * smoothstep(0.0, 0.15, vL) * (1.0 - smoothstep(0.55, 1.0, vL)) * uAlpha;
        float tw = 0.7 + 0.3 * sin(vL * 40.0 + vS * 20.0);
        gl_FragColor = vec4(uColor * mix(1.0, 1.2 + tw * 0.6, uGlow), a); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return {
    obj: pts,
    update: (t, pix) => {
      mat.uniforms.uT.value = t;
      if (pix) mat.uniforms.uPix.value = pix;
    },
    dispose: () => {
      g.dispose();
      mat.dispose();
    },
  };
}

let _noiseTex = null;
/** Tileable fBm noise texture (256², period 8) for cheap shader noise. */
function noiseTexture() {
  if (_noiseTex) return _noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * 8;
      const v = (y / N) * 8;
      const n = fbm(u, v, { octaves: 4, period: 8, seed: 5 });
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = n * 255;
      data[i + 3] = 255;
    }
  }
  _noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  _noiseTex.wrapS = _noiseTex.wrapT = THREE.RepeatWrapping;
  _noiseTex.magFilter = THREE.LinearFilter;
  _noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  _noiseTex.generateMipmaps = true;
  _noiseTex.needsUpdate = true;
  return _noiseTex;
}

const _rugs = [];
const _ivy = [];
/** Climbing ivy: dense leaf clusters thinning toward the top, alpha-tested. */
function ivyMaterial(k) {
  if (_ivy[k]) return _ivy[k];
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d');
  let sd = 17 + k * 101;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  // Woody stems first.
  g.strokeStyle = '#2a1e12';
  g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    let x = 20 + rnd() * 88;
    let y = 192;
    g.beginPath();
    g.moveTo(x, y);
    while (y > 20) {
      x += (rnd() - 0.5) * 14;
      y -= 6 + rnd() * 10;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 1100; i++) {
    const y = 192 * rnd(); // height from the root (bottom)
    const spread = 0.5 + 0.5 * (y / 192);
    const x = 64 + (rnd() - 0.5) * 128 * spread;
    // Dense at the root, ragged and thinning toward the top.
    if (rnd() > 1 - 0.8 * Math.pow(y / 192, 1.3)) continue;
    const r = 2.5 + rnd() * 3.5;
    const sh = 0.35 + rnd() * 0.65;
    g.fillStyle = `rgb(${Math.round(20 + 30 * sh)},${Math.round(34 + 40 * sh)},${Math.round(14 + 14 * sh)})`;
    g.beginPath();
    g.ellipse(x, 192 - y, r, r * 0.75, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _ivy[k] = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, roughness: 0.8, side: THREE.DoubleSide });
  return _ivy[k];
}

function rugMaterial(k) {
  if (_rugs[k]) return _rugs[k];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 176;
  const g = c.getContext('2d');
  const pal = [['#6a1a18', '#c89a3a', '#2a1a40'], ['#1a3a5a', '#d8b870', '#5a1a18'], ['#3a4a1a', '#c8a050', '#2a1a10']][k % 3];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, 256, 176);
  g.strokeStyle = pal[1];
  g.lineWidth = 6;
  g.strokeRect(10, 10, 236, 156);
  g.lineWidth = 2;
  g.strokeRect(22, 22, 212, 132);
  g.fillStyle = pal[2];
  g.beginPath();
  g.moveTo(128, 40); g.lineTo(190, 88); g.lineTo(128, 136); g.lineTo(66, 88); g.closePath();
  g.fill();
  g.strokeStyle = pal[1];
  g.stroke();
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${hash(i, 1, 9) * 0.12})`;
    g.fillRect(hash(i, 2, 9) * 256, hash(i, 3, 9) * 176, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _rugs[k] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
  return _rugs[k];
}

/** Small vertex-coloured weed clumps (blades / rosettes / dry stalks / clover). */
function weedGeo(kind, seed) {
  const P = [];
  const C = [];
  const r = (i, k) => hash(i, k, seed * 31);
  const tri = (a, b, c, ca, cb, cc) => {
    P.push(...a, ...b, ...c);
    C.push(...ca, ...cb, ...cc);
  };
  const col = (h, s2, v) => new THREE.Color().setHSL(h, s2, v);
  if (kind === 'grass' || kind === 'dry') {
    const n = kind === 'dry' ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const a = r(i, 1) * Math.PI * 2;
      const lean = 0.15 + r(i, 2) * 0.5;
      const h = (kind === 'dry' ? 0.22 : 0.12) + r(i, 3) * (kind === 'dry' ? 0.22 : 0.16);
      const w = 0.012 + r(i, 4) * 0.012;
      const bx = Math.cos(a) * r(i, 5) * 0.05;
      const bz = Math.sin(a) * r(i, 5) * 0.05;
      const tx = bx + Math.cos(a) * lean * h;
      const tz = bz + Math.sin(a) * lean * h;
      const px = -Math.sin(a) * w;
      const pz = Math.cos(a) * w;
      const base = kind === 'dry' ? col(0.09, 0.35, 0.18) : col(0.22 + r(i, 6) * 0.05, 0.5, 0.12);
      const tip = kind === 'dry' ? col(0.11, 0.4, 0.45 + r(i, 7) * 0.15) : col(0.17 + r(i, 6) * 0.08, 0.55, 0.32 + r(i, 7) * 0.12);
      tri([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [tx, h, tz], base.toArray(), base.toArray(), tip.toArray());
    }
  } else {
    const n = kind === 'clover' ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r(i, 1) * 0.4;
      const len = kind === 'clover' ? 0.05 + r(i, 2) * 0.03 : 0.09 + r(i, 2) * 0.06;
      const wd = kind === 'clover' ? 0.03 : 0.025;
      const up = kind === 'clover' ? 0.04 + r(i, 3) * 0.03 : 0.02 + r(i, 3) * 0.04;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const o = kind === 'clover' ? 0.02 + r(i, 4) * 0.05 : 0;
      const b = [ca * o, up * 0.3, sa * o];
      const m1 = [ca * (o + len * 0.5) - sa * wd, up, sa * (o + len * 0.5) + ca * wd];
      const m2 = [ca * (o + len * 0.5) + sa * wd, up, sa * (o + len * 0.5) - ca * wd];
      const t = [ca * (o + len), up * 0.7, sa * (o + len)];
      const c0 = col(kind === 'clover' ? 0.3 : 0.24, 0.45, 0.13).toArray();
      const c1 = col(kind === 'clover' ? 0.3 : 0.2, 0.5, 0.26 + r(i, 5) * 0.08).toArray();
      tri(b, m1, t, c0, c1, c1);
      tri(b, t, m2, c0, c1, c1);
    }
    if (kind === 'rosette') {
      // A dandelion-yellow flower head.
      const y = 0.14;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        tri([0, 0.02, 0], [Math.cos(a) * 0.006, y, Math.sin(a) * 0.006], [Math.cos(a + 1.2) * 0.006, y, Math.sin(a + 1.2) * 0.006], col(0.25, 0.4, 0.15).toArray(), col(0.25, 0.4, 0.2).toArray(), col(0.25, 0.4, 0.2).toArray());
        tri([0, y, 0], [Math.cos(a) * 0.022, y + 0.004, Math.sin(a) * 0.022], [Math.cos(a + 0.6) * 0.022, y + 0.004, Math.sin(a + 0.6) * 0.022], col(0.13, 0.85, 0.5).toArray(), col(0.14, 0.9, 0.55).toArray(), col(0.14, 0.9, 0.55).toArray());
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  // Light from above: bias normals upward so double-sided blades don't go black.
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    const v = new THREE.Vector3(nrm.getX(i), Math.abs(nrm.getY(i)) + 0.8, nrm.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function barrelGeo() {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const y = (i / 8) * 1.0;
    pts.push(new THREE.Vector2(0.34 + Math.sin((i / 8) * Math.PI) * 0.07, y));
  }
  pts.unshift(new THREE.Vector2(0.001, 0));
  pts.push(new THREE.Vector2(0.001, 1.0));
  const g = new THREE.LatheGeometry(pts, 16);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.4, uv.getY(i) * 0.9);
  return g;
}

function barrelHoops() {
  const parts = [0.12, 0.5, 0.88].map((y) => {
    const r = 0.345 + Math.sin(y * Math.PI) * 0.07;
    const t = new THREE.TorusGeometry(r, 0.018, 4, 20);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    return t;
  });
  return mergeList(parts);
}

function crateFrame(s) {
  const e = 0.07;
  const parts = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const g = new THREE.BoxGeometry(e, s + 0.01, e);
    g.translate((x * (s - e)) / 2 + x * 0.005, 0, (z * (s - e)) / 2 + z * 0.005);
    parts.push(g);
  }
  for (const y of [-1, 1]) {
    for (const [w, d, x, z] of [[s, e, 0, -1], [s, e, 0, 1], [e, s, -1, 0], [e, s, 1, 0]]) {
      const g = new THREE.BoxGeometry(w + 0.01, e, d + 0.01);
      g.translate((x * (s - e)) / 2, (y * (s - e)) / 2, (z * (s - e)) / 2);
      parts.push(g);
    }
  }
  return mergeList(parts);
}

function mergeList(list) {
  let g = list[0];
  for (let i = 1; i < list.length; i++) g = mergeTwo(g, list[i]);
  return g;
}

/** Irregular rock: jittered icosahedron. */
/** Temple banner: Tyr's scales on deep red, gilt border, a tattered hem (alpha). */
function heraldryTex(field, gilt) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const g = c.getContext('2d');
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(field);
  g.fillRect(0, 0, 128, 320);
  // Weave + grime.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${hash(i, 1, 601) * 0.18})`;
    g.fillRect(hash(i, 2, 601) * 128, hash(i, 3, 601) * 320, 2, 1);
  }
  const grd = g.createLinearGradient(0, 0, 0, 320);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(20,10,0,0.45)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 320);
  g.strokeStyle = hex(gilt);
  g.lineWidth = 5;
  g.strokeRect(9, 9, 110, 260);
  // The scales of Tyr.
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(64, 70); g.lineTo(64, 190);
  g.moveTo(26, 95); g.lineTo(102, 95);
  g.moveTo(30, 95); g.lineTo(22, 135); g.moveTo(30, 95); g.lineTo(42, 135);
  g.moveTo(98, 95); g.lineTo(86, 135); g.moveTo(98, 95); g.lineTo(110, 135);
  g.moveTo(44, 190); g.lineTo(84, 190);
  g.stroke();
  g.fillStyle = hex(gilt);
  for (const cx of [32, 98]) {
    g.beginPath();
    g.ellipse(cx, 136, 14, 6, 0, 0, Math.PI);
    g.fill();
  }
  g.beginPath();
  g.arc(64, 64, 7, 0, Math.PI * 2);
  g.fill();
  // Tattered hem: cut away a ragged band (alpha-tested).
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(0, 320);
  for (let x = 0; x <= 128; x += 8) g.lineTo(x, 280 + hash(x, 4, 601) * 36 + (x % 16 ? 10 : 0));
  g.lineTo(128, 320);
  g.closePath();
  g.fill();
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(hash(i, 5, 601) * 128, 60 + hash(i, 6, 601) * 200, 3 + hash(i, 7, 601) * 5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fluted column shaft (base at y=0); a broken one gets a jagged, sheared top. */
function columnGeo(h, broken, seed) {
  const g = new THREE.CylinderGeometry(0.31, 0.35, h, 24, Math.max(2, Math.round(h * 3)), false);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.05) {
      // The break's centre sits in the middle of the fracture, not on a spike.
      if (broken && y > h - 0.01) pos.setY(i, h - 0.26);
      continue;
    }
    const a = Math.atan2(z, x);
    const k = 1 - Math.max(0, Math.cos(a * 12)) * 0.06;
    let ny = y;
    // A conchoidal, sheared break: smooth undulation round the rim plus a slant.
    if (broken && y > h - 0.01) ny = h - 0.12 - (Math.sin(a * 3 + seed * 5.1) * 0.08 + Math.sin(a * 7 + seed * 2.3) * 0.04) - Math.cos(a + seed) * 0.16;
    pos.setXYZ(i, x * k, ny, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe-turned furniture leg (base at y=0): bead, taper, collar, foot. */
function turnedLeg(h, r) {
  const prof = [[0.0, 0], [r * 1.1, 0], [r * 1.2, h * 0.04], [r * 0.8, h * 0.09], [r * 0.75, h * 0.3], [r * 1.25, h * 0.36], [r * 0.8, h * 0.42], [r * 0.95, h * 0.7], [r * 1.3, h * 0.78], [r * 1.0, h * 0.84], [r * 1.05, h], [0, h]];
  return new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 8);
}

/** A soft, rounded slab (mattress, pillow): a box with its edges pillowed. */
function softSlab(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 2, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2);
    const z = pos.getZ(i) / (d / 2);
    const y = pos.getY(i);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const puff = 1 - edge ** 4;
    pos.setY(i, y > 0 ? y * (0.55 + 0.45 * puff) : y);
    pos.setX(i, pos.getX(i) * (1 - 0.06 * (y > 0 ? 1 - puff : 0)));
    pos.setZ(i, pos.getZ(i) * (1 - 0.06 * (y > 0 ? 1 - puff : 0)));
  }
  g.computeVertexNormals();
  return g;
}

/** A cloth sheet lying over a surface and falling over its edges by `fall` (blanket). */
function drape(w, d, fall) {
  const g = new THREE.PlaneGeometry(w + fall * 2, d + fall * 2, 14, 14).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ox = Math.max(0, Math.abs(x) - w / 2);
    const oz = Math.max(0, Math.abs(z) - d / 2);
    const o = Math.max(ox, oz);
    const wr = Math.sin(x * 9.0 + z * 3.0) * 0.012 + Math.sin(z * 7.0) * 0.01;
    pos.setXYZ(i, x - Math.sign(x) * ox * 0.85, -o * 0.95 + wr, z - Math.sign(z) * oz * 0.85);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A dressed ashlar block: a box with chamfered (worn) edges and slightly
 * irregular corners (convex hull), world-scaled planar UVs per face.
 * `wear` jitters the corner points (broken blocks use a large value).
 */
function chamferBox(w, h, d, c = 0.035, seed = 0, wear = 0.012, texScale = 2.2) {
  const pts = [];
  const cw2 = Math.min(c, w * 0.3);
  const ch2 = Math.min(c, h * 0.3);
  const cd2 = Math.min(c, d * 0.3);
  let k = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const j = () => (hash(seed, k++, 91) - 0.5) * 2 * wear;
    const X = sx * w / 2, Y = sy * h / 2, Z = sz * d / 2;
    pts.push(new THREE.Vector3(X - sx * cw2 + j(), Y + j() * 0.5, Z - sz * cd2 + j()));
    pts.push(new THREE.Vector3(X + j() * 0.5, Y - sy * ch2 + j(), Z - sz * cd2 + j()));
    pts.push(new THREE.Vector3(X - sx * cw2 + j(), Y - sy * ch2 + j(), Z + j() * 0.5));
  }
  const g = new ConvexGeometry(pts);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2, y = pos.getY(i) + h / 2, z = pos.getZ(i) + d / 2;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) { uv[i * 2] = x / texScale; uv[i * 2 + 1] = z / texScale; }
    else if (nx >= nz) { uv[i * 2] = z / texScale; uv[i * 2 + 1] = y / texScale; }
    else { uv[i * 2] = x / texScale; uv[i * 2 + 1] = y / texScale; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function rockGeo(seed, size) {
  const g = new THREE.IcosahedronGeometry(size, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.7 + hash(Math.round(x * 50), Math.round(y * 50) + Math.round(z * 50) * 7, Math.floor(seed * 1000)) * 0.55;
    pos.setXYZ(i, x * k * 1.2, Math.max(-size * 0.2, y * k * 0.6), z * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 1.5, pos.getZ(i) * 1.5 + pos.getY(i));
  return g;
}

/**
 * Animated flame billboard (noise-shaped fire in a shader) + glow halo.
 * userData.update(t) animates it from absolute time (freeze-safe).
 */
export function makeFlame(size = 0.4, seed = 0, o = {}) {
  const grp = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      mv.xy += position.xy * sc;
      gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime, uSeed;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 uv = vUv;
        float t = uTime * 2.2 + uSeed;
        float turb = n(vec2(uv.x * 4.0, uv.y * 3.0 - t * 1.6)) * 0.6 + n(vec2(uv.x * 9.0, uv.y * 7.0 - t * 2.7)) * 0.4;
        float x = (uv.x - 0.5) * 2.0;
        float shape = 1.0 - smoothstep(0.0, 1.0, abs(x) / (0.9 * (1.0 - uv.y) + 0.05));
        float body = shape * smoothstep(1.0, 0.1, uv.y + turb * 0.55 - 0.2) * smoothstep(0.0, 0.12, uv.y);
        vec3 c = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.8, 0.35), smoothstep(0.35, 0.9, body));
        c = mix(c, vec3(1.0, 0.97, 0.85), smoothstep(0.85, 1.0, body));
        gl_FragColor = vec4(c * body * 2.2, body);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.6).translate(0, 0.55, 0), mat);
  quad.scale.setScalar(size);
  quad.renderOrder = 5;
  quad.frustumCulled = false;
  grp.add(quad);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xff8030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  glow.scale.setScalar(size * 4.5 * (o.glow ?? 1));
  glow.position.y = size * 0.4;
  grp.add(glow);
  grp.userData.update = (t) => {
    mat.uniforms.uTime.value = t;
    const f = 0.85 + 0.1 * Math.sin(t * 13 + seed) + 0.05 * Math.sin(t * 29.7 + seed * 3);
    glow.material.opacity = 0.4 * f * (o.glowA ?? 1);
    quad.scale.set(size * (0.95 + 0.08 * Math.sin(t * 9 + seed)), size * (0.95 + 0.12 * Math.sin(t * 7.3 + seed * 2)), 1);
  };
  grp.userData.dispose = () => {
    mat.dispose();
    quad.geometry.dispose();
    glow.material.dispose();
  };
  return grp;
}
