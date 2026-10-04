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
  g.fillStyle = '#5c4b34';
  g.fillRect(0, 0, N, N);
  let k = 1;
  // Grit and sand.
  for (let i = 0; i < 1400; i++, k++) {
    const v = 60 + hash(k) * 60;
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
      g.fillStyle = straw ? `rgb(${(118 * l) | 0},${(102 * l) | 0},${(58 * l) | 0})` : `rgb(${(96 * l) | 0},${(104 * l) | 0},${(54 * l) | 0})`;
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
    // Unit base: a straight painted skirt rising to a rounded bevel and a
    // chamfered lip (catches a light edge at board zoom), the flocked top
    // inset just inside it. Group 0 = painted rim, group 1 = flock.
    const prof = [[1.0, 0], [1.0, 0.055], [0.992, 0.072], [0.975, 0.086], [0.95, 0.096], [0.93, 0.1], [0.915, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
    const rim = new THREE.LatheGeometry(prof, 40).toNonIndexed();
    const top = new THREE.CircleGeometry(0.916, 40).rotateX(-Math.PI / 2).translate(0, 0.1, 0).toNonIndexed();
    rim.deleteAttribute('uv');
    top.deleteAttribute('uv');
    // Planar top UVs for the flock.
    const tp = top.attributes.position;
    const uv = new Float32Array(tp.count * 2);
    for (let i = 0; i < tp.count; i++) {
      uv[i * 2] = tp.getX(i) * 0.5 + 0.5;
      uv[i * 2 + 1] = tp.getZ(i) * 0.5 + 0.5;
    }
    top.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    rim.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rim.attributes.position.count * 2), 2));
    const pos = new Float32Array((rim.attributes.position.count + tp.count) * 3);
    const nor = new Float32Array(pos.length);
    const uvs = new Float32Array((rim.attributes.position.count + tp.count) * 2);
    pos.set(rim.attributes.position.array, 0);
    pos.set(tp.array, rim.attributes.position.array.length);
    nor.set(rim.attributes.normal.array, 0);
    nor.set(top.attributes.normal.array, rim.attributes.normal.array.length);
    uvs.set(rim.attributes.uv.array, 0);
    uvs.set(uv, rim.attributes.uv.array.length);
    _geo = new THREE.BufferGeometry();
    _geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    _geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    _geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    _geo.addGroup(0, rim.attributes.position.count, 0);
    _geo.addGroup(rim.attributes.position.count, tp.count, 1);
    rim.dispose();
    top.dispose();
  }
  if (!_mats) {
    const rim = new THREE.MeshStandardMaterial({ color: 0x3a3229, roughness: 0.62, metalness: 0 });
    const top = new THREE.MeshStandardMaterial({ map: flockTexture(), roughness: 1, metalness: 0 });
    _mats = [rim, top];
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
