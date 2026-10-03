import * as THREE from 'three';
import { SURFACE_UNIFORMS, getFxBlackTexture } from '../../render/materials.js';

/**
 * Planar mirror of the scene about the street plane, for standing water. One extra
 * half-resolution render per frame (only while the ground is wet); every SurfaceFX floor and
 * the puddle decals sample it through SURFACE_UNIFORMS.uFxReflTex with uFxReflMat, so pools
 * reflect the actual house fronts, lamps and sky instead of a flat sky tint.
 * (Same mirrored-camera + oblique near-plane construction as three's Reflector.)
 */
export class PuddleMirror {
  /** @param {number} [scale] render-target size relative to the drawing buffer */
  constructor(scale = 0.5) {
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    this.cam = new THREE.PerspectiveCamera();
    this.planeY = 0.02;
    this.hidden = [];
    this._v = {
      n: new THREE.Vector3(0, 1, 0),
      p: new THREE.Vector3(),
      c: new THREE.Vector3(),
      view: new THREE.Vector3(),
      look: new THREE.Vector3(),
      tgt: new THREE.Vector3(),
      rot: new THREE.Matrix4(),
      plane: new THREE.Plane(),
      clip: new THREE.Vector4(),
      q: new THREE.Vector4(),
      size: new THREE.Vector2(),
    };
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  render(renderer, scene, camera) {
    const v = this._v;
    renderer.getDrawingBufferSize(v.size);
    const w = Math.max(16, Math.round(v.size.x * this.scale));
    const h = Math.max(16, Math.round(v.size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    camera.updateMatrixWorld();
    v.p.set(0, this.planeY, 0);
    v.c.setFromMatrixPosition(camera.matrixWorld);
    if (v.c.y <= this.planeY) return false;
    v.view.subVectors(v.p, v.c);
    // mirror the eye about the plane (x/z kept)
    const cam = this.cam;
    cam.position.set(v.c.x, 2 * this.planeY - v.c.y, v.c.z);
    v.rot.extractRotation(camera.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.c);
    v.tgt.copy(v.look);
    v.tgt.y = 2 * this.planeY - v.tgt.y;
    cam.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.n);
    cam.lookAt(v.tgt);
    cam.far = Math.min(camera.far, 90); // (the far skyline barely shows in a puddle: skip it)
    cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    const U = SURFACE_UNIFORMS;
    U.uFxReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    U.uFxReflMat.value.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // oblique near plane = the water surface (nothing below the street leaks into the mirror)
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.p).applyMatrix4(cam.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const e = cam.projectionMatrix.elements;
    v.q.set((Math.sign(v.clip.x) + e[8]) / e[0], (Math.sign(v.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    e[2] = v.clip.x;
    e[6] = v.clip.y;
    e[10] = v.clip.z + 1 - 0.003;
    e[14] = v.clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    // draw (the floors must not sample the target they are drawn into)
    U.uFxReflTex.value = getFxBlackTexture();
    U.uFxReflOn.value = 0;
    const vis = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    const prevRT = renderer.getRenderTarget();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = shadowAuto;
    this.hidden.forEach((o, i) => (o.visible = vis[i]));
    U.uFxReflTex.value = this.rt.texture;
    U.uFxReflOn.value = 1;
    return true;
  }

  dispose() {
    const U = SURFACE_UNIFORMS;
    if (U.uFxReflTex.value === this.rt.texture) U.uFxReflTex.value = getFxBlackTexture();
    U.uFxReflOn.value = 0;
    this.rt.dispose();
  }
}
