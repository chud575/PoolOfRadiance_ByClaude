import * as THREE from 'three';
import { resolveAppearance, rngFrom, hashNum } from './lookData.js';
import { headParams } from './headShader.js';
import { HEAD_PARAMS, GLSL_COMMON, GLSL_HEAD } from './portraitHeadGLSL.js';
import { GLSL_DRESS, GLSL_SHADE, GLSL_POST, BODY_ID, HAIR_ID, BEARD_ID } from './portraitPaintGLSL.js';
import { oilPaint } from './portraitOil.js';

/**
 * The portrait painter. One full-screen fragment shader ray-marches a
 * head-and-shoulders bust (portraitHeadGLSL: the skull and features of the
 * character's head template, race and sex; portraitPaintGLSL: hair, beard,
 * helm or hood and the readied armour), lights it as a painter would — one
 * warm key high to the side, a cool reflected fill, a moonlit rim — with
 * painted complexion zones and subsurface warmth in the half-tones, over a
 * brushed backdrop. A second pass repaints the render in oil: forms flattened
 * into planes along the structure of the image, brush strokes that follow the
 * forms, lost and found edges, a canvas weave.
 *
 * Deterministic for a given appearance. No textures, no assets.
 */

/** Timings of the last portrait (ms): gpu render + readback, oil repaint. */
export const portraitStats = { gpu: 0, oil: 0, march: 0 };

export const PORTRAIT_W = 300;
export const PORTRAIT_H = 375;

const NP = HEAD_PARAMS.length;
const DEFINES = HEAD_PARAMS.map((k, i) => `#define ${k} uP[${i}]`).join('\n');

const VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const RENDER_FS = /* glsl */`
precision highp float;
layout(location = 0) out highp vec4 oColor;
layout(location = 1) out highp vec4 oInfo;
uniform float uP[${NP}];
${DEFINES}
uniform vec2 uRes;
uniform vec4 uBand;
uniform float uMode;
uniform float uSeed;
uniform float uLite;
uniform mat3 uHeadR;
uniform mat3 uBodyR;
uniform vec3 uHeadC;
uniform vec3 uCamPos;
uniform mat3 uCamR;
uniform float uFocal;
uniform vec3 uSkin;
uniform vec3 uHairC;
uniform vec3 uEyeC;
uniform vec3 uCloth;
uniform vec3 uTrim;
uniform vec3 uBgA;
uniform vec3 uBgB;
uniform int uHair;
uniform int uBeard;
uniform int uHelm;
uniform int uHood;
uniform int uBody;
uniform int uScar;
uniform int uCloak;
uniform int uCleric;
uniform float uHeadScale;
uniform vec3 uGaze;
uniform float uDbg;
uniform vec3 uKeyDir;
uniform vec4 uLightK;
uniform vec4 uSpot;
varying vec2 vUv;
${GLSL_COMMON}
${GLSL_HEAD}
${GLSL_DRESS}
${GLSL_SHADE}
`;

const INFO_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

const POST_FS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uRes;
uniform float uSeed;
uniform float uScale;
uniform float uMode;
varying vec2 vUv;
${GLSL_POST}
`;

let P = null;
function passes() {
  if (P) return P;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const render = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VS,
    fragmentShader: RENDER_FS,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uP: { value: new Float32Array(NP) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uBand: { value: new THREE.Vector4(0, 0, 1, 1) },
      uMode: { value: 0 },
      uSeed: { value: 0 },
      uLite: { value: 0 },
      uHeadR: { value: new THREE.Matrix3() },
      uBodyR: { value: new THREE.Matrix3() },
      uHeadC: { value: new THREE.Vector3() },
      uCamPos: { value: new THREE.Vector3() },
      uCamR: { value: new THREE.Matrix3() },
      uFocal: { value: 3 },
      uSkin: { value: new THREE.Vector3() },
      uHairC: { value: new THREE.Vector3() },
      uEyeC: { value: new THREE.Vector3() },
      uCloth: { value: new THREE.Vector3() },
      uTrim: { value: new THREE.Vector3() },
      uBgA: { value: new THREE.Vector3() },
      uBgB: { value: new THREE.Vector3() },
      uHair: { value: 0 },
      uBeard: { value: 0 },
      uHelm: { value: 0 },
      uHood: { value: 0 },
      uBody: { value: 0 },
      uScar: { value: 0 },
      uCloak: { value: 0 },
      uCleric: { value: 0 },
      uHeadScale: { value: 1 },
      uGaze: { value: new THREE.Vector3(0, 0, 1) },
      uDbg: { value: 0 },
      uKeyDir: { value: new THREE.Vector3(-0.78, 0.58, 0.32) },
      uLightK: { value: new THREE.Vector4(2.7, 0.36, 1.5, 1) },
      uSpot: { value: new THREE.Vector4(0.02, 0, 0, 0.028) },
    },
  });
  const post = new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: POST_FS,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tSrc: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uSeed: { value: 0 },
      uScale: { value: 1 },
      uMode: { value: 0 },
    },
  });
  const info = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: INFO_FS, depthTest: false, depthWrite: false, uniforms: { tSrc: { value: null } } });
  P = { scene, cam, quad, render, post, info, rts: new Map() };
  return P;
}

function rtFor(key, w, h, type, count = 1, filter = THREE.LinearFilter) {
  const p = passes();
  let rt = p.rts.get(key);
  if (rt && (rt.width !== w || rt.height !== h)) { rt.dispose(); rt = null; }
  if (!rt) {
    rt = new THREE.WebGLRenderTarget(w, h, { type, count, depthBuffer: false, minFilter: filter, magFilter: filter });
    p.rts.set(key, rt);
  }
  return rt;
}

const lin = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return new THREE.Vector3(...v.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)));
};
/** [yaw, pitch, tilt] per head template (F: the women's templates of the same name). */
const POSE = {
  Soldier: [-0.32, 0.0, 0.02], Wanderer: [0.36, 0.06, -0.06], Noble: [-0.5, -0.07, 0.03], Veteran: [-0.2, 0.07, 0.0],
  Guardsman: [-0.28, 0.0, -0.02], Rogue: [0.24, 0.03, 0.09], Hooded: [-0.42, 0.09, 0.02], Sage: [0.3, 0.03, -0.05],
  Maiden: [-0.38, -0.02, 0.07], Ranger: [-0.46, 0.0, -0.03], Priestess: [0.22, 0.05, 0.05], Duelist: [-0.14, 0.0, 0.09],
  Sorceress: [0.44, -0.06, -0.04], Shieldmaiden: [-0.3, -0.02, 0.0], HoodedF: [0.38, 0.08, 0.03], Mercenary: [-0.22, 0.04, -0.03],
};
const RACE_SCALE = { human: 1, elf: 0.97, halfElf: 0.99, dwarf: 1.04, gnome: 0.95, halfling: 0.93 };

function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new THREE.Matrix3().set(c, 0, s, 0, 1, 0, -s, 0, c); }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new THREE.Matrix3().set(1, 0, 0, 0, c, -s, 0, s, c); }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new THREE.Matrix3().set(c, -s, 0, s, c, 0, 0, 0, 1); }

/** Fill the render uniforms for one character. */
function setup(ch, o) {
  const p = passes();
  const u = p.render.uniforms;
  const app = resolveAppearance(ch, o.gear === false ? { gear: false } : {});
  const R = rngFrom(hashNum(app.seed, app.look.head, 'pose'));
  const params = headParams(app, { asleep: false });
  // headParams exaggerates each template for the meshed miniatures; a painted bust reads the
  // differences at half strength, with the race's own cues restored on top.
  const ix = (k) => HEAD_PARAMS.indexOf(k);
  for (const k of ['W', 'LONG', 'JAW', 'CHIN', 'CHEEK', 'NOSE', 'BRIDGE', 'TIP', 'EYE', 'SP', 'LIPS', 'MOUTH']) params[ix(k)] = 1 + (params[ix(k)] - 1) * 0.5;
  const RACE = {
    elf: { LONG: 1.04, W: 0.94, CHEEK: 1.08, JAW: 0.92, CHIN: 0.92 },
    halfElf: { LONG: 1.015, W: 0.98 },
    // dwarves (women too): a broad, low head, a heavy jaw and brow, a broad strong nose
    dwarf: { W: 1.15, NOSE: 1.12, BRIDGE: 1.35, TIP: 1.3, NWIDTH: 1.22, JAW: 1.25, CHIN: 1.15, BROW: 1.4, LONG: 0.92, CRAN: 0.9, CHEEK: 1.12, EYE: 0.95, EDEPTH: 1.3 },
    // halflings: adults with round, ruddy faces — full cheeks, a short snub nose, bright eyes
    halfling: { W: 1.07, LONG: 0.95, CHEEK: 1.15, NOSE: 0.92, TIP: 1.05, EYE: 1.02, JAW: 0.96, CHIN: 0.95, CRAN: 0.96 },
    gnome: { NOSE: 1.3, TIP: 1.45, W: 1.04, EYE: 1.04, BROW: 1.15 },
  }[app.race] ?? {};
  for (const [k, v] of Object.entries(RACE)) params[ix(k)] *= v;
  if (app.race === 'halfling') params[ix('HOOK')] -= 0.5;
  u.uP.value.set(params);
  const torso = o.crop === 'torso';
  // A three-quarter turn (alternating sides by seed, as a painter varies a gallery of portraits).
  const side = o.side ?? (app.look.seed % 2 ? 1 : -1) * 0;
  // Each head template sits for the painter its own way: turned toward the light or away into
  // shadow, chin raised or lowered, the head cocked.
  const pose = POSE[app.head?.name + (app.fem ? 'F' : '')] ?? POSE[app.head?.name] ?? [-0.36, 0.03, 0];
  const yaw = o.yaw ?? (torso ? pose[0] * 0.6 : pose[0] + (R() - 0.5) * 0.1);
  const pitch = o.pitch ?? (pose[1] + (R() - 0.5) * 0.04);
  const tilt = o.tilt ?? (pose[2] + (R() - 0.5) * 0.05);
  // The matrices map world → local (transpose of local → world rotation).
  const headM = rotY(yaw).multiply(rotX(pitch)).multiply(rotZ(tilt));
  u.uHeadR.value.copy(headM).transpose();
  u.uBodyR.value.copy(rotY(yaw * 0.45 + side)).transpose();
  const hs = RACE_SCALE[app.race] ?? 1;
  u.uHeadScale.value = hs;
  u.uHeadC.value.set(0, 0, 0);
  // Camera: a long lens (no distortion), eye level a touch below the eyes.
  const viewH = o.viewH ?? (torso ? 0.74 : 0.41);
  const fov = 14;
  const dist = viewH / (2 * Math.tan((fov * Math.PI) / 360));
  const target = new THREE.Vector3(0, o.targetY ?? (torso ? -0.24 : -0.082), 0);
  u.uCamPos.value.set(target.x + (o.camX ?? 0), target.y + 0.012, dist);
  const fwd = target.clone().sub(u.uCamPos.value).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  u.uCamR.value.set(right.x, up.x, fwd.x, right.y, up.y, fwd.y, right.z, up.z, fwd.z);
  u.uFocal.value = 1 / Math.tan((fov * Math.PI) / 360);
  // The eyes find the viewer (most of the way): the camera direction in head space.
  const toCam = u.uCamPos.value.clone().normalize();
  const gz = toCam.applyMatrix3(u.uHeadR.value).lerp(new THREE.Vector3(0, 0, 1), 0.3).normalize();
  gz.y = Math.max(gz.y, 0.03);
  u.uGaze.value.copy(gz.normalize());
  u.uSkin.value.copy(lin(app.skinHex));
  u.uHairC.value.copy(lin(app.hairHex));
  u.uEyeC.value.copy(lin(app.eyeHex));
  const muted = (v, k, m) => { const g = (v.x + v.y + v.z) / 3; return v.lerp(new THREE.Vector3(g, g, g), k).multiplyScalar(m); };
  const robed = app.body === 'robe' || app.body === 'vestments';
  u.uCloth.value.copy(muted(lin(robed ? app.robeHex : app.clothHex), 0.28, 0.85));
  u.uTrim.value.copy(muted(lin(app.trimHex), 0.25, 0.9));
  // Racial hair culture: dwarf women wear two heavy plaits, dwarf men a forked, ringed beard;
  // halflings a crop of curls.
  let hairId = HAIR_ID[app.hair] ?? 1;
  if (app.race === 'dwarf' && app.fem && !app.hood && app.hair !== 'bald') hairId = 11;
  if (app.race === 'halfling' && !app.hood && app.hair !== 'bald') hairId = 10;
  u.uHair.value = hairId;
  u.uBeard.value = app.race === 'dwarf' && !app.fem ? 6 : BEARD_ID[app.beard] ?? 0;
  u.uHelm.value = app.helm ? 1 : 0;
  u.uHood.value = app.hood ? 1 : 0;
  u.uBody.value = BODY_ID[app.body] ?? 0;
  u.uScar.value = app.scar ? 1 : 0;
  u.uCloak.value = app.cloak && !torso ? 1 : 0;
  u.uCleric.value = app.cleric ? 1 : 0;
  u.uSeed.value = (app.seed % 1000) / 1000;
  // Backdrop: a cool and a warm earth, picked to sit against the cloth colour.
  const bgs = [['#2a3442', '#6a5236'], ['#1f2a2e', '#5c4a30'], ['#33302c', '#7a5a38'], ['#272a38', '#5e4632'], ['#2c2a26', '#6e5a3c']];
  const bg = bgs[Math.floor(R() * bgs.length)];
  u.uBgA.value.copy(lin(bg[0]));
  u.uBgB.value.copy(lin(bg[1]));
  return app;
}

/**
 * Paint a portrait with a given WebGL renderer (the page's offscreen renderer, or a worker's).
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} ch  character or draft ({race, gender, classSpec, look, inventory?})
 * @param {{scale?: number, crop?: 'head'|'torso', mode?: number, yaw?: number, raw?: boolean}} [o]
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function renderPortraitWith(renderer, ch, o = {}) {
  const job = beginPortrait(renderer, ch, o);
  try {
    drawBand(renderer, job, 0, 1);
    return finishPortrait(renderer, job, o);
  } finally {
    endPortrait(renderer, job);
  }
}

/**
 * The same portrait, its ray-marched pass drawn in horizontal bands with a pause after each, so
 * the GPU (often shared with the page, and on software GL a single queue) interleaves the page's
 * own frames between them: the game keeps drawing while a portrait paints.
 * @returns {Promise<HTMLCanvasElement|OffscreenCanvas>}
 */
export async function renderPortraitBanded(renderer, ch, o = {}) {
  const gl = renderer.getContext();
  const job = beginPortrait(renderer, ch, o);
  endPortrait(renderer, job);
  const bands = o.bands ?? Math.max(1, Math.round((job.RW * job.RH) / 30000));
  for (let b = 0; b < bands; b++) {
    const prev = saveState(renderer);
    try {
      setupState(renderer, job);
      drawBand(renderer, job, b / bands, (b + 1) / bands);
    } finally {
      restoreState(renderer, prev);
    }
    await gpuIdle(gl);
  }
  const prev = saveState(renderer);
  try {
    setupState(renderer, job);
    return finishPortrait(renderer, job, o);
  } finally {
    restoreState(renderer, prev);
  }
}

const saveState = (renderer) => ({ rt: renderer.getRenderTarget(), auto: renderer.autoClear });
const restoreState = (renderer, s) => { renderer.setRenderTarget(s.rt); renderer.autoClear = s.auto; };
function setupState(renderer, job) {
  renderer.autoClear = false;
  setup(job.ch, job.o);
  applyFrame(job);
}

/** Wait until the GPU has drained the queued work (WebGL2 fence), yielding meanwhile. */
async function gpuIdle(gl) {
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!gl.fenceSync) return tick(0);
  const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  try {
    for (let i = 0; i < 6000; i++) {
      await tick(i ? 8 : 0);
      if (gl.getSyncParameter(f, gl.SYNC_STATUS) === gl.SIGNALED) break;
    }
  } finally {
    gl.deleteSync(f);
  }
  await tick(4);
}

function beginPortrait(renderer, ch, o) {
  const scale = o.scale ?? 1;
  const W = Math.max(24, Math.round(PORTRAIT_W * scale));
  const H = Math.max(30, Math.round(PORTRAIT_H * scale));
  const ss = o.ss ?? (scale >= 0.6 ? 1.2 : scale >= 0.35 ? 1.1 : 1);
  const job = { ch, o, scale, W, H, RW: Math.round(W * ss), RH: Math.round(H * ss), prev: saveState(renderer) };
  renderer.autoClear = false;
  setup(ch, o);
  applyFrame(job);
  job.hdr = rtFor('hdr', job.RW, job.RH, THREE.HalfFloatType, 2);
  return job;
}
function endPortrait(renderer, job) {
  restoreState(renderer, job.prev);
}
/** Per-render uniforms (resolution, mode, light) for a job. */
function applyFrame(job) {
  const u = passes().render.uniforms;
  const o = job.o;
  u.uRes.value.set(job.RW, job.RH);
  u.uMode.value = o.mode ?? 0;
  u.uDbg.value = o.dbg ?? 0;
  u.uKeyDir.value.fromArray(o.key ?? [-0.62, 0.6, 0.5]);
  u.uLightK.value.fromArray(o.lightK ?? [1.75, 0.17, 1.3, 0.36]);
  u.uLite.value = job.scale < 0.35 ? 1 : 0;
  u.uSpot.value.set(0.02, o.crop === 'torso' ? -0.2 : 0, 0, o.crop === 'torso' ? 0.14 : 0.028);
}
/** Ray-march rows [y0, y1) (fractions of the height) of the bust into the HDR G-buffer. */
function drawBand(renderer, job, y0, y1) {
  const p = passes();
  const hdr = job.hdr;
  const a = Math.floor(job.RH * y0), b = Math.floor(job.RH * y1);
  p.quad.material = p.render;
  hdr.scissor.set(0, a, job.RW, b - a);
  hdr.scissorTest = y0 > 0 || y1 < 1;
  renderer.setRenderTarget(hdr);
  renderer.render(p.scene, p.cam);
  hdr.scissorTest = false;
  hdr.scissor.set(0, 0, job.RW, job.RH);
}
/** Resolve, read back and repaint in oil. */
function finishPortrait(renderer, job, o) {
  const p = passes();
  const { W, H, scale } = job;
  const u = p.render.uniforms;
  const t0 = performance.now();
  const out = rtFor('out', W, H, THREE.UnsignedByteType);
  const pu = p.post.uniforms;
  pu.tSrc.value = job.hdr.textures[0];
  pu.uRes.value.set(W, H);
  pu.uSeed.value = u.uSeed.value;
  pu.uScale.value = scale;
  pu.uMode.value = o.raw ? 1 : 0;
  p.quad.material = p.post;
  renderer.setRenderTarget(out);
  renderer.render(p.scene, p.cam);
  const color = readPixels(renderer, out);
  portraitStats.post = Math.round(performance.now() - t0);
  if (o.raw || o.oil === false) return toCanvas(color, W, H);
  const inf = rtFor('info', W, H, THREE.UnsignedByteType, 1, THREE.NearestFilter);
  p.info.uniforms.tSrc.value = job.hdr.textures[1];
  p.quad.material = p.info;
  renderer.setRenderTarget(inf);
  renderer.render(p.scene, p.cam);
  const info = readPixels(renderer, inf);
  const t1 = performance.now();
  portraitStats.gpu = Math.round(t1 - t0);
  const res = oilPaint(color, info, W, H, { seed: Math.round(u.uSeed.value * 1000) + 1, scale });
  portraitStats.oil = Math.round(performance.now() - t1);
  return res;
}

/** Read a render target into top-down RGBA bytes. */
function readPixels(renderer, rt) {
  const w = rt.width;
  const h = rt.height;
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  const out = new Uint8ClampedArray(w * h * 4);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

/** A 2D canvas in the page, or an OffscreenCanvas in a worker. */
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function toCanvas(rgba, w, h) {
  const c = makeCanvas(w, h);
  const img = new ImageData(w, h);
  img.data.set(rgba);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  return c;
}

let precompiled = null;
/**
 * Issue the portrait painter's shader compiles without waiting for them (the driver builds them
 * while the page does other work; the first portrait then starts at once).
 * @param {THREE.WebGLRenderer} renderer
 */
export function precompilePortrait(renderer) {
  if (!renderer || precompiled === renderer) return;
  precompiled = renderer;
  const p = passes();
  const prev = p.quad.material;
  const prevRT = renderer.getRenderTarget();
  try {
    for (const m of [p.render, p.post, p.info]) {
      p.quad.material = m;
      renderer.compile(p.scene, p.cam);
    }
    // A one-pixel draw of each pass, not waited for: a software driver builds its pipelines at the
    // first draw, and this lets it do so while the page carries on with other work.
    p.quad.material = p.render;
    renderer.setRenderTarget(rtFor('warm', 1, 1, THREE.HalfFloatType, 2));
    renderer.render(p.scene, p.cam);
    p.post.uniforms.tSrc.value = rtFor('warm', 1, 1, THREE.HalfFloatType, 2).textures[0];
    p.quad.material = p.post;
    renderer.setRenderTarget(rtFor('warmOut', 1, 1, THREE.UnsignedByteType));
    renderer.render(p.scene, p.cam);
    renderer.getContext().flush();
  } catch { /* compiled on first use instead */ }
  renderer.setRenderTarget(prevRT);
  p.quad.material = prev;
}
