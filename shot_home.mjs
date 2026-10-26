// shot_home.mjs — capture homepage screenshot via CDP headless chrome
import fs from 'fs';
import { execSync, spawn } from 'node:child_process';
const PORT = 9337;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  [`--remote-debugging-port=${PORT}`, '--headless=new', '--window-size=1440,900', '--user-data-dir=C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/archive/tmp_r/shot-home-profile', 'about:blank'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3000));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0; const pend = {};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
await new Promise(r => ws.onopen = r);
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8440/' });
await new Promise(r => setTimeout(r, 4000));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/screenshots/home_1440.png', Buffer.from(shot.result.data, 'base64'));
console.log('saved docs/screenshots/home_1440.png');
ws.close(); chrome.kill();
