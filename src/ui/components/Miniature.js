import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveAppearance, appearanceKey, readiedGear } from './lookData.js';
import { buildFigure } from './figureRig.js';
import { meshSculpt } from './sdfSculpt.js';
import { paintFaceSkin, FACE_BOX } from './faceSkin.js';
import * as TX from './miniatureTextures.js';
import { createHead } from './headShader.js';
import { renderToCanvas } from './paintPass.js';
import { finishFace } from './portraitOverpaint.js';

/**
 * Party miniatures: painted 28 mm-style tabletop figures of the player
 * characters — the Gold Box "combat icon" reimagined. Each figure is a
 * continuous signed-distance sculpt (figureRig.js → sdfSculpt.js) meshed with
 * surface nets, its paint baked into vertex colours (material colours, soft
 * hairlines, edge highlights and washed recesses, SDF ambient occlusion), its
 * face painted from the same appearance as the portrait (faceSkin.js), and
 * finished in a shader that adds per-material micro detail (mail rings,
 * scales, weave, leather grain, hair strands, hammered steel) and occlusion.
 *
 * Shared by character creation (on a gilt base), the camp (seated, asleep
 * under blankets, or on watch), the character sheet and the ITEMS paperdoll
 * (snapshots), and the portrait painter (busts). Pure three.js: no scene
 * imports, no randomness beyond the character's look seed.
 *
 * @typedef {'stand'|'display'|'guard'|'sit'|'sleep'|'portrait'} Pose
 */

/** Back-compat: what a character has readied. */
export const miniatureGear = readiedGear;

/** Mesh resolution (metres per cell) by use. */
export const QUALITY = { hero: 0.0072, camp: 0.0108, snap: 0.0082, portrait: 0.0034, thumb: 0.0064 };

// ------------------------------------------------------------------ sculpt → geometry (cached)

const dataCache = new Map();
function figureData(app, pose, cell, opt = {}) {
  // With a ray-marched head the body sculpt does not depend on the head template: the eight head
  // thumbnails (and every head change) share one body mesh.
  const key = `${appearanceKeyOf(app, opt.noHead)}|${pose}|${cell}|${opt.blanket ?? ''}|${opt.noWeapon ? 1 : 0}|${opt.noHead ? 1 : 0}|${opt.mod ?? ''}|${opt.boundsKey ?? (opt.bounds ? opt.bounds.join(',') : '')}|${opt.crispHands ? 'h' : ''}`;
  const hit = dataCache.get(key);
  if (hit) {
    dataCache.delete(key);
    dataCache.set(key, hit);
    return hit;
  }
  const fig = buildFigure(app, pose, opt);
  const mesh = meshSculpt(fig.sculpt, { cell, bounds: opt.boundsFn ? opt.boundsFn(fig.frames) : opt.bounds });
  const faceMats = fig.sculpt.mats.map((m) => m.face ?? 0);
  // Painted-face projection (head-local front view).
  const { c: Hc, R: HR, hs } = fig.frames.face;
  const n = mesh.count;
  const face = new Float32Array(n * 3);
  const P = mesh.position;
  const N = mesh.normal;
  for (let i = 0; i < n; i++) {
    const w0 = faceMats[mesh.matId[i]];
    if (!w0) continue;
    const px = P[i * 3] - Hc[0], py = P[i * 3 + 1] - Hc[1], pz = P[i * 3 + 2] - Hc[2];
    const lx = (HR[0] * px + HR[1] * py + HR[2] * pz) / hs;
    const ly = (HR[3] * px + HR[4] * py + HR[5] * pz) / hs;
    const lz = (HR[6] * px + HR[7] * py + HR[8] * pz) / hs;
    if (Math.hypot(lx, ly, lz) > 0.16 || ly < FACE_BOX.y0 || ly > FACE_BOX.y1) continue;
    const nz = HR[6] * N[i * 3] + HR[7] * N[i * 3 + 1] + HR[8] * N[i * 3 + 2];
    const w = Math.max(0, Math.min(1, (nz - 0.05) / 0.35)) * Math.max(0, Math.min(1, (lz + 0.01) / 0.03));
    face[i * 3] = (lx - FACE_BOX.x0) / (FACE_BOX.x1 - FACE_BOX.x0);
    face[i * 3 + 1] = (ly - FACE_BOX.y0) / (FACE_BOX.y1 - FACE_BOX.y0);
    face[i * 3 + 2] = w;
  }
  const out = { mesh, face, frames: fig.frames };
  dataCache.set(key, out);
  while (dataCache.size > 28) dataCache.delete(dataCache.keys().next().value);
  return out;
}
function appearanceKeyOf(app, noHead = false) {
  const l = app.look;
  return [app.race, app.gender, l.seed, noHead ? '-' : l.head, l.body, l.skin, l.hair, l.eyes, l.cloth, app.body, app.helm ? 1 : 0, app.hood ? 1 : 0, app.weapon, app.shield, app.cloak ? 1 : 0].join('|');
}

function geometryOf(d) {
  const g = new THREE.BufferGeometry();
  const m = d.mesh;
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(m.mat, 4));
  g.setAttribute('aFace', new THREE.BufferAttribute(d.face, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ------------------------------------------------------------------ the miniature shader

const PATTERN_GLSL = /* glsl */`
varying vec4 vMat;
varying vec3 vFace;
varying vec3 vObj;
varying vec3 vObjN;
uniform sampler2D faceMap;
uniform vec3 uSkin;
uniform float uDetail;
float mh3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mh3(i), mh3(i + vec3(1,0,0)), f.x), mix(mh3(i + vec3(0,1,0)), mh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mh3(i + vec3(0,0,1)), mh3(i + vec3(1,0,1)), f.x), mix(mh3(i + vec3(0,1,1)), mh3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec2 triUV(vec3 p, vec3 n) {
  vec3 a = abs(n);
  return a.x > a.y && a.x > a.z ? p.zy : (a.y > a.z ? p.xz : p.xy);
}
// Fade a pattern of spatial frequency f (cycles per metre) before it aliases.
float aaFade(float f) { float fw = length(fwidth(vObj)) * f; return clamp(1.6 - fw * 2.2, 0.0, 1.0); }
void miniPattern(float pid, out float h, out float alb, out float rmod) {
  h = 0.0; alb = 1.0; rmod = 0.0;
  vec3 p = vObj;
  if (pid < 0.5) return;
  if (pid < 1.5) { // mail: a tiled ring normal (rows offset) that resolves into soft low-frequency
    // occlusion and wear with distance (no speckle, no glitter)
    vec2 uv = triUV(p, vObjN) * 105.0;
    float rowI = floor(uv.y);
    uv.x += 0.5 * mod(rowI, 2.0);
    vec2 f = fract(uv) - 0.5;
    float r = length(f * vec2(1.0, 1.2));
    float ring = smoothstep(0.13, 0.23, r) * smoothstep(0.52, 0.37, r);
    // each ring tilts down over the next row: the upper half catches more light
    float tiltH = ring * (0.6 + 0.4 * (-f.y));
    float fd = aaFade(105.0);
    float wear = vn3(p * 16.0);
    float oil = vn3(p * 5.0 + 3.0);
    float lowAO = 0.72 + 0.28 * wear;
    h = tiltH * 0.0009 * fd;
    // far off, the rings resolve into rows: soft horizontal courses of darker and lighter links
    // (a soft mottle of links, never regular stripes: those read as a knitted jumper)
    float rows = 0.88 + 0.12 * vn3(vec3(p.x * 45.0, p.y * 80.0, p.z * 45.0));
    alb = mix(0.78 * rows, mix(0.42, 1.15, tiltH), fd) * lowAO * (0.92 + 0.12 * oil);
    rmod = 0.06 + (0.5 - wear) * 0.12 + (1.0 - ring) * 0.15 * fd;  } else if (pid < 2.5) { // scales
    vec2 uv = triUV(p, vObjN) * vec2(55.0, 70.0);
    uv.x += 0.5 * mod(floor(uv.y), 2.0);
    vec2 f = fract(uv) - vec2(0.5, 0.0);
    float d = length(vec2(f.x, (f.y - 0.62) * 0.95));
    float sc = smoothstep(0.62, 0.3, d);
    float fd = aaFade(70.0);
    h = sc * 0.0016 * fd; alb = mix(0.85, mix(0.55, 1.15, sc), fd);
  } else if (pid < 3.5 || (pid > 9.5 && pid < 10.5)) { // cloth / linen
    float n = vn3(p * 260.0) * aaFade(260.0);
    float s = vn3(p * 45.0);
    h = n * 0.00035; alb = 0.9 + 0.14 * s + 0.06 * n;
  } else if (pid < 4.5) { // leather
    float n = vn3(p * 420.0) * aaFade(420.0);
    float s = vn3(p * 55.0);
    h = n * 0.00028; alb = 0.82 + 0.3 * s; rmod = (s - 0.5) * 0.2;
  } else if (pid < 5.5) { // hair strands with a glossy sheen band on the crown
    float n = vn3(vec3(p.x * 700.0, p.y * 70.0, p.z * 700.0));
    float c = vn3(vec3(p.x * 160.0, p.y * 18.0, p.z * 160.0));
    float fd = aaFade(700.0);
    float band = smoothstep(0.25, 0.75, vObjN.y) * (0.55 + 0.9 * c);
    h = n * 0.0005 * fd; alb = mix(1.0, 0.72 + 0.5 * n, fd) * (0.82 + 0.3 * c + 0.38 * band * mix(0.6, n, fd)); rmod = -n * 0.15 - band * 0.12;
  } else if (pid < 6.5) { // hammered steel
    float n = vn3(p * 140.0);
    h = n * 0.00035 * aaFade(140.0); alb = 0.94 + 0.12 * vn3(p * 30.0); rmod = (n - 0.5) * 0.18;
  } else if (pid < 7.5) { // fur
    float n = vn3(vec3(p.x * 420.0, p.y * 120.0, p.z * 420.0));
    float fd = aaFade(420.0);
    h = n * 0.0012 * fd; alb = mix(1.0, 0.65 + 0.6 * n, fd);
  } else if (pid < 8.5) { // wood
    float n = vn3(vec3(p.x * 30.0, p.y * 300.0, p.z * 30.0));
    h = n * 0.0003; alb = 0.8 + 0.35 * n;
  } else if (pid < 9.5) { // skin
    float n = vn3(p * 900.0) * aaFade(900.0);
    h = n * 0.00006; alb = 0.96 + 0.08 * vn3(p * 60.0); rmod = (n - 0.5) * 0.1;
  }
}
vec3 miniPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

let blankFace = null;
function blankFaceTexture() {
  if (!blankFace) {
    blankFace = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blankFace.needsUpdate = true;
  }
  return blankFace;
}

/**
 * The miniature material (vertex-painted, detailed in the shader).
 * @param {THREE.Texture|null} faceTex
 */
export function figureMaterial(faceTex, skinLin = null) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  m.userData.faceMap = { value: faceTex ?? blankFaceTexture() };
  m.userData.uSkin = { value: new THREE.Vector3(...(skinLin ?? [0.6, 0.4, 0.3])) };
  m.customProgramCacheKey = () => 'por-mini-v8';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.faceMap = m.userData.faceMap;
    sh.uniforms.uSkin = m.userData.uSkin;
    sh.uniforms.uDetail = { value: 1 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nattribute vec3 aFace;\nvarying vec4 vMat;\nvarying vec3 vFace;\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vFace = aFace; vObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${PATTERN_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pid = floor(vMat.x + 0.5);
        vec4 fcol = texture2D(faceMap, vFace.xy);
        float faceW = fcol.a * vFace.z;
        // On skin the painted face is a tint relative to the base skin, so the
        // baked wash and occlusion survive (no pale 'mask' where it is painted).
        vec3 fLin = fcol.rgb * fcol.rgb;
        vec3 painted = (pid > 8.5 && pid < 9.5) ? diffuseColor.rgb * clamp(fLin / max(uSkin, vec3(0.02)), 0.0, 1.6) : fLin;
        diffuseColor.rgb = mix(diffuseColor.rgb, painted, faceW);
        float miniH; float miniAlb; float miniR;
        miniPattern(pid, miniH, miniAlb, miniR);
        diffuseColor.rgb *= mix(miniAlb, 1.0, faceW);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(vMat.y + miniR, mix(0.5, 0.06, vMat.z), 1.0);
// pewter breakup: rubbed and tarnished patches on the metal so its sheen is broken, not plastic
float pwN = fract(sin(dot(floor(vObj * 140.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
float pwM = fract(sin(dot(floor(vObj * 23.0), vec3(39.34, 11.13, 83.71))) * 24634.6345);
roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * (0.6 + 0.5 * pwN + 0.45 * pwM), 0.08, 1.0), vMat.z);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.z;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = miniPerturb(-vViewPosition, normal, vec2(dFdx(miniH), dFdy(miniH)) * uDetail, faceDirection);
        {
          // Painted-miniature finish (as a wargamer paints a 28 mm figure): a dark wash pooled in the
          // recesses, a zenithal highlight on every up-facing plane, a drybrushed edge where the form
          // turns away from the eye; metal parts keep their own sheen. The painted face is left alone.
          vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float zen = smoothstep(-0.25, 0.95, wN.y);
          float wash = mix(0.34, 1.0, smoothstep(0.38, 0.97, vMat.w));
          float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2) * smoothstep(-0.2, 0.55, wN.y);
          float pm = (1.0 - faceW) * (1.0 - 0.7 * vMat.z);
          diffuseColor.rgb *= mix(1.0, wash * mix(0.72, 1.24, zen), pm);
          diffuseColor.rgb += (diffuseColor.rgb * 1.1 + 0.035) * edge * 0.95 * pm;
          // worn metal: the drybrushed edge catches on armour too (pewter showing through the paint)
          diffuseColor.rgb += vec3(0.05, 0.048, 0.044) * edge * vMat.z * (1.0 - faceW);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Skin: a touch of subsurface warmth in the shadows.
        if (pid > 8.5 && pid < 9.5) totalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.012, 0.006) * vMat.w;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vMat.w;
        reflectedLight.indirectSpecular *= mix(1.0, vMat.w, 0.85);
        reflectedLight.directDiffuse *= mix(1.0, vMat.w, 0.35);`)
      .replace('#include <dithering_fragment>', HIGHLIGHT_CAP);
  };
  return m;
}

// ------------------------------------------------------------------ weapons and shields (crisp meshes)

function weaponMesh(kind, mats, scale = 1) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const { steel, darkSteel, gilt, wood, leather } = mats;
  if (kind === 'staff') {
    const prof = [];
    for (let i = 0; i <= 24; i++) {
      const y = i / 24;
      prof.push(new THREE.Vector2(0.016 + 0.003 * Math.sin(i * 2.3) + (y > 0.92 ? 0.012 * Math.sin((y - 0.92) / 0.08 * Math.PI) : 0), -0.62 + y * 1.62));
    }
    add(new THREE.LatheGeometry(prof, 10), wood);
    // An iron-banded, carved head with a dull amber stone set in its claws.
    add(new THREE.CylinderGeometry(0.021, 0.021, 0.025, 12), darkSteel, 0, 0.88);
    add(new THREE.CylinderGeometry(0.019, 0.019, 0.02, 12), darkSteel, 0, -0.58);
    for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.008, 0.07, 5), wood, Math.cos(i * 1.57) * 0.018, 1.02, Math.sin(i * 1.57) * 0.018, Math.sin(i * 1.57) * 0.35, 0, -Math.cos(i * 1.57) * 0.35);
    const stone = add(new THREE.IcosahedronGeometry(0.022, 1), mats.amber, 0, 1.02, 0);
    stone.castShadow = false;
  } else if (kind === 'mace' || kind === 'axe') {
    add(new THREE.CylinderGeometry(0.013, 0.015, 0.5, 10), wood, 0, 0.12, 0);
    add(new THREE.CylinderGeometry(0.017, 0.017, 0.11, 10), leather, 0, 0, 0);
    if (kind === 'mace') {
      add(new THREE.SphereGeometry(0.038, 14, 10), steel, 0, 0.38, 0, 0, 0, 0).scale.set(1, 1.2, 1);
      for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.01, 0.1, 0.045), steel, Math.cos(i * 0.9) * 0.032, 0.38, Math.sin(i * 0.9) * 0.032, 0, -i * 0.9, 0);
    } else {
      const ax = new THREE.Shape();
      ax.moveTo(0, 0.05);
      ax.quadraticCurveTo(0.08, 0.07, 0.13, 0.13);
      ax.quadraticCurveTo(0.1, 0, 0.13, -0.11);
      ax.quadraticCurveTo(0.07, -0.04, 0, -0.03);
      add(new THREE.ExtrudeGeometry(ax, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), steel, 0.01, 0.32, -0.005);
    }
  } else if (kind === 'spear') {
    add(new THREE.CylinderGeometry(0.012, 0.014, 1.7, 8), wood, 0, 0.3, 0);
    add(new THREE.ConeGeometry(0.03, 0.18, 4), steel, 0, 1.24, 0, 0, Math.PI / 4, 0).scale.set(1, 1, 0.3);
  } else if (kind === 'bow') {
    add(new THREE.TorusGeometry(0.46, 0.011, 6, 28, Math.PI * 0.8), wood, -0.4, 0, 0, 0, 0, -Math.PI * 0.4);
    add(new THREE.CylinderGeometry(0.0018, 0.0018, 0.88, 4), mats.string, -0.05, 0, 0);
  } else if (kind === 'sling') {
    add(new THREE.TorusGeometry(0.06, 0.004, 4, 16), leather, 0, -0.1, 0);
  } else {
    const bl = kind === 'dagger' ? 0.26 : 0.72;
    const bs = new THREE.Shape();
    bs.moveTo(-0.021, 0);
    bs.lineTo(-0.017, bl * 0.84);
    bs.lineTo(0, bl);
    bs.lineTo(0.017, bl * 0.84);
    bs.lineTo(0.021, 0);
    bs.closePath();
    const bg = new THREE.ExtrudeGeometry(bs, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.005, bevelSegments: 1 });
    bg.translate(0, 0.075, -0.001);
    add(bg, steel);
    add(new THREE.BoxGeometry(0.009, bl * 0.72, 0.0045), darkSteel, 0, 0.075 + bl * 0.38, 0);
    add(new THREE.BoxGeometry(kind === 'dagger' ? 0.09 : 0.17, 0.022, 0.03), gilt, 0, 0.068, 0);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.015, 8, 6), gilt, s * (kind === 'dagger' ? 0.045 : 0.085), 0.068, 0);
    add(new THREE.CylinderGeometry(0.014, 0.015, 0.11, 10), leather, 0, 0.005, 0);
    add(new THREE.SphereGeometry(0.022, 12, 10), gilt, 0, -0.06, 0);
    // Turn the blade's flat toward the knuckles: it reads better on a miniature than the edge.
    g.rotation.y = Math.PI / 2;
  }
  g.scale.setScalar(scale);
  const outer = new THREE.Group();
  outer.add(g);
  return outer;
}

function shieldMesh(kind, her, mats, scale = 1) {
  const g = new THREE.Group();
  g.userData.device = her.key;
  const faceTex = TX.shieldFaceTexture(her, kind === 'round' ? 'round' : 'heater');
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.55, metalness: 0.05 });
  mats.extra.push(faceMat);
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  if (kind === 'round') {
    const d = add(new THREE.CylinderGeometry(0.22, 0.22, 0.026, 40), [mats.leather, faceMat, mats.leather]);
    d.rotation.x = Math.PI / 2;
    d.geometry.rotateY(-Math.PI / 2);
    const rim = add(new THREE.TorusGeometry(0.22, 0.013, 8, 48), mats.gilt);
    rim.position.z = 0.012;
    const boss = add(new THREE.SphereGeometry(0.045, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.gilt);
    boss.rotation.x = Math.PI / 2;
    boss.position.z = 0.012;
  } else {
    const s = new THREE.Shape();
    s.moveTo(-0.19, 0.23);
    s.lineTo(0.19, 0.23);
    s.bezierCurveTo(0.19, -0.02, 0.13, -0.18, 0, -0.3);
    s.bezierCurveTo(-0.13, -0.18, -0.19, -0.02, -0.19, 0.23);
    const eg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 2, curveSegments: 18 });
    const pa = eg.attributes.position;
    const uv = eg.attributes.uv;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      uv.setXY(i, (x + 0.21) / 0.42, (y + 0.32) / 0.57);
      pa.setZ(i, pa.getZ(i) - x * x * 1.0);
    }
    eg.computeVertexNormals();
    add(eg, [faceMat, mats.leather]).position.z = -0.01;
    const pts = s.getSpacedPoints(64).map((pt) => new THREE.Vector3(pt.x * 1.03, pt.y * 1.025, 0.012 - pt.x * pt.x * 1.0));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 90, 0.0095, 6, true), mats.gilt);
  }
  g.scale.setScalar(scale);
  return g;
}

let handGeo = null;
/** A gripping hand in the fist frame (x knuckles, y grip axis, z forward), metres at size 1. */
function handGeometry() {
  if (handGeo) return handGeo;
  const parts = [];
  const seg = (a, b, r1, r2) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r2, r1, len, 8, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    g.translate(A.x, A.y, A.z);
    parts.push(g);
    const j = new THREE.SphereGeometry(r2 * 1.02, 8, 6);
    j.translate(B.x, B.y, B.z);
    parts.push(j);
  };
  // palm (the back of the hand rises toward the knuckles)
  const palm = new THREE.SphereGeometry(1, 12, 10);
  palm.scale(0.026, 0.041, 0.019);
  palm.translate(-0.004, 0.001, -0.006);
  parts.push(palm);
  for (let i = 0; i < 4; i++) {
    const yy = -0.027 + i * 0.0182;
    const k = i === 0 ? 0.86 : i === 3 ? 0.94 : 1;
    const r = 0.0082 * k;
    const p0 = [0.016, yy, -0.008], p1 = [0.03 * k, yy * 1.02, 0.004], p2 = [0.027 * k, yy * 1.03, 0.018], p3 = [0.014, yy * 1.02, 0.023];
    const kn = new THREE.SphereGeometry(r * 1.08, 8, 6);
    kn.translate(...p0);
    parts.push(kn);
    seg(p0, p1, r, r * 0.95);
    seg(p1, p2, r * 0.95, r * 0.86);
    seg(p2, p3, r * 0.86, r * 0.78);
  }
  // the thumb wraps the grip from the other side
  seg([-0.014, 0.026, -0.012], [0.002, 0.036, 0.008], 0.0105, 0.0092);
  seg([0.002, 0.036, 0.008], [0.016, 0.031, 0.017], 0.0092, 0.008);
  handGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  for (const g of parts) g.dispose();
  handGeo.computeVertexNormals();
  return handGeo;
}

/**
 * A soft shoulder on a figure's lit colour, below the bloom threshold: polished steel and gilt
 * catch the candles as highlights, never as glowing emitters (only flames bloom).
 */
const HIGHLIGHT_CAP = `
  { vec3 kk = max(gl_FragColor.rgb - 0.55, 0.0); gl_FragColor.rgb = gl_FragColor.rgb - kk + kk / (1.0 + 3.0 * kk); }
  #include <dithering_fragment>`;
export function capHighlights(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', HIGHLIGHT_CAP);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ''}|hcap`;
  return m;
}

function gearMats() {
  const M = (o) => capHighlights(new THREE.MeshStandardMaterial(o));
  return {
    glove: M({ color: 0x7a5434, roughness: 0.6 }),
    steel: M({ color: 0xc4c8d0, metalness: 1, roughness: 0.26 }),
    darkSteel: M({ color: 0x70737a, metalness: 1, roughness: 0.4 }),
    gilt: M({ color: 0xd6aa52, metalness: 1, roughness: 0.3 }),
    wood: M({ color: 0x7a5232, roughness: 0.75 }),
    leather: M({ color: 0x4a301e, roughness: 0.65 }),
    amber: M({ color: 0xc8782a, roughness: 0.2, metalness: 0.1, emissive: 0x5a2006, emissiveIntensity: 0.4 }),
    string: M({ color: 0xd8d0b8, roughness: 0.9 }),
    extra: [],
  };
}

// ------------------------------------------------------------------ building a miniature

let blank = null;
function blankFaceCanvas() {
  if (!blank) {
    blank = document.createElement('canvas');
    blank.width = blank.height = 4;
  }
  return blank;
}

let casterGeo = null;
let casterMat = null;
function headCasterGeo() {
  if (!casterGeo) {
    casterGeo = new THREE.SphereGeometry(1, 16, 12);
    casterGeo.scale(0.082, 0.112, 0.105);
    casterGeo.translate(0, 0.0, 0.0);
  }
  return casterGeo;
}
function shadowOnlyMat() {
  casterMat ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  return casterMat;
}

/**
 * Build a miniature.
 * @param {{race:string, gender?:string, classSpec:string, look?:object, name?:string, inventory?:object[]}} ch
 * @param {{pose?: Pose, base?: boolean, quality?: keyof QUALITY|number, gear?: boolean, blanket?: string, faceSize?: number, noWeapon?: boolean, bounds?: number[], boundsFn?: Function}} [opt]
 * @returns {THREE.Group & {userData:{dispose:()=>void, update:(t:number)=>void, height:number, frames:object, app:object}}}
 */
export function buildMiniature(ch, opt = {}) {
  const pose = opt.pose ?? 'stand';
  const app = resolveAppearance(ch, { gear: opt.gear });
  const cell = typeof opt.quality === 'number' ? opt.quality : QUALITY[opt.quality ?? (pose === 'sit' || pose === 'sleep' || pose === 'guard' ? 'camp' : 'hero')];
  const rayHead = opt.rayHead === true;
  const crisp = pose !== 'sleep' && opt.crispHands !== false;
  const d = figureData(app, pose, cell, { blanket: opt.blanket, noWeapon: opt.noWeapon, noHead: rayHead, mod: opt.mod, bounds: opt.bounds, boundsFn: opt.boundsFn, boundsKey: opt.boundsKey, crispHands: crisp });
  const fr = d.frames;
  const root = new THREE.Group();
  const fig = new THREE.Group();
  root.add(fig);
  const disposables = [];
  const geo = geometryOf(d);
  disposables.push(geo);
  // The ray-marched head paints its own face: the body needs no face texture.
  const faceCanvas = rayHead ? blankFaceCanvas() : paintFaceSkin(app, { size: opt.faceSize ?? (cell < 0.008 ? 512 : 256), asleep: fr.asleep, portrait: pose === 'portrait' });
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.NoColorSpace;
  faceTex.anisotropy = 4;
  disposables.push(faceTex);
  const sl = app.lin(app.skinHex);
  const sgy = (sl[0] + sl[1] + sl[2]) / 3;
  const mat = figureMaterial(faceTex, sl.map((v) => v + (sgy - v) * 0.26));
  disposables.push(mat);
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  fig.add(body);
  if (rayHead) {
    // The ray-marched head (exact anatomy at any size) and an invisible stand-in that casts its shadow.
    const head = createHead(app, fr.face, { asleep: fr.asleep, ambient: opt.headAmbient, fog: !!opt.fog, gain: opt.headGain, lite: opt.headLite, variant: opt.headVariant });
    if (!globalThis.__NOHEAD) fig.add(head); // DBGTMP
    disposables.push({ dispose: () => head.userData.dispose() });
    const { c, R, hs } = fr.face;
    const caster = new THREE.Mesh(headCasterGeo(), shadowOnlyMat());
    caster.position.set(...c);
    caster.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1));
    caster.scale.setScalar(hs);
    caster.castShadow = true;
    caster.userData.sharedGeo = true;
    fig.add(caster);
    root.userData.head = head;
  }

  // Weapon and shield.
  const gm = gearMats();
  // Hands: crisp curled fingers and a thumb round the grip (a sculpted fist melts at miniature scale).
  if (crisp && fr.hands?.L) {
    const kind = fr.hands.kind;
    const hm = kind === 'steel' ? gm.darkSteel : kind === 'glove' ? gm.glove : new THREE.MeshStandardMaterial({ color: new THREE.Color(app.skinHex).multiplyScalar(0.82), roughness: 0.62 });
    if (kind === 'skin') gm.extra.push(hm);
    for (const k of ['L', 'R']) {
      const hd = fr.hands[k];
      const mesh = new THREE.Mesh(handGeometry(), hm);
      const R = hd.R;
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(R[0], R[1], R[2]), new THREE.Vector3(R[3], R[4], R[5]), new THREE.Vector3(R[6], R[7], R[8])));
      mesh.position.set(...hd.c);
      mesh.scale.setScalar(hd.size);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.sharedGeo = true;
      fig.add(mesh);
    }
  }
  const wscale = Math.max(0.68, Math.min(1, fr.scale * 1.05));
  if (fr.weapon) {
    const w = weaponMesh(app.weapon, gm, wscale);
    const y = new THREE.Vector3(...fr.weapon.dir).normalize();
    let x = new THREE.Vector3(...(fr.weapon.knuckle ?? [1, 0, 0]));
    x.sub(y.clone().multiplyScalar(x.dot(y))).normalize();
    if (x.lengthSq() < 0.1) x = new THREE.Vector3(1, 0, 0);
    const z = new THREE.Vector3().crossVectors(x, y);
    w.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    w.position.set(...fr.weapon.pos);
    fig.add(w);
  }
  if (fr.shield && !opt.noShield) {
    const sh = shieldMesh(app.shield, app.heraldry, gm, (fr.shield.scale ?? 1) * wscale);
    const z = new THREE.Vector3(...fr.shield.n).normalize();
    const y = new THREE.Vector3(...fr.shield.up);
    y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    sh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    sh.position.set(...fr.shield.pos);
    fig.add(sh);
  } else if (pose === 'sit' && app.shield && opt.gear && !opt.noShield) {
    // Seated at camp the shield is set down, propped against the seat at the sitter's side, so the
    // figure by the fire still carries its colours (the same device it bears on the board).
    const sh = shieldMesh(app.shield, app.heraldry, gm, wscale * 0.95);
    const pz = fr.joints?.pelvis?.[2] ?? 0;
    const z = new THREE.Vector3(-0.55, 0.32, 0.78).normalize();
    const y = new THREE.Vector3(0.12, 1, -0.3);
    y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    sh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    sh.position.set(-0.5 * fr.scale, 0.27 * wscale, pz + 0.12);
    fig.add(sh);
  }

  // Base: a bevelled round base with a painted earth-and-grass top and a gilt rim.
  let baseH = 0;
  if (opt.base !== false && pose !== 'sleep' && pose !== 'sit') {
    const bs = TX.baseSet();
    const top = new THREE.MeshStandardMaterial({ roughness: 0.95, map: bs.map, normalMap: bs.normalMap, roughnessMap: bs.roughnessMap });
    const rim = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.5, metalness: 0.2 });
    disposables.push(top, rim);
    const r = Math.max(0.36, 0.5 * Math.max(0.75, fr.scale));
    const prof = [[0.0001, 0], [r + 0.03, 0], [r + 0.04, 0.012], [r + 0.03, 0.07], [r, 0.085], [0.0001, 0.085]].map(([a, b]) => new THREE.Vector2(a, b));
    const bg = new THREE.LatheGeometry(prof, 64);
    disposables.push(bg);
    const base = new THREE.Mesh(bg, rim);
    base.receiveShadow = true;
    base.castShadow = true;
    root.add(base);
    const tg = new THREE.CircleGeometry(r, 64);
    disposables.push(tg);
    const t = new THREE.Mesh(tg, top);
    t.rotation.x = -Math.PI / 2;
    t.position.y = 0.0855;
    t.receiveShadow = true;
    root.add(t);
    // Static-grass flock over the painted earth: clumps of fine olive and straw tufts with a few
    // grey pebbles, as on a finished wargame base (the top's own camo reads as earth beneath).
    top.color.setHex(0x8a8070);
    {
      const tuftG = new THREE.ConeGeometry(0.0075, 0.04, 4, 1);
      tuftG.translate(0, 0.02, 0);
      const pebG = new THREE.DodecahedronGeometry(0.012, 0);
      disposables.push(tuftG, pebG);
      const tuftM = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: false });
      const pebM = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.9 });
      disposables.push(tuftM, pebM);
      const N = 260, NP = 9;
      const tufts = new THREE.InstancedMesh(tuftG, tuftM, N);
      const pebs = new THREE.InstancedMesh(pebG, pebM, NP);
      let sd = (app.seed ?? 7) * 9301 + 49297;
      const rnd = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
      const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
      const C = new THREE.Color();
      const clumps = Array.from({ length: 11 }, () => { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (r - 0.05); return [Math.cos(a) * d, Math.sin(a) * d]; });
      for (let i = 0; i < N; i++) {
        const [cx, cz] = clumps[i % clumps.length];
        const a = rnd() * Math.PI * 2, d = rnd() * rnd() * 0.07;
        let x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        const rr = Math.hypot(x, z);
        if (rr > r - 0.012) { x *= (r - 0.012) / rr; z *= (r - 0.012) / rr; }
        E.set((rnd() - 0.5) * 0.9, rnd() * 6.28, (rnd() - 0.5) * 0.9);
        Q.setFromEuler(E);
        const sc = 0.55 + rnd() * 0.9;
        M4.compose(V.set(x, 0.085, z), Q, S.set(sc, sc * (0.7 + rnd() * 0.8), sc));
        tufts.setMatrixAt(i, M4);
        const t = rnd();
        // olive-brown static grass, low in chroma: under the torch it must read as turf, not straw
        tufts.setColorAt(i, C.setRGB(0.038 + t * 0.04, 0.046 + t * 0.036, 0.024 + t * 0.014));
      }
      for (let i = 0; i < NP; i++) {
        const a = rnd() * Math.PI * 2, d = (0.3 + rnd() * 0.65) * (r - 0.04);
        Q.setFromEuler(E.set(rnd() * 3, rnd() * 3, rnd() * 3));
        const sc = 0.6 + rnd() * 1.1;
        M4.compose(V.set(Math.cos(a) * d, 0.086, Math.sin(a) * d), Q, S.set(sc, sc * 0.6, sc));
        pebs.setMatrixAt(i, M4);
      }
      tufts.receiveShadow = true;
      pebs.castShadow = true;
      pebs.receiveShadow = true;
      root.add(tufts, pebs);
      // a darker band of earth round the edge of the groundwork, as a painter rims a base
      const earthG = new THREE.TorusGeometry(r - 0.008, 0.011, 6, 96);
      const earthM = new THREE.MeshStandardMaterial({ color: 0x1c140c, roughness: 1 });
      disposables.push(earthG, earthM);
      const earth = new THREE.Mesh(earthG, earthM);
      earth.rotation.x = Math.PI / 2;
      earth.position.y = 0.0855;
      earth.scale.z = 0.45;
      earth.receiveShadow = true;
      root.add(earth);
    }
    const ringG = new THREE.TorusGeometry(r + 0.036, 0.006, 6, 96);
    disposables.push(ringG);
    const ring = new THREE.Mesh(ringG, gm.gilt);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.045;
    root.add(ring);
    baseH = 0.085;
  }
  fig.position.y = baseH;

  // Sleepers lie on their backs: the figure's front faces up, head toward −z.
  if (pose === 'sleep') {
    fig.rotation.x = -Math.PI / 2;
    const bb = geo.boundingBox;
    fig.position.y = -bb.min.z;
  }

  // Idle life: breathing and a slow sway (sitters lean toward the fire).
  const seedPh = (app.seed % 1000) / 159;
  root.userData.update = (t) => {
    const b = Math.sin(t * 1.6 + seedPh);
    if (pose === 'sleep') {
      fig.scale.set(1, 1, 1 + b * 0.006);
    } else {
      fig.scale.set(1 + b * 0.0035, 1 + b * 0.002, 1 + b * 0.0045);
      fig.rotation.y = Math.sin(t * 0.37 + seedPh) * (pose === 'sit' ? 0.035 : 0.02);
    }
  };
  root.userData.update(0);
  root.userData.height = fr.height + baseH;
  root.userData.frames = fr;
  root.userData.app = app;
  root.userData.dispose = () => {
    for (const x of disposables) x.dispose();
    root.traverse((o) => { if (o.isMesh && o !== body && o.geometry && !o.userData.sharedGeo && !disposables.includes(o.geometry)) o.geometry.dispose(); });
    for (const m of Object.values(gm)) if (m?.dispose) m.dispose();
    for (const m of gm.extra) m.dispose();
  };
  return root;
}

/**
 * A soft studio environment for miniature reflections: warm key from the
 * front-left, cool rim from behind, dark floor — no hard light boxes, so
 * curved steel reads as polished rather than glittering.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{warm?: number, cool?: number}} [o]
 * @returns {THREE.Texture} dispose() when done
 */
export function miniatureEnvironment(renderer, o = {}) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const p = geo.attributes.position;
  const warm = new THREE.Color(o.warm ?? 0xffb070);
  const cool = new THREE.Color(o.cool ?? 0x6a86c8);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 10;
    const y = p.getY(i) / 10;
    const z = p.getZ(i) / 10;
    const key = Math.max(0, x * -0.5 + y * 0.5 + z * 0.7);
    const rim = Math.max(0, -z * 0.8 + y * 0.3);
    c.setRGB(0.03, 0.03, 0.04);
    c.lerp(new THREE.Color(0.18, 0.16, 0.14), Math.max(0, y) * 0.6);
    c.add(warm.clone().multiplyScalar(key ** 3 * 1.4));
    c.add(cool.clone().multiplyScalar(rim ** 2 * 0.8));
    if (y < -0.1) c.multiplyScalar(0.4);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  geo.dispose();
  mat.dispose();
  return tex;
}

// ------------------------------------------------------------------ offscreen renders (snapshots, portraits)

let off = null;
let shared = null;
/**
 * Render offscreen figures (portraits, snapshots) with the game's own WebGL
 * renderer: render targets only, its clear state restored. A second context
 * would have to synchronise with the game's every time pixels are read back,
 * which is very slow in software GL. Scenes and UI components that show
 * portraits call this with ctx.render.renderer.
 * @param {THREE.WebGLRenderer} renderer
 */
export function useRenderer(renderer) {
  if (!renderer || shared?.renderer === renderer) return;
  shared = { renderer, env: miniatureEnvironment(renderer) };
}

/**
 * The renderer used for 2D images of miniatures and portrait busts: the
 * game's (see useRenderer), else a private fallback context. Null if WebGL
 * is unavailable.
 */
export function offscreen() {
  if (shared) return shared;
  if (off) return off;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    off = { renderer, env: miniatureEnvironment(renderer) };
  } catch {
    off = null;
  }
  return off;
}

let stage = null;
/**
 * The paperdoll's backdrop: a stone alcove of dressed ashlar with a warm pool
 * of light behind the figure, falling off to a vignette (deterministic).
 */
function paintAlcove(g, W, H) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#17141b';
  g.fillRect(0, 0, W, H);
  const rowH = 30;
  for (let y = 0, r = 0; y < H * 0.8; y += rowH, r++) {
    let x = -rnd() * 60;
    while (x < W) {
      const bw = 46 + rnd() * 44;
      const t = 0.75 + rnd() * 0.5;
      g.fillStyle = `rgb(${Math.round(44 * t)},${Math.round(40 * t)},${Math.round(46 * t)})`;
      g.fillRect(x + 1.5, y + 1.5, bw - 3, rowH - 3);
      // Chipped arrises and a lit top edge on each block.
      g.fillStyle = 'rgba(255,240,220,0.05)';
      g.fillRect(x + 2, y + 2, bw - 4, 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 2, y + rowH - 4, bw - 4, 2);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.1})`;
        g.fillRect(x + rnd() * bw, y + rnd() * rowH, 2 + rnd() * 5, 1 + rnd() * 2);
      }
      x += bw;
    }
  }
  // The floor: worn flags receding into shadow.
  const fl = g.createLinearGradient(0, H * 0.78, 0, H);
  fl.addColorStop(0, '#0d0b10');
  fl.addColorStop(1, '#221d22');
  g.fillStyle = fl;
  g.fillRect(0, H * 0.78, W, H * 0.22);
  // Pool of warm light behind the figure, and the vignette.
  g.globalCompositeOperation = 'lighter';
  const pool = g.createRadialGradient(W * 0.5, H * 0.5, 8, W * 0.5, H * 0.52, H * 0.55);
  pool.addColorStop(0, 'rgba(150,104,62,0.55)');
  pool.addColorStop(0.4, 'rgba(90,60,44,0.25)');
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

function snapshotStage() {
  const o = offscreen();
  if (!o) return null;
  if (stage && stage.env === o.env) return stage;
  const scene = new THREE.Scene();
  scene.environment = o.env;
  // Low key, as on the board: a warm torch high to one side models the figure, the room's
  // reflected light is dim, a cool rim picks out the silhouette.
  scene.environmentIntensity = 0.38;
  scene.add(new THREE.HemisphereLight(0x5a6aa0, 0x100c08, 0.18));
  const key = new THREE.SpotLight(0xffd2a0, 78, 14, 0.42, 0.55, 1.4);
  key.position.set(2.6, 3.9, 2.2);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x8fa8ff, 2.2);
  rim.position.set(-2.5, 2.6, -3);
  scene.add(rim);
  const warm = new THREE.PointLight(0xffa050, 2.2, 6, 1.6);
  warm.position.set(-1.8, 0.9, 1.6);
  scene.add(warm);
  // A lit stone plinth and a dark backdrop with a pool of light.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.3, 48), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.85 }));
  plinth.position.y = -0.15;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const back = document.createElement('canvas');
  back.width = 256;
  back.height = 512;
  paintAlcove(back.getContext('2d', { willReadFrequently: true }), 256, 512);
  const bt = new THREE.CanvasTexture(back);
  bt.colorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(24, 0.6, 0.1, 50);
  stage = { scene, camera, background: bt, plinth, env: o.env };
  return stage;
}

const snapCache = new Map();
/**
 * Render a character's miniature (dressed in its readied gear) on a lit
 * plinth to an image URL, for 2D UI such as the sheet and the ITEMS paperdoll.
 * Cached per appearance. Returns null if WebGL is unavailable.
 * @param {object} ch
 * @param {{w?: number, h?: number, backdrop?: boolean}} [o]
 * @returns {string|null}
 */
const keepers = [];
/**
 * Hold the last few offscreen figures undisposed: their materials keep their compiled programs
 * alive, so the next portrait or snapshot of the same kind reuses them instead of relinking.
 * @param {THREE.Object3D} fig
 */
export function keepAlive(fig) {
  keepers.push(fig);
  while (keepers.length > 3) keepers.shift().userData.dispose();
}

export function miniatureSnapshot(ch, o = {}) {
  const w = o.w ?? 360;
  const h = o.h ?? 600;
  const key = `${appearanceKey(ch)}|${ch.hp ? (ch.hp.cur <= 0 ? 'down' : '') : ''}|${w}|${h}|${o.backdrop !== false}|${o.tight ? 't' : ''}`;
  if (snapCache.has(key)) return snapCache.get(key);
  try {
    const st = snapshotStage();
    if (!st) return null;
    const { renderer } = offscreen();
    const cam = st.camera;
    const m = buildMiniature(ch, { pose: 'display', base: true, quality: 'snap', rayHead: true, headGain: o.tight ? 0.8 : 0.62, headAmbient: [0.04, 0.04, 0.05], headVariant: 'snap' });
    const H = m.userData.height;
    cam.aspect = w / h;
    cam.fov = 24;
    // Frame the whole figure with its weapon (the sword is held out to the side).
    // (tight: the figure fills the frame, the plinth's rim at the bottom edge — the sheet's icon)
    const dist = (H * (o.tight ? 0.98 : 1.24)) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    cam.position.set(0, H * (o.tight ? 0.66 : 0.62), dist);
    cam.lookAt(0, H * (o.tight ? 0.5 : 0.54), 0);
    cam.updateProjectionMatrix();
    m.rotation.y = -0.28;
    st.scene.add(m);
    st.scene.background = o.backdrop === false ? null : st.background;
    st.plinth.visible = o.backdrop !== false;
    const cv = renderToCanvas(renderer, st.scene, cam, { w, h, exposure: o.tight ? 1.55 : 1.32, alpha: o.backdrop === false, key: 'snap' });
    // Painted eyes, brows and mouth at the snapshot's own resolution.
    if (!m.userData.head) try { finishFace(renderer, st.scene, cam, m, cv, m.userData.app, { mini: true, key: 'snapMask' }); } catch { /* keep the plain render */ }
    const url = cv.toDataURL('image/png');
    st.scene.remove(m);
    keepAlive(m);
    if (snapCache.size > 24) snapCache.delete(snapCache.keys().next().value);
    snapCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
