import * as THREE from 'three';
import { ni, tint, worldUV, prng } from './geom.js';

/**
 * Architectural kit for the title world: fluted Doric columns (base, entasis,
 * drum joints, chipped arrises, broken tops), ribbed domes with drum and
 * lantern, thick-slab gable roofs with eaves and ridge caps, robed figures,
 * and a shared warm rim-light material patch that makes silhouettes catch
 * the set sun. Everything returns plain non-indexed BufferGeometry ready to
 * merge (position/normal/uv/color).
 */

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
function h2(a, b, s = 0) {
  let h = (Math.floor(a) * 374761393 + Math.floor(b) * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Cylindrical UVs (u around in metres, v up in metres) / scale. */
function cylUV(g, scale = 2) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    uv[i * 2] = (a * Math.max(r, 0.3)) / scale;
    uv[i * 2 + 1] = y / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Jitter vertices of a box-ish geometry near its edges (chipped stone). */
function chip(g, amt, seed) {
  g = ni(g);
  const p = g.attributes.position;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ex = Math.min(x - bb.min.x, bb.max.x - x), ey = Math.min(y - bb.min.y, bb.max.y - y), ez = Math.min(z - bb.min.z, bb.max.z - z);
    const edge = [ex, ey, ez].sort((a, b) => a - b)[1] < amt * 1.5 ? 1 : 0;
    if (!edge) continue;
    const k = h2(x * 13 + seed, z * 17 + y * 7, seed);
    const d = amt * (0.4 + k);
    p.setXYZ(i, x - Math.sign(x - (bb.min.x + bb.max.x) / 2) * d * (ex < amt * 2 ? 1 : 0), y - Math.sign(y - (bb.min.y + bb.max.y) / 2) * d * 0.6 * (ey < amt * 2 ? 1 : 0), z - Math.sign(z - (bb.min.z + bb.max.z) / 2) * d * (ez < amt * 2 ? 1 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Fluted Doric column, base at y=0 (local), centred on x/z = 0.
 * @param {{h:number, r?:number, flutes?:number, capital?:boolean, broken?:number, seed?:number, color?:number, plinth?:boolean}} o
 *   broken: 0 = whole; 0..1 = how much of the top is sheared off (jagged)
 * @returns {THREE.BufferGeometry[]}
 */
export function column({ h, r = 0.55, flutes = 20, capital = true, broken = 0, seed = 1, color = 0xd2c9b9, plinth = true }) {
  const parts = [];
  const R = prng(seed * 7919);
  let y0 = 0;
  if (plinth) {
    const pl = chip(new THREE.BoxGeometry(r * 3.0, r * 0.62, r * 3.0, 3, 1, 3).translate(0, r * 0.31, 0), r * 0.06, seed);
    parts.push(tint(worldUV(pl, 2), new THREE.Color(color).multiplyScalar(0.9), { aoBottom: 0, aoTop: r * 0.6, aoStrength: 0.3 }));
    y0 = r * 0.62;
  }
  // Attic base: torus · scotia · torus
  const baseProf = [[r * 1.32, 0], [r * 1.36, r * 0.1], [r * 1.3, r * 0.2], [r * 1.12, r * 0.24], [r * 1.08, r * 0.3], [r * 1.18, r * 0.36], [r * 1.16, r * 0.44], [r * 1.02, r * 0.5]];
  const base = new THREE.LatheGeometry(baseProf.map(([a, b]) => new THREE.Vector2(a, b)), 40);
  base.translate(0, y0, 0);
  parts.push(tint(cylUV(ni(base)), color, { aoBottom: y0, aoTop: y0 + r * 0.6, aoStrength: 0.25 }));
  y0 += r * 0.5;
  // shaft
  const capH = capital ? r * 0.95 : 0;
  const sh = Math.max(0.5, h - y0 - capH);
  const radial = flutes * 4;
  const hs = Math.max(4, Math.round(sh / 0.25));
  const shaft = new THREE.CylinderGeometry(1, 1, sh, radial, hs, false);
  shaft.translate(0, sh / 2, 0);
  const p = shaft.attributes.position;
  const rt = r * 0.82, rb = r;
  const joints = [];
  for (let jy = 0.9 + R.range(0, 0.4); jy < sh - 0.3; jy += R.range(0.9, 1.3)) joints.push(jy);
  const breakAt = (a) => sh * (1 - broken * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a * 2 + seed) * Math.cos(a * 5 - seed * 2)))) - R.next() * 0;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const f = y / sh;
    let Rad = rb + (rt - rb) * f + r * 0.03 * Math.sin(Math.PI * f); // entasis
    // concave flutes meeting in sharp arrises
    const fr = (((a / TAU) * flutes) % 1 + 1) % 1;
    Rad -= r * 0.07 * Math.sin(Math.PI * fr);
    // drum joints
    for (const j of joints) if (Math.abs(y - j) < 0.035) Rad -= r * 0.035;
    // chips and spalls on the arrises
    const ch = h2(a * 6 + seed, y * 3, seed);
    if (ch > 0.9) Rad -= r * 0.06 * (ch - 0.9) * 10 * (1 - Math.abs(Math.sin(Math.PI * fr)));
    if (broken > 0) {
      const top = breakAt(a);
      if (y > top) y = top - h2(a * 30, seed, 3) * 0.06;
    }
    const k = rr > 1e-4 ? Rad / rr : 0;
    p.setXYZ(i, x * k * (rr > 1e-4 ? 1 : 0), y, z * k * (rr > 1e-4 ? 1 : 0));
    if (rr < 1e-4 && broken > 0) p.setY(i, Math.min(y, sh * (1 - broken * 0.7)));
  }
  shaft.computeVertexNormals();
  const sg = ni(shaft);
  sg.translate(0, y0, 0);
  parts.push(tint(cylUV(sg, 1.6), color, { aoBottom: 0, aoTop: 2.4, aoStrength: 0.32 }));
  if (capital && !broken) {
    const cy = y0 + sh;
    const necking = new THREE.TorusGeometry(rt * 1.0, r * 0.05, 6, 40);
    necking.rotateX(Math.PI / 2);
    necking.translate(0, cy - r * 0.08, 0);
    parts.push(tint(cylUV(ni(necking)), color));
    const ech = new THREE.LatheGeometry([[rt * 0.98, 0], [rt * 1.06, r * 0.1], [r * 1.22, r * 0.3], [r * 1.42, r * 0.44], [r * 1.44, r * 0.5]].map(([a, b]) => new THREE.Vector2(a, b)), 40);
    ech.translate(0, cy, 0);
    parts.push(tint(cylUV(ni(ech)), color));
    const ab = chip(new THREE.BoxGeometry(r * 3.0, r * 0.42, r * 3.0, 3, 1, 3).translate(0, cy + r * 0.5 + r * 0.21, 0), r * 0.05, seed + 3);
    parts.push(tint(worldUV(ab, 2), new THREE.Color(color).multiplyScalar(0.94)));
  }
  return parts;
}

/**
 * Entablature run (architrave · triglyph frieze · cornice) along local X,
 * bottom at y=0, optionally broken off at the +X end.
 */
export function entablature(len, { depth = 1.5, seed = 2, color = 0xc4b9a6, brokenEnd = 0 } = {}) {
  const parts = [];
  const add = (g, c = color) => parts.push(tint(worldUV(chip(g, 0.05, seed), 2), c));
  const L = len - brokenEnd;
  add(new THREE.BoxGeometry(L, 0.75, depth, 4, 1, 1).translate(-brokenEnd / 2, 0.375, 0));
  add(new THREE.BoxGeometry(L, 0.08, depth + 0.1).translate(-brokenEnd / 2, 0.79, 0), new THREE.Color(color).multiplyScalar(1.05));
  add(new THREE.BoxGeometry(L, 0.7, depth * 0.94, 4, 1, 1).translate(-brokenEnd / 2, 1.18, 0), new THREE.Color(color).multiplyScalar(0.92));
  // triglyphs
  const n = Math.floor(L / 0.9);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.45 + i * 0.9;
    add(new THREE.BoxGeometry(0.34, 0.62, 0.08).translate(x, 1.18, depth * 0.47 + 0.04), new THREE.Color(color).multiplyScalar(0.86));
  }
  add(new THREE.BoxGeometry(L + 0.3, 0.22, depth + 0.5).translate(-brokenEnd / 2, 1.64, 0), new THREE.Color(color).multiplyScalar(1.08));
  add(new THREE.BoxGeometry(L + 0.2, 0.14, depth + 0.3).translate(-brokenEnd / 2, 1.82, 0));
  return parts;
}

/**
 * Ribbed dome on a windowed drum with a lantern. Origin at the drum base.
 * Returns {stone, roof, windows} geometry lists.
 */
export function dome({ r = 6.6, drumH = 2.6, ribs = 16, color = 0xa39684, roofColor = 0x5f8a80, seed = 5 } = {}) {
  const stone = [], roof = [], windows = [];
  const drum = new THREE.CylinderGeometry(r * 0.97, r * 0.97, drumH, 48, 1, true);
  drum.translate(0, drumH / 2, 0);
  stone.push(tint(cylUV(ni(drum), 2), color, { aoBottom: 0, aoTop: drumH, aoStrength: 0.3 }));
  // pilasters + windows around the drum
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * TAU;
    const pil = new THREE.BoxGeometry(0.42, drumH, 0.3).translate(0, drumH / 2, r * 0.97 + 0.1);
    pil.rotateY(-a + Math.PI / 2);
    stone.push(tint(worldUV(ni(pil), 2), new THREE.Color(color).multiplyScalar(1.08)));
    const wa = a + Math.PI / ribs;
    const win = new THREE.PlaneGeometry(0.55, drumH * 0.55);
    win.translate(0, drumH * 0.5, r * 0.97 + 0.02);
    win.rotateY(-wa + Math.PI / 2);
    windows.push(tint(win, new THREE.Color().setHSL(0.08, 0.85, 0.42)));
  }
  const cornice = new THREE.CylinderGeometry(r * 1.04, r * 1.0, 0.35, 48);
  cornice.translate(0, drumH + 0.17, 0);
  stone.push(tint(cylUV(ni(cornice)), new THREE.Color(color).multiplyScalar(1.1)));
  // the shell: slightly pointed profile, raised ribs
  const shell = new THREE.SphereGeometry(r, 64, 20, 0, TAU, 0, Math.PI / 2);
  const p = shell.attributes.position;
  const col = new Float32Array(p.count * 3);
  const base = new THREE.Color(roofColor), rib = new THREE.Color(color).multiplyScalar(1.05);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const fr = (((a / TAU) * ribs) % 1 + 1) % 1;
    const ribK = smooth(0.06, 0.0, Math.min(fr, 1 - fr));
    const lat = y / r;
    const s = 1 + ribK * 0.035 * (1 - lat * 0.6);
    // pointed (ogival) tip
    y = y * (1 + 0.22 * lat * lat);
    p.setXYZ(i, x * s * (1 - 0.08 * lat * lat), y, z * s * (1 - 0.08 * lat * lat));
    const c = base.clone().lerp(rib, ribK * 0.85);
    // weathering streaks below ribs, lighter crown
    const streak = 0.85 + 0.15 * h2(a * 40, 1, seed) + lat * 0.12;
    col.set([c.r * streak, c.g * streak, c.b * streak], i * 3);
  }
  shell.computeVertexNormals();
  shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shell.translate(0, drumH + 0.34, 0);
  const sg = ni(shell);
  roof.push(worldUV(sg, 1.6));
  // lantern
  const ly = drumH + 0.34 + r * 1.22 - 0.25;
  const lr = r * 0.17;
  stone.push(tint(cylUV(ni(new THREE.CylinderGeometry(lr * 1.15, lr * 1.2, 0.25, 16).translate(0, ly + 0.12, 0))), color));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    stone.push(tint(worldUV(ni(new THREE.BoxGeometry(0.14, lr * 1.6, 0.14).translate(Math.cos(a) * lr, ly + 0.25 + lr * 0.8, Math.sin(a) * lr)), 1), color));
  }
  windows.push(tint(ni(new THREE.CylinderGeometry(lr * 0.8, lr * 0.8, lr * 1.5, 12, 1, true).translate(0, ly + 0.25 + lr * 0.8, 0)), new THREE.Color().setHSL(0.09, 0.9, 0.5)));
  const lcap = new THREE.SphereGeometry(lr * 1.25, 16, 8, 0, TAU, 0, Math.PI / 2);
  lcap.scale(1, 1.3, 1);
  lcap.translate(0, ly + 0.25 + lr * 1.6, 0);
  roof.push(tint(worldUV(ni(lcap), 1), roofColor));
  const fin = new THREE.SphereGeometry(0.16, 10, 6).translate(0, ly + 0.25 + lr * 1.6 + lr * 1.6 + 0.1, 0);
  stone.push(tint(ni(fin), 0xd8b25a));
  stone.push(tint(ni(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 6).translate(0, ly + 0.25 + lr * 3.2 + 0.4, 0)), 0x6a5a3a));
  return { stone, roof, windows };
}

/**
 * Thick-slab gable roof: ridge along local X, two slabs with eaves that
 * overhang and droop below the wall plate, a rounded ridge cap and the gable
 * triangles (returned separately so they take the wall material).
 * Base (wall plate) at y=0.
 */
export function gableRoof(w, d, rise, { o = 0.45, t = 0.22, ridge = true } = {}) {
  const roof = [], gables = [], caps = [];
  const half = d / 2;
  const ang = Math.atan2(rise, half);
  const run = half + o;
  const L = run / Math.cos(ang);
  for (const s of [-1, 1]) {
    const slab = new THREE.BoxGeometry(w + o * 2, t, L, 2, 1, 2);
    // top surface lies along the slope: slab centre offset down by t/2 along the normal
    slab.translate(0, -t / 2, s * L / 2);
    slab.rotateX(s * ang);
    slab.translate(0, rise + t * 0.35, 0);
    roof.push(worldUV(ni(slab), 2));
  }
  if (ridge) {
    const rc = new THREE.CylinderGeometry(t * 0.9, t * 0.9, w + o * 2 + 0.1, 8, 1);
    rc.rotateZ(Math.PI / 2);
    rc.translate(0, rise + t * 0.45, 0);
    caps.push(worldUV(ni(rc), 1));
  }
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(-half, 0);
    sh.lineTo(half, 0);
    sh.lineTo(0, rise);
    sh.closePath();
    const g = new THREE.ShapeGeometry(sh);
    g.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(sx * (w / 2), 0, 0);
    gables.push(worldUV(ni(g), 3));
  }
  return { roof, gables, caps };
}

/**
 * Robed figure (councillor, clerk, pilgrim), feet at y=0, facing +Z.
 * Returns {cloth, skin} geometry lists (vertex-coloured).
 */
export function robedFigure({ height = 1.75, robe = 0x5a1a14, hood = true, stoop = 0, seed = 1, arms = 'down' } = {}) {
  const cloth = [], skin = [];
  const s = height / 1.75;
  const prof = [[0.0, 0], [0.33, 0], [0.31, 0.15], [0.27, 0.5], [0.23, 0.95], [0.22, 1.2], [0.25, 1.36], [0.2, 1.46], [0.08, 1.5], [0, 1.5]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * s, y * s)), 18);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
    // cloth folds near the hem, slight front/back flattening
    const fold = 1 + 0.06 * Math.sin(a * 7 + seed) * (1 - y / (1.5 * s));
    p.setXYZ(i, p.getX(i) * fold * 1.05, y, p.getZ(i) * fold * 0.85 + stoop * (y / (1.5 * s)) ** 2 * 0.25);
  }
  body.computeVertexNormals();
  cloth.push(tint(ni(body), robe, { aoBottom: 0, aoTop: 0.6 * s, aoStrength: 0.4 }));
  const headY = 1.62 * s;
  const head = new THREE.SphereGeometry(0.11 * s, 12, 8);
  head.scale(0.9, 1.1, 1);
  head.translate(0, headY, 0.03 + stoop * 0.25);
  skin.push(tint(ni(head), 0xc89a78));
  if (hood) {
    const hd = new THREE.SphereGeometry(0.16 * s, 14, 10, 0, TAU, 0, Math.PI * 0.62);
    hd.rotateX(-0.35);
    hd.translate(0, headY - 0.02 * s, -0.02 + stoop * 0.25);
    cloth.push(tint(ni(hd), new THREE.Color(robe).multiplyScalar(0.85)));
  }
  // sleeves
  for (const sx of [-1, 1]) {
    const sl = new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 0.62 * s, 8);
    if (arms === 'forward') {
      sl.rotateX(-1.1);
      sl.translate(sx * 0.2 * s, 1.18 * s, 0.22 * s);
    } else {
      sl.rotateZ(sx * 0.12);
      sl.translate(sx * 0.25 * s, 1.08 * s, 0.03);
    }
    cloth.push(tint(ni(sl), new THREE.Color(robe).multiplyScalar(0.92)));
    const hand = new THREE.SphereGeometry(0.045 * s, 8, 6);
    if (arms === 'forward') hand.translate(sx * 0.2 * s, 1.06 * s, 0.5 * s);
    else hand.translate(sx * 0.29 * s, 0.76 * s, 0.05);
    skin.push(tint(ni(hand), 0xc89a78));
  }
  // a gilt chain of office
  const chain = new THREE.TorusGeometry(0.17 * s, 0.012 * s, 4, 20, Math.PI);
  chain.rotateX(Math.PI / 2 + 0.6);
  chain.rotateY(Math.PI);
  chain.translate(0, 1.38 * s, 0.06 * s);
  cloth.push(tint(ni(chain), 0xd8a848));
  return { cloth, skin };
}

/**
 * Warm rim light patch for MeshStandardMaterial: surfaces seen edge-on that
 * face toward the sun pick up a glow, so backlit silhouettes get 2-3 value
 * steps (rim · body · shadow) instead of one flat black. `uniforms.uSunView`
 * must be updated each frame with the sun direction in view space.
 */
export function addRimLight(mat, uniforms, strength = 1, { weather = 0, ground = -14, soot = 0, flat = 0, flake = 0, courses = 0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    if (weather > 0) {
      // weathering in world space: rain streaks running down from every ledge,
      // damp/algae darkening at the foot of the walls, mottled lichen, so the
      // ashlar stops reading as one clean repeating brick texture
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWthr;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWthr = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWthr;
          float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            float u = vWthr.x * 1.3 + vWthr.z * 1.3;
            float streak = wn(vec2(u * 2.2, vWthr.y * 0.09)) * wn(vec2(u * 7.0, vWthr.y * 0.05 + 3.0));
            float damp = 1.0 - smoothstep(${ground.toFixed(1)}, ${(ground + 3.2).toFixed(1)}, vWthr.y);
            float mott = wn(vWthr.xz * 0.35 + vWthr.y * 0.2);
            vec3 c = diffuseColor.rgb;
            ${flat > 0 ? `{
              // even out a blotchy albedo map: keep its hue, replace its luminance
              // swings with a fine, clean lime-wash grain and gentle broad wash
              float lm = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
              vec3 even = diffuse * sampledDiffuseColor.rgb / max(lm, 0.04) * 0.62;
              even *= 0.93 + 0.1 * wn(vWthr.xy * 14.0 + vWthr.zy * 14.0) + 0.05 * wn(vec2(u * 0.6, vWthr.y * 0.5));
              c = mix(c, even, ${flat.toFixed(2)});
            }` : ''}
            // macro variation: patches of differently-quarried / re-faced stone a few
            // metres across (tone + a warm/cool hue drift), so the tiled ashlar never
            // repeats visibly across a whole tower or curtain wall
            vec2 mq = vec2(u * 0.16, vWthr.y * 0.22);
            float patchK = wn(floor(mq * vec2(1.0, 1.6)) + 17.0);
            float macro = wn(vWthr.xz * 0.045 + vWthr.y * 0.03) * 0.6 + patchK * 0.4;
            c *= 0.78 + 0.42 * macro;
            c *= mix(vec3(1.06, 0.98, 0.9), vec3(0.92, 0.97, 1.06), wn(mq * 0.7 + 3.0));
            c *= 1.0 - ${weather.toFixed(2)} * (0.42 * smoothstep(0.25, 0.7, streak) + 0.18 * mott);
            c = mix(c, c * vec3(0.55, 0.62, 0.45), damp * ${weather.toFixed(2)} * 0.8);
            ${soot > 0 ? `{
              // fire-blackening from the sack: long soot tongues licking up from
              // windows and loops, streaks bleeding down from the burnt wall-heads,
              // and broad scorched patches, heaviest high on the towers
              float hi = smoothstep(${(ground + 4).toFixed(1)}, ${(ground + 22).toFixed(1)}, vWthr.y);
              float tongue = wn(vec2(u * 1.7, vWthr.y * 0.16)) * wn(vec2(u * 4.3 + 7.0, vWthr.y * 0.07));
              float drip = smoothstep(0.55, 0.85, wn(vec2(u * 9.0, 1.3))) * smoothstep(0.2, 0.9, wn(vec2(u * 9.0, vWthr.y * 0.04 + 5.0)));
              float scorch = smoothstep(0.5, 0.78, wn(vec2(u * 0.35, vWthr.y * 0.12) + 11.0));
              float k = clamp((smoothstep(0.18, 0.55, tongue) * 0.6 + drip * 0.5) * (0.35 + 0.65 * hi) + scorch * 0.45, 0.0, 1.0);
              c = mix(c, c * vec3(0.16, 0.14, 0.13), k * ${soot.toFixed(2)});
            }` : ''}
            ${courses > 0 ? `{
              // non-uniform masonry: every course (0.36 m, the texture's bed joints)
              // and every few metres along it a different quarry tone, with
              // re-faced and patched blocks lighter or darker than their neighbours
              float row = floor(vWthr.y / 0.36);
              float seg = floor(u * 0.45 + wh(vec2(row, 3.0)) * 3.0);
              float hv = wh(vec2(row, seg));
              c *= 1.0 + ${courses.toFixed(2)} * (hv - 0.5) * 1.6;
              c = mix(c, c * vec3(1.08, 1.0, 0.86), step(0.86, hv) * ${courses.toFixed(2)} * 2.0);
            }` : ''}
            ${flake > 0 ? `{
              // lime-wash flaking off in sheets: the rubble core shows through in
              // ragged patches, heaviest low on the wall and round the openings
              float fl = wn(vec2(u * 1.2, vWthr.y * 0.7) + 5.0) * 0.55 + wn(vec2(u * 6.5, vWthr.y * 5.0)) * 0.3 + wn(vec2(u * 19.0, vWthr.y * 15.0)) * 0.15;
              fl += 0.12 * (1.0 - smoothstep(${ground.toFixed(1)}, ${(ground + 2.5).toFixed(1)}, vWthr.y)); // rising damp strips the wash low down
              float edge = smoothstep(0.58, 0.6, fl);
              float core = smoothstep(0.6, 0.66, fl);
              vec3 stone = vec3(0.3, 0.26, 0.22) * (0.7 + 0.6 * wn(vec2(u * 14.0, vWthr.y * 14.0)));
              c = mix(c, c * 0.55, edge * (1.0 - core) * ${flake.toFixed(2)});
              c = mix(c, stone, core * ${flake.toFixed(2)});
            }` : ''}
            diffuseColor.rgb = c;
          }`);
    }
    sh.uniforms.uSunView = uniforms.uSunView;
    sh.uniforms.uRimColor = uniforms.uRimColor;
    sh.uniforms.uRimK = { value: strength };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uRimColor; uniform float uRimK;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 3.0);
          float toSun = clamp(dot(normal, uSunView) * 0.6 + 0.4, 0.0, 1.0);
          float behind = clamp(-dot(Vv, uSunView) * 0.5 + 0.5, 0.0, 1.0);
          float up = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
          totalEmissiveRadiance += uRimColor * uRimK * fres * toSun * behind * diffuseColor.rgb * 2.2;
          // cool sky fill from above so shadowed faces keep a value step
          totalEmissiveRadiance += vec3(0.055, 0.05, 0.11) * uRimK * up * diffuseColor.rgb;
        }`);
  };
  mat.customProgramCacheKey = () => `rim${strength}w${weather}s${soot}f${flat}k${flake}c${courses}`;
  return mat;
}

let contactMat = null;
/**
 * A soft contact shadow under a figure or prop: a dark radial blot on the
 * ground (multiplied in by alpha), so sculpted figures sit on the cobbles or
 * marble instead of floating. Shares one material.
 */
export function contactShadow(rx = 0.42, rz = 0.32, strength = 0.75) {
  contactMat ??= new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: {},
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv;
      void main(){
        vec2 d = (vUv - 0.5) * 2.0;
        float r = dot(d, d);
        float a = exp(-r * 3.2) - 0.04;
        float core = exp(-r * 14.0) * 0.5;
        gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a + core, 0.0, 1.0));
      }`,
  });
  const g = new THREE.PlaneGeometry(rx * 2, rz * 2);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, contactMat);
  m.scale.setScalar(1);
  m.material.opacity = strength;
  m.renderOrder = 1;
  m.position.y = 0.012;
  return m;
}

/**
 * Matte the party-miniature rig for cinematic use: cloth and skin get a broad,
 * soft roughness (no plastic glints), skin keeps a warm wrap of light in its
 * shadows, and only true metals (metalness > 0.5) stay polished.
 */
export function matteFigure(root, { detail = 0.45, dim = 1, rim = null, folds = 0 } = {}) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.material.userData?.matted) return;
    const m = o.material;
    if (!m.isMeshStandardMaterial || !m.onBeforeCompile || !m.customProgramCacheKey) return;
    const key = m.customProgramCacheKey();
    if (!String(key).startsWith('por-mini')) return;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      // the sculpt's cloth/leather micro-relief reads as worms at cinematic
      // distances: keep only a whisper of it
      if (sh.uniforms.uDetail) sh.uniforms.uDetail.value = detail;
      sh.uniforms.uRimC = { value: new THREE.Color(rim ?? 0x000000) };
      sh.uniforms.uFolds = { value: folds };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFoldP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoldP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRimC;\nuniform float uFolds;\nvarying vec3 vFoldP;')
        // armour: never a mirror (no blown white plates): a satin floor on roughness
        .replace('roughnessFactor = clamp(vMat.y + miniR, 0.06, 1.0);', 'roughnessFactor = clamp(vMat.y + miniR, 0.06, 1.0);\nroughnessFactor = mix(max(roughnessFactor, 0.78), max(roughnessFactor, 0.46), step(0.5, vMat.z));')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          reflectedLight.indirectSpecular *= mix(0.35, 0.5, step(0.5, vMat.z));
          reflectedLight.directSpecular *= mix(1.0, 0.55, step(0.5, vMat.z));
          reflectedLight.directDiffuse *= ${dim.toFixed(2)};
          reflectedLight.indirectDiffuse *= ${dim.toFixed(2)};
          if (uFolds > 0.0 && (abs(floor(vMat.x + 0.5) - 3.0) < 0.5 || abs(floor(vMat.x + 0.5) - 10.0) < 0.5)) {
            // hanging cloth: long vertical folds round the figure, deeper and
            // more broken toward the hem, with a lit crest and a dark trough
            float ang = atan(vFoldP.z, vFoldP.x);
            float y = vFoldP.y;
            float ph = ang * 11.0 + sin(ang * 3.0 + y * 2.2) * 1.4 + sin(y * 7.0 + ang * 5.0) * 0.25;
            float fo = sin(ph);
            float hem = 1.0 - smoothstep(0.25, 1.15, y);
            float k = (0.35 + 0.65 * hem) * uFolds;
            float shade = 1.0 + fo * 0.32 * k - (1.0 - abs(fo)) * 0.0 + pow(max(-fo, 0.0), 3.0) * -0.25 * k;
            reflectedLight.directDiffuse *= shade;
            reflectedLight.indirectDiffuse *= mix(1.0, shade, 0.8);
          }
          // skin: soft wrapped warmth in the shadow side (cheap sub-surface)
          if (floor(vMat.x + 0.5) > 8.5 && floor(vMat.x + 0.5) < 9.5) reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.06, 0.025, 0.015);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // backlight: a warm edge from the light behind the figure, so it reads
            // as a silhouette with a lit outline rather than a front-lit toy
            float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.6);
            totalEmissiveRadiance += uRimC * fr;
          }`);
    };
    m.customProgramCacheKey = () => `${key}-matte-d${detail}-m${dim}-r${rim ?? 0}-f${folds}`;
    m.userData.matted = true;
    m.needsUpdate = true;
  });
  return root;
}
