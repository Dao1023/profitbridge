// verify_graph_coverage.mjs — the whole-site invariant: for EVERY company/period in
// data/profit.json, a disclosed metric must never disappear from the sankey.
//
// Motivation: the sankey used to truncate silently. Three separate leaks were found by hand
// (op<0 → chart stopped at gross; gross<=0 → zero-height block, negative ribbon dropped by
// cleanLinks; op missing but net>=0 → chart stopped at gross). This test replaces "spot the
// leak by eye" with an exhaustive assertion over all 92 companies / 3 727 periods:
//
//   * gross  disclosed  ⇒ a block carries it: 'gross' for gross>0, 'grossNeg' (= |gross|)
//                         plus 'cogs' (= revenue-gross) for gross<=0, value within 1e-6 rel.
//   * opInc  disclosed  ⇒ 'op' (op>=0) or 'loss' (op<0), value within 1% rel. of |opInc|.
//   * netInc disclosed  ⇒ 'net' (net>=0) or 'netLoss' (net<0), value within 1% rel. of |netInc|.
//   * every node/link value finite (no NaN/Infinity), every ribbon endpoint is a known block,
//     no duplicate block names, no negative profit block, and at least one block beyond
//     'revenue' (i.e. the period is not blank).
//
// The classify() tally is printed so a future data batch cannot shift periods into a branch
// without the reviewer seeing it. Exit code 0 only when the "metric disappeared" count is 0.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9363);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'profit.json'), 'utf8'));

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + path.join(ROOT, 'tests', '.chrome', 'verify-profile-coverage'), 'about:blank',
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

/* ---- 1. exhaustive in-page pass over every period (pure buildGraph call) ---- */
const scan = await evl(`(()=>{
  const R = { companies: 0, periods: 0, counts: {}, violations: [], blank: [], dupNames: [], badLinks: [] };
  const bump = k => R.counts[k] = (R.counts[k] || 0) + 1;
  const near = (a, b) => { const s = Math.max(Math.abs(a), Math.abs(b), 1e-9); return Math.abs(a - b) / s < 1e-6; };
  const rel = (a, b) => { const s = Math.max(Math.abs(a), Math.abs(b), 1e-9); return Math.abs(a - b) / s; };
  for (const tk of Object.keys(DATA.companies)) {
    R.companies++;
    state.company = tk;                       // dispFactor()/segFactor() default to state.company
    const qs = DATA.companies[tk].quarters;
    for (let i = 0; i < qs.length; i++) {
      const qvRaw = qs[i]; R.periods++;
      const tag = tk + ' ' + qvRaw.end;
      let g, eff, f, B, sym;
      try {
        const plan = sankeySegPlan(tk, qvRaw);
        eff = plan.cum ? { ...qvRaw, ...plan.cum.values, __cum: plan.cum } : qvRaw;
        g = buildGraph(eff, plan.segList);
        f = dispFactor(eff); B = MB; sym = dispSym();
      } catch (e) { R.violations.push({ tk, end: qvRaw.end, kind: 'buildGraph threw', detail: String(e) }); continue; }
      const val = new Map();
      for (const n of g.nodes) {
        if (val.has(n.name)) R.dupNames.push([tag, n.name]);
        val.set(n.name, n.value);
      }
      const has = n => val.has(n);
      const B_ = v => v * f / B;
      const revB = B_(eff.revenue);
      const profNodes = g.nodes.filter(n => !n.name.startsWith('seg:'));
      const finiteBad = [].concat(g.nodes.map(n => n.value), g.links.map(l => l.value))
        .filter(v => typeof v !== 'number' || !isFinite(v));
      // blocks this code owns; rd/sga are drawn straight from the data and can be negative in the
      // source (DELL 2020-01-31 rd=-1.213, 2021-01-29 rd/sga<0) — reported separately, not a leak.
      const OWNED = ['revenue', 'gross', 'cogs', 'grossNeg', 'op', 'loss', 'net', 'netLoss',
        'opex', 'taxOther', 'nonop', 'undisclosedCost'];
      const negProf = profNodes.filter(n => OWNED.includes(n.name) && typeof n.value === 'number' && n.value < 0)
        .map(n => n.name + '=' + n.value);
      const negData = profNodes.filter(n => !OWNED.includes(n.name) && typeof n.value === 'number' && n.value < 0)
        .map(n => n.name + '=' + n.value);
      if (negData.length) R.negativeDataBlocks = (R.negativeDataBlocks || 0) + 1;
      const badEnd = g.links.filter(l => !has(l.source) || !has(l.target)).map(l => l.source + '->' + l.target);
      const out = (kind, detail) => R.violations.push({ tk, end: qvRaw.end, kind, detail });
      if (finiteBad.length) out('non-finite value', finiteBad.length + ' nodes/links');
      if (negProf.length) out('negative profit block', negProf.join(','));
      if (badEnd.length) out('ribbon endpoint not a block', badEnd.slice(0, 3).join(','));
      if (!has('revenue') || !near(val.get('revenue'), revB)) out('revenue block', has('revenue') ? val.get('revenue') + ' vs ' + revB : 'missing');

      // gross: must be carried by some block, with the disclosed value
      if (eff.gross != null) {
        const gB = B_(eff.gross);
        if (eff.gross > 0) {
          if (!has('gross')) out('gross disappeared', 'gross=' + gB);
          else if (!near(val.get('gross'), gB)) out('gross value', val.get('gross') + ' vs ' + gB);
        } else {
          if (!has('grossNeg')) out('negative gross disappeared', 'gross=' + gB);
          else if (!near(val.get('grossNeg'), -gB)) out('grossNeg value', val.get('grossNeg') + ' vs ' + (-gB));
          if (!has('cogs')) out('cogs disappeared (negative gross)', 'cogs=' + (revB - gB));
          else if (!near(val.get('cogs'), revB - gB)) out('cogs value (negative gross)', val.get('cogs') + ' vs ' + (revB - gB));
        }
      }
      // opInc: op>=0 → 'op', op<0 → 'loss' (=|opInc|)
      if (eff.opInc != null) {
        const opB = B_(eff.opInc);
        if (eff.opInc >= 0) {
          if (!has('op')) out('op disappeared', 'opInc=' + opB);
          else if (Math.abs(opB) > 1e-9 && rel(val.get('op'), opB) > 0.01) out('op value', val.get('op') + ' vs ' + opB);
        } else {
          if (!has('loss')) out('operating loss disappeared', 'opInc=' + opB);
          else if (rel(val.get('loss'), -opB) > 0.01) out('loss value', val.get('loss') + ' vs ' + (-opB));
        }
      }
      // netInc: net>=0 → 'net', net<0 → 'netLoss' (=|netInc|)
      if (eff.netInc != null) {
        const netB = B_(eff.netInc);
        if (eff.netInc >= 0) {
          if (!has('net')) out('net disappeared', 'netInc=' + netB);
          else if (Math.abs(netB) > 1e-9 && rel(val.get('net'), netB) > 0.01) out('net value', val.get('net') + ' vs ' + netB);
        } else {
          if (!has('netLoss')) out('net loss disappeared', 'netInc=' + netB);
          else if (rel(val.get('netLoss'), -netB) > 0.01) out('netLoss value', val.get('netLoss') + ' vs ' + (-netB));
        }
      }
      // nothing beyond the revenue block ⇒ blank chart
      if (profNodes.length <= 1) R.blank.push([tag, eff.gross, eff.opInc, eff.netInc]);

      // branch tally (what the reader ends up seeing)
      const op = eff.opInc, net = eff.netInc, gross = eff.gross;
      bump(gross == null ? 'degraded_' + (op == null ? 'noOp' : op < 0 ? 'opLoss' : 'opPos') + '_' + (net == null ? 'netMissing' : net >= 0 ? 'netPos' : 'netLoss')
        : gross <= 0 ? 'negGross_' + (op == null ? (net == null ? 'netMissing' : net < 0 ? 'netLoss' : 'netPos') : op < 0 ? 'opLoss' : 'opPos')
        : op == null ? (net == null ? 'grossOnly' : net < 0 ? 'opMissing_netLoss' : 'opMissing_netPos')
        : op < 0 ? 'opLoss' : op > gross ? 'opAboveGross' : 'opPos');
    }
  }
  R.violations = R.violations.slice(0, 40);
  R.blank = R.blank.slice(0, 10);
  R.dupNames = R.dupNames.slice(0, 10);
  return R;
})()`);

const periodsExpected = Object.keys(D.companies).reduce((a, tk) => a + D.companies[tk].quarters.length, 0);
const companiesExpected = Object.keys(D.companies).length;
console.log(`scanned companies=${scan.companies} periods=${scan.periods} (data: ${companiesExpected}/${periodsExpected})`);
console.log('branch tally:', JSON.stringify(scan.counts, null, 0));
check('every company visited', scan.companies === companiesExpected, `${scan.companies}/${companiesExpected}`);
check('every period visited', scan.periods === periodsExpected, `${scan.periods}/${periodsExpected}`);
const tallySum = Object.values(scan.counts).reduce((a, b) => a + b, 0);
check('branch tally covers every period', tallySum === scan.periods, `${tallySum}/${scan.periods}`);
check('no duplicate block names', scan.dupNames.length === 0, JSON.stringify(scan.dupNames));
check('no blank chart (nothing beyond revenue)', scan.blank.length === 0, JSON.stringify(scan.blank));
check('DISCLOSED METRICS NEVER DISAPPEAR (0 periods)', scan.violations.length === 0,
  scan.violations.slice(0, 12).map(v => `${v.tk} ${v.end}: ${v.kind} (${v.detail})`).join(' | '));

/* ---- 2. the same three leaks end-to-end through the real render path ---- */
async function renderProbe(tk, end, opts = {}) {
  const c = D.companies[tk];
  const idx = end ? c.quarters.findIndex(x => x.end === end) : c.quarters.length - 1;
  if (idx < 0) throw new Error(`missing period ${tk} ${end}`);
  errors.length = 0;
  await evl(`(()=>{ lang='zh'; state.company=${JSON.stringify(tk)}; state.qIndex=${idx};
    state.view='sankey'; state.mode.pct=${!!opts.pct}; state.mode.qoq=${!!opts.qoq}; render(); return 1; })()`);
  await sleep(900);
  return evl(`(()=>{
    const o = chart.getOption(), ser = o.series[0];
    const qv = window.__qvEff || q();
    return { fx: dispFactor(qv), B: MB,
      data: ser.data.map(d => ({ name: d.name, value: d.value, depth: d.depth, color: (d.itemStyle||{}).color || null,
        label: (() => { try {
          const f = (d.label && d.label.formatter) || (ser.label && ser.label.formatter);
          return f ? String(f({ name: d.name, value: d.value, data: d })) : null;
        } catch (e) { return 'ERR:' + e; } })() })),
      links: ser.links.map(l => ({ source: l.source, target: l.target, value: l.value })),
      bridge: window.__bridgeCheck };
  })()`);
}
const B = 1e9;
const near = (a, b, tol = 0.01) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) < tol;

// (a) op < 0 (previous leak, already fixed): still painted, still exact
{
  const r = await renderProbe('01024.HK', '2026-09-30');
  const m = new Map(r.data.map(d => [d.name, d.value]));
  const opB = D.companies['01024.HK'].quarters.find(q => q.end === '2026-09-30').opInc * r.fx / r.B;
  check('01024 op<0 renders 营业亏损 = |opInc|', m.has('loss') && near(m.get('loss'), -opB), m.get('loss'));
  check('01024 renders a full chain', new Set(r.data.map(d => d.name)).size >= 6 && r.links.length >= 5, `${r.data.length} nodes / ${r.links.length} links`);
  check('01024 no console error', errors.length === 0, errors.slice(0, 2).join(' '));
}
// (b) gross > 0, op missing, net >= 0: gross splits into net + undisclosed residual
{
  const r = await renderProbe('MSFT', '2008-06-30');
  const m = new Map(r.data.map(d => [d.name, d.value]));
  const qv = D.companies.MSFT.quarters.find(q => q.end === '2008-06-30');
  const gB = qv.gross * r.fx / r.B, nB = qv.netInc * r.fx / r.B;
  check('MSFT 2008-06-30 gross block exact', m.has('gross') && near(m.get('gross'), gB), m.get('gross'));
  check('MSFT 2008-06-30 net block exact', m.has('net') && near(m.get('net'), nB), m.get('net'));
  check('MSFT 2008-06-30 residual = gross - net', m.has('undisclosedCost') && near(m.get('undisclosedCost'), gB - nB), m.get('undisclosedCost'));
  check('MSFT 2008-06-30 no operating block invented', !m.has('op') && !m.has('loss'), [...m.keys()].join(','));
  const sum = r.links.filter(l => l.source === 'gross').reduce((a, l) => a + l.value, 0);
  check('MSFT 2008-06-30 gross outflows sum to gross', near(sum, gB, 0.005), `${sum} vs ${gB}`);
  check('MSFT 2008-06-30 no console error', errors.length === 0, errors.slice(0, 2).join(' '));
}
// (c) gross <= 0: real blocks, no zero-height ghost, negative gross labelled
{
  const r = await renderProbe('TSLA', '2012-09-30');
  const m = new Map(r.data.map(d => [d.name, d.value]));
  const qv = D.companies.TSLA.quarters.find(q => q.end === '2012-09-30');
  const revB = qv.revenue * r.fx / r.B, gB = qv.gross * r.fx / r.B, opB = qv.opInc * r.fx / r.B, nB = qv.netInc * r.fx / r.B;
  check('TSLA 2012-09-30 cogs = revenue - gross (taller than inflow)', m.has('cogs') && near(m.get('cogs'), revB - gB), m.get('cogs'));
  check('TSLA 2012-09-30 negative gross block = |gross|', m.has('grossNeg') && near(m.get('grossNeg'), -gB), m.get('grossNeg'));
  check('TSLA 2012-09-30 operating loss = |opInc|', m.has('loss') && near(m.get('loss'), -opB), m.get('loss'));
  check('TSLA 2012-09-30 net loss = |netInc|', m.has('netLoss') && near(m.get('netLoss'), -nB), m.get('netLoss'));
  check('TSLA 2012-09-30 grossNeg labelled negative', (() => {
    const d = r.data.find(x => x.name === 'grossNeg');
    // value |gross| = $0.0088B: must print a minus sign and two decimals, never "−$0.0B"
    return !!d && typeof d.label === 'string' && d.label.includes('−$0.01B') && !d.label.includes('−$0.0B');
  })(), (r.data.find(x => x.name === 'grossNeg') || {}).label);
  check('TSLA 2012-09-30 no console error', errors.length === 0, errors.slice(0, 2).join(' '));
}
// (d) a healthy op>=0 period still renders the plain waterfall
{
  const r = await renderProbe('AAPL', '2026-09-26');
  const names = new Set(r.data.map(d => d.name));
  check('AAPL (op>=0) has no loss blocks', !names.has('loss') && !names.has('netLoss') && !names.has('grossNeg'), [...names].join(','));
  check('AAPL (op>=0) chain intact', names.has('op') && names.has('net') && r.links.length >= 6, `${r.data.length} nodes / ${r.links.length} links`);
  check('AAPL (op>=0) no console error', errors.length === 0, errors.slice(0, 2).join(' '));
}

/* ---- summary ---- */
const failed = results.filter(r => !r.ok);
console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(' -', f.name)); }
chrome.kill();
process.exit(failed.length ? 1 : 0);
