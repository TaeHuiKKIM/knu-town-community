import { createStudyServer, localAddresses } from './src/server.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const port = Number(process.env.PORT || 4183);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535');
mkdirSync(new URL('.runtime/',import.meta.url),{recursive:true});
const server = createStudyServer({hub:true,roomCode:'main',studyPath:fileURLToPath(new URL('.runtime/study.sqlite',import.meta.url)), onRequest: ({ method, kind, remote }) => console.log(`[request] ${new Date().toISOString()} ${remote} ${method} ${kind}`) });
const bindAddress = process.env.STUDY_BIND || '0.0.0.0';
server.listen(port, bindAddress, () => {
  console.log('LAN Study Room · leave this process running');
  if (bindAddress === '0.0.0.0') console.log(`This computer: http://localhost:${port}/r/${server.roomCode}`);
  if(bindAddress==='127.0.0.1')console.log(`Local preview only: http://127.0.0.1:${port}/r/${server.roomCode}`);
  else for (const a of localAddresses().filter(a=>bindAddress==='0.0.0.0'||a.address===bindAddress)) console.log(`${a.name}: http://${a.address}:${port}/r/${server.roomCode}`);
  console.log('Stop: Ctrl+C. Presence/chat reset on restart. Study records and friend plazas persist locally.');
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Close the previous room first.` : error.message); process.exitCode = 1; });
function stop() { server.closeAllConnections(); server.close(() => process.exit(0)); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
