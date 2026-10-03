/**
 * GPU "sculpted" figure renderer: sphere-traces the analytic volumes of a
 * sculpt.js Figure as signed distance fields on WebGL2.
 *
 * Unlike the CPU caster (which only blends normals), volumes of one group are
 * fused with a polynomial smooth-min, so shoulders, knuckles, cheekbones and
 * brows melt into each other like modelling clay instead of meeting at seams.
 * Cloth carries real fold geometry (sharp hanging ridges around the axis of a
 * robe or sleeve, deepening toward the hem), hair carries strand relief, and
 * the lighting is the sculpt.js model evaluated per pixel with SDF soft
 * shadows, SDF ambient occlusion and thickness-based translucency (ears and
 * fingers glow against the light).
 *
 * Performance: an orthographic camera means every pixel's ray stays inside its
 * screen tile, so the CPU bins primitives into 16 px tiles (and, for shadow
 * rays, into tiles of the key light's orthographic view) and each fragment only
 * evaluates the handful of volumes that can touch it.
 *
 * renderFigureGL(fig, opts, prepared) → same result shape as renderFigure, or
 * null when WebGL2 / float render targets are unavailable (the caller falls
 * back to the CPU renderer).
 */

const TILE = 16;
const PRIM_TEX = 8; // texels per primitive
const MAT_TEX = 4; // texels per material
const IDX_W = 2048;
const PATTERNS = { scales: 1, fur: 2, cloth: 3, leather: 4, metal: 5, mail: 6, wood: 7, skin: 8, bone: 9, stone: 10 };

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise(vec2 p) { return vnoise3(vec3(p, 0.37)); }
float fbm3(vec3 p) { return vnoise3(p) * 0.533 + vnoise3(p * 2.03 + 17.1) * 0.267 + vnoise3(p * 4.1 + 3.7) * 0.2; }
float fbm(vec2 p) { return fbm3(vec3(p, 1.3)); }
`;

const MAXP = 512; // primitives per figure (uniform block of 8 vec4 each)
const MAXL = 96; // primitives per tile list

const FS_HEAD = `${COMMON}
layout(std140) uniform Prims { vec4 PR[${MAXP * PRIM_TEX}]; };
uniform sampler2D uMats;    // MAT_TEX texels per material
uniform sampler2D uIdx;     // primitive index lists
vec4 P_(int i, int k) { return PR[i * ${PRIM_TEX} + k]; }
vec4 M_(int m, int k) { return texelFetch(uMats, ivec2(m * ${MAT_TEX} + k, 0), 0); }
int idxAt(int o) { return int(texelFetch(uIdx, ivec2(o % ${IDX_W}, o / ${IDX_W}), 0).r + 0.5); }

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;
  vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv); float y2 = y * y * l2; float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r); float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdRBox(vec3 p, vec3 h, float rad) { vec3 q = abs(p) - h + rad; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - rad; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }

// hanging fold ridges around a cone's axis, deepening toward its wide end
float folds(vec3 r, vec3 ax, vec3 e1, vec3 e2, float L, vec4 d) {
  float u = clamp(dot(r, ax) / L, 0.0, 1.0);
  float ang = atan(dot(r, e2), dot(r, e1));
  float wob = vnoise3(vec3(ang * 1.3, u * 2.5, d.w)) * 2.4;
  float s = 0.5 + 0.5 * sin(ang * d.y + wob + u * d.z);
  float ridge = 1.0 - (1.0 - s) * (1.0 - s);
  return d.x * (ridge - 0.5) * (0.25 + 0.75 * u);
}

float primD(int i, vec3 p, vec4 h) {
  vec4 g1 = P_(i, 1); vec4 g2 = P_(i, 2);
  float d;
  if (h.x < 0.5) {
    d = sdRoundCone(p, g1.xyz, g2.xyz, g1.w, g2.w);
    vec4 dsp = P_(i, 6);
    if (dsp.x > 0.0 && d < dsp.x * 2.0) {
      vec3 ax = g2.xyz - g1.xyz; float L = length(ax); ax /= max(L, 1e-6);
      d -= folds(p - g1.xyz, ax, P_(i, 3).xyz, P_(i, 4).xyz, L, dsp);
    }
  } else {
    vec3 q = p - g1.xyz;
    vec3 l = vec3(dot(P_(i, 3).xyz, q), dot(P_(i, 4).xyz, q), dot(P_(i, 5).xyz, q));
    d = h.x < 1.5 ? sdEll(l, g2.xyz) : sdRBox(l, g2.xyz, g1.w);
    vec4 dsp = P_(i, 6);
    if (dsp.x > 0.0 && d < dsp.x * 2.0) {
      float s = vnoise3(vec3(l.x * dsp.y, l.y * dsp.y * 0.18, l.z * dsp.y + dsp.w));
      s += vnoise3(vec3(l.x * dsp.y * 2.3, l.y * dsp.y * 0.3, l.z * dsp.y * 2.3)) * 0.5;
      d -= dsp.x * (s / 1.5 - 0.5);
    }
  }
  return d;
}

// analytic entry distance of a ray into a volume's undisplaced, unblended shape (1e9 = miss)
float hitPrim(int i, vec3 ro, vec3 rd) {
  vec4 h = P_(i, 0); vec4 g1 = P_(i, 1); vec4 g2 = P_(i, 2);
  if (h.x < 0.5) {
    vec3 pa = g1.xyz; vec3 pb = g2.xyz; float ra = g1.w; float rb = g2.w;
    vec3 ba = pb - pa; vec3 oa = ro - pa; vec3 ob = ro - pb; float rr = ra - rb;
    float m0 = dot(ba, ba); float m1 = dot(ba, oa); float m2 = dot(ba, rd); float m3 = dot(rd, oa);
    float m5 = dot(oa, oa); float m6 = dot(ob, rd); float m7 = dot(ob, ob);
    float d2 = m0 - rr * rr; float k2 = d2 - m2 * m2;
    float k1 = d2 * m3 - m1 * m2 + m2 * rr * ra; float k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2.0 - m0 * ra * ra;
    float hh = k1 * k1 - k0 * k2;
    if (hh >= 0.0 && abs(k2) > 1e-12) {
      float t = (-sqrt(hh) - k1) / k2; float y = m1 - ra * rr + t * m2;
      if (y > 0.0 && y < d2) return t;
    }
    float h1 = m3 * m3 - m5 + ra * ra; float h2 = m6 * m6 - m7 + rb * rb;
    float t = 1e9;
    if (h1 >= 0.0) t = -m3 - sqrt(h1);
    if (h2 >= 0.0) t = min(t, -m6 - sqrt(h2));
    return t;
  }
  vec3 r0 = P_(i, 3).xyz; vec3 r1 = P_(i, 4).xyz; vec3 r2 = P_(i, 5).xyz;
  vec3 q = ro - g1.xyz;
  vec3 lo = vec3(dot(r0, q), dot(r1, q), dot(r2, q));
  vec3 ld = vec3(dot(r0, rd), dot(r1, rd), dot(r2, rd));
  if (h.x < 1.5) {
    vec3 e = g2.xyz; vec3 o2 = lo / e; vec3 d2 = ld / e;
    float a = dot(d2, d2); float b = dot(o2, d2); float c = dot(o2, o2) - 1.0;
    float hh = b * b - a * c;
    return hh < 0.0 ? 1e9 : (-b - sqrt(hh)) / a;
  }
  vec3 m = 1.0 / (ld + vec3(1e-9)); vec3 n = m * lo; vec3 k = abs(m) * g2.xyz;
  vec3 t1 = -n - k; vec3 t2 = -n + k;
  float tn = max(max(t1.x, t1.y), t1.z); float tf = min(min(t2.x, t2.y), t2.z);
  return (tn > tf || tf < 0.0) ? 1e9 : tn;
}

int L_[${MAXL}];
int LN;
void loadList(int off, int cnt) {
  LN = min(cnt, ${MAXL});
  for (int j = 0; j < ${MAXL}; j++) { if (j >= LN) break; L_[j] = idxAt(off + j); }
}


// scene distance over the loaded list; best = nearest primitive
float mapB(vec3 p, out int best) {
  float res = 1e9; float acc = 1e9; float gid = -2.0; float kcur = 0.0; float bd = 1e9; best = -1;
  // groups compete by their blended (carved) distance, and inside the winning group the nearest
  // volume lends its material: a small feature of one group (a brow) no longer steals the colour of
  // another group's smooth-union bulge around it, and a carved-away shell (an eyelid over the
  // eyeball) never lends its material to what lies inside
  float gbd = 1e9; int gbest = -1;
  for (int j = 0; j < ${MAXL}; j++) {
    if (j >= LN) break;
    int i = L_[j];
    vec4 h = P_(i, 0);
    vec4 bs = P_(i, 7);
    float lo = length(p - bs.xyz) - bs.w; // bounding sphere: lower bound of this volume's distance
    if (h.y < 0.0 || h.y != gid) {
      if (gbest >= 0 && acc < bd) { bd = acc; best = gbest; }
      res = min(res, acc); acc = 1e9; gid = h.y; kcur = abs(h.z);
      gbd = 1e9; gbest = -1;
    }
    if (h.z < 0.0 ? lo > 0.03 : lo > min(res, acc) + 0.06) continue;
    float d = primD(i, p, h);
    if (h.z < 0.0) { acc = smax(acc, -d, -h.z); continue; }
    if (d < gbd) { gbd = d; gbest = i; }
    float k = min(kcur, h.z);
    float pre = acc;
    acc = (h.y < 0.0 || acc > 1e8) ? min(acc, d) : smin(acc, d, k);
    if (d < pre) kcur = h.z;
  }
  if (gbest >= 0 && acc < bd) { bd = acc; best = gbest; }
  return min(res, acc);
}
float mapD(vec3 p) {
  float res = 1e9; float acc = 1e9; float gid = -2.0; float kcur = 0.0;
  for (int j = 0; j < ${MAXL}; j++) {
    if (j >= LN) break;
    int i = L_[j];
    vec4 h = P_(i, 0);
    vec4 bs = P_(i, 7);
    float lo = length(p - bs.xyz) - bs.w;
    if (h.y < 0.0 || h.y != gid) { res = min(res, acc); acc = 1e9; gid = h.y; kcur = abs(h.z); }
    if (h.z < 0.0 ? lo > 0.03 : lo > min(res, acc) + 0.06) continue;
    float d = primD(i, p, h);
    if (h.z < 0.0) { acc = smax(acc, -d, -h.z); continue; }
    float k = min(kcur, h.z);
    float pre = acc;
    acc = (h.y < 0.0 || acc > 1e8) ? min(acc, d) : smin(acc, d, k);
    if (d < pre) kcur = h.z;
  }
  return min(res, acc);
}
float hitList(vec3 ro, vec3 rd) {
  float t = 1e9;
  for (int j = 0; j < ${MAXL}; j++) { if (j >= LN) break; if (P_(L_[j], 0).z < 0.0) continue; t = min(t, hitPrim(L_[j], ro, rd)); }
  return t;
}
uniform vec2 uMarch; // start margin before the hard surface, reach behind it
// sphere-trace the smooth surface starting just before the analytic hard-union hit
float traceList(vec3 ro, vec3 rd, float eps) {
  float th = hitList(ro, rd);
  if (th > 1e8) return -1.0;
  float t = max(0.0, th - uMarch.x);
  float tmax = th + uMarch.y;
  for (int s = 0; s < 28; s++) {
    float d = mapD(ro + rd * t);
    if (d < eps) return t;
    t += d * 0.95;
    if (t > tmax) break;
  }
  return th;
}
`;

// Light-view depth pass: orthographic rays from the key light through the figure.
const FS_LIGHT = `${FS_HEAD}
uniform sampler2D uLTiles;
uniform vec2 uSize;
uniform vec4 uLOrigin; // x0, y1, SP, eps
uniform mat3 uLvT;     // light -> view
uniform vec3 uKey;     // toward the light (view space)
out vec4 o;
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec2 lxy = vec2(uLOrigin.x + fc.x / uLOrigin.z, uLOrigin.y - fc.y / uLOrigin.z);
  vec4 T = texelFetch(uLTiles, ivec2(floor(fc / ${TILE}.0)), 0);
  o = vec4(-1e9);
  int cnt = int(T.y + 0.5);
  if (cnt == 0) return;
  loadList(int(T.x + 0.5), cnt);
  float zt = T.z + 0.01;
  vec3 ro = uLvT * vec3(lxy, zt);
  float t = traceList(ro, -uKey, uLOrigin.w);
  if (t >= 0.0) o = vec4(zt - t);
}`;

const FS_TRACE = `${FS_HEAD}
uniform sampler2D uTiles;   // per screen tile: offset, count, zmax, zmin
uniform sampler2D uShadow;  // light-view depth (light z of the nearest surface)
uniform vec2 uSize;         // W, H (pixels)
uniform vec3 uView;         // P (px/unit), offX, offY
uniform vec4 uLOrigin;      // light-space x0, y1, SP, enabled
uniform vec2 uLSize;
uniform mat3 uLr;           // view -> light space
uniform mat3 uVT;           // view -> figure (world) space
uniform vec3 uKey; uniform vec3 uKeyC; uniform float uKeyI;
uniform vec3 uRim; uniform vec3 uRimC; uniform float uRimI;
uniform vec3 uSky; uniform vec3 uGnd; uniform float uAmb;
uniform vec3 uFill; uniform vec3 uFillC; uniform float uFillI;
uniform vec4 uHaze;         // rgb, amount
uniform vec4 uGhost;        // rgb, on
uniform vec4 uFig;          // yFeet px, figH px, zmin, eps
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAux;  // depth, group+2, lum, ink

float shadowAt(vec3 p, vec3 n) {
  if (uLOrigin.w < 0.5) return 1.0;
  vec3 lp = uLr * (p + n * 0.006);
  vec2 st = vec2((lp.x - uLOrigin.x) * uLOrigin.z, (uLOrigin.y - lp.y) * uLOrigin.z) - 0.5;
  float bias = 2.5 / uLOrigin.z;
  float lit = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 q = st + vec2(float(x), float(y)) * 0.75;
    ivec2 iq = ivec2(floor(q + 0.5));
    if (iq.x < 0 || iq.y < 0 || float(iq.x) >= uLSize.x || float(iq.y) >= uLSize.y) { lit += 1.0; continue; }
    float z = texelFetch(uShadow, ivec2(iq.x, int(uLSize.y) - 1 - iq.y), 0).r;
    lit += lp.z >= z - bias ? 1.0 : 0.0;
  }
  return lit / 25.0;
}

void surfaceUV(int i, vec3 p, vec3 n, out vec2 uv, out vec3 tu, out vec3 tv) {
  vec4 h = P_(i, 0);
  vec4 g1 = P_(i, 1); vec4 g2 = P_(i, 2);
  if (h.x < 0.5) {
    vec3 ax = normalize(g2.xyz - g1.xyz + 1e-6);
    vec3 e1 = P_(i, 3).xyz; vec3 e2 = P_(i, 4).xyz;
    vec3 q = p - g1.xyz;
    uv = vec2(dot(q, ax), atan(dot(q, e2), dot(q, e1)) * (g1.w + g2.w) * 0.5);
    tu = ax;
  } else {
    vec3 q = p - g1.xyz;
    vec3 r0 = P_(i, 3).xyz; vec3 r1 = P_(i, 4).xyz; vec3 r2 = P_(i, 5).xyz;
    vec3 l = vec3(dot(r0, q), dot(r1, q), dot(r2, q));
    if (h.x < 1.5) { vec3 e = g2.xyz; vec3 lu = l / e; uv = vec2(asin(clamp(lu.y, -1.0, 1.0)) * e.y, atan(lu.x, lu.z) * (e.x + e.z) * 0.5); }
    else uv = vec2(l.y, l.x + l.z);
    tu = vec3(r0.y, r1.y, r2.y);
  }
  tu = normalize(tu - n * dot(tu, n) + 1e-6);
  tv = cross(n, tu);
}

float hash2i(vec2 p) { return hash3(vec3(p, 7.13)); }

float pattern(int pat, float s, vec2 uv, vec3 tu, vec3 tv, vec3 wp, inout vec3 n, out vec3 extra) {
  float u = uv.x; float v = uv.y; float k = 1.0; float du = 0.0; float dv = 0.0; extra = vec3(0.0);
  if (pat == 1) { // scales: overlapping rows, each scale domed, lit on its root and tucked under the next row
    u += (vnoise(vec2(u, v) / (s * 6.0)) - 0.5) * s * 0.9;
    v += (vnoise(vec2(u, v) / (s * 6.0) + vec2(9.0, 4.0)) - 0.5) * s * 0.9;
    float rh = s * 0.62;
    float row = floor(u / rh); float fu = u / rh - row;
    float vv = v / s + mod(row, 2.0) * 0.5; float col = floor(vv); float fv = (vv - col - 0.5) * 2.0;
    // rounded free edge: the scale's outline is a U opening toward the root
    float edgeD = fu + fv * fv * 0.55;
    float seam = smoothstep(0.86, 1.08, edgeD);
    float rnd = hash2i(vec2(row, col));
    du = (0.5 - fu) * 0.55; dv = -fv * 0.4;
    k = (0.88 + rnd * 0.2) * (1.08 - fu * 0.3) * (1.0 - seam * 0.32) * (0.86 + fbm(vec2(u, v) / (s * 9.0)) * 0.28);
    extra.x = 0.0; extra.z = clamp((rnd - 0.62) * 2.2, 0.0, 1.0);
  } else if (pat == 2) { // fur / hair
    float n1 = vnoise(vec2(u / (s * 2.4), v / (s * 0.22)));
    float n2 = vnoise(vec2(u / (s * 0.9) + 7.0, v / (s * 0.12) + 3.0));
    dv = (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.5; du = (vnoise(vec2(u, v) / (s * 0.5)) - 0.5) * 0.3;
    k = 0.68 + n1 * 0.4 + n2 * 0.14;
  } else if (pat == 3) { // cloth weave + soft creases (big folds are geometry)
    float fold = sin(v / (s * 1.4) + fbm(vec2(u, v) / (s * 6.0)) * 5.0);
    float weave = sin(u / (s * 0.06)) * sin(v / (s * 0.06)) * 0.05;
    dv = fold * 0.12 + weave; du = (vnoise(vec2(u, v) / (s * 3.0)) - 0.5) * 0.2;
    k = 0.88 + fold * 0.04 + fbm(vec2(u, v) / (s * 2.0)) * 0.16;
  } else if (pat == 4) { // leather
    float nn = fbm(vec2(u, v) / (s * 1.5)); float w = vnoise(vec2(u / (s * 0.25), v / (s * 0.9)));
    du = (nn - 0.5) * 0.35; dv = (w - 0.5) * 0.25; k = 0.74 + nn * 0.36;
  } else if (pat == 5) { // metal
    float br = vnoise(vec2(u / (s * 4.0), v / (s * 0.08))); float dent = vnoise(vec2(u / (s * 1.2) + 11.0, v / (s * 1.2)));
    du = (dent - 0.5) * 0.25; dv = (br - 0.5) * 0.12; k = 0.82 + br * 0.18 - (dent > 0.78 ? 0.12 : 0.0);
    extra.y = max(0.0, fbm3(wp * 9.0 + 3.0) - 0.62) * 2.4;
  } else if (pat == 6) { // mail
    float row = floor(u / (s * 0.22)); float vv = v / (s * 0.22) + mod(row, 2.0) * 0.5;
    float fu = u / (s * 0.22) - row - 0.5; float fv = vv - floor(vv) - 0.5; float r = length(vec2(fu, fv));
    float ring = abs(r - 0.32) < 0.13 ? 1.0 : 0.0; du = ring * fu * 0.9; dv = ring * fv * 0.9; k = ring > 0.5 ? 1.08 : 0.45;
  } else if (pat == 7) { // wood
    float gg = sin(v / (s * 0.1) + fbm(vec2(u / (s * 3.0), v / (s * 0.5))) * 6.0); k = 0.8 + gg * 0.12; dv = gg * 0.12;
  } else if (pat == 8) { // skin: pores, mottling, broad blotches of colour and value (no two square inches alike)
    float nn = fbm3(wp / (s * 1.2)); float pore = vnoise3(wp / (s * 0.12));
    float blot = fbm3(wp / (s * 7.0) + 5.0);
    k = 0.84 + nn * 0.16 + (blot - 0.5) * 0.28; du = (nn - 0.5) * 0.18 + (pore - 0.5) * 0.08; dv = (pore - 0.5) * 0.08;
    extra.x = -1.0 - clamp(blot * 1.6 - 0.45, 0.0, 1.0); // flush (decoded below)
  } else if (pat == 9) { // bone
    float nn = fbm(vec2(u / (s * 1.4), v / (s * 0.8))); float crack = abs(vnoise(vec2(u / (s * 0.7), v / (s * 0.3))) - 0.5) < 0.03 ? 0.6 : 1.0;
    k = (0.8 + nn * 0.3) * crack; du = (nn - 0.5) * 0.3;
  } else if (pat == 10) { // stone
    float nn = fbm3(wp / s); k = 0.75 + nn * 0.4; du = (nn - 0.5) * 0.5; dv = (vnoise3(wp / (s * 0.3)) - 0.5) * 0.3;
  } else return 1.0;
  n = normalize(n + tu * du + tv * dv);
  return k;
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  float P = uView.x;
  vec2 xy = vec2((fc.x - uView.y) / P, -(fc.y - uView.z) / P);
  vec4 T = texelFetch(uTiles, ivec2(floor(fc / ${TILE}.0)), 0);
  int cnt = int(T.y + 0.5);
  oColor = vec4(0.0); oAux = vec4(0.0);
  if (cnt == 0) return;
  loadList(int(T.x + 0.5), cnt);
  float eps = uFig.w;
  vec3 ro = vec3(xy, T.z + 0.01);
  float t = traceList(ro, vec3(0.0, 0.0, -1.0), eps);
  if (t < 0.0) return;
  vec3 p = ro + vec3(0.0, 0.0, -t);
  int best;
  mapB(p, best);
  vec2 kk = vec2(1.0, -1.0) * eps * 1.2;
  vec3 n = normalize(kk.xyy * mapD(p + kk.xyy) + kk.yyx * mapD(p + kk.yyx) + kk.yxy * mapD(p + kk.yxy) + kk.xxx * mapD(p + kk.xxx));
  vec4 hb = P_(best, 0);
  int mi = int(hb.w + 0.5);
  // material blend across the smooth joint
  vec3 col = vec3(0.0); float wsum = 0.0;
  if (hb.y >= 0.0) {
    for (int j = 0; j < ${MAXL}; j++) {
      if (j >= LN) break;
      int i = L_[j];
      vec4 h = P_(i, 0);
      if (h.y != hb.y || h.z < 0.0) continue;
      vec4 bs = P_(i, 7);
      float k = max(h.z, hb.z) * 0.6 + 1e-4;
      if (length(p - bs.xyz) - bs.w > k) continue;
      float di = primD(i, p, h);
      float w = clamp(1.0 - max(di, 0.0) / k, 0.0, 1.0); w = w * w * (i == best ? 1.0 : 0.85) / max(bs.w, 1e-3); // the smaller enclosing volume (lips, a blush on the cheek) wins over the mass it sits in
      if (w <= 0.0) continue;
      col += M_(int(h.w + 0.5), 0).rgb * w; wsum += w;
    }
  }
  vec4 m0 = M_(mi, 0); vec4 m1 = M_(mi, 1); vec4 m2 = M_(mi, 2); vec4 m3 = M_(mi, 3);
  vec3 base = wsum > 0.0 ? col / wsum : m0.rgb;
  float rough = m0.a; float specK = m1.x; bool metal = m1.y > 0.5; float sss = m1.z;
  int pat = int(m3.a + 0.5); float pscale = m2.a;
  vec3 wp = uVT * p;
  vec3 extra = vec3(0.0);
  vec3 nb = n;
  if (pat > 0) {
    vec2 uv; vec3 tu; vec3 tv;
    surfaceUV(best, p, n, uv, tu, tv);
    vec3 np = n;
    // scaled hides are countershaded: a dark dorsal hide of big plates over the back and the tops of
    // the limbs, a pale belly of fine scales underneath (tint2 is the belly colour for scales)
    float ventral = 0.0;
    if (pat == 1) {
      vec3 nf = normalize(uVT * nb);
      ventral = max(smoothstep(0.66, 0.97, nf.z - abs(nf.x) * 0.25), smoothstep(0.3, 0.85, -nf.y));
      pscale *= mix(1.45, 0.75, ventral);
    }
    float k = pattern(pat, pscale, uv, tu, tv, wp, np, extra);
    n = normalize(nb * 0.45 + np * 0.55);
    base *= k;
    if (pat == 1 && m3.r + m3.g + m3.b > 0.0) {
      base = mix(base * mix(0.82, 1.0, extra.z), m3.rgb * k, ventral * 0.85);
    } else if (extra.z > 0.0 && m3.r + m3.g + m3.b > 0.0) base = mix(base, m3.rgb * k, extra.z);
    if (extra.x < -0.5) base = mix(base, base * vec3(1.12, 0.84, 0.8), (-extra.x - 1.0) * 0.55); // ruddy flush on skin
  }
  // broad value drift over every non-metal surface: worn, sun-faded, dirty patches
  if (!metal) base *= 0.9 + fbm3(wp * 6.0 + 17.0) * 0.2;
  if (metal && extra.y > 0.0) base = mix(base, vec3(0.36, 0.2, 0.1), min(0.7, extra.y));
  float sh = shadowAt(p, nb);
  float occ = 0.0; float sc = 1.0;
  for (int a = 1; a <= 3; a++) {
    float hh = 0.012 * float(a);
    occ += (hh - mapD(p + nb * hh)) * sc; sc *= 0.7;
  }
  float ao = clamp(1.0 - occ * 9.0, 0.3, 1.0);
  float thick = 0.0;
  if (sss > 0.3) { float hh = 0.02; thick = clamp(max(0.0, -mapD(p - nb * hh)) / hh, 0.0, 1.0); }
  float hgt = clamp((uFig.x - fc.y) / max(1.0, uFig.y), 0.0, 1.0);
  float footDark = 0.66 + 0.34 * min(1.0, hgt * 4.5);
  float ndl = dot(n, uKey);
  float diff = max(0.0, (ndl + sss) / (1.0 + sss)) * sh;
  float hemi = n.y * 0.5 + 0.5;
  vec3 ambC = mix(uGnd, uSky, hemi) * uAmb * ao;
  vec3 fillC = uFillC * max(0.0, dot(n, uFill)) * uFillI;
  float fres = 1.0 - max(0.0, n.z);
  float rimT = max(0.0, dot(n, uRim) + 0.35) * pow(fres, 2.2) * uRimI * mix(0.6, 1.0, ao);
  float shin = 6.0 + (1.0 - rough) * 90.0;
  vec3 hv = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = specK * pow(max(0.0, dot(n, hv)), shin) * sh * uKeyI * (metal ? 2.2 : 1.0);
  float dk = uKeyI * diff;
  vec3 c;
  if (metal) {
    c = base * (dk * 0.55 * uKeyC + ambC * 0.8 + fillC) + spec * uKeyC * (0.4 + base) + mix(uGnd, uSky, hemi) * 0.25 * base * ao + rimT * uRimC * (0.5 + base);
  } else {
    spec *= 0.38; // matte: skin, cloth and leather keep only a soft sheen
    float term = sss > 0.3 ? max(0.0, 1.0 - abs(ndl) * 3.0) * 0.2 * sh : 0.0;
    vec3 scatter = vec3(1.25, 0.4, 0.22) * term;
    float trans = sss > 0.3 ? pow(max(0.0, dot(-n, uKey)), 2.0) * (1.0 - thick) * 0.5 : 0.0;
    c = base * (dk * uKeyC + ambC + fillC) + spec * uKeyC + rimT * uRimC * (0.35 + base * 0.6) + base * scatter + uKeyC * vec3(1.0, 0.45, 0.3) * trans * base * 1.4;
  }
  c *= footDark * mix(1.0, ao, 0.55);
  // warm bounce off the floor into the lower body: figures sit in their scene's light
  c += base * uGnd * pow(1.0 - hgt, 2.0) * max(0.0, -n.y * 0.6 + 0.4) * 0.9;
  c += m2.rgb;
  c = c / (1.0 + c * 0.28) * 1.18;
  float dz = clamp((p.z - uFig.z) * 3.0, 0.0, 1.0);
  float hz = min(0.92, uHaze.a * (1.08 - dz * 0.16));
  if (hz > 0.0) c = mix(c, uHaze.rgb, hz);
  float lum = diff * 0.7 + fres * 0.3;
  if (uGhost.a > 0.5) {
    float L = min(1.4, 0.18 + diff * 0.55 + spec * 0.6 + rimT * 0.9 + (dot(m2.rgb, vec3(1.0)) > 0.0 ? 1.0 : 0.0));
    c = uGhost.rgb * L; lum = 0.3 + fres * 0.7;
  }
  oColor = vec4(c, 1.0);
  oAux = vec4(p.z, hb.y + 2.0, lum, m1.w);
}`;

// Painterly Kuwahara + ink contour + ghost alpha, written premultiplied to the canvas.
const FS_POST = `${COMMON}
uniform sampler2D uColor;
uniform sampler2D uAux;
uniform vec2 uSize;
uniform int uKr;
uniform float uInk;
uniform float uThr;
uniform int uRad;
uniform vec4 uGhost;
uniform vec2 uFeet; // yFeet px, figH px
out vec4 o;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy); // FBO rows match the canvas rows
  ivec2 S = ivec2(uSize);
  vec4 a0 = texelFetch(uAux, q, 0);
  if (a0.w <= 0.0 && a0.y == 0.0) { o = vec4(0.0); return; }
  vec3 c = texelFetch(uColor, q, 0).rgb;
  if (uKr > 0 && uGhost.a < 0.5) {
    float best = 1e9; vec3 bc = c;
    for (int k = 0; k < 4; k++) {
      ivec2 dir = ivec2((k & 1) == 1 ? 1 : -1, (k & 2) == 2 ? 1 : -1);
      vec3 s = vec3(0.0); float l1 = 0.0; float l2 = 0.0; float cnt = 0.0;
      for (int y = 0; y <= 3; y++) for (int x = 0; x <= 3; x++) {
        if (x > uKr || y > uKr) continue;
        ivec2 pp = clamp(q + dir * ivec2(x, y), ivec2(0), S - 1);
        vec4 ax = texelFetch(uAux, pp, 0);
        if (ax.y == 0.0) continue;
        vec3 cc = texelFetch(uColor, pp, 0).rgb;
        float l = dot(cc, vec3(0.3, 0.59, 0.11));
        s += cc; l1 += l; l2 += l * l; cnt += 1.0;
      }
      if (cnt < 1.0) continue;
      float m = l1 / cnt; float v = l2 / cnt - m * m;
      if (v < best) { best = v; bc = s / cnt; }
    }
    c = bc;
  }
  // ink: silhouette + depth discontinuities (softer inside one smooth group)
  float e = 0.0;
  for (int d = 1; d <= 3; d++) {
    if (d > uRad) break;
    for (int k = 0; k < 4; k++) {
      ivec2 off = k == 0 ? ivec2(d, 0) : k == 1 ? ivec2(-d, 0) : k == 2 ? ivec2(0, d) : ivec2(0, -d);
      ivec2 pp = q + off;
      if (pp.x < 0 || pp.y < 0 || pp.x >= S.x || pp.y >= S.y) { e = max(e, 1.0); continue; }
      vec4 ax = texelFetch(uAux, pp, 0);
      if (ax.y == 0.0) { e = max(e, 1.0); continue; }
      float dz = ax.x - a0.x;
      if (dz > uThr) e = max(e, min(1.0, (dz - uThr) / (uThr * 2.0)) * ((ax.y == a0.y && a0.y >= 2.0) ? 0.35 : 0.8));
    }
  }
  e *= a0.w;
  float alpha = 1.0;
  if (uGhost.a > 0.5) {
    c = mix(c, vec3(0.85, 1.0, 1.0), e * 0.9);
    float lum = max(a0.z, e);
    float hgt = clamp((uFeet.x - (uSize.y - 1.0 - float(q.y))) / max(1.0, uFeet.y), 0.0, 1.0);
    alpha = clamp((0.22 + lum * 0.78) * min(1.0, 0.15 + hgt * 1.6), 0.0, 1.0);
  } else {
    c = mix(c, vec3(0.07, 0.04, 0.03), e * uInk);
  }
  o = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
}`;

let GL = null; // {canvas, gl, trace, post, ...} | false

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`sdfgl shader: ${log}`);
  }
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`sdfgl link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function init() {
  if (GL !== null) return GL;
  GL = false;
  if (typeof document === 'undefined') return GL;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true, depth: false, stencil: false });
    if (!gl || !gl.getExtension('EXT_color_buffer_float') || gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) < MAXP * PRIM_TEX * 16) return GL;
    const trace = program(gl, FS_TRACE);
    const light = program(gl, FS_LIGHT);
    const post = program(gl, FS_POST);
    for (const pr of [trace, light]) gl.uniformBlockBinding(pr.p, gl.getUniformBlockIndex(pr.p, 'Prims'), 0);
    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, MAXP * PRIM_TEX * 16, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    GL = { canvas, gl, trace, light, post, vao, ubo, tex: {}, fbo: gl.createFramebuffer(), lfbo: gl.createFramebuffer() };
    canvas.addEventListener('webglcontextlost', () => { GL = null; });
  } catch (e) {
    console.warn(String(e.message ?? e));
    GL = false;
  }
  return GL;
}

function texF(G, name, w, h, data, comps = 4) {
  const { gl } = G;
  let t = G.tex[name];
  if (!t) { t = gl.createTexture(); G.tex[name] = t; }
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (comps === 4) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  return t;
}

const hexc = (c) => {
  if (Array.isArray(c)) return c;
  const s = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c;
  return [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
};

/** Is the GPU path available? */
export function sdfAvailable() { return !!init(); }

/** Smallest radius of a primitive (limits its smooth-min radius so small parts keep their shape). */
function minRad(p) {
  if (p.type === 0) return Math.max(Math.min(p.ra, p.rb), Math.max(p.ra, p.rb) * 0.5);
  const e = p.type === 1 ? p.r : p.h;
  return Math.min(e[0], e[1], e[2]);
}

/** Bin primitives into tiles of a pixel grid. bbox(p) → [x0,x1,y0,y1,zmax,zmin] in pixels / units. */
function binTiles(prims, nx, ny, bbox, idx, byGroup) {
  const lists = Array.from({ length: nx * ny }, () => []);
  const zr = new Float32Array(nx * ny * 2);
  for (let k = 0; k < nx * ny; k++) { zr[k * 2] = -1e9; zr[k * 2 + 1] = 1e9; }
  const front = new Float32Array(prims.length);
  prims.forEach((p, i) => {
    const [x0, x1, y0, y1, zmax, zmin] = bbox(p);
    front[i] = zmax;
    const tx0 = Math.max(0, Math.floor(x0 / TILE)); const tx1 = Math.min(nx - 1, Math.floor(x1 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE)); const ty1 = Math.min(ny - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = ty * nx + tx;
      lists[k].push(i);
      if (zmax > zr[k * 2]) zr[k * 2] = zmax;
      if (zmin < zr[k * 2 + 1]) zr[k * 2 + 1] = zmin;
    }
  });
  const tiles = new Float32Array(nx * ny * 4);
  let over = 0;
  for (let k = 0; k < lists.length; k++) {
    let L = lists[k];
    if (L.length > MAXL) {
      // overfull tile (a face over a body over a cloak): keep the volumes nearest the eye, whole
      // smooth groups at a time, so what is dropped is hidden behind what is kept (truncating in
      // index order used to drop the head's last features — lids, carves — in square blocks)
      over++;
      const groups = new Map();
      for (const i of L) {
        const key = byGroup.key ? byGroup.key(i) : i;
        const g = key === -1 ? `s${i}` : key;
        if (!groups.has(g)) groups.set(g, { f: -1e9, m: [] });
        const G = groups.get(g);
        G.m.push(i);
        G.f = Math.max(G.f, front[i]);
      }
      const order = [...groups.values()].sort((a, b) => b.f - a.f);
      const keep = [];
      for (const G of order) {
        if (keep.length + G.m.length <= MAXL) keep.push(...G.m);
        else if (keep.length < MAXL) keep.push(...G.m.sort((a, b) => front[b] - front[a]).slice(0, MAXL - keep.length));
        if (keep.length >= MAXL) break;
      }
      L = keep;
    }
    L.sort(byGroup);
    tiles.set([idx.length, Math.min(MAXL, L.length), zr[k * 2], zr[k * 2 + 1]], k * 4);
    for (const i of L.slice(0, MAXL)) idx.push(i);
  }
  return { tiles, over };
}

/**
 * @param prims view-space primitives of the layer (from sculpt.js toView), with bboxes
 * @param shadowPrims the shadow casters: view-space geometry with LIGHT-space bboxes (x0..z1), or null
 * @param o {P, W, H, offX, offY, ss, VT, Lr (view→light), lighting..., haze, hz, ghost, ink, paint, inkDepth, yFeet, figH, zmin}
 * @returns {HTMLCanvasElement|null} W×H canvas (premultiplied, ss resolution)
 */
export function traceFigure(prims, shadowPrims, o) {
  const G = init();
  if (!G) return null;
  const { gl } = G;
  const { P, W, H, offX, offY } = o;
  // one primitive table: the layer's prims plus shadow-only casters (other layers)
  const all = prims.slice();
  const sIx = [];
  if (shadowPrims) {
    const pos = new Map(prims.map((p, i) => [p.src ?? p, i]));
    for (const q of shadowPrims) {
      let i = pos.get(q.src ?? q);
      if (i === undefined) { i = all.length; all.push(q); }
      sIx.push(i);
    }
  }
  if (all.length > MAXP || W * H > 4096 * 4096) return null;
  // ---- materials
  const mats = [];
  const matIx = new Map();
  const groups = new Map();
  const gid = (g) => { if (g == null) return -1; if (!groups.has(g)) groups.set(g, groups.size); return groups.get(g); };
  for (const p of all) if (!matIx.has(p.mat)) { matIx.set(p.mat, mats.length); mats.push(p.mat); }
  const md = new Float32Array(mats.length * MAT_TEX * 4);
  mats.forEach((m, i) => {
    const b = i * MAT_TEX * 4;
    md.set([m.color[0], m.color[1], m.color[2], m.rough], b);
    md.set([m.spec, m.metal ? 1 : 0, m.sss, m.ink ?? 1], b + 4);
    md.set([...(m.emissive ?? [0, 0, 0]), m.scale], b + 8);
    md.set([...(m.tint2 ?? [0, 0, 0]), PATTERNS[m.pattern] ?? 0], b + 12);
  });
  // ---- primitive table (uniform block)
  const pd = new Float32Array(MAXP * PRIM_TEX * 4);
  all.forEach((p, i) => {
    const b = i * PRIM_TEX * 4;
    const k = p.sub ? -Math.max(2e-4, Math.min(p.blend ?? 0.004, 0.03)) : Math.max(2e-4, Math.min(p.blend ?? 0, minRad(p) * 0.9, 0.05));
    pd.set([p.type, gid(p.group), k, matIx.get(p.mat)], b);
    const disp = p.disp ?? null;
    let bc; let br;
    if (p.type === 0) {
      pd.set([...p.va, p.ra], b + 4);
      pd.set([...p.vb, p.rb], b + 8);
      pd.set([...p.e1, 0], b + 12);
      pd.set([...p.e2, 0], b + 16);
      bc = [(p.va[0] + p.vb[0]) / 2, (p.va[1] + p.vb[1]) / 2, (p.va[2] + p.vb[2]) / 2];
      br = Math.hypot(p.vb[0] - p.va[0], p.vb[1] - p.va[1], p.vb[2] - p.va[2]) / 2 + Math.max(p.ra, p.rb);
    } else {
      const e = p.type === 1 ? p.r : p.h;
      pd.set([...p.vc, p.bevel ?? 0], b + 4);
      pd.set([...e, 0], b + 8);
      const R = p.vR;
      pd.set([R[0], R[3], R[6], 0], b + 12);
      pd.set([R[1], R[4], R[7], 0], b + 16);
      pd.set([R[2], R[5], R[8], 0], b + 20);
      bc = p.vc;
      br = p.type === 1 ? Math.max(e[0], e[1], e[2]) : Math.hypot(e[0], e[1], e[2]);
    }
    if (disp) pd.set([disp.amp, disp.freq, disp.twist ?? 0, disp.seed ?? 0], b + 24);
    pd.set([...bc, br + (disp?.amp ?? 0)], b + 28);
  });
  const byGroup = (a, b) => {
    const ga = gid(all[a].group); const gb = gid(all[b].group);
    return ga === gb ? a - b : ga - gb;
  };
  byGroup.key = (i) => gid(all[i].group);
  // ---- screen tiles (the margin covers the AO taps and smooth-min reach)
  const idx = [];
  const tnx = Math.ceil(W / TILE);
  const tny = Math.ceil(H / TILE);
  const scr = binTiles(prims, tnx, tny, (p) => {
    const m = Math.min(p.blend ?? 0, 0.05) + 0.04 + (p.disp?.amp ?? 0);
    return [(p.x0 - m) * P + offX, (p.x1 + m) * P + offX, -(p.y1 + m) * P + offY, -(p.y0 - m) * P + offY, p.z1 + 0.05 + (p.disp?.amp ?? 0), p.z0 - 0.05];
  }, idx, byGroup);
  // ---- light tiles + light depth pass
  let lOrigin = [0, 0, 1, 0]; let LW = 1; let LH = 1;
  let lnx = 1; let lny = 1; let ltiles = new Float32Array(4);
  if (shadowPrims?.length) {
    let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
    for (const q of shadowPrims) { a0 = Math.min(a0, q.x0); a1 = Math.max(a1, q.x1); b0 = Math.min(b0, q.y0); b1 = Math.max(b1, q.y1); }
    const SP = Math.min(P * 0.5, 1400 / Math.max(a1 - a0, b1 - b0, 0.1));
    a0 -= 0.05; a1 += 0.05; b0 -= 0.05; b1 += 0.05;
    LW = Math.max(1, Math.ceil((a1 - a0) * SP));
    LH = Math.max(1, Math.ceil((b1 - b0) * SP));
    lnx = Math.ceil(LW / TILE);
    lny = Math.ceil(LH / TILE);
    const sp = shadowPrims.map((q, j) => ({ q, i: sIx[j] }));
    const lidx = [];
    const res = binTiles(sp.map((e) => e.q), lnx, lny, (q) => {
      const m = Math.min(q.blend ?? 0, 0.05) + 0.01 + (q.disp?.amp ?? 0);
      return [(q.x0 - m - a0) * SP, (q.x1 + m - a0) * SP, (b1 - q.y1 - m) * SP, (b1 - q.y0 + m) * SP, q.z1 + 0.05, q.z0 - 0.05];
    }, lidx, Object.assign((x, y) => byGroup(sp[x].i, sp[y].i), { key: (x) => byGroup.key(sp[x].i) }));
    ltiles = res.tiles;
    // remap local indices to table indices and append after the screen lists
    const base = idx.length;
    for (let k = 0; k < ltiles.length; k += 4) ltiles[k] += base;
    for (const j of lidx) idx.push(sp[j].i);
    lOrigin = [a0, b1, SP, 1];
  }
  let maxDisp = 0;
  let carve = 0;
  for (const p of all) { maxDisp = Math.max(maxDisp, p.disp?.amp ?? 0); if (p.sub) carve = Math.max(carve, minRad(p) * 2); }
  const march = [0.016 + maxDisp * 0.6, maxDisp * 0.6 + 0.004 + Math.min(0.04, carve)];
  const idxH = Math.max(1, Math.ceil(idx.length / IDX_W));
  const idxData = new Float32Array(IDX_W * idxH);
  idxData.set(idx);
  // ---- upload
  gl.bindBuffer(gl.UNIFORM_BUFFER, G.ubo);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, pd);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, G.ubo);
  gl.activeTexture(gl.TEXTURE1); texF(G, 'mats', MAT_TEX * mats.length, 1, md);
  gl.activeTexture(gl.TEXTURE2); texF(G, 'idx', IDX_W, idxH, idxData, 1);
  gl.activeTexture(gl.TEXTURE3); texF(G, 'tiles', tnx, tny, scr.tiles);
  gl.activeTexture(gl.TEXTURE4); texF(G, 'ltiles', lnx, lny, ltiles);
  gl.bindVertexArray(G.vao);
  gl.disable(gl.BLEND);
  // light depth
  gl.activeTexture(gl.TEXTURE7); const tsh = texF(G, 'shadow', LW, LH, null);
  if (lOrigin[3]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.lfbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tsh, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, LW, LH);
    const { p: lp, u: lu } = G.light;
    gl.useProgram(lp);
    gl.uniform1i(lu.uMats, 1); gl.uniform1i(lu.uIdx, 2); gl.uniform1i(lu.uLTiles, 4);
    gl.uniform2f(lu.uSize, LW, LH);
    gl.uniform4f(lu.uLOrigin, lOrigin[0], lOrigin[1], lOrigin[2], 1.0 / lOrigin[2]);
    gl.uniformMatrix3fv(lu.uLvT, true, new Float32Array([o.Lr[0], o.Lr[3], o.Lr[6], o.Lr[1], o.Lr[4], o.Lr[7], o.Lr[2], o.Lr[5], o.Lr[8]]));
    gl.uniform3f(lu.uKey, ...o.keyV);
    gl.uniform2f(lu.uMarch, march[0], march[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (globalThis.__SDF_LOG) { const t0 = performance.now(); const px = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); console.log(`  light ${LW}x${LH} ${(performance.now() - t0).toFixed(0)}ms`); }
  }
  // main trace
  gl.activeTexture(gl.TEXTURE5); const tc = texF(G, 'rtColor', W, H, null);
  gl.activeTexture(gl.TEXTURE6); const ta = texF(G, 'rtAux', W, H, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, G.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tc, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, ta, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return null; }
  gl.viewport(0, 0, W, H);
  const { p: tp, u } = G.trace;
  gl.useProgram(tp);
  gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, tsh);
  gl.uniform1i(u.uMats, 1); gl.uniform1i(u.uIdx, 2); gl.uniform1i(u.uTiles, 3); gl.uniform1i(u.uShadow, 7);
  gl.uniform2f(u.uSize, W, H);
  gl.uniform3f(u.uView, P, offX, offY);
  gl.uniform4f(u.uLOrigin, ...lOrigin);
  gl.uniform2f(u.uLSize, LW, LH);
  gl.uniformMatrix3fv(u.uLr, true, new Float32Array(o.Lr ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]));
  gl.uniformMatrix3fv(u.uVT, true, new Float32Array(o.VT));
  gl.uniform3f(u.uKey, ...o.keyV); gl.uniform3f(u.uKeyC, ...o.kc); gl.uniform1f(u.uKeyI, o.ki);
  gl.uniform3f(u.uRim, ...o.rimV); gl.uniform3f(u.uRimC, ...o.rc); gl.uniform1f(u.uRimI, o.ri);
  gl.uniform3f(u.uSky, ...o.sky); gl.uniform3f(u.uGnd, ...o.gnd); gl.uniform1f(u.uAmb, o.amb);
  gl.uniform3f(u.uFill, ...(o.fill?.d ?? [0, 0, 1])); gl.uniform3f(u.uFillC, ...(o.fill?.c ?? [0, 0, 0])); gl.uniform1f(u.uFillI, o.fill?.i ?? 0);
  gl.uniform4f(u.uHaze, ...o.hz, o.haze);
  gl.uniform4f(u.uGhost, ...(o.ghost ?? [0, 0, 0]), o.ghost ? 1 : 0);
  gl.uniform4f(u.uFig, o.yFeet, o.figH, o.zmin, 0.4 / P);
  gl.uniform2f(u.uMarch, march[0], march[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (globalThis.__SDF_LOG) { const t0 = performance.now(); const px = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); console.log(`  trace ${(performance.now() - t0).toFixed(0)}ms lists>max ${scr.over} idx ${idx.length}`); }
  // ---- post to the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (G.canvas.width !== W || G.canvas.height !== H) { G.canvas.width = W; G.canvas.height = H; }
  gl.viewport(0, 0, W, H);
  const { p: pp, u: v } = G.post;
  gl.useProgram(pp);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, tc);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, ta);
  gl.uniform1i(v.uColor, 5); gl.uniform1i(v.uAux, 6);
  gl.uniform2f(v.uSize, W, H);
  gl.uniform1i(v.uKr, Math.min(3, o.paint));
  gl.uniform1f(v.uInk, o.ink);
  gl.uniform1f(v.uThr, 0.012 * (o.inkDepth ?? 1));
  gl.uniform1i(v.uRad, Math.min(3, Math.max(1, Math.round(o.ss * 0.75))));
  gl.uniform4f(v.uGhost, ...(o.ghost ?? [0, 0, 0]), o.ghost ? 1 : 0);
  gl.uniform2f(v.uFeet, o.yFeet, o.figH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d').drawImage(G.canvas, 0, 0);
  return out;
}

export { hexc };
