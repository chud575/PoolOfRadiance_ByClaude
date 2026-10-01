import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createTorch, FLAME_UNIFORMS } from '../../../render/lighting.js';
import { NOISE } from './glsl.js';
import { prng, ni, worldUV, tint, merge } from './geom.js';
import { column as archColumn, entablature, addRimLight } from './arch.js';

export const TERRACE_TEXTURES = ['hd_crazy', 'hd_limestone', 'hd_rubble'];

/**
 * The old temple terrace above the city: flagstone floor with a broken edge,
 * the Pool of Radiance in its carved rim, its column of light, braziers,
 * ruined colonnade and rubble.
 */
export function createTerrace({ seed = 7 } = {}) {
  const R = prng(seed);
  const group = new THREE.Group();
  group.name = 'terrace';
  const disposables = [];
  const U = { uTime: { value: 0 } };

  const texMat = (name, extra = {}) => {
    const t = getTextureSet(name);
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, ...extra });
    disposables.push(m);
    return m;
  };
  const rimU = { uSunView: { value: new THREE.Vector3(0, 0, -1) }, uRimColor: { value: new THREE.Color(1.0, 0.55, 0.28) } };
  const stoneMat = addRimLight(texMat('hd_limestone', { vertexColors: true }), rimU, 1.1);
  const floorMat = texMat('hd_crazy', { vertexColors: true });
  // Second detail scale over the flagstones, in world space: broad grime and damp
  // blotches, moss creeping along the joints (where the stone texture is dark),
  // hairline cracks, and a polished, paler wear path where pilgrims walked to the
  // Pool. Breaks up the single-scale tiling cadence of the flag texture.
  floorMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 w = vWP.xz;
          float lum = dot(diffuseColor.rgb, vec3(0.333));
          float joint = 1.0 - smoothstep(0.1, 0.32, lum);           // dark mortar lines
          float big = fbm(w * 0.09);                                  // broad grime / damp
          float mid = fbm(w * 0.55 + 7.3);
          float fine = vnoise(w * 6.0);
          float r = length(w - vec2(0.0, 4.0));
          float path = (1.0 - smoothstep(1.4, 3.6, abs(w.x) - max(0.0, (w.y - 4.0)) * 0.05)) * step(3.2, w.y) * (1.0 - smoothstep(16.0, 26.0, w.y));
          float wear = max(path, 1.0 - smoothstep(4.5, 7.5, length(w)));
          float edge = smoothstep(-4.0, -8.5, w.y);                  // toward the broken edge
          float grime = smoothstep(0.42, 0.75, big) * 0.55 + edge * 0.35;
          float moss = clamp(joint * (0.35 + smoothstep(0.45, 0.7, mid) * 0.9) * (1.0 - wear * 0.8) + edge * smoothstep(0.5, 0.75, mid) * 0.5, 0.0, 1.0);
          // hairline cracks: thin ridges of a warped noise
          float cn = abs(vnoise(w * 1.3 + vec2(fbm(w * 0.7) * 2.0)) - 0.5);
          float crack = (1.0 - smoothstep(0.0, 0.018, cn)) * smoothstep(0.5, 0.62, mid) * (1.0 - joint);
          vec3 c = diffuseColor.rgb;
          c *= mix(1.0, 0.62, grime) * (0.9 + 0.2 * mid) * (0.94 + 0.12 * fine);
          c = mix(c, vec3(0.16, 0.2, 0.09) * (0.7 + 0.6 * fine), moss * 0.75);
          c = mix(c, c * 1.18 + 0.03, wear * (1.0 - joint) * 0.6);
          c *= 1.0 - crack * 0.55;
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - 0.25 * (1.0 - smoothstep(4.5, 7.5, length(vWP.xz))), 0.3, 1.0);`);
  };

  // ---- floor with a broken front edge -----------------------------------------
  {
    const s = new THREE.Shape();
    // shape Y = -world Z (rotateX(-90deg) maps shape y to world -z)
    s.moveTo(-60, -30);
    s.lineTo(60, -30);
    s.lineTo(60, 9);
    for (let x = 60; x >= -60; x -= 2.5) s.lineTo(x, 9 + (Math.abs(x) < 6 ? 0 : R.range(-1.2, 0.8)));
    s.closePath();
    const g = new THREE.ShapeGeometry(s, 1);
    g.rotateX(-Math.PI / 2);
    worldUV(g, 4.6);
    // vertex colours: darker, mossier toward the broken edge and the far sides
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) col.set([0.78, 0.74, 0.7], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const floor = new THREE.Mesh(g, floorMat);
    floor.receiveShadow = true;
    group.add(floor);
    disposables.push(g);
    // a thick lip so the edge reads as a slab
    const lip = new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: false });
    lip.rotateX(-Math.PI / 2);
    lip.translate(0, -1.22, 0);
    worldUV(lip, 3);
    tint(lip, 0x6a6258);
    const lm = new THREE.Mesh(lip, stoneMat);
    group.add(lm);
    disposables.push(lip);
  }

  // ---- the retaining walls of the temple acropolis (seen from the city) ----------
  {
    const parts = [];
    const top = -1.2, base = -15;
    const hgt = top - base;
    const wall = new THREE.BoxGeometry(124, hgt, 1.6);
    wall.translate(0, base + hgt / 2, -10.4);
    parts.push(tint(worldUV(wall, 3), 0x9a8f80, { aoBottom: base, aoTop: base + 5 }));
    for (const sx of [-1, 1]) {
      const side = new THREE.BoxGeometry(1.6, hgt, 42);
      side.translate(sx * 61.2, base + hgt / 2, 10);
      parts.push(tint(worldUV(side, 3), 0x958a7b, { aoBottom: base, aoTop: base + 5 }));
    }
    for (let x = -58; x <= 58; x += 9.5) {
      const b = new THREE.CylinderGeometry(0.9, 1.6, hgt - 0.6, 4, 1);
      b.rotateY(Math.PI / 4);
      b.scale(1.1, 1, 1.4);
      b.translate(x, base + (hgt - 0.6) / 2, -11.4);
      parts.push(tint(worldUV(ni(b), 3), 0x8e8475, { aoBottom: base, aoTop: base + 5 }));
    }
    // a grand processional stair climbing the wall's face to the terrace (centre)
    for (let k = 0; k < 28; k++) {
      const sy = base + k * (hgt / 28);
      const st = new THREE.BoxGeometry(9, hgt / 28 + 0.02, 0.7);
      st.translate(0, sy + hgt / 56, -11.6 - (27 - k) * 0.68);
      parts.push(tint(worldUV(st, 2), 0xa89c8a, { aoBottom: base, aoTop: base + 4 }));
    }
    for (const sx of [-1, 1]) {
      // stair cheek walls with a coping
      const cheek = new THREE.BoxGeometry(1.2, hgt, 19.6);
      cheek.translate(sx * 5.1, base + hgt / 2 - 0.4, -11.2 - 9.4);
      const p2 = cheek.attributes.position;
      for (let i = 0; i < p2.count; i++) {
        const zz = p2.getZ(i);
        if (p2.getY(i) > base + hgt / 2 - 0.4) p2.setY(i, base + (hgt + 0.6) * Math.min(1, Math.max(0.12, (zz + 30.2) / 19.6)));
      }
      cheek.computeVertexNormals();
      parts.push(tint(worldUV(ni(cheek), 3), 0x958a7b, { aoBottom: base, aoTop: base + 5 }));
    }
    // blind arcade niches between the buttresses
    for (let x = -53.25; x <= 53.25; x += 9.5) {
      if (Math.abs(x) < 7) continue;
      const niche = new THREE.BoxGeometry(4.2, hgt * 0.5, 0.5);
      niche.translate(x, base + hgt * 0.42, -11.0);
      parts.push(tint(worldUV(niche, 2), 0x6e665c));
      const arch = new THREE.CylinderGeometry(2.1, 2.1, 0.5, 16, 1, false, 0, Math.PI);
      arch.rotateX(Math.PI / 2);
      arch.rotateZ(Math.PI / 2);
      arch.rotateY(0);
      arch.translate(x, base + hgt * 0.67, -11.0);
      parts.push(tint(worldUV(ni(arch), 2), 0x6e665c));
    }
    // a string course of dentils under the lip
    for (let x = -61; x <= 61; x += 1.2) {
      const d = new THREE.BoxGeometry(0.6, 0.45, 0.5);
      d.translate(x, top - 0.55, -11.3);
      parts.push(tint(worldUV(d, 2), 0xa89d8c));
    }
    for (let i = 0; i < 60; i++) {
      const s = R.range(0.5, 1.8);
      const g = new THREE.IcosahedronGeometry(s, 0);
      g.scale(R.range(0.8, 1.5), 0.6, R.range(0.8, 1.3));
      g.translate(R.range(-60, 60), base + s * 0.25, -12 - R.range(0, 5));
      parts.push(tint(worldUV(ni(g), 2), 0x7d7468));
    }
    const g = merge(parts);
    const m = new THREE.Mesh(g, stoneMat);
    group.add(m);
    disposables.push(g);
  }

  // ---- the pool rim (lathe) ----------------------------------------------------
  const rimProfile = [
    [2.9, -0.7], [2.9, 0.18], [2.98, 0.34], [3.12, 0.44], [3.5, 0.5], [3.86, 0.46], [3.98, 0.36], [3.98, 0.1], [4.35, 0.08], [4.45, 0.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  {
    const g = new THREE.LatheGeometry(rimProfile, 96);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 14, uv.getY(i) * 1.2);
    tint(g, 0xcfc6b8);
    const rim = new THREE.Mesh(g, stoneMat);
    rim.castShadow = true;
    rim.receiveShadow = true;
    group.add(rim);
    disposables.push(g);
    // rune ring inlaid in the coping: glowing glyph band
    const band = new THREE.RingGeometry(3.28, 3.66, 128, 1);
    band.rotateX(-Math.PI / 2);
    band.translate(0, 0.505, 0);
    const bandMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: U,
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec3 vP;
        ${NOISE}
        void main(){
          float a = atan(vP.z, vP.x) / 6.2831853 + 0.5;
          float r = (length(vP.xz) - 3.28) / 0.38;
          float cell = floor(a * 72.0);
          vec2 f = vec2(fract(a * 72.0), r);
          // procedural glyph: a few strokes per cell
          float h1 = hash12(vec2(cell, 1.0)), h2 = hash12(vec2(cell, 2.0)), h3 = hash12(vec2(cell, 3.0));
          float g = 0.0;
          g += step(abs(f.x - (0.3 + h1 * 0.4)), 0.07) * step(0.22, f.y) * step(f.y, 0.78);
          g += step(abs(f.y - (0.3 + h2 * 0.4)), 0.06) * step(0.2, f.x) * step(f.x, 0.8) * step(0.35, h3);
          g += step(abs((f.x - 0.5) - (f.y - 0.5) * (h3 > 0.5 ? 1.0 : -1.0)), 0.07) * step(0.25, f.y) * step(f.y, 0.75) * step(h1, 0.6);
          g = clamp(g, 0.0, 1.0);
          float border = smoothstep(0.08, 0.0, abs(r - 0.06)) + smoothstep(0.08, 0.0, abs(r - 0.94));
          float pulse = 0.55 + 0.45 * sin(uTime * 1.3 - a * 18.849);
          vec3 c = vec3(0.15, 0.75, 1.0) * (g * (0.35 + 0.5 * pulse) + border * 0.3);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    disposables.push(band, bandMat);
    group.add(new THREE.Mesh(band, bandMat));
  }

  // ---- the radiant water ----------------------------------------------------------
  const waterMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy / 2.95; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vP;
      ${NOISE}
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float t = uTime;
        // swirling vortex coordinates
        float sw = a + (1.0 - r) * 3.2 - t * 0.35;
        vec2 q = vec2(cos(sw), sin(sw)) * r;
        float n = fbm(q * 3.0 + vec2(t * 0.1, 0.0));
        float n2 = fbm(q * 7.0 - vec2(0.0, t * 0.25) + n);
        // caustic web
        float c1 = abs(sin(n2 * 12.0 + t));
        float caustic = pow(1.0 - c1, 6.0);
        float rings = pow(0.5 + 0.5 * sin(r * 26.0 - t * 2.4), 10.0) * (1.0 - r);
        vec3 deep = vec3(0.02, 0.16, 0.26);
        vec3 mid = vec3(0.08, 0.55, 0.75);
        vec3 core = vec3(0.42, 0.95, 1.1);
        vec3 col = mix(core, mid, smoothstep(0.0, 0.45, r + (n - 0.5) * 0.25));
        col = mix(col, deep, smoothstep(0.55, 1.02, r));
        col += vec3(0.35, 1.0, 1.15) * caustic * (1.0 - r * 0.5) * 0.55;
        col += vec3(0.5, 1.2, 1.35) * rings * 0.35;
        // keep the vortex readable at the core: darker spiral lanes
        col *= 0.78 + 0.22 * smoothstep(0.2, 0.8, n2);
        col += vec3(0.1, 0.4, 0.5) * n2 * 0.6;
        // dark meniscus against the stone
        col *= 1.0 - smoothstep(0.93, 1.0, r) * 0.7;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.95, 96), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.12;
  group.add(water);
  disposables.push(water.geometry, waterMat);

  // ---- the column of radiance (volumetric-looking shells) -----------------------
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { ...U, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStrength; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float facing = abs(dot(normalize(vN), v));
        float y = vUv.y;
        float streak = fbm(vec2(vUv.x * 18.0, y * 3.0 - uTime * 0.6));
        float streak2 = vnoise(vec2(vUv.x * 44.0, y * 6.0 - uTime * 1.1));
        float body = pow(facing, 2.2) * (0.45 + 0.9 * streak * streak2);
        float fall = pow(1.0 - y, 3.4) * smoothstep(0.0, 0.03, y);
        vec3 c = mix(vec3(0.35, 1.25, 1.6), vec3(1.2, 1.9, 2.1), pow(1.0 - y, 6.0));
        gl_FragColor = vec4(c * body * fall * uStrength * 0.06, 1.0);
      }`,
  });
  disposables.push(beamMat);
  const beams = [];
  for (const [rb, rt, h, s] of [[2.7, 3.6, 34, 0.8], [1.4, 2.4, 28, 1.1], [0.55, 1.0, 22, 1.2]]) {
    const g = new THREE.CylinderGeometry(rt, rb, h, 48, 1, true);
    g.translate(0, h / 2 + 0.1, 0);
    const m = new THREE.Mesh(g, beamMat.clone());
    m.material.uniforms = { ...U, uStrength: { value: s } };
    m.userData.base = s;
    beams.push(m);
    disposables.push(g, m.material);
    m.renderOrder = 4;
    group.add(m);
  }
  // light spill decal on the flagstones
  {
    const g = new THREE.CircleGeometry(12, 64);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.02, 0);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `varying vec2 vP; void main(){ float r = length(vP); float k = exp(-max(r - 4.2, 0.0) * 0.45) * smoothstep(4.0, 4.6, r); gl_FragColor = vec4(vec3(0.05, 0.22, 0.28) * k, 1.0); }`,
    });
    disposables.push(g, m);
    group.add(new THREE.Mesh(g, m));
  }
  const poolLight = new THREE.PointLight(0x7fe8ff, 30, 34, 1.4);
  poolLight.position.set(0, 2.2, 0);
  group.add(poolLight);

  // ---- braziers --------------------------------------------------------------------
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.55, metalness: 0.85 });
  disposables.push(ironMat);
  const braziers = [];
  const hazes = [];
  const coalMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vP; ${NOISE}
      void main(){
        // a bed of coals: dark crusted lumps with white-hot seams that breathe
        float cells = vnoise(vP * 9.0);
        float seam = 1.0 - smoothstep(0.0, 0.18, abs(cells - 0.5));
        float breathe = 0.65 + 0.35 * sin(uTime * 2.3 + vnoise(vP * 3.0) * 6.0);
        float heat = clamp(seam * breathe + (1.0 - length(vP) / 0.7) * 0.35, 0.0, 1.0);
        vec3 c = mix(vec3(0.05, 0.02, 0.01), vec3(1.6, 0.42, 0.08), heat);
        c += vec3(1.4, 0.9, 0.4) * pow(heat, 4.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  disposables.push(coalMat);
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: U,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv; ${NOISE}
      void main(){
        // heat shimmer over the flame: thin rising wavering bands of warm air
        float y = vUv.y;
        float x = vUv.x - 0.5 + (vnoise(vec2(y * 6.0 - uTime * 2.2, 1.0)) - 0.5) * 0.25 * y;
        float column = exp(-x * x * 26.0);
        float bands = 0.5 + 0.5 * sin(y * 38.0 - uTime * 9.0 + vnoise(vec2(x * 8.0, y * 4.0 - uTime)) * 4.0);
        float a = column * bands * smoothstep(0.0, 0.15, y) * (1.0 - smoothstep(0.45, 1.0, y));
        gl_FragColor = vec4(vec3(0.5, 0.26, 0.1) * a * 0.22, 1.0);
      }`,
  });
  disposables.push(hazeMat);
  for (const [bx, bz, sd] of [[-6.2, -1.2, 1], [6.2, -1.2, 5]]) {
    const b = new THREE.Group();
    // a wrought-iron brazier: flared bowl with a rolled lip, a fluted stem on three
    // scrolled legs ending in paw feet
    const bowl = new THREE.LatheGeometry([[0.08, 0], [0.5, 0.04], [0.72, 0.22], [0.84, 0.4], [0.9, 0.46], [0.86, 0.5], [0.76, 0.44], [0.5, 0.24], [0.06, 0.16]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
    const bm = new THREE.Mesh(bowl, ironMat);
    bm.position.y = 1.15;
    bm.castShadow = true;
    b.add(bm);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.035, 6, 40), ironMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 1.62;
    b.add(lip);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 5, 32), ironMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.36;
    b.add(band);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.9, 10), ironMat);
    stem.position.y = 0.72;
    b.add(stem);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.3, 6), ironMat);
      leg.position.set(Math.cos(a) * 0.35, 0.62, Math.sin(a) * 0.35);
      leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      leg.castShadow = true;
      b.add(leg);
      const curl = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 5, 14, Math.PI * 1.5), ironMat);
      curl.position.set(Math.cos(a) * 0.5, 0.34, Math.sin(a) * 0.5);
      curl.rotation.y = -a;
      b.add(curl);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), ironMat);
      foot.scale.set(1, 0.6, 1.3);
      foot.position.set(Math.cos(a) * 0.56, 0.04, Math.sin(a) * 0.56);
      b.add(foot);
    }
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.74, 28), coalMat);
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 1.55;
    b.add(coals);
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.2), hazeMat);
    haze.position.y = 3.2;
    haze.userData.billboard = true;
    b.add(haze);
    const torch = createTorch({ color: 0xff9a48, intensity: 15, distance: 12, seed: sd, flame: true, flameScale: 0.95 });
    torch.position.y = 1.5;
    torch.userData.sprite.position.y = 0.55;
    torch.userData.sprite.scale.setScalar(2.6);
    torch.userData.glowScale = 0.5;
    torch.userData.light.position.y = 0.9;
    b.add(torch);
    b.position.set(bx, 0, bz);
    group.add(b);
    braziers.push(torch);
    hazes.push(haze);
  }
  // smoke curling up from the braziers and drifting off on the sea wind
  const brSmoke = (() => {
    const per = 22, pts = [[-6.2, 2.3, -1.2], [6.2, 2.3, -1.2]];
    const pos = new Float32Array(per * pts.length * 3), sd = new Float32Array(per * pts.length * 2);
    let k = 0;
    for (const p of pts) for (let i = 0; i < per; i++, k++) { pos.set(p, k * 3); sd.set([i / per, R.next()], k * 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 2));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { ...U, uPx: { value: 1 } },
      vertexShader: /* glsl */ `attribute vec2 aSeed; uniform float uTime, uPx; varying float vL; varying float vS;
        void main(){ float l = fract(uTime * 0.09 + aSeed.x); vL = l; vS = aSeed.y; vec3 p = position;
          p.y += l * 7.5; p.x += -l * l * 4.0 + sin(l * 9.0 + aSeed.y * 6.0) * 0.35 * l; p.z += (aSeed.y - 0.5) * 1.2 * l;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.6 + l * 3.4) * uPx * 700.0 / -mv.z, 1.0, 260.0); }`,
      fragmentShader: /* glsl */ `varying float vL; varying float vS; ${NOISE}
        void main(){ vec2 d = gl_PointCoord - 0.5; float n = fbm3(gl_PointCoord * 3.0 + vS * 11.0);
          float puff = smoothstep(0.5, 0.1, length(d) + (n - 0.5) * 0.3);
          float a = puff * smoothstep(0.0, 0.1, vL) * (1.0 - smoothstep(0.3, 1.0, vL)) * 0.22;
          vec3 c = mix(vec3(0.08, 0.06, 0.07), vec3(0.22, 0.16, 0.15), n) + vec3(0.6, 0.25, 0.08) * (1.0 - smoothstep(0.0, 0.18, vL));
          gl_FragColor = vec4(c, a); }`,
    });
    const mesh = new THREE.Points(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    disposables.push(g, m);
    return mesh;
  })();
  group.add(brSmoke);

  // ---- ruined colonnade, arch fragment, rubble ------------------------------------------
  const pieces = [];
  const column = (x, z, h, { capital = true, lean = 0, broken = 0, seed = 1, ry = 0 } = {}) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, lean)), new THREE.Vector3(1, 1, 1));
    for (const g of archColumn({ h: h + 1.6, r: 0.6, flutes: 20, capital, broken, seed, color: 0xd6cdbd })) pieces.push(g.applyMatrix4(m));
  };
  column(-13, -6, 9.5, { seed: 1 });
  column(-9.2, -8.2, 9.5, { seed: 2 });
  column(12.5, -6.6, 5.2, { capital: false, broken: 0.35, seed: 3 });
  column(16.5, -4, 8.6, { capital: false, broken: 0.25, seed: 4 });
  column(-17, 2, 3.4, { capital: false, broken: 0.5, seed: 5 });
  // entablature across the left pair (architrave · triglyph frieze · cornice), sheared off at the right
  {
    const ang = Math.atan2(-8.2 + 6, -9.2 + 13);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(-11.0, 11.12 + 0.02, -7.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -ang, 0.03)), new THREE.Vector3(1, 1, 1));
    for (const g of entablature(6.8, { depth: 1.7, seed: 9, color: 0xc8bdaa, brokenEnd: 0.9 })) pieces.push(g.applyMatrix4(m));
  }
  // fallen drums and rubble
  for (const [x, z, ry] of [[9, 3.5, 0.6], [14, 1, 1.9], [-11.5, 4, 2.4]]) {
    const g = new THREE.CylinderGeometry(0.55, 0.55, 1.4, 20);
    g.rotateZ(Math.PI / 2);
    g.rotateY(ry);
    g.translate(x, 0.55, z);
    pieces.push(tint(worldUV(g, 2), 0xc6bcac));
  }
  for (let i = 0; i < 46; i++) {
    const a = R.range(0, Math.PI * 2);
    const rr = R.range(5.5, 22);
    const x = Math.cos(a) * rr * 1.3, z = Math.sin(a) * rr * 0.55 - 1;
    if (z > 6 || (z > -2 && Math.abs(x) < 7)) continue;
    const s = R.range(0.15, 0.7) * (rr > 12 ? 1.4 : 1);
    const g = new THREE.IcosahedronGeometry(s, 1);
    const p = g.attributes.position;
    const sx = R.range(0.8, 1.4), sz = R.range(0.8, 1.3), ph = R.range(0, 9);
    for (let k = 0; k < p.count; k++) {
      const px = p.getX(k), py = p.getY(k), pz = p.getZ(k);
      const n = 1 + 0.18 * Math.sin(px * 7 + ph) * Math.cos(pz * 6 - ph) + 0.1 * Math.sin(py * 11 + ph * 2);
      p.setXYZ(k, px * sx * n, Math.max(py * 0.55 * n, -s * 0.2), pz * sz * n);
    }
    g.computeVertexNormals();
    g.rotateY(R.range(0, 6));
    g.translate(x, s * 0.35, z);
    pieces.push(tint(worldUV(g, 1.5), R.chance(0.5) ? 0xa89e90 : 0x8e857a));
  }
  // low broken balustrade along the edge
  for (let x = -40; x <= 40; x += 0.9) {
    if (Math.abs(x) < 7.5 || R.chance(0.35)) continue;
    const bh = R.chance(0.2) ? R.range(0.25, 0.6) : 0.85;
    const g = new THREE.CylinderGeometry(0.14, 0.2, bh, 8);
    g.translate(x, bh / 2, -9.4 + R.range(-0.1, 0.1));
    pieces.push(tint(worldUV(g, 1.5), 0xb8ad9c));
  }
  for (let x = -40; x <= 40; x += 4.5) {
    if (Math.abs(x) < 7.5 || R.chance(0.4)) continue;
    const g = new THREE.BoxGeometry(4.3, 0.22, 0.55);
    g.translate(x + 2.2, 0.95, -9.4);
    pieces.push(tint(worldUV(g, 2), 0xb3a896));
  }
  // ivy climbing the standing columns: leafy vines spiralling up the flutes,
  // thick at the base, thinning out toward the capital (breaks up the dark shafts)
  {
    const pos = [], col = [], nor = [];
    const leaf = (c, n, up, s, tone) => {
      const side = new THREE.Vector3().crossVectors(n, up).normalize();
      const tip = c.clone().addScaledVector(up, s * 1.2).addScaledVector(n, s * 0.35);
      const l = c.clone().addScaledVector(side, -s * 0.55).addScaledVector(up, s * 0.35);
      const r = c.clone().addScaledVector(side, s * 0.55).addScaledVector(up, s * 0.35);
      const nn = n.clone().addScaledVector(up, 0.4).normalize();
      for (const [a, b, d] of [[c, l, tip], [c, tip, r]]) {
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
        for (let k = 0; k < 3; k++) { nor.push(nn.x, nn.y, nn.z); col.push(...tone); }
      }
    };
    const ivy = (cx, cz, h, seed) => {
      const IR = prng(seed);
      for (let v = 0; v < 3; v++) {
        let a = IR.range(0, Math.PI * 2);
        const top = h * IR.range(0.45, 0.85);
        for (let y = 0.3; y < top; y += 0.07) {
          a += IR.range(-0.05, 0.16);
          const density = 1 - y / top;
          if (IR.next() > 0.25 + density * 0.75) continue;
          const rr = 0.62 - (y / h) * 0.1;
          const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          for (let k = 0; k < 2; k++) {
            const aa = a + IR.range(-0.35, 0.35);
            const nn = new THREE.Vector3(Math.cos(aa), IR.range(-0.2, 0.3), Math.sin(aa)).normalize();
            const c = new THREE.Vector3(cx + Math.cos(aa) * rr, y + IR.range(-0.05, 0.05), cz + Math.sin(aa) * rr);
            const up = new THREE.Vector3(IR.range(-0.4, 0.4), 1, IR.range(-0.4, 0.4)).normalize();
            const g = IR.range(0.6, 1.1);
            const tone = IR.chance(0.12) ? [0.36 * g, 0.22 * g, 0.08 * g] : [0.08 * g, 0.17 * g + 0.04, 0.05 * g];
            leaf(c, nn, up, IR.range(0.07, 0.13) * (0.7 + density * 0.6), tone);
          }
          void n;
        }
      }
    };
    ivy(-13, -6, 10, 41);
    ivy(-9.2, -8.2, 10, 42);
    ivy(16.5, -4, 8, 43);
    ivy(-17, 2, 4.5, 44);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const im = addRimLight(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }), rimU, 2.2);
    group.add(new THREE.Mesh(g, im));
    disposables.push(g, im);
  }
  const ruin = merge(pieces);
  const ruinMesh = new THREE.Mesh(ruin, stoneMat);
  ruinMesh.castShadow = true;
  ruinMesh.receiveShadow = true;
  group.add(ruinMesh);
  disposables.push(ruin);

  // ---- grime, moss and weeds so the flagstones read as centuries old ----------------
  {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, 512, 512);
    // blotches (alpha in the red channel → used as alphaMap via green)
    for (let i = 0; i < 260; i++) {
      const px = R.range(0, 512), py = R.range(0, 512), r = R.range(6, 46);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      const a = R.range(0.08, 0.35);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    // heavier grime toward the broken edge (top of the canvas = far edge) and the sides
    const eg = x.createLinearGradient(0, 0, 0, 512);
    eg.addColorStop(0, 'rgba(255,255,255,0.45)');
    eg.addColorStop(0.25, 'rgba(255,255,255,0.08)');
    eg.addColorStop(1, 'rgba(255,255,255,0.12)');
    x.fillStyle = eg;
    x.fillRect(0, 0, 512, 512);
    // keep the pool's surrounds clean-ish (worn by pilgrims)
    const pg = x.createRadialGradient(256, 150, 20, 256, 150, 110);
    pg.addColorStop(0, 'rgba(0,0,0,0.9)');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = pg;
    x.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    const g = new THREE.PlaneGeometry(90, 40);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.012, 11); // z from -9 to 31
    const m = new THREE.MeshStandardMaterial({ color: 0x1e1c14, roughness: 1, alphaMap: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const decal = new THREE.Mesh(g, m);
    decal.receiveShadow = true;
    group.add(decal);
    disposables.push(g, m, tex);
  }
  {
    const tufts = [];
    for (let i = 0; i < 230; i++) {
      // along the broken edge, round column plinths, and in random cracks
      let x, z;
      const k = R.next();
      if (k < 0.45) { x = R.range(-40, 40); z = -8.6 + R.range(0, 1.6); }
      else if (k < 0.7) { const c = R.pick([[-13, -6], [-9.2, -8.2], [12.5, -6.6], [16.5, -4], [-17, 2]]); const a = R.range(0, 6.28); x = c[0] + Math.cos(a) * 1.1; z = c[1] + Math.sin(a) * 1.1; }
      else { x = R.range(-30, 30); z = R.range(-8, 7); }
      if (Math.hypot(x, z) < 5.2) continue;
      tufts.push([x, z, R.range(0.35, 0.8), R.range(0, Math.PI)]);
      // satellites: tufts grow in clumps
      for (let k = R.int(0, 2); k > 0; k--) tufts.push([x + R.range(-0.5, 0.5), z + R.range(-0.4, 0.4), R.range(0.25, 0.55), 0]);
    }
    // clustered tufts of real blades (tapered, bent, root-dark to sun-bleached tips),
    // a few seed heads, lit by the scene instead of flat alpha cards
    const blades = [];
    const pos = [], col = [], nor = [];
    const tri = (a, b, c, ca, cb, cc) => {
      pos.push(...a, ...b, ...c);
      col.push(...ca, ...cb, ...cc);
      const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a)).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a))).normalize();
      // bias normals upward so blades catch the sky like foliage, not paper
      n.y = Math.abs(n.y) + 0.8;
      n.normalize();
      for (let k = 0; k < 3; k++) nor.push(n.x, n.y, n.z);
    };
    tufts.forEach(([x, z, sc, ry]) => {
      const n = 9 + Math.floor(R.next() * 8);
      const dry = R.next();
      for (let i = 0; i < n; i++) {
        const a = R.range(0, Math.PI * 2);
        const rr = R.range(0, 0.16) * sc;
        const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
        const hgt = sc * R.range(0.45, 1.05);
        const wid = R.range(0.025, 0.045) * (0.6 + sc * 0.5);
        const lean = R.range(0.15, 0.6) * hgt;
        const dir = a + R.range(-0.5, 0.5);
        const dx = Math.cos(dir), dz = Math.sin(dir);
        const px = -dz, pz = dx;
        const base = [0.05, 0.07, 0.03];
        const tip = dry > 0.6 ? [0.62, 0.55, 0.3] : [0.34 + R.range(0, 0.1), 0.42 + R.range(0, 0.1), 0.16];
        const midc = [base[0] * 0.4 + tip[0] * 0.6, base[1] * 0.4 + tip[1] * 0.6, base[2] * 0.4 + tip[2] * 0.6];
        // three segments, curving over
        const P = (t) => [bx + dx * lean * t * t, hgt * (t - 0.25 * t * t * (lean / hgt)), bz + dz * lean * t * t];
        const W = (t) => wid * (1 - t);
        let prevL = null, prevR = null, prevC = base;
        for (let k = 0; k <= 3; k++) {
          const t = k / 3;
          const c = P(t);
          const w = W(t);
          const L = [c[0] - px * w, c[1], c[2] - pz * w];
          const Rr = [c[0] + px * w, c[1], c[2] + pz * w];
          const cc = k === 0 ? base : k === 3 ? tip : midc;
          if (prevL) {
            tri(prevL, prevR, Rr, prevC, prevC, cc);
            tri(prevL, Rr, L, prevC, cc, cc);
          }
          prevL = L; prevR = Rr; prevC = cc;
        }
      }
      void ry;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const gm = addRimLight(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }), rimU, 1.6);
    const grass = new THREE.Mesh(g, gm);
    grass.receiveShadow = true;
    group.add(grass);
    disposables.push(g, gm);
    void blades;
  }

  // soft glow at the heart of the pool
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0x9ff6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.12 }));
  glow.position.set(0, 1.0, 0);
  glow.scale.set(8, 3.5, 1);
  group.add(glow);
  disposables.push(glow.material);

  return {
    group,
    poolLight,
    braziers,
    /** Scale the column of radiance (the menu dims it so the castle behind stays solid). */
    setBeam(k) {
      for (const m of beams) m.material.uniforms.uStrength.value = m.userData.base * k;
    },
    update(t, camera, sunDir) {
      if (camera && sunDir) rimU.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      U.uTime.value = t;
      FLAME_UNIFORMS.uTime.value = t;
      for (const b of braziers) b.userData.update(t);
      if (camera) for (const hz of hazes) hz.quaternion.copy(camera.quaternion);
      poolLight.intensity = 30 * (0.92 + 0.08 * Math.sin(t * 1.3));
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      group.traverse((o) => {
        if (o.isMesh && o.geometry) o.geometry.dispose();
      });
    },
  };
}
