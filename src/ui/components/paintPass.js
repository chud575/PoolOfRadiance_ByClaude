import * as THREE from 'three';

/**
 * Finishing passes for offscreen figure renders (portraits, snapshots):
 * HDR render target → (Kuwahara oil filter → brushwork strokes) or a plain
 * ACES + sRGB grade → a CPU-side 2D canvas. Runs on whatever renderer
 * renders the figure (ideally the game's own, so no second WebGL context
 * has to synchronise with it) and leaves its clear state untouched.
 */

const KUWAHARA = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float exposure;
varying vec2 vUv;
vec3 aces(vec3 x) {
  x *= exposure * 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 disp(vec2 uv) { return pow(aces(texture2D(tSrc, uv).rgb), vec3(1.0 / 2.2)); }
void main() {
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
  const int R = 2;
  for (int j = -R; j <= R; j++) {
    for (int i = -R; i <= R; i++) {
      vec3 c = disp(vUv + vec2(float(i), float(j)) * texel);
      vec3 c2 = c * c;
      if (i <= 0 && j <= 0) { m0 += c; s0 += c2; }
      if (i >= 0 && j <= 0) { m1 += c; s1 += c2; }
      if (i <= 0 && j >= 0) { m2 += c; s2 += c2; }
      if (i >= 0 && j >= 0) { m3 += c; s3 += c2; }
    }
  }
  float n = float((R + 1) * (R + 1));
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  vec3 v0 = abs(s0 / n - m0 * m0), v1 = abs(s1 / n - m1 * m1), v2 = abs(s2 / n - m2 * m2), v3 = abs(s3 / n - m3 * m3);
  float a0 = v0.r + v0.g + v0.b, a1 = v1.r + v1.g + v1.b, a2 = v2.r + v2.g + v2.b, a3 = v3.r + v3.g + v3.b;
  vec3 col = m0; float best = a0;
  if (a1 < best) { best = a1; col = m1; }
  if (a2 < best) { best = a2; col = m2; }
  if (a3 < best) { best = a3; col = m3; }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Brushwork: smear along the isophotes (strokes follow the forms), glaze, weave, vignette. */
const STROKES = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 texel;
uniform vec2 res;
uniform float seed;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21) + seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
void main() {
  vec2 px = texel;
  float gx = lum(texture2D(tSrc, vUv + vec2(px.x, 0.0)).rgb) - lum(texture2D(tSrc, vUv - vec2(px.x, 0.0)).rgb);
  float gy = lum(texture2D(tSrc, vUv + vec2(0.0, px.y)).rgb) - lum(texture2D(tSrc, vUv - vec2(0.0, px.y)).rgb);
  float gm = length(vec2(gx, gy));
  // Stroke direction: along the isophote where there is form, a loose diagonal hatch in flat areas.
  vec2 dir = gm > 0.012 ? normalize(vec2(-gy, gx)) : normalize(vec2(0.8, -0.6) + (n2(vUv * res / 18.0) - 0.5) * 0.8);
  float len = mix(5.0, 1.4, clamp(gm * 7.0, 0.0, 1.0));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = -3; k <= 3; k++) {
    float t = float(k) / 3.0;
    float w = 1.0 - abs(t) * 0.6;
    acc += texture2D(tSrc, vUv + dir * t * len * px).rgb * w;
    wsum += w;
  }
  vec3 col = acc / wsum;
  // Bristle texture: streaks along the stroke direction.
  vec2 q = vec2(dot(vUv * res, dir), dot(vUv * res, vec2(-dir.y, dir.x)));
  float bristle = n2(vec2(q.x * 0.25, q.y * 1.6)) - 0.5;
  col *= 1.0 + bristle * 0.1;
  // Grade: chroma, warm shadows, soft glaze (warm top-left, cool bottom-right).
  float l = lum(col);
  col = mix(vec3(l), col, 1.1);
  col += vec3(0.04, 0.02, 0.0) * (1.0 - l) * (1.0 - l);
  vec3 glaze = mix(vec3(1.06, 0.98, 0.88), vec3(0.9, 0.95, 1.06), clamp((vUv.x - (vUv.y - 1.0) * 0.6) * 0.6, 0.0, 1.0));
  col *= glaze;
  // Canvas weave and grain.
  vec2 p = floor(vUv * res);
  float weave = mod(p.x + p.y, 2.0) * 2.0 - 1.0;
  col += (weave * 0.006 + (h21(p) - 0.5) * 0.022);
  // Vignette.
  vec2 v = vUv - vec2(0.47, 0.56);
  col *= 1.0 - smoothstep(0.32, 0.85, length(v * vec2(1.05, 0.95))) * 0.62;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;


const PLAIN = /* glsl */`
uniform sampler2D tSrc;
uniform float exposure;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tSrc, vUv);
  vec3 x = s.rgb * exposure * 0.6;
  vec3 c = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), s.a);
}
`;

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
let P = null;
function passes() {
  if (P) return P;
  const mk = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false, transparent: false });
  const kuw = mk(KUWAHARA, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, exposure: { value: 1 } });
  const strokes = mk(STROKES, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2() }, seed: { value: 0 } });
  const plain = mk(PLAIN, { tSrc: { value: null }, exposure: { value: 1 } });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), plain);
  scene.add(quad);
  P = { kuw, strokes, plain, scene, quad, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), rts: new Map() };
  return P;
}
function rtFor(key, w, h, opts) {
  const p = passes();
  let rt = p.rts.get(key);
  if (!rt || rt.width !== w || rt.height !== h) {
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(w, h, opts);
    p.rts.set(key, rt);
  }
  return rt;
}

/** A float render target for the figure pass (cached by key and size). */
export function hdrTarget(key, w, h, samples = 0) {
  return rtFor(`hdr:${key}`, w, h, { type: THREE.HalfFloatType, depthBuffer: true, samples });
}

/**
 * Render `scene` with `camera` into an HDR target, finish it and read it back.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{w:number, h:number, ss?:number, paint?:boolean, seed?:number, exposure?:number, alpha?:boolean, key?:string}} o
 * @returns {HTMLCanvasElement}
 */
export function renderToCanvas(renderer, scene, camera, o) {
  const p = passes();
  const ss = o.ss ?? 1;
  const RW = Math.round(o.w * ss), RH = Math.round(o.h * ss);
  const prevRT = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  try {
    renderer.autoClear = true;
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    const hdr = hdrTarget(o.key ?? 'fig', RW, RH, o.paint ? 0 : 4);
    renderer.setRenderTarget(hdr);
    renderer.setClearColor(0x000000, o.alpha ? 0 : 1);
    renderer.clear();
    renderer.render(scene, camera);
    const out = rtFor(`out:${o.key ?? 'fig'}`, o.w, o.h, { depthBuffer: false });
    if (o.paint) {
      const mid = rtFor(`mid:${o.key ?? 'fig'}`, RW, RH, { depthBuffer: false });
      p.kuw.uniforms.tSrc.value = hdr.texture;
      p.kuw.uniforms.texel.value.set(1 / RW, 1 / RH);
      p.kuw.uniforms.exposure.value = o.exposure ?? 1;
      p.quad.material = p.kuw;
      renderer.setRenderTarget(mid);
      renderer.render(p.scene, p.cam);
      p.strokes.uniforms.tSrc.value = mid.texture;
      p.strokes.uniforms.texel.value.set(1 / RW, 1 / RH);
      p.strokes.uniforms.res.value.set(RW, RH);
      p.strokes.uniforms.seed.value = o.seed ?? 0;
      p.quad.material = p.strokes;
    } else {
      p.plain.uniforms.tSrc.value = hdr.texture;
      p.plain.uniforms.exposure.value = o.exposure ?? 1;
      p.quad.material = p.plain;
    }
    renderer.setRenderTarget(out);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(p.scene, p.cam);
    return readCanvas(renderer, out);
  } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }
}

function readCanvas(renderer, rt) {
  const w = rt.width;
  const h = rt.height;
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  const img = new ImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  return c;
}
