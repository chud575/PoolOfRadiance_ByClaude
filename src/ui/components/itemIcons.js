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
    // Blade: two bevels meeting on the spine (lit and shadowed), a fuller groove, a bright edge.
    poly(g, [[-4, -24], [0, -31], [0, 9], [-4, 9]]);
    g.fillStyle = steel(g, -4, -20, 0, -20, 1.05);
    g.fill();
    poly(g, [[0, -31], [4, -24], [4, 9], [0, 9]]);
    const dk = g.createLinearGradient(0, -30, 4, 10);
    dk.addColorStop(0, '#9aa0aa'); dk.addColorStop(0.5, '#5d636e'); dk.addColorStop(1, '#2c3038');
    g.fillStyle = dk;
    g.fill();
    poly(g, [[-4, -24], [0, -31], [4, -24], [4, 9], [-4, 9]]);
    outline(g, 1);
    poly(g, [[-0.9, -20], [0.9, -20], [0.9, 6], [-0.9, 6]]);
    g.fillStyle = 'rgba(30,34,42,0.55)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(-3.6, -23.5); g.lineTo(-0.2, -30.2); g.stroke();
    g.beginPath(); g.moveTo(-3.7, -23); g.lineTo(-3.7, 8.5); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(-1.6, -19); g.lineTo(-1.6, 5.5); g.stroke();
    // Crossguard with curled quillons.
    g.beginPath();
    g.moveTo(-12, 9); g.quadraticCurveTo(-14, 8, -14.5, 10.5); g.quadraticCurveTo(-13.5, 13.5, -10, 13); g.lineTo(10, 13);
    g.quadraticCurveTo(13.5, 13.5, 14.5, 10.5); g.quadraticCurveTo(14, 8, 12, 9); g.closePath();
    g.fillStyle = gold(g, -12, 9, 12, 14);
    g.fill();
    outline(g);
    g.beginPath(); g.arc(0, 11, 1.6, 0, Math.PI * 2);
    g.fillStyle = '#a3202a'; g.fill();
    // Leather-wrapped grip.
    poly(g, [[-2.4, 13], [2.4, 13], [2.2, 24], [-2.2, 24]]);
    g.fillStyle = leather(g, -2.4, 13, 2.4, 24);
    g.fill();
    outline(g);
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(20,10,4,0.75)';
    g.lineWidth = 0.7;
    for (let y = 13; y < 26; y += 2.2) { g.beginPath(); g.moveTo(-3, y); g.lineTo(3, y + 1.6); g.stroke(); }
    g.strokeStyle = 'rgba(230,180,120,0.35)';
    for (let y = 13.8; y < 26; y += 2.2) { g.beginPath(); g.moveTo(-3, y); g.lineTo(3, y + 1.6); g.stroke(); }
    g.restore();
    // Pommel.
    g.beginPath(); g.arc(0, 26.6, 3.6, 0, Math.PI * 2);
    g.fillStyle = gold(g, -3, 23, 3, 30);
    g.fill();
    outline(g);
    g.beginPath(); g.arc(-1, 25.6, 1.1, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,250,220,0.8)'; g.fill();
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
    // A self bow of yew: tapering limbs (sapwood belly, heartwood back), grain, horn nocks, leather grip.
    const limb = (sgn) => {
      g.beginPath();
      g.moveTo(3.6, 0);
      g.quadraticCurveTo(12, sgn * 12, -3.5, sgn * 28);
      g.lineTo(-4.8, sgn * 27.4);
      g.quadraticCurveTo(8.6, sgn * 12, 0.8, 0);
      g.closePath();
    };
    for (const sgn of [-1, 1]) {
      limb(sgn);
      const wg = g.createLinearGradient(0, 0, 10, sgn * 6);
      wg.addColorStop(0, '#e2b06a'); wg.addColorStop(0.45, '#a8642c'); wg.addColorStop(1, '#4e2a10');
      g.fillStyle = wg;
      g.fill();
      outline(g, 1);
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(60,28,8,0.55)';
      g.lineWidth = 0.45;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.moveTo(1.4 + k * 0.5, 0);
        g.quadraticCurveTo(9.5 + k * 0.5, sgn * 12, -4 + k * 0.25, sgn * 28);
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,230,180,0.5)';
      g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(3.2, 0); g.quadraticCurveTo(11.4, sgn * 12, -3.6, sgn * 27.8); g.stroke();
      g.restore();
      // Horn nock.
      g.beginPath(); g.ellipse(-4.2, sgn * 27.8, 1.6, 2.4, 0.3 * sgn, 0, Math.PI * 2);
      g.fillStyle = '#eadfc4'; g.fill();
      outline(g, 0.7);
    }
    // String.
    g.beginPath(); g.moveTo(-4.2, -27); g.lineTo(-4.2, 27);
    g.lineWidth = 0.8;
    g.strokeStyle = '#f2ead6';
    g.stroke();
    // Leather grip with a wrap.
    poly(g, [[0.4, -4.6], [4.6, -4.6], [4.6, 4.6], [0.4, 4.6]]);
    g.fillStyle = leather(g, 0, -5, 5, 5);
    g.fill();
    outline(g, 0.9);
    g.strokeStyle = 'rgba(20,10,4,0.7)';
    g.lineWidth = 0.6;
    for (let y = -3.6; y < 4.6; y += 1.8) { g.beginPath(); g.moveTo(0.4, y); g.lineTo(4.6, y + 0.9); g.stroke(); }
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
    const shape = () => {
      g.beginPath();
      g.moveTo(-20, -24); g.quadraticCurveTo(0, -27, 20, -24); g.lineTo(20, -4);
      g.quadraticCurveTo(18, 18, 0, 28); g.quadraticCurveTo(-18, 18, -20, -4);
      g.closePath();
    };
    // Painted planks under heraldry: azure, a chevron or, worn at the edges.
    shape();
    const sg = g.createLinearGradient(-20, -24, 20, 28);
    sg.addColorStop(0, '#4a6cc0'); sg.addColorStop(0.55, '#24387a'); sg.addColorStop(1, '#0e1636');
    g.fillStyle = sg;
    g.fill();
    g.save();
    shape();
    g.clip();
    g.strokeStyle = 'rgba(8,12,30,0.45)';
    g.lineWidth = 0.6;
    for (let x = -14; x < 20; x += 7) { g.beginPath(); g.moveTo(x, -26); g.lineTo(x + 0.6, 30); g.stroke(); }
    g.beginPath(); g.moveTo(-22, 12); g.lineTo(0, -6); g.lineTo(22, 12); g.lineTo(22, 20); g.lineTo(0, 2); g.lineTo(-22, 20); g.closePath();
    g.fillStyle = gold(g, -20, -6, 20, 20);
    g.fill();
    g.strokeStyle = 'rgba(40,24,6,0.6)';
    g.lineWidth = 0.6;
    g.stroke();
    // Wear: scuffs showing the wood.
    g.strokeStyle = 'rgba(190,150,100,0.45)';
    g.lineWidth = 0.7;
    for (const [x, y, dx, dy] of [[-12, -16, 5, 2], [8, -10, -4, 3], [-6, 18, 6, -1], [12, 6, 3, 4]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke(); }
    // Light from the upper left across the convex face.
    const lg = g.createRadialGradient(-10, -14, 2, -6, -8, 34);
    lg.addColorStop(0, 'rgba(255,255,255,0.28)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.04)'); lg.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = lg;
    g.fillRect(-24, -30, 48, 60);
    g.restore();
    // Iron rim with rivets.
    shape();
    g.lineWidth = 3.2;
    g.strokeStyle = steel(g, -20, -24, 20, 28, 0.9);
    g.stroke();
    outline(g, 0.9);
    const rivets = [[-17, -21], [0, -23.6], [17, -21], [18.6, -6], [-18.6, -6], [14, 12], [-14, 12], [6.5, 23.5], [-6.5, 23.5]];
    for (const [x, y] of rivets) {
      g.beginPath(); g.arc(x, y, 1.25, 0, Math.PI * 2);
      const rg = g.createRadialGradient(x - 0.5, y - 0.5, 0.1, x, y, 1.4);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#9aa0aa'); rg.addColorStop(1, '#2a2e36');
      g.fillStyle = rg;
      g.fill();
    }
    // Boss.
    g.beginPath(); g.arc(0, -1, 5.5, 0, Math.PI * 2);
    const bg = g.createRadialGradient(-2, -3, 0.5, 0, -1, 5.5);
    bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.4, '#c9a24c'); bg.addColorStop(1, '#5a3c10');
    g.fillStyle = bg;
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
    // Riveted brow band and a raised comb.
    for (const x of [-13, -6.5, 6.5, 13]) {
      const y = -3 + Math.abs(x) * 0.17 - 0.2;
      g.beginPath(); g.arc(x, y, 1.05, 0, Math.PI * 2);
      g.fillStyle = '#fff4cf'; g.fill();
    }
    g.beginPath(); g.moveTo(0, -21); g.lineTo(0, -4);
    g.lineWidth = 2.2;
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.stroke();
    g.lineWidth = 0.8;
    g.strokeStyle = 'rgba(20,22,28,0.6)';
    g.beginPath(); g.moveTo(1.4, -20.5); g.lineTo(1.4, -4); g.stroke();
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
    for (const dx of [-9, 7]) {
      const back = dx < 0;
      g.save();
      if (back) g.globalAlpha = 0.92;
      // Shaft and foot, with a toe that rounds over a stitched welt.
      g.beginPath();
      g.moveTo(dx - 6, -20); g.lineTo(dx + 5, -20); g.lineTo(dx + 5.5, 9);
      g.quadraticCurveTo(dx + 8, 12, dx + 13, 14); g.quadraticCurveTo(dx + 16, 15.5, dx + 15.5, 20.5);
      g.lineTo(dx - 7, 20.5); g.quadraticCurveTo(dx - 7.5, 4, dx - 6, -20);
      g.closePath();
      g.fillStyle = leather(g, dx - 7, -22, dx + 14, 24);
      g.fill();
      outline(g);
      // Sole and heel.
      poly(g, [[dx - 7.5, 20.5], [dx + 16, 20.5], [dx + 15.5, 24], [dx - 7.5, 24]]);
      g.fillStyle = '#1e140c';
      g.fill();
      poly(g, [[dx - 7.5, 22], [dx - 1, 22], [dx - 1, 25.5], [dx - 7.5, 25.5]]);
      g.fill();
      // Turned-down cuff.
      poly(g, [[dx - 7, -22], [dx + 6, -22], [dx + 6.5, -14], [dx - 7.5, -14]]);
      g.fillStyle = leather(g, dx - 7, -22, dx + 6, -14);
      g.fill();
      outline(g, 0.9);
      // Stitching and a highlight down the shin.
      g.setLineDash([1.2, 1.2]);
      g.strokeStyle = 'rgba(230,200,150,0.6)';
      g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(dx - 6.6, -15.2); g.lineTo(dx + 6, -15.2); g.stroke();
      g.beginPath(); g.moveTo(dx - 6, 19.2); g.lineTo(dx + 14.5, 19.2); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,220,170,0.35)';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(dx - 3.5, -12); g.lineTo(dx - 3, 14); g.stroke();
      g.restore();
    }
  },
  gauntlets(g) {
    // A steel gauntlet seen from the back: a flared cuff, overlapping plates over the back of the
    // hand, four articulated fingers and a thumb, a leather glove showing at the palm edge.
    g.translate(32, 33);
    g.rotate(-0.18);
    // leather glove beneath
    g.beginPath();
    g.moveTo(-11, 10); g.quadraticCurveTo(-15, -2, -12, -12); g.lineTo(11, -12); g.quadraticCurveTo(14, 0, 10, 10); g.closePath();
    g.fillStyle = leather(g, -12, -12, 12, 10);
    g.fill();
    outline(g);
    // fingers: three lames each, tapering, slightly spread
    for (let i = 0; i < 4; i++) {
      const fx = -8.4 + i * 5.4, len = i === 0 ? 13 : i === 3 ? 12 : 15;
      const tilt = (i - 1.5) * 0.08;
      g.save();
      g.translate(fx, -12);
      g.rotate(tilt);
      for (let k = 0; k < 3; k++) {
        const y0 = -k * (len / 3), w = 4.6 - k * 0.5;
        g.beginPath();
        g.moveTo(-w / 2, y0); g.lineTo(-w / 2 + 0.3, y0 - len / 3 - 0.8); g.quadraticCurveTo(0, y0 - len / 3 - 2.2, w / 2 - 0.3, y0 - len / 3 - 0.8); g.lineTo(w / 2, y0); g.closePath();
        g.fillStyle = steel(g, -w / 2, y0, w / 2, y0 - len / 3, 0.95 - k * 0.05);
        g.fill();
        outline(g, 0.9);
      }
      g.restore();
    }
    // thumb, angled off the side
    g.save();
    g.translate(-12, -4);
    g.rotate(-0.85);
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      g.moveTo(-2.6, -k * 6); g.lineTo(-2.3, -k * 6 - 6.8); g.quadraticCurveTo(0, -k * 6 - 8.4, 2.3, -k * 6 - 6.8); g.lineTo(2.6, -k * 6); g.closePath();
      g.fillStyle = steel(g, -2.6, 0, 2.6, -12, 0.9);
      g.fill();
      outline(g, 0.9);
    }
    g.restore();
    // plates over the back of the hand
    for (let k = 0; k < 3; k++) {
      const y = -12 + k * 6.2;
      g.beginPath();
      g.moveTo(-12.5 + k * 0.4, y + 6.5); g.quadraticCurveTo(0, y + 3.2, 12 - k * 0.4, y + 6.5); g.lineTo(11.5, y); g.quadraticCurveTo(0, y - 3, -12, y); g.closePath();
      g.fillStyle = steel(g, -12, y - 3, 12, y + 6, 1.02 - k * 0.04);
      g.fill();
      outline(g, 1);
    }
    // the flared cuff with a brass edge
    g.beginPath();
    g.moveTo(-12, 8.5); g.lineTo(-16, 26); g.quadraticCurveTo(0, 30, 16, 26); g.lineTo(12, 8.5); g.quadraticCurveTo(0, 6, -12, 8.5); g.closePath();
    g.fillStyle = steel(g, -16, 8, 16, 28, 0.92);
    g.fill();
    outline(g);
    g.beginPath();
    g.moveTo(-16, 26); g.quadraticCurveTo(0, 30, 16, 26);
    g.strokeStyle = gold(g, -16, 26, 16, 30);
    g.lineWidth = 2.2;
    g.stroke();
    for (const rx of [-9, 0, 9]) {
      g.beginPath(); g.arc(rx, 12.5 + Math.abs(rx) * 0.05, 1.1, 0, Math.PI * 2);
      g.fillStyle = gold(g, rx - 1, 11, rx + 1, 14); g.fill();
    }
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
/**
 * The painter's finish over a drawn icon (premultiplied canvas, object only): the silhouette is
 * read as a height field, so every form takes a bevelled light from the upper left and a shadowed
 * lower-right edge; bright, unsaturated pixels (steel, silver) catch a specular glint; a fine
 * pigment grain breaks the vector flatness.
 */
function finishIcon(c) {
  const w = c.width, h = c.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, w, h);
  const D = img.data;
  const A = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) A[i] = D[i * 4 + 3] / 255;
  // Height: alpha blurred twice (a rounded bevel ~3 px wide at 128 px).
  const blur = (src, r) => {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
      tmp[y * w + x] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
      out[y * w + x] = s / n;
    }
    return out;
  };
  const H = blur(blur(A, 2), 2);
  const L = [-0.55, -0.65, 0.52];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const a = A[i];
    if (a < 0.02) continue;
    const gx = (H[i + 1] - H[i - 1]) * 3.2, gy = (H[i + w] - H[i - w]) * 3.2;
    const nl = Math.hypot(gx, gy, 1);
    const nx = -gx / nl, ny = -gy / nl, nz = 1 / nl;
    const ndl = nx * L[0] + ny * L[1] + nz * L[2];
    const j = i * 4;
    let r = D[j], gg = D[j + 1], b = D[j + 2];
    const lum = (0.3 * r + 0.59 * gg + 0.11 * b) / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const shade = 0.78 + 0.42 * Math.max(-0.4, ndl - 0.52 * 0.0) ;
    r *= shade; gg *= shade; b *= shade;
    // Painted light: the lit side warmer, the shadow side cooler (a painter's temperature shift)
    const warmK = Math.max(-1, Math.min(1, (ndl - 0.45) * 2.2));
    r *= 1 + 0.06 * warmK; b *= 1 - 0.07 * warmK;
    // a cool reflected rim along the lower-right edges, catching the light of the panel
    const rim = Math.max(0, -ndl - 0.05) * (1 - nz) * 3;
    r += 22 * rim; gg += 30 * rim; b += 46 * rim;
    // bristle strokes laid diagonally across the object (value breaks, not a flat fill)
    const along = (x + y) * 0.7071, across = (x - y) * 0.7071;
    const hb = Math.sin(Math.floor(across / 2.2) * 91.7 + Math.floor(along / 9) * 13.1) * 43758.5453;
    const stroke = ((hb - Math.floor(hb)) - 0.5) * 16 * a;
    const hb2 = Math.sin(across * 1.9 + Math.sin(along * 0.21) * 2.0) * 3.0;
    r += stroke + hb2; gg += stroke * 0.95 + hb2; b += stroke * 0.85 + hb2 * 0.9;
    // Specular glint on metal-like pixels along the lit bevel.
    const metal = Math.max(0, 1 - sat * 2.2) * Math.min(1, lum * 1.6);
    const spec = Math.pow(Math.max(0, ndl), 6) * 120 * metal * (1 - nz) * 2.2;
    r += spec; gg += spec; b += spec * 0.95;
    // Pigment grain (deterministic).
    const hsh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const grain = (hsh - Math.floor(hsh) - 0.5) * 9 * a;
    D[j] = Math.max(0, Math.min(255, r + grain));
    D[j + 1] = Math.max(0, Math.min(255, gg + grain));
    D[j + 2] = Math.max(0, Math.min(255, b + grain));
  }
  g.putImageData(img, 0, 0);
}

export function itemIconURL(icon, o = {}) {
  const id = DRAW[icon] ? icon : 'bag';
  const key = `${id}|${o.magic ? 1 : 0}|${o.ghost ? 1 : 0}`;
  let u = cache.get(key);
  if (u) return u;
  const R = 2; // drawn at 128 px: crisp in the big detail medallion as well as in the tiles
  const c = document.createElement('canvas');
  c.width = S * R;
  c.height = S * R;
  const g = c.getContext('2d');
  if (o.magic) {
    const rg = g.createRadialGradient(32 * R, 32 * R, 4 * R, 32 * R, 32 * R, 32 * R);
    rg.addColorStop(0, 'rgba(120,190,255,0.45)');
    rg.addColorStop(1, 'rgba(120,190,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S * R, S * R);
  }
  // The object alone first (finished), then laid on the icon with its drop shadow.
  const obj = document.createElement('canvas');
  obj.width = S * R;
  obj.height = S * R;
  const og = obj.getContext('2d');
  og.scale(R, R);
  DRAW[id](og);
  if (!o.ghost) {
    try { finishIcon(obj); } catch { /* plain vector icon */ }
  }
  g.save();
  if (o.ghost) {
    // Empty-slot ghost: a faint gilt engraving rather than a grey smudge.
    g.globalAlpha = 0.46;
    g.filter = 'grayscale(1) sepia(1) saturate(1.8) brightness(1.9)';
  } else {
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 4 * R;
    g.shadowOffsetX = 1.5 * R;
    g.shadowOffsetY = 2.5 * R;
  }
  g.drawImage(obj, 0, 0);
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
