// shot_three.mjs — headless screenshots: bar chart + logo rail for Z.AI / MiniMax / MIXUE.
// Saves to tmp-shorthist/shots/*.png and prints __barMeta + rail img presence per company.
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const SHOTS = new URL('../tmp-shorthist/shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('../tmp-shorthist/.chrome/shot-profile/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = list.find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await sleep(3000);
await evl(`document.getElementById('btnViewBar').click(); true`);
await sleep(400);

for (const [ticker, label] of [['02097.HK', 'mixue'], ['02513.HK', 'zai'], ['00100.HK', 'minimax']]) {
  await evl(`state.company=${JSON.stringify(ticker)}; state.qIndex=null; state.curMode='native'; render(); true`);
  await sleep(900);
  const meta = await evl(`window.__barMeta ? {company:window.__barMeta.company,n:window.__barMeta.quarterCount} : null`);
  const rail = await evl(`(() => { const imgs=[...document.querySelectorAll('img')].filter(i=>/logos/.test(i.src)); const me=imgs.find(i=>i.src.includes(${JSON.stringify(ticker)})); return {total:imgs.length, mine: me ? (me.naturalWidth>0 ? 'loaded' : 'broken') : 'absent'}; })()`);
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOTS}/bar_${label}.png`, Buffer.from(m.result.data, 'base64'));
  console.log(label, ticker, 'barMeta=', JSON.stringify(meta), 'rail=', JSON.stringify(rail));
}
chrome.kill();
console.log('shots in', SHOTS);
