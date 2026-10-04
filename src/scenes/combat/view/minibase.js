import * as THREE from 'three';

/**
 * The small round wargame base every combat figure stands on: a bevelled,
 * dark-painted slab with a flocked top (static grass, grit and a few pebbles
 * over a brown basecoat). Procedural, deterministic, shared geometry/material.
 */
let _geo = null;
let _mats = null;

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function flockTexture() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2e20';
  g.fillRect(0, 0, N, N);
  let k = 1;
  // Grit and sand.
  for (let i = 0; i < 1400; i++, k++) {
    const v = 40 + hash(k) * 50;
    g.fillStyle = `rgb(${v + 14 | 0},${v + 6 | 0},${v - 6 | 0})`;
    g.fillRect(hash(k + 0.3) * N, hash(k + 0.7) * N, 1 + hash(k + 0.9) * 1.5, 1 + hash(k + 0.1) * 1.5);
  }
  // Static-grass tufts (dull olive and straw, never bright green).
  for (let i = 0; i < 90; i++, k++) {
    const x = hash(k) * N;
    const y = hash(k + 0.5) * N;
    const r = 3 + hash(k + 0.2) * 7;
    const straw = hash(k + 0.8) > 0.6;
    for (let j = 0; j < 26; j++) {
      const a = hash(k * 3 + j) * Math.PI * 2;
      const d = Math.sqrt(hash(k * 5 + j)) * r;
      const l = 0.75 + hash(k * 7 + j) * 0.5;
      g.fillStyle = straw ? `rgb(${(118 * l) | 0},${(102 * l) | 0},${(58 * l) | 0})` : `rgb(${(70 * l) | 0},${(80 * l) | 0},${(40 * l) | 0})`;
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.5, 1.5);
    }
  }
  // A few pebbles, drybrushed.
  for (let i = 0; i < 10; i++, k++) {
    const x = hash(k) * N;
    const y = hash(k + 0.4) * N;
    const r = 1.5 + hash(k + 0.6) * 2.5;
    g.fillStyle = '#5a554c';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8a857a';
    g.beginPath();
    g.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A base mesh of radius r (metres), its top at y = h. */
export function makeMiniBase(r = 0.4) {
  if (!_geo) {
    // Unit base: slight bevel (top narrower), 4.5 cm tall at unit radius.
    _geo = new THREE.CylinderGeometry(0.93, 1, 0.1, 32, 1, false);
    _geo.translate(0, 0.05, 0);
  }
  if (!_mats) {
    const rim = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.9, metalness: 0 });
    const top = new THREE.MeshStandardMaterial({ map: flockTexture(), roughness: 1, metalness: 0 });
    _mats = [rim, top, rim];
  }
  const m = new THREE.Mesh(_geo, _mats);
  m.scale.set(r, 0.45, r);
  m.receiveShadow = true;
  m.castShadow = false;
  m.userData.miniBase = true;
  return m;
}

export function disposeMiniBase() {
  _geo?.dispose();
  _geo = null;
  if (_mats) {
    _mats[1].map?.dispose();
    for (const m of new Set(_mats)) m.dispose();
  }
  _mats = null;
}
