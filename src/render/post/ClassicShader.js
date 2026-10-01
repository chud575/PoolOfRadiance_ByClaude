import { EGA16, hexToRgb } from '../palette.js';

const pal = EGA16.map((h) => hexToRgb(h).map((v) => (v / 255).toFixed(4)).join(', '));

/**
 * "Classic mode" (1988) post effect: pixelate to a virtual 320x200 grid and
 * posterise each cell to the 16-colour EGA palette the way EGA artists drew:
 * flat regions of one colour, with a 2x2 checkerboard between the two nearest
 * colours ONLY where a cell sits near the boundary between them (gradients,
 * edges). Each cell averages four taps first, so sub-cell noise (grain, fine
 * texture) can't turn into speckle. Faint scanlines; no curvature by default,
 * so the frame stays a clean rectangle. Toggle with F2 or ?classic=1.
 */
export const ClassicShader = {
  name: 'ClassicShader',
  uniforms: {
    tDiffuse: { value: null },
    uVirtual: { value: [320, 200] },
    uDither: { value: 0.6 },
    uEdge: { value: 0.455 },
    uScanline: { value: 0.12 },
    uCurve: { value: 0.0 },
    uStrength: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uVirtual;
    uniform float uDither, uEdge, uScanline, uCurve, uStrength;
    varying vec2 vUv;
    const vec3 PAL[16] = vec3[16](${pal.map((p) => `vec3(${p})`).join(', ')});
    float dist(vec3 c, vec3 p) {
      vec3 d = c - p;
      // 'redmean'-style perceptual distance (hue matters, not only brightness)
      float rm = 0.5 * (c.r + p.r);
      float e = (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b;
      // greys only win when the source is genuinely neutral
      float grey = step(abs(p.r - p.b) + abs(p.g - p.b), 0.01) * step(0.01, p.r) * step(p.r, 0.9);
      float chroma = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
      return e + grey * chroma * 0.3;
    }
    void main() {
      vec2 uv = vUv - 0.5;
      uv *= 1.0 + uCurve * dot(uv, uv) * 4.0;
      uv += 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec2 cell = floor(uv * uVirtual);
      vec2 px = 1.0 / uVirtual;
      vec2 c0 = (cell + 0.5) * px;
      vec3 src = 0.25 * (
        texture2D(tDiffuse, c0 + px * vec2(-0.25, -0.25)).rgb + texture2D(tDiffuse, c0 + px * vec2(0.25, -0.25)).rgb +
        texture2D(tDiffuse, c0 + px * vec2(-0.25, 0.25)).rgb + texture2D(tDiffuse, c0 + px * vec2(0.25, 0.25)).rgb);
      // EGA art was drawn in saturated primaries: push chroma + midtone contrast
      // before matching so dusk hues land on blues/cyans/browns, not a grey ramp.
      float luma = dot(src, vec3(0.299, 0.587, 0.114));
      // EGA has no violet: dusk mauves read as the blues of the period art
      src.r -= 0.6 * max(0.0, min(src.r, src.b) - src.g);
      src = mix(src, src * vec3(0.55, 0.72, 1.3), smoothstep(0.0, 0.07, src.b - src.g) * smoothstep(0.85, 0.3, luma));
      src = clamp(mix(vec3(luma), src, 1.4), 0.0, 1.0);
      src = clamp((src - 0.5) * 1.12 + 0.5 + 0.02, 0.0, 1.0);
      float b1 = 1e9, b2 = 1e9; vec3 q1 = PAL[0], q2 = PAL[0];
      for (int i = 0; i < 16; i++) {
        float e = dist(src, PAL[i]);
        if (e < b1) { b2 = b1; q2 = q1; b1 = e; q1 = PAL[i]; }
        else if (e < b2) { b2 = e; q2 = PAL[i]; }
      }
      // ambiguity: 0 = exactly the nearest colour, 0.5 = halfway to the second.
      // Flat fill unless the cell is genuinely between two colours; there,
      // a 2x2 checkerboard (the classic 50% EGA dither).
      float amb = sqrt(b1) / max(sqrt(b1) + sqrt(b2), 1e-5);
      float checker = mod(cell.x + cell.y, 2.0);
      vec3 q = (amb > uEdge && uDither > 0.0 && checker > 0.5) ? q2 : q1;
      float scan = 1.0 - uScanline * (0.5 + 0.5 * cos(fract(uv.y * uVirtual.y) * 6.2831));
      vec3 outc = mix(texture2D(tDiffuse, vUv).rgb, q * scan, uStrength);
      gl_FragColor = vec4(outc, 1.0);
    }
  `,
};
