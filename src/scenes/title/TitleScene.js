import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, Menu, Frame } from '../../ui/UI.js';
import { createSkyDome, createTorch } from '../../render/lighting.js';
import { getMaterial } from '../../render/materials.js';
import { getGlowTexture } from '../../render/textures/index.js';
import { buildParty } from '../../rules/party.js';

/**
 * Title screen: the Pool of Radiance glowing in a ruined courtyard at night,
 * slow orbiting camera, gilded logo and main menu.
 * Owned by the title/intro/menus/UI-skin workstream.
 */
export default class TitleScene extends Scene {
  async enter() {
    const { render } = this.ctx;
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(45, render.aspect, 0.1, 800);
    s.add(createSkyDome({ hour: 23 }));
    s.fog = new THREE.FogExp2(0x070b1a, 0.035);
    s.add(new THREE.HemisphereLight(0x3a4a8a, 0x050508, 0.5));
    const moon = new THREE.DirectionalLight(0x9fb6ff, 0.9);
    moon.position.set(-20, 30, -10);
    s.add(moon);

    // Ground: flagstones
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), getMaterial('floor_flag'));
    ground.rotation.x = -Math.PI / 2;
    const uv = ground.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 12);
    s.add(ground);

    // Pool rim of stone blocks
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.45, 12, 64), getMaterial('wall_stone'));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.25;
    s.add(rim);

    // The radiant water surface
    this.poolMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p) * 2.0;
          float w = sin(r * 18.0 - uTime * 2.0) * 0.5 + 0.5;
          float swirl = sin(atan(p.y, p.x) * 5.0 + r * 8.0 - uTime * 0.7) * 0.5 + 0.5;
          vec3 deep = vec3(0.05, 0.35, 0.55);
          vec3 glow = vec3(0.7, 1.6, 2.2);
          vec3 c = mix(glow, deep, smoothstep(0.0, 1.0, r)) + glow * 0.15 * w * swirl * (1.0 - r);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.0, 64), this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.18;
    s.add(pool);
    const poolLight = new THREE.PointLight(0x8ff0ff, 40, 30, 1.5);
    poolLight.position.set(0, 1.5, 0);
    s.add(poolLight);

    // Ruined pillars in a ring
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 1, 12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const hgt = [6, 3.2, 5.5, 1.6, 6, 2.4, 4.4, 6][i];
      const p = new THREE.Mesh(pillarGeo, getMaterial('wall_stone'));
      p.scale.y = hgt;
      p.position.set(Math.cos(a) * 9, hgt / 2, Math.sin(a) * 9);
      s.add(p);
    }
    // Rising motes
    const motes = new THREE.Group();
    const mm = new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0x9ff4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 60; i++) {
      const sp = new THREE.Sprite(mm);
      const r = Math.sqrt(this.ctx.rng.next()) * 2.8;
      const a = this.ctx.rng.next() * Math.PI * 2;
      sp.userData = { r, a, speed: 0.3 + this.ctx.rng.next() * 0.6, phase: this.ctx.rng.next() * 10 };
      sp.scale.setScalar(0.12 + this.ctx.rng.next() * 0.15);
      motes.add(sp);
    }
    s.add(motes);
    this.motes = motes;
    this.torch = createTorch({ intensity: 20, distance: 18, seed: 3 });
    this.torch.position.set(-6, 2.2, 6);
    s.add(this.torch);

    this.post = { bloomStrength: 1.1, bloomRadius: 0.8, bloomThreshold: 0.7, exposure: 1.05, vignette: 0.55 };

    // UI
    const hasSave = this.ctx.saves.list().some((x) => x.slot === 'auto');
    const menu = new Menu(
      [
        { id: 'continue', label: 'Continue', key: 'C', disabled: !hasSave, hint: hasSave ? 'autosave' : '' },
        { id: 'new', label: 'Create Party', key: 'N', hint: 'roll your adventurers' },
        { id: 'quick', label: 'Quick Start', key: 'Q', hint: 'prebuilt party' },
        { id: 'options', label: 'Options', key: 'O' },
      ],
      { onSelect: (it) => this.select(it.id) },
    );
    const frame = Frame({ variant: 'dark', className: 'por-title-menu', children: [menu.el] });
    const root = h('div.por-title-screen', [
      h('div.por-title-logo', [
        h('div.pre', ['Advanced Dungeons & Dragons · Forgotten Realms']),
        h('h1.por-gilt-text', ['Pool of Radiance']),
        h('div.sub', ['A Modern Homage']),
      ]),
      frame.el,
      h('div.por-footnote', ['Phlan, on the Moonsea · Year of the Worm']),
    ]);
    this.ctx.ui.mount(root);
    this.ctx.audio.playMusic('title');
  }

  select(id) {
    const { scenes, game, saves, rng } = this.ctx;
    if (id === 'new') scenes.goto('create', {});
    else if (id === 'quick') {
      game.setParty(buildParty('default', rng.int(1, 1e6)));
      scenes.goto('explore', { map: 'phlan_slums', x: 1, y: 14, dir: 'E' });
    } else if (id === 'continue') {
      const st = saves.load('auto');
      if (st) {
        game.loadJSON(st);
        scenes.goto('explore', {});
      }
    } else if (id === 'options') {
      this.ctx.ui.dialog({ title: 'Options', body: 'Press F2 at any time to toggle Classic (1988) mode. More options coming soon.' });
    }
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  update() {
    const t = this.ctx.clock.time;
    this.poolMat.uniforms.uTime.value = t;
    const a = t * 0.05 + 0.6;
    this.camera.position.set(Math.cos(a) * 14, 4.2 + Math.sin(t * 0.2) * 0.3, Math.sin(a) * 14);
    this.camera.lookAt(0, 1.4, 0);
    this.torch.userData.update(t);
    for (const m of this.motes.children) {
      const u = m.userData;
      const y = ((t * u.speed + u.phase) % 4) * 1.2;
      m.position.set(Math.cos(u.a + t * 0.1) * u.r, 0.2 + y, Math.sin(u.a + t * 0.1) * u.r);
    }
  }
}
