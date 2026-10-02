import * as THREE from 'three';
import { prng } from './geom.js';

/**
 * Canvas-painted textures for the council chamber: the arms of New Phlan
 * (a silver tower over the Moonsea's waves on gules, a bordure or), the
 * city banner with the same device, the clerk's ledger (ruled pages in a
 * brown iron-gall hand), petitions/city plan sheets and a quill feather.
 * All procedural; deterministic (seeded).
 */
const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
};
const tex = (c, { srgb = true, aniso = 4 } = {}) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};

/** The device: a three-towered castle in argent over barry-wavy azure and argent. */
function device(x, cx, cy, s, { metal = '#e8e2d2', line = '#1a0e08' } = {}) {
  x.save();
  x.translate(cx, cy);
  x.scale(s, s);
  // waves
  for (let k = 0; k < 3; k++) {
    x.beginPath();
    const y = 46 + k * 16;
    x.moveTo(-70, y);
    for (let i = 0; i <= 14; i++) x.quadraticCurveTo(-70 + i * 10 - 5, y + (i % 2 ? 7 : -7), -70 + i * 10, y);
    x.lineTo(70, y + 9);
    for (let i = 14; i >= 0; i--) x.quadraticCurveTo(-70 + i * 10 + 5, y + 9 + (i % 2 ? 7 : -7), -70 + i * 10, y + 9);
    x.closePath();
    x.fillStyle = k % 2 ? metal : '#2a4aa8';
    x.fill();
    x.lineWidth = 1.6;
    x.strokeStyle = line;
    x.stroke();
  }
  // castle: curtain with gate and three crenellated towers
  x.beginPath();
  x.moveTo(-48, 44); x.lineTo(-48, -6); x.lineTo(-34, -6); x.lineTo(-34, -36);
  for (let i = 0; i < 3; i++) { x.lineTo(-34 + i * 6, -44); x.lineTo(-31 + i * 6, -44); x.lineTo(-31 + i * 6, -36); x.lineTo(-28 + i * 6, -36); }
  x.lineTo(-16, -36); x.lineTo(-16, -6); x.lineTo(-12, -6); x.lineTo(-12, -52);
  for (let i = 0; i < 4; i++) { x.lineTo(-12 + i * 6, -60); x.lineTo(-9 + i * 6, -60); x.lineTo(-9 + i * 6, -52); x.lineTo(-6 + i * 6, -52); }
  x.lineTo(12, -52); x.lineTo(12, -6); x.lineTo(16, -6); x.lineTo(16, -36);
  for (let i = 0; i < 3; i++) { x.lineTo(16 + i * 6, -44); x.lineTo(19 + i * 6, -44); x.lineTo(19 + i * 6, -36); x.lineTo(22 + i * 6, -36); }
  x.lineTo(34, -36); x.lineTo(34, -6); x.lineTo(48, -6); x.lineTo(48, 44); x.closePath();
  x.fillStyle = metal;
  x.fill();
  x.lineWidth = 2.2;
  x.strokeStyle = line;
  x.stroke();
  // masonry, gate, windows
  x.lineWidth = 0.8;
  for (let y = 0; y < 44; y += 8) { x.beginPath(); x.moveTo(-48, y); x.lineTo(48, y); x.stroke(); }
  x.fillStyle = line;
  x.beginPath(); x.moveTo(-9, 44); x.lineTo(-9, 22); x.arc(0, 22, 9, Math.PI, 0); x.lineTo(9, 44); x.fill();
  for (const [wx, wy] of [[-25, -22], [25, -22], [0, -36]]) { x.fillRect(wx - 2.5, wy - 6, 5, 12); }
  x.restore();
}

function heaterPath(x, w, h) {
  x.beginPath();
  x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h * 0.4);
  x.quadraticCurveTo(w * 0.95, h * 0.82, w / 2, h);
  x.quadraticCurveTo(w * 0.05, h * 0.82, 0, h * 0.4);
  x.closePath();
}

/** Shield face, UV (0..1) over the heater shape's bounding box. */
export function armsTexture() {
  const [c, x] = canvas(512, 640);
  const R = prng(7);
  // gules field with a damask diaper
  heaterPath(x, 512, 640);
  x.fillStyle = '#9a1c16';
  x.fill();
  x.save();
  x.clip();
  x.globalAlpha = 0.12;
  x.strokeStyle = '#ffb090';
  for (let i = -10; i < 30; i++) { x.beginPath(); x.moveTo(i * 40, 0); x.lineTo(i * 40 - 640, 640); x.stroke(); x.beginPath(); x.moveTo(i * 40, 0); x.lineTo(i * 40 + 640, 640); x.stroke(); }
  x.globalAlpha = 1;
  // bordure or
  x.lineWidth = 46;
  x.strokeStyle = '#d4a640';
  heaterPath(x, 512, 640);
  x.stroke();
  x.lineWidth = 3;
  x.strokeStyle = '#4a2a08';
  x.save(); x.translate(23, 23); x.scale((512 - 46) / 512, (640 - 46) / 640); heaterPath(x, 512, 640); x.restore(); x.stroke();
  // bezants on the bordure
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const px = t < 0.35 ? 23 + (t / 0.35) * 466 : 0, py = 23;
    if (t < 0.35) { x.fillStyle = '#f2d27a'; x.beginPath(); x.arc(px, py, 8, 0, 6.28); x.fill(); }
  }
  device(x, 256, 300, 2.6);
  // varnish sheen + wear
  const g = x.createLinearGradient(0, 0, 512, 640);
  g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 640);
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${R.range(0.02, 0.08)})`; x.fillRect(R.range(0, 512), R.range(0, 640), R.range(1, 4), R.range(1, 3)); }
  x.restore();
  return tex(c);
}

/** Banner: gules with the device in a gilt roundel, gold border; UV 0..1 over the cloth. */
export function bannerTexture() {
  const [c, x] = canvas(256, 800);
  const R = prng(9);
  x.fillStyle = '#8a1812';
  x.fillRect(0, 0, 256, 800);
  // weave
  for (let y = 0; y < 800; y += 2) { x.fillStyle = `rgba(0,0,0,${0.04 + 0.03 * Math.sin(y * 0.7)})`; x.fillRect(0, y, 256, 1); }
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(255,200,180,${R.range(0, 0.04)})`; x.fillRect(R.range(0, 256), R.range(0, 800), 1, R.range(2, 6)); }
  // gold border + inner rule
  x.strokeStyle = '#d4a640'; x.lineWidth = 14; x.strokeRect(10, 10, 236, 780);
  x.strokeStyle = '#5a1a08'; x.lineWidth = 2; x.strokeRect(22, 22, 212, 756);
  // roundel with device
  x.fillStyle = '#d4a640'; x.beginPath(); x.arc(128, 300, 92, 0, 6.28); x.fill();
  x.fillStyle = '#7a140e'; x.beginPath(); x.arc(128, 300, 80, 0, 6.28); x.fill();
  device(x, 128, 296, 0.95, { metal: '#f0d890' });
  // motto ribbon
  x.fillStyle = '#e8d8b0'; x.fillRect(40, 440, 176, 34);
  x.fillStyle = '#5a1a08'; x.font = 'bold 20px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('PHLAN', 128, 458);
  // fleurs down the hoist
  x.fillStyle = '#d4a640';
  for (let y = 540; y < 720; y += 60) { x.beginPath(); x.moveTo(128, y - 16); x.lineTo(140, y); x.lineTo(128, y + 16); x.lineTo(116, y); x.closePath(); x.fill(); }
  // fold shading
  const g = x.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, `rgba(0,0,0,${i % 2 ? 0.22 : 0})`);
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 800);
  return tex(c);
}

/** Open ledger: two ruled pages written in a brown hand, rubricated headings. */
export function ledgerTexture() {
  const [c, x] = canvas(1024, 720);
  const R = prng(13);
  const page = (ox) => {
    const g = x.createLinearGradient(ox, 0, ox + 512, 0);
    if (ox === 0) { g.addColorStop(0, '#d8c69a'); g.addColorStop(0.85, '#efe3c2'); g.addColorStop(1, '#b8a47a'); }
    else { g.addColorStop(0, '#b8a47a'); g.addColorStop(0.15, '#efe3c2'); g.addColorStop(1, '#d8c69a'); }
    x.fillStyle = g;
    x.fillRect(ox, 0, 512, 720);
    // rubric heading
    x.fillStyle = '#8a1a10';
    x.font = 'bold italic 34px serif';
    x.fillText(ox === 0 ? 'Roll of the Brave' : 'Bounties Paid', ox + 60, 70);
    // ruling + two columns
    x.strokeStyle = 'rgba(140,60,40,0.35)';
    x.lineWidth = 1;
    for (let y = 100; y < 690; y += 30) { x.beginPath(); x.moveTo(ox + 50, y); x.lineTo(ox + 470, y); x.stroke(); }
    x.beginPath(); x.moveTo(ox + 360, 90); x.lineTo(ox + 360, 690); x.stroke();
    // entries: scribbled words (names) + figures
    x.fillStyle = '#3a2410';
    for (let y = 124; y < 690; y += 30) {
      let px = ox + 58;
      const words = 2 + Math.floor(R.next() * 3);
      for (let k = 0; k < words; k++) {
        const w = R.range(28, 72);
        x.beginPath();
        for (let i = 0; i <= w; i += 3) x.lineTo(px + i, y - 4 + Math.sin(i * 0.9 + R.next()) * 4 - (i % 9 === 0 ? 4 : 0));
        x.lineWidth = 2;
        x.strokeStyle = '#3a2410';
        x.stroke();
        px += w + 12;
        if (px > ox + 340) break;
      }
      if (R.chance(0.9)) { x.font = 'italic 20px serif'; x.fillText(`${Math.floor(R.range(10, 900))} gp`, ox + 378, y); }
      if (R.chance(0.08)) { x.strokeStyle = '#3a2410'; x.beginPath(); x.moveTo(ox + 54, y - 6); x.lineTo(ox + 340, y - 6); x.stroke(); }
    }
    // drop cap
    x.fillStyle = '#2a4aa8';
    x.fillRect(ox + 60, 92, 30, 30);
    x.fillStyle = '#d4a640';
    x.font = 'bold 26px serif';
    x.fillText('P', ox + 66, 116);
  };
  page(0);
  page(512);
  // gutter shadow
  const g = x.createLinearGradient(452, 0, 572, 0);
  g.addColorStop(0, 'rgba(60,40,20,0)'); g.addColorStop(0.5, 'rgba(60,40,20,0.55)'); g.addColorStop(1, 'rgba(60,40,20,0)');
  x.fillStyle = g;
  x.fillRect(452, 0, 120, 720);
  return tex(c, { aniso: 8 });
}

/** Petitions and a city plan on one sheet texture (laid on several cards). */
export function paperTexture() {
  const [c, x] = canvas(256, 320);
  const R = prng(17);
  x.fillStyle = '#e6d6ae';
  x.fillRect(0, 0, 256, 320);
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(120,80,30,${R.range(0.02, 0.07)})`; x.beginPath(); x.arc(R.range(0, 256), R.range(0, 320), R.range(6, 40), 0, 6.28); x.fill(); }
  // street plan
  x.strokeStyle = 'rgba(60,30,10,0.75)';
  x.lineWidth = 2;
  for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(20, 30 + i * 30); x.lineTo(236, 40 + i * 28 + R.range(-6, 6)); x.stroke(); }
  for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(30 + i * 32, 20); x.lineTo(24 + i * 34, 300); x.stroke(); }
  x.fillStyle = 'rgba(140,30,20,0.6)';
  for (let i = 0; i < 6; i++) x.fillRect(R.range(30, 220), R.range(30, 290), 12, 10);
  x.strokeStyle = 'rgba(90,50,20,0.6)';
  x.strokeRect(6, 6, 244, 308);
  return tex(c);
}

/** Quill: a white goose feather with a dark vane edge, on transparent. */
export function featherTexture() {
  const [c, x] = canvas(64, 256);
  x.clearRect(0, 0, 64, 256);
  x.fillStyle = '#efe8da';
  x.beginPath();
  x.moveTo(32, 250);
  x.quadraticCurveTo(6, 140, 22, 8);
  x.quadraticCurveTo(44, 60, 46, 140);
  x.quadraticCurveTo(44, 210, 32, 250);
  x.fill();
  x.strokeStyle = 'rgba(80,70,60,0.5)';
  for (let y = 20; y < 230; y += 5) { x.beginPath(); x.moveTo(32, y + 8); x.lineTo(14 + (y / 250) * 8, y); x.stroke(); x.beginPath(); x.moveTo(32, y + 8); x.lineTo(46 - (y / 250) * 6, y); x.stroke(); }
  x.strokeStyle = '#8a7a60';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(32, 254); x.quadraticCurveTo(30, 130, 24, 10); x.stroke();
  return tex(c);
}

/**
 * The council floor: polished square flags laid in a diagonal-free chequer of
 * cream limestone and dark red Moonsea marble, each slab with its own veining
 * and tone, chipped arrises, worn dull lanes and dirt in the joints. 2×2 slabs
 * per tile (lay with worldUV so one slab ≈ half the UV scale). Returns
 * {map, roughnessMap}.
 */
export function marbleFloorTexture() {
  const N = 512;
  const T = N / 2;
  const [c, x] = canvas(N, N);
  const [rc, rx] = canvas(N, N);
  const R = prng(29);
  const img = x.createImageData(N, N);
  const rim = rx.createImageData(N, N);
  // tiny value noise
  const P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = R.next();
  const vn = (u, v) => {
    const iu = Math.floor(u), iv = Math.floor(v);
    const fu = u - iu, fv = v - iv;
    const a = P[(iu & 255) + (iv & 255) * 256], b = P[((iu + 1) & 255) + (iv & 255) * 256];
    const c2 = P[(iu & 255) + ((iv + 1) & 255) * 256], d = P[((iu + 1) & 255) + ((iv + 1) & 255) * 256];
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    return a + (b - a) * su + (c2 - a) * sv + (a - b - c2 + d) * su * sv;
  };
  const fbm = (u, v) => vn(u, v) * 0.5 + vn(u * 2.03, v * 2.03) * 0.25 + vn(u * 4.1, v * 4.1) * 0.125 + vn(u * 8.3, v * 8.3) * 0.0625;
  const slabs = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const dark = (i + j) % 2 === 1;
    slabs.push({ dark, tone: R.range(0.9, 1.08), ang: R.range(0, Math.PI), off: R.range(0, 50), chip: [R.range(0, 1), R.range(0, 1)] });
  }
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const si = (px >= T ? 1 : 0) + (py >= T ? 2 : 0);
    const s = slabs[si];
    const lx = px % T, ly = py % T;
    const u = px / 40 + s.off, v = py / 40 + s.off;
    const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
    const ru = u * ca - v * sa, rv = u * sa + v * ca;
    const warp = fbm(ru * 0.6, rv * 0.6) * 6;
    const vein = Math.pow(1 - Math.abs(Math.sin(ru * 0.9 + warp)), 18);
    const vein2 = Math.pow(1 - Math.abs(Math.sin(rv * 1.7 + warp * 1.3)), 40) * 0.6;
    const cloud = fbm(u * 0.35, v * 0.35);
    let r, g, b;
    if (s.dark) {
      // oxblood marble with pale veins
      r = 84 + cloud * 30; g = 46 + cloud * 16; b = 42 + cloud * 14; // a muted, dusty oxblood
      r += (vein + vein2) * 60; g += (vein + vein2) * 50; b += (vein + vein2) * 42;
    } else {
      // cream limestone with grey-gold veins
      r = 184 + cloud * 30; g = 168 + cloud * 26; b = 140 + cloud * 22;
      r -= (vein + vein2) * 50; g -= (vein + vein2) * 48; b -= (vein + vein2) * 38;
    }
    r *= s.tone; g *= s.tone; b *= s.tone;
    // joints: dark grout + dirt creeping in, bevelled arris highlight
    const e = Math.min(lx, ly, T - 1 - lx, T - 1 - ly);
    const chipD = Math.hypot(lx / T - s.chip[0], ly / T - s.chip[1]);
    const grout = e < 2.2 ? 1 : 0;
    const arris = e >= 2.2 && e < 4.5 ? 1 : 0;
    const dirt = Math.max(0, 1 - (e - 2) / 9) * (0.4 + 0.6 * fbm(px / 9, py / 9));
    const chipped = e < 7 && fbm(px / 5, py / 5) > 0.62 + chipD * 0.2 ? 1 : 0;
    if (grout || chipped) { r = 38; g = 30; b = 24; }
    else {
      r *= 1 - dirt * 0.45; g *= 1 - dirt * 0.47; b *= 1 - dirt * 0.5;
      if (arris) { r *= 1.07; g *= 1.07; b *= 1.06; }
    }
    // a worn dull lane down the middle of the hall + scuffs
    const wear = fbm(px / 60, py / 14);
    const k = (py * N + px) * 4;
    img.data[k] = Math.min(255, r); img.data[k + 1] = Math.min(255, g); img.data[k + 2] = Math.min(255, b); img.data[k + 3] = 255;
    const rough = grout || chipped ? 250 : Math.min(250, 60 + wear * 90 + dirt * 140 + (s.dark ? -10 : 20));
    rim.data[k] = rough; rim.data[k + 1] = rough; rim.data[k + 2] = rough; rim.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  rx.putImageData(rim, 0, 0);
  const map = tex(c, { aniso: 8 });
  const roughnessMap = tex(rc, { srgb: false, aniso: 8 });
  for (const t of [map, roughnessMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, roughnessMap };
}
