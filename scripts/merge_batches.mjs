// Integration-layer merge: staging batch1-6 -> data/profit.json + data/companies.json
//
// 使用边界 (READ BEFORE RUNNING):
//   * 本脚本**不是**全量重建: 它加载磁盘上现有的 data/profit.json, 仅覆写 staging batch 覆盖到的
//     ticker, 其余条目(含所有事后手工修复)原样保留。因此磁盘上的手工修复只要未被 staging 反噬就是安全的。
//   * 安全护栏(2026-10-29 加入): 写盘前会把合并结果与磁盘原版做逐条目语义对比(公司数/期数/币种/
//     期型/逐期数值), 任何"回滚"(丢条目、丢期、币种或期型变更、已有期数值变化)都会导致 **exit 1 且不写盘**,
//     并打印差异摘要。确属有意的重新刷数时用 `--force`(或 FORCE=1)显式放行。
//   * 用法: `node scripts/merge_batches.mjs --dry` 先看报告(DRY=1 等价), 确认无误后再不带参数运行。
//   * 只写 data/profit.json / data/companies.json / tmp-merge/merge_report.json; **从不修改 data/staging/**。
//   * 历史: batch5 时代曾为纯重建脚本, 后来全部手工修复(IBM/ARM/SONY 币种与期型、ADR +15q、
//     mixed 合并、桃李面包 batch6 等)已反写进 data/staging/(batch*.json 更新 + 新增
//     data/staging/fixups.json 权威修复层), 经逐条目 diff 验证重跑结果与磁盘修复版零差异。
//     若未来再出现差异, 以磁盘版本为准、把修复反写进 staging/fixups.json, 而不是用 --force 硬压。
//
// Does NOT modify data/staging/* originals. Idempotent: rebuilds merged entries from staging each run.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const R = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const W = (p, o) => { const s = JSON.stringify(o, null, 2) + '\n'; fs.writeFileSync(path.join(ROOT, p), s); };

const profit = R('data/profit.json');
// safety net: snapshot of the on-disk state BEFORE any mutation, for the pre-write regression guard
const diskSnapshot = JSON.parse(JSON.stringify(profit.companies));
const diskRegistryCount = R('data/companies.json').length;
// stale-disk detector: 本脚本以磁盘 profit.json 为基准, 无法自救一个已经回滚的工作副本。
// 这里额外对照 git HEAD 的总期数, 若磁盘比 HEAD 少则大声告警(先 git checkout 恢复, 再跑合并)。
try {
  const { execSync } = await import('node:child_process');
  const headP = JSON.parse(execSync('git show HEAD:data/profit.json', { cwd: ROOT, maxBuffer: 1 << 28 }).toString());
  const tq = (p) => Object.values(p.companies || {}).reduce((s, e) => s + (e.quarters || []).length, 0);
  if (tq(headP) > tq(profit)) {
    const msg = `DISK STALE vs git HEAD: on-disk profit.json has ${tq(profit)} periods but git HEAD has ${tq(headP)}. The working copy looks rolled back — run \`git checkout -- data/profit.json data/companies.json\` BEFORE merging.`;
    console.error('WARNING: ' + msg); warn.push(msg);
  }
} catch { /* git unavailable or no HEAD yet: skip */ }
// authoritative fixup layer (entries + top-level meta snapshot), see data/staging/fixups.json
const FIXUPS = R('data/staging/fixups.json');
const registry = R('data/companies.json');
const b2 = R('data/staging/batch2.json');
const b3 = R('data/staging/batch3.json');
const b4 = R('data/staging/batch4.json');
const b6 = R('data/staging/batch6.json');
const b5 = R('data/staging/batch5.json');
const b1 = R('data/staging/batch1.json');

const log = [], warn = [];
const notesNew = [];
const report = { replacements: [], added: [], fx: {}, skipped: [], warnings: warn };

// ---------- fx cache (frankfurter.app) ----------
const fxCachePath = path.join(ROOT, 'tmp-merge', 'fx_cache.json');
fs.mkdirSync(path.dirname(fxCachePath), { recursive: true });
let fxCache = fs.existsSync(fxCachePath) ? JSON.parse(fs.readFileSync(fxCachePath, 'utf8')) : {};
async function frankfurter(cur, date) {
  const key = `${cur}:${date}`;
  if (fxCache[key]) return fxCache[key];
  let rate, actual = date;
  try {
    const url = `https://api.frankfurter.app/${date}?from=${cur}&to=USD`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ProfitBridgeDashboard research contact@example.com' } });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    rate = j.rates && j.rates.USD; actual = j.date || date;
  } catch (e) {
    // fallback: fawazahmed0 currency-api (covers TWD etc.)
    const u2 = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`;
    const r2 = await fetch(u2);
    if (!r2.ok) throw new Error(`no fx source for ${cur} @ ${date} (${e.message}/${r2.status})`);
    const j2 = await r2.json();
    const perUsd = j2.date ? j2.usd : j2.usd;
    if (!perUsd || !perUsd[cur.toLowerCase()]) throw new Error(`currency-api lacks ${cur} @ ${date}`);
    rate = 1 / perUsd[cur.toLowerCase()]; // USD per 1 unit of cur
    actual = j2.date || date;
  }
  if (!rate) throw new Error(`no USD rate for ${cur} @ ${date}`);
  fxCache[key] = { rate, actual };
  return fxCache[key];
}
async function attachFx(entry, cur) {
  let misses = 0;
  for (const q of entry.quarters) {
    try {
      const { rate, actual } = await frankfurter(cur, q.end);
      q.fxToUsd = Math.round(rate * 1e8) / 1e8;
      q.fxDate = actual;
    } catch (e) { misses++; warn.push(`fx miss ${entry.__tk} ${cur} ${q.end}: ${e.message}`); }
  }
  return misses;
}

// ---------- batch1: CRWV ----------
{
  const crwv = b1.results.find(r => r.ticker === 'CRWV');
  const per = crwv.profit.periods;
  profit.companies.CRWV = {
    name: crwv.name || 'CoreWeave', cik: crwv.cik, currency: 'USD-M', frequency: 'q',
    quarters: per.map(q => ({ ...q }))
  };
  notesNew.push('CRWV: merged with staging-minKeep=8 relaxation (10 continuous quarterly periods < legacy 12 floor)');
  report.replacements.push({ ticker: 'CRWV', action: 'added', n: per.length });
}

// ---------- batch2: annual replacements / additions ----------
const b2ByTk = Object.fromEntries(b2.results.map(r => [r.ticker, r]));
const replaceAnnual = ['BABA', 'BIDU', 'TCOM', 'JD', 'PDD', 'LKNCY', 'TSM', 'DIDIY'];
for (const tk of replaceAnnual) {
  const r = b2ByTk[tk];
  if (!r || !r.profit) { warn.push(`batch2 ${tk} missing`); continue; }
  const s = r.profit.series;
  const cur = r.profit.currency;
  const entry = profit.companies[tk] || {};
  const prevNote = profit.companies[tk]
    ? `replaced prior entry (${entry.currency || 'USD-M'}, ${entry.quarters.length} periods)`
    : 'new entry';
  profit.companies[tk] = {
    name: entry.name || r.name, cik: entry.cik || r.cik, currency: cur, frequency: 'annual',
    quarters: s.map(q => ({ ...q }))
  };
  notesNew.push(`${tk}: ${prevNote}; now 20-F as-reported ${cur} (${s.length} FY, ${s[0].end}..${s.at(-1).end})`);
  report.replacements.push({ ticker: tk, action: profit.companies[tk] ? 'replaced' : 'added', n: s.length, cur });
  if (tk === 'TSM') {
    notesNew.push('TSM: 20-F 10FY TWD-M supersedes legacy 8FY USD-M; Taiwan-listed 2330.TW quarterly kept as a separate entry (口径互见, 禁跨条目环比).');
  }
}
// SPCX -> profitPreview (kept out of main series)
{
  const sp = b2ByTk['SPCX'];
  profit.profitPreview = {
    ticker: 'SPCX', name: sp.name || 'SpaceX', currency: 'USD-M', frequency: 'q',
    status: 'preview (private; NOT in main series)',
    quarters: (sp.profitPreview.series || sp.profitPreview).map ? sp.profitPreview.series || sp.profitPreview : sp.profitPreview,
  };
  // normalize: profitPreview may be {series:[...]} already
  if (Array.isArray(profit.profitPreview.quarters) === false) {
    const pv = sp.profitPreview;
    profit.profitPreview.quarters = pv.series || pv.quarters || (Array.isArray(pv) ? pv : []);
  }
  delete profit.profitPreview.series;
  notesNew.push('SPCX: private-company preview kept in profitPreview (logo rail shows badge), excluded from main series.');
}

// ---------- batch3: HK + KR ----------
const NAME3 = {
  '00700.HK': ['腾讯控股', 'Tencent'], '00941.HK': ['中国移动', 'China Mobile'], '01398.HK': ['工商银行', 'ICBC'],
  '03968.HK': ['招商银行', 'China Merchants Bank'], '00992.HK': ['联想集团', 'Lenovo'], '03690.HK': ['美团', 'Meituan'],
  '00728.HK': ['中国电信', 'China Telecom'], '00981.HK': ['中芯国际', 'SMIC'], '00762.HK': ['中国联通', 'China Unicom'],
  '01024.HK': ['快手', 'Kuaishou'], '02097.HK': ['蜜雪集团', 'Mixue'], '00100.HK': ['MiniMax', 'MiniMax'],
  '03888.HK': ['金山软件', 'Kingsoft'], '00151.HK': ['中国旺旺', 'Want Want'], '02513.HK': ['Z.AI', 'Z.AI'],
  '005930.KS': ['三星电子', 'Samsung Electronics'], '000660.KS': ['SK海力士', 'SK hynix'], '066570.KS': ['LG电子', 'LG Electronics'],
};
const DAY = 864e5;
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

function diffHK(rows, tk) {
  // HK rows carry RAW local units; convert to millions (/1e6). Negative derived netInc = real loss, kept.
  const M = 1e6;
  const ni = (r) => (r.netProfitLocal != null ? r.netProfitLocal : r.niToCommonLocal);
  const clean = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.excluded || r.revenueLocal == null) continue;
    const k = r.periodEnd + '|' + r.periodType;
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push(r);
  }
  clean.sort((a, b) => a.periodEnd < b.periodEnd ? -1 : 1);
  const findPrev = (row, type) => clean.find(r => r.periodType === type && ni(r) != null && days(r.periodEnd, row.periodEnd) > 60 && days(r.periodEnd, row.periodEnd) < 130);
  const out = [], negRev = [];
  const pushQ = (end, pt, rev, niV, fx) => {
    if (rev == null || niV == null) return;
    rev /= M; niV /= M;
    if (rev < 0) { negRev.push(end + ' ' + pt + ' rev=' + rev); out.push({ end, revenue: null, netInc: null, periodType: pt, fxToUsd: fx }); return; }
    out.push({ end, revenue: rev, netInc: niV, periodType: pt, fxToUsd: fx });
  };
  for (const r of clean) {
    const fx = r.fxLocalToUsd;
    if (r.periodType === 'q1') pushQ(r.periodEnd, 'q1', r.revenueLocal, ni(r), fx);
    else if (r.periodType === 'interim') {
      const q1 = findPrev(r, 'q1');
      if (q1) pushQ(r.periodEnd, 'q2', r.revenueLocal - q1.revenueLocal, ni(r) - ni(q1), fx);
    } else if (r.periodType === 'q3') {
      const it = findPrev(r, 'interim');
      if (it) pushQ(r.periodEnd, 'q3', r.revenueLocal - it.revenueLocal, ni(r) - ni(it), fx);
    } else if (r.periodType === 'annual') {
      const q3 = findPrev(r, 'q3');
      if (q3) pushQ(r.periodEnd, 'q4', r.revenueLocal - q3.revenueLocal, ni(r) - ni(q3), fx);
    }
  }
  for (const r of clean) {
    if (r.periodType === 'annual') out.push({ end: r.periodEnd, revenue: r.revenueLocal / M, netInc: ni(r) != null ? ni(r) / M : null, periodType: 'annual', fxToUsd: r.fxLocalToUsd });
  }
  out.sort((a, b) => a.end < b.end ? -1 : 1);
  // trim to longest continuous single-quarter run (gap<=110d); keep annual rows within window
  const sq = out.filter(q => q.periodType !== 'annual');
  let best = [], run = [];
  for (let i = 0; i < sq.length; i++) {
    if (i === 0 || days(sq[i - 1].end, sq[i].end) <= 110) run.push(sq[i]);
    else run = [sq[i]];
    if (run.length > best.length) best = run;
  }
  const cut = best.length >= 8 ? best[0].end : null;
  // drop annual rows entirely: Q4 already derives from FY, so the annual row duplicates
  // the Q4 end-date and would double-count under quarter indexing (bridge/bars/tests)
  const noAnn = out.filter(q => q.periodType !== 'annual');
  if (negRev.length) warn.push(tk + ': ' + negRev.length + ' derived quarter(s) negative revenue -> null (' + negRev[0] + '...)');
  return { qs: cut ? noAnn.filter(q => q.end >= cut) : noAnn, cut };
}

for (const r of b3.results) {
  const tk = r.ticker;
  const rows = Array.isArray(r.profit) ? r.profit : r.profit.rows;
  const [zh, en] = NAME3[tk] || [r.name, r.name];
  if (tk === '00992.HK') { // Lenovo: USD standalone + FQ4 derivation
    const standalone = new Map(); // periodEnd -> {pt, rev, ni}
    for (const row of rows) {
      const o = row.originalUsdQuarterlyStandalone;
      if (o) standalone.set(row.periodEnd, { pt: row.periodType === 'q3' ? 'q3' : (row.periodType === 'interim' ? 'q2' : 'q1'), rev: o.revenueUsdM, ni: o.niToCommonUsdM });
    }
    const annuals = rows.filter(x => x.periodType === 'annual' && x.originalUsd);
    for (const a of annuals) {
      const parts = [...standalone.entries()].filter(([end, v]) => v && v.pt !== 'q4' && v.rev != null && v.ni != null && ['06', '09', '12'].includes(end.slice(5, 7)) && days(end, a.periodEnd) > 60 && days(end, a.periodEnd) < 300);
      if (parts.length === 3) {
        const rev = a.originalUsd.revenueUsdM - parts.reduce((s, [, v]) => s + v.rev, 0);
        const ni = a.originalUsd.niToCommonUsdM - parts.reduce((s, [, v]) => s + v.ni, 0);
        standalone.set(a.periodEnd, { pt: 'q4', rev, ni });
        if (rev < 0 || ni < 0) warn.push(`00992.HK FQ4 ${a.periodEnd} negative (${rev}/${ni}) -> keep as filed-derived, flag`);
      }
    }
    const qs = [...standalone.entries()].map(([end, v]) => ({ end, revenue: v.rev, netInc: v.ni, periodType: v.pt }))
      .filter(q => q.revenue != null).sort((x, y) => x.end < y.end ? -1 : 1);
    // longest continuous run with gaps 80-105d
    let best = [];
    let run = [];
    for (let i = 0; i < qs.length; i++) {
      if (i === 0 || (days(qs[i - 1].end, qs[i].end) >= 80 && days(qs[i - 1].end, qs[i].end) <= 105)) run.push(qs[i]);
      else run = [qs[i]];
      if (run.length > best.length) best = run;
    }
    profit.companies[tk] = {
      name: en, nameZh: zh, currency: 'USD-M', frequency: 'hk-mixed',
      quarters: best.map(q => ({ ...q })),
      notes: 'Fiscal-year Mar; single quarters from EDGAR 20-F USD standalone disclosures; FQ4 = FY − (Q1+Q2+Q3) derived; series truncated to longest 80–105d continuous run (2022-06-30..2026-06-30).'
    };
    report.added.push({ ticker: tk, n: best.length, market: 'HK (USD standalone)' });
    continue;
  }
  if (tk.endsWith('.KS')) { // KR standalone rows
    const qs = rows.filter(x => !x.excluded).map(x => ({
      end: x.periodEnd, revenue: x.revenueLocal, netInc: x.netProfitLocal ?? x.niToCommonLocal,
      periodType: x.periodType, fxToUsd: x.fxLocalToUsd
    })).sort((a, b) => a.end < b.end ? -1 : 1);
    profit.companies[tk] = {
      name: en, nameZh: zh, currency: 'KRW-M', frequency: 'mixed',
      quarters: qs, notes: 'Korean disclosure: standalone Q1/Q3 + FY (no cumulative H1); Q2/Q4 not separately disclosed — as-filed rows only, no differencing possible.'
    };
    report.added.push({ ticker: tk, n: qs.length, market: 'KR' });
    continue;
  }
  // normal HK
  const { qs, cut } = diffHK(rows, tk);
  const nQ = qs.filter(q => q.periodType !== 'annual' && q.revenue != null).length;
  if (nQ < 8) {
    report.skipped.push({ ticker: tk, reason: `only ${nQ} single quarters derivable from cumulative HKEX disclosures (< staging minKeep 8)` });
    continue;
  }
  profit.companies[tk] = {
    name: en, nameZh: zh, currency: 'CNY-M', frequency: 'hk-mixed',
    quarters: qs,
    notes: (cut ? ('single-quarter series trimmed to continuous run from ' + cut + '; ') : '') + 'HKEX cumulative periods differenced to single quarters at integration (Q2=H1−Q1, Q3=9M−H1, Q4=FY−9M); periodType tags q1–q4/annual; bars render single quarters only; 环比 restricted to adjacent ≤100d periods.'
  };
  report.added.push({ ticker: tk, n: nQ, market: 'HK' });
}

// ---------- batch4: A-share ----------
const COL4 = { '600519.SS': '#c62828', '300750.SZ': '#37474f', '002594.SZ': '#1565c0', '688256.SS': '#00695c', '688795.SS': '#6a1b9a', '002415.SZ': '#ef6c00', '000063.SZ': '#283593', '000333.SZ': '#2e7d32', '000100.SZ': '#7b1fa2', '601360.SS': '#d84315', '688825.SS': '#00838f', '600887.SS': '#f9a825', '688981.SS': '#455a64' };
for (const r of b4.results) {
  const qs = (r.profit.quarters || []).filter(q => q.derivation === 'direct' || q.derivation === 'diff').map(q => ({
    end: q.reportDate, revenue: q.revenue_cny_m, netInc: q.netprofit_parent_cny_m,
    periodType: 'q', fxToUsd: Math.round((1 / q.fx_cny_per_usd) * 1e8) / 1e8, derivation: q.derivation
  })).sort((a, b) => a.end < b.end ? -1 : 1);
  const zh = (r.name || '').split(/\s+/)[0];
  profit.companies[r.ticker] = {
    name: r.name, currency: 'CNY-M', frequency: 'q',
    quarters: qs, notes: 'CSMAR/东财 A股真实单季 (direct/diff rows only); revenue+归母净利; fxToUsd per period (1/fx_cny_per_usd).'
  };
  report.added.push({ ticker: r.ticker, n: qs.length, market: 'A-share' });
}

// ---------- batch6: 桃李面包 (603866.SH) ----------
{
  const r = b6.results[0];
  const qs = r.profit.quarters.map(q => ({
    end: q.reportDate, revenue: q.revenue_cny_m, netInc: q.netprofit_parent_cny_m,
    periodType: 'q', fxToUsd: Math.round((1 / q.fx_cny_per_usd) * 1e8) / 1e8, derivation: q.derivation
  }));
  profit.companies[r.ticker] = {
    name: r.name, currency: 'CNY-M', frequency: 'q',
    quarters: qs, notes: '东财 A股真实单季 (direct/diff only); revenue+归母净利; fxToUsd per period (1/fx_cny_per_usd). 2014Q4=FY−9M; 上市前 2011–2015Q3 报告期为招股书回填, 仅 2014Q4 起连续单季入池 (2014Q1 孤立/2014Q3 跨两季不入).'
  };
  report.added.push({ ticker: r.ticker, n: qs.length, market: 'A-share' });
}

// ---------- batch5 ----------
for (const key of ['NESN.SW', 'MC.PA']) {
  const r = b5.results.find(x => x.ticker === key);
  const p = r.profit;
  const cur = key === 'NESN.SW' ? 'CHF-M' : 'EUR-M';
  const fxPerCur = key === 'NESN.SW' ? 1 / 0.824578 : 1 / 0.89213; // USD per 1 unit of local currency
  profit.companies[key] = {
    name: r.name, currency: cur, frequency: 'annual',
    quarters: p.annual.map(a => ({ end: `${a.fy}-12-31`, revenue: a.revenue, gross: a.grossProfit, opInc: a.operatingIncome, netInc: a.netIncome, periodType: 'annual', fxToUsd: Math.round(fxPerCur * 1e8) / 1e8 })).sort((a, b) => a.end < b.end ? -1 : 1),
    notes: `FY Dec; staging snapshot fx ${p.fxKey} (open.er-api.com 2026-10-26, single rate applied to all FYs); TTM row excluded by integration rule.`
  };
  report.added.push({ ticker: key, n: p.annual.length, market: 'EU' });
}
for (const key of ['2454.TW', '2330.TW']) {
  const r = b5.results.find(x => x.ticker === key);
  const p = r.profit; // staging profit.unit = "USD $M": TWSE TWD figures were already converted at USD/TWD 32.596145
  const qEnd = (per) => {
    const [y, q] = per.match(/(\d{4})Q(\d)/).slice(1).map(Number);
    return `${y}-${['03-31', '06-30', '09-30', '12-31'][q - 1]}`;
  };
  profit.companies[key] = {
    name: r.name, currency: 'USD-M', frequency: 'q',
    quarters: p.quarterly.map(a => ({ end: qEnd(a.period), revenue: a.revenue, gross: a.grossProfit, opInc: a.operatingIncome, netInc: a.netIncome, periodType: 'q' })).sort((a, b) => a.end < b.end ? -1 : 1),
    notes: `TWSE quarterly; USD $M（TWSE/MOPS 报表以 TWD 列示，入池按 USD/TWD 32.596145 折算）.` + (key === '2330.TW' ? ' 独立于 TSM 20-F TWD-M 年度条目（口径互见，禁跨条目环比）。' : '')
  };
  report.added.push({ ticker: key, n: p.quarterly.length, market: 'TW' });
}

// ---------- fixups: authoritative post-merge manual fixes (backported 2026-10-29) ----------
// data/staging/fixups.json 快照了 batch 整合之后直接修进 profit.json 的 mixed 季度回填
// (BABA/BIDU/DIDIY/JD/LKNCY/PDD/TCOM/TSM, 见文件内 sourceCommit)。此层在所有 batch 之后应用、
// 优先级最高, 使「staging → profit.json」全量重跑结果与磁盘修复版逐字节一致。
{
  for (const f of FIXUPS.fixups) {
    profit.companies[f.ticker] = JSON.parse(JSON.stringify(f.entry));
    report.replacements.push({ ticker: f.ticker, action: 'fixup-applied', n: f.entry.quarters.length, src: f.sourceCommit });
  }
}

// ---------- existing non-USD entries: attach frankfurter fx ----------
for (const [tk, e] of Object.entries(profit.companies)) {
  const cur = (e.currency || 'USD-M').replace('-M', '');
  if (cur === 'USD') continue;
  if (e.quarters[0] && e.quarters[0].fxToUsd) continue; // already handled above (snapshot rates)
  const n = await attachFx(e, cur);
  // approximate backfill: fill fxToUsd holes from nearest period with fx (marked approx), iterative
  for (let pass = 0; pass < 3; pass++) {
    const withFx = e.quarters.filter(q => q.fxToUsd != null);
    let changed = false;
    for (const q of e.quarters) {
      if (q.fxToUsd != null) continue;
      let bestN = null, bestD = 1e9;
      for (const w of withFx) { const d = Math.abs(days(q.end, w.end)); if (d < bestD) { bestD = d; bestN = w; } }
      if (bestN && bestD <= 800) { q.fxToUsd = bestN.fxToUsd; q.fxApprox = true; changed = true; }
    }
    if (!changed) break;
  }
  report.fx[tk] = { currency: cur, attached: e.quarters.filter(q => q.fxToUsd != null).length, missed: e.quarters.filter(q => q.fxToUsd == null).length, source: 'frankfurter.app (ECB); holes backfilled approx from nearest period' };
}

// ---------- registry additions ----------
const byTk = Object.fromEntries(registry.map(e => [e.ticker, e]));
function reg(tk, o) { if (!byTk[tk]) { registry.push({ ticker: tk, ...o }); byTk[tk] = registry.at(-1); } else { Object.assign(byTk[tk], o); } }
reg('00700.HK', { nameZh: '腾讯控股', nameEn: 'Tencent', color: '#1d55a5' });
reg('00941.HK', { nameZh: '中国移动', nameEn: 'China Mobile', color: '#0277bd' });
reg('01398.HK', { nameZh: '工商银行', nameEn: 'ICBC', color: '#c62828' });
reg('03968.HK', { nameZh: '招商银行', nameEn: 'China Merchants Bank', color: '#b71c1c' });
reg('00992.HK', { nameZh: '联想集团', nameEn: 'Lenovo', color: '#e2231a' });
reg('03690.HK', { nameZh: '美团', nameEn: 'Meituan', color: '#ffc300' });
reg('00728.HK', { nameZh: '中国电信', nameEn: 'China Telecom', color: '#1565c0' });
reg('00981.HK', { nameZh: '中芯国际', nameEn: 'SMIC', color: '#37474f' });
reg('00762.HK', { nameZh: '中国联通', nameEn: 'China Unicom', color: '#e65100' });
reg('01024.HK', { nameZh: '快手', nameEn: 'Kuaishou', color: '#ff4906' });
reg('02097.HK', { nameZh: '蜜雪集团', nameEn: 'Mixue', color: '#c62828' });
reg('03888.HK', { nameZh: '金山软件', nameEn: 'Kingsoft', color: '#283593' });
reg('00151.HK', { nameZh: '中国旺旺', nameEn: 'Want Want', color: '#d32f2f' });
reg('005930.KS', { nameZh: '三星电子', nameEn: 'Samsung Electronics', color: '#1428a0' });
reg('000660.KS', { nameZh: 'SK海力士', nameEn: 'SK hynix', color: '#ea002c' });
reg('066570.KS', { nameZh: 'LG电子', nameEn: 'LG Electronics', color: '#a50034' });
for (const r of b4.results) reg(r.ticker, { nameZh: (r.name || '').split(/\s+/)[0], nameEn: r.name, color: COL4[r.ticker] || '#555' });
reg('NESN.SW', { nameZh: '雀巢', nameEn: 'Nestlé', color: '#6a4fa3' });
reg('MC.PA', { nameZh: 'LVMH', nameEn: 'LVMH', color: '#1a1a1a' });
reg('2454.TW', { nameZh: '联发科', nameEn: 'MediaTek', color: '#f0a000' });
reg('2330.TW', { nameZh: '台积电', nameEn: 'TSMC (TWSE)', color: '#c8102e' });
reg('603866.SH', { nameZh: '桃李面包', nameEn: 'Toly Bread', color: '#8d6e63' });

// ---------- skipped list ----------
profit.skipped = [
  { ticker: 'TCEHY', status: 'skipped', reason: 'Tencent Holdings is not an SEC registrant: ticker TCEHY absent from EDGAR company_tickers.json; financials are HKEX-only — out of EDGAR scope (already covered via 00700.HK entry).' },
  { ticker: 'XIACF', status: 'skipped', reason: 'EDGAR maps XIACF to CIK 1748830 "Xiaomi Corporation/ADR", filings only F-6EF/F-6 POS ADR registrations — no 10-K/20-F/10-Q; Xiaomi is HKEX-listed 1810.HK, out of EDGAR scope.' },
  { ticker: '02513.HK', status: 'skipped', reason: 'Z.AI: only annual + interim (H1) cumulative HKEX disclosures available; 0 single quarters derivable (minKeep 8).' },
  { ticker: '00100.HK', status: 'skipped', reason: 'MiniMax: only 6 single quarters derivable (Q3×2 + Q4×4) from cumulative HKEX disclosures (< staging minKeep 8).' },
];

// ---------- cleanup / meta ----------
profit.units = 'mixed by entry (see entry.currency); USD-converted display via per-period fxToUsd';
notesNew.push('Integration 2026-10-26: batch1-5 merged. Non-USD display conversion uses per-period fxToUsd (frankfurter.app ECB reference, period-end business day) except snapshot-fx entries (NESN.SW/MC.PA) and KRW/HK row-level fx from staging. 2454.TW/2330.TW 为 USD-M（TWSE 报表以 TWD 列示，入池已按 USD/TWD 32.596145 折算，无 fxToUsd；2026-10-29 更正 currency 标记）。');
notesNew.push('2330.TW (TWSE quarterly) and TSM (20-F annual TWD-M) are separate entries by design — 禁止跨条目环比.');
profit.notes = [...new Set([...(profit.notes || []), ...notesNew])];
profit.updated = new Date().toISOString().slice(0, 10);
profit.source = 'SEC EDGAR + HKEX (东财) + KR/TW/EU disclosures; integration merge of staging batches 1-5';
// top-level meta snapshot (fixups.meta): 事后手工修订的 source/units/skipped[]/notes 以磁盘为准
if (FIXUPS.meta) {
  for (const [k, v] of Object.entries(FIXUPS.meta)) if (k !== 'updated') profit[k] = JSON.parse(JSON.stringify(v));
  if (!('profitPreview' in FIXUPS.meta)) delete profit.profitPreview; // SPCX preview 已在后续修复中移除, 以磁盘为准
}

// ---------- guards (frequency-class aware) ----------
function guard(tk, e) {
  const errs = [];
  const qs = e.quarters;
  const freq = e.frequency || (e.quarters[0] && (e.quarters[0].end || '').endsWith('-12-31') && qs.every(q => (q.end || '').endsWith('-12-31')) ? 'annual' : 'q');
  if (e.frequency === 'hk-mixed' || e.frequency === 'mixed') {
    const groups = {};
    for (const q of qs) (groups[q.periodType] ||= []).push(q);
    for (const [pt, g] of Object.entries(groups)) {
      const real = g.filter(q => q.revenue != null).sort((a, b) => a.end < b.end ? -1 : 1);
      for (let i = 1; i < real.length; i++) {
        const d = days(real[i - 1].end, real[i].end);
        const ok = pt === 'annual' ? d >= 300 && d <= 400 : (pt === 'interim' ? d >= 150 && d <= 400 : d >= 300 && d <= 400);
        if (!ok) errs.push(`${pt} gap ${d}d ${real[i - 1].end}->${real[i].end}`);
      }
    }
  } else if (freq === 'annual') {
    for (let i = 1; i < qs.length; i++) {
      const d = days(qs[i - 1].end, qs[i].end);
      if (d < 300 || d > 400) errs.push(`gap ${d}d ${qs[i - 1].end}->${qs[i].end}`);
    }
  } else {
    for (let i = 1; i < qs.length; i++) {
      const d = days(qs[i - 1].end, qs[i].end);
      if (d < 80 || d > 105) errs.push(`gap ${d}d ${qs[i - 1].end}->${qs[i].end}`);
    }
  }
  for (const q of qs) {
    if (q.revenue != null && q.revenue < 0) errs.push(`negative revenue ${q.end}`);
    if (q.gross != null && q.revenue != null && q.gross > q.revenue) errs.push(`gross>revenue ${q.end}`);
  }
  return errs;
}
const guardFails = {};
for (const [tk, e] of Object.entries(profit.companies)) {
  const errs = guard(tk, e);
  if (errs.length) guardFails[tk] = errs;
}

// ---------- stats ----------
const stats = {};
let totalQ = 0;
for (const [tk, e] of Object.entries(profit.companies)) {
  totalQ += e.quarters.length;
  const m = (e.currency || 'USD-M').replace('-M', '');
  const f = e.frequency || 'q';
  const k = `${f}/${m}`;
  stats[k] ||= { companies: 0, quarters: 0 };
  stats[k].companies++; stats[k].quarters += e.quarters.length;
}

fs.writeFileSync(fxCachePath, JSON.stringify(fxCache, null, 1));
report.guardFails = guardFails;
report.stats = stats;
report.totalCompanies = Object.keys(profit.companies).length;
report.totalQuarters = totalQ;
report.registryCount = registry.length;

if (process.env.DRY || process.argv.includes('--dry')) {
  console.log(JSON.stringify(report, null, 1).slice(0, 8000));
} else {
  // ---------- pre-write regression guard (disk-safe merge) ----------
  const FORCE = process.argv.includes('--force') || process.env.FORCE === '1';
  const norm = (v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v;
  const regressions = [];
  for (const [tk, old] of Object.entries(diskSnapshot)) {
    const neu = profit.companies[tk];
    if (!neu) { regressions.push(`${tk}: entry would be DELETED`); continue; }
    if ((neu.quarters || []).length < (old.quarters || []).length)
      regressions.push(`${tk}: periods ${old.quarters.length} -> ${neu.quarters.length} (shrunk)`);
    if ((old.currency || 'USD-M') !== (neu.currency || 'USD-M'))
      regressions.push(`${tk}: currency ${old.currency} -> ${neu.currency}`);
    if (old.frequency && old.frequency !== neu.frequency)
      regressions.push(`${tk}: frequency ${old.frequency} -> ${neu.frequency}`);
    const oldMap = new Map((old.quarters || []).map(q => [q.end + '|' + (q.periodType || ''), q]));
    for (const q of (neu.quarters || [])) {
      const o = oldMap.get(q.end + '|' + (q.periodType || ''));
      if (!o) continue; // new period: additive, fine
      for (const f of ['revenue', 'netInc', 'gross', 'opInc', 'fxToUsd', 'periodType']) {
        const a = norm(o[f]), b = norm(q[f]);
        const bothNull = a == null && b == null;
        if (!bothNull && JSON.stringify(a) !== JSON.stringify(b))
          regressions.push(`${tk} ${q.end}${q.periodType ? '/' + q.periodType : ''}: ${f} ${o[f]} -> ${q[f]}`);
      }
    }
  }
  if (Object.keys(profit.companies).length < Object.keys(diskSnapshot).length)
    regressions.push(`company count ${Object.keys(diskSnapshot).length} -> ${Object.keys(profit.companies).length} (shrunk)`);
  if (registry.length < diskRegistryCount)
    regressions.push(`registry count ${diskRegistryCount} -> ${registry.length} (shrunk)`);
  report.regressions = regressions;
  if (regressions.length && !FORCE) {
    console.error(`REFUSING TO WRITE: ${regressions.length} semantic regression(s) vs on-disk data/profit.json. This merge would roll back existing data (手工修复被 staging 旧数据覆盖). Fix staging to match disk, or re-run with --force to override deliberately.`);
    console.error(regressions.slice(0, 40).join('\n') + (regressions.length > 40 ? `\n... and ${regressions.length - 40} more` : ''));
    fs.writeFileSync(path.join(ROOT, 'tmp-merge', 'merge_report.json'), JSON.stringify(report, null, 2) + '\n');
    process.exit(1);
  }
  if (regressions.length) console.error(`WARNING: --force given; writing despite ${regressions.length} regression(s).`);
  W('data/profit.json', profit);
  W('data/companies.json', registry);
  W('tmp-merge/merge_report.json', report);
  console.log('WROTE profit.json companies=' + report.totalCompanies + ' quarters=' + totalQ + ' registry=' + registry.length);
  console.log('guardFails:', JSON.stringify(guardFails, null, 1));
}
