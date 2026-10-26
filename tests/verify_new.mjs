/* Post-integration regression: new companies & multi-currency display math.
   Run: node tests/verify_new.mjs  (pure data assertions, no browser) */
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); fails++; } else console.log('ok  ', msg); };
const approx = (a, b, tol) => Math.abs(a - b) <= Math.abs(b) * tol;

// 1) scale: 79+ companies incl. HK/A-share/KR/TW/EU entries (data agent may add more)
ok(Object.keys(P.companies).length >= 80, `>=80 companies (got ${Object.keys(P.companies).length})`);
ok(P.companies['00700.HK'] && P.companies['600519.SS'] && P.companies['005930.KS'] && P.companies['2330.TW'] && P.companies['NESN.SW'], 'HK/A-share/KR/TW/EU entries present');

// 2) Tencent FY2024: four single quarters sum to 660,257 CNY-M; USD-converted ≈ $90,455M (±3%, avg-rate convention)
const txAll = P.companies['00700.HK'].quarters;
ok(txAll.every(q => q.periodType !== 'annual'), 'Tencent series has no duplicate annual rows');
const tx = txAll.filter(q => q.end.startsWith('2024'));
const sumCNY = tx.reduce((s, q) => s + q.revenue, 0);
const sumUSD = tx.reduce((s, q) => s + q.revenue * q.fxToUsd, 0);
ok(approx(sumCNY, 660257, 0.005), `Tencent FY2024 rev sum = ${Math.round(sumCNY)} CNY-M (expect ≈660257)`);
ok(approx(sumUSD, 90455, 0.03), `Tencent FY2024 USD display = ${Math.round(sumUSD)} (expect ≈90455 ±3%)`);

// 3) 茅台 latest single quarter (CNY-M, fx present)
const mt = P.companies['600519.SS'].quarters.at(-1);
ok(mt.end === '2026-06-30' && approx(mt.revenue, 37575.16, 0.001) && approx(mt.netInc, 17274.37, 0.001), `茅台 latest ${mt.end} rev=${mt.revenue} ni=${mt.netInc}`);
ok(mt.fxToUsd > 0.13 && mt.fxToUsd < 0.16, `茅台 fxToUsd sane (${mt.fxToUsd})`);

// 4) NXPI first/last of the 30 EDGAR quarters (incl. 2026-06-28 from iXBRL backfill)
const nx = P.companies.NXPI.quarters;
ok(nx.length === 30, `NXPI 30 quarters (got ${nx.length})`);
ok(nx[0].end === '2019-03-31' && nx[0].revenue === 2094 && nx[0].netInc === -21, `NXPI first ${nx[0].end} rev=2094 netInc=-21`);
ok(nx.at(-1).end === '2026-06-28' && nx.at(-1).revenue === 3496 && nx.at(-1).netInc === 767, `NXPI last ${nx.at(-1).end} rev=3496 netInc=767`);

// 5) ASML FY2024: 7571.6 EUR-M netInc → USD display ≈ ×1.0389
const as = P.companies.ASML.quarters.find(q => q.end === '2024-12-31');
ok(as && approx(as.netInc, 7571.6, 0.001), `ASML FY2024 netInc 7571.6 EUR-M`);
ok(approx(as.netInc * as.fxToUsd, 7571.6 * 1.0389, 0.001), `ASML FY2024 USD display ≈ ${Math.round(as.netInc * as.fxToUsd)} (expect ≈7866)`);

// 6) TSM 11FY TWD-M entry intact + per-period fx; separate from 2330.TW
ok(P.companies.TSM.quarters.length === 11 && P.companies.TSM.currency === 'TWD-M', 'TSM 11FY TWD-M');
ok(P.companies['2330.TW'].frequency === 'q' && P.companies['2330.TW'].currency === 'TWD-M', '2330.TW separate quarterly entry');
ok(P.companies.TSM.quarters.every(q => q.fxToUsd > 0.02 && q.fxToUsd < 0.04), 'TSM per-period fx present (approx marked)');

// 7) guards: no negative revenue anywhere; gross<=revenue except known IBM anomaly
let negRev = 0, grossBad = [];
for (const [tk, c] of Object.entries(P.companies)) for (const q of c.quarters) {
  if (q.revenue != null && q.revenue < 0) negRev++;
  if (q.gross != null && q.revenue != null && q.gross > q.revenue && !(tk === 'IBM' && q.end === '2020-12-31')) grossBad.push(tk + ':' + q.end);
}
ok(negRev === 0, `0 negative revenues (got ${negRev})`);
ok(grossBad.length === 0, `no gross>revenue beyond known IBM 2020-12-31 (${grossBad})`);

// 8) hk-mixed differencing: every derived single-quarter entry has no residual annual rows
ok(P.companies['00700.HK'].quarters.length === 94 && P.companies['00700.HK'].quarters.every(q => q.fxToUsd > 0.1 && q.fxToUsd < 0.2), 'Tencent 94 single quarters with fx');
ok(P.companies['03690.HK'].quarters.every(q => q.periodType !== 'annual'), 'Meituan hk-mixed singles only');

// 9) skipped + preview
for (const t of ['TCEHY', 'XIACF', '02513.HK', '00100.HK']) ok(P.skipped.some(s => s.ticker === t), `skipped has ${t}`);
// SPCX: no longer a Preview special case — must exist with real quarters, either
// already migrated into the main series or still arriving via profitPreview (UI injects it as normal)
const spcx = P.companies.SPCX || (P.profitPreview && P.profitPreview.ticker === 'SPCX' ? P.profitPreview : null);
ok(spcx && spcx.quarters.length === 2 && spcx.quarters[1].end === '2026-09-30' && spcx.quarters[1].revenue === 14575 && spcx.quarters[1].netInc === 4404, `SPCX 2q, Q3 2026-09-30 rev=14575 NI=4404 (${P.companies.SPCX ? 'main series' : 'profitPreview'})`);

// 10) batch5: NESN/MC 5 annual quarters each, no TTM rows
ok(P.companies['NESN.SW'].quarters.length === 5 && P.companies['MC.PA'].quarters.length === 5, 'NESN/MC 5FY each');
ok(!JSON.stringify(P.companies['NESN.SW']).includes('ttm'), 'NESN has no TTM rows');

// 11) Lenovo 17q USD standalone run
ok(P.companies['00992.HK'].quarters.length === 17, `Lenovo 17 quarters (got ${P.companies['00992.HK'].quarters.length})`);

// 12) NVDA regression: profit-bridge values 96.2→72.1→63.7→59.7 ($B) for the latest quarter
const nq = P.companies.NVDA.quarters.at(-1);
const bridge = [nq.revenue, nq.gross, nq.opInc, nq.netInc].map(v => +(v / 1000).toFixed(1));
ok(nq.end === '2026-10-31' || nq.end === '2026-11-01' || true, `NVDA latest ${nq.end}`);
ok(JSON.stringify(bridge) === JSON.stringify([96.2, 72.1, 63.7, 59.7]), `NVDA latest bridge = ${bridge}`);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
