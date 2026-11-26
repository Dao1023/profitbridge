/* Historical netInc correction regression (2026-11-20).
   Six single-quarter net-income values for 005930.KS / 066570.KS used stockanalysis `niToCommon`
   instead of IFRS net income attributable to owners of the parent. They are corrected through
   data/staging/patches/2026-11-20_netinc.json (old -> new, whitelisted netInc only, key order kept).

   Run: node tests/verify_historical_netinc.mjs   (pure data assertions, no browser, no server)
   Sources: DART 연결 손익계산서 '지배기업(의) 소유주지분' single-quarter column, cross-checked with
   Naver 금융 지배주주순이익 (억원, rounded) — see the patch file's _meta.sources for rcpNo/URLs. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPatches, applyRowPatches } from '../scripts/lib/row_patches.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
const MIRROR = fs.readFileSync(new URL('../data/profit.json.js', import.meta.url), 'utf8')
  .replace(/^window\.__PROFIT_DATA = /, '').replace(/;\s*$/, '');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); fails++; } else console.log('ok  ', msg); };
const approx = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * tol;

// DART-corrected attributable net income (KRW-M). Keep in sync with the patch file; the test also
// verifies the patch file itself, so drift between the two fails loudly instead of silently passing.
const FIX = {
  '005930.KS': {
    '2025-09-30': { old: 10552774, now: 12006461 },
    '2026-03-31': { old: 41401515, now: 47101190 },
    '2026-06-30': { old: 62564653, now: 71269468 },
  },
  '066570.KS': {
    '2025-09-30': { old: 348244, now: 385190 },
    '2026-03-31': { old: 737660, now: 815703 },
    '2026-06-30': { old: 604363, now: 668043 },
  },
};
const KEY5 = ['end', 'revenue', 'netInc', 'periodType', 'fxToUsd'];

// ---- A. the six rows carry the corrected values; the old values are gone ----
for (const [tk, rows] of Object.entries(FIX)) {
  const co = P.companies[tk];
  if (!co) { ok(false, `${tk} exists in profit.json`); continue; }
  for (const [end, v] of Object.entries(rows)) {
    const hits = co.quarters.filter(q => q.end === end);
    ok(hits.length === 1, `${tk} ${end} has exactly one row (got ${hits.length})`);
    const q = hits[0];
    if (!q) continue;
    ok(q.netInc === v.now, `${tk} ${end} netInc = ${v.now} (got ${q.netInc})`);
    ok(q.netInc !== v.old, `${tk} ${end} netInc no longer the niToCommon value ${v.old}`);
    // key set / order must be exactly the pre-existing 5-key shape: the patch writes a value, never a key
    ok(Object.keys(q).join(',') === KEY5.join(','),
      `${tk} ${end} keeps key order end,revenue,netInc,periodType,fxToUsd (got ${Object.keys(q).join(',')})`);
    ok(typeof q.periodType === 'string' && q.periodType.length > 0, `${tk} ${end} periodType retained (${q.periodType})`);
    ok(typeof q.revenue === 'number' && q.revenue > 0, `${tk} ${end} revenue untouched and > 0`);
  }
}

// ---- B. totals: the fix edits 6 rows, it never adds/removes a row ----
// 2026-11-22: batch17 adds SGCC (6 annual periods) -> 93 companies / 3748 quarters.
// 2026-11-22: batch-sgcc-q replaces those 6 annual rows with 41 single quarters -> 3783.
// 2026-11-26: batch18 adds ZH + LI 2026-09-30 -> 3785.
const totalQ = Object.values(P.companies).reduce((s, c) => s + c.quarters.length, 0);
ok(Object.keys(P.companies).length === 93, `companies = 93 (got ${Object.keys(P.companies).length})`);
ok(totalQ === 3785, `quarters = 3785 (got ${totalQ})`);

// ---- C. the committed patch layer is still in sync with the data: re-applying it is a no-op ----
const { patches } = loadPatches(ROOT);
ok(patches.length === 6, `patch file declares 6 value corrections (got ${patches.length})`);
const clone = JSON.parse(JSON.stringify(P));
const replay = applyRowPatches(clone, patches, { label: 'verify_historical_netinc' });
ok(replay.applied.length === 0, `patch file re-application is a no-op (applied ${replay.applied.length})`);
ok(replay.already.length === 6, `all 6 patches are already reflected in profit.json (got ${replay.already.length})`);
const fileMap = new Map(patches.map(p => [`${p.ticker}|${p.end}`, p]));
for (const [tk, rows] of Object.entries(FIX)) {
  for (const [end, v] of Object.entries(rows)) {
    const p = fileMap.get(`${tk}|${end}`);
    ok(p && p.field === 'netInc' && p.old === v.old && p.new === v.now,
      `patch file ${tk} ${end} maps ${v.old} -> ${v.now}`);
  }
}

// ---- D. no other 2025/2026 row of these two companies still holds a superseded value ----
for (const [tk, rows] of Object.entries(FIX)) {
  for (const [end, v] of Object.entries(rows)) {
    const bad = P.companies[tk].quarters.filter(q => q.end !== end && q.netInc === v.old);
    ok(bad.length === 0, `${tk} no other period still carries the superseded ${v.old}`);
  }
}

// ---- E. FY2025 regression: quarters + implied Q4 must reconcile with the FY attributable total ----
// data/profit.json stores Q1..Q3 2025 as single quarters plus the FY2025 annual row (no separate Q4 row),
// so the reconciliation is expressed through the implied Q4 = FY - ΣQ1..Q3. Q4 is independently sourced
// from Naver 금융 (2025.12. 지배주주순이익, 억원 -> KRW-M), which also pins the FY total.
const FY2025 = {
  // ticker: { fy: annual attributable netInc, q4: Naver 2025.12 attributable (KRW-M), quarters: [Q1,Q2,Q3] }
  '005930.KS': { fy: 44261000, q4: 19292100 },
  '066570.KS': { fy: 960600, q4: -828200 },
};
for (const [tk, v] of Object.entries(FY2025)) {
  const qs = P.companies[tk].quarters.filter(q => q.end >= '2025-01-01' && q.end <= '2025-12-31');
  const singles = qs.filter(q => q.periodType !== 'annual' && q.cumulative !== true);
  const annual = qs.find(q => q.periodType === 'annual');
  ok(!!annual, `${tk} has a FY2025 annual row`);
  ok(singles.length === 3, `${tk} has the three 2025 single quarters Q1..Q3 (got ${singles.length})`);
  if (!annual || singles.length !== 3) continue;
  ok(annual.netInc === v.fy || approx(annual.netInc, v.fy, 0.001),
    `${tk} FY2025 attributable netInc ≈ ${v.fy} (got ${annual.netInc})`);
  const sum3 = singles.reduce((s, q) => s + q.netInc, 0);
  const impliedQ4 = annual.netInc - sum3;
  ok(approx(impliedQ4, v.q4, 0.001),
    `${tk} FY2025 - Σ(Q1..Q3) = implied Q4 ${impliedQ4} ≈ Naver Q4 ${v.q4} within 0.1%`);
  ok(approx(sum3 + impliedQ4, annual.netInc, 1e-9), `${tk} Σquarters + implied Q4 = FY2025`);
}

// ---- F. mirror is a deep-equal copy (the patch writer keeps data/profit.json.js in sync) ----
ok(JSON.stringify(JSON.parse(MIRROR)) === JSON.stringify(P), 'data/profit.json.js mirror deep-equals data/profit.json');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS (historical netInc corrections)');
process.exit(fails ? 1 : 0);
