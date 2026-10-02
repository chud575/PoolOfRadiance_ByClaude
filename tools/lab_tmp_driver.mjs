// scratch driver (not committed)
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
import fs from 'node:fs';
const [,, out, json] = process.argv;
const spec = JSON.parse(fs.readFileSync(json, 'utf8'));
const srv = await ensureServer({ port: 5250 });
const b = await launch();
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('console', (m) => { if (m.type() === 'error' || m.type()==='warning') console.log('[c]', m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('[pe]', e.message));
await p.goto(srv.base + 'src/scenes/create/lab/lab.html');
await p.waitForFunction(() => window.__READY);
const t0 = Date.now();
const url = await p.evaluate(async (spec) => {
  const m = await window.__labImport('/src/scenes/create/lab/labfns.js');
  const r = await m[spec.fn ?? "current"](spec.chars, spec.o);
  return { url: r.images[0].toDataURL('image/png'), info: r.info };
}, spec);
fs.writeFileSync(out, Buffer.from(url.url.split(',')[1], 'base64'));
console.log('done', Date.now() - t0, url.info);
await b.close(); await srv.close();
