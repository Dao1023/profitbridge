#!/usr/bin/env node
/**
 * audit_segments_currency.mjs
 *
 * System-wide audit of data/segments.json against data/profit.json.
 *
 * segments.json contract: every segment `value` MUST be USD millions ($M).
 * profit.json revenue is in the reporting currency (millions); fxToUsd is the
 * USD value of 1 unit of that currency (revenue * fxToUsd = USD millions).
 *
 * The naive check the task asks for is:
 *     ratioRow = segSum / (profitRow.revenue * fxToUsd)      (should be ~1)
 * but that is only valid when the segment period is a SINGLE quarter AND the
 * matching profit row is a single quarter. Two very common cases are NOT bugs:
 *
 *   (a) CUMULATIVE segments vs single-quarter profit rows (A-share/HK half-year &
 *       FY segment disclosures). app.js cumulativeView() rebuilds the revenue node
 *       from fiscal-YTD profit sums so the sankey still matches. For these the
 *       correct denominator is the fiscal-YTD revenue, not the single row.
 *       -> ratioEff = segSum / (YTD revenue * fx)  is what the UI actually shows.
 *
 *   (b) period-end March FY companies (e.g. 00992.HK) where cumulative segments
 *       exist but app.js SKIPS the correction because fiscalYearEndMonth != 12.
 *       Those are genuinely broken and show up as ratioEff = ratioRow (~4x).
 *
 * So we print:
 *   ratioRow : segSum / (row.revenue * fx)                 (naive, task spec)
 *   ratioEff : segSum / (effectiveRevenue * fx)            (what the UI shows:
 *              uses cumulativeView() YTD revenue when it applies)
 *   ratioNat : segSum / effectiveRevenue(native units)      (≈1 => segments are
 *              stored in native currency -> currency-not-converted bug)
 *   ratioFY  : segSum / (full-fiscal-year native revenue * fx) (≈1 with ratioEff
 *              far off => cumulative segments vs single-quarter profit, needs FY)
 *
 * Classification of every genuinely-off period (|ratioEff-1| > 5%):
 *   - currency-not-converted : ratioNat ≈ 1  (values in local currency, not USD)
 *   - cumulative-vs-single   : ratioFY  ≈ 1  (segments = FY total, profit = single q)
 *   - other                  : segment gap / fiscal misalignment / true miss
 *
 * Usage:
 *   node scripts/audit_segments_currency.mjs           # human table (genuine issues)
 *   node scripts/audit_segments_currency.mjs --all      # + in-tolerance rows
 *   node scripts/audit_segments_currency.mjs --json     # machine-readable
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seg = JSON.parse(readFileSync(resolve(ROOT, 'data/segments.json'), 'utf8'));
const prof = JSON.parse(readFileSync(resolve(ROOT, 'data/profit.json'), 'utf8'));

const args = new Set(process.argv.slice(2));
const AS_JSON = args.has('--json');
const SHOW_ALL = args.has('--all');

const DEV_FLAG = 0.05; // flag > ±5%
const DEV_OK = 0.03;   // healthy band ±3%
const CUM_SEG_TYPES = new Set(['half', 'FY', 'annual', 'mixed']);

const sumTop = (arr) => (arr || []).reduce((a, x) => a + (typeof x.value === 'number' ? x.value : 0), 0);
const rowKey = (end) => end;

// ---- index profit rows ----
const profitBy = {};
for (const [tk, c] of Object.entries(prof.companies || {})) {
  const m = new Map();
  for (const q of c.quarters || []) m.set(q.end, { ...q, periodType: q.periodType || 'q' });
  profitBy[tk] = m;
}

// ---- replicate app.js: profitRowIsCumulative ----
function profitRowIsCumulative(tk, qv) {
  const e = prof.companies[tk] || {};
  if (e.frequency === 'annual') return true;
  if ((e.frequency === 'hk-mixed' || e.frequency === 'mixed') &&
      (qv.periodType === 'annual' || qv.periodType === 'interim')) return true;
  return false;
}
// ---- replicate app.js: fiscalYearEndMonth ----
function fiscalYearEndMonth(tk) {
  const e = prof.companies[tk] || {};
  const annual = (e.quarters || []).filter((o) => (o.periodType || 'q') === 'annual');
  if (annual.length) return Number(annual[annual.length - 1].end.slice(5, 7));
  const s = seg && seg.companies[tk];
  if (s && s.periodTypes) {
    const cnt = {};
    for (const k in s.periodTypes) {
      const tp = s.periodTypes[k];
      if (tp === 'annual' || tp === 'FY') { const mm = Number(k.slice(5, 7)); cnt[mm] = (cnt[mm] || 0) + 1; }
    }
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    if (best) return Number(best[0]);
  }
  const cnt = {};
  (e.quarters || []).slice(-8).forEach((o) => { const mm = Number(o.end.slice(5, 7)); cnt[mm] = (cnt[mm] || 0) + 1; });
  const entries = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const top = entries[0][1], tied = entries.filter((x) => x[1] === top).map((x) => Number(x[0]));
    return tied.includes(12) ? 12 : tied[0];
  }
  return 12;
}
// ---- replicate app.js: ytdSum (calendar-year slice; only used when FY month == 12) ----
function ytdRevenue(tk, qEnd) {
  let any = false, sum = 0;
  for (const o of prof.companies[tk].quarters) {
    if (o.end.slice(0, 4) === qEnd.slice(0, 4) && o.end <= qEnd && o.revenue != null) { any = true; sum += o.revenue; }
  }
  return any ? sum : null;
}
function ytdQuartersCount(tk, qEnd) {
  return prof.companies[tk].quarters.filter((o) => o.end.slice(0, 4) === qEnd.slice(0, 4) && o.end <= qEnd).length;
}
// ---- replicate app.js: cumulativeView -> returns effective native revenue or null ----
function cumulativeRevenue(tk, qv) {
  const s = seg && seg.companies[tk];
  if (!s) return null;
  if (!s.quarters || !s.quarters[qv.end]) return null;
  const pt = (s.periodTypes && s.periodTypes[qv.end]) || s.periodType;
  if (!CUM_SEG_TYPES.has(pt)) return null;
  if (profitRowIsCumulative(tk, qv)) return null;
  if (fiscalYearEndMonth(tk) !== 12) return null;
  if (ytdQuartersCount(tk, qv.end) < 2) return null;
  return { revenue: ytdRevenue(tk, qv.end), pt };
}
// ---- full fiscal-year revenue (for the cumulative diagnosis) ----
function fiscalYearRevenue(tk, qEnd) {
  const m = fiscalYearEndMonth(tk);
  const qy = Number(qEnd.slice(0, 4)), qm = Number(qEnd.slice(5, 7));
  const fyEndYear = qm <= m ? qy : qy + 1;
  const fyEnd = `${fyEndYear}-${String(m).padStart(2, '0')}-` + (m === 2 ? '28' : '31');
  const prevEndYear = fyEndYear - 1;
  const prevEnd = `${prevEndYear}-${String(m).padStart(2, '0')}-` + (m === 2 ? '28' : '31');
  let any = false, sum = 0;
  for (const o of prof.companies[tk].quarters) {
    if (o.end > prevEnd && o.end <= fyEnd && o.revenue != null) { any = true; sum += o.revenue; }
  }
  return any ? sum : null;
}

const rows = [];
const unmatched = [];

for (const [tk, sc] of Object.entries(seg.companies || {})) {
  const quarters = sc.quarters || {};
  const ends = Object.keys(quarters);
  if (!ends.length) continue;
  const pc = (prof.companies || {})[tk];
  const currency = pc ? pc.currency : '(no profit row)';
  for (const end of ends) {
    const segSum = sumTop(quarters[end]);
    const pt = (sc.periodTypes && sc.periodTypes[end]) || sc.periodType || '';
    const pq = profitBy[tk] && profitBy[tk].get(end);
    if (!pq || typeof pq.revenue !== 'number') {
      unmatched.push({ ticker: tk, end, segSum: +segSum.toFixed(1), currency, periodType: pt });
      continue;
    }
    const fx = typeof pq.fxToUsd === 'number' ? pq.fxToUsd : 1;
    const cum = cumulativeRevenue(tk, pq);
    const effRevenueNative = cum && cum.revenue != null ? cum.revenue : pq.revenue;
    const revenueUsd = effRevenueNative * fx;
    const ratioRow = pq.revenue !== 0 ? segSum / (pq.revenue * fx) : null;
    const ratioEff = revenueUsd !== 0 ? segSum / revenueUsd : null;
    const ratioNat = effRevenueNative !== 0 ? segSum / effRevenueNative : null;
    const fyRev = fiscalYearRevenue(tk, end);
    const ratioFY = fyRev ? segSum / (fyRev * fx) : null;
    const dev = ratioEff == null ? null : ratioEff - 1;
    const devNaive = ratioRow == null ? null : ratioRow - 1;
    let cls = 'ok';
    if (dev != null && Math.abs(dev) > DEV_FLAG) {
      if (ratioNat != null && Math.abs(ratioNat - 1) <= DEV_OK) cls = 'currency-not-converted';
      else if (ratioFY != null && Math.abs(ratioFY - 1) <= 0.05) cls = 'cumulative-vs-single';
      else cls = 'other';
    }
    rows.push({
      ticker: tk, end, currency, periodType: pt,
      appliedCumulative: !!cum,
      segSum: +segSum.toFixed(1),
      revenueRow: +pq.revenue.toFixed(1),
      effRevenueNative: +effRevenueNative.toFixed(1),
      fx: +fx.toFixed(5),
      revenueUsd: +revenueUsd.toFixed(1),
      ratioRow: ratioRow == null ? null : +ratioRow.toFixed(4),
      ratioEff: ratioEff == null ? null : +ratioEff.toFixed(4),
      ratioNat: ratioNat == null ? null : +ratioNat.toFixed(4),
      ratioFY: ratioFY == null ? null : +ratioFY.toFixed(4),
      devPct: dev == null ? null : +(dev * 100).toFixed(2),
      devNaivePct: devNaive == null ? null : +(devNaive * 100).toFixed(2),
      cls,
      flag: cls !== 'ok',
    });
  }
}

const flagged = rows.filter((r) => r.flag).sort((a, b) => Math.abs(b.devPct) - Math.abs(a.devPct));
const byClass = {};
for (const r of flagged) byClass[r.cls] = (byClass[r.cls] || 0) + 1;

if (AS_JSON) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), devFlag: DEV_FLAG, flagged, unmatched, all: rows }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const line = (s) => console.log(s);

line(`\nsegments.json currency audit — ${rows.length} ticker/period rows with a matching profit row`);
line(`flagged (|ratioEff-1| > ${DEV_FLAG * 100}%): ${flagged.length}   by class: ${JSON.stringify(byClass)}   unmatched periods: ${unmatched.length}`);
line('='.repeat(150));
line(
  pad('TICKER', 12) + pad('PERIOD', 12) + pad('CUR', 8) + pad('TYPE', 7) +
  padL('SEGSUM($M)', 11) + padL('REV_row', 10) + padL('EFF_REV', 10) + padL('FX', 9) +
  padL('REV_USD', 11) + padL('rROW', 8) + padL('rEFF', 8) + padL('rNAT', 8) + padL('rFY', 8) + '  CLASS'
);
line('-'.repeat(150));
const shown = SHOW_ALL ? rows : flagged;
for (const r of shown.sort((a, b) => (SHOW_ALL ? (a.ticker + a.end).localeCompare(b.ticker + b.end) : Math.abs(b.devPct) - Math.abs(a.devPct)))) {
  line(
    pad(r.ticker, 12) + pad(r.end, 12) + pad(r.currency, 8) + pad(r.periodType, 7) +
    padL(r.segSum, 11) + padL(r.revenueRow, 10) + padL(r.effRevenueNative, 10) + padL(r.fx, 9) +
    padL(r.revenueUsd, 11) + padL(r.ratioRow, 8) + padL(r.ratioEff, 8) + padL(r.ratioNat, 8) + padL(r.ratioFY, 8) +
    '  ' + r.cls
  );
}
line('-'.repeat(150));

if (unmatched.length) {
  line(`\nUnmatched segment periods (no profit row for same end): ${unmatched.length}`);
  for (const u of unmatched) line(`  ${pad(u.ticker, 12)} ${u.end}  type=${pad(u.periodType, 7)} segSum=${u.segSum}  (${u.currency})`);
}

line('\nGenuine issues grouped by class:');
for (const cls of ['currency-not-converted', 'cumulative-vs-single', 'other']) {
  const rs = flagged.filter((r) => r.cls === cls);
  if (!rs.length) continue;
  line(`\n[${cls}] ${rs.length} period(s), ${new Set(rs.map((r) => r.ticker)).size} ticker(s):`);
  const tickers = [...new Set(rs.map((r) => r.ticker))];
  for (const tk of tickers) {
    const rr = rs.filter((x) => x.ticker === tk);
    line(`  ${pad(tk, 12)} periods=${rr.length}  dev%=[${rr.map((x) => (x.devPct > 0 ? '+' : '') + x.devPct).join(', ')}]  cur=${rr[0].currency}`);
  }
}
line('');
