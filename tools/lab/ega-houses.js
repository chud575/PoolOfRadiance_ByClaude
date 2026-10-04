// Lab: the simplest possible houses, EGA-coloured, rendered three ways at 320x200.
import * as THREE from 'three';

// Exact EGA hex values in, exact values out: no colour management.
THREE.ColorManagement.enabled = false;

const EGA = {
  black: 0x000000, blue: 0x0000aa, green: 0x00aa00, cyan: 0x00aaaa, red: 0xaa0000, magenta: 0xaa00aa,
  brown: 0xaa5500, lgrey: 0xaaaaaa, dgrey: 0x555555, lblue: 0x5555ff, lgreen: 0x55ff55, lcyan: 0x55ffff,
  lred: 0xff5555, lmagenta: 0xff55ff, yellow: 0xffff55, white: 0xffffff,
};

// One house = box body + gable roof + door + two windows. Colours per part.
function house({ w = 3, d = 3, h = 2.4, roofH = 1.4, wall, roof, door, win }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
  body.position.y = h / 2;
  g.add(body);
  // gable roof: triangular prism along x, slight overhang
  const ow = w + 0.3, od = d + 0.3;
  const shape = new THREE.Shape([new THREE.Vector2(-od / 2, 0), new THREE.Vector2(od / 2, 0), new THREE.Vector2(0, roofH)]);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: ow, bevelEnabled: false });
  roofGeo.translate(0, 0, -ow / 2);
  roofGeo.rotateY(Math.PI / 2);
  const r = new THREE.Mesh(roofGeo, mat(roof));
  r.position.y = h;
  g.add(r);
  // door + windows as thin boxes proud of the front face (+z)
  const front = d / 2 + 0.02;
  const dr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.04), mat(door));
  dr.position.set(0, 0.65, front);
  g.add(dr);
  for (const x of [-w * 0.3, w * 0.3]) {
    const wn = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.04), mat(win));
    wn.position.set(x, h * 0.62, front);
    g.add(wn);
  }
  g.userData.colors = { wall, roof, door, win };
  return g;
}
function mat(c) { const m = new THREE.MeshBasicMaterial({ color: c }); m.userData.ega = c; return m; }

function street() {
  const s = new THREE.Group();
  const specs = [
    { wall: EGA.lgrey, roof: EGA.red, door: EGA.brown, win: EGA.lblue },
    { wall: EGA.brown, roof: EGA.dgrey, door: EGA.yellow, win: EGA.lcyan, h: 3, w: 2.6 },
    { wall: EGA.white, roof: EGA.blue, door: EGA.red, win: EGA.yellow, w: 3.4, roofH: 1.8 },
    { wall: EGA.dgrey, roof: EGA.brown, door: EGA.lred, win: EGA.lgreen, h: 2 },
  ];
  let x = -6.2;
  for (const sp of specs) {
    const hs = house(sp);
    const w = sp.w ?? 3;
    hs.position.x = x + w / 2;
    x += w + 0.6;
    s.add(hs);
  }
  return s;
}

const W = 320, H = 200;
const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 100);
camera.position.set(2.2, 3.2, 13.5);
camera.lookAt(0.4, 1.7, 0);

function makeRenderer() {
  const c = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: false, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  r.outputColorSpace = THREE.LinearSRGBColorSpace; // with colour management off, hex values pass straight through
  r.setClearColor(0x000000, 1);
  return r;
}
function ground(scene, color) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshBasicMaterial({ color }));
  g.rotation.x = -Math.PI / 2;
  g.position.set(0, 0, 2);
  scene.add(g);
}
// Edges of every mesh, drawn in the mesh's own EGA colour (or a fixed colour).
function edgesOf(root, color) {
  const out = new THREE.Group();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 20), new THREE.LineBasicMaterial({ color: color ?? o.material.userData.ega }));
    e.position.copy(o.position); e.rotation.copy(o.rotation); e.scale.copy(o.scale);
    o.parent.updateMatrixWorld(true);
    e.matrix.copy(o.matrixWorld); e.matrixAutoUpdate = false;
    out.add(e);
  });
  return out;
}

const variants = [
  {
    name: 'A · line art: edges only, each part in its EGA colour, black everywhere else',
    build(scene) {
      const s = street(); s.updateMatrixWorld(true);
      // hidden-line removal: draw the solids in black first, then the edges on top
      s.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }); } });
      const edges = edgesOf(street());
      scene.add(s, edges);
      const lineY = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-20, 0, 1.8), new THREE.Vector3(20, 0, 1.8)]), new THREE.LineBasicMaterial({ color: EGA.dgrey }));
      scene.add(lineY);
    },
  },
  {
    name: 'D · line art + street grid (flagstone lines receding, like the 1988 dungeon view)',
    build(scene) {
      const s = street(); s.updateMatrixWorld(true);
      s.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }); } });
      scene.add(s, edgesOf(street()));
      const pts = [];
      for (let z = 0.6; z <= 8; z += 1.1) pts.push(new THREE.Vector3(-20, 0, z), new THREE.Vector3(20, 0, z));
      for (let x = -14; x <= 14; x += 1.6) pts.push(new THREE.Vector3(x, 0, 0.6), new THREE.Vector3(x * 1.05, 0, 8));
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: EGA.dgrey })));
    },
  },
  {
    name: 'B · flat EGA fills + black outlines (cartoon / original title-card style)',
    build(scene) {
      ground(scene, EGA.dgrey);
      const s = street();
      scene.add(s, edgesOf(street(), EGA.black));
      scene.background = new THREE.Color(EGA.blue);
    },
  },
  {
    name: 'C · flat EGA fills, no outlines, sky + ground bands like the 1988 viewport',
    build(scene) {
      ground(scene, EGA.dgrey);
      scene.add(street());
      scene.background = new THREE.Color(EGA.blue);
    },
  },
];

const row = document.getElementById('row');
for (const v of variants) {
  const scene = new THREE.Scene();
  v.build(scene);
  const r = makeRenderer();
  r.render(scene, camera);
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = v.name;
  fig.append(cap, r.domElement);
  row.append(fig);
}
window.__READY = true;
