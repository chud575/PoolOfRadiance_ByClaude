import * as THREE from 'three';
import { EGA16, hexToRgb } from '../palette.js';

/**
 * Classic 1988 mode, 3D views: LINE ART on black.
 *
 * 1. INK PASS. The scene's solid geometry is drawn once, unlit, into a small
 *    RGBA8 target (2x the logical 1988 grid) with a depth texture. Every
 *    surface writes
 *      R  its unlit albedo luminance (texture detail, for bold albedo lines),
 *      GB an object id (16 bit) for small objects (figures, props, blocks),
 *      A  its EGA ink (4 bits) + detail level (2 bits) + glow flag.
 *    The ink is the nearest EGA hue of the surface's MEAN albedo (material
 *    colour x vertex colour x the map's last mip), so a wall keeps one ink
 *    from end to end whatever the lighting does; a small object takes ONE ink
 *    for the whole object (an area-weighted vote over its parts, done once on
 *    the CPU), so a kobold is red and a skeleton is white at a glance.
 *    Foliage cut-outs and tiny instanced scatter (weeds, rubble) are left out.
 * 2. FX PASS. Transparent, non-depth-writing effects (flames, rings, move
 *    grid, spell VFX) alone over black, depth-tested against the ink pass. A
 *    closing filter turns them into clean flat EGA shapes: flames get a yellow
 *    core and a red rim.
 * 3. EDGE PASS at the logical grid (~216 rows, integer-scaled to the canvas):
 *    - object outlines where the id changes (inked inside the nearer object),
 *    - depth silhouettes and creases from the depth buffer's second difference
 *      (zero on every plane, so only real geometry draws), only on objects
 *      big enough on screen to carry interior lines,
 *    - bold albedo lines (mortar, timber, flagstone joints) on large surfaces,
 *      drawn in the dark half of the palette so they stay subordinate.
 *    Lines fade to the dark ink and then out through the scene's fog.
 * 4. CLEAN PASS: isolated specks (a component of up to 4 px with nothing else
 *    within 3 px) are removed, then a nearest-neighbour blit to the canvas.
 *
 * Open sky is EGA blue by day (when the scene has a daylight sky dome), black
 * otherwise. Effects and the ink pass never depend on lighting, and a still
 * camera adds temporal hysteresis, so lines don't shimmer.
 *
 * WebGL2 core only: RGBA8 colour targets, DEPTH_COMPONENT32F depth texture,
 * texelFetch/textureLod; no float colour buffers, extensions or readbacks.
 */

const PAL_RGB = EGA16.map((h) => hexToRgb(h).map((v) => v / 255));
const PAL_GLSL = `const vec3 PAL[16] = vec3[16](${PAL_RGB.map((p) => `vec3(${p.map((v) => v.toFixed(4)).join(', ')})`).join(', ')});`;
/** bright ink -> its dark half (fog / albedo-line cue); 0 = drop */
const DARK = [0, 1, 2, 3, 4, 5, 6, 8, 8, 1, 2, 3, 4, 5, 6, 7];
const DARK_GLSL = `const int DARK[16] = int[16](${DARK.join(', ')});`;

// Ink thresholds, shared by the GLSL and the CPU vote (sRGB-ish chroma).
// Warm low-chroma albedos (stone, plaster, sand, bone) read as greys/white, as
// in the 1988 screens; only clearly coloured surfaces take a hue, so a scene
// spreads over grey/white stone, brown timber, red tile, yellow trim, cyan
// glass and water, green leaf and blue cloth instead of collapsing to ochre.
const INK = { sat: 0.3, warmSat: 0.46, coolSat: 0.14, woodSat: 0.24, white: 0.3, grey: 0.035, dark: 0.02, wood: 0.14, red: 22 };

/** GLSL: EGA ink index for a linear mean albedo. */
const INK_GLSL = /* glsl */ `
  int egaInk(vec3 lin) {
    float l = dot(lin, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2));
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
    float d = max(mx - mn, 1e-5);
    float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
    h *= 60.0;
    bool warm = h >= ${INK.red.toFixed(1)} && h < 70.0;
    bool cool = h >= 170.0 && h < 262.0;
    // dark timber and wood stay brown even when only faintly coloured
    if (warm && h < 46.0 && l < ${INK.grey.toFixed(3)} && sat > ${INK.woodSat.toFixed(3)}) return 6;
    if (cool ? sat < ${INK.coolSat.toFixed(3)} : (sat < ${INK.sat.toFixed(3)} || (warm && sat < ${INK.warmSat.toFixed(3)}))) return l > ${INK.white.toFixed(3)} ? 15 : (l > ${INK.grey.toFixed(3)} ? 7 : 8);
    bool dk = l < ${INK.dark.toFixed(3)};
    if (h < ${INK.red.toFixed(1)} || h >= 330.0) return dk ? 4 : 12;
    if (h < 46.0) return l < ${INK.wood.toFixed(3)} ? 6 : 14;
    if (h < 70.0) return dk ? 6 : 14;
    if (h < 160.0) return dk ? 2 : 10;
    if (h < 200.0) return dk ? 3 : 11;
    if (h < 262.0) return dk ? 1 : 9;
    return dk ? 5 : 13;
  }
`;

/** CPU twin of egaInk(); returns [ink, saturated?]. */
function egaInkJS(r, g, b) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c = [r, g, b].map((v) => Math.pow(Math.max(v, 0), 1 / 2.2));
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
  const d = Math.max(mx - mn, 1e-5);
  let h = mx === c[0] ? (((c[1] - c[2]) / d) % 6 + 6) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  h *= 60;
  const warm = h >= INK.red && h < 70;
  const cool = h >= 170 && h < 262;
  if (warm && h < 46 && l < INK.grey && sat > INK.woodSat) return [6, true];
  if (cool ? sat < INK.coolSat : sat < INK.sat || (warm && sat < INK.warmSat)) return [l > INK.white ? 15 : l > INK.grey ? 7 : 8, false];
  const dk = l < INK.dark;
  if (h < INK.red || h >= 330) return [dk ? 4 : 12, true];
  if (h < 46) return [l < INK.wood ? 6 : 14, true];
  if (h < 70) return [dk ? 6 : 14, true];
  if (h < 160) return [dk ? 2 : 10, true];
  if (h < 200) return [dk ? 3 : 11, true];
  if (h < 262) return [dk ? 1 : 9, true];
  return [dk ? 5 : 13, true];
}

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const INK_VERT = /* glsl */ `
  #include <common>
  #include <batching_pars_vertex>
  #include <color_pars_vertex>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  #include <clipping_planes_pars_vertex>
  uniform mat3 uUvT;
  varying vec2 vMapUv;
  void main() {
    vMapUv = (uUvT * vec3(uv, 1.0)).xy;
    #include <batching_vertex>
    #include <color_vertex>
    #include <morphinstance_vertex>
    #include <morphcolor_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinbase_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>
  }
`;

const INK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform sampler2D uMap;
  uniform float uAlphaTest;
  uniform vec3 uOut; // id lo, id hi, ink (-1 = from albedo)
  uniform float uFlags; // (detail << 4 | glow << 6), already shifted
  varying vec2 vMapUv;
  #include <color_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  ${INK_GLSL}
  void main() {
    #include <clipping_planes_fragment>
    vec4 base = vec4(uColor, 1.0);
    vec3 mean = uColor;
    #ifdef HAS_MAP
      vec4 t = texture2D(uMap, vMapUv);
      base *= t;
      mean *= textureLod(uMap, vMapUv, 12.0).rgb;
    #endif
    #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA) || defined(USE_INSTANCING_COLOR) || defined(USE_BATCHING_COLOR)
      base *= vColor;
      mean *= vColor.rgb;
    #endif
    if (base.a < uAlphaTest) discard;
    #include <logdepthbuf_fragment>
    int ink = uOut.z >= 0.0 ? int(uOut.z + 0.5) : egaInk(mean);
    float lum = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(sqrt(clamp(lum, 0.0, 1.0)), uOut.x, uOut.y, (float(ink) + uFlags) / 255.0);
  }
`;

/** Effects mask at the logical grid: closed coverage (holes in flames filled, lone sparks dropped later) + ink. */
const MASK_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tFx;
  uniform ivec2 uHi;
  uniform int uSS;
  uniform float uT;
  ${INK_GLSL}
  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    float own = 0.0, cov = 0.0, n = 0.0;
    vec3 col = vec3(0.0);
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      for (int j = 0; j < 4; j++) {
        if (j >= uSS * uSS) break;
        ivec2 p = clamp((lp + ivec2(dx, dy)) * uSS + ivec2(j & 1, j >> 1), ivec2(0), uHi - 1);
        vec3 c = texelFetch(tFx, p, 0).rgb;
        float b = dot(c, vec3(0.2126, 0.7152, 0.0722)) > uT ? 1.0 : 0.0;
        cov += b; n += 1.0;
        if (dx == 0 && dy == 0) own += b;
        col += c * b;
      }
    }
    float m = (own >= 1.0 || cov / n > 0.42) ? 1.0 : 0.0;
    vec3 mc = col / max(cov, 1.0);
    int ink = egaInk(mc / max(max(mc.r, max(mc.g, mc.b)), 1e-3) * 0.8);
    gl_FragColor = vec4(m, cov / n, float(ink) / 255.0, 1.0);
  }
`;

const EDGE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tId;
  uniform sampler2D tDepth;
  uniform sampler2D tMask;
  uniform sampler2D tPrev;
  uniform float uStill;
  uniform ivec2 uHi, uLo;
  uniform int uSS;
  uniform float uNear, uFar, uOrtho, uPix;
  uniform float uCurve, uCrease, uIdCrease, uJump, uLum, uLumDist;
  uniform int uSkyInk, uFlank, uHalo;
  uniform float uFlameFill, uBold;
  uniform vec3 uFog; // x: exp2 density, y: linear near, z: linear far (0 = none)
  uniform float uFogDark, uFogDrop, uDebug;
  uniform mat4 uInvProj, uCamWorld;
  uniform vec2 uGrid; // square size (m), on
  uniform float uAngle;
  varying vec2 vUv;
  ${PAL_GLSL}
  ${DARK_GLSL}

  float W(ivec2 p) {
    p = clamp(p, ivec2(0), uHi - 1);
    float d = texelFetch(tDepth, p, 0).r;
    // perspective: 1/z_view (affine in screen space on a plane); ortho: z_view
    return uOrtho > 0.5 ? uNear + d * (uFar - uNear) : (1.0 / uNear) - d * (1.0 / uNear - 1.0 / uFar);
  }
  float D(ivec2 p) { return texelFetch(tDepth, clamp(p, ivec2(0), uHi - 1), 0).r; }
  vec4 G(ivec2 p) { return texelFetch(tId, clamp(p, ivec2(0), uHi - 1), 0); }
  int idOf(vec4 g) { return int(g.g * 255.0 + 0.5) + 256 * int(g.b * 255.0 + 0.5); }
  int flOf(vec4 g) { return int(g.a * 255.0 + 0.5); }
  float viewZ(float w) { return uOrtho > 0.5 ? w : 1.0 / w; }
  bool nearer(float a, float b) { return uOrtho > 0.5 ? a < b : a > b; }

  // Normalised crease measure along one axis, from five depth taps. e(k) is
  // the second difference at p+k. A crease concentrates its whole slope change
  // in one or two adjacent e's; a smooth curve spreads it evenly, so the
  // spill beyond the peak pair is subtracted (rounded limbs, domes, barrels
  // don't fill in). Only the local maximum is kept: every crease is 1 px.
  float crease(ivec2 p, ivec2 a, float w0, float scale, int flank) {
    float wm1 = W(p - a), wp1 = W(p + a);
    float e0 = (wm1 + wp1 - 2.0 * w0) * scale;
    if (uOrtho > 0.5) e0 = -e0;
    // jump: silhouettes; ink only the nearer (convex) side
    if (e0 < -uJump) return 9.0;
    if (e0 > uJump) return 0.0;
    float wm2 = W(p - 2 * a), wp2 = W(p + 2 * a);
    float em = (wm2 + w0 - 2.0 * wm1) * scale;
    float ep = (w0 + wp2 - 2.0 * wp1) * scale;
    if (uOrtho > 0.5) { em = -em; ep = -ep; }
    float sg = sign(e0);
    float a0 = e0 * sg, am = max(em * sg, 0.0), ap = max(ep * sg, 0.0);
    if (am > a0 || ap >= a0) return 0.0;
    float pk = a0 + max(am, ap);
    float tot = a0 + am + ap;
    float r = pk - uCurve * (tot - pk);
    if (r <= uCrease * 0.7 || r > uCrease * uBold) return r;
    // planar support: a bold crease has FLAT surface on both sides for
    // 'flank' px. Faceted rubble, chipped capstones and sculpt folds turn
    // every few px and fail; wall corners, jambs, beams and steps pass.
    float lim = 0.34 * a0;
    float qa = wp1, qb = wp2, na = wm1, nb = wm2;
    for (int k = 2; k < 8; k++) {
      if (k > flank) break;
      float qc = W(p + (k + 1) * a), nc = W(p - (k + 1) * a);
      if (abs((qa + qc - 2.0 * qb) * scale) > lim || abs((na + nc - 2.0 * nb) * scale) > lim) return 0.0;
      qa = qb; qb = qc; na = nb; nb = nc;
    }
    return r;
  }

  // On the FAR side of a silhouette (within uHalo px): another surface juts
  // out in front of this one. Lines here are suppressed, which leaves a
  // one-pixel black gap round every nearer outline: overlapping figures
  // separate, and the nearer one hides the lines of what is behind it.
  bool behindEdge(ivec2 p, float w0, float scale) {
    for (int i = 0; i < 4; i++) {
      ivec2 a = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
      float g = w0 - W(p - a);
      for (int k = 1; k < 4; k++) {
        if (k > uHalo) break;
        ivec2 q = p + k * a;
        if (D(q) >= 0.99999) break;
        float d = (W(q) - (w0 + float(k) * g)) * scale;
        if (uOrtho > 0.5) d = -d;
        if (d > uJump) return true;
      }
    }
    return false;
  }

  float L2(ivec2 p) { float r = G(p).r; return log2(r * r + 0.01); }
  // A bold albedo line: a clean luminance STEP on one surface (flat on the
  // bright side, still dark two pixels on), inked on the DARK side, i.e. on
  // the joint itself. Speckle and ramps fail one of the tests.
  float lumEdge(ivec2 p, float w0) {
    float l0 = L2(p);
    float best = 0.0;
    float tol = 0.03 * abs(w0);
    for (int i = 0; i < 4; i++) {
      ivec2 a = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
      if (abs(W(p + a) - w0) > tol || abs(W(p + 2 * a) - w0) > tol || abs(W(p - a) - w0) > tol) continue;
      float s1 = L2(p + a) - l0, s2 = L2(p + 2 * a) - l0;
      float fl = abs(L2(p + 3 * a) - L2(p + 2 * a));
      if (fl < 0.5) best = max(best, min(s1, s2) - fl);
    }
    return best;
  }

  vec3 wpos(ivec2 p) {
    vec2 ndc = (vec2(p) + 0.5) / vec2(uHi) * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, D(p) * 2.0 - 1.0, 1.0);
    return (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
  }
  // the battle squares on level ground (tactical views only): a 1 px line
  // wherever a neighbour lies in another square
  bool gridLine(ivec2 p, float w0) {
    float tol = 0.02 * abs(w0);
    if (abs(W(p + ivec2(1, 0)) - w0) > tol || abs(W(p + ivec2(0, 1)) - w0) > tol) return false;
    vec3 a = wpos(p), b = wpos(p + ivec2(1, 0)), c = wpos(p + ivec2(0, 1));
    vec3 n = normalize(cross(b - a, c - a));
    if (abs(n.y) < 0.9) return false;
    vec2 ca = floor(a.xz / uGrid.x);
    return any(notEqual(floor(b.xz / uGrid.x), ca)) || any(notEqual(floor(c.xz / uGrid.x), ca));
  }

  vec3 nrm(ivec2 q) {
    vec3 a = wpos(q);
    return normalize(cross(wpos(q + ivec2(1, 0)) - a, wpos(q + ivec2(0, 1)) - a));
  }
  // a crease must also turn the surface by a real angle in WORLD space, so
  // grazing views of gently bumpy ground (cobbles, flags, rubble beds) stay clean
  bool realCrease(ivec2 p) {
    float c = cos(uAngle);
    return dot(nrm(p - ivec2(2, 0)), nrm(p + ivec2(2, 0))) < c || dot(nrm(p - ivec2(0, 2)), nrm(p + ivec2(0, 2))) < c;
  }

  // the ink a line takes is the majority over its surface neighbourhood (same
  // depth layer), coloured inks winning ties, so tint noise in the albedo can't
  // dash a line between two inks
  const ivec2 OFS[13] = ivec2[13](ivec2(0), ivec2(3, 0), ivec2(-3, 0), ivec2(0, 3), ivec2(0, -3), ivec2(3, 3), ivec2(-3, 3), ivec2(3, -3), ivec2(-3, -3), ivec2(6, 0), ivec2(-6, 0), ivec2(0, 6), ivec2(0, -6));
  int inkMode(ivec2 p, float w0) {
    float tol = uOrtho > 0.5 ? 0.02 * max(abs(w0), 1.0) : 0.04 * w0;
    int k[13];
    for (int i = 0; i < 13; i++) {
      ivec2 q = p + OFS[i];
      vec4 g = G(q);
      k[i] = (D(q) < 0.99999 && idOf(g) == 0 && abs(W(q) - w0) < tol) ? (flOf(g) & 15) : -1;
    }
    int best = k[0]; float bs = -1.0;
    for (int i = 0; i < 13; i++) {
      if (k[i] < 0) continue;
      float c = 0.0;
      for (int j = 0; j < 13; j++) c += k[j] == k[i] ? 1.0 : 0.0;
      if (k[i] != 7 && k[i] != 8 && k[i] != 15) c *= 1.3;
      if (c > bs) { bs = c; best = k[i]; }
    }
    return best;
  }

  float fogF(float z) {
    if (uFog.x > 0.0) { float k = uFog.x * z; return 1.0 - exp(-k * k); }
    if (uFog.z > 0.0) return clamp((z - uFog.y) / (uFog.z - uFog.y), 0.0, 1.0);
    return 0.0;
  }

  // Output (RGBA8, logical grid): R = EGA ink index, G = line class:
  //   0 none, 1 weak (floors, tiny objects), 2 dark (albedo joints, grid),
  //   3 crease, 4 outline/silhouette, 5 flat fill (effects, glows).
  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    vec4 prev = texelFetch(tPrev, lp, 0);
    int pc = int(prev.g * 255.0 + 0.5);
    bool wasLine = uStill > 0.5 && pc >= 1 && pc <= 4;
    float creaseT = uCrease * (wasLine ? 0.8 : 1.0);
    bool bfix = false; float best = 0.0; float bw = 0.0; int bink = 0; int bcls = 0; float bz = 0.0; ivec2 bp = ivec2(0); int bid = 0; float bw0 = 1.0;
    bool allSky = true;
    int glowN = 0, glowInk = 0, nS = 0;
    for (int j = 0; j < 4; j++) {
      if (j >= uSS * uSS) break;
      nS++;
      ivec2 p = lp * uSS + ivec2(j & 1, j >> 1);
      float d0 = D(p);
      if (d0 >= 0.99999) continue;
      allSky = false;
      vec4 g0 = G(p);
      int id0 = idOf(g0);
      int fl = flOf(g0);
      int ink = fl & 15;
      int det = id0 == 0 ? 3 : (fl >> 4) & 3;
      bool tiny = id0 != 0 && ((fl >> 7) & 1) == 1;
      if (((fl >> 6) & 1) == 1) { glowN++; glowInk = ink; }
      float w0 = W(p);
      float z = viewZ(w0);
      float scale = uOrtho > 0.5 ? 1.0 / uPix : 1.0 / (w0 * uPix);
      if (behindEdge(p, w0, scale)) continue;
      float s = 0.0; int cls = 0;
      // 1. object outlines: the id changes and the surface really breaks
      //    (coplanar neighbours with different ids don't line)
      if (id0 != 0) {
        for (int i = 0; i < 4; i++) {
          ivec2 a = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
          ivec2 q = p + a;
          vec4 gq = G(q);
          int iq = idOf(gq);
          if (iq == id0) continue;
          if (D(q) >= 0.99999) { s = 3.0; break; }
          float wq = W(q);
          if (!nearer(w0, wq)) continue;
          // touching pieces of one ink (a rubble heap, a stack of blocks)
          // read as one mass: no outline between them
          if (iq != 0 && (flOf(gq) & 15) == ink && abs(wq - w0) < 0.025 * abs(w0)) continue;
          float e = abs(W(p - a) + wq - 2.0 * w0) * scale;
          if (e > uIdCrease) { s = 3.0; break; }
        }
        if (s > 0.0) cls = tiny ? 1 : 4;
      }
      // 2. depth silhouettes and creases, by detail level
      if (s == 0.0 && det >= 1) {
        int fk = id0 == 0 ? uFlank : max(uFlank - 1, 1);
        float m = max(crease(p, ivec2(1, 0), w0, scale, fk), crease(p, ivec2(0, 1), w0, scale, fk));
        if (m >= 9.0) { s = 2.0; cls = tiny ? 1 : 4; }
        else if (det >= 2 && m > creaseT && realCrease(p)) { s = m; cls = 3; }
      }
      // floors (level ground seen from above): only silhouettes are strong;
      // their creases are weak, and they carry no albedo joints at all
      bool floorS = false;
      if (id0 == 0 && (cls == 3 || (s == 0.0 && det >= 3 && z < uLumDist))) floorS = nrm(p).y > 0.72;
      // a crease where a floor meets a wall/step/plinth takes the ink of the
      // upright face (one line, one ink), else it is a weak floor line
      bool fixInk = false;
      if (cls == 3 && floorS) {
        cls = 1;
        for (int i = 0; i < 8; i++) {
          ivec2 a = (i & 3) == 0 ? ivec2(1, 0) : (i & 3) == 1 ? ivec2(-1, 0) : (i & 3) == 2 ? ivec2(0, 1) : ivec2(0, -1);
          ivec2 q = p + a * (1 + (i >> 2));
          if (D(q) >= 0.99999 || nrm(q).y > 0.6) continue;
          ink = flOf(G(q)) & 15; cls = 3; fixInk = true; break;
        }
      }
      // 3. bold albedo lines on large near surfaces, in the dark ink
      if (s == 0.0 && det >= 3 && z < uLumDist && !floorS) {
        if (lumEdge(p, w0) > uLum) { s = 0.5; cls = 2; }
      }
      if (s == 0.0 && uGrid.y > 0.5 && id0 == 0 && gridLine(p, w0)) { s = 0.25; cls = 2; ink = 8; }
      float nearness = uOrtho > 0.5 ? -w0 : w0;
      if (s > 0.0 && (best == 0.0 || cls > bcls || (cls == bcls && nearness > bw))) {
        best = s; bw = nearness; bink = ink; bcls = cls; bfix = fixInk; bz = z; bp = p; bid = id0; bw0 = w0;
      }
    }
    int outInk = 0; int outCls = 0;
    if (best > 0.0) {
      float f = fogF(bz);
      int k = bid == 0 && bink != 8 && bcls != 4 && !bfix ? inkMode(bp, bw0) : bink;
      if (bcls == 2 || f > uFogDark) k = DARK[k];
      if (f < uFogDrop && k != 0) { outInk = k; outCls = bcls; }
    }
    if (outCls == 0 && glowN * 2 >= nS && glowN > 0) { outInk = glowInk; outCls = 5; }
    // effects: flames are flat EGA shapes (yellow core, red rim); everything
    // else (move paths, rings, spell marks) is drawn as a 1 px EGA outline
    vec4 mk = texelFetch(tMask, lp, 0);
    if (mk.r > 0.5) {
      int k = int(mk.b * 255.0 + 0.5);
      bool warm = k == 12 || k == 14 || k == 4 || k == 6;
      float area = 0.0; bool rim = false;
      for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
        float m = texelFetch(tMask, clamp(lp + ivec2(x, y), ivec2(0), uLo - 1), 0).r;
        area += m;
        if (abs(x) + abs(y) == 1 && m < 0.5) rim = true;
      }
      if (warm && uFlameFill > 0.5) {
        outInk = area > 11.0 ? (rim ? 12 : 14) : 14; outCls = 5;
      } else if (rim || area < 12.0) {
        outInk = k; outCls = 5;
      }
    }
    if (outCls == 0 && allSky) outInk = uSkyInk;
    if (uDebug > 0.5 && !allSky) {
      vec4 g = G(lp * uSS);
      int f = flOf(g);
      outInk = uDebug < 1.5 ? (f & 15) : uDebug < 2.5 ? 1 + (idOf(g) % 15) : ((f >> 4) & 3) * 4 + 3;
      outCls = 5;
    }
    gl_FragColor = vec4(float(outInk) / 255.0, float(outCls) / 255.0, 0.0, 1.0);
  }
`;

// ---- logical-grid clean-up passes. Texel: R = ink index, G = line class.
const CLS_GLSL = /* glsl */ `
  uniform sampler2D tIn;
  uniform ivec2 uLo;
  ivec2 T(ivec2 p) {
    vec4 c = texelFetch(tIn, clamp(p, ivec2(0), uLo - 1), 0);
    return ivec2(int(c.r * 255.0 + 0.5), int(c.g * 255.0 + 0.5));
  }
  // a thinnable line pixel (fills are left alone)
  bool L(ivec2 p) { int c = T(p).y; return c >= 1 && c <= 4; }
  vec4 enc(int ink, int cls) { return vec4(float(ink) / 255.0, float(cls) / 255.0, 0.0, 1.0); }
`;

/**
 * 1. Specks and doubled lines.
 *  - a line pixel with fewer than uMin others within 3 px goes (uMinWeak for
 *    weak floor / tiny-object lines, so the open ground stays black);
 *  - solid masses of line (all 8 neighbours set) keep only their outline;
 *  - a lesser line running ALONGSIDE a greater one (a crease or albedo joint
 *    one pixel inside an outline) goes, so outlines stay one pixel wide and
 *    joints never cut into them; a lesser line meeting a greater one end-on
 *    (a T junction) stays.
 */
const CLEAN_FRAG = /* glsl */ `
  precision highp float;
  ${CLS_GLSL}
  uniform int uMin, uMinWeak;
  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    ivec2 c = T(lp);
    if (c.y >= 1 && c.y <= 4) {
      int n = 0, n8 = 0, strong = 0;
      for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
        if (x == 0 && y == 0) continue;
        int k = T(lp + ivec2(x, y)).y;
        if (k >= 1 && k <= 4) {
          n++;
          if (k >= 3) strong++;
          if (abs(x) <= 1 && abs(y) <= 1) n8++;
        }
      }
      bool drop = n < (c.y == 1 ? uMinWeak : uMin) || n8 == 8;
      if (c.y == 1 && strong * 2 < n && n < uMinWeak + 6) drop = true;
      for (int i = 0; i < 4 && !drop; i++) {
        ivec2 a = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
        int h = T(lp + a).y;
        if (h <= c.y || h > 4) continue;
        if (c.y <= 2) { drop = true; break; }
        // a crease beside an outline: keep it only if it runs away from it
        if (T(lp - a).y != c.y) drop = true;
      }
      if (drop) c = ivec2(0, 0);
    } else if (c.y == 5) {
      // lone sparks and motes (a fill pixel with < 2 fill neighbours) go
      int nf = 0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) if (T(lp + ivec2(x, y)).y == 5) nf++;
      if (nf < 3) c = ivec2(0, 0);
    }
    gl_FragColor = enc(c.x, c.y);
  }
`;

/** 2. Zhang-Suen thinning sub-iteration (uStep 0/1): every line one logical pixel wide. */
const THIN_FRAG = /* glsl */ `
  precision highp float;
  ${CLS_GLSL}
  uniform int uStep;
  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    ivec2 c = T(lp);
    if (c.y >= 1 && c.y <= 4) {
      // P2..P9 clockwise from north (GL y is up)
      bool p[8];
      p[0] = L(lp + ivec2(0, 1)); p[1] = L(lp + ivec2(1, 1)); p[2] = L(lp + ivec2(1, 0)); p[3] = L(lp + ivec2(1, -1));
      p[4] = L(lp + ivec2(0, -1)); p[5] = L(lp + ivec2(-1, -1)); p[6] = L(lp + ivec2(-1, 0)); p[7] = L(lp + ivec2(-1, 1));
      int b = 0, t = 0;
      for (int i = 0; i < 8; i++) {
        if (p[i]) b++;
        if (!p[i] && p[(i + 1) & 7]) t++;
      }
      bool del = b >= 2 && b <= 6 && t == 1;
      if (uStep == 0) del = del && !(p[0] && p[2] && p[4]) && !(p[2] && p[4] && p[6]);
      else del = del && !(p[0] && p[2] && p[6]) && !(p[0] && p[4] && p[6]);
      if (del) c = ivec2(0, 0);
    }
    gl_FragColor = enc(c.x, c.y);
  }
`;

/**
 * 3. Continuity and one ink per line.
 *  - a one-pixel gap in a straight run (line on both sides along one
 *    direction, continuing beyond, nothing across) is bridged;
 *  - a line pixel whose ink is a small minority among the line pixels round
 *    it takes the majority ink, so a long edge never dashes between two inks.
 */
const BRIDGE_FRAG = /* glsl */ `
  precision highp float;
  ${CLS_GLSL}
  ${PAL_GLSL}
  void main() {
    ivec2 lp = ivec2(gl_FragCoord.xy);
    ivec2 c = T(lp);
    if (c.y == 0) {
      bool any4 = L(lp + ivec2(1, 0)) || L(lp + ivec2(-1, 0)) || L(lp + ivec2(0, 1)) || L(lp + ivec2(0, -1));
      for (int i = 0; i < 4; i++) {
        ivec2 d = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(0, 1) : i == 2 ? ivec2(1, 1) : ivec2(1, -1);
        ivec2 e = ivec2(-d.y, d.x);
        if (i >= 2 && any4) continue;
        if (!L(lp + d) || !L(lp - d) || L(lp + e) || L(lp - e)) continue;
        bool fa = L(lp + 2 * d) || L(lp + 2 * d + e) || L(lp + 2 * d - e);
        bool fb = L(lp - 2 * d) || L(lp - 2 * d + e) || L(lp - 2 * d - e);
        if (!fa || !fb) continue;
        ivec2 A = T(lp + d), B = T(lp - d);
        c = A.y >= B.y ? A : B;
        break;
      }
    }
    if (c.y >= 1 && c.y <= 4) {
      int cnt[16];
      for (int i = 0; i < 16; i++) cnt[i] = 0;
      int tot = 0;
      for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) {
        ivec2 q = T(lp + ivec2(x, y));
        if (q.y >= 1 && q.y <= 4 && (q.y == 2) == (c.y == 2)) { cnt[q.x & 15]++; tot++; }
      }
      int mk = c.x, mc = 0;
      for (int i = 1; i < 16; i++) if (cnt[i] > mc) { mc = cnt[i]; mk = i; }
      if (mk != c.x && cnt[c.x & 15] * 4 < tot && mc * 2 > tot) c.x = mk;
    }
    gl_FragColor = enc(c.x, c.y);
  }
`;

const BLIT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tLines;
  varying vec2 vUv;
  ${PAL_GLSL}
  void main() {
    int k = int(texture2D(tLines, vUv).r * 255.0 + 0.5);
    gl_FragColor = vec4(PAL[k & 15], 1.0);
  }
`;

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

function texOf(m) {
  if (!m) return null;
  if (m.map?.isTexture) return m.map;
  const u = m.uniforms;
  if (u) for (const k of ['map', 'tMap', 'uMap', 'tDiffuse', 'uTexture', 'tex']) if (u[k]?.value?.isTexture) return u[k].value;
  return null;
}
function colorOf(m, out) {
  if (m?.color?.isColor) return out.copy(m.color);
  const u = m?.uniforms;
  if (u) {
    for (const k of ['diffuse', 'color', 'uColor', 'uBase', 'uTint']) {
      const v = u[k]?.value;
      if (v?.isColor) return out.copy(v);
      if (v?.isVector3) return out.setRGB(v.x, v.y, v.z);
    }
  }
  return out.setRGB(0.35, 0.35, 0.35);
}
const isFxMat = (m) => !!m && m.transparent && m.depthWrite === false && m.colorWrite !== false;

export class LineArtPass {
  constructor() {
    this.params = {
      ss: 2, // high-res samples per logical pixel axis (1 or 2)
      rows: 216, // target logical rows (integer upscale picks the nearest)
      crease: 0.6, // min change of surface slope (tan units) for a crease line
      idCrease: 0.12, // min surface break for an outline between two objects
      curve: 2.0, // how strongly smooth curvature is rejected
      jump: 15.0, // second difference above this = silhouette
      lum: 1.6, // log2 albedo step for a joint line
      lumDist: 40.0, // albedo lines only nearer than this (m)
      small: 2.9, // objects (groups) smaller than this (m) are outlined as one
      detail1: 110, // logical px tall: small objects get inner silhouettes...
      detail2: 200, // ...and creases
      scatter: 0.5, // instanced meshes with parts smaller than this (m) are left out
      fxT: 0.22, // effects brighter than this (linear) are drawn as shapes
      fogDark: 0.55,
      fogDrop: 0.88,
      minSpeck: 4, // a line pixel needs this many others within 3 px...
      minWeak: 9, // ...or this many for weak lines (floors, tiny objects)
      flank: 3, // px of flat surface a crease needs on both sides (hi-res; small objects one less)
      bold: 2.5, // creases stronger than bold x crease skip the flat-flank test
      halo: 1, // logical px of black kept round every nearer silhouette
      thin: 2, // thinning iterations
      tiny: 12, // objects under this many logical px tall draw weak outlines only
      angle: 28, // min world-space turn (deg) of a crease line
      grid: 1.5, // battle-square size (m) drawn on level ground in tactical views; 0 = off
    };
    this.depth = new THREE.DepthTexture(4, 4, THREE.FloatType);
    this.depth.minFilter = this.depth.magFilter = THREE.NearestFilter;
    const rt8 = (depth) => {
      const t = new THREE.WebGLRenderTarget(4, 4, {
        type: THREE.UnsignedByteType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: !!depth,
        depthTexture: depth ? this.depth : null,
        generateMipmaps: false,
        samples: 0,
      });
      t.texture.colorSpace = THREE.NoColorSpace;
      return t;
    };
    this.ink = rt8(true);
    this.fx = rt8(true); // shares the ink pass's depth
    this.mask = rt8(false);
    this._pp = [rt8(false), rt8(false)];
    this._raw = [rt8(false), rt8(false)];
    this._li = 0;
    this.lines = this._pp[1];
    this._lastView = new THREE.Matrix4();
    this._lastProj = new THREE.Matrix4();

    this._fx = [];
    this._solid = [];
    this._hidden = [];
    this._orig = new Map();
    this._info = new WeakMap(); // object -> {root}
    this._rootInfo = new WeakMap(); // root -> {id, ink, size, center}
    this._size = new WeakMap(); // node -> world bbox max dimension
    this._texMean = new WeakMap();
    this._vcMean = new WeakMap();
    this._detail = new Map(); // root -> detail this frame
    this._variants = new Map();
    this._nextId = 1;
    this._skyCache = new WeakMap();

    const quad = (frag, uniforms) => {
      const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false });
      const s = new THREE.Scene();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
      mesh.frustumCulled = false;
      s.add(mesh);
      return { m, s };
    };
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.maskQ = quad(MASK_FRAG, { tFx: { value: this.fx.texture }, uHi: { value: new THREE.Vector2(4, 4) }, uSS: { value: 2 }, uT: { value: 0.2 } });
    this.edgeQ = quad(EDGE_FRAG, {
      tId: { value: this.ink.texture },
      tDepth: { value: this.depth },
      tMask: { value: this.mask.texture },
      tPrev: { value: null },
      uStill: { value: 0 },
      uHi: { value: new THREE.Vector2(4, 4) },
      uLo: { value: new THREE.Vector2(4, 4) },
      uSS: { value: 2 },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uOrtho: { value: 0 },
      uPix: { value: 0.001 },
      uCrease: { value: 0 },
      uIdCrease: { value: 0 },
      uCurve: { value: 1 },
      uJump: { value: 0 },
      uLum: { value: 0 },
      uLumDist: { value: 0 },
      uSkyInk: { value: 0 },
      uFlank: { value: 3 },
      uHalo: { value: 2 },
      uFlameFill: { value: 1 },
      uBold: { value: 4 },
      uFog: { value: new THREE.Vector3() },
      uFogDark: { value: 0.55 },
      uFogDrop: { value: 0.88 },
      uDebug: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uGrid: { value: new THREE.Vector2(1.5, 0) },
      uAngle: { value: 0.5 },
    });
    const lo = () => ({ tIn: { value: null }, uLo: { value: new THREE.Vector2(4, 4) } });
    this.cleanQ = quad(CLEAN_FRAG, { ...lo(), uMin: { value: 4 }, uMinWeak: { value: 8 } });
    this.thinQ = quad(THIN_FRAG, { ...lo(), uStep: { value: 0 } });
    this.bridgeQ = quad(BRIDGE_FRAG, lo());
    this.blitQ = quad(BLIT_FRAG, { tLines: { value: null } });
    this._buf = new THREE.Vector2();
    this._vp = new THREE.Vector4();
    this._lw = 0;
    this._lh = 0;
  }

  /** Logical 1988 grid for a w x h px view: integer scale, ~216 rows (fewer for small insets). */
  _layout(w, h) {
    const scale = Math.max(1, Math.round(Math.max(h, 400) / this.params.rows));
    const lw = Math.max(8, Math.ceil(w / scale));
    const lh = Math.max(8, Math.ceil(h / scale));
    const ss = this.params.ss >= 2 ? 2 : 1;
    if (lw !== this._lw || lh !== this._lh || ss !== this._ss) {
      this._lw = lw;
      this._lh = lh;
      this._ss = ss;
      this.ink.setSize(lw * ss, lh * ss);
      this.fx.setSize(lw * ss, lh * ss);
      this.mask.setSize(lw, lh);
      for (const t of this._pp) t.setSize(lw, lh);
      for (const t of this._raw) t.setSize(lw, lh);
      this._resized = true;
    }
    this.scale = scale;
  }

  // ------------------------------------------------------------ ink material
  _variant(hasMap, vcol, side) {
    const key = `${hasMap ? 1 : 0}${vcol ? 1 : 0}${side}`;
    let m = this._variants.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uMap: { value: null },
        uUvT: { value: new THREE.Matrix3() },
        uAlphaTest: { value: 0 },
        uOut: { value: new THREE.Vector3() },
        uFlags: { value: 0 },
      },
      defines: hasMap ? { HAS_MAP: '' } : {},
      vertexShader: INK_VERT,
      fragmentShader: INK_FRAG,
      vertexColors: vcol,
      side,
      fog: false,
      lights: false,
      toneMapped: false,
    });
    m.onBeforeRender = (r, s, c, g, obj, grp) => this._bind(m, obj, grp);
    this._variants.set(key, m);
    return m;
  }

  _bind(mat, obj, grp) {
    const orig = this._orig.get(obj);
    const m = Array.isArray(orig) ? orig[grp?.materialIndex ?? 0] : orig;
    const u = mat.uniforms;
    colorOf(m, u.uColor.value);
    const tex = texOf(m);
    if (mat.defines.HAS_MAP !== undefined) {
      u.uMap.value = tex;
      if (tex) {
        if (tex.matrixAutoUpdate) tex.updateMatrix();
        u.uUvT.value.copy(tex.matrix);
      }
    }
    u.uAlphaTest.value = m?.alphaTest > 0 ? m.alphaTest : 0;
    const info = this._info.get(obj);
    const ri = info?.root ? this._rootInfo.get(info.root) : null;
    const id = ri ? ri.id : 0;
    const dv = ri ? this._detail.get(info.root) ?? 0 : 3;
    const det = dv & 3;
    u.uOut.value.set((id & 255) / 255, ((id >> 8) & 255) / 255, ri ? ri.curInk ?? ri.ink : -1);
    u.uFlags.value = (det << 4) | (this._isGlow(m) ? 64 : 0) | (dv & 4 ? 128 : 0);
    mat.uniformsNeedUpdate = true;
  }

  _isGlow(m) {
    if (!m) return false;
    if (m.emissive?.isColor && !m.emissiveMap) {
      const e = m.emissive;
      return (0.2126 * e.r + 0.7152 * e.g + 0.0722 * e.b) * (m.emissiveIntensity ?? 1) > 0.35;
    }
    if (m.isMeshBasicMaterial && m.color && !m.map) {
      const c = m.color;
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 1.0;
    }
    return false;
  }

  // --------------------------------------------------------- classification
  _sizeOf(node) {
    let s = this._size.get(node);
    if (s === undefined) {
      _box.setFromObject(node);
      s = _box.isEmpty() ? 0 : _box.getSize(_v).length() * 0.8;
      this._size.set(node, s);
    }
    return s;
  }

  _rootOf(o, scene) {
    let info = this._info.get(o);
    if (info) return info;
    let root = null;
    const small = this.params.small;
    for (let n = o; n && n !== scene && n.parent; n = n.parent) {
      if (this._sizeOf(n) < small) root = n;
      else break;
    }
    info = { root };
    this._info.set(o, info);
    if (root && !this._rootInfo.has(root)) this._rootInfo.set(root, this._makeRoot(root));
    return info;
  }

  _makeRoot(root) {
    const votes = new Float32Array(16);
    const satVotes = new Float32Array(16);
    let total = 0;
    const stand = [];
    root.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => isFxMat(x) || x?.colorWrite === false || x?.alphaTest > 0)) return;
      const g = m.geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      g.boundingBox.getSize(_v);
      m.getWorldScale(_box.min);
      _v.multiply(_box.min);
      const area = _v.x * _v.y + _v.y * _v.z + _v.z * _v.x + 1e-6;
      const vcs = this._vertexSamples(g);
      for (const mat of mats) {
        if (!mat || isFxMat(mat)) continue;
        const us = mat.userData?.uStand;
        if (us && typeof us.value === 'number' && !stand.includes(us)) stand.push(us);
        colorOf(mat, _c);
        let r0 = _c.r, g0 = _c.g, b0 = _c.b;
        const tex = texOf(mat);
        if (tex) {
          const tm = this._textureMean(tex);
          r0 *= tm[0];
          g0 *= tm[1];
          b0 *= tm[2];
        }
        const samples = mat.vertexColors && vcs ? vcs : [[1, 1, 1]];
        const wEach = area / mats.length / samples.length;
        for (const vc of samples) {
          const [ink, sat] = egaInkJS(r0 * vc[0], g0 * vc[1], b0 * vc[2]);
          votes[ink] += wEach;
          if (sat) satVotes[ink] += wEach;
          total += wEach;
        }
      }
    });
    // the ink of the largest clearly COLOURED region if it covers a fair share
    // of the object (a red robe keeps the figure red even over grey mail and
    // flesh), otherwise the majority ink
    let ink = 7;
    let best = -1;
    let sInk = 0;
    let sBest = 0;
    for (let i = 1; i < 16; i++) {
      if (votes[i] > best) ((best = votes[i]), (ink = i));
      if (i >= 9 && i <= 14 && satVotes[i] > sBest) ((sBest = satVotes[i]), (sInk = i));
    }
    if (sInk >= 9 && sInk <= 14 && sBest > 0.18 * total) ink = sInk;
    if (total === 0) ink = 7;
    // id 0 = "large surface"; spread ids so neighbours never collide
    const id = (this._nextId = (this._nextId * 40503 + 1) & 0xffff) || 1;
    _box.setFromObject(root);
    const center = _box.getCenter(new THREE.Vector3());
    root.worldToLocal(center);
    return { id, ink, curInk: ink, stand: stand.length ? stand : null, size: this._sizeOf(root), center };
  }

  /** Up to ~256 vertex colours of a geometry (null without a colour attribute). */
  _vertexSamples(g) {
    if (this._vcMean.has(g)) return this._vcMean.get(g);
    const a = g.attributes?.color;
    let r = null;
    if (a && a.count) {
      r = [];
      const step = Math.max(1, Math.floor(a.count / 256));
      for (let i = 0; i < a.count; i += step) r.push([a.getX(i), a.getY(i), a.getZ(i)]);
    }
    this._vcMean.set(g, r);
    return r;
  }

  _textureMean(tex) {
    let r = this._texMean.get(tex);
    if (r) return r;
    r = [1, 1, 1];
    try {
      const img = tex.image;
      const srgb = tex.colorSpace === THREE.SRGBColorSpace;
      const lin = (v) => (srgb ? Math.pow(v, 2.2) : v);
      if (img && img.data && img.width) {
        const d = img.data;
        const ch = d.length / (img.width * img.height);
        const max = d instanceof Uint8Array || d instanceof Uint8ClampedArray ? 255 : 1;
        if (ch >= 3) {
          const acc = [0, 0, 0];
          const n = img.width * img.height;
          const step = Math.max(1, Math.floor(n / 1024));
          let k = 0;
          for (let i = 0; i < n; i += step, k++) for (let c = 0; c < 3; c++) acc[c] += lin(d[i * ch + c] / max);
          r = acc.map((v) => v / Math.max(1, k));
        }
      } else if (img && (img.width ?? 0) > 0 && typeof document !== 'undefined') {
        const cv = (this._tmpCanvas ??= document.createElement('canvas'));
        cv.width = cv.height = 8;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.clearRect(0, 0, 8, 8);
        cx.drawImage(img, 0, 0, 8, 8);
        const d = cx.getImageData(0, 0, 8, 8).data;
        const acc = [0, 0, 0];
        for (let i = 0; i < 64; i++) for (let c = 0; c < 3; c++) acc[c] += lin(d[i * 4 + c] / 255);
        r = acc.map((v) => v / 64);
      }
    } catch {
      r = [1, 1, 1];
    }
    this._texMean.set(tex, r);
    return r;
  }

  /** Sort the visible renderables into solid (ink pass), effects and left-out. */
  _split(scene) {
    const fx = (this._fx.length = 0, this._fx);
    const solid = (this._solid.length = 0, this._solid);
    const hidden = (this._hidden.length = 0, this._hidden);
    const p = this.params;
    scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const m = o.material;
      const mats = Array.isArray(m) ? m : [m];
      if (mats.every((x) => x && x.visible === false)) return;
      if (!o.isMesh || mats.every(isFxMat)) {
        if (mats.every((x) => x && x.colorWrite !== false)) fx.push(o);
        else hidden.push(o);
        return;
      }
      // sky domes / depth-less backdrops, depth-only occluders, foliage cut-outs
      if (mats.some((x) => !x || x.visible === false || x.colorWrite === false || x.depthWrite === false || (x.transparent && x.opacity < 0.05) || (x.alphaTest > 0 && (texOf(x) || x.alphaMap)))) {
        hidden.push(o);
        return;
      }
      if (o.isInstancedMesh && o.count > 6) {
        const g = o.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (g.boundingSphere.radius * 2 < p.scatter) {
          hidden.push(o);
          return;
        }
      }
      solid.push(o);
    });
  }

  _classify(scene, camera, lh) {
    this._detail.clear();
    const p = this.params;
    const ortho = !!camera.isOrthographicCamera;
    const tanH = Math.tan(THREE.MathUtils.degToRad((camera.fov ?? 60) / 2)) / (camera.zoom || 1);
    const viewH = ortho ? (camera.top - camera.bottom) / (camera.zoom || 1) : 0;
    for (const o of this._solid) {
      const { root } = this._rootOf(o, scene);
      if (!root || this._detail.has(root)) continue;
      const ri = this._rootInfo.get(root);
      _v.copy(ri.center).applyMatrix4(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      const z = Math.max(0.05, -_v.z);
      const px = ortho ? (ri.size / viewH) * lh : (ri.size / (2 * z * tanH)) * lh;
      this._detail.set(root, (px > p.detail2 ? 2 : px > p.detail1 ? 1 : 0) | (px < p.tiny ? 4 : 0));
      // a figure repainted at run time (the active combatant's standout
      // cloth, material.userData.uStand) takes that colour's ink while it lasts
      ri.curInk = ri.stand?.some((u) => u.value > 0.5) ? 12 : ri.ink;
    }
  }

  _skyColor(scene) {
    let dome = this._skyCache.get(scene);
    if (dome === undefined || (dome && dome.parent == null)) {
      dome = null;
      scene.traverse((o) => {
        if (!dome && o.userData?.keys && typeof o.userData.keys.night === 'number') dome = o;
      });
      this._skyCache.set(scene, dome);
    }
    if (dome && dome.visible && dome.userData.keys.night < 0.5) return 1;
    return 0;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {number} [dt] frame delta; 0 (frozen clock) disables the temporal hysteresis
   * @param {{x:number,y:number,w:number,h:number}} [viewport] drawing-buffer px, GL origin
   *   (bottom-left); draws into that part of the canvas only (default: all of it)
   */
  render(renderer, scene, camera, dt = 0, viewport = null) {
    const buf = renderer.getDrawingBufferSize(this._buf);
    const vw = viewport ? viewport.w : buf.x;
    const vh = viewport ? viewport.h : buf.y;
    this._layout(vw, vh);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevVp = renderer.getViewport(this._vp).clone();
    const prevScissorTest = renderer.getScissorTest();
    const cc = renderer.getClearColor(this._cc ??= new THREE.Color());
    const ca = renderer.getClearAlpha();
    const sm = renderer.shadowMap;
    const smAuto = sm.autoUpdate;
    const smNeeds = sm.needsUpdate;
    const bg = scene.background;
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    scene.background = null;
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    camera.updateMatrixWorld();
    if (!camera.parent) camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const lh = this._lh;

    this._split(scene);
    this._classify(scene, camera, lh);
    try {
      // 1. ink pass: solid geometry, unlit, with depth
      for (const o of this._fx) o.visible = false;
      for (const o of this._hidden) o.visible = false;
      for (const o of this._solid) {
        const m = o.material;
        this._orig.set(o, m);
        o.material = Array.isArray(m)
          ? m.map((x) => this._variant(!!texOf(x), !!x?.vertexColors, x?.side ?? THREE.FrontSide))
          : this._variant(!!texOf(m), !!m?.vertexColors, m?.side ?? THREE.FrontSide);
      }
      renderer.setRenderTarget(this.ink);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    } finally {
      for (const [o, m] of this._orig) o.material = m;
      this._orig.clear();
      for (const o of this._fx) o.visible = true;
      for (const o of this._hidden) o.visible = true;
    }

    // 2. effects alone, over black, depth-tested against the solid scene
    for (const o of this._solid) o.visible = false;
    for (const o of this._hidden) o.visible = false;
    renderer.setRenderTarget(this.fx);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    if (this._fx.length) renderer.render(scene, camera);
    renderer.autoClear = true;
    for (const o of this._solid) o.visible = true;
    for (const o of this._hidden) o.visible = true;
    scene.background = bg;
    sm.autoUpdate = smAuto;
    sm.needsUpdate = smNeeds;

    const p = this.params;
    const hiW = this._lw * this._ss;
    const hiH = this._lh * this._ss;
    {
      const u = this.maskQ.m.uniforms;
      u.uHi.value.set(hiW, hiH);
      u.uSS.value = this._ss;
      u.uT.value = p.fxT;
      renderer.setRenderTarget(this.mask);
      renderer.render(this.maskQ.s, this.cam);
    }

    // 3. edges at the logical grid
    const u = this.edgeQ.m.uniforms;
    u.uHi.value.set(hiW, hiH);
    u.uLo.value.set(this._lw, this._lh);
    u.uSS.value = this._ss;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const ortho = !!camera.isOrthographicCamera;
    u.uOrtho.value = ortho ? 1 : 0;
    u.uPix.value = ortho
      ? Math.max(1e-6, (camera.top - camera.bottom) / (camera.zoom || 1) / hiH)
      : (2 * Math.tan(THREE.MathUtils.degToRad((camera.fov ?? 60) / 2))) / (camera.zoom || 1) / hiH;
    u.uCrease.value = p.crease;
    u.uIdCrease.value = p.idCrease;
    u.uCurve.value = p.curve;
    u.uJump.value = p.jump;
    u.uLum.value = p.lum;
    u.uLumDist.value = p.lumDist;
    u.uFogDark.value = p.fogDark;
    u.uFogDrop.value = p.fogDrop;
    u.uDebug.value = p.debug ?? 0;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    // tactical views (perspective, looking down > ~35 deg) get the battle squares
    const fwdY = -camera.matrixWorld.elements[9] / Math.hypot(camera.matrixWorld.elements[8], camera.matrixWorld.elements[9], camera.matrixWorld.elements[10]);
    // (a scene can set scene.userData.classicGrid = size | false; linear-fog miniature
    // views such as the automap diorama default to none)
    const g = scene.userData?.classicGrid ?? (scene.fog?.isFog ? 0 : p.grid);
    u.uGrid.value.set(g || 1, g > 0 && !ortho && fwdY < -0.57 ? 1 : 0);
    u.uAngle.value = THREE.MathUtils.degToRad(p.angle);
    const f = scene.fog;
    if (f?.isFogExp2) u.uFog.value.set(f.density, 0, 0);
    else if (f?.isFog) u.uFog.value.set(0, f.near, f.far);
    else u.uFog.value.set(0, 0, 0);
    const sky = this._skyColor(scene);
    u.uSkyInk.value = sky;
    u.uFlank.value = p.flank;
    u.uBold.value = p.bold;
    u.uHalo.value = p.halo * this._ss;
    const still = this._still(camera, dt);
    const prev = this._raw[this._li];
    this._li ^= 1;
    const raw = this._raw[this._li];
    u.tPrev.value = prev.texture;
    u.uStill.value = still ? 1 : 0;
    renderer.setRenderTarget(raw);
    renderer.render(this.edgeQ.s, this.cam);

    // 4. logical-grid clean-up: specks and doubled lines, thinning to one
    //    pixel, gap bridging and one ink per line; then a nearest-neighbour
    //    upscale to the canvas
    const pp = this._pp;
    let src = raw;
    let k = 0;
    const step = (q, extra) => {
      const uu = q.m.uniforms;
      uu.tIn.value = src.texture;
      uu.uLo.value.set(this._lw, this._lh);
      if (extra) extra(uu);
      renderer.setRenderTarget(pp[k]);
      renderer.render(q.s, this.cam);
      src = pp[k];
      k ^= 1;
    };
    step(this.cleanQ, (uu) => {
      uu.uMin.value = p.minSpeck;
      uu.uMinWeak.value = p.minWeak;
    });
    for (let i = 0; i < p.thin; i++) {
      step(this.thinQ, (uu) => (uu.uStep.value = 0));
      step(this.thinQ, (uu) => (uu.uStep.value = 1));
    }
    step(this.bridgeQ);
    this.lines = src;
    this.blitQ.m.uniforms.tLines.value = src.texture;

    renderer.setRenderTarget(null);
    if (viewport) {
      const pr = renderer.getPixelRatio();
      // the logical grid overhangs the view by < 1 cell: crop it, never stretch
      const cw = this._lw * this.scale;
      const ch = this._lh * this.scale;
      renderer.setScissorTest(true);
      renderer.setScissor(viewport.x / pr, viewport.y / pr, viewport.w / pr, viewport.h / pr);
      renderer.setViewport(viewport.x / pr, (viewport.y + viewport.h - ch) / pr, cw / pr, ch / pr);
    } else {
      const pr = renderer.getPixelRatio();
      renderer.setViewport(0, (buf.y - this._lh * this.scale) / pr, (this._lw * this.scale) / pr, (this._lh * this.scale) / pr);
    }
    renderer.render(this.blitQ.s, this.cam);
    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(prevVp);
    renderer.setClearColor(cc, ca);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  /** Camera unchanged since last frame (and the clock running, and no resize)? */
  _still(camera, dt) {
    const same = !this._resized && this._lastView.equals(camera.matrixWorld) && this._lastProj.equals(camera.projectionMatrix);
    this._lastView.copy(camera.matrixWorld);
    this._lastProj.copy(camera.projectionMatrix);
    this._resized = false;
    return same && dt > 0;
  }

  dispose() {
    for (const t of [this.ink, this.fx, this.mask, ...this._pp, ...this._raw]) t.dispose();
    this.depth.dispose();
    for (const q of [this.maskQ, this.edgeQ, this.cleanQ, this.thinQ, this.bridgeQ, this.blitQ]) q.m.dispose();
    for (const m of this._variants.values()) m.dispose();
  }
}
