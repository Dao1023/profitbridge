// verify_pct_fix.mjs — regression for the four 占比 / 派生百分比 bugs (headless CDP, raw).
//  A. bar 占比 line no longer ÷1000: BILI Advertising ≈39.43%; revenue bar share ≈100%.
//  B. sankey margin labels correct for non-USD filers: SPOT/ASML(EUR) 毛利, SONY(JPY) 毛利,
//     005930(KRW) 净利 — match the audit report baselines (±0.5pp).
//  C. bar segment merges duplicate sibling names → equals the sankey merged node value:
//     600887.SS / 688981.SS "其他" (was only the first line).
//  D. cumulative (half/FY) segment bar divides by the SAME YTD cumulative revenue the
//     sankey uses: 600519 茅台酒 ≈84.23%, 000333 智能家居业务 ≈66.78% (±1pp).
//  + multi-currency revenue bar share ≈100% each (EUR/JPY/KRW/TWD/CHF/DKK/HKD/CNY).
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9388;
const WIN = p => p.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHOTS = 'tmp-audit-pct/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-sandbox',
  '--window-size=1680,1050',
  '--user-data-dir=' + WIN(new URL('./.chrome/pct-fix/', import.meta.url)), 'about:blank',
]);
await new Promise(r => setTimeout(r, 1600));
let list = null;
for (let i = 0; i < 25; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await new Promise(r => setTimeout(r, 400)); } }
if (!list) { console.error('chrome CDP never came up'); process.exit(1); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => {
  const m = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true });
  const r = m.result?.result;
  if (m.result?.exceptionDetails || r?.subtype === 'error') { console.error('EVL-ERR', r?.description || JSON.stringify(m.result?.exceptionDetails)); return undefined; }
  return r?.value;
};
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3200));
for (let i = 0; i < 20; i++) { const ok = await evl(`typeof DATA==='object' && !!DATA && !!DATA.companies`); if (ok) break; await new Promise(r => setTimeout(r, 400)); }

const errors = [];
await send('Runtime.enable');
{
  const prev = ws.onmessage;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { await sleep(1400); const { result } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(result.data, 'base64')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- bar selection; returns value + pctLine at a given end (or last non-null) ----
async function bar(tk, itemId, end) {
  const expr = `(() => { try {
    state.company=${JSON.stringify(tk)}; state.view='bar'; state.curMode='native'; state.barItem=${JSON.stringify(itemId)}; state.qIndex=null;
    render();
    const meta=window.__barMeta, qs=barQuarters(${JSON.stringify(tk)});
    let idx = ${end ? `qs.findIndex(q=>q.end===${JSON.stringify(end)})` : 'meta.data.map((v,i)=>i).filter(i=>meta.data[i]!=null).pop()'};
    return { ok:true, idx, endIdx: idx<0?null:qs[idx].end, val: idx<0?null:meta.data[idx], pct: idx<0?null:meta.pctLine[idx],
      n: meta.data.length, title: document.getElementById('chartTitle').textContent,
      has: qs.some(q=>q.end===${JSON.stringify(end || '')}) };
  } catch(e){ return { ok:false, err:String(e&&e.message||e) }; } })()`;
  return await evl(expr);
}
async function sankey(tk, end, pct) {
  const qi = end ? `DATA.companies[${JSON.stringify(tk)}].quarters.findIndex(q=>q.end===${JSON.stringify(end)})` : `null`;
  return await evl(`(() => { try {
    state.company=${JSON.stringify(tk)}; state.view='bridge'; state.curMode='native';
    state.qIndex=${qi}; state.mode.pct=${!!pct}; state.mode.qoq=false;
    render();
    const nodes={}; for(const n of window.__sankeyMeta.nodes) nodes[n.name]=n.value;
    return { ok:true, nodes, quarter:window.__sankeyMeta.quarter, title:document.getElementById('chartTitle').textContent,
      svg: chart.renderToSVGString() };
  } catch(e){ return { ok:false, err:String(e&&e.message||e) }; } })()`);
}
const qOf = (tk, end) => P.companies[tk].quarters.find(q => q.end === end) || P.companies[tk].quarters[P.companies[tk].quarters.length - 1];
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// ================= A. bar 占比 line not ÷1000 =================
{
  const d = await bar('BILI', 'seg:Advertising', null);
  check('A: BILI Advertising bar point present', d.ok && d.val != null, JSON.stringify({ idx: d.idx, end: d.endIdx, val: d.val }));
  check('A: BILI Advertising 占比 ≈39.43% ±0.5 (not 0.04%)', d.pct != null && Math.abs(d.pct - 39.43) <= 0.5, `pct=${d.pct}`);
  check('A: BILI Advertising 占比 not the old ÷1000 value (<1)', d.pct != null && d.pct > 5, `pct=${d.pct}`);
  await shot('bili-advertising.png');

  // BUG-E: selecting revenue no longer draws a "占营收 %" line (it would be identically
  // 100%), so the old "≈100%" assertion is replaced by an explicit "line absent" check.
  const rv = await bar('BILI', 'revenue', null);
  check('A: BILI revenue → 占营收 line suppressed (identity 100% carries no info)', rv.ok && rv.val != null && rv.pct == null, `pct=${JSON.stringify(rv.pct)} val=${rv.val}`);
}

// ================= multi-currency revenue: redundant 占营收 line is suppressed =================
{
  const cos = ['SPOT', 'ASML', 'SONY', '005930.KS', 'TSM', 'NESN.SW', 'LEGO', '00700.HK', '600887.SS'];
  for (const tk of cos) {
    const d = await bar(tk, 'revenue', null);
    const cur = (P.companies[tk].currency || 'USD-M');
    check(`A/multi: ${tk} (${cur}) revenue → 占营收 line suppressed, bar present`, d.ok && d.val != null && d.pct == null, `pct=${JSON.stringify(d.pct)} val=${d.val} end=${d.endIdx}`);
  }
}

// ================= B. sankey margin labels for non-USD filers =================
{
  const cases = [
    { tk: 'SPOT', key: 'gross', nodeZh: '毛利率', baseline: 32.99 },
    { tk: 'ASML', key: 'gross', nodeZh: '毛利率', baseline: 57.45 },
    { tk: 'SONY', key: 'gross', nodeZh: '毛利率', baseline: 36.70 },
    { tk: '005930.KS', key: 'net', nodeZh: '净利率', baseline: 36.48 },
  ];
  for (const c of cases) {
    const d = await sankey(c.tk, null, true);
    const q = qOf(c.tk, d.quarter);
    const truth = q[c.key === 'gross' ? 'gross' : c.key === 'net' ? 'netInc' : 'opInc'] / q.revenue * 100;
    const labelStr = `${c.nodeZh} ${truth.toFixed(1)}%`; // fmtPct = (ratio*100).toFixed(1)
    check(`B: ${c.tk} sankey label ≈ baseline ${c.baseline}% ±0.5pp`, Math.abs(truth - c.baseline) <= 0.5, `truth=${truth.toFixed(3)}`);
    check(`B: ${c.tk} rendered sankey label "${labelStr}"`, typeof d.svg === 'string' && d.svg.includes(labelStr), `has=${d.svg ? d.svg.includes(labelStr) : 'no-svg'}`);
    if (c.tk === 'SPOT') await shot('spot-sankey-margin.png');
  }
}

// ================= C. bar segment merges duplicate sibling names =================
{
  for (const [tk, end, nm, baselineB] of [['600887.SS', '2026-06-30', '其他', 1.8226], ['688981.SS', '2025-12-31', '其他', 4.5289]]) {
    const d = await bar(tk, 'seg:' + nm, end);
    check(`C: ${tk} ${end} 分部「${nm}」bar 值 ≈ merged ${baselineB}¥B (±0.5%)`, d.ok && d.val != null && rel(d.val, baselineB) < 0.005, `val=${d.val} end=${d.endIdx}`);
    const s = await sankey(tk, end, false);
    const sv = s.nodes[nm];
    check(`C: ${tk} bar 值 = sankey 合并节点值 (±0.5%)`, d.val != null && sv != null && rel(d.val, sv) < 0.005, `bar=${d.val} sankey=${sv}`);
  }
}

// ================= D. cumulative segment bar ÷ YTD revenue =================
{
  const cases = [['600519.SS', '2026-06-30', '茅台酒', 84.23, 206.85], ['000333.SZ', '2026-06-30', '智能家居业务', 66.78, 134.66]];
  for (const [tk, end, nm, baseline, wrong] of cases) {
    const d = await bar(tk, 'seg:' + nm, end);
    check(`D: ${tk} ${end} 「${nm}」累计占比 ≈${baseline}% ±1pp`, d.ok && d.pct != null && Math.abs(d.pct - baseline) <= 1, `pct=${d.pct} end=${d.endIdx}`);
    check(`D: ${tk} not the single-quarter-denominator value (${wrong}%)`, d.pct != null && Math.abs(d.pct - wrong) > 5, `pct=${d.pct}`);
    check(`D: ${tk} title flags cumulative basis`, d.ok && /累计口径/.test(d.title), d.title);
    if (tk === '600519.SS') await shot('600519-maotai-h1.png');
  }
}

check('no console/exception errors during run', errors.length === 0, JSON.stringify(errors).slice(0, 400));

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
