import * as THREE from 'three';
import { patchSculptShader } from './sculpted.js';

/**
 * Procedural skeletal animation for combat figures. Every clip is a pure function
 * of absolute scene time (clip start + age) so frozen-clock screenshots are
 * deterministic; the death "ragdoll-lite" is a fixed-step simulation replayed
 * from the clip start, so it also depends only on time.
 */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const lerp = (a, b, t) => a + (b - a) * t;
const hashf = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const angLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
};

/**
 * Shared fresnel rim (one program for every figure): a thin bright edge so the
 * silhouettes separate from cobbles and walls. Colour/strength set per scene.
 */
export const RIM = { uRimColor: { value: new THREE.Color(0.18, 0.16, 0.14) }, uRimPower: { value: 3.0 } };

function addRim(mat) {
  if (!mat.isMeshStandardMaterial) return;
  const sculpt = !!mat.userData?.sculpt;
  mat.onBeforeCompile = (sh) => {
    if (sculpt) patchSculptShader(sh);
    sh.uniforms.uRimColor = RIM.uRimColor;
    sh.uniforms.uRimPower = RIM.uRimPower;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimPower;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);
          totalEmissiveRadiance += uRimColor * rimF * (0.6 + 0.4 * diffuseColor.rgb / max(0.001, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)))); }`);
  };
  mat.customProgramCacheKey = () => (sculpt ? 'fig-rim-sculpt' : 'fig-rim');
}

export class Figure {
  /**
   * @param {object} model  result of makeFigureModel
   * @param {{seed:number}} o
   */
  constructor(model, o = {}) {
    this.model = model;
    this.root = new THREE.Group();
    this.root.add(model.root);
    this.b = model.bones;
    this.rig = model.rig;
    this.s = model.scale ?? 1;
    this.seed = o.seed ?? 0;
    this.phase = hashf(this.seed) * 10;
    // Per-figure material clones so hits can flash and the dead can dim.
    this.mats = [];
    for (const m of model.meshes) {
      m.material = m.material.clone();
      addRim(m.material);
      this.mats.push({ m: m.material, emissive: m.material.emissive?.clone() ?? new THREE.Color(0), ei: m.material.emissiveIntensity ?? 1, color: m.material.color.clone() });
    }
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.yawFrom = 0;
    this.yawTo = 0;
    this.yawStart = -99;
    this.walk = null;
    this.action = null;
    this.state = 'idle';
    this.death = null;
    this.hitFlash = -99;
    this.guard = false;
    this.rest = {};
    for (const [k, bone] of Object.entries(this.b)) this.rest[k] = bone.position.clone();
  }

  place(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = this.yawFrom = this.yawTo = yaw;
    this.root.position.copy(this.pos);
    this.root.rotation.y = yaw;
  }

  faceTo(yaw, t) {
    this.yawFrom = this.currentYaw(t);
    this.yawTo = yaw;
    this.yawStart = t;
  }

  currentYaw(t) {
    return angLerp(this.yawFrom, this.yawTo, ease(clamp01((t - this.yawStart) / 0.22)));
  }

  /** Walk through world points [{x,z}], starting at t, `stepDur` seconds per square. */
  walkPath(points, t, stepDur) {
    const from = { x: this.pos.x, z: this.pos.z };
    const segs = [];
    let prev = from;
    let tt = t;
    for (const p of points) {
      const len = Math.hypot(p.x - prev.x, p.z - prev.z);
      const d = stepDur * (len > 1.8 ? 1.3 : 1);
      segs.push({ a: prev, b: p, t0: tt, t1: tt + d, yaw: Math.atan2(p.x - prev.x, p.z - prev.z) });
      tt += d;
      prev = p;
    }
    this.walk = { segs, t0: t, t1: tt };
    return tt - t;
  }

  /** Start an action clip. Returns its duration. */
  play(type, t, dur, params = {}) {
    this.action = { type, t0: t, dur, ...params };
    if (type === 'hit') this.hitFlash = t;
    return dur;
  }

  /** Begin the death collapse (ragdoll-lite) at time t, falling away from (fx,fz). */
  die(t, fromX, fromZ, { holy = false } = {}) {
    const away = Math.atan2(this.pos.x - fromX, this.pos.z - fromZ);
    const side = hashf(this.seed + 3) > 0.5 ? 1 : -1;
    this.death = {
      t0: t,
      // Direction the body topples toward (world yaw).
      dir: Number.isFinite(away) ? away + side * (0.3 + hashf(this.seed + 5) * 0.5) : this.yaw + Math.PI,
      holy,
      sim: null,
      simT: 0,
      side,
    };
    this.state = 'dead';
    this.action = null;
  }

  /** Instantly lie dead (for combatants already down when the scene starts). */
  lieDead(t) {
    this.die(t - 10, this.pos.x - Math.sin(this.yaw), this.pos.z - Math.cos(this.yaw));
  }

  setState(s) {
    this.state = s;
  }

  /** Back on their feet (healed from unconsciousness): rise from the ground. */
  revive(t) {
    if (!this.death) return;
    this.death = null;
    this.state = 'idle';
    this.play('kneel', t - 0.35, 1.1);
  }

  /** Impact moment of the current attack clip (absolute time). */
  static impactFrac(type) {
    return type === 'shoot' ? 0.62 : type === 'cast' ? 0.55 : type === 'bite' ? 0.45 : 0.46;
  }

  // ------------------------------------------------------------------ update
  update(t) {
    const P = {}; // bone -> [x,y,z] euler offsets
    const rootOff = new THREE.Vector3();
    let bob = 0;
    let yaw = this.currentYaw(t);
    // Walking translation.
    let walking = 0;
    let walkPhase = 0;
    if (this.walk) {
      const w = this.walk;
      if (t >= w.t1) {
        const last = w.segs[w.segs.length - 1];
        this.pos.set(last.b.x, 0, last.b.z);
        this.yawFrom = this.yawTo = last.yaw;
        this.yawStart = -99;
        yaw = last.yaw;
        this.walk = null;
      } else if (t >= w.t0) {
        const seg = w.segs.find((sg) => t < sg.t1) ?? w.segs[w.segs.length - 1];
        const u = clamp01((t - seg.t0) / (seg.t1 - seg.t0));
        this.pos.set(lerp(seg.a.x, seg.b.x, u), 0, lerp(seg.a.z, seg.b.z, u));
        yaw = angLerp(this.currentYaw(t), seg.yaw, clamp01((t - seg.t0) / 0.12));
        this.yawFrom = this.yawTo = seg.yaw;
        walking = 1;
        walkPhase = ((t - w.t0) / (seg.t1 - seg.t0)) * Math.PI;
      }
    }
    const idleT = t + this.phase;
    if (this.rig === 'biped') this._biped(P, t, idleT, walking, walkPhase, rootOff);
    else if (this.rig === 'quad') this._quad(P, t, idleT, walking, walkPhase, rootOff);
    else this._spider(P, t, idleT, walking, walkPhase, rootOff);

    // Apply bone rotations.
    for (const [k, bone] of Object.entries(this.b)) {
      const r = P[k];
      if (r) bone.rotation.set(r[0], r[1], r[2]);
      else bone.rotation.set(0, 0, 0);
      const rest = this.rest[k];
      if (P[`${k}@`]) bone.position.set(rest.x + P[`${k}@`][0], rest.y + P[`${k}@`][1], rest.z + P[`${k}@`][2]);
      else bone.position.copy(rest);
    }

    // Root transform (with death topple).
    this.root.position.copy(this.pos);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const off = rootOff.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.root.position.add(off);
    if (this.death) {
      const d = this._deathSim(t);
      const axisYaw = this.death.dir;
      const axis = new THREE.Vector3(Math.cos(axisYaw), 0, -Math.sin(axisYaw));
      const qt = new THREE.Quaternion().setFromAxisAngle(axis, d.theta);
      q.premultiply(qt);
      this.root.position.y += Math.sin(d.theta) * 0.1 * this.s;
    }
    this.root.quaternion.copy(q);
    this.yaw = yaw;
    void bob;

    // Hit flash & death dimming.
    const fAge = t - this.hitFlash;
    // (A hit queued for the future must not flash yet — negative age.)
    const flash = fAge < 0 ? 0 : Math.max(0, 1 - fAge / 0.16) ** 2;
    const deadDim = this.death ? clamp01((t - this.death.t0 - 1.2) / 2.5) : 0;
    const holy = this.death?.holy ? clamp01((t - this.death.t0) / 0.6) : 0;
    for (const mm of this.mats) {
      if (mm.m.emissive) {
        mm.m.emissive.copy(mm.emissive).lerp(new THREE.Color(1, 0.5, 0.35), flash * 0.4);
        if (holy) mm.m.emissive.lerp(new THREE.Color(1, 0.9, 0.6), Math.sin(holy * Math.PI) * 0.9);
        mm.m.emissiveIntensity = Math.max(mm.ei, flash * 0.4);
      }
      mm.m.color.copy(mm.color).multiplyScalar(1 - deadDim * 0.35);
    }
  }

  /** Attack-clip envelope helpers. */
  _act(t) {
    const a = this.action;
    if (!a) return null;
    const u = (t - a.t0) / a.dur;
    if (u < 0) return null;
    if (u >= 1) {
      this.action = null;
      return null;
    }
    return { a, u };
  }

  _biped(P, t, it, walking, wph, rootOff) {
    const s = this.s;
    const m = this.model;
    const hunch = m.hunch ?? 0;
    const breathe = Math.sin(it * 1.9);
    const dead = this.death;
    const set = (k, x = 0, y = 0, z = 0) => { P[k] = [x, y, z]; };
    const add = (k, x = 0, y = 0, z = 0) => {
      const p = P[k] ?? [0, 0, 0];
      P[k] = [p[0] + x, p[1] + y, p[2] + z];
    };
    const sleeping = this.state === 'asleep' || this.state === 'held' && false;
    // --- Base combat stance.
    const hasShield = !!m.kit?.shield;
    const w = m.weapon;
    set('hips', 0, Math.sin(it * 0.7) * 0.03, Math.sin(it * 0.9) * 0.015);
    P['hips@'] = [0, -0.015 * s + breathe * 0.006 * s, 0];
    set('spine', 0.06 + hunch * 0.5, 0.18, 0);
    set('chest', 0.03 + hunch * 0.35 + breathe * 0.025, 0.08, 0);
    set('neck', -hunch * 0.55 - 0.05, -0.22 + Math.sin(it * 0.43) * 0.12, 0);
    set('head', -hunch * 0.35 + Math.sin(it * 0.61) * 0.04, Math.sin(it * 0.37) * 0.1, 0);
    // Legs: staggered, knees soft.
    set('thighL', -0.32, 0.12, 0.08);
    set('shinL', 0.42);
    set('footL', -0.1);
    set('thighR', 0.14, -0.2, -0.08);
    set('shinR', 0.32);
    set('footR', -0.46);
    // Arms.
    if (m.armsForward) {
      set('upperArmL', -1.35 + Math.sin(it * 1.3) * 0.08, 0, 0.12);
      set('foreArmL', -0.25);
      set('upperArmR', -1.3 + Math.sin(it * 1.1 + 1) * 0.08, 0, -0.12);
      set('foreArmR', -0.3);
    } else {
      if (w === 'staff' || w === 'spear') {
        set('upperArmR', -0.15, 0, -0.18);
        set('foreArmR', -1.3);
        set('handR', 0.05, 0, 0);
      } else if (w === 'fists' || !w) {
        set('upperArmR', -0.5, 0, -0.2);
        set('foreArmR', -1.5);
        set('handR', 0, 0, 0);
      } else {
        set('upperArmR', -0.5 + breathe * 0.02, 0.2, -0.25);
        set('foreArmR', -1.25);
        set('handR', 0.25, 0, 0.2);
      }
      if (hasShield) {
        set('upperArmL', -0.55, -0.35, 0.25);
        set('foreArmL', -1.35, 0, 0);
        set('handL', 0, -0.45, 0.1);
      } else if (m.kit?.mage) {
        set('upperArmL', -0.35, 0, 0.2);
        set('foreArmL', -1.0);
        set('handL', 0.2, 0, 0.3);
      } else {
        set('upperArmL', -0.2, 0, 0.18);
        set('foreArmL', -0.7);
      }
    }
    if (this.guard) {
      add('upperArmL', -0.25, -0.1, 0);
      add('spine', 0.08, 0, 0);
      P['hips@'][1] -= 0.04 * s;
      add('thighL', -0.15);
      add('shinL', 0.3);
      add('thighR', -0.1);
      add('shinR', 0.25);
    }
    // Cape & tail.
    if (m.hasCape) {
      const sway = Math.sin(it * 1.3) * 0.05 + walking * 0.3;
      set('capeA', 0.18 + sway, 0, Math.sin(it * 0.8) * 0.03);
      set('capeB', 0.06 + sway * 0.5 + Math.sin(it * 1.7) * 0.03, 0, 0);
      set('capeC', 0.04 + sway * 0.3 + Math.sin(it * 2.1 + 1) * 0.04, 0, 0);
    }
    if (m.hasTail) {
      set('tail1', -0.35, Math.sin(it * 1.2) * 0.35, 0);
      set('tail2', -0.2, Math.sin(it * 1.2 - 0.8) * 0.35, 0);
      set('tail3', -0.1, Math.sin(it * 1.2 - 1.6) * 0.45, 0);
    }
    // --- Walking cycle.
    if (walking) {
      const sw = Math.sin(wph);
      const sw2 = Math.sin(wph + Math.PI);
      set('thighL', -0.1 - sw * 0.6, 0, 0.04);
      set('thighR', -0.1 - sw2 * 0.6, 0, -0.04);
      set('shinL', 0.2 + Math.max(0, Math.cos(wph)) * 0.9);
      set('shinR', 0.2 + Math.max(0, Math.cos(wph + Math.PI)) * 0.9);
      set('footL', -0.1 + sw * 0.2);
      set('footR', -0.1 + sw2 * 0.2);
      P['hips@'][1] += (Math.abs(Math.cos(wph)) - 0.7) * 0.05 * s;
      add('hips', 0, sw * 0.12, 0);
      add('spine', 0.08, -sw * 0.1, 0);
      if (!hasShield && !m.armsForward) add('upperArmL', sw * 0.45);
      if (!m.armsForward) add('upperArmR', sw2 * 0.2);
    }
    // --- Actions.
    const act = this._act(t);
    if (act && !dead) {
      const { a, u } = act;
      if (a.type === 'attack') {
        const thrust = w === 'spear' || w === 'dagger' || w === 'shortSword' && hashf(this.seed + a.t0) > 0.5;
        const claws = !w || w === 'fists';
        // 0..0.38 wind-up, 0.38..0.52 strike, 0.52..1 recover.
        const up = ease(clamp01(u / 0.38));
        const strike = easeIn(clamp01((u - 0.38) / 0.12));
        const rec = ease(clamp01((u - 0.55) / 0.45));
        const k = up * (1 - strike);
        const s2 = strike * (1 - rec);
        if (thrust) {
          add('upperArmR', -0.4 * k - 1.0 * s2, 0.5 * k - 0.3 * s2, 0.2 * k);
          add('foreArmR', -0.6 * k + 1.2 * s2);
          add('spine', 0, 0.45 * k - 0.6 * s2, 0);
        } else if (claws) {
          add('upperArmR', -1.9 * k + 1.2 * s2, 0, -0.4 * k);
          add('upperArmL', -1.9 * k + 1.2 * s2, 0, 0.4 * k);
          add('foreArmR', -0.4 * k + 0.9 * s2);
          add('foreArmL', -0.4 * k + 0.9 * s2);
          add('spine', -0.25 * k + 0.5 * s2);
        } else {
          add('upperArmR', -2.3 * k + 0.35 * s2, 0.3 * k - 0.3 * s2, -0.35 * k + 0.2 * s2);
          add('foreArmR', -0.5 * k + 1.15 * s2);
          add('handR', 0.2 * k - 0.35 * s2);
          add('spine', -0.2 * k + 0.35 * s2, 0.5 * k - 0.55 * s2, 0);
          add('chest', -0.1 * k + 0.2 * s2, 0.2 * k - 0.25 * s2, 0);
        }
        add('neck', 0, 0.25 * k - 0.1 * s2, 0);
        // Lunge toward the target.
        const lunge = Math.sin(clamp01((u - 0.3) / 0.5) * Math.PI) * (a.reach ?? 0.35) * s;
        rootOff.z += lunge;
        add('thighL', -0.4 * s2);
        add('shinL', 0.3 * s2);
        add('thighR', 0.25 * s2);
      } else if (a.type === 'shoot') {
        const draw = ease(clamp01(u / 0.5));
        const rel = clamp01((u - 0.62) / 0.1);
        const rec = ease(clamp01((u - 0.72) / 0.28));
        const k = draw * (1 - rec);
        add('upperArmL', (-1.45 - (P.upperArmL?.[0] ?? 0)) * k, (0.35 - (P.upperArmL?.[1] ?? 0)) * k, (0.05 - (P.upperArmL?.[2] ?? 0)) * k);
        add('foreArmL', (-0.05 - (P.foreArmL?.[0] ?? 0)) * k);
        add('upperArmR', (-1.5 - (P.upperArmR?.[0] ?? 0)) * k, (-0.5 - (P.upperArmR?.[1] ?? 0)) * k, 0);
        add('foreArmR', (-2.2 - (P.foreArmR?.[0] ?? 0)) * k * (1 - rel * 0.4));
        add('spine', 0, 0.5 * k, 0);
        add('neck', 0, -0.4 * k, 0);
      } else if (a.type === 'cast') {
        const up = ease(clamp01(u / 0.45));
        const push = ease(clamp01((u - 0.45) / 0.12));
        const rec = ease(clamp01((u - 0.7) / 0.3));
        const k = up * (1 - rec);
        const p2 = push * (1 - rec);
        for (const [side, sx] of [['L', 1], ['R', -1]]) {
          const ua = P[`upperArm${side}`] ?? [0, 0, 0];
          const fa = P[`foreArm${side}`] ?? [0, 0, 0];
          add(`upperArm${side}`, (-2.4 - ua[0]) * k + 0.9 * p2, (0 - ua[1]) * k, (sx * 0.45 - ua[2]) * k - sx * 0.3 * p2);
          add(`foreArm${side}`, (-0.5 - fa[0]) * k + 0.4 * p2);
        }
        add('spine', -0.2 * k + 0.3 * p2);
        add('neck', -0.25 * k + 0.2 * p2);
        P['hips@'][1] -= 0.03 * s * k;
      } else if (a.type === 'hit') {
        // Hit react: an instant snap back (within ~1/30 s), a damped wobble and a
        // stagger step away from the blow that recovers by the end of the clip.
        const pw = a.power ?? 1;
        const tt = u * a.dur;
        const side = hashf(this.seed + a.t0 * 7) > 0.5 ? 1 : -1;
        const snap = 1 - Math.exp(-tt * 45);
        const kick = pw * snap * Math.exp(-tt * 4.5) * (0.78 + 0.22 * Math.cos(tt * 16));
        const step = Math.min(1.4, pw) * easeOut(clamp01(tt / 0.22)) * (1 - ease(clamp01((u - 0.55) / 0.45)));
        add('spine', -0.42 * kick, 0.22 * kick * side, 0.12 * kick * side);
        add('chest', -0.26 * kick, 0.1 * kick * side);
        add('neck', -0.45 * kick, 0.35 * kick * side);
        add('head', -0.2 * kick, 0.15 * kick * side);
        add('upperArmL', 0.45 * kick, 0, 0.45 * kick);
        add('upperArmR', 0.45 * kick, 0, -0.45 * kick);
        add('foreArmL', -0.3 * kick);
        add('foreArmR', -0.3 * kick);
        add('thighR', 0.4 * step);
        add('shinR', 0.45 * step);
        add('thighL', -0.15 * step);
        rootOff.z -= 0.26 * s * step + 0.06 * s * kick;
        P['hips@'][1] -= 0.05 * s * (kick * 0.6 + step * 0.4);
      } else if (a.type === 'turn') {
        // Holy symbol raised high.
        const k = ease(clamp01(u / 0.3)) * (1 - ease(clamp01((u - 0.75) / 0.25)));
        add('upperArmL', (-2.7 - (P.upperArmL?.[0] ?? 0)) * k, 0, (0.1 - (P.upperArmL?.[2] ?? 0)) * k);
        add('foreArmL', (-0.2 - (P.foreArmL?.[0] ?? 0)) * k);
        add('spine', -0.15 * k);
        add('neck', -0.3 * k);
      } else if (a.type === 'kneel') {
        const k = ease(clamp01(u / 0.25)) * (1 - ease(clamp01((u - 0.8) / 0.2)));
        P['hips@'][1] -= 0.38 * s * k;
        add('thighL', -1.3 * k);
        add('shinL', 1.5 * k);
        add('thighR', 0.2 * k);
        add('shinR', 1.9 * k);
        add('spine', 0.5 * k);
        add('upperArmL', -0.9 * k);
        add('upperArmR', -0.9 * k);
        add('foreArmL', Math.sin(u * 30) * 0.2 * k);
      } else if (a.type === 'cheer') {
        const k = Math.sin(clamp01(u) * Math.PI);
        add('upperArmR', -2.2 * k);
        add('foreArmR', 0.8 * k);
        rootOff.y += Math.abs(Math.sin(u * Math.PI * 2)) * 0.08 * k;
      }
    }
    // --- Asleep / held.
    if (this.state === 'asleep' && !dead) {
      P['hips@'][1] -= 0.45 * s;
      set('thighL', -1.5, 0, 0.2);
      set('shinL', 2.2);
      set('thighR', -1.4, 0, -0.2);
      set('shinR', 2.2);
      set('footL', -0.6);
      set('footR', -0.6);
      set('spine', 0.55 + breathe * 0.04);
      set('chest', 0.25);
      set('neck', 0.5);
      set('head', 0.3, 0.3, 0.2);
      set('upperArmL', 0.1, 0, 0.1);
      set('upperArmR', 0.1, 0, -0.1);
      set('foreArmL', -0.3);
      set('foreArmR', -0.3);
    }
    // --- Death collapse.
    if (dead) {
      const d = this._deathSim(t);
      const k = d.crumple;
      P['hips@'][1] -= d.drop * s;
      set('thighL', -1.1 * k * (1 - d.lie), 0, 0.15 + d.lie * 0.2);
      set('thighR', -0.8 * k * (1 - d.lie), 0, -0.12 - d.lie * 0.25);
      set('shinL', 1.4 * k * (1 - d.lie) + d.lie * 0.3);
      set('shinR', 1.2 * k * (1 - d.lie) + d.lie * 0.5);
      set('spine', 0.4 * k * (1 - d.lie) - d.lie * 0.1, 0, d.lie * 0.15 * this.death.side);
      set('chest', 0.2 * k * (1 - d.lie));
      set('neck', 0.3 * (1 - d.lie) + d.lie * 0.1, d.lie * 0.6 * this.death.side, 0);
      set('head', 0, d.lie * 0.3 * this.death.side, 0);
      set('upperArmL', -0.4 * (1 - d.lie) - d.armL * 0.5 - d.lie * 0.4, 0, 0.3 + d.lie * 1.1 + d.armL * 0.4);
      set('upperArmR', -0.4 * (1 - d.lie) - d.armR * 0.5 - d.lie * 0.2, 0, -0.3 - d.lie * 0.9 - d.armR * 0.4);
      set('foreArmL', -0.3 - d.lie * 0.4);
      set('foreArmR', -0.5 - d.lie * 0.2);
      set('handR', 0, 0, 0);
      set('handL', 0, 0, 0);
      if (m.hasCape) {
        set('capeA', 0.1 + d.lie * 0.6);
        set('capeB', d.lie * 0.2);
        set('capeC', 0);
      }
    }
  }

  _quad(P, t, it, walking, wph, rootOff) {
    const s = this.s;
    const set = (k, x = 0, y = 0, z = 0) => { P[k] = [x, y, z]; };
    const breathe = Math.sin(it * 3.1);
    set('body', 0, 0, 0);
    P['body@'] = [0, breathe * 0.004 * s, 0];
    set('chest', 0.05, 0, 0);
    set('head', -0.1 + Math.sin(it * 2.3) * 0.08, Math.sin(it * 1.1) * 0.25, 0);
    set('tail1', 0.1, Math.sin(it * 1.4) * 0.4, 0);
    set('tail2', 0.05, Math.sin(it * 1.4 - 0.9) * 0.5, 0);
    set('tail3', 0.02, Math.sin(it * 1.4 - 1.8) * 0.6, 0);
    for (const n of ['FL', 'FR', 'BL', 'BR']) {
      set(`leg${n}`, n[0] === 'F' ? 0.25 : -0.35);
      set(`knee${n}`, n[0] === 'F' ? -0.35 : 0.5);
    }
    if (walking) {
      const g = { FL: 0, BR: 0, FR: Math.PI, BL: Math.PI };
      for (const n of Object.keys(g)) {
        const ph = wph * 2 + g[n];
        P[`leg${n}`][0] += Math.sin(ph) * 0.6;
        P[`knee${n}`][0] += Math.max(0, Math.cos(ph)) * (n[0] === 'F' ? -0.6 : 0.6);
      }
      P['body@'][1] += Math.abs(Math.sin(wph * 2)) * 0.02 * s;
      P.tail1[1] += Math.sin(wph * 2) * 0.3;
    }
    const act = this._act(t);
    if (act && !this.death) {
      const { a, u } = act;
      if (a.type === 'attack' || a.type === 'bite') {
        const up = ease(clamp01(u / 0.35));
        const strike = easeIn(clamp01((u - 0.35) / 0.12));
        const rec = ease(clamp01((u - 0.5) / 0.5));
        const k = up * (1 - strike);
        const s2 = strike * (1 - rec);
        P.chest[0] -= 0.35 * k - 0.2 * s2;
        P.head[0] -= 0.4 * k - 0.6 * s2;
        rootOff.z += Math.sin(clamp01((u - 0.25) / 0.55) * Math.PI) * 0.4 * s;
        P['body@'][1] += 0.06 * s * s2;
      } else if (a.type === 'hit') {
        const e = Math.sin(clamp01(u) * Math.PI);
        rootOff.z -= 0.12 * e * s;
        P.head[0] -= 0.4 * e;
      }
    }
    if (this.state === 'asleep' && !this.death) {
      P['body@'][1] -= 0.12 * s;
      for (const n of ['FL', 'FR', 'BL', 'BR']) P[`knee${n}`][0] *= 2.5;
      P.head[0] = 0.5;
    }
    if (this.death) {
      const d = this._deathSim(t);
      for (const n of ['FL', 'FR', 'BL', 'BR']) {
        P[`leg${n}`][0] += d.lie * (n[0] === 'F' ? 0.8 : -0.8) + Math.sin(t * 25 + n.length) * 0.3 * d.twitch;
        P[`knee${n}`][0] += d.lie * 0.4;
      }
      P.head[0] = 0.2 * d.lie;
      P['body@'][1] -= 0.14 * s * d.lie;
    }
  }

  _spider(P, t, it, walking, wph, rootOff) {
    const set = (k, x = 0, y = 0, z = 0) => { P[k] = [x, y, z]; };
    set('body', 0, 0, 0);
    set('head', Math.sin(it * 2) * 0.05, 0, 0);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? 1 : -1;
      const ph = wph * 2 + (i % 2) * Math.PI + (i >= 4 ? Math.PI / 2 : 0);
      set(`leg${i}`, 0, walking ? Math.sin(ph) * 0.3 : Math.sin(it * 2 + i) * 0.03, walking ? side * Math.max(0, Math.cos(ph)) * 0.25 : 0);
      set(`knee${i}`, 0, 0, 0);
    }
    const act = this._act(t);
    if (act && !this.death && act.a.type !== 'hit') rootOff.z += Math.sin(clamp01(act.u) * Math.PI) * 0.4;
    if (this.death) {
      const d = this._deathSim(t);
      for (let i = 0; i < 8; i++) {
        const side = i < 4 ? 1 : -1;
        P[`leg${i}`][2] -= side * d.lie * 1.2;
      }
    }
  }

  /**
   * Ragdoll-lite: a toppling rigid body (pendulum about the feet) with knee
   * buckle, ground bounce and flailing arms, integrated at a fixed 120 Hz
   * from the moment of death. Returns the state at time t.
   */
  _deathSim(t) {
    const D = this.death;
    const age = Math.max(0, t - D.t0);
    if (!D.sim || age < D.simT) {
      D.sim = { theta: 0.02, omega: 0.9 + hashf(this.seed + 9) * 0.8, drop: 0, dropV: 0, armL: 0, armLV: 3 + hashf(this.seed) * 3, armR: 0, armRV: -2 - hashf(this.seed + 1) * 3, bounced: 0 };
      D.simT = 0;
    }
    const S = D.sim;
    const quad = this.rig !== 'biped';
    const h = 1 / 120;
    const L = quad ? 0.25 : 1.0 * this.s;
    const maxTheta = quad ? Math.PI / 2 : Math.PI / 2 - 0.06;
    while (D.simT + h <= age) {
      D.simT += h;
      // Knees buckle first (0-0.25 s), then the body topples.
      const buckle = D.simT < 0.25 ? 1 : 0.3;
      const targetDrop = quad ? 0 : 0.28 * (1 - Math.min(1, S.theta / maxTheta) * 0.6);
      S.dropV += ((targetDrop - S.drop) * 90 - S.dropV * 12) * h * buckle;
      S.drop += S.dropV * h;
      const g = D.simT < 0.12 ? 0 : (9.81 / L) * Math.sin(S.theta + 0.15);
      S.omega += g * h;
      S.theta += S.omega * h;
      if (S.theta >= maxTheta) {
        S.theta = maxTheta;
        if (S.omega > 0.4 && S.bounced < 3) {
          S.omega = -S.omega * 0.28;
          S.bounced++;
        } else S.omega = 0;
      }
      // Arms: damped springs kicked by the impact and by the landing.
      for (const k of ['armL', 'armR']) {
        const vk = `${k}V`;
        S[vk] += (-(S[k]) * 60 - S[vk] * 6) * h;
        S[k] += S[vk] * h;
      }
    }
    const lie = Math.min(1, S.theta / maxTheta);
    return {
      theta: S.theta,
      drop: S.drop,
      crumple: Math.min(1, age / 0.25),
      lie,
      armL: S.armL,
      armR: S.armR,
      twitch: Math.max(0, 1 - age / 1.2),
    };
  }

  /** World position of a bone (for effects anchoring). */
  bonePos(name, out = new THREE.Vector3()) {
    const b = this.b[name];
    if (!b) return out.copy(this.root.position).setY(this.model.height * 0.6);
    this.root.updateMatrixWorld(true);
    return b.getWorldPosition(out);
  }

  dispose() {
    for (const mesh of this.model.meshes) {
      if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
