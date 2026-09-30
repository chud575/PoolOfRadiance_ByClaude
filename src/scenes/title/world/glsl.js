/**
 * Shared GLSL chunks for the title world: hashes/noise and the dusk sky
 * function (used by the sky dome AND the sea reflection, so they match).
 */
export const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; }
  return s;
}
float fbm3(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(3.1, 1.3); a *= .5; }
  return s;
}
`;

/** vec3 duskSky(vec3 dir, vec3 sunDir, float time, float cloudAmt) — linear HDR. */
export const DUSK_SKY = /* glsl */ `
${NOISE}
vec3 duskSky(vec3 d, vec3 sd, float t, float cloudAmt) {
  float h = d.y;
  float hh = max(h, 0.0);
  vec2 dh = normalize(d.xz + 1e-5);
  vec2 sh = normalize(sd.xz + 1e-5);
  float az = max(dot(dh, sh), 0.0);
  float az3 = az * az * az;
  float sunDot = max(dot(d, sd), 0.0);

  vec3 zenith = vec3(0.018, 0.022, 0.075);
  vec3 upper = vec3(0.07, 0.06, 0.19);
  vec3 mid = vec3(0.2, 0.08, 0.18);
  vec3 low = vec3(0.62, 0.22, 0.14);
  vec3 c = mix(low, mid, smoothstep(0.0, 0.10, hh));
  c = mix(c, upper, smoothstep(0.08, 0.32, hh));
  c = mix(c, zenith, smoothstep(0.28, 0.9, hh));
  // cooler, darker away from the sunset
  c = mix(c, c * vec3(0.45, 0.55, 1.05), (1.0 - az) * 0.75);
  // horizon glow toward the sun
  c += vec3(0.85, 0.36, 0.16) * exp(-hh * 20.0) * (0.15 + 0.85 * az3);
  c += vec3(0.8, 0.3, 0.2) * exp(-hh * 6.0) * az3 * 0.25;
  // sun halo + disc (half-set on the sea)
  c += vec3(1.3, 0.6, 0.26) * pow(sunDot, 90.0) * 0.8;
  c += vec3(0.7, 0.28, 0.16) * pow(sunDot, 6.0) * 0.18;
  c += vec3(5.0, 2.8, 1.3) * smoothstep(0.99955, 0.99975, sunDot);

  // clouds: long streaks lit from beneath by the set sun
  if (cloudAmt > 0.0 && h > 0.0) {
    vec2 uv = d.xz / (h + 0.06);
    float n = fbm(uv * vec2(0.16, 0.55) + vec2(t * 0.004, 0.0));
    float n2 = fbm3(uv * vec2(0.5, 1.6) - vec2(t * 0.007, 0.0));
    float dens = smoothstep(0.50 - cloudAmt * 0.18, 0.82, n * 0.75 + n2 * 0.4);
    dens *= smoothstep(0.012, 0.07, hh) * (1.0 - smoothstep(0.35, 0.7, hh));
    float lit = exp(-hh * 7.0) * (0.25 + 0.75 * az3);
    vec3 shade = vec3(0.09, 0.055, 0.12);
    vec3 glow = mix(vec3(0.5, 0.18, 0.24), vec3(1.5, 0.6, 0.26), az3);
    vec3 cc = mix(shade, glow, clamp(lit * (0.6 + 0.8 * n2), 0.0, 1.0));
    // silver lining near the sun
    cc += vec3(1.6, 0.8, 0.35) * pow(sunDot, 10.0) * (1.0 - dens) * 2.0;
    c = mix(c, cc, dens * 0.92);
  }
  // stars in the darker upper sky
  if (h > 0.08) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float r = hash13(cell);
    float star = step(0.9965, r);
    vec3 f = fract(sp) - 0.5;
    float core = exp(-dot(f, f) * 38.0);
    float tw = 0.65 + 0.35 * sin(t * (1.5 + r * 5.0) + r * 60.0);
    c += vec3(0.85, 0.9, 1.0) * star * core * tw * smoothstep(0.1, 0.45, h) * (1.0 - az * 0.6) * 2.2;
  }
  return c;
}
`;
