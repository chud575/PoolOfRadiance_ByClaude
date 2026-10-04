import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GradeShader } from './post/GradeShader.js';
import { ClassicShader } from './post/ClassicShader.js';
import { LineArtPass } from './post/LineArtPass.js';

/** Default post settings; scenes override a subset via `scene.post = {...}`. */
export const DEFAULT_POST = Object.freeze({
  bloom: true,
  bloomStrength: 0.55,
  bloomRadius: 0.6,
  bloomThreshold: 0.82,
  exposure: 1.0,
  vignette: 0.35,
  saturation: 1.05,
  contrast: 1.04,
  grain: 0.02,
  clearColor: 0x05070f,
  // Classic 1988 mode look for this scene's 3D: 'lines' (edge-detected EGA line
  // art on black, the default) or 'ega' (the whole frame posterised to EGA, for
  // scenes authored in flat EGA fills such as the title card).
  classicStyle: 'lines',
});

/**
 * Shared WebGL renderer + post-processing pipeline:
 *   RenderPass → UnrealBloom → OutputPass (ACES tone map + sRGB) → Grade → AA (SMAA|FXAA) → Classic
 * In classic mode with post.classicStyle 'lines' the composer is bypassed and
 * post/LineArtPass.js draws the scene as EGA line art on black instead.
 * One instance for the whole app (ctx.render). Scenes call ctx.render.render(scene, camera).
 */
export class RenderContext {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/Settings.js').Settings} settings
   * @param {{preserveDrawingBuffer?: boolean, clock?: import('../core/Clock.js').Clock}} [opts]
   */
  constructor(canvas, settings, opts = {}) {
    this.settings = settings;
    this.clock = opts.clock;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings?.get('pixelRatioCap') ?? 2));
    this.renderer.setSize(w, h, false);

    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.passes = {};
    this.passes.render = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.passes.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), DEFAULT_POST.bloomStrength, DEFAULT_POST.bloomRadius, DEFAULT_POST.bloomThreshold);
    this.passes.output = new OutputPass();
    this.passes.grade = new ShaderPass(GradeShader);
    this.passes.smaa = new SMAAPass();
    this.passes.fxaa = new FXAAPass();
    this.passes.classic = new ShaderPass(ClassicShader);
    for (const k of ['render', 'bloom', 'output', 'grade', 'smaa', 'fxaa', 'classic']) this.composer.addPass(this.passes[k]);

    this.post = { ...DEFAULT_POST };
    this.classic = !!settings?.get('classicMode');
    this._applyPassEnables();
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  /** Merge scene overrides into current post settings. */
  applyPost(overrides = {}) {
    Object.assign(this.post, overrides);
    const p = this.post;
    const b = this.passes.bloom;
    b.strength = p.bloomStrength;
    b.radius = p.bloomRadius;
    b.threshold = p.bloomThreshold;
    this.renderer.toneMappingExposure = p.exposure;
    const g = this.passes.grade.uniforms;
    g.uVignette.value = p.vignette;
    g.uSaturation.value = p.saturation;
    g.uContrast.value = p.contrast;
    g.uGrain.value = p.grain;
    this._applyPassEnables();
  }

  resetPost() {
    this.post = { ...DEFAULT_POST };
    this.applyPost();
  }

  setClassic(on) {
    this.classic = !!on;
    this._applyPassEnables();
  }

  _applyPassEnables() {
    const aa = this.settings?.get('antialias') ?? 'smaa';
    this.passes.bloom.enabled = !!this.post.bloom && (this.settings?.get('bloom') ?? true) && !this.classic;
    this.passes.smaa.enabled = aa === 'smaa' && !this.classic;
    this.passes.fxaa.enabled = aa === 'fxaa' && !this.classic;
    this.passes.classic.enabled = this.classic; // 'ega' style only; 'lines' bypasses the composer
    this.passes.grade.enabled = !this.classic;
  }

  /**
   * Render a scene through the full post pipeline.
   * @param {{lines?: {scene: THREE.Scene, camera: THREE.Camera}}} [opts] `lines`: when the
   *   frame is a screen-space composite (e.g. a DOF quad), the 3D scene the classic
   *   line-art pass should draw instead.
   */
  render(scene, camera, opts) {
    if (this.classic && this.post.classicStyle !== 'ega') {
      this.lineArt ??= new LineArtPass();
      const src = opts?.lines ?? { scene, camera };
      this.lineArt.render(this.renderer, src.scene, src.camera);
      return;
    }
    this.passes.render.scene = scene;
    this.passes.render.camera = camera;
    this.passes.grade.uniforms.uTime.value = this.clock?.time ?? 0;
    this.composer.render(this.clock?.dt ?? 0);
  }

  /** Render with no scene (DOM-only screens). */
  clear(color = this.post.clearColor) {
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(color, 1);
    this.renderer.clear();
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  get aspect() {
    return this.width / this.height;
  }

  /** Apply standard texture settings (anisotropy, colour space). */
  prepTexture(tex, { srgb = true } = {}) {
    tex.anisotropy = Math.min(8, this.maxAnisotropy);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return tex;
  }
}
