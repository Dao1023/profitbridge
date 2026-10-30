// verify_bar_cum_growth.mjs — bar view 环比 line vs cumulative periods (P1 regression, headless CDP).
//  - cumulative interim/FY points must use YoY (same MM-DD, prior year), never a bogus QoQ vs the
//    preceding bar; where no prior-year base exists the line breaks (null)
//  - 09633.HK / 00151.HK (hk-mixed): last point == hand-computed YoY (not the QoQ label), series
//    name + tooltip flag the YoY basis
//  - 00151.HK intra-series points whose *old* QoQ was fake are corrected (2017-06-30 / 2008-06-30),
//    and a q3 point right after an interim is broken (null) due to base-period mismatch
//  - 600519.SS (single-quarter 'q') stays QoQ -31.31 (no collateral damage)
//  - 00700.HK / BABA (quarterly) untouched
//  - NESN.SW / MC.PA are now half-year reporters (frequency 'mixed', 5 annual + 5 H1 interim
//    2021-2025 + H1-2026): annual rows are stripped from the bar series, leaving 6 H1 cumulative
//    points (YoY basis, no bogus QoQ) — the intended semantic change from 'annual'.
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9352;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-cum/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
const evlA = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable');
await send('Runtime.enable');

const errors = [];
ws.onmessage = addHandler();
function addHandler() {
  const prev = ws.onmessage;
  return e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
}

await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const near = (a, b, tol = 0.05) => a != null && b != null && Math.abs(a - b) <= tol;

// Read the real ECharts series for a company in bar view with the 环比 line enabled, plus the
// underlying bar quarters (end / revenue / periodType) so expectations are hand-derived from json.
async function barSample(tk) {
  return await evl(`(()=>{
    state.company=${JSON.stringify(tk)}; state.view='bar'; state.barItem='revenue';
    state.mode.pct=false; state.mode.qoq=true; render();
    const c=DATA.companies[${JSON.stringify(tk)}];
    const qs=(c.frequency==='hk-mixed'||c.frequency==='mixed')?c.quarters.filter(q=>q.periodType!=='annual'):c.quarters;
    const o=chart.getOption();
    const lines=o.series.filter(s=>s.type==='line');
    const g=lines[lines.length-1]||{name:'',data:[]};
    return { ends:qs.map(q=>q.end), rev:qs.map(q=>q.revenue), fx:qs.map(q=>q.fxToUsd), ptype:qs.map(q=>q.periodType),
             growth:g.data, growthName:g.name, basis:window.__barMeta.growthBasis, freq:c.frequency,
             hasCumPoint:window.__barMeta.hasCumPoint };
  })()`);
}
const idxOf = (s, end) => s.ends.indexOf(end);
const yoyAt = (s, idx) => { // same MM-DD, prior year, among the bar points (mirrors app yoyBaseIndex)
  if (idx < 0 || !s.ends[idx]) return null;
  const md = s.ends[idx].slice(5), y = String(Number(s.ends[idx].slice(0, 4)) - 1);
  let b = -1; for (let j = idx - 1; j >= 0; j--) if (s.ends[j].slice(5) === md && s.ends[j].slice(0, 4) === y) { b = j; break; }
  return b < 0 ? null : (s.rev[idx] - s.rev[b]) / Math.abs(s.rev[b]) * 100;
};
const qoqAt = (s, idx) => idx > 0 && s.rev[idx - 1] != null ? (s.rev[idx] - s.rev[idx - 1]) / Math.abs(s.rev[idx - 1]) * 100 : null;
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };

// ---------- 09633.HK: last point is a half-year cumulative point ----------
let s = await barSample('09633.HK');
let i = idxOf(s, '2026-06-30');
let expY = yoyAt(s, i);
check('09633 bar quarters are all interims (hk-mixed strips annual 12-31)', s.ends.every(e => e.slice(5) === '06-30'), JSON.stringify(s.ends));
check('09633 2026-06-30 growth == hand-computed YoY (vs 2025-06-30), not a raw QoQ', near(s.growth[i], expY), `got=${s.growth[i]} yoy=${expY?.toFixed(2)}`);
check('09633 2026-06-30 basis tagged yoy', s.basis[i] === 'yoy', `basis=${s.basis[i]}`);
check("09633 legend suffix flags cumulative-YoY (环比（累计期用同比）), not plain QoQ",
  /累计期用同比|YoY on cumulative/.test(s.growthName) && s.growthName !== '营收 · QoQ %', s.growthName);
// note: with annual points stripped, the prior bar already equals the same period last year,
// so here the *number* legitimately equals the old value — the defect was the label/basis.
check('09633 2026-06-30 number coincides with old 15.99 (label-only defect here)', near(s.growth[i], 15.99), `got=${s.growth[i]}`);
// tooltip must label it 同比 (never imply QoQ)
await shot('bar_09633_qoq.png');
const tip09633 = await evlA(`(async()=>{ chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:${i}}); await new Promise(r=>setTimeout(r,300));
  const el=document.querySelector('#sankey div[style*="position: absolute"]'); return el?el.textContent:''; })()`);
check('09633 tooltip marks cumulative point as 同比/YoY + shows +16.0%', typeof tip09633 === 'string' && /同比|YoY/.test(tip09633) && tip09633.includes('16.0%'), JSON.stringify(tip09633?.slice(0, 140)));

// ---------- 00151.HK: hk-mixed, last point + real numeric corrections inside series ----------
s = await barSample('00151.HK');
i = idxOf(s, '2025-09-30');
expY = yoyAt(s, i);
check('00151 2025-09-30 growth == hand-computed YoY (vs 2024-09-30)', near(s.growth[i], expY), `got=${s.growth[i]} yoy=${expY?.toFixed(2)}`);
check('00151 2025-09-30 basis tagged yoy', s.basis[i] === 'yoy');
check('00151 legend suffix flags cumulative-YoY', /累计期用同比|YoY on cumulative/.test(s.growthName), s.growthName);
check('00151 2025-09-30 number == old 2.13 (label-only defect here)', near(s.growth[i], 2.13), `got=${s.growth[i]}`);
// a point whose OLD QoQ was a fake number: 2017-06-30 vs prior bar was -34.8, real YoY = -7.72
let j = idxOf(s, '2017-06-30');
const expY17 = yoyAt(s, j), oldQoq17 = qoqAt(s, j);
check('00151 2017-06-30 corrected to YoY (not the old fake QoQ)', near(s.growth[j], expY17) && Math.abs(s.growth[j] - oldQoq17) > 1, `got=${s.growth[j]} yoy=${expY17?.toFixed(2)} oldQoQ=${oldQoq17?.toFixed(2)}`);
check('00151 2017-06-30 basis yoy', s.basis[j] === 'yoy');
// q3 right after an interim: base period inconsistent → line must break (null)
const j3 = idxOf(s, '2017-09-30');
check('00151 2017-09-30 (q3 after interim) has no growth (base mismatch → null)', j3 >= 0 && s.growth[j3] == null && s.basis[j3] == null, `idx=${j3} v=${s.growth[j3]}`);
await shot('bar_00151_qoq.png');

// ---------- 600519.SS: single-quarter filer — must stay QoQ -31.31 ----------
s = await barSample('600519.SS');
i = idxOf(s, '2026-06-30');
check('600519 2026-06-30 stays QoQ -31.31 (single-quarter filer untouched)', near(s.growth[i], -31.31) && near(s.growth[i], qoqAt(s, i)), `got=${s.growth[i]}`);
check('600519 2026-06-30 basis qoq', s.basis[i] === 'qoq');
check('600519 legend suffix is plain QoQ', s.growthName === '营收 · QoQ %', s.growthName);
await shot('bar_600519_qoq.png');

// ---------- 00700.HK: ordinary HK single-quarter — regression unchanged ----------
s = await barSample('00700.HK');
i = s.ends.length - 1;
check('00700 last point unaffected (== hand QoQ)', near(s.growth[i], qoqAt(s, i)), `got=${s.growth[i]} qoq=${qoqAt(s, i)?.toFixed(2)}`);
check('00700 basis qoq (no cumulative guard fired)', s.basis[i] === 'qoq' && !/累计期用同比/.test(s.growthName));

// ---------- BABA: mixed but quarterly — unchanged ----------
s = await barSample('BABA');
i = s.ends.length - 1;
check('BABA last point unaffected (== hand QoQ)', near(s.growth[i], qoqAt(s, i)), `got=${s.growth[i]} qoq=${qoqAt(s, i)?.toFixed(2)}`);
check('BABA basis qoq', s.basis[i] === 'qoq');

// ---------- NESN.SW / MC.PA: 半年报(mixed)公司 — annual 行不进柱状图，条形为 2021-2025 H1 + H1-2026 共 6 根累计柱 ----------
// 有意语义变化：两家为 mixed（5 个年度期 + 5 个 H1 interim 2021-2025 + H1-2026 interim）。
// 柱状图对 mixed 剔除 annual 行，只剩 6 根 H1 累计柱；每根都必须带累计标记。
for (const tk of ['NESN.SW', 'MC.PA']) {
  s = await barSample(tk);
  i = idxOf(s, '2026-06-30');
  check(`${tk} is mixed series; annual 12-31 rows stripped from bars`, s.freq === 'mixed' && s.ends.every(e => e.slice(5) !== '12-31'), `freq=${s.freq} ends=${JSON.stringify(s.ends)}`);
  check(`${tk} bar series has 6 H1 points (2021-2025 + 2026)`, s.ends.length === 6 && s.ends.every(e => e.slice(5) === '06-30'), JSON.stringify(s.ends));
  check(`${tk} last bar is the H1-2026 interim point`, i >= 0 && s.ptype[i] === 'interim', `idx=${i} ptype=${s.ptype[i]}`);
  check(`${tk} every H1 bar carries the cumulative marker (decal / hasCumPoint)`, s.hasCumPoint === true, `hasCum=${s.hasCumPoint}`);
  // 柱状图 growth 线用「展示口径」数值（已按 fxToUsd 折算的 USD 值）计算同比 → 用折算后数值核对
  const yoyDisp = (() => {
    const md = s.ends[i].slice(5), y = String(Number(s.ends[i].slice(0, 4)) - 1);
    let b = -1; for (let j = i - 1; j >= 0; j--) if (s.ends[j].slice(5) === md && s.ends[j].slice(0, 4) === y) { b = j; break; }
    if (b < 0) return null;
    return (s.rev[i] * s.fx[i] - s.rev[b] * s.fx[b]) / Math.abs(s.rev[b] * s.fx[b]) * 100;
  })();
  check(`${tk} H1-2026 growth == hand-computed YoY on displayed (USD) values, not null/QoQ`, near(s.growth[i], yoyDisp) && s.growth[i] != null, `got=${s.growth[i]} yoyDisp=${yoyDisp?.toFixed(2)}`);
}

// ---------- console clean ----------
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
