/** Canvas helpers for procedural textures. */
export function makeCanvas(w, h = w) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Build RGBA pixels from a per-pixel function.
 * @param {number} size
 * @param {(u:number, v:number, x:number, y:number) => [number,number,number,number?]} fn  values 0..1
 */
export function pixelCanvas(size, fn) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b, a = 1] = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      d[i] = r * 255;
      d[i + 1] = gg * 255;
      d[i + 2] = b * 255;
      d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Generate colour + height fields together and derive a tangent-space normal map
 * from the height via Sobel. fn returns {c:[r,g,b], h:0..1, r?:roughness 0..1}.
 * @returns {{color: HTMLCanvasElement|OffscreenCanvas, normal: any, rough: any}}
 */
export function materialCanvases(size, fn, { normalStrength = 2.5 } = {}) {
  const height = new Float32Array(size * size);
  const color = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = fn(x / size, y / size, x, y);
      const i = y * size + x;
      height[i] = s.h;
      color[i * 4] = s.c[0] * 255;
      color[i * 4 + 1] = s.c[1] * 255;
      color[i * 4 + 2] = s.c[2] * 255;
      color[i * 4 + 3] = 255;
      const r = (s.r ?? 0.85) * 255;
      rough[i * 4] = r;
      rough[i * 4 + 1] = r; // three reads roughness from G
      rough[i * 4 + 2] = r;
      rough[i * 4 + 3] = 255;
    }
  }
  const normal = new Uint8ClampedArray(size * size * 4);
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * normalStrength;
      let ny = dy * normalStrength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i + 2] = (nz * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  const toCanvas = (arr) => {
    const c = makeCanvas(size, size);
    c.getContext('2d').putImageData(new ImageData(arr, size, size), 0, 0);
    return c;
  };
  return { color: toCanvas(color), normal: toCanvas(normal), rough: toCanvas(rough), height };
}

/**
 * Worker-friendly variant of materialCanvases(): returns raw RGBA byte arrays
 * (no DOM). Rows are stored bottom-up (row 0 = v 1.0 of the generator) so the
 * arrays can be uploaded directly as a THREE.DataTexture (flipY=false) and read
 * with the same orientation as the canvas path (generator v=0 is the top).
 * Also produces an ambient-occlusion-ish cavity term folded into the albedo
 * (`cavity` 0..1) which darkens crevices derived from the height field.
 * @returns {{size:number, color:Uint8ClampedArray, normal:Uint8ClampedArray, rough:Uint8ClampedArray}}
 */
export function materialData(size, fn, { normalStrength = 2.5, cavity = 0.35 } = {}) {
  const n = size * size;
  const height = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const rgh = new Float32Array(n);
  const emi = new Float32Array(n);
  // optional per-pixel side channels, packed into the roughness texture's free channels
  // (three reads roughness from G only): R = decal mask (`d`), B = stone/element id (`id`),
  // A = height. SurfaceFX uses them to vary decals and tone per stone without tiling.
  const dec = new Float32Array(n);
  const sid = new Float32Array(n);
  let hasEmi = false;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = fn(x / size, y / size, x, y);
      const i = y * size + x;
      height[i] = s.h;
      col[i * 3] = s.c[0];
      col[i * 3 + 1] = s.c[1];
      col[i * 3 + 2] = s.c[2];
      rgh[i] = s.r ?? 0.85;
      dec[i] = s.d ?? 0;
      sid[i] = s.id ?? 0;
      if (s.a !== undefined) {
        emi[i] = s.a;
        hasEmi = true;
      } else emi[i] = 1;
    }
  }
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const color = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const rough = new Uint8ClampedArray(n * 4);
  const ns = normalStrength * (size / 256);
  for (let y = 0; y < size; y++) {
    const oy = size - 1 - y; // bottom-up storage
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * ns * 0.25;
      let ny = dy * ns * 0.25;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      // cavity: local height below the 5x5 neighbourhood average darkens albedo
      const avg = (H(x - 2, y) + H(x + 2, y) + H(x, y - 2) + H(x, y + 2) + H(x - 1, y - 1) + H(x + 1, y + 1) + H(x - 1, y + 1) + H(x + 1, y - 1)) / 8;
      const cav = Math.max(0, Math.min(1, 1 - (avg - height[i]) * cavity * 6));
      const o = (oy * size + x) * 4;
      color[o] = col[i * 3] * cav * 255;
      color[o + 1] = col[i * 3 + 1] * cav * 255;
      color[o + 2] = col[i * 3 + 2] * cav * 255;
      color[o + 3] = hasEmi ? emi[i] * 255 : 255;
      normal[o] = (nx * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny * 0.5 + 0.5) * 255;
      normal[o + 2] = (nz * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
      rough[o] = dec[i] * 255;
      rough[o + 1] = rgh[i] * 255;
      rough[o + 2] = sid[i] * 255;
      rough[o + 3] = Math.max(0, Math.min(1, height[i])) * 255;
    }
  }
  return { size, color, normal, rough };
}
