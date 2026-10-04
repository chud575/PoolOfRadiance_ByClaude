import * as THREE from 'three';
import { getGlowTexture } from '../../../render/textures/index.js';

/**
 * Spell & combat VFX. Every effect is a pure function of its age (t - start),
 * so frozen-clock screenshots (e.g. fireball mid-explosion at a fixed t) are
 * deterministic. Particles are analytic GPU points (no CPU simulation).
 */
const hashf = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const _vc = new THREE.Vector3();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------ particles
const PARTICLE_VS = `
  attribute vec3 aV; attribute vec4 aD;
  uniform float uAge, uDrag, uGrav, uGrow, uPix, uTurb, uFloor;
  varying float vLife; varying float vSeed;
  void main(){
    float t = uAge - aD.x;
    float life = t / aD.y;
    vLife = life; vSeed = aD.w;
    vec3 p = position;
    if (t > 0.0) {
      float k = uDrag > 0.0 ? (1.0 - exp(-uDrag * t)) / uDrag : t;
      p += aV * k;
      p.y -= 0.5 * uGrav * t * t;
      p.x += sin(t * 2.3 + aD.w * 40.0) * uTurb * t;
      p.z += cos(t * 1.9 + aD.w * 23.0) * uTurb * t;
      p.y = max(p.y, uFloor);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float sz = aD.z * (1.0 + uGrow * clamp(life, 0.0, 1.0));
    gl_PointSize = (t < 0.0 || life > 1.0) ? 0.0 : sz * uPix / max(0.1, -mv.z);
  }`;
const PARTICLE_FS = `
  uniform vec3 uC0, uC1, uC2; uniform float uIntensity, uSoft, uFadeIn, uAlpha;
  varying float vLife; varying float vSeed;
  void main(){
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float disc = 1.0 - smoothstep(1.0 - uSoft, 1.0, r);
    if (disc <= 0.0) discard;
    float l = clamp(vLife, 0.0, 1.0);
    vec3 c = l < 0.5 ? mix(uC0, uC1, l * 2.0) : mix(uC1, uC2, (l - 0.5) * 2.0);
    float a = disc * smoothstep(0.0, uFadeIn, l) * (1.0 - smoothstep(0.6, 1.0, l));
    gl_FragColor = vec4(c * uIntensity, a * uAlpha);
  }`;

/**
 * Burst of analytic particles.
 * @param {object} o
 */
export function particleBurst(o) {
  const n = o.count ?? 40;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const dat = new Float32Array(n * 4);
  const seed = o.seed ?? 1;
  for (let i = 0; i < n; i++) {
    const r = (k) => hashf(seed * 91.7 + i * 13.3 + k * 7.1);
    const sp = o.spread ?? 0.1;
    let px = o.at.x + (r(1) - 0.5) * sp * 2;
    let py = o.at.y + (r(2) - 0.5) * sp * (o.flatY ? 0.3 : 2);
    let pz = o.at.z + (r(3) - 0.5) * sp * 2;
    if (o.emit) [px, py, pz] = o.emit(i, r);
    pos.set([px, py, pz], i * 3);
    let v;
    if (o.velocity) v = o.velocity(i, r);
    else {
      const th = r(4) * Math.PI * 2;
      const ph = Math.acos(1 - 2 * r(5)) * (o.hemi ? 0.5 : 1);
      const s = (o.speed ?? 2) * (0.4 + r(6) * 0.6);
      v = [Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s * (o.up ?? 1), Math.sin(ph) * Math.sin(th) * s];
      if (o.dir) v = [v[0] * 0.4 + o.dir.x * s, v[1] * 0.4 + o.dir.y * s, v[2] * 0.4 + o.dir.z * s];
    }
    vel.set(v, i * 3);
    dat.set([(o.delay ?? 0) + r(7) * (o.stagger ?? 0), (o.life ?? 1) * (0.6 + r(8) * 0.4), (o.size ?? 0.1) * (0.6 + r(9) * 0.8), r(10)], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dat, 4));
  const cols = (o.colors ?? [0xffffff, 0xffc060, 0x802000]).map((c) => new THREE.Color(c));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: {
      uAge: { value: 0 }, uDrag: { value: o.drag ?? 1.5 }, uGrav: { value: o.gravity ?? 0 }, uGrow: { value: o.grow ?? 0 },
      uPix: { value: 600 }, uTurb: { value: o.turb ?? 0 }, uFloor: { value: o.floor ?? -99 },
      uC0: { value: cols[0] }, uC1: { value: cols[1] ?? cols[0] }, uC2: { value: cols[2] ?? cols[1] ?? cols[0] },
      uIntensity: { value: o.intensity ?? 1.5 }, uSoft: { value: o.soft ?? 0.6 }, uFadeIn: { value: o.fadeIn ?? 0.05 }, uAlpha: { value: o.alpha ?? 1 },
    },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  const life = (o.delay ?? 0) + (o.stagger ?? 0) + (o.life ?? 1) + 0.05;
  return {
    obj: pts,
    life,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      mat.uniforms.uPix.value = ctx.pix;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ primitives
function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  s.renderOrder = 7;
  return s;
}

const NOISE_GLSL = `
  vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
  float noise3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                   mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                   mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
  float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }
`;

/**
 * Ray-marched volumetric fire/smoke ball. A unit sphere (scaled/positioned by
 * the caller) bounds a domain-warped fBm density field; each pixel marches it
 * front to back, turning density + distance from the core into temperature:
 * white-hot heart → yellow → orange flame tongues → dull red → absorbing soot
 * that is lit from inside by the fire and from above by the sky. Ground clips
 * the march (uFloor, object space) so the blast hugs the cobbles. Output is
 * premultiplied; hot emission is rolled off so ACES keeps the hue.
 * Uniforms animated by the caller: uGrow (fireball radius in sphere units),
 * uHeat, uErode (tears holes as it burns out), uSmoke (cools edges to soot),
 * uFade, uAge, uCam (camera in object space), uFloor.
 */
function volumeFire({ steps = 24, smoke = false, gas = false, glow = 0 } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uCam: { value: new THREE.Vector3(0, 0, 5) }, uAge: { value: 0 }, uSeed: { value: 0 }, uGrow: { value: 0.5 }, uHeat: { value: 1 },
      uErode: { value: 0 }, uSmoke: { value: 0 }, uFade: { value: 1 }, uFloor: { value: -10 }, uFreq: { value: 3.3 }, uSky: { value: new THREE.Color(0x3a4048) }, uDrift: { value: new THREE.Vector3(0, -1.3, 0) },
      uVic: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) }, uVicH: { value: [1, 1, 1, 1, 1, 1] }, uCrisp: { value: 5 }, uShape: { value: 0 },
      uLobe: { value: fireLobes(1, smoke) },
    },
    vertexShader: 'varying vec3 vO; void main(){ vO = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uCam, uSky, uDrift; uniform float uAge, uSeed, uGrow, uHeat, uErode, uSmoke, uFade, uFloor, uFreq, uCrisp, uShape;
      uniform vec4 uVic[6]; uniform float uVicH[6]; uniform vec4 uLobe[9];
      varying vec3 vO;
      float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + vec3(1.7, 9.2, 3.3); a *= 0.5; } return s / 0.9375; }
      // Returns density (>0 inside); n = billow crest (1 = the hot heart of a
      // lobe, 0 = the folds between lobes), core = 1 at the heart.
      // The shape is a cluster of distinct, crisp cauliflower lobes (a smooth
      // union of offset spheres, each with its own hot centre) with billow
      // noise riding their surfaces: reads as a rolling layered fireball with
      // dark folds between the billows, not a fuzzy noise blob.
      float smin(float a, float b, float k){ float hh = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, hh) - k * hh * (1.0 - hh); }
      float field(vec3 p, out float n, out float core){
        float g = max(uGrow, 0.02);
        vec3 q = p * uFreq + uDrift * uAge + uSeed;
        float w = vn(q * 0.55 + 4.3);
        float b2 = vn(q * 1.9 + w * 2.0 + 7.1);
        float b3 = vn(q * 4.4 + 3.3 - vec3(0.0, uAge * 2.0, 0.0));
        float r0 = length(p);
        float sd = r0 - g * 0.5;
        float inner = 1.0 - r0 / (g * 0.5);
        for (int i = 0; i < 9; i++) {
          vec4 L = uLobe[i];
          vec3 c = L.xyz * g;
          float lr = L.w * g;
          float dl = length(p - c);
          sd = smin(sd, dl - lr, 0.1 * g);
          inner = max(inner, 1.0 - dl / lr);
        }
        if (uShape > 0.5) {
          // A rising column: one continuous trunk widening toward the top.
          float yy = clamp(p.y, -0.85, 0.85);
          float rad = g * (0.36 + 0.14 * (p.y + 0.85));
          sd = length(vec3(p.x, p.y - yy, p.z)) - rad;
          inner = 1.0 - length(p.xz) / max(rad, 1e-3);
        }
        // Cauliflower billows: |noise| ("billow" noise) gives round crowns
        // with sharp creases between them, at two scales plus a fine curl.
        float k1 = 1.0 - abs(b2 * 2.0 - 1.0);
        float k2 = 1.0 - abs(b3 * 2.0 - 1.0);
        ${gas ? '// Vapour billows are softer and rounder than fire (no leafy creases).\n        k1 = mix(k1, b2, 0.5); k2 = mix(k2, b3, 0.6) * 0.7;' : ''}
        sd -= ((k1 - 0.55) * 0.3 + (k2 - 0.55) * 0.1) * g;
        n = clamp(inner * 0.7 + (k1 - 0.5) * 0.9 + (k2 - 0.5) * 0.25 + 0.2, 0.0, 1.0);
        core = clamp(1.0 - r0 / (g * 0.85), 0.0, 1.0);
        float d = -sd / g;
        d -= uErode * (1.05 - n) * 1.6;
        return d;
      }
      void main(){
        vec3 ro = uCam;
        vec3 rd = normalize(vO - uCam);
        float b = dot(ro, rd); float c = dot(ro, ro) - 1.0; float h = b * b - c;
        if (h <= 0.0) discard;
        h = sqrt(h);
        float t0 = max(-b - h, 0.0); float t1 = -b + h;
        if (rd.y < -0.0001) t1 = min(t1, (uFloor - ro.y) / rd.y);
        if (t1 <= t0) discard;
        const int N = ${steps};
        float dt = (t1 - t0) / float(N);
        float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        // Victims stay readable: where the view ray passes through a figure
        // caught in the blast, the fire thins to a glowing veil (the body reads
        // as a silhouette inside the flames instead of vanishing).
        float thin = 1.0;
        for (int k = 0; k < 6; k++) {
          vec4 v = uVic[k];
          if (v.w <= 0.0) continue;
          vec3 sk = vec3(1.0, v.w / uVicH[k], 1.0);
          vec3 o = (ro - v.xyz) * sk; vec3 dd = rd * sk;
          float tv = -dot(o, dd) / dot(dd, dd);
          float miss = length(o + dd * tv);
          thin = min(thin, mix(${gas ? '0.3' : '0.8'}, 1.0, smoothstep(v.w * 0.5, v.w * 1.15, miss)));
        }
        vec3 col = vec3(0.0); float T = 1.0;
        vec3 pPrev = ro + rd * t0; vec3 pHit = vec3(0.0); float hit = 0.0;
        for (int i = 0; i < N; i++) {
          vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
          float n, core;
          float d = field(p, n, core);
          if (d > 0.0 && hit < 0.5) { hit = 1.0; pHit = p; }
          if (hit < 0.5) pPrev = p;
          if (d > 0.0) {
            float dens = clamp(d * uCrisp, 0.0, 1.0) * thin;
            ${gas ? `
            // Stinking cloud: crisp cauliflower billows of sickly vapour, lit
            // by the scene's key (uSky = key colour, uHeat = brightness):
            // dense near-black olive folds pooling at the base, translucent
            // yellow-green crowns catching the light, grey sour wisps at the
            // thin rim (which stays see-through so figures inside read).
            float a = 1.0 - exp(-dens * mix(6.0, 18.0, smoothstep(0.0, 0.4, d)) * dt);
            // Lambert-like shading from the density gradient toward the key
            // (billow faces turned to the light glow, the far sides and the
            // folds between lobes fall into deep olive shadow).
            float nU, cU;
            float dUp = field(p + vec3(0.05, 0.13, 0.03), nU, cU);
            float lit = clamp((d - dUp) * 7.0 + 0.25, 0.0, 1.0);
            lit *= lit;
            float hgt = clamp(p.y * 1.1 + 0.45, 0.0, 1.0);
            vec3 fold = vec3(0.016, 0.02, 0.006);
            vec3 body = vec3(0.1, 0.12, 0.032);
            vec3 crown = vec3(0.4, 0.41, 0.15);
            vec3 sc = mix(fold, body, smoothstep(0.0, 0.45, lit) * (0.3 + 0.7 * hgt));
            sc = mix(sc, crown, smoothstep(0.4, 1.0, lit) * (0.4 + 0.6 * hgt));
            // Deep inside the heap it's dark whatever the light (self-shadow).
            sc *= mix(1.0, 0.35, smoothstep(0.08, 0.35, d));
            sc *= uSky * uHeat;
            // Thin margins scatter: greyer, paler and translucent.
            float thinM = 1.0 - smoothstep(0.0, 0.18, d);
            sc = mix(sc, vec3(0.2, 0.21, 0.17) * uSky * uHeat * (0.4 + 0.6 * lit), thinM * 0.55);
            a *= mix(1.0, 0.6, thinM);
            // A faint bilious glow deep in the heap.
            sc += vec3(0.08, 0.1, 0.01) * core * smoothstep(0.1, 0.4, d);
            col += T * a * sc;` : smoke ? `
            float a = 1.0 - exp(-dens * 7.5 * dt);
            // Billowing soot: near-black folds, sky-lit grey crowns, the
            // underside glowing from the fire beneath.
            float nU, cU;
            float dUp = field(p + vec3(0.04, 0.2, 0.02), nU, cU);
            float lit = exp(-max(dUp, 0.0) * 4.0);
            // Curling billows: crowns catch the sky (warm grey), folds sink to
            // soot, and the whole underside glows from the fire boiling below
            // it, the glow reaching up into the folds between the lobes.
            float curl = smoothstep(0.35, 0.85, n);
            vec3 sc = mix(vec3(0.006, 0.005, 0.005), vec3(0.075, 0.068, 0.062), lit * (0.2 + 0.8 * curl));
            sc += uSky * clamp(p.y * 1.2 + 0.1, 0.0, 1.0) * lit * curl * 0.22;
            float under = clamp(0.5 - p.y * 0.9, 0.0, 1.0);
            sc += vec3(1.0, 0.3, 0.04) * uHeat * under * (0.35 + 0.65 * (1.0 - lit)) * (0.6 + 0.8 * (1.0 - curl)) * 0.75;
            col += T * a * sc;` : `
            // Hotter the deeper into a billow (d) and toward the heart; the soot
            // is only a thin cool skin over the folds between lobes.
            float temp = uHeat * (0.2 + core * 0.8 + n * 0.6 + min(d, 0.3) * 1.2) - uSmoke * (1.0 - core) * (1.0 - n) * 0.55;
            // Soot is opaque and crisp; flame is a translucent emitter, the
            // hottest gas the clearest, so the white heart shows through the
            // orange billows instead of being buried under the rim.
            float hot = smoothstep(0.1, 0.55, temp);
            float sigma = mix(22.0, mix(13.0, 5.5, smoothstep(0.9, 1.4, temp)), hot);
            float a = 1.0 - exp(-dens * sigma * dt);
            // Sooty rim: near-black in the folds, a little grey on sky-lit crowns.
            vec3 soot = mix(vec3(0.006, 0.005, 0.005), vec3(0.13, 0.11, 0.1), n * n * n);
            soot += uSky * clamp(p.y * 1.2 + 0.1, 0.0, 1.0) * 0.5 * n * n;
            vec3 e = vec3(0.4, 0.045, 0.008) * smoothstep(0.08, 0.3, temp);
            e = mix(e, vec3(1.0, 0.26, 0.03) * 0.75, smoothstep(0.28, 0.52, temp));
            e = mix(e, vec3(1.0, 0.5, 0.1) * 1.0, smoothstep(0.52, 0.85, temp));
            e = mix(e, vec3(1.0, 0.74, 0.36) * 1.25, smoothstep(0.95, 1.35, temp));
            e = mix(e, vec3(1.0, 0.93, 0.78) * 1.7, smoothstep(1.45, 1.9, temp));
            // Rolling flame front: billow crowns burn bright, the creases between
            // them sink into deep, sooty red (reads as crisp 3D lobes, not a blur).
            float crest = smoothstep(0.35, 0.85, n);
            e *= mix(0.16, 1.2, crest) + smoothstep(1.0, 1.4, temp) * 0.35;
            e = mix(e * vec3(0.9, 0.42, 0.25), e, crest);
            // Soot near the cool edge picks up the fire's own glow from within.
            soot += vec3(0.9, 0.25, 0.04) * clamp(uHeat, 0.0, 1.0) * 0.2 * smoothstep(0.0, 0.25, temp);
            vec3 sc = mix(soot, e, smoothstep(0.08, 0.3, temp));
            col += T * a * sc;`}
            T *= 1.0 - a;
            if (T < 0.015) break;
          }
        }
        float A = (1.0 - T) * uFade;
        ${!smoke ? `
        // Crisp billow surfaces: refine the first entry point, take the field's
        // gradient as a normal and shade it like a lit, self-emitting surface —
        // hot where a crown faces the lens, cooling to soot at silhouettes and
        // in the creases between lobes (the GoW/BG3 read), over the volume.
        if (hit > 0.5) {
          vec3 a0 = pPrev; vec3 b0 = pHit; float nn, cc;
          for (int j = 0; j < 4; j++) { vec3 m = 0.5 * (a0 + b0); if (field(m, nn, cc) > 0.0) b0 = m; else a0 = m; }
          float nH, cH;
          float dH = field(b0, nH, cH);
          float e = 0.035 * max(uGrow, 0.2);
          vec3 Ng = vec3(field(b0 + vec3(e, 0.0, 0.0), nn, cc) - dH, field(b0 + vec3(0.0, e, 0.0), nn, cc) - dH, field(b0 + vec3(0.0, 0.0, e), nn, cc) - dH);
          vec3 Nn = -normalize(Ng + 1e-5);
          float facing = clamp(dot(Nn, -rd), 0.0, 1.0);
          float fl = vn(b0 * uFreq * 7.0 + vec3(0.0, -uAge * 3.0, uSeed)) - 0.5;
          float smk = uSmoke * smoothstep(-0.15, 0.55, b0.y) * (1.0 - nH);
          float tS = uHeat * (0.45 + cH * 1.0 + nH * 0.9 + fl * 0.35) * (0.45 + 0.55 * sqrt(facing)) + uHeat * pow(facing, 3.0) * cH * 0.5 - smk * 0.9;
          vec3 eS = vec3(0.35, 0.04, 0.008) * smoothstep(0.08, 0.3, tS);
          eS = mix(eS, vec3(1.0, 0.24, 0.03) * 0.8, smoothstep(0.28, 0.5, tS));
          eS = mix(eS, vec3(1.0, 0.48, 0.09) * 1.05, smoothstep(0.5, 0.82, tS));
          eS = mix(eS, vec3(1.0, 0.72, 0.32) * 1.3, smoothstep(0.85, 1.2, tS));
          eS = mix(eS, vec3(1.0, 0.92, 0.74) * 1.7, smoothstep(1.3, 1.7, tS));
          float crease = smoothstep(0.12, 0.75, nH);
          ${gas ? `
          // Vapour: sunlit crowns, a self-shadowed olive underside, creases in
          // shade; silhouettes stay pale and thin (the volume's alpha keeps
          // the rims translucent).
          vec3 Ld = normalize(vec3(0.6, 0.9, 0.35));
          float lit = clamp(dot(Nn, Ld), 0.0, 1.0);
          float hg = clamp(b0.y * 1.3 + 0.35, 0.0, 1.0);
          float sh = lit * (0.25 + 0.75 * hg) * mix(0.35, 1.0, crease);
          vec3 cS = mix(vec3(0.012, 0.016, 0.004), vec3(0.11, 0.14, 0.03), smoothstep(0.02, 0.35, sh));
          cS = mix(cS, vec3(0.36, 0.4, 0.1), smoothstep(0.3, 0.65, sh));
          cS = mix(cS, vec3(0.75, 0.74, 0.38), smoothstep(0.65, 1.0, sh));
          cS = mix(cS, vec3(0.3, 0.32, 0.24) * (0.4 + 0.6 * lit), (1.0 - facing) * 0.35);
          cS *= uSky * uHeat;
          cS += vec3(0.05, 0.07, 0.005) * cH;
          col = mix(col, cS * (1.0 - T), 0.85);` : `
          eS *= mix(0.2, 1.1, crease);
          vec3 sootS = vec3(0.012, 0.009, 0.008) + uSky * max(Nn.y, 0.0) * 0.35 * crease + vec3(0.6, 0.16, 0.03) * clamp(uHeat, 0.0, 1.0) * 0.12 * (1.0 - facing);
          vec3 cS = mix(sootS, eS, smoothstep(0.1, 0.3, tS));
          col = mix(col, cS * (1.0 - T), ${glow ? '0.62' : '0.8'});`}
        }` : ''}
        ${glow ? `
        // Emissive explosion: the flame is light, not a solid. Soot is dropped
        // to a faint smoky veil and the coverage is cut, so the result adds
        // onto the scene (white-yellow heart, orange falloff, soft margins)
        // and the victims inside stay visible through the burn.
        float lumC = max(col.r, max(col.g, col.b));
        A *= ${glow.toFixed(2)} * (0.55 + 0.45 * smoothstep(0.05, 0.6, lumC));
        col *= 1.25;` : ''}
        gl_FragColor = vec4(col * uFade, A);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
  mesh.renderOrder = smoke || gas ? 8 : 9;
  mesh.frustumCulled = false;
  const inv = new THREE.Matrix4();
  return {
    obj: mesh,
    u: mat.uniforms,
    /** Call after positioning/scaling: camera into object space, ground height, victims ({pos, h}[]). */
    sync(camera, groundY = 0, victims = null) {
      mesh.updateMatrixWorld(true);
      inv.copy(mesh.matrixWorld).invert();
      if (camera) mat.uniforms.uCam.value.copy(camera.position).applyMatrix4(inv);
      mat.uniforms.uFloor.value = (groundY - mesh.position.y) / mesh.scale.y;
      const U = mat.uniforms.uVic.value;
      for (let k = 0; k < 6; k++) {
        const v = victims?.[k];
        if (!v) {
          U[k].w = 0;
          continue;
        }
        _vc.set(v.pos.x, v.pos.y + v.h * 0.5, v.pos.z).applyMatrix4(inv);
        U[k].set(_vc.x, _vc.y, _vc.z, 0.36 / mesh.scale.x);
        mat.uniforms.uVicH.value[k] = (v.h * 0.55) / mesh.scale.y;
      }
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

/**
 * Lobe layout for a fire/smoke volume (centres in units of the grow radius,
 * w = lobe radius): a fat heart, a ring of billows around it, a couple riding
 * the crown. Smoke lobes are flatter and wider (a mushrooming cap).
 */
function fireLobes(seed, smoke = false) {
  const out = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + hashf(seed * 7.1 + i) * 0.9;
    const up = i < 6 ? (hashf(seed * 3.3 + i * 1.7) - 0.4) * 0.7 : 0.55 + hashf(seed + i) * 0.25;
    const rr = i < 6 ? 0.46 + hashf(seed * 1.9 + i * 2.3) * 0.08 : 0.2 + hashf(seed * 2.1 + i) * 0.15;
    const ang = i < 6 ? a : a * 1.7;
    const v = new THREE.Vector3(Math.cos(ang) * rr, up * (smoke ? 0.45 : 1), Math.sin(ang) * rr);
    const w = (i < 6 ? 0.34 + hashf(seed * 5.7 + i) * 0.12 : 0.3 + hashf(seed * 4.9 + i) * 0.1) * (smoke ? 1.05 : 1);
    // Keep every lobe inside the march sphere at full growth.
    const lim = 0.9 - w;
    if (v.length() > lim) v.setLength(lim);
    out.push(new THREE.Vector4(v.x, v.y, v.z, w));
  }
  return out;
}

/**
 * Ground-hugging gas (stinking cloud): a flattened box ray-marched through a
 * slowly curling, domain-warped fBm. Density falls off with height and with
 * distance from the centre, and the rim tears into tendrils that spill across
 * the neighbouring squares. Lit, not emissive: each sample takes a short
 * shadow probe toward the key light, so lobes self-shadow (olive folds, sickly
 * yellow-green crowns, pale back-lit rims). Opacity is capped so figures
 * inside stay visible at 50-70% obscurity. Premultiplied output.
 */
function gasVolume({ steps = 26 } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uCam: { value: new THREE.Vector3(0, 5, 5) }, uAge: { value: 0 }, uSeed: { value: 0 }, uFade: { value: 1 },
      uHalf: { value: new THREE.Vector3(3, 1, 3) }, uLightDir: { value: new THREE.Vector3(0.4, 0.85, 0.3).normalize() },
      uKey: { value: new THREE.Color(1, 0.94, 0.8) }, uAmb: { value: new THREE.Color(0.33, 0.38, 0.44) }, uMaxA: { value: 0.72 },
    },
    vertexShader: 'varying vec3 vO; void main(){ vO = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uCam, uHalf, uLightDir, uKey, uAmb; uniform float uAge, uSeed, uFade, uMaxA;
      varying vec3 vO;
      float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
      // Density at world-scaled local position q (metres from centre, y up from the ground).
      float dens(vec3 q){
        float a = uAge;
        // Slow curl: two counter-rotating warps at billow scale.
        vec3 w = vec3(vn(q * 0.42 + vec3(0.0, a * 0.12, uSeed)), vn(q * 0.42 + vec3(5.2, -a * 0.1, uSeed + 3.1)), vn(q * 0.42 + vec3(1.7, a * 0.08, uSeed + 7.7)));
        vec3 p = q * vec3(0.95, 1.25, 0.95) + (w - 0.5) * 1.5 + vec3(a * 0.05, -a * 0.04, -a * 0.03);
        // Churning: the mass rolls slowly upward and over, so it heaves.
        p += vec3(sin(q.y * 1.3 + a * 0.35) * 0.35, -a * 0.16, cos(q.y * 1.1 - a * 0.3) * 0.35);
        // Rounded billows (cauliflower lumps), a smaller octave riding on them,
        // a fine curl at the rim — big readable forms, not a fuzzy felt.
        float b1 = vn(p), b2 = vn(p * 2.1 + 3.3), b3 = vn(p * 4.3 + 7.9 - vec3(0.0, a * 0.3, 0.0));
        float n = smoothstep(0.22, 0.78, b1) * 0.62 + smoothstep(0.3, 0.72, b2) * 0.3 + b3 * 0.08;
        vec2 e = q.xz / uHalf.xz;
        float tear = vn(vec3(q.xz * 0.8, a * 0.08 + uSeed)) - 0.5;
        float r = length(e) + tear * 0.5;
        float reach = 1.0 - smoothstep(0.3, 0.82, r);
        float lump = smoothstep(0.35, 0.8, vn(vec3(q.xz * 0.6, a * 0.05 + uSeed + 2.0)));
        float top = 0.55 + (0.8 + 1.0 * lump) * (0.4 + 0.6 * n) * reach;
        // Thinner right at the cobbles so legs and rings stay readable.
        float hf = smoothstep(top, top * 0.5, q.y) * mix(0.45, 1.0, smoothstep(0.05, 0.6, q.y));
        float body = (n - 0.5 + reach * 0.3) * hf * reach;
        // Ground-hugging haze spilling a little past the billows.
        float haze = (1.0 - smoothstep(0.0, 0.4, q.y)) * (1.0 - smoothstep(0.55, 1.15, r)) * (0.45 + 0.55 * vn(q * 1.4 + vec3(a * 0.12, 0.0, uSeed))) * 0.2;
        // Never touch the march volume's faces: the gas dies away well inside
        // the box on every side and under its lid (no straight edges, ever).
        float er = length(e) + (vn(vec3(q.xz * 0.9, uSeed + a * 0.06)) - 0.5) * 0.3;
        float edge = (1.0 - smoothstep(0.5, 0.86, er)) * (1.0 - smoothstep(0.55, 0.95, max(abs(e.x), abs(e.y)))) * (1.0 - smoothstep(uHalf.y * 0.5, uHalf.y * 0.85, q.y + (vn(q * 1.3 + 4.0) - 0.5) * 0.5));
        return clamp(max(body * 5.0, haze) * edge, 0.0, 1.0);
      }
      void main(){
        vec3 ro = uCam;
        vec3 rd = normalize(vO - uCam);
        // Ray vs. unit box (object space), then march in metres.
        vec3 inv = 1.0 / rd;
        vec3 ta = (-1.0 - ro) * inv, tb = (1.0 - ro) * inv;
        vec3 tmin = min(ta, tb), tmax = max(ta, tb);
        float t0 = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
        float t1 = min(min(tmax.x, tmax.y), tmax.z);
        if (t1 <= t0) discard;
        const int N = ${steps};
        float dt = (t1 - t0) / float(N);
        float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 col = vec3(0.0); float T = 1.0;
        vec3 Ls = normalize(uLightDir / uHalf);
        for (int i = 0; i < N; i++) {
          vec3 po = ro + rd * (t0 + (float(i) + jit) * dt);
          vec3 q = vec3(po.x, po.y + 1.0, po.z) * uHalf;
          q.y *= 0.5;
          float d = dens(q);
          if (d > 0.002) {
            float stepM = dt * length(rd * uHalf);
            float a = 1.0 - exp(-d * 1.35 * stepM);
            // Self-shadow: two probes toward the key light.
            float s1 = dens(q + uLightDir * 0.32);
            float lit = exp(-s1 * 5.2);
            float hgt = clamp(q.y / 1.5, 0.0, 1.0);
            vec3 fold = vec3(0.03, 0.035, 0.008);
            vec3 body = vec3(0.24, 0.27, 0.05);
            vec3 crown = vec3(0.62, 0.64, 0.22);
            vec3 alb = mix(fold, body, smoothstep(0.03, 0.5, lit));
            alb = mix(alb, crown, smoothstep(0.5, 1.0, lit) * (0.45 + 0.55 * hgt));
            // Dense dark folds pool at the base of the mass.
            alb *= mix(0.55, 1.0, smoothstep(0.0, 0.7, q.y) * smoothstep(0.0, 0.4, lit) + (1.0 - smoothstep(0.0, 0.3, d)) * 0.4);
            // Thin margins scatter more: lighter, greyer, translucent rims.
            alb = mix(alb, vec3(0.5, 0.54, 0.36), (1.0 - smoothstep(0.0, 0.3, d)) * 0.45 * lit);
            // Upper wisps age to a sour grey.
            alb = mix(alb, vec3(0.36, 0.37, 0.32) * (0.5 + 0.6 * lit), smoothstep(0.45, 1.0, hgt) * 0.45);
            // Crowns take the key light's colour (sun, moon or torch), with a
            // bright silver lining where they are thin and back-lit.
            float lining = lit * (1.0 - smoothstep(0.05, 0.4, d));
            vec3 c = alb * (uKey * (0.18 + 1.15 * lit) + uAmb * (0.45 + 0.45 * hgt)) + uKey * lining * 0.16;
            // A faint sickly glow deep in the core, pulsing like breath.
            float coreK = (1.0 - smoothstep(0.0, 0.7, length(q.xz / uHalf.xz))) * (1.0 - smoothstep(0.2, 1.3, q.y)) * smoothstep(0.1, 0.5, d);
            // The sickly yellow-green heart (bile), brightest deep in the mass.
            c += vec3(0.42, 0.5, 0.05) * coreK * (0.75 + 0.25 * sin(uAge * 1.7 + uSeed));
            col += T * a * c;
            T *= 1.0 - a;
            if (T < 0.02) break;
          }
        }
        float A = min(1.0 - T, uMaxA) * uFade;
        col *= A / max(1.0 - T, 0.0001);
        gl_FragColor = vec4(col, A);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  mesh.renderOrder = 8;
  mesh.frustumCulled = false;
  const inv = new THREE.Matrix4();
  return {
    obj: mesh,
    u: mat.uniforms,
    /** Footprint half-extents (m) and height (m); the box sits on the ground. */
    place(x, z, hx, hy, hz) {
      mesh.position.set(x, hy, z);
      mesh.scale.set(hx, hy, hz);
      mat.uniforms.uHalf.value.set(hx, hy * 2, hz);
    },
    sync(camera) {
      mesh.updateMatrixWorld(true);
      inv.copy(mesh.matrixWorld).invert();
      if (camera) mat.uniforms.uCam.value.copy(camera.position).applyMatrix4(inv);
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

/**
 * Ember sparks rendered as velocity-stretched screen-space streaks (a quad from
 * the spark's position a moment ago to now), analytic so they freeze cleanly.
 */
function sparkStreaks(o) {
  const n = o.count ?? 60;
  const seed = o.seed ?? 1;
  const pos = new Float32Array(n * 4 * 3);
  const vel = new Float32Array(n * 4 * 3);
  const dat = new Float32Array(n * 4 * 4);
  const corner = new Float32Array(n * 4 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const r = (k) => hashf(seed * 53.1 + i * 17.7 + k * 3.3);
    const th = r(1) * Math.PI * 2;
    const up = o.hemi ? 0.15 + r(2) * 0.85 : r(2) * 2 - 1;
    const hor = Math.sqrt(Math.max(0, 1 - up * up));
    const s = (o.speed ?? 8) * (0.35 + r(3) * 0.65);
    const v = [Math.cos(th) * hor * s, up * s * (o.up ?? 1), Math.sin(th) * hor * s];
    const start = [o.at.x + Math.cos(th) * hor * (o.r0 ?? 0.2), o.at.y + up * (o.r0 ?? 0.2), o.at.z + Math.sin(th) * hor * (o.r0 ?? 0.2)];
    const d = [(o.delay ?? 0) + r(4) * (o.stagger ?? 0), (o.life ?? 1) * (0.5 + r(5) * 0.5), (o.width ?? 2.5) * (0.6 + r(6) * 0.8), r(7)];
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      pos.set(start, j * 3);
      vel.set(v, j * 3);
      dat.set(d, j * 4);
      corner.set([k < 2 ? 0 : 1, k % 2 ? 1 : -1], j * 2);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dat, 4));
  g.setAttribute('aC', new THREE.BufferAttribute(corner, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uAge: { value: 0 }, uDrag: { value: o.drag ?? 1.4 }, uGrav: { value: o.gravity ?? 7 }, uRes: { value: new THREE.Vector2(1600, 900) }, uStreak: { value: o.streak ?? 0.06 }, uFloor: { value: o.floor ?? 0.03 }, uI: { value: o.intensity ?? 2.5 } },
    vertexShader: `
      attribute vec3 aV; attribute vec4 aD; attribute vec2 aC;
      uniform float uAge, uDrag, uGrav, uStreak, uFloor; uniform vec2 uRes;
      varying float vLife; varying float vAcross; varying float vAlong;
      vec3 P(float t){ float k = (1.0 - exp(-uDrag * t)) / uDrag; vec3 p = position + aV * k; p.y -= 0.5 * uGrav * t * t; p.y = max(p.y, uFloor); return p; }
      void main(){
        float t = uAge - aD.x;
        float life = t / aD.y;
        vLife = life; vAcross = aC.y; vAlong = aC.x;
        if (t <= 0.0 || life >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec4 h = projectionMatrix * modelViewMatrix * vec4(P(t), 1.0);
        vec4 tl = projectionMatrix * modelViewMatrix * vec4(P(max(0.0, t - uStreak)), 1.0);
        vec2 hs = h.xy / h.w; vec2 ts = tl.xy / tl.w;
        vec2 dir = hs - ts; float L = length(dir * uRes);
        dir = L > 0.5 ? normalize(dir * uRes) : vec2(1.0, 0.0);
        vec2 nrm = vec2(-dir.y, dir.x);
        vec4 c = aC.x > 0.5 ? h : tl;
        float w = aD.z * (1.0 - life * 0.6);
        c.xy += nrm * aC.y * w / uRes * c.w;
        if (aC.x > 0.5) c.xy += dir * w * 0.5 / uRes * c.w;
        gl_Position = c;
      }`,
    fragmentShader: `
      uniform float uI; varying float vLife; varying float vAcross; varying float vAlong;
      void main(){
        float a = (1.0 - abs(vAcross)) * mix(0.15, 1.0, vAlong) * (1.0 - smoothstep(0.5, 1.0, vLife));
        vec3 c = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.3, 0.04), smoothstep(0.0, 0.5, vLife));
        gl_FragColor = vec4(c * uI, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  const life = (o.delay ?? 0) + (o.stagger ?? 0) + (o.life ?? 1) + 0.05;
  return {
    obj: mesh,
    life,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      if (ctx.res) mat.uniforms.uRes.value.copy(ctx.res);
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/** Camera-facing tapered trail through a list of points (comet tails). */
function taperTrail(n, colorHead, colorTail, width) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uHead: { value: new THREE.Color(colorHead) }, uTail: { value: new THREE.Color(colorTail) }, uA: { value: 1 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform vec3 uHead, uTail; uniform float uA, uT;
      void main(){
        float u = vUv.x; // 0 = head, 1 = tail end
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float flick = fbm3(vec3(u * 6.0 - uT * 9.0, vUv.y * 3.0, uT)) * 0.5 + 0.5;
        float core = smoothstep(0.5, 1.0, across) * (1.0 - u);
        vec3 c = mix(uHead, uTail, smoothstep(0.0, 0.7, u)) * (1.0 + core * 1.5);
        float a = smoothstep(0.0, 0.7, across) * pow(1.0 - u, 1.4) * (0.55 + flick * 0.6) * uA;
        gl_FragColor = vec4(c * 1.6, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  const _d = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  return {
    obj: mesh,
    /** pts[0] = head. */
    set(pts, camPos) {
      for (let i = 0; i < n; i++) {
        const p = pts[Math.min(i, pts.length - 1)];
        const q = pts[Math.min(i + 1, pts.length - 1)];
        const o = pts[Math.max(i - 1, 0)];
        _d.subVectors(o, q).normalize();
        _v.subVectors(camPos, p).normalize();
        _s.crossVectors(_d, _v).normalize().multiplyScalar(width * (1 - (i / (n - 1)) * 0.85));
        pos.set([p.x - _s.x, p.y - _s.y, p.z - _s.z, p.x + _s.x, p.y + _s.y, p.z + _s.z], i * 6);
      }
      g.attributes.position.needsUpdate = true;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/**
 * Tall billboarded flame tongues (cylindrical billboards, rotate about Y only):
 * noise-licked teardrops with a white-yellow root, orange body and red-black
 * tips, each a pure function of age. Gives a blast vertical mass from a 3/4 view.
 */
function flameTongues(n, seed) {
  const pos = [];
  const uv = [];
  const off = [];
  const dat = [];
  const idx = [];
  for (let i = 0; i < n; i++) {
    const r = (k) => hashf(seed * 31.7 + i * 7.3 + k * 1.9);
    const a = r(1) * Math.PI * 2;
    const rr = Math.sqrt(r(2));
    for (let k = 0; k < 4; k++) {
      pos.push(0, 0, 0);
      uv.push(k % 2, k < 2 ? 0 : 1);
      off.push(Math.cos(a) * rr, Math.sin(a) * rr);
      dat.push(r(3), 0.3 + r(4) * r(4) * 1.4, r(5) * 0.3, 0.5 + r(6) * 0.7);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2));
  g.setAttribute('aD', new THREE.Float32BufferAttribute(dat, 4));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Premultiplied "over": overlapping tongues occlude rather than stacking to white.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
    uniforms: { uAge: { value: 0 }, uR: { value: 3 }, uH: { value: 2.5 }, uLife: { value: 1.4 }, uA: { value: 1 }, uCam: { value: new THREE.Vector3() } },
    vertexShader: `
      attribute vec2 aOff; attribute vec4 aD;
      uniform float uAge, uR, uH, uLife; uniform vec3 uCam;
      varying vec2 vUv; varying vec4 vD; varying float vK;
      void main(){
        vUv = uv; vD = aD;
        float t = uAge - aD.z;
        float u = clamp(t / (uLife * aD.w), 0.0, 1.0);
        // Tongues shoot up fast with the blast, lick outward, then shrink and fade.
        float grow = t <= 0.0 ? 0.0 : (1.0 - exp(-t * 11.0)) * (1.0 - smoothstep(0.45, 1.0, u));
        vK = t <= 0.0 || u >= 1.0 ? 0.0 : 1.0 - smoothstep(0.55, 1.0, u);
        float spread = uR * (0.35 + 0.65 * (1.0 - exp(-t * 6.0)));
        vec3 base = (modelMatrix * vec4(aOff.x * spread, 0.0, aOff.y * spread, 1.0)).xyz;
        float h = uH * aD.y * grow * (1.0 - length(aOff) * 0.45);
        float w = h * 0.5 + 0.15 * grow;
        vec3 toCam = uCam - base; toCam.y = 0.0; toCam = normalize(toCam);
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        vec3 p = base + right * (uv.x - 0.5) * w + vec3(0.0, uv.y * h, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uAge, uA; varying vec2 vUv; varying vec4 vD; varying float vK;
      void main(){
        if (vK <= 0.0) discard;
        // Classic licking flame: a teardrop (wide belly, tapering tip) warped by
        // rising noise, with soft edges and a temperature ramp root → tip.
        vec2 q = vec2((vUv.x - 0.5) * 2.0, vUv.y);
        float n = fbm3(vec3(q.x * 1.4 + vD.x * 13.0, q.y * 1.8 - uAge * 3.4, vD.x * 7.0)) * 0.5 + 0.5;
        float n2 = fbm3(vec3(q.x * 3.2, q.y * 3.6 - uAge * 5.5, vD.x * 3.0 + 4.0)) * 0.5 + 0.5;
        q.x += (n - 0.5) * 1.3 * q.y + sin(q.y * 5.0 + vD.x * 20.0 - uAge * 6.0) * 0.12 * q.y;
        float wid = mix(0.95, 0.32, pow(q.y, 0.6)) * (0.75 + 0.5 * n);
        float d = length(vec2(q.x / wid, (q.y - 0.3) * 1.3)) + (n2 - 0.5) * 0.5;
        float fire = (1.0 - smoothstep(0.1, 1.0, d)) * (0.25 + n2 * 0.95) - q.y * 0.45;
        fire = clamp(fire * 1.1, 0.0, 1.0) * vK;
        float alpha = smoothstep(0.08, 0.6, fire);
        vec3 c = mix(vec3(0.35, 0.04, 0.01), vec3(0.95, 0.3, 0.05), smoothstep(0.1, 0.45, fire));
        c = mix(c, vec3(1.0, 0.6, 0.18), smoothstep(0.5, 0.85, fire));
        float A = alpha * uA * 0.8;
        gl_FragColor = vec4(c * 0.9 * A, A * 0.7);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return {
    obj: mesh,
    u: mat.uniforms,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      if (ctx.camera) mat.uniforms.uCam.value.copy(ctx.camera.position);
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

/** Expanding ground ring (shockwave / pulses). */
/**
 * Smouldering embers scattered over a scorch: tiny additive points that flare
 * and dim on their own rhythm, cooling from yellow-orange to dull red over
 * ~10 s (never fully out while the battle lasts). Pure function of age.
 */
function emberBed(at, radius, seed = 1, count = 90) {
  const pos = new Float32Array(count * 3);
  const dat = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const a = hashf(seed * 3.1 + i * 1.7) * Math.PI * 2;
    const r = Math.sqrt(hashf(seed * 5.3 + i * 2.9)) * radius;
    pos.set([at.x + Math.cos(a) * r, 0.05 + hashf(i * 7.7 + seed) * 0.04, at.z + Math.sin(a) * r], i * 3);
    dat.set([hashf(seed + i * 11.3), 0.03 + hashf(seed * 2 + i * 4.1) * 0.06], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aD', new THREE.BufferAttribute(dat, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAge: { value: 0 }, uPix: { value: 600 } },
    vertexShader: `attribute vec2 aD; uniform float uAge, uPix; varying float vF; varying float vH;
      void main(){ float fl = 0.55 + 0.45 * sin(uAge * (1.5 + aD.x * 4.0) + aD.x * 60.0) * sin(uAge * (0.7 + aD.x * 2.0) + aD.x * 13.0);
        float cool = exp(-uAge * (0.12 + aD.x * 0.2));
        vF = fl * smoothstep(0.0, 0.25, uAge) * (0.25 + 0.75 * cool); vH = cool;
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aD.y * (0.7 + 0.6 * fl) * uPix / max(0.1, -mv.z); }`,
    fragmentShader: `varying float vF; varying float vH;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float d = 1.0 - smoothstep(0.15, 1.0, r); if (d <= 0.0) discard;
        vec3 c = mix(vec3(1.0, 0.18, 0.03), vec3(1.0, 0.62, 0.2), vH * vF) * 2.4;
        gl_FragColor = vec4(c * d * vF, d * vF); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return {
    obj: pts,
    update(age, ctx) {
      mat.uniforms.uAge.value = age;
      mat.uniforms.uPix.value = ctx.pix;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}

function groundRing(color, soft = 0.2) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uR: { value: 0.5 }, uW: { value: 0.15 }, uA: { value: 1 }, uColor: { value: new THREE.Color(color) }, uSoft: { value: soft } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uR, uW, uA, uSoft; uniform vec3 uColor;
      void main(){ float r = length(vUv * 2.0 - 1.0); float k = 1.0 - smoothstep(0.0, uW, abs(r - uR));
        float inner = smoothstep(uR, 0.0, r) * uSoft;
        gl_FragColor = vec4(uColor * 2.0, (k + inner) * uA); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 5;
  return m;
}

/**
 * Fireball ground shockwave (unit plane, scaled by the caller): `hot` = the
 * thin additive leading edge, otherwise a torn ring of kicked-up dust that
 * trails inward behind it. uR = edge radius in plane units (0..1).
 */
function shockRing(hot) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uR: { value: 0.5 }, uA: { value: 1 }, uAge: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uR, uA, uAge;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn2(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); float an = atan(p.y, p.x);
        float tear = vn2(vec2(an * 6.0, uAge * 0.5)) * 0.6 + vn2(vec2(an * 17.0, 3.0)) * 0.4;
        float d = r - uR;
        ${hot ? `
        float k = exp(-abs(d) * 120.0) * (0.55 + 0.45 * tear);
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * 1.6 * k * uA, 1.0);` : `
        // Dust: thickest just behind the edge, thinning inward in streaks.
        float edgeN = (vn2(vec2(an * 9.0, uAge)) - 0.5) * 0.06;
        float band = smoothstep(0.03, -0.02, d + edgeN) * exp(min(d + edgeN, 0.0) * 6.5);
        float streak = vn2(vec2(an * 22.0, r * 6.0 - uAge * 2.0));
        float clump = vn2(p * 7.0 + uAge * 0.3);
        float a = band * (0.3 + 0.7 * tear) * (0.45 + 0.55 * streak) * (0.6 + 0.6 * clump) * smoothstep(1.0, 0.9, r);
        vec3 c = mix(vec3(0.26, 0.22, 0.18), vec3(0.52, 0.43, 0.33), streak * clump);
        gl_FragColor = vec4(c, a * uA);`}
      }`,
  });
  if (hot) {
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  m.renderOrder = hot ? 6 : 3;
  m.frustumCulled = false;
  return m;
}

/** Soft billboard puff with churning noise (clouds, smoke). */
function puff(color, seed) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uA: { value: 0.5 }, uSeed: { value: seed } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      mv.xy += position.xy * sc; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform float uT, uA, uSeed; uniform vec3 uColor;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float n = fbm3(vec3(p * 1.8, uT * 0.25 + uSeed)) * 0.5 + 0.5;
        float n2 = fbm3(vec3(p * 4.0 + 3.0, uT * 0.4 + uSeed * 2.0)) * 0.5 + 0.5;
        float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.8) * (0.55 + n2 * 0.6);
        vec3 c = uColor * (0.7 + n * 0.6);
        gl_FragColor = vec4(c, a * uA); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 9;
  m.frustumCulled = false;
  return m;
}

/**
 * A lit puff of gas: a camera-facing disc shaded as a soft sphere (crown lit
 * from above-front, olive folds underneath), its rim eroded by churning noise;
 * `core` adds the sickly yellow glow of the cloud's heart.
 */
function gasPuff(seed, core = 0) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uA: { value: 0.45 }, uSeed: { value: seed }, uCore: { value: core }, uLight: { value: 1 }, uCool: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
      vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      mv.xy += position.xy * sc; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec2 vUv; uniform float uT, uA, uSeed, uCore, uLight, uCool;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float n = fbm3(vec3(p * 1.6, uT * 0.18 + uSeed)) * 0.5 + 0.5;
        float n2 = fbm3(vec3(p * 3.6 + 3.0, uT * 0.3 + uSeed * 2.0)) * 0.5 + 0.5;
        // Lumpy silhouette: the disc is pushed out into cauliflower lobes.
        float r = length(p) * (1.0 + (n - 0.5) * 0.8);
        if (r > 1.0) discard;
        vec3 N = normalize(vec3(p * 1.1, sqrt(max(0.0, 1.0 - r * r))));
        vec3 L = normalize(vec3(-0.35, 0.82, 0.45));
        float lit = clamp(dot(N, L) * 0.9 + 0.12 + (n2 - 0.5) * 0.45, 0.0, 1.0);
        vec3 fold = vec3(0.035, 0.042, 0.01);
        vec3 body = vec3(0.3, 0.34, 0.06);
        vec3 crown = vec3(0.72, 0.74, 0.3);
        vec3 c = mix(fold, body, smoothstep(0.0, 0.55, lit));
        c = mix(c, crown, smoothstep(0.55, 1.0, lit));
        c += vec3(0.4, 0.46, 0.05) * uCore * (1.0 - r) * (0.7 + 0.3 * n2);
        c = mix(c * uLight, c * uLight * vec3(0.55, 0.65, 0.95), uCool);
        float a = smoothstep(1.0, 0.62, r) * (0.62 + 0.55 * n2 * n) * uA;
        gl_FragColor = vec4(c, a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 9;
  m.frustumCulled = false;
  return m;
}

/** Glowing ribbon through points (lightning, trails). Cross-shaped so it reads from any angle. */
function ribbon(points, width, color) {
  const pos = [];
  const uv = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const planeAxis of [0, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[Math.min(points.length - 1, i + 1)];
      const o = points[Math.max(0, i - 1)];
      const dir = new THREE.Vector3().subVectors(q, o).normalize();
      const side = planeAxis === 0 ? new THREE.Vector3().crossVectors(dir, up).normalize() : up.clone();
      side.multiplyScalar(width);
      pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
      uv.push(i / (points.length - 1), 0, i / (points.length - 1), 1);
      if (i < points.length - 1) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uA;
      void main(){ float a = 1.0 - abs(vUv.y - 0.5) * 2.0; float core = smoothstep(0.6, 1.0, a);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), core) * (1.5 + core * 3.0), smoothstep(0.0, 1.0, a) * uA); }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 8;
  m.frustumCulled = false;
  return m;
}

function jaggedBolt(a, b, seed, rough = 0.5) {
  const pts = [a.clone()];
  const n = Math.max(6, Math.round(a.distanceTo(b) * 3));
  const dir = new THREE.Vector3().subVectors(b, a);
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  for (let i = 1; i < n; i++) {
    const u = i / n;
    const p = a.clone().lerp(b, u);
    const k = Math.sin(u * Math.PI);
    p.addScaledVector(side, (hashf(seed + i * 3.1) - 0.5) * rough * k * 1.6);
    p.y += (hashf(seed + i * 7.7) - 0.5) * rough * k;
    pts.push(p);
  }
  pts.push(b.clone());
  return pts;
}

// ------------------------------------------------------------------ manager
export class VFX {
  constructor(scene, { light } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.effects = [];
    // One pooled point light for spell flashes (constant light count → no shader recompiles).
    this.light = light ?? new THREE.PointLight(0xffa040, 0, 13, 2);
    scene.add(this.light);
    this.lightOwner = null;
    this.ctx = { pix: 600, camera: null };
    this.shake = [];
  }

  /** Register an effect composed of parts; `fn(age, parts)` animates; returns handle. */
  add(start, life, build, animate, o = {}) {
    const parts = build();
    const objs = [];
    for (const p of parts.list ?? []) {
      const obj = p.obj ?? p;
      this.group.add(obj);
      objs.push(p);
    }
    const fx = { start, life, parts, objs, animate, persistent: !!o.persistent, id: o.id, dead: false };
    this.effects.push(fx);
    return fx;
  }

  /** Camera shake impulse at time t. */
  addShake(t, amp = 0.2, dur = 0.4) {
    this.shake.push({ t, amp, dur });
  }

  shakeOffset(t) {
    const o = new THREE.Vector3();
    for (const s of this.shake) {
      const age = t - s.t;
      if (age < 0 || age > s.dur) continue;
      const k = s.amp * (1 - age / s.dur) ** 2;
      o.x += Math.sin(age * 71 + s.t * 13) * k;
      o.y += Math.sin(age * 57 + 1.3 + s.t) * k * 0.6;
      o.z += Math.sin(age * 63 + 2.1) * k;
    }
    this.shake = this.shake.filter((s) => t - s.t < s.dur + 0.05 || t < s.t);
    return o;
  }

  update(t, camera, pix, res = null) {
    this.ctx.pix = pix;
    if (res) this.ctx.res = res;
    this.ctx.camera = camera;
    let lightI = 0;
    let lightC = null;
    let lightP = null;
    let expo = 0;
    for (const fx of this.effects) {
      const age = t - fx.start;
      if (age < 0) {
        for (const p of fx.objs) (p.obj ?? p).visible = false;
        continue;
      }
      for (const p of fx.objs) (p.obj ?? p).visible = true;
      for (const p of fx.objs) p.update?.(age, this.ctx);
      const r = fx.animate?.(age, fx.parts, this.ctx);
      if (r?.exposure > expo) expo = r.exposure;
      if (r?.light && r.light.i > lightI) {
        lightI = r.light.i;
        lightC = r.light.color;
        lightP = r.light.pos;
      }
      if (!fx.persistent && age > fx.life) fx.dead = true;
    }
    /** Exposure bump requested by flashes (the scene scales tone-mapping exposure). */
    this.exposure = expo;
    this.light.intensity = lightI;
    if (lightC) this.light.color.set(lightC);
    if (lightP) this.light.position.copy(lightP);
    for (const fx of this.effects.filter((f) => f.dead)) this._remove(fx);
    this.effects = this.effects.filter((f) => !f.dead);
  }

  /** End of battle: every aura, cloud and ring goes (decals stay in the world). */
  clearLingering() {
    for (const fx of this.effects) fx.dead = true;
  }

  kill(id) {
    for (const fx of this.effects) if (fx.id === id) fx.dead = true;
  }

  /** Seconds until every transient effect (not lingering clouds) has played out. */
  busyUntil(t) {
    let m = 0;
    for (const fx of this.effects) if (!fx.persistent) m = Math.max(m, fx.start + Math.min(fx.life, 2.2) - t);
    return m;
  }

  _remove(fx) {
    for (const p of fx.objs) {
      const obj = p.obj ?? p;
      this.group.remove(obj);
      if (p.dispose) p.dispose();
      else {
        obj.traverse?.((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
      }
    }
  }

  dispose() {
    for (const fx of this.effects) this._remove(fx);
    this.effects = [];
    this.scene.remove(this.group);
    this.scene.remove(this.light);
  }

  // ---------------------------------------------------------------- recipes
  /**
   * A blow lands: velocity-streaked steel sparks, a directional spurt of blood
   * (or bone chips) thrown away from the attacker, a brief hot flash of light
   * on the figures and the setts, and an exposure kick on crits.
   * `dir` (optional) = horizontal direction of the blow.
   */
  hitSparks(t, at, { blood = true, crit = false, seed = 1, bone = false, dir = null } = {}) {
    const d = dir ? new THREE.Vector3(dir.x, 0, dir.z).normalize() : null;
    const spurtDir = d ? { x: d.x * 0.9, y: 0.45, z: d.z * 0.9 } : null;
    this.add(t, 0.9, () => ({
      list: [
        sparkStreaks({ at, count: crit ? 22 : 13, speed: crit ? 7 : 5.2, life: 0.3, gravity: 9, drag: 2.2, width: 1.7, streak: 0.04, intensity: 2.4, seed, r0: 0.05 }),
        ...(blood && !bone ? [
          particleBurst({ at, count: crit ? 26 : 14, speed: 2.2, life: 0.7, size: 0.07, drag: 1.5, gravity: 9.8, colors: [0x8a0c08, 0x5a0605, 0x2a0303], additive: false, intensity: 1, soft: 0.3, seed: seed + 7, floor: 0.02 }),
          particleBurst({ at, count: crit ? 30 : 18, speed: crit ? 4.2 : 3.2, dir: spurtDir ?? undefined, life: 0.55, size: 0.045, drag: 1.2, gravity: 9.8, colors: [0xa01410, 0x6a0806, 0x300404], additive: false, intensity: 1.1, soft: 0.25, seed: seed + 11, floor: 0.02 }),
        ] : []),
        ...(bone ? [particleBurst({ at, count: 18, speed: 2.8, dir: spurtDir ?? undefined, life: 0.8, size: 0.06, drag: 1.2, gravity: 9.8, colors: [0xe8e0c8, 0xc8b898, 0x8a7a60], additive: false, intensity: 1, soft: 0.2, seed: seed + 9, floor: 0.02 })] : []),
        glowSprite(0xffd090, crit ? 1.3 : 0.9, 0.7),
        glowSprite(0xffffff, crit ? 0.45 : 0.3, 1),
      ],
    }), (age, parts) => {
      const n = parts.list.length;
      const sp = parts.list[n - 2];
      const core = parts.list[n - 1];
      sp.position.copy(at);
      core.position.copy(at);
      const k = Math.max(0, 1 - age / 0.09);
      sp.material.opacity = k * 0.6;
      sp.scale.setScalar((crit ? 1.3 : 0.9) * (1 + age * 4));
      core.material.opacity = Math.max(0, 1 - age / 0.05);
      return { light: { i: (crit ? 60 : 32) * k * k, color: 0xffc888, pos: at }, exposure: crit ? 0.18 * k : 0.06 * k };
    });
  }

  /**
   * Melee swing smear: a crescent sheet swept by the blade — brightest along
   * the outer (tip) edge, fading to nothing toward the hilt and along the
   * tail, the head racing round in ~0.12 s and the whole smear dying by 0.3 s.
   */
  swipe(t, at, yaw, { color = 0xfff0d0, seed = 1 } = {}) {
    const N = 20;
    const r0 = 0.35;
    const r1 = 1.05;
    const pos = [];
    const uv = [];
    const idx = [];
    const tilt = (hashf(seed) - 0.5) * 0.5;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = yaw - 1.2 + u * 2.4;
      const y = at.y + 0.55 - u * 0.95;
      const cx = Math.sin(a);
      const cz = Math.cos(a);
      pos.push(at.x + cx * r0, y + tilt * 0.2, at.z + cz * r0, at.x + cx * r1, y + tilt * (u - 0.5), at.z + cz * r1);
      uv.push(u, 0, u, 1);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uHead: { value: 0 }, uA: { value: 1 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uHead, uA; uniform vec3 uColor;
        void main(){
          float behind = uHead - vUv.x;
          if (behind < 0.0) discard;
          float tail = 1.0 - smoothstep(0.0, 0.7, behind);
          float edge = pow(vUv.y, 3.0);
          float rim = smoothstep(0.86, 0.98, vUv.y) * (1.0 - smoothstep(0.98, 1.0, vUv.y));
          float a = (edge * 0.6 + rim * 0.9) * tail * uA;
          vec3 c = mix(vec3(1.0, 0.62, 0.22), uColor, tail) * (1.2 + rim * 2.5);
          gl_FragColor = vec4(c * a, 1.0);
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 8;
    m.frustumCulled = false;
    this.add(t, 0.34, () => ({ list: [m] }), (age) => {
      mat.uniforms.uHead.value = Math.min(1.25, age / 0.12);
      mat.uniforms.uA.value = Math.max(0, 1 - Math.max(0, age - 0.1) / 0.22);
    });
  }

  /**
   * Body-fall dust: a low ring of many small soft grains kicked out along the
   * ground (sun-warm tops, shadowed tones) plus heavier grit that drops back —
   * settles in well under a second, no big blurry billboards.
   */
  dust(t, at, { seed = 1, big = false, night = false } = {}) {
    const k = big ? 1.5 : 1;
    const tone = night ? [0x4a4a56, 0x32323c, 0x202026] : [0x8a7c66, 0x665a4c, 0x443c34];
    this.add(t, 1.2, () => ({
      list: [
        particleBurst({ at: { x: at.x, y: 0.06, z: at.z }, count: Math.round(46 * k), spread: 0.35 * k, flatY: true,
          velocity: (i, r) => { const a = r(4) * Math.PI * 2; const sp = (1.2 + r(5) * 1.6) * k; return [Math.cos(a) * sp, 0.25 + r(6) * 0.6, Math.sin(a) * sp]; },
          life: 0.85, size: 0.1 * k, grow: 1.4, drag: 4.5, gravity: 0.6, colors: tone, additive: false, intensity: night ? 0.4 : 0.45, soft: 0.95, seed, fadeIn: 0.04, floor: 0.02, alpha: 0.45 }),
        particleBurst({ at: { x: at.x, y: 0.08, z: at.z }, count: Math.round(22 * k), spread: 0.25, hemi: true, speed: 2.4, up: 0.9, life: 0.55, size: 0.025, drag: 1.5, gravity: 9, colors: [0x6a5e50, 0x4a4238, 0x2a2420], additive: false, intensity: 1, soft: 0.25, seed: seed + 3, floor: 0.015 }),
      ],
    }));
  }

  /** Arrow / sling stone flight on an arc; returns flight time. */
  missile(t, from, to, { kind = 'arrow', seed = 1 } = {}) {
    const dist = from.distanceTo(to);
    const dur = Math.max(0.18, dist / 22);
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.4), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.14).rotateY(Math.PI / 2).translate(0, 0, -0.32), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, side: THREE.DoubleSide }));
    arrow.add(shaft, tip, fl);
    const arc = Math.min(1.2, dist * 0.08);
    const P = (u) => new THREE.Vector3().lerpVectors(from, to, u).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * arc, 0));
    this.add(t, dur, () => ({ list: [arrow] }), (age) => {
      const u = clamp01(age / dur);
      const p = P(u);
      arrow.position.copy(p);
      arrow.lookAt(P(Math.min(1, u + 0.02)).add(new THREE.Vector3().subVectors(to, from).multiplyScalar(0.001)));
      arrow.visible = u < 1;
    });
    void kind;
    void seed;
    return dur;
  }

  /** Magic missiles: n homing orbs with trails. Returns flight time. */
  magicMissile(t, from, to, n = 1, seed = 1) {
    const dur = 0.55 + from.distanceTo(to) * 0.02;
    for (let k = 0; k < n; k++) {
      const off = new THREE.Vector3((hashf(seed + k) - 0.5) * 3, 1 + hashf(seed + k * 3) * 1.5, (hashf(seed + k * 5) - 0.5) * 3);
      const c1 = new THREE.Vector3().lerpVectors(from, to, 0.3).add(off);
      const c2 = new THREE.Vector3().lerpVectors(from, to, 0.75).add(off.clone().multiplyScalar(0.4));
      const curve = new THREE.CubicBezierCurve3(from.clone(), c1, c2, to.clone());
      const delay = k * 0.12;
      const TRAIL = 22;
      const tg = new THREE.BufferGeometry();
      const tp = new Float32Array(TRAIL * 3);
      const ta = new Float32Array(TRAIL);
      tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1));
      const tmat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uPix: { value: 600 } },
        vertexShader: `attribute float aA; uniform float uPix; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (0.08 + aA * 0.3) * uPix / -mv.z; }`,
        fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float d = 1.0 - smoothstep(0.2, 1.0, r); gl_FragColor = vec4(mix(vec3(0.5,0.3,1.0), vec3(0.9,0.85,1.0), vA) * 2.5, d * vA); }`,
      });
      const trail = new THREE.Points(tg, tmat);
      trail.frustumCulled = false;
      trail.renderOrder = 8;
      const head = glowSprite(0xb8a0ff, 0.9);
      const core = glowSprite(0xffffff, 0.35);
      this.add(t + delay, dur + 0.1, () => ({ list: [trail, head, core] }), (age, parts, ctx) => {
        const u = clamp01(age / dur);
        const e = u * u * (3 - 2 * u) * 0.3 + u * 0.7;
        const p = curve.getPoint(e);
        head.position.copy(p);
        core.position.copy(p);
        head.visible = core.visible = u < 1;
        for (let i = 0; i < TRAIL; i++) {
          const uu = Math.max(0, e - i * 0.018);
          const q = curve.getPoint(uu);
          tp.set([q.x, q.y, q.z], i * 3);
          ta[i] = u < 1 ? (1 - i / TRAIL) * (uu > 0 ? 1 : 0) : Math.max(0, 1 - (age - dur) * 10) * (1 - i / TRAIL);
        }
        tg.attributes.position.needsUpdate = true;
        tg.attributes.aA.needsUpdate = true;
        tmat.uniforms.uPix.value = ctx.pix;
        return { light: { i: u < 1 ? 6 : 0, color: 0x9a80ff, pos: p } };
      });
      this.add(t + delay + dur, 0.5, () => ({ list: [particleBurst({ at: to, count: 24, speed: 3, life: 0.4, size: 0.08, drag: 4, colors: [0xffffff, 0xb090ff, 0x4020a0], intensity: 3, seed: seed + k })] }));
    }
    return dur + (n - 1) * 0.12;
  }

  /**
   * Fireball: a comet (white-hot head, tapered flickering tail, shed embers)
   * arcs to the target and detonates in layers — a ray-marched fire volume
   * (white-hot heart, orange flame tongues, a sooty rim that cools to smoke),
   * an offset secondary burst, velocity-streaked ember sparks, a dark rolling
   * smoke cap and stem, a heat-shimmer shell and ground shockwave, debris,
   * dust and a scorch — with a strong orange light washing walls and figures.
   * Emission is rolled off so ACES keeps the hue at the peak.
   * Returns {flight, detonate} (seconds from t).
   */
  fireball(t, from, to, radius = 2.5 * 1.5, seed = 1, { victims = null } = {}) {
    const vic = () => (typeof victims === 'function' ? victims() : victims);
    const flight = Math.max(0.35, from.distanceTo(to) / 16);
    const arc = Math.min(1.4, from.distanceTo(to) * 0.12);
    const P = (u, out = new THREE.Vector3()) => out.lerpVectors(from, to, u).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * arc, 0));
    const head = glowSprite(0xffa040, 1.1, 0.9);
    const core = glowSprite(0xfff4dc, 0.34);
    const tail = taperTrail(28, 0xfff0c8, 0xff3008, 0.2);
    const shed = particleBurst({
      at: from, count: 70, life: 0.32, size: 0.035, speed: 1.6, drag: 2.5, gravity: 2, stagger: flight, turb: 0.9,
      colors: [0xfff0c0, 0xff7018, 0x501008], intensity: 2.4, seed,
      emit: (i) => {
        const q = P(i / 70);
        return [q.x, q.y, q.z];
      },
    });
    const sd = shed.obj.geometry.attributes.aD;
    for (let i = 0; i < 70; i++) sd.setX(i, (i / 70) * flight);
    const pts = [];
    for (let i = 0; i < 28; i++) pts.push(new THREE.Vector3());
    this.add(t, flight + 0.6, () => ({ list: [tail, shed, head, core] }), (age, parts, ctx) => {
      const u = clamp01(age / flight);
      const p = P(u);
      head.position.copy(p);
      core.position.copy(p);
      head.visible = core.visible = u < 1;
      head.scale.setScalar(1.0 + Math.sin(age * 47) * 0.08);
      for (let i = 0; i < 28; i++) P(Math.max(0, u - i * 0.011), pts[i]);
      if (ctx.camera) tail.set(pts, ctx.camera.position);
      tail.obj.material.uniforms.uT.value = age;
      tail.obj.material.uniforms.uA.value = u < 1 ? Math.min(1, age * 8) : 0;
      return { light: { i: u < 1 ? 14 : 0, color: 0xff9040, pos: p } };
    });

    const T = t + flight;
    const R = radius;
    // One ray-marched fire volume (core → flame tongues → soot) plus a smaller
    // offset one for an asymmetric silhouette, and two smoke volumes that roll
    // up out of the crown into a dark cap as the fire burns out.
    const ball = volumeFire({ steps: 40, glow: 0.88 });
    const ball2 = volumeFire({ steps: 22, glow: 0.8 });
    const cap = volumeFire({ steps: 18, smoke: true });
    const stem = volumeFire({ steps: 14, smoke: true });
    ball.u.uSeed.value = seed * 3.1;
    ball.u.uFreq.value = 2.1;
    ball2.u.uFreq.value = 2.0;
    ball2.u.uSeed.value = seed * 7.7 + 11;
    cap.u.uSeed.value = seed * 5.3 + 2;
    stem.u.uSeed.value = seed * 2.9 + 7;
    cap.u.uFreq.value = 2.0;
    stem.u.uFreq.value = 2.6;
    ball.u.uLobe.value = fireLobes(seed * 1.3);
    ball2.u.uLobe.value = fireLobes(seed * 2.7 + 4);
    cap.u.uLobe.value = fireLobes(seed * 0.7 + 9, true);
    stem.u.uLobe.value = fireLobes(seed * 4.1 + 2, true);
    const o2 = new THREE.Vector3(hashf(seed + 1) - 0.5, 0.25, hashf(seed + 2) - 0.5).normalize();
    // Heat shimmer: a thin, fast-expanding fresnel shell.
    const shock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform float uA; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.0); gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * 1.4, f * uA); }',
    }));
    shock.renderOrder = 11;
    shock.frustumCulled = false;
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8 }));
    scorch.renderOrder = 1;
    const sparks = sparkStreaks({ at: to, count: 16, speed: 9, life: 0.9, gravity: 8, drag: 1.6, hemi: true, width: 1.2, streak: 0.018, intensity: 1.3, seed: seed + 3, r0: R * 0.3 });
    // Embers lofted by the blast drift down and settle onto the setts (the
    // ember bed below keeps them glowing there); no loose sprite blobs.
    const lateSparks = sparkStreaks({ at: { x: to.x, y: to.y + 0.6, z: to.z }, count: 14, speed: 1.6, up: 1.2, life: 1.3, gravity: 2.2, drag: 2.2, hemi: true, width: 0.8, streak: 0.025, intensity: 1.6, seed: seed + 9, delay: 0.2, stagger: 0.5, r0: R * 0.45 });
    const debris = particleBurst({ at: { x: to.x, y: 0.2, z: to.z }, count: 16, speed: 5.5, life: 0.55, size: 0.05, drag: 1, gravity: 16, hemi: true, colors: [0x5a4a3a, 0x3a3028, 0x2a2420], additive: false, intensity: 1, soft: 0.2, seed: seed + 5, floor: 0.03 });
    const dust = particleBurst({ at: { x: to.x, y: 0.35, z: to.z }, count: 30, spread: 0.3, flatY: true, hemi: true, speed: 6.5, up: 0.25, life: 1.5, size: 0.45, grow: 1.8, drag: 3.2, colors: [0x5a524a, 0x48423c, 0x3a3530], additive: false, intensity: 1.0, soft: 1.0, seed: seed + 13, fadeIn: 0.2, alpha: 0.07 });
    // Kicked-up dust hugs the ground behind the fire (never a grey film over it).
    dust.obj.renderOrder = 7;
    // Ground shockwave: a ring of kicked-up dust racing out over the setts
    // with a hot, thin leading edge, well past the fire's rim.
    const waveDust = shockRing(false);
    const waveHot = shockRing(true);
    // The flash is a small white-hot core (~1 tile) inside a hard orange
    // shell, never a screen-wide wash: the light does the rest.
    const flash = glowSprite(0xff9a40, R * 1.15, 0);
    const flashCore = glowSprite(0xfff4e0, R * 0.42, 0);
    const heart = glowSprite(0xfff0b8, R * 0.5, 0);
    const halo = glowSprite(0xff5a10, R * 1.4, 0);
    // Iteration 4: the incandescent heart draws over the volume (additive), so
    // the white-yellow core always reads through the orange billows.
    heart.renderOrder = halo.renderOrder = 12;
    this.add(T, 6.0, () => ({ list: [waveDust, waveHot, dust, stem, cap, ball2, ball, halo, heart, shock, sparks, lateSparks, debris, flash, flashCore] }), (age, parts, ctx) => {
      const vl = vic();
      // Shockwave: fast at first, slowing as it spreads; dust lingers behind the edge.
      const wr = R * (0.3 + 0.75 * (1 - Math.exp(-age * 4.2)));
      for (const w of [waveDust, waveHot]) {
        w.position.set(to.x, 0.04, to.z);
        w.scale.setScalar(wr * 2.3);
        w.material.uniforms.uR.value = 0.87;
        w.material.uniforms.uAge.value = age;
      }
      waveDust.material.uniforms.uA.value = clamp01(age * 12) * clamp01(1 - age / 1.0) * 0.32;
      // Iteration 4: the hot shock front stays readable through the money frame.
      waveHot.material.uniforms.uA.value = clamp01(age * 20) * Math.exp(-age * 1.7) * 0.85;
      waveDust.visible = waveHot.visible = age < 1.0;
      // White-hot flash: 2-3 frames of glare, then gone.
      const fl = age < 0.03 ? age / 0.03 : Math.exp(-(age - 0.03) * 22);
      flash.position.set(to.x, to.y + 0.3, to.z);
      flash.material.opacity = fl * 0.35;
      flash.visible = flashCore.visible = age < 0.25;
      flashCore.position.set(to.x, to.y + 0.2, to.z);
      flashCore.material.opacity = Math.min(0.6, fl * 0.9);
      // Incandescent heart: a white-yellow core held through the burn,
      // ringed by a wide soft orange falloff (both additive).
      heart.position.set(to.x, to.y + 0.35 + (age * 0.55 + age * age * 0.3) * 0.6, to.z);
      heart.material.opacity = clamp01(age * 14) * Math.exp(-age * 0.9) * 1.0;
      heart.scale.setScalar(R * (0.32 + 0.16 * (1 - Math.exp(-age * 8))));
      halo.position.copy(heart.position);
      halo.material.opacity = clamp01(age * 10) * Math.exp(-age * 1.2) * 0.38;
      halo.scale.setScalar(R * (0.9 + 0.3 * (1 - Math.exp(-age * 6))));
      heart.visible = halo.visible = age < 3;
      const ease = 1 - Math.exp(-age * 8);
      const cam = ctx?.camera;
      const rise = age * 0.55 + age * age * 0.3;
      // Main fireball: snaps out in ~0.25 s, hot heart cooling through orange to
      // soot at the rim, then tears open and fades while it rises.
      const Rb = R * 0.5;
      ball.obj.position.set(to.x, to.y + rise, to.z);
      ball.obj.scale.set(Rb, Rb * 0.92, Rb);
      ball.u.uAge.value = age;
      ball.u.uGrow.value = 0.18 + 0.62 * (1 - Math.exp(-age * 9)) + age * 0.06;
      // Iteration 4: a hotter, longer-held burn (white-yellow heart, orange to
      // red tongues) so the money frame reads as Fireball, not a dust puff.
      ball.u.uHeat.value = age < 0.06 ? 1.3 : 0.3 + 0.82 * Math.exp(-(age - 0.06) * 0.75);
      ball.u.uSmoke.value = clamp01(0.25 + age * 0.9);
      // Burn-out: it cools to soot and thins (no tearing into floating blobs).
      ball.u.uErode.value = Math.max(0, age - 1.0) * 0.18;
      ball.u.uFade.value = clamp01((2.3 - age) / 1.3);
      ball.obj.visible = age < 2.3;
      ball.u.uCrisp.value = 6;
      ball.sync(cam, 0.02, vl);
      const R2 = R * 0.46;
      const e2 = 1 - Math.exp(-(age - 0.03) * 8);
      ball2.obj.position.set(to.x + o2.x * R * 0.42 * e2, to.y + rise * 1.2 + o2.y * R * 0.3, to.z + o2.z * R * 0.42 * e2);
      ball2.obj.scale.setScalar(R2);
      ball2.u.uAge.value = age + 2;
      ball2.u.uGrow.value = 0.2 + 0.6 * Math.max(0, e2);
      ball2.u.uHeat.value = 0.22 + 0.8 * Math.exp(-age * 1.5);
      ball2.u.uSmoke.value = clamp01(age * 1.2);
      ball2.u.uErode.value = Math.max(0, age - 0.9) * 0.2;
      ball2.u.uFade.value = clamp01((1.9 - age) / 1.1);
      ball2.obj.visible = age > 0.03 && age < 1.9;
      ball2.u.uCrisp.value = 6;
      ball2.sync(cam, 0.02, vl);
      // Smoke: a dark mushrooming cap boils up out of the crown almost at
      // once (sooty, near-black folds against the orange), a stem beneath it.
      const ac = age - 0.22;
      cap.obj.visible = ac > 0 && age < 5.6;
      if (cap.obj.visible) {
        // Mushrooming: rises out of the crown and spreads wide and flat.
        const g = R * (0.42 + ac * 0.32) * (0.6 + 0.4 * (1 - Math.exp(-ac * 5)));
        cap.obj.position.set(to.x, to.y + Rb * 0.7 + g * 0.25 + ac * 1.25 + rise * 0.5, to.z);
        cap.obj.scale.set(g * 1.35, g * 0.6, g * 1.35);
        cap.u.uAge.value = ac * 0.7;
        cap.u.uGrow.value = 0.35 + 0.5 * (1 - Math.exp(-ac * 5));
        cap.u.uHeat.value = Math.max(0, 1 - ac * 0.7);
        cap.u.uErode.value = Math.max(0, ac - 2.6) * 0.4;
        cap.u.uFade.value = clamp01(ac * 4) * clamp01((5.6 - age) / 2.0) * 0.92;
        cap.u.uCrisp.value = 8;
        cap.sync(cam, 0.02);
      }
      // The burn-out: a rising, darkening smoke column (glowing from below
      // while the embers burn), thinning into the sky.
      const as = age - 0.3;
      stem.obj.visible = as > 0 && age < 5.8;
      if (stem.obj.visible) {
        const g = R * (0.3 + as * 0.06);
        stem.u.uShape.value = 1;
        stem.obj.position.set(to.x, to.y + g * 1.4 + as * 0.55, to.z);
        stem.obj.scale.set(g, g * 2.2, g);
        stem.u.uAge.value = as * 0.8;
        stem.u.uGrow.value = 0.35 + 0.4 * (1 - Math.exp(-as * 3));
        stem.u.uHeat.value = Math.max(0, 0.8 - as * 0.45);
        stem.u.uErode.value = Math.max(0, as - 2.6) * 0.45;
        stem.u.uFade.value = clamp01(as * 2.5) * clamp01((5.8 - age) / 2.0) * 0.85;
        stem.u.uCrisp.value = 7;
        stem.sync(cam, 0.02);
      }
      shock.position.set(to.x, to.y, to.z);
      shock.scale.setScalar(R * (0.3 + 0.7 * (1 - Math.exp(-age * 9))));
      shock.material.uniforms.uA.value = clamp01(1 - age / 0.25) ** 2 * 0.12;
      shock.visible = age < 0.3;
      // A big warm key light: white-orange flash settling to a deep orange glow.
      // A big warm flare that washes walls, windows and figures, settling to a burn.
      // Sits inside the fireball (low), so the victims' near sides, the
      // paving and the nearest wall take the light; held for the whole burn.
      // Strong and short: the setts, walls and victims within ~3 squares
      // glow orange through the bloom, then the light settles into the burn.
      // A 2-3 frame warm flash (walls and figures flare amber), then a strong
      // sustained orange key from the burning volume, falling off over 3-4
      // squares: the flagstones and the nearest facade glow with the burn.
      const li = age < 0.03 ? 150 * (age / 0.03) : 90 * Math.exp(-(age - 0.03) * 16) + 190 * Math.exp(-age * 1.2) * clamp01(age * 20) + 25 * Math.max(0, 1 - age / 3.5);
      // Only a whisper of exposure kick: the core stays a hot white-yellow, the
      // frame never washes out.
      const expo = age < 0.03 ? 0.12 * (age / 0.03) : 0.12 * Math.exp(-(age - 0.03) * 18);
      return { exposure: expo, light: { i: li, color: age < 0.08 ? 0xffc890 : 0xff7a2c, pos: new THREE.Vector3(to.x, to.y + (age < 0.15 ? 1.2 : 0.55) + rise * 0.35, to.z) } };
    });
    // What the blast leaves: a char scar on the setts with a dying heat glow,
    // and a bed of embers that smoulder and wink out over the next seconds.
    const glowScar = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff5a10, opacity: 0 }));
    glowScar.renderOrder = 2;
    const embers = emberBed(to, R * 0.95, seed + 31);
    this.add(T, 999, () => ({ list: [scorch, glowScar, embers] }), (age) => {
      scorch.position.set(to.x, 0.025, to.z);
      scorch.scale.setScalar(R * 0.95);
      scorch.material.opacity = clamp01(age * 5) * 0.82;
      glowScar.position.set(to.x, 0.03, to.z);
      glowScar.scale.setScalar(R * 0.8);
      glowScar.material.opacity = clamp01(age * 6) * (0.08 + 0.3 * Math.exp(-age * 1.4));
    }, { persistent: true, id: `scorch-${seed}` });
    this.addShake(T, 0.35, 0.6);
    return { flight, detonate: flight };
  }

  /**
   * A figure caught in fire: licking flames and rising embers clinging to the
   * body (following `getPos`, feet position) for a couple of seconds, plus
   * smoke curling off the scorched kit. `h` = figure height.
   */
  bodyFire(t, getPos, h = 1.7, seed = 1, dur = 2.4) {
    const embers = particleBurst({
      at: { x: 0, y: 0, z: 0 }, count: 46, life: 0.9, stagger: dur * 0.8, size: 0.035, gravity: -2.2, drag: 1.4, turb: 0.5, speed: 0.5,
      colors: [0xfff0b0, 0xff7a18, 0x601004], intensity: 2.6, seed: seed + 41, soft: 0.35,
      emit: (i, r) => [(r(1) - 0.5) * 0.45, h * (0.15 + r(2) * 0.75), (r(3) - 0.5) * 0.45],
    });
    const licks = particleBurst({
      at: { x: 0, y: 0, z: 0 }, count: 40, life: 0.42, stagger: dur * 0.7, size: 0.2, grow: -0.6, gravity: -3.5, drag: 2, turb: 0.3, speed: 0.15,
      colors: [0xffd890, 0xff6a10, 0x3a0a02], intensity: 1.5, seed: seed + 43, soft: 0.9, fadeIn: 0.1,
      emit: (i, r) => [(r(1) - 0.5) * 0.4, h * (0.1 + r(2) * 0.55), (r(3) - 0.5) * 0.4],
    });
    const smoke = particleBurst({
      at: { x: 0, y: 0, z: 0 }, count: 22, life: 1.8, stagger: dur * 0.8, delay: 0.2, size: 0.22, grow: 3.0, gravity: -1.1, drag: 1.2, turb: 0.4, speed: 0.1,
      colors: [0x5a544e, 0x48433e, 0x3a3632], additive: false, intensity: 1, seed: seed + 47, soft: 1.0, fadeIn: 0.25, alpha: 0.3,
      emit: (i, r) => [(r(1) - 0.5) * 0.3, h * (0.6 + r(2) * 0.4), (r(3) - 0.5) * 0.3],
    });
    this.add(t, dur + 1.8, () => ({ list: [smoke, licks, embers] }), () => {
      const p = getPos();
      for (const o of [smoke, licks, embers]) o.obj.position.set(p.x, 0, p.z);
    });
  }

  /** Burning hands: a roaring cone of fire from the caster toward `dir`. */
  coneFire(t, from, dirYaw, length = 4.5, seed = 1) {
    const n = 160;
    const burst = particleBurst({
      at: from, count: n, life: 0.55, size: 0.35, grow: 2.2, drag: 1.2, turb: 0.8, stagger: 0.55,
      colors: [0xfff0c0, 0xff7010, 0x301008], intensity: 2.6, seed,
      velocity: (i, r) => {
        const a = dirYaw + (r(1) - 0.5) * 0.9;
        const s = length * (1.4 + r(2) * 0.8);
        return [Math.sin(a) * s, (r(3) - 0.3) * 1.5, Math.cos(a) * s];
      },
    });
    this.add(t, 1.3, () => ({ list: [burst] }), (age) => ({
      light: { i: age < 0.6 ? 25 : Math.max(0, 25 - (age - 0.6) * 60), color: 0xff7020, pos: new THREE.Vector3(from.x + Math.sin(dirYaw) * 1.5, from.y, from.z + Math.cos(dirYaw) * 1.5) },
    }));
    return 0.35;
  }

  /** Lightning bolt: flickering jagged beam with branches and sparks along the line. */
  lightning(t, from, to, seed = 1) {
    const dur = 0.6;
    const bolts = [];
    for (let k = 0; k < 3; k++) bolts.push(ribbon(jaggedBolt(from, to, seed + k * 17, 0.6 + k * 0.2), k === 0 ? 0.09 : 0.05, 0x9ad0ff));
    const branch = [];
    for (let k = 0; k < 4; k++) {
      const a = from.clone().lerp(to, 0.2 + hashf(seed + k) * 0.6);
      const b = a.clone().add(new THREE.Vector3((hashf(seed + k * 3) - 0.5) * 3, -a.y + 0.05, (hashf(seed + k * 5) - 0.5) * 3));
      branch.push(ribbon(jaggedBolt(a, b, seed + k * 31, 0.4), 0.03, 0x80c0ff));
    }
    const glowA = glowSprite(0xa0d8ff, 2.2);
    const glowB = glowSprite(0xa0d8ff, 3.0);
    this.add(t, dur, () => ({ list: [...bolts, ...branch, glowA, glowB] }), (age) => {
      const f = age < dur ? (Math.sin(age * 90) > -0.3 ? 1 : 0.2) * (1 - age / dur) : 0;
      bolts.forEach((b, i) => {
        b.material.uniforms.uA.value = f * (i === Math.floor(age * 20) % 3 ? 1 : 0.35);
      });
      branch.forEach((b, i) => { b.material.uniforms.uA.value = f * (Math.sin(age * 60 + i) > 0 ? 0.8 : 0.1); });
      glowA.position.copy(from);
      glowB.position.copy(to);
      glowA.material.opacity = glowB.material.opacity = f;
      return { light: { i: 40 * f, color: 0x9ac8ff, pos: from.clone().lerp(to, 0.5).setY(2) } };
    });
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const p = from.clone().lerp(to, k / steps);
      this.add(t + 0.02 * k, 0.6, () => ({ list: [particleBurst({ at: p, count: 10, speed: 4, life: 0.3, size: 0.05, drag: 3, gravity: 8, colors: [0xffffff, 0xa0d0ff, 0x2040a0], intensity: 3, seed: seed + k, floor: 0.02 })] }));
    }
    this.addShake(t, 0.18, 0.4);
    return 0.12;
  }

  /** Sleep: a brief, quiet fall of a few soft violet motes over the area (no screen-wide sparkle). */
  sleepCloud(t, centre, size, seed = 1) {
    const r = size * 0.4;
    const motes = particleBurst({
      at: { x: centre.x, y: 2.2, z: centre.z }, count: 30, spread: r, speed: 0.12, gravity: 0.1, life: 2.2, stagger: 0.7, size: 0.026, drag: 0.8, turb: 0.18,
      colors: [0xffffff, 0xd8ccff, 0x8a78e0], intensity: 2.6, seed, floor: 0.3, fadeIn: 0.2, soft: 0.22,
    });
    this.add(t, 2.6, () => ({ list: [motes] }), (age) => {
      return { light: { i: 1.2 * Math.sin(clamp01(age / 2.2) * Math.PI), color: 0x9a86ff, pos: new THREE.Vector3(centre.x, 2.0, centre.z) } };
    });
  }

  /** A sleeper: a faint violet glow and a slow drift of glowing "z" glyphs rising off the head (persistent until woken). */
  sleepZ(t, getPos, id, seed = 1) {
    const zs = [0, 1, 2].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zGlyphTexture(), color: 0xe4dcff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }));
      sp.renderOrder = 12;
      return sp;
    });
    const motes = [0, 1].map(() => glowSprite(0xc8bcff, 0.05, 0));
    const glow = glowSprite(0x9a88ff, 0.55, 0);
    this.add(t, 999, () => ({ list: [glow, ...motes, ...zs] }), (age) => {
      const p = getPos();
      glow.position.copy(p).setY(p.y - 0.1);
      glow.material.opacity = 0.08 + 0.03 * Math.sin(age * 1.6 + seed);
      zs.forEach((z, k) => {
        const ph = (age * 0.3 + k / 3 + seed * 0.13) % 1;
        z.position.set(p.x + 0.15 + Math.sin(ph * 5 + k) * 0.1 + ph * 0.25, p.y + 0.1 + ph * 0.8, p.z);
        z.scale.setScalar(0.2 + ph * 0.2);
        z.material.rotation = -0.25 + Math.sin(ph * 4 + k) * 0.15;
        z.material.opacity = Math.sin(ph * Math.PI) * clamp01(age * 1.5) * 0.95;
      });
      motes.forEach((m, k) => {
        const ph = (age * 0.22 + k / 2 + seed * 0.21) % 1;
        const a = ph * Math.PI * 2 + k * 2.1;
        m.position.set(p.x + Math.cos(a) * 0.2, p.y + 0.1 + ph * 0.3, p.z + Math.sin(a) * 0.2);
        m.material.opacity = Math.sin(ph * Math.PI) * 0.8 * clamp01(age * 1.5);
      });
    }, { persistent: true, id });
  }

  /**
   * Nauseous: a sickly green halo, bile dripping from the mouth in slow
   * retches and wavering stink wisps curling up off the figure (persistent
   * until the effect ends). `getPos` returns the head position.
   */
  retch(t, getPos, id, seed = 1, getYaw = () => 0) {
    const N = 26;
    const pos = new Float32Array(N * 3);
    const dat = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) dat.set([hashf(seed + i * 3.3), hashf(seed * 2 + i * 7.1)], i * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aD', new THREE.BufferAttribute(dat, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uAge: { value: 0 }, uPix: { value: 600 }, uO: { value: new THREE.Vector3() }, uF: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: `attribute vec2 aD; uniform float uAge, uPix; uniform vec3 uO, uF; varying float vA;
        void main(){
          // Retches come in bursts every ~1.6 s; each drop falls from the mouth under gravity.
          float cyc = uAge * 0.62 + aD.x * 0.18;
          float ph = fract(cyc);
          float tt = ph * 1.6;
          float burst = step(ph, 0.55);
          vec3 v = uF * (0.5 + aD.y * 0.6) + vec3((aD.x - 0.5) * 0.4, 0.2 + aD.y * 0.3, (aD.y - 0.5) * 0.4);
          vec3 p = uO + uF * 0.08 + v * tt; p.y -= 4.9 * tt * tt; p.y = max(p.y, 0.02);
          vA = burst * (1.0 - smoothstep(0.35, 0.55, ph)) * smoothstep(0.0, 0.03, ph);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.025 + aD.y * 0.025) * uPix / max(0.1, -mv.z); }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float d = 1.0 - smoothstep(0.4, 1.0, r); if (d * vA <= 0.01) discard;
        gl_FragColor = vec4(vec3(0.55, 0.62, 0.12) * (0.8 + 0.4 * (1.0 - r)), d * vA * 0.9); }`,
    });
    const drops = new THREE.Points(g, mat);
    drops.frustumCulled = false;
    drops.renderOrder = 7;
    const halo = glowSprite(0x9ac020, 0.9, 0);
    const wisps = [0, 1, 2].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wispTexture(), color: 0xb8d040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      sp.renderOrder = 7;
      return sp;
    });
    this.add(t, 999, () => ({ list: [halo, drops, ...wisps] }), (age, parts, ctx) => {
      const p = getPos();
      mat.uniforms.uAge.value = age;
      mat.uniforms.uPix.value = ctx.pix;
      mat.uniforms.uO.value.copy(p).setY(p.y - 0.05);
      const yw = getYaw();
      mat.uniforms.uF.value.set(Math.sin(yw), 0, Math.cos(yw));
      halo.position.copy(p).setY(p.y - 0.35);
      halo.material.opacity = 0.16 + 0.06 * Math.sin(age * 2.2 + seed);
      wisps.forEach((w, k) => {
        const ph = (age * 0.35 + k / 3 + seed * 0.17) % 1;
        w.position.set(p.x + Math.sin(ph * 6 + k * 2) * 0.12 + (k - 1) * 0.12, p.y - 0.1 + ph * 0.7, p.z + Math.cos(ph * 5 + k) * 0.08);
        w.scale.set(0.16, 0.3 + ph * 0.2, 1);
        w.material.rotation = Math.sin(ph * 7 + k) * 0.4;
        w.material.opacity = Math.sin(ph * Math.PI) * 0.55 * clamp01(age * 1.5);
      });
    }, { persistent: true, id });
  }

  /**
   * Stinking cloud: persistent, ground-hugging vapour (see gasVolume) over the
   * 2×2 area, its tendrils spilling half a square past the template edge.
   */
  stinkingCloud(t, centre, size, id, seed = 1, { night = false, victims = null, key = null } = {}) {
    // A ray-marched heap of crisp, self-shadowed billows (two lobed volumes:
    // a broad low mass and a smaller crown riding it), a ground-hugging haze
    // spilling past the rim, and stray puffs curling off and drifting away.
    const vic = () => (typeof victims === 'function' ? victims() : victims);
    const Rc = size * 0.66;
    const keyC = new THREE.Color(key ?? (night ? 0x8a9cc8 : 0xfff0d0));
    // Four low heaps over the footprint and a crown boiling up off them.
    const heaps = [];
    for (let k = 0; k < 5; k++) {
      const hv = volumeFire({ steps: k === 4 ? 16 : 20, gas: true });
      hv.u.uLobe.value = fireLobes(seed * 2.3 + 1 + k * 3.7, k < 4);
      hv.u.uSeed.value = seed * 3.7 + k * 5;
      hv.u.uFreq.value = k === 4 ? 2.6 : 2.1;
      hv.u.uSky.value.copy(keyC);
      hv.u.uHeat.value = night ? 0.7 : 0.85;
      hv.u.uCrisp.value = 11;
      hv.u.uDrift.value.set(0.05, -0.12, 0.03);
      hv.obj.renderOrder = 8;
      const a = (k / 4) * Math.PI * 2 + 0.6 + hashf(seed + k) * 0.5;
      hv.off = k === 4 ? new THREE.Vector3(0.1, 0, -0.08) : new THREE.Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
      hv.sz = k === 4 ? 0.62 : 0.78 + hashf(seed * 3 + k) * 0.18;
      heaps.push(hv);
    }
    const heap = heaps[0];
    const v = {
      obj: new THREE.Group(),
      u: heap.u,
      sync() {},
      dispose() { for (const hv of heaps) hv.dispose(); },
    };
    for (const hv of heaps) v.obj.add(hv.obj);
    // Ground haze: a soft, torn olive film over the setts reaching past the heap.
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uA: { value: 0 }, uT: { value: 0 }, uC: { value: new THREE.Color(night ? 0x26301c : 0x7a8a2c) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uA, uT; uniform vec3 uC;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn2(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p);
          float n = vn2(p * 3.0 + uT * 0.05) * 0.6 + vn2(p * 7.0 - uT * 0.08) * 0.4;
          // Tendrils of fog creeping out between the setts past the heap's rim.
          float ang = atan(p.y, p.x);
          float ten = vn2(vec2(ang * 3.0, r * 2.0 - uT * 0.12)) * 0.5 + vn2(vec2(ang * 7.0 + 3.0, r * 5.0)) * 0.5;
          float a = (1.0 - smoothstep(0.3, 1.0, r + (n - 0.5) * 0.4 - (ten - 0.5) * 0.35)) * (0.5 + 0.5 * n);
          vec3 c = mix(uC * 0.55, uC * 1.15, n);
          gl_FragColor = vec4(c, a * uA); }`,
    }));
    haze.renderOrder = 4;
    // Stray wisps curl off the edge and drift away on the air, thinning out.
    const puffs = [];
    for (let k = 0; k < 12; k++) {
      const pf = puff(night ? 0x3a4430 : k % 3 ? 0x6e7a30 : 0x8a9a3a, seed * 7 + k * 3.1);
      pf.userData.a0 = (k / 12) * Math.PI * 2 + hashf(seed + k) * 0.8;
      pf.userData.ph = hashf(seed * 3 + k) * 6;
      puffs.push(pf);
    }
    this.add(t, 999, () => ({ list: [haze, v, ...puffs] }), (age, parts, ctx) => {
      const fade = clamp01(age / 1.2);
      const grow = 0.55 + 0.45 * (1 - Math.exp(-age * 2.5));
      const vl = vic();
      heaps.forEach((hv, k) => {
        const top = k === 4;
        const sz = hv.sz * Rc;
        hv.obj.position.set(centre.x + hv.off.x * Rc, top ? Rc * 0.62 + Math.sin(age * 0.4) * 0.05 : 0.02, centre.z + hv.off.z * Rc);
        hv.obj.scale.set(sz, sz * (top ? 0.9 : 0.95), sz);
        hv.u.uGrow.value = (top ? 0.75 : 0.86) * grow;
        hv.u.uAge.value = age * 0.35 + k * 1.7;
        hv.u.uFade.value = fade * 0.97;
        hv.sync(ctx?.camera, 0.0, vl);
      });
      haze.position.set(centre.x, 0.04, centre.z);
      haze.scale.setScalar(size * 2.5);
      haze.material.uniforms.uA.value = fade * 0.62;
      haze.material.uniforms.uT.value = age;
      for (const pf of puffs) {
        const cyc = ((age + pf.userData.ph) % 6) / 6;
        // Each wisp curls as it leaves: an outward spiral, rising and swelling.
        const a0 = pf.userData.a0 + cyc * 0.9;
        const rr = size * 0.5 + cyc * 1.9;
        pf.position.set(centre.x + Math.cos(a0) * rr, 0.35 + cyc * 1.0, centre.z + Math.sin(a0) * rr);
        pf.scale.setScalar(0.7 + cyc * 1.3);
        pf.material.uniforms.uT.value = age;
        pf.material.uniforms.uA.value = fade * Math.sin(cyc * Math.PI) * 0.3;
      }
    }, { persistent: true, id });
  }

  /**
   * The Flamed One's presence: a hot pulsing glow on the stones beneath it,
   * a smouldering ring of embers and sparks forever rising off its hide.
   * Follows `getPos` (feet). Persistent until killed by id.
   */
  bossAura(t, getPos, seed = 1, { radius = 1.8, height = 2.8, id = 'boss-aura' } = {}) {
    const ring = groundRing(0xff6a1a, 0.55);
    const n = 70;
    const pos = new Float32Array(n * 3);
    const dat = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = hashf(seed * 3.1 + i * 1.7) * Math.PI * 2;
      const r = (0.25 + Math.sqrt(hashf(seed * 5.3 + i * 2.9)) * 0.75) * radius;
      pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
      dat.set([hashf(seed + i * 11.3), 0.035 + hashf(seed * 2 + i * 4.1) * 0.05, 0.25 + hashf(i * 3.3 + seed) * 0.5], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aD', new THREE.BufferAttribute(dat, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uAge: { value: 0 }, uPix: { value: 600 }, uH: { value: height } },
      vertexShader: `attribute vec3 aD; uniform float uAge, uPix, uH; varying float vF; varying float vU;
        void main(){ float u = fract(uAge * aD.z * 0.5 + aD.x); vU = u;
          vec3 p = position * (1.0 - u * 0.45);
          p.x += sin(uAge * 1.7 + aD.x * 40.0) * 0.15 * u; p.z += cos(uAge * 1.3 + aD.x * 30.0) * 0.15 * u;
          p.y = u * uH;
          vF = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.55, 1.0, u)) * (0.6 + 0.4 * sin(uAge * 9.0 + aD.x * 50.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aD.y * uPix / max(0.1, -mv.z); }`,
      fragmentShader: `varying float vF; varying float vU;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float d = 1.0 - smoothstep(0.1, 1.0, r); if (d <= 0.0) discard;
          vec3 c = mix(vec3(1.0, 0.72, 0.3), vec3(1.0, 0.2, 0.03), vU) * 2.6;
          gl_FragColor = vec4(c * d * vF, d * vF); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 7;
    const embers = emberBed({ x: 0, z: 0 }, radius * 0.9, seed + 5, 60);
    const glow = glowSprite(0xff7a2a, radius * 2.6, 0.22);
    this.add(t, 999, () => ({ list: [ring, pts, embers, glow] }), (age, parts, ctx) => {
      const p = getPos();
      ring.position.set(p.x, 0.03, p.z);
      ring.scale.setScalar(radius * 2.2);
      ring.material.uniforms.uR.value = 0.62 + 0.04 * Math.sin(age * 2.1);
      ring.material.uniforms.uW.value = 0.32;
      ring.material.uniforms.uA.value = 0.14 + 0.05 * Math.sin(age * 3.3 + seed);
      pts.position.set(p.x, 0.1, p.z);
      embers.obj.position.set(p.x, 0, p.z);
      glow.position.set(p.x, 0.25, p.z);
      mat.uniforms.uAge.value = age;
      mat.uniforms.uPix.value = ctx.pix;
    }, { persistent: true, id });
  }

  /** Healing: rising green-gold sparkles and a pulse ring. */
  heal(t, at, seed = 1) {
    const ring = groundRing(0x80ff90, 0.3);
    this.add(t, 1.6, () => ({
      list: [ring, particleBurst({ at: { x: at.x, y: 0.1, z: at.z }, count: 50, spread: 0.45, flatY: true, speed: 0.2, gravity: -2.2, life: 1.4, stagger: 0.4, size: 0.08, drag: 0.5, turb: 0.2, colors: [0xffffff, 0xa0ffb0, 0x40c060], intensity: 2.4, seed })],
    }), (age) => {
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(1.8 + age * 0.8);
      ring.material.uniforms.uR.value = 0.6;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.2);
      return { light: { i: 5 * Math.max(0, 1 - age), color: 0x80ff90, pos: new THREE.Vector3(at.x, 1.2, at.z) } };
    });
  }

  /** Generic aura (bless/ward/buff/curse/charm/hold). */
  aura(t, at, color, seed = 1, { down = false } = {}) {
    const ring = groundRing(color, 0.2);
    this.add(t, 1.4, () => ({
      list: [ring, particleBurst({ at: { x: at.x, y: down ? 2.2 : 0.1, z: at.z }, count: 34, spread: 0.5, flatY: true, speed: 0.2, gravity: down ? 1.5 : -1.6, life: 1.1, stagger: 0.3, size: 0.07, drag: 0.5, colors: [0xffffff, color, color], intensity: 2.2, seed })],
    }), (age) => {
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(1.2 + age * 1.5);
      ring.material.uniforms.uR.value = 0.7;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.1);
    });
  }

  /**
   * Turn undead: the holy symbol flares — a radiant sigil burns into the ground
   * (ring, twelve rays, the Scales), shafts of light fan outward, a narrow
   * column rises and motes drift up. Intensities are capped so it reads as a
   * shaped burst, never a white flood.
   */
  holyLight(t, at, seed = 1) {
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: holySigilTexture(), color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    sigil.renderOrder = 5;
    const rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uA, uT; void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float rays = pow(abs(cos(a * 6.0 + uT * 0.6)), 18.0) + 0.5 * pow(abs(cos(a * 6.0 + 0.26)), 30.0);
        float k = rays * smoothstep(1.0, 0.25, r) * smoothstep(0.05, 0.3, r);
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * 1.2, k * uA * 0.55); }`,
    }));
    rays.renderOrder = 5;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 5, 24, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float uA; void main(){ float a = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y) * (0.6 + 0.4 * sin(vUv.x * 62.83)); gl_FragColor = vec4(vec3(1.0, 0.85, 0.55), a * uA * 0.2); }',
    }));
    column.renderOrder = 8;
    const ring = groundRing(0xffd070, 0.0);
    const motes = particleBurst({ at: { x: at.x, y: 0.2, z: at.z }, count: 60, spread: 0.9, flatY: true, speed: 0.4, gravity: -1.6, life: 1.6, stagger: 0.5, size: 0.05, drag: 0.6, turb: 0.25, colors: [0xffffff, 0xffe090, 0xa07020], intensity: 1.6, seed, fadeIn: 0.15 });
    this.add(t, 2.2, () => ({ list: [sigil, rays, column, ring, motes] }), (age) => {
      const k = clamp01(age / 0.18) * (1 - clamp01((age - 1.3) / 0.8));
      sigil.position.set(at.x, 0.05, at.z);
      sigil.scale.setScalar(2.2 + Math.min(1, age * 3) * 1.0);
      sigil.rotation.y = age * 0.4;
      sigil.material.opacity = k * 0.65;
      rays.position.set(at.x, 0.055, at.z);
      rays.scale.setScalar(4 + age * 5);
      rays.material.uniforms.uA.value = k;
      rays.material.uniforms.uT.value = age;
      column.position.set(at.x, 2.5, at.z);
      column.material.uniforms.uA.value = k;
      ring.position.set(at.x, 0.06, at.z);
      ring.scale.setScalar(2 + age * 10);
      ring.material.uniforms.uR.value = 0.85;
      ring.material.uniforms.uW.value = 0.04;
      ring.material.uniforms.uA.value = Math.max(0, 1 - age / 1.0) * 0.6;
      return { light: { i: 9 * k, color: 0xffd080, pos: new THREE.Vector3(at.x, 1.6, at.z) } };
    });
  }

  /** Hands glow while a spell is being woven. */
  castGlow(t, getPos, color, dur = 0.8) {
    const g = glowSprite(color, 0.7);
    const g2 = glowSprite(0xffffff, 0.25);
    this.add(t, dur, () => ({ list: [g, g2] }), (age) => {
      const p = getPos();
      g.position.copy(p);
      g2.position.copy(p);
      const k = Math.sin(clamp01(age / dur) * Math.PI);
      g.material.opacity = k;
      g2.material.opacity = k;
      g.scale.setScalar(0.5 + k * 0.7 + Math.sin(age * 30) * 0.05);
      return { light: { i: 5 * k, color, pos: p } };
    });
  }
}

let _sigil = null;
/** A radiant holy sigil: double ring, twelve rays and Tyr's balance (additive mask). */
function holySigilTexture() {
  if (_sigil) return _sigil;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  const glow = g.createRadialGradient(0, 0, 10, 0, 0, 128);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(-128, -128, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, 108, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 12; i++) {
    g.save();
    g.rotate((i / 12) * Math.PI * 2);
    g.beginPath(); g.moveTo(-5, -58); g.lineTo(0, -92); g.lineTo(5, -58); g.closePath(); g.fill();
    g.restore();
  }
  // Tyr's balance.
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, -44); g.lineTo(0, 40); g.moveTo(-34, -30); g.lineTo(34, -30); g.moveTo(-18, 40); g.lineTo(18, 40); g.stroke();
  g.lineWidth = 3;
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(sx * 34, -30); g.lineTo(sx * 22, 0); g.moveTo(sx * 34, -30); g.lineTo(sx * 46, 0); g.stroke();
    g.beginPath(); g.arc(sx * 34, 0, 13, 0, Math.PI); g.stroke();
  }
  _sigil = new THREE.CanvasTexture(c);
  return _sigil;
}

let _scorch = null;
let _zTex = null;
/** A hand-lettered "z" (sleep glyph) with a soft glow. */
function zGlyphTexture() {
  if (_zTex) return _zTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = 'italic 700 50px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(170,150,255,0.9)';
  g.shadowBlur = 10;
  g.fillStyle = '#ffffff';
  g.fillText('z', 32, 30);
  _zTex = new THREE.CanvasTexture(c);
  _zTex.colorSpace = THREE.SRGBColorSpace;
  return _zTex;
}

let _wispTex = null;
/** A soft wavering S-curl of vapour (stink lines). */
function wispTexture() {
  if (_wispTex) return _wispTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,255,255,0.8)';
  g.shadowBlur = 6;
  g.beginPath();
  for (let y = 58; y >= 6; y -= 2) {
    const x = 16 + Math.sin(y * 0.16) * 7;
    if (y === 58) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  _wispTex = new THREE.CanvasTexture(c);
  return _wispTex;
}

function scorchTexture() {
  if (_scorch) return _scorch;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) {
    const a = hashf(i) * Math.PI * 2;
    const r = 20 + hashf(i + 9) * 44;
    g.fillStyle = `rgba(255,255,255,${hashf(i + 3) * 0.4})`;
    g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + hashf(i + 5) * 5, 2);
  }
  _scorch = new THREE.CanvasTexture(c);
  // The texture is used as an alpha mask (black colour).
  return _scorch;
}
