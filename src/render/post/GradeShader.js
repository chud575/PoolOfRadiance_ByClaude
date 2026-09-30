/**
 * Final colour-grade pass (display space, after OutputPass):
 * vignette, lift/gamma/gain, saturation, warm/cool split tone, subtle grain.
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uVignetteSoftness: { value: 0.55 },
    uSaturation: { value: 1.05 },
    uContrast: { value: 1.04 },
    uLift: { value: [0.0, 0.0, 0.01] },
    uGain: { value: [1.0, 1.0, 1.0] },
    uGrain: { value: 0.025 },
    uShadowTint: { value: [0.02, 0.03, 0.07] },
    uHighlightTint: { value: [0.05, 0.03, 0.0] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uVignetteSoftness, uSaturation, uContrast, uGrain;
    uniform vec3 uLift, uGain, uShadowTint, uHighlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighlightTint * smoothstep(0.5, 1.0, l);
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift * (1.0 - col);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.8, 0.8 - uVignetteSoftness, length(d * vec2(1.0, 0.85)) * 1.25);
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (hash(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};
