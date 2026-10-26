#!/usr/bin/env node
// backfill_short_history.mjs — 新口径 backfill（用户拍板 2026-10-27）：
// 「有多少正式披露期就入多少，不设最低期数护栏，不做差分硬凑」。
// 入站：02513.HK Z.AI、00100.HK MiniMax、02097.HK 蜜雪、00151.HK 旺旺（batch3 staging，
// 东财 RPT_HKF10_FN_MAININDICATOR，累计口径原样入站）+ 01810.HK 小米（完整季度链，
// 标准累计差分为单季，与既有 HK 条目口径一致；2015/2016 仅年报，保留累计）+
// 09633.HK 农夫山泉（半年报口径 annual+interim 累计）。
// 同时：skipped[] 移除已入站条目、TCEHY/XIACF 理由改为事实性（ADR 非 SEC 注册人，
// 数据已由 00700.HK / 01810.HK 港股条目覆盖）；registry 新增 4 条。
import fs from 'node:fs';
import path from 'node:path';

const W = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const profit = JSON.parse(fs.readFileSync('data/profit.json', 'utf8'));
const registry = JSON.parse(fs.readFileSync('data/companies.json', 'utf8'));
const batch3 = JSON.parse(fs.readFileSync('data/staging/batch3.json', 'utf8'));

const now = new Date().toISOString();
const r3 = (v) => v == null ? null : +(v / 1e6).toFixed(3); // raw local units -> local millions

// ---- fx for newly fetched periods (frankfurter, peg fallback) ----
async function fxRate(date) {
  try {
    const res = await fetch(`https://api.frankfurter.app/${date}?from=CNY&to=USD`);
    const j = await res.json();
    if (j.rates?.USD) return +j.rates.USD.toFixed(5);
  } catch { /* fall through */ }
  return +(1 / 8.2765).toFixed(5); // CNY peg fallback (batch3 convention)
}

// ---- eastmoney fetch for 01810 / 09633 ----
const em = (code) =>
  `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_FN_MAININDICATOR&columns=ALL&filter=(SECUCODE%3D%22${code}.HK%22)&pageNumber=1&pageSize=200&sortTypes=-1&sortColumns=REPORT_DATE&source=F10&client=PC`;
async function fetchHK(code) {
  const res = await fetch(em(code), { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await res.json();
  const rows = j?.result?.data || [];
  fs.mkdirSync('tmp-shorthist', { recursive: true });
  fs.writeFileSync(`tmp-shorthist/hk_raw_${code}.json`, JSON.stringify(rows, null, 1));
  return rows.map(r => ({
    periodEnd: (r.REPORT_DATE || r.STD_REPORT_DATE).slice(0, 10),
    periodType: r.REPORT_TYPE.includes('年报') ? 'annual' : r.REPORT_TYPE.includes('中报') ? 'interim'
      : r.REPORT_TYPE.includes('一季报') ? 'q1' : r.REPORT_TYPE.includes('三季报') ? 'q3' : 'other',
    revenueLocal: r.OPERATE_INCOME, netProfitLocal: r.HOLDER_PROFIT,
  })).filter(x => x.periodType !== 'other' && (x.revenueLocal != null || x.netProfitLocal != null))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

// ---- Xiaomi: standard cumulative differencing where the full chain exists ----
function differenceXiaomi(rows) {
  const byEnd = new Map(rows.map(r => [r.periodEnd, r]));
  const out = [];
  for (const r of rows) {
    const [y, m] = [r.periodEnd.slice(0, 4), r.periodEnd.slice(5, 7)];
    const prevType = { q1: null, interim: 'q1', q3: 'interim', annual: 'q3' }[r.periodType];
    const prev = prevType && byEnd.get(prevEnd(y, prevType, r.periodEnd));
    const rev = prev && r.revenueLocal != null && prev.revenueLocal != null ? r.revenueLocal - prev.revenueLocal
      : (prev ? null : r.revenueLocal);
    const ni = prev && r.netProfitLocal != null && prev.netProfitLocal != null ? r.netProfitLocal - prev.netProfitLocal
      : (prev ? null : r.netProfitLocal);
    const derived = r.periodType === 'q1' ? 'q1' : { interim: 'q2', q3: 'q3', annual: 'q4' }[r.periodType];
    if (prev) {
      if (rev == null || ni == null) { out.push(cumRow(r)); continue; } // 差分不出 → 保留累计原样
      out.push({ end: r.periodEnd, revenue: r3(rev), netInc: r3(ni), periodType: derived, cumulative: undefined });
    } else {
      out.push(cumRow(r)); // 链首（q1 即单季）或仅年报年份 → 累计原样
    }
  }
  return out;
}
function prevEnd(year, type, curEnd) {
  const md = { q1: '03-31', interim: '06-30', q3: '09-30', annual: '12-31' }[type];
  const y = type === 'annual' ? String(+year) : String(+year);
  return `${y}-${md}`;
}
const cumRow = (r) => ({
  end: r.periodEnd, revenue: r3(r.revenueLocal), netInc: r3(r.netProfitLocal),
  periodType: r.periodType, cumulative: true,
});

// ---- staging companies (batch3, cumulative as-disclosed) ----
const stagingRows = (ticker) => batch3.results.find(x => x.ticker === ticker).profit
  .map(p => ({
    end: p.periodEnd, revenue: r3(p.revenueLocal), netInc: r3(p.netProfitLocal),
    periodType: p.periodType, cumulative: true, fxToUsd: p.fxLocalToUsd,
    originalCurrency: p.originalCurrency,
  })).sort((a, b) => a.end.localeCompare(b.end));

const N = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  const entries = {};

  // 02513.HK Z.AI — 7 cumulative periods (annual+interim), 半年报口径，不可差分
  entries['02513.HK'] = {
    name: 'Z.AI', currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: stagingRows('02513.HK'),
    notes: N(`HKEX filer, IPO 2026-03 (上市时间短): only annual + interim (H1) cumulative disclosures available, 0 single quarters derivable — included as-disclosed cumulative series per short-history rule (SPCX 2-period exemption precedent), periodType interim/annual, NOT differenced. 7 periods 2022-12-31..2026-06-30. Source: eastmoney RPT_HKF10_FN_MAININDICATOR via batch3 staging (data/staging/batch3.json). Watchlist ticker 2513.HK.`),
  };

  // 00100.HK MiniMax — 8 cumulative periods, 2022 revenue 未披露 null
  entries['00100.HK'] = {
    name: 'MiniMax', currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: stagingRows('00100.HK'),
    notes: N(`HKEX filer MINIMAX-W, IPO 2026-01 (上市时间短): annual + interim + Q3 cumulative disclosures, 8 periods 2022-12-31..2026-06-30 included as-disclosed cumulative series per short-history rule (no minKeep guardrail), NOT differenced. 2022-12-31 revenue not disclosed (null). Source: eastmoney RPT_HKF10_FN_MAININDICATOR (code normalization 0100→00100) via batch3 staging. Watchlist ticker 0100.HK.`),
  };

  // 02097.HK 蜜雪 — 11 cumulative periods
  entries['02097.HK'] = {
    name: 'Mixue', currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: stagingRows('02097.HK'),
    notes: N(`HKEX filer 蜜雪集团 Mixue Group, IPO 2025-03: annual + interim + Q3 cumulative disclosures, 11 periods 2021-12-31..2026-06-30 included as-disclosed cumulative series (no differencing forced), NOT differenced. 2025 起仅披露中期+年报（三季报停披，末次 2024-09-30）. Source: eastmoney RPT_HKF10_FN_MAININDICATOR via batch3 staging. Watchlist ticker 2097.HK.`),
  };

  // 00151.HK 旺旺 — 44 cumulative periods (registry entry existed, profit data was missing)
  entries['00151.HK'] = {
    name: 'Want Want China', currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: stagingRows('00151.HK'),
    notes: N(`HKEX filer 中国旺旺 Want Want China (TW-origin, reports in RMB): annual + interim + sparse Q3 cumulative disclosures, 44 periods 2004-12-31..2025-12-31 included as-disclosed cumulative series, NOT differenced. Q3 (9M cumulative) discontinued after 2017-09-30. Early fiscal years originally reported in USD (originalCurrency flag). eastmoney REPORT_DATE off-by-one for 00151 corrected via STD_REPORT_DATE. Source: eastmoney RPT_HKF10_FN_MAININDICATOR via batch3 staging. Watchlist ticker 0151.HK.`),
  };

  // 09633.HK 农夫山泉 — semi-annual reporter, 17 cumulative periods
  const nf = await fetchHK('09633');
  const nfRows = [];
  for (const r of nf) { nfRows.push({ ...cumRow(r), fxToUsd: await fxRate(r.periodEnd) }); }
  entries['09633.HK'] = {
    name: 'Nongfu Spring', currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: nfRows,
    notes: N(`HKEX filer 农夫山泉 Nongfu Spring: semi-annual reporter — annual + interim (H1) cumulative disclosures only, 17 periods 2017-12-31..2026-06-30 included as-disclosed cumulative series (半年报口径，不做差分硬凑), NOT differenced. Source: eastmoney RPT_HKF10_FN_MAININDICATOR (fetched 2026-10-27). fx: frankfurter CNY→USD per period end, peg fallback 1/8.2765. Watchlist ticker 9633.HK.`),
  };

  // 01810.HK 小米 — full quarterly chain differenced to single quarters + annual-only 2015/2016
  const mi = await fetchHK('01810');
  const miDiff = differenceXiaomi(mi);
  const miRows = miDiff;
  for (const q of miRows) q.fxToUsd = await fxRate(q.end);
  entries['01810.HK'] = {
    name: 'Xiaomi', currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: miRows.sort((a, b) => a.end.localeCompare(b.end)),
    notes: N(`HKEX filer 小米集团 Xiaomi Corporation (watchlist ticker XIACF = OTC ADR, absent from EDGAR with no financial filings — data via HK listing): full quarterly cumulative disclosure chain from 2017-03-31, differenced to single quarters (q1..q4, same convention as other hk-mixed entries); 2015/2016 annual-only disclosures kept as-disclosed cumulative annual periods. Latest 2026-06-30. Source: eastmoney RPT_HKF10_FN_MAININDICATOR (fetched 2026-10-27). fx: frankfurter CNY→USD per period end, peg fallback 1/8.2765.`),
  };

  // ---- merge ----
  for (const [t, e] of Object.entries(entries)) {
    if (profit.companies[t]) throw new Error('entry already exists: ' + t);
    profit.companies[t] = e;
    console.log('merged', t, e.quarters.length, 'periods', e.quarters[0].end, '..', e.quarters.at(-1).end);
  }

  // ---- skipped[] re-audit ----
  const removeSkipped = new Set(['02513.HK', '00100.HK', '09633.HK', 'XIACF']);
  profit.skipped = profit.skipped.filter(s => !removeSkipped.has(s.ticker));
  const tcehy = profit.skipped.find(s => s.ticker === 'TCEHY');
  if (tcehy) tcehy.reason += ' RE-AUDITED 2026-10-27 under short-history rule: factual reason stands (OTC ADR, not an SEC registrant, no EDGAR financials); data fully covered by 00700.HK HKEX entry (94 quarters).';
  profit.skipped.push({
    ticker: 'XIACF',
    status: 'skipped',
    reason: 'RE-AUDITED 2026-10-27: factual reason stands (XIACF ADR maps to CIK 1748830, filings F-6EF/F-6 POS only, no 10-K/20-F/10-Q); financial data now included via 01810.HK entry — skip retained only as watchlist-ticker alias note.',
  });

  // ---- global notes ----
  profit.notes.push(`01810.HK/09633.HK/02513.HK/00100.HK/02097.HK/00151.HK: short-history rule backfill 2026-10-27 (用户拍板「有多少正式披露期就入多少，不设最低期数」) — cumulative HK disclosures included as-disclosed (cumulative:true) where differencing not possible; Xiaomi 01810 full chain differenced to single quarters.`);

  profit.updated = now;
  W('data/profit.json', profit);
  fs.writeFileSync('data/profit.json.js', 'window.__PROFIT_DATA = ' + JSON.stringify(profit) + ';\n');

  // ---- registry additions ----
  const add = [
    { ticker: '00100.HK', nameZh: 'MiniMax', nameEn: 'MiniMax Group', color: '#e91e63', frequency: 'hk-mixed' },
    { ticker: '01810.HK', nameZh: '小米集团', nameEn: 'Xiaomi', color: '#ff6900', frequency: 'hk-mixed' },
    { ticker: '02513.HK', nameZh: '智谱', nameEn: 'Z.AI', color: '#3f51b5', frequency: 'hk-mixed' },
    { ticker: '09633.HK', nameZh: '农夫山泉', nameEn: 'Nongfu Spring', color: '#2e7d32', frequency: 'hk-mixed' },
  ];
  for (const c of add) {
    if (registry.some(r => r.ticker === c.ticker)) continue;
    registry.push(c);
    console.log('registry +', c.ticker);
  }
  registry.sort((a, b) => a.ticker.localeCompare(b.ticker));
  W('data/companies.json', registry);
  console.log('done');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
