#!/usr/bin/env node
/**
 * Determinism check for the debug URL API: captures each gallery entry twice in
 * fresh pages and compares the PNGs pixel by pixel (decoded in the browser).
 *   node tools/determinism.mjs [--only a,b] [--port N] [--tol 0.5]
 * Reports byte-identical / % differing pixels / max channel delta per shot.
 * Exits 1 if any shot has more than --tol percent of pixels differing by > 8/255.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureServer } from './lib/server.mjs';
import { launch, capture } from './lib/browser.mjs';
import { GALLERY } from './gallery.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const only = arg('only', '')?.split(',').filter(Boolean);
const tol = Number(arg('tol', '0.5'));
const port = arg('port') ? Number(arg('port')) : undefined;
const entries = GALLERY.filter((g) => !only?.length || only.includes(g.name));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'por-det-'));
const srv = await ensureServer({ port });
const browser = await launch();
let fail = false;
try {
  const cmp = await browser.newPage();
  for (const g of entries) {
    const a = path.join(tmp, `${g.name}_a.png`);
    const b = path.join(tmp, `${g.name}_b.png`);
    const ra = await capture(browser, `${srv.base}?${g.query}`, a);
    const rb = await capture(browser, `${srv.base}?${g.query}`, b);
    const ba = fs.readFileSync(a);
    const bb = fs.readFileSync(b);
    const r = await cmp.evaluate(async ([da, db]) => {
      const load = async (d) => createImageBitmap(await (await fetch(`data:image/png;base64,${d}`)).blob());
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      const px = (im) => {
        const c = new OffscreenCanvas(im.width, im.height);
        const x = c.getContext('2d');
        x.drawImage(im, 0, 0);
        return x.getImageData(0, 0, im.width, im.height).data;
      };
      const pa = px(ia);
      const pb = px(ib);
      let diff = 0;
      let max = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const m = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
        if (m > max) max = m;
        if (m > 8) diff++;
      }
      return { pct: (100 * diff) / (pa.length / 4), max };
    }, [ba.toString('base64'), bb.toString('base64')]);
    const same = ba.equals(bb);
    const bad = r.pct > tol || ra.errors.length || rb.errors.length;
    if (bad) fail = true;
    console.log(`${bad ? 'FAIL' : 'OK  '} ${g.name.padEnd(14)} ${same ? 'byte-identical' : `${r.pct.toFixed(3)}% px differ, max delta ${r.max}`}`);
    for (const e of [...ra.errors, ...rb.errors]) console.log('     ', e);
  }
} finally {
  await browser.close();
  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
