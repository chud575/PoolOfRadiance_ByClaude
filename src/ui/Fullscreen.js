/**
 * Full screen on phones and tablets.
 *
 * Android and iPad browsers can put the page full screen on a tap, so touch devices get a small
 * button for it (top left). iPhone Safari cannot: there the only full-screen route is the
 * home-screen app (index.html's web-app tags and manifest make the page open with no browser
 * bars from its icon), so the same button explains how to add it. Opened that way, or already
 * full screen, the button is not shown.
 *
 * @param {import('../core/context.js').GameContext} ctx
 */
export function attachFullscreen(ctx) {
  const root = document.documentElement;
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
  const current = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!touch || standalone()) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Full screen');
  button.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
  Object.assign(button.style, {
    position: 'fixed', left: 'calc(env(safe-area-inset-left, 0px) + 6px)', top: 'calc(env(safe-area-inset-top, 0px) + 6px)', zIndex: 60,
    width: '40px', height: '40px', display: 'grid', placeItems: 'center', padding: 0, color: '#f5d98b',
    background: 'rgba(8, 10, 22, 0.72)', border: '2px solid #d8b25a', borderRadius: '6px', cursor: 'pointer', touchAction: 'manipulation',
  });
  document.body.append(button);

  const sync = () => { button.style.display = current() ? 'none' : 'grid'; };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  button.addEventListener('click', async () => {
    button.blur();
    if (current()) return void exit?.call(document);
    if (!request) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      return void ctx.ui.dialog({
        title: 'Full screen',
        body: ios
          ? 'This browser cannot go full screen from a page. Tap the Share button, choose "Add to Home Screen", then open the game from its new icon: it starts full screen, with no browser bars.'
          : 'This browser cannot go full screen from a page. Use its menu to add or install the game to your home screen, then open it from the icon.',
      });
    }
    try {
      await request.call(root, { navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape').catch(() => {}); // where allowed; otherwise the player turns the device
    } catch (err) {
      ctx.ui.toast(`Could not go full screen: ${err?.message ?? err}`);
    }
  });
}
