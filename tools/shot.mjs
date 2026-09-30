#!/usr/bin/env node
/**
 * Screenshot one game URL.
 *   node tools/shot.mjs --url "scene=explore&x=3&y=5&dir=N&t=1" --out shots/x.png [--w 1600 --h 900] [--wait ms] [--port 5173] [--preview] [--ref]
 * --url may be a bare query string (with or without "?") or a full http URL.
 * --ref targets the 1988 reference renderer (tools/reference/index.html).
 * Starts (or reuses) a Vite server on --port. Exits 1 on page errors.
 */
import { ensureServer } from './lib/server.mjs';
import { launch, capture } from './lib/browser.mjs';

function args() {
  const a = process.argv.slice(2);
  const o = { w: 1600, h: 900, wait: 0 };
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, '');
    if (['preview', 'ref'].includes(k)) o[k] = true;
    else o[k] = a[++i];
  }
  return o;
}

const o = args();
if (!o.url || !o.out) {
  console.error('usage: node tools/shot.mjs --url "<query>" --out path.png [--w 1600 --h 900] [--wait ms] [--ref] [--preview]');
  process.exit(2);
}
const srv = await ensureServer({ port: o.port ? Number(o.port) : undefined, preview: !!o.preview });
const browser = await launch();
let code = 0;
try {
  const page = o.ref ? 'tools/reference/index.html' : '';
  const url = /^https?:/.test(o.url) ? o.url : `${srv.base}${page}?${o.url.replace(/^\?/, '')}`;
  const r = await capture(browser, url, o.out, { w: Number(o.w), h: Number(o.h), wait: Number(o.wait) });
  for (const w of r.warnings) console.warn(`[warn] ${w}`);
  for (const e of r.errors) console.error(`[error] ${e}`);
  console.log(`${r.errors.length ? 'FAIL' : 'OK'} ${o.out} (${r.ms} ms)`);
  if (r.errors.length) code = 1;
} catch (err) {
  console.error(`[shot] ${err.message}`);
  code = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(code);
