import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, clear, Frame } from '../../ui/UI.js';
import { createSkyDome, createTorch } from '../../render/lighting.js';
import { getMaterial } from '../../render/materials.js';
import { RACES, RACE_IDS } from '../../rules/races.js';
import { classSpecName, splitClasses } from '../../rules/classes.js';
import { ABILITIES, ABILITY_NAMES, formatStr } from '../../rules/abilities.js';
import { createCharacter, rollLegalAbilities, deriveStats } from '../../rules/character.js';
import { STARTING_KITS } from '../../data/items.js';

const ALIGNMENTS = ['LG', 'NG', 'CG', 'LN', 'TN', 'CN'];

/**
 * Character creation: race → class → roll abilities → name → add to party.
 * params: {step?: 'race'|'class'|'stats'|'party'}  (debug jumps: step=stats rolls a human fighter)
 * Owned by the char-creation + party-UI workstream.
 */
export default class CreateScene extends Scene {
  async enter(params = {}) {
    const { render, rng } = this.ctx;
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(50, render.aspect, 0.1, 500);
    this.camera.position.set(0, 1.6, 6);
    this.camera.lookAt(0, 1.2, 0);
    s.add(createSkyDome({ hour: 22 }));
    s.fog = new THREE.FogExp2(0x060914, 0.06);
    s.add(new THREE.HemisphereLight(0x33447a, 0x080808, 0.4));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), getMaterial('floor_flag'));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(24, 8, 0.5), getMaterial('wall_stone'));
    wall.position.set(0, 4, -3);
    s.add(wall);
    this.torches = [-3.5, 3.5].map((x, i) => {
      const t = createTorch({ intensity: 16, distance: 12, seed: i * 7 });
      t.position.set(x, 2.6, -2.6);
      s.add(t);
      return t;
    });
    this.post = { bloomStrength: 0.9, vignette: 0.55, exposure: 1.1 };

    this.draft = { race: 'human', classSpec: 'fighter', gender: 'male', alignment: 'LG', name: '', abilities: null };
    this.newParty = [...this.ctx.game.party];
    this.panel = Frame({ title: 'Create Character', variant: 'blue' });
    this.panel.el.style.cssText = 'position:absolute;left:4vw;top:8vh;width:min(46em,55vw);max-height:84vh;overflow:auto;';
    this.side = Frame({ title: 'Party', variant: 'dark' });
    this.side.el.style.cssText = 'position:absolute;right:4vw;top:8vh;width:22em;';
    this.ctx.ui.mount(this.panel.el);
    this.ctx.ui.mount(this.side.el);
    const step = params.step ?? 'race';
    if (step === 'stats' || step === 'party') {
      this.draft.name = 'Taran';
      this.roll();
    }
    this.show(step === 'party' ? 'stats' : step);
    this.renderParty();
    void rng;
  }

  roll() {
    this.draft.abilities = rollLegalAbilities(this.ctx.rng, this.draft.race, this.draft.classSpec);
  }

  show(step) {
    this.step = step;
    const b = clear(this.panel.body);
    const chips = (items, cur, onPick) =>
      h('div.por-choice-row', items.map(([id, label]) => h(`button.por-chip${id === cur ? '.sel' : ''}`, { onclick: () => onPick(id) }, [label])));
    if (step === 'race') {
      b.append(h('h2.por-h2', ['Choose a Race']), chips(RACE_IDS.map((r) => [r, RACES[r].name]), this.draft.race, (r) => {
        this.draft.race = r;
        if (!RACES[r].classes.includes(this.draft.classSpec)) this.draft.classSpec = RACES[r].classes[0];
        this.show('race');
      }));
      const r = RACES[this.draft.race];
      b.append(h('p.por-muted', [`Infravision ${r.infravision ? `${r.infravision}'` : 'none'}. Adjustments: ${Object.entries(r.adjust).map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`).join(', ') || 'none'}.`]));
      b.append(h('div.por-dialog-buttons', [h('button.por-btn.primary', { onclick: () => this.show('class') }, ['Next'])]));
    } else if (step === 'class') {
      const r = RACES[this.draft.race];
      b.append(h('h2.por-h2', [`Choose a Class — ${r.name}`]), chips(r.classes.map((c) => [c, classSpecName(c)]), this.draft.classSpec, (c) => {
        this.draft.classSpec = c;
        this.show('class');
      }));
      b.append(h('h2.por-h2', { style: { marginTop: '1em' } }, ['Alignment']), chips(ALIGNMENTS.map((a) => [a, a]), this.draft.alignment, (a) => {
        this.draft.alignment = a;
        this.show('class');
      }));
      b.append(h('div.por-dialog-buttons', [
        h('button.por-btn', { onclick: () => this.show('race') }, ['Back']),
        h('button.por-btn.primary', { onclick: () => { this.roll(); this.show('stats'); } }, ['Roll Abilities']),
      ]));
    } else if (step === 'stats') {
      const a = this.draft.abilities;
      const preview = createCharacter({ rng: this.ctx.rng.fork(1), name: this.draft.name || 'Adventurer', race: this.draft.race, classSpec: this.draft.classSpec, abilities: a, items: STARTING_KITS[splitClasses(this.draft.classSpec)[0]] });
      const s = deriveStats(preview);
      const grid = h('div.por-grid2', ABILITIES.flatMap((k) => [
        h('span.por-stat-label', [ABILITY_NAMES[k]]),
        h('span.por-stat-val', [k === 'str' ? formatStr(a.str, a.strPct) : String(a[k])]),
      ]));
      const derived = h('div.por-grid2', [
        ['Hit Points', preview.hp.max], ['Armor Class', s.ac], ['THAC0', s.thac0], ['Move', s.move], ['Gold', preview.gold],
      ].flatMap(([l, v]) => [h('span.por-stat-label', [l]), h('span.por-stat-val', [String(v)])]));
      const nameInput = h('input.por-input', { value: this.draft.name, placeholder: 'Name', maxLength: 15, oninput: (e) => { this.draft.name = e.target.value; } });
      b.append(
        h('h2.por-h2', [`${RACES[this.draft.race].name} ${classSpecName(this.draft.classSpec)}`]),
        h('div', { style: { display: 'flex', gap: '3em' } }, [grid, derived]),
        h('div', { style: { margin: '1.2em 0 0.4em' } }, [h('span.por-stat-label', ['Name  ']), nameInput]),
        h('div.por-dialog-buttons', [
          h('button.por-btn', { onclick: () => this.show('class') }, ['Back']),
          h('button.por-btn', { onclick: () => { this.roll(); this.show('stats'); } }, ['Reroll']),
          h('button.por-btn.primary', { onclick: () => this.keep() }, ['Keep']),
        ]),
      );
    }
  }

  keep() {
    const d = this.draft;
    if (this.newParty.length >= 6) return this.ctx.ui.toast('The party is full (6).');
    const ch = createCharacter({ rng: this.ctx.rng, name: d.name || `Hero ${this.newParty.length + 1}`, race: d.race, classSpec: d.classSpec, alignment: d.alignment, gender: d.gender, abilities: d.abilities, items: STARTING_KITS[splitClasses(d.classSpec)[0]] });
    this.newParty.push(ch);
    this.draft.name = '';
    this.renderParty();
    this.show('race');
  }

  renderParty() {
    const b = clear(this.side.body);
    if (!this.newParty.length) b.append(h('p.por-muted', ['No adventurers yet. Up to six may join.']));
    for (const ch of this.newParty) {
      const s = deriveStats(ch);
      b.append(h('div', { style: { padding: '0.3em 0', borderBottom: '1px solid rgba(216,178,90,0.2)' } }, [
        h('div', { style: { color: 'var(--por-green)' } }, [ch.name]),
        h('div.por-muted', { style: { fontSize: '0.85em' } }, [`${RACES[ch.race].name} ${s.className} · HP ${ch.hp.max} · AC ${s.ac}`]),
      ]));
    }
    b.append(h('div.por-dialog-buttons', { style: { marginTop: '1em' } }, [
      h('button.por-btn', { onclick: () => this.ctx.scenes.goto('title') }, ['Exit']),
      h('button.por-btn.primary', {
        disabled: !this.newParty.length,
        onclick: () => {
          this.ctx.game.setParty(this.newParty);
          this.ctx.scenes.goto('explore', { map: 'phlan_slums', x: 1, y: 14, dir: 'E' });
        },
      }, ['Begin Adventure']),
    ]));
  }

  onResize() {
    this.camera.aspect = this.ctx.render.aspect;
    this.camera.updateProjectionMatrix();
  }

  update() {
    for (const t of this.torches) t.userData.update(this.ctx.clock.time);
  }
}
