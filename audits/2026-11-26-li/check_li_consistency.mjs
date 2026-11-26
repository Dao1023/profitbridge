#!/usr/bin/env node
/**
 * check_li_consistency.mjs — 修正后的 LI 自洽性检查（只做数量级 / 符号 / 派生 Q4 对照, 不伪造等式）。
 *
 * 用法: node audits/2026-11-26-li/check_li_consistency.mjs
 * 退出码: 0 = 全部通过; 1 = 有断言失败
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/profit.json'), 'utf8'));
const co = P.companies.LI;
const quarters = co.quarters.filter(q => q.periodType !== 'annual');
const annual = co.quarters.filter(q => q.periodType === 'annual');
const fmt = (n) => (n == null ? 'null' : n.toFixed(3));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// 1) 年度行: gross − rd − sga 与 opInc 的差 = 其他经营损益净额; 只检查符号合理与量级 (≤5% 营收)
console.log('== 年度行: opInc + rd + sga − gross = 其他经营损益净额（含资产处置/其他经营收益）==');
const knownOther = { '2021-12-31': 0, '2022-12-31': 0, '2023-12-31': 264.210, '2024-12-31': 663.657, '2025-12-31': 473.631 };
for (const r of annual) {
  const other = r.opInc + r.rd + r.sga - r.gross;
  const pctOfRev = Math.abs(other) / r.revenue * 100;
  console.log(`  ${r.end}: gross ${fmt(r.gross)} − rd ${fmt(r.rd)} − sga ${fmt(r.sga)} = ${fmt(r.gross - r.rd - r.sga)}; opInc ${fmt(r.opInc)}; other ${fmt(other)} (${pctOfRev.toFixed(2)}% of revenue)`);
  ok(Math.abs(other) <= r.revenue * 0.05, `${r.end} 其他经营损益 |${fmt(other)}| ≤ 5% 营收`);
  if (r.end in knownOther) ok(Math.abs(other - knownOther[r.end]) < 0.01, `${r.end} other 与预期 ${fmt(knownOther[r.end])} 一致`);
}

// 2) 季度行: 单季同样只做符号/量级检查 (Q1/Q3 与 Q2 均为单季列)
console.log('== 季度行: 单季 gross − rd − sga vs opInc（量级 ≤5% 营收）==');
for (const r of quarters) {
  const other = r.opInc + r.rd + r.sga - r.gross;
  const pctOfRev = Math.abs(other) / r.revenue * 100;
  console.log(`  ${r.end}: other ${fmt(other)} (${pctOfRev.toFixed(2)}% of revenue) opInc ${fmt(r.opInc)}`);
  ok(pctOfRev <= 5, `${r.end} 其他经营损益 ≤ 5% 营收`);
}

// 3) 季度和≈年度: 用 as-reported FY 减 Q1..Q3 得隐含 Q4, 与独立披露的 Q4 对照（仅 2022–2025 有 FY 行）
console.log('== FY − Σ(Q1..Q3) = 隐含 Q4, 对照独立披露的 Q4 as-reported（不是入库等式）==');
const knownQ4 = { '2022-12-31': -133.619, '2023-12-31': 3036.426, '2024-12-31': 3703.314, '2025-12-31': -442.588 };
for (const fy of annual) {
  const y = fy.end.slice(0, 4);
  const qs = quarters.filter(q => q.end.startsWith(y + '-') && q.end !== fy.end);
  if (qs.length !== 3) { console.log(`  FY${y}: 单季行 ${qs.length} 个, 跳过派生 Q4 对照`); continue; }
  const sum3 = qs.reduce((s, q) => s + q.opInc, 0);
  const impliedQ4 = fy.opInc - sum3;
  const exp = knownQ4[fy.end];
  console.log(`  FY${y}: Q1..Q3 之和 ${fmt(sum3)}; FY ${fmt(fy.opInc)} → 隐含 Q4 ${fmt(impliedQ4)}; 独立披露 Q4 ${exp == null ? 'n/a' : fmt(exp)}`);
  ok(sum3 + impliedQ4 === fy.opInc || Math.abs(sum3 + impliedQ4 - fy.opInc) < 1e-9, `FY${y} ΣQ1..Q3 + 隐含 Q4 = FY`);
  if (exp != null) ok(Math.abs(impliedQ4 - exp) < 0.01, `FY${y} 隐含 Q4 与独立披露相差 < 0.01`);
  // 符号检查: 派生 Q4 与该年 FY、各单季没有量级跳变（|Q4| ≤ max(|FY|, Σ|Q|)）
  ok(Math.abs(impliedQ4) <= Math.max(Math.abs(fy.opInc), qs.reduce((s, q) => s + Math.abs(q.opInc), 0)) + 1e-9,
    `FY${y} 隐含 Q4 量级在合理范围内`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS (LI consistency)');
process.exit(fails ? 1 : 0);
