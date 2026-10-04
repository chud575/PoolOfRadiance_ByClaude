import { ensureServer } from './lib/server.mjs';
import { launch } from './lib/browser.mjs';
const cue = process.argv[2] ?? 'combat';
const skip = process.argv[3] === 'skip';
const srv = await ensureServer({ port: 5280 });
const browser = await launch();
const page = await browser.newPage();
await page.goto(`${srv.base}src/audio/offline.js`, { waitUntil: 'load' });
page.on('console', (m) => console.log(m.text()));
const res = await page.evaluate(async ([cue, SKIP]) => {
  const m = await import('/src/audio/offline.js');
  const { SONGS, STINGERS } = await import('/src/audio/music/songs.js');
  const song = SONGS[cue] ?? STINGERS[cue];
  const name = (SONGS[cue] ? 'music_' : 'sting_') + cue;
  const orig = song.build;
  const out = [];
  const run = async (label) => { const t0 = performance.now(); const b = await m.renderCue(name, { intensity: 1 }); out.push([label, Math.round((performance.now() - t0) / b.duration) / 1000]); console.log(label, out.at(-1)[1]); };
  await run('warm');
  await run('all');
  await run('all2');
  await run('all3');
  song.build = (...a) => { const r = orig.call(song, ...a); return { ...r, events: [] }; };
  await run('-everything');
  song.build = (...a) => { const r = orig.call(song, ...a); const seen = new Set(); return { ...r, events: r.events.filter((e) => { const k = e.inst + '@' + (e.layer ?? 0); if (seen.has(k)) return false; seen.add(k); return true; }).map((e) => ({ ...e, dur: 0.25, slur: false, roll: undefined })) }; };
  await run('one-each');
  song.build = orig;
  if (SKIP) for (const k of Object.keys(song.instruments)) {
    song.build = (...a) => { const r = orig.call(song, ...a); return { ...r, events: r.events.filter((e) => e.inst !== k) }; };
    await run('-' + k);
    song.build = orig;
  }
  return out;
}, [cue, skip]);
for (const [l, x] of res) console.log(l.padEnd(14), 'x' + x);
await browser.close();
