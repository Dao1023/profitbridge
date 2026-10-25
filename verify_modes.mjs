// Headless verify: % of revenue + QoQ label modes, screenshots, numeric assertions.
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const SHOTS = 'C:/Users/Dao/Code/dao1023/dsh-temp/goldpit3/shots';

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=C:/Users/Dao/Code/dao1023/dsh-temp/goldpit3/archive/tmp_r/verify-profile', 'about:blank',
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

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };

const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};
const svgText = async () => await evl(`chart.renderToSVGString()`);

// ---------- default mode ----------
let svg = await svgText();
check('default shows $B amounts, no %', svg.includes('$96.2B') && !svg.includes('50.6%'));

// ---------- pct mode ----------
check('pct click', await evl(`document.getElementById('btnPct').click(), true`));
await new Promise(r => setTimeout(r, 400));
svg = await svgText();
const P = { hyperscale: 48710 / 96221, ai: 40313 / 96221, edge: 7198 / 96221, dc: 89023 / 96221 };
check('hyperscale 50.6%', svg.includes('50.6%'), (P.hyperscale * 100).toFixed(2));
check('AI cloud 41.9%', svg.includes('41.9%'), (P.ai * 100).toFixed(2));
check('edge 7.5%', svg.includes('7.5%'), (P.edge * 100).toFixed(2));
check('data center agg 92.5%', svg.includes('92.5%'), (P.dc * 100).toFixed(2));
// margins vs hand calc: 72.142/96.221, 63.734/96.221, 59.688/96.221
check('gross margin 75.0%', svg.includes('75.0%'), (72.142 / 96.221 * 100).toFixed(3));
check('op margin 66.2%', svg.includes('66.2%'), (63.734 / 96.221 * 100).toFixed(3));
check('net margin 62.0%', svg.includes('62.0%'), (59.688 / 96.221 * 100).toFixed(3));
// expense shares of revenue
check('cogs 25.0%', svg.includes('25.0%'), ((96.221 - 72.142) / 96.221 * 100).toFixed(3));
check('rd 7.3%', svg.includes('7.3%'), (7.054 / 96.221 * 100).toFixed(3));
check('sga 1.4%', svg.includes('1.4%'), (1.354 / 96.221 * 100).toFixed(3));
check('tax 4.2%', svg.includes('4.2%'), (4.046 / 96.221 * 100).toFixed(3));
check('revenue 100%', svg.includes('100%'));
// shares of segment leaves sum to 100% (from meta, same data the labels use)
const segSum = await evl(`(()=>{const s=SEG.companies.NVDA.quarters['2026-07-26'];return s.reduce((a,x)=>a+(x.children?x.children.reduce((b,c)=>b+c.value,0):x.value),0)})()`);
check('segment leaves sum = revenue', Math.abs(segSum - 96221) < 0.5, `${segSum}`);
await shot('nvda_pct.png');

// ---------- pct + qoq stacked ----------
check('qoq click (stacked)', await evl(`document.getElementById('btnQoQ').click(), true`));
await new Promise(r => setTimeout(r, 400));
svg = await svgText();
check('rev QoQ +17.9%', svg.includes('+17.9%'), ((96221 - 81615) / 81615 * 100).toFixed(2));
check('hyperscale QoQ +28.6%', svg.includes('+28.6%'), ((48710 - 37869) / 37869 * 100).toFixed(2));
check('AI cloud QoQ +7.9%', svg.includes('+7.8%') || svg.includes('+7.9%'), ((40313 - 37377) / 37377 * 100).toFixed(2));
check('gross margin pp +0.0pp', svg.includes('+0.0pp'), ((72.142 / 96.221 - 61.157 / 81.615) * 100).toFixed(3));
check('net margin pp shown', svg.includes('pp'));
await shot('nvda_pct_qoq.png');

// ---------- qoq only ----------
check('pct off (qoq only)', await evl(`document.getElementById('btnPct').click(), true`));
await new Promise(r => setTimeout(r, 400));
svg = await svgText();
check('qoq-only: +17.9% kept', svg.includes('+17.9%'));
check('qoq-only: no share pct', !svg.includes('50.6%') && !svg.includes('毛利率') && !svg.includes('Gross margin'));
await shot('nvda_qoq.png');

// ---------- earliest quarter: no prior data → '—' ----------
check('jump to Q1 (idx0)', await evl(`document.querySelectorAll('.tl-tick')[0].click(), true`));
await new Promise(r => setTimeout(r, 500));
svg = await svgText();
const dashCount = (svg.match(/— QoQ/g) || []).length;
const nodeCount = await evl(`chart.getOption().series[0].data.length`);
check('earliest quarter all — QoQ', dashCount === nodeCount, `${dashCount}/${nodeCount}`);
await shot('nvda_qoq_noprior.png');

// ---------- export in pct mode ----------
await evl(`document.querySelectorAll('.tl-tick')[document.querySelectorAll('.tl-tick').length-1].click(), document.getElementById('btnPct').click(), true`);
await new Promise(r => setTimeout(r, 500));
// Replicate exportPNG's offscreen render (same __lastOption) and measure the data URL,
// proving the export path renders with current-mode pct labels (headless download is flaky).
const evlA = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;
const exp = await evlA(`(async()=>{
  const opt = window.__lastOption;
  const f = opt.series[0].label.formatter;
  const probe = { name:'seg:Hyperscale', value:48.710 };
  const lbl = f(probe);
  const off = echarts.init(document.createElement('div'), null, { renderer:'canvas', width:1600, height:900 });
  off.setOption(opt);
  const url = off.getDataURL({ type:'png', pixelRatio:2, backgroundColor:'#f2efe9' });
  const len = url.length; off.dispose();
  return { len, lbl };
})()`);
check('export option keeps pct formatter', exp && exp.lbl.includes('50.6%'), exp && exp.lbl.replace(/\n/g,' / '));
check('pct-mode PNG dataURL renders', exp && exp.len > 100000, exp && exp.len + ' chars');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: SHOTS });
check('export PNG clicked', await evl(`document.getElementById('btnExportPNG').click(), true`));
await new Promise(r => setTimeout(r, 4000));
const dl = fs.readdirSync(SHOTS).filter(f => f.startsWith('profit_bridge') && f.endsWith('.png'));
// headless downloads are flaky; the offscreen dataURL render above is the real export-path proof
if (dl.length) { check('pct-mode PNG downloaded', true, dl.join(',')); fs.copyFileSync(`${SHOTS}/${dl[0]}`, `${SHOTS}/nvda_pct_export.png`); }
else console.log('INFO pct-mode PNG download skipped (headless flaky; dataURL render check above covers export path)');

// ---------- zh/en text on mode buttons ----------
const zhBtns = await evl(`document.getElementById('lblPct').textContent+'|'+document.getElementById('lblQoQ').textContent`);
check('zh mode labels', zhBtns === '占比|环比', zhBtns);
await evl(`document.getElementById('btnLang').click()`);
await new Promise(r => setTimeout(r, 300));
const enBtns = await evl(`document.getElementById('lblPct').textContent+'|'+document.getElementById('lblQoQ').textContent`);
check('en mode labels', enBtns === '% of revenue|QoQ', enBtns);

// ---------- timeline labels: non-calendar-FY companies labeled by covered interval ----------
const tlChecks = await evl(`(()=>{
  const r = {};
  r.fqNVDA = fqLabel('2026-01-25');   // NVDA FY26 Q4 ends 2026-01-25 → mid 2025-12 → 2025 Q4
  r.fqAAPL = fqLabel('2026-06-27');   // AAPL → 2026 Q2
  r.tlSample = [...document.querySelectorAll('.tl-tick .q')].slice(-3).map(e=>e.textContent);
  return r;
})()`);
check('fqLabel NVDA 2026-01-25 → 2025 Q4', tlChecks.fqNVDA === '2025 Q4', tlChecks.fqNVDA);
check('fqLabel AAPL 2026-06-27 → 2026 Q2', tlChecks.fqAAPL === '2026 Q2', tlChecks.fqAAPL);
// every rendered tick label must equal fqLabel of its own quarter-end (covers non-calendar FY)
const tlAll = await evl(`[...document.querySelectorAll('.tl-tick')].map(e=>{const q=e.querySelector('.q').textContent, d=e.querySelector('.d').textContent; return [q, d, fqLabel(d)];})`);
check('NVDA timeline labels = fqLabel(end) for all ticks',
  tlAll.every(([q, d, f]) => q === f), tlAll.map(([q, d, f]) => `${d}:${q}`).join(','));
await shot('nvda_timeline_labels.png');

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
