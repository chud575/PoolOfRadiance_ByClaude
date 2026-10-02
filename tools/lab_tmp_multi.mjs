// scratch: multiple lab calls, horizontally concatenated
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
import fs from 'node:fs';
const [,, out, json] = process.argv;
const specs = JSON.parse(fs.readFileSync(json, 'utf8'));
const srv = await ensureServer({ port: 5250 });
const b = await launch();
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', (e) => console.log('[pe]', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('[c]', m.text().slice(0, 300)); });
await p.goto(srv.base + 'src/scenes/create/lab/lab.html');
await p.waitForFunction(() => window.__READY);
const url = await p.evaluate(async (specs) => {
  const m = await window.__labImport('/src/scenes/create/lab/labfns.js');
  const ims = [];
  for (const spec of specs) { const r = await m[spec.fn ?? 'current'](spec.chars, spec.o); ims.push(r.images[0]); }
  const c = document.createElement('canvas');
  c.width = ims.reduce((a, i) => a + i.width, 0); c.height = Math.max(...ims.map((i) => i.height));
  let x = 0; const g = c.getContext('2d'); for (const i of ims) { g.drawImage(i, x, 0); x += i.width; }
  return c.toDataURL('image/png');
}, specs);
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await b.close(); await srv.close();
