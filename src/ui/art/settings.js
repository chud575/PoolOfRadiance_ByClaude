import {
  rngOf, rgba, mix, glow, glowEllipse, lightShaft, fog, texture, masonry, planks, poly, linGrad, quadPt, lerp, archPath, gothicPath, contactShadow,
} from './paint.js';
import * as P from './props.js';

/**
 * Backdrop painters for every encounter / shop setting. Each returns scene
 * info for the animated overlay and figure placement:
 *   {lights:[{x,y,s,kind:'flame'|'candle'|'glow',color}], motes:{color,count,rise}, floorY, horizon, fogColor, ambient}
 */

const SKIES = {
  day: { top: '#4f6fa6', mid: '#93aecb', hor: '#e2d8bf', fog: '#bdb6a8', ground: '#6a6254', wall: '#8a8274', amb: 1, win: 0.1, sun: [0.2, 0.12, '#fff2cc'] },
  dusk: { top: '#121842', mid: '#56385e', hor: '#ee9658', fog: '#6e4a5a', ground: '#3a3036', wall: '#5a4a4c', amb: 0.6, win: 0.95, sun: [0.52, 0.52, '#ffb070'] },
  night: { top: '#02040d', mid: '#0c1430', hor: '#27314f', fog: '#26304e', ground: '#1a1c24', wall: '#2e3140', amb: 0.35, win: 1, moon: [0.8, 0.16] },
  gold: { top: '#2a1a08', mid: '#6a4a18', hor: '#e8b860', fog: '#8a6a3a', ground: '#3a2a18', wall: '#5a4a34', amb: 0.8, win: 1 },
};
const skyFor = (light) => SKIES[light === 'torch' || light === 'fire' ? 'night' : light === 'dim' ? 'dusk' : light] ?? SKIES.dusk;

/** Perspective depth mapping: world fraction d → screen fraction. */
const persp = (d, k = 5) => (1 / (1 + k * d) - 1) / (1 / (1 + k) - 1);

// ================================================================== sky & far city

function paintSky(g, W, H, sky, R, { horizon }) {
  g.fillStyle = linGrad(g, 0, 0, 0, horizon, [[0, sky.top], [0.55, sky.mid], [1, sky.hor]]);
  g.fillRect(0, 0, W, horizon + 4);
  // clouds
  g.save();
  g.globalCompositeOperation = 'soft-light';
  texture(g, 0, 0, W, horizon, { alpha: 0.6, mode: 'soft-light', cells: 3, octaves: 5, seed: R.int(1, 99), scale: 2.2 });
  g.restore();
  g.save();
  g.globalAlpha = sky.moon ? 0.12 : 0.18;
  g.globalCompositeOperation = 'screen';
  const pat = g.createPattern(cloudCanvas(R.int(1, 50)), 'repeat');
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(3, 0.9));
  g.fillStyle = pat;
  g.fillRect(0, 0, W, horizon);
  g.restore();
  if (sky.moon) {
    const [mx, my] = sky.moon;
    glow(g, W * mx, H * my, H * 0.5, '#9ab0ff', 0.25, 'screen');
    g.fillStyle = '#eef0ff';
    g.beginPath();
    g.arc(W * mx, H * my, H * 0.035, 0, Math.PI * 2);
    g.fill();
    glow(g, W * mx, H * my, H * 0.09, '#ffffff', 0.5, 'lighter');
    // stars
    const r = rngOf(77);
    for (let i = 0; i < 160; i++) {
      const sx = r() * W;
      const sy = r() * horizon * 0.8;
      g.fillStyle = `rgba(230,236,255,${0.2 + r() * 0.6})`;
      g.fillRect(sx, sy, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
    }
  }
  if (sky.sun) {
    const [sx, sy, c] = sky.sun;
    glow(g, W * sx, H * sy, H * 0.9, c, 0.45, 'screen');
    glow(g, W * sx, H * sy, H * 0.12, '#ffffff', 0.5, 'lighter');
  }
}

let _cloud = new Map();
function cloudCanvas(seed) {
  if (_cloud.has(seed)) return _cloud.get(seed);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const r = rngOf(seed);
  for (let i = 0; i < 40; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rad = 10 + r() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  _cloud.set(seed, c);
  return c;
}

/** Layered silhouettes of towers and roofs on the horizon. */
function skyline(g, W, H, sky, R, { horizon, layers = 2, ruined = 0.5, lit = true, towers = true }) {
  for (let L = 0; L < layers; L++) {
    const far = 1 - L / layers;
    const col = mix(sky.fog, '#05060a', 0.35 + L * 0.3);
    const baseY = horizon + H * 0.02;
    g.fillStyle = rgba(col);
    g.beginPath();
    g.moveTo(0, baseY);
    let x = -10;
    const pts = [];
    while (x < W + 10) {
      const w = (30 + R() * 70) * (0.7 + L * 0.3);
      const h = H * (0.05 + R() * 0.1) * (0.6 + L * 0.35);
      const top = baseY - h;
      const kind = R();
      if (towers && kind < 0.12) {
        // tower with spire (maybe broken)
        const tw = w * 0.35;
        const th = h * (1.8 + R());
        g.lineTo(x, top);
        g.lineTo(x + w * 0.3, top);
        g.lineTo(x + w * 0.3, baseY - th);
        if (R() < ruined) {
          g.lineTo(x + w * 0.3 + tw * 0.4, baseY - th - h * 0.2);
          g.lineTo(x + w * 0.3 + tw * 0.7, baseY - th + h * 0.1);
        } else g.lineTo(x + w * 0.3 + tw / 2, baseY - th - h * 0.9);
        g.lineTo(x + w * 0.3 + tw, baseY - th);
        g.lineTo(x + w * 0.3 + tw, top);
        pts.push([x + w * 0.3 + tw / 2, baseY - th * 0.7]);
      } else if (kind < 0.6) {
        // gabled roof
        g.lineTo(x, top);
        if (R() < ruined * 0.6) {
          g.lineTo(x + w * 0.3, top - h * 0.4);
          g.lineTo(x + w * 0.45, top - h * 0.1);
          g.lineTo(x + w * 0.55, top - h * 0.5);
        } else g.lineTo(x + w / 2, top - h * 0.6);
        g.lineTo(x + w, top);
      } else {
        g.lineTo(x, top + h * 0.2);
        g.lineTo(x + w, top + h * 0.2);
      }
      pts.push([x + w / 2, top + h * 0.5]);
      x += w;
    }
    g.lineTo(W, baseY);
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fill();
    if (lit && sky.win > 0.3) {
      for (const [px, py] of pts) {
        if (R() < 0.45 * far) continue;
        g.fillStyle = rgba('#ffb45a', 0.7);
        g.fillRect(px, py, 2 + L, 3 + L);
        glow(g, px, py, 7 + L * 3, '#ff9a40', 0.3);
      }
    }
    // haze between layers
    g.fillStyle = linGrad(g, 0, horizon - H * 0.2, 0, baseY, [[0, rgba(sky.fog, 0)], [1, rgba(sky.fog, 0.35 * far)]]);
    g.fillRect(0, horizon - H * 0.2, W, H * 0.22);
  }
}

// ================================================================== street template

function ground(g, W, H, sky, R, { horizon, kind = 'cobble', color = null }) {
  const base = color ?? sky.ground;
  g.fillStyle = linGrad(g, 0, horizon, 0, H, [[0, rgba(mix(base, sky.fog, 0.55))], [0.4, rgba(base)], [1, rgba(base, 1, 0.55)]]);
  g.fillRect(0, horizon, W, H - horizon);
  if (kind === 'cobble' || kind === 'flags') {
    const vpx = W / 2;
    const rows = kind === 'cobble' ? 30 : 14;
    for (let i = 0; i < rows; i++) {
      const t0 = i / rows;
      const y0 = horizon + (H - horizon) * t0 * t0;
      const y1 = horizon + (H - horizon) * ((i + 1) / rows) ** 2;
      const rh = y1 - y0;
      if (rh < 1.2) continue;
      const spread = (y0 - horizon) / (H - horizon);
      const n = kind === 'cobble' ? 60 : 22;
      const off = R() * 2;
      for (let j = -n / 2; j < n / 2; j++) {
        const u0 = (j + off - (i % 2) * 0.5) / (n / 2);
        const u1 = (j + 1 + off - (i % 2) * 0.5) / (n / 2);
        const x0 = vpx + u0 * W * (0.1 + spread * 2.2);
        const x1 = vpx + u1 * W * (0.1 + spread * 2.2);
        if (x1 < -20 || x0 > W + 20) continue;
        const k = 0.7 + R() * 0.5;
        g.fillStyle = rgba(base, 1, k * (0.8 + spread * 0.5));
        g.beginPath();
        g.roundRect(x0 + 1, y0 + 0.8, x1 - x0 - 2, rh - 1.6, Math.min(rh, x1 - x0) * 0.35);
        g.fill();
        if (rh > 4) {
          g.fillStyle = 'rgba(255,230,190,0.08)';
          g.fillRect(x0 + 2, y0 + 1, x1 - x0 - 4, rh * 0.18);
        }
      }
    }
  } else if (kind === 'dirt' || kind === 'grass') {
    texture(g, 0, horizon, W, H - horizon, { alpha: 0.55, mode: 'overlay', cells: 12, seed: R.int(1, 99), scale: 1.5 });
    if (kind === 'grass') {
      for (let i = 0; i < 900; i++) {
        const t = R();
        const y = horizon + (H - horizon) * t * t;
        const x = R() * W;
        const h = 2 + t * 14;
        g.strokeStyle = rgba(mix('#2a3a1a', sky.fog, 0.5 * (1 - t)), 0.7);
        g.lineWidth = 0.6 + t;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (R() - 0.5) * h * 0.6, y - h);
        g.stroke();
      }
    }
  }
  texture(g, 0, horizon, W, H - horizon, { alpha: 0.35, mode: 'multiply', cells: 6, octaves: 4, seed: R.int(1, 99) });
  // distance haze on the ground
  g.fillStyle = linGrad(g, 0, horizon, 0, horizon + (H - horizon) * 0.35, [[0, rgba(sky.fog, 0.7)], [1, rgba(sky.fog, 0)]]);
  g.fillRect(0, horizon, W, (H - horizon) * 0.35);
}

/**
 * One side of a street in perspective. side -1 = left, +1 = right.
 * near/far: x at the near and far ends; heights in px.
 */
function facade(g, W, H, sky, R, o) {
  const { side, horizon, nearX, farX, nearTop, farTop, ruined = 0, style = 'timber', bays = 6, lights } = o;
  const nearBot = H * 1.02;
  const farBot = horizon + H * 0.04;
  const q = side < 0
    ? [[nearX, nearTop], [farX, farTop], [farX, farBot], [nearX, nearBot]]
    : [[farX, farTop], [nearX, nearTop], [nearX, nearBot], [farX, farBot]];
  const pt = (d, v) => { // d: 0 near → 1 far (world), v: 0 top → 1 bottom
    const s = persp(d);
    return side < 0 ? quadPt(q, s, v) : quadPt(q, 1 - s, v);
  };
  // roofline (jagged if ruined)
  const outline = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const d = i / N;
    const jag = ruined ? (R() < ruined ? R() * 0.28 : R() * 0.04) : 0;
    outline.push(pt(d, jag));
  }
  for (let i = N; i >= 0; i--) outline.push(pt(i / N, 1));
  g.save();
  poly(g, outline);
  g.clip();
  const bx = Math.min(q[0][0], q[3][0]);
  const bw = Math.abs(nearX - farX) + 4;
  const wallBase = style === 'stone' ? mix(sky.wall, '#6a6258', 0.3) : mix(sky.wall, '#8a7a62', 0.35);
  if (style === 'stone') masonry(g, Math.min(nearX, farX) - 2, Math.min(nearTop, farTop), bw + 4, nearBot - Math.min(nearTop, farTop), { base: rgba(wallBase), course: 26, blockW: 56, seed: R.int(1, 99) });
  else {
    g.fillStyle = rgba(wallBase);
    g.fillRect(Math.min(nearX, farX) - 2, Math.min(nearTop, farTop), bw + 4, nearBot);
    texture(g, Math.min(nearX, farX) - 2, Math.min(nearTop, farTop), bw + 4, nearBot, { alpha: 0.5, mode: 'overlay', cells: 10, seed: R.int(1, 99) });
    texture(g, Math.min(nearX, farX) - 2, Math.min(nearTop, farTop), bw + 4, nearBot, { alpha: 0.3, mode: 'multiply', cells: 5, seed: R.int(1, 99) });
  }
  void bx;
  // stone plinth course on timber houses
  if (style === 'timber') {
    const pl = [pt(0, 0.82), pt(1, 0.82), pt(1, 1), pt(0, 1)];
    poly(g, pl);
    g.fillStyle = rgba(mix(sky.wall, '#4a443c', 0.5), 1);
    g.fill();
  }
  // bays: timber posts, beams, windows, doors
  const floors = [[0.12, 0.42], [0.5, 0.8]];
  for (let b = 0; b < bays; b++) {
    const d0 = b / bays;
    const d1 = (b + 1) / bays;
    if (style === 'timber') {
      g.fillStyle = 'rgba(28,18,10,0.95)';
      const p0 = pt(d0, 0);
      const p1 = pt(d0, 1);
      const wpx = Math.max(1.5, Math.abs(pt(d0, 0)[0] - pt(d0 + 0.015, 0)[0]));
      g.fillRect(p0[0] - wpx / 2, p0[1], wpx, p1[1] - p0[1]);
      for (const v of [0.08, 0.46, 0.82]) {
        poly(g, [pt(d0, v), pt(d1, v), pt(d1, v + 0.025), pt(d0, v + 0.025)]);
        g.fill();
      }
      // diagonal brace
      g.strokeStyle = 'rgba(28,18,10,0.9)';
      g.lineWidth = Math.max(1, wpx * 0.7);
      g.beginPath();
      g.moveTo(...pt(d0, 0.46));
      g.lineTo(...pt(d0 + (d1 - d0) * 0.3, 0.1));
      g.stroke();
    }
    for (let f = 0; f < floors.length; f++) {
      const [v0, v1] = floors[f];
      const isDoor = f === 1 && R() < 0.3;
      const u0 = d0 + (d1 - d0) * (isDoor ? 0.3 : 0.35);
      const u1 = d0 + (d1 - d0) * (isDoor ? 0.7 : 0.75);
      const vv0 = isDoor ? 0.52 : v0 + 0.06;
      const vv1 = isDoor ? 0.99 : v1 - 0.06;
      const wq = [pt(u0, vv0), pt(u1, vv0), pt(u1, vv1), pt(u0, vv1)];
      const lit = !isDoor && R() < sky.win * (ruined ? 0.35 : 0.65);
      const broken = ruined && R() < 0.5;
      // recess shadow
      poly(g, wq);
      g.fillStyle = isDoor ? '#1a100a' : lit ? rgba('#ffb458', 0.95) : broken ? '#050508' : '#12141c';
      g.fill();
      if (isDoor) {
        g.fillStyle = 'rgba(80,50,26,0.9)';
        poly(g, [pt(u0 + 0.004, vv0 + 0.02), pt(u1 - 0.004, vv0 + 0.02), pt(u1 - 0.004, vv1), pt(u0 + 0.004, vv1)]);
        g.fill();
      } else {
        if (lit) {
          const c = pt((u0 + u1) / 2, (vv0 + vv1) / 2);
          const size = Math.abs(wq[1][0] - wq[0][0]);
          glow(g, c[0], c[1], size * 2.4 + 6, '#ff9a40', 0.35);
          lights?.push({ x: c[0], y: c[1], s: size, kind: 'glow', color: '#ffa050' });
        }
        // mullion + frame
        g.strokeStyle = 'rgba(20,12,6,0.95)';
        g.lineWidth = Math.max(1, Math.abs(wq[1][0] - wq[0][0]) * 0.12);
        g.beginPath();
        g.moveTo(...pt((u0 + u1) / 2, vv0));
        g.lineTo(...pt((u0 + u1) / 2, vv1));
        g.moveTo(...pt(u0, (vv0 + vv1) / 2));
        g.lineTo(...pt(u1, (vv0 + vv1) / 2));
        g.stroke();
        poly(g, wq);
        g.stroke();
        // sill
        poly(g, [pt(u0 - 0.01, vv1), pt(u1 + 0.01, vv1), pt(u1 + 0.01, vv1 + 0.02), pt(u0 - 0.01, vv1 + 0.02)]);
        g.fillStyle = 'rgba(160,140,110,0.6)';
        g.fill();
      }
    }
  }
  // shading: light falls from the left (key) — the left facade faces right (lit by rim), right facade faces left (lit by key)
  const lit = side > 0;
  g.fillStyle = linGrad(g, nearX, 0, farX, 0, [[0, `rgba(0,0,0,${lit ? 0.15 : 0.45})`], [1, rgba(sky.fog, 0.55)]]);
  g.fillRect(Math.min(nearX, farX) - 2, 0, bw + 4, H);
  g.fillStyle = linGrad(g, 0, 0, 0, H, [[0, 'rgba(0,0,0,0.25)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.5)']]);
  g.fillRect(Math.min(nearX, farX) - 2, 0, bw + 4, H);
  g.restore();
  // roof overhang silhouette / eaves line
  g.strokeStyle = 'rgba(12,8,6,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  outline.slice(0, N + 1).forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.stroke();
  return { pt };
}

function streetScene(g, W, H, R, o) {
  const sky = skyFor(o.light);
  const horizon = H * (o.horizon ?? 0.56);
  const lights = [];
  paintSky(g, W, H, sky, R, { horizon });
  skyline(g, W, H, sky, R, { horizon, ruined: o.ruined ?? 0.4, layers: 2 });
  if (o.back) o.back(g, W, H, sky, R, { horizon, lights });
  ground(g, W, H, sky, R, { horizon, kind: o.groundKind ?? 'cobble' });
  const width = o.width ?? 0.34;
  const L = facade(g, W, H, sky, R, { side: -1, horizon, nearX: -W * 0.04, farX: W * (0.5 - width / 2), nearTop: -H * 0.25, farTop: horizon - H * 0.2, ruined: o.ruined ?? 0, style: o.leftStyle ?? 'timber', lights });
  const Rt = facade(g, W, H, sky, R, { side: 1, horizon, nearX: W * 1.04, farX: W * (0.5 + width / 2), nearTop: -H * 0.2, farTop: horizon - H * 0.22, ruined: o.ruined ?? 0, style: o.rightStyle ?? 'stone', lights });
  // wall lanterns
  if (o.lanterns !== false) {
    for (const [side, d] of [[-1, 0.28], [1, 0.45]]) {
      const p = (side < 0 ? L : Rt).pt(d, 0.44);
      P.torchSconce(g, p[0], p[1], 40 * (1 - d * 0.7));
      lights.push({ x: p[0], y: p[1], s: 16 * (1 - d * 0.7), kind: 'flame', color: '#ff9a3a' });
      glowEllipse(g, p[0] + side * -30, H * 0.9 - d * H * 0.25, 160 * (1 - d * 0.6), 40 * (1 - d * 0.6), '#ff8a30', 0.18 * (1.4 - sky.amb));
    }
  }
  return { sky, horizon, lights, L, R: Rt };
}

// ================================================================== interior template

function roomScene(g, W, H, R, o) {
  const bx0 = W * (o.bx0 ?? 0.24);
  const bx1 = W * (o.bx1 ?? 0.76);
  const by0 = H * (o.by0 ?? 0.14);
  const by1 = H * (o.by1 ?? 0.7);
  const wall = o.wall ?? '#6a5a48';
  const lights = [];
  // back wall
  if (o.wallKind === 'stone') masonry(g, bx0, by0, bx1 - bx0, by1 - by0, { base: wall, course: 20, blockW: 44, seed: R.int(1, 99) });
  else if (o.wallKind === 'wood') planks(g, bx0, by0, bx1 - bx0, by1 - by0, { base: wall, width: 22, seed: R.int(1, 99) });
  else {
    g.fillStyle = wall;
    g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    texture(g, bx0, by0, bx1 - bx0, by1 - by0, { alpha: 0.5, cells: 8, seed: R.int(1, 99) });
    texture(g, bx0, by0, bx1 - bx0, by1 - by0, { alpha: 0.3, mode: 'multiply', cells: 4, seed: R.int(1, 99) });
    if (o.wainscot) {
      planks(g, bx0, by1 - (by1 - by0) * 0.32, bx1 - bx0, (by1 - by0) * 0.32, { base: o.wainscot, width: 18, seed: 5 });
      g.fillStyle = 'rgba(20,12,6,0.9)';
      g.fillRect(bx0, by1 - (by1 - by0) * 0.33, bx1 - bx0, 4);
    }
  }
  // side walls
  const sides = [
    [[0, -H * 0.05], [bx0, by0], [bx0, by1], [0, H * 1.05]],
    [[bx1, by0], [W, -H * 0.05], [W, H * 1.05], [bx1, by1]],
  ];
  for (let si = 0; si < 2; si++) {
    const q = sides[si];
    g.save();
    poly(g, q);
    g.clip();
    if (o.wallKind === 'stone') masonry(g, si ? bx1 : 0, 0, si ? W - bx1 : bx0, H, { base: wall, course: 34, blockW: 30, seed: R.int(1, 99) });
    else if (o.wallKind === 'wood') planks(g, si ? bx1 : 0, 0, si ? W - bx1 : bx0, H, { base: wall, width: 36, vertical: false, seed: R.int(1, 99) });
    else {
      g.fillStyle = wall;
      g.fillRect(si ? bx1 : 0, 0, si ? W - bx1 : bx0, H);
      texture(g, si ? bx1 : 0, 0, si ? W - bx1 : bx0, H, { alpha: 0.5, cells: 8, seed: R.int(1, 99) });
    }
    // perspective course lines
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1.2;
    for (let i = 1; i < 8; i++) {
      const s = persp(i / 8, 3);
      const a = quadPt(q, si ? 1 - s : s, 0);
      const b = quadPt(q, si ? 1 - s : s, 1);
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.stroke();
    }
    g.fillStyle = linGrad(g, si ? W : 0, 0, si ? bx1 : bx0, 0, [[0, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0.1)']]);
    g.fillRect(si ? bx1 : 0, 0, si ? W - bx1 : bx0, H);
    g.restore();
  }
  // ceiling
  const ceil = [[0, 0], [W, 0], [bx1, by0], [bx0, by0]];
  g.save();
  poly(g, [[-5, -5], [W + 5, -5], [W + 5, 0], [bx1, by0], [bx0, by0], [-5, 0]]);
  g.clip();
  g.fillStyle = o.ceiling ?? '#1a120c';
  g.fillRect(0, 0, W, by0 + 2);
  if (o.beams !== false) {
    g.fillStyle = '#0e0906';
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x0 = lerp(0, W, t);
      const x1 = lerp(bx0, bx1, t);
      poly(g, [[x0 - 14, 0], [x0 + 14, 0], [x1 + 4, by0], [x1 - 4, by0]]);
      g.fill();
    }
    for (let i = 1; i < 5; i++) {
      const s = persp(i / 5, 3);
      const y = lerp(0, by0, s);
      const xl = lerp(0, bx0, s);
      const xr = lerp(W, bx1, s);
      g.fillStyle = 'rgba(40,26,14,0.95)';
      g.fillRect(xl, y - 5 * (1 - s) - 2, xr - xl, 10 * (1 - s) + 3);
    }
  }
  g.restore();
  void ceil;
  // floor
  const fq = [[bx0, by1], [bx1, by1], [W * 1.2, H], [-W * 0.2, H]];
  g.save();
  poly(g, fq);
  g.clip();
  const fk = o.floor ?? 'boards';
  if (fk === 'boards') {
    g.fillStyle = o.floorColor ?? '#4a3220';
    g.fillRect(0, by1, W, H - by1);
    g.strokeStyle = 'rgba(10,6,3,0.7)';
    g.lineWidth = 1.5;
    for (let i = -12; i <= 12; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * (bx1 - bx0) / 14, by1);
      g.lineTo(W / 2 + i * W * 0.11, H);
      g.stroke();
    }
    texture(g, 0, by1, W, H - by1, { alpha: 0.4, cells: 24, octaves: 3, seed: 8 });
  } else if (fk === 'flags' || fk === 'marble') {
    g.fillStyle = o.floorColor ?? (fk === 'marble' ? '#8a8272' : '#4a463e');
    g.fillRect(0, by1, W, H - by1);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1.5;
    for (let i = -8; i <= 8; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * (bx1 - bx0) / 9, by1);
      g.lineTo(W / 2 + i * W * 0.16, H);
      g.stroke();
    }
    for (let i = 1; i < 9; i++) {
      const s = ((i / 9) ** 2);
      const y = lerp(by1, H, s);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    if (fk === 'marble') {
      for (let i = -8; i <= 8; i += 2) for (let j = 0; j < 9; j += 2) {
        const s0 = (j / 9) ** 2;
        const s1 = ((j + 1) / 9) ** 2;
        const y0 = lerp(by1, H, s0);
        const y1 = lerp(by1, H, s1);
        const x = (t, k) => lerp(W / 2 + k * (bx1 - bx0) / 9, W / 2 + k * W * 0.16, t);
        poly(g, [[x(s0, i), y0], [x(s0, i + 1), y0], [x(s1, i + 1), y1], [x(s1, i), y1]]);
        g.fillStyle = 'rgba(20,16,12,0.35)';
        g.fill();
      }
    }
    texture(g, 0, by1, W, H - by1, { alpha: 0.45, cells: 10, seed: 9 });
  } else {
    g.fillStyle = o.floorColor ?? '#5a4a36';
    g.fillRect(0, by1, W, H - by1);
    texture(g, 0, by1, W, H - by1, { alpha: 0.5, cells: 16, octaves: 4, seed: 10 });
  }
  g.fillStyle = linGrad(g, 0, by1, 0, H, [[0, 'rgba(0,0,0,0.35)'], [0.3, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']]);
  g.fillRect(0, by1, W, H - by1);
  g.restore();
  // AO in the corners
  g.fillStyle = linGrad(g, 0, by1 - 30, 0, by1 + 10, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.5)']]);
  g.fillRect(bx0, by1 - 30, bx1 - bx0, 40);
  return { bx0, bx1, by0, by1, lights, horizon: by1, floorY: by1 };
}

// ================================================================== settings

const S = {};

S.slums = (g, W, H, R, o) => {
  const sc = streetScene(g, W, H, R, { ...o, light: o.light ?? 'dusk', ruined: 0.55, back: (g2, W2, H2, sky, R2, { horizon, lights }) => {
    // the far end of the street: gabled houses gutted by fire, a broken tower behind
    const col = mix(sky.wall, sky.fog, 0.55);
    const dark = mix(sky.wall, '#05060a', 0.35);
    // tower
    g2.fillStyle = rgba(mix(dark, sky.fog, 0.5));
    poly(g2, [[W2 * 0.55, horizon], [W2 * 0.55, horizon - H2 * 0.34], [W2 * 0.565, horizon - H2 * 0.37], [W2 * 0.58, horizon - H2 * 0.33], [W2 * 0.595, horizon - H2 * 0.36], [W2 * 0.6, horizon - H2 * 0.3], [W2 * 0.6, horizon]]);
    g2.fill();
    g2.fillStyle = '#ffb050';
    g2.fillRect(W2 * 0.574, horizon - H2 * 0.27, 3, 6);
    glow(g2, W2 * 0.575, horizon - H2 * 0.265, 14, '#ff9a40', 0.5);
    lights.push({ x: W2 * 0.575, y: horizon - H2 * 0.265, s: 4, kind: 'glow', color: '#ffa050' });
    const houses = [[0.36, 0.09, 0.2], [0.45, 0.1, 0.16], [0.545, 0.09, 0.12]];
    for (const [hx, hw, hh] of houses) {
      const x0 = W2 * hx;
      const x1 = x0 + W2 * hw;
      const top = horizon - H2 * hh;
      g2.fillStyle = rgba(col);
      poly(g2, [[x0, horizon + 6], [x0, top], [x0 + (x1 - x0) * 0.3, top - H2 * 0.05], [x0 + (x1 - x0) * 0.45, top - H2 * 0.02], [x0 + (x1 - x0) * 0.55, top - H2 * 0.07], [x1, top], [x1, horizon + 6]]);
      g2.fill();
      // exposed rafters
      g2.strokeStyle = rgba(dark, 0.9);
      g2.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        g2.beginPath();
        g2.moveTo(x0 + (x1 - x0) * (0.25 + k * 0.12), top - H2 * 0.01);
        g2.lineTo(x0 + (x1 - x0) * (0.32 + k * 0.12), top - H2 * (0.06 + (k % 2) * 0.02));
        g2.stroke();
      }
      // timber frame and dark windows
      g2.fillStyle = rgba(dark, 0.55);
      g2.fillRect(x0, top + H2 * 0.05, x1 - x0, 2);
      for (let k = 0; k < 3; k++) {
        const wx = x0 + (x1 - x0) * (0.18 + k * 0.28);
        const lit = R2() < 0.3;
        g2.fillStyle = lit ? '#ffa850' : rgba(dark, 0.9);
        g2.fillRect(wx, top + H2 * 0.07, (x1 - x0) * 0.12, H2 * 0.035);
        if (lit) glow(g2, wx + (x1 - x0) * 0.06, top + H2 * 0.087, 16, '#ff9a40', 0.35);
      }
    }
    g2.fillStyle = linGrad(g2, 0, horizon - H2 * 0.3, 0, horizon, [[0, rgba(sky.fog, 0)], [1, rgba(sky.fog, 0.45)]]);
    g2.fillRect(W2 * 0.3, horizon - H2 * 0.3, W2 * 0.4, H2 * 0.3);
  } });
  // hanging tavern sign on an iron bracket (left facade)
  const sp = sc.L.pt(0.16, 0.36);
  g.fillStyle = '#16100a';
  g.fillRect(sp[0], sp[1], 90, 5);
  g.strokeStyle = '#16100a';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sp[0] + 10, sp[1] + 5);
  g.lineTo(sp[0] + 60, sp[1] - 30);
  g.stroke();
  g.save();
  g.translate(sp[0] + 58, sp[1] + 6);
  g.rotate(0.08);
  g.fillStyle = linGrad(g, -28, 0, 28, 0, [[0, '#6a4a2a'], [1, '#2a1a0c']]);
  g.fillRect(-26, 8, 52, 38);
  g.fillStyle = 'rgba(210,170,90,0.55)';
  g.beginPath();
  g.ellipse(0, 27, 12, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#16100a';
  g.beginPath();
  g.moveTo(-18, 0);
  g.lineTo(-18, 8);
  g.moveTo(18, 0);
  g.lineTo(18, 8);
  g.stroke();
  g.restore();
  // smoke rising from the ruins beyond
  g.save();
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    glow(g, W * 0.62 + Math.sin(t * 5) * 30 + t * 60, sc.horizon - H * 0.12 - t * H * 0.34, 30 + t * 50, '#4a3a44', 0.22 * (1 - t), 'source-over');
  }
  g.restore();
  P.rubble(g, W * 0.2, H * 0.93, 70, { seed: 3 });
  P.rubble(g, W * 0.83, H * 0.86, 55, { seed: 4 });
  P.barrel(g, W * 0.9, H * 0.97, 90, 2);
  P.crate(g, W * 0.1, H * 0.99, 70, 5);
  fog(g, W, H * 0.68, H * 0.25, sc.sky.fog, 0.45, 5);
  // foreground framing: a broken beam across the top corner
  g.save();
  g.translate(W * 0.86, H * 0.02);
  g.rotate(0.18);
  g.fillStyle = linGrad(g, 0, -16, 0, 16, [[0, '#2a1c10'], [1, '#07050a']]);
  g.fillRect(-W * 0.2, -16, W * 0.4, 32);
  g.restore();
  return { ...sc, motes: { color: '#ffd8a0', count: 40, rise: 0.2 }, floorY: H * 0.62 };
};

S.street_day = (g, W, H, R, o) => {
  const sc = streetScene(g, W, H, R, { ...o, light: 'day', ruined: 0, rightStyle: 'timber', leftStyle: 'stone' });
  P.banner(g, W * 0.22, H * 0.18, 44, 120, '#1d3574', { emblem: 'crown', seed: 2 });
  P.banner(g, W * 0.76, H * 0.2, 40, 110, '#7c1e1c', { emblem: 'chevron', seed: 3 });
  P.barrel(g, W * 0.12, H * 0.98, 80, 7);
  P.barrel(g, W * 0.18, H * 0.95, 64, 8);
  fog(g, W, H * 0.6, H * 0.12, sc.sky.fog, 0.3, 2);
  return { ...sc, motes: { color: '#fff4d8', count: 25, rise: 0.05 }, floorY: H * 0.62 };
};

S.alley = (g, W, H, R, o) => {
  const sc = streetScene(g, W, H, R, { ...o, light: o.light ?? 'night', width: 0.16, ruined: 0.25, horizon: 0.58 });
  P.barrel(g, W * 0.14, H * 0.98, 90, 3);
  P.crate(g, W * 0.85, H * 0.99, 80, 6);
  // washing lines
  g.strokeStyle = 'rgba(20,16,12,0.9)';
  g.lineWidth = 1.5;
  for (const [y, sag] of [[H * 0.2, 30], [H * 0.34, 18]]) {
    g.beginPath();
    g.moveTo(W * 0.3, y);
    g.quadraticCurveTo(W * 0.5, y + sag, W * 0.7, y - 4);
    g.stroke();
    for (let i = 0; i < 5; i++) {
      const t = 0.15 + i * 0.16;
      const x = lerp(W * 0.3, W * 0.7, t);
      const yy = y + sag * 4 * t * (1 - t) * 0.5;
      g.fillStyle = rgba(['#5a4a3a', '#3a3a4a', '#6a5a4a'][i % 3], 0.95);
      g.fillRect(x, yy, 22, 30 + (i % 2) * 12);
    }
  }
  fog(g, W, H * 0.7, H * 0.3, sc.sky.fog, 0.5, 8);
  return { ...sc, motes: { color: '#aac0ff', count: 30, rise: -0.05 }, floorY: H * 0.64 };
};

S.plaza = (g, W, H, R, o) => {
  const sc = streetScene(g, W, H, R, { ...o, light: o.light ?? 'day', width: 0.62, ruined: 0.2, groundKind: 'flags', leftStyle: 'stone', rightStyle: 'timber', back: (g2, W2, H2, sky, R2, { horizon }) => {
    // colonnaded market hall
    const x0 = W2 * 0.2;
    const x1 = W2 * 0.8;
    const top = horizon - H2 * 0.18;
    g2.fillStyle = rgba(mix(sky.wall, sky.fog, 0.5));
    g2.fillRect(x0, top, x1 - x0, horizon - top + 10);
    g2.fillStyle = rgba(mix(sky.wall, sky.fog, 0.3), 1, 0.8);
    poly(g2, [[x0 - 10, top], [W2 / 2, top - H2 * 0.08], [x1 + 10, top]]);
    g2.fill();
    for (let i = 0; i < 9; i++) {
      const cx = lerp(x0 + 20, x1 - 20, i / 8);
      g2.fillStyle = rgba(mix(sky.wall, '#000000', 0.55), 0.9);
      archPath(g2, cx - 14, top + H2 * 0.05, 28, horizon - top - H2 * 0.04);
      g2.fill();
    }
  } });
  // statue of the founder
  const sx = W * 0.5;
  const sy = H * 0.78;
  contactShadow(g, sx, sy, 90, 18);
  g.fillStyle = linGrad(g, sx - 50, 0, sx + 50, 0, [[0, '#8a8272'], [1, '#2a2620']]);
  g.fillRect(sx - 50, sy - 70, 100, 70);
  g.fillStyle = linGrad(g, sx - 30, 0, sx + 40, 0, [[0, '#6a8a6a'], [0.5, '#3a5a44'], [1, '#14201a']]);
  poly(g, [[sx - 26, sy - 70], [sx - 20, sy - 170], [sx - 34, sy - 150], [sx - 40, sy - 158], [sx - 22, sy - 190], [sx - 8, sy - 200], [sx - 10, sy - 215], [sx + 6, sy - 225], [sx + 14, sy - 208], [sx + 12, sy - 196], [sx + 80, sy - 186], [sx + 82, sy - 178], [sx + 18, sy - 176], [sx + 22, sy - 70]]);
  g.fill();
  P.table(g, W * 0.2, H * 0.9, 70, { cloth: '#7a2a2a', seed: 3 });
  P.table(g, W * 0.8, H * 0.86, 60, { cloth: '#2a4a7a', seed: 4 });
  P.crate(g, W * 0.1, H * 0.99, 70, 9);
  fog(g, W, H * 0.62, H * 0.12, sc.sky.fog, 0.3, 4);
  return { ...sc, motes: { color: '#fff0c8', count: 30, rise: 0.05 }, floorY: H * 0.64 };
};

S.gate = (g, W, H, R, o) => {
  const sc = streetScene(g, W, H, R, { ...o, light: o.light ?? 'dusk', width: 0.5, ruined: 0.3, leftStyle: 'stone', rightStyle: 'stone', back: (g2, W2, H2, sky, R2, { horizon, lights }) => {
    const cx = W2 / 2;
    const tw = W2 * 0.1;
    const wallTop = horizon - H2 * 0.24;
    // curtain wall
    g2.save();
    g2.beginPath();
    g2.rect(W2 * 0.22, wallTop, W2 * 0.56, horizon - wallTop + 20);
    g2.clip();
    masonry(g2, W2 * 0.22, wallTop, W2 * 0.56, horizon - wallTop + 20, { base: rgba(mix(sky.wall, sky.fog, 0.35)), course: 12, blockW: 28, seed: 21 });
    g2.restore();
    // crenellations
    g2.fillStyle = rgba(mix(sky.wall, sky.fog, 0.35), 1, 0.8);
    for (let x = W2 * 0.22; x < W2 * 0.78; x += 22) g2.fillRect(x, wallTop - 12, 12, 12);
    // towers
    for (const dx of [-1, 1]) {
      const tx = cx + dx * W2 * 0.11 - tw / 2;
      const top = horizon - H2 * 0.42;
      g2.save();
      g2.beginPath();
      g2.rect(tx, top, tw, horizon - top + 20);
      g2.clip();
      masonry(g2, tx, top, tw, horizon - top + 20, { base: rgba(mix(sky.wall, sky.fog, 0.25)), course: 13, blockW: 26, seed: 22 + dx });
      g2.fillStyle = linGrad(g2, tx, 0, tx + tw, 0, [[0, 'rgba(255,190,120,0.12)'], [1, 'rgba(0,0,0,0.45)']]);
      g2.fillRect(tx, top, tw, horizon - top + 20);
      g2.restore();
      g2.fillStyle = rgba(mix(sky.wall, '#000000', 0.3));
      for (let x = tx - 4; x < tx + tw; x += 16) g2.fillRect(x, top - 14, 10, 14);
      // arrow slit with light
      g2.fillStyle = '#ffb050';
      g2.fillRect(tx + tw / 2 - 2, top + 30, 4, 18);
      glow(g2, tx + tw / 2, top + 39, 20, '#ff9a40', 0.5);
      lights.push({ x: tx + tw / 2, y: top + 8, s: 10, kind: 'flame', color: '#ff9a3a' });
    }
    // gate arch with portcullis
    const gw = W2 * 0.1;
    const gy = horizon - H2 * 0.17;
    archPath(g2, cx - gw / 2, gy, gw, horizon - gy + 6);
    g2.fillStyle = '#07080a';
    g2.fill();
    g2.save();
    archPath(g2, cx - gw / 2, gy, gw, horizon - gy + 6);
    g2.clip();
    glow(g2, cx, horizon, gw, '#ffb070', 0.25);
    g2.strokeStyle = 'rgba(40,36,34,1)';
    g2.lineWidth = 3;
    for (let x = cx - gw / 2; x < cx + gw / 2; x += 9) { g2.beginPath(); g2.moveTo(x, gy); g2.lineTo(x, horizon + 5); g2.stroke(); }
    for (let y = gy; y < horizon; y += 10) { g2.beginPath(); g2.moveTo(cx - gw / 2, y); g2.lineTo(cx + gw / 2, y); g2.stroke(); }
    g2.restore();
    // banner
    P.banner(g2, cx - 14, gy - 70, 28, 60, '#1a1612', { emblem: 'hand', trim: '#ff7a3a', tatter: 0.2, seed: 5 });
  } });
  P.rubble(g, W * 0.15, H * 0.95, 60, { seed: 12 });
  fog(g, W, H * 0.64, H * 0.2, sc.sky.fog, 0.4, 7);
  return { ...sc, motes: { color: '#ffc080', count: 35, rise: 0.25 }, floorY: H * 0.64 };
};

S.keep = (g, W, H, R, o) => {
  const sky = skyFor(o.light ?? 'night');
  const horizon = H * 0.6;
  const lights = [];
  paintSky(g, W, H, sky, R, { horizon });
  // sea
  g.fillStyle = linGrad(g, 0, horizon, 0, H, [[0, rgba(mix(sky.hor, '#0a1424', 0.4))], [1, '#02050a']]);
  g.fillRect(0, horizon, W, H - horizon);
  for (let i = 0; i < 260; i++) {
    const t = R();
    const y = horizon + (H - horizon) * t * t;
    const x = R() * W;
    g.fillStyle = `rgba(170,190,255,${0.05 + t * 0.12})`;
    g.fillRect(x, y, 6 + t * 50, 1 + t * 1.5);
  }
  if (sky.moon) {
    const mx = W * sky.moon[0];
    g.save();
    g.globalCompositeOperation = 'screen';
    for (let i = 0; i < 40; i++) {
      const y = horizon + (H - horizon) * (i / 40) ** 1.5;
      g.fillStyle = `rgba(200,210,255,${0.28 * (1 - i / 40)})`;
      g.fillRect(mx - 8 - i * 1.5 + Math.sin(i * 2.1) * 6, y, 16 + i * 3, 2);
    }
    g.restore();
  }
  // the keep on its island rock
  const kx = W * 0.5;
  const rockTop = horizon - H * 0.05;
  g.fillStyle = '#07090e';
  poly(g, [[W * 0.1, horizon + 16], [W * 0.18, rockTop], [W * 0.82, rockTop - 6], [W * 0.9, horizon + 18]]);
  g.fill();
  const wallTop = horizon - H * 0.3;
  g.save();
  g.beginPath();
  g.rect(W * 0.18, wallTop, W * 0.64, rockTop - wallTop + 2);
  g.clip();
  masonry(g, W * 0.18, wallTop, W * 0.64, rockTop - wallTop + 2, { base: rgba(mix(sky.wall, '#1a1e2a', 0.4)), course: 14, blockW: 30, seed: 51, ruined: 0.02 });
  g.fillStyle = linGrad(g, 0, wallTop, 0, rockTop, [[0, 'rgba(10,14,30,0.35)'], [1, 'rgba(0,0,0,0.6)']]);
  g.fillRect(W * 0.18, wallTop, W * 0.64, rockTop - wallTop);
  g.restore();
  g.fillStyle = rgba(mix(sky.wall, '#000000', 0.5));
  for (let x = W * 0.18; x < W * 0.82; x += 24) g.fillRect(x, wallTop - 12, 13, 12);
  // towers
  for (const [tx, th, tw] of [[0.2, 0.5, 0.07], [0.5, 0.62, 0.1], [0.78, 0.46, 0.07]]) {
    const x = W * tx - (W * tw) / 2;
    const top = horizon - H * th;
    g.save();
    g.beginPath();
    g.rect(x, top, W * tw, rockTop - top);
    g.clip();
    masonry(g, x, top, W * tw, rockTop - top, { base: rgba(mix(sky.wall, '#1a1e2a', 0.3)), course: 14, blockW: 28, seed: 52 + tx * 10 });
    g.fillStyle = linGrad(g, x, 0, x + W * tw, 0, [[0, 'rgba(0,0,0,0.6)'], [0.6, 'rgba(0,0,0,0.2)'], [1, 'rgba(150,170,255,0.18)']]);
    g.fillRect(x, top, W * tw, rockTop - top);
    g.restore();
    g.fillStyle = rgba(mix(sky.wall, '#000000', 0.45));
    for (let cx = x - 3; cx < x + W * tw; cx += 16) g.fillRect(cx, top - 12, 10, 12);
    // pale ghost-light in a window
    g.fillStyle = '#bff8ff';
    g.fillRect(x + (W * tw) / 2 - 3, top + 34, 6, 12);
    glow(g, x + (W * tw) / 2, top + 40, 26, '#8ff0ff', 0.5);
  }
  lights.push({ x: kx + W * 0.03, y: wallTop - 16, s: 14, kind: 'ghost', color: '#8ff0ff' });
  fog(g, W, horizon + 4, H * 0.12, sky.fog, 0.6, 11);
  fog(g, W, H * 0.85, H * 0.3, sky.fog, 0.35, 12);
  // near landing stones
  g.fillStyle = linGrad(g, 0, H * 0.82, 0, H, [[0, '#1c1e24'], [1, '#08090c']]);
  poly(g, [[0, H * 0.84], [W * 0.3, H * 0.8], [W * 0.7, H * 0.81], [W, H * 0.86], [W, H], [0, H]]);
  g.fill();
  texture(g, 0, H * 0.8, W, H * 0.2, { alpha: 0.5, cells: 12, seed: 55 });
  return { sky, horizon, lights, motes: { color: '#aef4ff', count: 40, rise: 0.1 }, floorY: H * 0.84 };
};

S.graveyard = (g, W, H, R, o) => {
  const sky = skyFor(o.light === 'green' ? 'night' : o.light ?? 'night');
  const horizon = H * 0.56;
  const lights = [];
  paintSky(g, W, H, sky, R, { horizon });
  skyline(g, W, H, sky, R, { horizon, layers: 1, ruined: 0.7, lit: false });
  // dead trees
  g.strokeStyle = '#05070c';
  for (const [tx, th] of [[0.08, 0.45], [0.9, 0.5], [0.72, 0.3]]) {
    const x = W * tx;
    const base = horizon + H * 0.1;
    const branch = (x0, y0, len, ang, w) => {
      if (len < 6) return;
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      branch(x1, y1, len * 0.72, ang - 0.45 + R() * 0.2, w * 0.7);
      branch(x1, y1, len * 0.66, ang + 0.4 + R() * 0.2, w * 0.65);
    };
    branch(x, base, H * th * 0.35, -Math.PI / 2 + (R() - 0.5) * 0.2, 9);
  }
  ground(g, W, H, sky, R, { horizon, kind: 'grass', color: '#22281e' });
  // mausoleum at the back
  const mx = W * 0.5;
  const mt = horizon - H * 0.2;
  g.save();
  g.beginPath();
  g.rect(mx - W * 0.12, mt, W * 0.24, horizon - mt + 14);
  g.clip();
  masonry(g, mx - W * 0.12, mt, W * 0.24, horizon - mt + 14, { base: rgba(mix('#8a8478', sky.fog, 0.4)), course: 12, blockW: 30, seed: 61 });
  g.restore();
  g.fillStyle = rgba(mix('#8a8478', sky.fog, 0.3), 1, 0.8);
  poly(g, [[mx - W * 0.14, mt], [mx, mt - H * 0.1], [mx + W * 0.14, mt]]);
  g.fill();
  for (const dx of [-0.09, -0.045, 0.045, 0.09]) P.column(g, mx + W * dx, mt + 6, horizon + 12, 14, { base: rgba(mix('#b0aa9a', sky.fog, 0.3)) });
  archPath(g, mx - 22, mt + H * 0.06, 44, horizon - mt - H * 0.05);
  g.fillStyle = o.light === 'green' ? '#0c1a0e' : '#050608';
  g.fill();
  if (o.light === 'green') {
    glow(g, mx, horizon - 20, 90, '#50ff70', 0.45);
    lights.push({ x: mx, y: horizon - 18, s: 18, kind: 'glow', color: '#5aff7a' });
  }
  // iron fence
  g.strokeStyle = '#0a0b0e';
  g.lineWidth = 3;
  const fy = horizon + H * 0.13;
  g.beginPath();
  g.moveTo(0, fy - 36);
  g.lineTo(W, fy - 36);
  g.moveTo(0, fy - 8);
  g.lineTo(W, fy - 8);
  g.stroke();
  for (let x = 4; x < W; x += 14) {
    g.beginPath();
    g.moveTo(x, fy);
    g.lineTo(x, fy - 48);
    g.stroke();
    g.fillStyle = '#0a0b0e';
    poly(g, [[x - 4, fy - 46], [x, fy - 56], [x + 4, fy - 46]]);
    g.fill();
  }
  // gravestones in rows (back to front)
  const rows = [[0.7, 26, 9], [0.8, 38, 7], [0.92, 56, 5]];
  for (const [ty, s, n] of rows) {
    for (let i = 0; i < n; i++) {
      const x = W * (0.04 + (i + (ty > 0.8 ? 0.5 : 0)) / n) + (R() - 0.5) * 30;
      if (Math.abs(x - W / 2) < W * 0.14 && ty > 0.75) continue;
      P.gravestone(g, x, H * ty + (R() - 0.5) * 8, s * (0.9 + R() * 0.3), { kind: R.int(0, 2), lean: (R() - 0.5) * 0.25, base: rgba(mix('#8a8478', sky.fog, 0.4 * (1 - ty))), seed: i * 7 + s });
    }
  }
  P.angelStatue(g, W * 0.18, H * 0.86, 110, { base: '#8a8a84' });
  fog(g, W, H * 0.72, H * 0.2, sky.fog, 0.55, 14);
  fog(g, W, H * 0.92, H * 0.2, sky.fog, 0.4, 15);
  return { sky, horizon, lights, motes: { color: o.light === 'green' ? '#8aff9a' : '#c8d8ff', count: 30, rise: 0.02 }, floorY: H * 0.66 };
};

S.wilds = (g, W, H, R, o) => {
  const sky = skyFor(o.light ?? 'dusk');
  const horizon = H * 0.58;
  paintSky(g, W, H, sky, R, { horizon });
  // mountains
  for (let L = 0; L < 3; L++) {
    g.fillStyle = rgba(mix(sky.fog, '#05080a', 0.2 + L * 0.28));
    g.beginPath();
    g.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, horizon - H * (0.08 + 0.1 * Math.abs(Math.sin(x * 0.004 * (L + 1) + L * 2))) * (1 - L * 0.25) - R() * 6);
    g.lineTo(W, horizon + 10);
    g.closePath();
    g.fill();
  }
  ground(g, W, H, sky, R, { horizon, kind: 'grass', color: '#2a3220' });
  // the road
  g.fillStyle = linGrad(g, 0, horizon, 0, H, [[0, rgba(mix('#6a5a44', sky.fog, 0.5))], [1, '#4a3c2c']]);
  poly(g, [[W * 0.48, horizon], [W * 0.52, horizon], [W * 0.8, H], [W * 0.2, H]]);
  g.fill();
  texture(g, W * 0.2, horizon, W * 0.6, H - horizon, { alpha: 0.45, cells: 16, seed: 71 });
  // pine forests left and right, far to near
  for (const [n, h0, h1, y0] of [[30, 30, 50, 0.6], [16, 80, 130, 0.72], [7, 220, 340, 0.98]]) {
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side < 0 ? R() * W * 0.36 : W - R() * W * 0.36;
      P.pine(g, x, H * y0 + (R() - 0.5) * 10, h0 + R() * (h1 - h0), { color: rgba(mix('#0c140e', sky.fog, 0.5 * (1 - y0 + 0.4))), seed: i * 13 + n });
    }
  }
  fog(g, W, horizon + 10, H * 0.14, sky.fog, 0.55, 17);
  return { sky, horizon, lights: [], motes: { color: '#ffe0a0', count: 30, rise: 0.05 }, floorY: H * 0.66 };
};

S.docks = (g, W, H, R, o) => {
  const sky = skyFor(o.light ?? 'dusk');
  const horizon = H * 0.55;
  const lights = [];
  paintSky(g, W, H, sky, R, { horizon });
  // distant keep on its island
  g.fillStyle = rgba(mix('#0a0c14', sky.fog, 0.45));
  poly(g, [[W * 0.62, horizon + 2], [W * 0.64, horizon - 30], [W * 0.66, horizon - 30], [W * 0.66, horizon - 60], [W * 0.68, horizon - 70], [W * 0.7, horizon - 60], [W * 0.7, horizon - 36], [W * 0.78, horizon - 36], [W * 0.8, horizon + 2]]);
  g.fill();
  g.fillStyle = '#bff8ff';
  g.fillRect(W * 0.68 - 1, horizon - 54, 2, 4);
  glow(g, W * 0.68, horizon - 52, 14, '#8ff0ff', 0.5);
  // water
  g.fillStyle = linGrad(g, 0, horizon, 0, H, [[0, rgba(mix(sky.hor, '#10202e', 0.55))], [1, '#050a10']]);
  g.fillRect(0, horizon, W, H - horizon);
  for (let i = 0; i < 300; i++) {
    const t = R();
    const y = horizon + (H - horizon) * t * t;
    g.fillStyle = rgba(sky.hor, 0.06 + t * 0.12);
    g.fillRect(R() * W, y, 4 + t * 40, 1 + t);
  }
  // pier in perspective
  g.fillStyle = '#2a1c10';
  poly(g, [[W * 0.46, horizon + 6], [W * 0.52, horizon + 6], [W * 0.8, H], [W * 0.18, H]]);
  g.fill();
  g.save();
  poly(g, [[W * 0.46, horizon + 6], [W * 0.52, horizon + 6], [W * 0.8, H], [W * 0.18, H]]);
  g.clip();
  for (let i = 0; i < 24; i++) {
    const y = horizon + 6 + (H - horizon) * (i / 24) ** 2;
    g.fillStyle = i % 2 ? '#4a3220' : '#3a2616';
    g.fillRect(0, y, W, Math.max(1, (H - horizon) * (((i + 1) / 24) ** 2 - (i / 24) ** 2)) - 1);
  }
  texture(g, 0, horizon, W, H - horizon, { alpha: 0.45, cells: 24, seed: 81 });
  g.restore();
  // piles
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) ** 1.6;
    for (const side of [-1, 1]) {
      const x = lerp(W * 0.49, side < 0 ? W * 0.14 : W * 0.84, t) + side * 6;
      const y = horizon + (H - horizon) * t;
      const w = 4 + t * 26;
      g.fillStyle = '#1a120a';
      g.fillRect(x - w / 2, y - w * 2.5, w, w * 2.5 + 8);
    }
  }
  // a rowing boat moored
  const bx = W * 0.24;
  const by = H * 0.8;
  g.fillStyle = linGrad(g, 0, by - 30, 0, by + 10, [[0, '#6a4a2a'], [1, '#1a100a']]);
  g.beginPath();
  g.moveTo(bx - 120, by - 26);
  g.quadraticCurveTo(bx, by + 30, bx + 120, by - 30);
  g.lineTo(bx + 100, by - 40);
  g.quadraticCurveTo(bx, by - 18, bx - 110, by - 36);
  g.closePath();
  g.fill();
  // lamp post
  P.torchSconce(g, W * 0.7, H * 0.52, 60);
  lights.push({ x: W * 0.7, y: H * 0.52, s: 18, kind: 'flame', color: '#ffa040' });
  fog(g, W, horizon + 10, H * 0.14, sky.fog, 0.6, 19);
  return { sky, horizon, lights, motes: { color: '#fff0c8', count: 20, rise: 0.05 }, floorY: H * 0.7 };
};

S.well_head = (g, W, H, R, o) => {
  const sc = S.plaza(g, W, H, R, { ...o, light: o.light ?? 'dusk' });
  P.wellHead(g, W * 0.5, H * 0.86, 90);
  return sc;
};

S.ruined_temple = (g, W, H, R, o) => {
  const sky = skyFor(o.light ?? 'day');
  const horizon = H * 0.6;
  paintSky(g, W, H, sky, R, { horizon });
  skyline(g, W, H, sky, R, { horizon, layers: 2, ruined: 0.6 });
  ground(g, W, H, sky, R, { horizon, kind: 'flags', color: '#5a564c' });
  // apse wall with an empty rose window
  const ax = W * 0.5;
  g.save();
  poly(g, [[W * 0.28, horizon + 8], [W * 0.28, horizon - H * 0.3], [W * 0.36, horizon - H * 0.44], [W * 0.46, horizon - H * 0.5], [W * 0.56, horizon - H * 0.38], [W * 0.62, horizon - H * 0.46], [W * 0.72, horizon - H * 0.28], [W * 0.72, horizon + 8]]);
  g.clip();
  masonry(g, W * 0.28, horizon - H * 0.5, W * 0.44, H * 0.52, { base: rgba(mix('#8a8274', sky.fog, 0.3)), course: 14, blockW: 30, seed: 91, ruined: 0.04 });
  g.restore();
  g.beginPath();
  g.arc(ax, horizon - H * 0.3, H * 0.09, 0, Math.PI * 2);
  g.fillStyle = linGrad(g, 0, horizon - H * 0.4, 0, horizon - H * 0.2, [[0, sky.mid], [1, sky.hor]]);
  g.fill();
  g.strokeStyle = 'rgba(40,36,30,0.95)';
  g.lineWidth = 5;
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (i === 3 || i === 6) continue;
    g.beginPath();
    g.moveTo(ax, horizon - H * 0.3);
    g.lineTo(ax + Math.cos(a) * H * 0.09, horizon - H * 0.3 + Math.sin(a) * H * 0.09);
    g.stroke();
  }
  // altar split in two
  g.fillStyle = linGrad(g, 0, horizon - 30, 0, horizon + 10, [[0, '#b0a898'], [1, '#4a443a']]);
  poly(g, [[ax - 70, horizon + 12], [ax - 64, horizon - 28], [ax - 6, horizon - 30], [ax - 12, horizon + 12]]);
  g.fill();
  poly(g, [[ax + 4, horizon + 12], [ax + 10, horizon - 26], [ax + 68, horizon - 22], [ax + 72, horizon + 12]]);
  g.fill();
  // colonnade, some broken
  const cols = [[0.08, 0], [0.2, 0.4], [0.8, 0], [0.92, 0.55], [0.33, 0.62], [0.67, 0.2]];
  for (const [cx, br] of cols) {
    const near = Math.abs(cx - 0.5) > 0.35;
    P.column(g, W * cx, near ? -20 : horizon - H * 0.32, near ? H * 1.02 : horizon + 14, near ? 64 : 26, { base: rgba(mix('#a09888', sky.fog, near ? 0 : 0.3)), broken: br, seed: cx * 100 });
  }
  P.rubble(g, W * 0.24, H * 0.9, 60, { seed: 21 });
  P.rubble(g, W * 0.74, H * 0.95, 70, { seed: 22 });
  lightShaft(g, W * 0.46, 0, 90, W * 0.52, H * 0.9, 260, '#fff0c8', 0.22);
  fog(g, W, H * 0.64, H * 0.14, sky.fog, 0.35, 23);
  return { sky, horizon, lights: [], motes: { color: '#fff4d0', count: 40, rise: 0.04 }, floorY: H * 0.66 };
};

// ---------------------------------------------------------------- interiors

S.tenement = (g, W, H, R, o) => {
  const rm = roomScene(g, W, H, R, { wall: '#5a4c3e', floor: 'boards', floorColor: '#3a2a1c', beams: true });
  // hole in the back wall showing the night street
  g.save();
  poly(g, [[W * 0.42, H * 0.2], [W * 0.5, H * 0.16], [W * 0.62, H * 0.22], [W * 0.6, H * 0.5], [W * 0.46, H * 0.54], [W * 0.4, H * 0.4]]);
  g.clip();
  const sky = skyFor(o.light === 'torch' ? 'night' : 'dusk');
  g.fillStyle = linGrad(g, 0, H * 0.16, 0, H * 0.54, [[0, sky.mid], [1, sky.hor]]);
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0a0a10';
  poly(g, [[W * 0.38, H * 0.56], [W * 0.44, H * 0.34], [W * 0.48, H * 0.4], [W * 0.54, H * 0.3], [W * 0.6, H * 0.42], [W * 0.64, H * 0.56]]);
  g.fill();
  g.restore();
  lightShaft(g, W * 0.52, H * 0.3, 70, W * 0.44, H * 0.95, 240, sky.hor, 0.25);
  P.rubble(g, W * 0.48, H * 0.78, 70, { seed: 31, base: '#5a4c3e' });
  P.table(g, W * 0.22, H * 0.92, 80, { items: false });
  P.barrel(g, W * 0.82, H * 0.95, 90, 4);
  // broken beam across
  g.save();
  g.translate(W * 0.7, H * 0.3);
  g.rotate(0.5);
  g.fillStyle = linGrad(g, 0, -12, 0, 12, [[0, '#4a3018'], [1, '#140c06']]);
  g.fillRect(-W * 0.3, -12, W * 0.55, 24);
  g.restore();
  const lights = [];
  if (o.light === 'torch') {
    P.brazier(g, W * 0.62, H * 0.86, 90);
    lights.push({ x: W * 0.62, y: H * 0.86 - 60, s: 40, kind: 'flame', color: '#ff8a30' });
    glowEllipse(g, W * 0.62, H * 0.9, 380, 90, '#ff7a20', 0.35);
    glow(g, W * 0.62, H * 0.7, 420, '#ff8a30', 0.25);
  }
  return { ...rm, lights, sky, motes: { color: '#ffd8a0', count: 50, rise: 0.08 }, floorY: rm.by1 };
};

S.tavern = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#6a4e34', wallKind: 'plaster', wainscot: '#3a2414', floor: 'boards', floorColor: '#3e2a18' });
  const lights = [];
  // hearth in the back wall
  const hx = W * 0.5;
  const hy = rm.by1;
  g.save();
  g.beginPath();
  g.rect(hx - 110, hy - 150, 220, 150);
  g.clip();
  masonry(g, hx - 110, hy - 150, 220, 150, { base: '#6a6258', course: 16, blockW: 34, seed: 101 });
  g.restore();
  archPath(g, hx - 64, hy - 100, 128, 100);
  g.fillStyle = '#120804';
  g.fill();
  g.fillStyle = '#2a1a0e';
  g.fillRect(hx - 130, hy - 160, 260, 16);
  lights.push({ x: hx, y: hy - 14, s: 42, kind: 'flame', color: '#ff7a20' });
  glow(g, hx, hy - 30, 520, '#ff7a20', 0.35);
  glowEllipse(g, hx, hy + 60, 520, 120, '#ff8a30', 0.3);
  // shelves of bottles
  P.bottleShelf(g, W * 0.27, H * 0.24, W * 0.14, H * 0.3, { seed: 3 });
  P.bottleShelf(g, W * 0.59, H * 0.24, W * 0.14, H * 0.3, { seed: 4 });
  // lanterns from the beams
  for (const lx of [0.3, 0.7]) {
    g.strokeStyle = '#140c06';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W * lx, 0);
    g.lineTo(W * lx, H * 0.16);
    g.stroke();
    g.fillStyle = '#2a1c10';
    g.fillRect(W * lx - 10, H * 0.16, 20, 26);
    lights.push({ x: W * lx, y: H * 0.16 + 20, s: 12, kind: 'candle', color: '#ffb050' });
    glow(g, W * lx, H * 0.2, 260, '#ffa040', 0.22);
  }
  P.table(g, W * 0.24, H * 0.9, 100, { seed: 5 });
  P.table(g, W * 0.78, H * 0.86, 90, { seed: 6 });
  P.barrel(g, W * 0.06, H * 0.99, 130, 7);
  P.barrel(g, W * 0.94, H * 0.99, 120, 8);
  return { ...rm, lights, motes: { color: '#ffc880', count: 30, rise: 0.15 }, floorY: rm.by1 };
};

S.temple = (g, W, H, R, o) => {
  const d = o.deity ?? { glass: ['#2a4ea8', '#e8c860', '#f4f0e0'], banner: '#1d3574', symbol: 'scales' };
  const rm = roomScene(g, W, H, R, { wall: '#7a7266', wallKind: 'stone', floor: 'marble', floorColor: '#6a6458', by0: 0.04, by1: 0.72, bx0: 0.28, bx1: 0.72, beams: false, ceiling: '#141018' });
  const lights = [];
  // great stained-glass window
  const ww = W * 0.12;
  P.windowLit(g, W / 2 - ww / 2, H * 0.1, ww, H * 0.34, { gothic: true, glass: d.glass, frame: '#1a1410' });
  lightShaft(g, W / 2, H * 0.3, ww * 0.8, W / 2 + 20, H * 0.98, W * 0.3, d.glass[0], 0.3);
  lightShaft(g, W / 2, H * 0.3, ww * 0.5, W / 2 - 10, H * 0.98, W * 0.18, d.glass[1], 0.2);
  // side windows on the nave walls
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const t = persp(i / 3 + 0.12, 3);
      const x = side < 0 ? lerp(W * 0.04, W * 0.28, t) : lerp(W * 0.96, W * 0.72, t);
      const w = lerp(W * 0.06, W * 0.02, t);
      const top = lerp(H * 0.1, H * 0.14, t);
      P.windowLit(g, x - w / 2, top, w, lerp(H * 0.4, H * 0.24, t), { gothic: true, glass: d.glass, frame: '#1a1410' });
    }
  }
  // altar and dais
  g.fillStyle = linGrad(g, 0, rm.by1 - 20, 0, rm.by1 + 20, [[0, '#8a8274'], [1, '#3a3630']]);
  g.fillRect(W * 0.36, rm.by1 - 8, W * 0.28, 24);
  g.fillStyle = linGrad(g, W * 0.44, 0, W * 0.56, 0, [[0, '#d8d0c0'], [1, '#6a645a']]);
  g.fillRect(W * 0.44, rm.by1 - 60, W * 0.12, 54);
  g.fillStyle = d.banner;
  g.fillRect(W * 0.455, rm.by1 - 60, W * 0.09, 40);
  P.emblemShape(g, d.symbol, W / 2, rm.by1 - 42, 12, '#e8c860');
  // candles on the altar and candelabra
  for (const cx of [0.43, 0.46, 0.54, 0.57]) {
    P.candle(g, W * cx, rm.by1 - 58, 30);
    lights.push({ x: W * cx, y: rm.by1 - 70, s: 7, kind: 'candle', color: '#ffc060' });
  }
  glow(g, W / 2, rm.by1 - 60, 200, '#ffb050', 0.3);
  // banners
  P.banner(g, W * 0.31, H * 0.16, 40, 150, d.banner, { emblem: d.symbol, seed: 7 });
  P.banner(g, W * 0.66, H * 0.16, 40, 150, d.banner, { emblem: d.symbol, seed: 8 });
  // pews
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const y = lerp(rm.by1 + 30, H * 0.98, t * t + t * 0.2);
    const s = 0.4 + t * 0.9;
    for (const side of [-1, 1]) {
      const x0 = W / 2 + side * W * 0.06 * s;
      const x1 = W / 2 + side * W * 0.34 * s;
      g.fillStyle = linGrad(g, 0, y - 36 * s, 0, y, [[0, '#5a3a20'], [1, '#1a0e06']]);
      g.fillRect(Math.min(x0, x1), y - 36 * s, Math.abs(x1 - x0), 36 * s);
      g.fillStyle = 'rgba(255,210,150,0.2)';
      g.fillRect(Math.min(x0, x1), y - 36 * s, Math.abs(x1 - x0), 3 * s);
    }
  }
  // columns in front of the side walls
  for (const side of [-1, 1]) P.column(g, W / 2 + side * W * 0.43, -10, H * 1.02, 70, { base: '#8a8274', seed: 3 + side });
  return { ...rm, lights, motes: { color: '#fff0d0', count: 60, rise: 0.03 }, floorY: rm.by1 };
};

S.chapel = (g, W, H, R, o) => {
  const sc = S.temple(g, W, H, R, { deity: { glass: ['#3a6a8a', '#9ac8e8', '#d8f0ff'], banner: '#2a3a4a', symbol: 'sword' } });
  // ruined, cold: desaturate with blue wash
  g.save();
  g.globalCompositeOperation = 'color';
  g.fillStyle = 'rgba(40,70,100,0.55)';
  g.fillRect(0, 0, W, H);
  g.restore();
  P.rubble(g, W * 0.2, H * 0.95, 70, { seed: 41, base: '#6a6a70' });
  if (o.light === 'ghost') glow(g, W / 2, H * 0.6, 420, '#8ff0ff', 0.25, 'screen');
  return { ...sc, motes: { color: '#aef4ff', count: 60, rise: 0.08 } };
};

S.cityhall = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#6a5a4a', wallKind: 'stone', floor: 'marble', floorColor: '#5a4a3a', by0: 0.06, by1: 0.7, bx0: 0.26, bx1: 0.74, ceiling: '#120c08' });
  const lights = [];
  // tall windows with late light
  for (const x of [0.32, 0.62]) P.windowLit(g, W * x, H * 0.12, W * 0.06, H * 0.3, { arch: true, color: '#ffc880', lit: 0.9 });
  lightShaft(g, W * 0.35, H * 0.3, 60, W * 0.3, H * 0.98, 220, '#ffd090', 0.22);
  lightShaft(g, W * 0.65, H * 0.3, 60, W * 0.72, H * 0.98, 220, '#ffd090', 0.22);
  // banners of the old city
  P.banner(g, W * 0.44, H * 0.1, 36, 120, '#1d3574', { emblem: 'crown', tatter: 0.12, seed: 2 });
  P.banner(g, W * 0.53, H * 0.1, 36, 120, '#7c1e1c', { emblem: 'scales', tatter: 0.12, seed: 3 });
  // dais and the clerk's desk
  g.fillStyle = linGrad(g, 0, rm.by1 - 10, 0, rm.by1 + 30, [[0, '#6a5a48'], [1, '#2a2018']]);
  g.fillRect(W * 0.3, rm.by1 - 6, W * 0.4, 30);
  g.fillStyle = linGrad(g, 0, rm.by1 - 70, 0, rm.by1, [[0, '#6a4424'], [1, '#2a1a0c']]);
  g.fillRect(W * 0.38, rm.by1 - 64, W * 0.24, 60);
  g.fillStyle = 'rgba(255,220,160,0.25)';
  g.fillRect(W * 0.38, rm.by1 - 64, W * 0.24, 4);
  // ledger and candles
  g.fillStyle = '#e8dcc0';
  poly(g, [[W * 0.46, rm.by1 - 66], [W * 0.54, rm.by1 - 66], [W * 0.56, rm.by1 - 60], [W * 0.44, rm.by1 - 60]]);
  g.fill();
  for (const cx of [0.4, 0.6]) {
    P.candle(g, W * cx, rm.by1 - 64, 34);
    lights.push({ x: W * cx, y: rm.by1 - 78, s: 8, kind: 'candle', color: '#ffc060' });
    glow(g, W * cx, rm.by1 - 76, 120, '#ffb050', 0.3);
  }
  // notice board on the left wall
  g.save();
  g.transform(1, -0.2, 0, 1, 0, 0);
  P.noticeBoard(g, W * 0.07, H * 0.34, W * 0.13, H * 0.28, 5);
  g.restore();
  // shelves of ledgers on the right wall
  g.save();
  g.transform(1, 0.2, 0, 1, 0, -W * 0.15);
  P.bookshelf(g, W * 0.8, H * 0.26, W * 0.14, H * 0.5, { seed: 6 });
  g.restore();
  for (const side of [-1, 1]) P.column(g, W / 2 + side * W * 0.4, -10, H * 1.02, 60, { base: '#7a6a58', seed: 9 + side });
  return { ...rm, lights, motes: { color: '#ffe0b0', count: 50, rise: 0.03 }, floorY: rm.by1 };
};

S.smithy = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#4a4038', wallKind: 'stone', floor: 'dirt', floorColor: '#3a3028' });
  const lights = [];
  // forge
  const fx = W * 0.36;
  const fy = rm.by1;
  g.save();
  g.beginPath();
  g.rect(fx - 90, fy - 170, 180, 170);
  g.clip();
  masonry(g, fx - 90, fy - 170, 180, 170, { base: '#5a4e44', course: 14, blockW: 30, seed: 111 });
  g.restore();
  archPath(g, fx - 50, fy - 90, 100, 90);
  g.fillStyle = '#1a0602';
  g.fill();
  glow(g, fx, fy - 30, 60, '#ff5a10', 0.9);
  lights.push({ x: fx, y: fy - 16, s: 34, kind: 'flame', color: '#ff6a18' });
  glow(g, fx, fy - 20, 520, '#ff6a20', 0.4);
  glowEllipse(g, fx + 100, H * 0.9, 480, 110, '#ff6a20', 0.3);
  // stone chimney hood, soot-blackened, lit from below
  g.save();
  poly(g, [[fx - 104, fy - 168], [fx + 104, fy - 168], [fx + 46, 0], [fx - 46, 0]]);
  g.clip();
  masonry(g, fx - 110, 0, 220, fy - 166, { base: '#3e3630', course: 16, blockW: 30, seed: 112 });
  g.fillStyle = linGrad(g, 0, 0, 0, fy - 168, [[0, 'rgba(0,0,0,0.85)'], [0.7, 'rgba(0,0,0,0.45)'], [1, 'rgba(255,110,40,0.25)']]);
  g.fillRect(fx - 110, 0, 220, fy - 166);
  g.restore();
  g.fillStyle = '#2a221c';
  g.fillRect(fx - 112, fy - 176, 224, 10);
  g.fillStyle = 'rgba(255,140,60,0.35)';
  g.fillRect(fx - 112, fy - 167, 224, 2);
  P.weaponRack(g, W * 0.52, H * 0.22, W * 0.22, H * 0.34, 7);
  P.anvil(g, W * 0.55, H * 0.9, 120);
  P.armourStand(g, W * 0.84, H * 0.97, 150, { plate: true });
  P.armourStand(g, W * 0.14, H * 0.99, 150, { plate: false });
  P.barrel(g, W * 0.7, H * 0.84, 70, 3);
  return { ...rm, lights, motes: { color: '#ffa050', count: 70, rise: 0.4 }, floorY: rm.by1 };
};

S.shop = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#5a4630', wallKind: 'wood', floor: 'boards', floorColor: '#3a2818' });
  const lights = [];
  P.bottleShelf(g, W * 0.26, H * 0.18, W * 0.2, H * 0.34, { seed: 12, shelves: 4 });
  P.bookshelf(g, W * 0.5, H * 0.18, W * 0.22, H * 0.34, { seed: 13, shelves: 4 });
  // hanging goods
  for (let i = 0; i < 7; i++) {
    const x = W * (0.2 + i * 0.1);
    g.strokeStyle = '#140c06';
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H * 0.1 + (i % 3) * 10);
    g.stroke();
    g.fillStyle = ['#6a5a3a', '#4a3a2a', '#7a6a4a'][i % 3];
    g.beginPath();
    g.ellipse(x, H * 0.12 + (i % 3) * 10, 12, 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  // counter
  g.fillStyle = linGrad(g, 0, H * 0.74, 0, H, [[0, '#6a4424'], [0.1, '#3a2412'], [1, '#140a04']]);
  g.fillRect(W * 0.12, H * 0.76, W * 0.76, H * 0.3);
  g.fillStyle = 'rgba(255,220,160,0.3)';
  g.fillRect(W * 0.12, H * 0.76, W * 0.76, 4);
  P.crate(g, W * 0.9, H * 0.99, 90, 3);
  P.barrel(g, W * 0.06, H * 0.99, 110, 4);
  g.fillStyle = '#2a1c10';
  g.fillRect(W * 0.62, H * 0.66, 30, 40);
  lights.push({ x: W * 0.64, y: H * 0.64, s: 10, kind: 'candle', color: '#ffb050' });
  glow(g, W * 0.64, H * 0.64, 300, '#ffa040', 0.35);
  return { ...rm, lights, motes: { color: '#ffd8a0', count: 40, rise: 0.05 }, floorY: rm.by1 };
};

S.curio = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#3a3040', wallKind: 'wood', floor: 'boards', floorColor: '#2a2018' });
  const lights = [];
  P.bottleShelf(g, W * 0.25, H * 0.16, W * 0.22, H * 0.4, { seed: 21, shelves: 4, magic: true });
  P.bookshelf(g, W * 0.52, H * 0.16, W * 0.22, H * 0.4, { seed: 22, shelves: 5 });
  // scroll rack
  for (let i = 0; i < 12; i++) {
    const x = W * 0.14 + (i % 6) * 14;
    const y = H * 0.5 + Math.floor(i / 6) * 16;
    g.fillStyle = '#e8dcc0';
    g.beginPath();
    g.ellipse(x, y, 6, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8a1a1a';
    g.fillRect(x - 6, y - 1, 12, 2);
  }
  // crystal ball on the counter
  g.fillStyle = linGrad(g, 0, H * 0.76, 0, H, [[0, '#4a3424'], [1, '#100804']]);
  g.fillRect(W * 0.1, H * 0.78, W * 0.8, H * 0.24);
  const cx = W * 0.5;
  const cy = H * 0.72;
  glow(g, cx, cy, 160, '#7ab8ff', 0.45);
  g.fillStyle = 'rgba(150,200,255,0.55)';
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath();
  g.arc(cx - 12, cy - 12, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a1c10';
  g.fillRect(cx - 26, cy + 30, 52, 14);
  lights.push({ x: cx, y: cy, s: 26, kind: 'glow', color: '#7ab8ff' });
  for (const x of [0.3, 0.7]) {
    P.candle(g, W * x, H * 0.78, 40);
    lights.push({ x: W * x, y: H * 0.78 - 18, s: 8, kind: 'candle', color: '#ffc060' });
    glow(g, W * x, H * 0.74, 200, '#ffa040', 0.25);
  }
  return { ...rm, lights, motes: { color: '#b8d8ff', count: 60, rise: 0.06 }, floorY: rm.by1 };
};

S.training = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#6a5a44', wallKind: 'stone', floor: 'sand', floorColor: '#8a7654', by0: 0.1 });
  for (const x of [0.3, 0.62]) P.windowLit(g, W * x, H * 0.14, W * 0.07, H * 0.24, { arch: true, color: '#fff0c8', lit: 1 });
  lightShaft(g, W * 0.33, H * 0.26, 70, W * 0.4, H * 0.98, 260, '#fff0c8', 0.28);
  lightShaft(g, W * 0.65, H * 0.26, 70, W * 0.6, H * 0.98, 260, '#fff0c8', 0.28);
  P.weaponRack(g, W * 0.4, H * 0.42, W * 0.2, H * 0.26, 31);
  // practice dummies
  for (const [x, s] of [[0.22, 130], [0.78, 150]]) {
    const dx = W * x;
    const dy = H * 0.94;
    contactShadow(g, dx, dy, s * 0.4, s * 0.08);
    g.fillStyle = '#3a2412';
    g.fillRect(dx - s * 0.04, dy - s * 1.4, s * 0.08, s * 1.4);
    g.fillRect(dx - s * 0.4, dy - s * 1.15, s * 0.8, s * 0.07);
    g.fillStyle = linGrad(g, dx - s * 0.25, 0, dx + s * 0.25, 0, [[0, '#c8b080'], [1, '#5a4a2a']]);
    g.beginPath();
    g.ellipse(dx, dy - s * 0.95, s * 0.24, s * 0.36, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(dx, dy - s * 1.42, s * 0.14, 0, Math.PI * 2);
    g.fill();
  }
  P.armourStand(g, W * 0.1, H * 0.99, 160, { plate: false });
  return { ...rm, lights: [], motes: { color: '#fff0c8', count: 70, rise: 0.02 }, floorY: rm.by1 };
};

S.library = (g, W, H, R, o) => {
  const rm = roomScene(g, W, H, R, { wall: '#3a2a1c', wallKind: 'wood', floor: 'boards', floorColor: '#2e2016', by0: 0.02, by1: 0.72, bx0: 0.3, bx1: 0.7, beams: false, ceiling: '#0e0a08' });
  const lights = [];
  // back wall: towering shelves and a gallery
  P.bookshelf(g, rm.bx0 + 4, H * 0.06, (rm.bx1 - rm.bx0) - 8, H * 0.3, { seed: 41, shelves: 5 });
  g.fillStyle = '#1a0e06';
  g.fillRect(rm.bx0, H * 0.36, rm.bx1 - rm.bx0, 12);
  for (let i = 0; i < 14; i++) g.fillRect(rm.bx0 + i * ((rm.bx1 - rm.bx0) / 13), H * 0.36 - 26, 3, 26);
  P.bookshelf(g, rm.bx0 + 4, H * 0.39, (rm.bx1 - rm.bx0) - 8, rm.by1 - H * 0.39, { seed: 42, shelves: 5 });
  // side shelves in perspective
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const t0 = persp(i / 4, 3);
      const t1 = persp((i + 0.8) / 4, 3);
      const x0 = side < 0 ? lerp(0, rm.bx0, t0) : lerp(W, rm.bx1, t0);
      const x1 = side < 0 ? lerp(0, rm.bx0, t1) : lerp(W, rm.bx1, t1);
      const top0 = lerp(0, rm.by0, t0);
      const bot0 = lerp(H, rm.by1, t0);
      g.save();
      g.beginPath();
      g.rect(Math.min(x0, x1), top0, Math.abs(x1 - x0), bot0 - top0);
      g.clip();
      P.bookshelf(g, Math.min(x0, x1), top0, Math.abs(x1 - x0), bot0 - top0, { seed: 50 + i + side, shelves: 7, dust: 0.1 });
      g.fillStyle = `rgba(0,0,0,${0.5 - t0 * 0.3})`;
      g.fillRect(Math.min(x0, x1), top0, Math.abs(x1 - x0), bot0 - top0);
      g.restore();
    }
  }
  // reading table with candles
  P.table(g, W * 0.5, H * 0.88, 110, { items: false });
  g.fillStyle = '#e8dcc0';
  poly(g, [[W * 0.46, H * 0.8], [W * 0.54, H * 0.8], [W * 0.55, H * 0.82], [W * 0.45, H * 0.82]]);
  g.fill();
  if (o.light === 'fire') {
    lights.push({ x: W * 0.28, y: H * 0.88, s: 40, kind: 'flame', color: '#ff7a20' });
    glow(g, W * 0.28, H * 0.8, 480, '#ff6a18', 0.4);
    P.rubble(g, W * 0.28, H * 0.92, 50, { seed: 61, base: '#3a2a1c' });
  } else if (o.light === 'ward') {
    glowEllipse(g, W * 0.5, H * 0.9, 300, 60, '#8ab8ff', 0.5);
    lights.push({ x: W * 0.5, y: H * 0.9, s: 80, kind: 'ward', color: '#8ab8ff' });
  }
  for (const cx of [0.44, 0.56]) {
    P.candle(g, W * cx, H * 0.8, 36);
    lights.push({ x: W * cx, y: H * 0.8 - 18, s: 8, kind: 'candle', color: '#ffc060' });
    glow(g, W * cx, H * 0.76, 220, '#ffa040', 0.3);
  }
  // cobwebs
  g.strokeStyle = 'rgba(220,220,220,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(0, i * 18);
    g.quadraticCurveTo(60, 40 + i * 6, i * 22, 0);
    g.stroke();
    g.beginPath();
    g.moveTo(W, i * 18);
    g.quadraticCurveTo(W - 60, 40 + i * 6, W - i * 22, 0);
    g.stroke();
  }
  lightShaft(g, W * 0.52, 0, 60, W * 0.48, H * 0.9, 220, '#c8d8ff', 0.15);
  return { ...rm, lights, motes: { color: '#e8dcc0', count: 80, rise: 0.02 }, floorY: rm.by1 };
};

S.textile = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#4a3e34', wallKind: 'wood', floor: 'boards', floorColor: '#32261a' });
  const lights = [];
  // hanging dyed cloth from the beams
  const cols = ['#7a2a2a', '#2a4a7a', '#6a5a2a', '#3a5a3a', '#5a2a5a'];
  for (let i = 0; i < 9; i++) {
    const x = W * (0.08 + i * 0.105);
    const h = H * (0.25 + R() * 0.3);
    const w = 38 + R() * 26;
    g.fillStyle = linGrad(g, x, 0, x + w, 0, [[0, rgba(cols[i % 5], 0.95, 1.1)], [0.6, rgba(cols[i % 5], 0.95, 0.7)], [1, rgba(cols[i % 5], 0.95, 0.4)]]);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + w, 0);
    g.lineTo(x + w - 4, h);
    for (let k = 0; k < 4; k++) g.lineTo(x + w - (k + 1) * (w / 4), h - (k % 2 ? 12 : 0) - R() * 10);
    g.closePath();
    g.fill();
  }
  P.loom(g, W * 0.3, H * 0.86, 120, { cloth: '#7a2a2a', seed: 3 });
  P.loom(g, W * 0.64, H * 0.8, 90, { cloth: '#2a4a7a', seed: 4 });
  P.clothBolts(g, W * 0.86, H * 0.97, 80, 5);
  P.clothBolts(g, W * 0.1, H * 0.99, 90, 6);
  lightShaft(g, W * 0.5, H * 0.1, 80, W * 0.46, H * 0.95, 260, '#d8e0c8', 0.18);
  return { ...rm, lights, motes: { color: '#e8e0c8', count: 90, rise: 0.02 }, floorY: rm.by1 };
};

S.crypt = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#4a4640', wallKind: 'stone', floor: 'flags', floorColor: '#2e2c28', beams: false, ceiling: '#0c0c0e' });
  const lights = [];
  // vaulting ribs
  g.strokeStyle = 'rgba(90,84,74,0.9)';
  g.lineWidth = 10;
  for (let i = 0; i < 4; i++) {
    const t = persp(i / 4, 3);
    const xl = lerp(0, rm.bx0, t);
    const xr = lerp(W, rm.bx1, t);
    const y = lerp(H * 0.2, rm.by0 + 30, t);
    g.lineWidth = 12 * (1 - t) + 3;
    g.beginPath();
    g.moveTo(xl, y + 80 * (1 - t));
    g.quadraticCurveTo((xl + xr) / 2, lerp(-H * 0.2, rm.by0 - 20, t), xr, y + 80 * (1 - t));
    g.stroke();
  }
  P.sarcophagus(g, W * 0.5, H * 0.84, 110);
  P.sarcophagus(g, W * 0.18, H * 0.98, 80);
  for (const x of [0.3, 0.7]) {
    P.torchSconce(g, W * x, H * 0.36, 60);
    lights.push({ x: W * x, y: H * 0.36, s: 16, kind: 'flame', color: '#ff9a3a' });
    glow(g, W * x, H * 0.4, 280, '#ff8a30', 0.3);
  }
  return { ...rm, lights, motes: { color: '#d8c8a8', count: 40, rise: 0.02 }, floorY: rm.by1 };
};

S.castle = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#4a4440', wallKind: 'stone', floor: 'flags', floorColor: '#34302c', by0: 0.04, by1: 0.7, bx0: 0.3, bx1: 0.7, beams: false, ceiling: '#0a0a0c' });
  const lights = [];
  // red carpet to the throne
  g.fillStyle = linGrad(g, 0, rm.by1, 0, H, [[0, '#4a1010'], [1, '#6a1a18']]);
  poly(g, [[W * 0.47, rm.by1], [W * 0.53, rm.by1], [W * 0.66, H], [W * 0.34, H]]);
  g.fill();
  texture(g, W * 0.34, rm.by1, W * 0.32, H - rm.by1, { alpha: 0.4, cells: 24, seed: 131 });
  P.throne(g, W * 0.5, rm.by1, 70);
  P.banner(g, W * 0.38, H * 0.1, 40, 170, '#1a1612', { emblem: 'hand', trim: '#ff7a3a', seed: 4 });
  P.banner(g, W * 0.58, H * 0.1, 40, 170, '#1a1612', { emblem: 'hand', trim: '#ff7a3a', seed: 5 });
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const t = persp(i / 3, 2.5);
    const x = W / 2 + side * lerp(W * 0.4, W * 0.19, t);
    P.column(g, x, lerp(-10, rm.by0, t), lerp(H * 1.02, rm.by1 + 6, t), lerp(70, 22, t), { base: '#6a6258', seed: i * 3 + side });
    if (i > 0) {
      const ty = lerp(H * 0.4, rm.by0 + (rm.by1 - rm.by0) * 0.4, t);
      P.torchSconce(g, x + side * -lerp(40, 14, t), ty, lerp(60, 24, t));
      lights.push({ x: x + side * -lerp(40, 14, t), y: ty, s: lerp(18, 8, t), kind: 'flame', color: '#ff9a3a' });
      glow(g, x, ty, lerp(260, 120, t), '#ff8a30', 0.25);
    }
  }
  return { ...rm, lights, motes: { color: '#ffb070', count: 40, rise: 0.2 }, floorY: rm.by1 };
};

S.temple_bane = (g, W, H, R) => {
  const rm = roomScene(g, W, H, R, { wall: '#26282a', wallKind: 'stone', floor: 'flags', floorColor: '#1a1c1c', by0: 0.04, by1: 0.72, beams: false, ceiling: '#050606' });
  const lights = [];
  // the iron hand
  const cx = W / 2;
  const top = H * 0.08;
  g.fillStyle = linGrad(g, cx - 90, 0, cx + 90, 0, [[0, '#2a2e2c'], [0.4, '#141616'], [1, '#050606']]);
  g.beginPath();
  g.ellipse(cx, top + 150, 70, 80, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.roundRect(cx - 64 + i * 34, top, 26, 140, 12);
    g.fill();
  }
  g.save();
  g.translate(cx - 70, top + 140);
  g.rotate(-0.7);
  g.beginPath();
  g.roundRect(-13, -90, 26, 90, 12);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(120,255,150,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(cx, top + 150, 70, 80, 0, -1.2, 0.4);
  g.stroke();
  // altar
  g.fillStyle = linGrad(g, 0, rm.by1 - 70, 0, rm.by1, [[0, '#2a2c2c'], [1, '#0a0c0c']]);
  g.fillRect(cx - 110, rm.by1 - 64, 220, 64);
  // green fire braziers
  for (const x of [0.3, 0.7]) {
    P.brazier(g, W * x, H * 0.86, 100);
    lights.push({ x: W * x, y: H * 0.86 - 70, s: 34, kind: 'flame', color: '#40ff70' });
    glow(g, W * x, H * 0.74, 300, '#30ff60', 0.2);
    glowEllipse(g, W * x, H * 0.9, 260, 50, '#30ff60', 0.18);
  }
  lights.push({ x: cx, y: top + 160, s: 26, kind: 'flame', color: '#40ff70' });
  glow(g, cx, top + 150, 200, '#40ff70', 0.22);
  // chained skulls and a black-draped floor
  for (let i = 0; i < 7; i++) {
    const sx = W * (0.36 + i * 0.047);
    g.fillStyle = '#c8c0a8';
    g.beginPath();
    g.arc(sx, rm.by1 - 76, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0a0a0a';
    g.fillRect(sx - 3, rm.by1 - 77, 2, 2);
    g.fillRect(sx + 1, rm.by1 - 77, 2, 2);
  }
  return { ...rm, lights, motes: { color: '#7dff9a', count: 60, rise: 0.25 }, floorY: rm.by1 };
};

S.well = (g, W, H, R, o) => {
  // natural cave with black water
  const lights = [];
  g.fillStyle = '#0a0a0c';
  g.fillRect(0, 0, W, H);
  masonry(g, 0, 0, W, H, { base: '#3a3632', course: 60, blockW: 90, jitter: 0.3, seed: 141, mortar: 'rgba(10,8,6,0.8)' });
  texture(g, 0, 0, W, H, { alpha: 0.7, mode: 'multiply', cells: 3, octaves: 5, seed: 142 });
  // cave mouth shape: dark vignette ring
  const gr = g.createRadialGradient(W / 2, H * 0.55, H * 0.2, W / 2, H * 0.55, W * 0.6);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.92)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // water
  const wy = H * 0.72;
  g.fillStyle = linGrad(g, 0, wy, 0, H, [[0, '#0e1618'], [1, '#020405']]);
  g.fillRect(0, wy, W, H - wy);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(160,200,200,${0.04 + R() * 0.08})`;
    g.fillRect(R() * W, wy + R() * (H - wy), 10 + R() * 40, 1);
  }
  // stalactites
  g.fillStyle = '#16140f';
  for (let i = 0; i < 26; i++) {
    const x = R() * W;
    const h = 20 + R() * 90;
    poly(g, [[x - 8 - R() * 8, 0], [x + 8 + R() * 8, 0], [x, h]]);
    g.fill();
  }
  // shore rocks
  P.rubble(g, W * 0.15, H * 0.8, 80, { seed: 143, base: '#3a3630' });
  P.rubble(g, W * 0.86, H * 0.78, 70, { seed: 144, base: '#3a3630' });
  if (o.light === 'torch') {
    for (const x of [0.22, 0.78]) {
      P.torchSconce(g, W * x, H * 0.4, 60);
      lights.push({ x: W * x, y: H * 0.4, s: 18, kind: 'flame', color: '#ff9a3a' });
      glow(g, W * x, H * 0.44, 320, '#ff8a30', 0.35);
    }
  }
  // shaft of grey daylight from the well above
  lightShaft(g, W * 0.5, 0, 90, W * 0.5, H * 0.8, 200, '#c8d8e0', 0.3);
  glowEllipse(g, W * 0.5, H * 0.8, 180, 30, '#a8c8d8', 0.25);
  return { lights, motes: { color: '#c8d8e0', count: 40, rise: -0.1 }, floorY: H * 0.72, horizon: H * 0.72 };
};

S.pool = (g, W, H, R) => {
  const lights = [];
  const rm = roomScene(g, W, H, R, { wall: '#3a3228', wallKind: 'stone', floor: 'flags', floorColor: '#2a241c', by0: 0.02, by1: 0.66, bx0: 0.18, bx1: 0.82, beams: false, ceiling: '#080604' });
  // the stepped pyramid rising behind the Pool
  const cx = W / 2;
  const cy = H * 0.8;
  for (let i = 0; i < 6; i++) {
    const w = W * (0.5 - i * 0.07);
    const y0 = rm.by1 - i * 34;
    g.fillStyle = linGrad(g, cx - w / 2, 0, cx + w / 2, 0, [[0, '#8a6a3a'], [0.5, '#5a4424'], [1, '#2a1e10']]);
    g.fillRect(cx - w / 2, y0 - 34, w, 34);
    g.fillStyle = 'rgba(255,220,140,0.3)';
    g.fillRect(cx - w / 2, y0 - 34, w, 3);
    texture(g, cx - w / 2, y0 - 34, w, 34, { alpha: 0.4, cells: 16, seed: 150 + i });
  }
  g.fillStyle = '#1a1206';
  archPath(g, cx - 26, rm.by1 - 204 - 60, 52, 60);
  g.fill();
  glow(g, cx, rm.by1 - 234, 60, '#ffd060', 0.5);
  g.fillStyle = linGrad(g, 0, cy - 60, 0, cy + 60, [[0, '#fff0b0'], [0.5, '#e8b040'], [1, '#8a5a10']]);
  g.beginPath();
  g.ellipse(cx, cy, W * 0.34, H * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  glow(g, cx, cy, W * 0.5, '#ffd060', 0.55);
  glow(g, cx, cy - H * 0.3, W * 0.4, '#ffc040', 0.3, 'screen');
  lights.push({ x: cx, y: cy, s: W * 0.3, kind: 'pool', color: '#ffd060' });
  // pyramid steps up around it
  g.strokeStyle = 'rgba(40,30,16,0.9)';
  g.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.ellipse(cx, cy, W * 0.34 + i * 26, H * 0.12 + i * 12, 0, Math.PI * 1.02, Math.PI * 1.98);
    g.stroke();
  }
  // ripples of light on the surface
  g.strokeStyle = 'rgba(255,250,220,0.35)';
  for (let i = 1; i < 6; i++) {
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, cy, W * 0.06 * i, H * 0.022 * i, 0, 0, Math.PI * 2);
    g.stroke();
  }
  lightShaft(g, cx, cy, W * 0.4, cx, 0, W * 0.3, '#ffe080', 0.25);
  return { ...rm, lights, motes: { color: '#ffe080', count: 90, rise: 0.3 }, floorY: rm.by1 };
};

S.dungeon = S.crypt;

/**
 * Paint a setting into the context. Unknown ids fall back to 'slums'.
 * @returns scene info (see module doc)
 */
export function paintSetting(g, W, H, id, opts = {}) {
  const R = rngOf(opts.seed ?? 1);
  const f = S[id] ?? S.slums;
  const info = f(g, W, H, R, opts) ?? {};
  info.lights ??= [];
  info.floorY ??= H * 0.64;
  return info;
}

export const SETTING_IDS = Object.keys(S);
