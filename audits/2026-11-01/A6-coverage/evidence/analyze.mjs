#!/usr/bin/env node
// Read-only coverage analysis for profitbridge. Writes only into tmp-audit/a6/.
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const ROOT = 'C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge';
const OUT = 'C:/Users/Dao/Code/dao1023/dsh-temp/tmp-audit/a6';
const load = (f) => JSON.parse(readFileSync(`${ROOT}/data/${f}`, 'utf8'));
const profit = load('profit.json');
const companies = load('companies.json');
const segments = load('segments.json');

const TODAY = new Date('2026-11-01T00:00:00Z');
const D = (s) => new Date(s + 'T00:00:00Z');
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const fmt = (d) => d.toISOString().slice(0, 10);

function marketOf(ticker) {
  if (/\.HK$/.test(ticker)) return 'HK';
  if (/\.KS$|\.KQ$/.test(ticker)) return 'KR';
  if (/\.SS$|\.SZ$|\.SH$/.test(ticker)) return 'CN';
  if (/\.SW$/.test(ticker)) return 'CH';
  if (/\.PA$/.test(ticker)) return 'FR';
  if (/\.TW$/.test(ticker)) return 'TW';
  if (/\.T$/.test(ticker)) return 'JP';
  if (/\.L$/.test(ticker)) return 'UK';
  // US-listed bucket: SEC filers + foreign ADRs + private previews
  return 'US';
}

// ---- per-company profit stats ----
const FIELDS = ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga'];
const rows = [];
const fieldTotals = {}; FIELDS.forEach((f) => (fieldTotals[f] = { null: 0, total: 0 }));

for (const [ticker, pc] of Object.entries(profit.companies)) {
  const qs = pc.quarters || [];
  const ends = qs.map((q) => q.end);
  const last = ends.at(-1) || null;
  const first = ends[0] || null;
  const freq = pc.frequency || 'q';
  const periodTypes = {};
  qs.forEach((q) => { const t = q.periodType || 'q'; periodTypes[t] = (periodTypes[t] || 0) + 1; });
  const nullCount = {}; const nullDetail = {};
  for (const f of FIELDS) {
    let n = 0;
    qs.forEach((q) => { if (q[f] == null) n++; });
    nullCount[f] = n;
    fieldTotals[f].null += n; fieldTotals[f].total += qs.length;
  }
  // null detail per period for revenue/netInc
  qs.forEach((q) => {
    const missF = FIELDS.filter((f) => q[f] == null);
    if (missF.length) (nullDetail[q.end] = missF);
  });
  // abnormal years
  const years = ends.map((e) => Number(e.slice(0, 4)));
  const minY = Math.min(...years), maxY = Math.max(...years);
  const badYears = { pre2000: ends.filter((e) => Number(e.slice(0, 4)) < 2000), postNow: ends.filter((e) => D(e) > TODAY) };

  // ---- segments stats ----
  const revByEnd = {}; qs.forEach((q) => (revByEnd[q.end] = q.revenue));
  const sc = segments.companies[ticker];
  let seg = null;
  if (sc && (sc.quarters || sc.annualQuarters)) {
    const allMap = { ...(sc.quarters || {}), ...(sc.annualQuarters || {}) };
    const segEnds = Object.keys(allMap).sort();
    const segLastArr = segEnds.length ? allMap[segEnds.at(-1)] : [];
    const latestSegCount = Array.isArray(segLastArr) ? segLastArr.length : null;
    const pset = new Set(ends), sset = new Set(segEnds);
    const profitOnly = [...pset].filter((e) => !sset.has(e));
    const segOnly = [...sset].filter((e) => !pset.has(e));
    const gaps = [];
    for (let i = 1; i < segEnds.length; i++) {
      const d = daysBetween(D(segEnds[i - 1]), D(segEnds[i]));
      if (d > 130) gaps.push(`${segEnds[i - 1]}->${segEnds[i]}(${d}d)`);
    }
    // segment-sum vs revenue reconciliation on periods present in BOTH and single-quarter
    const sumChecks = [];
    for (const e of segEnds) {
      const list = allMap[e];
      if (!Array.isArray(list) || !list.length) continue;
      const R = revByEnd[e];
      if (R == null) continue;
      const S = list.reduce((a, x) => a + (typeof x.value === 'number' ? x.value : 0), 0);
      if (!S) continue;
      sumChecks.push({ end: e, S, R, dev: Math.abs(S - R) / Math.abs(R) });
    }
    const badRecon = sumChecks.filter((c) => c.dev > 0.05);
    seg = {
      n: segEnds.length, first: segEnds[0], last: segEnds.at(-1), latestSegCount,
      segOnly, profitOnly: profitOnly.filter((e) => e >= segEnds[0] && e <= segEnds.at(-1)),
      profitOnlyOutside: profitOnly.filter((e) => e < segEnds[0]),
      gaps,
      segStaleDays: segEnds.length ? daysBetween(D(segEnds.at(-1)), TODAY) : null,
      profitSegLagDays: segEnds.length && last ? daysBetween(D(segEnds.at(-1)), D(last)) : null,
      nSumChecks: sumChecks.length,
      nBadRecon: badRecon.length,
      badReconDetail: badRecon.slice(0, 6).map((c) => `${c.end}(seg=${Math.round(c.S)}/rev=${Math.round(c.R)},${(c.dev*100).toFixed(0)}%)`),
    };
  }

  rows.push({
    ticker, name: pc.name || ticker, market: marketOf(ticker), freq,
    n: qs.length, first, last,
    daysSinceLatest: last ? daysBetween(D(last), TODAY) : null,
    periodTypes, nullCount, nullDetail,
    badYears, seg,
    noteKeys: Object.keys(pc).filter((k) => !['name','cik','currency','quarters','frequency','notes','preview','country'].includes(k)),
    preview: !!pc.preview, currency: pc.currency,
  });
}

// ---- overall market summary ----
const byMarket = {};
for (const r of rows) {
  const m = (byMarket[r.market] ||= { n: 0, stale: 0, noSeg: 0, minLast: null, latestDates: [] });
  m.n++;
  m.latestDates.push(r.last);
}
for (const [mk, m] of Object.entries(byMarket)) {
  m.latestDates.sort();
  m.medianLatest = m.latestDates[Math.floor(m.latestDates.length / 2)];
  m.minLatest = m.latestDates[0];
  m.maxLatest = m.latestDates.at(-1);
}

// per-market field null matrix
const marketField = {};
for (const r of rows) {
  const mf = (marketField[r.market] ||= {});
  for (const f of FIELDS) { (mf[f] ||= { null: 0, total: 0 }); mf[f].null += r.nullCount[f]; mf[f].total += r.n; }
}

// overdue-next-period: last + cadence + lag < today (strict "should already have filed next")
function cadenceDays(r) {
  if (r.freq === 'annual') return 365;
  if (r.freq === 'mixed') return 182;      // 20-F + interim cadence
  return 91;                                // quarterly / hk-mixed
}
for (const r of rows) {
  if (!r.last) { r.overdueNext = false; continue; }
  const lag = r.freq === 'annual' ? 90 : 45;
  r.nextDue = fmt(new Date(D(r.last).getTime() + (cadenceDays(r) + lag) * 86400000));
  r.overdueNext = D(r.nextDue) < TODAY;
}

// ---- expected-latest staleness flags ----
// graduation: US quarterly -> expect 2026-09-30 (Q3); CN -> 2026-09-30; HK -> 2026-06-30; KR mixed/annual exempt-ish
function expectedCutoff(r) {
  if (r.freq === 'annual') return null; // annual filers exempt
  if (r.market === 'US') return '2026-09-30';
  if (r.market === 'CN') return '2026-09-30';
  if (r.market === 'HK') return '2026-06-30';
  if (r.market === 'KR') return '2026-09-30';
  if (r.market === 'TW') return '2026-09-30';
  if (['CH','FR','JP','UK'].includes(r.market)) return '2026-06-30';
  return '2026-06-30';
}
for (const r of rows) {
  r.cutoff = expectedCutoff(r);
  r.staleFlag = r.cutoff ? (D(r.last) < D(r.cutoff)) : false;
  r.staleDays = r.cutoff ? daysBetween(D(r.last), D(r.cutoff)) : 0;
}

// ---- frequency contradictions ----
const freqFlags = [];
for (const r of rows) {
  if (r.freq === 'annual' && r.n > 12) freqFlags.push(`${r.ticker}: annual 却 ${r.n} 期`);
  if (r.freq === 'q' && r.n > 0 && r.n < 4 && r.daysSinceLatest > 200) freqFlags.push(`${r.ticker}: q 但仅 ${r.n} 期且末期 ${r.last}`);
}

// ---- write JSON artifact ----
const artifact = {
  today: fmt(TODAY), profitUpdated: profit.updated, segUpdated: segments.updated,
  profitCompanies: Object.keys(profit.companies).length,
  segCompanies: Object.keys(segments.companies || {}).length,
  companiesJsonRows: companies.length,
  segOnlyTickers: Object.keys(segments.companies || {}).filter((t) => !profit.companies[t]),
  profitOnlyTickers: Object.keys(profit.companies).filter((t) => !segments.companies[t]),
  fieldTotals,
  marketField,
  byMarket,
  freqFlags,
  rows,
};
writeFileSync(`${OUT}/analysis.json`, JSON.stringify(artifact, null, 1));

// ---- console summary ----
console.log(`TODAY=${fmt(TODAY)} profit.updated=${profit.updated} seg.updated=${segments.updated}`);
console.log(`profit companies=${artifact.profitCompanies} seg companies=${artifact.segCompanies} companies.json=${companies.length}`);
console.log(`segOnly=${JSON.stringify(artifact.segOnlyTickers)} profitOnly=${JSON.stringify(artifact.profitOnlyTickers)}`);
console.log('\n== field null matrix (overall) ==');
for (const f of FIELDS) console.log(`  ${f}: ${fieldTotals[f].null}/${fieldTotals[f].total} null (${(100*fieldTotals[f].null/fieldTotals[f].total).toFixed(1)}%)`);
console.log('\n== field null matrix (per market) ==');
for (const [mk, mf] of Object.entries(marketField)) {
  console.log(`  ${mk}: ` + FIELDS.map((f) => `${f} ${(100*mf[f].null/mf[f].total).toFixed(0)}%`).join(' | '));
}
console.log('\n== by market ==');
for (const [mk, m] of Object.entries(byMarket)) console.log(`  ${mk}: n=${m.n} min=${m.minLatest} median=${m.medianLatest} max=${m.maxLatest}`);
console.log('\n== STALE vs expected cutoff (sorted by lag) ==');
rows.filter((r) => r.staleFlag).sort((a, b) => b.staleDays - a.staleDays)
  .forEach((r) => console.log(`  ${r.ticker} [${r.market}/${r.freq}] last=${r.last} cutoff>=${r.cutoff} lag=${r.staleDays}d n=${r.n}`));
console.log(`\n== overdueNext (last+cadence+lag < TODAY) : ${rows.filter(r=>r.overdueNext).length} 家 ==`);
rows.filter(r => r.overdueNext).sort((a,b)=>D(a.nextDue)-D(b.nextDue)).forEach(r=>console.log(`  ${r.ticker} [${r.market}/${r.freq}] last=${r.last} nextDue=${r.nextDue} gap=${r.profitSegLagDays}d`));

console.log('\n== stale vs expected cutoff ==');
rows.filter((r) => r.staleFlag).sort((a, b) => b.staleDays - a.staleDays)
  .forEach((r) => console.log(`  ${r.ticker} [${r.market}/${r.freq}] last=${r.last} expected>=${r.cutoff} lag=${r.staleDays}d n=${r.n}`));
console.log('\n== freq flags ==');
console.log(freqFlags.map((x) => '  ' + x).join('\n') || '  none');
console.log('\n== abnormal years ==');
rows.filter((r) => r.badYears.pre2000.length || r.badYears.postNow.length)
  .forEach((r) => console.log(`  ${r.ticker}: pre2000=[${r.badYears.pre2000.join(',')}] postNow=[${r.badYears.postNow.join(',')}]`));
console.log('\n== segments: no seg ==');
const noSeg = rows.filter((r) => !r.seg);
console.log(`  ${noSeg.length} 家无 segments: ${noSeg.map((r) => r.ticker).join(', ')}`);
console.log('\n== segments with profit-only periods (profit has, seg missing, inside overlap) ==');
rows.filter((r) => r.seg && r.seg.profitOnly.length > 3).sort((a, b) => b.seg.profitOnly.length - a.seg.profitOnly.length)
  .forEach((r) => console.log(`  ${r.ticker}: seg ${r.seg.n}期 ${r.seg.first}~${r.seg.last} | profit有seg缺 ${r.seg.profitOnly.length} 期`));
console.log('\n== segments with latestSegCount<4 ==');
rows.filter((r) => r.seg && r.seg.latestSegCount != null && r.seg.latestSegCount < 4)
  .forEach((r) => console.log(`  ${r.ticker}: latestSegCount=${r.seg.latestSegCount} segN=${r.seg.n} ${r.seg.first}~${r.seg.last}`));

console.log('\n== segments STALE: seg last vs profit last (sorted by profitSegLagDays desc) ==');
rows.filter((r) => r.seg && r.seg.n > 0).sort((a, b) => (b.seg.profitSegLagDays || 0) - (a.seg.profitSegLagDays || 0))
  .forEach((r) => console.log(`  ${r.ticker}: segLast=${r.seg.last} profitLast=${r.last} profit-seg lag=${r.seg.profitSegLagDays}d (seg stale vs today ${r.seg.segStaleDays}d)`));

console.log('\n== segments SUM vs revenue reconciliation (bad periods >5% off / checked) ==');
rows.filter((r) => r.seg && r.seg.nSumChecks > 0 && r.seg.nBadRecon > 0)
  .sort((a, b) => (b.seg.nBadRecon / b.seg.nSumChecks) - (a.seg.nBadRecon / a.seg.nSumChecks))
  .forEach((r) => console.log(`  ${r.ticker}: ${r.seg.nBadRecon}/${r.seg.nSumChecks} 期求和偏离>5% | ${r.seg.badReconDetail.join(' ')}`));

