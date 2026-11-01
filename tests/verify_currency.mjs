// verify_currency.mjs — the ¥ / US$ display toggle must rescale values by the period's
// fxToUsd (not merely relabel the axis). HUAWEI (CNY reporter, annual): revenue 2025-12-31
// is 880941 (¥M) → ¥880.941B native; USD value = revenue × 该期 fxToUsd / 1e3, 故 ratio ≡ 该期 fxToUsd（动态取数，勿写死汇率）。
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9362;
const D = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
const c = D.companies['HUAWEI'];
const last = c.quarters[c.quarters.length - 1];
const nativeB = last.revenue / 1e3;             // 880.941（动态）
const usdB = last.revenue * last.fxToUsd / 1e3; // 动态：revenue × 该期 fxToUsd

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-currency/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
const near = (a, b, tol = 0.05) => a != null && b != null && Math.abs(a - b) <= tol;

async function barVal(mode) {
  return await evl(`(()=>{ state.company='HUAWEI'; state.view='bar'; state.barItem='revenue';
    state.mode.pct=false; state.mode.qoq=false; state.curMode=${JSON.stringify(mode)}; render();
    const o=chart.getOption(); const d=o.series[0].data;
    const v=d[d.length-1]; return { v: (v && typeof v==='object') ? v.value : v, sym: dispSym(), n: d.length }; })()`);
}

const nat = await barVal('native');
const usd = await barVal('usd');
check('HUAWEI native ¥ value == 880.941B (revenue/1e3)', near(nat.v, nativeB), `got=${nat.v} exp=${nativeB}`);
check("HUAWEI native symbol is ¥", nat.sym === '¥', nat.sym);
check('HUAWEI USD $ value == revenue×fx/1e3（动态）', near(usd.v, usdB), `got=${usd.v} exp=${usdB}`);
check("HUAWEI USD symbol is $", usd.sym === '$', usd.sym);
check('USD/native ratio == 该期 fxToUsd（动态，容差 1e-6）', near(usd.v / nat.v, last.fxToUsd, 1e-6), `ratio=${(usd.v / nat.v).toFixed(8)} fx=${last.fxToUsd}`);

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
