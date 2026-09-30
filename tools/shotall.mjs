#!/usr/bin/env node
/**
 * Capture the standard homage gallery into shots/<name>.png.
 *   node tools/shotall.mjs [--only explore,combat] [--out shots] [--w 1600 --h 900] [--preview]
 */
import { ensureServer } from './lib/server.mjs';
import { launch, capture } from './lib/browser.mjs';
import { GALLERY } from './gallery.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => {
  const i = a.indexOf(`--${k}`);
  return i >= 0 ? a[i + 1] : d;
};
const only = opt('only', '')?.split(',').filter(Boolean);
const outDir = opt('out', 'shots');
const w = Number(opt('w', 1600));
const h = Number(opt('h', 900));
const srv = await ensureServer({ preview: a.includes('--preview') });
const browser = await launch();
let failures = 0;
try {
  for (const g of GALLERY) {
    if (only?.length && !only.includes(g.name)) continue;
    const out = `${outDir}/${g.name}.png`;
    try {
      const r = await capture(browser, `${srv.base}?${g.query}`, out, { w, h });
      for (const e of r.errors) console.error(`  [error] ${e}`);
      console.log(`${r.errors.length ? 'FAIL' : 'OK  '} ${out} (${r.ms} ms)`);
      if (r.errors.length) failures++;
    } catch (err) {
      failures++;
      console.error(`FAIL ${out}: ${err.message}`);
    }
  }
} finally {
  await browser.close();
  await srv.close();
}
process.exit(failures ? 1 : 0);
