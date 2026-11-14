/**
 * On-screen movement for touch devices: a four-way pad (step forward/back, turn left/right) and a
 * menu button, shown while exploring. They send the same input actions the keyboard does, so
 * every scene that listens for 'forward', 'turnLeft' … just works. Holding a direction repeats.
 * Everything else in the game (command buttons, menus, dialogs) is already tappable.
 *
 * @param {import('../core/context.js').GameContext} ctx
 */
export function attachTouchControls(ctx) {
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!touch) return;

  const css = document.createElement('style');
  css.textContent = `
    .por-touch { position: fixed; z-index: 55; touch-action: none; user-select: none; -webkit-user-select: none; }
    .por-touch-pad { left: calc(env(safe-area-inset-left, 0px) + 10px); bottom: calc(env(safe-area-inset-bottom, 0px) + 10px); width: 132px; height: 132px; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); }
    html[data-classic='0'] .por-touch-pad { bottom: calc(env(safe-area-inset-bottom, 0px) + 10.5em); }
    @media (orientation: portrait) { html[data-classic='1'] .por-touch-pad { left: 50%; margin-left: -66px; bottom: calc(env(safe-area-inset-bottom, 0px) + 24px); } }
    .por-touch-menu { right: calc(env(safe-area-inset-right, 0px) + 6px); top: calc(env(safe-area-inset-top, 0px) + 6px); width: 40px; height: 40px; }
    .por-touch button { display: grid; place-items: center; padding: 0; color: #f5d98b; background: rgba(8, 10, 22, 0.62); border: 2px solid rgba(216, 178, 90, 0.9); border-radius: 8px; touch-action: none; -webkit-tap-highlight-color: transparent; }
    .por-touch button.on { background: rgba(60, 96, 120, 0.85); }
    .por-touch-menu button { width: 100%; height: 100%; }
    .por-touch[hidden] { display: none; }
  `;
  document.head.append(css);

  const act = (action) => ctx.bus.emit('input:action', { action, code: 'touch' });
  const arrow = (deg) => `<svg viewBox="0 0 24 24" width="24" height="24" style="transform:rotate(${deg}deg)"><path d="M12 4 L21 18 H3 Z" fill="currentColor"/></svg>`;
  const pad = document.createElement('div');
  pad.className = 'por-touch por-touch-pad';
  const cells = [null, ['forward', 0, 'Step forward'], null, ['turnLeft', -90, 'Turn left'], null, ['turnRight', 90, 'Turn right'], null, ['back', 180, 'Step back'], null];
  for (const c of cells) {
    if (!c) { pad.append(document.createElement('span')); continue; }
    const [action, deg, label] = c;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = arrow(deg);
    let timer = 0;
    const stop = () => { clearInterval(timer); timer = 0; b.classList.remove('on'); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stop();
      b.classList.add('on');
      act(action);
      timer = setInterval(() => act(action), 380);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    pad.append(b);
  }

  const menu = document.createElement('div');
  menu.className = 'por-touch por-touch-menu';
  const mb = document.createElement('button');
  mb.type = 'button';
  mb.setAttribute('aria-label', 'Menu');
  mb.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  mb.addEventListener('click', () => { mb.blur(); act('cancel'); });
  menu.append(mb);
  document.body.append(pad, menu);

  // only while walking about, and never over a dialog or the pause menu
  const sync = () => {
    const show = ctx.scenes.currentName === 'explore' && !ctx.scenes.transitioning && !document.querySelector('.por-modal-backdrop, .por-pause');
    pad.hidden = !show;
    menu.hidden = !show;
  };
  sync();
  setInterval(sync, 250);
}
