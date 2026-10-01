import { rgba, mix, glow, linGrad, poly, texture, contactShadow, rngOf, makeCanvas, hexRgb } from './paint.js';

/**
 * Painted creature figures for encounter panels. All figures face the viewer
 * (the party) and are lit by a warm key from the left and a cool (or scene-
 * coloured) rim from the right. Drawn into an offscreen canvas so they can be
 * atmospherically tinted by depth when composited.
 *
 * paintCreature(id, h, light) → {canvas, ox, oy}  (ox, oy = feet in canvas px)
 */

const SPECIES = {
  kobold: { plan: 'humanoid', skin: '#8a4a2a', head: 'kobold', tail: true, build: 0.85, legs: 'digi', cloth: '#4a3a28', weapon: 'spear', eyes: '#ffc030', hunch: 0.12 },
  koboldChief: { plan: 'humanoid', skin: '#7a6a5a', head: 'kobold', tail: true, build: 0.95, legs: 'digi', cloth: '#6a1e1a', weapon: 'sword', eyes: '#ffc030', hunch: 0.18, cape: '#5a1a14', helm: true },
  goblin: { plan: 'humanoid', skin: '#7a8a3a', head: 'goblin', build: 0.85, cloth: '#4a3020', weapon: 'sword', eyes: '#ffe040', hunch: 0.1 },
  orc: { plan: 'humanoid', skin: '#5e6e44', head: 'orc', build: 1.15, cloth: '#3a2a1c', armor: 'scraps', weapon: 'axe', eyes: '#ff3a18', hunch: 0.15 },
  orcLeader: { plan: 'humanoid', skin: '#56663e', head: 'orc', build: 1.3, cloth: '#2a1a12', armor: 'plate', weapon: 'axe', eyes: '#ff3a18', hunch: 0.1, cape: '#4a1010' },
  hobgoblin: { plan: 'humanoid', skin: '#b0582a', head: 'hobgoblin', build: 1.1, cloth: '#5a1e18', armor: 'scale', weapon: 'sword', shield: 'round', eyes: '#ffa020' },
  hobgoblinChief: { plan: 'humanoid', skin: '#a04a22', head: 'hobgoblin', build: 1.2, cloth: '#1a1612', armor: 'plate', weapon: 'sword', shield: 'kite', eyes: '#ffa020', cape: '#1a1612', helm: true },
  gnoll: { plan: 'humanoid', skin: '#9a7a4a', head: 'gnoll', build: 1.15, legs: 'digi', cloth: '#3a2e22', armor: 'scraps', weapon: 'flail', eyes: '#ffd040', hunch: 0.2, fur: true },
  bugbear: { plan: 'humanoid', skin: '#7a5a30', head: 'bugbear', build: 1.35, cloth: '#3a2a1a', armor: 'scraps', weapon: 'mace', eyes: '#ffc040', hunch: 0.15, fur: true },
  lizardMan: { plan: 'humanoid', skin: '#4a6a3a', head: 'lizard', tail: true, build: 1.05, cloth: '#4a3a20', weapon: 'spear', shield: 'round', eyes: '#ffe040' },
  thug: { plan: 'humanoid', skin: '#c08a6a', head: 'hood', hood: '#3a3228', build: 1.0, cloth: '#4a3a2a', armor: 'vest', weapon: 'club', eyes: null },
  bandit: { plan: 'humanoid', skin: '#b07a5a', head: 'hood', hood: '#4a3a24', build: 1.0, cloth: '#5a4a30', armor: 'vest', weapon: 'sword', eyes: null },
  buccaneer: { plan: 'humanoid', skin: '#b07a5a', head: 'bandana', bandana: '#8a1a1a', build: 1.0, cloth: '#c8b8a0', armor: 'vest', weapon: 'sword', eyes: null },
  banditLeader: { plan: 'humanoid', skin: '#b07a5a', head: 'bandana', bandana: '#1a1a1a', build: 1.1, cloth: '#6a1a1a', armor: 'scale', weapon: 'sword', cape: '#2a1a14', eyes: null },
  acolyte: { plan: 'humanoid', skin: '#b08a6a', head: 'hood', hood: '#141414', build: 0.95, cloth: '#141414', armor: 'robe', weapon: 'mace', eyes: '#60ff80' },
  banePriest: { plan: 'humanoid', skin: '#a08070', head: 'hood', hood: '#0a0a0a', build: 1.05, cloth: '#0e0e0e', armor: 'robe', weapon: 'mace', eyes: '#60ff80', cape: '#1a3a1a', gauntlet: true },
  human: { plan: 'humanoid', skin: '#c08a6a', head: 'hood', hood: '#3a3228', build: 1.0, cloth: '#4a3a2a', armor: 'vest', weapon: 'sword', eyes: null },
  ghostKnight: { plan: 'humanoid', skin: '#a8d8e0', head: 'hood', hood: '#5a8a98', build: 1.05, cloth: '#3a6070', armor: 'plate', weapon: 'sword', cape: '#2a5060', eyes: '#e8ffff', ghost: true },
  skeleton: { plan: 'skeleton', bone: '#d8ccb0', weapon: 'sword', shield: 'round', eyes: '#60d0ff' },
  zombie: { plan: 'humanoid', skin: '#7a8a6a', head: 'zombie', build: 1.0, cloth: '#3a3a30', armor: 'rags', weapon: null, eyes: '#c0ff60', hunch: 0.2, armsForward: true },
  ghoul: { plan: 'humanoid', skin: '#9a9a8a', head: 'zombie', build: 0.9, cloth: '#2a2a28', armor: 'rags', weapon: null, eyes: '#ff4030', hunch: 0.35, claws: true },
  ghast: { plan: 'humanoid', skin: '#8a8a7a', head: 'zombie', build: 1.0, cloth: '#1a1a18', armor: 'rags', weapon: null, eyes: '#ff2020', hunch: 0.3, claws: true },
  wight: { plan: 'humanoid', skin: '#8a9098', head: 'zombie', build: 1.0, cloth: '#2a2a3a', armor: 'robe', weapon: 'sword', eyes: '#a0e8ff', crown: true },
  shadow: { plan: 'wraith', color: '#0a0a12', eyes: '#c8d0ff' },
  spectre: { plan: 'wraith', color: '#9ab0c8', eyes: '#ffffff', ghostly: true },
  ogre: { plan: 'humanoid', skin: '#a08a5a', head: 'ogre', build: 1.5, cloth: '#4a3a28', armor: 'scraps', weapon: 'club', eyes: '#ffa060', belly: true },
  hillGiant: { plan: 'humanoid', skin: '#b0906a', head: 'ogre', build: 1.55, cloth: '#5a4a30', armor: 'fur', weapon: 'club', eyes: '#ffa060', belly: true },
  troll: { plan: 'humanoid', skin: '#4a6a3a', head: 'troll', build: 0.95, cloth: '#2a2a1a', armor: 'rags', weapon: null, eyes: '#ffe020', hunch: 0.35, armLen: 1.35, claws: true },
  giantRat: { plan: 'quad', fur: '#4a3a30', eyes: '#ff3020', tail: 'rat', snout: 1.2, ears: 'round' },
  wolf: { plan: 'quad', fur: '#6a6660', eyes: '#ffd040', tail: 'bushy', snout: 1.1, ears: 'pointed' },
  giantFrog: { plan: 'frog', skin: '#8a9a7a', eyes: '#ffe080' },
  giantCentipede: { plan: 'centipede', skin: '#7a3a1a', eyes: '#ff4020' },
  giantSpider: { plan: 'spider', skin: '#2a2420', eyes: '#ff2020' },
  tyranthraxus: { plan: 'dragon', skin: '#b07a3a', eyes: '#ffe080' },
};

/** Relative height by creature (human = 1). */
export function creatureScale(id) {
  const t = { kobold: 0.62, koboldChief: 0.7, goblin: 0.66, giantRat: 0.42, wolf: 0.55, giantFrog: 0.5, giantCentipede: 0.38, giantSpider: 0.72, ogre: 1.45, hillGiant: 1.75, troll: 1.4, bugbear: 1.2, gnoll: 1.15, orcLeader: 1.08, hobgoblinChief: 1.05, tyranthraxus: 2.6, shadow: 1.0, spectre: 1.1 };
  return t[id] ?? 1;
}

export function hasCreature(id) {
  return id in SPECIES;
}

// ------------------------------------------------------------------ shading helpers

/**
 * Fill a part with a soft form gradient (lit from the left). Rim and key
 * lighting are applied to the whole silhouette afterwards (lightFigure), so
 * parts read as one painted mass instead of an outlined mannequin.
 */
function shaded(g, path, x0, x1, base, L, { spec = 0, tex = 0, seed = 1, flat = false } = {}) {
  g.save();
  path();
  g.fillStyle = flat ? rgba(base) : linGrad(g, x0, 0, x1, 0, [
    [0, rgba(base, 1, 1.12, L.key, 0.12)],
    [0.5, rgba(base, 1, 0.95)],
    [1, rgba(base, 1, 0.68)],
  ]);
  g.fill();
  if (tex || spec) {
    g.save();
    path();
    g.clip();
    if (tex) texture(g, x0 - 5, -2000, x1 - x0 + 10, 4000, { alpha: tex * 0.6, cells: 64, octaves: 3, seed });
    if (spec) {
      g.fillStyle = linGrad(g, x0, 0, x1, 0, [[0.12, 'rgba(255,255,255,0)'], [0.3, `rgba(255,244,228,${spec})`], [0.46, 'rgba(255,255,255,0)']]);
      g.fillRect(x0, -2000, x1 - x0, 4000);
    }
    g.restore();
  }
  g.restore();
}

/** Soft dark stroke for anatomy / fold lines. */
function crease(g, pts, w, a = 0.35) {
  g.save();
  g.strokeStyle = `rgba(10,5,2,${a})`;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
  g.restore();
}

/** Tapered limb polygon from (x0,y0) to (x1,y1). */
function limbPath(g, x0, y0, x1, y1, w0, w1) {
  const a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return () => {
    g.beginPath();
    g.moveTo(x0 + c * w0 / 2, y0 + s * w0 / 2);
    g.lineTo(x1 + c * w1 / 2, y1 + s * w1 / 2);
    g.arc(x1, y1, w1 / 2, a, a + Math.PI, true);
    g.lineTo(x0 - c * w0 / 2, y0 - s * w0 / 2);
    g.arc(x0, y0, w0 / 2, a + Math.PI, a + Math.PI * 2, true);
    g.closePath();
  };
}

let EMIT = null;
function eyes(g, x, y, sep, r, color, { slit = false } = {}) {
  if (!color) return;
  if (EMIT) {
    const m = g.getTransform();
    EMIT.push({ m, x, y, sep, r, color, slit });
    // dark sockets now; the glow is painted after the lighting passes
    g.fillStyle = 'rgba(0,0,0,0.75)';
    for (const d of [-1, 1]) { g.beginPath(); g.ellipse(x + d * sep, y, r * 1.5, r * 1.1, 0, 0, Math.PI * 2); g.fill(); }
    return;
  }
  for (const d of [-1, 1]) {
    glow(g, x + d * sep, y, r * 5, color, 0.55);
    g.fillStyle = rgba(color, 1, 1.2);
    g.beginPath();
    if (slit) g.ellipse(x + d * sep, y, r * 1.1, r * 0.5, d * 0.25, 0, Math.PI * 2);
    else g.arc(x + d * sep, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff8e0';
    g.beginPath();
    g.arc(x + d * sep - r * 0.25, y - r * 0.2, r * 0.35, 0, Math.PI * 2);
    g.fill();
  }
}

// ------------------------------------------------------------------ weapons

function weapon(g, kind, hx, hy, h, L, ang = -0.35) {
  if (!kind) return;
  g.save();
  g.translate(hx, hy);
  g.rotate(ang);
  const metal = (x0, x1) => linGrad(g, x0, 0, x1, 0, [[0, '#f0f0f8'], [0.4, '#9a9ca8'], [1, '#3a3c44']]);
  const wood = (x0, x1) => linGrad(g, x0, 0, x1, 0, [[0, '#8a6038'], [1, '#2a1a0c']]);
  if (kind === 'spear') {
    g.fillStyle = wood(-h * 0.012, h * 0.012);
    g.fillRect(-h * 0.012, -h * 0.75, h * 0.024, h * 1.05);
    g.fillStyle = metal(-h * 0.03, h * 0.03);
    poly(g, [[0, -h * 0.9], [h * 0.035, -h * 0.76], [0, -h * 0.72], [-h * 0.035, -h * 0.76]]);
    g.fill();
  } else if (kind === 'sword') {
    g.fillStyle = metal(-h * 0.02, h * 0.02);
    poly(g, [[-h * 0.02, -h * 0.05], [h * 0.02, -h * 0.05], [h * 0.016, -h * 0.5], [0, -h * 0.55], [-h * 0.016, -h * 0.5]]);
    g.fill();
    g.fillStyle = '#8a6a2a';
    g.fillRect(-h * 0.07, -h * 0.06, h * 0.14, h * 0.025);
    g.fillStyle = '#2a1a0c';
    g.fillRect(-h * 0.014, -h * 0.035, h * 0.028, h * 0.08);
  } else if (kind === 'axe') {
    g.fillStyle = wood(-h * 0.015, h * 0.015);
    g.fillRect(-h * 0.015, -h * 0.48, h * 0.03, h * 0.58);
    g.fillStyle = metal(0, h * 0.16);
    g.beginPath();
    g.moveTo(h * 0.01, -h * 0.46);
    g.quadraticCurveTo(h * 0.2, -h * 0.52, h * 0.19, -h * 0.34);
    g.quadraticCurveTo(h * 0.12, -h * 0.36, h * 0.01, -h * 0.34);
    g.closePath();
    g.fill();
  } else if (kind === 'club') {
    g.fillStyle = wood(-h * 0.05, h * 0.05);
    g.beginPath();
    g.moveTo(-h * 0.018, h * 0.06);
    g.lineTo(-h * 0.06, -h * 0.5);
    g.quadraticCurveTo(0, -h * 0.6, h * 0.06, -h * 0.5);
    g.lineTo(h * 0.018, h * 0.06);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 4; i++) g.fillRect(-h * 0.03 + i * h * 0.02, -h * 0.45 + i * h * 0.05, h * 0.012, h * 0.03);
  } else if (kind === 'mace' || kind === 'flail') {
    g.fillStyle = wood(-h * 0.014, h * 0.014);
    g.fillRect(-h * 0.014, -h * 0.34, h * 0.028, h * 0.42);
    g.fillStyle = metal(-h * 0.06, h * 0.06);
    const by = kind === 'flail' ? -h * 0.46 : -h * 0.36;
    if (kind === 'flail') {
      g.strokeStyle = '#6a6a70';
      g.lineWidth = h * 0.008;
      g.beginPath();
      g.moveTo(0, -h * 0.34);
      g.lineTo(h * 0.04, by);
      g.stroke();
    }
    g.beginPath();
    g.arc(kind === 'flail' ? h * 0.04 : 0, by, h * 0.055, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a3c44';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const cx = (kind === 'flail' ? h * 0.04 : 0) + Math.cos(a) * h * 0.06;
      const cy = by + Math.sin(a) * h * 0.06;
      poly(g, [[cx - h * 0.012, cy], [cx + Math.cos(a) * h * 0.03, cy + Math.sin(a) * h * 0.03], [cx + h * 0.012, cy]]);
      g.fill();
    }
  }
  g.restore();
  void L;
}

function shield(g, kind, cx, cy, h, L, color = '#5a3a1e') {
  if (!kind) return;
  const r = h * 0.14;
  const path = kind === 'kite'
    ? () => { g.beginPath(); g.moveTo(cx - r, cy - r * 0.9); g.lineTo(cx + r, cy - r * 0.9); g.lineTo(cx + r * 0.9, cy + r * 0.3); g.lineTo(cx, cy + r * 1.5); g.lineTo(cx - r * 0.9, cy + r * 0.3); g.closePath(); }
    : () => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); };
  shaded(g, path, cx - r, cx + r, kind === 'kite' ? '#1a1612' : color, L, { tex: 0.5, seed: 7 });
  g.strokeStyle = 'rgba(120,110,100,0.9)';
  g.lineWidth = h * 0.012;
  path();
  g.stroke();
  g.fillStyle = linGrad(g, cx - r * 0.25, 0, cx + r * 0.25, 0, [[0, '#d8d8e0'], [1, '#3a3a40']]);
  g.beginPath();
  g.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
  g.fill();
  if (kind === 'kite') {
    g.fillStyle = 'rgba(255,120,60,0.8)';
    g.beginPath();
    g.arc(cx, cy + r * 0.2, r * 0.3, 0, Math.PI * 2);
    g.fill();
  }
}

// ------------------------------------------------------------------ heads

function head(g, sp, cx, cy, hr, L, R) {
  const skin = sp.skin;
  const k = sp.head;
  if (k === 'hood' || k === 'bandana') {
    const hood = k === 'hood';
    // face in shadow
    const facePath = () => { g.beginPath(); g.ellipse(cx, cy, hr * 0.78, hr, 0, 0, Math.PI * 2); };
    shaded(g, facePath, cx - hr, cx + hr, skin, L);
    if (hood) {
      const hp = () => {
        g.beginPath();
        g.moveTo(cx - hr * 1.3, cy + hr * 1.3);
        g.quadraticCurveTo(cx - hr * 1.35, cy - hr * 1.2, cx, cy - hr * 1.45);
        g.quadraticCurveTo(cx + hr * 1.35, cy - hr * 1.2, cx + hr * 1.3, cy + hr * 1.3);
        g.lineTo(cx + hr * 0.75, cy + hr * 1.1);
        g.quadraticCurveTo(cx + hr * 0.9, cy - hr * 0.6, cx, cy - hr * 0.85);
        g.quadraticCurveTo(cx - hr * 0.9, cy - hr * 0.6, cx - hr * 0.75, cy + hr * 1.1);
        g.closePath();
      };
      shaded(g, hp, cx - hr * 1.3, cx + hr * 1.3, sp.hood, L, { tex: 0.4 });
      g.fillStyle = linGrad(g, 0, cy - hr, 0, cy + hr * 0.3, [[0, 'rgba(0,0,0,0.85)'], [1, 'rgba(0,0,0,0.25)']]);
      g.beginPath();
      g.ellipse(cx, cy - hr * 0.1, hr * 0.8, hr * 0.8, 0, Math.PI, 0);
      g.fill();
    } else {
      g.fillStyle = rgba(sp.bandana);
      g.beginPath();
      g.ellipse(cx, cy - hr * 0.35, hr * 0.84, hr * 0.7, 0, Math.PI, 0);
      g.fill();
      g.fillRect(cx + hr * 0.5, cy - hr * 0.5, hr * 0.5, hr * 0.2);
      // beard stubble
      g.fillStyle = 'rgba(30,20,14,0.6)';
      g.beginPath();
      g.ellipse(cx, cy + hr * 0.55, hr * 0.55, hr * 0.4, 0, 0, Math.PI);
      g.fill();
    }
    if (sp.eyes) eyes(g, cx, cy - hr * 0.05, hr * 0.3, hr * 0.1, sp.eyes);
    else {
      g.fillStyle = 'rgba(255,230,200,0.8)';
      for (const d of [-1, 1]) g.fillRect(cx + d * hr * 0.3 - hr * 0.08, cy - hr * 0.08, hr * 0.16, hr * 0.06);
    }
    return;
  }
  if (k === 'zombie') {
    const hp = () => { g.beginPath(); g.ellipse(cx, cy, hr * 0.75, hr, 0, 0, Math.PI * 2); };
    shaded(g, hp, cx - hr, cx + hr, skin, L, { tex: 0.5, seed: 3 });
    g.fillStyle = 'rgba(0,0,0,0.7)';
    for (const d of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + d * hr * 0.3, cy - hr * 0.1, hr * 0.2, hr * 0.16, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1a0a0a';
    g.beginPath();
    g.ellipse(cx, cy + hr * 0.5, hr * 0.28, hr * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    eyes(g, cx, cy - hr * 0.1, hr * 0.3, hr * 0.08, sp.eyes);
    g.strokeStyle = 'rgba(40,40,30,0.8)';
    g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.moveTo(cx + (R() - 0.5) * hr, cy - hr * 0.9);
      g.lineTo(cx + (R() - 0.5) * hr * 1.6, cy + hr * (0.2 + R() * 0.6));
      g.stroke();
    }
    if (sp.crown) {
      g.fillStyle = linGrad(g, cx - hr * 0.7, 0, cx + hr * 0.7, 0, [[0, '#e8c860'], [1, '#5a4010']]);
      poly(g, [[cx - hr * 0.7, cy - hr * 0.6], [cx - hr * 0.7, cy - hr * 1.1], [cx - hr * 0.35, cy - hr * 0.85], [cx, cy - hr * 1.2], [cx + hr * 0.35, cy - hr * 0.85], [cx + hr * 0.7, cy - hr * 1.1], [cx + hr * 0.7, cy - hr * 0.6]]);
      g.fill();
    }
    return;
  }
  // beast / humanoid monster heads
  const cfg = {
    kobold: { w: 0.8, h: 0.85, snout: 0.9, snoutW: 0.45, ears: 'horn', teeth: true },
    goblin: { w: 0.95, h: 0.8, snout: 0.25, snoutW: 0.3, ears: 'bat', teeth: true, wide: true },
    orc: { w: 1.0, h: 0.95, snout: 0.35, snoutW: 0.45, ears: 'point', tusks: true, brow: true, hair: '#141210' },
    hobgoblin: { w: 0.92, h: 1.0, snout: 0.2, snoutW: 0.35, ears: 'point', brow: true, hair: '#1a1210', beard: true },
    gnoll: { w: 0.85, h: 0.9, snout: 1.1, snoutW: 0.5, ears: 'round_up', mane: true, teeth: true, spots: true },
    bugbear: { w: 1.05, h: 1.0, snout: 0.45, snoutW: 0.5, ears: 'round', mane: true, teeth: true },
    lizard: { w: 0.8, h: 0.9, snout: 0.9, snoutW: 0.45, ears: 'frill', teeth: true, scales: true },
    ogre: { w: 1.1, h: 1.0, snout: 0.2, snoutW: 0.45, ears: 'round', brow: true, tusks: true, hair: '#2a2016' },
    troll: { w: 0.85, h: 1.05, snout: 0.6, snoutW: 0.25, ears: 'long', brow: true, hair: '#1a2a14', teeth: true },
  }[k] ?? { w: 0.9, h: 0.9, snout: 0.3, snoutW: 0.4, ears: 'point' };
  const w = hr * cfg.w;
  const hh = hr * cfg.h;
  // ears behind
  g.save();
  const earCol = mix(skin, '#000000', 0.25);
  for (const d of [-1, 1]) {
    let path;
    if (cfg.ears === 'bat') path = () => poly(g, [[cx + d * w * 0.7, cy - hh * 0.2], [cx + d * w * 2.0, cy - hh * 0.75], [cx + d * w * 0.8, cy + hh * 0.25]]);
    else if (cfg.ears === 'point') path = () => poly(g, [[cx + d * w * 0.8, cy - hh * 0.2], [cx + d * w * 1.45, cy - hh * 0.55], [cx + d * w * 0.85, cy + hh * 0.2]]);
    else if (cfg.ears === 'long') path = () => poly(g, [[cx + d * w * 0.75, cy - hh * 0.1], [cx + d * w * 1.7, cy - hh * 0.2], [cx + d * w * 0.8, cy + hh * 0.3]]);
    else if (cfg.ears === 'round_up') path = () => { g.beginPath(); g.ellipse(cx + d * w * 0.6, cy - hh * 0.95, w * 0.25, hh * 0.4, d * 0.3, 0, Math.PI * 2); };
    else if (cfg.ears === 'round') path = () => { g.beginPath(); g.arc(cx + d * w * 0.8, cy - hh * 0.7, w * 0.25, 0, Math.PI * 2); };
    else if (cfg.ears === 'horn') path = () => poly(g, [[cx + d * w * 0.35, cy - hh * 0.7], [cx + d * w * 0.75, cy - hh * 1.5], [cx + d * w * 0.6, cy - hh * 0.6]]);
    else if (cfg.ears === 'frill') path = () => poly(g, [[cx + d * w * 0.6, cy - hh * 0.6], [cx + d * w * 1.3, cy - hh * 0.3], [cx + d * w * 1.2, cy + hh * 0.2], [cx + d * w * 0.7, cy + hh * 0.3]]);
    if (path) shaded(g, path, cx + d * w * 0.4 - w, cx + d * w * 0.4 + w, cfg.ears === 'horn' ? '#d8c8a0' : earCol, L, { rimW: 1.5 });
  }
  g.restore();
  if (cfg.mane) {
    const mp = () => { g.beginPath(); g.ellipse(cx, cy + hh * 0.2, w * 1.25, hh * 1.2, 0, 0, Math.PI * 2); };
    shaded(g, mp, cx - w * 1.3, cx + w * 1.3, mix(skin, '#1a1208', 0.5), L, { tex: 0.6, seed: 9 });
  }
  const skull = () => { g.beginPath(); g.ellipse(cx, cy, w, hh, 0, 0, Math.PI * 2); };
  shaded(g, skull, cx - w, cx + w, skin, L, { tex: cfg.scales || cfg.spots ? 0.55 : 0.3, seed: 5 });
  if (cfg.spots) {
    g.fillStyle = 'rgba(40,24,10,0.5)';
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.arc(cx + (R() - 0.5) * w * 1.4, cy + (R() - 0.7) * hh, w * 0.08, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (cfg.hair) {
    g.fillStyle = cfg.hair;
    g.beginPath();
    g.ellipse(cx, cy - hh * 0.7, w * 0.85, hh * 0.42, 0, Math.PI, 0);
    g.fill();
    if (k === 'orc') {
      g.beginPath();
      g.ellipse(cx, cy - hh * 1.1, w * 0.18, hh * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (k === 'troll') {
      g.strokeStyle = cfg.hair;
      g.lineWidth = hr * 0.08;
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.moveTo(cx + (i - 4) * w * 0.2, cy - hh * 0.8);
        g.quadraticCurveTo(cx + (i - 4) * w * 0.4, cy - hh * 1.4, cx + (i - 4) * w * 0.5 + (R() - 0.5) * w, cy - hh * 0.9 - R() * hh * 0.8);
        g.stroke();
      }
    }
  }
  if (cfg.brow) {
    g.fillStyle = rgba(skin, 1, 0.45);
    g.beginPath();
    g.ellipse(cx, cy - hh * 0.22, w * 0.8, hh * 0.18, 0, Math.PI, 0);
    g.fill();
  }
  // muzzle
  const sy = cy + hh * 0.3;
  const sl = hh * cfg.snout;
  const sw = w * cfg.snoutW;
  const mz = () => {
    g.beginPath();
    g.ellipse(cx, sy + sl * 0.3, sw * 1.05, hh * 0.35 + sl * 0.35, 0, 0, Math.PI * 2);
  };
  shaded(g, mz, cx - sw, cx + sw, mix(skin, '#e0c0a0', k === 'gnoll' ? 0.1 : 0.05), L, { rimW: 1.5 });
  if (cfg.snout > 0.5) {
    // nose tip
    g.fillStyle = '#140c08';
    g.beginPath();
    g.ellipse(cx, sy + sl * 0.2 - hh * 0.05, sw * 0.4, sw * 0.25, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = 'rgba(20,10,6,0.85)';
    for (const d of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + d * sw * 0.3, sy + hh * 0.02, sw * 0.14, sw * 0.1, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // mouth
  const my = sy + sl * 0.5 + hh * 0.22;
  g.fillStyle = '#1a0806';
  g.beginPath();
  g.ellipse(cx, my, sw * (cfg.wide ? 1.1 : 0.75), hh * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  if (cfg.teeth) {
    g.fillStyle = '#e8e0c8';
    for (let i = -3; i <= 3; i++) poly(g, [[cx + i * sw * 0.2 - sw * 0.06, my - hh * 0.05], [cx + i * sw * 0.2 + sw * 0.06, my - hh * 0.05], [cx + i * sw * 0.2, my + hh * 0.05]]);
    g.fill();
  }
  if (cfg.tusks) {
    g.fillStyle = linGrad(g, cx - sw, 0, cx + sw, 0, [[0, '#fff0d8'], [1, '#8a7a5a']]);
    for (const d of [-1, 1]) {
      poly(g, [[cx + d * sw * 0.55, my + hh * 0.02], [cx + d * sw * 0.8, my + hh * 0.02], [cx + d * sw * 0.72, my - hh * 0.32]]);
      g.fill();
    }
  }
  if (cfg.beard) {
    g.fillStyle = 'rgba(26,18,14,0.85)';
    g.beginPath();
    g.moveTo(cx - sw, my - hh * 0.05);
    g.quadraticCurveTo(cx, my + hh * 0.6, cx + sw, my - hh * 0.05);
    g.fill();
  }
  eyes(g, cx, cy - hh * 0.05, w * 0.36, hr * 0.09, sp.eyes, { slit: k === 'kobold' || k === 'lizard' });
  if (sp.helm) {
    const hp = () => { g.beginPath(); g.ellipse(cx, cy - hh * 0.45, w * 1.02, hh * 0.62, 0, Math.PI, 0); g.lineTo(cx + w * 1.02, cy - hh * 0.3); g.lineTo(cx - w * 1.02, cy - hh * 0.3); g.closePath(); };
    shaded(g, hp, cx - w, cx + w, '#6a6a72', L, { spec: 0.6 });
  }
}

// ------------------------------------------------------------------ body plans

function humanoid(g, sp, h, L, R) {
  const b = sp.build ?? 1;
  const hunch = sp.hunch ?? 0;
  const small = sp.head === 'kobold' || sp.head === 'goblin';
  const hipY = -h * (small ? 0.42 : 0.47);
  const shY = -h * (small ? 0.72 : 0.79) + hunch * h * 0.05;
  const shW = h * 0.135 * b;
  const hipW = h * 0.092 * b;
  const hr = h * (small ? 0.1 : 0.074) * (b > 1.3 ? 0.88 : 1);
  const headY = shY - hr * 0.95 + hunch * h * 0.05;
  const thigh = h * 0.085 * b;
  const shin = h * 0.062 * b;
  const upper = h * 0.066 * b;
  const fore = h * 0.054 * b;
  const armLen = h * (small ? 0.32 : 0.36) * (sp.armLen ?? 1);
  const cloth = sp.cloth;
  const plate = sp.armor === 'plate';
  const skinC = sp.skin;
  const legC = plate ? '#4e4e58' : sp.head === 'zombie' || sp.head === 'troll' || sp.head === 'ogre' || sp.legs === 'digi' ? skinC : mix(cloth, '#000000', 0.25);
  const bootC = plate ? '#3a3a42' : sp.head === 'troll' || sp.head === 'ogre' || sp.legs === 'digi' ? mix(skinC, '#000000', 0.35) : '#1e140c';
  const lean = (R() - 0.5) * 0.06;
  // cape behind everything
  if (sp.cape) {
    const cp = () => {
      g.beginPath();
      g.moveTo(-shW * 1.05, shY + h * 0.01);
      g.quadraticCurveTo(-shW * 1.7, -h * 0.35, -shW * 1.55, -h * 0.02);
      g.quadraticCurveTo(0, h * 0.01, shW * 1.55, -h * 0.03);
      g.quadraticCurveTo(shW * 1.7, -h * 0.35, shW * 1.05, shY + h * 0.01);
      g.closePath();
    };
    shaded(g, cp, -shW * 1.7, shW * 1.7, sp.cape, L, { tex: 0.3, seed: 11 });
    for (const t of [-0.9, -0.3, 0.4, 1.0]) crease(g, [[t * shW, shY + h * 0.06], [t * shW * 1.4, -h * 0.04]], h * 0.012, 0.3);
  }
  if (sp.tail) {
    const tp = () => {
      g.beginPath();
      g.moveTo(hipW * 0.2, hipY - h * 0.01);
      g.bezierCurveTo(hipW * 1.8, hipY + h * 0.02, hipW * 2.6, -h * 0.02, hipW * 3.1, -h * 0.04);
      g.quadraticCurveTo(hipW * 3.9, -h * 0.07, hipW * 3.8, -h * 0.16);
      g.quadraticCurveTo(hipW * 3.4, -h * 0.02, hipW * 2.2, -h * 0.03);
      g.bezierCurveTo(hipW * 1.4, -h * 0.05, hipW * 0.8, hipY + h * 0.12, hipW * 0.1, hipY + h * 0.1);
      g.closePath();
    };
    shaded(g, tp, 0, hipW * 4.2, skinC, L, { tex: 0.4 });
  }
  g.save();
  g.rotate(lean * 0.3);
  // legs (contrapposto: weight on the left leg, right knee relaxed)
  if (sp.armor !== 'robe') {
    for (const d of [-1, 1]) {
      const relaxed = d > 0;
      const hx = d * hipW * 0.55;
      const fx = d * hipW * (relaxed ? 1.35 : 0.95);
      const kx = hx + d * h * (relaxed ? 0.03 : 0.012);
      const ky = hipY + (-hipY) * 0.5 - (relaxed ? h * 0.01 : 0);
      if (sp.legs === 'digi') {
        const hk = [hx + d * h * 0.035, hipY + (-hipY) * 0.38];
        const ank = [fx - d * h * 0.02, -h * 0.1];
        shaded(g, limbPath(g, hx, hipY, hk[0], hk[1], thigh * 1.25, thigh * 0.9), hx - thigh, hx + thigh, legC, L);
        shaded(g, limbPath(g, hk[0], hk[1], ank[0], ank[1], shin * 0.9, shin * 0.6), hk[0] - shin, hk[0] + shin, legC, L);
        shaded(g, limbPath(g, ank[0], ank[1], fx + d * h * 0.01, -h * 0.01, shin * 0.6, shin * 0.55), ank[0] - shin, ank[0] + shin, bootC, L);
        g.fillStyle = rgba(bootC, 1, 0.8);
        for (let i = -1; i <= 1; i++) { g.beginPath(); g.ellipse(fx + d * h * 0.01 + i * shin * 0.35, -h * 0.005, shin * 0.25, shin * 0.18, 0, 0, Math.PI * 2); g.fill(); }
      } else {
        shaded(g, limbPath(g, hx, hipY, kx, ky, thigh * 1.2, shin * 1.05), hx - thigh, hx + thigh, legC, L, { spec: plate ? 0.35 : 0 });
        shaded(g, limbPath(g, kx, ky, fx, -h * 0.035, shin * 1.02, shin * 0.72), kx - shin, kx + shin, legC, L, { spec: plate ? 0.35 : 0 });
        // boot
        shaded(g, () => { g.beginPath(); g.moveTo(fx - shin * 0.6, -h * 0.09); g.lineTo(fx + shin * 0.6, -h * 0.09); g.quadraticCurveTo(fx + shin * (0.8 + (d > 0 ? 0.3 : 0)), -h * 0.01, fx + d * shin * 0.4, 0); g.lineTo(fx - d * shin * 0.9, 0); g.closePath(); }, fx - shin, fx + shin, bootC, L);
        if (plate) { g.fillStyle = 'rgba(220,220,230,0.35)'; g.beginPath(); g.ellipse(kx, ky, shin * 0.6, shin * 0.45, 0, 0, Math.PI * 2); g.fill(); }
        crease(g, [[kx - shin * 0.3, ky + shin * 0.1], [kx + shin * 0.3, ky + shin * 0.15]], h * 0.006, 0.3);
      }
    }
  }
  // torso
  const belly = sp.belly ? h * 0.055 : 0;
  const waistY = hipY - (hipY - shY) * 0.35;
  const torso = () => {
    g.beginPath();
    g.moveTo(-shW * 0.55, shY - h * 0.012);
    g.quadraticCurveTo(0, shY - h * 0.03, shW * 0.55, shY - h * 0.012);
    g.quadraticCurveTo(shW * 1.12, shY, shW * 1.05, shY + h * 0.05);
    g.quadraticCurveTo(shW * 0.9 + belly, waistY, hipW * 1.15 + belly * 0.6, hipY + h * 0.015);
    g.quadraticCurveTo(0, hipY + h * 0.05, -hipW * 1.15 - belly * 0.6, hipY + h * 0.015);
    g.quadraticCurveTo(-shW * 0.9 - belly, waistY, -shW * 1.05, shY + h * 0.05);
    g.quadraticCurveTo(-shW * 1.12, shY, -shW * 0.55, shY - h * 0.012);
    g.closePath();
  };
  const torsoC = plate ? '#5c5c66' : sp.armor === 'scale' ? mix(cloth, '#7a6a44', 0.45) : sp.armor === 'robe' || sp.armor === 'vest' ? cloth : sp.armor === 'fur' ? '#5e4a32' : skinC;
  shaded(g, torso, -shW * 1.1, shW * 1.1, torsoC, L, { spec: plate ? 0.5 : 0, tex: sp.armor === 'fur' || sp.fur ? 0.55 : 0.22, seed: 13 });
  g.save();
  torso();
  g.clip();
  if (sp.armor === 'scale') {
    for (let yy = shY; yy < hipY + h * 0.03; yy += h * 0.02) {
      const row = Math.round((yy - shY) / (h * 0.02));
      for (let xx = -shW * 1.2; xx < shW * 1.2; xx += h * 0.026) {
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath();
        g.arc(xx + (row % 2) * h * 0.013, yy + h * 0.012, h * 0.013, 0, Math.PI);
        g.fill();
        g.fillStyle = 'rgba(255,230,180,0.12)';
        g.fillRect(xx + (row % 2) * h * 0.013 - h * 0.008, yy + h * 0.004, h * 0.012, h * 0.003);
      }
    }
  } else if (plate) {
    crease(g, [[0, shY + h * 0.02], [0, hipY]], h * 0.006, 0.35);
    crease(g, [[-shW, waistY], [shW, waistY]], h * 0.007, 0.3);
  } else if (!sp.armor || sp.armor === 'scraps' || sp.armor === 'rags' || sp.armor === 'fur') {
    // anatomy: pectorals and belly
    crease(g, [[-shW * 0.7, shY + h * 0.085], [-shW * 0.15, shY + h * 0.1], [0, shY + h * 0.07]], h * 0.008, 0.28);
    crease(g, [[shW * 0.7, shY + h * 0.085], [shW * 0.15, shY + h * 0.1], [0, shY + h * 0.07]], h * 0.008, 0.28);
    crease(g, [[0, shY + h * 0.12], [0, hipY - h * 0.02]], h * 0.006, 0.18);
  }
  if (sp.armor === 'vest' || sp.armor === 'scraps' || sp.armor === 'rags') {
    g.fillStyle = sp.armor === 'vest' ? rgba(cloth, 1, 0.55) : sp.armor === 'rags' ? rgba(cloth, 0.9) : '#3a2614';
    if (sp.armor === 'rags') {
      g.beginPath();
      g.moveTo(-shW * 1.2, shY + h * 0.05);
      g.lineTo(shW * 1.2, shY + h * 0.03);
      for (let i = 0; i <= 8; i++) {
        const x = shW * 1.1 - (i / 8) * shW * 2.2;
        g.lineTo(x, (i % 2 ? waistY + h * 0.02 : hipY - h * 0.01) + (R() - 0.5) * h * 0.04);
      }
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(-shW * 0.2, shY + h * 0.08, shW * 0.5, h * 0.05);
    } else {
      g.beginPath();
      g.moveTo(-shW * 1.2, shY + h * 0.03);
      g.lineTo(shW * 0.9, hipY - h * 0.02);
      g.lineTo(shW * 1.2, hipY - h * 0.05);
      g.lineTo(-shW * 0.9, shY);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
  // pauldrons / shoulders
  if (sp.armor === 'scraps' || plate || sp.armor === 'scale') {
    for (const d of [-1, 1]) {
      const pp = () => { g.beginPath(); g.ellipse(d * shW * 0.98, shY + h * 0.018, shW * 0.42, h * 0.042, d * 0.25, 0, Math.PI * 2); };
      shaded(g, pp, d * shW * 0.98 - shW * 0.42, d * shW * 0.98 + shW * 0.42, plate ? '#6a6a74' : sp.armor === 'scale' ? '#5a4a2a' : '#4a3a2a', L, { spec: plate ? 0.6 : 0.15 });
    }
  }
  // robe skirt / kilt
  if (sp.armor === 'robe') {
    const rp = () => {
      g.beginPath();
      g.moveTo(-hipW * 1.2, hipY - h * 0.01);
      g.lineTo(hipW * 1.2, hipY - h * 0.01);
      g.quadraticCurveTo(hipW * 1.8, -h * 0.2, hipW * 2.2, -h * 0.004);
      g.quadraticCurveTo(0, h * 0.01, -hipW * 2.2, -h * 0.004);
      g.quadraticCurveTo(-hipW * 1.8, -h * 0.2, -hipW * 1.2, hipY - h * 0.01);
      g.closePath();
    };
    shaded(g, rp, -hipW * 2.2, hipW * 2.2, cloth, L, { tex: 0.3, seed: 17 });
    for (const t of [-1.3, -0.5, 0.3, 1.1]) crease(g, [[t * hipW * 0.7, hipY + h * 0.02], [t * hipW * 1.5, -h * 0.01]], h * 0.012, 0.32);
  } else {
    const lp = () => {
      g.beginPath();
      g.moveTo(-hipW * 1.25, hipY - h * 0.012);
      g.lineTo(hipW * 1.25, hipY - h * 0.012);
      g.lineTo(hipW * 1.15, hipY + h * 0.1);
      g.lineTo(hipW * 0.45, hipY + h * 0.075);
      g.lineTo(0, hipY + h * 0.13);
      g.lineTo(-hipW * 0.5, hipY + h * 0.08);
      g.lineTo(-hipW * 1.2, hipY + h * 0.11);
      g.closePath();
    };
    shaded(g, lp, -hipW * 1.25, hipW * 1.25, plate ? '#3a3a44' : cloth, L, { tex: 0.35, seed: 19 });
  }
  // belt
  g.fillStyle = '#1c1208';
  g.fillRect(-hipW * 1.28 - belly * 0.5, hipY - h * 0.022, (hipW * 1.28 + belly * 0.5) * 2, h * 0.028);
  g.fillStyle = '#b8984a';
  g.fillRect(-h * 0.014, hipY - h * 0.022, h * 0.028, h * 0.028);
  // neck
  shaded(g, limbPath(g, 0, shY + h * 0.01, 0, headY + hr * 0.5, hr * 0.8, hr * 0.7), -hr, hr, skinC, L);
  g.restore();
  // off arm (viewer's right) + shield
  const fwd = sp.armsForward;
  const armC = plate ? '#5c5c66' : skinC;
  {
    const sx = shW * 0.95;
    const ex = sx + h * 0.045;
    const ey = shY + armLen * 0.48;
    const hx = fwd ? sx + h * 0.0 : sx + h * 0.025;
    const hy = fwd ? shY + armLen * 0.62 : shY + armLen * 0.98;
    shaded(g, limbPath(g, sx, shY + h * 0.015, ex, ey, upper * 1.15, fore * 1.05), sx - upper, sx + upper * 1.5, armC, L, { spec: plate ? 0.35 : 0 });
    shaded(g, limbPath(g, ex, ey, hx, hy, fore, fore * 0.8), ex - fore, ex + fore, armC, L, { spec: plate ? 0.35 : 0 });
    shaded(g, () => { g.beginPath(); g.ellipse(hx, hy + fore * 0.3, fore * 0.62, fore * 0.72, 0, 0, Math.PI * 2); }, hx - fore, hx + fore, plate ? '#4a4a52' : skinC, L);
    if (sp.claws) for (let i = -1; i <= 1; i++) crease(g, [[hx + i * fore * 0.3, hy + fore * 0.7], [hx + i * fore * 0.42, hy + fore * 1.4]], h * 0.006, 0.9);
    if (sp.shield) shield(g, sp.shield, hx + h * 0.02, shY + armLen * 0.66, h, L, '#5a3a1e');
    if (sp.gauntlet) {
      g.fillStyle = '#0a0a0a';
      g.beginPath();
      g.arc(hx, hy + fore * 0.3, fore * 0.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  // head
  g.save();
  g.translate(0, headY);
  g.rotate(lean);
  head(g, sp, 0, 0, hr, L, R);
  g.restore();
  // weapon arm (viewer's left): forearm raised across the body, weapon angled up
  {
    const sx = -shW * 0.95;
    const ex = sx - h * 0.06;
    const ey = shY + armLen * 0.46;
    const hx = fwd ? sx - h * 0.01 : sx + h * 0.01;
    const hy = fwd ? shY + armLen * 0.62 : shY + armLen * 0.78;
    shaded(g, limbPath(g, sx, shY + h * 0.015, ex, ey, upper * 1.15, fore * 1.05), ex - upper, sx + upper, armC, L, { spec: plate ? 0.35 : 0 });
    if (sp.weapon) weapon(g, sp.weapon, hx, hy, h, L, sp.weapon === 'spear' ? -0.12 : -0.4);
    shaded(g, limbPath(g, ex, ey, hx, hy, fore, fore * 0.8), hx - fore, ex + fore, armC, L, { spec: plate ? 0.35 : 0 });
    shaded(g, () => { g.beginPath(); g.ellipse(hx, hy, fore * 0.66, fore * 0.62, 0, 0, Math.PI * 2); }, hx - fore, hx + fore, plate ? '#4a4a52' : skinC, L);
    if (sp.claws && !sp.weapon) for (let i = -1; i <= 1; i++) crease(g, [[hx + i * fore * 0.3, hy + fore * 0.4], [hx + i * fore * 0.42, hy + fore * 1.1]], h * 0.006, 0.9);
  }
}

function skeleton(g, sp, h, L) {
  const bone = sp.bone;
  const B = (x0, y0, x1, y1, w) => shaded(g, limbPath(g, x0, y0, x1, y1, w, w * 0.8), Math.min(x0, x1) - w, Math.max(x0, x1) + w, bone, L, { rimW: 1.2 });
  const hipY = -h * 0.47;
  const shY = -h * 0.79;
  // legs
  for (const d of [-1, 1]) {
    B(d * h * 0.05, hipY, d * h * 0.06, hipY + h * 0.23, h * 0.024);
    B(d * h * 0.06, hipY + h * 0.23, d * h * 0.07, -h * 0.02, h * 0.02);
    g.fillStyle = rgba(bone, 1, 0.6);
    g.fillRect(d * h * 0.07 - h * 0.03, -h * 0.02, h * 0.06, h * 0.018);
  }
  // pelvis
  shaded(g, () => { g.beginPath(); g.ellipse(0, hipY, h * 0.075, h * 0.035, 0, 0, Math.PI * 2); }, -h * 0.08, h * 0.08, bone, L);
  // spine
  for (let i = 0; i < 8; i++) {
    const y = hipY - i * (hipY - shY) / 8;
    g.fillStyle = rgba(bone, 1, 0.85);
    g.beginPath();
    g.ellipse(0, y, h * 0.014, h * 0.012, 0, 0, Math.PI * 2);
    g.fill();
  }
  // ribcage
  for (let i = 0; i < 5; i++) {
    const y = shY + h * 0.035 + i * h * 0.03;
    const w = h * (0.1 - i * 0.008);
    g.strokeStyle = rgba(bone, 1, 1 - i * 0.08);
    g.lineWidth = h * 0.012;
    g.beginPath();
    g.ellipse(0, y, w, h * 0.022, 0, Math.PI * 0.05, Math.PI * 0.95);
    g.stroke();
  }
  // collarbones
  B(-h * 0.11, shY, h * 0.11, shY, h * 0.014);
  // arms
  B(h * 0.11, shY, h * 0.13, shY + h * 0.17, h * 0.018);
  B(h * 0.13, shY + h * 0.17, h * 0.15, shY + h * 0.3, h * 0.015);
  if (sp.shield) shield(g, sp.shield, h * 0.18, shY + h * 0.22, h, L, '#4a3a2a');
  // skull
  const hr = h * 0.068;
  const hy = shY - hr * 1.15;
  shaded(g, () => { g.beginPath(); g.ellipse(0, hy, hr * 0.82, hr, 0, 0, Math.PI * 2); }, -hr, hr, bone, L);
  shaded(g, () => { g.beginPath(); g.ellipse(0, hy + hr * 0.75, hr * 0.5, hr * 0.35, 0, 0, Math.PI * 2); }, -hr * 0.5, hr * 0.5, bone, L);
  g.fillStyle = '#0a0806';
  for (const d of [-1, 1]) { g.beginPath(); g.ellipse(d * hr * 0.33, hy - hr * 0.05, hr * 0.24, hr * 0.28, 0, 0, Math.PI * 2); g.fill(); }
  poly(g, [[0, hy + hr * 0.2], [-hr * 0.1, hy + hr * 0.42], [hr * 0.1, hy + hr * 0.42]]);
  g.fill();
  g.fillStyle = 'rgba(20,14,8,0.8)';
  for (let i = -2; i <= 2; i++) g.fillRect(i * hr * 0.14 - 1, hy + hr * 0.62, 1.5, hr * 0.25);
  eyes(g, 0, hy - hr * 0.05, hr * 0.33, hr * 0.08, sp.eyes);
  // weapon arm
  B(-h * 0.11, shY, -h * 0.16, shY + h * 0.15, h * 0.018);
  weapon(g, sp.weapon, -h * 0.17, shY + h * 0.27, h, L, -0.6);
  B(-h * 0.16, shY + h * 0.15, -h * 0.17, shY + h * 0.27, h * 0.015);
}

function wraith(g, sp, h, L, R) {
  g.save();
  if (sp.ghostly) g.globalAlpha = 0.75;
  const col = sp.color;
  const path = () => {
    g.beginPath();
    g.moveTo(0, -h);
    g.bezierCurveTo(h * 0.2, -h, h * 0.22, -h * 0.8, h * 0.2, -h * 0.7);
    g.bezierCurveTo(h * 0.42, -h * 0.62, h * 0.4, -h * 0.4, h * 0.34, -h * 0.3);
    for (let i = 0; i < 6; i++) g.lineTo(h * (0.3 - i * 0.12), -h * (0.1 + (i % 2) * 0.12 + R() * 0.06));
    g.bezierCurveTo(-h * 0.4, -h * 0.4, -h * 0.42, -h * 0.62, -h * 0.2, -h * 0.7);
    g.bezierCurveTo(-h * 0.22, -h * 0.8, -h * 0.2, -h, 0, -h);
    g.closePath();
  };
  if (sp.ghostly) glow(g, 0, -h * 0.55, h * 0.7, col, 0.35);
  shaded(g, path, -h * 0.4, h * 0.4, col, L, { tex: 0.5, seed: 23 });
  g.fillStyle = 'rgba(0,0,0,0.85)';
  g.beginPath();
  g.ellipse(0, -h * 0.84, h * 0.1, h * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  eyes(g, 0, -h * 0.85, h * 0.04, h * 0.012, sp.eyes);
  // clawed hands reaching
  g.strokeStyle = rgba(col, 0.9, 1.4);
  g.lineWidth = h * 0.012;
  for (const d of [-1, 1]) for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(d * h * 0.34, -h * 0.5);
    g.lineTo(d * h * (0.42 + i * 0.02), -h * (0.44 - i * 0.03));
    g.stroke();
  }
  g.restore();
}

function quad(g, sp, h, L, R) {
  // frontal: the beast faces the party, body receding behind its head
  const fur = sp.fur;
  const sy = -h * 0.62; // shoulder line
  const bw = h * 0.42;
  // haunches and back (behind)
  shaded(g, () => { g.beginPath(); g.ellipse(0, sy - h * 0.06, bw * 1.05, h * 0.28, 0, 0, Math.PI * 2); }, -bw, bw, mix(fur, '#000000', 0.25), L, { tex: 0.6, seed: 29 });
  // tail curling off to one side
  if (sp.tail === 'rat') {
    const tp = () => { g.beginPath(); g.moveTo(bw * 0.6, sy - h * 0.1); g.bezierCurveTo(bw * 1.8, sy - h * 0.3, bw * 2.2, -h * 0.05, bw * 2.8, -h * 0.02); g.lineTo(bw * 2.8, h * 0.0); g.bezierCurveTo(bw * 2.1, -h * 0.02, bw * 1.7, sy - h * 0.22, bw * 0.6, sy - h * 0.02); g.closePath(); };
    shaded(g, tp, bw * 0.6, bw * 2.8, '#9a7a70', L);
  } else if (sp.tail === 'bushy') {
    shaded(g, () => { g.beginPath(); g.ellipse(bw * 1.3, sy - h * 0.02, bw * 0.75, h * 0.1, -0.35, 0, Math.PI * 2); }, bw * 0.5, bw * 2.1, fur, L, { tex: 0.7 });
  }
  // chest and shoulders
  shaded(g, () => { g.beginPath(); g.ellipse(0, sy + h * 0.06, bw * 0.85, h * 0.26, 0, 0, Math.PI * 2); }, -bw, bw, fur, L, { tex: 0.65, seed: 31 });
  // front legs
  for (const d of [-1, 1]) {
    const x0 = d * bw * 0.55;
    shaded(g, limbPath(g, x0, sy + h * 0.02, x0 + d * h * 0.03, -h * 0.05, h * 0.16, h * 0.08), x0 - h * 0.1, x0 + h * 0.1, fur, L, { tex: 0.5 });
    g.fillStyle = rgba(fur, 1, 0.45);
    g.beginPath();
    g.ellipse(x0 + d * h * 0.03, -h * 0.025, h * 0.07, h * 0.035, 0, 0, Math.PI * 2);
    g.fill();
    for (let i = -1; i <= 1; i++) crease(g, [[x0 + d * h * 0.03 + i * h * 0.025, -h * 0.02], [x0 + d * h * 0.03 + i * h * 0.03, h * 0.005]], h * 0.008, 0.8);
  }
  // head, low and forward
  const hx = 0;
  const hy = sy + h * 0.02;
  const hr = h * 0.2;
  if (sp.ears === 'pointed') for (const d of [-1, 1]) shaded(g, () => poly(g, [[hx + d * hr * 0.35, hy - hr * 0.55], [hx + d * hr * 0.75, hy - hr * 1.45], [hx + d * hr * 0.95, hy - hr * 0.35]]), hx - hr, hx + hr, fur, L);
  else for (const d of [-1, 1]) { shaded(g, () => { g.beginPath(); g.arc(hx + d * hr * 0.75, hy - hr * 0.7, hr * 0.42, 0, Math.PI * 2); }, hx - hr, hx + hr, '#9a7a70', L); g.fillStyle = 'rgba(120,50,50,0.5)'; g.beginPath(); g.arc(hx + d * hr * 0.75, hy - hr * 0.7, hr * 0.24, 0, Math.PI * 2); g.fill(); }
  shaded(g, () => { g.beginPath(); g.ellipse(hx, hy, hr, hr * 0.82, 0, 0, Math.PI * 2); }, hx - hr, hx + hr, fur, L, { tex: 0.6 });
  // muzzle toward the viewer
  const mz = sp.snout ?? 1;
  shaded(g, () => { g.beginPath(); g.ellipse(hx, hy + hr * 0.5, hr * 0.48 * mz, hr * 0.5, 0, 0, Math.PI * 2); }, hx - hr * 0.5, hx + hr * 0.5, mix(fur, '#c8b0a0', 0.25), L);
  g.fillStyle = '#120806';
  g.beginPath();
  g.ellipse(hx, hy + hr * 0.3, hr * 0.2, hr * 0.13, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a0606';
  g.beginPath();
  g.ellipse(hx, hy + hr * 0.78, hr * 0.3, hr * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#efe6d2';
  for (const d of [-1, 1]) poly(g, [[hx + d * hr * 0.08, hy + hr * 0.7], [hx + d * hr * 0.22, hy + hr * 0.7], [hx + d * hr * 0.14, hy + hr * (sp.tail === 'rat' ? 1.0 : 0.95)]]);
  g.fill();
  // whiskers
  if (sp.tail === 'rat') for (const d of [-1, 1]) for (let i = 0; i < 3; i++) crease(g, [[hx + d * hr * 0.25, hy + hr * 0.45], [hx + d * hr * (1.1 + i * 0.1), hy + hr * (0.3 + i * 0.15)]], 0.8, 0.5);
  eyes(g, hx, hy - hr * 0.12, hr * 0.42, hr * 0.12, sp.eyes);
  void R;
}

function spider(g, sp, h, L) {
  const col = sp.skin;
  const cy = -h * 0.45;
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) for (const d of [-1, 1]) {
    const a0 = -0.9 + i * 0.5;
    const kx = d * h * (0.45 + i * 0.05);
    const ky = cy - h * (0.35 - i * 0.12);
    const fx = d * h * (0.6 + i * 0.12);
    shaded(g, limbPath(g, d * h * 0.1, cy, kx, ky, h * 0.05, h * 0.035), Math.min(0, kx), Math.max(0, kx), col, L, { rimW: 1.5 });
    shaded(g, limbPath(g, kx, ky, fx, 0, h * 0.035, h * 0.015), Math.min(kx, fx), Math.max(kx, fx), col, L, { rimW: 1.5 });
    void a0;
  }
  shaded(g, () => { g.beginPath(); g.ellipse(0, cy - h * 0.2, h * 0.34, h * 0.28, 0, 0, Math.PI * 2); }, -h * 0.34, h * 0.34, col, L, { tex: 0.6, spec: 0.25 });
  g.fillStyle = 'rgba(160,30,20,0.7)';
  poly(g, [[0, cy - h * 0.38], [h * 0.06, cy - h * 0.24], [0, cy - h * 0.12], [-h * 0.06, cy - h * 0.24]]);
  g.fill();
  shaded(g, () => { g.beginPath(); g.ellipse(0, cy + h * 0.06, h * 0.18, h * 0.14, 0, 0, Math.PI * 2); }, -h * 0.18, h * 0.18, col, L);
  for (const [ex, ey, r] of [[-0.05, 0.02, 0.022], [0.05, 0.02, 0.022], [-0.1, 0.05, 0.014], [0.1, 0.05, 0.014], [-0.025, 0.07, 0.012], [0.025, 0.07, 0.012]]) {
    glow(g, h * ex, cy + h * ey, h * r * 4, sp.eyes, 0.5);
    g.fillStyle = sp.eyes;
    g.beginPath();
    g.arc(h * ex, cy + h * ey, h * r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#1a1010';
  for (const d of [-1, 1]) poly(g, [[d * h * 0.04, cy + h * 0.14], [d * h * 0.07, cy + h * 0.14], [d * h * 0.03, cy + h * 0.26]]);
  g.fill();
}

function frog(g, sp, h, L) {
  const col = sp.skin;
  shaded(g, () => { g.beginPath(); g.ellipse(0, -h * 0.4, h * 0.6, h * 0.4, 0, 0, Math.PI * 2); }, -h * 0.6, h * 0.6, col, L, { tex: 0.6, spec: 0.3, seed: 31 });
  for (const d of [-1, 1]) {
    shaded(g, () => { g.beginPath(); g.ellipse(d * h * 0.55, -h * 0.12, h * 0.25, h * 0.14, 0, 0, Math.PI * 2); }, d * h * 0.3, d * h * 0.8, col, L);
    shaded(g, limbPath(g, d * h * 0.25, -h * 0.3, d * h * 0.3, 0, h * 0.1, h * 0.06), d * h * 0.2, d * h * 0.35, col, L);
    shaded(g, () => { g.beginPath(); g.arc(d * h * 0.25, -h * 0.76, h * 0.13, 0, Math.PI * 2); }, d * h * 0.12, d * h * 0.38, col, L);
  }
  g.strokeStyle = '#1a2014';
  g.lineWidth = h * 0.02;
  g.beginPath();
  g.moveTo(-h * 0.45, -h * 0.42);
  g.quadraticCurveTo(0, -h * 0.3, h * 0.45, -h * 0.42);
  g.stroke();
  eyes(g, 0, -h * 0.78, h * 0.25, h * 0.06, sp.eyes, { slit: true });
}

function centipede(g, sp, h, L) {
  const col = sp.skin;
  for (let i = 11; i >= 0; i--) {
    const t = i / 11;
    const x = Math.sin(t * 4) * h * 0.5;
    const y = -h * 0.1 - t * h * 0.15 - (i < 4 ? (4 - i) * h * 0.14 : 0);
    const r = h * (0.13 - t * 0.04);
    g.strokeStyle = rgba(col, 1, 0.5);
    g.lineWidth = h * 0.015;
    for (const d of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + d * r * 2, y + r * 1.2); g.stroke(); }
    shaded(g, () => { g.beginPath(); g.ellipse(x, y, r * 1.2, r, 0, 0, Math.PI * 2); }, x - r, x + r, col, L, { spec: 0.35 });
  }
  eyes(g, 0, -h * 0.72, h * 0.05, h * 0.02, sp.eyes);
  g.strokeStyle = '#1a0a04';
  g.lineWidth = h * 0.02;
  for (const d of [-1, 1]) { g.beginPath(); g.moveTo(d * h * 0.04, -h * 0.64); g.quadraticCurveTo(d * h * 0.12, -h * 0.58, d * h * 0.06, -h * 0.54); g.stroke(); }
}

/** Great bronze dragon rising from the Pool: wings, coiled body, neck, head. h = full height. */
function dragon(g, sp, h, L) {
  const col = sp.skin;
  const dk = mix(col, '#2a1004', 0.5);
  // wings: spars and scalloped membranes
  for (const d of [-1, 1]) {
    const tip = [d * h * 0.98, -h * 1.12];
    const elbow = [d * h * 0.5, -h * 0.92];
    const root = [d * h * 0.12, -h * 0.5];
    const fingers = [[d * h * 1.02, -h * 0.62], [d * h * 0.86, -h * 0.4], [d * h * 0.62, -h * 0.26]];
    const wp = () => {
      g.beginPath();
      g.moveTo(root[0], root[1]);
      g.quadraticCurveTo(d * h * 0.3, -h * 0.9, elbow[0], elbow[1]);
      g.lineTo(tip[0], tip[1]);
      let prev = tip;
      for (const f of fingers) {
        g.quadraticCurveTo((prev[0] + f[0]) / 2 - d * h * 0.06, (prev[1] + f[1]) / 2 + h * 0.03, f[0], f[1]);
        prev = f;
      }
      g.quadraticCurveTo(d * h * 0.4, -h * 0.26, d * h * 0.1, -h * 0.25);
      g.closePath();
    };
    shaded(g, wp, d < 0 ? -h : 0, d < 0 ? 0 : h, mix(col, '#4a1e08', 0.55), L, { tex: 0.5, seed: 41 });
    g.save();
    wp();
    g.clip();
    g.fillStyle = 'rgba(255,190,90,0.12)';
    g.fillRect(d < 0 ? -h : 0, -h * 1.2, h, h);
    g.restore();
    g.strokeStyle = rgba(dk, 1);
    g.lineCap = 'round';
    g.lineWidth = h * 0.022;
    g.beginPath();
    g.moveTo(root[0], root[1]);
    g.quadraticCurveTo(d * h * 0.3, -h * 0.9, elbow[0], elbow[1]);
    g.lineTo(tip[0], tip[1]);
    g.stroke();
    g.lineWidth = h * 0.012;
    for (const f of fingers) { g.beginPath(); g.moveTo(elbow[0], elbow[1]); g.lineTo(f[0], f[1]); g.stroke(); }
  }
  // coiled body, half in the Pool
  shaded(g, () => { g.beginPath(); g.ellipse(0, -h * 0.17, h * 0.4, h * 0.16, 0, 0, Math.PI * 2); }, -h * 0.4, h * 0.4, col, L, { tex: 0.5, spec: 0.3, seed: 43 });
  g.save();
  g.beginPath();
  g.ellipse(0, -h * 0.17, h * 0.4, h * 0.16, 0, 0, Math.PI * 2);
  g.clip();
  scales(g, -h * 0.4, -h * 0.33, h * 0.8, h * 0.32, h * 0.04);
  g.restore();
  // forelegs gripping the rim
  for (const d of [-1, 1]) {
    shaded(g, limbPath(g, d * h * 0.2, -h * 0.22, d * h * 0.3, -h * 0.03, h * 0.09, h * 0.06), d * h * 0.1, d * h * 0.35, col, L);
    for (let i = -1; i <= 1; i++) crease(g, [[d * h * 0.3 + i * h * 0.02, -h * 0.03], [d * h * 0.31 + i * h * 0.03, 0]], h * 0.01, 0.9);
  }
  // S-curved neck
  const neck = () => {
    g.beginPath();
    g.moveTo(-h * 0.13, -h * 0.26);
    g.bezierCurveTo(-h * 0.24, -h * 0.5, h * 0.12, -h * 0.6, -h * 0.02, -h * 0.82);
    g.lineTo(h * 0.13, -h * 0.82);
    g.bezierCurveTo(h * 0.26, -h * 0.58, -h * 0.04, -h * 0.5, h * 0.13, -h * 0.26);
    g.closePath();
  };
  shaded(g, neck, -h * 0.22, h * 0.26, col, L, { tex: 0.4, spec: 0.3, seed: 45 });
  g.save();
  neck();
  g.clip();
  scales(g, -h * 0.25, -h * 0.85, h * 0.5, h * 0.6, h * 0.035);
  // pale belly plates down the throat
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const x = -h * 0.05 + Math.sin(t * Math.PI * 1.2) * h * 0.05;
    g.fillStyle = 'rgba(240,210,150,0.35)';
    g.fillRect(x - h * 0.05, -h * (0.32 + t * 0.48), h * 0.1, h * 0.022);
  }
  g.restore();
  dragonHead(g, h * 0.055, -h * 0.92, h * 0.17, col, sp.eyes, L);
}

/** Rows of overlapping scales (clip to the shape first). */
function scales(g, x, y, w, h, size, dark = 'rgba(40,18,4,0.45)', light = 'rgba(255,220,150,0.18)') {
  for (let row = 0, yy = y; yy < y + h; yy += size * 0.55, row++) {
    for (let xx = x - size + (row % 2) * size * 0.5; xx < x + w + size; xx += size) {
      g.strokeStyle = dark;
      g.lineWidth = Math.max(0.8, size * 0.09);
      g.beginPath();
      g.arc(xx, yy, size * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      g.strokeStyle = light;
      g.lineWidth = Math.max(0.6, size * 0.05);
      g.beginPath();
      g.arc(xx, yy - size * 0.08, size * 0.42, 1.15 * Math.PI, 1.6 * Math.PI);
      g.stroke();
    }
  }
}

/** Frontal head of a great bronze dragon, looking down at the viewer. s ≈ half-width. */
export function dragonHead(g, cx, cy, s, col, eyeCol, L) {
  const dk = mix(col, '#1a0a02', 0.55);
  // swept-back horns
  for (const d of [-1, 1]) {
    shaded(g, () => {
      g.beginPath();
      g.moveTo(cx + d * s * 0.45, cy - s * 0.25);
      g.bezierCurveTo(cx + d * s * 1.1, cy - s * 0.55, cx + d * s * 1.55, cy - s * 1.1, cx + d * s * 1.35, cy - s * 1.9);
      g.bezierCurveTo(cx + d * s * 1.25, cy - s * 1.2, cx + d * s * 0.95, cy - s * 0.6, cx + d * s * 0.62, cy + s * 0.05);
      g.closePath();
    }, cx - s * 1.6, cx + s * 1.6, '#e2cc98', L, { spec: 0.35 });
    // cheek spikes
    for (let i = 0; i < 3; i++) {
      shaded(g, () => poly(g, [[cx + d * s * (0.78 - i * 0.08), cy + s * (0.15 + i * 0.28)], [cx + d * s * (1.25 - i * 0.12), cy + s * (0.0 + i * 0.3)], [cx + d * s * (0.74 - i * 0.08), cy + s * (0.32 + i * 0.28)]]), cx - s * 1.3, cx + s * 1.3, '#cdb684', L);
    }
  }
  // frill behind the jaw
  for (const d of [-1, 1]) shaded(g, () => { g.beginPath(); g.moveTo(cx + d * s * 0.6, cy - s * 0.1); g.quadraticCurveTo(cx + d * s * 1.15, cy + s * 0.3, cx + d * s * 0.95, cy + s * 0.95); g.lineTo(cx + d * s * 0.5, cy + s * 0.6); g.closePath(); }, cx - s * 1.2, cx + s * 1.2, dk, L, { tex: 0.4 });
  // skull and snout
  const head = () => {
    g.beginPath();
    g.moveTo(cx - s * 0.62, cy - s * 0.42);
    g.quadraticCurveTo(cx, cy - s * 0.78, cx + s * 0.62, cy - s * 0.42);
    g.quadraticCurveTo(cx + s * 0.9, cy + s * 0.05, cx + s * 0.72, cy + s * 0.38);
    g.quadraticCurveTo(cx + s * 0.42, cy + s * 0.8, cx + s * 0.34, cy + s * 1.18);
    g.quadraticCurveTo(cx, cy + s * 1.36, cx - s * 0.34, cy + s * 1.18);
    g.quadraticCurveTo(cx - s * 0.42, cy + s * 0.8, cx - s * 0.72, cy + s * 0.38);
    g.quadraticCurveTo(cx - s * 0.9, cy + s * 0.05, cx - s * 0.62, cy - s * 0.42);
    g.closePath();
  };
  shaded(g, head, cx - s * 0.9, cx + s * 0.9, col, L, { spec: 0.3, tex: 0.3, seed: 47 });
  g.save();
  head();
  g.clip();
  scales(g, cx - s, cy - s * 0.8, s * 2, s * 2.2, s * 0.16);
  // snout ridge plates
  for (let i = 0; i < 5; i++) {
    const y = cy + s * (0.05 + i * 0.2);
    g.fillStyle = rgba(col, 1, 1.25 - i * 0.05);
    g.beginPath();
    g.ellipse(cx, y, s * (0.16 - i * 0.015), s * 0.07, 0, 0, Math.PI * 2);
    g.fill();
  }
  // form shadow under the brows and down the snout's right side
  g.fillStyle = linGrad(g, cx - s, 0, cx + s, 0, [[0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,0,0.05)'], [1, 'rgba(10,2,0,0.55)']]);
  g.fillRect(cx - s, cy - s, s * 2, s * 2.5);
  g.restore();
  // heavy brow ridges
  for (const d of [-1, 1]) {
    shaded(g, () => { g.beginPath(); g.moveTo(cx + d * s * 0.08, cy - s * 0.12); g.quadraticCurveTo(cx + d * s * 0.4, cy - s * 0.38, cx + d * s * 0.78, cy - s * 0.12); g.quadraticCurveTo(cx + d * s * 0.42, cy - s * 0.2, cx + d * s * 0.08, cy - s * 0.02); g.closePath(); }, cx - s, cx + s, dk, L);
  }
  // open jaw: fire-lit mouth and teeth
  const my = cy + s * 1.05;
  g.save();
  g.beginPath();
  g.ellipse(cx, my, s * 0.3, s * 0.14, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#2a0600';
  g.fillRect(cx - s, my - s, s * 2, s * 2);
  glow(g, cx, my + s * 0.06, s * 0.4, '#ff8a20', 0.9);
  g.restore();
  g.fillStyle = '#f2ead6';
  for (let i = -3; i <= 3; i++) {
    poly(g, [[cx + i * s * 0.075 - s * 0.025, my - s * 0.12], [cx + i * s * 0.075 + s * 0.025, my - s * 0.12], [cx + i * s * 0.075, my - s * 0.02]]);
    g.fill();
    poly(g, [[cx + i * s * 0.075 - s * 0.022, my + s * 0.13], [cx + i * s * 0.075 + s * 0.022, my + s * 0.13], [cx + i * s * 0.075, my + s * 0.05]]);
    g.fill();
  }
  // nostrils with a wisp of smoke
  g.fillStyle = '#140600';
  for (const d of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + d * s * 0.13, cy + s * 0.88, s * 0.05, s * 0.032, d * 0.4, 0, Math.PI * 2);
    g.fill();
    glow(g, cx + d * s * 0.2, cy + s * 0.78, s * 0.22, '#c8b8a0', 0.12, 'screen');
  }
  // burning eyes
  eyes(g, cx, cy - s * 0.04, s * 0.4, s * 0.075, eyeCol, { slit: true });
  glow(g, cx, cy, s * 2.4, '#ff9a30', 0.18);
}

// ------------------------------------------------------------------ lighting

/**
 * Light the whole silhouette: form shadow from the left key, ambient
 * occlusion toward the feet, a thin warm key edge on the left and a cool
 * scene-coloured rim on the right (derived from the alpha mask), then grain.
 */
function lightFigure(c, h, L, ghostly = false) {
  const W = c.width;
  const H = c.height;
  const g = c.getContext('2d');
  // form & AO (source-atop keeps it inside the figure)
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = linGrad(g, 0, 0, W, 0, [[0, 'rgba(255,220,180,0.06)'], [0.45, 'rgba(0,0,0,0)'], [0.7, 'rgba(0,0,10,0.28)'], [1, 'rgba(0,0,10,0.5)']]);
  g.fillRect(0, 0, W, H);
  g.fillStyle = linGrad(g, 0, H * 0.55, 0, H, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']]);
  g.fillRect(0, 0, W, H);
  g.fillStyle = linGrad(g, 0, 0, 0, H * 0.4, [[0, rgba(L.key, 0.1)], [1, 'rgba(0,0,0,0)']]);
  g.fillRect(0, 0, W, H);
  g.restore();
  // painterly grain, kept inside the silhouette
  const t = makeCanvas(W, H);
  const tg = t.getContext('2d');
  tg.drawImage(c, 0, 0);
  texture(tg, 0, 0, W, H, { alpha: 0.2, mode: 'overlay', cells: 64, octaves: 3, seed: 61 });
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(c, 0, 0);
  g.clearRect(0, 0, W, H);
  g.drawImage(t, 0, 0);
  // edge lights from the alpha mask
  const edge = (dx, color, alpha, blur) => {
    const m = makeCanvas(W, H);
    const mg = m.getContext('2d');
    mg.drawImage(c, 0, 0);
    mg.globalCompositeOperation = 'source-in';
    mg.fillStyle = color;
    mg.fillRect(0, 0, W, H);
    mg.globalCompositeOperation = 'destination-out';
    mg.drawImage(c, dx, 0);
    const out = makeCanvas(W, H);
    const og = out.getContext('2d');
    og.filter = `blur(${blur}px)`;
    og.drawImage(m, 0, 0);
    og.filter = 'none';
    og.globalCompositeOperation = 'destination-in';
    og.drawImage(c, 0, 0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha;
    g.drawImage(out, 0, 0);
    g.restore();
  };
  const d = Math.max(1.5, h * 0.012);
  edge(-d, L.rim, (L.rimA ?? 0.55) * 0.9, Math.max(0.6, h * 0.004));
  edge(d * 0.8, L.key, 0.22, Math.max(0.6, h * 0.004));
  if (ghostly) {
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = linGrad(g, 0, 0, 0, H, [[0, 'rgba(0,0,0,0.9)'], [1, 'rgba(0,0,0,0.2)']]);
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}

// ------------------------------------------------------------------ public

/**
 * Paint one creature. light = {key, rim, rimA?}.
 * @returns {{canvas:HTMLCanvasElement, ox:number, oy:number}}
 */
export function paintCreature(id, h, light, seed = 1) {
  const sp = SPECIES[id] ?? SPECIES.orc;
  const W = Math.ceil(h * (sp.plan === 'dragon' ? 2.2 : sp.plan === 'quad' ? 2.8 : 1.5));
  const Hc = Math.ceil(h * (sp.plan === 'dragon' ? 1.3 : sp.plan === 'humanoid' || sp.plan === 'skeleton' ? 1.25 : 1.15));
  const c = makeCanvas(W, Hc);
  const g = c.getContext('2d');
  const ox = W / 2;
  const oy = Hc - Math.max(4, h * 0.04);
  g.translate(ox, oy);
  const R = rngOf(seed);
  const L = { key: light?.key ?? '#ffb070', rim: light?.rim ?? '#9ab0ff', rimA: light?.rimA ?? 0.55 };
  const plan = { humanoid, skeleton, wraith, quad, spider, frog, centipede, dragon }[sp.plan];
  EMIT = [];
  plan(g, sp, h, L, R);
  const emit = EMIT;
  EMIT = null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  lightFigure(c, h, L, sp.plan === 'wraith' && sp.ghostly);
  for (const e of emit) {
    g.setTransform(e.m);
    eyes(g, e.x, e.y, e.sep, e.r, e.color, { slit: e.slit });
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas: c, ox, oy };
}

/** Composite a creature into the scene with a contact shadow and depth haze. */
export function placeCreature(g, id, x, y, h, light, { haze = 0, hazeColor = '#202830', seed = 1, flip = false } = {}) {
  const { canvas, ox, oy } = paintCreature(id, h, light, seed);
  const sp = SPECIES[id] ?? SPECIES.orc;
  if (sp.plan !== 'wraith' && !sp.ghost) contactShadow(g, x, y, h * (sp.plan === 'quad' || sp.plan === 'spider' ? 0.55 : 0.28), h * 0.05, 0.6);
  if (sp.ghost) {
    const cg = canvas.getContext('2d');
    cg.save();
    cg.globalCompositeOperation = 'source-atop';
    cg.fillStyle = 'rgba(120,230,255,0.55)';
    cg.fillRect(0, 0, canvas.width, canvas.height);
    cg.globalCompositeOperation = 'destination-in';
    const fade = cg.createLinearGradient(0, 0, 0, canvas.height);
    fade.addColorStop(0, 'rgba(0,0,0,0.85)');
    fade.addColorStop(0.75, 'rgba(0,0,0,0.6)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = fade;
    cg.fillRect(0, 0, canvas.width, canvas.height);
    cg.restore();
    glow(g, x, y - h * 0.55, h * 0.6, '#8ff0ff', 0.35, 'screen');
    g.save();
    g.globalCompositeOperation = 'screen';
    g.drawImage(canvas, x - ox, y - oy);
    g.restore();
    return;
  }
  if (haze > 0) {
    const cg = canvas.getContext('2d');
    cg.save();
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.globalCompositeOperation = 'source-atop';
    cg.fillStyle = rgba(hazeColor, haze);
    cg.fillRect(0, 0, canvas.width, canvas.height);
    cg.restore();
  }
  g.save();
  if (flip) {
    g.translate(x, 0);
    g.scale(-1, 1);
    g.drawImage(canvas, -ox, y - oy);
  } else g.drawImage(canvas, x - ox, y - oy);
  g.restore();
}

export const CREATURE_IDS = Object.keys(SPECIES);
export { hexRgb };
