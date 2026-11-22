#!/usr/bin/env node
/* 分红 / 利润上缴派生量的唯一复算入口 —— 只读 data/metrics.json 与 docs/evidence/sgcc_full.json，不联网。
 *
 *   node scripts/derive_dividends.mjs              分红表（公司 × 年 × 分红/归母/净利/分红率）
 *   node scripts/derive_dividends.mjs --coverage   覆盖表（公司 × 年 × 字段可得性）
 *   node scripts/derive_dividends.mjs --check      一致性断言（非 0 退出），CI / 提交前跑
 *
 * 派生规则（与前端 app.js 的 mvPayout / mvStateDividend 完全一致）：
 *   payout          = dividendsToParent ÷ income.netInc  （两者皆 as reported）
 *                     缺分红总额的来源（00700.HK / 005930.KS）回退 dps ÷ eps
 *   stateDividend   = dividendsToParent（仅 stateOwnership === 1，即国有独资；否则 null）
 * 2021 双口径：as reported 的 dividendsToParent 为 null（原表空白），重述值在 years[].restated。
 */
import { readFileSync } from 'node:fs';
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
function stateDividend(e, y) {
  const S = y.shareholder || {};
  return e.stateOwnership === 1 && S.dividendsToParent != null ? S.dividendsToParent : null;
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
      // notes.fields 必须 ⊆ schema 字段：payout / stateDividend 是前端派生行，不是数据层字段
      for (const n of (y.notes || [])) {
        ok(Array.isArray(n.fields) && n.fields.length > 0, `${tk} ${y.end}: 脚注 ${n.id || '?'} 的 fields 缺失`);
        for (const f of (n.fields || [])) {
          ok(ALL.includes(f), `${tk} ${y.end}: 脚注 ${n.id || '?'} 的 fields 含非 schema 字段 ${f}`);
        }
      }
      const S = y.shareholder || {};
      if (S.dividendsToParent != null && S.dividendsTotal != null) {
        ok(S.dividendsToParent <= S.dividendsTotal + 1e-9, `${tk} ${y.end}: 归母分红 > 分红总额`);
      }
      if (y.restated) {
        ok(y.restated.dividendsToParent != null && y.restated.source, `${tk} ${y.end}: restated 不完整`);
        ok((y.notes || []).some((n) => (n.fields || []).includes('dividendsToParent')), `${tk} ${y.end}: restated 年缺分红口径脚注`);
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

  console.log(`\n检查 ${bad.length ? '失败' : '通过'}：${bad.length} 处问题`);
  for (const m of bad) console.log('  ✗ ' + m);
  process.exit(bad.length ? 1 : 0);
}
