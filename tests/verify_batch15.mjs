/* batch15 data regression: 7 US/ADR names got their 2026-09-30 period (Q3-26 / ARM FY27Q2).
   Run: node tests/verify_batch15.mjs   (pure data assertions, no browser, no server)
   Every expected value below was re-extracted from the primary 6-K exhibit (see data/staging/batch15.json
   _meta.sources for the exact URLs) and cross-checked against an independent aggregator; the tolerance is
   ±0.5% per the ingest contract. Existing assertions elsewhere are untouched. */
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
const C = JSON.parse(fs.readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); fails++; } else console.log('ok  ', msg); };
const approx = (a, b, tol = 0.005) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * tol;
const fx = 0.14915355; // ECB 2026-09-30 USD/CNY spot 6.7045 → 1/6.7045

// ticker → [revenue, gross, opInc, netInc, rd, sga, tax]  (CNY-M for the five China names, USD-M for XNET/ARM)
const EXPECT = {
  BABA:  [271519, 103043, 29116, 64535, 22632, 51438, 37126],
  JD:    [309593, 32321, 5154, 6503, 7730, 18882, 1637],
  PDD:   [108341, 63098, 31164, 29541, 5059, 26875, 6570],
  NTES:  [27852.4, 19045.025, 9427.843, 8402.223, 4694.212, 4922.97, 1850],
  LKNCY: [17891.458, 11037.26, 2755.932, 1858.881, null, 7767.034, 914.118],
  XNET:  [100.824, 56.459, -14.788, -235.776, 25.636, 45.757, 2.274],
  ARM:   [1443, 1401, 201, 130, 857, 343, 78],
};
const FIELDS = ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga', 'tax'];

for (const [tk, exp] of Object.entries(EXPECT)) {
  const co = P.companies[tk];
  if (!co) { ok(false, `${tk} exists in profit.json`); continue; }
  const qs = co.quarters;
  const last = qs.at(-1);
  ok(last.end === '2026-09-30', `${tk} latest period is 2026-09-30 (got ${last.end})`);
  ok(last.periodType === 'q', `${tk} periodType = q, matching every prior row of this series (got ${last.periodType})`);

  // key set AND insertion order must equal the previous quarter's row (no extra null keys, no missing keys)
  const prev = qs[qs.length - 2];
  ok(Object.keys(last).join(',') === Object.keys(prev).join(','),
    `${tk} key order identical to prior row (${Object.keys(last).join(',')})`);

  FIELDS.forEach((f, i) => {
    const want = exp[i], got = last[f];
    if (want === null) { ok(got === null, `${tk} ${f} stays explicit null as in the series`); return; }
    ok(approx(got, want), `${tk} ${f} = ${want} ±0.5% (got ${got})`);
  });

  // currency / fx plumbing
  const isCNY = co.currency === 'CNY-M';
  ok(co.currency === (isCNY ? 'CNY-M' : 'USD-M'), `${tk} currency = ${co.currency}`);
  ok(last.fxDate === '2026-09-30', `${tk} fxDate = 2026-09-30 (got ${last.fxDate})`);
  if (isCNY) ok(approx(last.fxToUsd, fx, 1e-9), `${tk} fxToUsd = 1/6.7045 = ${fx} (got ${last.fxToUsd})`);
  else ok(last.fxToUsd === 1, `${tk} keeps fxToUsd = 1 like all its prior USD rows (got ${last.fxToUsd})`);

  // value gates mirrored from scripts/merge_batches.mjs
  ok(last.revenue > 0, `${tk} revenue > 0`);
  ok(last.gross == null || (last.gross >= 0 && last.gross <= last.revenue), `${tk} 0 <= gross <= revenue`);
  ok(!qs.filter(q => q.end === '2026-09-30').slice(1).length, `${tk} has exactly one 2026-09-30 row`);
  // no regression in history: dates strictly increasing
  ok(qs.every((q, i) => i === 0 || qs[i - 1].end < q.end), `${tk} quarter ends strictly increasing`);
}

// fiscal-year mapping must stay absent from periodType but present in companies.json (ARM = March FYE → FY2027 Q2)
const reg = tk => (Array.isArray(C) ? C.find(x => x.ticker === tk) : (C.companies || C)[tk]);
ok(reg('ARM')?.fiscalYearEndMonth === 3, 'companies.json ARM fiscalYearEndMonth = 3 (2026-09-30 is FY2027 Q2)');
ok(reg('BABA')?.fiscalYearEndMonth === 3, 'companies.json BABA fiscalYearEndMonth = 3 (2026-09-30 is FY27 Q2)');
for (const tk of ['JD', 'PDD', 'NTES', 'LKNCY', 'XNET']) {
  ok(reg(tk)?.fiscalYearEndMonth === 12, `companies.json ${tk} fiscalYearEndMonth = 12`);
}
const armQ = P.companies.ARM.quarters.filter(q => q.periodType !== 'annual');
ok(armQ.every(q => q.periodType === 'q') && armQ.length === 14,
  `ARM keeps the plain "q" periodType convention (${armQ.length} non-annual rows, all "q")`);

// JD gross uses the series' revenue − cost of revenues − fulfillment definition (proved by the filing cross-check)
const jd = P.companies.JD.quarters.at(-1);
ok(approx(jd.gross, jd.revenue - 253632 - 23640), `JD gross = rev − COGS − fulfillment (${jd.gross})`);

// XNET revenue is net of business taxes, per its series convention (101,304 − 480 = 100,824)
const xn = P.companies.XNET.quarters.at(-1);
ok(approx(xn.revenue, (101304 - 480) / 1000), `XNET revenue = gross revenues 101,304 − business taxes 480 = ${xn.revenue}`);
ok(approx(xn.gross, xn.revenue - 44365 / 1000), `XNET gross = net revenues − cost of revenues (${xn.gross})`);

// batch15 must not have disturbed the neighbour periods (spot-check two boundary values)
ok(P.companies.BABA.quarters.find(q => q.end === '2026-06-30').revenue === 268953, 'BABA 2026-06-30 untouched (268953)');
ok(P.companies.ARM.quarters.find(q => q.end === '2026-06-30').netInc === 270, 'ARM 2026-06-30 untouched (270)');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
