import * as THREE from 'three';

/**
 * The gilded title logo, rendered procedurally: text + filigree are drawn to
 * canvases, turned into (gilt mask, enamel mask, bevel height, outline) and
 * lit in a shader with a travelling specular glint, an under-light from the
 * pool and a dark drop shadow. It lives on a camera-attached plane so it goes
 * through the scene's bloom/grade like a real emitter would.
 */
const W = 2048;
const H = 1024;

export const DISPLAY_FONT = '"Cinzel Decorative", "Cinzel", "Trajan Pro", "Palatino Linotype", "Book Antiqua", Palatino, "URW Palladio L", "P052", "TeX Gyre Pagella", "FreeSerif", "Liberation Serif", Georgia, serif';

function mkCanvas(w = W, h = H) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw a spaced word with optional oversized initial; returns drawn width. */
function drawWord(ctx, word, x, y, size, { initial = 1.0, track = 0.06, italic = false, measure = false, stretch = 1.08 } = {}) {
  let cx = x;
  for (let i = 0; i < word.length; i++) {
    const s = i === 0 ? size * initial : size;
    ctx.font = `${italic ? 'italic ' : ''}700 ${s}px ${DISPLAY_FONT}`;
    const w = ctx.measureText(word[i]).width;
    if (!measure) {
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(1, stretch);
      ctx.fillText(word[i], 0, 0);
      ctx.restore();
    }
    cx += w + size * track;
  }
  return cx - x - size * track;
}

/** A flourish: a C-scroll spiral ending in a curl, drawn as a tapered stroke. */
function scroll(ctx, x, y, dir, len, lw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.lineCap = 'round';
  // main sweep
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.35, -lw * 0.2, len * 0.6, -len * 0.16, len * 0.78, -len * 0.08);
  ctx.stroke();
  // spiral curl at the end
  const cx = len * 0.82, cy = -len * 0.02;
  ctx.beginPath();
  for (let a = 0; a <= Math.PI * 3.2; a += 0.08) {
    const r = len * 0.07 * (1 - a / (Math.PI * 3.6));
    const px = cx + Math.cos(-a - Math.PI / 2) * r;
    const py = cy + Math.sin(-a - Math.PI / 2) * r - len * 0.0;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineWidth = lw * 0.8;
  ctx.stroke();
  // secondary under-curl
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  ctx.moveTo(len * 0.3, lw * 0.4);
  ctx.bezierCurveTo(len * 0.42, len * 0.1, len * 0.56, len * 0.08, len * 0.6, len * 0.02);
  ctx.stroke();
  // leaf
  ctx.beginPath();
  ctx.moveTo(len * 0.45, -len * 0.12);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.24, len * 0.62, -len * 0.2);
  ctx.quadraticCurveTo(len * 0.54, -len * 0.14, len * 0.45, -len * 0.12);
  ctx.fill();
  ctx.restore();
}

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.7, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.7, y);
  ctx.closePath();
  ctx.fill();
}

/** Build the logo texture (RGBA = gilt, enamel, height, outline/shadow). */
export function buildLogoTexture() {
  const gilt = mkCanvas();
  const enamel = mkCanvas();
  const g = gilt.getContext('2d');
  const e = enamel.getContext('2d');
  for (const c of [g, e]) {
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.textBaseline = 'alphabetic';
  }
  const cx = W / 2;

  // --- top line: ADVANCED DUNGEONS & DRAGONS (red enamel, gilt rules) ---
  {
    const size = 50;
    e.font = `700 ${size}px ${DISPLAY_FONT}`;
    const txt = 'ADVANCED DUNGEONS & DRAGONS';
    let w = 0;
    for (const ch of txt) w += e.measureText(ch).width + size * 0.34;
    let x = cx - w / 2;
    for (const ch of txt) {
      e.fillText(ch, x, 150);
      x += e.measureText(ch).width + size * 0.34;
    }
    g.fillRect(cx - w / 2 - 20, 176, w + 40, 5);
    g.fillRect(cx - w / 2 - 20, 94, w + 40, 3);
    diamond(g, cx - w / 2 - 40, 136, 16);
    diamond(g, cx + w / 2 + 40, 136, 16);
  }

  // --- main title: POOL of RADIANCE ---
  {
    const size = 196;
    const y = 470;
    const opts = { initial: 1.28, track: 0.035 };
    const wPool = drawWord(g, 'POOL', 0, 0, size, { ...opts, measure: true });
    const wOf = drawWord(g, 'of', 0, 0, size * 0.64, { initial: 1, track: 0.01, italic: true, measure: true });
    const wRad = drawWord(g, 'RADIANCE', 0, 0, size, { ...opts, measure: true });
    const gap = size * 0.12;
    const total = wPool + wOf + wRad + gap * 2;
    const k = Math.min(1, 1880 / total);
    g.save();
    g.translate(cx, y);
    g.scale(k, k);
    let x = -total / 2;
    drawWord(g, 'POOL', x, 0, size, opts);
    x += wPool + gap;
    drawWord(g, 'of', x, -size * 0.2, size * 0.64, { initial: 1, track: 0.01, italic: true });
    // a swash rule under the 'of' ties it to the capitals' baseline
    g.save();
    g.lineCap = 'round';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(x - size * 0.02, -size * 0.06);
    g.bezierCurveTo(x + wOf * 0.3, size * 0.02, x + wOf * 0.7, -size * 0.12, x + wOf + size * 0.04, -size * 0.04);
    g.stroke();
    diamond(g, x + wOf / 2, -size * 0.66, 9);
    g.restore();
    x += wOf + gap;
    drawWord(g, 'RADIANCE', x, 0, size, opts);
    g.restore();
  }

  // --- ornamental rule with filigree and centre jewel ---
  {
    const y = 560;
    g.fillRect(cx - 700, y - 3, 560, 6);
    g.fillRect(cx + 140, y - 3, 560, 6);
    g.fillRect(cx - 640, y + 10, 460, 2);
    g.fillRect(cx + 180, y + 10, 460, 2);
    scroll(g, cx - 120, y + 2, -1, 170, 7);
    scroll(g, cx + 120, y + 2, 1, 170, 7);
    diamond(g, cx - 715, y, 14);
    diamond(g, cx + 715, y, 14);
    // jewel setting (enamel centre, gilt bezel)
    g.beginPath();
    g.arc(cx, y, 34, 0, Math.PI * 2);
    g.fill();
    e.beginPath();
    e.arc(cx, y, 24, 0, Math.PI * 2);
    e.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx, y, 24, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }

  // --- FORGOTTEN REALMS (teal enamel) ---
  {
    const size = 58;
    e.font = `700 ${size}px ${DISPLAY_FONT}`;
    const txt = 'FORGOTTEN REALMS';
    let w = 0;
    for (const ch of txt) w += e.measureText(ch).width + size * 0.26;
    let x = cx - w / 2;
    for (const ch of txt) {
      e.fillText(ch, x, 680);
      x += e.measureText(ch).width + size * 0.26;
    }
    scroll(g, cx - w / 2 - 36, 660, -1, 150, 6);
    scroll(g, cx + w / 2 + 36, 660, 1, 150, 6);
  }

  // --- combine into channels ---
  const out = mkCanvas();
  const o = out.getContext('2d', { willReadFrequently: true });
  const union = mkCanvas();
  const u = union.getContext('2d');
  u.drawImage(gilt, 0, 0);
  u.drawImage(enamel, 0, 0);
  const blurred = (src, px) => {
    const c = mkCanvas();
    const x = c.getContext('2d');
    x.filter = `blur(${px}px)`;
    x.drawImage(src, 0, 0);
    return x.getImageData(0, 0, W, H).data;
  };
  const gd = g.getImageData(0, 0, W, H).data;
  const ed = e.getImageData(0, 0, W, H).data;
  const b1 = blurred(union, 3);
  const b2 = blurred(union, 9);
  const sh = blurred(union, 14);
  const img = o.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const ga = gd[i + 3], ea = ed[i + 3];
    d[i] = ga;
    d[i + 1] = ea;
    // bevel height: rounded shoulders inside the glyphs
    const hgt = Math.min(255, (b1[i + 3] * 0.55 + b2[i + 3] * 0.45) * Math.max(ga, ea) / 255 * 1.25);
    d[i + 2] = hgt;
    d[i + 3] = Math.min(255, sh[i + 3] * 2.2);
  }
  o.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * @returns {{mesh: THREE.Mesh, uniforms: object, layout(camera, o), dispose()}}
 */
export function createLogo() {
  const tex = buildLogoTexture();
  const uniforms = {
    uMap: { value: tex },
    uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
    uTime: { value: 0 },
    uSweep: { value: -1 },
    uAlpha: { value: 1 },
    uGlow: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec2 uTexel; uniform float uTime, uSweep, uAlpha, uGlow;
      varying vec2 vUv;
      float Hh(vec2 uv) { return texture2D(uMap, uv).b; }
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float gilt = t.r, enamel = t.g, hgt = t.b;
        float body = max(gilt, enamel);
        // drop shadow (offset down-right) + tight dark outline
        float shadow = texture2D(uMap, vUv + vec2(-uTexel.x * 6.0, uTexel.y * 9.0)).a;
        float outline = smoothstep(0.02, 0.35, t.a);
        vec2 e = uTexel * 1.6;
        float hx = Hh(vUv + vec2(e.x, 0.0)) - Hh(vUv - vec2(e.x, 0.0));
        float hy = Hh(vUv + vec2(0.0, e.y)) - Hh(vUv - vec2(0.0, e.y));
        vec3 n = normalize(vec3(-hx * 5.5, -hy * 5.5, 1.0));
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 L = normalize(vec3(-0.35, 0.65, 0.68));
        vec3 Hv = normalize(L + V);
        float diff = max(dot(n, L), 0.0);
        float spec = pow(max(dot(n, Hv), 0.0), 48.0);
        // faux environment: reflect into a sunset studio (bright sky above, dark ground, warm horizon)
        vec3 r = reflect(-V, n);
        float ry = r.y + (vUv.y - 0.5) * 0.35;
        vec3 env = mix(vec3(0.09, 0.035, 0.008), vec3(0.85, 0.55, 0.2), smoothstep(-0.3, 0.02, ry));
        env = mix(env, vec3(1.25, 0.95, 0.5), smoothstep(0.2, 0.7, ry));
        env += vec3(1.2, 0.55, 0.2) * exp(-abs(ry - 0.02) * 22.0) * 0.6;
        // the main title gets the classic engraved-metal band: bright sky above a
        // dark horizon line, warm bronze below (per-glyph vertical gradient)
        if (vUv.y > 0.525 && vUv.y < 0.73) {
          float band = clamp((vUv.y - 0.541) / 0.166, 0.0, 1.0);
          vec3 flat_ = mix(vec3(0.62, 0.3, 0.07), vec3(1.0, 0.64, 0.2), smoothstep(0.0, 0.42, band));
          flat_ = mix(flat_, vec3(0.3, 0.13, 0.03), smoothstep(0.44, 0.5, band) * (1.0 - smoothstep(0.5, 0.58, band)));
          flat_ = mix(flat_, vec3(1.35, 1.08, 0.62), smoothstep(0.55, 0.95, band));
          float bevel = clamp(length(n.xy) * 2.5, 0.0, 1.0);
          env = mix(flat_, env, bevel);
        }
        vec3 goldAlb = vec3(1.0, 0.7, 0.28);
        vec3 gold = goldAlb * (env * 0.9 + diff * 0.22) + vec3(1.0, 0.85, 0.6) * spec * 0.8;
        // enamel: red for the TSR line, teal for Forgotten Realms, deep blue jewel
        vec3 enCol = vUv.y > 0.8 ? vec3(0.95, 0.1, 0.06) : (vUv.y < 0.38 ? vec3(0.05, 0.42, 0.46) : vec3(0.04, 0.55, 0.75));
        vec3 enamelC = enCol * (0.55 + 0.6 * diff) + vec3(1.0, 0.95, 0.9) * spec * 0.55 + enCol * env * 0.25;
        // bevelled gilt rim around enamel letters
        float rim = enamel * (1.0 - smoothstep(0.12, 0.34, hgt));
        vec3 col = mix(gold, enamelC, enamel * (1.0 - rim));
        col = mix(col, gold * 1.05, rim * 0.85);
        // cyan under-light from the pool
        float under = max(dot(n, normalize(vec3(0.0, -0.8, 0.6))), 0.0);
        col += vec3(0.25, 0.85, 1.0) * pow(under, 3.0) * 0.55 * body;
        // travelling glint across the bevel shoulders
        float sweep = exp(-pow((vUv.x - uSweep) + (vUv.y - 0.5) * 0.45, 2.0) * 900.0);
        col += vec3(2.4, 2.0, 1.4) * sweep * (0.25 + spec * 2.0) * body;
        // soft emissive glint so the gilt blooms a touch
        col *= uGlow;
        float a = max(body, max(outline * 0.94, shadow * 0.55));
        vec3 outCol = mix(vec3(0.03, 0.012, 0.0), col, body);
        gl_FragColor = vec4(outCol, a * uAlpha);
      }`,
  });
  const geo = new THREE.PlaneGeometry(1, H / W);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  // soft dusk-shadow plate behind the logotype so it sits on a darker, contrasting sky
  const haloGeo = new THREE.PlaneGeometry(1.25, (H / W) * 1.1);
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, fog: false,
    uniforms: { uAlpha: uniforms.uAlpha },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uAlpha; varying vec2 vUv;
      void main(){
        vec2 d = (vUv - vec2(0.5, 0.56)) * vec2(1.0, 2.3);
        float k = exp(-dot(d, d) * 5.5);
        gl_FragColor = vec4(vec3(0.05, 0.02, 0.05), k * 0.5 * uAlpha);
      }`,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 999;
  halo.frustumCulled = false;
  halo.position.z = -0.001;
  mesh.add(halo);
  return {
    mesh,
    uniforms,
    /**
     * Place the logo on the camera plane.
     * @param {THREE.PerspectiveCamera} camera
     * @param {{width:number, cx?:number, cy:number, alpha?:number}} o  width = fraction of screen width, cx/cy = centre in NDC (-1..1)
     */
    layout(camera, { width, cx = 0, cy, alpha = 1 }) {
      const dist = 5;
      const vh = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const vw = vh * camera.aspect;
      const wWorld = Math.min(vw * width, vh * 1.9 * (W / H) * 0.5);
      mesh.scale.setScalar(wWorld);
      mesh.position.set((cx * vw) / 2, (cy * vh) / 2, -dist);
      uniforms.uAlpha.value = alpha;
      mesh.visible = alpha > 0.001;
    },
    dispose() {
      tex.dispose();
      geo.dispose();
      mat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
    },
  };
}
