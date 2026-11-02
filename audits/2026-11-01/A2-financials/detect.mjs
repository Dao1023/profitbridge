#!/usr/bin/env node
/**
 * detect.mjs — profitbridge data/profit.json 全站一致性检查（只读）
 *
 * 五大检查：
 *   (1) 同一公司同一 end 内部矛盾：gross>revenue、opInc>gross、opInc/revenue、netInc 量级异常、revenue<=0
 *   (2) 相邻期突变：同周期类型按 end 排序，revenue 同比 >5x 或 <0.2x（前后正常）
 *   (3) 单季 vs 累计差分：annual 与 q 并存者用 4 单季求和校验年度；cumulative 标记的公司校验同财年累计单调；
 *       且检测"单季≈年度"（累计期被当单季 / Q4 被年度值污染）
 *   (4) fxToUsd 缺失（非 USD 本位币）或同币种同期与同侪偏差 >5%
 *   (5) periodType 与 frequency 矛盾
 *
 * 输出：tmp-audit/a2/findings.json（机器可读）+ stdout 摘要
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function findRoot(d) { let cur = d; for (let i = 0; i < 10; i++) { if (fs.existsSync(path.join(cur, 'data', 'profit.json'))) return cur; cur = path.dirname(cur); } throw new Error('repo root (data/profit.json) not found above ' + d); }
const ROOT = findRoot(__dirname);
const PROFIT = path.join(ROOT, 'data', 'profit.json');
const OUT = path.join(__dirname, 'detect-findings.json');

const P = JSON.parse(fs.readFileSync(PROFIT, 'utf8'));
const companies = P.companies;
const DAY = 864e5;

// 已知真实业务例外（来自 scripts/validate_profit.mjs）
const NEG_GROSS_OK = new Set(['MU', 'TSLA', 'PDD', '00100.HK']);

const effFreq = (c) => c.frequency || 'q'; // 无 frequency 的 28 家均为美股季度
const pClass = (q) => {
  const pt = q.periodType;
  if (pt == null) return 'q';
  if (['q', 'q1', 'q2', 'q3', 'q4'].includes(pt)) return 'q';
  if (pt === 'interim') return 'interim';
  if (pt === 'annual') return 'annual';
  return 'other:' + pt;
};
const sortedQ = (c) => c.quarters.slice().sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
const days = (a, b) => (new Date(b) - new Date(a)) / DAY;
const fmt = (n) => (n == null ? 'null' : Math.abs(n) >= 1e6 ? n.toExponential(3) : String(Math.round(n * 100) / 100));

const F = {
  meta: { generatedAt: new Date().toISOString(), source: 'data/profit.json', updated: P.updated,
          companies: Object.keys(companies).length,
          quarters: Object.values(companies).reduce((s, c) => s + c.quarters.length, 0) },
  checks: { c1_internal: [], c2_adjacent_jump: [], c3_cumulative_diff: [], c4_fx: [], c5_periodType_freq: [] },
  gaps: [], // 数据缺口/停披（步骤3）
};

/* ---------------- (1) 内部矛盾 ---------------- */
for (const [tk, c] of Object.entries(companies)) {
  for (const q of c.quarters) {
    const tag = { ticker: tk, end: q.end, periodType: q.periodType || null, currency: c.currency };
    if (q.revenue == null) continue;
    if (q.revenue <= 0) F.checks.c1_internal.push({ ...tag, type: 'revenue<=0', severity: 'CRIT', detail: `revenue=${q.revenue}` });
    if (q.gross != null && q.gross < 0 && !NEG_GROSS_OK.has(tk))
      F.checks.c1_internal.push({ ...tag, type: 'gross<0', severity: 'HIGH', detail: `gross=${fmt(q.gross)} rev=${fmt(q.revenue)}` });
    if (q.gross != null && q.gross > q.revenue * 1.005)
      F.checks.c1_internal.push({ ...tag, type: 'gross>revenue', severity: 'CRIT', detail: `gross=${fmt(q.gross)} rev=${fmt(q.revenue)} (${(100 * q.gross / q.revenue).toFixed(1)}%)` });
    if (q.gross != null && q.opInc != null && q.opInc > q.gross * 1.005)
      F.checks.c1_internal.push({ ...tag, type: 'opInc>gross', severity: 'HIGH', detail: `opInc=${fmt(q.opInc)} gross=${fmt(q.gross)}` });
    if (q.opInc != null && q.opInc > q.revenue * 1.05)
      F.checks.c1_internal.push({ ...tag, type: 'opInc>revenue', severity: 'HIGH', detail: `opInc=${fmt(q.opInc)} rev=${fmt(q.revenue)} (${(100 * q.opInc / q.revenue).toFixed(1)}%)` });
    // opInc 与 netInc 数量级异常：净利远超营业利润量级（收入量级之上），或符号/幅度严重背离
    if (q.opInc != null && q.netInc != null && q.revenue > 0) {
      const denom = Math.max(Math.abs(q.opInc), 1);
      if (Math.abs(q.netInc) > denom * 8 && Math.abs(q.netInc) > q.revenue * 0.5)
        F.checks.c1_internal.push({ ...tag, type: 'netInc远超opInc', severity: 'HIGH', detail: `opInc=${fmt(q.opInc)} netInc=${fmt(q.netInc)} rev=${fmt(q.revenue)} |netInc|/|opInc|=${(Math.abs(q.netInc) / denom).toFixed(0)}x` });
    } else if (q.opInc == null && q.netInc != null && q.netInc > q.revenue * 3) {
      F.checks.c1_internal.push({ ...tag, type: 'netInc>revenue(无opInc)', severity: 'LOW', detail: `netInc=${fmt(q.netInc)} rev=${fmt(q.revenue)}` });
    }
  }
}

/* ---------------- (2) 相邻期突变 ---------------- */
for (const [tk, c] of Object.entries(companies)) {
  const byClass = {};
  for (const q of sortedQ(c)) {
    if (q.revenue == null || q.revenue <= 0) continue;
    const k = pClass(q);
    (byClass[k] ||= []).push(q);
  }
  for (const [cls, arr] of Object.entries(byClass)) {
    if (cls === 'other:*') continue;
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i];
      const r = b.revenue / a.revenue;
      if (r > 5 || r < 0.2) {
        // 前后是否正常：看 a 相对其前一期、b 相对其后一期
        const prevRatio = i >= 2 ? a.revenue / arr[i - 2].revenue : null;
        const nextRatio = i + 1 < arr.length ? arr[i + 1].revenue / b.revenue : null;
        F.checks.c2_adjacent_jump.push({
          ticker: tk, class: cls, from: a.end, to: b.end,
          fromRev: a.revenue, toRev: b.revenue, ratio: Math.round(r * 1000) / 1000,
          prevRatio: prevRatio == null ? null : Math.round(prevRatio * 1000) / 1000,
          nextRatio: nextRatio == null ? null : Math.round(nextRatio * 1000) / 1000,
          severity: r > 10 || r < 0.1 ? 'HIGH' : 'MED',
        });
      }
    }
  }
}

/* ---------------- (3) 单季 vs 累计差分 ---------------- */
for (const [tk, c] of Object.entries(companies)) {
  const qs = sortedQ(c);
  const annuals = qs.filter((q) => q.periodType === 'annual');
  const singles = qs.filter((q) => pClass(q) === 'q');
  // 3a. annual vs 4 singles sum
  for (const A of annuals) {
    if (A.revenue == null) continue;
    // 财年内单季：季度末距年度末 ≤300 天（Q1≈-274d, Q4=0），排除上一年 Q4（≈-365d）
    const within = singles.filter((q) => q.revenue != null && q.end <= A.end && days(q.end, A.end) <= 300 && days(q.end, A.end) >= 0);
    const sum = within.reduce((s, q) => s + q.revenue, 0);
    if (within.length === 4) {
      const diff = Math.abs(sum - A.revenue) / Math.abs(A.revenue);
      if (diff > 0.02) F.checks.c3_cumulative_diff.push({ ticker: tk, end: A.end, type: 'Σ4单季≠年度', severity: diff > 0.1 ? 'HIGH' : 'MED',
        detail: `Σ4=${fmt(sum)} FY=${fmt(A.revenue)} diff=${(diff * 100).toFixed(1)}% singles=[${within.map((q) => q.end).join(',')}]` });
    } else if (within.length === 3) {
      const implied = A.revenue - sum;
      if (implied <= 0) F.checks.c3_cumulative_diff.push({ ticker: tk, end: A.end, type: '隐含Q4<=0', severity: 'HIGH',
        detail: `impliedQ4=${fmt(implied)} FY=${fmt(A.revenue)} Σ3=${fmt(sum)}` });
    }
    // 3b. 单季≈年度（累计被当单季 / Q4 被年度污染）
    const sameEndQ = singles.filter((q) => q.end === A.end && q.revenue != null);
    for (const q of sameEndQ) {
      const ratio = Math.abs(q.revenue / A.revenue);
      if (ratio > 0.6) F.checks.c3_cumulative_diff.push({ ticker: tk, end: q.end, type: '单季≈年度(疑似Q4污染)', severity: 'CRIT',
        detail: `single=${fmt(q.revenue)} annual=${fmt(A.revenue)} ratio=${(ratio * 100).toFixed(0)}%` });
    }
  }
  // 3c. cumulative 标记公司：按财年分组（两次 annual 之间为一财年），校验累计收入单调递增
  const cums = qs.filter((q) => q.cumulative === true && q.revenue != null);
  if (cums.length) {
    let group = [];
    const groups = [];
    for (const q of cums) { // qs 已按 end 升序
      if (q.periodType === 'annual') { groups.push([...group, q]); group = []; }
      else group.push(q);
    }
    for (const g of groups) {
      g.sort((a, b) => (a.end < b.end ? -1 : 1));
      for (let i = 1; i < g.length; i++) {
        if (g[i].revenue < g[i - 1].revenue * 0.98)
          F.checks.c3_cumulative_diff.push({ ticker: tk, end: g[i].end, type: '累计期同比递减', severity: 'MED',
            detail: `${g[i - 1].end}=${fmt(g[i - 1].revenue)} -> ${g[i].end}=${fmt(g[i].revenue)}（同财年累计应非递减）` });
      }
    }
  }
}

/* ---------------- (4) fxToUsd ---------------- */
// 4a. 缺失：非 USD 本位币且 fxToUsd 缺失
for (const [tk, c] of Object.entries(companies)) {
  const cur = c.currency || '';
  if (cur === 'USD-M') continue; // 本位币即 USD，无需汇率
  const miss = c.quarters.filter((q) => q.fxToUsd == null && q.revenue != null);
  if (miss.length) F.checks.c4_fx.push({ ticker: tk, type: 'fxToUsd缺失', severity: miss.length === c.quarters.length ? 'HIGH' : 'MED',
    currency: cur, missing: miss.length, total: c.quarters.length, sample: miss.slice(-3).map((q) => q.end) });
}
// 4b. 同币种同期偏差 >5%（含跨公司）
const fxMap = {}; // `${cur}|${end}` -> [{tk, fx}]
for (const [tk, c] of Object.entries(companies)) {
  for (const q of c.quarters) {
    if (q.fxToUsd == null) continue;
    const key = `${c.currency}|${q.end}`;
    (fxMap[key] ||= []).push({ tk, fx: q.fxToUsd, fxDate: q.fxDate || null });
  }
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
for (const [key, arr] of Object.entries(fxMap)) {
  if (arr.length < 2) continue;
  const m = med(arr.map((x) => x.fx));
  for (const x of arr) {
    const dev = Math.abs(x.fx - m) / m;
    if (dev > 0.05) F.checks.c4_fx.push({ ticker: x.tk, end: key.split('|')[1], type: 'fx同侪偏差>5%', severity: dev > 0.2 ? 'HIGH' : 'MED',
      currency: key.split('|')[0], fx: x.fx, median: m, devPct: Math.round(dev * 1000) / 10, peers: arr.length });
  }
}
// 4c. fxDate 与 end 偏差过大（>15 天）
for (const [tk, c] of Object.entries(companies)) {
  for (const q of c.quarters) {
    if (q.fxToUsd == null || !q.fxDate) continue;
    const d = Math.abs(days(q.end, q.fxDate));
    if (d > 15) F.checks.c4_fx.push({ ticker: tk, end: q.end, type: 'fxDate偏离期末', severity: 'LOW', fxDate: q.fxDate, daysOff: Math.round(d) });
  }
}

/* ---------------- (5) periodType vs frequency ---------------- */
const ALLOWED = {
  annual: new Set(['annual']),
  q: new Set(['q', 'q1', 'q2', 'q3', 'q4', null]),
  'hk-mixed': new Set(['annual', 'q1', 'q2', 'q3', 'q4', 'interim', 'q', null]),
  mixed: new Set(['annual', 'q', 'q1', 'q2', 'q3', 'q4', 'interim', null]),
};
for (const [tk, c] of Object.entries(companies)) {
  const f = effFreq(c);
  const allow = ALLOWED[f] || ALLOWED.q;
  const bad = c.quarters.filter((q) => !allow.has(q.periodType == null ? null : q.periodType));
  if (bad.length) {
    const types = [...new Set(bad.map((q) => q.periodType))];
    F.checks.c5_periodType_freq.push({ ticker: tk, frequency: f, badPeriodTypes: types, count: bad.length,
      severity: f === 'annual' ? 'HIGH' : 'MED', sample: bad.slice(0, 4).map((q) => (q.periodType || 'null') + '@' + q.end) });
  }
}

/* ---------------- 数据缺口 / 停披（步骤3） ---------------- */
// 最新期落后同频次同侪 >2 个季度(>200d)；字段缺失率高
const groupLatest = {};
for (const [tk, c] of Object.entries(companies)) {
  const f = effFreq(c);
  const mx = c.quarters.reduce((m, q) => (q.end > m ? q.end : m), '');
  (groupLatest[f] ||= []).push({ tk, mx });
}
const groupRef = {};
for (const [f, arr] of Object.entries(groupLatest)) {
  const ends = arr.map((x) => x.mx).sort();
  groupRef[f] = ends[Math.floor(ends.length * 0.75)]; // 75 分位作为"当前"参考
}
for (const [tk, c] of Object.entries(companies)) {
  const f = effFreq(c);
  const mx = c.quarters.reduce((m, q) => (q.end > m ? q.end : m), '');
  const ref = groupRef[f];
  const lagQ = ref ? Math.round(days(mx, ref) / 91) : 0;
  // 字段缺失率（近 8 期）
  const recent = sortedQ(c).slice(-8);
  const fields = ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga'];
  let missing = 0, cells = 0;
  for (const q of recent) for (const fl of fields) { cells++; if (q[fl] == null) missing++; }
  const missRate = cells ? missing / cells : 0;
  const issues = [];
  if (lagQ > 2) issues.push(`最新end ${mx} 落后同频次75分位(${ref}) ${lagQ}个季度`);
  if (missRate > 0.5) issues.push(`近8期字段缺失率 ${(missRate * 100).toFixed(0)}%`);
  if (issues.length) F.gaps.push({ ticker: tk, frequency: f, currency: c.currency, latestEnd: mx, refEnd: ref, lagQuarters: lagQ, missRate: Math.round(missRate * 1000) / 1000, issues });
}

/* ---------------- 汇总 ---------------- */
const cnt = Object.fromEntries(Object.entries(F.checks).map(([k, v]) => [k, v.length]));
F.summary = { counts: cnt, gaps: F.gaps.length,
  bySeverity: {} };
for (const v of Object.values(F.checks)) for (const x of v) F.summary.bySeverity[x.severity] = (F.summary.bySeverity[x.severity] || 0) + 1;

fs.writeFileSync(OUT, JSON.stringify(F, null, 2));
console.log('== profitbridge 一致性检查 ==');
console.log('companies:', F.meta.companies, 'quarters:', F.meta.quarters, 'updated:', F.meta.updated);
console.log('counts:', JSON.stringify(F.summary.counts), 'severity:', JSON.stringify(F.summary.bySeverity));
console.log('\n--- (1) 内部矛盾 top ---');
for (const x of F.checks.c1_internal.slice(0, 30)) console.log(`  [${x.severity}] ${x.ticker} ${x.end} ${x.type} ${x.detail}`);
console.log(`  ...total ${F.checks.c1_internal.length}`);
console.log('\n--- (2) 相邻突变 top ---');
for (const x of F.checks.c2_adjacent_jump.slice(0, 40)) console.log(`  [${x.severity}] ${x.ticker} ${x.from}->${x.to} x${x.ratio} rev ${fmt(x.fromRev)}->${fmt(x.toRev)} prev=${x.prevRatio} next=${x.nextRatio}`);
console.log(`  ...total ${F.checks.c2_adjacent_jump.length}`);
console.log('\n--- (3) 累计差分不符 ---');
for (const x of F.checks.c3_cumulative_diff.slice(0, 40)) console.log(`  [${x.severity}] ${x.ticker} ${x.end} ${x.type} ${x.detail}`);
console.log(`  ...total ${F.checks.c3_cumulative_diff.length}`);
console.log('\n--- (4) fx ---');
for (const x of F.checks.c4_fx.slice(0, 40)) console.log(`  [${x.severity}] ${x.ticker} ${x.end || ''} ${x.type} ${JSON.stringify(x).slice(0, 140)}`);
console.log(`  ...total ${F.checks.c4_fx.length}`);
console.log('\n--- (5) periodType/freq 矛盾 ---');
for (const x of F.checks.c5_periodType_freq) console.log(`  [${x.severity}] ${x.ticker} freq=${x.frequency} bad=${x.badPeriodTypes} n=${x.count} e.g. ${x.sample}`);
console.log('\n--- 数据缺口/停披 ---');
for (const x of F.gaps) console.log(`  ${x.ticker} [${x.frequency}/${x.currency}] latest=${x.latestEnd} ref=${x.refEnd} lag=${x.lagQuarters}q missRate=${x.missRate} :: ${x.issues.join('; ')}`);
console.log('\nfindings.json written:', OUT);
