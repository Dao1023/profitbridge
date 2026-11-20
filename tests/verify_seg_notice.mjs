// verify_seg_notice.mjs — the sankey "no segment data" notice must stay inside the empty
// input band (strictly left of the 营收 column) at every common width, and must not clip
// long English reasons (AVGO 33 chars, CRWV 278 chars, 000660.KS 384 chars).
// Regression: the old graphic style was {width:176, overflow:'break'}; ECharts only breaks
// on spaces/CJK, so "segment"/"revenue" ran to x≈190 while the revenue column starts at
// x=170 and the text painted over the 营收 node.
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9391;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });
const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-segnotice/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };
const setW = w => send('Emulation.setDeviceMetricsOverride', { width: w, height: 1050, deviceScaleFactor: 1, mobile: false });

// geometry of the notice: per-line bbox in canvas space + the sankey series left edge
const geom = () => evl(`(()=>{
  const dl = chart.getZr().storage.getDisplayList();
  const world = el => { const r=el.getBoundingRect(), m=el.transform||[1,0,0,1,0,0];
    return {left:+(r.x*m[0]+m[4]).toFixed(1), top:+(r.y*m[3]+m[5]).toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
            right:+(r.x*m[0]+m[4]+r.width).toFixed(1), bottom:+(r.y*m[3]+m[5]+r.height).toFixed(1)}; };
  const lines = dl.filter(e=>e.type==='tspan' && e.style && e.style.text).map(e=>({text:e.style.text, ...world(e), styleW:e.style.width, overflow:e.style.overflow}))
                  .filter(x=>x.left<=20 && x.top>100);
  const s = chart.getOption().series[0] || {};
  const style = (segmentNoticeGraphic(sankeySegPlan(state.company, q()))[0]||{}).style || null;
  return { lines, rightEdge: lines.length?Math.max(...lines.map(x=>x.right)):null,
    bottomEdge: lines.length?Math.max(...lines.map(x=>x.bottom)):null,
    revLeft: typeof s.left === 'number' ? s.left : null, canvasH: chart.getHeight(),
    styleW: style && style.width, overflow: style && style.overflow, full: style && style.text,
    text: lines.map(x=>x.text).join('') };
})()`);
const norm = s => String(s || '').replace(/\s+/g, '');   // wrap drops the break-space; compare content only

let worst = -Infinity;
for (const tk of ['AVGO', 'CRWV', '000660.KS']) {
  for (const w of [1280, 1440, 1600]) {
    await setW(w); await sleep(250);
    await evlA(`state.company=${JSON.stringify(tk)}; state.view='bridge'; state.mode.pct=false; state.mode.qoq=false; render(); true`);
    await sleep(500);
    const g = await geom();
    check(`${tk} @${w}: notice painted`, !!g && g.lines.length > 0, JSON.stringify(g && { lines: g.lines.length }));
    check(`${tk} @${w}: notice text right ${g?.rightEdge} < revenue column left ${g?.revLeft}`, !!g && g.rightEdge != null && g.revLeft != null && g.rightEdge < g.revLeft, JSON.stringify({ rightEdge: g?.rightEdge, revLeft: g?.revLeft }));
    check(`${tk} @${w}: style width ${g?.styleW} fits band (<= ${g?.revLeft != null ? g.revLeft - 16 - 8 : '?'})`, !!g && g.styleW <= g.revLeft - 24 && g.styleW === Math.min(176, g.revLeft - 24), JSON.stringify({ styleW: g?.styleW, revLeft: g?.revLeft }));
    check(`${tk} @${w}: overflow breakAll (English words break, not overflow)`, g?.overflow === 'breakAll', g?.overflow);
    check(`${tk} @${w}: full notice text rendered (nothing clipped)`, norm(g?.text) === norm(g?.full), JSON.stringify({ rendered: norm(g?.text).length, expected: norm(g?.full).length }));
    check(`${tk} @${w}: notice bottom ${g?.bottomEdge} inside canvas ${g?.canvasH}`, g?.bottomEdge <= g.canvasH, JSON.stringify({ bottom: g?.bottomEdge, canvasH: g?.canvasH }));
    if (g?.rightEdge != null && g?.revLeft != null) worst = Math.max(worst, g.rightEdge - g.revLeft);
    if (tk === 'AVGO' && w === 1280) await shot('notice_AVGO_1280.png');
    if (tk === 'CRWV' && w === 1440) await shot('notice_CRWV_1440.png');
    if (tk === '000660.KS' && w === 1440) await shot('notice_000660KS_1440.png');
  }
}
check('worst horizontal overrun is negative (never crosses into 营收 column)', worst < 0, `max(rightEdge-revLeft)=${worst.toFixed(1)}px`);
await setW(1440); await sleep(200);

// a company that DOES have segments shows no notice at all
await evlA(`state.company='NVDA'; render(); true`); await sleep(400);
check('NVDA (has segments): no notice graphic', await evl(`segmentNoticeGraphic(sankeySegPlan(state.company, q())).length===0`));

check('no console/exception errors during run', errors.length === 0, JSON.stringify(errors).slice(0, 300));
const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed; worst overrun ${worst.toFixed(1)}px`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
