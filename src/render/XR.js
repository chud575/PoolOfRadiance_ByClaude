import * as THREE from 'three';

/**
 * VR (WebXR immersive-vr) for 3D exploration.
 *
 * The game keeps running exactly as on a monitor: the scene still places its own camera every
 * frame (that is the party's "body": square, facing, step and turn tweens) and still does its
 * off-screen passes with it. Only the last draw changes — instead of the post pipeline, the scene
 * is drawn straight to the headset from a second camera that rides on a rig standing where the
 * body stands, so the player's head moves freely around that spot.
 *
 * What is NOT in VR: the HTML interface. A small board in front of the player shows the place
 * name and the last messages (and the text of a dialog, if one opens). Every other screen is
 * flat, so the session ends when the game leaves 3D exploration; the page is then usable as a
 * normal window inside the headset, and ENTER VR goes back in.
 *
 * Quality (setting `vrQuality`): 'quest2' — or 'auto' on a Quest 2 — is the lighter path: 70% of the
 * headset's resolution, strongest foveation, no shadows, no fill or rim lights beside the sun, and
 * (state.lite, read by ExploreScene) one torch light instead of three and no puddle-mirror pass.
 *
 * Controls (either hand): stick forward/back = step, stick left/right = turn, trigger = step,
 * A/X = look (or OK on a dialog), B/Y = search.
 */
const EYE = 1.62; // world units are metres; the scene camera sits at this height (BlockBuilder EYE_H)
const REPEAT = 0.42; // seconds between repeats while a stick is held
const PANEL_W = 1024;
const PANEL_H = 400;

/**
 * @param {import('../core/context.js').GameContext} ctx
 * @param {import('../core/GameLoop.js').GameLoop} loop
 */
export function attachXR(ctx, loop) {
  const xrApi = navigator.xr;
  if (!xrApi?.isSessionSupported) return;
  const renderer = ctx.render.renderer;
  const state = { presenting: false, lite: false, session: null, frameTarget: null, draw };
  ctx.render.xr = state;

  const rig = new THREE.Group();
  const eye = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
  rig.add(eye);
  const panel = makePanel(ctx);
  rig.add(panel.mesh);

  const usable = () => ctx.scenes.currentName === 'explore' && !ctx.render.classic && !ctx.scenes.transitioning;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Enter VR';
  Object.assign(button.style, {
    position: 'fixed', right: '1.2em', bottom: '8.5em', zIndex: 50, padding: '0.6em 1.1em', font: '700 14px Georgia, serif', letterSpacing: '0.12em',
    textTransform: 'uppercase', color: '#f5d98b', background: 'rgba(8, 10, 22, 0.86)', border: '2px solid #d8b25a', borderRadius: '4px', cursor: 'pointer', display: 'none',
  });
  document.body.append(button);
  xrApi.isSessionSupported('immersive-vr').then((ok) => { if (ok) button.style.display = ''; }).catch(() => {});

  button.addEventListener('click', async () => {
    button.blur();
    if (state.session) return void state.session.end();
    if (!usable()) return void ctx.ui.toast('VR works in the 3D exploration view. Start or load a game first (F2 leaves 1988 mode).');
    try {
      const q = ctx.settings.get('vrQuality') ?? 'auto';
      state.lite = q === 'quest2' || (q === 'auto' && /Quest 2/i.test(navigator.userAgent));
      const session = await xrApi.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      renderer.xr.setReferenceSpaceType('local-floor');
      renderer.xr.setFramebufferScaleFactor(state.lite ? 0.7 : 1); // must be set before the session starts
      await renderer.xr.setSession(session);
      renderer.xr.setFoveation(state.lite ? 1 : 0.5);
      state.session = session;
      state.presenting = true;
      button.textContent = 'Exit VR';
      held.clear();
      session.addEventListener('end', onEnd);
      loop.setDriver(renderer, beforeFrame);
      panel.redraw();
    } catch (err) {
      ctx.ui.toast(`Could not start VR: ${err?.message ?? err}`);
    }
  });

  function onEnd() {
    state.session = null;
    state.presenting = false;
    state.frameTarget = null;
    state.lite = false;
    relight();
    renderer.xr.enabled = false;
    rig.removeFromParent();
    button.textContent = 'Enter VR';
    loop.setDriver(null);
    // the canvas was sized for the headset while presenting
    ctx.render.setSize(window.innerWidth, window.innerHeight);
    ctx.scenes.resize?.(window.innerWidth, window.innerHeight);
  }

  /** Runs at the start of every headset frame, before the game's update. */
  function beforeFrame() {
    // three points the renderer at the headset's framebuffer for this frame: remember it, because
    // the scene's off-screen passes will leave some other target bound
    state.frameTarget = renderer.getRenderTarget();
    if (!usable() && !ctx.scenes.transitioning) return void state.session?.end(); // a flat screen came up
    pollControllers();
    panel.tick();
  }

  // ---------------------------------------------------------------- the lighter path's lighting
  // Done once per scene (a change in the set of lights recompiles the materials, which is a
  // visible pause), and put back when the session ends, since the same scene goes on flat.
  const changed = []; // [object, property, value before]
  const set = (o, k, v) => { changed.push([o, k, o[k]]); o[k] = v; };
  function relight() {
    for (const [o, k, v] of changed.splice(0)) o[k] = v;
  }
  function lighten(scene) {
    relight();
    const suns = [];
    const others = [];
    scene.traverse((o) => {
      if (!o.isLight) return;
      if (o.castShadow) {
        if (o.isDirectionalLight && o.intensity > 0) suns.push(o);
        set(o, 'castShadow', false);
      } else if (o.isDirectionalLight) others.push(o);
    });
    // with a sun in the sky the fill and rim lights are a refinement; without one they are the light
    if (suns.length) for (const o of others) set(o, 'visible', false);
  }

  // ---------------------------------------------------------------- controllers
  const held = new Map(); // key → seconds until the next repeat (sticks) or true (buttons)
  const act = (action) => ctx.bus.emit('input:action', { action, code: 'xr' });
  function stick(key, on, action, dt) {
    if (!on) return void held.delete(key);
    const left = held.has(key) ? held.get(key) - dt : 0;
    if (left <= 0) { act(action); held.set(key, REPEAT); } else held.set(key, left);
  }
  function press(key, on, fn) {
    if (on && !held.get(key)) fn();
    held.set(key, !!on);
  }
  function pollControllers() {
    const dt = ctx.clock.dt || 1 / 72;
    let x = 0;
    let y = 0;
    let trigger = false;
    let a = false;
    let b = false;
    for (const src of state.session?.inputSources ?? []) {
      const gp = src.gamepad;
      if (!gp) continue;
      const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
      if (Math.abs(ax[0]) > Math.abs(x)) x = ax[0];
      if (Math.abs(ax[1]) > Math.abs(y)) y = ax[1];
      trigger ||= !!gp.buttons[0]?.pressed;
      a ||= !!gp.buttons[4]?.pressed;
      b ||= !!gp.buttons[5]?.pressed;
    }
    const modal = document.querySelector('.por-modal-backdrop');
    const ok = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (modal) {
      press('trigger', trigger, ok);
      press('a', a, ok);
      return;
    }
    const turning = Math.abs(x) > Math.abs(y);
    stick('fwd', !turning && y < -0.6, 'forward', dt);
    stick('back', !turning && y > 0.6, 'back', dt);
    stick('left', turning && x < -0.6, 'turnLeft', dt);
    stick('right', turning && x > 0.6, 'turnRight', dt);
    press('trigger', trigger, () => act('forward'));
    press('a', a, () => act('look'));
    press('b', b, () => act('search'));
  }

  // ---------------------------------------------------------------- the headset draw
  /** Called by RenderContext.render in place of the post pipeline while presenting. */
  function draw(scene, camera) {
    if (rig.parent !== scene) {
      scene.add(rig);
      if (state.lite) lighten(scene);
    }
    rig.position.set(camera.position.x, camera.position.y - EYE, camera.position.z);
    rig.rotation.set(0, camera.rotation.y, 0); // scene cameras here are yaw-first (YXZ)
    rig.updateMatrixWorld(true);
    eye.near = camera.near;
    eye.far = camera.far;
    renderer.xr.enabled = true;
    renderer.setRenderTarget(state.frameTarget);
    renderer.render(scene, eye);
    renderer.xr.enabled = false;
  }
}

/** The board in front of the player: place name, day and time, the last messages, or a dialog's text. */
function makePanel(ctx) {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_W;
  canvas.height = PANEL_H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, (0.9 * PANEL_H) / PANEL_W),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: false, fog: false }),
  );
  mesh.position.set(0, 0.95, -1.05);
  mesh.rotation.x = -0.55;
  mesh.renderOrder = 9999;
  mesh.frustumCulled = false;

  const lines = [];
  let dirty = true;
  let lastModal = '';
  ctx.bus.on('message', (m) => {
    lines.push(typeof m === 'string' ? m : m.text);
    while (lines.length > 3) lines.shift();
    dirty = true;
  });
  for (const e of ['location:changed', 'time:changed']) ctx.bus.on(e, () => { dirty = true; });

  const wrap = (text, maxW, maxLines) => {
    const out = [];
    let cur = '';
    for (const w of String(text).split(/\s+/)) {
      const t = cur ? `${cur} ${w}` : w;
      if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out.slice(0, maxLines);
  };

  function redraw() {
    dirty = false;
    g.clearRect(0, 0, PANEL_W, PANEL_H);
    g.fillStyle = 'rgba(8, 10, 22, 0.82)';
    g.fillRect(0, 0, PANEL_W, PANEL_H);
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 6;
    g.strokeRect(6, 6, PANEL_W - 12, PANEL_H - 12);
    g.textBaseline = 'top';
    const c = ctx.game.clock ?? { day: 1, hour: 0, minute: 0 };
    const place = document.querySelector('.por-location .name')?.textContent || '';
    g.font = '700 44px Georgia, serif';
    g.fillStyle = '#f5d98b';
    g.fillText(place.toUpperCase(), 36, 30);
    const when = `Day ${c.day}  ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
    g.fillText(when, PANEL_W - 36 - g.measureText(when).width, 30);
    g.fillRect(36, 92, PANEL_W - 72, 3);
    g.font = '38px Georgia, serif';
    let y = 116;
    if (lastModal) {
      g.fillStyle = '#ffffff';
      for (const l of wrap(lastModal, PANEL_W - 72, 4)) { g.fillText(l, 36, y); y += 50; }
      g.fillStyle = '#f5d98b';
      g.fillText('Trigger or A: OK', 36, PANEL_H - 70);
    } else {
      const rows = lines.flatMap((t) => wrap(t, PANEL_W - 72, 2)).slice(-5);
      rows.forEach((l, i) => {
        g.fillStyle = i === rows.length - 1 ? '#ffffff' : '#b9c2d8';
        g.fillText(l, 36, y);
        y += 50;
      });
    }
    tex.needsUpdate = true;
  }

  return {
    mesh,
    redraw,
    tick() {
      const modal = document.querySelector('.por-modal-backdrop .por-frame-body p')?.textContent ?? '';
      if (modal !== lastModal) { lastModal = modal; dirty = true; }
      if (dirty) redraw();
    },
  };
}
