/**
 * Dev server a VR headset on the same Wi-Fi can open: `npm run dev:vr`.
 * Browsers only allow VR on a secure page, so this serves HTTPS on every network interface
 * (port 5174) with a self-signed certificate kept in .cert/ (made with openssl on first run).
 * The headset's browser will warn about the certificate once: choose Advanced → Proceed.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.cert');
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const stamp = path.join(dir, 'ips.txt');
if (!fs.existsSync(path.join(dir, 'key.pem')) || (fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '') !== ips.join(',')) {
  fs.mkdirSync(dir, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-subj', '/CN=pool-of-radiance-dev',
    '-addext', `subjectAltName=${san}`, '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  fs.writeFileSync(stamp, ips.join(','));
}
console.log('\nOpen one of these in the headset browser (same Wi-Fi), accept the certificate warning, start a game, then press ENTER VR:');
for (const ip of ips) console.log(`  https://${ip}:5174/`);
console.log('');
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--host', '0.0.0.0', '--port', '5174', '--strictPort'], { cwd: root, stdio: 'inherit', env: { ...process.env, POR_HTTPS: '1' } });
vite.on('exit', (code) => process.exit(code ?? 0));
