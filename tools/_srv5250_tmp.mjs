// scratch dev server for the party-UI workstream (not committed)
import { ensureServer } from './lib/server.mjs';
const s = await ensureServer({ port: 5250 });
console.log('up', s.base, s.reused);
setInterval(() => {}, 1 << 30);
