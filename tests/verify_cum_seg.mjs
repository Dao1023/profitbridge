// verify_cum_seg.mjs — cumulative-period segment reconciliation (headless CDP).
//  A-share/HK filers disclose segments on a half-year / FY-to-date basis while the
//  profit series stores single quarters. When the selected period's segments are
//  cumulative, the sankey must be rebuilt on fiscal-year-to-date profit sums so the
//  segment input side matches the revenue node. Covers:
//   1. 603866.SH @2026-06-30  → revenue node ≈ Q1+Q2 (¥2,559.6M), seg total within 2%,
//                               title contains 上半年累计
//   2. 603866.SH @2025-12-31  → revenue node = 4-quarter sum, seg total within 2%,
//                               title contains 全年累计
//   3. NVDA @2026-07-26       → quarter segments,口径不变 (96.2→72.1→63.7→59.7)
//   4. 00700.HK @2024-12-31   → annual segment, not double-summed (≈660.3B not 2×)
//   + guards: no-segment quarter is left untouched; QoQ marked 累计期不可比
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9349;
const WIN = p => p.pathname.replace(/^\/([A-Za-z]:)/, '$1');

const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
const S = JSON.parse(fs.readFileSync(new URL('../data/segments.json', import.meta.url), 'utf8'));
const qOf = (tk, end) => P.companies[tk].quarters.find(q => q.end === end);
const ytd = (tk, end, key) => {
  let any = false, sum = 0;
  for (const o of P.companies[tk].quarters) {
    if (o.end.slice(0, 4) === end.slice(0, 4) && o.end <= end && o[key] != null) { any = true; sum += o[key]; }
  }
  return any ? sum : null;
};
const segCny = (tk, end) => {
  const seg = S.companies[tk].quarters[end];
  const sum = seg.reduce((a, x) => a + (x.children ? x.children.reduce((b, c) => b + c.value, 0) : x.value), 0);
  return sum / qOf(tk, end).fxToUsd; // USD-M segments → native CNY-M at that period's fx
};

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + WIN(new URL('./.chrome/verify-profile-cumseg/', import.meta.url)), 'about:blank',
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
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const errors = [];
await send('Runtime.enable');
const prevOnMsg = ws.onmessage;
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function selectQ(tk, end, mode = {}) {
  const d = await evl(`(()=>{ try {
    state.company=${JSON.stringify(tk)}; state.view='bridge';
    state.qIndex=DATA.companies[${JSON.stringify(tk)}].quarters.findIndex(q=>q.end===${JSON.stringify(end)});
    state.mode.pct=${!!mode.pct}; state.mode.qoq=${!!mode.qoq}; render();
    const b=window.__bridgeCheck;
    return { ok:true, rev:b.revenue, input:b.inputSum, wf:b.waterfall,
      title:document.getElementById('chartTitle').textContent, qvEff:!!window.__qvEff,
      quarter:window.__sankeyMeta.quarter };
  } catch(e){ return { ok:false, err:String(e && e.message || e) }; } })()`);
  await sleep(120);
  return d;
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// ---------- 1. 603866.SH @2026-06-30 (H1 cumulative) ----------
{
  const end = '2026-06-30';
  const expRev = ytd('603866.SH', end, 'revenue') / 1000;   // ¥B (native)
  const expSeg = segCny('603866.SH', end) / 1000;
  const d = await selectQ('603866.SH', end);
  check('603866 H1: uses cumulative view (__qvEff set)', d.qvEff === true, `rev=${d.rev}`);
  check(`603866 H1: revenue node ≈ Q1+Q2 = ${expRev.toFixed(4)}B`, rel(d.rev, expRev) < 0.005, `got ${d.rev}, exp ${expRev.toFixed(4)}`);
  check('603866 H1: revenue node ≈ ¥2,559.6M order', Math.abs(d.rev - 2.5596) < 0.02, `${d.rev}B`);
  check('603866 H1: segment input matches revenue node (≤2%)', rel(d.input, d.rev) < 0.02, `input=${d.input} rev=${d.rev} dev=${(rel(d.input, d.rev) * 100).toFixed(3)}%`);
  check('603866 H1: seg total in ¥ order ≈ input', rel(expSeg, expRev) < 0.02, `segCny=${expSeg.toFixed(4)} expRev=${expRev.toFixed(4)}`);
  check('603866 H1: title contains 上半年累计', /上半年累计/.test(d.title), d.title);
}
// QoQ must be disabled/incomparable in a cumulative period
{
  const d = await selectQ('603866.SH', '2026-06-30', { qoq: true });
  const svg = await evl(`chart.renderToSVGString()`);
  check('603866 H1: QoQ shown as 累计期不可比 (not a fake %)', svg.includes('累计期不可比'), `title=${d.title}`);
}

// ---------- 2. 603866.SH @2025-12-31 (FY cumulative) ----------
{
  const end = '2025-12-31';
  const expRev = ytd('603866.SH', end, 'revenue') / 1000;
  const expSeg = segCny('603866.SH', end) / 1000;
  const d = await selectQ('603866.SH', end);
  check('603866 FY: uses cumulative view', d.qvEff === true, `rev=${d.rev}`);
  check(`603866 FY: revenue node = 4-quarter sum ${expRev.toFixed(4)}B`, rel(d.rev, expRev) < 0.005, `got ${d.rev}, exp ${expRev.toFixed(4)}`);
  check('603866 FY: segment input matches revenue node (≤2%)', rel(d.input, d.rev) < 0.02, `input=${d.input} rev=${d.rev} dev=${(rel(d.input, d.rev) * 100).toFixed(3)}%`);
  check('603866 FY: seg total matches (±2%)', rel(expSeg, expRev) < 0.02, `segCny=${expSeg.toFixed(4)} expRev=${expRev.toFixed(4)}`);
  check('603866 FY: title contains 全年累计', /全年累计/.test(d.title), d.title);
}

// ---------- 3. NVDA @2026-07-26 (quarter segments → unchanged) ----------
{
  const d = await selectQ('NVDA', '2026-07-26');
  const bridge = [d.rev, d.wf.gross, d.wf.op, d.wf.net].map(v => +v.toFixed(1));
  check('NVDA: no cumulative correction applied', d.qvEff === false, `qvEff=${d.qvEff}`);
  check('NVDA: bridge 96.2→72.1→63.7→59.7', JSON.stringify(bridge) === JSON.stringify([96.2, 72.1, 63.7, 59.7]), JSON.stringify(bridge));
  const svg2 = await evl(`(state.mode.qoq=true, render(), chart.renderToSVGString())`);
  check('NVDA: QoQ still numeric (not 累计期不可比)', !svg2.includes('累计期不可比'), 'svg ok');
  await evl(`(state.mode.qoq=false, render(), true)`);
}

// ---------- 4. 00700.HK @2024-12-31 (annual segment, single-quarter profit rows) ----------
{
  const end = '2024-12-31';
  const expRev = ytd('00700.HK', end, 'revenue') / 1000; // sum of 4 single quarters
  const expSeg = segCny('00700.HK', end) / 1000;
  const d = await selectQ('00700.HK', end);
  check('00700 FY: reconciled to full-year revenue', rel(d.rev, expRev) < 0.01, `got ${d.rev}, exp ${expRev.toFixed(3)}`);
  check('00700 FY: NOT double-counted (< 1.5× annual)', d.rev < 1.5 * expRev, `${d.rev}B vs exp ${expRev.toFixed(3)}B`);
  check('00700 FY: segment input matches revenue (≤2%)', rel(d.input, d.rev) < 0.02, `input=${d.input} rev=${d.rev}`);
  check('00700 FY: seg total ≈ revenue', rel(expSeg, expRev) < 0.02, `segCny=${expSeg.toFixed(3)} expRev=${expRev.toFixed(3)}`);
}

// ---------- 5. guard: quarter with NO segment row is left as-is ----------
{
  const d = await selectQ('00700.HK', '2026-06-30'); // no segment filed for this interim
  const raw = qOf('00700.HK', '2026-06-30').revenue / 1000;
  check('00700 interim without segments: no cumulative correction', d.qvEff === false, `qvEff=${d.qvEff}`);
  check('00700 interim without segments: revenue = single quarter', rel(d.rev, raw) < 1e-6, `got ${d.rev}, single=${raw}`);
}

// ---------- 6. duplicate sibling segment names ("其他" ×2) must not crash sankey ----------
{
  const end = '2026-06-30';
  const expRev = ytd('600887.SS', end, 'revenue') / 1000;
  const d = await selectQ('600887.SS', end);
  check('600887.SS (dup 其他) renders without error', d.ok === true, JSON.stringify(d).slice(0, 160));
  check('600887.SS (dup 其他): H1 revenue node correct', d.ok === true && rel(d.rev, expRev) < 0.005, `got ${d.rev}, exp ${expRev.toFixed(3)}`);
  check('600887.SS (dup 其他): title 上半年累计', /上半年累计/.test(d.title || ''), d.title);
}
{
  const end = '2025-12-31';
  const expRev = ytd('688981.SS', end, 'revenue') / 1000;
  const d = await selectQ('688981.SS', end);
  check('688981.SS (dup 其他) FY renders without error', d.ok === true, JSON.stringify(d).slice(0, 160));
  check('688981.SS (dup 其他): FY revenue node = 4-quarter sum', d.ok === true && rel(d.rev, expRev) < 0.005, `got ${d.rev}, exp ${expRev.toFixed(3)}`);
}

check('no console/exception errors during run', errors.length === 0, JSON.stringify(errors).slice(0, 300));

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
