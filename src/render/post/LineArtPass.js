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
    float lsum = 0.0, ln = 0.0, sn = 0.0, msum = 0.0;
    vec3 sky = vec3(0.0), mean = vec3(0.0);
    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / 8.0;
      vec3 c = texture2D(tColor, uv).rgb;
      float d = texture2D(tDepth, uv).r;
      if (d >= 0.99999) { sky += c; sn += 1.0; }
      else {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        lsum += log(max(l, 1e-4)); ln += 1.0;
        mean += c; msum += l; // luminance-weighted: the lit surfaces define the illuminant
      }
    }
    if (gl_FragCoord.x > 1.0) {
      mean = msum > 1e-4 ? mean / msum : vec3(1.0);
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
  uniform sampler2D tFx;
  uniform float uFx, uFxAbs;
  uniform float uBalance, uSat, uGlow, uGlowAbs;
  uniform ivec2 uHi;
  uniform int uSS;
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

  // Normalised crease measure along one axis, from five depth taps. e(k) is
  // the second difference at p+k. A crease concentrates its whole slope change
  // in one or two adjacent e's; a smooth curve spreads it evenly, so the
  // spill into the 5-px window beyond the peak pair is subtracted (rounded
  // limbs, domes, barrels and rolling cobbles don't fill in). Only the local
  // maximum is kept, so every crease is exactly one pixel wide.
  float crease(ivec2 p, ivec2 a, float w0, float scale) {
    float wm1 = W(p - a), wp1 = W(p + a);
    float e0 = (wm1 + wp1 - 2.0 * w0) * scale;
    // jump: silhouettes; ink only the nearer (convex) side
    if (e0 < -uJump) return 9.0;
    if (e0 > uJump) return 0.0;
    float em = (W(p - 2 * a) + w0 - 2.0 * wm1) * scale;
    float ep = (w0 + W(p + 2 * a) - 2.0 * wp1) * scale;
    float sg = sign(e0);
    float a0 = e0 * sg, am = max(em * sg, 0.0), ap = max(ep * sg, 0.0);
    if (am > a0 || ap >= a0) return 0.0;
    float pk = a0 + max(am, ap);
    float tot = a0 + am + ap;
    return pk - uCurve * (tot - pk);
  }

  float L2(ivec2 p) { return log2(dot(C(p), vec3(0.2126, 0.7152, 0.0722)) + 0.004); }
  // A bold albedo line: a clean luminance STEP (flat on the bright side,
  // still dark two pixels on), inked on the bright side. Speckle, glints and
  // ramps all fail one of the three tests.
  float lumEdge(ivec2 p) {
    float l0 = L2(p);
    float best = 0.0;
    for (int i = 0; i < 4; i++) {
      ivec2 a = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
      float fl = abs(L2(p - a) - l0);
      float s1 = l0 - L2(p + a), s2 = l0 - L2(p + 2 * a);
      if (fl < 0.6) best = max(best, min(s1, s2) - fl);
    }
    return best;
  }

  // Ink by hue ANGLE in wide bins (not nearest-colour), so mixed fire/moon
  // light on one material can't flip a line between neighbouring EGA hues:
  // reds, one warm bin (yellow lit / brown in shade), greens, cyans, blues,
  // magentas; low chroma = white / light grey / dark grey by light level.
  vec3 ink(vec3 c, float lit) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float sat = mx > 1e-5 ? (mx - mn) / mx : 0.0;
    if (sat < uSat) return PAL[lit > 1.6 ? 15 : (lit > 0.4 ? 7 : 8)];
    float d = mx - mn;
    float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
    h *= 60.0; // degrees
    bool dark = lit < 0.4;
    if (h < 14.0 || h >= 335.0) return PAL[dark ? 4 : 12];   // red
    if (h < 72.0) return PAL[dark ? 6 : 14];                  // warm: yellow / brown
    if (h < 160.0) return PAL[dark ? 2 : 10];                 // green
    if (h < 200.0) return PAL[dark ? 3 : 11];                 // cyan
    if (h < 265.0) return PAL[dark ? 1 : 9];                  // blue
    return PAL[dark ? 5 : 13];                                // magenta
  }

  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    vec4 key = texelFetch(tKey, ivec2(0), 0);
    float best = 0.0; ivec2 bp = lp * uSS; float bw = 0.0;
    bool allSky = true;
    for (int j = 0; j < 4; j++) {
      if (j >= uSS * uSS) break;
      ivec2 p = lp * uSS + ivec2(j & 1, j >> 1);
      float w0 = W(p);
      float d0 = texelFetch(tDepth, clamp(p, ivec2(0), uHi - 1), 0).r;
      if (d0 < 0.99999) allSky = false;
      float z = viewZ(w0);
      // perspective: divide by w0 * pixel angle; ortho: by pixel world size
      float scale = uOrtho > 0.5 ? 1.0 / uPix : 1.0 / (w0 * uPix);
      float m = max(crease(p, ivec2(1, 0), w0, scale), crease(p, ivec2(0, 1), w0, scale));
      float s = m > uCrease ? m : 0.0;
      if (s == 0.0 && d0 < 0.99999 && z < uLumDist) {
        float le = lumEdge(p);
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
      // ink from the surface around the edge pixel (same depth layer only), so
      // one line doesn't flicker between hues pixel by pixel
      float w0 = W(bp);
      vec3 c = vec3(0.0); float cn = 0.0;
      for (int k = 0; k < 9; k++) {
        ivec2 q = bp + 2 * ivec2(k % 3 - 1, k / 3 - 1);
        float wq = W(q);
        float tol = uOrtho > 0.5 ? 0.02 * max(abs(w0), 1.0) : 0.04 * w0;
        if (abs(wq - w0) < tol) { c += C(q); cn += 1.0; }
      }
      c /= max(cn, 1.0);
      vec3 wb = texelFetch(tKey, ivec2(1, 0), 0).rgb;
      c /= mix(vec3(1.0), max(wb, vec3(0.05)), uBalance);
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float lit = lum / max(key.r, 1e-4) * uDim;
      outc = ink(c, lit);
    } else if (!allSky && uGlow > 0.0) {
      // light sources: every sample of the cell far above the exposure key
      float gmin = 1e9; vec3 gc = vec3(0.0);
      for (int j = 0; j < 4; j++) {
        if (j >= uSS * uSS) break;
        vec3 c = C(lp * uSS + ivec2(j & 1, j >> 1));
        gmin = min(gmin, dot(c, vec3(0.2126, 0.7152, 0.0722)));
        gc += c;
      }
      if (gmin > max(key.r * uGlow, uGlowAbs)) outc = ink(gc, 9.0);
    }
    // effects: solid EGA shapes wherever they're bright (rings, grid, fire)
    {
      // needs half the cell covered, so lone sparks/embers don't speckle
      vec3 fc = vec3(0.0); float fn = 0.0;
      float ft = max(key.r * uFx, uFxAbs);
      for (int j = 0; j < 4; j++) {
        if (j >= uSS * uSS) break;
        vec3 c = texelFetch(tFx, clamp(lp * uSS + ivec2(j & 1, j >> 1), ivec2(0), uHi - 1), 0).rgb;
        if (dot(c, vec3(0.2126, 0.7152, 0.0722)) > ft) { fc += c; fn += 1.0; }
      }
      if (uFx > 0.0 && fn >= float(uSS * uSS) * 0.5) { outc = ink(fc, 9.0); best = 1.0; }
    }
    if (best == 0.0 && allSky) {
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
      ss: 2, // high-res samples per logical pixel axis (1 or 2)
      rows: 216, // target logical rows (integer upscale picks the nearest)
      crease: 0.55,
      curve: 2.0, // how strongly smooth curvature is rejected
      balance: 0.85,
      sat: 0.32, // below this (after balance) a surface inks in white/greys // grey-world white balance before the hue match // min change of surface slope (tan units) for a crease line
      jump: 15.0, // second difference above this = silhouette
      lum: 3.0, // log2 luminance step for an albedo line (~3.7x)
      lumDist: 7.0, // albedo lines only nearer than this (m)
      sky: 0.06, // linear sky luminance above which open sky is EGA blue
      dim: 1.0,
      glow: 8.0, // light sources (flames, lit windows) brighter than this x key...
      fx: 3.0, // effects brighter than this x key (and fxAbs) are drawn solid; 0 = off
      fxAbs: 0.2,
      glowAbs: 1.5, // ...and than this linear HDR luminance fill solid
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
    // transparent, non-depth-writing effects (move grid, selection rings, spell
    // VFX, flames) rendered alone over black, depth-tested against the scene
    // (shares the depth texture), so they can be drawn as solid EGA shapes and
    // never perturb the line inks or the exposure key
    this.fx = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: this.depth,
      samples: 0,
    });
    this._fx = [];
    this._solid = [];
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
      tFx: { value: this.fx.texture },
      uFx: { value: 3 },
      uFxAbs: { value: 0.2 },
      uHi: { value: new THREE.Vector2(4, 4) },
      uSS: { value: 2 },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uOrtho: { value: 0 },
      uPix: { value: 0.001 },
      uCrease: { value: 0 },
      uCurve: { value: 1 },
      uBalance: { value: 0.85 },
      uSat: { value: 0.4 },
      uGlow: { value: 8 },
      uGlowAbs: { value: 1.5 },
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
    const scale = Math.max(1, Math.round(h / this.params.rows));
    const lw = Math.ceil(w / scale);
    const lh = Math.ceil(h / scale);
    const ss = this.params.ss >= 2 ? 2 : 1;
    if (lw !== this._lw || lh !== this._lh || ss !== this._ss) {
      this._lw = lw;
      this._lh = lh;
      this._ss = ss;
      this.hi.setSize(lw * ss, lh * ss);
      this.fx.setSize(lw * ss, lh * ss);
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

    // 1. the solid scene, small, with depth (effects hidden)
    this._split(scene);
    for (const o of this._fx) o.visible = false;
    renderer.setRenderTarget(this.hi);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    for (const o of this._fx) o.visible = true;

    // 1b. effects only, over black, depth-tested against the solid scene
    const bg = scene.background;
    scene.background = null;
    for (const o of this._solid) o.visible = false;
    renderer.setRenderTarget(this.fx);
    const cc = renderer.getClearColor(this._cc ??= new THREE.Color());
    const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    const sm = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // the solid pass already drew them
    if (this._fx.length) renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = sm;
    renderer.autoClear = true;
    renderer.setClearColor(cc, ca);
    for (const o of this._solid) o.visible = true;
    scene.background = bg;

    // 2. exposure key + sky
    renderer.setRenderTarget(this.key);
    renderer.render(this.keyQ.s, this.cam);

    // 3. edges at the logical grid
    const u = this.edgeQ.m.uniforms;
    const p = this.params;
    const hiH = this._lh * this._ss;
    u.uHi.value.set(this._lw * this._ss, hiH);
    u.uSS.value = this._ss;
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
    u.uSat.value = p.sat;
    u.uGlow.value = p.glow;
    u.uFx.value = p.fx;
    u.uFxAbs.value = p.fxAbs;
    u.uGlowAbs.value = p.glowAbs;
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

  /** Sort the visible renderables into solid (writes depth) and effects (transparent, no depth write). */
  _split(scene) {
    const fx = (this._fx.length = 0, this._fx);
    const solid = (this._solid.length = 0, this._solid);
    const isFx = (m) => m && m.transparent && m.depthWrite === false && m.colorWrite !== false;
    scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const m = o.material;
      if (Array.isArray(m) ? m.every(isFx) : isFx(m)) fx.push(o);
      else solid.push(o);
    });
  }

  dispose() {
    this.fx.dispose();
    this.hi.dispose();
    this.depth.dispose();
    this.key.dispose();
    this.lines.dispose();
    for (const q of [this.keyQ, this.edgeQ, this.blitQ]) q.m.dispose();
  }
}
