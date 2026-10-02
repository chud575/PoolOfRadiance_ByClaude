import { INK, prng } from './ink.js';
import { fbm } from '../../render/textures/noise.js';

/**
 * The walled city on the overview: the old wall as a continuous crenellated
 * curtain with round and square towers, gatehouses and a couple of breaches;
 * between the surveyed blocks, the Old City itself — streets, lanes, plazas
 * and rows of rooftops (washed tile and slate with ridge and hip lines,
 * hatched on the shadow side), more and more of them roofless ruins toward
 * the north; and the harbour: a stone quay along the shore with jetties,
 * moored boats and the wharves at the river mouth. All in sheet units.
 */

export function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-6) + xi) c = !c;
  }
  return c;
}

function distSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

const ROOFS = [[178, 96, 70], [160, 104, 78], [140, 128, 120], [168, 118, 84], [150, 92, 72], [126, 120, 116]];

/** One building in plan: a washed hip roof with ridge, hips and tile courses, or a roofless ruin. */
function building(g, x, y, w, h, r, { ruined = false } = {}) {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate((r() - 0.5) * 0.09);
  const hw = w / 2;
  const hh = h / 2;
  if (ruined) {
    g.fillStyle = 'rgba(130,104,78,0.16)';
    g.fillRect(-hw, -hh, w, h);
    g.fillStyle = 'rgba(43,26,13,0.5)';
    for (let i = 0; i < Math.max(2, (w * h) / 14); i++) {
      g.beginPath(); g.arc(-hw + r() * w, -hh + r() * h, 0.35 + r() * 0.5, 0, Math.PI * 2); g.fill();
    }
    // broken walls: two or three sides left standing, ragged
    g.strokeStyle = 'rgba(43,26,13,0.8)';
    g.lineWidth = 0.9;
    g.lineCap = 'butt';
    const sides = [[-hw, -hh, hw, -hh], [hw, -hh, hw, hh], [hw, hh, -hw, hh], [-hw, hh, -hw, -hh]];
    const skip = Math.floor(r() * 4);
    sides.forEach(([ax, ay, bx, by], i) => {
      if (i === skip) return;
      const t0 = r() < 0.4 ? r() * 0.4 : 0;
      const t1 = r() < 0.4 ? 0.6 + r() * 0.4 : 1;
      g.beginPath(); g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0); g.lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1); g.stroke();
    });
    g.restore();
    return;
  }
  const c = ROOFS[Math.floor(r() * ROOFS.length)];
  const v = 0.85 + r() * 0.25;
  g.fillStyle = `rgba(${c[0] * v | 0},${c[1] * v | 0},${c[2] * v | 0},0.62)`;
  g.fillRect(-hw, -hh, w, h);
  const long = w >= h;
  const inset = Math.min(hw, hh);
  const [rx0, ry0, rx1, ry1] = long ? [-hw + inset, 0, hw - inset, 0] : [0, -hh + inset, 0, hh - inset];
  // the shadowed roof slopes (south and east)
  g.fillStyle = 'rgba(60,30,14,0.22)';
  g.beginPath();
  if (long) { g.moveTo(-hw, hh); g.lineTo(rx0, ry0); g.lineTo(rx1, ry1); g.lineTo(hw, -hh); g.lineTo(hw, hh); } else { g.moveTo(hw, -hh); g.lineTo(rx0, ry0); g.lineTo(rx1, ry1); g.lineTo(-hw, hh); g.lineTo(hw, hh); }
  g.closePath();
  g.fill();
  // tile courses parallel to the ridge
  g.strokeStyle = 'rgba(60,30,14,0.28)';
  g.lineWidth = 0.35;
  g.beginPath();
  if (long) for (let t = -hh + 1.4; t < hh; t += 1.6) { g.moveTo(-hw + 0.5, t); g.lineTo(hw - 0.5, t); } else for (let t = -hw + 1.4; t < hw; t += 1.6) { g.moveTo(t, -hh + 0.5); g.lineTo(t, hh - 0.5); }
  g.stroke();
  // ridge and hips
  g.strokeStyle = 'rgba(43,26,13,0.85)';
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(rx0, ry0); g.lineTo(rx1, ry1);
  g.moveTo(-hw, -hh); g.lineTo(rx0, ry0); g.lineTo(-hw, hh);
  g.moveTo(hw, -hh); g.lineTo(rx1, ry1); g.lineTo(hw, hh);
  g.stroke();
  g.lineWidth = 0.85;
  g.strokeStyle = INK.ink;
  g.strokeRect(-hw, -hh, w, h);
  // a chimney now and then
  if (r() < 0.3) {
    g.fillStyle = INK.ink;
    g.fillRect(-hw * 0.5 + r() * hw, -hh * 0.5 + r() * hh * 0.6, 1.4, 1.4);
  }
  g.restore();
}

/**
 * Streets, lanes, plazas and houses over the walled city, avoiding `blocked(x, y)`.
 * streets: [[x0,y0,x1,y1], ...] street centre lines.
 */
export function drawOldCity(g, { wall, blocked, streets, seed = 7, cell = 11 }) {
  const r = prng(seed);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of wall) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const nx = Math.ceil((maxX - minX) / cell);
  const ny = Math.ceil((maxY - minY) / cell);
  const kind = new Uint8Array(nx * ny); // 0 none, 1 street, 2 lot, 3 used
  const nearWall = (x, y) => {
    let d = Infinity;
    for (let i = 0; i < wall.length - 1; i++) d = Math.min(d, distSeg(x, y, wall[i], wall[i + 1]));
    return d;
  };
  const onStreet = (x, y) => streets.some(([ax, ay, bx, by, w = 7]) => distSeg(x, y, [ax, ay], [bx, by]) < w);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = minX + (i + 0.5) * cell;
    const y = minY + (j + 0.5) * cell;
    if (!inPoly(wall, x, y) || blocked(x, y)) continue;
    const dw = nearWall(x, y);
    if (dw < 9) continue;
    kind[j * nx + i] = dw < 17 || onStreet(x, y) ? 1 : 2;
  }
  // the ground within the walls: beaten earth and worn setts, so every gap between
  // the districts reads as a street
  g.save();
  const poly = new Path2D();
  wall.forEach(([x, y], i) => (i ? poly.lineTo(x, y) : poly.moveTo(x, y)));
  poly.closePath();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(206,180,134,0.42)';
  g.fill(poly);
  g.globalCompositeOperation = 'source-over';
  g.clip(poly);
  for (let i = 0; i < (maxX - minX) * (maxY - minY) / 9; i++) {
    const x = minX + r() * (maxX - minX);
    const y = minY + r() * (maxY - minY);
    const n = fbm(x / 40, y / 40, { period: 64, octaves: 2, seed: seed + 5 });
    if (r() > n * 1.2) continue;
    g.fillStyle = `rgba(70,50,30,${(0.18 + r() * 0.25).toFixed(2)})`;
    g.fillRect(x, y, 0.8 + r() * 1.2, 0.6 + r() * 0.6);
  }
  g.restore();
  // lots into houses: greedy rectangles, yards and the odd plaza left open
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (kind[j * nx + i] !== 2) continue;
    const x = minX + i * cell;
    const y = minY + j * cell;
    const ruinBias = 0.32 + (1 - (y - minY) / (maxY - minY)) * 0.4 + (fbm(x / 160, y / 160, { period: 64, octaves: 2, seed: seed + 3 }) - 0.5) * 0.5;
    if (r() < 0.07) {
      // a little plaza with a well
      kind[j * nx + i] = 3;
      g.fillStyle = 'rgba(200,184,150,0.35)';
      g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      g.strokeStyle = INK.ink;
      g.lineWidth = 0.6;
      g.beginPath(); g.arc(x + cell / 2, y + cell / 2, 1.8, 0, Math.PI * 2); g.stroke();
      continue;
    }
    let w = 1;
    let h = 1;
    const tw = 1 + Math.floor(r() * 3);
    const th = 1 + Math.floor(r() * 2);
    while (w < tw && i + w < nx && kind[j * nx + i + w] === 2) w++;
    outer: while (h < th && j + h < ny) {
      for (let q = 0; q < w; q++) if (kind[(j + h) * nx + i + q] !== 2) break outer;
      h++;
    }
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) kind[(j + b) * nx + i + a] = 3;
    const pad = 0.8 + r() * 0.7;
    // split a big lot into a couple of houses sharing a party wall
    const ruined = r() < ruinBias;
    if (w >= 2 && r() < 0.5) {
      const cut = Math.max(0.35, Math.min(0.65, 0.5 + (r() - 0.5) * 0.3));
      const W2 = w * cell - pad * 2;
      building(g, x + pad, y + pad, W2 * cut, h * cell - pad * 2, r, { ruined });
      building(g, x + pad + W2 * cut, y + pad, W2 * (1 - cut), h * cell - pad * 2, r, { ruined: r() < ruinBias });
    } else {
      building(g, x + pad, y + pad, w * cell - pad * 2, h * cell - pad * 2 - r() * 1.2, r, { ruined });
    }
  }
}

/**
 * The old city wall as one continuous crenellated curtain: ink faces, coursed
 * stone, merlons on the outer face, towers at the corners and at intervals
 * (round and square in turn), gatehouses at `gates` (points on the wall),
 * and breaches at `breaches` with spilled rubble.
 */
export function drawCityWall(g, pts, { gates = [], breaches = [], seed = 4, width = 15 } = {}) {
  const r = prng(seed);
  // which way is "out": the polygon's centroid tells
  let cx = 0; let cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  const gapAt = (x, y, list, rad) => list.some(([gx, gy]) => Math.hypot(gx - x, gy - y) < rad);
  const towers = [];
  g.save();
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    let nx = -uy;
    let ny = ux;
    if ((x0 + nx * 10 - cx) ** 2 + (y0 + ny * 10 - cy) ** 2 < (x0 - cx) ** 2 + (y0 - cy) ** 2) { nx = -nx; ny = -ny; }
    // walk the curtain in short lengths, skipping gates and breaches
    const step = 3;
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const [a, b] = [run[0], run[run.length - 1]];
      const A = [x0 + ux * a, y0 + uy * a];
      const B = [x0 + ux * b, y0 + uy * b];
      // body
      g.strokeStyle = INK.ink;
      g.lineWidth = width + 2.4;
      g.beginPath(); g.moveTo(...A); g.lineTo(...B); g.stroke();
      g.strokeStyle = '#b9a47c';
      g.lineWidth = width;
      g.beginPath(); g.moveTo(...A); g.lineTo(...B); g.stroke();
      // the wall-walk, dashed
      g.strokeStyle = 'rgba(43,26,13,0.5)';
      g.lineWidth = 0.6;
      g.setLineDash([2, 2]);
      g.beginPath(); g.moveTo(A[0] - nx * 1.5, A[1] - ny * 1.5); g.lineTo(B[0] - nx * 1.5, B[1] - ny * 1.5); g.stroke();
      g.setLineDash([]);
      // coursing joints across the wall
      g.strokeStyle = 'rgba(43,26,13,0.45)';
      g.lineWidth = 0.5;
      g.beginPath();
      for (let t = a + r() * 4; t < b; t += 3 + r() * 4) {
        const px = x0 + ux * t;
        const py = y0 + uy * t;
        g.moveTo(px - nx * width * 0.5, py - ny * width * 0.5);
        g.lineTo(px - nx * width * 0.1, py - ny * width * 0.1);
      }
      g.stroke();
      // merlons along the outer face
      g.fillStyle = INK.ink;
      for (let t = a + 1; t < b - 1; t += 4.2) {
        const px = x0 + ux * t + nx * (width * 0.5 + 1.1);
        const py = y0 + uy * t + ny * (width * 0.5 + 1.1);
        g.save(); g.translate(px, py); g.rotate(Math.atan2(uy, ux)); g.fillRect(-1.2, -1.1, 2.4, 2.2); g.restore();
      }
      // hatched shadow cast outward on the south and east faces
      if (nx + ny > 0.2) {
        g.strokeStyle = 'rgba(43,26,13,0.35)';
        g.lineWidth = 0.45;
        g.beginPath();
        for (let t = a; t < b; t += 1.8) {
          const px = x0 + ux * t + nx * (width * 0.5 + 2.4);
          const py = y0 + uy * t + ny * (width * 0.5 + 2.4);
          g.moveTo(px, py); g.lineTo(px + nx * 3 + ux * 1.5, py + ny * 3 + uy * 1.5);
        }
        g.stroke();
      }
      run = [];
    };
    for (let t = 0; t <= len; t += step) {
      const px = x0 + ux * t;
      const py = y0 + uy * t;
      if (gapAt(px, py, gates, 9) || gapAt(px, py, breaches, 11)) flush(); else run.push(t);
    }
    flush();
    // towers: the corner, then every ~110 units
    towers.push([x0, y0, nx, ny, true]);
    const n = Math.floor(len / 85);
    for (let k = 1; k <= n; k++) {
      const t = (k / (n + 1)) * len;
      const px = x0 + ux * t;
      const py = y0 + uy * t;
      if (!gapAt(px, py, gates, 24) && !gapAt(px, py, breaches, 20)) towers.push([px, py, nx, ny, false]);
    }
  }
  // breaches: rubble spilled both ways
  for (const [bx, by] of breaches) {
    for (let i = 0; i < 22; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 13;
      g.fillStyle = `rgba(${190 + r() * 30 | 0},${170 + r() * 25 | 0},${140 + r() * 20 | 0},0.95)`;
      g.strokeStyle = INK.ink;
      g.lineWidth = 0.5;
      g.beginPath(); g.arc(bx + Math.cos(a) * d, by + Math.sin(a) * d, 0.8 + r() * 1.6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  // towers
  towers.forEach(([x, y, nx, ny, corner], i) => {
    const round = corner || i % 3 === 1;
    const R = corner ? 16 : round ? 12 : 11.5;
    const ox = x + nx * 2.5;
    const oy = y + ny * 2.5;
    g.fillStyle = 'rgba(60,36,18,0.22)';
    g.beginPath(); g.arc(ox + 2.2, oy + 2.6, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9b48a';
    g.strokeStyle = INK.ink;
    g.lineWidth = 1.8;
    g.beginPath();
    if (round) g.arc(ox, oy, R, 0, Math.PI * 2); else g.rect(ox - R, oy - R, R * 2, R * 2);
    g.fill();
    g.stroke();
    // inner roof / floor and its shadowed half
    g.save();
    g.beginPath();
    if (round) g.arc(ox, oy, R * 0.62, 0, Math.PI * 2); else g.rect(ox - R * 0.62, oy - R * 0.62, R * 1.24, R * 1.24);
    g.clip();
    g.fillStyle = 'rgba(150,96,64,0.5)';
    g.fillRect(ox - R, oy - R, R * 2, R * 2);
    g.strokeStyle = 'rgba(43,26,13,0.5)';
    g.lineWidth = 0.4;
    g.beginPath();
    for (let t = -R; t < R; t += 1.5) { g.moveTo(ox + t, oy - R); g.lineTo(ox + t + R, oy + R); }
    g.stroke();
    g.restore();
    g.lineWidth = 0.7;
    g.beginPath();
    if (round) g.arc(ox, oy, R * 0.62, 0, Math.PI * 2); else g.rect(ox - R * 0.62, oy - R * 0.62, R * 1.24, R * 1.24);
    g.stroke();
    // merlons round the parapet
    g.fillStyle = INK.ink;
    const m = round ? 10 : 8;
    for (let k = 0; k < m; k++) {
      const a = (k / m) * Math.PI * 2;
      const px = round ? ox + Math.cos(a) * (R - 1.6) : ox + Math.max(-1, Math.min(1, Math.cos(a) * 1.5)) * (R - 1.6);
      const py = round ? oy + Math.sin(a) * (R - 1.6) : oy + Math.max(-1, Math.min(1, Math.sin(a) * 1.5)) * (R - 1.6);
      g.fillRect(px - 1, py - 1, 2, 2);
    }
  });
  // gatehouses: twin square towers and the gate passage with its portcullis
  for (const [gx, gy, ang = 0] of gates) {
    g.save();
    g.translate(gx, gy);
    g.rotate(ang);
    for (const s of [-1, 1]) {
      g.fillStyle = '#d6c39c';
      g.strokeStyle = INK.ink;
      g.lineWidth = 1.4;
      g.fillRect(s * 11 - 6, -9, 12, 18);
      g.strokeRect(s * 11 - 6, -9, 12, 18);
      g.strokeStyle = 'rgba(43,26,13,0.5)';
      g.lineWidth = 0.4;
      g.beginPath();
      for (let t = -9; t < 9; t += 1.5) { g.moveTo(s * 11 - 4, t); g.lineTo(s * 11 + 4, t + 3); }
      g.stroke();
    }
    g.strokeStyle = INK.ink;
    g.lineWidth = 0.8;
    g.setLineDash([1.2, 1.2]);
    g.beginPath(); g.moveTo(-4, 0); g.lineTo(4, 0); g.stroke();
    g.setLineDash([]);
    g.restore();
  }
  g.restore();
}

/** The harbour: a stone quay along the shore, jetties with mooring posts, a few boats; wharves at the river mouth. */
export function drawHarbour(g, { coastY, x0, x1, jetties = [], riverMouth = null, seed = 9 }) {
  const r = prng(seed);
  g.save();
  // quay: a dressed-stone edge a few units inland of the waterline
  const qy = (x) => coastY(x) - 3;
  g.fillStyle = 'rgba(204,190,160,0.95)';
  g.beginPath();
  g.moveTo(x0, qy(x0) - 8);
  for (let x = x0; x <= x1; x += 4) g.lineTo(x, qy(x) - 8);
  for (let x = x1; x >= x0; x -= 4) g.lineTo(x, qy(x) + 1);
  g.closePath();
  g.fill();
  g.strokeStyle = INK.ink;
  g.lineWidth = 1.3;
  g.beginPath();
  for (let x = x0; x <= x1; x += 4) (x === x0 ? g.moveTo(x, qy(x) + 1) : g.lineTo(x, qy(x) + 1));
  g.stroke();
  g.strokeStyle = 'rgba(43,26,13,0.45)';
  g.lineWidth = 0.45;
  g.beginPath();
  for (let x = x0 + 2; x < x1; x += 3.4 + r() * 2) { g.moveTo(x, qy(x) - 7.5); g.lineTo(x, qy(x) + 0.5); }
  g.stroke();
  for (const jx of jetties) {
    const jy = qy(jx);
    const L = 26 + r() * 16;
    g.fillStyle = 'rgba(176,140,96,0.95)';
    g.fillRect(jx - 3.5, jy, 7, L);
    g.strokeStyle = INK.ink;
    g.lineWidth = 0.9;
    g.strokeRect(jx - 3.5, jy, 7, L);
    g.strokeStyle = 'rgba(43,26,13,0.55)';
    g.lineWidth = 0.4;
    g.beginPath();
    for (let t = 2; t < L; t += 1.6) { g.moveTo(jx - 3.5, jy + t); g.lineTo(jx + 3.5, jy + t); }
    g.stroke();
    g.fillStyle = INK.ink;
    for (let t = 4; t < L; t += 8) for (const s of [-1, 1]) { g.beginPath(); g.arc(jx + s * 4.6, jy + t, 0.9, 0, Math.PI * 2); g.fill(); }
    // a moored boat
    if (r() < 0.8) {
      const s = r() < 0.5 ? -1 : 1;
      const bx = jx + s * 10;
      const by = jy + L * (0.4 + r() * 0.4);
      g.save();
      g.translate(bx, by);
      g.fillStyle = 'rgba(150,102,62,0.95)';
      g.beginPath(); g.moveTo(0, -8); g.quadraticCurveTo(4.5, -2, 3.4, 7); g.lineTo(-3.4, 7); g.quadraticCurveTo(-4.5, -2, 0, -8); g.closePath();
      g.fill();
      g.strokeStyle = INK.ink;
      g.lineWidth = 0.8;
      g.stroke();
      g.lineWidth = 0.4;
      g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.moveTo(-3, 3.5); g.lineTo(3, 3.5); g.stroke();
      g.restore();
    }
  }
  if (riverMouth) {
    const [mx, my, rwid] = riverMouth;
    for (const s of [-1, 1]) {
      const wx = mx + s * (rwid + 4);
      g.fillStyle = 'rgba(176,140,96,0.95)';
      g.fillRect(wx - 4, my - 34, 8, 30);
      g.strokeStyle = INK.ink;
      g.lineWidth = 0.9;
      g.strokeRect(wx - 4, my - 34, 8, 30);
      g.strokeStyle = 'rgba(43,26,13,0.55)';
      g.lineWidth = 0.4;
      g.beginPath();
      for (let t = 1.5; t < 30; t += 1.6) { g.moveTo(wx - 4, my - 34 + t); g.lineTo(wx + 4, my - 34 + t); }
      g.stroke();
      // a warehouse on the wharf
      g.fillStyle = 'rgba(160,104,78,0.6)';
      g.fillRect(wx + s * 6 - 6, my - 32, 12, 18);
      g.strokeStyle = INK.ink;
      g.lineWidth = 0.8;
      g.strokeRect(wx + s * 6 - 6, my - 32, 12, 18);
      g.beginPath(); g.moveTo(wx + s * 6, my - 32); g.lineTo(wx + s * 6, my - 14); g.stroke();
    }
  }
  g.restore();
}
