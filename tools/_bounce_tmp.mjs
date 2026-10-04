import { launch } from './lib/browser.mjs';
const browser = await launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto('http://127.0.0.1:5280/src/audio/offline.js', { waitUntil: 'load' });
const r = await page.evaluate(async () => {
  const m = await import('/src/audio/offline.js');
  const { createGraph } = await import('/src/audio/graph.js');
  const { AudioEngine } = await import('/src/audio/AudioEngine.js');
  const run = async (bounced) => {
    const sr = 44100;
    const ac = new OfflineAudioContext(2, sr * 16, sr);
    const g = createGraph(ac);
    const e = AudioEngine.offline(ac, g);
    if (bounced) {
      e._bounce('victory');
      for (let i = 0; i < 400 && !e.debugState().bounced.includes('victory'); i++) await new Promise((r) => setTimeout(r, 100));
      e.offlineMode = false;
    }
    e.stinger('victory', { at: 0.1 });
    e.offlineMode = true;
    for (let i = 1; i < 32; i++) ac.suspend(i * 0.5).then(() => { e._tick(); ac.resume(); });
    const buf = await ac.startRendering();
    const s = m.stats(buf, { full: true });
    return { lufs: s.lufs, peak: s.peak, bands: s.bands, plays: e.debugState().bouncedPlays, corr: s.corr };
  };
  return [await run(false), await run(true)];
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
