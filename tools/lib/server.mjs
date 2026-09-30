/**
 * Ensure a Vite server is reachable. Reuses one already listening on the port;
 * otherwise starts one in-process (dev server by default, or `vite preview` of
 * dist/ with {preview:true}) and returns a close() to stop it.
 */
import { createServer, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function isUp(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * @param {{port?: number, preview?: boolean}} [o]
 * @returns {Promise<{base: string, close: () => Promise<void>, reused: boolean}>}
 */
export async function ensureServer(o = {}) {
  const port = o.port ?? (o.preview ? 4173 : 5173);
  const base = `http://127.0.0.1:${port}/`;
  if (await isUp(base)) return { base, reused: true, close: async () => {} };
  if (o.preview) {
    const server = await preview({ root: ROOT, logLevel: 'warn', preview: { port, host: '127.0.0.1', strictPort: true } });
    return { base, reused: false, close: () => new Promise((res) => server.httpServer.close(() => res())) };
  }
  const server = await createServer({ root: ROOT, logLevel: 'warn', server: { port, host: '127.0.0.1', strictPort: true, hmr: false } });
  await server.listen();
  return { base, reused: false, close: () => server.close() };
}
