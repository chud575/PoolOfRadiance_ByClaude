/**
 * GLSL for the portrait painter's head: a signed-distance sculpt built the way
 * a portrait painter constructs a head — cranium, the frontal plane of the
 * forehead, brow ridge and sockets, the zygomatic arches, the maxilla and
 * muzzle barrel, the mandible from the ear to the chin, the nose as a wedge of
 * planes (bridge, side walls, ball, alae), lips, ears and neck. Every head
 * template and race moves these landmarks (headShader.headParams), so the
 * eight heads are eight skulls, not one skull with different hair.
 *
 * Units: head-local metres at human scale. Eyes at y = 0; the face looks down +z.
 */

export const HEAD_PARAMS = [
  'W', 'LONG', 'JAW', 'CHIN', 'CHEEK', 'NOSE', 'BRIDGE', 'TIP', 'HOOK', 'EYE',
  'SP', 'BROW', 'LIPS', 'MOUTH', 'LID', 'SLANT', 'EARS', 'BTILT', 'SMIRK', 'AGE',
  'FEM', 'CRAN', 'SLOPE', 'EDEPTH', 'HOLLOW', 'JDEPTH', 'PROT', 'ELF', 'NWIDTH', 'SMILE',
  'ASLEEP', 'HVOL', 'BLEN', 'HALF', 'GNOME', 'SCOWL', 'LINES', 'EOPEN', 'BTHICK',
];

export const GLSL_COMMON = /* glsl */`
float sat(float x) { return clamp(x, 0.0, 1.0); }
float h13(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float vnoise2(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
}
float fbm3(vec3 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.2; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-7);
}
float sdCap(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
// Tapered capsule (iq's round cone).
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

/** Feature anchors + the skin field. Expects the parameter #defines and GLSL_COMMON. */
export const GLSL_HEAD = /* glsl */`
float EX() { return 0.0312 * SP * (0.9 + 0.1 * W); }
float ER() { return 0.0124 * sqrt(EYE) * (1.0 + 0.07 * FEM); }
float EZ() { return 0.0688 - 0.002 * EDEPTH; }
float LOWF() { return LONG * (1.0 - 0.08 * FEM); }
float MOUTHY() { return -0.0665 * LOWF(); }
float TIPY() { return -0.037 * NOSE * (0.9 + 0.1 * LONG) * (1.0 - 0.12 * FEM); }
float TIPZ() { return 0.104 + 0.011 * (NOSE - 1.0) - 0.0055 * FEM; }
float LIPZ() { return 0.0905 + 0.004 * PROT - 0.003 * FEM; }

// Upper and lower lid lines (y, head-local) at a point beside the eye: an almond, the outer
// corner a touch higher, the upper lid over the top of the iris.
vec2 lidLines(vec3 q) {
  float ex = EX();
  float sl = 0.15 * SLANT;
  float open = EOPEN * (1.0 - 0.35 * LID);
  float edx = (q.x - ex + 0.0012) / (0.0146 * sqrt(EYE));
  float alm = max(0.0, 1.0 - edx * edx);
  float up = (0.0047 * open + 0.0011 * FEM) * alm - 0.0006 + sl * (q.x - ex) * 4.0 + 0.0012 * max(0.0, -edx) * alm;
  if (ASLEEP > 0.5) up = -0.004;
  float lo = -0.0056 * EOPEN * pow(alm, 0.8) - 0.0006 + sl * (q.x - ex) * 2.0;
  return vec2(up, lo);
}
float gEye;   // distance to the eyeballs
float gLid;   // distance to the lid line (lash shading)
float gEar;   // distance to the ears
float gNeck;  // distance to the neck

float gau(float u) { return exp(-u * u); }
float gau2(vec2 u) { return exp(-dot(u, u)); }

// The face as a designed relief: z = F(x, y) in front of the skull. The profile (forehead, brow,
// nasion, the nose's bridge and tip, philtrum, lips, chin) and the planes across it (temples,
// sockets, cheekbones, the muzzle and the nasolabial folds where it meets the cheeks) are drawn as
// smooth curves and swellings, so every head has one continuous, controllable surface.
float halfWidth(float y) {
  float w = 0.0695 * W - 0.0055 * FEM;
  float jawHW = (0.051 * (0.86 + 0.14 * JAW) - 0.0095 * FEM) * W;
  float hw = mix(w, jawHW, smoothstep(-0.015, -0.075 * LOWF(), y));
  hw = mix(hw, (0.017 - 0.003 * FEM) * CHIN + 0.004, smoothstep(-0.07 * LOWF(), -0.112 * LOWF(), y));
  hw = mix(hw, w * 0.92, smoothstep(0.03, 0.09, y));
  return hw;
}
float faceF(float x, float y) {
  float ax = sqrt(x * x + 0.000006);
  float lf = LOWF();
  float fem = FEM;
  float mY = MOUTHY();
  float tipY = TIPY();
  // the frontal curve of the profile and the brow
  float z0 = 0.0915 - 1.5 * (y + 0.012) * (y + 0.012) - 0.01 * SLOPE * smoothstep(0.0, 0.08, y) * smoothstep(0.0, 0.04, y);
  z0 += 0.0034 * gau((y - 0.02) / 0.009) * (1.0 - 0.85 * fem) * BROW * gau(ax / 0.045) * (1.0 + 0.3 * SCOWL);
  z0 -= 0.006 * gau((y - 0.006) / 0.008) * gau(ax / 0.03);
  // the muzzle sits back under the nose, the chin comes forward again
  z0 -= 0.006 * smoothstep(-0.03, -0.052, y) * (1.0 - 0.6 * smoothstep(-0.088 * lf, -0.11 * lf, y));
  float hw = halfWidth(y);
  float u = sat(ax / hw);
  float pu = pow(u, 2.4);
  float z = -0.012 + (z0 + 0.012) * (1.0 - pu) * (1.0 + 0.45 * pu);
  // temples, sockets, cheekbones, cheek pads
  z -= 0.004 * gau2(vec2(ax - 0.06 * W, y - 0.032) / vec2(0.012, 0.02));
  float ex = EX();
  z -= (0.0105 + 0.002 * EDEPTH - 0.003 * fem) * gau2(vec2(ax - ex, y - 0.0025) / vec2(0.0165, 0.0115));
  float ck = CHEEK;
  z += 0.0062 * ck * gau2(vec2(ax - 0.045 * W, y + 0.013 + 0.003 * fem) / vec2(0.017, 0.011));
  z += (0.0042 + 0.0045 * fem + 0.005 * HALF) * gau2(vec2(ax - 0.031 * W, y + 0.034 * lf) / vec2(0.017, 0.02));
  z -= 0.003 * sat(HOLLOW) * gau2(vec2(ax - 0.05 * W, y + 0.048 * lf) / vec2(0.012, 0.016));
  // the nose: bridge rising from the nasion to the tip, side walls widening to the wings
  float nt = sat((0.009 - y) / (0.009 - tipY));
  float nh;
  if (y > tipY) nh = (0.0035 + 0.0205 * pow(nt, 1.15)) * (0.85 + 0.15 * NOSE) + 0.0022 * HOOK * gau((nt - 0.5) / 0.22);
  else nh = (0.024 * (0.85 + 0.15 * NOSE)) * gau((tipY - y) / 0.0068);
  nh *= (1.0 - 0.3 * fem) * smoothstep(0.022, 0.006, y);
  float nw = (0.0055 * BRIDGE + 0.0085 * pow(nt, 1.6) * TIP) * (1.0 - 0.15 * fem);
  if (y < tipY) nw = (0.0055 * BRIDGE + 0.0085 * TIP) * (1.0 - 0.15 * fem);
  float nu = ax / (nw * 1.55);
  float nshape = nu < 1.0 ? (1.0 - nu * nu) * (1.0 - nu * nu) : 0.0;
  z += nh * nshape;
  // the wings of the nose
  z += 0.0055 * NWIDTH * gau2(vec2(ax - 0.0108 * NWIDTH * (1.0 - 0.1 * fem), y - tipY + 0.0035) / vec2(0.0058, 0.0052));
  // muzzle, philtrum, lips, the mentolabial fold, the chin
  float mw = MOUTH;
  float cx = ax / (0.021 * mw);
  float curve = SMILE * 0.0032 * cx * cx + SMIRK * 0.0024 * sat(x / 0.02) * cx;
  float my = mY + curve;
  z += 0.0068 * gau(ax / (0.03 * mw)) * gau((y - mY - 0.004) / 0.022) * (1.0 + 0.3 * PROT - 0.25 * fem);
  z += 0.0009 * gau((ax - 0.0042) / 0.0016) * smoothstep(tipY - 0.009, tipY - 0.013, y) * smoothstep(my + 0.004, my + 0.007, y);
  float lw = smoothstep(0.0215 * mw, 0.011 * mw, ax);
  float lipK = LIPS * (1.0 + 0.4 * fem);
  z += 0.0028 * lipK * gau((y - my - 0.0046) / (0.0028 * lipK)) * lw;
  z -= 0.0036 * gau((y - my) / 0.0011) * smoothstep(0.0205 * mw, 0.0165 * mw, ax);
  z += 0.0034 * lipK * gau((y - my + 0.0058) / (0.0036 * lipK)) * smoothstep(0.019 * mw, 0.008 * mw, ax);
  z -= 0.0034 * gau((y - my + 0.0158) / 0.0042) * gau(ax / 0.016);
  float chinY = -0.093 * lf;
  z += (0.0062 + 0.002 * JDEPTH) * gau((y - chinY) / 0.011) * gau(ax / ((0.016 - 0.003 * fem) * CHIN));
  return z;
}
float skin(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float w = W;
  float fem = FEM;
  // ---- cranium: an egg, flatter at the sides, the back of the skull full
  vec3 c = p - vec3(0.0, 0.026 + 0.005 * (CRAN - 1.0), -0.018);
  float d = sdEll(c, vec3(0.072 * w, 0.094 * CRAN, 0.098));
  d = smax(d, q.x - (0.069 * w + 0.006 * sat((0.03 - p.z) / 0.08)), 0.03);
  // ---- the face relief, closed underneath by the jaw volume
  // The relief's height difference is a distance only up to its slope: scaled down it is a safe
  // (conservative) bound, and its gradient — the normal — is exact whatever the scale.
  float hf = (abs(p.y + 0.01) > 0.13 || abs(p.x) > 0.085) ? 1e3 : (p.z - faceF(p.x, p.y)) * 0.5;
  float jawVol = sdEll(p - vec3(0.0, -0.01, -0.01), vec3(0.075 * w, 0.1 * LOWF() + 0.006, 0.135));
  float face = smax(hf, jawVol, 0.01);
  face = smax(face, -p.z - 0.03, 0.02);
  d = smin(d, face, 0.016);
  // ---- the mandible's angle and the ramus behind the face relief
  float jw = (0.049 * (0.84 + 0.16 * JAW) - 0.004 * fem) * w;
  vec3 go = vec3(jw, -0.068 * LOWF(), -0.016 - 0.002 * JDEPTH);
  float rGo = 0.0105 + 0.0025 * (JAW - 1.0) - 0.0025 * fem;
  d = smin(d, sdRC(q, vec3(0.056 * w, -0.014, -0.024), go, 0.0125, rGo), 0.016);
  d = smin(d, sdRC(q, go, vec3(0.02 * CHIN, -0.1 * LOWF(), 0.05), rGo, 0.011), 0.016);
  gEye = 1e3;
  gLid = 1.0;
  float ex = EX();
  float ez = EZ();
  if (p.z > 0.03 && length(q - vec3(ex, 0.0, ez)) < 0.035) {
    // ---- eyeballs and lids
    float er = ER();
    vec3 ec = vec3(ex, 0.0, ez);
    float eye = length(q - ec) - er;
    gEye = eye;
    vec2 ll = lidLines(q);
    float up = length(q - ec) - (er + 0.0013);
    up = smax(up, ll.x - q.y, 0.001);
    float lo = length(q - ec) - (er + 0.0009);
    lo = smax(lo, q.y - ll.y, 0.0012);
    gLid = abs(q.y - ll.x);
    float lidZone = sdEll(q - ec - vec3(-0.0008, 0.0, 0.004), vec3(0.0175 * sqrt(EYE), 0.0125, 0.0145));
    d = smin(d, smax(min(up, lo), lidZone, 0.002), 0.005);
    // the upper-lid fold
    d = smax(d, -sdCap(q, ec + vec3(-0.011, 0.0104 - 0.003 * LID, 0.0065), ec + vec3(0.0115, 0.0095 - 0.004 * LID, 0.0035), 0.0007), 0.003);
    d = min(d, eye);
  }
  // nostrils
  if (p.z > 0.07 && abs(p.y - TIPY()) < 0.02) {
    d = smax(d, -sdEll(q - vec3(0.0062 * NWIDTH, TIPY() - 0.0075, faceF(0.006, TIPY() - 0.0075) - 0.002), vec3(0.003 * NWIDTH, 0.0016, 0.0045)), 0.0016);
  }
  // ---- ears: helix rim, concha bowl, lobe; elves get the long point
  gEar = 1e3;
  vec3 eq = q - vec3(0.0712 * w, -0.008, -0.014);
  if (length(eq) < 0.07) {
    eq.xz = rot2(-0.35) * eq.xz;
    float es = EARS;
    float ear = sdEll(eq, vec3(0.0085, 0.029 * es, 0.0175 * es));
    ear = smax(ear, -sdEll(eq - vec3(0.0068, -0.003 * es, 0.002), vec3(0.004, 0.0155 * es, 0.009 * es)), 0.0028);
    ear = smin(ear, sdEll(eq - vec3(0.002, -0.026 * es, 0.003), vec3(0.0052, 0.0072, 0.0068)), 0.004);
    if (ELF > 0.01) ear = smin(ear, sdRC(eq, vec3(0.0, 0.01, -0.004), vec3(0.008 + 0.012 * ELF, 0.026 + 0.046 * ELF, -0.02 - 0.016 * ELF), 0.008, 0.0012), 0.008);
    gEar = ear;
    d = smin(d, ear, 0.006);
  }
  // ---- neck with the sterno-mastoid cords and (men) the larynx
  float nr = mix(0.046, 0.038, fem) * (1.0 + 0.12 * HALF);
  vec3 np = p - vec3(0.0, 0.0, -0.03);
  np.x *= 0.95;
  float neck = sdRC(np, vec3(0.0, -0.06, 0.0), vec3(0.0, -0.2, 0.004), nr, nr * 1.12);
  neck = smin(neck, sdCap(q, vec3(0.042, -0.06, -0.028), vec3(0.012, -0.19, 0.03), 0.0055 - 0.0015 * fem), 0.024);
  neck = smin(neck, sdEll(p - vec3(0.0, -0.13, 0.024), vec3(0.009, 0.013, 0.008)), 0.018) * (1.0 - fem) + neck * fem;
  gNeck = neck;
  d = smin(d, neck, 0.01);
  return d;
}
`;
