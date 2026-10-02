import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Screen-space crepuscular rays (radial light scattering from the sun's screen position),
 * occluded by the scene's depth buffer: wherever open sky shows through near the sun, its
 * light is smeared toward the viewer in soft, fanning shafts; roofs, gables and broken walls
 * cut dark wedges into them. Runs at quarter resolution:
 *   1. occlusion: sky (far depth) × sky colour × a glow around the sun → mask
 *   2. two radial blur passes (long then short steps → smooth fans, no banding)
 *   3. additive composite onto the HDR scene buffer (before bloom and tone mapping)
 *
 * The explore scene inserts this pass straight after the composer's RenderPass while it is
 * the active scene and enables it only for its own render call (overlays never see it).
 * It needs the scene buffer's depth: attach() gives both composer targets a DepthTexture
 * (restored by detach()).
 */
export class GodRaysPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.camera = null;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color(1, 0.9, 0.75);
    this.strength = 0.0;
    const rtOpt = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    this._sunNdc = new THREE.Vector3();
    this.maskMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1.6 },
        uNear: { value: 0.05 },
        uFar: { value: 900 },
        uSkyDist: { value: 300 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uSun; uniform float uAspect, uNear, uFar, uSkyDist;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          // 3x3 tap: soften the occluder edges at quarter res (no stair-stepped shafts)
          vec2 px = vec2(dFdx(vUv.x), dFdy(vUv.y));
          float sky = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            float d = texture2D(tDepth, vUv + vec2(float(i), float(j)) * px * 0.5).x;
            sky += smoothstep(uSkyDist * 0.6, uSkyDist, lin(d));
          }
          sky /= 9.0;
          vec3 c = texture2D(tColor, vUv).rgb;
          // clouds and haze modulate the shafts; bright sky near the sun dominates
          float lum = dot(c, vec3(0.3, 0.55, 0.15));
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          float r = length(d);
          float glow = exp(-r * 5.5) * 0.7 + exp(-r * 18.0) * 0.8;
          gl_FragColor = vec4(vec3(sky * glow * clamp(lum, 0.15, 2.5)), sky);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMask; uniform vec2 uSun; uniform float uStep;
        varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 dir = (uSun - vUv) * uStep / 28.0;
          vec2 uv = vUv + dir * h(gl_FragCoord.xy); // per-pixel offset (static, deterministic) hides steps
          float decay = 1.0;
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 28; i++) {
            acc += texture2D(tMask, uv).rgb * decay;
            wsum += decay;
            decay *= 0.965;
            uv += dir;
          }
          gl_FragColor = vec4(acc / wsum, texture2D(tMask, vUv).a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tRays: { value: null }, tDepth: { value: null }, uColor: { value: new THREE.Color() }, uStrength: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tRays; uniform sampler2D tDepth; uniform vec3 uColor; uniform float uStrength;
        varying vec2 vUv;
        void main(){
          vec3 r = texture2D(tRays, vUv).rgb;
          // over open sky the sky itself is the light: the shafts show against what stands in front
          float sky = texture2D(tRays, vUv).a;
          // gentle shoulder: never a white-out, the shafts stay a veil
          vec3 l = uColor * r * uStrength * (1.0 - 0.75 * sky);
          gl_FragColor = vec4(l / (1.0 + l * 0.6), 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(null);
  }

  /** Give the composer's scene buffers depth textures (needed for the occlusion mask). */
  attach(composer) {
    this.composer = composer;
    this._added = [];
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.depthTexture) continue;
      rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
      rt.depthTexture.type = THREE.UnsignedIntType;
      rt.dispose(); // re-create the framebuffer with the depth attachment on next use
      this._added.push(rt);
    }
  }

  detach() {
    for (const rt of this._added ?? []) {
      rt.depthTexture?.dispose();
      rt.depthTexture = null;
      rt.dispose();
    }
    this._added = [];
  }

  setSize(w, h) {
    const qw = Math.max(1, Math.round(w / 4));
    const qh = Math.max(1, Math.round(h / 4));
    this.rtA.setSize(qw, qh);
    this.rtB.setSize(qw, qh);
    this.maskMat.uniforms.uAspect.value = w / Math.max(1, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.camera || this.strength <= 0 || !readBuffer.depthTexture) return;
    const cam = this.camera;
    // the sun's position on screen (a point far along the sun direction)
    const p = this._sunNdc.copy(this.sunDir).multiplyScalar(500).add(cam.position);
    p.applyMatrix4(cam.matrixWorldInverse);
    if (p.z > -1) return; // behind the viewer: nothing streams toward us
    const facing = Math.min(1, -p.z / p.length() * 1.6);
    p.applyMatrix4(cam.projectionMatrix);
    const sx = p.x * 0.5 + 0.5;
    const sy = p.y * 0.5 + 0.5;
    // fade as the sun slides off screen (a little beyond the edge still feeds the frame)
    const off = Math.max(Math.max(-sx, sx - 1), Math.max(-sy, sy - 1), 0);
    const vis = facing * (1 - THREE.MathUtils.smoothstep(off, 0.1, 0.9));
    if (vis <= 0.001) return;
    const old = { rt: renderer.getRenderTarget(), auto: renderer.autoClear };
    renderer.autoClear = false;
    const mu = this.maskMat.uniforms;
    mu.tColor.value = readBuffer.texture;
    mu.tDepth.value = readBuffer.depthTexture;
    mu.uSun.value.set(sx, sy);
    mu.uNear.value = cam.near;
    mu.uFar.value = cam.far;
    mu.uSkyDist.value = cam.far * 0.42;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);
    const bu = this.blurMat.uniforms;
    bu.uSun.value.set(sx, sy);
    this.quad.material = this.blurMat;
    bu.tMask.value = this.rtA.texture;
    bu.uStep.value = 1.0;
    renderer.setRenderTarget(this.rtB);
    this.quad.render(renderer);
    bu.tMask.value = this.rtB.texture;
    bu.uStep.value = 0.32;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);
    const cu = this.compMat.uniforms;
    cu.tRays.value = this.rtA.texture;
    cu.uColor.value.copy(this.color);
    cu.uStrength.value = this.strength * vis;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
    renderer.setRenderTarget(old.rt);
    renderer.autoClear = old.auto;
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.maskMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
