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
  float tuft = 0.0016 * sin(p.x * 150.0 + 1.3) + 0.0009 * sin(p.x * 330.0 + p.y * 60.0);
  float front = (0.021 + tuft - 2.4 * p.x * p.x + 0.006 * FEM - 0.012 * AGE * (1.0 - FEM)) - (-0.62 * p.y + 0.78 * p.z - 0.05);
  float burn = max(0.0, 1.0 - abs(ax - 0.067) / 0.012) * max(0.0, 1.0 - abs(p.z - 0.018) / 0.018) * 0.045;
  float side = (-0.012 + burn + tuft * 0.6 - (-p.y + 0.62 * p.z)) / 1.18;
  float nape = p.y + 0.062 + 0.02 * ax / 0.07;
  return min(min(front, side), nape);
}
// Clumped strands combed back from the hairline over the crown: noise long along the flow,
// tight across it, so the clumps are irregular (never a comb of identical grooves).
float clumps(vec3 p, float freq, float amp) {
  vec3 c = p - vec3(0.0, 0.03, -0.01);
  float lat = atan(c.x, length(c.yz)) * freq;
  float lon = atan(c.z, c.y);
  float n1 = vnoise2(vec2(lat + 0.6 * sin(lon * 3.0), lon * 2.2));
  float n2 = vnoise2(vec2(lat * 2.3 + 5.0, lon * 4.5 + 1.7));
  float lump = vnoise(p * 45.0 + 2.0);
  return amp * ((n1 - 0.5) * 1.5 + (n2 - 0.5) * 0.7 + (lump - 0.5) * 1.2);
}
// Hanging hair: clumps long down the fall, tight around the head.
float fallClumps(vec3 p, float freq, float amp, float wav) {
  float a = atan(p.x, p.z + 0.03) * freq;
  float y = p.y;
  float n1 = vnoise2(vec2(a + wav * sin(y * 40.0) * 1.5, y * 9.0));
  float n2 = vnoise2(vec2(a * 2.2 + 3.0, y * 18.0));
  return amp * ((n1 - 0.5) * 1.6 + (n2 - 0.5) * 0.7);
}
float gHairFlow;
float hairField(vec3 p, float sk) {
  if (uHood == 1) return 1e3;
  bool longish = uHair == 4 || uHair == 5 || uHair == 7;
  if (uHelm == 1 && !longish) return 1e3;
  float vol = HVOL;
  float d;
  if (uHair == 0) {
    float band = sat((0.03 - p.y) / 0.022) * sat((p.y + 0.05) / 0.012) * sat((0.02 - p.z) / 0.03);
    d = sk - 0.0045 * band + clumps(p, 26.0, 0.001) * band + 0.002 * (1.0 - band);
  } else {
    float hl = hairline(p);
    float m = sat(hl / 0.009);
    m = m * m * (3.0 - 2.0 * m);
    float top = sat((p.y + 0.01) / 0.11);
    float T = (0.005 + 0.011 * vol * top) * m;
    if (uHair == 2) T = 0.0042 * m;
    if (uHair == 3) T *= 0.75 + 1.1 * top * sat((p.z + 0.04) / 0.1);
    if (uHair == 9 || uHair == 8 || uHair == 7) T = (0.0045 + 0.004 * top) * m;
    d = sk - T + 0.0018 * (1.0 - m);
    if (abs(d) < 0.012) d += clumps(p, uHair == 2 ? 40.0 : 22.0, uHair == 2 ? 0.0012 : 0.0028) * m;
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
      e = max(e, -0.6 * p.y + 0.8 * p.z - 0.05);
      float a = atan(p.x, p.z);
      e += fallClumps(p, 12.0, 0.003, 0.0);
      d = smin(d, e, 0.01);
    }
    if (uHair == 7) {
      vec3 bp = p - vec3(0.083 * W, -0.055, 0.0);
      float s = clamp(-bp.y / 0.26, 0.0, 1.0);
      vec3 c = vec3(0.01 * s, 0.0, 0.055 * min(1.0, s * 1.6));
      float phb = bp.y * 72.0;
      vec3 off = vec3(sin(phb) * 0.005, 0.0, cos(phb) * 0.003);
      float br = length((bp - c - off).xz) - (0.018 - s * 0.006);
      br = max(br, bp.y - 0.06);
      br = max(br, -(bp.y + 0.26));
      d = smin(d, br + 0.0016 * abs(sin(phb * 0.5)), 0.012);
      d = smin(d, sdEll(p - vec3(0.0, -0.025, -0.078), vec3(0.058, 0.058, 0.044)) + clumps(p, 20.0, 0.002), 0.02);
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
  float mo = sat((th - abs(p.y - cy)) / 0.0018) * sat((1.0 - u) / 0.12) * sat((p.z - 0.068) / 0.01);
  float m = uBeard >= 2 ? mo : 0.0;
  if (uBeard >= 3) {
    float chin = sat((mY - 0.009 - p.y) / 0.004);
    float lipHole = sat((length(vec2(q.x / 0.024, (p.y - mY) / 0.0115)) - 1.0) / 0.25);
    float region;
    if (uBeard == 3) region = chin * sat((0.025 - q.x) / 0.008) * sat((p.z - 0.04) / 0.02);
    else {
      float bTop = -0.006 - 0.5 * max(p.z, 0.0);
      region = sat((bTop - p.y) / 0.006) * sat((p.y + 0.16) / 0.01) * lipHole * sat((p.z + 0.03) / 0.02);
    }
    m = max(m, region);
  }
  return m;
}
float beardField(vec3 p, float sk) {
  if (uBeard < 2) return 1e3;
  float m = beardMask(p);
  float T = uBeard == 2 ? 0.0055 : uBeard == 3 ? 0.007 : 0.009 * BLEN;
  float d = sk - T * m + 0.002 * (1.0 - m);
  if (m > 0.0 && abs(d) < 0.008) d += fallClumps(p, 34.0, 0.0024, 0.4) * m;
  if (uBeard == 3) d = smin(d, sdRC(p, vec3(0.0, -0.11, 0.072), vec3(0.0, -0.15, 0.077), 0.016, 0.006) + fallClumps(p, 20.0, 0.0015, 0.3), 0.012);
  if (uBeard >= 5) {
    float dw = uBeard == 6 ? 1.0 : 0.0;
    vec3 q = vec3(abs(p.x), p.y, p.z);
    float e = sdEll(p - vec3(0.0, -0.145, 0.06), vec3(0.046 + 0.012 * dw, 0.066 + 0.006 * dw, 0.03 + 0.006 * dw));
    e = smin(e, dw > 0.5 ? sdRC(q, vec3(0.02, -0.165, 0.068), vec3(0.026, -0.26, 0.078), 0.028, 0.011) : sdRC(p, vec3(0.0, -0.175, 0.062), vec3(0.0, -0.25, 0.072), 0.028, 0.01), 0.03);
    e += fallClumps(p, 16.0, 0.0035, 0.5);
    d = smin(d, e, 0.02);
  }
  return d;
}

// ------------------------------------------------------------------ hood / helm
float hoodField(vec3 p) {
  if (uHood == 0) return 1e3;
  float a = atan(p.x, -p.z);
  float fold = 0.0045 * sin(a * 7.0 + p.y * 20.0) + 0.0018 * sin(a * 15.0 - p.y * 31.0);
  float sh = abs(sdEll(p - vec3(0.0, 0.03, -0.012), vec3(0.1, 0.13, 0.124))) - 0.007 + fold;
  sh = smax(sh, -sdEll(p - vec3(0.0, -0.02, 0.112), vec3(0.074 * W, 0.11, 0.1)), 0.014);
  sh = smax(sh, -sdEll(p - vec3(0.0, -0.17, -0.02), vec3(0.2, 0.08, 0.2)), 0.02);
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
  vec3 nq = p - vec3(0.0, 0.006, 0.107);
  float nasal = max(max(abs(nq.x) - 0.006 - 0.004 * sat(nq.y / 0.02), abs(nq.y + 0.004) - 0.026), abs(nq.z - 0.004 + 0.3 * nq.y) - 0.0035);
  float ridge = sdCap(p, vec3(0.0, 0.142, 0.04), vec3(0.0, 0.11, -0.1), 0.006);
  gHelmPart = band < bowl - 0.0005 ? 1.0 : 0.0;
  float d = min(min(bowl, band), min(nasal, ridge));
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
  bool longHair = uHair == 4 || uHair == 5 || uHair == 7;
  bool longBeard = uBeard >= 5;
  // bounds: the head proper, then the long hair / beard below it
  float bnd = sdEll(p - vec3(0.0, 0.0, -0.005), vec3(0.122, 0.15, 0.142));
  if (longHair) bnd = min(bnd, sdEll(p - vec3(0.0, -0.1, -0.04), vec3(0.13, 0.22, 0.12)));
  if (longBeard) bnd = min(bnd, sdEll(p - vec3(0.0, -0.17, 0.05), vec3(0.08, 0.13, 0.07)));
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
      if (bd < res) { res = bd; mat = 4.0; }
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
  if (b.y < -0.06 && !MDBG(16)) {
    float bb = sdEll(b - vec3(0.0, -0.43, -0.01), vec3(0.34, 0.38, 0.21));
    if (bb < 0.015) {
      float part;
      float bd = bodyField(b, part) * hs * BODYK;
      if (bd < res) { res = bd; mat = 10.0 + part; }
    } else res = min(res, bb * hs * BODYK);
  } else res = min(res, (b.y + 0.06) * hs * BODYK + 0.003);
  return vec2(res, mat);
}
float mapD(vec3 p) { return map(p).x; }
`;

export const GLSL_SHADE = /* glsl */`
#define DBG(b) (mod(floor(uDbg / float(b)), 2.0) > 0.5)
#define ZERO (min(int(uRes.x), 0))
float gCurv;
// Normal from tetrahedral taps; the same taps give the surface curvature (gCurv: < 0 in creases —
// nostrils, lid folds, mouth corners — and > 0 on ridges).
vec3 calcNormal(vec3 p, float e) {
  vec3 n = vec3(0.0);
  float s = 0.0;
  for (int i = ZERO; i < 4; i++) {
    vec3 k = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    float h = mapD(p + k * e);
    n += k * h;
    s += h;
  }
  gCurv = s / (4.0 * e);
  return normalize(n);
}
float softShadow(vec3 ro, vec3 rd, float jit) {
  float res = 1.0;
  float t = 0.008 + 0.003 * jit;
  float ph = 1e10;
  for (int i = ZERO; i < 20; i++) {
    float h = mapD(ro + rd * t);
    float y = min(h * h / (2.0 * ph), h * 0.98);
    float d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, 7.0 * d / max(0.0001, t - y));
    ph = h;
    t += clamp(h, 0.004, 0.05);
    if (res < 0.004 || t > 0.3) break;
  }
  res = sat(res);
  return res * res * (3.0 - 2.0 * res);
}
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  for (int i = ZERO; i < 2; i++) {
    float h = i == 0 ? 0.006 : 0.022;
    occ += (h - mapD(p + n * h)) * (i == 0 ? 1.0 : 0.6);
  }
  return sat(1.0 - occ * 9.0);
}

// The painter's complexion: golden forehead, red cheeks/nose/ears, blue-grey jaw, violet sockets.
vec3 skinAlbedo(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 base = mix(uSkin, vec3(dot(uSkin, vec3(0.3, 0.59, 0.11))), 0.18) * 0.8;
  float ex = EX();
  vec3 ruddy = base * vec3(1.14, 0.84, 0.8);
  vec3 warm = base * vec3(1.1, 1.04, 0.8);
  vec3 cool = base * vec3(0.8, 0.9, 1.06);
  float cheek = exp(-pow(length((q.xy - vec2(0.044, -0.028)) / vec2(0.024, 0.02)), 2.0));
  float noseZ = exp(-pow(length((p.xy - vec2(0.0, TIPY())) / vec2(0.012, 0.013)), 2.0)) * sat((p.z - 0.088) / 0.01);
  float earZ = sat((q.x - 0.064 * W) / 0.008);
  float brow = sat((p.y - 0.03) / 0.03) * sat(p.z / 0.06);
  float jaw = sat((-0.058 - p.y) / 0.03) * sat((p.z + 0.01) / 0.04) * (1.0 - FEM);
  vec3 c = base;
  c = mix(c, warm, brow * 0.8);
  c = mix(c, ruddy, sat(cheek * (0.7 + 0.25 * FEM) + noseZ * 0.6 + earZ * 0.7));
  float mY = MOUTHY();
  float muzzle = exp(-pow(length((p.xy - vec2(0.0, mY)) / vec2(0.03, 0.02)), 2.0)) * sat((p.z - 0.06) / 0.02) * (1.0 - FEM);
  c = mix(c, cool, sat(jaw * (uBeard == 1 ? 0.85 : 0.55) + muzzle * 0.4 + sat((-0.08 - p.y) / 0.03) * 0.2));
  if (uBeard == 1) c *= 1.0 - (jaw + muzzle * 0.6) * 0.16 * (0.6 + 0.4 * vnoise(p * 900.0));
  // sockets: a violet-brown glaze; upper-lid crease darker
  float sock = exp(-pow(length((q.xy - vec2(ex, 0.003)) / vec2(0.021, 0.014)), 2.0)) * sat((p.z - 0.045) / 0.02);
  c = mix(c, base * vec3(0.7, 0.56, 0.62), sock * 0.45);
  float crease = exp(-pow(length((q.xy - vec2(ex, 0.0115 - 0.003 * LID)) / vec2(0.015, 0.0042)), 2.0)) * sat((p.z - 0.06) / 0.02);
  c = mix(c, base * vec3(0.5, 0.4, 0.42), crease * 0.4);
  // a little colour on the lids of women (umber-violet)
  c = mix(c, base * vec3(0.62, 0.45, 0.5), exp(-pow(length((q.xy - vec2(ex + 0.002, 0.007)) / vec2(0.016, 0.006)), 2.0)) * sat((p.z - 0.06) / 0.02) * FEM * 0.45);
  // lips
  float lip = exp(-pow(length((p.xy - vec2(0.0, mY - 0.0005)) / vec2(0.0185 * MOUTH, 0.0088 * LIPS)), 4.0)) * sat((p.z - 0.07) / 0.006);
  vec3 lipC = mix(base * vec3(0.95, 0.58, 0.58), base * vec3(1.0, 0.42, 0.48), FEM * 0.9);
  c = mix(c, lipC, lip * (0.75 + 0.2 * FEM));
  {
    float mcx = q.x / (0.021 * MOUTH);
    float mcurve = SMILE * 0.0032 * mcx * mcx + SMIRK * 0.0024 * sat(p.x / 0.02) * mcx;
    float slit = exp(-pow((p.y - mY - mcurve) / 0.0011, 2.0)) * smoothstep(0.021 * MOUTH, 0.013 * MOUTH, q.x) * sat((p.z - 0.07) / 0.006);
    c = mix(c, base * vec3(0.35, 0.18, 0.17), slit * 0.75);
  }
  // mottling
  c *= 0.97 + 0.06 * fbm3(p * 60.0 + uSeed * 10.0);
  c *= 1.0 - AGE * 0.1 * smoothstep(0.62, 0.8, vnoise(p * 300.0 + 3.0));
  // hair roots darken the skin just below the hairline
  if (uHood == 0 && uHelm == 0 && uHair != 0) {
    float hl = hairline(p);
    float roots = sat(1.0 - (-hl) / 0.008) * sat(p.y / 0.02 + 0.6);
    c = mix(c, uHairC * 0.9, roots * 0.5 * (0.6 + 0.4 * vnoise(p * 700.0)));
  }
  // brows painted as hair strokes
  {
    float u = (q.x - ex * 0.92) / 0.022;
    float arch = 0.0175 + (0.0032 + 0.0025 * FEM) * (1.0 - u * u) + 0.0022 * BTILT * u - 0.002 * SCOWL + 0.001 * FEM;
    float thick = 0.0048 * BTHICK * (1.0 - 0.5 * sat(u)) * (0.75 + 0.25 * BROW);
    float bb = smoothstep(0.0, 1.0, 1.0 - abs(q.y - arch - 0.0016 * (1.0 - u)) / thick);
    bb *= sat((1.15 - abs(u)) * 3.0) * sat((q.z - 0.055) / 0.01) * sat((q.x - 0.007) / 0.005);
    float hairs = 0.8 + 0.2 * sin(q.x * 2400.0 + q.y * 1600.0 * sign(u) + vnoise(p * 500.0) * 3.0);
    c = mix(c, mix(uHairC * 0.8, c * 0.55, 0.25), sat(bb * hairs) * 0.85);
  }
  // character lines: nasolabial, forehead, crow's feet, tear trough
  {
    float L = LINES;
    vec3 creaseC = base * vec3(0.6, 0.48, 0.48);
    float tipY = TIPY();
    float nl = sdCap(vec3(q.xy, 0.0), vec3(0.0175 * NWIDTH, tipY - 0.002, 0.0), vec3(0.0265 * MOUTH, mY - 0.01, 0.0), 0.0);
    float nlz = sat((p.z - 0.055) / 0.015);
    c = mix(c, creaseC, exp(-pow(nl / (0.0035 + 0.0015 * L), 2.0)) * nlz * (0.08 + 0.3 * L));
    float fy = (p.y - 0.038 + 0.0015 * sin(p.x * 70.0 + uSeed)) / 0.0095;
    float fl = exp(-pow((fract(fy) - 0.5) / 0.11, 2.0)) * step(0.0, fy) * step(fy, 3.0);
    c = mix(c, creaseC, fl * sat(1.0 - abs(p.x) / 0.04) * sat((p.z - 0.05) / 0.02) * sat(L - 0.45) * 0.35 * (1.0 - 0.6 * FEM));
    vec2 oc = q.xy - vec2(ex + 0.0128, 0.0);
    float ca = atan(oc.y, oc.x);
    float cr = length(oc);
    float fan = pow(abs(sin(ca * 7.0)), 10.0) * sat(1.0 - abs(ca) / 0.9) * smoothstep(0.002, 0.004, cr) * sat((0.014 - cr) / 0.006);
    c = mix(c, creaseC, fan * sat(L - 0.55) * 0.35);
    vec2 ub = q.xy - vec2(ex - 0.001, -0.0102);
    float tear = exp(-pow(ub.y / 0.0035, 2.0)) * sat(1.0 - abs(ub.x) / 0.014) * sat((p.z - 0.062) / 0.01);
    c = mix(c, creaseC, tear * (0.05 + 0.2 * L));
  }
  if (uScar == 1) {
    float sd = sdCap(p, vec3(-0.012, 0.03, 0.09), vec3(-0.05, -0.035, 0.07), 0.0016);
    c = mix(c, base * vec3(1.15, 0.76, 0.78), sat(1.0 - abs(sd) / 0.0018) * 0.8);
  }
  return c;
}

// Eye: sclera never pure white, iris with a limbal ring and radial fibres, pupil.
vec3 eyeAlbedo(vec3 p, out float iris) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  vec3 ec = vec3(EX(), 0.0, EZ());
  vec3 v = normalize(q - ec);
  // gaze toward the viewer (uGaze is in head space; mirrored for the far eye)
  vec3 g = normalize(vec3(uGaze.x * sign(p.x + 1e-5), uGaze.y, uGaze.z));
  float ang = acos(clamp(dot(v, g), -1.0, 1.0));
  float ir = 0.52;
  float pr = 0.2;
  iris = smoothstep(ir + 0.035, ir - 0.035, ang);
  vec3 scl = vec3(0.5, 0.45, 0.41) * mix(vec3(1.0), vec3(0.95, 0.72, 0.68), smoothstep(0.75, 1.35, ang));
  float a = atan(v.y, v.x);
  float fib = 0.7 + 0.3 * sin(a * 38.0 + vnoise(vec3(a * 6.0, ang * 20.0, 1.0)) * 4.0);
  vec3 ic = uEyeC * fib * mix(1.5, 0.75, smoothstep(pr, ir, ang));
  ic = mix(ic, uEyeC * 0.22, smoothstep(ir - 0.13, ir, ang));
  ic = mix(vec3(0.012), ic, smoothstep(pr - 0.025, pr + 0.025, ang));
  vec3 c = mix(scl, ic, iris);
  // the upper lid and lashes shade the top of the eyeball
  vec2 ll = lidLines(q);
  c *= mix(0.35, 1.0, smoothstep(0.0008, 0.0055, ll.x - q.y));
  c *= mix(0.7, 1.0, smoothstep(0.0, 0.003, q.y - ll.y));
  return c;
}

// ------------------------------------------------------------------ backdrop
vec3 backdrop(vec2 uv) {
  vec2 c = uv - vec2(0.5, 0.55);
  // directional brush sweeps whose angle wanders across the canvas
  float ang = 0.75 + 0.6 * (vnoise2(uv * 2.0 + uSeed * 7.0) - 0.5);
  vec2 r = rot2(ang) * (uv * vec2(uRes.x / uRes.y, 1.0));
  float s1 = vnoise2(vec2(r.x * 5.0, r.y * 38.0) + uSeed * 13.0);
  float s2 = vnoise2(vec2(r.x * 11.0, r.y * 80.0) + 3.0);
  float big = vnoise2(uv * 3.0 + uSeed * 3.0);
  // light behind the head on the shadow side (the painter's counterchange)
  float halo = exp(-dot((uv - vec2(0.64, 0.62)) * vec2(1.4, 1.0), (uv - vec2(0.64, 0.62)) * vec2(1.4, 1.0)) * 5.0);
  vec3 col = mix(uBgA, uBgB, sat(halo * 1.1 + (big - 0.5) * 0.5 + (s1 - 0.5) * 0.35));
  col *= 0.75 + 0.35 * s1 + 0.12 * (s2 - 0.5);
  col *= 1.0 - 0.55 * sat(length(c * vec2(1.0, 0.8)) * 1.3 - 0.25);
  return col * 0.9;
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
  if (disc > 0.0) {
    float t0 = -bq - sqrt(disc);
    float t1 = -bq + sqrt(disc);
    float tt = max(t0, 0.0);
    int steps = uLite > 0.5 ? 90 : 160;
    for (int i = ZERO; i < 200; i++) {
      if (i >= steps) break;
      vec2 h = map(ro + rd * tt);
      if (h.x < 0.00004 * tt) { t = tt; mat = h.y; break; }
      tt += h.x * 0.85;
      if (tt > t1) break;
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
  vec3 pw = ro + rd * t;
  if (DBG(8)) { oColor = vec4(vec3(t - 1.5), 0.0); oInfo = vec4(0.0); return; }
  vec3 n = calcNormal(pw, 0.0007);
  float cvRaw = gCurv;
  vec3 n0 = n;
  vec3 ph = headLocal(pw);
  vec3 pb = bodyLocal(pw);
  vec3 v = -rd;
  // ---- lights (world): warm key high at the left, cool fill low right, moonlit rim behind right
  vec3 Lk = normalize(uKeyDir);
  vec3 Lf = normalize(vec3(0.75, -0.05, 0.65));
  vec3 Lr = normalize(vec3(0.85, 0.35, -0.55));
  vec3 Ck = vec3(1.0, 0.89, 0.76) * uLightK.x;
  vec3 Cf = vec3(0.34, 0.37, 0.5) * uLightK.y;
  vec3 Cr = vec3(0.55, 0.72, 1.0) * uLightK.z;
  vec3 Csky = vec3(0.16, 0.17, 0.22) * uLightK.w;
  float sh = DBG(1) ? 1.0 : softShadow(pw + n * 0.0012, Lk, h12(gl_FragCoord.xy));
  float ao = DBG(2) ? 1.0 : calcAO(pw, n);
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
    alb = skinAlbedo(ph);
    sss = 1.0;
    // oily zones take a sharper sheen: nose ridge and tip, mid-forehead, cheekbone tops, lower lip
    vec3 aq = vec3(abs(ph.x), ph.y, ph.z);
    float oily = exp(-pow(aq.x / 0.008, 2.0)) * sat((ph.y - TIPY() + 0.004) / 0.01) * sat((0.016 - ph.y) / 0.01) * sat((ph.z - 0.085) / 0.01);
    oily += exp(-pow(length((aq.xy - vec2(0.012, 0.05)) / vec2(0.03, 0.02)), 2.0)) * 0.6;
    oily += exp(-pow(length((aq.xy - vec2(0.04, -0.012)) / vec2(0.012, 0.007)), 2.0)) * 0.7;
    oily += exp(-pow(length((ph.xy - vec2(0.004, MOUTHY() - 0.007)) / vec2(0.009, 0.0035)), 2.0)) * 0.8;
    oily = sat(oily);
    rough = mix(0.5, 0.27, oily);
    specK = 0.025 + 0.075 * oily;
    // a crisp edge where the lids meet the eye; lash line
    vec2 ll = lidLines(aq);
    float edx = (aq.x - EX() + 0.0012) / (0.0146 * sqrt(EYE));
    float inEye = sat((1.0 - abs(edx)) * 6.0) * sat((ph.z - EZ()) / 0.004);
    float lash = exp(-pow((aq.y - ll.x - 0.0006 - 0.0003 * FEM) / (0.0009 + 0.0005 * FEM), 2.0)) * inEye;
    float lowLash = exp(-pow((aq.y - ll.y + 0.0004) / 0.0006, 2.0)) * inEye * 0.4;
    alb = mix(alb, uHairC * 0.2 + vec3(0.015, 0.01, 0.01), sat(lash + lowLash) * 0.9);
    detail = 0.25 + 0.7 * smoothstep(1.0, 0.3, length((vec2(abs(ph.x), ph.y) - vec2(EX(), -0.002)) / vec2(0.022, 0.016)));
    detail = max(detail, 0.6 * smoothstep(1.0, 0.4, length((ph.xy - vec2(0.0, MOUTHY())) / vec2(0.025, 0.01))));
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
    vec2 fc = hang ? vec2(atan(ph.x, ph.z + 0.03) * 70.0, ph.y * 30.0) : vec2(atan(cc.x, length(cc.yz)) * 80.0, atan(cc.z, cc.y) * 5.0);
    float strand = vnoise2(fc);
    float fine = vnoise2(fc * vec2(3.1, 1.3) + 7.0);
    float tone = 0.55 + 0.55 * strand;
    alb = hc * tone * (0.82 + 0.3 * fine);
    // greying, sun-bleached tips
    alb = mix(alb, hc * 1.25 + 0.02, 0.15 * smoothstep(0.6, 0.9, fine));
    aniso = 1.0;
    rough = 0.35;
    vec3 flowL = hang ? normalize(vec3(0.0, -1.0, mat > 3.5 ? 0.2 : -0.1)) : normalize(vec3(0.0, cc.z, -cc.y));
    tang = normalize(transpose(uHeadR) * flowL);
    ao *= 0.75 + 0.25 * strand;
    detail = 0.25;
  } else if (mat < 5.5) {
    alb = uCloth * 0.85;
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
      alb = uCloth * 0.75 * (0.9 + 0.2 * vnoise(pb * 80.0));
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
        alb = uCloth * (0.85 + 0.15 * vnoise(pb * 200.0));
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
      alb = (part > 0.5 ? vec3(0.07, 0.045, 0.028) : vec3(0.12, 0.07, 0.038)) * (0.75 + 0.5 * fbm3(pb * 120.0));
      rough = 0.62;
      specK = 0.05;
    } else {
      alb = (part > 0.5 ? uTrim : uCloth) * (0.88 + 0.2 * vnoise(pb * 150.0));
      rough = 0.88;
    }
  }
  // ---- mail rings / overlapping scales: a bump on the normal and a darkened weave
  if (sparkle > 0.0) {
    vec3 bp = mat < 8.5 ? ph : pb;
    bool scales = mat > 9.5 && uBody == 2;
    vec2 cell = scales ? vec2(bp.x * 75.0 + bp.z * 30.0, bp.y * 62.0) : vec2((bp.x + bp.z * 0.45) * 105.0, bp.y * 120.0);
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
      alb *= 0.35 + 0.8 * rr;
    }
  }
  // ---- lighting
  vec3 dif;
  if (sss > 0.5) {
    // skin: per-channel wrap (red light bleeds round the terminator), red-tinted shadow edge
    vec3 wrap = vec3(0.3, 0.19, 0.15);
    dif = clamp((vec3(nk) + wrap) / (1.0 + wrap), 0.0, 1.0);
    dif *= dif;
    vec3 sh3 = vec3(pow(sh, 0.65), pow(sh, 0.95), pow(sh, 1.1));
    dif *= sh3;
    // the painter's planes: light, half-tone and shadow gathered into soft-edged steps
    vec3 st = dif * 3.0;
    vec3 band = (floor(st) + smoothstep(0.3, 0.7, fract(st))) / 3.0;
    dif = mix(dif, band, 0.45);
  } else {
    dif = vec3(sat(nk) * sh);
  }
  vec3 hdir = normalize(Lk + v);
  float nh = sat(dot(n, hdir));
  float gloss = 2.0 / max(rough * rough, 0.01);
  float spec = pow(nh, gloss) * (gloss + 8.0) / 25.0;
  if (aniso > 0.5) {
    // Kajiya-Kay: a white primary shifted toward the tip, a tinted secondary toward the root
    float t1 = dot(normalize(tang + n * 0.12), hdir);
    float t2 = dot(normalize(tang - n * 0.18), hdir);
    spec = pow(sqrt(max(0.0, 1.0 - t1 * t1)), 80.0) * 0.5;
    spec += pow(sqrt(max(0.0, 1.0 - t2 * t2)), 16.0) * 0.22;
  }
  // the key is a spot on the face: the costume falls away into the dark (the face is the light)
  float spot = mix(0.38, 1.0, exp(-dot(pw - uSpot.xyz, pw - uSpot.xyz) / uSpot.w));
  Ck *= spot;
  vec3 diffuse = Ck * dif + Cf * (0.55 + 0.45 * dot(n, Lf)) * ao + Csky * ao * (0.4 + 0.6 * sat(n.y * 0.5 + 0.5));
  if (metal > 0.5) {
    // metal: mostly what it reflects — the warm key's softbox, the dark studio, a cool sky
    vec3 r = reflect(rd, n);
    vec3 env = mix(vec3(0.02, 0.017, 0.015), vec3(0.12, 0.13, 0.16), smoothstep(-0.2, 0.9, r.y)) * (0.6 + 0.8 * vnoise(r * 4.0 + 2.0));
    env += vec3(1.0, 0.82, 0.62) * 1.7 * pow(sat(dot(r, Lk)), 3.0 / max(rough * rough * 0.5, 0.004)) * sh;
    env += vec3(0.5, 0.65, 1.0) * 0.9 * pow(sat(dot(r, Lr)), 6.0);
    float fr = 0.65 + 0.35 * fres;
    col = alb * diffuse * 0.12 + env * alb * 1.05 * fr * (0.45 + 0.55 * ao);
  } else {
    vec3 specC = sss > 0.5 ? vec3(1.0, 0.92, 0.85) : (aniso > 0.5 ? mix(vec3(1.0), uHairC * 3.0, 0.4) : vec3(1.0));
    col = alb * diffuse;
    col += specC * Ck * spec * specK * sh * (0.4 + 0.6 * ao);
  }
  // rim: the moon behind the shoulder
  float rim = pow(sat(dot(n, Lr)), 1.5) * (0.35 + 0.65 * fres);
  col += Cr * alb * rim * 1.2 * ao + Cr * rim * fres * 0.05;
  // reflected light warms the underside of the jaw and the neck
  if (sss > 0.5) col += alb * vec3(0.5, 0.25, 0.15) * 0.22 * sat(-n.y) * ao;
  // eye catch-light
  if (mat > 1.5 && mat < 2.5) col += vec3(1.0, 0.95, 0.9) * (pow(nh, 700.0) * 7.0 * sh + pow(nh, 60.0) * 0.25);
  // mail glints
  if (sparkle > 0.0) col += Ck * 0.35 * pow(nh, 24.0) * sh * step(0.9, h13(floor(pw * 1100.0)));
  // the painter's accents: creases darkened, ridges caught by the light
  float cv = DBG(4) ? 0.0 : cvRaw * 0.55;
  float cav = sat(-cv * 1.6);
  float ridge = sat(cv * 2.0);
  col *= 1.0 - cav * (sss > 0.5 ? 0.55 : 0.45);
  col += alb * Ck * ridge * 0.08 * sh;
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
vec3 tone(vec3 c) {
  c *= 1.05;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
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
