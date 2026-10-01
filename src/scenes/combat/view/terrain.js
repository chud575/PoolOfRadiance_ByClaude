import * as THREE from 'three';
import { getTextureSet } from '../../../render/textures/index.js';
import { getGlowTexture } from '../../../render/textures/index.js';
import { CELL, EDGE } from '../../../data/maps/MapGrid.js';
import { SUB } from '../logic/battlefield.js';
import { Batcher, worldBox, wallQuad } from './batch.js';
import { pbr } from './textures.js';
import { fbm } from '../../../render/textures/noise.js';

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
        diffuseColor.rgb *= mix(${(1 - grime).toFixed(3)}, 1.0, smoothstep(0.0, 1.4, vMWPos.y));
        ${grime > 0 ? `// Rain streaks running down from sills and copings; moss creeping up the base.
        float stk = smoothstep(0.55, 0.9, mNoise(vec3(vMWPos.x * 2.3, vMWPos.y * 0.16, vMWPos.z * 2.3)));
        diffuseColor.rgb *= 1.0 - stk * 0.3 * smoothstep(0.4, 2.0, vMWPos.y);
        float baseMoss = (1.0 - smoothstep(0.05, 0.75, vMWPos.y)) * smoothstep(0.4, 0.7, mNoise(vMWPos * 1.7));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.19, 0.09), baseMoss * 0.6);` : ''}`);
  };
  mat.customProgramCacheKey = () => `${key}-${scale}-${amount}-${grime}-v3`;
  return mat;
}

/** Textured PBR material from the shared library set, tinted (own instance). */
const libCache = new Map();
function libMat(set, color = 0xffffff, o = {}) {
  const key = `${set}|${color}|${o.rough ?? ''}`;
  if (libCache.has(key)) return libCache.get(key);
  const t = getTextureSet(set);
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, color, roughness: o.rough ?? 1, metalness: 0, normalScale: new THREE.Vector2(1.7, 1.7) });
  addMacro(m, { key: 'lib', amount: 0.55 });
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

  // ---------------------------------------------------------------- cells
  const cellX0 = field.cx0 - RING;
  const cellY0 = field.cy0 - RING;
  const cellsW = field.cellsW + RING * 2;
  const cellsH = field.cellsH + RING * 2;
  const inWin = (mx, my) => mx >= field.cx0 && my >= field.cy0 && mx < field.cx0 + field.cellsW && my < field.cy0 + field.cellsH;
  const reach = (mx, my) => field.reachCells?.has(`${mx},${my}`) ?? (inWin(mx, my));
  const inMap = (mx, my) => (map ? map.inBounds(mx, my) : true);
  const cellType = (mx, my) => (map ? map.getCell(mx, my) : CELL.STREET);
  /** solid = rendered as a building mass */
  const solid = (mx, my) => {
    if (!inMap(mx, my)) return false;
    if (inWin(mx, my)) return !reach(mx, my) && cellType(mx, my) !== CELL.WATER;
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
      const rub = k === 'rubble' ? 1 : k === 'outside' ? 0.85 : k === 'house' ? 0.5 : 0;
      void n;
      const flag = k === 'flag' || k === 'room' ? 1 : 0;
      // Puddles in low spots of the street.
      const pn = hash(Math.floor(sx / 2), Math.floor(sy / 2), 91);
      const wet = (k === 'street' || k === 'flag') && pn > (night ? 0.8 : 0.86) ? 180 : 0;
      sp[i] = ao * 255;
      sp[i + 1] = rub * 255;
      sp[i + 2] = flag * 255;
      sp[i + 3] = wet;
    }
  }
  const splat = new THREE.DataTexture(sp, SW * RES, SH * RES, THREE.RGBAFormat);
  splat.magFilter = THREE.LinearFilter;
  splat.minFilter = THREE.LinearFilter;
  splat.needsUpdate = true;
  disposables.push(splat);
  // Street: small granite setts (~11 cm); temple / courtyard: dressed rectangular
  // flagstones; rubble: packed dirt and grit. Each its own albedo/normal/roughness set.
  const cob = getTextureSet('hd_cobble');
  const rub = getTextureSet('floor_rubble');
  const flg = getTextureSet('hd_flags');
  const groundMat = new THREE.MeshStandardMaterial({ map: cob.map, normalMap: cob.normalMap, roughnessMap: cob.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.3, 1.3) });
  const originX = -margin * TILE;
  const originZ = -margin * TILE;
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tSplat: { value: splat },
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
        uniform sampler2D tSplat, map2, normal2, rough2, map3, normal3, rough3;
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
        float wF = smoothstep(0.35, 0.65, gs.b + (gn - 0.5) * 0.25);
        float wet = smoothstep(0.35, 0.6, gs.a + (gFbm(vWPos.xz * 0.9) - 0.5) * 0.6);
        vec2 uv1 = vec2(vWPos.x, -vWPos.z) / 1.3;
        vec2 uv2 = vec2(vWPos.x, -vWPos.z) / 3.2 + 0.37;
        vec2 uv3 = vec2(vWPos.x, -vWPos.z) / 2.7;
        vec4 gc = texture2D(map, uv1);
        if (wR > 0.001) gc = mix(gc, texture2D(map2, uv2), wR);
        if (wF > 0.001) gc = mix(gc, texture2D(map3, uv3), wF);
        float mac = gFbm(vWPos.xz * 0.07);
        gc.rgb *= 0.78 + 0.42 * mac;
        // Kerbs: a lighter dressed-stone band with a dark gutter where paving changes.
        float kerb = 1.0 - abs(wF - 0.5) * 2.0;
        gc.rgb = mix(gc.rgb, vec3(0.5, 0.47, 0.43) * (0.85 + 0.3 * gn), smoothstep(0.62, 0.92, kerb) * 0.8);
        gc.rgb *= 1.0 - smoothstep(0.3, 0.5, kerb) * (1.0 - smoothstep(0.5, 0.62, kerb)) * 0.45;
        // Mortar gaps (dark in the albedo) collect moss and grime in patches.
        float lum = dot(gc.rgb, vec3(0.3, 0.55, 0.15));
        float gap = 1.0 - smoothstep(0.08, 0.2, lum);
        float mossN = smoothstep(0.42, 0.7, gFbm(vWPos.xz * 0.33 + 4.0));
        gc.rgb = mix(gc.rgb, vec3(0.13, 0.17, 0.07), gap * mossN * 0.85);
        // Worn, polished wheel/foot paths.
        float worn = smoothstep(0.55, 0.78, gFbm(vWPos.xz * 0.09 + 11.0)) * (1.0 - wR);
        gc.rgb *= 1.0 + 0.14 * worn;
        // Dirt drifts heaped against walls, broken up by noise.
        float drift = smoothstep(0.08, 0.5, 1.0 - gAO) * smoothstep(0.3, 0.6, gFbm(vWPos.xz * 0.6 + 2.0) + (1.0 - gAO) * 0.4);
        gc.rgb = mix(gc.rgb, vec3(0.24, 0.2, 0.15) * (0.75 + 0.5 * gn), drift * 0.8);
        gc.rgb = mix(gc.rgb, gc.rgb * vec3(0.95, 0.9, 0.82), smoothstep(0.55, 0.8, gFbm(vWPos.xz * 0.21 + 3.0)) * 0.6);
        // Gutters: a damp, darker band along wall feet and kerbs (rain runs off the eaves).
        float gutter = smoothstep(0.9, 0.62, gAO) * (1.0 - wR) * smoothstep(0.25, 0.55, gFbm(vWPos.xz * 0.8 + 5.0) + (1.0 - gAO) * 0.5);
        wet = max(wet, gutter * 0.7);
        gc.rgb *= mix(1.0, 0.42, wet);
        gc.rgb *= mix(0.35, 1.0, gAO);
        diffuseColor *= gc;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float gr = texture2D(roughnessMap, uv1).g;
        if (wR > 0.001) gr = mix(gr, texture2D(rough2, uv2).g, wR);
        if (wF > 0.001) gr = mix(gr, texture2D(rough3, uv3).g, wF);
        float roughnessFactor = roughness * gr;
        roughnessFactor *= 1.0 - 0.25 * smoothstep(0.55, 0.78, gFbm(vWPos.xz * 0.09 + 11.0));
        roughnessFactor = mix(roughnessFactor, 0.22, wet);
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = texture2D(normalMap, uv1).xyz * 2.0 - 1.0;
        if (wR > 0.001) mapN = mix(mapN, texture2D(normal2, uv2).xyz * 2.0 - 1.0, wR);
        if (wF > 0.001) mapN = mix(mapN, texture2D(normal3, uv3).xyz * 2.0 - 1.0, wF);
        mapN = normalize(mapN);
        mapN.xy *= normalScale * (1.0 - wet * 0.9);
        normal = normalize( tbn * mapN );
      `)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.5, 1.0, gAO);
      `);
  };
  groundMat.customProgramCacheKey = () => 'combat-ground-v4';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SW * TILE, SH * TILE, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(originX + (SW * TILE) / 2, 0, originZ + (SH * TILE) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(ground.geometry, groundMat);

  // Room floors (reachable interiors) — planks.
  const plank = pbr('plank', 0x9a8878);
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
  const wallMats = [libMat('wall_stone', 0xd8d0c4), libMat('wall_timber', 0xe8e0d0), libMat('wall_ruin', 0xc8beb0)];
  const plinthMat = libMat('wall_stone', 0x8a8278);
  const capMat = libMat('wall_ruin', 0x6a6258);
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
  const glassLit = new THREE.MeshStandardMaterial({ color: 0x201008, emissive: 0xffa040, emissiveIntensity: night ? 1.5 : 0.25, roughness: 0.4 });
  const glassDark = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.15, metalness: 0.2 });
  disposables.push(glassLit, glassDark);

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
  for (const cells of comps) {
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    const filled = cells.length === (x1 - x0 + 1) * (y1 - y0 + 1);
    const rects = filled ? [[x0, y0, x1, y1]] : cells.map(([x, y]) => [x, y, x, y]);
    for (const r of rects) houses.push(makeHouse(r));
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
    const style = houseStyle(r);
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
      // Houses no longer cut away into dollhouses: they dither out where they
      // would hide the fight (see setView), so only the full variant is built.
      for (const variant of ['full']) {
        const B = house[variant];
        const hh = variant === 'cut' ? 1.05 + seed * 0.25 : height;
        if (ruined && variant === 'full') {
          // Jagged broken wall top.
          const segs = Math.max(2, Math.round(len / 1.1));
          for (let k = 0; k < segs; k++) {
            const sh = hh * (0.55 + hash(k, f.d.charCodeAt(0), seed * 100) * 0.45) * (k === 0 || k === segs - 1 ? 1 : 1);
            const sl = len / segs;
            B.add(place(worldBox(sl + 0.02, sh, 0.34, 2.5), k * sl + sl / 2, sh / 2, -0.17), wallMat);
          }
        } else {
          B.add(place(wallQuad(len, hh, 2.6), 0, 0, 0), wallMat);
          // Back faces so cut-aways read as thick walls.
          if (variant === 'cut') {
            B.add(place(worldBox(len, 0.08, 0.34, 2.5), len / 2, hh, -0.17), capMat);
            B.add(place(wallQuad(len, hh, 2.6).rotateY(Math.PI).translate(len, 0, -0.34), 0, 0, 0), wallMat);
          }
        }
        // Plinth.
        B.add(place(worldBox(len + 0.1, 0.45, 0.1, 2.5), len / 2, 0.225, 0.03), plinthMat);
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
            B.add(place(worldBox(1.15, 2.05, 0.08, 1.2), d.at, 1.03, 0.01), d.type === EDGE.ARCH ? glassDark : doorMat);
            B.add(place(worldBox(1.45, 0.2, 0.2, 1), d.at, 2.15, 0.06), style === 1 ? darkWood : plinthMat);
            for (const sx of [-1, 1]) B.add(place(worldBox(0.16, 2.1, 0.18, 1), d.at + sx * 0.66, 1.05, 0.05), style === 1 ? darkWood : plinthMat);
            B.add(place(worldBox(1.5, 0.12, 0.5, 1), d.at, 0.06, 0.25), plinthMat);
            B.add(place(new THREE.TorusGeometry(0.07, 0.015, 5, 10), d.at + 0.35, 1.05, 0.07), ironMat, { cast: false });
            torchSpots.push({ x: ox + Math.cos(yaw) * (d.at + 1.0) + Math.sin(yaw) * 0.35, z: oz - Math.sin(yaw) * (d.at + 1.0) + Math.cos(yaw) * 0.35, y: 2.35, yaw, house });
          }
          if (!doors.length && len > 3) torchSpots.push({ x: ox + Math.cos(yaw) * (len / 2) + Math.sin(yaw) * 0.35, z: oz - Math.sin(yaw) * (len / 2) + Math.cos(yaw) * 0.35, y: 2.4, yaw, house });
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
    void furnish;
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
        const g = worldBox(alongX ? 0.2 : len, cutH * 0.95, alongX ? len : 0.2, 2.5);
        B.add(g, wallMats[house.style === 1 ? 1 : 0], { p: [alongX ? at : mid, (cutH * 0.95) / 2, alongX ? mid : at] });
        B.add(worldBox(alongX ? 0.24 : len, 0.06, alongX ? len : 0.24, 2.5), capMat, { p: [alongX ? at : mid, cutH * 0.95 + 0.03, alongX ? mid : at] });
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
    for (let k = 0; k < Math.min(18, 3 + nRooms * 3); k++) pieces.push(base[Math.floor(hash(k, 5, seed * 333) * base.length)]);
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
          for (const [dx, dz] of [[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]]) B.add(worldBox(0.08, 0.72, 0.08, 1), darkWood, { p: [tx + dx, 0.36, tz + dz] });
          for (const [dx, dz] of [[-0.4, -0.75], [0.4, 0.75], [0.0, -0.75]]) {
            B.add(worldBox(0.42, 0.06, 0.42, 1), woodMat, { p: [tx + dx, 0.46, tz + dz] });
            for (const [ex, ez] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) B.add(worldBox(0.05, 0.44, 0.05, 1), darkWood, { p: [tx + dx + ex, 0.22, tz + dz + ez] }, { cast: false });
          }
          // Tankard and candle.
          B.add(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), ironMat, { p: [tx + 0.3, 0.86, tz + 0.1] }, { cast: false });
          B.add(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), pbr('glow', 0xeee0c0, { emissive: 0xffb050, emissiveIntensity: night ? 1.5 : 0.2 }), { p: [tx - 0.2, 0.87, tz - 0.1] }, { cast: false });
          take(tx - 1.1, tz - 0.9, tx + 1.1, tz + 0.9);
          break;
        }
        if (!free(cx - ww / 2, cz - dd / 2, cx + ww / 2, cz + dd / 2)) continue;
        if (kind === 'bed') {
          B.add(worldBox(ww, 0.3, dd, 1), darkWood, { p: [cx, 0.2, cz] });
          B.add(worldBox(ww - 0.1, 0.16, dd - 0.1, 1), pbr('cloth', 0xd8ccb0), { p: [cx, 0.42, cz] });
          const bx = vert ? ww - 0.06 : ww * 0.98;
          const bz = vert ? dd * 0.62 : dd - 0.06;
          B.add(worldBox(bx, 0.06, bz, 1), pbr('cloth', blanket), { p: [cx + (vert ? 0 : 0), 0.52, cz + (vert ? (side === 0 ? 0.3 : 0.3) : 0.3)] });
          B.add(worldBox(vert ? 0.6 : 0.5, 0.12, vert ? 0.35 : 0.6, 1), pbr('cloth', 0xe8e0d0), { p: [cx + (vert ? 0 : -ww * 0.3), 0.56, cz + (vert ? -dd * 0.36 : 0)] });
        } else if (kind === 'barrels') {
          B.add(barrelGeo(), barrelMat, { p: [cx - 0.2, 0, cz], s: 0.9 });
          B.add(barrelHoops(), ironMat, { p: [cx - 0.2, 0, cz], s: 0.9 });
          if (r2 > 0.4) B.add(barrelGeo(), barrelMat, { p: [cx + 0.35, 0, cz + 0.2], s: 0.75 });
        } else if (kind === 'chest') {
          B.add(worldBox(ww * 0.8, 0.5, dd * 0.7, 1), woodMat, { p: [cx, 0.25, cz] });
          B.add(worldBox(ww * 0.82, 0.06, dd * 0.72, 1), ironMat, { p: [cx, 0.48, cz] });
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
        if (hash(mx, my, seed * 71) > 0.55) continue;
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
          const g = worldBox(horiz ? sl + 0.01 : 0.42, hh, horiz ? 0.42 : sl + 0.01, 2.5);
          B.add(g, mat, { p: [horiz ? ox + sa + sl / 2 : ox, hh / 2, horiz ? oz : oz + sa + sl / 2] });
          if (!ruined || variant === 'cut') B.add(worldBox(horiz ? sl + 0.02 : 0.5, 0.08, horiz ? 0.5 : sl + 0.02, 2.5), capMat, { p: [horiz ? ox + sa + sl / 2 : ox, hh + 0.04, horiz ? oz : oz + sa + sl / 2] });
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
    const wallMat = libMat('wall_stone', 0xb8b0a4);
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
      const s = 0.8 + r * 3;
      batch.add(worldBox(s, s, s, 1.2), crateMat, { p: [x, s / 2, z], r: [0, r * 20, 0] });
      batch.add(crateFrame(s), darkWood, { p: [x, s / 2, z], r: [0, r * 20, 0] });
      if (r > 0.055) batch.add(worldBox(0.6, 0.6, 0.6, 1.2), crateMat, { p: [x + 0.1, s + 0.3, z], r: [0, r * 40, 0] });
    } else if (p.type === 'rubble') {
      for (let k = 0; k < 5; k++) batch.add(rockGeo(hash(p.x, p.y + k, 3), 0.25 + hash(p.x + k, p.y, 4) * 0.35), rockMat, { p: [x + (hash(k, p.x, 5) - 0.5) * 0.9, 0.05, z + (hash(k, p.y, 6) - 0.5) * 0.9] });
    } else if (p.type === 'column') {
      // Fluted columns: some still carry their capital, others snapped off with
      // drums tumbled at the foot.
      const colMat = libMat('wall_stone', 0xd8d0c0);
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
      const colMat = libMat('wall_stone', 0xd0c8b8);
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
    const torch = { x: t.x, y: t.y + 0.35, z: t.z, house: t.house, flame: f };
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
        cands.push({ x, y, score: -Math.abs(d - 5) + hash(x, y, 71) * 1.5 });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const placed = [];
    for (const c of cands) {
      if (placed.length >= (night ? 2 : 1)) break;
      if (placed.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 7)) continue;
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
      const robe = new THREE.LatheGeometry([[0.001, 0], [0.44, 0], [0.4, 0.5], [0.33, 1.1], [0.3, 1.5], [0.36, 1.85], [0.2, 2.05], [0.09, 2.12]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
      robe.scale(1, 1, 0.8);
      batch.add(robe, stoneT, { p: [sx, 1.02, sz] });
      // Head with a carved blindfold, beard.
      batch.add(new THREE.SphereGeometry(0.17, 16, 12), stoneT, { p: [sx, 3.3, sz + 0.02] });
      batch.add(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 16), pbr('cloth', 0x3a3632), { p: [sx, 3.33, sz + 0.02] }, { cast: false });
      batch.add(new THREE.ConeGeometry(0.12, 0.26, 10), stoneT, { p: [sx, 3.08, sz + 0.1], r: [Math.PI, 0, 0] });
      // Left arm raised, holding the warhammer of justice.
      batch.add(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 8), stoneT, { p: [sx - 0.42, 3.15, sz + 0.05], r: [0, 0, -0.5] });
      batch.add(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), stoneT, { p: [sx - 0.62, 3.6, sz + 0.05] });
      batch.add(worldBox(0.38, 0.2, 0.2, 1), stoneT, { p: [sx - 0.62, 4.2, sz + 0.05] });
      // Right arm ends at the wrist (Tyr's lost hand); the scales hang from it.
      batch.add(new THREE.CylinderGeometry(0.065, 0.055, 0.6, 8), stoneT, { p: [sx + 0.36, 2.8, sz + 0.18], r: [0.6, 0, 0.5] });
      batch.add(new THREE.CylinderGeometry(0.016, 0.016, 0.9, 6).rotateZ(Math.PI / 2), pbr('gold', 0x8a6a2a), { p: [sx + 0.5, 2.62, sz + 0.42] });
      for (const dx of [-0.42, 0.42]) {
        batch.add(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), pbr('gold', 0x8a6a2a), { p: [sx + 0.5 + dx, 2.32, sz + 0.42] });
        batch.add(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), pbr('gold', 0x8a6a2a), { p: [sx + 0.5 + dx, 2.47, sz + 0.42] }, { cast: false });
      }
      // A great crack through the statue and a fallen fragment at its feet.
      batch.add(worldBox(0.025, 1.4, 0.02, 1), crackMat, { p: [sx + 0.12, 2.2, sz + 0.33], r: [0, 0, 0.25] }, { cast: false });
      batch.add(worldBox(0.02, 0.6, 0.02, 1), crackMat, { p: [sx - 0.1, 1.5, sz + 0.36], r: [0, 0, -0.5] }, { cast: false });
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
      batch.add(worldBox(l1, 0.26, 0.26, 1), darkWood, { p: [hx0 + l1 / 2, 3.55, zz], r: [0, 0, -0.06] });
      batch.add(worldBox(l2, 0.26, 0.26, 1), darkWood, { p: [hx0 + hw - l2 / 2, 3.55, zz], r: [0, 0, 0.08] });
    }
    batch.add(worldBox(4.2, 0.24, 0.24, 1), darkWood, { p: [hx0 + hw - 1.6, 0.55, hz0 + hd - 1.4], r: [0, 0.7, 0.25] });
    batch.add(worldBox(2.6, 0.22, 0.22, 1), darkWood, { p: [hx0 + 1.4, 0.3, hz0 + hd - 0.9], r: [0, -0.4, 0.1] });
    // Rubble drifts along the foot of the walls.
    const rubM = libMat('wall_ruin', 0xa89c8c);
    for (let k = 0; k < 40; k++) {
      const side = k % 4;
      const t = hash(k, 3, 511);
      const px = side < 2 ? hx0 + 0.35 + side * (hw - 0.7) : hx0 + t * hw;
      const pz = side < 2 ? hz0 + t * hd : hz0 + 0.35 + (side - 2) * (hd - 0.7);
      batch.add(rockGeo(hash(k, 4, 511), 0.08 + hash(k, 5, 511) * 0.18), rubM, { p: [px + (hash(k, 6, 511) - 0.5) * 0.3, 0.03, pz + (hash(k, 7, 511) - 0.5) * 0.3] }, { cast: false });
    }
    if (night) {
      // Moonbeams through the open roof: slanted soft shafts with drifting motes.
      const beamMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, tNoise: { value: noiseTexture() } },
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float uT; uniform sampler2D tNoise;
          void main(){ float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float n = texture2D(tNoise, vec2(vW.x * 0.08 + uT * 0.01, vW.y * 0.05 - uT * 0.02)).r;
            float a = smoothstep(0.0, 1.0, across) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * (0.55 + n * 0.6);
            gl_FragColor = vec4(vec3(0.55, 0.65, 1.0) * 0.5, a * a * 0.3); }`,
      });
      disposables.push(beamMat);
      const beams = new THREE.Group();
      for (const [fx, fz, w] of [[0.32, 0.45, 1.6], [0.66, 0.7, 1.2], [0.45, 0.85, 0.9]]) {
        for (const rot of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
          const g = new THREE.PlaneGeometry(w, 9);
          const m = new THREE.Mesh(g, beamMat);
          m.position.set(hx0 + hw * fx + 1.2, 4.0, hz0 + hd * fz - 1.0);
          m.rotation.set(0, rot + 0.5, 0);
          m.rotateX(0.32);
          m.renderOrder = 5;
          beams.add(m);
          disposables.push(g);
        }
      }
      group.add(beams);
      ambient.push({ update: (t) => (beamMat.uniforms.uT.value = t), dispose: () => {} });
      const motes = loopingParticles({ count: 60, at: new THREE.Vector3(hx0 + hw * 0.5, 1.8, hz0 + hd * 0.6), spread: hw * 0.35, spreadY: 1.6, vel: [0.04, 0.03, 0.02], turb: 0.15, life: 8, size: 0.03, color: 0xb8c8ff, additive: true, alpha: 0.6, seed: 31 });
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
  const _v = new THREE.Vector3();
  /**
   * Cut away houses and walls that would hide any of `points` (combatants,
   * cursor) from the camera — a dollhouse view that keeps the fight readable.
   */
  function setView(camPos, points) {
    const cdx = camPos.x - W / 2;
    const cdz = camPos.z - H / 2;
    const cl = Math.hypot(cdx, cdz) || 1;
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
      for (const p of points) {
        _ray.origin.copy(p);
        _ray.direction.subVectors(camPos, p).normalize();
        if (g.box.containsPoint(p)) continue;
        const hit = _ray.intersectBox(g.box, _v);
        if (hit && hit.distanceTo(p) < camPos.distanceTo(p)) {
          hides = true;
          break;
        }
      }
      if (g.w?.low) {
        // Low field walls simply drop to their knee-high cut-away course.
        g.full.visible = !hides;
        g.cut.visible = hides;
        continue;
      }
      g.full.visible = true;
      g.cut.visible = false;
      g.fadeTarget = hides ? 0.22 : 1;
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
    const sm = loopingParticles({ count: 10, at: new THREE.Vector3(hs.chimney.x, hs.chimney.y, hs.chimney.z), spread: 0.15, vel: [0.25, 0.7, 0.12], turb: 0.3, life: 7, size: 1.1, grow: 2.5, color: night ? 0x1c1e24 : 0x5a5854, additive: false, alpha: night ? 0.3 : 0.2, seed: hs.seed * 50 });
    group.add(sm.obj);
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
  function occluders(camPos, points) {
    let n = 0;
    for (const g of [...houseGroups, ...wallGroups]) {
      if (g.w?.city || g.w?.prop) continue;
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

  return { group, torches, flames, houses, update, setView, setHole, occluders, bounds: { w: W, h: H }, dispose };
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
    if (r < 0.05) continue;
    const a = Math.atan2(z, x);
    const k = 1 - Math.max(0, Math.cos(a * 12)) * 0.06;
    let ny = y;
    if (broken && y > h - 0.01) ny = h - 0.05 - hash(Math.round(a * 4), seed, 431) * 0.35 - Math.max(0, Math.cos(a + seed)) * 0.25;
    pos.setXYZ(i, x * k, ny, z * k);
  }
  g.computeVertexNormals();
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
export function makeFlame(size = 0.4, seed = 0) {
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
  glow.scale.setScalar(size * 4.5);
  glow.position.y = size * 0.4;
  grp.add(glow);
  grp.userData.update = (t) => {
    mat.uniforms.uTime.value = t;
    const f = 0.85 + 0.1 * Math.sin(t * 13 + seed) + 0.05 * Math.sin(t * 29.7 + seed * 3);
    glow.material.opacity = 0.4 * f;
    quad.scale.set(size * (0.95 + 0.08 * Math.sin(t * 9 + seed)), size * (0.95 + 0.12 * Math.sin(t * 7.3 + seed * 2)), 1);
  };
  grp.userData.dispose = () => {
    mat.dispose();
    quad.geometry.dispose();
    glow.material.dispose();
  };
  return grp;
}
