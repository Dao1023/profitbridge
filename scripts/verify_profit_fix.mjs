// verify_profit_fix.mjs — post-fix frontend regression (headless CDP).
// Focus: quarter-gap fix + full-history timeline.
//  - calendar continuity 80–100d for EVERY company (acceptance criterion)
//  - NVDA value stability; GOOGL/META repaired quarters render + QoQ correct
//  - timeline adaptive sampling with 64 quarters (no overflow/overlap, drag reaches all)
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const SHOTS = 'C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/archive/tmp_r/verify-profile-fix', 'about:blank',
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

// ---------- 1. calendar continuity for EVERY company (the acceptance criterion) ----------
const gaps = await evl(`(()=>{
  const out = [];
  const d = (a,b)=>Math.round((new Date(b)-new Date(a))/86400000);
  for (const [tk,c] of Object.entries(DATA.companies)) {
    const ends = c.quarters.map(q=>q.end);
    for (let i=1;i<ends.length;i++) {
      const dd = d(ends[i-1],ends[i]);
      if (dd<80||dd>100) out.push(tk+': '+ends[i-1]+' -> '+ends[i]+' ('+dd+'d)');
    }
  }
  return { gaps: out, n: Object.fromEntries(Object.entries(DATA.companies).map(([k,c])=>[k,c.quarters.length])) };
})()`);
check('calendar continuity 80–100d all companies (no holes)', gaps.gaps.length === 0, gaps.gaps.join('; ') || 'clean');
check('NVDA has Jan-end Q4s (2023-01-29 present)', await evl(`DATA.companies.NVDA.quarters.some(q=>q.end==='2023-01-29')`));
check('all companies ≥32 quarters (full-history mode)', Object.values(gaps.n).every(n => n >= 32), JSON.stringify(gaps.n));

// ---------- 2. NVDA value stability (previously published values unchanged) ----------
check('NVDA latest quarter values intact', await evl(`(()=>{
  const q = DATA.companies.NVDA.quarters.at(-1);
  return q.end==='2026-07-26' && q.revenue===96221 && q.gross===72142 && q.opInc===63734 && q.netInc===59688;
})()`));
let svg = await svgText();
check('default NVDA view $96.2B', svg.includes('$96.2B'));

// ---------- 3. timeline: adaptive sampling with 64 quarters ----------
const tl = await evl(`(()=>{
  const qs=DATA.companies.NVDA.quarters, n=qs.length;
  const ts=[...document.querySelectorAll('.tl-tick')];
  const rects=ts.map(e=>e.getBoundingClientRect());
  const overlap=rects.some((r,i)=>i&&r.left<rects[i-1].right-1);
  const dis=ts.map(e=>Number(e.dataset.i));
  return {n, shown:ts.length, dis, overlap,
          fits: rects.at(-1).right<=innerWidth && rects[0].left>=0,
          hasFirst: dis[0]===0, hasLast: dis.at(-1)===n-1, hasActive: dis.includes(n-1)};
})()`);
check('NVDA timeline samples long history (shown < n, ≤14)', tl.shown < tl.n && tl.shown <= 14, JSON.stringify({ n: tl.n, shown: tl.shown }));
check('timeline keeps first/last/active ticks', tl.hasFirst && tl.hasLast && tl.hasActive, JSON.stringify(tl));
check('timeline fits viewport, ticks not overlapping', tl.fits && !tl.overlap);
// drag thumb to an unsampled quarter (idx 5) → chart updates
const dragRes = await evlA(`(async()=>{
  const thumb=document.getElementById('tlThumb');
  const track=thumb.parentElement, r=track.getBoundingClientRect();
  const x=r.left + r.width*(5/(DATA.companies.NVDA.quarters.length-1));
  thumb.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));
  thumb.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x}));
  thumb.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));
  await new Promise(r=>setTimeout(r,400));
  return DATA.companies.NVDA.quarters[curQIndex()].end;
})()`);
check('thumb drag reaches unsampled quarter idx5', dragRes === '2012-01-29', dragRes);

// ---------- 4. GOOGL: repaired gap quarter renders, QoQ correct ----------
check('select GOOGL', await selTk('GOOGL'));
await sleep(500);
const gi = await evl(`DATA.companies.GOOGL.quarters.findIndex(q=>q.end==='2023-06-30')`);
check('GOOGL has 2023-06-30 (was in the 10-quarter hole)', gi > 0, 'idx=' + gi);
check('jump GOOGL 2023-06-30', await evl(`setQuarter(${gi}), true`));
await sleep(500);
const expQoQ = await evl(`(()=>{
  const qs = DATA.companies.GOOGL.quarters, i = ${gi};
  const a = qs[i].revenue, b = qs[i-1].revenue;
  return { pct: '+' + ((a-b)/b*100).toFixed(1) + '%', revB: '$' + (a/1000).toFixed(1) + 'B' };
})()`);
svg = await svgText();
check('GOOGL repaired quarter renders revenue', svg.includes(expQoQ.revB), expQoQ.revB);
check('qoq mode on', await evl(`!document.getElementById('btnQoQ').classList.contains('on') ? (document.getElementById('btnQoQ').click(), true) : true`));
await sleep(400);
svg = await svgText();
check('GOOGL repaired-quarter QoQ label correct', svg.includes(expQoQ.pct), JSON.stringify(expQoQ));
check('GOOGL repaired quarter no NaN', !/NaN/.test(svg));
await shot('fix_googl_2023q2.png');

// ---------- 5. META: 2023-12-31 quarter renders ----------
check('select META', await selTk('META'));
await sleep(500);
const mi = await evl(`DATA.companies.META.quarters.findIndex(q=>q.end==='2023-12-31')`);
check('META has 2023-12-31', mi > 0, 'idx=' + mi);
check('jump META 2023-12-31', await evl(`setQuarter(${mi}), true`));
await sleep(500);
const mExp = await evl(`'$' + (DATA.companies.META.quarters[${mi}].revenue/1000).toFixed(1) + 'B'`);
svg = await svgText();
check('META 2023-12-31 renders', svg.includes(mExp) && !/NaN/.test(svg), mExp);
await shot('fix_meta_2023q4.png');

// ---------- 6. AVGO (newly included) renders + render perf ----------
check('select AVGO', await selTk('AVGO'));
await sleep(500);
const avgoN = await evl(`DATA.companies.AVGO.quarters.length`);
check('AVGO in dashboard with full history (≥32 quarters)', avgoN >= 32, 'n=' + avgoN);
svg = await svgText();
check('AVGO renders without NaN', !/NaN/.test(svg));
await shot('fix_avgo_default.png');
// render performance with 64-quarter history: full render() call timing (NVDA)
const perf = await evlA(`(async()=>{
  [...document.querySelectorAll('#logoRail .logo')].find(e=>e.dataset.sym==='NVDA').click();
  await new Promise(r=>setTimeout(r,300));
  const t0=performance.now();
  for (let k=0;k<5;k++){ state.qIndex=k*7; render(); await new Promise(r=>setTimeout(r,50)); }
  return Math.round((performance.now()-t0)/5);
})()`);
check('render latency with full history < 300ms avg', perf < 300, perf + 'ms avg over 5 renders');

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
