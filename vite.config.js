import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';

// `npm run dev:vr` (tools/devvr.mjs): HTTPS with the self-signed certificate in .cert/, for headsets on the LAN
const https = process.env.POR_HTTPS
  ? { key: fs.readFileSync(resolve(import.meta.dirname, '.cert/key.pem')), cert: fs.readFileSync(resolve(import.meta.dirname, '.cert/cert.pem')) }
  : undefined;

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        reference: resolve(import.meta.dirname, 'tools/reference/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173, https },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
