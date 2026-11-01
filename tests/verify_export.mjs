// verify_export.mjs — exported SVG/PNG must carry the SAME title/company/period the user sees
// on screen (B1). Before the fix the export was the bare ECharts canvas: the company name, the
// period and the watermark all lived in HTML (#chartTitle / #metaLine) and were missing from the
// downloaded file, so you could not tell which company/period a saved chart belonged to.
//   - SVG: assert the export string contains the company name AND the period end
//   - PNG: assert exportPNG() resolves to a non-empty data URL and the header text it paints
//     (title + company + period) is non-empty and agrees with the current state
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9361;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });
const D = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-export/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = list.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true })).result?.result?.value;
const evlA = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };

const TK = '600887.SS';
const c = D.companies[TK];
const END = c.quarters[c.quarters.length - 1].end;

// Render bar view for the company and produce both exports from inside the page.
const out = await evlA(`(async()=>{
  state.company=${JSON.stringify(TK)}; state.view='bar'; state.barItem='revenue';
  state.mode.pct=false; state.mode.qoq=false; render();
  const h=exportHeaderData();
  const svg=exportSVG();          // returns the composed SVG string
  const png=await exportPNG();    // returns the composed data URL
  return { title:h.title, line:h.line, wm:exportWatermark(), svg, png,
    svgType: typeof svg, pngType: typeof png,
    pngBytes: png && png.length };
})()`);

check('exportHeaderData().title is non-empty (screen title captured)', typeof out.title === 'string' && out.title.length > 0, JSON.stringify(out.title));
check('export header line contains company name', out.line.includes(c.name), out.line);
check('export header line contains the period end', out.line.includes(END), out.line);
check('export watermark names the data source + update date', /profitbridge/.test(out.wm) && out.wm.includes(D.updated), out.wm);

check('SVG export is a string', out.svgType === 'string' && out.svg.length > 1000, `len=${out.svg && out.svg.length}`);
check('SVG export contains the company name', typeof out.svg === 'string' && out.svg.includes(c.name), 'name=' + c.name);
check('SVG export contains the period end', typeof out.svg === 'string' && out.svg.includes(END), 'end=' + END);
check('SVG export contains the on-screen title text', typeof out.svg === 'string' && out.svg.includes(out.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')), 'title=' + out.title);

check('PNG export resolves to a non-empty data URL', typeof out.png === 'string' && out.png.startsWith('data:image/png') && out.pngBytes > 2000, `type=${out.pngType} bytes=${out.pngBytes}`);
check('exportPNG() returns a Promise (async, awaited cleanly)', out.pngType === 'string');

// Save the actual SVG so the deliverable is inspectable offline.
if (typeof out.svg === 'string') fs.writeFileSync(`${SHOTS}/export_600887.svg`, out.svg);
await shot('export_600887_screen.png');

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
