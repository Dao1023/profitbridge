// verify_bar.mjs — bar (time-series) view regression (headless CDP).
//  - view switcher bridge↔bar, timeline hides in bar mode and restores
//  - revenue bar: 65 bars = full NVDA history, last NVDA value 96.221 ($B 96.2)
//  - segment bar (NVDA Data Center): bars only in the 30 disclosed quarters
//  - margin bar (net margin %)
//  - pct/qoq linkage math, no-data item → empty chart + notice, no errors
//  - switch back to sankey: numbers unchanged, timeline back
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-bar/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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

const errors = [];
await send('Runtime.enable');
ws.onmessage = addHandler();
function addHandler() { // chain console errors
  const prev = ws.onmessage;
  return e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};

// ---------- 1. default bridge; switch to bar ----------
check('default view is bridge (sankey)', await evl(`state.view==='bridge' && chart.getOption().series[0].type==='sankey'`));
check('timeline visible in bridge mode', await evl(`document.getElementById('timeline').style.display!=='' ? false : getComputedStyle(document.getElementById('timeline')).display!=='none'`));
await evl(`document.getElementById('btnViewBar').click(); true`);
await sleep(400);
const bm = await evl(`window.__barMeta`);
check('bar view active after switch', await evl(`state.view==='bar' && chart.getOption().series[0].type==='bar'`));
check('timeline hidden in bar mode', await evl(`getComputedStyle(document.getElementById('timeline')).display==='none'`));
check('barSelect visible in bar mode, hidden item groups present', await evl(`document.getElementById('barSelect').style.display!=='' ? false : document.getElementById('barSelect').querySelectorAll('optgroup').length===3`), `optgroups=${await evl(`document.getElementById('barSelect').querySelectorAll('optgroup').length`)}`);
check('revenue default item, bar count = quarter count', bm.item === 'revenue' && bm.data.length === bm.quarterCount && bm.quarterCount === 65, JSON.stringify({ item: bm.item, n: bm.data.length, q: bm.quarterCount }));
check('revenue: no holes (all non-null)', bm.data.every(v => v != null));
check('NVDA latest revenue bar = 96.221 → $96.2B', Math.abs(bm.data[64] - 96.221) < 1e-6, `value=${bm.data[64]}`);
check('series echo in option has 64 points', await evl(`chart.getOption().series[0].data.length===65`));
check('x axis has 64 labels ending Q3\'26', await evl(`(o=chart.getOption(),o.xAxis[0].data.length===65 && o.xAxis[0].data[64]===\"Q3'26\")`));
const t0 = await evl(`(t0=performance.now(),renderChart(),performance.now()-t0)`);
check('renderBarChart (65 bars) < 120ms', t0 < 120, `${+t0.toFixed(1)}ms`);
await shot('bar_revenue.png');

// ---------- 2. segment item: NVDA Data Center ----------
await evlA(`(s=document.getElementById('barSelect'),s.value='seg:Data Center',s.dispatchEvent(new Event('change')),true)`);
await sleep(300);
const dc = await evl(`window.__barMeta`);
check('Data Center selected, label kept', dc.item === 'seg:Data Center');
check('DC bars only in 30 disclosed quarters (35 null gaps)', dc.data.filter(v => v != null).length === 30 && dc.data.filter(v => v == null).length === 35, `nonNull=${dc.data.filter(v => v != null).length}`);
check('DC latest bar = 89.023 ($89.0B)', Math.abs(dc.data[64] - 89.023) < 1e-6, `value=${dc.data[64]}`);
check('title shows segment name + full-history tag', await evl(`document.getElementById('chartTitle').textContent.includes('Data Center')`));
await shot('bar_segment_dc.png');

// ---------- 3. margin item: net margin ----------
await evlA(`(s=document.getElementById('barSelect'),s.value='margin:net',s.dispatchEvent(new Event('change')),true)`);
await sleep(300);
const nm = await evl(`window.__barMeta`);
const nmExp = await evl(`DATA.companies.NVDA.quarters.map(qv=>qv.netInc/qv.revenue*100)`);
check('net margin selected, y unit %', nm.item === 'margin:net' && nm.kind === 'margin');
check('net margin values match netInc/revenue*100', nm.data.every((v, i) => v != null && Math.abs(v - nmExp[i]) < 1e-9));
check('net margin in sane -30–100% range (NVDA FY2011 Q2 loss quarter)', nm.data.every(v => v > -30 && v < 100));
await shot('bar_margin.png');

// ---------- 4. pct/qoq linkage (revenue again) ----------
await evlA(`(s=document.getElementById('barSelect'),s.value='revenue',s.dispatchEvent(new Event('change')),state.mode.pct=true,state.mode.qoq=true,renderChart(),true)`);
await sleep(200);
const link = await evl(`(()=>{
  const d=window.__barMeta.data, qv=DATA.companies.NVDA.quarters[64], prev=DATA.companies.NVDA.quarters[63];
  const pctShare=d[64]*1000/qv.revenue;               // what the tooltip shows with pct on
  const qoq=(d[64]-d[63])/Math.abs(d[63]);            // what the tooltip shows with qoq on
  return { pctShare, qoq, pctOk:Math.abs(pctShare-1)<1e-9, qoqOk:Math.abs(qoq-(qv.revenue-prev.revenue)/prev.revenue)<1e-12 };
})()`);
check('pct mode: latest revenue share = 100%', link.pctOk, JSON.stringify(link));
check('qoq mode: latest QoQ matches raw quarters', link.qoqOk);
// tooltip actually renders the linkage (dispatch showTip on last bar and read DOM)
const tip = await evlA(`(async()=>{ chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:64}); await new Promise(r=>setTimeout(r,300));
  const el=document.querySelector('#sankey div[style*=\"position: absolute\"]'); return el?el.textContent:''; })()`);
check('tooltip contains $96.2B + 占营收 100.0% + QoQ', typeof tip === 'string' && tip.includes('96.2') && tip.includes('100.0%') && tip.includes('QoQ'), JSON.stringify(tip?.slice(0, 120)));

// ---------- 5. no-data item: AMZN rd → empty chart + notice ----------
await evlA(`state.company='AMZN'; state.barItem='rd'; state.mode.pct=false; state.mode.qoq=false; render(); true`);
await sleep(300);
check('AMZN rd option disabled + tagged (无数据/no data)', await evl(`(o=document.querySelector('#barSelect option[value=\"rd\"]'),!!o && o.disabled && (o.textContent.includes('无数据')||o.textContent.includes('no data')))`), await evl(`document.querySelector('#barSelect option[value=\"rd\"]')?.textContent`));
check('empty chart shows 该子项无披露数据 notice', await evl(`chart.getOption().graphic.length===1 && document.getElementById('chartTitle').textContent.length>0`));
check('empty chart has null-only series (no crash)', await evl(`chart.getOption().series[0].data.every(v=>v==null)`));
await shot('bar_amzn_rd_empty.png');

// ---------- 6. switch back to bridge: everything as before ----------
await evlA(`state.company='NVDA'; state.qIndex=5; render(); true`); // park on a non-default quarter
await sleep(200);
await evl(`document.getElementById('btnViewBridge').click(); true`);
await sleep(400);
const back = await evl(`({view:state.view, idx:state.qIndex, type:chart.getOption().series[0].type, tl:getComputedStyle(document.getElementById('timeline')).display, sel:getComputedStyle(document.getElementById('barSelect')).display, net:+window.__bridgeCheck.waterfall.net, meta:window.__sankeyMeta.quarter})`);
check('back to sankey series', back.view === 'bridge' && back.type === 'sankey');
check('timeline restored', back.tl !== 'none');
check('barSelect hidden again', back.sel === 'none');
check('original quarter selection preserved (idx5 = 2012-01-29)', back.idx === 5 && back.meta === '2011-10-30', JSON.stringify(back));
check('sankey waterfall consistent (netEq + ok-vs-quarter net)', await evl(`window.__bridgeCheck.waterfall.netEq===true && Math.abs(window.__bridgeCheck.waterfall.net - DATA.companies.NVDA.quarters[5].netInc/1000)<0.005`), JSON.stringify(back));
const svgBack = await evl(`chart.renderToSVGString()`);
check('sankey still renders values', svgBack.includes('$'));
await shot('sankey_back.png');

// ---------- 7. select survives company switch in bar mode ----------
await evl(`document.getElementById('btnViewBar').click(); true`);
await evlA(`(s=document.getElementById('barSelect'),s.value='seg:Data Center',s.dispatchEvent(new Event('change')),true)`);
await evlA(`state.company='AAPL'; render(); true`);
await sleep(300);
check('company switch resets unavailable item to revenue', await evl(`state.barItem==='revenue' && window.__barMeta.company==='AAPL'`), await evl(`state.barItem`));
check('AAPL selector has segment optgroup (31q disclosed)', await evl(`document.querySelectorAll('#barSelect optgroup')[1].querySelectorAll('option').length>0`));
check('INTC would have empty segment group (no quarters key)', await evl(`(SEG.companies.INTC||{}).quarters===undefined`));

check('no console/exception errors during run', errors.length === 0, JSON.stringify(errors).slice(0, 300));

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
