// Headless verify: company switch preserves view state (view mode, bar item,
// pct/qoq toggles, dataZoom window, selected period with nearest-alignment),
// plus full-state URL hash deep-link.
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9342;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PROFILE = new URL('./.chrome/verify-mem-' + Date.now() + '/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + PROFILE, 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = list.find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => {
  const r = (await send('Runtime.evaluate', { expression: ex, returnByValue: true })).result;
  if (r?.result?.subtype === 'error' || r?.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r?.result?.description || r?.exceptionDetails?.exception?.description || r));
  return r?.result?.value;
};
await send('Page.enable');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};

// ---------- setup: NVDA, bar view, custom state ----------
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));
await evl(`document.getElementById('btnViewBar').click()`);
await new Promise(r => setTimeout(r, 700));
// pick margin:net, turn the QoQ line OFF, zoom to a 2020-2023 window
await evl(`(s=document.getElementById('barSelect'),s.value='margin:net',s.dispatchEvent(new Event('change')),true)`);
await evl(`document.getElementById('btnQoQ').click()`);
await new Promise(r => setTimeout(r, 400));
const setup = await evl(`(() => {
  const labels = chart.getOption().xAxis[0].data;
  const i0 = labels.findIndex(l => l.includes("'20")), i1 = labels.findIndex(l => l.includes("'23"));
  chart.dispatchAction({ type: 'dataZoom', xAxisIndex: 0, startValue: i0, endValue: i1 });
  return { start: chart.getOption().dataZoom[0].start, end: chart.getOption().dataZoom[0].end, i0, i1 };
})()`);
check('setup: zoom window set', setup.start != null && setup.end != null, JSON.stringify(setup));

// ---------- switch company: everything must survive ----------
await evl(`document.querySelector('#logoRail .logo[data-sym="AAPL"]').click()`);
await new Promise(r => setTimeout(r, 1000));
const kept = await evl(`(() => {
  const o = chart.getOption();
  return {
    view: state.view,
    barItem: document.getElementById('barSelect').value,
    qoqLineOff: !(o.series || []).some(s => s.type === 'line' && /QoQ|环比|同比/.test(s.name || '')),
    pctLineOn: (o.series || []).some(s => s.type === 'line' && /占营收/.test(s.name || '')),
    dz: o.dataZoom[0] ? { start: o.dataZoom[0].start, end: o.dataZoom[0].end } : null,
    company: state.company,
    hash: location.hash,
  };
})()`);
check('view stays 柱状图', kept.view === 'bar');
check('metric kept (margin:net)', kept.barItem === 'margin:net', kept.barItem);
check('QoQ line stays off / 占比 stays on', kept.qoqLineOff && kept.pctLineOn);
check('dataZoom window kept across company switch',
  kept.dz && Math.abs(kept.dz.start - setup.start) < 1.5 && Math.abs(kept.dz.end - setup.end) < 1.5, JSON.stringify(kept.dz));
const hp = new URLSearchParams((kept.hash || '').slice(1));
check('hash carries c + q + v + m', hp.get('c') === 'AAPL' && hp.get('v') === 'bar' && hp.get('m') === 'margin:net' && !!hp.get('q'), kept.hash);
await shot('mem-bar-kept.png');

// ---------- selected period: date-aligned, never reset ----------
// switch to bridge, pick an early quarter, then switch company
await evl(`document.getElementById('btnViewBridge').click()`);
await new Promise(r => setTimeout(r, 500));
const picked = await evl(`(() => {
  const qs = DATA.companies.NVDA.quarters;
  setQuarter(20); // some middle quarter
  return { end: qs[20].end };
})()`);
await new Promise(r => setTimeout(r, 400));
await evl(`document.querySelector('#logoRail .logo[data-sym="GOOGL"]').click()`);
await new Promise(r => setTimeout(r, 800));
const aligned = await evl(`(() => {
  const qs = DATA.companies.GOOGL.quarters;
  const ci = curQIndex();
  const p = new URLSearchParams(location.hash.slice(1));
  return { selEnd: qs[ci] && qs[ci].end, hashQ: p.get('q'), title: document.getElementById('chartTitle').textContent };
})()`);
check('selected period survives switch (exact or nearest, not latest)',
  aligned.selEnd != null && aligned.hashQ === aligned.selEnd, JSON.stringify(aligned));

// nearest-alignment fallback: NVDA 2026-07-26 → HUAWEI (annual, 2025-12-31) + toast hint
await evl(`setQuarter(DATA.companies.NVDA.quarters.length - 1)`);
await new Promise(r => setTimeout(r, 300));
await evl(`document.querySelector('#logoRail .logo[data-sym="HUAWEI"]').click()`);
await new Promise(r => setTimeout(r, 700));
const hw = await evl(`(() => {
  const qs = DATA.companies.HUAWEI.quarters;
  const ci = curQIndex();
  return { selEnd: qs[ci] && qs[ci].end, toastShown: !!document.querySelector('#hintToast.show'), title: document.getElementById('chartTitle').textContent };
})()`);
check('missing period → nearest aligned (HUAWEI annual)', hw.selEnd != null && hw.title.length > 0, JSON.stringify(hw));
check('realignment toast hint shown', hw.toastShown === true);
await shot('mem-huawei-aligned.png');

// ---------- full-state deep-link ----------
await send('Page.navigate', { url: 'about:blank' });
await new Promise(r => setTimeout(r, 400));
await send('Page.navigate', { url: BASE + '/index.html#c=GOOGL&q=2020-06-30&v=bar&m=margin:gross' });
await new Promise(r => setTimeout(r, 3000));
const deep = await evl(`(() => {
  const qs = DATA.companies.GOOGL.quarters;
  return {
    company: state.company, view: state.view,
    barItem: document.getElementById('barSelect').value,
    qEnd: qs[curQIndex()] && qs[curQIndex()].end,
    title: document.getElementById('chartTitle').textContent,
  };
})()`);
check('deep-link: company + view + metric restored',
  deep.company === 'GOOGL' && deep.view === 'bar' && deep.barItem === 'margin:gross', JSON.stringify(deep));
check('deep-link: period restored (exact or nearest)', deep.qEnd != null, JSON.stringify(deep));
await shot('mem-deeplink.png');

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
