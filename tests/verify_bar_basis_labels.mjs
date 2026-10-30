// verify_bar_basis_labels.mjs — bar x-axis period-basis labelling + cumulative-bar visuals.
//
// Regression for the "H1 revenue labelled Q2" defect: a bar point must be labelled by the
// number of MONTHS it actually covers (derived from the fiscal-year-end month), not by a bare
// month→quarter map. Cumulative H1/9M bars also get a hatched itemStyle.decal + a lighter
// same-hue fill, plus an on-chart note; single-quarter bars and single-quarter companies are
// untouched. Everything is asserted against the REAL echarts option (chart.getOption()) +
// live DOM, never against source text.
//
// Cases:
//   09633.HK  hk-mixed, only interims (all 06-30) → every label H1'yy; note visible
//   00700.HK  pure quarterly (q1..q4)            → labels Qn'yy; note hidden; no decal
//   00151.HK  FYE = 3: 09-30 interim = Apr–Sep (H1), 06-30 interim = 3m (Q2); annual stripped
//   00941.HK  quarterly q1..q4                    → labels Qn'yy (no collateral damage)
//   decal     at least one cumulative bar carries itemStyle.decal; single-quarter bars don't
//   tooltip   cumulative point states 口径 (累计) / basis, not a bare quarter
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9356;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

// ---- independent expectation model, derived from profit.json (NOT the app source) ----
const D = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
function fye(tk) {
  const e = D.companies[tk] || {};
  const a = (e.quarters || []).filter(o => o.periodType === 'annual');
  return a.length ? Number(a[a.length - 1].end.slice(5, 7)) : 12;
}
function isCumulative(tk, qv) {
  const e = D.companies[tk];
  if (e.frequency === 'annual') return true;
  if ((e.frequency === 'hk-mixed' || e.frequency === 'mixed') &&
      (qv.periodType === 'annual' || qv.periodType === 'interim')) return true;
  return false;
}
function barQuarters(tk) {
  const e = D.companies[tk];
  return (e.frequency === 'hk-mixed' || e.frequency === 'mixed')
    ? e.quarters.filter(q => q.periodType !== 'annual') : e.quarters;
}
function coveredMonths(tk, qv) {
  const endMonth = Number(qv.end.slice(5, 7));
  const startMonth = (fye(tk) % 12) + 1;            // fiscal-year start = M+1 (12→1)
  return ((endMonth - startMonth + 12) % 12) + 1;
}
function expectedLabel(tk, qv) {
  const mm = Number(qv.end.slice(5, 7)), yy = qv.end.slice(2, 4), yr = qv.end.slice(0, 4);
  const qn = Math.floor((mm - 1) / 3) + 1;
  if (qv.periodType === 'annual' || D.companies[tk].frequency === 'annual') return 'FY ' + yr;
  if (!isCumulative(tk, qv)) return `Q${qn}'${yy}`;
  const cm = coveredMonths(tk, qv);
  if (cm <= 3) return `Q${qn}'${yy}`;
  if (cm <= 6) return `H1'${yy}`;
  if (cm <= 9) return `9M'${yy}`;
  return 'FY ' + yr;
}
// a bar should be hatched iff it's an H1/9M cumulative point (4..9 months, non-annual)
function expectedDecal(tk, qv) {
  if (qv.periodType === 'annual' || D.companies[tk].frequency === 'annual') return false;
  const cm = coveredMonths(tk, qv);
  return isCumulative(tk, qv) && cm > 3 && cm <= 9;
}

// ---- headless chrome + CDP ----
const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-basis/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = list.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const errors = [];
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

// Render a company in bar view (revenue, no overlay lines) and read the live option + note DOM.
async function barState(tk) {
  return await evl(`(()=>{
    state.company=${JSON.stringify(tk)}; state.view='bar'; state.barItem='revenue';
    barLines.pct=false; barLines.qoq=false; render();
    const o=chart.getOption();
    const noteEl=document.getElementById('barBasisNote');
    const e=DATA.companies[${JSON.stringify(tk)}];
    const qs=(e.frequency==='hk-mixed'||e.frequency==='mixed')?e.quarters.filter(q=>q.periodType!=='annual'):e.quarters;
    return { labels:o.xAxis[0].data, seriesData:o.series[0].data, ends:qs.map(q=>q.end),
      noteVis: noteEl?getComputedStyle(noteEl).visibility:null,
      noteText: noteEl?noteEl.textContent:'',
      bases: window.__barMeta.bases, hasCumPoint: window.__barMeta.hasCumPoint };
  })()`);
}
const hasDecal = d => d && typeof d === 'object' && d.itemStyle && d.itemStyle.decal;

// ---------- 09633.HK: all H1 cumulative interims ----------
let s = await barState('09633.HK');
check('09633 bar quarters are all 06-30 interims (annual stripped)',
  s.ends.length > 0 && s.ends.every(e => e.slice(5) === '06-30'), s.ends.join(','));
check("09633 every xAxis label is H1'yy", s.labels.every(l => /^H1'\d\d$/.test(l)), s.labels.join(','));
check("09633 no label contains Q2'", !s.labels.some(l => l.includes("Q2'")), s.labels.join(','));
check('09633 labels match independently-derived coverage (H1)',
  s.labels.every((l, i) => l === expectedLabel('09633.HK', { end: s.ends[i], periodType: 'interim' })), s.labels.join(','));
check('09633 on-chart note is visible', s.noteVis === 'visible', `vis=${s.noteVis}`);
check('09633 note text names hatched bars + 累计',
  /斜纹/.test(s.noteText) && /累计/.test(s.noteText), JSON.stringify(s.noteText));
check('09633 cumulative bars carry itemStyle.decal',
  s.seriesData.filter(hasDecal).length === s.ends.length && s.ends.length > 0,
  `decal=${s.seriesData.filter(hasDecal).length}/${s.ends.length}`);
await shot('bar_basis_09633.png');

// ---------- 00700.HK: pure single quarters ----------
s = await barState('00700.HK');
check('00700 every xAxis label is Qn\'yy', s.labels.every(l => /^Q[1-4]'\d\d$/.test(l)), s.labels.slice(-6).join(','));
check('00700 labels contain no H1/9M/FY (all single quarters)',
  !s.labels.some(l => /H1|9M|FY/.test(l)), s.labels.slice(-6).join(','));
check('00700 on-chart note is hidden', s.noteVis === 'hidden', `vis=${s.noteVis}`);
check('00700 no bar carries a decal', s.seriesData.every(d => !hasDecal(d)), `decal=${s.seriesData.filter(hasDecal).length}`);
await shot('bar_basis_00700.png');

// ---------- 00151.HK: FYE = 3 (09-30 interim = Apr–Sep = H1; 06-30 interim = 3m = Q2) ----------
s = await barState('00151.HK');
check('00151 bar quarters exclude annual (no MM=03 point)',
  !s.ends.some(e => e.slice(5) === '03'), 'hasMar=' + s.ends.some(e => e.slice(5) === '03'));
const q151 = barQuarters('00151.HK');
check('00151 full label set matches coverage-derived expectation',
  s.labels.length === q151.length && s.labels.every((l, i) => l === expectedLabel('00151.HK', q151[i])),
  s.ends.map((e, i) => `${e}:${s.labels[i]}`).join(' '));
const sep151 = s.ends.map((e, i) => ({ e, i })).filter(x => x.e.slice(5) === '09-30' && q151[x.i].periodType === 'interim');
check('00151 every 09-30 interim is labelled H1 (6-month Apr–Sep, not 9M)',
  sep151.length > 0 && sep151.every(x => s.labels[x.i].startsWith('H1')), sep151.map(x => s.ends[x.i] + '=' + s.labels[x.i]).join(','));
const jun151 = s.ends.map((e, i) => ({ e, i })).filter(x => x.e.slice(5) === '06-30');
check('00151 06-30 interim (3-month Apr–Jun) stays Q2, not H1',
  jun151.length > 0 && jun151.every(x => s.labels[x.i].startsWith('Q2')), jun151.map(x => s.ends[x.i] + '=' + s.labels[x.i]).join(','));
check('00151 on-chart note is visible (has H1 cumulative bars)', s.noteVis === 'visible', `vis=${s.noteVis}`);
const sepDecal = sep151.filter(x => hasDecal(s.seriesData[x.i])).length;
check('00151 09-30 interim H1 bars are hatched; 06-30 Q2 bars are not',
  sepDecal === sep151.length && jun151.every(x => !hasDecal(s.seriesData[x.i])),
  `sepDecal=${sepDecal}/${sep151.length} junDecal=${jun151.filter(x => hasDecal(s.seriesData[x.i])).length}`);
await shot('bar_basis_00151.png');

// ---------- 00941.HK: quarterly q1..q4, untouched ----------
s = await barState('00941.HK');
check("00941 every xAxis label is Qn'yy", s.labels.every(l => /^Q[1-4]'\d\d$/.test(l)), s.labels.slice(-6).join(','));
check('00941 note hidden (no cumulative points)', s.noteVis === 'hidden', `vis=${s.noteVis}`);
check('00941 no decal on any bar', s.seriesData.every(d => !hasDecal(d)));

// ---------- decal payload detail: at least one cumulative bar with a real decal object ----------
s = await barState('09633.HK');
const d0 = s.seriesData.find(hasDecal);
check('decal object is an ECharts pattern (symbol/dashArray/rotation present)',
  !!d0 && !!d0.itemStyle.decal.symbol && !!d0.itemStyle.decal.dashArrayX && d0.itemStyle.decal.rotation != null,
  JSON.stringify(d0 && d0.itemStyle && d0.itemStyle.decal));
check('cumulative bar fill is a lighter same-hue (not the base series color)',
  !!d0 && typeof d0.itemStyle.color === 'string' && d0.itemStyle.color !== '#4b5563', d0 && d0.itemStyle.color);

// ---------- tooltip: cumulative point states its 口径 ----------
s = await barState('09633.HK');
const lastIdx = s.ends.length - 1;
const tip = await evlA(`(async()=>{ chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:${lastIdx}});
  await new Promise(r=>setTimeout(r,300));
  const el=document.querySelector('#sankey div[style*="position: absolute"]'); return el?el.textContent:''; })()`);
check('09633 tooltip on cumulative point contains 累计 / cumulative',
  typeof tip === 'string' && /累计|cumulative/.test(tip), JSON.stringify(tip?.slice(0, 160)));
check('09633 tooltip header is an H1 basis, not a bare "Q2"',
  typeof tip === 'string' && /H1/.test(tip) && !/Q2/.test(tip), JSON.stringify(tip?.slice(0, 160)));

// ---------- leaving bar view hides the note (no lingering chip in bridge) ----------
await evl(`(()=>{ state.view='bridge'; render(); })()`);
const bridgeNote = await evl(`getComputedStyle(document.getElementById('barBasisNote')).visibility`);
check('bridge view hides the cumulative-bar note', bridgeNote === 'hidden', `vis=${bridgeNote}`);

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const pass = results.filter(r => r.ok).length;
console.log(`\nSUMMARY ${pass}/${results.length} checks passed`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
