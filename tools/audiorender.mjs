#!/usr/bin/env node
/**
 * Render every procedural audio cue offline (OfflineAudioContext in headless
 * Chromium) to 16-bit WAVs under audio_out/ (gitignored) for review.
 *   node tools/audiorender.mjs [--only music_title,sfx_door] [--match music_] [--port 5280]
 *                              [--passes N] [--spectro] [--bands] [--list] [--out audio_out]
 *   node tools/audiorender.mjs --calibrate [--only …|--match …] [--port 5280]
 * --passes N   music: render passes 1..N of each loop (seams included) instead of pass 1 only
 * --spectro    also write <cue>.png (log-frequency spectrogram + waveform)
 * --bands      print the per-band spectrum balance
 * --calibrate  measure loudness (BS.1770) and write src/audio/loudness.data.js: the gain that
 *              brings each cue to its target (see src/audio/loudness.js). Merges with existing data.
 * --wiring     load gallery scenes with ?audio=1 (unmuted debug mode, autoplay allowed) and check
 *              that each one drives the expected music state / ambience (scene → music wiring).
 * --list      print the cue names and exit       --out DIR  output directory (default audio_out)
 * --help      this text. Unknown flags are an error.
 * Prints peak / RMS (dBFS), integrated + momentary-max loudness (LUFS), the LRA-ish momentary
 * spread (p10–p90, LU), stereo width (side/mid dB) and L/R correlation per cue; fails on NaNs,
 * silence or clipping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureServer, ROOT } from './lib/server.mjs';
import { launch, CHROME, CHROME_ARGS } from './lib/browser.mjs';
import { chromium } from 'playwright';

const a = process.argv.slice(2);
const FLAGS = { only: 1, match: 1, out: 1, port: 1, passes: 1, spectro: 0, bands: 0, list: 0, calibrate: 0, wiring: 0, help: 0 };
{
  const usage = () => {
    const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
    console.log(src.slice(src.indexOf('/**') + 4, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  };
  if (a.includes('--help') || a.includes('-h')) {
    usage();
    process.exit(0);
  }
  for (let i = 0; i < a.length; i++) {
    const k = a[i].startsWith('--') ? a[i].slice(2) : null;
    if (k === null || !(k in FLAGS)) {
      console.error(`audiorender: unknown argument "${a[i]}" (see --help)`);
      process.exit(2);
    }
    if (FLAGS[k]) {
      if (a[i + 1] === undefined || a[i + 1].startsWith('--')) {
        console.error(`audiorender: --${k} needs a value (see --help)`);
        process.exit(2);
      }
      i++;
    }
  }
}
const opt = (k, d) => {
  const i = a.indexOf(`--${k}`);
  return i >= 0 ? a[i + 1] : d;
};
const only = opt('only', '')?.split(',').filter(Boolean);
const match = opt('match', '');
const outDir = opt('out', 'audio_out');
const spectro = a.includes('--spectro');
const showBands = a.includes('--bands');
const calibrate = a.includes('--calibrate');
const passes = Number(opt('passes', 0)) || undefined;
const port = opt('port', null);

const srv = await ensureServer({ port: port ? Number(port) : undefined });
if (a.includes('--wiring')) process.exit(await wiring());
const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
let failures = 0;
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-inf');

async function render(name, o = {}) {
  return page.evaluate(
    async ({ name, o }) => {
      const m = await import('/src/audio/offline.js');
      const buf = await m.renderCue(name, o);
      const stats = m.stats(buf, { full: o.full });
      return { stats, wav: o.wav ? m.wavBase64(buf) : null, png: o.spectro ? m.spectrogramPng(buf) : null };
    },
    { name, o },
  );
}

try {
  // Any same-origin URL works as a host page; the module itself is light.
  await page.goto(`${srv.base}src/audio/offline.js`, { waitUntil: 'load' });
  const cues = await page.evaluate(async () => (await import('/src/audio/offline.js')).listCues());
  const todo = cues.filter((c) => (!only?.length || only.includes(c)) && (!match || c.includes(match)));
  if (a.includes('--list')) {
    console.log(cues.join('\n'));
  } else if (calibrate) {
    await runCalibration(todo.filter((c) => /^(music_|sting_|amb_|sfx_)/.test(c) && !/^sfx_step_(?!cobble)/.test(c)));
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of todo) {
      const t0 = Date.now();
      const r = await render(name, { passes: name.startsWith('music_') ? passes : undefined, wav: true, spectro, full: showBands });
      const suffix = passes && name.startsWith('music_') ? `_x${passes}` : '';
      fs.writeFileSync(path.join(outDir, `${name}${suffix}.wav`), Buffer.from(r.wav, 'base64'));
      if (r.png) fs.writeFileSync(path.join(outDir, `${name}${suffix}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      const s = r.stats;
      const bad = s.nan > 0 || s.peak < 0.003 || s.clip > 50;
      if (bad) failures++;
      console.log(`${bad ? 'FAIL' : 'OK  '} ${name.padEnd(28)} ${s.seconds.toFixed(1).padStart(6)}s  peak ${db(s.peak).padStart(6)}  rms ${db(s.rms).padStart(6)}  LUFS ${f1(s.lufs).padStart(6)}  M ${f1(s.lufsM).padStart(6)}  S/M ${f1(s.width).padStart(6)}  r ${Number.isFinite(s.corr) ? s.corr.toFixed(2) : '-'}  spread ${f1(s.spread)}${s.clip ? `  clip ${s.clip}` : ''}${s.nan ? `  NaN ${s.nan}` : ''}  (${Date.now() - t0} ms)`);
      if (showBands && s.bands) console.log('      ', Object.entries(s.bands).map(([k, v]) => `${k} ${v}`).join('  '));
    }
  }
} finally {
  for (const e of errors) console.error('[error]', e);
  await browser.close();
  await srv.close();
}
process.exit(failures || errors.length ? 1 : 0);

// ------------------------------------------------------------------ wiring check
async function wiring() {
  const b = await chromium.launch({ executablePath: CHROME, args: [...CHROME_ARGS, '--autoplay-policy=no-user-gesture-required'], headless: true });
  const cases = [
    ['scene=title', 'title', 'title'],
    ['scene=explore&map=phlan_slums&x=7&y=11&dir=N', 'ruins', 'ruins'],
    ['scene=explore&map=phlan_civilized&x=8&y=8&dir=N', 'town', 'town'],
    ['scene=combat&encounter=kobolds_1', 'combat', /^combat_/],
    ['scene=camp', 'camp', 'camp'],
  ];
  let bad = 0;
  for (const [q, music, amb] of cases) {
    const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    try {
      await pg.goto(`${srv.base}?${q}&audio=1`, { waitUntil: 'load', timeout: 180000 });
      await pg.waitForFunction(() => window.__READY === true, null, { timeout: 180000 });
    } catch (e) {
      bad++;
      console.log(`FAIL ${q}: ${e.message.split('\n')[0]}`);
      await pg.close();
      continue;
    }
    await pg.waitForTimeout(1500);
    const st = await pg.evaluate(() => window.__AUDIO?.debugState?.() ?? null);
    const ok = st && st.state === music && (amb instanceof RegExp ? amb.test(st.ambience?.bed ?? '') : st.ambience?.bed === amb) && st.ctx === 'running' && !errs.length;
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${q.padEnd(52)} music ${String(st?.state).padEnd(9)} amb ${String(st?.ambience?.bed).padEnd(11)} ctx ${st?.ctx} intensity ${st?.intensity ?? '-'}${errs.length ? `  errors: ${errs.join(' | ')}` : ''}`);
    if (music === 'combat' && ok) {
      // Win the fight (QUICK): the battle cue must end on its coda and the victory fanfare play.
      await pg.keyboard.press('q');
      try {
        await pg.waitForSelector('.por-dialog', { timeout: 60000 });
        await pg.waitForTimeout(500);
        const s2 = await pg.evaluate(() => window.__AUDIO.debugState());
        const won = s2.stinger === 'victory' && s2.state === null && !errs.length;
        if (!won) bad++;
        console.log(`${won ? 'OK  ' : 'FAIL'} ${'  … QUICK → victory'.padEnd(52)} stinger ${s2.stinger} music ${s2.state}`);
      } catch (e) {
        bad++;
        console.log(`FAIL   … QUICK → victory: ${e.message}`);
      }
    }
    await pg.close();
  }
  await b.close();
  await srv.close();
  return bad ? 1 : 0;
}

// ------------------------------------------------------------------ calibration
async function runCalibration(list) {
  const L = await import(path.join(ROOT, 'src/audio/loudness.js'));
  const { SONGS, STINGERS } = await import(path.join(ROOT, 'src/audio/music/songs.js'));
  const dataPath = path.join(ROOT, 'src/audio/loudness.data.js');
  const fpOf = (fam) => L.sourceFingerprint(L.SOURCES[fam].map((p) => fs.readFileSync(path.join(ROOT, 'src/audio', p), 'utf8')));
  const fp = { music: fpOf('music'), sfx: fpOf('sfx'), amb: fpOf('amb') };
  let cal = { fp: {}, music: {}, sfx: {}, amb: {} };
  try {
    cal = (await import(`${dataPath}?t=${Date.now()}`)).CAL;
  } catch {
    /* first run */
  }
  // Families whose synthesis changed start from scratch.
  for (const fam of ['music', 'sfx', 'amb']) if (cal.fp?.[fam] !== fp[fam]) cal[fam] = {};
  cal.fp = fp;
  for (const name of list) {
    let fam;
    let key;
    let target;
    let measure;
    if (/^(music|sting)_/.test(name)) {
      fam = 'music';
      key = name.replace(/^(music|sting)_/, '');
      target = L.MUSIC_TARGETS[key];
      measure = 'lufs';
    } else if (name.startsWith('amb_')) {
      fam = 'amb';
      key = name.slice(4);
      target = L.AMB_TARGET;
      measure = 'lufs';
    } else {
      fam = 'sfx';
      key = name === 'sfx_step_cobble' ? 'step' : name.slice(4);
      target = L.sfxTarget(key);
      measure = 'lufsM';
    }
    if (target === undefined) continue;
    const t0 = Date.now();
    let g = 1;
    const ro = { raw: true, sampleRate: 32000, maxSeconds: 75 };
    let r = await render(name, { ...ro, gain: 1 });
    let v = r.stats[measure];
    let tries = 0;
    while (Math.abs(target - v) > 0.4 && tries < 3 && Number.isFinite(v)) {
      g = Math.max(0.03, Math.min(16, g * 10 ** ((target - v) / 20)));
      r = await render(name, { ...ro, gain: g });
      v = r.stats[measure];
      tries++;
      if (g === 0.03 || g === 16) break;
    }
    const entry = { gain: Math.round(g * 10000) / 10000, [measure === 'lufs' ? 'lufs' : 'm']: Math.round(v * 10) / 10, target };
    if (fam === 'music') entry.fp = L.songFingerprint(SONGS[key] ?? STINGERS[key]);
    cal[fam][key] = entry;
    const off = v - target;
    console.log(`${Math.abs(off) <= 1 ? 'OK  ' : 'OFF '} ${name.padEnd(28)} target ${target.toFixed(1).padStart(6)}  got ${f1(v).padStart(6)}  gain ${entry.gain.toFixed(3).padStart(7)} (${(20 * Math.log10(g)).toFixed(1)} dB)  (${Date.now() - t0} ms)`);
    write(dataPath, cal);
  }
}

function write(p, cal) {
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const out = { fp: cal.fp, music: sortObj(cal.music), amb: sortObj(cal.amb), sfx: sortObj(cal.sfx) };
  const body = JSON.stringify(out, null, 1);
  fs.writeFileSync(p, `// Generated by \`node tools/audiorender.mjs --calibrate\` — do not edit by hand.\n// Loudness calibration: gain per cue and the loudness it measured at that gain (see loudness.js).\nexport const CAL = ${body};\n`);
}
