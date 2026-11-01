// verify_seg_annual_quarters.mjs — annualQuarters-only filers must expose their segment sub-items.
// 00992.HK (Lenovo) keeps its annual segment rows in segments.json `annualQuarters` with an
// EMPTY `quarters` map; before the fix buildBarItems collected names only from `quarters`, so
// NONE of its four sub-items (IDG/ISG/SSG/抵销) appeared in the bar dropdown. Assert they are
// now selectable, plot 3 annual points labelled FY 2023/2024/2025, and that BIDU (annual) and
// MSFT (quarterly) segment behaviour is unchanged.
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9365;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-aq/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };

// ---- 00992.HK: four annual segment items, each with 3 FY points ----
const aq = await evl(`(()=>{
  const items = buildBarItems('00992.HK').filter(i=>i.group==='segments');
  return items.map(i=>({ id:i.id, label:i.label, ends:i.periods.map(p=>p.end),
    labels:i.periods.map(p=>segPeriodLabel('00992.HK',p)), hasData:i.hasData }));
})()`);
console.log('00992 segment items:', JSON.stringify(aq));
check('00992 buildBarItems yields 4 segment items', Array.isArray(aq) && aq.length === 4, `count=${aq && aq.length}`);
const names = (aq || []).map(x => x.label);
for (const need of ['IDG', 'ISG', 'SSG', '抵销']) {
  check(`00992 has a segment item containing "${need}"`, names.some(n => n.includes(need)), names.join(' | '));
}
check('00992 every segment item has 3 period points', (aq || []).every(x => x.ends.length === 3), JSON.stringify((aq || []).map(x => x.ends.length)));
check('00992 every segment item labels are FY 2023 / FY 2024 / FY 2025',
  (aq || []).every(x => x.labels.length === 3 && x.labels[0] === 'FY 2023' && x.labels[1] === 'FY 2024' && x.labels[2] === 'FY 2025'),
  JSON.stringify((aq || [])[0] && aq[0].labels));
check('00992 every segment item has data', (aq || []).every(x => x.hasData));

// render the first 00992 segment and confirm 3 bars actually draw with FY labels
const render0 = await evl(`(()=>{
  const it = buildBarItems('00992.HK').filter(i=>i.group==='segments')[0];
  state.company='00992.HK'; state.view='bar'; state.barItem=it.id; state.mode.pct=false; state.mode.qoq=false; render();
  const o=chart.getOption(); const d=o.series[0].data;
  return { id: it.id, xlabels: o.xAxis[0].data, bars: d.map(v=>(v&&typeof v==='object')?v.value:v), n: d.length };
})()`);
console.log('00992 render:', JSON.stringify(render0));
check('00992 segment bar renders exactly 3 bars', render0 && render0.n === 3 && render0.bars.filter(v => v != null).length === 3, `n=${render0 && render0.n} bars=${JSON.stringify(render0 && render0.bars)}`);
check('00992 x-axis shows FY 2023/2024/2025', render0 && JSON.stringify(render0.xlabels) === JSON.stringify(['FY 2023', 'FY 2024', 'FY 2025']), JSON.stringify(render0 && render0.xlabels));
// bar values must be the real annual magnitudes (~$49B IDG), not zero
check('00992 segment bars carry real FY magnitudes (>=10 $B)',
  render0 && render0.bars.every(v => v != null && Math.abs(v) >= 10), JSON.stringify(render0 && render0.bars));
console.log('00992 bar values:', JSON.stringify(render0 && render0.bars));
await new Promise(r => setTimeout(r, 900)); // let the bar grow animation settle before the evidence shot
await shot('00992_seg_annual.png');

// ---- BIDU: annual segment behaviour unchanged (all FY labels) ----
const bidu = await evl(`(()=>{ const items=buildBarItems('BIDU').filter(i=>i.group==='segments');
  return items.map(i=>({ label:i.label, labels:i.periods.map(p=>segPeriodLabel('BIDU',p)), n:i.periods.length })); })()`);
check('BIDU still exposes segment items', Array.isArray(bidu) && bidu.length > 0, `count=${bidu && bidu.length}`);
check('BIDU segment labels remain annual (FY yyyy)',
  (bidu || []).every(x => x.labels.length > 0 && x.labels.every(l => /^FY \d{4}$/.test(l))), JSON.stringify((bidu || [])[0] && bidu[0].labels));

// ---- MSFT: quarterly segment behaviour unchanged (all Qn'yy labels) ----
const msft = await evl(`(()=>{ const items=buildBarItems('MSFT').filter(i=>i.group==='segments');
  return items.map(i=>({ label:i.label, labels:i.periods.map(p=>segPeriodLabel('MSFT',p)), n:i.periods.length })); })()`);
check('MSFT still exposes segment items', Array.isArray(msft) && msft.length > 0, `count=${msft && msft.length}`);
check('MSFT segment labels remain quarterly (Qn\'yy)',
  (msft || []).every(x => x.labels.length > 0 && x.labels.every(l => /^Q[1-4]'\d\d$/.test(l))), JSON.stringify((msft || [])[0] && msft[0].labels));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
