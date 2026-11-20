// verify_fiscal_quarter.mjs — the chart title / bar axis must name the company's REAL fiscal
// quarter, not a calendar quarter. Background: quarterLabel() used to be
// `Q${floor((m-1)/3)+1} ${y}`, which is only right for December-FYE filers. Ten companies are
// covered here, including the six the old heuristic got wrong (MU/CSCO/ADBE/ORCL/AVGO/HPQ),
// plus AAPL/MSFT/NVDA/DELL.
//
// Checks:
//  1. data/companies.json declares an integer fiscalYearEndMonth (1–12) for every company
//  2. fiscalQuarterOf(endDate, fyeMonth) returns the spec triples, incl. 52/53-week drift
//  3. sankey title = "<shortName> FY<yyyy> Q<n>" and the meta line keeps the real end date
//  4. bar x-axis last label = "Q<n>'<yy>" on the fiscal year
//  5. December-FYE filers keep calendar semantics (parity check over every quarter end)
//  6. a missing/наvalid FYE degrades to the legacy behaviour instead of throwing
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9361;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

// ---- expectations, derived by hand from the filing calendar (NOT from app.js) ----
// [ticker, end date, FYE month, expected title period, expected bar axis label]
const CASES = [
  ['AAPL', '2026-09-26', 9, 'FY2026 Q4', "Q4'26"],   // FY2026 ended 2026-09-26
  ['MSFT', '2026-09-30', 6, 'FY2027 Q1', "Q1'27"],   // FY2027 Q1 ended 2026-09-30
  ['ORCL', '2026-08-31', 5, 'FY2027 Q1', "Q1'27"],   // FY2027 Q1 ended 2026-08-31
  ['CSCO', '2026-10-24', 7, 'FY2027 Q1', "Q1'27"],   // old heuristic called this "Q4 2026"
  ['ADBE', '2026-08-28', 11, 'FY2026 Q3', "Q3'26"],  // Adobe FY2026 Q3 = Jun–Aug
  ['AVGO', '2026-08-02', 11, 'FY2026 Q3', "Q3'26"],  // 11-01 FYE, quarter ended Sun 08-02
  ['HPQ', '2026-07-31', 10, 'FY2026 Q3', "Q3'26"],   // HP FY2026 Q3 ended 2026-07-31
  ['MU', '2026-09-03', 9, 'FY2026 Q4', "Q4'26"],     // 53-week year: "Aug" end fell on 09-03
  ['NVDA', '2026-07-26', 1, 'FY2027 Q2', "Q2'27"],   // NVDA FY2027 Q2 = May–Jul
  ['DELL', '2026-07-31', 1, 'FY2027 Q2', "Q2'27"],   // Dell FY2027 Q2 = May–Jul
];
// companies the OLD calendar label got wrong (title text differs on these ends)
const KNOWN_WRONG = ['MU', 'CSCO', 'ADBE', 'ORCL', 'AVGO', 'HPQ'];
// spec examples for the pure function
const SPEC = [
  ['2026-09-26', 9, { fy: 2026, q: 4, label: 'FY2026 Q4' }],
  ['2026-08-31', 5, { fy: 2027, q: 1, label: 'FY2027 Q1' }],
  ['2026-09-30', 6, { fy: 2027, q: 1, label: 'FY2027 Q1' }],
  ['2019-02-01', 1, { fy: 2019, q: 4, label: 'FY2019 Q4' }],   // Dell FY2019 ended 2019-02-01
  ['2026-09-03', 9, { fy: 2026, q: 4, label: 'FY2026 Q4' }],   // Micron 53-week drift
];

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-fq/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
const evlA = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); if (m.result?.data) fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64')); };

// ---------- 1. metadata: every company declares a FYE month ----------
const REG = JSON.parse(fs.readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'));
const badFye = REG.filter(c => !Number.isInteger(c.fiscalYearEndMonth) || c.fiscalYearEndMonth < 1 || c.fiscalYearEndMonth > 12);
check('every company declares fiscalYearEndMonth 1–12', badFye.length === 0, `${REG.length} companies, bad=${badFye.map(c => c.ticker).join(',')}`);
for (const [tk, , fye] of CASES) {
  const c = REG.find(x => x.ticker === tk);
  check(`${tk} metadata FYE = ${fye}`, !!c && c.fiscalYearEndMonth === fye, c && `json=${c.fiscalYearEndMonth}`);
}

// ---------- 2. fiscalQuarterOf() unit behaviour ----------
for (const [end, fye, want] of SPEC) {
  const got = await evl(`JSON.stringify(fiscalQuarterOf(${JSON.stringify(end)}, ${fye}))`);
  check(`fiscalQuarterOf(${end}, ${fye}) = ${want.label}`, got === JSON.stringify(want), got);
}
check('fiscalQuarterOf returns null on an unparseable date', await evl(`fiscalQuarterOf('oops', 9)===null`));
check('fiscalQuarterOf treats an invalid FYE as December (no throw)',
  await evl(`(f=>f&&f.fy===2026&&f.q===3)(fiscalQuarterOf('2026-09-26', 0))`));

// ---------- 3+4. live title and bar axis for each case ----------
async function titleState(tk, end) {
  return await evl(`(()=>{
    const qs = DATA.companies[${JSON.stringify(tk)}].quarters;
    const idx = qs.findIndex(q => q.end === ${JSON.stringify(end)});
    state.company = ${JSON.stringify(tk)}; state.view = 'bridge'; state.qIndex = idx; render();
    const title = document.getElementById('chartTitle').textContent;
    const meta = document.getElementById('metaLine').textContent;
    return { idx, end: idx >= 0 ? qs[idx].end : null, title, meta, short: shortName(${JSON.stringify(tk)}),
      qlabel: quarterLabel(${JSON.stringify(end)}, 'quarter') };
  })()`);
}
async function barAxis(tk, end) {
  return await evl(`(()=>{
    state.company = ${JSON.stringify(tk)}; state.view = 'bar'; state.barItem = 'revenue'; state.qIndex = null; render();
    const o = chart.getOption();
    const labels = o.xAxis[0].data;
    const e = DATA.companies[${JSON.stringify(tk)}];
    const qs = (e.frequency === 'hk-mixed' || e.frequency === 'mixed') ? e.quarters.filter(q => q.periodType !== 'annual') : e.quarters;
    const i = qs.findIndex(q => q.end === ${JSON.stringify(end)});
    return { last: labels[labels.length - 1], at: i >= 0 ? labels[i] : null, n: labels.length };
  })()`);
}
let changedVsCalendar = 0;
for (const [tk, end, fye, label, axis] of CASES) {
  const s = await titleState(tk, end);
  check(`${tk} quarter ${end} exists in data`, s && s.idx >= 0, `idx=${s && s.idx}`);
  check(`${tk} title = "… ${label}" (fiscal, FYE=${fye})`, s.title === `${s.short} ${label}`, JSON.stringify(s.title));
  check(`${tk} meta line keeps the real end date ${end}`, s.meta.includes(end), JSON.stringify(s.meta.slice(0, 80)));
  // the old naming was pure calendar: Q${ceil(m/3)} ${year}
  const calQ = Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1;
  if (label !== `FY${end.slice(0, 4)} Q${calQ}`) changedVsCalendar++;
  const b = await barAxis(tk, end);
  check(`${tk} bar axis label = ${axis}`, b.last === axis, `last=${b.last} at=${b.at}`);
  await shot(`fq_${tk}.png`);
}
// includes the six companies the old FYE heuristic mis-detected; a few of their ends happen to
// coincide with the calendar quarter (ADBE Aug = calendar Q3), so require a majority to move.
check('at least half the sampled ends were mislabelled by the old calendar naming',
  changedVsCalendar >= 5, `changed=${changedVsCalendar}/${CASES.length} (known-wrong: ${KNOWN_WRONG.join('/')})`);

// ---------- 5. December-FYE filers keep calendar semantics ----------
const decMismatch = await evl(`(()=>{
  const bad = [];
  for (const c of REGISTRY) {
    if (c.fiscalYearEndMonth !== 12) continue;
    const e = DATA.companies[c.ticker]; if (!e) continue;
    for (const q of (e.quarters || [])) {
      if (q.periodType === 'annual') continue;
      // skip 52/53-week ends in the first week of a month: those intentionally shift back a month
      if (Number(q.end.slice(8, 10)) <= 7) continue;
      const f = fiscalQuarterOf(q.end, 12);
      const y = Number(q.end.slice(0, 4)), m = Number(q.end.slice(5, 7));
      if (f.fy !== y || f.q !== Math.floor((m - 1) / 3) + 1) bad.push(c.ticker + ':' + q.end);
    }
  }
  return bad;
})()`);
check('December-FYE filers: fiscal quarter == calendar quarter on every non-drift end',
  Array.isArray(decMismatch) && decMismatch.length === 0, (decMismatch || []).slice(0, 5).join(','));
const amznAxis = await barAxis('AMZN', '2026-09-30');
check('AMZN (FYE 12) bar axis unchanged: Q3\'26', amznAxis.last === "Q3'26", `last=${amznAxis.last}`);

// ---------- 6. degradation: missing / broken FYE must not break the chart ----------
const degrade = await evlA(`(async()=>{
  const out = {};
  out.noFye = fiscalQuarterOf('2026-09-26', undefined);          // -> December default
  out.badMonth = fiscalQuarterOf('2026-09-26', 13);
  out.badDate = fiscalQuarterOf('nope', 9);
  const c = REGISTRY.find(x => x.ticker === 'AAPL');
  const keep = c.fiscalYearEndMonth; delete c.fiscalYearEndMonth;
  try {
    out.fallbackFye = fiscalYearEndMonth('AAPL');                // legacy inference: annual row month
    out.fallbackLabel = quarterLabel('2026-09-26', 'quarter');
    state.company = 'AAPL'; state.view = 'bridge'; state.qIndex = DATA.companies.AAPL.quarters.length - 1; render();
    out.titleNoFye = document.getElementById('chartTitle').textContent;
  } finally { c.fiscalYearEndMonth = keep; }
  state.company = 'AAPL'; state.qIndex = null; state.view = 'bridge'; render();
  return out;
})()`);
check('missing FYE → fiscalQuarterOf falls back to December (Sep = Q3, no throw)',
  !!degrade.noFye && degrade.noFye.fy === 2026 && degrade.noFye.q === 3, JSON.stringify(degrade.noFye));
check('out-of-range FYE → December semantics, no throw',
  !!degrade.badMonth && degrade.badMonth.fy === 2026 && degrade.badMonth.q === 3, JSON.stringify(degrade.badMonth));
check('unparseable date → null, no throw', degrade.badDate === null, JSON.stringify(degrade.badDate));
// with the field gone, fiscalYearEndMonth() falls back to the legacy heuristic (AAPL's quarter
// ends tie across 12/3/6/9, and December wins the tie) — i.e. the old calendar semantics return
check('deleting the FYE field degrades to the legacy inference (1–12, no throw)',
  degrade.fallbackFye >= 1 && degrade.fallbackFye <= 12 && degrade.fallbackLabel === 'FY2026 Q3',
  `fye=${degrade.fallbackFye} label=${degrade.fallbackLabel}`);
check('title still renders with the FYE field removed',
  typeof degrade.titleNoFye === 'string' && /FY\d{4} Q[1-4]/.test(degrade.titleNoFye), JSON.stringify(degrade.titleNoFye));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
