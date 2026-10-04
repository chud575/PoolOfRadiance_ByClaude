import { launch } from './lib/browser.mjs';
const browser = await launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5280/src/audio/offline.js', { waitUntil: 'load' });
const r = await page.evaluate(async () => {
  const { createInstrument } = await import('/src/audio/instruments/index.js');
  const out = [];
  for (const p of ['none', 'strings', 'violins', 'choir', 'brass', 'horn', 'lowbrass', 'taiko', 'timpani', 'harp', 'crash', 'celesta', 'flute']) {
    const sr = 44100; const secs = 20;
    const ac = new OfflineAudioContext(2, sr * secs, sr);
    const dest = ac.createGain(); dest.connect(ac.destination);
    const send = ac.createGain(); send.connect(ac.destination);
    if (p !== 'none') for (let i = 0; i < 20; i++) createInstrument(ac, p, dest, send, i);
    const t0 = performance.now();
    await ac.startRendering();
    out.push([p, Math.round((performance.now() - t0) / secs / 20 * 100000) / 100000]);
  }
  return out;
});
for (const [p, x] of r) console.log(p.padEnd(10), 'x' + x + ' per instance');
await browser.close();
