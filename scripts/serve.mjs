import http from 'http';
import fs from 'fs';
import path from 'path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// root resolves relative to the script dir, independent of the launch cwd
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8440;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/') || !path.extname(p)) p = path.join(p, 'index.html');
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(b);
  });
}).listen(port, () => console.log('serving on http://127.0.0.1:' + port + '/'));
