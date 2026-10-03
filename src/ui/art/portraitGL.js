import { makeCanvas, hexRgb } from './paint.js';

/**
 * Raymarched conversation portraits.
 *
 * Every portrait is one signed-distance field traced on the GPU: the skull, face planes, jaw,
 * cheekbones, brow ridge, lidded eyeballs, nose, lips and ears are smooth-unioned volumes, and
 * hair, eyebrows and beards are *volumes in the same field* (a thickness grown off the skin
 * surface, plus hanging masses for long hair, buns, long beards and braids), so they occlude the
 * face, cast soft shadows on it and catch the same 3/4 key light. Headgear (mitre, hood) and
 * spectacles are geometry too. Skin gets a wrapped, red-shifted terminator (a subsurface
 * approximation), pores, regional colour (warm cheeks, nose and ears; a cooler jaw on men) and an
 * oily T-zone sheen; hair gets Kajiya-Kay highlights along its strand flow; cloth gets folds in
 * the field and a weave; mail gets rings.
 *
 * A second pass paints over the render: a Kuwahara oil filter, a darkened paint edge on the
 * silhouette and depth breaks, a warm-light / cool-shadow shift, canvas tooth and a vignette.
 *
 *   paintPortraitGL(design, W, H, {race}) → canvas | null (no WebGL2)
 *
 * `design` is the same object the old painter took (data/npcs.js `paint` or portraitDesign()).
 * Each design compiles its own shader with its parameters baked in as constants, so the compiler
 * drops every feature the character does not have. Deterministic: no clocks, no random calls.
 */

const F = (x) => {
  const v = Number.isFinite(+x) ? +x : 0;
  const s = v.toFixed(4);
  return s;
};
const lin = (hex) => hexRgb(hex).map((v) => Math.pow(v / 255, 2.2));
const V3 = (c) => `vec3(${F(c[0])},${F(c[1])},${F(c[2])})`;
const C3 = (hex, fb = '#808080') => V3(lin(hex ?? fb));

// --- 3x3 helpers (row-major arrays) for baking transforms
function rotY(a) { const c = Math.cos(a); const s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotX(a) { const c = Math.cos(a); const s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotZ(a) { const c = Math.cos(a); const s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mul(A, B) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
}
const tr = (M) => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
const ap = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
// GLSL mat3 from a row-major matrix (GLSL is column-major)
const M3 = (M) => `mat3(${[M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]].map(F).join(',')})`;

const HAIR = { none: 0, short: 1, tonsure: 2, wavy: 3, bun: 4, topknot: 5, long: 6, braid: 3, fringe: 1 };
const BEARD = { none: 0, full: 1, long: 2, braided: 3, goatee: 4, moustache: 5, stubble: 6 };
const COSTUME = { robe: 0, priest: 1, gown: 2, tabard: 3, smith: 4, mail: 5, bodice: 6, tunic: 7, plate: 8 };

/** Turn a portrait design into the constants block of its shader. */
function constants(D, o = {}) {
  const fem = D.sex === 'f';
  const face = { w: 1, jaw: 1, chin: 1, cheek: 1, hollow: 0, brow: 1, neck: 1, ...(D.face ?? {}) };
  const nose = { len: 1, w: 1, tip: 1, hook: 0, broken: 0, ...(D.nose ?? {}) };
  const eyes = { c: '#5a4a3a', size: 1, lid: 0.3, tilt: 0, ...(D.eyes ?? {}) };
  const mouth = { w: 1, full: fem ? 1.1 : 0.85, smile: 0.1, ...(D.mouth ?? {}) };
  const brows = { c: D.hair?.c ?? '#3a2a1a', w: 1, arch: 0.4, ...(D.brows ?? {}) };
  const age = D.age ?? 0.35;
  const race = o.race ?? 'human';
  const build = D.build ?? (fem ? 0.9 : 1);
  const hair = HAIR[D.hair?.style ?? 'short'] ?? 1;
  const beard = BEARD[D.beard?.style ?? 'none'] ?? 0;
  const head = D.head?.kind === 'helm' ? 3 : D.head?.kind === 'mitre' ? 2 : D.head?.kind === 'hood' ? 1 : 0;
  const cos = D.costume ?? {};
  const costume = COSTUME[cos.kind] ?? 7;
  const skin = D.skin ?? '#d9a77a';
  const lipC = mouth.c ?? (fem ? '#b84852' : '#a86458');
  const skinL = lin(skin);
  const lipL = lin(lipC).map((v, i) => skinL[i] + (v - skinL[i]) * (fem ? 0.75 : 0.45));

  // pose: the head turned three-quarters, the shoulders turned further (a painter's pose), the
  // eyes back to the viewer; the key comes from the side the face turns toward (short lighting)
  const side = Math.sign(D.yaw ?? -0.3) || -1;
  const headYaw = side * Math.min(0.62, Math.max(0.38, Math.abs(D.yaw ?? 0.3) * 1.7));
  const torsoYaw = side * Math.min(0.85, Math.abs(headYaw) * 1.45);
  const pitch = D.pitch ?? 0.04;
  const roll = D.roll ?? side * 0.035;
  const HR = mul(rotY(headYaw), mul(rotX(pitch), rotZ(roll))); // head → world
  const TR = rotY(torsoYaw); // torso → world
  const PIV = [0, -0.85, -0.2];
  const TPV = [0, -2.6, -0.3];
  const toW = (R, piv, v) => { const q = ap(R, [v[0] - piv[0], v[1] - piv[1], v[2] - piv[2]]); return [q[0] + piv[0], q[1] + piv[1], q[2] + piv[2]]; };
  const H2W = (v) => toW(HR, PIV, v);
  const BODYY = 0.72; // the torso is modelled with its shoulders at y≈-2.6; it sits this much higher
  const T2W = (v) => toW(TR, TPV, [v[0], v[1] + BODYY, v[2]]);
  const neckW = face.neck * (fem ? 0.92 : 1.1) * (race === 'dwarf' ? 1.15 : 1);
  let key = [side * 0.86, 0.46, 0.2];
  if (D.key) key = [D.key[0], -D.key[1], D.key[2]];
  const kl = Math.hypot(...key);
  key = key.map((v) => v / kl);

  const gaze = D.gaze ?? [0, 0];
  const bg = D.bg ?? ['#4e3e2a', '#0c0806'];
  const aura = o.aura ?? D.aura ?? '#ffcf8a';
  const hairC = D.hair?.c ?? '#3a2a1a';
  const beardC = D.beard?.c ?? hairC;
  const ears = race === 'elf' ? 2 : race === 'halfElf' ? 1 : 0;
  const lidAge = Math.min(1, (eyes.lid ?? 0.3) + age * 0.3);

  const defs = [
    `#define HAIR ${hair}`, `#define BEARD ${beard}`, `#define HEADW ${head}`, `#define COSTUME ${costume}`,
    `#define FEM ${fem ? 1 : 0}`, `#define SPECS ${D.spectacles ? 1 : 0}`, `#define EARS ${ears}`,
    `#define CLOAK ${cos.cloak || costume === 5 ? 1 : 0}`, `#define SCAR ${D.scar ? 1 : 0}`, `#define HOOK ${nose.hook > 0 ? 1 : 0}`,
    `#define DARK ${D.dark ? 1 : 0}`, `#define GHOSTLY ${D.ghost ? 1 : 0}`,
  ];
  const consts = {
    FW: face.w * (race === 'dwarf' ? 1.08 : 1) * (fem ? 0.95 : 1), JAW: face.jaw * (fem ? 0.82 : 1), CHIN: face.chin * (fem ? 0.9 : 1), CHEEK: face.cheek,
    HOLLOW: face.hollow ?? 0, BROW: face.brow * (fem ? 0.6 : 1), NECK: neckW, AGE: age,
    NL: nose.len * (fem ? 0.9 : 1), NW: nose.w * (fem ? 0.88 : 1), NTIP: nose.tip * (fem ? 0.9 : 1), NHOOK: nose.hook, NBRK: nose.broken ? 0.035 : 0,
    ES: eyes.size * (fem ? 1.0 : 1.0), LID: 0.2 + lidAge * (fem ? 0.75 : 1), TILT: eyes.tilt ?? 0,
    MW: mouth.w * (fem ? 0.95 : 1), FULL: Math.min(1.25, mouth.full * (fem ? 1.05 : 1)), SMILE: mouth.smile ?? 0.1,
    BRW: brows.w, ARCH: brows.arch ?? 0.4, BUILD: build * (race === 'dwarf' ? 1.12 : 1),
    GX: gaze[0], GY: gaze[1],
    HAIRT: hair === 3 || hair === 6 ? 0.13 : hair === 4 ? 0.1 : hair === 2 ? 0.035 : fem ? 0.1 : 0.075,
    BEARDT: beard === 1 ? 0.11 : beard === 2 || beard === 3 ? 0.14 : 0.08,
    RECEDE: fem ? 0 : Math.max(0, age - 0.3) * 0.5,
  };
  const colors = {
    SKIN: skinL, LIPC: lipL, EYEC: lin(eyes.c), HAIRC: lin(hairC), BEARDC: lin(beardC), BROWC: lin(brows.c),
    CA: lin(cos.a ?? '#4a4038'), CB: lin(cos.b ?? '#d8ccb0'), COLLAR: lin(cos.collar ?? cos.a ?? '#4a4038'), STOLE: lin(cos.stole ?? '#1d3574'),
    TRIM: lin(cos.trim ?? '#d8b050'), APRON: lin(cos.apron ?? '#4a2e1a'), CLOAKC: lin(cos.cloak ?? '#6a1e16'),
    HEADC: lin(D.head?.c ?? '#56647c'), MITREC: lin(D.head?.mitre ?? D.head?.c ?? '#e8e0d0'), HTRIM: lin(D.head?.trim ?? '#d8b050'),
    BG0: lin(bg[0]), BG1: lin(bg[1]), AURA: lin(aura), KERCH: lin(cos.kerchief ?? '#c8b89a'),
  };
  let src = defs.join('\n') + '\n';
  for (const [k, v] of Object.entries(consts)) src += `const float ${k} = ${F(v)};\n`;
  for (const [k, v] of Object.entries(colors)) src += `const vec3 ${k} = ${V3(v)};\n`;
  src += `const mat3 HRT = ${M3(tr(HR))};\nconst mat3 HRW = ${M3(HR)};\nconst mat3 TRT = ${M3(tr(TR))};\n`;
  src += `const vec3 PIV = ${V3(PIV)};\nconst vec3 TPV = ${V3(TPV)};\nconst float BODYY = ${F(BODYY)};\n`;
  src += `const vec3 NTOP = ${V3(H2W([0, -0.5, -0.24]))};\nconst vec3 NBOT = ${V3(T2W([0, -2.15, -0.32]))};\n`;
  src += `const vec3 MASTL = ${V3(H2W([-0.5, -0.42, -0.2]))};\nconst vec3 MASTR = ${V3(H2W([0.5, -0.42, -0.2]))};\n`;
  src += `const vec3 STERL = ${V3(T2W([-0.09, -2.1, 0.22]))};\nconst vec3 STERR = ${V3(T2W([0.09, -2.1, 0.22]))};\n`;
  src += `const vec3 HTOP = ${V3(H2W([0, 0.3, -0.25]))};\nconst vec3 HBOT = ${V3(T2W([0, -2.15, -0.35]))};\n`;
  src += `const vec3 KEY = ${V3(key)};\n`;
  // frame: the camera looks at the bust from in front, slightly above the eyes
  const top = head === 2 ? 2.45 : head === 3 ? 1.78 : head === 1 ? 1.62 : hair === 5 ? 1.85 : 1.48;
  const bottom = head === 2 ? -3.05 : head === 3 ? -2.55 : -2.75;
  return { src, top, bottom, side };
}

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const LIB = `
float hash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vnoise3(p) * 0.5 + vnoise3(p * 2.03 + 17.1) * 0.3 + vnoise3(p * 4.1 + 3.7) * 0.2; }
float dot2(vec3 v) { return dot(v, v); }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a; vec3 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float segT(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a; vec3 ba = b - a; return clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); }
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2; vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv);
  float y2 = y * y * l2; float z2 = z * z * l2; float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
vec2 rot2(vec2 v, float a) { float c = cos(a); float s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
`;

const SDF = `
// ---------------------------------------------------------------- head (head space: eye line y=0, face toward +z)
vec3 eyeC() { return vec3(0.3 * FW, 0.0, 0.715); }
float ER() { return 0.128 * ES; }

// the lidded eye of one side (a: mirrored head point, x>0)
float lids(vec3 a, float d) {
  vec3 e = a - eyeC();
  float R = ER();
  float sh = length(e) - (R + 0.021);
  vec3 nu = normalize(vec3(-0.28 * TILT, 1.0, -0.32 + LID * 0.18));
  float upper = max(sh, R * (0.24 - LID * 0.26) - dot(e, nu));
  vec3 nl = normalize(vec3(0.12 * TILT, -1.0, -0.12));
  float lower = max(sh, R * 0.38 - dot(e, nl));
  d = smin(d, upper, 0.035);
  d = smin(d, lower, 0.03);
  // the crease of the upper lid and the soft bag under the eye
  vec3 cr = e - nu * (R * 0.95) - vec3(0.0, 0.0, R * 0.25);
  d += 0.011 * exp(-dot2(cr / vec3(0.17, 0.028, 0.12)));
  d += (0.004 + AGE * 0.01) * exp(-dot2((e - vec3(0.0, -R * 1.25, R * 0.55)) / vec3(0.12, 0.03, 0.1)));
  return d;
}

float faceSkin(vec3 p) {
  vec3 q = vec3(p.x / FW, p.y, p.z);
  vec3 a = vec3(abs(q.x), q.y, q.z);
  float d = sdEll(q - vec3(0.0, 0.27, -0.17), vec3(0.75, 0.97, 1.0));
  d = smin(d, sdEll(q - vec3(0.0, -0.3, 0.2), vec3(0.6, 0.84, 0.72)), 0.3);
  d = smin(d, sdCap(a, vec3(0.52 * JAW, -0.36, -0.1), vec3(0.19 * (0.7 + 0.3 * JAW), -0.95, 0.49), 0.12 * JAW), 0.24);
  d = smin(d, sdEll(q - vec3(0.0, -0.97, 0.56), vec3(0.22, 0.15, 0.16) * CHIN), 0.16);
  d = smin(d, sdEll(a - vec3(0.45, -0.14, 0.5), vec3(0.18, 0.09, 0.15) * CHEEK), 0.16);
  d = smin(d, sdCap(a, vec3(0.44, -0.12, 0.5), vec3(0.64, -0.1, 0.02), 0.07), 0.12);
  d = smin(d, sdEll(a - vec3(0.28, 0.24, 0.76), vec3(0.26, 0.075 * BROW, 0.11)), 0.14);
#if FEM
  d = smin(d, sdEll(q - vec3(0.0, -0.66, 0.55), vec3(0.31, 0.26, 0.27)), 0.2);
#else
  d = smin(d, sdEll(q - vec3(0.0, -0.66, 0.6), vec3(0.32, 0.27, 0.29)), 0.2);
#endif
  // pressed in: eye sockets, temples, cheek hollows under the zygoma
  d = smax(d, -sdEll(a - vec3(0.3, 0.0, 0.88), vec3(0.19, 0.13, 0.17)), 0.1);
  d = smax(d, -sdEll(a - vec3(0.75, 0.25, 0.3), vec3(0.08, 0.2, 0.22)), 0.12);
  d += (0.012 + HOLLOW * 0.03) * exp(-dot2((a - vec3(0.42, -0.52, 0.5)) / vec3(0.17, 0.2, 0.3)));
#if FEM == 0
  d = smin(d, sdEll(a - vec3(0.5, -0.82, 0.12), vec3(0.14, 0.1, 0.2)), 0.18); // masseter / angle of the jaw
#endif
  // glabella and the knot between the brows
  d = smin(d, sdEll(q - vec3(0.0, 0.17, 0.86), vec3(0.09, 0.07, 0.06)), 0.08);
  d = lids(a, d);
  // nose: bridge, tip, wings; nostrils carved
  float nl = NL;
  vec3 tipC = vec3(NBRK, -0.375 * nl, 1.02 + 0.08 * (nl - 1.0));
  float nose = sdRC(q, vec3(0.0, 0.12, 0.84), tipC + vec3(0.0, 0.03, -0.02), 0.05, 0.068 * NTIP);
  nose = smin(nose, length(q - tipC) - 0.082 * NTIP, 0.07);
  vec3 aw = vec3(abs(q.x - NBRK), q.y, q.z);
  nose = smin(nose, sdEll(aw - vec3(0.098 * NW, -0.43 * nl, 0.925 + 0.05 * (nl - 1.0)), vec3(0.066, 0.056, 0.066) * NW), 0.055);
#if HOOK
  nose = smin(nose, length(q - vec3(0.0, -0.1, 0.965)) - 0.065, 0.09 * NHOOK + 0.01);
#endif
  d = smin(d, nose, 0.07);
  d = smax(d, -sdEll(aw - vec3(0.056 * NW, -0.49 * nl, 0.97 + 0.06 * (nl - 1.0)), vec3(0.033, 0.017, 0.042)), 0.02);
  // lips wrap round the muzzle; corners lift with the smile
  vec3 m = q - vec3(0.0, -0.69, 0.0);
  m.y -= SMILE * 0.35 * m.x * m.x;
  m.z += 1.05 * m.x * m.x;
  float ul = sdEll(m - vec3(0.0, 0.052, 0.905), vec3(0.215 * MW, 0.044 * FULL + 0.012, 0.066));
  ul = smax(ul, -sdEll(m - vec3(0.0, 0.112 * (0.8 + 0.2 * FULL), 0.99), vec3(0.03, 0.03, 0.06)), 0.02); // cupid's bow
  float ll = sdEll(m - vec3(0.0, -0.058, 0.875), vec3(0.175 * MW, 0.052 * FULL + 0.014, 0.07));
  d = smin(d, min(ul, ll), 0.035);
  d = smax(d, -sdEll(m - vec3(0.0, -0.002, 0.95), vec3(0.205 * MW, 0.006, 0.1)), 0.012);
  // philtrum, chin groove, nasolabial folds
  d += 0.007 * exp(-dot2((q - vec3(0.0, -0.575, 0.96)) / vec3(0.03, 0.045, 0.12)));
  d += 0.014 * exp(-dot2((q - vec3(0.0, -0.84, 0.84)) / vec3(0.15, 0.03, 0.2)));
  vec3 nlA = vec3(0.16, -0.41, 0.92); vec3 nlB = vec3(0.285, -0.78, 0.79);
  float nlf = sdCap(a, nlA, nlB, 0.0);
  d += (0.004 + AGE * 0.02) * exp(-nlf * nlf / 0.0009);
  // brow lines and crow's feet with age
  d += AGE * 0.0045 * sin(q.y * 58.0) * smoothstep(0.32, 0.45, q.y) * smoothstep(0.75, 0.55, q.y) * smoothstep(0.45, 0.75, q.z) * smoothstep(0.55, 0.2, a.x);
  d += AGE * 0.003 * sin(atan(a.y - 0.0, a.x - 0.45) * 22.0) * exp(-dot2((a - vec3(0.5, -0.02, 0.6)) / vec3(0.06, 0.08, 0.1)));
  // ears (rim, concha, lobe), set back on the skull
  vec3 ep = a - vec3(0.75, -0.17, -0.1);
  ep.xz = rot2(ep.xz, -0.4);
  ep.yz = rot2(ep.yz, 0.18);
  float ear = sdEll(ep, vec3(0.075, 0.29, 0.17));
#if EARS == 2
  ear = smin(ear, sdRC(ep, vec3(0.0, 0.1, -0.03), vec3(0.04, 0.6, -0.26), 0.07, 0.008), 0.08);
#elif EARS == 1
  ear = smin(ear, sdRC(ep, vec3(0.0, 0.1, -0.03), vec3(0.02, 0.34, -0.14), 0.07, 0.015), 0.07);
#endif
  ear = smax(ear, -sdEll(ep - vec3(0.068, -0.03, 0.02), vec3(0.05, 0.175, 0.095)), 0.035);
  ear = smin(ear, length(ep - vec3(0.0, -0.245, 0.03)) - 0.064, 0.05);
  d = smin(d, ear, 0.045);
  return d * min(FW, 1.0);
}

float eyeballs(vec3 p) {
  vec3 a = vec3(abs(p.x), p.y, p.z);
  return length(a - eyeC()) - ER();
}

// ---------------------------------------------------------------- hair & beard as thickness grown off the skin
float hairline(vec3 p) {
  // height of the hairline by azimuth round the head: brow at the front, above the ears, nape behind
  float az = atan(p.x, p.z + 0.15);
  float c = cos(az);
  float front = 0.8 + RECEDE * (0.3 + 0.25 * abs(sin(az * 3.0)));
#if HAIR == 3 || HAIR == 6
  float sideH = -0.42;
#else
  float sideH = -0.08;
#endif
  float back = -0.82;
  return c > 0.0 ? mix(sideH, front, pow(c, 1.4)) : mix(sideH, back, pow(-c, 0.7));
}

float hairThick(vec3 p) {
#if HAIR == 0
  return 0.0;
#else
  float hl = hairline(p) + 0.07 * (vnoise3(p * 7.0) - 0.5);
  float m = smoothstep(hl - 0.02, hl + 0.16, p.y);
#if HAIR == 2
  m *= smoothstep(0.5, 0.3, p.y + 0.18 * p.z + 0.12 * (vnoise3(p * 6.0) - 0.5)); // tonsure: a fringe ring, the pate shaved
#endif
  // keep the ears clear unless the hair is long
#if HAIR != 3 && HAIR != 6
  vec3 a = vec3(abs(p.x), p.y, p.z);
  m *= smoothstep(0.0, 0.1, length((a - vec3(0.76, -0.15, -0.1)) / vec3(1.0, 1.15, 1.0)) - 0.3);
#endif
  if (m <= 0.0) return 0.0;
  // strands flow front-to-back over the skull: ridges across that flow, clumped
  float s = atan(p.x, p.y + 0.25);
  float al = p.z * 2.0 - p.y;
  float cl = vnoise3(vec3(s * 9.0, al * 1.2, 0.5)) * 0.7 + vnoise3(vec3(s * 22.0, al * 2.5, 2.5)) * 0.3;
  float rid = vnoise3(vec3(s * 60.0, al * 3.0, 1.0));
  float lump = vnoise3(p * 3.2 + 4.0);
  float t = HAIRT * (0.6 + 0.5 * cl + 0.5 * lump) * (1.0 - 0.15 * rid);
#if HAIR == 3 || HAIR == 6
  t *= 1.0 + 0.4 * smoothstep(0.3, -0.4, p.y);
#endif
  return t * m;
#endif
}

float browThick(vec3 p) {
  vec3 a = vec3(abs(p.x / FW), p.y, p.z);
  float u = (a.x - 0.27) / 0.21;
  if (abs(u) > 1.25 || a.z < 0.45) return 0.0;
  float yb = 0.215 + ARCH * 0.045 * (1.0 - u * u) - 0.03 * max(u, 0.0) * max(u, 0.0);
  float w = (0.03 + 0.012 * (1.0 - u)) * (0.75 + 0.25 * BRW);
  float m = exp(-pow((a.y - yb) / w, 2.0)) * smoothstep(1.2, 0.85, abs(u)) * smoothstep(-1.25, -0.9, u);
  float rid = 0.5 + 0.5 * sin(a.x * 190.0 + a.y * 80.0 + vnoise3(a * 40.0) * 3.0);
  return m * 0.016 * (0.7 + 0.3 * BRW) * (0.45 + 0.55 * rid);
}

float beardThick(vec3 p) {
#if BEARD == 0 || BEARD == 5 || BEARD == 6
  return 0.0;
#else
  vec3 q = vec3(p.x / FW, p.y, p.z);
  vec3 a = vec3(abs(q.x), q.y, q.z);
#if BEARD == 4
  // goatee: chin and the corners of the mouth only
  float m = exp(-dot2((q - vec3(0.0, -0.98, 0.6)) / vec3(0.3, 0.26, 0.4)));
  m = smoothstep(0.25, 0.6, m);
#else
  float top = mix(-0.12, -0.54, smoothstep(-0.05, 0.75, q.z)) - 0.06 * smoothstep(0.1, 0.0, a.x);
  float m = smoothstep(top + 0.06, top - 0.12, q.y);
  // a clean edge in front of the ear and under the jaw at the back
  m *= smoothstep(-0.32, -0.12, q.z + 0.15 * (q.y + 0.4));
#endif
  // the lips stay clear: the lower lip shows through the beard
  m *= smoothstep(0.0, 0.05, length((q - vec3(0.0, -0.76, 0.95)) / vec3(1.0, 0.42, 1.0)) - 0.12 * MW);
  if (m <= 0.0) return 0.0;
  float s = atan(q.x, q.z - 0.1);
  float cl = vnoise3(vec3(s * 7.0, q.y * 2.5, 1.3)) * 0.7 + vnoise3(vec3(s * 16.0, q.y * 5.0, 4.3)) * 0.3;
  float rid = vnoise3(vec3(s * 55.0, q.y * 3.0, 2.0));
  float t = BEARDT * (0.72 + 0.5 * cl) * (1.0 - 0.16 * rid);
  t *= 1.0 + 0.8 * smoothstep(-0.7, -1.1, q.y); // fuller at the chin
  return t * m;
#endif
}

// hanging masses: long hair behind the shoulders, buns, long beards, braids, moustaches
float hairMass(vec3 p) {
  float d = 1e3;
#if HAIR == 3 || HAIR == 6
  float wv = HAIR == 3 ? 0.06 * sin(p.y * 5.0 + 1.3) : 0.0;
  vec3 q = vec3(p.x + wv, p.y, p.z);
  float fall = sdRC(q, vec3(0.0, 0.25, -0.38), vec3(0.0, -2.35, -0.62), 0.86, 1.18);
  // frame the face and fall behind the neck and shoulders
  fall = smax(fall, -sdEll(q - vec3(0.0, -0.55, 0.95), vec3(0.64, 1.6, 0.95)), 0.12);
  fall = smax(fall, q.z - 0.15 + 0.25 * smoothstep(-0.6, -1.6, q.y), 0.1);
  float s = atan(q.x, q.z + 0.4);
  float cl = vnoise3(vec3(s * 6.0, q.y * 1.5, 0.7));
  fall -= 0.035 * cl + 0.01 * vnoise3(vec3(s * 45.0, q.y * 2.0, 0.0));
  d = min(d, fall);
#endif
#if HAIR == 4
  vec3 b = p - vec3(0.0, 0.55, -1.02);
  float bun = sdEll(b, vec3(0.38, 0.34, 0.3));
  float tw = atan(b.y, b.x);
  bun -= 0.02 * sin(tw * 9.0 + length(b) * 25.0);
  d = min(d, bun);
#endif
#if HAIR == 5
  vec3 b = p - vec3(0.0, 1.32, -0.25);
  d = min(d, sdEll(b, vec3(0.24, 0.28, 0.24)) - 0.01 * sin(atan(b.y, b.x) * 9.0));
#endif
  return d;
}

float beardMass(vec3 p) {
  float d = 1e3;
  vec3 q = vec3(p.x / FW, p.y, p.z);
#if BEARD == 2
  vec3 lq = q - vec3(0.0, -1.0, 0.45);
  float lb = sdEll(lq - vec3(0.0, -0.55, 0.12), vec3(0.62 - 0.12 * clamp(-lq.y, 0.0, 1.6), 0.95, 0.36));
  lb = smin(lb, sdRC(q, vec3(0.0, -1.1, 0.55), vec3(0.0, -2.45, 0.78), 0.4, 0.12), 0.25);
  float s = atan(q.x, q.z - 0.2);
  float cl = vnoise3(vec3(s * 5.0 + q.y * 1.5, q.y * 2.0, 3.1));
  lb -= 0.045 * cl + 0.01 * vnoise3(vec3(s * 40.0, q.y * 3.0, 0.0));
  d = min(d, lb);
#endif
#if BEARD == 3
  d = min(d, sdRC(q, vec3(0.0, -0.95, 0.52), vec3(0.0, -1.35, 0.62), 0.36, 0.24));
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec3 c = vec3(0.025 * sin(fi * 2.1), -1.45 - fi * 0.16, 0.64 + fi * 0.01);
    d = smin(d, sdEll(q - c, vec3(0.13 - fi * 0.008, 0.1, 0.11)), 0.03);
  }
#endif
#if BEARD == 1 || BEARD == 2 || BEARD == 3 || BEARD == 4 || BEARD == 5
  // moustache: two swept wings from under the nose over the corners of the mouth
  vec3 a = vec3(abs(q.x), q.y, q.z);
  float w = sdCap(a, vec3(0.015, -0.565, 0.99), vec3(0.15, -0.6, 0.96), 0.05);
  w = smin(w, sdRC(a, vec3(0.15, -0.6, 0.96), vec3(0.29, -0.77, 0.83), 0.052, 0.025), 0.03);
  w -= 0.004 * sin(a.x * 160.0 + a.y * 50.0);
  d = min(d, w);
#endif
  return d;
}

// ---------------------------------------------------------------- headgear & spectacles (head space)
float headgear(vec3 p) {
  float d = 1e3;
#if HEADW == 2
  // mitre: a band hugging the brow and a pointed double panel above it
  float band = max(sdEll(p - vec3(0.0, 0.27, -0.17), vec3(0.84, 1.04, 1.08)), abs(p.y - 0.58) - 0.13);
  band = max(band, -sdEll(p - vec3(0.0, 0.27, -0.17), vec3(0.74, 0.95, 0.98)));
  vec3 q = p - vec3(0.0, 0.58, -0.17);
  const float c = 1.006; const float r = 1.806;
  float ves = max(length(q.xy + vec2(c, 0.0)) - r, length(q.xy - vec2(c, 0.0)) - r);
  ves = max(ves, -q.y);
  float zd = 1.05 * clamp(1.0 - q.y / 1.75, 0.08, 1.0);
  float body = max(ves, abs(q.z) - zd) * 0.8;
  d = min(band, body);
#elif HEADW == 1
  // hood: a cowl shell round the head, open in front, falling onto the shoulders
  float outer = sdEll(p - vec3(0.0, 0.22, -0.24), vec3(1.0, 1.2, 1.2));
  float inner = sdEll(p - vec3(0.0, 0.18, -0.12), vec3(0.87, 1.06, 1.08));
  float shell = max(outer, -inner);
  float cut = dot(p - vec3(0.0, 0.0, 0.5), normalize(vec3(0.0, 0.2, 1.0))) + 0.04 * sin(p.y * 6.0 + p.x * 3.0);
  shell = smax(shell, cut, 0.05);
  float az = atan(p.x, p.z);
  shell -= 0.025 * sin(az * 7.0 + vnoise3(p * 2.0) * 3.0) * smoothstep(0.6, -0.6, p.y);
  d = shell;
#elif HEADW == 3
  // armet: a round skull with a low comb, a sparrow-beak visor with a sight and breaths, a bevor
  // lapped over the chin, and the visor's pivot rivets
  vec3 a = vec3(abs(p.x), p.y, p.z);
  float skull = sdEll(p - vec3(0.0, 0.3, -0.12), vec3(0.97, 1.13, 1.16));
  float comb = max(sdEll(p - vec3(0.0, 0.32, -0.14), vec3(0.07, 1.22, 1.25)), 0.5 - p.y);
  skull = smin(skull, comb, 0.03);
  // the brow of the skull juts a little over the sight
  skull = smin(skull, max(sdEll(p - vec3(0.0, 0.12, 0.1), vec3(0.95, 0.2, 1.08)), -p.y + 0.04), 0.03);
  vec3 vq = p - vec3(0.0, -0.1, 0.2);
  // the sparrow's beak: the visor pinches to a keel down the middle of the face (narrower the
  // further forward), so its cheeks stay curved and catch the light
  vq.x *= 1.0 + 0.55 * max(vq.z, 0.0);
  float visor = sdEll(vq, vec3(0.9, 0.74, 1.1)) * 0.8;
  visor = smax(visor, abs(vq.x) * 0.45 + vq.z * 0.9 - 1.02, 0.08);
  visor = smax(visor, -(p.z - 0.0), 0.04);
  visor = max(visor, p.y - 0.09);
  float h = min(skull, visor - 0.004);
  // the sight: one dark slot between brow and visor
  float slit = max(abs(p.y - 0.01) - 0.055, 0.45 - p.z);
  slit = max(slit, a.x - 0.6);
  h = smax(h, -slit, 0.012);
  // breaths: a grid of small holes on the visor's cheek
  vec2 g = vec2(a.x - 0.33, p.y + 0.3);
  vec2 cell = vec2(0.075, 0.072);
  vec2 id = clamp(floor(g / cell + 0.5), vec2(-1.0, -1.0), vec2(1.0, 1.0));
  float holes = max(length(g - id * cell) - 0.017, 0.45 - p.z);
  h = max(h, -holes);
  // bevor
  vec3 bq = p - vec3(0.0, -0.86, 0.1);
  bq.x *= 1.0 + 0.5 * max(bq.z, 0.0);
  float bev = sdEll(bq, vec3(0.88, 0.52, 1.04)) * 0.8;
  bev = smax(bev, abs(bq.x) * 0.45 + bq.z * 0.9 - 0.96, 0.08);
  bev = max(bev, p.y + 0.5);
  // the bevor's turned edge
  bev = smin(bev, max(abs(p.y + 0.52) - 0.025, sdEll(bq, vec3(0.92, 0.56, 1.08)) * 0.8), 0.01);
  bev = max(bev, p.y + 0.49);
  h = min(h, bev);
  // pivot rivets and a row of rivets along the bevor's edge
  h = min(h, length(a - vec3(0.95, 0.06, 0.02)) - 0.07);
  d = h;
#endif
  return d;
}

float specs(vec3 p) {
#if SPECS
  vec3 a = vec3(abs(p.x), p.y, p.z);
  vec3 r = a - vec3(0.3 * FW, -0.01, 0.965);
  float ring = length(vec2(length(r.xy) - 0.125, r.z)) - 0.008;
  float bridge = sdCap(vec3(p.x, p.y - 4.0 * p.x * p.x, p.z), vec3(-0.17, 0.035, 0.935), vec3(0.17, 0.035, 0.935), 0.009);
  float arm = sdCap(a, vec3(0.425 * FW, 0.0, 0.93), vec3(0.755 * FW, 0.03, 0.0), 0.008);
  return min(min(ring, bridge), arm);
#else
  return 1e3;
#endif
}

// ---------------------------------------------------------------- body (torso space) and neck (world)
float bodyD(vec3 tp) {
  vec3 a = vec3(abs(tp.x), tp.y, tp.z);
  float d = sdEll(tp - vec3(0.0, -3.5, -0.32), vec3(1.36 * BUILD, 1.65, 0.78));
  d = smin(d, sdEll(a - vec3(1.42 * BUILD, -2.72, -0.32), vec3(0.46, 0.4, 0.5)), 0.4);
  d = smin(d, sdCap(a, vec3(0.3, -1.98, -0.4), vec3(1.3 * BUILD, -2.45, -0.36), 0.26), 0.4);
  d = smin(d, sdCap(a, vec3(1.58 * BUILD, -2.85, -0.32), vec3(1.72 * BUILD, -4.9, -0.25), 0.36 * BUILD), 0.32);
#if FEM
  d = smin(d, sdEll(a - vec3(0.42, -3.0, 0.3), vec3(0.34, 0.3, 0.3)), 0.25);
#endif
#if COSTUME == 8
  // plate: a keeled breastplate, a gorget of three lames about the neck, pauldrons of four
  d = smin(d, sdEll(tp - vec3(0.0, -3.25, -0.12), vec3(0.09, 1.25, 0.62)), 0.22);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y0 = -1.86 - fi * 0.17;
    d = min(d, sdRC(tp, vec3(0.0, y0, -0.3), vec3(0.0, y0 - 0.2, -0.3), 0.5 + fi * 0.13, 0.6 + fi * 0.13));
  }
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec3 c = vec3(1.3 * BUILD + fi * 0.07, -2.42 - fi * 0.19, -0.34);
    float e = sdEll(a - c, vec3(0.6 - fi * 0.035, 0.4 - fi * 0.02, 0.58 - fi * 0.035));
    e = max(e, (c.y - 0.14) - a.y);
    d = min(d, e);
  }
  return d;
#endif
  // drapery: folds that hang from each shoulder point toward the middle, sharp ridges, soft troughs
  float ang = atan(tp.y + 2.45, a.x - 1.15 * BUILD);
  float wob = vnoise3(tp * 1.3) * 2.5;
  float rid = 1.0 - abs(sin(ang * 7.0 + wob));
  float hang = smoothstep(-2.6, -3.6, tp.y) * (0.5 + 0.5 * smoothstep(1.3, 0.3, a.x));
  float vert = 1.0 - abs(sin(tp.x * 6.0 + vnoise3(tp * 2.1) * 3.0));
#if COSTUME == 5
  d -= 0.008 * rid * hang;
#else
  d -= (0.04 * rid * rid + 0.025 * vert * smoothstep(-3.0, -4.0, tp.y)) * hang;
#endif
#if COSTUME == 0 || COSTUME == 1
  // a standing collar round the neck
  float col = sdRC(tp, vec3(0.0, -2.35, -0.3), vec3(0.0, -1.85, -0.28), 0.66, 0.6);
  col = max(abs(col) - 0.05, -(tp.y + 2.4));
  col = max(col, tp.y + 1.85 - 0.12 * smoothstep(0.0, -0.6, tp.z));
  d = min(d, col);
#endif
#if COSTUME == 6
  // kerchief over the shoulders
  float ker = length(vec2(length((tp.xz - vec2(0.0, -0.3)) / vec2(1.0, 0.7)) - 0.72, tp.y + 2.28)) - 0.1;
  d = smin(d, ker, 0.05);
#endif
#if CLOAK
  float cutF = sdEll(tp - vec3(0.0, -3.4, 1.05), vec3(0.95, 2.0, 1.15));
  float cloak = smax(d - 0.085, -cutF, 0.06);
  cloak -= 0.02 * sin(atan(tp.z + 0.3, tp.x) * 10.0 + vnoise3(tp * 2.0) * 3.0) * smoothstep(-2.4, -3.4, tp.y);
  d = min(d, cloak);
#endif
  return d;
}

float neckD(vec3 pw) {
  float d = sdRC(pw, NBOT, NTOP, 0.5 * NECK, 0.41 * NECK);
  d = smin(d, sdCap(pw, MASTL, STERL, (FEM == 1 ? 0.065 : 0.08) * NECK), 0.18);
  d = smin(d, sdCap(pw, MASTR, STERR, (FEM == 1 ? 0.065 : 0.08) * NECK), 0.18);
  return d;
}

// ---------------------------------------------------------------- the scene
int gM; float gHT; float gBT; float gBR;
// material ids
#define M_SKIN 1
#define M_EYE 2
#define M_HAIR 3
#define M_BEARD 4
#define M_BROW 5
#define M_CLOTH 6
#define M_HEADW 7
#define M_SPEC 8
float mapM(vec3 pw) {
  const bool wantM = true;
  vec3 hp = HRT * (pw - PIV) + PIV;
  vec3 tp = TRT * (pw - TPV) + TPV; tp.y -= BODYY;
  float d = 1e3;
  if (wantM) gM = 0;
  // body
  float bb = length((tp - vec3(0.0, -3.2, -0.3)) / vec3(2.4, 1.9, 1.3)) - 1.0;
  if (bb < 0.3) {
    float b = bodyD(tp);
    if (b < d) { d = b; if (wantM) gM = M_CLOTH; }
  } else d = bb;
  float nk = neckD(pw);
  if (nk < d) { d = nk; if (wantM) gM = M_SKIN; }
  // head (bounded)
  float hb = length(hp - vec3(0.0, -0.1, -0.1)) - 1.75;
#if HEADW == 2
  hb = min(hb, length(hp - vec3(0.0, 1.2, -0.17)) - 1.3);
#endif
#if HAIR == 3 || HAIR == 6 || BEARD == 2
  hb = min(hb, length(hp - vec3(0.0, -1.6, -0.2)) - 1.5);
#endif
  if (hb > d) return min(d, hb + 0.05);
  // a cheap shell round skull, face and ears: far from it, the detailed face need not be evaluated
  // (every piece is still evaluated at one place only, so the field is inlined once)
  float shell = sdEll(hp - vec3(0.0, -0.02, -0.02), vec3(0.98, 1.38, 1.28)) - 0.18;
  float s = shell;
  if (shell <= 0.12) s = faceSkin(hp);
  float ht = 0.0; float bt = 0.0; float br = 0.0;
  if (shell <= 0.12 && s <= 0.35) { ht = hairThick(hp); bt = beardThick(hp); br = browThick(hp); }
  float sk = shell > 0.12 ? shell : s > 0.35 ? s - 0.25 : s - ht - bt - br;
  if (sk < d) {
    d = sk;
    gM = M_SKIN; gHT = ht; gBT = bt; gBR = br;
  }
  float e = eyeballs(hp);
  if (e < d) { d = e; if (wantM) gM = M_EYE; }
  float hm = hairMass(hp);
  if (hm < d) { d = hm; if (wantM) gM = M_HAIR; }
  float bm = beardMass(hp);
  if (bm < d) { d = bm; if (wantM) gM = M_BEARD; }
  float hw = headgear(hp);
  if (hw < d) { d = hw; if (wantM) gM = M_HEADW; }
  float sp = specs(hp);
  if (sp < d) { d = sp; if (wantM) gM = M_SPEC; }
  return d;
}

`;

const MAIN = `
uniform vec2 uRes;
uniform vec3 uCam; // camera z, frame centre y, half height
layout(location = 0) out vec4 oC;

vec3 background(vec2 uv) {
  vec2 c = uv - vec2(0.44, 0.36);
  float r = length(c * vec2(1.0, 0.8));
  vec3 col = mix(BG0, BG1, smoothstep(0.05, 0.75, r));
  col += AURA * 0.12 * exp(-r * r * 9.0);
  // loose brushwork: long diagonal strokes of two values
  vec2 sd = vec2(uv.x * 2.2 + uv.y * 1.3, uv.y * 2.0 - uv.x * 3.4);
  float st = vnoise3(vec3(sd.x * 3.0, sd.y * 14.0, 2.0));
  float st2 = vnoise3(vec3(sd.x * 7.0, sd.y * 30.0, 5.0));
  col *= 0.86 + 0.22 * st + 0.08 * st2;
  return col;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = vec2(fc.x / uRes.x, 1.0 - fc.y / uRes.y);
  float aspect = uRes.x / uRes.y;
  vec2 sp = (fc / uRes - 0.5) * 2.0;
  vec3 ro = vec3(0.0, 0.2, uCam.x); // eye level: an off-axis frustum frames the bust without looking up the nose
  vec3 tgt = vec3(sp.x * uCam.z * aspect, uCam.y + sp.y * uCam.z, 0.0);
  vec3 rd = normalize(tgt - ro);
  vec3 L = KEY;
  // Every evaluation of the field goes through ONE call site in one loop (march, normal taps, soft
  // shadow, occlusion, thickness): the field is inlined once, so the shader compiles in a fraction
  // of the time a call per helper would take (software GL compiles it on the first draw).
  float t = max(0.0, uCam.x - 3.2);
  float hit = -1.0;
  int phase = 0; int k = 0;
  vec3 p = ro; vec3 n = vec3(0.0, 0.0, 1.0); vec4 nacc = vec4(0.0);
  int m = 0; float gHT0 = 0.0; float gBT0 = 0.0; float gBR0 = 0.0;
  float eN = 0.0;
  float st = 0.03; float res = 1.0; float sh = 1.0;
  float occ = 0.0; float sc = 1.0; float ao = 1.0;
  float thinD = 0.0;
  for (int it = 0; it < 150; it++) {
    vec3 q;
    if (phase == 0) q = ro + rd * t;
    else if (phase == 1) q = p + eN * (k == 0 ? vec3(1.0, -1.0, -1.0) : k == 1 ? vec3(-1.0, -1.0, 1.0) : k == 2 ? vec3(-1.0, 1.0, -1.0) : vec3(1.0, 1.0, 1.0));
    else if (phase == 2) q = p + n * 0.004 + L * st;
    else if (phase == 3) q = p + n * (0.02 + 0.035 * float(k * k));
    else if (phase == 4) q = p - n * 0.04;
    else break;
    float d = mapM(q);
    if (phase == 0) {
      if (d < 0.0012 * t) { hit = t; p = q; m = gM; gHT0 = gHT; gBT0 = gBT; gBR0 = gBR; eN = 0.0012 * t; phase = 1; k = 0; continue; }
      t += d * (d > 0.1 ? 0.9 : 0.72);
      if (t > uCam.x + 4.0) break;
    } else if (phase == 1) {
      vec3 kv = k == 0 ? vec3(1.0, -1.0, -1.0) : k == 1 ? vec3(-1.0, -1.0, 1.0) : k == 2 ? vec3(-1.0, 1.0, -1.0) : vec3(1.0, 1.0, 1.0);
      nacc.xyz += kv * d;
      k++;
      if (k == 4) { n = normalize(nacc.xyz); phase = 2; k = 0; }
    } else if (phase == 2) {
      res = min(res, 9.0 * d / st);
      st += clamp(d * 0.85, 0.04, 0.45);
      k++;
      if (res < 0.004 || st > 4.5 || k >= 18) { sh = clamp(res, 0.0, 1.0); phase = 3; k = 1; }
    } else if (phase == 3) {
      float hh = 0.02 + 0.035 * float(k * k);
      occ += (hh - d) * sc; sc *= 0.7;
      k++;
      if (k > 3) { ao = clamp(1.0 - 1.9 * occ, 0.0, 1.0); phase = 4; }
    } else if (phase == 4) {
      thinD = d;
      phase = 5;
    }
  }
  if (hit < 0.0) { oC = vec4(pow(background(uv), vec3(1.0 / 2.2)), 0.0); return; }
  vec3 hp = HRT * (p - PIV) + PIV;
  vec3 tp = TRT * (p - TPV) + TPV; tp.y -= BODYY;
  vec3 v = -rd;
  vec3 keyC = vec3(1.0, 0.91, 0.8) * 2.3;
  vec3 fillD = normalize(vec3(-L.x * 1.2, 0.1, 0.65));
  vec3 fillC = vec3(0.38, 0.46, 0.66) * 0.3;
  vec3 rimD = normalize(vec3(-L.x * 0.9, 0.35, -0.75));
  vec3 rimC = AURA * 1.25;
  vec3 alb = vec3(0.5);
  float rough = 0.6; float specK = 0.15; float sss = 0.0; float metal = 0.0; float aniso = 0.0;
  vec3 T = vec3(0.0, 1.0, 0.0);
  int kind = 0; // 0 dielectric, 1 skin, 2 hair, 3 eye, 4 metal
  // ---------------------------------------------------------------- materials
  if (m == M_SKIN) {
    float ht = gHT0; float bt = gBT0; float br = gBR0;
    bool isHead = length(hp - vec3(0.0, -0.1, -0.1)) < 1.8;
    if (ht > 0.012) { m = M_HAIR; }
    else if (bt > 0.012) { m = M_BEARD; }
    else if (br > 0.004) { m = M_BROW; }
    if (m == M_SKIN) {
      kind = 1; sss = 1.0;
      alb = SKIN;
      vec3 q = vec3(hp.x / FW, hp.y, hp.z);
      vec3 a = vec3(abs(q.x), q.y, q.z);
      if (isHead) {
        // regional colour: warm cheeks, nose and ears; a paler, yellower brow; cool, shadowed jaw on men
        float cheek = exp(-dot2((a - vec3(0.43, -0.35, 0.6)) / vec3(0.2, 0.2, 0.3)));
        float nose = exp(-dot2((q - vec3(0.0, -0.34, 1.03)) / vec3(0.12, 0.14, 0.2)));
        float ear = exp(-dot2((a - vec3(0.76, -0.17, -0.1)) / vec3(0.12, 0.3, 0.22)));
        alb *= mix(vec3(1.0), vec3(1.1, 0.86, 0.8), clamp(cheek * 0.75 + nose * 0.6 + ear * 0.7, 0.0, 1.0));
        alb *= mix(vec3(1.0), vec3(1.04, 1.0, 0.9), smoothstep(0.2, 0.5, q.y) * 0.6);
#if FEM == 0 && BEARD != 1 && BEARD != 2 && BEARD != 3
        float jaw = smoothstep(-0.45, -0.75, q.y) * smoothstep(-0.25, 0.1, q.z) * (1.0 - smoothstep(0.0, 0.12, length((q - vec3(0.0, -0.73, 0.95)) / vec3(1.0, 0.5, 1.0)) - 0.17));
        alb *= mix(vec3(1.0), vec3(0.8, 0.82, 0.88), jaw * (BEARD == 6 ? 0.9 : 0.45));
#endif
        // under-eye shadow, age spots
        alb *= mix(vec3(1.0), vec3(0.86, 0.78, 0.82), exp(-dot2((a - vec3(0.27, -0.13, 0.84)) / vec3(0.13, 0.05, 0.1))) * (0.4 + AGE * 0.5));
        alb *= 1.0 - AGE * 0.15 * smoothstep(0.62, 0.8, vnoise3(hp * 14.0));
        // lips
        vec3 mm = q - vec3(0.0, -0.69, 0.0); mm.y -= SMILE * 0.35 * mm.x * mm.x; mm.z += 1.05 * mm.x * mm.x;
        float lipD = min(length((mm - vec3(0.0, 0.05, 0.905)) / vec3(0.2 * MW, 0.05 * FULL + 0.016, 0.075)), length((mm - vec3(0.0, -0.058, 0.875)) / vec3(0.17 * MW, 0.058 * FULL + 0.018, 0.08)));
        float lip = smoothstep(1.15, 0.92, lipD);
        alb = mix(alb, LIPC, lip);
        rough = mix(0.5, 0.3, lip);
        specK = 0.18 + 0.2 * lip;
        // oily T-zone: brow and nose take a brighter, tighter sheen
        float tz = max(nose, exp(-dot2((q - vec3(0.0, 0.42, 0.85)) / vec3(0.35, 0.18, 0.3))));
        rough -= tz * 0.15; specK += tz * 0.12;
#if SCAR
        float sc = sdCap(q, vec3(-0.52, 0.38, 0.62), vec3(-0.34, -0.3, 0.74), 0.0);
        alb = mix(alb, alb * vec3(1.15, 0.8, 0.8), exp(-sc * sc / 0.0005) * 0.8);
#endif
      }
      if (isHead) {
        // the lash line along the upper lid (and a fainter one below): the eye's dark frame
        vec3 e = vec3(abs(hp.x), hp.y, hp.z) - eyeC();
        float R = ER();
        vec3 nu = normalize(vec3(-0.28 * TILT, 1.0, -0.32 + LID * 0.18));
        float le = dot(e, nu) - R * (0.24 - LID * 0.26);
        float near = smoothstep(R + 0.07, R + 0.02, length(e)) * smoothstep(-0.02, 0.06, e.z);
        float lash = exp(-le * le / 0.00035) * near;
        vec3 nl = normalize(vec3(0.12 * TILT, -1.0, -0.12));
        float lo = dot(e, nl) - R * 0.44;
        float lash2 = exp(-lo * lo / 0.0002) * near * 0.35;
        alb *= 1.0 - (FEM == 1 ? 0.85 : 0.6) * clamp(lash + lash2, 0.0, 1.0);
#if FEM
        // a little colour on the lids and the cheeks
        alb *= mix(vec3(1.0), vec3(0.92, 0.8, 0.82), smoothstep(0.0, 0.05, le) * smoothstep(0.12, 0.04, le) * near);
        alb *= mix(vec3(1.0), vec3(1.08, 0.88, 0.86), exp(-dot2((a - vec3(0.42, -0.38, 0.62)) / vec3(0.16, 0.14, 0.25))));
#endif
      }
      // pores and mottling
      float pn = vnoise3(hp * 90.0);
      alb *= 0.93 + 0.1 * vnoise3(hp * 6.0) + 0.04 * pn;
      n = normalize(n + (vec3(vnoise3(hp * 70.0), vnoise3(hp * 70.0 + 7.0), vnoise3(hp * 70.0 + 13.0)) - 0.5) * 0.12);
    }
  }
  if (m == M_HAIR || m == M_BEARD || m == M_BROW) {
    kind = 2;
    vec3 base = m == M_HAIR ? HAIRC : m == M_BEARD ? BEARDC : BROWC;
    float s = m == M_HAIR ? atan(hp.x, hp.y + 0.25) : atan(hp.x, hp.z - 0.1);
    float al = m == M_HAIR ? hp.z * 2.0 - hp.y : hp.y;
    float strand = vnoise3(vec3(s * 50.0, al * 1.5, 0.3)) * 0.5 + vnoise3(vec3(s * 140.0, al * 3.0, 1.7)) * 0.3 + vnoise3(vec3(s * 300.0, al * 5.0, 3.1)) * 0.2;
    alb = base * (0.55 + 0.75 * strand);
    // salt in older hair
    alb = mix(alb, vec3(0.55, 0.53, 0.5), AGE * 0.35 * step(0.72, vnoise3(vec3(s * 200.0, al * 4.0, 7.0))));
    rough = 0.4; specK = m == M_BROW ? 0.15 : 0.5;
    if (m == M_BROW) alb = mix(SKIN * 0.6, base, 0.75);
    // strand flow: over the skull from front to back; beards, long hair and brows hang down
    vec3 flowH = (m == M_HAIR && hp.y > -0.3 && length(hp - vec3(0.0, -0.1, -0.1)) < 1.4) ? vec3(0.0, -0.35, -1.0) : (m == M_BROW ? vec3(1.0, 0.15, 0.0) : vec3(0.0, -1.0, 0.1));
#if HAIR == 4
    if (m == M_HAIR && hp.z < -0.7) flowH = vec3(-(hp.y - 0.55), hp.x, 0.0);
#endif
    vec3 fw = HRW * flowH;
    T = normalize(fw - n * dot(fw, n));
    n = normalize(n + T * (strand - 0.5) * 0.3);
  } else if (m == M_EYE) {
    kind = 3;
    vec3 a = vec3(abs(hp.x), hp.y, hp.z);
    vec3 e = normalize(a - eyeC());
    // both eyes look at the camera (plus the design's gaze)
    vec3 camH = HRT * (ro - PIV) + PIV;
    vec3 ec = eyeC(); if (hp.x < 0.0) ec.x = -ec.x;
    vec3 g = normalize(normalize(camH - ec + vec3(GX * 8.0, -GY * 8.0, 0.0)) + vec3(0.0, 0.0, 0.8));
    if (hp.x < 0.0) g.x = -g.x;
    float ca = dot(e, g);
    float ang = acos(clamp(ca, -1.0, 1.0));
    float ir = 0.54;
    vec3 sclera = vec3(0.6, 0.55, 0.52) * mix(1.0, 0.7, smoothstep(0.5, 1.1, ang));
    vec3 iris = EYEC * (0.65 + 0.5 * vnoise3(vec3(atan(e.y, e.x) * 9.0, ang * 30.0, 1.0)));
    iris *= 1.0 - 0.5 * smoothstep(ir * 0.65, ir, ang);   // limbal ring
    iris = mix(iris, vec3(0.01), smoothstep(0.2, 0.17, ang)); // pupil
    alb = mix(iris, sclera, smoothstep(ir - 0.03, ir + 0.02, ang));
    // the upper lid shades the top of the eyeball
    alb *= 1.0 - 0.6 * smoothstep(-0.15, 0.3, dot(e, normalize(vec3(0.0, 1.0, -0.2))));
    rough = 0.08; specK = 1.4;
    vec3 Lh = HRT * L; if (hp.x < 0.0) Lh.x = -Lh.x;
    eN = smoothstep(0.11, 0.06, acos(clamp(dot(e, normalize(g + Lh * 0.38)), -1.0, 1.0)));
  } else if (m == M_SPEC) {
    kind = 4; alb = vec3(0.75, 0.6, 0.35); rough = 0.25; metal = 1.0; specK = 1.0;
  } else if (m == M_HEADW) {
#if HEADW == 2
    vec3 q = hp - vec3(0.0, 0.58, -0.17);
    float trim = max(step(abs(q.y), 0.13), step(abs(q.x), 0.11) * step(0.0, q.y));
    alb = mix(MITREC, HTRIM, trim);
    // embroidered cross on the orphrey and brocade in the field
    alb *= 0.85 + 0.2 * vnoise3(hp * vec3(30.0, 30.0, 30.0));
    if (trim > 0.5) { metal = 0.6; rough = 0.35; specK = 0.9; kind = 4; }
    else { rough = 0.55; specK = 0.25; }
#elif HEADW == 3
    // old plate: worn steel with pitting, darker in the sight and the breaths
    alb = vec3(0.56, 0.57, 0.6) * (0.85 + 0.2 * vnoise3(hp * 9.0)) * (1.0 - 0.25 * smoothstep(0.6, 0.85, vnoise3(hp * 40.0)));
    kind = 4; metal = 1.0; rough = 0.32; specK = 1.0;
#else
    alb = HEADC * (0.85 + 0.25 * vnoise3(hp * 12.0)); rough = 0.8; specK = 0.08;
#endif
  } else if (m == M_CLOTH) {
    vec3 a = vec3(abs(tp.x), tp.y, tp.z);
    alb = CA; rough = 0.75; specK = 0.12;
    float front = smoothstep(-0.1, 0.25, tp.z);
    bool collar = tp.y > -2.42 && length(tp.xz - vec2(0.0, -0.3)) < 0.75;
#if COSTUME == 0
    if (collar) alb = COLLAR;
    // ink stains on the cuff side of the robe

#elif COSTUME == 1
    if (collar) alb = COLLAR;
    float stoleX = abs(a.x - 0.5 + 0.12 * (tp.y + 2.3));
    if (stoleX < 0.17 && front > 0.5 && tp.y < -2.2) {
      alb = STOLE;
      if (stoleX > 0.13) alb = TRIM;
      float cross = max(step(abs(a.x - 0.5 + 0.12 * (tp.y + 2.3)), 0.025) * step(abs(tp.y + 3.1), 0.16), step(abs(tp.y + 3.05), 0.025) * step(stoleX, 0.09));
      alb = mix(alb, TRIM, cross);
    }
#elif COSTUME == 2
    float neckline = -2.45 - 0.35 * (1.0 - smoothstep(0.0, 0.85, a.x));
    if (tp.y > neckline && front > 0.3 && a.x < 1.2) { alb = SKIN; kind = 1; sss = 1.0; rough = 0.5; specK = 0.18; }
    else if (abs(tp.y - neckline) < 0.06 && front > 0.3) { alb = TRIM; rough = 0.35; specK = 0.7; }
    else if (a.x > 1.15) { alb = CB; }
#elif COSTUME == 3
    if (front > 0.4 && a.x < 0.85) { alb = CA; float sy = abs(tp.y + 3.0); if (length(vec2(tp.x, tp.y + 3.0)) < 0.3 && length(vec2(tp.x, tp.y + 3.0)) > 0.22) alb = TRIM; }
    else { alb = vec3(0.32, 0.3, 0.3); kind = 4; metal = 0.7; rough = 0.45; specK = 0.6; }
#elif COSTUME == 4
    alb = CA;
    if (front > 0.5 && a.x < 0.55 && tp.y < -2.65) alb = APRON;
    if (abs(a.x - 0.55) < 0.07 && tp.y > -2.75) alb = APRON;
    if (tp.y > -2.3 && a.x < 0.55 && front > 0.5) { alb = CB; }
#elif COSTUME == 5
    // riveted mail: ring rows that catch the light, dark between the links
    vec2 mu = vec2(atan(tp.x, tp.z + 0.3) * 0.9, tp.y) * 34.0;
    float row = floor(mu.y); mu.x += mod(row, 2.0) * 0.5;
    vec2 f = fract(mu) - 0.5;
    float ring = smoothstep(0.12, 0.05, abs(length(f * vec2(1.0, 1.3)) - 0.34));
    alb = vec3(0.42, 0.42, 0.44) * (0.25 + 0.95 * ring);
    n = normalize(n + (HRW * vec3(f.x, -f.y, 0.0)) * ring * 0.9);
    kind = 4; metal = 1.0; rough = 0.35; specK = 1.0;
    if (tp.y > -2.32 && length(tp.xz - vec2(0.0, -0.3)) < 0.8) { alb = CB; kind = 0; metal = 0.0; rough = 0.8; specK = 0.1; }
#elif COSTUME == 8
    alb = vec3(0.55, 0.56, 0.59) * (0.85 + 0.2 * vnoise3(tp * 6.0)) * (1.0 - 0.2 * smoothstep(0.6, 0.85, vnoise3(tp * 30.0)));
    kind = 4; metal = 1.0; rough = 0.3; specK = 1.0;
#elif COSTUME == 6
    float neckline = -2.55;
    if (tp.y > -2.42 && length((tp.xz - vec2(0.0, -0.3)) / vec2(1.0, 0.7)) > 0.58) { alb = KERCH; }
    else if (tp.y > neckline && front > 0.2) { alb = CB; }
    // lacing down the bodice
    if (front > 0.6 && abs(tp.x) < 0.12 && tp.y < -2.65) { float lc = abs(fract(tp.y * 6.0) - 0.5); if (abs(abs(tp.x) - lc * 0.2) < 0.02) alb = vec3(0.85, 0.8, 0.7); }
#endif
#if CLOAK
    float cutF = sdEll(tp - vec3(0.0, -3.4, 1.05), vec3(0.95, 2.0, 1.15));
    if (cutF > 0.02 && !collar) { alb = CLOAKC; kind = 0; metal = 0.0; rough = 0.85; specK = 0.08; }
    // brooch at the shoulder
    if (length(tp - vec3(0.88 * BUILD, -2.45, 0.42)) < 0.16) { alb = TRIM; kind = 4; metal = 1.0; rough = 0.3; specK = 1.0; }
#endif
    if (kind == 0) {
      float weave = sin(tp.x * 220.0) * sin(tp.y * 220.0);
      alb *= 0.9 + 0.08 * weave + 0.12 * vnoise3(tp * 4.0);
    }
  }
#if DARK
  alb *= 0.55;
#endif
  // ---------------------------------------------------------------- lighting
  float ndl = dot(n, L);
  float ndv = max(dot(n, v), 0.0);
  vec3 hv = normalize(L + v);
  vec3 col;
  vec3 sh3 = vec3(sh);
  if (kind == 1) sh3 = pow(vec3(sh), vec3(0.7, 1.0, 1.1)); // the shadow edge of skin turns red
  vec3 amb = mix(vec3(0.12, 0.085, 0.065), vec3(0.16, 0.17, 0.22), n.y * 0.5 + 0.5) * ao;
  if (kind == 1) {
    vec3 w = vec3(0.42, 0.26, 0.2);
    vec3 diff = clamp((vec3(ndl) + w) / (1.0 + w), 0.0, 1.0);
    diff *= diff;
    float ex = 2.0 / max(0.02, rough * rough * 0.25);
    float spec = pow(max(dot(n, hv), 0.0), ex) * specK * (ex + 2.0) / 60.0;
    float fres = pow(1.0 - ndv, 4.0);
    col = alb * keyC * diff * sh3;
    col += spec * keyC * sh * (0.5 + fres) * vec3(1.0, 0.95, 0.9);
    col += alb * fillC * max(0.0, dot(n, fillD) * 0.7 + 0.3);
    col += alb * amb * 1.05;
    col += rimC * pow(max(0.0, dot(n, rimD) + 0.25), 1.5) * pow(1.0 - ndv, 2.5) * 0.7 * ao;
    // light through thin flesh (ears, nostrils) against the key
    float thin = clamp(thinD * -12.0, 0.0, 1.0);
    col += alb * vec3(1.0, 0.35, 0.2) * pow(max(0.0, dot(-n, L)), 2.0) * (1.0 - thin) * 0.6;
  } else if (kind == 2) {
    float diff = clamp((ndl + 0.4) / 1.4, 0.0, 1.0);
    vec3 tA = normalize(T + n * 0.12); vec3 tB = normalize(T - n * 0.1);
    float s1 = pow(sqrt(max(0.0, 1.0 - pow(dot(tA, hv), 2.0))), 90.0);
    float s2 = pow(sqrt(max(0.0, 1.0 - pow(dot(tB, hv), 2.0))), 24.0);
    col = alb * keyC * diff * sh * 0.85;
    col += (keyC * s1 * 0.16 + keyC * alb * s2 * 0.5) * sh * specK;
    col += alb * fillC * max(0.0, dot(n, fillD) * 0.6 + 0.4);
    col += alb * amb;
    col += rimC * pow(max(0.0, dot(n, rimD) + 0.3), 1.5) * pow(1.0 - ndv, 2.0) * 0.8 * ao;
    col *= 0.7 + 0.3 * ao;
  } else if (kind == 3) {
    float diff = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
    col = alb * (keyC * diff * sh * 0.75 + amb * 1.3 + fillC * 0.5);
    col *= ao;
    float spec = pow(max(dot(n, hv), 0.0), 220.0) * 6.0 * max(sh, 0.35);
    col += vec3(spec);
    col += vec3(1.3, 1.25, 1.2) * eN; // the catchlight: a window of the key in the wet cornea
  } else if (kind == 4) {
    vec3 r = reflect(-v, n);
    vec3 env = mix(vec3(0.12, 0.09, 0.07), vec3(0.75, 0.62, 0.5), smoothstep(-0.3, 0.6, r.y)) + AURA * 0.25 * smoothstep(0.2, 0.9, dot(r, rimD));
    float spec = pow(max(dot(n, hv), 0.0), 2.0 / max(0.02, rough * rough)) * specK * 2.5;
    col = alb * (env * 0.55 + keyC * max(0.0, ndl) * sh * 0.35 + amb * 0.6) + keyC * alb * spec * sh;
    col += rimC * pow(1.0 - ndv, 3.0) * 0.5 * ao;
    col *= 0.55 + 0.45 * ao;
  } else {
    float diff = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);
    float sheen = pow(1.0 - ndv, 3.0) * 0.18;
    float spec = pow(max(dot(n, hv), 0.0), 12.0 + 40.0 * (1.0 - rough)) * specK * 0.35;
    col = alb * keyC * diff * sh;
    col += keyC * (spec + sheen * alb) * sh;
    col += alb * fillC * max(0.0, dot(n, fillD) * 0.7 + 0.3);
    col += alb * amb;
    col += rimC * pow(max(0.0, dot(n, rimD) + 0.25), 1.5) * pow(1.0 - ndv, 2.2) * 0.6 * ao;
    col *= 0.6 + 0.4 * ao;
  }
  // the spectacle lenses: a faint reflection laid over whatever is behind them
#if SPECS
  {
    vec3 roH = HRT * (ro - PIV) + PIV; vec3 rdH = HRT * rd;
    for (int s = 0; s < 2; s++) {
      vec3 c = vec3((s == 0 ? -1.0 : 1.0) * 0.3 * FW, -0.01, 0.965);
      float tl = (c.z - roH.z) / rdH.z;
      vec3 pl = roH + rdH * tl;
      if (tl > 0.0 && tl < hit + 0.05 && length(pl.xy - c.xy) < 0.122) {
        vec3 nl = HRW * vec3(0.0, 0.0, 1.0);
        float sp = pow(max(dot(nl, normalize(L + v)), 0.0), 60.0) * 2.5;
        float edge = smoothstep(0.08, 0.122, length(pl.xy - c.xy));
        col = col * 0.88 + vec3(0.9, 0.95, 1.0) * (0.04 + 0.1 * edge) + keyC * sp * 0.4;
      }
    }
  }
#endif
#if GHOSTLY
  // a ghost is glass: a dim core, edges that burn (fresnel), the key only a sheen on the plate
  {
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    float fr = pow(1.0 - ndv, 2.2);
    float l1 = min(lum, 1.2);
    vec3 gc = vec3(0.05, 0.2, 0.25) * (0.3 + l1 * 1.3) * (0.4 + 0.6 * ao) + vec3(0.6, 0.95, 1.0) * smoothstep(0.8, 1.8, lum) * 0.6;
    // translucent: the backdrop shows through the body, least at the burning rims; wisps of denser
    // mist drift up through it
    float wisp = fbm3(vec3(p.x * 2.5, p.y * 1.2 - p.x * 0.6, p.z * 2.5));
    float al = clamp(0.42 + 0.35 * smoothstep(0.35, 0.75, wisp) + 0.6 * fr, 0.0, 1.0);
    col = mix(background(uv), gc, al) + vec3(0.3, 0.8, 0.9) * fr * 0.9 * ao;
  }
  // eyes that burn in the sight, the face behind the visor only half there, the wound alight
  if (m == M_EYE) col = vec3(1.4, 2.1, 2.2);
  else if (m == M_SKIN && length(hp - vec3(0.0, -0.1, -0.1)) < 1.3) col *= 0.75;
  // the wound: a gash of cold light across the throat, between the bevor and the gorget
  col += vec3(0.9, 1.8, 2.0) * exp(-pow((hp.y + 1.3 + 0.12 * hp.x) / 0.05, 2.0)) * smoothstep(-0.3, 0.3, hp.z) * smoothstep(0.6, 0.15, abs(hp.x + 0.05));
#endif
  // tone: soft shoulder, then gamma
  col = col / (1.0 + col * 0.55) * 1.3;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float depth = clamp((hit - (uCam.x - 3.0)) / 7.0, 0.0, 1.0);
  oC = vec4(col, 0.25 + 0.75 * (1.0 - depth));
}
`;

const POST = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uShadow; // offset px of the cast shadow on the backdrop
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec4 T(ivec2 q) { return texelFetch(uTex, clamp(q, ivec2(0), ivec2(uRes) - 1), 0); }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 c0 = T(q);
  vec3 c = c0.rgb;
  bool fig = c0.a > 0.0;
  if (fig) {
    // Kuwahara: the quietest of four quadrants wins (flat, laid-in planes of paint)
    float best = 1e9; vec3 bc = c;
    for (int k = 0; k < 4; k++) {
      ivec2 dir = ivec2((k & 1) == 1 ? 1 : -1, (k & 2) == 2 ? 1 : -1);
      vec3 s = vec3(0.0); float l1 = 0.0; float l2 = 0.0; float cnt = 0.0;
      for (int y = 0; y <= 4; y++) for (int x = 0; x <= 4; x++) {
        vec4 cc = T(q + dir * ivec2(x, y));
        if (cc.a <= 0.0) continue;
        float l = dot(cc.rgb, vec3(0.3, 0.59, 0.11));
        s += cc.rgb; l1 += l; l2 += l * l; cnt += 1.0;
      }
      if (cnt < 1.0) continue;
      float mu = l1 / cnt; float va = l2 / cnt - mu * mu;
      if (va < best) { best = va; bc = s / cnt; }
    }
    c = mix(c, bc, 0.8);
    // brush strokes that follow the form: noise smeared along the isophotes (line integral)
    float lx = dot(T(q + ivec2(2, 0)).rgb - T(q - ivec2(2, 0)).rgb, vec3(0.33));
    float ly = dot(T(q + ivec2(0, 2)).rgb - T(q - ivec2(0, 2)).rgb, vec3(0.33));
    vec2 gdir = vec2(lx, ly);
    vec2 sdir = length(gdir) > 0.004 ? normalize(vec2(-gdir.y, gdir.x)) : vec2(0.7071);
    float st = 0.0;
    for (int i = -5; i <= 5; i++) st += hash(floor(gl_FragCoord.xy * 0.5 + sdir * float(i) * 1.6));
    st = st / 11.0 - 0.5;
    c *= 1.0 + st * 0.16;
    // a dark paint edge on the silhouette and where depth breaks
    float e = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 off = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
      vec4 n2 = T(q + off * 2);
      if (n2.a > 0.0) e = max(e, smoothstep(0.025, 0.08, c0.a - n2.a));
    }
    c *= 1.0 - e * 0.3;
  } else {
    // the figure's soft shadow falls on the painted backdrop
    float occ = 0.0;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
      vec4 s = T(q + ivec2(uShadow) + ivec2(x, y) * 4);
      occ += s.a > 0.0 ? 1.0 : 0.0;
    }
    c *= 1.0 - occ / 25.0 * 0.35;
  }
  // warm lights, cool shadows
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c * vec3(0.9, 0.96, 1.12), c * vec3(1.06, 1.0, 0.9), smoothstep(0.15, 0.6, l));
  // canvas tooth
  vec2 uv = gl_FragCoord.xy;
  float weave = (sin(uv.x * 1.9) * sin(uv.y * 1.9)) * 0.012 + (vn(uv * 0.5) - 0.5) * 0.04;
  c += weave;
  // vignette that holds the face
  vec2 p = gl_FragCoord.xy / uRes - vec2(0.5, 0.58);
  c *= 1.0 - 0.55 * smoothstep(0.25, 0.85, length(p * vec2(1.1, 0.9)));
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const PERF = typeof location !== 'undefined' && /[?&]perf=1/.test(location.search);
const pnow = () => (PERF ? performance.now() : 0);
const plog = (l, t) => { if (PERF) console.info(`[perf] portraitGL ${l} ${Math.round(performance.now() - t)} ms`); };

let GL = null;
function initGL() {
  if (GL !== null) return GL;
  GL = false;
  try {
    if (typeof document === 'undefined') return GL;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return GL;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    GL = { canvas, gl, buf, post: null };
  } catch {
    GL = false;
  }
  return GL;
}

/** Create the portrait context now (a context created while the GPU is busy with a panel waits for it). */
export function warmPortraitGL() { initGL(); }

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`portraitGL shader: ${log}`);
  }
  return s;
}
function link(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`portraitGL link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** The full fragment source of a design (exported for tests / debugging). */
export function portraitSource(D, o = {}) {
  const k = constants(D, o);
  return { ...k, fs: `#version 300 es\nprecision highp float;\n${k.src}${LIB}${SDF}${MAIN}` };
}

/**
 * Render a portrait design. W×H is the output size; the trace runs at `ss`× and the paint pass
 * works at that size before the canvas is resampled down.
 */
export function paintPortraitGL(D, W = 300, H = 375, o = {}) {
  let T = pnow();
  const G = initGL();
  plog('init', T); T = pnow();
  if (!G) return null;
  const { gl } = G;
  const ss = o.ss ?? 1.0;
  const RW = Math.round(W * ss);
  const RH = Math.round(H * ss);
  let prog;
  let k;
  try {
    k = portraitSource(D, o);
    prog = link(gl, k.fs);
    if (!G.post) G.post = link(gl, POST);
    if (PERF) { gl.getProgramParameter(prog, gl.LINK_STATUS); }
    plog('compile', T); T = pnow();
  } catch (e) {
    console.warn(String(e.message ?? e).slice(0, 400));
    return null;
  }
  G.canvas.width = RW;
  G.canvas.height = RH;
  // pass 1: trace into a texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RW, RH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, RW, RH);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, G.buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const half = (k.top - k.bottom) / 2;
  const camZ = 15;
  // perspective: the frame half-height at the bust plane, adjusted for the lens
  gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), RW, RH);
  gl.uniform3f(gl.getUniformLocation(prog, 'uCam'), camZ, (k.top + k.bottom) / 2, half);
  gl.enable(gl.SCISSOR_TEST);
  if (PERF) { gl.scissor(0, 0, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); plog('jit (1px draw)', T); T = pnow(); }
  const band = 48;
  for (let y = 0; y < RH; y += band) {
    gl.scissor(0, y, RW, Math.min(band, RH - y));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.flush();
  }
  gl.disable(gl.SCISSOR_TEST);
  if (PERF) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); plog(`trace ${RW}x${RH}`, T); T = pnow(); }
  // pass 2: paint over it, to the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(G.post);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(G.post, 'uTex'), 0);
  gl.uniform2f(gl.getUniformLocation(G.post, 'uRes'), RW, RH);
  gl.uniform2f(gl.getUniformLocation(G.post, 'uShadow'), -k.side * RW * 0.05, RH * 0.02);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const px = new Uint8Array(RW * RH * 4);
  gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, px);
  plog('post+read', T);
  gl.deleteTexture(tex);
  gl.deleteFramebuffer(fb);
  gl.deleteProgram(prog);
  const big = makeCanvas(RW, RH);
  const bg = big.getContext('2d');
  const img = bg.createImageData(RW, RH);
  for (let y = 0; y < RH; y++) img.data.set(px.subarray((RH - 1 - y) * RW * 4, (RH - y) * RW * 4), y * RW * 4);
  bg.putImageData(img, 0, 0);
  if (RW === W && RH === H) return big;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(big, 0, 0, W, H);
  return c;
}
