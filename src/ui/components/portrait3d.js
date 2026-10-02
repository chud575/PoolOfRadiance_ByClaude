import * as THREE from 'three';
import { buildMiniature, offscreen, keepAlive } from './Miniature.js';
import { defaultLook, resolveAppearance, rngFrom, hashNum } from './lookData.js';
import { paintBackground, PORTRAIT_W, PORTRAIT_H } from './portraitPainter.js';
import { renderToCanvas, renderToCanvasBanded, warmCompile } from './paintPass.js';
import { paintStrokes } from './portraitBrush.js';
import { finishFace } from './portraitOverpaint.js';

/**
 * Painted portraits from the miniature's own sculpt: the same head (skull,
 * jaw, nose, brows, expression), hair, beard, helm or hood and armour as the
 * 3D figure, rendered as a head-and-shoulders bust under a warm key light
 * with a cool moonlit rim, then repainted (paintPass.js) — a Kuwahara oil
 * filter flattens the render into brush-like patches, strokes are smeared
 * along the forms, and a glaze, canvas weave and vignette finish it. One
 * source of truth: portrait and miniature always show the same person in the
 * same kit.
 *
 * crop 'head' (portrait) or 'torso' (the body picker's thumbnails).
 */

const stages = {};
/** 'sync' serves portraitURL; 'async' serves the banded background painter (never shares a scene mid-render). */
function portraitStage(which = 'sync') {
  if (stages[which]) return stages[which];
  const o = offscreen();
  if (!o) return null;
  const scene = new THREE.Scene();
  scene.environment = o.env;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0x6a7cae, 0x2a1a10, 0.5));
  const key = new THREE.SpotLight(0xfff0e0, 7, 10, 0.55, 0.8, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.PointLight(0x8ea4dc, 4.6, 6, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xa8c4ff, 2.6);
  scene.add(rim, rim.target);
  const rimWarm = new THREE.DirectionalLight(0xffb070, 0.8);
  scene.add(rimWarm, rimWarm.target);
  const camera = new THREE.PerspectiveCamera(18, PORTRAIT_W / PORTRAIT_H, 0.05, 20);
  stages[which] = { scene, key, fill, rim, rimWarm, camera, env: o.env };
  return stages[which];
}

/** Build the bust on a stage, frame the camera and set the lights. */
function setupPortrait(st, ch, o) {
  const scale = o.scale ?? 1;
  const crop = o.crop ?? 'head';
  const W = Math.max(32, Math.round(PORTRAIT_W * scale));
  const H = Math.max(40, Math.round(PORTRAIT_H * scale));
  const look = defaultLook(ch);
  const app = resolveAppearance(ch);
  const R = rngFrom(hashNum(look.seed, look.head, look.body, ch.race, ch.gender ?? 'male', 'p3'));
  // Painted backdrop (the same warm studio wall as the 2D painter).
  const bg = document.createElement('canvas');
  bg.width = PORTRAIT_W;
  bg.height = PORTRAIT_H;
  paintBackground(bg.getContext('2d', { willReadFrequently: true }), R, look, app.clothHex);
  const bgTex = new THREE.CanvasTexture(bg);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  st.scene.background = bgTex;
  st.scene.backgroundIntensity = 0.55;
  const torso = crop === 'torso';
  const quality = scale <= 0.3 ? 0.0088 : scale <= 0.5 ? 'thumb' : 'portrait';
  const fig = buildMiniature(ch, {
    pose: 'portrait', base: false, quality, noWeapon: true, noShield: true, rayHead: true, headAmbient: [0.035, 0.035, 0.045], headGain: 0.6, headLite: scale < 0.5, headVariant: 'portrait', boundsKey: crop, faceSize: scale <= 0.5 ? 256 : 512,
    boundsFn: (fr) => {
      const c = fr.face.c;
      const hs = fr.face.hs;
      const down = torso ? 0.78 : 0.44;
      return [c[0] - 0.4 * hs - 0.1, c[1] - down * Math.max(0.8, hs), c[2] - 0.085 * hs, c[0] + 0.4 * hs + 0.1, c[1] + 0.2 * hs, c[2] + 0.3];
    },
  });
  st.scene.add(fig);
  const fr = fig.userData.frames;
  const hc = new THREE.Vector3(...fr.face.c);
  const hs = fr.face.hs;
  const cam = st.camera;
  cam.aspect = W / H;
  cam.fov = 18;
  const viewH = torso ? 0.92 * Math.max(0.85, hs) : 0.43 * hs;
  const target = hc.clone().add(new THREE.Vector3(0, torso ? -0.3 * Math.max(0.85, hs) : -0.04 * hs, 0));
  const dist = viewH / (2 * Math.tan((cam.fov * Math.PI) / 360));
  cam.position.set(target.x - dist * 0.08, target.y + (torso ? dist * 0.03 : 0.04 * hs), target.z + dist);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  // Lights relative to the head: a high three-quarter key (loop lighting, not a split), a cool fill, two rims.
  st.key.position.copy(hc).add(new THREE.Vector3(-1.15, 1.1, 1.1));
  st.key.target.position.copy(hc);
  st.key.target.updateMatrixWorld();
  // Always the same light set (castShadow is part of the program key): one compiled variant for every size.
  st.key.castShadow = true;
  st.fill.position.copy(hc).add(new THREE.Vector3(1.3, -0.05, 1.1));
  st.rim.position.copy(hc).add(new THREE.Vector3(1.4, 0.7, -1.3));
  st.rim.target.position.copy(hc);
  st.rim.target.updateMatrixWorld();
  st.rimWarm.position.copy(hc).add(new THREE.Vector3(-1.5, 0.3, -1.2));
  st.rimWarm.target.position.copy(hc);
  st.rimWarm.target.updateMatrixWorld();
  // The head's ellipse on screen (for the brush pass: keep the features crisp).
  cam.updateMatrixWorld();
  const pr = (v) => { const q = v.clone().project(cam); return [(q.x * 0.5 + 0.5) * W, (0.5 - q.y * 0.5) * H]; };
  const fc = hc.clone().add(new THREE.Vector3(0, -0.02 * hs, 0.05 * hs));
  const [fx, fy] = pr(fc);
  const [ex] = pr(fc.clone().add(new THREE.Vector3(0.075 * hs, 0, 0)));
  const [, ey] = pr(fc.clone().add(new THREE.Vector3(0, 0.1 * hs, 0)));
  const face = { x: fx, y: fy, rx: Math.abs(ex - fx), ry: Math.abs(fy - ey) };
  return { fig, cam, W, H, bgTex, app, look, scale, torso, face };
}

function teardown(st, job) {
  if (job?.fig) {
    st.scene.remove(job.fig);
    keepAlive(job.fig);
  }
  job?.bgTex?.dispose();
  st.scene.background = null;
}

function finish(off, st, job, out, o) {
  if (o.overpaint === false || (job.torso && job.scale < 0.4) || job.fig.userData.head) return brushOver(out, job, o);
  finishFace(off.renderer, st.scene, job.cam, job.fig, out, job.app, { key: 'portraitMask' });
  return out;
}

/** The illustrator's last pass: directional brush strokes over the render (2D, cheap). */
function brushOver(out, job, o) {
  if (o.brush === false || job.scale < 0.25) return out;
  try { paintStrokes(out, { seed: job.look.seed, fine: job.scale >= 0.6, face: job.torso ? null : job.face }); } catch { /* keep the render */ }
  return out;
}

/**
 * Render a portrait canvas, or null when WebGL is unavailable.
 * @param {object} ch
 * @param {{scale?: number, crop?: 'head'|'torso'}} [o]
 * @returns {HTMLCanvasElement|null}
 */
export function renderPortrait3D(ch, o = {}) {
  const st = portraitStage('sync');
  if (!st) return null;
  const off = offscreen();
  if (st.env !== off.env) { delete stages.sync; return renderPortrait3D(ch, o); }
  let job = null;
  try {
    job = setupPortrait(st, ch, o);
    const out = renderToCanvas(off.renderer, st.scene, job.cam, { w: job.W, h: job.H, ss: job.scale < 0.5 ? 1 : 1.25, paint: o.paint === false ? false : 'light', seed: (job.look.seed % 997) / 997, key: 'portrait' });
    return finish(off, st, job, out, o);
  } catch (err) {
    console.warn('portrait3d', err);
    return null;
  } finally {
    teardown(st, job);
  }
}

/**
 * The same portrait painted in horizontal bands across several ticks, so no single task blocks
 * the page for long on a slow (software) GPU. Resolves to a canvas, or null without WebGL.
 * @param {object} ch
 * @param {{scale?: number, crop?: 'head'|'torso'}} [o]
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export async function renderPortrait3DAsync(ch, o = {}) {
  const st = portraitStage('async');
  if (!st) return null;
  const off = offscreen();
  if (st.env !== off.env) { delete stages.async; return renderPortrait3DAsync(ch, o); }
  let job = null;
  try {
    job = setupPortrait(st, ch, o);
    const out = await renderToCanvasBanded(off.renderer, st.scene, job.cam, { w: job.W, h: job.H, ss: job.scale < 0.5 ? 1 : 1.25, paint: o.paint === false ? false : 'light', seed: (job.look.seed % 997) / 997, key: 'portraitAsync', bands: job.scale >= 0.6 ? 6 : job.scale >= 0.35 ? 2 : 1 });
    return finish(off, st, job, out, o);
  } catch (err) {
    console.warn('portrait3d async', err);
    return null;
  } finally {
    teardown(st, job);
  }
}

let warmed = null;
/**
 * Compile and link every portrait program up front (call while a scene loads), so the first
 * click never stalls on the ray-marched head shader. With KHR_parallel_shader_compile the link
 * runs off the main thread; without it (software GL) one tiny portrait is painted instead.
 * @returns {Promise<void>}
 */
export function warmPortraits() {
  if (warmed) return warmed;
  const st = portraitStage('sync');
  const off = offscreen();
  if (!st || !off) return (warmed = Promise.resolve());
  const ch = { race: 'human', gender: 'male', classSpec: 'fighter', name: 'warm', look: { seed: 1 } };
  const gl = off.renderer.getContext();
  if (!gl.getExtension('KHR_parallel_shader_compile')) {
    try { renderPortrait3D(ch, { scale: 0.12 }); } catch { /* fall back to compiling on first use */ }
    return (warmed = Promise.resolve());
  }
  let fig = null;
  try {
    fig = buildMiniature(ch, { pose: 'portrait', base: false, quality: 'thumb', noWeapon: true, noShield: true, rayHead: true, headAmbient: [0.035, 0.035, 0.045], headGain: 0.6, headLite: true, headVariant: 'portrait', boundsKey: 'head', faceSize: 256 });
    st.scene.add(fig);
    st.key.castShadow = true;
    warmed = warmCompile(off.renderer, st.scene, st.camera, 'portrait-warm');
  } catch {
    warmed = Promise.resolve();
  } finally {
    if (fig) {
      st.scene.remove(fig);
      fig.userData.dispose();
    }
  }
  return warmed;
}
