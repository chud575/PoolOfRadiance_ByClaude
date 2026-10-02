import * as THREE from 'three';
import { renderPortrait3D } from '../../../ui/components/portrait3d.js';
import { createHead } from '../../../ui/components/headShader.js';
import { resolveAppearance } from '../../../ui/components/lookData.js';
import { offscreen } from '../../../ui/components/Miniature.js';
import { renderToCanvas } from '../../../ui/components/paintPass.js';

export async function current(chars, o = {}) {
  window.__NOHEAD = !!o.nohead;
  globalThis.__HEADDBG = o.dbg ?? 0;
  chars ??= [{ name: 'Taran', race: 'human', gender: 'male', classSpec: 'fighter', look: { seed: 11 } }];
  const images = [];
  const t = [];
  for (const ch of chars) {
    const t0 = performance.now();
    images.push(renderPortrait3D({ classSpec: 'fighter', name: 'X', ...ch }, { scale: o.scale ?? 1, crop: o.crop, brush: o.brush }));
    t.push(Math.round(performance.now() - t0));
  }
  if (o.sheet) return { images: [sheet(images, o.cols ?? images.length)], info: t };
  return { images, info: t };
}

function sheet(images, cols) {
  const w = images[0].width, h = images[0].height;
  const c = document.createElement('canvas');
  c.width = w * cols;
  c.height = h * Math.ceil(images.length / cols);
  const g = c.getContext('2d');
  images.forEach((im, i) => g.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h));
  return c;
}

let stage = null;
function headStage() {
  if (stage) return stage;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2420);
  scene.add(new THREE.HemisphereLight(0x6070a0, 0x1a120c, 0.3));
  const key = new THREE.SpotLight(0xfff0e0, 7, 10, 0.55, 0.8, 1.2);
  key.position.set(-1.25, 1.15, 0.95);
  scene.add(key, key.target);
  const fill = new THREE.PointLight(0x8a9ad0, 1.4, 6, 1.5);
  fill.position.set(1.2, -0.1, 0.9);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xa8c4ff, 2.6);
  rim.position.set(1.4, 0.7, -1.3);
  scene.add(rim, rim.target);
  const rimWarm = new THREE.DirectionalLight(0xffb070, 1.2);
  rimWarm.position.set(-1.5, 0.3, -1.2);
  scene.add(rimWarm, rimWarm.target);
  const camera = new THREE.PerspectiveCamera(18, 300 / 375, 0.05, 20);
  stage = { scene, camera };
  return stage;
}

/** chars: array of partial characters; yaw: head yaw */
export async function heads(chars, o = {}) {
  const off = offscreen();
  const st = headStage();
  const images = [];
  const t = [];
  const jobs = [];
  for (const ch of chars) for (const yaw of o.yaws ?? [o.yaw ?? -0.35]) jobs.push([ch, yaw]);
  for (const [ch, yaw] of jobs) {
    const app = resolveAppearance({ classSpec: 'fighter', ...ch }, { gear: false });
    const R = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 1, 0, Math.sin(yaw), 0, Math.cos(yaw)];
    const head = createHead(app, { c: [0, 0, 0], R, hs: 1 }, { detail: o.detail ?? 0.0004, steps: o.steps ?? 96, dbg: o.dbg });
    st.scene.add(head);
    const cam = st.camera;
    const viewH = o.viewH ?? 0.36;
    const dist = viewH / (2 * Math.tan((18 * Math.PI) / 360));
    cam.position.set(-dist * 0.08, -0.02, dist);
    cam.lookAt(0, -0.03, 0);
    cam.updateProjectionMatrix();
    const t0 = performance.now();
    const W = o.w ?? 300, H = o.h ?? 375;
    images.push(renderToCanvas(off.renderer, st.scene, cam, { w: W, h: H, ss: o.ss ?? 1, paint: !!o.paint, key: 'lab' }));
    t.push(Math.round(performance.now() - t0));
    if (o.twice) { const t1 = performance.now(); renderToCanvas(off.renderer, st.scene, cam, { w: W, h: H, ss: o.ss ?? 1, paint: !!o.paint, key: 'lab' }); t.push('again ' + Math.round(performance.now() - t1)); }
    st.scene.remove(head);
    head.userData.dispose();
  }
  if (o.sheet) return { images: [sheet(images, o.cols ?? images.length)], info: t };
  return { images, info: t };
}

export async function warmtest(chars, o = {}) {
  const { warmPortraits } = await import('../../../ui/components/portrait3d.js');
  const off = offscreen();
  const gl = off.renderer.getContext();
  const info = { ext: !!gl.getExtension('KHR_parallel_shader_compile') };
  let t0 = performance.now();
  await warmPortraits();
  info.warm = Math.round(performance.now() - t0);
  info.programsAfterWarm = off.renderer.info.programs.length;
  t0 = performance.now();
  const img = renderPortrait3D({ race: 'dwarf', gender: 'female', classSpec: 'fighter', name: 'X', look: { seed: 5 } }, { scale: 0.3 });
  info.first = Math.round(performance.now() - t0);
  info.programsAfterFirst = off.renderer.info.programs.length;
  info.keys = off.renderer.info.programs.map((p) => p.name + ':' + (p.cacheKey ?? '').length);
  t0 = performance.now();
  renderPortrait3D({ race: 'elf', gender: 'female', classSpec: 'fighter', name: 'X', look: { seed: 6 } }, { scale: 1 });
  info.second = Math.round(performance.now() - t0);
  return { images: [img], info };
}
