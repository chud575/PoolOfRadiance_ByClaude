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
