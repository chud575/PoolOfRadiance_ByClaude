import * as THREE from 'three';
import { DIR8, Battlefield } from './logic/battlefield.js';
import { TILE } from './view/terrain.js';

/**
 * Staged, deterministic combat moments for the screenshot gallery (?demo=...).
 * Every clip/VFX is keyed to absolute scene time 0, so ?t= picks the frame.
 *   fireball — a mage's fireball detonating among the foes (t≈0.9 mid-explosion)
 *   melee    — the fighter's blow landing, the line engaged (t≈0.42 at impact)
 */
const sq2w = (x, y) => new THREE.Vector3(x * TILE + TILE / 2, 0, y * TILE + TILE / 2);

function moveTo(sc, c, x, y) {
  c.x = x;
  c.y = y;
  const p = sq2w(x, y);
  const f = sc.figures.get(c.id);
  f.place(p.x, p.z, f.yaw);
}

function face(sc, c, t, time = -5) {
  const f = sc.figures.get(c.id);
  const yaw = Math.atan2(t.x - c.x, t.y - c.y);
  f.place(f.pos.x, f.pos.z, yaw);
  const dx = Math.sign(t.x - c.x);
  const dy = Math.sign(t.y - c.y);
  const d = DIR8.findIndex(([a, b]) => a === dx && b === dy);
  if (d >= 0) c.facing = d;
  void time;
}

/** Free square adjacent to target, nearest to `from`. */
function adjacentFree(sc, target, from, taken = new Set()) {
  let best = null;
  for (const [dx, dy] of DIR8) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (!sc.field.isFree(x, y) || taken.has(`${x},${y}`)) continue;
    if (sc.engine.occupantAt(x, y)) continue;
    if (!sc.engine.adjacent({ x, y }, target, x, y)) continue;
    const d = Battlefield.dist(x, y, from.x, from.y) + (dx && dy ? 0.3 : 0);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
}

function setActive(sc, c) {
  sc.demoActive = c;
  sc.engine.turnIdx = sc.engine.order.indexOf(c);
  c.mp = c.move;
  c.attacksLeft = c.attacks.length;
  sc.cur = c;
  sc.turnDone = () => {};
  sc.busy = false;
}

function kill(sc, c, t, from) {
  sc._decal(sc.figures.get(c.id).root.position, 'blood', c.size === 'L' ? 1.6 : 1.2);
  c.hp.cur = Math.min(0, c.hp.cur);
  if (c.side === 'monster') c.status = 'dead';
  const f = sc.figures.get(c.id);
  f.die(t, from.x, from.z);
  sc.overlay.teamRing(c.id, c.side).visible = false;
  f.blob.visible = false;
  if (f.eyeGlow) f.eyeGlow.visible = false;
}

export const DEMOS = {
  /** Debug line-up of every figure for model review (?demo=lineup&monsters=...). */
  lineup: {
    async stage(sc) {
      const all = [...sc.party, ...sc.monsters];
      const y0 = Math.floor(sc.field.h / 2);
      all.forEach((c, i) => {
        const row = i < sc.party.length ? 0 : 1;
        const col = i < sc.party.length ? i : i - sc.party.length;
        moveTo(sc, c, 2 + col * 2, y0 - 2 + row * 3);
        const f = sc.figures.get(c.id);
        f.place(f.pos.x, f.pos.z, 0);
        c.facing = 4;
      });
      // Model review: plain studio floor, no buildings in the way.
      sc.diorama.group.visible = false;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5550, roughness: 0.9 }));
      floor.position.set(sc.field.w * TILE / 2, -0.002, sc.field.h * TILE / 2);
      floor.receiveShadow = true;
      sc.scene3d.add(floor);
      sc.overlay.group.visible = false;
      // &only=monsters: hide the party row and frame just the monsters.
      if (sc.params.only === 'monsters') {
        for (const c of sc.party) sc.figures.get(c.id).root.visible = false;
        sc.monsters.forEach((c, i) => {
          moveTo(sc, c, 2 + i * 2, y0 - 2);
          const f = sc.figures.get(c.id);
          f.place(f.pos.x, f.pos.z, 0);
        });
      }
      const n = sc.params.only === 'monsters' ? sc.monsters.length : Math.max(sc.party.length, sc.monsters.length);
      const cx = sc.params.only === 'monsters' ? sc.monsters.reduce((a, c) => a + c.x, 0) / Math.max(1, sc.monsters.length) * TILE : (2 + (n - 1)) * TILE;
      const pitch = Number.isFinite(+sc.params.pitch) && sc.params.pitch !== undefined ? +sc.params.pitch : 0.42;
      const mz = all.reduce((a, c) => a + c.y, 0) / Math.max(1, all.length);
      sc.cam.goalTarget.set(cx + TILE / 2 + (Number(sc.params.tx) || 0), Number(sc.params.ty) || 0, (mz + 0.5) * TILE);
      sc.camera.clearViewOffset();
      sc._applyViewOffset = () => {};
      sc.cam.target.copy(sc.cam.goalTarget);
      sc.cam.goalDist = sc.cam.dist = Number.isFinite(+sc.params.dist) && sc.params.dist !== undefined ? +sc.params.dist : 4 + n * 2.4;
      sc.cam.goalPitch = sc.cam.pitch = pitch;
      sc.cam.goalYaw = sc.cam.yaw = Number.isFinite(+sc.params.yaw) && sc.params.yaw !== undefined ? +sc.params.yaw : 0;
      sc.demoActive = sc.party[0];
      sc.cam.userPanned = true;
    },
  },

  fireball: {
    async stage(sc) {
      const e = sc.engine;
      const caster = sc.party.find((c) => c.ref.levels.magicUser && !c.ref.levels.fighter) ?? sc.party.find((c) => c.ref.levels.magicUser) ?? sc.party[0];
      const foes = sc.monsters;
      // Target the densest foe.
      let best = foes[0];
      let bestN = -1;
      for (const m of foes) {
        const n = foes.filter((o) => Battlefield.dist(o.x, o.y, m.x, m.y) <= 2).length;
        if (n > bestN) {
          bestN = n;
          best = m;
        }
      }
      // Put the caster at a comfortable range with line of sight, the party screening in front.
      const fl = sc.field.flood(best.x, best.y, () => false, 40);
      let spot = null;
      for (let y = 0; y < sc.field.h; y++) {
        for (let x = 0; x < sc.field.w; x++) {
          const cst = fl.cost[sc.field.idx(x, y)];
          if (!Number.isFinite(cst) || !sc.field.isFree(x, y) || e.occupantAt(x, y)) continue;
          const d = Battlefield.dist(x, y, best.x, best.y);
          if (d < 5 || d > 7 || !sc.field.los(x, y, best.x, best.y)) continue;
          const partyD = Math.min(...sc.party.map((p) => Battlefield.dist(p.x, p.y, x, y)));
          const sc2 = -Math.abs(d - 6) - partyD * 0.5;
          if (!spot || sc2 > spot.s) spot = { x, y, s: sc2 };
        }
      }
      if (spot) moveTo(sc, caster, spot.x, spot.y);
      face(sc, caster, best);
      for (const m of foes) face(sc, m, caster);
      for (const p of sc.party) if (p !== caster) face(sc, p, best);
      setActive(sc, caster);
      sc.mode = 'target';
      sc.modeData = { spell: 'fireball', label: 'Fireball' };
      // Timing: whatever the range, the gallery frame (t=0.75) lands ~0.17 s after
      // detonation — the money frame: white-hot heart, billowing shell, shockwave out.
      const f = sc.figures.get(caster.id);
      const centre = sq2w(best.x, best.y).setY(0.9);
      f.play('cast', -10, 1.15);
      f.update(0);
      const flight = Math.max(0.35, f.bonePos('handR').distanceTo(centre) / 16);
      const launch = 0.75 - 0.17 - flight;
      f.play('cast', launch - 0.62, 1.15);
      f.update(launch);
      const hand = f.bonePos('handR').clone();
      const R = 2.5 * TILE;
      sc.vfx.castGlow(launch - 0.7, () => f.bonePos('handR').clone(), 0xff8030, 0.85);
      const det = sc.vfx.fireball(launch, hand, centre, R, 3.7);
      const detonate = launch + det.detonate;
      // Victims.
      const hitList = foes.filter((m) => Math.hypot(m.x - best.x, m.y - best.y) <= 2.5);
      const dmg = [17, 21, 9, 19, 14, 22];
      sc.ctx.ui.message(`${caster.name} casts Fireball!`, 'combat');
      hitList.forEach((m, k) => {
        const fm = sc.figures.get(m.id);
        const d = dmg[k % dmg.length];
        fm.play('hit', detonate + 0.02, 0.6, { power: 1.8 });
        fm.burn(detonate + 0.01);
        fm.knock(detonate + 0.01, fm.pos.x - centre.x, fm.pos.z - centre.z, 0.5);
        sc.vfx.bodyFire(detonate + 0.01, () => fm.root.position, fm.model.height, 11 + k * 7);
        // Each number rides its victim's head, fire-coloured, with a name plate + hp tick.
        const hp0 = m.hp.cur;
        sc._say(fm, String(d), 'dmg', detonate + 0.08 + k * 0.05, { cls: 'fire', tag: { name: m.name, hp: Math.max(0, hp0 - d) / m.hp.max, lost: Math.min(hp0, d) / m.hp.max } });
        // Results land with the blast, not before it.
        sc.at(detonate + 0.02, () => {
          m.hp.cur -= d;
          if (m.hp.cur <= 0) kill(sc, m, detonate + 0.03 + k * 0.02, centre);
        });
      });
      sc.at(detonate + 0.05, () => {
        // One line per outcome, naming every victim (the same names the floaters carry).
        const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
        const slain = hitList.filter((m) => m.hp.cur <= 0).map((m) => m.name);
        const hurt = hitList.filter((m) => m.hp.cur > 0).map((m) => m.name);
        sc.ctx.ui.message(`The fireball engulfs ${hitList.length} foes.`, 'combat');
        if (slain.length) sc.ctx.ui.message(`Slain: ${list(slain)}.`, 'combat');
        if (hurt.length) sc.ctx.ui.message(`Scorched: ${list(hurt)}.`, 'combat');
      });
      sc.overlay.setTemplate([]);
      // Camera: frame caster and blast, slightly closer.
      const mid = sq2w(caster.x + (best.x - caster.x) * 0.6, caster.y + (best.y - caster.y) * 0.6);
      sc.cam.goalTarget.copy(mid);
      sc.cam.target.copy(mid);
      const span = Math.hypot(caster.x - best.x, caster.y - best.y) * TILE;
      sc.cam.goalDist = sc.cam.dist = Math.max(14.5, span * 1.9);
      // A lower 3/4 view so the blast's height (tongues, rising core, smoke cap)
      // reads, from the bearing with the fewest buildings in the way.
      sc.cam.goalPitch = sc.cam.pitch = Number.isFinite(+sc.params.pitch) && sc.params.pitch !== undefined ? +sc.params.pitch : 0.66;
      if (Number.isFinite(+sc.params.yaw) && sc.params.yaw !== undefined) sc.cam.goalYaw = +sc.params.yaw;
      else sc._chooseYaw({ around: [caster, best] });
      sc.cam.yaw = sc.cam.goalYaw;
      sc._refresh(caster);
    },
  },

  /** Area spells for review: a stinking cloud over one knot of foes, sleep settling on others (t≈1.2). */
  cloud: {
    async stage(sc) {
      const foes = sc.monsters;
      const caster = sc.party.find((c) => c.ref.levels.magicUser) ?? sc.party[0];
      setActive(sc, caster);
      const a = foes[0];
      const b = foes.slice().sort((p, q) => Battlefield.dist(q.x, q.y, a.x, a.y) - Battlefield.dist(p.x, p.y, a.x, a.y))[0];
      const ca = sq2w(a.x + 0.5, a.y + 0.5);
      sc.vfx.stinkingCloud(-4, ca, 2 * TILE, 'demo-cloud', 2.3, { night: sc.night });
      const cb = sq2w(b.x, b.y);
      sc.vfx.sleepCloud(0, cb, 3 * TILE, 4.1);
      for (const m of foes) {
        if (Battlefield.dist(m.x, m.y, b.x, b.y) <= 1 && m !== a) {
          m.fx.asleep = 3;
          const f = sc.figures.get(m.id);
          f.setState('asleep');
          sc.vfx.sleepZ(0.6, () => sc._headPos(f), `z-${m.id}`, m.x + m.y);
        }
      }
      const mid = ca.clone().lerp(cb, 0.5);
      sc.cam.goalTarget.copy(mid);
      sc.cam.target.copy(mid);
      sc.cam.goalDist = sc.cam.dist = 12;
      sc.cam.goalPitch = sc.cam.pitch = 0.74;
      // Shoot from the party's side, over the caster's shoulder, so the
      // kobolds in the cloud face the lens.
      const cp = sq2w(caster.x, caster.y);
      sc.cam.goalYaw = sc.cam.yaw = Math.atan2(cp.x - mid.x, cp.z - mid.z) + 0.5;
      sc._refresh(caster);
    },
  },

  /** Spell targeting for review: Magic Missile aimed (Tab) at the nearest foe — reticle, sight arc, spell card. */
  target: {
    async stage(sc) {
      const caster = sc.party.find((c) => c.ref.levels.magicUser && !c.ref.levels.fighter) ?? sc.party.find((c) => c.ref.levels.magicUser) ?? sc.party[0];
      setActive(sc, caster);
      sc._frameCombatants(true, caster);
      const spell = sc.params.spell || 'magicMissile';
      sc._enterMode('target', { spell, label: spell === 'magicMissile' ? 'Magic Missile' : spell });
      sc._cycleTarget(0);
      sc._refresh(caster);
    },
  },

  /** Turn undead: the cleric raises the holy symbol against the skeletons (t≈0.6 peak). */
  turn: {
    async stage(sc) {
      const cleric = sc.party.find((c) => c.ref.levels.cleric) ?? sc.party[0];
      const f = sc.figures.get(cleric.id);
      setActive(sc, cleric);
      f.play('turn', 0, 1.6);
      sc.vfx.holyLight(0.3, f.root.position.clone(), 4.2);
      sc._frameCombatants(true, cleric);
      // Debug: &look=statue frames the temple statue (model review).
      const st = sc.params.look === 'statue' && sc.field.features.props.find((p) => p.type === 'statue');
      if (st) {
        sc.cam.goalTarget.set(st.x * TILE + TILE / 2, 1.5, st.y * TILE + TILE / 2);
        sc.cam.target.copy(sc.cam.goalTarget);
        sc.cam.goalDist = sc.cam.dist = 7;
        sc.cam.goalPitch = sc.cam.pitch = 0.45;
        sc.cam.goalYaw = sc.cam.yaw = 0;
      }
      sc._refresh(cleric);
    },
  },

  melee: {
    async stage(sc) {
      const e = sc.engine;
      const fighters = sc.party.filter((c) => c.ref.levels.fighter);
      const hero = fighters[0] ?? sc.party[0];
      const foes = sc.monsters.slice();
      // Bring the lines together near the middle between the two groups.
      const pc = sc.party.reduce((a, c) => ({ x: a.x + c.x / sc.party.length, y: a.y + c.y / sc.party.length }), { x: 0, y: 0 });
      const taken = new Set();
      const foe = foes.sort((a, b) => Battlefield.dist(a.x, a.y, pc.x, pc.y) - Battlefield.dist(b.x, b.y, pc.x, pc.y))[0];
      // Advance the foes a few squares toward the party (they charged).
      const others = foes.slice(1, 4);
      const spots = [];
      const fl = sc.field.flood(Math.round(pc.x), Math.round(pc.y), () => false, 40);
      const mid = { x: Math.round((pc.x + foe.x) / 2), y: Math.round((pc.y + foe.y) / 2) };
      for (let y = 0; y < sc.field.h; y++) {
        for (let x = 0; x < sc.field.w; x++) {
          if (!sc.field.isFree(x, y) || !Number.isFinite(fl.cost[sc.field.idx(x, y)])) continue;
          spots.push({ x, y, d: Battlefield.dist(x, y, mid.x, mid.y) });
        }
      }
      spots.sort((a, b) => a.d - b.d);
      const occupied = () => new Set(e.all.map((c) => `${c.x},${c.y}`));
      const place = (c, pred) => {
        const occ = occupied();
        const s = spots.find((sp) => !occ.has(`${sp.x},${sp.y}`) && !taken.has(`${sp.x},${sp.y}`) && pred(sp));
        if (s) {
          moveTo(sc, c, s.x, s.y);
          taken.add(`${s.x},${s.y}`);
        }
      };
      place(foe, () => true);
      const heroSpot = adjacentFree(sc, foe, pc, taken);
      if (heroSpot) moveTo(sc, hero, heroSpot.x, heroSpot.y);
      taken.add(`${hero.x},${hero.y}`);
      // Second pair: another fighter vs another foe.
      const second = fighters[1] ?? sc.party.find((c) => c !== hero && c.ref.levels.cleric);
      const foe2 = others[0];
      if (foe2) place(foe2, (sp) => Battlefield.dist(sp.x, sp.y, foe.x, foe.y) === 2 && Battlefield.dist(sp.x, sp.y, hero.x, hero.y) >= 2);
      if (second && foe2) {
        const s2 = adjacentFree(sc, foe2, hero, taken);
        if (s2) moveTo(sc, second, s2.x, s2.y);
      }
      const foe3 = others[1];
      if (foe3) place(foe3, (sp) => Battlefield.dist(sp.x, sp.y, foe.x, foe.y) <= 2 && Battlefield.dist(sp.x, sp.y, hero.x, hero.y) >= 2);
      // Everyone faces their enemy.
      face(sc, hero, foe);
      face(sc, foe, hero);
      if (second && foe2) {
        face(sc, second, foe2);
        face(sc, foe2, second);
      }
      if (foe3) face(sc, foe3, hero);
      for (const p of sc.party) if (p !== hero && p !== second) face(sc, p, foe);
      for (const m of sc.monsters) if (m !== foe && m !== foe2 && m !== foe3) face(sc, m, hero);
      setActive(sc, hero);
      sc.mode = 'aim';
      // Hero's blow lands at t≈0.37.
      const fh = sc.figures.get(hero.id);
      const ff = sc.figures.get(foe.id);
      fh.play('attack', 0, 0.8, { reach: 0.3 });
      const impact = 0.8 * 0.46;
      ff.play('hit', impact, 0.5, { power: 1.5 });
      const at = ff.root.position.clone().setY(ff.model.height * 0.62);
      sc.vfx.hitSparks(impact, at, { crit: true, seed: 5, blood: true });
      sc.vfx.swipe(impact - 0.06, fh.root.position.clone().setY(fh.model.height * 0.55), fh.yaw);
      sc.vfx.addShake(impact, 0.12, 0.3);
      sc._say(ff, '9', 'crit', impact + 0.01);
      sc.at(impact, () => (foe.hp.cur = Math.max(1, foe.hp.cur - 3)));
      // Second pair mid-exchange.
      if (second && foe2) {
        sc.figures.get(foe2.id).play('attack', -0.05, 0.8, { reach: 0.3 });
        sc.figures.get(second.id).play('hit', 0.32, 0.45, { power: 0.3 });
      }
      if (foe3) {
        kill(sc, foe3, -0.12, sq2w(hero.x, hero.y));
        const from3 = sq2w(hero.x, hero.y);
        sc.vfx.dust(0.33, sc._killPos(sc.figures.get(foe3.id), from3).setY(0), { seed: 8 });
        sc.hud.float('Slain', 'kill', sc._killPos(sc.figures.get(foe3.id), from3), 0.02, { rise: 0.25 });
      }
      // A missile from a rear rank for depth.
      const archer = sc.party.find((c) => c !== hero && c !== second && e.rangedProfile(c));
      const tgt = sc.monsters.find((m) => m !== foe && m !== foe3 && !e.out(m));
      if (archer && tgt) {
        face(sc, archer, tgt);
        sc.figures.get(archer.id).play('shoot', -0.3, 1.0);
        const fa = sc.figures.get(archer.id);
        fa.update(0.33);
        const from = fa.bonePos('handR').clone();
        const tf = sc.figures.get(tgt.id);
        sc.vfx.missile(0.33, from, sc._head(tf).add(new THREE.Vector3(0, -tf.model.height * 0.45, 0)), { seed: 2 });
      }
      if (foe3) sc.ctx.ui.message(`${foe3.name} is slain.`, 'combat');
      sc.at(impact, () => sc.ctx.ui.message(`${hero.name} hits ${foe.name} for 9 (critical!).`, 'combat'));
      // Camera close on the clash.
      const midW = sq2w((hero.x + foe.x) / 2, (hero.y + foe.y) / 2);
      sc.cam.goalTarget.copy(midW);
      sc.cam.target.copy(midW);
      sc.cam.goalDist = sc.cam.dist = Math.max(11, sc.cam.dist * 0.5);
      sc.cam.goalPitch = sc.cam.pitch = 0.68;
      if (Number.isFinite(+sc.params.yaw) && sc.params.yaw !== undefined) sc.cam.goalYaw = sc.cam.yaw = +sc.params.yaw;
      else sc._chooseYaw({ around: [hero, foe] });
      // Nudge the frame toward the camera so the near rank isn't cut by the bottom edge.
      const toCam = new THREE.Vector3(Math.sin(sc.cam.yaw), 0, Math.cos(sc.cam.yaw));
      sc.cam.goalTarget.addScaledVector(toCam, 1.1);
      sc.cam.target.copy(sc.cam.goalTarget);
      sc._refresh(hero);
    },
  },
};
