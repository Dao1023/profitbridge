// verify_loss_branch.mjs — sanKEY must not truncate at gross profit when operating income is
// NEGATIVE (pre-fix: `op >= 0 && op <= gross` was the only branch that painted op/opex/net, so a
// loss period showed revenue → gross/cogs and nothing else — 61 companies / 478 periods).
//
// What is pinned here:
//   * op < 0 (01024.HK, 00992.HK, 01810.HK): a red 营业亏损 block whose value is |opInc| and whose
//     LABEL is negative ('−¥0.6B'); opex block = gross − op (= gross + |op|, the real disclosed
//     operating expenses, i.e. deliberately taller than its inflow — the same "inflow < node value"
//     allowance DEGRADED_RESIDUAL already relies on);
//     net < 0 → red 净亏损 (= |netInc|) plus the tax/non-operating gap drawn as its own inflow;
//     net >= 0 → gold 非经营性收益 (= net − op) that flips the loss positive into green 净利润.
//   * op missing but net < 0 with gross present (00100.HK): 净亏损 still appears (this period used
//     to stop at gross too, because gross != null kept it out of the old degraded branch).
//   * op >= 0 (AAPL, MSFT): node/link sets are byte-for-byte the pre-fix sets — no loss nodes.
//   * no NaN / Infinity anywhere in the series, chart renders (series data + links readable) and the
//     page logs no console error.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9362;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, 'tests', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'profit.json'), 'utf8'));

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + path.join(ROOT, 'tests', '.chrome', 'verify-profile-loss'), 'about:blank',
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : detail); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* render one period and hand back everything the assertions need (values stay in $B) */
async function probe(tk, end, opts = {}) {
  const c = D.companies[tk];
  const idx = end ? c.quarters.findIndex(x => x.end === end) : c.quarters.length - 1;
  if (idx < 0) throw new Error(`missing period ${tk} ${end}`);
  errors.length = 0;
  await evl(`(()=>{ lang='zh'; state.company=${JSON.stringify(tk)}; state.qIndex=${idx};
    state.view='sankey'; state.mode.pct=${!!opts.pct}; state.mode.qoq=${!!opts.qoq};
    state.curMode='native'; render(); return 1; })()`);
  await sleep(900); // let the sankey animation finish so values/geometry are final
  const r = await evl(`(()=>{
    const o = chart.getOption(), ser = o.series[0];
    const qv = window.__qvEff || q();
    const fx = dispFactor(qv), B = MB, sym = dispSym();
    const fmtOf = d => (d.label && d.label.formatter) || (ser.label && ser.label.formatter) || null;
    const data = ser.data.map(d => {
      const f = fmtOf(d);
      return { name: d.name, value: d.value, depth: d.depth,
               color: (d.itemStyle && d.itemStyle.color) || null,
               neg: d.neg === true,
               label: f ? f({ name: d.name, value: d.value, data: d, percent: 0 }) : null };
    });
    const links = ser.links.map(l => ({ s: l.source, t: l.target, v: l.value }));
    const bad = [...data.map(d => d.value), ...links.map(l => l.v)]
      .filter(v => typeof v !== 'number' || !isFinite(v));
    return { end: qv.end, fx, B, sym, data, links,
             raw: { revenue: qv.revenue, gross: qv.gross, opInc: qv.opInc, netInc: qv.netInc },
             nData: ser.data.length, nLinks: ser.links.length, bad,
             meta: window.__sankeyMeta };
  })()`);
  r.errors = [...errors];
  return r;
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const byName = (r, n) => r.data.find(d => d.name === n);
/* node value is in $B of the DISPLAY currency; raw figure is in $M native → compare in native $M */
const asRaw = (r, node) => node.value * r.B / r.fx;
const relErr = (got, want) => Math.abs(got - want) / Math.abs(want);
/* amount text contract (app.js amtText): >= 1B keeps one decimal, anything below 1B is printed
   in millions so a 58.9M figure can never be rounded into "0.1B". Labels follow that rule. */
const amtText = v => { const a = Math.abs(v); return a >= 1 ? `${a.toFixed(1)}B` : `${(a * 1000).toFixed(1)}M`; };

/* ---------- 1. op < 0 with gross (three real periods) ---------- */
const LOSS = [
  { tk: '01024.HK', end: '2026-09-30', netNeg: true, label: '快手 Q3 2026' },
  { tk: '00992.HK', end: '2026-09-30', netNeg: true, label: '联想 Q3 2026' },
  { tk: '01810.HK', end: '2018-06-30', netNeg: false, label: '小米 Q2 2018' },
];
for (const cs of LOSS) {
  const r = await probe(cs.tk, cs.end);
  const tag = `${cs.tk} ${cs.end}`;
  const op = r.raw.opInc, net = r.raw.netInc, gross = r.raw.gross;
  check(`${tag}: op is really negative (data)`, op != null && op < 0, `opInc=${op}`);
  check(`${tag}: gross profit disclosed (data)`, gross != null && gross > 0, `gross=${gross}`);

  const loss = byName(r, 'loss');
  check(`${tag}: 营业亏损 node exists`, !!loss, loss ? 'value=' + loss.value : 'missing');
  if (loss) {
    const e = relErr(asRaw(r, loss), Math.abs(op));
    check(`${tag}: 营业亏损 value == |opInc| (<1%)`, e < 0.01, `got ${asRaw(r, loss).toFixed(2)} want ${Math.abs(op).toFixed(2)} err=${(e * 100).toFixed(3)}%`);
    check(`${tag}: 营业亏损 label shows the NEGATIVE amount`, typeof loss.label === 'string' && loss.label.includes('−' + r.sym + amtText(loss.value)), JSON.stringify(loss.label));
    check(`${tag}: 营业亏损 uses RED`, loss.color === '#dc2626', String(loss.color));
  }

  const opex = byName(r, 'opex');
  const wantOpex = (gross - op) * r.fx / r.B;
  check(`${tag}: 营业费用 node carries the REAL opex (gross − op)`,
    !!opex && relErr(opex.value, wantOpex) < 0.01,
    opex ? `got ${opex.value.toFixed(3)} want ${wantOpex.toFixed(3)}` : 'missing');
  check(`${tag}: opex > gross (expenses exceed gross by |op|)`,
    !!opex && opex.value > byName(r, 'gross').value * 0.999, opex ? `${opex.value} vs gross ${byName(r, 'gross').value}` : 'missing');

  const lGO = r.links.find(l => l.s === 'gross' && l.t === 'opex');
  const lOL = r.links.find(l => l.s === 'opex' && l.t === 'loss');
  check(`${tag}: gross → 营业费用 inflow is the gross profit only`, !!lGO && relErr(lGO.v, byName(r, 'gross').value) < 0.01, lGO ? `${lGO.v}` : 'missing');
  check(`${tag}: 营业费用 → 营业亏损 carries exactly |op|`, !!lOL && !!loss && relErr(lOL.v, loss.value) < 0.01, lOL ? `${lOL.v}` : 'missing');

  if (cs.netNeg) {
    check(`${tag}: net is really negative (data)`, net != null && net < 0, `netInc=${net}`);
    const nl = byName(r, 'netLoss');
    check(`${tag}: 净亏损 node exists`, !!nl, nl ? 'value=' + nl.value : 'missing');
    if (nl) {
      const e = relErr(asRaw(r, nl), Math.abs(net));
      check(`${tag}: 净亏损 value == |netInc| (<1%)`, e < 0.01, `got ${asRaw(r, nl).toFixed(2)} want ${Math.abs(net).toFixed(2)} err=${(e * 100).toFixed(3)}%`);
      check(`${tag}: 净亏损 label shows the NEGATIVE amount`, typeof nl.label === 'string' && nl.label.includes('−' + r.sym + amtText(nl.value)), JSON.stringify(nl.label));
    }
    // the gap between the operating loss and the bottom line must be drawn, not swallowed
    const into = r.links.filter(l => l.t === 'netLoss').reduce((a, l) => a + l.v, 0);
    check(`${tag}: 净亏损 inflows add up to |netInc|`, !!nl && relErr(into, nl.value) < 0.01, `inflow=${into.toFixed(4)} node=${nl ? nl.value : 'n/a'}`);
    const tax = byName(r, 'taxOther');
    if (tax) {
      check(`${tag}: tax/non-op gap node == |netInc| − |opInc|`, relErr(asRaw(r, tax), Math.abs(net) - Math.abs(op)) < 0.01,
        `got ${asRaw(r, tax).toFixed(2)} want ${(Math.abs(net) - Math.abs(op)).toFixed(2)}`);
      check(`${tag}: gap node label is negative`, typeof tax.label === 'string' && tax.label.includes('−' + r.sym + amtText(tax.value)), JSON.stringify(tax.label));
    }
  } else {
    check(`${tag}: net is positive (data)`, net != null && net > 0, `netInc=${net}`);
    const np = byName(r, 'nonop'), nt = byName(r, 'net');
    const wantNonop = (net - op) * r.fx / r.B;
    check(`${tag}: 非经营性收益 node == net − op`, !!np && relErr(np.value, wantNonop) < 0.01, np ? `got ${np.value.toFixed(3)} want ${wantNonop.toFixed(3)}` : 'missing');
    check(`${tag}: 非经营性收益 uses GOLD`, !!np && np.color === '#d4a017', np ? String(np.color) : 'missing');
    check(`${tag}: 净利润 node == netInc`, !!nt && relErr(asRaw(r, nt), net) < 0.01, nt ? `got ${asRaw(r, nt).toFixed(2)} want ${net.toFixed(2)}` : 'missing');
    check(`${tag}: loss → 非经营性收益 → 净利润 chain is connected`,
      !!r.links.find(l => l.s === 'loss' && l.t === 'nonop') && !!r.links.find(l => l.s === 'nonop' && l.t === 'net'), JSON.stringify(r.links));
  }

  check(`${tag}: no NaN/Infinity in series`, r.bad.length === 0, JSON.stringify(r.bad.slice(0, 3)));
  check(`${tag}: chart rendered (series data + links readable)`, r.nData > 0 && r.nLinks > 0, `data=${r.nData} links=${r.nLinks}`);
  check(`${tag}: no console errors`, r.errors.length === 0, r.errors.slice(0, 2).join(' | '));
  check(`${tag}: every link endpoint exists as a node`,
    r.links.every(l => r.data.some(d => d.name === l.s) && r.data.some(d => d.name === l.t)), '');
}

/* ---------- 2. op missing, net < 0, gross present (00100.HK) ---------- */
{
  const r = await probe('00100.HK', '2025-12-31');
  const tag = '00100.HK 2025-12-31';
  check(`${tag}: opInc is null and netInc < 0 (data)`, r.raw.opInc == null && r.raw.netInc < 0, JSON.stringify(r.raw));
  check(`${tag}: still has a gross profit node`, !!byName(r, 'gross'), '');
  const nl = byName(r, 'netLoss');
  check(`${tag}: 净亏损 node appears (chart no longer stops at gross)`, !!nl, nl ? 'value=' + nl.value : 'missing');
  if (nl) {
    const e = relErr(asRaw(r, nl), Math.abs(r.raw.netInc));
    check(`${tag}: 净亏损 value == |netInc| (<1%)`, e < 0.01, `got ${asRaw(r, nl).toFixed(2)} want ${Math.abs(r.raw.netInc).toFixed(2)} err=${(e * 100).toFixed(3)}%`);
    check(`${tag}: 净亏损 label is negative`, typeof nl.label === 'string' && nl.label.includes('−' + r.sym), JSON.stringify(nl.label));
  }
  check(`${tag}: no loss node invented without opInc`, !byName(r, 'loss'), '');
  check(`${tag}: gross → 净亏损 inflow ≤ gross profit`, !!r.links.find(l => l.s === 'gross' && l.t === 'netLoss') && r.links.find(l => l.s === 'gross' && l.t === 'netLoss').v <= byName(r, 'gross').value + 1e-9, '');
  check(`${tag}: no NaN/Infinity in series`, r.bad.length === 0, JSON.stringify(r.bad.slice(0, 3)));
  check(`${tag}: no console errors`, r.errors.length === 0, r.errors.slice(0, 2).join(' | '));
}

/* ---------- 3. op >= 0 controls: pre-fix node/link sets must be untouched ---------- */
const HEALTHY = [
  { tk: 'AAPL', names: ['cogs', 'gross', 'net', 'op', 'rd', 'revenue', 'sga', 'taxOther'], nLinks: 7 },
  { tk: 'MSFT', names: ['cogs', 'gross', 'net', 'op', 'opex', 'revenue', 'taxOther'], nLinks: 8 },
];
for (const h of HEALTHY) {
  const r = await probe(h.tk, null);
  const tag = `${h.tk} latest`;
  check(`${tag}: op >= 0 (data)`, r.raw.opInc != null && r.raw.opInc >= 0, `opInc=${r.raw.opInc}`);
  const names = r.data.map(d => d.name).filter(n => !n.startsWith('seg:')).sort();
  check(`${tag}: node set is exactly the pre-fix set`, JSON.stringify(names) === JSON.stringify(h.names), JSON.stringify(names));
  check(`${tag}: link count unchanged (${h.nLinks})`, r.nLinks === h.nLinks, String(r.nLinks));
  check(`${tag}: no 营业亏损 node on a profitable period`, !byName(r, 'loss') && !r.data.some(d => d.name === 'loss'), '');
  check(`${tag}: no 净亏损 node on a profitable period`, !r.data.some(d => d.name === 'netLoss'), '');
  check(`${tag}: op node still painted green`, (byName(r, 'op') || {}).color === '#16a34a', String((byName(r, 'op') || {}).color));
  check(`${tag}: no console errors`, r.errors.length === 0, r.errors.slice(0, 2).join(' | '));
}

/* ---------- 4. the new nodes survive pct / qoq label modes ---------- */
{
  const rp = await probe('01024.HK', '2026-09-30', { pct: true });
  const loss = byName(rp, 'loss');
  check('01024 pct mode: 营业亏损 still present', !!loss, '');
  check('01024 pct mode: label keeps the minus sign on the amount', !!loss && typeof loss.label === 'string' && loss.label.includes('−' + rp.sym), loss ? JSON.stringify(loss.label) : '');
  check('01024 pct mode: no console errors', rp.errors.length === 0, rp.errors.slice(0, 2).join(' | '));
  check('01024 pct mode: no NaN/Infinity in series', rp.bad.length === 0, '');

  const rq = await probe('01024.HK', '2026-09-30', { qoq: true });
  check('01024 qoq mode: 营业亏损 survives the QoQ label path', !!byName(rq, 'loss'), '');
  check('01024 qoq mode: no console errors (loss aliased to opInc for QoQ)', rq.errors.length === 0, rq.errors.slice(0, 2).join(' | '));
  check('01024 qoq mode: no NaN/Infinity in series', rq.bad.length === 0, '');
}

await send('Page.captureScreenshot', { format: 'png' }).then(m => {
  if (m.result?.data) fs.writeFileSync(`${SHOTS}/verify_loss_branch.png`, Buffer.from(m.result.data, 'base64'));
});

const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
