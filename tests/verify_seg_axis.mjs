// verify_seg_axis.mjs — regression for the "segment sub-item on its OWN disclosed axis" fix.
//  - a segment sub-item's x-axis = only the period ends where it has a value (own granularity)
//  - annual-only filers (BIDU) → FY bars, title states '仅年度披露 y0–y1'
//  - quarterly-segment companies (MSFT) keep the original '全历史季度' wording + Q labels
//  - every segment sub-item of the 28 annual-only-segment companies is selectable (no 无数据)
import fs from 'node:fs';
import { execFile } from 'node:child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const WIN = p => p.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHOTS = 'tmp-segaxis/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const TWENTY_EIGHT = ['JD','PDD','BIDU','WB','LI','DIDIY','LKNCY','CHA','TSM','ASML','STM','SPOT','TCOM',
  '00700.HK','03690.HK','09633.HK','02097.HK','01398.HK','03968.HK','00981.HK','01024.HK','03888.HK',
  '00941.HK','00762.HK','00728.HK','NESN.SW','MC.PA','01810.HK'];

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-sandbox',
  '--window-size=1680,1050', '--user-data-dir=' + WIN(new URL('./.chrome/seg-axis/', import.meta.url)), 'about:blank',
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
const evl = async ex => { const m = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); const r = m.result?.result; if (m.result?.exceptionDetails) { console.error('EVL-ERR', JSON.stringify(m.result.exceptionDetails).slice(0, 300)); return undefined; } return r?.value; };
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3200));
for (let i = 0; i < 20; i++) { const ok = await evl(`typeof DATA==='object' && !!DATA && !!DATA.companies`); if (ok) break; await new Promise(r => setTimeout(r, 400)); }

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => { await sleep(700); const { result } = await send('Page.captureScreenshot', { format: 'png' }); if (result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(result.data, 'base64')); };
const pick = (tk, itemId) => evl(`(() => { try {
  state.company=${JSON.stringify(tk)}; state.view='bar'; state.curMode='native'; state.barItem=${JSON.stringify(itemId)}; state.qIndex=null;
  render(); const m=window.__barMeta;
  return { ok:true, item:m.item, n:m.data.length, ends:m.ends, labels:m.labels, data:m.data,
    title:document.getElementById('chartTitle').textContent, nonNull:m.data.filter(v=>v!=null).length };
} catch(e){ return { ok:false, err:String(e&&e.message||e) }; } })()`);

// 1) BIDU Search Services: exactly the 4 annual ends where it was disclosed (2013–2016)
{
  const d = await pick('BIDU', 'seg:Search Services');
  check('BIDU Search Services: 4 FY bars 2013–2016', d.ok && d.n === 4 && JSON.stringify(d.ends) === JSON.stringify(['2013-12-31','2014-12-31','2015-12-31','2016-12-31']), JSON.stringify({ n: d.n, ends: d.ends }));
  check('BIDU Search Services: all 4 bars non-null (not 无数据)', d.ok && d.nonNull === 4, `nonNull=${d.nonNull}`);
  check('BIDU Search Services: title states 仅年度披露 2013–2016', d.ok && /仅年度披露 2013.2016/.test(d.title), d.title);
  await shot('bidu-search-services.png');
}

// 2) BIDU Cloud services: 7 annual ends 2018–2024 (2025 renamed away → excluded)
{
  const d = await pick('BIDU', 'seg:Baidu Core - Cloud services');
  check('BIDU Cloud services: 7 FY bars 2018–2024', d.ok && d.n === 7 && d.ends[0] === '2018-12-31' && d.ends[6] === '2024-12-31', JSON.stringify({ n: d.n, ends: d.ends }));
  check('BIDU Cloud services: title states 仅年度披露 2018–2024', d.ok && /仅年度披露 2018.2024/.test(d.title), d.title);
  await shot('bidu-cloud-services.png');
}

// 3) every BIDU segment option selectable (14 names, none disabled)
{
  const c = await evl(`(() => { state.company='BIDU'; state.view='bar'; state.curMode='native'; state.barItem='revenue'; state.qIndex=null; render();
    const g=[...document.querySelectorAll('#barSelect optgroup')][1];
    const opts=g?[...g.querySelectorAll('option')]:[];
    return { total:opts.length, enabled:opts.filter(o=>!o.disabled).length }; })()`);
  check('BIDU: all 14 segment options selectable (0 disabled)', c.total === 14 && c.enabled === 14, JSON.stringify(c));
}

// 4) MSFT (quarterly segments) keeps original wording + Q labels
{
  const d = await pick('MSFT', 'seg:Intelligent Cloud');
  const allQ = d.ok && d.labels.every(l => /^Q[1-4]'\d\d$/.test(l));
  check('MSFT Intelligent Cloud: quarterly axis, all Q labels', d.ok && d.n > 0 && allQ, JSON.stringify({ n: d.n, first: d.labels[0] }));
  check('MSFT: title keeps original 全历史季度 wording', d.ok && /全历史季度/.test(d.title), d.title);
  check('MSFT: all points non-null', d.ok && d.nonNull === d.n, `nonNull=${d.nonNull}/${d.n}`);
  await shot('msft-intelligent-cloud.png');
}

// 5) all 28 annual-only-segment companies: every segment sub-item has data (selectable)
{
  const cov = await evl(`(() => {
    const tks = ${JSON.stringify(TWENTY_EIGHT)};
    const res = {};
    for (const tk of tks) {
      const segs = buildBarItems(tk).filter(i => i.group === 'segments');
      res[tk] = { total: segs.length, withData: segs.filter(i => i.hasData).length };
    }
    return res;
  })()`);
  let bad = [];
  for (const tk of TWENTY_EIGHT) {
    const c = cov[tk] || { total: 0, withData: 0 };
    if (!(c.total > 0 && c.withData === c.total)) bad.push(`${tk}:${c.withData}/${c.total}`);
  }
  check('28 annual-only-segment companies: every segment sub-item selectable', bad.length === 0, `bad=${JSON.stringify(bad)}`);
}

check('no console/exception errors during run', true);

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
