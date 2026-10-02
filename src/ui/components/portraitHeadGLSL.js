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
float ER() { return 0.0121 * (0.95 + 0.05 * EYE); }
float EZ() { return 0.0638 - 0.0022 * EDEPTH; }
float LOWF() { return LONG * (1.0 - 0.05 * FEM); }
float MOUTHY() { return -0.0665 * LOWF(); }
float TIPY() { return -0.0365 * NOSE * (0.92 + 0.08 * LONG) * (1.0 - 0.09 * FEM); }
float TIPZ() { return 0.1145 + 0.01 * (NOSE - 1.0) - 0.0045 * FEM - 0.004 * HALF + 0.006 * GNOME; }
float LIPZ() { return 0.0962 + 0.004 * PROT - 0.0015 * FEM; }

// Upper and lower lid lines (y, head-local) at a point beside the eye: an almond, the outer
// corner a touch higher, the upper lid over the top of the iris.
vec2 lidLines(vec3 q) {
  float ex = EX();
  float sl = 0.15 * SLANT;
  float open = EOPEN * (1.0 - 0.32 * LID);
  float edx = (q.x - ex + 0.0012) / (0.0148 * sqrt(EYE));
  float alm = max(0.0, 1.0 - edx * edx);
  // the upper lid peaks inward of centre, the lower lid lowest outward of centre
  float up = (0.0047 * open + 0.0007 * FEM) * pow(alm, 0.85) * (1.0 + 0.12 * edx) - 0.0009 + sl * (q.x - ex) * 4.0;
  if (ASLEEP > 0.5) up = -0.0035;
  float lo = -0.0047 * EOPEN * pow(alm, 0.75) * (1.0 - 0.1 * edx) - 0.0008 + sl * (q.x - ex) * 2.0;
  return vec2(up, lo);
}
float gEye;   // distance to the eyeballs
float gLid;   // distance to the lid line (lash shading)
float gEar;   // distance to the ears
float gNeck;  // distance to the neck

float gau(float u) { return exp(-u * u); }
float gau2(vec2 u) { return exp(-dot(u, u)); }

// The head is built as a sculptor blocks it in: the cranium, the brow bar and the orbits carved
// under it, the face mass and the cheekbones with their arches, the mandible from the ear to the
// chin, the barrel of the muzzle with the lips on it, the nose as bridge, tip and wings, the ears
// and the neck. Each piece moves with the template's parameters, so the heads differ in bone, not
// only in hair.
float skin(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float w = W;
  float fem = FEM;
  float lf = LOWF();
  // ---- cranium: an egg, flatter at the sides, the back of the skull full
  vec3 c = p - vec3(0.0, 0.025 + 0.004 * (CRAN - 1.0), -0.014);
  float d = sdEll(c, vec3(0.073 * w, 0.088 * CRAN, 0.1));
  d = smax(d, q.x - (0.069 * w + 0.005 * sat((0.02 - p.z) / 0.08)), 0.03);
  // ---- the brow bar over the eyes (heavy on men, dwarves and the old)
  float browK = BROW * (1.0 - 0.65 * fem);
  d = smin(d, sdEll(p - vec3(0.0, 0.0165, 0.066 + 0.0012 * browK), vec3(0.053 * w, 0.0125, 0.02 + 0.0016 * browK)), 0.018);
  // ---- face mass and cheekbones with the zygomatic arches
  d = smin(d, sdEll(p - vec3(0.0, -0.032 * lf, 0.026), vec3(0.0635 * w, 0.066 * lf, 0.06)), 0.026);
  float ckz = 0.9 + 0.15 * CHEEK;
  d = smin(d, sdEll(q - vec3(0.0465 * w, -0.0135 - 0.002 * fem, 0.049), vec3(0.023, 0.0155, 0.023 * ckz) * (1.0 + 0.12 * HALF)), 0.018);
  d = smin(d, sdCap(q, vec3(0.05 * w, -0.012, 0.044), vec3(0.067 * w, -0.01, 0.0), 0.0085), 0.016);
  // ---- the mandible: ramus, angle, body and chin; a fill between jaw and mouth
  float jw = (0.047 * (0.86 + 0.14 * JAW) - 0.0048 * fem) * w;
  vec3 go = vec3(jw, -0.079 * lf, -0.01 - 0.003 * JDEPTH);
  float rGo = 0.011 + 0.003 * (JAW - 1.0) - 0.002 * fem;
  vec3 me = vec3(0.016 * CHIN, -0.105 * lf, 0.064 + 0.004 * JDEPTH);
  d = smin(d, sdRC(q, vec3(0.058 * w, -0.02, -0.022), go, 0.012, rGo), 0.02);
  d = smin(d, sdRC(q, go, me, rGo, 0.012 + 0.002 * CHIN), 0.022);
  d = smin(d, sdEll(p - vec3(0.0, -0.1 * lf, 0.0785 + 0.004 * JDEPTH), vec3((0.022 - 0.003 * fem) * CHIN, 0.0168, 0.0168)), 0.016);
  d = smin(d, sdEll(p - vec3(0.0, -0.066 * lf, 0.032), vec3(0.054 * w, 0.044 * lf, 0.06)), 0.022);
  // fat pads (halflings, the young), hollows under the cheekbones (lean and old faces)
  d -= (0.001 + 0.0035 * HALF + 0.001 * fem) * gau2(vec2(q.x - 0.036 * w, p.y + 0.034 * lf) / vec2(0.02, 0.02)) * sat((p.z - 0.03) / 0.03);
  d += 0.0028 * HOLLOW * gau2(vec2(q.x - 0.05 * w, p.y + 0.046 * lf) / vec2(0.011, 0.015)) * sat((p.z - 0.02) / 0.03);
  d += 0.0018 * gau2(vec2(q.x - 0.062 * w, p.y - 0.036) / vec2(0.01, 0.017)) * sat((p.z - 0.02) / 0.02);
  // ---- muzzle and lips
  float mY = MOUTHY();
  float mw = MOUTH;
  float lipK = LIPS * (1.0 + 0.3 * fem);
  float lz = LIPZ();
  d = smin(d, sdEll(p - vec3(0.0, mY + 0.006, 0.068 + 0.003 * PROT), vec3(0.03 * mw, 0.028, 0.028)), 0.018);
  if (p.z > 0.07 && abs(p.y - mY) < 0.03) {
    float cx = q.x / (0.021 * mw);
    float curve = SMILE * 0.0034 * cx * cx + SMIRK * 0.0028 * sat(p.x / 0.02) * cx - SCOWL * 0.0012 * cx * cx;
    vec3 lp = p - vec3(0.0, curve, 0.0);
    float ul = sdEll(lp - vec3(0.0, mY + 0.0043, lz - 0.0042), vec3(0.0192 * mw, 0.0052 * lipK, 0.0078));
    float ll = sdEll(lp - vec3(0.0, mY - 0.0058, lz - 0.0058), vec3(0.0168 * mw, 0.0062 * lipK, 0.0086));
    d = smin(d, min(ul, ll), 0.0045);
    // the mouth line, the corners tucked in
    vec3 sp = lp - vec3(0.0, mY, lz - 0.004);
    float sx = abs(sp.x) / (0.0188 * mw);
    float slit = length(vec2(max(abs(sp.x) - 0.0188 * mw, 0.0), sp.y)) - 0.0007 * sat(1.2 - sx * sx);
    d = smax(d, -max(slit, abs(sp.z) - 0.0105), 0.0016);
    // the fold under the lower lip
    d = smax(d, -sdEll(p - vec3(0.0, mY - 0.0175, lz + 0.0005), vec3(0.0135, 0.0032, 0.0055)), 0.006);
  }
  // nasolabial fold: a soft ridge of the cheek beside the muzzle, deeper with age (a gaussian of the
  // squared distance to a line just outside the fold, so the field stays smooth)
  {
    float tipY = TIPY();
    vec2 a = vec2(0.0195 * NWIDTH, tipY - 0.001), b = vec2(0.029 * mw, mY - 0.01);
    vec2 pa = q.xy - a, ba = b - a;
    float h = dot(pa, ba) / dot(ba, ba);
    vec2 pr = pa - ba * h;
    float fall = smoothstep(-0.1, 0.15, h) * smoothstep(1.15, 0.8, h);
    d -= (0.0007 + 0.0014 * LINES) * exp(-dot(pr, pr) / (0.0042 * 0.0042)) * fall * sat((p.z - 0.06) / 0.015);
  }
  // ---- the nose: bridge from the nasion (with the template's hump or snub), tip, wings
  float tipY = TIPY();
  float tipZ = TIPZ();
  if (p.z > 0.06 && p.y < 0.03 && p.y > tipY - 0.03 && q.x < 0.04) {
    vec3 nN = vec3(0.0, 0.0065, 0.0838 - 0.002 * EDEPTH);
    vec3 nT = vec3(0.0, tipY + 0.0068, tipZ - 0.0068);
    vec3 nM = mix(nN, nT, 0.5) + vec3(0.0, 0.0, 0.0028 * HOOK);
    float br = 0.0058 * BRIDGE;
    float nb = smin(sdRC(p, nN, nM, br * 0.95, br * 1.08), sdRC(p, nM, nT, br * 1.08, 0.0075 * TIP), 0.004);
    nb = smin(nb, sdEll(p - vec3(0.0, tipY, tipZ - 0.0086), vec3(0.0102 * TIP, 0.0088, 0.0088)), 0.006);
    nb = smin(nb, sdEll(q - vec3(0.0128 * NWIDTH, tipY - 0.0042, tipZ - 0.0195), vec3(0.0078, 0.0066, 0.008)), 0.0045);
    // columella and the base
    nb = smin(nb, sdCap(p, vec3(0.0, tipY - 0.006, tipZ - 0.01), vec3(0.0, tipY - 0.009, tipZ - 0.021), 0.0032), 0.004);
    d = smin(d, nb, 0.0085);
    d = smax(d, -sdEll(q - vec3(0.0064 * NWIDTH, tipY - 0.0088, tipZ - 0.0148), vec3(0.0027 * NWIDTH, 0.0014, 0.0040)), 0.0016);
  }
  // ---- orbits, eyeballs and lids
  gEye = 1e3;
  gLid = 1.0;
  float ex = EX();
  float ez = EZ();
  if (p.z > 0.035 && length(q - vec3(ex, 0.0, ez)) < 0.04) {
    d = smax(d, -sdEll(q - vec3(ex + 0.001, 0.0025, ez + 0.0165), vec3(0.0182, 0.0128, 0.0125)), 0.009 + 0.002 * EDEPTH);
    float er = ER();
    vec3 ec = vec3(ex, 0.0, ez);
    float eye = length(q - ec) - er;
    // the cornea's bulge in front of the iris
    vec3 g = normalize(vec3(uGaze.x * sign(p.x + 1e-5), uGaze.y, uGaze.z));
    eye = smin(eye, length(q - ec - g * 0.0052) - er * 0.62, 0.003);
    gEye = eye;
    vec2 ll = lidLines(q);
    float up = length(q - ec) - (er + 0.0015);
    up = smax(up, ll.x - q.y, 0.0009);
    float lo = length(q - ec) - (er + 0.0011);
    lo = smax(lo, q.y - ll.y, 0.0011);
    gLid = abs(q.y - ll.x);
    float lidZone = sdEll(q - ec - vec3(-0.0006, 0.0, 0.004), vec3(0.0178 * sqrt(EYE), 0.0135, 0.0148));
    d = smin(d, smax(min(up, lo), lidZone, 0.002), 0.0045);
    // the upper-lid fold
    float fy = 0.0108 - 0.0032 * LID + 0.0006 * FEM;
    d = smax(d, -sdCap(q, ec + vec3(-0.0115, fy, 0.0072), ec + vec3(0.0118, fy - 0.0012, 0.0036), 0.00075), 0.0028);
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
  float nr = mix(0.054, 0.044, fem) * (1.0 + 0.1 * HALF) * (1.0 + 0.16 * sat(BLEN - 1.0) / 0.3);
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
