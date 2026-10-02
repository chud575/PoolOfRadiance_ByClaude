import * as THREE from 'three';

/**
 * Embroidered heraldic banners for the hall of heroes: velvet ground with a
 * woven nap, a couched gold-thread border with a running vine, a raised
 * device stitched in satin (the balanced scales of the Council's justice, or
 * Phlan's tower with its gate and crenels), a pointed hem with a bullion
 * fringe. Colour, normal and roughness maps from one height field, all
 * painted on CPU canvases (deterministic).
 */

const W = 256, H = 704;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Banner outline: straight sides, a point at the hem. */
function outline(g) {
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W, 0);
  g.lineTo(W, H - 120);
  g.lineTo(W / 2, H - 20);
  g.lineTo(0, H - 120);
  g.closePath();
}

/** Device paths in a 200 x 260 box centred on (0, 0). */
function scales(g) {
  // Beam on a post with a finial, two pans on chains.
  g.beginPath();
  g.rect(-5, -95, 10, 190);
  g.rect(-80, -78, 160, 9);
  g.moveTo(-34, 98); g.lineTo(34, 98); g.lineTo(26, 86); g.lineTo(-26, 86); g.closePath();
  g.arc(0, -104, 11, 0, Math.PI * 2);
  for (const sx of [-74, 74]) {
    g.moveTo(sx, -70); g.lineTo(sx - 30, 12); g.lineTo(sx - 27, 12); g.lineTo(sx, -62); g.lineTo(sx + 27, 12); g.lineTo(sx + 30, 12); g.closePath();
    g.moveTo(sx - 38, 12); g.quadraticCurveTo(sx, 52, sx + 38, 12); g.closePath();
  }
}
function tower(g) {
  g.beginPath();
  // Keep with crenels.
  g.moveTo(-58, 100); g.lineTo(-58, -60);
  for (let i = 0; i < 5; i++) { const x = -58 + i * 29; g.lineTo(x, -88); g.lineTo(x + 15, -88); g.lineTo(x + 15, -60); g.lineTo(x + 29 > 58 ? 58 : x + 29, -60); }
  g.lineTo(58, 100); g.closePath();
  // Turret.
  g.moveTo(-22, -88); g.lineTo(-22, -120);
  for (let i = 0; i < 3; i++) { const x = -22 + i * 15; g.lineTo(x, -136); g.lineTo(x + 8, -136); g.lineTo(x + 8, -120); g.lineTo(Math.min(22, x + 15), -120); }
  g.lineTo(22, -88); g.closePath();
}
function towerHoles(g) {
  g.beginPath();
  g.moveTo(-20, 100); g.lineTo(-20, 52); g.quadraticCurveTo(0, 26, 20, 52); g.lineTo(20, 100); g.closePath();
  for (const [x, y] of [[-30, -20], [30, -20], [0, -40], [0, -106]]) { g.moveTo(x - 6, y + 14); g.lineTo(x - 6, y); g.quadraticCurveTo(x, y - 9, x + 6, y); g.lineTo(x + 6, y + 14); g.closePath(); }
}

const cache = new Map();
/**
 * @param {0|1} variant 0 = Phlan's tower on red, 1 = the scales on blue
 * @returns {{map: THREE.Texture, normalMap: THREE.Texture, roughnessMap: THREE.Texture}}
 */
export function bannerMaps(variant) {
  if (cache.has(variant)) return cache.get(variant);
  const R = rng(91 + variant * 7);
  const field = variant ? ['#16245a', '#0b1438'] : ['#7a1414', '#3e0808'];
  // ---- colour
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, W, H);
  g.save();
  outline(g);
  g.clip();
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, field[1]); grd.addColorStop(0.25, field[0]); grd.addColorStop(0.6, field[0]); grd.addColorStop(1, field[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // Velvet nap: fine vertical streaks and a soft mottling.
  for (let i = 0; i < 2600; i++) {
    const x = R() * W, y = R() * H;
    g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
    g.fillRect(x, y, 1, 4 + R() * 14);
  }
  // Gold border: couched cords with a running vine between them.
  const gold = (y0, y1) => { const gg = g.createLinearGradient(0, y0, 0, y1); gg.addColorStop(0, '#f2d68a'); gg.addColorStop(0.5, '#b88a34'); gg.addColorStop(1, '#6a4a18'); return gg; };
  g.lineJoin = 'round';
  const inset = (d, w, col) => {
    g.save();
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(d, d); g.lineTo(W - d, d); g.lineTo(W - d, H - 120 - d * 0.4); g.lineTo(W / 2, H - 20 - d * 1.4); g.lineTo(d, H - 120 - d * 0.4); g.closePath();
    g.stroke();
    g.restore();
  };
  inset(9, 5, gold(0, 40));
  inset(25, 2.5, '#d8b25a');
  g.strokeStyle = '#c9a048';
  g.lineWidth = 1.6;
  for (let y = 30; y < H - 150; y += 22) {
    for (const x of [17, W - 17]) {
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (x < W / 2 ? 6 : -6), y + 11, x, y + 22); g.stroke();
      g.beginPath(); g.ellipse(x + (x < W / 2 ? 4 : -4), y + 8, 3, 1.6, 0.6, 0, Math.PI * 2); g.fillStyle = '#d8b25a'; g.fill();
    }
  }
  // The device, in satin-stitched gold with a dark outline (couching).
  g.save();
  g.translate(W / 2, 300);
  g.scale(0.92, 0.92);
  const dev = variant ? scales : tower;
  dev(g);
  const dg = g.createLinearGradient(-90, -140, 90, 120);
  dg.addColorStop(0, '#f6dc94'); dg.addColorStop(0.45, '#c99a42'); dg.addColorStop(1, '#7a5420');
  g.fillStyle = dg;
  g.fill('evenodd');
  g.lineWidth = 3;
  g.strokeStyle = '#3a2408';
  g.stroke();
  if (!variant) {
    towerHoles(g);
    g.fillStyle = field[1];
    g.fill();
    g.lineWidth = 2;
    g.stroke();
    // Masonry courses stitched across the keep.
    g.strokeStyle = 'rgba(90,60,20,0.65)';
    g.lineWidth = 1.2;
    for (let y = -50; y < 100; y += 16) { g.beginPath(); g.moveTo(-56, y); g.lineTo(56, y); g.stroke(); }
  }
  // Satin stitch direction: fine diagonal hatching over the gold.
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = 'rgba(255,240,200,0.18)';
  g.lineWidth = 1;
  for (let k = -300; k < 300; k += 3) { g.beginPath(); g.moveTo(k, -160); g.lineTo(k + 140, 160); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  g.restore();
  // A motto ribbon under the device.
  g.save();
  g.translate(W / 2, 470);
  g.beginPath();
  g.moveTo(-92, -10); g.quadraticCurveTo(0, 8, 92, -10); g.lineTo(92, 12); g.quadraticCurveTo(0, 30, -92, 12); g.closePath();
  g.fillStyle = '#e8dcc0';
  g.fill();
  g.strokeStyle = '#3a2408';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#5a1a12';
  g.font = 'bold 15px serif';
  g.textAlign = 'center';
  g.fillText(variant ? 'IVSTITIA' : 'PHLAN', 0, 12);
  g.restore();
  // Light falls off toward the hem (the banner hangs in shadow below the candles' reach).
  const sh = g.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0.12)'); sh.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);
  g.restore();
  // Bullion fringe along the point.
  g.strokeStyle = '#c9a048';
  g.lineWidth = 2;
  for (let t = 0; t <= 1; t += 0.03) {
    const side = t < 0.5;
    const u = side ? t * 2 : (t - 0.5) * 2;
    const x = side ? u * (W / 2) : W / 2 + u * (W / 2);
    const y = side ? H - 120 + u * 100 : H - 20 - u * 100;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 2, y + 14 + R() * 4); g.stroke();
  }

  // ---- height: gold raised, fringe raised, the velvet soft (from the colour's saturation/brightness)
  const px = g.getImageData(0, 0, W, H).data;
  const hgt = new Float32Array(W * H);
  const rough = document.createElement('canvas');
  rough.width = W;
  rough.height = H;
  const rg = rough.getContext('2d');
  const ri = rg.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    const isGold = r > 120 && gg > 80 && b < gg * 0.8 && r > b * 1.4;
    hgt[i] = isGold ? 0.8 + (r - 120) / 600 : 0.25 + ((r + gg + b) / 765) * 0.2;
    const ro = isGold ? 90 : 235;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = ro;
    ri.data[i * 4 + 3] = 255;
  }
  rg.putImageData(ri, 0, 0);
  const n = document.createElement('canvas');
  n.width = W;
  n.height = H;
  const ng = n.getContext('2d');
  const ni = ng.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = hgt[y * W + Math.max(0, x - 1)], rr = hgt[y * W + Math.min(W - 1, x + 1)];
      const u = hgt[Math.max(0, y - 1) * W + x], d = hgt[Math.min(H - 1, y + 1) * W + x];
      const nx = (l - rr) * 3, ny = (d - u) * 3;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * W + x) * 4;
      ni.data[i] = (nx / len * 0.5 + 0.5) * 255;
      ni.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      ni.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
    }
  }
  ng.putImageData(ni, 0, 0);
  const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
  const out = { map: tex(c, true), normalMap: tex(n, false), roughnessMap: tex(rough, false) };
  cache.set(variant, out);
  return out;
}
