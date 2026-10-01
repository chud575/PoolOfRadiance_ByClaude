import * as THREE from 'three';
import { buildMiniature, offscreen } from './Miniature.js';
import { defaultLook, resolveAppearance, rngFrom, hashNum } from './lookData.js';
import { paintBackground, PORTRAIT_W, PORTRAIT_H } from './portraitPainter.js';
import { renderToCanvas } from './paintPass.js';
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

let stage = null;
function portraitStage() {
  if (stage) return stage;
  const o = offscreen();
  if (!o) return null;
  const scene = new THREE.Scene();
  scene.environment = o.env;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0x6070a0, 0x1a120c, 0.3));
  const key = new THREE.SpotLight(0xfff0e0, 7, 10, 0.55, 0.8, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.PointLight(0x8a9ad0, 1.4, 6, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xa8c4ff, 2.6);
  scene.add(rim, rim.target);
  const rimWarm = new THREE.DirectionalLight(0xffb070, 1.2);
  scene.add(rimWarm, rimWarm.target);
  const camera = new THREE.PerspectiveCamera(18, PORTRAIT_W / PORTRAIT_H, 0.05, 20);
  stage = { scene, key, fill, rim, rimWarm, camera, env: o.env };
  return stage;
}

/**
 * Render a portrait canvas, or null when WebGL is unavailable.
 * @param {object} ch
 * @param {{scale?: number, crop?: 'head'|'torso'}} [o]
 * @returns {HTMLCanvasElement|null}
 */
export function renderPortrait3D(ch, o = {}) {
  const st = portraitStage();
  if (!st) return null;
  const off = offscreen();
  if (st.env !== off.env) { stage = null; return renderPortrait3D(ch, o); }
  const scale = o.scale ?? 1;
  const crop = o.crop ?? 'head';
  const W = Math.max(32, Math.round(PORTRAIT_W * scale));
  const H = Math.max(40, Math.round(PORTRAIT_H * scale));
  const look = defaultLook(ch);
  const app = resolveAppearance(ch);
  const R = rngFrom(hashNum(look.seed, look.head, look.body, ch.race, ch.gender ?? 'male', 'p3'));
  let fig = null;
  let bgTex = null;
  try {
    // Painted backdrop (the same warm studio wall as the 2D painter).
    const bg = document.createElement('canvas');
    bg.width = PORTRAIT_W;
    bg.height = PORTRAIT_H;
    paintBackground(bg.getContext('2d', { willReadFrequently: true }), R, look, app.clothHex);
    bgTex = new THREE.CanvasTexture(bg);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    st.scene.background = bgTex;
    st.scene.backgroundIntensity = 0.55;

    const torso = crop === 'torso';
    const quality = scale <= 0.3 ? 0.0088 : scale <= 0.5 ? 'thumb' : 'portrait';
    fig = buildMiniature(ch, {
      pose: 'portrait', base: false, quality, noWeapon: true, noShield: true, rayHead: true, headAmbient: [0.035, 0.035, 0.045], headGain: 0.6, headLite: scale < 0.5, boundsKey: crop, faceSize: scale <= 0.5 ? 256 : 512,
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
    // Lights relative to the head.
    st.key.position.copy(hc).add(new THREE.Vector3(-1.25, 1.15, 0.95));
    st.key.target.position.copy(hc);
    st.key.target.updateMatrixWorld();
    st.key.castShadow = scale >= 0.5;
    st.fill.position.copy(hc).add(new THREE.Vector3(1.2, -0.1, 0.9));
    st.rim.position.copy(hc).add(new THREE.Vector3(1.4, 0.7, -1.3));
    st.rim.target.position.copy(hc);
    st.rim.target.updateMatrixWorld();
    st.rimWarm.position.copy(hc).add(new THREE.Vector3(-1.5, 0.3, -1.2));
    st.rimWarm.target.position.copy(hc);
    st.rimWarm.target.updateMatrixWorld();
    const out = renderToCanvas(off.renderer, st.scene, cam, { w: W, h: H, ss: scale < 0.5 ? 1 : 1.25, paint: o.paint === false ? false : 'light', seed: (look.seed % 997) / 997, key: 'portrait' });
    if (o.overpaint === false || torso && scale < 0.4 || fig.userData.head) return out;
    // The illustrator's finishing layer (needs a material-ID pass of the same view).
    finishFace(off.renderer, st.scene, cam, fig, out, app, { key: 'portraitMask' });
    return out;
  } catch (err) {
    console.warn('portrait3d', err);
    return null;
  } finally {
    if (fig) {
      st.scene.remove(fig);
      fig.userData.dispose();
    }
    if (bgTex) bgTex.dispose();
    st.scene.background = null;
  }
}
