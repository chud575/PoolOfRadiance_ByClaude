import * as THREE from 'three';
import { faceParams } from './figureRig.js';
import { hashNum, rngFrom } from './lookData.js';
import { GLSL_HEAD } from './portraitHeadGLSL.js';

/**
 * Ray-marched heads. The party's faces are signed-distance sculpts evaluated
 * per pixel on the GPU (never meshed), so the anatomy keeps every detail at
 * any size: a cranium with a sloped forehead and temple hollows, a brow
 * ridge, orbital sockets with an upper-lid fold and a lash line, real
 * eyeballs (iris, pupil, wet cornea with a catch-light), cheekbones and
 * zygomatic arches, nasolabial folds, a philtrum, cupid's-bow lips, a chin
 * and mandible, ears with helix, concha and lobe (pointed for elves), a neck
 * with the sterno-mastoid cords — and hair, brows, beards and moustaches as
 * offsets of the skin field (so they grow out of it with a real hairline),
 * plus hoods, helms and mail aventails.
 *
 * Each of the 16 head templates has its own skull, nose, jaw and eye
 * proportions (lookData.HEADS face values, exaggerated per race and sex in
 * figureRig.faceParams, plus template-specific skull traits here).
 *
 * Shading: three.js scene lights (directional, point, spot, hemisphere,
 * ambient) read from the standard light uniforms, wrapped subsurface skin
 * with a red terminator, painted colour zones (ruddy cheeks, nose and ears,
 * cool jaw, warm brow), a ray-marched soft shadow from the key light, SDF
 * ambient occlusion, Kajiya–Kay hair highlights, metal and cloth.
 *
 * createHead(app, frame) → a THREE.Mesh (a proxy box around the head) whose
 * material marches the ray and writes real depth, so the head sits in any
 * scene with the rest of the (meshed) figure.
 */

// ------------------------------------------------------------------ parameters

const P = [
  'W', 'LONG', 'JAW', 'CHIN', 'CHEEK', 'NOSE', 'BRIDGE', 'TIP', 'HOOK', 'EYE',
  'SP', 'BROW', 'LIPS', 'MOUTH', 'LID', 'SLANT', 'EARS', 'BTILT', 'SMIRK', 'AGE',
  'FEM', 'CRAN', 'SLOPE', 'EDEPTH', 'HOLLOW', 'JDEPTH', 'PROT', 'ELF', 'NWIDTH', 'SMILE',
  'ASLEEP', 'HVOL', 'BLEN', 'HALF', 'GNOME', 'SCOWL', 'LINES', 'EOPEN', 'BTHICK',
];
const NP = 39;
const DEFINES = P.map((k, i) => `#define ${k} uP[${i}]`).join('\n');

const HAIR = { bald: 0, short: 1, crop: 2, swept: 3, long: 4, wavy: 5, bob: 6, braid: 7, bun: 8, topknot: 9 };
const BEARD = { none: 0, stubble: 1, moustache: 2, goatee: 3, full: 4, long: 5, dwarf: 6 };

/**
 * Skull traits per head template — what makes each of the eight heads a
 * different person beyond hair and beard.
 *   cran cranium height · slope forehead slope · edepth eye depth · hollow cheek
 *   hollows · jdepth jaw projection · prot mouth protrusion · hook nose profile
 *   (−1 snub … +1 aquiline) · nwidth nostril width · smile corner lift
 */
const SKULL = {
  Soldier: { cran: 0.95, slope: 0.35, edepth: 0.65, hollow: 0.15, jdepth: 0.9, prot: 0.1, hook: -0.1, nwidth: 1.18, smile: -0.12, lines: 0.25, eopen: 0.92, bthick: 1.25 },
  Wanderer: { cran: 1.03, slope: 0.6, edepth: 1.0, hollow: 0.85, jdepth: 0.0, prot: 0.0, hook: 0.55, nwidth: 0.95, smile: 0.0, lines: 0.6, eopen: 0.85, bthick: 1.0 },
  Noble: { cran: 1.1, slope: 0.15, edepth: 0.45, hollow: 0.55, jdepth: -0.35, prot: -0.25, hook: 1.1, nwidth: 0.78, smile: 0.08, lines: 0.1, eopen: 1.0, bthick: 0.8 },
  Veteran: { cran: 0.9, slope: 1.0, edepth: 1.15, hollow: 0.3, jdepth: 1.1, prot: 0.4, hook: -0.35, nwidth: 1.38, smile: -0.3, lines: 0.9, eopen: 0.8, bthick: 1.45 },
  Guardsman: { cran: 0.97, slope: 0.4, edepth: 0.7, hollow: 0.05, jdepth: 0.85, prot: 0.15, hook: -0.5, nwidth: 1.25, smile: -0.05, lines: 0.3, eopen: 0.95, bthick: 1.2 },
  Rogue: { cran: 1.0, slope: 0.45, edepth: 0.5, hollow: 0.7, jdepth: -0.45, prot: 0.15, hook: 0.35, nwidth: 0.86, smile: 0.25, lines: 0.15, eopen: 0.82, bthick: 0.85 },
  Hooded: { cran: 1.0, slope: 0.5, edepth: 0.9, hollow: 0.6, jdepth: 0.15, prot: 0.0, hook: 0.7, nwidth: 0.96, smile: -0.08, lines: 0.35, eopen: 0.9, bthick: 1.0 },
  Sage: { cran: 1.14, slope: 0.1, edepth: 1.1, hollow: 0.9, jdepth: -0.05, prot: -0.1, hook: 0.9, nwidth: 1.0, smile: 0.15, lines: 0.7, eopen: 0.88, bthick: 1.3 },
  Maiden: { cran: 1.03, slope: 0.05, edepth: 0.3, hollow: 0.0, jdepth: -0.5, prot: 0.05, hook: -0.55, nwidth: 0.82, smile: 0.28, lines: 0.0, eopen: 1.12, bthick: 0.8 },
  Ranger: { cran: 0.98, slope: 0.35, edepth: 0.65, hollow: 0.5, jdepth: 0.25, prot: 0.0, hook: 0.4, nwidth: 0.95, smile: -0.06, lines: 0.2, eopen: 0.92, bthick: 1.05 },
  Priestess: { cran: 1.06, slope: 0.15, edepth: 0.5, hollow: 0.05, jdepth: -0.25, prot: -0.05, hook: -0.15, nwidth: 0.92, smile: 0.22, lines: 0.3, eopen: 0.98, bthick: 0.9 },
  Duelist: { cran: 0.96, slope: 0.3, edepth: 0.55, hollow: 0.55, jdepth: -0.1, prot: 0.12, hook: 0.7, nwidth: 0.86, smile: 0.18, lines: 0.1, eopen: 0.9, bthick: 0.95 },
  Sorceress: { cran: 1.09, slope: 0.25, edepth: 0.75, hollow: 0.7, jdepth: -0.35, prot: 0.15, hook: 0.25, nwidth: 0.84, smile: 0.05, lines: 0.05, eopen: 1.06, bthick: 0.85 },
  Shieldmaiden: { cran: 0.98, slope: 0.35, edepth: 0.55, hollow: 0.15, jdepth: 0.55, prot: 0.05, hook: 0.0, nwidth: 1.02, smile: -0.06, lines: 0.15, eopen: 0.95, bthick: 1.1 },
  Mercenary: { cran: 0.94, slope: 0.75, edepth: 0.95, hollow: 0.35, jdepth: 0.85, prot: 0.2, hook: -0.3, nwidth: 1.18, smile: -0.22, lines: 0.55, eopen: 0.85, bthick: 1.3 },
};

const lin = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return new THREE.Vector3(...v.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)));
};

const desat = (v, k) => { const g = (v.x + v.y + v.z) / 3; return v.lerp(new THREE.Vector3(g, g, g), k); };

/** Pack an appearance into the shader's parameters. */
export function headParams(app, o = {}) {
  const f = faceParams(app);
  const sk = { ...(SKULL[app.head?.name] ?? SKULL.Soldier) };
  // Per-character jitter: two people with the same template are still two people.
  const R = rngFrom(hashNum(app.seed, app.look?.head, 'skull'));
  const j = (a) => (R() - 0.5) * 2 * a;
  const race = app.race;
  const p = new Float32Array(NP);
  // faceParams exaggerates template deviations for the old meshed heads; the
  // ray-marched head resolves subtle differences, so pull them back into a
  // believable range.
  const soft = new Set(['W', 'LONG', 'JAW', 'CHIN', 'CHEEK', 'NOSE', 'BRIDGE', 'TIP', 'EYE', 'SP', 'LIPS', 'MOUTH']);
  // Wide enough that the eight heads are eight skulls (long and lean, broad and square, round and soft…).
  const RANGE = { W: [0.82, 1.18], LONG: [0.85, 1.16], JAW: [0.72, 1.36], CHIN: [0.7, 1.38], CHEEK: [0.82, 1.42], NOSE: [0.78, 1.36], BRIDGE: [0.72, 1.45], TIP: [0.78, 1.55], EYE: [0.86, 1.17], SP: [0.9, 1.1], LIPS: [0.78, 1.3], MOUTH: [0.86, 1.15] };
  const set = (k, v) => {
    if (soft.has(k)) v = Math.min(RANGE[k][1], Math.max(RANGE[k][0], 1 + (v - 1) * 1.05));
    p[P.indexOf(k)] = v;
  };
  set('W', f.w * (1 + j(0.03)));
  set('LONG', f.long * (1 + j(0.035)));
  set('JAW', f.jaw * (1 + j(0.05)));
  set('CHIN', f.chin * (1 + j(0.06)));
  set('CHEEK', f.cheek * (1 + j(0.05)));
  set('NOSE', f.nose * (1 + j(0.05)));
  set('BRIDGE', f.bridge * (1 + j(0.06)));
  set('TIP', f.tip * (1 + j(0.06)));
  set('HOOK', sk.hook + j(0.25) + (race === 'dwarf' ? 0.3 : race === 'elf' ? -0.15 : race === 'gnome' ? -0.4 : 0));
  set('EYE', f.eye * (1 + j(0.04)));
  set('SP', f.sp * (1 + j(0.035)));
  set('BROW', f.brow);
  set('LIPS', f.lips * (1 + j(0.06)));
  set('MOUTH', f.mouth * (1 + j(0.05)));
  set('LID', f.lid);
  set('SLANT', f.slant);
  set('EARS', f.ears);
  set('BTILT', app.expr === 'scowl' ? 1 : app.expr === 'stern' ? 0.45 : app.expr === 'weary' ? -0.7 : app.expr === 'proud' ? -0.25 : app.expr === 'kind' ? -0.3 : 0);
  set('SMIRK', app.expr === 'smirk' ? 1 : 0);
  set('AGE', app.age ?? 0);
  set('FEM', app.fem ? 1 : 0);
  set('CRAN', sk.cran * (1 + j(0.03)) * (race === 'gnome' ? 1.06 : race === 'halfling' ? 1.04 : 1));
  set('SLOPE', sk.slope + j(0.15) - (app.fem ? 0.15 : 0));
  set('EDEPTH', sk.edepth + j(0.15) + (race === 'dwarf' ? 0.3 : race === 'elf' ? -0.2 : 0));
  set('HOLLOW', Math.max(0, sk.hollow + j(0.15) + (app.age ?? 0) * 0.3 + (race === 'elf' ? -0.15 : race === 'halfling' ? -0.6 : race === 'dwarf' ? -0.2 : 0)));
  set('JDEPTH', sk.jdepth + j(0.2) - (app.fem ? 0.2 : 0));
  set('PROT', sk.prot + j(0.15));
  set('ELF', race === 'elf' ? 1 : race === 'halfElf' ? 0.55 : race === 'gnome' ? 0.25 : 0);
  set('NWIDTH', sk.nwidth * (1 + j(0.06)) * (race === 'dwarf' ? 1.15 : race === 'elf' ? 0.88 : race === 'gnome' ? 1.1 : 1));
  set('SMILE', sk.smile + (app.expr === 'kind' ? 0.25 : app.expr === 'scowl' ? -0.2 : 0) + j(0.08));
  set('ASLEEP', o.asleep ? 1 : 0);
  set('HVOL', ({ swept: 1.25, long: 1.15, wavy: 1.35, bob: 1.1, short: app.fem ? 1.0 : 0.85, crop: 0.6, braid: 0.95, bun: 0.95, topknot: 0.85 })[app.hair] ?? 1);
  set('BLEN', race === 'dwarf' ? 1.3 : 1);
  set('HALF', race === 'halfling' ? 1 : 0);
  set('GNOME', race === 'gnome' ? 1 : 0);
  set('SCOWL', app.expr === 'scowl' ? 1 : 0);
  // Character lines (forehead, crow's feet, nasolabial and marionette folds), the eye opening and the
  // brow's hair density: what makes a weathered veteran, a sharp-eyed rogue and a soft maiden read apart.
  set('LINES', Math.max(0, (sk.lines ?? 0.2) + (app.age ?? 0) * 0.7 + j(0.08) - (race === 'elf' ? 0.25 : race === 'halfling' ? 0.1 : 0)));
  set('EOPEN', (sk.eopen ?? 1) * (1 + j(0.05)) * (race === 'halfling' ? 1.08 : race === 'elf' ? 1.04 : 1));
  set('BTHICK', (sk.bthick ?? 1) * (app.fem ? 0.85 : 1) * (race === 'dwarf' ? 1.3 : race === 'elf' ? 0.8 : 1));
  return p;
}

// ------------------------------------------------------------------ GLSL

const VS = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FS = /* glsl */`
#include <common>
#include <lights_pars_begin>
uniform float uP[${NP}];
${DEFINES}
uniform int uHair;
uniform int uBeard;
uniform int uHelm;
uniform int uHood;
uniform int uScar;
uniform vec3 uSkin;
uniform vec3 uHairC;
uniform vec3 uEyeC;
uniform vec3 uCloth;
uniform vec3 uAmb;
uniform float uDetail;
uniform float uPix;
uniform float uSteps;
uniform float uSeed;
uniform vec3 uGaze;
uniform float uDbg;
uniform float uGain;
uniform float uLite;
uniform mat4 uInvModel;
uniform mat4 uModel;
uniform mat4 uProj;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
#endif
varying vec3 vWorld;

// ---------------------------------------------------------------- helpers
float h13(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.15; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdCap(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(r1, r2, h);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sat(float x) { return clamp(x, 0.0, 1.0); }

// The skull and face are the portrait painter's sculpt (portraitHeadGLSL), so a miniature's face
// is the face in its portrait: the same relief, brow, sockets, nose, lips and chin.
const float EYEY = 0.0;
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
${GLSL_HEAD}

// ---------------------------------------------------------------- hair, brows and beards (offsets of the skin)
// Hairline distance: > 0 on the scalp, < 0 on the face (forehead line receding at the temples, sideburns).
float hairline(vec3 p) {
  float ax = abs(p.x);
  float tuft = 0.0018 * sin(p.x * 140.0 + 1.3) + 0.001 * sin(p.x * 320.0 + p.y * 60.0);
  float front = (0.016 + tuft - 2.4 * p.x * p.x + 0.004 * (FEM - 0.5) - 0.012 * AGE * (1.0 - FEM)) - (-0.6 * p.y + 0.8 * p.z);
  float burn = max(0.0, 1.0 - abs(ax - 0.07) / 0.011) * max(0.0, 1.0 - abs(p.z - 0.022) / 0.016) * 0.05;
  float side = (-0.012 + burn + tuft * 0.6 - (-p.y + 0.62 * p.z)) / 1.177;
  // Nape: hair stops above the neck.
  float nape = p.y + 0.06 + 0.02 * ax / 0.07;
  return min(min(front, side), nape);
}
float strands(vec3 p, float freq, float amp) {
  // Grooved clumps along the comb direction (front to back on top, down the sides).
  float th = atan(p.x, p.z + 0.02);
  float w = th * freq + sin(th * 2.3 + p.y * 14.0) * 1.7 + p.y * 7.0 + sin(p.x * 150.0 + p.y * 90.0) * sin(p.z * 130.0 - p.y * 70.0) * 1.6;
  float ridge = abs(sin(w));
  float lobe = sin(th * freq * 0.31 + p.y * 17.0 + 1.3) * 0.5 + sin(th * 4.7 - p.y * 9.0) * 0.35;
  return amp * (0.35 - ridge * 0.55 + lobe * 0.6);
}
float gHairD;
float gBeardD;
float hairField(vec3 p, float sk) {
  float d = 1e3;
  if (uHood == 1 || (uHelm == 1 && uHair != 4 && uHair != 7)) return d;
  float vol = HVOL;
  if (uHair == 0) {
    // Bald crown: a fringe round the back and sides.
    float band = sat((0.035 - p.y) / 0.02) * sat((p.y + 0.03) / 0.01) * sat((0.03 - p.z) / 0.03);
    return sk - 0.006 * band + strands(p, 22.0, 0.0012) * band + 0.002 * (1.0 - band);
  }
  float hl = hairline(p);
  float t = sat(hl / 0.026);
  float top = sat(p.y / 0.1);
  float th = t * t * (3.0 - 2.0 * t);
  float T = 0.011 * vol * (0.7 + 0.5 * top);
  if (uHair == 3) T *= 0.8 + 0.9 * top * sat((p.z + 0.06) / 0.1);
  if (uHair == 2) T = 0.0055;
  d = sk - T * th + 0.0022 * max(0.0, 1.0 - th * 5.0);
  if (th > 0.0 && abs(d) < 0.006) d += strands(p, uHair == 2 ? 30.0 : 16.0, 0.0016) * th;
  // Swept: a forelock lifted off the brow.
  if (uHair == 3) d = smin(d, sdEll(p - vec3(-0.02, 0.085, 0.05), vec3(0.055, 0.025, 0.04)) + strands(p, 14.0, 0.0018), 0.02);
  // Long / wavy: a mantle down the back parted over the shoulders, locks framing the face.
  if (uHair == 4 || uHair == 5) {
    float len = FEM > 0.5 ? 0.27 : 0.2;
    float wav = uHair == 5 ? 1.0 : 0.0;
    float tt = sat((0.02 - p.y) / len);
    float w = (0.084 + tt * 0.034) * W + wav * 0.003 * sin(p.y * 45.0);
    float cz = -0.038 - tt * 0.05;
    float e = (length(vec2(p.x / w, (p.z - cz) / (0.07 + tt * 0.012))) - 1.0) * 0.07;
    e = max(e, p.y - 0.045);
    e = max(e, -(p.y + 0.02 + len));
    e = max(e, p.z - 0.036 + max(0.0, -p.y - 0.02) * 0.45);
    float a = atan(p.x, p.z + 0.03);
    e += 0.0012 * (0.5 - abs(sin(a * 17.0 + sin(p.y * (30.0 + wav * 20.0)) * (0.8 + wav * 0.6) + sin(a * 3.7) * 1.2))) + 0.0016 * sin(a * 5.0 + p.y * 13.0);
    d = smin(d, e, 0.018);
    vec3 q = vec3(abs(p.x), p.y, p.z);
    float lock = sdCone(q, vec3(0.074 * W, 0.04, 0.014), vec3((0.088 + wav * 0.012) * W, -0.11, -0.025), 0.015, 0.009) + strands(p, 12.0, 0.0014);
    d = smin(d, lock, 0.016);
  }
  if (uHair == 6) {
    float e = (length(vec3(p.x / (0.09 * W), (p.y - 0.02) / 0.117, (p.z + 0.012) / 0.112)) - 1.0) * 0.08;
    e = max(e, -(p.y + 0.074));
    e = max(e, -0.6 * p.y + 0.8 * p.z - 0.047);
    float a = atan(p.x, p.z);
    e += 0.0022 * (0.55 - abs(sin(a * 22.0 + p.y * 10.0)));
    d = smin(d, e, 0.01);
  }
  if (uHair == 7) {
    // A thick plait forward over the left shoulder.
    vec3 bp = p - vec3(0.085 * W, -0.06, 0.02);
    float s = clamp(-bp.y / 0.28, 0.0, 1.0);
    vec3 c = vec3(0.012 * s, 0.0, 0.05 * min(1.0, s * 1.6));
    float ph = bp.y * 70.0;
    vec3 off = vec3(sin(ph) * 0.005, 0.0, cos(ph) * 0.003);
    float br = length((bp - c - off).xz) - (0.019 - s * 0.006);
    br = max(br, bp.y - 0.06);
    br = max(br, -(bp.y + 0.28));
    d = smin(d, br + 0.0015 * abs(sin(ph * 0.5)), 0.012);
    d = smin(d, sdEll(p - vec3(0.0, -0.03, -0.08), vec3(0.06, 0.06, 0.045)) + strands(p, 20.0, 0.002), 0.02);
  }
  if (uHair == 8) {
    d = smin(d, sdEll(p - vec3(0.0, 0.128, -0.07), vec3(0.04, 0.034, 0.038)) + strands(p * 1.3, 14.0, 0.002), 0.015);
    d = smin(d, sdEll(p - vec3(0.0, 0.0, -0.075), vec3(0.076, 0.06, 0.05)) + strands(p, 20.0, 0.0018), 0.02);
  }
  if (uHair == 9) {
    d = smin(d, sdEll(p - vec3(0.0, 0.13, -0.035), vec3(0.024, 0.026, 0.024)), 0.012);
    d = smin(d, sdCone(p, vec3(0.0, 0.135, -0.05), vec3(0.0, 0.06, -0.135), 0.016, 0.006) + strands(p, 14.0, 0.0015), 0.01);
  }
  if (uHair == 1 && FEM > 0.5) d = smin(d, sdEll(p - vec3(0.0, 0.0, -0.05), vec3(0.082, 0.07, 0.07)) + strands(p, 18.0, 0.002), 0.02);
  // Under a helm only the hair below its rim shows (no strands poking through the bowl).
  if (uHelm == 1) d = max(d, p.y - (0.02 + 0.13 * p.z));
  return d;
}
// Brow coverage 0..1: thick at the head, tapering to the tail, arched (higher and finer on women).
float browBand(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float ex = EX();
  float u = (q.x - ex * 0.95) / 0.022;
  float arch = 0.0185 + (0.0035 + 0.0025 * FEM) * (1.0 - u * u) - 0.0022 * BTILT * (-u) - 0.002 * SCOWL + 0.0012 * FEM;
  float thick = 0.0052 * BTHICK * (1.0 - 0.55 * sat(u)) * (0.75 + 0.25 * BROW) * (1.0 - 0.15 * FEM);
  float band = smoothstep(0.0, 0.9, 1.0 - abs(q.y - arch - 0.0018 * (1.0 - u)) / thick);
  return band * sat((1.2 - abs(u)) * 3.0) * sat((q.z - 0.06) / 0.01) * sat((q.x - 0.0075) / 0.005);
}
float browField(vec3 p, float sk) {
  float band = browBand(p);
  return sk - 0.0009 * band * (1.0 + 0.3 * BROW) + (1.0 - band) * 0.002;
}
float beardField(vec3 p, float sk) {
  if (uBeard < 2) return 1e3;
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float mY = MOUTHY();
  float tipY = TIPY();
  // Moustache: over the upper lip, drooping at the corners.
  // Two lobes from under the nose, sweeping out and drooping past the mouth corners, tapering to points.
  float u = q.x / 0.034;
  float cy = tipY - 0.0125 - 0.013 * u * u;
  float th = 0.0058 * (1.0 - 0.75 * u * u) + 0.0012;
  float mo = sat((th - abs(p.y - cy)) / 0.0018) * sat((1.0 - u) / 0.12) * sat((p.z - 0.07) / 0.01);
  mo *= 0.75 + 0.25 * sat(1.0 - abs(q.x - 0.003) / 0.003 + 0.6);
  float m = mo;
  float T = 0.0055;
  if (uBeard >= 3) {
    float chin = sat((mY - 0.008 - p.y) / 0.004);
    float lipHole = sat((length(vec2(q.x / 0.024, (p.y - mY) / 0.011)) - 1.0) / 0.25);
    float region;
    if (uBeard == 3) region = chin * sat((0.026 - q.x) / 0.008) * sat((p.z - 0.04) / 0.02);
    else {
      float bTop = -0.004 - 0.52 * max(p.z, 0.0);
      region = sat((bTop - p.y) / 0.006) * sat((p.y + 0.165) / 0.01) * lipHole;
      region *= sat((p.z + 0.03) / 0.02);
    }
    m = max(m, region);
    T = uBeard == 3 ? 0.007 : 0.0085 * BLEN;
  }
  float d = sk - T * m + 0.002 * (1.0 - m);
  if (m > 0.0 && abs(d) < 0.006) d += strands(p * vec3(1.0, 1.6, 1.0), 26.0, 0.0018) * m;
  if (uBeard == 3) d = smin(d, sdCone(p, vec3(0.0, -0.112, 0.07), vec3(0.0, -0.152, 0.075), 0.017, 0.007) + strands(p, 14.0, 0.0012), 0.012);
  if (uBeard >= 5) {
    // A broad mass falling onto the chest, forked for dwarves.
    float dw = uBeard == 6 ? 1.0 : 0.0;
    float e = sdEll(p - vec3(0.0, -0.15, 0.058), vec3(0.046 + 0.012 * dw, 0.068 + 0.006 * dw, 0.03 + 0.006 * dw));
    e = smin(e, dw > 0.5 ? sdCone(q, vec3(0.022, -0.17, 0.066), vec3(0.028, -0.27, 0.074), 0.03, 0.012) : sdCone(p, vec3(0.0, -0.18, 0.06), vec3(0.0, -0.26, 0.07), 0.03, 0.01), 0.03);
    e += strands(p * vec3(1.0, 0.7, 1.0), 12.0, 0.002);
    d = smin(d, e, 0.02);
  }
  return d;
}

// ---------------------------------------------------------------- hood / helm
float hoodField(vec3 p) {
  if (uHood == 0) return 1e3;
  float a = atan(p.x, -p.z);
  float fold = 0.0042 * sin(a * 7.0 + p.y * 20.0) + 0.0016 * sin(a * 15.0 - p.y * 31.0);
  float sh = abs(sdEll(p - vec3(0.0, 0.026, -0.012), vec3(0.1, 0.128, 0.122))) - 0.0065 + fold;
  // Face opening and the open underside.
  sh = smax(sh, -sdEll(p - vec3(0.0, -0.022, 0.11), vec3(0.077 * W, 0.112, 0.1)), 0.012);
  sh = smax(sh, -sdEll(p - vec3(0.0, -0.17, -0.02), vec3(0.2, 0.08, 0.2)), 0.02);
  // Cowl draped down onto the shoulders.
  float cowl = sdCone(p, vec3(0.0, -0.08, -0.02), vec3(0.0, -0.22, -0.03), 0.095, 0.14);
  cowl = abs(cowl) - 0.006 + fold * 1.5;
  cowl = max(cowl, p.y + 0.06);
  cowl = max(cowl, -(p.y + 0.23));
  return min(sh, cowl);
}
float gHelmPart;
float helmField(vec3 p) {
  if (uHelm == 0) return 1e3;
  float cap = sdEll(p - vec3(0.0, 0.034, -0.013), vec3(0.088 * W, 0.108, 0.111));
  // The rim sits above the brow at the front (the eyes stay visible under it) and dips at the nape.
  float rim = 0.024 + 0.13 * p.z - p.y;
  float bowl = max(cap, rim);
  // Brow band, nasal, ridge.
  float band = sdEll(p - vec3(0.0, 0.018, -0.013), vec3(0.092 * W, 0.112, 0.115));
  band = max(band, rim);
  band = max(band, -(rim + 0.016));
  vec3 nq = p - vec3(0.0, 0.0, 0.108);
  float nasal = max(max(abs(nq.x) - 0.0065, abs(nq.y + 0.004) - 0.026), abs(nq.z - 0.004 + 0.3 * nq.y) - 0.004);
  float ridge = sdCap(p, vec3(0.0, 0.14, 0.04), vec3(0.0, 0.11, -0.1), 0.006);
  gHelmPart = band < bowl - 0.0005 ? 1.0 : 0.0;
  float d = min(min(bowl, band), min(nasal, ridge));
  // Mail aventail.
  float av = (length(vec2(p.x / (0.094 * W), (p.z + 0.015) / 0.112)) - 1.0) * 0.09;
  av = max(av, p.y - 0.0);
  av = max(av, -(p.y + 0.12));
  av = max(av, -0.6 * p.y + 0.8 * p.z - 0.035);
  if (av < d) gHelmPart = 2.0;
  return min(d, av);
}

// ---------------------------------------------------------------- the whole head
// Materials: 1 skin, 2 eye, 3 hair, 4 hood cloth, 5 steel, 6 dark steel, 7 mail
uniform vec4 uBound;
vec2 map(vec3 p) {
  float bnd = sdEll(p - uBound.xyz, vec3(0.125, uBound.w, 0.15));
  if (bnd > 0.02) return vec2(bnd, 0.0);
  float sk = skin(p);
  float d = sk;
  float m = gEye <= sk + 1e-5 ? 2.0 : 1.0;
  float br = browField(p, sk);
  if (br < d) { d = br; m = 3.0; }
  float hr = hairField(p, sk);
  if (hr < d) { d = hr; m = 3.0; }
  float bd = beardField(p, sk);
  if (bd < d) { d = bd; m = 3.25; }
  float ho = hoodField(p);
  if (ho < d) { d = ho; m = 4.0; }
  float he = helmField(p);
  if (he < d) { d = he; m = gHelmPart > 1.5 ? 7.0 : gHelmPart > 0.5 ? 6.0 : 5.0; }
  return vec2(d, m);
}
float mapD(vec3 p) { return map(p).x; }

// One call site in a loop the compiler cannot unroll (ZERO) keeps the program small: SwiftShader compiles it in a fraction of the time.
#define ZERO (min(int(uSteps), 0))
vec3 calcNormal(vec3 p, float e) {
  vec3 n = vec3(0.0);
  for (int i = ZERO; i < 4; i++) {
    vec3 k = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += k * mapD(p + k * e);
  }
  return normalize(n);
}

float softShadow(vec3 ro, vec3 rd, float jit) {
  float res = 1.0;
  float t = 0.008 + jit * 0.004;
  for (int i = ZERO; i < 16; i++) {
    float h = mapD(ro + rd * t);
    res = min(res, 1.4 * max(h, 0.0) / t);
    t += clamp(h * 0.8, 0.0025, 0.02);
    if (res < 0.01 || t > 0.2) break;
  }
  res = sat(res);
  return res * res * (3.0 - 2.0 * res);
}
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = ZERO; i < 3; i++) {
    float h = 0.0025 + 0.01 * float(i);
    occ += (h - mapD(p + n * h)) * sca;
    sca *= 0.75;
  }
  return sat(1.0 - occ * 34.0);
}

bool boxHit(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (uBoxMin - ro) * inv;
  vec3 b = (uBoxMax - ro) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  t0 = max(max(lo.x, lo.y), lo.z);
  t1 = min(min(hi.x, hi.y), hi.z);
  return t1 > max(t0, 0.0);
}

// Painted complexion: warm brow, ruddy cheeks/nose/ears, cool jaw (beard shadow), dark sockets.
vec3 skinAlbedo(vec3 p, vec3 n) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 base = uSkin;
  float ex = EX();
  float lum = dot(base, vec3(0.3, 0.59, 0.11));
  // Zones are tinted relative to the base tone so dark complexions keep their hue.
  // The painter's three zones: golden forehead, red cheeks/nose/ears, blue-grey jaw.
  vec3 ruddy = base * vec3(1.2, 0.8, 0.76);
  vec3 warm = base * vec3(1.1, 1.05, 0.8);
  vec3 cool = base * vec3(0.82, 0.9, 1.04);
  float cheek = exp(-pow(length((q.xy - vec2(0.045, -0.026)) / vec2(0.024, 0.018)), 2.0));
  float noseZ = exp(-pow(length((p.xy - vec2(0.0, TIPY())) / vec2(0.012, 0.012)), 2.0)) * sat((p.z - 0.09) / 0.01);
  float earZ = sat((q.x - 0.066 * W) / 0.008) * sat((0.03 - abs(p.y)) / 0.02);
  float brow = sat((p.y - 0.035) / 0.03) * sat(p.z / 0.06);
  float jaw = sat((-0.055 - p.y) / 0.03) * sat((p.z + 0.01) / 0.04) * (1.0 - FEM);
  vec3 c = base;
  c = mix(c, warm, brow * 0.85);
  c = mix(c, ruddy, sat(cheek * (0.72 + 0.2 * FEM) + noseZ * 0.65 + earZ * 0.75));
  float muzzle = exp(-pow(length((p.xy - vec2(0.0, MOUTHY())) / vec2(0.03, 0.02)), 2.0)) * sat((p.z - 0.06) / 0.02) * (1.0 - FEM);
  c = mix(c, cool, sat(jaw * (uBeard == 1 ? 0.8 : 0.55) + muzzle * 0.35 + sat((-0.075 - p.y) / 0.03) * 0.25));
  if (uBeard == 1) c *= 1.0 - jaw * 0.18 * (0.6 + 0.4 * vnoise(p * 900.0));
  // Sockets: a violet-brown glaze; lids slightly pinker.
  float sock = exp(-pow(length((q.xy - vec2(ex, EYEY + 0.004)) / vec2(0.02, 0.013)), 2.0)) * sat((p.z - 0.05) / 0.02);
  c = mix(c, base * vec3(0.66, 0.54, 0.6), sock * 0.5);
  // Shadowed upper-lid crease under the brow (reads as a real socket at thumbnail size).
  float crease = exp(-pow(length((q.xy - vec2(ex, EYEY + 0.0125)) / vec2(0.016, 0.0045)), 2.0)) * sat((p.z - 0.06) / 0.02);
  c = mix(c, base * vec3(0.55, 0.44, 0.46), crease * 0.45);
  // Lips.
  float mY = MOUTHY();
  float lip = exp(-pow(length((p.xy - vec2(0.0, mY)) / vec2(0.019 * MOUTH, 0.0085 * LIPS)), 4.0)) * sat((p.z - 0.072) / 0.006);
  vec3 lipC = mix(base * vec3(1.05, 0.66, 0.66), base * vec3(1.02, 0.5, 0.56), FEM * 0.8);
  c = mix(c, lipC, lip * (0.8 + 0.15 * FEM));
  float slit = exp(-pow((p.y - mY) / 0.0011, 2.0)) * sat(1.0 - abs(p.x) / (0.021 * MOUTH)) * sat((p.z - 0.07) / 0.008);
  c *= 1.0 - slit * 0.75;
  // Mottling, freckles of variation, age spots.
  float mot = fbm(p * 140.0 + uSeed);
  c *= 0.955 + 0.09 * mot;
  c *= 0.985 + 0.03 * vnoise(p * 1400.0 + uSeed);
  c *= 1.0 - AGE * 0.12 * smoothstep(0.6, 0.8, vnoise(p * 300.0 + 3.0));
  // Hair roots darken the skin just below a hairline (a soft edge, not a cap).
  if (uHood == 0 && uHelm == 0 && uHair != 0) {
    float hl = hairline(p);
    float roots = sat(1.0 - (-hl) / 0.007) * sat(p.y / 0.02 + 0.5);
    c = mix(c, uHairC * 0.9, roots * 0.55 * (0.6 + 0.4 * vnoise(p * 700.0)));
  }
  // Character lines, painted as soft shadowed creases (darker, a touch cooler and redder).
  {
    float L = LINES;
    vec3 creaseC = base * vec3(0.62, 0.5, 0.5);
    float tipY = TIPY();
    // Nasolabial fold: from the nose wing round the muzzle to past the mouth corner.
    float nl = sdCap(vec3(q.xy, 0.0), vec3(0.0175 * NWIDTH, tipY - 0.002, 0.0), vec3(0.0265 * MOUTH, mY - 0.009, 0.0), 0.0);
    float nlz = sat((p.z - 0.055) / 0.015);
    c = mix(c, creaseC, exp(-pow(nl / (0.0016 + 0.001 * L), 2.0)) * nlz * (0.22 + 0.45 * L));
    // Marionette lines down from the mouth corners.
    float ml = sdCap(vec3(q.xy, 0.0), vec3(0.024 * MOUTH, mY - 0.004, 0.0), vec3(0.021 * MOUTH, mY - 0.024, 0.0), 0.0);
    c = mix(c, creaseC, exp(-pow(ml / 0.0014, 2.0)) * nlz * sat(L - 0.35) * 0.6);
    // Forehead: three horizontal furrows, wavering.
    float fy = (p.y - 0.036 + 0.0015 * sin(p.x * 70.0 + uSeed)) / 0.0095;
    float fl = exp(-pow((fract(fy) - 0.5) / 0.11, 2.0)) * step(0.0, fy) * step(fy, 3.0);
    c = mix(c, creaseC, fl * sat(1.0 - abs(p.x) / 0.04) * sat((p.z - 0.05) / 0.02) * sat(L - 0.15) * 0.45 * (1.0 - 0.6 * FEM));
    // Crow's feet fanning from the outer canthus.
    vec2 oc = q.xy - vec2(ex + 0.0125, EYEY);
    float ca = atan(oc.y, oc.x);
    float cr = length(oc);
    float fan = pow(abs(sin(ca * 7.0)), 10.0) * sat(1.0 - abs(ca) / 0.9) * smoothstep(0.002, 0.004, cr) * sat((0.014 - cr) / 0.006);
    c = mix(c, creaseC, fan * sat(L - 0.25) * 0.5);
    // Lower-lid crease / tear trough: everyone has a little, the weathered more.
    vec2 ub = q.xy - vec2(ex - 0.001, EYEY - 0.0098);
    float tear = exp(-pow(ub.y / 0.0013, 2.0)) * sat(1.0 - abs(ub.x) / 0.012) * sat((p.z - 0.065) / 0.01);
    c = mix(c, creaseC, tear * (0.18 + 0.35 * L));
  }
  // Scar across the cheek.
  if (uScar == 1) {
    float sd = sdCap(p, vec3(-0.012, 0.03, 0.09), vec3(-0.05, -0.035, 0.07), 0.0016);
    c = mix(c, base * vec3(1.15, 0.78, 0.8), sat(1.0 - abs(sd) / 0.0018) * 0.8);
  }
  return c;
}

vec3 eyeAlbedo(vec3 p, vec3 ec, out float spec) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 d = normalize(q - ec);
  float r = length(d.xy);
  float er = ER();
  vec3 sclera = vec3(0.8, 0.76, 0.71);
  sclera = mix(sclera, vec3(0.62, 0.44, 0.42), sat((r - 0.62) * 2.2) * 0.5);
  float iris = 1.0 - smoothstep(0.53, 0.58, r);
  float pupil = 1.0 - smoothstep(0.19, 0.22, r);
  float a = atan(d.y, d.x);
  vec3 ic = uEyeC * (0.75 + 0.6 * vnoise(vec3(a * 9.0, r * 30.0, 1.0)));
  ic = mix(ic * 1.15, ic * 0.3, smoothstep(0.33, 0.5, r));
  // Limbal ring and a lighter collarette so the iris colour reads at thumbnail size.
  ic = mix(ic, ic * 1.5 + 0.03, smoothstep(0.3, 0.22, r) * 0.5);
  vec3 c = mix(sclera, ic, iris);
  c = mix(c, vec3(0.06, 0.04, 0.035), smoothstep(0.47, 0.56, r) * iris * 0.8);
  c = mix(c, vec3(0.01), pupil);
  // The upper lid shades the top of the eyeball.
  c *= mix(1.0, 0.5, smoothstep(0.15, 0.8, d.y));
  // A painted catch-light up and toward the key (reads at every size, whatever the light rig).
  float cl = 1.0 - smoothstep(0.07, 0.11, length(d.xy - vec2(-0.2, 0.22)));
  c = mix(c, vec3(1.0, 0.97, 0.92) * 1.6, cl * iris * 0.9);
  spec = iris;
  return c;
}

void main() {
  vec3 roW = cameraPosition;
  vec3 rdW = normalize(vWorld - cameraPosition);
  vec3 ro = (uInvModel * vec4(roW, 1.0)).xyz;
  vec3 rd = normalize((uInvModel * vec4(rdW, 0.0)).xyz);
  float t0, t1;
  if (!boxHit(ro, rd, t0, t1)) discard;
  float t = max(t0, 0.0);
  float hit = -1.0;
  float px = uDetail;
  vec2 res;
  int steps = int(uSteps);
  for (int i = ZERO; i < 160; i++) {
    if (i >= steps) break;
    vec3 pos = ro + rd * t;
    res = map(pos);
    float eps = max(px, t * uPix * 0.45);
    if (res.x < eps) { hit = t; break; }
    t += res.x * 0.9;
    if (t > t1) break;
  }
  if (hit < 0.0) discard;
  vec3 pos = ro + rd * hit;
  float mat = res.y;
  float fp = max(px, hit * uPix);
  vec3 n = calcNormal(pos, max(0.00025, fp * 0.6));
  // World/view space for the lights.
  vec4 pw = uModel * vec4(pos, 1.0);
  vec3 pv = (viewMatrix * pw).xyz;
  mat3 toView = mat3(viewMatrix) * mat3(uModel);
  vec3 nv = normalize(toView * n);
  vec3 vv = normalize(-pv);
  mat3 toLocal = mat3(uInvModel) * mat3(inverse(viewMatrix));
  float ao = uLite > 0.5 ? 1.0 : calcAO(pos, n);

  // ---- material
  vec3 alb;
  float rough = 0.5;
  float metal = 0.0;
  float sss = 0.0;
  float specK = 0.028;
  float aniso = 0.0;
  float clearc = 0.0;
  vec3 q = vec3(abs(pos.x), pos.y, pos.z);
  vec3 ec = vec3(EX(), EYEY, EZ());
  if (mat < 1.5) {
    alb = skinAlbedo(pos, n);
    // Oily T-zone, matte cheeks; lash line darkens the lid edge.
    float tz = sat(1.0 - abs(pos.x) / 0.02) * sat((pos.z - 0.07) / 0.02);
    // Skin is not clay: an oily sheen on brow, nose and cheekbones breaks the matte.
    // Highlights belong on the nose tip, the forehead and the lower lip, not as wax across the cheeks.
    float noseTip = exp(-pow(length((pos.xy - vec2(0.0, TIPY())) / vec2(0.01, 0.012)), 2.0));
    float sheen = sat(tz * 0.6 + noseTip * 0.8 + sat((pos.y - 0.045) / 0.03) * sat(1.0 - abs(pos.x) / 0.04) * 0.5);
    rough = mix(0.72, 0.42, sheen) + 0.05 * vnoise(pos * 900.0);
    specK = 0.026;
    sss = 1.0;
    float lash = sat(1.0 - gLid / (0.0011 + 0.0007 * FEM)) * sat((pos.z - 0.06) / 0.01) * sat(1.0 - length(q.xy - ec.xy) / 0.02) * (1.0 - ASLEEP * 0.5);
    alb = mix(alb, vec3(0.03, 0.02, 0.018), lash * 0.9);
  } else if (mat < 2.5) {
    alb = eyeAlbedo(pos, ec, clearc);
    rough = 0.08;
    specK = 0.06;
    clearc = 1.0;
  } else if (mat < 3.5 && pos.z > 0.055 && browBand(pos) > 0.0 && abs(pos.y - 0.024) < 0.016) {
    // Brows: hairs over skin, broken at the edges (never a painted-on stripe).
    float bb = browBand(pos);
    float hairs = vnoise(vec3(pos.x * 2600.0 + pos.y * 900.0, pos.y * 500.0, 1.0));
    // Brow hairs are combed outward and up: streaks along the arch, thinning at the edges into the skin.
    float comb = vnoise(vec3(pos.x * 1800.0 - pos.y * 2600.0, pos.y * 260.0 + pos.x * 300.0, 2.0));
    vec3 browC = mix(uHairC * 0.8, skinAlbedo(pos, n) * 0.55, 0.28);
    alb = mix(skinAlbedo(pos, n), browC, sat(bb * 1.15 - 0.2 + (hairs - 0.5) * 0.5 + (comb - 0.5) * 0.5) * 0.92);
    rough = 0.55;
    sss = 0.6;
  } else if (mat < 3.5) {
    alb = uHairC;
    float ang = atan(pos.x, pos.z + 0.02);
    float sv = vnoise(vec3(ang * 40.0, pos.y * 25.0, 0.0)) * 0.5 + vnoise(vec3(ang * 140.0, pos.y * 40.0, 3.0)) * 0.3 + vnoise(vec3(ang * 420.0, pos.y * 90.0, 7.0)) * 0.2;
    alb *= 0.45 + 0.95 * sv;
    // Roots darker, sun-bleached ends.
    alb *= 0.9 + 0.2 * fbm(pos * 90.0);
    rough = 0.45;
    aniso = 1.0;
    specK = 0.05;
    // A soft hairline: thin hair over skin at the edge, never a rolled rubber rim.
    if (uHair != 0 && uHood == 0 && uHelm == 0 && mat < 3.1) {
      float edge = sat(hairline(pos) / 0.014);
      edge = edge * edge * (3.0 - 2.0 * edge);
      // Only where the hair lies thin on the scalp (long locks and forelocks stand off the skin).
      edge = max(edge, sat(skin(pos) / 0.0035));
      float wisp = vnoise(vec3(atan(pos.x, pos.z + 0.02) * 90.0, pos.y * 60.0, 2.0));
      edge = sat(edge * 1.2 + (wisp - 0.5) * 0.5 * (1.0 - edge));
      alb = mix(mix(skinAlbedo(pos, n), uHairC, 0.45), alb, edge);
      aniso = edge;
      sss = (1.0 - edge) * 0.6;
    }
  } else if (mat < 4.5) {
    alb = uCloth * (0.85 + 0.3 * vnoise(pos * 400.0));
    // The lining round the face opening falls into shadow; the folds catch light along their ridges.
    float rim = length((pos.xy - vec2(0.0, -0.02)) / vec2(0.078 * W, 0.11));
    alb *= mix(0.55, 1.0, smoothstep(0.85, 1.1, rim));
    float fa = atan(pos.x, -pos.z);
    alb *= 0.85 + 0.3 * smoothstep(-0.4, 0.9, sin(fa * 7.0 + pos.y * 20.0));
    rough = 0.95;
  } else if (mat < 6.5) {
    alb = mat < 5.5 ? vec3(0.62, 0.64, 0.68) : vec3(0.36, 0.37, 0.4);
    alb *= 0.85 + 0.25 * fbm(pos * 160.0);
    metal = 1.0;
    rough = 0.42 + 0.2 * vnoise(pos * 300.0);
  } else {
    // Mail rings.
    vec2 g = vec2(atan(pos.x, pos.z) * 60.0, pos.y * 260.0);
    g.x += mod(floor(g.y), 2.0) * 0.5;
    vec2 f = fract(g) - 0.5;
    float ring = smoothstep(0.18, 0.28, length(f)) * (1.0 - smoothstep(0.38, 0.48, length(f)));
    alb = vec3(0.42, 0.43, 0.46) * (0.35 + 0.9 * ring);
    metal = 1.0;
    rough = 0.45;
    n = normalize(n + vec3(f.x, f.y, 0.0) * ring * 0.4);
    nv = normalize(toView * n);
  }
  if (mat >= 2.5) nv = normalize(toView * n);
  else nv = normalize(toView * n);
  // The painter's form normal: skin's diffuse light reads from a broad normal (the big planes of
  // brow, cheek, jaw) with only part of the fine sculpt on top, so the face turns in a few clean
  // value steps instead of catching every lump.
  vec3 nvd = nv;
  if (mat < 1.5 && uLite < 0.5) {
    vec3 nBig = calcNormal(pos, 0.0095);
    // Full sculpt detail down the centre (nose, lips, chin) and round the eyes; broad planes elsewhere.
    float centre = exp(-pow(pos.x / 0.017, 2.0)) * sat((pos.y + 0.11) / 0.02);
    float eyesW = exp(-pow(length((q.xy - vec2(EX(), EYEY + 0.006)) / vec2(0.022, 0.016)), 2.0));
    float dw = 0.2 + 0.65 * sat(centre + eyesW);
    nvd = normalize(toView * normalize(mix(nBig, n, dw)));
  }
  if (uDbg > 3.5 && uDbg < 6.5) { gl_FragColor = vec4((uDbg > 4.5 ? n : (uDbg > 5.5 ? alb : normalize(mix(calcNormal(pos, 0.0075), n, 0.42)))) * 0.5 + 0.5, 1.0); return; }

  // ---- lighting
  vec3 col = vec3(0.0);
  vec3 F0 = mix(vec3(specK), alb, metal);
  vec3 dif = alb * (1.0 - metal);
  float keyI = -1.0;
  vec3 keyL = vec3(0.0);
  vec3 lightL[8];
  vec3 lightC[8];
  int nl = 0;
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) { if (nl < 8) { lightL[nl] = directionalLights[i].direction; lightC[nl] = directionalLights[i].color; nl++; } }
#endif
#if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    if (nl < 8) {
      vec3 lv = pointLights[i].position - pv;
      float ld = length(lv);
      lightL[nl] = lv / ld;
      lightC[nl] = pointLights[i].color * getDistanceAttenuation(ld, pointLights[i].distance, pointLights[i].decay);
      nl++;
    }
  }
#endif
#if NUM_SPOT_LIGHTS > 0
  for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
    if (nl < 8) {
      vec3 lv = spotLights[i].position - pv;
      float ld = length(lv);
      vec3 L = lv / ld;
      float sa = getSpotAttenuation(spotLights[i].coneCos, spotLights[i].penumbraCos, dot(L, spotLights[i].direction));
      lightL[nl] = L;
      lightC[nl] = spotLights[i].color * sa * getDistanceAttenuation(ld, spotLights[i].distance, spotLights[i].decay);
      nl++;
    }
  }
#endif
  // The brightest light casts the ray-marched shadow.
  int key = 0;
  float best = -1.0;
  for (int i = ZERO; i < 8; i++) {
    if (i >= nl) break;
    // One shadow caster for the whole head (choosing per pixel switched lights mid-face: a seam).
    float b = dot(lightC[i], vec3(0.3, 0.59, 0.11));
    if (b > best) { best = b; key = i; }
  }
  for (int i = ZERO; i < 8; i++) {
    if (i >= nl) break;
    vec3 L = lightL[i];
    vec3 C = lightC[i];
    float ndl = dot(nvd, L);
    float ndlS = dot(nv, L);
    float sh = 1.0;
    // Cast shadows (nose, brow, hair) only where the surface faces the light; the terminator itself
    // is the wrapped diffuse falloff, so a back-facing cheek never flips between lit and shadowed patches.
    if (uDbg != 1.0 && uLite < 0.5 && i == key && ndl > 0.12) sh = mix(1.0, softShadow(pos + n * 0.0018, normalize(toLocal * L), h13(vec3(gl_FragCoord.xy, 1.7))), smoothstep(0.12, 0.45, ndl) * (sss > 0.0 ? 0.85 : 1.0));
    // Wrapped, red-shifted subsurface for skin.
    // Wrap and the red terminator belong to the key; fills and rims stay crisp (else they flood the shadow side).
    bool isKey = i == key;
    // Half-Lambert-style wrap on the key: the shadow settles into the cheek and socket and
    // never splits the face down the bridge of the nose.
    float wrap = (isKey ? 0.4 : 0.12) * sss;
    float d0 = sat((ndl + wrap) / (1.0 + wrap));
    if (sss > 0.0 && isKey) {
      d0 = d0 * d0 * (3.0 - 2.0 * d0) * 0.35 + d0 * 0.65;
      // Painted planes: the key's falloff is laid in as three values (light, half-tone, shadow) whose
      // borders are broken by brush strokes running diagonally across the forms, as an illustrator
      // blocks a face in, instead of an airbrushed gradient. Edges stay crisp where the sculpt turns.
      {
        vec3 sp = pos * 1000.0;
        float along = dot(sp, vec3(0.55, -0.83, 0.0));
        float across = dot(sp, vec3(0.83, 0.55, 0.0)) + sp.z * 0.4;
        float bn = vnoise(vec3(across * 0.22, along * 0.045, uSeed)) * 0.75 + vnoise(vec3(across * 0.7, along * 0.14, uSeed + 5.0)) * 0.25;
        float db = d0 + (bn - 0.5) * 0.14;
        float pl = 0.12 + smoothstep(0.14, 0.3, db) * 0.34 + smoothstep(0.42, 0.58, db) * 0.32 + smoothstep(0.72, 0.88, db) * 0.22;
        d0 = mix(d0, pl, 0.42);
      }
    }

    // Lights from behind (rims) only catch the grazing silhouette of skin: a fresnel band,
    // never broad patches across a bumpy cheek.
    if (sss > 0.0 && !isKey) {
      float behind = sat(-dot(L, vv) * 1.6 + 0.2);
      float ndv0 = sat(dot(nvd, vv));
      d0 *= mix(1.0, smoothstep(0.55, 0.05, ndv0), behind);
    }
    vec3 diff = vec3(d0);
    if (sss > 0.0) {
      float term = (smoothstep(-0.55, 0.05, ndl) - smoothstep(-0.1, 0.5, ndl)) * (isKey ? 0.8 : 0.1);
      diff = vec3(d0) + vec3(0.32, 0.07, 0.04) * term * sss;
      diff *= mix(vec3(1.0), vec3(1.0, 0.55, 0.45), (1.0 - sh) * 0.35 * sss);
      sh = mix(sh, 1.0, 0.4 * sss);
    }
    vec3 H = normalize(L + vv);
    float ndh = sat(dot(nv, H));
    float ndv = sat(dot(nv, vv));
    float a2 = rough * rough * rough * rough;
    float dd = ndh * ndh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - sat(dot(H, vv)), 5.0);
    float Vis = 0.25 / max(0.1, ndv * sat(ndlS) + 0.2);
    vec3 spec = D * F * Vis * sat(ndlS);
    if (aniso > 0.0) {
      // Kajiya-Kay: strands combed from the hairline back and down.
      vec3 T = normalize(toView * normalize(cross(n, vec3(1.0, 0.0, 0.0)) + vec3(0.0, -0.3, 0.0)));
      float th = dot(T, H);
      float s1 = pow(sqrt(max(0.0, 1.0 - th * th)), 80.0);
      float s2 = pow(sqrt(max(0.0, 1.0 - (th - 0.15) * (th - 0.15))), 20.0);
      spec = (vec3(0.16) * s1 + alb * 0.8 * s2) * sat(ndlS) * 0.55;
    }
    if (clearc > 0.5) spec += vec3(pow(ndh, 900.0) * 6.0);
    col += (dif * RECIPROCAL_PI * diff + spec) * C * sh;
    if (uDbg > 6.5 && i == key) { gl_FragColor = vec4(uDbg > 8.5 ? vec3(ao) : uDbg > 7.5 ? spec * 10.0 : diff * sh, 1.0); return; }
    if (uDbg > 1.5 && uDbg < 2.5 && i == key) { gl_FragColor = vec4(vec3(sh), 1.0); return; }
    if (uDbg > 2.5 && uDbg < 3.5 && i == key) { gl_FragColor = vec4(normalize(toLocal * L) * 0.5 + 0.5, 1.0); return; }
  }
  // Ambient: hemisphere + ambient lights + the caller's environment term.
  vec3 amb = uAmb + ambientLightColor;
#if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
    float hw = 0.5 * dot(nvd, hemisphereLights[i].direction) + 0.5;
    amb += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, hw);
  }
#endif
  // Skin's shadow side takes the cool fill (the warm is in the subsurface terminator).
  col += dif * amb * ao * (sss > 0.0 ? vec3(0.9, 0.97, 1.1) : vec3(1.0));
  if (metal > 0.5) col += alb * amb * 0.6 * ao * (0.6 + 0.4 * nv.y);
  // A miniature's paint never glows: keep its brightest highlight under the bloom threshold (copper
  // hair under a candle used to wear a halo of fire).
  col = min(col * uGain, vec3(0.86));
  gl_FragColor = vec4(col, 1.0);
#ifdef USE_FOG
  float fd = length(pv);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, fd));
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec4 clip = uProj * vec4(pv, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
`;

// ------------------------------------------------------------------ material / mesh

const BOX_MIN = new THREE.Vector3(-0.135, -0.235, -0.165);
const BOX_MAX = new THREE.Vector3(0.135, 0.19, 0.155);

let boxGeo = null;
function geometry() {
  if (boxGeo) return boxGeo;
  const size = BOX_MAX.clone().sub(BOX_MIN);
  const c = BOX_MAX.clone().add(BOX_MIN).multiplyScalar(0.5);
  boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
  boxGeo.translate(c.x, c.y, c.z);
  return boxGeo;
}

const shared = new Map();
/**
 * One material per (fog, consumer): three.js keeps one program per material, so a material shared
 * between scenes with different light rigs (the hall, the portrait studio, the snapshot alcove)
 * would relink the huge head program on every switch — seconds each under software GL.
 */
function sharedMaterial(fog, own, variant = 'scene') {
  const key = `${fog}|${variant}`;
  let m = shared.get(key);
  if (!m) {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
    for (const k in own) u[k] = { value: own[k].value };
    m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FS, lights: true, fog });
    shared.set(key, m);
  }
  return m;
}

/**
 * A ray-marched head for a resolved appearance, placed at a figure's face frame.
 * @param {ReturnType<import('./lookData.js').resolveAppearance>} app
 * @param {{c:number[], R:number[], hs:number}} frame  figureRig frames.face
 * @param {{detail?: number, steps?: number, ambient?: number[], asleep?: boolean, fog?: boolean}} [o]
 *   detail: surface tolerance in head metres (≈ one pixel's footprint).
 */
export function createHead(app, frame, o = {}) {
  const own = {
    uP: { value: headParams(app, { asleep: o.asleep }) },
    uHair: { value: HAIR[app.hair] ?? 1 },
    uBeard: { value: BEARD[app.beard] ?? 0 },
    uHelm: { value: app.helm ? 1 : 0 },
    uHood: { value: app.hood ? 1 : 0 },
    uScar: { value: app.scar ? 1 : 0 },
    uSkin: { value: desat(lin(app.skinHex), 0.3) },
    uHairC: { value: desat(lin(app.hairHex), 0.22).multiplyScalar(0.8) },
    uEyeC: { value: lin(app.eyeHex) },
    uCloth: { value: lin(app.clothHex) },
    uAmb: { value: new THREE.Vector3(...(o.ambient ?? [0.05, 0.05, 0.06])) },
    uDetail: { value: o.detail ?? 0.00025 },
    uPix: { value: 0.001 },
    uSteps: { value: o.steps ?? 96 },
    uDbg: { value: o.dbg ?? (globalThis.__HEADDBG ?? 0) },
    uGain: { value: o.gain ?? 1 },
    uLite: { value: o.lite ? 1 : 0 },
    uSeed: { value: (app.seed % 97) * 0.37 },
    uGaze: { value: new THREE.Vector3(0, -0.05, 1).normalize() },
    uInvModel: { value: new THREE.Matrix4() },
    uModel: { value: new THREE.Matrix4() },
    uProj: { value: new THREE.Matrix4() },
    uBound: { value: new THREE.Vector4(0, -0.025, -0.005, 0.215) },
    uBoxMin: { value: BOX_MIN.clone() },
    uBoxMax: { value: BOX_MAX.clone() },
  };
  const mat = sharedMaterial(!!o.fog, own, o.variant);
  const uniforms = own;
  const mesh = new THREE.Mesh(geometry(), mat);
  const { c, R, hs } = frame;
  mesh.position.set(c[0], c[1], c[2]);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1));
  mesh.scale.setScalar(hs);
  mesh.userData.sharedGeo = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const vsz = new THREE.Vector2();
  mesh.onBeforeRender = (r, sc, camera) => {
    // One shared program for every head (a new material would recompile it — seconds under
    // software GL): this head's values go into the shared uniforms just before it draws.
    for (const k in own) mat.uniforms[k].value = own[k].value;
    mat.uniformsNeedUpdate = true;
    const rt = r.getRenderTarget();
    const H = rt ? rt.height : r.getDrawingBufferSize(vsz).y;
    uniforms.uPix.value = camera.isPerspectiveCamera ? (2 * Math.tan((camera.fov * Math.PI) / 360)) / (camera.zoom * Math.max(1, H)) : 0.001;
    uniforms.uModel.value.copy(mesh.matrixWorld);
    uniforms.uInvModel.value.copy(mesh.matrixWorld).invert();
    uniforms.uProj.value.copy(camera.projectionMatrix);
    mat.uniforms.uPix.value = uniforms.uPix.value;
  };
  mesh.userData.dispose = () => {};
  mesh.userData.headMaterial = mat;
  return mesh;
}
