import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, Frame, CommandBar, MessageLog, PartyRoster } from '../../ui/UI.js';
import { createOutdoorRig, createSkyDome, createTorch } from '../../render/lighting.js';
import { getMaterial } from '../../render/materials.js';
import { getEncounter } from '../../data/encounters.js';
import { roll } from '../../rules/dice.js';
import { combatantFromCharacter, combatantFromMonster, rollInitiative, autoResolve, xpForVictory, isDown } from '../../rules/combat.js';
import { awardXp } from '../../rules/character.js';

const GRID_W = 14;
const GRID_H = 10;
const TILE = 1.6;

/**
 * Tactical combat (placeholder skeleton). Builds the battlefield, spawns
 * combatants from the rules engine, rolls initiative and supports QUICK
 * (auto-resolve) and FLEE. The combat workstream replaces the placeholder
 * turn logic with full MOVE/AIM/CAST/etc.
 *
 * params: {encounter: string}
 */
export default class CombatScene extends Scene {
  async enter(params = {}) {
    const { render, rng, game } = this.ctx;
    this.encounter = getEncounter(params.encounter ?? 'kobolds_1');
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(40, render.aspect, 0.1, 500);
    const cx = (GRID_W * TILE) / 2;
    const cz = (GRID_H * TILE) / 2;
    this.center = new THREE.Vector3(cx, 0, cz);
    const hour = game.clock.hour;
    this.rig = createOutdoorRig(s, { hour: Number.isFinite(params.hour) ? params.hour : hour, target: this.center, extent: 16, shadowSize: 2048 });
    s.add(createSkyDome({ hour }));

    // Ground tiles
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_W * TILE, GRID_H * TILE), getMaterial('floor_cobble'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    const uv = ground.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * GRID_W * TILE / 3, uv.getY(i) * GRID_H * TILE / 3);
    ground.receiveShadow = true;
    s.add(ground);
    // Grid lines
    const pts = [];
    for (let x = 0; x <= GRID_W; x++) pts.push(x * TILE, 0.01, 0, x * TILE, 0.01, GRID_H * TILE);
    for (let z = 0; z <= GRID_H; z++) pts.push(0, 0.01, z * TILE, GRID_W * TILE, 0.01, z * TILE);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    s.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xd8b25a, transparent: true, opacity: 0.18 })));
    // Surrounding walls (terrain placeholder)
    const wallMat = getMaterial('wall_stone');
    const wallN = new THREE.Mesh(new THREE.BoxGeometry(GRID_W * TILE + 2, 3.5, 0.8), wallMat);
    wallN.position.set(cx, 1.75, -0.4);
    wallN.castShadow = wallN.receiveShadow = true;
    s.add(wallN);
    const ruin = new THREE.Mesh(new THREE.BoxGeometry(TILE * 2, 1.2, TILE), getMaterial('wall_ruin'));
    ruin.position.set(TILE * 6, 0.6, TILE * 2.5);
    ruin.castShadow = true;
    s.add(ruin);
    this.torch = createTorch({ intensity: 14, distance: 12 });
    this.torch.position.set(cx - 4, 2.4, 0.3);
    s.add(this.torch);

    // Combatants
    this.party = game.party.map(combatantFromCharacter);
    this.monsters = [];
    for (const g of this.encounter.groups) {
      const n = typeof g.count === 'number' ? g.count : roll(rng, g.count);
      for (let i = 0; i < n; i++) this.monsters.push(combatantFromMonster(rng, g.monster, i + 1));
    }
    this.tokens = new Map();
    this.party.forEach((c, i) => this._spawn(c, 2 + (i % 2), 2 + Math.floor(i / 2) * 2 + (i % 2)));
    this.monsters.forEach((c, i) => this._spawn(c, 10 + (i % 3), 1 + Math.floor(i / 3) * 2 + (i % 3 === 1 ? 1 : 0)));
    this.order = rollInitiative(rng, [...this.party, ...this.monsters]);
    this.turnIndex = 0;

    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.selRing.rotation.x = -Math.PI / 2;
    s.add(this.selRing);

    this.post = { bloomStrength: 0.45, vignette: 0.4 };
    this._buildUi();
    this._highlightActive();
    this.ctx.ui.message(`Combat! ${this.encounter.name}. ${this.order[0]?.name} acts first.`, 'combat');
    this.ctx.audio.playMusic('combat');
  }

  _spawn(c, gx, gy) {
    c.x = gx;
    c.y = gy;
    const g = makeFigure(c, this.ctx.rng.fork(gx * 31 + gy));
    g.position.set(gx * TILE + TILE / 2, 0, gy * TILE + TILE / 2);
    g.rotation.y = c.side === 'party' ? -Math.PI / 2 : Math.PI / 2;
    this.scene3d.add(g);
    this.tokens.set(c.id, g);
  }

  _buildUi() {
    const ui = this.ctx.ui;
    this.initBar = h('div', { style: { position: 'absolute', top: '1em', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '0.3em' } });
    ui.mount(this.initBar);
    const roster = new PartyRoster(this.ctx);
    const rf = Frame({ title: 'Party', children: [roster.el] });
    rf.el.style.cssText = 'position:absolute;right:1.2em;top:4.5em;width:16em;';
    ui.mount(rf.el);
    const log = new MessageLog(this.ctx.bus, { lines: 4 });
    const bar = new CommandBar([
      { id: 'move', label: 'Move', key: 'M', disabled: true, tip: 'Combat workstream: implement' },
      { id: 'aim', label: 'Aim', key: 'A', disabled: true },
      { id: 'use', label: 'Use', key: 'U', disabled: true },
      { id: 'cast', label: 'Cast', key: 'C', disabled: true },
      { id: 'guard', label: 'Guard', key: 'G', disabled: true },
      { id: 'quick', label: 'Quick', key: 'Q', tip: 'Let the computer fight this battle', onSelect: () => this.quick() },
      { id: 'delay', label: 'Delay', key: 'D', disabled: true },
      { id: 'bandage', label: 'Bandage', key: 'B', disabled: true },
      { id: 'flee', label: 'Flee', key: 'F', tip: 'Run away', onSelect: () => this.flee() },
    ]);
    const bottom = h('div.por-hud-bottom', [h('div.por-log-wrap', [log.el]), bar.el]);
    ui.mount(bottom);
    this.own(() => { roster.dispose(); log.dispose(); bar.dispose(); });
    this._renderInitBar();
  }

  _renderInitBar() {
    this.initBar.replaceChildren(...this.order.map((c, i) => h('div', {
      dataset: { tip: `${c.name} — HP ${c.hp.cur}/${c.hp.max}, AC ${c.ac}` },
      style: {
        padding: '0.25em 0.6em', fontSize: '0.8em', fontFamily: 'var(--font-display)', letterSpacing: '0.08em', borderRadius: '2px',
        border: `1px solid ${i === this.turnIndex ? 'var(--por-gilt-hi)' : 'rgba(216,178,90,0.3)'}`,
        background: c.side === 'party' ? 'rgba(31,58,122,0.85)' : 'rgba(110,24,20,0.85)',
        opacity: isDown(c) ? 0.35 : 1,
        boxShadow: i === this.turnIndex ? '0 0 12px rgba(245,217,139,0.5)' : 'none',
      },
    }, [c.name.split(' ')[0]])));
  }

  _highlightActive() {
    const c = this.order[this.turnIndex];
    const t = c && this.tokens.get(c.id);
    if (t) this.selRing.position.set(t.position.x, 0.03, t.position.z);
  }

  quick() {
    if (this.done) return;
    const res = autoResolve(this.ctx.rng, this.party, this.monsters);
    for (const line of res.log.slice(-6)) this.ctx.ui.message(line, 'combat');
    for (const c of [...this.party, ...this.monsters]) if (isDown(c)) this.tokens.get(c.id).rotation.z = Math.PI / 2 * (c.side === 'party' ? 1 : -1);
    this._renderInitBar();
    this.finish(res.winner);
  }

  async finish(winner) {
    this.done = true;
    const { game, ui, scenes, rng } = this.ctx;
    if (winner === 'party') {
      const xp = xpForVictory(this.monsters);
      const living = game.party.filter((c) => c.status === 'ok');
      const share = Math.floor(xp / Math.max(1, living.length));
      for (const c of living) awardXp(c, share);
      const gold = this.encounter.treasure?.gold ? roll(rng, this.encounter.treasure.gold) : 0;
      if (gold && living[0]) living[0].gold += gold;
      game.notifyPartyChanged();
      await ui.dialog({ title: 'Victory', body: `The party is victorious! Each survivor receives ${share} experience points.${gold ? ` You find ${gold} gold pieces.` : ''}` });
      scenes.goto('explore', {});
    } else if (winner === 'monster') {
      await ui.dialog({ title: 'Defeat', body: 'The party has fallen. Phlan will not be reclaimed today...' });
      scenes.goto('title');
    } else {
      scenes.goto('explore', {});
    }
  }

  async flee() {
    if (this.done) return;
    this.done = true;
    this.ctx.ui.message('The party flees!', 'warn');
    this.ctx.scenes.goto('explore', {});
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  update() {
    const t = this.ctx.clock.time;
    const a = -0.35 + Math.sin(t * 0.1) * 0.05;
    this.camera.position.set(this.center.x + Math.sin(a) * 15, 14.5, this.center.z + Math.cos(a) * 15);
    this.camera.lookAt(this.center.x, 0, this.center.z + 0.5);
    this.torch.userData.update(t);
    this.selRing.material.opacity = 0.6 + 0.3 * Math.sin(t * 4);
    for (const [id, g] of this.tokens) g.position.y = isDown(this._byId(id)) ? 0 : Math.abs(Math.sin(t * 2 + g.id)) * 0.02;
  }

  _byId(id) {
    return this.party.find((c) => c.id === id) ?? this.monsters.find((c) => c.id === id);
  }
}

/** Placeholder low-poly figure: body, head, weapon; colour by side/monster. */
function makeFigure(c, rng) {
  const g = new THREE.Group();
  const isParty = c.side === 'party';
  const small = c.size === 'S';
  const large = c.size === 'L';
  const sc = small ? 0.75 : large ? 1.3 : 1;
  const palette = isParty ? [0x2d52a3, 0x8a2a2a, 0x2a6a3a, 0x6a4a8a, 0x8a6a2a, 0x3a6a7a] : [0x5a4a2a, 0x4a5a2a, 0x6a3a2a];
  const cloth = new THREE.MeshStandardMaterial({ color: palette[rng.int(0, palette.length - 1)], roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: isParty ? 0xd8a888 : c.monsterId === 'skeleton' ? 0xe8e0c8 : 0x7a6a3a, roughness: 0.7 });
  const metal = getMaterial('iron');
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 12), cloth);
  body.position.y = 0.62;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
  head.position.y = 1.2;
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), metal);
  weapon.position.set(0.32, 0.8, 0.12);
  weapon.rotation.x = -0.4;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.06, 24), new THREE.MeshStandardMaterial({ color: isParty ? 0x1f3a7a : 0x6e1814, roughness: 0.4, metalness: 0.3 }));
  base.position.y = 0.03;
  for (const m of [body, head, weapon, base]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  const fig = new THREE.Group();
  fig.add(body, head, weapon);
  fig.scale.setScalar(sc);
  g.add(base, fig);
  return g;
}
