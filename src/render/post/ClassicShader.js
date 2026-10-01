import { EGA16, hexToRgb } from '../palette.js';

const pal = EGA16.map((h) => hexToRgb(h).map((v) => (v / 255).toFixed(4)).join(', '));

/**
 * "Classic mode" (1988) post effect: pixelate to a virtual 320x200 grid, quantise
 * to the 16-colour EGA palette with 4x4 ordered dithering, faint scanlines and
 * CRT curvature. Toggle with F2 or ?classic=1.
 */
export const ClassicShader = {
  name: 'ClassicShader',
  uniforms: {
    tDiffuse: { value: null },
    uVirtual: { value: [320, 200] },
    uDither: { value: 0.6 },
    uScanline: { value: 0.18 },
    uCurve: { value: 0.03 },
    uStrength: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uVirtual;
    uniform float uDither, uScanline, uCurve, uStrength;
    varying vec2 vUv;
    const vec3 PAL[16] = vec3[16](${pal.map((p) => `vec3(${p})`).join(', ')});
    float bayer(vec2 p) {
      int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
      int i = x + y * 4;
      int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      return float(m[i]) / 16.0 - 0.5;
    }
    void main() {
      vec2 uv = vUv - 0.5;
      uv *= 1.0 + uCurve * dot(uv, uv) * 4.0;
      uv += 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec2 cell = floor(uv * uVirtual);
      vec2 suv = (cell + 0.5) / uVirtual;
      vec3 src = texture2D(tDiffuse, suv).rgb;
      // EGA art was drawn in saturated primaries: push chroma + midtone contrast
      // before matching so dusk hues land on blues/cyans/browns, not a grey ramp.
      float luma = dot(src, vec3(0.299, 0.587, 0.114));
      src = clamp(mix(vec3(luma), src, 1.9), 0.0, 1.0);
      src = clamp((src - 0.5) * 1.15 + 0.5 + 0.04, 0.0, 1.0);
      vec3 c = src + bayer(cell) * uDither * 0.33;
      float best = 1e9; vec3 q = PAL[0];
      for (int i = 0; i < 16; i++) {
        vec3 d = c - PAL[i];
        // 'redmean'-style perceptual distance (hue matters, not only brightness)
        float rm = 0.5 * (c.r + PAL[i].r);
        float e = (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b;
        // greys only win when the source is genuinely neutral
        float grey = step(abs(PAL[i].r - PAL[i].b) + abs(PAL[i].g - PAL[i].b), 0.01) * step(0.01, PAL[i].r) * step(PAL[i].r, 0.9);
        float chroma = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
        e += grey * chroma * 0.35;
        if (e < best) { best = e; q = PAL[i]; }
      }
      float scan = 1.0 - uScanline * (0.5 + 0.5 * cos(fract(uv.y * uVirtual.y) * 6.2831));
      vec3 outc = mix(texture2D(tDiffuse, vUv).rgb, q * scan, uStrength);
      gl_FragColor = vec4(outc, 1.0);
    }
  `,
};
