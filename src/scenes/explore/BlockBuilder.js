import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EDGE, CELL, DIR_VEC } from '../../data/maps/MapGrid.js';
import { getMaterial, WALL_STYLE_MATERIALS, FLOOR_MATERIALS } from '../../render/materials.js';
import { createTorch } from '../../render/lighting.js';

/** World scale (metres). One grid cell = CELL_SIZE x CELL_SIZE. */
export const CELL_SIZE = 3;
export const WALL_T = 0.34;
export const WALL_H_STREET = 3.4;
export const WALL_H_BUILDING = 5.4;
export const CEIL_H = 3.3;
export const EYE_H = 1.62;

/** Centre of a cell in world space. */
export function cellCenter(x, y, out = new THREE.Vector3()) {
  return out.set(x * CELL_SIZE + CELL_SIZE / 2, 0, y * CELL_SIZE + CELL_SIZE / 2);
}

const isRoofed = (c) => c === CELL.INTERIOR;

/**
 * Build the 3D representation of a MapGrid block.
 * Returns {group, doors: Map<edgeKey, {pivot, open(t)}>, torches: Group[]} — dispose via disposeBlock.
 * @param {import('../../data/maps/MapGrid.js').MapGrid} map
 * @param {{foundSecrets?: Set<string>}} [opts]
 */
export function buildBlock(map, opts = {}) {
  const group = new THREE.Group();
  group.name = `block:${map.id}`;
  const byMat = new Map(); // material key → geometries[]
  const add = (key, geo) => {
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(geo);
  };
  const doors = new Map();
  const torches = [];
  const S = CELL_SIZE;

  // ---- floors & ceilings ----
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const c = map.getCell(x, y);
      const g = new THREE.PlaneGeometry(S, S);
      g.rotateX(-Math.PI / 2);
      g.translate(x * S + S / 2, 0, y * S + S / 2);
      add(FLOOR_MATERIALS[c] ?? 'floor_cobble', g);
      if (isRoofed(c)) {
        const cg = new THREE.PlaneGeometry(S, S);
        cg.rotateX(Math.PI / 2);
        cg.translate(x * S + S / 2, CEIL_H, y * S + S / 2);
        add('ceiling_wood', cg);
      }
    }
  }

  // ---- walls: visit each edge once (N and W of every cell, plus E/S borders) ----
  const visit = (x, y, dir) => {
    const type = map.getEdge(x, y, dir);
    if (type === EDGE.OPEN) return;
    const style = map.getEdgeStyle(x, y, dir);
    const [dx, dy] = DIR_VEC[dir];
    const here = map.getCell(x, y);
    const there = map.inBounds(x + dx, y + dy) ? map.getCell(x + dx, y + dy) : CELL.STREET;
    const tall = isRoofed(here) || isRoofed(there);
    const heightVar = style === 2 ? 0.55 + 0.35 * hash(x, y, dir) : 1;
    const H = (tall ? WALL_H_BUILDING : WALL_H_STREET) * heightVar;
    const horizontal = dir === 'N' || dir === 'S';
    // edge midpoint
    const ex = horizontal ? x * S + S / 2 : x * S + (dir === 'E' ? S : 0);
    const ez = horizontal ? y * S + (dir === 'S' ? S : 0) : y * S + S / 2;
    const matKey = WALL_STYLE_MATERIALS[style] ?? 'wall_stone';
    const found = opts.foundSecrets?.has(`${x},${y},${dir}`);
    const opening = type === EDGE.DOOR || type === EDGE.LOCKED || type === EDGE.ARCH || (type === EDGE.SECRET && found);

    if (!opening) {
      add(matKey, wallBox(S + WALL_T, H, WALL_T, ex, H / 2, ez, horizontal, 0));
      return;
    }
    const ow = type === EDGE.ARCH ? 2.0 : 1.35;
    const oh = type === EDGE.ARCH ? 2.9 : 2.35;
    const side = (S + WALL_T - ow) / 2;
    const off = ow / 2 + side / 2;
    add(matKey, wallBox(side, H, WALL_T, ex, H / 2, ez, horizontal, -off));
    add(matKey, wallBox(side, H, WALL_T, ex, H / 2, ez, horizontal, off));
    add(matKey, wallBox(ow, H - oh, WALL_T, ex, oh + (H - oh) / 2, ez, horizontal, 0));
    // frame trim (darker stone jambs)
    add('wall_stone', wallBox(0.16, oh, WALL_T + 0.08, ex, oh / 2, ez, horizontal, -ow / 2 - 0.02));
    add('wall_stone', wallBox(0.16, oh, WALL_T + 0.08, ex, oh / 2, ez, horizontal, ow / 2 + 0.02));
    add('wall_stone', wallBox(ow + 0.36, 0.2, WALL_T + 0.1, ex, oh + 0.08, ez, horizontal, 0));

    if (type !== EDGE.ARCH) {
      // hinged door leaf
      const pivot = new THREE.Group();
      const leafGeo = new THREE.BoxGeometry(ow - 0.04, oh - 0.03, 0.09);
      leafGeo.translate((ow - 0.04) / 2, (oh - 0.03) / 2, 0);
      const leaf = new THREE.Mesh(leafGeo, getMaterial('door_wood'));
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16), getMaterial('iron'));
      ring.position.set(ow - 0.25, 1.05, 0.07);
      leaf.add(ring);
      const ring2 = ring.clone();
      ring2.position.z = -0.07;
      leaf.add(ring2);
      pivot.add(leaf);
      if (horizontal) pivot.position.set(ex - ow / 2 + 0.02, 0, ez);
      else {
        pivot.position.set(ex, 0, ez + ow / 2 - 0.02);
        pivot.rotation.y = Math.PI / 2;
      }
      const baseRot = pivot.rotation.y;
      group.add(pivot);
      doors.set(`${x},${y},${dir}`, {
        pivot,
        locked: type === EDGE.LOCKED,
        /** @param {number} t 0 closed .. 1 fully open */
        setOpen(t) {
          pivot.rotation.y = baseRot - t * 1.75;
        },
      });
      // sconce torch beside doors that face the street
      if (hash(x, y, dir) > 0.35) {
        const t = createTorch({ intensity: 0, glow: true, color: 0xffa24a, seed: x * 13 + y });
        t.userData.light.visible = false; // glow-only; the scene enables a few nearby lights
        const sideSign = hash(y, x, dir) > 0.5 ? 1 : -1;
        const nx = horizontal ? 0 : dir === 'E' ? -1 : 1;
        const nz = horizontal ? (dir === 'S' ? -1 : 1) : 0;
        const lx = horizontal ? ex + sideSign * (ow / 2 + 0.45) : ex + nx * (WALL_T / 2 + 0.18);
        const lz = horizontal ? ez + nz * (WALL_T / 2 + 0.18) : ez + sideSign * (ow / 2 + 0.45);
        t.position.set(lx, 2.3, lz);
        t.children[1]?.scale.setScalar(0.55);
        const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.35, 8), getMaterial('iron'));
        bracket.position.y = -0.22;
        t.add(bracket);
        torches.push(t);
        group.add(t);
      }
    }
  };

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      visit(x, y, 'N');
      visit(x, y, 'W');
      if (x === map.w - 1) visit(x, y, 'E');
      if (y === map.h - 1) visit(x, y, 'S');
    }
  }

  for (const [key, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, getMaterial(key));
    mesh.name = key;
    mesh.receiveShadow = true;
    mesh.castShadow = !key.startsWith('floor') && key !== 'ceiling_wood';
    group.add(mesh);
  }
  return { group, doors, torches };
}

/** Box for a wall piece centred on an edge, offset `along` the edge. */
function wallBox(len, h, t, ex, cy, ez, horizontal, along) {
  const g = new THREE.BoxGeometry(horizontal ? len : t, h, horizontal ? t : len);
  // world-scale UVs so textures don't stretch: scale UV by size / 3m
  scaleBoxUVs(g, horizontal ? len : t, h, horizontal ? t : len);
  g.translate(horizontal ? ex + along : ex, cy, horizontal ? ez : ez + along);
  return g;
}

function scaleBoxUVs(g, sx, sy, sz) {
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    let u = uv.getX(i);
    let v = uv.getY(i);
    if (ax > 0.5) {
      u *= sz / CELL_SIZE;
      v *= sy / CELL_SIZE;
    } else if (ay > 0.5) {
      u *= sx / CELL_SIZE;
      v *= sz / CELL_SIZE;
    } else {
      u *= sx / CELL_SIZE;
      v *= sy / CELL_SIZE;
    }
    uv.setXY(i, u, v);
  }
}

function hash(x, y, d) {
  const s = Math.sin(x * 127.1 + y * 311.7 + d.charCodeAt(0) * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export function disposeBlock(block) {
  block.group.traverse((o) => {
    if (o.isMesh) o.geometry.dispose();
  });
  block.group.removeFromParent();
}
