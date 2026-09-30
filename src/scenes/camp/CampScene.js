import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, Frame, Menu, PartyRoster, MessageLog } from '../../ui/UI.js';
import { createSkyDome, createTorch } from '../../render/lighting.js';
import { getMaterial } from '../../render/materials.js';
import { heal } from '../../rules/character.js';

/**
 * ENCAMP menu: Save, View, Magic, Rest, Alter, Exit — over a 3D campfire.
 * Owned by the char-creation + party-UI workstream (menus) / explore (backdrop).
 */
export default class CampScene extends Scene {
  async enter() {
    const { render } = this.ctx;
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(50, render.aspect, 0.1, 500);
    this.camera.position.set(0, 2.2, 5.5);
    this.camera.lookAt(-1.2, 0.6, 0);
    s.add(createSkyDome({ hour: 22 }));
    s.fog = new THREE.FogExp2(0x05070f, 0.08);
    s.add(new THREE.HemisphereLight(0x2a3a6a, 0x050505, 0.25));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), getMaterial('floor_rubble'));
    ground.rotation.x = -Math.PI / 2;
    const uv = ground.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 10);
    ground.receiveShadow = true;
    s.add(ground);
    const logMat = getMaterial('floor_wood');
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 8), logMat);
      l.rotation.z = Math.PI / 2 - 0.35;
      l.rotation.y = (i / 5) * Math.PI * 2;
      l.position.y = 0.2;
      l.castShadow = true;
      s.add(l);
    }
    for (let i = 0; i < 10; i++) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), getMaterial('wall_stone'));
      const a = (i / 10) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
      s.add(st);
    }
    this.fire = createTorch({ intensity: 30, distance: 16, color: 0xff8a3a, seed: 5 });
    this.fire.position.y = 0.55;
    this.fire.children[1].scale.setScalar(1.6);
    this.fire.userData.light.castShadow = true;
    s.add(this.fire);
    this.post = { bloomStrength: 1.0, bloomThreshold: 0.7, vignette: 0.6, exposure: 1.1 };

    const menu = new Menu([
      { id: 'save', label: 'Save', key: 'S', hint: 'write a save slot' },
      { id: 'view', label: 'View', key: 'V', hint: 'character sheet' },
      { id: 'magic', label: 'Magic', key: 'M', hint: 'memorize & scribe' },
      { id: 'rest', label: 'Rest', key: 'R', hint: 'heal and memorize' },
      { id: 'alter', label: 'Alter', key: 'A', hint: 'order, drop, settings' },
      { id: 'exit', label: 'Exit', key: 'X', hint: 'break camp' },
    ], { onSelect: (it) => this.select(it.id) });
    const mf = Frame({ title: 'Encamp', variant: 'blue', children: [menu.el] });
    mf.el.style.cssText = 'position:absolute;left:4vw;top:12vh;width:22em;';
    const roster = new PartyRoster(this.ctx);
    const rf = Frame({ title: 'Party', children: [roster.el] });
    rf.el.style.cssText = 'position:absolute;right:4vw;top:12vh;width:17em;';
    const log = new MessageLog(this.ctx.bus, { lines: 3 });
    const bottom = h('div.por-hud-bottom', [h('div.por-log-wrap', [log.el])]);
    this.ctx.ui.mount(mf.el);
    this.ctx.ui.mount(rf.el);
    this.ctx.ui.mount(bottom);
    this.own(() => { roster.dispose(); log.dispose(); });
    this.listen('input:action', ({ action }) => action === 'cancel' && this.select('exit'));
    this.ctx.ui.message('The party makes camp among the ruins.', 'lore');
  }

  select(id) {
    const { game, ui, saves, scenes } = this.ctx;
    if (id === 'exit') scenes.goto('explore', {});
    else if (id === 'save') {
      const ok = saves.save('A', game);
      ui.toast(ok ? 'Saved to slot A' : 'Save unavailable');
    } else if (id === 'rest') {
      game.advanceTime(8 * 60);
      for (const ch of game.party) heal(ch, Math.max(1, Object.values(ch.levels).reduce((a, b) => Math.max(a, b), 1)));
      game.notifyPartyChanged();
      ui.message('The party rests for 8 hours.', 'info');
    } else ui.message(`${id.toUpperCase()}: not yet implemented.`, 'system');
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  update() {
    this.fire.userData.update(this.ctx.clock.time);
  }
}
