/* batch16 data regression: three non-SEC Asian names got their 2026-09-30 quarter.
   005930.KS (Samsung, KRW-M), 066570.KS (LG, KRW-M), 2454.TW (MediaTek, USD-M).
   Run: node tests/verify_batch16.mjs   (pure data assertions, no browser, no server)
   Every expected value was re-extracted from the primary filing / official deck and cross-checked against an
   independent second source (see data/staging/batch16.json _meta.sources); tolerance is ±0.5%.
   Existing assertions elsewhere are untouched. */
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); fails++; } else console.log('ok  ', msg); };
const approx = (a, b, tol = 0.005) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * tol;

// ticker → [revenue, gross, opInc, netInc, rd, sga, tax]  (KRW-M for the two Korean names, USD-M for MediaTek)
const EXPECT = {
  '005930.KS': [195253209, 135263852, 107440482, 75208134],
  '066570.KS': [23824080, 5815902, 781858, 663250, 750810, 5034044, 145240],
  '2454.TW':   [5156, 2388, 831, 855],
};

for (const [tk, exp] of Object.entries(EXPECT)) {
  const co = P.companies[tk];
  if (!co) { ok(false, `${tk} exists in profit.json`); continue; }
  const qs = co.quarters;
  const last = qs.at(-1);
  ok(last.end === '2026-09-30', `${tk} latest period is 2026-09-30 (got ${last.end})`);
  ok(qs.filter(q => q.end === '2026-09-30').length === 1, `${tk} has exactly one 2026-09-30 row`);
  // no regression: dates strictly increasing, prior period untouched
  ok(qs.every((q, i) => i === 0 || qs[i - 1].end < q.end), `${tk} quarter ends strictly increasing`);
  ok(qs.at(-2).end === '2026-06-30', `${tk} prior period is 2026-06-30`);
  // value gates mirrored from scripts/merge_batches.mjs
  ok(last.revenue > 0, `${tk} revenue > 0`);
  ok(last.gross == null || (last.gross >= 0 && last.gross <= last.revenue), `${tk} 0 <= gross <= revenue`);
  ok(last.opInc == null || last.opInc <= last.gross, `${tk} opInc <= gross`);
}

// ---- key set / order: the original 5 keys keep their relative order; new keys are appended in a fixed order ----
const CORE5 = ['end', 'revenue', 'netInc', 'periodType', 'fxToUsd'];
for (const tk of ['005930.KS', '066570.KS']) {
  const last = P.companies[tk].quarters.at(-1);
  const keys = Object.keys(last);
  ok(keys.slice(0, 5).join(',') === CORE5.join(','),
    `${tk} original 5 keys keep order end,revenue,netInc,periodType,fxToUsd (got ${keys.slice(0, 5).join(',')})`);
  ok(keys[5] === 'fxDate', `${tk} fxDate appended right after fxToUsd (got ${keys[5]})`);
  const wantTail = tk === '005930.KS' ? ['gross', 'opInc'] : ['gross', 'opInc', 'rd', 'sga', 'tax'];
  ok(keys.slice(6).join(',') === wantTail.join(','),
    `${tk} enrichment keys appended as ${wantTail.join(',')} (got ${keys.slice(6).join(',')})`);
  ok(last.periodType === 'q3', `${tk} periodType = q3 (series convention for every Q3 row)`);
  ok(approx(last.fxToUsd, 0.00073779, 1e-9), `${tk} fxToUsd = 1/1355.40 = 0.00073779 (got ${last.fxToUsd})`);
  ok(last.fxDate === '2026-09-30', `${tk} fxDate = 2026-09-30 (got ${last.fxDate})`);
  ok(P.companies[tk].currency === 'KRW-M', `${tk} currency stays KRW-M (values are millions of KRW, not USD)`);
  // values are stored in KRW-M raw (no fx division)
  ok(last.revenue > 1e6, `${tk} revenue is KRW-M raw, not USD-converted`);
}
{
  const last = P.companies['005930.KS'].quarters.at(-1);
  ok(last.gross - last.opInc > 0 && approx(last.gross - last.opInc, 27822970, 0.01),
    '005930.KS gross − opInc ≈ SG&A 27.8T (135,263,852 − 107,440,482 = 27,823,370)');
}
{
  const last = P.companies['066570.KS'].quarters.at(-1);
  ok(last.sga > last.rd, '066570.KS SG&A 5,034,044 includes R&D 750,810 (do not double count)');
  ok(approx(last.opInc, last.gross - last.sga, 0.001), '066570.KS opInc = gross − SG&A (781,858)');
  ok(approx(last.netInc, 663250), '066570.KS netInc is attributable 663,250, not total 708,407');
}
{
  const last = P.companies['2454.TW'].quarters.at(-1);
  ok(Object.keys(last).join(',') === 'end,revenue,gross,opInc,netInc,periodType',
    `2454.TW key order matches every prior row (got ${Object.keys(last).join(',')})`);
  ok(!('fxToUsd' in last), '2454.TW must NOT carry fxToUsd (values already converted, 2330.TW precedent)');
  ok(last.periodType === 'q', `2454.TW periodType = q (got ${last.periodType})`);
  ok(P.companies['2454.TW'].currency === 'USD-M', '2454.TW currency = USD-M');
  const TWD = { revenue: 168056.909, gross: 77848.357, opInc: 27101.839, netInc: 27882.063 };
  for (const [f, twd] of Object.entries(TWD)) {
    const want = twd / 32.596145;
    ok(Math.abs(last[f] - want) <= 0.5,
      `2454.TW ${f} = ${want.toFixed(3)} TWD/32.596145 → rounded ${last[f]} (delta ${Math.abs(last[f] - want).toFixed(3)} ≤ 0.5)`);
  }
  ok(approx(last.netInc, 27882.063 / 32.596145, 0.005), '2454.TW netInc is attributable (27,882.06 TWD-M)');
}

// ---- exact value assertions (±0.5%) ----
for (const [tk, exp] of Object.entries(EXPECT)) {
  const last = P.companies[tk].quarters.at(-1);
  const fields = ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga', 'tax'];
  fields.forEach((f, i) => {
    if (exp[i] == null) return;
    ok(approx(last[f], exp[i]), `${tk} ${f} = ${exp[i]} ±0.5% (got ${last[f]})`);
  });
}

// ---- history untouched (spot-check the boundary values the merge must not disturb) ----
ok(P.companies['005930.KS'].quarters.find(q => q.end === '2026-06-30').revenue === 171499470,
  '005930.KS 2026-06-30 untouched (171,499,470)');
// LG 2026-06-30 netInc is intentionally NOT 604,363 any more: the historical niToCommon -> DART
// attributable correction (see tests/verify_historical_netinc.mjs) moved it to 668,043 on 2026-11-20.
// The batch16 merge must not disturb the row beyond that documented value, and revenue stays intact.
{
  const q = P.companies['066570.KS'].quarters.find(x => x.end === '2026-06-30');
  ok(q.revenue === 23826468, '066570.KS 2026-06-30 revenue untouched (23,826,468)');
  ok(q.netInc === 668043, '066570.KS 2026-06-30 netInc = corrected 668,043 (historical fix)');
}
ok(P.companies['2454.TW'].quarters.find(q => q.end === '2026-06-30').revenue === 4669,
  '2454.TW 2026-06-30 untouched (4,669)');

// ---- mirror deep-equal: data/profit.json.js must carry exactly the same payload as data/profit.json ----
{
  const mirror = fs.readFileSync(new URL('../data/profit.json.js', import.meta.url), 'utf8');
  const parsed = JSON.parse(mirror.replace(/^window\.__PROFIT_DATA = /, '').replace(/;\s*$/, ''));
  ok(JSON.stringify(parsed) === JSON.stringify(P), 'profit.json.js mirror deepEqual to profit.json');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
