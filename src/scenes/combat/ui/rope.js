/**
 * Procedural braided-rope and bronze-plate frame art for the combat HUD (the
 * reference's rope-bound window). Drawn once per size into canvases and
 * handed to CSS as data URLs; no assets.
 */

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** One seamless horizontal repeat of a thick, twisted three-ply rope. */
function ropeTile(T, S) {
  const P = Math.round(T * 0.82);
  const c = canvas(P * S, T * S);
  const g = c.getContext('2d');
  g.scale(S, S);
  const cy = T / 2;
  // Lobes slant like a right-laid rope; each later lobe tucks over the last,
  // so the overlap reads as the twist with a dark groove between strands.
  for (let k = -3; k <= 3; k++) {
    const cx = k * P + P / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.92);
    const rx = T * 0.66;
    const ry = P * 0.6;
    // Core shadow under the lobe (the groove).
    g.fillStyle = 'rgba(6, 4, 2, 0.85)';
    g.beginPath();
    g.ellipse(0.9, 1.2, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    const gr = g.createLinearGradient(0, -ry, 0, ry);
    gr.addColorStop(0, '#19120b');
    gr.addColorStop(0.18, '#3e3224');
    gr.addColorStop(0.4, '#857155');
    gr.addColorStop(0.52, '#c4ae86');
    gr.addColorStop(0.62, '#8e795a');
    gr.addColorStop(0.84, '#3a2e20');
    gr.addColorStop(1, '#120c07');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    // Fibres along the strand: fine dark and pale hairlines.
    g.lineWidth = Math.max(0.5, T / 34);
    for (let f = -3; f <= 3; f++) {
      const y = (f / 4) * ry;
      const half = rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) * 0.86;
      g.strokeStyle = f % 2 ? 'rgba(10, 6, 2, 0.32)' : 'rgba(255, 238, 200, 0.13)';
      g.beginPath();
      g.moveTo(-half, y + 0.3);
      g.quadraticCurveTo(0, y - ry * 0.12, half, y + 0.3);
      g.stroke();
    }
    // Specular glint on the crown of the strand.
    const sp = g.createRadialGradient(-rx * 0.1, -ry * 0.05, 0, -rx * 0.1, -ry * 0.05, rx * 0.45);
    sp.addColorStop(0, 'rgba(255, 244, 214, 0.42)');
    sp.addColorStop(1, 'rgba(255, 244, 214, 0)');
    g.fillStyle = sp;
    g.beginPath();
    g.ellipse(-rx * 0.1, -ry * 0.05, rx * 0.5, ry * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // Round the bundle: cylinder shading across the rope (lit from above).
  g.globalCompositeOperation = 'source-atop';
  const cyl = g.createLinearGradient(0, 0, 0, T);
  cyl.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  cyl.addColorStop(0.16, 'rgba(0, 0, 0, 0.12)');
  cyl.addColorStop(0.36, 'rgba(255, 240, 210, 0.08)');
  cyl.addColorStop(0.62, 'rgba(0, 0, 0, 0.05)');
  cyl.addColorStop(0.86, 'rgba(0, 0, 0, 0.5)');
  cyl.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
  g.fillStyle = cyl;
  g.fillRect(-1, -1, P + 2, T + 2);
  // Trim the lobes to the rope's round profile.
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = '#000';
  g.fillRect(-1, T * 0.04, P + 2, T * 0.92);
  return c;
}

function rotate90(src) {
  const c = canvas(src.height, src.width);
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

/** A chunky riveted bronze corner plate with a sunk centre boss. */
function plate(D, S) {
  const c = canvas(D * S, D * S);
  const g = c.getContext('2d');
  g.scale(S, S);
  const r = D * 0.12;
  const rr = (x, y, w, h, rad) => {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  };
  // Drop shadow.
  g.fillStyle = 'rgba(0, 0, 0, 0.7)';
  rr(D * 0.06, D * 0.09, D * 0.92, D * 0.9, r);
  g.fill();
  // Plate body: worn bronze, lit from the top left.
  const b = g.createLinearGradient(0, 0, D, D);
  b.addColorStop(0, '#c7a466');
  b.addColorStop(0.3, '#8a6c3c');
  b.addColorStop(0.7, '#55401f');
  b.addColorStop(1, '#2a1e0e');
  g.fillStyle = b;
  rr(D * 0.02, D * 0.02, D * 0.92, D * 0.92, r);
  g.fill();
  g.strokeStyle = '#120c05';
  g.lineWidth = Math.max(1, D / 26);
  g.stroke();
  // Bevel: bright upper-left lip, dark lower-right.
  g.lineWidth = Math.max(1, D / 20);
  g.strokeStyle = 'rgba(255, 230, 170, 0.45)';
  g.beginPath();
  g.moveTo(D * 0.1, D * 0.86);
  g.lineTo(D * 0.1, D * 0.1);
  g.lineTo(D * 0.86, D * 0.1);
  g.stroke();
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.beginPath();
  g.moveTo(D * 0.86, D * 0.1);
  g.lineTo(D * 0.86, D * 0.86);
  g.lineTo(D * 0.1, D * 0.86);
  g.stroke();
  // Grime and verdigris in the field.
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = i % 5 ? `rgba(20, 12, 4, ${0.08 + rnd() * 0.12})` : `rgba(70, 110, 80, ${0.08 + rnd() * 0.08})`;
    g.beginPath();
    g.arc(D * (0.12 + rnd() * 0.76), D * (0.12 + rnd() * 0.76), D * (0.02 + rnd() * 0.05), 0, Math.PI * 2);
    g.fill();
  }
  // Sunk centre with a domed boss.
  const m = D * 0.47;
  const inset = g.createLinearGradient(m - D * 0.2, m - D * 0.2, m + D * 0.2, m + D * 0.2);
  inset.addColorStop(0, '#2a1d0c');
  inset.addColorStop(1, '#9c7c46');
  g.fillStyle = inset;
  rr(m - D * 0.2, m - D * 0.2, D * 0.4, D * 0.4, r * 0.6);
  g.fill();
  const boss = (x, y, rad) => {
    const q = g.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.05, x, y, rad);
    q.addColorStop(0, '#f2dca4');
    q.addColorStop(0.35, '#a88650');
    q.addColorStop(0.8, '#3e2c12');
    q.addColorStop(1, '#140c04');
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.beginPath();
    g.arc(x + rad * 0.2, y + rad * 0.3, rad, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = q;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  boss(m, m, D * 0.13);
  for (const [x, y] of [[0.2, 0.2], [0.74, 0.2], [0.2, 0.74], [0.74, 0.74]]) boss(D * x, D * y, D * 0.065);
  return c;
}

/**
 * CSS custom properties for the rope frame at rope thickness T (CSS px):
 * --rope-h / --rope-v (repeating tiles), --rope-plate, sizes.
 */
export function ropeVars(T) {
  T = Math.max(10, Math.round(T));
  if (cache.has(T)) return cache.get(T);
  const S = Math.min(3, Math.max(1, Math.ceil(globalThis.devicePixelRatio || 1)));
  const hz = ropeTile(T, S);
  const vt = rotate90(hz);
  const D = Math.round(T * 1.9);
  const pl = plate(D, S);
  const P = hz.width / S;
  const vars = {
    '--rope-t': `${T}px`,
    '--rope-p': `${P}px`,
    '--rope-d': `${D}px`,
    '--rope-h': `url(${hz.toDataURL()})`,
    '--rope-v': `url(${vt.toDataURL()})`,
    '--rope-plate': `url(${pl.toDataURL()})`,
  };
  cache.set(T, vars);
  return vars;
}
