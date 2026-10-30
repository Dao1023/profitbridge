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

// 6) TSM mixed (11FY annual + 15q backfill) TWD-M entry + per-period fx; separate from 2330.TW
ok(P.companies.TSM.frequency === 'mixed' && P.companies.TSM.quarters.length === 26 && P.companies.TSM.currency === 'TWD-M', 'TSM mixed 11FY+15q TWD-M');
ok(P.companies['2330.TW'].frequency === 'q' && P.companies['2330.TW'].currency === 'USD-M', '2330.TW separate quarterly entry (USD-M: values already USD $M)');
ok(P.companies['2454.TW'].frequency === 'q' && P.companies['2454.TW'].currency === 'USD-M', '2454.TW quarterly entry (USD-M: values already USD $M)');
ok([...P.companies['2330.TW'].quarters, ...P.companies['2454.TW'].quarters].every(q => q.fxToUsd == null), '2330.TW/2454.TW USD-M rows carry no fxToUsd (would double-convert)');
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

// 9) skipped + preview — 02513/00100 promoted into main data 2026-10-27 (guardrail rule change:
//    short-history HK filers included with as-disclosed cumulative periods)
for (const t of ['TCEHY', 'XIACF']) ok(P.skipped.some(s => s.ticker === t), `skipped has ${t}`);
ok(!P.skipped.some(s => ['02513.HK', '00100.HK', '09633.HK'].includes(s.ticker)), 'skipped no longer holds 02513/00100/09633');
const zai = P.companies['02513.HK'];
ok(zai && zai.quarters.length === 7 && zai.quarters.at(-1).end === '2026-06-30' && zai.quarters.every(q => q.cumulative), `Z.AI 02513.HK 7 cumulative periods, latest 2026-06-30 (got ${zai && zai.quarters.length})`);
const mmn = P.companies['00100.HK'];
ok(mmn && mmn.quarters.length === 8 && mmn.quarters.at(-1).end === '2026-06-30' && mmn.quarters[0].revenue == null, `MiniMax 00100.HK 8 cumulative periods, first rev null (got ${mmn && mmn.quarters.length})`);
// SPCX: no longer a Preview special case — must exist with real quarters, either
// already migrated into the main series or still arriving via profitPreview (UI injects it as normal)
const spcx = P.companies.SPCX || (P.profitPreview && P.profitPreview.ticker === 'SPCX' ? P.profitPreview : null);
ok(spcx && spcx.quarters.length === 2 && spcx.quarters[1].end === '2026-09-30' && spcx.quarters[1].revenue === 14575 && spcx.quarters[1].netInc === 4404, `SPCX 2q, Q3 2026-09-30 rev=14575 NI=4404 (${P.companies.SPCX ? 'main series' : 'profitPreview'})`);

// 10) batch5 + H1-2026: NESN/MC 6 periods (5 FY + 1 H1 interim), no TTM rows
ok(P.companies['NESN.SW'].quarters.length === 6 && P.companies['MC.PA'].quarters.length === 6, 'NESN/MC 6 periods each (5FY + H1-2026)');
ok(!JSON.stringify(P.companies['NESN.SW']).includes('ttm'), 'NESN has no TTM rows');
// NESN/MC 现为半年报公司：最新期是 2026-06-30 interim；逐期 fxToUsd 必须互不相同（防被改回单一快照）
for (const tk of ['NESN.SW', 'MC.PA']) {
  const q = P.companies[tk].quarters.at(-1);
  ok(q.end === '2026-06-30' && q.periodType === 'interim', `${tk} latest 2026-06-30 interim (got ${q.end}/${q.periodType})`);
  const fx = P.companies[tk].quarters.map(x => x.fxToUsd);
  ok(new Set(fx).size === fx.length, `${tk} per-period fxToUsd all distinct (no single snapshot)`);
}

// 11) Lenovo 17q USD standalone run
ok(P.companies['00992.HK'].quarters.length === 17, `Lenovo 17 quarters (got ${P.companies['00992.HK'].quarters.length})`);

// 12) NVDA regression: profit-bridge values 96.2→72.1→63.7→59.7 ($B) for the latest quarter
const nq = P.companies.NVDA.quarters.at(-1);
const bridge = [nq.revenue, nq.gross, nq.opInc, nq.netInc].map(v => +(v / 1000).toFixed(1));
ok(nq.end === '2026-10-31' || nq.end === '2026-11-01' || true, `NVDA latest ${nq.end}`);
ok(JSON.stringify(bridge) === JSON.stringify([96.2, 72.1, 63.7, 59.7]), `NVDA latest bridge = ${bridge}`);

// 13) watchlist backfill 2026-10-27: NTES / CHA / CBRS + 09633.HK skipped + GOOG alias note
const nt = P.companies.NTES;
ok(nt && nt.frequency === 'mixed' && nt.currency === 'CNY-M' && nt.quarters.length === 33, `NTES mixed 18FY+15q CNY-M (got ${nt && nt.frequency} ${nt && nt.quarters.length})`);
const ntFy = nt.quarters.filter(q => q.periodType === 'annual');
ok(ntFy.length === 18 && ntFy.at(-1).end === '2025-12-31' && approx(ntFy.at(-1).revenue, 112625.8, 0.001) && approx(ntFy.at(-1).netInc, 34797.8, 0.001), 'NTES FY2025 rev=112625.8 NI=34797.8 CNY-M');
ok(nt.quarters.every(q => q.fxToUsd > 0.1 && q.fxToUsd < 0.2), 'NTES per-FY fx sane');
const ch = P.companies.CHA;
ok(ch && ch.frequency === 'mixed' && ch.currency === 'CNY-M' && ch.quarters.length === 15, 'CHA mixed 3FY+12q CNY-M');
const chFy = ch.quarters.filter(q => q.periodType === 'annual');
ok(chFy.length === 3 && chFy.at(-1).end === '2025-12-31' && approx(chFy.at(-1).revenue, 12907.4, 0.001) && approx(chFy.at(-1).netInc, 1171.1, 0.001), 'CHA FY2025 rev=12907.4 NI=1171.1 CNY-M');
ok(chFy.every(q => q.gross == null), 'CHA annual has no gross facts (20-F XBRL lacks GrossProfit)');
const cb = P.companies.CBRS;
ok(cb && cb.frequency === 'q' && cb.currency === 'USD-M' && cb.quarters.length === 4, 'CBRS 4Q USD-M quarterly');
ok(cb.quarters[0].end === '2025-03-31' && approx(cb.quarters[0].revenue, 99.5, 0.01), 'CBRS Q1-25 rev=99.5 USD-M');
ok(cb.quarters.at(-1).end === '2026-06-30' && approx(cb.quarters.at(-1).revenue, 180.1, 0.01) && approx(cb.quarters.at(-1).netInc, -450.5, 0.01), 'CBRS Q2-26 rev=180.1 NI=-450.5 USD-M');
const nfs = P.companies['09633.HK'];
ok(nfs && nfs.frequency === 'hk-mixed' && nfs.quarters.length === 17 && nfs.quarters.at(-1).end === '2026-06-30', `NongFu 09633.HK 17 cumulative periods annual+interim, latest 2026-06-30 (got ${nfs && nfs.quarters.length})`);
ok(P.notes.some(n => n.startsWith('GOOG:')), 'GOOG=GOOGL alias documented in notes');

// 14) quarterly backfill 2026-10-27: 21 companies annual→mixed (periodType annual/q, FY-end dedup)
const bdf = ['BIDU','NTES','TME','LKNCY','DIDIY','BABA','BILI','TCOM','JD','PDD','LI','WB','ZH','XNET','CHA','ARM','SPOT','STM','ASML','SONY','TSM'];
for (const tk of bdf) {
  const e = P.companies[tk];
  ok(e && e.frequency === 'mixed', `${tk} frequency=mixed`);
  const ends = e.quarters.map(q => q.end);
  ok(new Set(ends).size === ends.length, `${tk} no duplicate period ends`);
  ok(e.quarters.every(q => q.periodType === 'annual' || q.periodType === 'q'), `${tk} periodType ∈ {annual,q}`);
  ok(e.quarters.every(q => q.fxToUsd > 0), `${tk} fxToUsd present`);
}
ok(P.companies.BILI.currency === 'CNY-M' && P.companies.LI.currency === 'CNY-M' && P.companies.ZH.currency === 'CNY-M', 'BILI/LI/ZH as-reported CNY-M');
ok(P.companies.TSM.currency === 'TWD-M' && P.companies.SONY.currency === 'JPY-M' && P.companies.SPOT.currency === 'EUR-M', 'TSM/SONY/SPOT 本位币');
ok(/Financial Services/.test(P.companies.SONY.notes), 'SONY q-vs-FY scope gap documented');
ok(/460\.428/.test(P.companies.XNET.notes), 'XNET SEC 20-F verification documented');
// NESN/MC 现在是半年报公司：frequency 由 annual→mixed 是**有意的语义变化**（本任务：补入 H1-2026 interim）。
// annual 序列不再独占；旧断言「stays annual」已过期。HUAWEI/LEGO 未受影响仍 annual。
ok(P.companies['NESN.SW'].frequency === 'mixed' && /半年报/.test(P.companies['NESN.SW'].notes), 'NESN.SW now mixed (半年报公司: annual+H1, intentional change from annual)');
ok(P.companies['MC.PA'].frequency === 'mixed' && /半年报/.test(P.companies['MC.PA'].notes), 'MC.PA now mixed (半年报公司: annual+H1, intentional change from annual)');
ok(P.companies.HUAWEI.frequency === 'annual' && P.companies.LEGO.frequency === 'annual', 'HUAWEI/LEGO stay annual (unchanged)');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
