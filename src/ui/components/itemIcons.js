/**
 * Procedural painted item icons (64×64 canvas → cached data URL) for the
 * inventory, paperdoll and shops. Icons are drawn with metallic / wood /
 * leather gradients, a warm key light from the upper left and a soft drop
 * shadow, so they sit on any panel. Magic items get a faint aura.
 *
 *   itemIconURL('sword', {magic: true}) → 'data:image/png;base64,...'
 */

const S = 64;
const cache = new Map();

function steel(g, x0, y0, x1, y1, tone = 1) {
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, `rgba(${70 * tone},${74 * tone},${84 * tone},1)`);
  m.addColorStop(0.35, '#f4f1ea');
  m.addColorStop(0.5, '#a9aeb8');
  m.addColorStop(1, '#3a3e48');
  return m;
}
function gold(g, x0, y0, x1, y1) {
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, '#fff0b8');
  m.addColorStop(0.4, '#d8b25a');
  m.addColorStop(0.7, '#8a6424');
  m.addColorStop(1, '#e6c877');
  return m;
}
function wood(g, x0, y0, x1, y1) {
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, '#a8743e');
  m.addColorStop(0.5, '#6e4520');
  m.addColorStop(1, '#3a220e');
  return m;
}
function leather(g, x0, y0, x1, y1) {
  const m = g.createLinearGradient(x0, y0, x1, y1);
  m.addColorStop(0, '#9a6a3a');
  m.addColorStop(0.6, '#5e3a1c');
  m.addColorStop(1, '#2e1c0c');
  return m;
}
function outline(g, w = 1.2) {
  g.strokeStyle = 'rgba(10,6,2,0.85)';
  g.lineWidth = w;
  g.stroke();
}
function poly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

const DRAW = {
  sword(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    poly(g, [[-3, -26], [0, -30], [3, -26], [3, 10], [-3, 10]]);
    g.fillStyle = steel(g, -3, 0, 3, 0);
    g.fill();
    outline(g);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(0, -27); g.lineTo(0, 8); g.stroke();
    poly(g, [[-11, 10], [11, 10], [11, 14], [-11, 14]]);
    g.fillStyle = gold(g, -11, 10, 11, 14);
    g.fill();
    outline(g);
    poly(g, [[-2.2, 14], [2.2, 14], [2.2, 24], [-2.2, 24]]);
    g.fillStyle = leather(g, -2, 14, 2, 24);
    g.fill();
    outline(g);
    g.beginPath(); g.arc(0, 26.5, 3.4, 0, Math.PI * 2);
    g.fillStyle = gold(g, -3, 23, 3, 30);
    g.fill();
    outline(g);
  },
  dagger(g) {
    g.translate(32, 34);
    g.rotate(-Math.PI / 4);
    poly(g, [[-3.5, -18], [0, -24], [3.5, -18], [3, 6], [-3, 6]]);
    g.fillStyle = steel(g, -3, 0, 3, 0);
    g.fill();
    outline(g);
    poly(g, [[-8, 6], [8, 6], [7, 9.5], [-7, 9.5]]);
    g.fillStyle = gold(g, -8, 6, 8, 10);
    g.fill();
    outline(g);
    poly(g, [[-2, 9.5], [2, 9.5], [2.4, 19], [-2.4, 19]]);
    g.fillStyle = leather(g, -2, 10, 2, 19);
    g.fill();
    outline(g);
  },
  axe(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 5);
    poly(g, [[-2, -26], [2, -26], [2.5, 28], [-2.5, 28]]);
    g.fillStyle = wood(g, -2, 0, 2, 0);
    g.fill();
    outline(g);
    g.beginPath();
    g.moveTo(2, -22);
    g.quadraticCurveTo(22, -26, 20, -4);
    g.quadraticCurveTo(14, -8, 2, -8);
    g.closePath();
    g.fillStyle = steel(g, 2, -24, 20, -4);
    g.fill();
    outline(g);
  },
  mace(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    poly(g, [[-2, -8], [2, -8], [2.4, 28], [-2.4, 28]]);
    g.fillStyle = wood(g, -2, 0, 2, 0);
    g.fill();
    outline(g);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      poly(g, [[Math.cos(a) * 7, -16 + Math.sin(a) * 7], [Math.cos(a + 0.3) * 13, -16 + Math.sin(a + 0.3) * 13], [Math.cos(a + 0.6) * 7, -16 + Math.sin(a + 0.6) * 7]]);
      g.fillStyle = steel(g, -12, -28, 12, -4, 0.9);
      g.fill();
      outline(g, 0.8);
    }
    g.beginPath(); g.arc(0, -16, 8, 0, Math.PI * 2);
    const rg = g.createRadialGradient(-3, -19, 1, 0, -16, 8);
    rg.addColorStop(0, '#f4f1ea'); rg.addColorStop(0.5, '#8a909a'); rg.addColorStop(1, '#2a2d33');
    g.fillStyle = rg;
    g.fill();
    outline(g);
  },
  staff(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    poly(g, [[-2.2, -28], [2.2, -28], [2.6, 28], [-2.6, 28]]);
    g.fillStyle = wood(g, -2, 0, 2, 0);
    g.fill();
    outline(g);
    for (const y of [-14, 10]) {
      poly(g, [[-3.2, y], [3.2, y], [3.2, y + 3], [-3.2, y + 3]]);
      g.fillStyle = gold(g, -3, y, 3, y + 3);
      g.fill();
    }
    g.beginPath(); g.arc(0, -28, 4, 0, Math.PI * 2);
    g.fillStyle = '#7fd0ff';
    g.fill();
    outline(g);
  },
  spear(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    poly(g, [[-1.6, -16], [1.6, -16], [2, 29], [-2, 29]]);
    g.fillStyle = wood(g, -2, 0, 2, 0);
    g.fill();
    outline(g);
    poly(g, [[0, -30], [5, -18], [0, -14], [-5, -18]]);
    g.fillStyle = steel(g, -5, -24, 5, -24);
    g.fill();
    outline(g);
  },
  bow(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    g.beginPath();
    g.moveTo(-4, -27);
    g.quadraticCurveTo(18, 0, -4, 27);
    g.lineWidth = 5;
    g.strokeStyle = '#2a1a0a';
    g.stroke();
    g.lineWidth = 3.4;
    g.strokeStyle = wood(g, -4, -27, 14, 27);
    g.stroke();
    g.beginPath(); g.moveTo(-4, -27); g.lineTo(-4, 27);
    g.lineWidth = 0.9;
    g.strokeStyle = '#e8e0cc';
    g.stroke();
    poly(g, [[5, -4], [9, -4], [9, 4], [5, 4]]);
    g.fillStyle = leather(g, 5, -4, 9, 4);
    g.fill();
  },
  sling(g) {
    g.translate(32, 32);
    g.strokeStyle = '#6e4520';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-20, -20); g.quadraticCurveTo(-8, 6, 0, 10); g.quadraticCurveTo(8, 6, 20, -20); g.stroke();
    g.beginPath(); g.ellipse(0, 10, 8, 5, 0, 0, Math.PI * 2);
    g.fillStyle = leather(g, -8, 5, 8, 15);
    g.fill();
    outline(g);
    g.beginPath(); g.arc(0, 8, 3.5, 0, Math.PI * 2);
    g.fillStyle = '#9a9a92';
    g.fill();
  },
  arrow(g) {
    g.translate(32, 32);
    for (const dx of [-5, 0, 5]) {
      g.save();
      g.translate(dx, 0);
      g.rotate(-Math.PI / 4 + dx * 0.02);
      poly(g, [[-1, -20], [1, -20], [1, 22], [-1, 22]]);
      g.fillStyle = wood(g, -1, 0, 1, 0);
      g.fill();
      poly(g, [[0, -28], [3.5, -20], [-3.5, -20]]);
      g.fillStyle = steel(g, -3, -24, 3, -24);
      g.fill();
      outline(g, 0.8);
      poly(g, [[-1, 14], [-5, 24], [-1, 22]]);
      g.fillStyle = '#d8d0c0';
      g.fill();
      poly(g, [[1, 14], [5, 24], [1, 22]]);
      g.fill();
      g.restore();
    }
  },
  armor(g) {
    g.translate(32, 32);
    g.beginPath();
    g.moveTo(-10, -24); g.quadraticCurveTo(0, -18, 10, -24);
    g.lineTo(22, -18); g.lineTo(24, -4); g.lineTo(16, -2);
    g.lineTo(15, 24); g.quadraticCurveTo(0, 28, -15, 24);
    g.lineTo(-16, -2); g.lineTo(-24, -4); g.lineTo(-22, -18);
    g.closePath();
    g.fillStyle = steel(g, -24, -24, 24, 24);
    g.fill();
    outline(g);
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(20,20,26,0.4)';
    g.lineWidth = 0.9;
    for (let y = -20; y < 28; y += 3.2) {
      for (let x = -24 + ((y / 3.2) % 2) * 2; x < 24; x += 4) {
        g.beginPath(); g.arc(x, y, 1.6, Math.PI, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
    g.beginPath(); g.moveTo(0, -18); g.lineTo(0, 25);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.stroke();
  },
  shield(g) {
    g.translate(32, 32);
    g.beginPath();
    g.moveTo(-20, -24); g.lineTo(20, -24); g.lineTo(20, -4);
    g.quadraticCurveTo(18, 18, 0, 28); g.quadraticCurveTo(-18, 18, -20, -4);
    g.closePath();
    const sg = g.createLinearGradient(-20, -24, 20, 28);
    sg.addColorStop(0, '#3a5aa8'); sg.addColorStop(1, '#101a40');
    g.fillStyle = sg;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = gold(g, -20, -24, 20, 28);
    g.stroke();
    outline(g, 1);
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2);
    g.fillStyle = gold(g, -6, -6, 6, 6);
    g.fill();
    outline(g, 0.8);
  },
  helm(g) {
    g.translate(32, 34);
    g.beginPath();
    g.moveTo(-18, 6); g.bezierCurveTo(-20, -28, 20, -28, 18, 6);
    g.lineTo(18, 16); g.lineTo(6, 16); g.lineTo(4, 2); g.lineTo(-4, 2); g.lineTo(-6, 16); g.lineTo(-18, 16);
    g.closePath();
    g.fillStyle = steel(g, -18, -20, 18, 16);
    g.fill();
    outline(g);
    g.beginPath(); g.moveTo(-17, 0); g.quadraticCurveTo(0, -6, 17, 0);
    g.lineWidth = 3;
    g.strokeStyle = gold(g, -17, -4, 17, 0);
    g.stroke();
  },
  ring(g) {
    g.translate(32, 34);
    g.beginPath(); g.ellipse(0, 4, 15, 12, 0, 0, Math.PI * 2);
    g.lineWidth = 5;
    g.strokeStyle = '#3a2a0a';
    g.stroke();
    g.lineWidth = 3.6;
    g.strokeStyle = gold(g, -15, -8, 15, 16);
    g.stroke();
    g.beginPath(); g.moveTo(0, -16); g.lineTo(7, -9); g.lineTo(0, -2); g.lineTo(-7, -9); g.closePath();
    const rg = g.createLinearGradient(-7, -16, 7, -2);
    rg.addColorStop(0, '#ffd0e8'); rg.addColorStop(0.5, '#d0306a'); rg.addColorStop(1, '#500a20');
    g.fillStyle = rg;
    g.fill();
    outline(g, 0.8);
  },
  potion(g) {
    g.translate(32, 34);
    g.beginPath();
    g.moveTo(-4, -22); g.lineTo(4, -22); g.lineTo(4, -12);
    g.bezierCurveTo(18, -6, 18, 24, 0, 24); g.bezierCurveTo(-18, 24, -18, -6, -4, -12);
    g.closePath();
    g.fillStyle = 'rgba(210,230,240,0.25)';
    g.fill();
    g.save();
    g.clip();
    const lg = g.createLinearGradient(0, -4, 0, 24);
    lg.addColorStop(0, '#ff6a5a'); lg.addColorStop(1, '#8a0a18');
    g.fillStyle = lg;
    g.fillRect(-20, -2, 40, 30);
    g.restore();
    outline(g);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath(); g.ellipse(-6, 4, 2.5, 6, 0.3, 0, Math.PI * 2); g.fill();
    poly(g, [[-5, -27], [5, -27], [4, -21], [-4, -21]]);
    g.fillStyle = wood(g, -5, -27, 5, -21);
    g.fill();
  },
  scroll(g) {
    g.translate(32, 32);
    g.rotate(-0.35);
    poly(g, [[-18, -14], [18, -14], [18, 14], [-18, 14]]);
    const pg = g.createLinearGradient(0, -14, 0, 14);
    pg.addColorStop(0, '#f6ead0'); pg.addColorStop(1, '#c8b48a');
    g.fillStyle = pg;
    g.fill();
    outline(g, 0.8);
    g.strokeStyle = 'rgba(90,40,20,0.7)';
    g.lineWidth = 0.9;
    for (let y = -8; y <= 8; y += 4) { g.beginPath(); g.moveTo(-12, y); g.lineTo(12 - (y === 8 ? 8 : 0), y); g.stroke(); }
    for (const x of [-20, 20]) {
      g.beginPath(); g.ellipse(x, 0, 4, 16, 0, 0, Math.PI * 2);
      g.fillStyle = pg;
      g.fill();
      outline(g, 0.8);
    }
    g.beginPath(); g.arc(4, 12, 4, 0, Math.PI * 2);
    g.fillStyle = '#a01818';
    g.fill();
  },
  wand(g) {
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    poly(g, [[-1.8, -24], [1.8, -24], [2.4, 26], [-2.4, 26]]);
    const wg = g.createLinearGradient(-2, 0, 2, 0);
    wg.addColorStop(0, '#2a2a40'); wg.addColorStop(0.5, '#6a6aa0'); wg.addColorStop(1, '#1a1a2a');
    g.fillStyle = wg;
    g.fill();
    outline(g);
    const rg = g.createRadialGradient(0, -26, 0, 0, -26, 9);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(150,200,255,0.9)'); rg.addColorStop(1, 'rgba(90,120,255,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(0, -26, 9, 0, Math.PI * 2); g.fill();
  },
  symbol(g) {
    g.translate(32, 32);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      poly(g, [[Math.cos(a - 0.12) * 10, Math.sin(a - 0.12) * 10], [Math.cos(a) * (i % 2 ? 18 : 24), Math.sin(a) * (i % 2 ? 18 : 24)], [Math.cos(a + 0.12) * 10, Math.sin(a + 0.12) * 10]]);
      g.fillStyle = gold(g, -24, -24, 24, 24);
      g.fill();
    }
    g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2);
    g.fillStyle = gold(g, -11, -11, 11, 11);
    g.fill();
    outline(g);
    g.strokeStyle = '#3a2a08';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(0, 7); g.moveTo(-7, -4); g.lineTo(7, -4); g.stroke();
  },
  gem(g) {
    g.translate(32, 32);
    poly(g, [[-14, -6], [-7, -16], [7, -16], [14, -6], [0, 18]]);
    const gg = g.createLinearGradient(-14, -16, 14, 18);
    gg.addColorStop(0, '#c8f0ff'); gg.addColorStop(0.4, '#3aa0e0'); gg.addColorStop(1, '#0a2a60');
    g.fillStyle = gg;
    g.fill();
    outline(g);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-14, -6); g.lineTo(14, -6); g.moveTo(-7, -16); g.lineTo(-4, -6); g.lineTo(0, 18); g.moveTo(7, -16); g.lineTo(4, -6); g.stroke();
  },
  cloak(g) {
    g.translate(32, 32);
    g.beginPath();
    g.moveTo(-8, -24); g.lineTo(8, -24); g.quadraticCurveTo(20, 0, 22, 26); g.lineTo(-22, 26); g.quadraticCurveTo(-20, 0, -8, -24);
    const cg = g.createLinearGradient(-22, 0, 22, 0);
    cg.addColorStop(0, '#a02a24'); cg.addColorStop(1, '#3a0a08');
    g.fillStyle = cg;
    g.fill();
    outline(g);
    g.beginPath(); g.arc(0, -22, 4, 0, Math.PI * 2);
    g.fillStyle = gold(g, -4, -26, 4, -18);
    g.fill();
  },
  boots(g) {
    g.translate(32, 32);
    for (const dx of [-8, 8]) {
      g.beginPath();
      g.moveTo(dx - 6, -22); g.lineTo(dx + 5, -22); g.lineTo(dx + 5, 12); g.lineTo(dx + 14, 18); g.lineTo(dx + 14, 24); g.lineTo(dx - 7, 24);
      g.closePath();
      g.fillStyle = leather(g, dx - 7, -22, dx + 14, 24);
      g.fill();
      outline(g);
    }
  },
  gauntlets(g) {
    g.translate(32, 32);
    g.beginPath();
    g.moveTo(-10, 24); g.lineTo(-12, 0); g.lineTo(-14, -14); g.lineTo(-6, -24); g.lineTo(10, -22); g.lineTo(14, -6); g.lineTo(10, 24);
    g.closePath();
    g.fillStyle = steel(g, -14, -24, 14, 24);
    g.fill();
    outline(g);
  },
  amulet(g) {
    g.translate(32, 30);
    g.beginPath(); g.arc(0, -8, 16, Math.PI * 0.15, Math.PI * 0.85, true);
    g.strokeStyle = gold(g, -16, -24, 16, 0);
    g.lineWidth = 1.8;
    g.stroke();
    g.beginPath(); g.arc(0, 14, 9, 0, Math.PI * 2);
    g.fillStyle = gold(g, -9, 5, 9, 23);
    g.fill();
    outline(g);
    g.beginPath(); g.arc(0, 14, 5, 0, Math.PI * 2);
    g.fillStyle = '#2aa070';
    g.fill();
  },
  bag(g) {
    g.translate(32, 34);
    g.beginPath();
    g.moveTo(-6, -18); g.lineTo(6, -18); g.lineTo(4, -12); g.bezierCurveTo(22, -6, 22, 22, 0, 22); g.bezierCurveTo(-22, 22, -22, -6, -4, -12);
    g.closePath();
    g.fillStyle = leather(g, -20, -18, 20, 22);
    g.fill();
    outline(g);
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-6, -12); g.lineTo(6, -12); g.stroke();
  },
  coins(g) {
    g.translate(32, 34);
    for (const [x, y] of [[-8, 8], [8, 8], [0, 0], [-4, -8], [6, -6]]) {
      g.beginPath(); g.ellipse(x, y, 10, 5, 0, 0, Math.PI * 2);
      g.fillStyle = gold(g, x - 10, y - 5, x + 10, y + 5);
      g.fill();
      outline(g, 0.8);
    }
  },
};
DRAW.bracers = DRAW.gauntlets;
DRAW.girdle = DRAW.bag;

/**
 * Icon data URL for an icon id (item.icon, item.type or slot name).
 * @param {string} icon
 * @param {{magic?: boolean, ghost?: boolean}} [o]  ghost = faint outline for empty paperdoll slots
 */
export function itemIconURL(icon, o = {}) {
  const id = DRAW[icon] ? icon : 'bag';
  const key = `${id}|${o.magic ? 1 : 0}|${o.ghost ? 1 : 0}`;
  let u = cache.get(key);
  if (u) return u;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (o.magic) {
    const rg = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    rg.addColorStop(0, 'rgba(120,190,255,0.45)');
    rg.addColorStop(1, 'rgba(120,190,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
  }
  g.save();
  if (o.ghost) {
    // Empty-slot ghost: a faint gilt engraving rather than a grey smudge.
    g.globalAlpha = 0.3;
    g.filter = 'grayscale(1) sepia(1) saturate(1.6) brightness(1.7)';
  } else {
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 4;
    g.shadowOffsetX = 1.5;
    g.shadowOffsetY = 2.5;
  }
  DRAW[id](g);
  g.restore();
  u = c.toDataURL('image/png');
  cache.set(key, u);
  return u;
}

/** Icon id for an item def. */
export function iconFor(def) {
  if (!def) return 'bag';
  if (def.icon) return def.icon;
  return { weapon: 'sword', armor: 'armor', shield: 'shield', helm: 'helm', ring: 'ring', potion: 'potion', scroll: 'scroll', wand: 'wand', ammo: 'arrow', cloak: 'cloak', boots: 'boots', gauntlets: 'gauntlets', bracers: 'bracers', amulet: 'amulet', girdle: 'girdle', treasure: 'gem' }[def.type] ?? 'bag';
}
