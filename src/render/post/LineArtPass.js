import * as THREE from 'three';
import { EGA16, hexToRgb } from '../palette.js';

/**
 * Classic 1988 mode, 3D views: LINE ART.
 *
 * The scene is rendered once into a small HDR target (2x the logical 1988
 * grid) with a float depth texture. An edge pass then runs at the logical
 * grid (~216 rows, integer-scaled to the canvas) and, for each logical pixel,
 * looks at its 2x2 high-res pixels:
 *
 *  - geometry edges from DEPTH: on a planar surface the depth buffer (affine
 *    in 1/z for perspective, in z for ortho) is linear in screen space, so its
 *    second difference is zero on every plane, whatever its slope. It is
 *    non-zero exactly at creases (wall corners, door frames, stair nosings,
 *    beams) and huge at silhouettes. It is measured at two strides (1 and 2
 *    px) and the weaker one is kept, so sub-pixel relief (cobble bumps,
 *    rubble) can't sparkle; for silhouettes only the NEARER side is inked,
 *    so every outline is one logical pixel thick and belongs to its object.
 *  - bold albedo/luminance boundaries (timber framing, mortar, banners) with
 *    a deliberately high threshold, only on surfaces near enough to be read.
 *
 * Edge pixels take the nearest bright EGA ink of the surface under them (hue
 * matched on the chroma-normalised colour, so night/shadow doesn't decide the
 * hue); lines in shadow or distance drop to the dark half of the palette.
 * Everything else is pure black, except open sky, which takes the period's
 * flat EGA blue when the live sky is bright (day) and stays black at night.
 * A tiny 8x8 reduction pass provides the exposure key (no CPU readback), so
 * the result is identical frame to frame for a still camera.
 *
 * WebGL2 core only: RGBA16F colour (already required by the composer),
 * DEPTH_COMPONENT32F depth texture, texelFetch, no extensions or readbacks.
 */

const pal = EGA16.map((h) => hexToRgb(h).map((v) => (v / 255).toFixed(4)).join(', '));
const PAL_GLSL = `const vec3 PAL[16] = vec3[16](${pal.map((p) => `vec3(${p})`).join(', ')});`;

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * 8x8 grid of scene samples. Texel 0: exposure key (log-average luminance),
 * mean sky luminance, sky blueness, sky coverage. Texel 1: mean surface colour
 * (grey-world white balance, so a warm sun or blue moonlight doesn't tint
 * every ink the same hue).
 */
const KEY_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  varying vec2 vUv;
  void main() {
    float lsum = 0.0, ln = 0.0, sn = 0.0;
    vec3 sky = vec3(0.0), mean = vec3(0.0);
    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / 8.0;
      vec3 c = texture2D(tColor, uv).rgb;
      float d = texture2D(tDepth, uv).r;
      if (d >= 0.99999) { sky += c; sn += 1.0; }
      else {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        lsum += log(max(l, 1e-4)); ln += 1.0;
        mean += c / max(l, 1e-3) * min(l * 50.0, 1.0); // chromaticity, ignoring near-black
      }
    }
    if (gl_FragCoord.x > 1.0) {
      mean = ln > 0.0 ? mean / ln : vec3(1.0);
      float ml = dot(mean, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(ml > 1e-3 ? mean / ml : vec3(1.0), 1.0);
      return;
    }
    float key = ln > 0.0 ? exp(lsum / ln) : 0.05;
    sky /= max(sn, 1.0);
    float sl = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(key, sl, sky.b - max(sky.r, sky.g) * 0.6, sn / 64.0);
  }
`;

const EDGE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tKey;
  uniform float uBalance;
  uniform ivec2 uHi;
  uniform float uNear, uFar, uOrtho, uPix;
  uniform float uCurve, uCrease, uJump, uLum, uLumDist, uSky, uDim;
  varying vec2 vUv;
  ${PAL_GLSL}

  float W(ivec2 p) {
    p = clamp(p, ivec2(0), uHi - 1);
    float d = texelFetch(tDepth, p, 0).r;
    // perspective: 1/z_view (affine in screen space on a plane); ortho: z_view
    return uOrtho > 0.5 ? uNear + d * (uFar - uNear) : (1.0 / uNear) - d * (1.0 / uNear - 1.0 / uFar);
  }
  vec3 C(ivec2 p) { return texelFetch(tColor, clamp(p, ivec2(0), uHi - 1), 0).rgb; }
  float viewZ(float w) { return uOrtho > 0.5 ? w : 1.0 / w; }

  // normalised crease measure along one axis. A crease (slope change packed
  // into one pixel) gives e2/2 == e1; a smooth curve gives e2/2 == 2 e1, so the
  // difference is subtracted: rounded limbs, domes and barrels don't fill in.
  float crease(ivec2 p, ivec2 a, float w0, float scale) {
    float e1 = (W(p - a) + W(p + a) - 2.0 * w0) * scale;
    // jump: silhouettes; ink only the nearer (convex) side
    if (e1 < -uJump) return 9.0;
    if (e1 > uJump) return 0.0;
    float e2 = (W(p - 2 * a) + W(p + 2 * a) - 2.0 * w0) * scale * 0.5;
    if (sign(e1) != sign(e2)) return 0.0;
    float a1 = abs(e1), a2 = abs(e2);
    return min(a1, a2) - uCurve * max(0.0, a2 - a1);
  }

  float lumEdge(ivec2 p, vec3 c0) {
    float l0 = log2(dot(c0, vec3(0.2126, 0.7152, 0.0722)) + 0.004);
    float best = 0.0;
    for (int i = 0; i < 2; i++) {
      ivec2 a = i == 0 ? ivec2(1, 0) : ivec2(0, 1);
      float l1 = log2(dot(C(p + a), vec3(0.2126, 0.7152, 0.0722)) + 0.004);
      float lm = log2(dot(C(p - a), vec3(0.2126, 0.7152, 0.0722)) + 0.004);
      // ink the brighter side of a strong step, and only a step (not a ramp)
      float s = max(l0 - l1, l0 - lm);
      float r = max(abs(l1 - l0), abs(lm - l0));
      best = max(best, min(s, r));
    }
    return best;
  }

  vec3 ink(vec3 c, float lit) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float sat = mx > 1e-5 ? (mx - mn) / mx : 0.0;
    int idx;
    if (sat < 0.28) {
      idx = lit > 1.5 ? 15 : (lit > 0.45 ? 7 : 8);
    } else {
      vec3 n = c / mx;
      // candidates: bright hues + brown; matched on normalised chroma
      int cand[7] = int[7](12, 14, 10, 11, 9, 13, 6);
      float best = 1e9; idx = 7;
      for (int i = 0; i < 7; i++) {
        vec3 p = PAL[cand[i]]; p /= max(max(p.r, p.g), p.b);
        vec3 d = n - p;
        float e = dot(d * d, vec3(1.0, 1.25, 0.9));
        if (e < best) { best = e; idx = cand[i]; }
      }
      // in shadow / distance: the dark half of the palette
      if (lit < 0.45) {
        idx = idx == 12 ? 4 : idx == 14 ? 6 : idx == 10 ? 2 : idx == 11 ? 3 : idx == 9 ? 1 : idx == 13 ? 5 : idx == 6 ? 4 : 8;
      }
    }
    return PAL[idx];
  }

  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    vec4 key = texelFetch(tKey, ivec2(0), 0);
    float best = 0.0; ivec2 bp = lp * 2; float bw = 0.0;
    bool allSky = true;
    for (int j = 0; j < 4; j++) {
      ivec2 p = lp * 2 + ivec2(j & 1, j >> 1);
      float w0 = W(p);
      float d0 = texelFetch(tDepth, clamp(p, ivec2(0), uHi - 1), 0).r;
      if (d0 < 0.99999) allSky = false;
      float z = viewZ(w0);
      // perspective: divide by w0 * pixel angle; ortho: by pixel world size
      float scale = uOrtho > 0.5 ? 1.0 / uPix : 1.0 / (w0 * uPix);
      float m = max(crease(p, ivec2(1, 0), w0, scale), crease(p, ivec2(0, 1), w0, scale));
      float s = m > uCrease ? m : 0.0;
      if (s == 0.0 && d0 < 0.99999 && z < uLumDist) {
        float le = lumEdge(p, C(p));
        if (le > uLum) s = 0.5 + le * 0.01;
      }
      // prefer the nearest of competing edge pixels
      float nearness = uOrtho > 0.5 ? -w0 : w0;
      if (s > 0.0 && (best == 0.0 || nearness > bw)) {
        best = s; bp = p; bw = nearness;
      }
    }
    vec3 outc = vec3(0.0);
    if (best > 0.0) {
      vec3 c = C(bp);
      vec3 wb = texelFetch(tKey, ivec2(1, 0), 0).rgb;
      c /= mix(vec3(1.0), max(wb, vec3(0.05)), uBalance);
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float lit = lum / max(key.r, 1e-4) * uDim;
      outc = ink(c, lit);
    } else if (allSky) {
      // open sky: flat EGA blue by day, black by night
      outc = (key.g > uSky && key.b > -0.05) ? PAL[1] : PAL[0];
    }
    gl_FragColor = vec4(outc, 1.0);
  }
`;

const BLIT_FRAG = /* glsl */ `
  uniform sampler2D tLines;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(tLines, vUv).rgb, 1.0); }
`;

export class LineArtPass {
  constructor() {
    this.params = {
      crease: 0.55,
      curve: 1.0, // how strongly smooth curvature is rejected
      balance: 0.85, // grey-world white balance before the hue match // min change of surface slope (tan units) for a crease line
      jump: 6.0, // second difference above this = silhouette
      lum: 1.9, // log2 luminance step for an albedo line (~3.7x)
      lumDist: 9.0, // albedo lines only nearer than this (m)
      sky: 0.06, // linear sky luminance above which open sky is EGA blue
      dim: 1.0,
    };
    this.depth = new THREE.DepthTexture(4, 4, THREE.FloatType);
    this.depth.minFilter = this.depth.magFilter = THREE.NearestFilter;
    this.hi = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: this.depth,
      samples: 0,
    });
    this.key = new THREE.WebGLRenderTarget(2, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.lines = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.lines.texture.colorSpace = THREE.NoColorSpace;

    const quad = (frag, uniforms) => {
      const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false });
      const s = new THREE.Scene();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
      mesh.frustumCulled = false;
      s.add(mesh);
      return { m, s };
    };
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.keyQ = quad(KEY_FRAG, { tColor: { value: this.hi.texture }, tDepth: { value: this.depth } });
    this.edgeQ = quad(EDGE_FRAG, {
      tColor: { value: this.hi.texture },
      tDepth: { value: this.depth },
      tKey: { value: this.key.texture },
      uHi: { value: new THREE.Vector2(4, 4) },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uOrtho: { value: 0 },
      uPix: { value: 0.001 },
      uCrease: { value: 0 },
      uCurve: { value: 1 },
      uBalance: { value: 0.85 },
      uJump: { value: 0 },
      uLum: { value: 0 },
      uLumDist: { value: 0 },
      uSky: { value: 0 },
      uDim: { value: 1 },
    });
    this.blitQ = quad(BLIT_FRAG, { tLines: { value: this.lines.texture } });
    this._size = new THREE.Vector2();
    this._lw = 0;
    this._lh = 0;
  }

  /** Logical 1988 grid for a drawing buffer of w x h px: integer scale, ~216 rows. */
  _layout(w, h) {
    const scale = Math.max(1, Math.round(h / 216));
    const lw = Math.ceil(w / scale);
    const lh = Math.ceil(h / scale);
    if (lw !== this._lw || lh !== this._lh) {
      this._lw = lw;
      this._lh = lh;
      this.hi.setSize(lw * 2, lh * 2);
      this.lines.setSize(lw, lh);
    }
    this.scale = scale;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  render(renderer, scene, camera) {
    const buf = renderer.getDrawingBufferSize(this._size);
    this._layout(buf.x, buf.y);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    // 1. the scene, small, with depth
    renderer.setRenderTarget(this.hi);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    // 2. exposure key + sky
    renderer.setRenderTarget(this.key);
    renderer.render(this.keyQ.s, this.cam);

    // 3. edges at the logical grid
    const u = this.edgeQ.m.uniforms;
    const p = this.params;
    const hiH = this.lh2 = this._lh * 2;
    u.uHi.value.set(this._lw * 2, hiH);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const ortho = !!camera.isOrthographicCamera;
    u.uOrtho.value = ortho ? 1 : 0;
    u.uPix.value = ortho
      ? Math.max(1e-6, (camera.top - camera.bottom) / (camera.zoom || 1) / hiH)
      : (2 * Math.tan(THREE.MathUtils.degToRad((camera.fov ?? 60) / 2))) / (camera.zoom || 1) / hiH;
    u.uCrease.value = p.crease;
    u.uCurve.value = p.curve;
    u.uBalance.value = p.balance;
    u.uJump.value = p.jump;
    u.uLum.value = p.lum;
    u.uLumDist.value = p.lumDist;
    u.uSky.value = p.sky;
    u.uDim.value = p.dim;
    renderer.setRenderTarget(this.lines);
    renderer.render(this.edgeQ.s, this.cam);

    // 4. nearest-neighbour upscale to the canvas
    renderer.setRenderTarget(null);
    renderer.render(this.blitQ.s, this.cam);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.hi.dispose();
    this.depth.dispose();
    this.key.dispose();
    this.lines.dispose();
    for (const q of [this.keyQ, this.edgeQ, this.blitQ]) q.m.dispose();
  }
}
