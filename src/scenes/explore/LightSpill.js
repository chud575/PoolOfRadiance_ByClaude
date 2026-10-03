import * as THREE from 'three';

/**
 * Lamplight spilling from lit openings (windows, doorways) onto nearby surfaces.
 * Each quad carries the light's origin, its emission axis and the receiving surface's normal;
 * the fragment shader evaluates a small area light (cosine lobe out of the opening × Lambert at the
 * receiver ÷ distance², with a soft core so it never hot-spots) and MULTIPLIES the frame
 * already drawn beneath by (1 + E). The pool therefore inherits the surface's own albedo and
 * relief — dark joints stay dark, stone crowns catch it — instead of a flat additive sticker.
 *
 * @param {{q: THREE.Vector3[], origin: THREE.Vector3, dir: THREE.Vector3, n: THREE.Vector3, k?: number}[]} quads
 * @param {{color?: number, gain?: number, fogColor?: THREE.Color, fogDensity?: number}} o
 */
export function buildLightSpill(quads, o = {}) {
  if (!quads.length) return null;
  const pos = [];
  const org = [];
  const dir = [];
  const nrm = [];
  const kk = [];
  const uv = [];
  const idx = [];
  for (const s of quads) {
    const b = pos.length / 3;
    for (const [i, p] of s.q.entries()) {
      uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      pos.push(p.x, p.y, p.z);
      org.push(s.origin.x, s.origin.y, s.origin.z);
      dir.push(s.dir.x, s.dir.y, s.dir.z);
      nrm.push(s.n.x, s.n.y, s.n.z);
      kk.push(s.k ?? 1);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aOrg', new THREE.Float32BufferAttribute(org, 3));
  geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  geo.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCol: { value: new THREE.Color(o.color ?? 0xffa458) },
      uGain: { value: o.gain ?? 1 },
      uFogDensity: { value: o.fogDensity ?? 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrg; attribute vec3 aDir; attribute vec3 aN; attribute float aK;
      varying vec3 vWp; varying vec3 vOrg; varying vec3 vDir; varying vec3 vN; varying float vK; varying vec2 vUv;
      void main(){
        vUv = uv; vWp = (modelMatrix * vec4(position, 1.0)).xyz; vOrg = aOrg; vDir = aDir; vN = aN; vK = aK;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uGain; uniform float uFogDensity;
      varying vec3 vWp; varying vec3 vOrg; varying vec3 vDir; varying vec3 vN; varying float vK; varying vec2 vUv;
      void main(){
        vec3 L = vOrg - vWp;
        float d2 = dot(L, L);
        vec3 l = L * inversesqrt(max(d2, 1e-4));
        // emitted through the opening (a broad cosine lobe), received with Lambert
        // (a zero axis = an isotropic glow: light bounced off a sill/reveal onto the wall around it)
        float lobe = dot(vDir, vDir) < 0.25 ? 1.0 : pow(max(dot(vDir, -l), 0.0), 1.3);
        float lam = max(dot(normalize(vN), l), 0.0);
        // soft-cored inverse square (an area source, never a hot point), faded to zero at the quad edge
        float E = lobe * lam / (d2 + 0.55);
        vec2 eu = min(vUv, 1.0 - vUv);
        E *= smoothstep(0.0, 0.22, eu.x) * smoothstep(0.0, 0.22, eu.y);
        float fd = length(vWp - cameraPosition);
        float fog = exp(-uFogDensity * uFogDensity * fd * fd);
        gl_FragColor = vec4(uCol * E * vK * uGain * fog, 1.0);
      }`,
    // result = dst * src + dst  →  dst × (1 + E): lights what is there, keeps its relief
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.OneFactor,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  mesh.userData.ownMaterial = true;
  mesh.userData.dispose = () => {
    geo.dispose();
    mat.dispose();
  };
  return mesh;
}
