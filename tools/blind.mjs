#!/usr/bin/env node
/**
 * Build a BLIND side-by-side comparison set (homage vs 1988 reference).
 *   node tools/blind.mjs --only explore,combat --flip 0|1 --out <dir> [--port N]
 * For the i-th name in --only (in the given order), the homage is written as
 * <out>/<nn>_<name>_A.png when (flip + i) % 2 === 0, else as _B.png; the
 * reference takes the other letter. No key file is written — the
 * orchestrator knows the mapping; the critic must not.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/server.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const only = opt('only', '').split(',').filter(Boolean);
const flip = Number(opt('flip', 0));
const out = path.resolve(opt('out', 'blind'));
const port = opt('port', null);
if (!only.length) { console.error('--only required'); process.exit(2); }
const tmp = path.join(out, '.tmp');
rmSync(out, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const extra = port ? ['--port', String(port)] : [];
const run = (tool, dir) => {
  try { execFileSync('node', [path.join(ROOT, 'tools', tool), '--only', only.join(','), '--out', dir, ...extra], { cwd: ROOT, stdio: 'inherit' }); }
  catch { console.error(`${tool} reported failures`); }
};
run('shotall.mjs', path.join(tmp, 'h'));
run('refshot.mjs', path.join(tmp, 'r'));
for (const [i, name] of only.entries()) {
  const nn = String(i + 1).padStart(2, '0');
  const homageIsA = (flip + i) % 2 === 0;
  const h = path.join(tmp, 'h', `${name}.png`), r = path.join(tmp, 'r', `${name}.png`);
  const A = path.join(out, `${nn}_${name}_A.png`), B = path.join(out, `${nn}_${name}_B.png`);
  try { copyFileSync(homageIsA ? h : r, A); copyFileSync(homageIsA ? r : h, B); } catch (e) { console.error(`missing shot for ${name}: ${e.message}`); continue; }
  console.log(`pair ${nn} ${name}`);
}
rmSync(tmp, { recursive: true, force: true });
