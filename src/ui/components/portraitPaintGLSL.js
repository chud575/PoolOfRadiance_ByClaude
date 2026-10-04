/**
 * GLSL for the portrait painter (portraitGL.js): hair, beards, helms, hoods and
 * the bust in its readied armour (GLSL_DRESS); the painter's lighting, the
 * complexion and the brushed backdrop (GLSL_SHADE); and the oil repaint
 * (GLSL_POST).
 */

export const HAIR_ID = { bald: 0, short: 1, crop: 2, swept: 3, long: 4, wavy: 5, bob: 6, braid: 7, bun: 8, topknot: 9, hood: 1 };
export const BEARD_ID = { none: 0, stubble: 1, moustache: 2, goatee: 3, full: 4, long: 5, dwarf: 6 };
export const BODY_ID = { plate: 0, chain: 1, scale: 2, leather: 3, robe: 4, tabard: 5, fur: 6, vestments: 7, tunic: 8 };

export const GLSL_DRESS = /* glsl */`
#define MDBG(b) (mod(floor(uDbg / float(b)), 2.0) > 0.5)
// ------------------------------------------------------------------ hair
// Hairline: > 0 on the scalp, < 0 on the face (receding temples on older men, sideburns).
float hairline(vec3 p) {
  float ax = abs(p.x);
  float tuft = 0.0016 * sin(p.x * 150.0 + 1.3) + 0.0009 * sin(p.x * 330.0 + p.y * 60.0) + 0.0035 * (vnoise(p * 260.0 + uSeed * 9.0) - 0.5);
  // women part the hair and sweep it off the brow to the sides: the hairline lifts at the parting
  // and curves down over the temples (never a straight fringe across the forehead)
  float part = FEM * (0.016 * exp(-pow((p.x - 0.006) / 0.024, 2.0)) - 0.004);
  float temple = 0.006 * (1.0 - FEM) * exp(-pow((ax - 0.034) / 0.012, 2.0));
  float front = (0.021 + tuft * (1.0 + FEM) - 3.6 * p.x * p.x - temple + 0.006 * FEM - part - 0.012 * AGE * (1.0 - FEM)) - (-0.62 * p.y + 0.78 * p.z - 0.05);
  float burn = max(0.0, 1.0 - abs(ax - 0.067) / 0.012) * max(0.0, 1.0 - abs(p.z - 0.018) / 0.018) * 0.045;
  float side = (-0.012 + burn + tuft * 0.6 - (-p.y + 0.62 * p.z)) / 1.18;
  float nape = p.y + 0.062 + 0.02 * ax / 0.07;
  return min(min(front, side), nape);
}
// Hair is modelled as locks, not a shell: the scalp hair is cut into clumps combed back from the
// hairline over the crown, each a rounded ridge of its own height with a cleft between it and the
// next, wandering a little as it goes; finer strands ride on top.
float gLockId;
float lockField(float u, float v, float amp) {
  float k = floor(u);
  float f = fract(u);
  float h = h12(vec2(k, 3.1));
  gLockId = h;
  // a lock is a soft rounded mass (not a rib); its neighbours sit at their own heights
  float prof = 1.0 - pow(abs(2.0 * f - 1.0), 2.6);
  float fine = vnoise2(vec2(u * 3.3, v * 2.0));
  return amp * ((0.5 - prof * (0.5 + 0.7 * h)) * 0.6 + (fine - 0.5) * 0.35);
}
float clumps(vec3 p, float freq, float amp) {
  vec3 c = p - vec3(0.0, 0.03, -0.01);
  float lat = atan(c.x, length(c.yz));
  float lon = atan(c.z, c.y);
  float u = lat * freq * 0.3 + 0.45 * sin(lon * 2.6 + lat * 3.0 + uSeed * 6.0) + 0.9 * vnoise2(vec2(lon * 2.0, lat * 3.5 + uSeed));
  return lockField(u, lon * 6.0, amp * 1.15);
}
// Hanging hair: locks running down the fall, swinging in waves for wavy hair.
float fallClumps(vec3 p, float freq, float amp, float wav) {
  float a = atan(p.x, p.z + 0.03) * freq;
  float y = p.y;
  float u = a + wav * sin(y * 38.0 + a * 0.7) * 0.9 + 0.8 * vnoise2(vec2(a * 0.6, y * 5.0)) + 0.25 * sin(y * 11.0 + a);
  return lockField(u, y * 30.0, amp * 1.1);
}
float gHairFlow;
// A three-strand plait hanging down local -y from bp = 0 over a length, tapering; ties at the end.
float plait(vec3 bp, float len, float r) {
  float s = sat(-bp.y / len);
  float rr = r * (1.0 - 0.35 * s);
  float t = bp.y * (0.9 / rr);
  float d = 1e3;
  for (int i = 0; i < 3; i++) {
    float ph = t + float(i) * 2.0944;
    vec2 c = vec2(sin(ph) * rr * 0.55, sin(2.0 * ph) * rr * 0.22);
    d = min(d, length(bp.xz - c) - rr * 0.62);
  }
  d = max(d, bp.y - 0.02);
  d = max(d, -(bp.y + len));
  // the tied tail below the plait
  float tail = sdRC(bp, vec3(0.0, -len, 0.0), vec3(0.0, -len - 0.035, 0.004), rr * 0.7, rr * 0.25);
  return min(d, tail);
}
float hairField(vec3 p, float sk) {
  if (uHood == 1) return 1e3;
  bool longish = uHair == 4 || uHair == 5 || uHair == 7 || uHair == 11;
  if (uHelm == 1 && !longish) return 1e3;
  float vol = HVOL;
  float d;
  if (uHair == 0) {
    float band = sat((0.03 - p.y) / 0.022) * sat((p.y + 0.05) / 0.012) * sat((0.02 - p.z) / 0.03);
    d = sk - 0.0045 * band + clumps(p, 26.0, 0.001) * band + 0.002 * (1.0 - band);
  } else {
    // the front edge thins out over a finger's width and breaks into tufts (no bowl-cut ledge)
    float hl = hairline(p) + 0.005 * (vnoise(p * 210.0 + uSeed * 5.0) - 0.5);
    float m = sat(hl / (uHair == 2 ? 0.014 : 0.028));
    m = m * m;
    float top = sat((p.y + 0.01) / 0.11);
    float T = (0.005 + 0.011 * vol * top) * m;
    if (uHair == 2) T = 0.0042 * m;
    if (uHair == 3) T *= 0.75 + 1.1 * top * sat((p.z + 0.04) / 0.1);
    if (uHair == 9 || uHair == 8 || uHair == 7 || uHair == 11) T = (0.0045 + 0.004 * top) * m;
    if (uHair == 10) T = (0.009 + 0.011 * top) * m;
    d = sk - T + 0.0018 * (1.0 - m);
    if (uHair == 10) {
      // curls: a domain-warped field of round coils
      vec3 g = p * 105.0 + 1.4 * vec3(vnoise(p * 45.0), vnoise(p * 45.0 + 4.0), vnoise(p * 45.0 + 9.0));
      vec3 f = fract(g) - 0.5;
      float coil = 0.5 - length(f);
      if (abs(d) < 0.016) d -= (0.0055 * coil - 0.0012) * m + 0.001 * (vnoise(p * 400.0) - 0.5) * m;
    } else if (abs(d) < 0.012) d += clumps(p, uHair == 2 ? 40.0 : 22.0, uHair == 2 ? 0.0012 : 0.0028) * m;
    // a few locks fall forward over the brow, lying on the skin and tapering to points
    if ((uHair == 6 || (uHair == 1 && FEM > 0.5)) && sk < 0.008 && p.z > 0.045 && p.y > 0.005 && p.y < 0.08 && abs(p.x) < 0.065) {
      float layer = max(sk - 0.0042, -sk + 0.0004);
      for (int i = min(uHair, 0); i < 5; i++) {
        float fi = float(i);
        float r1 = h12(vec2(fi, uSeed * 13.0 + 1.0));
        float x0 = (fi - 2.0) * 0.0175 + 0.006 * (r1 - 0.5) + (uHair == 3 ? -0.012 : 0.0);
        float len = 0.018 + 0.022 * h12(vec2(fi + 7.0, uSeed * 5.0)) + (uHair == 6 ? 0.012 : 0.0);
        vec3 a = vec3(x0, 0.072, 0.064);
        vec3 b = vec3(x0 + (r1 - 0.5) * 0.02 + 0.006 * sign(x0), 0.058 - len, 0.094);
        float lk = max(sdRC(p, a, b, 0.0085, 0.0012), layer);
        d = smin(d, lk, 0.0035);
      }
    }
    // swept: a forelock lifted off the brow
    if (uHair == 3) d = smin(d, sdEll(p - vec3(-0.018, 0.088, 0.045), vec3(0.058, 0.026, 0.044)) + clumps(p, 14.0, 0.002), 0.022);
    if (uHair == 4 || uHair == 5) {
      float len = FEM > 0.5 ? 0.25 : 0.17;
      float wav = uHair == 5 ? 1.0 : 0.0;
      float tt = sat((0.02 - p.y) / len);
      float w = (0.083 + tt * 0.03) * W + wav * 0.004 * sin(p.y * 48.0);
      float cz = -0.036 - tt * 0.045;
      float e = (length(vec2(p.x / w, (p.z - cz) / (0.07 + tt * 0.012))) - 1.0) * 0.07;
      e = max(e, p.y - 0.05);
      e = max(e, -(p.y + 0.02 + len));
      e = max(e, p.z - 0.03 + max(0.0, -p.y - 0.02) * 0.4);
      float a = atan(p.x, p.z + 0.03);
      e += fallClumps(p, 9.0, 0.004, wav) + 0.002 * sin(a * 5.0 + p.y * 13.0);
      d = smin(d, e, 0.018);
      vec3 q = vec3(abs(p.x), p.y, p.z);
      float lock = sdRC(q, vec3(0.072 * W, 0.035, 0.016), vec3((0.084 + wav * 0.012) * W, -0.1 - 0.04 * FEM, -0.012), 0.014, 0.008) + fallClumps(p, 14.0, 0.003, wav);
      d = smin(d, lock, 0.016);
    }
    if (uHair == 6) {
      float e = (length(vec3(p.x / (0.088 * W), (p.y - 0.018) / 0.116, (p.z + 0.012) / 0.112)) - 1.0) * 0.08;
      e = max(e, -(p.y + 0.072));
      // the fringe cut ragged and swept to one side (points, not a ruled line)
      float rag = 0.007 * abs(sin(p.x * 140.0 + uSeed * 9.0)) + 0.005 * vnoise(p * 220.0) + 0.05 * (p.x + 0.02) * (p.x + 0.02) * 6.0 - 0.006 * sat(p.x / 0.05);
      e = max(e, -0.6 * p.y + 0.8 * p.z - 0.05 + rag);
      float a = atan(p.x, p.z);
      e += fallClumps(p, 12.0, 0.003, 0.0);
      d = smin(d, e, 0.01);
    }
    if (uHair == 7) {
      // one heavy plait forward over the shoulder, the rest gathered at the nape
      vec3 bp = p - vec3(0.08 * W, -0.05, 0.012);
      bp.xz = rot2(0.25) * bp.xz;
      bp.z -= 0.18 * bp.y;
      d = smin(d, plait(bp, 0.22, 0.017), 0.012);
      d = smin(d, sdEll(p - vec3(0.0, -0.025, -0.078), vec3(0.058, 0.058, 0.044)) + clumps(p, 20.0, 0.002), 0.02);
    }
    if (uHair == 11) {
      // a dwarf woman's two plaits, heavy and long, in front of the shoulders
      vec3 aq = vec3(abs(p.x), p.y, p.z);
      vec3 bp = aq - vec3(0.08 * W, -0.035, 0.0);
      bp.z -= 0.2 * bp.y;
      bp.x -= 0.06 * bp.y;
      d = smin(d, plait(bp, 0.23, 0.019), 0.014);
      // each plait is gathered from the temple: a swept band of hair over the ear into its top,
      // so the braids hang from the head and never float beside the cheek
      float sweep = sdRC(aq, vec3(0.058 * W, 0.045, 0.034), vec3(0.08 * W, -0.03, 0.002), 0.013, 0.017) + clumps(p, 18.0, 0.0022);
      d = smin(d, sweep, 0.016);
      d = smin(d, sdEll(p - vec3(0.0, -0.01, -0.07), vec3(0.068, 0.06, 0.05)) + clumps(p, 20.0, 0.002), 0.02);
    }
    if (uHair == 8) {
      d = smin(d, sdEll(p - vec3(0.0, 0.11, -0.085), vec3(0.04, 0.034, 0.036)) + clumps(p * 1.3, 14.0, 0.002), 0.016);
    }
    if (uHair == 9) {
      d = smin(d, sdEll(p - vec3(0.0, 0.128, -0.035), vec3(0.022, 0.024, 0.022)), 0.012);
      d = smin(d, sdRC(p, vec3(0.0, 0.132, -0.05), vec3(0.0, 0.05, -0.13), 0.015, 0.006) + clumps(p, 14.0, 0.0015), 0.01);
    }
    if (uHair == 1 && FEM > 0.5) d = smin(d, sdEll(p - vec3(0.0, -0.01, -0.05), vec3(0.08, 0.07, 0.068)) + clumps(p, 18.0, 0.002), 0.02);
  }
  if (uHelm == 1) d = max(d, p.y - (0.018 + 0.13 * p.z));
  // Elves wear their hair behind the ears: the long points always show.
  if (ELF > 0.3) {
    vec3 eq = vec3(abs(p.x), p.y, p.z) - vec3(0.074 * W, 0.006, -0.016);
    d = smax(d, -(sdEll(eq, vec3(0.03, 0.05 + 0.02 * ELF, 0.028)) ), 0.008);
  }
  return d;
}

// ------------------------------------------------------------------ beards
float beardMask(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float mY = MOUTHY();
  float tipY = TIPY();
  float u = q.x / 0.033;
  float cy = tipY - 0.0135 - 0.014 * u * u;
  float th = 0.0058 * (1.0 - 0.7 * u * u) + 0.0012;
  float mo = sat((th - abs(p.y - cy)) / 0.003) * sat((1.0 - u) / 0.2) * sat((p.z - 0.066) / 0.012);
  float m = uBeard >= 2 ? mo : 0.0;
  if (uBeard >= 3) {
    float chin = sat((mY - 0.009 - p.y) / 0.004);
    float lipHole = sat((length(vec2(q.x / 0.0125, (p.y - mY + 0.0045) / 0.0052)) - 1.0) / 0.45);
    float region;
    if (uBeard == 3) region = chin * sat((0.025 - q.x) / 0.008) * sat((p.z - 0.04) / 0.02);
    else {
      float bTop = -0.006 - 0.5 * max(p.z, 0.0);
      // the cheek line feathers over a finger's width (sparse hairs thickening), never a cut edge
      bTop += 0.003 * (vnoise2(vec2(p.x, p.z) * 260.0 + uSeed * 5.0) - 0.5);
      // the lower border is a rounded U under the chin (never a square cut), shorter at the sides
      float bBot = -0.165 + 0.075 * pow(sat(q.x / 0.06), 1.6) + 0.02 * sat(-p.z / 0.03);
      region = smoothstep(0.0, 1.0, sat((bTop - p.y) / 0.014)) * smoothstep(0.0, 1.0, sat((p.y - bBot) / 0.02)) * lipHole * sat((p.z + 0.03) / 0.02);
    }
    m = max(m, region);
  }
  return m;
}
float gRing;
float beardField(vec3 p, float sk) {
  if (uBeard < 2) return 1e3;
  float m = beardMask(p);
  float T = uBeard == 2 ? 0.0055 : uBeard == 3 ? 0.007 : 0.008 * (1.0 + 0.5 * (BLEN - 1.0));
  // the mass tapers to nothing at its border, so it grows out of the cheek and lip
  // thin over the cheeks, full over the chin and jaw: the beard has a form, not a slab's thickness
  float full = uBeard >= 4 ? 0.45 + 0.75 * sat((-p.y - 0.035) / 0.06) * sat(1.0 - abs(p.x) / 0.075) : 1.0;
  float d = sk - T * full * m * m * (3.0 - 2.0 * m) + 0.002 * (1.0 - m);
  if (m > 0.0 && abs(d) < 0.012) d += (fallClumps(p, 11.0, 0.0055, 1.5) + fallClumps(p * 1.7 + 0.3, 13.0, 0.002, 2.2)) * m;
  if (uBeard == 3) d = smin(d, sdRC(p, vec3(0.0, -0.11, 0.072), vec3(0.0, -0.15, 0.077), 0.016, 0.006) + fallClumps(p, 20.0, 0.0015, 0.3), 0.012);
  // the lower edge of a full beard breaks into tapering locks of different lengths (no flat curtain)
  if (uBeard >= 4 && p.y < -0.08 && p.z > 0.02 && abs(p.x) < 0.07) {
    float bl = uBeard == 5 ? 0.09 : uBeard == 6 ? 0.07 : 0.045;
    float y0 = uBeard == 5 ? -0.225 : uBeard == 6 ? -0.165 : -0.13;
    for (int i = min(uBeard, 0); i < 7; i++) {
      float fi = float(i);
      float r1 = h12(vec2(fi * 3.1, uSeed * 7.0 + 2.0));
      float x0 = (fi - 3.0) * 0.0115 * (1.0 + 0.15 * float(uBeard == 6));
      float zc = 0.074 - 0.012 * abs(fi - 3.0) / 3.0;
      vec3 a = vec3(x0, y0 + 0.02, zc - 0.004);
      vec3 b = vec3(x0 * 0.7 + (r1 - 0.5) * 0.012, y0 - bl * (0.55 + 0.6 * r1) * (1.0 - 0.25 * abs(fi - 3.0) / 3.0), zc + 0.006);
      float lk = sdRC(p, a, b, 0.0085, 0.0011) + fallClumps(p, 30.0, 0.0012, 0.3);
      d = smin(d, lk, 0.006);
    }
  }
  gRing = 1e3;
  if (uBeard == 5) {
    float e = sdEll(p - vec3(0.0, -0.14, 0.05), vec3(0.05, 0.064, 0.042));
    e = smin(e, sdRC(p, vec3(0.0, -0.17, 0.058), vec3(0.004, -0.255, 0.07), 0.03, 0.008), 0.03);
    e += fallClumps(p, 16.0, 0.0035, 0.5);
    d = smin(d, e, 0.02);
  }
  if (uBeard == 6) {
    // a dwarf's beard: a broad full mass to the chest, then two plaits clasped with bronze rings
    vec3 q = vec3(abs(p.x), p.y, p.z);
    // a spade: broad at the jaw, drawn in toward the point
    vec3 bq = p - vec3(0.0, -0.13, 0.058);
    bq.x /= 1.0 + clamp(bq.y * 4.0, -0.35, 0.25);
    float e = sdEll(bq, vec3(0.052, 0.05, 0.038)) * 0.85;
    e += fallClumps(p, 13.0, 0.0065, 0.9);
    vec3 bp = q - vec3(0.024, -0.15, 0.084);
    bp.x -= 0.08 * bp.y;
    bp.z += 0.05 * bp.y;
    e = smin(e, plait(bp, 0.11, 0.016), 0.014);
    d = smin(d, e, 0.02);
    for (int i = 0; i < 2; i++) {
      float ry = -0.03 - 0.045 * float(i);
      vec3 rp = bp - vec3(0.0, ry, 0.0);
      float ring = length(vec2(length(rp.xz) - 0.0135 * (1.0 - 0.2 * float(i)), rp.y)) - 0.0042;
      gRing = min(gRing, ring);
    }
    d = min(d, gRing);
  }
  return d;
}

// ------------------------------------------------------------------ hood / helm
float gHoodIn;
// A cloth hood: a deep cowl peaked at the back of the crown, its opening framed by a rolled,
// hemmed rim that overhangs the brow (and so shades the face), soft vertical drapes that deepen
// toward the shoulders and a few heavier folds gathering under the chin. The inner lining shows
// darker inside the opening.
float hoodField(vec3 p) {
  if (uHood == 0) return 1e3;
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float a = atan(p.x, -p.z);
  float low = sat(-(p.y + 0.01) / 0.13);
  // drapes: few and broad at the crown, more and deeper toward the shoulders, slightly irregular
  float fold = (0.0012 + 0.0055 * low) * sin(a * (4.0 + 3.0 * low) + p.y * 9.0 + 1.3 * sin(a * 2.0 + uSeed * 6.0));
  fold += 0.0016 * low * sin(a * 13.0 - p.y * 25.0 + 2.0);
  vec3 c = p - vec3(0.0, 0.028, -0.016);
  float outer = sdEll(c, vec3(0.098, 0.128, 0.124) * vec3(W * 0.6 + 0.4, 1.0, 1.0));
  // the peak: the cloth falls off a point behind the crown
  outer = smin(outer, sdRC(p, vec3(0.0, 0.09, -0.05), vec3(0.0, 0.135, -0.105), 0.05, 0.008), 0.03);
  // the cowl spreads over the shoulders
  outer = smin(outer, sdEll(p - vec3(0.0, -0.15, -0.03), vec3(0.15, 0.06, 0.13)), 0.05);
  outer += fold;
  float sh = abs(outer) - 0.0055;
  gHoodIn = outer < 0.0 ? 1.0 : 0.0;
  // the opening: an oval round the face, its top edge low over the brow
  vec3 oc = p - vec3(0.0, -0.028, 0.118);
  float open = sdEll(oc, vec3(0.071 * W, 0.104, 0.1));
  sh = smax(sh, -open, 0.006);
  // the rolled rim of the opening, hemmed and thick, standing a little proud
  float rim = length(vec2(open, outer)) - 0.0068;
  rim = max(rim, p.y - 0.12);
  sh = smin(sh, rim, 0.004);
  // under the chin the cowl's folds gather toward the throat
  float bib = sdEll(p - vec3(0.0, -0.14, 0.04), vec3(0.085, 0.045, 0.06)) + 0.004 * sin(p.x * 160.0) * sat(-(p.y + 0.12) / 0.03);
  bib = smax(bib, -sdEll(p - vec3(0.0, -0.06, 0.06), vec3(0.06, 0.08, 0.07)), 0.02);
  sh = smin(sh, bib, 0.02);
  sh = smax(sh, -sdEll(p - vec3(0.0, -0.24, -0.02), vec3(0.24, 0.06, 0.24)), 0.02);
  return sh;
}
float gHelmPart;
float helmField(vec3 p) {
  if (uHelm == 0) return 1e3;
  float cap = sdEll(p - vec3(0.0, 0.034, -0.014), vec3(0.087 * W, 0.108, 0.11));
  float rim = 0.026 + 0.13 * p.z - p.y;
  float bowl = max(cap, rim);
  float band = sdEll(p - vec3(0.0, 0.018, -0.014), vec3(0.091 * W, 0.112, 0.114));
  band = max(band, rim);
  band = max(band, -(rim + 0.016));
  // the nasal: a narrow forged bar standing proud of the bridge of the nose, flaring into the brim
  vec3 nq = p - vec3(0.0, 0.0, 0.0);
  nq.z = (nq.z - 0.1) * 1.8 + 0.1;
  // (it stops at the bridge: a bar down the whole nose read as a stripe across the face)
  float nasal = sdRC(nq, vec3(0.0, 0.03, 0.1 - 0.012 * 1.8), vec3(0.0, 0.004, 0.1 + 0.004 * 1.8), 0.0066, 0.0042) / 1.8;
  float ridge = sdCap(p, vec3(0.0, 0.142, 0.04), vec3(0.0, 0.11, -0.1), 0.006);
  gHelmPart = band < bowl - 0.0005 ? 1.0 : 0.0;
  float d = min(min(bowl, band), ridge);
  float av = (length(vec2(p.x / (0.093 * W), (p.z + 0.016) / 0.111)) - 1.0) * 0.09;
  av = max(av, p.y - 0.004);
  av = max(av, -(p.y + 0.13));
  av = max(av, -0.6 * p.y + 0.8 * p.z - 0.036);
  if (av < d) gHelmPart = 2.0;
  return min(d, av);
}

// ------------------------------------------------------------------ the bust
// Body frame: neck base near (0,-0.17,-0.02), shoulders ±0.17, facing +z.
float gBodyPart;   // 0 base garment, 1 trim/second layer, 2 cloak, 3 metal fittings, 4 gold, 5 fur, 6 under-layer
float torso(vec3 b) {
  vec3 q = vec3(abs(b.x), b.y, b.z);
  float sw = mix(0.172, 0.152, FEM) * (1.0 + 0.12 * step(0.5, BLEN - 1.0));
  float d = sdEll(b - vec3(0.0, -0.4, -0.012), vec3(sw * 0.92, 0.245, 0.108));
  // trapezius from the neck to the shoulder point
  d = smin(d, sdRC(q, vec3(0.03, -0.16, -0.03), vec3(sw, -0.238, -0.014), 0.034, 0.044), 0.04);
  // deltoid and upper arm
  d = smin(d, sdRC(q, vec3(sw + 0.012, -0.262, -0.008), vec3(sw + 0.03, -0.7, -0.01), 0.052, 0.044), 0.03);
  // upper chest (a broad barrel, never a muscle cuirass); a gentle bust on women
  d = smin(d, sdEll(b - vec3(0.0, -0.29, 0.0), vec3(sw * 0.86, 0.1, 0.1)), 0.05);
  d = smin(d, sdEll(q - vec3(0.055, -0.31, 0.05), vec3(0.06, 0.05, 0.045)) + 0.02 * (1.0 - FEM), 0.04);
  return d;
}
float bodyField(vec3 b, out float part) {
  part = 0.0;
  vec3 q = vec3(abs(b.x), b.y, b.z);
  float t = torso(b);
  float d;
  if (uBody == 0) {
    // plate: breastplate with a medial ridge, gorget, layered pauldrons
    d = t - 0.012;
    d = smin(d, sdCap(b, vec3(0.0, -0.22, 0.09), vec3(0.0, -0.55, 0.11), 0.004), 0.03);
    float gorget = sdRC(b, vec3(0.0, -0.14, -0.018), vec3(0.0, -0.215, -0.012), 0.056, 0.074);
    gorget = max(abs(gorget) - 0.006, b.y + 0.135);
    float pa = 1e3;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec3 c = vec3(0.19 + 0.006 * fi, -0.235 - 0.03 * fi, -0.01);
      float s = abs(sdEll(q - c, vec3(0.072 - 0.004 * fi, 0.058, 0.07))) - 0.004;
      s = max(s, -(q.y - c.y + 0.035 - 0.004 * fi));
      pa = min(pa, s);
    }
    if (gorget < d) { d = gorget; part = 3.0; }
    if (pa < d) { d = pa; part = 3.0; }
  } else if (uBody == 1 || uBody == 5) {
    // mail hauberk over a gambeson; the tabard adds a cloth panel in front
    d = t - 0.009 + 0.003 * sin(b.y * 90.0 + sin(b.x * 25.0) * 2.0) * sat(-(b.y + 0.24) / 0.1) + 0.002 * sin(b.x * 55.0 + b.y * 20.0);
    float coif = sdRC(b, vec3(0.0, -0.13, -0.02), vec3(0.0, -0.22, -0.01), 0.058, 0.08) + 0.003 * sin(atan(b.x, b.z) * 9.0);
    coif = max(abs(coif) - 0.007, b.y + 0.135);
    d = smin(d, coif, 0.02);
    if (uBody == 5) {
      float tab = t - 0.014;
      tab = max(tab, q.x - 0.12 + 0.12 * sat((b.y + 0.25) / -0.2) * 0.0);
      tab = max(tab, b.y + 0.205 + 0.18 * q.x);
      tab += 0.0025 * sin(b.x * 60.0 + 1.0) * sat(-(b.y + 0.3) / 0.2);
      if (tab < d) { d = tab; part = 1.0; }
    }
  } else if (uBody == 2) {
    d = t - 0.011;
    float collar = sdRC(b, vec3(0.0, -0.15, -0.02), vec3(0.0, -0.215, -0.014), 0.058, 0.076);
    collar = max(abs(collar) - 0.006, b.y + 0.15);
    if (collar < d) { d = collar; part = 6.0; }
  } else if (uBody == 3 || uBody == 6) {
    // leather jerkin with a high collar; furs add a shaggy mantle
    d = t - 0.008;
    float collar = sdRC(b, vec3(0.0, -0.145, -0.022), vec3(0.0, -0.215, -0.012), 0.056, 0.075);
    collar = max(abs(collar) - 0.0055, b.y + 0.14);
    collar = max(collar, -(b.z - 0.035 + 0.6 * (b.y + 0.2)) * step(0.0, b.z) );
    if (collar < d) { d = collar; part = 1.0; }
    if (uBody == 6) {
      float a = atan(b.x, b.z);
      float fur = sdEll(b - vec3(0.0, -0.215, -0.02), vec3(mix(0.172, 0.152, FEM) * 1.08, 0.06, 0.13)) - 0.006 * vnoise(vec3(a * 9.0, b.y * 60.0, 1.0)) - 0.004 * vnoise(b * 160.0);
      fur = max(fur, -sdEll(b - vec3(0.0, -0.18, 0.0), vec3(0.06, 0.08, 0.08)));
      if (fur < d) { d = fur; part = 5.0; }
    }
  } else {
    // robes, vestments, tunic: cloth with folds, a collar and (vestments) a stole
    float folds = 0.0035 * sin(b.x * 70.0 + sin(b.y * 20.0) * 1.5) * sat(-(b.y + 0.27) / 0.15);
    d = t - 0.01 + folds;
    float collar = sdRC(b, vec3(0.0, -0.15, -0.02), vec3(0.0, -0.215, -0.012), 0.054, 0.072);
    collar = max(abs(collar) - 0.008, b.y + 0.15);
    if (collar < d) { d = collar; part = 1.0; }
    if (uBody == 7) {
      float stole = t - 0.0145;
      float bandX = abs(q.x - 0.055 - 0.25 * (b.y + 0.2));
      stole = max(stole, bandX - 0.021);
      stole = max(stole, b.y + 0.19);
      if (stole < d) { d = stole; part = 1.0; }
    }
  }
  // the cloak: over the shoulders and back, clasped at the collarbone
  if (uCloak == 1 && uBody != 4 && uBody != 7) {
    float a = atan(b.x, -b.z);
    float fold = 0.004 * sin(a * 9.0 + b.y * 14.0) + 0.002 * sin(a * 21.0);
    float ck = t - 0.026 + fold;
    ck = max(ck, b.z - 0.02 - 0.8 * max(0.0, -(b.y + 0.24)) - 0.12 * sat((q.x - 0.1) / 0.06));
    ck = max(ck, -(t - 0.012));
    float clasp = max(length(b - vec3(-0.062, -0.2, 0.07)) - 0.017, abs(dot(b - vec3(-0.062, -0.2, 0.07), normalize(vec3(-0.3, 0.35, 0.89)))) - 0.005);
    if (ck < d) { d = ck; part = 2.0; }
    if (clasp < d) { d = clasp; part = 4.0; }
  }
  // a holy symbol for clerics
  if (uCleric == 1) {
    vec3 sp = b - vec3(0.0, -0.31, 0.112 + 0.012 * step(0.5, float(uBody == 0)));
    float sym = max(length(sp.xy) - 0.017, abs(sp.z) - 0.003);
    if (sym < d) { d = sym; part = 4.0; }
  }
  return d;
}

// ------------------------------------------------------------------ the scene
// Materials: 1 skin, 2 eye, 3 hair, 4 beard, 5 hood cloth, 6 helm steel, 7 helm band, 8 mail,
// 10+ the bust (10 + part).
vec3 headLocal(vec3 pw) { return uHeadR * (pw - uHeadC) / uHeadScale; }
const float BODYK = 0.9;
vec3 bodyLocal(vec3 pw) { return uBodyR * (pw - vec3(0.0, -0.022, 0.0)) / (uHeadScale * BODYK); }
vec2 map(vec3 pw) {
  vec3 p = headLocal(pw);
  float hs = uHeadScale;
  float res = 1e3;
  float mat = 0.0;
  bool longHair = uHair == 4 || uHair == 5 || uHair == 7 || uHair == 11;
  bool longBeard = uBeard >= 5;
  // bounds: the head proper, then the long hair / beard below it
  float bnd = sdEll(p - vec3(0.0, 0.0, -0.005), vec3(0.122, 0.15, 0.142));
  if (longHair) bnd = min(bnd, sdEll(p - vec3(0.0, -0.1, -0.04), vec3(0.13, 0.22, 0.12)));
  if (longBeard) bnd = min(bnd, sdEll(p - vec3(0.0, -0.18, 0.05), vec3(0.09, 0.15, 0.08)));
  if (bnd < 0.012) {
    float sk = MDBG(64) ? sdEll(p - vec3(0.0, 0.0, 0.0), vec3(0.075, 0.11, 0.1)) : skin(p);
    res = sk;
    mat = gEye <= sk + 1e-5 ? 2.0 : 1.0;
    if ((uHair != 0 || uHelm == 0) && !MDBG(32)) {
      if (p.y > -0.09 || longHair) {
        float hr = hairField(p, sk) * 0.6;
        if (hr < res) { res = hr; mat = 3.0; }
      }
    }
    if (uBeard >= 2 && p.y < -0.01 && p.z > -0.02) {
      float bd = beardField(p, sk) * 0.6;
      if (bd < res) { res = bd; mat = gRing < bd / 0.6 + 1e-5 ? 7.0 : 4.0; }
    }
    if (uHood == 1) {
      float ho = hoodField(p);
      if (ho < res) { res = ho; mat = 5.0; }
    }
    if (uHelm == 1 && p.y > -0.14) {
      float he = helmField(p);
      if (he < res) { res = he; mat = gHelmPart > 1.5 ? 8.0 : gHelmPart > 0.5 ? 7.0 : 6.0; }
    }
    res *= hs;
  } else {
    res = bnd * hs;
  }
  vec3 b = bodyLocal(pw);
  if (!MDBG(16)) {
    // the bust lies inside this ellipsoid (and below b.y = -0.06): its distance bounds the bust's
    // wherever the bust is not evaluated (never a plane, which stalls rays running level with it)
    float bb = sdEll(b - vec3(0.0, -0.43, -0.01), vec3(0.34, 0.38, 0.21));
    if (b.y < -0.06 && bb < 0.015) {
      float part;
      float bd = bodyField(b, part) * hs * BODYK;
      if (bd < res) { res = bd; mat = 10.0 + part; }
    } else res = min(res, max(bb, max(b.y + 0.06, 0.0)) * hs * BODYK + 0.0005);
  }
  return vec2(res, mat);
}
float mapD(vec3 p) { return map(p).x; }
`;

export const GLSL_SHADE = /* glsl */`
#define DBG(b) (mod(floor(uDbg / float(b)), 2.0) > 0.5)
#define ZERO (min(int(uRes.x), 0))
float gCurv;
// The painter's complexion: the three zones of a face (a golden forehead, a red middle — cheeks,
// nose and ears — and a cooler jaw and chin, blue-grey with a man's beard shadow), violet-brown
// sockets, lips drawn from their own volumes, brows as hair, pores, freckles and age spots.
float gLipMask;
vec3 skinAlbedo(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float lumS = dot(uSkin, vec3(0.3, 0.59, 0.11));
  // pale complexions are held down in value and kept saturated, so a fair face under the key
  // still models in warm half-tones instead of burning out to a white mask
  vec3 base = mix(uSkin, vec3(lumS), mix(0.3, 0.12, sat((lumS - 0.35) / 0.25))) * 0.74;
  base *= clamp(0.4 / max(lumS, 1e-3), 0.7, 1.0);
  float dark = sat((0.25 - lumS) / 0.2);
  float ex = EX();
  float mY = MOUTHY();
  float tipY = TIPY();
  vec3 ruddy = base * vec3(1.18, 0.76, 0.74);
  vec3 warm = base * vec3(1.08, 1.0, 0.8);
  vec3 cool = base * vec3(0.78, 0.86, 1.02);
  float cheek = gau2((q.xy - vec2(0.04 * W, -0.03)) / vec2(0.03, 0.026)) * sat((p.z - 0.03) / 0.03);
  float noseZ = gau2((p.xy - vec2(0.0, tipY + 0.002)) / vec2(0.011, 0.012)) * sat((p.z - 0.09) / 0.012);
  float earZ = sat((q.x - 0.062 * W) / 0.008) * sat((p.y + 0.05) / 0.02);
  float brow = sat((p.y - 0.026) / 0.03) * sat(p.z / 0.06);
  float jaw = sat((-0.056 * LOWF() - p.y) / 0.025) * sat((p.z + 0.01) / 0.04);
  float muzzle = gau2((p.xy - vec2(0.0, mY + 0.004)) / vec2(0.026, 0.018)) * sat((p.z - 0.07) / 0.02);
  vec3 c = base;
  c = mix(c, warm, brow * 0.75);
  float red = sat(cheek * (0.55 + 0.15 * FEM + 0.3 * HALF) + noseZ * (0.6 + 0.4 * AGE) + earZ * 0.8);
  c = mix(c, ruddy, red * (1.0 - 0.5 * dark));
  float stub = (1.0 - FEM) * (uBeard == 1 ? 1.0 : uBeard == 0 ? 0.45 : 0.6);
  c = mix(c, cool, sat(jaw * (0.25 + 0.5 * stub) + muzzle * 0.45 * stub));
  c = mix(c, base * vec3(0.86, 0.9, 0.8), muzzle * (0.18 + 0.1 * FEM) * (1.0 - stub));
  // the temples and the sides of the forehead a cooler, greyer passage
  c = mix(c, base * vec3(0.88, 0.9, 0.96), sat((q.x - 0.045) / 0.02) * sat((p.y - 0.01) / 0.03) * 0.35);
  if (stub > 0.0) {
    // the beard shadow: a cool grey-blue glaze stippled with hair roots
    float region = sat(jaw + muzzle * 0.8 - sat((q.x - 0.05) / 0.012));
    float roots = smoothstep(0.35, 0.8, vnoise(p * 1800.0));
    c *= 1.0 - region * stub * (0.07 + 0.12 * roots) * (uBeard == 1 ? 1.4 : 1.0);
  }
  // sockets: a violet-brown glaze; the upper-lid crease darker; women's lids a little colour
  float sock = gau2((q.xy - vec2(ex, 0.002)) / vec2(0.02, 0.013)) * sat((p.z - 0.045) / 0.02);
  c = mix(c, base * vec3(0.78, 0.64, 0.68), sock * (0.26 + 0.22 * AGE));
  float fy = 0.0108 - 0.0032 * LID;
  float crease = gau2((q.xy - vec2(ex, fy)) / vec2(0.013, 0.0026)) * sat((p.z - 0.06) / 0.02);
  c = mix(c, base * vec3(0.48, 0.38, 0.4), crease * 0.45);
  c = mix(c, base * vec3(0.66, 0.5, 0.56), gau2((q.xy - vec2(ex + 0.001, 0.0065)) / vec2(0.015, 0.0045)) * sat((p.z - 0.06) / 0.02) * FEM * 0.4);
  // the wet pink line of the lower lid and the inner corner (caruncle)
  vec2 ll = lidLines(q);
  float edx = (q.x - ex + 0.0012) / (0.0148 * sqrt(EYE));
  float inEye = sat((1.0 - abs(edx)) * 5.0);
  c = mix(c, base * vec3(1.12, 0.62, 0.62), gau((q.y - ll.y + 0.0007) / 0.0006) * inEye * sat((p.z - EZ()) / 0.006) * 0.55);
  c = mix(c, vec3(0.55, 0.22, 0.22) * base * 1.6, gau2((q.xy - vec2(ex - 0.0135 * sqrt(EYE), -0.0008)) / vec2(0.0018, 0.0014)) * 0.7);
  // lips, from the same reliefs the sculpt carries
  {
    vec3 lf3 = lipField(p);
    float lipK = LIPS * (1.0 + 0.1 * FEM);
    float ur = sat(lf3.x / (0.0018 * lipK)), lr = sat(lf3.y / (0.0022 * lipK));
    float lm = sat(smoothstep(0.05, 0.5, ur) + smoothstep(0.05, 0.5, lr)) * sat((p.z - 0.07) / 0.01);
    gLipMask = lm;
    vec3 lipC = mix(base * vec3(0.95, 0.56, 0.56), base * vec3(1.0, 0.46, 0.5), FEM * 0.85);
    lipC = mix(lipC, base * vec3(0.82, 0.58, 0.58), dark * 0.5);
    c = mix(c, lipC, lm * (0.7 + 0.2 * FEM));
    // the upper lip a deeper, cooler red (it turns from the light); the lower lip fuller, lighter
    float um = smoothstep(0.05, 0.5, ur) * (1.0 - smoothstep(0.2, 0.6, lr));
    c = mix(c, c * vec3(0.78, 0.68, 0.74), um * 0.55);
    c = mix(c, c * vec3(1.06, 1.03, 1.02), smoothstep(0.2, 0.7, lr) * 0.5);
    // the parting line and the corners
    c = mix(c, base * vec3(0.26, 0.12, 0.12), lf3.z * 0.85 * sat((p.z - 0.07) / 0.008));
    // the corners: a small dark pocket where the lips tuck into the cheek
    c = mix(c, base * vec3(0.36, 0.22, 0.22), gau2((vec2(q.x, p.y) - vec2(0.0204 * MOUTH, mY - 0.0004)) / vec2(0.0032, 0.0022)) * 0.7);
  }
  // where a beard thins out at its border the skin shows through a stipple of hairs
  if (uBeard >= 2 && FEM < 0.5) {
    float bm = beardMask(p);
    float hairs = smoothstep(0.45, 0.75, vnoise(p * vec3(2200.0, 900.0, 2200.0) + uSeed * 3.0));
    c = mix(c, mix(c, uHairC * 0.75, 0.85), sat(bm * 1.6) * (0.25 + 0.6 * hairs));
  }
  // pores, mottling, freckles and age spots
  float pores = vnoise(p * 2600.0 + uSeed * 31.0);
  c *= 0.95 + 0.07 * fbm3(p * 70.0 + uSeed * 10.0) + 0.04 * (pores - 0.5) * (0.4 + 0.6 * (red + noseZ));
  float frk = (HALF * 0.8 + 0.35 * sat((0.55 - dot(uHairC, vec3(0.2, -0.3, -0.2)) * 0.0) - 0.0)) * (1.0 - dark);
  frk *= sat(uHairC.r * 3.0 - uHairC.b * 6.0);
  float fr = smoothstep(0.72, 0.86, vnoise(p * 900.0 + 7.0)) * gau2((q.xy - vec2(0.03, -0.012)) / vec2(0.035, 0.022));
  c = mix(c, base * vec3(0.78, 0.55, 0.42), fr * sat(frk + HALF * 0.4) * 0.5);
  c = mix(c, base * vec3(0.72, 0.56, 0.44), AGE * 0.4 * smoothstep(0.66, 0.82, vnoise(p * 320.0 + 3.0)) * sat((p.y + 0.02) / 0.06));
  // hair roots darken the skin just below the hairline
  if (uHood == 0 && uHelm == 0 && uHair != 0) {
    float hl = hairline(p);
    float roots = sat(1.0 - (-hl) / 0.006) * sat(p.y / 0.02 + 0.6);
    c = mix(c, uHairC * 0.85 + base * 0.15, roots * 0.45 * (0.55 + 0.45 * vnoise(p * 900.0)));
  }
  // brows painted as hair strokes, combed outward and up
  {
    float u = (q.x - ex * 0.9) / 0.022;
    float arch = 0.0168 + (0.0028 + 0.0025 * FEM) * (1.0 - u * u) + 0.0024 * BTILT * u - 0.0024 * SCOWL * (1.0 - u) + 0.0008 * FEM;
    float thick = 0.0042 * BTHICK * (1.0 - 0.55 * sat(u)) * (0.75 + 0.25 * BROW) * (1.0 - 0.25 * FEM);
    float bb = smoothstep(0.0, 1.0, 1.0 - abs(q.y - arch - 0.0014 * (1.0 - u)) / thick);
    bb *= sat((1.12 - abs(u)) * 3.0) * sat((q.z - 0.055) / 0.01) * sat((q.x - 0.006) / 0.004);
    float hairs = 0.7 + 0.3 * sin(q.x * 2600.0 + q.y * 1800.0 * sign(u - 0.0) + vnoise(p * 600.0) * 4.0);
    vec3 browC = mix(uHairC * 0.62, uHairC * 0.42 + base * 0.12, 0.3);
    c = mix(c, browC, sat(bb * hairs * 1.3) * 0.92);
  }
  // character lines: nasolabial, forehead, crow's feet, tear trough
  {
    float L = LINES;
    vec3 creaseC = base * vec3(0.62, 0.48, 0.47);
    vec2 a = vec2(0.0185 * NWIDTH, tipY - 0.002), b = vec2(0.0265 * MOUTH, mY - 0.011);
    vec2 pa = q.xy - a, ba = b - a;
    float h = sat(dot(pa, ba) / dot(ba, ba));
    float nl = length(pa - ba * h);
    c = mix(c, creaseC, gau(nl / (0.0022 + 0.0012 * L)) * sat((p.z - 0.055) / 0.015) * (0.1 + 0.35 * L));
    float fy2 = (p.y - 0.04 + 0.0015 * sin(p.x * 70.0 + uSeed)) / 0.0095;
    float fl = gau((fract(fy2) - 0.5) / 0.1) * step(0.0, fy2) * step(fy2, 3.0);
    c = mix(c, creaseC, fl * sat(1.0 - abs(p.x) / 0.04) * sat((p.z - 0.05) / 0.02) * sat(L - 0.45) * 0.38 * (1.0 - 0.6 * FEM));
    vec2 oc = q.xy - vec2(ex + 0.0135, 0.0);
    float ca = atan(oc.y, oc.x);
    float cr = length(oc);
    float fan = pow(abs(sin(ca * 7.0)), 10.0) * sat(1.0 - abs(ca) / 0.9) * smoothstep(0.002, 0.004, cr) * sat((0.014 - cr) / 0.006);
    c = mix(c, creaseC, fan * sat(L - 0.5) * 0.4);
    vec2 ub = q.xy - vec2(ex - 0.001, -0.0105);
    float tear = gau(ub.y / 0.0032) * sat(1.0 - abs(ub.x) / 0.014) * sat((p.z - 0.06) / 0.01);
    c = mix(c, creaseC, tear * (0.06 + 0.25 * L));
    // the philtrum's two ridges
    c = mix(c, base * 1.06, gau((q.x - 0.0045) / 0.0013) * sat((p.y - mY - 0.006) / 0.003) * sat((tipY - 0.009 - p.y) / 0.003) * 0.3);
  }
  if (uScar == 1) {
    float sd = sdCap(p, vec3(-0.012, 0.03, 0.09), vec3(-0.05, -0.035, 0.07), 0.0016);
    c = mix(c, base * vec3(1.15, 0.76, 0.78), sat(1.0 - abs(sd) / 0.0018) * 0.8);
    c = mix(c, base * vec3(0.7, 0.5, 0.5), sat(1.0 - abs(abs(sd) - 0.002) / 0.0008) * 0.35);
  }
  return c;
}

// Eye: sclera never pure white (warm, veined toward the corners), the iris with a dark limbal ring,
// radial fibres and a lighter collarette round the pupil.
vec3 eyeAlbedo(vec3 p, out float iris) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 ec = vec3(EX(), 0.0, EZ());
  vec3 v = normalize(q - ec);
  vec3 g = gazeQ(p);
  float ang = acos(clamp(dot(v, g), -1.0, 1.0));
  float ir = 0.6;
  float pr = 0.17 + 0.03 * h12(vec2(uSeed));
  iris = smoothstep(ir + 0.03, ir - 0.03, ang);
  vec3 scl = vec3(0.56, 0.5, 0.45) * mix(vec3(1.0), vec3(0.95, 0.7, 0.66), smoothstep(0.8, 1.4, ang));
  vec3 bx = normalize(cross(g, vec3(0.0, 1.0, 0.0)));
  vec3 by = cross(bx, g);
  float a = atan(dot(v, by), dot(v, bx));
  float fib = 0.65 + 0.35 * vnoise(vec3(a * 14.0, ang * 30.0, 1.0)) + 0.15 * sin(a * 42.0);
  vec3 ec2 = mix(uEyeC, vec3(dot(uEyeC, vec3(0.33))), 0.25) * 1.1;
  vec3 ic = mix(ec2 * 1.15 + vec3(0.03, 0.022, 0.0), ec2 * 0.62, smoothstep(pr, ir, ang)) * fib;
  ic = mix(ic, ec2 * 0.18, smoothstep(ir - 0.12, ir, ang));
  ic = mix(vec3(0.01), ic, smoothstep(pr - 0.02, pr + 0.02, ang));
  vec3 c = mix(scl, ic, iris);
  // the upper lid and lashes shade the top of the eyeball; the lower lid a little
  vec2 ll = lidLines(q);
  c *= mix(0.3, 1.0, smoothstep(0.0006, 0.005, ll.x - q.y));
  c *= mix(0.72, 1.0, smoothstep(0.0, 0.0025, q.y - ll.y));
  return c;
}

// ------------------------------------------------------------------ backdrop
vec3 backdrop(vec2 uv) {
  vec2 c = uv - vec2(0.5, 0.55);
  // directional brush sweeps whose angle wanders across the canvas
  float ang = 0.75 + 0.6 * (vnoise2(uv * 2.0 + uSeed * 7.0) - 0.5);
  vec2 r = rot2(ang) * (uv * vec2(uRes.x / uRes.y, 1.0));
  // (soft value masses only: the strokes are the oil pass's job)
  float s1 = vnoise2(vec2(r.x * 4.0, r.y * 9.0) + uSeed * 13.0);
  float s2 = vnoise2(vec2(r.x * 7.0, r.y * 13.0) + 3.0);
  float big = vnoise2(uv * 3.0 + uSeed * 3.0);
  // light behind the head on the shadow side (the painter's counterchange)
  float halo = exp(-dot((uv - vec2(0.64, 0.62)) * vec2(1.4, 1.0), (uv - vec2(0.64, 0.62)) * vec2(1.4, 1.0)) * 5.0);
  vec3 col = mix(uBgA, uBgB, sat(halo * 1.1 + (big - 0.5) * 0.5 + (s1 - 0.5) * 0.35));
  col *= 0.75 + 0.35 * s1 + 0.12 * (s2 - 0.5);
  // low-key: the backdrop falls away to near-black at the edges, as the board's dark between torches
  col *= 1.0 - 0.72 * sat(length(c * vec2(1.0, 0.8)) * 1.35 - 0.2);
  return col * 0.78;
}

// ------------------------------------------------------------------ main
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (DBG(128)) { oColor = vec4(uv, 0.0, 0.0); oInfo = vec4(0.0); return; }
  vec2 ndc = (uv * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uCamR * vec3(ndc, uFocal));
  vec3 ro = uCamPos;
  // bound: a sphere round the bust
  vec3 bc = vec3(0.0, -0.2, 0.0);
  float br = 0.62;
  vec3 oc = ro - bc;
  float bq = dot(oc, rd);
  float disc = bq * bq - dot(oc, oc) + br * br;
  float t = 1e9;
  float mat = 0.0;
  // One loop, one call of the scene's distance field: the march, then the four normal taps, the
  // soft shadow toward the key and the two occlusion taps all reuse the same map() call site — a
  // software GPU compiles the (large) field once instead of once per use.
  vec3 Lk = normalize(uKeyDir);
  vec3 pw = vec3(0.0), n = vec3(0.0, 0.0, 1.0), nAcc = vec3(0.0);
  float sAcc = 0.0, cvRaw = 0.0;
  float sh = 1.0, ao = 1.0;
  float sres = 1.0, st = 0.0, sph = 1e10, occ = 0.0;
  int phase = disc > 0.0 ? 0 : 9;
  int sub = 0;
  float t0 = -bq - sqrt(max(disc, 0.0));
  float t1 = -bq + sqrt(max(disc, 0.0));
  float tt = max(t0, 0.0);
  int steps = uLite > 0.5 ? 90 : 160;
  const float NE = 0.0007;
  for (int i = ZERO; i < 240; i++) {
    if (phase > 3) break;
    vec3 k4 = 0.5773 * (2.0 * vec3(float(((sub + 3) >> 1) & 1), float((sub >> 1) & 1), float(sub & 1)) - 1.0);
    vec3 q = phase == 0 ? ro + rd * tt
      : phase == 1 ? pw + k4 * NE
      : phase == 2 ? pw + n * 0.0012 + Lk * st
      : pw + n * (sub == 0 ? 0.006 : 0.022);
    vec2 h = map(q);
    if (phase == 0) {
      if (h.x < 0.00004 * tt) { t = tt; mat = h.y; pw = ro + rd * t; phase = 1; sub = 0; }
      else { tt += h.x * 0.85; if (tt > t1 || i >= steps) phase = 9; }
    } else if (phase == 1) {
      nAcc += k4 * h.x; sAcc += h.x; sub++;
      if (sub == 4) {
        n = normalize(nAcc);
        cvRaw = sAcc / (4.0 * NE);
        phase = DBG(1) ? 3 : 2; sub = 0;
        st = 0.008 + 0.003 * h12(gl_FragCoord.xy);
      }
    } else if (phase == 2) {
      float hh = h.x;
      float y = min(hh * hh / (2.0 * sph), hh * 0.98);
      float dd = sqrt(max(hh * hh - y * y, 0.0));
      // (a wide penumbra: the nose throws a soft form shadow, never a knife edge)
      sres = min(sres, 4.2 * dd / max(0.0001, st - y));
      sph = hh;
      st += clamp(hh, 0.004, 0.05);
      sub++;
      if (sres < 0.004 || st > 0.3 || sub >= 20) {
        float r = sat(sres);
        sh = r * r * (3.0 - 2.0 * r);
        phase = DBG(2) ? 9 : 3; sub = 0;
      }
    } else {
      float ah = sub == 0 ? 0.006 : 0.022;
      occ += (ah - h.x) * (sub == 0 ? 1.0 : 0.6);
      sub++;
      if (sub == 2) { ao = sat(1.0 - occ * 9.0); phase = 9; }
    }
  }
  vec3 col;
  float detail = 0.0;
  if (t > 1e8) {
    col = backdrop(uv);
    oColor = vec4(col, 0.0);
    oInfo = vec4(0.0, 0.5, 0.5, 0.0);
    return;
  }
  if (DBG(8)) { oColor = vec4(vec3(t - 1.5), 0.0); oInfo = vec4(0.0); return; }
  gCurv = cvRaw;
  vec3 n0 = n;
  vec3 ph = headLocal(pw);
  vec3 pb = bodyLocal(pw);
  vec3 v = -rd;
  // ---- lights (world): warm key high at the left, cool fill low right, moonlit rim behind right
  vec3 Lf = normalize(vec3(0.75 * uSide, -0.05, 0.65));
  vec3 Lr = normalize(vec3(0.85 * uSide, 0.35, -0.55));
  vec3 Ck = vec3(1.0, 0.86, 0.68) * uLightK.x; // torchlight, as on the board
  vec3 Cf = vec3(0.34, 0.37, 0.5) * uLightK.y;
  vec3 Cr = vec3(0.55, 0.72, 1.0) * uLightK.z;
  vec3 Csky = vec3(0.16, 0.17, 0.22) * uLightK.w;
  if (uMode > 0.5) {
    // clay study: neutral albedo, same light
    if (DBG(16384)) { oColor = vec4((n * 0.5 + 0.5) * 0.4, 0.0); oInfo = vec4(0.0); return; }
    if (DBG(8192)) { oColor = vec4(vec3(sh) * 0.5, 0.0); oInfo = vec4(0.0); return; }
    float dif = sat(dot(n, Lk)) * sh;
    col = vec3(0.6) * (Ck * dif + Cf * sat(dot(n, Lf)) * ao + Csky * ao * (0.5 + 0.5 * n.y)) + Cr * pow(sat(dot(n, Lr)), 2.0) * 0.4;
    oColor = vec4(col * 0.5, 0.0);
    oInfo = vec4(0.2, 0.5, 0.5, 0.0);
    return;
  }
  float nk = dot(n, Lk);
  float fres = pow(1.0 - sat(dot(n, v)), 4.0);
  vec3 alb = vec3(0.5);
  float rough = 0.6;
  float specK = 0.04;
  float sss = 0.0;
  float aniso = 0.0;
  vec3 tang = vec3(0.0, 1.0, 0.0);
  float sparkle = 0.0;
  float metal = 0.0;
  if (mat < 1.5) {
    skin(ph);
    alb = skinAlbedo(ph);
    // the collar's contact shadow on the neck
    if (ph.y < -0.07) { float bpart; float bdist = bodyField(bodyLocal(pw), bpart) * uHeadScale * BODYK; ao *= mix(0.35, 1.0, smoothstep(0.0, 0.03, bdist)); }
    sss = 1.0;
    // oily zones take a sharper sheen: nose ridge and tip, mid-forehead, cheekbone tops, lower lip
    vec3 aq = vec3(abs(ph.x), ph.y, ph.z);
    float oily = exp(-pow(aq.x / 0.008, 2.0)) * sat((ph.y - TIPY() + 0.004) / 0.01) * sat((0.016 - ph.y) / 0.01) * sat((ph.z - 0.085) / 0.01);
    oily += exp(-pow(length((aq.xy - vec2(0.012, 0.05)) / vec2(0.03, 0.02)), 2.0)) * 0.6;
    oily += exp(-pow(length((aq.xy - vec2(0.04, -0.012)) / vec2(0.012, 0.007)), 2.0)) * 0.7;
    oily += exp(-pow(length((ph.xy - vec2(0.004, MOUTHY() - 0.007)) / vec2(0.009, 0.0035)), 2.0)) * 0.8;
    oily = sat(oily);
    rough = mix(0.48, 0.22, oily);
    specK = 0.03 + 0.15 * oily;
    // a crisp edge where the lids meet the eye; lash line
    vec2 ll = lidLines(aq);
    float edx = (aq.x - EX() + 0.0012) / (0.0146 * sqrt(EYE));
    float inEye = sat((1.0 - abs(edx)) * 6.0) * sat((ph.z - EZ()) / 0.004);
    float lash = exp(-pow((aq.y - ll.x - 0.0006 - 0.0003 * FEM) / (0.0016 + 0.0007 * FEM), 2.0)) * inEye;
    float lowLash = exp(-pow((aq.y - ll.y + 0.0004) / 0.0006, 2.0)) * inEye * 0.4;
    alb = mix(alb, uHairC * 0.15 + vec3(0.012, 0.008, 0.008), sat(lash * 1.2 + lowLash) * 0.95);
    detail = 0.25 + 0.7 * smoothstep(1.0, 0.3, length((vec2(abs(ph.x), ph.y) - vec2(EX(), -0.002)) / vec2(0.022, 0.016)));
    detail = max(detail, 0.95 * smoothstep(1.0, 0.4, length((ph.xy - vec2(0.0, MOUTHY())) / vec2(0.026, 0.012))));
    // the nose tip and wings keep their drawing too
    detail = max(detail, 0.7 * smoothstep(1.0, 0.4, length((ph.xy - vec2(0.0, TIPY())) / vec2(0.016, 0.012))));
  } else if (mat < 2.5) {
    float iris;
    alb = eyeAlbedo(ph, iris);
    rough = 0.08;
    specK = 0.06;
    detail = 1.0;
  } else if (mat < 4.5) {
    // hair and beard: clumped strands, darker in the clefts, Kajiya-Kay highlights along the flow
    vec3 hc = uHairC;
    vec3 cc = ph - vec3(0.0, 0.03, -0.01);
    bool hang = mat > 3.5 || ph.y < -0.02;
    vec2 fc = hang ? vec2(atan(ph.x, ph.z + 0.03) * 150.0, ph.y * 22.0) : vec2(atan(cc.x, length(cc.yz)) * 170.0, atan(cc.z, cc.y) * 4.0);
    if (hang) fallClumps(ph, mat > 3.5 ? 16.0 : 9.0, 0.003, 0.0); else clumps(ph, 22.0, 0.002);
    float lock = gLockId;
    float strand = vnoise2(fc + vec2(0.0, lock * 7.0));
    float fine = vnoise2(fc * vec2(2.7, 1.2) + 7.0);
    float tone = (0.5 + 0.7 * strand) * (0.66 + 0.7 * lock);
    // pale hair (flaxen, silver, snow) varies less in value: dark clumps on it read as dirt
    tone = mix(tone, 0.85 + 0.25 * strand, sat(dot(hc, vec3(0.3, 0.59, 0.11)) * 2.2 - 0.25));
    // painters lift the darkest hair so the locks still read in it
    vec3 hcl = hc + vec3(0.022, 0.014, 0.008) * (1.0 - sat(dot(hc, vec3(0.33)) * 4.0));
    alb = hcl * tone * (0.85 + 0.25 * fine);
    // a few lighter, sun-bleached strands; darker toward the roots
    alb = mix(alb, hc * 1.35 + 0.015, 0.22 * smoothstep(0.62, 0.92, fine) * lock);
    if (!hang) alb *= 0.8 + 0.2 * sat((ph.y - 0.02) / 0.08);
    aniso = 1.0;
    rough = 0.35;
    // hair carries a real sheen: a bright band across the locks where they turn to the light
    specK = 0.12;
    vec3 flowL = hang ? normalize(vec3(0.0, -1.0, mat > 3.5 ? 0.2 : -0.1)) : normalize(vec3(0.0, cc.z, -cc.y));
    tang = normalize(transpose(uHeadR) * flowL);
    ao *= 0.75 + 0.25 * strand;
    detail = 0.25;
  } else if (mat < 5.5) {
    hoodField(ph);
    // wool: a fine weave, the lining inside the opening darker and warmer
    alb = uCloth * 0.85 * (0.9 + 0.16 * fbm3(ph * vec3(40.0, 120.0, 40.0)));
    alb = mix(alb, uCloth * vec3(0.45, 0.4, 0.38), gHoodIn * 0.8);
    rough = 0.9;
  } else if (mat < 7.5) {
    alb = mat > 6.5 ? vec3(0.55, 0.42, 0.25) : vec3(0.36, 0.37, 0.4);
    rough = mat > 6.5 ? 0.3 : 0.22 + 0.15 * fbm3(ph * 60.0);
    metal = 1.0;
    alb *= 0.8 + 0.3 * fbm3(ph * 90.0);
  } else if (mat < 8.5) {
    alb = vec3(0.42, 0.43, 0.46);
    rough = 0.45;
    metal = 1.0;
    sparkle = 1.0;
  } else {
    float part = mat - 10.0;
    int body = uBody;
    if (part > 3.5 && part < 4.5) {
      alb = vec3(0.85, 0.62, 0.26);
      metal = 1.0;
      rough = 0.25;
    } else if (part > 1.5 && part < 2.5) {
      alb = uCloth * 0.75 * (0.88 + 0.18 * fbm3(pb * vec3(14.0, 6.0, 14.0)));
      rough = 0.85;
    } else if (part > 4.5 && part < 5.5) {
      alb = vec3(0.2, 0.15, 0.1) * (0.5 + 0.7 * vnoise(pb * vec3(300.0, 120.0, 300.0)));
      rough = 0.9;
      aniso = 0.4;
    } else if (part > 5.5) {
      alb = uCloth * 0.5;
      rough = 0.85;
    } else if (part > 2.5) {
      alb = vec3(0.52, 0.53, 0.56) * (0.8 + 0.3 * fbm3(pb * 60.0));
      metal = 1.0;
      rough = 0.22 + 0.15 * fbm3(pb * 40.0);
    } else if (body == 0) {
      alb = vec3(0.52, 0.53, 0.56) * (0.8 + 0.3 * fbm3(pb * 60.0));
      metal = 1.0;
      rough = 0.2 + 0.15 * fbm3(pb * 40.0);
    } else if (body == 1 || body == 5) {
      if (part > 0.5) {
        alb = uCloth * (0.86 + 0.16 * fbm3(pb * vec3(16.0, 7.0, 16.0)));
        rough = 0.9;
      } else {
        alb = vec3(0.34, 0.35, 0.38);
        metal = 1.0;
        rough = 0.42;
        sparkle = 1.0;
      }
    } else if (body == 2) {
      alb = vec3(0.62, 0.5, 0.3);
      metal = 1.0;
      rough = 0.35;
      sparkle = 0.6;
    } else if (body == 3 || body == 6) {
      alb = (part > 0.5 ? vec3(0.07, 0.045, 0.028) : vec3(0.13, 0.075, 0.04)) * (0.78 + 0.4 * fbm3(pb * 28.0)) * (1.0 - 0.25 * smoothstep(0.7, 0.9, vnoise(pb * vec3(40.0, 160.0, 40.0))));
      rough = 0.62;
      specK = 0.05;
    } else {
      alb = (part > 0.5 ? uTrim : uCloth) * (0.86 + 0.2 * fbm3(pb * vec3(16.0, 7.0, 16.0)));
      rough = 0.88;
    }
  }
  if (DBG(65536)) { oColor = vec4(vec3(gLipMask, mat < 1.5 ? 0.3 : 0.0, 0.0), 1.0); oInfo = vec4(0.0); return; }
  if (DBG(32768)) { oColor = vec4(alb * 0.9, 1.0); oInfo = vec4(0.0); return; }
  // ---- mail rings / overlapping scales: a bump on the normal and a darkened weave
  if (sparkle > 0.0) {
    vec3 bp = mat < 8.5 ? ph : pb;
    bool scales = mat > 9.5 && uBody == 2;
    vec2 cell = scales ? vec2(bp.x * 75.0 + bp.z * 30.0, bp.y * 62.0) : vec2((bp.x + bp.z * 0.45) * 150.0, bp.y * 170.0);
    float row = floor(cell.y);
    vec2 f = fract(cell + vec2(0.5 * mod(row, 2.0), 0.0)) - 0.5;
    if (scales) {
      float sd = length((f - vec2(0.0, 0.18)) * vec2(1.0, 0.75));
      float edge = smoothstep(0.38, 0.5, sd);
      n = normalize(n + transpose(uBodyR) * vec3(f.x * 0.5, -0.6 + f.y * 0.4, 0.0) * 0.6);
      alb *= (0.65 + 0.45 * (0.5 - f.y)) * (1.0 - 0.6 * edge) * (0.85 + 0.3 * h13(vec3(floor(cell + vec2(0.5 * mod(row, 2.0), 0.0)), 1.0)));
    } else {
      float ring = abs(length(f * vec2(1.0, 1.2)) - 0.32);
      float rr = smoothstep(0.17, 0.02, ring);
      n = normalize(n + (mat < 8.5 ? transpose(uHeadR) : transpose(uBodyR)) * vec3(f.x, f.y, 0.0) * 0.9 * rr);
      alb *= 0.5 + 0.6 * rr;
    }
  }
  // ---- lighting
  vec3 hdir = normalize(Lk + v);
  float nh = sat(dot(n, hdir));
  float vh = sat(dot(v, hdir));
  // the key is a spot on the face: the costume falls away into the dark (the face is the light)
  float spot = mix(0.3, 1.0, exp(-dot(pw - uSpot.xyz, pw - uSpot.xyz) / uSpot.w));
  Ck *= spot;
  vec3 dif;
  float halfT = 0.0, coreS = 0.0, litF = 1.0;
  if (sss > 0.5) {
    // skin: wrapped diffuse with a per-channel wrap (red light travels further under the skin, so
    // the terminator is soft and warm, never a hard planar edge), the cast shadows softened the same
    // way (their penumbra red), and a broad half-tone between the light and the shadow.
    vec3 wr = vec3(0.22, 0.1, 0.07);
    vec3 dw = clamp((vec3(nk) + wr) / (1.0 + wr), 0.0, 1.0);
    float shS = smoothstep(0.0, 0.85, sh);
    vec3 shC = pow(vec3(mix(0.16, 1.0, shS)), vec3(0.55, 1.0, 1.25));
    dif = dw * shC;
    litF = dw.g * shS;
    halfT = exp(-pow((nk - 0.1) / 0.24, 2.0)) * shS;
    coreS = 0.0;
  } else {
    dif = vec3(sat(nk) * sh);
  }
  float gloss = 2.0 / max(rough * rough, 0.01);
  float spec = pow(nh, gloss) * (gloss + 8.0) / 25.0;
  if (aniso > 0.5) {
    // Kajiya-Kay: a white primary shifted toward the tip, a tinted secondary toward the root
    float t1 = dot(normalize(tang + n * 0.12), hdir);
    float t2 = dot(normalize(tang - n * 0.18), hdir);
    spec = pow(sqrt(max(0.0, 1.0 - t1 * t1)), 70.0) * 0.8;
    spec += pow(sqrt(max(0.0, 1.0 - t2 * t2)), 16.0) * 0.22;
  }
  // ambient: a cool fill from the right, the sky above, warm light bounced up from the chest
  vec3 Cb = vec3(0.42, 0.26, 0.16) * 0.2 * uLightK.w;
  vec3 amb = Cf * sat(0.2 + 0.8 * dot(n, Lf)) * ao + Csky * ao * (0.25 + 0.75 * sat(n.y * 0.5 + 0.5)) + Cb * ao * sat(-n.y * 0.6 + 0.3);
  // the shadow side of a face is a shadow: the fill only lifts it, so the head models in two
  // masses (light and shade) as a painter blocks it, never an evenly lit mask
  if (sss > 0.5) amb *= 0.62;
  // skin scatters the light it gets: its shadows stay warm-blooded, never the blue-grey of stone;
  // the core shadow takes less of the fill, and warm light bounced off the shoulder and collar
  // lifts the far side of the shadow (reflected light), never as bright as the half-tone
  if (sss > 0.5) {
    amb *= vec3(1.08, 1.0, 0.95);
    vec3 Lb = normalize(vec3(0.55 * uSide, -0.55, 0.45));
    amb += vec3(0.5, 0.32, 0.22) * 0.14 * uLightK.w * sat(dot(n, Lb) * 0.5 + 0.5) * (1.0 - litF) * ao;
  }
  vec3 diffuse = Ck * dif + amb;
  if (DBG(131072)) { oColor = vec4(Ck * dif * alb, 1.0); oInfo = vec4(0.0); return; }
  if (DBG(262144)) { oColor = vec4(amb * alb, 1.0); oInfo = vec4(0.0); return; }
  if (metal > 0.5) {
    // metal: mostly what it reflects — the warm key's softbox, the dark studio, a cool sky
    vec3 r = reflect(rd, n);
    vec3 env = mix(vec3(0.02, 0.017, 0.015), vec3(0.1, 0.11, 0.14), smoothstep(-0.2, 0.9, r.y)) * (0.6 + 0.8 * vnoise(r * 4.0 + 2.0));
    env += vec3(1.0, 0.82, 0.62) * 1.3 * pow(sat(dot(r, Lk)), 3.0 / max(rough * rough * 0.5, 0.004)) * sh * spot;
    env += vec3(0.5, 0.62, 0.9) * 0.35 * pow(sat(dot(r, Lr)), 6.0);
    float fr = 0.65 + 0.35 * fres;
    col = alb * diffuse * 0.12 + env * alb * 1.05 * fr * (0.45 + 0.55 * ao);
  } else {
    vec3 specC = sss > 0.5 ? vec3(1.0, 0.9, 0.82) : (aniso > 0.5 ? mix(vec3(0.9, 0.85, 0.78), uHairC * 2.5 + 0.02, 0.55) : vec3(1.0));
    float F = sss > 0.5 ? 0.35 + 0.65 * pow(1.0 - vh, 5.0) * 4.0 : 1.0;
    col = alb * diffuse;
    col += specC * Ck * spec * specK * F * sh * (0.4 + 0.6 * ao);
  }
  // rim: the moon behind the shoulder
  float rim = pow(sat(dot(n, Lr)), 2.5) * (0.15 + 0.85 * fres);
  col += Cr * alb * rim * (sss > 0.5 ? 0.6 : 1.0) * ao + Cr * rim * fres * 0.04;
  if (sss > 0.5) {
    // reflected light warms the underside of the jaw; the ears glow red where light passes through
    col += alb * vec3(0.5, 0.25, 0.15) * 0.18 * sat(-n.y) * ao;
    float earT = sat(1.0 - gEar / 0.004) * (pow(sat(dot(-n, Lk) + 0.3), 2.0) * Ck.r * 0.25 + rim * 0.8 + 0.15);
    col += alb * vec3(0.9, 0.22, 0.12) * earT * 0.35;
    // thin skin over the nose tip and cheekbones flushes in the light
    col += alb * vec3(0.3, 0.06, 0.03) * dif.r * Ck.r * 0.08;
    // subsurface: a saturated red-orange band where the light turns into shadow (soft terminator)

    // the shadow side cooler and greyer (the fill and sky, not the key, light it); the half-tone
    // a greyed, slightly cool passage between the warm light and the warm shadow
    float shade = sat(1.0 - dif.g * 1.6);
    float lumC = dot(col, vec3(0.3, 0.59, 0.11));
    // the lips keep their red in the shadow (a painter never lets the mouth go out in the shade:
    // the whole mouth stays centred under the nose, not only its lit half)
    float lipKeep = mat < 1.5 ? gLipMask : 0.0;
    col = mix(col, vec3(lumC) * vec3(0.86, 0.93, 1.1), shade * 0.22 * (1.0 - lipKeep));
    col += alb * vec3(0.16, 0.035, 0.035) * lipKeep * (1.0 - litF) * ao;
    col = mix(col, vec3(lumC) * vec3(0.93, 0.97, 1.04), halfT * 0.3);
  }
  // eye catch-light: the key's window and a soft reflection of the room
  if (mat > 1.5 && mat < 2.5) col += vec3(1.0, 0.95, 0.9) * (pow(nh, 900.0) * 9.0 * max(sh, 0.5) + pow(nh, 60.0) * 0.18) + vec3(0.5, 0.6, 0.8) * 0.05 * fres;
  // mail glints
  if (sparkle > 0.0) col += Ck * 0.3 * pow(nh, 24.0) * sh * step(0.9, h13(floor(pw * 1100.0)));
  // the painter's accents: creases darkened, ridges caught by the light
  float cv = DBG(4) ? 0.0 : cvRaw * 0.55;
  float cav = sat(-cv * 1.6);
  float ridge = sat(cv * 2.0);
  col *= 1.0 - cav * (sss > 0.5 ? 0.22 : 0.45);
  col += alb * Ck * ridge * 0.06 * sh;
  // atmospheric: the bust falls into the shadowy backdrop toward the bottom
  float fall = sat((0.25 - uv.y) / 0.25);
  col = mix(col, backdrop(uv) * 0.8, fall * 0.55);
  // G-buffer for the oil painter: region, stroke direction on screen, key light
  vec3 cr = uCamR[0], cu = uCamR[1];
  float region = mat < 1.5 ? 1.0 : mat < 2.5 ? 2.0 : mat < 4.5 ? 3.0 : (metal > 0.5 ? 5.0 : 4.0);
  vec3 strokeW = normalize(cross(n0, -rd));
  if (aniso > 0.5 && mat < 4.5) strokeW = tang;
  else if (region > 3.5 && region < 4.5) {
    // drapery: brushed along the fall of the cloth
    vec3 down = vec3(0.0, -1.0, 0.0);
    vec3 tg = down - n0 * dot(down, n0);
    if (length(tg) > 0.2) strokeW = normalize(tg);
  }
  vec2 sd = vec2(dot(strokeW, cr), -dot(strokeW, cu));
  sd = length(sd) > 1e-4 ? normalize(sd) : vec2(1.0, 0.0);
  oColor = vec4(col, detail);
  oInfo = vec4(region / 5.0, sd * 0.5 + 0.5, sat(nk) * sh);
}
`;

export const GLSL_POST = /* glsl */`
vec3 aces(vec3 c) { return (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); }
// Filmic on luminance (the hue and saturation of a lit cheek survive), blended with the
// per-channel curve so the brightest lights still roll off toward white.
vec3 tone(vec3 c) {
  c *= 1.05;
  float L = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  float Lt = aces(vec3(L)).x;
  vec3 a = c * (Lt / L);
  vec3 b = aces(c);
  c = mix(a, b, 0.75);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
float sat(float x) { return clamp(x, 0.0, 1.0); }
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
void main() {
  // the render is supersampled: a 2x2 box resolves it
  vec2 px = 0.5 / uRes;
  vec4 s0 = texture2D(tSrc, vUv + vec2(-px.x, -px.y) * 0.5);
  vec4 s1 = texture2D(tSrc, vUv + vec2(px.x, -px.y) * 0.5);
  vec4 s2 = texture2D(tSrc, vUv + vec2(-px.x, px.y) * 0.5);
  vec4 s3 = texture2D(tSrc, vUv + vec2(px.x, px.y) * 0.5);
  vec3 col = (tone(s0.rgb) + tone(s1.rgb) + tone(s2.rgb) + tone(s3.rgb)) * 0.25;
  float detail = max(max(s0.a, s1.a), max(s2.a, s3.a));
  if (uMode > 0.5) { gl_FragColor = vec4(col, 1.0); return; }
  // glaze: warm the lights, cool the darks a little
  float L = lum(col);
  col = mix(col, col * vec3(1.04, 1.0, 0.94), sat(L * 1.5));
  col = mix(col, col * vec3(0.94, 0.98, 1.06), sat(1.0 - L * 3.0) * 0.6);
  // vignette
  vec2 c = vUv - vec2(0.5, 0.52);
  col *= 1.0 - 0.32 * sat(dot(c, c) * 2.4);
  gl_FragColor = vec4(col, detail);
}
`;
