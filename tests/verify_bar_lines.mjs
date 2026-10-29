// verify_bar_lines.mjs — bar view overlay lines follow selected item; 占比/环比 button
// toggles (visual active state + line visibility); single-select industry filter regression.
// raw CDP headless, same pattern as verify_filter_jitter
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9364;
const BASE = 'http://127.0.0.1:8440/index.html';
const OUT = 'tests/out';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' ' + info : ''}`);
  ok ? pass++ : fail++;
};

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-sandbox',
  '--window-size=1654,950',
  '--user-data-dir=' + new URL(`./.chrome/bar-lines-${Date.now()}/`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
]);
await new Promise(r => setTimeout(r, 2500));

let list = null;
for (let i = 0; i < 20; i++) {
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; }
  catch { await new Promise(r => setTimeout(r, 500)); }
}
if (!list) { console.error('chrome CDP never came up'); process.exit(1); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => {
  const m = await send('Runtime.evaluate', { expression: ex, returnByValue: true });
  const r = m.result?.result;
  if (m.result?.exceptionDetails || r?.subtype === 'error') { console.error('EVL-ERR', r?.description || JSON.stringify(m.result?.exceptionDetails)); return undefined; }
  return r?.value;
};
await send('Page.enable');
await send('Page.navigate', { url: BASE });
await new Promise(r => setTimeout(r, 3500));
const shot = async name => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(result.data, 'base64'));
};

// ---------- single-select industry filter regression ----------
await evl(`document.querySelector('#industryBar .indBtn[data-ind="semi"]').click()`);
await new Promise(r => setTimeout(r, 300));
const single1 = await evl(`({ hash: location.hash, vis: [...document.querySelectorAll('#logoRail .logo')].filter(l => !l.classList.contains('hidden')).length, act: [...document.querySelectorAll('#industryBar .indBtn.active')].map(b => b.dataset.ind) })`);
await evl(`document.querySelector('#industryBar .indBtn[data-ind="soft"]').click()`);
await new Promise(r => setTimeout(r, 300));
const single2 = await evl(`({ hash: location.hash, act: [...document.querySelectorAll('#industryBar .indBtn.active')].map(b => b.dataset.ind) })`);
const hp1 = new URLSearchParams(single1.hash.slice(1)), hp2 = new URLSearchParams(single2.hash.slice(1));
check('filter is single-select: switching pill replaces selection',
  hp1.get('ind') === 'semi' && hp2.get('ind') === 'soft' && single2.act.join() === 'soft', JSON.stringify({ single1, single2 }));
await evl(`document.querySelector('#industryBar .indBtn[data-ind="soft"]').click()`);
await new Promise(r => setTimeout(r, 300));
const cleared = await evl(`({ hash: location.hash, act: [...document.querySelectorAll('#industryBar .indBtn.active')].map(b => b.dataset.ind) })`);
check('clicking selected pill clears filter', !new URLSearchParams(cleared.hash.slice(1)).has('ind') && cleared.act.join() === 'all', JSON.stringify(cleared));

// ---------- bar view: lines follow selected item ----------
await evl(`document.getElementById('btnViewBar').click()`);
await new Promise(r => setTimeout(r, 1200));

let meta = await evl(`window.__barMeta`);
check('bar view (revenue): both lines shown, names carry item label',
  meta.linesShown.length === 2 && meta.linesShown[0].includes('营收') && meta.linesShown[1].includes('QoQ'), JSON.stringify(meta.linesShown));
check('share line: values 0-100, enough points',
  meta.pctLine.filter(v => v != null).length >= 5 && meta.pctLine.every(v => v == null || (v > 0 && v <= 101)),
  `n=${meta.pctLine.filter(v => v != null).length} first=${meta.pctLine[0]}`);
check('growth line: first quarter broken (null), rest numeric',
  meta.growthLine[0] === null && meta.growthLine.slice(1).filter(v => v != null).length >= 5,
  `growth[1]=${meta.growthLine[1]}`);
// OLD golden standard below copied the BUG-A formula (data[i]/m.revenue*100, $B÷$M),
// so it could never catch the 1000× shrink. Correct share uses data[i]*MB/m.revenue*100
// (same as verify_bar.mjs / the tooltip). revenue bar share must be ≈100%.
const cross = await evl(`(() => {
  const i = 3, qv = DATA.companies[state.company].quarters[i];
  const m = rawMetrics(qv);
  return Math.abs(window.__barMeta.pctLine[i] - __barMeta.data[i] * MB / m.revenue * 100) < 3;
})()`);
check('share line ≈ item×MB/revenue (spot check q3)', cross === true, `cross=${cross}`);
const revShare = await evl(`(() => {
  const n = window.__barMeta.data.length - 1, qv = DATA.companies[state.company].quarters[n];
  const m = rawMetrics(qv);
  return { pct: window.__barMeta.pctLine[n], truth: __barMeta.data[n] * MB / m.revenue * 100 };
})()`);
check('revenue bar share ≈100% (±0.5) — catches the ÷1000 regression',
  Math.abs(revShare.pct - 100) <= 0.5, JSON.stringify(revShare));
const opt1 = await evl(`(() => { const o = chart.getOption(); return { nSeries: o.series.length, types: o.series.map(s=>s.type), yAxes: o.yAxis.length, legend: !!o.legend }; })()`);
check('echarts option: bar + 2 lines, dual yAxis, legend',
  opt1.nSeries === 3 && opt1.types.join() === 'bar,line,line' && opt1.yAxes === 2 && opt1.legend, JSON.stringify(opt1));
await shot('bar-lines-both.png');

// switch item to rd (研发费用): lines must follow
await evl(`(() => { const sel = document.getElementById('barSelect'); sel.value = 'rd'; sel.dispatchEvent(new Event('change')); })()`);
await new Promise(r => setTimeout(r, 800));
meta = await evl(`window.__barMeta`);
check('item switch → lines re-labelled to 研发费用',
  meta.item === 'rd' && meta.linesShown.length === 2 && meta.linesShown[0].includes('研发'), JSON.stringify(meta.linesShown));

// ---------- 占比/环比 buttons: toggle lines + active visual state ----------
const actBefore = await evl(`({ pct: document.getElementById('btnPct').classList.contains('active'), qoq: document.getElementById('btnQoQ').classList.contains('active') })`);
await evl(`document.getElementById('btnPct').click()`);
await new Promise(r => setTimeout(r, 800));
meta = await evl(`window.__barMeta`);
const actAfterPct = await evl(`({ pct: document.getElementById('btnPct').classList.contains('active'), qoq: document.getElementById('btnQoQ').classList.contains('active') })`);
check('占比 click hides line AND button de-activates visually',
  meta.linesShown.length === 1 && actBefore.pct === true && actAfterPct.pct === false, JSON.stringify({ lines: meta.linesShown, actAfterPct }));
await shot('bar-lines-growth.png');
await evl(`document.getElementById('btnQoQ').click()`);
await new Promise(r => setTimeout(r, 800));
meta = await evl(`window.__barMeta`);
const opt2 = await evl(`(() => { const o = chart.getOption(); return { nSeries: o.series.length, legendItems: (o.legend && o.legend[0]) ? (o.legend[0].data || []).length : 0, yAxes: o.yAxis.length, actQoQ: document.getElementById('btnQoQ').classList.contains('active') }; })()`);
check('环比 click hides other line → bar only, legend gone, single axis, button off',
  meta.linesShown.length === 0 && opt2.nSeries === 1 && opt2.legendItems === 0 && opt2.yAxes === 1 && opt2.actQoQ === false, JSON.stringify(opt2));
await shot('bar-lines-none.png');
await evl(`document.getElementById('btnPct').click()`);
await new Promise(r => setTimeout(r, 300));
await evl(`document.getElementById('btnQoQ').click()`);
await new Promise(r => setTimeout(r, 800));
meta = await evl(`window.__barMeta`);
const actBack = await evl(`({ pct: document.getElementById('btnPct').classList.contains('active'), qoq: document.getElementById('btnQoQ').classList.contains('active') })`);
check('re-toggle: both lines back, both buttons active', meta.linesShown.length === 2 && actBack.pct && actBack.qoq, JSON.stringify({ lines: meta.linesShown, actBack }));

// ---------- sankey mode: buttons keep old semantics ----------
await evl(`document.getElementById('btnViewBridge').click()`);
await new Promise(r => setTimeout(r, 800));
const sankeyBefore = await evl(`({ pct: state.mode.pct, btn: document.getElementById('btnPct').classList.contains('active') })`);
await evl(`document.getElementById('btnPct').click()`);
await new Promise(r => setTimeout(r, 500));
const sankeyAfter = await evl(`({ pct: state.mode.pct, btn: document.getElementById('btnPct').classList.contains('active') })`);
check('bridge view: 占比 button still toggles sankey state.mode.pct + active follows',
  sankeyBefore.pct === false && sankeyAfter.pct === true && sankeyAfter.btn === true, JSON.stringify({ sankeyBefore, sankeyAfter }));

console.log(`\n${pass + fail} checks, ${pass} passed, ${fail} failed`);
chrome.kill();
process.exit(fail ? 1 : 0);
