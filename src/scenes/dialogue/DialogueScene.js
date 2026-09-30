import { Scene } from '../../core/Scene.js';
import { h, Frame, CommandBar, PartyRoster } from '../../ui/UI.js';
import { getEncounter } from '../../data/encounters.js';
import { MONSTERS } from '../../data/monsters.js';

/**
 * Encounter / dialogue screen: illustrated window, narrative text and the
 * classic COMBAT / WAIT / FLEE / PARLAY choices.
 * params: {encounter: string}
 * Owned by the world-content workstream (text) + UI skin (presentation).
 */
export default class DialogueScene extends Scene {
  async enter(params = {}) {
    const enc = (this.encounter = getEncounter(params.encounter ?? 'kobolds_1'));
    this.post = {};
    const art = h('canvas', { width: 960, height: 540, style: { width: '100%', display: 'block', borderRadius: '2px' } });
    drawEncounterArt(art, enc, this.ctx.rng.fork(7));
    const text = h('p', { style: { fontSize: '1.15em', lineHeight: '1.6', margin: '0.8em 0 0.2em' } }, [enc.intro ?? `You encounter ${enc.name}.`]);
    const counts = enc.groups.map((g) => `${g.count} ${MONSTERS[g.monster].plural}`).join(', ');
    const sub = h('div.por-muted', { style: { fontStyle: 'italic' } }, [`You see: ${counts}.`]);
    const frame = Frame({ title: enc.name, variant: 'blue', children: [art, text, sub] });
    frame.el.style.cssText = 'position:absolute;left:4vw;top:7vh;width:min(58em,64vw);';
    const roster = new PartyRoster(this.ctx);
    const rf = Frame({ title: 'Party', children: [roster.el] });
    rf.el.style.cssText = 'position:absolute;right:4vw;top:7vh;width:17em;';
    const opts = enc.options ?? ['combat', 'flee'];
    const labels = { combat: ['Combat', 'C'], wait: ['Wait', 'W'], flee: ['Flee', 'F'], parley: ['Parlay', 'P'] };
    const bar = new CommandBar(opts.map((o) => ({ id: o, label: labels[o][0], key: labels[o][1], onSelect: () => this.choose(o) })));
    const bottom = h('div.por-hud-bottom', [bar.el]);
    this.ctx.ui.mount(frame.el);
    this.ctx.ui.mount(rf.el);
    this.ctx.ui.mount(bottom);
    this.own(() => { roster.dispose(); bar.dispose(); });
    this.ctx.audio.playMusic('encounter');
  }

  choose(o) {
    const { scenes, ui, rng } = this.ctx;
    if (o === 'combat') scenes.goto('combat', { encounter: this.encounter.id });
    else if (o === 'flee') {
      if (rng.chance(60)) {
        ui.message('You escape into the ruins.', 'info');
        scenes.goto('explore', {});
      } else {
        ui.message('You cannot escape!', 'warn');
        scenes.goto('combat', { encounter: this.encounter.id });
      }
    } else if (o === 'wait') {
      ui.message('Both sides regard each other warily... then they attack!', 'warn');
      scenes.goto('combat', { encounter: this.encounter.id });
    } else if (o === 'parley') {
      ui.message('Your words fall on deaf ears.', 'warn');
      scenes.goto('combat', { encounter: this.encounter.id });
    }
  }
}

/** Placeholder illustration: moody alley with silhouetted figures. */
function drawEncounterArt(canvas, enc, rng) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d1430');
  sky.addColorStop(0.6, '#3a2a3a');
  sky.addColorStop(1, '#120c10');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // moon
  const moon = g.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, 90);
  moon.addColorStop(0, 'rgba(230,235,255,1)');
  moon.addColorStop(0.3, 'rgba(200,210,255,0.5)');
  moon.addColorStop(1, 'rgba(200,210,255,0)');
  g.fillStyle = moon;
  g.fillRect(0, 0, W, H);
  // ruined skyline
  g.fillStyle = '#07080f';
  g.beginPath();
  g.moveTo(0, H * 0.62);
  let x = 0;
  while (x < W) {
    const w = 40 + rng.next() * 90;
    const top = H * (0.3 + rng.next() * 0.3);
    g.lineTo(x, top);
    g.lineTo(x + w * (0.4 + rng.next() * 0.3), top - rng.next() * 30);
    g.lineTo(x + w, top + rng.next() * 20);
    x += w;
  }
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.fill();
  // ground glow
  const fog = g.createLinearGradient(0, H * 0.6, 0, H);
  fog.addColorStop(0, 'rgba(120,90,110,0.25)');
  fog.addColorStop(1, 'rgba(10,8,12,0.9)');
  g.fillStyle = fog;
  g.fillRect(0, H * 0.6, W, H * 0.4);
  // figures
  const n = Math.min(8, enc.groups.reduce((t, gr) => t + (typeof gr.count === 'number' ? gr.count : 4), 0));
  for (let i = 0; i < n; i++) {
    const fx = W * (0.18 + (i / Math.max(1, n - 1)) * 0.64) + (rng.next() - 0.5) * 30;
    const s = 0.8 + rng.next() * 0.3;
    const fy = H * 0.9 - (i % 2) * 20;
    g.fillStyle = '#020203';
    g.beginPath();
    g.ellipse(fx, fy - 70 * s, 16 * s, 18 * s, 0, 0, Math.PI * 2); // head
    g.moveTo(fx - 24 * s, fy);
    g.lineTo(fx - 18 * s, fy - 55 * s);
    g.lineTo(fx + 18 * s, fy - 55 * s);
    g.lineTo(fx + 24 * s, fy);
    g.fill();
    g.strokeStyle = '#020203';
    g.lineWidth = 4 * s;
    g.beginPath();
    g.moveTo(fx + 18 * s, fy - 45 * s);
    g.lineTo(fx + 40 * s, fy - 90 * s);
    g.stroke();
    // glowing eyes
    g.fillStyle = 'rgba(255,90,40,0.95)';
    g.fillRect(fx - 7 * s, fy - 74 * s, 4 * s, 3 * s);
    g.fillRect(fx + 3 * s, fy - 74 * s, 4 * s, 3 * s);
  }
  // vignette
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}
