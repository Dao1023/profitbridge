// Fix Want Want 00151.HK period ends: REPORT_DATE is the true period end (STD_REPORT_DATE is
// off by one quarter for this issuer). WW changed FYE 12-31 -> 3-31; FY2017/18 was a 15-month
// transition period (2017-01-01..2018-03-31, rev 24,854.462M per HKEX ltn20180605212_c.pdf;
// NP attributable not extractable from PDF summary col = operating profit, so no 15M row).
// Refetches fxToUsd for shifted ends. Regenerates data/profit.json.js.
import fs from 'node:fs';
import https from 'node:https';

const P = './data/profit.json';
const profit = JSON.parse(fs.readFileSync(P, 'utf8'));
const raw = JSON.parse(fs.readFileSync('./tmp-batch3/hk_raw.json', 'utf8'));
const c = profit.companies['00151.HK'];

const getJSON = url => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
    let d = ''; r.on('data', x => d += x); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
const r3 = x => x == null ? null : Math.round(x * 1e6) / 1e6;
async function fx(date) {
  try {
    const j = await getJSON(`https://api.frankfurter.app/${date}?from=CNY&to=USD`);
    if (j?.rates?.USD) return r3(j.rates.USD);
  } catch (e) { /* fallthrough */ }
  return r3(1 / 8.2765); // CNY peg fallback
}

// index raw rows by value signature
const rows = raw['00151'].rows;
const sig = x => {
  const rev = x.OI ?? x.OPERATE_INCOME;
  const ni = x.HP ?? x.HOLDER_PROFIT;
  return `${Math.round(rev / 1e7)}|${Math.round(ni / 1e7)}`; // value in 10M RMB (float-safe)
};
const bySig = new Map();
for (const row of rows) {
  const s = sig(row);
  const end = row.REPORT_DATE.slice(0, 10);
  if (!bySig.has(s)) bySig.set(s, end);
}

let shifted = 0, fxSame = 0;
for (const q of c.quarters) {
  const s = sig({ OI: q.revenue * 1e6, HP: q.netInc * 1e6 });
  const trueEnd = bySig.get(s);
  if (!trueEnd) { console.warn('NO RAW MATCH for', q.end, s); continue; }
  if (trueEnd !== q.end) {
    console.log(`${q.end} -> ${trueEnd} (fx ${q.fxToUsd} -> refetch)`);
    q.end = trueEnd;
    q.fxToUsd = await fx(trueEnd);
    shifted++;
  } else fxSame++;
}
c.quarters.sort((a, b) => a.end < b.end ? -1 : 1);
console.log(`shifted=${shifted} unchanged=${fxSame} total=${c.quarters.length}`);
console.log('range now:', c.quarters[0].end, '..', c.quarters.at(-1).end);

c.notes = 'HKEX filer 中国旺旺 Want Want China (TW-origin, reports in RMB): annual + interim + sparse Q3 cumulative disclosures, included as-disclosed cumulative series, NOT differenced. FISCAL-YEAR CHANGE: FYE moved from 12-31 to 3-31; FY2017/18 is a 15-month transition period (2017-01-01..2018-03-31, revenue 24,854.462M RMB per HKEX announcement ltn20180605212_c.pdf) — not included as a separate row (NP attributable not machine-extractable; CY2017 annual absent from eastmoney rows). Period ends corrected to eastmoney REPORT_DATE (STD_REPORT_DATE is one quarter early for this issuer). Q3 (9M cumulative) discontinued after 2017-09-30. Early fiscal years originally reported in USD (originalCurrency flag). Source: eastmoney RPT_HKF10_FN_MAININDICATOR via batch3 staging + HKEX PDF. Watchlist ticker 0151.HK.';

fs.writeFileSync(P, JSON.stringify(profit, null, 2) + '\n');
fs.writeFileSync('./data/profit.json.js', 'window.__PROFIT_DATA = ' + JSON.stringify(profit) + ';\n');
console.log('WROTE data/profit.json + data/profit.json.js');
