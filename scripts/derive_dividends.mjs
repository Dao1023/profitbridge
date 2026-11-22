#!/usr/bin/env node
/* 分红 / 利润上缴派生量的唯一复算入口 —— 只读 data/metrics.json 与 docs/evidence/sgcc_full.json，不联网。
 *
 *   node scripts/derive_dividends.mjs              分红表（公司 × 年 × 分红/归母/净利/分红率）
 *   node scripts/derive_dividends.mjs --coverage   覆盖表（公司 × 年 × 字段可得性）
 *   node scripts/derive_dividends.mjs --check      一致性断言（离线，非 0 退出），CI / 提交前跑
 *   node scripts/derive_dividends.mjs --refresh    联网复取 A 股/港股分红原始行并重算总额，
 *                                                  与 JSON 逐位比对（缓存写 .cache/dividends/）
 *
 * 派生规则（与前端 app.js 的 mvPayout / mvStateDividend / mvStateRatio 完全一致）：
 *   payout          = dividendsToParent ÷ income.netInc  （两者皆 as reported）
 *                     缺分红总额的来源（00700.HK / 005930.KS）回退 dps ÷ eps
 *   stateRatio      = stateStake.ratio（第一大国有股东持股比例）；stateOwnership === 1 视为 1；否则 null
 *   stateDividend   = dividendsToParent × stateRatio（下限口径：集团之外的其他国有股东未计入）
 * 2021 双口径：as reported 的 dividendsToParent 为 null（原表空白），重述值在 years[].restated。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CORE, EXTENDED, GROUPS, ALL, OWNER } from './metrics_schema.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MET = JSON.parse(readFileSync(path.join(ROOT, 'data/metrics.json'), 'utf8'));
const SGCC_EVIDENCE = path.join(ROOT, 'docs/evidence/sgcc_full.json');

const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const pct = (v) => (v == null ? null : (v * 100).toFixed(2) + '%');
const num = (v, w = 13) => (v == null ? '—'.padStart(w) : v.toFixed(2).padStart(w));

function payout(y) {
  const S = y.shareholder || {}, I = y.income || {}, P = y.perShare || {};
  if (S.dividendsToParent != null && I.netInc != null) return S.dividendsToParent / I.netInc;
  if (P.dps != null && P.eps != null) return P.dps / P.eps;
  return null;
}
function payoutBasis(y) {
  const S = y.shareholder || {}, I = y.income || {}, P = y.perShare || {};
  if (S.dividendsToParent != null && I.netInc != null) return 'parent/net';
  if (P.dps != null && P.eps != null) return 'dps/eps';
  return null;
}
function stateRatio(e) {
  if (!e) return null;
  const st = e.stateStake;
  if (st && st.ratio != null && st.ratio > 0) return st.ratio;
  return e.stateOwnership === 1 ? 1 : null;
}
function stateDividend(e, y) {
  const S = y.shareholder || {};
  const r = stateRatio(e);
  return r != null && S.dividendsToParent != null ? S.dividendsToParent * r : null;
}

/* ------------------------------------------------------------------ 复取表 ---- */
/* 港股逐期股本：只有「资产负债表股本 ÷ 面值 = 股数且期间无回购/增发」或「年报主要股东表可反算」
   的公司才登记；拿不到的公司 register null → 总分红记 null（不估算）。 */
const WAVE2_A = [
  { tk: '600519.SS', sec: '600519', code: '600519.SH' },
  { tk: '300750.SZ', sec: '300750', code: '300750.SZ' },
  { tk: '002594.SZ', sec: '002594', code: '002594.SZ' },
  { tk: '688256.SS', sec: '688256', code: '688256.SH' },
  { tk: '688795.SS', sec: '688795', code: '688795.SH' },
  { tk: '002415.SZ', sec: '002415', code: '002415.SZ' },
  { tk: '000063.SZ', sec: '000063', code: '000063.SZ' },
  { tk: '000333.SZ', sec: '000333', code: '000333.SZ' },
  { tk: '000100.SZ', sec: '000100', code: '000100.SZ' },
  { tk: '601360.SS', sec: '601360', code: '601360.SH' },
  { tk: '688825.SS', sec: '688825', code: '688825.SH' },
  { tk: '688981.SS', sec: '688981', code: '688981.SH' },
  { tk: '603866.SH', sec: '603866', code: '603866.SH' },
];
const WAVE2_HK = [
  { tk: '00941.HK', sec: '00941', shares: null },
  { tk: '01398.HK', sec: '01398', shares: 356406257089 },
  { tk: '03968.HK', sec: '03968', shares: 25219845601 },
  { tk: '00728.HK', sec: '00728', shares: 91507138699 },
  { tk: '00762.HK', sec: '00762', shares: 30598124345 },
];
/* HKD→CNY（除净日，ECB euro reference rates；数值 = EUR/CNY ÷ EUR/HKD） */
const FX = {
  '2022-09-06': 0.8865549453369604,
  '2023-06-07': 0.9072463078222993,
  '2024-06-06': 0.9276631350688838,
};
const CACHE = path.join(ROOT, '.cache', 'dividends');

async function emiGet(reportName, filter) {
  const u = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
  u.searchParams.set('reportName', reportName);
  u.searchParams.set('columns', 'ALL');
  u.searchParams.set('filter', filter);
  u.searchParams.set('pageNumber', '1');
  u.searchParams.set('pageSize', '5000');
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://emweb.securities.eastmoney.com/' },
  });
  if (!r.ok) throw new Error(`${reportName} HTTP ${r.status}`);
  const j = await r.json();
  if (j.code === 9201 || j.message === '返回数据为空' || !j.result) return []; // 该接口对未分红公司返回空记录
  return j.result.data || [];
}
async function cached(key, fn) {
  const f = path.join(CACHE, key + '.json');
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* miss */ }
  const v = await fn();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(f, JSON.stringify(v));
  return v;
}
function parsePlan(explain) {
  const m = String(explain || '').match(/每股派(人民币|港币)([\d.]+)元/);
  return m ? { ccy: m[1] === '人民币' ? 'CNY' : 'HKD', val: Number(m[2]) } : null;
}
/* A 股：只计「实施分配」；每 10 股含税 × 股本 ÷10；含送转的年度用当年年末 SHARE_CAPITAL 作基数 */
function aTotalsFrom(rows, shareCap) {
  const byYear = {};
  for (const r of rows) {
    if (r.ASSIGN_PROGRESS !== '实施分配' || r.PRETAX_BONUS_RMB == null) continue;
    const y = String(r.REPORT_DATE).slice(0, 4);
    const per10 = Number(r.PRETAX_BONUS_RMB);
    const bonus = Number(r.BONUS_IT_RATIO || 0);
    const base = bonus > 0 ? shareCap[y] : Number(r.TOTAL_SHARES);
    if (!base) continue;
    (byYear[y] = byYear[y] || []).push({ per10, base, amt: r2((per10 / 10) * base / 1e6) });
  }
  const out = {};
  for (const [y, list] of Object.entries(byYear)) {
    out[y] = { total: r2(list.reduce((a, x) => a + x.amt, 0)), dps: r2(list.reduce((a, x) => a + x.per10 / 10, 0)), n: list.length };
  }
  return out;
}
function hkTotalsFrom(rows, shares) {
  const acc = {};
  for (const r of rows) {
    const p = parsePlan(r.PLAN_EXPLAIN);
    if (!p) continue;
    const y = String(r.YEAR);
    const ex = String(r.EX_DIVIDEND_DATE || '').slice(0, 10).replace(/\//g, '-');
    let val = p.val;
    if (p.ccy === 'HKD') {
      if (!(ex in FX)) { (acc[y] = acc[y] || { err: `缺 ${ex} 汇率` }); continue; }
      val = p.val * FX[ex];
    }
    const a = acc[y] || (acc[y] = { exact: 0, n: 0 });
    if (a.err) continue;
    a.exact += val; a.n += 1;
  }
  const out = {};
  for (const [y, a] of Object.entries(acc)) {
    out[y] = a.err ? { total: null, dps: null, err: a.err }
      : { total: shares == null ? null : r2((a.exact * shares) / 1e6), dps: r2(a.exact), n: a.n };
  }
  return out;
}
function sharesOf(tk) {
  const h = WAVE2_HK.find((c) => c.tk === tk);
  return h ? h.shares : null;
}

const mode = process.argv[2] || '--table';
const tickers = Object.keys(MET.companies);

if (mode === '--table' || mode === '') {
  for (const tk of tickers) {
    const c = MET.companies[tk];
    console.log(`\n== ${tk}  ${c.name}  [${c.currency}]  basis=${c.dividendBasis || 'null'}` +
      (c.stateOwnership === 1 ? '  stateOwnership=1（利润上缴口径成立）' : ''));
    console.log('  period      dividendsTotal  toParent      netInc(parent)   payout     stateDiv    note');
    for (const y of c.years) {
      const S = y.shareholder || {}, I = y.income || {};
      const p = payout(y), sd = stateDividend(c, y);
      const rst = y.restated
        ? `restated ${y.restated.dividendsTotal}/${y.restated.dividendsToParent}`
        : '';
      console.log('  ' + y.end + num(S.dividendsTotal) + num(S.dividendsToParent) +
        num(I.netInc) + '  ' + (p == null ? '    —  ' : (p * 100).toFixed(2).padStart(6) + '%') +
        '  ' + (sd == null ? '    —  ' : sd.toFixed(2).padStart(9)) +
        '   ' + (payoutBasis(y) || '') + (y.restated ? ' (as-reported 空白 → 见 restated)' : '') +
        (rst ? '  ' + rst : ''));
    }
  }
  console.log('\n提示：`--coverage` 出字段可得性矩阵，`--check` 跑一致性断言。');
}

if (mode === '--coverage') {
  for (const tk of tickers) {
    const c = MET.companies[tk];
    const ends = c.years.map((y) => y.end.slice(0, 4));
    console.log(`\n== ${tk}  ${c.name}   ${ends.join('  ')}`);
    for (const [g, fields] of Object.entries(GROUPS)) {
      const present = fields.filter((f) => c.years.some((y) => (y[g] || {})[f] != null));
      if (!present.length) continue;
      console.log(`  [${g}]`);
      for (const f of present) {
        const cells = c.years.map((y) => ((y[g] || {})[f] == null ? '  —  ' : '  ✓  '));
        console.log('    ' + f.padEnd(22) + cells.join(' '));
      }
    }
  }
}

/* ---- 联网复取：按同一规则重算 18 家（A 股 13 + 港股 5）的宣告分红，与 JSON 逐位比对 ---- */
if (mode === '--refresh') {
  const diffs = [];
  const line = (tk, end, field, jsonV, calcV) => {
    const same = jsonV === calcV || (jsonV == null && calcV == null);
    if (!same) diffs.push(`${tk} ${end}: ${field} JSON=${jsonV} 复算=${calcV}`);
    console.log(`  ${same ? '✓' : '✗'} ${tk.padEnd(11)} ${end}  ${field.padEnd(15)} JSON=${String(jsonV).padStart(12)}  复算=${String(calcV).padStart(12)}`);
  };
  for (const c of WAVE2_A) {
    const rows = await cached(`A_SHAREBONUS_${c.sec}`, () => emiGet('RPT_SHAREBONUS_DET', `(SECURITY_CODE="${c.sec}")`));
    const bal = await cached(`A_GBALANCE_${c.sec}`, () => emiGet('RPT_F10_FINANCE_GBALANCE', `(SECUCODE="${c.code}")`));
    const shareCap = {};
    for (const b of bal) {
      if (b.REPORT_TYPE === '年报' && b.SHARE_CAPITAL != null) shareCap[String(b.REPORT_DATE).slice(0, 4)] = Number(b.SHARE_CAPITAL);
    }
    const calc = aTotalsFrom(rows, shareCap);
    console.log(`\n== ${c.tk}  ${MET.companies[c.tk].name}`);
    for (const y of MET.companies[c.tk].years) {
      const cy = calc[y.end.slice(0, 4)];
      line(c.tk, y.end, 'dividendsTotal', y.shareholder.dividendsTotal, cy ? cy.total : null);
      line(c.tk, y.end, 'dps', y.perShare.dps, cy ? cy.dps : null);
    }
  }
  for (const c of WAVE2_HK) {
    const rows = await cached(`HK_DIVBASIC_${c.sec}`, () => emiGet('RPT_HKF10_MAIN_DIVBASIC', `(SECURITY_CODE="${c.sec}")(IS_BFP="0")`));
    const calc = hkTotalsFrom(rows, c.shares);
    console.log(`\n== ${c.tk}  ${MET.companies[c.tk].name}  股本=${c.shares == null ? '未取到（不估算）' : c.shares}`);
    for (const y of MET.companies[c.tk].years) {
      const cy = calc[y.end.slice(0, 4)];
      if (cy && cy.err) { diffs.push(`${c.tk} ${y.end}: ${cy.err}`); console.log(`  ✗ ${c.tk} ${y.end} ${cy.err}`); continue; }
      line(c.tk, y.end, 'dividendsTotal', y.shareholder.dividendsTotal, cy ? cy.total : null);
      line(c.tk, y.end, 'dps', y.perShare.dps, cy ? cy.dps : null);
    }
  }
  console.log(`\n复取校验 ${diffs.length ? '失败' : '通过'}：${diffs.length} 处不一致（原始响应缓存在 .cache/dividends/）`);
  for (const d of diffs) console.log('  ✗ ' + d);
  process.exit(diffs.length ? 1 : 0);
}

if (mode === '--check') {
  const bad = [];
  const ok = (cond, msg) => { if (!cond) bad.push(msg); };
  const ev = JSON.parse(readFileSync(SGCC_EVIDENCE, 'utf8'));

  for (const tk of tickers) {
    const c = MET.companies[tk];
    ok(c.years.length >= 3, `${tk}: years < 3`);
    const ends = c.years.map((y) => y.end);
    ok(JSON.stringify(ends) === JSON.stringify([...ends].sort()), `${tk}: years 未按期末升序`);
    for (const y of c.years) {
      for (const [g, fields] of Object.entries(CORE)) {
        ok(y[g] && typeof y[g] === 'object', `${tk} ${y.end}: 缺组 ${g}`);
        for (const f of fields) ok(f in (y[g] || {}), `${tk} ${y.end}: ${g}.${f} 键缺失（CORE 字段必须存在，可为 null）`);
      }
      // 扩展字段按公司可选：出现即须合法（下面 nulls 一致性会兜住）
      for (const [g, fields] of Object.entries(EXTENDED)) {
        for (const f of fields) {
          if (f in (y[g] || {})) ok((y[g][f] == null) === (y[g][f] === null), `${tk} ${y.end}: ${g}.${f} 非数字`);
        }
      }
      const nulls = ALL.filter((f) => {
        const g = OWNER[f];
        const grp = y[g] || {};
        return f in grp && grp[f] == null;
      });
      ok(JSON.stringify([...y.nulls].sort()) === JSON.stringify([...nulls].sort()),
        `${tk} ${y.end}: nulls 与实际 null 不一致\n    记录=${JSON.stringify(y.nulls)}\n    实际=${JSON.stringify(nulls)}`);
      for (const f of y.nulls) ok(y.sources.some((s) => s.includes(f)), `${tk} ${y.end}: null 字段 ${f} 未在 sources 里解释`);
      const S = y.shareholder || {};
      if (S.dividendsToParent != null && S.dividendsTotal != null) {
        ok(S.dividendsToParent <= S.dividendsTotal + 1e-9, `${tk} ${y.end}: 归母分红 > 分红总额`);
      }
      if (y.restated) {
        ok(y.restated.dividendsToParent != null && y.restated.source, `${tk} ${y.end}: restated 不完整`);
        ok((y.notes || []).some((n) => (n.fields || []).includes('payout')), `${tk} ${y.end}: restated 年缺 payout 脚注`);
      }
      if (tk === 'SGCC' && y.end === '2021-12-31') {
        ok(S.dividendsToParent === null, 'SGCC 2021: as-reported 归母分红必须是 null（不许写 0）');
        ok(S.dividendsTotal === 3516.06, 'SGCC 2021: 合计须为 3,516.06（仅少数股东）');
        ok(y.restated && y.restated.dividendsToParent === 4582.18 && y.restated.dividendsTotal === 8098.24,
          'SGCC 2021: 重述值须为 4,582.18 / 8,098.24');
      }
    }
    // 公司级
    ok(!('dividendBasis' in c) || c.dividendBasis === null || c.dividendBasisNote,
      `${tk}: 有 dividendBasis 必须有 dividendBasisNote`);
  }

  // SGCC 逐位对证据（docs/evidence/sgcc_full.json，OCR + 恒等式自检后的入库副本）
  const s = MET.companies.SGCC;
  ok(s && s.years.length === 6, 'SGCC: 必须 6 年');
  for (const y of (s && s.years) || []) {
    const e = ev.years[y.end];
    ok(!!e, `SGCC ${y.end}: 证据里没有该年`);
    if (!e) continue;
    const eq = [
      ['income', 'totalRevenue', 'totalRevenue'], ['income', 'revenue', 'revenue'],
      ['income', 'cogs', 'costOfSales'], ['income', 'opInc', 'operatingProfit'],
      ['income', 'pbt', 'profitBeforeTax'], ['income', 'tax', 'incomeTaxExpense'],
      ['income', 'netInc', 'netProfitAttributableToParent'],
      ['income', 'rd', 'rdExpenses'], ['income', 'taxAndSurcharges', 'taxesAndSurcharges'],
      ['income', 'finExpense', 'financialExpenses'], ['income', 'investmentIncome', 'investmentIncome'],
      ['income', 'interestExpense', 'interestExpense'],
      ['balance', 'cash', 'cash'], ['balance', 'receivables', 'accountsReceivable'],
      ['balance', 'inventory', 'inventory'], ['balance', 'currentAssets', 'currentAssetsTotal'],
      ['balance', 'ppe', 'fixedAssets'], ['balance', 'totalAssets', 'totalAssets'],
      ['balance', 'liabilities', 'totalLiabilities'], ['balance', 'equityParent', 'equityAttributableToParent'],
      ['balance', 'equity', 'totalEquity'], ['balance', 'cip', 'constructionInProgress'],
      ['balance', 'paidInCapital', 'paidInCapital'], ['balance', 'retainedEarnings', 'retainedEarnings'],
      ['balance', 'minorityInterests', 'minorityInterests'],
      ['cashflow', 'ocf', 'operatingCashFlow'], ['cashflow', 'icf', 'investingCashFlow'],
      ['cashflow', 'finCashFlow', 'financingCashFlow'], ['cashflow', 'capex', 'capex'],
    ];
    for (const [g, f, ef] of eq) ok(y[g][f] === r2(e[g][ef]), `SGCC ${y.end}: ${g}.${f} ${y[g][f]} ≠ 证据 ${e[g][ef]}`);
    ok(y.income.sga === r2(e.income.sellingExpenses + e.income.adminExpenses), `SGCC ${y.end}: sga ≠ 销售+管理`);
    ok(y.balance.debtShort === r2(e.balance.shortTermBorrowings + e.balance.noncurrentLiabDueWithin1y), `SGCC ${y.end}: debtShort ≠ 短期借款+一年内到期`);
    ok(y.balance.debtLong === r2(e.balance.longTermBorrowings + e.balance.bondsPayable), `SGCC ${y.end}: debtLong ≠ 长期借款+应付债券`);
    const d = e.equityChange.distributionsToOwners;
    ok(y.shareholder.dividendsTotal === r2(Math.abs(d.consolidated)), `SGCC ${y.end}: dividendsTotal ≠ 权益变动表合计`);
    const par = d.attributableToParent == null ? null : r2(Math.abs(d.attributableToParent));
    ok(y.shareholder.dividendsToParent === par, `SGCC ${y.end}: dividendsToParent ≠ 权益变动表归母列（${y.shareholder.dividendsToParent} vs ${par}）`);
    if (d.restatedInNextYearReport) {
      const rr = d.restatedInNextYearReport;
      ok(y.restated && y.restated.dividendsTotal === r2(Math.abs(rr.consolidated)) &&
        y.restated.dividendsToParent === r2(Math.abs(rr.attributableToParent)),
        `SGCC ${y.end}: restated 与证据重述值不一致`);
    }
  }

  // 分红率与 dps/eps 回退公司的交叉校验
  for (const tk of ['00700.HK', '005930.KS']) {
    for (const y of MET.companies[tk].years) {
      const p = payout(y);
      ok(p != null && p === payout(y), `${tk} ${y.end}: payout null`);
      ok(y.shareholder.dividendsTotal === null, `${tk} ${y.end}: 该来源无分红总额，必须是 null`);
    }
  }

  /* ---- 第二轮（A 股 13 + 港股 5）：每 10 股换算 / DPS×股本 / 利润上缴代理口径 ---- */
  for (const c of [...WAVE2_A, ...WAVE2_HK]) {
    const e = MET.companies[c.tk];
    ok(!!e, `${c.tk}: metrics 缺条目`);
    if (!e) continue;
    const st = e.stateStake;
    if (st == null) {
      ok(!!e.stateStakeNote, `${c.tk}: 无 stateStake 必须写 stateStakeNote（说明民营/无实际控制人）`);
    } else {
      ok(typeof st.ratio === 'number' && st.ratio > 0 && st.ratio <= 1, `${c.tk}: stateStake.ratio 必须在 (0,1]`);
      ok(Math.abs(st.ratio * 1e4 - Math.round(st.ratio * 1e4)) < 1e-9, `${c.tk}: stateStake.ratio 必须 4 位小数`);
      ok(!!st.holder, `${c.tk}: stateStake.holder 缺失`);
      ok(!!st.source, `${c.tk}: stateStake.source 缺失（须写清接口/PDF 页码与原始数字）`);
      ok(st.layer === 'central-soe' || st.layer === 'local-soe', `${c.tk}: stateStake.layer 非法`);
      ok(/^\d{4}-\d{2}-\d{2}$/.test(st.asOf || ''), `${c.tk}: stateStake.asOf 必须是 YYYY-MM-DD`);
      ok(!!e.stateStakeNote, `${c.tk}: 有 stateStake 也要 stateStakeNote`);
    }
    for (const y of e.years) {
      const S = y.shareholder || {};
      ok((S.dividendsTotal == null) === (S.dividendsToParent == null), `${c.tk} ${y.end}: 总额与归母必须同为 null 或同为数字`);
      if (S.dividendsTotal != null) {
        ok(S.dividendsToParent === S.dividendsTotal, `${c.tk} ${y.end}: 归母分红必须等于总额（发行人层面无少数股东拆分）`);
      }
      const sh = sharesOf(c.tk);
      if (sh && S.dividendsTotal != null) {
        const tol = (0.005 * sh) / 1e6 + 0.01; // dps 只存两位小数 → 容差 = 舍入误差
        ok(Math.abs(S.dividendsTotal - (y.perShare.dps * sh) / 1e6) <= tol,
          `${c.tk} ${y.end}: 总额 ${S.dividendsTotal} ≠ dps×股本 ${((y.perShare.dps * sh) / 1e6).toFixed(2)}（容差 ${tol.toFixed(2)}）`);
      }
      if (stateRatio(e) != null && S.dividendsToParent != null) {
        ok(stateDividend(e, y) > 0, `${c.tk} ${y.end}: 利润上缴（代理）应为正数`);
      }
    }
  }

  console.log(`\n检查 ${bad.length ? '失败' : '通过'}：${bad.length} 处问题`);
  for (const m of bad) console.log('  ✗ ' + m);
  process.exit(bad.length ? 1 : 0);
}
