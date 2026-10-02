import * as THREE from 'three';
import { TILE } from './terrain.js';

/**
 * Tactical ground overlay: grid, movement range (with outline), threatened
 * squares, spell templates, hover cursor, the planned path ribbon and
 * selection / team rings. One shader-driven plane + a few small meshes.
 */
export class Overlay {
  constructor(field) {
    this.field = field;
    const w = field.w;
    const h = field.h;
    this.state = new Uint8Array(w * h * 4);
    this.info = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const idx = field.idx(x, y);
        this.info[i] = field.block[idx] === 0 ? 255 : field.block[idx] === 2 ? 90 : 0;
        this.info[i + 1] = field.exitMask[idx] ? 255 : field.isRough?.(x, y) ? 100 : 0;
        this.info[i + 2] = field.wallE[idx] ? 255 : 0;
        this.info[i + 3] = field.wallS[idx] ? 255 : 0;
      }
    }
    const mk = (data) => {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    this.tState = mk(this.state);
    this.tInfo = mk(this.info);
    this.uniforms = {
      tState: { value: this.tState },
      tInfo: { value: this.tInfo },
      uGrid: { value: new THREE.Vector2(w, h) },
      uTime: { value: 0 },
      uRangeColor: { value: new THREE.Color(0x9cc6ee) },
      uTemplateColor: { value: new THREE.Color(0xff6a2a) },
      uShowGrid: { value: 1 },
      uAlpha: { value: 1 },
      uNight: { value: 0 },
      uFocus: { value: new THREE.Vector2(-99, -99) },
      uFocus2: { value: new THREE.Vector2(-99, -99) },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tState, tInfo;
        uniform vec2 uGrid;
        uniform float uTime, uShowGrid, uAlpha, uNight;
        uniform vec2 uFocus, uFocus2;
        uniform vec3 uRangeColor, uTemplateColor;
        vec4 S(vec2 c){ return texture2D(tState, (c + 0.5) / uGrid); }
        vec4 I(vec2 c){ return texture2D(tInfo, (c + 0.5) / uGrid); }
        void main(){
          vec2 g = vec2(vUv.x, 1.0 - vUv.y) * uGrid;
          vec2 c = floor(g);
          vec2 f = g - c;
          // Pixel footprint in square units, taken in uniform control flow
          // (derivatives inside branches are undefined → nondeterministic AA).
          vec2 fwG = fwidth(g);
          float pxG = max(0.5 * (fwG.x + fwG.y), 0.0015);
          vec4 s = S(c);
          vec4 inf = I(c);
          float walk = step(0.5, inf.r);
          vec3 col = vec3(0.0);
          float a = 0.0;
          // Premultiplied "over" compositing of each overlay layer.
          #define LAYER(C, A) { float al_ = clamp(A, 0.0, 1.0); col = col * (1.0 - al_) + (C) * al_; a = a + al_ * (1.0 - a); }
          float ed = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          // Grid (only on open ground): hairlines plus corner ticks, like a printed battle map.
          // Grid marks only where they help: inside the move range and around the
          // cursor / active unit, fading with distance (no printed lattice everywhere).
          float near = max(1.0 - smoothstep(1.2, 3.2, length(g - uFocus - 0.5)), 1.0 - smoothstep(0.8, 2.4, length(g - uFocus2 - 0.5)));
          float gridVis = max(step(0.1, s.r) * 0.45, near) * walk * uShowGrid;
          float grid = (1.0 - smoothstep(0.0, 0.016, ed)) * gridVis;
          LAYER(mix(vec3(0.06, 0.05, 0.04), vec3(0.8, 0.75, 0.6), uNight), grid * mix(0.28, 0.07, uNight));
          vec2 cf = min(f, 1.0 - f);
          float tick = (1.0 - smoothstep(0.0, 0.016, min(cf.x, cf.y))) * step(max(cf.x, cf.y), 0.07) * gridVis;
          LAYER(mix(vec3(0.95, 0.85, 0.6), vec3(0.9, 0.85, 0.7), uNight), tick * mix(0.26, 0.12, uNight));
          // Movement range: an inlaid, softly lit field — faint fill with a slow
          // shimmer, a glow feathered inward from the boundary and an antialiased rim.
          float r = s.r;
          if (r > 0.1) {
            float de = 2.0;
            vec2 d[4]; d[0] = vec2(1,0); d[1] = vec2(-1,0); d[2] = vec2(0,1); d[3] = vec2(0,-1);
            float dist[4]; dist[0] = 1.0 - f.x; dist[1] = f.x; dist[2] = 1.0 - f.y; dist[3] = f.y;
            for (int k = 0; k < 4; k++) {
              // Free-standing obstacles (columns, crates) inside the range don't notch its outline.
              float nObs = step(0.2, I(c + d[k]).r) * step(I(c + d[k]).r, 0.5);
              if (S(c + d[k]).r < 0.1 && nObs < 0.5) de = min(de, dist[k]);
            }
            for (int k = 0; k < 4; k++) {
              vec2 dd = vec2(k < 2 ? 1.0 : -1.0, (k == 0 || k == 2) ? 1.0 : -1.0);
              float nObs = step(0.2, I(c + dd).r) * step(I(c + dd).r, 0.5);
              if (S(c + dd).r < 0.1 && nObs < 0.5) de = min(de, length(vec2(dd.x > 0.0 ? 1.0 - f.x : f.x, dd.y > 0.0 ? 1.0 - f.y : f.y)));
            }
            // Soft painted range: a low fill with an inner glow feathered in
            // from the boundary and a thin, soft-edged lip (no hard white rim).
            float px = pxG;
            float shimmer = 0.5 + 0.5 * sin(uTime * 1.2 - (g.x * 0.8 + g.y * 0.55));
            vec3 rc = r > 0.9 ? uRangeColor : vec3(1.0, 0.8, 0.45);
            float glowIn = exp(-de * 4.5);
            // Far edges of a big range recede (no lone bright fragments at the
            // frame's rim): the lip fades with distance from the mover.
            float farK = uFocus2.x > -50.0 ? mix(1.0, 0.3, smoothstep(4.0, 9.0, length(g - uFocus2 - 0.5))) : 1.0;
            float lip = (1.0 - smoothstep(px * 0.5, px * 3.5, de)) * farK;
            glowIn *= mix(0.6, 1.0, farK);
            LAYER(rc * 0.5, 0.035 + 0.012 * shimmer);
            LAYER(rc * 0.85, glowIn * 0.22);
            LAYER(rc * 1.15 + 0.06, lip * 0.42);
            // Rough ground costs extra: darker, with a stipple.
            if (inf.g > 0.2 && inf.g < 0.5) {
              float st = step(0.82, fract(sin(dot(floor(g * 9.0), vec2(12.9898, 78.233))) * 43758.5453));
              LAYER(vec3(0.02, 0.025, 0.04), 0.26 + st * 0.2);
            }
          }
          // Threatened squares (moving out provokes): thin, desaturated diagonal
          // hairlines plus a faint red vignette hugging the square edges.
          if (s.a > 0.1 && r > 0.1) {
            float hv = (g.x + g.y) * 2.0;
            float hd = abs(fract(hv) - 0.5);
            float hpx = pxG * 4.0;
            float hatch = 1.0 - smoothstep(hpx * 0.6, hpx * 1.4, hd);
            LAYER(vec3(0.62, 0.3, 0.26), hatch * 0.1);
            LAYER(vec3(0.55, 0.12, 0.08), exp(-ed * 9.0) * 0.08);
          }
          // Spell template.
          if (s.g > 0.9) {
            float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
            float e2 = 1.0 - smoothstep(0.0, 0.07, ed);
            float pxE = pxG;
            float rimT = 1.0 - smoothstep(pxE, pxE * 2.5, ed);
            LAYER(uTemplateColor * 0.7, 0.13 + 0.05 * pulse);
            LAYER(uTemplateColor * 1.5, rimT * 0.6 + e2 * 0.12);
          } else if (s.g > 0.4) {
            // Valid target squares (enemies in reach): quiet corner brackets —
            // the current target gets the bright reticle on top.
            vec2 cq = min(f, 1.0 - f);
            float br = (1.0 - smoothstep(pxG * 1.0, pxG * 2.6, min(cq.x, cq.y) - 0.06)) * step(max(cq.x, cq.y), 0.24) * step(0.06 - pxG, min(cq.x, cq.y));
            LAYER(vec3(1.0, 0.45, 0.3) * 1.1, br * 0.55);
            LAYER(vec3(1.0, 0.3, 0.2) * 0.5, 0.05);
          }
          // Path and hover.
          if (s.b > 0.9) {
            float e2 = 1.0 - smoothstep(0.0, 0.05, ed);
            LAYER(vec3(1.0, 0.92, 0.65), 0.1);
            LAYER(vec3(1.0, 0.92, 0.65) * 1.6, e2 * 0.9);
          } else if (s.b > 0.5) {
            LAYER(vec3(1.0, 0.25, 0.2) * 0.7, 0.25);
          }
          // Exit squares along the rim (flee): a worn painted chevron pointing off
          // the field with a slow glowing pulse travelling outward.
          if (inf.g > 0.5 && r > 0.1) {
            vec4 dE = vec4(c.x, uGrid.x - 1.0 - c.x, c.y, uGrid.y - 1.0 - c.y);
            float m = min(min(dE.x, dE.y), min(dE.z, dE.w));
            vec2 outD = m == dE.x ? vec2(-1.0, 0.0) : m == dE.y ? vec2(1.0, 0.0) : m == dE.z ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
            vec2 q = f - 0.5;
            vec2 lq = vec2(dot(q, vec2(-outD.y, outD.x)), dot(q, outD));
            float wear = 0.65 + 0.35 * fract(sin(dot(floor(g * 14.0), vec2(12.9898, 78.233))) * 43758.5453);
            float cpx = pxG;
            float chevA = 0.0;
            for (int k = 0; k < 2; k++) {
              float off = -0.16 + float(k) * 0.2;
              float dch = abs(lq.y - off + abs(lq.x) * 0.75) - 0.035;
              chevA = max(chevA, (1.0 - smoothstep(0.0, cpx * 1.5, dch)) * step(abs(lq.x), 0.3));
            }
            float pulse = smoothstep(0.25, 0.0, abs(fract(uTime * 0.45) - (lq.y + 0.5)));
            LAYER(vec3(0.92, 0.84, 0.62) * 0.75, chevA * 0.26 * wear);
            LAYER(vec3(1.0, 0.86, 0.5) * 1.3, chevA * pulse * 0.3);
          }
          gl_FragColor = vec4(col / max(a, 0.0001), a * uAlpha);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * TILE, h * TILE), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((w * TILE) / 2, 0.025, (h * TILE) / 2);
    this.mesh.renderOrder = 2;
    this.group = new THREE.Group();
    this.group.add(this.mesh);

    // Path ribbon.
    this.pathMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.uniforms.uTime, uLen: { value: 1 }, uColor: { value: new THREE.Color(0xffe39a) } },
      vertexShader: `attribute float aDist; varying float vD; varying vec2 vUv; void main(){ vD = aDist; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vD; varying vec2 vUv; uniform float uTime, uLen; uniform vec3 uColor;
        void main(){
          float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float dash = smoothstep(0.35, 0.5, fract(vD * 1.6 - uTime * 1.5));
          float core = smoothstep(0.35, 0.8, across);
          float a = (core * (0.55 + dash * 0.45) + smoothstep(0.0, 0.5, across) * 0.25);
          gl_FragColor = vec4(uColor * (1.2 + dash * 0.8), a);
        }`,
    });
    this.path = new THREE.Mesh(new THREE.BufferGeometry(), this.pathMat);
    this.path.renderOrder = 3;
    this.path.frustumCulled = false;
    this.group.add(this.path);
    // Path end marker (a cone arrow).
    this.arrow = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe39a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.arrow.renderOrder = 3;
    this.arrow.visible = false;
    this.group.add(this.arrow);

    // Line-of-sight ray (aim / spell targeting): gold while clear, red past the block.
    this.rayMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.uniforms.uTime, uBlock: { value: 1 }, uLen: { value: 1 } },
      vertexShader: `attribute float aT; varying float vT; varying vec2 vUv; void main(){ vT = aT; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vT; varying vec2 vUv; uniform float uTime, uBlock, uLen;
        void main(){
          float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
          bool blocked = vT > uBlock;
          float dash = step(0.45, fract(vT * uLen * 1.4 - uTime * 1.2));
          vec3 c = blocked ? vec3(1.0, 0.18, 0.12) : vec3(1.0, 0.88, 0.55);
          float a = smoothstep(0.0, 0.5, across) * (blocked ? 0.9 : 0.6 + dash * 0.4);
          // A bright tick where the line is cut.
          a += (1.0 - smoothstep(0.0, 0.04 / max(uLen, 1.0), abs(vT - uBlock))) * step(uBlock, 0.999) * 0.9;
          float fadeIn = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.9, 1.0, vT) * 0.6);
          gl_FragColor = vec4(c * 1.6, a * fadeIn);
        }`,
    });
    this.ray = new THREE.Mesh(new THREE.BufferGeometry(), this.rayMat);
    this.ray.renderOrder = 13;
    this.rayMat.depthTest = false;
    this.ray.frustumCulled = false;
    this.ray.visible = false;
    this.group.add(this.ray);

    // Rings.
    this.ringMat = (color, width = 0.08) => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.uniforms.uTime, uColor: { value: new THREE.Color(color) }, uW: { value: width }, uSpin: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime, uW, uSpin; uniform vec3 uColor;
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float ring = smoothstep(uW, 0.0, abs(r - 0.82));
          float ang = atan(p.y, p.x);
          float seg = 0.65 + 0.35 * step(0.0, sin(ang * 8.0 + uTime * 2.0 * uSpin));
          float glow = smoothstep(1.0, 0.6, r) * smoothstep(0.3, 0.9, r) * 0.25;
          float a = ring * seg + glow;
          gl_FragColor = vec4(uColor * (1.3 + ring), a);
        }`,
    });
    this.activeRing = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), this.ringMat(0xffd36b, 0.09));
    this.activeRing.renderOrder = 4;
    this.group.add(this.activeRing);
    // Active-unit marker: a small faceted gilt diamond floating over the head.
    const dg = new THREE.OctahedronGeometry(0.11, 0);
    dg.scale(1, 1.7, 1);
    this.activeMarker = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    this.activeMarker.renderOrder = 14;
    this.activeMarker.visible = false;
    this.group.add(this.activeMarker);
    this.targetRing = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), this.ringMat(0xff5040, 0.09));
    this.targetRing.material.uniforms.uSpin.value = -2;
    this.targetRing.renderOrder = 4;
    this.targetRing.visible = false;
    this.group.add(this.targetRing);
    // Current target: rotating corner brackets, a pulsing ring sweeping in, and a
    // soft pillar of light — unmistakable among the other valid targets.
    this.reticle = new THREE.Group();
    this.reticleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uniforms.uTime, uColor: { value: new THREE.Color(0xff6a48) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          float a0 = uTime * 0.6;
          vec2 q = mat2(cos(a0), -sin(a0), sin(a0), cos(a0)) * p;
          float px = fwidth(p.x) * 1.2;
          // Four corner brackets.
          vec2 aq = abs(q);
          float boxD = max(aq.x, aq.y);
          float brk = (1.0 - smoothstep(0.022, 0.022 + px * 1.5, abs(boxD - 0.62))) * step(0.36, min(aq.x, aq.y));
          float r = length(p);
          float ph = fract(uTime * 0.9);
          float pulse = (1.0 - smoothstep(0.0, 0.05 + px, abs(r - mix(0.95, 0.5, ph)))) * (1.0 - ph) * 0.8;
          float ring = (1.0 - smoothstep(px, px * 3.0, abs(r - 0.5))) * 0.9;
          float fill = (1.0 - smoothstep(0.0, 0.5, r)) * 0.18;
          float a = max(max(brk, ring), pulse) + fill;
          gl_FragColor = vec4(uColor * (1.4 + ring), a * smoothstep(1.0, 0.92, r));
        }`,
    });
    const rp = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0).rotateX(-Math.PI / 2), this.reticleMat);
    rp.position.y = 0.05;
    rp.renderOrder = 5;
    this.pillarMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: this.uniforms.uTime, uColor: this.reticleMat.uniforms.uColor },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
        void main(){ float a = pow(1.0 - vUv.y, 2.2) * (0.16 + 0.05 * sin(uTime * 4.0)); gl_FragColor = vec4(uColor * 1.4, a); }`,
    });
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 2.2, 28, 1, true).translate(0, 1.1, 0), this.pillarMat);
    pil.renderOrder = 5;
    this.reticle.add(rp, pil);
    this.reticle.visible = false;
    this.group.add(this.reticle);
    this.teamRings = new Map();
    this.teamMat = {
      party: new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.42, depthWrite: false }),
      monster: new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.36, depthWrite: false }),
    };
    this.teamGeo = new THREE.RingGeometry(0.5, 0.538, 48).rotateX(-Math.PI / 2);
  }

  /** Team ring under each combatant (blue party / red foes). */
  teamRing(id, side) {
    let r = this.teamRings.get(id);
    if (!r) {
      r = new THREE.Mesh(this.teamGeo, this.teamMat[side] ?? this.teamMat.monster);
      r.renderOrder = 3;
      this.group.add(r);
      this.teamRings.set(id, r);
    }
    r.material = this.teamMat[side] ?? this.teamMat.monster;
    return r;
  }

  clear(channels = 'rgba') {
    const s = this.state;
    for (let i = 0; i < s.length; i += 4) {
      if (channels.includes('r')) s[i] = 0;
      if (channels.includes('g')) s[i + 1] = 0;
      if (channels.includes('b')) s[i + 2] = 0;
      if (channels.includes('a')) s[i + 3] = 0;
    }
    this.tState.needsUpdate = true;
  }

  set(x, y, ch, v) {
    if (!this.field.inBounds(x, y)) return;
    const k = { r: 0, g: 1, b: 2, a: 3 }[ch];
    this.state[(y * this.field.w + x) * 4 + k] = v;
    this.tState.needsUpdate = true;
  }

  /** Paint the reachable squares of a flood (cost ≤ mp). */
  setRange(flood, mp, threatened = null) {
    this.clear('ra');
    const f = this.field;
    for (let i = 0; i < f.w * f.h; i++) {
      const c = flood?.cost[i];
      if (c !== undefined && Number.isFinite(c) && c <= mp + 1e-6 && c > 0) {
        this.state[i * 4] = 255;
        if (threatened?.has(i)) this.state[i * 4 + 3] = 255;
      }
    }
    this.tState.needsUpdate = true;
  }

  setTemplate(squares, targets = []) {
    this.clear('g');
    for (const s of targets) this.set(s.x, s.y, 'g', 140);
    for (const s of squares) this.set(s.x, s.y, 'g', 255);
  }

  /** Grid-mark focus points (cursor, active unit) in square coords. */
  setFocus(sq, sq2 = undefined) {
    if (sq !== undefined) this.uniforms.uFocus.value.set(sq ? sq.x : -99, sq ? sq.y : -99);
    if (sq2 !== undefined) this.uniforms.uFocus2.value.set(sq2 ? sq2.x : -99, sq2 ? sq2.y : -99);
  }

  setHover(sq, bad = false) {
    this.clear('b');
    this.setFocus(sq ?? null);
    if (sq) this.set(sq.x, sq.y, 'b', bad ? 140 : 255);
  }

  /** Ribbon along square centres (start + path). */
  setPath(start, path) {
    if (!path || !path.length) {
      this.path.visible = false;
      this.arrow.visible = false;
      return;
    }
    const pts = [start, ...path].map((p) => new THREE.Vector3(p.x * TILE + TILE / 2, 0.06, p.y * TILE + TILE / 2));
    // Smooth with a centripetal curve.
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
    const n = Math.max(8, pts.length * 10);
    const sam = curve.getSpacedPoints(n);
    const pos = [];
    const uv = [];
    const dist = [];
    const idx = [];
    let acc = 0;
    const width = 0.16;
    for (let i = 0; i < sam.length; i++) {
      const p = sam[i];
      const q = sam[Math.min(sam.length - 1, i + 1)];
      const o = sam[Math.max(0, i - 1)];
      const dir = new THREE.Vector3().subVectors(q, o).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width);
      if (i > 0) acc += p.distanceTo(sam[i - 1]);
      // Start the ribbon just outside the mover's ring.
      pos.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z);
      uv.push(acc, 0, acc, 1);
      dist.push(acc, acc);
      if (i < sam.length - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
    g.setIndex(idx);
    this.path.geometry.dispose();
    this.path.geometry = g;
    this.path.visible = true;
    const end = pts[pts.length - 1];
    this.arrow.position.set(end.x, 0.05, end.z);
    this.arrow.visible = true;
  }

  /** Sight line from square a to square b, blocked at fraction tBlock (1 = clear). */
  setRay(a, b, tBlock = 1, { arc = 0.35, h0 = 1.0, h1 = 0.95 } = {}) {
    if (!a || !b || (a.x === b.x && a.y === b.y)) {
      this.ray.visible = false;
      return;
    }
    // Raised to chest height and gently arched, so figures and rings never hide it.
    const A = new THREE.Vector3(a.x * TILE + TILE / 2, h0, a.y * TILE + TILE / 2);
    const B = new THREE.Vector3(b.x * TILE + TILE / 2, h1, b.y * TILE + TILE / 2);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.05);
    const n = 32;
    const pos = [];
    const uv = [];
    const tt = [];
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = A.clone().lerp(B, u);
      p.y += Math.sin(u * Math.PI) * arc * Math.min(1, len / 6);
      pos.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z);
      uv.push(u, 0, u, 1);
      tt.push(u, u);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    g.setIndex(idx);
    this.ray.geometry.dispose();
    this.ray.geometry = g;
    this.rayMat.uniforms.uBlock.value = tBlock;
    this.rayMat.uniforms.uLen.value = len;
    this.ray.visible = true;
  }

  /** Bright reticle on the current target square (null hides); color by intent. */
  setReticle(sq, color = 0xff6a48) {
    if (!sq) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.set(sq.x * TILE + TILE / 2, 0, sq.y * TILE + TILE / 2);
    this.reticleMat.uniforms.uColor.value.set(color);
  }

  update(t) {
    this.uniforms.uTime.value = t;
    const k = 1 + Math.sin(t * 4) * 0.04;
    this.activeRing.scale.setScalar(k);
    this.activeMarker.rotation.y = t * 1.6;
    this.arrow.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
  }

  dispose() {
    this.tState.dispose();
    this.tInfo.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.path.geometry.dispose();
    this.pathMat.dispose();
    this.ray.geometry.dispose();
    this.rayMat.dispose();
    this.teamGeo.dispose();
  }
}
