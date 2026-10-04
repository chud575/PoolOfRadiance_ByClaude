// temp lab: node tools/lab_lines_tmp.mjs names '[{...params},...]' outdir
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
import { GALLERY } from './gallery.mjs';
const [names, variantsJson = '[{}]', out = 'lab'] = process.argv.slice(2);
const variants = JSON.parse(variantsJson);
const srv = await ensureServer({ port: 5350 });
const browser = await launch();
await Promise.all(names.split(',').map(async (n) => {
  const g = GALLERY.find((x) => x.name === n);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('PAGEERR', n, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', n, m.text()); });
  await page.goto(`${srv.base}?${g.query}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__READY === true, null, { timeout: 180000, polling: 200 });
  for (let i = 0; i < variants.length; i++) {
    await page.evaluate((v) => {
      const G = window.__GAME; const R = G.render;
      R.lineArt && Object.assign(R.lineArt.params, v);
      const s = G.scenes.current;
      if (s.diorama) s.render(); else R.render(s.scene3d, s.camera);
    }, variants[i]);
    await page.screenshot({ path: `${out}/${n}_${i}.png` });
  }
  console.log('done', n, await page.evaluate(() => window.__ERRORS));
  await page.close();
}));
await browser.close(); await srv.close();
