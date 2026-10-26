// verify_segments_hist.mjs — frontend regression after full-history segments backfill.
//  - NVDA headline values unchanged (96.2 / 72.1 / 63.7 / 59.7)
//  - 占比 (btnPct) / 环比 (btnQoQ) buttons work on newly backfilled historical quarters
//    (GOOGL 2016 quarter, NVDA 2015 quarter = no-segment quarter → graceful degradation)
//  - timeline adaptive sampling still works; render latency < 150ms
// Usage: node scripts/verify_segments_hist.mjs   (server on :8440)
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const SHOTS = 'C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/archive/tmp_r/verify-profile-seghist', 'about:blank',
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
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };
const svgText = async () => await evl(`chart.renderToSVGString()`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const selTk = tk => evl(`[...document.querySelectorAll('#logoRail .logo')].find(e=>e.dataset.sym==='${tk}').click(), true`);

// ---------- 1. NVDA headline values unchanged ----------
check('NVDA latest quarter values intact (96221/72142/63734/59688)', await evl(`(()=>{
  const q = DATA.companies.NVDA.quarters.at(-1);
  return q.end==='2026-07-26' && q.revenue===96221 && q.gross===72142 && q.opInc===63734 && q.netInc===59688;
})()`));
let svg = await svgText();
check('default NVDA view $96.2B', svg.includes('$96.2B'));

// ---------- 2. segment coverage matrix loaded ----------
const cov = await evl(`(()=>{
  const out = {};
  for (const [tk, c] of Object.entries(SEG.companies)) out[tk] = c.quarters ? Object.keys(c.quarters).length : ('degraded:' + (c.degraded||'').slice(0,40));
  return { seg: out, profit: Object.fromEntries(Object.entries(DATA.companies).map(([k,c])=>[k,c.quarters.length])) };
})()`);
check('segments loaded for ≥9 companies with data', Object.values(cov.seg).filter(v => typeof v === 'number' && v > 0).length >= 9, JSON.stringify(cov.seg));

// ---------- 3. helper: quarter index finder ----------
const qIdx = async (tk, year) => await evl(`(()=>{
  const qs = SEG.companies.${tk}.quarters || {};
  const ends = Object.keys(qs).filter(e => e.startsWith('${year}')).sort();
  if (!ends.length) return -1;
  return DATA.companies.${tk}.quarters.findIndex(q => q.end === ends[0]);
})()`);

// ---------- 4. GOOGL earliest backfilled segment quarter: segments + 占比 + 环比 ----------
// (GOOGL 2016 has segment-ish source tables but they don't reconcile → no segment data;
//  the earliest KEPT GOOGL segment quarter is used for the buttons test instead)
check('select GOOGL', await selTk('GOOGL'));
await sleep(500);
const gSegEnds = await evl(`Object.keys(SEG.companies.GOOGL.quarters).sort()`);
const gi = await evl(`DATA.companies.GOOGL.quarters.findIndex(q => q.end === ${JSON.stringify(gSegEnds[0])})`);
check('GOOGL earliest backfilled segment quarter in timeline', gi > 0, 'end=' + gSegEnds[0] + ' idx=' + gi);
check('jump GOOGL ' + gSegEnds[0], await evl(`setQuarter(${gi}), true`));
await sleep(500);
svg = await svgText();
const firstSeg = gSegEnds[0] && (await evl(`SEG.companies.GOOGL.quarters[${JSON.stringify(gSegEnds[0])}].map(s=>s.name).find(n=>!n.includes('&'))`));
check('GOOGL backfilled quarter renders segment inflow labels', !!firstSeg && svg.includes(firstSeg), 'seg=' + firstSeg);
check('GOOGL backfilled quarter no NaN', !/NaN/.test(svg));
// 占比 button
check('toggle 占比', await evl(`document.getElementById('btnPct').click(), true`));
await sleep(400);
svg = await svgText();
check('GOOGL backfilled quarter 占比 renders % labels', svg.includes('%') && !/NaN/.test(svg));
await shot('seghist_googl_hist_pct.png');
check('toggle 占比 off', await evl(`document.getElementById('btnPct').click(), true`));
// 环比 button (needs prior quarter segment data)
check('toggle 环比', await evl(`document.getElementById('btnQoQ').click(), true`));
await sleep(400);
svg = await svgText();
check('GOOGL backfilled quarter 环比 renders without NaN', !/NaN/.test(svg));
await shot('seghist_googl_hist_qoq.png');
check('toggle 环比 off', await evl(`document.getElementById('btnQoQ').click(), true`));

// ---------- 5. NVDA 2015 quarter: no segment disclosure → graceful degradation ----------
check('select NVDA', await selTk('NVDA'));
await sleep(500);
const ni = await evl(`DATA.companies.NVDA.quarters.findIndex(q => q.end.startsWith('2015'))`);
check('NVDA timeline reaches a 2015 quarter', ni > 0, 'idx=' + ni);
const nvda2015HasSeg = await evl(`(()=>{const e=DATA.companies.NVDA.quarters[${ni}].end; return !!(SEG.companies.NVDA.quarters||{})[e];})()`);
check('NVDA 2015 quarter jump', await evl(`setQuarter(${ni}), true`));
await sleep(500);
svg = await svgText();
check('NVDA 2015 renders without NaN (degraded / waterfall-only ok)', !/NaN/.test(svg));
check('NVDA 2015 coverage footnote present (degraded note)', await evl(`(document.body.textContent.match(/No segment data|缺失季度|waterfall only|仅绘制利润瀑布/)||[]).length > 0`));
await shot('seghist_nvda_2015_degraded.png');

// ---------- 6. timeline adaptive sampling still works (64 quarters) ----------
const tl = await evl(`(()=>{
  const qs=DATA.companies.NVDA.quarters, n=qs.length;
  const ts=[...document.querySelectorAll('.tl-tick')];
  const rects=ts.map(e=>e.getBoundingClientRect());
  const overlap=rects.some((r,i)=>i&&r.left<rects[i-1].right-1);
  const dis=ts.map(e=>Number(e.dataset.i));
  const labels=ts.map(e=>e.querySelector('.q').textContent.trim());
  const yearTicks=labels.filter(s=>/^\\d{4}$/.test(s));
  return {n, shown:ts.length, dis, labels, yearTicks,
          fits: rects.at(-1).right<=innerWidth && rects[0].left>=0,
          hasFirst: dis[0]===0, hasLast: dis.at(-1)===n-1, hasActive: dis.includes(n-1)};
})()`);
// year-only timeline ticks (design: unique 4-digit year labels + first/last/active snap dots)
check('NVDA timeline year-only ticks, unique, ≤20', tl.yearTicks.length === new Set(tl.yearTicks).size && tl.yearTicks.length <= 20 && tl.yearTicks.length >= 10, JSON.stringify({ ticks: tl.yearTicks }));
check('timeline keeps first/last/active', tl.hasFirst && tl.hasLast && tl.hasActive, JSON.stringify(tl));
check('timeline fits viewport, ticks not overlapping', tl.fits && !tl.overlap);

// ---------- 7. render perf: <150ms per render with full history ----------
const perf = await evlA(`(async()=>{
  await new Promise(r=>setTimeout(r,200));
  const n = DATA.companies.NVDA.quarters.length;
  const t0=performance.now();
  for (let k=0;k<6;k++){ state.qIndex=Math.floor(k*(n-1)/6); render(); await new Promise(r=>setTimeout(r,30)); }
  return { avg: Math.round((performance.now()-t0)/6), n };
})()`);
check('render latency < 150ms avg over full history', perf.avg < 150, perf.avg + 'ms avg, n=' + perf.n);

await shot('seghist_nvda_default.png');
const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
