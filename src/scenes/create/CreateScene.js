import * as THREE from 'three';
import { Scene } from '../../core/Scene.js';
import { h, clear, Frame, CommandBar } from '../../ui/UI.js';
import { createTorch } from '../../render/lighting.js';
import { getMaterial, preloadMaterials } from '../../render/materials.js';
import { getGlowTexture } from '../../render/textures/index.js';
import { bannerMaps } from './bannerArt.js';
import { RACES, RACE_IDS, raceAbilityCaps } from '../../rules/races.js';
import { CLASSES, ALIGNMENTS, ALIGNMENT_NAMES, PR_LEVEL_CAPS, classSpecName, splitClasses, allowedAlignments, xpForLevel } from '../../rules/classes.js';
import { ABILITIES, ABILITY_NAMES, ABILITY_ABBR, formatStr } from '../../rules/abilities.js';
import { SAVE_SLOTS } from '../../core/SaveManager.js';
import { createCharacter, unequipItem, deriveStats, applyRace, meetsClassMinimums, rollExceptionalStr, validateConcept } from '../../rules/character.js';
import { portraitURL, HEADS, BODIES, RACE_SKINS, SKIN_TONES, HAIR_COLORS, EYE_COLORS, CLOTH_COLORS, defaultLook } from '../../ui/components/portraitPainter.js';
import { precompilePortrait } from '../../ui/components/portraitGL.js';
import { portraitEl, miniPortrait, abilityMods } from '../../ui/components/CharacterSheet.js';
import { ammoProblem, ammoHint } from '../../ui/components/Inventory.js';
import { openCharacterView } from '../../ui/components/CharacterView.js';
import { STAT_TIPS, ALIGNMENT_TEXT, levelLimitText, abilityTip } from '../../ui/components/rulesText.js';
import { buildMiniature, miniatureEnvironment, useRenderer } from '../../ui/components/Miniature.js';
import { prepaintParty } from '../../ui/components/portraitPainter.js';
import { UINav } from '../../ui/components/uiNav.js';
import { portraitImg, setPortraitSync, portraitsPending } from '../../ui/components/lazyPortrait.js';
import { bodyShowsArmor } from '../../ui/components/lookData.js';
import { ITEMS } from '../../data/items.js';
import { itemName } from '../../rules/items.js';
import { itemIconURL, iconFor } from '../../ui/components/itemIcons.js';
import { createFlame } from '../../render/lighting.js';
import { CREATE_TEXT, NAMES, kitFor } from './createData.js';

/** Names of the eye colours (lookData EYE_COLORS, in order). */
const EYE_NAMES = ['Blue', 'Green', 'Brown', 'Hazel', 'Grey', 'Sky', 'Amber'];

/** Ammunition rides in the pack until a launcher is readied (no '⚠ arrows but no bow' on a fresh sheet). */
function settleKit(ch) {
  const launcher = ch.inventory.some((e) => e.equipped && ITEMS[e.id]?.ammo);
  if (!launcher) ch.inventory.forEach((e, i) => { if (e.equipped && ITEMS[e.id]?.type === 'ammo') unequipItem(ch, i); });
  return ch;
}

const STEPS = [['race', 'Race'], ['class', 'Class'], ['align', 'Alignment'], ['stats', 'Abilities'], ['portrait', 'Portrait'], ['name', 'Name']];
const BUY_POOL = 32;
const buyCost = (v) => {
  let c = 0;
  for (let x = 9; x <= v; x++) c += x <= 14 ? 1 : x <= 16 ? 2 : 3;
  return c;
};
const ROSTER_KEY = 'por.roster';

/**
 * Character creation and party assembly (Gold Box "Create / Add / Drop / Modify / Begin").
 * params: {step?: 'party'|'race'|'class'|'align'|'stats'|'portrait'|'name'}
 * Debug jumps (step=stats/portrait/name) start with a human fighter named Taran.
 * Owned by the char-creation + party-UI workstream.
 */
export default class CreateScene extends Scene {
  async enter(params = {}) {
    const { render } = this.ctx;
    useRenderer(render.renderer);
    setPortraitSync(!!this.ctx.debug?.frozen);
    // Start the portrait painter (its own GL context in a worker, the shader compiled there) before
    // the hall claims the GPU, so the first portrait a player asks for does not wait on it.
    if (!this.ctx.debug?.frozen) prepaintParty(this.ctx.game.party);
    // The painter's shaders build in the driver while the hall is made.
    precompilePortrait(render.renderer);
    this.rng = this.ctx.rng;
    await this._build3d();
    this.post = { bloomStrength: 0.5, bloomThreshold: 0.92, vignette: 0.62, exposure: 1.08 };

    this.newParty = [...this.ctx.game.party];
    this.roster = this._loadRoster();
    this.hubSel = 0;
    this.resetDraft();

    // Layout: steps bar, main panel, character card, command line.
    this.stepsEl = h('div.cc-steps');
    this.main = Frame({ title: 'Create Character', variant: 'blue', className: 'cc-main' });
    this.card = Frame({ title: 'Adventurer', variant: 'dark', className: 'cc-card' });
    this.bar = new CommandBar([]);
    this.ctx.ui.mount(this.stepsEl);
    this.ctx.ui.mount(this.main.el);
    this.ctx.ui.mount(this.card.el);
    this.ctx.ui.mount(h('div.pc-cmdline', [this.bar.el]));
    this.own(() => this.bar.dispose());
    // Arrow keys / D-pad move between the options of the current step and the command line.
    this.nav = new UINav(this.ctx, { roots: () => [this.stepsEl, this.main.body, this.card.body, this.bar.el] });
    this.own(() => this.nav.dispose());
    this.listen('input:action', ({ action }) => {
      if (this.ctx.ui.layers.modal.children.length) return;
      if (action === 'cancel') this.back();
    });

    const step = params.step ?? 'party';
    if (step !== 'party' && step !== 'race') {
      Object.assign(this.draft, { name: 'Taran', race: 'human', gender: 'male', classSpec: 'fighter', alignment: 'LG' });
      // Debug/gallery overrides: &race=dwarf&gender=female&cls=cleric&head=3&body=1&cloth=2
      const raw = this.ctx.debug?.raw ?? {};
      if (raw.race) this.draft.race = raw.race;
      if (raw.gender) this.draft.gender = raw.gender;
      if (raw.cls) this.draft.classSpec = raw.cls;
      for (const k of ['head', 'body', 'cloth', 'hair', 'skin']) if (raw[k] != null) this.draft.look[k] = Number(raw[k]);
      // A name that fits the race and sex (the first of the list: deterministic for the gallery).
      if (raw.race || raw.gender) this.draft.name = raw.name ?? (NAMES[this.draft.race]?.[this.draft.gender] ?? NAMES.human[this.draft.gender])[0];
      this.roll();
    }
    this.show(step);
    void render;
  }

  // ------------------------------------------------------------------ 3D hall

  async _build3d() {
    const { render } = this.ctx;
    await preloadMaterials(['arch_flags', 'arch_stone', 'arch_trim']);
    const s = (this.scene3d = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(34, render.aspect, 0.1, 200);
    this._frameCamera();
    s.background = new THREE.Color(0x04050a);
    s.fog = new THREE.FogExp2(0x04050a, 0.085);
    s.add(new THREE.HemisphereLight(0x33406a, 0x0a0806, 0.3));
    this._env = miniatureEnvironment(render.renderer);
    s.environment = this._env;
    s.environmentIntensity = 0.9;
    this._geos = [];
    this._mats = [];
    const G = (g) => (this._geos.push(g), g);
    /** World-scaled UVs (metres / texScale) + an AO gradient in vertex colours for the arch_ shader. */
    const archify = (geo, scale, aoFn) => {
      const p = geo.attributes.position;
      const uv = geo.attributes.uv;
      const c = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        if (uv) uv.setXY(i, uv.getX(i) * scale[0], uv.getY(i) * scale[1]);
        const ao = aoFn ? aoFn(v) : 1;
        c.push(ao, ao, ao);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      return geo;
    };
    const floorGeo = archify(G(new THREE.PlaneGeometry(40, 40, 40, 40)), [40 / 3, 40 / 3], (v) => Math.min(1, 0.55 + Math.hypot(v.x, v.y) * 0.25));
    const floor = new THREE.Mesh(floorGeo, getMaterial('arch_flags'));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    // Back wall of dressed ashlar, darkening toward floor and vault.
    const wallGeo = archify(G(new THREE.PlaneGeometry(30, 10, 30, 10)), [10, 10 / 3], (v) => 0.35 + 0.65 * Math.min(1, (v.y + 5) / 2.2) * Math.min(1, (5 - v.y) / 4));
    const wall = new THREE.Mesh(wallGeo, getMaterial('arch_stone'));
    wall.position.set(0, 5, -3.2);
    wall.receiveShadow = true;
    s.add(wall);
    // Pillars flanking the plinth, with plinth bases and capitals.
    for (const x of [-2.6, 2.6]) {
      const shaft = archify(G(new THREE.CylinderGeometry(0.3, 0.34, 7, 20, 7)), [2, 7 / 1.5], (v) => 0.5 + 0.5 * Math.min(1, (v.y + 3.5) / 1.5));
      const p = new THREE.Mesh(shaft, getMaterial('arch_trim'));
      p.position.set(x, 3.5, -2.3);
      p.castShadow = true;
      p.receiveShadow = true;
      s.add(p);
      const base = archify(G(new THREE.BoxGeometry(0.9, 0.35, 0.9)), [0.6, 0.25], () => 0.7);
      const b = new THREE.Mesh(base, getMaterial('arch_trim'));
      b.position.set(x, 0.175, -2.3);
      b.castShadow = true;
      b.receiveShadow = true;
      s.add(b);
    }
    // Heraldic banners hung between the pillars and the wall.
    for (const [x, v] of [[-1.3, 1], [1.3, 0]]) {
      const bt = bannerMaps(v);
      const bm = new THREE.MeshStandardMaterial({ map: bt.map, normalMap: bt.normalMap, roughnessMap: bt.roughnessMap, metalness: 0.15, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
      this._mats.push(bm);
      const bg = G(new THREE.PlaneGeometry(0.8, 2.2, 6, 12));
      const bp = bg.attributes.position;
      for (let i = 0; i < bp.count; i++) bp.setZ(i, 0.05 * Math.sin(bp.getX(i) * 7 + bp.getY(i) * 1.3) * (1.3 - bp.getY(i)) * 0.5);
      bg.computeVertexNormals();
      const banner = new THREE.Mesh(bg, bm);
      banner.position.set(x, 2.45, -3.05);
      banner.castShadow = true;
      banner.receiveShadow = true;
      s.add(banner);
      const rod = new THREE.Mesh(G(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 8)), getMaterial('gilt'));
      rod.rotation.z = Math.PI / 2;
      rod.position.set(x, 3.56, -3.02);
      s.add(rod);
    }
    // A carpet runner up to the plinth (breaks the floor's tiling) and candelabra either side.
    {
      const cc = document.createElement('canvas');
      cc.width = 128;
      cc.height = 512;
      const g = cc.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#5a1416';
      g.fillRect(0, 0, 128, 512);
      for (let y = 0; y < 512; y += 2) {
        g.fillStyle = `rgba(0,0,0,${0.06 + 0.06 * Math.sin(y * 0.7)})`;
        g.fillRect(0, y, 128, 1);
      }
      g.strokeStyle = '#c99a48';
      g.lineWidth = 6;
      g.strokeRect(10, -10, 108, 540);
      g.lineWidth = 2;
      g.strokeRect(20, -10, 88, 540);
      for (let y = 30; y < 512; y += 64) {
        g.fillStyle = '#b8873c';
        g.beginPath();
        g.moveTo(64, y - 14); g.lineTo(78, y); g.lineTo(64, y + 14); g.lineTo(50, y);
        g.closePath();
        g.fill();
      }
      const ct = new THREE.CanvasTexture(cc);
      ct.colorSpace = THREE.SRGBColorSpace;
      ct.anisotropy = 8;
      const cm = new THREE.MeshStandardMaterial({ map: ct, roughness: 0.95 });
      this._mats.push(cm);
      this._texs = [ct];
      const carpet = new THREE.Mesh(G(new THREE.PlaneGeometry(1.5, 7)), cm);
      carpet.rotation.x = -Math.PI / 2;
      carpet.position.set(0, 0.006, 3.6);
      carpet.receiveShadow = true;
      s.add(carpet);
      // Candelabra: iron stands with three candles each.
      const iron = new THREE.MeshStandardMaterial({ color: 0x2a2724, metalness: 0.8, roughness: 0.45 });
      const wax = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x402010, emissiveIntensity: 0.3 });
      this._mats.push(iron, wax);
      this._candles = [];
      for (const x of [-1.55, 1.55]) {
        const stand = new THREE.Group();
        const pole = new THREE.Mesh(G(new THREE.CylinderGeometry(0.025, 0.04, 1.45, 10)), iron);
        pole.position.y = 0.72;
        pole.castShadow = true;
        stand.add(pole);
        const foot = new THREE.Mesh(G(new THREE.CylinderGeometry(0.18, 0.22, 0.05, 16)), iron);
        foot.position.y = 0.025;
        stand.add(foot);
        const arm = new THREE.Mesh(G(new THREE.TorusGeometry(0.17, 0.012, 6, 24, Math.PI)), iron);
        arm.position.y = 1.36;
        arm.rotation.z = Math.PI;
        stand.add(arm);
        for (const dx of [-0.17, 0, 0.17]) {
          const c = new THREE.Mesh(G(new THREE.CylinderGeometry(0.018, 0.02, 0.16, 10)), wax);
          c.position.set(dx, dx === 0 ? 1.55 : 1.44, 0);
          stand.add(c);
          const f = createFlame(0.06);
          f.position.set(dx, (dx === 0 ? 1.55 : 1.44) + 0.08, 0);
          stand.add(f);
        }
        const l = new THREE.PointLight(0xffb060, 3.2, 5, 1.8);
        l.position.set(0, 1.62, 0);
        stand.add(l);
        this._candles.push(l);
        stand.position.set(x * 0.82, 0, 0.9);
        s.add(stand);
      }
    }
    // Dust motes drifting in the spotlight.
    const N = 70;
    const mg = G(new THREE.BufferGeometry());
    this._motePos = new Float32Array(N * 3);
    mg.setAttribute('position', new THREE.BufferAttribute(this._motePos, 3));
    const mm = new THREE.PointsMaterial({ map: getGlowTexture(), color: 0xffe0a8, size: 0.05, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    this._mats.push(mm);
    this._motes = new THREE.Points(mg, mm);
    this._motes.frustumCulled = false;
    s.add(this._motes);
    // Plinth.
    const plinth = new THREE.Mesh(archify(G(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 48)), [3, 0.35], (v) => 0.55 + (v.y + 0.25) * 0.9), getMaterial('arch_trim'));
    plinth.position.y = 0.25;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    s.add(plinth);
    const trim = new THREE.Mesh(G(new THREE.TorusGeometry(0.77, 0.022, 8, 64)), new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.3 }));
    this._trimMat = trim.material;
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.5;
    s.add(trim);
    // Key spot from above, torches on the wall, cool rim from behind.
    const spot = new THREE.SpotLight(0xfff0dc, 15, 14, 0.36, 0.6, 1.4);
    spot.position.set(1.4, 6.2, 3.0);
    spot.target.position.set(0, 1, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0015;
    s.add(spot, spot.target);
    const rim = new THREE.DirectionalLight(0x7f9fff, 1.1);
    rim.position.set(-3, 3, -4);
    s.add(rim);
    this.torches = [-2.6, 2.6].map((x, i) => {
      const t = createTorch({ intensity: 7, distance: 9, seed: i * 7 + 1, flame: true, flameScale: 0.3 });
      t.position.set(x, 2.5, -1.85);
      s.add(t);
      return t;
    });
    this.figureRoot = new THREE.Group();
    this.figureRoot.position.y = 0.5;
    s.add(this.figureRoot);
  }

  /** Place the figure in the free space between the main panel and the card. */
  _frameCamera() {
    const cam = this.camera;
    cam.aspect = this.ctx.render.aspect;
    cam.position.set(0, 2.1, 7.6);
    cam.lookAt(0, 1.3, 0);
    if (this.ctx.debug?.raw?.figcam === 'close') {
      cam.position.set(0, 2.72, 1.2);
      cam.lookAt(0, 2.66, 0);
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
      return;
    }
    // Shift the projection so the plinth sits at ~57% of the screen width.
    const w = 1000;
    cam.setViewOffset(w * cam.aspect, w, -w * cam.aspect * 0.075, 0, w * cam.aspect, w);
    cam.updateProjectionMatrix();
  }

  _updateFigure() {
    const d0 = this.step === 'party' ? this.newParty[this.hubSel] : this.draft;
    if (!d0) return;
    // The miniature wears what the character has actually readied (the starting kit for a draft),
    // never the class's generic look: no shield on a figure whose kit has none.
    const inv = Array.isArray(d0.inventory) ? d0.inventory : (this._preview()?.inventory ?? kitFor(d0.classSpec, d0.race).filter((id) => ITEMS[id] && ITEMS[id].type !== 'ammo').map((id) => ({ id, equipped: true })));
    const d = { ...d0, inventory: inv };
    const key = JSON.stringify([d.race, d.gender, d.classSpec, d.look, inv.filter((e) => e.equipped).map((e) => e.id)]);
    if (key === this._figKey) return;
    this._figKey = key;
    const build = () => {
      if (this._figKey !== key || !this.figureRoot) return;
      // The old figure is disposed only after the new one has drawn, so its compiled programs are
      // reused rather than released and relinked (seconds under software GL).
      for (const c of [...this.figureRoot.children]) {
        this.figureRoot.remove(c);
        (this._retired ??= []).push(c);
      }
      this._retireAt = (this._frameNo ?? 0) + 2;
      const f = buildMiniature({ ...d, look: { ...d.look } }, { pose: 'stand', rayHead: true, headGain: 0.9 });
      this._dirty3d = true;
      f.scale.setScalar(1.42);
      this.figureRoot.add(f);
    };
    // Interactive: let the panel repaint first, then sculpt the miniature on a later tick.
    if (this.ctx.debug?.frozen || !this.figureRoot.children.length) build();
    else setTimeout(build, 40);
  }

  // ------------------------------------------------------------------ state

  resetDraft() {
    this.draft = { race: 'human', gender: 'male', classSpec: 'fighter', alignment: 'LG', method: '4d6', abilities: null, dice: null, buy: null, name: '', look: { seed: this.rng.int(1, 1e9), head: this.rng.int(0, 7) } };
    this.editing = null;
  }

  _loadRoster() {
    if (this.ctx.debug?.nosave) return [];
    try {
      return JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  _saveRoster() {
    if (this.ctx.debug?.nosave) return;
    try {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(this.roster.slice(-24)));
    } catch {
      /* storage unavailable */
    }
  }

  /** Roll abilities with the chosen method, keeping the dice for display. */
  roll() {
    const d = this.draft;
    if (d.method === 'buy') return this._initBuy();
    const r = this.rng;
    let a;
    let dice;
    for (let i = 0; i < 200; i++) {
      dice = {};
      const raw = {};
      for (const k of ABILITIES) {
        const n = d.method === '3d6' ? 3 : 4;
        const ds = Array.from({ length: n }, () => r.die(6));
        dice[k] = ds;
        const sorted = [...ds].sort((x, y) => x - y);
        raw[k] = (n === 4 ? sorted.slice(1) : sorted).reduce((t, v) => t + v, 0);
      }
      a = applyRace(raw, d.race, d.gender);
      if (meetsClassMinimums(a, d.classSpec)) break;
    }
    for (const c of splitClasses(d.classSpec)) for (const [k, v] of Object.entries(CLASSES[c].minAbilities)) a[k] = Math.max(a[k], v);
    a.strPct = rollExceptionalStr(r, a, d.race, d.classSpec, d.gender);
    d.abilities = a;
    d.dice = dice;
    this.ctx.audio?.sfx?.('coins');
  }

  _initBuy() {
    const d = this.draft;
    const prio = { fighter: ['str', 'con', 'dex'], cleric: ['wis', 'con', 'str'], magicUser: ['int', 'dex', 'con'], thief: ['dex', 'con', 'str'] };
    const order = [...new Set([...splitClasses(d.classSpec).flatMap((c) => prio[c]), 'con', 'dex', 'str', 'wis', 'int', 'cha'])];
    const plan = [16, 15, 14, 12, 10, 9];
    d.buy = Object.fromEntries(order.map((k, i) => [k, plan[i] ?? 9]));
    d.strPctRoll = this.rng.int(1, 100);
    this._applyBuy();
  }

  _applyBuy() {
    const d = this.draft;
    const a = applyRace({ ...d.buy }, d.race, d.gender);
    const cap = raceAbilityCaps(d.race, d.gender).maxStrPct;
    a.strPct = a.str === 18 && splitClasses(d.classSpec).includes('fighter') && cap ? Math.min(cap, d.strPctRoll ?? 50) : 0;
    d.abilities = a;
    d.dice = null;
  }

  _problems() {
    const d = this.draft;
    if (!d.abilities) return ['roll abilities'];
    return validateConcept({ race: d.race, classSpec: d.classSpec, alignment: d.alignment, abilities: d.abilities, gender: d.gender });
  }

  _preview() {
    const d = this.draft;
    if (!d.abilities) return null;
    try {
      return settleKit(createCharacter({ rng: this.rng.fork(7), name: d.name || 'Adventurer', race: d.race, classSpec: d.classSpec, gender: d.gender, alignment: d.alignment, abilities: d.abilities, items: kitFor(d.classSpec, d.race) }));
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ navigation

  show(step) {
    this.step = step;
    const d = this.draft;
    if (step !== 'party' && (step === 'stats' || STEPS.findIndex((s) => s[0] === step) > 3) && (!d.abilities || this._problems().some((p) => /minimum|too|strength/.test(p)))) this.roll();
    this._renderSteps();
    this._renderMain();
    this._renderCard();
    this._renderBar();
    this.figureRoot.visible = step !== 'party' || this.newParty.length > 0;
    // The pedestal figure is re-sculpted for a new look: let the panel paint first (interactive runs).
    if (this.ctx.debug?.frozen) this._updateFigure();
    else setTimeout(() => { if (!this._gone) this._updateFigure(); }, 40);
  }

  next() {
    const i = STEPS.findIndex((s) => s[0] === this.step);
    if (this.step === 'stats' && this._problems().length) return this.ctx.ui.toast('These scores do not suit the class.');
    if (i >= 0 && i < STEPS.length - 1) this.show(STEPS[i + 1][0]);
    else if (this.step === 'name') this.keep();
  }

  back() {
    const i = STEPS.findIndex((s) => s[0] === this.step);
    if (this.step === 'party') return this.ctx.scenes.goto('title');
    if (i > 0) this.show(STEPS[i - 1][0]);
    else this.show('party');
  }

  _renderSteps() {
    clear(this.stepsEl);
    this.stepsEl.style.display = this.step === 'party' ? 'none' : '';
    const cur = STEPS.findIndex((s) => s[0] === this.step);
    STEPS.forEach(([id, label], i) => {
      if (i) this.stepsEl.append(h('span.cc-sep'));
      this.stepsEl.append(h(`button.cc-step${i === cur ? '.cur' : i < cur ? '.done' : ''}`, { disabled: i > cur + 1, onclick: () => i <= cur + 1 && this.show(id) }, [h('span.num', [i < cur ? '✓' : String(i + 1)]), label]));
    });
  }

  _renderBar() {
    const step = this.step;
    const cmds = [];
    if (step === 'party') {
      const n = this.newParty.length;
      cmds.push(
        { id: 'create', label: 'Create', key: 'C', tip: 'Create a new character', disabled: n >= 6, onSelect: () => { this.resetDraft(); this.show('race'); } },
        { id: 'add', label: 'Add', key: 'A', tip: 'Add a saved character to the party', disabled: n >= 6 || !this.roster.length, onSelect: () => this.addFromRoster() },
        { id: 'drop', label: 'Drop', key: 'D', tip: 'Remove the selected character from the party', disabled: !n, onSelect: () => this.dropSel() },
        { id: 'modify', label: 'Modify', key: 'M', tip: 'Change the selected character\'s name and portrait', disabled: !n, onSelect: () => this.modifySel() },
        { id: 'view', label: 'View', key: 'V', tip: 'Character sheet', disabled: !n, onSelect: () => this.viewSel() },
        { id: 'train', label: 'Train', key: 'T', tip: 'Advance a level (at a Training Hall, for 1,000 gp)', disabled: !n, onSelect: () => this.trainSel() },
        { id: 'load', label: 'Load', key: 'L', tip: 'Load a saved game', onSelect: () => this.loadGame() },
        { id: 'save', label: 'Save', key: 'S', tip: 'Save this party as a new game', disabled: !n, onSelect: () => this.saveGame() },
        { id: 'begin', label: 'Begin Adventuring', key: 'B', tip: 'Enter the city of Phlan', disabled: !n, onSelect: () => this.begin() },
        { id: 'exit', label: 'Exit', key: 'E', tip: 'Back to the title', onSelect: () => this.ctx.scenes.goto('title') },
      );
    } else {
      if (step === 'stats') cmds.push({ id: 'reroll', label: this.draft.method === 'buy' ? 'Reset' : 'Reroll', key: 'R', tip: 'Roll the dice again', onSelect: () => { this.roll(); this.show('stats'); } });
      if (step === 'portrait') cmds.push({ id: 'random', label: 'Random', key: 'R', tip: 'A random face', onSelect: () => this.randomLook() });
      if (step === 'name') cmds.push({ id: 'keep', label: this.editing ? 'Save' : 'Keep', key: 'K', tip: 'Add this character to the party', onSelect: () => this.keep() });
      else cmds.push({ id: 'next', label: 'Next', key: 'N', tip: 'Continue', onSelect: () => this.next() });
      cmds.push({ id: 'back', label: 'Back', key: 'B', tip: 'Previous step', onSelect: () => this.back() });
      cmds.push({ id: 'exit', label: 'Exit', key: 'X', tip: 'Abandon this character', onSelect: () => { this.resetDraft(); this.show('party'); } });
    }
    this.bar.title = step === 'party' ? 'Party:' : step === 'stats' ? 'Keep these scores?' : '';
    this.bar.set(cmds.map((c) => ({ ...c, onSelect: () => { if (!this.ctx.ui.layers.modal.children.length) c.onSelect(); } })));
  }

  // ------------------------------------------------------------------ card

  _renderCard() {
    const b = clear(this.card.body);
    const d = this.draft;
    if (this.step === 'party') {
      const ch = this.newParty[this.hubSel];
      this.card.title.textContent = 'Party of Phlan';
      if (ch) {
        // The painting is already large in the party grid: here a cameo beside the name, leaving the
        // card room for the kit and the company check.
        b.append(h('div.cc-hubhead', [
          h('div.cc-cameo', [portraitImg(ch, 0.28, { alt: ch.name })]),
          h('div', [h('div.cc-card-name.por-gilt-text', [ch.name]),
            h('div.cc-card-sub', [h('div', [h('b', [`${RACES[ch.race].name} ${classSpecName(ch.classSpec)}`])]), h('div', [`${ALIGNMENT_NAMES[ch.alignment]} · level ${deriveStats(ch).levels}`])])]),
        ]));
        const s = deriveStats(ch);
        b.append(h('div.pc-bigrow', [
          h('div.pc-big', [h('span.n', [String(ch.hp.max)]), h('span.l', ['HP'])]),
          h('div.pc-big', [h('span.n', [String(s.ac)]), h('span.l', ['AC'])]),
          h('div.pc-big', [h('span.n', [String(s.thac0)]), h('span.l', ['THAC0'])]),
        ]));
        b.append(this._abStrip(s.abilities, ch.classSpec));
        const kit = (ch.inventory ?? []).filter((e) => e.equipped && ITEMS[e.id]);
        b.append(h('div.pc-sect-h', [h('span', ['Readied'])]), h('div.cc-kit', kit.map((e) => h('div.cc-kit-row', { dataset: { tip: ITEMS[e.id].desc ?? itemName(e) } }, [
          h('img', { src: itemIconURL(iconFor(ITEMS[e.id]), { magic: !!(e.magic || ITEMS[e.id].magic) }), alt: '' }), h('span', [itemName(e)]),
        ]))));
        const aw = ammoProblem(ch), ah = !aw && ammoHint(ch);
        if (aw) b.append(h('div.pc-warn', { dataset: { tip: 'Arrows need a bow and quarrels a crossbow readied in the weapon hand; otherwise they cannot be fired. VIEW → ITEMS to ready the launcher.' } }, ['⚠ ', aw]));
        else if (ah) b.append(h('div.pc-note', { dataset: { tip: 'The arrows sit readied in the quiver, but the bow is not in hand: READY it (VIEW → ITEMS) when you want to shoot — it takes both hands, so the shield is slung.' } }, ['➶ ', ah]));
      } else {
        b.append(h('p.cc-lead', { style: { textAlign: 'center', marginTop: '2em' } }, [CREATE_TEXT.emptyParty]));
      }
      if (this.newParty.length >= 2) b.append(this._companyCheck());
      b.append(h('div', { style: { flex: '1' } }));
      const R = this.roster;
      b.append(h('div.pc-sect-h', [h('span', [R.length ? `Roster · ${R.length} kept` : 'Roster'])]));
      if (R.length) b.append(h('div.cc-rosterstrip', R.slice(-8).map((c) => miniPortrait(c, { tip: `${c.name} — ${RACES[c.race]?.name ?? ''} ${classSpecName(c.classSpec)}. ADD brings them into the party.` }))));
      b.append(h('p.pc-rest-note', { style: { fontSize: '0.8em' } }, [R.length ? CREATE_TEXT.roster : CREATE_TEXT.rosterEmpty]));
      return;
    }
    this.card.title.textContent = this.editing ? 'Modify' : 'New Adventurer';
    b.append(portraitEl(d));
    b.append(h('div.cc-card-name.por-gilt-text', [d.name || 'Nameless']));
    b.append(h('div.cc-card-sub', [
      h('div', [h('b', [`${RACES[d.race].name} ${d.gender === 'female' ? 'Female' : 'Male'}`])]),
      h('div', [classSpecName(d.classSpec)]),
      h('div', [ALIGNMENT_NAMES[d.alignment]]),
    ]));
    const pv = this._preview();
    if (pv) {
      const s = deriveStats(pv);
      b.append(h('div.pc-bigrow', [
        h('div.pc-big', { dataset: { tip: STAT_TIPS.hp(pv).text } }, [h('span.n', [String(pv.hp.max)]), h('span.l', ['HP'])]),
        h('div.pc-big', { dataset: { tip: STAT_TIPS.ac(s).text } }, [h('span.n', [String(s.ac)]), h('span.l', ['AC'])]),
        h('div.pc-big', { dataset: { tip: STAT_TIPS.thac0(s).text } }, [h('span.n', [String(s.thac0)]), h('span.l', ['THAC0'])]),
      ]));
      b.append(this._abStrip(pv.abilities, d.classSpec));
    }
    b.append(h('div', { style: { flex: '1' } }));
    b.append(h('div.pc-sect-h', [h('span', [`Party ${this.newParty.length}/6`])]));
    b.append(h('div.cc-party', Array.from({ length: 6 }, (_, i) => (this.newParty[i] ? miniPortrait(this.newParty[i], { tip: this.newParty[i].name }) : h('div.slot-empty', [String(i + 1)])))));
  }

  /** The six scores at a glance (hover for the rules). */
  _abStrip(a, classSpec) {
    return h('div.cc-abstrip', ['str', 'int', 'wis', 'dex', 'con', 'cha'].map((k) => {
      const v = a[k];
      const tip = abilityTip(k, a, classSpec);
      return h(`div.cc-ab${v >= 16 ? '.hi' : v <= 6 ? '.lo' : ''}`, { dataset: { tip: tip.text, tipTitle: tip.title } }, [
        h(`span.v${k === 'str' && v === 18 && a.strPct ? '.long' : ''}`, [k === 'str' ? formatStr(v, a.strPct) : String(v)]),
        h('span.k', [k.toUpperCase()]),
      ]);
    }));
  }

  // ------------------------------------------------------------------ main panel

  _renderMain() {
    const b = clear(this.main.body);
    const d = this.draft;
    const title = (t, lead) => [h('div.cc-title', [t]), lead ? h('p.cc-lead', [lead]) : null];
    const fn = {
      party: () => this._mainParty(b),
      race: () => {
        this.main.title.textContent = 'Race';
        b.append(...title('Choose a Race', CREATE_TEXT.race));
        b.append(h('div.cc-row', [h('span.k', ['Gender']), h('div.pc-subtabs', { style: { margin: 0 } }, [['male', 'Male'], ['female', 'Female']].map(([g, l]) =>
          h(`button.pc-tab${d.gender === g ? '.sel' : ''}`, { onclick: () => { d.gender = g; d.look.head = undefined; d.abilities = null; this.show('race'); } }, [l])))]));
        b.append(h('div.cc-scroll', [
          h('div.cc-grid.c2', { style: { marginTop: '0.6em' } }, RACE_IDS.map((r) => {
            const look = defaultLook({ race: r, gender: d.gender, classSpec: RACES[r].classes[0], look: { seed: 4242 + r.length * 17, head: 0, body: r === 'elf' ? 4 : 0 } });
            return h(`button.cc-opt.race${d.race === r ? '.sel' : ''}`, {
              onclick: () => {
                d.race = r;
                if (!RACES[r].classes.includes(d.classSpec)) d.classSpec = RACES[r].classes[0];
                d.look.skin = undefined;
                d.look.hair = undefined;
                d.abilities = null;
                this.show('race');
              },
            }, [
              portraitImg({ race: r, gender: d.gender, classSpec: 'fighter', look }, 0.3),
              h('div', [h('div.t', [RACES[r].name]), h('div.d', [CREATE_TEXT.raceShort[r]])]),
            ]);
          })),
          this._raceInfo(),
        ]));
      },
      class: () => {
        this.main.title.textContent = 'Class';
        const r = RACES[d.race];
        b.append(...title(`Choose a Class`, CREATE_TEXT.cls));
        const singles = r.classes.filter((c) => !c.includes('/'));
        const multis = r.classes.filter((c) => c.includes('/'));
        const opt = (c) => h(`button.cc-opt${d.classSpec === c ? '.sel' : ''}`, {
          onclick: () => { d.classSpec = c; if (!allowedAlignments(c).includes(d.alignment)) d.alignment = allowedAlignments(c)[0]; d.abilities = null; d.look.head = undefined; d.look.body = undefined; this.show('class'); },
        }, [h('div.t', [classSpecName(c)]), h('div.d', [c.includes('/') ? CREATE_TEXT.multi(splitClasses(c)) : `d${CLASSES[c].hitDie} hit die · prime ${CLASSES[c].primeReq.join('').toUpperCase()} · cap ${PR_LEVEL_CAPS[c]}`])]);
        b.append(h('div.cc-scroll', [
          h('div.pc-sect-h.left', [h('span', ['Single class'])]),
          h('div.cc-grid.c2', singles.map(opt)),
          multis.length ? h('div.pc-sect-h.left', { style: { marginTop: '0.9em' } }, [h('span', [`Multi-class (${r.name} only)`])]) : null,
          multis.length ? h('div.cc-grid.c2', multis.map(opt)) : null,
          multis.length ? null : h('div.pc-sect-h.left', { style: { marginTop: '0.9em' } }, [h('span', ['Dual class'])]),
          multis.length ? null : h('p.pc-rest-note', { style: { margin: '0.2em 0 0' } }, ['Humans cannot multi-class. Instead a human of 15+ in the old prime requisite and 17+ in the new may later abandon one calling for another at the Training Hall, regaining the old skills once the new class surpasses it.']),
          this._classInfo(),
        ]));
      },
      align: () => {
        this.main.title.textContent = 'Alignment';
        b.append(...title('Choose an Alignment', CREATE_TEXT.align));
        const allowed = allowedAlignments(d.classSpec);
        b.append(h('div.cc-grid.c3', ALIGNMENTS.map((al) => h(`button.cc-opt.align${d.alignment === al ? '.sel' : ''}`, {
          disabled: !allowed.includes(al),
          dataset: { tip: ALIGNMENT_TEXT[al] },
          onclick: () => { d.alignment = al; this.show('align'); },
        }, [h('div.t', [ALIGNMENT_NAMES[al]]), h('div.d', [al])]))));
        b.append(h('div.pc-sect.cc-info', [h('div.pc-sect-h', [h('span', [ALIGNMENT_NAMES[d.alignment]])]), h('p', [ALIGNMENT_TEXT[d.alignment]]),
          allowed.length < 9 ? h('p', { style: { color: 'var(--por-text-dim)' } }, [`${classSpecName(d.classSpec)}s may not be ${ALIGNMENTS.filter((x) => !allowed.includes(x)).map((x) => ALIGNMENT_NAMES[x]).join(' or ')}.`]) : null]));
      },
      stats: () => this._mainStats(b),
      portrait: () => this._mainPortrait(b),
      name: () => this._mainName(b),
    };
    fn[this.step]();
  }

  _raceInfo() {
    const r = RACES[this.draft.race];
    const adj = Object.entries(r.adjust).map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`).join(', ') || 'none';
    return h('div.pc-sect.cc-info', [
      h('div.pc-sect-h', [h('span', [r.name])]),
      h('p', [r.desc]),
      h('p', [h('span.k', ['Abilities']), adj, h('span.k', { style: { marginLeft: '1em' } }, ['Move']), String(r.move), h('span.k', { style: { marginLeft: '1em' } }, ['Infravision']), r.infravision ? `${r.infravision}'` : 'none']),
      h('p', [h('span.k', ['Classes']), r.classes.map(classSpecName).join(', ')]),
      h('p', [h('span.k', ['Racial level limits']), levelLimitText(this.draft.race), h('span', { style: { color: 'var(--por-text-dim)' } }, [' (Phlan caps all: F8 C6 MU6 T9)'])]),
    ]);
  }

  _classInfo() {
    const d = this.draft;
    const cs = splitClasses(d.classSpec);
    return h('div.pc-sect.cc-info', [
      h('div.pc-sect-h', [h('span', [classSpecName(d.classSpec)])]),
      ...cs.map((c) => h('p', [h('span.k', [CLASSES[c].name]), CLASSES[c].desc, ` Needs ${Object.entries(CLASSES[c].minAbilities).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}.`])),
      h('p', [h('span.k', ['Arms']), cs.map((c) => (CLASSES[c].weapons === 'any' ? 'any weapon' : CLASSES[c].weapons.join(', '))).join(' / ')]),
      h('p', [h('span.k', ['Armour']), cs.map((c) => (CLASSES[c].armor === 'any' ? 'any armour & shield' : CLASSES[c].armor === 'none' ? 'none' : CLASSES[c].armor.join(', '))).join(' / ')]),
      cs.length > 1 ? h('p', { style: { color: 'var(--por-text-dim)' } }, [CREATE_TEXT.multiNote]) : null,
    ]);
  }

  _mainStats(b) {
    const d = this.draft;
    this.main.title.textContent = 'Abilities';
    b.append(h('div.cc-title', [`${RACES[d.race].name} ${classSpecName(d.classSpec)}`]), h('p.cc-lead', [CREATE_TEXT.stats[d.method]]));
    b.append(h('div.cc-methods', [['4d6', '4d6 Drop Lowest'], ['3d6', 'Classic 3d6'], ['buy', 'Point Buy']].map(([m, l]) =>
      h(`button.pc-tab${d.method === m ? '.sel' : ''}`, { onclick: () => { d.method = m; this.roll(); this.show('stats'); } }, [l]))));
    const a = d.abilities;
    let spent = 0;
    if (d.method === 'buy') {
      spent = ABILITIES.reduce((t, k) => t + buyCost(d.buy[k]), 0);
      b.append(h('div.cc-points', [`Points remaining: ${BUY_POOL - spent} of ${BUY_POOL}`]));
    }
    const rows = ABILITIES.map((k) => {
      const v = a[k];
      const tail = d.method === 'buy'
        ? h('span.adj', [
          h('button', { disabled: d.buy[k] <= 3, onclick: () => { d.buy[k]--; this._applyBuy(); this.show('stats'); } }, ['−']),
          h('button', { disabled: d.buy[k] >= 18 || spent + buyCost(d.buy[k] + 1) - buyCost(d.buy[k]) > BUY_POOL, onclick: () => { d.buy[k]++; this._applyBuy(); this.show('stats'); } }, ['+']),
        ])
        : h('span.dice', (d.dice?.[k] ?? []).map((x, i, arr) => {
          const drop = arr.length === 4 && i === arr.indexOf(Math.min(...arr));
          return h(`span.cc-die${drop ? '.drop' : ''}`, [String(x)]);
        }));
      return h('div.cc-abrow', { dataset: { tip: `${ABILITY_NAMES[k]}: ${abilityMods(k, a, d.classSpec)}` } }, [
        h('span.abbr', [ABILITY_ABBR[k]]),
        h(`span.val${v >= 16 ? '.hi' : v <= 6 ? '.lo' : ''}`, [k === 'str' ? formatStr(v, a.strPct) : String(v)]),
        h('span.mods', [h('div', { style: { color: 'var(--por-text)' } }, [ABILITY_NAMES[k]]), abilityMods(k, a, d.classSpec)]),
        tail,
      ]);
    });
    const pv = this._preview();
    const s = pv && deriveStats(pv);
    const probs = this._problems();
    b.append(h('div.cc-scroll', [
      h('div.pc-sect', rows),
      s ? h('div.cc-derived', [
        ['Hit Points', pv.hp.max], ['Armor Class', s.ac], ['THAC0', s.thac0], ['Damage', `${s.damage}${s.dmgBonus ? (s.dmgBonus > 0 ? `+${s.dmgBonus}` : s.dmgBonus) : ''}`],
        ['Move', s.move], ['Age', pv.age], ['Gold', pv.gold], ['Phlan cap', splitClasses(d.classSpec).map((c) => Math.min(PR_LEVEL_CAPS[c], RACES[d.race].levelLimits[c] ?? 99)).join('/')],
      ].map(([l, v]) => h('div.pc-big', [h('span.n', { style: { fontSize: '1.25em' } }, [String(v)]), h('span.l', [l])]))) : null,
      probs.length ? h('p', { style: { color: '#ff9a86', fontSize: '0.85em', marginTop: '0.6em' } }, [`Not allowed: ${probs.join('; ')}.`]) : null,
      this._requirements(),
    ]));
  }

  _requirements() {
    const d = this.draft;
    const a = d.abilities;
    const cs = splitClasses(d.classSpec);
    const lines = cs.map((c) => h('div.cc-row', [
      h('span.k', [CLASSES[c].name]),
      h('span', Object.entries(CLASSES[c].minAbilities).map(([k, v]) => h(`span.pc-chip${a[k] >= v ? '.good' : '.warn'}`, [`${k.toUpperCase()} ${v}+ ${a[k] >= v ? '✓' : '✗'}`]))),
    ]));
    const notes = [];
    if (cs.length === 1) {
      const pr = CLASSES[cs[0]].primeReq[0];
      notes.push(a[pr] >= 16 ? `Prime requisite ${pr.toUpperCase()} ${a[pr]}: +10% experience.` : `A prime requisite (${pr.toUpperCase()}) of 16+ would grant +10% experience.`);
    } else notes.push('Multi-class characters earn no prime requisite bonus.');
    if (cs.includes('fighter')) notes.push(a.str === 18 ? `Exceptional strength 18/${a.strPct === 100 ? '00' : String(a.strPct).padStart(2, '0')}.` : 'Fighters with 18 STR roll exceptional strength.');
    return h('div.pc-sect', { style: { marginTop: '0.8em' } }, [
      h('div.pc-sect-h', [h('span', ['Requirements'])]),
      ...lines,
      h('p.pc-rest-note', { style: { margin: '0.5em 0 0' } }, [notes.join(' ')]),
    ]);
  }

  _mainPortrait(b) {
    const d = this.draft;
    this.main.title.textContent = 'Portrait';
    const look = (d.look = defaultLook(d));
    b.append(h('div.cc-title', ['Choose a Likeness']), h('p.cc-lead', [CREATE_TEXT.portrait]));
    const thumbs = (list, key, mk, cls = '', crop = 'head') => h(`div.cc-thumbs${cls}`, list.map((it, i) => h(`button.cc-thumb${look[key] === i ? '.sel' : ''}`, { onclick: () => { d.look = { ...look, [key]: i }; this.show('portrait'); }, dataset: { tip: it.name } }, [
      h('div.im', [portraitImg(mk(i), crop === 'head' ? 0.46 : 0.34, { crop })]), h('span', [it.name]),
    ])));
    // Each swatch is named (in its tooltip and beside the row for the chosen one): 'Auburn', 'Hazel'.
    const sw = (colors, key, names) => h('div.cc-sw', colors.map((c, i) => h(`button${look[key] === i ? '.sel' : ''}`, { style: { background: c }, 'aria-label': names[i], dataset: { tip: names[i] }, onclick: () => { d.look = { ...look, [key]: i }; this.show('portrait'); } })));
    const skinIds = RACE_SKINS[d.race] ?? RACE_SKINS.human;
    const skins = skinIds.map((k) => SKIN_TONES[k]);
    const cap = (w) => w[0].toUpperCase() + w.slice(1);
    const skinNames = skinIds.map(cap);
    const hairNames = HAIR_COLORS.map((x) => x[0]);
    const eyeNames = EYE_NAMES;
    const clothNames = CLOTH_COLORS.map((x) => x[0]);
    const swRow = (label, colors, key, names) => h('div.cc-row', [h('span.k', [label]), sw(colors, key, names), h('span.cc-swname', [names[(look[key] ?? 0) % names.length]])]);
    b.append(h('div.cc-scroll.cc-likeness', [
      h('div.pc-sect-h.left', [h('span', ['Head'])]),
      thumbs(HEADS[d.gender], 'head', (i) => ({ ...d, look: { ...look, head: i } })),
      h('div.pc-sect-h.left', { style: { marginTop: '0.8em' } }, [h('span', ['Body'])]),
      thumbs(BODIES, 'body', (i) => ({ ...d, look: { ...look, body: i } }), '.body', 'torso'),
      h('div.pc-sect', { style: { marginTop: '0.8em' } }, [
        swRow('Skin', skins, 'skin', skinNames),
        swRow('Hair', HAIR_COLORS.map((x) => x[1]), 'hair', hairNames),
        swRow('Eyes', EYE_COLORS, 'eyes', eyeNames),
        swRow('Colours', CLOTH_COLORS.map((x) => x[1]), 'cloth', clothNames),
      ]),
      h('p.pc-rest-note', { style: { marginTop: '0.6em' } }, [this._kitNote(look)]),
    ]));
  }

  /** The plinth note: says plainly when the chosen likeness body differs from the starting kit. */
  _kitNote(look) {
    const d = this.draft;
    const armor = kitFor(d.classSpec, d.race).map((id) => ITEMS[id]).find((it) => it?.type === 'armor');
    const tmpl = BODIES[look.body % BODIES.length];
    if (bodyShowsArmor(tmpl.id, armor?.armorGroup ?? null)) return CREATE_TEXT.icon;
    const kit = armor ? (armor.name ?? 'armour').toLowerCase() : 'no armour';
    return `The likeness shows ${tmpl.name.toLowerCase()}, but your starting kit is ${kit}: on the battlefield the miniature wears what you have readied, so it will appear in ${armor ? kit : 'plain clothes'} until you buy and ready better.`;
  }

  _mainName(b) {
    const d = this.draft;
    this.main.title.textContent = 'Name';
    b.append(h('div.cc-title', ['Name Your Adventurer']), h('p.cc-lead', [CREATE_TEXT.name]));
    const input = h('input.cc-name', {
      value: d.name, maxLength: 15, placeholder: 'Name', spellcheck: false,
      oninput: (e) => { d.name = e.target.value; this._renderCard(); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.keep(); } else if (e.key === 'Escape') { e.target.blur(); } },
    });
    b.append(h('div', { style: { display: 'flex', gap: '0.5em', alignItems: 'stretch' } }, [input, h('button.por-btn', { onclick: () => { d.name = this.randomName(); this.show('name'); } }, ['Suggest'])]));
    const pv = this._preview();
    if (pv) {
      const s = deriveStats(pv);
      const a = pv.abilities;
      b.append(h('div.cc-scroll', { style: { marginTop: '1em' } }, [h('div.pc-sect', [
        h('div.pc-sect-h', [h('span', ['Summary'])]),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.4em' } }, [
          h('div.pc-kv', ABILITIES.flatMap((k) => [h('span.k', [ABILITY_ABBR[k]]), h('span.v', [k === 'str' ? formatStr(a.str, a.strPct) : String(a[k])])])),
          h('div.pc-kv', [['Hit points', pv.hp.max], ['Armor class', s.ac], ['THAC0', s.thac0], ['Damage', s.damage], ['Age', pv.age], ['Gold', pv.gold]].flatMap(([k, v]) => [h('span.k', [k]), h('span.v', [String(v)])])),
        ]),
        h('p.pc-rest-note', { style: { marginTop: '0.7em' } }, [`Starting kit: ${pv.inventory.map((e) => e.id.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')}.`]),
      ])]));
    }
    queueMicrotask(() => input.focus({ preventScroll: true }));
  }

  _mainParty(b) {
    this.main.title.textContent = 'Party';
    b.append(h('div.cc-title', ['The Adventurers']), h('p.cc-lead', [CREATE_TEXT.hub]));
    b.append(h('div.cc-scroll', [h('div.cc-hub', Array.from({ length: 6 }, (_, i) => {
      const ch = this.newParty[i];
      if (!ch) return h('button.cc-hubslot.empty', { disabled: i !== this.newParty.length, onclick: () => { this.resetDraft(); this.show('race'); } }, [i === this.newParty.length ? '+ Create' : 'Empty']);
      const s = deriveStats(ch);
      return h(`div.cc-hubslot${i === this.hubSel ? '.sel' : ''}`, { onclick: () => { this.hubSel = i; this.show('party'); }, ondblclick: () => this.viewSel() }, [
        portraitEl(ch, { scale: 0.5 }),
        h('div.nm', [ch.name]),
        h('div.cl', [`${RACES[ch.race].name} ${s.classAbbr} ${s.levels} · HP ${ch.hp.max}`]),
      ]);
    }))]));
    b.append(this._partySummary());
  }

  /** Party at a glance: front line, spell power, hit points, purse and alignments. */
  _partySummary() {
    const P = this.newParty;
    const has = (c, k) => splitClasses(c.classSpec).includes(k);
    const front = P.filter((c) => has(c, 'fighter')).length;
    const arcane = P.filter((c) => has(c, 'magicUser')).length;
    const divine = P.filter((c) => has(c, 'cleric')).length;
    const thieves = P.filter((c) => has(c, 'thief')).length;
    const hp = P.reduce((t, c) => t + c.hp.max, 0);
    const gold = P.reduce((t, c) => t + (c.gold ?? 0), 0);
    const avgAC = P.length ? (P.reduce((t, c) => t + deriveStats(c).ac, 0) / P.length).toFixed(1).replace(/\.0$/, '') : '—';
    const al = {};
    for (const c of P) al[c.alignment] = (al[c.alignment] ?? 0) + 1;
    const tile = (n, l, tip) => h('div.pc-big', { dataset: { tip } }, [h('span.n', [String(n)]), h('span.l', [l])]);
    const advice = !P.length ? 'An empty hall. Create your first adventurer.'
      : !divine ? 'No cleric: wounds will heal slowly (1 hp a day).'
        : !arcane ? 'No magic-user: Sleep and Magic Missile win the early fights.'
          : front < 2 ? 'Thin front line: the first three in the marching order take the blows.'
            : !thieves ? 'No thief: locks and traps must be braved by force.'
              : 'A balanced company. Order the strong to the front with ALTER at camp.';
    return h('div.pc-sect.cc-summary', [
      h('div.pc-sect-h', [h('span', ['The Company'])]),
      h('div.cc-sumtiles', [
        tile(front, front === 1 ? 'Fighter' : 'Fighters', 'Characters with the fighter class: the front line.'),
        tile(divine, divine === 1 ? 'Cleric' : 'Clerics', 'Divine casters: healing and protection.'),
        tile(arcane, arcane === 1 ? 'Mage' : 'Mages', 'Magic-users, the arcane casters: Sleep, Magic Missile and worse.'),
        tile(thieves, thieves === 1 ? 'Thief' : 'Thieves', 'Locks, traps and backstabs.'),
        tile(hp, 'Total HP', 'The party\'s combined hit points.'),
        tile(avgAC, 'Avg AC', 'Average armour class of the company (lower is better).'),
        tile(gold.toLocaleString('en-US'), 'Gold', 'Pooled starting gold for arms and armour.'),
      ]),
      h('div.cc-sumline', [
        ...Object.entries(al).map(([k, n]) => h('span.pc-chip', { dataset: { tip: ALIGNMENT_NAMES[k] } }, [`${k}${n > 1 ? ` ×${n}` : ''}`])),
        h('span.cc-advice', [advice]),
      ]),
    ]);
  }

  /** TRAIN: as in the original, levels are bought at a Training Hall in Phlan. */
  trainSel() {
    const ch = this.newParty[this.hubSel];
    if (!ch) return;
    const ready = splitClasses(ch.classSpec).filter((c) => (ch.xp[c] ?? 0) >= xpForLevel(c, (ch.levels[c] ?? 1) + 1));
    if (!ready.length) {
      const c = splitClasses(ch.classSpec)[0];
      const need = xpForLevel(c, (ch.levels[c] ?? 1) + 1) - (ch.xp[c] ?? 0);
      return this.ctx.ui.toast(`${ch.name} needs ${need.toLocaleString('en-US')} more XP to train.`);
    }
    this.ctx.ui.toast(`${ch.name} may train: visit a Training Hall in Phlan (1,000 gp).`);
  }

  /** LOAD a saved game from the party screen. */
  async loadGame() {
    const list = this.ctx.saves?.list?.() ?? [];
    if (!list.length) return this.ctx.ui.toast('There are no saved games.');
    const pick = await this.ctx.ui.dialog({
      title: 'Load Game', variant: 'blue', body: h('p.pc-trade-pick', ['Which game?']),
      buttons: [...list.slice(0, 6).map((r) => ({ id: r.slot, label: `${r.slot === 'auto' ? 'Auto' : r.slot} · ${r.summary}`.slice(0, 40) })), { id: null, label: 'Cancel' }],
    });
    if (!pick) return;
    const st = this.ctx.saves.load(pick);
    if (!st) return this.ctx.ui.toast('That game could not be read.');
    this.ctx.game.loadJSON(st);
    this.ctx.scenes.goto('explore', {});
  }

  /** SAVE this party as a new game (at the gates of Phlan). */
  async saveGame() {
    if (!this.newParty.length) return;
    if (this.ctx.debug?.nosave) return this.ctx.ui.toast('Saving is disabled in debug/screenshot mode.');
    const used = new Set((this.ctx.saves?.list?.() ?? []).map((r) => r.slot));
    const free = SAVE_SLOTS.filter((sl) => sl !== 'auto' && !used.has(sl));
    const slot = free[0] ?? 'A';
    if (used.has(slot)) {
      const ok = await this.ctx.ui.dialog({ title: 'Overwrite?', variant: 'blue', body: `Every slot is taken. Replace the game in slot ${slot}?`, buttons: [{ id: 'y', label: 'Overwrite', primary: true }, { id: null, label: 'Cancel' }] });
      if (ok !== 'y') return;
    }
    this.ctx.game.setParty(this.newParty.map((c) => structuredClone(c)));
    const done = this.ctx.saves.save(slot, this.ctx.game);
    this.ctx.ui.toast(done ? `Party saved to slot ${slot}.` : 'Save unavailable.');
  }

  // ------------------------------------------------------------------ actions

  randomLook() {
    const d = this.draft;
    d.look = { seed: this.rng.int(1, 1e9) };
    d.look = defaultLook(d);
    d.look.head = this.rng.int(0, 7);
    d.look.body = this.rng.int(0, BODIES.length - 1);
    this.show('portrait');
  }

  randomName() {
    const d = this.draft;
    const pool = NAMES[d.race]?.[d.gender] ?? NAMES.human[d.gender];
    return pool[this.rng.int(0, pool.length - 1)];
  }

  keep() {
    const d = this.draft;
    if (this._problems().length) return this.ctx.ui.toast('This character is not legal yet.');
    if (!d.name.trim()) d.name = this.randomName();
    if (this.editing) {
      Object.assign(this.editing, { name: d.name.trim(), look: { ...d.look } });
      this.ctx.ui.toast(`${d.name} is changed.`);
    } else {
      if (this.newParty.length >= 6) return this.ctx.ui.toast('The party is full (six).');
      const ch = settleKit(createCharacter({ rng: this.rng, name: d.name.trim(), race: d.race, classSpec: d.classSpec, alignment: d.alignment, gender: d.gender, abilities: d.abilities, items: kitFor(d.classSpec, d.race) }));
      ch.look = { ...defaultLook(d) };
      this.newParty.push(ch);
      this.roster = [...this.roster.filter((r) => r.id !== ch.id), structuredClone(ch)];
      this._saveRoster();
      this.hubSel = this.newParty.length - 1;
      this.ctx.ui.toast(`${ch.name} joins the party.`);
    }
    this.resetDraft();
    this.show('party');
  }

  /**
   * The company at a glance before setting out: who holds the front rank, who heals, who opens
   * locks, who casts, who can shoot, who sees in the dark — and what is missing.
   */
  _companyCheck() {
    const P = this.newParty;
    const has = (c, k) => splitClasses(c.classSpec).includes(k);
    const short = (c) => String(c.name ?? '').replace(/^Brother |^Sister /, '').split(' ')[0];
    const list = (arr) => arr.map(short).join(', ');
    const ranged = P.filter((c) => (c.inventory ?? []).some((e) => ITEMS[e.id]?.ranged && e.equipped));
    const packed = P.filter((c) => !ranged.includes(c) && (c.inventory ?? []).some((e) => ITEMS[e.id]?.ranged && ITEMS[e.id]?.type !== 'ammo' && !e.equipped));
    // The front rank is a real check: whoever stands in the first three should be among the
    // company's toughest (armour class and hit points); a softer member up front is flagged with
    // the swap that would fix it.
    const tough = (c) => {
      let ac = 10;
      try { ac = deriveStats(c).ac; } catch { /* default */ }
      const hp = c.hp?.max ?? 0;
      return { ac, hp, score: hp + (10 - ac) * 1.6 + (has(c, 'fighter') ? 3 : 0) + (has(c, 'cleric') ? 1.5 : 0) - (has(c, 'magicUser') && !has(c, 'fighter') ? 4 : 0) };
    };
    const front = P.slice(0, 3), back = P.slice(3);
    const weakest = front.map((c) => ({ c, t: tough(c) })).sort((a, b) => a.t.score - b.t.score)[0];
    const strongest = back.map((c) => ({ c, t: tough(c) })).sort((a, b) => b.t.score - a.t.score)[0];
    const swap = weakest && strongest && strongest.t.score > weakest.t.score + 2.5 ? { out: weakest, in: strongest } : null;
    const frontV = swap
      ? `${short(swap.out.c)} (AC ${swap.out.t.ac}, ${swap.out.t.hp}hp) → swap in ${short(swap.in.c)} (AC ${swap.in.t.ac}, ${swap.in.t.hp}hp)`
      : list(front);
    const frontTip = swap
      ? `The first three in the marching order meet the enemy first. ${swap.in.c.name} is tougher than ${swap.out.c.name}: move ${short(swap.in.c)} up with ALTER (order) at camp, or MODIFY the order here.`
      : 'The first three in the marching order meet the enemy first: fighters and clerics in good armour belong there. Reorder with ALTER at camp.';
    const missV = ranged.length ? list(ranged) + (packed.length ? ` · ${list(packed)}: not readied` : '') : packed.length ? `${list(packed)}: bow packed, not readied` : 'none';
    const rows = [
      ['Front rank', frontV, !swap, frontTip],
      ['Healing', list(P.filter((c) => has(c, 'cleric'))) || 'none', P.some((c) => has(c, 'cleric')), 'Clerics pray for cure spells and FIX the party at camp. Without one, wounds heal at a day per hit point.'],
      ['Locks & traps', list(P.filter((c) => has(c, 'thief'))) || 'none', P.some((c) => has(c, 'thief')), 'A thief opens locks, finds and removes traps, and backstabs.'],
      ['Arcane magic', list(P.filter((c) => has(c, 'magicUser'))) || 'none', P.some((c) => has(c, 'magicUser')), 'Magic-users bring sleep, magic missile and later fireball: the spells that win the hard fights.'],
      ['Missiles', missV, ranged.length > 0 && !packed.length, packed.length ? `${packed.map((c) => c.name).join(', ')} carr${packed.length > 1 ? 'y' : 'ies'} a missile weapon in the pack. READY it in ITEMS (with its ammunition) to shoot before the melee is joined.` : 'Bows and slings strike before the melee is joined. Ready the launcher in ITEMS to shoot.'],
      ['Infravision', list(P.filter((c) => (RACES[c.race]?.infravision ?? 0) > 0)) || 'none', true, 'Demi-humans see the heat of living things in the dark.'],
    ];
    return h('div.cc-check', [
      h('div.pc-sect-h', [h('span', ['Company'])]),
      ...rows.map(([k, v, ok, tip]) => h(`div.cc-check-row${ok ? '' : '.warn'}`, { dataset: { tip } }, [h('span.mk', [ok ? '✓' : '!']), h('span.k', [k]), h('span.v', [v])])),
    ]);
  }

  async addFromRoster() {
    const inParty = new Set(this.newParty.map((c) => c.id));
    const avail = this.roster.filter((c) => !inParty.has(c.id));
    if (!avail.length) return this.ctx.ui.toast('Everyone on the roster is already in the party.');
    const pick = await this.ctx.ui.dialog({
      title: 'Add Character', variant: 'blue', body: h('p', ['Who joins the party?']),
      buttons: [...avail.slice(-6).map((c) => ({ id: c.id, label: c.name })), { id: null, label: 'Cancel' }],
    });
    const ch = avail.find((c) => c.id === pick);
    if (!ch) return;
    this.newParty.push(structuredClone(ch));
    this.hubSel = this.newParty.length - 1;
    this.show('party');
  }

  dropSel() {
    const ch = this.newParty[this.hubSel];
    if (!ch) return;
    this.newParty.splice(this.hubSel, 1);
    this.hubSel = Math.max(0, Math.min(this.hubSel, this.newParty.length - 1));
    this.ctx.ui.toast(`${ch.name} leaves the party (still on the roster).`);
    this.show('party');
  }

  modifySel() {
    const ch = this.newParty[this.hubSel];
    if (!ch) return;
    this.draft = { race: ch.race, gender: ch.gender, classSpec: ch.classSpec, alignment: ch.alignment, method: '4d6', abilities: ch.abilities, dice: null, name: ch.name, look: { ...defaultLook(ch) } };
    this.editing = ch;
    this.show('portrait');
  }

  viewSel() {
    if (!this.newParty.length) return;
    const saved = this.ctx.game.party;
    this.ctx.game.party = this.newParty;
    this._viewOpen = true;
    openCharacterView(this.ctx, { index: this.hubSel, onClose: () => { this.ctx.game.party = saved; this._viewOpen = false; } });
  }

  begin() {
    if (!this.newParty.length) return;
    this.ctx.game.setParty(this.newParty);
    this.ctx.scenes.goto('explore', { map: 'phlan_slums', x: 1, y: 14, dir: 'E' });
  }

  onResize() {
    this._frameCamera();
  }

  /**
   * Behind a full-screen VIEW the hall is only glimpsed: redraw it twice a second. On a slow
   * (software) GPU it is redrawn when the miniature changes and otherwise every few seconds.
   */
  render() {
    const t = this.ctx.clock.time;
    // Frozen clock (screenshots): once the hall has settled it cannot change until the figure does;
    // present it only now and then instead of redrawing seconds-long software frames every tick.
    if (this.ctx.debug?.frozen) {
      if ((this._fz ?? 0) >= 1 && !this._dirty3d && !this._retired?.length) {
        this._idleN = (this._idleN ?? 0) + 1;
        if (this._idleN % 240 !== 0) return;
      }
      this._fz = this._dirty3d ? 0 : (this._fz ?? 0) + 1;
    }
    if (this._viewOpen && this._lastRender != null && Math.abs(t - this._lastRender) < 0.5) return;
    // On a slow (software) GPU the hall is drawn a few times a second, and less while portraits
    // are being painted, so the panels — and the portrait painter sharing the GPU — stay responsive.
    if (!this.ctx.debug?.frozen && this._lastWall != null) {
      const now = performance.now();
      const gap = this._slow ? (portraitsPending() ? 6000 : this._dirty3d ? 0 : 2500) : 0;
      if (gap && now - this._lastWall < gap) return;
    }
    const wall = performance.now();
    if (this._lastWall != null) this._slowRun = wall - this._lastWall > 110 ? (this._slowRun ?? 0) + 1 : 0;
    this._slow = this._slow || (this._slowRun ?? 0) >= 3;
    this._lastWall = wall;
    this._lastRender = t;
    // A software GPU redraws the shadow maps only every fourth frame (the hall barely moves).
    const sm = this.ctx.render.renderer.shadowMap;
    if (this._slow && !this.ctx.debug?.frozen) {
      sm.autoUpdate = false;
      this._shadowTick = ((this._shadowTick ?? 0) + 1) % 4;
      if (this._shadowTick === 1 || this._dirty3d) sm.needsUpdate = true;
    }
    this._dirty3d = false;
    super.render();
    this._frameNo = (this._frameNo ?? 0) + 1;
    if (this._retired?.length && this._frameNo >= this._retireAt) {
      for (const c of this._retired) c.userData.dispose?.();
      this._retired = [];
    }
  }

  update() {
    const t = this.ctx.clock.time;
    for (const tr of this.torches) tr.userData.update(t);
    if (this._motePos) {
      const p = this._motePos;
      for (let i = 0; i < p.length / 3; i++) {
        const h1 = Math.sin(i * 12.9898) * 43758.5453;
        const r1 = h1 - Math.floor(h1);
        const h2 = Math.sin(i * 78.233) * 12543.1;
        const r2 = h2 - Math.floor(h2);
        const ph = (t * (0.02 + r2 * 0.03) + r1) % 1;
        p[i * 3] = Math.sin(r1 * 40 + t * 0.2) * (0.3 + r2 * 1.1);
        p[i * 3 + 1] = 0.6 + ph * 3.6;
        p[i * 3 + 2] = Math.cos(r2 * 40 + t * 0.17) * (0.3 + r1 * 0.9);
      }
      this._motes.geometry.attributes.position.needsUpdate = true;
    }
    if (this.figureRoot) {
      this.figureRoot.rotation.y = this.ctx.debug?.raw?.figcam === 'close' ? 0 : -0.5 + Math.sin(t * 0.35) * 0.5;
      for (const c of this.figureRoot.children) c.userData.update?.(t);
    }
  }

  exit() {
    this.ctx.render.renderer.shadowMap.autoUpdate = true;
    this._gone = true;
    for (const c of this.figureRoot?.children ?? []) c.userData.dispose?.();
    for (const c of this._retired ?? []) c.userData.dispose?.();
    this._retired = [];
    for (const g of this._geos ?? []) g.dispose();
    this._trimMat?.dispose();
    for (const m of this._mats ?? []) m.dispose();
    for (const t of this._texs ?? []) t.dispose();
    this._env?.dispose();
    super.exit();
  }
}
