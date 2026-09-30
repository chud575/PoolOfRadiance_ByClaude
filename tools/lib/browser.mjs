/**
 * Headless Chromium (SwiftShader WebGL2) launcher + page capture helper.
 * Never run `playwright install` in this environment; we always pass executablePath.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const CHROME = process.env.POR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const CHROME_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

export async function launch() {
  return chromium.launch({ executablePath: CHROME, args: CHROME_ARGS, headless: true });
}

/**
 * Load `url`, wait for window.__READY, screenshot to `out`.
 * @returns {Promise<{errors: string[], warnings: string[], ms: number}>}
 */
export async function capture(browser, url, out, { w = 1600, h = 900, wait = 0, timeout = 60000 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(`console.error: ${t}`);
    else if (m.type() === 'warning' && !/GPU stall|swiftshader|WebGL-|GL Driver Message/i.test(t)) warnings.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.stack || e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__READY === true, null, { timeout, polling: 100 });
  if (wait) await page.waitForTimeout(wait);
  const appErrors = await page.evaluate(() => window.__ERRORS ?? []);
  for (const e of appErrors) if (!errors.some((x) => x.includes(e.slice(0, 60)))) errors.push(`app: ${e}`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  const ms = Date.now() - t0;
  await page.close();
  return { errors, warnings, ms };
}
