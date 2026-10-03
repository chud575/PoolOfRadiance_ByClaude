import { createServer } from 'vite';
const server = await createServer({ root: '/home/user/PoolOfRadiance_ByClaude', logLevel: 'warn', server: { port: 5260, host: '127.0.0.1', strictPort: true, hmr: false } });
await server.listen();
console.log('up');
