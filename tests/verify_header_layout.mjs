// verify_header_layout.mjs — the header stack (meta row + title row) must never overlap, at any
// viewport width, in both views. C1 turned #metaLine into a two-line block that used to be
// absolutely overlaid at top:8px while a 32px centered title used a fixed padding-top:20px, so
// long company/segment names ran straight through the meta text. This asserts the fix holds for
// 10 companies × {bridge,bar} × {1280,1440,1920}px using real getBoundingClientRect() geometry,
// and that the exports no longer carry the dataZoom "timeline" strip.
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9366;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-header/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
await new Promise(r => setTimeout(r, 3200));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };
const setW = async w => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false }); await new Promise(r => setTimeout(r, 120)); };

const COMPANIES = ['AAPL', 'MSFT', '00992.HK', '00941.HK', '600887.SS', '00700.HK', '005930.KS', 'SONY', 'NESN.SW', 'BABA'];
const WIDTHS = [1280, 1440, 1920];

const measure = (tk, view, barItem) => evl(`(()=>{
  state.company=${JSON.stringify(tk)}; state.view=${JSON.stringify(view)};
  ${view === 'bar' ? `state.barItem=${JSON.stringify(barItem || 'revenue')};` : ''}
  render();
  const R = el => { const r = el.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; };
  const meta = document.getElementById('metaLine'), title = document.getElementById('chartTitle'), panel = document.getElementById('chartPanel');
  const m = R(meta), t = R(title), p = R(panel);
  const overlap = !(m.r <= t.l + 0.5 || t.r <= m.l + 0.5 || m.b <= t.t + 0.5 || t.b <= m.t + 0.5);
  return { m, t, p, overlap,
    titleScroll: title.scrollWidth, titleClient: title.clientWidth,
    metaText: meta.textContent.slice(0, 40), titleText: title.textContent.slice(0, 40) };
})()`);

for (const w of WIDTHS) {
  await setW(w);
  for (const tk of COMPANIES) {
    for (const view of ['bridge', 'bar']) {
      const r = await measure(tk, view, 'revenue');
      const tag = `${tk} ${view} @${w}`;
      if (!r) { check(tag, false, 'no measurement'); continue; }
      check(`${tag}: meta/title do not intersect`, r.overlap === false,
        `meta[${r.m.l.toFixed(0)},${r.m.t.toFixed(0)}-${r.m.r.toFixed(0)},${r.m.b.toFixed(0)}] title[${r.t.l.toFixed(0)},${r.t.t.toFixed(0)}-${r.t.r.toFixed(0)},${r.t.b.toFixed(0)}]`);
      check(`${tag}: meta right edge inside chartPanel`, r.m.r <= r.p.r + 1 && r.m.l >= r.p.l - 1,
        `meta.r=${r.m.r.toFixed(0)} panel[${r.p.l.toFixed(0)},${r.p.r.toFixed(0)}]`);
      check(`${tag}: title inside chartPanel & no horizontal overflow`, r.t.l >= r.p.l - 1 && r.t.r <= r.p.r + 1 && r.titleScroll <= r.titleClient + 2,
        `title[${r.t.l.toFixed(0)},${r.t.r.toFixed(0)}] panel[${r.p.l.toFixed(0)},${r.p.r.toFixed(0)}] scroll=${r.titleScroll} client=${r.titleClient}`);
    }
  }
}

// ---- export must NOT carry the dataZoom "timeline" strip ----
await setW(1440);
const ex = await evlA(`(async()=>{
  state.company='600887.SS'; state.view='bar'; state.barItem='revenue'; render();
  const svg = exportSVG();
  const o = exportOption();
  const dz = Array.isArray(o.dataZoom) ? o.dataZoom.map(d=>d.type) : [];
  return { svg, dz, hasTl: /id=["']timeline|tl-track|tl-thumb|tl-ticks/.test(svg) };
})()`);
check('exportOption() keeps no dataZoom slider (no export timeline strip)', Array.isArray(ex.dz) && !ex.dz.includes('slider'), 'dataZoom types=' + JSON.stringify(ex.dz));
check('exported SVG contains no timeline element/classes', ex.svg && typeof ex.svg === 'string' && ex.svg.length > 1000 && !ex.hasTl, 'hasTimeline=' + ex.hasTl);

// ---- evidence screenshots at 1440 (4 views) ----
await setW(1440);
const shots = [
  ['header_00992_bar.png', '00992.HK', 'bar', 'revenue'],
  ['header_AAPL_bridge.png', 'AAPL', 'bridge', null],
  ['header_600887_segment.png', '600887.SS', 'bar', 'seg:奶粉及奶制品'],
  ['header_00700_bar.png', '00700.HK', 'bar', 'revenue'],
];
for (const [file, tk, view, bi] of shots) {
  await evl(`(()=>{ state.company=${JSON.stringify(tk)}; state.view=${JSON.stringify(view)}; ${bi ? `state.barItem=${JSON.stringify(bi)};` : ''} render(); })()`);
  await new Promise(r => setTimeout(r, 700));
  await shot(file);
}

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
