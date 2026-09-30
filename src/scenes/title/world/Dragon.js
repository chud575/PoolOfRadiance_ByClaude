import * as THREE from 'three';

/**
 * A dragon's silhouette crossing the sunset over the Moonsea (side view,
 * flying west). Body is a spine-swept outline; two membrane wings flap about
 * the body axis so they foreshorten convincingly. update(t) moves and flaps.
 */
export function createDragon({ color = 0x0b0710 } = {}) {
  const group = new THREE.Group();
  group.name = 'dragon';
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false });

  // ---- body -----------------------------------------------------------------
  const spine = new THREE.CatmullRomCurve3(
    [[-9.4, 1.5], [-8.2, 1.4], [-6.4, 0.8], [-4.4, 0.15], [-2, 0], [1, -0.15], [3.5, 0.1], [6, 0.55], [8.8, 0.3], [11.4, -0.35], [13.8, -0.1]].map(([x, y]) => new THREE.Vector3(x, y, 0)),
  );
  const widthAt = (s) => {
    const k = [
      [0, 0.1], [0.025, 0.42], [0.06, 0.62], [0.1, 0.36], [0.22, 0.4], [0.33, 1.05], [0.42, 1.18], [0.52, 0.8], [0.62, 0.5], [0.8, 0.24], [1, 0.05],
    ];
    for (let i = 1; i < k.length; i++) {
      if (s <= k[i][0]) {
        const f = (s - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        const e = f * f * (3 - 2 * f);
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * e;
      }
    }
    return 0.05;
  };
  const N = 80;
  const top = [];
  const bot = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const p = spine.getPointAt(s);
    const tg = spine.getTangentAt(s);
    const n = new THREE.Vector2(-tg.y, tg.x);
    const w = widthAt(s) / 2;
    top.push(new THREE.Vector2(p.x + n.x * w, p.y + n.y * w));
    bot.push(new THREE.Vector2(p.x - n.x * w, p.y - n.y * w * 1.15));
  }
  const body = new THREE.Shape([...top, ...bot.reverse()]);
  const shapes = [body];
  // horns, jaw, spade tail, tucked legs, dorsal spines
  const tri = (pts) => shapes.push(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  tri([[-8.3, 1.62], [-7.2, 2.5], [-7.6, 1.55]]);
  tri([[-7.9, 1.55], [-6.5, 2.2], [-7.0, 1.35]]);
  tri([[-9.3, 1.3], [-8.0, 0.95], [-7.6, 1.2]]);
  tri([[13.2, -0.1], [14.6, 0.55], [15.2, -0.35], [14.3, -0.75]]);
  tri([[-1.4, -0.4], [-0.6, -1.4], [-1.3, -1.9], [-0.9, -1.35], [-0.3, -0.5]]);
  tri([[3.0, -0.2], [4.2, -1.3], [3.5, -2.0], [4.4, -1.4], [3.9, -0.1]]);
  for (let i = 0; i < 9; i++) {
    const s = 0.24 + i * 0.07;
    const p = spine.getPointAt(s);
    const w = widthAt(s) / 2;
    tri([[p.x - 0.28, p.y + w - 0.05], [p.x + 0.1, p.y + w + 0.38 - i * 0.02], [p.x + 0.3, p.y + w - 0.05]]);
  }
  const bodyGeo = new THREE.ShapeGeometry(shapes, 6);
  group.add(new THREE.Mesh(bodyGeo, mat));

  // ---- wings -------------------------------------------------------------------
  const ws = new THREE.Shape();
  const P = (x, y) => new THREE.Vector2(x, y);
  const wrist = P(-1.4, 8.6);
  ws.moveTo(-0.9, 0);
  ws.quadraticCurveTo(-3.0, 3.6, wrist.x, wrist.y);
  ws.lineTo(-4.4, 12.6); // finger 1 (leading)
  const tips = [P(-4.4, 12.6), P(0.2, 13.4), P(3.6, 11.4), P(5.4, 7.6), P(3.4, 0)];
  for (let i = 1; i < tips.length; i++) {
    const a = tips[i - 1];
    const b = tips[i];
    // scalloped membrane pulled toward the wrist
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const c = mid.clone().lerp(i === tips.length - 1 ? P(1.5, 1.5) : wrist, 0.42);
    ws.quadraticCurveTo(c.x, c.y, b.x, b.y);
  }
  ws.closePath();
  const wingGeo = new THREE.ShapeGeometry(ws, 10);
  // the shape's +y is span; wing lies in the XY plane pointing up
  const wings = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(-2.4, 0.5, 0);
    const w = new THREE.Mesh(wingGeo, mat);
    pivot.add(w);
    pivot.userData.side = side;
    group.add(pivot);
    wings.push(pivot);
  }

  const flap = (t) => {
    // bursts of strong beats, then long glides with wings spread
    const cycle = t % 9;
    const beating = cycle < 4.2;
    const ph = t * 2.6;
    const beat = beating ? Math.sin(ph) : 0.18 + 0.05 * Math.sin(t * 0.8);
    return beat;
  };

  return {
    group,
    /**
     * @param {number} t
     * @param {{x:number,y:number,z:number,dx:number}} path start position + speed (m/s west)
     */
    update(t, path) {
      const b = flap(t);
      // near wing swings toward the camera (+z), far wing away; 0 = raised
      const up = 0.35, down = 2.35;
      const a = up + (down - up) * (0.5 - 0.5 * b);
      wings[0].rotation.x = a;
      wings[1].rotation.x = -a;
      wings[0].rotation.z = 0.12 * b;
      wings[1].rotation.z = 0.12 * b;
      if (path) {
        const span = path.span ?? 520;
        const x = path.x - (((t * path.dx) % span) + span) % span;
        group.position.set(x, path.y + Math.sin(t * 0.6) * 1.2 - b * 0.5, path.z);
        group.rotation.z = Math.sin(t * 0.35) * 0.05 - 0.04;
      }
    },
    dispose() {
      bodyGeo.dispose();
      wingGeo.dispose();
      mat.dispose();
    },
  };
}
