import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { getMap, hasMap } from '../../data/maps/index.js';
import { DIRS, DIR_YAW, DIR_VEC, EDGE, EDGE_NAMES, turnLeft, turnRight, OPPOSITE } from '../../data/maps/MapGrid.js';
import { createOutdoorRig, createSkyDome, createTorch } from '../../render/lighting.js';
import { createStandardHud } from '../../ui/StandardHud.js';
import { buildBlock, disposeBlock, cellCenter, EYE_H, CELL_SIZE } from './BlockBuilder.js';
import { deriveStats } from '../../rules/character.js';
import { SHOPS } from '../../data/shops.js';

const STEP_TIME = 0.32;
const TURN_TIME = 0.22;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * First-person grid exploration (Gold Box style movement: one cell per step,
 * 90° turns) rendered as a full 3D scene with smooth interpolation.
 *
 * enter params: {map?, x?, y?, dir?, hour?}  (defaults: game.location)
 * Owned by the explore-renderer workstream.
 */
export default class ExploreScene extends Scene {
  async enter(params = {}) {
    const { game, render } = this.ctx;
    const loc = { ...game.location };
    if (params.map && hasMap(params.map)) loc.map = params.map;
    if (Number.isFinite(params.x)) loc.x = params.x;
    if (Number.isFinite(params.y)) loc.y = params.y;
    if (params.dir && DIRS.includes(params.dir)) loc.dir = params.dir;
    this.map = getMap(loc.map);
    game.location = loc;
    this.pos = { x: loc.x, y: loc.y, dir: loc.dir };
    this.hour = Number.isFinite(params.hour) ? params.hour : game.clock.hour + game.clock.minute / 60;

    this.scene3d = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, render.aspect, 0.05, 600);
    this.scene3d.add(this.camera);

    const center = new THREE.Vector3((this.map.w * CELL_SIZE) / 2, 0, (this.map.h * CELL_SIZE) / 2);
    this.rig = createOutdoorRig(this.scene3d, { hour: this.hour, target: center, extent: (this.map.w * CELL_SIZE) / 2 + 4 });
    if (this.map.outdoors) this.scene3d.add(createSkyDome({ hour: this.hour }));
    this.scene3d.background = new THREE.Color(this.rig.keys.skyHorizon);

    // Player lantern: warm light carried by the party.
    const night = this.hour < 6 || this.hour > 19;
    this.lantern = createTorch({ intensity: night ? 9 : 2.5, distance: night ? 16 : 9, glow: false, color: 0xffb070 });
    this.lantern.position.set(0.35, -0.25, -0.3);
    this.camera.add(this.lantern);

    this._buildBlock();
    this.post = night ? { bloomStrength: 0.8, exposure: 1.1, vignette: 0.45 } : { bloomStrength: 0.35, bloomThreshold: 0.9, exposure: 1.0 };

    this.hud = createStandardHud(this.ctx, {
      commands: [
        { id: 'area', label: 'Area', key: this.ctx.input.label('area'), action: 'area', tip: 'Overhead map', onSelect: () => this.cmdArea() },
        { id: 'cast', label: 'Cast', key: this.ctx.input.label('cast'), action: 'cast', tip: 'Cast a spell', onSelect: () => this.cmdCast() },
        { id: 'view', label: 'View', key: this.ctx.input.label('view'), action: 'view', tip: 'View character', onSelect: () => this.cmdView() },
        { id: 'encamp', label: 'Encamp', key: this.ctx.input.label('encamp'), action: 'encamp', tip: 'Make camp: rest, save, memorize', onSelect: () => this.cmdEncamp() },
        { id: 'search', label: 'Search', key: this.ctx.input.label('search'), action: 'search', tip: 'Search for secret doors', onSelect: () => this.cmdSearch() },
        { id: 'look', label: 'Look', key: this.ctx.input.label('look'), action: 'look', tip: 'Examine what lies ahead', onSelect: () => this.cmdLook() },
      ],
    });
    this.own(() => this.hud.dispose());
    this.listen('input:action', (e) => this._onAction(e.action));

    this.tween = null;
    this._placeCamera(this.pos.x, this.pos.y, DIR_YAW[this.pos.dir], 0);
    this._updateHud();
    game.markExplored(this.map.id, this.pos.x, this.pos.y, this.map.w);
    this.ctx.ui.message(`You stand in ${this.map.zoneAt(this.pos.x, this.pos.y)}.`, 'lore');
    this.ctx.audio.playMusic(this.map.kind === 'city' ? 'phlan_streets' : 'dungeon');
  }

  _foundSecrets() {
    const all = this.ctx.game.flags.secrets ?? [];
    const prefix = `${this.map.id}:`;
    return new Set(all.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length)));
  }

  _buildBlock() {
    if (this.block) disposeBlock(this.block);
    this.block = buildBlock(this.map, { foundSecrets: this._foundSecrets() });
    this.scene3d.add(this.block.group);
    // Enable real lights on the nearest few sconces (perf budget: ≤ 4 point lights).
    this._assignSconceLights();
  }

  _assignSconceLights() {
    const here = cellCenter(this.pos.x, this.pos.y);
    const sorted = [...this.block.torches].sort((a, b) => a.position.distanceToSquared(here) - b.position.distanceToSquared(here));
    this.block.torches.forEach((t) => {
      t.userData.light.visible = false;
    });
    sorted.slice(0, 3).forEach((t) => {
      t.userData.light.visible = true;
      t.userData.light.intensity = 6;
      t.userData.light.distance = 9;
    });
  }

  resume() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
    this.hud.roster.refresh();
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  _placeCamera(x, y, yaw, bob) {
    const c = cellCenter(x, y);
    // stand slightly behind cell centre so the facing wall frames nicely
    this.camera.position.set(c.x + Math.sin(yaw) * 0.55, EYE_H + bob, c.z + Math.cos(yaw) * 0.55);
    this.camera.rotation.set(0, yaw, 0, 'YXZ');
    this.hud?.compass.set(yaw);
  }

  _onAction(action) {
    if (this.ctx.scenes.current !== this || this.leaving) return;
    const movement = ['forward', 'back', 'strafeLeft', 'strafeRight', 'turnLeft', 'turnRight', 'turnAround'];
    if (this.tween && movement.includes(action)) {
      this.queued = action; // one-deep input buffer keeps held keys responsive
      return;
    }
    switch (action) {
      case 'forward': return this.move(this.pos.dir);
      case 'back': return this.move(OPPOSITE[this.pos.dir], true);
      case 'strafeLeft': return this.move(turnLeft(this.pos.dir), true);
      case 'strafeRight': return this.move(turnRight(this.pos.dir), true);
      case 'turnLeft': return this.turn(turnLeft(this.pos.dir), 1);
      case 'turnRight': return this.turn(turnRight(this.pos.dir), -1);
      case 'turnAround': return this.turn(OPPOSITE[this.pos.dir], 2);
      case 'area': return this.cmdArea();
      case 'encamp': return this.cmdEncamp();
      case 'search': return this.cmdSearch();
      case 'look': return this.cmdLook();
      case 'view': return this.cmdView();
      case 'cast': return this.cmdCast();
      case 'prevMember':
      case 'nextMember': {
        const g = this.ctx.game;
        const n = g.party.length;
        if (!n) return;
        g.activeIndex = (g.activeIndex + (action === 'nextMember' ? 1 : n - 1)) % n;
        g.notifyPartyChanged();
        return;
      }
      default:
    }
  }

  turn(newDir, quarterTurns) {
    if (this.tween) return;
    const from = DIR_YAW[this.pos.dir];
    const to = from + (Math.PI / 2) * quarterTurns;
    this.pos.dir = newDir;
    this.ctx.game.setLocation({ dir: newDir });
    this.tween = { kind: 'turn', t: 0, dur: TURN_TIME / (this.ctx.settings.get('moveSpeed') || 1), fromYaw: from, toYaw: to, x0: this.pos.x, y0: this.pos.y, x1: this.pos.x, y1: this.pos.y };
    this._updateHud();
  }

  move(dir, keepFacing = false) {
    if (this.tween) return;
    const res = this.map.tryMove(this.pos.x, this.pos.y, dir, { foundSecrets: this._foundSecrets() });
    if (!res.ok) {
      if (res.reason === 'locked') this.ctx.ui.message('The door is locked.', 'warn');
      else if (res.reason === 'edge') this.ctx.ui.message('The way is barred.', 'warn');
      this.ctx.audio.sfx('bump');
      this.tween = { kind: 'bump', t: 0, dur: 0.22, dir, fromYaw: DIR_YAW[this.pos.dir], toYaw: DIR_YAW[this.pos.dir], x0: this.pos.x, y0: this.pos.y, x1: this.pos.x, y1: this.pos.y };
      return;
    }
    if (res.leaves) {
      this.ctx.ui.message(`The path leads to ${res.exit.to.replace(/_/g, ' ')} — not yet built.`, 'system');
      return;
    }
    const door = this.block.doors.get(`${this.pos.x},${this.pos.y},${dir}`) ?? this.block.doors.get(`${res.nx},${res.ny},${OPPOSITE[dir]}`);
    if (door) this.ctx.audio.sfx('door');
    else this.ctx.audio.sfx('step');
    const yaw = DIR_YAW[this.pos.dir];
    this.tween = { kind: 'move', t: 0, dur: STEP_TIME / (this.ctx.settings.get('moveSpeed') || 1), fromYaw: yaw, toYaw: yaw, x0: this.pos.x, y0: this.pos.y, x1: res.nx, y1: res.ny, door };
    this.pos.x = res.nx;
    this.pos.y = res.ny;
    void keepFacing;
  }

  _arrive() {
    const { game } = this.ctx;
    game.setLocation({ x: this.pos.x, y: this.pos.y, dir: this.pos.dir });
    game.markExplored(this.map.id, this.pos.x, this.pos.y, this.map.w);
    game.advanceTime(1);
    this._assignSconceLights();
    this._updateHud();
    this._checkEvents();
  }

  _checkEvents() {
    const { game, ui } = this.ctx;
    for (const ev of this.map.eventsAt(this.pos.x, this.pos.y)) {
      if (ev.once && game.spentEvents[ev.id]) continue;
      if (ev.facing && ev.facing !== this.pos.dir) continue;
      if (ev.chance && !this.ctx.rng.chance(ev.chance)) continue;
      if (ev.once) game.spentEvents[ev.id] = true;
      switch (ev.type) {
        case 'encounter':
          ui.message('Something stirs in the shadows...', 'warn');
          this.leaving = true;
          this.ctx.scenes.goto('dialogue', { encounter: ev.ref });
          return;
        case 'sign':
        case 'text':
          ui.message(ev.text, 'lore');
          break;
        case 'treasure':
          ui.message(ev.text, 'loot');
          if (ev.gold && game.party[0]) {
            game.party[0].gold += ev.gold;
            ui.message(`The party gains ${ev.gold} gold pieces.`, 'loot');
            this.ctx.audio.sfx('coins');
          }
          break;
        case 'shop':
          this.leaving = true;
          this.ctx.scenes.goto('shop', { shop: ev.ref });
          return;
        case 'exit':
          ui.message(ev.text, 'system');
          break;
        default:
      }
    }
  }

  cmdArea() {
    this.ctx.scenes.push('automap', { map: this.map.id, overlay: true });
  }

  cmdCast() {
    const ch = this.ctx.game.activeCharacter;
    const slots = ch ? deriveStats(ch).spellSlots : {};
    if (!Object.keys(slots).length) this.ctx.ui.message(`${ch?.name ?? 'No one'} cannot cast spells.`, 'warn');
    else this.ctx.ui.message(`${ch.name} has no spells memorized. Encamp to memorize.`, 'system');
  }

  cmdView() {
    const ch = this.ctx.game.activeCharacter;
    if (!ch) return;
    const s = deriveStats(ch);
    const a = ch.abilities;
    this.ctx.ui.dialog({
      title: ch.name,
      variant: 'blue',
      body: `${s.className} (level ${s.levels}) — AC ${s.ac}, THAC0 ${s.thac0}, HP ${ch.hp.cur}/${ch.hp.max}. STR ${a.str}${a.strPct ? `/${a.strPct}` : ''} INT ${a.int} WIS ${a.wis} DEX ${a.dex} CON ${a.con} CHA ${a.cha}. Weapon: ${s.weapon?.name ?? 'none'} (${s.damage}).`,
    });
  }

  cmdEncamp() {
    this.leaving = true;
    this.ctx.scenes.goto('camp', {});
  }

  cmdSearch() {
    const { game, ui } = this.ctx;
    game.advanceTime(10);
    const { x, y, dir } = this.pos;
    let found = false;
    for (const d of DIRS) {
      if (this.map.getEdge(x, y, d) === EDGE.SECRET) {
        const key = `${this.map.id}:${x},${y},${d}`;
        const list = (game.flags.secrets ??= []);
        if (!list.includes(key)) {
          list.push(key);
          const [dx, dy] = DIR_VEC[d];
          list.push(`${this.map.id}:${x + dx},${y + dy},${OPPOSITE[d]}`);
          found = true;
        }
      }
    }
    if (found) {
      ui.message('You discover a hidden door!', 'loot');
      this._buildBlock();
    } else ui.message('You search carefully but find nothing.', 'info');
    void dir;
  }

  cmdLook() {
    const { x, y, dir } = this.pos;
    const e = this.map.getEdge(x, y, dir);
    const desc = {
      [EDGE.OPEN]: 'The street continues ahead.',
      [EDGE.WALL]: 'A weathered wall blocks the way.',
      [EDGE.DOOR]: 'A heavy wooden door stands before you.',
      [EDGE.LOCKED]: 'An iron-bound door. It is locked.',
      [EDGE.SECRET]: 'A weathered wall blocks the way.',
      [EDGE.ARCH]: 'An archway opens ahead.',
    }[e];
    this.ctx.ui.message(desc ?? EDGE_NAMES[e], 'info');
    const shop = this.map.eventsAt(x + DIR_VEC[dir][0], y + DIR_VEC[dir][1]).find((ev) => ev.type === 'shop');
    if (shop) this.ctx.ui.message(`A sign reads: ${SHOPS[shop.ref]?.name ?? 'Shop'}.`, 'lore');
  }

  _updateHud() {
    const { game } = this.ctx;
    const { day, hour, minute } = game.clock;
    const facing = { N: 'North', E: 'East', S: 'South', W: 'West' }[this.pos.dir];
    this.hud?.setLocation(this.map.zoneAt(this.pos.x, this.pos.y), `${this.pos.x},${this.pos.y} · facing ${facing} · Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  update(dt) {
    const time = this.ctx.clock.time;
    this.lantern.userData.update(time);
    for (const t of this.block.torches) t.userData.update(time);
    const tw = this.tween;
    if (!tw) return;
    tw.t = this.ctx.clock.frozen ? 1 : Math.min(1, tw.t + dt / tw.dur);
    const k = ease(tw.t);
    let fx = tw.x0 + (tw.x1 - tw.x0) * k;
    let fy = tw.y0 + (tw.y1 - tw.y0) * k;
    let bob = 0;
    if (tw.kind === 'move') {
      bob = Math.sin(tw.t * Math.PI) * 0.045;
      tw.door?.setOpen(Math.sin(Math.min(1, tw.t * 1.4) * Math.PI));
    } else if (tw.kind === 'bump') {
      const [dx, dy] = DIR_VEC[tw.dir];
      const push = Math.sin(tw.t * Math.PI) * 0.12;
      fx += dx * push;
      fy += dy * push;
    }
    const yaw = tw.fromYaw + (tw.toYaw - tw.fromYaw) * k;
    this._placeCamera(fx, fy, yaw, bob);
    if (tw.t >= 1) {
      tw.door?.setOpen(0);
      this.tween = null;
      this._placeCamera(this.pos.x, this.pos.y, DIR_YAW[this.pos.dir], 0);
      if (tw.kind === 'move') this._arrive();
      const q = this.queued;
      this.queued = null;
      if (q) this._onAction(q);
      else if (this.ctx.scenes.current === this) {
        // continuous movement while a key is held
        for (const a of ['forward', 'back', 'turnLeft', 'turnRight']) if (this.ctx.input.down(a)) return this._onAction(a);
      }
    }
  }

  exit() {
    if (this.block) disposeBlock(this.block);
    super.exit();
  }
}
