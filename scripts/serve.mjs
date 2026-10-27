import http from 'http';
import fs from 'fs';
import path from 'path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// root resolves relative to the script dir, independent of the launch cwd
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8440;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// Robustness: keep the server alive on network noise (client aborts, ECONNRESET,
// EPIPE, keep-alive timeouts). Without these handlers an uncaught error kills the
// whole process silently.
process.on('uncaughtException', (err) => {
  if (['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(err.code)) return;
  console.error('[serve] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => console.error('[serve] unhandledRejection:', err));

const server = http.createServer((req, res) => {
  req.on('error', () => {});
  res.on('error', () => {});
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || !path.extname(p)) p = path.join(p, 'index.html');
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
});
// Malformed requests / aborted connections: respond if possible, never crash.
server.on('clientError', (err, socket) => {
  if (socket.writable && err.code !== 'ECONNRESET') socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});
server.on('connection', (socket) => socket.on('error', () => {}));
server.listen(port, () => console.log('serving on http://127.0.0.1:' + port + '/'));
