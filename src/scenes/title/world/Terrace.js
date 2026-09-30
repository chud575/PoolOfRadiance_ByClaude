import * as THREE from 'three';
import { getTextureSet, getGlowTexture } from '../../../render/textures/index.js';
import { createTorch, FLAME_UNIFORMS } from '../../../render/lighting.js';
import { NOISE } from './glsl.js';
import { prng, ni, worldUV, tint, merge } from './geom.js';

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
  const stoneMat = texMat('hd_limestone', { vertexColors: true });
  const floorMat = texMat('hd_crazy', { vertexColors: true });

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
    worldUV(g, 6);
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
        vec3 core = vec3(0.8, 1.55, 1.8);
        vec3 col = mix(core, mid, smoothstep(0.0, 0.45, r + (n - 0.5) * 0.25));
        col = mix(col, deep, smoothstep(0.55, 1.02, r));
        col += vec3(0.5, 1.4, 1.6) * caustic * (1.0 - r * 0.5) * 0.7;
        col += vec3(0.8, 1.8, 2.0) * rings * 0.5;
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
        float fall = pow(1.0 - y, 2.4) * smoothstep(0.0, 0.03, y);
        vec3 c = mix(vec3(0.35, 1.25, 1.6), vec3(1.2, 1.9, 2.1), pow(1.0 - y, 6.0));
        gl_FragColor = vec4(c * body * fall * uStrength * 0.085, 1.0);
      }`,
  });
  disposables.push(beamMat);
  for (const [rb, rt, h, s] of [[2.7, 3.6, 34, 0.8], [1.4, 2.4, 28, 1.1], [0.55, 1.0, 22, 1.2]]) {
    const g = new THREE.CylinderGeometry(rt, rb, h, 48, 1, true);
    g.translate(0, h / 2 + 0.1, 0);
    const m = new THREE.Mesh(g, beamMat.clone());
    m.material.uniforms = { ...U, uStrength: { value: s } };
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
  for (const [bx, bz, sd] of [[-6.2, -1.2, 1], [6.2, -1.2, 5]]) {
    const b = new THREE.Group();
    const bowl = new THREE.LatheGeometry([[0.1, 0], [0.55, 0.05], [0.75, 0.28], [0.8, 0.42], [0.72, 0.42], [0.5, 0.2], [0.05, 0.14]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
    const bm = new THREE.Mesh(bowl, ironMat);
    bm.position.y = 1.15;
    bm.castShadow = true;
    b.add(bm);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.3, 6), ironMat);
      leg.position.set(Math.cos(a) * 0.35, 0.62, Math.sin(a) * 0.35);
      leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      leg.castShadow = true;
      b.add(leg);
    }
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.66, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.45, 0.1) }));
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 1.52;
    b.add(coals);
    disposables.push(coals.material);
    const torch = createTorch({ color: 0xff9a48, intensity: 7, distance: 14, seed: sd, flame: true, flameScale: 0.75 });
    torch.position.y = 1.5;
    torch.userData.sprite.position.y = 0.5;
    torch.userData.sprite.scale.setScalar(2.2);
    torch.userData.glowScale = 0.45;
    torch.userData.light.position.y = 0.9;
    b.add(torch);
    b.position.set(bx, 0, bz);
    group.add(b);
    braziers.push(torch);
  }

  // ---- ruined colonnade, arch fragment, rubble ------------------------------------------
  const pieces = [];
  const column = (x, z, h, { capital = true, lean = 0 } = {}) => {
    const plinth = new THREE.BoxGeometry(1.6, 0.5, 1.6);
    plinth.translate(x, 0.25, z);
    pieces.push(tint(worldUV(plinth, 2), 0xbcb2a3));
    const shaft = new THREE.CylinderGeometry(0.52, 0.6, h, 24, 8);
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ang = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 - 0.05 * Math.pow(Math.abs(Math.cos(ang * 10)), 0.5);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
      // broken top: jag the upper ring when there is no capital
      if (!capital && p.getY(i) > h / 2 - 0.01) p.setY(i, p.getY(i) - R.range(0, 0.6));
    }
    shaft.computeVertexNormals();
    shaft.translate(0, h / 2 + 0.5, 0);
    shaft.rotateZ(lean);
    shaft.translate(x, 0, z);
    pieces.push(tint(worldUV(shaft, 2), 0xd2c9b9, { aoBottom: 0, aoTop: 2.5, aoStrength: 0.35 }));
    if (capital) {
      const cap = new THREE.CylinderGeometry(0.85, 0.55, 0.5, 24);
      cap.translate(x, h + 0.75, z);
      pieces.push(tint(worldUV(cap, 2), 0xc9bfae));
      const ab = new THREE.BoxGeometry(1.9, 0.4, 1.9);
      ab.translate(x, h + 1.2, z);
      pieces.push(tint(worldUV(ab, 2), 0xbdb3a4));
    }
  };
  column(-13, -6, 9.5);
  column(-9.2, -8.2, 9.5);
  column(12.5, -6.6, 5.2, { capital: false });
  column(16.5, -4, 8.6, { capital: false });
  column(-17, 2, 3.4, { capital: false });
  // architrave across the left pair, broken off at the right
  {
    const g = new THREE.BoxGeometry(6.4, 1.1, 1.5);
    g.rotateY(-0.5);
    g.translate(-10.9, 11.6, -7.0);
    pieces.push(tint(worldUV(g, 2), 0xb9ae9d));
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
  const ruin = merge(pieces);
  const ruinMesh = new THREE.Mesh(ruin, stoneMat);
  ruinMesh.castShadow = true;
  ruinMesh.receiveShadow = true;
  group.add(ruinMesh);
  disposables.push(ruin);

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
    update(t) {
      U.uTime.value = t;
      FLAME_UNIFORMS.uTime.value = t;
      for (const b of braziers) b.userData.update(t);
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
