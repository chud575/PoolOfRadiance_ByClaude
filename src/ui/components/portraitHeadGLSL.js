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
float EX() { return 0.0316 * SP * (0.93 + 0.07 * W); }
float ER() { return 0.0124 * (0.7 + 0.3 * EYE); }
float EZ() { return 0.0638 - 0.0022 * EDEPTH; }
float LOWF() { return LONG * (1.0 - 0.07 * FEM); }
float MOUTHY() { return -0.065 * LOWF(); }
float TIPY() { return -0.038 * NOSE * (0.92 + 0.08 * LONG) * (1.0 - 0.07 * FEM); }
float TIPZ() { return 0.1115 + 0.01 * (NOSE - 1.0) - 0.0075 * FEM - 0.004 * HALF + 0.006 * GNOME; }
float LIPZ() { return 0.0905 + 0.003 * PROT - 0.004 * FEM; }
// The gaze of the eye on this side (in the mirrored q space). uGaze is either a direction or, when
// longer than 1, a point in head space both eyes look at: they converge on one target.
vec3 gazeQ(vec3 p) {
  float sx = sign(p.x + 1e-5);
  vec3 gp = uGaze;
  if (dot(uGaze, uGaze) > 1.02) gp = normalize(uGaze - vec3(EX() * sx, 0.0, EZ()));
  return normalize(vec3(gp.x * sx, gp.y, gp.z));
}

// Upper and lower lid lines (y, head-local) at a point beside the eye: an almond, the outer
// corner a touch higher, the upper lid over the top of the iris.
vec2 lidLines(vec3 q) {
  float ex = EX();
  float sl = 0.15 * SLANT;
  float open = EOPEN * (1.0 - 0.32 * LID);
  float edx = (q.x - ex + 0.0012) / (0.0148 * sqrt(EYE));
  float alm = max(0.0, 1.0 - edx * edx);
  // the upper lid peaks inward of centre, the lower lid lowest outward of centre
  float up = (0.0051 * open + 0.0007 * FEM) * pow(alm, 0.85) * (1.0 + 0.12 * edx) - 0.0009 + sl * (q.x - ex) * 4.0;
  if (ASLEEP > 0.5) up = -0.0035;
  float lo = -0.0047 * EOPEN * pow(alm, 0.75) * (1.0 - 0.1 * edx) - 0.0008 + sl * (q.x - ex) * 2.0;
  return vec2(up, lo);
}
// The lips: the upper lip a plane turned down (it takes the shadow), the lower lip turned up to
// the light and fuller, sitting a little behind the upper; their corners tuck into the cheeks.
float gau(float u) { return exp(-u * u); }
float gau2(vec2 u) { return exp(-dot(u, u)); }
// The lips as a relief on the barrel of the teeth (not separate volumes): the upper lip a band
// shaped by the cupid's bow, the lower lip fuller in two soft lobes, both thinning to nothing at
// the corners, where the mouth line tucks into the cheek. Returns (upper, lower, line): the two
// reliefs (metres) and the parting line's strength — the albedo reads the same shapes.
vec3 lipField(vec3 p) {
  float mw = MOUTH;
  float mY = MOUTHY();
  float lipK = LIPS * (1.0 + 0.1 * FEM);
  float ax = abs(p.x);
  float cxs = min(ax / (0.021 * mw), 1.3);
  float curve = SMILE * 0.0034 * cxs * cxs + SMIRK * 0.0028 * sat(p.x / 0.02) * cxs - SCOWL * 0.0012 * cxs * cxs;
  float y = p.y - curve - mY;
  float cx = ax / (0.0198 * mw);
  float env = sat(1.0 - cx * cx);
  float envU = pow(env, 1.3), envL = pow(env, 1.5);
  // the cupid's bow: the upper border peaks either side of the philtrum, dips over it
  float bow = 0.0011 * gau((ax - 0.0055 * mw) / 0.0032) - 0.0006 * gau(ax / 0.0028);
  float upTop = 0.0058 * min(lipK, 1.3) + bow;
  float upper = 0.0031 * lipK * envU * sat(y / 0.0012) * sat((upTop - y) / 0.0016 + 0.4) * smoothstep(upTop + 0.002, upTop - 0.0008, y);
  float lobes = 1.0 + 0.12 * gau((ax - 0.0055 * mw) / 0.004);
  float lower = 0.0042 * lipK * lobes * envL * gau((y + 0.0052 * min(lipK, 1.3)) / (0.0042 * min(lipK, 1.3))) * sat(-y / 0.0011);
  float line = gau(y / 0.0007) * smoothstep(1.05, 0.75, cx);
  return vec3(upper, lower, line);
}
float gEye;   // distance to the eyeballs
float gLid;   // distance to the lid line (lash shading)
float gEar;   // distance to the ears
float gNeck;  // distance to the neck


// The head is built as a sculptor blocks it in: the cranium, the brow bar and the orbits carved
// under it, the face mass and the cheekbones with their arches, the mandible from the ear to the
// chin, the barrel of the muzzle with the lips on it, the nose as bridge, tip and wings, the ears
// and the neck. Each piece moves with the template's parameters, so the heads differ in bone, not
// only in hair.
float skin(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float w = W * (1.0 - 0.03 * FEM);
  float fem = FEM;
  float lf = LOWF();
  // dwarves (women too) keep a heavy brow and a broad jaw
  float dwf = sat((BLEN - 1.0) / 0.3);
  float man = 1.0 - fem * (1.0 - 0.5 * dwf);
  // ---- cranium: an egg, flatter at the sides, the back of the skull full
  vec3 c = p - vec3(0.0, 0.022 + 0.004 * (CRAN - 1.0), -0.012);
  float d = sdEll(c, vec3(0.0712 * w, 0.086 * CRAN, 0.097));
  d = smax(d, q.x - (0.067 * w + 0.006 * sat((0.02 - p.z) / 0.08)), 0.034);
  // ---- the face is modelled as soft masses over the bone, blended wide: the forehead, the brow,
  // the mid-face with its cheek pads, the jaw and chin. Large blend radii keep the transitions
  // fleshy (no planar seams down the cheek), the bone shows only where it should: brow, cheekbone
  // top, jaw angle, chin.
  // forehead: the frontal bone, a broad gently curved shield
  d = smin(d, sdEll(p - vec3(0.0, 0.034, 0.03), vec3(0.058 * w, 0.052, 0.05)), 0.03);
  // brow: a soft bar over the eyes, heavy on men, dwarves and the old
  float browK = BROW * (1.0 - 0.6 * fem * (1.0 - 0.5 * dwf));
  d = smin(d, sdEll(p - vec3(0.0, 0.0165, 0.064 + 0.0015 * browK), vec3(0.05 * w, 0.0115 + 0.001 * browK, 0.019 + 0.0016 * browK)), 0.018);
  // mid-face: the maxilla under the eyes and the nose, deep enough that the cheeks wrap round it
  d = smin(d, sdEll(p - vec3(0.0, -0.03 * lf, 0.028), vec3(0.046 * w, 0.054 * lf, 0.05)), 0.026);
  // cheekbones: the top of the zygoma, broad and low-relief, melting back into the arch
  float ckz = 0.9 + 0.15 * CHEEK;
  vec3 cq = q - vec3(0.045 * w, -0.016 - 0.002 * fem, 0.041);
  cq.xy = rot2(0.3) * cq.xy;
  d = smin(d, sdEll(cq, vec3(0.021, 0.0125, 0.015 * ckz) * (1.0 + 0.08 * HALF)), 0.028 + 0.008 * fem);
  d = smin(d, sdCap(q, vec3(0.056 * w, -0.014, 0.036), vec3(0.066 * w, -0.012, 0.0), 0.0072 - 0.0012 * fem), 0.02);
  // cheek pads: the fat under the cheekbone and beside the nose, full on the young, halflings and
  // women, sinking on the lean and the old
  float buc = (0.92 - 0.4 * sat(HOLLOW) * (1.0 - 0.5 * fem)) * (1.0 + 0.22 * HALF + 0.14 * fem);
  d = smin(d, sdEll(q - vec3(0.031 * w, -0.04 * lf, 0.042), vec3(0.02 * buc, 0.024, 0.0185 * buc)), 0.024);
  // ---- the jaw: the ramus down from the ear, the angle, the body of the mandible to the chin
  float jw = (0.046 * (0.86 + 0.14 * JAW) - 0.011 * fem * (1.0 - 0.55 * dwf)) * w;
  vec3 go = vec3(jw, -0.078 * lf, -0.012 - 0.003 * JDEPTH);
  float rGo = 0.012 + 0.003 * (JAW - 1.0) - 0.0035 * fem * (1.0 - 0.5 * dwf);
  vec3 me = vec3(0.015 * CHIN, -0.103 * lf, 0.064 - 0.005 * fem * (1.0 - dwf) + 0.004 * JDEPTH);
  float jaw = sdRC(q, vec3(0.058 * w, -0.022, -0.022), go, 0.014, rGo);
  jaw = smin(jaw, sdRC(q, go, me, rGo, 0.012 + 0.002 * CHIN), 0.012);
  // (a tight blend: the mandible reads as a plane turning under the face, not a soft dough edge)
  d = smin(d, jaw, 0.015 - 0.003 * man);
  // the masseter: the full muscle over the ramus between the cheekbone's arch and the jaw angle
  d = smin(d, sdEll(q - vec3(0.047 * w, -0.05 * lf, 0.004), vec3(0.014, 0.028 * lf, 0.026)), 0.02);
  // lower face: the soft fill between the jaw and the mouth (the cheek's lower half)
  d = smin(d, sdEll(p - vec3(0.0, -0.066 * lf, 0.022 - 0.002 * fem), vec3((0.043 - 0.005 * fem * (1.0 - 0.5 * dwf)) * w, 0.04 * lf, 0.052)), 0.022);
  // chin: the mental protuberance, square and cleft-able on men, small and round on women
  vec3 chq = p - vec3(0.0, -0.099 * lf, 0.078 - 0.004 * fem * (1.0 - dwf) + 0.004 * JDEPTH);
  float chin = sdEll(chq, vec3((0.02 - 0.005 * fem * (1.0 - 0.6 * dwf)) * CHIN, 0.0165 - 0.002 * fem, 0.0155));
  chin = smin(chin, sdEll(vec3(abs(chq.x) - 0.008 * CHIN * man, chq.yz), vec3(0.012, 0.0135, 0.0135)), 0.01);
  d = smin(d, chin, 0.018);
  // temples a little hollow
  d += 0.0016 * gau2(vec2(q.x - 0.062 * w, p.y - 0.034) / vec2(0.011, 0.018)) * sat((p.z - 0.02) / 0.02);
  // ---- muzzle and lips
  float mY = MOUTHY();
  float mw = MOUTH;
  float lipK = LIPS * (1.0 + 0.1 * fem);
  float lz = LIPZ();
  // the barrel of the teeth under the lips
  d = smin(d, sdEll(p - vec3(0.0, mY + 0.006, 0.056 + 0.003 * PROT - 0.004 * fem), vec3(0.03 * mw * (1.0 - 0.06 * fem), 0.028, 0.028)), 0.018);
  // the mentalis: the soft pad between the lower lip and the chin
  d = smin(d, sdEll(p - vec3(0.0, mY - 0.018, lz - 0.0125 - 0.002 * fem), vec3(0.0145 * mw, 0.0095, 0.0105)), 0.012);
  if (p.z > 0.06 && abs(p.y - mY) < 0.03 && q.x < 0.032) {
    vec3 lf3 = lipField(p);
    float front = sat((p.z - 0.068) / 0.012);
    // the reliefs, the parting line pressed in between them, the corners drawn in
    d -= (lf3.x + lf3.y) * front;
    d += 0.0013 * lf3.z * front;
    d += 0.0012 * gau2(vec2(q.x - 0.0202 * mw, p.y - mY) / vec2(0.0025, 0.0022)) * front;
    // the soft fold under the lower lip (men; on women the pad runs smoothly into the chin)
    if (fem < 0.5) d += 0.0007 * gau((p.y - mY + 0.0165) / 0.0018) * sat(1.0 - q.x / 0.012) * front;
  }
  // nasolabial fold: a soft ridge of the cheek beside the muzzle, deeper with age
  {
    float tipY = TIPY();
    vec2 a = vec2(0.0195 * NWIDTH, tipY - 0.001), b = vec2(0.029 * mw, mY - 0.01);
    vec2 pa = q.xy - a, ba = b - a;
    float h = dot(pa, ba) / dot(ba, ba);
    vec2 pr = pa - ba * h;
    float fall = smoothstep(-0.1, 0.15, h) * smoothstep(1.15, 0.8, h);
    d -= (0.0006 + 0.0012 * LINES) * exp(-dot(pr, pr) / (0.005 * 0.005)) * fall * sat((p.z - 0.06) / 0.015);
  }
  // ---- the nose: a narrow root between the eyes widening to the tip; the bridge's cross-section
  // is a soft rounded trapezoid (no knife ridge), the ball of the tip and the wings fleshy
  float tipY = TIPY();
  float tipZ = TIPZ();
  if (p.z > 0.058 && p.y < 0.032 && p.y > tipY - 0.03 && q.x < 0.042) {
    vec3 nN = vec3(0.0, 0.0065, 0.083 - 0.002 * EDEPTH);
    vec3 nT = vec3(0.0, tipY + 0.0062, tipZ - 0.0072);
    vec3 nM = mix(nN, nT, 0.5) + vec3(0.0, 0.0, 0.0024 * HOOK);
    float br = 0.0058 * BRIDGE * (1.0 - 0.15 * fem);
    // the bridge: narrow at the root, a rounded top plane (its section a soft trapezoid)
    vec3 np = vec3(p.x * 0.85, p.y, p.z);
    float nb = smin(sdRC(np, nN, nM, br * 0.82, br * 1.0), sdRC(np, nM, nT, br * 1.0, 0.0074 * TIP), 0.007);
    // the ball of the tip
    vec3 tc = vec3(0.0, tipY, tipZ - 0.0094);
    nb = smin(nb, sdEll(p - tc, vec3(0.0102 * TIP * (1.0 - 0.18 * fem), 0.009 * (1.0 - 0.14 * fem), 0.0094 * (1.0 - 0.1 * fem))), 0.008);
    // the wings, tucked against the tip and blended wide into it and the cheek
    float aw = 0.0108 * NWIDTH * (1.0 - 0.16 * fem);
    nb = smin(nb, sdEll(q - vec3(aw, tipY - 0.0032, tipZ - 0.0172), vec3(0.0072, 0.0064, 0.0078) * (1.0 - 0.1 * fem)), 0.009);
    // columella
    nb = smin(nb, sdCap(p, vec3(0.0, tipY - 0.0055, tipZ - 0.01), vec3(0.0, tipY - 0.0085, tipZ - 0.02), 0.0032), 0.005);
    d = smin(d, nb, 0.012);
    // the nostrils: small, on the underside only
    d = smax(d, -sdEll(q - vec3(0.0058 * NWIDTH, tipY - 0.0092, tipZ - 0.0142), vec3(0.0024 * NWIDTH, 0.0011, 0.0034)), 0.0016);
  }
  // ---- orbits, eyeballs and lids
  gEye = 1e3;
  gLid = 1.0;
  float ex = EX();
  float ez = EZ();
  if (p.z > 0.035 && length(q - vec3(ex, 0.0, ez)) < 0.04) {
    d = smax(d, -sdEll(q - vec3(ex + 0.001, 0.003, ez + 0.0155), vec3(0.0172, 0.0122, 0.0112)), 0.011 + 0.002 * EDEPTH);
    float er = ER();
    vec3 ec = vec3(ex, 0.0, ez);
    float eye = length(q - ec) - er;
    // the cornea's bulge in front of the iris
    vec3 g = gazeQ(p);
    eye = smin(eye, length(q - ec - g * 0.0052) - er * 0.62, 0.003);
    gEye = eye;
    vec2 ll = lidLines(q);
    float up = length(q - ec) - (er + 0.0025);
    up = smax(up, ll.x - q.y, 0.0009);
    float lo = length(q - ec) - (er + 0.0017);
    lo = smax(lo, q.y - ll.y, 0.0011);
    gLid = abs(q.y - ll.x);
    float lidZone = sdEll(q - ec - vec3(-0.0006, 0.0, 0.004), vec3(0.0178 * sqrt(EYE), 0.0135, 0.0148));
    d = smin(d, smax(min(up, lo), lidZone, 0.002), 0.0045);
    // the fleshy fold of the upper lid under the brow, and the upper-lid crease
    float fold = sdEll(q - ec - vec3(0.0005, 0.0095 - 0.0016 * LID, 0.0088), vec3(0.0152 * sqrt(EYE), 0.0042, 0.0046));
    fold = smax(fold, ll.x + 0.0022 - q.y, 0.0012);
    d = smin(d, fold, 0.003);
    float fy = 0.0108 - 0.0032 * LID + 0.0006 * FEM;
    d = smax(d, -sdCap(q, ec + vec3(-0.0115, fy, 0.0075), ec + vec3(0.0118, fy - 0.0012, 0.0038), 0.001), 0.0026);
    d = min(d, eye);
  }
  // ---- ears: helix rim, concha bowl, lobe; elves get the long point
  gEar = 1e3;
  vec3 eq = q - vec3(0.0712 * w, -0.012, -0.016);
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
  // ---- neck with the sterno-mastoid cords and (men) the larynx; dwarves are bull-necked
  float nr = mix(0.054, 0.047, fem) * (1.0 + 0.1 * HALF) * (1.0 + 0.4 * sat(BLEN - 1.0) / 0.3) * (1.0 + 0.1 * fem * sat(BLEN - 1.0) / 0.3);
  vec3 np = p - vec3(0.0, 0.0, -0.028);
  np.x *= 0.95;
  float neck = sdRC(np, vec3(0.0, -0.06, 0.0), vec3(0.0, -0.2, 0.004), nr, nr * 1.12);
  neck = smin(neck, sdCap(q, vec3(0.044, -0.055, -0.03), vec3(0.012, -0.19, 0.03), 0.0058 - 0.0016 * fem), 0.024);
  neck = smin(neck, sdEll(p - vec3(0.0, -0.13, 0.026), vec3(0.009, 0.013, 0.008)), 0.018) * (1.0 - fem) + neck * fem;
  gNeck = neck;
  d = smin(d, neck, 0.012);
  return d;
}
`;
