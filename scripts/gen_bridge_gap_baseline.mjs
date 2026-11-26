#!/usr/bin/env node
/**
 * gen_bridge_gap_baseline.mjs — 生成 data/bridge_gap_baseline.json（利润桥缺口基线快照）。
 *
 * 背景：opInc 是公司 as-reported 经营利润，而 gross − rd − sga 只覆盖三项成本；两者之间的差额
 * （本文称「桥缺口」）可能是减值、资产处置、SBC、重组等经营内其他项。全站绝大多数公司都有这种
 * 口径差，不可能逐期写理由，所以用「基线快照」做回归：
 *   * 基线里已有的期允许 gap 变化（修数本来就会变）；
 *   * 基线里没有的新期一旦出现 → tests/verify_opinc_bridge_gap.mjs 变红，必须人工确证后重跑本脚本。
 *
 * 口径：gap = opInc − (gross − rd − sga)；缺 opInc/gross/rd/sga/revenue 任一项的期跳过；
 *       只登记 |gap| > 1% × |revenue| 的期（与测试阈值一致）。
 *
 * 用法（在仓库根目录）：
 *   node scripts/gen_bridge_gap_baseline.mjs
 * 说明：基线更新必须与数据修正同一个 commit，这样 diff 里能直接看到基线变了。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PROFIT = path.join(ROOT, 'data/profit.json');
const OUT = path.join(ROOT, 'data/bridge_gap_baseline.json');
const THRESHOLD_PCT = 1;

const profit = JSON.parse(fs.readFileSync(PROFIT, 'utf8'));
const entries = [];
const byCompany = {};
for (const [ticker, co] of Object.entries(profit.companies)) {
  for (const q of co.quarters || []) {
    const { opInc, gross, rd, sga, revenue } = q;
    if (![opInc, gross, rd, sga, revenue].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
    if (!Number.isFinite(revenue) || revenue === 0) continue;
    const gap = opInc - (gross - rd - sga);
    if (Math.abs(gap) <= (THRESHOLD_PCT / 100) * Math.abs(revenue)) continue;
    entries.push({ ticker, end: q.end, gap: Math.round(gap * 1e6) / 1e6, revenue });
    byCompany[ticker] = (byCompany[ticker] || 0) + 1;
  }
}

const doc = {
  generatedAt: new Date().toISOString().slice(0, 10),
  generator: 'node scripts/gen_bridge_gap_baseline.mjs',
  definition: 'gap = opInc − (gross − rd − sga); entries have |gap| > 1% × |revenue|; periods missing opInc/gross/rd/sga/revenue are skipped',
  thresholdPct: THRESHOLD_PCT,
  note: '回归基线：已有期允许 gap 变化，但基线外的新期会让 tests/verify_opinc_bridge_gap.mjs 变红。新增缺口必须人工确证是「as-reported 口径（经营内其他项/减值/处置）」还是「取数错误」，再重跑生成脚本并与数据修正同一 commit。精确白名单（LI/BIDU/BABA/ZH）在测试里逐期断言，不在此文件。',
  count: entries.length,
  entries,
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), generatedAt: doc.generatedAt, count: entries.length, companies: Object.keys(byCompany).length, top: Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 12) }, null, 2));
