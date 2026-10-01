#!/usr/bin/env node
/**
 * Render every procedural audio cue offline (OfflineAudioContext in headless
 * Chromium) to 16-bit WAVs under audio_out/ (gitignored) for review.
 *   node tools/audiorender.mjs [--only music_title,sfx_door] [--match music_] [--port 5280]
 *                              [--spectro] [--list] [--out audio_out]
 * --spectro also writes <cue>.png (log-frequency spectrogram + waveform).
 * Prints peak / RMS (dBFS) per cue and fails on NaNs, silence or clipping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => {
  const i = a.indexOf(`--${k}`);
  return i >= 0 ? a[i + 1] : d;
};
const only = opt('only', '')?.split(',').filter(Boolean);
const match = opt('match', '');
const outDir = opt('out', 'audio_out');
const spectro = a.includes('--spectro');
const port = opt('port', null);

const srv = await ensureServer({ port: port ? Number(port) : undefined });
const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
let failures = 0;
try {
  // Any same-origin URL works as a host page; the module itself is light.
  await page.goto(`${srv.base}src/audio/offline.js`, { waitUntil: 'load' });
  const cues = await page.evaluate(async () => (await import('/src/audio/offline.js')).listCues());
  if (a.includes('--list')) {
    console.log(cues.join('\n'));
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    const todo = cues.filter((c) => (!only?.length || only.includes(c)) && (!match || c.includes(match)));
    for (const name of todo) {
      const t0 = Date.now();
      const r = await page.evaluate(
        async ({ name, spectro }) => {
          const m = await import('/src/audio/offline.js');
          const buf = await m.renderCue(name);
          return { stats: m.stats(buf), wav: m.wavBase64(buf), png: spectro ? m.spectrogramPng(buf) : null };
        },
        { name, spectro },
      );
      fs.writeFileSync(path.join(outDir, `${name}.wav`), Buffer.from(r.wav, 'base64'));
      if (r.png) fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      const s = r.stats;
      const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
      const bad = s.nan > 0 || s.peak < 0.003 || s.clip > 50;
      if (bad) failures++;
      console.log(`${bad ? 'FAIL' : 'OK  '} ${name.padEnd(28)} ${s.seconds.toFixed(1).padStart(5)}s  peak ${db(s.peak).padStart(6)} dBFS  rms ${db(s.rms).padStart(6)} dBFS${s.clip ? `  clip ${s.clip}` : ''}${s.nan ? `  NaN ${s.nan}` : ''}  (${Date.now() - t0} ms)`);
    }
  }
} finally {
  for (const e of errors) console.error('[error]', e);
  await browser.close();
  await srv.close();
}
process.exit(failures || errors.length ? 1 : 0);
